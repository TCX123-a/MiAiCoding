/**
 * 排行榜（docs/26 §4.5 端点 + §3.5 快照表 + §7.3 筛选取径）。
 *
 * 两条路径（§3.5「为什么快照而不是实时算」）：
 *  - **无过滤 daily/weekly/monthly/yearly** → 读 `leaderboard_snapshots`（每日任务 cron 重铸，
 *    查询路径只剩一次索引扫描；2026-10-10 改版把月/年两档并入同一张表）；daily 省略 periodKey
 *    取**刚结束的一天**（服务器日 −1，与 cron 的 referenceDay 同源 —— 默认请求必命中已铸快照，
 *    只留 00:00–03:05 的铸前空窗；2026-10-10 对抗核验修：原先取「当天」，而当天键最早要等明天
 *    cron 才铸，默认请求恒空）；快照确实未生成 → 空榜 + computedAt=null，客户端显示空态
 *    （docs/26 §8.2：不摆假数据）。
 *  - **带过滤 / alltime** → 实算。带过滤从 `challenge_questions` 逐题求和（lang/difficulty 可
 *    同时给——jsonb 两列各自求和做不到「同时」，逐题表天然精确）；alltime 无过滤按 §3.5 原话
 *    读 `user_stats.total_score`（= SUM(challenge_days.score)，每日任务保序）。
 *
 * entries 的 langs（2026-10-10 夜改口径）：**该账号在榜期 challenge_days.picked_langs 里的
 * 并集**——挑战开赛前勾选过的语言（不是「做过哪些题的语言」；主人令语义：体现挑战选择与难度池）。
 * **只看榜期窗口**、与请求的 lang/difficulty 过滤器无关（过滤器只改变分数口径，不改变勾选集合）。
 * 窗口由 periodWindow 单点定义，快照/实算两条路径共用。
 *
 * 名次宇宙（§4.5「本人名次不论是否 opt-in 都返回」）：全部未封禁且有分的账号参与排序，
 * opt-in 只决定**是否出现在 entries 里**——所以榜面名次可能有洞，那是诚实的洞。
 * 并列同名次用 `rank()`；展示排序与游标 = `(score DESC, account_id ASC)`。
 * （§3.5 表格写「(score DESC, finished_at ASC)」，但冻结的 snapshots 表没有 finished_at 列，
 * 且 §4.5 定义的游标就是 base64(score:accountId)——以可实现的游标口径为准，登记在清单。）
 */
import { z } from 'zod';
import type { Queryable } from '../db/pool.js';
import { appError } from '../lib/errors.js';
import {
  diffDays,
  isValidDateKey,
  isValidMonthKey,
  isValidWeekKey,
  isValidYearKey,
  isoMonthRange,
  isoWeekRange,
  isoYearRange,
  serverDayKey,
  serverMonthKey,
  serverWeekKey,
  serverYearKey,
  shiftDayKey,
} from '../lib/daykey.js';
import { decodeLeaderboardCursor, encodeLeaderboardCursor } from '../lib/leaderboard-cursor.js';
import { num, toIso } from '../lib/util.js';
import {
  DAY_KEY_WINDOW_DAYS,
  DIFFICULTIES,
  LANGS,
  LEADERBOARD_LIMIT_MAX,
  LEADERBOARD_PERIODS,
  type Lang,
  type LeaderboardPeriod,
} from '../protocol.js';
import { requireAuth } from '../plugins/auth.js';
import { takeApiRate, type AppInstance, type SharedDeps } from '../plugins/shared.js';

const querySchema = z.object({
  period: z.enum(LEADERBOARD_PERIODS),
  periodKey: z
    .string()
    .optional()
    .describe(
      '榜期键；省略时的默认：daily=刚结束的一天（北京时间服务器日 −1，与每日快照铸期同源）、weekly/monthly/yearly=服务器北京日所在周/月/年（UTC+8）；alltime 不接受本参数',
    ),
  lang: z.enum(LANGS).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  dateKey: z
    .string()
    .optional()
    .describe(
      '可选：把「今天」显式指到客户端北京日（YYYY-MM-DD 形状；与服务器日容差 ±1 天），me.scoreToday 按它查；省略 = 服务器北京日',
    ),
  limit: z.coerce.number().int().min(1).max(LEADERBOARD_LIMIT_MAX).default(50),
  cursor: z.string().optional(),
});

/**
 * 榜面条目。`langs` 口径（2026-10-10 夜主人令改）：
 *   **该账号在榜期挑战里开赛前勾选过的语言**（challenge_days.picked_langs 的并集），
 *   按 LANGS 声明序输出，不含 'common'（勾选器本就不含 common；空数组 = 窗内没有
 *   带勾选记录的挑战，前端显示「还没记录」）。只看榜期窗口，与 score 的窗口同源；
 *   不受请求的 lang/difficulty 过滤器影响（过滤器只改分数口径）。
 */
const entrySchema = z.object({
  rank: z.number(),
  username: z.string(),
  /** 头像 hash（sha256 hex）；null = 没设头像，客户端显示默认大肥鱼 */
  avatarHash: z.string().nullable(),
  score: z.number(),
  days: z.number(),
  langs: z.array(z.enum(LANGS)),
});

const responseSchema = z.object({
  period: z.enum(LEADERBOARD_PERIODS),
  periodKey: z.string().nullable(),
  filter: z.object({
    lang: z.enum(LANGS).nullable(),
    difficulty: z.enum(DIFFICULTIES).nullable(),
  }),
  entries: z.array(entrySchema),
  me: z.object({
    rank: z.number().nullable(),
    score: z.number(),
    optedIn: z.boolean(),
    scoreToday: z.number(),
  }),
  computedAt: z.string().nullable(),
  nextCursor: z.string().nullable(),
});

interface BoardRow {
  account_id: string;
  score: number | string;
  days: number | string;
  rank: number | string;
  username: string;
  avatar_hash: string | null;
}

interface MeRow {
  score: number | string;
  days: number | string;
  rank: number | string;
}

/** keyset 条件（ORDER BY score DESC, account_id ASC 的「游标之后」）：两处 SQL 共用同一文本。 */
const KEYSET = (scoreParam: string, idParam: string): string =>
  `(${scoreParam}::int IS NULL OR score < ${scoreParam} OR (score = ${scoreParam} AND account_id > ${idParam}::uuid))`;

/** langs 排序位（LANGS 声明序；'common' 的位次用不上——它在聚合时就被剔掉）。 */
const LANG_ORDER = new Map<string, number>(LANGS.map((lang, index) => [lang, index]));

/** 榜期 → challenge_questions 的 date_key 窗口；from/to 为 null = 不带日期过滤（alltime）。 */
interface PeriodWindow {
  from: string | null;
  to: string | null;
}

/**
 * 期窗口的单点定义（快照路径的 langs 与带过滤路径的分数过滤共用）。
 * 非 alltime 的 periodKey 已过路由层校验 → 三个 range 函数不可能返回 null；
 * 兜底抛 INTERNAL，**绝不静默退化成「全时段」**（那会把年榜悄悄变成总榜）。
 */
function periodWindow(period: LeaderboardPeriod, periodKey: string | null): PeriodWindow {
  if (period === 'alltime') return { from: null, to: null };
  if (period === 'daily') return { from: periodKey!, to: periodKey! };
  if (period === 'weekly') {
    const range = isoWeekRange(periodKey!);
    if (range === null) throw appError('INTERNAL', 'isoWeekRange disagrees with isValidWeekKey');
    return range;
  }
  if (period === 'monthly') {
    const range = isoMonthRange(periodKey!);
    if (range === null) throw appError('INTERNAL', 'isoMonthRange disagrees with isValidMonthKey');
    return range;
  }
  const range = isoYearRange(periodKey!);
  if (range === null) throw appError('INTERNAL', 'isoYearRange disagrees with isValidYearKey');
  return range;
}

/**
 * 组装页内账号的 langs（口径见 entrySchema.langs 注释）：一次额外查询取
 * 「榜期挑战里开赛前勾选过的语言」＝ challenge_days.picked_langs 的并集
 * （2026-10-10 夜主人令：显示挑战选择，不再从做题语言反推——只做 C 题但勾了
 * C+Java 的人，Java 必须留下）。CROSS JOIN LATERAL unnest 展开数组，
 * GROUP BY 去重、按 LANGS 声明序排序。
 * rows 为空时直接返回空表（省一次查询；不是「默认回退为成功」——空页本就该是空 langs）。
 */
async function loadLangs(
  q: Queryable,
  accountIds: string[],
  window: PeriodWindow,
): Promise<Map<string, Lang[]>> {
  const out = new Map<string, Lang[]>();
  if (accountIds.length === 0) return out;
  // picked_langs 的 DB CHECK（0010）已把值域钉在四门内，展开读出来即 Lang
  // （langs 不过滤 lang/difficulty 查询参数——它是「所选语言」，不是题目过滤的产物）
  const { rows } = await q.query<{ account_id: string; lang: Lang }>(
    `SELECT cd.account_id::text AS account_id, l.lang
       FROM challenge_days cd
       CROSS JOIN LATERAL unnest(cd.picked_langs) AS l(lang)
      WHERE cd.account_id = ANY($1::uuid[])
        AND ($2::date IS NULL OR cd.date_key BETWEEN $2::date AND $3::date)
        AND l.lang <> 'common'
      GROUP BY cd.account_id, l.lang`,
    [accountIds, window.from, window.to],
  );
  for (const row of rows) {
    const list = out.get(row.account_id);
    if (list === undefined) out.set(row.account_id, [row.lang]);
    else list.push(row.lang);
  }
  const orderOf = (lang: string): number => LANG_ORDER.get(lang) ?? LANG_ORDER.size;
  for (const list of out.values()) list.sort((a, b) => orderOf(a) - orderOf(b));
  return out;
}

export function leaderboardRoutes(app: AppInstance, deps: SharedDeps): void {
  const { db } = deps;

  app.get(
    '/v1/leaderboard',
    {
      preHandler: app.authenticate,
      schema: {
        querystring: querySchema,
        response: { 200: responseSchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      takeApiRate(deps, request);
      const { period, lang, difficulty, limit } = request.query;
      const filtered = lang !== undefined || difficulty !== undefined;

      // dateKey（可选；第 6 项日差修复）：me.scoreToday 按客户端日查（±1 容差），
      // 省略 = 服务器北京日（与客户端同一天）。
      const clientDayKey = request.query.dateKey ?? serverDayKey();
      if (
        !isValidDateKey(clientDayKey) ||
        Math.abs(diffDays(clientDayKey, serverDayKey())) > DAY_KEY_WINDOW_DAYS
      ) {
        throw appError(
          'VALIDATION_FAILED',
          `dateKey must be within ±${DAY_KEY_WINDOW_DAYS} day(s) of the server day: ${request.query.dateKey}`,
        );
      }

      // ---- periodKey 解析（§4.5：daily 省略 = **刚结束的一天**（与每日快照同源，
      //      见上）；weekly/monthly/yearly 省略 = 当前 ISO 周 / 月 / 年，一律以服务器
      //      北京日（UTC+8）为参照；alltime 不适用）----
      let periodKey: string | null = null;
      if (period === 'alltime') {
        if (request.query.periodKey !== undefined) {
          throw appError('VALIDATION_FAILED', 'periodKey is not applicable to period=alltime');
        }
      } else if (period === 'daily') {
        // 省略 = **刚结束的一天**（服务器日 −1），与每日任务铸快照的 referenceDay 同源
        // （jobs/daily.ts：referenceDay = 服务器日 − 1）。取「当天」是死路：当天键最早
        // 要等明天的 cron 才铸出来，而那时默认键已滚到明天 —— 默认请求恒空榜
        // （2026-10-10 对抗核验抓到，已修）。
        periodKey = request.query.periodKey ?? shiftDayKey(serverDayKey(), -1);
        if (!isValidDateKey(periodKey)) {
          throw appError('VALIDATION_FAILED', `periodKey is not a real date: ${periodKey}`);
        }
      } else if (period === 'weekly') {
        periodKey = request.query.periodKey ?? serverWeekKey();
        if (!isValidWeekKey(periodKey)) {
          throw appError('VALIDATION_FAILED', `periodKey is not a valid ISO week: ${periodKey}`);
        }
      } else if (period === 'monthly') {
        periodKey = request.query.periodKey ?? serverMonthKey(serverDayKey());
        if (!isValidMonthKey(periodKey)) {
          throw appError('VALIDATION_FAILED', `periodKey is not a valid month: ${periodKey}`);
        }
      } else {
        periodKey = request.query.periodKey ?? serverYearKey(serverDayKey());
        if (!isValidYearKey(periodKey)) {
          throw appError('VALIDATION_FAILED', `periodKey is not a valid year: ${periodKey}`);
        }
      }

      // 期窗口（分数过滤与 langs 聚合共用同一份口径）
      const window = periodWindow(period, periodKey);

      // ---- 游标 ----
      let cursor: { score: number; accountId: string } | null = null;
      if (request.query.cursor !== undefined) {
        cursor = decodeLeaderboardCursor(request.query.cursor);
        if (cursor === null) throw appError('VALIDATION_FAILED', 'cursor is malformed');
      }
      const cursorScore = cursor?.score ?? null;
      const cursorId = cursor?.accountId ?? null;

      // ---- 榜单主体（各分支多取 1 行做「后面还有没有」的前瞻，游标只在真有下一页时给出）----
      let fetched: BoardRow[];
      let meRow: MeRow | null;
      let computedAt: string | null;

      if (!filtered && period !== 'alltime') {
        // 快照路径（daily/weekly/monthly/yearly 无过滤）
        const list = await db.query<BoardRow>(
          `SELECT s.account_id, s.score, s.days, s.rank, u.username, u.avatar_hash
             FROM leaderboard_snapshots s
             JOIN users u ON u.id = s.account_id
            WHERE s.period = $1 AND s.period_key = $2
              AND u.leaderboard_opt_in = true AND u.disabled_at IS NULL
              AND ${KEYSET('$3', '$4')}
            ORDER BY s.score DESC, s.account_id ASC
            LIMIT $5`,
          [period, periodKey, cursorScore, cursorId, limit + 1],
        );
        fetched = list.rows;

        const me = await db.query<MeRow>(
          `SELECT score, days, rank FROM leaderboard_snapshots
            WHERE period = $1 AND period_key = $2 AND account_id = $3`,
          [period, periodKey, auth.accountId],
        );
        meRow = me.rows[0] ?? null;

        const stamp = await db.query<{ t: Date | string | null }>(
          `SELECT MAX(computed_at) AS t FROM leaderboard_snapshots
            WHERE period = $1 AND period_key = $2`,
          [period, periodKey],
        );
        const t = stamp.rows[0]?.t;
        computedAt = t === null || t === undefined ? null : toIso(t);
      } else if (!filtered) {
        // alltime 无过滤：user_stats 实算（§3.5）
        const base = `WITH day_counts AS (
                        SELECT account_id, count(*)::int AS days FROM challenge_days GROUP BY account_id
                      ),
                      scored AS (
                        SELECT us.account_id AS account_id, us.total_score AS score,
                               COALESCE(dc.days, 0)::int AS days
                          FROM user_stats us
                          JOIN users u ON u.id = us.account_id
                          LEFT JOIN day_counts dc ON dc.account_id = us.account_id
                         WHERE u.disabled_at IS NULL AND us.total_score > 0
                      ),
                      ranked AS (
                        SELECT account_id, score, days, rank() OVER (ORDER BY score DESC) AS rank
                          FROM scored
                      )`;
        const list = await db.query<BoardRow>(
          `${base}
           SELECT r.account_id, r.score, r.days, r.rank, u.username, u.avatar_hash
             FROM ranked r JOIN users u ON u.id = r.account_id
            WHERE u.leaderboard_opt_in = true AND u.disabled_at IS NULL
              AND ${KEYSET('$1', '$2')}
            ORDER BY r.score DESC, r.account_id ASC
            LIMIT $3`,
          [cursorScore, cursorId, limit + 1],
        );
        fetched = list.rows;

        const me = await db.query<MeRow>(
          `${base} SELECT rank, score, days FROM ranked WHERE account_id = $1`,
          [auth.accountId],
        );
        meRow = me.rows[0] ?? null;
        computedAt = new Date().toISOString();
      } else {
        // 带过滤（daily/weekly/monthly/yearly/alltime）：challenge_questions 逐题求和
        //（§7.3「只改变分数口径」）；窗口来自 periodWindow（alltime 带过滤 = null/null 全时段）
        const from = window.from;
        const to = window.to;
        // 防御兜底：非 alltime 的期窗口不可能为 null（绝不静默全时段）
        if (period !== 'alltime' && (from === null || to === null)) {
          throw appError('INTERNAL', `period window missing for period=${period}`);
        }
        const base = `WITH per_day AS (
                        SELECT cq.account_id AS account_id, cq.date_key AS date_key,
                               SUM(cq.points)::int AS day_score
                          FROM challenge_questions cq
                         WHERE ($1::date IS NULL OR cq.date_key BETWEEN $1::date AND $2::date)
                           AND ($3::text IS NULL OR cq.lang = $3)
                           AND ($4::text IS NULL OR cq.difficulty = $4)
                         GROUP BY cq.account_id, cq.date_key
                        HAVING SUM(cq.points) > 0
                      ),
                      scored AS (
                        SELECT account_id, SUM(day_score)::int AS score, count(*)::int AS days
                          FROM per_day GROUP BY account_id
                      ),
                      ranked AS (
                        SELECT s.account_id, s.score, s.days,
                               rank() OVER (ORDER BY s.score DESC) AS rank
                          FROM scored s JOIN users u ON u.id = s.account_id
                         WHERE u.disabled_at IS NULL
                      )`;
        const list = await db.query<BoardRow>(
          `${base}
           SELECT r.account_id, r.score, r.days, r.rank, u.username, u.avatar_hash
             FROM ranked r JOIN users u ON u.id = r.account_id
            WHERE u.leaderboard_opt_in = true AND u.disabled_at IS NULL
              AND ${KEYSET('$5', '$6')}
            ORDER BY r.score DESC, r.account_id ASC
            LIMIT $7`,
          [from, to, lang ?? null, difficulty ?? null, cursorScore, cursorId, limit + 1],
        );
        fetched = list.rows;

        const me = await db.query<MeRow>(
          `${base} SELECT rank, score, days FROM ranked WHERE account_id = $5`,
          [from, to, lang ?? null, difficulty ?? null, auth.accountId],
        );
        meRow = me.rows[0] ?? null;
        computedAt = new Date().toISOString();
      }

      // ---- me 的其余三件（永远返回，§4.5）----
      const opt = await db.query<{ leaderboard_opt_in: boolean }>(
        `SELECT leaderboard_opt_in FROM users WHERE id = $1`,
        [auth.accountId],
      );
      const today = await db.query<{ score: number | string }>(
        `SELECT score FROM challenge_days WHERE account_id = $1 AND date_key = $2::date`,
        [auth.accountId, clientDayKey],
      );

      const hasMore = fetched.length > limit;
      const rows = hasMore ? fetched.slice(0, limit) : fetched;
      const last = hasMore ? rows[rows.length - 1]! : null;

      // ---- entries 的 langs（口径见 entrySchema.langs；窗口与分数窗口同源，一步一次查询）----
      const langsByAccount = await loadLangs(
        db,
        rows.map((row) => row.account_id),
        window,
      );

      return {
        period,
        periodKey,
        filter: { lang: lang ?? null, difficulty: difficulty ?? null },
        entries: rows.map((row) => ({
          rank: num(row.rank),
          username: row.username,
          avatarHash: row.avatar_hash,
          score: num(row.score),
          days: num(row.days),
          langs: langsByAccount.get(row.account_id) ?? [],
        })),
        me: {
          rank: meRow === null ? null : num(meRow.rank),
          score: meRow === null ? 0 : num(meRow.score),
          optedIn: opt.rows[0]?.leaderboard_opt_in ?? false,
          scoreToday: today.rows[0] ? num(today.rows[0].score) : 0,
        },
        computedAt,
        nextCursor:
          last === null ? null : encodeLeaderboardCursor(num(last.score), last.account_id),
      };
    },
  );
}
