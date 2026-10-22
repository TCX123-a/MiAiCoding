/**
 * 余额重算的并发一致性 —— **真 PG 双连接专项**（2026-10-14 修复批·#10）。
 * 只在 MIAI_TEST_PG 设置时运行（否则整包显式 skipped，不伪装成通过——同 grants-real-pg）。
 *
 * 【病灶】余额重算是一条 `INSERT INTO rice_balances … SELECT SUM(…) FROM rice_ledger
 *   … ON CONFLICT DO UPDATE`。READ COMMITTED 下，两个同账号事务交错时：后到者的重算
 *   语句在**被锁阻塞之前**就按当时快照算好了 EXCLUDED（不含先到者未提交的账），等锁
 *   释放后 DO UPDATE 用这个陈旧的和**盖掉**先到者的正确余额 → 账本里明明有，余额少算。
 *   丢账且静默（没有报错、没有 flag）。
 *
 * 【修法】push 事务开头先碰余额行：种子 INSERT（DO NOTHING）+ `SELECT … FOR UPDATE`
 *   把该账号的余额行锁住 → 同账号推送串行化（限速 6 次/时，成本可忽略），重算语句的
 *   快照必然包含此前所有已提交的账。
 *
 * 【为什么必须真 PG】PGlite 单连接，交不出「两个事务真的互相等锁」这个形状。
 * 【本文件的双臂】修复前：conn2 持锁 → route 的旧式重算在锁上排队 → conn2 提交后
 *   route 用陈旧 EXCLUDED 覆盖 → 断言 余额=账本SUM 红。修复后：route 事务开头的
 *   FOR UPDATE 排队 → 拿到锁时 conn2 已提交 → 重算快照含它的条目 → 绿。
 * 只动 test/**。
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, register, type TestContext } from '../helpers/app.js';

const pgMode = process.env.MIAI_TEST_PG !== undefined;

const HIGH_LIMITS = {
  registerPerHourPerIp: 100_000,
  registerPerDayGlobal: 1_000_000,
  loginPer15MinPerIp: 10_000,
  apiPerMinute: 1_000_000,
  ricePushPerHourPerAccount: 1000,
};

const INSTALL_A = '11111111-2222-4333-8444-555555555555';

/** 北京时间固定 = UTC+8（中国 1991 年起无夏令时）；测试侧独立算，不与实现共用函数 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function bjDay(offsetDays = 0): string {
  return new Date(Date.now() + BEIJING_OFFSET_MS + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

let ctx: TestContext;
let token = '';
let accountId = '';

function push(entries: unknown[]) {
  return ctx.app.inject({
    method: 'POST',
    url: '/v1/rice/entries',
    headers: bearer(token),
    payload: { installId: INSTALL_A, entries },
  });
}

function answer(seq: number) {
  return {
    entryKey: `${INSTALL_A}:${seq}`,
    kind: 'answer',
    delta: 1,
    dayKey: bjDay(0),
    at: new Date().toISOString(),
    ref: null,
  };
}

/**
 * 轮询 pg_stat_activity：本测试库里是否有 backend 卡在锁等。
 * 三件判据缺一不可：同库（datname）/ 锁等（wait_event_type='Lock'）/ 查询文本提到
 * rice_balances。pid <> pg_backend_pid() 防**自匹配**：轮询语句自身文本里含
 * 'rice_balances' 字面量，但它的 wait_event_type 永不为 Lock（双重保险）。
 */
async function lockWaitSeen(timeoutMs: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { rows } = await ctx.raw.query<{ n: number | string }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
          AND state = 'active' AND wait_event_type = 'Lock'
          AND query ILIKE '%rice_balances%'`,
    );
    if (Number(rows[0]!.n) > 0) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** 旧式重算（= 修复前服务端在事务末尾的写法）：这一写自身会拿到余额行的行锁 */
const LEGACY_RECOMPUTE = `INSERT INTO rice_balances (account_id, balance, earned_total, spent_total, last_seq, updated_at)
   SELECT $1::uuid,
          LEAST(GREATEST(COALESCE(SUM(delta), 0), 0), 999),
          COALESCE(SUM(delta) FILTER (WHERE delta > 0), 0),
          COALESCE(-SUM(delta) FILTER (WHERE delta < 0), 0),
          COALESCE(MAX(seq), 0),
          now()
     FROM rice_ledger
    WHERE account_id = $1::uuid
   ON CONFLICT (account_id) DO UPDATE
      SET balance = EXCLUDED.balance, earned_total = EXCLUDED.earned_total,
          spent_total = EXCLUDED.spent_total, last_seq = EXCLUDED.last_seq, updated_at = now()`;

describe.runIf(pgMode)('余额重算的并发一致性（#10 丢账·真 PG 双连接）', () => {
  beforeAll(async () => {
    ctx = await createTestContext({ rateLimits: HIGH_LIMITS });
    const acc = await register(ctx.app, 'rice_conc');
    token = acc.json().token as string;
    accountId = acc.json().account.id as string;
    // 基线：一条已提交的账（余额 1、余额行已存在）
    const seed = await push([answer(1)]);
    expect(seed.statusCode).toBe(200);
    expect(seed.json()).toMatchObject({ accepted: 1, balance: 1 });
  }, 60_000);

  afterAll(async () => {
    await ctx?.raw.close();
  }, 30_000);

  it('尺子自检：锁等必须能被看见（两把真连接 FOR UPDATE 抢同一行）', async () => {
    const c1 = new pg.Client({ connectionString: ctx.pgUrl });
    const c2 = new pg.Client({ connectionString: ctx.pgUrl });
    await c1.connect();
    await c2.connect();
    try {
      await c1.query('BEGIN');
      await c1.query('SELECT balance FROM rice_balances WHERE account_id = $1 FOR UPDATE', [accountId]);
      await c2.query('BEGIN');
      const blocked = c2.query('SELECT balance FROM rice_balances WHERE account_id = $1 FOR UPDATE', [accountId]);
      expect(
        await lockWaitSeen(8_000),
        'c2 应卡在余额行的锁上，但 pg_stat_activity 里看不见——尺子没牙或环境异常，后面的绿全不算数',
      ).toBe(true);
      await c1.query('ROLLBACK'); // 放锁
      await blocked; // c2 拿到行，语句完成
      await c2.query('ROLLBACK');
    } finally {
      await c1.end().catch(() => {});
      await c2.end().catch(() => {});
    }
  }, 30_000);

  it('★ 另一事务持锁期间 route 推新条目：重算必须把它已提交的账算进去（修复前丢账）', async () => {
    // ── conn2：模拟另一个服务器事务正在飞行——已写账本两条（+2）、已持余额行锁、未提交
    const conn2 = new pg.Client({ connectionString: ctx.pgUrl });
    await conn2.connect();
    let committed = false;
    let responseP: ReturnType<typeof push> | null = null;
    try {
      await conn2.query('BEGIN');
      await conn2.query(
        `INSERT INTO rice_ledger (account_id, entry_key, kind, delta, day_key, at)
         VALUES ($1, $2, 'answer', 1, $3::date, now()), ($1, $4, 'answer', 1, $3::date, now())`,
        [accountId, `${INSTALL_A}:k2a`, bjDay(0), `${INSTALL_A}:k2b`],
      );
      await conn2.query(LEGACY_RECOMPUTE, [accountId]); // 拿到余额行的行锁

      // ── route：此刻从正常接口推入新条目（+1），会卡在同一个锁上
      responseP = push([answer(2)]);
      expect(
        await lockWaitSeen(8_000),
        'route 的推送应卡在余额行的锁上（修复后=事务开头的 FOR UPDATE，修复前=事务末尾的重算），但没看见',
      ).toBe(true);

      // ── 放行 conn2：它的 +2 已提交；route 继续跑完
      await conn2.query('COMMIT');
      committed = true;
      const res = await responseP;
      expect(res.statusCode).toBe(200);

      // ── 终局判据：余额必须 = 账本 SUM（1 基线 + 2 + 1），响应与落库一致
      const sum = await ctx.raw.query<{ s: number | string }>(
        `SELECT COALESCE(SUM(delta), 0)::int AS s FROM rice_ledger WHERE account_id = $1`,
        [accountId],
      );
      const bal = await ctx.raw.query<{ balance: number | string }>(
        `SELECT balance FROM rice_balances WHERE account_id = $1`,
        [accountId],
      );
      expect(Number(sum.rows[0]!.s)).toBe(4);
      // ← 修复前死在这里：route 用陈旧 EXCLUDED（=2）覆盖，余额 2 ≠ 账本 4（丢账）
      expect(Number(bal.rows[0]!.balance), '余额被并发重算盖成了旧数（丢账）').toBe(4);
      expect(res.json().balance).toBe(4);
    } finally {
      if (!committed) {
        // 失败路径：放锁 + 收掉在途响应，别把悬挂事务留给下一个用例
        await conn2.query('ROLLBACK').catch(() => {});
        await responseP?.catch(() => {});
      }
      await conn2.end().catch(() => {});
    }
  }, 30_000);
});
