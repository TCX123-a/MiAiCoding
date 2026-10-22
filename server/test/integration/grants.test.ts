/**
 * docs/22 §4.6 双角色 GRANT 回归（安全审查 F3）：
 * 生产部署顺序 = 先建角色 → 后跑迁移（GRANT 守卫式执行）。本测试复刻该顺序，
 * 并在 miai_app 角色下调权限：
 *   ① schema_migrations 可 SELECT（0002 修复点；此前 42501 → /v1/health 的 schemaVer 恒 0）；
 *   ② 既有四表 + 0003~0006 新表 SELECT/INSERT 可用，序列 USAGE 可用
 *      （auth_audit 与 rice_ledger 的 identity 序列各验一条）；
 *   ③ 尺子自检（必红负例）：miai_app 无 DDL——CREATE TABLE 必须 42501。
 *      若 SET ROLE 静默未生效，此负例会红 → 证明 ①② 的绿确实发生在 miai_app 身份下。
 */
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { loadMigrationFiles, runMigrations } from '../../src/db/migrate.js';
import { migrationDbFromPglite } from '../helpers/db.js';

describe('双角色 GRANT（F3：schema_migrations 可读 + 角色隔离自检）', () => {
  it('先建角色后跑迁移：miai_app 可读 schema_migrations 与全部业务表，且无 DDL 权限', async () => {
    const pglite = new PGlite();
    await pglite.waitReady;
    await pglite.exec('CREATE ROLE miai_app NOLOGIN');

    const result = await runMigrations(migrationDbFromPglite(pglite));
    expect(result.applied).toContain('0001_init');
    expect(result.applied).toContain('0002_grant_schema_migrations');
    expect(result.applied).toContain('0006_rice');
    expect(result.applied).toContain('0007_challenge_run_max');
    expect(result.applied).toContain('0008_leaderboard_periods');
    expect(result.applied).toContain('0009_challenge_total_5000');
    expect(result.applied).toContain('0010_challenge_picked_langs');
    expect(result.applied).toContain('0011_rice_checkin_kind');
    expect(result.applied).toContain('0012_security_qa_and_username');

    await pglite.exec('SET ROLE miai_app');

    // ① F3 核心：schema_migrations 可读（修复前：42501 permission denied），且版本与迁移集同步。
    // 期望值从迁移目录现场推导，不写死版本号（防新增迁移时静默漂移；真 PG 孪生文件曾漏改钉死在 10）。
    const expectedVer = Math.max(...(await loadMigrationFiles()).map((f) => f.version));
    const max = await pglite.query<{ v: number | string | null }>(
      'SELECT MAX(version) AS v FROM schema_migrations',
    );
    expect(Number(max.rows[0]!.v)).toBe(expectedVer);

    // ② 既有四表 DML：users 直插 + auth_audit（后者触 identity 序列 → 验证序列 USAGE）
    const user = await pglite.query<{ id: string }>(
      `INSERT INTO users (username, username_lower, password_hash)
       VALUES ('grantuser', 'grantuser', 'x') RETURNING id`,
    );
    const accountId = user.rows[0]!.id;
    await pglite.query(`INSERT INTO auth_audit (event, username) VALUES ('register', 'grantuser')`);
    const audit = await pglite.query<{ n: number }>('SELECT count(*)::int AS n FROM auth_audit');
    expect(audit.rows[0]!.n).toBe(1);

    // ②-b 0003~0006 新表 DML（每一张都要真的写进去；rices 的 identity 序列同样验 USAGE）
    await pglite.query(
      `INSERT INTO user_docs (account_id, doc_type, revision, doc_ver, payload)
       VALUES ($1, 'challenge', 1, 1, '{}'::jsonb)`,
      [accountId],
    );
    await pglite.query(
      `INSERT INTO challenge_days (account_id, date_key, install_id, source, finished_at,
         correct, total, score, score_max, submission_id, payload_sha256, picked_langs)
       VALUES ($1, '2026-10-08', '11111111-1111-4111-8111-111111111111', 'local', now(),
         1, 5, 100, 748, '22222222-2222-4222-8222-222222222222', 'sha', '{"c"}')`,
      [accountId],
    );
    await pglite.query(
      `INSERT INTO challenge_questions (account_id, date_key, idx, question_key, lesson_id, qid,
         lang, stage, qtype, difficulty, source, ok, points)
       VALUES ($1, '2026-10-08', 0, 'm1:q1', 'm1', 'q1', 'common', 0, 'choice', 'easy', 'local', true, 100)`,
      [accountId],
    );
    await pglite.query(`INSERT INTO user_days (account_id, day_key) VALUES ($1, '2026-10-08')`, [accountId]);
    await pglite.query(`INSERT INTO user_stats (account_id) VALUES ($1)`, [accountId]);
    await pglite.query(
      `INSERT INTO leaderboard_snapshots (period, period_key, account_id, score, rank)
       VALUES ('daily', '2026-10-08', $1, 100, 1)`,
      [accountId],
    );
    const ledger = await pglite.query<{ seq: number | string }>(
      `INSERT INTO rice_ledger (account_id, entry_key, kind, delta, day_key, at)
       VALUES ($1, 'install:1', 'lesson', 2, '2026-10-08', now()) RETURNING seq`,
      [accountId],
    );
    expect(Number(ledger.rows[0]!.seq)).toBeGreaterThan(0); // rice_ledger identity 序列 USAGE 生效
    await pglite.query(`INSERT INTO rice_balances (account_id, balance) VALUES ($1, 2)`, [accountId]);

    // ③ 尺子自检：miai_app 必须无 DDL 权限（负例必红，证明确实以 miai_app 身份在跑）
    await expect(pglite.exec('CREATE TABLE ddl_should_fail (id int)')).rejects.toThrow(
      /42501|permission denied/i,
    );

    await pglite.exec('RESET ROLE');
    await pglite.close();
  });
});
