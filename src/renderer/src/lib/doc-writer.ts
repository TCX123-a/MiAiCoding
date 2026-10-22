/**
 * 本地写协议（docs/21 §8.2）的**渲染层执行器** —— 「整份写」的三份文档
 * （profile / favorites / memo）共用的一台机器。
 *
 * 【它负责什么】四个动作收在一处：
 *   ① 戳的保管与转发：读口/写口给回的 `{epoch, rev}` 收着，下一次写原样带回；
 *   ② 变更日志（journal）：每个用户动作记一条**具体变更**（不是"重放函数"），
 *      保存成功才清空 —— 「用户操作永不丢」的落点就是它；
 *   ③ 冲突 → 重载 + 重放 + 再写：主进程回 `{current, stamp}`（一个字节都没写），
 *      这台机器把 current 装进 store、把 journal 在它之上重放、带新戳重写；
 *   ④ 答题会话挂起：会话进行中（quiz-gate）不做重载重放 —— 会把会话脚下的
 *      状态换掉；挂起由 `resolveNow()`（会话结束的安全点）统一收账。
 *
 * 【journal 为什么记"具体变更"而不是回调】回调是活的：它闭包着当时的对象，
 * 重放时反而不知道"当时到底改了什么"。具体变更（谁把哪条设成了什么）在
 * 任何基座上重放都得到同一结局 —— 而且天然幂等（applyOp 全是 ensure 语义）。
 *
 * 【飞行中又来的新操作（最容易写错的一处）】一次写从 snapshot 到回话隔着
 * 一次 IPC 往返，其间用户完全可以再点两下。所以成功清账用 **splice(0, n)**
 * ——只清这次写**确实带上了**的前 n 条；飞行中新增的留给排队的下一次写。
 * 图省事写成 `journal = []` 的话，那两下点击就在"保存成功"的喜庆里被静默丢掉。
 *
 * ⚠️ 本文件在 `src/renderer/src` 下、被文案闸门扫，**字符串一律英文**。
 */
import type { BoxStamp, DocWriteResult, StampedDoc } from '../../../shared/doc-write'

/** 冲突后的重写轮数上限（每轮 = 重载 + 重放 + 再写一次）；超了挂起到下一安全点 */
export const MAX_WRITE_ROUNDS = 3

export interface DocWriterDeps<F, Op, W = F> {
  /**
   * 真的写一次（preload 的整份写口）；stamp=null = 读口还没给过戳（无条件下写）。
   * 载荷类型是 `W` 而不是 `F`：读侧可以更宽（profile 的读口/冲突回话可以是
   * `null` = 还没建档），而**写侧永远是一份完整文档** —— 这份不变量由
   * `snapshot()` 的返回类型担保，不用在调用点上强转。
   */
  save(payload: W, stamp: BoxStamp | null): Promise<DocWriteResult<F>>
  /** 重载：从主进程读最新一份（读口带戳）。安全点协调器用它换掉陈旧状态 */
  reload(): Promise<StampedDoc<F>>
  /** store 当前状态的纯数据快照（toIpc 的包装由调用方在 snapshot 里做） */
  snapshot(): W
  /** 把主进程权威的一份装进 store 状态（含 loaded 标记/派生字段重算） */
  adopt(data: F): void
  /** 重放一条变更（**幂等 ensure 语义** —— 与 UI 动作分开写，别复用带副作用的动作） */
  applyOp(op: Op): void
  /** 现在能不能做重载重放（答题会话进行中要挂起，见 quiz-gate） */
  canResolve(): boolean
  /** 写失败（拉到异常，不是冲突）时出声；冲突路径**不响铃**（它会被处理掉） */
  onError(err: unknown): void
  /**
   * 写**成功**一次之后（P10.6 同步节拍用）：只在真的写下去（`res.ok`）时调 ——
   * 冲突/失败/挂起都不算"本地写了新东西"。典型接法是往 local-write-bus 广播，
   * 由节拍器防抖触发云同步；重试成功也会再调一次，防抖在节拍器那侧吸收。
   */
  onSaved?(): void
  log?(line: string): void
}

export interface DocWriter<Op> {
  /** 记一条变更（调用方**已经**把变更应用到 live 状态了 —— 这里只管记账） */
  record(op: Op): void
  /**
   * 立即写一次（防抖到点 / 退出冲刷 / 测试）；与在飞的写自动排队。
   * **账本空且没有待收的账时是 no-op** —— 渲染层对文档的每一处改动都记了账，
   * 账本空 = 没有未保存的东西。没有这道闸，adopt（冲突重载/同步重载都会
   * 改动 store 状态 → 防抖 → 这里）会把刚装进来的主进程数据原样写回去。
   */
  writeNow(): void
  /** 安全点收账：挂起过的冲突在这里统一「重载 → 重放 → 保存」。
   *  `force=true` 连没挂起过的也重载（同步协调器换了盘面时用） */
  resolveNow(force?: boolean): void
  /** 等在飞的全部写完（激活/登出前的干涸协议；beforeunload 来不及等，尽力） */
  whenIdle(): Promise<void>
  /** 别的通道（签到/发图的回包）带回了新戳 —— 收下，免得下次写误撞屏障 */
  noteStamp(stamp: BoxStamp): void
  /** 测试与诊断：当前戳 / 待重放条数 */
  currentStamp(): BoxStamp | null
  pendingCount(): number
}

export function createDocWriter<F, Op, W = F>(deps: DocWriterDeps<F, Op, W>): DocWriter<Op> {
  let stamp: BoxStamp | null = null
  let journal: Op[] = []
  /** 有冲突被挂起过（会话结束后即使 journal 空也要重载一次） */
  let needsResolve = false
  /** 每文档一条串行链：两次写永不在飞面上重叠（戳校验的立足点） */
  let chain: Promise<void> = Promise.resolve()

  const log = deps.log ?? ((): void => {})

  /** 装进最新一份 + 把未保存的变更在它之上重放（同步完成，中间不 await） */
  function adoptAndReplay(data: F): void {
    deps.adopt(data)
    for (const op of journal) deps.applyOp(op)
  }

  /**
   * 写一次。返回这次尝试的结局：
   *   ok       = 写下去了（飞行中新增的变更可能还留在 journal 里，由排队的下次写收尾）
   *   conflict = 撞屏障（已被 adoptAndReplay 收编；journal 空 = 已彻底解决）
   *   error    = 抛了（出声、journal 原样）
   *   deferred = 撞屏障且会话中，挂起
   */
  async function saveOnce(): Promise<'ok' | 'conflict' | 'error' | 'deferred'> {
    // 只清"这次确实带上"的前 n 条：snapshot 之后、回话之前新记的变更不算数
    const covered = journal.length
    let res: DocWriteResult<F>
    try {
      res = await deps.save(deps.snapshot(), stamp)
    } catch (err) {
      deps.onError(err)
      return 'error'
    }
    if (res.ok) {
      stamp = res.stamp
      if (covered > 0) journal.splice(0, covered)
      if (journal.length === 0) needsResolve = false
      deps.onSaved?.()
      return 'ok'
    }
    // 冲突：一个字节都没写。收下现戳与最新数据
    stamp = res.stamp
    needsResolve = true
    if (!deps.canResolve()) {
      log(`conflict (${res.code}) deferred: session active`)
      return 'deferred'
    }
    log(`conflict (${res.code}) -> reload + replay`)
    adoptAndReplay(res.current)
    return 'conflict'
  }

  /** 在串行链里跑一轮完整尝试（带有限重写轮数；绝不丢 journal） */
  async function attemptWrite(): Promise<void> {
    for (let round = 0; round < MAX_WRITE_ROUNDS; round++) {
      const outcome = await saveOnce()
      if (outcome === 'ok') {
        // 飞行中新增了没被这次写覆盖的变更 → 再来一轮（链上通常已有排队的写，
        // 这里兜底保证 journal 非空就不会停在"没人负责"的状态）
        if (journal.length === 0) return
        continue
      }
      if (outcome === 'error' || outcome === 'deferred') return
      // conflict：adoptAndReplay 已发生。journal 空 = 已解决；非空 = 重放过了，再写
      if (journal.length === 0) {
        needsResolve = false
        return
      }
    }
    log(`still conflicting after ${MAX_WRITE_ROUNDS} rounds; deferred to next safe point`)
  }

  function enqueue(task: () => Promise<void>): Promise<void> {
    chain = chain.then(task)
    return chain
  }

  return {
    record(op) {
      journal.push(op)
    },

    writeNow() {
      void enqueue(async () => {
        if (journal.length === 0 && !needsResolve) return
        await attemptWrite()
      })
    },

    resolveNow(force = false) {
      void enqueue(async () => {
        if (!force && journal.length === 0 && !needsResolve) return
        if (!deps.canResolve()) {
          // 会话中不换脚下状态 —— 记着，等会话结束（onQuizIdle → resolveNow）
          needsResolve = true
          log('resolve deferred: session active')
          return
        }
        let env: StampedDoc<F>
        try {
          env = await deps.reload()
        } catch (err) {
          deps.onError(err)
          return
        }
        stamp = env.stamp
        adoptAndReplay(env.data)
        if (journal.length === 0) {
          needsResolve = false
          return
        }
        await attemptWrite()
      })
    },

    whenIdle() {
      return chain.then(() => undefined)
    },

    noteStamp(next) {
      stamp = next
    },

    currentStamp: () => stamp,
    pendingCount: () => journal.length
  }
}
