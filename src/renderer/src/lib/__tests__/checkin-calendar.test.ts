/**
 * 签到月历的网格数据（lib/checkin-calendar.ts）
 *
 * 【这个文件在守什么】
 * 网格是「日期算术 × 状态标记」的交叉表，它的错误症状全是**要用眼睛数日历
 * 才能发现**的那一类：
 *
 *   1. **表头与网格错一天**。表头是拍板文案「一二三四五六日」（周一开头），
 *      网格若还是周日起头，症状是"周二签的钩画在周三格子上"，
 *      而且每个月每一天都在错 —— 用户第一眼看不出来。
 *   2. **借位格画成当月日子**。10 月的月历要借 9 月末的几天填前排，
 *      不标 `inMonth: false` 的话「9 月 28 日」看起来就是 10 月 28 日。
 *   3. **跨月/跨年借位算错**。1 月的月历往前借到去年 12 月、12 月的月历
 *      往后借到明年 1 月；`inMonth` 只比月份不比年份的话这两个都是错的。
 *   4. **今天的标记/签到的钩对不上格子**。判据是"日键相等"——
 *      键一旦拼错形状（少补零），全网格恒不命中而**一格都不报错**。
 */

import { describe, expect, it } from 'vitest'
import { buildMonthGrid, CHECKIN_GRID_ROWS, type CalendarCell } from '../checkin-calendar'

/** 摊平成一维（断言大多按格序看） */
function flatOf(year: number, month: number, checked: string[] = [], today = ''): CalendarCell[] {
  return buildMonthGrid(year, month, new Set(checked), today).flat()
}

/** 网格的 42 格日期必须**每天一格、连续升序**（日期算术的总不变量） */
function expectContiguous(cells: CalendarCell[]): void {
  expect(cells).toHaveLength(CHECKIN_GRID_ROWS * 7)
  for (let i = 1; i < cells.length; i++) {
    const [y, m, d] = cells[i - 1].key.split('-').map(Number)
    const next = new Date(y, m - 1, d + 1)
    const key = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(
      next.getDate()
    ).padStart(2, '0')}`
    expect(cells[i].key, `cell ${i}`).toBe(key)
  }
}

describe('buildMonthGrid：形状与开头', () => {
  it('固定 6 行 × 7 列', () => {
    // 行数跟着月份变的话卡片高度逐月跳，切月份时整页往下窜（见文件头）
    const grid = buildMonthGrid(2026, 2, new Set(), '')
    expect(grid).toHaveLength(CHECKIN_GRID_ROWS)
    for (const row of grid) expect(row).toHaveLength(7)
  })

  it('★ 周一开头：每月的第一格都是星期一（表头是「一二三四五六日」）', () => {
    for (const [y, m] of [
      [2026, 1],
      [2026, 2],
      [2026, 10],
      [2026, 12]
    ]) {
      const first = buildMonthGrid(y, m, new Set(), '')[0][0]
      const [yy, mm, dd] = first.key.split('-').map(Number)
      expect(new Date(yy, mm - 1, dd).getDay(), `${y}-${m} first cell ${first.key}`).toBe(1)
    }
  })

  it('借位事实核对：2026-01 首格 2025-12-29、2026-10 首格 2026-09-28', () => {
    // 一条用真日历核对过的锚（node 里数过）：错了说明前置格算法整个偏了
    expect(flatOf(2026, 1)[0].key).toBe('2025-12-29')
    expect(flatOf(2026, 10)[0].key).toBe('2026-09-28')
  })

  it('42 格连续升序（每天一格、无跳重）', () => {
    expectContiguous(flatOf(2026, 1))
    expectContiguous(flatOf(2026, 2))
    expectContiguous(flatOf(2026, 12)) // 跨年借位那一档
  })

  it('键的形状一律 YYYY-MM-DD（拼错形状会让所有标记静默不命中）', () => {
    for (const cell of flatOf(2026, 10)) {
      expect(cell.key, cell.key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})

describe('buildMonthGrid：inMonth / day', () => {
  it('2026-02：28 天全在月内，前后的借位格都标 false', () => {
    const cells = flatOf(2026, 2)
    expect(cells.filter((c) => c.inMonth)).toHaveLength(28)
    expect(cells[0].inMonth).toBe(false) // 2026-01-26 起
    expect(cells[cells.length - 1].inMonth).toBe(false) // 借到 2026-03-08
    // 2 月没有 29/30/31 —— 借位格印的是自己的号数，不是"月底几天"
    expect(cells.filter((c) => c.inMonth).map((c) => c.day)).toEqual(
      Array.from({ length: 28 }, (_, i) => i + 1)
    )
  })

  it('跨年借位也判得对：2025-12-31 在 2026-01 的网格里是"月外"', () => {
    // 只看月份不看年份的实现会把它判成月内（12 月 vs 1 月？不，是 12 月比 1 月）。
    // 这里真正测的是：年份不一致时一律 false —— 借位格的唯一判据是年月都对
    const cell = flatOf(2026, 1).find((c) => c.key === '2025-12-31')
    expect(cell).toBeDefined()
    expect(cell?.inMonth).toBe(false)
    expect(cell?.day).toBe(31) // 印的是它**自己**的号数
  })

  it('跨年借位（往后）：2027-01-01 在 2026-12 的网格里也是"月外"', () => {
    const cell = flatOf(2026, 12).find((c) => c.key === '2027-01-01')
    expect(cell).toBeDefined()
    expect(cell?.inMonth).toBe(false)
  })
})

describe('buildMonthGrid：checked / today 标记', () => {
  it('签过的日子画钩，且**借位格也能画**（键相等即命中，不看 inMonth）', () => {
    // 钩的判据只有"这个键在不在集合里"一条 —— 若实现顺手加了 inMonth 条件，
    // "去年最后一天签的"这类跨月显示的钩会静默消失
    const cells = flatOf(2026, 1, ['2026-01-05', '2025-12-31'])
    const hit = cells.filter((c) => c.checked).map((c) => c.key)
    expect(hit).toEqual(['2025-12-31', '2026-01-05'])
  })

  it('别的月份的键不会误命中（集合里塞 2025-12-29 时 2026-01-29 不亮）', () => {
    const cells = flatOf(2026, 1, ['2025-12-29'])
    const cell29 = cells.find((c) => c.key === '2026-01-29')
    expect(cell29?.checked).toBe(false)
  })

  it('today：恰好一格，且就是今天那个键', () => {
    const cells = flatOf(2026, 10, [], '2026-10-09')
    expect(cells.filter((c) => c.today).map((c) => c.key)).toEqual(['2026-10-09'])
  })

  it('今天不在这个月时：一格都不标（比如翻看别的月份）', () => {
    const cells = flatOf(2026, 10, [], '2026-11-20')
    expect(cells.some((c) => c.today)).toBe(false)
  })

  it('checked 和 today 互不干涉（同一天可以既签过又是今天）', () => {
    const cells = flatOf(2026, 10, ['2026-10-09'], '2026-10-09')
    const cell = cells.find((c) => c.key === '2026-10-09')
    expect(cell?.checked).toBe(true)
    expect(cell?.today).toBe(true)
  })
})
