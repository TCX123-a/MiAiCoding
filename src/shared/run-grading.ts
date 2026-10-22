/**
 * 真跑判分（`codefix` / `codewrite`）—— **输出比对契约的唯一实现**。
 *
 * 【为什么这些题型不能走 `quiz-grading.ts`】
 * `choice` / `fill` / `code` / `codefill` 的答案都是**一个精确字符串**，
 * 判分是纯函数、同步返回 boolean。改错题和写代码大题的答案是"一整段学员自己写的代码" ——
 * 「怎么改」有无数种写法，唯一的判据是**跑起来之后输出对不对**。所以要真编译真运行，
 * 要 `await`，而且是**异步**的。
 *
 * 【为什么不能顺手把 `gradeQuestion` 改成 async】
 * 那会动到四种现有题型的判分路径和它们的全部单测，只为了新题型的能力。
 * 更糟的是：一旦某处漏了 `await`，会拿到一个 Promise 对象当成真值去比 ——
 * **判分静默失效**，是最难查的那种 bug。所以老路径一行不改，新题型走这个文件。
 *
 * 【本文件是纯的】
 * 编译运行那件事（IPC、临时目录、超时）全在调用方，这里只有两个字符串
 * 和两个"题型形状"的搬运工（起始代码、兜底结果）。
 * 于是它能被单测直接跑，不需要起 Electron、不需要工具链。
 */
import { RUNNER } from './copy'
import type { RunGradedQuestion, Question, RunResult } from './types'

/**
 * 归一化一份**程序输出**。
 *
 * 四条规则，逐条都对应 `docs/09-内容生成规范.md`「真跑判分的输出比对契约」，
 * 而且**不是实现细节、是内容契约** —— 写 `expectedOutput` 的人按同一套规则来：
 *
 *   1. **换行统一**：`\r\n` 和孤立的 `\r` 都当作 `\n`
 *   2. **去掉每行的行尾空白**（空格和 Tab）
 *   3. **去掉首尾的空行**
 *   4. **大小写敏感** —— `Hello` 和 `hello` 是两个不同的输出（这条靠"什么都不做"实现）
 *
 * 也就是说：**行内和行首的空格有意义，行尾的空格和末尾的换行不算数。**
 *
 * ⚠️ **第 1 条不是锦上添花，是这条链路能不能用的前提。**
 * 2026-09-15 在本机实测（`<workspace>/_crlf-probe.mjs`，不随仓库分发），四门语言的工具链在 Windows 上
 * 吐出的 stdout **全部是 `\r\n`**；而运行器的解码环节不剥 `\r`（`runner.ts` 只做
 * 编码转换和 BOM 处理），`\r` 会一路活着到达这里。
 *
 * ⚠️ **本函数是这份契约的唯一实现，别的判分路径一律转调它，不许各写一份。**
 * 从前 `normalizeCode()`（`quiz-grading.ts`，管代码阅读题的"输出是什么"）
 * 自己手写了一份等价实现，**唯独漏了这一条**：实测 `normalizeCode("3\r\n")` 得到 `"3\r"`、
 * `normalizeCode("3")` 得到 `"3"`，两个不相等 —— 学员答案写得一字不差却判错，
 * 而肉眼看两份答案完全一样。这正是"两份规则迟早漂移成两个判据"的样子，
 * 所以现在 `normalizeCode()` 已经改成转调本函数了（见那个函数的注释）。
 *
 * ⚠️ 这里**故意不用 `\s+$`**：`\s` 会把全角空格、不换行空格之类也吃掉。
 * 那些字符在输出里是**内容**（比如中文排版用的全角空格），吃掉就是悄悄改了学员的答案。
 * 行尾要去的只有半角空格和 Tab。
 */
export function normalizeRunOutput(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
}

/**
 * 学员跑出来的输出，和内容里写死的 `expectedOutput`，是不是同一份。
 *
 * 【它只做比较，不做"该不该比"的判断】
 * 「编译失败了」「跑的时候炸了」「超时了」这三种情况下**输出根本不代表答案**，
 * 但那是调用方的判断（看 `RunResult.phase` 和退出码，然后去渲染报错讲解卡）。
 * 把那个判断塞进这里的话，这个函数就得认识 `RunResult`，也就不再是纯的了。
 * 分开之后：**"什么算跑对"在调用方，"两份输出算不算同一份"在这里。**
 *
 * 【为什么不像 `gradeCode` 那样把空作答判错】
 * `gradeCode` 的作答是学员**敲进输入框**的文本，空着显然是没答。
 * 这里的"作答"是**程序输出**，空输出可能是完全正确的答案
 * （比如"写个程序，什么都不打印"）。要拦空输出，该拦的是内容侧的
 * `expectedOutput`（校验器管），不是学员这边。
 */
export function gradeByRun(expectedOutput: string, actualOutput: string): boolean {
  return normalizeRunOutput(actualOutput) === normalizeRunOutput(expectedOutput)
}

/**
 * 一次真跑之后，这道题**到底算对、算错、还是还没跑通**。
 *
 * 返回值是**三态**，不是两态 —— 这是这个函数存在的全部理由：
 *
 *   · `null` = **还没跑通**（编译失败 / 超时 / 非零退出 / 环境问题）
 *   · `true` = 跑通了，输出和 `expectedOutput` 一致
 *   · `false` = 跑通了，但输出不对
 *
 * 【为什么不能把「没跑通」也当成「答错了」】
 * 改错题的**常态就是第一次跑不通** —— 学员拿到的本来就是会报错的代码。
 * 把编译失败算成"答错"的话：他连一次都没改，就先被记进错题本；
 * 而且界面上会显示「应该是：xxx」的正确输出 —— 那是**把答案直接告诉他**了。
 * 编译失败该走的是报错讲解卡（告诉他错在哪、怎么改），不是判分。
 *
 * 【判据用 `r.ok` 而不是自己拼 `exitCode === 0 && !timedOut`】
 * `ok` 就是运行器给的「编译过了、跑完了、正常退出」这一个结论（`runner.ts:425`），
 * 超时和编译失败都是 `ok: false`。在这里再拼一遍等价条件，等于同一个判断
 * 有两份实现 —— 运行器哪天改了口径（比如加个"退出了但 stderr 有内容"的档），
 * 这一份不会跟着变。
 */
export function verdictFromRun(q: RunGradedQuestion, r: RunResult | null): boolean | null {
  if (!r || !r.ok) return null
  return gradeByRun(q.expectedOutput, r.stdout)
}

/**
 * 这道题是不是**必须真跑才能判**。
 *
 * 别处要按这个分叉的地方有好几处（判分分发、作答界面、内容校验、提交按钮能不能点），
 * 每处各写一遍 `q.type === 'codefix' || q.type === 'codewrite'` 的话，
 * 将来加第三类真跑题型必然漏掉其中一处 —— 而漏掉的表现是**静默判错**。
 */
export function isRunGraded(q: Pick<Question, 'type'>): q is RunGradedQuestion {
  return q.type === 'codefix' || q.type === 'codewrite'
}

/**
 * 真跑题型**打开时编辑器里该是什么**。
 *
 * `codefix` 给的是那段坏代码（要改的就是它），
 * `codewrite` 给的是骨架（`starter`；Python 常常没有，那就是一张白纸）。
 *
 * 【为什么这条规则住在 shared，而不是写在 store 或组件里】
 * 「哪个字段是起始代码」和 `isRunGraded()` 是同一类知识 —— **题型的形状**。
 * 写在界面里的话，将来做「错题重做」时必然有人再写一遍
 * `q.type === 'codefix' ? q.brokenCode : q.starter`，两处一旦漂，
 * 表现是**同一个题型在两处给出不同的起始代码**：不报错、不崩溃，
 * 只是学员打开同一道错题，看到的代码和他上次做的那份不一样。
 */
export function initialCodeOf(q: RunGradedQuestion): string {
  return q.type === 'codefix' ? q.brokenCode : q.starter ?? ''
}

/**
 * 真跑题型**那道题的参考解**（`codefix` 是改好的那段，`codewrite` 是示范答案）。
 *
 * 它是 `initialCodeOf()` 的镜像：同一个「题型的形状」知识，一个管进门、一个管出门。
 * 理由也一样 —— 让界面自己写 `q.type === 'codefix' ? q.referenceFix : q.referenceSolution`
 * 的话，错题重做、回顾页、将来的"看示范"各抄一份，抄漏一处的表现是
 * **同一道题在两个地方给出不同的参考解**：不报错、不崩溃，只是学员照着 A 改、
 * 照着 B 又不对。
 *
 * 【它不是判分依据，别拿它去比】
 * 判分的唯一依据是 `expectedOutput`（见 `gradeByRun`）。参考解**只是一种**
 * 能过的写法 —— 学员写出不一样但输出相同的代码，照样判对。
 * 界面上必须把这句话说出来，否则学员会以为自己那份"跑对了但长得不像"
 * 的代码是错的。文案见 `QUIZ.REFERENCE_MORE`。
 */
export function referenceOf(q: RunGradedQuestion): string {
  return q.type === 'codefix' ? q.referenceFix : q.referenceSolution
}

/**
 * 「这次运行**根本没能开始**」—— 把 IPC 自己抛的错包成和正常结果同一种形状。
 *
 * 渲染层能撞上的只有两种：入参不合法、代码或输入超过 200KB（都挡在主进程门口，
 * 见 `runner.ts` 的守卫）。不包的话，界面那边接到的是一次 reject：
 * `runResults[i]` 一格都不动，学员点了「运行」看到的是**什么都没发生** ——
 * 不报错、不转圈、不显示，和"软件卡住了"长得一模一样。
 *
 * 【为什么它要放在这儿，而不是各家自己写一份】
 * 原来它长在 `stores/runner.ts` 里（练习场用），现在答题界面也要用。
 * 抄一份的话，两份的 `phase`、`message` 迟早会漂 —— 而漂了的表现是
 * **同一件事故在练习场和答题界面显示成两种样子**，没有任何地方会报错。
 */
export function failedRun(): RunResult {
  return {
    ok: false,
    phase: 'run',
    stdout: '',
    stderr: '',
    exitCode: null,
    timedOut: false,
    truncated: false,
    durationMs: 0,
    message: RUNNER.UNEXPECTED
  }
}
