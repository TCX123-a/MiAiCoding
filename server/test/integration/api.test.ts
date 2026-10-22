/**
 * /v1 全链路集成测试（真实 PGlite + fastify.inject，非 mock）：
 *  - 注册/登录/登出/session 全链路（含审计落库、令牌只存哈希、防枚举统一文案）；
 *  - 四份文档同步：CAS 链 rev1→2→3、CONFLICT_STALE / DOC_VER_BLOCKED、ETag/304、体积门 413；
 *  - 跨账号隔离（带正对照）、注入形态 payload 原样往返、协议头 426；
 *  - 限流三桶（注册 IP / 登录 IP / 账号级 API）+ 每用户名指数退避，全部用注入假时钟做确定性断言。
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
  registerPerHourPerIp: 1000,
  registerPerDayGlobal: 10_000,
  loginPer15MinPerIp: 1000,
  apiPerMinute: 10_000,
};

function ms(iso: string): number {
  return new Date(iso).getTime();
}

async function putDoc(
  app: TestContext['app'],
  token: string,
  docType: string,
  body: { docVer: number; baseRevision: number | null; payload: Record<string, unknown> },
) {
  return app.inject({
    method: 'PUT',
    url: `/v1/docs/${docType}`,
    headers: bearer(token),
    payload: body,
  });
}

// ---------------------------------------------------------------- main ctx

let main: TestContext;
beforeAll(async () => {
  main = await createTestContext({ rateLimits: HIGH_LIMITS });
});
afterAll(async () => {
  await main.raw.close();
});

describe('健康与元信息', () => {
  it('GET /v1/health：存活 + schemaVer=最新迁移版本，无需令牌', async () => {
    const res = await main.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.schemaVer).toBe(13); // 迁移集最高版本（0013_username_change_audit）
    expect(Number.isNaN(ms(body.serverTime))).toBe(false);
  });

  it('GET /v1/meta：apiVersion 与协议 current/floor', async () => {
    const res = await main.app.inject({ method: 'GET', url: '/v1/meta' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.apiVersion).toBe(1);
    expect(body.protocol).toEqual({ current: 1, floor: 1 });
    // capabilities 是客户端能力协商面：钉死内容（不是「是个数组就算过」）
    expect(body.capabilities).toEqual(['challenge_settle', 'rice_ledger', 'leaderboard']);
  });

  it('未知路由 → 结构化 404（不是 fastify 默认体）', async () => {
    const res = await main.app.inject({ method: 'GET', url: '/v1/definitely-not-a-route' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(typeof body.error.requestId).toBe('string');
    expect(body.error.requestId.length).toBeGreaterThan(0);
  });
});

describe('注册', () => {
  let aliceId = '';

  it('注册成功 201：令牌格式 / 过期时间 / 账号信息', async () => {
    const res = await register(main.app, 'alice');
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toMatch(/^ms1_[A-Za-z0-9_-]{43}$/);
    expect(ms(body.absoluteExpiresAt)).toBeGreaterThan(ms(body.expiresAt));
    expect(body.account.username).toBe('alice');
    expect(Number.isNaN(ms(body.account.createdAt))).toBe(false);
    aliceId = body.account.id;
  });

  it('存储侧：argon2id PHC 参数正确；令牌只存 sha256、原文不落库；register 已审计', async () => {
    const { rows } = await main.raw.query<{ id: string; password_hash: string }>(
      `SELECT id, password_hash FROM users WHERE username_lower = 'alice'`,
    );
    expect(rows[0]!.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(rows[0]!.password_hash).not.toContain(TEST_PASSWORD);

    const sessions = await main.raw.query<{ token_hash: string }>(
      `SELECT token_hash FROM sessions WHERE account_id = $1 AND revoked_at IS NULL`,
      [rows[0]!.id],
    );
    expect(sessions.rows.length).toBeGreaterThanOrEqual(1);
    for (const row of sessions.rows) {
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    }
    // 与注册返回的令牌哈希一致：用登录取一个新令牌再比对更直接
    const loginRes = await login(main.app, 'alice');
    const freshToken = loginRes.json().token as string;
    const fresh = await main.raw.query<{ token_hash: string }>(
      `SELECT token_hash FROM sessions WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [rows[0]!.id],
    );
    expect(fresh.rows[0]!.token_hash).toBe(hashToken(freshToken));

    const audit = await main.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM auth_audit WHERE event = 'register' AND username = 'alice'`,
    );
    expect(audit.rows[0]!.n).toBe(1);
    expect(aliceId).toBe(rows[0]!.id);
  });

  it('用户名大小写归一撞键 → 409 USERNAME_TAKEN', async () => {
    const res = await register(main.app, 'Alice');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('USERNAME_TAKEN');
  });

  it('弱密码黑名单 → 400，账号不落库（12+ 位与 6~11 位两档各测一枚）', async () => {
    const res = await register(main.app, 'weakpw', 'password1234');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    const rows = await main.raw.query(`SELECT 1 FROM users WHERE username_lower = 'weakpw'`);
    expect(rows.rows.length).toBe(0);

    // 2026-10-13 放宽下限到 6 位后，6~11 位档不再是「长度规则先挡」的死区：黑名单必须接住
    const short = await register(main.app, 'weakpw6', '123456');
    expect(short.statusCode).toBe(400);
    expect(short.json().error.code).toBe('VALIDATION_FAILED');
    const rows2 = await main.raw.query(`SELECT 1 FROM users WHERE username_lower = 'weakpw6'`);
    expect(rows2.rows.length).toBe(0);
  });

  it('过短 / 含用户名子串 → 400；恰 6 位（新下限）且干净 → 201', async () => {
    expect((await register(main.app, 'shortpw', 'short')).statusCode).toBe(400); // 5 位 < 新下限 6
    expect((await register(main.app, 'subcheck', 'subcheck12345')).statusCode).toBe(400);
    const six = await register(main.app, 'sixpw', 'kf7#mQ');
    expect(six.statusCode).toBe(201);
  });

  it('非法用户名 → 400（zod 层拦截）：1 位 / 数字开头 / 含空格 / 注入形态', async () => {
    expect((await register(main.app, 'a')).statusCode).toBe(400); // 1 位（下限 2）
    expect((await register(main.app, '1ab')).statusCode).toBe(400); // 数字开头（旧规则收、新规则拒）
    expect((await register(main.app, 'has space')).statusCode).toBe(400);
    const res = await register(main.app, "x'; DROP TABLE users; --");
    expect(res.statusCode).toBe(400);
    const intact = await main.raw.query<{ n: number }>(`SELECT count(*)::int AS n FROM users`);
    expect(intact.rows[0]!.n).toBeGreaterThan(0);
  });

  it('2026-10-13 放宽正例：中文用户名与 2 位用户名 → 201', async () => {
    expect((await register(main.app, '小明')).statusCode).toBe(201);
    expect((await register(main.app, 'ab')).statusCode).toBe(201); // 旧规则拒（3 位起）、新规则收
  });

  it('认证体超 16KB → 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await main.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { username: 'bigpw', password: 'z'.repeat(20_000) },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('登录 / 会话 / 登出', () => {
  it('正确口令 200；令牌换 session 信息（含两级过期时间）', async () => {
    const res = await login(main.app, 'alice');
    expect(res.statusCode).toBe(200);
    const token = res.json().token as string;
    expect(token).toMatch(/^ms1_[A-Za-z0-9_-]{43}$/);

    const session = await main.app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: bearer(token),
    });
    expect(session.statusCode).toBe(200);
    const body = session.json();
    expect(body.account.username).toBe('alice');
    expect(ms(body.idleExpiresAt)).toBeGreaterThan(Date.now());
    expect(ms(body.absoluteExpiresAt)).toBeGreaterThan(ms(body.idleExpiresAt));
  });

  it('密码错与账号不存在：同为 401 BAD_CREDENTIALS 且文案一致（防枚举）', async () => {
    const wrong = await login(main.app, 'alice', 'totally wrong pw 1');
    const unknown = await login(main.app, 'ghost_user', 'whatever pass 12');
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('BAD_CREDENTIALS');
    expect(unknown.json().error.code).toBe('BAD_CREDENTIALS');
    expect(unknown.json().error.message).toBe(wrong.json().error.message);
  });

  it('登出幂等 204；吊销后令牌立即 401；logout 已审计', async () => {
    const token = (await login(main.app, 'alice')).json().token as string;
    const first = await main.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: bearer(token),
    });
    expect(first.statusCode).toBe(204);
    const second = await main.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: bearer(token),
    });
    expect(second.statusCode).toBe(204);

    const after = await main.app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: bearer(token),
    });
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe('UNAUTHENTICATED');

    const audit = await main.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM auth_audit WHERE event = 'logout'`,
    );
    expect(audit.rows[0]!.n).toBeGreaterThanOrEqual(1);
  });

  it('畸形 / 未知令牌 → 401 UNAUTHENTICATED', async () => {
    const none = await main.app.inject({ method: 'GET', url: '/v1/auth/session' });
    expect(none.statusCode).toBe(401);

    const garbage = await main.app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: bearer('garbage-token'),
    });
    expect(garbage.statusCode).toBe(401);

    const wellFormedUnknown = await main.app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: bearer(`ms1_${'A'.repeat(43)}`),
    });
    expect(wellFormedUnknown.statusCode).toBe(401);
    expect(wellFormedUnknown.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('禁用账号：登录 403 FORBIDDEN；既有令牌 403', async () => {
    const reg = await register(main.app, 'dave');
    expect(reg.statusCode).toBe(201);
    const token = reg.json().token as string;
    await main.raw.query(`UPDATE users SET disabled_at = now() WHERE username_lower = 'dave'`);

    const loginRes = await login(main.app, 'dave');
    expect(loginRes.statusCode).toBe(403);
    expect(loginRes.json().error.code).toBe('FORBIDDEN');

    const session = await main.app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: bearer(token),
    });
    expect(session.statusCode).toBe(403);
  });
});

describe('文档同步 /v1/docs', () => {
  let noraToken = '';
  let patToken = '';

  beforeAll(async () => {
    noraToken = (await register(main.app, 'nora')).json().token as string;
    patToken = (await register(main.app, 'pat')).json().token as string;
  });

  it('新账号摘要：四类全 null', async () => {
    const res = await main.app.inject({ method: 'GET', url: '/v1/docs', headers: bearer(noraToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ profile: null, wrongbook: null, favorites: null, practice: null });
  });

  it('未推送拉取 → 404；未认证 → 401；未知类型 → 400', async () => {
    const missing = await main.app.inject({
      method: 'GET',
      url: '/v1/docs/profile',
      headers: bearer(noraToken),
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('NOT_FOUND');

    const noAuth = await main.app.inject({ method: 'GET', url: '/v1/docs' });
    expect(noAuth.statusCode).toBe(401);
    expect(noAuth.json().error.code).toBe('UNAUTHENTICATED');

    const badType = await main.app.inject({
      method: 'GET',
      url: '/v1/docs/nobody',
      headers: bearer(noraToken),
    });
    expect(badType.statusCode).toBe(400);
    expect(badType.json().error.code).toBe('VALIDATION_FAILED');

    const putNoAuth = await main.app.inject({
      method: 'PUT',
      url: '/v1/docs/profile',
      payload: { docVer: 1, baseRevision: null, payload: { version: 1 } },
    });
    expect(putNoAuth.statusCode).toBe(401);
  });

  it('首次推送 rev=1；拉取往返一致；ETag 304（含反例）', async () => {
    const put = await putDoc(main.app, noraToken, 'profile', {
      docVer: 1,
      baseRevision: null,
      payload: { version: 1, name: 'miai', count: 0 },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ revision: 1, docVer: 1 });

    const get = await main.app.inject({
      method: 'GET',
      url: '/v1/docs/profile',
      headers: bearer(noraToken),
    });
    expect(get.statusCode).toBe(200);
    expect(get.headers.etag).toBe('"1"');
    expect(get.json()).toMatchObject({
      revision: 1,
      docVer: 1,
      payload: { version: 1, name: 'miai', count: 0 },
    });

    const cached = await main.app.inject({
      method: 'GET',
      url: '/v1/docs/profile',
      headers: { ...bearer(noraToken), 'if-none-match': '"1"' },
    });
    expect(cached.statusCode).toBe(304);
    expect(cached.body).toBe('');

    const notCached = await main.app.inject({
      method: 'GET',
      url: '/v1/docs/profile',
      headers: { ...bearer(noraToken), 'if-none-match': '"0"' },
    });
    expect(notCached.statusCode).toBe(200); // 304 不是无条件的（尺子自检）
  });

  it('docVer 与 payload.version 不一致 → 400', async () => {
    const res = await putDoc(main.app, noraToken, 'profile', {
      docVer: 2,
      baseRevision: 1,
      payload: { version: 3, name: 'miai' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('CAS 链 rev1→2→3（doc_ver 可跳变）', async () => {
    const second = await putDoc(main.app, noraToken, 'profile', {
      docVer: 2,
      baseRevision: 1,
      payload: { version: 2, name: 'miai', count: 1 },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ revision: 2, docVer: 2 });

    const third = await putDoc(main.app, noraToken, 'profile', {
      docVer: 5,
      baseRevision: 2,
      payload: { version: 5, name: 'miai', count: 2 },
    });
    expect(third.statusCode).toBe(200);
    expect(third.json()).toMatchObject({ revision: 3, docVer: 5 });
  });

  it('陈旧 baseRevision → 409 CONFLICT_STALE + details 供重合并', async () => {
    const res = await putDoc(main.app, noraToken, 'profile', {
      docVer: 6,
      baseRevision: 1,
      payload: { version: 6, name: 'miai' },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe('CONFLICT_STALE');
    expect(body.error.details).toEqual({ currentRevision: 3, currentDocVer: 5 });
  });

  it('doc_ver 回退 → 409 DOC_VER_BLOCKED（与 STALE 分流正确）', async () => {
    const res = await putDoc(main.app, noraToken, 'profile', {
      docVer: 4,
      baseRevision: 3,
      payload: { version: 4, name: 'miai' },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe('DOC_VER_BLOCKED');
    expect(body.error.details).toEqual({ currentRevision: 3, currentDocVer: 5 });
  });

  it('已有文档再走 baseRevision=null → 409 CONFLICT_STALE', async () => {
    const res = await putDoc(main.app, noraToken, 'profile', {
      docVer: 7,
      baseRevision: null,
      payload: { version: 7, name: 'miai' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT_STALE');
  });

  it('四类文档各自独立；摘要含 revision/docVer/sizeBytes/updatedAt', async () => {
    for (const type of ['wrongbook', 'favorites', 'practice'] as const) {
      const res = await putDoc(main.app, noraToken, type, {
        docVer: 1,
        baseRevision: null,
        payload: { version: 1, items: [] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().revision).toBe(1);
    }

    const summary = await main.app.inject({
      method: 'GET',
      url: '/v1/docs',
      headers: bearer(noraToken),
    });
    expect(summary.statusCode).toBe(200);
    const body = summary.json();
    expect(body.profile).toMatchObject({ revision: 3, docVer: 5 });
    for (const type of ['wrongbook', 'favorites', 'practice'] as const) {
      expect(body[type]).toMatchObject({ revision: 1, docVer: 1 });
      expect(body[type].sizeBytes).toBeGreaterThan(0);
      expect(Number.isNaN(ms(body[type].updatedAt))).toBe(false);
    }
  });

  it('体积门按实际字节（profile 2MiB）：413 + 事务回滚正对照', async () => {
    const res = await putDoc(main.app, noraToken, 'profile', {
      docVer: 5,
      baseRevision: 3,
      payload: { version: 5, name: 'miai', count: 2, pad: 'x'.repeat(2 * 1024 * 1024 + 64) },
    });
    expect(res.statusCode).toBe(413);
    const body = res.json();
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.error.details.docType).toBe('profile');
    expect(body.error.details.limitBytes).toBe(2 * 1024 * 1024);
    expect(body.error.details.sizeBytes).toBeGreaterThan(2 * 1024 * 1024);

    const get = await main.app.inject({
      method: 'GET',
      url: '/v1/docs/profile',
      headers: bearer(noraToken),
    });
    expect(get.json().revision).toBe(3); // 超限写入未落库
    expect(get.json().payload.pad).toBeUndefined();
  });

  it('跨账号隔离：pat 看不到 nora 的文档；同名类型各自独立（带正对照）', async () => {
    const patSummary = await main.app.inject({
      method: 'GET',
      url: '/v1/docs',
      headers: bearer(patToken),
    });
    expect(patSummary.json()).toEqual({
      profile: null,
      wrongbook: null,
      favorites: null,
      practice: null,
    });

    const patGet = await main.app.inject({
      method: 'GET',
      url: '/v1/docs/profile',
      headers: bearer(patToken),
    });
    expect(patGet.statusCode).toBe(404); // 不是读到 nora 的数据

    const patPut = await putDoc(main.app, patToken, 'profile', {
      docVer: 1,
      baseRevision: null,
      payload: { version: 1, owner: 'pat' },
    });
    expect(patPut.statusCode).toBe(200);
    expect(patPut.json().revision).toBe(1); // pat 从 rev1 开始，与 nora 的 rev3 互不干扰

    const patOwn = await main.app.inject({
      method: 'GET',
      url: '/v1/docs/profile',
      headers: bearer(patToken),
    });
    expect(patOwn.json().payload.owner).toBe('pat');

    const noraStill = await main.app.inject({
      method: 'GET',
      url: '/v1/docs/profile',
      headers: bearer(noraToken),
    });
    expect(noraStill.json().revision).toBe(3);
    expect(noraStill.json().payload.count).toBe(2);
  });

  it('注入形态 payload 原样往返，user_docs 表完好', async () => {
    const nasty = `'; DROP TABLE user_docs; --`;
    const put = await putDoc(main.app, patToken, 'wrongbook', {
      docVer: 1,
      baseRevision: null,
      payload: { version: 1, note: nasty, n: 1 },
    });
    expect(put.statusCode).toBe(200);

    const get = await main.app.inject({
      method: 'GET',
      url: '/v1/docs/wrongbook',
      headers: bearer(patToken),
    });
    expect(get.json().payload.note).toBe(nasty);

    const table = await main.raw.query<{ t: string | null }>(
      `SELECT to_regclass('public.user_docs')::text AS t`,
    );
    expect(table.rows[0]!.t).toBe('user_docs');
  });

  it('payload 非对象（数组）→ 400', async () => {
    const res = await main.app.inject({
      method: 'PUT',
      url: '/v1/docs/practice',
      headers: bearer(patToken),
      payload: { docVer: 1, baseRevision: null, payload: [1, 2, 3] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('X-Sync-Protocol：0 → 426、非整数 → 400、缺省与 1 → 正常', async () => {
    const old = await main.app.inject({
      method: 'GET',
      url: '/v1/docs',
      headers: { ...bearer(noraToken), 'x-sync-protocol': '0' },
    });
    expect(old.statusCode).toBe(426);
    expect(old.json().error.code).toBe('PROTOCOL_TOO_OLD');

    const bad = await main.app.inject({
      method: 'GET',
      url: '/v1/docs',
      headers: { ...bearer(noraToken), 'x-sync-protocol': 'abc' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('BAD_REQUEST');

    const ok = await main.app.inject({
      method: 'GET',
      url: '/v1/docs',
      headers: { ...bearer(noraToken), 'x-sync-protocol': '1' },
    });
    expect(ok.statusCode).toBe(200);

    const putOld = await main.app.inject({
      method: 'PUT',
      url: '/v1/docs/profile',
      headers: { ...bearer(noraToken), 'x-sync-protocol': '0' },
      payload: { docVer: 5, baseRevision: 3, payload: { version: 5 } },
    });
    expect(putOld.statusCode).toBe(426);
  });
});

describe('限流：注册 IP 桶 + 每用户名退避（假时钟）', () => {
  let ctx: TestContext;
  let now = 1_700_000_000_000;

  beforeAll(async () => {
    ctx = await createTestContext({
      clock: () => now,
      rateLimits: { ...HIGH_LIMITS, registerPerHourPerIp: 5, registerPerDayGlobal: 50 },
    });
  });
  afterAll(async () => {
    await ctx.raw.close();
  });

  it('注册 5/时/IP：第 6 个 429 + Retry-After；时钟前进 1h 后恢复', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await register(ctx.app, `reg_u${i}`)).statusCode).toBe(201);
    }
    const sixth = await register(ctx.app, 'reg_u5');
    expect(sixth.statusCode).toBe(429);
    const body = sixth.json();
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.retryAfterMs).toBe(720_000); // 5/时 → 每 12 分钟补 1 个令牌
    expect(Number(sixth.headers['retry-after'])).toBe(720);

    // 正对照：第 6 个账号确实没有创建
    expect((await login(ctx.app, 'reg_u5')).statusCode).toBe(401);

    now += 3_600_000;
    expect((await register(ctx.app, 'reg_u6')).statusCode).toBe(201);
  });

  it('每用户名 5 连败 → 指数退避 60s：正确口令也 429；窗口过后可登录；成功清零', async () => {
    expect((await login(ctx.app, 'reg_u0')).statusCode).toBe(200);

    for (let i = 0; i < 5; i += 1) {
      const fail = await login(ctx.app, 'reg_u0', 'wrong password 000');
      expect(fail.statusCode).toBe(401);
      expect(fail.json().error.code).toBe('BAD_CREDENTIALS');
    }

    const blocked = await login(ctx.app, 'reg_u0');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.retryAfterMs).toBe(60_000);
    expect(blocked.json().error.message).toMatch(/failed login attempts/);

    const audit = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM auth_audit WHERE event = 'login_blocked' AND username = 'reg_u0'`,
    );
    expect(audit.rows[0]!.n).toBeGreaterThanOrEqual(1);

    now += 60_000; // 退避窗口是减速带不是墙：过后正确口令可登录
    expect((await login(ctx.app, 'reg_u0')).statusCode).toBe(200);

    // 成功即清零：紧接着错误一次是 401（不是 429）
    expect((await login(ctx.app, 'reg_u0', 'wrong password 000')).statusCode).toBe(401);
    expect((await login(ctx.app, 'reg_u0')).statusCode).toBe(200);
  });
});

describe('限流：登录 IP 桶 30/15min（假时钟，默认值）', () => {
  let ctx: TestContext;
  let now = 1_700_000_000_000;

  beforeAll(async () => {
    ctx = await createTestContext({ clock: () => now });
  });
  afterAll(async () => {
    await ctx.raw.close();
  });

  it('第 30 次放行、第 31 次 429；按速率回补（30s 补 1 个令牌）', async () => {
    for (let i = 0; i < 30; i += 1) {
      const res = await login(ctx.app, `ip_u${i}`, 'wrong password 000');
      expect(res.statusCode).toBe(401);
    }
    const over = await login(ctx.app, 'ip_u30', 'wrong password 000');
    expect(over.statusCode).toBe(429);
    expect(over.json().error.code).toBe('RATE_LIMITED');
    expect(over.json().error.message).toMatch(/too many login attempts/);
    expect(over.json().error.retryAfterMs).toBe(30_000);

    now += 30_000;
    expect((await login(ctx.app, 'ip_u31', 'wrong password 000')).statusCode).toBe(401);
  });
});

describe('限流：全局注册日桶 + 账号级 API 桶（覆写 2 / 3）', () => {
  let ctx: TestContext;
  let gNow = 1_700_000_000_000;

  beforeAll(async () => {
    ctx = await createTestContext({
      clock: () => gNow, // 冻结时钟 → 令牌桶读数精确（真实时钟下毫秒级回补会漂移）
      rateLimits: { registerPerDayGlobal: 2, apiPerMinute: 3 },
    });
  });
  afterAll(async () => {
    await ctx.raw.close();
  });

  it('第 3 个注册 429；账号级桶第 4 个请求 429；另一账号不受影响', async () => {
    const r1 = await register(ctx.app, 'g_one');
    expect(r1.statusCode).toBe(201);
    const r2 = await register(ctx.app, 'g_two');
    expect(r2.statusCode).toBe(201);

    const r3 = await register(ctx.app, 'g_three');
    expect(r3.statusCode).toBe(429);
    expect(r3.json().error.message).toMatch(/temporarily unavailable/);

    const tok1 = r1.json().token as string;
    for (let i = 0; i < 3; i += 1) {
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/v1/auth/session',
        headers: bearer(tok1),
      });
      expect(res.statusCode).toBe(200);
    }
    const fourth = await ctx.app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: bearer(tok1),
    });
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json().error.retryAfterMs).toBe(20_000); // 3/分钟 → 每 20s 补 1 个

    const tok2 = r2.json().token as string;
    const other = await ctx.app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: bearer(tok2),
    });
    expect(other.statusCode).toBe(200);
  });
});
