/**
 * 关窗拦截的**纯判定**（2026-11-01）。
 *
 * 【为什么不写在 App.vue 里】这段逻辑有三条容易写反的分支：
 *   1. 当前课已经绿了 → 直接放行，不许弹；
 *   2. 当前课没绿 → 用「最后访问的课」，不是只看「读到末尾的课」；
 *   3. 当前课没绿、但它是草稿/坏课号 → 退到待结算那课。
 * 抽成纯函数才能把这三条钉在单测里；写在组件里只能靠手点。
 */
import { LANG_DISPLAY, STAGE_DISPLAY } from '../../../shared/copy'
import { SETTLE } from './copy'
import type { Lesson } from '../../../shared/types'

export interface CloseLessonPickInput {
  /** 最后一次真正打开过的课（内存态） */
  lastLessonId: string | null
  /** 读到末尾、但还没点「学到这里啦喵」的课（内存态） */
  pendingSettleId: string | null
  isLearned: (id: string) => boolean
  /** 这一课有没有正文、能不能被「学到这里啦喵」点亮（草稿课不能） */
  isSettleable: (id: string) => boolean
}

/**
 * 挑出「关窗时该拿哪一课去问」。
 *
 * 顺序是**最后访问的课优先，然后才是待结算课**：
 * 用户可能先读到 A 的末尾，随后又打开 B 看了一半 —— 他眼前是 B，
 * 弹窗就该说 B；而结算会把 B 之前（含 A）的未绿课一起点亮，两者不冲突。
 *
 * 已绿的课跳过；跳到下一候选（待结算课）—— 待结算课还没绿时，
 * 说明确实有一笔该结算的账，不能因为当前课绿了就假装没有。
 *
 * 返回 `null` = 没有需要拦的课，调用方直接放行。
 */
export function pickCloseLesson(input: CloseLessonPickInput): string | null {
  const seen = new Set<string>()
  for (const id of [input.lastLessonId, input.pendingSettleId]) {
    if (id === null || id === '' || seen.has(id)) continue
    seen.add(id)
    if (!input.isSettleable(id)) continue
    if (input.isLearned(id)) continue
    return id
  }
  return null
}

/**
 * 弹窗里那句课名。形如 `C · 入门 · 第 3 课：变量与小鱼干仓库`。
 *
 * 【为什么不是「第 X 章」】内容模型里没有章，只有语言/阶段/课序 ——
 * 编一个章号出来会让用户拿它去侧栏里找，而侧栏根本没有这个东西。
 * 找不到正文（草稿课）时退回大纲课名，再退回一句「这一课」。
 */
export function lessonPathLabel(lesson: Lesson | undefined, fallbackTitle?: string): string {
  if (!lesson) {
    const title = fallbackTitle?.trim() ?? ''
    return title === '' ? SETTLE.CLOSE_LESSON_FALLBACK : title
  }
  const lang = LANG_DISPLAY[lesson.lang] ?? lesson.lang
  const stage = STAGE_DISPLAY[lesson.stage] ?? String(lesson.stage)
  return SETTLE.CLOSE_LESSON_PATH(lang, stage, lesson.order, lesson.title)
}
