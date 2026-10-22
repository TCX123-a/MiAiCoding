/**
 * 收藏列表的筛选与元信息解析（lib/favorites-view.ts）
 *
 * 【这个文件在守什么】
 * 守的是**「用户收藏的题，不能因为界面上点了一下筛选就自己少了」**。
 *
 * 这一屏每一条判断都能悄悄写错，而且错法都长得像"正常"：
 *   · 查不出出处的条目被当成"不匹配"直接丢掉 —— 收藏凭空少一条，没人解释
 *   · 「未分组」少判一种情况（folderId 是空串、或者被别的档吞掉）—— 删完文件夹
 *     那些题一条都看不见
 *   · 来源筛「其他」漏掉 `source === undefined` 的老条目
 *
 * 【为什么元信息要注入假的】
 * 真元信息来自 15MB 的内容包。断言写成"对真内容此刻成立"的话，
 * 内容一改测试就红，而红了也说不清是谁的错。这里塞一份小的假索引，
 * 断言的是**规则**，不是今天的内容。
 */

import { describe, expect, it } from 'vitest'
import {
  FAV_ALL,
  FAV_ALL_SELECTION,
  FAV_OTHER_SOURCE,
  FAV_SOURCE_ORDER,
  FAV_UNGROUPED,
  countByFolder,
  countBySource,
  filterFavorites,
  filterOptions,
  itemSource,
  makeMetaResolver,
  sortFavorites,
  type FavoriteMeta,
  type FavoritesSelection
} from '../favorites-view'
import type { FavoriteItem, Question } from '../../../../shared/types'
import type { QuestionIndexItem } from '../../../../shared/question-index'

function fav(key: string, extra: Partial<FavoriteItem> = {}): FavoriteItem {
  const [lessonId, qid] = key.split(':')
  return { key, lessonId, qid, addedAt: '2026-09-29T00:00:00.000Z', ...extra }
}

/** 只造筛选要用的那几面；其余字段（题干等）跟本文件无关 */
function meta(lang: FavoriteMeta['lang'], difficulty: FavoriteMeta['difficulty']): FavoriteMeta {
  return { lang, type: 'choice', difficulty }
}

/** 每道题各自返回什么元信息；没列出来的 = 「查不出出处」 */
function metaOfMap(map: Record<string, FavoriteMeta>): (it: FavoriteItem) => FavoriteMeta | null {
  return (it) => map[it.key] ?? null
}

function sel(patch: Partial<FavoritesSelection>): FavoritesSelection {
  return { ...FAV_ALL_SELECTION, ...patch }
}

describe('filterFavorites：不筛就一条都不少', () => {
  it('全不筛时原样返回，且不会因为"查不出出处"报数', () => {
    const items = [fav('a-01:q1'), fav('b-01:q1')]
    const r = filterFavorites(items, FAV_ALL_SELECTION, () => null)
    expect(r.shown).toEqual(items)
    // ⚠️ 全不筛时一条元信息都不用问 —— 没有筛选就没有"看不出出处"这回事。
    // 这一条挡的是"把 metaOf 失败当成错误状态一路弹提示"的写法
    expect(r.hiddenUnknown).toBe(0)
  })

  it('只按文件夹 / 来源筛时，查不出出处的条目照常显示', () => {
    const items = [fav('a-01:q1', { source: 'lesson' })]
    const r = filterFavorites(items, sel({ folder: FAV_UNGROUPED }), () => null)
    expect(r.shown).toHaveLength(1)
    expect(r.hiddenUnknown).toBe(0)
  })
})

describe('filterFavorites：按语言 / 难度 / 题型筛', () => {
  const items = [fav('py-01:q1'), fav('c-01:q1'), fav('gone-01:q1')]
  const metaOf = metaOfMap({
    'py-01:q1': meta('python', 'easy'),
    'c-01:q1': meta('c', 'hard')
    // gone-01：不在表里 = 查不出出处
  })

  it('语言命中留下、不命中丢掉', () => {
    // 这一条只用**查得出出处**的两条：有出处的题不匹配就是单纯不匹配，不算「看不出出处」
    const known = [fav('py-01:q1'), fav('c-01:q1')]
    const r = filterFavorites(known, sel({ lang: 'python' }), metaOf)
    expect(r.shown.map((i) => i.key)).toEqual(['py-01:q1'])
    expect(r.hiddenUnknown).toBe(0)
  })

  it('查不出出处的条目**不算进结果，但要报数**', () => {
    const r = filterFavorites(items, sel({ lang: 'python' }), metaOf)
    // 这里正是本文件存在的理由：gone-01 既不能证明是 python、也不能证明不是。
    // 丢掉它是对的，**但必须让界面知道丢了**，否则用户会以为收藏自己少了
    expect(r.hiddenUnknown).toBe(1)
  })

  it('难度 / 题型也各筛各的', () => {
    expect(filterFavorites(items, sel({ difficulty: 'hard' }), metaOf).shown.map((i) => i.key)).toEqual([
      'c-01:q1'
    ])
    // 上面那份 meta 全是 choice：按 fill 筛一条都不该剩
    expect(filterFavorites(items, sel({ type: 'fill' }), metaOf).shown).toHaveLength(0)
  })

  it('三条维度一起给 = 全都要满足（AND）', () => {
    const r = filterFavorites(items, sel({ lang: 'python', difficulty: 'hard' }), metaOf)
    expect(r.shown).toHaveLength(0)
  })
})

describe('filterFavorites：文件夹与来源', () => {
  const items = [
    fav('a-01:q1', { folderId: 'folder-1', source: 'lesson' }),
    fav('a-01:q2', { folderId: 'folder-2', source: 'lesson' }),
    fav('a-01:q3', { source: 'wrong' }), // 未分组
    fav('a-01:q4', { source: 'challenge' }), // 未分组
    fav('a-01:q5') // 未分组，且 source 缺失 → 「其他」档
  ]

  it('按文件夹 id 筛', () => {
    expect(filterFavorites(items, sel({ folder: 'folder-1' }), () => null).shown.map((i) => i.key)).toEqual([
      'a-01:q1'
    ])
  })

  it('「未分组」筛的是**没有 folderId**的那些', () => {
    const r = filterFavorites(items, sel({ folder: FAV_UNGROUPED }), () => null)
    expect(r.shown.map((i) => i.key)).toEqual(['a-01:q3', 'a-01:q4', 'a-01:q5'])
  })

  it('来源缺失的条目归进「其他」档，不是被丢掉', () => {
    const r = filterFavorites(items, sel({ source: FAV_OTHER_SOURCE }), () => null)
    expect(r.shown.map((i) => i.key)).toEqual(['a-01:q5'])
  })

  it('itemSource：缺 source 就是「其他」', () => {
    expect(itemSource(fav('a-01:q1'))).toBe(FAV_OTHER_SOURCE)
    expect(itemSource(fav('a-01:q1', { source: 'wrong' }))).toBe('wrong')
  })
})

describe('sortFavorites', () => {
  it('新收的在前，不知道什么时候收的沉到最后', () => {
    const items = [
      fav('a-01:q1', { addedAt: '2026-09-01T00:00:00.000Z' }),
      fav('a-01:q2', { addedAt: '2026-09-29T00:00:00.000Z' }),
      // 读口给缺失的 addedAt 兜的就是 1970（favorites-merge.ts 的 UNKNOWN_TIME）
      fav('a-01:q3', { addedAt: '1970-01-01T00:00:00.000Z' })
    ]
    expect(sortFavorites(items).map((i) => i.key)).toEqual(['a-01:q2', 'a-01:q1', 'a-01:q3'])
  })

  it('返回新数组，不动调用方手里那份（store 的 items 还要当池子用）', () => {
    const items = [fav('a-01:q1'), fav('a-01:q2', { addedAt: '2026-09-30T00:00:00.000Z' })]
    const sorted = sortFavorites(items)
    expect(sorted).not.toBe(items)
    expect(items.map((i) => i.key)).toEqual(['a-01:q1', 'a-01:q2'])
  })
})

describe('countByFolder / countBySource', () => {
  const items = [
    fav('a-01:q1', { folderId: 'f1', source: 'lesson' }),
    fav('a-01:q2', { folderId: 'f1', source: 'lesson' }),
    fav('a-01:q3', { folderId: 'f2' }),
    fav('a-01:q4')
  ]

  it('每个文件夹几条、未分组几条', () => {
    expect(countByFolder(items)).toEqual({ byId: { f1: 2, f2: 1 }, ungrouped: 1 })
  })

  it('每个来源几条，「其他」也在里面', () => {
    expect(countBySource(items)).toEqual({ lesson: 2, [FAV_OTHER_SOURCE]: 2 })
  })
})

describe('makeMetaResolver：一道收藏的出处从哪儿来', () => {
  /** 索引条目：**难度是索引里算好的那份**（内置题不再自己算一遍） */
  function idx(key: string, difficulty: QuestionIndexItem['difficulty']): QuestionIndexItem {
    return {
      key,
      lessonId: key.split(':')[0],
      lang: 'cpp',
      stage: 1,
      type: 'codefill',
      difficulty,
      tags: [],
      stem: '题干'
    }
  }

  const deps = {
    indexOf: (key: string) => (key === 'cpp-01:q1' ? idx(key, 'hard') : undefined),
    lessonOf: (id: string) =>
      id === 'python-03' ? ({ lang: 'python', stage: 3 } as const) : undefined
  }
  const resolve = makeMetaResolver(deps)

  it('内置题查索引，难度直接用索引里那份（不重算）', () => {
    // 索引说 hard，题型说 codefill。重算的话 codefill+stage1 会是 medium ——
    // 两条规则一旦分家，界面按难度筛出来的东西会和难度分布报告对不上
    expect(resolve(fav('cpp-01:q1'))).toEqual({ lang: 'cpp', type: 'codefill', difficulty: 'hard' })
  })

  it('AI 题从自带的本体 + 宿主课取（语言走宿主课）', () => {
    const q: Question = {
      id: 'ai-2026-09-29-1',
      type: 'choice',
      stem: '题干',
      options: ['甲', '乙'],
      answer: 0,
      explanation: '解析'
    }
    const item = fav('python-03:ai-2026-09-29-1', { ai: q })
    expect(resolve(item)).toEqual({ lang: 'python', type: 'choice', difficulty: 'easy' })
  })

  it('内置题在索引里查不到 → null（不猜一个默认值）', () => {
    expect(resolve(fav('gone-01:q1'))).toBeNull()
  })

  it('AI 题缺本体 / 宿主课没了 → null', () => {
    const q: Question = {
      id: 'ai-x-1',
      type: 'choice',
      stem: '题干',
      options: ['甲'],
      answer: 0,
      explanation: '解析'
    }
    expect(resolve(fav('python-03:ai-x-1'))).toBeNull() // 有课没本体
    expect(resolve(fav('gone-01:ai-x-1', { ai: q }))).toBeNull() // 有本体没课
  })
})

// ---------------------------------------------------------------- 筛选器选项

describe('filterOptions：筛选器里出现哪几档', () => {
  /** 来源那一维的标签函数（真实现是 PRACTICE.sourceLabel，认不出的原样返回） */
  const label = (v: string): string => `L-${v}`

  it('「全部」永远第一档，其余按给定顺序（不按条数、不按先后）', () => {
    const got = filterOptions(
      ['fav', 'lesson', 'wrong'],
      ['lesson', 'random', 'wrong', 'challenge', 'extend', 'fav'],
      label,
      '全部'
    )
    expect(got.map((o) => o.value)).toEqual([FAV_ALL, 'lesson', 'wrong', 'fav'])
    expect(got[0].label).toBe('全部')
    expect(got[1].label).toBe('L-lesson')
  })

  it('★ 数据里有、顺序表里没写的取值不丢：接在后面（按字典序）', () => {
    const got = filterOptions(['imported', 'zeta', 'lesson'], ['lesson'], label, '全部')
    expect(got.map((o) => o.value)).toEqual([FAV_ALL, 'lesson', 'imported', 'zeta'])
  })

  it('数据里一个都没有 → 只剩「全部」（不是空下拉）', () => {
    expect(filterOptions([], ['lesson'], label, '全部').map((o) => o.value)).toEqual([FAV_ALL])
  })

  it('★ keep：当前选中的那一档即使已经没数据也留在列表里，而且不重复', () => {
    const got = filterOptions(['lesson'], ['lesson'], label, '全部', 'extend')
    expect(got.map((o) => o.value)).toEqual([FAV_ALL, 'lesson', 'extend'])
    // 有数据时不许出现两份
    const dup = filterOptions(['extend'], ['extend'], label, '全部', 'extend')
    expect(dup.map((o) => o.value)).toEqual([FAV_ALL, 'extend'])
  })

  it('keep 传「全部」不会多出一档（它本来就在第一档）', () => {
    expect(filterOptions([], [], label, '全部', FAV_ALL).map((o) => o.value)).toEqual([FAV_ALL])
  })

  it('★ FAV_SOURCE_ORDER：「其他」排在最后（它是兜底档，不是一种来源）', () => {
    /*
     * 这条钉的是**顺序表本身**，不是 filterOptions —— 上面那个"顺序表里没写的
     * 取值接在后面"的兜底是按**字典序**接的，而它接在顺序表的**全部**条目之后。
     * 于是只要「其他」不在表尾，任何一档新来源（如阶段/整门综合练习）
     * 都会把它顶到中间去，而"「其他」永远最后"这个约定就静默失效了 ——
     * 界面上看起来只是"筛选器的次序有点怪"，没人会想到这是一条被违背的约定。
     */
    expect(FAV_SOURCE_ORDER[FAV_SOURCE_ORDER.length - 1]).toBe(FAV_OTHER_SOURCE)
    // 顺带钉住真的走一遍的结果（顺序表对了、filterOptions 判错了也不该绿）
    const got = filterOptions(
      ['stage', 'lang', FAV_OTHER_SOURCE, 'lesson'],
      FAV_SOURCE_ORDER,
      label,
      '全部'
    )
    expect(got[got.length - 1].value).toBe(FAV_OTHER_SOURCE)
  })

  it('不改动传进来的集合（同一个 Set 连着用两次结果一样）', () => {
    const present = new Set(['lesson', 'wrong'])
    filterOptions(present, ['lesson'], label, '全部')
    expect([...present].sort()).toEqual(['lesson', 'wrong'])
  })
})
