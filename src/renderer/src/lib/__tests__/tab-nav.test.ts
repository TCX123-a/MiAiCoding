import { describe, expect, it } from 'vitest'
import { tabNavTarget } from '../tab-nav'

/**
 * MiTabs ←/→ 巡回的单测（⑤）。
 *
 * 断言的边界都是组件层会真撞上的：绕圈（第一个按 ← 到最后一个）、
 * 单页签（哪边都指回自己）、非法下标（-1 / 越界 → null，不许抛也不许乱指）。
 */
describe('tabNavTarget：分段控件的方向键巡回', () => {
  it('→ 向右一格，最后一格绕回第一格', () => {
    expect(tabNavTarget('ArrowRight', 0, 3)).toBe(1)
    expect(tabNavTarget('ArrowRight', 1, 3)).toBe(2)
    expect(tabNavTarget('ArrowRight', 2, 3)).toBe(0)
  })

  it('← 向左一格，第一格绕回最后一格', () => {
    expect(tabNavTarget('ArrowLeft', 0, 3)).toBe(2)
    expect(tabNavTarget('ArrowLeft', 1, 3)).toBe(0)
    expect(tabNavTarget('ArrowLeft', 2, 3)).toBe(1)
  })

  it('Home / End 直达两端', () => {
    expect(tabNavTarget('Home', 2, 3)).toBe(0)
    expect(tabNavTarget('End', 0, 3)).toBe(2)
  })

  it('单页签：←/→/Home/End 都指回自己（不越界、不抛）', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      expect(tabNavTarget(key, 0, 1), key).toBe(0)
    }
  })

  it('不管的键一律 null（调用方据此决定不 preventDefault）', () => {
    for (const key of ['Tab', 'Enter', 'a', 'ArrowUp', 'ArrowDown', 'Escape']) {
      expect(tabNavTarget(key, 1, 3), key).toBeNull()
    }
  })

  it('非法下标 / 空集合 → null，绝不返回一个能 focus 出去的下标', () => {
    expect(tabNavTarget('ArrowRight', -1, 3)).toBeNull()
    expect(tabNavTarget('ArrowRight', 3, 3)).toBeNull()
    expect(tabNavTarget('ArrowRight', 1.5, 3)).toBeNull()
    expect(tabNavTarget('ArrowRight', 0, 0)).toBeNull()
  })
})
