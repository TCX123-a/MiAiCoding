import { describe, expect, it } from 'vitest'
import { SEARCH_QUIZ_MAX, searchEntries, searchQuestions } from '../search'
import type { SearchEntry } from '../types'
import type { QuestionIndexItem } from '../question-index'

function entry(partial: Partial<SearchEntry>): SearchEntry {
  return {
    id: 'x-1',
    lang: 'common',
    stage: 0,
    title: '无题',
    tags: [],
    keywords: [],
    text: '',
    ...partial
  }
}

describe('searchEntries 检索', () => {
  it('空查询返回空数组', () => {
    expect(searchEntries([entry({})], '  ')).toEqual([])
  })

  it('大小写不敏感', () => {
    const r = searchEntries([entry({ title: 'Hello World' })], 'hello')
    expect(r.length).toBe(1)
  })

  it('标题命中（×3）排在正文命中（×1）前面', () => {
    const index = [
      entry({ id: 't', title: '循环', text: '很多很多字' }),
      entry({ id: 'b', title: '函数', text: '今天讲讲循环这件事喵' })
    ]
    const r = searchEntries(index, '循环')
    expect(r[0].entry.id).toBe('t')
    expect(r[0].score).toBe(3)
    expect(r[1].entry.id).toBe('b')
    expect(r[1].score).toBe(1)
  })

  it('关键词 ×2、标签 ×1、正文 ×1 累加', () => {
    const index = [
      entry({ id: 'full', title: '循环', tags: ['循环'], keywords: ['循环'], text: '循环' })
    ]
    const r = searchEntries(index, '循环')
    expect(r[0].score).toBe(7)
  })

  it('无命中不返回', () => {
    const r = searchEntries([entry({ title: '变量' })], '不存在的词')
    expect(r).toEqual([])
  })

  it('命中数超过 limit 时截断', () => {
    const index = Array.from({ length: 10 }, (_, i) => entry({ id: `t${i}`, title: `循环${i}` }))
    expect(searchEntries(index, '循环', 4).length).toBe(4)
  })

  it('标题命中时片段即标题；正文命中时片段带省略号', () => {
    const longText = '喵' + 'a'.repeat(100) + '循环' + 'b'.repeat(100)
    const index = [
      entry({ id: 'h', title: '循环小课堂' }),
      entry({ id: 'x', text: longText })
    ]
    const [h, x] = searchEntries(index, '循环')
    expect(h.snippet).toBe('循环小课堂')
    expect(x.snippet.startsWith('…')).toBe(true)
    expect(x.snippet.endsWith('…')).toBe(true)
    expect(x.snippet).toContain('循环')
  })
})

/** 造一条题目索引条目（只写本 describe 用得上的字段，其余给无害缺省） */
function qItem(partial: Partial<QuestionIndexItem>): QuestionIndexItem {
  return {
    key: 'c-1:q1',
    lessonId: 'c-1',
    lang: 'common',
    stage: 1,
    type: 'choice',
    difficulty: 'easy',
    tags: [],
    stem: '',
    ...partial
  }
}

describe('searchQuestions 题目检索（学习闭环 §9）', () => {
  it('空查询返回空数组', () => {
    expect(searchQuestions([qItem({ stem: '循环' })], '  ')).toEqual([])
  })

  it('题干命中（×2）排在课标签命中（×1）前面', () => {
    const index = [
      // ⚠️ a 的题干**一个字都不许含**查询词 —— 写「和循环无关的题干」这种
      // "描述它不含某词"的句子时，那个词本身就进了题干，夹具当场自我拆台
      qItem({ key: 'a:q1', tags: ['循环'], stem: '无关题干' }),
      qItem({ key: 'b:q1', tags: [], stem: '讲讲循环' })
    ]
    const r = searchQuestions(index, '循环')
    expect(r[0].item.key).toBe('b:q1')
    expect(r[0].score).toBe(2)
    expect(r[1].item.key).toBe('a:q1')
    expect(r[1].score).toBe(1)
  })

  it('题干 + 标签都命中：分数累加', () => {
    const r = searchQuestions([qItem({ stem: '循环体', tags: ['循环'] })], '循环')
    expect(r).toHaveLength(1)
    expect(r[0].score).toBe(3)
  })

  it('大小写不敏感', () => {
    expect(searchQuestions([qItem({ stem: 'Hello World' })], 'hello')).toHaveLength(1)
  })

  it('★ 挑战题永不入选 —— 连"清一色挑战题"也不返回（不是只把别的排前面）', () => {
    const mixed = [
      qItem({ key: 'a:q1', stem: '循环大魔王', difficulty: 'challenge' }),
      qItem({ key: 'b:q1', stem: '循环小练习', difficulty: 'hard' })
    ]
    expect(searchQuestions(mixed, '循环').map((h) => h.item.key)).toEqual(['b:q1'])
    // 全是挑战题 → 空数组（入口行不会出现、卷子也不会开）
    expect(searchQuestions([qItem({ stem: '循环', difficulty: 'challenge' })], '循环')).toEqual([])
  })

  it('命中数超过 limit 时截断；默认上限就是微卷上限', () => {
    const index = Array.from({ length: 10 }, (_, i) => qItem({ key: `c-1:q${i}`, stem: `循环${i}` }))
    expect(searchQuestions(index, '循环')).toHaveLength(SEARCH_QUIZ_MAX)
    expect(searchQuestions(index, '循环', 3)).toHaveLength(3)
  })

  it('limit 非正数 → 空数组（不返回"从头裁掉尾巴"那种怪结果）', () => {
    const index = [qItem({ stem: '循环' })]
    expect(searchQuestions(index, '循环', 0)).toEqual([])
    expect(searchQuestions(index, '循环', -1)).toEqual([])
  })

  it('无命中不返回', () => {
    expect(searchQuestions([qItem({ stem: '变量' })], '不存在的词')).toEqual([])
  })
})
