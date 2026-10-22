/**
 * 「显示隐藏项目」视图开关（stores/wall-hidden.ts）—— 隐藏壁纸功能的视图侧一半。
 *
 * 【守什么】它是隐私功能里**决定别人看不看得到**的那一格：默认必须藏
 * （false），只有显式拨开才露出。三个静默坏法各自钉一条：
 *   · 默认反了（没存过就 true）—— 隐私功能变成摆设，还没人看得出来；
 *   · 记忆失效（写不进 / 读不回）—— 用户每次重启都要重新拨；
 *   · 存储抛异常（file:// 起源下 localStorage 没有保证）—— 绝不能把应用
 *     卡在启动上，降级为「本进程内有效」即可。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWallHiddenStore } from '../wall-hidden'

const KEY = 'miai:wall-hidden:v1'

/** 假 localStorage：可预置内容、可数写入次数、可注入异常 */
function stubStorage(opts: { seed?: string | null; throwOn?: 'get' | 'set' } = {}) {
  const store = new Map<string, string>()
  if (opts.seed !== null && opts.seed !== undefined) store.set(KEY, opts.seed)
  const setItem = vi.fn((k: string, v: string) => {
    if (opts.throwOn === 'set') throw new Error('quota')
    store.set(k, v)
  })
  ;(globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string) => {
        if (opts.throwOn === 'get') throw new Error('denied')
        return store.get(k) ?? null
      },
      setItem,
      removeItem: (k: string) => {
        store.delete(k)
      }
    }
  }
  return { store, setItem }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('默认与持久化', () => {
  it('没存过 → false（默认藏起来 —— 这是这个功能的全部意义）', () => {
    stubStorage()
    const s = useWallHiddenStore()
    expect(s.showHidden).toBe(false)
  })

  it('存过 1 → true（重启后记忆生效）', () => {
    stubStorage({ seed: '1' })
    const s = useWallHiddenStore()
    expect(s.showHidden).toBe(true)
  })

  it("存过 '0' / 坏值 → false（口径是严格 === '1'，不是真值判断）", () => {
    stubStorage({ seed: '0' })
    expect(useWallHiddenStore().showHidden).toBe(false)
    setActivePinia(createPinia())
    stubStorage({ seed: 'yes' })
    expect(useWallHiddenStore().showHidden).toBe(false)
  })

  it('setShowHidden(true) 落盘 1；重复设同值不写（幂等，同 zoom store 口径）', () => {
    const { setItem } = stubStorage()
    const s = useWallHiddenStore()

    s.setShowHidden(true)
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(setItem).toHaveBeenCalledWith(KEY, '1')

    s.setShowHidden(true) // 值没变 → 直接返回，不重复写
    expect(setItem).toHaveBeenCalledTimes(1)
  })

  it('toggleShowHidden 切值、写盘、并返回新值', () => {
    const { setItem } = stubStorage()
    const s = useWallHiddenStore()

    expect(s.toggleShowHidden()).toBe(true)
    expect(s.showHidden).toBe(true)
    expect(setItem).toHaveBeenLastCalledWith(KEY, '1')

    expect(s.toggleShowHidden()).toBe(false)
    expect(setItem).toHaveBeenLastCalledWith(KEY, '0')
  })

  it('setShowHidden 做布尔收编：传真值表达式 → true，写盘仍是 "1"', () => {
    const { setItem } = stubStorage()
    const s = useWallHiddenStore()
    s.setShowHidden(1 as unknown as boolean)
    expect(s.showHidden).toBe(true)
    expect(setItem).toHaveBeenCalledWith(KEY, '1')
  })
})

describe('存储坏了也不崩（file:// 起源下没有保证）', () => {
  it('读抛异常 → 降级 false，不炸', () => {
    stubStorage({ throwOn: 'get' })
    expect(useWallHiddenStore().showHidden).toBe(false)
  })

  it('写抛异常 → 本进程内照常切（内存态有效），不炸', () => {
    stubStorage({ throwOn: 'set' })
    const s = useWallHiddenStore()
    expect(() => s.setShowHidden(true)).not.toThrow()
    expect(s.showHidden).toBe(true)
  })
})
