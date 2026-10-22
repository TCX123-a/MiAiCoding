/**
 * createPool 的 'error' 监听（D3，2026-10-17）。
 *
 * 【这条测试在守什么】pg.Pool 的空闲连接出错时会 emit('error')；EventEmitter 的
 * 'error' 事件没有监听 = 未处理异常 = 进程直接崩。这里钉两件事：监听器确实挂着
 * （listenerCount ≥ 1），并且 emit 时只出声（console.error）不抛。
 *
 * 不建任何连接：new pg.Pool 是惰性的，end() 只清内部定时器。
 */
import { describe, expect, it, vi } from 'vitest';
import { createPool } from '../../src/db/pool.js';
import type { AppConfig } from '../../src/config.js';

// createPool 只读 databaseUrl；其余字段与本测试无关。
const config = { databaseUrl: 'postgres://u:p@127.0.0.1:1/none' } as AppConfig;

describe("createPool：空闲连接错误不拖垮进程", () => {
  it("挂载 'error' 监听；emit 只出声、不抛", async () => {
    const pool = createPool(config);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(pool.listenerCount('error')).toBeGreaterThan(0);
      expect(() => pool.emit('error', new Error('idle client died'))).not.toThrow();
      expect(spy).toHaveBeenCalled();
      expect(String(spy.mock.calls[0]?.[0] ?? '')).toContain('[pg]');
    } finally {
      spy.mockRestore();
      await pool.end();
    }
  });
});
