import { describe, expect, it } from 'vitest'
import {
  AUDIO_GAIN_MAX,
  BLUR_MAX,
  DIM_MAX,
  DIM_MIN,
  FPS_UNLIMITED,
  ITEM_ID_MAX_LEN,
  ITEM_PROPS_MAX_KEYS,
  MEDIA_ADJUST_MAX,
  MEDIA_ADJUST_MIN,
  OPACITY_MAX,
  PARALLAX_AMOUNT_MAX,
  PARALLAX_SMOOTH_MAX,
  PLAYBACK_RATE_MAX,
  PROP_NAME_MAX_LEN,
  PROP_VALUE_STR_MAX_LEN,
  WALLPAPER_POOL_MAX,
  WALLPAPER_SCENE_FPS,
  ZOOM_MAX,
  ZOOM_MIN,
  defaultWallpaper,
  normalizeWallpaper
} from '../wallpaper'

/**
 * 壁纸配置块（shared/wallpaper.ts）。
 *
 * 【守的是什么】它是 v10 新加的字段，**三个进料口全从这个函数过**：
 * 读盘（config-migrate）、写盘（config-merge）、渲染层 setter（settings store）。
 * 也就是说它是唯一的形状闸门 —— 它漏了什么，三条路一起漏。
 *
 * 两类坏法各自有专门的历史教训：
 *   · **NaN / 脏类型**：能穿过 `Math.min(Math.max(...))` 写进文件，
 *     之后 `blur: NaN` 让整条滤镜串失效、`selectedId: 42` 让查找静默失配。
 *     所以这里逐字段钉「脏值退回默认，而不是被钳成区间端点」。
 *   · **共享子对象**：四个子块（rotation/parallax/audio/power）如果被两份配置
 *     拿到同一个引用，谁原地改一下另一份就跟着变（DEFAULT_APP_CONFIG 中毒同款）。
 *     所以这里钉「每次现造、整树新引用」。
 */

describe('defaultWallpaper：每次现造一份全新的', () => {
  it('两次调用不共享任何子对象（浅相等会骗人，逐块比引用）', () => {
    const a = defaultWallpaper()
    const b = defaultWallpaper()
    expect(a).toEqual(b)
    expect(a.rotation).not.toBe(b.rotation)
    expect(a.parallax).not.toBe(b.parallax)
    expect(a.audio).not.toBe(b.audio)
    expect(a.power).not.toBe(b.power)
  })

  it('默认口径：关（2026-10-17 分享版）、没选（只垫渐变）、失焦全停、静音', () => {
    // 这几个默认值都是**拍过板的**（docs/23 决策点 5/7；enabled 已被 2026-10-17
    // 朋友分享版拍板覆盖成 false —— 分享版不假设对方装了 WE，见 shared/wallpaper.ts
    // 文件头）。selectedId='' 是「没选」的合法终态、power 前两项是主人的硬性要求、
    // volume=0 是静音起步。
    const d = defaultWallpaper()
    expect(d.enabled).toBe(false)
    expect(d.selectedId).toBe('')
    expect(d.power).toEqual({ pauseOnMinimize: true, pauseOnBlur: true, pauseOnBattery: false })
    expect(d.volume).toBe(0)
    expect(d.dim).toBe(35)
  })
})

describe('normalizeWallpaper：脏值退回默认，不是钳成端点', () => {
  it('整块不是对象（undefined/null/数字/字符串/数组）→ 完整默认块，不崩', () => {
    for (const junk of [undefined, null, 42, 'x', []]) {
      expect(normalizeWallpaper(junk), `这个值没被挡住：${String(junk)}`).toEqual(defaultWallpaper())
    }
  })

  it('NaN / 字符串数字 → **退回默认**（NaN 和谁比都是 false，钳位式拦不住它）', () => {
    const w = normalizeWallpaper({ dim: NaN, blur: '30', brightness: NaN, volume: '80' })
    expect(w.dim).toBe(35)
    expect(w.blur).toBe(0)
    expect(w.brightness).toBe(1)
    expect(w.volume).toBe(0)
  })

  it('越界的**数字**才钳到区间端点（和上面脏值是两条路）', () => {
    const w = normalizeWallpaper({ dim: 999, blur: -5, brightness: 9, volume: -3 })
    expect(w.dim).toBe(DIM_MAX)
    expect(w.blur).toBe(0) // max(0, -5) —— blur 下界就是 0
    expect(w.brightness).toBe(MEDIA_ADJUST_MAX)
    expect(w.volume).toBe(0)
    expect(normalizeWallpaper({ dim: -5 }).dim).toBe(DIM_MIN)
    expect(normalizeWallpaper({ opacity: 999 }).opacity).toBe(OPACITY_MAX)
    expect(normalizeWallpaper({ playbackRate: 99 }).playbackRate).toBe(PLAYBACK_RATE_MAX)
    expect(normalizeWallpaper({ blur: 999 }).blur).toBe(BLUR_MAX)
    expect(normalizeWallpaper({ brightness: 0.1 }).brightness).toBe(MEDIA_ADJUST_MIN)
  })

  it('整数字段四舍五入、浮点字段两位小数（0.1 步进不落 0.30000000000000004）', () => {
    expect(normalizeWallpaper({ dim: 34.6 }).dim).toBe(35)
    expect(normalizeWallpaper({ brightness: 1.23456 }).brightness).toBe(1.23)
  })

  it('枚举白名单：不在名单里的退回默认（写进去不生效最难查）', () => {
    const w = normalizeWallpaper({
      transition: 'dissolve',
      transitionSpeed: 0.8,
      sceneFps: 45,
      quality: 'medium', // 引擎枚举里有 medium，但我们的档位表只有 off/high/auto
      source: 'nas',
      audio: { source: 'bluetooth' }
    })
    expect(w.transition).toBe('fade')
    expect(w.transitionSpeed).toBe(1)
    expect(w.sceneFps).toBe(30)
    expect(w.quality).toBe('auto')
    expect(w.source).toBe('steam')
    expect(w.audio.source).toBe('off')
  })

  it('布尔：非布尔退回该字段的默认极性（enabled 的默认是 false，别照抄成 true）', () => {
    expect(normalizeWallpaper({ enabled: 'nope' }).enabled).toBe(false)
    expect(normalizeWallpaper({ enabled: true }).enabled).toBe(true)
    expect(normalizeWallpaper({ enabled: false }).enabled).toBe(false)
    expect(normalizeWallpaper({ power: { pauseOnBlur: 1 } }).power.pauseOnBlur).toBe(true)
    expect(normalizeWallpaper({ power: { pauseOnBattery: 'yes' } }).power.pauseOnBattery).toBe(false)
  })

  it('selectedId：字符串 trim；非字符串落空串（42 不许活到查找那一步）', () => {
    expect(normalizeWallpaper({ selectedId: '  3284636810  ' }).selectedId).toBe('3284636810')
    expect(normalizeWallpaper({ selectedId: 42 }).selectedId).toBe('')
    expect(normalizeWallpaper({ selectedId: null }).selectedId).toBe('')
  })

  it('volume=0 是**合法值**，不许被当真值丢掉（falsy 陷阱高发区）', () => {
    expect(normalizeWallpaper({ volume: 0 }).volume).toBe(0)
    expect(normalizeWallpaper({ opacity: 0 }).opacity).toBe(0)
    expect(normalizeWallpaper({ dim: 0 }).dim).toBe(0)
  })

  it('子块整个是脏类型 → 各自退回自己的默认，不连坐', () => {
    const w = normalizeWallpaper({ rotation: 'x', parallax: 42, audio: [], power: null, dim: 60 })
    // v15 起 rotation 多了 pool（空 = 全部参与）；脏整块退回默认时它也是空的
    expect(w.rotation).toEqual({ enabled: false, intervalMin: 10, order: 'sequential', pool: [] })
    expect(w.parallax).toEqual({ enabled: true, amount: 3, smooth: 85 })
    expect(w.audio).toEqual({ enabled: false, source: 'off', gain: 1 })
    expect(w.power).toEqual({ pauseOnMinimize: true, pauseOnBlur: true, pauseOnBattery: false })
    expect(w.dim).toBe(60) // 顶层用户值照样保住
  })

  it('v11→v12 四新键：缺失补默认、脏值退回、合法值原样过（老配置首启就靠这条）', () => {
    // 缺键（老配置）→ 补默认
    expect(normalizeWallpaper({}).transitionDir).toBe('left')
    expect(normalizeWallpaper({}).objectFit).toBe('cover')
    expect(normalizeWallpaper({}).trackOn).toBe(true)
    // 脏值 → 退回默认，而不是钳到某个端点
    expect(normalizeWallpaper({ transitionDir: 'diagonal' }).transitionDir).toBe('left')
    expect(normalizeWallpaper({ objectFit: 'stretch' }).objectFit).toBe('cover')
    expect(normalizeWallpaper({ trackOn: 'yes' }).trackOn).toBe(true)
    expect(normalizeWallpaper({ trackOn: false }).trackOn).toBe(false)
    // 合法值原样过（四档方向 / 四档适配都试一遍同族里「非默认」的那个）
    expect(normalizeWallpaper({ transitionDir: 'up' }).transitionDir).toBe('up')
    expect(normalizeWallpaper({ objectFit: 'contain' }).objectFit).toBe('contain')
  })

  it('子块字段的区间跟着常量走（轮播间隔最小 1 分钟：0 会让它每帧想换）', () => {
    expect(normalizeWallpaper({ rotation: { intervalMin: 0 } }).rotation.intervalMin).toBe(1)
    expect(normalizeWallpaper({ parallax: { smooth: 100 } }).parallax.smooth).toBe(PARALLAX_SMOOTH_MAX)
    expect(normalizeWallpaper({ parallax: { smooth: 99 } }).parallax.smooth).toBe(PARALLAX_SMOOTH_MAX)
    expect(normalizeWallpaper({ parallax: { amount: 99 } }).parallax.amount).toBe(PARALLAX_AMOUNT_MAX)
    expect(normalizeWallpaper({ audio: { gain: 9 } }).audio.gain).toBe(AUDIO_GAIN_MAX)
  })
})

describe('normalizeWallpaper：输出恒为整树新造的普通对象', () => {
  it('返回的不是入参本身，子块也不是入参的子块（引用断开）', () => {
    const raw = { dim: 60, rotation: { enabled: true, intervalMin: 20, order: 'random' } }
    const out = normalizeWallpaper(raw)
    expect(out).not.toBe(raw)
    expect(out.rotation).not.toBe(raw.rotation)
  })

  it('改产物不影响入参（反过来也成立）', () => {
    const raw = { dim: 60, rotation: { intervalMin: 20 } }
    const out = normalizeWallpaper(raw)
    out.rotation.intervalMin = 99
    out.dim = 1
    expect(raw.dim).toBe(60)
    expect(raw.rotation.intervalMin).toBe(20)
  })

  it('幂等：迁过一遍的再迁一遍保持不变（主进程每次读盘都跑迁移）', () => {
    const once = normalizeWallpaper({ dim: 42, audio: { gain: 2.5 }, selectedId: ' x ' })
    expect(normalizeWallpaper(once)).toEqual(once)
  })
})

// ---------------------------------------------------------------- v13 两块新表

/**
 * v13 增块：itemProps（壁纸自带属性的用户覆盖）与 itemTuning（逐张画面微调）。
 *
 * 【守什么】这两块是**用户一点点攒出来的数据**（属性面板里拖过的每根滑块），
 * 净化过头就静默丢用户劳动；放行脏值则会把 2G 机器拖死（工单红线：上限不是
 * 洁癖，是低内存底线，见常量表的注释）。三处口径：
 *   ① itemProps —— 只留三元组、名字/值截长、单张 64 键封顶、空 id/超长 id 丢、
 *      **空表删 id 键**（照 DSH「整张没覆盖 → delete 键」）；
 *   ② itemTuning —— **中性即删**（默认值 = 不生效，存了也是噪音）；
 *      越界值**先钳位再比中性**（opacity 999 → 100、blur -3 → 0 都该删）——
 *      先比后钳的输出不是不动点，幂等会红（tuneNum 的修复注释写了这段）；
 *   ③ 布尔与倍速的极性：flipH 两极性都收（false 是「全局翻开时这张不翻」的
 *      有效覆盖）；flipV 只收 true；playbackRate 只收六档白名单，
 *      **显式 1 是合法覆盖**（全局 1.5 时它让这张保持原速）。
 */

describe('normalizeWallpaper：v13 逐张属性 / 微调两块', () => {
  it('itemProps：三元组留下；对象 / 数组 / null / 非有限数丢；长字符串截长', () => {
    const long = 'x'.repeat(PROP_VALUE_STR_MAX_LEN + 50)
    const w = normalizeWallpaper({
      itemProps: {
        '3284636810': {
          speed: 1,
          label: 'wave',
          toggle: true,
          obj: { a: 1 },
          arr: [1],
          nul: null,
          nan: NaN,
          big: long
        }
      }
    })
    const props = w.itemProps['3284636810']
    expect(props.speed).toBe(1)
    expect(props.label).toBe('wave')
    expect(props.toggle).toBe(true)
    expect('obj' in props).toBe(false)
    expect('arr' in props).toBe(false)
    expect('nul' in props).toBe(false)
    expect('nan' in props).toBe(false)
    expect(props.big).toBe(long.slice(0, PROP_VALUE_STR_MAX_LEN))
  })

  it('itemProps：空 id / 超长 id 丢；空名 / 超长名丢；单张键数封顶', () => {
    const many: Record<string, number> = {}
    for (let i = 0; i < ITEM_PROPS_MAX_KEYS + 10; i++) many[`p${String(i).padStart(3, '0')}`] = i
    const w = normalizeWallpaper({
      itemProps: {
        '': { a: 1 },
        ['z'.repeat(ITEM_ID_MAX_LEN + 1)]: { a: 1 },
        ok: { '': 1, ['n'.repeat(PROP_NAME_MAX_LEN + 1)]: 1, fine: 2 },
        many
      }
    })
    expect('' in w.itemProps).toBe(false)
    expect('z'.repeat(ITEM_ID_MAX_LEN + 1) in w.itemProps).toBe(false)
    expect(w.itemProps.ok).toEqual({ fine: 2 })
    expect(Object.keys(w.itemProps.many).length).toBe(ITEM_PROPS_MAX_KEYS)
  })

  it('itemProps：净化后空表删 id 键；整块脏类型 → 空表（老配置缺省同款）', () => {
    expect(normalizeWallpaper({ itemProps: { a: {}, b: { obj: {} } } }).itemProps).toEqual({})
    expect(normalizeWallpaper({ itemProps: 'x' }).itemProps).toEqual({})
    expect(normalizeWallpaper({ itemProps: [1] }).itemProps).toEqual({})
    expect(normalizeWallpaper({ itemProps: { a: null } }).itemProps).toEqual({})
    expect(normalizeWallpaper({}).itemProps).toEqual({})
  })

  it('itemTuning：中性即删（默认 = 不生效）；浮点两位小数；越界钳回端点落中性也删', () => {
    const w = normalizeWallpaper({
      itemTuning: {
        a: { brightness: 1, contrast: 1.23456, blur: 0, opacity: 100, zoom: 1 },
        b: { opacity: 999, blur: -3 } // 钳回端点恰好都落中性 → 整张空 → 删 id
      }
    })
    expect(w.itemTuning.a).toEqual({ contrast: 1.23 })
    expect('b' in w.itemTuning).toBe(false)
    // 不动点：净化一遍再净化不变 —— 先比中性再钳的写法会把 999/100、-3/0
    // 留到第二遍才删，上面那条 toEqual 与这里的幂等会一起红
    const once = normalizeWallpaper({ itemTuning: { b: { opacity: 999, blur: -3 } } })
    expect(normalizeWallpaper(once)).toEqual(once)
  })

  it('itemTuning：不落中性的越界值钳到端点留下；非有限数丢', () => {
    const w = normalizeWallpaper({
      itemTuning: { a: { brightness: 9, zoom: 0.1, contrast: NaN, blur: 999, opacity: 0 } }
    })
    expect(w.itemTuning.a.brightness).toBe(MEDIA_ADJUST_MAX) // 9 → 1.5（≠1，留）
    expect(w.itemTuning.a.zoom).toBe(ZOOM_MIN) // 0.1 → 0.5（≠1，留）
    expect('contrast' in w.itemTuning.a).toBe(false)
    expect(w.itemTuning.a.blur).toBe(BLUR_MAX) // 999 → 40（≠0，留）
    expect(w.itemTuning.a.opacity).toBe(0) // 0 是合法端值（≠100，留）
    expect(normalizeWallpaper({ itemTuning: { c: { brightness: 0.1, zoom: 9 } } }).itemTuning.c).toEqual({
      brightness: MEDIA_ADJUST_MIN,
      zoom: ZOOM_MAX
    })
  })

  it('itemTuning：flipH 两极性都收（false 是有效覆盖）；flipV 只收严格 true', () => {
    const w = normalizeWallpaper({
      itemTuning: {
        a: { flipH: false },
        b: { flipH: true },
        c: { flipV: true },
        d: { flipV: 1 }, // 1 不是 true → 不成键 → 整张空 → 删 id
        e: { flipV: 'yes' }
      }
    })
    expect(w.itemTuning.a.flipH).toBe(false)
    expect(w.itemTuning.b.flipH).toBe(true)
    expect(w.itemTuning.c.flipV).toBe(true)
    expect('d' in w.itemTuning).toBe(false)
    expect('e' in w.itemTuning).toBe(false)
  })

  it('itemTuning：倍速只收六档白名单；显式 1 是合法覆盖、1.1 丢', () => {
    const w = normalizeWallpaper({
      itemTuning: {
        a: { playbackRate: 1.5 },
        b: { playbackRate: 1.1 },
        c: { playbackRate: 1 },
        d: { playbackRate: '2' }
      }
    })
    expect(w.itemTuning.a.playbackRate).toBe(1.5)
    expect('b' in w.itemTuning).toBe(false)
    expect(w.itemTuning.c.playbackRate).toBe(1) // 与全局默认同值也是覆盖：全局 1.5 时这张保持原速
    expect('d' in w.itemTuning).toBe(false)
  })

  it('两块整树新造：输出与入参不共享引用（写盘的份与来源份断开）', () => {
    const raw = { itemProps: { a: { x: 1 } }, itemTuning: { a: { blur: 5 } } }
    const w = normalizeWallpaper(raw)
    expect(w.itemProps).not.toBe(raw.itemProps)
    expect(w.itemProps.a).not.toBe(raw.itemProps.a)
    expect(w.itemTuning).not.toBe(raw.itemTuning)
    expect(w.itemTuning.a).not.toBe(raw.itemTuning.a)
  })
})

describe('normalizeWallpaper：v14 → v15 的轮播池 rotation.pool', () => {
  it('老配置（rotation 里从没见过 pool）→ []，= 全部参与（与升级前逐字节同行为）', () => {
    const w = normalizeWallpaper({ rotation: { enabled: true, intervalMin: 30, order: 'random' } })
    expect(w.rotation).toEqual({ enabled: true, intervalMin: 30, order: 'random', pool: [] })
    // 连 rotation 整块都没有时也一样（缺省 = 空池 = 全量）
    expect(normalizeWallpaper({}).rotation.pool).toEqual([])
  })

  it('用户勾过的池子原样带过来（保序；工坊数字 id 与 custom: 前缀 id 都能存）', () => {
    const w = normalizeWallpaper({ rotation: { pool: ['3284636810', 'custom:star.png'] } })
    expect(w.rotation.pool).toEqual(['3284636810', 'custom:star.png'])
  })

  it('脏值净化：非数组 → 空；非字符串 / 空串 / 纯空白 丢；trim；保序去重', () => {
    expect(normalizeWallpaper({ rotation: { pool: 'x' } }).rotation.pool).toEqual([])
    expect(normalizeWallpaper({ rotation: { pool: { a: 1 } } }).rotation.pool).toEqual([])
    expect(
      normalizeWallpaper({ rotation: { pool: [42, null, '', '  ', 'a', ' a ', 'b.png'] } }).rotation.pool
    ).toEqual(['a', 'b.png'])
  })

  it('截断到 WALLPAPER_POOL_MAX（无界数组不让它进文件）', () => {
    const big = Array.from({ length: WALLPAPER_POOL_MAX + 50 }, (_, i) => `id${i}`)
    expect(normalizeWallpaper({ rotation: { pool: big } }).rotation.pool.length).toBe(WALLPAPER_POOL_MAX)
  })

  it('输出恒为新数组（写盘那份与来源份不共享引用）', () => {
    const raw = { rotation: { pool: ['a'] } }
    const w = normalizeWallpaper(raw)
    expect(w.rotation.pool).not.toBe(raw.rotation.pool)
    w.rotation.pool.push('x')
    expect(raw.rotation.pool).toEqual(['a'])
  })
})

describe('normalizeWallpaper：v15 → v16 的隐藏表 hidden 与帧率新档', () => {
  it('老配置（从没见过 hidden）→ []，= 一张都没藏（与升级前逐字节同行为）', () => {
    expect(normalizeWallpaper({}).hidden).toEqual([])
    expect(normalizeWallpaper({ hidden: 'x' }).hidden).toEqual([])
    expect(normalizeWallpaper({ hidden: { a: 1 } }).hidden).toEqual([])
  })

  it('隐藏表与 pool 共用同一份净化代数：丢脏、trim、保序去重、截断', () => {
    expect(
      normalizeWallpaper({ hidden: [42, null, '', '  ', 'a', ' a ', 'b.png'] }).hidden
    ).toEqual(['a', 'b.png'])
    const big = Array.from({ length: WALLPAPER_POOL_MAX + 10 }, (_, i) => `id${i}`)
    expect(normalizeWallpaper({ hidden: big }).hidden.length).toBe(WALLPAPER_POOL_MAX)
  })

  it('输出恒为新数组（写盘那份与来源份不共享引用）', () => {
    const raw = { hidden: ['a'] }
    const w = normalizeWallpaper(raw)
    expect(w.hidden).not.toBe(raw.hidden)
    w.hidden.push('x')
    expect(raw.hidden).toEqual(['a'])
  })

  it('★ 场景帧率扩档：120 与「无上限」哨兵（=1000）原样过；白名单外照旧退回默认', () => {
    expect(FPS_UNLIMITED).toBe(1000)
    expect(WALLPAPER_SCENE_FPS).toContain(FPS_UNLIMITED)
    expect(normalizeWallpaper({ sceneFps: 120 }).sceneFps).toBe(120)
    expect(normalizeWallpaper({ sceneFps: FPS_UNLIMITED }).sceneFps).toBe(FPS_UNLIMITED)
    // 阴性对照：扩档不是「放开任意数字」——144 / 999 都是白名单外的普通拒绝
    expect(normalizeWallpaper({ sceneFps: 144 }).sceneFps).toBe(30)
    expect(normalizeWallpaper({ sceneFps: 999 }).sceneFps).toBe(30)
    // 哨兵值不走「越界钳位」那条路（它是合法枚举成员，不是 999 这类越界数字的邻居）
    expect(normalizeWallpaper({ sceneFps: 0 }).sceneFps).toBe(30)
  })
})
