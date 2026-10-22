/**
 * 上行 runner（P10.x 上行接线）—— 流水推 → 流水拉 → 挑战结算，一趟跑完。
 *
 * 【它和 sync-engine 的分工】sync-engine 管四份**文档**（profile/wrongbook/…）；
 * 本模块管**事件**：大白饭流水（rice-ledger）与挑战结算（pending-ops）。两者骑
 * 同一个触发节拍（渲染层的同步按钮/定时器，P10.5 接线），但各自单飞、互不阻塞。
 *
 * 【单飞语义照抄 sync-engine】在飞时再次触发 = 并入当前轮（返回同一个 Promise），
 * 不排队、不并跑 —— 背靠背的触发在服务端看来就是限流表上的重复请求
 * （ricePushPerHourPerAccount=6，每条上行触发最多打 2 次 push：见 MAX_PUSH_ROUNDS
 * 的注释；触发节拍必须按「每小时几次」设计，不是每秒）。
 *
 * 【epoch 屏障】每处 await 之后、每次落盘之前都重验 box.epoch() —— 登录/登出/
 * 切号会让在途响应作废（它依据的是上一个盒的会话）。撞上就**弃轮**：已落盘的不
 * 回滚（都是幂等事实），未落盘的一律不写。
 *
 * 【push 响应的计数 → 键桥接】服务端 push 响应里 accepted/duplicated 是**计数**，
 * 只有 rejected[] 带键（rice.ts:61-74）。本地三态迁移需要键，所以：
 *   · 守恒（accepted+duplicated+rejected.length === 批大小）⇒ 拒收键以外的全部
 *     记「已入云」（它们确实都被服务端处置了，accepted/duplicated 对本地是同一
 *     件事：不用再推）；
 *   · 不守恒 ⇒ 服务端说了我们听不懂的话：**只**把 rejected[] 里点名（且确在
 *     本批）的标 'rejected'，其余全部保持 'pending' 等下次重推（幂等键兜底，
 *     宁可多推一次，绝不把没收下的标成已入云）。
 *
 * 【授权死亡的判据】UNAUTHENTICATED / TOKEN_EXPIRED ⇒ 整轮中止、authInvalid=true
 * （渲染层回登录页；本地数据一律保留）。其余失败分类处置：网络/429/5xx 停轮
 * （下次触发再来）；结算的 4xx 逐条记 attempts 继续下一条（一条坏账不堵后面）。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律英文**，中文只出现在注释里。
 */
import { RATE_LIMITS, RICE_PULL_LIMIT_MAX } from '../../shared/cloud/protocol'
import type {
  CloudFailureCode,
  RicePushEntry,
  RicePushResponse,
  UplinkResult
} from '../../shared/cloud/dto'
import { applyPull, applyPushResult, pendingEntries, type RiceEntry } from '../../shared/cloud/rice-ledger'
import type { StoreBox } from '../store/box'
import type { CloudChallengeClient } from './challenge'
import { markSettleAttempt, removeSettle, type PendingOpsStore } from './pending-ops'
import type { CloudRiceClient } from './rice'
import type { RiceJournal } from './rice-journal'

/** 单批条数 = 服务端 zod 硬顶（riceEntriesPerPush）；超发是整批 400 */
const PUSH_BATCH = RATE_LIMITS.riceEntriesPerPush

/**
 * 一趟上行里最多推几批。限流表是 6 次/时/账号 —— 一趟 2 批（400 条）给渲染层
 * 的触发节拍留了充足余量；积压再多也由后续轮次消化（幂等键让重推零代价）。
 */
const MAX_PUSH_ROUNDS = 2

/** 一次拉满（服务端上限）；分页直到短页或水位不前进 */
const PULL_LIMIT = RICE_PULL_LIMIT_MAX

/** 分页保护上限：一趟最多拉 5000 条（一次全量重建需要的量级） */
const MAX_PULL_PAGES = 10

export interface UplinkDeps {
  box: StoreBox
  journal: RiceJournal
  settleQueue: PendingOpsStore
  rice: CloudRiceClient
  challenge: CloudChallengeClient
  /** device.json 的 installId（上行每条请求都要它） */
  installId: string
  now?: () => Date
  /** 诊断行（默认不出声）—— 内容只许英文（文案闸门） */
  log?: (message: string) => void
}

// UplinkFailure / UplinkResult 的真源现在在 shared/cloud/dto.ts（P10.5 搬家：
// preload 只许 import shared/**，`cloud:sync-now` 通道要把两趟的结果一起回给
// 渲染层）。这里 re-export 保既有 import 面（含全部测试）不变。
export type { UplinkFailure, UplinkResult } from '../../shared/cloud/dto'

export interface Uplink {
  /** 跑一趟（单飞：在飞时并入当前轮）。除编程错误/磁盘故障外不抛。 */
  run(): Promise<UplinkResult>
  /**
   * 等在飞的那一趟结束（没有在飞 = 立刻 resolve）。**不新起趟** ——
   * 登出干涸协议（docs/21 §3.5.1）用：切盒前确认没有上行还会往旧盒写。
   * 永远 resolve（趟本身的异常不是干涸要处理的事，由 run 的调用方拿）。
   */
  whenIdle(): Promise<void>
}

function isAuthDead(code: CloudFailureCode): boolean {
  return code === 'UNAUTHENTICATED' || code === 'TOKEN_EXPIRED'
}

/** 账本条目 → 上行形状：剥掉 cloud 三态字段（服务端不认识它，多了会 400） */
function stripForPush(e: RiceEntry): RicePushEntry {
  return { entryKey: e.entryKey, kind: e.kind, delta: e.delta, dayKey: e.dayKey, at: e.at, ref: e.ref }
}

/**
 * push 计数 → 键的桥接（见文件头）。导出给测试直接钉住守恒与不守恒两支。
 */
export function adaptPushOutcome(
  pushed: RiceEntry[],
  resp: RicePushResponse
): {
  accepted: string[]
  duplicated: string[]
  rejected: Array<{ entryKey: string; reason: string }>
  conservationBroken: boolean
} {
  const batchKeys = new Set(pushed.map((e) => e.entryKey))
  // 服务端点名的拒收键若不在本批里（理论上不该发生），一律不采信 —— 不计入
  // 本地迁移、也会让守恒判定失败（保守分支）
  const rejected = resp.rejected
    .filter((r) => batchKeys.has(r.entryKey))
    .map((r) => ({ entryKey: r.entryKey, reason: `${r.code}: ${r.detail}` }))
  const rejectedKeys = new Set(rejected.map((r) => r.entryKey))

  const conserved = resp.accepted + resp.duplicated + resp.rejected.length === pushed.length
  if (!conserved) {
    return { accepted: [], duplicated: [], rejected, conservationBroken: true }
  }
  return {
    accepted: pushed.map((e) => e.entryKey).filter((k) => !rejectedKeys.has(k)),
    duplicated: [],
    rejected,
    conservationBroken: false
  }
}

export function createUplink(deps: UplinkDeps): Uplink {
  const nowDate = deps.now ?? ((): Date => new Date())
  const log = deps.log ?? ((): void => {})
  let inFlight: Promise<UplinkResult> | null = null

  async function round(): Promise<UplinkResult> {
    const result: UplinkResult = {
      skipped: false,
      authInvalid: false,
      ricePushed: 0,
      riceRejected: 0,
      ricePulled: 0,
      settlesSent: 0,
      settlesDropped: 0,
      failures: [],
      at: nowDate().toISOString()
    }

    if (deps.box.currentAccountId() === null) {
      return { ...result, skipped: true, skipReason: 'signed-out' }
    }
    const epoch = deps.box.epoch()
    const fresh = (): boolean => deps.box.epoch() === epoch
    const stale = (): UplinkResult => {
      result.failures.push({ phase: 'stale', code: 'STALE_EPOCH', message: 'box switched mid-round' })
      return result
    }

    // ---------------------------------------------------------------- 流水推
    for (let n = 0; n < MAX_PUSH_ROUNDS; n++) {
      const pending = pendingEntries(deps.journal.current(), PUSH_BATCH)
      if (pending.length === 0) break

      const res = await deps.rice.push({ installId: deps.installId, entries: pending.map(stripForPush) })
      if (!fresh()) return stale()
      if (!res.ok) {
        result.failures.push({ phase: 'push', code: res.failure.code, message: res.failure.message })
        if (isAuthDead(res.failure.code)) result.authInvalid = true
        if (typeof res.failure.retryAfterMs === 'number') result.retryAfterMs = res.failure.retryAfterMs
        return result // 推不动就没有下文：拉与结算下次触发再来
      }

      const adapted = adaptPushOutcome(pending, res.data)
      deps.journal.mutate((l) => applyPushResult(l, adapted))
      result.ricePushed += adapted.accepted.length + adapted.duplicated.length
      result.riceRejected += adapted.rejected.length
      log(`rice push: batch=${pending.length} accepted=${res.data.accepted} duplicated=${res.data.duplicated} rejected=${res.data.rejected.length}`)
      if (adapted.conservationBroken) {
        // 服务端回了一批对不上的计数：拒收键已标好，其余留在 pending（绝不
        // 默认入云）。不停轮的原因：pull 是独立端点，不受这次混乱影响。
        result.failures.push({
          phase: 'push',
          code: 'MALFORMED_RESPONSE',
          message: `push response counts do not add up (batch=${pending.length})`
        })
        break
      }
    }

    // ---------------------------------------------------------------- 流水拉
    for (let page = 0; page < MAX_PULL_PAGES; page++) {
      const since = deps.journal.current().appliedServerSeq
      const res = await deps.rice.pull({ since, limit: PULL_LIMIT })
      if (!fresh()) return stale()
      if (!res.ok) {
        result.failures.push({ phase: 'pull', code: res.failure.code, message: res.failure.message })
        if (isAuthDead(res.failure.code)) result.authInvalid = true
        if (typeof res.failure.retryAfterMs === 'number') result.retryAfterMs = res.failure.retryAfterMs
        return result
      }

      let added = 0
      deps.journal.mutate((l) => {
        const r = applyPull(l, res.data.entries, res.data.nextSeq)
        added = r.added
        return r.ledger
      })
      result.ricePulled += added
      // 短页 = 拉完了；长页但水位不前进 = 服务端异常（防死循环）
      if (res.data.entries.length < PULL_LIMIT) break
      if (res.data.nextSeq <= since) break
    }

    // ---------------------------------------------------------------- 挑战结算
    let queue = deps.settleQueue.read()
    for (const op of queue.settles) {
      if (!fresh()) return stale()
      const res = await deps.challenge.settle({
        ...op.payload,
        submissionId: op.submissionId,
        installId: deps.installId
      })
      if (!fresh()) return stale()

      if (res.ok) {
        queue = removeSettle(queue, op.submissionId)
        deps.settleQueue.write(queue)
        result.settlesSent++
        log(`challenge settle: ${op.dateKey} settled (idempotent=${res.data.idempotent})`)
        continue
      }

      const { code, message, httpStatus } = res.failure
      if (code === 'CHALLENGE_DUPLICATE') {
        // 这一天已被别的设备（或本设备先前的另一条 submissionId）结算过：
        // 这条永远不会成功，出队 —— 但不是失败（保持现状 = 重复计分风险已排除）
        queue = removeSettle(queue, op.submissionId)
        deps.settleQueue.write(queue)
        result.settlesDropped++
        log(`challenge settle: ${op.dateKey} already settled, dropped`)
        continue
      }
      if (isAuthDead(code)) {
        result.authInvalid = true
        result.failures.push({ phase: 'settle', code, message })
        return result
      }

      queue = markSettleAttempt(queue, op.submissionId, `${code}: ${message}`)
      deps.settleQueue.write(queue)
      result.failures.push({ phase: 'settle', code, message })
      if (httpStatus === null || httpStatus === 429 || httpStatus >= 500) {
        // 网络/限流/服务端故障：后面每条大概率同样失败，停轮等下次触发
        if (typeof res.failure.retryAfterMs === 'number') result.retryAfterMs = res.failure.retryAfterMs
        return result
      }
      // 其余 4xx：这一条大概永久发不出去（attempts 记在队列里给界面看），
      // 继续下一条 —— 一条坏账不许堵住后面的天
    }

    return result
  }

  return {
    run(): Promise<UplinkResult> {
      if (inFlight !== null) return inFlight
      const p = round().finally(() => {
        if (inFlight === p) inFlight = null
      })
      inFlight = p
      return p
    },

    whenIdle(): Promise<void> {
      if (inFlight === null) return Promise.resolve()
      return inFlight.then(
        () => undefined,
        () => undefined
      )
    }
  }
}
