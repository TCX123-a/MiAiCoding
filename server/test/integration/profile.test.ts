/**
 * 用户系统升级（2026-10-22）：改用户名 + 头像 hash 在账号/榜面回话里的同步。
 *
 * 覆盖：
 *  - PUT /v1/me/username：成功（登录名跟着换：新名字能登、旧名字不能）/ 幂等同值 /
 *    唯一键冲突 409 USERNAME_TAKEN / 格式 400 / 违禁词 400 USERNAME_FORBIDDEN /
 *    未认证 401 / 日闸 429 / 审计 change_username 落库；
 *  - GET /v1/auth/session 与 register/login 回话都带 avatarHash；
 *  - 排行榜快照路径 JOIN users：改名 + 换头像后**不重铸快照**，下一把拉榜即见新值
 *    （这就是「排行榜立刻显示新头像/新名字」的判据）。
 * 只动 test/**。
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, login, register, TEST_PASSWORD, type TestContext } from '../helpers/app.js';

const HIGH_LIMITS = {
  registerPerHourPerIp: 100_000,
  registerPerDayGlobal: 1_000_000,
  loginPer15MinPerIp: 10_000,
  apiPerMinute: 1_000_000,
};

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** 北京时间固定 = UTC+8（中国 1991 年起无夏令时）；测试侧独立算，不与实现共用函数 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function bjDay(offsetDays = 0): string {
  return new Date(Date.now() + BEIJING_OFFSET_MS + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

let ctx: TestContext;
let rateCtx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext({ rateLimits: HIGH_LIMITS });
  rateCtx = await createTestContext({
    rateLimits: { ...HIGH_LIMITS, usernameChangePerDayPerAccount: 2 },
  });
});

afterAll(async () => {
  await ctx.raw.close();
  await rateCtx.raw.close();
});

function rename(token: string, username: string, app = ctx) {
  return app.app.inject({
    method: 'PUT',
    url: '/v1/me/username',
    headers: bearer(token),
    payload: { username },
  });
}

function putAvatar(token: string) {
  return ctx.app.inject({
    method: 'PUT',
    url: '/v1/avatar',
    headers: { ...bearer(token), 'content-type': 'image/png' },
    payload: PNG_1X1,
  });
}

describe('PUT /v1/me/username', () => {
  it('成功改名：回话带新名字 + avatarHash；新名字能登、旧名字登不上', async () => {
    const reg = await register(ctx.app, 'prof_rename');
    const token = reg.json().token as string;
    const id = reg.json().account.id as string;
    expect(reg.json().account.avatarHash).toBeNull();

    const res = await rename(token, '大肥鱼学徒');
    expect(res.statusCode).toBe(200);
    expect(res.json().account).toMatchObject({ id, username: '大肥鱼学徒', avatarHash: null });

    const s = await ctx.app.inject({ method: 'GET', url: '/v1/auth/session', headers: bearer(token) });
    expect(s.statusCode).toBe(200);
    expect(s.json().account.username).toBe('大肥鱼学徒');
    expect(s.json().account.avatarHash).toBeNull();

    expect((await login(ctx.app, '大肥鱼学徒')).statusCode).toBe(200);
    expect((await login(ctx.app, 'prof_rename')).json().error.code).toBe('BAD_CREDENTIALS');

    const audit = await ctx.raw.query<{ event: string; username: string }>(
      `SELECT event, username FROM auth_audit WHERE account_id = $1 AND event = 'change_username'`,
      [id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.username).toBe('大肥鱼学徒');
  });

  it('改成与当前完全相同 = 幂等 200，不写第二条审计', async () => {
    const reg = await register(ctx.app, 'prof_same');
    const token = reg.json().token as string;
    const id = reg.json().account.id as string;
    expect((await rename(token, 'prof_same')).statusCode).toBe(200);
    const audit = await ctx.raw.query(
      `SELECT 1 FROM auth_audit WHERE account_id = $1 AND event = 'change_username'`,
      [id],
    );
    expect(audit.rows).toHaveLength(0);
  });

  it('撞名（大小写归一）→ 409 USERNAME_TAKEN；自己改大小写不撞自己', async () => {
    await register(ctx.app, 'prof_taken');
    const other = await register(ctx.app, 'prof_other');
    const token = other.json().token as string;

    const taken = await rename(token, 'PROF_TAKEN');
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe('USERNAME_TAKEN');

    const ownCase = await rename(token, 'Prof_Other');
    expect(ownCase.statusCode).toBe(200);
    expect(ownCase.json().account.username).toBe('Prof_Other');
  });

  it('格式不合法 → 400 VALIDATION_FAILED（数字开头 / 太短 / 非法字符）', async () => {
    const token = (await register(ctx.app, 'prof_bad')).json().token as string;
    for (const bad of ['1abc', 'a', 'a b', 'a-b', '😀😀']) {
      const res = await rename(token, bad);
      expect(res.statusCode, `username=${bad}`).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('违禁词 → 400 USERNAME_FORBIDDEN（中文夹空白 / 英文词边界）', async () => {
    const token = (await register(ctx.app, 'prof_sensitive')).json().token as string;
    for (const bad of ['傻逼', '他妈的', 'fuckyou', 'a_nazi_b']) {
      const res = await rename(token, bad);
      expect(res.statusCode, `username=${bad}`).toBe(400);
      expect(res.json().error.code).toBe('USERNAME_FORBIDDEN');
    }
    // 反例：Sussex 里的 sex 不算（词边界）
    expect((await rename(token, 'Sussex')).statusCode).toBe(200);
  });

  it('未认证 → 401；日闸 2 次/日 → 第三发 429', async () => {
    const anon = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/me/username',
      payload: { username: 'prof_anon' },
    });
    expect(anon.statusCode).toBe(401);

    const token = (await register(rateCtx.app, 'prof_rate')).json().token as string;
    expect((await rename(token, 'prof_rate_1', rateCtx)).statusCode).toBe(200);
    expect((await rename(token, 'prof_rate_2', rateCtx)).statusCode).toBe(200);
    const third = await rename(token, 'prof_rate_3', rateCtx);
    expect(third.statusCode).toBe(429);
    expect(third.json().error.retryAfterMs).toBeGreaterThan(0);
  });
});

describe('头像 hash 同步', () => {
  it('登录/会话回话带 avatarHash；上传后立即变为新 hash', async () => {
    const reg = await register(ctx.app, 'prof_avatar');
    const token = reg.json().token as string;

    const loginRes = await login(ctx.app, 'prof_avatar');
    expect(loginRes.json().account.avatarHash).toBeNull();

    const up = await putAvatar(token);
    expect(up.statusCode).toBe(200);
    const hash = up.json().hash as string;
    expect(hash).toBe(createHash('sha256').update(PNG_1X1).digest('hex'));

    const loginAfter = await login(ctx.app, 'prof_avatar');
    expect(loginAfter.json().account.avatarHash).toBe(hash);

    const s = await ctx.app.inject({ method: 'GET', url: '/v1/auth/session', headers: bearer(token) });
    expect(s.json().account.avatarHash).toBe(hash);
  });

  it('排行榜快照路径：不重铸快照，改名 + 换头像后下一把拉榜即见新值', async () => {
    const reg = await register(ctx.app, 'prof_board_old');
    const token = reg.json().token as string;
    const id = reg.json().account.id as string;
    await ctx.raw.query(`UPDATE users SET leaderboard_opt_in = true WHERE id = $1`, [id]);

    const day = bjDay(-1);
    await ctx.raw.query(
      `INSERT INTO leaderboard_snapshots (period, period_key, account_id, score, rank, days, computed_at)
       VALUES ('daily', $1, $2, 900, 1, 1, now())`,
      [day, id],
    );

    const before = await ctx.app.inject({
      method: 'GET',
      url: '/v1/leaderboard?period=daily',
      headers: bearer(token),
    });
    expect(before.statusCode).toBe(200);
    const beforeRow = (before.json().entries as Array<Record<string, unknown>>).find(
      (e) => e['username'] === 'prof_board_old',
    );
    expect(beforeRow).toMatchObject({ avatarHash: null });

    const hash = (await putAvatar(token)).json().hash as string;
    expect((await rename(token, 'prof_board_new')).statusCode).toBe(200);

    const after = await ctx.app.inject({
      method: 'GET',
      url: '/v1/leaderboard?period=daily',
      headers: bearer(token),
    });
    const afterRow = (after.json().entries as Array<Record<string, unknown>>).find(
      (e) => e['username'] === 'prof_board_new',
    );
    expect(afterRow).toMatchObject({ username: 'prof_board_new', avatarHash: hash });
    // 快照行本身没有被重写（证明是 JOIN users 的实时读，不是重铸）
    const snap = await ctx.raw.query<{ score: number }>(
      `SELECT score FROM leaderboard_snapshots WHERE period = 'daily' AND period_key = $1 AND account_id = $2`,
      [day, id],
    );
    expect(snap.rows[0]!.score).toBe(900);
  });
});

// 密码常量在这里只是让「旧名字登不上」的注释自洽：login() 缺省用它。
void TEST_PASSWORD;
