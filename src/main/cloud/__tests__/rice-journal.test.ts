/**
 * 大白饭账本（src/main/cloud/rice-journal.ts）的单测。
 *
 * 【钉死哪些裁决】genesis 的形状与"必须立刻落盘"、skip-when-zero（含上限
 * 饱和的下行 clamp 同款）、refViolation 就地拦（lesson/run 缺硬要求 ref →
 * 'rejected' 但余额照涨）、分配器违约出声丢条目、坏档留证 + 出声 + 按
 * pet.json 余额重建、mutate 的同引用不落盘。
 *
 * 【怎么做到脱盘又不假】磁盘用 mkdtemp 的隔离目录（绝不碰主人真档），
 * 但**真读写真文件**（json-store 的原子写不是被测对象，是本模块的落地路径）；
 * 时钟注入固定值（genesis 的 at/dayKey/坏档副本名可预期）。
 *
 * ⚠️ 本文件在 `src/` 下：注释随便写中文，字符串字面量一律 ASCII。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RICE_MAX } from '../../../shared/cloud/protocol'
import { parseLedger, type RiceLedger } from '../../../shared/cloud/rice-ledger'
import { petDayKey } from '../../../shared/pet'
import { createRiceJournal, type RiceJournalDeps } from '../rice-journal'

const INSTALL = '11111111-2222-4333-8444-555555555555'
/** 本地时区中午（petDayKey 走本地日，选白天免时区边界） */
const NOW = new Date(2026, 9, 11, 12, 0, 0)
const NOW_ISO = NOW.toISOString()

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'miai-rice-journal-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

const ledgerFile = (): string => join(dir, 'rice-ledger.json')
const readFileLedger = (): RiceLedger => parseLedger(JSON.parse(readFileSync(ledgerFile(), 'utf8')))!

interface Harness {
  journal: ReturnType<typeof createRiceJournal>
  /** 每次分配器调用收到的"账本内本机最大 seq"（调用序） */
  seqCalls: number[]
  warns: string[]
}

/**
 * 建一个受控 journal。默认分配器 = max(maxLocal+1, 1)（模拟 app.ts 的
 * 三来源取最大）；opts.seqReturns 可以脚本化返回（测"分配器违约"一支）。
 */
function makeJournal(
  opts: { carried?: number; seqReturns?: number[]; dirOverride?: () => string } = {}
): Harness {
  const seqCalls: number[] = []
  const seqReturns = opts.seqReturns ? [...opts.seqReturns] : null
  const warns: string[] = []
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warns.push(args.map(String).join(' '))
  })
  const deps: RiceJournalDeps = {
    dir: opts.dirOverride ?? ((): string => dir),
    installId: INSTALL,
    nextSeq: (maxLocal) => {
      seqCalls.push(maxLocal)
      if (seqReturns && seqReturns.length > 0) return seqReturns.shift()!
      return Math.max(maxLocal + 1, 1)
    },
    carriedRice: () => opts.carried ?? 0,
    now: () => NOW
  }
  return { journal: createRiceJournal(deps), seqCalls, warns }
}

// ---------------------------------------------------------------- 建账 / genesis

describe('建账与 genesis', () => {
  it('存量 0：空账、不落盘（没东西可存）', () => {
    const h = makeJournal({ carried: 0 })
    const l = h.journal.load()
    expect(l.entries).toEqual([])
    expect(h.journal.balance()).toBe(0)
    expect(existsSync(ledgerFile())).toBe(false)
  })

  it('存量 7：genesis 落盘即刻、形状是冻结的三件套（cloud rejected / ref.carried）', () => {
    const h = makeJournal({ carried: 7 })
    const l = h.journal.load()
    expect(l.entries).toEqual([
      {
        entryKey: `${INSTALL}:0`,
        kind: 'adopt',
        delta: 7,
        dayKey: petDayKey(NOW_ISO),
        at: NOW_ISO,
        ref: { installId: INSTALL, carried: 7 },
        cloud: 'rejected'
      }
    ])
    expect(h.journal.balance()).toBe(7)
    // 立刻落盘：下次启动 carriedRice 变小也吃不掉存量
    expect(existsSync(ledgerFile())).toBe(true)
    expect(readFileLedger()).toEqual(l)
  })

  it('存量越界夹到 [0, RICE_MAX]；坏值（NaN）按 0', () => {
    const big = makeJournal({ carried: 5000 })
    expect(big.journal.load().entries[0].delta).toBe(RICE_MAX)
    rmSync(dir, { recursive: true, force: true })
    const nan = makeJournal({ carried: Number.NaN })
    expect(nan.journal.load().entries).toEqual([])
  })

  it('第二次 load 读档不重造 genesis（幂等）', () => {
    const h = makeJournal({ carried: 7 })
    h.journal.load()
    const again = h.journal.load()
    expect(again.entries).toHaveLength(1)
  })

  it('current()/record() 不先 load 也能用（惰性装载）', () => {
    const h = makeJournal({ carried: 3 })
    expect(h.journal.record({ kind: 'answer', ref: null })).toBe(4)
    expect(h.journal.current().entries).toHaveLength(2)
  })
})

// ---------------------------------------------------------------- record

describe('record：记一条饭变动', () => {
  it('feed：发号 = 账本最大+1、cloud pending、余额 -1、文件同步落盘', () => {
    const h = makeJournal({ carried: 7 })
    h.journal.load()
    expect(h.journal.record({ kind: 'feed', ref: null })).toBe(6)
    const l = h.journal.current()
    expect(l.entries).toHaveLength(2)
    expect(l.entries[1]).toEqual({
      entryKey: `${INSTALL}:1`,
      kind: 'feed',
      delta: -1,
      dayKey: petDayKey(NOW_ISO),
      at: NOW_ISO,
      ref: null,
      cloud: 'pending'
    })
    expect(h.seqCalls).toEqual([0]) // genesis 的 :0 也算账本内的号
    expect(readFileLedger()).toEqual(l)
  })

  it('连记两条：分配器每次拿到"账本内最大 seq"（递增）', () => {
    const h = makeJournal({ carried: 7 })
    h.journal.record({ kind: 'lesson', ref: { lessonId: 'c-01' } })
    h.journal.record({ kind: 'answer', ref: null })
    expect(h.seqCalls).toEqual([0, 1])
    expect(h.journal.current().entries.map((e) => e.entryKey)).toEqual([
      `${INSTALL}:0`,
      `${INSTALL}:1`,
      `${INSTALL}:2`
    ])
  })

  it('上限饱和（999 顶格）：skip-when-zero —— 不记、不占号、不落盘', () => {
    const h = makeJournal({ carried: RICE_MAX })
    h.journal.load()
    // "没落盘"只认 mtime：就算真写了，内容也逐字节相同（没有改动可写）
    // —— 比内容是这个教训里的经典死判据（内容哈希不变≠没写盘）
    const mtimeBefore = statSync(ledgerFile()).mtimeMs
    const balance = h.journal.record({ kind: 'lesson', ref: { lessonId: 'c-01' } })
    expect(balance).toBe(RICE_MAX)
    expect(h.journal.current().entries).toHaveLength(1) // 只有 genesis
    expect(h.seqCalls).toEqual([]) // 号也没占
    expect(statSync(ledgerFile()).mtimeMs).toBe(mtimeBefore)
  })

  it('余额 0 时喂饭：下界的 clamp 也跳（probe 过账余额没动）', () => {
    const h = makeJournal({ carried: 0 })
    const balance = h.journal.record({ kind: 'feed', ref: null })
    expect(balance).toBe(0)
    expect(h.journal.current().entries).toEqual([])
    expect(h.seqCalls).toEqual([])
  })

  it('refViolation：lesson 缺 lessonId → 余额照涨、条目 cloud rejected、出声', () => {
    const h = makeJournal({ carried: 0 })
    expect(h.journal.record({ kind: 'lesson', ref: null })).toBe(2)
    const entry = h.journal.current().entries[0]
    expect(entry.cloud).toBe('rejected')
    expect(entry.entryKey).toBe(`${INSTALL}:1`)
    expect(h.warns.some((w) => w.includes('lesson without ref.lessonId'))).toBe(true)
  })

  it('refViolation：run 缺 fingerprint 拦、带 fingerprint 放行（pending 正常上行）', () => {
    const h = makeJournal({ carried: 0 })
    h.journal.record({ kind: 'run', ref: {} })
    expect(h.journal.current().entries[0].cloud).toBe('rejected')
    h.journal.record({ kind: 'run', ref: { fingerprint: 'abc123' } })
    expect(h.journal.current().entries[1].cloud).toBe('pending')
    expect(h.journal.balance()).toBe(2)
  })

  it('分配器违约（回了已用过的号）：出声、本条丢弃、余额不动', () => {
    const h = makeJournal({ carried: 7, seqReturns: [0] }) // 0 已被 genesis 占用
    const balance = h.journal.record({ kind: 'feed', ref: null })
    expect(balance).toBe(7)
    expect(h.journal.current().entries).toHaveLength(1)
    expect(h.warns.some((w) => w.includes('used seq'))).toBe(true)
  })
})

// ---------------------------------------------------------------- 坏档处置

describe('坏档：留证 + 出声 + 按 pet.json 余额重建', () => {
  it('坏 JSON：副本内容与原档逐字节一致、genesis 带 recovered 标记', () => {
    const garbage = '{ this is not json'
    writeFileSync(ledgerFile(), garbage, 'utf8')
    const h = makeJournal({ carried: 5 })
    const l = h.journal.load()
    expect(l.entries).toHaveLength(1)
    expect(l.entries[0].delta).toBe(5)
    expect(l.entries[0].ref).toEqual({ installId: INSTALL, carried: 5, recovered: true })
    expect(h.journal.balance()).toBe(5)
    expect(h.warns.some((w) => w.includes('unreadable'))).toBe(true)
    const copies = readdirSync(dir).filter((n) => /^rice-ledger\.bad-\d+\.json$/.test(n))
    expect(copies).toHaveLength(1)
    expect(readFileSync(join(dir, copies[0]), 'utf8')).toBe(garbage)
    // 重建结果已落盘（此刻 pet.json 的 5 碗从此有账可依）
    expect(readFileLedger().entries[0].delta).toBe(5)
  })

  it('形状坏（version 不认）：同样走重建而不是"部分收编"', () => {
    writeFileSync(ledgerFile(), JSON.stringify({ version: 2, entries: [] }), 'utf8')
    const h = makeJournal({ carried: 1 })
    const l = h.journal.load()
    expect(l.entries[0].ref).toMatchObject({ recovered: true })
    expect(h.warns.some((w) => w.includes('invalid shape'))).toBe(true)
  })

  it('条目坏（一条 delta 是字符串）：整份判 null → 重建（半份账比没有账更坏）', () => {
    writeFileSync(
      ledgerFile(),
      JSON.stringify({
        version: 1,
        localSeq: 1,
        appliedServerSeq: 0,
        entries: [
          {
            entryKey: `${INSTALL}:1`,
            kind: 'feed',
            delta: 'oops',
            dayKey: '2026-10-11',
            at: NOW_ISO,
            ref: null
          }
        ]
      }),
      'utf8'
    )
    const h = makeJournal({ carried: 2 })
    const l = h.journal.load()
    expect(l.entries[0].delta).toBe(2)
    expect(l.entries[0].ref).toMatchObject({ recovered: true })
  })
})

// ---------------------------------------------------------------- mutate

describe('mutate：上行层用的变换口', () => {
  it('同引用返回 = 不落盘（幂等重放不翻 mtime 的同一个口径）', () => {
    const h = makeJournal({ carried: 7 })
    h.journal.load()
    const mtimeBefore = statSync(ledgerFile()).mtimeMs
    const same = h.journal.mutate((l) => l)
    expect(same).toBe(h.journal.current())
    expect(statSync(ledgerFile()).mtimeMs).toBe(mtimeBefore) // 真写了这里会翻（内容不变也得翻）
  })

  it('换引用 = 落盘（返回的账本与文件一致）', () => {
    const h = makeJournal({ carried: 7 })
    h.journal.load()
    const next = h.journal.mutate((l) => ({
      ...l,
      appliedServerSeq: 42
    }))
    expect(next.appliedServerSeq).toBe(42)
    expect(readFileLedger().appliedServerSeq).toBe(42)
  })
})
