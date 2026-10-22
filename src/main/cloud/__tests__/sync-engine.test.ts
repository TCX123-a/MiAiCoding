/**
 * 同步引擎（src/main/cloud/sync-engine.ts）—— docs/21 §8.2 七步的离线全分支测试。
 *
 * 【怎么做到一次不联网】provider 用 provider-fake 编排剧本（返回什么由 script
 * 说了算，调用记进 calls）；磁盘用 mkdtemp 的隔离目录（绝不碰主人真档）；
 * 时钟注入固定值（退避/syncedAt/at 全部可预期）。
 *
 * 【剧本怎么排】getDoc 的数组剧本按**调用顺序**消耗，而四份文档按 DOC_TYPES
 * 顺序逐一处理到完（profile 的冲突重试会连着吃掉多条）—— 所以带重试的用例里，
 * 数组前几格是 profile 的多次拉取，之后才是另外三份的 404（基线 = 云端没有、
 * 本地没有 ⇒ unchanged）。putDoc 剧本同理。
 *
 * 【为什么大部分用例只驱动 profile】四份文档走同一条代码路径（DOC_TYPES 循环），
 * 区别只在归一化/合并函数（那是 P10.4 各 merge 测试的范围）。引擎侧用 profile
 * （learned 是字符串数组，真实归一化下最容易编排）；合并函数本身是**假件**，
 * 只保证「按 canonical 序并集」这一条引擎依赖的性质（输出带当前 version）。
 *
 * 【这里钉死的引擎裁决】体积门在版本门之前（§8.2 步骤 2→3）；push 只在
 * 合并结果与云端逐字节不同时发生；404+本地空 ⇒ 清账本条目不推；本地版本
 * 高于本机 ⇒ 只读不写（LOCAL_VER_TOO_NEW）；changedDocs 去重；槽内切盒
 * ⇒ 弃轮且不写账本。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，字符串一律英文。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DOC_TYPES, type DocType } from '../../../shared/cloud/protocol'
import type { CloudFailureCode, CloudResult } from '../../../shared/cloud/dto'
import { canonicalJson } from '../../../shared/cloud/canonical-json'
import { migrateProfile } from '../../../shared/profile-migrate'
import {
  CURRENT_FAVORITES_VERSION,
  CURRENT_PRACTICE_VERSION,
  CURRENT_PROFILE_VERSION,
  CURRENT_WRONGBOOK_VERSION,
  type UserProfile
} from '../../../shared/types'
import { createStores, type Stores } from '../../store/stores'
import { emptySyncState, readSyncState, writeSyncState } from '../../store/sync-state'
import { cloudOk } from '../transport'
import type { ApiProvider } from '../provider'
import { createFakeProvider, type ProviderCall, type ProviderScript } from './provider-fake'
import { createSyncEngine, type DocMerger } from '../sync-engine'
import { hashDocPayload } from '../doc-hash'

const ACC = '3f2a6c14-9d5b-4e7a-8c01-2b3d4e5f6a70'
const INSTALL_ID = 'install-test-0001'
const AT = '2026-10-10T12:00:00.000Z'
const SEED_AT = '2026-01-01T00:00:00.000Z'

let dir: string
let stores: Stores

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'miai-sync-'))
  stores = createStores(dir)
  stores.box.switchTo(ACC)
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const accDir = (): string => join(dir, 'accounts', ACC)
const stateFile = (): string => join(accDir(), '.sync', 'state.json')
const accProfileFile = (): string => join(accDir(), 'profile.json')
const guestProfileFile = (): string => join(dir, 'profile.json')

// ---------------------------------------------------------------- 剧本小工具

function fail(code: CloudFailureCode, httpStatus: number | null = null): CloudResult<unknown> {
  return { ok: false, failure: { code, message: `scripted ${code}`, httpStatus } }
}
const ok404 = (): CloudResult<unknown> => fail('NOT_FOUND', 404)
const notModified = (): CloudResult<unknown> => cloudOk({ notModified: true })
function fullDoc(
  docVer: number,
  revision: number,
  payload: Record<string, unknown>
): CloudResult<unknown> {
  return cloudOk({ notModified: false, docVer, revision, updatedAt: AT, payload })
}
function putOk(revision: number, docVer: number): CloudResult<unknown> {
  return cloudOk({ revision, docVer, updatedAt: AT })
}

type FakeProvider = ReturnType<typeof createFakeProvider>
function docCalls(provider: FakeProvider, method: string): ProviderCall[] {
  return provider.calls.filter((c) => c.method === method)
}

// ---------------------------------------------------------------- 假合并器与本地数据

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function asObj(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/**
 * 假合并器：把某个数组字段按「canonical 序并集」合并 —— 形状不重要，
 * 引擎依赖的两条性质要真（确定性、输出 version = 当前版本）。
 */
function makeSetMerger(field: string, version: number): DocMerger {
  return (local, remote) => {
    const l = asObj(local)
    const r = asObj(remote)
    const seen = new Map<string, unknown>()
    for (const item of [...asArray(l[field]), ...asArray(r[field])]) seen.set(canonicalJson(item), item)
    const merged: Record<string, unknown> = { ...l, ...r }
    merged[field] = [...seen.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([, value]) => value)
    merged['version'] = version
    return { merged, changed: canonicalJson(merged) !== canonicalJson(l) }
  }
}

const MERGERS: Record<DocType, DocMerger> = {
  profile: makeSetMerger('learned', CURRENT_PROFILE_VERSION),
  wrongbook: makeSetMerger('entries', CURRENT_WRONGBOOK_VERSION),
  favorites: makeSetMerger('items', CURRENT_FAVORITES_VERSION),
  practice: makeSetMerger('history', CURRENT_PRACTICE_VERSION)
}

function buildEngine(
  script: ProviderScript,
  mergerOverrides: Partial<Record<DocType, DocMerger>> = {}
): { provider: FakeProvider; engine: ReturnType<typeof createSyncEngine> } {
  const provider = createFakeProvider(script)
  const engine = createSyncEngine({
    provider,
    stores,
    installId: INSTALL_ID,
    mergers: { ...MERGERS, ...mergerOverrides },
    now: () => new Date(AT),
    log: () => {}
  })
  return { provider, engine }
}

function writeLocalProfile(learned: string[]): void {
  stores.profile.write({ version: CURRENT_PROFILE_VERSION, learned } as unknown as UserProfile)
}

/**
 * 同 buildEngine，但用给定的假提供方 —— V1-65 的取消场景要「在飞的请求」，
 * provider-fake 的剧本全是即时回值，演不了挂起。只给取消用例用。
 */
function buildEngineWith(
  provider: ApiProvider & { calls: ProviderCall[] },
  mergerOverrides: Partial<Record<DocType, DocMerger>> = {}
): ReturnType<typeof createSyncEngine> {
  return createSyncEngine({
    provider,
    stores,
    installId: INSTALL_ID,
    mergers: { ...MERGERS, ...mergerOverrides },
    now: () => new Date(AT),
    log: () => {}
  })
}

/** 手排闸门提供方（V1-65）：每份文档一串步骤按调用序消耗；'hang' = 挂起等 release() */
type GateStep = 'ok404' | 'fail' | 'hang' | 'full'
function createGateProvider(plan: Partial<Record<DocType, GateStep[]>>): {
  provider: ApiProvider & { calls: ProviderCall[] }
  release: () => void
} {
  const calls: ProviderCall[] = []
  const waiters: Array<() => void> = []
  const provider: ApiProvider & { calls: ProviderCall[] } = {
    calls,
    register: () => {
      throw new Error('gate provider: register is not scripted')
    },
    login: () => {
      throw new Error('gate provider: login is not scripted')
    },
    logout: () => {
      throw new Error('gate provider: logout is not scripted')
    },
    session: () => {
      throw new Error('gate provider: session is not scripted')
    },
    listDocs: () => {
      throw new Error('gate provider: listDocs is not scripted')
    },
    async getDoc(dt, opts) {
      calls.push({ method: 'getDoc', args: [dt, opts] })
      const step = plan[dt]?.shift() ?? 'ok404'
      if (step === 'hang') await new Promise<void>((resolve) => waiters.push(resolve))
      if (step === 'fail') {
        return { ok: false, failure: { code: 'NETWORK', message: 'gate fail', httpStatus: null } }
      }
      if (step === 'full') {
        // 完整文档（payload 是 profile 形状 —— 目前只有 profile 用例排它）
        return cloudOk({
          notModified: false,
          docVer: CURRENT_PROFILE_VERSION,
          revision: 9,
          updatedAt: AT,
          payload: { version: CURRENT_PROFILE_VERSION, learned: ['b'] }
        })
      }
      return { ok: false, failure: { code: 'NOT_FOUND', message: 'gate 404', httpStatus: 404 } }
    },
    async putDoc(dt, input) {
      calls.push({ method: 'putDoc', args: [dt, input] })
      return cloudOk({ revision: 1, docVer: 1, updatedAt: AT })
    }
  }
  return { provider, release: () => { for (const w of waiters.splice(0)) w() } }
}

/**
 * 用一条"占位任务"把某份文档的 IO 队列槽掐住 —— 引擎推进到 `await queues.run`
 * 就会停在队列上（确定性挂起点，不靠微任务时序）：取消落在这个窗口里，
 * 走的就是「文档已了结、下一份还没发」与「合并完、写请求还没发」两道闸。
 */
function holdQueue(dt: DocType): { release: () => void; held: Promise<void> } {
  let release!: () => void
  const gate = new Promise<void>((r) => {
    release = r
  })
  const held = stores.queues.run(dt, () => gate)
  return { release, held }
}

/** 等条件成立（等"请求真的发出去了"用；200×1ms 还等不到就是剧本写错了） */
async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 1))
  if (!cond()) throw new Error('until: condition never became true')
}

function readLocalProfileLearned(): unknown {
  return (JSON.parse(readFileSync(accProfileFile(), 'utf-8')) as { learned?: unknown }).learned
}
function profileNorm(learned: string[]): Record<string, unknown> {
  return migrateProfile({ version: CURRENT_PROFILE_VERSION, learned }) as unknown as Record<string, unknown>
}
function seedLedger(dt: DocType, revision: number, hash: string, syncedAt = SEED_AT): void {
  const state = emptySyncState()
  state.docs[dt] = { revision, hash, syncedAt }
  writeSyncState(accDir(), state)
}

// ---------------------------------------------------------------- 未登录与退避

describe('未登录与退避（都不发包）', () => {
  it('客人盒（未登录）⇒ skipped signed-out，一个包都不发', async () => {
    stores.box.switchTo(null)
    const { provider, engine } = buildEngine({})
    const r = await engine.syncNow()
    expect(r.skipped).toBe(true)
    expect(r.skipReason).toBe('signed-out')
    expect(r.at).toBe(AT)
    expect(provider.calls).toEqual([])
  })

  it('★ 全败 ⇒ 退避升档 1→5 分钟；窗口内 skipped backoff；force 绕过', async () => {
    const { provider, engine } = buildEngine({ getDoc: fail('NETWORK') })
    const r1 = await engine.syncNow()
    expect(r1.skipped).toBe(false)
    expect(r1.docs.map((d) => d.status)).toEqual(['failed', 'failed', 'failed', 'failed'])
    expect(r1.docs[0]?.failureCode).toBe('NETWORK')
    expect(provider.calls).toHaveLength(4)

    const r2 = await engine.syncNow()
    expect(r2.skipped).toBe(true)
    expect(r2.skipReason).toBe('backoff')
    expect(r2.retryAfterMs).toBe(60_000)
    expect(provider.calls).toHaveLength(4) // 退避窗口内不发包

    const r3 = await engine.syncNow({ force: true })
    expect(r3.docs).toHaveLength(4)
    expect(provider.calls).toHaveLength(8)

    const r4 = await engine.syncNow()
    expect(r4.skipReason).toBe('backoff')
    expect(r4.retryAfterMs).toBe(5 * 60_000) // 升到第二档
  })
})

// ---------------------------------------------------------------- 404 分支

describe('404（云端没有这份文档）', () => {
  it('四份都 404、本地全空 ⇒ unchanged、零 push、账本连文件都不建', async () => {
    const { provider, engine } = buildEngine({ getDoc: [ok404(), ok404(), ok404(), ok404()] })
    const r = await engine.syncNow()
    expect(r.docs).toEqual(DOC_TYPES.map((dt) => ({ docType: dt, status: 'unchanged' })))
    expect(r.changedDocs).toEqual([])
    expect(docCalls(provider, 'putDoc')).toHaveLength(0)
    // 没有账本 ⇒ 条件 GET 不带 ifNoneMatchRevision
    expect(docCalls(provider, 'getDoc').map((c) => c.args)).toEqual(
      DOC_TYPES.map((dt) => [dt, undefined])
    )
    expect(existsSync(stateFile())).toBe(false) // 无事发生就不写账本
  })

  it('★ 404 + 本地有内容 ⇒ 首推 baseRevision=null，账本记服务端 revision 与内容哈希', async () => {
    writeLocalProfile(['a'])
    const { provider, engine } = buildEngine({
      getDoc: [ok404(), ok404(), ok404(), ok404()],
      putDoc: [putOk(7, CURRENT_PROFILE_VERSION)]
    })
    const r = await engine.syncNow()
    expect(r.docs[0]).toEqual({ docType: 'profile', status: 'synced' })
    const puts = docCalls(provider, 'putDoc')
    expect(puts).toHaveLength(1)
    expect(puts[0]?.args[0]).toBe('profile')
    const input = puts[0]?.args[1] as {
      docVer: number
      baseRevision: number | null
      payload: Record<string, unknown>
    }
    expect(input.docVer).toBe(CURRENT_PROFILE_VERSION) // payload.version === docVer（协议硬规则）
    expect(input.baseRevision).toBeNull()
    expect(input.payload['learned']).toEqual(['a'])
    expect(readSyncState(accDir()).docs.profile).toEqual({
      revision: 7,
      hash: hashDocPayload(input.payload),
      syncedAt: AT
    })
  })

  it('404 + 账本有旧条目但本地已清空 ⇒ 账本条目清掉（不推空文档）', async () => {
    seedLedger('profile', 5, hashDocPayload(profileNorm(['a'])))
    const { provider, engine } = buildEngine({ getDoc: [ok404(), ok404(), ok404(), ok404()] })
    const r = await engine.syncNow()
    expect(r.docs[0]).toEqual({ docType: 'profile', status: 'unchanged' })
    expect(docCalls(provider, 'putDoc')).toHaveLength(0)
    expect(readSyncState(accDir()).docs.profile).toBeUndefined()
  })

  it('★ 404 + 本地版本高于本机（降级运行）⇒ blocked LOCAL_VER_TOO_NEW，不写盘不推送', async () => {
    stores.profile.write({ version: 99, learned: ['z'] } as unknown as UserProfile)
    const { provider, engine } = buildEngine({ getDoc: [ok404(), ok404(), ok404(), ok404()] })
    const r = await engine.syncNow()
    expect(r.docs[0]).toEqual({ docType: 'profile', status: 'blocked', blockReason: 'LOCAL_VER_TOO_NEW' })
    expect(readLocalProfileLearned()).toEqual(['z']) // 一个字节不动
    expect(docCalls(provider, 'putDoc')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------- 全量拉取分支

describe('全量拉取（云端有文档）', () => {
  it('★ 两边内容一致 ⇒ 不推、不写盘，账本跟到云端 revision', async () => {
    writeLocalProfile(['a'])
    const { provider, engine } = buildEngine({
      getDoc: [fullDoc(4, 9, { version: 4, learned: ['a'] }), ok404(), ok404(), ok404()]
    })
    const r = await engine.syncNow()
    expect(r.docs[0]).toEqual({ docType: 'profile', status: 'synced' })
    expect(r.changedDocs).toEqual([])
    expect(docCalls(provider, 'putDoc')).toHaveLength(0)
    expect(readSyncState(accDir()).docs.profile?.revision).toBe(9)
  })

  it('云端有本地没有 ⇒ 写盘（进 changedDocs）、不推（云端已有）', async () => {
    writeLocalProfile(['a'])
    const { provider, engine } = buildEngine({
      getDoc: [fullDoc(4, 10, { version: 4, learned: ['a', 'b'] }), ok404(), ok404(), ok404()]
    })
    const r = await engine.syncNow()
    expect(r.docs[0]).toEqual({ docType: 'profile', status: 'synced' })
    expect(r.changedDocs).toEqual(['profile'])
    expect(readLocalProfileLearned()).toEqual(['a', 'b'])
    expect(docCalls(provider, 'putDoc')).toHaveLength(0)
    expect(readSyncState(accDir()).docs.profile?.revision).toBe(10)
  })

  it('★ 两边各有对方没有的 ⇒ 写盘 + 推送（baseRevision=云端 revision），账本记 push 响应', async () => {
    writeLocalProfile(['a'])
    const seed = emptySyncState()
    seed.activatedAt = '2026-01-02T03:04:05.000Z'
    writeSyncState(accDir(), seed)
    const { provider, engine } = buildEngine({
      getDoc: [fullDoc(4, 10, { version: 4, learned: ['b'] }), ok404(), ok404(), ok404()],
      putDoc: [putOk(11, 4)]
    })
    const r = await engine.syncNow()
    expect(r.docs[0]).toEqual({ docType: 'profile', status: 'synced' })
    expect(r.changedDocs).toEqual(['profile'])
    const input = docCalls(provider, 'putDoc')[0]?.args[1] as {
      baseRevision: number | null
      payload: Record<string, unknown>
    }
    expect(input.baseRevision).toBe(10)
    expect(input.payload['learned']).toEqual(['a', 'b'])
    expect(readLocalProfileLearned()).toEqual(['a', 'b'])
    const st = readSyncState(accDir())
    expect(st.docs.profile).toEqual({ revision: 11, hash: hashDocPayload(input.payload), syncedAt: AT })
    expect(st.activatedAt).toBe('2026-01-02T03:04:05.000Z') // 轮末账本写不碰 activatedAt
  })
})

// ---------------------------------------------------------------- 304 分支

describe('304（条件 GET 命中：云端 = 账本那一刻）', () => {
  it('本地内容与账本 hash 一致 ⇒ unchanged、零 push、账本原样', async () => {
    writeLocalProfile(['a'])
    const hash = hashDocPayload(profileNorm(['a']))
    seedLedger('profile', 5, hash)
    const { provider, engine } = buildEngine({ getDoc: [notModified(), ok404(), ok404(), ok404()] })
    const r = await engine.syncNow()
    expect(r.docs[0]).toEqual({ docType: 'profile', status: 'unchanged' })
    expect(docCalls(provider, 'putDoc')).toHaveLength(0)
    expect(docCalls(provider, 'getDoc')[0]?.args[1]).toEqual({ ifNoneMatchRevision: 5 }) // 账本在 ⇒ 条件 GET
    const st = readSyncState(accDir())
    expect(st.docs.profile).toEqual({ revision: 5, hash, syncedAt: SEED_AT }) // syncedAt 还是种子那一刻
  })

  it('★ 本地动过（hash 不符）⇒ 推本地，baseRevision = 账本 revision', async () => {
    writeLocalProfile(['a', 'c'])
    seedLedger('profile', 5, hashDocPayload(profileNorm(['a'])))
    const { provider, engine } = buildEngine({
      getDoc: [notModified(), ok404(), ok404(), ok404()],
      putDoc: [putOk(6, 4)]
    })
    const r = await engine.syncNow()
    expect(r.docs[0]).toEqual({ docType: 'profile', status: 'synced' })
    const input = docCalls(provider, 'putDoc')[0]?.args[1] as {
      baseRevision: number | null
      payload: Record<string, unknown>
    }
    expect(input.baseRevision).toBe(5)
    expect(input.payload['learned']).toEqual(['a', 'c'])
    expect(readSyncState(accDir()).docs.profile?.revision).toBe(6)
  })
})

// ---------------------------------------------------------------- 闸门

describe('闸门（体积 / 版本）', () => {
  it('云端 docVer 高于本机 ⇒ blocked DOC_VER_TOO_NEW：不 merge 不写盘不推', async () => {
    writeLocalProfile(['a'])
    // ⚠️ "更高"必须**相对当前版本**算，不许写死数字：写死 5 的旧夹具在档案
    // 升到 v5 那天起就变成"两边一样新"，这条从"挡得住"静默滑成"照常同步"
    // （2026-10-16 实测：升 v5 后它真的红了 —— 是夹具漂了，不是闸门坏了）
    const newer = CURRENT_PROFILE_VERSION + 1
    const { provider, engine } = buildEngine({
      getDoc: [fullDoc(newer, 10, { version: newer, learned: ['z'] }), ok404(), ok404(), ok404()]
    })
    const r = await engine.syncNow()
    expect(r.docs[0]).toEqual({ docType: 'profile', status: 'blocked', blockReason: 'DOC_VER_TOO_NEW' })
    expect(r.changedDocs).toEqual([])
    expect(readLocalProfileLearned()).toEqual(['a'])
    expect(docCalls(provider, 'putDoc')).toHaveLength(0)
    expect(r.pendingPush).toEqual(['profile'])
    expect(readSyncState(accDir()).pendingPush.map((p) => p.docType)).toEqual(['profile'])
  })

  it('★ 体积门在版本门之前：超限 + 版本也新 ⇒ 报 PAYLOAD_TOO_LARGE（§8.2 步骤顺序）', async () => {
    writeLocalProfile(['a'])
    // "版本也新"同样是相对当前版本（+1）：两个门都**够得着开火**，断言才在
    // 验顺序；版本写成相等的话只剩体积门能响，这条就变成恒真的空转
    const newer = CURRENT_PROFILE_VERSION + 1
    const big = { version: newer, learned: [] as string[], blob: 'x'.repeat(2 * 1024 * 1024 + 64) }
    const { provider, engine } = buildEngine({
      getDoc: [fullDoc(newer, 10, big), ok404(), ok404(), ok404()]
    })
    const r = await engine.syncNow()
    expect(r.docs[0]).toEqual({ docType: 'profile', status: 'blocked', blockReason: 'PAYLOAD_TOO_LARGE' })
    expect(readLocalProfileLearned()).toEqual(['a'])
    expect(docCalls(provider, 'putDoc')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------- 409 冲突

describe('push 0 行冲突（409）：重拉重合并重推 ≤3 次', () => {
  it('★ 第一次冲突 → 重拉（不带条件）拿新 revision 再推，成功收敛', async () => {
    writeLocalProfile(['a'])
    const { provider, engine } = buildEngine({
      getDoc: [
        fullDoc(4, 10, { version: 4, learned: ['b'] }),
        fullDoc(4, 11, { version: 4, learned: ['b', 'c'] }),
        ok404(),
        ok404(),
        ok404()
      ],
      putDoc: [fail('CONFLICT_STALE', 409), putOk(12, 4)]
    })
    const r = await engine.syncNow()
    expect(r.docs[0]).toEqual({ docType: 'profile', status: 'synced' })
    expect(r.changedDocs).toEqual(['profile']) // 两轮都写了盘，去重后只报一次
    const gets = docCalls(provider, 'getDoc').filter((c) => c.args[0] === 'profile')
    expect(gets).toHaveLength(2)
    expect(gets[1]?.args[1]).toBeUndefined() // 重拉不带条件
    const puts = docCalls(provider, 'putDoc')
    expect(puts).toHaveLength(2)
    expect((puts[0]?.args[1] as { baseRevision: number | null }).baseRevision).toBe(10)
    expect((puts[1]?.args[1] as { baseRevision: number | null }).baseRevision).toBe(11)
    expect(readLocalProfileLearned()).toEqual(['a', 'b', 'c'])
    expect(readSyncState(accDir()).docs.profile?.revision).toBe(12)
  })

  it('★ 连冲突 4 次 ⇒ failed CONFLICT_STALE + pendingPush 落账本，本地数据不丢', async () => {
    writeLocalProfile(['a'])
    const { provider, engine } = buildEngine({
      getDoc: [
        fullDoc(4, 10, { version: 4, learned: ['b'] }),
        fullDoc(4, 11, { version: 4, learned: ['b', 'c'] }),
        fullDoc(4, 12, { version: 4, learned: ['b', 'c', 'd'] }),
        fullDoc(4, 13, { version: 4, learned: ['b', 'c', 'd', 'e'] }),
        ok404(),
        ok404(),
        ok404()
      ],
      putDoc: fail('CONFLICT_STALE', 409)
    })
    const r = await engine.syncNow()
    expect(r.docs[0]).toEqual({ docType: 'profile', status: 'failed', failureCode: 'CONFLICT_STALE' })
    expect(docCalls(provider, 'putDoc')).toHaveLength(4) // 首发 + 3 次重试
    expect(r.pendingPush).toEqual(['profile'])
    const st = readSyncState(accDir())
    expect(st.pendingPush).toEqual([{ docType: 'profile', at: AT }])
    expect(st.docs.profile).toBeUndefined() // 从未推成功 ⇒ 无账本条目
    expect(readLocalProfileLearned()).toEqual(['a', 'b', 'c', 'd', 'e']) // 每轮合并都写盘，只增不减
  })
})

// ---------------------------------------------------------------- 401 与 426

describe('401 与 426', () => {
  it('★ 401 ⇒ authInvalid，立即中断（后续文档一个请求都不发）', async () => {
    const { provider, engine } = buildEngine({ getDoc: fail('UNAUTHENTICATED', 401) })
    const r = await engine.syncNow()
    expect(r.authInvalid).toBe(true)
    expect(r.docs).toEqual([{ docType: 'profile', status: 'failed', failureCode: 'UNAUTHENTICATED' }])
    expect(provider.calls).toHaveLength(1)
  })

  it('★ 426 ⇒ protocolBlocked + 账本 blocked 落盘；之后进最长退避', async () => {
    const { provider, engine } = buildEngine({ getDoc: fail('PROTOCOL_TOO_OLD', 426) })
    const r = await engine.syncNow()
    expect(r.protocolBlocked).toBe(true)
    expect(r.docs).toEqual([{ docType: 'profile', status: 'failed', failureCode: 'PROTOCOL_TOO_OLD' }])
    expect(readSyncState(accDir()).blocked?.code).toBe('PROTOCOL_TOO_OLD')
    const r2 = await engine.syncNow()
    expect(r2.skipped).toBe(true)
    expect(r2.skipReason).toBe('backoff')
    expect(r2.retryAfterMs).toBe(60 * 60_000)
    expect(provider.calls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------- 坏形状与切盒

describe('坏形状与切盒', () => {
  it('merge 抛 ⇒ 该文档 failed INTERNAL，其余照常；磁盘不动', async () => {
    writeLocalProfile(['a'])
    const { provider, engine } = buildEngine(
      { getDoc: [fullDoc(4, 10, { version: 4, learned: ['b'] }), ok404(), ok404(), ok404()] },
      {
        profile: () => {
          throw new Error('merge boom')
        }
      }
    )
    const r = await engine.syncNow()
    expect(r.docs).toEqual([
      { docType: 'profile', status: 'failed', failureCode: 'INTERNAL' },
      { docType: 'wrongbook', status: 'unchanged' },
      { docType: 'favorites', status: 'unchanged' },
      { docType: 'practice', status: 'unchanged' }
    ])
    expect(readLocalProfileLearned()).toEqual(['a'])
    expect(docCalls(provider, 'putDoc')).toHaveLength(0)
    expect(r.pendingPush).toEqual(['profile'])
  })

  it('★ 槽内被切盒 ⇒ 弃轮：不写盘、不写账本、后续文档不处理', async () => {
    writeLocalProfile(['a'])
    const { provider, engine } = buildEngine(
      { getDoc: [fullDoc(4, 10, { version: 4, learned: ['b'] }), ok404(), ok404(), ok404()] },
      {
        profile: (local, remote) => {
          stores.box.switchTo(null) // 模拟槽内任何一刻发生账号切换
          return MERGERS.profile(local, remote)
        }
      }
    )
    const r = await engine.syncNow()
    expect(r.docs).toEqual([])
    expect(r.changedDocs).toEqual([])
    expect(existsSync(guestProfileFile())).toBe(false) // 客人盒一个字节没写
    expect(existsSync(stateFile())).toBe(false) // 账本也没写
    expect(readLocalProfileLearned()).toEqual(['a']) // 账号盒原样
    expect(provider.calls).toHaveLength(1) // 切盒后不再发第二个请求
  })

  it('单飞：在飞时并进当前轮（同一个 promise 对象），不叠第二轮', async () => {
    const { provider, engine } = buildEngine({ getDoc: [ok404(), ok404(), ok404(), ok404()] })
    const p1 = engine.syncNow()
    const p2 = engine.syncNow()
    expect(p2).toBe(p1)
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r2).toBe(r1)
    expect(provider.calls).toHaveLength(4)
  })
})

// ---------------------------------------------------------------- 取消（V1-65）

describe('取消（V1-65：文档之间的协作式取消）', () => {
  it('★ 在飞时取消：在飞那份结局整个丢弃、之后的文档一份不发、账本不落', async () => {
    writeLocalProfile(['a'])
    const gate = createGateProvider({ wrongbook: ['hang'] })
    const engine = buildEngineWith(gate.provider)
    const p = engine.syncNow()
    // profile 已了结、wrongbook 的 GET 在飞 —— 此刻用户点了「停止」
    await until(() => docCalls(gate.provider, 'getDoc').length === 2)
    engine.cancel()
    gate.release() // 在飞的 GET 照常回话：结局被整个丢弃（不当失败、也不当成功）
    const r = await p
    expect(r.canceled).toBe(true)
    expect(r.docs).toEqual([{ docType: 'profile', status: 'synced' }]) // 取消前了结的才算数
    expect(r.pendingPush).toEqual([])
    expect(docCalls(gate.provider, 'getDoc').map((c) => c.args[0])).toEqual(['profile', 'wrongbook'])
    const puts = docCalls(gate.provider, 'putDoc')
    expect(puts).toHaveLength(1)
    expect(puts[0]?.args[0]).toBe('profile')
    // 取消的轮不写账本：profile 明明 synced 了，账本推进也一并作废（全量重拉自愈）
    expect(existsSync(stateFile())).toBe(false)
  })

  it('★ 空转时取消：旗不误伤下一轮（新一轮从"没被取消"开始）', async () => {
    const { provider, engine } = buildEngine({ getDoc: [ok404(), ok404(), ok404(), ok404()] })
    engine.cancel() // 没有轮在飞 —— 这一枪必须打空
    const r = await engine.syncNow()
    expect(r.canceled).toBeUndefined()
    expect(r.docs).toHaveLength(4)
    expect(provider.calls).toHaveLength(4)
  })

  it('★ 被取消的轮不动退避：取消是用户意志不是网络失败，不许惩罚按键的人', async () => {
    const gate = createGateProvider({
      profile: ['fail', 'fail'],
      wrongbook: ['hang', 'fail'],
      favorites: ['fail'],
      practice: ['fail']
    })
    const engine = buildEngineWith(gate.provider)

    const p1 = engine.syncNow()
    await until(() => docCalls(gate.provider, 'getDoc').length === 2)
    engine.cancel()
    gate.release()
    const r1 = await p1
    expect(r1.canceled).toBe(true)
    // 取消前了结的失败照实记（那是真结论），但这一轮不许升退避档
    expect(r1.docs).toEqual([{ docType: 'profile', status: 'failed', failureCode: 'NETWORK' }])

    // 取消不升档：紧接着的常规轮照样真跑（若被取消的轮按"全败"升了档，这里会被 skip）
    const r2 = await engine.syncNow()
    expect(r2.skipped).toBe(false)
    expect(r2.docs.map((d) => d.status)).toEqual(['failed', 'failed', 'failed', 'failed'])

    // 尺子自证：真·全败一轮之后下一轮才 skip，且档位=一档（60s）
    const r3 = await engine.syncNow()
    expect(r3.skipped).toBe(true)
    expect(r3.skipReason).toBe('backoff')
    expect(r3.retryAfterMs).toBe(60_000)
  })

  it('★ 取消落在"文档了结、下一份还没发"之间：下一份的请求一份都不许发', async () => {
    const gate = createGateProvider({})
    const engine = buildEngineWith(gate.provider)
    const slot = holdQueue('profile') // 掐住 profile 的槽：引擎停在 404-空 分支的 await 上
    const p = engine.syncNow()
    await until(() => docCalls(gate.provider, 'getDoc').length === 1)
    await new Promise((r) => setTimeout(r, 5)) // 微任务跑干净：引擎已停在队列上
    engine.cancel()
    slot.release()
    const r = await p
    expect(r.canceled).toBe(true)
    expect(r.docs).toEqual([{ docType: 'profile', status: 'unchanged' }])
    // 没有"文档之间"这道闸的话，wrongbook 的 GET 会照发
    expect(docCalls(gate.provider, 'getDoc').map((c) => c.args[0])).toEqual(['profile'])
  })

  it('★ 取消落在"合并完、写请求还没发"之间：不带条件地不再发写请求', async () => {
    writeLocalProfile(['a'])
    const gate = createGateProvider({ profile: ['full'] })
    const engine = buildEngineWith(gate.provider)
    const slot = holdQueue('profile')
    const p = engine.syncNow()
    await until(() => docCalls(gate.provider, 'getDoc').length === 1)
    await new Promise((r) => setTimeout(r, 5))
    engine.cancel()
    slot.release() // 放行后槽照跑：本地合并照写盘（幂等），但推不许推
    const r = await p
    expect(r.canceled).toBe(true)
    expect(r.docs).toEqual([]) // 这份的结局（synced）整个丢弃
    expect(docCalls(gate.provider, 'putDoc')).toHaveLength(0)
    // 槽内已落盘的那点写不回收：changedDocs 照报（渲染层据此重载本地这份）
    expect(r.changedDocs).toEqual(['profile'])
    expect(readLocalProfileLearned()).toEqual(['a', 'b'])
  })
})
