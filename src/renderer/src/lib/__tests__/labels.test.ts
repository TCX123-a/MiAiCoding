/**
 * formatSyncClock（lib/labels.ts）的单测（P10.6 账号页的「上次同步」）。
 *
 * 三档粒度各自一条（今天 / 今年更早 / 跨年），外加「解析不了的原样返回」——
 * 显示一个怪串，好过把 Invalid Date 之类的东西端给用户。
 *
 * 【2026-10-22 起固定北京时间】原先夹具用无时区串（`new Date('...T09:05:00')`），
 * 它的含义随测试机时区变；现在显示口径是北京墙钟，夹具全部显式写 +08:00，
 * 断言在任何机器上成立，也顺带钉住「北京 00:00–08:00 不会被算成昨天」。
 */
import { describe, expect, it } from 'vitest'
import { formatSyncClock } from '../labels'

/** 北京时间某个时刻（显式偏移，不依赖测试机时区） */
function bj(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date {
  const p = (n: number): string => String(n).padStart(2, '0')
  return new Date(`${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(s)}+08:00`)
}

describe('formatSyncClock（P10.6）', () => {
  const now = bj(2026, 10, 11, 20, 30)

  it('今天 → HH:MM', () => {
    expect(formatSyncClock(bj(2026, 10, 11, 9, 5).toISOString(), now)).toBe('09:05')
  })

  it('今天凌晨（北京 00:00–08:00）仍算今天，不能因 UTC 还是昨天就退成日期', () => {
    // 北京 2026-10-11 00:30 == UTC 2026-10-10 16:30；老写法会显示 10-10
    expect(formatSyncClock(bj(2026, 10, 11, 0, 30).toISOString(), now)).toBe('00:30')
  })

  it('今年更早 → MM-DD HH:MM', () => {
    expect(formatSyncClock(bj(2026, 3, 7, 8, 0).toISOString(), now)).toBe('03-07 08:00')
  })

  it('跨年 → YYYY-MM-DD HH:MM', () => {
    expect(formatSyncClock(bj(2025, 12, 31, 23, 59).toISOString(), now)).toBe(
      '2025-12-31 23:59'
    )
  })

  it('「今天」按北京日界判定：UTC 16:00 之后就是北京次日了', () => {
    // now = 北京 10-11 00:30（UTC 10-10 16:30）；此刻北京已是 10-11，故 t=10-10 23:50 属昨天
    const justAfterBeijingMidnight = bj(2026, 10, 11, 0, 30)
    expect(formatSyncClock(bj(2026, 10, 10, 23, 50).toISOString(), justAfterBeijingMidnight)).toBe(
      '10-10 23:50'
    )
    expect(formatSyncClock(bj(2026, 10, 11, 0, 10).toISOString(), justAfterBeijingMidnight)).toBe(
      '00:10'
    )
  })

  it('解析不了的原样返回（不显示 Invalid Date 那类废话）', () => {
    expect(formatSyncClock('not-a-date', now)).toBe('not-a-date')
  })
})
