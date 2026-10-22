import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { splitInline } from '../rich-text'

/**
 * 内联标记解析器。
 *
 * 这个文件的重点**不是**"粗体能被认出来"（那是顺带），而是三件更要命的事：
 *   ① **真代码里的星号绝不能被吃掉** —— C 的 `char **argv` 写在反引号里时，
 *      它必须整段是代码，不能被当成"粗体开始了"
 *   ② **认不出来的标记要原样留着，不能把内容吞掉** ——
 *      宁可多显示一个星号，也不能让学员看到的话凭空少一半
 *   ③ **真实内容当回归网** —— 手写用例永远盖不全（下面那个嵌套的 case
 *      就是这么被抓出来的，见 `describe('拿错误库本体当回归网')` 里那段说明）
 */

/**
 * 把片段拍平成可读的伪标记，断言才看得懂。
 *
 * **按"加粗状态有没有切换"开合 `<b>`，不是逐段包一层**：粗体里夹一个代码片段时
 * （`**先把 `{}` 一起打出来**`），片段会被切成 [粗体文字, 粗体代码, 粗体文字] 三段，
 * 逐段包就会写成 `<b>先把 </b><b><c>{}</c></b><b> 一起打出来</b>` ——
 * 浏览器里和 `<b>先把 <c>{}</c> 一起打出来</b>` 一模一样，
 * 但断言里全是噪音，看不出真正要验的是什么。
 */
const flat = (s: string): string => {
  let out = ''
  let bold = false
  for (const seg of splitInline(s)) {
    if (seg.bold !== bold) {
      out += seg.bold ? '<b>' : '</b>'
      bold = seg.bold
    }
    out += seg.kind === 'code' ? `<c>${seg.text}</c>` : seg.text
  }
  return bold ? `${out}</b>` : out
}

const text = (t: string) => ({ kind: 'text', bold: false, text: t })
const code = (t: string) => ({ kind: 'code', bold: false, text: t })

describe('splitInline()：认标记', () => {
  it('空串给空数组（不是"一个空片段"）', () => {
    expect(splitInline('')).toEqual([])
  })

  it('没有标记的一段话，就是一个 text 片段', () => {
    expect(splitInline('翻译官喵在看着你喵～')).toEqual([text('翻译官喵在看着你喵～')])
  })

  it('**强调** → bold', () => {
    expect(flat('C 语言里**每条语句末尾都要有分号**喵')).toBe('C 语言里<b>每条语句末尾都要有分号</b>喵')
  })

  it('`代码` → code', () => {
    expect(flat('末尾补一个 `;` 喵')).toBe('末尾补一个 <c>;</c> 喵')
  })

  it('两种标记混排，顺序和位置都不变', () => {
    expect(flat('**先粗**然后 `int x` 再**粗**')).toBe('<b>先粗</b>然后 <c>int x</c> 再<b>粗</b>')
  })

  it('同一句里多个代码片段各自成段', () => {
    expect(splitInline('`a` 和 `b`')).toEqual([code('a'), text(' 和 '), code('b')])
  })
})

describe('splitInline()：嵌套（真实内容里就有）', () => {
  it('粗体里套代码片段 —— c.json 那条"大括号没配对"的原话', () => {
    expect(flat('写招式的时候**先把 `{}` 一起打出来**，再往中间填内容喵')).toBe(
      '写招式的时候<b>先把 <c>{}</c> 一起打出来</b>，再往中间填内容喵'
    )
  })

  it('嵌套那一段的 bold 标志要跟着一起传下去（不然渲染层会漏掉加粗）', () => {
    expect(splitInline('**先把 `{}` 打出来**')).toEqual([
      { kind: 'text', bold: true, text: '先把 ' },
      { kind: 'code', bold: true, text: '{}' },
      { kind: 'text', bold: true, text: ' 打出来' }
    ])
  })

  it('一串连续的 `**` 会两两配对（和 markdown 一致）—— 重点是一个字都不丢', () => {
    // 这条不确定"哪种渲染才对"（`**外面 **里面** 外面**` 本来就写得有歧义，
    // markdown 各家实现也不一致），它钉的是**不变的那条**：
    // 怎么配都行，但**不能把学员看到的话吃掉**。
    const s = '**外面 **里面** 外面**'
    expect(flat(s)).toBe('<b>外面 </b>里面<b> 外面</b>')
    expect(splitInline(s).map((x) => x.text).join('')).toBe(s.replace(/\*\*/g, ''))
  })
})

describe('splitInline()：真代码里的星号绝不能被吃掉', () => {
  it('反引号里的 `char **argv` 整段是代码 —— 那两个星号不是标记', () => {
    const out = splitInline('把 `char **argv` 改成 `char *argv[]` 喵')
    expect(out).toEqual([
      text('把 '),
      code('char **argv'),
      text(' 改成 '),
      code('char *argv[]'),
      text(' 喵')
    ])
    expect(out.some((s) => s.bold)).toBe(false)
  })

  it('**粗体里**的 `char **argv` 也不能把粗体提前截断', () => {
    // 找配对结尾时跳过反引号区间，否则会在 `char ` 后面就"配对成功"
    expect(flat('**看 `char **argv` 这个**写法喵')).toBe('<b>看 <c>char **argv</c> 这个</b>写法喵')
  })

  it('反引号里的单个 `*`（解引用 / 乘法）原样保留', () => {
    expect(flat('`"喵" * 3` 会重复三次喵')).toBe('<c>"喵" * 3</c> 会重复三次喵')
  })

  it('裸的单个 `*` 就是普通字符（C 指针没写在反引号里时）', () => {
    expect(flat('int *p 是个指针喵')).toBe('int *p 是个指针喵')
  })
})

describe('splitInline()：认不出来的标记要原样留着，不能吞内容', () => {
  it('落单的 `**` 原样保留', () => {
    expect(flat('这里有个**没配对的星号')).toBe('这里有个**没配对的星号')
  })

  it('`****` 不产生空强调，原样保留', () => {
    expect(splitInline('****')).toEqual([text('****')])
  })

  it('`***` 原样保留', () => {
    expect(splitInline('***')).toEqual([text('***')])
  })

  it('空的反引号对 `` 原样保留，不产生空代码片段', () => {
    expect(splitInline('``')).toEqual([text('``')])
  })

  it('落单的反引号原样保留', () => {
    expect(flat('这里有个 ` 没配对')).toBe('这里有个 ` 没配对')
  })

  it('跨了换行的 `**` 不算标记 —— 一个手滑不能吞掉一整段', () => {
    const s = '第一段**开了个话头\n\n第二段这里又出现**了星号'
    expect(splitInline(s)).toEqual([text(s)])
  })

  it('跨了换行的反引号同理', () => {
    const s = '上面 `开了个头\n下面又` 关上了'
    expect(splitInline(s)).toEqual([text(s)])
  })

  it('粗体里那个反引号没配对时，粗体整个原样保留（不吞内容）', () => {
    expect(flat('**开了个 ` 没关上**')).toBe('**开了个 ` 没关上**')
  })
})

// ---------------------------------------------------------------- 真实内容回归

/**
 * 直接拿**错误库本体**当测试数据。
 *
 * 为什么值得这么写：解析器的边界条件是"将来有人写错"才暴露的，
 * 手写的用例永远只覆盖我想到的那些。而错误库是会持续长出来的 ——
 * 每加一条规则就是一次新的输入。让它当回归网，
 * 下次谁写了这个解析器认不出的写法，**这里当场变红**，
 * 而不是等学员在界面上看见一堆星号。
 *
 * 【这张网已经抓到过一次，而且抓的是我自己】
 * 我一开始只扫了"反引号里有没有星号"，扫出 0 条嵌套，于是把嵌套写成
 * "已知不支持的写法"。结果这张网一跑就红了 —— 真实内容里**本来就有**
 * `**先把 \`{}\` 一起打出来**`（c.json 那条"大括号没配对"）。
 * 是我扫描时查错了方向。改成支持嵌套的。这就是"手写用例盖不全"的实证。
 */
const RENDERED_FIELDS = new Set(['title', 'explain', 'fixHint', 'tag'])

interface Sample {
  file: string
  field: string
  text: string
}

function renderedStrings(): Sample[] {
  const dir = join(__dirname, '..', '..', '..', '..', '..', 'content', 'error-lib')
  const out: Sample[] = []
  const walk = (node: unknown, field: string): void => {
    if (typeof node === 'string') {
      if (RENDERED_FIELDS.has(field)) out.push({ file: '', field, text: node })
      return
    }
    if (Array.isArray(node)) return node.forEach((v) => walk(v, field))
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, k)
    }
  }
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const before = out.length
    walk(JSON.parse(readFileSync(join(dir, f), 'utf8')), '')
    for (let i = before; i < out.length; i++) out[i].file = f
  }
  return out
}

describe('拿错误库本体当回归网', () => {
  const samples = renderedStrings()

  it('样本量没有静默失效（字段名写错就会静默变 0 条）', () => {
    expect(samples.length).toBeGreaterThan(300)
    expect(samples.some((s) => s.text.includes('**'))).toBe(true)
    expect(samples.some((s) => s.text.includes('`'))).toBe(true)
  })

  it('每一条里所有 `**` 都被认出来了，没有一个原样留在正文里', () => {
    const leftovers: string[] = []
    for (const { file, field, text: t } of samples) {
      for (const seg of splitInline(t)) {
        if (!seg.bold && seg.text.includes('**')) {
          leftovers.push(`${file} .${field} → ${JSON.stringify(seg.text.slice(0, 70))}`)
        }
      }
    }
    expect(leftovers).toEqual([])
  })

  it('每一条里所有反引号都被认出来了', () => {
    const leftovers: string[] = []
    for (const { file, field, text: t } of samples) {
      for (const seg of splitInline(t)) {
        if (seg.kind === 'text' && seg.text.includes('`')) {
          leftovers.push(`${file} .${field} → ${JSON.stringify(seg.text.slice(0, 70))}`)
        }
      }
    }
    expect(leftovers).toEqual([])
  })

  it('错误库里的标记全是配对的：拍平后 = 原文去掉那两种标记', () => {
    // 这条同时是**内容体检**：万一将来有人写了个落单的 `**`，
    // 它会在这里变红 —— 那正是要你知道的事（要么补齐，要么它就是字面星号，
    // 但那时得先想清楚解析器该不该认它，而不是让它悄悄留在界面上）。
    for (const { file, field, text: t } of samples) {
      const joined = splitInline(t).map((s) => s.text).join('')
      const expected = t.replace(/\*\*/g, '').replace(/`/g, '')
      expect(joined, `${file} .${field}`).toBe(expected)
    }
  })

  it('讲解文案不是"全是纯文本"—— 真的切出了强调、代码片段、以及嵌在粗体里的代码', () => {
    const all = samples.flatMap((s) => splitInline(s.text))
    expect(all.some((s) => s.bold && s.kind === 'text')).toBe(true)
    expect(all.some((s) => !s.bold && s.kind === 'code')).toBe(true)
    expect(all.some((s) => s.bold && s.kind === 'code')).toBe(true)
  })
})
