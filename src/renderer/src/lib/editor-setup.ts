/**
 * 代码编辑器的**配置层**：用什么语法、长什么样、有哪些公共能力，
 * 外加两条「组件里那点薄逻辑」的纯函数版（内容替换、焦点归还）。
 *
 * 【为什么和 CodeEditor.vue 分开】
 * 本项目的单测跑在纯 node 环境（无 DOM），而挂载 `EditorView` 必须有 DOM。
 * 把配置抽出来，语法映射和配色就能被机器验证；组件本身只剩
 * 「挂载 + 把改动同步回 v-model」这点薄逻辑，看一遍就不会错。
 *
 * 【配色与正文代码块的关系】
 * 这里定的色值应当与 `styles/md.css` 里课文代码块的 hljs 配色保持一致——
 * 用户在课文里看到的蓝绿紫，进了练习场还是那套颜色，认知不用重新建立。
 * （M3-01 的遗留问题已经补完，md.css 现在有 hljs 配色了，两边是同一套值，
 *   由 code-color.test.ts 直接 import 下面那份清单来盯着，见该文件。）
 */

import type { Extension } from '@codemirror/state'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightTrailingWhitespace,
  keymap,
  lineNumbers,
  rectangularSelection
} from '@codemirror/view'
import { HighlightStyle, bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { tags } from '@lezer/highlight'
import { cpp } from '@codemirror/lang-cpp'
import { java } from '@codemirror/lang-java'
import { python } from '@codemirror/lang-python'
import { LANG_OF_CODE } from '../../../shared/types'
import type { LangOfCode } from '../../../shared/types'

// ──────────────────────────────────────────────────────────── 语法

/**
 * 编辑器支持的语言，直接引用 shared 的那份唯一真源。
 *
 * 这里**故意不再自己写一遍**。以前是手写的四个字符串，靠一条单测
 * 盯着它和 LANG_DISPLAY 对得上；但「两份列表 + 一条测试」不如
 * 「一份列表」可靠——测试会在 CI 里抓到漂移，却拦不住有人在本地
 * 图省事只改一处。引用过来，漂移这件事从源头就不存在了。
 * （真正的风险仍是「语言加了但没配语法」，那由 languageExtension 的
 * never 穷尽检查兜着，漏了直接编译不过。）
 */
export const EDITOR_LANGS: readonly LangOfCode[] = LANG_OF_CODE

/** 语言 → CodeMirror 语法扩展 */
export function languageExtension(lang: LangOfCode): Extension {
  switch (lang) {
    // 没有独立的 C 语法包（@codemirror/lang-cpp 只导出 cpp）。
    // 不影响使用：C 是 C++ 的子集，关键字、注释、字符串的着色完全一致。
    case 'c':
    case 'cpp':
      return cpp()
    case 'java':
      return java()
    case 'python':
      return python()
    default: {
      // 穷尽性检查：LangOfCode 加了新语言而这里没跟上，编译期就会红。
      // 消息用英文——这是给开发者看的崩溃信息，不是面向用户的文案（同 main 进程惯例）。
      const never: never = lang
      throw new Error(`no syntax highlighting configured for lang: ${String(never)}`)
    }
  }
}

// ──────────────────────────────────────────────────────────── 编辑体验

/**
 * 与语言无关的固定扩展。**不含语法扩展**——语法要能中途换，
 * 由组件用 `Compartment` 单独装，换语言时不必重建整个编辑器
 * （重建会丢掉撤销历史，用户刚写的代码一换语言就撤不回来了）。
 *
 * @param onDocChanged 文档变化回调。只在**用户真的敲了东西**时触发，
 *                     程序自己改内容（如载入示例代码）不会回调——
 *                     不这么分，双向绑定会自己咬自己尾巴，陷入死循环。
 */
export function baseEditorExtensions(onDocChanged: (doc: string) => void): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    // 折叠功能对初学长代码有用，但默认收起会让人以为「代码不见了」，只留箭头
    foldGutter({ openText: '▾', closedText: '▸' }),
    history(),
    // cursorBlinkRate 是**唯一**能改插入符呼吸快慢的地方，见 miEditorThemeSpec
    // 里 `.cm-cursorLayer` 那段注释：CodeMirror 用**内联样式**写 animation-duration，
    // 主题里再写一遍是白写（内联赢过一切样式表规则）。
    // 1500ms 比默认的 1200ms 稍慢一点，「呼吸」才读得出来；再慢就不像提示了。
    drawSelection({ cursorBlinkRate: 1500 }),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    // 自动补右括号。零基础用户忘写 `}` 是第一大错，补上能省掉大量挫败感。
    // CodeMirror 自带「再打一次右括号就跳过」的处理，不会写出 `}}`。
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    // 行尾多余空格看不见，但交作业时会被打回，标出来
    highlightTrailingWhitespace(),
    // 长行折行显示。不折的话，一行长代码会顶出一条横向滚动条，
    // 新手根本想不到要往右拖，只会觉得「后面被截掉了」。
    EditorView.lineWrapping,
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      indentWithTab
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onDocChanged(u.state.doc.toString())
    })
  ]
}

// ──────────────────────────────────────────────────────────── 外部改内容

/** CodeMirror 的替换指令：把 `[from, to)` 换成 `insert` */
export interface DocChange {
  from: number
  to: number
  insert: string
}

/**
 * 把「旧文本 → 新文本」算成**尽量小的一次替换**，而不是整篇重写。
 *
 * 【为什么不能整篇重写 —— 2026-09-13 主人报的「光标乱跳」】
 * CodeMirror 对每次替换都会把**光标和选区按位置映射**过去，落点取决于
 * 光标落在替换段的哪个位置。整篇重写（from:0, to:全文）时实测结果：
 *
 *   光标在文首      0   → 0    （碰巧没事，看不出来）
 *   光标在**文档中间** 9   → **0**  ← 被甩回文首，这就是「跳」
 *   光标在文末      35  → 35   （碰巧没事：位置正好等于 to）
 *   选区 0..9          → 塌缩成 0        （选区整个没了）
 *   选区 20..32        → 变成「文末→文首」的反向选区
 *
 * 规律是「位置 ≥ to 的才活得下来」。而人写代码时光标**绝大多数时候在
 * 文档中间**（正在敲的那一行），所以这一跳是常态、不是偶发。
 * 换成最小替换后，只有真正变了的那一小段会被动，光标只要不在那一段里
 * 就原地不动（在里面也会被合理地推到改动之后，不会乱飞）。
 * （上面那张表是实测的，钉在 editor-setup.test.ts 的「最小替换」那组里，
 *   改这里之前先去跑一遍那组测试。）
 *
 * 实现就是最朴素的「掐掉公共前缀和公共后缀」——不需要真正的 diff：
 * 我们只要求「没变的别动」，不需要「改动最少」，前缀后缀足够覆盖
 * 实际会遇到的场景（补一个字符、改一行、尾部追加）。
 */
export function minimalChange(oldText: string, newText: string): DocChange {
  const oldLen = oldText.length
  const newLen = newText.length

  // 公共前缀
  let prefix = 0
  const maxPrefix = Math.min(oldLen, newLen)
  while (prefix < maxPrefix && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix++

  // 公共后缀（不能伸进前缀里，否则两边会重叠着数同一段）
  let suffix = 0
  const maxSuffix = Math.min(oldLen, newLen) - prefix
  while (suffix < maxSuffix && oldText.charCodeAt(oldLen - 1 - suffix) === newText.charCodeAt(newLen - 1 - suffix)) {
    suffix++
  }

  // 别把 emoji 这类字符从中间切开：CodeMirror 的位置是 UTF-16 码元，
  // 切在高低代理之间会把它拆成两个半个字符（显示成乱码方块）。
  // 代价只是改动段多含一个字符，不心疼。
  if (prefix > 0 && isLowSurrogate(newText.charCodeAt(prefix))) prefix--
  if (suffix > 0 && isHighSurrogate(oldText.charCodeAt(oldLen - suffix))) suffix--

  return { from: prefix, to: oldLen - suffix, insert: newText.slice(prefix, newLen - suffix) }
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

// ──────────────────────────────────────────────────────────── 焦点

/** 用户此刻正把光标放在哪儿 —— 从 document.activeElement 上取下来的那两个字段 */
export interface ActiveTarget {
  /** 标签名，大写，如 `BODY` / `INPUT` / `BUTTON`。取不到时传空串 */
  tagName: string
  /** 是不是一个可编辑区域（contenteditable） */
  editable: boolean
}

/**
 * 跑完了，该不该把焦点**抢**回编辑器？
 *
 * 【为什么需要这条规则 —— 2026-09-13 已确认的真实缺陷】
 * 点「运行」后编译器会把编辑器整个切成只读（contentEditable 从 true 变 false），
 * 浏览器在这一刻会把焦点踢出去，落在 `<body>` 上。跑完解锁时焦点**不会自动回来**，
 * 于是主人跑完代码顺手按 Ctrl+A，CodeMirror 根本收不到键盘事件 ——
 * 表现就是「全选没反应」。所以要主动还回去。
 *
 * 【为什么不能无条件抢】
 * 跑得快的时候（比如 Hello World 几毫秒就跑完），主人可能已经点进了输入框
 * 在敲这次的输入，或者点进了设置页的文本框。这时候把焦点抢走，是**在人家
 * 打字打到一半时把光标抽走**——比不还焦点还恶劣。所以规则是：
 * 只有当焦点**没落在任何一个能打字的地方**时才还。
 *
 * 注意 `editable` 那条同样重要：编辑器自己要是还留着焦点（CodeMirror 有时候
 * 不会丢），再 focus() 一次会把用户刚拖出来的选区给清掉。
 */
export function shouldRestoreFocus(active: ActiveTarget | null): boolean {
  if (!active) return true
  // 原生输入控件：用户在打字，别碰
  if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT') return false
  // 任何 contenteditable（含编辑器自己）：用户已经在一个可编辑的地方了，别动
  if (active.editable) return false
  return true
}

// ──────────────────────────────────────────────────────────── 外观

/**
 * 主题的样式表本体。单独导出**只为可测**——
 * `EditorView.theme()` 的返回值是个不透明对象，单测没法检查里面写了什么，
 * 而「`.cm-content` 必须把 user-select 改回 text」这种事一旦漏掉，
 * 表现是「编辑器里选不中字、复制粘贴全废」，不报错、要人来点才发现。
 */
/**
 * 输入光标（那条竖线）的图案 —— **一条小鱼干**。
 *
 * 【为什么必须是图片，不能只改颜色】
 * 编辑器开了 `drawSelection()`（见 `baseEditorExtensions`），这意味着插入符
 * **不是浏览器的原生插入符**，而是 CodeMirror 自己画的一个 `<div class="cm-cursor">`
 * ——一个 1-2px 宽、高度等于行高的空盒子，靠左边框装成一条竖线。
 * 所以「把竖线换成小鱼干」在这条路上是**换掉那个盒子的背景图**，
 * 而不是去动 `caret-color`（那东西只对原生插入符有效，在这儿一点用都没有）。
 * 同理，在 `.cm-content` 上写 `cursor: url(...)` 改的是**鼠标指针**，不是插入符。
 *
 * 【尺寸是怎么定的 —— 这一条决定了它好不好用】
 * 竖线只有 2px，覆盖不住字；小鱼干是一个**实心图形**，画大了就会挡住后面的字。
 * 等宽字体 13px 时一个字符宽约 7.8px，所以这里的整个盒子**只有 8px 宽**：
 *   宽 8px，marginLeft -4px → 盒子精确骑在字符边界上，左右各占 4px
 *   背景 `auto 78%` → 行高 22px 时鱼高约 17px，按 12:32 的长宽比推出宽约 6.4px
 * 6.4px 比一个字符（7.8px）还窄一点，于是**它最多只盖住半个字**，
 * 且只在光标正好停在某个字符上时。这是「醒目」与「不挡字」之间取的那个点。
 *
 * 【为什么形状是「上圆下尖 + 分叉尾」】
 * 6.4×17 这个尺寸上，眼睛、鳞片、鳃线**全都画不出来**（一渲染就糊成一团）。
 * 能读出来的只剩轮廓，而鱼的轮廓里辨识度最高的两件事是：
 *   1. 身子**上面圆（头）下面收窄**（尾柄），不是两头尖的叶子
 *   2. **分叉的尾巴** —— 这一条最关键，一个 V 字就能让人认出是鱼
 * 所以这里把细节全省了，只留这两条。颜色用暖橙 + 深棕描边：
 * 编辑器的底是白色/浅蓝（当前行），橙色正好是对比色，比原来的蓝竖线显眼得多，
 * 又不刺眼。描边是必须的 —— 白底上纯橙的对比度只有 1.9:1，没有描边会糊掉。
 *
 * ⚠️ 改这个常量时，**长宽比不要动**（12:32）：上面的尺寸推导是照它算的，
 *    改了比例，鱼要么挡字要么细得看不清。
 *
 * 【夜间模式为什么不换一条鱼】2026-09-20 算过：橙色 #f2a750 压在深色底
 * （--mi-bg #232c38）上是 **6.97:1**，比浅色底上还显眼。
 * 浅色底上「显眼」靠的是深棕描边（纯橙压白只有 1.9:1，会糊），
 * 深色底上靠的是填充本身 —— **两条路都通，所以不需要第二份常量**。
 * （多一份就多一处会走散的真源，能不拆就不拆。）
 */
export const MI_CARET_FISH =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 32' width='12' height='32'%3E%3Cg fill='%23f2a750' stroke='%238a5a25' stroke-width='1.7' stroke-linejoin='round'%3E%3Cpath d='M6 1.5C9.8 4.5 10.8 8 10.5 12 10.2 16.5 8.6 19.5 7.2 21L4.8 21C3.4 19.5 1.8 16.5 1.5 12 1.2 8 2.2 4.5 6 1.5Z'/%3E%3Cpath d='M4.8 21L10.5 30.5 6 27.5 1.5 30.5 7.2 21Z' fill='%23e8943a'/%3E%3C/g%3E%3C/svg%3E")` as const

export const miEditorThemeSpec = {
  '&': {
    height: '100%',
    fontSize: '13px',
    fontFamily: 'var(--mi-code)',
    color: 'var(--mi-text)',
    backgroundColor: 'var(--mi-bg)'
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mi-code)', lineHeight: '1.7', overflow: 'auto' },
  '.cm-content': {
    padding: '10px 0',
    // ⚠️ tokens.css 给 body 设了 user-select:none（防止界面文字被误选），
    // 不在这里改回来的话，编辑器里的代码**一个字都选不中**——复制粘贴全废。
    userSelect: 'text',
    WebkitUserSelect: 'text'
  },
  '.cm-gutters': {
    backgroundColor: 'var(--mi-card)',
    color: 'var(--mi-text-3)',
    border: 'none',
    borderRight: '1px solid var(--mi-border)'
  },
  '.cm-activeLine': { backgroundColor: 'var(--mi-blue-light)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--mi-blue-light)', color: 'var(--mi-text-2)' },
  /*
   * 插入符 = 小鱼干。见上面 MI_CARET_FISH 那段（尺寸怎么算的、为什么是这个形状）。
   *
   * `border: 'none'` 是**必须**的：CodeMirror 的基础主题给这两个类设了
   * `border-left: 1.2px solid black`，不显式清掉的话，小鱼干（背景图）下面
   * 会**还压着一条黑竖线**，看起来像鱼被一条线劈开了。
   *
   * `.cm-dropCursor` 是拖拽文本时跟着鼠标的那个指示器，一起换掉：
   * 它和插入符是同一类东西（"你松手会落在这里"），两处不一样会很突兀。
   */
  '.cm-cursor, .cm-dropCursor': {
    border: 'none',
    width: '8px',
    marginLeft: '-4px',
    backgroundImage: MI_CARET_FISH,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center',
    backgroundSize: 'auto 78%'
  },
  /**
   * 插入符的**闪烁方式**：把 CodeMirror 默认的"硬切闪灭"换成"呼吸"。
   *
   * 【为什么必须改，不改会怎样】
   * 基础主题给 `.cm-cursorLayer` 挂的是
   *     animation: cm-blink 1.2s steps(1) infinite
   * 而 `cm-blink` 的关键帧**只有一条**：`50% { opacity: 0 }`。
   * `steps(1)` 意味着**没有过渡，直接跳**——于是前 0.6 秒鱼在，后 0.6 秒
   * 鱼**完全消失**，如此往复。
   *
   * 这个行为配一条 2px 的竖线是好的（全世界编辑器都这么闪，没人会注意），
   * 但**配一条实心的鱼不行**：它不是"线条不闪了"，而是"那个东西凭空没了又出现"。
   * 对着屏幕看就是有个东西在 0.6 秒的节拍上跳，像界面在抖。
   * 目标用户是零基础学员，这种抖动会被读成"坏了"。
   *
   * 【改成什么样】
   * 用 `ease-in-out` 在 1 和 0.4 之间来回，鱼**始终可见**，只是明暗在动。
   *   - 下限取 0.4 而不是 0：鱼一直在，就不会有"消失了"的错觉；
   *   - 下限也不再低（比如 0.1）：那又变回闪了，只是软一点的闪；
   *   - 上限是 1 而不是更亮：白底上橙色本来就够显眼，没必要加。
   * **周期不在这里定**（见下面第三条 ⚠️），走 `drawSelection({ cursorBlinkRate })`，
   * 目前是 1500ms —— 比默认的 1200ms 稍慢一点，"呼吸"才读得出来。
   *
   * 【聚焦状态还有别的提示吗】
   * 有，而且这是敢把下限抬到 0.4 的原因：聚焦时当前行会整行高亮
   * （`.cm-activeLine`），"我点进来了没有"这件事不靠插入符闪不闪来判断。
   *
   * ⚠️ 动画挂在 `.cm-cursorLayer`（层）上，不是 `.cm-cursor`（元素）上——
   *    这是 CodeMirror 的原始做法，照抄它。挂层上意味着将来出现多光标时
   *    几个光标**同步**呼吸；挂元素上会各闪各的，看起来像坏了。
   *
   * ⚠️ `@keyframes` 写在主题里是 `style-mod` 的能力，不是 CSS 原生语法。
   *    改完必须**实测**生成出来的样式表里真有这条关键帧（`_verify-feel.mjs`
   *    的 caret 那一段会顺带查），别只看这里的源码就以为生效了。
   *
   * ⚠️⚠️ **下面这个选择器不能简化成 `.cm-cursorLayer`。**
   *    基础主题里那条规则是
   *        .ͼ1.cm-focused > .cm-scroller > .cm-cursorLayer { animation: cm-blink … }
   *    —— **四个类**的特异性。而 `EditorView.theme()` 给每个选择器只加**一个**
   *    作用域类，所以 `.cm-cursorLayer` 生成出来是 `.ͼo .cm-cursorLayer`，**两个类**。
   *    两条规则都匹配到同一个元素，基础主题靠特异性赢了，覆盖**静默失效**——
   *    没有报错、没有警告，页面照跑，只有你去量 `getComputedStyle().animationName`
   *    才发现还是 `cm-blink`。
   *    （这个坑我实地踩过一次：关键帧生成得好好的，动画就是不生效。）
   *
   *    所以这里**照抄基础主题的选择器形状**，凑齐同样的四个类。平特异性下
   *    后注入的赢，而编辑器主题总是注入在 baseTheme 之后。顺带这样也只在
   *    **聚焦时**呼吸——和基础行为一致：未聚焦时插入符常亮，不闪。
   *
   * ⚠️⚠️ **这一条里绝对不能写 `animation` 简写，也不能写 `animation-duration`。**
   *    `drawSelection()` 会给这个层打一条**内联样式**：
   *        z-index: 150; animation-duration: 1500ms;
   *    内联样式赢过**一切**不带 `!important` 的样式表规则，跟特异性无关。
   *    所以在这里写 duration 是**白写**：不报错、不警告，`getComputedStyle()`
   *    会平静地给出内联那个值，和"本来就没写"完全同形。
   *
   *    更阴的是**简写会把它重置成 0s**（`animation-duration` 的初始值是 0s，
   *    简写会把省略的 longhand 一并重置）——于是动画**整条不跑**，鱼一动不动。
   *    实测踩过：`animation: 'mi-caret-breathe 1.6s ease-in-out infinite'`
   *    的结果是 name/timing 都换成了我的，唯独 duration 还是 1.2s（内联的），
   *    比"全没生效"和"全生效"都难判断。
   *
   *    所以这里**只用三个长写属性**，把 duration 整个让给 `cursorBlinkRate`。
   *    想调快慢：改 `baseEditorExtensions` 里那个数字，别来这里找。
   */
  '&.cm-focused > .cm-scroller > .cm-cursorLayer': {
    animationName: 'mi-caret-breathe',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite'
  },
  '@keyframes mi-caret-breathe': {
    '0%, 100%': { opacity: '1' },
    '50%': { opacity: '0.4' }
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--mi-blue)'
  },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--mi-blue-light)',
    outline: '1px solid var(--mi-blue-deep)'
  },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--mi-blue-light)', border: 'none', color: 'var(--mi-text-2)' }
} as const

/**
 * 主题名。**和 tokens.css 的 `:root[data-theme='dark']` 是同一个字面量**，
 * 拼错一个字母就是「编辑器变了、界面没变」（或者反过来）。
 */
export type MiThemeName = 'light' | 'dark'

/**
 * 编辑器主题。色值一律走 tokens.css 的 CSS 变量，改配色只改令牌。
 *
 * 【为什么深色下这份 spec 一个字都不用改】
 * 它里面的颜色**全部**是 `var(--mi-xxx)`，没有一个字面量（有一条单测钉着这件事）。
 * 令牌一翻，编辑器里的底、字、行号、当前行高亮全跟着翻，不需要第二份 spec。
 * 唯一随主题变的是下面那个 `dark` 标志位 —— 那不是说「配色是深是浅」
 * （配色由令牌决定），而是告诉 CodeMirror 它的内部绘制该按深色走：
 * 选区反白的方向、`&dark` 那套内置规则、`drawSelection` 的图层合成都看它。
 * 给错了会得到一个「配色对了、但选中文本看不出来」的编辑器。
 */
export const miEditorTheme = (theme: MiThemeName): Extension =>
  EditorView.theme(miEditorThemeSpec, { dark: theme === 'dark' })

/**
 * 语法着色。柔和、低饱和，与 docs/04「避免工业感、极客感」一致——
 * 高饱和的 IDE 默认配色（亮红亮绿）在浅蓝底上会显得刺眼。
 *
 * 写成 `[标签名, 色值]` 的扁平清单是为了可测：单测直接读这份数组做断言，
 * 而不是去正则扒 `HighlightStyle.define()` 的返回值（那玩意儿同样不透明）。
 *
 * ── 2026-09-14：整套往深里压了一档 ───────────────────────────────
 * 【为什么】原来这 8 个色是按**白底**挑的，压在代码块底 (--mi-code-bg #eaf1f9)
 * 上全都不达标：字符串 2.96、数字 2.55、注释 2.13、关键字 3.85……全在 4.5 线下。
 * 主人在验收时点了出来：「代码语法配色，既然对比度偏低，请一并统一修复。」
 *
 * 【怎么压的】**沿各自的色相往深里走，停在刚好过线的地方**——
 * 色相一个都没变，所以「紫的是关键字、绿的是字符串、橙的是数字」这套直觉
 * 原封不动，只是颜色深了一档。取色按**代码块底**算（一个语法色会压在
 * 代码块 / 编辑器白 / 当前行高亮三种底上，代码块那个最暗），过了它就全过。
 *
 * 唯一的例外是**运算符：它特意多深一档（按 6.0 取，其余按 4.5）**。
 * 原因很实际——注释和运算符原本是一深一浅两支灰（#9aa8b8 / #6b7a8c），
 * 可两条都压到 4.5 之后会**落到同一个明度上**（都是 L≈0.44、色相差 1°），
 * 那就成了同一个颜色，代码里「这是注释」和「这是加号」会分不出来。
 * 让运算符多深一档把这层关系恢复回来（方向也和改之前一致：注释比运算符浅）。
 *
 * 【怎么验】改完做过两件事：① 8 个色两两查「会不会撞」——判据是
 * **色相接近 且 明度接近 且 饱和度也接近**（三条同时成立才算撞；
 * 只看对比度是错的，那量的只是明暗差，紫和绿同明度照样一眼分得开）；
 * ② 在真窗口里把每一处的实测值读回来。取色脚本见 `<workspace>/_fix-colors.mjs`（不随仓库分发）。
 *
 * 【改配色时的连带改动】这份清单是**唯一真源**，md.css 和测试都跟着它走：
 * 色值改了这里，md.css 里那 8 组规则要同步（`npm test` 会红着提醒你），
 * 测试那份是 import 不是复印件。
 *
 * ── 2026-09-20：改成双主题（夜间模式）────────────────────────────
 * 【结构】每一项从 `color` 变成 `light` + `dark` 两个值。
 * **浅色那一列一个字节都没动** —— 这套值是 2026-09-14 逐个压出来的，
 * 有完整推导记录，动它等于把那次的工作重做一遍。
 *
 * 【深色那一列不是把浅色反过来】深紫 #8b47b5 压在深色代码块 (#0e131a) 上
 * 只有 **1.9:1**，不是「不好看」而是**根本不可读**。8 个色全部要重挑。
 * 手法和浅色那次一样、方向相反：**保持色相语义不变（紫=关键字、绿=字符串、
 * 橙=数字），把明度提到深底上够看的位置**。
 *
 * 【深色下「运算符特意深一档」这条换了方向，但判据没换】
 * 浅色里运算符 (#505b69) 比别的**深**一档，是为了和注释分开 ——
 * 两条一起压到 4.5 会落到同一个明度上，代码里「这是注释」和「这是加号」就分不出来。
 * 深色里它成了比别的**浅**的那一档，但同样收着点（6.85，没跟着正文冲到 11），
 * **判据一个字没变：和注释离得开。**
 */
export const MI_TOKEN_COLORS: readonly { tag: string; light: string; dark: string }[] = [
  // ── 浅色（2026-09-14 定稿，未改动）／深色（2026-09-20 新增）──
  // 浅色列注释里那个数字 = 压在代码块底 #eaf1f9 上的对比度；
  // 深色列的数字 = 压在深色代码块底 #0e131a 上的对比度。
  { tag: 'keyword', light: '#8b47b5', dark: '#c792ea' }, // 5.03 ／ 9.10
  { tag: 'string', light: '#257b54', dark: '#7fd6a3' }, // 4.57 ／ 8.09
  { tag: 'number', light: '#9a6024', dark: '#e5b567' }, // 4.51 ／ 7.48
  { tag: 'comment', light: '#5d6f84', dark: '#8b9cb3' }, // 4.53 ／ 5.04
  { tag: 'function', light: '#296fb6', dark: '#7cb4f5' }, // 4.54 ／ 6.52
  { tag: 'variableName', light: '#2d3a4a', dark: '#dde6f1' }, // 10.11 ／ 11.19
  { tag: 'typeName', light: '#0d797b', dark: '#5fd0d2' }, // 4.55 ／ 7.68
  { tag: 'propertyName', light: '#296fb6', dark: '#7cb4f5' }, // 与 function 同色（故意的）
  { tag: 'operator', light: '#505b69', dark: '#a9b6c6' }, // 6.07 ／ 6.85 —— 都特意和注释拉开
  { tag: 'meta', light: '#5d6f84', dark: '#8b9cb3' } // 与 comment 同色（#include 整条当注释看）
  // 浅色列压在编辑器「当前行高亮」#e6f1fd 上还要再低一点点（最狠 4.51），已经算进去了；
  // 深色列同理，压在 --mi-blue-light #1e2a3a 上最狠的是注释 4.62，也留了余量。
] as const

/** 标签名 + 主题 → 色值，供上面的清单和 HighlightStyle 共用，避免两处各写一遍 */
const colorOf = (name: string, theme: MiThemeName): string => {
  const hit = MI_TOKEN_COLORS.find((c) => c.tag === name)
  if (!hit) throw new Error(`unknown token color: ${name}`)
  return hit[theme]
}

export const miHighlightStyle = (theme: MiThemeName): Extension =>
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.keyword, color: colorOf('keyword', theme) },
      { tag: [tags.string, tags.special(tags.string)], color: colorOf('string', theme) },
      { tag: [tags.number, tags.bool, tags.null], color: colorOf('number', theme) },
      {
        tag: [tags.comment, tags.lineComment, tags.blockComment],
        color: colorOf('comment', theme),
        fontStyle: 'italic'
      },
      { tag: [tags.function(tags.variableName), tags.labelName], color: colorOf('function', theme) },
      { tag: [tags.definition(tags.variableName), tags.variableName], color: colorOf('variableName', theme) },
      { tag: [tags.typeName, tags.className, tags.namespace], color: colorOf('typeName', theme) },
      { tag: [tags.propertyName, tags.attributeName], color: colorOf('propertyName', theme) },
      { tag: [tags.operator, tags.punctuation, tags.bracket], color: colorOf('operator', theme) },
      { tag: tags.meta, color: colorOf('meta', theme) }
    ])
  )
