/**
 * 红队回归（安全审查 F1）：客户端可控输入必须收敛到 4xx，绝不落 500
 * （docs/22 §3.5 纪律：5xx 会让客户端按失败重试永不成功的请求）。
 * 四向量（来源 security-review.md 附录 P1/P1b 的运行时实测）：
 *   ① 深嵌套 JSON（6000 层）—— 服务端 JSON.stringify 抛 RangeError
 *   ② \u0000 转义（RFC 8259 合法）—— PG 22P05 unsupported Unicode escape
 *   ③ docVer = 2^31 溢出 int4 —— PG 22003 value out of range
 *   ④ 孤立代理项 \ud800 —— PG 22P02 invalid input syntax
 * 末尾两条正对照（正常文档 / depth=100）必须 200——判据要能红也要能绿。
 * 修复前基线：①②④ 落 500 INTERNAL、③ 落 500（22003 未映射）。
 */
import { describe, expect, it } from 'vitest';
import { bearer, createTestContext, register } from '../helpers/app.js';

async function setup() {
  const ctx = await createTestContext();
  const reg = await register(ctx.app, 'redteam_err');
  expect(reg.statusCode).toBe(201);
  return { ctx, headers: bearer(reg.json().token as string) };
}

async function putRaw(
  ctx: Awaited<ReturnType<typeof setup>>['ctx'],
  headers: Record<string, string>,
  body: string,
) {
  return ctx.app.inject({
    method: 'PUT',
    url: '/v1/docs/profile',
    headers: { ...headers, 'content-type': 'application/json' },
    payload: body,
  });
}

describe('F1 错误收敛：客户端可控输入绝不落 500', () => {
  it('深嵌套 JSON（6000 层）→ 400 VALIDATION_FAILED，不是 500', async () => {
    const { ctx, headers } = await setup();
    const depth = 6000;
    // 手搓字符串（对象在构造端就会撞上同一个 stringify 深度上限，发不出去）；
    // 注意必须是完整 putDocBody 形状（docVer/baseRevision/payload），缺字段会被 zod 在入口拦下（假绿）
    const body = `{"docVer":1,"baseRevision":null,"payload":{"version":1,"x":${'{"x":'.repeat(depth - 1)}1${'}'.repeat(depth)}}`;
    // 构造自检：body 必须是合法 JSON 且未被外层 schema 拦截（构造错了会让本用例假绿/假红，先钉死）
    expect(() => JSON.parse(body)).not.toThrow();
    expect(Object.keys(JSON.parse(body))).toEqual(['docVer', 'baseRevision', 'payload']);

    const res = await putRaw(ctx, headers, body);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    await ctx.raw.close();
  });

  it('\\u0000 转义（合法 JSON）→ 400，不是 500', async () => {
    const { ctx, headers } = await setup();
    const res = await putRaw(
      ctx,
      headers,
      JSON.stringify({ docVer: 1, baseRevision: null, payload: { version: 1, s: 'a\u0000b' } }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    await ctx.raw.close();
  });

  it('docVer = 2^31 溢出 int4 → 400，不是 500', async () => {
    const { ctx, headers } = await setup();
    const huge = 2 ** 31;
    const res = await putRaw(
      ctx,
      headers,
      JSON.stringify({ docVer: huge, baseRevision: null, payload: { version: huge } }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    await ctx.raw.close();
  });

  it('孤立代理项 \\ud800 → 400，不是 500', async () => {
    const { ctx, headers } = await setup();
    const res = await putRaw(
      ctx,
      headers,
      JSON.stringify({ docVer: 1, baseRevision: null, payload: { version: 1, s: '\ud800' } }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    await ctx.raw.close();
  });

  it('正对照：正常文档 → 200（防过度拦截）', async () => {
    const { ctx, headers } = await setup();
    const res = await putRaw(
      ctx,
      headers,
      JSON.stringify({ docVer: 1, baseRevision: null, payload: { version: 1, name: 'ok' } }),
    );
    expect(res.statusCode).toBe(200);
    await ctx.raw.close();
  });

  it('正对照：depth=100 的合法嵌套 → 200（深度阈值不误伤正常文档）', async () => {
    const { ctx, headers } = await setup();
    let deep: unknown = 1;
    for (let i = 0; i < 100; i += 1) deep = { x: deep };
    const res = await putRaw(
      ctx,
      headers,
      JSON.stringify({ docVer: 1, baseRevision: null, payload: { version: 1, deep } }),
    );
    expect(res.statusCode).toBe(200);
    await ctx.raw.close();
  });
});
