/**
 * GET /v1/health —— 存活 + schemaVer（= max(schema_migrations.version)，无迁移为 0；
 * 健康检查是限流例外，且 DB 不可达也返回 200 存活语义）。
 * GET /v1/meta —— 版本协商：{apiVersion, protocol:{current,floor}, capabilities, serverTime}。
 */
import { z } from 'zod';
import { num } from '../lib/util.js';
import { API_VERSION, CAPABILITIES, PROTOCOL_CURRENT, PROTOCOL_FLOOR } from '../protocol.js';
import { takeApiRate, type AppInstance, type SharedDeps } from '../plugins/shared.js';

export function healthRoutes(app: AppInstance, deps: SharedDeps): void {
  app.get(
    '/v1/health',
    {
      schema: {
        response: {
          200: z.object({ ok: z.boolean(), schemaVer: z.number(), serverTime: z.string() }),
        },
      },
    },
    async () => {
      let schemaVer = 0;
      try {
        const { rows } = await deps.db.query<{ v: number | string | null }>(
          'SELECT MAX(version) AS v FROM schema_migrations',
        );
        const v = rows[0]?.v;
        schemaVer = v === null || v === undefined ? 0 : num(v);
      } catch {
        schemaVer = 0; // 尚未迁移（表不存在）或数据库暂不可用
      }
      return { ok: true, schemaVer, serverTime: new Date().toISOString() };
    },
  );

  app.get(
    '/v1/meta',
    {
      schema: {
        response: {
          200: z.object({
            apiVersion: z.number(),
            protocol: z.object({ current: z.number(), floor: z.number() }),
            capabilities: z.array(z.string()),
            serverTime: z.string(),
          }),
        },
      },
    },
    async (request) => {
      takeApiRate(deps, request);
      return {
        apiVersion: API_VERSION,
        protocol: { current: PROTOCOL_CURRENT, floor: PROTOCOL_FLOOR },
        capabilities: [...CAPABILITIES],
        serverTime: new Date().toISOString(),
      };
    },
  );
}
