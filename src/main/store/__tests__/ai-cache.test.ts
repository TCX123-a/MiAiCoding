/**
 * ai-cache.json 的键与存取（src/main/store/ai-cache.ts）
 *
 * 【这个文件在守什么】
 * AI 出的题是**花了钱的**（每一次调用都在烧 token），缓存命中就是纯赚。
 * 而它错的方式也是静默的：
 *
 *   1. **键撞了**：两份不同的提问算出同一个哈希 → 甲问题的答案被当成乙问题的
 *      缓存发出去，用户看到的是驴唇不对马嘴的题 —— 不报错。
 *   2. **该失效的不失效**：换模型、改了 prompt，键没变 → 永远拿旧模型的答案。
 *      （这条靠"键 = prompt 的哈希"天然成立，测试钉住它）
 *   3. **淘汰丢错人**：该丢最旧的却丢了最近写的，缓存越用越命中不到。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，字符串一律英文。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  AI_CACHE_CAP,
  CURRENT_AI_CACHE_VERSION,
  cacheGet,
  cacheKeyOf,
  cachePut,
  questionsWithCache,
  type AiCacheEntry,
  type AiCacheFile
} from '../ai-cache'
import { buildQuestionsPrompt } from '../../../shared/ai-prompt'
import type { AiParseResult } from '../../../shared/ai-question'
import type { AiGenerateInput, GlossaryTerm } from '../../../shared/types'

function payload(mark: string): AiParseResult {
  return { items: [], dropped: 0, reasons: [mark] }
}

/** 一份缓存文件（键用假 hex 串，cachePut/cacheGet 不校验键的形状） */
function cache(entries: Record<string, AiCacheEntry>): AiCacheFile {
  return { version: CURRENT_AI_CACHE_VERSION, entries }
}

/** 灌 n 条：第 i 条的 at 是零填充序号 —— 只关心排序，不关心它像不像时刻 */
function manyEntries(n: number): Record<string, AiCacheEntry> {
  const out: Record<string, AiCacheEntry> = {}
  for (let i = 0; i < n; i++) out[`k${String(i).padStart(3, '0')}`] = { at: String(i).padStart(3, '0'), payload: payload(`p${i}`) }
  return out
}

// ---------------------------------------------------------------- 键

describe('cacheKeyOf：键就是 prompt 的指纹', () => {
  it('同样的三段 → 同样的键（跨进程、跨天的稳定性）', () => {
    expect(cacheKeyOf('deepseek-chat', 'sys', 'user')).toBe(cacheKeyOf('deepseek-chat', 'sys', 'user'))
  })

  it('换模型 / 换系统提示 / 换提问 —— 任何一个变了键就跟着变（失效规则就是哈希本身）', () => {
    const base = cacheKeyOf('deepseek-chat', 'sys', 'user')
    expect(cacheKeyOf('deepseek-reasoner', 'sys', 'user')).not.toBe(base)
    expect(cacheKeyOf('deepseek-chat', 'sys2', 'user')).not.toBe(base)
    expect(cacheKeyOf('deepseek-chat', 'sys', 'user2')).not.toBe(base)
  })

  it('★ 分段无歧义：三段先拼成一个 JSON 数组再哈希，串位拼不出同一个键', () => {
    // 裸拼接 `a + b + c` 的话 ('ab','c','d') 和 ('a','bc','d') 是同一个键 ——
    // 两份不同的提问互相污染，而且**不报错**
    expect(cacheKeyOf('ab', 'c', 'd')).not.toBe(cacheKeyOf('a', 'bc', 'd'))
    expect(cacheKeyOf('a', 'b', 'cd')).not.toBe(cacheKeyOf('a', 'bc', 'd'))
  })

  it('键是 sha256 的十六进制（64 个字符）—— 缓存文件里不留下 prompt 原文', () => {
    expect(cacheKeyOf('m', 's', 'u')).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ---------------------------------------------------------------- 读

describe('cacheGet：没有就是 null（**「没有」不是错误**，调用方照常去问 AI）', () => {
  const KEY = 'k1'

  it('文件还不存在（首次运行）→ null', () => {
    expect(cacheGet(null, KEY)).toBeNull()
  })

  it('文件在、键不在 → null', () => {
    expect(cacheGet(cache(manyEntries(3)), KEY)).toBeNull()
  })

  it('命中 → 原样返回那条', () => {
    const entry: AiCacheEntry = { at: '2026-09-29T10:00:00.000Z', payload: payload('hit') }
    expect(cacheGet(cache({ [KEY]: entry }), KEY)).toEqual(entry)
  })

  it('★ 版本对不上 → 一律当没有（旧版本 payload 的形状可能已经变了）', () => {
    const entry: AiCacheEntry = { at: '2026-09-29T10:00:00.000Z', payload: payload('old') }
    const old = { version: CURRENT_AI_CACHE_VERSION - 1, entries: { [KEY]: entry } } as AiCacheFile
    expect(cacheGet(old, KEY)).toBeNull()
  })

  it('★ entries 是数组 / 条目本身是数组 → null（文件被改坏时别拿数字键当条目）', () => {
    const arrFile = {
      version: CURRENT_AI_CACHE_VERSION,
      entries: [{ at: 'x', payload: payload('a') }]
    } as unknown as AiCacheFile
    expect(cacheGet(arrFile, '0')).toBeNull()

    const arrEntry = {
      version: CURRENT_AI_CACHE_VERSION,
      entries: { [KEY]: [{ at: 'x', payload: payload('a') }] }
    } as unknown as AiCacheFile
    expect(cacheGet(arrEntry, KEY)).toBeNull()
  })

  it('★ payload 没有 items 数组 / at 不是字符串 → null', () => {
    const noItems = {
      version: CURRENT_AI_CACHE_VERSION,
      entries: { [KEY]: { at: 'x', payload: { dropped: 0, reasons: [] } } }
    } as unknown as AiCacheFile
    expect(cacheGet(noItems, KEY)).toBeNull()

    const badAt = {
      version: CURRENT_AI_CACHE_VERSION,
      entries: { [KEY]: { at: 1, payload: payload('a') } }
    } as unknown as AiCacheFile
    expect(cacheGet(badAt, KEY)).toBeNull()
  })

  it('种坏自检：把好条目逐项改坏，同一条判据必须逐个拒绝', () => {
    const good: AiCacheEntry = { at: '2026-09-29T10:00:00.000Z', payload: payload('good') }
    expect(cacheGet(cache({ [KEY]: good }), KEY)).not.toBeNull()
    const bads = [
      { ...good, at: 1 },
      { ...good, payload: null },
      { ...good, payload: { ...good.payload, items: null } }
    ] as unknown as AiCacheEntry[]
    for (const bad of bads) expect(cacheGet(cache({ [KEY]: bad }), KEY)).toBeNull()
  })
})

// ---------------------------------------------------------------- 写

describe('cachePut：存一条，返回要落盘的新文件', () => {
  const KEY = 'k1'
  const NOW = '2026-09-29T10:00:00.000Z'

  it('存进去的东西取得出来，版本补成当前值', () => {
    const next = cachePut(null, KEY, payload('a'), NOW)
    expect(next.version).toBe(CURRENT_AI_CACHE_VERSION)
    expect(cacheGet(next, KEY)).toEqual({ at: NOW, payload: payload('a') })
  })

  it('不改动传进来的那份文件（调用方手里那份还得当旧值用）', () => {
    const before = cache(manyEntries(2))
    const snapshot = JSON.parse(JSON.stringify(before))
    cachePut(before, KEY, payload('a'), NOW)
    expect(before).toEqual(snapshot)
  })

  it('重存同一个键 → 不新增，at 刷新成这次的时间（等于把它挪到"最近写过"）', () => {
    const first = cachePut(null, KEY, payload('old'), '2026-09-01T00:00:00.000Z')
    const second = cachePut(first, KEY, payload('new'), NOW)
    expect(Object.keys(second.entries)).toHaveLength(1)
    expect(second.entries[KEY]).toEqual({ at: NOW, payload: payload('new') })
  })

  it(`写到 ${AI_CACHE_CAP} 条为止**一条都不丢**（边界）`, () => {
    // 注意是 199 + 1：塞满 200 之后再进来一条，就已经是第 201 条、要开始淘汰了
    const full = cache(manyEntries(AI_CACHE_CAP - 1))
    const next = cachePut(full, 'new', payload('x'), 'zzz')
    expect(Object.keys(next.entries)).toHaveLength(AI_CACHE_CAP)
    expect(next.entries.k000, '没超上限却丢了最旧的').toBeDefined()
  })

  it(`第 ${AI_CACHE_CAP + 1} 条进来 → 丢掉 at **最早**的那条（最近还在用的先留下）`, () => {
    const full = cache(manyEntries(AI_CACHE_CAP))
    const next = cachePut(full, 'new', payload('x'), 'zzz')
    expect(Object.keys(next.entries)).toHaveLength(AI_CACHE_CAP)
    expect(next.entries.k000, '该丢的是 at 最早的 k000').toBeUndefined()
    expect(next.entries.k001).toBeDefined()
    expect(next.entries.new).toBeDefined()
  })

  it('★ 重存会刷新 at，所以"最早"的依据是最近一次写入，不是最早一次', () => {
    // k000 本来最旧，但刚被重存过 —— 此刻该丢的是 k001。
    // 若实现淘汰时按"第一次存进来的时间"，这条会红
    const full = cache(manyEntries(AI_CACHE_CAP))
    const refreshed = cachePut(full, 'k000', payload('again'), 'zzz')
    const next = cachePut(refreshed, 'new', payload('x'), 'zzz2')
    expect(next.entries.k000).toBeDefined()
    expect(next.entries.k001).toBeUndefined()
  })
})

// ---------------------------------------------------------------- 落地流程

/**
 * `questionsWithCache`：查 → 问 → 存。
 *
 * 【这个 describe 在守什么】
 *   · **键对得上**：写进缓存的键必须 = 现场用同一份 prompt 独立算出来的键 ——
 *     键算错的坏法是静默的"缓存永远不命中"（每次都白花钱）或者更糟：
 *     拿别人的答案（键撞了）。
 *   · **失败绝不进缓存**：这一条红过一次就是"把偶发故障变成永久故障"。
 *   · **命中不再问**：命中的全部价值就在于省掉那次调用 —— 也顺带钉住
 *     "命中的那份 payload 原样返回"（不能再解析一遍/再铸一次 id）。
 */
describe('questionsWithCache：查 → 问 → 存', () => {
  const TERMS: GlossaryTerm[] = [
    { key: 'loop', originals: ['循环'], cat: 'basic', example: 'for' }
  ]
  const INPUT: AiGenerateInput = {
    topics: [
      { lessonId: 'c-stage1-07', title: 'for 与 while', tags: ['循环'], stems: ['循环跑几圈？'] }
    ],
    count: 3,
    terms: TERMS,
    dateKey: '2026-09-30'
  }
  const MODEL = 'deepseek-chat'
  const NOW = '2026-09-30T08:00:00.000Z'

  /** 现场独立算一遍键 —— 不 import 实现里的私有步骤，直接摆出「键是什么」的定义 */
  function expectedKey(model = MODEL, input = INPUT): string {
    // 和 questionsWithCache 同源：缓存键必须按**真正要发出去的 prompt** 算，
    // 而用户段里的日期（freshness = dateKey）是 prompt 的一部分。
    // 少了这个字段，测试算出来的键和实现永远差一个哈希 —— 真实表现是
    // 「明明存过、第二天却一分钱也省不下来」，而且测试自己不会红（这条已红过）。
    const { system, user } = buildQuestionsPrompt({ ...input, freshness: input.dateKey })
    return cacheKeyOf(model, system, user)
  }

  /** 一份成功的返回值。items 里的题只要求形状过 —— 流程本身不看题目内容 */
  function okResult(mark: string): { ok: true; data: AiParseResult } {
    return {
      ok: true,
      data: {
        items: [
          {
            lessonId: 'c-stage1-07',
            lessonTitle: 'for 与 while',
            question: {
              id: `ai-2026-09-30-${mark}`,
              type: 'choice',
              stem: mark,
              options: ['a', 'b', 'c', 'd'],
              answer: 0,
              explanation: mark
            }
          }
        ],
        dropped: 0,
        reasons: []
      }
    }
  }

  it('★ 未命中 + 成功：问一次、存一次，存的键 = 独立算出的 prompt 指纹', async () => {
    const written: AiCacheFile[] = []
    const generate = vi.fn(async () => okResult('m1'))
    const res = await questionsWithCache({
      dynamicEnabled: true,
      model: MODEL,
      input: INPUT,
      generate,
      read: () => null,
      write: (f) => {
        written.push(f)
      },
      now: () => NOW
    })

    expect(res.ok).toBe(true)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(written).toHaveLength(1)
    expect(Object.keys(written[0].entries)).toEqual([expectedKey()])
    expect(cacheGet(written[0], expectedKey())).toEqual({ at: NOW, payload: okResult('m1').data })
  })

  it('★ 总开关关着：缓存不读、AI 不问、盘不写（渲染层写错也别想绕过）', async () => {
    const read = vi.fn(() =>
      cache({ [expectedKey()]: { at: NOW, payload: okResult('cached').data } })
    )
    const generate = vi.fn(async () => okResult('should-not-run'))
    const write = vi.fn()
    const res = await questionsWithCache({
      dynamicEnabled: false,
      model: MODEL,
      input: INPUT,
      generate,
      read,
      write,
      now: () => NOW
    })

    expect(res).toEqual({ ok: false, reason: 'disabled' })
    expect(read).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('★ 命中：generate 一次都不许被调用，返回的就是缓存里那份 payload，也不再写盘', async () => {
    const cached = okResult('cached').data
    const file: AiCacheFile = cache({
      [expectedKey()]: { at: '2026-09-01T00:00:00.000Z', payload: cached }
    })
    const generate = vi.fn(async () => {
      throw new Error('命中缓存却还去问 AI —— 白花钱')
    })
    const write = vi.fn()

    const res = await questionsWithCache({
      dynamicEnabled: true,
      model: MODEL,
      input: INPUT,
      generate,
      read: () => file,
      write,
      now: () => NOW
    })

    expect(res).toEqual({ ok: true, data: cached })
    expect(generate).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('★ 未命中 + 失败：**一个字节都不写**（缓存了失败，网络恢复了也一直拿它当答案）', async () => {
    const write = vi.fn()
    const res = await questionsWithCache({
      dynamicEnabled: true,
      model: MODEL,
      input: INPUT,
      generate: async () => ({ ok: false, reason: 'offline' }),
      read: () => null,
      write,
      now: () => NOW
    })

    expect(res.ok).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  it('generate 抛异常：异常原样向上抛，同样什么都不写', async () => {
    const write = vi.fn()
    await expect(
      questionsWithCache({
        dynamicEnabled: true,
        model: MODEL,
        input: INPUT,
        generate: async () => {
          throw new Error('boom')
        },
        read: () => null,
        write,
        now: () => NOW
      })
    ).rejects.toThrow('boom')
    expect(write).not.toHaveBeenCalled()
  })

  it('★ 换模型 = 换键：同一份提问在另一个模型名下一律不命中（失效规则就是哈希本身）', async () => {
    // 缓存里是 MODEL 名下的答案 —— 换成别的模型名，键对不上，必须重新问
    const file: AiCacheFile = cache({
      [expectedKey()]: { at: 'x', payload: okResult('old').data }
    })
    const written: AiCacheFile[] = []
    const generate = vi.fn(async () => okResult('new'))
    const res = await questionsWithCache({
      dynamicEnabled: true,
      model: 'deepseek-reasoner',
      input: INPUT,
      generate,
      read: () => file,
      write: (f) => {
        written.push(f)
      },
      now: () => NOW
    })

    expect(generate).toHaveBeenCalledTimes(1)
    expect(res.ok && res.data.items[0].question.stem).toBe('new')
    expect(Object.keys(written[0].entries).sort()).toEqual([expectedKey(), expectedKey('deepseek-reasoner')].sort())
  })

  it('★ 改提问 = 换键：题量/count 变了就不再命中（不然会拿"要 3 道"的答案回"要 8 道"的请求）', async () => {
    const file: AiCacheFile = cache({
      [expectedKey()]: { at: 'x', payload: okResult('3道').data }
    })
    const written: AiCacheFile[] = []
    const generate = vi.fn(async () => okResult('8道'))
    await questionsWithCache({
      dynamicEnabled: true,
      model: MODEL,
      input: { ...INPUT, count: 8 },
      generate,
      read: () => file,
      write: (f) => {
        written.push(f)
      },
      now: () => NOW
    })
    expect(generate).toHaveBeenCalledTimes(1)
    expect(Object.keys(written[0].entries)).toHaveLength(2)
  })
})
