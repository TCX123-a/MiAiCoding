/**
 * 把内容文案里的**内联标记**渲染成真的元素（强调 → `<strong>`，代码 → `<code>`）。
 *
 * 【为什么需要它】
 * 错误库（`content/error-lib/*.json`）的讲解文案是**按"有内联标记"写的**：
 *
 *     翻译官喵读到「printf」的时候，觉得前面那句还没结束喵。
 *     C 语言里**每条语句末尾都要有分号**……
 *     在「printf」那一行的**上一行**末尾补一个 `;` 喵
 *
 * 但渲染层一直用 `{{ }}` 逐字输出 —— 学员看到的是满屏星号和反引号。
 * 全库实测（`_scan-stars.mjs` / `_scan-backticks.mjs`）：**120 条含 `**`、177 条含反引号，
 * 共 906 个反引号**，分布在 5 个文件里。DOM 也是实测过的（`_probe-errtext.mjs`）：
 * 卡片里 `<strong>` 0 个、`<code>` 0 个，`**` 和反引号原样可见。
 *
 * 这在这门课里格外要命：学编程的人看到 `` `;` `` 应该认成"一段代码"，
 * 而不是"一个分号外面套了两个怪符号"。
 *
 * 【为什么不用现成的 markdown-it】
 * 那套只服务课文正文（`lib/md.ts`）。这 399 条串是**普通散文 + 两个内联标记**，
 * 不是 markdown 文档。拿 `md.render` 一过，一句以 `-` 开头的话会变成列表、
 * `1.` 会变成有序列表、`\n\n` 会变成 `<p>`（把 `white-space: pre-wrap` 的排版掀掉），
 * 而且必须上 `v-html`。这里只认两种标记，行为可预测，也就不用碰 v-html。
 *
 * 【嵌套：粗体里可以有代码片段】
 * 这不是"为了完整才做"，是**真实内容里就有**：
 *
 *     ……写招式的时候**先把 `{}` 一起打出来**，再往中间填内容喵。
 *
 * （`c.json` 里那条"大括号没配对"的规则。第一次扫的时候我查的是反方向
 * ——"反引号里有没有星号"，所以扫出 0 条；是 `rich-text.test.ts` 拿错误库本体
 * 当回归网才把它逼出来的。这也说明手写用例永远盖不全，得让真数据当网。）
 *
 * 所以：**粗体内部要再认一遍代码片段**。反过来的方向（代码片段内部）不用认，
 * 而且**必须不认** —— 见下。
 *
 * 【解析顺序：代码片段优先 —— 这个顺序是安全性的全部】
 * 每个位置**先试反引号，再试星号**。这不是随便定的，它是唯一能保护真代码的顺序：
 * C 里的 `char **argv`（指向指针的指针）写进反引号时，反引号分支会把整段先吃掉，
 * 那两个星号根本轮不到被当标记。反过来（先找星号）就会把 `char **argv`
 * 拆成"粗体从这儿开始"，然后一路吞到下一个 `**`，把大半段话吃掉 ——
 * 而错误库现在就有 25 条 C 规则，这是迟早会撞上的。
 *
 * 同一条保护在粗体内部也要有：找配对的 `**` 时会**跳过反引号区间**，
 * 否则 `**看 `char **argv` 这个**` 会在代码片段中间就"配对成功"。
 *
 * 【配不上就当普通字符】
 * 落单的 `**`、落单的反引号、空的 ```` `` ````、跨了换行的 —— **一律原样保留**。
 * 实测现在这 399 条里四种情况都是 0 条，所以这里的兜底不是"防现在的数据"，
 * 是防**将来写错的文案**：宁可多显示一个星号（一眼看得见、随手能改），
 * 也不要把一整段话吞掉 —— 学员看到的会是内容凭空少了一半，还查不出为什么。
 *
 * 【结构：为什么是扁平的 `bold` 修饰符，不是嵌套的 children】
 * 加粗是**修饰**（这段字要不要更粗），代码是**类别**（这段字是不是代码），
 * 两者可以同时成立 —— 所以 `{ kind, bold, text }` 就够了，
 * 渲染层一个 `v-for` 四分支画完，不需要递归组件。
 * 嵌套的 `children` 结构表达能力更强，但强出来的那部分（粗体里还有粗体）
 * 恰恰是 markdown 自己都不支持的写法。
 */

export type InlineKind = 'text' | 'code'

export interface InlineSegment {
  /** 这一段是普通文字，还是要显示成代码 */
  kind: InlineKind
  /** 这一段要不要加粗。可以同时 `kind === 'code'`（粗体里的代码片段） */
  bold: boolean
  text: string
}

const BOLD = '**'
const CODE = '`'

export function splitInline(raw: string): InlineSegment[] {
  if (!raw) return []
  const out: InlineSegment[] = []
  scan(raw, false, out)
  return out
}

/**
 * 从左往右扫一段文字，把片段塞进 `out`。
 *
 * `bold` 是"我现在在粗体里面"：在粗体里面就**不再认粗体**（`**a **b** c**` 这种
 * 同类型嵌套 markdown 自己也不支持，认了只会把配对搞得没法预测），
 * 但**仍然认代码片段**。
 */
function scan(raw: string, bold: boolean, out: InlineSegment[]): void {
  let plain = ''
  let i = 0

  const flushPlain = (): void => {
    if (plain) out.push({ kind: 'text', bold, text: plain })
    plain = ''
  }

  while (i < raw.length) {
    if (raw[i] === CODE) {
      const p = pairAt(raw, i, CODE)
      if (p) {
        flushPlain()
        out.push({ kind: 'code', bold, text: p.inner })
        i = p.next
        continue
      }
    } else if (!bold && raw.startsWith(BOLD, i)) {
      const p = pairAt(raw, i, BOLD)
      if (p) {
        flushPlain()
        // 粗体里面的代码片段要认出来（真实内容里就有这种写法，见文件头）
        scan(p.inner, true, out)
        i = p.next
        continue
      }
    }
    plain += raw[i]
    i++
  }

  flushPlain()
}

/**
 * 从 `open` 处往后找配对的 marker；配不上返回 `null`。
 *
 * 三种"配不上"：**没找到**、**内容是空的**（`` **** `` / ```` `` ````）、**跨了换行**。
 * 跨行那条挡的是"一个手滑吞掉一整段"：星号开了个头忘了关，
 * 一路配到两段之后的另一个星号，中间的话就全变成粗体了。
 *
 * 找粗体结尾时会**跳过反引号区间** —— 代码片段里的 `**`（`char **argv`）
 * 不是标记，不能拿它当结尾。
 */
function pairAt(raw: string, open: number, marker: string): { inner: string; next: number } | null {
  let i = open + marker.length

  while (i < raw.length) {
    if (raw[i] === '\n') return null
    if (marker === BOLD && raw[i] === CODE) {
      const close = raw.indexOf(CODE, i + 1)
      if (close === -1 || raw.slice(i + 1, close).includes('\n')) return null
      i = close + 1
      continue
    }
    if (raw.startsWith(marker, i)) {
      const inner = raw.slice(open + marker.length, i)
      return inner === '' ? null : { inner, next: i + marker.length }
    }
    i++
  }

  return null
}
