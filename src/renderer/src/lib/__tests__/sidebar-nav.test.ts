/**
 * 侧栏手风琴的纯函数（lib/sidebar-nav.ts，2026-10-09「侧边栏 UI 收纳」；
 * 2026-10-10 IA 重构改三组）。
 *
 * 【守什么】三处判断逻辑各自钉死：
 *   · 键表 —— 恰是三组（learn / review / me），没有第 4 个 lessons
 *     （IA 重构撤销：课列表整块并进学习组，见 Sidebar.vue）；
 *   · 路由 → 默认展开哪组 —— 「默认只展开正在使用的那一组」是主人拍板的口径；
 *     课详情 lesson 也归学习组（读课时左侧直接是语言 + 课列表，这正是本轮
 *     重构要消掉「先点一下」的那一步）。兜底错组（比如 overview 落到 learn）
 *     界面不至于崩，但用户一进总览就看到学习组开着、自己那组收着，属于
 *     「说不上哪里怪」的那种坏。
 *   · 存量归一化 —— 偏严（差一键整体作废）。松一格的后果是某组莫名消失。
 * flipGroup 钉「返回新对象、不动入参」：返回旧引用的话，store 里 explicit
 * 和图会指着同一张脸，开合从此不再变化（幽灵态）。
 *
 * 【2026-10-10 主人批·图一：soloToggleGroup（手风琴互斥）】点组头从「只翻
 * 本组」改成「开一组 = 其余两组让位；点已开组 = 全收」。旧契约 flipGroup
 * 一个字没动（另一条 describe 继续钉它）；新口径单独一条 describe ——
 * 两套语义各自被钉住，不许互相借道。
 */

import { describe, expect, it } from 'vitest'
import {
  defaultOpenMap,
  flipGroup,
  groupOfRoute,
  NAV_GROUP_IDS,
  normalizeOpenMap,
  soloToggleGroup,
  type NavOpenMap
} from '../sidebar-nav'

describe('NAV_GROUP_IDS：键表', () => {
  it('恰是三组 learn / review / me（第 4 组 lessons 已随 IA 重构撤销）', () => {
    expect(NAV_GROUP_IDS).toEqual(['learn', 'review', 'me'])
  })
})

describe('groupOfRoute：路由 → 组', () => {
  it('复习与挑战组：review / challenge / favorites / warehouse', () => {
    expect(groupOfRoute('review')).toBe('review')
    expect(groupOfRoute('challenge')).toBe('review')
    expect(groupOfRoute('favorites')).toBe('review')
    expect(groupOfRoute('warehouse')).toBe('review')
  })

  it('个人中心组：overview / leaderboard / login', () => {
    expect(groupOfRoute('overview')).toBe('me')
    expect(groupOfRoute('leaderboard')).toBe('me')
    expect(groupOfRoute('login')).toBe('me')
  })

  it('课详情 lesson 归学习组（课列表并进学习组后，读课时默认展开的就是它）', () => {
    expect(groupOfRoute('lesson')).toBe('learn')
  })

  it('学习组与兜底：learn 页原样，settings/未知/null/undefined 一律回 learn', () => {
    expect(groupOfRoute('learn')).toBe('learn')
    expect(groupOfRoute('practice')).toBe('learn')
    expect(groupOfRoute('playground')).toBe('learn')
    expect(groupOfRoute('memo')).toBe('learn')
    expect(groupOfRoute('settings')).toBe('learn')
    expect(groupOfRoute('')).toBe('learn')
    expect(groupOfRoute(null)).toBe('learn')
    expect(groupOfRoute(undefined)).toBe('learn')
  })
})

describe('defaultOpenMap：自动态 = 只开当前路由那组', () => {
  it('三键齐全、恰好一个 true，且就是路由所在组', () => {
    for (const name of ['learn', 'practice', 'review', 'warehouse', 'overview', 'login', 'lesson']) {
      const map = defaultOpenMap(name)
      expect(Object.keys(map).sort()).toEqual([...NAV_GROUP_IDS].sort())
      const open = NAV_GROUP_IDS.filter((id) => map[id])
      expect(open, `路由 ${name} 的展开组`).toEqual([groupOfRoute(name)])
    }
  })
})

describe('normalizeOpenMap：存量 JSON 偏严归一', () => {
  const full: NavOpenMap = { learn: true, review: false, me: true }

  it('三键齐全且都是布尔 → 原样认下', () => {
    expect(normalizeOpenMap(full)).toEqual(full)
  })

  it('三组全收起也是合法选择（全 false 不是坏数据）', () => {
    expect(normalizeOpenMap({ learn: false, review: false, me: false })).toEqual({
      learn: false,
      review: false,
      me: false
    })
  })

  it('差一键 / 值不是布尔 → 整体作废（null = 当作没存过）', () => {
    expect(normalizeOpenMap({ learn: true, review: true })).toBeNull()
    expect(normalizeOpenMap({ ...full, me: 1 })).toBeNull()
    expect(normalizeOpenMap({ ...full, review: 'true' })).toBeNull()
    expect(normalizeOpenMap({ ...full, learn: null })).toBeNull()
  })

  it('非对象形状：null / 数组 / 字符串 / 数字 → null', () => {
    expect(normalizeOpenMap(null)).toBeNull()
    expect(normalizeOpenMap([])).toBeNull()
    expect(normalizeOpenMap(['learn'])).toBeNull()
    expect(normalizeOpenMap('open')).toBeNull()
    expect(normalizeOpenMap(3)).toBeNull()
    expect(normalizeOpenMap(undefined)).toBeNull()
  })

  it('多余键忽略：只认三组（旧四键 JSON 多出的 lessons 同样被忽略 —— 真正的防线是换键，见 store 单测）', () => {
    expect(normalizeOpenMap({ ...full, tools: true })).toEqual(full)
    expect(normalizeOpenMap({ learn: true, review: false, me: true, lessons: false })).toEqual(full)
  })
})

describe('flipGroup：只翻一格、返回新对象', () => {
  it('翻指定组，其余原样', () => {
    const base: NavOpenMap = { learn: true, review: false, me: true }
    expect(flipGroup(base, 'review')).toEqual({ learn: true, review: true, me: true })
    expect(flipGroup(base, 'learn')).toEqual({ learn: false, review: false, me: true })
  })

  it('不动入参（返回的是新对象 —— 否则 store 里会出幽灵态）', () => {
    const base: NavOpenMap = { learn: true, review: false, me: true }
    const next = flipGroup(base, 'me')
    expect(next).not.toBe(base)
    expect(base).toEqual({ learn: true, review: false, me: true })
  })

  it('连翻两次回到原状', () => {
    const base: NavOpenMap = { learn: true, review: false, me: true }
    expect(flipGroup(flipGroup(base, 'me'), 'me')).toEqual(base)
  })
})

describe('soloToggleGroup：手风琴（开一组 = 其余让位；点已开组 = 全收）', () => {
  it('点关着的组：只它 true，其余两组一律 false（原本多开也一样收掉）', () => {
    expect(soloToggleGroup({ learn: true, review: true, me: false }, 'me')).toEqual({
      learn: false,
      review: false,
      me: true
    })
    expect(soloToggleGroup({ learn: false, review: false, me: false }, 'learn')).toEqual({
      learn: true,
      review: false,
      me: false
    })
  })

  it('点已开的组：三键全收（全 false 是合法选择，同 normalizeOpenMap 口径）', () => {
    expect(soloToggleGroup({ learn: true, review: false, me: false }, 'learn')).toEqual({
      learn: false,
      review: false,
      me: false
    })
    // 三组全开时点哪一组也走「全收」—— 不是只收它自己
    expect(soloToggleGroup({ learn: true, review: true, me: true }, 'review')).toEqual({
      learn: false,
      review: false,
      me: false
    })
  })

  it('不动入参（返回的是新对象 —— 旧引用会养出幽灵态）', () => {
    const base: NavOpenMap = { learn: true, review: true, me: false }
    const next = soloToggleGroup(base, 'review')
    expect(next).not.toBe(base)
    expect(base).toEqual({ learn: true, review: true, me: false })
  })

  it('恒是三键齐全的合法图（可被 normalizeOpenMap 原样认下）；入参多余键不带出来', () => {
    for (const id of NAV_GROUP_IDS) {
      const opened = soloToggleGroup({ learn: false, review: false, me: false }, id)
      expect(normalizeOpenMap(opened)).toEqual(opened)
      const closed = soloToggleGroup({ learn: true, review: false, me: false }, id)
      expect(Object.keys(closed).sort()).toEqual([...NAV_GROUP_IDS].sort())
    }
    // 多余键忽略（同 normalizeOpenMap 的「多余键忽略」口径）：不进返回、不参与判定
    const dirty = { learn: true, review: false, me: false, tools: true } as unknown as NavOpenMap
    const out = soloToggleGroup(dirty, 'learn')
    expect(Object.keys(out).sort()).toEqual([...NAV_GROUP_IDS].sort())
    expect(out).toEqual({ learn: false, review: false, me: false })
  })
})
