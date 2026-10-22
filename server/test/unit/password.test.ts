import { describe, expect, it } from 'vitest';
import {
  absorbUnknownUserTiming,
  argon2idRawBytes,
  decodePasswordHash,
  encodePasswordHash,
  hashPassword,
  verifyPassword,
} from '../../src/lib/password.js';
import { AppError } from '../../src/lib/errors.js';

describe('password（argon2id，Node 24 内置 crypto.argon2）', () => {
  it('RFC 9106 §5.3 argon2id 官方向量逐位一致（含 secret/AD，走生产同一参数通道）', async () => {
    const derived = await argon2idRawBytes(Buffer.alloc(32, 0x01), {
      salt: Buffer.alloc(16, 0x02),
      memoryKiB: 32,
      passes: 3,
      parallelism: 4,
      tagLength: 32,
      secret: Buffer.alloc(8, 0x03),
      associatedData: Buffer.alloc(12, 0x04),
    });
    expect(derived.toString('hex')).toBe(
      '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
    );
  });

  it('种坏值：篡改一个参数复算即不一致', async () => {
    const base = {
      salt: Buffer.alloc(16, 0x02),
      memoryKiB: 32,
      passes: 3,
      parallelism: 4,
      tagLength: 32,
    };
    const good = await argon2idRawBytes(Buffer.alloc(32, 0x01), base);
    const tampered = await argon2idRawBytes(Buffer.alloc(32, 0x01), { ...base, memoryKiB: 33 });
    expect(good.toString('hex')).not.toBe(tampered.toString('hex'));
  });

  it('hashPassword → verifyPassword 回环；错误口令为 false', async () => {
    const encoded = await hashPassword('correct horse battery staple');
    expect(encoded).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    expect(await verifyPassword('correct horse battery staple', encoded)).toBe(true);
    expect(await verifyPassword('wrong password here!!', encoded)).toBe(false);
  });

  it('种坏值：把存储串里的 m 参数改掉 → 校验必为 false', async () => {
    const encoded = await hashPassword('correct horse battery staple');
    const tampered = encoded.replace('m=19456', 'm=19457');
    expect(tampered).not.toBe(encoded);
    expect(await verifyPassword('correct horse battery staple', tampered)).toBe(false);
  });

  it('decodePasswordHash 对畸形输入返回 null（不抛异常）', () => {
    expect(decodePasswordHash('not-a-hash')).toBeNull();
    expect(decodePasswordHash('$argon2id$v=13$m=19456,t=2,p=1$AAAA$BBBB')).toBeNull();
    expect(decodePasswordHash('$argon2id$v=19$m=0,t=2,p=1$AAAA$BBBB')).toBeNull();
  });

  it('encode/decode 往返一致', () => {
    const salt = Buffer.from('0123456789abcdef');
    const tag = Buffer.alloc(32, 0xab);
    const encoded = encodePasswordHash(salt, tag, { memoryKiB: 19456, passes: 2, parallelism: 1 });
    const parsed = decodePasswordHash(encoded);
    expect(parsed).not.toBeNull();
    expect(parsed!.salt.equals(salt)).toBe(true);
    expect(parsed!.tag.equals(tag)).toBe(true);
    expect(parsed!.memoryKiB).toBe(19456);
  });

  it('未知账号等价计时操作可完成（返回即通过）', async () => {
    await expect(absorbUnknownUserTiming('someone else password')).resolves.toBeUndefined();
  });

  it('哈希并发闸：2 并发 + 16 排队，第 19/20 个请求快速 503（DB_UNAVAILABLE）', async () => {
    const tasks = Array.from({ length: 20 }, (_, i) => hashPassword(`queue pressure ${i} !`));
    const settled = await Promise.allSettled(tasks);
    const rejected = settled.filter((s) => s.status === 'rejected');
    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    expect(fulfilled.length).toBe(18);
    expect(rejected.length).toBe(2);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(AppError);
      expect((r.reason as AppError).code).toBe('DB_UNAVAILABLE');
      expect((r.reason as AppError).retryAfterMs).toBeGreaterThan(0);
    }
  });
});
