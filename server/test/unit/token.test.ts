import { describe, expect, it } from 'vitest';
import { generateToken, hashToken, isWellFormedToken, parseBearer, timingSafeEqualHex } from '../../src/lib/token.js';

describe('token（不透明令牌生命周期纯函数）', () => {
  it('格式：ms1_ + 43 字符无填充 base64url；两次生成不重复', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^ms1_[A-Za-z0-9_-]{43}$/);
    expect(b).toMatch(/^ms1_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('hashToken 确定性且为 hex64（服务端只存哈希）', () => {
    const token = 'ms1_' + 'A'.repeat(43);
    const h = hashToken(token);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(h);
    expect(hashToken(token + 'B')).not.toBe(h);
  });

  it('isWellFormedToken 拒绝畸形/篡改前缀', () => {
    expect(isWellFormedToken(generateToken())).toBe(true);
    expect(isWellFormedToken('ms2_' + 'A'.repeat(43))).toBe(false);
    expect(isWellFormedToken('ms1_short')).toBe(false);
    expect(isWellFormedToken('ms1_' + 'A'.repeat(44))).toBe(false);
    expect(isWellFormedToken('ms1_' + 'A'.repeat(42) + '!')).toBe(false);
  });

  it('timingSafeEqualHex：相等为 true，不等/畸形为 false', () => {
    const h = hashToken('ms1_' + 'C'.repeat(43));
    expect(timingSafeEqualHex(h, h)).toBe(true);
    expect(timingSafeEqualHex(h, hashToken('ms1_' + 'D'.repeat(43)))).toBe(false);
    expect(timingSafeEqualHex('', '')).toBe(false);
    expect(timingSafeEqualHex('zz', 'zz')).toBe(false);
  });

  it('parseBearer：接受规范 Bearer 头（scheme 大小写不敏感），其余为 null', () => {
    const token = generateToken();
    expect(parseBearer(`Bearer ${token}`)).toBe(token);
    expect(parseBearer(`bearer ${token}`)).toBe(token);
    expect(parseBearer(token)).toBeNull();
    expect(parseBearer(undefined)).toBeNull();
    expect(parseBearer('Bearer ')).toBeNull();
    expect(parseBearer(`Token ${token}`)).toBeNull();
  });
});
