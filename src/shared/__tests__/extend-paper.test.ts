/**
 * 延展候选池的判据。
 *
 * 【种坏值记录】本文件每条断言都先见过它红的样子：
 *   · 把 `it.key !== source.key` 删掉 → 「自己不进池」红
 *   · 把 `it.difficulty !== 'challenge'` 删掉 → 「挑战题不进池」红
 *   · 把 `it.lang === source.lang` 删掉 → 「跨语言题不进池」红
 *   · 把 8 改成 2（同课权重塌了）→ 「同课压过标签」红
 *   · 把 sort 换成 shuffle 后直接 slice（不排序）→ 前四条排序断言红
 *   · 先 sort 后 shuffle（顺序颠倒）→ 「同分内是洗过的顺序」红
 */
import { describe, expect, it } from 'vitest'
import { buildExtendPool, type ExtendSource } from '../extend-paper'
import type { QuestionIndexItem } from '../question-index'
import type { Difficulty, Lang, QuestionType, Stage } from '../types'

/** 造一条索引条目：只写测试关心的字段，其余给不发光的默认值 */
function item(
  key: string,
  opts: Partial<{
    lessonId: string
    lang: Lang
    stage: Stage
    type: QuestionType
    difficulty: Difficulty
    tags: string[]
    stem: string
  }> = {}
): QuestionIndexItem {
  return {
    key,
    lessonId: opts.lessonId ?? key.split(':')[0],
    lang: opts.lang ?? 'python',
    stage: opts.stage ?? 1,
    type: opts.type ?? 'choice',
    difficulty: opts.difficulty ?? 'easy',
    tags: opts.tags ?? [],
    stem: opts.stem ?? key
  }
}

const source: ExtendSource = {
  key: 'python-stage1-01:q1',
  lessonId: 'python-stage1-01',
  lang: 'python',
  tags: ['循环']
}

/**
 * 确定的假随机源：永远返回 0。
 *
 * Fisher-Yates 里 j 恒等于 0，[A,B,C,D] 洗出来是 [B,C,D,A] ——
 * 一个能被手算出来的排列。这比「跑一百次看分布」好：断言写得出确切答案
 */
const zeroRng = () => 0

describe('buildExtendPool', () => {
  it('自己不进池（错题重做管"它自己"，延展管"接着练"）', () => {
    const pool = buildExtendPool([item('python-stage1-01:q1')], source, { rng: zeroRng })
    expect(pool).toEqual([])
  })

  it('挑战题不进池', () => {
    const pool = buildExtendPool(
      [item('python-stage1-02:q1', { difficulty: 'challenge' }), item('python-stage1-02:q2')],
      source,
      { rng: zeroRng }
    )
    expect(pool.map((x) => x.key)).toEqual(['python-stage1-02:q2'])
  })

  it('别的语言的题不进池（硬过滤，不能靠排序兜）', () => {
    const pool = buildExtendPool(
      [item('java-stage1-01:q1', { lang: 'java' }), item('python-stage1-02:q1')],
      source,
      { rng: zeroRng }
    )
    expect(pool.map((x) => x.key)).toEqual(['python-stage1-02:q1'])
  })

  it('同课 > 命中三个标签的别课题（8 > 3×2+1，同课永远压过标签组合）', () => {
    const 同课 = item('python-stage1-01:q2', { lessonId: 'python-stage1-01', type: 'fill' })
    const 三标签 = item('python-stage1-09:q1', { tags: ['循环', '变量', '函数'], type: 'fill' })
    const pool = buildExtendPool([三标签, 同课], { ...source, type: 'choice' }, { rng: zeroRng })
    expect(pool.map((x) => x.key)).toEqual(['python-stage1-01:q2', 'python-stage1-09:q1'])
  })

  it('命中标签 > 不命中（同距离、同题型时）', () => {
    const 命中 = item('python-stage1-07:q1', { tags: ['循环'] })
    const 不命中 = item('python-stage1-08:q1', { tags: ['递归'] })
    const pool = buildExtendPool([不命中, 命中], source, { rng: zeroRng })
    expect(pool.map((x) => x.key)).toEqual(['python-stage1-07:q1', 'python-stage1-08:q1'])
  })

  it('同题型在分数相同时多拿一分（1 个标签 + 异题型 < 1 个标签 + 同题型）', () => {
    // 两边都是"别课、命中 1 个标签"；题型不同，同题型的那个该在前面。
    // 这条专门钉 +1 的存在：把 type 那行删掉，两者同分，
    // 输出就退化成洗牌顺序（=[B,C,D,A] 里谁在前看输入位置），这条会红
    const 异题型 = item('python-stage1-07:q1', { tags: ['循环'], type: 'fill' })
    const 同题型 = item('python-stage1-08:q1', { tags: ['循环'], type: 'choice' })
    const pool = buildExtendPool([异题型, 同题型], { ...source, type: 'choice' }, { rng: zeroRng })
    expect(pool.map((x) => x.key)).toEqual(['python-stage1-08:q1', 'python-stage1-07:q1'])
  })

  it('来源题没有 type 时，同题型这一项作废（不猜一个默认值）', () => {
    // 两道题分数完全一样，输出只能是洗牌顺序([B,C,D,A] 的两人版：[B,A])
    const a = item('python-stage1-07:q1', { type: 'choice' })
    const b = item('python-stage1-08:q1', { type: 'fill' })
    const pool = buildExtendPool([a, b], source, { rng: zeroRng })
    expect(pool.map((x) => x.key)).toEqual(['python-stage1-08:q1', 'python-stage1-07:q1'])
  })

  it('同分内是**先洗牌**的顺序（先排后洗会红）', () => {
    // 四道题全部同分（异课、无标签、source 不带 type）：输出就是洗过的顺序。
    // rng 恒 0 时 Fisher-Yates 把 [A,B,C,D] 洗成 [B,C,D,A]，手算得出
    const four = ['q1', 'q2', 'q3', 'q4'].map((q, i) =>
      item(`python-stage1-0${i + 2}:${q}`, { lessonId: `python-stage1-0${i + 2}` })
    )
    const pool = buildExtendPool(four, source, { rng: zeroRng })
    expect(pool.map((x) => x.key)).toEqual([
      'python-stage1-03:q2',
      'python-stage1-04:q3',
      'python-stage1-05:q4',
      'python-stage1-02:q1'
    ])
  })

  it('limit 截断，默认上限 10 道', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      item(`python-stage1-20:q${i + 1}`, { lessonId: 'python-stage1-20' })
    )
    expect(buildExtendPool(many, source, { rng: zeroRng })).toHaveLength(10)
    expect(buildExtendPool(many, source, { rng: zeroRng, limit: 5 })).toHaveLength(5)
    // limit 负数/0 = 不要 —— 返回空而不是"给一条"（不能悄悄修调用方的错）
    expect(buildExtendPool(many, source, { rng: zeroRng, limit: 0 })).toEqual([])
    expect(buildExtendPool(many, source, { rng: zeroRng, limit: -3 })).toEqual([])
  })

  it('池子比 limit 小就给全部（不凑数、不重复）', () => {
    const two = [item('python-stage1-02:q1'), item('python-stage1-02:q2')]
    const pool = buildExtendPool(two, source, { rng: zeroRng })
    expect(pool).toHaveLength(2)
    expect(new Set(pool.map((x) => x.key)).size).toBe(2)
  })
})
