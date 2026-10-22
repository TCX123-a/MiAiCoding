/**
 * 「运行结果 → 界面该显示什么」的翻译层。
 *
 * 【为什么要从组件里抽出来】
 * 这段逻辑是一张**状态表**：有没有结果、在不在跑、成功还是失败、
 * 是编译错还是运行错、超时了没、输出被截断了没、有没有环境问题……
 * 组合起来十几种，每一种对应界面上一套不同的显示。
 *
 * 藏在 .vue 里的话，这十几种组合一个都测不了（本项目的单测跑在无 DOM 环境）。
 * 而其中任何一格搞错，用户看到的就是**明确的错误信息**：
 * 超时显示成「跑完啦」、环境没装却甩出一句 "spawn gcc ENOENT"、
 * 程序没输出时界面一片空白让人以为卡死了。所以抽成纯函数，用单测钉住。
 */
import { CRASH_UI, ERROR_UI, RUNNER_UI } from './copy'
import { matchError } from '../../../shared/error-match'
import { RUN_MASCOT_POSE, type MascotPose, type RunMascotState } from './mascot'
import type { ErrorLib, LangOfCode, RunResult } from '../../../shared/types'

/**
 * 退出码是不是「程序被系统强行按停」——这种崩法**一个字都不会打印**，只能靠退出码认。
 *
 * 【为什么认区间而不是认几个具体值】
 * Windows 的 NTSTATUS 错误码都带 `0xC` 前缀，正常程序自己退出的码都是小数字
 * （`return 3` 就是 3）。所以「落在 0xC0000000–0xCFFFFFFF」这一条就够把两者分开，
 * 不必穷举——穷举反而会把没见过的崩法漏成一片空白。
 *
 * 【上界为什么是 0xCFFFFFFF 而不是 0xFFFFFFFF】
 * `return -1` 的退出码就是 0xFFFFFFFF。把上界开到 0xFFFFFFFF，
 * 一个老老实实 `return -1` 的程序会被当成「崩溃」，弹出一张「你碰了不该碰的内存」——
 * 那是**指着一段完全正确的代码说它错了**，比不显示更糟。
 */
const CRASH_LO = 0xc0000000
const CRASH_HI = 0xcfffffff

function crashCard(exitCode: number | null): ErrorCardView | null {
  if (exitCode === null || exitCode === 0) return null
  const u = exitCode >>> 0 // Node 报的可能是负值（-1073741819），先折算成无符号再比
  if (u < CRASH_LO || u > CRASH_HI) return null

  const pick = {
    0xc0000005: [CRASH_UI.ACCESS_VIOLATION_TITLE, CRASH_UI.ACCESS_VIOLATION_EXPLAIN, CRASH_UI.ACCESS_VIOLATION_FIX],
    0xc00000fd: [CRASH_UI.STACK_OVERFLOW_TITLE, CRASH_UI.STACK_OVERFLOW_EXPLAIN, CRASH_UI.STACK_OVERFLOW_FIX],
    0xc0000094: [CRASH_UI.DIVIDE_BY_ZERO_TITLE, CRASH_UI.DIVIDE_BY_ZERO_EXPLAIN, CRASH_UI.DIVIDE_BY_ZERO_FIX],
    0xc0000409: [CRASH_UI.ABORTED_TITLE, CRASH_UI.ABORTED_EXPLAIN, CRASH_UI.ABORTED_FIX]
  }[u] ?? [CRASH_UI.UNKNOWN_TITLE, CRASH_UI.UNKNOWN_EXPLAIN, CRASH_UI.UNKNOWN_FIX]

  return { matched: false, tag: CRASH_UI.TAG, title: pick[0], explain: pick[1], fixHint: pick[2] }
}

/**
 * 报错讲解卡。命中内置规则和走兜底话术，在界面上是**同一张卡片的两种状态**——
 * 组件只管照着三个字段渲染，不必知道这次到底命中没命中。
 */
export interface ErrorCardView {
  /** 命中了内置规则（false = 走兜底话术） */
  matched: boolean
  /** 卡片顶上的小标签 */
  tag: string
  title: string
  explain: string
  fixHint: string
}

/** 输出区当前处于哪个大状态 */
export type RunPhase = 'idle' | 'running' | 'done'

/** 结果条的颜色倾向 */
export type RunTone = 'ok' | 'bad' | 'warn'

export interface RunView {
  phase: RunPhase
  tone: RunTone
  /** 结果条上那句话；idle / running 时为空 */
  statusText: string
  /**
   * 这句话长不长到必须**单独占一块**说，而不是挤在结果条上。
   *
   * 结果条那句是单行省略号截断的（max-width: 42ch），塞不下整段解释。
   * 主进程给的 message（「翻译官喵」没找到 Python」之类）动辄两三句，
   * 只放结果条会被截成半句话——用户看到「…设置里手动填一下」这种尾巴，
   * 完全不知道在说什么。所以 message 一律走下面的正文块，完整显示。
   */
  showMessage: boolean
  stdout: string
  stderr: string
  /** stderr 该不该显示给用户看（环境问题时不显示，理由见实现） */
  showStderr: boolean
  /** 跑完了、没报错、但一个字都没打印 */
  showNoOutput: boolean
  /**
   * 编译**过了**、编译器却仍说的话（`-Wall` 的告警等）。空串 = 编译器没吭声。
   *
   * 它和 `stdout` 是**两条通道**，绝不能并成一条：stdout 是判分依据，
   * 往里掺一行告警，学员就会看到「代码明明写对了却判错」——
   * 而且肉眼看输出一模一样，极难查。告警只是给人看的线索。
   *
   * 实测 458 次成功编译里有 48 次会走到这一格（另有 12 次退出码 0
   * 的运行往 stderr 写了字）。在这一条之前它们全被丢掉，
   * 而好几篇课文正讲着「翻译官喵会嘀咕一句 warning: …」。
   */
  compileWarnings: string
  showCompileWarnings: boolean
  /** 输出被截断过，要给一句「只显示了一部分」 */
  truncated: boolean
  /** 用时该不该显示 */
  showDuration: boolean
  durationMs: number
  /** 是环境问题（编译器没装），界面要引导去设置页 */
  envIssue: boolean
  /**
   * 原生模式那一行：**这一趟是谁跑的**（3.0）。空串 = 这一趟不是原生跑的。
   *
   * 【为什么非写不可】原生模式下跑出来的结果可能和之前不一样（版本不同、
   * 报错不同）。不写明是谁跑的，用户的第一反应是「软件坏了」——
   * 而真相是他自己在设置里打开开关换来的。有这一行，两边就能对上账。
   */
  nativeLine: string
  /** 报错讲解卡；null = 这次不显示 */
  errorCard: ErrorCardView | null
  /**
   * 输出区那条小鱼该摆什么姿态；null = 这一格不摆鱼（还没跑过）。
   *
   * 放在这里而不是让组件自己按 ok/running 拼：组件里一拼就是第二份「成功/失败」
   * 的判断逻辑，和上面 statusText、tone 那两处迟早会走岔 ——
   * 到时候会出现「结果条说失败、小鱼在庆祝」这种自相矛盾的画面。
   */
  mascotPose: MascotPose | null
}

/** 讲解卡需要知道「哪门语言的规则」和「规则库在哪」，都得从外面递进来 */
export interface RunViewContext {
  lang: LangOfCode
  errorLib: ErrorLib | undefined
}

/**
 * 这次失败**报错正文在哪**：编译器/解释器都把错误写 stderr，没有才退回 stdout
 * （有的程序自己把错误打印到标准输出）。
 *
 * 【为什么要导出，而不是让下面那个函数自己留着】
 * 诊断卡（`lib/run-diagnosis.ts`）也要从同一段文本里挑行号。它在组件里
 * 另写一遍 `stderr || stdout` 的话，两处就有了两份「哪条通道算报错」的规则 ——
 * 漂移的表现是**讲解卡讲的是这条错、诊断卡指的是另一条错的行号**，
 * 两条都对不上，而没有任何地方会报错。
 */
export function errorTextOf(r: RunResult): string {
  return r.stderr.trim() ? r.stderr : r.stdout
}

export function runView(
  result: RunResult | null,
  running: boolean,
  ctx?: RunViewContext
): RunView {
  const r = result
  const phase: RunPhase = running ? 'running' : r ? 'done' : 'idle'

  const stdout = r?.stdout ?? ''
  const stderr = r?.stderr ?? ''
  const compileWarnings = r?.compileWarnings ?? ''
  const envIssue = !!r?.envIssue

  // ── 结果条上的话。message 优先：那是主进程给的针对性解释，
  //    比自己按 ok/phase 拼出来的笼统话有用得多
  let statusText = ''
  if (r && !running) {
    if (r.message) statusText = r.message
    else if (r.timedOut) statusText = RUNNER_UI.TIMED_OUT
    else if (!r.ok) statusText = r.phase === 'compile' ? RUNNER_UI.COMPILE_FAILED : RUNNER_UI.FAILED
    else statusText = RUNNER_UI.OK
  }

  // ── 配色。注意 message 一律算「坏」：那是主进程在说「这事没成」
  let tone: RunTone = 'ok'
  if (r && !running) {
    if (!r.ok || r.timedOut || r.message) tone = 'bad'
    else if (r.truncated) tone = 'warn'
  }

  // ── 报错讲解卡
  //
  // 每一种「不显示」都对应一个真实会出岔子的场合：
  //   · 还在跑 / 还没跑 —— 没有结果可讲
  //   · 跑成功了 —— 没什么要解释的
  //   · 环境问题 —— 那不是用户代码的错，message 已经在引导他去装环境了；
  //     这时候再盖一张「这条错喵没学过」，等于把人往错误方向带
  //   · 超时 —— 同上，message 已经说了「跑太久被掐断」
  //   · message 非空 —— 主进程已经给了针对性的解释（环境缺失、没写 class 等），
  //     再叠一张卡就是两套说法打架，用户不知道该信哪个
  //   · 一个字都没输出 —— 程序可能只是自己退了个非零码，没有报错可讲
  const explainable = !!r && !running && !r.ok && !r.envIssue && !r.timedOut && !r.message
  const errText = explainable ? errorTextOf(r) : ''
  let errorCard: ErrorCardView | null = null
  if (errText.trim()) {
    // ctx 缺席 = 调用方根本没给规则库。那就没得查，直接走兜底 ——
    // 不给 `ctx?.lang ?? 'python'` 这种瞎猜的默认值：猜错了会去查另一门语言的规则，
    // 命中的是一条跟眼前报错无关的解释，比查不到还糟。
    const hit = ctx ? matchError(ctx.errorLib, ctx.lang, errText) : null
    errorCard = hit
      ? { matched: true, tag: ERROR_UI.TAG, title: hit.title, explain: hit.explain, fixHint: hit.fixHint }
      : {
          matched: false,
          tag: ERROR_UI.FALLBACK_TAG,
          title: ERROR_UI.FALLBACK_TITLE,
          explain: ERROR_UI.FALLBACK_EXPLAIN,
          fixHint: ERROR_UI.FALLBACK_FIX
        }
  } else if (explainable) {
    // 跑挂了、却一个字都没有 —— 那就是被系统按停了。
    //
    // 【为什么不能什么都不显示】
    // 原来的行为就是「什么都不显示」：结果条红着脸报失败，下面一片空白。
    // 而这恰恰是 C 语言最高频的崩溃（碰了不该碰的内存），用户最需要解释的时候
    // 反而一个字都没有，只能以为软件坏了。crashCard 认不出退出码时会返回 null，
    // 那就维持原样（程序自己 return 了非零码，确实没什么好解释的）。
    errorCard = crashCard(r.exitCode)
  }

  // ── 输出区那条小鱼
  //
  // 复用上面已经算好的 phase / tone，**不重新判断一遍 ok 和 running**。
  // 尤其是 tone：它把「有 message」也算成坏（主进程在说「这事没成」），
  // 小鱼跟着 tone 走，就不会出现「结果条红着脸、小鱼却在比心」。
  // 还没跑过就不摆鱼 —— 空输出区本来就有一句「点上面的按钮跑跑看」，
  // 再塞条鱼进去，用户会以为那鱼是输出内容的一部分。
  const mascotState: RunMascotState | null =
    phase === 'running' ? 'running' : phase === 'done' ? (tone === 'bad' ? 'fail' : 'ok') : null
  const mascotPose: MascotPose | null = mascotState ? RUN_MASCOT_POSE[mascotState] : null

  // ── 原生模式那一行（3.0）
  // 只在**这一趟真的是原生跑的**才出现。没跑完不显示（那时还不知道是谁跑的），
  // 托管模式也不显示 —— 绝大多数用户从没打开过那个开关，
  // 给他们每次都在输出区顶上多一行「这一趟用的是应用自己的编译器」是噪音。
  // `managed` 透传（2026-10-01）：解析到的若是应用自管的工具链，文案要如实点名，
  // 理由见 RUNNER_UI.NATIVE_LINE 的注释。
  const nativeLine =
    r && !running && r.native
      ? RUNNER_UI.NATIVE_LINE(r.native.command, r.native.resolved, r.native.managed)
      : ''

  return {
    phase,
    tone,
    statusText,
    showMessage: !!r && !running && !!r.message,
    stdout,
    stderr,
    // 环境没装时不显示 stderr：那种 stderr 是 "spawn gcc ENOENT" 之类的
    // 系统原话，对零基础的人只有恐吓效果，而 message 已经用猫咪话讲清了。
    // 编译错则相反——编译器原话是最有价值的线索，一个字都不能藏。
    //
    // ★ 原生模式（3.0）是**例外中的例外**：那条 `envIssue`（「你 PATH 里没有
    //   gcc」）底下藏的 stderr 常常是 cmd.exe 的中文原话（「'gcc' 不是内部或
    //   外部命令…」），它**就是**真实原因，藏掉之后用户只剩一句猫咪话，
    //   既不知道去找什么、也不知道去哪找。所以原生那一趟一律照显示。
    showStderr: stderr.trim().length > 0 && (!envIssue || !!r?.native),
    showNoOutput: !!r && !running && r.ok && !r.message && !stdout.trim() && !stderr.trim(),
    // 告警块和「一个字都没打印」是两件事，互不抑制：程序没输出、编译器却提了醒，
    // 这是真实且常见的一格，两个都该说。
    compileWarnings,
    showCompileWarnings: !!r && !running && compileWarnings.length > 0,
    truncated: !!r && !running && r.truncated,
    // 用时为 0 的场合（比如环境没装就直接返回了）不显示，免得出现「用时 0.00 秒」这种废话
    showDuration: !!r && !running && r.durationMs > 0,
    durationMs: r?.durationMs ?? 0,
    envIssue,
    nativeLine,
    errorCard,
    mascotPose
  }
}
