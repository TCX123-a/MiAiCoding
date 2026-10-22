/**
 * 错题本条目 → 题目本体。
 *
 * 【为什么需要这样一个函数】
 * 以前只有一条路：拿「课号 + 题号」去内容包里找
 * （`lessonOf(课号).questions.find(题号)`）。它对内置题永远成立，
 * 对 **AI 现场出的题** 永远不成立 —— AI 题不在任何一课里。
 *
 * 所以 2026-09-13 之前，AI 题的错**一律不收**，免得写进去一条永远找不回来的死条目。
 * 主人后来拍板要收（「我错了的 AI 题以后也想复习」），收的前提就是
 * **AI 题必须连着本体一起存**（见 types.ts 的 WrongBookEntry.ai）。
 * 有了本体，题目就从条目自己身上取，不用再去内容包翻。
 *
 * 这个判定写在 shared 而不是散在界面里，是因为它有两个调用点
 * （列表显示题干、点「再练一次」组卷），两处必须给出**同一个答案** ——
 * 一处有一处没有的话，表现是「列表里有这道题，点重做却把它跳过了」，
 * 而且不报错。
 *
 * 【2026-09-29 收藏也来用】收藏条目（`FavoriteItem`）和错题条目是同一种东西
 * 的两个副本：全局键 + 宿主课 + 「AI 题必带本体」。所以这里收口成
 * `QuestionRef` / `resolveRefQuestion` —— 两个功能共用一份"题去哪找"的规则，
 * 错题本能重做的题，收藏页就点得开。
 */
import type { Question, WrongBookEntry } from './types'
import { isAiKey } from './question-key'

/**
 * 这条错题是不是 AI 出的。
 *
 * ⚠️ 判据用 **key**（题号前缀）而不是「有没有 ai 字段」：
 * key 是这条记录的主键，永远在；`ai` 是选填的，理论上可能缺。
 * 拿一个可能缺的字段当判据，缺的那天就会把 AI 题误当成内置题，
 * 转而去内容包里瞎找 —— 那正是我们要避免的那件事。
 */
export function isAiEntry(e: WrongBookEntry): boolean {
  return isAiKey(e.key)
}

/**
 * 「还原一道题」要用到的那几样东西。
 *
 * 【为什么要单独抽出来】错题条目（`WrongBookEntry`）和收藏条目（`FavoriteItem`）
 * 都带着这几样，也都要回答同一个问题：「这条记录对应的题去哪找」。
 * 各写一份解析的话，一份改了另一份没改，表现是**同一道题在错题本里能重做、
 * 在收藏页里点不开**（或者反过来）—— 不报错，用户只会觉得这软件有点怪。
 * 规则只有下面 `resolveRefQuestion` 一份实现。
 */
export interface QuestionRef {
  /** 全局键（判据看的是它，见下） */
  key: string
  /** 宿主课号（AI 题的宿主课 = 「这题考的是哪一课」） */
  lessonId: string
  qid: string
  /** AI 题随条目一起存下来的本体 */
  ai?: Question
}

/**
 * 把一条记录还原成题目。还原不出来的返回 null（调用方负责跳过它）。
 *
 * `findBuiltIn` 是注入的：内容包只在渲染进程手里，而这里要保持可测
 * （测试塞一个假的内容包查找函数就行）。同 deepseek.ts 注入 fetch 的做法。
 *
 * ⚠️ **AI 题不走 `findBuiltIn`，即使它有课号**。
 * AI 题的 lessonId 是它的**宿主课**（「这道题考的是哪一课」），
 * 拿它去内容包里按题号找是找不到的，白跑一趟；更糟的是万一将来
 * 内置题里真出现了同号的题，会**拿错题顶上**，而用户看不出区别。
 */
export function resolveRefQuestion(
  ref: QuestionRef,
  findBuiltIn: (lessonId: string, qid: string) => Question | null
): Question | null {
  if (isAiKey(ref.key)) return ref.ai ?? null
  return findBuiltIn(ref.lessonId, ref.qid)
}

/** 错题条目版的 `resolveRefQuestion`（签名被 wrongbook.test.ts 钉着，别动） */
export function resolveWrongQuestion(
  e: WrongBookEntry,
  findBuiltIn: (lessonId: string, qid: string) => Question | null
): Question | null {
  return resolveRefQuestion(e, findBuiltIn)
}
