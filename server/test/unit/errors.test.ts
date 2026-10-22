import { describe, expect, it } from 'vitest';
import {
  AppError,
  appError,
  ERROR_CODES,
  HTTP_STATUS_BY_CODE,
  mapDatabaseError,
  toErrorBody,
} from '../../src/lib/errors.js';

describe('错误码体系（docs/22 §3.5 的 16 个 + docs/26 §4.7 的 3 个 + 找回链 2 个 + 改名校验 1 个）', () => {
  it('22 个错误码每个都有 HTTP 状态映射', () => {
    expect(ERROR_CODES.length).toBe(22);
    for (const code of ERROR_CODES) {
      expect(HTTP_STATUS_BY_CODE[code]).toBeGreaterThanOrEqual(400);
    }
    expect(HTTP_STATUS_BY_CODE.CONFLICT_STALE).toBe(409);
    expect(HTTP_STATUS_BY_CODE.PAYLOAD_TOO_LARGE).toBe(413);
    expect(HTTP_STATUS_BY_CODE.PROTOCOL_TOO_OLD).toBe(426);
    expect(HTTP_STATUS_BY_CODE.DB_UNAVAILABLE).toBe(503);
    // docs/26 新增三码（全部 409）
    expect(HTTP_STATUS_BY_CODE.CHALLENGE_DUPLICATE).toBe(409);
    expect(HTTP_STATUS_BY_CODE.ENTRY_CONFLICT).toBe(409);
    expect(HTTP_STATUS_BY_CODE.OVER_DAILY_CAP).toBe(409);
    // 找回链两码（2026-10-13）：存量账号无问答 404 / 答案错 401
    expect(HTTP_STATUS_BY_CODE.NO_SECURITY_QUESTION).toBe(404);
    expect(HTTP_STATUS_BY_CODE.BAD_SECURITY_ANSWER).toBe(401);
    // 改名校验（2026-10-22）：违禁词 400（重名是既有的 USERNAME_TAKEN 409）
    expect(HTTP_STATUS_BY_CODE.USERNAME_FORBIDDEN).toBe(400);
  });

  it('错误体结构：code/message/requestId（+可选 retryAfterMs/details）', () => {
    const err = appError('RATE_LIMITED', 'slow down', { retryAfterMs: 1500, details: { bucket: 'reg' } });
    const body = toErrorBody(err, 'req-1');
    expect(body).toEqual({
      error: { code: 'RATE_LIMITED', message: 'slow down', retryAfterMs: 1500, details: { bucket: 'reg' }, requestId: 'req-1' },
    });
    const plain = toErrorBody(new AppError('INTERNAL'), 'req-2');
    expect(plain.error.message).toBe('internal server error');
    expect('details' in plain.error).toBe(false);
  });
});

describe('mapDatabaseError（23514 分流 / 23505 分流 / 连接类 503）', () => {
  it('23514 + user_docs_payload_size → 413 PAYLOAD_TOO_LARGE', () => {
    const mapped = mapDatabaseError({ code: '23514', constraint: 'user_docs_payload_size' });
    expect(mapped?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('其它 23514 CHECK 违约 → 400 VALIDATION_FAILED（绝不落 500）', () => {
    const mapped = mapDatabaseError({ code: '23514', constraint: 'user_docs_doc_type_allowed' });
    expect(mapped?.code).toBe('VALIDATION_FAILED');
    expect(HTTP_STATUS_BY_CODE[mapped!.code]).toBe(400);
  });

  it('23505 + users_username_lower_key → 409 USERNAME_TAKEN；其它唯一冲突 → 500', () => {
    expect(mapDatabaseError({ code: '23505', constraint: 'users_username_lower_key' })?.code).toBe('USERNAME_TAKEN');
    expect(mapDatabaseError({ code: '23505', constraint: 'sessions_token_hash_key' })?.code).toBe('INTERNAL');
  });

  it('连接类错误 → 503 DB_UNAVAILABLE 且带 Retry-After 数据', () => {
    const refused = mapDatabaseError({ code: 'ECONNREFUSED' });
    expect(refused?.code).toBe('DB_UNAVAILABLE');
    expect(refused?.retryAfterMs).toBeGreaterThan(0);
    expect(mapDatabaseError({ code: '57P01' })?.code).toBe('DB_UNAVAILABLE');
  });

  it('字段缺失时回退解析 message（PGlite 兼容路径）', () => {
    const err = new Error('new row for relation "user_docs" violates check constraint "user_docs_payload_size"');
    expect(mapDatabaseError(err)?.code).toBe('PAYLOAD_TOO_LARGE');
    const dup = new Error(
      'duplicate key value violates unique constraint "users_username_lower_key"',
    );
    expect(mapDatabaseError(dup)?.code).toBe('USERNAME_TAKEN');
  });

  it('无法识别的错误返回 null（调用方兜底 INTERNAL）', () => {
    expect(mapDatabaseError(new Error('some other failure'))).toBeNull();
    expect(mapDatabaseError(undefined)).toBeNull();
  });
});
