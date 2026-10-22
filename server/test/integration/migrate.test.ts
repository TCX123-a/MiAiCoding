/**
 * 迁移 runner 集成测试（真实 PGlite 执行，非 mock）：
 *  - 真实 migrations/ 应用 + 幂等重跑 + 校验和记账与文件字节一致；
 *  - 已应用文件被改动 → 校验和漂移拒绝；
 *  - 多文件按版本顺序应用；
 *  - 坏文件整份回滚：不记账、副作用不存在（种坏值必须真炸，否则判据失效）；
 *  - 版本号重复 / 文件名不合规 → 装载期拒绝。
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMigrationFiles, MIGRATIONS_DIR, runMigrations } from '../../src/db/migrate.js';
import { migrationDbFromPglite } from '../helpers/db.js';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');

const tempDirs: string[] = [];
afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'miai-migrate-'));
  tempDirs.push(dir);
  return dir;
}

async function freshDb(): Promise<{ pglite: PGlite; run: ReturnType<typeof migrationDbFromPglite> }> {
  const pglite = new PGlite();
  await pglite.waitReady;
  return { pglite, run: migrationDbFromPglite(pglite) };
}

describe('迁移 runner（真实 PGlite）', () => {
  it('应用真实 migrations/ → currentVersion=13、记账 checksum 与文件字节一致；重跑幂等', async () => {
    const { pglite, run } = await freshDb();
    const first = await runMigrations(run);
    expect(first.applied).toEqual([
      '0001_init',
      '0002_grant_schema_migrations',
      '0003_challenge',
      '0004_progress',
      '0005_leaderboard',
      '0006_rice',
      '0007_challenge_run_max',
      '0008_leaderboard_periods',
      '0009_challenge_total_5000',
      '0010_challenge_picked_langs',
      '0011_rice_checkin_kind',
      '0012_security_qa_and_username',
      '0013_username_change_audit',
    ]);
    expect(first.currentVersion).toBe(13);
    expect(first.alreadyApplied).toBe(0);

    const { rows } = await pglite.query<{ version: number; name: string; checksum: string }>(
      'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
    );
    expect(rows.length).toBe(13);
    // 每一行记账的 checksum 都必须与被记账文件的真实字节一致（不是只查 0001）
    for (const row of rows) {
      const fileBytes = await readFile(path.join(MIGRATIONS_DIR, `${row.name}.sql`));
      const expected = createHash('sha256').update(fileBytes).digest('hex');
      expect(row.checksum, row.name).toBe(expected);
    }

    const second = await runMigrations(run);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toBe(13);
    expect(second.currentVersion).toBe(13);
    await pglite.close();
  });

  it('校验和漂移：已应用的 0001 被改动 → 拒绝执行且不产生新记账', async () => {
    const { pglite, run } = await freshDb();
    await runMigrations(run);

    const dir = await makeTempDir();
    const original = await readFile(path.join(MIGRATIONS_DIR, '0001_init.sql'), 'utf8');
    await writeFile(path.join(dir, '0001_init.sql'), `${original}\n-- 偷偷加的一行\n`);

    await expect(runMigrations(run, dir)).rejects.toThrow(/校验和/);
    const { rows } = await pglite.query<{ n: number }>('SELECT count(*)::int AS n FROM schema_migrations');
    expect(rows[0]!.n).toBe(13); // 0001~0013 十三行记账，未被污染
    await pglite.close();
  });

  it('多文件：按版本号顺序应用，第二条 SQL 的真实副作用存在', async () => {
    const { pglite, run } = await freshDb();
    const result = await runMigrations(run, path.join(FIXTURES, 'migrations-two'));
    expect(result.applied).toEqual(['0001_first', '0002_second']);
    expect(result.currentVersion).toBe(2);

    const { rows } = await pglite.query<{ id: number; label: string }>('SELECT id, label FROM two_a');
    expect(rows).toEqual([{ id: 1, label: 'seed-from-0002' }]);

    const again = await runMigrations(run, path.join(FIXTURES, 'migrations-two'));
    expect(again.applied).toEqual([]);
    expect(again.alreadyApplied).toBe(2);
    await pglite.close();
  });

  it('坏文件整份回滚：不记账、第二条 SQL 建的表不存在、已成功文件不受影响', async () => {
    const { pglite, run } = await freshDb();
    await expect(runMigrations(run, path.join(FIXTURES, 'migrations-broken'))).rejects.toThrow(
      /does not exist/,
    );

    const { rows: applied } = await pglite.query<{ version: number; name: string }>(
      'SELECT version, name FROM schema_migrations ORDER BY version',
    );
    expect(applied).toEqual([{ version: 1, name: '0001_ok' }]);

    const { rows: tables } = await pglite.query<{ a: string | null; b: string | null }>(
      `SELECT to_regclass('public.broken_a')::text AS a, to_regclass('public.broken_b')::text AS b`,
    );
    expect(tables[0]!.a).toBe('broken_a');
    expect(tables[0]!.b).toBeNull();
    await pglite.close();
  });

  it('装载期拒绝：版本号重复 / 文件名不合规', async () => {
    const dupeDir = await makeTempDir();
    await writeFile(path.join(dupeDir, '0001_a.sql'), 'SELECT 1;');
    await writeFile(path.join(dupeDir, '0001_b.sql'), 'SELECT 2;');
    await expect(loadMigrationFiles(dupeDir)).rejects.toThrow(/重复/);

    const badNameDir = await makeTempDir();
    await writeFile(path.join(badNameDir, '001_x.sql'), 'SELECT 1;');
    await expect(loadMigrationFiles(badNameDir)).rejects.toThrow(/NNNN/);
  });
});
