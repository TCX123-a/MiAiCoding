/**
 * 生成 server/openapi.json 快照（漂移闸门测试的另一半：测试断言「服务端现产物 === 本文件」）。
 * 用只会抛错的假 Db 组装应用——文档生成不查库（真查了就会当场炸出来，而不是静默漂移）。
 * 刷新：`npm run openapi:snapshot`。
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db/pool.js';
import { buildOpenApiDocument } from '../src/lib/openapi.js';

const stubDb = {
  query: async () => {
    throw new Error('openapi 快照生成不应查库');
  },
  withTransaction: async () => {
    throw new Error('openapi 快照生成不应查库');
  },
} as unknown as Db;

const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://unused-by-openapi-snapshot/unused' });
const app = await buildApp({ db: stubDb, config });
const doc = buildOpenApiDocument(app);
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'openapi.json');
writeFileSync(out, JSON.stringify(doc, null, 2) + '\n', 'utf8');
const paths = doc.paths as Record<string, unknown>;
console.log(`openapi.json 已刷新：${out}（paths=${Object.keys(paths).length}）`);
await app.close();
process.exit(0);
