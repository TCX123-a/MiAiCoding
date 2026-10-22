/**
 * 真跑判分的输出比对契约（src/shared/run-grading.ts）
 *
 * 【这个文件在守什么】
 * `normalizeRunOutput()` 的四条规则**每一条都不会报错** —— 它错了的症状是
 * "学员代码明明跑对了却判错"。而这个症状**肉眼看两份输出一模一样**
 * （差的那个字符是 `\r`、是行尾空格、是看不见的），所以只能靠这里钉住。
 *
 * ⚠️ 最要紧的是第一条（换行统一）。四门语言的工具链在 Windows 上吐出的 stdout
 * 全部是 `\r\n`（实测见 `<workspace>/_crlf-probe.mjs`，不随仓库分发），而运行器的解码环节不剥 `\r`。
 *
 * 下面有一组测试对比 `normalizeCode()` —— 它**曾经**是"另写一个"的全部理由
 * （那份实现漏了 CRLF 这一条），2026-09-15 起改为转调本函数，那组测试就翻成了
 * "钉住两者不会再分叉"。为什么值得留一组专门盯这件事，见那一组的注释。
 */
import { describe, expect, it } from 'vitest'
import { gradeByRun, isRunGraded, normalizeRunOutput, verdictFromRun } from '../run-grading'
import { normalizeCode } from '../quiz-grading'
import type { CodeFixQuestion, RunResult } from '../types'

const Q: CodeFixQuestion = {
  id: 'q1',
  type: 'codefix',
  lang: 'c',
  brokenCode: 'int main(void){ retrun 0; }',
  stem: '改对它',
  expectedOutput: '3',
  referenceFix: 'int main(void){ return 0; }',
  explanation: 'x'
}

/** 一次"编译过了、跑完了、正常退出"的结果 */
function ok(stdout: string): RunResult {
  return {
    ok: true,
    phase: 'run',
    stdout,
    stderr: '',
    exitCode: 0,
    timedOut: false,
    truncated: false,
    durationMs: 10
  }
}

describe('normalizeRunOutput：四条契约', () => {
  it('① CRLF 和孤立的 CR 都当成 LF', () => {
    expect(normalizeRunOutput('3\r\n')).toBe('3')
    expect(normalizeRunOutput('a\r\nb')).toBe('a\nb')
    expect(normalizeRunOutput('a\rb')).toBe('a\nb')
    expect(normalizeRunOutput('a\r\r\nb')).toBe('a\n\nb')
  })

  it('② 去每行的行尾空白（空格和 Tab）', () => {
    expect(normalizeRunOutput('a  \nb\t\n')).toBe('a\nb')
    expect(normalizeRunOutput('a   \r\nb')).toBe('a\nb')
  })

  it('③ 去首尾的空行，但**中间的空行留着**', () => {
    expect(normalizeRunOutput('\n\na\n\n')).toBe('a')
    expect(normalizeRunOutput('a\n\nb')).toBe('a\n\nb') // 中间那行是内容，去了就是改答案
  })

  it('④ 大小写敏感 —— 这一条靠"什么都不做"实现', () => {
    expect(normalizeRunOutput('Hello')).toBe('Hello')
    expect(normalizeRunOutput('Hello')).not.toBe(normalizeRunOutput('hello'))
  })

  it('**行首和行内的空格是有意义的**，只去行尾', () => {
    // 缩进过的输出（打印一个三角形之类的题）靠的就是行首空格
    expect(normalizeRunOutput('   a\n  bb')).toBe('   a\n  bb')
  })

  it('**全角空格不是行尾空白** —— 它是内容', () => {
    // 故意只写 `[ \t]` 而不是 `\s`：中日文排版里全角空格是真的会出现在输出里的
    // （比如对齐用的表头），`\s` 会把它悄悄吃掉，那就是替学员改了答案
    expect(normalizeRunOutput('喵\u3000')).toBe('喵\u3000')
    expect(normalizeRunOutput('喵 ')).toBe('喵')
  })

  it('空串进空串出，不抛错', () => {
    expect(normalizeRunOutput('')).toBe('')
    expect(normalizeRunOutput('\r\n')).toBe('')
  })
})

/**
 * 【这一组曾经叫"⚠️ 为什么不能拿 normalizeCode() 顶替它"】
 *
 * 它原来钉的是"这两个函数**不能**互换"：`normalizeCode()` 去行尾空白用的是 `[ \t]+$`，
 * 而 `\r` 不在 `[ \t]` 里，所以 `normalizeCode("3\r\n")` 得到 `"3\r"`、
 * 跟写 LF 的内容怎么比都不相等。当时定的方向是"另写一个"，
 * 并且在这一组里留了一句判断 —— **合并只可能朝一个方向走**：
 * 让 `normalizeCode` 也认 CRLF（代价是要动四种现有题型的判分），
 * 而不是让真跑那条链路去掉这条规则（那是每一道真跑题都判错）。
 *
 * 2026-09-15 把那个方向走完了：`normalizeCode()` 现在**转调** `normalizeRunOutput()`。
 * 于是这一组从"钉住差异"翻成了"钉住合并" —— 差异已经没有价值了，
 * 剩下的风险变成**有人再把它们拆成两份实现**。
 */
describe('normalizeCode() 与 normalizeRunOutput() 是同一份契约', () => {
  it('曾经分叉的那一格（CRLF）现在跟真跑那条链路一致', () => {
    expect(normalizeCode('3\r\n')).toBe('3')
    expect(normalizeCode('3\r\n')).toBe(normalizeCode('3'))
    expect(normalizeCode('a\r\nb')).toBe('a\nb')
    expect(normalizeCode('a\rb')).toBe('a\nb')
  })

  it('**任意输入上都不分叉** —— 哪天有人把它们拆成两份实现，这条就红', () => {
    // 样例把四条规则各自的边界都点了一遍，另外多留了几个"曾经分叉"的 CRLF 形状：
    // 只测 `'a\nb'` 这种干净输入的话，两份实现可以差着一条规则还全绿。
    const samples = [
      'a\nb',
      'a  \nb',
      '\n\na\n\n',
      '   a\n  bb',
      '',
      'Hello',
      '喵　',
      '3\r\n',
      'a\r\nb',
      'a\rb',
      'a\r\r\nb',
      'a   \r\nb',
      '\r\n',
      '喵　 ',
      'a\n\nb'
    ]
    for (const s of samples) {
      expect(normalizeCode(s), `两者在 ${JSON.stringify(s)} 上分叉了`).toBe(normalizeRunOutput(s))
    }
  })
})

describe('gradeByRun：两份输出算不算同一份', () => {
  it('原样相等就是对', () => {
    expect(gradeByRun('3', '3')).toBe(true)
  })

  it('**学员那一份带 CRLF、内容那一份写的是 LF → 判对**', () => {
    // 这是真机上的默认情况：内容是在编辑器里写的（LF），
    // 学员的输出来自 gcc/java/python（CRLF）。不统一换行的话，
    // **每一道真跑题都会判错**，而且看输出一模一样
    expect(gradeByRun('a\nb', 'a\r\nb\r\n')).toBe(true)
  })

  it('末尾多一个换行、每行多几个行尾空格 → 都判对', () => {
    expect(gradeByRun('3', '3\n')).toBe(true)
    expect(gradeByRun('a\nb', 'a  \nb\t\n')).toBe(true)
  })

  it('**大小写不同就是错** —— 程序输出的大小写就是内容本身', () => {
    expect(gradeByRun('Hello', 'hello')).toBe(false)
  })

  it('少一行、多一行、中间差一个空格 → 都判错', () => {
    expect(gradeByRun('a\nb', 'a')).toBe(false)
    expect(gradeByRun('a', 'a\nb')).toBe(false)
    expect(gradeByRun('a b', 'a  b')).toBe(false) // 行内空白不折叠（和 fill 不一样）
  })

  it('期望输出是空串时，空输出判对（不特判）', () => {
    // 理由见 run-grading.ts：这里的"作答"是程序输出，空输出可能是正确答案
    // （"写个什么都不打印的程序"）。要拦空输出，该拦的是内容侧的 expectedOutput
    expect(gradeByRun('', '')).toBe(true)
    expect(gradeByRun('', 'x')).toBe(false)
  })
})

describe('verdictFromRun：三态', () => {
  it('没跑过 → null（不是 false）', () => {
    // 【这条是整组里最要紧的】把"没跑过"和"答错了"混成一个 false，
    // 界面就会在学员**还没开始做**的时候显示「答错了」
    expect(verdictFromRun(Q, null)).toBeNull()
  })

  it('编译没过 → null，**不判错**', () => {
    // 改错题的常态就是第一次编不过（给他的本来就是会报错的代码）。
    // 判成"答错"的后果：他一次都没改就先被记进错题本，
    // 而且界面会显示「应该是：3」—— 那是把答案告诉他了
    const compileFail: RunResult = {
      ok: false,
      phase: 'compile',
      stdout: '',
      stderr: 'error: expected ;',
      exitCode: 1,
      timedOut: false,
      truncated: false,
      durationMs: 300
    }
    expect(verdictFromRun(Q, compileFail)).toBeNull()
  })

  it('跑起来了但非零退出（崩了）→ null，输出不可信', () => {
    const crash: RunResult = { ...ok('3'), ok: false, exitCode: 139, stderr: 'Segmentation fault' }
    expect(verdictFromRun(Q, crash)).toBeNull()
  })

  it('超时 → null（`ok` 是 false，输出是半截的）', () => {
    const timeout: RunResult = { ...ok(''), ok: false, timedOut: true, exitCode: null }
    expect(verdictFromRun(Q, timeout)).toBeNull()
  })

  it('跑通了 → 比输出，对/错都说得出', () => {
    expect(verdictFromRun(Q, ok('3\n'))).toBe(true)
    expect(verdictFromRun(Q, ok('4\n'))).toBe(false)
  })

  it('环境问题（编译器没装）→ null，更不能算学员答错', () => {
    const env: RunResult = { ...ok(''), ok: false, envIssue: true, message: 'x' }
    expect(verdictFromRun(Q, env)).toBeNull()
  })
})

describe('isRunGraded：要真跑的那两类', () => {
  it('认得出 codefix / codewrite', () => {
    expect(isRunGraded({ type: 'codefix' })).toBe(true)
    expect(isRunGraded({ type: 'codewrite' })).toBe(true)
  })

  it('**同步判分那四类一个都不许进来**', () => {
    // 这个函数是"要不要走真跑路径"的分水岭。多放一个进来，
    // 那道题就会去找一个永远不存在的运行结果 —— 表现是**永远不能提交**
    expect(isRunGraded({ type: 'choice' })).toBe(false)
    expect(isRunGraded({ type: 'fill' })).toBe(false)
    expect(isRunGraded({ type: 'code' })).toBe(false)
    expect(isRunGraded({ type: 'codefill' })).toBe(false)
  })
})
