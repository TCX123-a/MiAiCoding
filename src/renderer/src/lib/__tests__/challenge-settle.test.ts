/**
 * 挑战结算载荷构建器（renderer/src/lib/challenge-settle.ts）的单测 —— 收工
 * watcher 那条冷路径上的全部边界，这里直接喂构造的 ChallengeDay 钉住。
 *
 * 【钉死哪些裁决】
 *   · 前缀语义：answers 是"做过的前缀"，遇缺作答就停（答错即停后没见的题不上行）；
 *   · resolve 找不回原题 / difficulty 是坏值 → 跳过该题（宁少算不虚报）；
 *   · lesson 查不到 → common/阶段 0（与既有下限口径一致，不跳题）；
 *   · startedAt 只在解析得出且 ≤ finishedAt 时才带（装饰字段，不连坐整批）；
 *   · pickedLangs 只留可勾选语言 + 去重；一个不剩就**省略字段**（显式空数组
 *     会被服务端 400）；
 *   · 没收工（无 finishedAt）/ 一道有效题都没有 → null（绝不发空批）。
 *
 * ⚠️ 本文件在 `src/` 下：字符串字面量一律 ASCII。
 */
import { describe, expect, it } from 'vitest'
import type { ChallengeAnswer, ChallengeDay, ChallengeQuestion, ChoiceQuestion, Question } from '../../../../shared/types'
import type { Difficulty, Lang } from '../../../../shared/cloud/protocol'
import { CHALLENGE_RUN_MAX } from '../../../../shared/cloud/protocol'
import { buildSettlePayload, type SettleBuildDeps } from '../challenge-settle'

const CREATED = '2026-10-11T11:00:00.000Z'
const FINISHED = '2026-10-11T11:30:00.000Z'

/** 最小的合法选择题（内容与逻辑无关） */
function mkQ(over: Partial<ChoiceQuestion> = {}): ChoiceQuestion {
  return {
    id: 'q1',
    type: 'choice',
    stem: 'stem',
    options: ['a', 'b'],
    answer: 0,
    explanation: 'because',
    ...over
  }
}

function mkCQ(lessonId: string, qid: string, over: Partial<ChallengeQuestion> = {}): ChallengeQuestion {
  return { key: `${lessonId}:${qid}`, lessonId, qid, ...over }
}

const ansOk: ChallengeAnswer = { your: 0, ok: true }
const ansBad: ChallengeAnswer = { your: 1, ok: false }

function mkDay(over: Partial<ChallengeDay> = {}): ChallengeDay {
  const day: ChallengeDay = {
    dateKey: '2026-10-11',
    source: 'local',
    createdAt: CREATED,
    finishedAt: FINISHED,
    questions: [mkCQ('c-01', 'q1')],
    answers: [ansOk],
    score: null
  }
  // 不用 `{...base, ...over}` 字面量：exactOptionalPropertyTypes 下，散开的
  // Partial 会把 `score?: X | null` 变成「可显式 undefined」，与 ChallengeDay
  // 的声明不容。Object.assign 同语义且类型干净（over 永不带显式 undefined 键）。
  return Object.assign(day, over)
}

/** resolve 全认（题从 cq.ai 或内容包来，测试里统一给 mkQ()） */
function deps(over: Partial<SettleBuildDeps> = {}): SettleBuildDeps {
  return {
    resolve: (cq) => cq.ai ?? (mkQ({ id: cq.qid }) as Question),
    lessonOf: () => ({ lang: 'c', stage: 1 }),
    ...over
  }
}

// ---------------------------------------------------------------- happy path 与字段

describe('happy path', () => {
  it('基本字段、逐题形状、startedAt 装饰', () => {
    const p = buildSettlePayload(mkDay(), deps())
    expect(p).not.toBeNull()
    expect(p!.dateKey).toBe('2026-10-11')
    expect(p!.source).toBe('local')
    expect(p!.finishedAt).toBe(FINISHED)
    expect(p!.startedAt).toBe(CREATED)
    expect(p!.questions).toEqual([
      {
        key: 'c-01:q1',
        lessonId: 'c-01',
        qid: 'q1',
        lang: 'c',
        stage: 1,
        type: 'choice',
        difficulty: 'easy', // choice 无显式 difficulty → resolveDifficulty 按题型给 easy
        source: 'local',
        ok: true
      }
    ])
  })

  it('ok 如实映射（答错的那题也上行，ok:false）', () => {
    const day = mkDay({
      questions: [mkCQ('c-01', 'q1'), mkCQ('c-01', 'q2')],
      answers: [ansOk, ansBad]
    })
    const p = buildSettlePayload(day, deps())
    expect(p!.questions.map((q) => q.ok)).toEqual([true, false])
  })

  it('cq.ai 在场：source = ai；显式 difficulty 优先于题型缺省', () => {
    const day = mkDay({
      source: 'ai',
      questions: [mkCQ('ai', 'q9', { ai: mkQ({ difficulty: 'hard' }) })]
    })
    const p = buildSettlePayload(day, deps())
    expect(p!.source).toBe('ai')
    expect(p!.questions[0].source).toBe('ai')
    expect(p!.questions[0].difficulty).toBe('hard')
  })
})

// ---------------------------------------------------------------- 前缀与跳过

describe('前缀语义与跳过', () => {
  it('answers 短于 questions：只上行做过的前缀', () => {
    const day = mkDay({
      questions: [mkCQ('c-01', 'q1'), mkCQ('c-01', 'q2'), mkCQ('c-01', 'q3')],
      answers: [ansOk, ansOk] // 第三题没做到（答错即停）
    })
    const p = buildSettlePayload(day, deps())
    expect(p!.questions.map((q) => q.qid)).toEqual(['q1', 'q2'])
  })

  it('中间缺作答：从缺口起全停（不是"跳过这一条继续"）', () => {
    const day = mkDay({
      questions: [mkCQ('c-01', 'q1'), mkCQ('c-01', 'q2'), mkCQ('c-01', 'q3')],
      answers: [ansOk, undefined as unknown as ChallengeAnswer, ansBad]
    })
    const p = buildSettlePayload(day, deps())
    expect(p!.questions.map((q) => q.qid)).toEqual(['q1'])
  })

  it('resolve 找不回原题：跳过该题，后面的照上（顺序保留）', () => {
    const day = mkDay({
      questions: [mkCQ('gone', 'q1'), mkCQ('c-01', 'q2')],
      answers: [ansOk, ansOk]
    })
    const p = buildSettlePayload(day, deps({ resolve: (cq) => (cq.lessonId === 'gone' ? null : mkQ()) }))
    expect(p!.questions.map((q) => q.key)).toEqual(['c-01:q2'])
  })

  it('difficulty 是坏值（内容包坏了）：跳过该题而不是发出去被 400', () => {
    const bad = mkQ({ difficulty: 'impossible' as unknown as Difficulty })
    const day = mkDay({
      questions: [mkCQ('c-01', 'q1'), mkCQ('c-01', 'q2')],
      answers: [ansOk, ansOk]
    })
    const p = buildSettlePayload(day, deps({ resolve: (cq) => (cq.qid === 'q1' ? bad : mkQ()) }))
    expect(p!.questions.map((q) => q.qid)).toEqual(['q2'])
  })

  it('lesson 查不到：不跳题，按 common / 阶段 0 计（与既有下限口径一致）', () => {
    const day = mkDay()
    const p = buildSettlePayload(day, deps({ lessonOf: () => null }))
    expect(p!.questions[0].lang).toBe('common')
    expect(p!.questions[0].stage).toBe(0)
  })

  it('截断：> CHALLENGE_RUN_MAX 只发前 5000（整批 400 更坏）', () => {
    const n = CHALLENGE_RUN_MAX + 1
    const day = mkDay({
      questions: Array.from({ length: n }, (_, i) => mkCQ('c-01', `q${i}`)),
      answers: Array.from({ length: n }, () => ansOk)
    })
    const p = buildSettlePayload(day, deps())
    expect(p!.questions).toHaveLength(CHALLENGE_RUN_MAX)
    expect(p!.questions[0].qid).toBe('q0')
    expect(p!.questions[CHALLENGE_RUN_MAX - 1].qid).toBe(`q${CHALLENGE_RUN_MAX - 1}`)
  })
})

// ---------------------------------------------------------------- startedAt

describe('startedAt 装饰字段', () => {
  it('createdAt 晚于 finishedAt（时钟被拨过）：丢字段、不丢整批', () => {
    const day = mkDay({ createdAt: '2026-10-11T12:00:00.000Z' })
    const p = buildSettlePayload(day, deps())
    expect(p).not.toBeNull()
    expect(p!.startedAt).toBeUndefined()
  })

  it('createdAt 解析不出：丢字段', () => {
    const day = mkDay({ createdAt: 'not-a-time' })
    const p = buildSettlePayload(day, deps())
    expect(p).not.toBeNull()
    expect(p!.startedAt).toBeUndefined()
  })

  it('createdAt === finishedAt：带上（≤ 是闭区间）', () => {
    const day = mkDay({ createdAt: FINISHED })
    expect(buildSettlePayload(day, deps())!.startedAt).toBe(FINISHED)
  })
})

// ---------------------------------------------------------------- pickedLangs

describe('pickedLangs', () => {
  it('过滤不可勾选（common）+ 去重，保序', () => {
    const day = mkDay({ pickedLangs: ['common', 'python', 'c', 'python'] as Lang[] })
    expect(buildSettlePayload(day, deps())!.pickedLangs).toEqual(['python', 'c'])
  })

  it('全被过滤（只剩 common）：省略字段而不是发空数组', () => {
    const day = mkDay({ pickedLangs: ['common'] as Lang[] })
    const p = buildSettlePayload(day, deps())
    expect('pickedLangs' in p!).toBe(false)
  })

  it('本来就没有（v3 之前画的批次）：省略字段', () => {
    const p = buildSettlePayload(mkDay(), deps())
    expect('pickedLangs' in p!).toBe(false)
  })
})

// ---------------------------------------------------------------- null 出口

describe('收不了工（null）的出口', () => {
  it('没有 finishedAt（还在做）：null', () => {
    // 「没有」在类型世界里就是 null（ChallengeDay.finishedAt 是必填的
    // string | null，字段整个缺失只存在于没归一过的旧档）；两条都走同一个
    // falsy 判据，所以这里用声明允许的形状表达同一场景
    const day = mkDay({ finishedAt: null })
    expect(buildSettlePayload(day, deps())).toBeNull()
  })

  it('一道有效题都没有（全被跳过）：null，绝不发空批', () => {
    const day = mkDay({
      questions: [mkCQ('gone', 'q1')],
      answers: [ansOk]
    })
    expect(buildSettlePayload(day, deps({ resolve: () => null }))).toBeNull()
  })

  it('根本没有题：null', () => {
    expect(buildSettlePayload(mkDay({ questions: [], answers: [] }), deps())).toBeNull()
  })

  it('反例自证：把同一份 day 的 resolve 修好就不是 null（尺子分得开）', () => {
    const day = mkDay({ questions: [mkCQ('gone', 'q1')], answers: [ansOk] })
    expect(buildSettlePayload(day, deps({ resolve: () => null }))).toBeNull()
    expect(buildSettlePayload(day, deps())).not.toBeNull()
  })
})
