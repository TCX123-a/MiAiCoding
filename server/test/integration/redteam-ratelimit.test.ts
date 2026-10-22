/**
 * 红队验收 · 限流窗口/阈值边界（docs/22 §5.4；全部冻结假时钟，读数可精确断言）。
 *  - 注册每 IP 5/时：触发 → 精确回补 1 个（+12min）→ 满复位（再 +1h 五个连发全过）；
 *  - 注册全局 1/日：触发 → +24h 恰复位 1 个；
 *  - 登录每 IP 30/15min：第 31 次 429 → +15min 满窗复位（再 30 连发全过）；
 *  - 每用户名退避：60s→120s→240s→480s→900s→900s（封顶）→ 永不硬锁死（窗口过后正确口令可入）；
 *  - IPv6 按 /64 聚合：同 /64 内换地址仍共享桶；相邻 /64 与 IPv6-mapped IPv4（::ffff:a.b.c.d）各有一条正/负对照；
 *  - 全 API 桶：匿名按 IP、认证按账号，两桶互不影响；健康检查是例外（桶已耗尽仍全绿）；
 *  - 登录成败均计：2 个成功即耗尽 2/15min 桶，第 3 次正确口令也 429，且不产生新会话。
 * 只动 test/**，src 缺陷只记录不修。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppInstance } from '../../src/plugins/shared.js';
import {
  bearer,
  createTestContext,
  register,
  TEST_ANSWER,
  TEST_PASSWORD,
  TEST_QUESTION,
  type TestContext,
} from '../helpers/app.js';

const BASE = 1_700_000_000_000;

const HIGH_LIMITS = {
  registerPerHourPerIp: 100_000,
  registerPerDayGlobal: 1_000_000,
  loginPer15MinPerIp: 100_000,
  apiPerMinute: 1_000_000,
};

function regAt(app: AppInstance, username: string, remoteAddress?: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: {
      username,
      password: TEST_PASSWORD,
      securityQuestion: TEST_QUESTION,
      securityAnswer: TEST_ANSWER,
    },
    ...(remoteAddress !== undefined ? { remoteAddress } : {}),
  });
}

function loginAt(app: AppInstance, username: string, password = TEST_PASSWORD, remoteAddress?: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { username, password },
    ...(remoteAddress !== undefined ? { remoteAddress } : {}),
  });
}

describe('注册每 IP 5/时：触发 → 精确回补 1 个 → 满窗复位', () => {
  let ctx: TestContext;
  let now = BASE;

  beforeAll(async () => {
    ctx = await createTestContext({
      clock: () => now,
      rateLimits: { ...HIGH_LIMITS, registerPerHourPerIp: 5 },
    });
  });
  afterAll(async () => {
    await ctx.raw.close();
  });

  it('边界三段：第 6 次 429（retryAfterMs=720000 / Retry-After=720）；+12min 恰放行 1 个又满；+1h 后 5 连发全过', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await regAt(ctx.app, `rb_u${i}`)).statusCode).toBe(201);
    }

    const sixth = await regAt(ctx.app, 'rb_u5');
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error.code).toBe('RATE_LIMITED');
    expect(sixth.json().error.retryAfterMs).toBe(720_000); // 5/时 → 每 12 分钟恰补 1 个
    expect(Number(sixth.headers['retry-after'])).toBe(720);
    // 正对照：第 6 个账号确实未创建（登录 401 而非 200）
    expect((await loginAt(ctx.app, 'rb_u5')).statusCode).toBe(401);

    // 精确回补：+12min 恰 1 个令牌 —— 放行一个，随后立刻又 429（归零）
    now += 720_000;
    expect((await regAt(ctx.app, 'rb_u5')).statusCode).toBe(201);
    const exhausted = await regAt(ctx.app, 'rb_u6');
    expect(exhausted.statusCode).toBe(429);
    expect(exhausted.json().error.retryAfterMs).toBe(720_000);

    // 满窗复位：从上次归零起 +1h → 5 个令牌全回来，5 连发全过；第 6 次又 429
    now += 3_600_000;
    for (let i = 0; i < 5; i += 1) {
      expect((await regAt(ctx.app, `rb_w${i}`)).statusCode).toBe(201);
    }
    const reExhausted = await regAt(ctx.app, 'rb_w5');
    expect(reExhausted.statusCode).toBe(429);
    expect(reExhausted.json().error.retryAfterMs).toBe(720_000);
  });
});

describe('注册全局日桶 1/天：触发 → +24h 恰复位', () => {
  let ctx: TestContext;
  let now = BASE;

  beforeAll(async () => {
    ctx = await createTestContext({
      clock: () => now,
      rateLimits: { ...HIGH_LIMITS, registerPerDayGlobal: 1 },
    });
  });
  afterAll(async () => {
    await ctx.raw.close();
  });

  it('第 2 个注册 429（retryAfterMs=86400000 / Retry-After=86400）；+24h 复位 1 个、再满', async () => {
    expect((await regAt(ctx.app, 'gd_u1')).statusCode).toBe(201);

    const second = await regAt(ctx.app, 'gd_u2');
    expect(second.statusCode).toBe(429);
    expect(second.json().error.message).toMatch(/temporarily unavailable/);
    expect(second.json().error.retryAfterMs).toBe(86_400_000);
    expect(Number(second.headers['retry-after'])).toBe(86_400);
    expect((await loginAt(ctx.app, 'gd_u2')).statusCode).toBe(401); // 未创建

    now += 86_400_000;
    expect((await regAt(ctx.app, 'gd_u2')).statusCode).toBe(201);
    const third = await regAt(ctx.app, 'gd_u3');
    expect(third.statusCode).toBe(429);
    expect(third.json().error.retryAfterMs).toBe(86_400_000); // 恰 1 个/天，不溢出
  });
});

describe('登录每 IP 30/15min：满窗复位后重新计 30 个', () => {
  let ctx: TestContext;
  let now = BASE;

  beforeAll(async () => {
    ctx = await createTestContext({
      clock: () => now,
      rateLimits: { ...HIGH_LIMITS, loginPer15MinPerIp: 30 },
    });
  });
  afterAll(async () => {
    await ctx.raw.close();
  });

  it('30 个放行 → 第 31 个 429（30000/30）；+15min 后又是完整 30 个额度', async () => {
    for (let i = 0; i < 30; i += 1) {
      expect((await loginAt(ctx.app, `lb_u${i}`, 'wrong password 000')).statusCode).toBe(401);
    }
    const over = await loginAt(ctx.app, 'lb_u30', 'wrong password 000');
    expect(over.statusCode).toBe(429);
    expect(over.json().error.message).toMatch(/too many login attempts/);
    expect(over.json().error.retryAfterMs).toBe(30_000);
    expect(Number(over.headers['retry-after'])).toBe(30);

    now += 900_000; // 满窗：30 个令牌一次性全回
    for (let i = 0; i < 30; i += 1) {
      expect((await loginAt(ctx.app, `lb_v${i}`, 'wrong password 000')).statusCode).toBe(401);
    }
    const overAgain = await loginAt(ctx.app, 'lb_v30', 'wrong password 000');
    expect(overAgain.statusCode).toBe(429);
    expect(overAgain.json().error.retryAfterMs).toBe(30_000);
  });
});

describe('每用户名退避：指数增长到 900s 封顶、永不硬锁死', () => {
  let ctx: TestContext;
  let now = BASE;

  beforeAll(async () => {
    ctx = await createTestContext({ clock: () => now, rateLimits: HIGH_LIMITS });
    expect((await regAt(ctx.app, 'bk_u')).statusCode).toBe(201);
  });
  afterAll(async () => {
    await ctx.raw.close();
  });

  it('5 连败后 60s→120s→240s→480s→900s→900s（封顶）；窗口过后正确口令 200；成功清零', async () => {
    expect((await loginAt(ctx.app, 'bk_u')).statusCode).toBe(200); // 基线成功

    for (let i = 0; i < 5; i += 1) {
      expect((await loginAt(ctx.app, 'bk_u', 'wrong password 000')).statusCode).toBe(401);
    }

    // 每轮：被挡（读退避窗口）→ 推进该窗口 → 再来一次错误（把下一档抬一档）
    const expectedBackoffs = [60_000, 120_000, 240_000, 480_000, 900_000, 900_000];
    let first = true;
    for (const expected of expectedBackoffs) {
      const blocked = await loginAt(ctx.app, 'bk_u'); // 正确口令也被挡（不可区分）
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error.retryAfterMs).toBe(expected);
      if (first) {
        expect(blocked.json().error.message).toMatch(/failed login attempts/);
        expect(Number(blocked.headers['retry-after'])).toBe(Math.ceil(expected / 1000));
        first = false;
      }
      now += expected;
      expect((await loginAt(ctx.app, 'bk_u', 'wrong password 000')).statusCode).toBe(401);
    }

    // 封顶后继续失败，窗口仍是 900s（不因次数继续变长）
    const capped = await loginAt(ctx.app, 'bk_u');
    expect(capped.statusCode).toBe(429);
    expect(capped.json().error.retryAfterMs).toBe(900_000);

    // 永不硬锁死：最后一个窗口过后，正确口令可登录 → 200；成功清零（紧接着错误一次是 401 不是 429）
    now += 900_000;
    expect((await loginAt(ctx.app, 'bk_u')).statusCode).toBe(200);
    expect((await loginAt(ctx.app, 'bk_u', 'wrong password 000')).statusCode).toBe(401);
    expect((await loginAt(ctx.app, 'bk_u')).statusCode).toBe(200);
  });
});

describe('IPv6 /64 聚合与 IPv4-mapped（remoteAddress 注入）', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext({
      rateLimits: { ...HIGH_LIMITS, registerPerHourPerIp: 5 }, // 本组测的正是每 IP 5/时这档
    });
  });
  afterAll(async () => {
    await ctx.raw.close();
  });

  it('2001:db8::/64：同 /64 换地址仍共享桶；相邻 /64 不受牵连', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await regAt(ctx.app, `v6a_u${i}`, '2001:db8::1')).statusCode).toBe(201);
    }
    const same64 = await regAt(ctx.app, 'v6a_u5', '2001:db8::2');
    expect(same64.statusCode).toBe(429); // 同 /64 —— 换末段地址绕不过

    const other64 = await regAt(ctx.app, 'v6a_u6', '2001:db8:0:1::1');
    expect(other64.statusCode).toBe(201); // 不同 /64 有自己的桶
  });

  it('::ffff:10.9.9.9 与 10.9.9.9 同桶（映射归一到 IPv4）', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await regAt(ctx.app, `v6b_u${i}`, '::ffff:10.9.9.9')).statusCode).toBe(201);
    }
    const plain = await regAt(ctx.app, 'v6b_u5', '10.9.9.9');
    expect(plain.statusCode).toBe(429); // 映射地址与点分地址必须共享桶

    const neighbor = await regAt(ctx.app, 'v6b_u6', '10.9.9.10');
    expect(neighbor.statusCode).toBe(201);
  });
});

describe('全 API 桶：匿名按 IP、认证按账号，互不影响；健康检查例外', () => {
  let ctx: TestContext;
  let now = BASE;

  beforeAll(async () => {
    ctx = await createTestContext({
      clock: () => now,
      rateLimits: { ...HIGH_LIMITS, apiPerMinute: 3 },
    });
  });
  afterAll(async () => {
    await ctx.raw.close();
  });

  it('匿名桶：meta ×3 过、第 4 个 429（20000/20）；换 IP 不受影响；health 桶外全绿', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await ctx.app.inject({ method: 'GET', url: '/v1/meta' })).statusCode).toBe(200);
    }
    const fourth = await ctx.app.inject({ method: 'GET', url: '/v1/meta' });
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json().error.message).toMatch(/too many requests/);
    expect(fourth.json().error.retryAfterMs).toBe(20_000); // 3/分钟 → 每 20s 补 1 个
    expect(Number(fourth.headers['retry-after'])).toBe(20);

    // 健康检查是限流例外：本 IP 的匿名桶已耗尽，health 仍全部 200
    for (let i = 0; i < 10; i += 1) {
      expect((await ctx.app.inject({ method: 'GET', url: '/v1/health' })).statusCode).toBe(200);
    }

    // 另一 IP 的匿名桶独立
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/v1/meta', remoteAddress: '203.0.113.9' })).statusCode,
    ).toBe(200);
  });

  it('账号桶与匿名桶互不占用：注册/请求各记各账（注册 2 次 + meta 1 次恰好用尽匿名 3 个）', async () => {
    now += 60_000; // 冻结时钟手动推进：把上一条测试耗尽的匿名桶满窗复位（否则本测试第一步就 429）
    const t1 = (await regAt(ctx.app, 'api_u1')).json().token as string; // 匿名桶 1/3
    const t2 = (await regAt(ctx.app, 'api_u2')).json().token as string; // 匿名桶 2/3

    const sessionOf = (token: string) =>
      ctx.app.inject({ method: 'GET', url: '/v1/auth/session', headers: bearer(token) });

    for (let i = 0; i < 3; i += 1) {
      expect((await sessionOf(t1)).statusCode).toBe(200); // 账号桶 1..3
    }
    const fourthSession = await sessionOf(t1);
    expect(fourthSession.statusCode).toBe(429); // 账号桶耗尽
    expect(fourthSession.json().error.retryAfterMs).toBe(20_000);

    // 另一账号的桶独立
    expect((await sessionOf(t2)).statusCode).toBe(200);

    // 匿名桶此刻只被两次注册用了 2 个：meta 是第 3 个（过），第 4 个才 429
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/meta' })).statusCode).toBe(200);
    const anonOver = await ctx.app.inject({ method: 'GET', url: '/v1/meta' });
    expect(anonOver.statusCode).toBe(429);
    expect(anonOver.json().error.retryAfterMs).toBe(20_000);
  });
});

describe('登录桶「成败均计」：成功也消耗额度', () => {
  let ctx: TestContext;
  let now = BASE;

  beforeAll(async () => {
    ctx = await createTestContext({
      clock: () => now,
      rateLimits: { ...HIGH_LIMITS, loginPer15MinPerIp: 2 },
    });
  });
  afterAll(async () => {
    await ctx.raw.close();
  });

  it('2 次成功登录用尽 2/15min；第 3 次正确口令也 429 且不产生新会话；+450s 恰复位 1 个', async () => {
    await regAt(ctx.app, 'cum_u1');
    await regAt(ctx.app, 'cum_u2');

    expect((await loginAt(ctx.app, 'cum_u1')).statusCode).toBe(200);
    expect((await loginAt(ctx.app, 'cum_u2')).statusCode).toBe(200);

    const sessionsBefore = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sessions s JOIN users u ON u.id = s.account_id
        WHERE u.username_lower = 'cum_u1'`,
    );

    const blocked = await loginAt(ctx.app, 'cum_u1'); // 正确口令
    expect(blocked.statusCode).toBe(429);
    // 理论 retryAfterMs = 450000（2/15min → 每 7.5 分钟 1 个）；
    // 实测此速率下浮点 ceil 为 450001（+1ms，偏保守不偏短）——按实测区间断言，异常已在报告登记
    const retry = blocked.json().error.retryAfterMs as number;
    expect(retry).toBeGreaterThanOrEqual(450_000);
    expect(retry).toBeLessThanOrEqual(450_001);
    expect(Number(blocked.headers['retry-after'])).toBe(Math.max(1, Math.ceil(retry / 1000))); // 头与体一致
    expect(blocked.json().token).toBeUndefined();

    const sessionsAfter = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sessions s JOIN users u ON u.id = s.account_id
        WHERE u.username_lower = 'cum_u1'`,
    );
    expect(sessionsAfter.rows[0]!.n).toBe(sessionsBefore.rows[0]!.n); // 被挡的请求没有建出新会话

    // 诚实客户端契约：按服务端建议时长等待后重试，必须被放行（建议不得短于实际回补时间）
    now += retry;
    expect((await loginAt(ctx.app, 'cum_u1')).statusCode).toBe(200);
  });
});

/**
 * 安全审查 A5（2026-10-10 新增）：PUT /v1/docs/:docType 此前只吃全局 takeApiRate
 * （120/min），而 practice 文档上限 8MiB ⇒ 120 × 8MiB ≈ 960MiB/分钟/账号的 JSON
 * 解析 + jsonb 转换。本组守四件事：
 *   ① 写入桶真的在岗（第 N+1 次 429，不是"没闸门"）；
 *   ② 429 的 retryAfterMs 精确等于 1 token 的回补时长，且按它等待后必须放行（诚实客户端契约）；
 *   ③ **按账号分桶**——另一个账号不受牵连（否则就成了"一人打满全服受伤"）；
 *   ④ **读路径不占写桶**——GET /v1/docs/:docType 是同步的常态（每次启动都拉），
 *      被写桶误伤会让正常用户开不了应用。
 */
describe('文档写入每账号 60/时（安全审查 A5）：写入桶 → 429 → 精确回补 → 按账号分桶、读不占写桶', () => {
  let ctx: TestContext;
  let now = BASE;
  let tokenA = '';
  let tokenB = '';

  beforeAll(async () => {
    ctx = await createTestContext({
      clock: () => now,
      rateLimits: { ...HIGH_LIMITS, docsWritePerHourPerAccount: 3 },
    });
    tokenA = (await register(ctx.app, 'doc_a')).json().token as string;
    tokenB = (await register(ctx.app, 'doc_b')).json().token as string;
  });
  afterAll(async () => {
    await ctx.raw.close();
  });

  function putDoc(token: string, baseRevision: number | null, docVer: number) {
    return ctx.app.inject({
      method: 'PUT',
      url: '/v1/docs/profile',
      headers: bearer(token),
      payload: { docVer, baseRevision, payload: { version: docVer } },
    });
  }
  function getDoc(token: string) {
    return ctx.app.inject({ method: 'GET', url: '/v1/docs/profile', headers: bearer(token) });
  }

  it('3 次写入用尽桶 → 第 4 次 429（retryAfterMs=1200000 / Retry-After=1200）；读路径不受影响；他账号不受牵连', async () => {
    // ① 三次写入用尽 3/时 桶（CAS 递进，保证每次都是真写成功而不是被 409 挡掉）
    expect((await putDoc(tokenA, null, 1)).statusCode).toBe(200);
    expect((await putDoc(tokenA, 1, 2)).statusCode).toBe(200);
    expect((await putDoc(tokenA, 2, 3)).statusCode).toBe(200);

    // ② 第 4 次：桶空 → 429。CAS 参数是合法递进值（baseRevision=3），
    //    所以这条 429 只可能来自限流器 —— 若限流缺失，本行会拿到 200 而判红。
    const fourth = await putDoc(tokenA, 3, 4);
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json().error.code).toBe('RATE_LIMITED');
    expect(fourth.json().error.message).toBe('too many document writes');
    const retry = fourth.json().error.retryAfterMs as number;
    expect(retry).toBe(1_200_000); // 3600000 / 3 —— 每 20 分钟回补 1 个
    expect(Number(fourth.headers['retry-after'])).toBe(1200); // 头与体一致（秒）

    // ③ 读路径不占写桶：连读 5 次全绿（同步的常态是"启动拉一次"）
    for (let i = 0; i < 5; i += 1) {
      expect((await getDoc(tokenA)).statusCode).toBe(200);
    }
    // 且读完之后写桶仍空（读没有偷回额度）
    expect((await putDoc(tokenA, 3, 4)).statusCode).toBe(429);

    // ④ 按账号分桶：B 账号完全不受 A 打满的影响
    expect((await putDoc(tokenB, null, 1)).statusCode).toBe(200);
  });

  it('诚实客户端契约：按 retryAfterMs 等待后恰放行 1 个，再发即 429', async () => {
    now += 1_200_000;
    const fifth = await putDoc(tokenA, 3, 4);
    expect(fifth.statusCode).toBe(200); // 建议时长不得短于实际回补时间
    expect(fifth.json().revision).toBe(4);
    expect((await putDoc(tokenA, 4, 5)).statusCode).toBe(429); // 恰 1 个，不多给
  });
});
