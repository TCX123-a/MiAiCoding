/**
 * 红队验收 · 认证链路与令牌语义（独立补强；只动 test/**，src 缺陷只记录不修）。
 * 覆盖（spec §10 / docs/22 §5.1 §5.4 §5.6）：
 *  - 注册/登录/登出全链路与边界：重复注册（同形/大小写/并发竞态）、错误密码与不存在用户
 *    （统一 BAD_CREDENTIALS 防枚举）、不存在用户同样计入退避、登出后旧令牌行为、多设备隔离；
 *  - 令牌 401/403 语义逐条：缺失/畸形/不存在/吊销/闲置过期/绝对过期/禁用；
 *  - 会话滑动与绝对过期边界：>1h 才延展、写节流 1h（no-op 也要有证据）、absolute 封顶、
 *    过期后不复活（不得改写 last_seen）。
 * 全部走 fastify.inject 全栈（真实 PGlite），时间边界用 DB 直改 + 2 秒以上余量避免抖动。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '../../src/lib/token.js';
import {
  bearer,
  createTestContext,
  login,
  register,
  TEST_PASSWORD,
  type TestContext,
} from '../helpers/app.js';

const HIGH_LIMITS = {
  registerPerHourPerIp: 100_000,
  registerPerDayGlobal: 1_000_000,
  loginPer15MinPerIp: 100_000,
  apiPerMinute: 1_000_000,
};

const DAY = 86_400_000;

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext({ rateLimits: HIGH_LIMITS });
});
afterAll(async () => {
  await ctx.raw.close();
});

function ms(v: Date | string): number {
  return v instanceof Date ? v.getTime() : new Date(v).getTime();
}

async function sessionRow(token: string) {
  const { rows } = await ctx.raw.query<{
    revoked_at: Date | string | null;
    revoked_reason: string | null;
    last_seen_at: Date | string;
    idle_expires_at: Date | string;
    absolute_expires_at: Date | string;
  }>(
    `SELECT revoked_at, revoked_reason, last_seen_at, idle_expires_at, absolute_expires_at
       FROM sessions WHERE token_hash = $1`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) throw new Error('session row not found');
  return row;
}

async function patchSession(token: string, sql: string): Promise<void> {
  await ctx.raw.query(`UPDATE sessions SET ${sql} WHERE token_hash = $1`, [hashToken(token)]);
}

/**
 * 「刚过期一丝」的注入余量（SQL 片段）。注入用 PG 的 now()，判定用应用的 Date.now()——
 * 真 PG 轨道上是两口钟：Windows 定时器刻度 ~15.6ms，实测 PG 的钟可比 Node 慢 ~26ms
 * （时钟探针：300 次采样有 37 次「1ms 前过期」会被判成未过期）→ 1ms 边界物理不可测，用 1s。
 * PGlite 与 Node 同进程同一口钟，1ms 边界可测。语义不变：仍是「已过期」，
 * 且比续期节流窗（1h）小三个数量级。
 */
function expiredAgo(): string {
  return ctx.backend === 'pg' ? `now() - interval '1 second'` : `now() - interval '1 millisecond'`;
}

function getSession(token?: string) {
  return ctx.app.inject({
    method: 'GET',
    url: '/v1/auth/session',
    ...(token !== undefined ? { headers: bearer(token) } : {}),
  });
}

describe('注册 / 登录 / 登出 全链路与边界', () => {
  it('重复注册（同形 + 大小写变体）→ 409 USERNAME_TAKEN；库里恰一行；登录大小写不敏感', async () => {
    const first = await register(ctx.app, 'dup_user');
    expect(first.statusCode).toBe(201);

    const again = await register(ctx.app, 'dup_user');
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('USERNAME_TAKEN');

    const variant = await register(ctx.app, 'DUP_USER');
    expect(variant.statusCode).toBe(409);
    expect(variant.json().error.code).toBe('USERNAME_TAKEN');

    const { rows } = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM users WHERE username_lower = 'dup_user'`,
    );
    expect(rows[0]!.n).toBe(1);

    const back = await login(ctx.app, 'DuP_uSeR');
    expect(back.statusCode).toBe(200);
  });

  it('并发同名注册：恰一个 201、一个 409（唯一键竞态出口，不容许 500）', async () => {
    const [a, b] = await Promise.all([
      register(ctx.app, 'race_user'),
      register(ctx.app, 'race_user'),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort((x, y) => x - y);
    expect(statuses).toEqual([201, 409]);

    const loser = a.statusCode === 409 ? a : b;
    expect(loser.json().error.code).toBe('USERNAME_TAKEN');

    const { rows } = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM users WHERE username_lower = 'race_user'`,
    );
    expect(rows[0]!.n).toBe(1);
    // 败者事务回滚：不留下 register 审计
    const audit = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM auth_audit WHERE event = 'register' AND username = 'race_user'`,
    );
    expect(audit.rows[0]!.n).toBe(1);
  });

  it('错误密码与不存在用户：401 BAD_CREDENTIALS 且文案逐字一致（防枚举）；响应不含令牌', async () => {
    const wrong = await login(ctx.app, 'dup_user', 'wrong password 1234');
    const unknown = await login(ctx.app, 'no_such_user_zz', 'wrong password 1234');
    for (const res of [wrong, unknown]) {
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('BAD_CREDENTIALS');
      expect(res.json().token).toBeUndefined();
    }
    expect(unknown.json().error.message).toBe(wrong.json().error.message);
  });

  it('不存在用户同样计入每用户名退避：5 连败后第 6 次即使密码正确 → 429（行为不可区分）', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await login(ctx.app, 'ghost_red')).statusCode).toBe(401);
    }
    const blocked = await login(ctx.app, 'ghost_red', TEST_PASSWORD);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('RATE_LIMITED');
    // 真时钟下第 5 次失败到本次拦截之间有毫秒流逝：retryAfterMs 略小于 60s（此处只锁区间与秒级头）
    const retryAfterMs = blocked.json().error.retryAfterMs as number;
    expect(retryAfterMs).toBeGreaterThan(59_000);
    expect(retryAfterMs).toBeLessThanOrEqual(60_000);
    expect(Number(blocked.headers['retry-after'])).toBe(60);

    // 负对照：退避按「用户名」分桶，另一个不存在的用户名不受牵连
    expect((await login(ctx.app, 'ghost_other')).statusCode).toBe(401);
  });

  it('登出：旧令牌 session/docs/PUT 全 401；重复与无令牌登出仍 204；另一设备会话不受影响', async () => {
    const t1 = (await login(ctx.app, 'dup_user')).json().token as string;
    const t2 = (await login(ctx.app, 'dup_user')).json().token as string;

    const out = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: bearer(t1),
    });
    expect(out.statusCode).toBe(204);
    const row1 = await sessionRow(t1);
    expect(row1.revoked_reason).toBe('logout');
    expect(row1.revoked_at).not.toBeNull();

    const session = await getSession(t1);
    expect(session.statusCode).toBe(401);
    expect(session.json().error.code).toBe('UNAUTHENTICATED');

    const docs = await ctx.app.inject({ method: 'GET', url: '/v1/docs', headers: bearer(t1) });
    expect(docs.statusCode).toBe(401);

    const put = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/docs/profile',
      headers: bearer(t1),
      payload: { docVer: 1, baseRevision: null, payload: { version: 1 } },
    });
    expect(put.statusCode).toBe(401);
    expect(put.json().error.code).toBe('UNAUTHENTICATED');

    // 多设备：另一枚令牌不受影响
    expect((await getSession(t2)).statusCode).toBe(200);
    expect((await sessionRow(t2)).revoked_at).toBeNull();

    // 幂等特例：已吊销令牌再登出 204；无令牌/垃圾令牌同样 204（不 401，也不建/吊销任何东西）
    expect(
      (
        await ctx.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: bearer(t1) })
      ).statusCode,
    ).toBe(204);
    expect((await ctx.app.inject({ method: 'POST', url: '/v1/auth/logout' })).statusCode).toBe(204);
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/v1/auth/logout',
          headers: bearer('garbage-token'),
        })
      ).statusCode,
    ).toBe(204);
  });
});

describe('令牌 401/403 语义逐条（探针端点 GET /v1/auth/session）', () => {
  it('缺失 / 畸形 Authorization → 401 UNAUTHENTICATED（逐条）', async () => {
    const cases: Array<string | undefined> = [
      undefined,
      '',
      'Bearer',
      'Bearer ',
      `Token ms1_${'A'.repeat(43)}`,
      `ms1_${'A'.repeat(43)}`,
      `Bearer ms1_${'A'.repeat(42)}`,
      `Bearer ms1_${'A'.repeat(44)}`,
      `Bearer ms1_${'A'.repeat(42)}!`,
      `Bearer ms2_${'A'.repeat(43)}`,
    ];
    for (const header of cases) {
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/v1/auth/session',
        ...(header === undefined ? {} : { headers: { authorization: header } }),
      });
      expect(res.statusCode, `header=${JSON.stringify(header)}`).toBe(401);
      expect(res.json().error.code, `header=${JSON.stringify(header)}`).toBe('UNAUTHENTICATED');
    }
  });

  it('形态合法但不存在 → 401 UNAUTHENTICATED（不是 TOKEN_EXPIRED）', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: bearer(`ms1_${'A'.repeat(43)}`),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('Bearer scheme 大小写不敏感（RFC 7235 口径实测）', async () => {
    const token = (await login(ctx.app, 'dup_user')).json().token as string;
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { authorization: `bEaReR ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('已吊销 → UNAUTHENTICATED；闲置过期 / 绝对过期 → TOKEN_EXPIRED（两侧各验一次）', async () => {
    const revoked = (await login(ctx.app, 'dup_user')).json().token as string;
    await ctx.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: bearer(revoked) });
    const revokedRes = await getSession(revoked);
    expect(revokedRes.statusCode).toBe(401);
    expect(revokedRes.json().error.code).toBe('UNAUTHENTICATED');

    const idleExpired = (await login(ctx.app, 'dup_user')).json().token as string;
    await patchSession(idleExpired, `idle_expires_at = ${expiredAgo()}`);
    const idleRes = await getSession(idleExpired);
    expect(idleRes.statusCode).toBe(401);
    expect(idleRes.json().error.code).toBe('TOKEN_EXPIRED');

    const absExpired = (await login(ctx.app, 'dup_user')).json().token as string;
    await patchSession(absExpired, `absolute_expires_at = ${expiredAgo()}`);
    const absRes = await getSession(absExpired);
    expect(absRes.statusCode).toBe(401);
    expect(absRes.json().error.code).toBe('TOKEN_EXPIRED');
  });

  it('反向边界不早杀：idle 还有 1 秒才到期 → 照常 200（与「刚过期必杀」成对，堵「提前判过期」的静默坏法）', async () => {
    const token = (await login(ctx.app, 'dup_user')).json().token as string;
    // 1s 余量对两条轨道都安全：真 PG 跨进程钟差实测 ≤26ms（见 expiredAgo 注释）
    await patchSession(token, `idle_expires_at = now() + interval '1 second'`);
    const res = await getSession(token);
    expect(res.statusCode).toBe(200);
    expect(res.json().idleExpiresAt).toBeDefined();
  });

  it('吊销 + 过期兼具 → UNAUTHENTICATED（吊销优先；规格未写先后，此处锁实现特征）', async () => {
    const token = (await login(ctx.app, 'dup_user')).json().token as string;
    await ctx.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: bearer(token) });
    await patchSession(
      token,
      `idle_expires_at = now() - interval '1 day', absolute_expires_at = now() - interval '1 hour'`,
    );
    const res = await getSession(token);
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('禁用账号 → 403 FORBIDDEN（正确口令与已有令牌都到此为止；错误口令仍是 401）', async () => {
    const reg = await register(ctx.app, 'disabled_red');
    const token = reg.json().token as string;
    await ctx.raw.query(`UPDATE users SET disabled_at = now() WHERE username_lower = 'disabled_red'`);

    const viaToken = await getSession(token);
    expect(viaToken.statusCode).toBe(403);
    expect(viaToken.json().error.code).toBe('FORBIDDEN');

    const rightPw = await login(ctx.app, 'disabled_red', TEST_PASSWORD);
    expect(rightPw.statusCode).toBe(403);
    expect(rightPw.json().error.code).toBe('FORBIDDEN');

    const wrongPw = await login(ctx.app, 'disabled_red', 'wrong password 1234');
    expect(wrongPw.statusCode).toBe(401);
    expect(wrongPw.json().error.code).toBe('BAD_CREDENTIALS');
  });
});

describe('会话滑动与绝对过期边界（直改会话表 + 真时钟，余量 ≥2s）', () => {
  it('滑动续期：last_seen >1h 且 idle 将到期 → idle 延展为 now+30d（≤ absolute），响应与 DB 双轨一致', async () => {
    const token = (await login(ctx.app, 'dup_user')).json().token as string;
    await patchSession(
      token,
      `last_seen_at = now() - interval '2 hours', idle_expires_at = now() + interval '1 hour'`,
    );

    const res = await getSession(token);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const nowMs = Date.now();
    const idleMs = ms(body.idleExpiresAt);
    expect(idleMs - nowMs).toBeGreaterThan(29 * DAY);
    expect(idleMs - nowMs).toBeLessThanOrEqual(30 * DAY + 120_000);
    expect(idleMs).toBeLessThanOrEqual(ms(body.absoluteExpiresAt));

    const row = await sessionRow(token);
    expect(Math.abs(ms(row.idle_expires_at) - idleMs)).toBeLessThan(60_000); // 响应与 DB 双轨一致
    expect(nowMs - ms(row.last_seen_at)).toBeLessThan(60_000); // last_seen 已写
  });

  it('写节流：last_seen 新近时不续期——把 idle 预置成与续期结果明显不同的有效值，请求后必须原样', async () => {
    const token = (await login(ctx.app, 'dup_user')).json().token as string;
    // 该值（1h）与「续期成功」的预期值（约 30d）明显不同：若节流失效写入，读数必变
    await patchSession(token, `last_seen_at = now(), idle_expires_at = now() + interval '1 hour'`);
    const before = await sessionRow(token);

    const res = await getSession(token);
    expect(res.statusCode).toBe(200);
    expect(ms(res.json().idleExpiresAt)).toBe(ms(before.idle_expires_at));

    const after = await sessionRow(token);
    expect(ms(after.idle_expires_at)).toBe(ms(before.idle_expires_at));
    expect(ms(after.last_seen_at)).toBe(ms(before.last_seen_at));
  });

  it('续期被绝对过期封顶：absolute = now+5d（<30d）→ 续期后 idle 恰等于 absolute（响应与 DB 双轨）', async () => {
    const token = (await login(ctx.app, 'dup_user')).json().token as string;
    await patchSession(
      token,
      `last_seen_at = now() - interval '2 hours',
       idle_expires_at = now() + interval '1 hour',
       absolute_expires_at = now() + interval '5 days'`,
    );

    const res = await getSession(token);
    expect(res.statusCode).toBe(200);
    expect(res.json().idleExpiresAt).toBe(res.json().absoluteExpiresAt);

    const row = await sessionRow(token);
    expect(ms(row.idle_expires_at)).toBe(ms(row.absolute_expires_at));
  });

  it('过期不复活：idle 已过期一丝（PGlite 1ms / 真 PG 1s，跨进程钟差见 expiredAgo）时即使满足续期条件也是 TOKEN_EXPIRED，且不得改写 last_seen', async () => {
    const token = (await login(ctx.app, 'dup_user')).json().token as string;
    await patchSession(
      token,
      `last_seen_at = now() - interval '2 hours', idle_expires_at = ${expiredAgo()}`,
    );
    const before = await sessionRow(token);

    const res = await getSession(token);
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('TOKEN_EXPIRED');

    const after = await sessionRow(token);
    expect(ms(after.last_seen_at)).toBe(ms(before.last_seen_at));
    expect(ms(after.idle_expires_at)).toBe(ms(before.idle_expires_at));
  });
});
