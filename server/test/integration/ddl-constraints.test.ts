/**
 * DDL 约束集成测试（真实 PGlite，逐条种坏值）：
 * 每个用例先让坏值真炸（没炸 = 判据自身失效，立即失败），再断言：
 *  - PGlite 错误的 .code/.constraint 原始字段（供 pg 生产路径同构）；
 *  - mapDatabaseError 的分流结果（23514 体积硬顶 → 413，其余 → 400；23505 用户名键 → 409，其余 → 500）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mapDatabaseError } from '../../src/lib/errors.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';

interface DbErrorSurface {
  code?: string;
  constraint?: string;
  message: string;
}

async function dbError(fn: () => Promise<unknown>): Promise<DbErrorSurface> {
  let captured: unknown = null;
  try {
    await fn();
  } catch (err) {
    captured = err;
  }
  if (captured === null) {
    throw new Error('种坏值没有触发数据库报错——判据失效，测试作废');
  }
  const e = captured as { code?: unknown; constraint?: unknown; message?: unknown };
  return {
    ...(typeof e.code === 'string' ? { code: e.code } : {}),
    ...(typeof e.constraint === 'string' ? { constraint: e.constraint } : {}),
    message: typeof e.message === 'string' ? e.message : String(captured),
  };
}

let ctx: TestDatabase;
let userId: string;

beforeAll(async () => {
  ctx = await createTestDatabase();
  const { rows } = await ctx.raw.query<{ id: string }>(
    `INSERT INTO users (username, username_lower, password_hash)
     VALUES ('harness', 'harness', '$argon2id$fake')
     RETURNING id`,
  );
  userId = rows[0]!.id;
});

afterAll(async () => {
  await ctx.raw.close();
});

describe('users 约束', () => {
  it('用户名不合规 → 23514 users_username_format → VALIDATION_FAILED(400)；1 位 / 数字开头各一', async () => {
    // 0012 放宽后 'ab' 已合法（2~30 位）——旧种坏值换了两个仍非法的形状
    const tooShort = await dbError(() =>
      ctx.raw.query(`INSERT INTO users (username, username_lower, password_hash) VALUES ('a', 'a', 'x')`),
    );
    expect(tooShort.code).toBe('23514');
    expect(tooShort.constraint).toBe('users_username_format');
    expect(mapDatabaseError(tooShort)?.code).toBe('VALIDATION_FAILED');

    const digitLead = await dbError(() =>
      ctx.raw.query(`INSERT INTO users (username, username_lower, password_hash) VALUES ('1ab', '1ab', 'x')`),
    );
    expect(digitLead.code).toBe('23514');
    expect(digitLead.constraint).toBe('users_username_format');
    expect(mapDatabaseError(digitLead)?.code).toBe('VALIDATION_FAILED');
  });

  it('2026-10-13 放宽正例：中文用户名 / 2 位英文 / 30 位极限 → 落库成功（新旧边界两侧）', async () => {
    await ctx.raw.query(
      `INSERT INTO users (username, username_lower, password_hash) VALUES ('小明', '小明', 'x')`,
    );
    await ctx.raw.query(
      `INSERT INTO users (username, username_lower, password_hash) VALUES ('ab', 'ab', 'x')`,
    );
    await ctx.raw.query(
      `INSERT INTO users (username, username_lower, password_hash) VALUES ('${'a'.repeat(30)}', '${'a'.repeat(30)}', 'x')`,
    );
    const { rows } = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM users WHERE username_lower IN ('小明', 'ab', '${'a'.repeat(30)}')`,
    );
    expect(rows[0]!.n).toBe(3);
  });

  it('31 位超长仍是坏值 → users_username_format（上限侧边界）', async () => {
    const err = await dbError(() =>
      ctx.raw.query(
        `INSERT INTO users (username, username_lower, password_hash) VALUES ('${'b'.repeat(31)}', '${'b'.repeat(31)}', 'x')`,
      ),
    );
    expect(err.code).toBe('23514');
    expect(err.constraint).toBe('users_username_format');
  });

  it('安全问答半截行（有问题无答案哈希）→ users_security_qa_pair → VALIDATION_FAILED', async () => {
    const err = await dbError(() =>
      ctx.raw.query(
        `INSERT INTO users (username, username_lower, password_hash, security_question)
         VALUES ('halfqa', 'halfqa', 'x', '你的第一只宠物叫什么？')`,
      ),
    );
    expect(err.code).toBe('23514');
    expect(err.constraint).toBe('users_security_qa_pair');
    expect(mapDatabaseError(err)?.code).toBe('VALIDATION_FAILED');

    // 成对写入合法（正对照）——放最后，避免污染上面 count 用例
    await ctx.raw.query(
      `INSERT INTO users (username, username_lower, password_hash, security_question, security_answer_hash)
       VALUES ('fullqa', 'fullqa', 'x', '你的第一只宠物叫什么？', '$argon2id$fake')`,
    );
  });

  it('注入形态用户名也被格式约束拦下，且 users 表完好（正对照）', async () => {
    const err = await dbError(() =>
      ctx.raw.query(
        `INSERT INTO users (username, username_lower, password_hash) VALUES ($1, $2, 'x')`,
        ["x'; DROP TABLE users; --", "x'; drop table users; --"],
      ),
    );
    expect(err.code).toBe('23514');
    expect(err.constraint).toBe('users_username_format');

    // 表完好判据：harness 行仍在（用具体行而不是全表 count——放宽正例在同 describe 里
    // 会合法增行，全表 count 会让本判据随邻居用例漂移）
    const { rows } = await ctx.raw.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM users WHERE username_lower = 'harness'`,
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('大小写归一撞键 → 23505 users_username_lower_key → USERNAME_TAKEN(409)', async () => {
    await ctx.raw.query(
      `INSERT INTO users (username, username_lower, password_hash) VALUES ('Ghost', 'ghost', 'x')`,
    );
    const err = await dbError(() =>
      ctx.raw.query(
        `INSERT INTO users (username, username_lower, password_hash) VALUES ('GHOST', 'ghost', 'x')`,
      ),
    );
    expect(err.code).toBe('23505');
    expect(err.constraint).toBe('users_username_lower_key');
    expect(mapDatabaseError(err)?.code).toBe('USERNAME_TAKEN');
  });
});

describe('user_docs 约束', () => {
  it('revision=0 → user_docs_revision_positive → VALIDATION_FAILED', async () => {
    const err = await dbError(() =>
      ctx.raw.query(
        `INSERT INTO user_docs (account_id, doc_type, revision, doc_ver, payload) VALUES ($1, 'profile', 0, 1, '{}'::jsonb)`,
        [userId],
      ),
    );
    expect(err.code).toBe('23514');
    expect(err.constraint).toBe('user_docs_revision_positive');
    expect(mapDatabaseError(err)?.code).toBe('VALIDATION_FAILED');
  });

  it('doc_ver=0 → user_docs_doc_ver_positive → VALIDATION_FAILED', async () => {
    const err = await dbError(() =>
      ctx.raw.query(
        `INSERT INTO user_docs (account_id, doc_type, revision, doc_ver, payload) VALUES ($1, 'profile', 1, 0, '{}'::jsonb)`,
        [userId],
      ),
    );
    expect(err.constraint).toBe('user_docs_doc_ver_positive');
    expect(mapDatabaseError(err)?.code).toBe('VALIDATION_FAILED');
  });

  it('doc_type 不在枚举 → user_docs_doc_type_allowed → VALIDATION_FAILED', async () => {
    const err = await dbError(() =>
      ctx.raw.query(
        `INSERT INTO user_docs (account_id, doc_type, revision, doc_ver, payload) VALUES ($1, 'nope', 1, 1, '{}'::jsonb)`,
        [userId],
      ),
    );
    expect(err.constraint).toBe('user_docs_doc_type_allowed');
    expect(mapDatabaseError(err)?.code).toBe('VALIDATION_FAILED');
  });

  it('payload 非对象（数组）→ user_docs_payload_is_object → VALIDATION_FAILED', async () => {
    const err = await dbError(() =>
      ctx.raw.query(
        `INSERT INTO user_docs (account_id, doc_type, revision, doc_ver, payload) VALUES ($1, 'profile', 1, 1, '[]'::jsonb)`,
        [userId],
      ),
    );
    expect(err.constraint).toBe('user_docs_payload_is_object');
    expect(mapDatabaseError(err)?.code).toBe('VALIDATION_FAILED');
  });

  it('payload 超 10MiB 硬顶 → user_docs_payload_size → PAYLOAD_TOO_LARGE(413)', async () => {
    const err = await dbError(() =>
      ctx.raw.query(
        `INSERT INTO user_docs (account_id, doc_type, revision, doc_ver, payload)
         VALUES ($1, 'practice', 1, 1, jsonb_build_object('pad', repeat('x', 10485760 + 512)))`,
        [userId],
      ),
    );
    expect(err.code).toBe('23514');
    expect(err.constraint).toBe('user_docs_payload_size');
    const mapped = mapDatabaseError(err);
    expect(mapped?.code).toBe('PAYLOAD_TOO_LARGE');
    expect(mapped?.message).toContain('10 MiB');
  });

  it('合法行写入成功；同账号同类型再插 → 23505 主键 → INTERNAL(500)', async () => {
    await ctx.raw.query(
      `INSERT INTO user_docs (account_id, doc_type, revision, doc_ver, payload) VALUES ($1, 'profile', 1, 1, '{"ok": true}'::jsonb)`,
      [userId],
    );
    const err = await dbError(() =>
      ctx.raw.query(
        `INSERT INTO user_docs (account_id, doc_type, revision, doc_ver, payload) VALUES ($1, 'profile', 1, 1, '{}'::jsonb)`,
        [userId],
      ),
    );
    expect(err.code).toBe('23505');
    expect(err.constraint).toBe('user_docs_pkey');
    expect(mapDatabaseError(err)?.code).toBe('INTERNAL');
  });

  it('引用不存在的账号 → 23503 → VALIDATION_FAILED（不泄露内部细节）', async () => {
    const err = await dbError(() =>
      ctx.raw.query(
        `INSERT INTO user_docs (account_id, doc_type, revision, doc_ver, payload)
         VALUES ('00000000-0000-4000-8000-000000000000', 'profile', 1, 1, '{}'::jsonb)`,
      ),
    );
    expect(err.code).toBe('23503');
    expect(mapDatabaseError(err)?.code).toBe('VALIDATION_FAILED');
  });
});

describe('sessions / auth_audit 约束', () => {
  it('revoked_reason 不在白名单 → sessions_revoked_reason_allowed → VALIDATION_FAILED', async () => {
    const err = await dbError(() =>
      ctx.raw.query(
        `INSERT INTO sessions (account_id, token_hash, created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_reason)
         VALUES ($1, 'hash-x', now(), now(), now() + interval '1 day', now() + interval '2 days', 'bogus')`,
        [userId],
      ),
    );
    expect(err.code).toBe('23514');
    expect(err.constraint).toBe('sessions_revoked_reason_allowed');
    expect(mapDatabaseError(err)?.code).toBe('VALIDATION_FAILED');
  });

  it('audit 事件不在枚举 → auth_audit_event_allowed → VALIDATION_FAILED', async () => {
    const err = await dbError(() =>
      ctx.raw.query(`INSERT INTO auth_audit (event) VALUES ('hacked')`),
    );
    expect(err.code).toBe('23514');
    expect(err.constraint).toBe('auth_audit_event_allowed');
    expect(mapDatabaseError(err)?.code).toBe('VALIDATION_FAILED');
  });
});

describe('challenge_days 批长约束（0009：total 由 1..20 放宽到 1..5000，约束名不变）', () => {
  const insertDay = (dateKey: string, total: number) =>
    ctx.raw.query(
      `INSERT INTO challenge_days (account_id, date_key, install_id, source, finished_at,
         correct, total, score, score_max, submission_id, payload_sha256)
       VALUES ($1, $2::date, '11111111-1111-4111-8111-111111111111', 'local', now(),
         0, $3, 0, 0, '22222222-2222-4222-8222-222222222222', 'sha')`,
      [userId, dateKey, total],
    );

  it('total=5001 → 23514 challenge_days_total_check（旧 CHECK 1..20 会在 21 就炸）', async () => {
    const err = await dbError(() => insertDay('2026-07-01', 5001));
    expect(err.code).toBe('23514');
    expect(err.constraint).toBe('challenge_days_total_check');
    expect(mapDatabaseError(err)?.code).toBe('VALIDATION_FAILED');
  });

  it('边界两侧：total=5000 与 total=1 都合法落库（正对照）；total=0 → 23514', async () => {
    await insertDay('2026-07-02', 5000);
    await insertDay('2026-07-03', 1);
    const { rows } = await ctx.raw.query<{ total: number }>(
      `SELECT total FROM challenge_days
        WHERE account_id = $1 AND date_key BETWEEN '2026-07-02' AND '2026-07-03'
        ORDER BY date_key`,
      [userId],
    );
    expect(rows.map((r) => r.total)).toEqual([5000, 1]);

    const err = await dbError(() => insertDay('2026-07-04', 0));
    expect(err.constraint).toBe('challenge_days_total_check');
  });
});

describe('leaderboard_snapshots 期枚举（0008：daily/weekly/monthly/yearly；alltime 一律不进表）', () => {
  const insertSnap = (period: string, periodKey: string) =>
    ctx.raw.query(
      `INSERT INTO leaderboard_snapshots (period, period_key, account_id, score, rank)
       VALUES ($1, $2, $3, 100, 1)`,
      [period, periodKey, userId],
    );

  it('monthly/yearly 合法（0008 之前的旧 CHECK 只认 daily/weekly）', async () => {
    await insertSnap('monthly', '2026-10');
    await insertSnap('yearly', '2026');
    const { rows } = await ctx.raw.query<{ period: string }>(
      `SELECT period FROM leaderboard_snapshots WHERE account_id = $1 ORDER BY period`,
      [userId],
    );
    expect(rows.map((r) => r.period)).toEqual(['monthly', 'yearly']);
  });

  it('枚举外（biweekly / alltime）→ 23514 leaderboard_snapshots_period_check', async () => {
    const err = await dbError(() => insertSnap('biweekly', '2026-W40'));
    expect(err.code).toBe('23514');
    expect(err.constraint).toBe('leaderboard_snapshots_period_check');
    expect(mapDatabaseError(err)?.code).toBe('VALIDATION_FAILED');

    // alltime 是实算口径、查无此表行：写进快照表必须照样被拦（不是「没约束所以能写」）
    const alltime = await dbError(() => insertSnap('alltime', 'n/a'));
    expect(alltime.constraint).toBe('leaderboard_snapshots_period_check');
  });
});

describe('challenge_days.picked_langs 值域约束（0010：子集四门 + 基数 ≤4；空数组为兼容而留）', () => {
  const insertDayWithPicked = (dateKey: string, picked: string[]) =>
    ctx.raw.query(
      `INSERT INTO challenge_days (account_id, date_key, install_id, source, finished_at,
         correct, total, score, score_max, submission_id, payload_sha256, picked_langs)
       VALUES ($1, $2::date, '11111111-1111-4111-8111-111111111111', 'local', now(),
         0, 1, 0, 0, '33333333-3333-4333-8333-333333333333', 'sha', $3::text[])`,
      [userId, dateKey, picked],
    );

  it('合法边界：空数组（迁移 DEFAULT 的旧档形态）/ 单门 / 四门全给', async () => {
    await insertDayWithPicked('2026-07-05', []);
    await insertDayWithPicked('2026-07-06', ['c']);
    await insertDayWithPicked('2026-07-07', ['c', 'cpp', 'java', 'python']);
    const { rows } = await ctx.raw.query<{ picked_langs: string[] }>(
      `SELECT picked_langs FROM challenge_days
        WHERE account_id = $1 AND date_key BETWEEN '2026-07-05' AND '2026-07-07'
        ORDER BY date_key`,
      [userId],
    );
    expect(rows.map((r) => r.picked_langs)).toEqual([[], ['c'], ['c', 'cpp', 'java', 'python']]);
  });

  it('含 common → 23514 challenge_days_picked_langs_check → VALIDATION_FAILED', async () => {
    // 应用层 400 拦一层；直写 DB 绕过它时 CHECK 是第二层（本臂专测第二层）
    const err = await dbError(() => insertDayWithPicked('2026-07-08', ['common']));
    expect(err.code).toBe('23514');
    expect(err.constraint).toBe('challenge_days_picked_langs_check');
    expect(mapDatabaseError(err)?.code).toBe('VALIDATION_FAILED');
  });

  it('未知语言（rust）→ 23514 同名约束（不是「任意字符串都能塞」）', async () => {
    const err = await dbError(() => insertDayWithPicked('2026-07-09', ['rust']));
    expect(err.code).toBe('23514');
    expect(err.constraint).toBe('challenge_days_picked_langs_check');
  });

  it('基数 5（含重复）→ 23514 同名约束（≤4 封住伪造面；≤4 内的重复由应用层 zod 拒）', async () => {
    const err = await dbError(() =>
      insertDayWithPicked('2026-07-10', ['c', 'cpp', 'java', 'python', 'c']),
    );
    expect(err.code).toBe('23514');
    expect(err.constraint).toBe('challenge_days_picked_langs_check');
  });
});
