/**
 * 每日复习的入口：算权重 → 组卷 → 开一局。
 *
 * 【和 `stage-practice.ts` 是同一个模子】那边「先给用户看难度实况、再开局」，
 * 这边**没有"先看"这一步** —— 复习卷上是什么本来就不该预告（预告了就等于
 * 告诉用户"你哪几课弱"，那是另一个功能）。这里只做三件事：
 * 把依赖凑齐（内容索引 / 练习史 / 错题本 / 已学课）、调纯函数组卷、开局。
 *
 * 【组卷的规矩一律在 `shared/review-paper.ts`】加权、保留席、挑战题排除、
 * 不重复题，全在那边（纯函数、有单测）。这个文件**一条规则都不重复实现** ——
 * 重复一遍就等于有两份定义，改一处不改另一处时，界面上的表现是"偶尔不太对"。
 */
import { computed, type ComputedRef } from 'vue'
import { useQuizStore } from '../stores/quiz'
import { useContentStore } from '../stores/content'
import { usePracticeStore } from '../stores/practice'
import { useProgressStore } from '../stores/progress'
import {
  buildReviewPaper,
  normalizeReviewSize,
  type ReviewPaperItem
} from '../../../shared/review-paper'
import type { QuestionIndexItem } from '../../../shared/question-index'
import { parseQuestionKey } from '../../../shared/question-key'
import { buildPaper } from '../../../shared/quiz-paper'
import type { PracticeSession, Question } from '../../../shared/types'

/*
 * 题量两端与钳位函数住在 `shared/review-paper.ts` —— 界面（步进器）、
 * 上次选择的持久化（读回来那份）、组卷入参三处共用那一份定义，这里只转出去。
 */
export { REVIEW_MIN_SIZE, REVIEW_MAX_SIZE, normalizeReviewSize } from '../../../shared/review-paper'

/** 组好的一卷，交给 `start()` */
export interface ReviewDraft {
  questions: Question[]
  keys: string[]
  /** 这一卷实际覆盖了几节**不同的课**（结果页/确认区显示"从 N 课里抽的"） */
  lessonCount: number
  /** 实际抽到的题数（可能小于要的题量 —— 池子不够时如实给实际数） */
  size: number
}

/**
 * 组卷需要的东西，全部注入。
 *
 * 【为什么 lessons 由调用方给，不在这里从 learned 现推】
 * 复习池 != 「学过的课」。它还得**有题可出**（内容包里拿得到本体、且不是
 * 只剩挑战题）。这两件事在纯函数里有各自的检查（`buildReviewPaper` 会剔掉
 * 没题的课），但"哪些课算学过"必须由调用方说清楚 —— 测试里喂一个五节课的
 * 手工清单就能断言覆盖面，不必拖起 15MB 的真内容包和真档案。
 */
export interface ReviewDeps {
  /** 全部有正文的课的题目索引（真调用点传 `content.questionIndex`） */
  index: readonly QuestionIndexItem[]
  /** 按索引条目取题目本体 */
  findQuestion: (item: QuestionIndexItem) => Question | null
  /** 可复习的课（已学） */
  lessons: readonly string[]
  /** 练习史 —— 加权的真源 */
  history: readonly PracticeSession[]
  /** 错题本里**还活着**的键（cleared/removed 的不要传） */
  wrongKeys: readonly string[]
  /** 标了知识点漏洞的键 */
  holeKeys: readonly string[]
  /** 现在（毫秒时间戳）—— 判"近 3 天"用 */
  now: number
  rng?: () => number
}

/**
 * 组一卷。
 *
 * @returns 抽不出题（没学过 / 学过的课一道题都没有）时给 **null** ——
 *          调用方据此显示空态，而不是开一张空卷。
 *
 * 【为什么"先剔掉拿不到本体的题、后组卷"】
 * 和 `stage-practice.ts` 同款理由：内容改过之后，索引里可能留着内容包里
 * 已经不在的键。先组卷再解析的话，卷面上会出现**点开是「题目已被移走」的格子**，
 * 而且它照样占着 5 道题里的一个名额 —— 用户做了一轮复习，其中一道什么也没有。
 * 先剔后组，卷子的题数就是用户实际能做的题数。
 */
export function buildReviewDraft(size: number, deps: ReviewDeps): ReviewDraft | null {
  // ① 索引里能解析出本体的条目（挑战题由 buildReviewPaper 自己排除，这里不代劳）
  const usable: { item: QuestionIndexItem; question: Question }[] = []
  for (const item of deps.index) {
    const question = deps.findQuestion(item)
    if (question) usable.push({ item, question })
  }

  // ② 纯函数组卷
  const picked: ReviewPaperItem[] = buildReviewPaper({
    lessons: deps.lessons,
    history: deps.history,
    wrongKeys: deps.wrongKeys,
    holeKeys: deps.holeKeys,
    index: usable.map((u) => u.item),
    size,
    now: deps.now,
    ...(deps.rng ? { rng: deps.rng } : {})
  })
  if (picked.length === 0) return null

  // ③ 配好题面与键 —— picked 里的每个键都来自 usable（②的输入），必查得到
  const byKey = new Map(usable.map((u) => [u.item.key, u.question]))
  const entries = picked.map((p) => ({ question: byKey.get(p.key)!, key: p.key }))

  /*
   * ⚠️ 洗牌走 `buildPaper`，而且**题和键一起洗**（`quiz-paper.ts` 抬头）。
   * `buildReviewPaper` 出来时已经洗过一次（防"抽样顺序泄漏成卷面顺序"），
   * 这里再洗一次是因为**选项顺序**也要洗 —— 同一道题在复习里可能反复出现，
   * 选项不洗的话第二遍就是纯背位置。两次洗的不是同一样东西，别合并。
   */
  const paper = buildPaper(entries, entries.length, deps.rng)

  return {
    questions: paper.map((e) => e.question),
    keys: paper.map((e) => e.key),
    lessonCount: new Set(picked.map((p) => p.lessonId)).size,
    size: paper.length
  }
}

/**
 * 复习池 = 索引里出现过的课（= 有正文的课）∩ 学过的课。
 * **纯计算**，组卷（storeDeps）和视图（useReviewPool）共用这一份定义 ——
 * 各算各的话，「什么样算可复习」就有了两个说法，迟早对不上。
 */
function poolLessonsOf(index: readonly QuestionIndexItem[], learned: Set<string>): string[] {
  return [...new Set(index.map((it) => it.lessonId))].filter((id) => learned.has(id))
}

/**
 * 视图用：复习池里有几节课。
 *
 * 返回的 computed 里 **`null` = 档案还没读完**，和 0 是两回事：
 * 0 该显示「先去学一课喵」，null 该等一下（理由见 `start()` 的注释）。
 */
export function useReviewPool(): ComputedRef<number | null> {
  const content = useContentStore()
  const progress = useProgressStore()
  return computed(() =>
    progress.loaded ? poolLessonsOf(content.questionIndex, progress.learnedSet).length : null
  )
}

/** 真调用点：四个 store 各出一份 */
function storeDeps(): ReviewDeps | null {
  const content = useContentStore()
  const progress = useProgressStore()
  const practice = usePracticeStore()
  const quiz = useQuizStore()

  const lessons = poolLessonsOf(content.questionIndex, progress.learnedSet)
  if (lessons.length === 0) return null

  const live = quiz.wrongbook.filter((e) => !e.cleared && !e.removed)
  return {
    index: content.questionIndex,
    findQuestion: (it) => {
      const { qid } = parseQuestionKey(it.key)
      return content.lessonOf(it.lessonId)?.questions.find((q) => q.id === qid) ?? null
    },
    lessons,
    history: practice.history,
    wrongKeys: live.map((e) => e.key),
    holeKeys: live.filter((e) => e.hole).map((e) => e.key),
    now: Date.now()
  }
}

export function useReviewRunner() {
  const quiz = useQuizStore()
  const practice = usePracticeStore()
  const progress = useProgressStore()

  /**
   * 开一轮复习。
   *
   * @returns 实际开出来的题数；组不出卷给 **0**（调用方据此显示空态）；
   *          数据还没读完给 **-1**（调用方该等一下，别把"还没读到"当"没有课"）。
   *
   * 【为什么返回三种值，而不是 null 一刀切】
   * 「还没读到练习史/档案」和「确实没课可复习」在界面上是**两句不同的话**：
   * 前者该等一下（几十毫秒），后者该说「先去学一课喵」。合成一个 null 的话，
   * 冷启动进复习页会先闪一下"先去学一课"再变成能开卷 —— 那正是挑战页
   * 踩过的那个坑（见 progress.ts 里 `loaded` 的注释）。
   */
  async function start(size: number): Promise<number> {
    // 读一遍再开：练习史可能是上次开卷之后才变的（刚做完的练习）。
    // 它是小文件，读一遍远比重放增量便宜。
    // 内容包是**静态 import**（启动就有），没有"没读完"这一说 —— 所以这里
    // 只等这两份异步的：练习史和档案。
    if (!practice.loaded) await practice.load()
    if (!progress.loaded) return -1

    const deps = storeDeps()
    if (!deps) return 0

    // 钳一道（界面上那份已经钳过；这里再钳一次是防调用方直传越界值 ——
    // 组卷入参不合法的表现是"开出来的卷子比要的长/短"，而它一声不吭）
    const draft = buildReviewDraft(normalizeReviewSize(size), deps)
    if (!draft) return 0

    /*
     * ⚠️ 哨兵课号 `__review__` + **显式传 keys**。
     * 不传 keys 的话 `startQuiz` 会拿哨兵去拼 `__review__:q1` 这种垃圾键：
     * 答错了往错题本灌查不出题目的死条目、答对了也消除不掉原错题，一声不吭。
     * （`stores/quiz.ts` 的 restart 注释记着同型 bug 的教训。）
     */
    quiz.startQuiz('review', '__review__', draft.questions, draft.keys)
    return draft.questions.length
  }

  return { start }
}
