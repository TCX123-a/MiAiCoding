/**
 * 挑战结算（docs/26 §4.3/§4.4 + §5 计分 + §7.2 难度复核 + §8.4 冲突裁决）。
 *
 *  - POST /v1/challenge/days：逐题事实进、服务端唯一算分；PK (account_id, date_key) = 一天一批，
 *    先到先得；同 submissionId + 同 payload sha256 → 200 idempotent:true（返回库中值），
 *    其余同日提交 → 409 CHALLENGE_DUPLICATE（附已结算摘要）。
 *  - GET /v1/challenge/days：?from&to&limit(≤90) 每日汇总（不含逐题明细，§4.4）；
 *    默认窗口 to = 服务器日 + DAY_KEY_WINDOW_DAYS（吸收本地日超前，第 6 项修复）；
 *    每条附 pickedLangs（勾选语言随档案往返，换机恢复不丢）。
 *
 * 限流（§4.7）：提交 10 次/日/账号——**幂等重放不消耗**（快速路径先于取令牌）。
 * 硬校验（§5.6）：score ≤ scoreMax（批内自洽）+ scoreMax ≤ DAILY_SCORE_MAX；
 * 两条都是构造性不可达的防御断言（复核后难度分 ≤ 250/题——语言权重全 100、与语言无关；
 * 题量 ≤ CHALLENGE_RUN_MAX），一旦触发说明协议常量被改动，log + 400 拒结算。
 *
 * 批长（2026-10-10 挑战 v3 主人令）：取消单日题数产品上限（v2 的「最多 20 题」），停/续规则不变
 * （答对继续、答错立即停止），客户端改抽整个已学题库；服务端结算接受 total ∈ [1, CHALLENGE_RUN_MAX=5000]，
 * 5000 是健全性上界（全库实测 4169 题 + AI 段 20 的最坏 4189 之上留余量），
 * 客户端的停/续由出题侧决定，服务端不裁决。单日分数上限 = DAILY_SCORE_MAX = 5000 × 250 = 1,250,000。
 *
 * 勾选语言（2026-10-10 夜挑战 v3 续批）：结算携带 pickedLangs = 开赛前勾选的语言（四门），
 * 落 challenge_days.picked_langs（迁移 0010），供排行榜「所选语言」聚合。显式 present 必须
 * 非空/合法/无重复（zod 拦）；缺省（legacy 客户端）服务端从题批 lang 派生（∩ 四门、声明序）
 * —— 旧语义的诚实降级，全 common 的批派生为空数组。
 * 结算窗口（A1 裁定 b / docs/26 §2.2 承诺落地）：dateKey ∈ [服务器日 − CHALLENGE_SETTLE_PAST_DAYS,
 * 服务器日 + DAY_KEY_WINDOW_DAYS]，超窗 400 拒 + log 审计（窗 ≈ 客户端 30 天存档保留期，够诚实用户）。
 */
import { z } from 'zod';
import type { Queryable } from '../db/pool.js';
import { appError } from '../lib/errors.js';
import { diffDays, serverDayKey, shiftDayKey, isValidDateKey } from '../lib/daykey.js';
import { scoreBatch, type ScoringQuestionInput } from '../lib/scoring.js';
import { canonicalJson, num, parseSaneTimestamp, sha256Hex, toIso } from '../lib/util.js';
import {
  CHALLENGE_HISTORY_LIMIT_MAX,
  CHALLENGE_PICKABLE_LANGS,
  CHALLENGE_RUN_MAX,
  CHALLENGE_SETTLE_PAST_DAYS,
  DAILY_SCORE_MAX,
  DAY_KEY_WINDOW_DAYS,
  DIFFICULTIES,
  LANGS,
  MAX_STAGE,
  QUESTION_TYPES,
  type PickableLang,
} from '../protocol.js';
import { requireAuth } from '../plugins/auth.js';
import { enforceRateLimit } from '../plugins/rate-limit.js';
import { takeApiRate, type AppInstance, type SharedDeps } from '../plugins/shared.js';

const questionSchema = z.object({
  // 形状与 challenge_questions.question_key 的 DB CHECK 同款（`lesson:qid`）
  key: z.string().min(3).max(128).regex(/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/),
  lessonId: z.string().min(1).max(64),
  qid: z.string().min(1).max(64),
  lang: z.enum(LANGS),
  stage: z.number().int().min(0).max(MAX_STAGE),
  type: z.enum(QUESTION_TYPES),
  difficulty: z.enum(DIFFICULTIES),
  source: z.enum(['local', 'ai']),
  ok: z.boolean(),
});

const settleBodySchema = z.object({
  submissionId: z.uuid(),
  installId: z.uuid(),
  dateKey: z.string(),
  source: z.enum(['local', 'ai']),
  startedAt: z.iso.datetime({ offset: true }).optional(),
  finishedAt: z.iso.datetime({ offset: true }),
  questions: z.array(questionSchema).min(1).max(CHALLENGE_RUN_MAX),
  /**
   * 挑战 v3 契约：开赛前勾选的语言。present 时必须非空（至少勾一门）、值域四门、无重复；
   * 缺省 = legacy 客户端，服务端从题批 lang 派生（handler 内，诚实降级）。
   */
  pickedLangs: z
    .array(z.enum(CHALLENGE_PICKABLE_LANGS))
    .min(1)
    .max(CHALLENGE_PICKABLE_LANGS.length)
    .refine((xs) => new Set(xs).size === xs.length, {
      message: 'pickedLangs must not contain duplicates',
    })
    .optional(),
});

const settleResponseSchema = z.object({
  settled: z.literal(true),
  idempotent: z.boolean(),
  dateKey: z.string(),
  correct: z.number(),
  total: z.number(),
  score: z.number(),
  scoreMax: z.number(),
  flags: z.array(z.string()),
});

const historyQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(CHALLENGE_HISTORY_LIMIT_MAX).default(30),
});

const historyResponseSchema = z.object({
  days: z.array(
    z.object({
      dateKey: z.string(),
      source: z.string(),
      correct: z.number(),
      total: z.number(),
      score: z.number(),
      scoreMax: z.number(),
      /** 开赛前勾选的语言（v3 契约；legacy 结算行的派生结果也在——窗内旧档 = 空数组） */
      pickedLangs: z.array(z.enum(CHALLENGE_PICKABLE_LANGS)),
      settledAt: z.string(),
    }),
  ),
});

interface DayRow {
  date_key: string; // 查询一律 to_char 归一（pg 会把 date 解析成 Date，PGlite 给字符串）
  source: string;
  correct: number | string;
  total: number | string;
  score: number | string;
  score_max: number | string;
  flags: string[];
  submission_id: string;
  payload_sha256: string;
  settled_at: Date | string;
}

const DAY_SELECT = `SELECT to_char(date_key, 'YYYY-MM-DD') AS date_key, source, correct, total, score,
                           score_max, flags, submission_id, payload_sha256, settled_at
                      FROM challenge_days
                     WHERE account_id = $1 AND date_key = $2::date`;

async function loadDay(q: Queryable, accountId: string, dateKey: string): Promise<DayRow | null> {
  const { rows } = await q.query<DayRow>(DAY_SELECT, [accountId, dateKey]);
  return rows[0] ?? null;
}

/**
 * 已存在结算行的分类（§4.8）：同 submissionId + 同 hash → 幂等重放；其余 → 409。
 * 严格按文档口径：幂等 200 的条件是「同 submissionId **且** 同 payload hash」两者齐备。
 */
function classifySettledDay(
  row: DayRow,
  submissionId: string,
  payloadHash: string,
): { idempotent: true; body: z.infer<typeof settleResponseSchema> } {
  if (row.submission_id === submissionId && row.payload_sha256 === payloadHash) {
    return {
      idempotent: true,
      body: {
        settled: true,
        idempotent: true,
        dateKey: row.date_key,
        correct: num(row.correct),
        total: num(row.total),
        score: num(row.score),
        scoreMax: num(row.score_max),
        flags: row.flags,
      },
    };
  }
  throw appError('CHALLENGE_DUPLICATE', 'a different challenge settlement for this day already exists', {
    details: { settledAt: toIso(row.settled_at), score: num(row.score) },
  });
}

export function challengeRoutes(app: AppInstance, deps: SharedDeps): void {
  const { db, rates, limiter } = deps;

  app.post(
    '/v1/challenge/days',
    {
      preHandler: app.authenticate,
      // 全池票据最坏 = 5000 题 × ~350B ≈ 1.75MB，必须能过传输层，故取 2MiB 留余量；
      // 超限的 5001 题必须在 zod 层被拒（400 request validation failed），不许变成传输层 413。
      bodyLimit: 2 * 1024 * 1024,
      schema: {
        body: settleBodySchema,
        response: { 200: settleResponseSchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      takeApiRate(deps, request);
      const body = request.body;

      // ---- 业务形状校验（zod 之外的语义部分）→ 一律 400 ----
      if (!isValidDateKey(body.dateKey)) {
        throw appError('VALIDATION_FAILED', `dateKey is not a real date: ${body.dateKey}`);
      }
      // 结算窗口（A1 裁定 b）：过去 ≤ CHALLENGE_SETTLE_PAST_DAYS（≈ 客户端存档保留期 30 天，
      // 它还可能上行的日子都在窗内）、未来 ≤ DAY_KEY_WINDOW_DAYS（吸收本地日超前）。超窗 =
      // 伪造或病态时钟：log 审计 + 400 拒，不静默收编。
      const dayOffset = diffDays(body.dateKey, serverDayKey());
      if (dayOffset < -CHALLENGE_SETTLE_PAST_DAYS || dayOffset > DAY_KEY_WINDOW_DAYS) {
        request.log.warn(
          { accountId: auth.accountId, dateKey: body.dateKey, dayOffset },
          'challenge settle dateKey out of the allowed window',
        );
        throw appError(
          'VALIDATION_FAILED',
          `dateKey is out of the settle window (past ${CHALLENGE_SETTLE_PAST_DAYS} days, future ${DAY_KEY_WINDOW_DAYS} day)`,
          { details: { dateKey: body.dateKey, dayOffset } },
        );
      }
      // 勾选语言归一（契约见 settleBodySchema 注释）：present 时形状/值域/去重已由 zod 拦，
      // 这里按声明序重排（filter + includes 既保序又去重）；缺省时从题批 lang 派生旧语义。
      const pickedLangs =
        body.pickedLangs !== undefined
          ? CHALLENGE_PICKABLE_LANGS.filter((lang) => body.pickedLangs!.includes(lang))
          : CHALLENGE_PICKABLE_LANGS.filter((lang) => body.questions.some((q) => q.lang === lang));
      // 批长上界：1..CHALLENGE_RUN_MAX 合法（下界 1 由 zod .min(1) 拦）。> 上界实际由
      // zod 的 .max 先拦（错误信息是通用的 request validation failed）；这里是与 .max 故意
      // 重叠的语义层防御兜底：若 zod 上限被放宽/移除，本检查仍会以带 received 的专门信息拒，
      // 绝不静默接受超长批（语义层同 §5.6）。
      if (body.questions.length > CHALLENGE_RUN_MAX) {
        throw appError(
          'VALIDATION_FAILED',
          `questions must not exceed CHALLENGE_RUN_MAX (${CHALLENGE_RUN_MAX}) items`,
          { details: { received: body.questions.length } },
        );
      }
      const keys = new Set(body.questions.map((q) => q.key));
      if (keys.size !== body.questions.length) {
        throw appError('VALIDATION_FAILED', 'question keys must be unique within a submission');
      }
      if (parseSaneTimestamp(body.finishedAt) === null) {
        throw appError('VALIDATION_FAILED', `finishedAt is not a sane timestamp: ${body.finishedAt}`);
      }
      if (body.startedAt !== undefined) {
        const startedMs = parseSaneTimestamp(body.startedAt);
        if (startedMs === null) {
          throw appError('VALIDATION_FAILED', `startedAt is not a sane timestamp: ${body.startedAt}`);
        }
        if (startedMs > parseSaneTimestamp(body.finishedAt)!) {
          throw appError('VALIDATION_FAILED', 'startedAt must not be after finishedAt');
        }
      }

      // ---- 服务端唯一算分（§5）----
      const batch = scoreBatch(body.questions as ScoringQuestionInput[]);
      if (batch.score > batch.scoreMax || batch.scoreMax > DAILY_SCORE_MAX) {
        // 构造性不可达（防御断言）：能到这里说明难度权重/题量与协议真源脱节了
        request.log.warn(
          { accountId: auth.accountId, score: batch.score, scoreMax: batch.scoreMax },
          'challenge scoring invariant violated (score/scoreMax above DAILY_SCORE_MAX)',
        );
        throw appError('VALIDATION_FAILED', 'scoreMax exceeds the daily theoretical maximum', {
          details: { score: batch.score, scoreMax: batch.scoreMax, dailyMax: DAILY_SCORE_MAX },
        });
      }

      const payloadHash = sha256Hex(canonicalJson(body));

      // ---- 幂等重放快速路径（先于限流取令牌：§4.7「重试同 submissionId 不计」）----
      const existing = await loadDay(db, auth.accountId, body.dateKey);
      if (existing) return classifySettledDay(existing, body.submissionId, payloadHash).body;

      enforceRateLimit(limiter, {
        key: `chsub|a:${auth.accountId}`,
        limit: rates.challengeSubmitPerDayPerAccount,
        windowMs: 86_400_000,
        message: 'too many challenge submissions today',
      });

      const response = await db.withTransaction(async (tx) => {
        const inserted = await tx.query<DayRow>(
          `INSERT INTO challenge_days
             (account_id, date_key, install_id, source, started_at, finished_at,
              correct, total, score, score_max, score_by_lang, score_by_difficulty,
              flags, submission_id, payload_sha256, picked_langs)
           VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15, $16::text[])
           ON CONFLICT (account_id, date_key) DO NOTHING
           RETURNING to_char(date_key, 'YYYY-MM-DD') AS date_key, source, correct, total, score,
                     score_max, flags, submission_id, payload_sha256, settled_at`,
          [
            auth.accountId,
            body.dateKey,
            body.installId,
            body.source,
            body.startedAt ?? null,
            body.finishedAt,
            batch.correct,
            batch.total,
            batch.score,
            batch.scoreMax,
            JSON.stringify(batch.scoreByLang),
            JSON.stringify(batch.scoreByDifficulty),
            batch.flags,
            body.submissionId,
            payloadHash,
            pickedLangs,
          ],
        );

        if (inserted.rows.length === 0) {
          // 并发插入者赢了：同事务补读分类（要么幂等 200，要么 409 —— 事务随之回滚）
          const current = await loadDay(tx, auth.accountId, body.dateKey);
          if (!current) {
            // 0 行且无行：只可能是并发删除（不存在此路径）——防御兜底，绝不静默成功
            throw appError('INTERNAL', 'challenge day row disappeared during settlement');
          }
          return classifySettledDay(current, body.submissionId, payloadHash).body;
        }

        // 逐题明细（服务端铸；difficulty 落复核后的有效档，与 points 同口径）
        // 身份字段取自原始请求体，分值字段取自评分结果（index 对齐；scoring 类型面只看分）
        // 分批 1000 行/次（同事务提交）：PG 绑定参数上限 65535，13 参/行 × 5000 行 = 65000
        // 只剩 535 余量（2026-10-10 登记项）——分批把每批压到 13000 参，将来加列也不怕。
        const QUESTIONS_PER_INSERT = 1000;
        for (let start = 0; start < body.questions.length; start += QUESTIONS_PER_INSERT) {
          const slice = body.questions.slice(start, start + QUESTIONS_PER_INSERT);
          const values: unknown[] = [];
          const tuples = slice.map((orig, i) => {
            const idx = start + i;
            const scored = batch.questions[idx]!;
            const base = values.length;
            values.push(
              auth.accountId, body.dateKey, idx, orig.key, orig.lessonId, orig.qid, orig.lang,
              orig.stage, orig.type, scored.effectiveDifficulty, orig.source, orig.ok, scored.points,
            );
            const p = Array.from({ length: 13 }, (_, k) => `$${base + k + 1}`);
            return `(${p.join(', ')})`;
          });
          await tx.query(
            `INSERT INTO challenge_questions
               (account_id, date_key, idx, question_key, lesson_id, qid, lang, stage,
                qtype, difficulty, source, ok, points)
             VALUES ${tuples.join(', ')}`,
            values,
          );
        }

        // 进度派生（0004）：当日挑战分 = 本次结算分（learned/practiced 由每日任务回填文档口径）
        await tx.query(
          `INSERT INTO user_days (account_id, day_key, score)
           VALUES ($1, $2::date, $3)
           ON CONFLICT (account_id, day_key) DO UPDATE SET score = EXCLUDED.score, updated_at = now()`,
          [auth.accountId, body.dateKey, batch.score],
        );

        // 总榜快路径（§3.3「total_score 冗余为快路径，重算时校验一致」）：就地累加，
        // 好让 alltime 榜/me 汇总即时反映今天的分；每日任务按 SUM(challenge_days.score)
        // 对账，不一致即重算覆盖。幂等重放/409 冲突都在上面早退，绝不会重复累加。
        await tx.query(
          `INSERT INTO user_stats (account_id, total_score)
           VALUES ($1, $2)
           ON CONFLICT (account_id) DO UPDATE
              SET total_score = user_stats.total_score + EXCLUDED.total_score,
                  updated_at = now()`,
          [auth.accountId, batch.score],
        );

        const row = inserted.rows[0]!;
        return {
          settled: true as const,
          idempotent: false,
          dateKey: row.date_key,
          correct: num(row.correct),
          total: num(row.total),
          score: num(row.score),
          scoreMax: num(row.score_max),
          flags: row.flags,
        };
      });

      return response;
    },
  );

  app.get(
    '/v1/challenge/days',
    {
      preHandler: app.authenticate,
      schema: {
        querystring: historyQuerySchema,
        response: { 200: historyResponseSchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      takeApiRate(deps, request);
      const { from, to, limit } = request.query;

      // 默认窗口的「今天」= 服务器日 + DAY_KEY_WINDOW_DAYS：客户端日可能超前服务器日
      // （设备时钟偏快、手动改日，或旧客户端仍按别的时区算日），平移一天才能把
      // 「刚做完的今天」捞回窗内（第 6 项修复）。
      // 显式 from/to 不受影响（想翻多旧由客户端自己传窗）。
      const toKey = to ?? shiftDayKey(serverDayKey(), DAY_KEY_WINDOW_DAYS);
      if (!isValidDateKey(toKey)) {
        throw appError('VALIDATION_FAILED', `to is not a real date: ${toKey}`);
      }
      let fromKey = from;
      if (fromKey === undefined) {
        // from 缺省锚定 min(服务器日, to)，两件事一次办成：
        // ① to 缺省或 ≥ 服务器日时锚**服务器日**：to 为吸收客户端日差放宽了一天，若 from 也从 to 倒数，
        //    小 limit 的默认窗会整体漂向未来（limit=1 → 窗口只剩「明天」，今天的档反而拉不到；
        //    2026-10-10 夜测试抓到的原修法漏洞）。锚定后默认窗 = [服务器日−(limit−1), 服务器日+1]：
        //    至少覆盖最近 limit 个服务器日，外加至多一天的未来宽容。
        // ② 显式给了更早的 to（历史翻页：下一页 to = 上一页最老日 − 1）时锚 **to**：窗口以 to 收尾
        //    = [to−(limit−1), to]，与批次前语义一致。只给过去 to 曾被 ① 顶成 from > to → 400，
        //    首页 200、第二页骤断（2026-10-10 夜对抗核验抓到的组合，契约补裁定）。
        const anchor = toKey < serverDayKey() ? toKey : serverDayKey();
        fromKey = shiftDayKey(anchor, -(limit - 1));
      } else if (!isValidDateKey(fromKey)) {
        throw appError('VALIDATION_FAILED', `from is not a real date: ${fromKey}`);
      }
      if (fromKey > toKey) {
        throw appError('VALIDATION_FAILED', 'from must not be after to');
      }

      const { rows } = await db.query<{
        date_key: string;
        source: string;
        correct: number | string;
        total: number | string;
        score: number | string;
        score_max: number | string;
        picked_langs: PickableLang[]; // 列的 DB CHECK 与 CHALLENGE_PICKABLE_LANGS 同域（0010），读出来即 PickableLang
        settled_at: Date | string;
      }>(
        `SELECT to_char(date_key, 'YYYY-MM-DD') AS date_key, source, correct, total, score,
                score_max, picked_langs, settled_at
           FROM challenge_days
          WHERE account_id = $1 AND date_key BETWEEN $2::date AND $3::date
          ORDER BY date_key DESC
          LIMIT $4`,
        [auth.accountId, fromKey, toKey, limit],
      );

      return {
        days: rows.map((row) => ({
          dateKey: row.date_key,
          source: row.source,
          correct: num(row.correct),
          total: num(row.total),
          score: num(row.score),
          scoreMax: num(row.score_max),
          pickedLangs: row.picked_langs,
          settledAt: toIso(row.settled_at),
        })),
      };
    },
  );
}
