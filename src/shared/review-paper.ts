/**
 * 每日复习的**组卷**（学习闭环模块五）—— 纯函数，随机源注入。
 *
 * 【它和别的组卷有什么不同】
 * 课后练习、随机练习、阶段卷挑的是「题」；每日复习挑的是**「课」**——
 * 先在候选课里按权重抽 N 节**互不重复**的课，每课再出一道题。
 * 主人规格里的原话是「5 道 ≈ 核心 5 个知识点，20 道铺更广」：
 * 一次复习要**一遍过掉好几个知识点**，而不是在同一课上连做五道。
 *
 * 【权重的真源是练习史，不是错题本的计数】
 * `WrongBookEntry.wrongCount` 是**累计**的、而且答对毕业时会连条目一起消掉 ——
 * 拿它当权重，一道"错了 5 次终于做对"的题会被永远优先，
 * 而它恰恰是**最不需要再练**的那道。练习史（`practice.json`）里留着
 * 「做过几次、错了几次」，两个数一起看才是"最近掌握得怎么样"。
 *
 *   weight = clamp(1 + 3 × (wrongs + 1) / (attempts + 2), 1, 4)   ← Laplace 平滑
 *
 * 分子分母各 +1/+2 是为了**没做过**的课：pure 比例写成 `wrongs/attempts` 的话
 * attempts = 0 要么除零、要么记成 0 分（等于"没做过 = 不用复习"，
 * 恰好反了）。平滑之后 0/0 → 0.5（"完全没把握"），做对得越多越低、趋近 1。
 * 上限 4 是为了不让一道反复错的课把整张卷子占满。
 *
 * 【三道加成，都在 clamp 之外】
 * 错题本里还活着的、标了知识点漏洞的、近几天刚错的 —— 各乘一个系数。
 * 乘在 clamp **之后**是有意的：clamp 管的是"历史频率"这个连续量的封顶，
 * 而这三样是**明确的信号**（用户亲手标过漏洞 / 错题本里躺着），
 * 它们就该能突破 4 把某节课顶到最前。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律英文**（中文只出现在注释里）。
 */
import type { PracticeSession } from './types'
import type { QuestionIndexItem } from './question-index'
import { shuffled } from './quiz-paper'

/** 「近几天刚错的」那个"近几天" */
export const REVIEW_RECENT_DAYS = 3
/** 权重上限（clamp 的上界，加成可以突破它） */
export const REVIEW_MAX_WEIGHT = 4
/** 错题本里还活着的课，权重乘这个 */
export const REVIEW_WRONG_BONUS = 1.5
/** 标了知识点漏洞的课，权重乘这个（主人亲手标的，比"错过"更重） */
export const REVIEW_HOLE_BONUS = 2
/** 近几天刚错的课，权重乘这个 */
export const REVIEW_RECENT_BONUS = 1.5
/**
 * 「还没练过的已学课」保证占几席。
 *
 * 【为什么要有保留席】没做过的课权重是 2.5，看着不低，但它要和一堆
 * 2.5~4 的课抢位置 —— 抽 5 道时抽不到的概率并不小，而这节课
 * 正是**最该被想起来**的那一节（学了却从没练过）。
 * 只在 `size >= REVIEW_RESERVE_MIN_SIZE` 时才保留：两三道的小卷子
 * 本来就装不下所有意图，硬留一席反而挤掉了"按权重该出的"。
 */
export const REVIEW_NEW_LESSON_RESERVE = 1
/** 卷子至少这么大才启用保留席 */
export const REVIEW_RESERVE_MIN_SIZE = 5

/**
 * 复习卷题量的两端。**界面步进器、持久化的上次选择、组卷入参钳位共用这一份** ——
 * 三处各写一个 5/20 的话，改一处另两处就静默不一致了。
 */
export const REVIEW_MIN_SIZE = 5
export const REVIEW_MAX_SIZE = 20

/**
 * 把任意来源的题量钳成合法值（非数字 / NaN / 越界 → 落到范围内）。
 *
 * 【为什么连"读回来那份"也要钳】存的是 localStorage 里的字符串，
 * 而它可能来自：手改过的调试值、老版本写下的数、或一次写坏的写入。
 * 读口钳一次，下游（组卷）就永远拿到 5~20 的整数，不必各自防御。
 * 非数字一律**落到下限**而不是抛错：它只是界面偏好，坏了就回到最小卷，
 * 不值得为它中断开卷（照 zoom store 的取舍）。
 */
export function normalizeReviewSize(n: unknown): number {
  const v = Math.round(typeof n === 'number' ? n : Number(n))
  if (!Number.isFinite(v)) return REVIEW_MIN_SIZE
  return Math.min(REVIEW_MAX_SIZE, Math.max(REVIEW_MIN_SIZE, v))
}

export interface ReviewPaperInput {
  /** 可复习的课（已学 **且** 有内容）。顺序无关，本函数自己洗 */
  lessons: readonly string[]
  /** 练习史 —— 加权的真源 */
  history: readonly PracticeSession[]
  /** 错题本里**还活着**的键（已清除/已软删的不要传进来） */
  wrongKeys: readonly string[]
  /** 标了知识点漏洞的键 */
  holeKeys: readonly string[]
  /** 运行时题目索引（`buildQuestionIndex` 建的） */
  index: readonly QuestionIndexItem[]
  /** 要几道。调用方负责钳到 5~20 */
  size: number
  /** 现在（毫秒时间戳）—— 判"近几天"用。不传 `Date.now()` 是为了可测 */
  now: number
  rng?: () => number
}

/** 卷上的一道 = 课号 + 全局键 */
export interface ReviewPaperItem {
  lessonId: string
  key: string
}

/** 一节课的加权素材（拆出来是为了能单独测权重，不必每次都走整个抽样） */
export interface LessonStat {
  lessonId: string
  attempts: number
  wrongs: number
  /** 错题本里还有这一课的题 */
  hasWrong: boolean
  /** 这一课有题被标了知识点漏洞 */
  hasHole: boolean
  /** 近 REVIEW_RECENT_DAYS 天错过这一课的题 */
  recentWrong: boolean
  /** 这一课**一道都没练过**（保留席只看这个数） */
  untouched: boolean
  weight: number
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/**
 * 按练习史 + 错题本 + 漏洞标记，算出**候选课**各自的权重。
 *
 * 返回的顺序 = 传进来的 `lessons` 的顺序（调用方要稳定顺序的话自己排）——
 * 抽样时的随机性完全交给 `rng`，这里不掺一点随机。
 */
export function lessonStats(input: {
  lessons: readonly string[]
  history: readonly PracticeSession[]
  wrongKeys: readonly string[]
  holeKeys: readonly string[]
  now: number
}): LessonStat[] {
  const { lessons, history, wrongKeys, holeKeys, now } = input
  const wanted = new Set(lessons)

  const attempts = new Map<string, number>()
  const wrongs = new Map<string, number>()
  const recent = new Set<string>()
  const recentEdge = now - REVIEW_RECENT_DAYS * 24 * 60 * 60 * 1000

  for (const sess of history) {
    const at = new Date(sess.at).getTime()
    // `at` 解析不出来（坏文件）就当成"不算近期"—— 数据坏了不该把一节课
    // 顶到卷首，也不该让它整条被丢掉（它对 attempts 仍然有效）
    const isRecent = Number.isFinite(at) && at >= recentEdge
    for (const item of sess.items) {
      if (!wanted.has(item.lessonId)) continue
      attempts.set(item.lessonId, (attempts.get(item.lessonId) ?? 0) + 1)
      if (!item.ok) {
        wrongs.set(item.lessonId, (wrongs.get(item.lessonId) ?? 0) + 1)
        if (isRecent) recent.add(item.lessonId)
      }
    }
  }

  const wrongLessons = new Set<string>()
  for (const k of wrongKeys) {
    const id = k.split(':')[0]
    if (wanted.has(id)) wrongLessons.add(id)
  }
  const holeLessons = new Set<string>()
  for (const k of holeKeys) {
    const id = k.split(':')[0]
    if (wanted.has(id)) holeLessons.add(id)
  }

  return lessons.map((lessonId) => {
    const a = attempts.get(lessonId) ?? 0
    const w = wrongs.get(lessonId) ?? 0
    const hasWrong = wrongLessons.has(lessonId)
    const hasHole = holeLessons.has(lessonId)
    const recentWrong = recent.has(lessonId)
    const base = clamp(1 + 3 * ((w + 1) / (a + 2)), 1, REVIEW_MAX_WEIGHT)
    let weight = base
    if (hasWrong) weight *= REVIEW_WRONG_BONUS
    if (hasHole) weight *= REVIEW_HOLE_BONUS
    if (recentWrong) weight *= REVIEW_RECENT_BONUS
    return { lessonId, attempts: a, wrongs: w, hasWrong, hasHole, recentWrong, untouched: a === 0, weight }
  })
}

/**
 * 按权重抽一个（**不放回** —— 抽走的要从池子里删掉）。
 *
 * 返回下标；池子空则 -1。权重 ≤ 0 的条目视作不可能（本文件里权重恒 ≥ 1，
 * 但调用方可能是别人，除零要在这里挡住而不是靠"上游不会那么传"）。
 */
function weightedIndex(weights: readonly number[], rng: () => number): number {
  let total = 0
  for (const w of weights) if (w > 0) total += w
  if (total <= 0) return -1
  let r = rng() * total
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i]
    if (w <= 0) continue
    r -= w
    if (r < 0) return i
  }
  // 浮点误差兜底：走到这儿说明 r 恰好落在总和上
  for (let i = weights.length - 1; i >= 0; i--) if (weights[i] > 0) return i
  return -1
}

/**
 * 组一张复习卷。
 *
 * 【不变量】（单测逐个钉着）
 *   · **同一道题只出现一次** —— 键不重复，绝不用重复题凑数；
 *   · **一课一道**（第一轮），课不够时才开第二轮从已选过的课里再拿一道；
 *   · **挑战题永不入选**（`difficulty === 'challenge'`）—— 主人规格：
 *     它只出现在阶段/整门/每日挑战三处；
 *   · 池子不够就**给实际的数**，不补不凑、也不报错；
 *   · 结果顺序是洗过的（卷面顺序不该泄漏抽样的先后）。
 */
export function buildReviewPaper(input: ReviewPaperInput): ReviewPaperItem[] {
  const { lessons, history, wrongKeys, holeKeys, index, size, now, rng = Math.random } = input
  if (!Number.isFinite(size) || size <= 0) return []

  // 每课的可选题（**在这里滤掉挑战题**）。一所课若只剩挑战题，它就当不存在 ——
  // 不能让"这一课没有能出的题"变成一个空手而回的位置
  const poolOf = new Map<string, QuestionIndexItem[]>()
  for (const it of index) {
    if (it.difficulty === 'challenge') continue
    const list = poolOf.get(it.lessonId)
    if (list) list.push(it)
    else poolOf.set(it.lessonId, [it])
  }

  const available = lessons.filter((id) => (poolOf.get(id)?.length ?? 0) > 0)
  if (available.length === 0) return []

  const stats = lessonStats({ lessons: available, history, wrongKeys, holeKeys, now })

  // ── 保留席：还没练过的已学课，先占一席 ─────────────────────────────
  const reserved: LessonStat[] = []
  if (size >= REVIEW_RESERVE_MIN_SIZE && REVIEW_NEW_LESSON_RESERVE > 0) {
    const rest = stats.slice()
    for (let i = 0; i < REVIEW_NEW_LESSON_RESERVE; i++) {
      const untouched = rest.filter((s) => s.untouched)
      if (untouched.length === 0) break
      const pick = weightedIndex(
        untouched.map(() => 1), // 保留席内部**等权**：都是"没练过"，再按别的排就是多余的花样
        rng
      )
      if (pick < 0) break
      const chosen = untouched[pick]
      reserved.push(chosen)
      rest.splice(rest.indexOf(chosen), 1)
    }
  }

  // ── 第一轮：按权重抽**互不重复**的课，一课一道 ─────────────────────
  const left = stats.filter((s) => !reserved.includes(s))
  const chosen: LessonStat[] = [...reserved]
  const wantFirstRound = Math.min(size, stats.length)
  while (chosen.length < wantFirstRound) {
    const i = weightedIndex(
      left.map((s) => s.weight),
      rng
    )
    if (i < 0) break
    chosen.push(left[i])
    left.splice(i, 1)
  }

  // ── 第二轮：课不够 N 道时，从已经选过的课里再拿一道 ───────────────
  // （课数 < N 才会走到这里；每课池子里还有剩题就继续，取不到就停）
  const order = chosen.slice()
  while (chosen.length < size && order.length > 0) {
    // 每一轮都从"还有剩题的课"里按权重挑，挑空了就退出
    const withLeft = order.filter((s) => (poolOf.get(s.lessonId)?.length ?? 0) > 0)
    if (withLeft.length === 0) break
    const i = weightedIndex(
      withLeft.map((s) => s.weight),
      rng
    )
    if (i < 0) break
    chosen.push(withLeft[i])
  }

  // ── 每席取一道（课内洗牌后再取，同一课每次出的题也不同）──────────
  const used = new Map<string, Set<string>>()
  const out: ReviewPaperItem[] = []
  for (const s of chosen) {
    const pool = poolOf.get(s.lessonId)
    if (!pool) continue
    let seen = used.get(s.lessonId)
    if (!seen) {
      seen = new Set()
      used.set(s.lessonId, seen)
    }
    const fresh = shuffled(pool, rng).filter((q) => !seen.has(q.key))
    if (fresh.length === 0) continue // 这一课的题出完了
    seen.add(fresh[0].key)
    out.push({ lessonId: s.lessonId, key: fresh[0].key })
  }

  return shuffled(out, rng).slice(0, size)
}
