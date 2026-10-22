/**
 * 语言与阶段的展示名（全 UI 统一，勿在各组件重复定义）。
 *
 * 真源已上移到 `src/shared/copy.ts`——因为主进程的运行器报错也要用语言名，
 * 而它没法 import 渲染层的文件。本文件只做转发，保留这个名字是为了
 * 不让十几处 `import { LANG_LABEL } from '../lib/labels'` 全改一遍。
 */
import { LANG_DISPLAY, STAGE_DISPLAY } from '../../../shared/copy'
import { beijingParts } from '../../../shared/dates'
import type { Lang } from '../../../shared/types'

export const LANG_LABEL: Record<Lang, string> = LANG_DISPLAY

export const STAGE_LABEL: Record<number, string> = STAGE_DISPLAY

/**
 * 云同步「上次同步」的短时间戳（P10.6 账号页；句式在 copy.ts 的 SYNC.LAST）。
 * 今天 → "14:32"；今年更早 → "10-11 14:32"；跨年 → "2026-10-11 14:32"。
 * 解析不出来的串原样返回（宁可显示一个怪串，也不显示 "Invalid Date" 这类废话）。
 * 第二参只给单测递假"现在"用 —— 生产调用一律走默认值。
 *
 * 【口径】「今天/今年」和钟点都按北京时间（UTC+8）算，与全应用日界一致。
 * 不能再用 getHours/getMonth 这类本机 getter：海外或系统时区不是 +8 的
 * 机器上，北京 00:10 的同步会显示成前一天 16:10，和旁边的北京日界打架。
 */
export function formatSyncClock(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number): string => String(n).padStart(2, '0')
  const t = beijingParts(d)
  const n = beijingParts(now)
  const hm = `${p(t.h)}:${p(t.min)}`
  const sameDay = t.y === n.y && t.m === n.m && t.d === n.d
  if (sameDay) return hm
  const md = `${p(t.m)}-${p(t.d)}`
  if (t.y === n.y) return `${md} ${hm}`
  return `${t.y}-${md} ${hm}`
}
