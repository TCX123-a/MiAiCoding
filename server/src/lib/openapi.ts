/**
 * OpenAPI 3.1 文档生成（P10.2 任务书第 4 项）。docs/22/26 未给字段级契约——本文即契约。
 *
 * 双真源，互为闸门：
 *  ① **路由注册本身**：`installOpenApiCollector` 在 buildApp 里注册路由前挂 onRoute 钩子，
 *     收集每条路由的 (method, url, schema, preHandler)；「注册了但文档里没有」结构上不可能，
 *     文档端点自己也在册。zod → JSON Schema 用 zod 4 内置 z.toJSONSchema，target 2020-12
 *     （= OpenAPI 3.1 的方言）；请求侧 io:'input'、响应侧 io:'output'。
 *  ② **OPENAPI_OPERATIONS 表**：每条路由的人工摘要/标签/鉴权口径/无体成功码。单测双向
 *     核对（表 ↔ 实际路由）且核对 auth 与 preHandler 的一致性（唯一例外 delete-account：
 *     手工鉴权，没有 preHandler）——任何一边漏了/歪了，测试即红（漂移闸门）。
 */
import { z } from 'zod';
import type { FastifyInstance, RouteOptions } from 'fastify';
import { API_VERSION, ERROR_CODES, PROTOCOL_CURRENT, PROTOCOL_FLOOR } from '../protocol.js';

export interface OperationDoc {
  summary: string;
  tag: string;
  /** 是否要求 Bearer 令牌（与 preHandler 双向核对；delete-account 为手工鉴权例外） */
  auth: boolean;
  /** 无响应体声明的端点（204 等）的成功状态码；有 schema.response 则从声明里出 */
  success?: number;
  /** 原始字节请求体的端点（PUT /v1/avatar）：OpenAPI 的 requestBody 手写 */
  rawBody?: { contentType: string; description: string };
}

const op = (
  summary: string,
  tag: string,
  auth: boolean,
  extra: { success?: number; rawBody?: OperationDoc['rawBody'] } = {},
): OperationDoc => ({ summary, tag, auth, ...extra });

/** 全端点表（键 = `${METHOD} ${url}`，url 用 fastify 的 ':param' 写法）。 */
export const OPENAPI_OPERATIONS: Record<string, OperationDoc> = {
  'GET /v1/health': op('存活 + schemaVer（健康检查是限流例外）', 'health', false),
  'GET /v1/meta': op('版本协商：apiVersion / protocol / capabilities', 'meta', false),
  'GET /v1/openapi.json': op('本 OpenAPI 3.1 文档', 'meta', false),
  'POST /v1/auth/register': op('注册（自动登录）', 'auth', false, { success: 201 }),
  'POST /v1/auth/login': op('登录（失败统一 BAD_CREDENTIALS 防枚举）', 'auth', false),
  'GET /v1/auth/session': op('会话有效 + 账号信息', 'auth', true),
  'POST /v1/auth/logout': op('登出（幂等：已失效令牌同样 204）', 'auth', false, { success: 204 }),
  'POST /v1/auth/logout-all': op('全设备登出（吊销全部会话，含当前）', 'auth', true, { success: 204 }),
  'GET /v1/auth/sessions': op('设备列表（创建/最近活跃/是否当前）', 'auth', true),
  'POST /v1/auth/change-password': op('改密（保留当前会话、吊销其他）', 'auth', true, { success: 204 }),
  'POST /v1/auth/delete-account': op('注销（幂等；会话墓碑 24h）', 'auth', true, { success: 204 }),
  'POST /v1/auth/recover/question': op('找回·取安全问题（账号不存在 404；无问答 NO_SECURITY_QUESTION）', 'auth', false),
  'POST /v1/auth/recover/verify': op('找回·验安全答案（错 → BAD_SECURITY_ANSWER；含退避与日闸）', 'auth', false),
  'POST /v1/auth/recover/reset': op('找回·重置密码（答案再核 → 换哈希 → 吊销全部会话）', 'auth', false),
  'GET /v1/docs': op('四文档摘要（不含 payload）', 'docs', true),
  'GET /v1/docs/:docType': op('拉取文档（支持 ETag 条件读）', 'docs', true),
  'PUT /v1/docs/:docType': op('条件写（CAS：baseRevision）', 'docs', true),
  'POST /v1/challenge/days': op('挑战结算（提交逐题事实，服务端算分）', 'challenge', true),
  'GET /v1/challenge/days': op('挑战结算历史（近 N 天）', 'challenge', true),
  'GET /v1/leaderboard': op('排行榜（快照 + 实算两条路径，含本人名次）', 'leaderboard', true),
  'POST /v1/rice/entries': op('流水上行（批量推送本地真饭条目）', 'rice', true),
  'GET /v1/rice/entries': op('流水下行（seq 游标增量拉取）', 'rice', true),
  'GET /v1/me/summary': op('面板一屏：stats + 余额 + 名次', 'me', true),
  'PUT /v1/me/username': op('改用户名（登录名同步换；违禁词/唯一性/日闸 5 次）', 'me', true),
  'PUT /v1/me/leaderboard-opt-in': op('榜面曝光开关（幂等；唯一写口，2026-10-10 A4 裁定）', 'me', true),
  'GET /v1/avatar/:hash': op('取头像（内容寻址 image/png；任意未封禁账号可读，hash 过期 404）', 'avatar', true),
  'PUT /v1/avatar': op(
    '上传头像（image/png ≤512KB；PNG magic 校验；内容寻址幂等）',
    'avatar',
    true,
    { rawBody: { contentType: 'image/png', description: 'PNG 原始字节（≤512KB）' } },
  ),
};

export interface CollectedRoute {
  /** 一个路由条目可挂多个方法（fastify 的 method 数组写法）——收成列表逐个出文档 */
  methods: string[];
  url: string;
  schema: Record<string, unknown> | undefined;
  hasAuthHandler: boolean;
}

const collected = new WeakMap<FastifyInstance, CollectedRoute[]>();

/** 必须在注册任何路由**之前**调用（onRoute 钩子只管其后注册的路由）。 */
export function installOpenApiCollector(app: FastifyInstance): void {
  const routes: CollectedRoute[] = [];
  collected.set(app, routes);
  app.addHook('onRoute', (route: RouteOptions) => {
    routes.push({
      methods: Array.isArray(route.method) ? [...route.method] : [route.method],
      url: route.url,
      schema: route.schema as Record<string, unknown> | undefined,
      hasAuthHandler: route.preHandler === (app as unknown as { authenticate: unknown }).authenticate,
    });
  });
}

export function collectedRoutes(app: FastifyInstance): readonly CollectedRoute[] {
  const routes = collected.get(app);
  if (!routes) throw new Error('installOpenApiCollector 未安装（必须在注册路由前调用）');
  return routes;
}

const ERROR_BODY_SCHEMA = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    retryAfterMs: z.number().optional(),
    details: z.unknown().optional(),
    requestId: z.string(),
  }),
});

const REASON: Record<string, string> = {
  '200': 'OK',
  '201': 'Created',
  '204': 'No Content',
  '400': 'Bad Request',
  '401': 'Unauthorized',
  '403': 'Forbidden',
  '404': 'Not Found',
  '409': 'Conflict',
  '413': 'Payload Too Large',
  '415': 'Unsupported Media Type',
  '426': 'Upgrade Required',
  '429': 'Too Many Requests',
  '500': 'Internal Server Error',
  '503': 'Service Unavailable',
};

function toJsonSchema(schema: unknown, io: 'input' | 'output'): unknown {
  if (schema instanceof z.ZodType) {
    const json = z.toJSONSchema(schema, {
      target: 'draft-2020-12',
      io,
      unrepresentable: 'any', // 文档生成绝不因某个奇葩 schema 抛错——有单测闸门兜底
    }) as Record<string, unknown>;
    delete json.$schema; // OpenAPI 在根上声明 3.1（= 2020-12），子 schema 里不重复
    // zod 4 给对象统一生成 additionalProperties:false；对**输入**这不属实——服务端是
    // 「多余键剥掉」而不是「拒绝」。文档说 allow 才是诚实的（输出侧保留，服务端确实只发这些键）。
    if (io === 'input') stripFalseAdditionalProperties(json);
    return json;
  }
  return schema ?? {};
}

function stripFalseAdditionalProperties(node: unknown): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) stripFalseAdditionalProperties(item);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (obj.additionalProperties === false && obj.properties !== undefined) {
    delete obj.additionalProperties;
  }
  for (const value of Object.values(obj)) stripFalseAdditionalProperties(value);
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/** getV1AvatarByHash 这类稳定唯一标识（快照漂移闸门依赖其确定性）。 */
function operationId(method: string, url: string): string {
  const parts = url
    .split(/[/\-.]+/)
    .filter(Boolean)
    .map((p) => (p.startsWith(':') ? `By${capitalize(p.slice(1))}` : capitalize(p.replace(/[^A-Za-z0-9]/g, ''))));
  return method.toLowerCase() + parts.join('');
}

/** params/querystring 的 zod 对象 → OpenAPI parameters 列表。 */
function parametersFrom(
  schema: unknown,
  location: 'path' | 'query',
): Array<Record<string, unknown>> {
  const json = toJsonSchema(schema, 'input') as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  const required = new Set(json.required ?? []);
  return Object.entries(json.properties ?? {}).map(([name, propSchema]) => ({
    name,
    in: location,
    required: required.has(name),
    schema: propSchema,
  }));
}

function buildOperation(method: string, route: CollectedRoute): Record<string, unknown> {
  const meta = OPENAPI_OPERATIONS[`${method} ${route.url}`];
  const schema = route.schema ?? {};
  const operation: Record<string, unknown> = {
    operationId: operationId(method, route.url),
    summary: meta?.summary ?? `${method} ${route.url}`,
    tags: [meta?.tag ?? 'misc'],
    responses: {},
  };

  const parameters = [
    ...(schema.params !== undefined ? parametersFrom(schema.params, 'path') : []),
    ...(schema.querystring !== undefined ? parametersFrom(schema.querystring, 'query') : []),
  ];
  if (parameters.length > 0) operation.parameters = parameters;

  if (schema.body !== undefined) {
    operation.requestBody = {
      required: true,
      content: { 'application/json': { schema: toJsonSchema(schema.body, 'input') } },
    };
  } else if (meta?.rawBody !== undefined) {
    operation.requestBody = {
      required: true,
      content: {
        [meta.rawBody.contentType]: {
          schema: { type: 'string', format: 'binary' },
          description: meta.rawBody.description,
        },
      },
    };
  }

  if (meta?.auth === true) operation.security = [{ bearerAuth: [] }];

  // 响应：schema.response 里声明的每个状态 + 无体端点的成功码 + 统一错误体 default
  const responses = operation.responses as Record<string, unknown>;
  const declared = (schema.response ?? {}) as Record<string, unknown>;
  for (const [status, bodySchema] of Object.entries(declared)) {
    responses[status] = {
      description: REASON[status] ?? `HTTP ${status}`,
      content: { 'application/json': { schema: toJsonSchema(bodySchema, 'output') } },
    };
  }
  const success = String(meta?.success ?? 200);
  if (responses[success] === undefined) {
    responses[success] = { description: REASON[success] ?? `HTTP ${success}` };
  }
  responses.default = {
    description: '错误（统一错误体；code 见 components.schemas.ErrorBody）',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
  };

  return operation;
}

export function buildOpenApiDocument(app: FastifyInstance): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of collectedRoutes(app)) {
    const pathKey = route.url.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const pathItem = (paths[pathKey] ??= {});
    for (const method of route.methods) {
      // HEAD 是 fastify exposeHeadRoutes 的实现细节（GET 的附属），不是接口契约——不进文档
      if (method === 'HEAD') continue;
      pathItem[method.toLowerCase()] = buildOperation(method, route);
    }
  }
  return {
    openapi: '3.1.0',
    info: {
      title: '咪爱编程 云端 API',
      version: String(API_VERSION),
      description:
        `自建后端（docs/22 §3.4 的 15 端点 + docs/26 新增 6 端点 + 榜面开关端点 + 本文档端点）。` +
        `协议版本 current=${PROTOCOL_CURRENT} / floor=${PROTOCOL_FLOOR}；` +
        '鉴权为不透明 Bearer 令牌；错误体形状全站统一（见 components.schemas.ErrorBody）。',
    },
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: '登录/注册返回的不透明令牌（服务端只存 sha256）。',
        },
      },
      schemas: {
        ErrorBody: toJsonSchema(ERROR_BODY_SCHEMA, 'output'),
      },
    },
  };
}
