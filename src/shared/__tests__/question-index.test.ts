/**
 * 运行时题目索引（src/shared/question-index.ts）—— 构建、筛选、放宽取题。
 *
 * 【这个文件在守什么】
 * 索引是七个练习入口（收藏 / 复习 / 延展 / 搜索 / 阶段卷…）共同的取题底座。
 * 它坏掉的方式：
 *   · key 拼错（少了冒号、拿课号当 key）—— 错题本/收藏从此对不上任何题；
 *   · 难度没解析就塞进条目 —— 筛选"困难"筛出来的是原始字段，全空；
 *   · 放宽取题把 challenge 放进来 —— 挑战题从后门溜进普通练习（§3.3 明令禁止）；
 *   · 取题凑不满时复制同一道题 —— 学员同一道题做两遍还以为是两道。
 */
import { describe, expect, it } from 'vitest'
import {
  buildQuestionIndex,
  filterIndex,
  indexByKey,
  selectWithRelaxation
} from '../question-index'
import type { Difficulty, Lang, Lesson, Question, QuestionType, Stage } from '../types'

function q(id: string, type: QuestionType, over: Record<string, unknown> = {}): Question {
  const base: Record<string, unknown> = { id, type, stem: `stem-${id}`, ...over }
  switch (type) {
    case 'choice':
      return { options: ['a', 'b'], answer: 0, explanation: 'e', ...base } as Question
    case 'fill':
      return { answer: 'x', explanation: 'e', ...base } as Question
    case 'code':
      return { lang: 'c', code: 'c', answer: '0', explanation: 'e', ...base } as Question
    case 'codefill':
      return { lang: 'c', code: '____', blanks: [{ answer: 'x' }], explanation: 'e', ...base } as Question
    case 'codefix':
      return { lang: 'c', brokenCode: 'b', expectedOutput: '0', referenceFix: 'r', explanation: 'e', ...base } as Question
    case 'codewrite':
      return { lang: 'c', expectedOutput: '0', referenceSolution: 'r', explanation: 'e', ...base } as Question
  }
}

function lesson(
  id: string,
  lang: Lang,
  stage: Stage,
  tags: string[],
  questions: Question[]
): Lesson {
  return {
    id,
    lang,
    stage,
    order: 1,
    title: `title-${id}`,
    tags,
    required: [],
    crossRefs: [],
    compare: [],
    estMinutes: 5,
    keywords: [],
    body: '',
    questions
  }
}

// ---------------------------------------------------------------- 构建

describe('buildQuestionIndex：从内容包构建一份轻档案', () => {
  const lessons = [
    lesson('c-stage1-01', 'c', 1, ['变量', 'printf'], [q('q1', 'choice'), q('q2', 'code')]),
    lesson('c-stage3-09', 'c', 3, ['链表'], [q('q1', 'codefix')])
  ]

  it('key = 课号:题号（和错题本/收藏/练习史同一套全局键）', () => {
    const idx = buildQuestionIndex(lessons)
    expect(idx.map((x) => x.key)).toEqual([
      'c-stage1-01:q1',
      'c-stage1-01:q2',
      'c-stage3-09:q1'
    ])
  })

  it('★ 难度是**解析后**的值：codefix 三阶段得 hard，条目里不残留原始字段的 undefined', () => {
    const idx = buildQuestionIndex(lessons)
    expect(idx.map((x) => x.difficulty)).toEqual(['easy', 'medium', 'hard'])
    for (const it of idx) expect(it.difficulty, it.key).toBeTruthy()
  })

  it('宿主信息（课号/语言/阶段/标签/题型/题干）全部带上', () => {
    const it = buildQuestionIndex(lessons)[0]
    expect(it).toMatchObject({
      lessonId: 'c-stage1-01',
      lang: 'c',
      stage: 1,
      type: 'choice',
      tags: ['变量', 'printf'],
      stem: 'stem-q1'
    })
  })

  it('空输入 / 空题目 → 空索引（不抛）', () => {
    expect(buildQuestionIndex([])).toEqual([])
    expect(buildQuestionIndex([lesson('x', 'c', 1, [], [])])).toEqual([])
  })

  it('不改动传进来的课列表（题目一个都不许动）', () => {
    const snapshot = JSON.parse(JSON.stringify(lessons))
    buildQuestionIndex(lessons)
    expect(lessons).toEqual(snapshot)
  })
})

describe('indexByKey：按全局键查条目（收藏页/错题本每行查一次的那张表）', () => {
  const idx = buildQuestionIndex([
    lesson('c-stage1-01', 'c', 1, [], [q('q1', 'choice'), q('q2', 'code')]),
    lesson('python-03', 'python', 1, [], [q('q1', 'fill')])
  ])

  it('查得到，而且给回来的正是同一条（不是复制件）', () => {
    const map = indexByKey(idx)
    expect(map.get('c-stage1-01:q1')).toBe(idx[0])
    expect(map.get('python-03:q1')?.lang).toBe('python')
  })

  it('查不到就是 undefined —— 调用方据此判「本机没有这道题」，**不猜默认值**', () => {
    const map = indexByKey(idx)
    expect(map.get('c-stage9-99:q1')).toBeUndefined()
  })

  it('空索引 → 空表（不抛）', () => {
    expect(indexByKey([]).size).toBe(0)
  })
})

// ---------------------------------------------------------------- 筛选

describe('filterIndex：按语言/阶段/难度/题型/标签筛', () => {
  const idx = buildQuestionIndex([
    lesson('c-1', 'c', 1, ['指针', '数组'], [q('q1', 'choice'), q('q2', 'codefix')]),
    lesson('py-1', 'python', 1, ['列表'], [q('q1', 'choice')]),
    lesson('c-3', 'c', 3, ['指针', '链表'], [q('q1', 'codewrite')])
  ])

  it('按语言', () => {
    expect(filterIndex(idx, { lang: 'python' }).map((x) => x.key)).toEqual(['py-1:q1'])
  })

  it('按阶段（stage 是数字 1 / 3，不是字符串）', () => {
    expect(filterIndex(idx, { stage: 3 }).map((x) => x.key)).toEqual(['c-3:q1'])
  })

  it('按难度：单值和一组都行', () => {
    expect(filterIndex(idx, { difficulty: 'easy' }).map((x) => x.key)).toEqual(['c-1:q1', 'py-1:q1'])
    expect(filterIndex(idx, { difficulty: ['easy', 'hard'] }).map((x) => x.key)).toEqual([
      'c-1:q1',
      'py-1:q1',
      'c-3:q1'
    ])
  })

  it('按题型：单值和一组都行', () => {
    expect(filterIndex(idx, { type: 'choice' }).map((x) => x.key)).toEqual(['c-1:q1', 'py-1:q1'])
    expect(filterIndex(idx, { type: ['codefix', 'codewrite'] }).map((x) => x.key)).toEqual([
      'c-1:q2',
      'c-3:q1'
    ])
  })

  it('★ 标签是 AND：两个标签都要在身上', () => {
    expect(filterIndex(idx, { tags: ['指针'] }).map((x) => x.key)).toEqual([
      'c-1:q1',
      'c-1:q2',
      'c-3:q1'
    ])
    // 指针 ∩ 链表 只有 c-3
    expect(filterIndex(idx, { tags: ['指针', '链表'] }).map((x) => x.key)).toEqual(['c-3:q1'])
    // 不存在的标签 → 空
    expect(filterIndex(idx, { tags: ['不存在'] })).toEqual([])
  })

  it('多条件是 AND；没有任何条件 → 全量', () => {
    expect(filterIndex(idx, { lang: 'c', difficulty: 'hard' }).map((x) => x.key)).toEqual(['c-3:q1'])
    expect(filterIndex(idx, {})).toHaveLength(idx.length)
  })

  it('筛不出来就是空数组（不是 null、不是抛）', () => {
    expect(filterIndex(idx, { lang: 'java' })).toEqual([])
  })

  it('★ 不改原索引（返回的是新数组）', () => {
    const before = [...idx]
    filterIndex(idx, { lang: 'c' })
    expect(idx).toEqual(before)
  })
})

// ---------------------------------------------------------------- 放宽取题

describe('selectWithRelaxation：按目标难度取题、不够按邻近放宽', () => {
  /** 用 `难度#序号` 字符串当题，断言里直接可比 */
  const dOf = (s: string) => s.split('#')[0] as Difficulty

  it('目标难度够：全是目标难度、数量正好 size', () => {
    const pool = ['medium#1', 'medium#2', 'medium#3', 'easy#9']
    const got = selectWithRelaxation(pool, dOf, 'medium', 2)
    expect(got).toHaveLength(2)
    for (const s of got) expect(dOf(s)).toBe('medium')
  })

  it('目标难度一道都没有：按 relaxOrder 放宽（★ medium 先拿 easy 再拿 hard）', () => {
    const pool = ['easy#1', 'hard#1', 'hard#2']
    const got = selectWithRelaxation(pool, dOf, 'medium', 2)
    // 顺序由桶序决定（easy 桶在 hard 桶前面），不是洗牌结果
    expect(got[0]).toBe('easy#1')
    expect(dOf(got[1])).toBe('hard')
  })

  it('★ challenge 不从后门进：目标不是挑战时，池子里只剩挑战题也不选它', () => {
    const pool = ['challenge#1', 'challenge#2', 'easy#1']
    const got = selectWithRelaxation(pool, dOf, 'easy', 5)
    expect(got).toEqual(['easy#1'])
    // 池子清一色挑战题 → 一道都取不出来（返回空，而不是"凑合给你挑战题"）
    expect(selectWithRelaxation(['challenge#1'], dOf, 'easy', 3)).toEqual([])
  })

  it('★ 目标就是 challenge 时它排第一，后面才放宽到 hard', () => {
    const pool = ['challenge#1', 'hard#1']
    expect(selectWithRelaxation(pool, dOf, 'challenge', 1)).toEqual(['challenge#1'])
    expect(selectWithRelaxation(pool, dOf, 'challenge', 2)).toEqual(['challenge#1', 'hard#1'])
  })

  it('★ 绝不重复：池子比 size 小就给全部，不复制题凑数', () => {
    const pool = ['easy#1', 'easy#2', 'easy#3']
    const got = selectWithRelaxation(pool, dOf, 'easy', 99)
    expect(got).toHaveLength(3)
    expect(new Set(got).size).toBe(3)
  })

  it('放宽到多档时也不重复（每道题只属于一个难度桶）', () => {
    const pool = ['easy#1', 'easy#2', 'hard#1', 'medium#1']
    const got = selectWithRelaxation(pool, dOf, 'hard', 4)
    expect(new Set(got).size).toBe(4)
    expect([...got].sort()).toEqual(['easy#1', 'easy#2', 'hard#1', 'medium#1'])
  })

  it('size 为 0 / 负数 → 空数组', () => {
    expect(selectWithRelaxation(['easy#1'], dOf, 'easy', 0)).toEqual([])
    expect(selectWithRelaxation(['easy#1'], dOf, 'easy', -3)).toEqual([])
  })

  it('rng 可注入：同一份 rng 跑两次结果一样（测试里才钉得住"取出来的就是这几道"）', () => {
    const pool = ['easy#1', 'easy#2', 'easy#3', 'easy#4']
    const rng = () => 0.42
    const a = selectWithRelaxation(pool, dOf, 'easy', 3, rng)
    const b = selectWithRelaxation(pool, dOf, 'easy', 3, () => 0.42)
    expect(a).toEqual(b)
    expect(new Set(a).size).toBe(3)
  })

  it('不改动传进来的池子', () => {
    const pool = ['easy#1', 'easy#2']
    const snapshot = [...pool]
    selectWithRelaxation(pool, dOf, 'easy', 1)
    expect(pool).toEqual(snapshot)
  })
})
