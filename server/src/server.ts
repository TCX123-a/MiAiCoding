/**
 * 启动入口：读 env → 建 pg 连接池 → 组装 app → listen。
 * 迁移绝不挂在这里（docs/22 §4.7）：显式跑 `npm run migrate`。
 */
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { asDb, createPool } from './db/pool.js';
import { createLoggerOptions } from './logger.js';

const config = loadConfig();
const pool = createPool(config);

const app = await buildApp({
  db: asDb(pool),
  config,
  logger: createLoggerOptions(config.logLevel),
});

await app.listen({ host: config.host, port: config.port });

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await pool.end();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
