/**
 * 「进度总览」的语言卡片（lib/overview.ts）
 *
 * 【这个文件在守什么 —— 一条不变量，不是几个用例】
 * **一门语言，恰好一张卡。**
 *
 * 2026-09-21 主人 2.0 验收截图里报的 Bug 2 就是它塌了：`outline` 里每一条是
 * 一对「语言 × 阶段」，而旧代码只按 `lang !== 'common'` 过滤，于是每门语言
 * 留下 3 条，页面上 C / C++ / Java / Python 各摞三张同样的卡片（12 张）。
 * 旧代码**不报错、不崩溃、不越界**，只是页面长了一倍多 ——
 * 这种"看起来像那么回事"的错法正是最需要机器盯的一类。
 *
 * 【2026-09-29 加的第二条不变量：分母只数「能学的课」】
 * 大纲里可能有还没写正文的课，那种课点开只有「还在备课中」、**永远学不了**。
 * 把它算进分母，进度条就永远到不了 100%，而界面上看不出为什么。
 * 这一天同时给每格加了 `missing / done`（阶段综合练习的解锁判据）——
 * 判据是**纯推导**的，所以它和进度条共用同一个分母，不可能各算一套。
 *
 * 【为什么末尾还要拿真内容包当回归网】
 * 手写用例只能盖到我想到的形状。真内容包里躺着真实的语言数、真实的阶段数，
 * 哪天大纲多一门语言、某门语言少一个阶段，它都会当场变红。
 * 判据刻意不写死数字（"4 门语言"）—— 写死的话加一门语言时这条网会红，
 * 而**一条动不动就红的守卫等于没有守卫**，谁都不再看它了。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { computePerLang, overallPercent } from '../overview'
import type { Lesson, OutlineModule, Stage } from '../../../../shared/types'

/** 造一条大纲：`{ c: [15, 15, 18] }` → c 的三个阶段各多少节 */
function outlineOf(spec: Record<string, Partial<Record<Stage, number>>>): OutlineModule[] {
  const out: OutlineModule[] = []
  for (const [lang, stages] of Object.entries(spec)) {
    for (const [stage, n] of Object.entries(stages)) {
      out.push({
        lang: lang as OutlineModule['lang'],
        stage: Number(stage) as Stage,
        lessons: Array.from({ length: n ?? 0 }, (_, i) => ({
          id: `${lang}-s${stage}-${i + 1}`,
          title: `${lang} ${stage}-${i + 1}`,
          tags: [],
          order: i + 1,
          hasContent: true
        }))
      })
    }
  }
  return out
}

/** 默认「全都有正文」。**只有专门测分母的用例才去砍它** —— 其余用例不该被它分心 */
function learnableOf(outline: OutlineModule[]): { id: string }[] {
  return outline.flatMap((m) => m.lessons)
}

const 全没学 = new Set<string>()

describe('computePerLang：一门语言一张卡（Bug 2 的回归网）', () => {
  it('**四个语言 × 三个阶段 → 四张卡**，不是十二张', () => {
    const outline = outlineOf({ c: { 1: 5, 2: 5, 3: 5 }, cpp: { 1: 5, 2: 5, 3: 5 } })
    const rows = computePerLang(outline, learnableOf(outline), 全没学)
    expect(outline.length, '前提：大纲里是 6 条「语言×阶段」').toBe(6)
    expect(rows.length, '一门语言一张卡').toBe(2)
    expect(rows.map((r) => r.lang)).toEqual(['c', 'cpp'])
  })

  it('每张卡的三条进度条恒为「入门 / 进阶 / 精通」，一条不多一条不少', () => {
    const outline = outlineOf({ c: { 1: 5, 2: 5, 3: 5 } })
    const rows = computePerLang(outline, learnableOf(outline), 全没学)
    expect(rows).toHaveLength(1)
    expect(rows[0].stages.map((s) => s.stage)).toEqual([1, 2, 3])
  })

  it('通用知识（common）不出卡 —— 它是「基础」，不是一门语言', () => {
    const outline = outlineOf({ common: { 0: 13 }, c: { 1: 5, 2: 5, 3: 5 } })
    const rows = computePerLang(outline, learnableOf(outline), 全没学)
    expect(rows.map((r) => r.lang)).toEqual(['c'])
  })

  it('顺序 = 大纲里第一次出现的顺序，不另排序', () => {
    const outline = outlineOf({ python: { 1: 1 }, c: { 1: 1 } })
    const rows = computePerLang(outline, learnableOf(outline), 全没学)
    expect(rows.map((r) => r.lang)).toEqual(['python', 'c'])
  })
})

describe('computePerLang：数字算在哪一门语言上', () => {
  it('卡片顶上那条是**整门语言**（三阶段相加），不是某一个阶段', () => {
    const outline = outlineOf({ c: { 1: 10, 2: 10, 3: 10 } })
    const rows = computePerLang(outline, learnableOf(outline), 全没学)
    expect(rows[0]).toMatchObject({ learned: 0, total: 30, percent: 0 })
  })

  it('已学按 id 精确归属到各自的阶段', () => {
    const outline = outlineOf({ c: { 1: 4, 2: 4, 3: 4 } })
    const learnable = learnableOf(outline)
    // 只学「阶段2」的前两节
    const learned = new Set(['c-s2-1', 'c-s2-2'])
    const rows = computePerLang(outline, learnable, learned)
    expect(rows[0].stages).toEqual([
      { stage: 1, learned: 0, total: 4, percent: 0, missing: 4, done: false },
      { stage: 2, learned: 2, total: 4, percent: 50, missing: 2, done: false },
      { stage: 3, learned: 0, total: 4, percent: 0, missing: 4, done: false }
    ])
    expect(rows[0]).toMatchObject({ learned: 2, total: 12, percent: 17 })
  })

  it('大纲里没有的课号（脏数据）不算进任何一格', () => {
    const outline = outlineOf({ c: { 1: 2, 2: 2, 3: 2 } })
    const rows = computePerLang(outline, learnableOf(outline), new Set(['不存在-99']))
    expect(rows[0]).toMatchObject({ learned: 0, total: 6 })
  })

  it('某个阶段在大纲里缺了 → 补一条 0/0，**不是 NaN%**', () => {
    // 「补 0/0」和「出错了也当成功」不是一回事：这门课还没排，0 是如实的。
    // 要拦的是 0/0 = NaN 印到学员脸上（`MiProgressBar` 会原样显示「NaN%」）。
    const outline = outlineOf({ c: { 1: 5, 3: 5 } })
    const rows = computePerLang(outline, learnableOf(outline), 全没学)
    expect(rows[0].stages).toHaveLength(3)
    expect(rows[0].stages[1]).toEqual({
      stage: 2,
      learned: 0,
      total: 0,
      percent: 0,
      missing: 0,
      done: false
    })
    expect(Number.isNaN(rows[0].percent)).toBe(false)
    expect(rows[0].percent).toBe(0)
  })

  it('一门语言一节课都没有 → 也是 0%，不是 NaN', () => {
    const outline = outlineOf({ c: { 1: 0, 2: 0, 3: 0 } })
    const rows = computePerLang(outline, learnableOf(outline), 全没学)
    expect(rows[0]).toMatchObject({ total: 0, percent: 0 })
  })
})

describe('分母：只数**有正文**的课（大纲里有、但没正文的课永远学不了）', () => {
  it('★ 大纲里挂着但还没写正文的课，不进分母', () => {
    const outline = outlineOf({ c: { 1: 5, 2: 5, 3: 5 } })
    // 砍掉 stage2 的后三节 —— 模拟"大纲排了、正文还没写"
    const 没正文 = new Set(['c-s2-3', 'c-s2-4', 'c-s2-5'])
    const learnable = learnableOf(outline).filter((l) => !没正文.has(l.id))
    const rows = computePerLang(outline, learnable, 全没学)
    expect(rows[0].stages[1]).toMatchObject({ total: 2, missing: 2 })
    expect(rows[0].total).toBe(12)
  })

  it('★ 把**能学的**全学完 → 100%；旧口径（按大纲全量）这时只到 80%', () => {
    // 这条就是那个 bug 的形状：分母带着学不了的课，进度条永远到不了头。
    const outline = outlineOf({ c: { 1: 5, 2: 5, 3: 5 } })
    const 没正文 = new Set(['c-s2-3', 'c-s2-4', 'c-s2-5'])
    const learnable = learnableOf(outline).filter((l) => !没正文.has(l.id))
    const 学了 = new Set(learnable.map((l) => l.id))
    const rows = computePerLang(outline, learnable, 学了)
    expect(rows[0]).toMatchObject({ learned: 12, total: 12, percent: 100, done: true })
    // 反证：拿大纲全量当分母就只有 80%
    expect(computePerLang(outline, learnableOf(outline), 学了)[0].percent).toBe(80)
  })

  it('有正文、但不在大纲里的课**谁都不算**（两边取交集，不是并集）', () => {
    const outline = outlineOf({ c: { 1: 3, 2: 3, 3: 3 } })
    const learnable = [...learnableOf(outline), { id: '野课-01' }]
    const rows = computePerLang(outline, learnable, new Set(['野课-01']))
    expect(rows[0]).toMatchObject({ total: 9, learned: 0 })
  })
})

describe('missing / done：阶段综合练习的解锁判据（纯推导，不新增存储）', () => {
  it('★ 差一节就是没完成，`missing` 说的就是差几节', () => {
    const outline = outlineOf({ c: { 1: 3, 2: 3, 3: 3 } })
    const learnable = learnableOf(outline)
    const rows = computePerLang(outline, learnable, new Set(['c-s1-1', 'c-s1-2']))
    expect(rows[0].stages[0]).toMatchObject({ learned: 2, total: 3, missing: 1, done: false })
  })

  it('★ 一个阶段全学完 → done；但整门还差着别的阶段', () => {
    const outline = outlineOf({ c: { 1: 3, 2: 3, 3: 3 } })
    const rows = computePerLang(outline, learnableOf(outline), new Set(['c-s1-1', 'c-s1-2', 'c-s1-3']))
    expect(rows[0].stages[0]).toMatchObject({ missing: 0, done: true })
    expect(rows[0]).toMatchObject({ missing: 6, done: false })
  })

  it('★ 三阶段全学完 → 整门 done', () => {
    const outline = outlineOf({ c: { 1: 2, 2: 2, 3: 2 } })
    const learnable = learnableOf(outline)
    const rows = computePerLang(outline, learnable, new Set(learnable.map((l) => l.id)))
    expect(rows[0]).toMatchObject({ missing: 0, done: true })
    expect(rows[0].stages.every((s) => s.done)).toBe(true)
  })

  it('★ 一节正文都没有的阶段**永远不算完成**（不然会挂一个点开是空卷的按钮）', () => {
    const outline = outlineOf({ c: { 1: 3, 3: 3 } }) // stage2 在大纲里就缺
    const rows = computePerLang(outline, learnableOf(outline), 全没学)
    expect(rows[0].stages[1]).toMatchObject({ total: 0, missing: 0, done: false })
  })

  it('★ 整门：**空阶段不欠账** —— 有内容的阶段全学完就是完成', () => {
    // 少了这一条，某门语言少排一个阶段时整门练习就永远开不了，
    // 而界面上只会说「还差 0 课」——一句没人看得懂的话。
    const outline = outlineOf({ c: { 1: 2, 3: 2 } })
    const learnable = learnableOf(outline)
    const rows = computePerLang(outline, learnable, new Set(learnable.map((l) => l.id)))
    expect(rows[0].missing).toBe(0)
    expect(rows[0].done).toBe(true)
    expect(rows[0].stages[1].done, '空阶段本身仍然不是"完成"').toBe(false)
  })

  it('一门语言一节正文都没有 → 整门也不是"完成"', () => {
    const outline = outlineOf({ c: { 1: 0, 2: 0, 3: 0 } })
    const rows = computePerLang(outline, learnableOf(outline), 全没学)
    expect(rows[0]).toMatchObject({ total: 0, missing: 0, done: false })
  })
})

describe('overallPercent：总进度环上的那个数（旧公式写死 /192）', () => {
  it('★ 按有正文的课数算，**不是硬编码的 192**', () => {
    const learnable = Array.from({ length: 229 }, (_, i) => ({ id: `L${i}` }))
    const 学了一百 = new Set(learnable.slice(0, 100).map((l) => l.id))
    // 100/229 = 43.7% → 44；旧公式 100/192 = 52% —— 差 8 个点，一直在骗人
    expect(overallPercent(学了一百, learnable)).toBe(44)
  })

  it('全部学完 = 100%（旧公式这时候只给 84%）', () => {
    const learnable = Array.from({ length: 229 }, (_, i) => ({ id: `L${i}` }))
    expect(overallPercent(new Set(learnable.map((l) => l.id)), learnable)).toBe(100)
  })

  it('★ learned 里有**已经不在内容里**的课号 → 不算数，也不会印出 100 以上', () => {
    const learnable = [{ id: 'a' }, { id: 'b' }]
    expect(overallPercent(new Set(['a', 'b', '幽灵课']), learnable)).toBe(100)
  })

  it('一节可学的课都没有 → 0，不是 NaN', () => {
    expect(overallPercent(new Set(['a']), [])).toBe(0)
  })

  it('四舍五入到整数（进度环上印的是整数）', () => {
    expect(overallPercent(new Set(['a']), [{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toBe(33)
  })
})

describe('真内容包回归网：拿今天真实的大纲跑一遍', () => {
  const bundle = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'generated', 'content-bundle.json'), 'utf8')
  ) as { outline: OutlineModule[]; lessons: Lesson[] }

  it('网没空跑 —— 大纲里确实有多阶段的语言（不然这条网什么都盖不住）', () => {
    const 非common = bundle.outline.filter((m) => m.lang !== 'common')
    // 锚在"确实存在重复"上：旧代码的 bug 只在这种形状下才现形。
    // 要是哪天大纲变成一门语言一条，这条网就失去意义了，得当场知道。
    expect(非common.length).toBeGreaterThan(new Set(非common.map((m) => m.lang)).size)
  })

  it('★ 大纲说「有正文」的课 和 `bundle.lessons` 是**同一份名单**', () => {
    /*
     * 这条网盯着一件很容易走散的事：`total` 的分母走 `bundle.lessons`，
     * 而界面上别的数字（侧栏的课程树、课状态）走的是 `outline.hasContent`。
     * 两份名单一旦对不上，就会出现「侧栏显示 229 课能点，进度条分母是 227」——
     * 而用户看到的是"学完了却还差两节"。
     * 它们由同一次构建产出，本该恒等；这条网就是那个"本该"的担保。
     */
    const 大纲说 = bundle.outline
      .flatMap((m) => m.lessons)
      .filter((l) => l.hasContent)
      .map((l) => l.id)
      .sort()
    expect(大纲说).toEqual(bundle.lessons.map((l) => l.id).sort())
  })

  it('每门语言恰好一张卡，且三阶段加起来一节都没漏', () => {
    const rows = computePerLang(bundle.outline, bundle.lessons, 全没学)
    const 应到 = new Set(bundle.outline.filter((m) => m.lang !== 'common').map((m) => m.lang))
    expect(rows.map((r) => r.lang).sort()).toEqual([...应到].sort())
    expect(rows.length, '一门语言一张卡').toBe(应到.size)

    const 有正文 = new Set(bundle.lessons.map((l) => l.id))
    for (const r of rows) {
      expect(r.stages, `${r.lang} 的三条进度条`).toHaveLength(3)
      // 三阶段相加必须等于这门语言**能学的**节数 —— 少算一格就是"进度条凭空短了"
      const 该有 = bundle.outline
        .filter((m) => m.lang === r.lang)
        .reduce((n, m) => n + m.lessons.filter((l) => 有正文.has(l.id)).length, 0)
      expect(r.total, `${r.lang} 的总节数没对上`).toBe(该有)
    }
  })

  it('★ 全部学完 → 每门语言都 done、每个有内容的阶段都 done、总进度 100%', () => {
    const all = new Set(bundle.lessons.map((l) => l.id))
    expect(overallPercent(all, bundle.lessons)).toBe(100)

    const rows = computePerLang(bundle.outline, bundle.lessons, all)
    for (const r of rows) {
      expect(r.missing, `${r.lang} 全学完还有缺口`).toBe(0)
      expect(r.done, `${r.lang} 全学完却没标完成`).toBe(true)
      for (const s of r.stages) {
        expect(s.missing, `${r.lang}/stage${s.stage} 全学完还有缺口`).toBe(0)
        // 空阶段是"没有可学的"，不是"完成了" —— 这条例外必须留着（见上面的用例）
        expect(s.done, `${r.lang}/stage${s.stage}`).toBe(s.total > 0)
      }
    }
  })

  it('★ 一节没学 → 每门语言的 `missing` 精确等于它可学的课数，没有负数、没有 NaN', () => {
    for (const r of computePerLang(bundle.outline, bundle.lessons, 全没学)) {
      expect(r.missing).toBe(r.total)
      expect(r.percent).toBe(0)
      expect(r.done).toBe(false)
    }
  })
})
