/**
 * 「代码题没做对」时，那张**诊断卡**要显示什么。
 *
 * 【它和 `run-result-view.ts` 的分工】
 * 那一份回答「这次运行**本身**是什么样的」——成功还是失败、超时还是环境缺失、
 * 报错讲解卡该取哪条规则。这一份只回答诊断卡那一句话和那两个数：
 * **是编译失败还是输出不对、错在第几行、期望什么拿到什么**。
 *
 * 【为什么单独一个文件，而不是写在 `QuizCodeRun.vue` 里】
 * 这里全是纯字符串活：从编译器/解释器的报错里挑出「第几行出的事」，
 * 把可能很长的输出裁到卡片放得下。写在组件里就一条都测不了
 * （本项目的单测跑在无 DOM 环境），而算错的后果是**指错行** ——
 * 那比不指还糟：学员照着第 3 行找半天，错其实在第 7 行。
 *
 * 【为什么它自己不认识「答案是什么」】
 * 判分仍然只有一条路（`shared/run-grading.ts` 的 `verdictFromRun`）。
 * 这个文件只负责**把已经判出来的结论翻译成人话**，绝不再算一次对错 ——
 * 两份判据迟早漂移，而漂移的表现是「界面说你错了、判分说你对了」。
 */
import type { RunResult } from '../../../shared/types'
import { normalizeRunOutput } from '../../../shared/run-grading'
import { errorTextOf } from './run-result-view'

/**
 * 这次是**怎么**没跑通的。`null` = 压根没失败。
 *
 * 【为什么环境问题要单独一档，不能并进 `compile`】
 * 「编译器没装」和「你代码写错了」对学员是两件完全不同的事，
 * 该说的话也完全不同：前者要引导去设置页，后者要指路到出错的那一行。
 * 并成一档的话，一个没装 gcc 的人会收到「看看第 7 行的报错喵」——
 * 而他的第 7 行一点问题都没有，屏幕上那段代码完全正确。
 *
 * 【判断顺序不能换】
 * 超时的结果里 `phase` 可能是 `compile`（卡在编译），先认 `timedOut` 才不会
 * 把「跑太久被掐断」说成「编译报错」。`envIssue` 排最前面同理：
 * 环境缺失时 `ok` 是 false，但它**不是**学员的代码有问题。
 */
export type RunFailKind = 'compile' | 'run' | 'timeout' | 'env'

export function failKindOf(r: RunResult | null): RunFailKind | null {
  if (!r || r.ok) return null
  if (r.envIssue) return 'env'
  if (r.timedOut) return 'timeout'
  return r.phase === 'compile' ? 'compile' : 'run'
}

/* ──────────────────────────────────────────────────────────── 报错行号 */

/**
 * 四门语言的报错里，行号长什么样。**每一条都对应真产物里见过的格式。**
 *
 *   C / C++（gcc / g++）  `main.c:7:5: error: 'retrun' undeclared ...`
 *   Java（javac）         `Main.java:7: error: ';' expected`
 *   C#                    `Program.cs(7,5): error CS1002: ; expected`
 *   Python（traceback）   `  File "main.py", line 7, in <module>`
 *
 * 【为什么必须要求 `error` / `line` 这种显式标记，不能退而求其次去猜】
 * 退而求其次就是「拿第一个 `:数字:` 当行号」。而链接错误里到处是这种东西：
 * `C:\Users\x\7\main.c` 这样的路径、`(.text+0x1a)` 这样的段偏移、
 * `collect2.exe: error: ld returned 1 exit status` 这种压根没有行号的报错。
 * 猜错的表现是**理直气壮地指着一个正确的行说"这里错了"** ——
 * 比不指路坏得多。认不出来返回 `null`，界面那边有专门的措辞接住它。
 */
const LINE_PATTERNS: RegExp[] = [
  /:(\d+):\d+:\s*(?:fatal\s+)?error\b/g, // gcc / g++：文件:行:列: error:
  /:(\d+):\s*(?:fatal\s+)?error\b/g, // javac：文件:行: error:
  /\((\d+),\d+\):\s*(?:fatal\s+)?error\b/g, // C#：文件(行,列): error
  /File "[^"]*",\s*line\s+(\d+)/g // Python：File "x.py", line 7
]

const isPythonPattern = (i: number): boolean => i === LINE_PATTERNS.length - 1

/**
 * 报错正文里「第一个该看的行号」。认不出来返回 `null`。
 *
 * 【为什么 C/Java 取**最靠前**的那条，Python 却取**最靠后**的那条】
 * 这不是随手定的，两种工具的输出顺序正好相反：
 *   · gcc / javac **按源码顺序**报错，第一条就是最靠前、最该先修的那个
 *     （后面的错误常常是第一处错误的连锁反应，改完第一条会自己消失）
 *   · Python 的 traceback **从最外层往里写**，最后一条 `File` 才是真正炸掉的那一行
 * 取错的表现是**指到调用链的上游**：学员按提示改了一个完全无辜的函数。
 *
 * 【为什么按「出现位置」排而不是按 pattern 的先后】
 * 同一段报错可能被多条 pattern 同时命中（gcc 的 `main.c:7:5: error:` 会被前两条都匹配）。
 * 按出现位置取最靠前的那一个，结果就和 pattern 的书写顺序无关 ——
 * 以后往表里加一条新格式，也不会把现有语言的判定挪走。
 */
export function firstErrorLine(text: string): number | null {
  if (!text) return null

  const hits: { at: number; line: number }[] = []
  let python: { at: number; line: number } | null = null

  /*
   * 用 `for` 而不是 `forEach`：`python` 是"哪条命中"的累加器，
   * 写进回调里的话，TS 的控制流分析看不见那次赋值（它不认为回调一定会跑），
   * 于是下面 `if (python)` 会把 `python` 收窄成 `never`，`python.line` 直接编译不过。
   * 这不是编译器的怪癖值得绕，而是**这段逻辑本来就属于当前作用域**。
   */
  for (let i = 0; i < LINE_PATTERNS.length; i++) {
    const re = LINE_PATTERNS[i]
    // 每条 pattern 都带 `g`，跨行正文里要能反复匹配；每次从头扫之前先把 lastIndex 归零
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const line = Number(m[1])
      if (!Number.isFinite(line) || line <= 0) continue
      if (isPythonPattern(i)) {
        // 取最靠后的那条：traceback 从最外层往里写（理由见上）
        if (!python || m.index >= python.at) python = { at: m.index, line }
      } else {
        hits.push({ at: m.index, line })
      }
    }
  }

  if (python) return python.line
  if (hits.length === 0) return null
  // 取最靠前的那条 —— 按**出现位置**而不是 pattern 的书写顺序（理由见上）
  return hits.reduce((a, b) => (b.at < a.at ? b : a)).line
}

/* ──────────────────────────────────────────────────────────── 裁剪 */

/** 一张卡能显示的字符上限。超了就截，并且**让截断看得见**（尾巴上加省略号） */
export const DIAG_TEXT_MAX = 160

/**
 * 把一段可能很长、还可能有多行的文本裁到卡片放得下。
 *
 * 【为什么保留换行，不把整段压成一行】
 * 期望输出常常是好几行（`1\n\n2\n3`），压成一行会变成「1 2 3」——
 * 而「三行」和「一行里三个数用空格隔开」**是两道不同的题**，
 * 学员照着压平的那份改，永远改不对。保留换行，卡片用 `pre-wrap` 渲染。
 *
 * 【为什么先过 `normalizeRunOutput()`，而不是自己写一遍换行处理】
 * 判分用的就是那个函数（见 `shared/run-grading.ts`，那里写着"不许各写一份"）。
 * 卡片自己写一套的话，两份规则迟早漂成两个判据 —— 最坏的那种漂法在这里：
 * **卡片显示的两份输出一模一样，却告诉他"不对"**（因为判分吃掉了某个
 * 屏幕上根本看不见的差异，而卡片没吃掉、也没显示出来）。
 * 转调它之后，卡片上显示的就是判分**实际比过**的那两份字符串，一分不多一分不少。
 *
 * ⚠️ 顺带记住它**不动行内的空格**：`"3"` 和 `" 3"` 是两个不同的输出。
 * 那不算"看不见的差异"，学员数得出来。
 *
 * 【为什么截断要加省略号】
 * 不加的话，学员看到的是一个**被悄悄改短的期望值**，而他不知道那是残缺的 ——
 * 于是照着它改，改了还是不对，还以为是软件在骗他。
 * （这也是唯一一处卡片会比判分**少**信息的地方，所以那个省略号必须显眼。）
 */
export function clipForCard(text: string, max = DIAG_TEXT_MAX): string {
  const s = normalizeRunOutput(text)
  if (s.length <= max) return s
  return s.slice(0, max) + '…'
}

/* ──────────────────────────────────────────────────────────── 什么时候给诊断 */

/**
 * 诊断卡要显示的两档。
 *
 * `fail`   —— 这次运行**根本没成功**（编译不过 / 跑一半崩了 / 超时）。
 *             触发的时刻是**点「跑跑看」之后**：真跑题型在这种状态下
 *             `canSubmit` 是假的（见 stores/quiz.ts），他连交都交不上去，
 *             所以这是他唯一能拿到反馈的时刻。
 * `output` —— 跑成功了、也交卷了，但**输出和题目要的不一样**。
 *             触发的时刻是**点「提交」之后**。
 */
export type RunDiagnosisKind = 'fail' | 'output'

export interface RunDiagnosisView {
  kind: RunDiagnosisKind
  /** `kind === 'fail'` 时才有；`env` 那一档不会走到这里（见 `diagnosisOf`） */
  failKind: 'compile' | 'run' | 'timeout' | null
  /** 报错里第一个有意义的行号。认不出来是 `null`，文案会换一种说法 */
  line: number | null
  /** `kind === 'output'` 时才有：题目要的输出、他跑出来的输出（都已裁剪） */
  expected: string
  actual: string
}

export interface DiagnosisInput {
  /** 最近一次运行的结果（`null` = 还没跑过 / 改了代码作废了） */
  result: RunResult | null
  /** 正在编译运行 —— 上面那份结果已经是上一版的了，不许拿来诊断 */
  running: boolean
  /** 这一版**已经交过卷**（`session.checked[i]`） */
  submitted: boolean
  /** 交的那一版**判错了** */
  wrong: boolean
  /** 题目要的输出（`question.expectedOutput`） */
  expectedOutput: string
}

/**
 * 现在该不该给诊断卡、给哪一张。`null` = 这一格什么都不显示。
 *
 * 【它为什么是纯函数、放在这儿而不是写在组件里】
 * 「什么时候该说话」是这个功能最容易做坏的地方，而坏法全是静默的：
 * 该说的时候不说（就是原来那个 bug）、不该说的时候乱说（学员还没交卷，
 * 界面先替他判了错，等于告诉他"你这份不用改了"）。这里把它钉成一张
 * 四行的状态表，单测直接跑。
 *
 * 【为什么环境问题（`envIssue`）不给诊断卡】
 * 那不是他代码的错，`message` 已经在引导他去设置页装编译器了。
 * 再盖一张「代码没跑起来」等于**指着一段完全正确的代码说它有问题** ——
 * 这正是 `run-result-view.ts` 里讲解卡特意避开 `envIssue` 的同一个理由。
 *
 * 【为什么"跑通了但没交"也不给】
 * 学员手上那份代码的输出**就是他自己跑出来的**，他正对着看呢。
 * 这时候跳出来说「结果好像不对」是在替他下结论 —— 而他可能正打算改。
 * 判分是提交才发生的事，反馈也该跟着它走。
 */
export function diagnosisOf(input: DiagnosisInput): RunDiagnosisView | null {
  const { result, running, submitted, wrong, expectedOutput } = input
  if (running || !result) return null

  const fail = failKindOf(result)
  if (fail && fail !== 'env') {
    return {
      kind: 'fail',
      failKind: fail,
      line: firstErrorLine(errorTextOf(result)),
      expected: '',
      actual: ''
    }
  }

  // 走到这儿要么没失败、要么是环境问题。环境问题不进诊断卡，所以只剩"输出不对"
  if (!result.ok || !submitted || !wrong) return null
  return {
    kind: 'output',
    failKind: null,
    line: null,
    expected: clipForCard(expectedOutput),
    actual: clipForCard(result.stdout)
  }
}
