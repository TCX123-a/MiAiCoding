/**
 * 进程内限流（docs/22 §5.4 唯一真源；单进程部署，无外部依赖）：
 *  - 令牌桶（RateLimiter）：注册 5/时/IP + 全局 50/日；登录 30/15min/IP；全 API 120/min/账号或 IP；
 *  - 用户名连续失败指数退避（LoginBackoff）：5 次 → 60s ×2^n，上限 15min，永不硬锁死；
 *  - IPv6 按 /64 聚合分桶（只按全地址分桶会被轮换地址绕穿）；
 *  - 429 一律带 Retry-After（秒），错误体带 retryAfterMs。
 * clock 可注入：测试用假时钟做确定性验证。
 */
import { appError } from '../lib/errors.js';

/** 惰性淘汰的扫描间隔（安全审查 F5）：不为每次 take 都全表扫；60s 与最短窗口同量级 */
const SWEEP_INTERVAL_MS = 60_000;

export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; last: number; windowMs: number }>();
  private lastSweep: number;

  constructor(private readonly clock: () => number = Date.now) {
    this.lastSweep = this.clock();
  }

  take(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterMs: number } {
    const now = this.clock();
    if (now - this.lastSweep >= SWEEP_INTERVAL_MS) {
      this.sweep(now);
      this.lastSweep = now;
    }
    const ratePerMs = limit / windowMs;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: limit, last: now, windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.windowMs = windowMs;
    const elapsed = Math.max(0, now - bucket.last);
    bucket.tokens = Math.min(limit, bucket.tokens + elapsed * ratePerMs);
    bucket.last = now;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterMs: 0 };
    }
    return { allowed: false, retryAfterMs: Math.ceil((1 - bucket.tokens) / ratePerMs) };
  }

  /**
   * 惰性淘汰（F5）：窗口完全流逝的桶与新桶行为等价（elapsed ≥ windowMs ⇒ 令牌必然回满），
   * 删除以防键空间无界增长（键含攻击者可控 IP/用户名）。
   */
  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.last >= bucket.windowMs) this.buckets.delete(key);
    }
  }

  /** 测试用：清空所有桶 */
  reset(): void {
    this.buckets.clear();
  }

  get size(): number {
    return this.buckets.size;
  }
}

export interface LoginBackoffOptions {
  threshold: number;
  baseMs: number;
  maxMs: number;
}

/** 退避记录的容量上限（安全审查 F5 的 LRU 选项）：正常量级（单机几十用户）永不触发，
 *  仅攻击者批量伪造用户名致记录膨胀时生效——语义说明见 evictOverflow。 */
export const MAX_BACKOFF_RECORDS = 10_000;

export class LoginBackoff {
  private readonly records = new Map<
    string,
    { count: number; blockedUntil: number; lastFailureAt: number }
  >();

  constructor(
    private readonly options: LoginBackoffOptions,
    private readonly clock: () => number = Date.now,
  ) {}

  check(usernameLower: string): { blocked: boolean; retryAfterMs: number } {
    const record = this.records.get(usernameLower);
    const now = this.clock();
    if (record && record.blockedUntil > now) {
      return { blocked: true, retryAfterMs: record.blockedUntil - now };
    }
    return { blocked: false, retryAfterMs: 0 };
  }

  recordFailure(usernameLower: string): void {
    const now = this.clock();
    const record = this.records.get(usernameLower) ?? { count: 0, blockedUntil: 0, lastFailureAt: now };
    record.count += 1;
    record.lastFailureAt = now;
    if (record.count >= this.options.threshold) {
      const factor = 2 ** (record.count - this.options.threshold);
      record.blockedUntil = now + Math.min(this.options.baseMs * factor, this.options.maxMs);
    }
    this.records.set(usernameLower, record);
    if (this.records.size > MAX_BACKOFF_RECORDS) this.evictOverflow();
  }

  recordSuccess(usernameLower: string): void {
    this.records.delete(usernameLower);
  }

  /**
   * 容量守卫（F5）：超上限时逐出「最久未失败」的 10% 防键空间无界增长。
   * 注意：失败计数没有「过期」语义（红队测试锁定：时间推进不清零——推进超过
   * 15 分钟后继续失败，退避计数必须接着涨），因此不能用时间窗清理，只能限容量。
   * 逐出只在攻击者批量伪造用户名时发生；被逐出的是长期无失败的老记录，
   * 未来若再失败会从零重爬（更宽松方向；「永不硬锁死」的安全底线不变）。
   */
  private evictOverflow(): void {
    const drop = Math.max(1, Math.floor(MAX_BACKOFF_RECORDS * 0.1));
    const ordered = [...this.records.entries()].sort(
      (a, b) => a[1].lastFailureAt - b[1].lastFailureAt,
    );
    for (let i = 0; i < drop && i < ordered.length; i += 1) {
      this.records.delete(ordered[i]![0]);
    }
  }

  /** 测试用：当前记录数 */
  get size(): number {
    return this.records.size;
  }

  /** 测试用 */
  reset(): void {
    this.records.clear();
  }
}

/**
 * IPv6 聚合到 /64 分桶；IPv4 与 IPv4-mapped 地址原样返回。
 */
export function bucketIp(ip: string): string {
  if (typeof ip !== 'string' || ip.length === 0) return 'unknown';
  if (!ip.includes(':')) return ip; // IPv4

  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1] as string;

  const [head = '', tail] = ip.includes('::') ? (ip.split('::') as [string, string?]) : [ip, undefined];
  const headParts = head.split(':').filter((p) => p.length > 0);
  if (tail === undefined) {
    return [...headParts.slice(0, 4)].join(':') + '::/64';
  }
  const tailParts = tail.split(':').filter((p) => p.length > 0);
  const missing = Math.max(0, 8 - headParts.length - tailParts.length);
  const full = [...headParts, ...Array.from({ length: missing }, () => '0'), ...tailParts];
  return full.slice(0, 4).join(':') + '::/64';
}

export interface RateLimitHit {
  key: string;
  limit: number;
  windowMs: number;
  message?: string;
}

/** 统一出口：命中限流抛 RATE_LIMITED（附 Retry-After 数据） */
export function enforceRateLimit(
  limiter: RateLimiter,
  hit: RateLimitHit,
): void {
  const result = limiter.take(hit.key, hit.limit, hit.windowMs);
  if (!result.allowed) {
    throw appError('RATE_LIMITED', hit.message ?? 'too many requests', { retryAfterMs: result.retryAfterMs });
  }
}
