import { describe, expect, it } from 'vitest';
import { bucketIp, LoginBackoff, MAX_BACKOFF_RECORDS, RateLimiter } from '../../src/plugins/rate-limit.js';

describe('RateLimiter（进程内令牌桶，假时钟确定性验证）', () => {
  it('容量内放行，耗尽后拒绝并给出精确 Retry-After', () => {
    let now = 1_000_000;
    const limiter = new RateLimiter(() => now);
    for (let i = 0; i < 5; i += 1) {
      expect(limiter.take('reg|ip:1.2.3.4', 5, 3_600_000).allowed).toBe(true);
    }
    const blocked = limiter.take('reg|ip:1.2.3.4', 5, 3_600_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(720_000); // (1 token) / (5 tokens per hour)

    now += 720_000; // 补满恰好 1 个令牌
    expect(limiter.take('reg|ip:1.2.3.4', 5, 3_600_000).allowed).toBe(true);
  });

  it('不同 key 互不影响', () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    limiter.take('a', 1, 60_000);
    expect(limiter.take('a', 1, 60_000).allowed).toBe(false);
    expect(limiter.take('b', 1, 60_000).allowed).toBe(true);
  });
});

describe('LoginBackoff（每用户名指数退避，永不硬锁死）', () => {
  it('5 连败 → 60s；再败 → 120s；上限 15min；成功即清零', () => {
    let now = 0;
    const backoff = new LoginBackoff({ threshold: 5, baseMs: 60_000, maxMs: 900_000 }, () => now);

    for (let i = 0; i < 4; i += 1) backoff.recordFailure('alice');
    expect(backoff.check('alice').blocked).toBe(false);

    backoff.recordFailure('alice'); // 第 5 次
    const first = backoff.check('alice');
    expect(first.blocked).toBe(true);
    expect(first.retryAfterMs).toBe(60_000);

    now += 60_000;
    expect(backoff.check('alice').blocked).toBe(false); // 退避窗口过后可再试（不锁死）

    backoff.recordFailure('alice'); // 第 6 次
    expect(backoff.check('alice').retryAfterMs).toBe(120_000);

    for (let i = 0; i < 10; i += 1) backoff.recordFailure('alice'); // 打到上限
    const capped = backoff.check('alice');
    expect(capped.blocked).toBe(true);
    expect(capped.retryAfterMs).toBeLessThanOrEqual(900_000);

    backoff.recordSuccess('alice');
    expect(backoff.check('alice').blocked).toBe(false);
  });
});

describe('bucketIp（IPv6 按 /64 聚合）', () => {
  it('IPv4 原样返回', () => {
    expect(bucketIp('1.2.3.4')).toBe('1.2.3.4');
  });

  it('IPv6 取前 4 段（同一 /64 的轮换地址落同一桶）', () => {
    const a = bucketIp('2001:db8:a:b:1:2:3:4');
    const b = bucketIp('2001:db8:a:b:ffff::1');
    expect(a).toBe(b);
    expect(a).toBe('2001:db8:a:b::/64');
  });

  it('压缩形式与 IPv4-mapped 均可归一', () => {
    expect(bucketIp('::1')).toBe('0:0:0:0::/64');
    expect(bucketIp('::ffff:9.8.7.6')).toBe('9.8.7.6');
  });
});

describe('惰性淘汰（安全审查 F5：键空间有界，且淘汰与保留行为等价）', () => {
  it('RateLimiter：窗口完全流逝的桶被清理，未过期的保留', () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    limiter.take('short', 1, 60_000);
    limiter.take('long', 5, 3_600_000);
    expect(limiter.size).toBe(2);

    now += 61_000; // short 的窗口（60s）完全流逝；long（1h）未过
    limiter.take('trigger', 1, 60_000); // 触发惰性淘汰
    expect(limiter.size).toBe(2); // short 被清，剩 long + trigger

    // 等价性：被清的桶重新 take 得满桶——与「窗口流逝后未清」数学同结果
    expect(limiter.take('short', 1, 60_000).allowed).toBe(true);
  });

  it('LoginBackoff：时间推进不清零失败计数（没有「过期」语义，红队测试锁定）', () => {
    let now = 0;
    const backoff = new LoginBackoff({ threshold: 5, baseMs: 60_000, maxMs: 900_000 }, () => now);
    for (let i = 0; i < 4; i += 1) backoff.recordFailure('steady');
    now += 10 * 900_000; // 10 个最大封禁窗过去
    backoff.recordFailure('steady'); // 第 5 次失败 → 仍立即封禁（计数未被时间清零）
    expect(backoff.check('steady').blocked).toBe(true);
    expect(backoff.check('steady').retryAfterMs).toBe(60_000);
  });

  it('LoginBackoff：容量超限逐出最久未失败者；近活跃者保留（F5 LRU 上限）', () => {
    let now = 0;
    const backoff = new LoginBackoff({ threshold: 5, baseMs: 60_000, maxMs: 900_000 }, () => now);
    expect(MAX_BACKOFF_RECORDS).toBe(10_000); // 规格锁：上限值不得被悄悄调小
    for (let i = 0; i < 5; i += 1) backoff.recordFailure('ancient'); // 最旧，count=5
    for (let i = 0; i < MAX_BACKOFF_RECORDS - 2; i += 1) {
      now += 1;
      backoff.recordFailure(`u${i}`);
    }
    for (let i = 0; i < 4; i += 1) backoff.recordFailure('recent'); // 次新，count=4
    now += 1;
    backoff.recordFailure('trigger'); // size=上限+1 → 触发逐出（最旧 10%）
    expect(backoff.size).toBeLessThanOrEqual(MAX_BACKOFF_RECORDS);

    // ancient（最旧）被逐出：count 随记录消失 → 再失败从 1 起算 → 不进入封禁
    // （若未逐出：count=5→6 → factor=2 → 立刻封 120s → 下面断言必红）
    now += 1;
    backoff.recordFailure('ancient');
    expect(backoff.check('ancient').blocked).toBe(false);

    // recent（近活跃）保留：count=4 → 再失败即 5 → 封禁 60s
    now += 1;
    backoff.recordFailure('recent');
    expect(backoff.check('recent').blocked).toBe(true);
    expect(backoff.check('recent').retryAfterMs).toBe(60_000);
  });
});
