/**
 * drainWithCap（V1-62）：干涸等待的两条边界。
 *
 * 【这个文件在守什么】两条边界各自错得很安静：
 *   · 「全部落定 → true」错了（比如无脑等满 cap）→ 登出白慢 5 秒，
 *     没人看得出来是 bug —— 顺带钉 clearTimeout：落定后定时器不许还挂着
 *     （getTimerCount 判据，忘了 clear 时这条红）；
 *   · 「到点 → false 放行」错了（cap 没生效）→ V1-62 的原始 bug 原样
 *     保留：断网时退不出登录。这条用**永不放行**的 promise 钉。
 * 另钉一条 andon：reject 的 promise **不许把 drainWithCap 本身炸掉**
 * （allSettled 语义 —— 换成 Promise.all 时这条立刻红）。
 *
 * 用假时钟：本文件测的就是"时间到了没有"的判定，假时钟把它变成确定性的
 * 两次 advanceTimersByTime，真时钟只会引入毫秒级的抖动。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DRAIN_CAP_MS, drainWithCap } from '../drain'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('drainWithCap', () => {
  it('全部落定 → true，且不留定时器（不空等 cap；忘了 clearTimeout 这条红）', async () => {
    await expect(
      drainWithCap(
        [Promise.resolve(1), Promise.reject(new Error('writer 抛了')), Promise.resolve(3)],
        2_000
      )
    ).resolves.toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reject 的半边不炸调用方（allSettled 语义；换 Promise.all 这条红）', async () => {
    await expect(
      drainWithCap([Promise.reject(new Error('whenIdle 编程错误')), Promise.resolve()], 100)
    ).resolves.toBe(true)
  })

  it('永不放行 → 到点 false，一秒都不早（V1-62 原始 bug 的判据：不许永远钉住）', async () => {
    let settled: boolean | null = null
    const p = drainWithCap([new Promise<void>(() => {})], 40).then((v) => {
      settled = v
      return v
    })
    await vi.advanceTimersByTimeAsync(39)
    expect(settled).toBeNull() // 还没到点，不许提前放行
    await vi.advanceTimersByTimeAsync(1)
    await expect(p).resolves.toBe(false)
  })

  it('省略 capMs 时用的就是 DRAIN_CAP_MS（默认参数与导出常量同源）', async () => {
    let settled: boolean | null = null
    void drainWithCap([new Promise<void>(() => {})]).then((v) => {
      settled = v
    })
    await vi.advanceTimersByTimeAsync(DRAIN_CAP_MS - 1)
    expect(settled).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(false)
  })
})
