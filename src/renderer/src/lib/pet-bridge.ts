/**
 * 主窗 → 桌宠的**上报口**（2026-10-06）。学习发奖、运行结果都从这里出去。
 *
 * 【为什么单独一层，而不是在 store 里直接 `window.miai.petAct(...)`】
 * 两件事值得被单独测、也值得只有一份实现：
 *   1. **"这次运行该不该告诉桌宠、说成什么"** 是一张判定表（环境问题不叫鱼、
 *      超时不指行、成功也要报），散在四五个调用点里迟早各写一份；
 *   2. 行号从哪来 —— 复用 `run-diagnosis` 的 `firstErrorLine` / `failKindOf`，
 *      绝不另写一套正则（那边文件头写死了「不许各写一份」，指错行比不指还糟）。
 *
 * 【为什么全部是"说了就走"（fire-and-forget）】
 * 桌宠是个挂件：它挂了、窗口没了、主进程还没起来，都**不该影响学习流程**。
 * 所以这里的每个出口都吞异常（拍一拍它的肩膀而已，拍空不叫事）；
 * 真正需要回话的场景（聊天）在宠物窗自己的 preload 里，不经过这一层。
 *
 * ⚠️ 异常有**两条**逃逸路，try/catch 只堵住一条：
 *   · 同步——`window.miai` 不存在（极早期 / 测试环境）或通道半通时直接抛；
 *   · 异步——`petAct` 是 invoke，主进程那头抛（`pet:act: controller not ready`，
 *     见 main/index.ts 的薄转发）会以**被拒绝的 Promise** 回来，try/catch 看不见它，
 *     不接就是渲染层控制台一条 Uncaught (in promise)。
 * 所以每个 invoke 出口都要 `.catch(() => {})`，两个兜底缺一不可。
 */
import type { RunResult } from '../../../shared/types'
import type { PetRewardKind, PetRunReport, PetSnapshot } from '../../../shared/pet'
import { failKindOf, firstErrorLine } from './run-diagnosis'
import { errorTextOf } from './run-result-view'

/** 视口矩形（CSS px）。形状与 `PetRunReport.rect` 对齐，由主进程换算成屏幕坐标 */
export interface PetViewRect {
  x: number
  y: number
  width: number
  height: number
}

export interface RunReportInput {
  /** 行号 → 编辑器里那一行的视口矩形（CodeEditor 的 lineRect）。拿不到返回 null */
  lineRect?: (line: number) => PetViewRect | null
  /** 兜底矩形（一般是输出区）：行号认不出来、或者行不在视口里时用它 */
  fallbackRect?: PetViewRect | null
  /**
   * 这趟跑的是不是"用户自己写的"（own 证据，2026-10-06 大白饭经济）。
   * 调用方在**跑之前**用种子指纹比对好（见 runner store 的 lastRunOwn）；
   * 缺省 false = 没证据 = 主进程不发奖（绝不默认回退为成功）。
   */
  own?: boolean
  /** 跑的那份代码的指纹（shared/code-hash）。主进程凭它去重：同一段只发一次奖 */
  hash?: string | null
}

/**
 * 把一次运行结果翻成给桌宠的上报。**返回 null = 这个结果不该惊动桌宠**。
 *
 * 【三个刻意的判定】
 * ① `envIssue`（编译器没装之类）不报：那不是学员代码的错，把鱼叫过去对着
 *    一段完全正确的代码说"这里错了"比不说话坏得多 —— 与诊断卡、讲解卡
 *    避开 envIssue 是同一条口径（见 run-diagnosis.ts）；
 * ② 成功也报（ok:true）：桌宠要"看到"学员跑通了才能表扬。判断"值不值得
 *    说一句"是主进程的事（那里有冷却与轮转），不是上报口的事 ——
 *    上报口只负责**如实**，策略留在唯一一处；
 * ③ 行号认不出来照样报（line:null，rect 退到 fallbackRect）：桌宠会说
 *    "认不出哪行"那一档台词，而不是干脆不出现。
 */
export function buildRunReport(
  res: RunResult | null,
  input: RunReportInput = {}
): PetRunReport | null {
  if (!res) return null
  const fail = failKindOf(res)
  if (fail === 'env') return null
  // ④ "我们的通道炸了"（failedRun()：没有退出码、没有任何输出、只有一句
  //    UNEXPECTED）也不报 —— 那不是学员代码的错。报出去的话，桌宠会对着
  //    一段完全正确的代码说"这行跑错了"。判据精确到"零证据"：
  //    真跑完的程序一定有退出码，超时有 timedOut，编译错误一定有 stderr。
  if (fail && res.exitCode === null && !res.timedOut && res.stdout === '' && res.stderr === '') {
    return null
  }
  // own/hash 在成功与失败两份上**都带**（主进程失败份不看——失败没有奖励可言，
  // 跑腿用不上它们）：形状统一，消费方与精确形状的单测都只需要盯一种形态。
  // 洗值在这里做（`=== true` / 字符串判定）：调用方从 store 来，形状自证合法，
  // 但这一层是给主进程的证据——证据不许含糊。
  if (!fail) {
    return {
      ok: true,
      kind: 'other',
      line: null,
      rect: input.fallbackRect ?? null,
      own: input.own === true,
      hash: typeof input.hash === 'string' ? input.hash : null
    }
  }
  const line = firstErrorLine(errorTextOf(res))
  const rect =
    (line !== null ? (input.lineRect?.(line) ?? null) : null) ?? input.fallbackRect ?? null
  return {
    ok: false,
    kind: fail,
    line,
    rect,
    own: input.own === true,
    hash: typeof input.hash === 'string' ? input.hash : null
  }
}

/** 上报一次运行结果（单向；桌宠不在也不打断） */
export function reportRunToPet(res: RunResult | null, input: RunReportInput = {}): void {
  const report = buildRunReport(res, input)
  if (!report) return
  try {
    window.miai.petReportRun(report)
  } catch {
    /* 桌宠通道不在（极早期 / 测试环境）—— 学习流程优先 */
  }
}

/**
 * 学习"收工"事件 → 好感度（P3 ④）：挑战完成 'challenge'（+3）、复习满分
 * 'review'（+5）。单向上报（对齐 reportRunToPet 的单向口径，同步 send，
 * 没有那条异步逃逸路）；没桌宠、没通道、超了日上限都静默 —— 加不加分是
 * 主进程的裁决（daily cap 在 brain），上报口只负责如实送达。
 */
export function reportPetEvent(kind: 'challenge' | 'review'): void {
  try {
    window.miai.petEvent(kind)
  } catch {
    /* 桌宠通道不在（极早期 / 测试环境）—— 学习流程优先 */
  }
}

/**
 * 学习动作发大白饭。三个调用点：课学完（lesson）、复习全对（review）、答对（answer）。
 * 不 await、不拦流程：奖是**发出去**就算的，落盘与广播由主进程管。
 * lessonId（只课学完时传）：随 grant 进大白饭账本当 ref.lessonId —— 服务端对
 * lesson 条目硬要求它（缺了整批 400，本地会把那条标 rejected 保余额）。
 * 条件展开而不是显式 undefined：未传 = 载荷里没这个键，与"洗掉"同形。
 *
 * 【返回值（V2-22 起）】把成功回话的**新快照**交给调用方，失败/通道不在给 null。
 * 「发出去就算了」的语义没变 —— 绝大多数调用点照旧 `void` 掉不看回话；
 * 只有答题的 +1 回执（quiz.ts 的 grantPetRiceOnce）会读它：拿快照里的
 * rice 跟发之前的余额比，**真涨了**才让界面报 +1（日上限 / 满仓那几笔
 * rice 不动 —— 界面不许报一笔没落下的账）。不 reject：这条口子永远
 * "坏消息吞掉"，调用方不需要 catch。
 */
export function grantPetRice(
  reward: PetRewardKind,
  lessonId?: string
): Promise<PetSnapshot | null> | null {
  try {
    return window.miai
      .petAct({ action: 'grant', reward, ...(lessonId ? { lessonId } : {}) })
      .then((snap) => snap ?? null)
      .catch(() => {
        /* invoke 拒绝（见文件头"两条逃逸路"）—— 学习流程优先 */
        return null
      })
  } catch {
    /* 同上 */
    return null
  }
}

/**
 * 答错一题 → 告诉桌宠。
 *
 * 【为什么三个字段都由渲染层带来】主进程没有内容包，算不出《X》是第几课，
 * 也不知道学员学没学过它 —— 那是 `content` / `progress` 两个 store 的事。
 * 查询与降级在 `lib/pet-wrong.ts`（拿不到课名就 title:null，主进程有通用
 * 台词，绝不编一个课名）。
 *
 * 【learned 是两条台词的分界】"这个明明教过"对着没学到那课的人说就是指责，
 * 所以主进程按它二选一（见 main/pet/index.ts doWrong）。
 */
export function reportWrongToPet(input: {
  title: string | null
  order: number | null
  learned: boolean
}): void {
  try {
    void window.miai
      .petAct({
        action: 'wrong',
        title: input.title,
        order: input.order,
        learned: input.learned
      })
      .catch(() => {
        /* invoke 拒绝（见文件头"两条逃逸路"）—— 上报失败就算了，学习流程优先 */
      })
  } catch {
    /* 同上 */
  }
}
