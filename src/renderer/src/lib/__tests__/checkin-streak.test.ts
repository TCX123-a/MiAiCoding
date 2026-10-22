/**
 * 签到卡连签数的现算（lib/checkin-streak.ts，空转[2]）
 *
 * 【这个文件在守什么】
 * 存档里的 `checkin.streakDays` 是"上次签到那一刻"算出的**遗物**，链断了
 * 也不会自己过期。这个函数决定卡片上显示什么，错法是**一句安静的假话**：
 *
 *   1. **断链还照画旧值** —— 忘签一天的人第二天打开看到「连续签到 30 天」，
 *      点一下才当场掉成 1（复核实测的原始现象，用户全程不知道发生了什么）。
 *   2. **边界错一天** —— "昨天签的"必须还活着（今天补上就接续），
 *      "前天签的"必须是断的。这一天的偏移**两种错法都只是差一行**，
 *      不钉住就会在日常里悄悄漂。
 *   3. **给从没签过的人报丧** —— lastDate 为 null 时 broken 不许为 true
 *      （提示行要换成"断啦"是给断过链的人准备的）。
 *
 * 跨月/跨年走 shiftDateKey（Date 构造器），本文件用 9/30→10/1 那对钉住。
 */
import { describe, expect, it } from 'vitest'
import { streakDisplayOf } from '../checkin-streak'
import { applyCheckin } from '../../../../shared/profile-migrate'
import type { CheckinState } from '../../../../shared/types'

/** 一份"签过若干天"的档：lastDate 是最后一天，streakDays 是当时算出的数 */
function signed(lastDate: string | null, streakDays: number): CheckinState {
  return {
    lastDate,
    streakDays,
    totalDays: 9,
    days: lastDate === null ? [] : [lastDate]
  }
}

describe('streakDisplayOf：链活没活是相对"今天"算的', () => {
  it('今天签过：画存档值（就是签完那一刻的数）', () => {
    const d = streakDisplayOf(signed('2026-10-16', 30), '2026-10-16')
    expect(d).toEqual({ streak: 30, broken: false })
  })

  it('★ 昨天签的：仍然是活的 —— 今天补上就接续（差一天就是两种错法）', () => {
    // applyCheckin 的接续规则：lastDate 的明天是今天 ⇒ streak+1。所以昨天
    // 签的档，"30 天"仍然算数，今天还没签而已 —— 这时画 0 是冤案
    const d = streakDisplayOf(signed('2026-10-15', 30), '2026-10-16')
    expect(d).toEqual({ streak: 30, broken: false })
  })

  it('★ 前天签的（复核的原始场景：断签一天）：画 0 且 broken —— 不许再挂着 30', () => {
    const d = streakDisplayOf(signed('2026-10-14', 30), '2026-10-16')
    expect(d).toEqual({ streak: 0, broken: true })
  })

  it('从没签过（lastDate 为 null）：0、但 broken=false —— 别给新用户报一个不存在的丧', () => {
    const d = streakDisplayOf(signed(null, 0), '2026-10-16')
    expect(d).toEqual({ streak: 0, broken: false })
  })

  it('时钟回拨（lastDate 在"今天"之后）：也算断 —— 那会儿再签只会清零重来', () => {
    const d = streakDisplayOf(signed('2026-10-18', 30), '2026-10-16')
    expect(d).toEqual({ streak: 0, broken: true })
  })

  it('跨月边界：昨天是上个月最后一天（9/30）→ 活着（日期算术走日历，不靠毫秒）', () => {
    const d = streakDisplayOf(signed('2026-09-30', 7), '2026-10-01')
    expect(d).toEqual({ streak: 7, broken: false })
  })

  it('★ 与 applyCheckin 对账：broken ⟺ 今天这一签会报 streakReset（一份规则的两种问法）', () => {
    // 这个函数（显示）和 applyCheckin（发饭闸门）对"接没接上"必须永远同口径。
    // 抄错一边的症状是"卡片说还活着、签完却被清零"（或反过来），
    // 而且只在跨月/回拨这类日子露面。穷举一小片日期空间对账，防漂。
    const lasts: (string | null)[] = [
      null,
      '2026-09-29',
      '2026-09-30',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17'
    ]
    for (const last of lasts) {
      for (const today of ['2026-10-15', '2026-10-16', '2026-11-01']) {
        const cur = signed(last, 5)
        const disp = streakDisplayOf(cur, today)
        const res = applyCheckin(cur, today)
        expect(disp.broken, `last=${last} today=${today}`).toBe(res.streakReset)
      }
    }
  })
})
