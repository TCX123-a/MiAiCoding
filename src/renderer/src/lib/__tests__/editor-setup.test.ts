import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { LANG_DISPLAY } from '../../../../shared/copy'
import type { LangOfCode } from '../../../../shared/types'
import {
  EDITOR_LANGS,
  MI_TOKEN_COLORS,
  baseEditorExtensions,
  languageExtension,
  miEditorTheme,
  miEditorThemeSpec,
  miHighlightStyle,
  minimalChange,
  shouldRestoreFocus
} from '../editor-setup'

/**
 * T2 配套闸门：让「编辑器的语法和配色配对了」这件事能被机器验证。
 *
 * 为什么值得写：配错语言**不会报错**。把 Java 映射成 Python，
 * 表现只是「颜色有点怪」——一个零基础用户根本看不出哪里不对，
 * 只会觉得「这个编辑器好像坏了」。这类静默错误只能靠机器抓。
 *
 * 本文件跑在纯 node 环境（无 DOM），所以测的是**配置层**：
 * 语法树解析和主题样式表都能脱离浏览器构造，只有 `EditorView` 挂载不行
 * （那部分在 CodeEditor.vue 里，属手工验收范围）。
 */

/** 遍历主题样式表，收集所有字符串值 */
function collectValues(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) collectValues(x, out)
  return out
}

/** 取一段代码的语法树节点名集合 */
function nodeNamesOf(doc: string, lang: LangOfCode): Set<string> {
  const state = EditorState.create({ doc, extensions: [languageExtension(lang)] })
  const tree = ensureSyntaxTree(state, state.doc.length, 5000) ?? syntaxTree(state)
  const names = new Set<string>()
  tree.iterate({ enter: (n) => void names.add(n.name) })
  return names
}

describe('语言映射', () => {
  it('每种代码语言都配了语法（往 LangOfCode 加新语言时会在这里报出来）', () => {
    const fromTypes = (Object.keys(LANG_DISPLAY) as (keyof typeof LANG_DISPLAY)[])
      .filter((k) => k !== 'common')
      .sort()
    expect([...EDITOR_LANGS].sort()).toEqual(fromTypes)
  })

  it('每种语言解析同一段代码，得到的是各自的语法树', () => {
    // 挑 `# hello` 这句是故意的：同一个井号，
    // C/C++ 读作预处理指令、Python 读作注释、Java 读作语法错误——
    // 三种语言给出三个截然不同的答案，谁也冒充不了谁。
    const doc = 'x = 1  # hello\n'

    const c = nodeNamesOf(doc, 'c')
    const cpp = nodeNamesOf(doc, 'cpp')
    const java = nodeNamesOf(doc, 'java')
    const python = nodeNamesOf(doc, 'python')

    // C 走的是 C++ 语法包（没有独立的 C 包，C 是 C++ 子集），两者必须一致
    expect(c).toEqual(cpp)
    expect(c.has('PreprocDirective'), 'C/C++ 应把 # 开头的行读作预处理指令').toBe(true)
    expect(python.has('Comment'), 'Python 应把 # 开头的行读作注释').toBe(true)
    expect(python.has('PreprocDirective'), 'Python 不该认预处理指令').toBe(false)

    // 四份解析结果两两不同——挡住「都返回了同一个空扩展」这种哑火
    const fingerprints = [c, java, python].map((s) => [...s].sort().join(','))
    expect(new Set(fingerprints).size).toBe(3)
  })

  it('遇到没配过的语言当场抛错，而不是静默返回「没颜色」', () => {
    // 静默返回空的后果：编辑器不报错、只是灰扑扑一片，能被一路漏到用户手上
    expect(() => languageExtension('ruby' as LangOfCode)).toThrow(/ruby/)
  })
})

describe('主题', () => {
  it('编辑器里的代码必须能选中（user-select 要改回 text）', () => {
    // tokens.css 给 body 设了 user-select: none，用来防止界面文字被误选中。
    // 这个设定会**继承进编辑器**，不覆盖回来，编辑器里的代码一个字都选不中——
    // 复制粘贴全废，而且不报任何错，只有真人去拖鼠标才会发现。
    const content = miEditorThemeSpec['.cm-content']
    expect(content.userSelect).toBe('text')
    // 两个都写上是双保险（Chromium 认不带前缀的那个，留着是防老版本）
    expect(content.WebkitUserSelect).toBe('text')
  })

  it('主题里不许写死颜色，一律走设计令牌', () => {
    // 写死色值的后果：改配色时只改了 tokens.css，编辑器却还留着旧颜色，
    // 变成界面上一块对不上号的补丁，且很难联想到是这里漏改。
    const looksLikeColor = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/i
    const hardcoded = collectValues(miEditorThemeSpec).filter((v) => looksLikeColor.test(v))
    expect(hardcoded, '这些色值应改成 var(--mi-*) 令牌').toEqual([])
  })

  it('主题与着色样式能在无 DOM 环境下构造出来', () => {
    // 构造就不该抛错；真挂载要 DOM，属手工验收
    // 2026-09-20：这两个从常量改成了 `(theme) => Extension` 的函数（夜间模式要两套），
    // 所以断言从「是不是真值」变成「两种主题各构造一遍都不炸」。
    for (const theme of ['light', 'dark'] as const) {
      expect(miEditorTheme(theme), theme).toBeTruthy()
      expect(miHighlightStyle(theme), theme).toBeTruthy()
      expect(() =>
        EditorState.create({
          doc: 'int main() {}',
          extensions: [languageExtension('cpp'), miEditorTheme(theme), miHighlightStyle(theme)]
        })
      ).not.toThrow()
    }
  })
})

describe('编辑体验', () => {
  it('整套扩展能在无 DOM 环境下组装出 EditorState', () => {
    // 真挂载要 DOM，但「能不能组装」本身就能挡住一堆低级错误：
    // 少个逗号、导入了不存在的名字、扩展之间互相冲突，都会在这里炸。
    for (const lang of EDITOR_LANGS) {
      expect(() =>
        EditorState.create({
          doc: 'int main() {\n  return 0;\n}\n',
          extensions: [
            ...baseEditorExtensions(() => {}),
            languageExtension(lang),
            miEditorTheme('light'),
            miHighlightStyle('light')
          ]
        }),
        `${lang} 的扩展组装失败`
      ).not.toThrow()
    }
  })

  it('自动补右括号是开着的（新手忘写 } 是第一大错）', () => {
    // 怎么验证一个「不透明扩展」确实装上了：closeBrackets() 会往
    // EditorView.inputHandler 这个 facet 里登记恰好一条处理函数。
    // 装上=1，摘掉=0，是条能真证伪的断言（已实测：删掉 closeBrackets()
    // 这行，本测试当场报 expected 0 to be 1）。
    const withIt = EditorState.create({ doc: '', extensions: baseEditorExtensions(() => {}) })
    expect(withIt.facet(EditorView.inputHandler).length).toBe(1)
    expect(EditorState.create({ doc: '', extensions: [] }).facet(EditorView.inputHandler).length).toBe(0)
  })

  it.todo('敲字时把内容同步回 v-model（需 DOM：updateListener 只在 view.update 时触发，state.update 不触发）')
})

/**
 * 外部改内容。这组测试对应主人 2026-09-13 报的「光标极其灵敏、一直在跳」。
 *
 * 光断言 `from/to/insert` 是没用的——数字对不代表光标就不跳。
 * 所以下面既用 CodeMirror **自己的位置映射**跑了一遍真实效果
 * （把改动喂给 EditorState.update，看光标最后落在哪），
 * 又用「改完必须等于新文本」这类不变量兜底。
 */
describe('最小替换 minimalChange', () => {
  /** 把改动应用到旧文本上，应当得到新文本 */
  const applied = (oldText: string, newText: string): string => {
    const c = minimalChange(oldText, newText)
    return oldText.slice(0, c.from) + c.insert + oldText.slice(c.to)
  }

  /** 喂给是真的 CodeMirror 状态机，返回改动后的光标位置 */
  const caretAfter = (oldText: string, newText: string, caret: number): number => {
    const state = EditorState.create({ doc: oldText, selection: { anchor: caret } })
    const next = state.update({ changes: minimalChange(oldText, newText) }).state
    return next.selection.main.anchor
  }

  it('改完的内容和外面推过来的新文本一模一样（这是底线，破了就是丢代码）', () => {
    const cases: [string, string][] = [
      ['', ''],
      ['a', 'a'],
      ['', 'print("hi")'],
      ['print("hi")', ''],
      ['abc', 'abd'],
      ['abc', 'xbc'],
      ['abc', 'abx'],
      ['abcdef', 'abXdef'],
      ['aaa', 'aaaa'],
      ['aaaa', 'aaa'],
      ['line1\nline2\nline3', 'line1\nCHANGED\nline3'],
      ['😀 ab', '😀 ac'],
      ['😀😀', '😀'],
      ['x😀y', 'z😀y']
    ]
    for (const [oldText, newText] of cases) {
      expect(applied(oldText, newText), `${JSON.stringify(oldText)} → ${JSON.stringify(newText)}`).toBe(newText)
    }
  })

  it('【这条就是那个 bug】在开头改一个字，文档中间的光标原地不动', () => {
    // 实测：整篇重写（from:0, to:全长）时，只要光标不在**文末**，
    // 就会被映射回文首。下面这个位置 9 在整篇重写下会变成 0 ——
    // 人写代码时光标绝大多数时候就在这种「文档中间」的位置。
    // （别把断言挑成「文末」：位置正好等于 to，整篇重写也活得下来，
    //   那样这条测试就变成了永不报红的摆设。）
    const oldText = 'print(1)\nprint(2)\nprint(3)\nprint(4)'
    const newText = 'Print(1)\nprint(2)\nprint(3)\nprint(4)'
    expect(caretAfter(oldText, newText, 9)).toBe(9)
  })

  it('【同上】选中的一段不会因为开头改了个字就消失', () => {
    // 整篇重写下实测：选区 0..9 会塌缩成 0（选中整段没了），
    // 选区 20..32 会变成「文末→文首」的反向选区。
    // 主人说的「没法单独选中几行代码」，就是这种样子。
    const oldText = 'print(1)\nprint(2)\nprint(3)\nprint(4)'
    const newText = 'Print(1)\nprint(2)\nprint(3)\nprint(4)'
    const state = EditorState.create({ doc: oldText, selection: { anchor: 20, head: 32 } })
    const next = state.update({ changes: minimalChange(oldText, newText) }).state
    expect(next.selection.main.anchor).toBe(20)
    expect(next.selection.main.head).toBe(32)
  })

  it('在中间插一行，后面的光标跟着往后挪，不会跑到文首', () => {
    const oldText = 'a\nc'
    const newText = 'a\nb\nc'
    // 插进来 2 个字符（"b\n"），光标应当从 3 挪到 5，而不是被打回 0
    expect(caretAfter(oldText, newText, 3)).toBe(5)
  })

  it('内容没变时不产生任何改动', () => {
    expect(minimalChange('abc', 'abc')).toEqual({ from: 3, to: 3, insert: '' })
  })

  it('只在末尾追加时，改动段落在末尾（前面那段一个字都不碰）', () => {
    const oldText = 'print(1)'
    expect(minimalChange(oldText, 'print(1)\nprint(2)')).toEqual({
      from: 8,
      to: 8,
      insert: '\nprint(2)'
    })
  })

  it('完全换一份（载入示例代码）时退化成整篇替换', () => {
    const c = minimalChange('aaa', 'bbb')
    expect(c).toEqual({ from: 0, to: 3, insert: 'bbb' })
  })

  it('不把 emoji 从中间切开', () => {
    // CodeMirror 的位置单位是 UTF-16 码元。切在高低代理之间，
    // 屏幕上是两个乱码方块，而且再存一次盘就真的把那半个字符写进去了。
    const oldText = 'AB😀'
    const newText = 'AC😀'
    const c = minimalChange(oldText, newText)
    // 改动段必须整体含住那个 emoji（或被它整体排除），不能从它中间穿过去
    const cutsEmoji = c.from === 2 && c.to === 3
    expect(cutsEmoji, `改动段 ${c.from}..${c.to} 切在了 emoji 中间`).toBe(false)
    expect(applied(oldText, newText)).toBe(newText)
  })
})

/**
 * 焦点归还。对应「跑完按 Ctrl+A 没反应」那条已确认的真实缺陷。
 */
describe('跑完该不该把焦点还给编辑器', () => {
  it('焦点掉在 body 上（跑完代码的实际情况）→ 要还', () => {
    expect(shouldRestoreFocus({ tagName: 'BODY', editable: false })).toBe(true)
    expect(shouldRestoreFocus(null)).toBe(true)
  })

  it('焦点在运行按钮上 → 要还（点按钮后就是这种，不还的话键盘焦点留在按钮上）', () => {
    expect(shouldRestoreFocus({ tagName: 'BUTTON', editable: false })).toBe(true)
  })

  it('用户正在输入框里打字 → 绝不能抢', () => {
    // 跑得快的时候（几毫秒），主人可能已经点进输入框在敲这次的输入了。
    // 这时候把焦点抢走 = 在人打字打到一半时把光标抽走，比不还焦点还恶劣。
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(shouldRestoreFocus({ tagName, editable: false }), tagName).toBe(false)
    }
  })

  it('焦点已经在某个可编辑区域（比如编辑器自己）→ 不碰', () => {
    // 再 focus() 一次会把用户刚拖出来的选区清掉
    expect(shouldRestoreFocus({ tagName: 'DIV', editable: true })).toBe(false)
  })
})

describe('语法着色清单', () => {
  it('标签不重复，两套主题的色值都是合法十六进制', () => {
    const names = MI_TOKEN_COLORS.map((c) => c.tag)
    expect(new Set(names).size, `重复的标签：${names.join(',')}`).toBe(names.length)
    for (const { tag, light, dark } of MI_TOKEN_COLORS) {
      expect(light, `${tag} 的浅色值`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(dark, `${tag} 的深色值`).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('同一套里注释色与关键字色不能撞车（撞了就看不出哪些是注释）', () => {
    // 两种主题各查一遍：深色那套是**另外挑的**色，浅色过不代表深色也过
    for (const theme of ['light', 'dark'] as const) {
      const of = (t: string): string => MI_TOKEN_COLORS.find((c) => c.tag === t)![theme]
      expect(of('comment'), theme).not.toBe(of('keyword'))
      expect(of('comment'), theme).not.toBe(of('string'))
    }
  })
})
