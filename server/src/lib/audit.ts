/**
 * 认证审计写入（docs/22 §4.2 ④ 的 11 类事件 + 找回链 2 类 + 改用户名 1 类 = 14 类；
 * 2026-10-13 扩白名单见迁移 0012，2026-10-22 扩 change_username 见迁移 0013）。
 * 注意：docs/22 §5.4 的「未认证失败事件按 (IP 段, 用户名) 每分钟合并计数」为放大抑制优化，
 * P10.2 骨架先逐条直写（已在 impl-report 登记为待实现项）。
 */
import { createHash } from 'node:crypto';
import type { Queryable } from '../db/pool.js';

export type AuditEvent =
  | 'register'
  | 'login_ok'
  | 'login_fail'
  | 'login_blocked'
  | 'logout'
  | 'logout_all'
  | 'change_password'
  | 'change_username'
  | 'delete_account'
  | 'account_disabled'
  | 'sessions_revoked'
  | 'rate_limited'
  | 'password_reset'
  | 'recover_fail';

export interface AuditInput {
  event: AuditEvent;
  accountId?: string | null;
  username?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  detail?: unknown;
}

function hashUserAgent(ua: string): string {
  return createHash('sha256').update(ua, 'utf8').digest('hex').slice(0, 16);
}

export async function writeAudit(db: Queryable, input: AuditInput): Promise<void> {
  const uaHash = input.userAgent ? hashUserAgent(input.userAgent) : null;
  const detail = input.detail === undefined ? null : JSON.stringify(input.detail);
  await db.query(
    `INSERT INTO auth_audit (event, account_id, username, ip, ua_hash, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.event, input.accountId ?? null, input.username ?? null, input.ip ?? null, uaHash, detail],
  );
}
