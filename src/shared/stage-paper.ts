/**
 * 阶段 / 整门综合练习的**选题**：从一整个阶段（或整门语言）的题池里挑一张卷子。
 *
 * 【为什么不能直接用 `selectWithRelaxation`】
 * 那个函数服务的是"按**某一个难度**取几道题"（收藏练习、延展练习），
 * 它的三件事都是围绕单个目标难度转的。阶段卷要的是另一件事：
 * **两个目标同时成立** —— 难度构成（困难+挑战要占够比例）和跨课覆盖面
 * （题不能全从一节里出）。这两件事会互相拉扯，得一起解，不能串行各做一遍。
 *
 * 【为什么"跨课"是个真需求，不是好看的指标】
 * 一节测验从 15 节课里抽 10 道，如果 8 道都来自同一节，那它测的是
 * "这一节学得怎么样"，不是"这一阶段学得怎么样"。而阶段卷唯一的用处就是后者。
 * 更坏的情况是：那一节恰好是他刚背过的，于是他拿到满分，
 * 而这一阶段里另外 14 节一个都没考到 —— 卷子会**报告一个假的掌握度**。
 *
 * 【为什么是"≥60% 来自不同的课"而不是"每课最多一道"】
 * 硬性"每课最多一道"在池子偏科时会出不了卷（某阶段 15 节里只有 3 节有硬题，
 * 而硬题要占 4 道）。取一个比例下限，既保住了覆盖面，又允许
 * "某节课多出两道"这种正常情况。数字的取舍见下面 `STAGE_HARD_RATIO` 的注释。
 *
 * 【不变量（单测逐个钉着）】
 *   · **卷子永远抽到 `min(size, 池子里的题数)` 道** —— 池子小就给全部，
 *     池子大就正好 size，**绝不出空卷、也绝不重复出同一道题**；
 *   · 两个目标的达成情况**如实回报**（`stats`），不为了让数字好看而假装达成 ——
 *     池子里硬题本来就不够时，`stats.short` 为真，界面要把这件事说出来
 *     （"这一卷困难题只有 3 道，因为这一阶段的困难题一共就 3 道"），
 *     而不是把 40% 印在屏幕上当没发生过。
 *
 * ⚠️ 本文件在 src/ 下、被文案闸门扫，字符串一律英文（中文只出现在注释里）。
 */
import type { QuestionIndexItem } from './question-index'
import { shuffled } from './quiz-paper'

/**
 * 一张阶段卷出几道题。
 *
 * 【为什么比课内练习（5 道）多一倍】一道题在阶段卷里的意义和课内不同：
 * 课内测的是"这节课这个知识点过没过"，阶段卷测的是"这一阶段铺开的十几节课
 * 有没有整体塌方"。5 道题摊到 15 节课上，每节课平均摊不到半道 ——
 * 那个数字不构成任何判断。10 道是"一屏能做完"和"覆盖面够看"之间的取中。
 *
 * 抽满 10 道时，一个阶段（15 节左右）能盖到 10 节不同的课，跨课比例 100%。
 */
export const STAGE_PAPER_SIZE = 10

/**
 * 一张整门卷出几道题。
 *
 * 整门 = 三个阶段（约 50 节课），15 道仍然盖不全 —— 它本来也不是覆盖率测试，
 * 而是"这门语言你整体学到哪了"的一次抽查。再多就不是练习是考试了。
 */
export const LANG_PAPER_SIZE = 15

/**
 * 阶段卷里"困难 + 挑战"要占的比例。
 *
 * 【这个数不是池子的自然构成，是**选材目标** —— 这一点必须说清楚】
 * 2026-09-29 实测整包的难度分布：简单 752（18.7%）/ 中等 1471（36.6%）/
 * 困难 1800（44.7%）/ 挑战 0。按 (语言, 阶段) 拆开看，阶段一二的硬题只占
 * 32~34%，阶段三是 64~66%。
 *
 * 所以 40% 这条线**在阶段一二上高于自然占比**，靠的是"优先取硬题"这件事本身
 * 去达成（池子里的硬题绝对量是够的：阶段一二各有 100+ 道）。它拦的是
 * 另一件事：不带这个约束的话，随机取 10 道会得到一张约 1/3 硬题的卷子，
 * 而阶段卷恰恰应该是**结业检验**——比日常练习更硬一点才对得上它的定位。
 *
 * 池子里真不够时**不放宽质量，如实报告**（`stats.short`），不硬凑。
 */
export const STAGE_HARD_RATIO = 0.4

/**
 * 整门卷的硬题比例。比阶段卷更高，因为整门卷是"这门语言学完了"的结业卷。
 *
 * 【为什么整门卷只对四种语言成立】`common`（通用知识）的 19 节课
 * **一道硬题都没有**（难度全在 easy/medium，2026-09-29 实测 0%），
 * 拿它组整门卷只能组出一张全是简单题的卷子 —— 那不是"整门综合练习"。
 * 入口本来也只在语言卡上出现（总览页不给 common 出卡，见 lib/overview.ts）。
 */
export const LANG_HARD_RATIO = 0.5

/**
 * 一卷里至少要有多大比例的题来自**不同的课**。
 *
 * 0.6 的意思是：10 道题至少要有 6 道来自 6 节不同的课。
 * 抽不满这个数只有一种可能 —— 池子里压根没有那么多节课（比如某阶段只有 4 节
 * 有正文），那种情况下 `stats.spread` 会如实报出真实值。
 */
export const MIN_SPREAD_RATIO = 0.6

/** 一道题算不算"硬题"。困难与挑战一起算 —— 这也是它们唯一共同的定义 */
export function isHardItem(item: QuestionIndexItem): boolean {
  return item.difficulty === 'hard' || item.difficulty === 'challenge'
}

/**
 * 这一卷的实际构成。**界面拿它说人话**（开卷前的确认框、池子不够时的解释），
 * 所以每个字段都必须是"已经发生的事实"，不能是"我们本来想要多少"。
 */
export interface StagePaperStats {
  /** 卷子上实际有几道题 */
  size: number
  /** 实际覆盖了几节不同的课 */
  lessons: number
  /** `lessons / size`，0~1（size 为 0 时给 0，理由同 lib/overview.ts 的 percentOf） */
  spread: number
  /** 困难 + 挑战的实际道数 */
  hard: number
  /** 其中挑战题有几道（阶段/整门卷是挑战题允许出现的三处之一，单独报出来） */
  challenge: number
  /**
   * 池子里**一共有**几道困难/挑战题 —— `short` 为真时界面要说的那个数字。
   *
   * 【为什么必须报出来】"这一卷只有 2 道硬题"是个结果，用户看着它没法判断
   * 是卷子抽得不好还是内容就这样。报出供给量（"这一阶段的困难题一共 2 道"），
   * 这句话他能自己去内容里数、能自己验证，也就不会怀疑组卷坏了。
   */
  hardAvailable: number
  /** `hard / size`，0~1 */
  hardRatio: number
  /**
   * **池子里的硬题本来就不够这一卷要的**。
   *
   * 【为什么只报"够不够"，不报"差几道"】差几道是个假精确的数字：
   * 硬题不够时缺口会被软题填上，而填几道取决于池子里软题有多少 ——
   * 那是另一个数。界面该说的是"这一阶段的困难题一共就 N 道"，
   * 那是一个用户能自己去看、能自己验证的事实。
   */
  short: boolean
}

export interface StagePaper {
  items: QuestionIndexItem[]
  stats: StagePaperStats
}

/**
 * 从 `pool` 里取最多 `n` 道，**尽量每节只取一道**。
 *
 * 【算法】第一轮按池子当前顺序走一遍，只取"这节课还没被取过"的题；
 * 第一轮凑不满 n 时，第二轮把剩下的题按原顺序补上。
 *
 * 【为什么两轮，而不是"随机挑 n 节不同的课"】
 * 前者在池子够的时候恒等于"n 节不同的课"，池子不够时**自动退化成**补满 ——
 * 不需要在调用点判断"这节课数够不够"（那是个会写错的判断）。
 * 而池子在调用前已经洗过牌，所以"按顺序走一遍"等价于"随机挑"。
 */
function takeSpread(
  pool: readonly QuestionIndexItem[],
  n: number,
  used: Set<string>
): QuestionIndexItem[] {
  if (n <= 0) return []
  const out: QuestionIndexItem[] = []
  const rest: QuestionIndexItem[] = []
  for (const it of pool) {
    if (out.length < n && !used.has(it.lessonId)) {
      out.push(it)
      used.add(it.lessonId)
    } else {
      rest.push(it)
    }
  }
  for (const it of rest) {
    if (out.length >= n) break
    out.push(it)
  }
  return out
}

/**
 * 组一张阶段卷 / 整门卷。
 *
 * @param pool      候选池（阶段内或整门内**全部**的题，含挑战题）
 * @param size      想要几道题（`STAGE_PAPER_SIZE` / `LANG_PAPER_SIZE`）
 * @param hardRatio 困难+挑战的目标占比（`STAGE_HARD_RATIO` / `LANG_HARD_RATIO`）
 * @param rng       可注入的随机源。测试里塞确定性假随机源才能断言"取出来的就是这几道"
 *
 * 【三步，缺一不可，而且顺序不能换】
 *   ① 洗牌 → 硬题桶取 `round(size × hardRatio)` 道（跨课优先）；
 *   ② 软题桶补满剩下的名额（跨课优先，且**接着①的已用课表往下算**）；
 *   ③ 还差就回头把两桶剩下的都拿来补 —— 池子偏科时（比如某阶段硬题特别多、
 *      软题只有 3 道）②会提前见底，不补的话卷子会比 size 短。
 *
 * 【为什么 `short` 只看硬题池、不看①的结果】见 `StagePaperStats.short` 的注释：
 * ③ 会在软题不够时**反向**拉进更多硬题，那时硬题比例反而更高。判"够不够"
 * 只能看池子的供给，不能看最终比例 —— 后者会把"池子很偏"报成"一切都好"。
 */
export function buildStagePaper(
  pool: readonly QuestionIndexItem[],
  size: number,
  hardRatio: number,
  rng: () => number = Math.random
): StagePaper {
  /*
   * 去重。内容包理论上不该有重复的全局键（它是 `课号:题号`，题号在课内唯一），
   * 但**池子脏了也不该让一道题在卷子上出现两次** —— 那意味着它会占两个名额，
   * 而且做第二遍时"这题刚做过"会让人以为界面坏了。按 key 去重是这一层唯一
   * 能挡住它的地方（组卷的下游只看得见"几道题"）。
   */
  const seen = new Set<string>()
  const uniq: QuestionIndexItem[] = []
  for (const it of pool) {
    if (seen.has(it.key)) continue
    seen.add(it.key)
    uniq.push(it)
  }

  const n = Math.max(0, Math.min(Math.floor(size), uniq.length))
  const wantHard = Math.max(0, Math.min(Math.round(n * hardRatio), uniq.length))

  const hardPool = uniq.filter(isHardItem)
  const softPool = uniq.filter((it) => !isHardItem(it))

  /*
   * ⚠️ 两个桶各自洗过牌之后才进 takeSpread。**不能只洗 uniq 再 filter** ——
   * 那样两个桶拿到的是同一个随机顺序，而池子是**按课聚簇**的
   * （buildQuestionIndex 按课号遍历，一节课的 7 道题挨在一起）。
   * 于是"每个桶各取前 k 道"会变成"取每个桶里**最靠前那几节课**的题"，
   * 跨课覆盖面直接塌掉，而且塌得一点声音都没有。
   */
  const used = new Set<string>()
  const picked = [
    ...takeSpread(shuffled(hardPool, rng), wantHard, used),
    ...takeSpread(shuffled(softPool, rng), n - wantHard, used)
  ]

  if (picked.length < n) {
    const pickedKeys = new Set(picked.map((it) => it.key))
    const leftover = uniq.filter((it) => !pickedKeys.has(it.key))
    picked.push(...takeSpread(shuffled(leftover, rng), n - picked.length, used))
  }

  const hard = picked.filter(isHardItem).length
  const challenge = picked.filter((it) => it.difficulty === 'challenge').length
  const lessons = new Set(picked.map((it) => it.lessonId)).size

  return {
    items: picked,
    stats: {
      size: picked.length,
      lessons,
      spread: picked.length === 0 ? 0 : lessons / picked.length,
      hard,
      challenge,
      hardAvailable: hardPool.length,
      hardRatio: picked.length === 0 ? 0 : hard / picked.length,
      short: hardPool.length < wantHard
    }
  }
}
