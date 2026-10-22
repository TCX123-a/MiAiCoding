/**
 * 账号自有数据端点：
 *  - GET /v1/auth/session（docs/22 §3.4 #5）：会话有效 + 账号信息（鉴权中间件已装好，无需再查库）。
 *  - GET /v1/me/summary（docs/26 §4.0「新增」）：stats + 余额 + 名次，面板一屏。
 *    docs 只给了用途没给字段（「stats + 余额 + 名次」）——字段形状由实现定义并登记在清单：
 *    stats 读 user_stats（无行 → 全零 + lastActiveDay null）；rice 读 rice_balances（无行 → 三零）；
 *    leaderboard.rankAllTime 与 /v1/leaderboard?period=alltime 同口径**实算**
 *    （未封禁全部有分账号的 rank()，opt-in 只是曝光开关，不影响名次）；optedIn 读 users 列。
 *    scoreToday 支持显式 ?dateKey= 客户端日入参（±1 天容差；第 6 项日差修复，默认服务器北京日）。
 *  - PUT /v1/me/leaderboard-opt-in（2026-10-10 夜 A4 裁定 a）：榜面曝光开关的唯一写口。
 *    body {optIn: boolean}，幂等（重复设同值也返回同值）；读口 = /v1/me/summary 与榜单 me.optedIn。
 */
import { z } from 'zod';
import { writeAudit } from '../lib/audit.js';
import { diffDays, isValidDateKey, serverDayKey } from '../lib/daykey.js';
import { appError } from '../lib/errors.js';
import { num, toIso } from '../lib/util.js';
import {
  AUTH_BODY_LIMIT,
  DAY_KEY_WINDOW_DAYS,
  USERNAME_RE,
  findSensitiveUsernameWord,
} from '../protocol.js';
import { requireAuth } from '../plugins/auth.js';
import { enforceRateLimit } from '../plugins/rate-limit.js';
import { takeApiRate, type AppInstance, type SharedDeps } from '../plugins/shared.js';
import { accountSchema } from './schemas.js';

const summarySchema = z.object({
  stats: z.object({
    learnedCount: z.number(),
    practicedCount: z.number(),
    streakDays: z.number(),
    lastActiveDay: z.string().nullable(),
    totalScore: z.number(),
  }),
  rice: z.object({
    balance: z.number(),
    earnedTotal: z.number(),
    spentTotal: z.number(),
  }),
  leaderboard: z.object({
    rankAllTime: z.number().nullable(),
    scoreAllTime: z.number(),
    scoreToday: z.number(),
    optedIn: z.boolean(),
  }),
});

interface MeStatsRow {
  leaderboard_opt_in: boolean;
  learned_count: number | string | null;
  practiced_count: number | string | null;
  streak_days: number | string | null;
  last_active_day: string | null;
  total_score: number | string | null;
}

export function meRoutes(app: AppInstance, deps: SharedDeps): void {
  const { db, rates, limiter } = deps;

  app.get(
    '/v1/auth/session',
    {
      preHandler: app.authenticate,
      schema: {
        response: {
          200: z.object({
            account: accountSchema,
            idleExpiresAt: z.string(),
            absoluteExpiresAt: z.string(),
          }),
        },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      takeApiRate(deps, request);
      return {
        account: {
          id: auth.accountId,
          username: auth.username,
          avatarHash: auth.avatarHash,
          createdAt: auth.accountCreatedAt,
        },
        idleExpiresAt: auth.idleExpiresAt,
        absoluteExpiresAt: auth.absoluteExpiresAt,
      };
    },
  );

  /**
   * 改用户名（2026-10-22 用户系统批次）。
   *
   * - 认证 + 全局 API 限流 + 账号日闸（5 次/日，protocol.RATE_LIMITS）；
   * - 格式 = protocol.USERNAME_RE（与注册同一份）；违禁词 = 两端共用的
   *   findSensitiveUsernameWord（客户端先拦一次，这里是权威判定）；
   * - 唯一键冲突由全局 mapDatabaseError 映射成 409 USERNAME_TAKEN
   *   （users_username_lower_key），路由不自己吞；
   * - 与当前名字完全相同 = 幂等成功（不写审计）；
   * - 成功写 auth_audit event='change_username'（迁移 0013 白名单）。
   */
  app.put(
    '/v1/me/username',
    {
      preHandler: app.authenticate,
      bodyLimit: AUTH_BODY_LIMIT,
      schema: {
        body: z.object({ username: z.string().regex(USERNAME_RE) }),
        response: { 200: z.object({ account: accountSchema }) },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      takeApiRate(deps, request);
      enforceRateLimit(limiter, {
        key: `username|a:${auth.accountId}`,
        limit: rates.usernameChangePerDayPerAccount,
        windowMs: 86_400_000,
        message: 'too many username changes',
      });

      const username = request.body.username;
      if (findSensitiveUsernameWord(username) !== null) {
        throw appError('USERNAME_FORBIDDEN', 'this username is not allowed');
      }

      const unchanged = username === auth.username;
      if (!unchanged) {
        // 改名与审计同一事务：审计写失败不能让「名字已经改了、界面却收到 500」
        // （用户重试会白烧一次日闸额度，而且看到的名字与服务端不一致）
        const account = await db.withTransaction(async (tx) => {
          const { rows } = await tx.query<{
            id: string;
            username: string;
            avatar_hash: string | null;
            created_at: Date | string;
          }>(
            `UPDATE users
                SET username = $2, username_lower = $3
              WHERE id = $1
          RETURNING id, username, avatar_hash, created_at`,
            [auth.accountId, username, username.toLowerCase()],
          );
          const row = rows[0]!; // 鉴权通过 ⇒ users 行必在
          await writeAudit(tx, {
            event: 'change_username',
            accountId: auth.accountId,
            username: row.username,
            ip: request.ip,
            userAgent: request.headers['user-agent'] ?? null,
          });
          return {
            id: row.id,
            username: row.username,
            avatarHash: row.avatar_hash,
            createdAt: toIso(row.created_at),
          };
        });
        return { account };
      }

      return {
        account: {
          id: auth.accountId,
          username: auth.username,
          avatarHash: auth.avatarHash,
          createdAt: auth.accountCreatedAt,
        },
      };
    },
  );

  app.get(
    '/v1/me/summary',
    {
      preHandler: app.authenticate,
      schema: {
        querystring: z.object({
          dateKey: z
            .string()
            .optional()
            .describe(
              '可选：把「今天」显式指到客户端北京日（YYYY-MM-DD 形状；与服务器日容差 ±1 天），scoreToday 按它查；省略 = 服务器北京日',
            ),
        }),
        response: { 200: summarySchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      takeApiRate(deps, request);

      // dateKey（可选；第 6 项日差修复）：现在客户端与服务器都以北京日为锚，正常不再有
      // 领先；容差 ±DAY_KEY_WINDOW_DAYS 继续吸收非中国时区客户端与时钟偏差。
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

      const me = await db.query<MeStatsRow>(
        `SELECT u.leaderboard_opt_in,
                s.learned_count, s.practiced_count, s.streak_days,
                to_char(s.last_active_day, 'YYYY-MM-DD') AS last_active_day,
                s.total_score
           FROM users u
           LEFT JOIN user_stats s ON s.account_id = u.id
          WHERE u.id = $1`,
        [auth.accountId],
      );
      const row = me.rows[0]!; // 鉴权通过 ⇒ users 行必在

      const rank = await db.query<{ rank: number | string; total_score: number | string }>(
        `WITH scored AS (
           SELECT us.account_id, us.total_score
             FROM user_stats us JOIN users u ON u.id = us.account_id
            WHERE u.disabled_at IS NULL AND us.total_score > 0
         ),
         ranked AS (
           SELECT account_id, total_score, rank() OVER (ORDER BY total_score DESC) AS rank
             FROM scored
         )
         SELECT rank, total_score FROM ranked WHERE account_id = $1`,
        [auth.accountId],
      );
      const rankRow = rank.rows[0] ?? null;

      const today = await db.query<{ score: number | string }>(
        `SELECT score FROM challenge_days WHERE account_id = $1 AND date_key = $2::date`,
        [auth.accountId, clientDayKey],
      );

      const rice = await db.query<{
        balance: number | string;
        earned_total: number | string;
        spent_total: number | string;
      }>(
        `SELECT balance, earned_total, spent_total FROM rice_balances WHERE account_id = $1`,
        [auth.accountId],
      );
      const riceRow = rice.rows[0] ?? null;

      return {
        stats: {
          learnedCount: num(row.learned_count ?? 0),
          practicedCount: num(row.practiced_count ?? 0),
          streakDays: num(row.streak_days ?? 0),
          lastActiveDay: row.last_active_day === null ? null : String(row.last_active_day),
          totalScore: num(row.total_score ?? 0),
        },
        rice: {
          balance: riceRow === null ? 0 : num(riceRow.balance),
          earnedTotal: riceRow === null ? 0 : num(riceRow.earned_total),
          spentTotal: riceRow === null ? 0 : num(riceRow.spent_total),
        },
        leaderboard: {
          rankAllTime: rankRow === null ? null : num(rankRow.rank),
          scoreAllTime: num(row.total_score ?? 0),
          scoreToday: today.rows[0] ? num(today.rows[0].score) : 0,
          optedIn: row.leaderboard_opt_in,
        },
      };
    },
  );

  /**
   * 榜面曝光开关（2026-10-10 夜 A4 裁定 a）：leaderboard_opt_in 的唯一写口。
   * 幂等：重复设同值也返回同值（不区分「改没改」），客户端重试安全。
   */
  app.put(
    '/v1/me/leaderboard-opt-in',
    {
      preHandler: app.authenticate,
      schema: {
        body: z.object({ optIn: z.boolean() }),
        response: { 200: z.object({ optIn: z.boolean() }) },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      takeApiRate(deps, request);
      const { rows } = await db.query<{ leaderboard_opt_in: boolean }>(
        `UPDATE users SET leaderboard_opt_in = $2 WHERE id = $1 RETURNING leaderboard_opt_in`,
        [auth.accountId, request.body.optIn],
      );
      return { optIn: rows[0]!.leaderboard_opt_in }; // 鉴权通过 ⇒ users 行必在
    },
  );
}
