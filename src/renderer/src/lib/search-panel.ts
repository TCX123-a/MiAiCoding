/**
 * 搜索面板的「能被 ↑↓ 走到的动作」清单（学习闭环 §9）。
 *
 * 【为什么这件事要抽成纯函数 —— 键盘党够不够得到那个新按钮，就靠它钉住】
 * 面板原来的 `activeIndex` 只遍历课程结果数组；「练相关题」是**第二个动作**。
 * 如果新动作只是"渲染出来"而没有进这份清单，鼠标点得到、↑↓ 却永远走不过去 ——
 * 键盘党的暗角，而且没有任何东西会红（计划 §10.5 点名的最大易漏点）。
 * 所以顺序在这里一次定死：**课程结果在前（保持原顺序），练题入口在最后**；
 * 面板的 activeIndex 索引这份清单，不是索引课程结果数组。
 *
 * 【有命中才有那一行】搜不到题就不摆假按钮（规格原话）——
 * 命中为空时清单里根本没有 practice 这一项。
 * 草稿课（无内容）在这条链上自动出局：题目索引只从**有正文的课**构建，
 * 没有内容的课既进不了课程结果、也产不出题目命中。
 */
import type { QuestionSearchHit, SearchResult } from '../../../shared/search'

export type SearchAction =
  | { kind: 'lesson'; result: SearchResult }
  | { kind: 'practice'; count: number }

/**
 * 把两路结果合成一份可巡回的动作清单。
 *
 * `count` = 命中题数（= 真开出去那张卷子的题数 —— 两边读的是同一份
 * `searchQuestions` 输出，见 stores/search.ts 的 `questionHits`）。
 */
export function searchActions(
  results: readonly SearchResult[],
  hits: readonly QuestionSearchHit[]
): SearchAction[] {
  const actions: SearchAction[] = results.map((result) => ({ kind: 'lesson', result }))
  if (hits.length > 0) actions.push({ kind: 'practice', count: hits.length })
  return actions
}

/**
 * ↑↓ 走一格（两端环绕）。`count <= 0` 时恒回 0 ——
 * 调用方就不必各自在 `% 0` 前面加一道 `if` 了（那种闸加三处、漏一处的日子不想要）。
 */
export function moveActive(index: number, delta: number, count: number): number {
  if (count <= 0) return 0
  return (((index + delta) % count) + count) % count
}
