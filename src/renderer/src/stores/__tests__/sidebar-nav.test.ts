/**
 * 侧栏手风琴的读写口（stores/sidebar-nav.ts，2026-10-09；2026-10-10 IA
 * 重构换 v2 键）。
 *
 * 【守什么】同 wall-hidden 的三条静默坏法，外加本 store 特有的两条：
 *   · 没存过必须是 null（自动态）而不是「三组全开/全关的快照」—— 写成快照
 *     的话「自动跟随路由」就废了，而且看不出来（首启恰好也是对的）；
 *   · 写口唯一且写的就是「眼前所见 + 这一翻」（toggle / toggleSolo 的
 *     effective 入参）。【2026-10-10 主人批·图一】点组头改走 toggleSolo
 *     （开一组收两组；点已开组 = 全收）；toggle「只翻指定键」的原契约保留；
 *   · 存储抛异常（file:// 起源下没有保证）→ 只降级成进程内有效，不炸；
 *   · 坏 JSON / 半截 JSON → 当作没存过（归一化在 lib，这里钉接线）。
 * 键名自带版本（miai:sidebar-nav:v2）也钉住 —— 改形状必须换键（v1 → v2
 * 就是四组 → 三组那一次），别去猜旧键里存了什么（同 zoom / wall-hidden
 * 的口径）；旧 v1 键在盘上不再被读，下面有一条专门钉它。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSidebarNavStore } from '../sidebar-nav'
import type { NavOpenMap } from '../../lib/sidebar-nav'

const KEY = 'miai:sidebar-nav:v2'
/** 旧版本键（四组形状的 v1 存档）—— 换键的意义就是「不再读它」 */
const LEGACY_KEY = 'miai:sidebar-nav:v1'

const OPEN: NavOpenMap = { learn: true, review: false, me: true }

/** 假 localStorage：可预置内容、可数写入次数、可注入异常（照 wall-hidden 的模板） */
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

describe('读取与落盘', () => {
  it('没存过 → explicit = null（自动态：每次进应用按当前路由展开）', () => {
    stubStorage()
    expect(useSidebarNavStore().explicit).toBeNull()
  })

  it('存过完整 JSON → 原样读回', () => {
    stubStorage({ seed: JSON.stringify(OPEN) })
    expect(useSidebarNavStore().explicit).toEqual(OPEN)
  })

  it('旧 v1 键（四组形状）躺在盘上也不读它 —— 换键 = 从零开始，不猜旧形状', () => {
    const { store } = stubStorage()
    store.set(LEGACY_KEY, JSON.stringify({ learn: true, review: false, me: true, lessons: false }))
    expect(useSidebarNavStore().explicit).toBeNull()
  })

  it('坏 JSON / 半截 JSON / 坏形状 → null（当作没存过，别崩也别猜）', () => {
    stubStorage({ seed: '{not json' })
    expect(useSidebarNavStore().explicit).toBeNull()

    setActivePinia(createPinia())
    stubStorage({ seed: JSON.stringify({ learn: true, review: true }) }) // 差一键
    expect(useSidebarNavStore().explicit).toBeNull()

    setActivePinia(createPinia())
    stubStorage({ seed: '"open"' })
    expect(useSidebarNavStore().explicit).toBeNull()
  })

  it('toggle 以「当前生效图」为底翻一格、整图落盘、explicit 同步', () => {
    const { setItem } = stubStorage()
    const s = useSidebarNavStore()

    // 自动态下第一次点：调用方给的是 defaultOpenMap（这里模拟「只开 learn」）
    const auto: NavOpenMap = { learn: true, review: false, me: false }
    s.toggle('review', auto)

    const expected = { learn: true, review: true, me: false }
    expect(s.explicit).toEqual(expected)
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(setItem).toHaveBeenCalledWith(KEY, JSON.stringify(expected))

    // 之后每次点：调用方给 explicit 自己，语义 = 眼前所见 + 这一翻
    s.toggle('learn', s.explicit as NavOpenMap)
    expect(s.explicit).toEqual({ learn: false, review: true, me: false })
    expect(setItem).toHaveBeenCalledTimes(2)
  })
})

describe('手风琴写口 toggleSolo（2026-10-10 主人批·图一）', () => {
  it('以「当前生效图」为底开一组收两组、整图落盘（v2 键形状不回归）', () => {
    const { setItem, store } = stubStorage()
    const s = useSidebarNavStore()

    // 自动态下第一次点：调用方给的是 defaultOpenMap（这里模拟「只开 learn」）
    s.toggleSolo('review', { learn: true, review: false, me: false })

    const expected = { learn: false, review: true, me: false }
    expect(s.explicit).toEqual(expected)
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(setItem).toHaveBeenCalledWith(KEY, JSON.stringify(expected))
    // 落盘形状恰是三键（不多不少）—— 形状回归在这条红
    expect(Object.keys(JSON.parse(store.get(KEY) as string)).sort()).toEqual([
      'learn',
      'me',
      'review'
    ])
  })

  it('点已开的组 = 全收；再点任一组照常开回来（全收是合法显式态，不是死局）', () => {
    const { setItem } = stubStorage()
    const s = useSidebarNavStore()

    s.toggleSolo('learn', { learn: true, review: false, me: false })
    expect(s.explicit).toEqual({ learn: false, review: false, me: false })

    s.toggleSolo('me', s.explicit as NavOpenMap)
    expect(s.explicit).toEqual({ learn: false, review: false, me: true })
    expect(setItem).toHaveBeenCalledTimes(2)
  })

  it('写抛异常 → toggleSolo 照常只在本进程生效（内存态有效），不炸', () => {
    stubStorage({ throwOn: 'set' })
    const s = useSidebarNavStore()
    expect(() => s.toggleSolo('review', OPEN)).not.toThrow()
    expect(s.explicit).toEqual({ learn: false, review: true, me: false })
  })
})

describe('存储坏了也不崩（file:// 起源下没有保证）', () => {
  it('读抛异常 → 降级自动态，不炸', () => {
    stubStorage({ throwOn: 'get' })
    expect(useSidebarNavStore().explicit).toBeNull()
  })

  it('写抛异常 → 本进程内照常开合（内存态有效），不炸', () => {
    stubStorage({ throwOn: 'set' })
    const s = useSidebarNavStore()
    expect(() => s.toggle('me', OPEN)).not.toThrow()
    expect(s.explicit).toEqual({ learn: true, review: false, me: false })
  })
})
