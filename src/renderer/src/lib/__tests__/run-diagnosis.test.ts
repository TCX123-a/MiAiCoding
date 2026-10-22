/**
 * 诊断卡（lib/run-diagnosis.ts）
 *
 * 【这个文件在守什么】
 * 「代码题答错之后说一句人话」这件事，坏法全是静默的：
 *   · 该说的时候不说 —— 就是主人 2026-09-22 报的那个洞（屏幕上只剩「下一题」）
 *   · 不该说的时候乱说 —— 学员还没交卷，界面先替他判了错
 *   · **指错行** —— 比重说还坏：他照着第 3 行改半天，错在第 7 行
 * 三种都不会抛错、不会在日志里留痕、界面看起来也完全正常。
 * 它们只能靠这里钉住。
 *
 * 【为什么把行号那些用例写得这么啰嗦】
 * `firstErrorLine()` 的正则是在**真产物的格式**上写的（四门语言的编译器
 * 各说各话）。这里逐门语言抄了一段真格式的报错进去，而不是自己编一段
 * "差不多"的 —— 编的那种只能证明正则和我的想象一致。
 */
import { describe, expect, it } from 'vitest'
import {
  clipForCard,
  DIAG_TEXT_MAX,
  diagnosisOf,
  failKindOf,
  firstErrorLine
} from '../run-diagnosis'
import type { DiagnosisInput } from '../run-diagnosis'
import type { RunResult } from '../../../../shared/types'

/** 造一个结果，只写这个文件在意的字段（其余给"正常"值） */
function res(over: Partial<RunResult>): RunResult {
  return {
    ok: false,
    phase: 'compile',
    stdout: '',
    stderr: '',
    exitCode: 1,
    timedOut: false,
    truncated: false,
    durationMs: 10,
    ...over
  }
}

/** 造一份诊断输入，只写用例在意的字段 */
function input(over: Partial<DiagnosisInput>): DiagnosisInput {
  return {
    result: null,
    running: false,
    submitted: false,
    wrong: false,
    expectedOutput: '3',
    ...over
  }
}

describe('failKindOf：这次是怎么没跑通的', () => {
  it('成功和"还没跑"都是 `null`（**不是**失败）', () => {
    expect(failKindOf(null)).toBeNull()
    expect(failKindOf(res({ ok: true, phase: 'run', exitCode: 0 }))).toBeNull()
  })

  it('编译期失败 → `compile`；运行期失败 → `run`', () => {
    expect(failKindOf(res({ phase: 'compile' }))).toBe('compile')
    expect(failKindOf(res({ phase: 'run', exitCode: 139 }))).toBe('run')
  })

  it('**超时优先于阶段** —— 卡在编译里的超时不能说成"编译报错"', () => {
    // 真实的超时结果里 `phase` 就是 `compile`（编译器跑太久被掐断）。
    // 先认 `phase` 的话，学员会收到「看看第 N 行的报错」，
    // 而那段报错里一行 error 都没有 —— 因为代码只是在死循环。
    expect(failKindOf(res({ phase: 'compile', timedOut: true }))).toBe('timeout')
    expect(failKindOf(res({ phase: 'run', timedOut: true }))).toBe('timeout')
  })

  it('**环境问题排最前面** —— 编译器没装不能说成"你代码写错了"', () => {
    // 环境缺失时 `ok` 是 false、`phase` 也可能是 `compile`，
    // 但屏幕上那段代码**完全正确**。并进 `compile` 的话，
    // 一个没装 gcc 的人会收到「喵！代码没跑起来，看看第 7 行的报错喵～」。
    expect(failKindOf(res({ envIssue: true }))).toBe('env')
    expect(failKindOf(res({ envIssue: true, timedOut: true }))).toBe('env')
  })
})

describe('firstErrorLine：报错里第一个该看的行号', () => {
  it('C / C++（gcc）：`文件:行:列: error:`', () => {
    const stderr = [
      'main.c: In function \'main\':',
      "main.c:7:5: error: 'retrun' undeclared (first use in this function)",
      '    7 |     retrun 0;',
      '      |     ^~~~~~'
    ].join('\n')
    expect(firstErrorLine(stderr)).toBe(7)
  })

  it('Java（javac）：`文件:行: error:`', () => {
    const stderr = [
      'Main.java:7: error: \';\' expected',
      '    System.out.println("喵")',
      '                        ^',
      '1 error'
    ].join('\n')
    expect(firstErrorLine(stderr)).toBe(7)
  })

  it('C#：`文件(行,列): error`', () => {
    const stderr = [
      'Program.cs(7,23): error CS1002: ; expected',
      '',
      'Build FAILED.'
    ].join('\n')
    expect(firstErrorLine(stderr)).toBe(7)
  })

  it('Python（traceback）：取**最后一条** `File` —— 那是真正炸掉的那一行', () => {
    const stderr = [
      'Traceback (most recent call last):',
      '  File "main.py", line 12, in <module>',
      '    go()',
      '  File "main.py", line 7, in go',
      '    return 1 / 0',
      'ZeroDivisionError: division by zero'
    ].join('\n')
    // 取第一条（12）就会指到调用链上游 —— 学员去改一个完全无辜的函数
    expect(firstErrorLine(stderr)).toBe(7)
  })

  it('**C 取最靠前的那条**（按"出现位置"，不是按 pattern 的书写顺序）', () => {
    const stderr = [
      'main.c:3:1: error: unknown type name \'nt\'',
      'main.c:9:5: error: expected \';\' before \'}\' token',
      'main.c:14:3: error: too few arguments to function \'printf\''
    ].join('\n')
    // gcc 按源码顺序报错，第一条是最该先修的；后面的常常是它的连锁反应
    expect(firstErrorLine(stderr)).toBe(3)
  })

  it('认不出来 → `null`（**不是** 0，也不是 1）', () => {
    expect(firstErrorLine('')).toBeNull()
    // 链接错误：到处是 `:数字:`，但没有一处是"行号"
    expect(
      firstErrorLine(
        'C:\\Users\\x\\7\\main.c: undefined reference to `go\'\ncollect2.exe: error: ld returned 1 exit status'
      )
    ).toBeNull()
    // Python 的 ImportError 只有 traceback 头、没有可指的行
    expect(firstErrorLine("ModuleNotFoundError: No module named 'PIL'")).toBeNull()
  })

  it('**不拿"第一个 `:数字:`"凑数** —— 段落偏移、路径里的数字不算行号', () => {
    // `(.text+0x1a)` 这种如果被当成行号，界面会理直气壮地指着一行说"这儿错了"
    expect(firstErrorLine('/usr/bin/ld: (.text+0x1a4): undefined reference')).toBeNull()
    // 开了 `-Wall` 但代码没错时，stderr 里只有 warning。它们**长得和 error 一样**
    // （同样带 `:行:列:`），拿它当行号就会给一条**根本没出错**的代码指错行。
    const onlyWarnings = [
      "main.c:4:9: warning: unused variable 'x' [-Wunused-variable]",
      "main.c:7:9: warning: unused variable 'y' [-Wunused-variable]"
    ].join('\n')
    expect(firstErrorLine(onlyWarnings)).toBeNull()
  })

  it('**Python 认出来了就不再看 C/Java 的那几条**（同一段正文会被多条命中）', () => {
    // traceback 里夹着一行看起来像 gcc 的文本（比如打印出来的报错串）
    const stderr = [
      'Traceback (most recent call last):',
      '  File "main.py", line 5, in <module>',
      '    print("main.c:99:1: error: 这是字符串里的字")',
      'NameError: name \'x\' is not defined'
    ].join('\n')
    expect(firstErrorLine(stderr)).toBe(5)
  })
})

describe('clipForCard：裁到卡片放得下', () => {
  it('短文本原样返回', () => {
    expect(clipForCard('3')).toBe('3')
  })

  it('**保留换行** —— 压成一行就把题目改了', () => {
    // 「三行 1/2/3」和「一行里三个数用空格隔开」是两道不同的题。
    // 学员照着压平的那份改，永远改不对。
    expect(clipForCard('1\n2\n3')).toBe('1\n2\n3')
    // 中间的空行也不能塌 —— 它同样是题目的一部分
    expect(clipForCard('1\n\n2')).toBe('1\n\n2')
  })

  it('**行内的空格一个不动** —— `"3"` 和 `" 3"` 是两个不同的输出', () => {
    expect(clipForCard(' 3')).toBe(' 3')
    expect(clipForCard('a  b')).toBe('a  b')
  })

  it('CRLF 归一、行尾空白和首尾空行去掉（**判分是这么比的**）', () => {
    // 这一条不是"顺手清理"，是让卡片显示的和判分**实际比过**的那份完全一致：
    // 卡片自己留一套规则的话，最坏会显示成"两份输出一模一样，却说他不对"。
    expect(clipForCard('\r\n1\r\n2\r\n')).toBe('1\n2')
    expect(clipForCard('3   \n')).toBe('3')
    expect(clipForCard('3\t')).toBe('3')
  })

  it('超长就截断，而且**让截断看得见**', () => {
    const long = 'a'.repeat(DIAG_TEXT_MAX + 50)
    const out = clipForCard(long)
    expect(out.length).toBe(DIAG_TEXT_MAX + 1)
    expect(out.endsWith('…')).toBe(true)
    // 不加省略号的话，学员看到的是一个**被悄悄改短的期望值**，
    // 照着它改还是不对，还以为是软件在骗他
    expect(clipForCard('a'.repeat(DIAG_TEXT_MAX))).toBe('a'.repeat(DIAG_TEXT_MAX))
  })

  it('**截断之后还看得见的部分，和判分比的那份逐字一致**', () => {
    /*
     * 这是上面那条"转调 normalizeRunOutput"的真正理由，写成断言才守得住：
     * 两份字符串**在裁剪之后仍有差别**，正对应着判分认为它们**不相等**。
     * 反过来的坏情况是：判分说不相等、卡片却显示成一样的 ——
     * 那学员会盯着两张一模一样的输出发呆。
     */
    const expected = '1\n2\n3\n'
    const actual = '1\n2\n4\n'
    expect(clipForCard(expected)).not.toBe(clipForCard(actual))
  })
})

describe('diagnosisOf：什么时候该说话、说哪一句', () => {
  it('**正在跑 → 什么都不说**（手上那份结果已经是上一版代码的了）', () => {
    const r = res({ phase: 'compile', stderr: 'main.c:7:5: error: boom' })
    expect(diagnosisOf(input({ result: r, running: true }))).toBeNull()
  })

  it('还没跑过 → 什么都不说', () => {
    expect(diagnosisOf(input({ result: null }))).toBeNull()
  })

  it('**编译失败 → 说，而且指到行**（这才是他第一次能拿到反馈的时刻）', () => {
    // 真跑题型在编译失败时 `canSubmit` 是假的（见 stores/quiz.ts），
    // 他连交都交不上去 —— 所以这个诊断只能在「跑跑看」之后给。
    const r = res({ phase: 'compile', stderr: 'main.c:7:5: error: boom' })
    expect(diagnosisOf(input({ result: r }))).toEqual({
      kind: 'fail',
      failKind: 'compile',
      line: 7,
      expected: '',
      actual: ''
    })
  })

  it('编译失败但认不出行号 → 还是说，`line` 给 `null`（文案另有一套说法）', () => {
    const r = res({ phase: 'compile', stderr: 'collect2.exe: error: ld returned 1 exit status' })
    const d = diagnosisOf(input({ result: r }))
    expect(d?.kind).toBe('fail')
    expect(d?.line).toBeNull()
  })

  it('跑一半崩了 / 超时 → 都算 `fail`（各自的 `failKind` 分开）', () => {
    expect(diagnosisOf(input({ result: res({ phase: 'run', exitCode: 139 }) }))?.failKind).toBe(
      'run'
    )
    expect(diagnosisOf(input({ result: res({ phase: 'run', timedOut: true }) }))?.failKind).toBe(
      'timeout'
    )
  })

  it('**环境问题 → 一句话都不说**（指着一段正确的代码说它有问题，比不说还坏）', () => {
    // `message` 已经在引导他去设置页装编译器了。再盖一张"代码没跑起来"，
    // 等于告诉他"你的第 7 行错了" —— 而屏幕上的第 7 行完全正确。
    const r = res({ phase: 'compile', envIssue: true, message: '没找到 gcc 喵' })
    expect(diagnosisOf(input({ result: r }))).toBeNull()
  })

  it('**跑通了、还没交 → 什么都不说**（判分是提交才发生的事）', () => {
    const r = res({ ok: true, phase: 'run', exitCode: 0, stdout: '5\n' })
    expect(diagnosisOf(input({ result: r, submitted: false }))).toBeNull()
    // 交是交了、但判的是对的
    expect(diagnosisOf(input({ result: r, submitted: true, wrong: false }))).toBeNull()
  })

  it('**跑通了、交了、判错了 → 说，并给出「期望 / 得到」**', () => {
    const r = res({ ok: true, phase: 'run', exitCode: 0, stdout: '5\n' })
    expect(
      diagnosisOf(input({ result: r, submitted: true, wrong: true, expectedOutput: '3' }))
    ).toEqual({
      kind: 'output',
      failKind: null,
      line: null,
      expected: '3',
      // 末尾那个换行不算数（判分也是这么比的），所以显示成 `'5'`
      actual: '5'
    })
  })

  it('「期望 / 得到」都要过裁剪（多行不压平、超长带省略号）', () => {
    const r = res({ ok: true, phase: 'run', exitCode: 0, stdout: '1\n2\n3\n4\n' })
    const d = diagnosisOf(
      input({ result: r, submitted: true, wrong: true, expectedOutput: '1\n2\n3\n' })
    )
    expect(d?.expected).toBe('1\n2\n3')
    expect(d?.actual).toBe('1\n2\n3\n4')
  })

  it('**失败优先于"输出不对"** —— 一份结果不能同时说两句', () => {
    // 编译失败的结果里 stdout 是空的，`expected` 是 `3`，看起来也"不对"。
    // 两档都判的话，卡片上会同时出现「没跑起来」和「期望 3 得到 空」——
    // 后者会让他以为代码跑过了。
    const r = res({ phase: 'compile', stderr: 'main.c:7:5: error: boom' })
    const d = diagnosisOf(input({ result: r, submitted: true, wrong: true, expectedOutput: '3' }))
    expect(d?.kind).toBe('fail')
    expect(d?.expected).toBe('')
    expect(d?.actual).toBe('')
  })
})
