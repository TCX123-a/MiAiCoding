/**
 * 头像端点集成测试（docs/22 §3.4 #14/#15、§5.4 限流、§5.7 随行删除）。
 *
 * 覆盖：PUT 鉴权/媒体类型（application/json → 415、非 PNG 字节 → 415、空体）/ 业务 512KB 门
 * 与运输层 600KB 门（413）/ 内容寻址幂等（同内容同 hash）/ 10 次/时闸；GET 回原字节 +
 * image/png + nosniff + immutable / 按内容寻址跨账号可读（2026-10-22 排行榜头像）/
 * hash 过期（换头像后旧 hash 404）/ 形状非法 404。
 * 只动 test/**。
 */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AVATAR_MAX_BYTES } from '../../src/protocol.js';
import { bearer, createTestContext, register, type TestContext } from '../helpers/app.js';

const HIGH_LIMITS = {
  registerPerHourPerIp: 100_000,
  registerPerDayGlobal: 1_000_000,
  loginPer15MinPerIp: 10_000,
  apiPerMinute: 1_000_000,
};

/** 1×1 透明 PNG（67 字节，标准最小合法图） */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * 每个用例一份**独有**的 PNG 字节（PNG magic + 随机尾巴）。
 * 内容寻址是全局的（2026-10-22 起跨账号可读）：多个用例共用同一张 1×1 的话，
 * 「换头像后旧 hash 404」「没传过头像 404」都会被**别人**的同内容行救活。
 * 服务端只校验 magic，尾巴不影响这条端点的被测语义。
 */
function uniqPng(tag: string): Buffer {
  return Buffer.concat([PNG_1X1, Buffer.from(`${tag}:${randomUUID()}`)]);
}

let ctx: TestContext;
let ctxRate: TestContext;

beforeAll(async () => {
  ctx = await createTestContext({ rateLimits: HIGH_LIMITS });
  ctxRate = await createTestContext({ rateLimits: { ...HIGH_LIMITS, avatarUploadPerHourPerAccount: 2 } });
});

afterAll(async () => {
  await ctx.raw.close();
  await ctxRate.raw.close();
});

function put(token: string, contentType: string, payload: Buffer, app = ctx) {
  return app.app.inject({
    method: 'PUT',
    url: '/v1/avatar',
    headers: { ...bearer(token), 'content-type': contentType },
    payload,
  });
}

describe('PUT /v1/avatar', () => {
  it('上传成功 → 200 {hash}（sha256 对拍），DB 里 hash 与字节齐落', async () => {
    const reg = await register(ctx.app, 'ava_up');
    const token = reg.json().token as string;
    const id = reg.json().account.id as string;

    const res = await put(token, 'image/png', PNG_1X1);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ hash: sha256(PNG_1X1) });

    const row = await ctx.raw.query<{ avatar_hash: string; avatar_png: Uint8Array }>(
      `SELECT avatar_hash, avatar_png FROM users WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]!.avatar_hash).toBe(sha256(PNG_1X1));
    expect(Buffer.from(row.rows[0]!.avatar_png).equals(PNG_1X1)).toBe(true);
  });

  it('内容寻址幂等：同内容再传 → 同 hash（重写无害）', async () => {
    const token = (await register(ctx.app, 'ava_idem')).json().token as string;
    const first = await put(token, 'image/png', PNG_1X1);
    const second = await put(token, 'image/png', PNG_1X1);
    expect(second.statusCode).toBe(200);
    expect(second.json().hash).toBe(first.json().hash);
  });

  it('媒体类型与 PNG magic：application/json → 415；image/png 但非 PNG 字节 → 415', async () => {
    const token = (await register(ctx.app, 'ava_ct')).json().token as string;

    const asJson = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/avatar',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      payload: { not: 'png' },
    });
    expect(asJson.statusCode).toBe(415);
    expect(asJson.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');

    const jsonBytes = await put(token, 'application/json', Buffer.from('{"not":"png"}'));
    expect(jsonBytes.statusCode).toBe(415);

    const notPng = await put(token, 'image/png', Buffer.from('this is definitely not a png'));
    expect(notPng.statusCode).toBe(415);
    expect(notPng.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');

    const empty = await put(token, 'image/png', Buffer.alloc(0));
    expect(empty.statusCode).toBe(415);
  });

  it('两道体积门：>512KB 业务门 → 413；>600KB 运输门 → 413', async () => {
    const token = (await register(ctx.app, 'ava_big')).json().token as string;

    const justOver = await put(token, 'image/png', Buffer.concat([PNG_MAGIC, Buffer.alloc(AVATAR_MAX_BYTES)]));
    expect(justOver.statusCode).toBe(413);
    expect(justOver.json().error.code).toBe('PAYLOAD_TOO_LARGE');

    const wayOver = await put(token, 'image/png', Buffer.concat([PNG_MAGIC, Buffer.alloc(700 * 1024)]));
    expect(wayOver.statusCode).toBe(413);
  });

  it('未认证 → 401；限流闸：2 次/时——第三发 429', async () => {
    const anon = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/avatar',
      headers: { 'content-type': 'image/png' },
      payload: PNG_1X1,
    });
    expect(anon.statusCode).toBe(401);

    const token = (await register(ctxRate.app, 'ava_rate')).json().token as string;
    expect((await put(token, 'image/png', PNG_1X1, ctxRate)).statusCode).toBe(200);
    expect((await put(token, 'image/png', PNG_1X1, ctxRate)).statusCode).toBe(200);
    const third = await put(token, 'image/png', PNG_1X1, ctxRate);
    expect(third.statusCode).toBe(429);
    expect(third.json().error.retryAfterMs).toBeGreaterThan(0);
  });
});

describe('GET /v1/avatar/:hash', () => {
  it('回原字节 + image/png + nosniff + immutable 缓存', async () => {
    const token = (await register(ctx.app, 'ava_get')).json().token as string;
    const png = uniqPng('get');
    const hash = (await put(token, 'image/png', png)).json().hash as string;

    const res = await ctx.app.inject({ method: 'GET', url: `/v1/avatar/${hash}`, headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.rawPayload.equals(png)).toBe(true);
  });

  it('按内容寻址：别人拿我的 hash 也能读（排行榜）；形状非法/过期 hash 一律 404', async () => {
    const a = await register(ctx.app, 'ava_own_a');
    const b = await register(ctx.app, 'ava_own_b');
    const tokenA = a.json().token as string;
    const tokenB = b.json().token as string;
    const png = uniqPng('own');
    const hash = (await put(tokenA, 'image/png', png)).json().hash as string;

    // 跨账号可读：B 从未上传过，但 hash 指向 A 的这张图（内容寻址 = 公开可寻）
    const cross = await ctx.app.inject({ method: 'GET', url: `/v1/avatar/${hash}`, headers: bearer(tokenB) });
    expect(cross.statusCode).toBe(200);
    expect(cross.rawPayload.equals(png)).toBe(true);

    // hash 过期：换一张（不同内容）后旧 hash 找不回
    const other = uniqPng('own-new');
    const newHash = (await put(tokenA, 'image/png', other)).json().hash as string;
    expect(newHash).not.toBe(hash);
    const stale = await ctx.app.inject({ method: 'GET', url: `/v1/avatar/${hash}`, headers: bearer(tokenA) });
    expect(stale.statusCode).toBe(404);
    expect(
      (await ctx.app.inject({ method: 'GET', url: `/v1/avatar/${newHash}`, headers: bearer(tokenA) })).statusCode,
    ).toBe(200);

    // 形状非法：非 64 hex / 大写 / 少一位 → 404（不是 400：语义就是「没有这张头像」）
    for (const bad of ['zzzz', 'not-a-hash', 'A'.repeat(64), sha256(PNG_1X1).slice(0, 63), randomUUID()]) {
      const res = await ctx.app.inject({ method: 'GET', url: `/v1/avatar/${bad}`, headers: bearer(tokenA) });
      expect(res.statusCode, `hash=${bad}`).toBe(404);
    }
  });

  it('未认证 → 401；没传过头像 → 404', async () => {
    const hash = sha256(Buffer.from(`never-uploaded:${randomUUID()}`));
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/avatar/${hash}` })).statusCode).toBe(401);

    const token = (await register(ctx.app, 'ava_none')).json().token as string;
    const res = await ctx.app.inject({ method: 'GET', url: `/v1/avatar/${hash}`, headers: bearer(token) });
    expect(res.statusCode).toBe(404);
  });
});
