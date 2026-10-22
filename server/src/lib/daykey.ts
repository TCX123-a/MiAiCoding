/**
 * 日期键工具（docs/26 §3.3/§4.4/§6.4）。
 *
 * 口径（2026-10-22 主人拍板：全部统一北京时间 UTC+8）：
 * `dateKey` = 客户端北京日 'YYYY-MM-DD'（与挑战/流水同源）；服务器日
 * （`serverDayKey`）也按北京日切，不再用 UTC 日历日。中国自 1991 年起无夏令时，
 * 固定 +08:00；不依赖宿主机 TZ 或容器时区。
 * 服务器日的实际使用面（2026-10-10 对抗核验后的清单——别再写「只有两处」，
 * 那份乐观说法曾把泄漏盖住）：
 *   ① dayKey 窗口容差（±DAY_KEY_WINDOW_DAYS 天，§6.4 ③）；
 *   ② 每日任务（jobs/daily.ts）的分桶基准与清理基准；
 *   ③ 排行榜 daily 省略 periodKey 的默认键 = 服务器日 −1（routes/leaderboard.ts，与 ② 同源）；
 *   ④ 排行榜 weekly/monthly/yearly 省略 periodKey 的默认键（服务器日推周/月/年）；
 *   ⑤ scoreToday（me.ts / leaderboard.ts）支持显式 ?dateKey= 客户端日入参
 *      （±DAY_KEY_WINDOW_DAYS 容差，吸收设备时钟偏快/手动改日）；challenge.ts 历史
 *      默认窗口的 to 取 serverDayKey() + DAY_KEY_WINDOW_DAYS（把可能超前的客户端日捞回窗内）。
 *      默认（不传 dateKey）按服务器北京日 —— 与客户端同一天，不再是「UTC 日」。
 *
 * 解析一律「形状 + 真实日期」双验（2026-02-30 必须判 false——JS Date 会把非法日
 * 溢出成 3 月 2 日，只查形状的判据会被它骗过）。
 */

import { DATE_KEY_RE, MONTH_KEY_RE, WEEK_KEY_RE, YEAR_KEY_RE } from '../protocol.js';

const DAY_MS = 86_400_000;
/** 北京时间的固定偏移。中国无夏令时，固定值安全且不依赖进程/宿主机时区。 */
const SERVER_DAY_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 严格解析 'YYYY-MM-DD' → UTC 零点的 Date；非法（形状/溢出/非日期）返回 null。
 * 用 setUTCFullYear 而不是 Date.UTC(y,…)：后者把 0~99 年映射成 1900+y（百年偏移坑）。
 */
export function parseDateKey(key: string): Date | null {
  if (typeof key !== 'string' || !DATE_KEY_RE.test(key)) return null;
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const day = Number(key.slice(8, 10));
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function isValidDateKey(key: string): boolean {
  return parseDateKey(key) !== null;
}

/** 服务器日（**北京时间 UTC+8**）'YYYY-MM-DD'。 */
export function serverDayKey(now: Date = new Date()): string {
  return new Date(now.getTime() + SERVER_DAY_OFFSET_MS).toISOString().slice(0, 10);
}

/** 服务器日（北京）零点毫秒（每日额度/退避的起点）。 */
export function startOfServerDayMs(now: Date = new Date()): number {
  const shifted = new Date(now.getTime() + SERVER_DAY_OFFSET_MS);
  const shiftedMidnightUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  return shiftedMidnightUtc - SERVER_DAY_OFFSET_MS;
}

/** 日期键平移 n 天（n 可负）。输入必须合法（路由层已保证），否则抛错。 */
export function shiftDayKey(key: string, days: number): string {
  const date = parseDateKey(key);
  if (!date) throw new Error(`invalid date key: ${key}`);
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** 日期键差值 a - b（整数天）。 */
export function diffDays(a: string, b: string): number {
  const dateA = parseDateKey(a);
  const dateB = parseDateKey(b);
  if (!dateA || !dateB) throw new Error(`invalid date key: ${a} / ${b}`);
  return Math.round((dateA.getTime() - dateB.getTime()) / DAY_MS);
}

/**
 * ISO 周键 'IYYY-Www'（周一起算；与 PG `to_char(date, 'IYYY-"W"IW')` 同口径，
 * 排行榜 weekly 的 period_key 两端同式）。
 */
export function isoWeekKey(date: Date): string {
  const d = new Date(0);
  d.setUTCFullYear(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  d.setUTCHours(0, 0, 0, 0);
  const dayNum = d.getUTCDay() || 7; // 周一=1 … 周日=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // 移到本周四：周四所在年 = ISO 周年
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(0);
  yearStart.setUTCFullYear(isoYear, 0, 1);
  yearStart.setUTCHours(0, 0, 0, 0);
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/**
 * 服务器当前 ISO 周键（按**北京日**推周）。
 * 先把瞬间落成北京日期键，再做纯日历周运算；不能直接把瞬间交给
 * isoWeekKey —— 它按 UTC 字段取年月日，北京周一 00:00–08:00 会算成上一周。
 */
export function serverWeekKey(now: Date = new Date()): string {
  return isoWeekKey(parseDateKey(serverDayKey(now))!);
}

/** 校验 ISO 周键：形状 + 该 ISO 年确实存在这一周（W53 只在部分年份存在）。 */
export function isValidWeekKey(key: string): boolean {
  if (typeof key !== 'string' || !WEEK_KEY_RE.test(key)) return false;
  const isoYear = Number(key.slice(0, 4));
  const week = Number(key.slice(6, 8));
  if (week < 1 || week > 53) return false;
  const dec28 = new Date(0);
  dec28.setUTCFullYear(isoYear, 11, 28); // 12-28 必在最后一周（ISO 8601）
  dec28.setUTCHours(0, 0, 0, 0);
  const lastWeek = Number(isoWeekKey(dec28).slice(6));
  return week <= lastWeek;
}

/**
 * ISO 周键 → 该周 [周一, 周日] 的日期键（排行榜 weekly 的 date_key 范围过滤用）。
 * 锚点 = 该 ISO 年的 1 月 4 日（ISO 8601：它必在第 1 周），再平移到第 week 周的周一。
 * 非法键返回 null。
 */
export function isoWeekRange(key: string): { from: string; to: string } | null {
  if (!isValidWeekKey(key)) return null;
  const isoYear = Number(key.slice(0, 4));
  const week = Number(key.slice(6, 8));
  const jan4 = new Date(0);
  jan4.setUTCFullYear(isoYear, 0, 4);
  jan4.setUTCHours(0, 0, 0, 0);
  const dayNum = jan4.getUTCDay() || 7; // 周一=1 … 周日=7
  const monday = new Date(jan4.getTime() - (dayNum - 1) * DAY_MS + (week - 1) * 7 * DAY_MS);
  return {
    from: monday.toISOString().slice(0, 10),
    to: new Date(monday.getTime() + 6 * DAY_MS).toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------- 月键 / 年键（2026-10-10 排行榜改版）

/** 月键 'YYYY-MM'（服务器北京日所属月；排行榜 monthly 的 period_key）。输入日期键必须合法。 */
export function serverMonthKey(dateKey: string): string {
  if (!isValidDateKey(dateKey)) throw new Error(`invalid date key: ${dateKey}`);
  return dateKey.slice(0, 7);
}

/** 年键 'YYYY'（服务器北京日所属年；排行榜 yearly 的 period_key）。输入日期键必须合法。 */
export function serverYearKey(dateKey: string): string {
  if (!isValidDateKey(dateKey)) throw new Error(`invalid date key: ${dateKey}`);
  return dateKey.slice(0, 4);
}

/** 校验月键：形状（MONTH_KEY_RE）+ 月份真实存在（1~12；形状本身会放过 2026-13）。 */
export function isValidMonthKey(key: string): boolean {
  if (typeof key !== 'string' || !MONTH_KEY_RE.test(key)) return false;
  const month = Number(key.slice(5, 7));
  return month >= 1 && month <= 12;
}

/** 校验年键：形状（YEAR_KEY_RE = 四位数字年）。 */
export function isValidYearKey(key: string): boolean {
  return typeof key === 'string' && YEAR_KEY_RE.test(key);
}

/**
 * 月键 → 该月 [首日, 末日] 的日期键（排行榜 monthly 的 date_key 范围过滤用）。
 * 末日 = 下月第 0 天（自动吃闰年：2028-02 → 2028-02-29）。非法键返回 null。
 */
export function isoMonthRange(key: string): { from: string; to: string } | null {
  if (!isValidMonthKey(key)) return null;
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const first = new Date(0);
  first.setUTCFullYear(year, month - 1, 1);
  first.setUTCHours(0, 0, 0, 0);
  const last = new Date(0);
  last.setUTCFullYear(year, month, 0);
  last.setUTCHours(0, 0, 0, 0);
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/** 年键 → 该年 [年初, 年末] 的日期键（排行榜 yearly 的 date_key 范围过滤用）。非法键返回 null。 */
export function isoYearRange(key: string): { from: string; to: string } | null {
  if (!isValidYearKey(key)) return null;
  return { from: `${key}-01-01`, to: `${key}-12-31` };
}
