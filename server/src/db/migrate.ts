/**
 * 手写迁移 runner（docs/22 §4.7 迁移纪律）：
 *  编号 SQL 文件 → 读 schema_migrations 已应用集 → 逐文件校验 checksum（不符即终止）
 *  → advisory lock（防并发）→ 事务内执行 → 记账（文件名 + 校验和）。
 * 规则：只增不改；迁移命令显式执行（npm run migrate / node dist/db/migrate.js），
 * 绝不放在应用启动路径上。
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadConfig } from '../config.js';
import type { Queryable } from './pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, '../../migrations');

/** advisory lock 键（固定值，迁移方与被迁移方共用；值本身无意义，稳定即可） */
export const MIGRATION_ADVISORY_LOCK_KEY = 1836212585; // 0x6d696169 = "miai"

/** 迁移执行器：查询走参数化；exec 用于无参数的多语句 SQL 脚本（BEGIN/ROLLBACK、整份迁移文件） */
export interface MigrationDb extends Queryable {
  exec(sql: string): Promise<void>;
}

export interface MigrationFile {
  version: number;
  name: string;
  checksum: string;
  sql: string;
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: number;
  currentVersion: number;
}

export const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version int PRIMARY KEY,
  name text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

export async function loadMigrationFiles(dir: string = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const entries = (await readdir(dir)).filter((f) => f.endsWith('.sql'));
  const files: MigrationFile[] = [];
  for (const entry of entries) {
    const match = /^(\d{4})_([A-Za-z0-9_]+)\.sql$/.exec(entry);
    if (!match) {
      throw new Error(`迁移文件名不合规（应为 NNNN_name.sql）：${entry}`);
    }
    const raw = await readFile(path.join(dir, entry));
    files.push({
      version: Number(match[1]),
      name: entry.slice(0, -'.sql'.length),
      checksum: createHash('sha256').update(raw).digest('hex'),
      sql: raw.toString('utf8'),
    });
  }
  files.sort((a, b) => a.version - b.version);
  for (let i = 1; i < files.length; i += 1) {
    if (files[i]!.version === files[i - 1]!.version) {
      throw new Error(`迁移版本号重复：${files[i - 1]!.name} 与 ${files[i]!.name}`);
    }
  }
  return files;
}

interface AppliedRow {
  version: number | string;
  name: string;
  checksum: string;
}

export async function runMigrations(db: MigrationDb, dir: string = MIGRATIONS_DIR): Promise<MigrationResult> {
  const files = await loadMigrationFiles(dir);
  await db.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
  try {
    await db.exec(SCHEMA_MIGRATIONS_DDL);
    const { rows } = await db.query<AppliedRow>('SELECT version, name, checksum FROM schema_migrations ORDER BY version');
    const applied = new Map<number, AppliedRow>(rows.map((r) => [Number(r.version), r]));

    const appliedNow: string[] = [];
    for (const file of files) {
      const previous = applied.get(file.version);
      if (previous) {
        if (previous.checksum !== file.checksum) {
          throw new Error(
            `迁移 ${file.name} 的校验和与已应用记录不符（文件在应用后被改过？规则：只增不改）`,
          );
        }
        continue;
      }
      await db.exec('BEGIN');
      try {
        await db.exec(file.sql);
        await db.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
          file.version,
          file.name,
          file.checksum,
        ]);
        await db.exec('COMMIT');
      } catch (err) {
        try {
          await db.exec('ROLLBACK');
        } catch {
          // 忽略：原始错误优先
        }
        throw err;
      }
      appliedNow.push(file.name);
    }

    const { rows: maxRows } = await db.query<{ v: number | string | null }>(
      'SELECT MAX(version) AS v FROM schema_migrations',
    );
    const maxVersion = maxRows[0]?.v;
    return {
      applied: appliedNow,
      alreadyApplied: applied.size,
      currentVersion: maxVersion === null || maxVersion === undefined ? 0 : Number(maxVersion),
    };
  } finally {
    try {
      await db.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
    } catch {
      // 连接已坏时解锁失败可忽略（会话断开即释放）
    }
  }
}

/** 从 pg 的独占 client 构造迁移执行器（迁移必须单连接执行事务） */
export function migrationDbFromPgClient(client: pg.PoolClient): MigrationDb {
  return {
    query: ((text: string, params?: unknown[]) => client.query(text, params).then((r) => ({ rows: r.rows }))) as Queryable['query'],
    exec: async (sql: string) => {
      await client.query(sql);
    },
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const url = config.migrationDatabaseUrl ?? config.databaseUrl;
  if (config.migrationDatabaseUrl === undefined) {
    console.warn('[migrate] 未设置 MIGRATION_DATABASE_URL，回退使用 DATABASE_URL（仅限本机开发）');
  }
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    const db = migrationDbFromPgClient(client);
    const result = await runMigrations(db);
    console.log(
      `[migrate] applied=${result.applied.length} already=${result.alreadyApplied} current=${result.currentVersion}`,
      result.applied,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

const invokedAsScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsScript) {
  main().catch((err: unknown) => {
    console.error('[migrate] 失败：', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
