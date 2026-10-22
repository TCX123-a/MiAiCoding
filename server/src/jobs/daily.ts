/**
 * 每日任务（docs/26 §3.3/§3.5/§6.3④/§6.4④ + docs/22 §5.7；cron 北京 00:05，早于 00:17 备份）。
 *
 * 五件事，同一事务：
 *  ① 榜单快照**重铸**（§3.5；2026-10-10 改版补 monthly/yearly，与前端五页签对齐）：
 *     - daily =「刚结束的一天」（北京服务器日 −1）；
 *     - weekly = 含该日的 ISO 周（周一那次任务正好把上一周全量铸终稿）；
 *     - monthly / yearly = 含该日的自然月 / 自然年（每月 1 号那次任务把上月末铸终稿，
 *       每年 1 月 1 号那次把上一年末铸终稿）——语义同「含该日」，与 weekly 的既有模式一致。
 *     口径：全部**未封禁且当期有分**的账号进快照（**含未 opt-in**——me 的名次从快照读，
 *     opt-in 只是读侧的曝光开关）；rank() 并列同名次（competition ranking）；
 *     days = 期内有结算的天数（含 0 分结算日）；写入 = 整期 DELETE + INSERT（真·重铸）。
 *  ② user_days / user_stats 全量重算（§3.3「派生可弃可重算」）：
 *     来源 = user_docs（profile.history → 按日学习标记；practice.history → 按日会话/答题）
 *          + challenge_days（按日 score；user_stats.total_score 对账，不一致即覆盖）。
 *  ③ rice_balances 对账（§6.3④）：全量 `clamp(SUM(delta),0,999)` 重算，不一致/缺行即修复。
 *  ④ 交叉核对（§6.4④）：lesson 流水条数 > profile.history 标记数 = 结构性不可能（条目只增、
 *     标记只增，取消学习不撤回条目）→ 记名留痕（见下方「口径裁定④」）。
 *  ⑤ 清理（docs/22 §5.7）：24h 墓碑、过期会话、90 天审计。
 *
 * 口径裁定（登记进《后端开发进度清单》）：
 *  ① `user_days.learned`：v2 profile 只有 history.finishedAt（无 learnedAt、无取消时间线），
 *     docs 写的「净增」不可还原 → 落**当日新增学习标记数**（history 按北京日分桶）；
 *     `user_stats.learned_count` 仍取 `profile.learned.length`（精确口径不变）。
 *  ② practice 会话归日按 `at` 的 **北京日期**（与客户端日界一致，不再有 ±1 天错位）；
 *     `at` 不健全的会话计入 practiced_count，但不进任何一天的桶。
 *  ③ streak：有 user_days 行 = 当日有动作（含 0 分结算的挑战日）；连续段终点须 ≥ 服务器日 −1，
 *     否则断档归零（时间锚用北京服务器日，与客户端日界同源）。
 *  ④ §6.3④ 的「审计行」落点：auth_audit 白名单冻结 11 类**认证**事件（0001 CHECK，docs/22 §4.2），
 *     不含对账类事件；为不动冻结 CHECK，对账留痕 = warn 日志 + 任务报告（如需落表走新迁移裁定）。
 *  ⑤ 读源（user_docs / challenge_days 聚合）在事务**外**：任务期间的新同步/新结算下一晚收敛，
 *     不阻塞写路径（几十用户的量级，可接受）。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadConfig } from '../config.js';
import { asDb, createPool, type Db, type Queryable } from '../db/pool.js';
import {
  diffDays,
  isValidDateKey,
  isoMonthRange,
  isoWeekKey,
  isoWeekRange,
  isoYearRange,
  parseDateKey,
  serverDayKey,
  serverMonthKey,
  serverYearKey,
  shiftDayKey,
} from '../lib/daykey.js';
import { num, parseSaneTimestamp } from '../lib/util.js';

/** smallint 上界（user_days 的 learned/practiced/correct/total 都是 smallint） */
const SMALLINT_MAX = 32_767;

/** 多行 INSERT 的分块大小（7 列 × 500 行 = 3500 参数，远低于 65535 上限） */
const INSERT_CHUNK = 500;

export interface JobLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

const NOOP_LOGGER: JobLogger = { info: () => {}, warn: () => {} };

export interface DailyJobOptions {
  /** 基准时刻（默认 new Date()）；测试注入假时钟用 */
  now?: Date;
  /** 覆盖「刚结束的一天」（默认 = 服务器日 − 1）；仅手动回填用 */
  referenceDay?: string;
  logger?: JobLogger;
}

export interface DailyJobReport {
  ranAt: string;
  serverToday: string;
  referenceDay: string;
  weekKey: string;
  monthKey: string;
  yearKey: string;
  snapshots: { daily: number; weekly: number; monthly: number; yearly: number };
  progress: { accounts: number; userDayRows: number; malformedEntries: number };
  userStats: { accounts: number; totalScoreRepaired: string[] };
  rice: { repaired: string[]; insertedMissing: string[] };
  crossChecks: {
    lessonDivergence: Array<{
      accountId: string;
      lessonEntries: number;
      learnMarks: number;
      learnedCount: number;
    }>;
  };
  cleanup: { tombstones: number; expiredSessions: number; auditRows: number };
}

// ---------------------------------------------------------------- 文档派生（纯函数区）

interface DayCell {
  learned: number;
  practiced: number;
  correct: number;
  total: number;
  score: number;
}

interface DocDayCell {
  learned: number;
  practiced: number;
  correct: number;
  total: number;
}

interface DocsDerived {
  /** profile.learned.length（精确） */
  learnedCount: number;
  /** profile.history 中时间戳健全的标记数（交叉核对的「事件」上界之一） */
  learnedMarks: number;
  /** profile.history 中形状/时间戳坏了而丢掉的条数（它们同样是「发生过的事件」） */
  droppedMarks: number;
  /** practice.history 中为对象的会话数（practiced_count 的口径） */
  sessionCount: number;
  /** practice 会话 at 不健全、进不了按日桶的条数 */
  droppedSessions: number;
  days: Map<string, DocDayCell>;
}

function newDocsDerived(): DocsDerived {
  return {
    learnedCount: 0,
    learnedMarks: 0,
    droppedMarks: 0,
    sessionCount: 0,
    droppedSessions: 0,
    days: new Map(),
  };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** 时间戳 → **北京**日期键；形状/健全域不过 → null（沿用 parseSaneTimestamp 的 [1900,2100) 域）。 */
function dayOfTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const ms = parseSaneTimestamp(value);
  if (ms === null) return null;
  return serverDayKey(new Date(ms));
}

function docsCellOf(target: DocsDerived, day: string): DocDayCell {
  let cell = target.days.get(day);
  if (cell === undefined) {
    cell = { learned: 0, practiced: 0, correct: 0, total: 0 };
    target.days.set(day, cell);
  }
  return cell;
}

/**
 * 把一份文档（profile / practice）的派生量累加进 target。
 * **不抛**：一份坏文档不该让整晚任务回滚——坏条目只进 dropped* 计数。
 */
export function accumulateDocs(
  target: DocsDerived,
  docType: 'profile' | 'practice',
  payload: unknown,
): void {
  const root = asRecord(payload);
  if (root === null) return;

  if (docType === 'profile') {
    if (Array.isArray(root.learned)) {
      target.learnedCount = root.learned.filter((x) => typeof x === 'string').length;
    }
    if (Array.isArray(root.history)) {
      for (const raw of root.history) {
        const item = asRecord(raw);
        if (item === null || typeof item.lessonId !== 'string' || item.lessonId === '') {
          target.droppedMarks += 1;
          continue;
        }
        const day = dayOfTimestamp(item.finishedAt);
        if (day === null) {
          target.droppedMarks += 1;
          continue;
        }
        target.learnedMarks += 1;
        docsCellOf(target, day).learned += 1;
      }
    }
    return;
  }

  if (Array.isArray(root.history)) {
    for (const raw of root.history) {
      const session = asRecord(raw);
      if (session === null) continue; // 非对象条目：形状层垃圾，连会话都不算
      target.sessionCount += 1;
      const day = dayOfTimestamp(session.at);
      if (day === null) {
        target.droppedSessions += 1;
        continue;
      }
      const cell = docsCellOf(target, day);
      cell.practiced += 1;
      if (Array.isArray(session.items)) {
        for (const rawItem of session.items) {
          const item = asRecord(rawItem);
          if (item === null) continue;
          cell.total += 1;
          if (item.ok === true) cell.correct += 1;
        }
      }
    }
  }
}

// ---------------------------------------------------------------- 任务主体

interface ChallengeDayRow {
  account_id: string;
  day_key: string;
  score: number | string;
}

interface StatsRow {
  account_id: string;
  total_score: number | string;
}

interface DocRow {
  account_id: string;
  doc_type: string;
  payload: unknown;
}

/** 连续学习天数：有动作的日在 last 处往前连成段；last 早于「服务器日 −1」即断档归零。 */
function computeStreak(sortedDays: string[], serverToday: string): number {
  if (sortedDays.length === 0) return 0;
  const last = sortedDays[sortedDays.length - 1]!;
  if (diffDays(serverToday, last) > 1) return 0;
  let streak = 1;
  for (let i = sortedDays.length - 1; i > 0; i -= 1) {
    if (diffDays(sortedDays[i]!, sortedDays[i - 1]!) === 1) streak += 1;
    else break;
  }
  return streak;
}

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 行数 = INSERT … RETURNING 的行数（跨 pg / PGlite 的通用数法） */
function countReturned(rows: unknown[]): number {
  return rows.length;
}

export async function runDailyJob(db: Db, options: DailyJobOptions = {}): Promise<DailyJobReport> {
  const now = options.now ?? new Date();
  const log = options.logger ?? NOOP_LOGGER;
  const serverToday = serverDayKey(now);
  const referenceDay = options.referenceDay ?? shiftDayKey(serverToday, -1);
  if (!isValidDateKey(referenceDay)) {
    throw new Error(`referenceDay 不是真实日期：${referenceDay}`);
  }
  const anchor = parseDateKey(referenceDay)!;
  const weekKey = isoWeekKey(anchor);
  const weekRange = isoWeekRange(weekKey)!;
  const monthKey = serverMonthKey(referenceDay);
  const monthRange = isoMonthRange(monthKey)!;
  const yearKey = serverYearKey(referenceDay);
  const yearRange = isoYearRange(yearKey)!;

  // ---- 读源（事务外，见文件头口径裁定⑤）----
  const docRows = (
    await db.query<DocRow>(
      `SELECT account_id::text AS account_id, doc_type, payload
         FROM user_docs
        WHERE doc_type IN ('profile', 'practice')`,
    )
  ).rows;

  const derived = new Map<string, DocsDerived>();
  const hasProfile = new Set<string>();
  for (const row of docRows) {
    if (row.doc_type !== 'profile' && row.doc_type !== 'practice') continue;
    if (row.doc_type === 'profile') hasProfile.add(row.account_id);
    let target = derived.get(row.account_id);
    if (target === undefined) {
      target = newDocsDerived();
      derived.set(row.account_id, target);
    }
    accumulateDocs(target, row.doc_type, row.payload);
  }

  const challengeRows = (
    await db.query<ChallengeDayRow>(
      `SELECT account_id::text AS account_id,
              to_char(date_key, 'YYYY-MM-DD') AS day_key,
              SUM(score)::int AS score
         FROM challenge_days
        GROUP BY account_id, date_key`,
    )
  ).rows;

  const statsRows = (
    await db.query<StatsRow>(`SELECT account_id::text AS account_id, total_score FROM user_stats`)
  ).rows;
  const existingTotals = new Map<string, number>(
    statsRows.map((row) => [row.account_id, num(row.total_score)]),
  );

  // ---- 合并成「账号 → 日」的派生网格 ----
  const grid = new Map<string, Map<string, DayCell>>();
  function gridCellOf(accountId: string, day: string): DayCell {
    let days = grid.get(accountId);
    if (days === undefined) {
      days = new Map();
      grid.set(accountId, days);
    }
    let cell = days.get(day);
    if (cell === undefined) {
      cell = { learned: 0, practiced: 0, correct: 0, total: 0, score: 0 };
      days.set(day, cell);
    }
    return cell;
  }

  let malformedEntries = 0;
  for (const [accountId, d] of derived) {
    malformedEntries += d.droppedMarks + d.droppedSessions;
    for (const [day, c] of d.days) {
      const cell = gridCellOf(accountId, day);
      cell.learned += c.learned;
      cell.practiced += c.practiced;
      cell.correct += c.correct;
      cell.total += c.total;
    }
  }
  for (const row of challengeRows) {
    gridCellOf(row.account_id, row.day_key).score += num(row.score);
  }

  // user_stats 的作用域 = 有文档 / 有挑战 / 已有 stats 行的账号（其余无事可记，不无中生有建行）
  const statAccounts = new Set<string>([
    ...derived.keys(),
    ...grid.keys(),
    ...existingTotals.keys(),
  ]);

  // ---- 一个事务做完 ①~⑤ ----
  const txResult = await db.withTransaction(async (tx: Queryable) => {
    // ①a daily 快照重铸
    await tx.query(`DELETE FROM leaderboard_snapshots WHERE period = 'daily' AND period_key = $1`, [
      referenceDay,
    ]);
    const dailyRows = (
      await tx.query(
        `INSERT INTO leaderboard_snapshots (period, period_key, account_id, score, rank, days, computed_at)
         SELECT 'daily', $1::text, cd.account_id, cd.score,
                rank() OVER (ORDER BY cd.score DESC), 1, now()
           FROM challenge_days cd
           JOIN users u ON u.id = cd.account_id
          WHERE cd.date_key = $2::date AND cd.score > 0 AND u.disabled_at IS NULL
         RETURNING 1 AS one`,
        [referenceDay, referenceDay],
      )
    ).rows;

    // ①b weekly / ①c monthly / ①d yearly 快照重铸（含 referenceDay 的 ISO 周 / 自然月 / 自然年）
    // 三段同款口径（周一时 weekly 即上一周终稿；每月 1 号 monthly 即上月终稿；每年 1 月 1 号 yearly
    // 即上一年终稿）：整期 DELETE + INSERT，SUM(score) 求期分、count(*) 求有结算的天数，
    // 含未 opt-in、排除封禁与零分。
    const reforgeRange = async (
      period: 'weekly' | 'monthly' | 'yearly',
      periodKey: string,
      from: string,
      to: string,
    ): Promise<unknown[]> => {
      await tx.query(`DELETE FROM leaderboard_snapshots WHERE period = $1 AND period_key = $2`, [
        period,
        periodKey,
      ]);
      const inserted = await tx.query(
        `INSERT INTO leaderboard_snapshots (period, period_key, account_id, score, rank, days, computed_at)
         SELECT $1::text, $2::text, s.account_id, s.score,
                rank() OVER (ORDER BY s.score DESC), s.days, now()
           FROM (
             SELECT cd.account_id,
                    SUM(cd.score)::int AS score,
                    count(*)::int AS days
               FROM challenge_days cd
               JOIN users u ON u.id = cd.account_id
              WHERE cd.date_key BETWEEN $3::date AND $4::date AND u.disabled_at IS NULL
              GROUP BY cd.account_id
             HAVING SUM(cd.score) > 0
           ) s
         RETURNING 1 AS one`,
        [period, periodKey, from, to],
      );
      return inserted.rows;
    };

    const weeklyRows = await reforgeRange('weekly', weekKey, weekRange.from, weekRange.to);
    const monthlyRows = await reforgeRange('monthly', monthKey, monthRange.from, monthRange.to);
    const yearlyRows = await reforgeRange('yearly', yearKey, yearRange.from, yearRange.to);

    // ②a user_days 全量重算
    await tx.query(`DELETE FROM user_days`);
    const dayRows: Array<[string, string, number, number, number, number, number]> = [];
    for (const [accountId, days] of grid) {
      for (const [day, cell] of days) {
        const total = Math.min(cell.total, SMALLINT_MAX);
        dayRows.push([
          accountId,
          day,
          Math.min(cell.learned, SMALLINT_MAX),
          Math.min(cell.practiced, SMALLINT_MAX),
          Math.min(cell.correct, total),
          total,
          cell.score,
        ]);
      }
    }
    for (const slice of chunked(dayRows, INSERT_CHUNK)) {
      const tuples = slice.map((_, idx) => {
        const b = idx * 7;
        return `($${b + 1}, $${b + 2}::date, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`;
      });
      await tx.query(
        `INSERT INTO user_days (account_id, day_key, learned, practiced, correct, total, score)
         VALUES ${tuples.join(', ')}`,
        slice.flat(),
      );
    }

    // ②b user_stats 重算（total_score 对账：不一致即覆盖）
    const totalScoreRepaired: string[] = [];
    const statValues: Array<[string, number, number, number, string | null, number]> = [];
    for (const accountId of statAccounts) {
      const d = derived.get(accountId);
      const days = grid.get(accountId);
      const sortedDays = days === undefined ? [] : [...days.keys()].sort();
      let totalScore = 0;
      if (days !== undefined) {
        for (const cell of days.values()) totalScore += cell.score;
      }
      const existing = existingTotals.get(accountId);
      if (existing !== undefined && existing !== totalScore) totalScoreRepaired.push(accountId);
      statValues.push([
        accountId,
        d?.learnedCount ?? 0,
        d?.sessionCount ?? 0,
        computeStreak(sortedDays, serverToday),
        sortedDays.length === 0 ? null : sortedDays[sortedDays.length - 1]!,
        totalScore,
      ]);
    }
    for (const slice of chunked(statValues, INSERT_CHUNK)) {
      const tuples = slice.map((_, idx) => {
        const b = idx * 6;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}::date, $${b + 6})`;
      });
      await tx.query(
        `INSERT INTO user_stats (account_id, learned_count, practiced_count, streak_days, last_active_day, total_score)
         VALUES ${tuples.join(', ')}
         ON CONFLICT (account_id) DO UPDATE
            SET learned_count = EXCLUDED.learned_count,
                practiced_count = EXCLUDED.practiced_count,
                streak_days = EXCLUDED.streak_days,
                last_active_day = EXCLUDED.last_active_day,
                total_score = EXCLUDED.total_score,
                updated_at = now()`,
        slice.flat(),
      );
    }

    // ③ rice_balances 对账（§6.3④）：派生真值一处定义，修复/补行共用
    const RICE_TRUTH = `SELECT account_id,
                               LEAST(GREATEST(COALESCE(SUM(delta), 0), 0), 999)::int AS balance,
                               COALESCE(SUM(delta) FILTER (WHERE delta > 0), 0) AS earned,
                               COALESCE(-SUM(delta) FILTER (WHERE delta < 0), 0) AS spent,
                               COALESCE(MAX(seq), 0) AS last_seq
                          FROM rice_ledger
                         GROUP BY account_id`;
    const riceRepaired = (
      await tx.query<{ account_id: string }>(
        `UPDATE rice_balances rb
            SET balance = truth.balance,
                earned_total = truth.earned,
                spent_total = truth.spent,
                last_seq = truth.last_seq,
                updated_at = now()
           FROM (${RICE_TRUTH}) AS truth
          WHERE rb.account_id = truth.account_id
            AND (rb.balance <> truth.balance
                 OR rb.earned_total <> truth.earned
                 OR rb.spent_total <> truth.spent
                 OR rb.last_seq <> truth.last_seq)
         RETURNING rb.account_id::text AS account_id`,
      )
    ).rows;
    const riceMissing = (
      await tx.query<{ account_id: string }>(
        `INSERT INTO rice_balances (account_id, balance, earned_total, spent_total, last_seq, updated_at)
         SELECT truth.account_id, truth.balance, truth.earned, truth.spent, truth.last_seq, now()
           FROM (${RICE_TRUTH}) AS truth
          WHERE NOT EXISTS (SELECT 1 FROM rice_balances rb WHERE rb.account_id = truth.account_id)
         RETURNING account_id::text AS account_id`,
      )
    ).rows;

    // ④ 交叉核对（§6.4④）：只对「有 profile 文档」的账号做——没有文档是同步延迟，不是背离
    const lessonRows = (
      await tx.query<{ account_id: string; n: number | string }>(
        `SELECT account_id::text AS account_id, count(*)::int AS n
           FROM rice_ledger WHERE kind = 'lesson' GROUP BY account_id`,
      )
    ).rows;
    const lessonDivergence: DailyJobReport['crossChecks']['lessonDivergence'] = [];
    for (const row of lessonRows) {
      if (!hasProfile.has(row.account_id)) continue;
      const d = derived.get(row.account_id);
      const marks = (d?.learnedMarks ?? 0) + (d?.droppedMarks ?? 0);
      const entries = num(row.n);
      if (entries > marks) {
        lessonDivergence.push({
          accountId: row.account_id,
          lessonEntries: entries,
          learnMarks: marks,
          learnedCount: d?.learnedCount ?? 0,
        });
      }
    }

    // ⑤ 清理（docs/22 §5.7：墓碑 24h / 过期会话 / 审计 90 天）
    const tombstones = countReturned(
      (
        await tx.query(
          `DELETE FROM sessions
            WHERE revoked_reason = 'account_deleted' AND revoked_at <= now() - interval '24 hours'
           RETURNING 1 AS one`,
        )
      ).rows,
    );
    const expiredSessions = countReturned(
      (
        await tx.query(
          `DELETE FROM sessions
            WHERE revoked_reason IS DISTINCT FROM 'account_deleted'
              AND (idle_expires_at <= now() OR absolute_expires_at <= now())
           RETURNING 1 AS one`,
        )
      ).rows,
    );
    const auditRows = countReturned(
      (
        await tx.query(
          `DELETE FROM auth_audit WHERE created_at <= now() - interval '90 days' RETURNING 1 AS one`,
        )
      ).rows,
    );

    return {
      daily: countReturned(dailyRows),
      weekly: countReturned(weeklyRows),
      monthly: countReturned(monthlyRows),
      yearly: countReturned(yearlyRows),
      userDayRows: dayRows.length,
      totalScoreRepaired,
      riceRepaired: riceRepaired.map((r) => r.account_id),
      riceMissing: riceMissing.map((r) => r.account_id),
      lessonDivergence,
      tombstones,
      expiredSessions,
      auditRows,
    };
  });

  const report: DailyJobReport = {
    ranAt: now.toISOString(),
    serverToday,
    referenceDay,
    weekKey,
    monthKey,
    yearKey,
    snapshots: {
      daily: txResult.daily,
      weekly: txResult.weekly,
      monthly: txResult.monthly,
      yearly: txResult.yearly,
    },
    progress: {
      accounts: grid.size,
      userDayRows: txResult.userDayRows,
      malformedEntries,
    },
    userStats: { accounts: statAccounts.size, totalScoreRepaired: txResult.totalScoreRepaired },
    rice: { repaired: txResult.riceRepaired, insertedMissing: txResult.riceMissing },
    crossChecks: { lessonDivergence: txResult.lessonDivergence },
    cleanup: {
      tombstones: txResult.tombstones,
      expiredSessions: txResult.expiredSessions,
      auditRows: txResult.auditRows,
    },
  };

  if (report.userStats.totalScoreRepaired.length > 0) {
    log.warn(
      { accounts: report.userStats.totalScoreRepaired },
      'user_stats.total_score 与 SUM(challenge_days.score) 不一致，已重算覆盖',
    );
  }
  if (report.rice.repaired.length > 0 || report.rice.insertedMissing.length > 0) {
    log.warn(
      { repaired: report.rice.repaired, insertedMissing: report.rice.insertedMissing },
      'rice_balances 对账修复（§6.3④）',
    );
  }
  for (const item of report.crossChecks.lessonDivergence) {
    log.warn(item, 'lesson 流水条数超过学习标记数（结构性不可能，供事后审计）');
  }
  log.info(
    {
      referenceDay: report.referenceDay,
      weekKey: report.weekKey,
      monthKey: report.monthKey,
      yearKey: report.yearKey,
      snapshots: report.snapshots,
      progress: report.progress,
      cleanup: report.cleanup,
    },
    '每日任务完成',
  );

  return report;
}

// ---------------------------------------------------------------- CLI（npm run job:daily [referenceDay]）

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config);
  const db = asDb(pool);
  const arg = process.argv[2];
  const logger: JobLogger = {
    info: (obj, msg) => console.log(`[job:daily] ${msg}`, JSON.stringify(obj)),
    warn: (obj, msg) => console.warn(`[job:daily] ${msg}`, JSON.stringify(obj)),
  };
  try {
    const report = await runDailyJob(db, {
      ...(arg !== undefined ? { referenceDay: arg } : {}),
      logger,
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}

const invokedAsScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsScript) {
  main().catch((err: unknown) => {
    console.error('[job:daily] 失败：', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
