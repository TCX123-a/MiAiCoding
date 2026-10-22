/**
 * brain 的饭镜像出口（deps.onRice，P10.x 上行接线）的单测。
 *
 * 【为什么单独一个文件】dshpet-brain.test.ts 的 harness 很大，import 它会
 * **重复注册**它的全部 describe（vitest 按文件收集用例）—— 所以这里自带一个
 * 迷你 harness，只建脑、只测这一件事。
 *
 * 【钉死哪些裁决】
 *   · feed / grant(lesson|answer|checkin) / grantRun 各自的 (kind, ref) 形状；
 *     特别是 answer 带 lessonId 也**不许**把 ref 传出去（负控：只有 lesson 带）；
 *   · 镜像值（onRice 返回数字）覆盖 brain 自己算的饭数并落盘 —— 账本才是真源；
 *   · onRice 返回 null / NaN（拒答或坏值）⇒ 本地算术原样保留（升级前的行为）；
 *   · 不接 onRice 的旧配置 ⇒ 就是本地算术（向后兼容）；
 *   · grantRun 同指纹拒发的那次：sink **不被调**（没发奖就没这笔账）。
 *
 * ⚠️ 本文件在 `src/` 下：字符串字面量一律 ASCII。
 */
import { describe, expect, it } from 'vitest'
import { createPetBrain, type PetBrainDeps, type PetRiceKind } from '../dshpet/brain'
import { defaultPetState, type PetState } from '../../shared/pet'
import type { PetStore } from '../pet/store'

const BASE_MS = new Date(2026, 9, 11, 12, 0, 0).getTime()
const iso = (ms: number): string => new Date(ms).toISOString()
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

interface RiceCall {
  kind: PetRiceKind
  ref: Record<string, unknown> | null
}

interface Harness {
  brain: ReturnType<typeof createPetBrain>
  riceCalls: RiceCall[]
  current: () => PetState
}

/**
 * 迷你受控脑。onRice 的替身返回 opts.mirror（不传 = null，模拟"拒答"）。
 * mirror 可以是函数（按调用序返回值）。
 */
function makeHarness(
  opts: { seed?: Partial<PetState>; mirror?: number | null | (() => number | null); withSink?: boolean } = {}
): Harness {
  const riceCalls: RiceCall[] = []
  let disk: PetState = { ...defaultPetState(iso(BASE_MS)), ...(opts.seed ?? {}) }
  const store: PetStore = {
    load: () => ({ state: clone(disk), created: false }),
    save: (s) => {
      disk = clone(s)
      return true
    }
  }
  const deps: PetBrainDeps = {
    store,
    say: () => {},
    quip: () => {},
    anim: () => {},
    getMainFocused: () => false,
    log: () => {},
    now: () => BASE_MS
  }
  if (opts.withSink !== false) {
    deps.onRice = (ev) => {
      riceCalls.push({ kind: ev.kind, ref: ev.ref })
      const m = opts.mirror
      return typeof m === 'function' ? m() : (m ?? null)
    }
  }
  const brain = createPetBrain(deps)
  brain.init()
  return { brain, riceCalls, current: () => disk }
}

describe('feed 的饭镜像', () => {
  it('sink 收到 {feed, null}；镜像值覆盖本地算术并落盘', () => {
    const h = makeHarness({ seed: { rice: 5, satiety: 50 }, mirror: 42 })
    h.brain.act({ action: 'feed' })
    expect(h.riceCalls).toEqual([{ kind: 'feed', ref: null }])
    expect(h.current().rice).toBe(42) // 不是 4（本地算术）—— 账本说了算
  })

  it('sink 返回 null（没接账本 / 记账抛了）：本地算术原样保留（rice-1）', () => {
    const h = makeHarness({ seed: { rice: 5, satiety: 50 }, mirror: null })
    h.brain.act({ action: 'feed' })
    expect(h.riceCalls).toHaveLength(1)
    expect(h.current().rice).toBe(4)
  })

  it('sink 返回坏值（NaN）：当拒答处理，还是本地算术', () => {
    const h = makeHarness({ seed: { rice: 5, satiety: 50 }, mirror: Number.NaN })
    h.brain.act({ action: 'feed' })
    expect(h.current().rice).toBe(4)
  })

  it('不接 onRice 的旧配置：v1 算术（rice-1），sink 无从谈起', () => {
    const h = makeHarness({ seed: { rice: 5, satiety: 50 }, withSink: false })
    h.brain.act({ action: 'feed' })
    expect(h.riceCalls).toHaveLength(0)
    expect(h.current().rice).toBe(4)
  })
})

describe('grant 的 ref 形状（逐 kind）', () => {
  it('lesson 带 lessonId：ref = { lessonId }；镜像覆盖落盘', () => {
    const h = makeHarness({ seed: { rice: 10 }, mirror: 7 })
    h.brain.act({ action: 'grant', reward: 'lesson', lessonId: 'c-01' })
    expect(h.riceCalls).toEqual([{ kind: 'lesson', ref: { lessonId: 'c-01' } }])
    expect(h.current().rice).toBe(7)
  })

  it('lesson 不带 / 空串 / 纯空白 lessonId：ref = null（账本侧会标 rejected 拦下）', () => {
    const h = makeHarness({ seed: { rice: 10 }, mirror: null })
    h.brain.act({ action: 'grant', reward: 'lesson' })
    h.brain.act({ action: 'grant', reward: 'lesson', lessonId: '' })
    h.brain.act({ action: 'grant', reward: 'lesson', lessonId: '   ' })
    expect(h.riceCalls).toEqual([
      { kind: 'lesson', ref: null },
      { kind: 'lesson', ref: null },
      { kind: 'lesson', ref: null }
    ])
  })

  it('负控：answer 带 lessonId 也**不**传 ref（只有 lesson 带）', () => {
    const h = makeHarness({ seed: { rice: 10 }, mirror: null })
    h.brain.act({ action: 'grant', reward: 'answer', lessonId: 'c-01' })
    expect(h.riceCalls).toEqual([{ kind: 'answer', ref: null }])
  })

  it('checkin 走 grant 臂：{checkin, null}（签到也是饭变动）', () => {
    const h = makeHarness({ seed: { rice: 10 }, mirror: 12 })
    h.brain.act({ action: 'grant', reward: 'checkin' })
    expect(h.riceCalls).toEqual([{ kind: 'checkin', ref: null }])
    expect(h.current().rice).toBe(12)
  })

  it('review：{review, null}', () => {
    const h = makeHarness({ seed: { rice: 10 }, mirror: null })
    h.brain.act({ action: 'grant', reward: 'review' })
    expect(h.riceCalls).toEqual([{ kind: 'review', ref: null }])
  })
})

describe('grantRun 的饭镜像', () => {
  it('真发奖：{run, ref:{fingerprint}} 且镜像落盘', () => {
    const h = makeHarness({ seed: { rice: 10 }, mirror: 11 })
    expect(h.brain.grantRun('12:abcdef01')).toBe(true)
    expect(h.riceCalls).toEqual([{ kind: 'run', ref: { fingerprint: '12:abcdef01' } }])
    expect(h.current().rice).toBe(11)
  })

  it('同指纹拒发的那次：sink 不被调（没发奖就没有这笔账）', () => {
    const h = makeHarness({ seed: { rice: 10 }, mirror: null })
    expect(h.brain.grantRun('12:abcdef01')).toBe(true)
    expect(h.brain.grantRun('12:abcdef01')).toBe(false)
    expect(h.riceCalls).toHaveLength(1)
  })

  it('reportRun 的 own+hash 路径也过 sink（同一条 awardRun）', () => {
    const h = makeHarness({ seed: { rice: 10 }, mirror: null })
    h.brain.reportRun({ ok: true, kind: 'run', line: null, rect: null, own: true, hash: '12:abcdef01' })
    expect(h.riceCalls).toEqual([{ kind: 'run', ref: { fingerprint: '12:abcdef01' } }])
  })
})

describe('sink 抛异常不许把动作炸掉（调用方 app.ts 已 try/catch，这里钉 brain 侧的传播形状）', () => {
  it('onRice 抛：异常向上传播（由 app.ts 兜底），但不要静默吞', () => {
    const h = makeHarness({ seed: { rice: 5, satiety: 50 }, mirror: () => null })
    // 重接一个必抛的 sink
    const deps: PetBrainDeps = {
      store: { load: () => ({ state: clone(h.current()), created: false }), save: () => true },
      say: () => {},
      quip: () => {},
      anim: () => {},
      getMainFocused: () => false,
      log: () => {},
      now: () => BASE_MS,
      onRice: () => {
        throw new Error('boom')
      }
    }
    const brain = createPetBrain(deps)
    brain.init()
    expect(() => brain.act({ action: 'feed' })).toThrow('boom')
  })

  it('反例自证：同一动作在不抛的脑上不抛（尺子分得开）', () => {
    const h = makeHarness({ seed: { rice: 5, satiety: 50 }, mirror: null })
    expect(() => h.brain.act({ action: 'feed' })).not.toThrow()
    // 且这条路径没被别的东西吞掉 —— sink 真被调了
    expect(h.riceCalls).toHaveLength(1)
  })
})
