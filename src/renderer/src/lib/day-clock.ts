/**
 * 「今天是哪天」的活时钟（高-5 / 极端场景[0] 修复现场，2026-10-15）。
 *
 * 【为什么需要它 —— 一个「零依赖 computed」吃掉了一整天】
 * 挑战 store 原来写的是 `const dateKey = computed(() => todayKey())`：
 * 求值函数里**没有任何响应式依赖**，Vue 算过一次就把它缓存到进程结束。
 * 这是个常驻应用（桌宠 + 托盘），开着过夜是常态 —— 过了零点它还拿昨天的
 * 日键读盘、判「今天挑战过没有」：每天都做挑战的人，每两天坏一天，
 * 而且**必须重启应用才恢复**（活窗实测：过零点后挑战页一直说"今天已经挑战过啦"）。
 * 签到页的 `checkedInToday` 是同一个写法、同一个病。
 *
 * 【机制】把「今天」变成一个 **ref**，三层互为兜底地跟真实日期对齐：
 *   ① 准点：到下一个零点的 `setTimeout`（到点自己重新武装）；
 *   ② 唤醒：window `focus` / `visibilitychange` 各复检一次 ——
 *      合盖过夜再打开，这两个事件会先于任何计时器到达（计时器在休眠中不走）；
 *   ③ 兜底：每次复检都是「即取即比」，不依赖任何累积状态 ——
 *      漏了一百次没触发，下一次触发就补回来。
 *
 * 【为什么不干脆每次读的时候 new Date()】读盘、判「今天抽没抽过」的地方
 * 需要的是**响应式的**今天：跨天的那一刻要自动触发界面重读新一天的存档。
 * 一个纯函数给不了这个 —— 那正是原来那行 computed 写错的原因
 * （它看起来像响应式，实际是个常量）。
 */
import { readonly, ref } from 'vue'
import { msUntilNextMidnight, todayKey } from '../../../shared/dates'

const dayKey = ref(todayKey())
let started = false

/**
 * 复检一次：真到了新的一天就翻 ref（响应式消费者自动跟着走）。
 * 导出它是为了两件事：给测试一个手动推钟的入口；也给将来任何
 * 「休眠回来先别等事件」的场合一个现成的钩子。
 */
export function refreshToday(): void {
  const k = todayKey()
  if (k !== dayKey.value) dayKey.value = k
}

/** 只读的今天日键（响应式）。跨零点 / 合盖唤醒后自动变成新的一天。 */
export const today = readonly(dayKey)

function armMidnightTimer(): void {
  window.setTimeout(() => {
    refreshToday()
    armMidnightTimer()
  }, msUntilNextMidnight())
}

/**
 * 起钟。main.ts 启动时调一次（幂等，重复调无副作用）。
 *
 * 非浏览器环境（node 单测）**不起钟**：那儿没有 window，拉不起计时器也不该炸。
 * 那时 `today` 仍是可用的 ref，测试直接调 `refreshToday()` 推它走。
 */
export function startDayClock(): void {
  if (started || typeof window === 'undefined') return
  started = true
  armMidnightTimer()
  window.addEventListener('focus', refreshToday)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshToday()
  })
}
