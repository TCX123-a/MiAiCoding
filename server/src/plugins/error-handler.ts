/**
 * 统一错误处理（docs/22 §3.5）：
 *  - 错误体固定 {"error":{"code","message","retryAfterMs?","details?","requestId"}}；
 *  - 500 兜底响应不含内部细节，日志带 requestId；
 *  - 429/503 附 Retry-After 头；
 *  - PG 错误经 mapDatabaseError 分流（23514→413/400，23505→409/500，输入类 22xxx/54001→400，连接类→503）。
 */
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError, appError, HTTP_STATUS_BY_CODE, mapDatabaseError, toErrorBody } from '../lib/errors.js';

function sendError(reply: FastifyReply, err: AppError, requestId: string): FastifyReply {
  if (err.retryAfterMs !== undefined) {
    reply.header('retry-after', String(Math.max(1, Math.ceil(err.retryAfterMs / 1000))));
  }
  return reply.code(HTTP_STATUS_BY_CODE[err.code]).send(toErrorBody(err, requestId));
}

export function normalizeError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) return appError('VALIDATION_FAILED', 'request validation failed');

  const e = err as Partial<FastifyError> & { code?: string };
  if ((e as { validation?: unknown }).validation !== undefined) {
    return appError('VALIDATION_FAILED', 'request validation failed');
  }
  switch (e.code) {
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return appError('PAYLOAD_TOO_LARGE', 'request body exceeds the endpoint limit');
    case 'FST_ERR_CTP_INVALID_JSON_BODY': // fastify 5 的实际码（安全审查 F2：旧码名 FST_ERR_CTP_INVALID_JSON 是死分支）
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
      return appError('BAD_REQUEST', 'request body is not valid JSON');
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return appError('UNSUPPORTED_MEDIA_TYPE', 'unsupported media type');
    case 'FST_ERR_CTP_INVALID_CONTENT_LENGTH':
      return appError('BAD_REQUEST', 'invalid content length');
    default:
      break;
  }

  const dbError = mapDatabaseError(err);
  if (dbError) return dbError;

  if (typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500) {
    // 其余 4xx 一律收敛为 BAD_REQUEST，不向客户端透出 fastify 内部文案
    return appError('BAD_REQUEST', 'request shape is invalid');
  }
  return appError('INTERNAL');
}

export function installErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    return sendError(reply, appError('NOT_FOUND', 'route not found'), request.id);
  });

  app.setErrorHandler((err: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const appErr = normalizeError(err);
    if (appErr.code === 'INTERNAL' && !(err instanceof AppError)) {
      request.log.error({ err, requestId: request.id }, 'unhandled error');
    } else if (appErr.code === 'DB_UNAVAILABLE') {
      request.log.error({ err, requestId: request.id }, 'database unavailable');
    }
    return sendError(reply, appErr, request.id);
  });
}
