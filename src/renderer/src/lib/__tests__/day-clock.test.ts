/**
 * 活时钟（lib/day-clock.ts，高-5 修复的机器守卫，2026-10-15）
 *
 * 【它在守什么】「今天是哪天」原来是一组零依赖 computed —— 常驻应用开着
 * 过零点后永远拿昨天的日键，必须重启才恢复。活时钟把「今天」变成 ref，
 * 三条路径跟真实日期对齐：①准点计时器 ②唤醒复检（focus / visibilitychange）
 * ③即取即比的 refreshToday。这个文件把三条都钉住。
 *
 * 【为什么敢用 stubGlobal 假造 window/document 来测】给 store 塞假货测
 * 「运行中」开关是仓里现成的先例（vitest.config.ts 里那段注释）。
 * 对 `window` 的依赖只有三处（setTimeout / addEventListener ×2），
 * 假货是最小的：真起一个 Electron 窗口才有资格测的，那是 CDP 探针的活。
 *
 * 【测试顺序有意义，别随手重排】第一条必须在**没有** stub 的真 node 环境里
 * 跑（验「没有 window 时不炸、也不起钟」）；第二条 stub 之后 startDayClock
 * 就记了 started（幂等闸）——同一文件里没有第二次起钟的机会，三条路径
 * 全放在第二条里一次走完。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshToday, startDayClock, today } from '../day-clock'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * 把假钟拨到北京时间的某个时刻。
 *
 * 【为什么必须显式写 +08:00】被测代码 2026-10-22 起固定按北京时间翻日，
 * 用 `new Date(y, mo - 1, d, ...)`（本地构造器）写夹具的话，测试机换成 UTC
 * 或美西时区时，「23:59 起钟、61 秒后翻日」这条就会红 —— 而代码是对的。
 * 夹具带 +08:00 后，断言在任何机器上都成立。
 */
function setBeijing(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): void {
  vi.setSystemTime(
    new Date(`${y}-${pad2(mo)}-${pad2(d)}T${pad2(h)}:${pad2(mi)}:${pad2(s)}+08:00`)
  )
}

describe('day-clock 活时钟', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('node 环境（无 window）调 startDayClock 不炸 —— 且不置 started（之后还能真起钟）', () => {
    // 这条必须先于 stub 的那条跑：此刻 window 真的不存在。
    // 不起钟是**设计**（单测里没有 window，拉不起计时器也不该炸），
    // 而 started 不置位保证下一条 stub 后还能起 —— 这一条本身就在验它。
    expect(typeof window).toBe('undefined')
    expect(() => startDayClock()).not.toThrow()
  })

  it('refreshToday：同一天内不动，跨天翻值（即取即比的兜底）', () => {
    setBeijing(2026, 10, 15, 23, 59, 0)
    refreshToday()
    expect(today.value).toBe('2026-10-15')

    setBeijing(2026, 10, 15, 23, 59, 59) // 同一天里再复检一次
    refreshToday()
    expect(today.value).toBe('2026-10-15')

    setBeijing(2026, 10, 16, 0, 0, 2) // 过零点了
    refreshToday()
    expect(today.value).toBe('2026-10-16')
  })

  it('startDayClock：准点计时器跨天翻值并重新武装；focus / visibilitychange 也能翻', () => {
    setBeijing(2026, 10, 15, 23, 59, 0)
    refreshToday()
    expect(today.value).toBe('2026-10-15')

    const listeners = new Map<string, () => void>()
    vi.stubGlobal('window', {
      // 转发到（已被 fake timers 接管的）全局 setTimeout —— advanceTimersByTime 推得动它
      setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
      addEventListener: (t: string, fn: () => void) => listeners.set(`window:${t}`, fn)
    })
    vi.stubGlobal('document', {
      hidden: false,
      addEventListener: (t: string, fn: () => void) => listeners.set(`document:${t}`, fn)
    })

    startDayClock()

    // ① 准点：23:59:00 起钟 → 走到 00:00:01，计时器自己响
    vi.advanceTimersByTime(61_000)
    expect(today.value).toBe('2026-10-16')

    // ② 重新武装：再过完整一天，正好落在再下一个零点
    vi.advanceTimersByTime(24 * 3600 * 1000)
    expect(today.value).toBe('2026-10-17')

    // ③ 唤醒复检：休眠中计时器不走 —— 直接跳钟，靠 focus 事件补回来
    //   （合盖过夜再打开就是这个时相：事件先于任何计时器到达）
    setBeijing(2026, 10, 20, 9, 0, 0)
    listeners.get('window:focus')?.()
    expect(today.value).toBe('2026-10-20')

    // ④ visibilitychange 同一条路（从隐藏切回可见时复检）
    setBeijing(2026, 10, 21, 9, 0, 0)
    listeners.get('document:visibilitychange')?.()
    expect(today.value).toBe('2026-10-21')
  })
})
