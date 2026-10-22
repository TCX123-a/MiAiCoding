/**
 * 签到卡上「连续签到 N 天」的**现算**（空转[2]，2026-10-16）—— 纯函数：
 * 不碰 store、不碰 DOM、不碰 Vue。
 *
 * 【为什么必须在 lib 里】`views/` 不在 vitest 的 include 范围里 —— 判断写在
 * 组件里**永远不会有测试**（同 checkin-calendar.ts 抬头那条理由）。
 *
 * 【为什么必须现算，不能直接画存档里的 streakDays】
 * 存档里的数（`checkin.streakDays`）是**上次签到那一刻**算出来的，它自己
 * 不会过期：忘签一天的人第二天打开，值还是 30 —— 卡片照着画就是一句
 * 「连续签到 30 天」的假话，要等点到签到那一刻才当着用户的面掉成 1
 * （复核的活窗实测现象：全程没有一句"断签了"）。
 * 链条活没活是一个**相对今天**的问题，所以每次渲染都得拿今天的日键重问一遍。
 *
 * 【"活着"的准确条件】lastDate 是**今天或昨天**：
 *   · 今天 —— 今天签过了，数就是签完那一刻的数；
 *   · 昨天 —— 今天还没签，但今天补上就能接续（applyCheckin 的接续规则：
 *     lastDate 的明天是今天 ⇒ +1），所以之前攒的数仍然算数；
 *   · 更早（或比今天还晚 —— 时钟回拨出来的怪档）—— 今天再签只会
 *     清零重来（streak=1），所以现在如实显示 0。
 * 这条"今天或昨天"的边界与 applyCheckin 的 `nextDay === day` 是同一枚硬币
 * 的两面，改一边必须看另一边（`__tests__/checkin-streak.test.ts` 有交叉用例）。
 */
import { shiftDateKey } from '../../../shared/dates'
import type { CheckinState } from '../../../shared/types'

export interface StreakDisplay {
  /** 卡片上该显示的连签天数（链断着、或从没签过都是 0） */
  streak: number
  /**
   * 「有过连签、现在断着」—— 提示行要换成说清"为什么归 0"的那句。
   * 从没签过（lastDate 为 null）是 **false**：没有"断"可言，提示行照旧
   * （别给新用户报一个不存在的丧）。
   */
  broken: boolean
}

/**
 * @param checkin 档案里的签到一节（视图传 store 的 `progress.checkin`）
 * @param today   今天的日键（视图传活时钟 `today.value`；测试注入固定值）
 */
export function streakDisplayOf(checkin: CheckinState, today: string): StreakDisplay {
  const { lastDate, streakDays } = checkin
  if (lastDate === null) return { streak: 0, broken: false }
  if (lastDate === today) return { streak: streakDays, broken: false }
  if (lastDate === shiftDateKey(today, -1)) return { streak: streakDays, broken: false }
  return { streak: 0, broken: true }
}
