/**
 * 大白饭流水集成测试（docs/26 §4.6 端点 + §6.2 白名单 + §6.3 结算 + §6.4 四层防刷）。
 *
 * 覆盖：幂等去重 / ENTRY_CONFLICT 整批回滚 / dayKey ±1 窗口 / kind 日上限 / 时钟 flag /
 * 指纹复用 flag / adopt 唯一性 / 余额 clamp(SUM,0,999) 双向 / seq 增量下行 / 限流三闸 /
 * 形状违规整批 400 / 跨账号隔离 / **幂等优先于限额与窗口（2026-10-14 修·#7）**。
 * 只动 test/**。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, register, type TestContext } from '../helpers/app.js';

const HIGH_LIMITS = {
  registerPerHourPerIp: 100_000,
  registerPerDayGlobal: 1_000_000,
  loginPer15MinPerIp: 10_000,
  apiPerMinute: 1_000_000,
  ricePushPerHourPerAccount: 1000,
};

const INSTALL_A = '11111111-2222-4333-8444-555555555555';
const INSTALL_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const DELTA_BY_KIND: Record<string, number> = {
  adopt: 0,
  lesson: 2,
  review: 2,
  answer: 1,
  run: 1,
  feed: -1,
  chase: -1,
  chat: -2,
};

/** 北京时间固定 = UTC+8（中国 1991 年起无夏令时）；测试侧独立算，不与实现共用函数 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function bjDay(offsetDays = 0): string {
  return new Date(Date.now() + BEIJING_OFFSET_MS + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

interface RiceEntry {
  entryKey: string;
  kind: string;
  delta: number;
  dayKey: string;
  at: string;
  ref?: Record<string, unknown> | null;
}

function entry(install: string, seq: number, kind: string, over: Partial<RiceEntry> = {}): RiceEntry {
  return {
    entryKey: `${install}:${seq}`,
    kind,
    delta: DELTA_BY_KIND[kind] ?? 0,
    dayKey: bjDay(0),
    at: new Date().toISOString(),
    ref: null,
    ...over,
  };
}

let ctx: TestContext;
let tokenA = '';
let tokenB = '';
let idA = '';
let idB = '';

function push(token: string, entries: RiceEntry[]) {
  return ctx.app.inject({
    method: 'POST',
    url: '/v1/rice/entries',
    headers: bearer(token),
    payload: { installId: INSTALL_A, entries },
  });
}

function pull(token: string, qs = '') {
  return ctx.app.inject({ method: 'GET', url: `/v1/rice/entries${qs}`, headers: bearer(token) });
}

async function pullAll(token: string): Promise<{ entries: Array<{ seq: number; entryKey: string; kind: string; delta: number; flags: string[]; dayKey: string }>; balance: number; nextSeq: number }> {
  const res = await pull(token, '?since=0&limit=500');
  expect(res.statusCode).toBe(200);
  return res.json();
}

const happyBatch = [
  entry(INSTALL_A, 1, 'lesson', { ref: { lessonId: 'c-stage1-02' } }),
  entry(INSTALL_A, 2, 'review'),
  entry(INSTALL_A, 3, 'answer'),
];

let seq1 = 0;
let seq2 = 0;
let seq3 = 0;

beforeAll(async () => {
  ctx = await createTestContext({ rateLimits: HIGH_LIMITS });
  const a = await register(ctx.app, 'rice_a');
  const b = await register(ctx.app, 'rice_b');
  tokenA = a.json().token as string;
  tokenB = b.json().token as string;
  idA = a.json().account.id as string;
  idB = b.json().account.id as string;
});

afterAll(async () => {
  await ctx.raw.close();
});

describe('上行主路径与幂等', () => {
  it('未认证 → 401（上下行两端）', async () => {
    const up = await ctx.app.inject({ method: 'POST', url: '/v1/rice/entries', payload: { installId: INSTALL_A, entries: happyBatch } });
    expect(up.statusCode).toBe(401);
    const down = await ctx.app.inject({ method: 'GET', url: '/v1/rice/entries' });
    expect(down.statusCode).toBe(401);
  });

  it('3 条新条目 → accepted:3，余额 5（+2+2+1），seq 按入账序递增', async () => {
    const res = await push(tokenA, happyBatch);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accepted: 3, duplicated: 0, rejected: [], balance: 5, earnedTotal: 5, spentTotal: 0 });

    const down = await pullAll(tokenA);
    expect(down.entries).toHaveLength(3);
    expect(down.balance).toBe(5);
    expect(down.entries.map((e) => [e.kind, e.delta, e.flags])).toEqual([
      ['lesson', 2, []],
      ['review', 2, []],
      ['answer', 1, []],
    ]);
    expect(down.entries[0]!.dayKey).toBe(bjDay(0));
    seq1 = down.entries[0]!.seq;
    seq2 = down.entries[1]!.seq;
    seq3 = down.entries[2]!.seq;
    expect(seq2).toBeGreaterThan(seq1);
    expect(seq3).toBeGreaterThan(seq2);
    expect(down.nextSeq).toBe(seq3);
  });

  it('整批重放 → duplicated:3、余额不翻倍、条目数不变', async () => {
    const res = await push(tokenA, happyBatch);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accepted: 0, duplicated: 3, rejected: [], balance: 5 });

    const down = await pullAll(tokenA);
    expect(down.entries).toHaveLength(3);
  });

  it('同 entryKey 不同内容 → 409 ENTRY_CONFLICT，且同批的新条目一并回滚', async () => {
    const conflict = await push(tokenA, [
      entry(INSTALL_A, 1, 'lesson', { ref: { lessonId: 'c-stage1-02' }, at: new Date(Date.now() - 60_000).toISOString() }), // 同键、at 不同
      entry(INSTALL_A, 4, 'answer'),
    ]);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('ENTRY_CONFLICT');

    // 回滚证明：seq4 没被那批带进去——单发成功才是「此前不存在」的证据
    const retry = await push(tokenA, [entry(INSTALL_A, 4, 'answer')]);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ accepted: 1, balance: 6 });
  });

  it('seq 增量下行：since=s1&limit=1 恰返 s2，nextSeq 推进；limit=501/since=-1 → 400', async () => {
    const page = await pull(tokenA, `?since=${seq1}&limit=1`);
    expect(page.statusCode).toBe(200);
    const json = page.json();
    expect(json.entries).toHaveLength(1);
    expect(json.entries[0].seq).toBe(seq2);
    expect(json.nextSeq).toBe(seq2);

    expect((await pull(tokenA, '?limit=501')).statusCode).toBe(400);
    expect((await pull(tokenA, '?since=-1')).statusCode).toBe(400);
  });
});

describe('dayKey 窗口（±1 天）', () => {
  it('today±1 收、today±2 拒（进 rejected[]，HTTP 仍 200）', async () => {
    const res = await push(tokenA, [
      entry(INSTALL_A, 5, 'answer', { dayKey: bjDay(-2) }),
      entry(INSTALL_A, 6, 'answer', { dayKey: bjDay(2) }),
      entry(INSTALL_A, 7, 'answer', { dayKey: bjDay(-1) }),
      entry(INSTALL_A, 8, 'answer', { dayKey: bjDay(1) }),
      entry(INSTALL_A, 9, 'answer', { dayKey: bjDay(0) }),
    ]);
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.accepted).toBe(3);
    expect(json.rejected).toHaveLength(2);
    expect(json.rejected[0]).toMatchObject({ entryKey: `${INSTALL_A}:5`, code: 'VALIDATION_FAILED' });
    expect(json.rejected[0].detail).toMatch(/差 -2 天/);
    expect(json.rejected[1].detail).toMatch(/差 2 天/);
  });
});

describe('kind 日上限与四层防刷', () => {
  it('run 日上限 10：11 条同批 → 收 10 拒 1（OVER_DAILY_CAP）', async () => {
    const runs = Array.from({ length: 11 }, (_, i) =>
      entry(INSTALL_A, 10 + i, 'run', { ref: { fingerprint: `9f2c77aa:${i.toString(16).padStart(8, '0')}` } }),
    );
    const res = await push(tokenA, runs);
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.accepted).toBe(10);
    expect(json.rejected).toHaveLength(1);
    expect(json.rejected[0]).toMatchObject({ code: 'OVER_DAILY_CAP' });
  });

  it('时钟异常照收：超前 >10min / 同设备倒退 >10min → flag clock_skew，条目仍入账', async () => {
    const now = Date.now();
    const at = (ms: number) => new Date(ms).toISOString();
    const res = await push(tokenA, [
      entry(INSTALL_B, 100, 'answer', { at: at(now - 40 * 60_000) }),
      entry(INSTALL_B, 101, 'answer', { at: at(now - 70 * 60_000) }), // 比上一条倒退 30min
      entry(INSTALL_B, 102, 'answer', { at: at(now + 20 * 60_000) }), // 超前 20min
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(3);

    const down = await pullAll(tokenA);
    const by = new Map(down.entries.map((e) => [e.entryKey, e.flags]));
    expect(by.get(`${INSTALL_B}:100`)).toEqual([]);
    expect(by.get(`${INSTALL_B}:101`)).toEqual(['clock_skew']);
    expect(by.get(`${INSTALL_B}:102`)).toEqual(['clock_skew']);
  });

  it('run 指纹复用：同账号两条不同条目同指纹 → 后一条 flag fingerprint_reuse（照收）', async () => {
    const day = bjDay(-1); // run 当日额度已用满，换昨天
    const res = await push(tokenA, [
      entry(INSTALL_A, 30, 'run', { dayKey: day, ref: { fingerprint: 'feedface:0011aabb' } }),
      entry(INSTALL_A, 31, 'run', { dayKey: day, ref: { fingerprint: 'feedface:0011aabb' } }),
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(2);

    const down = await pullAll(tokenA);
    const by = new Map(down.entries.map((e) => [e.entryKey, e.flags]));
    expect(by.get(`${INSTALL_A}:30`)).toEqual([]);
    expect(by.get(`${INSTALL_A}:31`)).toEqual(['fingerprint_reuse']);
  });

  it('adopt：首条收；同 installId 第二条 → rejected；delta≠0 → 整批 400', async () => {
    const first = await push(tokenA, [entry(INSTALL_A, 50, 'adopt', { ref: { installId: INSTALL_A } })]);
    expect(first.statusCode).toBe(200);
    expect(first.json().accepted).toBe(1);

    const second = await push(tokenA, [entry(INSTALL_A, 51, 'adopt', { ref: { installId: INSTALL_A } })]);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ accepted: 0, duplicated: 0 });
    expect(second.json().rejected[0]).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(second.json().rejected[0].detail).toMatch(/adopt already recorded/);

    const badDelta = await push(tokenA, [entry(INSTALL_A, 52, 'adopt', { delta: 1, ref: { installId: INSTALL_A } })]);
    expect(badDelta.statusCode).toBe(400);
  });
});

describe('幂等优先于限额与窗口（2026-10-14 修·#7：重放绝不误报拒绝）', () => {
  it('★ 满额日的重放 → duplicated（修复前误报 OVER_DAILY_CAP）；同键异内容 → 409 无条件；真·新条目照旧拒', async () => {
    const c = await createTestContext({ rateLimits: HIGH_LIMITS });
    try {
      const acc = await register(c.app, 'rice_idem1');
      const tok = acc.json().token as string;
      const post = (entries: RiceEntry[]) =>
        c.app.inject({ method: 'POST', url: '/v1/rice/entries', headers: bearer(tok), payload: { installId: INSTALL_A, entries } });

      // run 当日额度（10/日）填满 —— 客户端离线补传 / 丢响应重试的常见处境
      const runs = Array.from({ length: 10 }, (_, i) =>
        entry(INSTALL_A, 100 + i, 'run', { ref: { fingerprint: `aaaa0000:${i.toString(16).padStart(8, '0')}` } }),
      );
      expect((await post(runs)).json()).toMatchObject({ accepted: 10 });

      // 重试形态：把已入账的第一条原样再发一遍
      const replay = await post([runs[0]!]);
      expect(replay.statusCode).toBe(200);
      // ← 修复前死在这里：rejected=[OVER_DAILY_CAP]、duplicated=0（重放被误当超额新条目）
      expect(replay.json()).toMatchObject({ accepted: 0, duplicated: 1, rejected: [] });

      // 同键异内容：无论额度/窗口状态 → 409（docs/26 §8.4，无条件）
      const conflict = await post([{ ...runs[0]!, ref: { fingerprint: 'ffffffff:ffffffff' } }]);
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json().error.code).toBe('ENTRY_CONFLICT');

      // 真·新条目：额度仍是满的 → 照旧 OVER_DAILY_CAP（修 #7 没有给超额开口子）
      const fresh = await post([entry(INSTALL_A, 500, 'run', { ref: { fingerprint: 'bbbb0000:00000001' } })]);
      expect(fresh.statusCode).toBe(200);
      expect(fresh.json()).toMatchObject({ accepted: 0, duplicated: 0 });
      expect(fresh.json().rejected[0]).toMatchObject({ code: 'OVER_DAILY_CAP' });
    } finally {
      await c.raw.close();
    }
  });

  it('★ 窗口外的重放（库里已有的旧账）→ duplicated（修复前误报 VALIDATION_FAILED 差 -3 天）', async () => {
    const c = await createTestContext({ rateLimits: HIGH_LIMITS });
    try {
      const acc = await register(c.app, 'rice_idem2');
      const tok = acc.json().token as string;
      const id = acc.json().account.id as string;
      // 直种一条 3 天前的账：dayKey 在窗口外，但行**已经存在**（模拟客户端几天后才重试补传）
      const at = new Date(Date.now() - 3 * 86_400_000).toISOString();
      await c.raw.query(
        `INSERT INTO rice_ledger (account_id, entry_key, kind, delta, day_key, at)
         VALUES ($1, $2, 'answer', 1, $3::date, $4::timestamptz)`,
        [id, `${INSTALL_A}:700`, bjDay(-3), at],
      );
      const replay = await c.app.inject({
        method: 'POST',
        url: '/v1/rice/entries',
        headers: bearer(tok),
        payload: { installId: INSTALL_A, entries: [entry(INSTALL_A, 700, 'answer', { dayKey: bjDay(-3), at })] },
      });
      expect(replay.statusCode).toBe(200);
      // ← 修复前死在这里：rejected=[VALIDATION_FAILED 窗口差 -3 天]、duplicated=0
      expect(replay.json()).toMatchObject({ accepted: 0, duplicated: 1, rejected: [] });
    } finally {
      await c.raw.close();
    }
  });
});

describe('形状违规 → 整批 400 且不落库', () => {
  it('delta 白名单 / ref 缺失 / entryKey 形状 / ref 超长', async () => {
    const badDelta = await push(tokenA, [entry(INSTALL_A, 60, 'feed', { delta: 1 })]);
    expect(badDelta.statusCode).toBe(400);
    expect(badDelta.json().error.message).toMatch(/白名单/);

    const noRef = await push(tokenA, [entry(INSTALL_A, 61, 'lesson')]);
    expect(noRef.statusCode).toBe(400);

    const badKey = await push(tokenA, [entry(INSTALL_A, 62, 'answer', { entryKey: 'not-a-uuid-but-long-enough:1' })]);
    expect(badKey.statusCode).toBe(400);

    const bigRef = await push(tokenA, [entry(INSTALL_A, 63, 'answer', { ref: { pad: 'x'.repeat(1100) } })]);
    expect(bigRef.statusCode).toBe(400);

    // 混合批：一条坏条目 → 整批 400，好东西也不落库
    const mixed = await push(tokenA, [entry(INSTALL_A, 64, 'answer'), entry(INSTALL_A, 65, 'feed', { delta: 5 })]);
    expect(mixed.statusCode).toBe(400);
    const probe = await push(tokenA, [entry(INSTALL_A, 64, 'answer')]);
    expect(probe.json()).toMatchObject({ accepted: 1 }); // 此前不存在 → 混合批确实整批未落
  });
});

describe('余额 = clamp(SUM(delta), 0, 999)', () => {
  it('支出大于收入时余额夹到 0（不出现负数），spentTotal 照实累', async () => {
    const res = await push(tokenB, [entry(INSTALL_B, 1, 'feed')]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accepted: 1, balance: 0, earnedTotal: 0, spentTotal: 1 });
  });

  it('SQL 直种 3×400 后推 1 条 → 重算夹到 999（上界）', async () => {
    for (let i = 0; i < 3; i += 1) {
      await ctx.raw.query(
        `INSERT INTO rice_ledger (account_id, entry_key, kind, delta, day_key, at)
         VALUES ($1, $2, 'chase', 400, $3::date, now())`,
        [idB, `${INSTALL_B}:9${i}`, bjDay(0)],
      );
    }
    const res = await push(tokenB, [entry(INSTALL_B, 2, 'answer')]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ balance: 999, earnedTotal: 1201, spentTotal: 1 });
  });
});

describe('跨账号隔离', () => {
  it('B 的下行只含自己的条目', async () => {
    const down = await pullAll(tokenB);
    expect(down.entries.length).toBeGreaterThan(0);
    for (const e of down.entries) {
      expect(e.entryKey.startsWith(INSTALL_B)).toBe(true);
    }
    const aCount = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM rice_ledger WHERE account_id = $1`,
      [idA],
    );
    expect(down.entries.length).toBeLessThan(aCount.rows[0]!.n); // A 有一大堆，B 只有自己的
  });
});

describe('限流三闸（小额度覆盖臂）', () => {
  it('每批条数（env 收紧到 2）：3 条 → 400；日条数 4：收满后第 5 条 → 429', async () => {
    const c2 = await createTestContext({
      rateLimits: { ...HIGH_LIMITS, riceEntriesPerPush: 2, riceEntriesPerDayPerAccount: 4 },
    });
    try {
      const acc = await register(c2.app, 'rice_q');
      const tok = acc.json().token as string;
      const mk = (seq: number) => ({
        entryKey: `${INSTALL_A}:${seq}`,
        kind: 'answer',
        delta: 1,
        dayKey: bjDay(0),
        at: new Date().toISOString(),
        ref: null,
      });
      const post = (entries: unknown[]) =>
        c2.app.inject({ method: 'POST', url: '/v1/rice/entries', headers: bearer(tok), payload: { installId: INSTALL_A, entries } });

      const oversize = await post([mk(1), mk(2), mk(3)]);
      expect(oversize.statusCode).toBe(400);
      expect(oversize.json().error.message).toMatch(/per-push limit/);

      expect((await post([mk(1), mk(2)])).json()).toMatchObject({ accepted: 2 });
      expect((await post([mk(3), mk(4)])).json()).toMatchObject({ accepted: 2 });

      const over = await post([mk(5)]);
      expect(over.statusCode).toBe(429);
      expect(over.json().error.code).toBe('RATE_LIMITED');
      expect(over.json().error.retryAfterMs).toBeGreaterThan(0);
    } finally {
      await c2.raw.close();
    }
  });

  it('每小时批量数（2/时）：第三推 → 429（重放也计数——文档口径「批量频率」）', async () => {
    const c3 = await createTestContext({
      rateLimits: { ...HIGH_LIMITS, ricePushPerHourPerAccount: 2 },
    });
    try {
      const acc = await register(c3.app, 'rice_h');
      const tok = acc.json().token as string;
      const batch = [{ entryKey: `${INSTALL_A}:1`, kind: 'answer', delta: 1, dayKey: bjDay(0), at: new Date().toISOString(), ref: null }];
      const post = () =>
        c3.app.inject({ method: 'POST', url: '/v1/rice/entries', headers: bearer(tok), payload: { installId: INSTALL_A, entries: batch } });

      expect((await post()).json()).toMatchObject({ accepted: 1 });
      expect((await post()).json()).toMatchObject({ duplicated: 1 });
      const third = await post();
      expect(third.statusCode).toBe(429);
    } finally {
      await c3.raw.close();
    }
  });
});
