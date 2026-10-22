import { describe, expect, it } from 'vitest'
import { derivePause } from '../pause'
import type { WallpaperPowerConfig } from '../../../../../shared/wallpaper'

/**
 * 暂停语义推导（renderer/src/lib/wallpaper/pause.ts）。
 *
 * 【守什么】「失焦全停 / 掉帧降级」是主人 P3 五条底线里的第 3 条。
 * 三条策略开关各自独立、组合起来还有优先级 —— 这类多布尔逻辑靠手点界面
 * 永远测不全（要造出「最小化 + 失焦 + 电池」同时成立的现场），收成纯函数
 * 就在这里一次铺开。
 */

const OFF: WallpaperPowerConfig = { pauseOnMinimize: false, pauseOnBlur: false, pauseOnBattery: false }
const ALL: WallpaperPowerConfig = { pauseOnMinimize: true, pauseOnBlur: true, pauseOnBattery: true }
const DEFAULT: WallpaperPowerConfig = { pauseOnMinimize: true, pauseOnBlur: true, pauseOnBattery: false }

const normal = { focused: true, minimized: false, visible: true }

describe('derivePause：每条策略各自成立，且能各自关掉', () => {
  it('一切正常 → 播放（why=playing）', () => {
    const r = derivePause(normal, DEFAULT, false, false)
    expect(r.paused).toBe(false)
    expect(r.why).toBe('playing')
  })

  it('失焦：默认停；pauseOnBlur 关掉后照播（这是个真开关，不是写着好看）', () => {
    const blurred = { ...normal, focused: false }
    expect(derivePause(blurred, DEFAULT, false, false)).toEqual({ paused: true, why: 'blur' })
    expect(derivePause(blurred, OFF, false, false).paused).toBe(false)
  })

  it('最小化：默认停；关掉后照播', () => {
    const minned = { focused: false, minimized: true, visible: true }
    expect(derivePause(minned, DEFAULT, false, false).why).toBe('minimized')
    expect(derivePause(minned, OFF, false, false).paused).toBe(false)
  })

  it('窗口 hide（visible=false）：归最小化一族', () => {
    const hidden = { ...normal, visible: false }
    expect(derivePause(hidden, DEFAULT, false, false)).toEqual({ paused: true, why: 'window-hidden' })
    expect(derivePause(hidden, OFF, false, false).paused).toBe(false)
  })

  it('页面 hidden（Chromium 自己标的）与最小化同族：P1 实测失焦不触发它，最小化会', () => {
    const r = derivePause(normal, DEFAULT, /* pageHidden */ true, false)
    expect(r).toEqual({ paused: true, why: 'minimized' })
    // 关掉 pauseOnMinimize 后，pageHidden 单独不再暂停（rAF 停了，但这是策略）
    expect(derivePause(normal, { ...DEFAULT, pauseOnMinimize: false }, true, false).paused).toBe(false)
  })

  it('电池：只有 pauseOnBattery 开着才管（默认关 —— 不是所有人都有电池）', () => {
    expect(derivePause(normal, DEFAULT, false, true).paused).toBe(false)
    expect(derivePause(normal, ALL, false, true)).toEqual({ paused: true, why: 'battery' })
  })
})

describe('derivePause：优先级（why 要指出停在第一条命中的规则上）', () => {
  it('最小化 + 失焦同时成立 → 报 minimized（最小化是更"外层"的事实）', () => {
    const r = derivePause({ focused: false, minimized: true, visible: true }, ALL, false, false)
    expect(r.why).toBe('minimized')
  })

  it('pauseOnMinimize 关着、但失焦开着 → 落到 blur 那条', () => {
    const r = derivePause(
      { focused: false, minimized: true, visible: true },
      { pauseOnMinimize: false, pauseOnBlur: true, pauseOnBattery: false },
      false,
      false
    )
    expect(r).toEqual({ paused: true, why: 'blur' })
  })

  it('全关 → 什么都不停（用户自己选的，如实执行）', () => {
    const r = derivePause({ focused: false, minimized: true, visible: false }, OFF, true, true)
    expect(r.paused).toBe(false)
    expect(r.why).toBe('playing')
  })
})

describe('derivePause：petFocused 只豁免"失焦"一条（2026-10-06 主人报的第一条体验问题）', () => {
  it('点桌宠（失焦 + petFocused）→ 照播；对照臂（同状态无 petFocused）停在 blur', () => {
    const petting = { focused: false, minimized: false, visible: true, petFocused: true }
    expect(derivePause(petting, DEFAULT, false, false)).toEqual({ paused: false, why: 'playing' })
    // 对照臂：豁免真在起作用，而不是 blur 这条规则恰好在别处写没了
    expect(derivePause({ focused: false, minimized: false, visible: true }, DEFAULT, false, false)).toEqual({
      paused: true,
      why: 'blur'
    })
  })

  it('petFocused 不豁免最小化（主人口径：最小化/隐藏照样停）', () => {
    const r = derivePause({ focused: false, minimized: true, visible: true, petFocused: true }, ALL, false, false)
    expect(r.why).toBe('minimized')
  })

  it('petFocused 不豁免电池省电', () => {
    const r = derivePause({ ...normal, petFocused: true }, ALL, false, true)
    expect(r).toEqual({ paused: true, why: 'battery' })
  })

  it('petFocused=false（显式）与缺省同效：失焦照停', () => {
    const r = derivePause({ ...normal, focused: false, petFocused: false }, DEFAULT, false, false)
    expect(r).toEqual({ paused: true, why: 'blur' })
  })
})
