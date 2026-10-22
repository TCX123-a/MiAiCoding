/**
 * 日期分桶口径（shared/dates.ts，2026-10-22 起固定北京时间 UTC+8）
 *
 * 【为什么所有夹具都显式写 +08:00】
 * 「本地日期键对不对」最容易写成只在东八区成立的断言。例如
 *
 *     expect(localDateKeyOf('2026-09-12T23:30:00.000Z')).toBe('2026-09-13')
 *
 * 这条在北京时间是对的；但以前的实现跟随运行机器时区，换一台 UTC 机器就红。
 * 现在实现固定 +8，断言本身在任何机器上都成立 —— 夹具用带 +08:00 的绝对时刻，
 * 不依赖宿主机时区，也不依赖测试机的系统设置。
 *
 * 这里最要紧的一条是「往返」：任意时刻转成日键，必须和它在北京墙钟上的日期
 * 完全一致。它一旦不成立，就是「某一刻被归到了错误的那一天」。
 */

import { describe, expect, it } from 'vitest'
import {
  beijingParts,
  isWithinDays,
  localDateKey,
  localDateKeyOf,
  msUntilNextMidnight,
  parseDateKey,
  shiftDateKey,
  todayKey
} from '../dates'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 造一个北京时间的绝对时刻（不依赖运行机器的时区） */
function bj(
  y: number,
  mo: number,
  d: number,
  h = 0,
  mi = 0,
  s = 0,
  ms = 0
): Date {
  return new Date(
    `${y}-${pad2(mo)}-${pad2(d)}T${pad2(h)}:${pad2(mi)}:${pad2(s)}.${String(ms).padStart(3, '0')}+08:00`
  )
}

/** 取一个时刻在北京墙钟上的字段（与实现完全独立的一套算法） */
function bjClock(d: Date): {
  y: number
  mo: number
  d: number
  h: number
  mi: number
  s: number
} {
  const t = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  return {
    y: t.getUTCFullYear(),
    mo: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    h: t.getUTCHours(),
    mi: t.getUTCMinutes(),
    s: t.getUTCSeconds()
  }
}

describe('localDateKey / localDateKeyOf：把时刻归到正确的北京那一天', () => {
  it('往返性质：北京一天 24 小时里的每一刻，转成日期键都等于它自己那天的键', () => {
    const buckets = new Set<string>()
    for (let h = 0; h < 24; h++) {
      for (const min of [0, 30]) {
        const d = bj(2026, 9, 13, h, min)
        buckets.add(localDateKeyOf(d.toISOString())!)
        expect(localDateKeyOf(d.toISOString())).toBe(localDateKey(d))
      }
    }
    // 同一天的 48 个采样点必须全部落进**同一个**格子，不能劈成两半
    expect([...buckets]).toEqual(['2026-09-13'])
  })

  it('北京日界：UTC 16:00 才是北京零点，15:59:59.999Z 仍属前一天', () => {
    expect(localDateKey(new Date('2026-10-21T15:59:59.999Z'))).toBe('2026-10-21')
    expect(localDateKey(new Date('2026-10-21T16:00:00.000Z'))).toBe('2026-10-22')
    expect(localDateKeyOf('2026-10-21T16:00:00.000Z')).toBe('2026-10-22')
  })

  it('跨月与跨年那几个瞬间不会窜格（按北京墙钟）', () => {
    const cases = [
      bj(2026, 9, 30, 23, 59, 59), // 9 月最后一刻
      bj(2026, 10, 1, 0, 0, 0), // 10 月第一刻
      bj(2026, 12, 31, 23, 59, 59), // 年末
      bj(2027, 1, 1, 0, 0, 0), // 年初
      bj(2028, 2, 29, 12, 0, 0) // 闰日
    ]
    const expected = ['2026-09-30', '2026-10-01', '2026-12-31', '2027-01-01', '2028-02-29']
    cases.forEach((d, i) => {
      expect(localDateKey(d)).toBe(expected[i])
      expect(localDateKeyOf(d.toISOString())).toBe(expected[i])
    })
  })

  it('月/日必须补零 —— 否则日期键没法按字符串排序', () => {
    expect(localDateKey(bj(2026, 1, 5, 12))).toBe('2026-01-05')
    expect(localDateKey(bj(2026, 9, 13, 12))).toBe('2026-09-13')
  })

  it('补零之后：按字符串排序 == 按时间排序', () => {
    const keys = ['2026-09-13', '2026-01-05', '2026-10-01', '2026-09-03']
    expect(keys.slice().sort()).toEqual(['2026-01-05', '2026-09-03', '2026-09-13', '2026-10-01'])
    // 反例：不补零就会这样排错（这是为什么必须有上面那条补零测试）
    const unpadded = ['2026-9-13', '2026-10-01']
    expect(unpadded.slice().sort()).toEqual(['2026-10-01', '2026-9-13']) // 10 月排到 9 月前面了
  })

  it('脏数据返回 null，不抛错也不返回空串', () => {
    expect(localDateKeyOf('')).toBeNull()
    expect(localDateKeyOf('not a date')).toBeNull()
    expect(localDateKeyOf('2026-13-45T00:00:00Z')).toBeNull()
    // 空串会变成一个不存在的日期格子，比明确 null 更难查
    expect(localDateKeyOf('')).not.toBe('')
  })

  it('todayKey 就是 localDateKey(现在)', () => {
    const now = new Date()
    expect(todayKey()).toBe(localDateKey(now))
    expect(todayKey(now)).toBe(localDateKey(now))
  })
})

describe('反向验证：老写法（toISOString().slice(0,10)）确实会差一天', () => {
  /**
   * 这条测试本身不验新代码，它验的是**我们修的那个 bug 真的存在**。
   * 没有它，将来有人看到 `localDateKeyOf` 会想「这不就是 slice 吗，多此一举」，
   * 然后顺手改回去 —— 这条会变红，把那个念头当场拦下。
   *
   * 现在实现固定 +8，所以下面不管测试机在哪个时区都成立：
   * 北京 07:30 时 UTC 还是前一天，老写法必错 8 小时窗口。
   */
  const oldWay = (d: Date): string => d.toISOString().slice(0, 10)

  it('北京 0:00–8:00 这 8 个小时里，老写法会把日期算成昨天', () => {
    let mismatches = 0
    for (let h = 0; h < 8; h++) {
      const d = bj(2026, 9, 13, h, 30)
      expect(oldWay(d)).toBe('2026-09-12')
      expect(localDateKey(d)).toBe('2026-09-13')
      expect(localDateKeyOf(d.toISOString())).toBe('2026-09-13')
      mismatches++
    }
    expect(mismatches).toBe(8)
    // 北京 08:00 起两边一致；再往后再也不会有这个偏差
    expect(oldWay(bj(2026, 9, 13, 8, 0))).toBe('2026-09-13')
  })
})

describe('shiftDateKey：挪天数（纯日历算术）', () => {
  it('普通前后挪动', () => {
    expect(shiftDateKey('2026-09-13', 1)).toBe('2026-09-14')
    expect(shiftDateKey('2026-09-13', -1)).toBe('2026-09-12')
    expect(shiftDateKey('2026-09-13', 0)).toBe('2026-09-13')
  })

  it('跨月 / 跨年 / 闰日', () => {
    expect(shiftDateKey('2026-09-30', 1)).toBe('2026-10-01')
    expect(shiftDateKey('2026-10-01', -1)).toBe('2026-09-30')
    expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDateKey('2027-01-01', -1)).toBe('2026-12-31')
    expect(shiftDateKey('2028-02-28', 1)).toBe('2028-02-29') // 2028 是闰年
    expect(shiftDateKey('2026-02-28', 1)).toBe('2026-03-01') // 2026 不是
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('挪 30 天（挑战记录滚动窗口用的就是这个）', () => {
    expect(shiftDateKey('2026-09-13', -30)).toBe('2026-08-14')
    expect(shiftDateKey('2026-03-15', -30)).toBe('2026-02-13')
  })

  it('非法输入返回 null', () => {
    expect(shiftDateKey('2026-9-13', 1)).toBeNull() // 没补零
    expect(shiftDateKey('', 1)).toBeNull()
    expect(shiftDateKey('2026-02-31', 1)).toBeNull() // 格式对但那天不存在
    expect(shiftDateKey('2026-13-01', 1)).toBeNull()
  })
})

describe('isWithinDays：滚动窗口判定', () => {
  const today = '2026-09-13'

  it('窗口含今天、含边界那天', () => {
    expect(isWithinDays('2026-09-13', 1, today)).toBe(true) // 窗口只有今天
    expect(isWithinDays('2026-09-12', 1, today)).toBe(false)
    expect(isWithinDays('2026-09-12', 2, today)).toBe(true) // 窗口 = 今天 + 昨天
    expect(isWithinDays('2026-08-15', 30, today)).toBe(true) // 恰好第 30 天
    expect(isWithinDays('2026-08-14', 30, today)).toBe(false) // 第 31 天，出窗口
  })

  it('未来的日期不算在窗口内', () => {
    expect(isWithinDays('2026-09-14', 30, today)).toBe(false)
  })

  it('非法日期键一律 false，不抛错', () => {
    expect(isWithinDays('garbage', 30, today)).toBe(false)
    expect(isWithinDays('', 30, today)).toBe(false)
  })
})

describe('parseDateKey', () => {
  it('认得正常日期', () => {
    expect(parseDateKey('2026-09-13')).toEqual({ y: 2026, m: 9, d: 13 })
  })

  it('挡掉形状不对的', () => {
    expect(parseDateKey('2026-9-13')).toBeNull()
    expect(parseDateKey('20260913')).toBeNull()
    expect(parseDateKey('2026-09-13T00:00:00Z')).toBeNull()
  })

  it('挡掉「格式对但日子不存在」的 —— 这条最容易漏', () => {
    expect(parseDateKey('2026-02-31')).toBeNull()
    expect(parseDateKey('2026-04-31')).toBeNull()
    expect(parseDateKey('2026-00-10')).toBeNull()
    expect(parseDateKey('2026-09-00')).toBeNull()
    // 闰年判定也要对
    expect(parseDateKey('2028-02-29')).toEqual({ y: 2028, m: 2, d: 29 })
    expect(parseDateKey('2026-02-29')).toBeNull()
  })
})

describe('beijingParts：唯一的一套北京墙钟换算', () => {
  it('UTC 16:00 是北京次日 00:00', () => {
    expect(beijingParts(new Date('2026-10-21T16:00:00Z'))).toEqual({
      y: 2026,
      m: 10,
      d: 22,
      h: 0,
      min: 0,
      s: 0
    })
  })

  it('UTC 15:59:59 是北京同日 23:59:59', () => {
    expect(beijingParts(new Date('2026-10-21T15:59:59Z'))).toEqual({
      y: 2026,
      m: 10,
      d: 21,
      h: 23,
      min: 59,
      s: 59
    })
  })
})

/*
 * msUntilNextMidnight（活时钟的计时核心）
 *
 * 【判据是「加出来的那一瞬就是北京下一天的 00:00:01」而不是写死毫秒数】
 * 用 now + ms 落在北京墙钟的哪一刻来钉，任何测试机时区都成立，且恰好是
 * 活时钟要的性质：睡到点醒来时，墙上的日期必须已经翻页。
 */
describe('msUntilNextMidnight：距下一个北京时间零点还有多久', () => {
  it('普通时刻：now + ms 落在北京下一天的 00:00:01', () => {
    const now = bj(2026, 10, 15, 14, 30, 0)
    const wake = new Date(now.getTime() + msUntilNextMidnight(now))
    expect(localDateKey(wake)).toBe('2026-10-16')
    expect(bjClock(wake)).toEqual({ y: 2026, mo: 10, d: 16, h: 0, mi: 0, s: 1 })
  })

  it('贴着零点：23:59:00 → 61 秒后是新的一天', () => {
    const now = bj(2026, 10, 15, 23, 59, 0)
    expect(msUntilNextMidnight(now)).toBe(61_000)
  })

  it('正好站在零点那一刻：拿到的仍是「下一个」零点，且不小于 1 秒', () => {
    const now = bj(2026, 10, 16, 0, 0, 0, 0)
    const ms = msUntilNextMidnight(now)
    expect(ms).toBeGreaterThanOrEqual(1000)
    const wake = new Date(now.getTime() + ms)
    expect(localDateKey(wake)).toBe('2026-10-17')
  })

  it('跨月/跨年也算得对（纯 UTC 日历进位，不是加 86400000）', () => {
    const monthEnd = bj(2026, 10, 31, 23, 0, 0) // 10-31 23:00（北京）
    expect(localDateKey(new Date(monthEnd.getTime() + msUntilNextMidnight(monthEnd)))).toBe(
      '2026-11-01'
    )
    const yearEnd = bj(2026, 12, 31, 22, 0, 0) // 12-31 22:00（北京）
    expect(localDateKey(new Date(yearEnd.getTime() + msUntilNextMidnight(yearEnd)))).toBe(
      '2027-01-01'
    )
  })
})
