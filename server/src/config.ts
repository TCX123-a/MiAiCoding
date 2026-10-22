/**
 * 环境变量读取与校验（docs/22 §5 环境约定）：缺必填项启动即失败。
 * .env 键全集：DATABASE_URL、MIGRATION_DATABASE_URL、PORT、NODE_ENV、TRUST_PROXY_CIDR、
 * LOG_LEVEL、RATE_LIMIT_*。没有 JWT/签名/pepper 类密钥（不透明令牌口径）。
 */
import { RATE_LIMITS } from './protocol.js';
import type { ErrorCode } from './lib/errors.js';

export interface RateLimitConfig {
  /** 注册：每 IP 每小时 */
  registerPerHourPerIp: number;
  /** 注册：全局每天 */
  registerPerDayGlobal: number;
  /** 登录尝试：每 IP 每 15 分钟（成败均计） */
  loginPer15MinPerIp: number;
  /** 全 API：每账号或每 IP 每分钟（健康检查例外） */
  apiPerMinute: number;
  /** 每用户名连续失败阈值（达到后进入指数退避） */
  loginFailThreshold: number;
  /** 退避基数（60s） */
  loginFailBaseBackoffMs: number;
  /** 退避上限（15min，永不硬锁死） */
  loginFailMaxBackoffMs: number;
  /** docs/26 §4.7 追加：挑战提交 10 次/日/账号（幂等重放不计） */
  challengeSubmitPerDayPerAccount: number;
  /** docs/26 §4.7 追加：流水上行 6 次/时/账号 */
  ricePushPerHourPerAccount: number;
  /** docs/26 §4.7 追加：流水批量 ≤200 条/次 */
  riceEntriesPerPush: number;
  /** docs/26 §4.7 追加：流水 ≤1000 条/日/账号 */
  riceEntriesPerDayPerAccount: number;
  /** docs/22 §5.4：头像上传 10 次/时/账号 */
  avatarUploadPerHourPerAccount: number;
  /** docs/22 §5.4：改密 5 次/日/账号 */
  passwordChangePerDayPerAccount: number;
  /** 用户系统（2026-10-22）：改用户名 5 次/日/账号 */
  usernameChangePerDayPerAccount: number;
  /** docs/22 §5.4：注销 3 次/日/账号 */
  deleteAccountPerDayPerAccount: number;
  /** 找回链（2026-10-13）：三端点共用一个 IP 桶，10 次/15min/IP */
  recoverPer15MinPerIp: number;
  /** 找回链（2026-10-13）：验答案/重置按账号日闸，10 次/日/账号（另叠加按用户名退避） */
  recoverAttemptPerDayPerAccount: number;
  /**
   * 安全审查 A5（2026-10-10）：文档写入 60 次/时/账号。
   *
   * 【为什么必须单独限】PUT /v1/docs/:docType 此前只吃全局 takeApiRate（120/min），
   * 而 practice 文档上限 8MiB ⇒ 120 × 8MiB ≈ **960MiB/分钟/账号**的 JSON 解析 +
   * jsonb 转换。单账号就能把 CPU/内存吃到可观。
   * 【为什么这个数】正常使用是「改一次设置同步一次」，60/时远高于真人操作；
   * 同步风暴（离线积累后重放）也够用，因为它按账号分桶且幂等重推不额外产生
   * 写放大——真撞上了，429 带 retryAfterMs，客户端等一会即可。
   * 【为什么不写进 protocol.ts】那是与客户端逐字节同步的契约文件；本条是
   * 服务端可调策略，不改变任何请求/响应形状（RATE_LIMITED 错误码本就存在）。
   */
  docsWritePerHourPerAccount: number;
}

/** 默认值：既有 7 项来自 docs/22 §5.4，追加 7 项来自 protocol 真源（docs/26 §4.7 + docs/22 §5.4 尾行） */
export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  registerPerHourPerIp: 5,
  registerPerDayGlobal: 50,
  loginPer15MinPerIp: 30,
  apiPerMinute: 120,
  loginFailThreshold: 5,
  loginFailBaseBackoffMs: 60_000,
  loginFailMaxBackoffMs: 15 * 60_000,
  challengeSubmitPerDayPerAccount: RATE_LIMITS.challengeSubmitPerDayPerAccount,
  ricePushPerHourPerAccount: RATE_LIMITS.ricePushPerHourPerAccount,
  riceEntriesPerPush: RATE_LIMITS.riceEntriesPerPush,
  riceEntriesPerDayPerAccount: RATE_LIMITS.riceEntriesPerDayPerAccount,
  avatarUploadPerHourPerAccount: RATE_LIMITS.avatarUploadPerHourPerAccount,
  passwordChangePerDayPerAccount: RATE_LIMITS.passwordChangePerDayPerAccount,
  usernameChangePerDayPerAccount: RATE_LIMITS.usernameChangePerDayPerAccount,
  deleteAccountPerDayPerAccount: RATE_LIMITS.deleteAccountPerDayPerAccount,
  recoverPer15MinPerIp: RATE_LIMITS.recoverPer15MinPerIp,
  recoverAttemptPerDayPerAccount: RATE_LIMITS.recoverAttemptPerDayPerAccount,
  docsWritePerHourPerAccount: 60,
};

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  migrationDatabaseUrl?: string;
  /** Fastify trustProxy：compose 固定网段字符串；未设置 = false（不信任 XFF） */
  trustProxyCidr?: string;
  rates: RateLimitConfig;
}

export type Env = Record<string, string | undefined>;

function parsePositiveInt(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`环境变量 ${name} 必须是正整数，当前值：${JSON.stringify(raw)}`);
  }
  return value;
}

export function loadConfig(env: Env = process.env): AppConfig {
  const nodeEnvRaw = env.NODE_ENV?.trim() || 'development';
  if (nodeEnvRaw !== 'development' && nodeEnvRaw !== 'test' && nodeEnvRaw !== 'production') {
    throw new Error(`环境变量 NODE_ENV 只能是 development/test/production，当前值：${nodeEnvRaw}`);
  }
  const nodeEnv = nodeEnvRaw as AppConfig['nodeEnv'];

  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('缺少必填环境变量 DATABASE_URL（应用连接串）');
  }

  const migrationDatabaseUrl = env.MIGRATION_DATABASE_URL?.trim() || undefined;
  if (nodeEnv === 'production') {
    if (!migrationDatabaseUrl) {
      throw new Error('生产环境必须提供 MIGRATION_DATABASE_URL（迁移专用连接串，不得与 DATABASE_URL 混用）');
    }
    if (migrationDatabaseUrl === databaseUrl) {
      throw new Error('生产环境 DATABASE_URL 与 MIGRATION_DATABASE_URL 不得相同（应用角色与迁移角色必须分离）');
    }
  }

  const trustProxyCidr = env.TRUST_PROXY_CIDR?.trim() || undefined;

  const rates: RateLimitConfig = {
    registerPerHourPerIp: parsePositiveInt(env, 'RATE_LIMIT_REGISTER_PER_HOUR', DEFAULT_RATE_LIMITS.registerPerHourPerIp),
    registerPerDayGlobal: parsePositiveInt(env, 'RATE_LIMIT_REGISTER_GLOBAL_PER_DAY', DEFAULT_RATE_LIMITS.registerPerDayGlobal),
    loginPer15MinPerIp: parsePositiveInt(env, 'RATE_LIMIT_LOGIN_PER_15MIN', DEFAULT_RATE_LIMITS.loginPer15MinPerIp),
    apiPerMinute: parsePositiveInt(env, 'RATE_LIMIT_API_PER_MINUTE', DEFAULT_RATE_LIMITS.apiPerMinute),
    loginFailThreshold: DEFAULT_RATE_LIMITS.loginFailThreshold,
    loginFailBaseBackoffMs: DEFAULT_RATE_LIMITS.loginFailBaseBackoffMs,
    loginFailMaxBackoffMs: DEFAULT_RATE_LIMITS.loginFailMaxBackoffMs,
    challengeSubmitPerDayPerAccount: parsePositiveInt(env, 'RATE_LIMIT_CHALLENGE_PER_DAY', DEFAULT_RATE_LIMITS.challengeSubmitPerDayPerAccount),
    ricePushPerHourPerAccount: parsePositiveInt(env, 'RATE_LIMIT_RICE_PUSH_PER_HOUR', DEFAULT_RATE_LIMITS.ricePushPerHourPerAccount),
    riceEntriesPerPush: parsePositiveInt(env, 'RATE_LIMIT_RICE_ENTRIES_PER_PUSH', DEFAULT_RATE_LIMITS.riceEntriesPerPush),
    riceEntriesPerDayPerAccount: parsePositiveInt(env, 'RATE_LIMIT_RICE_ENTRIES_PER_DAY', DEFAULT_RATE_LIMITS.riceEntriesPerDayPerAccount),
    avatarUploadPerHourPerAccount: parsePositiveInt(env, 'RATE_LIMIT_AVATAR_PER_HOUR', DEFAULT_RATE_LIMITS.avatarUploadPerHourPerAccount),
    passwordChangePerDayPerAccount: parsePositiveInt(env, 'RATE_LIMIT_PASSWORD_CHANGE_PER_DAY', DEFAULT_RATE_LIMITS.passwordChangePerDayPerAccount),
    usernameChangePerDayPerAccount: parsePositiveInt(env, 'RATE_LIMIT_USERNAME_CHANGE_PER_DAY', DEFAULT_RATE_LIMITS.usernameChangePerDayPerAccount),
    deleteAccountPerDayPerAccount: parsePositiveInt(env, 'RATE_LIMIT_DELETE_ACCOUNT_PER_DAY', DEFAULT_RATE_LIMITS.deleteAccountPerDayPerAccount),
    recoverPer15MinPerIp: parsePositiveInt(env, 'RATE_LIMIT_RECOVER_PER_15MIN', DEFAULT_RATE_LIMITS.recoverPer15MinPerIp),
    recoverAttemptPerDayPerAccount: parsePositiveInt(env, 'RATE_LIMIT_RECOVER_PER_DAY', DEFAULT_RATE_LIMITS.recoverAttemptPerDayPerAccount),
    docsWritePerHourPerAccount: parsePositiveInt(env, 'RATE_LIMIT_DOCS_WRITE_PER_HOUR', DEFAULT_RATE_LIMITS.docsWritePerHourPerAccount),
  };

  return {
    nodeEnv,
    host: env.HOST?.trim() || '127.0.0.1',
    port: parsePositiveInt(env, 'PORT', 8787),
    logLevel: env.LOG_LEVEL?.trim() || 'info',
    databaseUrl,
    ...(migrationDatabaseUrl !== undefined ? { migrationDatabaseUrl } : {}),
    ...(trustProxyCidr !== undefined ? { trustProxyCidr } : {}),
    rates,
  };
}

/** 预留类型出口（供路由层引用错误码时使用同一来源） */
export type { ErrorCode };
