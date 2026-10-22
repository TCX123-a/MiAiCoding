/**
 * OpenAPI 文档漂移闸门（P10.2 任务书第 4 项）。
 *
 * 三条闸门：
 *  ① 服务端现产物与提交的 server/openapi.json 快照全等——改了路由/字段却忘了
 *     `npm run openapi:snapshot` 时即红（这就是「漂移」的定义）；
 *  ② OPENAPI_OPERATIONS 表 ↔ 实际注册路由**双向**核对（漏了摘要条目 / 写了不存在的路由 → 红）；
 *  ③ 表的 auth 口径与路由真实 preHandler 一致——唯一登记例外 `POST /v1/auth/delete-account`
 *     （手工鉴权：墓碑重试必须能进门，不能挂全局中间件，见 auth.ts）。
 * 另钉点值：3.1.0 / bearerAuth / avatar path 参数 / 204 无体 / 公开端点无 security。
 * 只动 test/**。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectedRoutes, OPENAPI_OPERATIONS } from '../../src/lib/openapi.js';
import { createTestContext, type TestContext } from '../helpers/app.js';

const HIGH_LIMITS = {
  registerPerHourPerIp: 100_000,
  registerPerDayGlobal: 1_000_000,
  loginPer15MinPerIp: 10_000,
  apiPerMinute: 1_000_000,
};

/** 表的 auth 与 preHandler 不一致的白名单（每条都要有理由，见文件头） */
const AUTH_EXCEPTIONS = new Set(['POST /v1/auth/delete-account']);

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext({ rateLimits: HIGH_LIMITS });
});

afterAll(async () => {
  await ctx.raw.close();
});

/** 采集到的实际路由 → `${METHOD} ${url}` 键（HEAD 是 fastify GET 的附属实现，不算契约） */
function actualRouteKeys(): string[] {
  const keys: string[] = [];
  for (const route of collectedRoutes(ctx.app)) {
    for (const method of route.methods) {
      if (method === 'HEAD') continue;
      keys.push(`${method} ${route.url}`);
    }
  }
  return keys.sort();
}

describe('OpenAPI 漂移闸门', () => {
  it('① /v1/openapi.json 与磁盘快照全等（漂移了就跑 npm run openapi:snapshot）', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(res.statusCode).toBe(200);
    const onDisk = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../openapi.json', import.meta.url)), 'utf8'),
    ) as unknown;
    expect(res.json(), '快照漂移：请运行 npm run openapi:snapshot 并提交新快照').toEqual(onDisk);
  });

  it('② OPENAPI_OPERATIONS 表 ↔ 实际路由双向核对：不漏、不多', async () => {
    const actual = actualRouteKeys();
    const table = Object.keys(OPENAPI_OPERATIONS).sort();
    expect(actual.filter((k) => !OPENAPI_OPERATIONS[k]), '这些路由在表里没有条目').toEqual([]);
    expect(table.filter((k) => !actual.includes(k)), '表里有实际不存在的路由').toEqual([]);
  });

  it('③ auth 口径与 preHandler 一致（delete-account 为唯一登记例外）', () => {
    for (const route of collectedRoutes(ctx.app)) {
      for (const method of route.methods) {
        if (method === 'HEAD') continue;
        const key = `${method} ${route.url}`;
        if (AUTH_EXCEPTIONS.has(key)) {
          expect(OPENAPI_OPERATIONS[key]?.auth, `${key} 是登记例外`).toBe(true);
          expect(route.hasAuthHandler, `${key} 不应挂全局中间件`).toBe(false);
          continue;
        }
        expect(OPENAPI_OPERATIONS[key]?.auth, `${key} 的 auth 口径与 preHandler 不一致`).toBe(
          route.hasAuthHandler,
        );
      }
    }
  });
});

describe('OpenAPI 点值', () => {
  let doc: Record<string, unknown>;

  beforeAll(async () => {
    doc = (await ctx.app.inject({ method: 'GET', url: '/v1/openapi.json' })).json();
  });

  it('文档版本与安全方案', () => {
    expect(doc.openapi).toBe('3.1.0');
    const components = doc.components as { securitySchemes: Record<string, { scheme: string }> };
    expect(components.securitySchemes.bearerAuth?.scheme).toBe('bearer');
  });

  it('path 参数进文档（avatar :hash）且必需', () => {
    const paths = doc.paths as Record<string, { get: { parameters: Array<Record<string, unknown>> } }>;
    expect(paths['/v1/avatar/{hash}']!.get.parameters).toEqual([
      { name: 'hash', in: 'path', required: true, schema: { type: 'string' } },
    ]);
  });

  it('公开端点无 security；鉴权端点有 bearerAuth；204 端点无响应体', () => {
    const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>;
    expect(paths['/v1/health']!.get!.security).toBeUndefined();
    expect(paths['/v1/meta']!.get!.security).toBeUndefined();
    expect(paths['/v1/leaderboard']!.get!.security).toEqual([{ bearerAuth: [] }]);
    expect(paths['/v1/auth/logout-all']!.post!.security).toEqual([{ bearerAuth: [] }]);

    const logoutAll = paths['/v1/auth/logout-all']!.post!.responses as Record<string, Record<string, unknown>>;
    expect(Object.keys(logoutAll)).toEqual(['204', 'default']);
    expect(logoutAll['204']!.content).toBeUndefined();

    const register = paths['/v1/auth/register']!.post!.responses as Record<string, unknown>;
    expect(register['201']).toBeDefined();
    expect(register['200']).toBeUndefined(); // 注册是 201 端点，不该有 200
  });

  it('PUT /v1/avatar 的原始字节请求体在档（image/png binary）', () => {
    const paths = doc.paths as Record<string, { put: { requestBody: { content: Record<string, { schema: { format?: string } }> } } }>;
    const content = paths['/v1/avatar']!.put.requestBody.content;
    expect(Object.keys(content)).toEqual(['image/png']);
    expect(content['image/png']!.schema.format).toBe('binary');
  });

  it('统一错误体在 components 且错误码枚举在档', () => {
    const components = doc.components as { schemas: { ErrorBody: { properties: { error: { properties: { code: { enum: string[] } } } } } } };
    const codes = components.schemas.ErrorBody.properties.error.properties.code.enum;
    expect(codes).toContain('RATE_LIMITED');
    expect(codes).toContain('ENTRY_CONFLICT');
    expect(codes).toContain('DB_UNAVAILABLE');
    expect(codes.length).toBeGreaterThanOrEqual(19); // docs/22 十六 + docs/26 三
  });
});
