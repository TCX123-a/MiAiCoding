import { describe, expect, it } from 'vitest'
import { WALLPAPER_OBJECT_FITS, WALLPAPER_QUALITIES } from '../../../../../shared/wallpaper'
import {
  fitForScene,
  mountBudgetMs,
  prepareTimeoutFor,
  qualityForScene,
  qualityPatchForScene,
  sceneVolumeFor,
} from '../engine'

/**
 * 场景引擎接线层（renderer/src/lib/wallpaper/engine.ts）的纯函数面。
 *
 * 【这里守什么】四个映射表都是"肉眼看着对、错了也静默"的典型：
 *  · 预算错 → 要么等太久（卡在装不上的壁纸上），要么预算比库内看门狗还
 *    急、诊断来不及上报；两者的症状都是"就是转圈"，没有红字。
 *  · fit 错 → 画面形变（stretch 混进 cover 位）或裁切，看得见但没有报错。
 *  · quality 映射错 → 省电档关不掉后处理（低配机卡死）/"自动"被锁成高
 *    （autoQuality 的自适应永远不创建），症状是"某台机器就是卡"。
 *  · 音量闸口径错（sceneVolumeFor）→ 场景要么永远静音（「怎么调音量都没
 *    声音」），要么过场期新旧两个声源叠加（R7）；两者都没有红字。
 * 挂载/收尸（mountScene/destroyScene）刻意不在这里测：它们要真引擎 + DOM +
 * WebGL，属于体验窗探针的活；此处只钉住映射口径。
 */

const MB = 1024 * 1024

describe('mountBudgetMs：首帧预算 = clamp(15s…90s, 大小 ÷ 8MB/s)', () => {
  it('未知大小（null / NaN / 非正数）退回 60s 缺省', () => {
    // null 是扫描时 stat 失败的载体，不是"0 字节"——必须走缺省而不是钳到下限
    expect(mountBudgetMs(null)).toBe(60000)
    expect(mountBudgetMs(Number.NaN)).toBe(60000)
    expect(mountBudgetMs(0)).toBe(60000)
    expect(mountBudgetMs(-5)).toBe(60000)
  })

  it('小包钳到 15s 下限（真实装配再快也留足余量）', () => {
    expect(mountBudgetMs(1 * MB)).toBe(15000) // ≈125ms → 钳 15s
    expect(mountBudgetMs(120 * MB)).toBe(15000) // 恰好 15000ms 的边界
    expect(mountBudgetMs(121 * MB)).toBeGreaterThan(15000)
  })

  it('中间区间按 8MB/s 线性（200MB → 25s）', () => {
    expect(mountBudgetMs(160 * MB)).toBe(20000)
    expect(mountBudgetMs(200 * MB)).toBe(25000)
    expect(mountBudgetMs(400 * MB)).toBe(50000)
  })

  it('大包钳到 90s 上限（再大也不无限等）', () => {
    expect(mountBudgetMs(720 * MB)).toBe(90000) // 恰好 90000ms 的边界
    expect(mountBudgetMs(4 * 1024 * MB)).toBe(90000)
  })
})

describe('prepareTimeoutFor：本层 deadline = 库看门狗 + 5s，下限 20s', () => {
  it('常规档位都加 5s（先响的永远是库，诊断能上报）', () => {
    expect(prepareTimeoutFor(60000)).toBe(65000)
    expect(prepareTimeoutFor(90000)).toBe(95000)
  })

  it('短预算时下限 20s 兜底（小包的库超时 15s 仍先于本层 deadline）', () => {
    expect(prepareTimeoutFor(15000)).toBe(20000)
    expect(prepareTimeoutFor(10000)).toBe(20000)
  })
})

describe('fitForScene：四档适配 → 引擎 Fit 三档', () => {
  it('cover/contain 直通', () => {
    expect(fitForScene('cover')).toBe('cover')
    expect(fitForScene('contain')).toBe('contain')
  })

  it('center（不缩放）映射 contain——宁可轻微缩放，也不给 stretch 形变', () => {
    expect(fitForScene('center')).toBe('contain')
  })

  it('fill 映射 stretch（唯一会形变的一档，用户自己选的）', () => {
    expect(fitForScene('fill')).toBe('stretch')
  })

  it('对全枚举无遗漏：每个输入都落在引擎三档内', () => {
    for (const f of WALLPAPER_OBJECT_FITS) {
      expect(['cover', 'contain', 'stretch']).toContain(fitForScene(f))
    }
  })
})

describe('qualityForScene：挂载期画质', () => {
  it('省电 = 粒子 low + 后处理显式 off（低配保命档）', () => {
    expect(qualityForScene('off')).toEqual({ particles: 'low', postProcessing: 'off' })
  })

  it('高 = 全高（用户显式画的档，引擎不许改写）', () => {
    expect(qualityForScene('high')).toEqual({ particles: 'high', postProcessing: 'high' })
  })

  it('自动 = undefined —— 不传 quality 键，autoQuality 全权接管', () => {
    // 传实档就把"自动"锁死了：软件渲染分支填不进 off、运行期自适应也不创建。
    // 这条断言是防止有人"顺手补个默认值"。
    expect(qualityForScene('auto')).toBeUndefined()
  })
})

describe('qualityPatchForScene：运行期热更画质', () => {
  it('省电与挂载期同档', () => {
    expect(qualityPatchForScene('off')).toEqual(qualityForScene('off'))
  })

  it('自动与高同档（引擎边界：挂载后创建不出自适应，只能给实档）', () => {
    // 挂载时按 auto 的实例没有自适应降级器，setQuality 也无法复活它；
    // 这里 auto=high 是如实口径，不是偷懒 —— 注释见 engine.ts。
    expect(qualityPatchForScene('auto')).toEqual({ particles: 'high', postProcessing: 'high' })
    expect(qualityPatchForScene('high')).toEqual({ particles: 'high', postProcessing: 'high' })
  })

  it('对全枚举无遗漏：每个档都给出实档（运行期不允许 undefined）', () => {
    for (const q of WALLPAPER_QUALITIES) {
      const patch = qualityPatchForScene(q)
      expect(patch.particles).toBeTruthy()
      expect(patch.postProcessing).toBeTruthy()
    }
  })
})

describe('sceneVolumeFor：场景 BGM 的有效音量（闸 && trackOn）', () => {
  // 判据与视频侧 audioGate 同构（WallpaperLayer：v === audioGate && trackOn &&
  // vol > 0）。这个函数是场景出声的唯一取值口径（engine.ts 的 initialVolume 与
  // WallpaperLayer 的 inst.setVolume 都从它取数），错法的症状全是静默：
  // 要么永远静音「怎么调音量都没声音」，要么过场期两个声源叠加（R7）。
  it('展示层 + 音轨开 + 音量 50 ⇒ 0.5（唯一的出声组合）', () => {
    expect(sceneVolumeFor(true, true, 50)).toBe(0.5)
    expect(sceneVolumeFor(true, true, 100)).toBe(1)
  })

  it('非展示层 ⇒ 0（双槽过场期旧场景绝不出声，R7 单声源）', () => {
    expect(sceneVolumeFor(false, true, 50)).toBe(0)
    expect(sceneVolumeFor(false, true, 100)).toBe(0)
  })

  it('trackOn=false ⇒ 0（强制静音；音量数值保留是配置层的事，这里只看开关）', () => {
    expect(sceneVolumeFor(true, false, 50)).toBe(0)
  })

  it('音量 0 ⇒ 0（默认值就是 0 = 静音起步，接线后也不能出声）', () => {
    expect(sceneVolumeFor(true, true, 0)).toBe(0)
  })

  it('越界钳到 [0,1]（配置净化之外的保险，防手改配置把主增益顶爆）', () => {
    expect(sceneVolumeFor(true, true, -20)).toBe(0)
    expect(sceneVolumeFor(true, true, 150)).toBe(1)
  })
})
