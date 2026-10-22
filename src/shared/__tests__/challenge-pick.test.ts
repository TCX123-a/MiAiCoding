/**
 * 每日挑战的抽题（shared/challenge.ts 的 lastSeenOf / pickChallenge）
 *
 * 【这个文件在守什么】
 * 守的是**「今天别抽到昨天刚做过的题」这条规则，在池子小的时候不会把它自己饿死**。
 *
 * 题库现在只有 1 课 7 道题。规则写得太硬（「出过的一律不要」），
 * 学完这一课的人第二天就会**一道题都抽不出来** —— 那不是「去重成功」，
 * 是功能坏了。所以真正的规则是**两段式**：
 *   先要没出过的；不够，再从「最久没出过的」补。
 * 两段的顺序、补的排序、以及「补的时候不重复」，都在这里钉住。
 */

import { describe, expect, it } from 'vitest'
import { lastSeenOf, pickChallenge } from '../challenge'
import type { ChallengeDay, Question } from '../types'

function q(id: string): Question {
  return { id, type: 'fill', stem: `题干 ${id}`, answer: 'x', explanation: '解析' }
}

/** 造一个池子：课号一律 lesson-a，题号 q1..qN */
function pool(n: number): { question: Question; lessonId: string; lessonTitle: string }[] {
  return Array.from({ length: n }, (_, i) => ({
    question: q(`q${i + 1}`),
    lessonId: 'lesson-a',
    lessonTitle: '第一课'
  }))
}

/** 池子里每道题的 key（`课号:题号`），和 pickChallenge 判定用的是同一套 */
function keysOf(items: { question: Question; lessonId: string }[]): string[] {
  return items.map((it) => `${it.lessonId}:${it.question.id}`)
}

/** 造一天的历史 */
function day(dateKey: string, qids: string[]): ChallengeDay {
  return {
    dateKey,
    source: 'local',
    questions: qids.map((qid) => ({ key: `lesson-a:${qid}`, lessonId: 'lesson-a', qid })),
    createdAt: `${dateKey}T10:00:00.000Z`,
    finishedAt: null,
    score: null
  }
}

// ---------------------------------------------------------------- lastSeenOf

describe('lastSeenOf：一道题最后一次出现是哪天', () => {
  it('同一道题出过两次，记**最近**那一次', () => {
    const seen = lastSeenOf([day('2026-09-01', ['q1']), day('2026-09-05', ['q1'])])
    expect(seen['lesson-a:q1']).toBe('2026-09-05')
  })

  it('先给新的、再给旧的，结果一样（顺序不该影响结论）', () => {
    const a = lastSeenOf([day('2026-09-05', ['q1']), day('2026-09-01', ['q1'])])
    const b = lastSeenOf([day('2026-09-01', ['q1']), day('2026-09-05', ['q1'])])
    expect(a).toEqual(b)
  })

  it('没出过的题不出现在表里（而不是映射成空串）', () => {
    const seen = lastSeenOf([day('2026-09-01', ['q1'])])
    expect('lesson-a:q2' in seen).toBe(false)
  })

  it('空历史 → 空表，不抛错', () => {
    expect(lastSeenOf([])).toEqual({})
  })
})

// ---------------------------------------------------------------- pickChallenge

describe('pickChallenge：先要新鲜的，不够再拿最久没出过的补', () => {
  it('池子够大时，抽出来的**一道出过的都没有**', () => {
    const p = pool(7)
    const lastSeen: Record<string, string> = {
      'lesson-a:q1': '2026-09-12',
      'lesson-a:q2': '2026-09-12'
    }
    const picked = pickChallenge(p, lastSeen, 5, () => 0)
    expect(picked).toHaveLength(5)
    for (const k of keysOf(picked)) expect(lastSeen[k]).toBeUndefined()
  })

  it('**池子不够时不会抽空** —— 从最久没出过的开始补（这条不守，学完一课第二天就 0 道题）', () => {
    const p = pool(7)
    // 7 道里 5 道出过，只剩 2 道新鲜；要 5 道 → 新鲜的 2 道 + 补 3 道
    const lastSeen: Record<string, string> = {
      'lesson-a:q1': '2026-09-01', // 最久
      'lesson-a:q2': '2026-09-02',
      'lesson-a:q3': '2026-09-03',
      'lesson-a:q4': '2026-09-04',
      'lesson-a:q5': '2026-09-05' // 最近
    }
    const picked = pickChallenge(p, lastSeen, 5, () => 0)
    expect(picked).toHaveLength(5)
    // 补进来的必须是 q1/q2/q3 —— 最久没出过的三道，而不是随手抓三道
    const reused = keysOf(picked).filter((k) => lastSeen[k] !== undefined).sort()
    expect(reused).toEqual(['lesson-a:q1', 'lesson-a:q2', 'lesson-a:q3'])
  })

  it('一道新鲜的都没有时，仍然给满 5 道（按最久没出过排序）', () => {
    const p = pool(7)
    const lastSeen: Record<string, string> = Object.fromEntries(
      Array.from({ length: 7 }, (_, i) => [`lesson-a:q${i + 1}`, `2026-09-0${i + 1}`])
    )
    const picked = pickChallenge(p, lastSeen, 5, () => 0)
    expect(picked).toHaveLength(5)
    expect(keysOf(picked).sort()).toEqual([
      'lesson-a:q1',
      'lesson-a:q2',
      'lesson-a:q3',
      'lesson-a:q4',
      'lesson-a:q5'
    ])
  })

  it('**抽出来的题目互不重复**（新鲜的和补的是同一套判定切出来的两半，天然不重叠）', () => {
    const p = pool(7)
    const lastSeen = { 'lesson-a:q1': '2026-09-01', 'lesson-a:q6': '2026-09-02' }
    const picked = pickChallenge(p, lastSeen, 5, () => 0)
    const keys = keysOf(picked)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('池子比要的还小 → 有几道给几道，不补空', () => {
    const picked = pickChallenge(pool(3), {}, 5, () => 0)
    expect(picked).toHaveLength(3)
    expect(keysOf(picked).every((k) => k !== undefined)).toBe(true)
  })

  it('n = 池长 → 整池全抽（集合相等，且是池子的一个排列）', () => {
    // n 必填（v3 契约：客户端常量与默认参数一起删了，调用方给多大就抽多大）
    // —— 客户端挑战 draw() 传的就是池长（stores/challenge.ts），语义 =「全池都要」
    const p = pool(30)
    const picked = pickChallenge(p, {}, p.length, () => 0)
    expect(picked).toHaveLength(p.length)
    expect(keysOf(picked).sort()).toEqual(keysOf(p).sort())
    expect(new Set(keysOf(picked)).size).toBe(p.length)
  })

  it('池子是空的 → 空数组，不抛错', () => {
    expect(pickChallenge([], {}, 5, () => 0)).toEqual([])
  })

  it('抽出来的每一道都还在池子里（不会凭空造题）', () => {
    const p = pool(7)
    const all = new Set(keysOf(p))
    for (const k of keysOf(pickChallenge(p, { 'lesson-a:q1': '2026-09-01' }, 5, () => 0))) {
      expect(all.has(k)).toBe(true)
    }
  })

  it('不改动传入的池子', () => {
    const p = pool(7)
    const before = keysOf(p)
    pickChallenge(p, {}, 5, () => 0)
    expect(keysOf(p)).toEqual(before)
  })
})
