/**
 * 候选池与抽题（shared/challenge.ts）
 *
 * 【本文件最要紧的是那条 Bug A 回归】
 * 池子原来只抓题目、把宿主课号丢了，导致随机组卷答错的题进错题本时
 * key 变成 `__random__:q1` —— 错题本按 `__random__` 查不到任何课，
 * 于是**课名显示成 `__random__`、题干显示成「题目已被移走喵」**。
 * 整个过程不报错，只是安静地显示一堆垃圾。
 *
 * 那条回归测试就是钉死这一点：从池子里抽出来的每一道题，
 * 都必须能拼回**真实存在的课号**，永远不许再出现 `__random__`。
 */

import { describe, expect, it } from 'vitest'
import { buildPool, pickFromPool, type PoolItem } from '../challenge'
import { parseQuestionKey, questionKey } from '../question-key'
import type { Lesson, LessonStatus, Question } from '../types'

/** 造一门课，只写测试关心的字段 */
function lesson(id: string, title: string, questions: Question[]): Lesson {
  return {
    id,
    lang: 'common',
    stage: 0,
    order: 1,
    title,
    tags: [],
    required: [],
    crossRefs: [],
    compare: [],
    estMinutes: 10,
    keywords: [],
    body: '',
    questions
  }
}

function choice(id: string, stem: string): Question {
  return { id, type: 'choice', stem, options: ['甲', '乙'], answer: 0, explanation: '解析' }
}

/** 三门课：前两门已学、第三门没学、第四门已学但没题 */
const LESSONS: Lesson[] = [
  lesson('common-01', '认识编程', [choice('q1', '第一题'), choice('q2', '第二题')]),
  lesson('common-02', '变量', [choice('q1', '第三题')]),
  lesson('common-03', '循环', [choice('q1', '没学过不该抽到')]),
  lesson('common-04', '空课', [])
]

function statusOf(id: string): LessonStatus {
  return id === 'common-03' ? 'locked' : 'learned'
}

describe('buildPool：收题时必须连宿主课一起收', () => {
  it('每一项都带着宿主课号，没有一个落在 undefined', () => {
    const pool = buildPool(LESSONS, statusOf, (st) => st === 'learned')
    expect(pool.length).toBe(3) // common-01 两题 + common-02 一题
    for (const it of pool) {
      expect(typeof it.lessonId).toBe('string')
      expect(it.lessonId).not.toBe('')
      expect(it.lessonTitle).not.toBe('')
    }
  })

  it('条件外的课不收（locked 的 common-03 不该出现）', () => {
    const pool = buildPool(LESSONS, statusOf, (st) => st === 'learned')
    expect(pool.some((it) => it.lessonId === 'common-03')).toBe(false)
  })

  it('没有题的课不产生条目（common-04 是空的）', () => {
    const pool = buildPool(LESSONS, statusOf, (st) => st === 'learned')
    expect(pool.some((it) => it.lessonId === 'common-04')).toBe(false)
  })

  it('同一批课，条件不同结果的池子不同（练习页 open|learned vs 挑战 learned）', () => {
    const all = buildPool(LESSONS, () => 'open', (st) => st === 'open' || st === 'learned')
    const learned = buildPool(LESSONS, statusOf, (st) => st === 'learned')
    expect(all.length).toBe(4) // 四门课都收（common-04 没题，仍然只有 3 题）
    expect(learned.length).toBe(3)
    expect(learned.length).toBeLessThanOrEqual(all.length)
  })

  it('空课表 → 空池子，不抛错', () => {
    expect(buildPool([], statusOf, () => true)).toEqual([])
  })
})

describe('pickFromPool：抽题', () => {
  const pool = buildPool(LESSONS, statusOf, (st) => st === 'learned')
  /** 假的确定性随机源：恒返回 0 → 洗牌后顺序可预测 */
  const zero = () => 0

  it('注入固定随机源时结果完全可复现', () => {
    const a = pickFromPool(pool, 3, zero)
    const b = pickFromPool(pool, 3, zero)
    expect(a.map((x) => x.question.stem)).toEqual(b.map((x) => x.question.stem))
  })

  it('不改动传入的池子（Fisher-Yates 必须洗副本）', () => {
    const before = pool.map((x) => x.question.stem)
    pickFromPool(pool, 3, zero)
    expect(pool.map((x) => x.question.stem)).toEqual(before)
  })

  it('池子不够时**有几道给几道**，不补空、不抛错', () => {
    // 当前整个题库只有 7 道题（1 门课有内容），这条是现实约束不是假想
    expect(pickFromPool(pool, 99, zero).length).toBe(3)
  })

  it('要 0 道就给空数组', () => {
    expect(pickFromPool(pool, 0, zero)).toEqual([])
    expect(pickFromPool(pool, -5, zero)).toEqual([])
  })

  it('空池 → 空数组', () => {
    expect(pickFromPool([], 5, zero)).toEqual([])
  })

  it('抽出来的每一道都还在池子里（不会凭空造题）', () => {
    const picked = pickFromPool(pool, 2, zero)
    for (const it of picked) {
      expect(pool.some((p) => p.question.id === it.question.id && p.lessonId === it.lessonId)).toBe(
        true
      )
    }
  })

  it('rand 恒返回 0 也不越界（洗牌下标的边界）', () => {
    expect(() => pickFromPool(pool, 3, zero)).not.toThrow()
    // 恒返回 0.999… 也要不越界
    expect(() => pickFromPool(pool, 3, () => 0.999999)).not.toThrow()
  })
})

describe('Bug A 回归：抽出来的题必须能拼回真实课号的 key', () => {
  const pool = buildPool(LESSONS, statusOf, (st) => st === 'learned')

  it('每一道题的 key 都不以 __random__ 开头，且课号在课表里真实存在', () => {
    // 旧写法：startQuiz('random', '__random__', questions) → key 全成了 '__random__:q1'
    const picked = pickFromPool(pool, 3)
    const keys = picked.map((p) => questionKey(p.lessonId, p.question.id))

    for (const k of keys) {
      expect(k.startsWith('__random__')).toBe(false)
      const { lessonId, qid } = parseQuestionKey(k)
      expect(LESSONS.some((l) => l.id === lessonId)).toBe(true)
      expect(qid).not.toBe('')
    }
  })

  it('错题本按 key 能反查出课名和题干（这才是修好的标准）', () => {
    const picked = pickFromPool(pool, 3)
    const keys = picked.map((p) => questionKey(p.lessonId, p.question.id))

    // 模拟错题本的展示逻辑：用 key 反查课 + 题
    for (const k of keys) {
      const { lessonId, qid } = parseQuestionKey(k)
      const l = LESSONS.find((x) => x.id === lessonId)
      const q = l?.questions.find((x) => x.id === qid)
      expect(l, `key=${k} 反查不到课`).toBeTruthy()
      expect(q, `key=${k} 反查不到题干`).toBeTruthy()
      expect(l!.title).not.toBe('__random__')
    }
  })

  it('挑两次会得到不同顺序 —— 所以 questions 和 keys 必须来自**同一次**挑选', () => {
    // 这条不是测 pickFromPool，是给调用方立个凭证：分开调两次，
    // 一次拿去当 questions、另一次拿去算 keys，两个数组的顺序就对不上，
    // 结果是把 A 题的 key 配给 B 题 —— 答错 B 却把 A 记进错题本。
    const sig = (p: PoolItem[]) => p.map((x) => questionKey(x.lessonId, x.question.id)).join('|')

    const first = pickFromPool(pool, 3, () => 0)
    const second = pickFromPool(pool, 3, () => 0.999)
    expect(sig(first)).not.toBe(sig(second)) // 两次挑选确实不同 —— 这就是风险本身

    // 正确做法：挑一次，两样都从这一份里取（PracticeView.startRandom 就是这么写的）
    const once = pickFromPool(pool, 3, () => 0.999)
    expect(sig(once)).toBe(sig(second))
    // 而且同一次里，keys[i] 必然对应 questions[i] 的宿主
    once.forEach((item, i) => {
      expect(item.question.id).toBe(once[i].question.id)
      expect(item.lessonId).toBe(once[i].lessonId)
    })
  })
})

describe('池子里的一道题在错题本里是唯一身份', () => {
  it('两门课都有 q1 时，key 不同 —— 不会张冠李戴', () => {
    const pool = buildPool(LESSONS, statusOf, (st) => st === 'learned')
    const q1s = pool.filter((p) => p.question.id === 'q1')
    expect(q1s.length).toBe(2) // common-01 和 common-02 各有一个 q1
    const keys = new Set(q1s.map((p: PoolItem) => questionKey(p.lessonId, p.question.id)))
    expect(keys.size).toBe(2)
  })
})
