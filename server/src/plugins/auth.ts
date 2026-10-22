/**
 * 鉴权中间件（docs/22 §3.4/§5.1）：令牌 → sha256 → 查 sessions.token_hash；
 * 校验未吊销 + 未过期 + 账号未禁用；距 last_seen > 1h 时延展 idle（写节流 1h/次）。
 * HTTP 语义：不存在/伪造/吊销 → 401 UNAUTHENTICATED；闲置/绝对过期 → 401 TOKEN_EXPIRED；
 * 禁用 → 403 FORBIDDEN。注意：logout 是幂等特例（已失效令牌同样 204），不走本中间件。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Queryable } from '../db/pool.js';
import { appError } from '../lib/errors.js';
import { hashToken, isWellFormedToken, parseBearer } from '../lib/token.js';
import { SESSION_IDLE_DAYS, SESSION_TOUCH_THROTTLE_MS } from '../protocol.js';

export interface AuthContext {
  accountId: string;
  sessionId: string;
  username: string;
  /** 头像 hash（sha256 hex）；null = 没设头像（客户端显示默认大肥鱼） */
  avatarHash: string | null;
  accountCreatedAt: string;
  /** 本请求视角的有效闲置过期时间（若本请求触发了延展，则为延展后的值） */
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}

interface SessionRow {
  session_id: string;
  account_id: string | null;
  username: string | null;
  avatar_hash: string | null;
  revoked_at: Date | string | null;
  disabled_at: Date | string | null;
  last_seen_at: Date | string;
  idle_expires_at: Date | string;
  absolute_expires_at: Date | string;
  account_created_at: Date | string;
}

function toMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export function installAuth(app: FastifyInstance, db: Queryable): void {
  app.decorateRequest('auth', null);

  app.decorate('authenticate', async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const token = parseBearer(request.headers.authorization);
    if (!token || !isWellFormedToken(token)) {
      throw appError('UNAUTHENTICATED', 'missing or malformed token');
    }

    const { rows } = await db.query<SessionRow>(
      `SELECT s.session_id, s.account_id, s.revoked_at, s.idle_expires_at, s.absolute_expires_at,
              s.last_seen_at, u.username, u.avatar_hash, u.disabled_at, u.created_at AS account_created_at
         FROM sessions s
         JOIN users u ON u.id = s.account_id
        WHERE s.token_hash = $1`,
      [hashToken(token)],
    );

    const row = rows[0];
    if (!row || row.account_id === null || row.revoked_at !== null) {
      throw appError('UNAUTHENTICATED', 'token is not valid');
    }
    if (row.disabled_at !== null) {
      throw appError('FORBIDDEN', 'account is disabled');
    }

    const now = Date.now();
    const idleMs = toMs(row.idle_expires_at);
    const absoluteMs = toMs(row.absolute_expires_at);
    if (idleMs <= now || absoluteMs <= now) {
      throw appError('TOKEN_EXPIRED', 'token has expired');
    }

    let effectiveIdleMs = idleMs;
    if (now - toMs(row.last_seen_at) > SESSION_TOUCH_THROTTLE_MS) {
      await db.query(
        `UPDATE sessions
            SET last_seen_at = now(),
                idle_expires_at = LEAST(now() + make_interval(days => $2::int), absolute_expires_at)
          WHERE session_id = $1`,
        [row.session_id, SESSION_IDLE_DAYS],
      );
      effectiveIdleMs = Math.min(now + SESSION_IDLE_DAYS * 86_400_000, absoluteMs);
    }

    request.auth = {
      accountId: row.account_id,
      sessionId: row.session_id,
      username: row.username ?? '',
      avatarHash: row.avatar_hash ?? null,
      accountCreatedAt: new Date(toMs(row.account_created_at)).toISOString(),
      idleExpiresAt: new Date(effectiveIdleMs).toISOString(),
      absoluteExpiresAt: new Date(absoluteMs).toISOString(),
    };
  });
}

/** 路由处理器内取出鉴权上下文（若中间件未跑或未通过则抛 401，防御性兜底） */
export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw appError('UNAUTHENTICATED', 'authentication required');
  return request.auth;
}
