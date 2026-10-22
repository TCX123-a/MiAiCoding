/**
 * .sync/state.json —— 账号目录里的同步状态（P10.1 第 9 项）。
 *
 * 【这个文件是干什么的】
 *   · `activatedAt` = 「本账号已激活」的**幂等守卫**。收编（把客人档案并进账号盒）
 *     只在首次激活时跑一次；已激活的账号重新登录要直达同步，**绝不重跑收编**
 *     （重跑会把客人盒里此刻的新数据再并一遍）。所以 `markActivated` 一旦看到
 *     非 null 就一个字节都不写：首次激活时刻是永久事实，绝不被后来的时刻覆盖。
 *   · `docs` = 四份文档（profile/wrongbook/favorites/practice）的本地摘要，
 *     是 **P10.3 同步引擎的本地账**：revision 拿去跟服务端 CAS 对账（PUT 的
 *     baseRevision 从这里取），hash 用来判「本地这份是不是就是服务端那份」。
 *   · `blocked` / `pendingPush` 是 P10.3 的**字段形状占位**：DOC_VER_BLOCKED
 *     这类阻断信息、以及「还没推上去的文档类型」的待办队列。
 *
 * 【形状会变，改时要连带改测试】这几个字段到 P10.3 真正落地时可能微调
 * （pendingPush 长出重试次数、blocked.code 收成枚举……）。改本文件必须同批改
 * `__tests__/sync-state.test.ts` —— 占位形状没有别的东西守着，漂移不会报错。
 *
 * 【读口 / 写口两种性子】与 practice-merge 同一套：
 *   · `readSyncState` = 读口：磁盘上什么形状都认，坏字段丢掉 + 出声汇总，
 *     **能救的必须救**（这是全都能重建的本地账，不必整份拒收）；
 *   · `writeSyncState` = 写口：入参是我们自己的代码交上来的，形状不对就**抛**。
 *
 * 【accountDir 由调用方给（已归一）】本模块不校验 accountId、不拼 accounts/ ——
 *   白名单校验在 account-id.ts、拼路径是调用方的事（P10.1 的分工）。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律英文**，中文只出现在注释里。
 */
import { existsSync } from 'fs'
import { join } from 'path'
import { DOC_TYPES, type DocType } from '../../shared/cloud/protocol'
import { createJsonStore, type JsonStore } from './json-store'

export const SYNC_STATE_VERSION = 1

/** 一份文档的本地摘要（revision 是 CAS 对账的数值，hash 是「同不同」的凭据） */
export interface SyncDocState {
  revision: number
  hash: string
  syncedAt: string
}

/** 同步被服务端阻断时的记录（字段形状占位，P10.3 落定） */
export interface SyncBlocked {
  code: string
  message: string
  at: string
}

/** 还没推上去的一份文档（字段形状占位，P10.3 落定） */
export interface SyncPendingPush {
  docType: DocType
  at: string
}

export interface SyncState {
  version: number
  activatedAt: string | null
  docs: Partial<Record<DocType, SyncDocState>>
  blocked: SyncBlocked | null
  pendingPush: SyncPendingPush[]
}

/** 导出给同目录的兄弟文件（pending-ops.json）用：同一个目录不许有两个写法 */
export const SYNC_DIR = '.sync'
const STATE_FILE = 'state.json'

/** DOC_TYPES 是冻结真源（protocol.ts）；认不认得的判据只走它，不另抄一份清单 */
const DOC_TYPE_SET: ReadonlySet<string> = new Set(DOC_TYPES)

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 非空字符串（去空白后仍有内容才算） */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

function isDocType(v: unknown): v is DocType {
  return typeof v === 'string' && DOC_TYPE_SET.has(v)
}

function cleanDocState(raw: unknown): SyncDocState | null {
  if (!isObject(raw)) return null
  const revision: unknown = raw.revision
  // revision 是数值对账用的：只认有限整数 ≥0。字符串 "3" 看着一样，
  // 拿去跟服务端比永远不会相等 —— 这种条目留着只会让同步反复误判
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) return null
  if (!isNonEmptyString(raw.hash)) return null
  if (!isNonEmptyString(raw.syncedAt)) return null
  return { revision, hash: raw.hash, syncedAt: raw.syncedAt }
}

function cleanBlocked(raw: unknown): SyncBlocked | null {
  if (!isObject(raw)) return null
  if (!isNonEmptyString(raw.code)) return null
  if (!isNonEmptyString(raw.message)) return null
  if (!isNonEmptyString(raw.at)) return null
  return { code: raw.code, message: raw.message, at: raw.at }
}

function cleanPendingPush(raw: unknown): SyncPendingPush | null {
  if (!isObject(raw)) return null
  // 不认识的 docType（比如 DB 里预留、API 面还没有的 'challenge'）不留：
  // 留着它，P10.3 会拿它去发一个服务端必然 404 的请求
  if (!isDocType(raw.docType)) return null
  if (!isNonEmptyString(raw.at)) return null
  return { docType: raw.docType, at: raw.at }
}

export function emptySyncState(): SyncState {
  return { version: SYNC_STATE_VERSION, activatedAt: null, docs: {}, blocked: null, pendingPush: [] }
}

/** 落点固定为 <accountDir>/.sync/state.json（json-store 的 write 会 mkdir recursive） */
function stateStore(accountDir: string): JsonStore<SyncState> {
  return createJsonStore<SyncState>(join(accountDir, SYNC_DIR), STATE_FILE)
}

/**
 * 读口：磁盘上什么形状都认。坏字段丢掉、能救的必须救，出声一次汇总。
 * **不写盘** —— 修复是写口的事（本函数只回答「现在这些状态是什么」）。
 */
export function readSyncState(accountDir: string): SyncState {
  const raw: unknown = stateStore(accountDir).read()

  if (raw === null) {
    // 读到 null 有两种：文件根本不在（从没写过，正常），以及主文件 + .bak
    // 连 JSON 都读不出来（坏透了）。后者**出声** —— 静默重建是铁律禁止的
    if (existsSync(join(accountDir, SYNC_DIR, STATE_FILE))) {
      console.warn('[miai] sync state is unreadable JSON, starting empty')
    }
    return emptySyncState()
  }

  if (!isObject(raw)) {
    console.warn('[miai] sync state is not an object, starting empty')
    return emptySyncState()
  }

  let dropped = 0

  // activatedAt 是激活守卫：坏值（数字 / 空白串 / 对象）只能归 null ——
  // 不能编一个时刻出来，编出来的守卫会让收编永远不再跑
  let activatedAt: string | null = null
  if (raw.activatedAt !== undefined && raw.activatedAt !== null) {
    if (isNonEmptyString(raw.activatedAt)) activatedAt = raw.activatedAt
    else dropped++
  }

  const docs: Partial<Record<DocType, SyncDocState>> = {}
  if (raw.docs !== undefined && raw.docs !== null) {
    if (isObject(raw.docs)) {
      for (const [key, value] of Object.entries(raw.docs)) {
        // 不认识的 key 不是我们的文档，不留（也别让它冒充四份之一的账）
        if (!isDocType(key)) {
          dropped++
          continue
        }
        const one = cleanDocState(value)
        if (one) docs[key] = one
        else dropped++
      }
    } else {
      dropped++
    }
  }

  let blocked: SyncBlocked | null = null
  if (raw.blocked !== undefined && raw.blocked !== null) {
    const one = cleanBlocked(raw.blocked)
    if (one) blocked = one
    else dropped++
  }

  const pendingPush: SyncPendingPush[] = []
  if (raw.pendingPush !== undefined && raw.pendingPush !== null) {
    if (Array.isArray(raw.pendingPush)) {
      for (const entry of raw.pendingPush) {
        const one = cleanPendingPush(entry)
        if (one) pendingPush.push(one)
        else dropped++
      }
    } else {
      dropped++
    }
  }

  if (dropped > 0) {
    // 汇总成一条：读口在启动路径上，逐条 warn 会刷屏；但一条都不出又成了静默丢数据
    console.warn(`[miai] sync state: dropped ${dropped} invalid entries`)
  }

  // version 一律以当前版本返回：它是本文件给出去时的形状版本，写口也会无条件覆盖
  return { version: SYNC_STATE_VERSION, activatedAt, docs, blocked, pendingPush }
}

/**
 * 写口：校形后整份写。形状不对**抛** —— 入参是我们自己的代码（P10.3 引擎）
 * 交上来的，糊过去等于把坏账默默记进本地台账；这与读口「能救的必须救」不矛盾：
 * 读口面对的是磁盘（什么都有），写口面对的是自己人（形状是自己定的）。
 *
 * version **无条件**写 SYNC_STATE_VERSION：这个字段是文件自己的，不是入参的 ——
 * 调用方传 99 也按当前版本落盘，读回来也是当前版本。
 */
export function writeSyncState(accountDir: string, state: SyncState): void {
  assertSyncStateShape(state)
  stateStore(accountDir).write({
    version: SYNC_STATE_VERSION,
    activatedAt: state.activatedAt,
    docs: state.docs,
    blocked: state.blocked,
    pendingPush: state.pendingPush
  })
}

function assertSyncStateShape(v: unknown): asserts v is SyncState {
  if (!isObject(v)) throw new Error('invalid sync state: not an object')
  if (v.activatedAt !== null && !isNonEmptyString(v.activatedAt)) {
    throw new Error('invalid sync state: activatedAt')
  }
  if (!isObject(v.docs)) throw new Error('invalid sync state: docs')
  for (const [key, value] of Object.entries(v.docs)) {
    if (!isDocType(key)) throw new Error('invalid sync state: unknown doc type')
    if (cleanDocState(value) === null) throw new Error('invalid sync state: doc entry')
  }
  if (v.blocked !== null && cleanBlocked(v.blocked) === null) {
    throw new Error('invalid sync state: blocked')
  }
  if (!Array.isArray(v.pendingPush)) throw new Error('invalid sync state: pendingPush')
  for (const entry of v.pendingPush) {
    if (cleanPendingPush(entry) === null) throw new Error('invalid sync state: pending push entry')
  }
  // version 不校验：写口会无条件把它覆盖成 SYNC_STATE_VERSION（见函数注释）
}

/**
 * 首次激活：写下 activatedAt；之后**永不再写**。
 *
 * 【幂等守卫】已激活（activatedAt !== null）⇒ 一个字节都不写、原样返回 +
 * alreadyActive: true —— 「已激活重登直达同步、绝不重跑收编」。破坏它的表现
 * 不是报错，而是某次重新登录把客人盒的数据又并了一遍；首次激活时刻被后来的
 * 时刻覆盖同样是坏账，将来要按它比对「收编是否已跑」，时间戳一动就对不上。
 */
export function markActivated(
  accountDir: string,
  nowIso: string
): { state: SyncState; alreadyActive: boolean } {
  const state = readSyncState(accountDir)
  if (state.activatedAt !== null) return { state, alreadyActive: true }

  const next: SyncState = { ...state, activatedAt: nowIso }
  // nowIso 非法（空白 / 不是时刻形状）时由写口校形抛出：这是调用方自己的错，
  // 该炸得响亮，而且此时一个字节都还没写
  writeSyncState(accountDir, next)
  return { state: next, alreadyActive: false }
}
