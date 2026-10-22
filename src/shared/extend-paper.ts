/**
 * 延展练习的**候选池**：从一道错题出发，找出"最该接着练"的 5~10 道题。
 *
 * 【为什么叫"池"而不是"卷"】
 * 组卷（`quiz-paper.ts`）回答的是"从这一批里洗出 n 道"；而这里回答的是
 * 前一个问题 —— **哪一批**。延展的池子由来源题决定（同课优先、标签匹配），
 * 池子定完才轮到组卷洗牌。两件事分开，各自有单测，谁改都看得见影响面。
 *
 * 【排序而不是过滤】
 * 硬过滤只有三条：同语言、不是自己、不是挑战题。此外全部靠**排序打分** ——
 * 因为"标签匹配"是个程度问题：同样都是同语言的题，命中两个标签的比命中一个的
 * 更该出现，而一道都不命中的也不是不能练（同语言的语感题也是复习）。
 * 一旦把"必须命中标签"写成硬条件，标签少的课（多数课只有一个标签）
 * 会凑不满池子，然后整条链退化到"没得练"——那才是最糟的形态。
 *
 * 【打分表】（数字有讲究，见下）
 *   同课           +8   —— 「薄弱知识点在那一课」是**最强的信号**，压过一切
 *   命中一个标签   +2   —— 最多数 3 个（见 tagHit 的注释）
 *   同题型         +1
 *
 * 【为什么"同语言"没进打分表】
 * 池子已经硬过滤成同语言了，再给它打分是个恒等项 —— 一个恒等项排在打分表里，
 * 下一个人会以为"不同语言的题也要参与排序"。它不参与，它在门口就被拦掉了。
 *
 * 【为什么先洗牌再排序】
 * 分数相同的题（比如同课里那 6 道）如果保持索引里的原顺序，**每次延展出来的
 * 都是同几道** —— 和组卷洗牌要解决的"背位置"是同一个病。JS 的 sort 是稳定的
 * （ES2019 起是规范），所以"先洗后排"= 同分内随机、有分差的地方严格按分排。
 * 顺序反过来（先排后洗）会把排序彻底洗掉，那是另一个 bug。
 *
 * ⚠️ 本文件在 src/ 下、被文案闸门扫，字符串一律英文（中文只出现在注释里）。
 */
import type { Lang, QuestionType } from './types'
import type { QuestionIndexItem } from './question-index'
import { shuffled } from './quiz-paper'

/** 延展池最多备几道候选（= 用户能选的题量上限，规格：1~10 道） */
export const EXTEND_MAX = 10

/**
 * 来源题 —— 从哪条错题延展出来的。
 *
 * `type` 是选填：来源题解析不出来时（AI 题没有索引条目）就没有它，
 * 打分表里"同题型"这一项自然作废。**不猜一个默认值**：猜出来的类型
 * 会把一批无关的题排到前面，而没有任何地方看得出这是猜的。
 */
export interface ExtendSource {
  /** 来源题的全局键。**池子里的题不能是它自己** —— 错题本重做在别处 */
  key: string
  lessonId: string
  lang: Lang
  /** 来源课的标签（同课优先之外的第二信号） */
  tags: readonly string[]
  type?: QuestionType
}

/** 打分：越大越该出现。只在本文件里有意义 */
function scoreOf(it: QuestionIndexItem, source: ExtendSource, tagSet: Set<string>): number {
  let score = 0
  if (it.lessonId === source.lessonId) score += 8
  // 最多数 3 个标签：8 > 3×2+1 = 7，保证**同课永远压过任何标签组合**。
  // 不封顶的话，一道命中 4 个泛标签的别课题会盖过同课题 —— 那和
  // "薄弱点在那一课"这条产品判断是拧着的
  let tagHit = 0
  for (const t of it.tags) if (tagSet.has(t)) tagHit++
  score += Math.min(tagHit, 3) * 2
  if (source.type !== undefined && it.type === source.type) score += 1
  return score
}

/**
 * 搭候选池：硬过滤 → 洗牌 → 按分稳定排序 → 取前 `limit` 道。
 *
 * @param index  运行时题目索引（`buildQuestionIndex` 的产物）
 * @param source 来源错题（见 ExtendSource）
 * @param opts   `limit` 默认 `EXTEND_MAX`（10）；`rng` 可注入，测试用
 */
export function buildExtendPool(
  index: readonly QuestionIndexItem[],
  source: ExtendSource,
  opts: { limit?: number; rng?: () => number } = {}
): QuestionIndexItem[] {
  const limit = Math.max(0, Math.floor(opts.limit ?? EXTEND_MAX))
  if (limit === 0) return []

  const tagSet = new Set(source.tags)
  // 硬过滤三条：同语言 / 不是自己 / 不是挑战题。
  // 挑战题不进延展是规格钦定（它们只在阶段卷和每日挑战里出现）——
  // 只改了正面提示却把挑战题混进复习池，是这个项目栽过的同型坑
  const pool = index.filter(
    (it) => it.lang === source.lang && it.key !== source.key && it.difficulty !== 'challenge'
  )

  return shuffled(pool, opts.rng)
    .sort((a, b) => scoreOf(b, source, tagSet) - scoreOf(a, source, tagSet))
    .slice(0, limit)
}
