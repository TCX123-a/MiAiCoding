/**
 * 日志红线（docs/22 §5.8）：令牌 / 密码 / Cookie 绝不落日志。
 * 单独成文件的原因：生产入口（server.ts）与测试共用同一份 redact 配置，
 * 测试可以对着真配置验证（含负对照），而不是复制一份会漂移的字面量。
 */

/** pino redact 路径全集（fastify 的 req/res 对象形状 + 顶层兜底） */
export const LOG_REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'res.headers["set-cookie"]',
  'password',
  'token',
];

export const LOG_REDACT_CENSOR = '[REDACTED]';

/** fastify `logger:` 选项（buildApp 的 logger 直接收它） */
export function createLoggerOptions(level: string): {
  level: string;
  redact: { paths: string[]; censor: string };
} {
  return {
    level,
    redact: { paths: LOG_REDACT_PATHS, censor: LOG_REDACT_CENSOR },
  };
}
