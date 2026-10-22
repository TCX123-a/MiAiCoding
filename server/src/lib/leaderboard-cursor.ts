/**
 * 排行榜 keyset 分页游标（docs/26 §4.5）：`base64(score:accountId)`。
 *
 * 排序口径恒为 `(score DESC, account_id ASC)`（并列同名次后再按账号序保证确定性）；
 * 游标 = 上一页最后一行 → 下一页条件 `(score, account_id) < (游标)`（字典序元组比较）。
 * 解码失败一律返回 null（路由层按 400 VALIDATION_FAILED 处理，不抛裸异常）。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LeaderboardCursor {
  score: number;
  accountId: string;
}

export function encodeLeaderboardCursor(score: number, accountId: string): string {
  return Buffer.from(`${score}:${accountId}`, 'utf8').toString('base64url');
}

export function decodeLeaderboardCursor(raw: string): LeaderboardCursor | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200) return null;
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const sep = text.indexOf(':');
  if (sep <= 0) return null;
  const scoreText = text.slice(0, sep);
  const accountId = text.slice(sep + 1);
  if (!/^(0|[1-9][0-9]{0,9})$/.test(scoreText)) return null;
  if (!UUID_RE.test(accountId)) return null;
  return { score: Number(scoreText), accountId };
}
