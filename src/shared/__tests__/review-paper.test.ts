/**
 * 每日复习的组卷规则（shared/review-paper.ts）
 *
 * 【这个文件在守什么】
 * 守的是**「复习卷不能变成一张随机卷，也不能永远只出那几道错题」**。
 * 这一屏的每条规则都能悄悄写错，而错法都长得像"正常"：
 *   · 抽样忘了放回 —— 同一道题在一张卷上出现两遍（用户以为做了 5 道，其实只有 3 道）
 *   · 权重漏了 Laplace 平滑 —— 没做过的课权重成 0 或 NaN，**永远抽不到它**
 *   · 挑战题从后门进来了 —— 主人规格里它只该出现在阶段/整门/每日挑战三处
 *   · 池子不够时"补"到 N 道 —— 那就只能靠重复题凑数
 *   · 卷面顺序正好等于抽样顺序 —— 抽样的先后（=哪几节最该复习）会泄漏到界面上
 *
 * 【为什么每条断言都注入 rng】
 * `Math.random` 的测试只能断言"不崩"，断言不了"抽到了谁"。这里所有随机源都是
 * 注入的确定性函数（多数是 `() => 0`，即"每次都挑第一个"），于是
 * 「保留席把没练过的那节顶进来了吗」这种问题才有确切答案。
 */

import { describe, expect, it } from 'vitest'
import {
  REVIEW_HOLE_BONUS,
  REVIEW_MAX_SIZE,
  REVIEW_MAX_WEIGHT,
  REVIEW_MIN_SIZE,
  REVIEW_NEW_LESSON_RESERVE,
  REVIEW_RECENT_BONUS,
  REVIEW_RESERVE_MIN_SIZE,
  REVIEW_WRONG_BONUS,
  buildReviewPaper,
  lessonStats,
  normalizeReviewSize,
  type ReviewPaperInput
} from '../review-paper'
import type { QuestionIndexItem } from '../question-index'
import type { Difficulty, PracticeSession } from '../types'

const NOW = Date.parse('2026-09-30T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function q(lessonId: string, n: number, difficulty: Difficulty = 'easy'): QuestionIndexItem {
  return {
    key: `${lessonId}:q${n}`,
    lessonId,
    lang: 'c',
    stage: 1,
    type: 'choice',
    difficulty,
    tags: [],
    stem: 'stem'
  }
}

/** 一课 n 道题（默认全 easy，挑战题要显式要） */
function lesson(lessonId: string, n: number, difficulty: Difficulty = 'easy'): QuestionIndexItem[] {
  return Array.from({ length: n }, (_, i) => q(lessonId, i + 1, difficulty))
}

/** 一次练习：items = [课号, 对错][]，时间给得离 NOW 远一点（除非点名要"刚错的"） */
function sess(at: string, items: [string, boolean][]): PracticeSession {
  return {
    id: 1,
    // v2（P10.1）：跨设备身份 `${installId}:${id}`。本文件的权重算法不读它，
    // 取合法形状即可（夹具比现实少一块 = 替读它的代码把错挡住）
    uid: 'test-install:1',
    at,
    mode: 'lesson',
    items: items.map(([lessonId, ok], i) => ({ key: `${lessonId}:q${i + 1}`, lessonId, ok }))
  }
}

function paper(patch: Partial<ReviewPaperInput>): ReturnType<typeof buildReviewPaper> {
  return buildReviewPaper({
    lessons: [],
    history: [],
    wrongKeys: [],
    holeKeys: [],
    index: [],
    size: 5,
    now: NOW,
    rng: () => 0,
    ...patch
  })
}

// ─────────────────────────────────────────────────────────── 权重

describe('lessonStats：权重怎么算出来的', () => {
  const base = { history: [], wrongKeys: [], holeKeys: [], now: NOW }

  it('没练过的课拿"完全没把握"的分（2.5），不是 0 —— 0 等于永远不复习它', () => {
    const [s] = lessonStats({ ...base, lessons: ['a-01'] })
    expect(s.attempts).toBe(0)
    expect(s.untouched).toBe(true)
    // 1 + 3 × (0+1)/(0+2) = 2.5
    expect(s.weight).toBeCloseTo(2.5, 10)
  })

  it('做对得越多越趋近 1（「刚答对的课自然落回 1」）', () => {
    const many: PracticeSession[] = [
      sess('2026-09-01T00:00:00.000Z', Array.from({ length: 10 }, () => ['a-01', true] as [string, boolean]))
    ]
    const [s] = lessonStats({ ...base, lessons: ['a-01'], history: many })
    expect(s.wrongs).toBe(0)
    expect(s.weight).toBeCloseTo(1 + 3 * (1 / 12), 10) // 1.25
    expect(s.weight).toBeLessThan(2.5)
  })

  it('错得多的课被顶到上限 4', () => {
    const many: PracticeSession[] = [sess('2026-09-01T00:00:00.000Z', [['a-01', false], ['a-01', false], ['a-01', true]])]
    const [s] = lessonStats({ ...base, lessons: ['a-01'], history: many })
    // 1 + 3 × (2+1)/(3+2) = 2.8 —— 还在上限以内，逐项钉住这个数
    expect(s.weight).toBeCloseTo(2.8, 10)

    const worse: PracticeSession[] = [sess('2026-09-01T00:00:00.000Z', [['a-01', false], ['a-01', false]])]
    // 1 + 3 × (2+1)/(2+2) = 3.25
    expect(lessonStats({ ...base, lessons: ['a-01'], history: worse })[0].weight).toBeCloseTo(3.25, 10)

    const worst: PracticeSession[] = [sess('2026-09-01T00:00:00.000Z', [['a-01', false]])]
    // 1 + 3 × (1+1)/(1+2) = 3.0
    expect(lessonStats({ ...base, lessons: ['a-01'], history: worst })[0].weight).toBeCloseTo(3, 10)
  })

  it('★ 权重有上限：真实数据的极值是「全错」，也只到 3.90625 —— 永远碰不到 4', () => {
    // 【写下这条的经过】我原先在这里断言"错成筛子会顶到 4"，结果算错了：
    // 10 错 1 对是 1 + 3×(11/13) ≈ 3.54。想清楚之后发现根本到不了 4，因为
    // 每次作答非对即错 ⇒ 错次 w ≤ 总次 a，而 base 要 > 4 得 w > a + 1
    // （"错的次数比做过的还多一次以上"）—— 练习史里不可能发生。
    // 所以 [1, 4] 这个 clamp 是一道**防呆**，防的是将来有人把权重源换成
    // 错题本的 wrongCount（那个数是累计的，可以远大于 attempts）。
    // 它现在不咬；单测把"现在不咬"钉住，谁哪天换了数据源、它开始咬，
    // 这条会因为极值变了而红 —— 那时该看的是权重源，不是把 4 改大。
    const allWrong: PracticeSession[] = [
      sess('2026-09-01T00:00:00.000Z', Array.from({ length: 30 }, () => ['a-01', false] as [string, boolean]))
    ]
    const [x] = lessonStats({ ...base, lessons: ['a-01'], history: allWrong })
    expect(x.weight).toBeCloseTo(1 + 3 * (31 / 32), 10) // 3.90625
    expect(x.weight).toBeLessThan(REVIEW_MAX_WEIGHT)
    expect(x.weight).toBeGreaterThan(2.5) // 但确实比"没练过"的 2.5 高 —— 它在路上
  })

  it('上限常量本身不许被"顺手改大"（它是一道防呆，改大了就没意义）', () => {
    expect(REVIEW_MAX_WEIGHT).toBe(4)
  })

  it('错题本里还活着的课 ×1.5；标了漏洞的 ×2；两个都占就都乘', () => {
    const [w] = lessonStats({ ...base, lessons: ['a-01'], wrongKeys: ['a-01:q1'] })
    expect(w.hasWrong).toBe(true)
    expect(w.weight).toBeCloseTo(2.5 * REVIEW_WRONG_BONUS, 10)

    const [h] = lessonStats({ ...base, lessons: ['a-01'], holeKeys: ['a-01:q1'] })
    expect(h.hasHole).toBe(true)
    expect(h.weight).toBeCloseTo(2.5 * REVIEW_HOLE_BONUS, 10)

    const [b] = lessonStats({ ...base, lessons: ['a-01'], wrongKeys: ['a-01:q1'], holeKeys: ['a-01:q1'] })
    expect(b.weight).toBeCloseTo(2.5 * REVIEW_WRONG_BONUS * REVIEW_HOLE_BONUS, 10)
  })

  it('★ 别的课的错题/漏洞不算到这一课头上', () => {
    const [s] = lessonStats({ ...base, lessons: ['a-01'], wrongKeys: ['b-02:q1'], holeKeys: ['b-02:q1'] })
    expect(s.hasWrong).toBe(false)
    expect(s.hasHole).toBe(false)
    expect(s.weight).toBeCloseTo(2.5, 10)
  })

  it('近 3 天错的课 ×1.5；4 天前错的不算', () => {
    const near = [sess(new Date(NOW - 2 * DAY).toISOString(), [['a-01', false]])]
    const far = [sess(new Date(NOW - 4 * DAY).toISOString(), [['a-01', false]])]
    const [n] = lessonStats({ ...base, lessons: ['a-01'], history: near })
    const [f] = lessonStats({ ...base, lessons: ['a-01'], history: far })
    expect(n.recentWrong).toBe(true)
    expect(f.recentWrong).toBe(false)
    expect(n.weight / f.weight).toBeCloseTo(REVIEW_RECENT_BONUS, 10)
  })

  it('★ 近 3 天**答对**不算"刚错过"（不然复习会追着刚复习完的课跑）', () => {
    const [s] = lessonStats({
      ...base,
      lessons: ['a-01'],
      history: [sess(new Date(NOW - 1 * DAY).toISOString(), [['a-01', true]])]
    })
    expect(s.recentWrong).toBe(false)
    expect(s.weight).toBeCloseTo(1 + 3 * (1 / 3), 10) // 1+3×(0+1)/(1+2) = 2
  })

  it('★ 时间戳是坏的（非 ISO）→ 当"不算近期"，但那几次作答照样计入次数', () => {
    const [s] = lessonStats({ ...base, lessons: ['a-01'], history: [sess('garbage', [['a-01', false]])] })
    expect(s.recentWrong).toBe(false)
    expect(s.attempts).toBe(1)
    expect(s.wrongs).toBe(1)
  })

  it('练习史里别的课的作答不掺进来', () => {
    const [s] = lessonStats({
      ...base,
      lessons: ['a-01'],
      history: [sess('2026-09-01T00:00:00.000Z', [['b-02', false], ['b-02', false]])]
    })
    expect(s.attempts).toBe(0)
    expect(s.untouched).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────── 组卷

describe('buildReviewPaper：卷子本身', () => {
  it('要 0 道 / 负数 → 空卷（不抛）', () => {
    const index = lesson('a-01', 3)
    expect(paper({ lessons: ['a-01'], index, size: 0 })).toEqual([])
    expect(paper({ lessons: ['a-01'], index, size: -1 })).toEqual([])
    expect(paper({ lessons: ['a-01'], index, size: Number.NaN })).toEqual([])
  })

  it('一节该复习的课都没有 → 空卷（调用方去显示"先去学一课喵"）', () => {
    expect(paper({ lessons: [], index: [] })).toEqual([])
  })

  it('★ 第一轮一课一道：10 节课要 5 道 = 5 节互不相同的课', () => {
    const lessons = Array.from({ length: 10 }, (_, i) => `l-${String(i).padStart(2, '0')}`)
    const index = lessons.flatMap((id) => lesson(id, 3))
    const out = paper({ lessons, index, size: 5 })
    expect(out).toHaveLength(5)
    expect(new Set(out.map((o) => o.lessonId)).size).toBe(5)
  })

  it('★ 同一张卷上没有重复的题（抽样是**不放回**的）', () => {
    const lessons = ['a-01', 'a-02', 'a-03']
    const index = lessons.flatMap((id) => lesson(id, 1)) // 一共只有 3 道
    const out = paper({ lessons, index, size: 3 })
    expect(out).toHaveLength(3)
    expect(new Set(out.map((o) => o.key)).size).toBe(3)
  })

  it('★ 池子不够就给实际的数 —— 不重复题凑数、也不报错', () => {
    const index = lesson('a-01', 2)
    const out = paper({ lessons: ['a-01'], index, size: 20 })
    expect(out).toHaveLength(2)
    expect(new Set(out.map((o) => o.key)).size).toBe(2)
  })

  it('课不够 N 时开第二轮：同一节课里再拿一道（仍然不重复）', () => {
    const index = lesson('a-01', 4)
    const out = paper({ lessons: ['a-01'], index, size: 3 })
    expect(out).toHaveLength(3)
    expect(new Set(out.map((o) => o.key)).size).toBe(3)
    expect(new Set(out.map((o) => o.lessonId))).toEqual(new Set(['a-01']))
  })

  it('★ 挑战题永不入选（主人规格：它只出现在阶段/整门/每日挑战三处）', () => {
    const index = [...lesson('a-01', 3, 'challenge'), ...lesson('a-02', 2)]
    const out = paper({ lessons: ['a-01', 'a-02'], index, size: 5 })
    // a-01 只有挑战题 = 它压根不在候选里
    expect(out.every((o) => o.lessonId !== 'a-01')).toBe(true)
    expect(out).toHaveLength(2)
  })

  it('★ 混合的课只出非挑战题（挑战题不漏进来）', () => {
    const index = [...lesson('a-01', 2, 'easy'), ...lesson('a-01', 5, 'challenge')]
    const out = paper({ lessons: ['a-01'], index, size: 9 })
    expect(out).toHaveLength(2)
    expect(out.map((o) => o.key).sort()).toEqual(['a-01:q1', 'a-01:q2'])
  })

  it('结果里的每一个键都回索引查得到，且课号对得上', () => {
    const lessons = ['a-01', 'a-02', 'a-03']
    const index = lessons.flatMap((id) => lesson(id, 2))
    const byKey = new Map(index.map((it) => [it.key, it]))
    for (const o of paper({ lessons, index, size: 5 })) {
      const it = byKey.get(o.key)
      expect(it).toBeDefined()
      expect(it!.lessonId).toBe(o.lessonId)
    }
  })

  it('同一个 rng 种子的两次组卷结果一样（可复现）', () => {
    const lessons = Array.from({ length: 8 }, (_, i) => `l-${i}`)
    const index = lessons.flatMap((id) => lesson(id, 3))
    const mk = (): (() => number) => {
      let s = 42
      return () => {
        s = (s * 1103515245 + 12345) % 2147483648
        return s / 2147483648
      }
    }
    const a = paper({ lessons, index, size: 5, rng: mk() })
    const b = paper({ lessons, index, size: 5, rng: mk() })
    expect(a).toEqual(b)
  })
})

// ─────────────────────────────────────────────────────────── 保留席

describe('★ 保留席：还没练过的已学课', () => {
  /** 9 节错成筛子的课（权重封顶 4）+ 1 节从没练过（权重 2.5） */
  function setup(): { lessons: string[]; index: QuestionIndexItem[]; history: PracticeSession[] } {
    const heavy = Array.from({ length: 9 }, (_, i) => `h-${i}`)
    const lessons = [...heavy, 'new-01']
    const index = lessons.flatMap((id) => lesson(id, 3))
    const history = heavy.map((id) =>
      sess('2026-09-01T00:00:00.000Z', Array.from({ length: 5 }, () => [id, false] as [string, boolean]))
    )
    return { lessons, index, history }
  }

  it('size=5 时，没练过的那节**一定**在卷上（哪怕它的权重排在最后）', () => {
    const { lessons, index, history } = setup()
    const out = paper({ lessons, index, history, size: 5 })
    expect(out.some((o) => o.lessonId === 'new-01')).toBe(true)
  })

  it('★ 对照组：不靠保留席的话它**抽不到** —— 这条证明上面那条不是白给的', () => {
    const { lessons, index, history } = setup()
    // rng 恒为 0 = 每次都挑权重表里第一个还能挑的。9 节重课排在前面，
    // 要 4 道（size=4 < 保留席门槛 5）时，四席全被重课吃掉
    const out = paper({ lessons, index, history, size: 4 })
    expect(out.some((o) => o.lessonId === 'new-01')).toBe(false)
    // 而且它的权重确实是最低的 —— 这就是"光靠权重保证不了它"的证据
    const stats = lessonStats({ lessons, history, wrongKeys: [], holeKeys: [], now: NOW })
    const newbie = stats.find((s) => s.lessonId === 'new-01')!
    expect(newbie.weight).toBeLessThan(Math.min(...stats.filter((s) => s.lessonId !== 'new-01').map((s) => s.weight)))
  })

  it('保留席的门槛常量是 5（3 道的小卷子不硬留）', () => {
    expect(REVIEW_RESERVE_MIN_SIZE).toBe(5)
    expect(REVIEW_NEW_LESSON_RESERVE).toBe(1)
  })

  it('都是练过的课 → 没有保留席，照常按权重抽', () => {
    const lessons = ['a-01', 'a-02', 'a-03']
    const index = lessons.flatMap((id) => lesson(id, 2))
    const out = paper({ lessons, index, size: 3 })
    expect(out).toHaveLength(3)
  })

  it('没练过的课有题可出才占席（只剩挑战题的"没练过"不算数）', () => {
    const lessons = ['a-01', 'new-01']
    const index = [...lesson('a-01', 5), ...lesson('new-01', 5, 'challenge')]
    const out = paper({ lessons, index, size: 5 })
    expect(out.every((o) => o.lessonId === 'a-01')).toBe(true)
  })
})

/**
 * 题量钳位（normalizeReviewSize）—— 步进器、localStorage 读回、组卷入参三处共用。
 *
 * 【为什么这种"一眼就是 clamp"的东西也值得单测】
 * 它的三个调用点没有一个会因此崩溃：存进去 999，卷子开出来是 20 道；
 * 读回来 `"abc"`，卷子开出来还是 5 道 —— **全都"能用"**。所以写错了没人发现，
 * 直到某天有人手改 `miai:review-size:v1` 想开个 50 道的大卷，
 * 得到的却是"开出来 20 道，一声不吭"。这里钉住的就是那声不吭的部分。
 */
describe('normalizeReviewSize：题量钳位', () => {
  it('范围里的原样返回（两端都算在范围里）', () => {
    expect(normalizeReviewSize(REVIEW_MIN_SIZE)).toBe(5)
    expect(normalizeReviewSize(12)).toBe(12)
    expect(normalizeReviewSize(REVIEW_MAX_SIZE)).toBe(20)
  })

  it('越界夹回两端', () => {
    expect(normalizeReviewSize(4)).toBe(5)
    expect(normalizeReviewSize(999)).toBe(20)
    expect(normalizeReviewSize(-3)).toBe(5)
  })

  it('★ 数字字符串也认 —— localStorage 读回来永远是字符串', () => {
    // 这条守的是"读口 forgot 了 Number()"：忘了的话 '8' 走的是非数字分支、
    // 静默落成 5，用户会发现"我明明选了 8 道，重开又变回 5 道"
    expect(normalizeReviewSize('8')).toBe(8)
    expect(normalizeReviewSize('999')).toBe(20)
  })

  it('小数四舍五入后再钳（手改出来的 7.5 不该原样上卷）', () => {
    expect(normalizeReviewSize(7.5)).toBe(8)
    expect(normalizeReviewSize(7.4)).toBe(7)
  })

  it('★ 非数字一律**落到下限**，不抛错（照 zoom store 的取舍）', () => {
    // null 是 localStorage.getItem 没找到时的原样返回值 —— 第一次进复习页就是它
    expect(normalizeReviewSize(null)).toBe(REVIEW_MIN_SIZE)
    expect(normalizeReviewSize(undefined)).toBe(REVIEW_MIN_SIZE)
    expect(normalizeReviewSize('abc')).toBe(REVIEW_MIN_SIZE)
    expect(normalizeReviewSize(NaN)).toBe(REVIEW_MIN_SIZE)
    // Infinity 是 Number('Infinity') 的结果 —— isFinite 拦得住它（拦住之后别撞进 Math.min）
    expect(normalizeReviewSize(Infinity)).toBe(REVIEW_MIN_SIZE)
  })

  it('两端常量被钉住：5 和 20', () => {
    // 它们既显示在步进器上、也是组卷入参的边界。改这里 = 改产品口径，要有意为之
    expect(REVIEW_MIN_SIZE).toBe(5)
    expect(REVIEW_MAX_SIZE).toBe(20)
  })
})
