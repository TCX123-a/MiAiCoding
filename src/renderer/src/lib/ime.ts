/**
 * 输入法组词判定（2026-10-31 自检 P2）。
 *
 * 【为什么需要】中文/日文输入法在**选词**时按 Enter 是「确认候选、上屏」，
 * 不是「提交表单」。组词状态下 keydown 的 `isComposing` 为 true；部分
 * 输入法/环境（尤其旧 IME、某些 Windows 组合键）只留下 `keyCode === 229`
 * 这个传统信号。两条都不看的话：登录/注册、答题、搜索都会在用户只是
 * 选了个字的瞬间被提交 —— 而且提交的是半截内容，看起来像应用「乱点」。
 *
 * 【为什么抽成函数】MiInput 与 SearchPanel 是两个独立入口；判定只此一份，
 * 测试只钉这一份。参数写成结构子集，node 环境的单测不用造真 KeyboardEvent。
 */
export function isImeComposing(e: { isComposing?: boolean; keyCode?: number }): boolean {
  return e.isComposing === true || e.keyCode === 229
}
