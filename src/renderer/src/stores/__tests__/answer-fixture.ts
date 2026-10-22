/**
 * 测试夹具：给一道题造一个「正确作答」/「错误作答」。
 *
 * 【为什么值得单独一个文件】
 * 好几个测试都要"把这一局答完"（验证记账、错题本收录、分数统计），
 * 原来每个文件各写一遍 `String(q.answer)` —— 那行代码**假设了每道题的答案
 * 都是一个可以直接读出来的字符串**。加了 `codefill` 之后这个假设不成立了：
 * 它的答案在 `blanks` 里，一个空一段，得拼回去才算一次作答。
 *
 * 于是三处同时编译不过。各修各的当然也行，但那样"什么算答对一道题"这件事
 * 就有了三份定义，而它恰恰是这些测试**唯一在意**的东西 —— 三份里任何一份
 * 写歪，测试就会变成在验证一件别的事，而且照样全绿。
 *
 * ⚠️ 这里**故意不调用 `gradeQuestion()` 反推出答案**。用判分函数生成正确作答，
 * 再去断言判分函数的结果，是拿同一个东西证明它自己 —— 判分要是错了，
 * 测试一起错，永远红不了。
 */
import type { Question, RunResult } from '../../../../shared/types'
import { joinCodeFillAnswer } from '../../../../shared/codefill'

/** 一个**必然错**的作答。各题型通用：没有任何题型的答案是这个字符串 */
export const WRONG_ANSWER = '__错的__'

/**
 * 这道题的正确作答，形状与会话里存的一致（choice 是下标，其余是字符串）。
 *
 * ⚠️ **真跑题型（codefix / codewrite）给不出"正确作答"** —— 这是它们和其余
 * 五个题型的根本区别：判对错靠的是**真编译真运行之后输出对不对**，
 * 而不是"这段文本等不等于那段文本"。所以这里返回的是参考解
 * （内容里那份"跑得对"的代码），但**光把它填进会话是判不出对的**：
 * 同步的判分路径收不到真跑题型（`gradeQuestion` 的参数类型就排除了它们）。
 *
 * 于是用这两类题型的测试必须**自己驱动一次真跑**（`quiz.recordRun(假结果)`
 * → `quiz.submitRun()`），不能走 `answerAll()`。
 * 返回参考解而不是抛错，是为了让"混合了六种题型"的会话仍能构造出来 ——
 * 那种会话恰恰是最该被测的（票据、分数、错题本都得跟着对）。
 */
export function correctAnswerOf(q: Question): string | number {
  if (q.type === 'choice') return q.answer
  if (q.type === 'codefill') return joinCodeFillAnswer(q.blanks.map((b) => b.answer))
  if (q.type === 'codefix') return q.referenceFix
  if (q.type === 'codewrite') return q.referenceSolution
  return q.answer
}

/** 这道题的一个错误作答。选择题要给一个**合法但不等于答案**的下标 */
export function wrongAnswerOf(q: Question): string | number {
  if (q.type === 'choice') return q.answer === 0 ? 1 : 0
  return WRONG_ANSWER
}

/**
 * 真跑题型用的**假 RunResult**。
 *
 * 【为什么必须造假货，而且假货要尽量像真的】
 * 单测跑不了真编译器（要工具链、要几秒、还依赖机器上装没装 gcc），
 * 所以注入一个假结果。项目里零 `vi.mock`，所有替身都是**显式传进去的**，
 * 这个也一样：它就是一个普通对象，调用方自己传。
 *
 * `ok` 那个字段是判定的分水岭（见 shared/run-grading.ts 的 `verdictFromRun`），
 * 所以造了两个入口而不是一个带布尔参数的函数 —— 调用处
 * `runOk('3')` / `runFailed('3')` 一眼就读得出来，不用去回想 true 是哪一头。
 */
export function runOk(stdout: string): RunResult {
  return {
    ok: true,
    phase: 'run',
    stdout,
    stderr: '',
    exitCode: 0,
    timedOut: false,
    truncated: false,
    durationMs: 12
  }
}

/** 编译没过：`ok: false` 且 `phase: 'compile'`，stdout 是空的（和真运行器一致） */
export function runCompileError(stderr = 'error: expected ;'): RunResult {
  return {
    ok: false,
    phase: 'compile',
    stdout: '',
    stderr,
    exitCode: 1,
    timedOut: false,
    truncated: false,
    durationMs: 300
  }
}

/** 跑起来了但非零退出（比如越界崩了），输出不可信 */
export function runCrashed(stdout = ''): RunResult {
  return {
    ok: false,
    phase: 'run',
    stdout,
    stderr: 'Segmentation fault',
    exitCode: 139,
    timedOut: false,
    truncated: false,
    durationMs: 40
  }
}
