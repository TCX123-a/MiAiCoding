/**
 * 关窗拦截的纯判定（2026-11-01）。
 *
 * 【为什么值得单测】主人点名的三条分支恰好是三种「写反了也看着像对的」：
 *   · 已绿的课还弹窗 = 烦人，但功能「在」；
 *   · 学了一半不弹 = 主人看到的「关闭拦截失效」；
 *   · 切到设置页后再关 = 用 pending 判就永远不弹（pending 只在滚到底时才有）。
 * 这三条靠手点要先把课读一半、再切页、再关窗，成本高且容易漏。
 */
import { describe, expect, it } from 'vitest'
import { lessonPathLabel, pickCloseLesson } from '../close-guard'
import type { Lesson } from '../../../../shared/types'

const ALL = new Set(['c-01', 'c-02', 'c-03'])
const settleable = (id: string): boolean => ALL.has(id)

function pick(input: {
  last?: string | null
  pending?: string | null
  learned?: string[]
}) {
  const learned = new Set(input.learned ?? [])
  return pickCloseLesson({
    lastLessonId: input.last ?? null,
    pendingSettleId: input.pending ?? null,
    isLearned: (id) => learned.has(id),
    isSettleable: settleable
  })
}

describe('pickCloseLesson：当前课绿了就直接放行', () => {
  it('最后一课已绿、也没有待结算 → null（不弹）', () => {
    expect(pick({ last: 'c-02', learned: ['c-01', 'c-02'] })).toBeNull()
  })

  it('最后一课已绿，但还有一笔待结算课没绿 → 仍然拦那笔账', () => {
    expect(pick({ last: 'c-02', pending: 'c-03', learned: ['c-02'] })).toBe('c-03')
  })
})

describe('pickCloseLesson：学了一半 / 切到别的页面都要拦', () => {
  it('最后一课没绿、没 pending（只读了一半）→ 拦它', () => {
    expect(pick({ last: 'c-02' })).toBe('c-02')
  })

  it('用户已经切到设置页：last 仍记着 → 照样拦', () => {
    // 这个用例就是主人实测「拦截失效」的那条：没有 pending，只有 last
    expect(pick({ last: 'c-03', learned: ['c-01', 'c-02'] })).toBe('c-03')
  })

  it('last 和 pending 都指向同一课 → 只拦一次', () => {
    expect(pick({ last: 'c-02', pending: 'c-02' })).toBe('c-02')
  })
})

describe('pickCloseLesson：坏课号与草稿课', () => {
  it('last 是草稿/坏课号 → 退到 pending', () => {
    expect(pick({ last: 'draft-x', pending: 'c-02' })).toBe('c-02')
  })

  it('两个都不可结算 → null（草稿课没有「学到这里啦喵」，不能弹）', () => {
    expect(pick({ last: 'draft-x', pending: 'draft-y' })).toBeNull()
  })

  it('最后一课绿了、pending 是草稿 → null', () => {
    expect(pick({ last: 'c-03', pending: 'draft-x', learned: ['c-03'] })).toBeNull()
  })
})

function lesson(over: Partial<Lesson> = {}): Lesson {
  return {
    id: 'c-02',
    lang: 'c',
    stage: 1,
    order: 2,
    title: '变量与小鱼干仓库',
    tags: [],
    required: [],
    crossRefs: [],
    compare: [],
    estMinutes: 10,
    keywords: [],
    body: '',
    questions: [],
    ...over
  }
}

describe('lessonPathLabel：弹窗里那句课名', () => {
  it('用语言·阶段·课序·课名拼，和侧栏能对上', () => {
    expect(lessonPathLabel(lesson())).toBe('C · 入门 · 第 2 课：变量与小鱼干仓库')
  })

  it('找不到正文时退回大纲课名', () => {
    expect(lessonPathLabel(undefined, '变量与小鱼干仓库')).toBe('变量与小鱼干仓库')
  })

  it('连课名都没有 → 一句兜底，不留空括号', () => {
    expect(lessonPathLabel(undefined, '   ')).toBe('这一课')
  })
})
