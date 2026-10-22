/**
 * 「进度总览」页每门语言的进度数据（**纯函数**：不碰 store、不碰 DOM、不碰 Vue）。
 *
 * 【为什么从 OverviewView.vue 里搬出来 —— 这一天它算错了】
 * 原先这段是组件里的一个 `computed`，而它**把一门语言渲染成了三张卡**：
 * `outline` 里每一条是**一对「语言 × 阶段」**（`OutlineModule { lang, stage }`），
 * 原式只写了 `.filter((m) => m.lang !== 'common')` —— C / C++ / Java / Python
 * 各占 3 个阶段，于是 12 条全留下来，页面上一门语言摞了三张一模一样的卡片。
 * 2026-09-21 主人 2.0 验收截图里的 Bug 2 就是这个。
 *
 * 【搬到这里的真正理由不是"解耦"，是"测得了"】
 * 组件里的 `computed` 要拖起 jsdom + 整个 pinia 才能测，而本项目的单测环境是
 * `node`（`vitest.config.ts` 里写死的）—— 等于**这段逻辑没有任何机器守着**，
 * 错成什么样都没人知道。搬成纯函数之后，「一门语言一张卡」这条不变量
 * 才第一次有人钉（`__tests__/overview.test.ts`）。
 *
 * 【2026-09-29：分母从「大纲全量」改成「有正文的课」】
 * 大纲里可能有**还没写正文**的课（`OutlineLesson.hasContent === false`）。
 * 那种课点开只有一句「还在备课中」，**永远无法被标记为已学** ——
 * 把它算进分母，那门语言的进度条就永远到不了 100%，而界面上看不出为什么。
 * 所以 `total` 走 `learnable`（调用方传 `content.bundle.lessons`）。
 * 今天两者恰好相等（229 课全有正文），但那是**巧合不是保证** ——
 * 区别在主人哪天往大纲里加一节占位课的那一刻就现形了。
 */
import type { LangOfCode, OutlineModule, Stage } from '../../../shared/types'

/**
 * 阶段固定这三档，顺序就是界面上的「入门 / 进阶 / 精通」。
 *
 * ⚠️ `Stage` 的定义里还有 `0`，那是**通用知识模块**用的（`common` 就排在 stage 0）。
 * 语言课只有 1/2/3 三档，所以这里不写 0 —— 但也不能改成"从大纲里现取"：
 * 现取的话，某门语言少一个阶段时**卡片上的行数会跟着变**，
 * 三门语言的卡片就长得不一样高了，而那看起来像布局坏了。
 */
const STAGES: readonly Stage[] = [1, 2, 3]

export interface StageProgress {
  stage: Stage
  learned: number
  total: number
  /** 同上：这里也算好，界面上就不必再写一次除法（写了就会漏掉 0/0 那一格） */
  percent: number
  /** 还差几节 = `total - learned`（恒 ≥ 0）。界面上的「还差 N 课」用它 */
  missing: number
  /** 这一阶段的综合练习能不能开（见 `computePerLang` 的说明） */
  done: boolean
}

export interface LangProgress {
  lang: LangOfCode
  /** **整门语言**的已学 / 总数（三个阶段相加），不是某一个阶段 */
  learned: number
  total: number
  percent: number
  /** 三个阶段各差几节之和 */
  missing: number
  /** 整门综合练习能不能开 */
  done: boolean
  /** 恒为三条、顺序恒定 —— 界面上直接 `v-for`，不用再排一次序 */
  stages: StageProgress[]
}

/**
 * 已学 / 总数 → 百分比。**总数是 0 时给 0**。
 *
 * 这不是"出错了也当成功"（那是本项目的铁律）：总数 0 是一件**如实**的事
 * ——这门语言还没排课。真正要拦的是 `0/0 = NaN` 漏到界面上：
 * `MiProgressBar` 拿到 NaN 之后 `Math.min(100, Math.max(0, NaN))` 还是 NaN，
 * 宽度写成 `NaN%` 被浏览器整条丢掉（进度条永远是空的），
 * 而 `show-label` 会把「NaN%」四个字符**原样印给学员看**。
 */
function percentOf(learned: number, total: number): number {
  return total === 0 ? 0 : Math.round((learned / total) * 100)
}

/**
 * 「学完了」的判定 —— **纯推导，不新增任何存储**。
 *
 * 【为什么 done 要写成 `total > 0 && missing === 0`，而不是 `learned === total`】
 * 加 `total > 0` 是为了让**空阶段永远不算完成**：一节正文都没有的阶段
 * （比如某门语言还没排这一档）如果算成「已完成」，总览页会给它挂一个
 * 「开始练习」的按钮 —— 点下去是一张空卷。而 `missing === 0` 那一半
 * 在 `total === 0` 时也成立（0 - 0 = 0），所以必须靠前一半挡住。
 *
 * 【整门的 done 为什么也是同一条式子】整门的 `missing` 就是三个阶段 `missing` 之和，
 * 所以「这门语言有内容可学、且一处缺口都没有」和「三个阶段全完」是同一件事。
 * （若某个阶段**没有正文**，它对 `missing` 贡献 0 —— 那是对的：
 *  没有内容可学的地方不该算成"还欠着"，否则整门练习会永远开不了。）
 */
function doneOf(total: number, missing: number): boolean {
  return total > 0 && missing === 0
}

/**
 * 按语言归拢大纲，一门语言出一条。
 *
 * 【顺序】按语言在大纲里**第一次出现的顺序**，不另排序 ——
 * 大纲顺序就是课程设计顺序，另排一次只会多一处要跟人解释的约定。
 * （`outline` 现在是 c / cpp / java / python，和 `LANG_DISPLAY` 的键序也一致。）
 *
 * 【`common` 为什么在这里滤掉】它是「通用知识」不是一门语言，没有阶段进度可比。
 * 它在大纲里是 stage 0，就算不滤也凑不出三条进度条。
 * （第二条理由：它的题池里**一道硬题都没有**（实测 0%），
 *   拿它组整门卷只能组出一张全是简单题的卷子 —— 那不像结业卷。）
 *
 * 【`learnable` 是干什么的】只用来回答「这一课能不能学」——
 * 见文件抬头「分母为什么改了」。**大纲仍然决定结构**（谁在前、有哪些阶段），
 * `learnable` 只决定某一节课算不算数。两份名单的**交集**才是分母：
 * 大纲里有、但没正文的课，不进 `total` 也不进 `learned`。
 */
export function computePerLang(
  outline: OutlineModule[],
  learnable: readonly { id: string }[],
  learned: ReadonlySet<string>
): LangProgress[] {
  const usable = new Set(learnable.map((l) => l.id))

  const order: LangOfCode[] = []
  const byLang = new Map<LangOfCode, Map<Stage, { learned: number; total: number }>>()

  for (const m of outline) {
    if (m.lang === 'common') continue
    let stages = byLang.get(m.lang)
    if (!stages) {
      stages = new Map()
      byLang.set(m.lang, stages)
      order.push(m.lang)
    }
    const counts = m.lessons.filter((l) => usable.has(l.id))
    stages.set(m.stage, {
      learned: counts.filter((l) => learned.has(l.id)).length,
      total: counts.length
    })
  }

  return order.map((lang) => {
    // 上面这一轮刚把它建出来，取不到是不可能的 —— 真取不到说明 order 和 byLang
    // 走了两条不同的路（那才是要修的 bug），所以这里不写兜底，让它当场炸。
    const found = byLang.get(lang)!
    const stages: StageProgress[] = STAGES.map((s) => {
      const learned = found.get(s)?.learned ?? 0
      const total = found.get(s)?.total ?? 0
      const missing = total - learned
      return { stage: s, learned, total, percent: percentOf(learned, total), missing, done: doneOf(total, missing) }
    })
    const learned = stages.reduce((n, s) => n + s.learned, 0)
    const total = stages.reduce((n, s) => n + s.total, 0)
    const missing = total - learned
    return {
      lang,
      learned,
      total,
      percent: percentOf(learned, total),
      missing,
      done: doneOf(total, missing),
      stages
    }
  })
}

/**
 * 「总进度环」上的那个百分数（侧栏和总览页各有一个，共用一个数）。
 *
 * 【它原来错在哪儿 / 为什么搬到这里】
 * 原式在 `stores/progress.ts` 里，写的是 `learned.length / 192` ——
 * 192 是主人当初手写的课数，内容涨到 229 之后它就一直在撒谎：
 * 全部学完只显示 84%。**而且它搬不走**：分母要读 `bundle.lessons.length`，
 * 而 `stores/progress.ts` 是内容 store 的**上游**（content → progress 单向依赖），
 * 让 progress 去 import content 就是一条循环依赖。所以分母由调用方（视图）
 * 从内容 store 取，算式留在这个纯函数里 —— 两处调用点、一份定义。
 *
 * 【为什么数的是"交集"而不是 `learned.length`】
 * `learned` 里可能留着**已经不在内容里**的课号（内容被删、被改名）。
 * 直接拿它当分子，分母一变小就会印出「101%」这种东西。数交集既不会超，
 * 也**不掩盖**那件事 —— 它本来就不该算进"学了多少能学的东西"。
 */
export function overallPercent(
  learned: ReadonlySet<string>,
  learnable: readonly { id: string }[]
): number {
  if (learnable.length === 0) return 0
  let hit = 0
  for (const l of learnable) if (learned.has(l.id)) hit++
  return Math.round((hit / learnable.length) * 100)
}
