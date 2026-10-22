/**
 * 签到月历的网格数据（P3 ①，2026-10-08）—— **纯函数**：
 * 不碰 store、不碰 DOM、不碰 Vue。
 *
 * 【为什么网格在 lib 里拼、而不是 OverviewView 里算】
 * `views/` 不在 vitest 的 include 范围里 —— 写在组件里的日期算术
 * **永远不会有测试**（同 `lib/overview.ts` 文件头那条理由）。而这里
 * 每一格都是「哪一天 + 在不在这个月 + 签没签过 + 是不是今天」四件事的
 * 交叉，错一格的症状是「月历上 10 月 1 日显示成 9 月 31 日」这种
 * 要人肉对着日历数才发现的东西。所以搬到这里，用真测试钉。
 *
 * 【为什么固定 6 行】一个月的天数 + 前置空位最多 6×7 = 42 格
 * （31 天 + 最多 6 个前置日 = 37 ≤ 42；2 月最短也不会掉出 6 行）。
 * 行数跟着月份变的写法会让卡片高度**逐月跳**，切月份时整个页面往下一窜 ——
 * 固定 6 行，且借位的那几格由调用方按 `inMonth` 画淡（不画的话
 * 「9 月 28 日」会看起来像 10 月的日子）。
 */
import { localDateKey } from '../../../shared/dates'

const CELLS_PER_ROW = 7
export const CHECKIN_GRID_ROWS = 6

export interface CalendarCell {
  /** 北京日期键（'YYYY-MM-DD'）—— 与 profile.checkin.days / todayKey 同一个口径 */
  key: string
  /** 格子上印的日子（几号）。跨月借位格印的是它**自己**的号数 */
  day: number
  /** 这一格属不属于所画的这个月（false = 前后借位格，画淡） */
  inMonth: boolean
  /** 这一天签过没有（判据是 key 在不在 days 集合里 —— 和发饭闸门同一个集合） */
  checked: boolean
  /** 这一格是不是"今天" */
  today: boolean
}

/**
 * 拼一个月的 7×6 网格（**周一开头**）。
 *
 * 【为什么周一开头】表头 `CHECKIN.WEEK_HEAD = '一二三四五六日'` 是拍板文案；
 * 周日起头的说法的确是"日历本的样子"，但那一行字和网格必须同一天开头 ——
 * 错开的症状是「周二签的钩画在周三的格子上」，而且每个月每一天都在错。
 *
 * 【日期算术走纯 UTC 日历】`new Date(Date.UTC(y, m - 1, 1 - lead + i))`：
 * 负数日号（上个月末尾）和溢出日号（下个月开头）都由日历自己进位 ——
 * 跨月、跨年、闰年 2 月都不需要写特判（同 shared/dates.ts 的 shiftDateKey 理由）。
 * 必须用 UTC 而不能用本机构造器：日键已改为北京时间，若这里仍按本机时区
 * 构造、再用北京口径格式化，在 UTC+9~+14 的机器上整格会偏一天（重复/跳日）。
 *
 * @param year   完整年份（如 2026）
 * @param month  月份，**1 起**（1 = 一月；和 copy 的 CHECKIN.MONTH(y, m) 同口径）
 * @param checked 已签到的日键集合（调用方从 store 的 checkin.days 建 Set 传入）
 * @param today   今天的日键（渲染层用 dates.todayKey() 取；测试注入固定值）
 */
export function buildMonthGrid(
  year: number,
  month: number,
  checked: ReadonlySet<string>,
  today: string
): CalendarCell[][] {
  const first = new Date(Date.UTC(year, month - 1, 1))
  // getUTCDay(): 0=周日。转成「周一 = 0」的前置格数：周一(1)→0、周日(0)→6
  const lead = (first.getUTCDay() + 6) % 7
  const rows: CalendarCell[][] = []
  for (let r = 0; r < CHECKIN_GRID_ROWS; r++) {
    const row: CalendarCell[] = []
    for (let c = 0; c < CELLS_PER_ROW; c++) {
      const cell = new Date(Date.UTC(year, month - 1, 1 - lead + r * CELLS_PER_ROW + c))
      // UTC 零点 + 8 小时仍是同一个北京日期，所以直接复用北京日格式化。
      const key = localDateKey(cell)
      row.push({
        key,
        day: cell.getUTCDate(),
        // 借位格（上月末/下月初）：年份一起比，跨年借位（1 月的月历借到去年 12 月）也判得对
        inMonth: cell.getUTCFullYear() === year && cell.getUTCMonth() === month - 1,
        checked: checked.has(key),
        today: key === today
      })
    }
    rows.push(row)
  }
  return rows
}
