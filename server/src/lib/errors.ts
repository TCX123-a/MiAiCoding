/**
 * 错误码体系（docs/22 §3.5 的 16 个 + docs/26 §4.7 新增 3 个 + 找回链 2 个
 * + 违禁用户名 1 个 = 22 个；
 * 2026-10-13 加 NO_SECURITY_QUESTION / BAD_SECURITY_ANSWER，DB 面见迁移 0012）与应用级异常。
 *
 * 枚举与状态码映射的**真源在 src/protocol.ts**（= 客户端 `src/shared/cloud/protocol.ts`
 * 的逐字节副本）；本文件只 re-export，保持既有导入面（config.ts / 路由 / 测试不动）。
 * 统一响应体：{"error":{"code","message","retryAfterMs?","details?","requestId"}}
 */

import { ERROR_CODES, HTTP_STATUS_BY_CODE } from '../protocol.js';
import type { ErrorCode } from '../protocol.js';

export { ERROR_CODES, HTTP_STATUS_BY_CODE };
export type { ErrorCode };

const DEFAULT_MESSAGE_BY_CODE: Record<ErrorCode, string> = {
  BAD_REQUEST: 'request shape is invalid',
  VALIDATION_FAILED: 'request validation failed',
  UNAUTHENTICATED: 'authentication required',
  TOKEN_EXPIRED: 'token has expired',
  BAD_CREDENTIALS: 'invalid username or password',
  FORBIDDEN: 'access is forbidden',
  NOT_FOUND: 'resource not found',
  USERNAME_TAKEN: 'username is already taken',
  USERNAME_FORBIDDEN: 'this username is not allowed',
  CONFLICT_STALE: 'base revision does not match',
  DOC_VER_BLOCKED: 'document version is older than the stored one',
  CHALLENGE_DUPLICATE: 'a different challenge settlement for this day already exists',
  ENTRY_CONFLICT: 'entry key was reused with different content',
  OVER_DAILY_CAP: 'daily cap for this entry kind was reached',
  PAYLOAD_TOO_LARGE: 'payload exceeds the allowed size',
  UNSUPPORTED_MEDIA_TYPE: 'unsupported media type',
  PROTOCOL_TOO_OLD: 'client protocol version is too old',
  RATE_LIMITED: 'too many requests',
  INTERNAL: 'internal server error',
  DB_UNAVAILABLE: 'database is unavailable',
  NO_SECURITY_QUESTION: 'this account has no security question set',
  BAD_SECURITY_ANSWER: 'security answer is incorrect',
};

export interface AppErrorOptions {
  details?: unknown;
  retryAfterMs?: number;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly retryAfterMs?: number;

  constructor(code: ErrorCode, message?: string, options: AppErrorOptions = {}) {
    super(message ?? DEFAULT_MESSAGE_BY_CODE[code], options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    if ('details' in options) this.details = options.details;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
  }
}

export function appError(code: ErrorCode, message?: string, options: AppErrorOptions = {}): AppError {
  return new AppError(code, message, options);
}

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    retryAfterMs?: number;
    details?: unknown;
    requestId: string;
  };
}

export function toErrorBody(err: AppError, requestId: string): ErrorBody {
  const body: ErrorBody = { error: { code: err.code, message: err.message, requestId } };
  if (err.retryAfterMs !== undefined) body.error.retryAfterMs = err.retryAfterMs;
  if (err.details !== undefined) body.error.details = err.details;
  return body;
}

/** PostgreSQL 连接层错误的 SQLSTATE / errno 集合 → 503 DB_UNAVAILABLE */
const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08P01',
  '53300',
  '57P01',
  '57P02',
  '57P03',
]);

/**
 * 把数据库层错误映射为 AppError；无法识别时返回 null（由调用方兜底 INTERNAL）。
 * 23514 分流（docs/22 自由度 #4）：体积硬顶约束 → 413，其余 CHECK 违约 → 400（绝不落 500）。
 * 23505 分流（自由度 #3）：users.username_lower 撞唯一键 → 409 USERNAME_TAKEN，其余 → 500。
 * 同时兼容 pg（.code/.constraint 结构化字段）与 PGlite（字段可能缺失，回退解析 message）。
 */
export function mapDatabaseError(err: unknown): AppError | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { code?: unknown; constraint?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code : undefined;
  const message = typeof e.message === 'string' ? e.message : '';
  const constraint =
    typeof e.constraint === 'string'
      ? e.constraint
      : /constraint "([^"]+)"/.exec(message)?.[1];

  if (code === '23514' || (code === undefined && /violates check constraint/i.test(message))) {
    if (constraint === 'user_docs_payload_size') {
      return appError('PAYLOAD_TOO_LARGE', 'payload exceeds the database hard cap of 10 MiB');
    }
    return appError('VALIDATION_FAILED', 'a database check constraint rejected the value', {
      details: constraint ? { constraint } : undefined,
    });
  }

  if (code === '23505' || (code === undefined && /duplicate key value violates unique constraint/i.test(message))) {
    if (constraint === 'users_username_lower_key') {
      return appError('USERNAME_TAKEN');
    }
    return appError('INTERNAL');
  }

  if (code === '23503') {
    return appError('VALIDATION_FAILED', 'a referenced row does not exist');
  }

  // 输入类 SQLSTATE（安全审查 F1）：22 类 = data exception（22P02 非法文本表示 /
  // 22P05 不可转换的 Unicode 转义 / 22003 数值越界）；54001 = statement too complex
  // （超深 jsonb 触发 PG 的栈深限制）。均为客户端可控输入的形状问题 → 400，
  // 绝不落 500（docs/22 §3.5：5xx 会让客户端重试永不成功的请求）。
  if (code !== undefined && (code.startsWith('22') || code === '54001')) {
    return appError('VALIDATION_FAILED', 'the database rejected the input value shape', {
      details: { sqlstate: code },
    });
  }

  if (code !== undefined && CONNECTION_ERROR_CODES.has(code)) {
    return appError('DB_UNAVAILABLE', 'database is unavailable', { retryAfterMs: 2000 });
  }

  return null;
}
