import { describe, expect, it } from 'vitest'
import {
  COMPARE_SLOT_CLASS,
  DEMO_SLOT_CLASS,
  collectCompare,
  collectDemo,
  firstRunnableBlock,
  parseCompare,
  parseDemo,
  renderMarkdown,
  splitSlots
} from '../md'

const COMPARE_BODY = `# 标题

前文。

\`\`\`compare
preamble line
c::
#include <stdio.h>
int main() { printf("hi"); return 0; }
python::
print("hi")
\`\`\`

后文。
`

describe('parseCompare 解析对比块', () => {
  it('按 lang:: 切分，忽略前导行', () => {
    const b = parseCompare('随便写的前导\nc::\ncode c\npython::\ncode py')
    expect(b.langs).toEqual(['c', 'python'])
    expect(b.code['c']).toBe('code c')
    expect(b.code['python']).toBe('code py')
  })

  it('没有代码段的语言被跳过', () => {
    const b = parseCompare('c::\n\ntext::\nsome\njava::\nx')
    expect(b.langs).toEqual(['text', 'java'])
  })
})

describe('collectCompare 收集（不渲染，给"引用了别的课"那条路用）', () => {
  it('按出现顺序收集，正文其余部分不受影响', () => {
    const blocks = collectCompare(COMPARE_BODY)
    expect(blocks.length).toBe(1)
    expect(blocks[0].langs).toEqual(['c', 'python'])
  })

  it('多个块按顺序收集', () => {
    const two = COMPARE_BODY + '\n```compare\njava::\nint x;\n```\n'
    const blocks = collectCompare(two)
    expect(blocks.length).toBe(2)
    expect(blocks[1].langs).toEqual(['java'])
  })

  it('无 compare 块时是空表', () => {
    expect(collectCompare('# 只有正文')).toEqual([])
  })

  /*
   * 【这条钉的是"判据只有一处"】
   * 上一版"找 compare 块"是拿正则扫源码，而"渲染"是 markdown-it 切 token ——
   * 同一件事两个判据。这条用一个**缩进了的**围栏把两者拉到一起：
   * 收集（走 token）和渲染（走 token）必须认出**同一个**块。
   */
  it('**收集和渲染认的是同一个块**（缩进/容器里的也算）', () => {
    const body = '::: tip 猫咪提示\n```compare\nc::\nint main(){}\n```\n:::\n'
    expect(collectCompare(body).length).toBe(1)
    const { html, compareBlocks } = renderMarkdown(body)
    expect(compareBlocks.length).toBe(1)
    expect(html).toContain(`class="${COMPARE_SLOT_CLASS}"`)
  })
})

/*
 * 这个 describe 原来叫 `splitCompareSlots`（只切对比块）。
 * 2026-09-19 加了演示块之后，两种块合并成**同一个切分器** `splitSlots` ——
 * 里面的用例一条没改，因为对「只有 compare 的正文」来说行为必须**逐字不变**。
 * 这条注释就是那个保证：下面这些断言全都还是针对老行为写的。
 */
describe('splitSlots 把两种活组件切回原位', () => {
  it('**占位元素落在课文提到它的那个位置**，不是文末', () => {
    const { html, compareBlocks } = renderMarkdown(COMPARE_BODY)
    expect(compareBlocks.length).toBe(1)
    const parts = splitSlots(html)
    expect(parts.map((p) => p.kind)).toEqual(['html', 'compare', 'html'])
    // 切缝**夹在**「前文。」和「后文。」中间 —— 这正是这个改动要做的事
    const first = parts[0]
    const last = parts[2]
    expect(first.kind === 'html' && first.html).toContain('前文。')
    expect(last.kind === 'html' && last.html).toContain('后文。')
    expect(last.kind === 'html' && last.html).not.toContain('前文。')
  })

  it('下标指回 `compareBlocks` 里对得上的那个', () => {
    const two = COMPARE_BODY + '\n```compare\njava::\nint x;\n```\n'
    const { html, compareBlocks } = renderMarkdown(two)
    const slots = splitSlots(html).filter((p) => p.kind === 'compare')
    expect(slots.map((p) => (p.kind === 'compare' ? p.index : -1))).toEqual([0, 1])
    for (const s of slots) {
      const i = s.kind === 'compare' ? s.index : -1
      expect(compareBlocks[i]).toBeDefined()
    }
  })

  it('没有对比块的正文 → 就一截，且不含占位元素（DOM 和改动前一样）', () => {
    const { html } = renderMarkdown('# 标题\n\n一段话。')
    expect(html).not.toContain(COMPARE_SLOT_CLASS)
    const parts = splitSlots(html)
    expect(parts.length).toBe(1)
    expect(parts[0]?.kind).toBe('html')
  })

  it('空 HTML → 空序列，不产出空壳片段', () => {
    expect(splitSlots('')).toEqual([])
  })

  it('对比块在开头 / 在结尾都不丢片段，也不多出空片段', () => {
    const atStart = renderMarkdown('```compare\nc::\nint a;\n```\n\n后面。')
    expect(splitSlots(atStart.html).map((p) => p.kind)).toEqual(['compare', 'html'])
    // 结尾这一条同时钉住「不产出只有换行的空段」：占位元素后面跟着一个 \n，
    // 收进来的话详情页就会多渲染一个空的 <article>
    const atEnd = renderMarkdown('前面。\n\n```compare\nc::\nint a;\n```')
    expect(splitSlots(atEnd.html).map((p) => p.kind)).toEqual(['html', 'compare'])
  })

  it('忘了传 env 也不会让块凭空消失（宁可是个空 div，不要是空白）', () => {
    // 直接调 md.render 而不带收集器 —— 这种调用应该看得见占位元素，
    // 于是"接线漏了"一眼可见，而不是表现成"对比块没了"
    const parts = splitSlots(renderMarkdown(COMPARE_BODY).html)
    expect(parts.some((p) => p.kind === 'compare')).toBe(true)
  })
})

describe('renderMarkdown 渲染', () => {
  it('提示容器渲染为 mi-admonition 卡片', () => {
    const { html } = renderMarkdown('::: tip 猫咪提示\n记住这个喵\n:::')
    expect(html).toContain('mi-admonition mi-tip')
    expect(html).toContain('💡 猫咪提示')
    const { html: warnHtml } = renderMarkdown('::: warn 小心喵\n别踩坑\n:::')
    expect(warnHtml).toContain('mi-admonition mi-warn')
    expect(warnHtml).toContain('⚠️ 小心喵')
  })

  it('代码块带 hljs 高亮与复制按钮', () => {
    const { html } = renderMarkdown('```python\nprint("hi")\n```')
    expect(html).toContain('class="code-block"')
    expect(html).toContain('data-copy')
    expect(html).toContain('<span class="hljs-string">')
  })

  it('未知语言按纯文本转义，不执行高亮', () => {
    const { html } = renderMarkdown('```brainfuck\n<>&\n```')
    expect(html).toContain('&lt;&gt;&amp;')
    expect(html).not.toContain('hljs-')
  })

  it('html:false —— 正文原始 HTML 被转义', () => {
    const { html } = renderMarkdown('小心 <script>alert(1)</script> 攻击')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('lesson:// 链接改写为 data-lesson + href="#"', () => {
    const { html } = renderMarkdown('看看[变量](lesson://common-02)这一课')
    expect(html).toContain('data-lesson="common-02"')
    expect(html).toContain('href="#"')
  })

  it('http 链接加 target=_blank（交给系统浏览器）', () => {
    const { html } = renderMarkdown('[官网](https://example.com)')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('表格正常渲染', () => {
    const { html } = renderMarkdown('| 名称 | 说法 |\n| --- | --- |\n| 变量 | 小鱼干仓库 |')
    expect(html).toContain('<table>')
    expect(html).toContain('小鱼干仓库')
  })

  it('compare 块被提取为结构数据而非静态 HTML（原地留占位元素）', () => {
    const { html, compareBlocks } = renderMarkdown(COMPARE_BODY)
    expect(compareBlocks.length).toBe(1)
    // 代码本身不进 HTML（要么交给组件渲染，要么被转义后当文本）
    expect(html).not.toContain('include &lt;stdio.h&gt;')
    expect(html).toContain(`class="${COMPARE_SLOT_CLASS}" data-compare-slot="0"`)
  })
})

// ---------------------------------------------------------------- demo 演示块

/**
 * 一份**完整合法**的演示块，下面好几条用它当基准。
 * 写法就是 `lib/md.ts` 里 `parseDemo` 文档注释的那一份，两边必须对得上 ——
 * 这里改了，那条注释也要改。
 */
const DEMO_BODY = `# 标题

前文。

\`\`\`demo
title: 循环的执行顺序
code:
| total = 0
| for i in range(3):
|     total = total + i
| print(total)

step 先清零
at: 1
say: 累加器从 0 开始。
meow: 喵～先把小鱼干摆好！
pose: expect
total = 0

step 第 1 轮 · 判断
at: 2
say: 0 < 3 成立，进循环体。
meow: 喵！叼回来一条小鱼干！
pose: yay
i = 0
total = 0
\`\`\`

后文。
`

describe('parseDemo 解析演示块', () => {
  it('标题、代码、步骤各归各位', () => {
    const b = parseDemo(`title: 我的演示
code:
| a = 1
| b = 2

step 第一步
at: 1
say: 讲第一句。
a = 1
`)
    expect(b.title).toBe('我的演示')
    expect(b.code).toEqual(['a = 1', 'b = 2'])
    expect(b.steps.length).toBe(1)
    expect(b.steps[0]).toMatchObject({ label: '第一步', at: 1, say: '讲第一句。' })
    expect(b.steps[0]?.vars).toEqual([{ name: 'a', value: '1' }])
  })

  it('**代码缩进原样保留**（去掉的只有 `|` 和它后面那一个空格）', () => {
    const b = parseDemo('code:\n| for i in range(3):\n|     print(i)\n|         deeper\n')
    // 4 空格缩进变成 4 个空格，不是 3 个、也不是被 trim 掉
    expect(b.code).toEqual(['for i in range(3):', '    print(i)', '        deeper'])
  })

  it('`|` 后面直接换行 = 一个空代码行（不是「块结束」）', () => {
    const b = parseDemo('code:\n| a\n|\n| b\n')
    expect(b.code).toEqual(['a', '', 'b'])
  })

  it('变量里的 `=`、值里的冒号都不会被切错', () => {
    const b = parseDemo('code:\n| x\n\nstep s\nat: 1\nsay: ok\nmsg = a=b\nurl = http://x\n')
    expect(b.steps[0]?.vars).toEqual([
      { name: 'msg', value: 'a=b' },
      { name: 'url', value: 'http://x' }
    ])
  })

  /*
   * 【这一条钉的是「`say` 不会被变量规则抢走」】
   * `say: 说 a = b` 里有一个 `=`。要是先拿等号规则去匹配，它会被解析成
   * 一个名叫 `say: 说 a` 的变量 —— 不报错、不缺东西，只是这一句讲解**不见了**，
   * 而每一步的讲解正是演示的全部意义。
   */
  it('`say` 里带等号时仍归 say，不会被当成变量', () => {
    const b = parseDemo('code:\n| x\n\nstep s\nat: 1\nsay: 说 total = 3\n')
    expect(b.steps[0]?.say).toBe('说 total = 3')
    expect(b.steps[0]?.vars).toEqual([])
  })

  /**
   * `meow:` —— 大肥鱼气泡里那句短话（2026-09-20 加）。
   *
   * 【为什么值得单独钉三条】
   *  ① 它和 `say` 一样是**冒号形式的保留字段**，要是匹配规则漏了它，
   *     就会落到下面那条等号规则上，被解析成一个名叫 `meow: 喵` 的**变量** ——
   *     不报错、不缺东西，只是气泡那句**不见了**，而且多出一个诡异的变量行。
   *  ② `meow` 里同样可能带等号（「叼回来 1 = 1 条」这种玩笑写法），
   *     同一个坑 `say` 踩过一次，这里必须一起钉住。
   *  ③ **不写 = 空串**，不是 `undefined`。播放器的 `hasMeow` 判据是
   *     `steps.some(s => s.meow)`，两种写法在 JS 里都能跑，
   *     但类型上 `meow: string` 说的是「一定有值，可能是空串」——
   *     留个 `undefined` 就是让类型撒谎，而它会一直瞒到某天有人写 `s.meow.length`。
   */
  it('`meow:` 归到这一步的气泡，不会漏成变量', () => {
    const b = parseDemo('code:\n| x\n\nstep s\nat: 1\nsay: 讲解\nmeow: 喵！叼回来一条小鱼干！\n')
    expect(b.steps[0]?.meow).toBe('喵！叼回来一条小鱼干！')
    expect(b.steps[0]?.say).toBe('讲解')
    expect(b.steps[0]?.vars).toEqual([])
  })

  it('`meow` 里带等号时仍归 meow，不会被当成变量', () => {
    const b = parseDemo('code:\n| x\n\nstep s\nat: 1\nsay: ok\nmeow: 叼回来 1 = 1 条\n')
    expect(b.steps[0]?.meow).toBe('叼回来 1 = 1 条')
    expect(b.steps[0]?.vars).toEqual([])
  })

  it('不写 `meow:` 就是空串（老课文不用改一个字）', () => {
    const b = parseDemo('code:\n| a\n\nstep s\nat: 1\nsay: x\n')
    expect(b.steps[0]?.meow).toBe('')
  })

  /**
   * `pose:` —— 这一步立绘摆什么姿势（2026-09-20 加）。
   *
   * 【为什么也要单独钉】
   * 和 `meow` 是同一个坑：它也是**冒号形式的保留字段**，
   * 匹配规则里漏了它，`pose: think` 就会落到等号规则上 ——
   * 注意这一行**没有等号**，所以等号规则也不认它，它会一路滑到那个「什么都不做」的
   * 兜底分支里被丢掉。那时立绘换姿势这件事**整个失效**，
   * 而课文、闸门、界面上一个提示都没有 —— 正是本项目最忌讳的「坏掉但没人告诉你」。
   *
   * 【`pose` 值这里不校验，是**有意**的】
   * 白名单住在 `mascot.ts`，闸门在 `content-validate.mjs`；
   * 这一层只负责「认出来并原样带出去」。在这里加一份姿态名清单就是第三个真源。
   */
  it('`pose:` 归到这一步的立绘，不会漏成变量', () => {
    const b = parseDemo('code:\n| x\n\nstep s\nat: 1\nsay: 讲解\npose: think\n')
    expect(b.steps[0]?.pose).toBe('think')
    expect(b.steps[0]?.say).toBe('讲解')
    expect(b.steps[0]?.vars).toEqual([])
  })

  it('不写 `pose:` 就是空串（由播放器回落到默认姿势）', () => {
    const b = parseDemo('code:\n| a\n\nstep s\nat: 1\nsay: x\n')
    expect(b.steps[0]?.pose).toBe('')
  })

  it('多个步骤按出现顺序（`step` 行本身不进 say，也不进代码）', () => {
    const b = parseDemo('code:\n| a\n\nstep 一\nat: 1\nsay: x\n\nstep 二\nat: 1\nsay: y\n')
    expect(b.steps.map((s) => s.label)).toEqual(['一', '二'])
  })

  it('没有 title 就是空串（播放器自己兜一句默认标题）', () => {
    expect(parseDemo('code:\n| a\n').title).toBe('')
  })

  /*
   * 【这一条钉的是「坏行不会让整页白屏」】
   * 正文里一行写错不该抛异常 —— 抛了的话详情页整个渲染不出来，学员看到的是一片空白，
   * 而真正该发生的是「校验器红掉、内容进不了产包」（见 content-validate 的 checkDemoBlock）。
   * 所以这里断言的是**不抛**，不是「解析正确」。
   */
  it('认不出来的行被跳过，不抛异常', () => {
    expect(() => parseDemo('code:\n| a\n\nstep s\nat: 1\nsay: x\n??? 这行谁都不认\n@#$%^\n')).not.toThrow()
  })
})

describe('demo 块：收集与渲染走同一个判据', () => {
  it('渲染成占位元素而非静态 HTML，代码本身不进 HTML', () => {
    const { html, demoBlocks } = renderMarkdown(DEMO_BODY)
    expect(demoBlocks.length).toBe(1)
    expect(html).not.toContain('total = total + i')
    expect(html).toContain(`class="${DEMO_SLOT_CLASS}" data-demo-slot="0"`)
  })

  it('**收集和渲染认的是同一个块**（藏进 ::: tip 容器里也算）', () => {
    const body = '::: tip 猫咪提示\n```demo\ncode:\n| a\n```\n:::\n'
    expect(collectDemo(body).length).toBe(1)
    const { html, demoBlocks } = renderMarkdown(body)
    expect(demoBlocks.length).toBe(1)
    expect(html).toContain(`class="${DEMO_SLOT_CLASS}"`)
  })

  it('无 demo 块时是空表', () => {
    expect(collectDemo('# 只有正文')).toEqual([])
  })

  /*
   * 【⚠️ 这一条钉的是「不认 `demo <别的词>`」】
   * 写成 `split(/\s+/)[0] === 'demo'` 的话，```` ```demo stack ````
   * 会被当成演示块渲染，而那个 `stack`（作者想指定的画法）被**静静吃掉**：
   * 作者以为自己在选画法，屏幕上却是默认那种，两边都不报错。
   * 现在它不算 demo 围栏，于是落回普通代码块路径 —— 正文里会明晃晃出现
   * 一个语言名是 `demo` 的代码块，一眼可见。（校验器也会同时报错。）
   */
  it('`demo stack` 不是演示块（多出来的词不会被静静吃掉）', () => {
    const { demoBlocks, html } = renderMarkdown('```demo stack\ncode:\n| a\n```')
    expect(demoBlocks.length).toBe(0)
    expect(html).not.toContain(DEMO_SLOT_CLASS)
    // 落回了普通代码块：语言名照原样显示出来，看得见
    expect(html).toContain('code-block')
  })

  /*
   * 【这一条钉的是「`pose:` 能活着走过 renderMarkdown」】
   * 上面那两条只管 `parseDemo`。而课文真正走的路径是
   * `renderMarkdown` → `env.demoBlocks` → 切槽位 → `<DemoPlayer>`。
   * 中间任何一环把 `pose` 吃掉（比如只搬 `label/at/say/meow/vars` 的字段白名单），
   * 表现都是「课文里写了、闸门也是绿的、屏幕上就是不变脸」——
   * 而**它会一直绿下去**，因为没有任何一层负责把「字段还在不在」喊出来。
   */
  it('`pose:` 一路活到 demoBlocks 里（不是只在 parseDemo 里对）', () => {
    const { demoBlocks } = renderMarkdown(DEMO_BODY)
    expect(demoBlocks[0]?.steps.map((s) => s.pose)).toEqual(['expect', 'yay'])
  })

  it('演示块切出来的片段不带多余空壳，且位置在课文中间', () => {
    const { html } = renderMarkdown(DEMO_BODY)
    const parts = splitSlots(html)
    expect(parts.map((p) => p.kind)).toEqual(['html', 'demo', 'html'])
    const first = parts[0]
    const last = parts[2]
    expect(first.kind === 'html' && first.html).toContain('前文。')
    expect(last.kind === 'html' && last.html).toContain('后文。')
    expect(last.kind === 'html' && last.html).not.toContain('前文。')
  })

  /*
   * 【这一条钉的是两种块**共用**一个切分器】
   * 同一篇正文里同时有对比块和演示块，切出来的顺序必须和它们在正文里出现的
   * 顺序完全一致、编号各自从 0 开始。这正是「一个切分器管两种槽位」要保证的事；
   * 要是有人日后给某一种块另写一个切分器，这条会红。
   */
  it('两种块混在同一篇里时，顺序和编号都不串', () => {
    const body = '甲。\n\n```demo\ncode:\n| a\n```\n\n乙。\n\n```compare\nc::\nint a;\n```\n\n丙。'
    const { html, compareBlocks, demoBlocks } = renderMarkdown(body)
    expect(compareBlocks.length).toBe(1)
    expect(demoBlocks.length).toBe(1)
    expect(splitSlots(html).map((p) => p.kind)).toEqual(['html', 'demo', 'html', 'compare', 'html'])
  })

  /*
   * 【这一条钉的是反向引用】
   * `SLOT_RE` 里的 `\1` 要求类名和属性名指向同一个 kind。
   * 没有它的话，`class="compare-slot" data-demo-slot="0"` 会被当成一个合法的
   * **compare** 槽位切出来 —— 而这样的标记谁也不会写，所以它一旦出现必是手工拼错的。
   */
  it('类名和属性名对不上的占位元素**不算**槽位', () => {
    const fake = '<div class="compare-slot" data-demo-slot="0"></div>'
    // 全篇只有这一个 div，切出来应当只有一截 html（占位元素被当成普通 HTML 留着）
    expect(splitSlots(fake).map((p) => p.kind)).toEqual(['html'])
  })
})

/*
 * 课文页「▶ 运行代码」挑哪一块 —— 判据是「像完整程序」，不是「排第一」。
 *
 * 【这一组在守什么】挑错的坏法是静默的：挑到片段（`int fish = 3;`）照样
 * 能送进练习场、照样跳页，只是运行结果是一串「undefined reference to `main`」——
 * 看起来像应用发了段坏代码，而真正错的是**我们挑错了块**。
 * 全仓库 229 课实测：c/cpp/java 每课都至少有一个入口点块；17 课的第一块
 * 会被跳过。下面用**缩写了的最小正文**把这 17 课的形状钉住。
 */
describe('firstRunnableBlock 挑「能整套跑」的代码块', () => {
  it('c：跳过前面的片段，选到带 main 的完整程序', () => {
    const body = '先看声明：\n\n```c\nint fish = 3;\n```\n\n完整程序：\n\n```c\n#include <stdio.h>\nint main(void) { return 0; }\n```\n'
    const b = firstRunnableBlock(body)
    expect(b?.lang).toBe('c')
    expect(b?.code).toContain('int main(void)')
    expect(b?.code).not.toContain('int fish = 3;')
  })

  it('java：片段不算数，选到带 static void main 的类', () => {
    const body = '```java\nint fish = 3;\n```\n\n```java\npublic class Main {\n    public static void main(String[] args) {}\n}\n```\n'
    const b = firstRunnableBlock(body)
    expect(b?.lang).toBe('java')
    expect(b?.code).toContain('public class Main')
  })

  it('python：顶到底都能执行，第一块就算数（哪怕不打印东西）', () => {
    const body = '```python\nfish = 3\n```\n\n```python\nfish = 3\nprint(fish)\n```\n'
    const b = firstRunnableBlock(body)
    expect(b?.lang).toBe('python')
    expect(b?.code).toBe('fish = 3')
  })

  it('跳过不能跑的标签：```text / ```compare / ```demo 都不算块', () => {
    // compare 里恰好有 `int main` —— 照样不许被选中（语言名不是那四个就不进候选）
    const body =
      '```text\n伪代码\n```\n\n```compare\nc::\nint main() { return 0; }\n```\n\n```demo\ncode:\n| int main() {}\n```\n'
    expect(firstRunnableBlock(body)).toBeNull()
  })

  it('多个入口块时取**最先出现的**那个', () => {
    const body = '```c\nint main() { puts("first"); return 0; }\n```\n\n```c\nint main() { puts("second"); return 0; }\n```\n'
    expect(firstRunnableBlock(body)?.code).toContain('first')
  })

  it('没有可跑块时给 null（调用方负责提示，绝不退而送片段）', () => {
    expect(firstRunnableBlock('# 只有正文，一段代码都没有')).toBeNull()
    expect(firstRunnableBlock('```c\nint fish = 3;\n```')).toBeNull()
  })

  it('代码内容保真：缩进原样，块尾空白去掉', () => {
    const body = '```python\nif fish:\n    print(fish)\n\n```\n'
    const b = firstRunnableBlock(body)
    expect(b?.code).toBe('if fish:\n    print(fish)')
  })
})
