import { describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMITS, loadConfig } from '../../src/config.js';

const BASE_ENV = { DATABASE_URL: 'postgres://app:pw@127.0.0.1:5432/miai' };

describe('loadConfig（缺必填项启动即失败）', () => {
  it('缺 DATABASE_URL → 抛错', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: '   ' })).toThrow(/DATABASE_URL/);
  });

  it('NODE_ENV 非法 → 抛错', () => {
    expect(() => loadConfig({ ...BASE_ENV, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('开发环境默认值：127.0.0.1:8787 / info / docs/22 限流默认', () => {
    const config = loadConfig(BASE_ENV);
    expect(config.nodeEnv).toBe('development');
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(8787);
    expect(config.logLevel).toBe('info');
    expect(config.rates).toEqual(DEFAULT_RATE_LIMITS);
    expect(config.migrationDatabaseUrl).toBeUndefined();
  });

  it('生产环境强制迁移连接串分离（缺失或相同 → 拒绝启动）', () => {
    expect(() => loadConfig({ ...BASE_ENV, NODE_ENV: 'production' })).toThrow(/MIGRATION_DATABASE_URL/);
    expect(() =>
      loadConfig({
        ...BASE_ENV,
        NODE_ENV: 'production',
        MIGRATION_DATABASE_URL: BASE_ENV.DATABASE_URL,
      }),
    ).toThrow(/不得相同/);
    const ok = loadConfig({
      ...BASE_ENV,
      NODE_ENV: 'production',
      MIGRATION_DATABASE_URL: 'postgres://owner:pw@127.0.0.1:5432/miai',
    });
    expect(ok.nodeEnv).toBe('production');
    expect(ok.migrationDatabaseUrl).toContain('owner');
  });
});

describe('loadConfig（RATE_LIMIT_* 覆写校验）', () => {
  it('合法覆写生效', () => {
    const config = loadConfig({ ...BASE_ENV, RATE_LIMIT_API_PER_MINUTE: '60', PORT: '9000' });
    expect(config.rates.apiPerMinute).toBe(60);
    expect(config.rates.registerPerHourPerIp).toBe(DEFAULT_RATE_LIMITS.registerPerHourPerIp);
    expect(config.port).toBe(9000);
  });

  it('0 / 负数 / 小数 / 非数字 → 抛错（不允许静默回退）', () => {
    for (const bad of ['0', '-3', '1.5', 'abc']) {
      expect(() => loadConfig({ ...BASE_ENV, RATE_LIMIT_API_PER_MINUTE: bad })).toThrow(/RATE_LIMIT_API_PER_MINUTE/);
      expect(() => loadConfig({ ...BASE_ENV, PORT: bad })).toThrow(/PORT/);
    }
  });
});
