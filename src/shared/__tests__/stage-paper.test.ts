/**
 * 阶段 / 整门综合练习的选题（shared/stage-paper.ts）
 *
 * 【这个文件在守什么 —— 三条不变量，每条坏了都不出声】
 *   1. **卷子永远抽满**（`min(size, 池子)`）：池子偏科时静默变短，
 *      表现是"阶段卷只有 6 道题"，而没有任何东西会报错；
 *   2. **不重复**：一道题占两个名额，做第二遍时"这题刚做过"看起来像界面坏了；
 *   3. **跨课**：题全从一两节课里出，卷子会**报告一个假的掌握度** ——
 *      这是三条里唯一会骗人的那条，也是最难手工发现的（抽到的那节课
 *      恰好是刚背过的，于是满分，而这一阶段另外十几节一道都没考到）。
 *
 * 【为什么末尾要拿真内容包再跑一遍】
 * 手写用例只能盖到我想到的形状。真池子里躺着真实的课时数、真实的难度构成 ——
 * 而"40% 硬题"这条线**是不是够得着**恰恰取决于真内容长什么样
 * （2026-09-29 实测：阶段一二的硬题自然占比只有 32~34%，比目标线低；
 *   能达成是因为池子里的硬题**绝对量**够选，不是因为池子本来就这么多）。
 * 这条网红了 = 那个前提变了，先当发现报告，不静默放宽。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  LANG_HARD_RATIO,
  LANG_PAPER_SIZE,
  MIN_SPREAD_RATIO,
  STAGE_HARD_RATIO,
  STAGE_PAPER_SIZE,
  buildStagePaper,
  isHardItem,
  type StagePaper,
  type StagePaperStats
} from '../stage-paper'
import { buildQuestionIndex, filterIndex, type QuestionIndexItem } from '../question-index'
import type { ContentBundle, Difficulty } from '../types'

/** 造一道题的索引条目。只有被断言到的字段给真值，其余给中性的 */
function item(key: string, lessonId: string, difficulty: Difficulty): QuestionIndexItem {
  return {
    key,
    lessonId,
    lang: 'c',
    stage: 1,
    type: 'choice',
    difficulty,
    tags: [],
    stem: `${key} 的题干`
  }
}

/**
 * 造一个池子：`lessons` 节课、每节 `per` 道题，难度在 `diffs` 里**轮转**。
 *
 * 轮转而不是"前一半 easy 后一半 hard" —— 后者会让"按课聚簇"和"按难度聚簇"
 * 叠在一起，测不出跨课那件事（真池子不长那样：难度和课是两条独立的轴）。
 */
function poolOf(lessons: number, per: number, diffs: readonly Difficulty[]): QuestionIndexItem[] {
  const out: QuestionIndexItem[] = []
  let k = 0
  for (let l = 1; l <= lessons; l++) {
    for (let i = 1; i <= per; i++) {
      out.push(item(`L${l}:q${i}`, `L${l}`, diffs[k++ % diffs.length]))
    }
  }
  return out
}

/** 不洗牌的随机源：`j = floor(0.999… × (i+1)) = i` → 每次跟自己换，等于原样 */
const NO_SHUFFLE = (): number => 0.9999999

/** 自造的确定性伪随机源（种子固定 → 序列固定），测"同一 rng 给同一结果" */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** 卷子上每条不变量都过一遍，返回它自己方便串联断言 */
function selfConsistent(paper: StagePaper, size: number, poolSize: number): StagePaperStats {
  const { items, stats } = paper
  // ① 抽满：`min(size, 去重后的池子)`。这里传进来的池子都没重复键
  expect(items.length, '卷长').toBe(Math.min(size, poolSize))
  expect(stats.size, 'stats.size 与卷长一致').toBe(items.length)
  // ② 不重复
  expect(new Set(items.map((x) => x.key)).size, '卷上有重复的题').toBe(items.length)
  // ③ 每道题都来自池子（不凭空造题）
  expect(new Set(items.map((x) => x.key)).size).toBeLessThanOrEqual(poolSize)
  // ④ stats 的每一个数都是**数出来的**，不是算出来的
  expect(stats.hard, 'stats.hard 与卷上实际硬题数').toBe(items.filter(isHardItem).length)
  expect(stats.challenge, 'stats.challenge').toBe(
    items.filter((x) => x.difficulty === 'challenge').length
  )
  expect(stats.hardAvailable, 'stats.hardAvailable 不能少于卷上的硬题数').toBeGreaterThanOrEqual(
    stats.hard
  )
  expect(stats.lessons, 'stats.lessons').toBe(new Set(items.map((x) => x.lessonId)).size)
  expect(stats.spread, 'stats.spread').toBeCloseTo(stats.size === 0 ? 0 : stats.lessons / stats.size, 10)
  expect(stats.hardRatio, 'stats.hardRatio').toBeCloseTo(
    stats.size === 0 ? 0 : stats.hard / stats.size,
    10
  )
  return stats
}

describe('卷长：永远抽满 min(size, 池子)，绝不出空卷', () => {
  it('池子比 size 大 → 正好 size 道', () => {
    const pool = poolOf(15, 7, ['easy', 'medium', 'hard'])
    const paper = buildStagePaper(pool, 10, 0.4, seeded(1))
    expect(selfConsistent(paper, 10, pool.length).size).toBe(10)
  })

  it('池子比 size 小 → **有多少给多少**，不重复凑数、也不摆空卷', () => {
    const pool = poolOf(2, 3, ['easy', 'medium', 'hard'])
    const paper = buildStagePaper(pool, 10, 0.4, seeded(2))
    expect(selfConsistent(paper, 10, pool.length).size).toBe(6)
  })

  it('池子偏科到"软题只有 2 道" → 回头把硬题补上（这一步漏了卷子会静默变短）', () => {
    const pool = [
      ...poolOf(1, 2, ['easy']),
      ...Array.from({ length: 20 }, (_, i) => item(`H:q${i}`, `H${i % 10}`, 'hard'))
    ]
    const paper = buildStagePaper(pool, 10, 0.4, seeded(3))
    const stats = selfConsistent(paper, 10, pool.length)
    expect(stats.size, '软题不够时也必须是 10 道').toBe(10)
    // 反向拉进来的硬题让比例**超过**目标 —— 这不是问题，是如实的结果
    expect(stats.hard).toBe(8)
  })

  it('空池子 → 空卷，stats 全 0（不是 NaN，也不抛）', () => {
    const paper = buildStagePaper([], 10, 0.4, seeded(4))
    expect(paper.items).toEqual([])
    expect(paper.stats).toEqual({
      size: 0,
      lessons: 0,
      spread: 0,
      hard: 0,
      challenge: 0,
      hardAvailable: 0,
      hardRatio: 0,
      short: false
    })
  })

  it('size 是 0 / 负数 → 空卷（调用方算错了也不该拿到 undefined）', () => {
    const pool = poolOf(3, 3, ['easy'])
    expect(buildStagePaper(pool, 0, 0.4, seeded(5)).items).toEqual([])
    expect(buildStagePaper(pool, -3, 0.4, seeded(5)).items).toEqual([])
  })
})

describe('不重复：一道题只占一个名额', () => {
  it('池子里有重复的全局键 → 卷上只出现一次', () => {
    // 内容包理论上不该有重复键（有 content-difficulty 的 key 唯一网钉着），
    // 但组卷是最后一道能挡住它的地方 —— 再往下就只剩"这道题出现了两次"这个现象了。
    const pool = [
      item('L1:q1', 'L1', 'hard'),
      item('L1:q1', 'L1', 'hard'),
      item('L1:q2', 'L1', 'easy'),
      item('L2:q1', 'L2', 'easy'),
      item('L2:q2', 'L2', 'medium')
    ]
    const paper = buildStagePaper(pool, 10, 0.4, seeded(6))
    expect(paper.items.length).toBe(4)
    expect(new Set(paper.items.map((x) => x.key)).size).toBe(4)
  })
})

describe('跨课：题不能全从一两节课里出', () => {
  it('课时够 → 10 道题来自 10 节不同的课（跨课比例 100%）', () => {
    const pool = poolOf(15, 7, ['easy', 'medium', 'hard'])
    const stats = selfConsistent(buildStagePaper(pool, 10, 0.4, seeded(7)), 10, pool.length)
    expect(stats.lessons).toBe(10)
    expect(stats.spread).toBe(1)
  })

  it('★ 池子**按课聚簇**、而且完全不洗牌时，跨课仍然达标（防"只洗一遍"那个坑）', () => {
    // 真索引就是按课号顺序建的（一节课的 7 道题挨在一起）。
    // 如果实现是"洗一次 uniq、再 filter 成两个桶、各取前 k 道"，
    // 两个桶拿到的会是同一个顺序，于是各自取到最靠前那几节课 —— 跨课直接塌。
    const pool = poolOf(15, 7, ['easy', 'medium', 'hard'])
    const stats = selfConsistent(buildStagePaper(pool, 10, 0.4, NO_SHUFFLE), 10, pool.length)
    expect(stats.lessons).toBeGreaterThanOrEqual(Math.ceil(10 * MIN_SPREAD_RATIO))
    expect(stats.spread).toBeGreaterThanOrEqual(MIN_SPREAD_RATIO)
  })

  it('课的**数量本来就不够**时如实报告真实值（不假装达标）', () => {
    // 4 节课 × 20 道题：卷子只能盖上 4 节课，spread = 0.4。
    // 这里要的不是"达标"，是**别撒谎** —— 界面照着 stats 说实话。
    const pool = poolOf(4, 20, ['easy', 'medium', 'hard'])
    const stats = selfConsistent(buildStagePaper(pool, 10, 0.4, seeded(8)), 10, pool.length)
    expect(stats.lessons).toBe(4)
    expect(stats.spread).toBe(0.4)
    expect(stats.spread).toBeLessThan(MIN_SPREAD_RATIO)
  })
})

describe('难度构成：目标是选材目标，达成不了就如实说', () => {
  it('硬题充足 → 正好取到目标道数（10 × 40% = 4）', () => {
    const pool = poolOf(15, 7, ['easy', 'medium', 'hard', 'medium'])
    const stats = selfConsistent(buildStagePaper(pool, 10, STAGE_HARD_RATIO, seeded(9)), 10, pool.length)
    expect(stats.hard).toBe(4)
    expect(stats.short).toBe(false)
    expect(stats.hardRatio).toBeCloseTo(STAGE_HARD_RATIO, 10)
  })

  it('硬题**不够** → 有几道用几道，`short` 为真（界面据此说人话）', () => {
    const pool = [
      ...poolOf(12, 6, ['easy', 'medium']),
      item('X:q1', 'X', 'hard'),
      item('Y:q1', 'Y', 'hard')
    ]
    const stats = selfConsistent(buildStagePaper(pool, 10, 0.4, seeded(10)), 10, pool.length)
    expect(stats.short, '池子只有 2 道硬题，够不上 4 道 → 必须报 short').toBe(true)
    expect(stats.hard).toBe(2)
    expect(stats.hardRatio).toBe(0.2)
    // 界面上要说的是**供给量**（"这一阶段的困难题一共 2 道"），不是缺口 ——
    // 用户拿缺口数字没法验证，拿供给量能自己去数。
    expect(stats.hardAvailable, '池子的硬题供给量').toBe(2)
  })

  it('`short` 只看**池子的硬题供给**，不跟着最终比例走（软题不够会让比例反而更高）', () => {
    const pool = [
      ...Array.from({ length: 20 }, (_, i) => item(`H:q${i}`, `H${i % 10}`, 'hard')),
      item('S:q1', 'S1', 'easy'),
      item('S:q2', 'S2', 'easy')
    ]
    const stats = selfConsistent(buildStagePaper(pool, 10, 0.4, seeded(11)), 10, pool.length)
    expect(stats.hard, '反向补进了硬题').toBe(8)
    expect(stats.short, '硬题池有 20 道，供给充足 → 不该报 short').toBe(false)
  })

  it('挑战题**进得来**（阶段/整门卷是它允许出现的三处之一）', () => {
    const pool = [
      ...Array.from({ length: 12 }, (_, i) => item(`C:q${i}`, `C${i % 6}`, 'challenge')),
      ...poolOf(10, 5, ['easy', 'medium'])
    ]
    const stats = selfConsistent(buildStagePaper(pool, 10, 0.4, seeded(12)), 10, pool.length)
    expect(stats.hard).toBeGreaterThan(0)
    expect(stats.challenge, '挑战题被算进硬题里').toBe(stats.hard)
  })

  it('比例 0 / 1 这两个端点不越界', () => {
    const pool = poolOf(10, 6, ['easy', 'medium', 'hard'])
    expect(selfConsistent(buildStagePaper(pool, 10, 0, seeded(13)), 10, pool.length).hard).toBe(0)
    // 1.0 要 10 道硬题：池子里有 20 道，取满 10，short 为假。
    // ⚠️ 这里刻意写 `min(10, 池里的硬题数)` 而不是恒等式 ——
    // `hard + (size - hard) === size` 那种写法永远为真，是假绿的经典形状。
    const hardInPool = pool.filter(isHardItem).length
    const all = selfConsistent(buildStagePaper(pool, 10, 1, seeded(13)), 10, pool.length)
    expect(hardInPool, '前提：池里的硬题比 10 道多').toBeGreaterThan(10)
    expect(all.hard).toBe(10)
    expect(all.short).toBe(false)
  })
})

describe('随机源可注入：同一串随机数必须给同一张卷', () => {
  it('同一个种子跑两次 → 逐条相同（不然真窗口探针无从断言）', () => {
    const pool = poolOf(15, 7, ['easy', 'medium', 'hard'])
    const a = buildStagePaper(pool, 10, 0.4, seeded(42)).items.map((x) => x.key)
    const b = buildStagePaper(pool, 10, 0.4, seeded(42)).items.map((x) => x.key)
    expect(a).toEqual(b)
    expect(a.length).toBe(10)
  })

  it('不传 rng 也不炸（真调用点就是不给）', () => {
    const pool = poolOf(15, 7, ['easy', 'medium', 'hard'])
    expect(buildStagePaper(pool, 10, 0.4).items.length).toBe(10)
  })
})

// ──────────────────────────────────────────────────── 真内容包回归网

describe('真内容包回归网：拿今天真实的池子逐格跑一遍', () => {
  const bundle = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'renderer', 'src', 'generated', 'content-bundle.json'), 'utf8')
  ) as ContentBundle
  const index = buildQuestionIndex(bundle.lessons)

  /**
   * 每个 (语言, 阶段) 格子的题池 —— 走**应用自己的** `filterIndex`，
   * 不是这里另写一遍过滤（不然测的是这份测试的过滤，不是应用的行为）。
   */
  const cells = bundle.outline
    .filter((m) => m.lang !== 'common')
    .map((m) => ({ lang: m.lang, stage: m.stage, pool: filterIndex(index, { lang: m.lang, stage: m.stage }) }))

  it('网没空跑 —— 每格都得有足够多的题，否则下面的断言是空转', () => {
    expect(cells.length).toBeGreaterThan(0)
    for (const c of cells) {
      expect(c.pool.length, `${c.lang}/stage${c.stage} 题太少`).toBeGreaterThan(STAGE_PAPER_SIZE)
    }
    expect(index.length, '索引和内容包对不上').toBe(
      bundle.lessons.reduce((s, l) => s + l.questions.length, 0)
    )
  })

  it('★ 每个阶段的卷：抽满、不重复、跨课达标、key 用的是**真实课号**', () => {
    const rows: string[] = []
    for (const c of cells) {
      const paper = buildStagePaper(c.pool, STAGE_PAPER_SIZE, STAGE_HARD_RATIO, seeded(2026))
      const stats = selfConsistent(paper, STAGE_PAPER_SIZE, c.pool.length)

      expect(stats.spread, `${c.lang}/stage${c.stage} 跨课不达标`).toBeGreaterThanOrEqual(MIN_SPREAD_RATIO)

      /*
       * ⚠️ 这条是**那一类真出过事的 bug** 的网：组卷模式不显式传 keys 时，
       * `startQuiz` 会拿哨兵课号（`__stage__`）去拼 `__stage__:q1` 这种垃圾键 ——
       * 错题本里会积一堆查不出题目的死条目，而且一声不吭。
       * 卷子上的每个键都必须是**它自己那节课**的课号。
       */
      for (const it of paper.items) {
        expect(it.key.startsWith(`${it.lessonId}:`), `${it.key} 的课号不是它自己的`).toBe(true)
        expect(it.lessonId.startsWith('__'), `${it.key} 用了哨兵课号`).toBe(false)
      }

      // 硬题供给够不够 —— 这条就是"40% 够不够得着"的现场证据
      expect(stats.short, `${c.lang}/stage${c.stage} 的硬题池不够这一卷要的`).toBe(false)
      expect(stats.hardRatio).toBeGreaterThanOrEqual(STAGE_HARD_RATIO - 1e-9)

      rows.push(
        `  ${c.lang.padEnd(6)} stage${c.stage}  池${String(c.pool.length).padStart(4)} 道 / ` +
          `${String(new Set(c.pool.map((x) => x.lessonId)).size).padStart(2)} 课  →  ` +
          `卷 ${stats.size} 道，硬题 ${stats.hard}（${(stats.hardRatio * 100).toFixed(0)}%），` +
          `挑战 ${stats.challenge}，覆盖 ${stats.lessons} 课`
      )
    }
    console.log(`\n阶段卷选材实况（真内容包，2026-09-29）：\n${rows.join('\n')}\n`)
  })

  it('★ 每门语言的整门卷：同样四条，题量走 LANG_PAPER_SIZE', () => {
    const langs = [...new Set(cells.map((c) => c.lang))]
    const rows: string[] = []
    for (const lang of langs) {
      const pool = filterIndex(index, { lang })
      const paper = buildStagePaper(pool, LANG_PAPER_SIZE, LANG_HARD_RATIO, seeded(2027))
      const stats = selfConsistent(paper, LANG_PAPER_SIZE, pool.length)
      expect(stats.spread, `${lang} 整门卷跨课不达标`).toBeGreaterThanOrEqual(MIN_SPREAD_RATIO)
      expect(stats.short, `${lang} 的整门硬题池不够这一卷要的（50% × 15 道）`).toBe(false)
      expect(stats.hardRatio).toBeGreaterThanOrEqual(LANG_HARD_RATIO - 1e-9)
      rows.push(
        `  ${lang.padEnd(6)} 池${String(pool.length).padStart(4)} 道  →  卷 ${stats.size} 道，` +
          `硬题 ${stats.hard}（${(stats.hardRatio * 100).toFixed(0)}%），覆盖 ${stats.lessons} 课`
      )
    }
    console.log(`\n整门卷选材实况（真内容包，2026-09-29）：\n${rows.join('\n')}\n`)
  })

  it('★ common（通用知识）的硬题池确实是空的 —— 整门卷只对四种语言成立', () => {
    // 这条不是"顺便看看"，它是一条**设计前提**：总览页不给 common 出卡、
    // 整门卷的入口只挂在语言卡上（lib/overview.ts 滤掉 common）全靠它成立。
    // 哪天 common 补了硬题，这里会红 —— 那时该做的是给 common 也开一个入口，
    // 而不是把这条测试删了。
    const pool = filterIndex(index, { lang: 'common' })
    expect(pool.length, 'common 得有题（不然这条网是空转）').toBeGreaterThan(LANG_PAPER_SIZE)
    expect(pool.filter(isHardItem).length, 'common 出现硬题了 —— 整门卷的设计前提变了').toBe(0)
  })
})
