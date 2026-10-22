/**
 * 「延展练习」的统一入口：从一条错题出发，组一张相关的卷子并开局。
 *
 * 【和 `startPractice.ts` 是同一个模式】
 * 动作只有一个定义，调用点（错题本的行内按钮）只管调它。
 * 组卷规则拆两层：**选哪些题**在 `shared/extend-paper.ts`（纯函数、有单测），
 * **怎么洗牌、怎么配 keys**在这里 —— 用 `buildPaper` 把题和键一起洗。
 *
 * 【为什么内容查找要能注入（第三个参数）】
 * 照 `resolveWrongQuestion` 注入 `findBuiltIn` 的老规矩：真调用点不传，
 * 默认走内容 store；单测传一份假的课 + 假索引 —— 免去在测试里啃 15MB 的真内容包，
 * 也就不必把断言写成"对真内容此刻成立"（那种断言内容一改就红，红了也说不清是谁的错）。
 *
 * 【AI 补题（2026-09-30，闭环 §5.3）】
 * 静态池（索引里同课优先 + 标签匹配）凑不满用户选的量、而且配了 Key 时，
 * 问 AI 要**差额**那几道（只考源课这一课）+ 已出题干当防重复清单，补进同一张卷。
 * 三条铁纪律：
 *   · AI 题的键一律 `questionKey(宿主课, 题号)`，**绝不带 `__extend__` 哨兵** ——
 *     哨兵键进错题本就是一条"查不出课"的垃圾条目，quiz.ts 的 restart 注释里
 *     记着同型 bug 的现场；
 *   · 失败（断网 / 限流 / 取消 / 克隆炸）**一律静默退回静态池**，不够就如实少出 ——
 *     AI 不可用是日常不是故障（docs/03 A7），不该把还能练的卷子拦下来；
 *   · 入参必须 `toIpc`：topics / terms 都是"从 store 上读出来的"，代理过不了
 *     结构化克隆（本项目在这个坑上栽过三次，见 lib/ipc-safe.ts）。
 */
import { useQuizStore } from '../stores/quiz'
import { useContentStore } from '../stores/content'
import { useSettingsStore } from '../stores/settings'
import { toast } from '../components/base/toast'
import { TOAST } from './copy'
import { toIpc } from './ipc-safe'
import { buildExtendPool, EXTEND_MAX, type ExtendSource } from '../../../shared/extend-paper'
import type { QuestionIndexItem } from '../../../shared/question-index'
import { buildPaper } from '../../../shared/quiz-paper'
import { resolveWrongQuestion } from '../../../shared/wrongbook'
import { parseQuestionKey, questionKey } from '../../../shared/question-key'
import { todayKey } from '../../../shared/dates'
import type { AiParseResult } from '../../../shared/ai-question'
import type {
  AiGenerateInput,
  AiResult,
  AiTopicInput,
  GlossaryTerm,
  Lesson,
  Question,
  WrongBookEntry
} from '../../../shared/types'

/** 延展启动器要问内容包的三件事（见文件抬头"可注入"那段） */
export interface ExtendDeps {
  lessonOf: (id: string) => Lesson | undefined
  index: readonly QuestionIndexItem[]
  findBuiltIn: (lessonId: string, qid: string) => Question | null
  /** AI 补题。省略 = 不补（没接线的调用点 / 不关心 AI 的单测） */
  ai?: ExtendAi
}

/** AI 补题的全部外部依赖 —— 单测注入假货，真调用点见 `startExtend` 的默认 deps */
export interface ExtendAi {
  /** 配没配 Key。没配就不问 —— "没配"不是失败，是还没开这个功能（challenge 同款口径） */
  hasKey: boolean
  /**
   * 用户在设置页有没有**主动打开**「AI 动态出题」。
   *
   * 【为什么有 Key 还要看它】Key 只是能力，开关才是授权：动态出题会花
   * 用户自己的余额。默认关，老用户升级上来行为不变；关着时静态池不够也
   * **不问 AI**，直接按现有题量出卷。
   */
  dynamicEnabled: boolean
  /** 本地日期 `YYYY-MM-DD`，AI 题号要用（`ai-<日期>-<序号>`） */
  dateKey: string
  /** 术语表。**存引用、调用时才 toIpc** —— 它是从 store 上读的响应式代理 */
  terms: GlossaryTerm[]
  /**
   * 真去问。生产 = `window.miai.aiGenerateQuestions`；
   * 单测 = 假货（照 challenge.test.ts 先例，用 `structuredClone` 当守门员：
   * 载荷里混进代理会当场炸 —— 和真 IPC 一样）。
   */
  ask: (input: AiGenerateInput) => Promise<AiResult<AiParseResult>>
}

/**
 * 用 AI 补足差额那几道。返回能直接进卷的 `{question, key}`；失败一律空数组。
 *
 * 【问什么】topics **只有源课一节**：延展练习瞄的就是这条错题的知识点。
 * `stems` 带上"这一课已经出过的"题干（错题本体 + 静态池里同课的题）——
 * 它既是防重复清单，也是风格样例（types.ts 里 `AiTopicInput.stems` 的定义）。
 * **别的课的题干不往这里塞**：stems 的语义是"这一课的已出题"，
 * 塞错主人会让模型把别的课的内容挂到这个课号下 —— 题面与课对不上，而且不报错。
 *
 * 【失败为什么返回空数组而不是抛】调用方对"没补上"的应对永远是同一套：
 * 出静态卷、不够就如实少出。在这里抛只会给调用方多一个 catch，没有第二个去向。
 * 出网前的意外（toIpc 克隆炸 —— 那是我们自己的载荷形状问题）也归入这条路，
 * 但**留一行 console.error**：它和"AI 真挂了"在界面上长得一模一样，
 * 不留痕就永远查不出来（challenge.ts 吞 run 失败时是同一套做法）。
 */
async function fillWithAi(
  ai: ExtendAi,
  entry: WrongBookEntry,
  lesson: Lesson,
  stems: string[],
  shortfall: number
): Promise<{ question: Question; key: string }[]> {
  const topics: AiTopicInput[] = [
    {
      lessonId: entry.lessonId,
      title: lesson.title,
      tags: [...lesson.tags],
      stems: [...stems]
    }
  ]

  let res: AiResult<AiParseResult>
  try {
    res = await ai.ask({
      topics: toIpc(topics),
      count: shortfall,
      terms: toIpc(ai.terms),
      dateKey: ai.dateKey
    })
  } catch (e) {
    console.error('[extend] ai fill failed:', e)
    return []
  }

  // `ok:false` 一律回退 —— 包括 canceled：延展没有"取消"按钮，
  // 取消只可能是别的流程顺手掐的，不值得在这里翻译成用户可见的说法。
  // `items` 不是数组也按"没补上"处理：主进程回话形状不对时，这里不能让
  // `.length` 抛出去（那会把整张还能出的静态卷拦下来）。
  if (!res.ok || !res.data || !Array.isArray(res.data.items) || res.data.items.length === 0) return []

  // 键按 AI 题的**宿主课**拼；lessonId 是解析环节从 topics 绑上去的（ai-question.ts），
  // 所以这里拿到的一定是真实课号，不可能是空串或哨兵
  return res.data.items.map((it) => ({
    question: it.question,
    key: questionKey(it.lessonId, it.question.id)
  }))
}

/**
 * 同一时刻只允许一张「延展卷」在组。
 *
 * 不拦会怎样（review 2026-10-21）：AI 补题最长等 180 秒，用户以为没点上又点
 * 一次 —— 第二次 `aiGenerateQuestions` 会 abort 第一次（main 是单飞），第一次
 * 拿 canceled 静默退回静态池并 `startQuiz`，第二次随后也 `startQuiz` ——
 * 会话被整张覆盖，第一张卷的作答进度凭空消失。
 *
 * 放在模块级而不是 `useExtendStarter` 内：这个 composable 可能被多个组件各建
 * 一份（练习页、以后别的入口），闭包里的标志各管各的，拦不住跨组件连点。
 */
let extendInFlight = false

export function useExtendStarter() {
  const quiz = useQuizStore()
  const content = useContentStore()
  const settings = useSettingsStore()

  /**
   * 对一条错题开延展练习。
   *
   * 【为什么是 async】静态池不够时要等 AI 补题（见文件抬头）。调用点记得 `void`。
   *
   * @param entry 来源错题（行内按钮点的那一行）
   * @param count 用户选的题量（1~10；池子不够就如实少出，见下）
   * @param deps  内容查找 + AI 依赖（省略 = 走内容 store 与真 IPC；单测注入假的）
   */
  async function startExtendInner(
    entry: WrongBookEntry,
    count: number,
    deps?: ExtendDeps
  ): Promise<void> {
    const d: ExtendDeps = deps ?? {
      lessonOf: (id) => content.lessonOf(id),
      index: content.questionIndex,
      findBuiltIn: (lessonId, qid) =>
        content.lessonOf(lessonId)?.questions.find((q) => q.id === qid) ?? null,
      ai: {
        hasKey: settings.config.ai.hasKey,
        dynamicEnabled: settings.config.ai.dynamicEnabled === true,
        dateKey: todayKey(),
        terms: content.bundle.glossary.terms,
        ask: (input) => window.miai.aiGenerateQuestions(input)
      }
    }

    const lesson = d.lessonOf(entry.lessonId)
    if (!lesson) {
      // 来源课都找不到了，语言/标签/同课候选全无从谈起。
      // 和列表上那句「题目已被移走喵」同一起因，用同一句话
      toast(TOAST.WRONG_ENTRIES_BROKEN, 'warn')
      return
    }

    const src = resolveWrongQuestion(entry, d.findBuiltIn)
    const source: ExtendSource = {
      key: entry.key,
      lessonId: entry.lessonId,
      lang: lesson.lang,
      tags: lesson.tags,
      // 来源题解析不出来（AI 题宿主课还在、本体缺了？那是坏条目）就不给 type：
      // 打分表里"同题型 +1"作废而已，不该因此拒绝服务（见 extend-paper.ts）
      ...(src ? { type: src.type } : {})
    }

    // 索引条目只有"档案"（键/课号/难度/标签…），题目本体回内容包按 key 拿。
    // `flatMap` 而不是 map+filter：拿不到的条目直接不产出，不产生 undefined 占位
    const items = buildExtendPool(d.index, source).flatMap((it) => {
      const { lessonId, qid } = parseQuestionKey(it.key)
      const q = d.lessonOf(lessonId)?.questions.find((x) => x.id === qid)
      return q ? [{ question: q, key: it.key }] : []
    })

    // 题量两端钳死：UI 的选项是 1~10，但钳在这里 —— 调用方传 0 或 99 也出不了
    // 空卷 / 超量卷（`|| 0` 顺手把 NaN 也归到 0，再被 max 抬到 1）
    const want = Math.min(Math.max(Math.floor(Number(count) || 0), 1), EXTEND_MAX)

    // AI 补题：静态池凑不满、而且**用户开了动态出题 + 配了 Key** 时才问。
    // 静态池为空也走这里 —— 那正是 AI 补题最该顶上的场景（这一课没别的题可练）
    let merged = items
    if (d.ai?.dynamicEnabled && d.ai?.hasKey && items.length < want) {
      // 「这一课已经出过的题干」= 错题本体 + 静态池里同课的题（别的课的不算，见 fillWithAi）
      const stems = [
        ...new Set([
          ...(src ? [src.stem] : []),
          ...items
            .filter((it) => parseQuestionKey(it.key).lessonId === entry.lessonId)
            .map((it) => it.question.stem)
        ])
      ]
      // 等 AI 的这段时间里，用户可能已经开了别的卷子（挑战/练习/另一张延展）。
      // 迟到的卷子不许把人正在做的那张覆盖掉 —— 快照比对是最便宜也最可靠的判据。
      const sessionBefore = quiz.session
      const extra = await fillWithAi(d.ai, entry, lesson, stems, want - items.length)
      if (quiz.session !== sessionBefore) return
      if (extra.length > 0) merged = [...items, ...extra]
    }

    if (merged.length === 0) {
      // 静态池空、AI 也没补上（没配 Key / 失败了 / 也交白卷）——
      // 如实说"没题可延展"，不硬开一张空卷
      toast(TOAST.EXTEND_NONE, 'warn')
      return
    }

    const take = Math.min(want, merged.length)
    // ⚠️ 用 buildPaper 洗：题目顺序和 keys **一起**洗。
    // 只洗题目数组的话键会整体错位 ——「错的题记到别的题头上」（quiz-paper.ts 抬头）
    const paper = buildPaper(merged, take)
    quiz.startQuiz(
      'extend',
      '__extend__',
      paper.map((e) => e.question),
      paper.map((e) => e.key)
    )
    // 凑不满选的量时如实说"只有 N 道"——不假装凑齐了（AI 补过仍不够也一样）。
    // 这两句说在开局**之后**：会话已经开起来了（用户马上要做题），
    // 提示条只是解释"为什么比我要的少"，不拦人
    if (take < want) toast(TOAST.extendShort(take), 'warn')
    else toast(TOAST.extendStarted(take), 'success')
  }

  /**
   * 对外的入口：同一时刻只跑一张延展卷。重复点击**静默忽略**（不是报错）——
   * 第一次点击已经在组卷了，第二次没有可做的正确动作。
   */
  async function startExtend(
    entry: WrongBookEntry,
    count: number,
    deps?: ExtendDeps
  ): Promise<void> {
    if (extendInFlight) return
    extendInFlight = true
    try {
      await startExtendInner(entry, count, deps)
    } finally {
      extendInFlight = false
    }
  }

  return { startExtend }
}
