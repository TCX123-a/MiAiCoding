/**
 * 每日任务集成测试（src/jobs/daily.ts；docs/26 §3.3/§3.5/§6.3④/§6.4④ + docs/22 §5.7）。
 *
 * 覆盖五件事 + 幂等 + 重铸语义：
 *  ① 榜单快照重铸（daily=服务器日−1 / weekly=含该日的 ISO 周 / monthly=含该日的月 / yearly=含该日的年；
 *     2026-10-10 改版并入月/年两档；铸入未 opt-in、排除封禁与零分）
 *  ② user_days / user_stats 全量重算（含 total_score 对账修复、streak 断档归零）
 *  ③ rice_balances 对账（列不一致→修复；缺行→补）
 *  ④ lesson 流水 × 学习标记 交叉核对（结构性背离留痕）
 *  ⑤ 清理（24h 墓碑 / 过期会话 / 90 天审计）
 *  ⑥ 整任务幂等；⑦ 重铸的删除语义（失格者从快照消失 = DELETE 承重；别期快照一行不动 = 作用域）
 *
 * 信源独立：断言值全部按文档手算（choice/easy/common = 100 分/题），不调用被测实现反推。
 * 周界自适应：refDay 落在周几决定「ISO 周里还有没有更早的天」——expected 现场按 hasEarlyDay
 * 推导，但每个分支里的数值仍是手算的（不是从实现里读的）。
 *
 * 直改库的几处（都是故意的）：
 *  · leaderboard_opt_in：docs/26 §3.2 只说「开关放设置页（P10.x UI）」，全套端点里没有写它的
 *    端点 → 不发明 API（已登记《后端开发进度清单》），测试直改库；
 *  · 篡改 rice_balances / user_stats：构造「派生缓存与真源背离」让对账有活干；
 *  · 把墓碑/会话/审计行的时刻改老：任务用真实 now()，不造假时钟；
 *  · ⑦ 预种「别期」快照行 + 封禁 bob：构造 DELETE 的作用域（不许误删别期）与失格情形。
 *
 * 行值归一（pg 驱动铁律的测试侧同款）：bigint 列（earned_total / spent_total）读取一律
 * SQL 里 ::int——真 PG 轨道下 pg 驱动回字符串、PGlite 回数字，不归一会假红。
 *
 * 时间锚在模块加载时取：整测数秒内跑完，跨北京午夜的窗口可忽略（与全仓其余测试同口径）。
 * 只动 test/**。
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDailyJob, type DailyJobReport, type JobLogger } from '../../src/jobs/daily.js';
import {
  diffDays,
  isoWeekKey,
  isoWeekRange,
  parseDateKey,
  serverDayKey,
  shiftDayKey,
} from '../../src/lib/daykey.js';
import {
  bearer,
  createTestContext,
  register,
  TEST_PASSWORD,
  type TestContext,
} from '../helpers/app.js';

const HIGH_LIMITS = {
  registerPerHourPerIp: 100_000,
  registerPerDayGlobal: 1_000_000,
  loginPer15MinPerIp: 10_000,
  apiPerMinute: 1_000_000,
};

/** 固定 installId（uuid 形状；rice 的 entryKey 前缀 = 它） */
const INSTALL = '9f2c77aa-1111-4222-8333-444455556666';

// ---------------------------------------------------------------- 时间锚 + 手算期望

const today = serverDayKey();
const refDay = shiftDayKey(today, -1); // 「刚结束的一天」= 任务铸 daily 快照的目标期
const refDayMinus1 = shiftDayKey(refDay, -1);
const refDayMinus3 = shiftDayKey(refDay, -3);
const weekKey = isoWeekKey(parseDateKey(refDay)!);
const weekRange = isoWeekRange(weekKey)!;
/** refDay ≠ 周一 ⇔ 该 ISO 周里还有更早的天（可放「同周多天」夹具） */
const hasEarlyDay = diffDays(refDay, weekRange.from) >= 1;
const earlyDay = weekRange.from;
// 月/年键按日期键字符串手算（与服务端 serverMonthKey/serverYearKey 同一事实的两个写法）
const monthKey = refDay.slice(0, 7);
const yearKey = refDay.slice(0, 4);

// 计分：choice/easy/local 且 lang=common → round(100 × 100 × 100 / 10000) = 100 分/题
const ALICE_SCORE = 500; // refDay 5 题全对
const BOB_SCORE = 300; // refDay 3 题对
const BOB_WEEKLY = hasEarlyDay ? BOB_SCORE + 300 : BOB_SCORE; // 早期臂再结算一天 300
const BOB_WEEKLY_DAYS = hasEarlyDay ? 2 : 1;
/** 早期臂那只脚是否落在 refDay 的同月 / 同年（周一头几天可能跨月/跨年——按运行日现场推导） */
const bobInMonth = hasEarlyDay && earlyDay.slice(0, 7) === monthKey;
const bobInYear = hasEarlyDay && earlyDay.slice(0, 4) === yearKey;
const BOB_MONTHLY = bobInMonth ? BOB_SCORE + 300 : BOB_SCORE;
const BOB_MONTHLY_DAYS = bobInMonth ? 2 : 1;
const BOB_YEARLY = bobInYear ? BOB_SCORE + 300 : BOB_SCORE;
const BOB_YEARLY_DAYS = bobInYear ? 2 : 1;
// 周/月/年/总榜宇宙 = {alice, bob}（dave 封禁排除、carol 零分排除）：bob 分超 alice 时 alice 名次 2
const ALICE_WEEKLY_RANK = BOB_WEEKLY > ALICE_SCORE ? 2 : 1;
const ALICE_MONTHLY_RANK = BOB_MONTHLY > ALICE_SCORE ? 2 : 1;
const ALICE_YEARLY_RANK = BOB_YEARLY > ALICE_SCORE ? 2 : 1;
const ALICE_ALLTIME_RANK = ALICE_WEEKLY_RANK; // 同一宇宙（user_stats.total_score 口径）

interface Acct {
  id: string;
  token: string;
}

interface SnapshotRow {
  account_id: string;
  username: string;
  score: number;
  rank: number;
  days: number;
  computed_at: Date | string;
}

interface UserDayRow {
  day_key: string;
  learned: number;
  practiced: number;
  correct: number;
  total: number;
  score: number;
}

interface CapturedLog {
  level: 'info' | 'warn';
  msg: string;
  obj: Record<string, unknown>;
}

let ctx: TestContext;
let alice: Acct;
let bob: Acct;
let carol: Acct;
let dave: Acct;
let eve: Acct;
let frank: Acct;
let grace: Acct;
let henry: Acct;
let stale: Acct;

let report1: DailyJobReport;
let report2: DailyJobReport;
/** run1 的捕获日志（口径裁定④「留痕 = warn 日志 + 报告」的判据点） */
let logs1: CapturedLog[] = [];
let dailyRows1: SnapshotRow[];
let dailyRows2: SnapshotRow[];
let weeklyRows1: SnapshotRow[];
let monthlyRows1: SnapshotRow[];
let monthlyRows2: SnapshotRow[];
let yearlyRows1: SnapshotRow[];
let aliceDays1: UserDayRow[];
let aliceDays2: UserDayRow[];

// ---------------------------------------------------------------- 夹具助手

async function makeAccount(username: string): Promise<Acct> {
  const res = await register(ctx.app, username);
  expect(res.statusCode, res.body).toBe(201);
  const json = res.json();
  return { id: json.account.id as string, token: json.token as string };
}

/** 5 题（choice/easy/local/common），前 okCount 题对 → 服务端分 = 100 × okCount */
function settle(token: string, dateKey: string, okCount: number) {
  const questions = [1, 2, 3, 4, 5].map((n) => ({
    key: `common-stage0-01:q${n}`,
    lessonId: 'common-stage0-01',
    qid: `q${n}`,
    lang: 'common',
    stage: 0,
    type: 'choice',
    difficulty: 'easy',
    source: 'local',
    ok: n <= okCount,
  }));
  return ctx.app.inject({
    method: 'POST',
    url: '/v1/challenge/days',
    headers: bearer(token),
    payload: {
      submissionId: randomUUID(),
      installId: INSTALL,
      dateKey,
      source: 'local',
      startedAt: `${dateKey}T09:00:00.000Z`,
      finishedAt: `${dateKey}T10:00:00.000Z`,
      questions,
    },
  });
}

function putDoc(token: string, docType: string, docVer: number, payload: Record<string, unknown>) {
  return ctx.app.inject({
    method: 'PUT',
    url: `/v1/docs/${docType}`,
    headers: bearer(token),
    payload: { docVer, baseRevision: null, payload },
  });
}

function pushRice(token: string, entries: Array<Record<string, unknown>>) {
  return ctx.app.inject({
    method: 'POST',
    url: '/v1/rice/entries',
    headers: bearer(token),
    payload: { installId: INSTALL, entries },
  });
}

function lessonEntry(seq: number, day: string, lessonId: string) {
  return {
    entryKey: `${INSTALL}:${seq}`,
    kind: 'lesson',
    delta: 2, // RICE_DELTA_BY_KIND.lesson
    dayKey: day,
    at: `${day}T12:00:00.000Z`,
    ref: { lessonId },
  };
}

function feedEntry(seq: number, day: string) {
  return {
    entryKey: `${INSTALL}:${seq}`,
    kind: 'feed',
    delta: -1,
    dayKey: day,
    at: `${day}T13:00:00.000Z`,
    ref: null,
  };
}

function get(url: string, token: string) {
  return ctx.app.inject({ method: 'GET', url, headers: bearer(token) });
}

function stripSnapshot(rows: SnapshotRow[]) {
  return rows.map((r) => ({
    account_id: r.account_id,
    username: r.username,
    score: r.score,
    rank: r.rank,
    days: r.days,
  }));
}

async function snapshotRows(period: string, periodKey: string): Promise<SnapshotRow[]> {
  const { rows } = await ctx.raw.query<SnapshotRow>(
    `SELECT s.account_id::text AS account_id, u.username, s.score, s.rank, s.days, s.computed_at
       FROM leaderboard_snapshots s
       JOIN users u ON u.id = s.account_id
      WHERE s.period = $1 AND s.period_key = $2
      ORDER BY s.rank, s.account_id`,
    [period, periodKey],
  );
  return rows;
}

async function aliceDayRows(): Promise<UserDayRow[]> {
  const { rows } = await ctx.raw.query<UserDayRow>(
    `SELECT to_char(day_key, 'YYYY-MM-DD') AS day_key, learned, practiced, correct, total, score
       FROM user_days WHERE account_id = $1 ORDER BY day_key`,
    [alice.id],
  );
  return rows;
}

// ---------------------------------------------------------------- 夹具搭建 + 两次跑任务

beforeAll(async () => {
  ctx = await createTestContext({ rateLimits: HIGH_LIMITS });

  alice = await makeAccount('jalice');
  bob = await makeAccount('jbob');
  carol = await makeAccount('jcarol');
  dave = await makeAccount('jdave');
  eve = await makeAccount('jeve');
  frank = await makeAccount('jfrank');
  grace = await makeAccount('jgrace');
  henry = await makeAccount('jhenry');
  stale = await makeAccount('jstale');

  // ---- 挑战结算（真实端点，好让 user_stats 快路径累加也被走到）----
  expect((await settle(alice.token, refDay, 5)).statusCode, 'alice 结算').toBe(200); // 500
  expect((await settle(bob.token, refDay, 3)).statusCode, 'bob 结算').toBe(200); // 300
  if (hasEarlyDay) {
    expect((await settle(bob.token, earlyDay, 3)).statusCode, 'bob 早期臂结算').toBe(200); // 300
  }
  expect((await settle(carol.token, refDay, 0)).statusCode, 'carol 结算').toBe(200); // 0 分
  expect((await settle(dave.token, refDay, 5)).statusCode, 'dave 结算').toBe(200); // 500

  // ---- 文档（profile docVer=2 / practice docVer=1，与客户端同版）----
  // alice：学到 2 课；历史标记 refDay×2 + refDay−1×1 + refDay−3×1（refDay−2 空 ⇒ streak 断在 2）
  expect(
    (
      await putDoc(alice.token, 'profile', 2, {
        version: 2,
        learned: ['common-stage0-01', 'common-stage0-02'],
        favorites: [],
        history: [
          { lessonId: 'common-stage0-01', finishedAt: `${refDay}T12:00:00.000Z` },
          { lessonId: 'common-stage0-02', finishedAt: `${refDay}T13:00:00.000Z` },
          { lessonId: 'common-stage0-03', finishedAt: `${refDayMinus1}T09:00:00.000Z` },
          { lessonId: 'common-stage0-04', finishedAt: `${refDayMinus3}T09:00:00.000Z` },
        ],
        stats: {},
        rewards: {},
      })
    ).statusCode,
    'alice profile',
  ).toBe(200);
  // alice：练习会话 3 条（refDay 2 题对 1、refDay−1 1 题对 1、1 条 at 坏了）
  expect(
    (
      await putDoc(alice.token, 'practice', 1, {
        version: 1,
        history: [
          {
            id: randomUUID(),
            at: `${refDay}T10:00:00.000Z`,
            mode: 'random',
            items: [
              { qid: 'q1', ok: true },
              { qid: 'q2', ok: false },
            ],
          },
          {
            id: randomUUID(),
            at: `${refDayMinus1}T11:00:00.000Z`,
            mode: 'random',
            items: [{ qid: 'q1', ok: true }],
          },
          {
            id: randomUUID(),
            at: 'not-a-timestamp',
            mode: 'random',
            items: [{ qid: 'q1', ok: true }],
          },
        ],
      })
    ).statusCode,
    'alice practice',
  ).toBe(200);
  // grace：空 learned + 1 条 finishedAt 坏的历史标记（进 droppedMarks，不进日桶）
  //        但 lesson 流水有 2 条 → 背离臂：条目(2) > 标记(1，坏条目也算标记)
  expect(
    (
      await putDoc(grace.token, 'profile', 2, {
        version: 2,
        learned: [],
        favorites: [],
        history: [{ lessonId: 'common-stage0-13', finishedAt: 'not-a-timestamp' }],
        stats: {},
        rewards: {},
      })
    ).statusCode,
    'grace profile',
  ).toBe(200);
  // stale：唯一活动日 = refDay−1 = 服务器日−2 → 「断档归零」分支的专用夹具
  //（有标记、有日行，但最后活动日离服务器日断了 2 天）
  expect(
    (
      await putDoc(stale.token, 'profile', 2, {
        version: 2,
        learned: ['common-stage0-31'],
        favorites: [],
        history: [{ lessonId: 'common-stage0-31', finishedAt: `${refDayMinus1}T12:00:00.000Z` }],
        stats: {},
        rewards: {},
      })
    ).statusCode,
    'stale profile',
  ).toBe(200);

  // ---- 大白饭流水（真端点；侧证 rice_balances 初始正确，之后才被篡改）----
  const riceA = await pushRice(alice.token, [
    lessonEntry(1, refDay, 'common-stage0-01'),
    feedEntry(2, refDay),
  ]);
  expect(riceA.statusCode, riceA.body).toBe(200);
  expect(riceA.json()).toMatchObject({ accepted: 2, duplicated: 0, rejected: [], balance: 1 });
  const riceG = await pushRice(grace.token, [
    lessonEntry(1, refDay, 'common-stage0-11'),
    lessonEntry(2, refDay, 'common-stage0-12'),
  ]);
  expect(riceG.statusCode, riceG.body).toBe(200);
  expect(riceG.json()).toMatchObject({ accepted: 2, duplicated: 0, rejected: [], balance: 4 });
  // henry：有 lesson 流水、从不 PUT profile 文档（= 云同步延迟，不是背离）→ 交叉核对不许记名
  const riceH = await pushRice(henry.token, [
    lessonEntry(1, refDay, 'common-stage0-21'),
    lessonEntry(2, refDay, 'common-stage0-22'),
  ]);
  expect(riceH.statusCode, riceH.body).toBe(200);
  expect(riceH.json()).toMatchObject({ accepted: 2, duplicated: 0, rejected: [], balance: 4 });

  // ---- 篡改/墓碑（直改库，见文件头）----
  await ctx.raw.query(`UPDATE users SET leaderboard_opt_in = true WHERE id = $1`, [alice.id]);
  await ctx.raw.query(`UPDATE user_stats SET total_score = 9999 WHERE account_id = $1`, [bob.id]);
  await ctx.raw.query(`UPDATE rice_balances SET balance = 50 WHERE account_id = $1`, [alice.id]);
  await ctx.raw.query(`UPDATE users SET disabled_at = now() WHERE id = $1`, [dave.id]);

  // eve：注销（users 行被删、会话钉墓碑 24h）
  const del = await ctx.app.inject({
    method: 'POST',
    url: '/v1/auth/delete-account',
    headers: bearer(eve.token),
    payload: { password: TEST_PASSWORD },
  });
  expect(del.statusCode, del.body).toBe(204);
  const eveGone = await ctx.raw.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM users WHERE id = $1`,
    [eve.id],
  );
  expect(eveGone.rows[0]!.n).toBe(0);

  // frank：会话已过期（但没被吊销）→ 任务该删它
  await ctx.raw.query(
    `UPDATE sessions SET idle_expires_at = now() - interval '1 hour' WHERE account_id = $1`,
    [frank.id],
  );

  // 审计：91 天前（该删）与 89 天前（该留）
  await ctx.raw.query(
    `INSERT INTO auth_audit (event, detail, created_at)
     VALUES ('rate_limited', '{"keep":"old"}'::jsonb, now() - interval '91 days'),
            ('rate_limited', '{"keep":"new"}'::jsonb, now() - interval '89 days')`,
  );

  // ---- 第一跑（挂捕获 logger）+ 第二跑（幂等）----
  logs1 = [];
  report1 = await runDailyJob(ctx.db, {
    logger: {
      info: (obj, msg) => logs1.push({ level: 'info', msg, obj }),
      warn: (obj, msg) => logs1.push({ level: 'warn', msg, obj }),
    },
  });
  dailyRows1 = await snapshotRows('daily', refDay);
  weeklyRows1 = await snapshotRows('weekly', weekKey);
  monthlyRows1 = await snapshotRows('monthly', monthKey);
  yearlyRows1 = await snapshotRows('yearly', yearKey);
  aliceDays1 = await aliceDayRows();

  report2 = await runDailyJob(ctx.db);
  dailyRows2 = await snapshotRows('daily', refDay);
  monthlyRows2 = await snapshotRows('monthly', monthKey);
  aliceDays2 = await aliceDayRows();
}, 60_000);

afterAll(async () => {
  await ctx.raw.close();
}, 30_000);

// ---------------------------------------------------------------- ① 快照重铸

describe('① 榜单快照重铸', () => {
  it('报告头字段与统计量（accounts/userDayRows/malformedEntries 全部手算）', () => {
    expect(report1.serverToday).toBe(today);
    expect(report1.referenceDay).toBe(refDay);
    expect(report1.weekKey).toBe(weekKey);
    expect(report1.monthKey).toBe(monthKey);
    expect(report1.yearKey).toBe(yearKey);
    // 四档期各 2 行：{alice, bob}（carol 零分、dave 封禁都被排除）
    expect(report1.snapshots).toEqual({ daily: 2, weekly: 2, monthly: 2, yearly: 2 });
    // grid = 有文档日/挑战日的账号：alice + bob + carol + dave + stale；grace/henry 无日 → 不算
    // userDayRows = alice 3（ref−3/ref−1/ref）+ bob 1或2 + carol 1 + dave 1 + stale 1
    // malformedEntries = alice 那条 at 坏的练习会话 + grace 那条 finishedAt 坏的历史标记
    expect(report1.progress).toEqual({
      accounts: 5,
      userDayRows: hasEarlyDay ? 8 : 7,
      malformedEntries: 2,
    });
    // statAccounts = 有文档 ∪ 有挑战 ∪ 已有 stats 行 = {alice,bob,carol,dave,stale} ∪ {grace} = 6
    //（henry 无文档无挑战无 stats 行 → 不进；stale 有文档 → 进）
    expect(report1.userStats.accounts).toBe(6);
  });

  it('daily 快照 = 刚结束的一天：alice 500 第一、bob 300 第二（carol/dave 不在档）', () => {
    expect(stripSnapshot(dailyRows1)).toEqual([
      { account_id: alice.id, username: 'jalice', score: ALICE_SCORE, rank: 1, days: 1 },
      { account_id: bob.id, username: 'jbob', score: BOB_SCORE, rank: 2, days: 1 },
    ]);
  });

  it('weekly 快照 = 含 refDay 的 ISO 周：bob 同周多天求和（周一时退化为单天）', () => {
    const bobRow = {
      account_id: bob.id,
      username: 'jbob',
      score: BOB_WEEKLY,
      rank: BOB_WEEKLY > ALICE_SCORE ? 1 : 2,
      days: BOB_WEEKLY_DAYS,
    };
    const aliceRow = {
      account_id: alice.id,
      username: 'jalice',
      score: ALICE_SCORE,
      rank: ALICE_WEEKLY_RANK,
      days: 1,
    };
    expect(stripSnapshot(weeklyRows1)).toEqual(
      BOB_WEEKLY > ALICE_SCORE ? [bobRow, aliceRow] : [aliceRow, bobRow],
    );
  });

  it('monthly 快照 = 含 refDay 的月：bob 同月多天求和（月初时早期臂在月外则退化为单天）', () => {
    const bobRow = {
      account_id: bob.id,
      username: 'jbob',
      score: BOB_MONTHLY,
      rank: BOB_MONTHLY > ALICE_SCORE ? 1 : 2,
      days: BOB_MONTHLY_DAYS,
    };
    const aliceRow = {
      account_id: alice.id,
      username: 'jalice',
      score: ALICE_SCORE,
      rank: ALICE_MONTHLY_RANK,
      days: 1,
    };
    expect(stripSnapshot(monthlyRows1)).toEqual(
      BOB_MONTHLY > ALICE_SCORE ? [bobRow, aliceRow] : [aliceRow, bobRow],
    );
  });

  it('yearly 快照 = 含 refDay 的年：年内月外的早期臂算入（跨年开年则退化）', () => {
    const bobRow = {
      account_id: bob.id,
      username: 'jbob',
      score: BOB_YEARLY,
      rank: BOB_YEARLY > ALICE_SCORE ? 1 : 2,
      days: BOB_YEARLY_DAYS,
    };
    const aliceRow = {
      account_id: alice.id,
      username: 'jalice',
      score: ALICE_SCORE,
      rank: ALICE_YEARLY_RANK,
      days: 1,
    };
    expect(stripSnapshot(yearlyRows1)).toEqual(
      BOB_YEARLY > ALICE_SCORE ? [bobRow, aliceRow] : [aliceRow, bobRow],
    );
  });

  it('monthly/yearly 榜面（alice 视角）：按 periodKey 读取快照 + computedAt（四档期共用一张表）', async () => {
    const m = await get(`/v1/leaderboard?period=monthly&periodKey=${monthKey}`, alice.token);
    expect(m.statusCode).toBe(200);
    expect(m.json().entries).toEqual([
      { rank: ALICE_MONTHLY_RANK, username: 'jalice', avatarHash: null, score: ALICE_SCORE, days: 1, langs: [] },
    ]);
    expect(m.json().me).toMatchObject({ rank: ALICE_MONTHLY_RANK, score: ALICE_SCORE });
    expect(typeof m.json().computedAt).toBe('string');

    const y = await get(`/v1/leaderboard?period=yearly&periodKey=${yearKey}`, alice.token);
    expect(y.statusCode).toBe(200);
    expect(y.json().entries).toEqual([
      { rank: ALICE_YEARLY_RANK, username: 'jalice', avatarHash: null, score: ALICE_SCORE, days: 1, langs: [] },
    ]);
    expect(y.json().me).toMatchObject({ rank: ALICE_YEARLY_RANK, score: ALICE_SCORE });
    expect(typeof y.json().computedAt).toBe('string');
  });

  it('榜面（alice 视角）：daily 快照路径 —— me 行、computedAt、无下一页', async () => {
    const res = await get(`/v1/leaderboard?period=daily&periodKey=${refDay}`, alice.token);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries).toEqual([
      { rank: 1, username: 'jalice', avatarHash: null, score: ALICE_SCORE, days: 1, langs: [] },
    ]);
    expect(body.me).toEqual({ rank: 1, score: ALICE_SCORE, optedIn: true, scoreToday: 0 });
    expect(typeof body.computedAt).toBe('string');
    expect(body.nextCursor).toBeNull();
  });

  it('榜面（bob 视角）：未 opt-in 不入 entries，但 me 名次仍从快照读（§4.5）', async () => {
    const res = await get(`/v1/leaderboard?period=daily&periodKey=${refDay}`, bob.token);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries).toEqual([
      { rank: 1, username: 'jalice', avatarHash: null, score: ALICE_SCORE, days: 1, langs: [] },
    ]);
    expect(body.me).toEqual({ rank: 2, score: BOB_SCORE, optedIn: false, scoreToday: 0 });
  });

  it('查询「今天」（显式 periodKey，快照未铸）→ 空态且 computedAt=null（绝不摆假数据）', async () => {
    const res = await get(`/v1/leaderboard?period=daily&periodKey=${today}`, alice.token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      periodKey: today,
      entries: [],
      me: { rank: null, score: 0, optedIn: true, scoreToday: 0 },
      computedAt: null,
      nextCursor: null,
    });
  });

  it('daily 省略 periodKey 默认 = 刚结束的一天（job 铸哪天的快照，默认请求就命中哪天）', async () => {
    // 跨模块日期口径同源守门：DailyJob 铸的是 refDay（服务器日 −1）的快照，
    // leaderboard 路由的默认键也必须是 refDay —— 曾各取各的（路由取「当天」），
    // 默认请求恒空死路（2026-10-10 对抗核验抓到并修复）。
    const res = await get('/v1/leaderboard?period=daily', alice.token);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.periodKey).toBe(refDay);
    expect(body.entries).toEqual([
      { rank: 1, username: 'jalice', avatarHash: null, score: ALICE_SCORE, days: 1, langs: [] },
    ]);
    expect(typeof body.computedAt).toBe('string');
  });

  it('weekly 快照路径 vs 过滤实算路径（challenge_questions 求和）同值对拍', async () => {
    const viaSnapshot = await get(`/v1/leaderboard?period=weekly&periodKey=${weekKey}`, alice.token);
    expect(viaSnapshot.json().entries).toEqual([
      { rank: ALICE_WEEKLY_RANK, username: 'jalice', avatarHash: null, score: ALICE_SCORE, days: 1, langs: [] },
    ]);
    expect(viaSnapshot.json().me).toMatchObject({
      rank: ALICE_WEEKLY_RANK,
      score: ALICE_SCORE,
    });

    const viaLive = await get(
      `/v1/leaderboard?period=weekly&periodKey=${weekKey}&lang=common&difficulty=easy`,
      alice.token,
    );
    expect(viaLive.json().entries).toEqual([
      { rank: ALICE_WEEKLY_RANK, username: 'jalice', avatarHash: null, score: ALICE_SCORE, days: 1, langs: [] },
    ]);
    expect(viaLive.json().me).toMatchObject({ rank: ALICE_WEEKLY_RANK, score: ALICE_SCORE });
  });
});

// ---------------------------------------------------------------- ② 进度重算

describe('② user_days / user_stats 重算', () => {
  it('alice 的 user_days 三行手算值（学习标记按日、练习按 at 归日、挑战分落 refDay）', () => {
    expect(aliceDays1).toEqual([
      { day_key: refDayMinus3, learned: 1, practiced: 0, correct: 0, total: 0, score: 0 },
      { day_key: refDayMinus1, learned: 1, practiced: 1, correct: 1, total: 1, score: 0 },
      { day_key: refDay, learned: 2, practiced: 1, correct: 1, total: 2, score: ALICE_SCORE },
    ]);
  });

  it('alice 面板一屏：streak 断档为 2（refDay−2 是空档）、practicedCount 含坏 at 会话', async () => {
    const res = await get('/v1/me/summary', alice.token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      stats: {
        learnedCount: 2, // profile.learned.length（精确口径）
        practicedCount: 3, // 3 条会话都算（含 at 坏的那条：不进日桶但计数）
        streakDays: 2, // refDay, refDay−1 连续；refDay−3 被空档断开
        lastActiveDay: refDay,
        totalScore: ALICE_SCORE,
      },
      rice: { balance: 1, earnedTotal: 2, spentTotal: 1 },
      leaderboard: {
        rankAllTime: ALICE_ALLTIME_RANK,
        scoreAllTime: ALICE_SCORE,
        scoreToday: 0, // 今天没结算
        optedIn: true,
      },
    });
  });

  it('alltime 榜与面板同口径：me.rank === summary.rankAllTime', async () => {
    const res = await get('/v1/leaderboard?period=alltime', alice.token);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries).toEqual([
      { rank: ALICE_ALLTIME_RANK, username: 'jalice', avatarHash: null, score: ALICE_SCORE, days: 1, langs: [] },
    ]);
    expect(body.me.rank).toBe(ALICE_ALLTIME_RANK);

    const summary = await get('/v1/me/summary', alice.token);
    expect(summary.json().leaderboard.rankAllTime).toBe(body.me.rank);
  });

  it('bob 被篡改的 total_score=9999 被对账修回挑战真值（修复名单 + warn 留痕双判据）', async () => {
    expect(report1.userStats.totalScoreRepaired).toEqual([bob.id]);
    const { rows } = await ctx.raw.query<{ total_score: number }>(
      `SELECT total_score FROM user_stats WHERE account_id = $1`,
      [bob.id],
    );
    expect(rows[0]!.total_score).toBe(BOB_WEEKLY);
    // 口径裁定④：对账留痕 = warn 日志（on-call 的唯一发现点）——报告里有数还不够，日志必须在
    const warn = logs1.find((l) => l.level === 'warn' && l.msg.includes('total_score'));
    expect(warn?.obj.accounts).toEqual([bob.id]);
  });

  it('stale 断档归零：唯一活动日 = 服务器日−2 → streak=0，但日行与 lastActiveDay 保留', async () => {
    const { rows } = await ctx.raw.query<{
      learned_count: number;
      streak_days: number;
      last_active_day: string | null;
      total_score: number;
    }>(
      `SELECT learned_count, streak_days,
              to_char(last_active_day, 'YYYY-MM-DD') AS last_active_day, total_score
         FROM user_stats WHERE account_id = $1`,
      [stale.id],
    );
    expect(rows[0]).toEqual({
      learned_count: 1,
      streak_days: 0, // diffDays(服务器日, refDay−1) = 2 > 1 → 归零（阈值放宽到 ≥2 即在此红）
      last_active_day: refDayMinus1,
      total_score: 0,
    });
    const days = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM user_days WHERE account_id = $1`,
      [stale.id],
    );
    expect(days.rows[0]!.n).toBe(1); // 归零的是 streak，不是「有动作日」本身
  });

  it('carol 零分结算日仍算「有动作日」：streak=1、lastActiveDay=refDay、总分 0', async () => {
    const { rows } = await ctx.raw.query<{
      learned_count: number;
      practiced_count: number;
      streak_days: number;
      last_active_day: string;
      total_score: number;
    }>(
      `SELECT learned_count, practiced_count, streak_days,
              to_char(last_active_day, 'YYYY-MM-DD') AS last_active_day, total_score
         FROM user_stats WHERE account_id = $1`,
      [carol.id],
    );
    expect(rows[0]).toEqual({
      learned_count: 0,
      practiced_count: 0,
      streak_days: 1,
      last_active_day: refDay,
      total_score: 0,
    });
  });

  it('grace（空 learned + 1 条坏标记）：stats 全零且 lastActiveDay=null、无 user_days 行', async () => {
    const { rows } = await ctx.raw.query<{
      learned_count: number;
      practiced_count: number;
      streak_days: number;
      last_active_day: string | null;
      total_score: number;
    }>(
      `SELECT learned_count, practiced_count, streak_days,
              to_char(last_active_day, 'YYYY-MM-DD') AS last_active_day, total_score
         FROM user_stats WHERE account_id = $1`,
      [grace.id],
    );
    expect(rows[0]).toEqual({
      learned_count: 0,
      practiced_count: 0,
      streak_days: 0,
      last_active_day: null,
      total_score: 0,
    });
    const days = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM user_days WHERE account_id = $1`,
      [grace.id],
    );
    expect(days.rows[0]!.n).toBe(0);
  });
});

// ---------------------------------------------------------------- ③ rice 对账

describe('③ rice_balances 对账', () => {
  it('alice 的 balance=50 假值被修回真值（clamp(SUM(delta),0,999)：2−1=1）', async () => {
    expect(report1.rice.repaired).toEqual([alice.id]);
    expect(report1.rice.insertedMissing).toEqual([]);
    const { rows } = await ctx.raw.query<{
      balance: number;
      earned_total: number;
      spent_total: number;
    }>(
      `SELECT balance, earned_total::int AS earned_total, spent_total::int AS spent_total
         FROM rice_balances WHERE account_id = $1`,
      [alice.id],
    );
    expect(rows[0]).toEqual({ balance: 1, earned_total: 2, spent_total: 1 });
  });

  it('删掉 alice 的余额行 → 再跑：缺行补齐（insertedMissing），仍留 warning 日志', async () => {
    await ctx.raw.query(`DELETE FROM rice_balances WHERE account_id = $1`, [alice.id]);
    const logs: CapturedLog[] = [];
    const logger: JobLogger = {
      info: (obj, msg) => logs.push({ level: 'info', msg, obj }),
      warn: (obj, msg) => logs.push({ level: 'warn', msg, obj }),
    };
    const report3 = await runDailyJob(ctx.db, { logger });

    expect(report3.rice.insertedMissing).toEqual([alice.id]);
    expect(report3.rice.repaired).toEqual([]);
    const { rows } = await ctx.raw.query<{
      balance: number;
      earned_total: number;
      spent_total: number;
    }>(
      `SELECT balance, earned_total::int AS earned_total, spent_total::int AS spent_total
         FROM rice_balances WHERE account_id = $1`,
      [alice.id],
    );
    expect(rows[0]).toEqual({ balance: 1, earned_total: 2, spent_total: 1 });

    // 报告之外的留痕（口径裁定④：对账走 warn 日志 + 报告）
    expect(logs.some((l) => l.level === 'warn' && l.msg.includes('rice_balances'))).toBe(true);
    expect(logs.some((l) => l.level === 'warn' && l.msg.includes('lesson 流水'))).toBe(true);
    expect(logs.some((l) => l.level === 'info' && l.msg.includes('每日任务完成'))).toBe(true);
  });
});

// ---------------------------------------------------------------- ④ 交叉核对

describe('④ lesson 流水 × 学习标记交叉核对', () => {
  it('grace（2 条流水 vs 1 个坏标记）被记名；alice 与 henry（无 profile 文档 = 同步延迟）不在内', () => {
    expect(report1.crossChecks.lessonDivergence).toEqual([
      { accountId: grace.id, lessonEntries: 2, learnMarks: 1, learnedCount: 0 },
    ]);
  });
});

// ---------------------------------------------------------------- ⑤ 清理

describe('⑤ 清理（docs/22 §5.7）', () => {
  it('run#1：过期会话删 1（frank）、审计删 1（91 天前）、24h 墓碑一个没删（eve 是新鲜的）', async () => {
    expect(report1.cleanup).toEqual({ tombstones: 0, expiredSessions: 1, auditRows: 1 });

    const frankRes = await get('/v1/auth/session', frank.token);
    expect(frankRes.statusCode).toBe(401);
    // 行真被删了才该是 UNAUTHENTICATED（行还在、只是过期会是 TOKEN_EXPIRED）——堵「删错桶/没删」
    expect(frankRes.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('审计：91 天前删、89 天前留', async () => {
    const old = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM auth_audit WHERE detail = '{"keep":"old"}'::jsonb`,
    );
    const keep = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM auth_audit WHERE detail = '{"keep":"new"}'::jsonb`,
    );
    expect(old.rows[0]!.n).toBe(0);
    expect(keep.rows[0]!.n).toBe(1);
  });

  it('eve 的墓碑 24h 内保留：会话行在（reason=account_deleted）、旧令牌重试注销仍 204', async () => {
    const { rows } = await ctx.raw.query<{ revoked_reason: string; account_id: string | null }>(
      `SELECT revoked_reason, account_id FROM sessions WHERE revoked_reason = 'account_deleted'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.account_id).toBeNull(); // users 删除后 FK 置 NULL，墓碑仍挂得住

    const retry = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/delete-account',
      headers: bearer(eve.token),
      payload: { password: TEST_PASSWORD },
    });
    expect(retry.statusCode, retry.body).toBe(204);
  });

  it('把墓碑改老到 25 小时前 → 再跑：tombstones=1、会话行消失、令牌从此 401', async () => {
    await ctx.raw.query(
      `UPDATE sessions SET revoked_at = now() - interval '25 hours' WHERE revoked_reason = 'account_deleted'`,
    );
    const report4 = await runDailyJob(ctx.db);
    expect(report4.cleanup.tombstones).toBe(1);

    const gone = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sessions WHERE revoked_reason = 'account_deleted'`,
    );
    expect(gone.rows[0]!.n).toBe(0);

    const retry = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/delete-account',
      headers: bearer(eve.token),
      payload: { password: TEST_PASSWORD },
    });
    expect(retry.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------- ⑥ 幂等

describe('⑥ 整任务幂等（第二跑不产生任何修复、不重复铸行）', () => {
  it('第二跑修复名单全空、背离事实与快照计数不变', () => {
    expect(report2.userStats.totalScoreRepaired).toEqual([]);
    expect(report2.rice).toEqual({ repaired: [], insertedMissing: [] });
    expect(report2.snapshots).toEqual(report1.snapshots);
    expect(report2.crossChecks.lessonDivergence).toEqual(report1.crossChecks.lessonDivergence);
  });

  it('快照行/派生行逐字节稳定（computed_at 除外）；computed_at 变新证明真·重铸', () => {
    expect(stripSnapshot(dailyRows2)).toEqual(stripSnapshot(dailyRows1));
    expect(stripSnapshot(monthlyRows2)).toEqual(stripSnapshot(monthlyRows1)); // 月档同样真·重铸
    expect(aliceDays2).toEqual(aliceDays1);

    const t1 = new Date(dailyRows1[0]!.computed_at).getTime();
    const t2 = new Date(dailyRows2[0]!.computed_at).getTime();
    expect(t2).toBeGreaterThan(t1); // 本轮确有写盘（DELETE 的承重/作用域语义由 ⑦ 钉住）
    const m1 = new Date(monthlyRows1[0]!.computed_at).getTime();
    const m2 = new Date(monthlyRows2[0]!.computed_at).getTime();
    expect(m2).toBeGreaterThan(m1); // 月档的 computed_at 也在推进（不是只在快照表里摆着）
  });
});

// ---------------------------------------------------------------- ⑦ 重铸的删除语义

describe('⑦ 重铸 = DELETE 再 INSERT（不是 UPSERT）：失格者消失、别期一行不动', () => {
  it('封禁 bob → 第五跑：bob 从本期快照消失（alice 仍在证非空表）；预种别期行原样保留', async () => {
    // 预种四个「别期」行（daily/weekly/monthly/yearly 各一）：若 DELETE 丢了 period_key 作用域，
    // 它们会被误删。月/年别期键从本期键手推（上个月的末日 / 上一年）——不是从被测实现里读的。
    const prevWeekKey = isoWeekKey(parseDateKey(shiftDayKey(refDay, -7))!);
    const prevMonthKey = shiftDayKey(`${monthKey}-01`, -1).slice(0, 7);
    const prevYearKey = String(Number(yearKey) - 1);
    expect(prevWeekKey).not.toBe(weekKey); // 自检：别期 ≠ 本期
    expect(prevMonthKey).not.toBe(monthKey);
    expect(prevYearKey).not.toBe(yearKey);
    await ctx.raw.query(
      `INSERT INTO leaderboard_snapshots (period, period_key, account_id, score, rank, days)
       VALUES ('daily', $1, $2, 1, 1, 1),
              ('weekly', $3, $2, 1, 1, 1),
              ('monthly', $4, $2, 1, 1, 1),
              ('yearly', $5, $2, 1, 1, 1)`,
      [refDayMinus1, alice.id, prevWeekKey, prevMonthKey, prevYearKey],
    );

    // bob 失格：disabled 账号在重铸时被排除（真源仍留着他的 challenge_days）
    await ctx.raw.query(`UPDATE users SET disabled_at = now() WHERE id = $1`, [bob.id]);
    const report5 = await runDailyJob(ctx.db);

    // 失格者必须从快照里消失：UPSERT 实现（或漏删）会留下 bob 的旧行 → 此处红
    expect(report5.snapshots).toEqual({ daily: 1, weekly: 1, monthly: 1, yearly: 1 });
    expect(stripSnapshot(await snapshotRows('daily', refDay))).toEqual([
      { account_id: alice.id, username: 'jalice', score: ALICE_SCORE, rank: 1, days: 1 },
    ]);
    expect(stripSnapshot(await snapshotRows('weekly', weekKey))).toEqual([
      { account_id: alice.id, username: 'jalice', score: ALICE_SCORE, rank: 1, days: 1 },
    ]);

    // 别期行一行不动（DELETE 的作用域 = 本期）：丢了 period_key 条件即在此红
    expect(stripSnapshot(await snapshotRows('daily', refDayMinus1))).toEqual([
      { account_id: alice.id, username: 'jalice', score: 1, rank: 1, days: 1 },
    ]);
    expect(stripSnapshot(await snapshotRows('weekly', prevWeekKey))).toEqual([
      { account_id: alice.id, username: 'jalice', score: 1, rank: 1, days: 1 },
    ]);
    expect(stripSnapshot(await snapshotRows('monthly', prevMonthKey))).toEqual([
      { account_id: alice.id, username: 'jalice', score: 1, rank: 1, days: 1 },
    ]);
    expect(stripSnapshot(await snapshotRows('yearly', prevYearKey))).toEqual([
      { account_id: alice.id, username: 'jalice', score: 1, rank: 1, days: 1 },
    ]);
  });
});
