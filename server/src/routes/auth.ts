/**
 * 认证端点（docs/22 §3.4 #3/#4/#6/#7/#8/#9/#10、§5.1、§5.4、§5.7、§10 流程语义）：
 *  - POST /v1/auth/register：201 {token, expiresAt, absoluteExpiresAt, account}，自动登录；
 *    必带安全问答（securityQuestion ∈ 预设枚举、securityAnswer 1~64 字符，答案归一化后
 *    只存 argon2id 哈希——2026-10-13 主人令）；
 *  - POST /v1/auth/login：200 同形状；未知账号与密码错统一 BAD_CREDENTIALS（防枚举）；
 *  - POST /v1/auth/logout：204 幂等（已失效令牌同样 204；不走全局鉴权中间件）；
 *  - POST /v1/auth/logout-all：204 吊销全部会话（含当前）；
 *  - GET  /v1/auth/sessions：200 数组（创建/最近活跃/是否当前/设备标签）；
 *  - POST /v1/auth/change-password：204；验当前密码、保留当前会话、吊销其他；
 *  - POST /v1/auth/delete-account：204 幂等（会话墓碑 24h；不走全局鉴权中间件）；
 *  - 找回链（2026-10-13 主人令，三步都是匿名端点）：
 *    · POST /v1/auth/recover/question：200 {question}；账号不存在 → NOT_FOUND、
 *      没设过安全问题（早期账号）→ NO_SECURITY_QUESTION（榜面本就公开用户名，如实回答）；
 *    · POST /v1/auth/recover/verify：200 {verified:true}；答案错 → BAD_SECURITY_ANSWER；
 *    · POST /v1/auth/recover/reset：200 {ok:true}；答案**再核一遍**（纵深）→ 换哈希 +
 *      password_changed_at → 吊销全部会话（reason='password_change'）→ 审计 password_reset；
 *      不自动发令牌（须用新密码走一次正常登录）。
 * 限流：注册 每 IP 5/时 + 全局 50/日；登录 每 IP 30/15min；每用户名连续失败 → 指数退避；
 *      改密 5/日/账号；注销 3/日/账号；找回三端点共用 `recover|ip:` 10/15min + 按账号
 *      `recover|u:` 10/日 + 按用户名 `recover:` 前缀的指数退避（答案弱秘密，两层防爆破）。
 * 用户名规则（2026-10-13 放宽）：2~30 位中文/字母/数字/下划线、不能数字开头（真源 USERNAME_RE）。
 */
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { Queryable } from '../db/pool.js';
import { writeAudit } from '../lib/audit.js';
import { appError } from '../lib/errors.js';
import { absorbUnknownUserTiming, hashPassword, verifyPassword } from '../lib/password.js';
import { enforcePasswordPolicy, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../lib/password-policy.js';
import { normalizeSecurityAnswer } from '../lib/security-answer.js';
import { generateToken, hashToken, isWellFormedToken, parseBearer } from '../lib/token.js';
import { toIso } from '../lib/util.js';
import {
  AUTH_BODY_LIMIT,
  SECURITY_ANSWER_MAX_LENGTH,
  SECURITY_ANSWER_MIN_LENGTH,
  SECURITY_QUESTIONS,
  SESSION_ABSOLUTE_DAYS,
  SESSION_IDLE_DAYS,
  USERNAME_RE,
  findSensitiveUsernameWord,
} from '../protocol.js';
import { requireAuth } from '../plugins/auth.js';
import { bucketIp, enforceRateLimit } from '../plugins/rate-limit.js';
import { takeApiRate, type AppInstance, type SharedDeps } from '../plugins/shared.js';
import { authResponseSchema } from './schemas.js';

const usernameSchema = z.string().regex(USERNAME_RE);
const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
const clientLabelSchema = z.string().min(1).max(64);
const securityAnswerSchema = z.string().min(SECURITY_ANSWER_MIN_LENGTH).max(SECURITY_ANSWER_MAX_LENGTH);

const registerBodySchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  securityQuestion: z.enum(SECURITY_QUESTIONS),
  securityAnswer: securityAnswerSchema,
  clientLabel: clientLabelSchema.optional(),
});

const loginBodySchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  clientLabel: clientLabelSchema.optional(),
});

interface NewUserRow {
  id: string;
  username: string;
  created_at: Date | string;
}

interface LoginUserRow {
  id: string;
  username: string;
  avatar_hash: string | null;
  password_hash: string;
  disabled_at: Date | string | null;
  created_at: Date | string;
}

interface RecoverUserRow {
  id: string;
  username: string;
  disabled_at: Date | string | null;
  security_question: string | null;
  security_answer_hash: string | null;
}

/** loadRecoveryTarget 窄化后的返回：两列非空已由 NO_SECURITY_QUESTION 分支保证 */
type RecoverTarget = RecoverUserRow & { security_question: string; security_answer_hash: string };

interface SessionTimesRow {
  idle_expires_at: Date | string;
  absolute_expires_at: Date | string;
}

export async function createSession(
  tx: Queryable,
  accountId: string,
  clientLabel: string | null,
): Promise<{ token: string; expiresAt: string; absoluteExpiresAt: string }> {
  const token = generateToken();
  const { rows } = await tx.query<SessionTimesRow>(
    `INSERT INTO sessions (account_id, token_hash, created_at, last_seen_at, idle_expires_at, absolute_expires_at, client_label)
     VALUES ($1, $2, now(), now(), now() + make_interval(days => $3::int), now() + make_interval(days => $4::int), $5)
     RETURNING idle_expires_at, absolute_expires_at`,
    [accountId, hashToken(token), SESSION_IDLE_DAYS, SESSION_ABSOLUTE_DAYS, clientLabel],
  );
  const row = rows[0]!;
  return {
    token,
    expiresAt: toIso(row.idle_expires_at),
    absoluteExpiresAt: toIso(row.absolute_expires_at),
  };
}

/**
 * 找回链共用的「取目标账号」：不存在 → NOT_FOUND；被禁 → FORBIDDEN；
 * 没设过安全问题（0012 之前的存量账号）→ NO_SECURITY_QUESTION。
 * 如实回答「账号是否存在」的前提见文件头（榜面本就公开用户名）。
 */
async function loadRecoveryTarget(db: SharedDeps['db'], usernameLower: string): Promise<RecoverTarget> {
  const { rows } = await db.query<RecoverUserRow>(
    `SELECT id, username, disabled_at, security_question, security_answer_hash
       FROM users
      WHERE username_lower = $1`,
    [usernameLower],
  );
  const user = rows[0];
  if (!user) throw appError('NOT_FOUND', 'account not found');
  if (user.disabled_at !== null) throw appError('FORBIDDEN', 'account is disabled');
  if (user.security_question === null || user.security_answer_hash === null) {
    throw appError('NO_SECURITY_QUESTION');
  }
  return user as RecoverTarget;
}

/**
 * verify / reset 共用的「验答案」前半场：账号日闸 → 按用户名指数退避 → 取账号 → 归一化比对。
 * 答案错：记退避 + 审计 recover_fail（detail.reason='bad_answer'）→ BAD_SECURITY_ANSWER；
 * 答案对：清退避并返回账号行（reset 后半场在同一请求里换哈希 + 吊销全部会话）。
 * 空白答案（归一化后为空）算输入无效：不记退避（不给攻击者刷退避的捷径），但仍已吃日闸。
 */
async function verifyRecoveryAnswer(
  deps: SharedDeps,
  request: FastifyRequest,
  username: string,
  answer: string,
): Promise<RecoverUserRow> {
  const { db, rates, limiter, backoff } = deps;
  const usernameLower = username.toLowerCase();
  const ipKey = bucketIp(request.ip);
  const userAgent = request.headers['user-agent'] ?? null;

  enforceRateLimit(limiter, {
    key: `recover|ip:${ipKey}`,
    limit: rates.recoverPer15MinPerIp,
    windowMs: 15 * 60_000,
    message: 'too many recovery attempts from this address',
  });
  enforceRateLimit(limiter, {
    key: `recover|u:${usernameLower}`,
    limit: rates.recoverAttemptPerDayPerAccount,
    windowMs: 86_400_000,
    message: 'too many recovery attempts for this account',
  });

  const backoffKey = `recover:${usernameLower}`;
  const preBlock = backoff.check(backoffKey);
  if (preBlock.blocked) {
    await writeAudit(db, {
      event: 'recover_fail',
      username: usernameLower,
      ip: request.ip,
      userAgent,
      detail: { reason: 'backoff', retryAfterMs: preBlock.retryAfterMs },
    });
    throw appError('RATE_LIMITED', 'too many failed recovery attempts for this account', {
      retryAfterMs: preBlock.retryAfterMs,
    });
  }

  const user = await loadRecoveryTarget(db, usernameLower);
  const normalized = normalizeSecurityAnswer(answer);
  if (normalized.length === 0) {
    throw appError('VALIDATION_FAILED', 'security answer must not be blank');
  }

  const answerOk = await verifyPassword(normalized, user.security_answer_hash);
  if (!answerOk) {
    backoff.recordFailure(backoffKey);
    await writeAudit(db, {
      event: 'recover_fail',
      accountId: user.id,
      username: user.username,
      ip: request.ip,
      userAgent,
      detail: { reason: 'bad_answer' },
    });
    throw appError('BAD_SECURITY_ANSWER');
  }

  backoff.recordSuccess(backoffKey);
  return user;
}

export function authRoutes(app: AppInstance, deps: SharedDeps): void {
  const { db, rates, limiter, backoff } = deps;

  app.post(
    '/v1/auth/register',
    {
      bodyLimit: AUTH_BODY_LIMIT,
      schema: {
        body: registerBodySchema,
        response: { 201: authResponseSchema },
      },
    },
    async (request, reply) => {
      takeApiRate(deps, request);
      const ipKey = bucketIp(request.ip);
      enforceRateLimit(limiter, {
        key: `reg|ip:${ipKey}`,
        limit: rates.registerPerHourPerIp,
        windowMs: 3_600_000,
        message: 'too many registrations from this address',
      });
      enforceRateLimit(limiter, {
        key: 'reg|global',
        limit: rates.registerPerDayGlobal,
        windowMs: 86_400_000,
        message: 'registration is temporarily unavailable',
      });

      const { username, password, securityQuestion, securityAnswer, clientLabel } = request.body;
      if (findSensitiveUsernameWord(username) !== null) {
        throw appError('USERNAME_FORBIDDEN', 'this username is not allowed');
      }
      enforcePasswordPolicy(password, username);
      const usernameLower = username.toLowerCase();
      const answerNormalized = normalizeSecurityAnswer(securityAnswer);
      if (answerNormalized.length === 0) {
        throw appError('VALIDATION_FAILED', 'security answer must not be blank');
      }
      const passwordHash = await hashPassword(password);
      const answerHash = await hashPassword(answerNormalized); // 明文答案不落库、不进日志

      const created = await db.withTransaction(async (tx) => {
        const { rows } = await tx.query<NewUserRow>(
          `INSERT INTO users (username, username_lower, password_hash, security_question, security_answer_hash)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, username, created_at`,
          [username, usernameLower, passwordHash, securityQuestion, answerHash],
        );
        const user = rows[0]!;
        const session = await createSession(tx, user.id, clientLabel ?? null);
        await writeAudit(tx, {
          event: 'register',
          accountId: user.id,
          username: user.username,
          ip: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        });
        return { user, session };
      });

      reply.code(201);
      return {
        token: created.session.token,
        expiresAt: created.session.expiresAt,
        absoluteExpiresAt: created.session.absoluteExpiresAt,
        account: {
          id: created.user.id,
          username: created.user.username,
          avatarHash: null,
          createdAt: toIso(created.user.created_at),
        },
      };
    },
  );

  app.post(
    '/v1/auth/login',
    {
      bodyLimit: AUTH_BODY_LIMIT,
      schema: {
        body: loginBodySchema,
        response: { 200: authResponseSchema },
      },
    },
    async (request) => {
      takeApiRate(deps, request);
      enforceRateLimit(limiter, {
        key: `login|ip:${bucketIp(request.ip)}`,
        limit: rates.loginPer15MinPerIp,
        windowMs: 15 * 60_000,
        message: 'too many login attempts from this address',
      });

      const { username, password, clientLabel } = request.body;
      const usernameLower = username.toLowerCase();

      const preBlock = backoff.check(usernameLower);
      if (preBlock.blocked) {
        await writeAudit(db, {
          event: 'login_blocked',
          username: usernameLower,
          ip: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        });
        throw appError('RATE_LIMITED', 'too many failed login attempts for this account', {
          retryAfterMs: preBlock.retryAfterMs,
        });
      }

      const { rows } = await db.query<LoginUserRow>(
        `SELECT id, username, avatar_hash, password_hash, disabled_at, created_at
           FROM users
          WHERE username_lower = $1`,
        [usernameLower],
      );
      const user = rows[0];
      if (!user) {
        // 未知账号：做一次等价耗时的哈希校验，抹平「账号是否存在」的时序差
        await absorbUnknownUserTiming(password);
        backoff.recordFailure(usernameLower);
        await writeAudit(db, {
          event: 'login_fail',
          username: usernameLower,
          ip: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        });
        throw appError('BAD_CREDENTIALS', 'invalid username or password');
      }

      const passwordOk = await verifyPassword(password, user.password_hash);
      if (!passwordOk) {
        backoff.recordFailure(usernameLower);
        await writeAudit(db, {
          event: 'login_fail',
          accountId: user.id,
          username: user.username,
          ip: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        });
        throw appError('BAD_CREDENTIALS', 'invalid username or password');
      }

      if (user.disabled_at !== null) {
        throw appError('FORBIDDEN', 'account is disabled');
      }

      backoff.recordSuccess(usernameLower);
      const session = await db.withTransaction(async (tx) => {
        const created = await createSession(tx, user.id, clientLabel ?? null);
        await writeAudit(tx, {
          event: 'login_ok',
          accountId: user.id,
          username: user.username,
          ip: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        });
        return created;
      });

      return {
        token: session.token,
        expiresAt: session.expiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
        account: {
          id: user.id,
          username: user.username,
          avatarHash: user.avatar_hash,
          createdAt: toIso(user.created_at),
        },
      };
    },
  );

  app.post('/v1/auth/logout', async (request, reply) => {
    takeApiRate(deps, request);
    const token = parseBearer(request.headers.authorization);
    if (token && isWellFormedToken(token)) {
      const { rows } = await db.query<{ account_id: string | null }>(
        `UPDATE sessions
            SET revoked_at = now(), revoked_reason = 'logout'
          WHERE token_hash = $1 AND revoked_at IS NULL
          RETURNING account_id`,
        [hashToken(token)],
      );
      const row = rows[0];
      if (row) {
        await writeAudit(db, {
          event: 'logout',
          accountId: row.account_id,
          ip: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        });
      }
    }
    reply.code(204);
    return reply.send();
  });

  // docs/22 §3.4 #7：全设备登出——吊销该账号全部会话（含当前这枚），204。
  app.post('/v1/auth/logout-all', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request);
    takeApiRate(deps, request);
    const revoked = await db.query<{ session_id: string }>(
      `UPDATE sessions
          SET revoked_at = now(), revoked_reason = 'logout_all'
        WHERE account_id = $1 AND revoked_at IS NULL
        RETURNING session_id`,
      [auth.accountId],
    );
    await writeAudit(db, {
      event: 'logout_all',
      accountId: auth.accountId,
      username: auth.username,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
      detail: { revokedSessions: revoked.rows.length },
    });
    reply.code(204);
    return reply.send();
  });

  // docs/22 §3.4 #8：设备列表（仅未吊销且未过期；current = 本请求这枚）。
  app.get(
    '/v1/auth/sessions',
    {
      preHandler: app.authenticate,
      schema: {
        response: {
          200: z.array(
            z.object({
              id: z.string(),
              createdAt: z.string(),
              lastSeenAt: z.string(),
              clientLabel: z.string().nullable(),
              current: z.boolean(),
            }),
          ),
        },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      takeApiRate(deps, request);
      const { rows } = await db.query<{
        session_id: string;
        created_at: Date | string;
        last_seen_at: Date | string;
        client_label: string | null;
      }>(
        `SELECT session_id, created_at, last_seen_at, client_label
           FROM sessions
          WHERE account_id = $1
            AND revoked_at IS NULL
            AND idle_expires_at > now()
            AND absolute_expires_at > now()
          ORDER BY last_seen_at DESC`,
        [auth.accountId],
      );
      return rows.map((row) => ({
        id: row.session_id,
        createdAt: toIso(row.created_at),
        lastSeenAt: toIso(row.last_seen_at),
        clientLabel: row.client_label,
        current: row.session_id === auth.sessionId,
      }));
    },
  );

  // docs/22 §3.4 #9 + §5.7：改密——验当前密码 → 更新 hash + password_changed_at →
  // 吊销除当前外全部会话（reason='password_change'）→ 审计；5 次/日/账号（每次尝试都计）。
  app.post(
    '/v1/auth/change-password',
    {
      preHandler: app.authenticate,
      bodyLimit: AUTH_BODY_LIMIT,
      schema: {
        body: z.object({
          currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
          newPassword: passwordSchema,
        }),
      },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      takeApiRate(deps, request);
      enforceRateLimit(limiter, {
        key: `pw-change|a:${auth.accountId}`,
        limit: rates.passwordChangePerDayPerAccount,
        windowMs: 86_400_000,
        message: 'too many password changes',
      });

      const { rows } = await db.query<{ password_hash: string }>(
        `SELECT password_hash FROM users WHERE id = $1`,
        [auth.accountId],
      );
      const user = rows[0]!; // 鉴权通过 ⇒ 行必在
      const passwordOk = await verifyPassword(request.body.currentPassword, user.password_hash);
      if (!passwordOk) throw appError('BAD_CREDENTIALS', 'current password is incorrect');

      const { newPassword } = request.body;
      enforcePasswordPolicy(newPassword, auth.username);
      const newHash = await hashPassword(newPassword);

      await db.withTransaction(async (tx) => {
        await tx.query(
          `UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1`,
          [auth.accountId, newHash],
        );
        const revoked = await tx.query<{ session_id: string }>(
          `UPDATE sessions
              SET revoked_at = now(), revoked_reason = 'password_change'
            WHERE account_id = $1 AND session_id <> $2 AND revoked_at IS NULL
            RETURNING session_id`,
          [auth.accountId, auth.sessionId],
        );
        await writeAudit(tx, {
          event: 'change_password',
          accountId: auth.accountId,
          username: auth.username,
          ip: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
          detail: { revokedSessions: revoked.rows.length },
        });
      });

      reply.code(204);
      return reply.send();
    },
  );

  // docs/22 §3.4 #10 + §5.7：注销（幂等）——验密码 → 删 users 行（user_docs/头像/派生表级联）
  // → sessions 置 revoked_reason='account_deleted' 留 24h 墓碑；重试带同一令牌命中墓碑仍 204。
  // 不走全局鉴权中间件：它的 401 会把墓碑重试挡在门外（与 logout 同理由的特例）。
  app.post(
    '/v1/auth/delete-account',
    {
      bodyLimit: AUTH_BODY_LIMIT,
      schema: { body: z.object({ password: z.string().min(1).max(PASSWORD_MAX_LENGTH) }) },
    },
    async (request, reply) => {
      takeApiRate(deps, request);
      const token = parseBearer(request.headers.authorization);
      if (!token || !isWellFormedToken(token)) {
        throw appError('UNAUTHENTICATED', 'missing or malformed token');
      }
      const { rows } = await db.query<{
        session_id: string;
        account_id: string | null;
        revoked_at: Date | string | null;
        revoked_reason: string | null;
        disabled_at: Date | string | null;
      }>(
        `SELECT s.session_id, s.account_id, s.revoked_at, s.revoked_reason, u.disabled_at
           FROM sessions s
           LEFT JOIN users u ON u.id = s.account_id
          WHERE s.token_hash = $1`,
        [hashToken(token)],
      );
      const session = rows[0];
      if (!session) throw appError('UNAUTHENTICATED', 'token is not valid');
      if (session.revoked_at !== null) {
        // 墓碑幂等：注销成功的令牌重试 → 仍 204；其他吊销原因（logout/改密/封禁…）→ 401
        if (session.revoked_reason === 'account_deleted') {
          reply.code(204);
          return reply.send();
        }
        throw appError('UNAUTHENTICATED', 'token is not valid');
      }
      if (session.account_id === null) throw appError('UNAUTHENTICATED', 'token is not valid');
      if (session.disabled_at !== null) throw appError('FORBIDDEN', 'account is disabled');

      enforceRateLimit(limiter, {
        key: `delete-account|a:${session.account_id}`,
        limit: rates.deleteAccountPerDayPerAccount,
        windowMs: 86_400_000,
        message: 'too many delete attempts',
      });

      const accountId = session.account_id;
      const { rows: pwRows } = await db.query<{ password_hash: string }>(
        `SELECT password_hash FROM users WHERE id = $1`,
        [accountId],
      );
      const user = pwRows[0]!; // account_id 非空 ⇒ users 行必在（FK）
      const passwordOk = await verifyPassword(request.body.password, user.password_hash);
      if (!passwordOk) throw appError('BAD_CREDENTIALS', 'password is incorrect');

      await db.withTransaction(async (tx) => {
        // 顺序有讲究：先钉墓碑（users 删除后账号列会被 FK 置 NULL，届时就找不到这批会话）
        await tx.query(
          `UPDATE sessions
              SET revoked_at = now(), revoked_reason = 'account_deleted'
            WHERE account_id = $1 AND revoked_at IS NULL`,
          [accountId],
        );
        // 审计匿名化（§5.7 最小收集）：该账号全部历史审计行的 account_id/username 置 NULL
        await tx.query(`UPDATE auth_audit SET account_id = NULL, username = NULL WHERE account_id = $1`, [
          accountId,
        ]);
        await tx.query(`DELETE FROM users WHERE id = $1`, [accountId]);
        // 注销事件本身也匿名（不写 account_id/username）
        await writeAudit(tx, {
          event: 'delete_account',
          ip: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        });
      });

      reply.code(204);
      return reply.send();
    },
  );

  // 找回链 · 第一步（2026-10-13 主人令）：账号 → 问题。账号不存在如实 404（榜面本就公开
  // 用户名，无新增枚举面，见文件头）；存量无问答账号 → NO_SECURITY_QUESTION（前端给准话）；
  // 被禁账号 → FORBIDDEN。IP 闸与 verify/reset 共用一个桶。
  app.post(
    '/v1/auth/recover/question',
    {
      bodyLimit: AUTH_BODY_LIMIT,
      schema: {
        body: z.object({ username: usernameSchema }),
        response: { 200: z.object({ question: z.string() }) },
      },
    },
    async (request) => {
      takeApiRate(deps, request);
      enforceRateLimit(limiter, {
        key: `recover|ip:${bucketIp(request.ip)}`,
        limit: rates.recoverPer15MinPerIp,
        windowMs: 15 * 60_000,
        message: 'too many recovery attempts from this address',
      });
      const user = await loadRecoveryTarget(db, request.body.username.toLowerCase());
      return { question: user.security_question };
    },
  );

  // 找回链 · 第二步：当场验证答案（前端「下一步」按钮即时反馈，不用打到第三步才发现答错）。
  // 答案比对与退避记账全在 verifyRecoveryAnswer（与 reset 共用同一段），此处只管成败。
  app.post(
    '/v1/auth/recover/verify',
    {
      bodyLimit: AUTH_BODY_LIMIT,
      schema: {
        body: z.object({ username: usernameSchema, answer: securityAnswerSchema }),
        response: { 200: z.object({ verified: z.boolean() }) },
      },
    },
    async (request) => {
      takeApiRate(deps, request);
      await verifyRecoveryAnswer(deps, request, request.body.username, request.body.answer);
      return { verified: true };
    },
  );

  // 找回链 · 第三步：答案再核（纵深——不与第二步互信）→ 新密码过关 → 换哈希 +
  // password_changed_at → 吊销全部会话（reason='password_change'，白名单复用）→ 审计
  // password_reset。不自动发令牌：重置后用新密码走一次正常登录。
  app.post(
    '/v1/auth/recover/reset',
    {
      bodyLimit: AUTH_BODY_LIMIT,
      schema: {
        body: z.object({
          username: usernameSchema,
          answer: securityAnswerSchema,
          newPassword: passwordSchema,
        }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (request) => {
      takeApiRate(deps, request);
      const { username, answer, newPassword } = request.body;
      const user = await verifyRecoveryAnswer(deps, request, username, answer);
      enforcePasswordPolicy(newPassword, user.username);
      const newHash = await hashPassword(newPassword);

      await db.withTransaction(async (tx) => {
        await tx.query(
          `UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1`,
          [user.id, newHash],
        );
        const revoked = await tx.query<{ session_id: string }>(
          `UPDATE sessions
              SET revoked_at = now(), revoked_reason = 'password_change'
            WHERE account_id = $1 AND revoked_at IS NULL
            RETURNING session_id`,
          [user.id],
        );
        await writeAudit(tx, {
          event: 'password_reset',
          accountId: user.id,
          username: user.username,
          ip: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
          detail: { revokedSessions: revoked.rows.length },
        });
      });

      return { ok: true };
    },
  );
}
