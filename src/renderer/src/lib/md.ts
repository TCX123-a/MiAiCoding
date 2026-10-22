/**
 * M3-01：markdown-it 渲染管线。
 * - 代码块：hljs 四语言高亮（c/cpp/java/python），其余语言按纯文本安全转义
 * - 提示容器：::: tip / ::: warn → 圆角提示卡（markdown-it-container）
 * - compare 对比块：正文里只留一个占位元素（`.compare-slot`），结构数据交给
 *   CompareGrid 组件渲染（按钮可交互），**并且插回它在正文里的那个位置**
 * - demo 演示块（2026-09-19）：同一套槽位机制（`.demo-slot`），交给 DemoPlayer
 *   逐步播放。**和 compare 共用切分器**，不另起一套
 * - 链接：lesson:// 拦截跳转；http(s) 一律新窗口交给系统浏览器（main 进程 setWindowOpenHandler）
 * - html:false：正文原始 HTML 一律按文本转义
 */
import MarkdownIt from 'markdown-it'
import container from 'markdown-it-container'
import { LANG_OF_CODE } from '../../../shared/types'
import type { LangOfCode } from '../../../shared/types'
import { ADMONITION, CODE_BLOCK } from './copy'
import hljs from 'highlight.js/lib/core'
import cLang from 'highlight.js/lib/languages/c'
import cppLang from 'highlight.js/lib/languages/cpp'
import javaLang from 'highlight.js/lib/languages/java'
import pythonLang from 'highlight.js/lib/languages/python'
import '../styles/md.css'

hljs.registerLanguage('c', cLang)
hljs.registerLanguage('cpp', cppLang)
hljs.registerLanguage('java', javaLang)
hljs.registerLanguage('python', pythonLang)

// ---------------------------------------------------------------- compare 块提取

export interface CompareBlock {
  langs: string[]
  code: Record<string, string>
}

/** 解析 ```compare 围栏内 lang:: 分段（与 content-validate 的切分规则一致） */
export function parseCompare(content: string): CompareBlock {
  const code: Record<string, string> = {}
  const langs: string[] = []
  const parts = content.split(/^(\w+)::\s*$/m)
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const lang = parts[i].trim()
    const snippet = parts[i + 1].trim()
    if (lang && snippet) {
      langs.push(lang)
      code[lang] = snippet
    }
  }
  return { langs, code }
}

/**
 * 认出正文里的 compare 围栏 —— **判据交给 markdown-it 自己**（它已经把
 * 正文切成 token 了），不再自己写正则去扫原文。
 *
 * 【为什么这条很要紧】
 * 上一版是 `/```compare\s*\n([\s\S]*?)```/g` 扫源码。于是**同一件事有两个判据**：
 * 「提取」（正则扫源码）和「渲染」（markdown-it 切 token）。两者只要有一处不同
 * ——缩进、围栏比 ``` 长、藏在 `:::` 容器里——就会**各认各的**，
 * 表现是"对比块凭空少了一个"或"正文里多出一坨代码"，而两边都不报错。
 * 现在提取和渲染走的是**同一批 token**，判据只剩一处。
 */
function isCompareFence(info: string): boolean {
  return (info || '').trim().split(/\s+/)[0] === 'compare'
}

/**
 * 把一课正文里的 compare 块**按出现顺序**收集出来（不渲染，不跑高亮）。
 *
 * 用途是 `LessonDetailView` 的「引用了别的课的对比块」（`lesson.compare`）——
 * 那种块在本课正文里没有位置可言，只能整体附在文末。
 * 本课自己的对比块不走这条路（见 `renderMarkdown`）。
 */
export function collectCompare(body: string): CompareBlock[] {
  const out: CompareBlock[] = []
  for (const t of md.parse(body, {})) {
    if (t.type === 'fence' && isCompareFence(t.info)) out.push(parseCompare(t.content))
  }
  return out
}

/**
 * 正文 HTML 里**代替「活组件」的那个占位元素**。
 *
 * 【为什么要在原地留个占位符，而不是把它挪到文末】
 * 课文里写的是「四门语言写出来是这样：」，紧接着才是那个块。原来 `md` 把整块
 * 换成空串、详情页把 `CompareGrid` 渲染在**整篇文章之后** —— 于是那句话后面
 * 屏幕上**什么都没有**，而它指的四个代码块在「小任务」下面。学员读到那儿只能
 * 自己往下翻，还不一定知道要往下找。
 *
 * 占位符由 **fence 渲染规则**产出（不是往 markdown 源码里塞 HTML ——
 * 那会被 `html:false` 转义成文本），所以它一定是个干净的顶层块，
 * 详情页拿 `splitSlots()` 按它切开就能把组件插回原位。
 *
 * 【2026-09-19：`demo` 演示块接进来，槽位机制**没有复制第二份**】
 * 演示块和对比块一样要在正文那个位置冒出一个活组件，所以它走的是**同一套**槽位：
 * 同一个类名规则（`<kind>-slot`）、同一个属性名规则（`data-<kind>-slot`）、
 * **同一个切分器**。原来那个只认 compare 的切分器已并成下面这一个 ——
 * 两份「怎么找占位元素」的判据，就是 `md.ts` 开头那段注释记着的那种事故。
 */
export type SlotKind = 'compare' | 'demo'

/** 类名与属性名**都由 kind 推出来**，写的时候和读的时候不可能各说各话 */
const slotClass = (kind: SlotKind): string => `${kind}-slot`

export const COMPARE_SLOT_CLASS = slotClass('compare')
export const DEMO_SLOT_CLASS = slotClass('demo')

/**
 * ⚠️ **这是「正文里的占位元素长什么样」的唯一判据**。
 * 中间的 `\1` 是反向引用：类名和属性名必须指向**同一个 kind** ——
 * `class="compare-slot" data-demo-slot="0"` 这种自相矛盾的写法不会被认出来。
 */
const SLOT_RE = /<div class="(compare|demo)-slot" data-\1-slot="(\d+)"><\/div>/g

/** 写占位元素。**和 `SLOT_RE` 共用 `slotClass`**，两头不会漂移。 */
function slotTag(kind: SlotKind, index: number): string {
  return `<div class="${slotClass(kind)}" data-${kind}-slot="${index}"></div>\n`
}

/** 切开之后的一段：要么是一截正文 HTML，要么是「这里该插第 i 个活组件」 */
export type SlotPart =
  | { kind: 'html'; html: string }
  | { kind: 'compare'; index: number }
  | { kind: 'demo'; index: number }

/**
 * 把渲染好的正文 HTML 按占位元素切开，返回**交替**的片段序列。
 *
 * 调用方 `v-for` 一遍：`html` 段用 `v-html` 塞进 `<article>`，
 * `compare` 段渲染一个 `<CompareGrid :blocks="[第 i 个]">`，
 * `demo` 段渲染一个 `<DemoPlayer :block="[第 i 个]">`。
 * 这样两种块都出现在课文提到它的那个位置。
 */
export function splitSlots(html: string): SlotPart[] {
  const parts: SlotPart[] = []
  let last = 0
  /*
   * 只收**有内容**的 HTML 段。
   *
   * 切缝两边总会剩下几个换行（占位元素自己后面就跟着一个 `\n`），
   * 而调用方是拿 `v-for` 把每段变成一个 `<article>` 的 —— 收进来的话，
   * 「对比块在正文末尾」这种课就会多出一个**空的 article**。
   * 它不报错、不显示，白占一个节点，还让 DOM 检查多一条噪声。
   */
  const pushHtml = (chunk: string): void => {
    if (chunk.trim()) parts.push({ kind: 'html', html: chunk })
  }
  for (const m of html.matchAll(SLOT_RE)) {
    const at = m.index ?? 0
    if (at > last) pushHtml(html.slice(last, at))
    // m[1] 已经被 `SLOT_RE` 限成 'compare' | 'demo' 两个值，直接当 kind 用
    parts.push({ kind: m[1] as SlotKind, index: Number(m[2]) })
    last = at + m[0].length
  }
  if (last < html.length) pushHtml(html.slice(last))
  return parts
}

// ---------------------------------------------------------------- demo 块提取

/**
 * 演示块：**作者手写轨迹**，播放器只负责显示第 N 步。
 *
 * 【为什么不让播放器自己解释命令】（主人 2026-09-19 拍板选的「甲」）
 * 另一种做法是课文里写 `push 1 / push 2 / pop`，播放器**推断**出每一步长什么样。
 * 那样作者省事，但「这一帧高亮哪一行、变量显示什么值」就变成了播放器的**猜测** ——
 * 而这几件事恰好是教学里**错不起**的地方（循环少走一圈、栈顶指针指错一格，
 * 学员照着记下来就是错的）。手写轨迹把每一帧的完整状态摆在这儿，播放器不推任何东西。
 * 代价是作者要多写几行，值得。
 */
export interface DemoStep {
  /** 这一步叫什么（「第 2 轮 · 判断条件」），显示在步骤条上 */
  label: string
  /** 高亮**代码里的第几行**（1 起）。校验器保证它 1..code.length */
  at: number
  /** 这一句在讲什么 —— 演示的意义全在这句话里 */
  say: string
  /**
   * 大肥鱼气泡里那句**短话**（2026-09-20 加）。没写 = 空串。
   *
   * 【它和 `say` 的分工，别搞混】
   * `say` 是**讲课**：讲清这一步发生了什么，学员靠它学会循环怎么跑。
   * `meow` 是**陪读**：一句短、可爱、跟这一步对得上的话，负责让眼睛愿意停在这儿。
   * 两者**不能互相顶替** —— 气泡里塞讲课内容会撑爆气泡，
   * 讲解里塞「喵」则是把教学内容稀释掉。
   *
   * 【为什么是作者逐字写，不是播放器按规则生成】
   * 「值变大了就弹『叼回来一条小鱼干』」这种规则听着聪明，实际会**胡说**：
   * 同一个「值变了」，可能是加一、可能是清零、可能是弹出最后一个 ——
   * 只有写这一步的人知道该说哪句。播放器一推断，就又开始对教学内容下判断了，
   * 而 `DemoPlayer` 从第一天起就只有一条职责：把作者写好的第 N 步显示出来。
   */
  meow: string
  /**
   * 这一步立绘摆什么姿态（2026-09-20 加）。没写 = 空串。
   *
   * 【为什么要逐步换姿态】
   * 演示走到「正在往下钻」和「叼着战利品回来了」，是**两种完全不同的处境**，
   * 一张从头挂到尾的固定图等于放弃了这个信息。姿态跟着步骤走，
   * 学员不看代码也能从立绘身上看出「现在是顺的还是在卡着」。
   *
   * 【为什么是作者逐字写，不是播放器按规则生成】
   * 和 `meow` 同一条理由：播放器一推断就又开始替教学内容下判断了。
   *
   * 【取值必须是真实存在的姿态】
   * 写一个不存在的名字，`MiMascot` 会**静默**降级成一个虚线占位框 ——
   * 界面上不报错、不崩，只是立绘没了。所以这一个字段由校验器把关，
   * 白名单**从 `lib/mascot.ts` 的 `MASCOT_POSES` 现场解析出来**（详见 content-validate）。
   */
  pose: string
  /** 这一刻各变量的值。**整份状态**都要写出来，不是只写变了的那个 */
  vars: { name: string; value: string }[]
}

export interface DemoBlock {
  /** 卡片抬头。空串表示作者没写，播放器用默认标题 */
  title: string
  /** 要演示的代码，一行一个 */
  code: string[]
  steps: DemoStep[]
}

/**
 * 解析 ````demo` 围栏。
 *
 * 【格式】（完整规格与逐条校验在 `scripts/content-validate.mjs` 的 `checkDemoBlock`）
 * ```
 * title: 循环的执行顺序      ← 可选，只能出现在 code: 之前
 * code:                      ← 必须有，恰好一次
 * | total = 0                ← `|` 起头，后面原样就是代码（缩进保留）
 * | for i in range(3):
 *                            ← 空行结束 code 块
 * step 第 1 轮 · 判断         ← 必须至少两步
 * at: 2                      ← 高亮第几行
 * say: 0 < 3 成立，进循环体    ← 这一步在讲什么
 * meow: 喵！又叼回来一条！      ← 可选。大肥鱼气泡里那句短话，要短
 * pose: yay                  ← 可选。这一步立绘摆什么姿势
 * i = 0                      ← 变量。`名字 = 值`，可以写多个
 * ```
 *
 * 【为什么变量用 `=`、保留字段用 `:`】
 * 一眼能分开，而且**写错了会被校验器抓到**：`at`/`say`/`meow`/`pose`/`title`/`code`/`step`
 * 这些名字不许当变量名（写成 `at = 2` 是「变量 at」，不是「高亮第 2 行」——
 * 校验器直接报错，不会让它变成一行莫名其妙的变量）。
 */
export function parseDemo(content: string): DemoBlock {
  const code: string[] = []
  const steps: DemoStep[] = []
  let title = ''
  let cur: DemoStep | null = null
  let inCode = false

  const closeStep = (): void => {
    if (cur) steps.push(cur)
    cur = null
  }

  for (const raw of content.split('\n')) {
    const line = raw.trimEnd()

    // ① code 块内部：只有 `|` 起头的算代码行，别的行都结束这个块
    if (inCode) {
      if (line.startsWith('|')) {
        // 去掉 `|` 和紧跟的一个空格；再往后的空格是**缩进**，必须原样留着
        code.push(line.slice(1).replace(/^ /, ''))
        continue
      }
      inCode = false
    }

    const t = line.trim()
    if (!t) continue

    if (t.startsWith('title:')) {
      title = t.slice('title:'.length).trim()
      continue
    }
    if (t === 'code:') {
      inCode = true
      continue
    }
    if (t === 'step' || t.startsWith('step ')) {
      closeStep()
      cur = {
        label: t.slice('step'.length).trim(),
        at: 0,
        say: '',
        meow: '',
        pose: '',
        vars: []
      }
      continue
    }

    if (cur) {
      // ② 保留字段（冒号形式）先判，否则 `say: a = b` 会被当成变量
      const reserved = t.match(/^(at|say|meow|pose)\s*:\s*(.*)$/)
      if (reserved) {
        if (reserved[1] === 'at') cur.at = Number(reserved[2].trim())
        else if (reserved[1] === 'say') cur.say = reserved[2].trim()
        else if (reserved[1] === 'meow') cur.meow = reserved[2].trim()
        else cur.pose = reserved[2].trim()
        continue
      }
      // ③ 变量（等号形式）
      const v = t.match(/^([^:=]+?)\s*=\s*(.*)$/)
      if (v) {
        cur.vars.push({ name: v[1].trim(), value: v[2].trim() })
        continue
      }
    }
    /*
     * ④ 到这里说明这行谁都不认。
     * **这里故意什么都不做**，不抛异常 —— 正文里一行坏数据不该让整页白屏。
     * 但「没验过」不能伪装成「验过了」：这一行的归宿是
     * `scripts/content-validate.mjs` 的 `checkDemoBlock`，它会把同一行**报成错误**，
     * 让 `npm run validate:content` 红掉、内容进不了产包。
     * 所以这里丢掉的不是「校验」，是「崩溃」。
     */
  }
  closeStep()

  return { title, code, steps }
}

/** 认出正文里的 demo 围栏。**和 compare 同样的规矩：判据交给 markdown-it 的 token。** */
function isDemoFence(info: string): boolean {
  /*
   * ⚠️ 要求**整串就等于 `demo`**，不认 `demo <别的词>`。
   * 写成 `split(/\s+/)[0] === 'demo'` 的话，```` ```demo stack ````
   * 会被当成 demo 块渲染，而那个 `stack` 想表达的「换一种画法」被**静静吃掉** ——
   * 作者以为自己在指定画法，屏幕上却是默认那种，两边都不报错。
   * 现在它不匹配，就落回普通代码块路径，正文里会明晃晃出现一个语言名是 `demo` 的代码块；
   * 校验器同时也会报错（见 content-validate 的 checkDemoBlock）。
   */
  return (info || '').trim() === 'demo'
}

/** 把一课正文里的 demo 块**按出现顺序**收集出来（用于 `lesson.demo` 这种跨课引用） */
export function collectDemo(body: string): DemoBlock[] {
  const out: DemoBlock[] = []
  for (const t of md.parse(body, {})) {
    if (t.type === 'fence' && isDemoFence(t.info)) out.push(parseDemo(t.content))
  }
  return out
}

// ---------------------------------------------------------------- 可运行代码块提取

/**
 * 一课正文里**能整套跑起来**的那段代码 —— 课文页「▶ 运行代码」送进练习场的就是它。
 *
 * 【为什么不是「第一段带标签的代码」】
 * 课文里第一段带标签的代码常常是**片段**：`int fish = 3;`、单独一个
 * `struct Cat { … };`、只有两行 `#include`。它们摆在教学上下文里没问题，
 * 但原样送进练习场，屏幕上是「undefined reference to `main`」或者编译错误 ——
 * 学员的第一反应是「这应用给我发了段坏代码」。所以判据是**这一段像不像
 * 一个完整程序**，而不是它排在第几。（全仓库 229 课实测：c/cpp/java
 * 每课都至少有一个入口点块，python 任意块都可执行 —— 这条规则在现有
 * 内容上永远命中；17 课的第一块会被跳过、选到后面完整的那个。）
 *
 * 【每门语言的「完整」长什么样】
 * - c / cpp：代码里有 `main(`（入口函数）
 * - java  ：有 `static void main`（入口方法；类声明由代码本身带）
 * - python：顶到底都能执行，第一块就算数
 *
 * 一块都没有时返回 null —— 调用方给一条如实的提示，**绝不退而求其次送片段**：
 * 那等于把「我们挑错了」伪装成「你的代码坏了」（见 LessonDetailView.runCode）。
 */
export interface RunnableBlock {
  lang: LangOfCode
  /** 已去掉块尾多余的空白；块内缩进原样保留 */
  code: string
}

/** 这一段像不像一个能独立运行的程序 */
function looksComplete(lang: LangOfCode, code: string): boolean {
  if (lang === 'c' || lang === 'cpp') return /\bmain\s*\(/.test(code)
  if (lang === 'java') return /static\s+void\s+main\s*\(/.test(code)
  return true
}

export function firstRunnableBlock(body: string): RunnableBlock | null {
  for (const t of md.parse(body, {})) {
    if (t.type !== 'fence') continue
    // 和渲染规则同一个切法（`info` 的第一个词才是语言名）；```compare / ```demo
    // 因此天然不命中，不必另列排除名单。
    const tag = (t.info || '').trim().split(/\s+/)[0].toLowerCase()
    const lang = LANG_OF_CODE.find((l) => l === tag)
    if (!lang) continue
    if (looksComplete(lang, t.content)) return { lang, code: t.content.replace(/\s+$/, '') }
  }
  return null
}

// ---------------------------------------------------------------- md 实例

const md = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  breaks: false
})

/** 代码块围栏：hljs 高亮 + 复制按钮（点击由详情页事件委托处理） */
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const lang = (token.info || '').trim().split(/\s+/)[0]

  /*
   * compare 围栏：**不产出静态 HTML**，只留一个占位元素，并把解析好的结构
   * 挂到调用方传进来的 `env` 上（`renderMarkdown` 里那个数组）。
   *
   * 【env 不见了怎么办】
   * 有人直接 `md.render(正文)` 而没传收集器 —— 那就**照样输出占位元素**，
   * 一个都不产出。退回旧的"整块消失"是不行的：那会让"忘了传 env"
   * 表现成"对比块凭空没了"，而学员看到的是一句悬空的话 + 空白。
   * 现在这种调用会看到一个明晃晃的空 div，一眼就知道是接线漏了。
   */
  if (isCompareFence(token.info)) {
    // 注意别写 `lang === 'compare'` 就完事：`isCompareFence` 是提取和渲染
    // **共用**的那个判据，这里再手写一遍就又把判据变成两处了。
    const bag = env as { compareBlocks?: CompareBlock[] }
    const i = bag.compareBlocks ? bag.compareBlocks.push(parseCompare(token.content)) - 1 : 0
    return slotTag('compare', i)
  }

  /*
   * demo 围栏：和 compare 一模一样的待遇 —— 不产出静态 HTML，只在**原位**留一个
   * 占位元素，结构数据挂到 `env.demoBlocks` 上，详情页再把 `<DemoPlayer>` 插回去。
   * 「忘了传 env」的后果和 compare 那条注释里写的一样：留下一个明晃晃的空 div，
   * 一眼就知道是接线漏了，而不是「演示块凭空没了」。
   */
  if (isDemoFence(token.info)) {
    const bag = env as { demoBlocks?: DemoBlock[] }
    const i = bag.demoBlocks ? bag.demoBlocks.push(parseDemo(token.content)) - 1 : 0
    return slotTag('demo', i)
  }

  let highlighted = ''
  if (lang && hljs.getLanguage(lang)) {
    try {
      highlighted = hljs.highlight(token.content, { language: lang, ignoreIllegals: true }).value
    } catch {
      highlighted = ''
    }
  }
  const body = highlighted || md.utils.escapeHtml(token.content)
  const label = highlighted ? md.utils.escapeHtml(lang) : 'text'
  return (
    `<pre class="code-block"><div class="code-head">` +
    `<span class="code-lang">${label}</span>` +
    `<button class="code-copy" data-copy type="button">${CODE_BLOCK.COPY}</button></div>` +
    `<code class="hljs">${body}</code></pre>`
  )
}

/** 链接：lesson:// 内部跳转、http 外开（target=_blank 触发 main 的 setWindowOpenHandler）。
 * 注：markdown-it 15 无 link_open 默认规则，回退用 self.renderToken（通用标签渲染）。 */
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const href = String(token.attrGet('href') ?? '')
  if (href.startsWith('lesson://')) {
    token.attrSet('data-lesson', href.slice('lesson://'.length))
    token.attrSet('href', '#')
  } else if (/^https?:\/\//i.test(href)) {
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer')
  }
  return self.renderToken(tokens, idx, options)
}

/** 提示容器工厂：::: tip / ::: warn */
function admonition(kind: 'tip' | 'warn', icon: string, fallbackTitle: string) {
  return {
    validate: (params: string) => params.trim().split(/\s+/)[0] === kind,
    render: (tokens: { nesting: number; info: string }[], idx: number) => {
      const t = tokens[idx]
      if (t.nesting === 1) {
        const title = t.info.trim().replace(new RegExp(`^${kind}\\s*`), '') || fallbackTitle
        return (
          `<div class="mi-admonition mi-${kind}">` +
          `<div class="mi-admonition-title">${icon} ${md.utils.escapeHtml(title)}</div>\n`
        )
      }
      return '</div>\n'
    }
  }
}
md.use(container, 'tip', admonition('tip', ADMONITION.TIP_ICON, ADMONITION.TIP_TITLE))
md.use(container, 'warn', admonition('warn', ADMONITION.WARN_ICON, ADMONITION.WARN_TITLE))

/**
 * 渲染一课正文：返回 HTML + 提取出的对比块与演示块。
 *
 * HTML 里**在两种块原来的位置**各留了一个占位元素（`.compare-slot` / `.demo-slot`）——
 * 详情页拿 `splitSlots()` 切开，把 `CompareGrid` / `DemoPlayer` 插回原位。
 */
export function renderMarkdown(body: string): {
  html: string
  compareBlocks: CompareBlock[]
  demoBlocks: DemoBlock[]
} {
  const compareBlocks: CompareBlock[] = []
  const demoBlocks: DemoBlock[] = []
  const html = md.render(body, { compareBlocks, demoBlocks })
  return { html, compareBlocks, demoBlocks }
}

/** 单段代码高亮（练习题代码阅读等场景复用）；未知语言安全转义 */
export function highlightCode(code: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    } catch {
      /* 高亮失败按纯文本 */
    }
  }
  return md.utils.escapeHtml(code)
}
