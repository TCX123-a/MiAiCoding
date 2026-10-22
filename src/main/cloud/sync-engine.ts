/**
 * 同步引擎（P10.3）—— docs/21 §8.2「拉→合并→条件写回」的七步落地。
 *
 * 【位置与节拍】执行在主进程（网络与令牌在这里），节拍在渲染层（P10.5 接线，
 * 唯一调度者）—— 本文件**没有任何定时器**：syncNow() 是纯请求-响应，
 * 单飞（在飞时新调用并入当前轮），可注入假 provider 全离线测。
 *
 * 【每份文档七步】（§8.2 逐条）
 *   1. pull：带 ifNoneMatchRevision = 本地账本的 revision 走条件 GET；
 *   2. 体积门：拉到的 payload 超 DOC_SIZE_LIMITS ⇒ 暂停该文档（不进 3-6）；
 *   3. 版本门：云端 docVer > 本机 ⇒ blocked（跳过 merge/写盘/push、从
 *      changedDocs 剔除）；云端 < 本机 ⇒ 归一化即迁移（读口函数顺带完成）；
 *      另有**本地降级**一态：本地文件 version > 本机 ⇒ 同样 blocked
 *      （§8.5 第四行：老客户端不许把新版数据重写成旧形状）；
 *   4. 重读磁盘 localRaw（**在 per-doc 队列槽内、不用任何缓存**）→ 归一化 →
 *      merge(local, remote)（合并函数注入 = P10.4 的 mergeXxxDoc）；
 *   5. merged ≠ 本地 ⇒ 写盘（同一队列槽内一气呵成，槽内无 await；写戳用
 *      **轮开始时的 epoch** —— 槽内任何一刻切了盒都会被屏障拒掉）；
 *   6. push(merged, expected {revision, docVer})：内容与云端逐字节一致
 *      （canonicalJson 相等）则不推；0 行冲突（CONFLICT_STALE /
 *      DOC_VER_BLOCKED）⇒ 重拉重合并重推 ≤3 次；
 *   7. 全部失败 ⇒ 静默退避 1→5→15→60 分钟（内存态；任一轮有成功即清零）。
 *
 * 【账本】<accountDir>/.sync/state.json（sync-state.ts）：每份文档记
 * {revision, hash, syncedAt}。hash = hashDocPayload(合并/归一化后的文档)
 * —— 「本地这份是不是就是账本那一刻那份」判的就是它（304 分支）。
 *
 * 【epoch 弃轮】轮开始捕获 epoch；写盘前（戳）与每次 push 前各校验一次，
 * 对不上即弃轮、且本轮不写账本 —— 账号切换的存档边界靠机制，不靠时序。
 *
 * 【归一化口径】merge 的**两侧**都先过读口归一化（migrateProfile /
 * normalizeWrongbook / normalizeFavorites / normalizePractice）：老版本数据
 * （云端 docVer < 本机）由此完成迁移，坏形状由归一化兜底。merge 收到的
 * 永远是当前版本、干净形状的对象（与 P10.4 冻结口径一致）。
 *
 * 【失败不断轮】单份文档的任何异常（merge 抛、写盘抛、形状坏）只判这份
 * failed，其余文档照常 —— 一轮的价值是「能前进的尽量前进」。
 *
 * ⚠️ 本文件在 `src/main/cloud/**`（零网络闸门整目录扫）：不发起任何请求、
 * 不 import 网络原语；一切网络经注入的 ApiProvider。
 * ⚠️ 字符串一律 english，中文只出现在注释里。
 */
import { DOC_SIZE_LIMITS, DOC_TYPES, type DocType } from '../../shared/cloud/protocol'
import type {
  CloudFailureCode,
  SyncBlockReason,
  SyncDocOutcome,
  SyncRoundResult
} from '../../shared/cloud/dto'
import { canonicalJson } from '../../shared/cloud/canonical-json'
import {
  CURRENT_FAVORITES_VERSION,
  CURRENT_PRACTICE_VERSION,
  CURRENT_PROFILE_VERSION,
  CURRENT_WRONGBOOK_VERSION,
  DEFAULT_PROFILE
} from '../../shared/types'
import { migrateProfile } from '../../shared/profile-migrate'
import { normalizeFavorites } from '../store/favorites-merge'
import { normalizePractice } from '../store/practice-merge'
import { normalizeWrongbook } from '../store/wrongbook-merge'
import { StaleEpochError, type BoxStamp } from '../store/box'
import type { BoxedStore, Stores } from '../store/stores'
import {
  readSyncState,
  writeSyncState,
  type SyncBlocked,
  type SyncPendingPush,
  type SyncState
} from '../store/sync-state'
import { hashDocPayload } from './doc-hash'
import type { ApiProvider } from './provider'

/** 合并函数（P10.4 mergeXxxDoc 的形状；注入以解耦与可测） */
export type DocMerger = (local: unknown, remote: unknown) => {
  merged: Record<string, unknown>
  changed: boolean
}

export interface SyncEngineDeps {
  provider: ApiProvider
  stores: Stores
  /** device.json 的 installId（practice 归一化要回填 uid） */
  installId: string
  mergers: Record<DocType, DocMerger>
  /** 时钟注入缝（syncedAt / 退避 / at 全走它，测试要确定性） */
  now?: () => Date
  /** 诊断行（默认不出声）—— 内容只许英文（文案闸门） */
  log?: (message: string) => void
}

// SyncBlockReason / SyncDocOutcome / SyncRoundResult 的真源现在在 shared/cloud/dto.ts
// （P10.5 搬家：preload 只许 import shared/**，`cloud:sync-now` 通道要拿类型）。
// 这里 re-export 保既有 import 面（含全部测试）不变 —— 形状没动一个字。
export type { SyncBlockReason, SyncDocOutcome, SyncRoundResult } from '../../shared/cloud/dto'

export interface SyncEngine {
  /** 跑一轮同步（单飞：在飞时并入当前轮）。force = 手动触发时跳过退避窗口 */
  syncNow(opts?: { force?: boolean }): Promise<SyncRoundResult>
  /**
   * 等在飞的那一轮结束（没有在飞 = 立刻 resolve）。**不新起轮** ——
   * 登出干涸协议（docs/21 §3.5.1）用：切盒前确认没有同步轮还会往旧盒写。
   * 永远 resolve（轮本身的异常不是干涸要处理的事，由 syncNow 的调用方拿）。
   */
  whenIdle(): Promise<void>
  /**
   * 请求取消在飞的那一轮（V1-65）。协作式，在**文档之间**生效：正在飞的那次
   * 请求不打断（它自带 10s 超时闸，最迟那时收束），之后的文档一份都不再发，
   * 取消之后也不再发任何写请求。被取消的轮：回话带 `canceled:true`、不落
   * 同步状态、不动退避档位（见 runRound 轮末）。没有在飞轮时调用 = 立旗作废
   * （下一轮开始即清），不会误伤下一轮。
   */
  cancel(): void
}

// ---------------------------------------------------------------- 常量与小工具

/** 四份文档的本机版本（导出给 account-flow 的收编版本门共用同一份） */
export const DOC_VERSIONS: Record<DocType, number> = {
  profile: CURRENT_PROFILE_VERSION,
  wrongbook: CURRENT_WRONGBOOK_VERSION,
  favorites: CURRENT_FAVORITES_VERSION,
  practice: CURRENT_PRACTICE_VERSION
}

/** §8.2 第 7 步：1→5→15→60 分钟 */
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]

/** 0 行冲突（服务端 409 族）⇒ 重拉重合并重推，≤ PUSH_RETRIES 次 */
const PUSH_CONFLICTS: ReadonlySet<string> = new Set(['CONFLICT_STALE', 'DOC_VER_BLOCKED'])
const PUSH_RETRIES = 3

function isAuthDead(code: CloudFailureCode): boolean {
  return code === 'UNAUTHENTICATED' || code === 'TOKEN_EXPIRED'
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** 信封 version 字段；没有/不是数值一律 null（= 老形状，走迁移，不算「降级运行」）。
 *  导出给 account-flow 的收编用：同一套「本地版本比本机新 ⇒ 不碰」的判据。 */
export function rawVersionOf(raw: unknown): number | null {
  const v = asRecord(raw)['version']
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * 读口归一化（与 app.ts 读路径同一组函数）：raw → 当前版本、干净形状的对象。
 * 导出给 account-flow 的收编用（收编的两侧都先过这里再进 merge，口径与同步轮
 * 完全一致）。raw === null（文件不存在）按各读口自己的「首次运行」口径给空文档：
 * profile 在这里显式挡一道 —— migrateProfile(null) 会出「文件坏了」的告警，
 * 而「文件还没建」是正常路径，不该刷告警（对文件存在但内容坏的情况，
 * migrateProfile 内部的告警照旧出声）。
 */
export function normalizeDoc(dt: DocType, raw: unknown, installId: string): Record<string, unknown> {
  switch (dt) {
    case 'profile':
      return (raw === null ? structuredClone(DEFAULT_PROFILE) : migrateProfile(raw)) as unknown as Record<
        string,
        unknown
      >
    case 'wrongbook':
      return normalizeWrongbook(raw).file as unknown as Record<string, unknown>
    case 'favorites':
      return normalizeFavorites(raw).file as unknown as Record<string, unknown>
    case 'practice':
      return normalizePractice(raw, installId).file as unknown as Record<string, unknown>
  }
}

/** 文档处理的一步：要么给出结局，要么撞上切盒（弃轮），要么被用户取消（V1-65） */
type DocStep = { kind: 'outcome'; outcome: SyncDocOutcome } | { kind: 'aborted' } | { kind: 'canceled' }

// ---------------------------------------------------------------- 引擎

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const { provider, stores, installId, mergers } = deps
  const nowDate = deps.now ?? ((): Date => new Date())
  const log = deps.log ?? ((): void => {})

  let inflight: Promise<SyncRoundResult> | null = null
  let backoffStep = 0 // 0 = 无退避；失败升档、成功清零
  let backoffUntilMs = 0
  /** V1-65：用户点名取消在飞轮（每轮开始时清零，只作用于当轮） */
  let cancelRequested = false

  /** 引擎只当盒内文件是 JSON 文档（形状归各归一化函数管），故取宽类型 */
  function docStore(dt: DocType): BoxedStore<Record<string, unknown>> {
    return stores[dt] as unknown as BoxedStore<Record<string, unknown>>
  }

  async function runRound(force: boolean): Promise<SyncRoundResult> {
    const now = nowDate()
    const at = now.toISOString()

    if (stores.box.currentAccountId() === null) {
      return {
        skipped: true,
        skipReason: 'signed-out',
        authInvalid: false,
        protocolBlocked: false,
        changedDocs: [],
        docs: [],
        pendingPush: [],
        at
      }
    }
    if (!force && now.getTime() < backoffUntilMs) {
      return {
        skipped: true,
        skipReason: 'backoff',
        retryAfterMs: backoffUntilMs - now.getTime(),
        authInvalid: false,
        protocolBlocked: false,
        changedDocs: [],
        docs: [],
        pendingPush: [],
        at
      }
    }

    // V1-65：新一轮从「没被取消」开始 —— 上一轮跑完之后才点下的取消（当时没有
    // 轮可取消）到此作废，不误伤这一轮。放在两道 skip 闸之后：skipped 轮没有
    // 在飞的动作，不存在"被取消"一说，旗留给下一个真跑的轮去清。
    cancelRequested = false

    const roundEpoch = stores.box.epoch()
    const accountDir = stores.box.currentDir()
    const state = readSyncState(accountDir)
    const next: SyncState = { ...state, docs: { ...state.docs }, pendingPush: [] }

    const changedDocs: DocType[] = []
    const outcomes: SyncDocOutcome[] = []
    let authInvalid = false
    let protocolBlocked = false
    let aborted = false
    let attempted = 0
    let success = 0
    let failed = 0
    let dirty = false

    function recordLedger(dt: DocType, revision: number, hash: string): boolean {
      const prev = next.docs[dt]
      if (prev && prev.revision === revision && prev.hash === hash) return false
      next.docs[dt] = { revision, hash, syncedAt: at }
      dirty = true
      return true
    }

    function okDoc(dt: DocType, status: 'synced' | 'unchanged'): DocStep {
      return { kind: 'outcome', outcome: { docType: dt, status } }
    }

    function failDoc(dt: DocType, code: CloudFailureCode): DocStep {
      log(`sync ${dt}: failed: ${code}`)
      return { kind: 'outcome', outcome: { docType: dt, status: 'failed', failureCode: code } }
    }

    function blockDoc(dt: DocType, reason: SyncBlockReason): DocStep {
      log(`sync ${dt}: blocked: ${reason}`)
      return { kind: 'outcome', outcome: { docType: dt, status: 'blocked', blockReason: reason } }
    }

    async function processDoc(dt: DocType): Promise<DocStep> {
      const store = docStore(dt)
      const docVer = DOC_VERSIONS[dt]
      let conflictRetriesLeft = PUSH_RETRIES
      let forceFullPull = false

      for (;;) {
        const ledger = next.docs[dt] ?? null
        const pulled = await provider.getDoc(
          dt,
          !forceFullPull && ledger ? { ifNoneMatchRevision: ledger.revision } : undefined
        )

        // V1-65：拉取飞行期间用户点了取消 ⇒ 这一次请求的结局整个丢弃
        // （不当失败记账、不进 outcomes）—— 本轮到此为止，写口更不许再碰
        if (cancelRequested) return { kind: 'canceled' }

        // —— 推什么、推不推，由下面各分支决定；到这里统一执行 ——
        let pushPayload: Record<string, unknown> | null = null
        let baseRevision: number | null = null

        if (!pulled.ok) {
          if (pulled.failure.code !== 'NOT_FOUND') return failDoc(dt, pulled.failure.code)

          // —— 云端没有这份文档（NOT_FOUND ≠ 空文档）——
          const slot = await stores.queues.run(dt, () => {
            if (stores.box.epoch() !== roundEpoch) return { kind: 'stale-epoch' as const }
            const localRaw = store.read()
            const localVer = rawVersionOf(localRaw)
            if (localVer !== null && localVer > docVer) return { kind: 'local-too-new' as const }
            if (localRaw === null) return { kind: 'empty' as const }
            return { kind: 'ok' as const, merged: normalizeDoc(dt, localRaw, installId) }
          })
          if (slot.kind === 'stale-epoch') return { kind: 'aborted' }
          if (slot.kind === 'local-too-new') return blockDoc(dt, 'LOCAL_VER_TOO_NEW')
          if (slot.kind === 'empty') {
            // 两边都没有这份文档：账本条目清掉，什么都不做
            if (next.docs[dt] !== undefined) {
              delete next.docs[dt]
              dirty = true
            }
            return okDoc(dt, 'unchanged')
          }
          pushPayload = slot.merged
          baseRevision = null // 建行（首次推送）
        } else if (pulled.data.notModified) {
          // —— 304：云端 = 账本那一刻。没有 payload，不 merge；本地动过才推 ——
          const slot = await stores.queues.run(dt, () => {
            if (stores.box.epoch() !== roundEpoch) return { kind: 'stale-epoch' as const }
            const localRaw = store.read()
            const localVer = rawVersionOf(localRaw)
            if (localVer !== null && localVer > docVer) return { kind: 'local-too-new' as const }
            const localNorm = normalizeDoc(dt, localRaw, installId)
            return { kind: 'ok' as const, localNorm, hash: hashDocPayload(localNorm) }
          })
          if (slot.kind === 'stale-epoch') return { kind: 'aborted' }
          if (slot.kind === 'local-too-new') return blockDoc(dt, 'LOCAL_VER_TOO_NEW')
          // 304 只可能带 ifNoneMatchRevision 发生 ⇒ 账本必在（防御：不在就判失败）
          if (ledger === null) return failDoc(dt, 'INTERNAL')
          if (ledger.hash === slot.hash) return okDoc(dt, 'unchanged')
          pushPayload = slot.localNorm
          baseRevision = ledger.revision
        } else {
          // —— 完整文档 ——
          const view = pulled.data
          // 体积门在版本门之前（§8.2 步骤 2→3 的顺序）：超限载荷连看版本都不必
          const sizeBytes = Buffer.byteLength(JSON.stringify(view.payload), 'utf8')
          if (sizeBytes > DOC_SIZE_LIMITS[dt]) return blockDoc(dt, 'PAYLOAD_TOO_LARGE')
          if (view.docVer > docVer) return blockDoc(dt, 'DOC_VER_TOO_NEW')

          const remoteNorm = normalizeDoc(dt, view.payload, installId)
          const slot = await stores.queues.run(dt, () => {
            // 队列槽：重读磁盘 → 归一化 → 合并 → 写盘，槽内无 await（天然原子）
            if (stores.box.epoch() !== roundEpoch) return { kind: 'stale-epoch' as const }
            const localRaw = store.read()
            const localVer = rawVersionOf(localRaw)
            if (localVer !== null && localVer > docVer) return { kind: 'local-too-new' as const }
            const localNorm = normalizeDoc(dt, localRaw, installId)
            const res = mergers[dt](localNorm, remoteNorm)
            if (res.merged['version'] !== docVer) {
              // merge 输出必须带当前版本（协议硬规则：payload.version === docVer）
              throw new Error(
                `merged ${dt} version ${String(res.merged['version'])} != docVer ${docVer}`
              )
            }
            if (res.changed) {
              // 写戳用**轮开始的 epoch**：槽内任何一刻切了盒都会被屏障拒掉
              // （rev 用写前同步捕获的当前值 —— 槽内没有别的写者，必配对）
              store.write(res.merged, { epoch: roundEpoch, rev: store.stamp().rev } satisfies BoxStamp)
            }
            return { kind: 'ok' as const, merged: res.merged, written: res.changed }
          })
          if (slot.kind === 'stale-epoch') return { kind: 'aborted' }
          if (slot.kind === 'local-too-new') return blockDoc(dt, 'LOCAL_VER_TOO_NEW')
          if (slot.written && !changedDocs.includes(dt)) changedDocs.push(dt) // 冲突重试可能写多轮（去重）

          if (canonicalJson(slot.merged) === canonicalJson(remoteNorm)) {
            // 两边逐字节一致：不推；账本跟到刚拉到的 revision
            const moved = recordLedger(dt, view.revision, hashDocPayload(slot.merged))
            return okDoc(dt, slot.written || moved ? 'synced' : 'unchanged')
          }
          pushPayload = slot.merged
          baseRevision = view.revision
        }

        // —— push（pushPayload 必非空；null 只可能是上面的分支写漏了）——
        if (pushPayload === null) return failDoc(dt, 'INTERNAL')
        if (stores.box.epoch() !== roundEpoch) return { kind: 'aborted' }
        // V1-65：取消耗者不能"取消之后还替用户发写请求"——发写前的最后一道闸
        // （本地合并已完成的那点写盘是幂等的，不回收；只是不再往上推）
        if (cancelRequested) return { kind: 'canceled' }
        const push = await provider.putDoc(dt, { docVer, baseRevision, payload: pushPayload })
        if (push.ok) {
          recordLedger(dt, push.data.revision, hashDocPayload(pushPayload))
          return okDoc(dt, 'synced')
        }
        const code = push.failure.code
        if (isAuthDead(code) || code === 'PROTOCOL_TOO_OLD') return failDoc(dt, code)
        if (PUSH_CONFLICTS.has(code) && conflictRetriesLeft > 0) {
          // 0 行冲突：重拉（不带条件）→ 重门 → 重并 → 重推
          conflictRetriesLeft--
          forceFullPull = true
          continue
        }
        return failDoc(dt, code)
      }
    }

    // ---------------------------------------------------------------- 主循环

    for (const dt of DOC_TYPES) {
      // V1-65：文档之间的取消闸 —— 取消后一份新请求都不发（含下一份的 GET）
      if (authInvalid || protocolBlocked || aborted || cancelRequested) break
      let step: DocStep
      try {
        step = await processDoc(dt)
      } catch (err) {
        if (err instanceof StaleEpochError) {
          aborted = true
          break
        }
        log(`sync ${dt}: unexpected error: ${err instanceof Error ? err.message : String(err)}`)
        step = failDoc(dt, 'INTERNAL')
      }
      if (step.kind === 'aborted') {
        aborted = true
        break
      }
      // 取消：这份文档的结局已被 processDoc 丢弃，本轮到此为止（结局在轮末统一判）
      if (step.kind === 'canceled') break
      const outcome = step.outcome
      outcomes.push(outcome)
      if (outcome.status === 'failed' && outcome.failureCode !== undefined) {
        if (isAuthDead(outcome.failureCode)) authInvalid = true
        else if (outcome.failureCode === 'PROTOCOL_TOO_OLD') protocolBlocked = true
      }
      if (outcome.status !== 'blocked') attempted++
      if (outcome.status === 'synced' || outcome.status === 'unchanged') success++
      else if (outcome.status === 'failed') failed++
    }

    // ---------------------------------------------------------------- 轮末

    /*
     * V1-65：被取消的轮 —— 退避档位**原样不动**。取消是用户意志，不是网络失败：
     * 若按"全败升档"处理，用户取消一次就把自己关进退避窗口，下次点「立即同步」
     * （不带 force 的常规轮）会被 skip —— 等于惩罚按键的人。不清零同理：这轮
     * 没证明网络是好的，也没证明是坏的。
     */
    const canceledRound = cancelRequested
    if (!canceledRound) {
      if (attempted > 0 && success === 0 && failed > 0) {
        // 全部失败：升一档退避（1→5→15→60 分钟封顶）
        backoffStep = Math.min(backoffStep + 1, BACKOFF_MS.length)
        backoffUntilMs = nowDate().getTime() + BACKOFF_MS[backoffStep - 1]
      } else if (success > 0) {
        backoffStep = 0
        backoffUntilMs = 0
      }
    }
    if (protocolBlocked) {
      // 协议下限压着：重试解决不了，退到最长档让定时触角安静
      backoffStep = BACKOFF_MS.length
      backoffUntilMs = nowDate().getTime() + BACKOFF_MS[BACKOFF_MS.length - 1]
    }

    const pendingPush: DocType[] = outcomes
      .filter((o) => o.status === 'failed' || o.status === 'blocked')
      .map((o) => o.docType)

    if (!aborted && !canceledRound && stores.box.epoch() === roundEpoch) {
      const pendingEntries: SyncPendingPush[] = pendingPush.map((docType) => ({ docType, at }))
      const blockedEntry: SyncBlocked | null = protocolBlocked
        ? { code: 'PROTOCOL_TOO_OLD', message: 'server requires a newer sync protocol', at }
        : null
      if (
        dirty ||
        canonicalJson(pendingEntries) !== canonicalJson(state.pendingPush) ||
        canonicalJson(blockedEntry) !== canonicalJson(state.blocked)
      ) {
        next.pendingPush = pendingEntries
        next.blocked = blockedEntry
        try {
          writeSyncState(accountDir, next)
        } catch (err) {
          // 账本写不进去不该毁掉整轮（下次全量重拉即自愈）—— 出声，不抛
          log(`sync: state write failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }

    // canceledRound 时上面两块都没写：pendingPush/blocked 是"整轮跑完"的结论，
    // 被取消的轮只处理了一部分，落它 = 把部分当全部（账本推进一并作废——下次
    // 全量重拉自愈，代价只是一次大 GET，比写进一份半真的状态便宜）。

    return {
      skipped: false,
      ...(canceledRound ? { canceled: true as const } : {}),
      authInvalid,
      protocolBlocked,
      changedDocs,
      docs: outcomes,
      pendingPush,
      at
    }
  }

  return {
    syncNow(opts?: { force?: boolean }): Promise<SyncRoundResult> {
      if (inflight) return inflight
      const force = opts?.force === true
      const p = runRound(force).finally(() => {
        if (inflight === p) inflight = null
      })
      inflight = p
      return p
    },

    whenIdle(): Promise<void> {
      if (inflight === null) return Promise.resolve()
      return inflight.then(
        () => undefined,
        () => undefined
      )
    },

    cancel(): void {
      cancelRequested = true
    }
  }
}
