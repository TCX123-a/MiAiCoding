import { describe, expect, it } from 'vitest'
import { SAMPLE_UI } from '../copy'
import { SAMPLES, followSample, sampleByKey } from '../samples'
import { LANG_OF_CODE } from '../types'
import type { SampleKey } from '../samples'

/**
 * 练习场示例代码的闸门。
 *
 * 【这套测试**测不了**什么——必须说清楚】
 * 它测不了「这段代码真能编译运行」。那才是最容易出错、后果最严重的地方：
 * 零基础用户点「打印一句话」看到一堆编译错误，得出的结论是「这软件是坏的」，
 * 而不是「代码有问题」。可本项目的单测跑在无 DOM、无工具链的环境里，
 * 本机现在连 gcc/javac 都没装（只有 Python）。
 * 所以这里只钉**结构**，真跑的事交给 M5 之后的自动编译运行校验
 * （每条都带 expectStdout，就是给那一步用的）。
 *
 * 【能钉住什么】
 * 都是真会出事的：Java 类名和文件名对不上会直接报「没有 class」、
 * 四种语言输出不一样就失去了横向对照的意义、样例里没中文就测不出乱码、
 * 空代码点运行按钮毫无反应。
 *
 * 【真跑的在哪】
 * Python 那三条由 src/main/runner/__tests__/samples-e2e.test.ts 走真实的
 * runCode() 跑一遍比对输出（本机装了 Python，能跑；没装就自动跳过）。
 * C/C++/Java 要等 M5 装好工具链，那时用同一份 expectStdout 补上。
 */
describe('练习场示例代码', () => {
  it('三个样例 × 四种语言，一个都不能少', () => {
    expect(SAMPLES.length, '顶部就三个按钮，多了挤、少了不够用').toBe(3)
    for (const s of SAMPLES) {
      for (const lang of LANG_OF_CODE) {
        const run = s.byLang[lang]
        expect(run, `样例「${SAMPLE_UI[s.key].label}」缺 ${lang}`).toBeDefined()
        expect(run.code.trim().length, `样例「${SAMPLE_UI[s.key].label}」的 ${lang} 代码是空的`).toBeGreaterThan(0)
      }
    }
  })

  it('同一个样例，四种语言的输出必须一模一样', () => {
    // 这条是「横向对照」这个用法的地基：用户在 Python 里看到「3 + 5 等于 8」，
    // 切到 C 里看到别的，对照就无从谈起，还会以为是语言差异。
    for (const s of SAMPLES) {
      const expected = s.byLang.python.expectStdout
      for (const lang of LANG_OF_CODE) {
        expect(s.byLang[lang].expectStdout, `样例「${SAMPLE_UI[s.key].label}」的 ${lang} 输出和 Python 对不上`).toBe(
          expected
        )
      }
    }
  })

  it('代码以换行结尾（不然 CodeMirror 里最后一行贴着边框，很难看）', () => {
    for (const s of SAMPLES) {
      for (const lang of LANG_OF_CODE) {
        expect(s.byLang[lang].code.endsWith('\n'), `样例「${SAMPLE_UI[s.key].label}」的 ${lang} 没以换行结尾`).toBe(
          true
        )
      }
    }
  })

  it('Java 样例必须有 public class，且类名合法（否则运行器找不到入口）', () => {
    // runner.ts 的 findJavaClass() 拿正则从代码里抠类名，再拿它当文件名。
    // 抠不到就直接返回「这段代码里没有 class 喵～」，用户连编译都进不去。
    // 这里按同一个契约做独立校验：正则不同源，所以能起到交叉检查的作用。
    for (const s of SAMPLES) {
      const code = s.byLang.java.code
      const m = /public\s+(?:(?:final|abstract|sealed)\s+)*class\s+([A-Za-z_$][\w$]*)/.exec(code)
      expect(m, `样例「${SAMPLE_UI[s.key].label}」的 Java 代码里找不到 public class`).not.toBeNull()
      expect(m![1], '类名得是 Main —— 四个样例统一用它，用户对照起来省心').toBe('Main')
      // 类名不能重复出现两次 public class（复制粘贴时最容易犯的错）
      expect(code.match(/public\s+class\s+/g)!.length, `样例「${SAMPLE_UI[s.key].label}」有多个 public class`).toBe(1)
    }
  })

  it('C / C++ 样例必须有 int main（程序入口）', () => {
    for (const s of SAMPLES) {
      for (const lang of ['c', 'cpp'] as const) {
        expect(
          /int\s+main\s*\(/.test(s.byLang[lang].code),
          `样例「${SAMPLE_UI[s.key].label}」的 ${lang} 没有 int main()`
        ).toBe(true)
      }
    }
  })

  it('只有「让程序问你」这条需要填输入，另外两条必须留空', () => {
    // 另外两条要是误带了 stdin，用户运行前会看见输入框里凭空有内容，很困惑
    expect(sampleByKey('input')!.byLang.python.stdin, '这条就是靠输入才有意义').toBeTruthy()
    for (const lang of LANG_OF_CODE) {
      expect(sampleByKey('hello')!.byLang[lang].stdin, `hello 的 ${lang} 不该要输入`).toBeUndefined()
      expect(sampleByKey('math')!.byLang[lang].stdin, `math 的 ${lang} 不该要输入`).toBeUndefined()
    }
  })

  it('expectStdout 非空且以换行结尾（否则校验脚本比对时会有歧义）', () => {
    for (const s of SAMPLES) {
      for (const lang of LANG_OF_CODE) {
        const e = s.byLang[lang].expectStdout
        expect(e.length, `样例「${SAMPLE_UI[s.key].label}」的 ${lang} 应该有预期输出`).toBeGreaterThan(0)
        expect(e.endsWith('\n'), `样例「${SAMPLE_UI[s.key].label}」的 ${lang} 预期输出没以换行结尾`).toBe(true)
      }
    }
  })

  it('输出里真的带中文——这是「编码链路有没有坏」的探针', () => {
    // 中文乱码是这套东西最阴的坑：代码没错、逻辑没错，只是显示成一堆问号。
    // 拿纯 ASCII 的样例永远测不出来，所以样例里必须埋中文。
    for (const s of SAMPLES) {
      expect(/[一-鿿]/.test(s.byLang.python.expectStdout), `样例「${SAMPLE_UI[s.key].label}」输出里没有中文`).toBe(
        true
      )
      for (const lang of LANG_OF_CODE) {
        expect(
          /[一-鿿]/.test(s.byLang[lang].code),
          `样例「${SAMPLE_UI[s.key].label}」的 ${lang} 源码里没有中文，测不出编码问题`
        ).toBe(true)
      }
    }
  })

  it('每个样例都有按钮文字和说明（空按钮用户不知道点了会怎样）', () => {
    // 文案真源在 copy.ts 的 SAMPLE_UI，但「三个样例是不是都有文案」
    // 得在这里对着 SAMPLES 查：两边是分开的文件，漏配的话类型也拦不住
    // （SAMPLE_UI 是 Record<SampleKey, ...>，多一个少一个 key 都会报；
    //  但 SAMPLES 里要是冒出个 SAMPLE_UI 没覆盖的 key，就得靠这条）
    for (const s of SAMPLES) {
      const ui = SAMPLE_UI[s.key]
      expect(ui, `样例「${s.key}」在 SAMPLE_UI 里没有对应的按钮文案`).toBeDefined()
      expect(ui.label.trim().length, `样例「${s.key}」的按钮没字`).toBeGreaterThan(0)
      expect(ui.hint.trim().length, `样例「${s.key}」缺鼠标说明`).toBeGreaterThan(0)
    }
  })

  it('SAMPLE_UI 里没有多余的、SAMPLES 用不到的文案', () => {
    // 反方向：删了一个样例却忘了删文案，界面上没影响，但留着会让人以为
    // 「还有个样例是不是没接上」。
    const keys = new Set(SAMPLES.map((s) => s.key))
    for (const k of Object.keys(SAMPLE_UI)) {
      expect(keys.has(k as SampleKey), `SAMPLE_UI.${k} 没有对应的样例了，删掉它`).toBe(true)
    }
  })
})

/**
 * 换语言时「示例自动跟随」的闸门。
 *
 * 【守的是什么】
 * 2026-09-13 主人验收时踩到：选了 C 点「打印一句话」，把下拉框拨到 Java
 * 直接点运行 → 应用拿 C 代码去当 Java 编译，回「这段代码里没有 class」；
 * 拨到 Python 再跑 → SyntaxError。从主人的视角看，软件坏了。
 *
 * 这条规则有两个相反方向，两边都必须钉住：
 *   ① **该跟的必须跟**（漏了 = 主人那个 bug，换个语言就报错）；
 *   ② **不该跟的绝不跟**（多跟了 = 自动改掉用户亲手写的代码，
 *      比原 bug 更让人火大，而且同样"功能看着正常"，不钉住没人发现）。
 */
describe('followSample：换语言时示例自动跟随', () => {
  it('三条示例 × 四语言，任意两门语言之间都跟得过去', () => {
    for (const s of SAMPLES) {
      for (const from of LANG_OF_CODE) {
        for (const to of LANG_OF_CODE) {
          if (from === to) continue
          const got = followSample(from, to, s.byLang[from].code)
          expect(got, `${s.key}：${from} -> ${to} 没跟上`).not.toBeNull()
          // 断言「等于目标语言那一条」而不是「非空」：byLang 的下标写反
          // （跟成了来源语言自己）也能通过「非空」，但换语言就等于没换
          expect(got?.code, `${s.key}：${from} -> ${to} 跟错了代码`).toBe(s.byLang[to].code)
        }
      }
    }
  })

  it('同一种语言不跟随（没什么可跟的）', () => {
    for (const s of SAMPLES) {
      expect(followSample('c', 'c', s.byLang.c.code)).toBeNull()
    }
  })

  it('用户改过一个字符就不跟随 —— 绝不自动替换用户亲手写的代码', () => {
    const c = sampleByKey('hello')!.byLang.c.code
    expect(followSample('c', 'java', `${c} `)).toBeNull()
    expect(followSample('c', 'java', c.trim())).toBeNull() // 去掉末尾换行也算改过
    expect(followSample('c', 'java', c.replace('你好', '你好呀'))).toBeNull()
    expect(followSample('c', 'java', '')).toBeNull()
  })

  it('「让程序问你」要把输入一起带过去（只带代码会卡在等输入上直到超时）', () => {
    const s = sampleByKey('input')!
    const got = followSample('c', 'java', s.byLang.c.code)
    expect(got?.code).toBe(s.byLang.java.code)
    expect(got?.stdin, '输入没带过去，换完语言一跑就卡住').toBe(s.byLang.java.stdin)
  })

  it('不需要输入的示例跟过去时，输入框必须是空的（不能留着上一条的 21）', () => {
    const s = sampleByKey('hello')!
    const got = followSample('python', 'c', s.byLang.python.code)
    expect(got?.stdin).toBe('')
    expect(s.byLang.c.stdin, '这条示例本来就不该有输入').toBeUndefined()
  })
})
