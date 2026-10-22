import { describe, expect, it } from 'vitest'
import { LANG_OF_CODE, type IdeCandidate, type LangOfCode } from '../types'
import {
  IDE_EXE_NAMES,
  IDE_PRODUCTS,
  IDE_PRIORITY,
  UNIVERSAL_IDE_PRODUCTS,
  defaultEncodingOf,
  encodingOfProduct,
  ideNameOf,
  isSuitable,
  orderCandidates,
  rankOf
} from '../ide-profiles'

/**
 * IDE 画像表的闸门（2026-10-01，config v9）。
 *
 * 这张表是三处的共同真源：主进程写盘定编码、配置迁移分发旧值、渲染进程
 * 按语言推荐。它坏了**不会报错**，只会让某门语言在某个程序里静默乱码 ——
 * 所以不变式都用遍历式断言钉住，将来加产品/加语言时漏改一处就会在这里红。
 */

describe('表内不变式', () => {
  it('每个 exe 名都指向画像表里认得的产品', () => {
    // 漏一个的后果：检测能认出来、编码却认不出 → 静默回退按语言旧规则，
    // 恰是这次要修的乱码。这条断言把「加 exe 忘了加画像」变成一进 CI 就红。
    for (const [exe, product] of Object.entries(IDE_EXE_NAMES)) {
      expect(IDE_PRODUCTS[product], `exe「${exe}」指向了画像表里没有的产品「${product}」`).toBeDefined()
    }
  })

  it('画像的 langs 与优先表逐格一致（产品语 × 语言集）', () => {
    // 同一件事的两份写法的必须同步：profile.langs 说「这个产品适合哪些语言」，
    // isSuitable 说同一句话的另一半。两份不一致的坏法很隐蔽 ——
    // 推荐能选中它（在优先表里），编码却把它当"不认得"（langs 里没有），
    // 或者反过来。逐格对一遍，哪边漏写都报出具体格子。
    for (const product of Object.keys(IDE_PRODUCTS)) {
      for (const lang of LANG_OF_CODE) {
        const inLangs = IDE_PRODUCTS[product].langs.includes(lang)
        expect(
          isSuitable(product, lang),
          `「${product}」×「${lang}」：画像说 ${inLangs ? '适合' : '不适合'}，优先表说 ${!inLangs ? '适合' : '不适合'}`
        ).toBe(inLangs)
      }
    }
  })

  it('优先表里不出现画像表不认识的产品（防手滑拼错）', () => {
    for (const lang of LANG_OF_CODE) {
      expect(IDE_PRIORITY[lang].length, `${lang} 的优先表不能是空的`).toBeGreaterThan(0)
      for (const product of IDE_PRIORITY[lang]) {
        expect(IDE_PRODUCTS[product], `优先表（${lang}）里的「${product}」画像表里没有`).toBeDefined()
      }
    }
  })

  it('c 与 cpp 的优先序一致（两门语言共用一个生态）', () => {
    expect(IDE_PRIORITY.cpp).toEqual(IDE_PRIORITY.c)
  })

  it('通用编辑器在画像里真的能开全部四门', () => {
    for (const product of UNIVERSAL_IDE_PRODUCTS) {
      expect(IDE_PRODUCTS[product], `通用编辑器「${product}」画像表里没有`).toBeDefined()
      expect([...IDE_PRODUCTS[product].langs].sort()).toEqual([...LANG_OF_CODE].sort())
    }
  })

  it('★ 主人验收的那一对：C 语言里 Dev-C++ 必须排在 VS Code 前面', () => {
    // 反过来的话，「自动检测」在装着两者的机器上会推 VS Code ——
    // 主人实测它配 C 正常（那台机器上），但拍板口径是「按语言推荐相应编译器」，
    // 专用工具优先。改成通用了这道闸门会当场红。
    expect(rankOf('c', 'Dev-C++')).toBeLessThan(rankOf('c', 'Visual Studio Code'))
    expect(rankOf('cpp', 'Dev-C++')).toBeLessThan(rankOf('cpp', 'Visual Studio Code'))
  })
})

describe('ideNameOf：路径 → 产品名', () => {
  it('大小写不敏感、两种斜杠都认', () => {
    expect(ideNameOf('D:\\Program Files (x86)\\Dev-Cpp\\DevCpp.exe')).toBe('Dev-C++')
    expect(ideNameOf('C:/tools/vscode/Code.EXE')).toBe('Visual Studio Code')
    expect(ideNameOf('Code.exe')).toBe('Visual Studio Code')
  })

  it('认不出 → undefined（不是空串、不是抛错）', () => {
    expect(ideNameOf('D:\\tools\\notepad++.exe')).toBeUndefined()
    expect(ideNameOf('')).toBeUndefined()
  })
})

describe('rankOf / isSuitable', () => {
  it('认不出的产品是 Infinity，不是 0（排到最后而不是最前）', () => {
    expect(rankOf('c', 'Notepad++')).toBe(Number.POSITIVE_INFINITY)
    expect(isSuitable('Notepad++', 'c')).toBe(false)
  })

  it('Infinity 参与的排序不把未知产品顶到榜首', () => {
    // min(0, Infinity) 之类"顺手取最小"的写法一旦把 Infinity 当 0 用，
    // 未知产品会冒充榜首。这里用真实排序结果钉住方向。
    const cands: IdeCandidate[] = [
      { name: 'Notepad++', path: 'n.exe', source: 'registry' },
      { name: 'Dev-C++', path: 'd.exe', source: 'known' }
    ]
    const { suitable, others } = orderCandidates('c', cands)
    expect(suitable.map((c) => c.name)).toEqual(['Dev-C++'])
    expect(others.map((c) => c.name)).toEqual(['Notepad++'])
  })
})

describe('orderCandidates', () => {
  const devcpp: IdeCandidate = { name: 'Dev-C++', path: 'D:\\devcpp.exe', source: 'known' }
  const vscode: IdeCandidate = { name: 'Visual Studio Code', path: 'D:\\Code.exe', source: 'shortcut' }
  const devcpp2: IdeCandidate = { name: 'Dev-C++', path: 'E:\\DevCpp\\devcpp.exe', source: 'registry' }
  const notepad: IdeCandidate = { name: 'Notepad++', path: 'D:\\npp.exe', source: 'registry' }

  it('合适的按推荐序在前，其余保原序在后', () => {
    const { suitable, others } = orderCandidates('c', [notepad, vscode, devcpp])
    expect(suitable.map((c) => c.path)).toEqual([devcpp.path, vscode.path])
    expect(others.map((c) => c.path)).toEqual([notepad.path])
  })

  it('同一产品装了两份：稳定排序保住探测原序（「平手」判定的前提）', () => {
    const { suitable } = orderCandidates('c', [devcpp2, devcpp])
    expect(suitable.map((c) => c.path)).toEqual([devcpp2.path, devcpp.path])
  })

  it('一个合适的都没有：suitable 空、others 原样', () => {
    const { suitable, others } = orderCandidates('java', [notepad])
    expect(suitable).toEqual([])
    expect(others.map((c) => c.path)).toEqual([notepad.path])
  })
})

describe('编码', () => {
  it('按产品取编码：两个方向都钉（不然「统一成 utf8」这种简化不会有人发现）', () => {
    expect(encodingOfProduct('Dev-C++')).toBe('gbk')
    expect(encodingOfProduct('Visual Studio Code')).toBe('utf8')
    expect(encodingOfProduct('Eclipse')).toBe('gbk')
    expect(encodingOfProduct('PyCharm')).toBe('utf8')
  })

  it('认不出的产品 → undefined，由调用方走回退', () => {
    expect(encodingOfProduct('Notepad++')).toBeUndefined()
    expect(encodingOfProduct(undefined)).toBeUndefined()
  })

  it('回退编码 = v9 之前的按语言规则（c/cpp→gbk，其余 utf8）', () => {
    // 这条回退是「不比升级前差」的承诺所在：路径白名单外/还没配程序时
    // 行为必须和 v8 逐字节一致。
    expect(defaultEncodingOf('c')).toBe('gbk')
    expect(defaultEncodingOf('cpp')).toBe('gbk')
    expect(defaultEncodingOf('java')).toBe('utf8')
    expect(defaultEncodingOf('python')).toBe('utf8')
  })

  it('画像的 encoding 取值只能是 gbk / utf8 两个之一', () => {
    // 只守取值合法。**不**要求「每门语言的推荐里必须两种编码都有」——
    // java/python 的推荐全是 utf8 项是正常事（Eclipse 是 java 唯一的 gbk 项，
    // 机器上装不装随缘），那种"对称美"的要求会把事实写错。
    for (const [product, profile] of Object.entries(IDE_PRODUCTS)) {
      expect(['gbk', 'utf8'], `「${product}」的编码字段`).toContain(profile.encoding)
    }
  })
})

describe('画像的 langs 都是合法语言', () => {
  it('拼错的 LangOfCode 类型层会被拦，这里对运行时值兜底', () => {
    for (const [product, profile] of Object.entries(IDE_PRODUCTS)) {
      for (const lang of profile.langs) {
        expect(LANG_OF_CODE, `「${product}」写了非法语言「${lang}」`).toContain(lang as LangOfCode)
      }
    }
  })
})
