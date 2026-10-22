/**
 * 备忘录的搜索与筛选（src/renderer/src/lib/memo-search.ts）
 *
 * 【这个文件在守什么】
 * 备忘录只有几十条，但**搜索是唯一一个"看结果才知道对不对"的动作**：
 * 没搜到东西时，界面和"我没有这条笔记"长得一模一样。所以这里每条正向断言
 * 都配一条**必不匹配的对照**（先喂一条不匹配的，确认它真的不算命中，
 * 再喂匹配的）—— 不然「返回数组里有它」这种断言，在一个恒返回全量的
 * 假实现上也是绿的。
 */
import { describe, expect, it } from 'vitest'
import { MEMO_KIND_ALL, memoMatches, memoSummary, searchMemo } from '../memo-search'
import type { MemoItem } from '../../../../shared/types'

function item(id: string, over: Partial<MemoItem> = {}): MemoItem {
  return { id, kind: 'code', title: '', body: '', createdAt: 0, updatedAt: 0, ...over }
}

const PY = item('m1', { kind: 'code', title: '列表去重', body: "seen = set()\nfor x in xs:" })
const TIP = item('m2', { kind: 'knowledge', title: 'Python 的 GIL', body: '同一时刻只有一个线程在跑字节码' })

describe('memoMatches（单条判定）', () => {
  it('★ 尺子自证：先喂一条**必不匹配**的（它必须为假），再喂匹配的（必须为真）', () => {
    // 若把实现改成"恒真"，第一条立刻红 —— 这才说明第二条的绿是有信息的
    expect(memoMatches(PY, 'zzz-不存在-zzz')).toBe(false)
    expect(memoMatches(PY, 'for x')).toBe(true)
  })

  it('空查询 / 纯空白查询 = 全命中（搜索框空着就是"不筛"）', () => {
    for (const q of ['', '   ']) {
      expect(memoMatches(PY, q), JSON.stringify(q)).toBe(true)
    }
  })

  it('大小写不敏感：两边都试（标题大写搜、正文小写搜）', () => {
    const t = item('m3', { title: 'Reading Files', body: 'pathlib.Path' })
    expect(memoMatches(t, 'reading')).toBe(true)
    expect(memoMatches(t, 'READING')).toBe(true)
    expect(memoMatches(t, 'PATHLIB')).toBe(true)
    // 对照：换掉一个字母就不该命中
    expect(memoMatches(t, 'readinng')).toBe(false)
  })

  it('匹配面含标题与正文；查询词两头空白会被去掉', () => {
    expect(memoMatches(PY, '去重')).toBe(true)
    expect(memoMatches(PY, '  seen  ')).toBe(true)
  })

  it('★ 标题尾巴与正文开头**不会**粘成一个词（中间垫了换行）', () => {
    // 不垫换行的话，标题"循环"+正文"for" 会拼出"循环for"，搜"环f"也会命中 ——
    // 那是用户从没写过的一串字
    const t = item('m4', { title: '循环', body: 'for i in xs:' })
    expect(memoMatches(t, '环f')).toBe(false)
    expect(memoMatches(t, '循环')).toBe(true)
  })
})

describe('searchMemo（搜索 + 分类过滤）', () => {
  it('★ 命中：不匹配的词先给出空数组，匹配的词给出那条，顺序与入参一致', () => {
    const items = [PY, TIP]
    expect(searchMemo(items, 'zzz-不存在-zzz')).toEqual([]) // 必不匹配的对照
    expect(searchMemo(items, 'gIL').map((i) => i.id)).toEqual(['m2'])
    expect(searchMemo(items, 'set').map((i) => i.id)).toEqual(['m1'])
    // 两条都中的词：顺序 = 入参顺序（列表的顺序是它自己的事，搜索不许打乱）
    const both = item('m5', { kind: 'code', title: 'Python 小抄', body: 'x = 1' })
    expect(searchMemo([both, TIP, PY], 'python').map((i) => i.id)).toEqual(['m5', 'm2'])
  })

  it('★ 无匹配 → **空数组**（不是 null、不是全量）', () => {
    expect(searchMemo([PY, TIP], '绝对不会出现的词')).toEqual([])
  })

  it('空查询 → 全部（保持原顺序）；空表 → 空数组', () => {
    expect(searchMemo([PY, TIP], '').map((i) => i.id)).toEqual(['m1', 'm2'])
    expect(searchMemo([PY, TIP], '   ').map((i) => i.id)).toEqual(['m1', 'm2'])
    expect(searchMemo([], 'anything')).toEqual([])
  })

  it('分类过滤：code / knowledge 各只给自己的；「全部」那一档不筛', () => {
    const items = [PY, TIP]
    expect(searchMemo(items, '', 'code').map((i) => i.id)).toEqual(['m1'])
    expect(searchMemo(items, '', 'knowledge').map((i) => i.id)).toEqual(['m2'])
    expect(searchMemo(items, '', MEMO_KIND_ALL).map((i) => i.id)).toEqual(['m1', 'm2'])
  })

  it('搜索词与分类**同时**生效（不是二选一）', () => {
    const items = [PY, TIP]
    // 'python' 两条都沾（PY 的正文里没有，TIP 标题里有）—— 所以这里挑一条只有
    // PY 有的词，再让分类把它筛掉：结果必须是空数组，而不是"分类没生效"
    expect(searchMemo(items, 'seen', 'knowledge')).toEqual([])
    expect(searchMemo(items, 'seen', 'code').map((i) => i.id)).toEqual(['m1'])
  })
})

describe('memoSummary（列表行的正文摘要）', () => {
  it('取正文**第一行非空内容**（多行代码只露一行），两头空白去掉', () => {
    expect(memoSummary(item('m1', { body: '\n\n  第一行有字  \n第二行' }))).toBe('第一行有字')
  })

  it('空正文 / 全是空白 → 空串（调用方据此退回占位文案）', () => {
    expect(memoSummary(item('m1', { body: '' }))).toBe('')
    expect(memoSummary(item('m1', { body: ' \n\t\n ' }))).toBe('')
  })

  it('超长截断并加省略号（列表行只给一眼，不给一整段）', () => {
    const long = 'x'.repeat(200)
    const out = memoSummary(item('m1', { body: long }), 80)
    expect(out).toHaveLength(81) // 80 + 省略号
    expect(out.endsWith('…')).toBe(true)
    // 边界：恰好 max 不截（对照 —— 截断逻辑不能把不长的也砍了）
    expect(memoSummary(item('m1', { body: 'y'.repeat(80) }), 80)).toHaveLength(80)
  })
})
