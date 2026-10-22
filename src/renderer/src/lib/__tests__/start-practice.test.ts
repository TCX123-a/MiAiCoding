/**
 * 课后练习的组卷入口（src/renderer/src/lib/startPractice.ts）。
 *
 * 【这个文件在守什么】
 * 「挑战题不进课后练习」这条判据，实现在 `startLessonPractice` 的**那一行过滤**里。
 * 它是七个练习入口里**唯一一个能放进单测的**（另外两个在 views/PracticeView.vue ——
 * `.vue` 不在 vitest 的 include 范围里，靠真窗口探针守）。
 *
 * 这一行过滤的坏法全是"安静地不对"：
 *   · 过滤被删/被挪到别的变量上 —— 挑战题混进课后卷，学员界面没有任何提示；
 *   · 过滤成了"只留挑战" —— 卷子静默变短甚至发不出来，提示还是"还没练习题"；
 *   · 过滤把 keys 和 questions 拆散 —— 错题本会记到别的题头上（同款教训见 quiz.test.ts）。
 *
 * ⚠️ 断言的构造都**不依赖运气**：需要"不过滤就必红"的地方，用的是
 * 「普通题数 < 卷子题数」的课（4 普通 + 5 挑战）—— 不过滤时抽 5 道**必然**抽进挑战题。
 * 靠概率的判据跑十次绿九次，正是这个项目最想避免的那类假绿。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePracticeStarter } from '../startPractice'
import { useQuizStore } from '../../stores/quiz'
import { stubMiai } from '../../stores/__tests__/miai-stub'
import { toasts } from '../../components/base/toast'
import { TOAST } from '../copy'
import { isChallenge } from '../../../../shared/difficulty'
import { LESSON_PRACTICE_SIZE } from '../../../../shared/quiz-paper'
import type { Difficulty, Lang, Lesson, Question, Stage } from '../../../../shared/types'

function choice(id: string, difficulty?: Difficulty): Question {
  const d = difficulty === undefined ? {} : { difficulty }
  return {
    id,
    type: 'choice',
    ...d,
    stem: `stem-${id}`,
    options: ['a', 'b', 'c'],
    answer: 0,
    explanation: 'e'
  }
}

function lesson(id: string, questions: Question[], lang: Lang = 'c', stage: Stage = 1): Lesson {
  return {
    id,
    lang,
    stage,
    order: 1,
    title: `title-${id}`,
    tags: [],
    required: [],
    crossRefs: [],
    compare: [],
    estMinutes: 5,
    keywords: [],
    body: '',
    questions
  }
}

function start() {
  const quiz = useQuizStore()
  const { startLessonPractice } = usePracticeStarter()
  return { quiz, startLessonPractice }
}

beforeEach(() => {
  setActivePinia(createPinia())
  stubMiai()
  toasts.length = 0
})

describe('startLessonPractice：课后练习的组卷', () => {
  it('★ 挑战题不进课后练习（普通题比卷子题数还少时，不过滤必然抽进挑战题）', () => {
    const normal = [1, 2, 3, 4].map((i) => choice(`n${i}`))
    const chall = [1, 2, 3, 4, 5].map((i) => choice(`c${i}`, 'challenge'))
    const { quiz, startLessonPractice } = start()
    startLessonPractice(lesson('c-stage1-01', [...normal, ...chall]))

    const s = quiz.session!
    // 普通题只有 4 道 < 卷子题数 —— 过滤后卷子就是这 4 道；不过滤必然是 5 道且混着挑战题
    expect(s.questions).toHaveLength(4)
    for (const q of s.questions) expect(isChallenge(q), q.id).toBe(false)
    // keys 与题目一一对应，且全部挂在这门课下
    expect([...s.keys].sort()).toEqual([
      'c-stage1-01:n1',
      'c-stage1-01:n2',
      'c-stage1-01:n3',
      'c-stage1-01:n4'
    ])
  })

  it('普通题够时，卷子正好 LESSON_PRACTICE_SIZE 道、一道挑战都不混', () => {
    const normal = [1, 2, 3, 4, 5, 6].map((i) => choice(`n${i}`))
    const chall = [1, 2].map((i) => choice(`c${i}`, 'challenge'))
    const { quiz, startLessonPractice } = start()
    startLessonPractice(lesson('c-stage1-01', [...normal, ...chall]))

    const s = quiz.session!
    expect(s.questions).toHaveLength(LESSON_PRACTICE_SIZE)
    for (const q of s.questions) expect(isChallenge(q), q.id).toBe(false)
  })

  it('★ 一道普通题都没有 → 不发卷（和"还没练习题"同一句提示，不悄悄开一张空卷）', () => {
    const chall = [1, 2].map((i) => choice(`c${i}`, 'challenge'))
    const { quiz, startLessonPractice } = start()
    startLessonPractice(lesson('c-stage1-01', chall))

    expect(quiz.session).toBeNull()
    expect(toasts.at(-1)?.text).toBe(TOAST.LESSON_HAS_NO_QUIZ)
    expect(toasts.at(-1)?.type).toBe('warn')
  })

  it('没有挑战题时行为不变（回归）：mode / lessonId / 题数全对', () => {
    const qs = [1, 2, 3, 4, 5, 6, 7].map((i) => choice(`q${i}`))
    const l = lesson('c-stage1-01', qs)
    const { quiz, startLessonPractice } = start()
    startLessonPractice(l)

    const s = quiz.session!
    expect(s.mode).toBe('lesson')
    expect(s.lessonId).toBe('c-stage1-01')
    expect(s.questions).toHaveLength(LESSON_PRACTICE_SIZE)
    expect(s.keys).toHaveLength(LESSON_PRACTICE_SIZE)
    // 按 id 比，不按引用：buildPaper 会为洗选项产生**浅拷贝**（原题对象不动），
    // 这是它该有的行为 —— 拿引用比会红，而红的不是它。
    const ids = l.questions.map((x) => x.id)
    for (const q of s.questions) expect(ids, q.id).toContain(q.id)
    for (const k of s.keys) expect(k.startsWith('c-stage1-01:')).toBe(true)
  })

  it('lesson 为 null / undefined → 提示 + 不发卷（过滤器没有碰坏这道门槛）', () => {
    const { quiz, startLessonPractice } = start()
    startLessonPractice(null)
    expect(quiz.session).toBeNull()
    expect(toasts.at(-1)?.text).toBe(TOAST.LESSON_HAS_NO_QUIZ)
    startLessonPractice(undefined)
    expect(quiz.session).toBeNull()
    expect(toasts.at(-1)?.text).toBe(TOAST.LESSON_HAS_NO_QUIZ)
  })
})
