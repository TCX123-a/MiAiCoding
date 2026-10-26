/**
 * 选区登记处的靶向单测（P1，给 AI 侧栏的 @选区）。
 *
 * 【这层为什么值得测】它是跨组件（外壳右栏 ↔ 页面里的编辑器）唯一的桥，
 * 而桥最危险的坏法是**撤销登记时误伤**：路由切换时"新的先登记、旧的后卸载"，
 * 无条件清空就会把新的那根线剪掉 —— 表现是"在练习场里选中了文字，侧栏那颗勾
 * 仍然是灰的"，而且刷新一次就好、切回来又坏，极难复现。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  markSelectionState,
  readSelection,
  registerSelectionSource,
  releaseSelectionSource,
  selectionAvailable
} from '../editor-selection'

const sel = (text: string) => ({ text, fromLine: 1, toLine: 1 })

beforeEach(() => {
  // 每个用例都从一个干净登记处开始（模块级状态，必须手动复位）
  const empty = (): null => null
  registerSelectionSource(empty)
  releaseSelectionSource(empty)
  markSelectionState(false)
})

describe('editor-selection：登记 / 取值 / 撤销', () => {
  it('没登记时取不到（返回 null，不抛）', () => {
    expect(readSelection()).toBeNull()
  })

  it('登记后现取到值；值变化时读到的是新的（不缓存）', () => {
    let current = sel('第一段')
    registerSelectionSource(() => current)
    expect(readSelection()).toEqual(sel('第一段'))
    current = sel('第二段')
    expect(readSelection()).toEqual(sel('第二段'))
  })

  it('撤销登记后取不到', () => {
    const fn = (): ReturnType<typeof sel> => sel('x')
    registerSelectionSource(fn)
    releaseSelectionSource(fn)
    expect(readSelection()).toBeNull()
  })

  it('★ 别人登记之后，旧函数来撤销不许误伤（新的那根线要留着）', () => {
    const oldFn = (): ReturnType<typeof sel> => sel('旧')
    const newFn = (): ReturnType<typeof sel> => sel('新')
    registerSelectionSource(oldFn)
    registerSelectionSource(newFn) // 新的先登记
    releaseSelectionSource(oldFn) // 旧的后卸载
    expect(readSelection(), '旧的卸载把新的登记剪掉了').toEqual(sel('新'))
  })

  it('取值的函数抛错时当作"没有选区"，不把异常漏给界面', () => {
    registerSelectionSource(() => {
      throw new Error('editor disposed')
    })
    expect(() => readSelection()).not.toThrow()
    expect(readSelection()).toBeNull()
  })

  it('selectionAvailable 跟着 markSelectionState 翻转（侧栏那颗勾的响应式来源）', () => {
    expect(selectionAvailable.value).toBe(false)
    markSelectionState(true)
    expect(selectionAvailable.value).toBe(true)
    markSelectionState(false)
    expect(selectionAvailable.value).toBe(false)
  })
})
