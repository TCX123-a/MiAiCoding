import { describe, expect, it } from 'vitest'
import { nextWrittenAfter } from '../lesson-nav'
import type { OutlineModule } from '../types'

/**
 * 构造一个大纲。`w` = 有正文，`d` = 只有骨架（draft）。
 * 用单字母课号写用例，读的时候一眼能对上位置。
 */
function mk(shape: Array<Array<[string, 'w' | 'd']>>): OutlineModule[] {
  return shape.map((lessons, i) => ({
    lang: 'common',
    stage: 1,
    lessons: lessons.map(([id, kind], j) => ({
      id,
      title: id,
      tags: [],
      order: j,
      hasContent: kind === 'w'
    }))
  })) as OutlineModule[]
}

describe('nextWrittenAfter 下一课', () => {
  it('基本：返回大纲顺序里的下一节有正文的课', () => {
    const outline = mk([[['a', 'w'], ['b', 'w'], ['c', 'w']]])
    expect(nextWrittenAfter(outline, 'a')).toBe('b')
    expect(nextWrittenAfter(outline, 'b')).toBe('c')
  })

  it('跳过没正文的课：中间夹一节 draft 也不停在那儿', () => {
    const outline = mk([[['a', 'w'], ['b', 'd'], ['c', 'w']]])
    expect(nextWrittenAfter(outline, 'a')).toBe('c')
  })

  it('当前课自己没正文（draft）时，返回它位置之后第一节有正文的课', () => {
    const outline = mk([[['a', 'w'], ['b', 'd'], ['c', 'w']]])
    expect(nextWrittenAfter(outline, 'b')).toBe('c')
  })

  it('跨模块：第一节的最后一课 → 下一模块的第一节有正文的课', () => {
    const outline = mk([
      [['a', 'w'], ['b', 'd']],
      [['c', 'w']]
    ])
    expect(nextWrittenAfter(outline, 'a')).toBe('c')
  })

  it('已经是最后一节有正文的课 → null（按钮不出现，而不是点不动）', () => {
    const outline = mk([[['a', 'w'], ['b', 'w'], ['c', 'd']]])
    expect(nextWrittenAfter(outline, 'b')).toBe(null)
  })

  it('后面全是 draft → null', () => {
    const outline = mk([[['a', 'w'], ['b', 'd'], ['c', 'd']]])
    expect(nextWrittenAfter(outline, 'a')).toBe(null)
  })

  it('课号不在大纲里 → null（手改 URL 不猜一个去处）', () => {
    const outline = mk([[['a', 'w'], ['b', 'w']]])
    expect(nextWrittenAfter(outline, 'nope')).toBe(null)
  })

  it('空大纲 → null', () => {
    expect(nextWrittenAfter([], 'a')).toBe(null)
  })

  it('不看解锁状态：下一课还锁着也返回它（课页会列前置，比假装到头诚实）', () => {
    // 解锁状态根本不进这个函数 —— 这里钉的是"调用方不许自己加锁过滤"，
    // 构造上没给它 learned/unlocked 的口子
    const outline = mk([[['a', 'w'], ['b', 'w']]])
    expect(nextWrittenAfter(outline, 'a')).toBe('b')
  })
})
