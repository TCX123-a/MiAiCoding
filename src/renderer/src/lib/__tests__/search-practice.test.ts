/**
 * 搜索微型卷的启动器（src/renderer/src/lib/search-practice.ts）。
 *
 * 【这个文件在守什么】
 * 开局这一下能悄悄错掉的地方（和收藏练习同一个套路）：
 *   · keys 必须来自**每题自己的宿主课**，绝不能是 `__search__:xxx` 哨兵垃圾
 *     （不然答错往错题本灌垃圾条目、答对永远消除不掉 —— quiz.ts 的 restart
 *      注释里记着同型 bug 的现场）；
 *   · 题目和 keys 必须**同一次挑选**产生（只洗一边 = 键错位 = 错的题记到别人头上）；
 *   · 少给了几道必须报**实际的数**，不假装凑齐。
 *
 * 挑战题不在这儿测 —— 它在更上游就被滤掉了（`searchQuestions` 的职责，
 * 判据在 shared/__tests__/search.test.ts）。这里是"命中进来之后"的那一段。
 *
 * 内容查找走注入（SearchPracticeDeps）：不啃真内容包，
 * 断言也就不依赖"真内容此刻长什么样"。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSearchStarter } from '../search-practice'
import { useQuizStore } from '../../stores/quiz'
import { stubMiai } from '../../stores/__tests__/miai-stub'
import { toasts } from '../../components/base/toast'
import { TOAST } from '../copy'
import type { Question } from '../../../../shared/types'
import type { QuestionSearchHit } from '../../../../shared/search'
import type { QuestionIndexItem } from '../../../../shared/question-index'

function choice(id: string): Question {
  return { id, type: 'choice', stem: `stem-${id}`, options: ['a', 'b', 'c'], answer: 0, explanation: 'e' }
}

/** 造一条命中（条目字段只用得上 key，其余给无害缺省） */
function hit(key: string): QuestionSearchHit {
  const item: QuestionIndexItem = {
    key,
    lessonId: key.split(':')[0],
    lang: 'common',
    stage: 1,
    type: 'choice',
    difficulty: 'easy',
    tags: [],
    stem: `stem-${key}`
  }
  return { item, score: 2 }
}

/** 一份假内容包：两节课、各两道题 */
const builtIn: Record<string, Question[]> = {
  'c-stage1-01': [choice('q1'), choice('q2')],
  'c-stage1-02': [choice('q3'), choice('q4')]
}
const deps = {
  findBuiltIn: (lessonId: string, qid: string): Question | null =>
    builtIn[lessonId]?.find((q) => q.id === qid) ?? null
}

beforeEach(() => {
  setActivePinia(createPinia())
  stubMiai()
  toasts.length = 0
})

describe('startSearch：搜索微型卷开局', () => {
  it('★ keys 全部来自每题自己的宿主课（一条 __search__ 哨兵都不许有）', () => {
    const quiz = useQuizStore()
    const { startSearch } = useSearchStarter()
    const n = startSearch([hit('c-stage1-01:q2'), hit('c-stage1-02:q3')], deps)

    const s = quiz.session!
    expect(n).toBe(2)
    expect(s.mode).toBe('search')
    expect(s.lessonId).toBe('__search__')
    expect(s.questions).toHaveLength(2)
    for (const k of s.keys) expect(k.startsWith('__search__:')).toBe(false)
    expect([...s.keys].sort()).toEqual(['c-stage1-01:q2', 'c-stage1-02:q3'])
    expect(toasts.at(-1)?.text).toBe(TOAST.searchStarted(2))
    expect(toasts.at(-1)?.type).toBe('success')
  })

  it('★ questions 与 keys 一一对应：keys[i] 正是 questions[i] 那道题的键', () => {
    const quiz = useQuizStore()
    const { startSearch } = useSearchStarter()
    startSearch(
      [hit('c-stage1-01:q1'), hit('c-stage1-01:q2'), hit('c-stage1-02:q3'), hit('c-stage1-02:q4')],
      deps
    )

    const s = quiz.session!
    expect(s.questions).toHaveLength(4)
    for (let i = 0; i < s.questions.length; i++) {
      const q = s.questions[i]
      // 按题号反查它挂在哪一课，拼出来的键必须就是 keys[i]。
      // 只比"集合相等"不够 —— 错位是**换个配对**，集合照样相等
      const host = q.id === 'q1' || q.id === 'q2' ? 'c-stage1-01' : 'c-stage1-02'
      expect(s.keys[i], `第 ${i} 题`).toBe(`${host}:${q.id}`)
    }
  })

  it('命中里有的题在本机解析不出来 → 少出那几道，剩下的照开（toast 报实数）', () => {
    const quiz = useQuizStore()
    const { startSearch } = useSearchStarter()
    const n = startSearch([hit('c-stage1-01:q1'), hit('c-stage9-99:q7')], deps)

    expect(n).toBe(1)
    expect(quiz.session!.keys).toEqual(['c-stage1-01:q1'])
    expect(toasts.at(-1)?.text).toBe(TOAST.searchStarted(1))
  })

  it('一条都解析不出来 → 不开空卷、也不说话（命中与本体同源，真机上到不了这儿）', () => {
    const quiz = useQuizStore()
    const { startSearch } = useSearchStarter()
    expect(startSearch([hit('c-stage9-99:q1')], deps)).toBe(0)
    expect(quiz.session).toBeNull()
    expect(toasts).toHaveLength(0)
  })

  it('空命中：不开空卷也不说话', () => {
    const quiz = useQuizStore()
    const { startSearch } = useSearchStarter()
    expect(startSearch([], deps)).toBe(0)
    expect(quiz.session).toBeNull()
    expect(toasts).toHaveLength(0)
  })
})
