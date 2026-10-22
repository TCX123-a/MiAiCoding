/**
 * 账号激活流程（src/main/cloud/account-flow.ts）—— 收编 / 直达 / 干涸 / 启动恢复。
 *
 * 【测试哲学：真件，不造假】这个文件的被测对象是「编排」——哪些文件先写、盒何时
 * 切、账本从哪读。所以底下的东西全用**真件**：真 mkdtemp 目录、真 createStores、
 * 真 createRiceJournal、真 createSessionTokenStore、真合并函数（CLOUD_DOC_MERGERS），
 * 只把 safeStorage 换成内存假件（它只是一层加解密，协议真身由 session-store 的
 * 测试守着）。假件只有 safeStorage 一个 —— 编排类测试一旦把存储也假掉，
 * 「写错了目录」这种最要命的 bug 恰好整类漏掉。
 *
 * 【每条断言想抓的坏法】
 *   · 收编写进**账号**目录而不是客人目录（写反 = 收编整个没发生还不报错）；
 *   · marker 的形状/位 0/查重（错了 = 服务端 400 毒批次或重复收编双算）；
 *   · cloud-only 的空账本（没了 = genesis 路径把客人存量漏进账号、双算）；
 *   · 坏账本必须**停下且一字不写**（「当空处理」两种都是灾难，见源文件头）；
 *   · 已激活重登直达（重跑收编 = 把客人盒后来攒的新数据又并一遍）；
 *   · 客人盒在收编后**逐字节未动**（收编是复制，不是搬家 —— docs/26 §6.1）。
 *
 * ⚠️ 本文件在 src/ 下；文案闸门跳过 __tests__（walk() 显式排除），用例标题
 * 用中文没问题，字符串字面量仍避免写用户可见文案。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CURRENT_PROFILE_VERSION } from '../../../shared/types'
import { parseLedger, type RiceLedger } from '../../../shared/cloud/rice-ledger'
import { createJsonStore } from '../../store/json-store'
import { createStores, type Stores } from '../../store/stores'
import { readSyncState } from '../../store/sync-state'
import {
  AccountFlowError,
  accountDirOf,
  activateAccount,
  isAccountActivated,
  leaveToGuest,
  logoutLocal,
  restoreOnStartup,
  type AccountFlowDeps
} from '../account-flow'
import { createRiceJournal, RICE_LEDGER_FILE, type RiceJournal } from '../rice-journal'
import { createSessionTokenStore, type SessionTokenStore } from '../session-store'
import type { SafeStorageLike } from '../session'

// ---------------------------------------------------------------- 常量与假件

const ACC = '11111111-2222-4333-8444-555555555555'
const ACC_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
/** installId 必须是 UUID 形状：账本 entryKey 正则是 `<36 字符 uuid>:<seq>` */
const INSTALL = 'e7c1a2b3-0000-4111-8222-333344445555'
const NOW = '2026-10-11T12:00:00.000Z'
const TOKEN = `ms1_${'A'.repeat(43)}` // 过 TOKEN_REGEX（会话扫描会验形状）
const TOKEN_B = `ms1_${'B'.repeat(43)}`
const EXPIRES = '2026-12-01T00:00:00.000Z'

/**
 * 内存 safeStorage：enc: 前缀 + 明文。协议真身（scanSessionFiles 的七条铁律、
 * writeSessionFile 的校验顺序）已有自己的测试，这里只需要「可逆、不含明文 token」。
 */
const SAFE: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
  decryptString: (buf) => {
    const s = buf.toString('utf8')
    if (!s.startsWith('enc:')) throw new Error('bad ciphertext')
    return s.slice(4)
  }
}

// ---------------------------------------------------------------- 世界（每用例一份）

const madeDirs: string[] = []
afterEach(() => {
  for (const dir of madeDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface World {
  base: string
  stores: Stores
  journal: RiceJournal
  sessions: SessionTokenStore
  deps: AccountFlowDeps
  logs: string[]
  /** 建会话（写 session.bin 到 accounts/<sub>/，与真实登录落盘同路） */
  signInAs(sub: string, token: string): void
  /** 模拟重启后的新 SessionTokenStore（内存空白、磁盘照旧） */
  newSessions(): SessionTokenStore
  /** 用替换过 sessions 的 deps（restoreOnStartup 的重启语义） */
  depsWith(sessions: SessionTokenStore): AccountFlowDeps
  /** 供 genesis 路径消费的 pet.json.rice 值 */
  setPetRice(n: number): void
}

function makeWorld(): World {
  const base = mkdtempSync(join(tmpdir(), 'miai-flow-'))
  madeDirs.push(base)

  let petRice = 0
  let deviceSeq = 0
  // 设备级发号器：与 app.ts 同款（max(已发, 账本最大) + 1），journal 与收编共用一个
  const nextSeq = (ledgerMaxSeq: number): number => {
    deviceSeq = Math.max(deviceSeq, ledgerMaxSeq) + 1
    return deviceSeq
  }

  const stores = createStores(base)
  const journal = createRiceJournal({
    dir: () => stores.box.currentDir(),
    installId: INSTALL,
    nextSeq,
    carriedRice: () => petRice,
    now: () => new Date(NOW)
  })
  const sessions = createSessionTokenStore({ baseDir: base, safe: SAFE, now: () => NOW, log: () => {} })
  const logs: string[] = []

  const makeDeps = (s: SessionTokenStore): AccountFlowDeps => ({
    baseDir: base,
    stores,
    journal,
    sessions: s,
    safe: SAFE,
    installId: INSTALL,
    nextSeq,
    now: () => new Date(NOW),
    log: (m) => logs.push(m)
  })

  return {
    base,
    stores,
    journal,
    sessions,
    deps: makeDeps(sessions),
    logs,
    signInAs: (sub, token) => sessions.set({ token, sub, expiresAt: EXPIRES }),
    newSessions: () => createSessionTokenStore({ baseDir: base, safe: SAFE, now: () => NOW, log: () => {} }),
    depsWith: (s) => makeDeps(s),
    setPetRice: (n) => {
      petRice = n
    }
  }
}

// ---------------------------------------------------------------- 小工具

const accDir = (w: World): string => accountDirOf(w.base, ACC)
const guestLedgerFile = (w: World): string => join(w.base, RICE_LEDGER_FILE)
const accLedgerFile = (w: World): string => join(accDir(w), RICE_LEDGER_FILE)

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8')) as unknown
}
function writeRaw(dir: string, name: string, data: unknown): void {
  createJsonStore<unknown>(dir, name).write(data)
}
function readLedger(path: string): RiceLedger {
  const parsed = parseLedger(readJson(path))
  expect(parsed, `ledger at ${path} must parse`).not.toBeNull()
  return parsed as RiceLedger
}

/** 客人盒的顶层文件快照（accounts/ 不算客人盒）——「逐字节未动」判据 */
function snapshotGuestFiles(base: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (entry.name === 'accounts' || !entry.isFile()) continue
    out.set(entry.name, readFileSync(join(base, entry.name), 'utf-8'))
  }
  return out
}

/** 收编 marker 的判别器：kind='adopt' 且 ref 是 {installId} 形态（无 carried） */
function isAdoptMarker(e: { kind: string; ref: Record<string, unknown> | null }): boolean {
  return e.kind === 'adopt' && e.ref !== null && !('carried' in e.ref)
}

// ---------------------------------------------------------------- 首激活：merge-local

describe('activateAccount：首激活 merge-local（收编）', () => {
  it('★ 客人账 + 客人档案并进账号盒；marker 位 0、形状冻结；盒切到账号；客人盒一字未动', () => {
    const w = makeWorld()
    w.journal.load()
    w.journal.record({ kind: 'answer', ref: null }) // 客人攒了 2 碗
    w.journal.record({ kind: 'answer', ref: null })
    writeRaw(w.base, 'profile.json', { version: CURRENT_PROFILE_VERSION, learned: ['g1'] })
    const guestBefore = snapshotGuestFiles(w.base)

    w.signInAs(ACC, TOKEN)
    const out = activateAccount(w.deps, ACC, 'merge-local')

    expect(out).toEqual({ outcome: 'adopted', adopt: 'merge-local', accountId: ACC })
    expect(w.stores.box.currentAccountId()).toBe(ACC)
    expect(isAccountActivated(accDir(w))).toBe(true)
    expect(readSyncState(accDir(w)).activatedAt).toBe(NOW)

    // 账本：marker 在最前，两条客人账在后，余额镜像没变
    const acc = readLedger(accLedgerFile(w))
    expect(acc.entries).toHaveLength(3)
    const marker = acc.entries[0]!
    expect(isAdoptMarker(marker)).toBe(true)
    expect(marker.delta).toBe(0) // §6.1：delta 恒 0
    expect(marker.ref).toEqual({ installId: INSTALL })
    expect(marker.cloud).toBe('pending') // 要上行（服务端靠它做每 installId 一次的闸）
    expect(marker.entryKey).toBe(`${INSTALL}:3`) // 号池与客人账共用：1、2 已被用
    expect(marker.dayKey).toBe('2026-10-11')
    expect(marker.at).toBe(NOW)
    expect(w.journal.balance()).toBe(2)
    expect(w.logs.some((m) => m.startsWith('adopt marker'))).toBe(true)

    // 档案：账号盒 profile 里有客人的 learned
    const prof = readJson(join(accDir(w), 'profile.json')) as { learned: string[] }
    expect(prof.learned).toContain('g1')
    expect(w.logs.some((m) => m.includes('adopt profile: merged'))).toBe(true)

    // 收编是复制不是搬家：客人盒逐字节未动
    expect(snapshotGuestFiles(w.base)).toEqual(guestBefore)
  })

  it('客人空账本 ⇒ 不写 marker（没有可收编的，不制造假条目）', () => {
    const w = makeWorld()
    w.journal.load()
    w.signInAs(ACC, TOKEN)
    activateAccount(w.deps, ACC, 'merge-local')
    const acc = readLedger(accLedgerFile(w))
    expect(acc.entries).toEqual([])
    expect(w.journal.balance()).toBe(0)
  })

  it('★ 幂等重跑（模拟盖激活章之前崩了）：marker 不重复、账本语义全等', () => {
    const w = makeWorld()
    w.journal.load()
    w.journal.record({ kind: 'answer', ref: null })
    w.signInAs(ACC, TOKEN)
    activateAccount(w.deps, ACC, 'merge-local')
    const first = readLedger(accLedgerFile(w))

    // 重启后的样子：激活章没了（崩在 markActivated 之前）、盒回客人位
    rmSync(join(accDir(w), '.sync'), { recursive: true, force: true })
    w.stores.box.switchTo(null)
    w.journal.load()

    const again = activateAccount(w.deps, ACC, 'merge-local')
    expect(again.outcome).toBe('adopted')
    const second = readLedger(accLedgerFile(w))
    // 并集幂等 + marker 按 (installId, !carried) 查重：重算结果与第一遍全等
    expect(second).toEqual(first)
    expect(second.entries.filter(isAdoptMarker)).toHaveLength(1)
    expect(isAccountActivated(accDir(w))).toBe(true)
  })
})

// ---------------------------------------------------------------- 首激活：cloud-only

describe('activateAccount：首激活 cloud-only', () => {
  it('★ 强制落空账本闸死 genesis（客人存量 500 不许漏进账号）；档案不收编', () => {
    const w = makeWorld()
    w.setPetRice(500) // 升级前存量：journal 首装会建 genesis（客人余额 500）
    w.journal.load()
    expect(w.journal.balance()).toBe(500)
    writeRaw(w.base, 'profile.json', { version: CURRENT_PROFILE_VERSION, learned: ['g1'] })
    const guestBefore = snapshotGuestFiles(w.base)

    w.signInAs(ACC, TOKEN)
    const out = activateAccount(w.deps, ACC, 'cloud-only')

    expect(out).toEqual({ outcome: 'adopted', adopt: 'cloud-only', accountId: ACC })
    // 账号账本是**空账文件**（不是「没有文件」—— 没有文件会走 genesis 双算）
    expect(existsSync(accLedgerFile(w))).toBe(true)
    expect(readLedger(accLedgerFile(w)).entries).toEqual([])
    expect(w.journal.balance()).toBe(0)
    // 档案留给云同步拉：账号盒没有 profile.json
    expect(existsSync(join(accDir(w), 'profile.json'))).toBe(false)
    // 客人盒（含 genesis 账）逐字节未动
    expect(snapshotGuestFiles(w.base)).toEqual(guestBefore)
  })
})

// ---------------------------------------------------------------- 坏账本 = 停下

describe('activateAccount：账号盒坏饭账', () => {
  it('★ 抛 LEDGER_CORRUPT：一字不写、客人盒未动、盒不切、激活章不盖、坏档留证', () => {
    const w = makeWorld()
    w.journal.load()
    w.journal.record({ kind: 'answer', ref: null })
    // 坏档：version 2 —— parseLedger 判 null（形状不认识）
    writeRaw(accDir(w), RICE_LEDGER_FILE, { version: 2, entries: [] })
    const badBytes = readFileSync(accLedgerFile(w), 'utf-8')
    const guestBefore = snapshotGuestFiles(w.base)

    w.signInAs(ACC, TOKEN)
    let caught: unknown = null
    try {
      activateAccount(w.deps, ACC, 'merge-local')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(AccountFlowError)
    expect((caught as AccountFlowError).code).toBe('LEDGER_CORRUPT')

    expect(w.stores.box.currentAccountId()).toBeNull() // 盒没切
    expect(readSyncState(accDir(w)).activatedAt).toBeNull() // 章没盖
    expect(readFileSync(accLedgerFile(w), 'utf-8')).toBe(badBytes) // 坏档原样留证
    expect(snapshotGuestFiles(w.base)).toEqual(guestBefore) // 客人盒一字未动
  })
})

// ---------------------------------------------------------------- 版本门

describe('activateAccount：版本门（与同步轮同一口径）', () => {
  it('客人档案比本机新 ⇒ 跳过这份（不归一化、不写账号盒）、客人档未动', () => {
    const w = makeWorld()
    w.journal.load()
    writeRaw(w.base, 'profile.json', { version: 99, learned: ['z'] })
    const guestBytes = readFileSync(join(w.base, 'profile.json'), 'utf-8')

    w.signInAs(ACC, TOKEN)
    activateAccount(w.deps, ACC, 'merge-local')

    expect(existsSync(join(accDir(w), 'profile.json'))).toBe(false)
    expect(readFileSync(join(w.base, 'profile.json'), 'utf-8')).toBe(guestBytes)
    expect(w.logs.some((m) => m.includes('profile') && m.includes('newer than this build'))).toBe(true)
  })

  it('账号档案比本机新 ⇒ 同样跳过（老客户端不许把新形状重写成旧形状）', () => {
    const w = makeWorld()
    w.journal.load()
    writeRaw(w.base, 'profile.json', { version: CURRENT_PROFILE_VERSION, learned: ['g1'] })
    writeRaw(accDir(w), 'profile.json', { version: 99, learned: ['new'] })
    const accBytes = readFileSync(join(accDir(w), 'profile.json'), 'utf-8')

    w.signInAs(ACC, TOKEN)
    activateAccount(w.deps, ACC, 'merge-local')

    expect(readFileSync(join(accDir(w), 'profile.json'), 'utf-8')).toBe(accBytes)
    expect(w.logs.some((m) => m.includes('account file is newer'))).toBe(true)
  })
})

// ---------------------------------------------------------------- 已激活直达

describe('activateAccount：已激活重登直达', () => {
  it('★ mode 忽略（null 也不抛）、绝不重跑收编（客人后来新增的不进账号盒）', () => {
    const w = makeWorld()
    w.journal.load()
    w.journal.record({ kind: 'answer', ref: null })
    writeRaw(w.base, 'profile.json', { version: CURRENT_PROFILE_VERSION, learned: ['g1'] })
    w.signInAs(ACC, TOKEN)
    activateAccount(w.deps, ACC, 'merge-local')
    const accAfterFirst = readLedger(accLedgerFile(w))
    expect((readJson(join(accDir(w), 'profile.json')) as { learned: string[] }).learned).toContain('g1')

    // 激活之后客人盒又攒了数据（换设备/换账号前的正常情形）
    const guest = readLedger(guestLedgerFile(w))
    writeRaw(w.base, RICE_LEDGER_FILE, {
      ...guest,
      entries: [
        ...guest.entries,
        { entryKey: `${INSTALL}:77`, kind: 'answer', delta: 1, dayKey: '2026-10-11', at: NOW, ref: null, cloud: 'pending' }
      ]
    })
    writeRaw(w.base, 'profile.json', { version: CURRENT_PROFILE_VERSION, learned: ['g1', 'g2'] })

    const revisit = activateAccount(w.deps, ACC, null) // 重登：mode 为 null
    expect(revisit).toEqual({ outcome: 'already', adopt: null, accountId: ACC })
    expect(w.stores.box.currentAccountId()).toBe(ACC)
    // 账号账本没有被第二次收编污染
    expect(readLedger(accLedgerFile(w))).toEqual(accAfterFirst)
    const prof = readJson(join(accDir(w), 'profile.json')) as { learned: string[] }
    expect(prof.learned).not.toContain('g2')
  })
})

// ---------------------------------------------------------------- 前置断言

describe('activateAccount：调用方错误一律 TypeError 且不落任何盘', () => {
  it('没有会话 ⇒ 抛；盒与磁盘原样', () => {
    const w = makeWorld()
    w.journal.load()
    expect(() => activateAccount(w.deps, ACC, 'merge-local')).toThrow(/signed-in/)
    expect(w.stores.box.currentAccountId()).toBeNull()
    expect(existsSync(accLedgerFile(w))).toBe(false)
  })

  it('会话账号与激活账号不符 ⇒ 抛（防串号）', () => {
    const w = makeWorld()
    w.journal.load()
    w.signInAs(ACC_B, TOKEN_B)
    expect(() => activateAccount(w.deps, ACC, 'merge-local')).toThrow(/does not match/)
    expect(w.stores.box.currentAccountId()).toBeNull()
  })

  it('盒停在别的账号上 ⇒ 抛（调用方跳过了干涸协议）', () => {
    const w = makeWorld()
    w.journal.load()
    w.signInAs(ACC, TOKEN)
    w.stores.box.switchTo(ACC_B)
    expect(() => activateAccount(w.deps, ACC, 'merge-local')).toThrow(/parked/)
    expect(w.stores.box.currentAccountId()).toBe(ACC_B) // 盒位未动
  })

  it('首激活没给 mode ⇒ 抛', () => {
    const w = makeWorld()
    w.journal.load()
    w.signInAs(ACC, TOKEN)
    expect(() => activateAccount(w.deps, ACC, null)).toThrow(TypeError)
    expect(w.stores.box.currentAccountId()).toBeNull()
  })

  it('accountDirOf：大小写归一后再拼路径；坏 id 抛（白名单在拼路径之前）', () => {
    const w = makeWorld()
    expect(accountDirOf(w.base, ACC.toUpperCase())).toBe(join(w.base, 'accounts', ACC))
    expect(() => accountDirOf(w.base, '../../evil')).toThrow(TypeError)
  })
})

// ---------------------------------------------------------------- 启动恢复

describe('restoreOnStartup：三态', () => {
  it('客人（没有会话文件）⇒ 不恢复、不切盒', () => {
    const w = makeWorld()
    w.journal.load()
    const r = restoreOnStartup(w.deps)
    expect(r).toEqual({ restored: false, accountId: null, needsActivation: false })
    expect(w.stores.box.currentAccountId()).toBeNull()
  })

  it('★ active 但未激活 ⇒ 只注会话、绝不切盒（切了 = 用户看到空盒「数据没了」）', () => {
    const w = makeWorld()
    w.journal.load()
    w.journal.record({ kind: 'answer', ref: null }) // 客人盒有 1 碗
    w.signInAs(ACC, TOKEN)

    const fresh = w.newSessions() // 新进程：内存空白，磁盘上有 session.bin
    const r = restoreOnStartup(w.depsWith(fresh))
    expect(r).toEqual({ restored: false, accountId: ACC, needsActivation: true })
    expect(w.stores.box.currentAccountId()).toBeNull() // 盒停在客人位
    expect(fresh.get()).toBe(TOKEN) // 但会话已注回内存
    expect(w.journal.balance()).toBe(1) // 账本仍是客人账
  })

  it('★ active 且已激活 ⇒ 注会话 + 切盒 + 装账号账本', () => {
    const w = makeWorld()
    w.journal.load()
    w.journal.record({ kind: 'answer', ref: null })
    w.signInAs(ACC, TOKEN)
    activateAccount(w.deps, ACC, 'merge-local')
    w.journal.record({ kind: 'answer', ref: null }) // 账号盒里再攒 1 碗（共 2）

    // 重启：盒回客人位、账本重装成客人账
    w.stores.box.switchTo(null)
    w.journal.load()
    expect(w.journal.balance()).toBe(1)

    const fresh = w.newSessions()
    const r = restoreOnStartup(w.depsWith(fresh))
    expect(r).toEqual({ restored: true, accountId: ACC, needsActivation: false })
    expect(w.stores.box.currentAccountId()).toBe(ACC)
    expect(fresh.get()).toBe(TOKEN)
    expect(w.journal.balance()).toBe(2) // 装的是账号账本
  })
})

// ---------------------------------------------------------------- 回客人盒

describe('leaveToGuest', () => {
  it('★ 从账号盒回客人：切盒 + 账本换回客人账；已经是客人 ⇒ 真 no-op（不白白 +epoch）', () => {
    const w = makeWorld()
    w.journal.load()
    w.journal.record({ kind: 'answer', ref: null }) // 客人 1 碗
    w.signInAs(ACC, TOKEN)
    activateAccount(w.deps, ACC, 'merge-local')
    w.journal.record({ kind: 'answer', ref: null }) // 账号盒加到 2 碗
    expect(w.journal.balance()).toBe(2)

    expect(leaveToGuest(w.deps)).toBe(true)
    expect(w.stores.box.currentAccountId()).toBeNull()
    expect(w.journal.balance()).toBe(1) // 账本跟着盒换回来了

    // 已经是客人盒：一个字节都不该动（epoch 是 observable —— no-op 必须真 no-op）
    const epoch = w.stores.box.epoch()
    expect(leaveToGuest(w.deps)).toBe(false)
    expect(w.stores.box.epoch()).toBe(epoch)
  })
})

// ---------------------------------------------------------------- 仅本机退出（V1-62）

describe('logoutLocal：仅本机退出（零网络；断网时真登出失败后的出路）', () => {
  it('★ 丢本地令牌 + 回客人盒：终端态与真登出相同，且活得过重启（不再自愈回登录态）', () => {
    const w = makeWorld()
    w.journal.load()
    w.journal.record({ kind: 'answer', ref: null }) // 客人 1 碗
    w.signInAs(ACC, TOKEN)
    activateAccount(w.deps, ACC, 'merge-local')
    w.journal.record({ kind: 'answer', ref: null }) // 账号盒 2 碗
    expect(w.sessions.current()?.token).toBe(TOKEN)

    expect(logoutLocal(w.deps)).toBe(true)
    expect(w.sessions.current()).toBeNull()
    expect(w.stores.box.currentAccountId()).toBeNull()
    expect(w.journal.balance()).toBe(1) // 账本跟着盒换回客人账

    // 「留令牌只回客人盒」的假版本会活不过这两条：盘上 session.bin 真没了，
    // 重启扫描也收敛到未登录（不是 active+activated 被 restoreOnStartup 捞回去）
    expect(existsSync(join(w.base, 'accounts', ACC, 'session.bin'))).toBe(false)
    const fresh = w.newSessions()
    const r = restoreOnStartup(w.depsWith(fresh))
    expect(r).toEqual({ restored: false, accountId: null, needsActivation: false })
    expect(w.stores.box.currentAccountId()).toBeNull()
  })

  it('登录了但没收编（盒还在客人位）⇒ 令牌照样清掉、盒真 no-op、账本不动', () => {
    const w = makeWorld()
    w.journal.load()
    w.journal.record({ kind: 'answer', ref: null }) // 客人 1 碗
    w.signInAs(ACC, TOKEN) // 只登录，不激活 —— V1-62 逃生口所在的正是这一页
    const epoch = w.stores.box.epoch()
    const guestFiles = snapshotGuestFiles(w.base)

    expect(logoutLocal(w.deps)).toBe(false) // 盒本来就在客人位（leaveToGuest 的返回值）
    expect(w.sessions.current()).toBeNull()
    expect(w.stores.box.epoch()).toBe(epoch) // 盒一个字节没动
    expect(w.journal.balance()).toBe(1)
    expect(snapshotGuestFiles(w.base)).toEqual(guestFiles) // 客人盒逐字节原样
    expect(existsSync(join(w.base, 'accounts', ACC, 'session.bin'))).toBe(false)
  })
})

// ---------------------------------------------------------------- 与 mergeEntries 的口径对齐

describe('口径钉子：收编并集与 mergeEntries 同一语义', () => {
  it('账号账本先于客人账本（同键「已有者胜」= 账号侧），客人新键追加', () => {
    const w = makeWorld()
    w.journal.load()
    w.journal.record({ kind: 'answer', ref: null }) // guest :1
    // 账号盒先前已有一条同键但内容不同（云端拉下来的形态：cloud 缺席 = 已入云）
    // —— 收编不许覆盖它
    writeRaw(accDir(w), RICE_LEDGER_FILE, {
      version: 1,
      entries: [
        { entryKey: `${INSTALL}:1`, kind: 'answer', delta: 1, dayKey: '2026-01-01', at: '2026-01-01T00:00:00.000Z', ref: null }
      ],
      localSeq: 0,
      appliedServerSeq: 5
    })

    w.signInAs(ACC, TOKEN)
    activateAccount(w.deps, ACC, 'merge-local')

    const acc = readLedger(accLedgerFile(w))
    const dup = acc.entries.filter((e) => e.entryKey === `${INSTALL}:1`)
    expect(dup).toHaveLength(1) // 去重
    expect(dup[0]!.cloud).toBeUndefined() // 账号侧那份胜（客人的 pending 没覆盖它）
    expect(dup[0]!.dayKey).toBe('2026-01-01') // 连字段都是账号侧那份的
    expect(acc.appliedServerSeq).toBe(5) // 水位只增不减（重拉会重算，不许被归零）
  })
})
