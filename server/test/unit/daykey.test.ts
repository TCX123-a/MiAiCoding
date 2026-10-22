/**
 * 日期键工具单测（docs/26 §4.5/§6.4 的键口径）。
 * 判据自检：每个「非法」断言都配了相邻的「合法」断言（只有两边都钉住，才排除
 * 「parser 恒返回 null」这类恒真判据）。
 */
import { describe, expect, it } from 'vitest';
import {
  diffDays,
  isValidDateKey,
  isValidMonthKey,
  isValidWeekKey,
  isValidYearKey,
  isoMonthRange,
  isoWeekKey,
  isoWeekRange,
  isoYearRange,
  parseDateKey,
  serverDayKey,
  serverMonthKey,
  serverWeekKey,
  serverYearKey,
  shiftDayKey,
} from '../../src/lib/daykey.js';

describe('parseDateKey / isValidDateKey', () => {
  it('合法日期：普通日、闰日、两位年份（setUTCFullYear 而非 Date.UTC 的百年偏移坑）', () => {
    expect(parseDateKey('2026-10-08')?.toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(isValidDateKey('2024-02-29')).toBe(true); // 闰年
    expect(parseDateKey('0099-12-31')?.getUTCFullYear()).toBe(99); // Date.UTC 会给出 1999
  });

  it('非法日期：形状错、月/日越界、非闰年 2-29、假日期（JS Date 会静默溢出）', () => {
    expect(isValidDateKey('2026-2-08')).toBe(false);
    expect(isValidDateKey('2026/10/08')).toBe(false);
    expect(isValidDateKey('2026-13-01')).toBe(false);
    expect(isValidDateKey('2026-00-10')).toBe(false);
    expect(isValidDateKey('2026-02-30')).toBe(false); // 溢出成 3 月 2 日的那种
    expect(isValidDateKey('2026-02-29')).toBe(false); // 2026 不是闰年
    expect(isValidDateKey('')).toBe(false);
  });
});

describe('serverDayKey / shiftDayKey / diffDays', () => {
  it('服务器日按北京时间切（UTC 15:59:59.999 仍属当日，16:00:00 翻页）', () => {
    expect(serverDayKey(new Date('2026-10-08T15:59:59.999Z'))).toBe('2026-10-08');
    expect(serverDayKey(new Date('2026-10-08T16:00:00.000Z'))).toBe('2026-10-09');
    // 北京 00:00–08:00 是最容易错的那 8 小时：老写法（toISOString().slice(0,10)）会差一天
    expect(serverDayKey(new Date('2026-10-08T00:30:00.000Z'))).toBe('2026-10-08');
    expect(serverDayKey(new Date('2026-10-08T04:00:00.000Z'))).toBe('2026-10-08');
  });

  it('平移跨月跨年，负数回退', () => {
    expect(shiftDayKey('2026-10-08', 1)).toBe('2026-10-09');
    expect(shiftDayKey('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDayKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDayKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDayKey('2026-10-08', 0)).toBe('2026-10-08');
  });

  it('差值带符号且为整数', () => {
    expect(diffDays('2026-10-08', '2026-10-07')).toBe(1);
    expect(diffDays('2026-10-07', '2026-10-08')).toBe(-1);
    expect(diffDays('2026-10-08', '2026-10-08')).toBe(0);
    expect(diffDays('2027-01-01', '2026-12-31')).toBe(1);
  });

  it('每日任务的日键口径：北京 2026-10-22 01:00 → 铸 2026-10-21 的快照', () => {
    // 原口径（UTC）在同一瞬间算出的 serverToday 是 2026-10-21、referenceDay 是 2026-10-20，
    // 即北京凌晨 0–8 点铸的是「前天」的快照。这条把「刚过北京午夜就铸昨天」钉死。
    const now = new Date('2026-10-21T17:00:00.000Z'); // 北京 2026-10-22 01:00
    const serverToday = serverDayKey(now);
    expect(serverToday).toBe('2026-10-22');
    expect(shiftDayKey(serverToday, -1)).toBe('2026-10-21');
  });
});

describe('isoWeekKey / isValidWeekKey', () => {
  it('docs/26 §4.5 的样例周：2026-10-08 属 2026-W41', () => {
    expect(isoWeekKey(new Date('2026-10-08T12:00:00Z'))).toBe('2026-W41');
    expect(serverWeekKey(new Date('2026-10-08T12:00:00Z'))).toBe('2026-W41');
  });

  it('serverWeekKey 以北京日为准：周日 23:30（北京）仍属本周，周一 00:30 才进下一周', () => {
    // 2026-10-11 是周日、2026-10-12 是周一
    expect(serverWeekKey(new Date('2026-10-11T15:30:00.000Z'))).toBe('2026-W41'); // 北京 10-11 23:30
    expect(serverWeekKey(new Date('2026-10-11T16:30:00.000Z'))).toBe('2026-W42'); // 北京 10-12 00:30
  });

  it('ISO 年头尾：周四开年的 1 月 1 日属本年 W01；2027-01-01（周五）属 2026-W53', () => {
    expect(isoWeekKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-W01');
    expect(isoWeekKey(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53'); // 2026 是 53 周年
  });

  it('周键校验：存在性（W53 论年）、形状、边界', () => {
    expect(isValidWeekKey('2026-W53')).toBe(true);
    expect(isValidWeekKey('2025-W53')).toBe(false); // 2025 只有 52 周
    expect(isValidWeekKey('2026-W54')).toBe(false);
    expect(isValidWeekKey('2026-W00')).toBe(false);
    expect(isValidWeekKey('2026-41')).toBe(false);
    expect(isValidWeekKey('2026-10-08')).toBe(false);
  });
});

describe('isoWeekRange（排行榜 weekly 的 date_key 范围）', () => {
  it('手算锚点：2026-W01 = 2025-12-29（周一）~ 2026-01-04（周日）', () => {
    // 2026-01-01 是周四 → 它所在周（W01）的周一是 2025-12-29
    expect(isoWeekRange('2026-W01')).toEqual({ from: '2025-12-29', to: '2026-01-04' });
  });

  it('往返自洽：from 是周一、含键内任一日、to−from=6 天、两端同周键', () => {
    const samples = [
      '2026-10-08T12:00:00Z', // docs 样例：2026-W41
      '2027-01-01T00:00:00Z', // 跨年：属 2026-W53
      '2025-12-30T00:00:00Z', // 属 2026-W01（跨年反向）
      '2024-02-29T00:00:00Z',
    ];
    for (const iso of samples) {
      const key = isoWeekKey(new Date(iso));
      const range = isoWeekRange(key);
      expect(range).not.toBeNull();
      const { from, to } = range!;
      const fromDate = parseDateKey(from)!;
      expect(fromDate.getUTCDay()).toBe(1); // 周一
      expect(diffDays(to, from)).toBe(6);
      expect(diffDays(iso.slice(0, 10), from)).toBeGreaterThanOrEqual(0);
      expect(diffDays(iso.slice(0, 10), to)).toBeLessThanOrEqual(0);
      expect(isoWeekKey(fromDate)).toBe(key);
      expect(isoWeekKey(parseDateKey(to)!)).toBe(key);
    }
  });

  it('非法周键一律 null（形状错 / 不存在的 W53 / 非周键）', () => {
    expect(isoWeekRange('2026-W54')).toBeNull();
    expect(isoWeekRange('2025-W53')).toBeNull();
    expect(isoWeekRange('2026-10-08')).toBeNull();
    expect(isoWeekRange('')).toBeNull();
  });
});

// ---------------------------------------------------------------- 月键 / 年键（2026-10-10 改版）

describe('serverMonthKey / serverYearKey（排行榜 monthly/yearly 的 period_key）', () => {
  it('从日期键取月/年；跨年边界照实（12-31 → 本年，01-01 → 次年）', () => {
    expect(serverMonthKey('2026-10-08')).toBe('2026-10');
    expect(serverMonthKey('2026-02-28')).toBe('2026-02');
    expect(serverMonthKey('2026-12-31')).toBe('2026-12');
    expect(serverYearKey('2026-12-31')).toBe('2026');
    expect(serverYearKey('2027-01-01')).toBe('2027');
  });

  it('非法日期键抛错（不静默取前七位/前四位）', () => {
    expect(() => serverMonthKey('2026-02-30')).toThrow(/invalid date key/);
    expect(() => serverMonthKey('')).toThrow(/invalid date key/);
    expect(() => serverYearKey('2026-13-01')).toThrow(/invalid date key/);
    expect(() => serverYearKey('not-a-date')).toThrow(/invalid date key/);
  });
});

describe('isValidMonthKey / isValidYearKey', () => {
  it('月键：真实存在的月（01~12）合法；00/13 非法（形状正则本身会放过 13）', () => {
    expect(isValidMonthKey('2026-01')).toBe(true);
    expect(isValidMonthKey('2026-12')).toBe(true);
    expect(isValidMonthKey('2026-00')).toBe(false);
    expect(isValidMonthKey('2026-13')).toBe(false);
    expect(isValidMonthKey('2026-1')).toBe(false);
    expect(isValidMonthKey('2026-10-08')).toBe(false);
    expect(isValidMonthKey('')).toBe(false);
  });

  it('年键：四位数字年合法（含两位年份写法 0099），其余形状非法', () => {
    expect(isValidYearKey('2026')).toBe(true);
    expect(isValidYearKey('0099')).toBe(true);
    expect(isValidYearKey('26')).toBe(false);
    expect(isValidYearKey('2026-10')).toBe(false);
    expect(isValidYearKey('20261')).toBe(false);
    expect(isValidYearKey('')).toBe(false);
  });
});

describe('isoMonthRange / isoYearRange（排行榜 monthly/yearly 的 date_key 范围）', () => {
  it('平年 2 月：2026-02 → 02-01..02-28', () => {
    expect(isoMonthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('闰年 2 月：2028-02 → 02-01..02-29（末日的下月第 0 天算法自动吃闰年）', () => {
    expect(isoMonthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('大小月：12 月收在次年跨界的 12-31；6 月收在 06-30', () => {
    expect(isoMonthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(isoMonthRange('2026-06')).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    expect(isoMonthRange('2026-01')).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });

  it('年键范围：2026 → 全年；2026-12-31 在界内、2027-01-01 在界外', () => {
    expect(isoYearRange('2026')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(diffDays('2026-12-31', isoYearRange('2026')!.to)).toBe(0);
    expect(diffDays('2027-01-01', isoYearRange('2026')!.to)).toBe(1);
  });

  it('往返自洽：任一日期键落在自己的月范围内，且 range 两端同月键', () => {
    for (const dateKey of ['2026-10-08', '2026-02-28', '2028-02-29', '2026-12-31', '2027-01-01']) {
      const key = serverMonthKey(dateKey);
      const range = isoMonthRange(key);
      expect(range).not.toBeNull();
      const { from, to } = range!;
      expect(diffDays(dateKey, from)).toBeGreaterThanOrEqual(0);
      expect(diffDays(dateKey, to)).toBeLessThanOrEqual(0);
      expect(serverMonthKey(from)).toBe(key);
      expect(serverMonthKey(to)).toBe(key);
    }
  });

  it('非法键一律 null（月份不存在 / 形状错 / 非月键、非年键）', () => {
    expect(isoMonthRange('2026-13')).toBeNull();
    expect(isoMonthRange('2026-00')).toBeNull();
    expect(isoMonthRange('2026-10-08')).toBeNull();
    expect(isoMonthRange('')).toBeNull();
    expect(isoYearRange('2026-10')).toBeNull();
    expect(isoYearRange('26')).toBeNull();
    expect(isoYearRange('')).toBeNull();
  });
});
