/**
 * 大白饭流水镜像账（docs/26 §4.6 + §6）。服务端角色 = 镜像账 + 闸：不发饭、不消费、不惩罚。
 *
 *  - POST /v1/rice/entries：批量幂等上行。逐条处置（**不做整批失败**，HTTP 恒 200）：
 *      同键已存在 → **先认账**（同内容 → duplicated；异内容 → 409，见下）；新条目才过
 *      窗口/日上限等状态闸，不过 → rejected[]（带 code+detail）。重放绝不误报拒绝
 *      （2026-10-14 修·#7：状态闸曾先于幂等检查，丢响应后的原样重试会被误判）。
 *      唯一整批失败：同 entry_key 不同内容 → 409 ENTRY_CONFLICT（明文规则，见 §8.4）。
 *  - GET /v1/rice/entries?since&limit：seq 增量下行 + 余额快照。
 *
 * 四层防刷（§6.4）：① PK 幂等；② 6 次/时 + ≤200 条/次 + ≤1000 条/日；③ dayKey ±1 天窗口（拒）与
 * 时钟异常（flag 照收）；④ kind 日上限（rejected[]）+ run 指纹复用（flag）。
 *
 * 余额 = `clamp(SUM(delta), 0, 999)` 全量重算落 rice_balances（§6.3④：任何时刻可重算，
 * 顺序无关）。并发安全靠事务开头对余额行 `SELECT … FOR UPDATE` 串行化同账号推送
 * （2026-10-14 修·#10：READ COMMITTED 下重算的 EXCLUDED 来自阻塞前快照，同账号并发会
 * 用旧和覆盖新和 → 丢账；先拿锁后重算的快照必然含此前所有已提交条目）。
 */
import { z } from 'zod';
import type { Queryable } from '../db/pool.js';
import { appError } from '../lib/errors.js';
import { serverDayKey, startOfServerDayMs } from '../lib/daykey.js';
import {
  RICE_FLAG_CLOCK_SKEW,
  RICE_FLAG_FINGERPRINT_REUSE,
  checkDayKeyWindow,
  clockLookbackFloor,
  dailyCapOf,
  installIdOfEntryKey,
  isClockAhead,
  isClockBackwards,
  validateEntryShape,
  type RiceEntryInput,
} from '../lib/rice-rules.js';
import { canonicalJson, num, parseSaneTimestamp, toIso } from '../lib/util.js';
import {
  RATE_LIMITS,
  RICE_ENTRY_KEY_MAX_LENGTH,
  RICE_ENTRY_KEY_MIN_LENGTH,
  RICE_LEDGER_KINDS,
  RICE_PULL_LIMIT_MAX,
} from '../protocol.js';
import { requireAuth } from '../plugins/auth.js';
import { enforceRateLimit } from '../plugins/rate-limit.js';
import { takeApiRate, type AppInstance, type SharedDeps } from '../plugins/shared.js';

/** 路由级 bodyLimit：200 条 × 每条约 200B（含 ref）+ 余量；超出运输层直接 413 */
const RICE_BODY_LIMIT = 256 * 1024;

const riceEntrySchema = z.object({
  entryKey: z.string().min(RICE_ENTRY_KEY_MIN_LENGTH).max(RICE_ENTRY_KEY_MAX_LENGTH),
  kind: z.enum(RICE_LEDGER_KINDS),
  delta: z.number().int().min(-999).max(999),
  dayKey: z.string(),
  at: z.iso.datetime({ offset: true }),
  ref: z.record(z.string(), z.unknown()).nullable().default(null),
});

const pushBodySchema = z.object({
  installId: z.uuid(),
  // 协议硬顶（zod 静态取真源常量）；env 若收紧，路由层再按 rates 判 400
  entries: z.array(riceEntrySchema).min(1).max(RATE_LIMITS.riceEntriesPerPush),
});

const rejectedSchema = z.object({
  entryKey: z.string(),
  code: z.string(),
  detail: z.string(),
});

const pushResponseSchema = z.object({
  accepted: z.number(),
  duplicated: z.number(),
  rejected: z.array(rejectedSchema),
  balance: z.number(),
  earnedTotal: z.number(),
  spentTotal: z.number(),
});

const pullQuerySchema = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(RICE_PULL_LIMIT_MAX).default(RICE_PULL_LIMIT_MAX),
});

const pullResponseSchema = z.object({
  entries: z.array(
    z.object({
      seq: z.number(),
      entryKey: z.string(),
      kind: z.string(),
      delta: z.number(),
      dayKey: z.string(),
      at: z.string(),
      ref: z.record(z.string(), z.unknown()).nullable(),
      flags: z.array(z.string()),
    }),
  ),
  nextSeq: z.number(),
  balance: z.number(),
});

interface LedgerRow {
  kind: string;
  delta: number | string;
  day_key: string;
  at: Date | string;
  ref: Record<string, unknown> | null;
}

/** 同键已存在行的内容对拍（kind/delta/dayKey/at/ref 全等才叫「重放」，否则 ENTRY_CONFLICT） */
async function loadExistingEntry(
  tx: Queryable,
  accountId: string,
  entryKey: string,
): Promise<LedgerRow | null> {
  const { rows } = await tx.query<LedgerRow>(
    `SELECT kind, delta, to_char(day_key, 'YYYY-MM-DD') AS day_key, at, ref
       FROM rice_ledger WHERE account_id = $1 AND entry_key = $2`,
    [accountId, entryKey],
  );
  return rows[0] ?? null;
}

/**
 * 同键已存在行的内容对拍：全等才叫「重放」（调用方记 duplicated），否则 ENTRY_CONFLICT
 * 整批 409 —— 该结论**无条件**（docs/26 §8.4：不因额度/窗口等任何状态改变）。
 * 两处共用：循环顶的「先认账」（重放主路径）与 INSERT 冲突分支（真并发后备）——
 * 同一条规则不许有两个手抄本，否则日后只改一处就是分裂。
 */
function assertSameContent(existingRow: LedgerRow, e: RiceEntryInput, atMs: number, entryKey: string): void {
  const sameContent =
    existingRow.kind === e.kind &&
    num(existingRow.delta) === e.delta &&
    existingRow.day_key === e.dayKey &&
    Date.parse(toIso(existingRow.at)) === atMs &&
    canonicalJson(existingRow.ref ?? null) === canonicalJson(e.ref ?? null);
  if (!sameContent) {
    throw appError('ENTRY_CONFLICT', 'entry key was reused with different content', {
      details: { entryKey },
    });
  }
}

async function countCapUsed(
  tx: Queryable,
  accountId: string,
  dayKey: string,
  kind: string,
): Promise<number> {
  const { rows } = await tx.query<{ n: number | string }>(
    `SELECT count(*)::int AS n FROM rice_ledger
      WHERE account_id = $1 AND day_key = $2::date AND kind = $3`,
    [accountId, dayKey, kind],
  );
  return num(rows[0]!.n);
}

/** 同 installId 近 2 天的最大 at（时钟倒退判据的回看窗） */
async function loadRecentMaxAt(
  tx: Queryable,
  accountId: string,
  installId: string,
  nowMs: number,
): Promise<number | null> {
  const { rows } = await tx.query<{ m: Date | string | null }>(
    `SELECT MAX(at) AS m FROM rice_ledger
      WHERE account_id = $1 AND left(entry_key, 36) = $2 AND at > $3::timestamptz`,
    [accountId, installId, clockLookbackFloor(nowMs)],
  );
  const m = rows[0]?.m;
  if (m === null || m === undefined) return null;
  return Date.parse(toIso(m));
}

async function loadExistingAdoptInstalls(tx: Queryable, accountId: string): Promise<Set<string>> {
  const { rows } = await tx.query<{ install_id: string | null }>(
    `SELECT DISTINCT ref->>'installId' AS install_id
       FROM rice_ledger WHERE account_id = $1 AND kind = 'adopt'`,
    [accountId],
  );
  const set = new Set<string>();
  for (const row of rows) if (row.install_id) set.add(row.install_id);
  return set;
}

async function runFingerprintExists(
  tx: Queryable,
  accountId: string,
  fingerprint: string,
  exceptEntryKey: string,
): Promise<boolean> {
  const { rows } = await tx.query(
    `SELECT 1 FROM rice_ledger
      WHERE account_id = $1 AND kind = 'run' AND ref->>'fingerprint' = $2 AND entry_key <> $3
      LIMIT 1`,
    [accountId, fingerprint, exceptEntryKey],
  );
  return rows.length > 0;
}

export function riceRoutes(app: AppInstance, deps: SharedDeps): void {
  const { db, rates, limiter } = deps;

  app.post(
    '/v1/rice/entries',
    {
      preHandler: app.authenticate,
      bodyLimit: RICE_BODY_LIMIT,
      schema: {
        body: pushBodySchema,
        response: { 200: pushResponseSchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      takeApiRate(deps, request);
      const nowMs = Date.now();
      const entries = request.body.entries;

      // ② 限速：6 次/时/账号（含重放请求——文档把它定义为「批量频率」）
      enforceRateLimit(limiter, {
        key: `rice|a:${auth.accountId}`,
        limit: rates.ricePushPerHourPerAccount,
        windowMs: 3_600_000,
        message: 'too many rice pushes this hour',
      });
      if (entries.length > rates.riceEntriesPerPush) {
        // 形状问题：重试同一个过大批次永远不会成功 → 400（不让客户端按退避语义空转）
        throw appError('VALIDATION_FAILED', `batch exceeds the per-push limit of ${rates.riceEntriesPerPush}`, {
          details: { received: entries.length },
        });
      }

      // ① 形状/白名单：违反即整批 400（客户端在说另一种语言）
      for (const entry of entries) {
        const shapeError = validateEntryShape(entry as RiceEntryInput);
        if (shapeError) {
          throw appError('VALIDATION_FAILED', shapeError, { details: { entryKey: entry.entryKey } });
        }
      }

      // ② 日条数：≤1000 条/日/账号（服务器北京日、created_at 口径）。跨线即 429，退避到下一个北京日。
      const dayStartMs = startOfServerDayMs(new Date(nowMs));
      const { rows: countRows } = await db.query<{ n: number | string }>(
        `SELECT count(*)::int AS n FROM rice_ledger
          WHERE account_id = $1 AND created_at >= $2::timestamptz`,
        [auth.accountId, new Date(dayStartMs).toISOString()],
      );
      const todayCount = num(countRows[0]!.n);
      if (todayCount + entries.length > rates.riceEntriesPerDayPerAccount) {
        throw appError('RATE_LIMITED', 'daily rice entry quota exceeded', {
          retryAfterMs: dayStartMs + 86_400_000 - nowMs,
        });
      }

      const serverDay = serverDayKey(new Date(nowMs));

      return await db.withTransaction(async (tx) => {
        let accepted = 0;
        let duplicated = 0;
        const rejected: Array<{ entryKey: string; code: string; detail: string }> = [];

        // ⓪ 同账号推送串行化（2026-10-14 修·#10）：事务**开头**先把本账号的余额行锁住。
        // 【为什么】余额重算是一条 INSERT..SELECT..ON CONFLICT DO UPDATE：READ COMMITTED 下
        // 两个同账号事务交错时，后到者的重算语句在**被锁阻塞之前**就按当时快照算好 EXCLUDED
        // （看不见先到者未提交的账），等锁释放后用陈旧的和盖掉先到者的正确余额——账本有、
        // 余额少，丢账且静默。先拿锁 ⇒ 重算语句的快照必然包含此前所有已提交的账。
        // 代价 = 同账号 push 串行化（限速 6 次/时/账号，可忽略）。
        // 【硬约束】① 这两条必须在重算语句**之前**；② 种子行先补上（余额行可能尚不存在，
        // 无行可锁；balance 列无 DEFAULT，显式 0）；③ 事务中间不得再取其它行锁造成锁序
        // 反转——现有事务体只插 rice_ledger 新行（无既有行锁）＋重算本行，不存在环。
        await tx.query(
          `INSERT INTO rice_balances (account_id, balance, earned_total, spent_total, last_seq, updated_at)
           VALUES ($1, 0, 0, 0, 0, now())
           ON CONFLICT (account_id) DO NOTHING`,
          [auth.accountId],
        );
        await tx.query(`SELECT balance FROM rice_balances WHERE account_id = $1 FOR UPDATE`, [auth.accountId]);

        const capUsed = new Map<string, number>(); // `${dayKey}|${kind}` → 已用条数
        const installMaxAt = new Map<string, number | null>();
        const adoptSeenInBatch = new Set<string>();
        const adoptExisting = await loadExistingAdoptInstalls(tx, auth.accountId);
        const fingerprintSeenInBatch = new Set<string>();

        for (const entry of entries) {
          const e = entry as RiceEntryInput;
          const entryKey = e.entryKey;
          const atMs = parseSaneTimestamp(e.at)!; // 形状闸（事务外 validateEntryShape）已保证非空

          // ②′ 幂等优先（2026-10-14 修·#7）：同键已存在 → 先认账，**再谈其它**。
          // 【为什么必须最先判】重放的是「已经入过账的事实」，它的合法性在首次入账那一刻
          // 已裁定；拿今天的窗口/额度再裁一次，客户端丢响应后的原样重试就会被误报成
          // VALIDATION_FAILED（跨日重放）或 OVER_DAILY_CAP（满额日重放）—— 条目明明在账里，
          // 客户端却被告知没入账。同键异内容仍 409（assertSameContent，无条件）。
          const replayRow = await loadExistingEntry(tx, auth.accountId, entryKey);
          if (replayRow) {
            assertSameContent(replayRow, e, atMs, entryKey);
            duplicated += 1;
            continue;
          }

          // ③ 记账窗口：dayKey 与服务器日差 > 1 天 → 拒（逐条进 rejected[]）
          const windowError = checkDayKeyWindow(e, serverDay);
          if (windowError) {
            rejected.push({ entryKey, code: 'VALIDATION_FAILED', detail: windowError });
            continue;
          }

          const installId = installIdOfEntryKey(entryKey);

          // ④-а adopt 唯一性：每 (account, installId) 至多一条（「必须最早」是客户端账本不变式，见 rice-rules.ts）
          const adoptInstallId = e.kind === 'adopt' ? (e.ref?.installId as string) : null;
          if (adoptInstallId !== null) {
            if (adoptExisting.has(adoptInstallId) || adoptSeenInBatch.has(adoptInstallId)) {
              rejected.push({
                entryKey,
                code: 'VALIDATION_FAILED',
                detail: 'adopt already recorded for this installId',
              });
              continue;
            }
          }

          // ④-b kind 日上限（adopt 无上限）
          const cap = dailyCapOf(e.kind);
          let capKey: string | null = null;
          if (cap !== null) {
            capKey = `${e.dayKey}|${e.kind}`;
            let used = capUsed.get(capKey);
            if (used === undefined) {
              used = await countCapUsed(tx, auth.accountId, e.dayKey, e.kind);
              capUsed.set(capKey, used);
            }
            if (used >= cap) {
              rejected.push({ entryKey, code: 'OVER_DAILY_CAP', detail: `${e.kind} <= ${cap}/day` });
              continue;
            }
            capUsed.set(capKey, used + 1);
          }

          // ③ 时钟偏移（flag 照收）
          const flags: string[] = [];
          if (!installMaxAt.has(installId)) {
            installMaxAt.set(installId, await loadRecentMaxAt(tx, auth.accountId, installId, nowMs));
          }
          const recentMaxAt = installMaxAt.get(installId) ?? null;
          if (isClockAhead(e.at, nowMs) || isClockBackwards(e.at, recentMaxAt, nowMs)) {
            flags.push(RICE_FLAG_CLOCK_SKEW);
          }
          if (recentMaxAt === null || atMs > recentMaxAt) installMaxAt.set(installId, atMs);

          // ④-c run 指纹复用（flag 照收：客户端指纹账只有 80 槽，翻旧条目属可疑不属违规）
          if (e.kind === 'run') {
            const fingerprint = e.ref?.fingerprint as string;
            if (
              fingerprintSeenInBatch.has(fingerprint) ||
              (await runFingerprintExists(tx, auth.accountId, fingerprint, entryKey))
            ) {
              flags.push(RICE_FLAG_FINGERPRINT_REUSE);
            }
            fingerprintSeenInBatch.add(fingerprint);
          }

          const inserted = await tx.query<{ seq: number | string }>(
            `INSERT INTO rice_ledger (account_id, entry_key, kind, delta, day_key, at, ref, flags)
             VALUES ($1, $2, $3, $4, $5::date, $6::timestamptz, $7::jsonb, $8)
             ON CONFLICT (account_id, entry_key) DO NOTHING
             RETURNING seq`,
            [
              auth.accountId,
              entryKey,
              e.kind,
              e.delta,
              e.dayKey,
              e.at,
              e.ref === null ? null : JSON.stringify(e.ref),
              flags,
            ],
          );

          if (inserted.rows.length === 1) {
            accepted += 1;
            if (adoptInstallId !== null) adoptSeenInBatch.add(adoptInstallId);
            continue;
          }

          // 同键已存在（并发后备路径）：循环顶查过、这里又撞上 ⇒ 两条并发 push 同键竞态，
          // 一边先插成功，另一边落到这里。内容对拍走同一个 assertSameContent，结论一致：
          // 全等 → duplicated（把前面预占的日上限额度还回去）；不全等 → 409 整批。
          const raceRow = await loadExistingEntry(tx, auth.accountId, entryKey);
          if (!raceRow) {
            throw appError('INTERNAL', 'rice entry row disappeared during push');
          }
          assertSameContent(raceRow, e, atMs, entryKey);
          if (capKey !== null) {
            // 重复条目本来就计入 DB 计数——把刚才预占的上限额度还回去
            capUsed.set(capKey, capUsed.get(capKey)! - 1);
          }
          duplicated += 1;
        }

        // 余额全量重算（§6.3④）：clamp(SUM(delta),0,999) 落派生缓存
        const { rows: balanceRows } = await tx.query<{
          balance: number | string;
          earned_total: number | string;
          spent_total: number | string;
        }>(
          `INSERT INTO rice_balances (account_id, balance, earned_total, spent_total, last_seq, updated_at)
           SELECT $1::uuid,
                  LEAST(GREATEST(COALESCE(SUM(delta), 0), 0), 999),
                  COALESCE(SUM(delta) FILTER (WHERE delta > 0), 0),
                  COALESCE(-SUM(delta) FILTER (WHERE delta < 0), 0),
                  COALESCE(MAX(seq), 0),
                  now()
             FROM rice_ledger
            WHERE account_id = $1::uuid
           ON CONFLICT (account_id) DO UPDATE
              SET balance = EXCLUDED.balance,
                  earned_total = EXCLUDED.earned_total,
                  spent_total = EXCLUDED.spent_total,
                  last_seq = EXCLUDED.last_seq,
                  updated_at = now()
           RETURNING balance, earned_total, spent_total`,
          [auth.accountId],
        );
        const balanceRow = balanceRows[0]!;

        return {
          accepted,
          duplicated,
          rejected,
          balance: num(balanceRow.balance),
          earnedTotal: num(balanceRow.earned_total),
          spentTotal: num(balanceRow.spent_total),
        };
      });
    },
  );

  app.get(
    '/v1/rice/entries',
    {
      preHandler: app.authenticate,
      schema: {
        querystring: pullQuerySchema,
        response: { 200: pullResponseSchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      takeApiRate(deps, request);
      const { since, limit } = request.query;

      const { rows } = await db.query<{
        seq: number | string;
        entry_key: string;
        kind: string;
        delta: number | string;
        day_key: string;
        at: Date | string;
        ref: Record<string, unknown> | null;
        flags: string[];
      }>(
        `SELECT seq, entry_key, kind, delta, to_char(day_key, 'YYYY-MM-DD') AS day_key, at, ref, flags
           FROM rice_ledger
          WHERE account_id = $1 AND seq > $2
          ORDER BY seq ASC
          LIMIT $3`,
        [auth.accountId, since, limit],
      );

      const { rows: balanceRows } = await db.query<{ balance: number | string }>(
        `SELECT balance FROM rice_balances WHERE account_id = $1`,
        [auth.accountId],
      );
      const balance = balanceRows[0] ? num(balanceRows[0].balance) : 0;

      const lastSeq = rows.length > 0 ? num(rows[rows.length - 1]!.seq) : since;
      return {
        entries: rows.map((row) => ({
          seq: num(row.seq),
          entryKey: row.entry_key,
          kind: row.kind,
          delta: num(row.delta),
          dayKey: row.day_key,
          at: toIso(row.at),
          ref: row.ref,
          flags: row.flags,
        })),
        nextSeq: lastSeq,
        balance,
      };
    },
  );
}
