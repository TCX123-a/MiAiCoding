/**
 * 开屏判定与规范化（src/shared/splash.ts）
 *
 * 【这个文件在守什么】decideSplash 是「这次启动放不放开屏、放哪一段」的
 * 唯一判定口，主进程的 createSplashGate 与这里共用同一份实现。它的坏法
 * 全是静默的：
 *   1. **该放的不放**（比如低内存判定方向写反）—— 用户以为开屏坏了，
 *      而日志里一个字都没有；
 *   2. **不该放的放了**（比如 flag 没拦住）—— 探针与排障口失效，
 *      「每次启动都冒一个窗口出来」；
 *   3. **放错文件**（fixed 未命中时不回退、或回退越出了池子）——
 *      「指定了 A 却播了 B」和「勾好的池子被偷偷放成全量」都是失礼。
 *
 * 【真值表的读法】判定顺序是「先到先拦」：flag → disabled → 素材（no-material /
 * pool-missing）→ low-mem → 挑片。下面每条用例都只让**一个**条件为假，
 * 钉住它确实在那个位置被拦（比如 disabled + 空素材目录要报 disabled 而不是
 * no-material —— 两个都"对"，但排障时指向的修法完全不同）。
 */
import { describe, expect, it } from 'vitest'
import {
  decideSplash,
  defaultSplash,
  normalizeSplash,
  FADE_MS,
  LOW_MEM_GB,
  SPLASH_POOL_MAX,
  SPLASH_VOLUME_MAX,
  SPLASH_VOLUME_MIN,
  type DecideSplashInput,
  type SplashConfig,
  type SplashMaterialRef
} from '../splash'

/** 造一个素材行（abs 只求形状对，判定只看 name） */
function mat(name: string, sizeBytes = 2048): SplashMaterialRef {
  return { name, abs: `X:/splash/${name}`, sizeBytes }
}

/**
 * 完整配置：在默认值上叠加。**显式把 enabled 打开**（2026-10-17 起
 * defaultSplash 的默认是关 —— 分享版拍板）；这一整组用例测的是
 * 「用户把开屏打开了」之后的行为，默认关另有一条用例钉着。
 */
function cfgOf(over: Partial<SplashConfig> = {}): SplashConfig {
  return { ...defaultSplash(), enabled: true, ...over }
}

/** 判定入参：除显式覆盖外，全是「一切就绪」——用例只制造自己关心的那一个变量 */
function inputOf(over: Partial<DecideSplashInput> = {}): DecideSplashInput {
  return {
    config: cfgOf(),
    noSplashFlag: false,
    force: false,
    totalMemGB: 8,
    files: [mat('a.mp4'), mat('b.mp4'), mat('c.mp4')],
    rand: () => 0,
    ...over
  }
}

// ---------------------------------------------------------------- normalizeSplash

describe('normalizeSplash：坏值回默认，绝不抛', () => {
  it('非对象输入（null/数字/字符串/数组/布尔）一律回默认', () => {
    // 磁盘上的配置是「别人硬盘上那份我们没见过的文件」，什么都可能出现。
    // 数组是单独的坑：typeof [] === 'object'，漏判会走进 Record 分支。
    for (const garbage of [null, undefined, 42, 'x', [], true]) {
      expect(normalizeSplash(garbage), String(garbage)).toEqual(defaultSplash())
    }
  })

  it('空对象回默认（老版本配置没有 splash 一节）', () => {
    expect(normalizeSplash({})).toEqual(defaultSplash())
  })

  it('★ 2026-10-17 分享版默认：开屏默认关；老配置里显式写的值原样保留', () => {
    // 默认关只影响**全新配置**；normalize 对显式布尔值不重写，
    // 所以已经开着开屏的老用户升级后不会被这次改默认值静音。
    expect(defaultSplash().enabled).toBe(false)
    expect(normalizeSplash({ enabled: true }).enabled).toBe(true)
    expect(normalizeSplash({ enabled: false }).enabled).toBe(false)
  })

  it('合法值原样保留 —— 尤其 enabled:false / sound:false / volume:0 这些假值', () => {
    // 「false 被当成没带、回成 true」是这类规范化的经典坏法：
    // 用户明明关了开屏，重开软件又冒出来。
    const out = normalizeSplash({
      enabled: false,
      pick: 'fixed',
      fixedFile: 'x.mp4',
      pool: ['x.mp4'],
      sound: false,
      volume: 0,
      fit: 'cover',
      opaque: true
    })
    expect(out).toEqual({
      enabled: false,
      pick: 'fixed',
      fixedFile: 'x.mp4',
      pool: ['x.mp4'],
      sound: false,
      volume: 0,
      fit: 'cover',
      opaque: true
    })
  })

  it('volume：越界钳回区间、坏值回默认、小数四舍五入', () => {
    const v = (x: unknown): number => normalizeSplash({ volume: x }).volume
    expect(v(SPLASH_VOLUME_MAX + 50)).toBe(SPLASH_VOLUME_MAX)
    expect(v(SPLASH_VOLUME_MIN - 5)).toBe(SPLASH_VOLUME_MIN)
    expect(v(Number.NaN)).toBe(defaultSplash().volume)
    expect(v(Number.POSITIVE_INFINITY)).toBe(defaultSplash().volume)
    expect(v('50')).toBe(defaultSplash().volume) // 字符串不猜数字
    expect(v(49.6)).toBe(50)
  })

  it('pick/fit 白名单之外回默认（大小写、数字、新字符串都拦）', () => {
    expect(normalizeSplash({ pick: 'FIXED' }).pick).toBe('random')
    expect(normalizeSplash({ pick: 1 }).pick).toBe('random')
    expect(normalizeSplash({ fit: 'COVER' }).fit).toBe('contain')
    expect(normalizeSplash({ pick: 'fixed' }).pick).toBe('fixed')
    expect(normalizeSplash({ fit: 'cover' }).fit).toBe('cover')
  })

  it('fixedFile：trim 字符串，非字符串回空串', () => {
    expect(normalizeSplash({ fixedFile: '  a.mp4  ' }).fixedFile).toBe('a.mp4')
    expect(normalizeSplash({ fixedFile: 42 }).fixedFile).toBe('')
  })

  it('pool：过滤非字符串/空串、保序去重、trim 每一项', () => {
    const out = normalizeSplash({
      pool: ['a.mp4', 42, '', '  ', 'b.mp4', 'a.mp4', ' c.mp4 ']
    }).pool
    expect(out).toEqual(['a.mp4', 'b.mp4', 'c.mp4'])
  })

  it('pool：非数组回空数组，超长截断到上限（不报错）', () => {
    expect(normalizeSplash({ pool: 'a.mp4' }).pool).toEqual([])
    const big = Array.from({ length: SPLASH_POOL_MAX + 10 }, (_, i) => `v${i}.mp4`)
    expect(normalizeSplash({ pool: big }).pool).toHaveLength(SPLASH_POOL_MAX)
  })

  it('整树新造 —— 返回值不与输入共享任何引用（引用共享是改一处四处动的温床）', () => {
    const src = { enabled: true, pool: ['a.mp4'] }
    const out = normalizeSplash(src)
    expect(out.pool).not.toBe(src.pool)
    out.pool.push('mutated.mp4')
    expect(src.pool).toEqual(['a.mp4'])
  })
})

// ---------------------------------------------------------------- decideSplash

describe('decideSplash：先到先拦的顺序', () => {
  it('flag 最大：别的条件全都「能放」也照样跳过', () => {
    const d = decideSplash(inputOf({ noSplashFlag: true }))
    expect(d).toEqual({ action: 'skip', reason: 'flag' })
  })

  it('disabled 优先于素材判定：关了开屏 + 空素材目录 → 报 disabled（排障指的方向不同）', () => {
    const d = decideSplash(inputOf({ config: cfgOf({ enabled: false }), files: [] }))
    expect(d).toEqual({ action: 'skip', reason: 'disabled' })
  })

  it('池子空 + 磁盘没素材 → no-material；池子非空但名字全对不上 → pool-missing', () => {
    // 两种空的修法完全不同：一个是「去放素材」，一个是「你勾的名字没了」。
    expect(decideSplash(inputOf({ files: [] }))).toEqual({ action: 'skip', reason: 'no-material' })
    const d = decideSplash(
      inputOf({ config: cfgOf({ pool: ['gone.mp4'] }), files: [mat('a.mp4')] })
    )
    expect(d).toEqual({ action: 'skip', reason: 'pool-missing' })
  })

  it('素材判定在低内存判定**之前**：又没素材又低内存 → 报 no-material', () => {
    const d = decideSplash(inputOf({ files: [], totalMemGB: 1 }))
    expect(d).toEqual({ action: 'skip', reason: 'no-material' })
  })

  it('低内存安全阀：低于阈值跳过、等于阈值放行（边界是 < 不是 <=）', () => {
    expect(decideSplash(inputOf({ totalMemGB: LOW_MEM_GB - 0.4 }))).toEqual({
      action: 'skip',
      reason: 'low-mem'
    })
    expect(decideSplash(inputOf({ totalMemGB: LOW_MEM_GB })).action).toBe('play')
  })

  it('totalMemGB <= 0 视为「取不到」不拦；force 越过安全阀（给低配定标机的逃生舱）', () => {
    expect(decideSplash(inputOf({ totalMemGB: 0 })).action).toBe('play')
    expect(decideSplash(inputOf({ totalMemGB: 1, force: true })).action).toBe('play')
  })
})

describe('decideSplash：挑片', () => {
  it('random：rand 落哪一格就播哪一格（0 → 第一个，0.999… → 最后一个）', () => {
    expect(decideSplash(inputOf({ rand: () => 0 }))).toMatchObject({
      action: 'play',
      file: { name: 'a.mp4' }
    })
    expect(decideSplash(inputOf({ rand: () => 0.99999 }))).toMatchObject({
      action: 'play',
      file: { name: 'c.mp4' }
    })
  })

  it('random：注入的 rand 越界（契约是 [0,1)）也不许播出数组外 —— 钳索引', () => {
    // rand 是注入的假货（测试/将来别的源），契约外的值不能变成 undefined 文件。
    expect(decideSplash(inputOf({ rand: () => 1 }))).toMatchObject({ file: { name: 'c.mp4' } })
    expect(decideSplash(inputOf({ rand: () => -0.5 }))).toMatchObject({ file: { name: 'a.mp4' } })
  })

  it('random：候选池非空时只从池子里抽，池外素材不参与', () => {
    const d = decideSplash(
      inputOf({ config: cfgOf({ pool: ['c.mp4'] }), rand: () => 0 })
    )
    expect(d).toMatchObject({ action: 'play', file: { name: 'c.mp4' } })
  })

  it('fixed 命中：播指定的那一个（对象带 abs/sizeBytes，播放端直接可用）', () => {
    const d = decideSplash(
      inputOf({ config: cfgOf({ pick: 'fixed', fixedFile: 'b.mp4' }) })
    )
    expect(d).toMatchObject({ action: 'play', file: { name: 'b.mp4', abs: 'X:/splash/b.mp4' } })
  })

  it('fixed 未命中：回退**候选第一个**而不是整个跳过（磁盘上有素材就别黑着进界面）', () => {
    const d = decideSplash(
      inputOf({ config: cfgOf({ pick: 'fixed', fixedFile: 'zz.mp4' }) })
    )
    expect(d).toMatchObject({ action: 'play', file: { name: 'a.mp4' } })
  })

  it('fixed 未命中且池子非空：回退目标是**池内**第一个（不越出用户勾选范围）', () => {
    const d = decideSplash(
      inputOf({
        config: cfgOf({ pick: 'fixed', fixedFile: 'a.mp4', pool: ['b.mp4', 'c.mp4'] })
      })
    )
    expect(d).toMatchObject({ action: 'play', file: { name: 'b.mp4' } })
  })

  it('pick=fixed 但 fixedFile 是空串：走随机（没指定等于没指定）', () => {
    const d = decideSplash(
      inputOf({ config: cfgOf({ pick: 'fixed', fixedFile: '' }), rand: () => 0 })
    )
    expect(d).toMatchObject({ action: 'play', file: { name: 'a.mp4' } })
  })
})

// ---------------------------------------------------------------- 时长常量

describe('时长常量', () => {
  it('FADE_MS 是正值且开屏页 CSS 与它同源（此处只钉住常量本身；CSS 侧在 splash-static）', () => {
    expect(FADE_MS).toBeGreaterThan(0)
  })
})
