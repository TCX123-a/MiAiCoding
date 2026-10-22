/**
 * 排行榜集成测试（docs/26 §4.5 端点 + §3.5 快照 + §7.3 筛选取径）。
 *
 * 覆盖：快照路径（含「无快照 → 空态 + computedAt=null」）/ alltime 实算 / 过滤口径逐题求和 /
 * 名次宇宙与 opt-in 曝光分离（非 opt-in 用户不上 entries 但 me.rank 照给，榜面有诚实的洞）/
 * 并列同名次 / keyset 游标 / 封禁剔除 / me.scoreToday 永远实算 / 参数校验 /
 * entries.langs 勾选语义（2026-10-10 夜：显示「所选语言」，做题语言 ≠ 所选语言）。
 *
 * 用例数据走真实结算端点（POST /v1/challenge/days）；user_stats 与 leaderboard_snapshots 是
 * 每日任务的派生表（job 契约见 jobs/daily.ts），测试用 SQL 按同口径种下——user_stats 用 upsert
 * （结算快路径已就地建行并累加同值）。
 * 只动 test/**。
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, register, type TestContext } from '../helpers/app.js';

const HIGH_LIMITS = {
  registerPerHourPerIp: 100_000,
  registerPerDayGlobal: 1_000_000,
  loginPer15MinPerIp: 10_000,
  apiPerMinute: 1_000_000,
};

const INSTALL = '9f2c77aa-1111-4222-8333-444455556666';

/** 北京时间固定 = UTC+8（中国 1991 年起无夏令时）；测试侧独立算，不与实现共用函数 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function bjDay(offsetDays = 0): string {
  return new Date(Date.now() + BEIJING_OFFSET_MS + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function q(over: Record<string, unknown> = {}) {
  return {
    key: `c-stage1-01:${randomUUID().slice(0, 8)}`,
    lessonId: 'c-stage1-01',
    qid: 'q1',
    lang: 'cpp',
    stage: 1,
    type: 'choice',
    difficulty: 'easy',
    source: 'local',
    ok: true,
    ...over,
  };
}

/** 5 题 cpp easy，前 correctCount 题答对 → 每题 100 分（easy 难度分，与语言无关） */
function questions(correctCount: number) {
  return [0, 1, 2, 3, 4].map((i) => q({ ok: i < correctCount }));
}

let ctx: TestContext;
let tokenA = '';
let tokenB = '';
let tokenC = '';
let tokenD = '';
let idA = '';
let idB = '';
let idC = '';
let idD = '';

const today = bjDay(0);
const yesterday = bjDay(-1);

function board(token: string, qs: string) {
  return ctx.app.inject({ method: 'GET', url: `/v1/leaderboard?${qs}`, headers: bearer(token) });
}

async function settle(token: string, correctCount: number, dateKey: string) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/v1/challenge/days',
    headers: bearer(token),
    payload: {
      submissionId: randomUUID(),
      installId: INSTALL,
      dateKey,
      source: 'local',
      finishedAt: new Date().toISOString(),
      questions: questions(correctCount),
    },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

beforeAll(async () => {
  ctx = await createTestContext({ rateLimits: HIGH_LIMITS });
  const a = await register(ctx.app, 'lb_a');
  const b = await register(ctx.app, 'lb_b');
  const c = await register(ctx.app, 'lb_c');
  const d = await register(ctx.app, 'lb_d');
  tokenA = a.json().token as string;
  tokenB = b.json().token as string;
  tokenC = c.json().token as string;
  tokenD = d.json().token as string;
  idA = a.json().account.id as string;
  idB = b.json().account.id as string;
  idC = c.json().account.id as string;
  idD = d.json().account.id as string;

  // A 5/5 → 500，C 5/5 → 500（并列），B 4/5 → 400
  await settle(tokenA, 5, today);
  await settle(tokenB, 4, today);
  await settle(tokenC, 5, today);

  // opt-in：A、B 开启，C 默认关闭（这是 §4.5 隐私边界的被测点）
  await ctx.raw.query(`UPDATE users SET leaderboard_opt_in = true WHERE id = $1`, [idA]);
  await ctx.raw.query(`UPDATE users SET leaderboard_opt_in = true WHERE id = $1`, [idB]);

  // user_stats：每日任务同口径（total_score = SUM(challenge_days.score)）。注意结算快路径
  // （§3.3，challenge.ts）已经在结算时就建行并累加了同值——这里 upsert 复写，对「行已存在」免疫。
  await ctx.raw.query(
    `INSERT INTO user_stats (account_id, total_score, last_active_day)
     SELECT account_id, SUM(score)::int, MAX(date_key) FROM challenge_days GROUP BY account_id
     ON CONFLICT (account_id) DO UPDATE
        SET total_score = EXCLUDED.total_score, last_active_day = EXCLUDED.last_active_day`,
  );

  // 昨日的 daily 快照（job 产物）：C 900(rank1，非 opt-in) / A 800(rank2) / B 700(rank3)
  const rows: Array<[string, number, number]> = [
    [idC, 900, 1],
    [idA, 800, 2],
    [idB, 700, 3],
  ];
  for (const [account, score, rank] of rows) {
    await ctx.raw.query(
      `INSERT INTO leaderboard_snapshots (period, period_key, account_id, score, rank, days, computed_at)
       VALUES ('daily', $1, $2, $3, $4, 1, '2026-10-07T19:05:00Z')`,
      [yesterday, account, score, rank],
    );
  }

  // 上一周（2026-W40）的 weekly 快照：C 1600(rank1) / A 1500(rank2) / B 1200(rank3)
  const weeklyRows: Array<[string, number, number]> = [
    [idC, 1600, 1],
    [idA, 1500, 2],
    [idB, 1200, 3],
  ];
  for (const [account, score, rank] of weeklyRows) {
    await ctx.raw.query(
      `INSERT INTO leaderboard_snapshots (period, period_key, account_id, score, rank, days, computed_at)
       VALUES ('weekly', '2026-W40', $1, $2, $3, 2, '2026-10-07T19:05:00Z')`,
      [account, score, rank],
    );
  }

  // 本月 / 本年的快照（2026-10-10 改版：monthly/yearly 并入同一张表）。键按运行日动态取——
  // 这里的 INSERT 同时是 0008 迁移的现场见证（period CHECK 未放宽会在种数据时就 23514 炸）。
  const monthKey = today.slice(0, 7);
  const yearKey = today.slice(0, 4);
  const monthlyRows: Array<[string, number, number]> = [
    [idC, 2000, 1],
    [idA, 1800, 2],
    [idB, 1500, 3],
  ];
  for (const [account, score, rank] of monthlyRows) {
    await ctx.raw.query(
      `INSERT INTO leaderboard_snapshots (period, period_key, account_id, score, rank, days, computed_at)
       VALUES ('monthly', $1, $2, $3, $4, 3, '2026-10-07T19:05:00Z')`,
      [monthKey, account, score, rank],
    );
  }
  const yearlyRows: Array<[string, number, number]> = [
    [idC, 5000, 1],
    [idA, 4000, 2],
    [idB, 3500, 3],
  ];
  for (const [account, score, rank] of yearlyRows) {
    await ctx.raw.query(
      `INSERT INTO leaderboard_snapshots (period, period_key, account_id, score, rank, days, computed_at)
       VALUES ('yearly', $1, $2, $3, $4, 5, '2026-10-07T19:05:00Z')`,
      [yearKey, account, score, rank],
    );
  }
});

afterAll(async () => {
  await ctx.raw.close();
});

describe('快照路径（daily/weekly/monthly/yearly 无过滤）', () => {
  it('已生成快照的昨日 daily：entries 只有 opt-in，非 opt-in 的名次就是那个洞（langs=[]：昨日窗口内无题）', async () => {
    const res = await board(tokenA, `period=daily&periodKey=${yesterday}`);
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.periodKey).toBe(yesterday);
    expect(json.filter).toEqual({ lang: null, difficulty: null });
    expect(json.entries).toEqual([
      { rank: 2, username: 'lb_a', avatarHash: null, score: 800, days: 1, langs: [] },
      { rank: 3, username: 'lb_b', avatarHash: null, score: 700, days: 1, langs: [] },
    ]);
    expect(json.computedAt).toBe('2026-10-07T19:05:00.000Z'); // 快照时间戳原样返回（客户端标注「截至」）
    expect(json.nextCursor).toBeNull();
  });

  it('me 永远返回：A 是 rank2/800，scoreToday 仍实算今日（500）', async () => {
    const json = (await board(tokenA, `period=daily&periodKey=${yesterday}`)).json();
    expect(json.me).toEqual({ rank: 2, score: 800, optedIn: true, scoreToday: 500 });
  });

  it('非 opt-in 的 C：不在 entries、me.rank 照给（rank1/900）', async () => {
    const json = (await board(tokenC, `period=daily&periodKey=${yesterday}`)).json();
    expect(json.entries).toEqual([
      { rank: 2, username: 'lb_a', avatarHash: null, score: 800, days: 1, langs: [] },
      { rank: 3, username: 'lb_b', avatarHash: null, score: 700, days: 1, langs: [] },
    ]);
    expect(json.me).toEqual({ rank: 1, score: 900, optedIn: false, scoreToday: 500 });
  });

  it('显式查今天（快照只铸已结束的日，今天最早明天 03:05 才有）：空态 + computedAt=null + me 照常', async () => {
    const json = (await board(tokenA, `period=daily&periodKey=${today}`)).json();
    expect(json.entries).toEqual([]);
    expect(json.computedAt).toBeNull();
    expect(json.me).toEqual({ rank: null, score: 0, optedIn: true, scoreToday: 500 });
  });

  it('daily 省略 periodKey = 刚结束的一天：默认请求命中昨快照（回归：曾恒空）', async () => {
    // 默认键与每日任务的 referenceDay 同源（服务器日 −1）。曾经取「当天」——
    // 而当天键最早要等明天的 cron 才铸，那时默认键已滚到明天 ⇒ 默认请求恒空死路
    // （2026-10-10 对抗核验抓到，已修）。
    const json = (await board(tokenA, 'period=daily')).json();
    expect(json.periodKey).toBe(yesterday);
    expect(json.entries).toEqual([
      { rank: 2, username: 'lb_a', avatarHash: null, score: 800, days: 1, langs: [] },
      { rank: 3, username: 'lb_b', avatarHash: null, score: 700, days: 1, langs: [] },
    ]);
    expect(json.me).toEqual({ rank: 2, score: 800, optedIn: true, scoreToday: 500 });
  });

  it('快照路径的 keyset 游标：limit=1 逐页推进', async () => {
    const page1 = (await board(tokenA, `period=daily&periodKey=${yesterday}&limit=1`)).json();
    expect(page1.entries).toEqual([{ rank: 2, username: 'lb_a', avatarHash: null, score: 800, days: 1, langs: [] }]);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = (await board(tokenA, `period=daily&periodKey=${yesterday}&limit=1&cursor=${encodeURIComponent(page1.nextCursor)}`)).json();
    expect(page2.entries).toEqual([{ rank: 3, username: 'lb_b', avatarHash: null, score: 700, days: 1, langs: [] }]);
    // 前瞻语义：第二页之后确无第三行 → 游标为 null（不是「满页就给游标」的启发式）
    expect(page2.nextCursor).toBeNull();
  });

  it('weekly 快照（periodKey=2026-W40）：与 daily 共用一张表，按 period 分读（W40 窗口不含今日 → langs=[]）', async () => {
    const json = (await board(tokenA, 'period=weekly&periodKey=2026-W40')).json();
    expect(json.periodKey).toBe('2026-W40');
    expect(json.entries).toEqual([
      { rank: 2, username: 'lb_a', avatarHash: null, score: 1500, days: 2, langs: [] },
      { rank: 3, username: 'lb_b', avatarHash: null, score: 1200, days: 2, langs: [] },
    ]);
    // me 也吃 weekly 快照（rank2/1500），scoreToday 仍是今日实算
    expect(json.me).toEqual({ rank: 2, score: 1500, optedIn: true, scoreToday: 500 });
    expect(json.computedAt).toBe('2026-10-07T19:05:00.000Z');
  });

  it('monthly 快照（本月键）：四档期共用同一张表；窗口含今日 → langs 有 cpp（A/B 今天的题都是 cpp）', async () => {
    const monthKey = today.slice(0, 7);
    const json = (await board(tokenA, `period=monthly&periodKey=${monthKey}`)).json();
    expect(json.periodKey).toBe(monthKey);
    expect(json.entries).toEqual([
      { rank: 2, username: 'lb_a', avatarHash: null, score: 1800, days: 3, langs: ['cpp'] },
      { rank: 3, username: 'lb_b', avatarHash: null, score: 1500, days: 3, langs: ['cpp'] },
    ]);
    expect(json.me).toEqual({ rank: 2, score: 1800, optedIn: true, scoreToday: 500 });

    // 缺省 periodKey（不带）与显式当前月键等价（「当前」以服务器北京日为参照）
    const dflt = (await board(tokenA, 'period=monthly')).json();
    expect(dflt.periodKey).toBe(monthKey);
    expect(dflt.entries).toEqual(json.entries);
  });

  it('yearly 快照（本年键）：同理；缺省 periodKey = 当前年', async () => {
    const yearKey = today.slice(0, 4);
    const json = (await board(tokenA, `period=yearly&periodKey=${yearKey}`)).json();
    expect(json.periodKey).toBe(yearKey);
    expect(json.entries).toEqual([
      { rank: 2, username: 'lb_a', avatarHash: null, score: 4000, days: 5, langs: ['cpp'] },
      { rank: 3, username: 'lb_b', avatarHash: null, score: 3500, days: 5, langs: ['cpp'] },
    ]);

    const dflt = (await board(tokenA, 'period=yearly')).json();
    expect(dflt.periodKey).toBe(yearKey);
    expect(dflt.entries).toEqual(json.entries);
  });
});

describe('alltime 实算（user_stats 口径）', () => {
  it('并列同名次 + opt-in 洞 + me 三态', async () => {
    const json = (await board(tokenA, 'period=alltime')).json();
    expect(json.periodKey).toBeNull();
    // A 与 C 同为 500（rank1 并列）；C 非 opt-in → 不上榜，A 的洞就是 C
    // alltime 的 langs 窗口 = 全时段（无日期过滤）→ A/B 今天做过的 cpp 都记上
    expect(json.entries).toEqual([
      { rank: 1, username: 'lb_a', avatarHash: null, score: 500, days: 1, langs: ['cpp'] },
      { rank: 3, username: 'lb_b', avatarHash: null, score: 400, days: 1, langs: ['cpp'] },
    ]);
    expect(json.computedAt).not.toBeNull(); // 实算路径给请求时刻

    const meC = (await board(tokenC, 'period=alltime')).json().me;
    expect(meC).toEqual({ rank: 1, score: 500, optedIn: false, scoreToday: 500 });

    // 完全没结算过的新账号：rank null、score 0、scoreToday 0
    const meD = (await board(tokenD, 'period=alltime')).json().me;
    expect(meD).toEqual({ rank: null, score: 0, optedIn: false, scoreToday: 0 });
  });
});

describe('过滤口径（§7.3：只改变分数口径，不产生第二张榜）', () => {
  it('lang=cpp → 与总分同值（全是 cpp 题）；difficulty=easy&lang=cpp → 同值', async () => {
    const byLang = (await board(tokenA, `period=daily&periodKey=${today}&lang=cpp`)).json();
    expect(byLang.entries).toEqual([
      { rank: 1, username: 'lb_a', avatarHash: null, score: 500, days: 1, langs: ['cpp'] },
      { rank: 3, username: 'lb_b', avatarHash: null, score: 400, days: 1, langs: ['cpp'] },
    ]);
    const both = (await board(tokenA, `period=daily&periodKey=${today}&lang=cpp&difficulty=easy`)).json();
    expect(both.entries.map((e: { score: number }) => e.score)).toEqual([500, 400]);
    expect(both.filter).toEqual({ lang: 'cpp', difficulty: 'easy' });
  });

  it('lang=python（本题批没有 python 题）→ 空榜、me.rank=null、me.score=0', async () => {
    const json = (await board(tokenA, 'period=alltime&lang=python')).json();
    expect(json.entries).toEqual([]);
    expect(json.me).toEqual({ rank: null, score: 0, optedIn: true, scoreToday: 500 });
  });

  it('difficulty=challenge → 空（本批无 challenge 档题）；weekly 走哪条路径由「有无过滤」决定', async () => {
    const chal = (await board(tokenA, `period=daily&periodKey=${today}&difficulty=challenge`)).json();
    expect(chal.entries).toEqual([]);

    // 无过滤 weekly → 快照路径；当前周的快照由每日任务重铸，测试环境没有 → 空态（不是实算）
    const weekly = (await board(tokenA, 'period=weekly')).json();
    expect(weekly.entries).toEqual([]);
    expect(weekly.computedAt).toBeNull();

    // 带过滤 weekly → 实算路径（isoWeekRange 展开当前 ISO 周），当前周含今日 → 有分
    const weeklyFiltered = (await board(tokenA, 'period=weekly&lang=cpp')).json();
    expect(weeklyFiltered.entries.map((e: { score: number }) => e.score)).toEqual([500, 400]);
  });

  it('过滤路径的 me.rank 与 entries 同源（A 在过滤榜里 rank1/500）', async () => {
    const json = (await board(tokenA, `period=daily&periodKey=${today}&lang=cpp`)).json();
    expect(json.me).toEqual({ rank: 1, score: 500, optedIn: true, scoreToday: 500 });
  });
});

describe('封禁剔除与参数校验', () => {
  it('disabled_at 非空 → 从榜面与名次宇宙同时消失，被跳过者的名次让位（重排证据）', async () => {
    // 给 D 种一条低分并开 opt-in：B 封禁后 D 应从 rank4 升到 rank3（否则这条测试没测到重排）
    await ctx.raw.query(`INSERT INTO user_stats (account_id, total_score) VALUES ($1, 100)`, [idD]);
    await ctx.raw.query(`UPDATE users SET leaderboard_opt_in = true WHERE id = $1`, [idD]);

    const before = (await board(tokenA, 'period=alltime')).json();
    expect(before.entries).toEqual([
      { rank: 1, username: 'lb_a', avatarHash: null, score: 500, days: 1, langs: ['cpp'] },
      { rank: 3, username: 'lb_b', avatarHash: null, score: 400, days: 1, langs: ['cpp'] },
      { rank: 4, username: 'lb_d', avatarHash: null, score: 100, days: 0, langs: [] }, // D 只种了 user_stats 分，没做过题
    ]);

    await ctx.raw.query(`UPDATE users SET disabled_at = now() WHERE id = $1`, [idB]);

    const after = (await board(tokenA, 'period=alltime')).json();
    expect(after.entries).toEqual([
      { rank: 1, username: 'lb_a', avatarHash: null, score: 500, days: 1, langs: ['cpp'] },
      { rank: 3, username: 'lb_d', avatarHash: null, score: 100, days: 0, langs: [] }, // 4 → 3：B 的名次宇宙席位被拿掉
    ]);
    expect(after.me).toMatchObject({ rank: 1, score: 500 });
  });

  it('period 必填、枚举校验；periodKey 按期校验；alltime 禁 periodKey；坏 cursor；limit 上限', async () => {
    expect((await board(tokenA, '')).statusCode).toBe(400);
    // 2026-10-10 改版：yearly/monthly 由 400 转正（五页签），缺省键 = 当前年/当前月
    expect((await board(tokenA, 'period=yearly')).statusCode).toBe(200);
    expect((await board(tokenA, 'period=monthly')).statusCode).toBe(200);
    expect((await board(tokenA, 'period=daily&periodKey=2026-02-30')).statusCode).toBe(400);
    expect((await board(tokenA, 'period=weekly&periodKey=2026-W54')).statusCode).toBe(400);
    // 月键：形状 4-2 且月份 1..12；年键：恰 4 位数字（形状校验之外还有「真实存在」一档）
    expect((await board(tokenA, 'period=monthly&periodKey=2026-13')).statusCode).toBe(400);
    expect((await board(tokenA, 'period=monthly&periodKey=2026-00')).statusCode).toBe(400);
    expect((await board(tokenA, 'period=monthly&periodKey=2026-1')).statusCode).toBe(400);
    expect((await board(tokenA, 'period=monthly&periodKey=2026-10-08')).statusCode).toBe(400);
    expect((await board(tokenA, 'period=yearly&periodKey=2026-10')).statusCode).toBe(400);
    expect((await board(tokenA, 'period=yearly&periodKey=26')).statusCode).toBe(400);
    expect((await board(tokenA, 'period=alltime&periodKey=2026-10-08')).statusCode).toBe(400);
    expect((await board(tokenA, 'period=alltime&cursor=!!!not-base64***')).statusCode).toBe(400);
    expect((await board(tokenA, 'period=alltime&limit=101')).statusCode).toBe(400);
    expect((await board(tokenA, 'period=daily&lang=rust')).statusCode).toBe(400);

    const anon = await ctx.app.inject({ method: 'GET', url: '/v1/leaderboard?period=alltime' });
    expect(anon.statusCode).toBe(401);
  });
});

describe('entries.langs 与月/年窗口（独立库：混合语言账号，不与上面的固定 fixture 纠缠）', () => {
  let ctx2: TestContext;
  let tokenX = '';
  let idX = '';
  let tokenY = '';
  let idY = '';

  const dIn = today; // 当前月内 + 当前年内
  // 当前年内、当前月外：4 月及以后回退 60 天，1~3 月前进 60 天——两个方向都恰好跨月不跨年
  const dYear = Number(dIn.slice(5, 7)) >= 4 ? bjDay(-60) : bjDay(60);
  const dOut = bjDay(-400); // 必跨年（>365 天），用来钉「年窗口真的滤掉了年外」

  function board2(token: string, qs: string) {
    return ctx2.app.inject({ method: 'GET', url: `/v1/leaderboard?${qs}`, headers: bearer(token) });
  }

  function settle2(token: string, dateKey: string, langs: string[], pickedLangs?: string[]) {
    return ctx2.app.inject({
      method: 'POST',
      url: '/v1/challenge/days',
      headers: bearer(token),
      payload: {
        submissionId: randomUUID(),
        installId: INSTALL,
        dateKey,
        source: 'local',
        finishedAt: new Date().toISOString(),
        questions: langs.map((lang) => q({ lang })),
        ...(pickedLangs === undefined ? {} : { pickedLangs }),
      },
    });
  }

  /**
   * 复刻结算写入口径、直插 challenge_days + challenge_questions 两表。
   * 专供超结算窗口（A1：过去 ≤30 天 / 未来 ≤+1 天）的历史夹具——这些日子新客户端
   * 再也送不上来（正是守门的反面见证），但历史读取面（榜单窗口/langs 聚合）仍需样本。
   */
  async function seedSettledDay(accountId: string, dateKey: string, langs: string[]): Promise<void> {
    const total = langs.length;
    const score = total * 100; // 全 easy：每题难度分 100
    await ctx2.raw.query(
      `INSERT INTO challenge_days
         (account_id, date_key, install_id, source, finished_at,
          correct, total, score, score_max, submission_id, payload_sha256, picked_langs)
       VALUES ($1, $2::date, $3, 'local', now(), $4, $4, $5, $5, $6, 'seed', $7::text[])`,
      [accountId, dateKey, INSTALL, total, score, randomUUID(), langs.filter((l) => l !== 'common')],
    );
    for (let i = 0; i < langs.length; i++) {
      await ctx2.raw.query(
        `INSERT INTO challenge_questions
           (account_id, date_key, idx, question_key, lesson_id, qid, lang, stage,
            qtype, difficulty, source, ok, points)
         VALUES ($1, $2::date, $3, $4, 'c-stage1-01', $5, $6, 1, 'choice', 'easy', 'local', true, 100)`,
        [accountId, dateKey, i, `c-stage1-01:s${i + 1}`, `s${i + 1}`, langs[i]],
      );
    }
  }

  beforeAll(async () => {
    ctx2 = await createTestContext({ rateLimits: HIGH_LIMITS });
    const x = await register(ctx2.app, 'lx_a');
    const y = await register(ctx2.app, 'lx_b');
    tokenX = x.json().token as string;
    idX = x.json().account.id as string;
    tokenY = y.json().token as string;
    idY = y.json().account.id as string;
    await ctx2.raw.query(`UPDATE users SET leaderboard_opt_in = true WHERE id IN ($1, $2)`, [idX, idY]);

    // lx_a：今天 cpp+java+common（走真实结算端点；A1 窗口内）
    expect((await settle2(tokenX, dIn, ['cpp', 'java', 'common'])).statusCode).toBe(200);
    // dYear（年内月外，1~3 月时还是 +60 天的未来日）与 dOut（−400 天）都超出结算窗口——
    // A1 裁定 b 落地后 settle2 必 400，历史读取面测试改为直插两表（见 seedSettledDay）
    await seedSettledDay(idX, dYear, ['c', 'c']);
    await seedSettledDay(idX, dOut, ['python', 'python']);
    // lx_b：只做通用题
    expect((await settle2(tokenY, dIn, ['common', 'common'])).statusCode).toBe(200);
  });

  afterAll(async () => {
    await ctx2.raw.close();
  });

  it('夹具前置自检：dYear 同年不同月、dOut 跨年（夹具坏了这条先红，别去怀疑被测代码）', () => {
    expect(dYear.slice(0, 4)).toBe(dIn.slice(0, 4));
    expect(dYear.slice(0, 7)).not.toBe(dIn.slice(0, 7));
    expect(dOut.slice(0, 4)).not.toBe(dIn.slice(0, 4));
  });

  it('monthly（过滤路径实算）：只算当月；langs 按 LANGS 声明序、不含 common；只做过通用题 → 空数组', async () => {
    const json = (await board2(tokenX, 'period=monthly&difficulty=easy')).json();
    const x = json.entries.find((e: { username: string }) => e.username === 'lx_a');
    expect(x).toBeDefined();
    expect(x.score).toBe(300); // 100(cpp) + 100(java) + 100(common)：难度分制（easy 100）×3，common 计分但不上 langs
    expect(x.langs).toEqual(['cpp', 'java']); // 声明序 c<cpp<java<python；common 剔除
    const y = json.entries.find((e: { username: string }) => e.username === 'lx_b');
    expect(y).toBeDefined();
    expect(y.score).toBe(200); // 2×common(100)
    expect(y.langs).toEqual([]); // 「还没记录」= 空数组，不是缺字段/undefined
  });

  it('yearly（过滤路径实算）：多算年内月外的那个月；年外那天两窗都不含（langs 与分数同源窗口）', async () => {
    const json = (await board2(tokenX, 'period=yearly&difficulty=easy')).json();
    const x = json.entries.find((e: { username: string }) => e.username === 'lx_a');
    expect(x).toBeDefined();
    expect(x.score).toBe(300 + 200); // 再加 c easy ×2（100×2）；年外的 python×2（200）不算
    expect(x.langs).toEqual(['c', 'cpp', 'java']); // 年外 python 不在；声明序 c<cpp<java
    const y = json.entries.find((e: { username: string }) => e.username === 'lx_b');
    expect(y.langs).toEqual([]);
  });
});

describe('entries.langs = 开赛勾选语言（2026-10-10 夜主人令：显示「所选语言」，不是「做过哪些题的语言」）', () => {
  let ctx3: TestContext;
  let tokenM = '';
  let idM = '';
  let tokenN = '';
  let idN = '';

  function settle3(token: string, dateKey: string, langs: string[], pickedLangs: string[]) {
    return ctx3.app.inject({
      method: 'POST',
      url: '/v1/challenge/days',
      headers: bearer(token),
      payload: {
        submissionId: randomUUID(),
        installId: INSTALL,
        dateKey,
        source: 'local',
        finishedAt: new Date().toISOString(),
        questions: langs.map((lang) => q({ lang })),
        pickedLangs,
      },
    });
  }

  function board3(token: string, qs: string) {
    return ctx3.app.inject({ method: 'GET', url: `/v1/leaderboard?${qs}`, headers: bearer(token) });
  }

  beforeAll(async () => {
    ctx3 = await createTestContext({ rateLimits: HIGH_LIMITS });
    const m = await register(ctx3.app, 'lm_a');
    const n = await register(ctx3.app, 'lm_b');
    tokenM = m.json().token as string;
    idM = m.json().account.id as string;
    tokenN = n.json().token as string;
    idN = n.json().account.id as string;
    await ctx3.raw.query(`UPDATE users SET leaderboard_opt_in = true WHERE id IN ($1, $2)`, [idM, idN]);

    // M（主人原例）：学了四门，今天只勾 C——题批也全 C
    expect((await settle3(tokenM, today, ['c', 'c', 'c'], ['c'])).statusCode).toBe(200);
    // N（反向错开）：勾了 C+Java，今天题批却只有 C 题——
    //   从做题语言反推永远推不出 Java，只有 pickedLangs 能把它带上榜
    expect((await settle3(tokenN, today, ['c'], ['c', 'java'])).statusCode).toBe(200);
  });

  afterAll(async () => {
    await ctx3.raw.close();
  });

  it('日榜（过滤实算路径）：M 显示 [c]；N 显示 [c,java]——勾选不被做题语言收窄', async () => {
    const json = (await board3(tokenM, `period=daily&periodKey=${today}&difficulty=easy`)).json();
    const m = json.entries.find((e: { username: string }) => e.username === 'lm_a');
    expect(m).toBeDefined();
    expect(m.langs).toEqual(['c']); // 主人原例判据：学四门只勾 C ⇒ 只显示 C
    const n = json.entries.find((e: { username: string }) => e.username === 'lm_b');
    expect(n).toBeDefined();
    expect(n.langs).toEqual(['c', 'java']); // Java 只存在于勾选里——从题批反推必丢
  });

  it('lang 过滤器不窄化 langs：lang=c 的过滤榜里 N 仍是 [c,java]（langs 是「所选」，不是过滤产物）', async () => {
    const json = (await board3(tokenM, `period=daily&periodKey=${today}&lang=c`)).json();
    const n = json.entries.find((e: { username: string }) => e.username === 'lm_b');
    expect(n).toBeDefined();
    expect(n.langs).toEqual(['c', 'java']);
    const m = json.entries.find((e: { username: string }) => e.username === 'lm_a');
    expect(m.langs).toEqual(['c']);
  });
});

describe('GET /v1/leaderboard?dateKey=（第 6 项日差：榜页 me.scoreToday 按客户端本地日查）', () => {
  it('?dateKey=明天 读到那天的档（与 me/summary 同分）；缺省 = 服务器日看不到；±1 之外与坏形状 → 400', async () => {
    const reg = await register(ctx.app, 'lb_day');
    const token = reg.json().token as string;
    const tomorrow = bjDay(1);
    const settled = await settle(token, 5, tomorrow); // 明天在结算窗内（+1 天合法）
    expect(settled.score).toBeGreaterThan(0); // 档必须真非零，否则下面的同分断言会 0===0 假绿

    const withKey = await board(token, `period=daily&periodKey=${tomorrow}&dateKey=${tomorrow}`);
    expect(withKey.statusCode).toBe(200);
    expect(withKey.json().me.scoreToday).toBe(settled.score);

    // 缺省 = 服务器北京今天：看不到明天的档（老客户端行为不变）
    const without = await board(token, `period=daily&periodKey=${tomorrow}`);
    expect(without.json().me.scoreToday).toBe(0);

    // 容差 ±1 天之外（+2 / −2）与坏形状（2026-02-30）→ 400（与 me/summary 同判据）
    for (const bad of [bjDay(2), bjDay(-2), '2026-02-30']) {
      const res = await board(token, `period=daily&periodKey=${tomorrow}&dateKey=${bad}`);
      expect(res.statusCode, `dateKey=${bad} 应当 400`).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    }
  });
});
