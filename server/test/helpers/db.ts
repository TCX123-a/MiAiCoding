/**
 * 集成测试数据库。两种后端，由环境变量 MIAI_TEST_PG 选择：
 *  - 未设置 → @electric-sql/pglite（WASM 版真 PostgreSQL，内存库；默认路线，零外部依赖）；
 *  - 已设置 → 该 URL 指向的**真** PostgreSQL（本机 PG18 沙箱 127.0.0.1:54329）：
 *    每个测试文件建独立临时库 miai_t_<12hex>，跑全量迁移，close 时 DROP (FORCE)。
 *    连接失败 / 值非法 = 立即抛错，**绝不静默回退 PGlite**（「不许默认回退为成功」）——
 *    否则「真 PG 轨道全绿」会是一句没发生过的证词。
 * DAO 层最小 Queryable 形状同时兼容 pg.Pool（生产）与 PGlite（测试），见 src/db/pool.ts。
 * 双轨用法：npm test（PGlite） / npm run test:pg（真 PG），见 README。
 */
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { migrationDbFromPgClient, runMigrations, type MigrationDb } from '../../src/db/migrate.js';
import { asDb, type Db, type Queryable } from '../../src/db/pool.js';

export type TestBackend = 'pglite' | 'pg';

/** 测试直连的统一表面（SQL 夹具专用）：PGlite client 与 pg.Pool 都收窄成它 */
export interface TestRawClient {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
  close(): Promise<void>;
}

export interface TestDatabase {
  /** 原始 SQL 通道（两个后端下名字都诚实；形状同 PGlite client 的 query） */
  raw: TestRawClient;
  db: Db;
  backend: TestBackend;
  /** 仅 pg 模式：本测试库的连接串（供需独立会话的用例：SET ROLE / 单独 client） */
  pgUrl?: string;
}

export interface CreateTestDatabaseOptions {
  /** 迁移前钩子（跑在迁移执行器上，与后端无关）：集群级前置项，如「先建角色再跑迁移」 */
  beforeMigrate?: (db: MigrationDb) => Promise<void>;
}

function shape<R = Record<string, unknown>>(
  run: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>,
): (text: string, params?: unknown[]) => Promise<{ rows: R[] }> {
  return run as (text: string, params?: unknown[]) => Promise<{ rows: R[] }>;
}

// ---------------- PGlite 轨道（默认） ----------------

/** PGlite 版迁移执行器（grants / migrate / ddl-constraints 的自建实例用） */
export function migrationDbFromPglite(pglite: PGlite): MigrationDb {
  return {
    query: shape((text, params) => pglite.query(text, params).then((r) => ({ rows: r.rows }))) as Queryable['query'],
    exec: async (sql: string) => {
      await pglite.exec(sql);
    },
  };
}

export function dbFromPglite(pglite: PGlite): Db {
  return {
    query: shape((text, params) => pglite.query(text, params).then((r) => ({ rows: r.rows }))) as Queryable['query'],
    async withTransaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      return pglite.transaction(async (tx) =>
        fn({
          query: shape((text, params) => tx.query(text, params).then((r) => ({ rows: r.rows }))) as Queryable['query'],
        }),
      );
    },
  };
}

async function createPgliteTestDatabase(options: CreateTestDatabaseOptions): Promise<TestDatabase> {
  const pglite = new PGlite();
  await pglite.waitReady;
  if (options.beforeMigrate) {
    await options.beforeMigrate(migrationDbFromPglite(pglite));
  }
  const result = await runMigrations(migrationDbFromPglite(pglite));
  if (!result.applied.includes('0001_init')) {
    throw new Error(`预期 0001_init 被应用，实际：${JSON.stringify(result)}`);
  }
  return {
    backend: 'pglite',
    db: dbFromPglite(pglite),
    raw: {
      query: shape((text, params) => pglite.query(text, params).then((r) => ({ rows: r.rows }))),
      close: async () => {
        await pglite.close();
      },
    },
  };
}

// ---------------- 真 PG 轨道（MIAI_TEST_PG 设置时） ----------------

/** pg 模式临时库名前缀（`\l` 里残留的 miai_t_* 即未正常 close 的测试库） */
export const PG_TEST_DB_PREFIX = 'miai_t_';

function pgBaseUrl(): string {
  const url = process.env.MIAI_TEST_PG;
  if (url === undefined) {
    throw new Error('createPgTestDatabase 只能在 MIAI_TEST_PG 已设置时调用');
  }
  if (url.trim() === '') {
    throw new Error('MIAI_TEST_PG 已设置但为空串：要么填 postgres:// URL，要么清掉该变量走 PGlite');
  }
  return url;
}

async function createPgTestDatabase(options: CreateTestDatabaseOptions): Promise<TestDatabase> {
  const baseUrl = pgBaseUrl();
  const admin = new pg.Pool({ connectionString: baseUrl, max: 1, connectionTimeoutMillis: 10_000 });

  // 探活 + 版本自检：连不上就带着原始错误直接炸，绝不回退 PGlite
  let version: string;
  try {
    const probe = await admin.query<{ version: string }>('SELECT version() AS version');
    version = probe.rows[0]!.version;
  } catch (err) {
    await admin.end().catch(() => {});
    throw new Error(
      `MIAI_TEST_PG 已设置但连不上（${baseUrl}）——不静默回退 PGlite。原始错误：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!/^PostgreSQL \d/.test(version)) {
    await admin.end().catch(() => {});
    throw new Error(`MIAI_TEST_PG 指向的不是 PostgreSQL：${version}`);
  }

  const dbName = `${PG_TEST_DB_PREFIX}${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  // CREATE DATABASE / 解析 URL 都不许把 admin 池漏在这儿：连不了 WHATWG URL 的
  // 连接串（pg 自己解析比它宽松）或建库失败时，必须回收池再抛。
  let childUrl: URL;
  try {
    await admin.query(`CREATE DATABASE "${dbName}"`);
    childUrl = new URL(baseUrl);
    childUrl.pathname = `/${dbName}`;
  } catch (err) {
    await admin.end().catch(() => {});
    throw err;
  }
  const pool = new pg.Pool({
    connectionString: childUrl.toString(),
    max: 4,
    connectionTimeoutMillis: 10_000,
  });

  try {
    // 迁移必须单连接执行（BEGIN/COMMIT 与 advisory lock 都是会话级）
    const client = await pool.connect();
    try {
      const migrationDb = migrationDbFromPgClient(client);
      if (options.beforeMigrate) {
        await options.beforeMigrate(migrationDb);
      }
      const result = await runMigrations(migrationDb);
      if (!result.applied.includes('0001_init')) {
        throw new Error(`预期 0001_init 被应用，实际：${JSON.stringify(result)}`);
      }
    } finally {
      client.release();
    }
    // 自证：连的确实是本文件新建的临时库（不是 MIAI_TEST_PG 指向的库本身）
    const { rows } = await pool.query<{ db: string }>('SELECT current_database() AS db');
    if (rows[0]!.db !== dbName) {
      throw new Error(`pg 测试库自证失败：current_database()=${rows[0]!.db}，预期 ${dbName}`);
    }
  } catch (err) {
    await pool.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
    throw err;
  }

  let closed = false; // close 幂等：重复 close 不许把 DROP/admin.end 吃掉
  return {
    backend: 'pg',
    pgUrl: childUrl.toString(),
    db: asDb(pool),
    raw: {
      query: shape((text, params) => pool.query(text, params).then((r) => ({ rows: r.rows }))),
      async close() {
        if (closed) return;
        closed = true;
        try {
          await pool.end();
        } finally {
          // pool 收尾抛错也要把临时库 DROP 掉、管理池关掉（否则残留 + 连接泄漏一起来）
          try {
            await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
          } catch (err) {
            // 残留库污染的是环境不是判据（不会造成假绿），所以只大声报、不翻转测试结果
            console.error(
              `[test-db] 临时库 ${dbName} 删除失败，请手工清理：DROP DATABASE "${dbName}" WITH (FORCE)；` +
                `原始错误：${err instanceof Error ? err.message : String(err)}`,
            );
          }
          await admin.end().catch(() => {});
        }
      },
    },
  };
}

// ---------------- 统一入口 ----------------

/** 新开一个测试库（PGlite 内存库 / 真 PG 临时库，由 MIAI_TEST_PG 决定）+ 跑完全部迁移 */
export async function createTestDatabase(options: CreateTestDatabaseOptions = {}): Promise<TestDatabase> {
  if (process.env.MIAI_TEST_PG !== undefined) {
    return createPgTestDatabase(options);
  }
  return createPgliteTestDatabase(options);
}
