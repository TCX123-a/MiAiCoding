/**
 * 不透明令牌（docs/22 §5.1）：32 字节 CSPRNG → `ms1_` + 无填充 base64url；
 * 服务端只存 sha256(令牌) hex64；原文不落库、不进日志。
 *
 * 哈希算法裁决：裸 sha256（不加 pepper）——令牌本身是 256 位随机数，无字典攻击面，
 * 加 pepper 反而制造「.env 丢失 = 全员锁死」的灾难因子（docs/22 §5.2 不启用 pepper 同一理由）。
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { TOKEN_BYTES, TOKEN_PREFIX, TOKEN_REGEX } from '../protocol.js';

export function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('base64url');
}

/** 存库前的令牌哈希（sha256 hex64） */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isWellFormedToken(token: string): boolean {
  return TOKEN_REGEX.test(token);
}

/** 时序安全的 hex 字符串比较（先转 Buffer 再 timingSafeEqual，长度不等直接 false） */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (!/^[0-9a-f]*$/.test(a) || !/^[0-9a-f]*$/.test(b)) return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** 从 Authorization 头解析 Bearer 令牌；不合法返回 null（scheme 大小写不敏感，RFC 7235） */
export function parseBearer(header: string | undefined): string | null {
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? (match[1] as string) : null;
}
