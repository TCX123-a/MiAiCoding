/**
 * 上行 runner（src/main/cloud/uplink.ts）的单测 —— 真 journal + 真队列落盘，
 * 只把三个网络口换成脚本化的假客户端（这一层的被测对象就是「编排」：
 * 什么时候发什么、失败怎么分类、epoch 屏障、计数→键的桥接）。
 *
 * 【钉死哪些裁决】
 *   · 客人盒 = 一个包都不发（skip 在任何网络动作之前）；
 *   · happy path 三相位（推 → 拉 → 结算）与三处落盘的真实结果；
 *   · push 守恒失败：只标 rejected 键、其余保持 pending、pull 照跑；
 *   · 授权死亡（UNAUTHENTICATED）⇒ authInvalid，且停轮；
 *   · 429 / 网络失败（httpStatus null）⇒ 停轮 + retryAfterMs 透传；
 *   · epoch 中途变 ⇒ stale 弃轮：**在途响应不落盘**（条目还在 pending）；
 *   · CHALLENGE_DUPLICATE ⇒ 出队不记败；400 ⇒ 记 attempts 继续下一条；
 *   · 单飞（并发 run 并入同一轮）；pull 分页与「长页但水位不前进」的防死循环。
 *
 * ⚠️ 本文件在 `src/` 下：字符串字面量一律 ASCII。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type {
  ChallengeSettleRequest,
  ChallengeSettleResponse,
  CloudFailure,
  CloudFailureCode,
  CloudResult,
  RiceLedgerEntry,
  RicePullResponse,
  RicePushRequest,
  RicePushResponse
} from '../../../shared/cloud/dto'
import { RICE_PULL_LIMIT_MAX } from '../../../shared/cloud/protocol'
import type { StoreBox } from '../../store/box'
import { createRiceJournal } from '../rice-journal'
import { createPendingOpsStore, parseSettlePayload, writePendingOps } from '../pending-ops'
import { createUplink, type UplinkDeps } from '../uplink'

const INSTALL = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const NOW = new Date(2026, 9, 11, 12, 0, 0)

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'miai-uplink-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------- 假三件套

const ok = <T>(data: T): CloudResult<T> => ({ ok: true, data })
const fail = (
  code: CloudFailureCode,
  httpStatus: number | null,
  extra: Partial<CloudFailure> = {}
): CloudResult<never> => ({ ok: false, failure: { code, message: `fake ${code}`, httpStatus, ...extra } })

interface FakeRice {
  client: { push: (b: RicePushRequest) => Promise<CloudResult<RicePushResponse>>; pull: (o: { since: number; limit?: number }) => Promise<CloudResult<RicePullResponse>> }
  pushCalls: RicePushRequest[]
  pullCalls: Array<{ since: number; limit?: number }>
  pushQueue: Array<
    | CloudResult<RicePushResponse>
    | ((b: RicePushRequest) => CloudResult<RicePushResponse> | Promise<CloudResult<RicePushResponse>>)
  >
  pullQueue: Array<
    | CloudResult<RicePullResponse>
    | ((o: { since: number; limit?: number }) => CloudResult<RicePullResponse> | Promise<CloudResult<RicePullResponse>>)
  >
}

function fakeRice(): FakeRice {
  const f: FakeRice = {
    pushCalls: [],
    pullCalls: [],
    pushQueue: [],
    pullQueue: [],
    client: {
      push: async (b) => {
        f.pushCalls.push(b)
        const next = f.pushQueue.shift()
        if (!next) throw new Error('fake rice: push called with empty queue')
        return typeof next === 'function' ? await next(b) : next
      },
      pull: async (o) => {
        f.pullCalls.push(o)
        const next = f.pullQueue.shift()
        if (!next) throw new Error('fake rice: pull called with empty queue')
        return typeof next === 'function' ? await next(o) : next
      }
    }
  }
  return f
}

const pushOk = (over: Partial<RicePushResponse> = {}): CloudResult<RicePushResponse> =>
  ok({ accepted: 0, duplicated: 0, rejected: [], balance: 0, earnedTotal: 0, spentTotal: 0, ...over })

const pullOk = (over: Partial<RicePullResponse> = {}): CloudResult<RicePullResponse> =>
  ok({ entries: [], nextSeq: 0, balance: 0, ...over })

/** 服务端下行单条（seq/flags 是我们认识但账本不收的字段） */
function serverEntry(seq: number, over: Partial<RiceLedgerEntry> = {}): RiceLedgerEntry {
  return {
    seq,
    entryKey: `ffffffff-0000-4000-8000-${String(seq).padStart(12, '0')}:1`,
    kind: 'lesson',
    delta: 2,
    dayKey: '2026-10-10',
    at: '2026-10-10T10:00:00.000Z',
    ref: { lessonId: 'c-02' },
    flags: [],
    ...over
  }
}

const settleOkBody = (dateKey: string): ChallengeSettleResponse => ({
  settled: true,
  idempotent: false,
  dateKey,
  correct: 3,
  total: 4,
  score: 55,
  scoreMax: 70,
  flags: []
})

interface FakeChallenge {
  client: { settle: (b: ChallengeSettleRequest) => Promise<CloudResult<ChallengeSettleResponse>> }
  calls: ChallengeSettleRequest[]
  queue: Array<CloudResult<ChallengeSettleResponse> | ((b: ChallengeSettleRequest) => CloudResult<ChallengeSettleResponse>)>
}

function fakeChallenge(): FakeChallenge {
  const f: FakeChallenge = {
    calls: [],
    queue: [],
    client: {
      settle: async (b) => {
        f.calls.push(b)
        const next = f.queue.shift()
        if (!next) throw new Error('fake challenge: settle called with empty queue')
        return typeof next === 'function' ? next(b) : next
      }
    }
  }
  return f
}

// ---------------------------------------------------------------- 受控盒与 runner

interface BoxState {
  accountId: string | null
  epoch: number
}

function fakeBox(state: BoxState): StoreBox {
  return {
    currentDir: () => dir,
    currentAccountId: () => state.accountId,
    epoch: () => state.epoch,
    switchTo: () => {}
  }
}

interface Harness extends UplinkDeps {
  uplink: ReturnType<typeof createUplink>
  boxState: BoxState
  fakeRice: FakeRice
  fakeChallenge: FakeChallenge
}

function makeUplink(
  opts: { signedIn?: boolean; carried?: number } = {}
): Harness {
  const boxState: BoxState = { accountId: opts.signedIn === false ? null : INSTALL, epoch: 1 }
  const journal = createRiceJournal({
    dir: () => dir,
    installId: INSTALL,
    nextSeq: (maxLocal) => Math.max(maxLocal + 1, 1),
    carriedRice: () => opts.carried ?? 0,
    now: () => NOW
  })
  journal.load()
  const settleQueue = createPendingOpsStore(() => dir)
  const fr = fakeRice()
  const fc = fakeChallenge()
  const box = fakeBox(boxState)
  const uplink = createUplink({
    box,
    journal,
    settleQueue,
    rice: fr.client,
    challenge: fc.client,
    installId: INSTALL,
    now: () => NOW
  })
  return { box, journal, settleQueue, rice: fr.client, challenge: fc.client, installId: INSTALL, uplink, boxState, fakeRice: fr, fakeChallenge: fc }
}

/** 往真队列里排若干天合法结算（走 writePendingOps 真落盘；入队序 = 数组序） */
function queueSettle(...dateKeys: string[]): void {
  const settles = dateKeys.map((dateKey) => {
    const payload = parseSettlePayload({
      dateKey,
      source: 'local',
      finishedAt: '2026-10-11T12:00:00.000Z',
      questions: [
        {
          key: 'c-01:q1',
          lessonId: 'c-01',
          qid: 'q1',
          lang: 'c',
          stage: 1,
          type: 'choice',
          difficulty: 'easy',
          source: 'local',
          ok: true
        }
      ]
    })!
    return {
      submissionId: `00000000-0000-4000-8000-${dateKey.replace(/-/g, '').padEnd(12, '0')}`,
      dateKey,
      payload,
      attempts: 0,
      lastError: null,
      queuedAt: '2026-10-11T12:01:00.000Z'
    }
  })
  writePendingOps(dir, { version: 1, settles })
}

// ---------------------------------------------------------------- 用例

describe('客人盒与授权', () => {
  it('客人盒（未登录）：skipped，一个包都不发', async () => {
    const h = makeUplink({ signedIn: false })
    const res = await h.uplink.run()
    expect(res.skipped).toBe(true)
    expect(res.skipReason).toBe('signed-out')
    expect(h.fakeRice.pushCalls).toHaveLength(0)
    expect(h.fakeRice.pullCalls).toHaveLength(0)
    expect(h.fakeChallenge.calls).toHaveLength(0)
  })

  it('push 撞 UNAUTHENTICATED：authInvalid=true 且停轮（pull 不发）', async () => {
    const h = makeUplink()
    h.journal.record({ kind: 'lesson', ref: { lessonId: 'c-01' } })
    h.fakeRice.pushQueue.push(fail('UNAUTHENTICATED', 401))
    const res = await h.uplink.run()
    expect(res.authInvalid).toBe(true)
    expect(h.fakeRice.pullCalls).toHaveLength(0)
    // 条目原样留在 pending（本地数据一律保留）
    expect(h.journal.current().entries[0].cloud).toBe('pending')
  })

  it('pull 撞 TOKEN_EXPIRED：authInvalid=true', async () => {
    const h = makeUplink()
    h.fakeRice.pullQueue.push(fail('TOKEN_EXPIRED', 401))
    const res = await h.uplink.run()
    expect(res.authInvalid).toBe(true)
    expect(res.failures.some((f) => f.phase === 'pull')).toBe(true)
  })
})

describe('happy path：推 → 拉 → 结算', () => {
  // 30s：本文件最重的一条（push/pull/settle 三相位 + 三处真 fs 落盘）。
  // 静机 <1s；2026-10-11 凌晨全量并发下 5341ms 顶穿默认 5s（负载假红，同
  // media-import/foreign-pc 批次）。断言一字未动。
  it('三相位一次跑完，三处落盘都是真结果', { timeout: 30_000 }, async () => {
    const h = makeUplink()
    h.journal.record({ kind: 'lesson', ref: { lessonId: 'c-01' } }) // +2 pending
    h.journal.record({ kind: 'feed', ref: null }) // -1 pending
    queueSettle('2026-10-10')

    h.fakeRice.pushQueue.push(pushOk({ accepted: 2, balance: 3 }))
    h.fakeRice.pullQueue.push(pullOk({ entries: [serverEntry(7)], nextSeq: 7, balance: 5 }))
    h.fakeChallenge.queue.push(ok(settleOkBody('2026-10-10')))

    const res = await h.uplink.run()
    expect(res.ricePushed).toBe(2)
    expect(res.riceRejected).toBe(0)
    expect(res.ricePulled).toBe(1)
    expect(res.settlesSent).toBe(1)
    expect(res.authInvalid).toBe(false)
    expect(res.failures).toEqual([])

    // 账本：本地两条已入云（cloud 摘掉）、下行一条并入、水位 7
    const l = h.journal.current()
    expect(l.entries.map((e) => e.cloud)).toEqual([undefined, undefined, undefined])
    expect(l.entries).toHaveLength(3)
    expect(l.appliedServerSeq).toBe(7)
    // 上行形状：剥掉了 cloud 字段（服务端不认识它）
    expect(h.fakeRice.pushCalls[0].entries.map((e) => 'cloud' in e)).toEqual([false, false])
    // 结算请求：submissionId 贴上了、payload 原文逐字节复用
    expect(h.fakeChallenge.calls[0].submissionId).toBe('00000000-0000-4000-8000-202610100000')
    expect(h.fakeChallenge.calls[0].installId).toBe(INSTALL)
    // 队列已清空（真落盘）
    expect(h.settleQueue.read().settles).toEqual([])
  })
})

describe('push 的失败分类与守恒桥接', () => {
  it('守恒（accepted+duplicated+rejected.length === 批大小）：全批摘 cloud', async () => {
    const h = makeUplink()
    h.journal.record({ kind: 'lesson', ref: { lessonId: 'c-01' } })
    h.journal.record({ kind: 'run', ref: { fingerprint: 'fp1' } })
    h.fakeRice.pushQueue.push(
      pushOk({ accepted: 1, duplicated: 1, rejected: [] }) // 1+1+0=2 守恒
    )
    h.fakeRice.pullQueue.push(pullOk())
    const res = await h.uplink.run()
    expect(res.ricePushed).toBe(2)
    expect(res.failures).toEqual([])
    expect(h.journal.current().entries.every((e) => e.cloud === undefined)).toBe(true)
  })

  it('守恒且带拒收：拒收赢（同键不会被标成已入云）', async () => {
    const h = makeUplink()
    h.journal.record({ kind: 'lesson', ref: { lessonId: 'c-01' } }) // :1
    h.journal.record({ kind: 'feed', ref: null }) // :2
    const keys = h.journal.current().entries.map((e) => e.entryKey)
    h.fakeRice.pushQueue.push(
      pushOk({ accepted: 1, duplicated: 0, rejected: [{ entryKey: keys[0], code: 'OVER_DAILY_CAP', detail: 'cap' }] }) // 1+0+1=2 守恒
    )
    h.fakeRice.pullQueue.push(pullOk())
    const res = await h.uplink.run()
    expect(res.riceRejected).toBe(1)
    expect(res.ricePushed).toBe(1)
    expect(res.failures).toEqual([]) // 守恒就没这团混乱
    const l = h.journal.current()
    expect(l.entries[0].cloud).toBe('rejected')
    expect(l.entries[1].cloud).toBeUndefined() // 被 accepted 摘章
  })

  it('不守恒：只标 rejected 点名的键，其余保持 pending，pull 照跑', async () => {
    const h = makeUplink()
    h.journal.record({ kind: 'lesson', ref: { lessonId: 'c-01' } }) // :1
    h.journal.record({ kind: 'feed', ref: null }) // :2
    const keys = h.journal.current().entries.map((e) => e.entryKey)
    // accepted=0 + rejected 只点名一条，加起来 ≠ 批大小 = 不守恒
    h.fakeRice.pushQueue.push(
      pushOk({ accepted: 0, duplicated: 0, rejected: [{ entryKey: keys[0], code: 'VALIDATION_FAILED', detail: 'out of window' }] })
    )
    h.fakeRice.pullQueue.push(pullOk())
    const res = await h.uplink.run()
    expect(res.riceRejected).toBe(1)
    expect(res.ricePushed).toBe(0)
    expect(res.failures.some((f) => f.code === 'MALFORMED_RESPONSE')).toBe(true)
    const l = h.journal.current()
    expect(l.entries[0].cloud).toBe('rejected')
    expect(l.entries[1].cloud).toBe('pending') // 绝不默认入云
    expect(h.fakeRice.pullCalls).toHaveLength(1) // pull 不受这团混乱影响
  })

  it('守恒失败后不再推第二批（MAX_PUSH_ROUNDS 提前 break）', async () => {
    const h = makeUplink()
    for (let i = 0; i < 3; i++) h.journal.record({ kind: 'answer', ref: null })
    h.fakeRice.pushQueue.push(pushOk({ accepted: 1 })) // 1+0+0=1 ≠ 3 不守恒
    h.fakeRice.pullQueue.push(pullOk())
    await h.uplink.run()
    expect(h.fakeRice.pushCalls).toHaveLength(1)
  })

  it('push 429：停轮 + retryAfterMs 透传（pull 不发）', async () => {
    const h = makeUplink()
    h.journal.record({ kind: 'answer', ref: null })
    h.fakeRice.pushQueue.push(fail('RATE_LIMITED', 429, { retryAfterMs: 1234 }))
    const res = await h.uplink.run()
    expect(res.retryAfterMs).toBe(1234)
    expect(h.fakeRice.pullCalls).toHaveLength(0)
    expect(h.journal.current().entries[0].cloud).toBe('pending')
  })

  it('push 网络失败（httpStatus null）：停轮', async () => {
    const h = makeUplink()
    h.journal.record({ kind: 'answer', ref: null })
    h.fakeRice.pushQueue.push(fail('NETWORK', null))
    const res = await h.uplink.run()
    expect(res.failures[0].phase).toBe('push')
    expect(h.fakeRice.pullCalls).toHaveLength(0)
  })

  it('没有 pending 条目：一个 push 都不发（空批不上行）', async () => {
    const h = makeUplink()
    h.fakeRice.pullQueue.push(pullOk())
    const res = await h.uplink.run()
    expect(h.fakeRice.pushCalls).toHaveLength(0)
    expect(res.ricePushed).toBe(0)
  })
})

describe('pull 分页', () => {
  it('长页（=500）继续翻，短页停；since 跟着水位走', async () => {
    const h = makeUplink()
    const page1 = Array.from({ length: RICE_PULL_LIMIT_MAX }, (_, i) => serverEntry(i + 1))
    h.fakeRice.pullQueue.push(pullOk({ entries: page1, nextSeq: RICE_PULL_LIMIT_MAX }))
    h.fakeRice.pullQueue.push(pullOk({ entries: [serverEntry(RICE_PULL_LIMIT_MAX + 1)], nextSeq: RICE_PULL_LIMIT_MAX + 1 }))
    const res = await h.uplink.run()
    expect(h.fakeRice.pullCalls.map((c) => c.since)).toEqual([0, RICE_PULL_LIMIT_MAX])
    expect(res.ricePulled).toBe(RICE_PULL_LIMIT_MAX + 1)
    expect(h.journal.current().appliedServerSeq).toBe(RICE_PULL_LIMIT_MAX + 1)
  })

  it('长页但水位不前进：防死循环，停（不再发下一页）', async () => {
    const h = makeUplink()
    const page = Array.from({ length: RICE_PULL_LIMIT_MAX }, (_, i) => serverEntry(i + 1))
    h.fakeRice.pullQueue.push(pullOk({ entries: page, nextSeq: 0 })) // nextSeq <= since
    await h.uplink.run()
    expect(h.fakeRice.pullCalls).toHaveLength(1)
  })
})

describe('结算队列的逐条处置', () => {
  it('CHALLENGE_DUPLICATE：出队、不记败（重复计分风险已排除）', async () => {
    const h = makeUplink()
    queueSettle('2026-10-10')
    h.fakeRice.pullQueue.push(pullOk())
    h.fakeChallenge.queue.push(fail('CHALLENGE_DUPLICATE', 409))
    const res = await h.uplink.run()
    expect(res.settlesDropped).toBe(1)
    expect(res.settlesSent).toBe(0)
    expect(h.settleQueue.read().settles).toEqual([])
    expect(res.failures).toEqual([])
  })

  it('400：记 attempts 留在队列、继续下一条（一条坏账不堵后面的天）', async () => {
    const h = makeUplink()
    queueSettle('2026-10-10', '2026-10-11') // 第一条 400，第二条照发
    h.fakeRice.pullQueue.push(pullOk())
    h.fakeChallenge.queue.push(fail('VALIDATION_FAILED', 400))
    h.fakeChallenge.queue.push(ok(settleOkBody('2026-10-11')))
    const res = await h.uplink.run()
    expect(h.fakeChallenge.calls).toHaveLength(2) // 没被第一条堵住
    expect(res.settlesSent).toBe(1)
    const q = h.settleQueue.read()
    expect(q.settles).toHaveLength(1) // 坏的那条还在（等下一条触发重试）
    expect(q.settles[0].dateKey).toBe('2026-10-10')
    expect(q.settles[0].attempts).toBe(1)
    expect(q.settles[0].lastError).toContain('VALIDATION_FAILED')
    expect(res.failures.some((f) => f.phase === 'settle')).toBe(true)
  })

  it('结算网络失败（httpStatus null）：记 attempts 后停轮（后面的天不发）', async () => {
    const h = makeUplink()
    queueSettle('2026-10-10', '2026-10-11')
    h.fakeRice.pullQueue.push(pullOk())
    h.fakeChallenge.queue.push(fail('NETWORK', null))
    const res = await h.uplink.run()
    expect(h.settleQueue.read().settles[0].attempts).toBe(1)
    expect(h.fakeChallenge.calls).toHaveLength(1) // 停轮：第二条没发
    expect(h.settleQueue.read().settles).toHaveLength(2) // 两条都在
    expect(res.failures.some((f) => f.phase === 'settle')).toBe(true)
  })

  it('结算撞 UNAUTHENTICATED：authInvalid，队列原样保留（不记 attempts）', async () => {
    const h = makeUplink()
    queueSettle('2026-10-10')
    h.fakeRice.pullQueue.push(pullOk())
    h.fakeChallenge.queue.push(fail('UNAUTHENTICATED', 401))
    const res = await h.uplink.run()
    expect(res.authInvalid).toBe(true)
    expect(h.settleQueue.read().settles[0].attempts).toBe(0)
  })
})

describe('epoch 屏障与单飞', () => {
  it('push 在途时切盒：弃轮 —— 在途响应不落盘', async () => {
    const h = makeUplink()
    h.journal.record({ kind: 'lesson', ref: { lessonId: 'c-01' } })
    h.fakeRice.pushQueue.push((b) => {
      h.boxState.epoch++ // 模拟 push 在途时登录/登出
      return pushOk({ accepted: b.entries.length })
    })
    const res = await h.uplink.run()
    expect(res.failures.some((f) => f.code === 'STALE_EPOCH')).toBe(true)
    expect(h.journal.current().entries[0].cloud).toBe('pending') // 没被旧会话的响应结清
    expect(h.fakeRice.pullCalls).toHaveLength(0)
  })

  it('单飞：并发 run() 并入同一轮（网络口各只被打一次）', async () => {
    const h = makeUplink()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    h.fakeRice.pullQueue.push(async () => {
      await gate
      return pullOk()
    })
    const p1 = h.uplink.run()
    const p2 = h.uplink.run()
    release()
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toBe(r2) // 同一份结果对象
    expect(h.fakeRice.pullCalls).toHaveLength(1)
  })
})
