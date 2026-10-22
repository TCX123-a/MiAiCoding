/**
 * 路由层共享依赖与「全 API 120 次/分钟」单桶语义（docs/22 §5.4 自由度 #7）：
 * 已认证 → 按 accountId 分桶；匿名 → 按 IP（IPv6 聚合 /64）分桶；健康检查不走此函数（例外）。
 */
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppConfig, RateLimitConfig } from '../config.js';
import type { Db } from '../db/pool.js';
import type { LoginBackoff, RateLimiter } from './rate-limit.js';
import { bucketIp, enforceRateLimit } from './rate-limit.js';

/** 带 zod 类型提供者的 Fastify 实例（路由模块统一用它，schema 才能是 zod schema） */
export type AppInstance = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  ZodTypeProvider
>;

export interface SharedDeps {
  db: Db;
  config: AppConfig;
  rates: RateLimitConfig;
  limiter: RateLimiter;
  backoff: LoginBackoff;
}

export function apiBucketKey(request: FastifyRequest): string {
  const auth = request.auth;
  if (auth) return `api|a:${auth.accountId}`;
  return `api|ip:${bucketIp(request.ip)}`;
}

export function takeApiRate(deps: SharedDeps, request: FastifyRequest): void {
  enforceRateLimit(deps.limiter, {
    key: apiBucketKey(request),
    limit: deps.rates.apiPerMinute,
    windowMs: 60_000,
    message: 'too many requests',
  });
}
