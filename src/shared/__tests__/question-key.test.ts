/**
 * 题目全局键（shared/question-key.ts）
 *
 * 这个文件的重点是**往返**：拼出来再拆回去，必须还原成原来的两个 id。
 * 因为这两个函数在项目里是分开用的 —— 渲染进程拼（写进错题本），
 * 主进程拆（读出来落库）—— 一旦两者对不上，错题本会「存得进去、查不出来」，
 * 而且**不报错**，只是安静地什么都不匹配。往返测试正好钉住这条。
 */

import { describe, expect, it } from 'vitest'
import { isAiKey, isAiQid, parseQuestionKey, questionKey } from '../question-key'

describe('questionKey：拼', () => {
  it('用真实 id 形状拼（课 common-01 + 题 q1）', () => {
    expect(questionKey('common-01', 'q1')).toBe('common-01:q1')
    expect(questionKey('python-03', 'q7')).toBe('python-03:q7')
  })

  it('AI 出的题也走这里，命名空间靠 qid 前缀隔开', () => {
    expect(questionKey('common-01', 'ai-2026-09-13-1')).toBe('common-01:ai-2026-09-13-1')
  })
})

describe('parseQuestionKey：拆', () => {
  it('拆得回原来的两个 id', () => {
    expect(parseQuestionKey('common-01:q1')).toEqual({ lessonId: 'common-01', qid: 'q1' })
  })

  it('按**第一个**冒号切 —— 题 id 自己带冒号也能活', () => {
    expect(parseQuestionKey('common-01:a:b')).toEqual({ lessonId: 'common-01', qid: 'a:b' })
  })

  it('课 id 带冒号时会切坏，但这是**已知且接受**的行为（当前课 id 形状不带冒号）', () => {
    // 这条不是「期望的行为」，是「记录下来的现状」：真改成 lang:c:01 这种命名时，
    // 这条会提醒你必须同时改 questionKey 的口径，而不是只改一边。
    expect(parseQuestionKey('lang:c:01:q1')).toEqual({ lessonId: 'lang', qid: 'c:01:q1' })
  })

  it('没有冒号的脏数据：整个键当课 id，题 id 给空串', () => {
    // 保持和主进程原有行为一致（main/index.ts 原来的 sep === -1 分支），
    // 不偷偷改变已有数据的含义
    expect(parseQuestionKey('common-01')).toEqual({ lessonId: 'common-01', qid: '' })
    expect(parseQuestionKey('')).toEqual({ lessonId: '', qid: '' })
  })

  it('冒号在最前面：课 id 是空串（同样是记录现状，不抛错）', () => {
    expect(parseQuestionKey(':q1')).toEqual({ lessonId: '', qid: 'q1' })
  })
})

describe('isAiQid / isAiKey：错题本收不收这道题', () => {
  it('ai- 开头判为 AI 题', () => {
    expect(isAiQid('ai-2026-09-13-1')).toBe(true)
    expect(isAiQid('ai-1')).toBe(true)
  })

  it('内置题号 q1..q7 不是 AI 题', () => {
    for (let i = 1; i <= 7; i++) expect(isAiQid(`q${i}`)).toBe(false)
    expect(isAiQid('')).toBe(false)
  })

  it('相似前缀不误判 —— 前缀必须够具体', () => {
    // 这几条是反向验证：如果哪天有人图省事把判定写成 startsWith('a')，
    // 它们会立刻变红。误判的代价是**该收的错题被丢掉**，比误收更难发现。
    expect(isAiQid('a1')).toBe(false)
    expect(isAiQid('air-1')).toBe(false)
    expect(isAiQid('AI-1')).toBe(false) // 大小写敏感，AI 题的 id 一律小写
  })

  it('isAiKey 看的是题号那一段，不是整串', () => {
    expect(isAiKey(questionKey('common-01', 'ai-2026-09-13-1'))).toBe(true)
    expect(isAiKey(questionKey('common-01', 'q1'))).toBe(false)
  })

  it('课号里带 ai 字样不影响判定（只看冒号后面那段）', () => {
    // 万一将来有门课叫 ai-01，它的内置题仍然该进错题本
    expect(isAiKey(questionKey('ai-01', 'q3'))).toBe(false)
    expect(isAiKey(questionKey('ai-01', 'ai-2026-09-13-2'))).toBe(true)
  })

  it('脏数据一律不算 AI 题（宁可收进来，也不要静默丢掉真错题）', () => {
    expect(isAiKey('')).toBe(false)
    expect(isAiKey('没有冒号的脏键')).toBe(false)
    expect(isAiKey('common-01:')).toBe(false)
  })
})

describe('往返：拼了再拆必须还原', () => {
  it('真实 id 形状', () => {
    const cases: [string, string][] = [
      ['common-01', 'q1'],
      ['common-01', 'q7'],
      ['c-12', 'q3'],
      ['java-08', 'ai-2026-09-13-2']
    ]
    for (const [lessonId, qid] of cases) {
      expect(parseQuestionKey(questionKey(lessonId, qid))).toEqual({ lessonId, qid })
    }
  })

  it('同一个题 id 在不同的课里，键**不同** —— 这正是要全局键的原因', () => {
    // q1 这门课有、那门课也有。只存 q1 会指到别的题上去
    expect(questionKey('common-01', 'q1')).not.toBe(questionKey('common-02', 'q1'))
    // 而且拆出来的课 id 确实是各自的课
    expect(parseQuestionKey(questionKey('common-02', 'q1')).lessonId).toBe('common-02')
  })
})
