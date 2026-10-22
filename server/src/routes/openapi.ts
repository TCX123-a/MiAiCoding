/**
 * GET /v1/openapi.json —— OpenAPI 3.1 文档（公开，与 health/meta 同级）。
 * 文档在首个请求时按已注册路由生成一次并缓存（buildApp 之后路由集合已冻结）。
 * 生成逻辑与「路由↔文档」漂移闸门见 src/lib/openapi.ts + test/integration/openapi.test.ts；
 * 磁盘快照 `server/openapi.json` 由 `npm run openapi:snapshot` 刷新。
 */
import type { AppInstance, SharedDeps } from '../plugins/shared.js';
import { buildOpenApiDocument } from '../lib/openapi.js';
import { takeApiRate } from '../plugins/shared.js';

export function openapiRoutes(app: AppInstance, deps: SharedDeps): void {
  let cached: Record<string, unknown> | null = null;
  app.get('/v1/openapi.json', async (request) => {
    takeApiRate(deps, request);
    cached ??= buildOpenApiDocument(app);
    return cached;
  });
}
