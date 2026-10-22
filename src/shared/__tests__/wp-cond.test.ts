/**
 * 壁纸属性显隐条件求值器（shared/we-cond.ts，DSH we-cond.js 的 TS 移植）。
 *
 * 【这个文件在守什么】
 *   ① **真实壁纸的 condition 逐字回归**：下面 REAL 表里的表达式全部是
 *      2026-10-05 从本机九张工坊壁纸的 project.json 现抠出来的（corsair_collection
 *      的链式 `effect.value.endsWith('wave') === true`、corsair_o_tron 的
 *      `showbottom.value > 0`、shimmering_particles 的无空格 `style.value=='1'`…）。
 *      最后一条空条件来自 dino_run —— 空串照常恒显示，不许当语法错误处理。
 *   ② **DSH 的宽松相等**：=== / !== / == / != 四个比较符在 DSH 里走同一个
 *      looseEq（值经 project.json → 配置存储 → JSON 往返，"1" 与 1 混用是常态）。
 *      名不副实的 `===` 要钉住 —— 谁哪天「顺手修正」成严格比较，真实壁纸
 *      的显隐会整片错位。
 *   ③ **fail open**：解析不了 / 求值抛错 / 空条件 → 恒显示。这是安全方向：
 *      误判隐藏远比分多显示一项糟糕（文件头的不变量）。下面 FAIL_OPEN 表
 *      逐条钉住「坏输入不许把属性藏起来」。
 *   ④ 差异①的三个方法（endsWith / startsWith / includes）与它的边界：
 *      参数只许字面量、非字符串目标抛错（→ fail open，不静默 false）。
 */

import { describe, expect, it } from 'vitest'
import { weCondParse, weCondTokenize, weEvalCondition } from '../we-cond'
import type { WallpaperPropValue } from '../wallpaper-props'

// ---------------------------------------------------------------- 真实数据

/** [表达式, 值表, 期望] —— 表达式逐字来自本机已装壁纸（见文件头） */
const REAL: Array<[string, Record<string, WallpaperPropValue>, boolean]> = [
  // corsair_collection：逻辑与 + 宽松不等
  ["scene.value !== 'cartoon' && scene.value !== 'ram'", { scene: 'cartoon' }, false],
  ["scene.value !== 'cartoon' && scene.value !== 'ram'", { scene: 'ram' }, false],
  ["scene.value !== 'cartoon' && scene.value !== 'ram'", { scene: 'wave' }, true],
  // corsair_collection：链式 .value.endsWith（差异①的两个真实使用者）
  ["effect.value.endsWith('wave') === true", { effect: 'wave' }, true],
  ["effect.value.endsWith('wave') === true", { effect: 'pulsewave' }, true],
  ["effect.value.endsWith('wave') === true", { effect: 'pulse' }, false],
  ["effect.value === 'visor'", { effect: 'visor' }, true],
  ["effect.value === 'visor'", { effect: 'wave' }, false],
  // 链式 + 第二个属性的组合（pulsesize / pulsescale 是一对互斥项）
  [
    "effect.value.endsWith('pulse') === true && pulseanimation.value === 'static'",
    { effect: 'pulse', pulseanimation: 'static' },
    true
  ],
  [
    "effect.value.endsWith('pulse') === true && pulseanimation.value === 'static'",
    { effect: 'rainbow', pulseanimation: 'static' },
    false
  ],
  [
    "effect.value.endsWith('pulse') === true && pulseanimation.value !== 'static'",
    { effect: 'pulse', pulseanimation: 'rainbow' },
    true
  ],
  // spiralposition / spiralpositionram：同族三项在三组场景下各亮一个
  [
    "effect.value.endsWith('spiral') === true && scene.value !== 'ram'",
    { effect: 'spiral', scene: 'wave' },
    true
  ],
  ["effect.value.endsWith('spiral') === true && scene.value === 'ram'", { effect: 'spiral', scene: 'ram' }, true],
  // startsWith === false（两个颜色项共用）
  ["effect.value.startsWith('rainbow') === false", { effect: 'rainbowwave' }, false],
  ["effect.value.startsWith('rainbow') === false", { effect: 'wave' }, true],
  // corsair_o_tron：整条 expr 就是 .value 的布尔性 / 数值比较
  ['rainbowscheme.value', { rainbowscheme: 'rainbow' }, true],
  ['rainbowscheme.value', { rainbowscheme: '' }, false],
  ['rainbowscheme.value', {}, false],
  ['showbottom.value > 0', { showbottom: 1 }, true],
  ['showbottom.value > 0', { showbottom: 0 }, false],
  ['showbottom.value > 0', { showbottom: '2' }, true], // 宽松数值比较
  // shimmering_particles：无空格写法照样过词法
  ["style.value=='1'", { style: 1 }, true],
  ["style.value=='1'", { style: '1' }, true],
  ["style.value=='1'", { style: 2 }, false],
  // dino_run：空条件 = 恒显示（不是错误）
  ['', {}, true],
  ['   ', {}, true]
]

describe('真实壁纸 condition 逐字回归（本机九张现抠）', () => {
  it.each(REAL)('「%s」配 %o → %s', (expr, values, want) => {
    expect(weEvalCondition(expr, values)).toBe(want)
  })
})

// ---------------------------------------------------------------- 运算符语义

describe('比较与逻辑运算符（DSH 语义，不许「顺手修正」）', () => {
  it('四个比较符共用宽松相等：=== 名不副实，但这就是 DSH 口径', () => {
    // 值经 JSON 往返，"1" 与 1 混用是常态 —— 严格比较会让真实壁纸整片错位
    expect(weEvalCondition("a.value === 1", { a: '1' })).toBe(true)
    expect(weEvalCondition("a.value !== 1", { a: '1' })).toBe(false)
    expect(weEvalCondition('a.value == 1', { a: '1' })).toBe(true)
    expect(weEvalCondition("flag.value == 1", { flag: true })).toBe(true) // true ↔ 1 也是它
    expect(weEvalCondition("a.value === 'x'", { a: 'x' })).toBe(true)
    expect(weEvalCondition('a.value === 1', { a: 2 })).toBe(false)
  })

  it('缺少的属性（undefined）与自身宽松相等；数值比较遇 NaN 恒 false', () => {
    expect(weEvalCondition('a.value === b.value', {})).toBe(true) // 两边都 undefined
    expect(weEvalCondition("a.value > 0", { a: 'x' })).toBe(false) // Number('x') = NaN
    expect(weEvalCondition('a.value <= 0', {})).toBe(false)
  })

  it('&& 比 || 紧；括号改结合（与 JS 同序）', () => {
    const v = { a: 0, b: 2, c: 3 }
    expect(weEvalCondition('a.value === 1 || b.value === 2 && c.value === 3', v)).toBe(true)
    expect(weEvalCondition('a.value === 1 || b.value === 2 && c.value === 9', v)).toBe(false)
    expect(weEvalCondition('(a.value === 1 || b.value === 2) && c.value === 9', v)).toBe(false)
    expect(weEvalCondition('(a.value === 1 || b.value === 2) && c.value === 3', v)).toBe(true)
  })

  it('一元 ! 与负号；数字/真假字面量', () => {
    expect(weEvalCondition('!true', {})).toBe(false)
    expect(weEvalCondition('!a.value', { a: false })).toBe(true)
    expect(weEvalCondition('!(a.value === 1)', { a: 2 })).toBe(true)
    expect(weEvalCondition('a.value > -1', { a: 0 })).toBe(true)
    expect(weEvalCondition('a.value > 0.5', { a: 0.75 })).toBe(true)
    expect(weEvalCondition('a.value === false', { a: false })).toBe(true)
  })
})

// ---------------------------------------------------------------- fail open

/** [表达式, 值表] —— 期望一律 **true**（失败即显示） */
const FAIL_OPEN: Array<[string, Record<string, WallpaperPropValue>]> = [
  ['foo.text === 1', { foo: 'x' }], // 只认 .value/方法，别的成员访问抛错
  ['a = 5', { a: 5 }], // 赋值语句（单 =）词法就过不去
  ['a.value ? 1 : 2', { a: 1 }], // 三元：? 不是合法字符
  ['@@@', {}],
  ['a.value b.value', { a: 1, b: 1 }], // trailing tokens
  ['(a.value === 1', { a: 1 }], // 括号没闭合
  ["a.value === 'x", { a: 'x' }], // 字符串没闭合
  ['a.value.endsWith(b.value)', { a: 'xx', b: 'x' }], // 方法参数只许字面量
  ['a.value.unknownMethod(1)', { a: 'xx' }], // 方法白名单之外
  ['a.value.', { a: 'xx' }]
]

describe('fail open：坏输入恒显示（绝不静默把属性藏起来）', () => {
  it.each(FAIL_OPEN)('「%s」→ true', (expr, values) => {
    expect(weEvalCondition(expr, values)).toBe(true)
  })

  it('null / undefined / 非字符串 / 空白 → true（脏输入当「没有条件」，0 也不许变隐藏）', () => {
    expect(weEvalCondition(null, {})).toBe(true)
    expect(weEvalCondition(undefined, {})).toBe(true)
    expect(weEvalCondition(0, {})).toBe(true) // 曾经的漏点：'0' 被解析成假 → 隐藏
    expect(weEvalCondition(42, {})).toBe(true)
    expect(weEvalCondition(false, {})).toBe(true)
    expect(weEvalCondition('  ', {})).toBe(true)
  })

  it('方法目标不是字符串 → 抛错 → fail open（不静默 false 隐藏）', () => {
    // 这是「安全方向」的判据：effect 是数字时，条件判不了对错 —— 显示
    expect(weEvalCondition("effect.value.endsWith('wave')", { effect: 42 })).toBe(true)
    expect(weEvalCondition("effect.value.includes('a')", {})).toBe(true)
  })
})

// ---------------------------------------------------------------- 方法白名单

describe('差异①的三个方法：endsWith / startsWith / includes', () => {
  it('三个方法各自的真/假与数字参数（按字符串比）', () => {
    expect(weEvalCondition("a.value.endsWith('xy')", { a: 'wxy' })).toBe(true)
    expect(weEvalCondition("a.value.endsWith('xy')", { a: 'xyw' })).toBe(false)
    expect(weEvalCondition("a.value.startsWith('w')", { a: 'wxy' })).toBe(true)
    expect(weEvalCondition("a.value.startsWith('x')", { a: 'wxy' })).toBe(false)
    expect(weEvalCondition("a.value.includes('x')", { a: 'wxy' })).toBe(true)
    expect(weEvalCondition("a.value.includes('z')", { a: 'wxy' })).toBe(false)
    expect(weEvalCondition('a.value.endsWith(1)', { a: 'a1' })).toBe(true) // 数字参数按字符串
  })

  it('方法后仍可接比较符（链式完整走通：ident.value.method(字面量) === true）', () => {
    expect(weEvalCondition("a.value.endsWith('x') === true", { a: 'ax' })).toBe(true)
    expect(weEvalCondition("a.value.endsWith('x') === false", { a: 'ax' })).toBe(false)
    // 纯 ident.value 不许再挂方法（.value.value 之类）→ fail open
    expect(weEvalCondition("a.value.value === 1", { a: 'x' })).toBe(true)
  })
})

// ---------------------------------------------------------------- 编译产物

describe('词法/编译（weCondTokenize / weCondParse 直接可测的纯计算）', () => {
  it('双引号字符串、小数、$ 与 _ 开头的属性名', () => {
    expect(weEvalCondition('a.value === "x"', { a: 'x' })).toBe(true)
    expect(weEvalCondition('a.value === 1.5', { a: 1.5 })).toBe(true)
    expect(weEvalCondition('_a.value === 1', { _a: 1 })).toBe(true)
    expect(weEvalCondition('$a.value === 1', { $a: 1 })).toBe(true)
  })

  it('编译结果是一个可复用的纯闭包：同一表达式对多组值各算各的', () => {
    const fn = weCondParse(weCondTokenize("scene.value !== 'ram'"))
    expect(fn({ scene: 'ram' })).toBe(false)
    expect(fn({ scene: 'wave' })).toBe(true)
    expect(fn({})).toBe(true) // undefined !== 'ram' → true
  })

  it('tokenize 对坏字符抛错（外层 fail open 的触发点）', () => {
    expect(() => weCondTokenize('a ? b')).toThrow()
    expect(() => weCondTokenize("a === 'unterminated")).toThrow()
  })
})
