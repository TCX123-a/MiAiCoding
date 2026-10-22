/**
 * 代码填空题的空位契约（src/shared/codefill.ts）
 *
 * 【这个文件在守什么】
 * 「空位」这件事有三处实现：**渲染**（把 `____` 换成 ①②③ 给学员看）、
 * **判分**（把各空拼成的一串拆回来逐个比对）、**内容校验**（数 `____` 的个数
 * 跟 `blanks.length` 对账）。三处里任何一处漂了，症状都是**静默的**：
 *
 *   - 渲染漂了 → 代码里一个 ① 都没有，学员不知道该填哪个空（题面看起来只是"没编号"）
 *   - 拆分漂了 → 各空的答案整体错位一格，学员全填对了却判错
 *   - 校验漂了 → 空位和答案个数对不上的题照样过闸门，那道题**永远答不对**
 *
 * 三条都不会抛异常。所以每一条都在这里钉死，最后一组甚至直接去读
 * 校验器的源码文本，确认它抄的是同一份规则。
 *
 * 【这里的测试名一律中文，是允许的】
 * 原来这儿写着「本文件在 `src/` 下、被文案闸门扫，字符串一律英文」—— **那句是错的**。
 * 闸门（`renderer/src/lib/__tests__/copy.test.ts`）的 `walk()` 明确跳过 `__tests__`
 * 目录（`:99`），测试文件根本不在它的扫描范围里 —— 本文件自己的 `describe`/`it`
 * 就在用中文，正是明证。之所以值得写一句在这里，是因为那句错话会让人为了
 * 一个不存在的约束把测试名翻译成英文：**测试名是写给下一个改代码的人看的**，
 * 而这个人读的是中文。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  blankMark,
  CODE_FILL_MARKER,
  countCodeFillBlanks,
  globalMarker,
  isCodeFill,
  joinCodeFillAnswer,
  numberCodeFillBlanks,
  splitCodeFillAnswer,
  stripNewlines
} from '../codefill'
import { maskComments } from './mask-comments'

// 注意是**三层**：本文件在 `src/shared/__tests__/` 下，而 `scripts/` 在仓库根，
// 不是 `src/` 下（同目录的 ipc-wiring.test.ts 只上两层，因为它读的
// `preload/` `main/` 确实在 src 里）
const root = join(__dirname, '..', '..', '..')

// ---------------------------------------------------------------- 空位标记

describe('CODE_FILL_MARKER：什么算一个空', () => {
  it('连续 4 个下划线算一个空', () => {
    expect(countCodeFillBlanks('int ____ = 0;')).toBe(1)
  })

  it('**3 个下划线不算** —— 它是标识符，不是空位', () => {
    // `___` 在真实代码里到处都是（`__init__`、`_private`）。
    // 门槛放到 3 的话，一道 Python 题会被数出好几个不存在的空。
    expect(countCodeFillBlanks('___')).toBe(0)
    expect(countCodeFillBlanks('__init__')).toBe(0)
  })

  it('超过 4 个也算**一个**空（不是两个）', () => {
    expect(countCodeFillBlanks('____')).toBe(1)
    expect(countCodeFillBlanks('________')).toBe(1)
    expect(countCodeFillBlanks('____________')).toBe(1)
  })

  it('多个空各算各的', () => {
    expect(countCodeFillBlanks('for (____ i = 0; i < ____; i++)')).toBe(2)
  })

  it('空位夹在下划线标识符里也能认出来（前后不要求是空白）', () => {
    expect(countCodeFillBlanks('a____b')).toBe(1)
  })

  it('没有空的代码返回 0，不抛错', () => {
    expect(countCodeFillBlanks('')).toBe(0)
    expect(countCodeFillBlanks('print(1)')).toBe(0)
  })

  it('**CODE_FILL_MARKER 不带 g 标志** —— 带 g 的正则记 lastIndex，共用会时灵时不灵', () => {
    // 这条守的是一个很阴的坑，而且**它就在上面那条断言里现演了一遍**：
    expect(CODE_FILL_MARKER.global).toBe(false)

    // 同一个带 g 的正则对象，连着 test 两次同一个字符串 —— 第二次是 false。
    // 因为第一次匹配完 lastIndex 停在 4（字符串末尾），第二次从那儿往后找，
    // 自然找不到。这是**同一个对象**的状态，不是字符串的问题。
    const shared = globalMarker()
    expect(shared.test('____')).toBe(true)
    expect(shared.test('____')).toBe(false) // ← 就是这个坑
    expect(shared.lastIndex).toBe(0) // 没匹配上时它才被重置

    // 所以 `globalMarker()` 的意义就是"每次现造一个"：各用各的，互不携带状态。
    // 真写成一个模块级常量的话，"连着判两道题"时第二道就会莫名少认一个空 ——
    // 而单测一次只跑一道的话，永远看不见。
    expect(globalMarker()).not.toBe(shared)
    expect(globalMarker().test('____')).toBe(true)
    expect(globalMarker().test('____')).toBe(true)
  })
})

// ---------------------------------------------------------------- 渲染

describe('numberCodeFillBlanks()：给学员看的那一份', () => {
  it('一个空 → ①', () => {
    expect(numberCodeFillBlanks('int ____ = 0;')).toBe('int ① = 0;')
  })

  it('多个空**按出现顺序**编号', () => {
    // 顺序就是下面输入框的顺序 —— 编错了学员会照着填错位置
    expect(numberCodeFillBlanks('for (____ i = 0; i < ____; i++)')).toBe('for (① i = 0; i < ②; i++)')
  })

  it('超过 10 个空时退回 (11) 这种写法，不会变成 undefined', () => {
    expect(blankMark(0)).toBe('①')
    expect(blankMark(9)).toBe('⑩')
    expect(blankMark(10)).toBe('(11)')
    expect(blankMark(99)).toBe('(100)')
  })

  it('没有空的代码原样返回', () => {
    expect(numberCodeFillBlanks('print(1)')).toBe('print(1)')
  })

  it('不改原字符串（模板里两份都要用：一份编号给学员，一份原样存着）', () => {
    const code = 'int ____ = 0;'
    numberCodeFillBlanks(code)
    expect(code).toBe('int ____ = 0;')
  })

  it('**编号个数恒等于空位个数** —— 界面上的 ① 和输入框必须一样多', () => {
    for (const code of ['____', 'a ____ b ____ c', '____ ____ ____ ____ ____ ____ ____ ____ ____ ____ ____']) {
      const marks = numberCodeFillBlanks(code).match(/①|②|③|④|⑤|⑥|⑦|⑧|⑨|⑩|\(\d+\)/g) ?? []
      expect(marks.length).toBe(countCodeFillBlanks(code))
    }
  })
})

// ---------------------------------------------------------------- 拆 / 拼

describe('splitCodeFillAnswer()：一串 → 各输入框', () => {
  it('按换行拆开', () => {
    expect(splitCodeFillAnswer('a\nb\nc', 3)).toEqual(['a', 'b', 'c'])
  })

  it('**不够的补空字符串** —— 学员只填了第一个空时，后面的输入框也得在', () => {
    // 不补的话下面 `v-for` 渲染不出后两个框，学员**没法把题答完**
    expect(splitCodeFillAnswer('a', 3)).toEqual(['a', '', ''])
    expect(splitCodeFillAnswer('', 2)).toEqual(['', ''])
  })

  it('多了的截断（分隔符串进答案里的防御）', () => {
    expect(splitCodeFillAnswer('a\nb\nc\nd', 2)).toEqual(['a', 'b'])
  })

  it('空位数是 0 时给空数组', () => {
    expect(splitCodeFillAnswer('a\nb', 0)).toEqual([])
  })
})

describe('joinCodeFillAnswer()：各输入框 → 一串', () => {
  it('用换行拼起来', () => {
    expect(joinCodeFillAnswer(['a', 'b'])).toBe('a\nb')
  })

  it('**把输入里的换行删掉** —— 留着会让后面所有空整体错位一格', () => {
    // 只可能来自粘贴（多行代码粘进单行输入框）。分隔符就是 \n，
    // 一个空里混进一个换行，后面每个空都会顶掉前一个的位置。
    expect(joinCodeFillAnswer(['a\nb', 'c'])).toBe('ab\nc')
    expect(stripNewlines('a\r\nb')).toBe('ab')
  })

  it('空数组拼出空串', () => {
    expect(joinCodeFillAnswer([])).toBe('')
  })

  it('拼了再拆回来是原样（往返稳定）', () => {
    const vals = ['int', 'for', 'i++']
    expect(splitCodeFillAnswer(joinCodeFillAnswer(vals), 3)).toEqual(vals)
  })
})

describe('isCodeFill()', () => {
  it('认得出 codefill，不认别的题型', () => {
    expect(isCodeFill({ type: 'codefill' })).toBe(true)
    expect(isCodeFill({ type: 'code' })).toBe(false)
    expect(isCodeFill({ type: 'fill' })).toBe(false)
  })
})

// ---------------------------------------------------------------- 校验器对账

describe('内容校验器抄的是同一份空位规则', () => {
  /**
   * 【为什么这条闸门要读源码文本】
   *
   * `scripts/content-validate.mjs` 是一个跑在裸 node 上的零依赖脚本，
   * **没法 import `src/shared/codefill.ts`**（node 不认识 .ts），
   * 所以空位正则只能在那儿**再写一遍**。抄写就会漂：有人觉得 4 个下划线太严、
   * 改成 3 个，渲染那边一个空都换不出来（代码原样显示 `____`），
   * 而校验器还在数 4 个 —— 内容照过闸门，题却是废的。
   *
   * 项目里已经有同样的做法（`ipc-wiring.test.ts` 读 preload 和主进程的源码
   * 比对通道名）。这里比对的不是完整实现，而是**那一个正则的字面量**。
   * 它拦不住"逻辑抄错了"，但能拦住"改了其中一处" —— 而那正是会发生的。
   */
  const validatorSrc = maskComments(readFileSync(join(root, 'scripts', 'content-validate.mjs'), 'utf8'))

  it('校验器里数空位用的正则和 CODE_FILL_MARKER 是同一个', () => {
    expect(validatorSrc).toContain(`/${CODE_FILL_MARKER.source}/g`)
  })

  it('校验器认得出 codefill 题型（白名单没漏登记）', () => {
    // 漏了的话 `codefill` 会掉进最后的 `else`，整批内容报"题型非法"
    expect(validatorSrc).toContain("q.type === 'codefill'")
  })

  it('校验器查了「空位个数 == blanks 个数」这件事', () => {
    // 这条要是被人删了，本文件前面那些断言全都不再有内容侧的保护
    expect(validatorSrc).toMatch(/blanksInCode/)
  })
})
