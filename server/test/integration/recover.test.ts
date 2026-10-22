/**
 * 找回密码三步链集成测试（2026-10-13 主人令；真实 PGlite + fastify.inject，非 mock）：
 *  - question → verify → reset 全链路：问题回显、答案归一化（全角/大小写/首尾空白）、
 *    reset 后旧密码不通/新密码通、两枚旧会话全吊销（reason='password_change'）、
 *    password_changed_at 落库、审计 password_reset、答案只存 argon2id 哈希；
 *  - 失败分支：账号不存在 NOT_FOUND / 无问答存量账号 NO_SECURITY_QUESTION / 答案错
 *    BAD_SECURITY_ANSWER（含审计 recover_fail）/ 新密码不合策略 VALIDATION_FAILED（密码与
 *    会话都不许动）/ reset 里答案再核（纵深：verify 过了也不算数）；
 *  - 注册侧必填：缺问答字段 / 答案全空白 / 问题不在枚举 → 400；
 *  - 防爆破两层（独立小值 ctx + 按 IP 分流 remoteAddress，避免用例互相污染桶）：
 *    连续失败 5 次 → 第 6 次进退避 RATE_LIMITED；IP 闸三端点共桶；账号日闸 verify/reset 共桶。
 * 只动 test/**。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createTestContext,
  login,
  register,
  TEST_ANSWER,
  TEST_PASSWORD,
  TEST_QUESTION,
  type TestContext,
} from '../helpers/app.js';

const HIGH_LIMITS = {
  registerPerHourPerIp: 100_000,
  registerPerDayGlobal: 1_000_000,
  loginPer15MinPerIp: 10_000,
  apiPerMinute: 1_000_000,
  recoverPer15MinPerIp: 100_000,
  recoverAttemptPerDayPerAccount: 100_000,
};

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext({ rateLimits: HIGH_LIMITS });
});
afterAll(async () => {
  await ctx.raw.close();
});

const questionOf = (app: TestContext['app'], username: string) =>
  app.inject({ method: 'POST', url: '/v1/auth/recover/question', payload: { username } });
const verifyOf = (app: TestContext['app'], username: string, answer: string) =>
  app.inject({ method: 'POST', url: '/v1/auth/recover/verify', payload: { username, answer } });
const resetOf = (app: TestContext['app'], username: string, answer: string, newPassword: string) =>
  app.inject({ method: 'POST', url: '/v1/auth/recover/reset', payload: { username, answer, newPassword } });

describe('找回链 · 全链路', () => {
  it('注册带问答 → question 回显 → verify（全角+大小写+空白归一化）→ reset → 会话全吊销、旧密码不通、新密码通、审计与时间戳落库', async () => {
    const reg = await register(ctx.app, 'recover_full', TEST_PASSWORD, 'XiaoHei');
    expect(reg.statusCode).toBe(201);
    const token1 = reg.json().token as string;
    const id = reg.json().account.id as string;
    const token2 = (await login(ctx.app, 'recover_full')).json().token as string; // 第二枚会话

    // ① 取问题：回显注册时选的那条
    const q = await questionOf(ctx.app, 'recover_full');
    expect(q.statusCode).toBe(200);
    expect(q.json().question).toBe(TEST_QUESTION);

    // ② 验答案：注册答 'XiaoHei'，这里用全角大写 + 首尾空白 —— NFKC+trim+lower 归一化后应通过
    const v = await verifyOf(ctx.app, 'recover_full', '  ＸＩＡＯＨＥＩ  ');
    expect(v.statusCode).toBe(200);
    expect(v.json().verified).toBe(true);

    // ③ 重置：答案在这一步会被再核一遍（纵深）
    const NEW_PW = 'new pass 456';
    const r = await resetOf(ctx.app, 'recover_full', 'xiaohei', NEW_PW);
    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(true);

    // 两枚旧会话全死
    for (const t of [token1, token2]) {
      const s = await ctx.app.inject({ method: 'GET', url: '/v1/auth/session', headers: bearer(t) });
      expect(s.statusCode).toBe(401);
    }
    // DB 证据：两行 reason=password_change；password_changed_at 非空；审计 password_reset 恰一条
    const revoked = await ctx.raw.query<{ revoked_reason: string }>(
      `SELECT revoked_reason FROM sessions WHERE account_id = $1 AND revoked_at IS NOT NULL`,
      [id],
    );
    expect(revoked.rows).toHaveLength(2);
    expect(revoked.rows.every((row) => row.revoked_reason === 'password_change')).toBe(true);
    const ts = await ctx.raw.query<{ changed: boolean }>(
      `SELECT (password_changed_at IS NOT NULL) AS changed FROM users WHERE id = $1`,
      [id],
    );
    expect(ts.rows[0]!.changed).toBe(true);
    const audit = await ctx.raw.query(
      `SELECT 1 FROM auth_audit WHERE account_id = $1 AND event = 'password_reset'`,
      [id],
    );
    expect(audit.rows).toHaveLength(1);

    // 旧密码不通、新密码通
    expect((await login(ctx.app, 'recover_full', TEST_PASSWORD)).statusCode).toBe(401);
    expect((await login(ctx.app, 'recover_full', NEW_PW)).statusCode).toBe(200);

    // 答案只存 argon2id 哈希：库里的值匹配 PHC 前缀、不含明文
    const hash = await ctx.raw.query<{ security_answer_hash: string }>(
      `SELECT security_answer_hash FROM users WHERE id = $1`,
      [id],
    );
    expect(hash.rows[0]!.security_answer_hash).toMatch(/^\$argon2id\$/);
    expect(hash.rows[0]!.security_answer_hash).not.toContain('xiaohei');

    // 问题未被 reset 改动：重置后仍能取到同一条
    expect((await questionOf(ctx.app, 'recover_full')).json().question).toBe(TEST_QUESTION);
  });
});

describe('找回链 · 失败分支', () => {
  it('账号不存在：question / verify / reset 一律 NOT_FOUND(404)', async () => {
    expect((await questionOf(ctx.app, 'ghost_user')).statusCode).toBe(404);
    expect((await questionOf(ctx.app, 'ghost_user')).json().error.code).toBe('NOT_FOUND');

    const v = await verifyOf(ctx.app, 'ghost_user', 'whatever');
    expect(v.statusCode).toBe(404);
    expect(v.json().error.code).toBe('NOT_FOUND');

    const r = await resetOf(ctx.app, 'ghost_user', 'whatever', 'brand new pw 9');
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe('NOT_FOUND');
  });

  it('存量账号没设过安全问题（两列置 NULL 模拟 0012 之前注册）→ NO_SECURITY_QUESTION(404)，question 与 verify 同口径', async () => {
    const reg = await register(ctx.app, 'recover_legacy');
    const id = reg.json().account.id as string;
    await ctx.raw.query(
      `UPDATE users SET security_question = NULL, security_answer_hash = NULL WHERE id = $1`,
      [id],
    );

    const q = await questionOf(ctx.app, 'recover_legacy');
    expect(q.statusCode).toBe(404);
    expect(q.json().error.code).toBe('NO_SECURITY_QUESTION');

    const v = await verifyOf(ctx.app, 'recover_legacy', TEST_ANSWER);
    expect(v.statusCode).toBe(404);
    expect(v.json().error.code).toBe('NO_SECURITY_QUESTION');
  });

  it('答案错 → BAD_SECURITY_ANSWER(401) + 审计 recover_fail；连续 5 次后进指数退避 → 第 6 次 429', async () => {
    const reg = await register(ctx.app, 'recover_wrong');
    const id = reg.json().account.id as string;

    for (let i = 1; i <= 5; i += 1) {
      const v = await verifyOf(ctx.app, 'recover_wrong', `wrong-${i}`);
      expect(v.statusCode).toBe(401);
      expect(v.json().error.code).toBe('BAD_SECURITY_ANSWER');
    }
    // 第 6 次：正确答案也被退避挡住（threshold=5）
    const blocked = await verifyOf(ctx.app, 'recover_wrong', TEST_ANSWER);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('RATE_LIMITED');
    expect(blocked.json().error.retryAfterMs).toBeGreaterThan(0);

    // 审计：5 条带账号（bad_answer）+ 1 条只带用户名（退避发生在查账号之前）
    const byAccount = await ctx.raw.query(
      `SELECT 1 FROM auth_audit WHERE account_id = $1 AND event = 'recover_fail'`,
      [id],
    );
    expect(byAccount.rows).toHaveLength(5);
    const byName = await ctx.raw.query(
      `SELECT 1 FROM auth_audit WHERE username = 'recover_wrong' AND event = 'recover_fail'`,
    );
    expect(byName.rows).toHaveLength(6);
  });

  it('reset 新密码不合策略 → 400 且密码与会话都不许动（旧密码仍可登录、旧令牌仍有效）', async () => {
    const reg = await register(ctx.app, 'recover_pol');
    const token = reg.json().token as string;

    const r = await resetOf(ctx.app, 'recover_pol', TEST_ANSWER, '123456');
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('VALIDATION_FAILED');

    expect((await login(ctx.app, 'recover_pol', TEST_PASSWORD)).statusCode).toBe(200);
    const s = await ctx.app.inject({ method: 'GET', url: '/v1/auth/session', headers: bearer(token) });
    expect(s.statusCode).toBe(200);
  });

  it('reset 的答案与 verify 不互信（纵深）：verify 过 ≠ reset 放行', async () => {
    await register(ctx.app, 'recover_again');
    expect((await verifyOf(ctx.app, 'recover_again', TEST_ANSWER)).statusCode).toBe(200);

    const r = await resetOf(ctx.app, 'recover_again', 'not-the-answer', 'brand new pw 9');
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('BAD_SECURITY_ANSWER');
    expect((await login(ctx.app, 'recover_again', TEST_PASSWORD)).statusCode).toBe(200);
  });
});

describe('注册侧 · 安全问答必填', () => {
  it('缺问答字段 / 答案全空白 / 问题不在枚举 → 400 VALIDATION_FAILED', async () => {
    const noQA = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { username: 'noqa', password: TEST_PASSWORD },
    });
    expect(noQA.statusCode).toBe(400);
    expect(noQA.json().error.code).toBe('VALIDATION_FAILED');

    const blank = await register(ctx.app, 'blankqa', TEST_PASSWORD, '   ');
    expect(blank.statusCode).toBe(400);
    expect(blank.json().error.code).toBe('VALIDATION_FAILED');

    const badQuestion = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'badq',
        password: TEST_PASSWORD,
        securityQuestion: '我自己编的问题？',
        securityAnswer: 'x',
      },
    });
    expect(badQuestion.statusCode).toBe(400);
    expect(badQuestion.json().error.code).toBe('VALIDATION_FAILED');
  });
});

describe('找回限流（独立小值 ctx；按 remoteAddress 分流 IP 桶防用例互染）', () => {
  let rl: TestContext;
  beforeAll(async () => {
    rl = await createTestContext({
      rateLimits: { ...HIGH_LIMITS, recoverPer15MinPerIp: 3, recoverAttemptPerDayPerAccount: 2 },
    });
  });
  afterAll(async () => {
    await rl.raw.close();
  });

  it('IP 闸：找回端点共用一桶 3/15min，第 4 次 429（成败均计）', async () => {
    await register(rl.app, 'rl_ip');
    const call = () =>
      rl.app.inject({
        method: 'POST',
        url: '/v1/auth/recover/question',
        payload: { username: 'rl_ip' },
        remoteAddress: '10.9.9.1',
      });
    expect((await call()).statusCode).toBe(200);
    expect((await call()).statusCode).toBe(200);
    expect((await call()).statusCode).toBe(200);
    const fourth = await call();
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json().error.code).toBe('RATE_LIMITED');
    expect(fourth.json().error.message).toContain('from this address');
  });

  it('账号日闸：verify 与 reset 共用 2/日 桶，第 3 次 429（message 指向账号，区别于 IP 闸）', async () => {
    await register(rl.app, 'rl_day');
    const call = (answer: string) =>
      rl.app.inject({
        method: 'POST',
        url: '/v1/auth/recover/verify',
        payload: { username: 'rl_day', answer },
        remoteAddress: '10.9.9.2',
      });
    // 前 2 次：答案错，BAD_SECURITY_ANSWER（同时吃日闸 2/2）；第 3 次：日闸先炸
    expect((await call('a1')).statusCode).toBe(401);
    expect((await call('a2')).statusCode).toBe(401);
    const third = await call('a3');
    expect(third.statusCode).toBe(429);
    expect(third.json().error.message).toContain('for this account');
  });
});
