/**
 * 日志脱敏测试（docs/22 §5.8：密码 / 令牌绝不落日志）。
 * 用真 pino + 真 fastify + 生产同一份 createLoggerOptions，输出捕获到流里做断言。
 * 负对照：非敏感头（x-trace-id）必须原样出现在日志里——证明「日志确实记了这次请求」，
 * 否则 not.toContain(令牌) 会因「什么都没记」而假绿。
 */
import { PassThrough } from 'node:stream';
import { fastify } from 'fastify';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createLoggerOptions, LOG_REDACT_CENSOR } from '../../src/logger.js';

function captureStream(): { stream: PassThrough; output: () => string } {
  const chunks: string[] = [];
  const stream = new PassThrough();
  stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')));
  return { stream, output: () => chunks.join('') };
}

describe('日志脱敏（生产同一份 redact 配置）', () => {
  it('Authorization / Cookie 落日志时被替换为 [REDACTED]；非敏感头原样可见', async () => {
    const { stream, output } = captureStream();
    // fastify v5 的 logger 只收配置对象（不再收 pino 实例）；stream 走 pino 配置透传。
    // 自定义 req 序列化器把 headers 写进日志——这正是 redact 路径要挡的最坏情形
    // （fastify 默认 req 序列化不含 headers，脱敏配置是二层防线）。
    const app = fastify({
      logger: {
        ...createLoggerOptions('info'),
        stream,
        serializers: { req: (req: { method: string; url: string; headers: unknown }) => ({
          method: req.method,
          url: req.url,
          headers: req.headers,
        }) },
      },
    });
    app.get('/probe', async () => ({ ok: true }));
    await app.ready();

    const token = `ms1_${'S'.repeat(43)}`;
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: {
        authorization: `Bearer ${token}`,
        cookie: 'session=secret-cookie-value',
        'x-trace-id': 'trace-visible-42',
      },
    });
    expect(res.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    await app.close();

    const text = output();
    expect(text).toContain('trace-visible-42'); // 负对照：日志确实记了这次请求
    expect(text).toContain(LOG_REDACT_CENSOR);
    expect(text).not.toContain(token);
    expect(text).not.toContain('secret-cookie-value');
  });

  it('顶层 password / token 字段也被脱敏（兜底路径）', async () => {
    const { stream, output } = captureStream();
    const log = pino(createLoggerOptions('info'), stream);
    log.info(
      { password: 'hunter2-secret', token: 'tok-secret-value', safe: 'visible-field' },
      'audit probe',
    );
    await new Promise((resolve) => setImmediate(resolve));
    const text = output();
    expect(text).toContain('visible-field'); // 负对照
    expect(text).not.toContain('hunter2-secret');
    expect(text).not.toContain('tok-secret-value');
  });
});
