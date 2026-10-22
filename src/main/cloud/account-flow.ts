/**
 * 账号激活流程（P10.5）—— 收编 / 直达 / 干涸 / 启动恢复。
 *
 * 【五个动作】
 *   · `activateAccount`：登录后把客人盒的档案收编进账号盒（merge-local）、或
 *     只要云端（cloud-only）；已激活的账号重登**直达**（switchTo + 装账本，
 *     绝不重跑收编 —— docs/22 拍板#7）；
 *   · `leaveToGuest`：回客人盒（登出干涸协议的收尾；盒子的事，不碰令牌）；
 *   · `logoutLocal`：仅本机退出（V1-62：丢本地令牌 + 回客人盒，零网络）；
 *   · `restoreOnStartup`：启动扫描（session.ts 七条铁律）之后把登录态接回去；
 *   · `isAccountActivated`：activatedAt 的只读判据（IPC 状态口用）。
 *
 * 【为什么能全同步】activateAccount 全程**没有一个 await** —— 主进程事件循环
 * 不会在中间插进别的 IPC handler，所以「读两侧、合并、落盘、切盒、盖章」天然
 * 原子。任何一处拆出 await（哪怕只是 await 一个 sleep(0)）都会打开「收编写到
 * 一半、渲染层的一个保存请求插进来写进了半成品盒」的窗口。改这个文件之前先懂这条。
 *
 * 【写入顺序（崩溃一致性）】凡是要落账号盒的东西都在 switchTo **之前**直写
 * 账号目录（此刻盒还在客人位，BoxedStore 会写错地方 —— 收编绕过盒、按目录
 * 直读写，文件名与 stores.ts 的 STORE_FILES 同源）。顺序：
 *   ① 饭账本（含收编 marker）→ ② 四份档案 → ③ switchTo(account) →
 *   ④ journal.load()（读到的就是我们刚写的账本）→ ⑤ markActivated **最后**。
 * ⑤ 放最后是幂等的关键：任何一步崩了，下次重跑时 merge 并集幂等、marker 按
 * (installId, !carried) 查重、文档 merge 幂等 —— 全部重算结果逐字节相同。
 *
 * 【饭账本的两个必须】
 *   · cloud-only 也**必须**落一份空账本：不落的话 journal.load() 在账号盒
 *     找不到档时会走 genesis（carriedRice = pet.json.rice）—— 客人攒的存量
 *     就被漏进账号盒、再和云端账并一次（双算）。空账把 genesis 路径整个闸死；
 *   · 收编 marker（docs/26 §6.1）：客人账本非空才写；delta 恒 0、
 *     ref={installId}（不放 carried —— 那是 genesis 的判别器）、cloud:'pending'
 *     （要上行——服务端靠它做每 (account, installId) 至多一次的闸）、放在
 *     **数组位 0**（'必须最早'是客户端账本不变式，服务端看不到顺序）。
 *
 * 【账号盒里的坏饭账 = 停下】账号盒的 rice-ledger.json 存在但 parseLedger 判
 * null：**抛 AccountFlowError 不写任何东西**。任何「当空处理」都是灾难二选一：
 * 把那份账的条目永久抹掉，或（经 genesis 路径）把客人存量漏进来双算。客人盒
 * 一字未动、证据原样留在账号目录里，这是唯一不撒谎的处置。
 *
 * 【版本门（与同步轮同一口径，docs/21 §8.5）】收编的任何一侧的信封 version
 * 比本机新 ⇒ 这份文档跳过（不归一化、不合并、不写）：老客户端不许把新版的
 * 数据重写成旧形状。跳过会在日志出声，不静默。
 *
 * 【启动恢复的两态】扫描 active 且已激活 ⇒ hydrate 会话 + switchTo + 装账本；
 * 扫描 active 但**未激活** ⇒ 只 hydrate、**不切盒** —— 切过去界面会看到空盒
 * （客人档案一支未见），用户会以为「数据没了」。宁可停在客人盒，由渲染层
 * 引导完成收编（P10.6 的界面）。
 *
 * ⚠️ 本文件在 `src/main/cloud/**`（零网络闸门扫描面）：只用注入件与 fs 抽象，
 * 不发起任何请求。字符串一律英文（文案闸门），中文只出现在注释里。
 */
import { join } from 'path'
import { DOC_TYPES, type DocType } from '../../shared/cloud/protocol'
import type { CloudAdoptMode } from '../../shared/cloud/dto'
import { emptyLedger, mergeEntries, parseLedger, type RiceEntry, type RiceLedger } from '../../shared/cloud/rice-ledger'
import { petDayKey } from '../../shared/pet'
import { assertSafeAccountId } from '../store/account-id'
import { createJsonStore } from '../store/json-store'
import { STORE_FILES, type Stores } from '../store/stores'
import { markActivated, readSyncState } from '../store/sync-state'
import { CLOUD_DOC_MERGERS } from './mergers'
import { maxLocalSeq, RICE_LEDGER_FILE, type RiceJournal } from './rice-journal'
import { scanSessionFiles, type SafeStorageLike } from './session'
import type { SessionTokenStore } from './session-store'
import { DOC_VERSIONS, normalizeDoc, rawVersionOf } from './sync-engine'

// ---------------------------------------------------------------- 类型与错误

/**
 * 首激活的两种收编口径（docs/21 §8.4 / docs/22 拍板#7）——
 * 词汇真源在 shared/cloud/dto.ts 的 CloudAdoptMode（IPC 面同词，UI 不再另拼一套）
 */
export type ActivateMode = CloudAdoptMode

export interface ActivateOutcome {
  /** 'adopted' = 本次跑完收编；'already' = 已激活直达（mode 被忽略） */
  outcome: 'adopted' | 'already'
  /** 真正执行的收编口径；'already' 时恒 null */
  adopt: ActivateMode | null
  /** 小写归一的账号 id */
  accountId: string
}

export interface StartupRestoreResult {
  /** 恢复了已激活账号的盒并装好账本 */
  restored: boolean
  /** 磁盘上认出的登录账号（扫描 active）；null = 客人 */
  accountId: string | null
  /** active 但未激活：会话已注入内存、盒子**没切**（等收编流程） */
  needsActivation: boolean
}

/**
 * 「现场保持」型失败：不是调用方给错参数，是磁盘上的状态不允许安全继续。
 * 目前只有一种：账号盒的饭账本读不回来（见文件头）。IPC 层把它转成一份
 * 可见的失败（不许静默吞、更不许"当空继续"）。
 */
export class AccountFlowError extends Error {
  readonly code: 'LEDGER_CORRUPT'
  constructor(code: 'LEDGER_CORRUPT', message: string) {
    super(message)
    this.name = 'AccountFlowError'
    this.code = code
  }
}

// ---------------------------------------------------------------- 依赖

export interface AccountFlowDeps {
  /** 存储根（= createStores 的 baseDir）：客人盒=它本身、账号盒=<baseDir>/accounts/<id>/ */
  baseDir: string
  stores: Stores
  journal: RiceJournal
  sessions: SessionTokenStore
  /** Electron safeStorage（启动扫描要用；真实现由 app.ts 从 electron 传进来） */
  safe: SafeStorageLike
  /** device.json 的 installId（收编 marker 的归属者） */
  installId: string
  /**
   * 设备级序号分配器 —— 必须与 rice-journal 注入的是**同一个实例**：
   * 收编 marker 与日常记账共用一个号池，分两个池就会撞号。
   */
  nextSeq: (ledgerMaxSeq: number) => number
  /** 时钟注入缝（marker 的 at/dayKey、收编落盘顺序无关的 nowIso） */
  now?: () => Date
  /** 诊断行（默认不出声）—— 内容只许英文（文案闸门） */
  log?: (message: string) => void
}

// ---------------------------------------------------------------- 小工具

/** 账号目录（白名单校验 + 小写归一后再拼路径 —— 与 StoreBox.switchTo 同一条守门） */
export function accountDirOf(baseDir: string, accountId: string): string {
  return join(baseDir, 'accounts', assertSafeAccountId(accountId))
}

/** activatedAt 的只读判据（IPC 状态口与激活前置共用同一份口径） */
export function isAccountActivated(accountDir: string): boolean {
  return readSyncState(accountDir).activatedAt !== null
}

/** 直写一份 JSON 到指定目录（绕过盒 —— 见文件头「写入顺序」） */
function writeJsonDirect(dir: string, name: string, data: unknown): void {
  createJsonStore<unknown>(dir, name).write(data)
}

// ---------------------------------------------------------------- 收编（首激活）

/**
 * 饭账本收编（docs/26 §6.1）。返回要写进账号盒的账本。
 * 【坏档】账号侧存在但读不回 ⇒ 抛 AccountFlowError（见文件头）。
 */
function adoptRiceLedger(deps: AccountFlowDeps, accountDir: string, nowIso: string, log: (m: string) => void): RiceLedger {
  // 盒此时在客人位（activateAccount 的位置断言保证）：journal 反映客人账本
  const guestLedger = deps.journal.current()

  const accountRaw = createJsonStore<unknown>(accountDir, RICE_LEDGER_FILE).read()
  let accountLedger: RiceLedger
  if (accountRaw === null) {
    accountLedger = emptyLedger()
  } else {
    const parsed = parseLedger(accountRaw)
    if (parsed === null) {
      throw new AccountFlowError(
        'LEDGER_CORRUPT',
        'the account rice ledger on disk is unreadable; adoption aborted without writing'
      )
    }
    accountLedger = parsed
  }

  // 账号侧在先（本侧）：同键「已有者胜」= 账号侧字段为准（mergeEntries 的既有语义）
  const merged = mergeEntries(accountLedger, guestLedger.entries).ledger
  const base: RiceLedger = {
    ...merged,
    // 水位/序号只增不减：重跑、两侧谁大取谁（guest 的 appliedServerSeq 恒 0）
    localSeq: Math.max(accountLedger.localSeq, guestLedger.localSeq),
    appliedServerSeq: Math.max(accountLedger.appliedServerSeq, guestLedger.appliedServerSeq)
  }

  // 客人空账本 ⇒ 没有可收编的：不写 marker（与 genesis 的 N=0 不建账同款）
  if (guestLedger.entries.length === 0) return base

  // marker 查重（重跑幂等的关键）：kind='adopt' 且 ref 是 {installId} 形态
  // （**没有** carried —— 那是 genesis 的判别器，见 rice-journal.ts 文件头）
  const already = base.entries.some(
    (e) =>
      e.kind === 'adopt' &&
      e.ref !== null &&
      !('carried' in e.ref) &&
      e.ref['installId'] === deps.installId
  )
  if (already) return base

  const seq = deps.nextSeq(maxLocalSeq(base, deps.installId))
  const marker: RiceEntry = {
    entryKey: `${deps.installId}:${seq}`,
    kind: 'adopt',
    delta: 0, // §6.1：delta 恒 0（服务端 delta 白名单 adopt 也只认 0）
    dayKey: petDayKey(nowIso),
    at: nowIso,
    ref: { installId: deps.installId },
    cloud: 'pending' // 要上行：服务端的每 (account, installId) 至多一条靠它
  }
  log(`adopt marker: entryKey=${marker.entryKey}`)
  // 必须最早：数组位 0（seq 是「现在发的号」，所以键序上不会是最小 —— 不变式
  // 说的是账本内时序/位置，服务端看不到顺序，见 docs/26 §6.1 与 rice-rules.ts 注记）
  return { ...base, entries: [marker, ...base.entries] }
}

/** 四份档案收编：逐份「读两侧 → 版本门 → 归一化 → 合并 → 有变化直写账号盒」 */
function adoptDocs(deps: AccountFlowDeps, accountDir: string, log: (m: string) => void): void {
  for (const dt of DOC_TYPES) {
    const name = STORE_FILES[dt]
    const guestRaw = createJsonStore<unknown>(deps.baseDir, name).read()
    if (guestRaw === null) continue // 客人侧没有这份档：没有可收编的

    const accountRaw = createJsonStore<unknown>(accountDir, name).read()
    const limit = DOC_VERSIONS[dt]
    const guestVer = rawVersionOf(guestRaw)
    const accountVer = rawVersionOf(accountRaw)
    if (guestVer !== null && guestVer > limit) {
      log(`adopt ${dt}: guest file is newer than this build, skipped`)
      continue
    }
    if (accountVer !== null && accountVer > limit) {
      log(`adopt ${dt}: account file is newer than this build, skipped`)
      continue
    }

    const guestNorm = normalizeDoc(dt as DocType, guestRaw, deps.installId)
    const accountNorm = normalizeDoc(dt as DocType, accountRaw, deps.installId)
    // 账号侧是本侧：changed 相对账号侧算 = 「账号盒需不需要这次写」
    const res = CLOUD_DOC_MERGERS[dt](accountNorm, guestNorm)
    if (res.changed) {
      writeJsonDirect(accountDir, name, res.merged)
      log(`adopt ${dt}: merged into the account box`)
    }
  }
}

// ---------------------------------------------------------------- 三个对外动作

/**
 * 激活（或重登直达）。调用方只在**已登录**时调用（令牌在 SessionTokenStore
 * 里；本函数验证会话与 accountId 一致）。
 *
 * 抛的错分两类：TypeError = 调用方 bug（没会话 / 账号对不上 / 盒停在别的
 * 账号上 / 首激活没给 mode）；AccountFlowError = 磁盘状态不许安全继续。
 */
export function activateAccount(
  deps: AccountFlowDeps,
  accountIdRaw: string,
  mode: ActivateMode | null
): ActivateOutcome {
  const log = deps.log ?? ((): void => {})
  const nowIso = (deps.now ?? ((): Date => new Date()))().toISOString()
  const accountId = assertSafeAccountId(accountIdRaw)
  const accountDir = accountDirOf(deps.baseDir, accountId)

  // 会话一致性：激活的必须就是当前登录的账号（防串号的最前一道）
  const session = deps.sessions.current()
  if (session === null) throw new TypeError('activate called without a signed-in session')
  if (session.sub.toLowerCase() !== accountId) {
    throw new TypeError('activate account does not match the signed-in session')
  }

  // 盒的位置不变式：登录后盒还在客人位；已激活重登时盒可能已在这个账号上。
  // 盒停在**别的**账号上还来激活新号 = 调用方跳过了干涸协议（登出/切换），拒绝。
  const boxId = deps.stores.box.currentAccountId()
  if (boxId !== null && boxId !== accountId) {
    throw new TypeError('activate called while the box is parked on another account')
  }

  // —— 已激活：直达（绝不重跑收编；mode 忽略）——
  if (isAccountActivated(accountDir)) {
    deps.stores.box.switchTo(accountId)
    deps.journal.load()
    return { outcome: 'already', adopt: null, accountId }
  }

  if (mode === null) throw new TypeError('activation mode is required for a first activation')

  // 凡是要落账号盒的都在 switchTo 之前直写（顺序见文件头）
  if (mode === 'merge-local') {
    const ledger = adoptRiceLedger(deps, accountDir, nowIso, log)
    writeJsonDirect(accountDir, RICE_LEDGER_FILE, ledger)
    adoptDocs(deps, accountDir, log)
  } else {
    // cloud-only：档案留给云同步拉；饭账本强制落空账闸死 genesis（见文件头）
    writeJsonDirect(accountDir, RICE_LEDGER_FILE, emptyLedger())
  }

  deps.stores.box.switchTo(accountId)
  deps.journal.load()
  markActivated(accountDir, nowIso) // ⑤ 最后盖（崩了重跑幂等）
  return { outcome: 'adopted', adopt: mode, accountId }
}

/**
 * 回客人盒（登出干涸协议的收尾）。只动盒与账本，**不碰令牌**（令牌是
 * SessionTokenStore 的事）。已经是客人盒 ⇒ 真 no-op（不白白 +epoch）。
 */
export function leaveToGuest(deps: AccountFlowDeps): boolean {
  if (deps.stores.box.currentAccountId() === null) return false
  deps.stores.box.switchTo(null)
  deps.journal.load()
  return true
}

/**
 * 仅本机退出（V1-62，2026-10-16）：丢本地令牌 + 回客人盒，**零网络**。
 *
 * 【与「真登出」的分工】真登出 = POST /v1/auth/logout（作废服务端会话）+
 * leaveToGuest，需要联网；断网时它失败且一切原样（刻意，见 account.ts 的
 * logout 注释），用户就被扣在登录态里 —— 收编页的逃生口恰好在它要救的场景
 * 里失效。本函数给的就是那条不需要网络的出路。
 *
 * 【服务端会话怎么办】不碰 —— 它原样活到过期（我们没发出作废请求）。这不是
 * 漏：作废需要网络，而这里的前提就是没有网络；会话在断网设备上不构成风险，
 * 联网后重新登录一次（新令牌替换旧的）即可。
 *
 * 【为什么丢令牌，而不是"留令牌只回客人盒"】留着令牌的话，下次启动
 * restoreOnStartup 会按 active+activated 把盒子直接切回账号 —— 「仅本机退出」
 * 活不过一次重启，等于骗人。丢令牌后的终端态与一次成功的真登出完全相同
 * （signedIn:false + 客人盒），既有闸门每一条都认识这个状态；代价是重新登录
 * 要再输一次密码 —— 界面文案把这一点说清楚。
 *
 * 【顺序】先令牌后盒：中途崩了，剩下的那次启动扫描也会收敛到未登录
 * （磁盘无会话 ⇒ 不切盒），不会留下"有令牌却停在客人位"的悬空态。
 * epoch/账本的收敛与 leaveToGuest 同一套机制。
 */
export function logoutLocal(deps: AccountFlowDeps): boolean {
  deps.sessions.set(null)
  return leaveToGuest(deps)
}

/**
 * 启动恢复（在 riceJournal 的启动装载之后调用）。三态见 StartupRestoreResult。
 * 不变式：扫描判 active 且已激活才切盒；未激活只注会话（见文件头）。
 */
export function restoreOnStartup(deps: AccountFlowDeps): StartupRestoreResult {
  const scan = scanSessionFiles(deps.baseDir, deps.safe)
  if (scan.kind !== 'active') return { restored: false, accountId: null, needsActivation: false }

  deps.sessions.hydrate(scan.session)
  const accountDir = accountDirOf(deps.baseDir, scan.accountId)
  if (!isAccountActivated(accountDir)) {
    // 登录着但还没收编：不切盒（切了界面看到空盒 = "数据没了"），等界面引导
    ;(deps.log ?? ((): void => {}))(`startup: account session found, activation pending`)
    return { restored: false, accountId: scan.accountId, needsActivation: true }
  }

  deps.stores.box.switchTo(scan.accountId)
  deps.journal.load()
  return { restored: true, accountId: scan.accountId, needsActivation: false }
}
