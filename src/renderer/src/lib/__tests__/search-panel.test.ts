/**
 * 搜索面板的巡回模型（src/renderer/src/lib/search-panel.ts）。
 *
 * 【这个文件在守什么】
 * 计划 §10.5 点名的"最大易漏点"：面板加了「练相关题」这**第二个动作**之后，
 * ↑↓ 必须能走到它。判据只有一条，但要钉死：**练题入口在动作清单里**
 * （清单就是 activeIndex 的巡回范围 —— 不在清单里 = 键盘党永远够不到），
 * 而且顺序是"课程在前、练题最后"（面板模板按下标对 active class，顺序漂了
 * 高亮就错行）。另外就是环绕算术本身：两端回绕、空清单不炸。
 */
import { describe, expect, it } from 'vitest'
import { moveActive, searchActions } from '../search-panel'
import type { QuestionSearchHit } from '../../../../shared/search'
import type { QuestionIndexItem } from '../../../../shared/question-index'
import type { SearchEntry } from '../../../../shared/types'

function res(id: string): SearchEntry {
  return { id, lang: 'common', stage: 1, title: `课-${id}`, tags: [], keywords: [], text: '' }
}

function hit(key: string): QuestionSearchHit {
  const item: QuestionIndexItem = {
    key,
    lessonId: key.split(':')[0],
    lang: 'common',
    stage: 1,
    type: 'choice',
    difficulty: 'easy',
    tags: [],
    stem: `题干-${key}`
  }
  return { item, score: 2 }
}

describe('searchActions：可被 ↑↓ 走到的动作清单', () => {
  it('★ 练题入口在清单里，且排在课程结果之后 —— 键盘党够得到它', () => {
    const actions = searchActions(
      [{ entry: res('a'), score: 3, snippet: 'a' }, { entry: res('b'), score: 1, snippet: 'b' }],
      [hit('a:q1'), hit('b:q1'), hit('b:q2')]
    )
    expect(actions.map((a) => a.kind)).toEqual(['lesson', 'lesson', 'practice'])
    expect(actions[0].kind === 'lesson' && actions[0].result.entry.id).toBe('a')
    expect(actions[1].kind === 'lesson' && actions[1].result.entry.id).toBe('b')
    expect(actions[2].kind === 'practice' && actions[2].count).toBe(3)
  })

  it('没有题目命中 → 清单里没有练题项（搜不到就不摆假按钮）', () => {
    const actions = searchActions([{ entry: res('a'), score: 3, snippet: 'a' }], [])
    expect(actions.map((a) => a.kind)).toEqual(['lesson'])
  })

  it('只有题目命中（课程一路为空）→ 清单里就一项练题（它照样能被 Enter 到）', () => {
    const actions = searchActions([], [hit('a:q1')])
    expect(actions).toHaveLength(1)
    expect(actions[0]).toEqual({ kind: 'practice', count: 1 })
  })

  it('两路都空 → 空清单', () => {
    expect(searchActions([], [])).toEqual([])
  })
})

describe('moveActive：↑↓ 一格 + 两端环绕', () => {
  it('普通前进 / 后退', () => {
    expect(moveActive(0, 1, 3)).toBe(1)
    expect(moveActive(2, -1, 3)).toBe(1)
  })

  it('两端回绕：最后一行再往下是第一行，第一行再往上是最后一行', () => {
    expect(moveActive(2, 1, 3)).toBe(0)
    expect(moveActive(0, -1, 3)).toBe(2)
  })

  it('只有一项 / 空清单都不炸（空清单恒回 0，别让调用方各自防 %0）', () => {
    expect(moveActive(0, 1, 1)).toBe(0)
    expect(moveActive(0, -1, 1)).toBe(0)
    expect(moveActive(5, 1, 0)).toBe(0)
    expect(moveActive(5, -1, 0)).toBe(0)
  })
})
