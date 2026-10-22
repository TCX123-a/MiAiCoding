/**
 * 大白饭流水条目规则（docs/26 §6.2 白名单 / §6.4 四层防刷）。
 *
 * 分工：zod 只管**形状**（字符串/枚举/ISO 时间）；本模块管**语义**——
 *   ① delta 白名单（防伪造地基：一条最多只能说自己是多少，报错即整批 400）；
 *   ② entryKey 形状与 installId 提取；ref 逐 kind 要求（lesson.lessonId / run.fingerprint / adopt.installId）；
 *   ③ dayKey 窗口（±1 天，超窗逐条归入 rejected[]，HTTP 仍 200）；
 *   ④ 时钟偏移与 run 指纹复用 → flag（照收不拒，§6.4「不罚诚实用户」）。
 *
 * 服务端不可见的边界（记录在案，见《后端开发进度清单》）：
 *   · adopt「必须是最早条目」是客户端账本内的时序不变式（服务器看不到箱内顺序）——服务端只强制
 *     「delta==0 + ref.installId + 每 (account, installId) 至多一条」；
 *   · lesson 累计 vs profile.learned 的交叉核对在每日任务里做（那里才读得到 user_docs）。
 */

import {
  CLOCK_SKEW_TOLERANCE_MS,
  DAY_KEY_WINDOW_DAYS,
  RICE_DAILY_CAP_BY_KIND,
  RICE_DELTA_BY_KIND,
  RICE_ENTRY_KEY_RE,
  RICE_RUN_FINGERPRINT_RE,
  type RiceKind,
} from '../protocol.js';
import { diffDays, isValidDateKey } from './daykey.js';
import { parseSaneTimestamp } from './util.js';

/** 流水条目 flag 名（docs/26 §6.4「记 flag」未定名，此处定名并登记） */
export const RICE_FLAG_CLOCK_SKEW = 'clock_skew';
export const RICE_FLAG_FINGERPRINT_REUSE = 'fingerprint_reuse';

/** lessonId 形状（docs/26 §6.2「ref.lessonId 形状合法」未给正则，此处定 `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`） */
export const RICE_LESSON_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** ref 单条 JSON 序列化字节上限（防御性；正常条目 <100B，1KB 是 10 倍余量） */
export const RICE_REF_MAX_BYTES = 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RiceEntryInput {
  entryKey: string;
  kind: RiceKind;
  delta: number;
  dayKey: string;
  at: string;
  ref: Record<string, unknown> | null;
}

/** entryKey 前缀 = installId（键形状 `${installId}:${localSeq}`，格式已由正则保证）。 */
export function installIdOfEntryKey(entryKey: string): string {
  return entryKey.slice(0, 36);
}

/** kind 的日上限（adopt 无上限：一生唯一性由 §6.1 规则管）。 */
export function dailyCapOf(kind: RiceKind): number | null {
  return kind === 'adopt' ? null : RICE_DAILY_CAP_BY_KIND[kind];
}

/**
 * 条目形状/白名单校验（违反 → **整批 400**，因为这意味着客户端在说另一种语言）。
 * 返回错误 detail；合法返回 null。
 */
export function validateEntryShape(entry: RiceEntryInput): string | null {
  if (!RICE_ENTRY_KEY_RE.test(entry.entryKey)) {
    return `entryKey 形状非法（应为 installId:localSeq）：${entry.entryKey}`;
  }
  const expectedDelta = RICE_DELTA_BY_KIND[entry.kind];
  if (entry.delta !== expectedDelta) {
    return `delta 与 kind 白名单不符：${entry.kind} 必须 == ${expectedDelta}（收到 ${entry.delta}）`;
  }
  if (!isValidDateKey(entry.dayKey)) {
    return `dayKey 不是真实日期：${entry.dayKey}`;
  }
  if (parseSaneTimestamp(entry.at) === null) {
    return `at 不是有效时间戳：${entry.at}`;
  }
  if (entry.ref !== null) {
    const refBytes = Buffer.byteLength(JSON.stringify(entry.ref), 'utf8');
    if (refBytes > RICE_REF_MAX_BYTES) {
      return `ref 超长（${refBytes} > ${RICE_REF_MAX_BYTES} 字节）：${entry.entryKey}`;
    }
  }

  switch (entry.kind) {
    case 'adopt': {
      const installId = entry.ref?.installId;
      if (typeof installId !== 'string' || !UUID_RE.test(installId)) {
        return `adopt 必须带 ref.installId（uuid）：${entry.entryKey}`;
      }
      return null;
    }
    case 'lesson': {
      const lessonId = entry.ref?.lessonId;
      if (typeof lessonId !== 'string' || !RICE_LESSON_ID_RE.test(lessonId)) {
        return `lesson 必须带形状合法的 ref.lessonId：${entry.entryKey}`;
      }
      return null;
    }
    case 'run': {
      const fingerprint = entry.ref?.fingerprint;
      if (typeof fingerprint !== 'string' || !RICE_RUN_FINGERPRINT_RE.test(fingerprint)) {
        return `run 必须带匹配形状的 ref.fingerprint：${entry.entryKey}`;
      }
      return null;
    }
    default:
      return null; // review/answer/feed/checkin/chase/chat：ref 选填、不校验内容
  }
}

/**
 * dayKey 窗口（§6.4 ③）：与服务器北京日差 > ±DAY_KEY_WINDOW_DAYS 天 → 拒。
 * 返回拒绝 detail 或 null。调用方把拒收条目放进 rejected[]（HTTP 仍 200）。
 */
export function checkDayKeyWindow(entry: RiceEntryInput, serverDay: string): string | null {
  const diff = diffDays(entry.dayKey, serverDay);
  if (Math.abs(diff) > DAY_KEY_WINDOW_DAYS) {
    return `dayKey 与服务器日差 ${diff} 天（容差 ±${DAY_KEY_WINDOW_DAYS} 天）`;
  }
  return null;
}

/** at 超前服务器时钟超过容差 → 记 clock_skew（§6.4 ③）。 */
export function isClockAhead(atIso: string, nowMs: number): boolean {
  const atMs = parseSaneTimestamp(atIso);
  return atMs !== null && atMs > nowMs + CLOCK_SKEW_TOLERANCE_MS;
}

/** at 相对「同 installId 近期最大 at」倒退超过容差 → 记 clock_skew。 */
export function isClockBackwards(atIso: string, recentMaxAtMs: number | null, nowMs: number): boolean {
  if (recentMaxAtMs === null) return false;
  const atMs = parseSaneTimestamp(atIso);
  return atMs !== null && atMs < recentMaxAtMs - CLOCK_SKEW_TOLERANCE_MS;
}

/** 时钟偏移窗口（倒退判据只回看服务器近 2 天收到/发生的条目——避免一次坏钟污染永久 flag）。 */
export const CLOCK_LOOKBACK_MS = 2 * 86_400_000;
export function clockLookbackFloor(nowMs: number): string {
  return new Date(nowMs - CLOCK_LOOKBACK_MS).toISOString();
}
