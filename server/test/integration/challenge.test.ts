/**
 * 挑战结算集成测试（docs/26 §4.3/§4.4 端点 + §5 计分 + §7.2 难度复核 + §8.4 冲突 + §4.7 限流
 * + 总分快路径的列作用域与并发唯一性）。
 *
 * 断言的目标值全部按难度分制手算（不调用被测的 scoreBatch 反推），信源独立防「判据抄实现」：
 *   每题分 = 难度分（easy 100 / medium 150 / hard 200 / challenge 250），语言权重全 100、与语言无关；
 *   如 d1 = 5×easy/cpp 全对 = 5×100 = 500 分。
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

/** 固定 installId（uuid v4 形状；服务端只校验形状） */
const INSTALL = '9f2c77aa-1111-4222-8333-444455556666';

interface Question {
  key: string;
  lessonId: string;
  qid: string;
  lang: string;
  stage: number;
  type: string;
  difficulty: string;
  source: string;
  ok: boolean;
}

interface SettleBody {
  submissionId: string;
  installId: string;
  dateKey: string;
  source: string;
  startedAt?: string;
  finishedAt: string;
  questions: Question[];
  /** 开赛前勾选的语言（2026-10-10 夜新增；缺省 = legacy 客户端，服务端从题批派生） */
  pickedLangs?: string[];
}

/** 北京时间固定 = UTC+8（中国 1991 年起无夏令时）；测试侧独立算，不与实现共用函数 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function bjDay(offsetDays = 0): string {
  return new Date(Date.now() + BEIJING_OFFSET_MS + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function q(over: Partial<Question> & { key: string }): Question {
  return {
    lessonId: 'c-stage1-01',
    qid: 'q1',
    lang: 'c',
    stage: 1,
    type: 'choice',
    difficulty: 'easy',
    source: 'local',
    ok: true,
    ...over,
  };
}

/** n 题全对 / easy / cpp：每题 100 分（难度分，与语言无关）→ n×100（批长契约用例：1..5000 任意长度） */
function nCppEasy(n: number): Question[] {
  return Array.from({ length: n }, (_, i) =>
    q({ key: `c-stage1-01:q${i + 1}`, qid: `q${i + 1}`, lang: 'cpp' }),
  );
}

/** 5 题全对 / easy / cpp：每题 100 分 → 500/500 */
function fiveCppEasy(): Question[] {
  return nCppEasy(5);
}

function body(over: Partial<SettleBody> = {}): SettleBody {
  return {
    submissionId: randomUUID(),
    installId: INSTALL,
    dateKey: bjDay(0),
    source: 'local',
    startedAt: new Date(Date.now() - 600_000).toISOString(),
    finishedAt: new Date(Date.now() - 60_000).toISOString(),
    questions: fiveCppEasy(),
    ...over,
  };
}

let ctx: TestContext;
let tokenA = '';
let tokenB = '';
let tokenC = '';
let idA = '';
let idB = '';
let idC = '';
const d1 = bjDay(0);
const d2 = bjDay(-1);

function settle(token: string, payload: SettleBody) {
  return ctx.app.inject({
    method: 'POST',
    url: '/v1/challenge/days',
    headers: bearer(token),
    payload,
  });
}

function history(token: string, qs = '') {
  return ctx.app.inject({
    method: 'GET',
    url: `/v1/challenge/days${qs}`,
    headers: bearer(token),
  });
}

const d1Body = body({ dateKey: d1 });

beforeAll(async () => {
  ctx = await createTestContext({ rateLimits: HIGH_LIMITS });
  const a = await register(ctx.app, 'chal_a');
  const b = await register(ctx.app, 'chal_b');
  const c = await register(ctx.app, 'chal_c');
  tokenA = a.json().token as string;
  tokenB = b.json().token as string;
  tokenC = c.json().token as string;
  idA = a.json().account.id as string;
  idB = b.json().account.id as string;
  idC = c.json().account.id as string;
});

afterAll(async () => {
  await ctx.raw.close();
});

describe('结算主路径（d1：5×easy/cpp 全对）', () => {
  it('结算 200：score=500 / scoreMax=500，逐题明细与 user_days 落库', async () => {
    const res = await settle(tokenA, d1Body);
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toMatchObject({
      settled: true,
      idempotent: false,
      dateKey: d1,
      correct: 5,
      total: 5,
      score: 500,
      scoreMax: 500,
      flags: [],
    });

    const rows = await ctx.raw.query<{
      idx: number;
      difficulty: string;
      points: number;
      question_key: string;
    }>(
      `SELECT idx, difficulty, points, question_key FROM challenge_questions
        WHERE account_id = $1 AND date_key = $2::date ORDER BY idx`,
      [idA, d1],
    );
    expect(rows.rows).toHaveLength(5);
    for (const row of rows.rows) {
      expect(row.difficulty).toBe('easy'); // 上报 easy == 推导 easy，无降档
      expect(row.points).toBe(100);
    }
    expect(rows.rows.map((r) => r.question_key)).toEqual([
      'c-stage1-01:q1',
      'c-stage1-01:q2',
      'c-stage1-01:q3',
      'c-stage1-01:q4',
      'c-stage1-01:q5',
    ]);

    const day = await ctx.raw.query<{ score: number; score_max: number; flags: string[] }>(
      `SELECT score, score_max, flags FROM challenge_days WHERE account_id = $1 AND date_key = $2::date`,
      [idA, d1],
    );
    expect(day.rows[0]).toMatchObject({ score: 500, score_max: 500, flags: [] });

    const ud = await ctx.raw.query<{ score: number }>(
      `SELECT score FROM user_days WHERE account_id = $1 AND day_key = $2::date`,
      [idA, d1],
    );
    expect(ud.rows[0]!.score).toBe(500);

    // 总分快路径：结算就地把分加进 user_stats.total_score（每日任务按 SUM(challenge_days.score) 对账）
    const st = await ctx.raw.query<{ total_score: number }>(
      `SELECT total_score FROM user_stats WHERE account_id = $1`,
      [idA],
    );
    expect(st.rows[0]!.total_score).toBe(500);
  });

  it('同 submissionId + 同 payload 重放 → 200 idempotent:true，不产生重复明细', async () => {
    const res = await settle(tokenA, d1Body);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ settled: true, idempotent: true, score: 500, scoreMax: 500 });

    const n = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM challenge_questions WHERE account_id = $1 AND date_key = $2::date`,
      [idA, d1],
    );
    expect(n.rows[0]!.n).toBe(5);

    // 幂等重放不重复累加总分（快速路径早于计分/累加逻辑）
    const st = await ctx.raw.query<{ total_score: number }>(
      `SELECT total_score FROM user_stats WHERE account_id = $1`,
      [idA],
    );
    expect(st.rows[0]!.total_score).toBe(500);
  });

  it('同 submissionId 但内容不同 → 409 CHALLENGE_DUPLICATE（幂等 200 的条件是 sub+hash 双双一致）', async () => {
    const tampered = { ...d1Body, questions: d1Body.questions.map((x, i) => (i === 0 ? { ...x, ok: false } : x)) };
    const res = await settle(tokenA, tampered);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'CHALLENGE_DUPLICATE' });
  });

  it('同日换 submissionId → 409 CHALLENGE_DUPLICATE，details 带已结算分数', async () => {
    const res = await settle(tokenA, body({ dateKey: d1 }));
    expect(res.statusCode).toBe(409);
    const err = res.json().error;
    expect(err.code).toBe('CHALLENGE_DUPLICATE');
    expect(err.details.score).toBe(500);
  });

  it('B 账号同日独立结算（PK 是 account_id+date_key，互不影响）', async () => {
    const res = await settle(tokenB, body({ dateKey: d1 }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ idempotent: false, score: 500 });
  });
});

describe('难度复核（d2：压回/合法 challenge/低报）', () => {
  it('谎报 challenge 的 choice 压回 easy；合法 challenge 保持 250；flags 去重为一条', async () => {
    const mixed = body({
      dateKey: d2,
      questions: [
        q({ key: 'a:q1', lessonId: 'a', qid: 'q1', type: 'choice', difficulty: 'challenge', source: 'local', lang: 'c', ok: true }),
        q({ key: 'b:q1', lessonId: 'b', qid: 'q1', type: 'codewrite', difficulty: 'challenge', source: 'local', lang: 'python', stage: 2, ok: true }),
        q({ key: 'c:q1', lessonId: 'c', qid: 'q1', type: 'choice', difficulty: 'hard', source: 'ai', lang: 'c', ok: true }),
        q({ key: 'd:q1', lessonId: 'd', qid: 'q1', type: 'choice', difficulty: 'easy', source: 'local', lang: 'c', ok: true }),
        q({ key: 'e:q1', lessonId: 'e', qid: 'q1', type: 'fill', difficulty: 'medium', source: 'local', lang: 'c', ok: false }),
      ],
    });
    const res = await settle(tokenA, mixed);
    expect(res.statusCode).toBe(200);
    const json = res.json();
    // 手算（难度分制，与语言无关）：easy 100×4（第 5 题答错计 0） + 合法 challenge 250 = 550；满点 650
    expect(json).toMatchObject({ correct: 4, total: 5, score: 550, scoreMax: 650 });
    expect(json.flags).toEqual(['difficulty_downgraded']);

    const rows = await ctx.raw.query<{ idx: number; difficulty: string; points: number }>(
      `SELECT idx, difficulty, points FROM challenge_questions
        WHERE account_id = $1 AND date_key = $2::date ORDER BY idx`,
      [idA, d2],
    );
    expect(rows.rows.map((r) => [r.difficulty, r.points])).toEqual([
      ['easy', 100], // challenge 谎报 → 压回 easy
      ['challenge', 250], // codewrite + local → 合法
      ['easy', 100], // hard 高报 → 压回 easy
      ['easy', 100], // 如实低报（easy）→ 保留
      ['easy', 0], // medium 高报且答错 → 压回 easy、0 分
    ]);

    // 跨日累加：d1 的 500 + d2 的 550（同日的 409 尝试一分没加）
    const st = await ctx.raw.query<{ total_score: number }>(
      `SELECT total_score FROM user_stats WHERE account_id = $1`,
      [idA],
    );
    expect(st.rows[0]!.total_score).toBe(1050);
  });
});

describe('历史查询 GET /v1/challenge/days', () => {
  it('默认窗口返回近 30 天：d1 在前 d2 在后，dateKey 归一为 YYYY-MM-DD', async () => {
    const res = await history(tokenA);
    expect(res.statusCode).toBe(200);
    const days = res.json().days as Array<{ dateKey: string; score: number; correct: number }>;
    expect(days.length).toBeGreaterThanOrEqual(2);
    expect(days[0]).toMatchObject({ dateKey: d1, score: 500, correct: 5 });
    expect(days[1]).toMatchObject({ dateKey: d2, score: 550, correct: 4 });
  });

  it('from/to/limit 过滤与校验：单日窗、limit=1、from>to=400、非法日期=400', async () => {
    const one = await history(tokenA, `?from=${d2}&to=${d2}`);
    expect(one.statusCode).toBe(200);
    expect((one.json().days as unknown[]).length).toBe(1);

    const lim = await history(tokenA, '?limit=1');
    expect(lim.statusCode).toBe(200);
    expect((lim.json().days as unknown[]).length).toBe(1);

    const bad = await history(tokenA, `?from=${d1}&to=${d2}`);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_FAILED');

    const badDate = await history(tokenA, '?to=2026-02-30');
    expect(badDate.statusCode).toBe(400);

    const badLimit = await history(tokenA, '?limit=91');
    expect(badLimit.statusCode).toBe(400);
  });
});

describe('形状校验（一律 400，且不落库）', () => {
  it('批内 key 重复 / startedAt > finishedAt / 假日期 全都 400', async () => {
    const dupKey = body({ dateKey: bjDay(-3) });
    dupKey.questions[1]!.key = dupKey.questions[0]!.key;
    const dupRes = await settle(tokenA, dupKey);
    expect(dupRes.statusCode).toBe(400);
    expect(dupRes.json().error.message).toMatch(/unique/);

    const inverted = body({
      dateKey: bjDay(-3),
      startedAt: new Date().toISOString(),
      finishedAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    expect((await settle(tokenA, inverted)).statusCode).toBe(400);

    expect((await settle(tokenA, body({ dateKey: '2026-02-30' }))).statusCode).toBe(400);

    const idx = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM challenge_days WHERE account_id = $1 AND date_key = $2::date`,
      [idA, bjDay(-3)],
    );
    expect(idx.rows[0]!.n).toBe(0); // 400 的批一律没落库
  });

  it('未知题型/越界 stage 走 zod → 400；未认证 → 401', async () => {
    const badType = body({ dateKey: bjDay(-3) });
    (badType.questions[0] as unknown as { type: string }).type = 'essay';
    expect((await settle(tokenA, badType)).statusCode).toBe(400);

    const badStage = body({ dateKey: bjDay(-3) });
    badStage.questions[0]!.stage = 4;
    expect((await settle(tokenA, badStage)).statusCode).toBe(400);

    const anon = await ctx.app.inject({
      method: 'POST',
      url: '/v1/challenge/days',
      payload: body({ dateKey: bjDay(-3) }),
    });
    expect(anon.statusCode).toBe(401);
    const anonGet = await ctx.app.inject({ method: 'GET', url: '/v1/challenge/days' });
    expect(anonGet.statusCode).toBe(401);
  });
});

describe('批长契约（2026-10-10 改版 v3：1..CHALLENGE_RUN_MAX=5000，20 题日上限取消）', () => {
  let tokenE = '';
  let idE = '';

  beforeAll(async () => {
    const e = await register(ctx.app, 'chal_e');
    tokenE = e.json().token as string;
    idE = e.json().account.id as string;
  });

  it('旧契约的反面：6 题合法（1..5000 全量接受）——6×easy/cpp 全对 = 600', async () => {
    const day = bjDay(-6);
    const res = await settle(tokenE, body({ dateKey: day, questions: nCppEasy(6) }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      settled: true,
      idempotent: false,
      correct: 6,
      total: 6,
      score: 600,
      scoreMax: 600,
    });
    const dayRow = await ctx.raw.query<{ total: number; score: number }>(
      `SELECT total, score FROM challenge_days WHERE account_id = $1 AND date_key = $2::date`,
      [idE, day],
    );
    expect(dayRow.rows[0]).toMatchObject({ total: 6, score: 600 });
  });

  it('20 题日上限已取消：100 题结算成功（100×100=10000），落库 100 行明细（>20 合法即证 0009 的 1..5000 生效）', async () => {
    const day = bjDay(-7);
    const res = await settle(tokenE, body({ dateKey: day, questions: nCppEasy(100) }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      settled: true,
      correct: 100,
      total: 100,
      score: 10000,
      scoreMax: 10000,
    });
    const rows = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM challenge_questions WHERE account_id = $1 AND date_key = $2::date`,
      [idE, day],
    );
    expect(rows.rows[0]!.n).toBe(100);
    const st = await ctx.raw.query<{ total_score: number }>(
      `SELECT total_score FROM user_stats WHERE account_id = $1`,
      [idE],
    );
    expect(st.rows[0]!.total_score).toBe(600 + 10000);
  });

  it('分批写明细：1001 题跨过 1000 行/批的边界，结算成功、明细 1001 行不丢不重（1001×100=100100）', async () => {
    // PG 单语句参数上限 65535：1001 题 × 13 参 ≈ 13013——本可单批，但路由把明细固定在 1000 行/批，
    // 第 1001 行落在第二批。行数不丢不重即分批循环（同事务）的验收。
    const day = bjDay(-17);
    const res = await settle(tokenE, body({ dateKey: day, questions: nCppEasy(1001) }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      settled: true,
      idempotent: false,
      correct: 1001,
      total: 1001,
      score: 100100,
      scoreMax: 100100,
    });
    const rows = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM challenge_questions WHERE account_id = $1 AND date_key = $2::date`,
      [idE, day],
    );
    expect(rows.rows[0]!.n).toBe(1001);
  });

  it('5001 题 → 400 VALIDATION_FAILED，不落库；≈750KB < 2MiB bodyLimit，400 来自 zod 而非 413', async () => {
    const day = bjDay(-8);
    const payload = body({ dateKey: day, questions: nCppEasy(5001) });
    // 尺子自检：这份 payload 必须小于路由 bodyLimit(2MiB)——否则 400 可能来自传输层 413、判据就变味了
    expect(JSON.stringify(payload).length).toBeLessThan(2 * 1024 * 1024);
    const res = await settle(tokenE, payload);
    expect(res.statusCode).toBe(400);
    const err = res.json().error;
    expect(err.code).toBe('VALIDATION_FAILED');
    // 实测钉住：>5000 是 zod 的 .max(5000) 先拦（通用文案）——路由里带 received 的显式检查
    // 是防御兜底（zod 若被放宽才轮到它）。这条断言哪天红了 = 拦截者换了，需自觉复核。
    expect(err.message).toContain('request validation failed');
    expect(String(err.message)).not.toMatch(/exactly/);
    const n = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM challenge_days WHERE account_id = $1 AND date_key = $2::date`,
      [idE, day],
    );
    expect(n.rows[0]!.n).toBe(0);
  });

  it('0 题 → 400（zod .min(1)），不落库', async () => {
    const day = bjDay(-9);
    const res = await settle(tokenE, body({ dateKey: day, questions: [] }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    const n = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM challenge_days WHERE account_id = $1 AND date_key = $2::date`,
      [idE, day],
    );
    expect(n.rows[0]!.n).toBe(0);
  });
});

describe('勾选语言 pickedLangs（2026-10-10 夜：排行榜「所选语言」列的数据源）', () => {
  let tokenF = '';
  let idF = '';

  beforeAll(async () => {
    const f = await register(ctx.app, 'chal_f');
    tokenF = f.json().token as string;
    idF = f.json().account.id as string;
  });

  it('显式 pickedLangs 落库并归一为 LANGS 声明序（发 ["java","c"] → 存 ["c","java"]）；历史往返带出', async () => {
    const day = bjDay(-10);
    const res = await settle(
      tokenF,
      body({ dateKey: day, questions: nCppEasy(2), pickedLangs: ['java', 'c'] }),
    );
    expect(res.statusCode).toBe(200);
    const row = await ctx.raw.query<{ picked_langs: string[] }>(
      `SELECT picked_langs FROM challenge_days WHERE account_id = $1 AND date_key = $2::date`,
      [idF, day],
    );
    expect(row.rows[0]!.picked_langs).toEqual(['c', 'java']); // 归一 = 声明序，不是上行序
    const his = await history(tokenF, `?from=${day}&to=${day}`);
    expect(his.statusCode).toBe(200);
    const d = (his.json().days as Array<{ pickedLangs: string[] }>)[0]!;
    expect(d.pickedLangs).toEqual(['c', 'java']);
  });

  it('核心语义：做题语言 ≠ 所选语言——题批全 C、只做了 C 题，但勾选含 Java，Java 照实留下', async () => {
    // 主人原例判据：显示的是「挑战选择」。任何「从题批 lang 反推」的实现都会在这里丢掉 Java。
    const day = bjDay(-11);
    const res = await settle(
      tokenF,
      body({
        dateKey: day,
        questions: [q({ key: 'c-stage1-01:q1', lang: 'c' })],
        pickedLangs: ['c', 'java'],
      }),
    );
    expect(res.statusCode).toBe(200);
    const row = await ctx.raw.query<{ picked_langs: string[] }>(
      `SELECT picked_langs FROM challenge_days WHERE account_id = $1 AND date_key = $2::date`,
      [idF, day],
    );
    expect(row.rows[0]!.picked_langs).toEqual(['c', 'java']);
  });

  it('缺省（legacy 客户端不带该字段）→ 从题批 lang 派生：∩ 四门、声明序；全 common 的批派生为空', async () => {
    const dayMix = bjDay(-12);
    const mix = await settle(
      tokenF,
      body({
        dateKey: dayMix,
        questions: [
          q({ key: 'c-stage1-01:qa', lang: 'python' }),
          q({ key: 'c-stage1-01:qb', lang: 'c' }),
        ],
      }),
    );
    expect(mix.statusCode).toBe(200);
    const rowMix = await ctx.raw.query<{ picked_langs: string[] }>(
      `SELECT picked_langs FROM challenge_days WHERE account_id = $1 AND date_key = $2::date`,
      [idF, dayMix],
    );
    expect(rowMix.rows[0]!.picked_langs).toEqual(['c', 'python']); // 派生也走声明序（非题批出现序）

    const dayCommon = bjDay(-13);
    const cm = await settle(
      tokenF,
      body({ dateKey: dayCommon, questions: [q({ key: 'c-stage1-01:qc', lang: 'common' })] }),
    );
    expect(cm.statusCode).toBe(200);
    const rowCommon = await ctx.raw.query<{ picked_langs: string[] }>(
      `SELECT picked_langs FROM challenge_days WHERE account_id = $1 AND date_key = $2::date`,
      [idF, dayCommon],
    );
    expect(rowCommon.rows[0]!.picked_langs).toEqual([]); // 全 common 派生出空（迁移注释里说明的合法空数组）
  });

  it('显式非法值一律 400 不落库：空数组 / 含 common / 未知语言 / 重复', async () => {
    const day = bjDay(-14);
    for (const bad of [[], ['common'], ['rust'], ['c', 'c']]) {
      const res = await settle(tokenF, body({ dateKey: day, pickedLangs: bad }));
      expect(res.statusCode, `pickedLangs=${JSON.stringify(bad)} 应当 400`).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    }
    const n = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM challenge_days WHERE account_id = $1 AND date_key = $2::date`,
      [idF, day],
    );
    expect(n.rows[0]!.n).toBe(0);
  });

  it('重放判定覆盖新字段：同 submissionId 同 pickedLangs → idempotent；换了 pickedLangs → 409 CHALLENGE_DUPLICATE', async () => {
    const day = bjDay(-15);
    // pickedLangs 显式给 ['java']，与题批（全 cpp）派生的 ['cpp'] 不同——首写就该存 java；
    // 若 payloadHash 不覆盖该字段，altered 与首写同 hash → 会误判 idempotent，本臂即红。
    const payload = body({ dateKey: day, pickedLangs: ['java'] });
    const first = await settle(tokenF, payload);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ idempotent: false });
    const replay = await settle(tokenF, payload);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ idempotent: true });
    const altered = await settle(tokenF, { ...payload, pickedLangs: ['cpp'] });
    expect(altered.statusCode).toBe(409);
    expect(altered.json().error.code).toBe('CHALLENGE_DUPLICATE');
    // 409 没有覆盖首写：库里仍是首写那版
    const row = await ctx.raw.query<{ picked_langs: string[] }>(
      `SELECT picked_langs FROM challenge_days WHERE account_id = $1 AND date_key = $2::date`,
      [idF, day],
    );
    expect(row.rows[0]!.picked_langs).toEqual(['java']);
  });
});

describe('结算窗口（A1 裁定 b：过去 ≤30 天 / 未来 ≤+DAY_KEY_WINDOW_DAYS=1 天）', () => {
  let tokenG = '';
  let idG = '';

  beforeAll(async () => {
    const g = await register(ctx.app, 'chal_g');
    tokenG = g.json().token as string;
    idG = g.json().account.id as string;
  });

  it('窗内两侧收：−30 与 +1（+1 是「客户端日超前服务器日」的合法载体：时钟略快/手动改日）', async () => {
    expect((await settle(tokenG, body({ dateKey: bjDay(-30) }))).statusCode).toBe(200);
    expect((await settle(tokenG, body({ dateKey: bjDay(1) }))).statusCode).toBe(200);
  });

  it('窗外两侧拒：−31 与 +2 → 400 VALIDATION_FAILED（带 settle window 文案），不落库', async () => {
    const past = await settle(tokenG, body({ dateKey: bjDay(-31) }));
    expect(past.statusCode).toBe(400);
    expect(past.json().error.code).toBe('VALIDATION_FAILED');
    expect(past.json().error.message).toMatch(/settle window/);
    const future = await settle(tokenG, body({ dateKey: bjDay(2) }));
    expect(future.statusCode).toBe(400);
    expect(future.json().error.message).toMatch(/settle window/);
    const n = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM challenge_days
        WHERE account_id = $1 AND date_key IN ($2::date, $3::date)`,
      [idG, bjDay(-31), bjDay(2)],
    );
    expect(n.rows[0]!.n).toBe(0);
  });

  it('历史默认窗口把「明天」捞进窗：默认 GET 首条 = bjDay(1)；−30 档走显式 from/to 仍能取回', async () => {
    const def = await history(tokenG);
    expect(def.statusCode).toBe(200);
    const days = def.json().days as Array<{ dateKey: string }>;
    expect(days[0]!.dateKey).toBe(bjDay(1)); // to 默认 = 服务器日 + 1，倒序首条即它
    // 默认窗口覆盖 [服务器日−29, 服务器日+1]——−30 档不在其中，要显式点名才拉得到（分页语义）
    expect(days.map((d) => d.dateKey)).not.toContain(bjDay(-30));
    const explicit = await history(tokenG, `?from=${bjDay(-30)}&to=${bjDay(1)}&limit=90`);
    expect(explicit.statusCode).toBe(200);
    const keys = (explicit.json().days as Array<{ dateKey: string }>).map((d) => d.dateKey);
    expect(keys).toContain(bjDay(-30));
    expect(keys).toContain(bjDay(1));
  });

  it('只给过去 to（历史翻页：下一页 to = 上一页最老日 − 1）→ 200 且窗口以 to 收尾', async () => {
    // 自备档位（-20，全库未用过的日子）：不借其它用例的结算，单跑本用例也成立
    const h = await register(ctx.app, 'chal_h');
    const tokenH = h.json().token as string;
    expect((await settle(tokenH, body({ dateKey: bjDay(-20) }))).statusCode).toBe(200);
    // ① 无档的过去日：批次前 200；本批中途 from 一律锚服务器日 → from > to → 400（对抗核验抓到的组合）
    expect((await history(tokenH, `?to=${bjDay(-35)}`)).statusCode).toBe(200);
    // ② 精确见证「窗口以 to 收尾」：to=-20 & limit=1 ⇒ 窗口恰 [-20,-20]，倒序首条 = to
    const exact = await history(tokenH, `?to=${bjDay(-20)}&limit=1`);
    expect(exact.statusCode).toBe(200);
    const days = exact.json().days as Array<{ dateKey: string }>;
    expect(days[0]!.dateKey).toBe(bjDay(-20));
  });
});

describe('限流（10 次/日/账号；幂等重放不计）', () => {
  // 相对日期而非硬编码：A1 结算窗口（过去 ≤30 天）落地后，旧常量 '2026-03-xx' 会被 400 拒。
  // −29..−20 全在窗内——本臂的 429 必须来自限流、不是窗口（两者都红时文案能区分）。
  const days = Array.from({ length: 10 }, (_, i) => bjDay(-29 + i));
  let firstBody: SettleBody;

  it('前 10 个不同日结算全 200；第 11 个 → 429 RATE_LIMITED', async () => {
    firstBody = body({ dateKey: days[0]! });
    const first = await settle(tokenC, firstBody);
    expect(first.statusCode).toBe(200);

    for (const day of days.slice(1)) {
      const res = await settle(tokenC, body({ dateKey: day }));
      expect(res.statusCode).toBe(200);
    }

    const eleventh = await settle(tokenC, body({ dateKey: bjDay(-19) }));
    expect(eleventh.statusCode).toBe(429);
    expect(eleventh.json().error.code).toBe('RATE_LIMITED');
    expect(eleventh.json().error.retryAfterMs).toBeGreaterThan(0);
  });

  it('额度耗尽后重放首个提交 → 仍 200 idempotent:true（快速路径先于取令牌）', async () => {
    const replay = await settle(tokenC, firstBody);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ idempotent: true, score: 500 });

    // 10 天 × 500 = 5000：第 11 个 429 与重放都没加一分
    const st = await ctx.raw.query<{ total_score: number }>(
      `SELECT total_score FROM user_stats WHERE account_id = $1`,
      [idC],
    );
    expect(st.rows[0]!.total_score).toBe(5000);
  });
});

describe('总分快路径的列作用域（INSERT 与 DO UPDATE 两条分支都只准碰 total_score）', () => {
  it('DO UPDATE 分支：预置四个非默认列 → 结算后逐列原样、总分精确累加', async () => {
    // tokenB 在 d1 已结算过 → 本臂走 ON CONFLICT DO UPDATE 分支（INSERT 分支已由主路径 d1 覆盖）
    await ctx.raw.query(
      `UPDATE user_stats
          SET learned_count = 77, practiced_count = 88, streak_days = 9, last_active_day = '2026-01-01'
        WHERE account_id = $1`,
      [idB],
    );

    const day = bjDay(-3);
    const res = await settle(tokenB, body({ dateKey: day }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ idempotent: false, score: 500 });

    const st = await ctx.raw.query<{
      learned_count: number;
      practiced_count: number;
      streak_days: number;
      last_active_day: string;
      total_score: number;
    }>(
      `SELECT learned_count, practiced_count, streak_days,
              to_char(last_active_day, 'YYYY-MM-DD') AS last_active_day, total_score
         FROM user_stats WHERE account_id = $1`,
      [idB],
    );
    expect(st.rows[0]).toEqual({
      learned_count: 77, // 被快路径顺手清成 0 即在此红（SET 列表膨胀的静默坏法）
      practiced_count: 88,
      streak_days: 9,
      last_active_day: '2026-01-01',
      total_score: 500 + 500,
    });
  });
});

describe('并发同日结算（唯一性由 PK + ON CONFLICT DO NOTHING + 败者分流共同承担）', () => {
  it('6 路并发（同日/同账号/不同 submissionId）：恰一个 200 settled、其余 409，落库恰一行、总分只加一次', async () => {
    // 为什么是 6 路不是 2 路：真 PG 上实测（`<workspace>/_race-probe.txt`，不随仓库分发）——2 路时败者基本都从
    // 预读快速路径早退，撞不进「INSERT 冲突后才分流」那条分支；4 路起稳定有人撞进
    // （把 DO NOTHING 种坏成 DO UPDATE 时，这些请求会以 500 暴露）。本臂要的正是
    // 覆盖那条分支，所以用 6 路把竞态窗口踩实。
    const day = bjDay(-4);
    const before = await ctx.raw.query<{ total_score: number }>(
      `SELECT total_score FROM user_stats WHERE account_id = $1`,
      [idB],
    );

    const results = await Promise.all(
      Array.from({ length: 6 }, () => settle(tokenB, body({ dateKey: day }))),
    );

    const statuses = results.map((r) => r.statusCode).sort((x, y) => x - y);
    expect(statuses).toEqual([200, 409, 409, 409, 409, 409]);
    const winners = results.filter((r) => r.statusCode === 200);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.json()).toMatchObject({ settled: true, idempotent: false, score: 500 });
    for (const loser of results.filter((r) => r.statusCode === 409)) {
      expect(loser.json().error.code).toBe('CHALLENGE_DUPLICATE');
    }

    const rows = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM challenge_days WHERE account_id = $1 AND date_key = $2::date`,
      [idB, day],
    );
    expect(rows.rows[0]!.n).toBe(1);
    const detail = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM challenge_questions WHERE account_id = $1 AND date_key = $2::date`,
      [idB, day],
    );
    expect(detail.rows[0]!.n).toBe(5); // 只有赢家的明细留了下来（败者整事务回滚）

    const after = await ctx.raw.query<{ total_score: number }>(
      `SELECT total_score FROM user_stats WHERE account_id = $1`,
      [idB],
    );
    expect(after.rows[0]!.total_score).toBe(before.rows[0]!.total_score + 500); // 加两次即在此红
  });
});

describe('结算窗拒单的审计日志（契约第 5 项：log.warn 是这条拒单唯一的审计痕）', () => {
  it('超窗 → 400，且 logger 收到带 accountId/dateKey/dayOffset 的 warn', async () => {
    // 独立 ctx：logger 在 buildApp 时注入，共享 ctx 的 app 装不上（见 helpers/app.ts 的 logger 选项）
    const lines: string[] = [];
    const wctx = await createTestContext({
      rateLimits: HIGH_LIMITS,
      logger: { level: 'warn', stream: { write: (line: string) => void lines.push(line) } },
    });
    try {
      const reg = await register(wctx.app, 'chal_warn');
      const token = reg.json().token as string;
      const id = reg.json().account.id as string;
      const res = await wctx.app.inject({
        method: 'POST',
        url: '/v1/challenge/days',
        headers: bearer(token),
        payload: body({ dateKey: bjDay(-31) }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toMatch(/settle window/);
      const hit = lines
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .find((x) => x.msg === 'challenge settle dateKey out of the allowed window');
      expect(hit, '超窗拒单必须留下 warn 审计痕（这行删掉 = 伪造/病态时钟拒单在日志里静默消失）').toBeDefined();
      expect(hit!.accountId).toBe(id);
      expect(hit!.dateKey).toBe(bjDay(-31));
      expect(hit!.dayOffset).toBe(-31);
    } finally {
      await wctx.raw.close();
    }
  });
});
