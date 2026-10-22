/**
 * 账号管理端点集成测试（docs/22 §3.4 #7/#8/#9/#10 + docs/26 §4.0 的 /v1/me/summary）。
 *
 * 覆盖：全撤（含当前会话，审计落 logout_all）/ 设备列表（current 标认、登出后消失）/
 * 改密（错密码 401、保留当前吊销其他、新密码登录通旧密码不通、策略拒、5 次/日闸）/
 * 注销（墓碑幂等重试仍 204、级联删净、审计匿名化、错密码 401、封禁 403、3 次/日闸）/
 * me/summary（空账号三零、有统计数据齐、名次与 /v1/leaderboard 同口径）。
 * 只动 test/**。
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, login, register, TEST_ANSWER, TEST_PASSWORD, TEST_QUESTION, type TestContext } from '../helpers/app.js';

const HIGH_LIMITS = {
  registerPerHourPerIp: 100_000,
  registerPerDayGlobal: 1_000_000,
  loginPer15MinPerIp: 10_000,
  apiPerMinute: 1_000_000,
};

const INSTALL = '9f2c77aa-1111-4222-8333-444455556666';

let ctx: TestContext;
let ctxPw: TestContext;
let ctxDel: TestContext;

beforeAll(async () => {
  ctx = await createTestContext({ rateLimits: HIGH_LIMITS });
  ctxPw = await createTestContext({ rateLimits: { ...HIGH_LIMITS, passwordChangePerDayPerAccount: 2 } });
  ctxDel = await createTestContext({ rateLimits: { ...HIGH_LIMITS, deleteAccountPerDayPerAccount: 2 } });
});

afterAll(async () => {
  await ctx.raw.close();
  await ctxPw.raw.close();
  await ctxDel.raw.close();
});

describe('logout-all 与设备列表', () => {
  it('两设备会话：列表两条且恰一条 current；全撤后两枚令牌全 401、审计落 logout_all', async () => {
    const reg = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'acct_la',
        password: TEST_PASSWORD,
        securityQuestion: TEST_QUESTION,
        securityAnswer: TEST_ANSWER,
        clientLabel: 'desk-pc',
      },
    });
    expect(reg.statusCode).toBe(201);
    const token1 = reg.json().token as string;
    const id = reg.json().account.id as string;
    const second = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: 'acct_la', password: TEST_PASSWORD, clientLabel: 'laptop' },
    });
    const token2 = second.json().token as string;

    // 设备列表：只认自己的两枚，标签回来了，恰一枚 current
    const list = await ctx.app.inject({ method: 'GET', url: '/v1/auth/sessions', headers: bearer(token2) });
    expect(list.statusCode).toBe(200);
    const sessions = list.json() as Array<Record<string, unknown>>;
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current === true)).toHaveLength(1);
    expect(new Set(sessions.map((s) => s.clientLabel))).toEqual(new Set(['desk-pc', 'laptop']));
    for (const s of sessions) {
      expect(s.id).toBeTypeOf('string');
      expect(s.createdAt).toBeTypeOf('string');
      expect(s.lastSeenAt).toBeTypeOf('string');
    }

    // 全撤（用 token1 发）：两枚都死
    const all = await ctx.app.inject({ method: 'POST', url: '/v1/auth/logout-all', headers: bearer(token1) });
    expect(all.statusCode).toBe(204);
    for (const t of [token1, token2]) {
      const after = await ctx.app.inject({ method: 'GET', url: '/v1/auth/session', headers: bearer(t) });
      expect(after.statusCode).toBe(401);
      expect(after.json().error.code).toBe('UNAUTHENTICATED');
    }

    // DB 证据：两行都是 logout_all；审计有 logout_all 行
    const rows = await ctx.raw.query<{ revoked_reason: string }>(
      `SELECT revoked_reason FROM sessions WHERE account_id = $1 AND revoked_at IS NOT NULL`,
      [id],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((r) => r.revoked_reason === 'logout_all')).toBe(true);
    const audit = await ctx.raw.query(`SELECT 1 FROM auth_audit WHERE account_id = $1 AND event = 'logout_all'`, [id]);
    expect(audit.rows).toHaveLength(1);
  });

  it('单枚登出后从设备列表消失（另一枚还在）', async () => {
    const reg = await register(ctx.app, 'acct_la2');
    const firstToken = reg.json().token as string; // 注册自带一枚
    const second = await login(ctx.app, 'acct_la2');
    const token2 = second.json().token as string;

    const before = await ctx.app.inject({ method: 'GET', url: '/v1/auth/sessions', headers: bearer(token2) });
    expect(before.json()).toHaveLength(2);

    const out = await ctx.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: bearer(firstToken) });
    expect(out.statusCode).toBe(204);

    const list = await ctx.app.inject({ method: 'GET', url: '/v1/auth/sessions', headers: bearer(token2) });
    const sessions = list.json() as Array<{ current: boolean }>;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.current).toBe(true);
  });

  it('未认证：列表与全撤都是 401', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/auth/sessions' })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'POST', url: '/v1/auth/logout-all' })).statusCode).toBe(401);
  });
});

describe('改密', () => {
  it('错当前密码 → 401 BAD_CREDENTIALS；正确 → 204：当前会话保留、其他吊销、新密码可登录、旧密码不可', async () => {
    await register(ctx.app, 'acct_pw');
    const other = (await login(ctx.app, 'acct_pw')).json().token as string; // 将被吊销的那枚
    const current = (await login(ctx.app, 'acct_pw')).json().token as string;

    const wrong = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: bearer(current),
      payload: { currentPassword: 'not-the-password', newPassword: 'brand new secret phrase' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('BAD_CREDENTIALS');

    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: bearer(current),
      payload: { currentPassword: TEST_PASSWORD, newPassword: 'brand new secret phrase' },
    });
    expect(ok.statusCode).toBe(204);

    // 当前会话活着；另一枚被吊销（reason='password_change'）
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/auth/session', headers: bearer(current) })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/auth/session', headers: bearer(other) })).statusCode).toBe(401);

    // 新密码可登录、旧密码不可
    expect((await login(ctx.app, 'acct_pw', 'brand new secret phrase')).statusCode).toBe(200);
    const old = await login(ctx.app, 'acct_pw', TEST_PASSWORD);
    expect(old.statusCode).toBe(401);
    expect(old.json().error.code).toBe('BAD_CREDENTIALS');

    const audit = await ctx.raw.query(`SELECT 1 FROM auth_audit WHERE event = 'change_password'`);
    expect(audit.rows).toHaveLength(1);
  });

  it('新密码过不了策略 → 400（当前密码正确也不放过）', async () => {
    const reg = await register(ctx.app, 'acct_pw2');
    const token = reg.json().token as string;
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: bearer(token),
      payload: { currentPassword: TEST_PASSWORD, newPassword: 'acct_pw2' }, // 含用户名
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('限流闸：2 次/日（每次尝试都计）——第三发即使是正确密码也 429', async () => {
    const reg = await register(ctxPw.app, 'acct_pw3');
    const token = reg.json().token as string;
    const attempt = (currentPassword: string) =>
      ctxPw.app.inject({
        method: 'POST',
        url: '/v1/auth/change-password',
        headers: bearer(token),
        payload: { currentPassword, newPassword: 'a sturdy long passphrase' },
      });
    expect((await attempt('wrong-one')).statusCode).toBe(401);
    expect((await attempt('wrong-two')).statusCode).toBe(401);
    const third = await attempt(TEST_PASSWORD);
    expect(third.statusCode).toBe(429);
    expect(third.json().error.retryAfterMs).toBeGreaterThan(0);
  });
});

describe('注销（幂等墓碑）', () => {
  it('全流程：错密码 401 → 正确 204 → 同令牌重试仍 204 → 登录 401；行删净、墓碑在、审计匿名', async () => {
    const reg = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'acct_del',
        password: TEST_PASSWORD,
        securityQuestion: TEST_QUESTION,
        securityAnswer: TEST_ANSWER,
        clientLabel: 'doomed',
      },
    });
    const token = reg.json().token as string;
    const id = reg.json().account.id as string;

    // 造一份 user_docs + 一条 challenge_days：验证级联删净（含复合 FK 的逐题表链）
    await ctx.raw.query(
      `INSERT INTO user_docs (account_id, doc_type, revision, doc_ver, payload) VALUES ($1, 'profile', 1, 1, '{}')`,
      [id],
    );
    await ctx.raw.query(
      `INSERT INTO challenge_days (account_id, date_key, install_id, source, finished_at, correct, total, score, score_max, submission_id, payload_sha256)
       VALUES ($1, '2026-10-08', $2, 'local', now(), 1, 5, 100, 500, $3, 'x')`,
      [id, INSTALL, randomUUID()],
    );
    await ctx.raw.query(
      `INSERT INTO user_stats (account_id, total_score) VALUES ($1, 100)`,
      [id],
    );

    const wrong = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/delete-account',
      headers: bearer(token),
      payload: { password: 'nope-nope-nope' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('BAD_CREDENTIALS');

    const gone = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/delete-account',
      headers: bearer(token),
      payload: { password: TEST_PASSWORD },
    });
    expect(gone.statusCode).toBe(204);

    // 墓碑幂等：同令牌重试（客户端未收到 204 时的重发路径）→ 仍 204
    const retry = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/delete-account',
      headers: bearer(token),
      payload: { password: TEST_PASSWORD },
    });
    expect(retry.statusCode).toBe(204);

    // 登录探测：账号已不存在 → BAD_CREDENTIALS（不泄露「曾经存在」）
    const probe = await login(ctx.app, 'acct_del');
    expect(probe.statusCode).toBe(401);
    expect(probe.json().error.code).toBe('BAD_CREDENTIALS');

    // DB 证据：users 行与三张外键派生表全清零
    const userGone = await ctx.raw.query(`SELECT 1 FROM users WHERE id = $1`, [id]);
    expect(userGone.rows).toHaveLength(0);
    for (const t of ['user_docs', 'challenge_days', 'user_stats']) {
      const r = await ctx.raw.query(`SELECT 1 FROM ${t} WHERE account_id = $1`, [id]);
      expect(r.rows, `${t} 应已删净`).toHaveLength(0);
    }
    // 墓碑：会话行保留，reason=account_deleted，account_id 被 FK 置 NULL
    const tombstones = await ctx.raw.query<{ account_id: string | null; revoked_reason: string }>(
      `SELECT account_id, revoked_reason FROM sessions WHERE revoked_reason = 'account_deleted' AND client_label = 'doomed'`,
    );
    expect(tombstones.rows).toHaveLength(1);
    expect(tombstones.rows[0]!.account_id).toBeNull();
    // 审计匿名化：该账号的 register/login_ok 行 account_id 已置 NULL；注销事件本身也匿名
    const leftover = await ctx.raw.query(`SELECT 1 FROM auth_audit WHERE account_id = $1`, [id]);
    expect(leftover.rows).toHaveLength(0);
    const delAudit = await ctx.raw.query(
      `SELECT 1 FROM auth_audit WHERE event = 'delete_account' AND account_id IS NULL AND username IS NULL`,
    );
    expect(delAudit.rows).toHaveLength(1);
  });

  it('已登出的令牌走注销 → 401（墓碑只认 account_deleted，不认其他吊销原因）', async () => {
    const reg = await register(ctx.app, 'acct_del2');
    const token = reg.json().token as string;
    await ctx.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: bearer(token) });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/delete-account',
      headers: bearer(token),
      payload: { password: TEST_PASSWORD },
    });
    expect(res.statusCode).toBe(401);
  });

  it('封禁账号走注销 → 403 FORBIDDEN', async () => {
    const reg = await register(ctx.app, 'acct_del3');
    const token = reg.json().token as string;
    const id = reg.json().account.id as string;
    await ctx.raw.query(`UPDATE users SET disabled_at = now() WHERE id = $1`, [id]);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/delete-account',
      headers: bearer(token),
      payload: { password: TEST_PASSWORD },
    });
    expect(res.statusCode).toBe(403);
  });

  it('限流闸：2 次/日（错密码也计）——第三发即使正确也 429，账号仍在', async () => {
    const reg = await register(ctxDel.app, 'acct_del4');
    const token = reg.json().token as string;
    const attempt = (password: string) =>
      ctxDel.app.inject({
        method: 'POST',
        url: '/v1/auth/delete-account',
        headers: bearer(token),
        payload: { password },
      });
    expect((await attempt('wrong-one')).statusCode).toBe(401);
    expect((await attempt('wrong-two')).statusCode).toBe(401);
    const third = await attempt(TEST_PASSWORD);
    expect(third.statusCode).toBe(429);
    expect(third.json().error.retryAfterMs).toBeGreaterThan(0);
    // 没被误删：还能登录
    expect((await login(ctxDel.app, 'acct_del4')).statusCode).toBe(200);
  });
});

describe('GET /v1/me/summary', () => {
  it('空账号：stats 三零 + lastActiveDay null；rice 三零；名次 null；optedIn false', async () => {
    const reg = await register(ctx.app, 'sum_empty');
    const token = reg.json().token as string;
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/me/summary', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      stats: { learnedCount: 0, practicedCount: 0, streakDays: 0, lastActiveDay: null, totalScore: 0 },
      rice: { balance: 0, earnedTotal: 0, spentTotal: 0 },
      leaderboard: { rankAllTime: null, scoreAllTime: 0, scoreToday: 0, optedIn: false },
    });
  });

  it('有数据账号：stats/rice/名次全齐；名次口径与 /v1/leaderboard?period=alltime 一致', async () => {
    const a = await register(ctx.app, 'sum_a');
    const b = await register(ctx.app, 'sum_b');
    const token = a.json().token as string;
    const idA = a.json().account.id as string;
    const idB = b.json().account.id as string;
    // 服务端「今天」= 北京日（UTC+8）；用 UTC 日会在北京 0–8 点种到昨天
    const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // 派生表按每日任务同口径种（user_stats=SUM(challenge_days.score)；今天是挑战日）
    await ctx.raw.query(
      `INSERT INTO challenge_days (account_id, date_key, install_id, source, finished_at, correct, total, score, score_max, submission_id, payload_sha256)
       VALUES ($1, $2::date, $3, 'local', now(), 5, 5, 500, 500, $4, 'x')`,
      [idA, today, INSTALL, randomUUID()],
    );
    await ctx.raw.query(
      `INSERT INTO user_stats (account_id, learned_count, practiced_count, streak_days, last_active_day, total_score)
       VALUES ($1, 12, 34, 5, $2::date, 500), ($3, 0, 0, 0, $2::date, 300)`,
      [idA, today, idB],
    );
    await ctx.raw.query(
      `INSERT INTO rice_balances (account_id, balance, earned_total, spent_total, last_seq) VALUES ($1, 42, 50, 8, 7)`,
      [idA],
    );

    const res = await ctx.app.inject({ method: 'GET', url: '/v1/me/summary', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      stats: { learnedCount: 12, practicedCount: 34, streakDays: 5, lastActiveDay: today, totalScore: 500 },
      rice: { balance: 42, earnedTotal: 50, spentTotal: 8 },
      leaderboard: { rankAllTime: 1, scoreAllTime: 500, scoreToday: 500, optedIn: false },
    });

    // 名次口径对拍：账本端点 alltime 实测的 me.rank 与 summary 的 rankAllTime 同源同值
    const lb = await ctx.app.inject({ method: 'GET', url: '/v1/leaderboard?period=alltime', headers: bearer(token) });
    expect(lb.statusCode).toBe(200);
    expect(lb.json().me.rank as number).toBe(res.json().leaderboard.rankAllTime);
  });

  it('未认证 → 401', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/me/summary' })).statusCode).toBe(401);
  });
});

describe('GET /v1/me/summary?dateKey=（第 6 项日差修复：scoreToday 按客户端本地日查）', () => {
  /** 北京时间固定 = UTC+8（中国 1991 年起无夏令时）；测试侧独立算，不与实现共用函数 */
  const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

  const bjDay = (offsetDays = 0) =>
    new Date(Date.now() + BEIJING_OFFSET_MS + offsetDays * 86_400_000).toISOString().slice(0, 10);

  it('本地日超前服务器日：?dateKey=明天 读到那天的档；缺省仍是服务器北京日（老客户端行为不变）', async () => {
    const reg = await register(ctx.app, 'sum_day');
    const token = reg.json().token as string;
    const id = reg.json().account.id as string;
    const tomorrow = bjDay(1);
    await ctx.raw.query(
      `INSERT INTO challenge_days (account_id, date_key, install_id, source, finished_at, correct, total, score, score_max, submission_id, payload_sha256)
       VALUES ($1, $2::date, $3, 'local', now(), 5, 5, 600, 600, $4, 'x')`,
      [id, tomorrow, INSTALL, randomUUID()],
    );

    const withKey = await ctx.app.inject({
      method: 'GET',
      url: `/v1/me/summary?dateKey=${tomorrow}`,
      headers: bearer(token),
    });
    expect(withKey.statusCode).toBe(200);
    expect(withKey.json().leaderboard.scoreToday).toBe(600);

    const without = await ctx.app.inject({ method: 'GET', url: '/v1/me/summary', headers: bearer(token) });
    expect(without.json().leaderboard.scoreToday).toBe(0); // 不传 = 服务器北京今天：看不到明天的档
  });

  it('容差 ±1 天之外（+2 / −2）与坏形状（2026-02-30）→ 400 VALIDATION_FAILED', async () => {
    const reg = await register(ctx.app, 'sum_day2');
    const token = reg.json().token as string;
    for (const bad of [bjDay(2), bjDay(-2), '2026-02-30']) {
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/v1/me/summary?dateKey=${bad}`,
        headers: bearer(token),
      });
      expect(res.statusCode, `dateKey=${bad} 应当 400`).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    }
  });
});

describe('PUT /v1/me/leaderboard-opt-in（A4 裁定 a：榜面曝光开关的唯一写口）', () => {
  function putOptIn(token: string, payload: Record<string, unknown>) {
    return ctx.app.inject({
      method: 'PUT',
      url: '/v1/me/leaderboard-opt-in',
      headers: bearer(token),
      payload,
    });
  }

  it('true → 落库；重复设同值幂等 200 同值；summary 的 optedIn 同步；false 关回去', async () => {
    const reg = await register(ctx.app, 'sum_opt');
    const token = reg.json().token as string;
    const id = reg.json().account.id as string;

    const on = await putOptIn(token, { optIn: true });
    expect(on.statusCode).toBe(200);
    expect(on.json()).toEqual({ optIn: true });
    const again = await putOptIn(token, { optIn: true }); // 幂等：客户端重试安全
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ optIn: true });

    const db = await ctx.raw.query<{ leaderboard_opt_in: boolean }>(
      `SELECT leaderboard_opt_in FROM users WHERE id = $1`,
      [id],
    );
    expect(db.rows[0]!.leaderboard_opt_in).toBe(true);
    const summary = await ctx.app.inject({ method: 'GET', url: '/v1/me/summary', headers: bearer(token) });
    expect(summary.json().leaderboard.optedIn).toBe(true);

    const off = await putOptIn(token, { optIn: false });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toEqual({ optIn: false });
    const summary2 = await ctx.app.inject({ method: 'GET', url: '/v1/me/summary', headers: bearer(token) });
    expect(summary2.json().leaderboard.optedIn).toBe(false);
  });

  it('body 形状错（非布尔/缺字段）→ 400；未认证 → 401', async () => {
    const reg = await register(ctx.app, 'sum_opt2');
    const token = reg.json().token as string;
    const bad = await putOptIn(token, { optIn: 'yes' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_FAILED');
    const missing = await putOptIn(token, {});
    expect(missing.statusCode).toBe(400);
    expect(
      (await ctx.app.inject({ method: 'PUT', url: '/v1/me/leaderboard-opt-in', payload: { optIn: true } }))
        .statusCode,
    ).toBe(401);
  });
});
