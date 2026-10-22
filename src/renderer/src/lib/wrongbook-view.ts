/**
 * 错题本列表的**四组筛选**：在库 / 已移除 / 漏洞 / 已毕业。
 *
 * 【为什么从 PracticeView 里搬出来】
 * 这四行 filter 原来写在 `PracticeView.vue` 的 computed 里 —— 而 views/ 不在
 * vitest 的 include 范围内，那里的判断**永远不会有测试**。本期的三枚状态筛
 * 恰好每一条都能悄悄写错（见下），错法还都是"界面看着正常、数字不对"：
 *
 *   · 在库少判 `!e.removed` → 删掉的题继续躺在列表里，点「移除」纹丝不动
 *   · 漏洞不排除已移除 → 「漏洞（N）」把已经删掉的也算进去，点进去却少几条
 *   · 已毕业写成「总数 − 在库」→ **已移除的题会被算成毕业**（本文件存在的理由，
 *     见 cleared 那段注释）—— 这是最隐蔽的一条：用户没删过题时两者恒等，
 *     数字只在删过之后才开始撒谎，而"总数减出来"的写法看上去还挺聪明
 *
 * 【四组不是严格的分区】一个「毕业过、又被手动删掉」的条目会同时出现在
 * removed 和 cleared 里。今天 UI 造不出这个状态（能被「移除」的行只在
 * 在库/漏洞两屏里，毕业的条目哪一屏都不显示），真出现了也不矛盾：
 * 「已移除」说的是它现在在回收站，「已毕业」说的是它当年做对过，
 * 两句话都是真的。所以这里照原样保留四条**独立**的判据，不做互斥。
 */
import type { WrongBookEntry } from '../../../shared/types'

export interface WrongbookSlices {
  /** 在库 = 没毕业、也没被手动删掉 —— 列表默认显示的那批 */
  active: WrongBookEntry[]
  /** 已移除 = 手动软删的（留着是为了还能恢复，见 wrongbook-merge 的软删语义） */
  removed: WrongBookEntry[]
  /** 漏洞 = 在库 **且** 插了旗的（已移除的不算：它已经不在列表里了） */
  hole: WrongBookEntry[]
  /** 已毕业 = 重做答对过、被自动收走的（历史保留） */
  cleared: WrongBookEntry[]
}

export function splitWrongbook(all: readonly WrongBookEntry[]): WrongbookSlices {
  return {
    active: all.filter((e) => !e.cleared && !e.removed),
    removed: all.filter((e) => e.removed === true),
    hole: all.filter((e) => !e.cleared && !e.removed && e.hole === true),
    /*
     * **显式数 `cleared`**，不是"总数 − 在库"。删掉的题根本没做对，
     * 用减法算的话，用户每删一条，界面上"已毕业 N 题"就跟着涨一 ——
     * 数字凭删题变大，没有任何报错，也没有任何地方能解释它。
     */
    cleared: all.filter((e) => e.cleared)
  }
}
