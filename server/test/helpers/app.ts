/** 集成测试用：测试数据库（PGlite / 真 PG 双轨，见 db.ts）+ buildApp 组装（可注入假时钟 / 限流覆盖 / 日志采集） */
import type { FastifyServerOptions } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig, type RateLimitConfig } from '../../src/config.js';
import type { AppInstance } from '../../src/plugins/shared.js';
import { SECURITY_QUESTIONS } from '../../src/protocol.js';
import { createTestDatabase, type TestDatabase } from './db.js';

export interface TestContext extends TestDatabase {
  app: AppInstance;
}

export interface TestContextOptions {
  rateLimits?: Partial<RateLimitConfig>;
  clock?: () => number;
  /** 追加/覆盖环境变量（如 TRUST_PROXY_CIDR 的信任代理正对照臂） */
  env?: Record<string, string | undefined>;
  /** 日志注入（如 `{ level: 'warn', stream }` 捕获 request.log.warn —— 审计痕的用例） */
  logger?: FastifyServerOptions['logger'];
}

export async function createTestContext(options: TestContextOptions = {}): Promise<TestContext> {
  const database = await createTestDatabase();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://unused-test-harness/unused',
    ...options.env,
  });
  const app = await buildApp({
    db: database.db,
    config,
    ...(options.rateLimits !== undefined ? { rateLimits: options.rateLimits } : {}),
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
  });
  return { ...database, app };
}

export const TEST_PASSWORD = 'correct horse battery staple';

/** 注册必填的安全问答（2026-10-13）：问题取枚举首项，答案固定小写串（找回用例靠它比对归一化） */
export const TEST_QUESTION = SECURITY_QUESTIONS[0];
export const TEST_ANSWER = 'xiaohei';

export async function register(
  app: AppInstance,
  username: string,
  password: string = TEST_PASSWORD,
  securityAnswer: string = TEST_ANSWER,
) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { username, password, securityQuestion: TEST_QUESTION, securityAnswer },
  });
}

export async function login(app: AppInstance, username: string, password: string = TEST_PASSWORD) {
  return app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username, password } });
}

export function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}
