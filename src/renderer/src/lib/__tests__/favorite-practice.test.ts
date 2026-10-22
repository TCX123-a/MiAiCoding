/**
 * 收藏练习的启动器（src/renderer/src/lib/favorite-practice.ts）。
 *
 * 【这个文件在守什么】
 * 开局这一下能悄悄错掉的地方：
 *   · keys 必须来自**每题自己的宿主课**，绝不能是 `__fav__:xxx` 哨兵垃圾
 *     （不然答错往错题本灌垃圾条目、答对永远消除不掉 —— quiz.ts 的 restart
 *      注释里记着同型 bug 的现场）；
 *   · 题目和 keys 必须**同一次挑选**产生（只洗一边 = 键错位 = 错的题记到别人头上）；
 *   · 挑战题不许混进这张卷子（它们只在阶段练习/每日挑战里出，见 §3.3）；
 *   · 少给了几道必须**说出来**，且三种原因（挑战题 / 找不到 / 都有）不许合并成
 *     一句含糊的话 —— 用户得知道是该去阶段练习找它，还是该把这条收藏删了。
 *
 * 内容查找走注入（FavoriteQuestionDeps）：不啃真内容包，
 * 断言也就不依赖"真内容此刻长什么样"。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useFavoriteStarter } from '../favorite-practice'
import { useQuizStore } from '../../stores/quiz'
import { stubMiai } from '../../stores/__tests__/miai-stub'
import { toasts } from '../../components/base/toast'
import { TOAST } from '../copy'
import type { Difficulty, FavoriteItem, Question } from '../../../../shared/types'

/**
 * 造一道选择题。`over` 只收 `difficulty` —— 本文件只用它造挑战题。
 * 【为什么不写 `Partial<Question>`】`Question` 是六种题型的联合，
 * `Partial<Question>` 会把 `answer` 摊成 `string | number | undefined`
 * （填空题的答案是字符串），展开之后类型就崩了（vue-tsc 会报错）。
 * 需求写成"我到底要用什么"，这个坑就不存在。
 */
function choice(id: string, over: { difficulty?: Difficulty } = {}): Question {
  return {
    id,
    type: 'choice',
    stem: `stem-${id}`,
    options: ['a', 'b', 'c'],
    answer: 0,
    explanation: 'e',
    ...over
  }
}

function fav(key: string, over: Partial<FavoriteItem> = {}): FavoriteItem {
  const [lessonId, qid] = key.split(':')
  return { key, lessonId, qid, addedAt: '2026-09-29T00:00:00.000Z', source: 'lesson', ...over }
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

describe('startFavorites：收藏练习开局', () => {
  it('★ keys 全部来自每题自己的宿主课（一条 __fav__ 哨兵都不许有）', () => {
    const quiz = useQuizStore()
    const { startFavorites } = useFavoriteStarter()
    const n = startFavorites([fav('c-stage1-01:q1'), fav('c-stage1-02:q3')], deps)

    const s = quiz.session!
    expect(n).toBe(2)
    expect(s.mode).toBe('fav')
    expect(s.lessonId).toBe('__fav__')
    expect(s.questions).toHaveLength(2)
    for (const k of s.keys) expect(k.startsWith('__fav__:')).toBe(false)
    expect([...s.keys].sort()).toEqual(['c-stage1-01:q1', 'c-stage1-02:q3'])
    expect(toasts.at(-1)?.text).toBe(TOAST.favoriteStarted(2))
    expect(toasts.at(-1)?.type).toBe('success')
  })

  it('★ questions 与 keys 一一对应：keys[i] 正是 questions[i] 那道题的键', () => {
    const quiz = useQuizStore()
    const { startFavorites } = useFavoriteStarter()
    startFavorites(
      [fav('c-stage1-01:q1'), fav('c-stage1-01:q2'), fav('c-stage1-02:q3'), fav('c-stage1-02:q4')],
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

  it('AI 题用自带的本体开局，键仍是它自己的（宿主课 + AI 题号）', () => {
    const quiz = useQuizStore()
    const { startFavorites } = useFavoriteStarter()
    const ai = fav('c-stage1-01:ai-2026-09-29-1', { ai: choice('ai-2026-09-29-1'), source: 'challenge' })
    startFavorites([ai], deps)

    const s = quiz.session!
    expect(s.questions[0].id).toBe('ai-2026-09-29-1')
    expect(s.keys).toEqual(['c-stage1-01:ai-2026-09-29-1'])
    // AI 题不该去内容包里翻（翻也翻不到，而且万一撞号会拿错题顶上）
    expect(toasts.at(-1)?.text).toBe(TOAST.favoriteStarted(1))
  })

  it('★ 挑战题不进收藏练习，而且如实说"它是挑战题"（不是"找不到"）', () => {
    const quiz = useQuizStore()
    const { startFavorites } = useFavoriteStarter()
    const boss = fav('c-stage1-01:q1', {})
    // 同一道题，标成挑战 —— 走的是同一个 key、同一份内容
    builtIn['c-stage1-01'] = [choice('q1', { difficulty: 'challenge' }), choice('q2')]
    try {
      startFavorites([boss, fav('c-stage1-01:q2')], deps)
      const s = quiz.session!
      expect(s.keys).toEqual(['c-stage1-01:q2'])
      expect(toasts.at(-1)?.text).toBe(TOAST.favoritesSkipped(1, 0, 1))
      expect(toasts.at(-1)?.type).toBe('warn')
    } finally {
      builtIn['c-stage1-01'] = [choice('q1'), choice('q2')]
    }
  })

  it('一条都找不到 → 不开空卷，报"找不到了"', () => {
    const quiz = useQuizStore()
    const { startFavorites } = useFavoriteStarter()
    expect(startFavorites([fav('c-stage9-99:q1')], deps)).toBe(0)
    expect(quiz.session).toBeNull()
    expect(toasts.at(-1)?.text).toBe(TOAST.FAVORITES_BROKEN)
  })

  it('★ 挑的全是挑战题 → 说的必须是"挑战题"，不能诬赖成"找不到了"', () => {
    const quiz = useQuizStore()
    const { startFavorites } = useFavoriteStarter()
    builtIn['c-stage1-02'] = [choice('q3', { difficulty: 'challenge' })]
    try {
      expect(startFavorites([fav('c-stage1-02:q3')], deps)).toBe(0)
      expect(quiz.session).toBeNull()
      expect(toasts.at(-1)?.text).toBe(TOAST.FAVORITES_ALL_CHALLENGE)
      // 那几句里不许出现"找不到"的说法 —— 题好好地在本机
      expect(toasts.at(-1)?.text).not.toContain('找不到')
    } finally {
      builtIn['c-stage1-02'] = [choice('q3'), choice('q4')]
    }
  })

  it('两种缺料同时出现：一句话里两个原因都点名', () => {
    const quiz = useQuizStore()
    const { startFavorites } = useFavoriteStarter()
    builtIn['c-stage1-01'] = [choice('q1', { difficulty: 'challenge' }), choice('q2')]
    try {
      startFavorites([fav('c-stage1-01:q1'), fav('c-stage1-01:q2'), fav('gone-01:q7')], deps)
      expect(quiz.session!.keys).toEqual(['c-stage1-01:q2'])
      const msg = toasts.at(-1)?.text ?? ''
      expect(msg).toBe(TOAST.favoritesSkipped(1, 1, 1))
      expect(msg).toContain('挑战题')
      expect(msg).toContain('找不到')
    } finally {
      builtIn['c-stage1-01'] = [choice('q1'), choice('q2')]
    }
  })

  it('空清单：不生造一张空卷，也不无话找话', () => {
    const quiz = useQuizStore()
    const { startFavorites } = useFavoriteStarter()
    expect(startFavorites([], deps)).toBe(0)
    expect(quiz.session).toBeNull()
    // 没发生任何事，就不该弹"没带进卷子"那类话（那是给**选了几道**的人看的）
    expect(toasts).toHaveLength(0)
  })
})
