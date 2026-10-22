/**
 * 红队验收 · 文档体积门（docs/22 §4.4）与 DB 硬顶映射（§3.5：23514 → 413，绝不落 500）。
 *  - 量纲统一 = octet_length(payload::text)：上限 ±1 字节的通过与拒绝；「恰好等于上限」必须通过；
 *  - 尺子自检：构造 payload 后用同一 SQL 先算实际字节，与目标不符立即抛错（判据失效要当场红）；
 *  - DB 硬顶出口：用故障注入让写库语句抛 23514 user_docs_payload_size，断言 HTTP 出口是 413
 *    而非 500；负对照（同位置抛非映射错误）必须是 500 且不泄露内部细节；
 *  - 传输层 bodyLimit 恰等边界（fastify 语义 = 严格大于才 413）。
 * 只动 test/**，src 缺陷只记录不修。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import type { Db, Queryable } from '../../src/db/pool.js';
import { AUTH_BODY_LIMIT, DOC_SIZE_LIMITS, type DocType } from '../../src/protocol.js';
import type { AppInstance } from '../../src/plugins/shared.js';
import {
  bearer,
  createTestContext,
  register,
  TEST_QUESTION,
  type TestContext,
} from '../helpers/app.js';
import { createTestDatabase, type TestRawClient } from '../helpers/db.js';

const HIGH_LIMITS = {
  registerPerHourPerIp: 100_000,
  registerPerDayGlobal: 1_000_000,
  loginPer15MinPerIp: 10_000,
  apiPerMinute: 1_000_000,
};

let ctx: TestContext;
let token = '';

beforeAll(async () => {
  ctx = await createTestContext({ rateLimits: HIGH_LIMITS });
  token = (await register(ctx.app, 'size_gate')).json().token as string;
});
afterAll(async () => {
  await ctx.raw.close();
});

async function canonicalSize(raw: TestRawClient, jsonText: string): Promise<number> {
  const { rows } = await raw.query<{ size: number | string }>(
    'SELECT octet_length($1::jsonb::text) AS size',
    [jsonText],
  );
  return Number(rows[0]!.size);
}

/**
 * 造一个 canonical 字节数恰为 targetBytes 的 {version:1, pad:'x'*k}（'x' 不触发 JSON 转义，斜率为 1）。
 * 自检不符即抛错——标定失效必须当场红，不能拿错尺子做判据。
 */
async function payloadWithExactBytes(targetBytes: number): Promise<Record<string, unknown>> {
  const base = await canonicalSize(ctx.raw, JSON.stringify({ version: 1, pad: '' }));
  const payload = { version: 1, pad: 'x'.repeat(targetBytes - base) };
  const actual = await canonicalSize(ctx.raw, JSON.stringify(payload));
  if (actual !== targetBytes) {
    throw new Error(`标定失效：目标 ${targetBytes} 字节，实际 ${actual} 字节`);
  }
  return payload;
}

function putDoc(
  docType: DocType,
  body: { docVer: number; baseRevision: number | null; payload: Record<string, unknown> },
  bearerToken = token,
) {
  return ctx.app.inject({
    method: 'PUT',
    url: `/v1/docs/${docType}`,
    headers: bearer(bearerToken),
    payload: body,
  });
}

describe('按类型分档体积门：上限 ±1 字节', () => {
  it('profile 恰好 2 MiB → 200；摘要 sizeBytes 恰等于上限（量纲统一实证）', async () => {
    const limit = DOC_SIZE_LIMITS.profile;
    const payload = await payloadWithExactBytes(limit);
    const res = await putDoc('profile', { docVer: 1, baseRevision: null, payload });
    expect(res.statusCode).toBe(200);
    expect(res.json().revision).toBe(1);

    const summary = await ctx.app.inject({ method: 'GET', url: '/v1/docs', headers: bearer(token) });
    expect(summary.json().profile.sizeBytes).toBe(limit);
  });

  it('profile 上限+1 字节 → 413 PAYLOAD_TOO_LARGE，details 精确；revision 不变（回滚正对照）', async () => {
    const limit = DOC_SIZE_LIMITS.profile;
    const payload = await payloadWithExactBytes(limit + 1);
    const res = await putDoc('profile', { docVer: 1, baseRevision: 1, payload });
    expect(res.statusCode).toBe(413);
    const body = res.json();
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.error.details).toEqual({ docType: 'profile', sizeBytes: limit + 1, limitBytes: limit });

    const get = await ctx.app.inject({ method: 'GET', url: '/v1/docs/profile', headers: bearer(token) });
    expect(get.json().revision).toBe(1); // 超限写入未落库
  });

  it('practice 恰好 8 MiB → 200（最大档仍稳在 9.5 MiB 传输限内）', async () => {
    const limit = DOC_SIZE_LIMITS.practice;
    const payload = await payloadWithExactBytes(limit);
    const res = await putDoc('practice', { docVer: 1, baseRevision: null, payload });
    expect(res.statusCode).toBe(200);

    const summary = await ctx.app.inject({ method: 'GET', url: '/v1/docs', headers: bearer(token) });
    expect(summary.json().practice.sizeBytes).toBe(limit);
  });

  it('practice 上限+1 字节 → 413（业务门先于任何 CAS/写库动作）', async () => {
    const limit = DOC_SIZE_LIMITS.practice;
    const payload = await payloadWithExactBytes(limit + 1);
    const res = await putDoc('practice', { docVer: 1, baseRevision: 1, payload });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.details.sizeBytes).toBe(limit + 1);
    expect(res.json().error.details.limitBytes).toBe(limit);
  });

  it('分档差异抽查：wrongbook 4MiB+1 与 favorites 2MiB+1 各自按本档上限拒绝，且行未创建', async () => {
    for (const docType of ['wrongbook', 'favorites'] as const) {
      const limit = DOC_SIZE_LIMITS[docType];
      const payload = await payloadWithExactBytes(limit + 1);
      const res = await putDoc(docType, { docVer: 1, baseRevision: null, payload });
      expect(res.statusCode, docType).toBe(413);
      expect(res.json().error.details.limitBytes, docType).toBe(limit);
    }
    const summary = await ctx.app.inject({ method: 'GET', url: '/v1/docs', headers: bearer(token) });
    expect(summary.json().wrongbook).toBeNull();
    expect(summary.json().favorites).toBeNull();
  });
});

describe('DB 硬顶（23514 user_docs_payload_size）→ 413 出口，绝不落 500', () => {
  /** 故障注入：在指定 SQL 上抛构造好的驱动错误；其余查询透传 */
  function faultInjectDb(real: Db) {
    let fault: { match: RegExp; error: unknown } | null = null;
    const wrap = (q: Queryable): Queryable => ({
      async query<R = Record<string, unknown>>(text: string, params?: unknown[]) {
        if (fault && fault.match.test(text)) throw fault.error;
        return q.query<R>(text, params);
      },
    });
    const db: Db = {
      query: (text, params) => wrap(real).query(text, params),
      withTransaction: (fn) => real.withTransaction((tx) => fn(wrap(tx))),
    };
    return {
      db,
      arm: (match: RegExp, error: unknown) => {
        fault = { match, error };
      },
      disarm: () => {
        fault = null;
      },
    };
  }

  let faultCtx: { raw: TestRawClient; app: AppInstance };
  let fault: ReturnType<typeof faultInjectDb>;
  let faultToken = '';

  beforeAll(async () => {
    const database = await createTestDatabase();
    fault = faultInjectDb(database.db);
    const app = await buildApp({
      db: fault.db,
      config: loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://unused-test-harness/unused' }),
    });
    faultCtx = { raw: database.raw, app };
    faultToken = (await register(faultCtx.app, 'fault_u')).json().token as string;
  });

  afterAll(async () => {
    await faultCtx.raw.close();
  });

  it('写库抛 23514 硬顶 → HTTP 413 PAYLOAD_TOO_LARGE（带 requestId）；解除后同请求 200', async () => {
    const pgError = Object.assign(
      new Error('new row for relation "user_docs" violates check constraint "user_docs_payload_size"'),
      { code: '23514', constraint: 'user_docs_payload_size' },
    );
    fault.arm(/INSERT INTO user_docs/, pgError);

    const res = await faultCtx.app.inject({
      method: 'PUT',
      url: '/v1/docs/profile',
      headers: bearer(faultToken),
      payload: { docVer: 1, baseRevision: null, payload: { version: 1, note: 'fault-probe' } },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(typeof res.json().error.requestId).toBe('string');

    fault.disarm();
    const ok = await faultCtx.app.inject({
      method: 'PUT',
      url: '/v1/docs/profile',
      headers: bearer(faultToken),
      payload: { docVer: 1, baseRevision: null, payload: { version: 1, note: 'fault-probe' } },
    });
    expect(ok.statusCode).toBe(200); // 事务回滚干净、无半写状态
    expect(ok.json().revision).toBe(1);
  });

  it('负对照：同注入位点抛非映射错误 → 500 INTERNAL 且响应不含内部细节', async () => {
    fault.arm(/INSERT INTO user_docs/, new Error('SECRET_INTERNAL_MARKER_4721'));
    const res = await faultCtx.app.inject({
      method: 'PUT',
      url: '/v1/docs/wrongbook',
      headers: bearer(faultToken),
      payload: { docVer: 1, baseRevision: null, payload: { version: 1 } },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('INTERNAL');
    expect(res.json().error.message).toBe('internal server error');
    expect(JSON.stringify(res.json())).not.toContain('SECRET_INTERNAL_MARKER_4721');
    fault.disarm();
  });
});

describe('传输层 bodyLimit 恰等边界（fastify：严格大于才 413）', () => {
  it('认证 JSON：恰 16384B 过传输层（业务校验 400）；16385B → 413', async () => {
    const mk = (total: number) => {
      // 问答字段给合法值（2026-10-13 起注册必填）——本用例的意图是「恰过传输层、卡在
      // 业务校验（密码 >128）」，不掺「缺字段」的第二变量
      const head = `{"username":"exact16k","securityQuestion":${JSON.stringify(TEST_QUESTION)},"securityAnswer":"a","password":"`;
      const tail = '"}';
      const n = total - Buffer.byteLength(head) - Buffer.byteLength(tail);
      const body = `${head}${'p'.repeat(n)}${tail}`;
      expect(Buffer.byteLength(body)).toBe(total); // 尺子自检
      return body;
    };

    const atLimit = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: mk(AUTH_BODY_LIMIT),
    });
    expect(atLimit.statusCode).toBe(400); // 过了传输层，卡在业务校验（密码 >128）
    expect(atLimit.json().error.code).toBe('VALIDATION_FAILED');

    const over = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: mk(AUTH_BODY_LIMIT + 1),
    });
    expect(over.statusCode).toBe(413);
    expect(over.json().error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
