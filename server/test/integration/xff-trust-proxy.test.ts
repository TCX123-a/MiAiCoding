/**
 * docs/22 §5.5 点名的 trustProxy 种坏值验收（安全审查 F7 点名缺此测试）：
 *  臂 A（默认，不设 TRUST_PROXY_CIDR）：伪造 X-Forwarded-For 必须被忽略——同桶计数；
 *  臂 B（正对照，TRUST_PROXY_CIDR=127.0.0.1/32）：同一发包伪造 XFF 可切桶（200 登录成功）。
 * 臂 B 的作用：证明臂 A 的「忽略」是探针敏感的结果，不是尺子恒绿；
 * 反向种坏：去掉实现里的 trustProxy 接线（app.ts），臂 B 必红（第二发落 429）。
 * 手法：loginPer15MinPerIp=1 的小桶——第一发错密码（401，耗净仅有的令牌），第二发带伪造 XFF。
 */
import { describe, expect, it } from 'vitest';
import { createTestContext, login, register, TEST_PASSWORD } from '../helpers/app.js';

describe('trustProxy 种坏值验收（XFF 信任边界）', () => {
  it('臂 A：默认不信任 XFF——伪造头被忽略（第二发同桶 429）', async () => {
    const ctx = await createTestContext({ rateLimits: { loginPer15MinPerIp: 1 } });
    const reg = await register(ctx.app, 'xff_user');
    expect(reg.statusCode).toBe(201);

    const first = await login(ctx.app, 'xff_user', 'definitely-wrong-password');
    expect(first.statusCode).toBe(401); // 消耗仅有的 1 个令牌

    const forged = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-forwarded-for': '9.9.9.9' },
      payload: { username: 'xff_user', password: TEST_PASSWORD },
    });
    expect(forged.statusCode).toBe(429); // XFF 未获信任 → 仍按 127.0.0.1 的同桶计数
    expect(forged.json().error.code).toBe('RATE_LIMITED');
    await ctx.raw.close();
  });

  it('臂 B 正对照：TRUST_PROXY_CIDR=127.0.0.1/32 时伪造 XFF 切桶（第二发 200）', async () => {
    const ctx = await createTestContext({
      rateLimits: { loginPer15MinPerIp: 1 },
      env: { TRUST_PROXY_CIDR: '127.0.0.1/32' },
    });
    const reg = await register(ctx.app, 'xff_user');
    expect(reg.statusCode).toBe(201);

    const first = await login(ctx.app, 'xff_user', 'definitely-wrong-password');
    expect(first.statusCode).toBe(401);

    const forged = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-forwarded-for': '9.9.9.9' },
      payload: { username: 'xff_user', password: TEST_PASSWORD },
    });
    expect(forged.statusCode).toBe(200); // XFF 生效 → 新桶 → 密码正确，登录成功
    await ctx.raw.close();
  });
});
