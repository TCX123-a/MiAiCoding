/**
 * 壁纸 UI 通透度的净化逻辑（src/shared/wall-ui.ts）
 *
 * 【这个文件在守什么】
 * 守的是**两个滑杆的下限为什么是安全的**。它坏掉的方式全是静默的：
 *
 *   1. **NaN 落进存储**。它能穿过 `Math.min(Math.max(...))`（和谁比都是 false），
 *      之后 `--mi-panel-alpha: NaN%` 让消费它的 color-mix 在用值时刻失效（IACVT）——
 *      该声明按 unset 走、background 取初值 transparent：面板**全透**、正文压在
 *      veil/壁纸上，读性崩坏，而界面一个错都不报（2026-10-04 复核修正了这里
 *      原先写反的失败方向；同 layout clampSize / wallpaper clampNum 的坑）。
 *   2. **默认值被无声改掉**。浅色 40 是主人亲口点的（「比如 40%」），
 *      深色 65 是按对比度预算解出来的 —— 探针 J 若复核不达标会按 +5 调整，
 *      所以这里钉的是**区间**（浅色 [40,50]）而不是一个字面量：
 *      往下掉回全实色（比如 100）必须红，往上最多让到 50。
 *   3. **深浅两个主题串了**。存的形状是 { light, dark } 两套，
 *      归一时把一套写进另一套，表现是「夜里调的透明度，白天跟着变了」。
 */

import { describe, expect, it } from 'vitest'
import {
  materialFadeOf,
  normalizeWallUi,
  WALL_MATERIAL_FADE_KNEE,
  WALL_PANEL_ALPHA_MAX,
  WALL_PANEL_ALPHA_MIN,
  WALL_UI_DEFAULTS,
  WALL_VEIL_MAX,
  WALL_VEIL_MIN,
  wallUiOf
} from '../wall-ui'

describe('normalizeWallUi：垃圾输入一律回默认，不抛错', () => {
  it.each([
    ['整份是 undefined', undefined],
    ['null', null],
    ['字符串', 'wall-ui'],
    ['数字', 42],
    ['数组', []],
    ['true', true]
  ])('%s → 出厂默认', (_name, junk) => {
    expect(() => normalizeWallUi(junk)).not.toThrow()
    expect(normalizeWallUi(junk)).toEqual(WALL_UI_DEFAULTS)
  })

  it('只缺一半、或子对象是垃圾 → 缺的补、其余不动', () => {
    expect(normalizeWallUi({ light: { panelAlpha: 30 } }).light).toEqual({
      panelAlpha: 30,
      veil: WALL_UI_DEFAULTS.light.veil,
      panelColor: null
    })
    expect(normalizeWallUi({ light: 'junk', dark: null })).toEqual(WALL_UI_DEFAULTS)
  })
})

describe('钳位：先判有限数再钳（NaN 不许穿过去）', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['字符串', '40'],
    ['null', null],
    ['缺字段', undefined]
  ])('panelAlpha 是 %s → 退回默认（不是钳到边界）', (_name, junk) => {
    // 「NaN 钳到 min」这个写法（Math.min(Math.max(...))）恒得到 NaN —— 那正是要防的。
    expect(normalizeWallUi({ light: { panelAlpha: junk } }).light.panelAlpha).toBe(
      WALL_UI_DEFAULTS.light.panelAlpha
    )
  })

  it.each([
    ['比上限大', 999, WALL_PANEL_ALPHA_MAX],
    ['比下限小', -5, WALL_PANEL_ALPHA_MIN],
    ['刚好下限', WALL_PANEL_ALPHA_MIN, WALL_PANEL_ALPHA_MIN],
    ['刚好上限', WALL_PANEL_ALPHA_MAX, WALL_PANEL_ALPHA_MAX]
  ])('panelAlpha %s → 钳到 %s', (_name, input, want) => {
    expect(normalizeWallUi({ light: { panelAlpha: input } }).light.panelAlpha).toBe(want)
  })

  it('veil 走同一道钳位（不是只防了 panelAlpha）', () => {
    expect(normalizeWallUi({ dark: { veil: 999 } }).dark.veil).toBe(WALL_VEIL_MAX)
    expect(normalizeWallUi({ dark: { veil: -1 } }).dark.veil).toBe(WALL_VEIL_MIN)
    expect(normalizeWallUi({ dark: { veil: Number.NaN } }).dark.veil).toBe(WALL_UI_DEFAULTS.dark.veil)
  })

  it('小数四舍五入到整数（滑杆是整数步进，存储里不该出现 39.999999）', () => {
    expect(normalizeWallUi({ light: { panelAlpha: 39.6 } }).light.panelAlpha).toBe(40)
    expect(normalizeWallUi({ light: { veil: 69.4 } }).light.veil).toBe(69)
  })
})

describe('两个主题各记各的，不串', () => {
  it('只改浅色那份 → 深色一个字不动（反之亦然）', () => {
    const ui = normalizeWallUi({ light: { panelAlpha: 12, veil: 34 }, dark: { panelAlpha: 56, veil: 78 } })
    expect(ui.light).toEqual({ panelAlpha: 12, veil: 34, panelColor: null })
    expect(ui.dark).toEqual({ panelAlpha: 56, veil: 78, panelColor: null })
  })

  it('只给一个主题 → 另一个主题拿默认', () => {
    const ui = normalizeWallUi({ light: { panelAlpha: 5 } })
    expect(ui.light.panelAlpha).toBe(5)
    expect(ui.dark).toEqual(WALL_UI_DEFAULTS.dark)
  })
})

/*
 * 面板底色覆盖（2026-10-07 个性化）：净化只放行严格 6 位 hex。
 *
 * 【为什么「像颜色」不算数】这个值会原样进 setProperty('--mi-card', ...)；
 * 浏览器认不出的字符串会让那条声明在用值时刻失效（IACVT），面板底退回初值 ——
 * 不报错、不警告。所以判据是「形态一眼可验」而不是「尽力理解用户意图」：
 * 命名色、rgb()、缩写通通当没写（null = 不覆盖，回到主题自带色）。
 */
describe('panelColor：严格 6 位 hex，非法一律 null（不覆盖）', () => {
  it.each([
    ['命名色', 'red'],
    ['位数不够', '#12345'],
    ['位数多了', '#1234567'],
    ['非 hex 字符', '#gggggg'],
    ['rgb() 写法', 'rgb(1, 2, 3)'],
    ['缺 # 号', 'a1b2c3'],
    ['数字', 0x112233],
    ['空串', ''],
    ['带空白', ' #a1b2c3 '],
    ['null', null],
    ['缺字段', undefined]
  ])('%s → null（回主题自带色）', (_name, junk) => {
    expect(normalizeWallUi({ light: { panelColor: junk } }).light.panelColor).toBeNull()
  })

  it('大写归一化成小写（存储里永远只有一种形态 #rrggbb）', () => {
    expect(normalizeWallUi({ light: { panelColor: '#A1B2C3' } }).light.panelColor).toBe('#a1b2c3')
  })

  it('合法值原样保留（小写 hex 不做任何多余变换）', () => {
    expect(normalizeWallUi({ dark: { panelColor: '#19202a' } }).dark.panelColor).toBe('#19202a')
  })

  it('两主题各记各的：只给浅色 → 深色仍是 null', () => {
    const ui = normalizeWallUi({ light: { panelColor: '#123abc' } })
    expect(ui.light.panelColor).toBe('#123abc')
    expect(ui.dark.panelColor).toBeNull()
  })

  it('出厂默认两个主题都不覆盖（null）—— 覆盖是用户自选动作', () => {
    expect(WALL_UI_DEFAULTS.light.panelColor).toBeNull()
    expect(WALL_UI_DEFAULTS.dark.panelColor).toBeNull()
  })
})

describe('默认值：主人口径 + 对比度预算', () => {
  it('**浅色默认面板不透明度钉在 [40, 50]** —— 主人点的「40% 级别」', () => {
    // 区间而不是字面量：探针 J 用真实画面复核对比度不达标时按 +5 微调，
    // 那是允许的；但掉回全实色（100）或低到看不见壁纸（<40）都必须红。
    expect(WALL_UI_DEFAULTS.light.panelAlpha).toBeGreaterThanOrEqual(40)
    expect(WALL_UI_DEFAULTS.light.panelAlpha).toBeLessThanOrEqual(50)
  })

  it('**浅色 veil 默认 ≥ 75** —— 标题直接压在遮罩上的对比度下限（J 实测解出）', () => {
    // 课文标题（.lesson-page .lesson-title）在卡片之外、直接压在 veil 上；
    // 纯黑视频像素下 veil 70 时标题合成对比度只有 4.03:1（J 实测，不及格），
    // 75 时 4.64:1。反解不等式得 veil ≥ 74。这里钉 75 为下限的意思不是
    // 「75 是魔法数字」：画布色/标题色一变就要重算这条 —— 但**往下掉**必须红。
    expect(WALL_UI_DEFAULTS.light.veil).toBeGreaterThanOrEqual(75)
  })

  it('深色默认比浅色更实 —— 深底上的字要靠更厚的面板保住 4.5:1', () => {
    expect(WALL_UI_DEFAULTS.dark.panelAlpha).toBeGreaterThan(WALL_UI_DEFAULTS.light.panelAlpha)
  })

  it('两个默认值都在合法区间里，且都不是「等于没开壁纸」的 100', () => {
    for (const t of [WALL_UI_DEFAULTS.light, WALL_UI_DEFAULTS.dark]) {
      expect(t.panelAlpha).toBeGreaterThanOrEqual(WALL_PANEL_ALPHA_MIN)
      expect(t.panelAlpha).toBeLessThan(WALL_PANEL_ALPHA_MAX)
      expect(t.veil).toBeGreaterThanOrEqual(WALL_VEIL_MIN)
      expect(t.veil).toBeLessThanOrEqual(WALL_VEIL_MAX)
    }
  })
})

describe('整树新造：不与来源共享子对象', () => {
  it('改归一化结果，来源不受影响；两次归一化互不牵连', () => {
    const src = { light: { panelAlpha: 20, veil: 30 }, dark: { panelAlpha: 40, veil: 50 } }
    const a = normalizeWallUi(src)
    const b = normalizeWallUi(src)
    a.light.panelAlpha = 99
    expect(src.light.panelAlpha).toBe(20)
    expect(b.light.panelAlpha).toBe(20)
  })

  it('返回的不是 WALL_UI_DEFAULTS 本身（改结果不能污染全局默认）', () => {
    const a = normalizeWallUi(undefined)
    expect(a).not.toBe(WALL_UI_DEFAULTS)
    a.light.panelAlpha = 7
    expect(WALL_UI_DEFAULTS.light.panelAlpha).not.toBe(7)
  })
})

describe('wallUiOf：取主题那一份', () => {
  it('light / dark 各自取对', () => {
    const ui = normalizeWallUi({ light: { panelAlpha: 11 }, dark: { panelAlpha: 22 } })
    expect(wallUiOf(ui, 'light').panelAlpha).toBe(11)
    expect(wallUiOf(ui, 'dark').panelAlpha).toBe(22)
  })

  it('主题名不认识 → 给浅色那份（同 windowBgOf 的退让方向），不炸', () => {
    const ui = normalizeWallUi(undefined)
    expect(wallUiOf(ui, 'neon' as never)).toEqual(WALL_UI_DEFAULTS.light)
  })
})

/*
 * V2-30（2026-10-16）：材料（棱 + 厚度）的淡出系数。
 * 它守两条互相拉扯的承诺：
 *   ① 「出厂观感一个字不变」—— 拐点必须 ≤ 两个出厂默认值（否则默认档
 *      就落进淡出区，老用户某次更新后发现棱浅了，而没有任何设置被改过）；
 *   ② 「用户拖到 0 = 真·全隐藏」（主人口径）—— 0 必须映射到 0，
 *      淡出不许是钳位（钳到某个下限就不是全隐了）。
 */
describe('materialFadeOf：alpha → 材料保留系数', () => {
  it('出厂默认（浅 40 / 深 65）与拐点本身都是满材料 1 —— 默认观感逐字节不变', () => {
    expect(materialFadeOf(WALL_UI_DEFAULTS.light.panelAlpha)).toBe(1)
    expect(materialFadeOf(WALL_UI_DEFAULTS.dark.panelAlpha)).toBe(1)
    expect(materialFadeOf(WALL_MATERIAL_FADE_KNEE)).toBe(1)
    expect(materialFadeOf(WALL_PANEL_ALPHA_MAX)).toBe(1)
  })

  it('拐点必须 ≤ 两个出厂默认值 —— 抬到默认之上就破坏上面的承诺', () => {
    // 这条是「出厂观感不变」的机械保证：谁把拐点往上抬过 40，
    // 浅色默认档当场落进淡出区，这条先红。
    expect(WALL_MATERIAL_FADE_KNEE).toBeLessThanOrEqual(WALL_UI_DEFAULTS.light.panelAlpha)
    expect(WALL_MATERIAL_FADE_KNEE).toBeLessThanOrEqual(WALL_UI_DEFAULTS.dark.panelAlpha)
  })

  it('alpha = 0 → 系数 0（真·全隐藏，主人的口径：拖到 0 就是为了全隐藏）', () => {
    expect(materialFadeOf(0)).toBe(0)
  })

  it('拐点以下是线性淡出（中点 = 0.5），且永远不越过 [0,1]', () => {
    expect(materialFadeOf(WALL_MATERIAL_FADE_KNEE / 2)).toBe(0.5)
    expect(materialFadeOf(-5)).toBe(0)
    expect(materialFadeOf(200)).toBe(1)
  })

  it('单调不降：扫一遍 0..100，系数一步步升、没有回头', () => {
    let prev = -1
    for (let a = WALL_PANEL_ALPHA_MIN; a <= WALL_PANEL_ALPHA_MAX; a++) {
      const f = materialFadeOf(a)
      expect(f).toBeGreaterThanOrEqual(prev)
      prev = f
    }
    expect(prev).toBe(1)
  })

  it('非有限数 → 满材料（与 clampPercent 的无效回退方向一致，不成新裂缝）', () => {
    // panelAlpha 是坏值时，面板本身会回落到出厂默认（满材料区）——
    // 材料若在这时变 0，就会造出「底是默认的、棱却没了」的静默怪相。
    expect(materialFadeOf(Number.NaN)).toBe(1)
    expect(materialFadeOf(Number.POSITIVE_INFINITY)).toBe(1)
  })
})
