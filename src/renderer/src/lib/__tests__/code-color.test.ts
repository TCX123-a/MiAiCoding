import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import hljs from 'highlight.js'
import { LANG_DISPLAY } from '../../../../shared/copy'
import { EDITOR_LANGS, MI_TOKEN_COLORS } from '../editor-setup'

/**
 * 课文代码块配色的闸门。
 *
 * 【为什么需要它】
 * 这段配色曾经**整段缺失**：代码块老老实实生成了 `class="hljs-keyword"` 这些名字，
 * 但全仓没有一条 CSS 给它们上色——课文里的代码一直是黑白的，而 M3-01 的验收
 * 只检查了「class 名生成了没」（见 md.test.ts），没人检查「有没有规则给它们上色」。
 * 一个不报错、不影响功能、只是「看着不对」的缺口，就这么躺了很久。
 *
 * 本测试换个方向验：**拿 highlight.js 真实吐出来的类名，去核对 CSS 里有没有对应规则**。
 * 用真实输出而不是手抄一份清单，是因为手抄的清单会跟现实脱节——
 * hljs 升级换了标签名，抄的那份不会知道。
 */

/** 四种语言里挑一段「什么都有」的样例：注释、字符串、数字、函数、类型、预处理 */
const SAMPLES: Record<string, string> = {
  c: `#include <stdio.h>
#define MAX 100
// 求两数之和
int add(int a, int b) { return a + b; }
int main(void) {
    char *msg = "你好";
    for (int i = 0; i < 3; i++) printf("%d\\n", add(i, MAX));
    return 0;
}`,
  cpp: `#include <iostream>
using namespace std;
class Dog { public: string name; Dog(string n): name(n) {} };
int main() { Dog d("旺财"); cout << d.name << endl; return 0; }`,
  java: `import java.util.Scanner;
public class Main {
    private static int sum(int a, int b) { return a + b; }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String name = sc.next();
        System.out.println("你好 " + name);
        boolean ok = true;
    }
}`,
  python: `import math
class Cat:
    def __init__(self, name):
        self.name = name
    def speak(self):
        # 喵一声
        return f"{self.name}: 喵~"
c = Cat("咪")
for i in range(3):
    print(c.speak(), math.pi, 42, True, None)
`
}

/**
 * 允许「没有配色规则」的类名。每条都要写清理由——
 * 放行清单一旦变成垃圾桶，这个闸门就白设了。
 */
const NO_COLOR_NEEDED: { cls: string; why: string }[] = [
  { cls: 'function_', why: '是修饰后缀，永远和 hljs-title 一起出现（class="hljs-title function_"），跟着 title 上色' },
  { cls: 'class_', why: '同上，跟着 hljs-title 上色' },
  { cls: 'language_', why: '同上，标识语言名，不单独上色' },
  {
    cls: 'hljs-function',
    why:
      '是**容器**不是词：C++ 里它整条包住函数签名 ' +
      '（<span class="hljs-function"> 里面的 int 走 type、main 走 title、() 走 params，' +
      '每个词都有自己的规则）。查过它内部没有「裸着没规则」的文字，所以本身不需要颜色。'
  }
]

/**
 * 找出「本身就有配色规则」的类名。
 *
 * 【为什么不能简单地全文搜 `.hljs-xxx`】
 * 初版就是这么干的，结果**被自己的证伪实验抓包**：把 `.hljs-keyword` 那条规则
 * 删掉之后，闸门居然还是绿的——因为 `hljs-keyword` 这个词仍然出现在
 * `.hljs-meta .hljs-keyword` 这条规则里。可那条规则只管「meta 内部的关键字」，
 * 裸在外面的关键字一个都上不了色。全文搜法把「提过一嘴」当成了「配了色」，
 * 是个假阴性，闸门等于半个摆设。
 *
 * 【现在的判定】一条规则要算数，必须满足：选择器的**最后一段**（真正被上色的
 * 那个元素）带着这个类名，且**前面任何一段都不带 `.hljs-` 类**。
 * 前者保证「就是这个元素被上色」，后者排除掉「只在某个父类内部才生效」的情况。
 */
function styledClasses(css: string): Set<string> {
  const names = new Set<string>()
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  // md.css 里没有 @media 之类会嵌套的规则，直接按「选择器 { ... }」切就够
  for (const m of noComments.matchAll(/([^{}]+)\{/g)) {
    for (const selector of m[1].split(',')) {
      const parts = selector.trim().split(/\s+/).filter(Boolean)
      if (parts.length === 0) continue
      const target = parts[parts.length - 1]
      // 前面任何一段带 .hljs-* → 这条规则是「有条件」的，不算数
      if (parts.slice(0, -1).some((p) => /\.hljs-/.test(p))) continue
      for (const cm of target.matchAll(/\.(hljs-[\w-]+)/g)) names.add(cm[1])
    }
  }
  return names
}

/** highlight.js 实际吐出来的类名 */
function emittedClasses(lang: string, code: string): Set<string> {
  const html = hljs.highlight(code, { language: lang }).value
  const out = new Set<string>()
  for (const m of html.matchAll(/class="([^"]+)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c.startsWith('hljs-') || /^[a-z_]+_$/.test(c)) out.add(c)
  }
  return out
}

/**
 * md.css 里那些 hljs 规则，实际用到了哪些色值（只看 color 声明，不看 border/background）。
 *
 * 【2026-09-20 改：加了 theme 参数】md.css 现在有**两套**语法色（浅色一套裸类名、
 * 深色一套带 `:root[data-theme='dark']` 前缀）。不加参数的话，
 * 两次 matchAll 出来的色值会**并成一个集合**，等于两边混着验 ——
 * 浅色块里混进一个深色值也能过，闸门就废了一半。
 *
 * 【判定方式】一条规则里所有选择器要么全带主题前缀、要么全不带（md.css 是这么写的），
 * 按「这一条是不是深色的」分桶。用 `var(--mi-*)` 写的那几条（deletion / link / formula）
 * 两边共用一个规则、没有十六进制，不会进任何一个桶 —— 那是故意的，
 * 它们的颜色由令牌管，令牌本身由 _verify-contrast.mjs 对着底算。
 */
function hljsColors(css: string, theme: 'light' | 'dark'): Set<string> {
  const out = new Set<string>()
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of noComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!selectors.some((s) => /\.hljs-/.test(s))) continue
    const isDark = selectors.every((s) => s.startsWith(":root[data-theme='dark']"))
    if (isDark !== (theme === 'dark')) continue
    // 前面不许紧跟 `-` 或字母，免得把 border-color / background-color 也算进来
    for (const c of m[2].matchAll(/(?:^|[;\s])color:\s*(#[0-9a-fA-F]{6})/g)) out.add(c[1].toLowerCase())
  }
  return out
}

const CSS = readFileSync(join(__dirname, '..', '..', 'styles', 'md.css'), 'utf8')

describe('课文代码块的配色', () => {
  it('样例覆盖了全部四种代码语言（往 LangOfCode 加语言时会在这里提醒补样例）', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...EDITOR_LANGS].sort())
    for (const l of EDITOR_LANGS) expect(LANG_DISPLAY[l]).toBeTruthy()
  })

  it('highlight.js 吐出的每个类名都有对应配色规则', () => {
    const styled = styledClasses(CSS)
    const waived = new Set(NO_COLOR_NEEDED.map((w) => w.cls))
    const missing: string[] = []

    for (const [lang, code] of Object.entries(SAMPLES)) {
      for (const cls of emittedClasses(lang, code)) {
        if (!styled.has(cls) && !waived.has(cls)) missing.push(`${lang}: .${cls}`)
      }
    }

    expect(
      [...new Set(missing)].sort(),
      '这些类名 hljs 会生成，但 md.css 里没有规则 → 上课时这些词是黑白的'
    ).toEqual([])
  })

  it('放行清单没有过期项，且都写了理由', () => {
    const stillEmitted = new Set(
      Object.entries(SAMPLES).flatMap(([lang, code]) => [...emittedClasses(lang, code)])
    )
    for (const w of NO_COLOR_NEEDED) {
      expect(
        stillEmitted.has(w.cls),
        `放行项已经用不上了（hljs 不再吐这个类名），请从 NO_COLOR_NEEDED 删除：${w.cls}`
      ).toBe(true)
      expect(w.why.length, `放行项缺理由：${w.cls}`).toBeGreaterThan(10)
    }
  })

  it('配色与编辑器用的是同一套色板（课文和练习场颜色不该各调各的）', () => {
    /*
     * 【2026-09-14 改：那份 8 色数组从「复印件」换成 import】
     *
     * 原先是手写一份 8 色的数组放在这，和 editor-setup.ts 的 MI_TOKEN_COLORS 重复。
     * **这个写法有个天生的漏洞**：色板一改（这次 8 个色全换了），
     * 手抄的这份不会跟着变 —— 它只会红着脸说「对不上」，却说不清是谁对不上，
     * 而且下次有人图省事「把测试里的值同步一下」，就等于把闸门调松到刚好放行现状。
     *
     * 同一个道理，本仓库已经在 editor-setup.ts 的 EDITOR_LANGS 那段讲透并实践过了
     * （「两份列表 + 一条测试，不如一份列表」）—— 这里照办：直接 import 那份清单。
     *
     * 顺便把检查做成**双向**的，原来只查了一半：
     *   正向：色板里的每个色，md.css 里都得有规则在用（漏了 → 课文里那个词没颜色）
     *   反向：md.css 里的 hljs 规则，不许出现色板以外的色（写岔一个数字 → 两边不一致）
     */
    /*
     * 【2026-09-20 改：分主题各查一遍】MI_TOKEN_COLORS 现在是 {light, dark} 两条，
     * md.css 也有浅色 / 深色两块规则。**不能把两套色合成一个集合去比** ——
     * 合起来验的话，浅色那块里混进一个深色值照样能过（因为那个值在深色板里），
     * 于是「浅色课文里出现一个夜里才该出现的亮紫」这种错就漏掉了。
     */
    const report: Record<string, { missing: string[]; extra: string[] }> = {}
    for (const theme of ['light', 'dark'] as const) {
      const palette = new Set(MI_TOKEN_COLORS.map((t) => t[theme].toLowerCase()))
      const inCss = hljsColors(CSS, theme)
      report[theme] = {
        missing: [...palette].filter((c) => !inCss.has(c)),
        extra: [...inCss].filter((c) => !palette.has(c))
      }
    }

    /*
     * 【为什么两条合成一次断言，而不是各断各的】
     * 分开写的话，只改一边时**第一条就会抛**，读者只看得到 missing 那条消息 ——
     * 而实际出问题的是 extra（比如只改了 md.css 的色值）。
     * 报错把人指向错的方向，比不报还费时间。合成一个对象，两个事实一起摊开。
     * （深色那套同理：不合成的话浅色一红就抛，深色的问题整个人都看不到。）
     */
    expect(
      report,
      '两边对不上。missing = 色板里有、md.css 没用的色（课文里那个词会没颜色）；' +
        'extra = md.css 用了、色板里没有的色（课文和练习场会不是一个色）。' +
        '改配色时 styles/md.css 和 lib/editor-setup.ts 的 MI_TOKEN_COLORS 要一起改，' +
        '两种主题各改一处。'
    ).toEqual({
      light: { missing: [], extra: [] },
      dark: { missing: [], extra: [] }
    })
  })
})
