/**
 * .sync/pending-ops.json（挑战结算待办队列）的单测。
 *
 * 【钉死哪些裁决】parseSettlePayload 的每条边界（pickedLangs 显式空数组 = 抹成
 * 缺省而不是判 null、重复/坏语言判 null、startedAt 晚于 finishedAt = 丢字段不连坐）、
 * 读口宽（坏条目丢、能救的救）写口严（形状不对抛）、addSettle 同日/同 id 幂等
 * 返回原引用、队满丢最老、remove/mark 的同引用语义、store 的 dir 现读。
 *
 * 【怎么做到脱盘又不假】mkdtemp 隔离目录 + 真读写文件（落点 = <box>/.sync/…，
 * 顺带钉住目录布局本身）。
 *
 * ⚠️ 本文件在 `src/` 下：字符串字面量一律 ASCII。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CHALLENGE_RUN_MAX } from '../../../shared/cloud/protocol'
import { SYNC_DIR } from '../../store/sync-state'
import {
  SETTLE_QUEUE_MAX,
  addSettle,
  createPendingOpsStore,
  emptyPendingOps,
  markSettleAttempt,
  parseSettlePayload,
  readPendingOps,
  removeSettle,
  writePendingOps,
  type PendingSettleOp
} from '../pending-ops'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'miai-pending-ops-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

const opsFile = (): string => join(dir, SYNC_DIR, 'pending-ops.json')

/** 合法题（形状 = challenge.ts:51-62 的抄本，值全在枚举域内） */
function question(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'c-01:q1',
    lessonId: 'c-01',
    qid: 'q1',
    lang: 'c',
    stage: 1,
    type: 'choice',
    difficulty: 'easy',
    source: 'local',
    ok: true,
    ...over
  }
}

/** 合法结算载荷（除 submissionId/installId） */
function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dateKey: '2026-10-11',
    source: 'local',
    finishedAt: '2026-10-11T12:00:00.000Z',
    questions: [question()],
    ...over
  }
}

let uuidCounter = 0
function op(over: Partial<PendingSettleOp> = {}): PendingSettleOp {
  uuidCounter++
  const hex = String(uuidCounter).padStart(12, '0')
  const dateKey = over.dateKey ?? '2026-10-11'
  return {
    submissionId: `00000000-0000-4000-8000-${hex}`,
    dateKey,
    // payload.dateKey 默认与索引同步（写盘往返的一致性判据会查它们相等）；
    // 要造"不一致"的用例就显式传 over.payload
    payload: parseSettlePayload(payload({ dateKey }))!,
    attempts: 0,
    lastError: null,
    queuedAt: '2026-10-11T12:01:00.000Z',
    ...over
  }
}

// ---------------------------------------------------------------- parseSettlePayload

describe('parseSettlePayload：IPC 入队与磁盘读口共用的形状闸', () => {
  it('合法载荷：字段原样保留（questions 逐题透传）', () => {
    const p = parseSettlePayload(payload())
    expect(p).not.toBeNull()
    expect(p!.dateKey).toBe('2026-10-11')
    expect(p!.questions).toHaveLength(1)
    expect(p!.questions[0]).toEqual(question())
    expect(p!.startedAt).toBeUndefined()
    expect(p!.pickedLangs).toBeUndefined()
  })

  it('pickedLangs 显式空数组：抹成缺省（服务端 400 的是空数组，不是缺省）', () => {
    const p = parseSettlePayload(payload({ pickedLangs: [] }))
    expect(p).not.toBeNull()
    expect('pickedLangs' in p!).toBe(false)
  })

  it('pickedLangs 有值：保留；重复项判 null（服务端也会拒，早点拦）', () => {
    const ok = parseSettlePayload(payload({ pickedLangs: ['c', 'python'] }))
    expect(ok!.pickedLangs).toEqual(['c', 'python'])
    expect(parseSettlePayload(payload({ pickedLangs: ['c', 'c'] }))).toBeNull()
  })

  it('pickedLangs 坏语言（common 不可勾选）判 null', () => {
    expect(parseSettlePayload(payload({ pickedLangs: ['common'] }))).toBeNull()
  })

  it('startedAt 合法且不晚于 finishedAt：保留', () => {
    const p = parseSettlePayload(payload({ startedAt: '2026-10-11T11:00:00.000Z' }))
    expect(p!.startedAt).toBe('2026-10-11T11:00:00.000Z')
  })

  it('startedAt 晚于 finishedAt：只丢字段、不连坐整份（服务端对它是 400）', () => {
    const p = parseSettlePayload(payload({ startedAt: '2026-10-11T13:00:00.000Z' }))
    expect(p).not.toBeNull()
    expect(p!.startedAt).toBeUndefined()
  })

  it('finishedAt 坏 / 缺：整份 null', () => {
    expect(parseSettlePayload(payload({ finishedAt: 'not-a-time' }))).toBeNull()
    const noFin = payload()
    delete noFin.finishedAt
    expect(parseSettlePayload(noFin)).toBeNull()
  })

  it('dateKey 形状坏 / source 坏值：null', () => {
    expect(parseSettlePayload(payload({ dateKey: '2026/10/11' }))).toBeNull()
    expect(parseSettlePayload(payload({ source: 'sync' }))).toBeNull()
  })

  it('questions 空数组 / 超 CHALLENGE_RUN_MAX / 非数组：null', () => {
    expect(parseSettlePayload(payload({ questions: [] }))).toBeNull()
    const many = Array.from({ length: CHALLENGE_RUN_MAX + 1 }, (_, i) =>
      question({ key: `c-01:q${i}`, qid: `q${i}` })
    )
    expect(parseSettlePayload(payload({ questions: many }))).toBeNull()
    expect(parseSettlePayload(payload({ questions: 'x' }))).toBeNull()
  })

  it('恰满 CHALLENGE_RUN_MAX：放行（边界另一侧）', () => {
    const many = Array.from({ length: CHALLENGE_RUN_MAX }, (_, i) =>
      question({ key: `c-01:q${i}`, qid: `q${i}` })
    )
    expect(parseSettlePayload(payload({ questions: many }))).not.toBeNull()
  })

  it('逐题值域：坏 lang / stage 越界或小数 / 坏 type / 坏 difficulty / 坏 ok：null', () => {
    expect(parseSettlePayload(payload({ questions: [question({ lang: 'rust' })] }))).toBeNull()
    expect(parseSettlePayload(payload({ questions: [question({ stage: 4 })] }))).toBeNull()
    expect(parseSettlePayload(payload({ questions: [question({ stage: 1.5 })] }))).toBeNull()
    expect(parseSettlePayload(payload({ questions: [question({ type: 'essay' })] }))).toBeNull()
    expect(parseSettlePayload(payload({ questions: [question({ difficulty: 'insane' })] }))).toBeNull()
    expect(parseSettlePayload(payload({ questions: [question({ ok: 'yes' })] }))).toBeNull()
  })

  it('非对象 / null：null（不抛）', () => {
    expect(parseSettlePayload(null)).toBeNull()
    expect(parseSettlePayload([])).toBeNull()
    expect(parseSettlePayload('x')).toBeNull()
  })
})

// ---------------------------------------------------------------- 读口 / 写口

describe('读口宽 / 写口严', () => {
  it('文件不存在：静默空队（首跑常态）', () => {
    const warns: string[] = []
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void warns.push(a.join(' ')))
    const ops = readPendingOps(dir)
    expect(ops.settles).toEqual([])
    expect(warns).toEqual([])
  })

  it('坏 JSON：空队 + 出声', () => {
    mkdirSync(join(dir, SYNC_DIR), { recursive: true })
    writeFileSync(opsFile(), '{ nope', 'utf8')
    const warns: string[] = []
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void warns.push(a.join(' ')))
    expect(readPendingOps(dir).settles).toEqual([])
    expect(warns.some((w) => w.includes('unreadable'))).toBe(true)
  })

  it('混队：好条目全留、坏条目丢弃并汇总出声', () => {
    const good1 = op({ dateKey: '2026-10-10' })
    const good2 = op({ dateKey: '2026-10-11' })
    const bad = { ...op(), payload: { nope: true } }
    writePendingOps(dir, { version: 1, settles: [] }) // 先建目录与合法文件
    writeFileSync(
      opsFile(),
      JSON.stringify({ version: 1, settles: [good1, bad, good2] }),
      'utf8'
    )
    const warns: string[] = []
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void warns.push(a.join(' ')))
    const ops = readPendingOps(dir)
    expect(ops.settles.map((s) => s.dateKey)).toEqual(['2026-10-10', '2026-10-11'])
    expect(warns.some((w) => w.includes('dropped 1'))).toBe(true)
  })

  it('索引 dateKey 与 payload.dateKey 不一致：丢条目（留哪边都是猜）', () => {
    const good = op() // dateKey 与 payload.dateKey 都是 2026-10-11
    const mismatched = { ...good, dateKey: '2026-10-10' } // 索引被改成 10-10
    writePendingOps(dir, { version: 1, settles: [] })
    writeFileSync(opsFile(), JSON.stringify({ version: 1, settles: [mismatched] }), 'utf8')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(readPendingOps(dir).settles).toEqual([])
  })

  it('写口：合法整份写入、读回逐字段一致（真落盘往返）', () => {
    const one = op()
    writePendingOps(dir, { version: 1, settles: [one] })
    expect(existsSync(opsFile())).toBe(true)
    expect(readPendingOps(dir).settles).toEqual([one])
  })

  it('写口：坏条目抛（入参是我们自己的代码交上来的，不静默吞）', () => {
    expect(() =>
      writePendingOps(dir, { version: 1, settles: [{ ...op(), submissionId: 'not-a-uuid' } as PendingSettleOp] })
    ).toThrow()
    expect(() => writePendingOps(dir, { version: 1, settles: 'x' as unknown as PendingSettleOp[] })).toThrow()
  })
})

// ---------------------------------------------------------------- 纯变换

describe('纯变换：addSettle / removeSettle / markSettleAttempt', () => {
  it('同日（dateKey 已在队）：原样返回原引用（第二道防重入闸）', () => {
    const ops = addSettle(emptyPendingOps(), op())
    const again = addSettle(ops, op()) // 新的 submissionId、同一天
    expect(again).toBe(ops)
    expect(again.settles).toHaveLength(1)
  })

  it('同 submissionId：原样返回原引用', () => {
    const first = op()
    const ops = addSettle(emptyPendingOps(), first)
    const again = addSettle(ops, { ...op(), dateKey: first.dateKey })
    expect(again).toBe(ops)
  })

  it('不同天：追加（插入序 = 入队序）', () => {
    let ops = addSettle(emptyPendingOps(), op({ dateKey: '2026-10-10' }))
    ops = addSettle(ops, op({ dateKey: '2026-10-11' }))
    expect(ops.settles.map((s) => s.dateKey)).toEqual(['2026-10-10', '2026-10-11'])
  })

  it('队满：丢最老（按 dateKey）并出声，数量钉在 SETTLE_QUEUE_MAX', () => {
    const warns: string[] = []
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void warns.push(a.join(' ')))
    let ops = emptyPendingOps()
    // 造 SETTLE_QUEUE_MAX 个互异的日子（按日期递增入队，插序与 dateKey 序一致；
    // 插入序与排序序相反的乱序场景由"丢的是 2026-09-02"这条断言间接钉住）
    for (let i = 0; i < SETTLE_QUEUE_MAX; i++) {
      const dt = new Date(Date.UTC(2026, 8, 2) + i * 86400000) // 2026-09-02 起每天一条
      ops = addSettle(ops, op({ dateKey: dt.toISOString().slice(0, 10) }))
    }
    expect(ops.settles).toHaveLength(SETTLE_QUEUE_MAX)
    ops = addSettle(ops, op({ dateKey: '2026-11-01' })) // 队满再入一条（最新的）
    expect(ops.settles).toHaveLength(SETTLE_QUEUE_MAX)
    expect(warns.some((w) => w.includes('dropped 1 oldest'))).toBe(true)
    // 丢的必须是最老那条（2026-09-02），新的进来了
    expect(ops.settles.some((s) => s.dateKey === '2026-09-02')).toBe(false)
    expect(ops.settles.some((s) => s.dateKey === '2026-11-01')).toBe(true)
  })

  it('removeSettle：按 submissionId 命中删；未命中原样返回原引用', () => {
    const one = op()
    const ops = addSettle(emptyPendingOps(), one)
    expect(removeSettle(ops, 'no-such-id')).toBe(ops)
    expect(removeSettle(ops, one.submissionId).settles).toEqual([])
  })

  it('markSettleAttempt：attempts+1 且记 lastError；未命中原样返回原引用', () => {
    const one = op()
    const ops = addSettle(emptyPendingOps(), one)
    expect(markSettleAttempt(ops, 'no-such-id', 'x')).toBe(ops)
    const marked = markSettleAttempt(ops, one.submissionId, 'HTTP_400 bad question')
    expect(marked.settles[0].attempts).toBe(1)
    expect(marked.settles[0].lastError).toBe('HTTP_400 bad question')
    expect(marked.settles[0].payload).toEqual(one.payload) // 载荷一字不动（重试须逐字节复用）
  })
})

// ---------------------------------------------------------------- store 信封

describe('createPendingOpsStore：dir 现读', () => {
  it('切目录后自动读写新盒（不缓存旧 dir）', () => {
    const dirB = mkdtempSync(join(tmpdir(), 'miai-pending-ops-b-'))
    try {
      let current = dir
      const store = createPendingOpsStore(() => current)
      const one = op()
      store.write({ version: 1, settles: [one] })
      expect(store.read().settles).toHaveLength(1)
      current = dirB // 切盒
      expect(store.read().settles).toEqual([]) // B 盒是空的
      expect(existsSync(join(dir, SYNC_DIR, 'pending-ops.json'))).toBe(true)
    } finally {
      rmSync(dirB, { recursive: true, force: true })
    }
  })
})
