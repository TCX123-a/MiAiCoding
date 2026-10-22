/**
 * 过场引擎（lib/wallpaper/transitions.ts）—— 纯函数部分的静态钉死。
 *
 * 【守什么】这套数是**逐字移植**原型（DSH 壁纸引擎）的，改一个数就是改行为：
 *   · 时长公式 ms = max(60, round(基准 × 速度档))，cut 恒 0 —— 面板上的
 *     「当前约 N ms」预告和真实过场用的是同一个函数，不一致就是骗人；
 *   · 条带 polygon 的点数恒 4N+1 —— 少一个点就插不平滑（原型注释点名过）；
 *   · random 永远不抽 cut（「随机」选项抽到"没有动画"等于没随机）。
 *
 * 【测不到什么】startLayerTransition / resetSwitchStyles 要真的 DOM 与
 * 计时器（本套件跑 node 环境）—— 那部分的证据在真机探针里（过场类名、
 * --wp-switch-ms、收尾清零），不在这。
 */
import { describe, expect, it } from 'vitest'
import {
  SWITCH_BARS_TEETH,
  SWITCH_TRANSITIONS,
  randomTransitionId,
  resolveTransition,
  switchFrames,
  transitionSpec
} from '../transitions'
import {
  WALLPAPER_TRANSITION_DIRS,
  WALLPAPER_TRANSITION_SPEEDS,
  WALLPAPER_TRANSITIONS,
  type WallpaperTransitionDir
} from '../../../../../shared/wallpaper'

describe('transitionSpec：时长数学与白名单', () => {
  it('ms = round(基准 × 速度档)，三个具体锚点（fade 1800 / push 700 / bars 800）', () => {
    expect(transitionSpec('fade', 1, 'left').ms).toBe(1800)
    expect(transitionSpec('fade', 0.6, 'left').ms).toBe(1080) // 1800 × 0.6
    expect(transitionSpec('fade', 1.6, 'left').ms).toBe(2880) // 1800 × 1.6
    expect(transitionSpec('push', 1, 'left').ms).toBe(700)
    expect(transitionSpec('push', 1.6, 'left').ms).toBe(1120)
    expect(transitionSpec('bars', 0.6, 'left').ms).toBe(480)
    // ⚠️ 公式里的 max(60, …) 下限当前**打不到**（最短基准 700 × 0.6 = 420）——
    // 留着是防御，不是现值；哪天加一个基准 < 100ms 的过场它才会生效。
  })

  it('cut 恒 0：0 是「没有动画」的哨兵（调用方据此走硬切），不许被下限抬起来', () => {
    for (const s of WALLPAPER_TRANSITION_SPEEDS) {
      expect(transitionSpec('cut', s, 'left').ms, `速度档 ${s}`).toBe(0)
    }
  })

  it('速度/方向白名单：不认识的值退回默认档（速度→1，方向→left），不猜', () => {
    expect(transitionSpec('fade', 0.8, 'left').ms).toBe(1800)
    expect(transitionSpec('fade', NaN, 'left').ms).toBe(1800)
    expect(transitionSpec('fade', 1, 'diagonal' as WallpaperTransitionDir).dir).toBe('left')
    expect(transitionSpec('fade', 1, 'left').dir).toBe('left')
    expect(transitionSpec('fade', 1, 'down').dir).toBe('down')
  })

  it('directional 恰好是 push / wipe / bars（方向行的显示条件与它同源）', () => {
    const directional: Record<string, boolean> = {}
    for (const t of SWITCH_TRANSITIONS) {
      directional[t.id] = transitionSpec(t.id, 1, 'left').directional
    }
    expect(directional).toEqual({
      cut: false,
      fade: false,
      push: true,
      wipe: true,
      iris: false,
      zoom: false,
      bars: true
    })
  })

  it('transitionSpec 收到 random（调用方本该先 resolve）→ 退回 fade 基准，不炸', () => {
    expect(transitionSpec('random', 1, 'left')).toEqual(transitionSpec('fade', 1, 'left'))
  })
})

describe('过场表与随机抽取', () => {
  it('SWITCH_TRANSITIONS 恰好覆盖除 random 外的全部过场（面板下拉与它同源）', () => {
    const ids = SWITCH_TRANSITIONS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length) // 不重复
    const expected = WALLPAPER_TRANSITIONS.filter((t) => t !== 'random')
    expect([...ids].sort()).toEqual([...expected].sort())
  })

  it('random 永远不抽 cut；同一种子可复现（头尾两个边界都钉住）', () => {
    expect(randomTransitionId(() => 0)).toBe('fade') // 池头
    expect(randomTransitionId(() => 0.999999)).toBe('bars') // 池尾
    for (let i = 0; i < 50; i++) {
      expect(randomTransitionId(() => i / 50)).not.toBe('cut')
    }
  })

  it('resolveTransition：非 random 原样返回；random 走抽取（不落 cut）', () => {
    expect(resolveTransition('fade')).toBe('fade')
    expect(resolveTransition('zoom')).toBe('zoom')
    expect(resolveTransition('random', () => 0)).toBe('fade')
    expect(resolveTransition('random', () => 0.999999)).toBe('bars')
  })
})

describe('switchFrames：六种过场的帧形状', () => {
  it('push：入场层从「进入侧的反面」推入，退场层往对侧推走（方向四档全钉）', () => {
    expect(switchFrames('push', 'left').inFrom).toEqual({ transform: 'translate3d(100%, 0, 0)' })
    expect(switchFrames('push', 'left').outTo).toEqual({ transform: 'translate3d(-100%, 0, 0)' })
    expect(switchFrames('push', 'right').inFrom).toEqual({ transform: 'translate3d(-100%, 0, 0)' })
    expect(switchFrames('push', 'up').inFrom).toEqual({ transform: 'translate3d(0, 100%, 0)' })
    expect(switchFrames('push', 'down').inFrom).toEqual({ transform: 'translate3d(0, -100%, 0)' })
    expect(switchFrames('push', 'up').inTo).toEqual({ transform: 'translate3d(0, 0, 0)' })
  })

  it('wipe：clip-path inset 四档映射（left = 新画面自右长出来）', () => {
    expect(switchFrames('wipe', 'left').inFrom).toEqual({ clipPath: 'inset(0 0 0 100%)' })
    expect(switchFrames('wipe', 'right').inFrom).toEqual({ clipPath: 'inset(0 100% 0 0)' })
    expect(switchFrames('wipe', 'up').inFrom).toEqual({ clipPath: 'inset(100% 0 0 0)' })
    expect(switchFrames('wipe', 'down').inFrom).toEqual({ clipPath: 'inset(0 0 100% 0)' })
    expect(switchFrames('wipe', 'left').inTo).toEqual({ clipPath: 'inset(0)' })
  })

  it('iris：圆心恒在 50%/50%，75% 覆盖全视口（对角线的 70.7% 留了余量）', () => {
    expect(switchFrames('iris', 'left').inFrom).toEqual({ clipPath: 'circle(0% at 50% 50%)' })
    expect(switchFrames('iris', 'left').inTo).toEqual({ clipPath: 'circle(75% at 50% 50%)' })
  })

  it('zoom：入场层放大+淡入；退场层只轻微前推、**不改 opacity**（保持不透明垫底）', () => {
    const z = switchFrames('zoom', 'up')
    expect(z.inFrom).toEqual({ transform: 'scale(1.06)', opacity: '0' })
    expect(z.inTo).toEqual({ transform: 'scale(1)', opacity: '1' })
    expect(z.outTo).toEqual({ transform: 'scale(1.04)' })
    expect(z.outTo.opacity).toBeUndefined()
  })

  it('bars：clip-path polygon，点数恒 4N+1（N = 齿数；不可平滑插值的前提被钉住）', () => {
    const from = switchFrames('bars', 'left').inFrom.clipPath
    const to = switchFrames('bars', 'left').inTo.clipPath
    expect(from.startsWith('polygon(')).toBe(true)
    expect(to.startsWith('polygon(')).toBe(true)
    expect(from.split(',').length).toBe(4 * SWITCH_BARS_TEETH + 1)
    expect(to.split(',').length).toBe(4 * SWITCH_BARS_TEETH + 1)
    // 初态的深度是 0（还没长出来）、终态是 1（铺满）——两端都要在
    expect(from).not.toBe(to)
  })

  it('fade：纯透明度，退场层不动；wipe/iris/bars 的退场层同样不动（outTo={}）', () => {
    expect(switchFrames('fade', 'up')).toEqual({
      inFrom: { opacity: '0' },
      inTo: { opacity: '1' },
      outTo: {}
    })
    expect(switchFrames('wipe', 'left').outTo).toEqual({})
    expect(switchFrames('iris', 'up').outTo).toEqual({})
    expect(switchFrames('bars', 'right').outTo).toEqual({})
  })

  it('方向枚举穷尽：四档都出得来帧（漏一档会静默返回 undefined 位移）', () => {
    for (const d of WALLPAPER_TRANSITION_DIRS) {
      expect(switchFrames('push', d).inFrom.transform, `方向 ${d}`).toBeTruthy()
      expect(switchFrames('push', d).outTo.transform, `方向 ${d}`).toBeTruthy()
    }
  })
})
