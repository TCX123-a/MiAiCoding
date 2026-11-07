import { describe, expect, it } from 'vitest'
import { isImeComposing } from '../ime'

/**
 * IME 组词判定（2026-10-31 自检 P2）。
 *
 * 这条判据的坏法是**假阴性**：漏掉 229 那一路时，isComposing=true 的用例
 * 仍然绿，只有某些输入法会中招 —— 所以两条信号各钉一次，再配一个「真的
 * 不是组词」的对照臂。
 */
describe('isImeComposing', () => {
  it('isComposing=true → 组词中（标准信号）', () => {
    expect(isImeComposing({ isComposing: true })).toBe(true)
  })

  it('isComposing 缺失、只有 keyCode=229 → 组词中（旧 IME 信号）', () => {
    expect(isImeComposing({ keyCode: 229 })).toBe(true)
  })

  it('对照臂：普通 Enter（keyCode 13、非组词）→ 不是组词，必须放行', () => {
    expect(isImeComposing({ isComposing: false, keyCode: 13 })).toBe(false)
  })

  it('对照臂：isComposing 显式 false 且 keyCode 229 之外 → false（不许把 undefined 当 true）', () => {
    expect(isImeComposing({})).toBe(false)
  })
})
