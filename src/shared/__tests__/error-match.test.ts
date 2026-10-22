/**
 * M5-04：内置错误库匹配。
 *
 * 【这个文件里的报错文本不是编的】
 * 下面 `真实报错` 那一组，全部是 2026-09-13 在本机把真的坏代码喂给
 * gcc 16.1.0 / g++ 16.1.0 / javac 21.0.12 / Python 3.12.10 之后，
 * 原样抄回来的 stderr。只做了两件事：把临时目录的绝对路径缩成 `X:\t\`，
 * 以及去掉行尾空白。**一个字符都没改写**。
 *
 * 为什么不自己编：编出来的报错永远匹配得上自己写的正则 —— 因为你写正则的时候
 * 脑子里想的就是那串字。真实的坑在于编译器会换行、会插 `^^^` 指示行、
 * 会加 `did you mean` 建议、会带 `[-Wimplicit-function-declaration]` 尾巴，
 * 还会按系统语言翻译自己（见下面 Java 那组）。这些编不出来。
 */
import { describe, expect, it } from 'vitest'
import { fillPlaceholders, matchError, stripAnsi } from '../error-match'
import type { ErrorLib, ErrorRule } from '../types'

/** 造一条规则，只写关心的字段 */
function rule(pattern: string, extra: Partial<ErrorRule> = {}): ErrorRule {
  return {
    pattern,
    title: '标题',
    explain: '解释',
    fixHint: '怎么办',
    ...extra
  }
}

function lib(parts: Partial<Record<string, ErrorRule[]>>): ErrorLib {
  return parts as ErrorLib
}

describe('stripAnsi', () => {
  it('去掉颜色控制序列', () => {
    expect(stripAnsi('\u001b[31merror\u001b[0m: 坏了')).toBe('error: 坏了')
  })

  it('没有控制序列时原样返回', () => {
    expect(stripAnsi('error: 坏了')).toBe('error: 坏了')
    expect(stripAnsi('')).toBe('')
  })
})

describe('fillPlaceholders', () => {
  it('按组号回填', () => {
    expect(fillPlaceholders('「{1}」和「{2}」', [undefined, '甲', '乙'])).toBe('「甲」和「乙」')
  })

  it('同一个占位符出现多次，每处都填', () => {
    expect(fillPlaceholders('{1} 就是 {1}', [undefined, 'x'])).toBe('x 就是 x')
  })

  /**
   * 这条钉的是「不许悄悄变成空串」。
   * 组不存在时留着 `{1}`，界面上能一眼看出这里缺东西；
   * 换成空串则会渲染成一句读得通的残句，看起来像文案没写好，根本查不到根上。
   */
  it('组不存在时原样保留占位符，不换成空串', () => {
    expect(fillPlaceholders('「{1}」', [])).toBe('「{1}」')
    expect(fillPlaceholders('「{2}」', [undefined, '只有第一个组'])).toBe('「{2}」')
  })

  it('没有占位符时原样返回', () => {
    expect(fillPlaceholders('没有占位符', [undefined, 'x'])).toBe('没有占位符')
  })
})

describe('matchError：机制', () => {
  const hello = lib({ python: [rule("name '([^']+)' is not defined")] })

  it('命中后回填占位符', () => {
    const m = matchError(hello, 'python', "NameError: name 'count' is not defined")
    expect(m).not.toBeNull()
    expect(m!.vars[1]).toBe('count')
  })

  it('占位符真的进了三段文案', () => {
    const l = lib({
      python: [rule("name '([^']+)' is not defined", { explain: '「{1}」还没建呢' })]
    })
    const m = matchError(l, 'python', "NameError: name 'count' is not defined")
    expect(m!.explain).toBe('「count」还没建呢')
  })

  /**
   * 语言规则优先于 common —— docs/03 点名要的一条。
   * 反过来的话，任何一条笼统的通用规则都会把所有语言的具体规则盖住。
   */
  it('语言规则优先于 common', () => {
    const l = lib({
      python: [rule('NameError', { title: '语言规则' })],
      common: [rule('NameError', { title: '通用规则' })]
    })
    expect(matchError(l, 'python', 'NameError: ...')!.title).toBe('语言规则')
  })

  it('语言规则没命中时，落到 common', () => {
    const l = lib({
      python: [rule('NameError', { title: '语言规则' })],
      common: [rule('Timeout', { title: '通用规则' })]
    })
    expect(matchError(l, 'python', 'Timeout waiting for input')!.title).toBe('通用规则')
  })

  it('两边都没命中返回 null', () => {
    expect(matchError(hello, 'python', '一切正常')).toBeNull()
  })

  /** 同一边内按书写顺序，先命中先用。M7 生成规则时要靠这条把具体的排在前面 */
  it('同一语言内按书写顺序，先命中先用', () => {
    const l = lib({
      c: [rule("expected ';'", { title: '少分号' }), rule('error:', { title: '笼统的' })]
    })
    expect(matchError(l, 'c', "x.c:3:5: error: expected ';' before 'return'")!.title).toBe('少分号')
  })

  /** docs/03 点名要的一条：flags 生效 */
  it('flags 生效：带 i 时忽略大小写', () => {
    const l = lib({ c: [rule('NAMEERROR', { flags: 'i', title: '忽略大小写' })] })
    expect(matchError(l, 'c', 'nameerror: ...')!.title).toBe('忽略大小写')
  })

  it('不带 flags 时大小写敏感', () => {
    const l = lib({ c: [rule('NAMEERROR', { title: '大小写敏感' })] })
    expect(matchError(l, 'c', 'nameerror: ...')).toBeNull()
  })

  it('带 m 标志时 ^ 匹配行首，而不是只匹配整段开头', () => {
    const l = lib({ c: [rule('^error:', { flags: 'm', title: '行首' })] })
    expect(matchError(l, 'c', 'x.c: 先来一行没用的\nerror: 真错误')).not.toBeNull()
    expect(matchError(lib({ c: [rule('^error:')] }), 'c', 'x.c: 先来一行\nerror: 真错误')).toBeNull()
  })

  it('匹配的是整段文本，换行不会挡住', () => {
    const m = matchError(hello, 'python', '第一行\n第二行\nNameError: name \'a\' is not defined\n第四行')
    expect(m!.vars[1]).toBe('a')
  })

  it('带 ANSI 颜色码的报错照样命中（真实会发生的）', () => {
    const l = lib({ c: [rule("error: '([^']+)' undeclared")] })
    const colored = "x.c:3:5: \u001b[31;1merror: \u001b[0m\u001b[1m'x'\u001b[0m undeclared"
    expect(matchError(l, 'c', colored)!.vars[1]).toBe('x')
  })

  /**
   * 坏规则不能把应用带走。
   * 规则是 M7 由 AI 批量生成的，几千条里出现一条正则语法错是迟早的事；
   * 那时候正确的表现是「这一条不生效、别的照常」，而不是整个运行面板白屏。
   */
  it('正则语法错时跳过该条，不影响后面的规则', () => {
    const l = lib({ python: [rule('((((('), rule("name '([^']+)'", { title: '好的那条' })] })
    expect(matchError(l, 'python', "name 'a'")!.title).toBe('好的那条')
  })

  it('规则库是空的 / 没传 / 输出为空，都返回 null 而不是崩', () => {
    expect(matchError(undefined, 'python', 'NameError')).toBeNull()
    expect(matchError(lib({}), 'python', 'NameError')).toBeNull()
    expect(matchError(lib({ python: [] }), 'python', 'NameError')).toBeNull()
    expect(matchError(hello, 'python', '')).toBeNull()
  })

  it('只有别的语言的规则，不会串台', () => {
    expect(matchError(lib({ c: [rule('error:')] }), 'python', 'error: 这不是 Python 的报错')).toBeNull()
  })
})

/**
 * 真实报错：拿本机四门语言真的跑出来的错误文本，配上将来要写进
 * content/error-lib/*.json 的规则。
 *
 * 【为什么这组最重要】
 * 上面那组测的是「机制对不对」，随便什么字符串都能过。
 * 这一组测的是「设计在真东西上成不成立」—— 规则是照着我脑子里的报错写的，
 * 而这里是编译器真的吐出来的字。两边的差距，就是 M7 要填的几千条规则的成色。
 */
describe('matchError：真实报错', () => {
  /** 本机抓到的原始报错；绝对路径缩成 X:\t\，只做这一处改动 */
  const REAL = {
    pyName:
      'Traceback (most recent call last):\n' +
      '  File "X:\\t\\p_name.py", line 1, in <module>\n' +
      '    print(a)\n' +
      '          ^\n' +
      "NameError: name 'a' is not defined\n",

    pySyntax:
      '  File "X:\\t\\p_syn.py", line 1\n' +
      '    if True\n' +
      '           ^\n' +
      "SyntaxError: expected ':'\n",

    pyIndent:
      '  File "X:\\t\\p_ind.py", line 2\n' +
      '    print(1)\n' +
      '    ^^^^^\n' +
      'IndentationError: expected an indented block after function definition on line 1\n',

    pyType:
      'Traceback (most recent call last):\n' +
      '  File "X:\\t\\p_type.py", line 1, in <module>\n' +
      '    print("a" + 1)\n' +
      '          ~~~~^~~\n' +
      'TypeError: can only concatenate str (not "int") to str\n',

    pyZero:
      'Traceback (most recent call last):\n' +
      '  File "X:\\t\\p_zero.py", line 1, in <module>\n' +
      '    print(1/0)\n' +
      '          ~^~\n' +
      'ZeroDivisionError: division by zero\n',

    cSemi:
      "c_semi.c: In function 'main':\n" +
      "c_semi.c:3:17: error: expected ';' before 'return'\n" +
      '    3 |     printf("hi")\n' +
      '      |                 ^\n' +
      '      |                 ;\n' +
      '    4 |     return 0;\n' +
      '      |     ~~~~~~\n',

    cUndecl:
      "c_undecl.c: In function 'main':\n" +
      "c_undecl.c:3:5: error: 'x' undeclared (first use in this function)\n" +
      '    3 |     x = 5;\n' +
      '      |     ^\n' +
      'c_undecl.c:3:5: note: each undeclared identifier is reported only once for each ' +
      'function it appears in\n',

    cNoInc:
      "c_noinc.c: In function 'main':\n" +
      "c_noinc.c:2:5: error: implicit declaration of function 'printf' " +
      '[-Wimplicit-function-declaration]\n' +
      '    2 |     printf("hi");\n' +
      '      |     ^~~~~~\n' +
      "c_noinc.c:1:1: note: include '<stdio.h>' or provide a declaration of 'printf'\n" +
      '  +++ |+#include <stdio.h>\n' +
      '    1 | int main() {\n',

    cppNoStd:
      "x_nostd.cpp:3:5: error: 'cout' was not declared in this scope; did you mean 'std::cout'?\n" +
      '    3 |     cout << "hi" << endl;\n' +
      '      |     ^~~~\n' +
      '      |     std::cout\n' +
      "x_nostd.cpp:3:21: error: 'endl' was not declared in this scope; did you mean 'std::endl'?\n",

    // 下面两条是**加了 -J-Duser.language=en 之后**的 javac 输出。
    // 不加的话本机吐的是「错误: 需要';'」并且是 GBK 字节 —— 见 runner.ts 里的说明。
    javaSemi: "Main.java:3: error: ';' expected\n        int a = 1\n                 ^\n1 error\n",

    javaSymbol:
      'Main.java:3: error: cannot find symbol\n' +
      '        System.out.println(x);\n' +
      '                           ^\n' +
      '  symbol:   variable x\n' +
      '  location: class Main\n' +
      '1 error\n',

    javaZero:
      'Exception in thread "main" java.lang.ArithmeticException: / by zero\n' +
      '\tat Main.main(Main.java:3)\n',

    javaBounds:
      'Exception in thread "main" java.lang.ArrayIndexOutOfBoundsException: ' +
      'Index 5 out of bounds for length 3\n' +
      '\tat Main.main(Main.java:4)\n'
  } as const

  /** 将来要写进 content/error-lib/*.json 的规则（第 2 步搬过去，这里先钉住形状） */
  const REAL_LIB = lib({
    python: [
      rule("NameError: name '([^']+)' is not defined"),
      rule('IndentationError'),
      rule("SyntaxError: expected '([^']+)'"),
      rule('TypeError: can only concatenate str'),
      rule('ZeroDivisionError: division by zero')
    ],
    c: [
      rule("error: expected ';' before '([^']+)'"),
      rule("error: '([^']+)' undeclared"),
      rule("implicit declaration of function '([^']+)'")
    ],
    cpp: [
      rule("'([^']+)' was not declared in this scope"),
      rule("error: expected ';' before '([^']+)'")
    ],
    java: [
      rule("';' expected"),
      rule('cannot find symbol'),
      rule('java\\.lang\\.ArithmeticException'),
      rule('java\\.lang\\.ArrayIndexOutOfBoundsException')
    ]
  })

  const cases: [keyof typeof REAL, keyof typeof REAL_LIB, string][] = [
    ['pyName', 'python', 'a'],
    ['pySyntax', 'python', ':'],
    ['pyIndent', 'python', ''],
    ['pyType', 'python', ''],
    ['pyZero', 'python', ''],
    ['cSemi', 'c', 'return'],
    ['cUndecl', 'c', 'x'],
    ['cNoInc', 'c', 'printf'],
    ['cppNoStd', 'cpp', 'cout'],
    ['javaSemi', 'java', ''],
    ['javaSymbol', 'java', ''],
    ['javaZero', 'java', ''],
    ['javaBounds', 'java', '']
  ]

  it.each(cases)('%s：能命中，且 {1} 回填正确', (key, lang, expectedGroup1) => {
    const m = matchError(REAL_LIB, lang as never, REAL[key])
    expect(m, `没命中：${key}`).not.toBeNull()
    if (expectedGroup1) expect(m!.vars[1]).toBe(expectedGroup1)
    // 命中的必须是本语言那份规则，不是 common 兜底
    expect(m!.rule).toBe(REAL_LIB[lang]!.find((r) => r.pattern === m!.rule.pattern))
  })

  /**
   * 这条是上一组的对照组：**把语言钉成英文之前**，javac 吐的是 GBK 中文。
   * 规则一条也命中不了 —— 这就是为什么 runner 里那句 -J-Duser.language=en 不能删。
   */
  it('对照：javac 的中文报错（GBK 解出来之后）匹配不上英文规则', () => {
    const gbkDecoded = "Main.java:3: 错误: 需要';'\n        int a = 1\n                 ^\n1 个错误\n"
    expect(matchError(REAL_LIB, 'java', gbkDecoded)).toBeNull()
  })
})
