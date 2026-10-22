/**
 * 抽题候选池 —— 练习页随机组卷和每日挑战共用。
 *
 * 【这个文件为什么先于「每日挑战」出现】
 * 练习页原本自己拼了一个池子，但拼的时候**只把题目抓了出来，把「这题属于哪一课」丢了**：
 *
 *     out.push(...l.questions)        // ← lessonId 在这一步没了
 *
 * 丢了以后连锁出两个 bug，而且都不报错、只是安静地不对：
 *   1. 随机组卷答错的题进错题本，key 变成 `__random__:q1` —— 课名显示成 `__random__`，
 *      题干也显示不出来（因为按 `__random__` 查不到任何课）
 *   2. 错题本点「再练一次」答对也消除不掉（重开一局时 key 走回默认值，和原 key 对不上）
 *
 * 所以池子从第一天起就必须**带着宿主信息**。这个类型就是那条约束的载体：
 * 想拿到题目，就必须连 lessonId 一起拿着，没法再「不小心把它丢了」。
 */
import { shuffled } from './quiz-paper'
import { CHALLENGE_RUN_MAX } from './cloud/protocol'
import type { ChallengeDay, Lesson, LessonStatus, Question } from './types'

/** 候选池里的一项：题目 + 它属于哪一课 */
export interface PoolItem {
  question: Question
  /** 宿主课 id。**这是错的根源，也是修的关键，永远不能丢**
   *  （错题本全局键 = 它 + 题 id，见 shared/question-key.ts） */
  lessonId: string
  /** 宿主课标题。存一份省得各处再查一次课；错题本列表、AI 出题提示词都要用 */
  lessonTitle: string
}

/**
 * 按给定条件收集候选题目。
 *
 * `statusOf` 和 `accept` 都从外面传进来，因为池子有两处用法、判定条件不一样：
 *   - 练习页随机组卷：`open | learned`（解锁了就能练）
 *   - 每日挑战：只用 `learned`（没学过的课不该出题考人）
 * 把条件做成参数，两处共用同一套「收集 + 带上宿主」的逻辑，不会各自写歪。
 *
 * 没有内容的课直接跳过 —— 192 门课里大部分还没有正文和题库，
 * 它们的 `questions` 是空数组，收进来只会稀释池子。
 */
export function buildPool(
  lessons: Lesson[],
  statusOf: (lessonId: string) => LessonStatus,
  accept: (status: LessonStatus) => boolean
): PoolItem[] {
  const out: PoolItem[] = []
  for (const l of lessons) {
    if (l.questions.length === 0) continue
    if (!accept(statusOf(l.id))) continue
    for (const q of l.questions) {
      out.push({ question: q, lessonId: l.id, lessonTitle: l.title })
    }
  }
  return out
}

/**
 * 从池子里挑 n 道题（Fisher-Yates 洗牌后取前 n）。
 *
 * `rng` 可注入：测试里塞一个确定性的假随机源，才能断言「挑出来的就是这几道」。
 * 直接用 `Math.random()` 的话测试只能验「挑出来了 n 道」，验不了「挑对了没有」。
 *
 * 池子不够 n 道就**有几道给几道** —— 不是错误，也不补空题
 * （硬凑 n 只会凑出重复的题）。
 *
 * 【和 `quiz-paper.ts` 的分工】
 * 这里只回答「**挑哪几道**」；挑完之后还要洗选项顺序、还要保证伴随数据跟着走，
 * 那是 `buildPaper()` 的事。练习页现在直接用 `buildPaper`（它内部就带洗牌 + 取前 n），
 * 本函数只剩每日挑战在用 —— 因为挑战要先按「出没出过」分成两半，再分别挑。
 */
export function pickFromPool(
  pool: PoolItem[],
  n: number,
  rng: () => number = Math.random
): PoolItem[] {
  return shuffled(pool, rng).slice(0, Math.max(0, Math.min(n, pool.length)))
}

// ---------------------------------------------------------------- 每日挑战

/**
 * 每日挑战里 AI 段的题数（客户端向 AI 要多少道）。
 *
 * 2026-10-10 晚 v3 主人令：单日题数产品上限取消——答对继续、答错立即停止，
 * 本地题一次抽**整个已学题库**（开始前可勾选今天想考的语言）。
 * AI 段不跟池子走：固定 20 道、拼在批次最前；后面接本地全池。
 * 与服务端 cloud/protocol.ts 的 CHALLENGE_RUN_MAX（5000 健全性上界）是两回事；
 * 与 AI 解析层 MAX_AI_QUESTIONS（shared/ai-question.ts）语义不同但恰好同值，
 * 等价单测钉住 CHALLENGE_AI_BLOCK ≤ MAX_AI_QUESTIONS。
 */
export const CHALLENGE_AI_BLOCK = 20

/**
 * 单局每日挑战里**本地段**的题数上限。
 *
 * 【为什么不再整池全抽】2026-10-21 把题库扩到 4271 道（课文另 1754 道），
 * 全库 6025 道已经超过服务端 `CHALLENGE_RUN_MAX`（5000，健全性上界）。
 * v3 的「整池全抽」于是会让一局超过 5000：超出的部分在收工时会被
 * `challenge-settle.ts` 悄悄截掉（做了不上账），守门单测也会红。
 * AI 段固定 20 道拼在最前，所以本地段封顶 = 5000 - 20。
 *
 * 4980 道对一个人一天来说仍然是「做不完」，产品上还是无限题库；
 * 封顶只是把「协议放不下的尾巴」挡在抽题这一步，而不是收工时才偷偷扔掉。
 */
export const CHALLENGE_LOCAL_CAP = CHALLENGE_RUN_MAX - CHALLENGE_AI_BLOCK

/**
 * 从最近几天的批次里，算出每道题**最后一次**出现是哪天。
 *
 * 【为什么返回「最后一次」而不是「出现过没有」】
 * 池子不够时要从出过的题里补，补的顺序得讲道理 —— 挑**最久没出过**的那批，
 * 而不是随便捞。没有「最后一次是哪天」这个信息，就只能随机补，
 * 表现是「昨天刚考的题今天又考」，比不补还糟。
 *
 * 键是全局题号 `lessonId:qid`（和错题本同一套，见 shared/question-key.ts）。
 */
export function lastSeenOf(days: ChallengeDay[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const d of days) {
    for (const q of d.questions) {
      const prev = out[q.key]
      // 日期是 `YYYY-MM-DD`，字典序即时间序，直接比大小就够
      if (prev === undefined || d.dateKey > prev) out[q.key] = d.dateKey
    }
  }
  return out
}

/**
 * 抽每日挑战的题：**先从没出过的里面抽，不够再拿最久没出过的补**。
 *
 * 【为什么不「有出过的一律排除」】
 * 一刀切排除的后果不是「题目更新鲜」，而是**抽不满甚至抽空** ——
 * 学员看到的是「今天的挑战只有 2 道题」，或者干脆没有。
 * 所以排除是**优先级**，不是**门槛**：新鲜的优先，实在不够就拿旧的顶上
 * （v3 起调用方传 n = 整池长度，等价于「全池都要」，新鲜度只决定先后顺序）。
 *
 * 【为什么池子空就返回空数组，而不是报错】
 * 一道题都抽不出来不是故障，是「还没学过任何一课」——
 * 那是新用户的默认状态，该走空状态引导他去学习，不该弹错误。
 */
export function pickChallenge(
  pool: PoolItem[],
  lastSeen: Record<string, string>,
  n: number,
  rng: () => number = Math.random
): PoolItem[] {
  const fresh: PoolItem[] = []
  const used: PoolItem[] = []
  for (const it of pool) {
    const key = `${it.lessonId}:${it.question.id}`
    ;(lastSeen[key] === undefined ? fresh : used).push(it)
  }

  const picked = pickFromPool(fresh, n, rng)
  if (picked.length >= n) return picked

  // 还不够：把出过的按「最久没出过」排前面补上。
  // fresh 和 used 是同一套判定切出来的两半，天然不重叠，所以这里不用再去重。
  const rest = used.slice().sort((a, b) => {
    const ka = lastSeen[`${a.lessonId}:${a.question.id}`]
    const kb = lastSeen[`${b.lessonId}:${b.question.id}`]
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
  for (const it of rest) {
    if (picked.length >= n) break
    picked.push(it)
  }
  return picked
}
