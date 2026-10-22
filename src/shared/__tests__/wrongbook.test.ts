/**
 * 错题条目 → 题目本体（shared/wrongbook.ts）
 *
 * 【这个文件在守什么】
 * 「这道题去哪找」只有一个正确答案，而错题本里有**两个**调用点：
 * 列表显示题干、点「再练一次」组卷。两处都得走这一个函数。
 *
 * 各写一遍的话，一处改了一处没改，表现是「列表里有这道题、点重做却把它跳过了」——
 * 不报错，用户只会觉得「这软件有点怪」。
 *
 * 同样要紧的是**判据用哪个字段**：必须用 key 的题号前缀，不能看有没有 `ai` 字段。
 * 那条规则错了的代价见下面最后一条用例。
 */

import { describe, expect, it, vi } from 'vitest'
import { isAiEntry, resolveWrongQuestion } from '../wrongbook'
import type { Question, WrongBookEntry } from '../types'

function q(id: string, stem: string): Question {
  return { id, type: 'fill', stem, answer: 'x', explanation: '解析' }
}

function entry(key: string, over: Partial<WrongBookEntry> = {}): WrongBookEntry {
  const sep = key.indexOf(':')
  return {
    key,
    lessonId: key.slice(0, sep),
    qid: key.slice(sep + 1),
    wrongCount: 1,
    lastWrongAt: '2026-09-13T10:00:00.000Z',
    cleared: false,
    ...over
  }
}

/** 一个只有 common-01 有内容的内容包 */
function findBuiltIn(lessonId: string, qid: string): Question | null {
  if (lessonId !== 'common-01') return null
  return qid === 'q1' ? q('q1', '内置第一题') : null
}

describe('resolveWrongQuestion：内置题去内容包找，AI 题用自带的本体', () => {
  it('内置题：走 findBuiltIn，拿回内容包里那份', () => {
    const got = resolveWrongQuestion(entry('common-01:q1'), findBuiltIn)
    expect(got?.stem).toBe('内置第一题')
  })

  it('内置题但内容包里没有（题被移走了）→ null，交给调用方跳过', () => {
    expect(resolveWrongQuestion(entry('common-01:q99'), findBuiltIn)).toBeNull()
  })

  it('AI 题：用条目自带的本体', () => {
    const e = entry('common-01:ai-2026-09-13-1', { ai: q('ai-2026-09-13-1', 'AI 出的题') })
    expect(resolveWrongQuestion(e, findBuiltIn)?.stem).toBe('AI 出的题')
  })

  it('**AI 题不去碰 findBuiltIn，哪怕它的课号是真的**', () => {
    // AI 题的 lessonId 是它的宿主课（「这题考的是哪一课」），拿它按题号去
    // 内容包里找是白跑一趟；万一哪天内置题里真出现了同号的题，
    // 会**拿错题顶上**，而用户看不出区别 —— 那是最难查的一类错
    const spy = vi.fn(findBuiltIn)
    const e = entry('common-01:ai-2026-09-13-1', { ai: q('ai-2026-09-13-1', 'AI 出的题') })
    resolveWrongQuestion(e, spy)
    expect(spy).not.toHaveBeenCalled()
  })

  it('AI 题本体丢了 → null，**绝不回退去内容包里瞎找**', () => {
    const spy = vi.fn(findBuiltIn)
    expect(resolveWrongQuestion(entry('common-01:ai-2026-09-13-1'), spy)).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('**判据是 key，不是「有没有 ai 字段」**', () => {
    // 万一哪天存进来一条内置题却带着 ai 字段（上游 bug、或者手改的文件），
    // 它仍然该去内容包找 —— 内容包那份才是真的，条目里那份可能是旧的。
    // 反过来看更清楚：拿一个「可能缺的字段」当判据，
    // 缺的那天就会把 AI 题误当成内置题，转而去内容包里瞎找
    const polluted = entry('common-01:q1', { ai: q('q1', '条目里夹带的旧副本') })
    expect(resolveWrongQuestion(polluted, findBuiltIn)?.stem).toBe('内置第一题')
  })
})

describe('isAiEntry：列表要据此打「🐟 AI 出的」标', () => {
  it('AI 题认得出来', () => {
    expect(isAiEntry(entry('common-01:ai-2026-09-13-1'))).toBe(true)
  })

  it('内置题不会被误标', () => {
    expect(isAiEntry(entry('common-01:q1'))).toBe(false)
  })

  it('课号里带 ai 字样不算 —— 只看冒号后面那段', () => {
    // 将来真有门课叫 ai-01 的话，它的内置题不该被打上「AI 出的」标
    expect(isAiEntry(entry('ai-01:q3'))).toBe(false)
    expect(isAiEntry(entry('ai-01:ai-2026-09-13-2'))).toBe(true)
  })
})
