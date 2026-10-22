/** 排行榜游标编解码单测（docs/26 §4.5：base64(score:accountId)）。 */
import { describe, expect, it } from 'vitest';
import { decodeLeaderboardCursor, encodeLeaderboardCursor } from '../../src/lib/leaderboard-cursor.js';

const ID = '0199a1b2-3456-7abc-8def-0123456789ab';

describe('leaderboard cursor', () => {
  it('往返：0/大分数/任意 uuid', () => {
    expect(decodeLeaderboardCursor(encodeLeaderboardCursor(0, ID))).toEqual({ score: 0, accountId: ID });
    expect(decodeLeaderboardCursor(encodeLeaderboardCursor(3210, ID))).toEqual({ score: 3210, accountId: ID });
  });

  it('解码失败一律 null（不抛异常）', () => {
    expect(decodeLeaderboardCursor('')).toBeNull();
    expect(decodeLeaderboardCursor('!!!')).toBeNull();
    expect(decodeLeaderboardCursor(Buffer.from('abc:nope', 'utf8').toString('base64url'))).toBeNull();
    expect(decodeLeaderboardCursor(Buffer.from('-5:' + ID, 'utf8').toString('base64url'))).toBeNull();
    expect(decodeLeaderboardCursor(Buffer.from('01:' + ID, 'utf8').toString('base64url'))).toBeNull(); // 前导零
    expect(decodeLeaderboardCursor(Buffer.from('12:', 'utf8').toString('base64url'))).toBeNull();
    expect(decodeLeaderboardCursor('x'.repeat(201))).toBeNull();
  });

  it('大小写 uuid 都接受（PG uuid 列比较不区分大小写）', () => {
    const upper = ID.toUpperCase();
    expect(decodeLeaderboardCursor(encodeLeaderboardCursor(7, upper))).toEqual({ score: 7, accountId: upper });
  });
});
