import { describe, expect, it } from 'vitest'
import { computeUnlocked, statusOf, type Unlockable } from '../unlock'

describe('computeUnlocked 解锁闭包', () => {
  it('无前置的课天然解锁', () => {
    const all: Unlockable[] = [{ id: 'a', required: [] }]
    expect(computeUnlocked(all, new Set()).has('a')).toBe(true)
  })

  it('链式解锁：只有前置完成才解锁下一课', () => {
    const all: Unlockable[] = [
      { id: 'a', required: [] },
      { id: 'b', required: ['a'] },
      { id: 'c', required: ['b'] }
    ]
    expect(computeUnlocked(all, new Set())).toEqual(new Set(['a']))
    expect(computeUnlocked(all, new Set(['a']))).toEqual(new Set(['a', 'b']))
    expect(computeUnlocked(all, new Set(['a', 'b']))).toEqual(new Set(['a', 'b', 'c']))
  })

  it('菱形依赖：D 需 B、C 都学完才解锁', () => {
    const all: Unlockable[] = [
      { id: 'a', required: [] },
      { id: 'b', required: ['a'] },
      { id: 'c', required: ['a'] },
      { id: 'd', required: ['b', 'c'] }
    ]
    // 只学完 a+b：c 解锁（前置 a 已学），d 需 b、c 都已学 → 仍锁
    const got = computeUnlocked(all, new Set(['a', 'b']))
    expect(got.has('c')).toBe(true)
    expect(got.has('d')).toBe(false)
    // a+b+c 全齐后 d 解锁
    const got2 = computeUnlocked(all, new Set(['a', 'b', 'c']))
    expect(got2.has('d')).toBe(true)
  })

  it('解锁不能连锁：未学完的前置不解锁后继（防一口气全开）', () => {
    const all: Unlockable[] = [
      { id: 'a', required: [] },
      { id: 'b', required: ['a'] },
      { id: 'c', required: ['b'] }
    ]
    // a 只是「可学」而未学完，b、c 必须保持锁定
    expect(computeUnlocked(all, new Set())).toEqual(new Set(['a']))
  })

  it('前置环不会死循环：环内课不解锁（除非已学）', () => {
    const all: Unlockable[] = [
      { id: 'a', required: ['b'] },
      { id: 'b', required: ['a'] },
      { id: 'c', required: [] }
    ]
    const got = computeUnlocked(all, new Set())
    expect(got.has('a')).toBe(false)
    expect(got.has('b')).toBe(false)
    expect(got.has('c')).toBe(true)
  })

  it('自环（要求自己）不会死循环', () => {
    const all: Unlockable[] = [{ id: 'a', required: ['a'] }]
    const got = computeUnlocked(all, new Set())
    expect(got.has('a')).toBe(false)
  })

  it('已学的课永远处于解锁集合', () => {
    const all: Unlockable[] = [
      { id: 'a', required: [] },
      { id: 'b', required: ['missing-x'] }
    ]
    expect(computeUnlocked(all, new Set(['b'])).has('b')).toBe(true)
  })
})

describe('statusOf 状态判定', () => {
  it('lesson 不存在 → missing', () => {
    expect(statusOf('x', undefined, new Set(), new Set())).toBe('missing')
  })
  it('已学优先于一切', () => {
    const l: Unlockable = { id: 'a', required: [] }
    expect(statusOf('a', l, new Set(['a']), new Set())).toBe('learned')
  })
  it('在解锁集合 → open，否则 locked', () => {
    const l: Unlockable = { id: 'a', required: [] }
    expect(statusOf('a', l, new Set(), new Set(['a']))).toBe('open')
    expect(statusOf('a', l, new Set(), new Set())).toBe('locked')
  })
})
