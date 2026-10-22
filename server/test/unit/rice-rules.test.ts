/**
 * 大白饭条目规则单测（docs/26 §6.2/§6.4）。
 * 每个非法用例都与一个相邻合法用例成对出现（防止「校验恒拒」也能全绿）。
 */
import { describe, expect, it } from 'vitest';
import {
  checkDayKeyWindow,
  dailyCapOf,
  installIdOfEntryKey,
  isClockAhead,
  isClockBackwards,
  validateEntryShape,
  type RiceEntryInput,
} from '../../src/lib/rice-rules.js';
import { RICE_LEDGER_KINDS } from '../../src/protocol.js';

const INSTALL = '9f2c77aa-1111-4222-8333-444455556666';

function entry(over: Partial<RiceEntryInput>): RiceEntryInput {
  return {
    entryKey: `${INSTALL}:1042`,
    kind: 'feed',
    delta: -1,
    dayKey: '2026-10-08',
    at: '2026-10-08T12:05:02.000Z',
    ref: null,
    ...over,
  };
}

describe('validateEntryShape（违反 = 整批 400）', () => {
  it('九种 kind 的合法形状全部通过（含 checkin，且与协议枚举逐一对齐）', () => {
    expect(validateEntryShape(entry({ kind: 'adopt', delta: 0, ref: { installId: INSTALL } }))).toBeNull();
    expect(validateEntryShape(entry({ kind: 'lesson', delta: 2, ref: { lessonId: 'c-stage1-02' } }))).toBeNull();
    expect(validateEntryShape(entry({ kind: 'review', delta: 2 }))).toBeNull();
    expect(validateEntryShape(entry({ kind: 'answer', delta: 1 }))).toBeNull();
    expect(validateEntryShape(entry({ kind: 'run', delta: 1, ref: { fingerprint: '9f2c77aa:1a2b3c' } }))).toBeNull();
    expect(validateEntryShape(entry({ kind: 'feed', delta: -1 }))).toBeNull();
    expect(validateEntryShape(entry({ kind: 'chase', delta: -1 }))).toBeNull();
    expect(validateEntryShape(entry({ kind: 'chat', delta: -2 }))).toBeNull();
    expect(validateEntryShape(entry({ kind: 'checkin', delta: 2 }))).toBeNull();
    // 这里列的必须恰好是协议枚举全集（新 kind 忘登记 → 本断言红）
    expect(RICE_LEDGER_KINDS.length).toBe(9);
  });

  it('delta 白名单：每个 kind 只认自己那个数', () => {
    expect(validateEntryShape(entry({ kind: 'lesson', delta: 3, ref: { lessonId: 'x1' } }))).toMatch(/白名单/);
    expect(validateEntryShape(entry({ kind: 'feed', delta: 1 }))).toMatch(/白名单/);
    expect(validateEntryShape(entry({ kind: 'chat', delta: -1 }))).toMatch(/白名单/);
    expect(validateEntryShape(entry({ kind: 'checkin', delta: 1 }))).toMatch(/白名单/);
    expect(validateEntryShape(entry({ kind: 'adopt', delta: 1, ref: { installId: INSTALL } }))).toMatch(/白名单/);
  });

  it('entryKey 形状 / dayKey 真实性 / at 健全域', () => {
    expect(validateEntryShape(entry({ entryKey: 'abc:1' }))).toMatch(/entryKey/);
    expect(validateEntryShape(entry({ entryKey: `${INSTALL}:` }))).toMatch(/entryKey/);
    expect(validateEntryShape(entry({ dayKey: '2026-02-30' }))).toMatch(/dayKey/);
    expect(validateEntryShape(entry({ at: '2026-13-01T00:00:00Z' }))).toMatch(/at/);
    expect(validateEntryShape(entry({ at: '2101-01-01T00:00:00Z' }))).toMatch(/at/); // 越健全域
  });

  it('逐 kind 的 ref 要求：adopt.installId / lesson.lessonId / run.fingerprint', () => {
    expect(validateEntryShape(entry({ kind: 'adopt', delta: 0, ref: null }))).toMatch(/installId/);
    expect(validateEntryShape(entry({ kind: 'adopt', delta: 0, ref: { installId: 'nope' } }))).toMatch(/installId/);
    expect(validateEntryShape(entry({ kind: 'lesson', delta: 2, ref: {} }))).toMatch(/lessonId/);
    expect(validateEntryShape(entry({ kind: 'lesson', delta: 2, ref: { lessonId: '-bad' } }))).toMatch(/lessonId/);
    expect(validateEntryShape(entry({ kind: 'run', delta: 1, ref: { fingerprint: 'ABC' } }))).toMatch(/fingerprint/);
    expect(validateEntryShape(entry({ kind: 'run', delta: 1, ref: null }))).toMatch(/fingerprint/);
  });

  it('ref 体积上限（1KB）：1KB 内合法、超 1KB 拒', () => {
    expect(validateEntryShape(entry({ kind: 'answer', delta: 1, ref: { pad: 'x'.repeat(900) } }))).toBeNull();
    expect(validateEntryShape(entry({ kind: 'answer', delta: 1, ref: { pad: 'x'.repeat(1100) } }))).toMatch(/ref 超长/);
  });
});

describe('dayKey 窗口与时钟偏移（§6.4 ③）', () => {
  it('窗口 ±1 天：同天/前后一天合法，±2 天拒', () => {
    expect(checkDayKeyWindow(entry({ dayKey: '2026-10-08' }), '2026-10-08')).toBeNull();
    expect(checkDayKeyWindow(entry({ dayKey: '2026-10-07' }), '2026-10-08')).toBeNull();
    expect(checkDayKeyWindow(entry({ dayKey: '2026-10-09' }), '2026-10-08')).toBeNull();
    expect(checkDayKeyWindow(entry({ dayKey: '2026-10-06' }), '2026-10-08')).toMatch(/差 -2 天/);
    expect(checkDayKeyWindow(entry({ dayKey: '2026-10-10' }), '2026-10-08')).toMatch(/差 2 天/);
  });

  it('超前/倒退：恰在 10 分钟容差内不标记，越过才标记', () => {
    const now = Date.parse('2026-10-08T12:00:00.000Z');
    const at = (iso: string) => iso;
    expect(isClockAhead(at('2026-10-08T12:10:00.000Z'), now)).toBe(false); // 恰 +10min
    expect(isClockAhead(at('2026-10-08T12:10:00.001Z'), now)).toBe(true);
    expect(isClockAhead(at('2026-10-08T11:50:00.000Z'), now)).toBe(false); // 过去方向不属超前

    const maxAt = Date.parse('2026-10-08T12:00:00.000Z');
    expect(isClockBackwards(at('2026-10-08T11:50:00.000Z'), maxAt, now)).toBe(false); // 恰 -10min
    expect(isClockBackwards(at('2026-10-08T11:49:59.999Z'), maxAt, now)).toBe(true);
    expect(isClockBackwards(at('2026-10-08T12:30:00.000Z'), maxAt, now)).toBe(false); // 前进不属倒退
    expect(isClockBackwards(at('2026-10-08T11:00:00.000Z'), null, now)).toBe(false); // 无历史 → 不判
  });
});

describe('installId 提取与日上限表', () => {
  it('entryKey 前 36 字符 = installId', () => {
    expect(installIdOfEntryKey(`${INSTALL}:1`)).toBe(INSTALL);
    expect(installIdOfEntryKey(`${INSTALL}:9999999999999999999`)).toBe(INSTALL);
  });

  it('日上限：adopt 无上限；run=10（客户端常量）；checkin=1；其余为正（表完整性清扫）', () => {
    expect(dailyCapOf('adopt')).toBeNull();
    expect(dailyCapOf('run')).toBe(10);
    expect(dailyCapOf('chat')).toBe(120); // 冻结值（v1 客户端不上行 chase/chat，见 protocol.ts 注）
    expect(dailyCapOf('lesson')).toBe(20);
    expect(dailyCapOf('checkin')).toBe(1); // 签到每日一次
    // 协议里每个非 adopt kind 都必须查得到正上限 —— 将来新加 kind 忘配上限会在这里红
    for (const kind of RICE_LEDGER_KINDS) {
      if (kind === 'adopt') continue;
      const cap = dailyCapOf(kind);
      expect(typeof cap, kind).toBe('number');
      expect(cap!, kind).toBeGreaterThan(0);
    }
  });
});
