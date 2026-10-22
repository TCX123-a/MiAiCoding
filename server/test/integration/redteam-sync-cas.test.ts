/**
 * 红队验收 · 文档同步的跨账号隔离与 CAS 语义（docs/22 §4.3/§4.6/§11.3-11.4）。
 *  - A 写不到 B：先由 SQL 直接种下 B 的行（伪造挂 B），A 的读/写全程不得触碰 B（含阳性对照）；
 *    身份字段注入（payload 里塞 B 的 account_id）对状态与后续读无影响；
 *  - rev（revision）流程：单调 +1、doc_ver 跳变/持平/回退三态、分类边界（DOC_VER_BLOCKED
 *    vs CONFLICT_STALE）、云端无行时 baseRevision≠null 的分类出口；
 *  - 并发写：同 baseRevision 双写恰一胜一败（CAS 永不多赢），终态恰为胜者；
 *  - 请求形态与传输映射：非法 docVer/baseRevision → 400；坏 JSON → 400；未知媒体类型 → 415；
 *    X-Sync-Protocol 的 -1 → 426、2 → 放行。
 * 注：epoch 属客户端写口语义（§11.3），服务端对应门 = doc_ver 不回退 + revision CAS，即本文件的 rev 流程。
 * 只动 test/**，src 缺陷只记录不修。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOC_TYPES } from '../../src/protocol.js';
import {
  bearer,
  createTestContext,
  register,
  type TestContext,
} from '../helpers/app.js';

const HIGH_LIMITS = {
  registerPerHourPerIp: 100_000,
  registerPerDayGlobal: 1_000_000,
  loginPer15MinPerIp: 10_000,
  apiPerMinute: 1_000_000,
};

let ctx: TestContext;
afterAll(async () => {
  await ctx.raw.close();
});

let isoAToken = '';
let isoBToken = '';
let isoAId = '';
let isoBId = '';

function putDoc(
  token: string,
  docType: string,
  body: { docVer: number; baseRevision: number | null; payload: Record<string, unknown> },
) {
  return ctx.app.inject({
    method: 'PUT',
    url: `/v1/docs/${docType}`,
    headers: bearer(token),
    payload: body,
  });
}

function getDoc(token: string, docType: string) {
  return ctx.app.inject({ method: 'GET', url: `/v1/docs/${docType}`, headers: bearer(token) });
}

beforeAll(async () => {
  ctx = await createTestContext({ rateLimits: HIGH_LIMITS });
  const a = await register(ctx.app, 'iso_a');
  const b = await register(ctx.app, 'iso_b');
  isoAToken = a.json().token as string;
  isoBToken = b.json().token as string;
  isoAId = a.json().account.id as string;
  isoBId = b.json().account.id as string;
});

describe('跨账号隔离（写侧）：A 写不到 B（四文档逐类验证）', () => {
  it('B 的四种文档由 SQL 直接种下：A 逐类读 404、摘要全 null；阳性对照 B 逐类读到自己那份', async () => {
    for (const docType of DOC_TYPES) {
      await ctx.raw.query(
        `INSERT INTO user_docs (account_id, doc_type, revision, doc_ver, payload)
         VALUES ($1, $2, 1, 1, $3::jsonb)`,
        [isoBId, docType, JSON.stringify({ version: 1, secret: `b-only-${docType}` })],
      );
    }

    const seeded = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM user_docs WHERE account_id = $1`,
      [isoBId],
    );
    expect(seeded.rows[0]!.n).toBe(DOC_TYPES.length); // 种子自检：四类都真的种下了（防循环空转的假绿）

    const aSummary = await ctx.app.inject({ method: 'GET', url: '/v1/docs', headers: bearer(isoAToken) });
    expect(aSummary.json()).toEqual({ profile: null, wrongbook: null, favorites: null, practice: null });

    for (const docType of DOC_TYPES) {
      const aGet = await getDoc(isoAToken, docType);
      expect(aGet.statusCode, docType).toBe(404);
      expect(aGet.json().error.code, docType).toBe('NOT_FOUND');

      const bGet = await getDoc(isoBToken, docType); // 阳性对照：B 真的能看到自己的行
      expect(bGet.statusCode, docType).toBe(200);
      expect(bGet.json().payload.secret, docType).toBe(`b-only-${docType}`);
    }
  });

  it('A 逐类写四种文档：B 的四行原样不动；双方摘要各读各的', async () => {
    for (const docType of DOC_TYPES) {
      const res = await putDoc(isoAToken, docType, {
        docVer: 1,
        baseRevision: null,
        payload: { version: 1, owner: `a-${docType}` },
      });
      expect(res.statusCode, docType).toBe(200);
      expect(res.json().revision, docType).toBe(1);
    }

    const aSummary = await ctx.app.inject({ method: 'GET', url: '/v1/docs', headers: bearer(isoAToken) });
    for (const docType of DOC_TYPES) {
      expect(aSummary.json()[docType].revision, docType).toBe(1);
      expect(aSummary.json()[docType].docVer, docType).toBe(1);
    }

    for (const docType of DOC_TYPES) {
      const bSummary = await ctx.app.inject({ method: 'GET', url: '/v1/docs', headers: bearer(isoBToken) });
      expect(bSummary.json()[docType].revision, docType).toBe(1);
      const bGet = await getDoc(isoBToken, docType);
      expect(bGet.json().payload.secret, docType).toBe(`b-only-${docType}`); // B 的行逐字节未被动过
      expect(bGet.json().payload.owner, docType).toBeUndefined();
    }
  });

  it('身份字段注入无效果：payload 内塞 B 的 account_id → 存储列仍是 A；B 读不到、A 读到自己那份', async () => {
    const res = await putDoc(isoAToken, 'profile', {
      docVer: 2,
      baseRevision: 1,
      payload: { version: 2, owner: 'a2', account_id: isoBId },
    });
    expect(res.statusCode).toBe(200);

    // 状态（行归属列）不受注入字段影响
    const { rows } = await ctx.raw.query<{ account_id: string; payload: Record<string, unknown> }>(
      `SELECT account_id, payload FROM user_docs
        WHERE doc_type = 'profile' AND payload->>'owner' = 'a2'`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.account_id).toBe(isoAId);
    expect(rows[0]!.payload.account_id).toBe(isoBId); // 原样存储（服务端不解释内容）

    // 后续读也不受影响
    const aGet = await getDoc(isoAToken, 'profile');
    expect(aGet.json().revision).toBe(2);
    expect(aGet.json().payload.owner).toBe('a2');
    expect((await getDoc(isoBToken, 'profile')).json().payload.secret).toBe('b-only-profile');
  });
});

describe('rev 流程与 CAS（服务端侧：revision 自增 + doc_ver 不回退）', () => {
  let revToken = '';

  beforeAll(async () => {
    revToken = (await register(ctx.app, 'rev_flow')).json().token as string;
  });

  it('rev 单调 +1：null→1→2→3；doc_ver 跳变允许；doc_ver 持平重写允许', async () => {
    const first = await putDoc(revToken, 'profile', {
      docVer: 1,
      baseRevision: null,
      payload: { version: 1 },
    });
    expect(first.json().revision).toBe(1);

    const jump = await putDoc(revToken, 'profile', {
      docVer: 3,
      baseRevision: 1,
      payload: { version: 3 },
    });
    expect(jump.statusCode).toBe(200);
    expect(jump.json()).toMatchObject({ revision: 2, docVer: 3 });

    const same = await putDoc(revToken, 'profile', {
      docVer: 3,
      baseRevision: 2,
      payload: { version: 3, tweaked: true },
    });
    expect(same.statusCode).toBe(200);
    expect(same.json()).toMatchObject({ revision: 3, docVer: 3 });

    const got = await getDoc(revToken, 'profile');
    expect(got.json()).toMatchObject({ revision: 3, docVer: 3 });
    expect(got.json().payload.tweaked).toBe(true);
  });

  it('陈旧 baseRevision → CONFLICT_STALE；doc_ver 回退 → DOC_VER_BLOCKED（同为 409 但分流不同，details 精确）', async () => {
    const stale = await putDoc(revToken, 'profile', {
      docVer: 4,
      baseRevision: 1,
      payload: { version: 4 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('CONFLICT_STALE');
    expect(stale.json().error.details).toEqual({ currentRevision: 3, currentDocVer: 3 });

    const blocked = await putDoc(revToken, 'profile', {
      docVer: 2,
      baseRevision: 3,
      payload: { version: 2 },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('DOC_VER_BLOCKED');
    expect(blocked.json().error.details).toEqual({ currentRevision: 3, currentDocVer: 3 });
  });

  it('baseRevision=null 撞已有行：doc_ver 更低 → BLOCKED；相等/更高 → STALE（分类边界逐条）', async () => {
    const equal = await putDoc(revToken, 'profile', {
      docVer: 3,
      baseRevision: null,
      payload: { version: 3 },
    });
    expect(equal.statusCode).toBe(409);
    expect(equal.json().error.code).toBe('CONFLICT_STALE');

    const higher = await putDoc(revToken, 'profile', {
      docVer: 5,
      baseRevision: null,
      payload: { version: 5 },
    });
    expect(higher.statusCode).toBe(409);
    expect(higher.json().error.code).toBe('CONFLICT_STALE');
    expect(higher.json().error.details).toEqual({ currentRevision: 3, currentDocVer: 3 });

    const lower = await putDoc(revToken, 'profile', {
      docVer: 2,
      baseRevision: null,
      payload: { version: 2 },
    });
    expect(lower.statusCode).toBe(409);
    expect(lower.json().error.code).toBe('DOC_VER_BLOCKED');
  });

  it('云端无行但 baseRevision≠null → 409 CONFLICT_STALE，details 双 null（0 行补读分类口径）', async () => {
    const res = await putDoc(revToken, 'wrongbook', {
      docVer: 1,
      baseRevision: 5,
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT_STALE');
    expect(res.json().error.details).toEqual({ currentRevision: null, currentDocVer: null });
  });
});

describe('并发写冲突（CAS）：同 baseRevision 双写恰一胜一败', () => {
  it('Promise.all 双写：恰一 200 一 409 STALE；终态恰为胜者 payload 且 rev=base+1', async () => {
    const raceToken = (await register(ctx.app, 'cas_race')).json().token as string;
    const first = await putDoc(raceToken, 'profile', {
      docVer: 1,
      baseRevision: null,
      payload: { version: 1 },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().revision).toBe(1);

    const [wa, wb] = await Promise.all([
      putDoc(raceToken, 'profile', {
        docVer: 2,
        baseRevision: 1,
        payload: { version: 2, writer: 'A' },
      }),
      putDoc(raceToken, 'profile', {
        docVer: 2,
        baseRevision: 1,
        payload: { version: 2, writer: 'B' },
      }),
    ]);
    const statuses = [wa.statusCode, wb.statusCode].sort((x, y) => x - y);
    expect(statuses).toEqual([200, 409]);

    const winner = wa.statusCode === 200 ? wa : wb;
    const loser = wa.statusCode === 409 ? wa : wb;
    expect(winner.json()).toMatchObject({ revision: 2, docVer: 2 });
    expect(loser.json().error.code).toBe('CONFLICT_STALE');
    expect(loser.json().error.details).toEqual({ currentRevision: 2, currentDocVer: 2 });

    const got = await getDoc(raceToken, 'profile');
    expect(got.json().revision).toBe(2); // 只有一次自增，不被两次写穿
    // 终态恰为胜者那份内容（按胜者身份断言，不是「必是 A/B 之一」的弱判据）
    expect(got.json().payload.writer).toBe(wa.statusCode === 200 ? 'A' : 'B');
  });
});

describe('请求形态与传输映射（sync 面）', () => {
  let shapeToken = '';

  beforeAll(async () => {
    shapeToken = (await register(ctx.app, 'shapes')).json().token as string;
  });

  it('非法 body 形态逐条 → 400 VALIDATION_FAILED（docVer=0 / 小数 / baseRevision=0 / 缺 payload / version 不一致）', async () => {
    const cases: Array<Record<string, unknown>> = [
      { docVer: 0, baseRevision: null, payload: { version: 1 } },
      { docVer: 1.5, baseRevision: null, payload: { version: 1 } },
      { docVer: 1, baseRevision: 0, payload: { version: 1 } },
      { docVer: 1, baseRevision: null },
      { docVer: 1, baseRevision: null, payload: { version: 2 } },
      { docVer: 1, baseRevision: null, payload: { noVersion: true } },
    ];
    for (const body of cases) {
      const res = await ctx.app.inject({
        method: 'PUT',
        url: '/v1/docs/profile',
        headers: bearer(shapeToken),
        payload: body,
      });
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json().error.code, JSON.stringify(body)).toBe('VALIDATION_FAILED');
    }
  });

  it('坏 JSON → 400 BAD_REQUEST；未知媒体类型（application/xml）→ 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const badJson = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/docs/profile',
      headers: { ...bearer(shapeToken), 'content-type': 'application/json' },
      payload: '{"docVer":',
    });
    expect(badJson.statusCode).toBe(400);
    expect(badJson.json().error.code).toBe('BAD_REQUEST');

    const xml = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/docs/profile',
      headers: { ...bearer(shapeToken), 'content-type': 'application/xml' },
      payload: '<doc/>',
    });
    expect(xml.statusCode).toBe(415);
    expect(xml.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('X-Sync-Protocol 边界：-1 → 426；2（≥floor）→ 放行', async () => {
    const older = await ctx.app.inject({
      method: 'GET',
      url: '/v1/docs',
      headers: { ...bearer(shapeToken), 'x-sync-protocol': '-1' },
    });
    expect(older.statusCode).toBe(426);
    expect(older.json().error.code).toBe('PROTOCOL_TOO_OLD');

    const newer = await ctx.app.inject({
      method: 'GET',
      url: '/v1/docs',
      headers: { ...bearer(shapeToken), 'x-sync-protocol': '2' },
    });
    expect(newer.statusCode).toBe(200);
  });
});
