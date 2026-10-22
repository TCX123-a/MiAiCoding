/**
 * 数据库访问最小接口（docs/22 自由度：DAO 层用最小 Queryable 形状，同时兼容
 * pg.Pool（生产）与 @electric-sql/pglite（集成测试无 Docker 时的替代引擎））。
 *
 * `withTransaction` 是唯一需要驱动特定能力的地方：
 *  - pg.Pool：从池里取独占 client，显式 BEGIN/COMMIT/ROLLBACK；
 *  - PGlite：走其自带 transaction()（单连接串行化）。
 */
import pg from 'pg';
import type { AppConfig } from '../config.js';

/** 最小查询接口：{ query(text, params) }。PGlite 与 pg.Pool/client 都能收窄成它。 */
export interface Queryable {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface Db extends Queryable {
  withTransaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

/** 形状收窄点（全仓唯一）：pg 的 QueryResult<any> / PGlite 的 Results<T> 都结构化满足 { rows }。 */
function shapeQuery<R = Record<string, unknown>>(run: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>): (text: string, params?: unknown[]) => Promise<{ rows: R[] }> {
  return run as (text: string, params?: unknown[]) => Promise<{ rows: R[] }>;
}

export function createPool(config: AppConfig): pg.Pool {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // 空闲连接报错（PG 重启、网络抖动、服务端掐连接）时 pg 会 emit('error')。
  // EventEmitter 的 'error' 事件没有监听 = 未处理异常 = 整个 API 进程直接崩。
  // 监听后只出声：池会丢弃坏连接、下一次 query/connect 自动重建；在飞请求
  // 各自的错误仍照常走上层（这里只兜「没人等待的空闲连接」这一种）。
  // 启动入口与 jobs/daily 都走本函数，故这一处监听覆盖两边。
  pool.on('error', (err) => {
    console.error('[pg] idle client error:', err instanceof Error ? err.message : err);
  });
  return pool;
}

function wrapClient(client: pg.PoolClient): Queryable {
  return { query: shapeQuery((text, params) => client.query(text, params).then((r) => ({ rows: r.rows }))) as Queryable['query'] };
}

export function asDb(pool: pg.Pool): Db {
  return {
    query: shapeQuery((text, params) => pool.query(text, params).then((r) => ({ rows: r.rows }))) as Queryable['query'],
    async withTransaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrapClient(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // 连接已坏时 ROLLBACK 也会失败；原始错误优先级更高
        }
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
