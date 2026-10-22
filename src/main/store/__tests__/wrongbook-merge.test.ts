/**
 * wrongbook.json 的合并与裁剪（src/main/store/wrongbook-merge.ts）
 *
 * 【这个文件在守什么】
 * 三条规矩，错了**一条都不会报错**：
 *
 *   1. **AI 题必须带本体**。少了它，错题本里就是一条死条目：题干显示成
 *      「题目已被移走喵」、点重做被静默跳过、答对了也消除不掉。所以在写盘
 *      之前当场拒掉 —— 写进去之后就再也没人会发现。
 *   2. **内置题不许带本体**。带了就是第二份真源：将来改了内容包，
 *      错题本里那份还是旧的，而用户看不出区别。
 *   3. **AI 题封顶**。超了就丢最久没做错的那条，否则每天错 5 道的用户
 *      一年能攒下 1800 条带本体的记录，错题本再也翻不动。
 */

import { describe, expect, it, vi } from 'vitest'
import {
  applyWrongRecord,
  applyWrongUpdate,
  assertWrongRecordItem,
  findRevivedKeys,
  mergeWrongRecord,
  normalizeWrongbook
} from '../wrongbook-merge'
import {
  AI_WRONG_CAP,
  CURRENT_WRONGBOOK_VERSION,
  type Question,
  type WrongBookEntry
} from '../../../shared/types'

function q(id: string): Question {
  return { id, type: 'fill', stem: `题干 ${id}`, answer: 'x', explanation: '解析' }
}

const AI_KEY = 'common-01:ai-2026-09-13-1'

/** 造一条已经在库里的错题 */
function stored(key: string, over: Partial<WrongBookEntry> = {}): WrongBookEntry {
  const sep = key.indexOf(':')
  return {
    key,
    lessonId: key.slice(0, sep),
    qid: key.slice(sep + 1),
    wrongCount: 1,
    lastWrongAt: '2026-09-01T10:00:00.000Z',
    cleared: false,
    ...over
  }
}

/** 灌 n 条 AI 错题，第 i 条的 lastWrongAt 是 9 月 i 日（越靠后越新） */
function manyAi(n: number, over: (i: number) => Partial<WrongBookEntry> = () => ({})) {
  return Array.from({ length: n }, (_, i) =>
    stored(`common-01:ai-2026-09-${String(i + 1).padStart(2, '0')}-1`, {
      lastWrongAt: `2026-09-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`,
      ai: q(`ai-2026-09-${String(i + 1).padStart(2, '0')}-1`),
      ...over(i)
    })
  )
}

// ---------------------------------------------------------------- 形状校验

describe('形状校验：写之前拦住，写进去就没人发现了', () => {
  it('**AI 题不带本体 → 抛**（这条就是死条目的源头）', () => {
    expect(() => assertWrongRecordItem({ key: AI_KEY })).toThrow()
  })

  it('AI 题带了本体 → 放行', () => {
    expect(() => assertWrongRecordItem({ key: AI_KEY, ai: q('ai-2026-09-13-1') })).not.toThrow()
  })

  it('内置题不需要本体', () => {
    expect(() => assertWrongRecordItem({ key: 'common-01:q1' })).not.toThrow()
  })

  it('key 必须是像样的字符串', () => {
    expect(() => assertWrongRecordItem({ key: '' })).toThrow()
    expect(() => assertWrongRecordItem({ key: 42 })).toThrow()
    expect(() => assertWrongRecordItem(null)).toThrow()
  })

  it('ai 给了就必须是个对象（给字符串/null 是调用方写错了）', () => {
    expect(() => assertWrongRecordItem({ key: 'common-01:q1', ai: '题干' })).toThrow()
    expect(() => assertWrongRecordItem({ key: 'common-01:q1', ai: null })).toThrow()
  })
})

// ---------------------------------------------------------------- 合并

describe('合并：新的进来、旧的次数加一', () => {
  it('空记录上记第一条', () => {
    const out = mergeWrongRecord(null, [{ key: 'common-01:q1' }], '2026-09-13T10:00:00.000Z')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ key: 'common-01:q1', lessonId: 'common-01', qid: 'q1', wrongCount: 1 })
    expect(out[0].cleared).toBe(false)
  })

  it('同一个 key 再错一次是次数加一，不是多一条', () => {
    const out = mergeWrongRecord(
      [stored('common-01:q1')],
      [{ key: 'common-01:q1' }],
      '2026-09-13T10:00:00.000Z'
    )
    expect(out).toHaveLength(1)
    expect(out[0].wrongCount).toBe(2)
    expect(out[0].lastWrongAt).toBe('2026-09-13T10:00:00.000Z')
  })

  it('**毕业过的题再错一次要复活**，clearedAt 也要抹掉', () => {
    const out = mergeWrongRecord(
      [stored('common-01:q1', { cleared: true, clearedAt: '2026-09-02T10:00:00.000Z' })],
      [{ key: 'common-01:q1' }],
      '2026-09-13T10:00:00.000Z'
    )
    expect(out[0].cleared).toBe(false)
    expect(out[0].clearedAt).toBeUndefined()
  })

  it('**内置题带上来的本体被丢掉** —— 不让上游的 bug 写进磁盘', () => {
    const out = mergeWrongRecord(
      null,
      [{ key: 'common-01:q1', ai: q('q1') }],
      '2026-09-13T10:00:00.000Z'
    )
    expect(out[0].ai).toBeUndefined()
  })

  it('AI 题的本体存进去了', () => {
    const body = q('ai-2026-09-13-1')
    const out = mergeWrongRecord(null, [{ key: AI_KEY, ai: body }], '2026-09-13T10:00:00.000Z')
    expect(out[0].ai).toEqual(body)
  })

  it('AI 题再错一次，本体跟着刷新（同一条题意上应当一样，但以最新的为准）', () => {
    const out = mergeWrongRecord(
      [stored(AI_KEY, { ai: q('ai-2026-09-13-1') })],
      [{ key: AI_KEY, ai: { ...q('ai-2026-09-13-1'), stem: '改过的题干' } }],
      '2026-09-13T10:00:00.000Z'
    )
    expect(out).toHaveLength(1)
    expect(out[0].ai?.stem).toBe('改过的题干')
  })

  it('不改动传进来的那份数组（写盘前的那份不能被就地改坏）', () => {
    const before = [stored('common-01:q1')]
    const snapshot = JSON.parse(JSON.stringify(before))
    mergeWrongRecord(before, [{ key: 'common-01:q1' }], '2026-09-13T10:00:00.000Z')
    expect(before).toEqual(snapshot)
  })

  it('空入参 → 原样返回', () => {
    expect(mergeWrongRecord(null, [], '2026-09-13T10:00:00.000Z')).toEqual([])
  })
})

// ---------------------------------------------------------------- AI 题封顶

describe(`AI 题封顶（${AI_WRONG_CAP} 条）：丢最久没做错的那条`, () => {
  it(`刚到 ${AI_WRONG_CAP} 条**一条都不丢**（边界就是 30，不是 29）`, () => {
    const out = mergeWrongRecord(manyAi(AI_WRONG_CAP), [], '2026-09-13T10:00:00.000Z')
    expect(out).toHaveLength(AI_WRONG_CAP)
  })

  it(`第 ${AI_WRONG_CAP + 1} 条进来 → 丢掉最旧的那条`, () => {
    const out = mergeWrongRecord(manyAi(AI_WRONG_CAP), [
      { key: 'common-01:ai-2026-10-01-1', ai: q('ai-2026-10-01-1') }
    ], '2026-09-13T10:00:00.000Z')
    // 新的记的是 wrongCount:1、lastWrongAt 是外面传的 now；
    // 这里只看「谁被丢了」—— 最旧的 09-01 那条
    expect(out).toHaveLength(AI_WRONG_CAP)
    expect(out.find((e) => e.key === 'common-01:ai-2026-09-01-1')).toBeUndefined()
    expect(out.find((e) => e.key === 'common-01:ai-2026-09-02-1')).toBeDefined()
    expect(out.find((e) => e.key === 'common-01:ai-2026-10-01-1')).toBeDefined()
  })

  it('**内置题永远不被这条上限波及** —— 无论攒了多少内置错题', () => {
    const builtIn = Array.from({ length: 80 }, (_, i) => stored(`common-01:q${i + 1}`))
    const out = mergeWrongRecord(
      [...builtIn, ...manyAi(AI_WRONG_CAP + 5)],
      [],
      '2026-09-13T10:00:00.000Z'
    )
    expect(out.filter((e) => !e.qid.startsWith('ai-'))).toHaveLength(80)
    expect(out.filter((e) => e.qid.startsWith('ai-'))).toHaveLength(AI_WRONG_CAP)
  })

  it('**毕业的 AI 题排在队尾、先被丢** —— lastWrongAt 停在当初做错那天', () => {
    // 29 条没毕业的（09-02..09-30）+ 1 条早就毕业的（09-01），再加一条新的
    const alive = manyAi(AI_WRONG_CAP).slice(1) // 丢掉 09-01，剩 29 条
    const graduated = stored('common-01:ai-2026-09-01-1', {
      lastWrongAt: '2026-09-01T10:00:00.000Z',
      ai: q('ai-2026-09-01-1'),
      cleared: true,
      clearedAt: '2026-09-02T10:00:00.000Z'
    })
    const out = mergeWrongRecord(
      [...alive, graduated],
      [{ key: 'common-01:ai-2026-10-01-1', ai: q('ai-2026-10-01-1') }],
      '2026-09-13T10:00:00.000Z'
    )
    expect(out).toHaveLength(AI_WRONG_CAP)
    // 毕业那条最旧，先走 —— 用户已经把它做对了，留它最没价值
    expect(out.find((e) => e.key === 'common-01:ai-2026-09-01-1')).toBeUndefined()
  })

  it('一次进来好几条也裁得对（不是只裁一条）', () => {
    const out = mergeWrongRecord(
      manyAi(AI_WRONG_CAP),
      Array.from({ length: 4 }, (_, i) => ({
        key: `common-01:ai-2026-10-0${i + 1}-1`,
        ai: q(`ai-2026-10-0${i + 1}-1`)
      })),
      '2026-09-13T10:00:00.000Z'
    )
    expect(out).toHaveLength(AI_WRONG_CAP)
    // 最新的四条都在
    for (let i = 1; i <= 4; i++) {
      expect(out.find((e) => e.key === `common-01:ai-2026-10-0${i}-1`)).toBeDefined()
    }
  })

  it('裁剪后留下的每一条**都还带着本体**（不能裁出一条死条目）', () => {
    const out = mergeWrongRecord(manyAi(AI_WRONG_CAP + 3), [], '2026-09-13T10:00:00.000Z')
    for (const e of out.filter((x) => x.qid.startsWith('ai-'))) {
      expect(e.ai).toBeDefined()
    }
  })
})

// ---------------------------------------------------------------- 上限 × 已移除

describe('AI 封顶 × 已移除：删过的不占名额，也不被丢', () => {
  it('★ 31 条里 1 条删过 → 活着的 30 条**一条都不丢**（删掉的不挤名额）', () => {
    // 若 trimAi 忘了滤 `!e.removed`：ai 列表数成 31，超上限 1 条 →
    // 丢掉的正好是「最旧的」那条 —— 而它就是刚被用户删掉的那条。
    // 账就对不上了：用户明明只删了一条，活着的却少了一条
    const list = manyAi(AI_WRONG_CAP + 1)
    list[0].removed = true
    list[0].removedAt = '2026-09-20T10:00:00.000Z'
    const out = mergeWrongRecord(list, [], '2026-09-13T10:00:00.000Z')
    expect(out).toHaveLength(AI_WRONG_CAP + 1)
    expect(
      out.find((e) => e.key === 'common-01:ai-2026-09-02-1'),
      '活着的最旧那条被误丢了'
    ).toBeDefined()
  })

  it('★ 活着的超上限要裁时只裁活着的，已移除的绝不动（回收站不倒自己的垃圾）', () => {
    // 软删的全部意义就是「还能恢复」。顺手裁掉一批已移除的 AI 题，
    // 等于用户点开「已移除」筛选想恢复时，东西已经不在了 —— 而他没删过第二次
    const alive = manyAi(AI_WRONG_CAP + 1) // 09-01 .. 09-31，31 条活着的
    const binned = stored('common-01:ai-2026-08-01-1', {
      lastWrongAt: '2026-08-01T10:00:00.000Z',
      ai: q('ai-2026-08-01-1'),
      removed: true,
      removedAt: '2026-09-20T10:00:00.000Z'
    })
    const out = mergeWrongRecord([binned, ...alive], [], '2026-09-13T10:00:00.000Z')
    // 裁掉的该是活着的最旧那条（09-01），而不是更旧的回收站条目（08-01）
    expect(out.find((e) => e.key === 'common-01:ai-2026-09-01-1')).toBeUndefined()
    expect(
      out.find((e) => e.key === 'common-01:ai-2026-08-01-1'),
      '已移除的被裁剪丢掉了'
    ).toBeDefined()
    expect(out).toHaveLength(AI_WRONG_CAP + 1)
  })
})

// ---------------------------------------------------------------- 来源徽章

describe('来源徽章（source）：记的是「最近一次在哪错的」', () => {
  const NOW = '2026-09-13T10:00:00.000Z'

  it('新条目带 source → 存进去', () => {
    const out = mergeWrongRecord(null, [{ key: 'common-01:q1', source: 'random' }], NOW)
    expect(out[0].source).toBe('random')
  })

  it('新条目**不带** source → 连字段都不写（不是写一个 undefined 进去）', () => {
    // 老调用点（还没升级的记账点）照样能用，只是没有徽章。
    // 断言「字段在不在」而不是「值是不是 undefined」：后者对 JSON 序列化没区别，
    // 但前者能钉住「缺席 = 没有」这条读法，筛选器不用去分辨 false 和 undefined
    const out = mergeWrongRecord(null, [{ key: 'common-01:q1' }], NOW)
    expect('source' in out[0]).toBe(false)
  })

  it('老条目再错、这次带 source → 徽章换成最新的', () => {
    const out = mergeWrongRecord(
      [stored('common-01:q1', { source: 'lesson' })],
      [{ key: 'common-01:q1', source: 'challenge' }],
      NOW
    )
    expect(out[0].source).toBe('challenge')
  })

  it('★ 老条目再错、这次**没带** source → 原徽章留住（不能被顺手抹掉）', () => {
    // 对着实现里 `if (item.source)` 那个写法：写成 `ex.source = item.source`
    // 的话徽章会变成 undefined —— 没有报错、没有异常，只是一枚徽章悄悄没了
    const out = mergeWrongRecord(
      [stored('common-01:q1', { source: 'wrong' })],
      [{ key: 'common-01:q1' }],
      NOW
    )
    expect(out[0].source).toBe('wrong')
  })

  it('source 是空串或非字符串 → 当场拒掉（空串会渲染成一片空白徽章）', () => {
    expect(() => assertWrongRecordItem({ key: 'common-01:q1', source: '' })).toThrow()
    expect(() => assertWrongRecordItem({ key: 'common-01:q1', source: 42 })).toThrow()
  })
})

// ---------------------------------------------------------------- 再答错 = 从「已移除」复活

describe('手动删掉的（removed）再答错 → 复活', () => {
  const NOW = '2026-09-13T10:00:00.000Z'

  it('★ removed / removedAt **两个字段一起消失**，计数继续累加', () => {
    // 规格钦定：再答错即使被删也恢复成在库、计数继续加。
    // 只把 removed 置 false 的实现会在这里红：孤儿的 removedAt 还躺在文件里
    const out = mergeWrongRecord(
      [stored('common-01:q1', { wrongCount: 3, removed: true, removedAt: '2026-09-10T10:00:00.000Z' })],
      [{ key: 'common-01:q1' }],
      NOW
    )
    expect(out[0].wrongCount).toBe(4)
    expect('removed' in out[0]).toBe(false)
    expect('removedAt' in out[0]).toBe(false)
  })

  it('复活**不动漏洞标记**：那是用户自己标的，不该被「又错一次」抹掉', () => {
    const out = mergeWrongRecord(
      [stored('common-01:q1', { removed: true, removedAt: '2026-09-10T10:00:00.000Z', hole: true })],
      [{ key: 'common-01:q1' }],
      NOW
    )
    expect(out[0].hole).toBe(true)
  })
})

// ---------------------------------------------------------------- 复活名单（给 toast 用）

describe('findRevivedKeys：谁被「删过又答错」了（必须在 merge **之前**问）', () => {
  const NOW = '2026-09-13T10:00:00.000Z'

  it('★ 删过的连着一起报，没删过的一条都不报', () => {
    const all = [
      stored('common-01:q1', { removed: true, removedAt: '2026-09-10T10:00:00.000Z' }),
      stored('common-01:q2'), // 在库
      stored('common-01:q3', { cleared: true, clearedAt: '2026-09-02T10:00:00.000Z' }) // 毕业过
    ]
    expect(findRevivedKeys(all, [{ key: 'common-01:q1' }])).toEqual(['common-01:q1'])
    // 在库/毕业的再错是"计数加一"（各自的老语义），不是"复活"，不该弹"你删过"
    expect(findRevivedKeys(all, [{ key: 'common-01:q2' }, { key: 'common-01:q3' }])).toEqual([])
  })

  it('★ 合并之后再来问，就什么都问不到了（这就是"必须 merge 前问"的物证）', () => {
    // mergeWrongRecord 复活时会 delete removed/removedAt —— 合并后的记录
    // 和一条从没被删过的长得一模一样。这条测试把"时机只有一次"钉成可执行的事实：
    // 谁要是把 findRevivedKeys 挪到 merge 后面，返回值就是恒空，
    // 「你删过的那道题又答错了」这句提示会**安静地**永远不出现
    const all = [stored('common-01:q1', { removed: true, removedAt: '2026-09-10T10:00:00.000Z' })]
    const items = [{ key: 'common-01:q1' }]
    expect(findRevivedKeys(all, items)).toEqual(['common-01:q1']) // 合并前：问得到
    const merged = mergeWrongRecord(all, items, NOW)
    expect(findRevivedKeys(merged, items)).toEqual([]) // 合并后：证据已经没了
  })

  it('同一批里同一个 key 出现两次 → 只报一次（不许弹两条一样的 toast）', () => {
    const all = [stored('common-01:q1', { removed: true })]
    expect(findRevivedKeys(all, [{ key: 'common-01:q1' }, { key: 'common-01:q1' }])).toEqual([
      'common-01:q1'
    ])
  })

  it('★ 删过的是 AI 题（带本体）也照样认 —— 判据只有 key', () => {
    const all = [stored(AI_KEY, { ai: q('ai-2026-09-13-1'), removed: true })]
    expect(findRevivedKeys(all, [{ key: AI_KEY, ai: q('ai-2026-09-13-1') }])).toEqual([AI_KEY])
  })

  it('坏条目跳过、不抛（校验是 assertWrongRecordItem / merge 的活，这里只挑名单）', () => {
    const all = [stored('common-01:q1', { removed: true })]
    expect(
      findRevivedKeys(all, [null, 'nope', { key: 42 }, { key: 'common-01:q1' }] as never)
    ).toEqual(['common-01:q1'])
  })

  it('空入参 / 空记录 → 空名单', () => {
    expect(findRevivedKeys([], [{ key: 'common-01:q1' }])).toEqual([])
    expect(
      findRevivedKeys([stored('common-01:q1', { removed: true })], [])
    ).toEqual([])
  })
})

// ---------------------------------------------------------------- 记一次账（组合）

describe('applyWrongRecord：一次调用里同时给出「合并结果」和「复活名单」', () => {
  const NOW = '2026-09-13T10:00:00.000Z'

  it('★ 顺序钉死：删过的那条**既**被算进复活名单、**也**在结果里复活（计数 +1、removed 不见了）', () => {
    // 这条把两件事锁在同一次调用里 —— 顺序反了（先 merge 再问）时，
    // revived 会是空数组，而这正是"提示永久沉默"那个 bug 的唯一入口。
    // 拆成两次调用的话（调用方自己先问再合），就没有任何测试能守住这个顺序
    const { entries, revived } = applyWrongRecord(
      [stored('common-01:q1', { wrongCount: 3, removed: true, removedAt: '2026-09-10T10:00:00.000Z' })],
      [{ key: 'common-01:q1', source: 'extend' }],
      NOW
    )
    expect(revived).toEqual(['common-01:q1'])
    expect(entries[0].wrongCount).toBe(4)
    expect('removed' in entries[0]).toBe(false)
    expect(entries[0].source).toBe('extend')
  })

  it('没删过的再错：结果照常并入，名单是空的（"不弹提示"也是这个函数的输出）', () => {
    const { entries, revived } = applyWrongRecord(
      [stored('common-01:q1')],
      [{ key: 'common-01:q2' }],
      NOW
    )
    expect(revived).toEqual([])
    expect(entries.map((e) => e.key).sort()).toEqual(['common-01:q1', 'common-01:q2'])
  })

  it('首次运行（all 为 null）不炸，且名单为空', () => {
    const { entries, revived } = applyWrongRecord(null, [{ key: 'common-01:q1' }], NOW)
    expect(revived).toEqual([])
    expect(entries).toHaveLength(1)
  })

  it('入参写错照抛（校验还在 merge 那条路上，没有被组合函数吞掉）', () => {
    expect(() => applyWrongRecord(null, [{ key: AI_KEY }] as never, NOW)).toThrow()
  })
})

// ---------------------------------------------------------------- 读口：信封

/** 跑一段会对坏文件出声的代码，把 warn 收走（大多数用例不关心出声与否） */
function silent<T>(fn: () => T): T {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    return fn()
  } finally {
    warn.mockRestore()
  }
}

describe('normalizeWrongbook：老文件（裸数组）与坏文件', () => {
  const EMPTY_FILE = { version: CURRENT_WRONGBOOK_VERSION, entries: [] }

  it('文件不存在（null / undefined）→ 空信封，但**不标重写**', () => {
    // 首次运行。空手建一个文件没意义，等第一条错题进来自然就有了 ——
    // 无条件写盘的话，每开一次应用就建一个空文件，还会把 .bak 顶掉
    for (const raw of [null, undefined]) {
      expect(normalizeWrongbook(raw)).toEqual({ file: EMPTY_FILE, needsRewrite: false })
    }
  })

  it('★ 老文件是**裸数组** → 照认，并标重写（这次重写的意义就是换成信封）', () => {
    // 这是兼容旧版的核心一条：根从裸数组换成信封，老文件里
    // 哪怕一条都不脏，也要写回一次把它变成信封
    const raw = [
      {
        key: 'common-01:q1',
        lessonId: 'common-01',
        qid: 'q1',
        wrongCount: 2,
        lastWrongAt: '2026-09-01T10:00:00.000Z',
        cleared: false
      }
    ]
    const { file, needsRewrite } = normalizeWrongbook(raw)
    expect(file.version).toBe(CURRENT_WRONGBOOK_VERSION)
    expect(file.entries).toHaveLength(1)
    expect(file.entries[0].wrongCount).toBe(2)
    expect(needsRewrite).toBe(true)
  })

  it('整份坏掉（字符串 / 数字 / {} / entries 不是数组）→ 空信封 + 重写 + **每次都出声**', () => {
    // 铁律禁止静默重建：用户报「我的错题全没了」时日志里必须有一个字。
    // 重写不会真抹掉原件 —— json-store 落盘前会先把坏的备份成 .bak
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (const raw of ['nope', 42, {}, { entries: 'x' }, { entries: null }]) {
        const { file, needsRewrite } = normalizeWrongbook(raw)
        expect(file).toEqual(EMPTY_FILE)
        expect(needsRewrite).toBe(true)
      }
      expect(warn).toHaveBeenCalledTimes(5)
    } finally {
      warn.mockRestore()
    }
  })

  it('信封但**版本不认识**（99 / 没写）→ 条目照读，标重写', () => {
    // 宁可多认一份「未来的文件」，也不要把它当坏文件清掉（同 config 的取舍）
    const e = { key: 'common-01:q1', wrongCount: 1, lastWrongAt: '2026-09-01T10:00:00.000Z' }
    for (const version of [99, undefined]) {
      const { file, needsRewrite } = normalizeWrongbook({ version, entries: [e] })
      expect(file.entries).toHaveLength(1)
      expect(needsRewrite).toBe(true)
    }
  })

  it('★ 信封、版本正确、条目干净 → needsRewrite **false**（别每次启动重写文件）', () => {
    // 读口每次启动都会跑。无条件写盘的话，正常用户每开一次应用
    // 错题本就被重写一遍（还把 .bak 顶掉）—— 什么都没变，磁盘却在响
    const raw = {
      version: CURRENT_WRONGBOOK_VERSION,
      entries: [{ key: 'common-01:q1', wrongCount: 1, lastWrongAt: '2026-09-01T10:00:00.000Z' }]
    }
    expect(normalizeWrongbook(raw).needsRewrite).toBe(false)
  })
})

// ---------------------------------------------------------------- 读口：条目清洗

describe('normalizeWrongbook：条目清洗（坏条目丢 + 出声，好的照留）', () => {
  /** 一份版本正确的信封，方便只关心 entries 的用例 */
  const env = (entries: unknown[]) => ({
    version: CURRENT_WRONGBOOK_VERSION,
    entries
  })

  it('★ lessonId / qid **一律从 key 重算**，不听文件里那份', () => {
    // 它们是派生值，key 才是身份。文件被手改过、或早期版本拆错过时，
    // 信谁就成了随机选择 —— 信 key，因为所有判据（isAiKey、找题、重做）
    // 实际用的都是 key。这条红了说明有地方开始信文件里那份
    const { file } = silent(() =>
      normalizeWrongbook(env([{ key: 'common-01:q7', lessonId: 'evil-course', qid: 'evil', wrongCount: 1 }]))
    )
    expect(file.entries[0].lessonId).toBe('common-01')
    expect(file.entries[0].qid).toBe('q7')
  })

  it('AI 题**没有本体** → 丢掉并出声（那种点不开、消除不掉的死条目）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { file, needsRewrite } = normalizeWrongbook(env([{ key: AI_KEY, wrongCount: 1 }]))
      expect(file.entries).toHaveLength(0)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(needsRewrite).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  it('key 不是字符串 / 空串 → 丢；非对象的条目 → 丢', () => {
    const { file } = silent(() => normalizeWrongbook(env([null, 'nope', { key: '' }, { key: 42 }])))
    expect(file.entries).toHaveLength(0)
  })

  it('同一个 key 出现两次 → **留第一条**（和 merge 的 find 取第一条一致），多出来的出声', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { file } = normalizeWrongbook(
        env([
          { key: 'common-01:q1', wrongCount: 1, lastWrongAt: '2026-09-01T10:00:00.000Z' },
          { key: 'common-01:q1', wrongCount: 9, lastWrongAt: '2026-09-02T10:00:00.000Z' }
        ])
      )
      expect(file.entries).toHaveLength(1)
      expect(file.entries[0].wrongCount).toBe(1)
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('★ removed / hole **只在 true 时写字段**（false 和 undefined 都不写）', () => {
    // 「字段在不在」和「是不是真的」必须永远同向，筛选器只有一种读法。
    // 写成 `entry.removed = raw.removed === true`（无条件写 false）会在这里红
    const { file } = silent(() =>
      normalizeWrongbook(
        env([
          { key: 'common-01:q1', removed: false, hole: false },
          { key: 'common-01:q2', removed: true, hole: true }
        ])
      )
    )
    const [a, b] = file.entries
    expect('removed' in a).toBe(false)
    expect('hole' in a).toBe(false)
    expect(b.removed).toBe(true)
    expect(b.hole).toBe(true)
  })

  it('时刻坏掉 → 按「最古老」兜底（1970）；次数坏掉 → 至少 1', () => {
    // 「在错题本里」就意味着至少错过一次，界面上「错过 0 次」是句自相矛盾的话。
    // 时刻兜底成最古老：trimAi 真要丢 AI 题时第一个丢它
    const { file } = silent(() =>
      normalizeWrongbook(
        env([
          { key: 'common-01:q1', lastWrongAt: '', wrongCount: 0 },
          { key: 'common-01:q2', lastWrongAt: 42, wrongCount: -5 },
          { key: 'common-01:q3', lastWrongAt: '   ', wrongCount: '3' }
        ])
      )
    )
    for (const e of file.entries) {
      expect(e.lastWrongAt).toBe('1970-01-01T00:00:00.000Z')
      expect(e.wrongCount).toBe(1)
    }
  })

  it('毕业（cleared）成立，但 clearedAt 坏掉时字段缺席（不留一个坏时刻）', () => {
    const { file } = silent(() =>
      normalizeWrongbook(env([{ key: 'common-01:q1', cleared: true, clearedAt: 42 }]))
    )
    expect(file.entries[0].cleared).toBe(true)
    expect('clearedAt' in file.entries[0]).toBe(false)
  })

  it('内置题即使文件里带着本体也不收（第二份真源，宁可不要）', () => {
    const { file } = silent(() =>
      normalizeWrongbook(env([{ key: 'common-01:q1', ai: { id: 'q1', type: 'fill', stem: 'x' } }]))
    )
    expect(file.entries[0].ai).toBeUndefined()
  })

  it('source 是空串/坏值时字段缺席（老文件没有它，坏值等同于没有）', () => {
    const { file } = silent(() =>
      normalizeWrongbook(
        env([{ key: 'common-01:q1', source: '   ' }, { key: 'common-01:q2', source: 42 }])
      )
    )
    expect('source' in file.entries[0]).toBe(false)
    expect('source' in file.entries[1]).toBe(false)
  })
})

// ---------------------------------------------------------------- 手动标记

describe('applyWrongUpdate：手动删 / 恢复 / 标漏洞', () => {
  const NOW = '2026-09-29T10:00:00.000Z'

  it('软删：removed 置上、removedAt 用传进来的 now', () => {
    const out = applyWrongUpdate([stored('common-01:q1')], [{ key: 'common-01:q1', patch: { removed: true } }], NOW)
    expect(out[0].removed).toBe(true)
    expect(out[0].removedAt).toBe(NOW)
  })

  it('★ 恢复：removed / removedAt **一起摘**（不留孤儿时刻）', () => {
    // 「什么时候删的」在恢复之后不该再有任何含义。只置 removed=false
    // 的实现会在这里红：文件里躺着个没人读、也没人清的 removedAt
    const out = applyWrongUpdate(
      [stored('common-01:q1', { removed: true, removedAt: '2026-09-10T10:00:00.000Z' })],
      [{ key: 'common-01:q1', patch: { removed: false } }],
      NOW
    )
    expect('removed' in out[0]).toBe(false)
    expect('removedAt' in out[0]).toBe(false)
  })

  it('漏洞标记：true 上旗、false 摘旗', () => {
    const on = applyWrongUpdate([stored('common-01:q1')], [{ key: 'common-01:q1', patch: { hole: true } }], NOW)
    expect(on[0].hole).toBe(true)
    const off = applyWrongUpdate(
      [stored('common-01:q1', { hole: true })],
      [{ key: 'common-01:q1', patch: { hole: false } }],
      NOW
    )
    expect('hole' in off[0]).toBe(false)
  })

  it('一条更新**只碰它点名的那一项**（标漏洞不许顺手清掉 removed）', () => {
    // patch 里 `undefined` 的语义是「这次不碰这一项」。实现若写成
    // `ex.hole = patch.hole`（无条件赋值）会把 hole 抹成 undefined —— 静默丢标记
    const out = applyWrongUpdate(
      [stored('common-01:q1', { removed: true, removedAt: '2026-09-10T10:00:00.000Z', hole: true })],
      [{ key: 'common-01:q1', patch: { hole: true } }],
      NOW
    )
    expect(out[0].removed).toBe(true)
    expect(out[0].removedAt).toBe('2026-09-10T10:00:00.000Z')
    expect(out[0].hole).toBe(true)
  })

  it('★ key 找不到 → 跳过、不抛，同一批里别的条目照常处理', () => {
    // 更新的来源是列表页的行内动作，而那份列表是**快照**：
    // 手速快于一次刷新就会出现「这条已经不在列表里」。
    // 为一个已经消失的条目炸掉整次请求，用户看到的是一次什么都做不了的报错
    const out = applyWrongUpdate(
      [stored('common-01:q1')],
      [
        { key: 'common-01:gone', patch: { removed: true } },
        { key: 'common-01:q1', patch: { hole: true } }
      ],
      NOW
    )
    expect(out).toHaveLength(1)
    expect(out[0].hole).toBe(true)
  })

  it('**整个入参写错**照抛：key 空 / patch 不是对象 / patch 里塞非布尔', () => {
    // 和 record 那条路一个规矩：那是调用方写错了，该炸得响亮
    const bad: unknown[] = [
      null,
      { key: '', patch: {} },
      { key: 'common-01:q1' },
      { key: 'common-01:q1', patch: { removed: 'yes' } },
      { key: 'common-01:q1', patch: { hole: 1 } }
    ]
    for (const u of bad) {
      expect(() => applyWrongUpdate([stored('common-01:q1')], [u as never], NOW), String(u)).toThrow()
    }
  })

  it('不改动传进来的那份数组（写盘前的那份不能被就地改坏）', () => {
    const before = [stored('common-01:q1')]
    const snapshot = JSON.parse(JSON.stringify(before))
    applyWrongUpdate(before, [{ key: 'common-01:q1', patch: { removed: true } }], NOW)
    expect(before).toEqual(snapshot)
  })
})
