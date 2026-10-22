/**
 * Fastify 实例组装（docs/22 §3.2）：插件（错误处理/鉴权/限流状态）+ 路由注册。
 * buildApp() 接受注入的 Db，便于测试用 PGlite 驱动整条请求链（fastify.inject）。
 */
import { fastify, type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { RateLimitConfig } from './config.js';
import type { Db } from './db/pool.js';
import { installAuth } from './plugins/auth.js';
import { installErrorHandling } from './plugins/error-handler.js';
import { installOpenApiCollector } from './lib/openapi.js';
import { LoginBackoff, RateLimiter } from './plugins/rate-limit.js';
import type { AppInstance, SharedDeps } from './plugins/shared.js';
import { authRoutes } from './routes/auth.js';
import { avatarRoutes } from './routes/avatar.js';
import { challengeRoutes } from './routes/challenge.js';
import { healthRoutes } from './routes/health.js';
import { leaderboardRoutes } from './routes/leaderboard.js';
import { meRoutes } from './routes/me.js';
import { openapiRoutes } from './routes/openapi.js';
import { riceRoutes } from './routes/rice.js';
import { syncRoutes } from './routes/sync.js';

export interface BuildAppOptions {
  db: Db;
  config: SharedDeps['config'];
  logger?: FastifyServerOptions['logger'];
  /** 测试用限流覆盖（不改 env） */
  rateLimits?: Partial<RateLimitConfig>;
  /** 测试用假时钟（限流/退避确定性验证） */
  clock?: () => number;
}

export async function buildApp(options: BuildAppOptions): Promise<AppInstance> {
  const app = fastify({
    logger: options.logger ?? false,
    trustProxy: options.config.trustProxyCidr ?? false,
    connectionTimeout: 30_000, // docs/22 §5.8：Fastify 超时默认 0，必须显式设
    requestTimeout: 90_000,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const clock = options.clock ?? Date.now;
  const limiter = new RateLimiter(clock);
  const backoff = new LoginBackoff(
    {
      threshold: options.config.rates.loginFailThreshold,
      baseMs: options.config.rates.loginFailBaseBackoffMs,
      maxMs: options.config.rates.loginFailMaxBackoffMs,
    },
    clock,
  );

  const deps: SharedDeps = {
    db: options.db,
    config: options.config,
    rates: { ...options.config.rates, ...options.rateLimits },
    limiter,
    backoff,
  };

  installErrorHandling(app);
  installAuth(app, options.db);
  installOpenApiCollector(app); // 必须在所有路由注册前（onRoute 只收其后注册的）

  // 头像上传按原始字节收（docs/22 §3.4 #15：image/png ≤512KB）——JSON 解析器管不了二进制。
  // 其他 Content-Type 走 fastify 默认 → 415（error-handler 已映射）。
  app.addContentTypeParser('image/png', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  healthRoutes(app, deps);
  authRoutes(app, deps);
  meRoutes(app, deps);
  syncRoutes(app, deps);
  challengeRoutes(app, deps);
  riceRoutes(app, deps);
  leaderboardRoutes(app, deps);
  avatarRoutes(app, deps);
  openapiRoutes(app, deps);

  await app.ready();
  return app;
}
