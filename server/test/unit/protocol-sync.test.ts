/**
 * 协议真源闸门（服务端一侧）：server/src/protocol.ts 必须与客户端真源
 * src/shared/cloud/protocol.ts **逐字节相等**（docs/22 §3.3）。
 *
 * 客户端测试（src/shared/__tests__/cloud-protocol.test.ts）有同一条字节断言；
 * 两侧各钉一遍是因为两边测试各自独立运行——谁改了副本，谁的流水线先红。
 * 同步动作：`node scripts/protocol-sync.mjs copy`（或 `npm run protocol:sync`）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as P from '../../src/protocol.js';
import { ERROR_CODES, HTTP_STATUS_BY_CODE } from '../../src/lib/errors.js';

describe('协议真源闸门（服务端）', () => {
  const src = readFileSync(new URL('../../../src/shared/cloud/protocol.ts', import.meta.url));
  const dst = readFileSync(new URL('../../src/protocol.ts', import.meta.url));

  it('server/src/protocol.ts 与客户端真源逐字节相等', () => {
    expect(dst.equals(src)).toBe(true);
  });

  it('种坏自检：翻转一个字节后比较器必须报不等', () => {
    const flipped = Buffer.from(dst);
    flipped[Math.floor(flipped.length / 2)]! ^= 0x01;
    expect(dst.equals(flipped)).toBe(false);
  });

  it('errors.ts 的 re-export 与 protocol.ts 是同一个绑定（没有各持一份拷贝）', () => {
    expect(ERROR_CODES).toBe(P.ERROR_CODES);
    expect(HTTP_STATUS_BY_CODE).toBe(P.HTTP_STATUS_BY_CODE);
    expect(ERROR_CODES.length).toBe(22); // 16 + 3 + 找回链两码（2026-10-13）
  });

  it('服务端代码依赖的关键导出齐全（含既有 16 项与新增 3 项）', () => {
    expect(P.API_VERSION).toBe(1);
    expect(P.PROTOCOL_CURRENT).toBe(1);
    expect(P.PROTOCOL_FLOOR).toBe(1);
    expect([...P.CAPABILITIES]).toEqual(['challenge_settle', 'rice_ledger', 'leaderboard']);
    expect([...P.DOC_TYPES]).toEqual(['profile', 'wrongbook', 'favorites', 'practice']);
    expect(P.DOC_BODY_LIMIT).toBeGreaterThan(P.DOC_SIZE_LIMITS.practice);
    expect(P.AUTH_BODY_LIMIT).toBe(16 * 1024);
    expect(P.AVATAR_BODY_LIMIT).toBe(600 * 1024);
    expect(P.TOKEN_REGEX.test(P.TOKEN_PREFIX + 'x'.repeat(43))).toBe(true);
    expect(P.SESSION_IDLE_DAYS).toBe(30);
    expect(P.SESSION_ABSOLUTE_DAYS).toBe(180);
    expect(P.SYNC_PROTOCOL_HEADER).toBe('x-sync-protocol');
    // 2026-10-10 批长改版 v3：CHALLENGE_RUN_MAX(20) → 5000，取消每日 20 题上限；日上限 5760 → 1250000（= 5000×250）
    expect(P.DAILY_SCORE_MAX).toBe(1250000);
    expect(P.CHALLENGE_RUN_MAX).toBe(5000);
    expect(P.DAILY_SCORE_MAX).toBe(P.CHALLENGE_RUN_MAX * P.weightedPoints('challenge', 'cpp'));
    // 排行榜五页签对齐的两项新增（月/年键与形状校验器）
    expect([...P.LEADERBOARD_PERIODS]).toEqual(['daily', 'weekly', 'monthly', 'yearly', 'alltime']);
    expect(P.MONTH_KEY_RE.test('2026-10')).toBe(true);
    expect(P.MONTH_KEY_RE.test('2026-10-08')).toBe(false);
    expect(P.YEAR_KEY_RE.test('2026')).toBe(true);
    expect(P.YEAR_KEY_RE.test('2026-10')).toBe(false);
    expect(P.RATE_LIMITS.avatarUploadPerHourPerAccount).toBe(10);
    expect(P.RATE_LIMITS.passwordChangePerDayPerAccount).toBe(5);
    expect(P.RATE_LIMITS.deleteAccountPerDayPerAccount).toBe(3);
  });
});
