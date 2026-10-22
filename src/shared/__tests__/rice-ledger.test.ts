/**
 * 大白饭镜像账（shared/cloud/rice-ledger.ts）的规矩台。
 *
 * 【每个判据都带种坏自检】本仓库铁律（memory: miai-false-positive-rule）：
 * 判定为真的路上不许有不需要证据的分支 —— 一条恒绿的断言等于没有断言。
 * 所以每个 it 都是两段：真实档先让断言过（正样本），再把坏样本/变异结果塞进
 * **同一句断言**由 expectCaught 钉住（它必须当场报错）。执行器 expectCaught
 * 自己另有一格尺子自检：对恒真断言、对非断言错误都必须报错（否则一个手滑的
 * TypeError 会伪装成「种坏被抓到」）。
 *
 * 【这份测试守的是什么】账本是同步两端的对账基准：余额不是存出来的，是
 * Σdelta 重算出来的。静默坏法（漏摘 cloud / 水位倒退 / 坏形状被宽容收下）
 * 不抛也不报错，只在对账时表现为「云端少两碗饭」。所以 docs/26 §6 的口径
 * 逐格钉死：clamp 两端、幂等与引用稳定、并集与已有者胜、服务端确认摘 cloud、
 * 推送三态迁移、水位只增不减、读入口任何一条坏 → 整份 null。
 */
import { describe, expect, it } from 'vitest'
import type { RiceEntry, RiceKind, RiceLedger } from '../cloud/rice-ledger'
import {
  appendLocal,
  applyPull,
  applyPushResult,
  balanceOf,
  emptyLedger,
  mergeEntries,
  parseLedger,
  pendingCount,
  pendingEntries,
  rejectedCount
} from '../cloud/rice-ledger'
import { RICE_LEDGER_KINDS, RICE_MAX } from '../cloud/protocol'

// ---------------------------------------------------------------- 夹具

const DEV_A = '01234567-89ab-cdef-0123-456789abcdef'
const K1 = `${DEV_A}:1`
const K2 = `${DEV_A}:2`
const K3 = `${DEV_A}:3`
const K4 = `${DEV_A}:4`
const K5 = `${DEV_A}:5`
const K6 = `${DEV_A}:6`
const OTHER = `${DEV_A}:999` // 本机账本里不存在的键（服务端多回的那种）
const S1 = `${DEV_A}:101` // 服务端 seq（下行条目）
const S2 = `${DEV_A}:102`

const T1 = '2026-10-01T10:00:00.000Z'
const T2 = '2026-10-02T10:00:00.000Z'

/** 规范形条目；over 覆盖任意字段（坏形状用例也走它，用 as 造非法值） */
function entry(entryKey: string, over: Partial<RiceEntry> = {}): RiceEntry {
  return {
    entryKey,
    kind: 'lesson',
    delta: 2,
    dayKey: '2026-10-01',
    at: T1,
    ref: null,
    ...over
  }
}

function ledgerWith(entries: RiceEntry[], over: Partial<RiceLedger> = {}): RiceLedger {
  return { version: 1, entries, localSeq: 10, appliedServerSeq: 5, ...over }
}

/** 读一条条目；读不到直接红 —— 后面的断言不许建立在 undefined 上（那是假绿的温床） */
function entryOf(ledger: RiceLedger, k: string): RiceEntry {
  const hit = ledger.entries.find((e) => e.entryKey === k)
  expect(hit, `entry ${k} must exist`).toBeTruthy()
  return hit as RiceEntry
}

/**
 * 种坏自检的执行器：把坏样本喂给**同一个**断言，它必须当场报错。
 * 两条排除线（缺一条就会出假绿）：
 *   · run 正常返回（断言恒绿）→ 这里报错（比较器是死的，绿不算证据）；
 *   · run 抛的不是断言失败（手滑的 TypeError 之类）→ 也报错（别让"代码写错"
 *     伪装成"种坏被抓到"）。
 */
function expectCaught(run: () => void, why: string): void {
  let caught: unknown = null
  let threw = false
  try {
    run()
  } catch (err) {
    threw = true
    caught = err
  }
  expect(threw, `${why} | bad sample must make the comparator red, but it stayed green`).toBe(true)
  expect(caught, `${why} | must fail by assertion`).toBeInstanceOf(Error)
  expect((caught as Error).name, `${why} | not a runtime error disguised as a caught mutant`).toBe('AssertionError')
}

// ---------------------------------------------------------------- 尺子自检

describe('尺子自检（expectCaught 不是恒绿的）', () => {
  it('会红的断言被抓到；恒真断言与运行时错误都会让 expectCaught 自己红', () => {
    expectCaught(() => expect(1).toBe(2), 'plain failing assertion')
    expectCaught(() => expect({ a: 1 }).toEqual({ a: 2 }), 'deep equality failure')
    // 恒真断言：expectCaught 必须报错（它确实要求 run 抛）
    expect(() => expectCaught(() => expect(1).toBe(1), 'vacuous')).toThrow()
    // 非断言错误：也报错（TypeError 不算「种坏被抓到」）
    expect(() =>
      expectCaught(() => {
        throw new TypeError('boom')
      }, 'runtime error')
    ).toThrow()
  })
})

// ---------------------------------------------------------------- balanceOf

describe('balanceOf：clamp(Σdelta, 0, RICE_MAX)', () => {
  it('Σ<0 → 0（下界）；未夹的负和不得冒充结果', () => {
    const neg = ledgerWith([entry(K1, { kind: 'feed', delta: -1 }), entry(K2, { kind: 'chat', delta: -2 })])
    expect(balanceOf(neg)).toBe(0)
    expectCaught(() => expect(balanceOf(neg)).toBe(-3), 'raw sum below zero must never leak out')
    expectCaught(() => expect(balanceOf(neg)).toBe(1), 'lower bound is 0, not some other floor')
  })

  it('Σ>RICE_MAX → RICE_MAX（上界）；恰在 RICE_MAX 不早夹', () => {
    const exact = ledgerWith([entry(K1, { delta: RICE_MAX })])
    const over = ledgerWith([entry(K1, { delta: RICE_MAX + 1 })])
    expect(balanceOf(exact)).toBe(RICE_MAX)
    expect(balanceOf(over)).toBe(RICE_MAX)
    expect(RICE_MAX).toBe(999) // 真源锚点：模块必须从 protocol 引，不许抄
    expectCaught(() => expect(balanceOf(over)).toBe(1000), 'unclamped overflow must never leak out')
    expectCaught(() => expect(balanceOf(exact)).toBe(RICE_MAX - 1), 'boundary must not clamp early')
  })

  it('区间内原值；空账本 0（clamp 不是把一切压成常数的坏尺子）', () => {
    const mid = ledgerWith([entry(K1, { delta: 2 }), entry(K2, { kind: 'feed', delta: -1 })])
    expect(balanceOf(mid)).toBe(1)
    expect(balanceOf(emptyLedger())).toBe(0)
    expectCaught(() => expect(balanceOf(mid)).toBe(0), 'mid value must not collapse to 0')
    expectCaught(() => expect(balanceOf(mid)).toBe(RICE_MAX), 'mid value must not collapse to max')
  })
})

// ---------------------------------------------------------------- appendLocal

describe('appendLocal：本地记账入口', () => {
  it('新条目：追加在尾部、盖 cloud=pending、入参账本一字不动、localSeq 不动', () => {
    const base = emptyLedger()
    const next = appendLocal(base, {
      entryKey: K1,
      kind: 'lesson',
      delta: 2,
      dayKey: '2026-10-01',
      at: T1,
      ref: { lessonId: 'common-01' }
    })
    expect(next).not.toBe(base)
    expect(base.entries).toEqual([]) // 入参没有被就地修改
    expect(next.entries).toEqual([
      { entryKey: K1, kind: 'lesson', delta: 2, dayKey: '2026-10-01', at: T1, ref: { lessonId: 'common-01' }, cloud: 'pending' }
    ])
    expect(next.localSeq).toBe(0) // 给号/递增是设备级分配器的活，本模块只透传
    expect(next.appliedServerSeq).toBe(0)
    expect(pendingCount(next)).toBe(1) // 没盖 pending 章的新账永远上不了行
    expectCaught(() => expect(next).toBe(base), 'new key must not reuse the input reference')
    expectCaught(() => expect(next.entries[0].cloud).toBeUndefined(), 'new local entry must carry pending')
  })

  it('重复 entryKey：原样返回同一引用；已有字段不被覆盖（幂等重放不造成写盘）', () => {
    const first = appendLocal(emptyLedger(), {
      entryKey: K1,
      kind: 'lesson',
      delta: 2,
      dayKey: '2026-10-01',
      at: T1,
      ref: null
    })
    const again = appendLocal(first, { entryKey: K1, kind: 'feed', delta: -1, dayKey: '2026-10-02', at: T2, ref: { x: 1 } })
    expect(again).toBe(first)
    expect(again.entries).toHaveLength(1)
    expect(again.entries[0].delta).toBe(2)
    expect(again.entries[0].kind).toBe('lesson')
    expectCaught(() => expect(again).not.toBe(first), 'duplicate must return the very same reference')
    expectCaught(() => expect(again.entries[0].delta).toBe(-1), 'duplicate must not overwrite fields')
  })

  it('追加保持插入序（不排序）', () => {
    let l = emptyLedger()
    l = appendLocal(l, { entryKey: K3, kind: 'lesson', delta: 2, dayKey: '2026-10-01', at: T1, ref: null })
    l = appendLocal(l, { entryKey: K1, kind: 'lesson', delta: 2, dayKey: '2026-10-01', at: T2, ref: null })
    l = appendLocal(l, { entryKey: K2, kind: 'lesson', delta: 2, dayKey: '2026-10-01', at: T2, ref: null })
    expect(l.entries.map((e) => e.entryKey)).toEqual([K3, K1, K2])
    expectCaught(
      () => expect(l.entries.map((e) => e.entryKey)).toEqual([K1, K2, K3]),
      'entries must keep insertion order, not sort'
    )
  })
})

// ---------------------------------------------------------------- mergeEntries

describe('mergeEntries：并集合并（收编与下行共用）', () => {
  it('三计数 added / duplicated / invalid：真实档钉住数值，坏样本被同一断言抓出', () => {
    const base = ledgerWith([entry(K1), entry(K2)])
    const res = mergeEntries(base, [
      entry(K2, { delta: 7 }), // duplicated（已有者胜，不改字段）
      entry(K3, { kind: 'answer', delta: 1 }), // added
      entry(K4, { kind: 'run', delta: 1 }), // added
      { nope: true }, // invalid
      'junk', // invalid
      entry(K5, { delta: '2' as unknown as number }) // invalid
    ])
    expect(res.added).toBe(2)
    expect(res.duplicated).toBe(1)
    expect(res.invalid).toBe(3)
    expectCaught(() => expect(res.added).toBe(3), 'added counter is dead')
    expectCaught(() => expect(res.duplicated).toBe(0), 'duplicated counter is dead')
    expectCaught(() => expect(res.invalid).toBe(2), 'invalid counter is dead')

    // 条目面：插入序 + 已有者胜 + 入参不动
    expect(res.ledger.entries.map((e) => e.entryKey)).toEqual([K1, K2, K3, K4])
    expect(entryOf(res.ledger, K2).delta).toBe(2) // 同键 incoming 的 delta=7 不许覆盖本地
    expect(entryOf(res.ledger, K3).kind).toBe('answer')
    expect(base.entries.map((e) => e.entryKey)).toEqual([K1, K2]) // 原账本未被就地改
    expect(base.entries[1].delta).toBe(2)
    expectCaught(() => expect(entryOf(res.ledger, K2).delta).toBe(7), 'existing entry must win')
    expectCaught(() => expect(base.entries).toHaveLength(4), 'input ledger must not be mutated in place')
  })

  it('幂等：同一批合并两次，第二次 added=0（无变化返回同一引用）', () => {
    const base = ledgerWith([entry(K1)])
    const batch = [entry(K2), entry(K3), entry(K1, { delta: 9 })]
    const once = mergeEntries(base, batch)
    expect(once.added).toBe(2)
    expect(once.duplicated).toBe(1)
    expect(once.invalid).toBe(0)

    const twice = mergeEntries(once.ledger, batch)
    expect(twice.added).toBe(0)
    expect(twice.duplicated).toBe(3)
    expect(twice.invalid).toBe(0)
    expect(twice.ledger).toBe(once.ledger) // 无变化 → 同一引用（调用方据此不落盘）
    expectCaught(() => expect(twice.added).toBe(2), 'second pass must add nothing')
    expectCaught(() => expect(twice.ledger).not.toBe(once.ledger), 'no-op merge must reuse the reference')
  })

  it('服务端确认特例：已有带 cloud、incoming 同键无 cloud ⇒ 摘 cloud，其余字段不动', () => {
    const pending = entry(K1, { delta: 5, cloud: 'pending' })
    const rejected = entry(K2, { cloud: 'rejected' })
    const base = ledgerWith([pending, rejected, entry(K3)])
    const res = mergeEntries(base, [entry(K1, { delta: 1, kind: 'feed' }), entry(K2)])

    expect(res.added).toBe(0)
    expect(res.duplicated).toBe(2)
    expect('cloud' in res.ledger.entries[0]).toBe(false) // pending 被结清
    expect('cloud' in res.ledger.entries[1]).toBe(false) // rejected 被追认也一样摘
    expect(entryOf(res.ledger, K1).delta).toBe(5) // 字段以本地为准，incoming 不覆盖
    expect(entryOf(res.ledger, K1).kind).toBe('lesson')
    expect(entryOf(res.ledger, K3)).toEqual(entry(K3)) // 没提到的条目原样
    expect(base.entries[0].cloud).toBe('pending') // 入参未被就地修改
    expectCaught(() => expect('cloud' in res.ledger.entries[0]).toBe(true), 'confirmed entry must drop cloud')
    expectCaught(() => expect(entryOf(res.ledger, K1).delta).toBe(1), 'incoming fields must not overwrite local ones')
    expectCaught(() => expect('cloud' in base.entries[0]).toBe(false), 'input ledger must not be mutated in place')
  })

  it('反向不对称：已有无 cloud、incoming 带 cloud ⇒ 已有者胜，什么都不变（同一引用）', () => {
    const base = ledgerWith([entry(K4)])
    const res = mergeEntries(base, [entry(K4, { cloud: 'pending' })])
    expect(res.added).toBe(0)
    expect(res.duplicated).toBe(1)
    expect(res.ledger).toBe(base)
    expect('cloud' in res.ledger.entries[0]).toBe(false)
    expectCaught(() => expect(entryOf(res.ledger, K4).cloud).toBe('pending'), 'the confirmation rule only strips, never infects')
  })

  it('incoming 批内同键：首个收下，后来者计 duplicated（不覆盖）', () => {
    const res = mergeEntries(emptyLedger(), [entry(K1, { delta: 2 }), entry(K1, { delta: 9 })])
    expect(res.added).toBe(1)
    expect(res.duplicated).toBe(1)
    expect(res.ledger.entries).toHaveLength(1)
    expect(res.ledger.entries[0].delta).toBe(2)
    expectCaught(() => expect(res.ledger.entries[0].delta).toBe(9), 'first occurrence must win inside one batch')
  })

  it('坏形状逐类跳过：绝不抛、绝不半信写入；incoming 非数组按空批处理', () => {
    const bad = [
      null,
      42,
      'x',
      [],
      {},
      entry(K1, { entryKey: 42 as unknown as string }),
      entry(K1, { kind: 'party' as unknown as RiceKind }),
      entry(K1, { delta: '2' as unknown as number }),
      entry(K1, { delta: Number.POSITIVE_INFINITY }),
      entry(K1, { dayKey: 20261001 as unknown as string }),
      entry(K1, { at: null as unknown as string }),
      entry(K1, { ref: [1, 2] as unknown as Record<string, unknown> }),
      entry(K1, { cloud: 'sent' as unknown as 'pending' })
    ]
    expect(RICE_LEDGER_KINDS as readonly string[]).not.toContain('party') // 夹具别撞上合法 kind
    const res = mergeEntries(emptyLedger(), bad)
    expect(res.added).toBe(0)
    expect(res.duplicated).toBe(0)
    expect(res.invalid).toBe(bad.length)
    expect(res.ledger.entries).toEqual([])
    expectCaught(() => expect(res.invalid).toBe(bad.length - 1), 'every bad shape must be counted')

    const one = ledgerWith([entry(K1)])
    const notArray = mergeEntries(one, 'nope' as unknown as unknown[])
    expect(notArray.added).toBe(0)
    expect(notArray.duplicated).toBe(0)
    expect(notArray.invalid).toBe(0)
    expect(notArray.ledger).toBe(one) // 坏响应 → 账本原样
    expectCaught(() => expect(notArray.ledger).not.toBe(one), 'a malformed batch must be a no-op')
  })
})

// ---------------------------------------------------------------- pendingEntries

describe('pendingEntries / pendingCount / rejectedCount：上行批次挑选', () => {
  it('按数组序取前 limit 条；limit 的每个边界都钉住', () => {
    const l = ledgerWith([
      entry(K1, { cloud: 'pending' }),
      entry(K2), // 已入云，不选
      entry(K3, { cloud: 'pending' }),
      entry(K4, { cloud: 'rejected' }), // 拒收，不选
      entry(K5, { cloud: 'pending' })
    ])
    expect(pendingEntries(l, 2).map((e) => e.entryKey)).toEqual([K1, K3]) // 数组序，不是排序序
    expect(pendingEntries(l, 3).map((e) => e.entryKey)).toEqual([K1, K3, K5]) // 恰等于总数
    expect(pendingEntries(l, 99).map((e) => e.entryKey)).toEqual([K1, K3, K5]) // 大于总数 → 全部
    expect(pendingEntries(l, 0)).toEqual([])
    expect(pendingEntries(l, -1)).toEqual([])
    expect(pendingEntries(l, Number.NaN)).toEqual([])
    expect(pendingCount(l)).toBe(3)
    expect(rejectedCount(l)).toBe(1)
    expect(pendingEntries(l, 99).some((e) => e.entryKey === K2)).toBe(false) // 已入云的绝不混进批次
    expectCaught(() => expect(pendingEntries(l, 2).map((e) => e.entryKey)).toEqual([K1, K3, K5]), 'limit must truncate')
    expectCaught(() => expect(pendingCount(l)).toBe(2), 'pendingCount must be exact')
    expectCaught(() => expect(rejectedCount(l)).toBe(0), 'rejectedCount must be exact')
  })
})

// ---------------------------------------------------------------- applyPushResult

describe('applyPushResult：推送结果三态迁移', () => {
  it('accepted/duplicated 摘 cloud、rejected 置 rejected、没提到的条目不动', () => {
    const base = ledgerWith([
      entry(K1, { cloud: 'pending' }), // accepted
      entry(K2, { cloud: 'pending' }), // duplicated（服务端早就有了）
      entry(K3, { cloud: 'pending' }), // rejected
      entry(K4), // 已入云，没被提到
      entry(K5, { cloud: 'pending' }) // 没被提到 → 仍 pending
    ])
    const out = applyPushResult(base, {
      accepted: [K1],
      duplicated: [K2],
      rejected: [{ entryKey: K3, reason: 'OVER_DAILY_CAP' }]
    })
    expect(out).not.toBe(base)
    expect(out.entries).toHaveLength(5)
    expect('cloud' in out.entries[0]).toBe(false) // pending → 入云
    expect('cloud' in out.entries[1]).toBe(false) // duplicated 也算入云
    expect(out.entries[2].cloud).toBe('rejected') // pending → rejected
    expect('cloud' in out.entries[3]).toBe(false)
    expect(out.entries[4].cloud).toBe('pending') // 没被提到的不许动
    expect(out.entries[0]).toEqual(entry(K1)) // 除 cloud 外字段逐条原样
    expect(base.entries[0].cloud).toBe('pending') // 入参未被就地修改
    expect(base.entries[2].cloud).toBe('pending')
    expectCaught(() => expect(out.entries[0].cloud).toBe('pending'), 'accepted entry must leave pending')
    expectCaught(() => expect(out.entries[2].cloud).toBe('pending'), 'rejected entry must not stay pending')
    expectCaught(() => expect(out.entries[4].cloud).toBeUndefined(), 'untouched entry must stay pending')
    expectCaught(() => expect('cloud' in base.entries[0]).toBe(false), 'input ledger must not be mutated')

    // 拒收过的条目被服务端追认：rejected → 入云
    const rejectedSide = ledgerWith([entry(K6, { cloud: 'rejected' })])
    const confirmed = applyPushResult(rejectedSide, { accepted: [K6], duplicated: [], rejected: [] })
    expect('cloud' in confirmed.entries[0]).toBe(false)
    expectCaught(() => expect(confirmed.entries[0].cloud).toBe('rejected'), 'rejected entry must clear on late confirmation')
  })

  it('认不出的键静默忽略（同一引用返回）；重放幂等', () => {
    const base = ledgerWith([entry(K1, { cloud: 'pending' })])
    const untouched = applyPushResult(base, {
      accepted: [OTHER],
      duplicated: [OTHER],
      rejected: [{ entryKey: OTHER, reason: 'ENTRY_CONFLICT' }]
    })
    expect(untouched).toBe(base) // 一个键都没命中 → 无改动
    expect(base.entries[0].cloud).toBe('pending')
    expectCaught(() => expect(untouched).not.toBe(base), 'unmatched keys must be a no-op')

    const once = applyPushResult(base, { accepted: [K1], duplicated: [], rejected: [] })
    expect('cloud' in once.entries[0]).toBe(false)
    const twice = applyPushResult(once, { accepted: [K1], duplicated: [], rejected: [] })
    expect(twice).toBe(once) // 重放：已入云的条目再 accepted 一次 → 无变化
    expectCaught(() => expect(twice).not.toBe(once), 'replaying the same result must be a no-op')
  })

  it('accepted 键拼错一个字符 ⇒ 条目仍 pending（同一比较器抓得住）', () => {
    const base = ledgerWith([entry(K1, { cloud: 'pending' })])
    const typo = `${K1}x`
    const out = applyPushResult(base, { accepted: [typo], duplicated: [], rejected: [] })
    expect(out).toBe(base)
    expect(out.entries[0].cloud).toBe('pending')
    expectCaught(() => expect(out.entries[0].cloud).toBeUndefined(), 'a typo key must not confirm the entry')
  })

  it('同键同时出现在 accepted 与 rejected ⇒ 拒收赢（保守：绝不把未收下的标成已入云）', () => {
    const base = ledgerWith([entry(K1, { cloud: 'pending' })])
    const out = applyPushResult(base, {
      accepted: [K1],
      duplicated: [],
      rejected: [{ entryKey: K1, reason: 'INTERNAL' }]
    })
    expect(out.entries[0].cloud).toBe('rejected')
    expectCaught(() => expect(out.entries[0].cloud).toBeUndefined(), 'contradictory result must stay unconfirmed')
  })
})

// ---------------------------------------------------------------- applyPull

describe('applyPull：下行应用与水位', () => {
  it('水位只增不减：更大的 nextSeq 推进；更小的 / 相同的都不倒退', () => {
    const base = ledgerWith([entry(K1)], { appliedServerSeq: 5 })
    const first = applyPull(base, [entry(S1), entry(S2)], 9)
    expect(first.added).toBe(2)
    expect(first.ledger.appliedServerSeq).toBe(9)
    expect(first.ledger.entries.map((e) => e.entryKey)).toEqual([K1, S1, S2]) // 下行条目接在尾部
    expectCaught(() => expect(first.ledger.appliedServerSeq).toBe(5), 'water mark must advance')
    expectCaught(() => expect(first.added).toBe(1), 'added must count both new entries')

    const stale = applyPull(first.ledger, [entry(S1), entry(S2)], 3) // 乱序 / 重放的下行包
    expect(stale.added).toBe(0)
    expect(stale.ledger.appliedServerSeq).toBe(9)
    expect(stale.ledger).toBe(first.ledger) // 无任何变化 → 同一引用
    expectCaught(() => expect(stale.ledger.appliedServerSeq).toBe(3), 'water mark must never regress')

    const replay = applyPull(first.ledger, [entry(S1), entry(S2)], 9)
    expect(replay.added).toBe(0)
    expect(replay.ledger).toBe(first.ledger)
    expectCaught(() => expect(replay.ledger).not.toBe(first.ledger), 'replay must be a no-op')
  })

  it('下行回声把本地 pending 结清（与 mergeEntries 同一份去重判据）', () => {
    const base = ledgerWith([entry(K1, { cloud: 'pending' })], { appliedServerSeq: 2 })
    const res = applyPull(base, [entry(K1), entry(S1, { kind: 'answer', delta: 1 })], 3)
    expect(res.added).toBe(1)
    expect('cloud' in res.ledger.entries[0]).toBe(false)
    expect(res.ledger.appliedServerSeq).toBe(3)
    expectCaught(() => expect(res.ledger.entries[0].cloud).toBe('pending'), 'pull echo must confirm the local pending entry')
  })

  it('坏 nextSeq（NaN / 负数 / 小数 / Infinity）不写进账本：水位保持，产物仍过 parseLedger', () => {
    const base = ledgerWith([entry(K1)], { appliedServerSeq: 4 })
    for (const bad of [Number.NaN, -1, 2.5, Number.POSITIVE_INFINITY]) {
      const res = applyPull(base, [], bad)
      expect(res.ledger.appliedServerSeq, `nextSeq=${String(bad)}`).toBe(4)
      expect(res.ledger).toBe(base)
    }
    // 种坏：小数水位若真被写进账本，下一次读回会整份 null —— 这就是不能写的理由
    const poisoned = JSON.parse(JSON.stringify({ ...base, appliedServerSeq: 2.5 })) as unknown
    expect(parseLedger(poisoned)).toBeNull()
    expectCaught(() => expect(parseLedger(poisoned)).not.toBeNull(), 'fractional water mark must be rejected by the reader')
  })
})

// ---------------------------------------------------------------- parseLedger

describe('parseLedger：磁盘读入口（认不出 → null，绝不默认回退为空账本）', () => {
  it('真往返：构造（append / 合并 / 推送 / 下行全走一遍）→ JSON 序列化 → parse 深等', () => {
    let l = emptyLedger()
    l = appendLocal(l, {
      entryKey: K1,
      kind: 'lesson',
      delta: 2,
      dayKey: '2026-10-01',
      at: T1,
      ref: { lessonId: 'common-01', times: 2 }
    })
    l = appendLocal(l, { entryKey: K2, kind: 'feed', delta: -1, dayKey: '2026-10-02', at: T2, ref: null })
    l = mergeEntries(l, [entry(K3, { kind: 'checkin', delta: 2 })]).ledger
    l = applyPushResult(l, { accepted: [K1], duplicated: [], rejected: [{ entryKey: K3, reason: 'OVER_DAILY_CAP' }] })
    l = applyPull(l, [entry(S1, { kind: 'answer', delta: 1 })], 7).ledger
    expect(balanceOf(l)).toBe(4) // 未入云的条目照样进余额：镜像账是「本地事实」不是「云端事实」

    const disk = JSON.parse(JSON.stringify(l)) as unknown // 真过一遍 JSON：落盘-读回的闭环
    const parsed = parseLedger(disk)
    expect(parsed).not.toBeNull()
    expect(parsed).toEqual(l)
    expect(balanceOf(parsed as RiceLedger)).toBe(balanceOf(l))
    expect((parsed as RiceLedger).appliedServerSeq).toBe(7)
    expect((parsed as RiceLedger).entries.map((e) => e.cloud)).toEqual([undefined, 'pending', 'rejected', undefined])
    expectCaught(() => expect(parsed).toEqual(emptyLedger()), 'round trip must not collapse into an empty ledger')
  })

  it('坏形状逐类整份 null（含任务点名的六类：version=2 / entries 非数组 / 未知 kind / delta 字符串 / cloud=weird / localSeq=-1）', () => {
    const good = ledgerWith([entry(K1, { cloud: 'pending' })], { localSeq: 3, appliedServerSeq: 7 })
    expect(parseLedger(JSON.parse(JSON.stringify(good)))).toEqual(good) // 正样本先立住，坏样本判 null 才有效

    const bads: Array<[string, unknown]> = [
      ['version=2', { ...good, version: 2 }],
      ['entries 非数组', { ...good, entries: {} }],
      ['kind 不认识的字符串', { ...good, entries: [entry(K1, { kind: 'party' as unknown as RiceKind })] }],
      ['delta 是字符串', { ...good, entries: [entry(K1, { delta: '2' as unknown as number })] }],
      ['cloud=weird', { ...good, entries: [entry(K1, { cloud: 'weird' as unknown as 'pending' })] }],
      ['localSeq=-1', { ...good, localSeq: -1 }],
      // 点名清单之外按同一份判据补钉
      ['null', null],
      ['undefined', undefined],
      ['字符串', 'ledger'],
      ['数组', []],
      ['version 缺席', { entries: [], localSeq: 0, appliedServerSeq: 0 }],
      ['version="1"（字符串）', { ...good, version: '1' }],
      ['entry 不是对象', { ...good, entries: [1] }],
      ['entryKey 非字符串', { ...good, entries: [entry(K1, { entryKey: 7 as unknown as string })] }],
      ['dayKey 非字符串', { ...good, entries: [entry(K1, { dayKey: null as unknown as string })] }],
      ['at 缺席', { ...good, entries: [{ entryKey: K1, kind: 'lesson', delta: 2, dayKey: '2026-10-01', ref: null }] }],
      ['ref 是数组', { ...good, entries: [entry(K1, { ref: [] as unknown as Record<string, unknown> })] }],
      ['ref 缺席', { ...good, entries: [{ entryKey: K1, kind: 'lesson', delta: 2, dayKey: '2026-10-01', at: T1 }] }],
      ['delta=Infinity', { ...good, entries: [entry(K1, { delta: Number.POSITIVE_INFINITY })] }],
      ['delta=NaN', { ...good, entries: [entry(K1, { delta: Number.NaN })] }],
      ['localSeq 缺席', { entries: [], appliedServerSeq: 0 }],
      ['localSeq=1.5', { ...good, localSeq: 1.5 }],
      ['appliedServerSeq=-2', { ...good, appliedServerSeq: -2 }]
    ]
    expect(() => {
      for (const [, v] of bads) parseLedger(v)
    }).not.toThrow()
    for (const [name, v] of bads) {
      expect(parseLedger(v), name).toBeNull()
    }
    // 「认不出」必须与「空账本」可区分：坏档绝不能静默变出一份可写盘的空账
    expect(parseLedger({ ...good, version: 2 })).not.toEqual(emptyLedger())

    // 一条坏 → 整份 null（不做部分收编：半份账的余额是假余额）
    const oneBad = { ...good, entries: [entry(K1), entry(K2), entry(K3, { delta: 'x' as unknown as number })] }
    expect(parseLedger(oneBad)).toBeNull()
    expectCaught(() => expect(parseLedger({ ...good, version: 2 })).not.toBeNull(), 'version=2 must never be parsed')
    expectCaught(
      () => expect(parseLedger(oneBad)).toEqual({ ...good, entries: [entry(K1), entry(K2)] }),
      'one bad entry must not allow partial adoption'
    )
  })

  it('空账本是合法档（水位 0 / localSeq 0 都过），与坏档判 null 可区分', () => {
    const parsed = parseLedger(JSON.parse(JSON.stringify(emptyLedger())))
    expect(parsed).toEqual(emptyLedger())
    expect(parsed).not.toBeNull()
    expectCaught(() => expect(parsed).toBeNull(), 'an empty ledger is valid, not invalid')
  })

  it('只认认识的字段：未知顶层键与未知条目键丢弃（形状要变就升 version 判 null，不做半信）', () => {
    const good = ledgerWith([entry(K1, { cloud: 'pending' })])
    const onDisk = { ...good, future: { x: 1 }, entries: [{ ...entry(K1, { cloud: 'pending' }), extra: 1 }] }
    const parsed = parseLedger(JSON.parse(JSON.stringify(onDisk)))
    expect(parsed).toEqual(good)
    expect(parsed).not.toBeNull()
    expect('future' in (parsed as RiceLedger)).toBe(false)
    expect('extra' in entryOf(parsed as RiceLedger, K1)).toBe(false)
    expectCaught(() => expect('future' in (parsed as RiceLedger)).toBe(true), 'unknown top-level key must be dropped, not carried')
  })
})
