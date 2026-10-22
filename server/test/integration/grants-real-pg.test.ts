/**
 * 真 PG 双轨专项：docs/22 §4.6 双角色 GRANT 在**真 PostgreSQL** 上的闭环。
 * 只在 MIAI_TEST_PG 设置时运行（否则整包显式 skipped，不伪装成通过）。
 *
 * 为什么 PGlite 版（grants.test.ts）还不够：PGlite 只近似权限语义。真 PG 才能证明
 * 「先建角色 → 后跑迁移」的生产部署顺序下 GRANT 真的落到 ACL 上。本测试覆盖：
 *   ① schema_migrations 可 SELECT（0002 修复点；此前 42501 → /v1/health schemaVer 恒 0）；
 *   ② miai_app 身份下全表 DML（users/sessions/user_docs/auth_audit/challenge 两表/
 *      user_days/user_stats/leaderboard_snapshots/rice 两表）+ 两个 identity 序列 USAGE；
 *   ③ 尺子自检（必红负例 + 正对照）：miai_app 无 DDL——CREATE TABLE 必须 42501；
 *      同连接 RESET ROLE 后同样的 CREATE TABLE 必须成功 → 证明 42501 是角色权限，
 *      不是环境本身坏（否则 ①② 的绿没有意义）。
 * 角色是集群级对象：用 DO/EXCEPTION 幂等创建并**故意留着**（本地沙箱集群；删除会破坏
 * 其它并行文件迁移时 GRANT 守卫的判定）。诚实注记：角色留在集群 ⇒ 热集群上本文件跑的
 * 是**复用分支**；「先建角色」的创建分支只在冷集群首跑被真覆盖——建后有 count 自证，
 * 防「创建静默失败 → GRANT 守卫跟着跳过 → 却依旧全绿」。
 * 只动 test/**。
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrationFiles } from '../../src/db/migrate.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';

const pgMode = process.env.MIAI_TEST_PG !== undefined;

describe.runIf(pgMode)('真 PG 双角色 GRANT（F3 闭环 + 角色隔离自检）', () => {
  let database: TestDatabase;
  let client: pg.Client;

  beforeAll(async () => {
    database = await createTestDatabase({
      beforeMigrate: async (m) => {
        // 生产部署顺序：先建角色（幂等），再跑迁移 → 守卫式 GRANT 才会执行。
        // 幂等要吞两类错：串行复跑撞 duplicate_object(42710)；两进程并发首建时，
        // 败者在 pg_authid 唯一索引上撞 unique_violation(23505)。
        await m.exec(
          `DO $$ BEGIN CREATE ROLE miai_owner LOGIN; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$`,
        );
        await m.exec(
          `DO $$ BEGIN CREATE ROLE miai_app NOLOGIN; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$`,
        );
        // 建完自证：两个角色真在（防「创建被静默吞掉、GRANT 守卫跟着跳过、测试却全绿」）
        const roles = await m.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('miai_owner', 'miai_app')`,
        );
        expect(roles.rows[0]!.n).toBe(2);
      },
    });
    client = new pg.Client({ connectionString: database.pgUrl });
    await client.connect();
  }, 60_000);

  afterAll(async () => {
    await client?.end().catch(() => {});
    await database?.raw.close();
  });

  it('miai_app 可读 schema_migrations 与全部业务表，且无 DDL 权限（负例+对照自检）', async () => {
    await client.query('SET ROLE miai_app');
    const who = await client.query<{ u: string }>('SELECT current_user AS u');
    expect(who.rows[0]!.u).toBe('miai_app');

    // ① F3 核心：schema_migrations 可读（修复前 42501），且版本与迁移集同步。
    // 期望值从迁移目录现场推导，不写死版本号——写死的常数会在新增迁移时静默漂移
    // （2026-10-13 账号批加 0011/0012 后本行还钉在 10，PGlite 孪生文件改了、这里漏改；
    //  PGlite 轨跑不到本文件 ⇒ 默认 npm test 全绿，真 PG 轨一跑即红。2026-10-14 QA 修复。）
    const expectedVer = Math.max(...(await loadMigrationFiles()).map((f) => f.version));
    const max = await client.query<{ v: number | string | null }>(
      'SELECT MAX(version) AS v FROM schema_migrations',
    );
    expect(Number(max.rows[0]!.v)).toBe(expectedVer);

    // ② 既有四表 DML：users / sessions / auth_audit（identity 序列 USAGE）/ user_docs
    const user = await client.query<{ id: string }>(
      `INSERT INTO users (username, username_lower, password_hash)
       VALUES ('grantuser', 'grantuser', 'x') RETURNING id`,
    );
    const accountId = user.rows[0]!.id;
    await client.query(
      `INSERT INTO sessions (account_id, token_hash, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
       VALUES ($1, 'sha-of-token', now(), now(), now() + interval '1 hour', now() + interval '1 day')`,
      [accountId],
    );
    await client.query(`INSERT INTO auth_audit (event, username) VALUES ('register', 'grantuser')`);
    const audit = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM auth_audit');
    expect(audit.rows[0]!.n).toBe(1);
    await client.query(
      `INSERT INTO user_docs (account_id, doc_type, revision, doc_ver, payload)
       VALUES ($1, 'challenge', 1, 1, '{}'::jsonb)`,
      [accountId],
    );

    // ②-b 0003~0006 新表 DML（每一张都要真的写进去；rice_ledger 的 identity 序列同样验 USAGE）
    await client.query(
      `INSERT INTO challenge_days (account_id, date_key, install_id, source, finished_at,
         correct, total, score, score_max, submission_id, payload_sha256, picked_langs)
       VALUES ($1, '2026-10-08', '11111111-1111-4111-8111-111111111111', 'local', now(),
         1, 5, 100, 748, '22222222-2222-4222-8222-222222222222', 'sha', '{"c"}')`,
      [accountId],
    );
    await client.query(
      `INSERT INTO challenge_questions (account_id, date_key, idx, question_key, lesson_id, qid,
         lang, stage, qtype, difficulty, source, ok, points)
       VALUES ($1, '2026-10-08', 0, 'm1:q1', 'm1', 'q1', 'common', 0, 'choice', 'easy', 'local', true, 100)`,
      [accountId],
    );
    await client.query(`INSERT INTO user_days (account_id, day_key) VALUES ($1, '2026-10-08')`, [accountId]);
    await client.query(`INSERT INTO user_stats (account_id) VALUES ($1)`, [accountId]);
    await client.query(
      `INSERT INTO leaderboard_snapshots (period, period_key, account_id, score, rank)
       VALUES ('daily', '2026-10-08', $1, 100, 1)`,
      [accountId],
    );
    const ledger = await client.query<{ seq: number | string }>(
      `INSERT INTO rice_ledger (account_id, entry_key, kind, delta, day_key, at)
       VALUES ($1, 'install:1', 'lesson', 2, '2026-10-08', now()) RETURNING seq`,
      [accountId],
    );
    expect(Number(ledger.rows[0]!.seq)).toBeGreaterThan(0); // rice_ledger identity 序列 USAGE 生效
    await client.query(`INSERT INTO rice_balances (account_id, balance) VALUES ($1, 2)`, [accountId]);

    // ②-c UPDATE / DELETE 也验（ACL 按动作授予；PGlite 版只覆盖了 INSERT/SELECT）
    await client.query(`UPDATE rice_balances SET balance = balance + 1 WHERE account_id = $1`, [accountId]);
    const balance = await client.query<{ b: number }>(
      'SELECT balance AS b FROM rice_balances WHERE account_id = $1',
      [accountId],
    );
    expect(balance.rows[0]!.b).toBe(3);
    await client.query(`DELETE FROM rice_ledger WHERE account_id = $1`, [accountId]);
    const left = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM rice_ledger');
    expect(left.rows[0]!.n).toBe(0);

    // ③ 尺子自检：miai_app 必须无 DDL 权限（负例必红，证明确实以 miai_app 身份在跑）
    await expect(client.query('CREATE TABLE ddl_should_fail (id int)')).rejects.toMatchObject({
      code: '42501',
    });

    // ③-b 正对照：RESET ROLE 后同样的 DDL 必须成功——42501 是权限，不是环境坏
    await client.query('RESET ROLE');
    await client.query('CREATE TABLE ddl_ok_after_reset (id int)');
  });
});
