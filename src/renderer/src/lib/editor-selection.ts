/**
 * 「编辑器选区」的**登记处**（P1，给 AI 侧栏的 @选区 用）。
 *
 * 【为什么需要这么一层，而不是让侧栏直接找编辑器】
 * 侧栏住在**应用外壳的右栏**（`App.vue`），编辑器住在 `RunnerPanel` 里 ——
 * 两者是不同层级的组件，中间隔着一个 `router-view`。兄弟/跨层直接把 ref
 * 传过去，就得让外壳知道"哪个页面此刻有编辑器"，那是把页面的内部结构
 * 泄露给外壳。
 *
 * 【为什么用登记处，而不是 Pinia store】
 * 要共享的只有两样东西：「现在能不能取到选区」这一个**布尔**，以及一个
 * 取值的函数。放进 store 会给它一个"全局状态"的身份，而它其实是
 * **组件生命周期内的临时能力**（进练习场才有、离开就没）。同项目的
 * `lib/pet-work-rect.ts` 用的是同一套思路（登记 + 出栈 + 发布）。
 *
 * 【为什么单独一个 hasSelection，而不是每次现算】
 * 侧栏那个勾选行要**跟着选区变**：用户一选中，它就该从"（先在编辑器里选一段）"
 * 变成"选中片段"。没有这个响应式信号，界面就得等别的原因触发重渲染才更新 ——
 * 用户会以为它坏了（2026-10-25 就是这个状态：一直灰着）。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫：字符串一律 ASCII。
 */
import { ref, type Ref } from 'vue'
import type { AiChatSelection } from '../../../shared/types'

/** 取选区的函数（由 RunnerPanel 登记，闭包持有它自己的 editor ref） */
type SelectionSource = () => AiChatSelection | null

let source: SelectionSource | null = null

/**
 * 「此刻编辑器里有没有一段非空选区」。
 *
 * 写它的人是编辑器（CodeMirror 的 updateListener），读它的人是侧栏。
 * 只在**真假翻转**时才有意义 —— 调用方应当先比较再写，避免每敲一个键
 * 都惊动一次 Vue 的依赖追踪（虽然成本很低，但没必要）。
 */
const hasSelection = ref(false)

/** 只读出口：侧栏用 `selectionAvailable.value` 决定那颗勾能不能点 */
export const selectionAvailable: Readonly<Ref<boolean>> = hasSelection

/** 编辑器挂载时登记（重复登记以最后一次为准：同一时刻只可能有一个练习场） */
export function registerSelectionSource(fn: SelectionSource): void {
  source = fn
}

/**
 * 编辑器卸载时撤销登记。
 *
 * 【必须比对是不是自己】遮罩/路由切换时可能出现"新的先登记、旧的后卸载"，
 * 无条件清空会把新的那根线也剪掉 —— 同 `pet-work-rect` 出栈的理由。
 */
export function releaseSelectionSource(fn: SelectionSource): void {
  if (source === fn) source = null
  hasSelection.value = false
}

/** 编辑器每次选区变化时回报（CodeMirror 的 selectionSet） */
export function markSelectionState(has: boolean): void {
  if (hasSelection.value !== has) hasSelection.value = has
}

/**
 * 现取选区。没有编辑器、或没有选区时返回 null。
 *
 * 【为什么是"现取"而不是缓存一份】选中 → 改一个字 → 再问，缓存的那份就过期了；
 * 而过期的选区发出去，模型会对着**已经不存在的代码**回答 —— 用户看不出来。
 */
export function readSelection(): AiChatSelection | null {
  if (!source) return null
  try {
    return source()
  } catch {
    // 取不到就当没有（编辑器正在销毁的那一帧，position 可能已经失效）
    return null
  }
}
