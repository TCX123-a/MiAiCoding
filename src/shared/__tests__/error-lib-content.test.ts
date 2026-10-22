/**
 * 内容门禁：**真正要发布的那 133 条规则**，能不能匹配上真实的报错。
 *
 * 【为什么必须有这个文件】
 * error-match.test.ts 测的是匹配器（用我手写的假规则库），
 * run-result-view.test.ts 测的是界面该不该出卡（也是假规则库）。
 * 两边全绿，**一行真正要发布的规则都没被验过** ——
 * content/error-lib/*.json 里某个 pattern 多打了一个字符，
 * 两个测试文件照样绿油油，而用户那边这条错就是没解释。
 *
 * 这个文件把两头接上：从 content/error-lib/ 读**真规则**，
 * 喂**真编译器的真报错**，断言命中。
 *
 * 素材来源同 error-match.test.ts：2026-09-13 在本机把坏代码喂给
 * gcc 16.1.0 / g++ 16.1.0 / javac 21.0.12 / Python 3.12.10 抄回来的 stderr。
 *
 * ⚠️ 这里**故意直接读 content/**，不走生成的 bundle —— content/ 才是唯一真源，
 * bundle 是它的产物。测产物等于把真源的问题推到构建之后才发现。
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { matchError } from '../error-match'
import type { ErrorLib, LangOfCode } from '../types'

const DIR = join(__dirname, '../../../content/error-lib')

const LIB: ErrorLib = {}
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
  LIB[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(DIR, f), 'utf8')).rules
}

/** 真报错 → 期望命中的那条规则（用 pattern 里的一段特征串指名） */
const CASES: [LangOfCode, string, string][] = [
  // ── Python ──
  [
    'python',
    'Traceback (most recent call last):\n  File "X:\\t\\a.py", line 1, in <module>\n    print(a)\n          ^\nNameError: name \'a\' is not defined\n',
    "NameError: name '([^']+)' is not defined"
  ],
  [
    'python',
    '  File "X:\\t\\b.py", line 1\n    if True\n           ^\nSyntaxError: expected \':\'\n',
    "SyntaxError: expected ':'"
  ],
  [
    'python',
    'IndentationError: expected an indented block after function definition on line 1\n',
    'expected an indented block'
  ],
  [
    'python',
    'TypeError: can only concatenate str (not "int") to str\n',
    'can only concatenate str'
  ],
  [
    'python',
    'ZeroDivisionError: division by zero\n',
    'ZeroDivisionError'
  ],
  [
    'python',
    "IndexError: list index out of range\n",
    'IndexError'
  ],
  [
    'python',
    "KeyError: 'age'\n",
    'KeyError'
  ],
  // 中文标点：零基础用户的第一大坑，这条必须命中
  [
    'python',
    '  File "X:\\t\\c.py", line 1\n    print（"你好"）\n         ^\nSyntaxError: invalid character \'（\' (U+FF08)\n',
    "invalid character"
  ],

  // ── C ──
  [
    'c',
    "a.c: In function 'main':\na.c:3:17: error: expected ';' before 'return'\n    3 |     printf(\"hi\")\n      |                 ^\n",
    "expected ';'"
  ],
  [
    'c',
    "a.c:3:5: error: 'x' undeclared (first use in this function)\n",
    "'([^']+)' undeclared"
  ],
  [
    'c',
    "a.c:2:5: error: implicit declaration of function 'printf' [-Wimplicit-function-declaration]\n",
    'implicit declaration of function'
  ],
  [
    'c',
    'a.c:5:1: error: expected declaration or statement at end of input\n',
    'end of input'
  ],
  // 中文标点（gcc 的说法是 stray）
  [
    'c',
    "a.c:3:14: error: stray '\\357' in program\n",
    "stray '([^']+)' in program"
  ],

  // ── C++ ──
  [
    'cpp',
    "a.cpp:3:5: error: 'cout' was not declared in this scope; did you mean 'std::cout'?\n",
    'did you mean'
  ],
  [
    'cpp',
    "a.cpp:3:5: error: 'endl' was not declared in this scope\n",
    'was not declared in this scope'
  ],

  // ── Java（必须是英文报错 —— 运行器已用 -Duser.language=en 钉死）──
  ['java', "Main.java:3: error: ';' expected\n        int a = 1\n", "';' expected"],
  [
    'java',
    'Main.java:3: error: cannot find symbol\n        System.out.println(x);\n  symbol:   variable x\n  location: class Main\n',
    'symbol:[ ]+variable'
  ],
  [
    'java',
    'Main.java:1: error: cannot find symbol\n  symbol:   class Scanner\n',
    'symbol:[ ]+class'
  ],
  [
    'java',
    'Exception in thread "main" java.lang.ArithmeticException: / by zero\n\tat Main.main(Main.java:3)\n',
    'ArithmeticException'
  ],
  [
    'java',
    'Exception in thread "main" java.lang.ArrayIndexOutOfBoundsException: Index 5 out of bounds for length 3\n',
    'ArrayIndexOutOfBoundsException'
  ],
  [
    'java',
    'Exception in thread "main" java.lang.NullPointerException: Cannot invoke "String.length()" because "s" is null\n',
    'NullPointerException'
  ],
  [
    'java',
    'Exception in thread "main" java.lang.NumberFormatException: For input string: "abc"\n',
    'NumberFormatException'
  ],
  ['java', 'Main.java:2: error: reached end of file while parsing\n', 'reached end of file'],

  // ── common（跨语言）──
  ['c', "a.c:(.text+0x1a): undefined reference to 'add'\ncollect2.exe: error: ld returned 1 exit status\n", 'undefined reference'],
  ['python', 'FileNotFoundError: [Errno 2] No such file or directory: \'data.txt\'\n', 'No such file or directory'],
  ['c', 'Segmentation fault\n', 'Segmentation fault']
]

describe('内置错误库：真规则 × 真报错', () => {
  it('五个规则文件都在，且都不是空的', () => {
    expect(Object.keys(LIB).sort()).toEqual(['c', 'common', 'cpp', 'java', 'python'])
    for (const [lang, rules] of Object.entries(LIB)) {
      expect(rules.length, `${lang}.json 一条规则都没有`).toBeGreaterThan(0)
    }
  })

  it.each(CASES)('[%s] 命中「%s」', (lang, output, expectPatternPart) => {
    const m = matchError(LIB, lang, output)
    expect(m, `没有命中任何规则。报错原文：\n${output}`).not.toBeNull()
    expect(m!.rule.pattern).toContain(expectPatternPart)
  })

  /**
   * 反向：命中的解释里**不能残留没回填的占位符**。
   *
   * 校验器已经在入库时拦了「{n} 超出捕获组个数」，但拦不住另一种情况：
   * 组**存在**却没参与这次匹配（可选组没命中）——那时候 `{1}` 会原样显示出来。
   * 这条只有拿真报错跑一遍才发现得了。
   */
  it.each(CASES)('[%s] 命中的解释里没有残留的 {n} 占位符', (lang, output) => {
    const m = matchError(LIB, lang, output)
    expect(m).not.toBeNull()
    const shown = m!.title + m!.explain + m!.fixHint
    const leftover = shown.match(/\{\d\}/g)
    expect(leftover, `界面上会直接显示 ${leftover?.join('、')} 这种半成品`).toBeNull()
  })

  /** 每门语言的规则条数（目标 25-40，M7 补齐；这里只作为进度显示，不作断言） */
  it('打印当前规则规模', () => {
    const counts = Object.entries(LIB)
      .map(([l, r]) => `${l} ${r.length}`)
      .join(' / ')
    console.log(`错误库规模：${counts}`)
    expect(true).toBe(true)
  })
})

/**
 * ── 顺序即优先级（回归：2026-09-14 修的「少引号报成少括号」）──
 *
 * 【这个 bug 长什么样】
 * 学生写 `System.out.println("喵);`（引号没收尾），界面上跳出来的却是
 * 「少了几个右花括号喵」——提示指向一个完全正确的花括号，学生照着改只会越改越乱。
 *
 * 【为什么会这样】
 * 没闭合的引号会让 javac 一路读到文件末尾，所以它**同时**报两条：
 *      error: unclosed string literal          ← 真正的原因
 *      error: reached end of file while parsing ← 引号没闭合导致的后果
 * 而 `matchError()` 是**按规则在文件里的顺序**取第一条命中的，不是按报错在文本里的位置。
 * 旧顺序里「少了右花括号」排在前面，于是它先命中，把真原因盖掉了。
 *
 * 【为什么这个测试非写成「两条同时出现」不可】
 * 只测「缺引号时命中引号规则」是**测不出这个 bug 的**——两条规则对那段文本都能匹配，
 * 决定结果的只有先后。所以夹具必须是 javac 真的同时吐出两条的那种文本，
 * 而且必须**两个方向都断言**：引号在时要引号赢，花括号真缺时要花括号赢。
 * 只断言前者的话，把顺序改成「花括号永远优先」也能过，而那会把真缺花括号的情况治坏。
 *
 * 夹具取自本机 javac 21.0.12 的真实 stderr（取法：`node scripts/审计/_javac_probe.mjs`）。
 * 唯一的改动：把 javac 回显源码和 `^` 之间的那串对齐空格收成了一个，只为好读 ——
 * 匹配用的是 search()，回显那几行不可能影响命中结果，也不参与任何断言。
 */
describe('Java 报错优先级：引号没闭合不能被「少花括号」抢走', () => {
  const JAVA = 'java'

  /** 缺右引号 —— javac 同时报 unclosed string literal 和 reached end of file */
  const BOTH = [
    'Main.java:1: error: unclosed string literal',
    'public class Main { public static void main(String[] a) { System.out.println("喵); } }',
    ' ^',
    'Main.java:1: error: reached end of file while parsing',
    'public class Main { public static void main(String[] a) { System.out.println("喵); } }',
    ' ^',
    '2 errors'
  ].join('\r\n')

  /** 真缺花括号 —— javac 只报 reached end of file */
  const REALLY_EOF = [
    'Main.java:1: error: reached end of file while parsing',
    'public class Main { public static void main(String[] a) { System.out.println("喵"); ',
    ' ^',
    '1 error'
  ].join('\r\n')

  it('前提：这段文本里两条规则**都能**匹配（否则测的不是优先级）', () => {
    for (const part of ['error: unclosed string literal', 'reached end of file while parsing']) {
      expect(BOTH, `夹具里没有「${part}」，这个测试就退化成普通用例了`).toContain(part)
    }
  })

  it('缺右引号 → 命中「引号没闭合」，不是「少花括号」', () => {
    const m = matchError(LIB, JAVA, BOTH)
    expect(m).not.toBeNull()
    expect(m!.rule.pattern).toContain('unclosed string literal')
    // 反面对照：那条会误导学生的解释，必须没被选中
    expect(m!.rule.pattern).not.toContain('reached end of file')
  })

  it('真缺花括号 → 仍然命中「少花括号」（修引号不能把这条治坏）', () => {
    const m = matchError(LIB, JAVA, REALLY_EOF)
    expect(m).not.toBeNull()
    expect(m!.rule.pattern).toContain('reached end of file')
  })

  it('缺右单引号 → 命中「字符没闭合」', () => {
    const m = matchError(LIB, JAVA, 'Main.java:1: error: unclosed character literal\r\n1 error\r\n')
    expect(m).not.toBeNull()
    expect(m!.rule.pattern).toContain('unclosed character literal')
  })

  /**
   * 结构断言：直接钉住「两条 unclosed 必须排在 reached end of file 之前」。
   *
   * 行为断言已经能抓到这个问题，但它的失败信息是「命中错了」，
   * 而真正的原因在规则文件的排序里。这条断言失败时会直接告诉你顺序变了，
   * 省掉一次「为什么匹配错了」的排查。
   */
  it('结构：unclosed string/character literal 排在 reached end of file 之前', () => {
    const idx = (part: string) => LIB.java.findIndex((r) => r.pattern.includes(part))
    const eof = idx('reached end of file while parsing')
    expect(eof, 'java.json 里找不到 reached end of file 那条规则').toBeGreaterThanOrEqual(0)
    for (const part of ['unclosed string literal', 'unclosed character literal']) {
      const i = idx(part)
      expect(i, `java.json 里找不到 ${part} 那条规则`).toBeGreaterThanOrEqual(0)
      expect(
        i,
        `${part}（第 ${i + 1} 条）必须排在 reached end of file（第 ${eof + 1} 条）之前。\n` +
          '顺序即优先级：排到后面去，学生缺引号时会看到「少了几个右花括号喵」，照着改只会越改越乱。'
      ).toBeLessThan(eof)
    }
  })
})
