/**
 * 阶段 / 整门综合练习的入口：选一卷 →（让用户看一眼难度实况）→ 开局。
 *
 * 【和 `favorite-practice.ts` / `extend.ts` 是同一个模式，但多了"先给用户看"这一步】
 * 别的入口点下去直接开卷 —— 卷子上是什么本来就一目了然（"我选的这几条"/
 * "这道错题的同类题"）。阶段卷不一样：**用户没法从按钮上知道这一卷会考什么**。
 * 它可能是 10 道全是简单题（那这门语言的困难题池空了，而用户不知道），
 * 也可能是 10 道里 4 道困难（那和课后练习完全不是一个强度）。
 * 所以这里把组卷**拆成两步**：`prepare()` 先真组一遍并算出实况，界面拿着实况
 * 摆给用户看，他点了「开始」才 `start()`。实况是**已经发生的事实**，
 * 不是"我们打算出几道难题"那种预告 —— 用户看到 3 道就是 3 道。
 *
 * 【为什么"先解析题目本体、后组卷"，不是反过来】
 * 索引里 4023 条，内容包理论上全都拿得到本体。但"理论上"三个字撑不起界面：
 * 内容改过之后，某道题的键可能已经不在内容包里了 —— 那时卷子上会出现一个
 * **点开是「题目已被移走」的格子**，而且它照样占着 10 道题里的一个名额。
 * 先把拿不到本体的剔掉再组卷，卷子的 `stats` 和用户实际看到的题就永远一致。
 *
 * 【判据一律从 `shared/stage-paper.ts` 来】题量、难度下限、跨课比例全在那边
 * （纯函数、有单测、还有真内容包的回归网）。这个文件只做三件事：
 * 按语言+阶段把池子筛出来、把键和题目本体配好对、开局。
 */
import { ref } from 'vue'
import { useQuizStore } from '../stores/quiz'
import { useContentStore } from '../stores/content'
import { buildPaper } from '../../../shared/quiz-paper'
import { filterIndex, type QuestionIndexItem } from '../../../shared/question-index'
import { parseQuestionKey } from '../../../shared/question-key'
import {
  LANG_HARD_RATIO,
  LANG_PAPER_SIZE,
  STAGE_HARD_RATIO,
  STAGE_PAPER_SIZE,
  buildStagePaper,
  type StagePaperStats
} from '../../../shared/stage-paper'
import { LANG_LABEL, STAGE_LABEL } from './labels'
import type { LangOfCode, Question, Stage } from '../../../shared/types'

/** 两种综合练习。它们**只有三个参数不同**：池子的筛法、题量、硬题下限 */
export type PaperKind = 'stage' | 'lang'

/** 组好但还没开的一卷。界面拿它渲染确认框，"开始"按钮再把它交给 `start()` */
export interface PaperDraft {
  kind: PaperKind
  lang: LangOfCode
  /** 整门卷没有阶段 —— 这里留 undefined 而不是随便给个 1，免得有人拿它去筛 */
  stage?: Stage
  /** 确认框的标题，如「C 语言 · 入门」 */
  label: string
  questions: Question[]
  keys: string[]
  stats: StagePaperStats
}

/**
 * 组卷需要的东西，注入进来。
 *
 * 【为什么不像别的入口那样只注入 `findBuiltIn`】
 * 综合练习**不查错题本也不查收藏**，它唯一的输入就是题目索引 ——
 * 而索引在 `content.questionIndex` 上，直接注入整个索引比注入一个查找函数
 * 更贴近它真正要的东西（它要按语言+阶段**筛**，不只是按 key 查）。
 * 单测因此可以喂一个几十条的手工索引，不必拖起 15MB 的真内容包。
 */
export interface StagePaperDeps {
  /** 全部有正文的课的题目索引（真调用点传 `content.questionIndex`） */
  index: readonly QuestionIndexItem[]
  /** 按索引条目取题目本体 */
  findQuestion: (item: QuestionIndexItem) => Question | null
  /** 可注入的随机源（单测断言"同一串随机数给同一张卷"） */
  rng?: () => number
}

/** 真调用点：内容 store 就是全部依赖 */
function contentDeps(): StagePaperDeps {
  const content = useContentStore()
  return {
    index: content.questionIndex,
    findQuestion: (it) => {
      const { qid } = parseQuestionKey(it.key)
      return content.lessonOf(it.lessonId)?.questions.find((q) => q.id === qid) ?? null
    }
  }
}

/**
 * 组一卷，顺便把实况算出来。
 *
 * @returns 组不出来（池子是空的 / 一道题的题面都找不到）时给 **null** ——
 *          调用方据此不开卷也不弹框。**空卷绝不摆到用户面前**：
 *          确认框上写着"这一卷 10 道题"、点开始却是一张空卷，比不给入口更糟。
 */
export function buildPaperDraft(
  kind: PaperKind,
  lang: LangOfCode,
  stage: Stage | undefined,
  deps: StagePaperDeps
): PaperDraft | null {
  /*
   * 池子：阶段卷按「语言 + 阶段」筛，整门卷按「语言」筛。
   *
   * ⚠️ `stage` 传 undefined 与传某个值是**两件事**，不能靠 `stage ?? 1` 兜底 ——
   * 那样整门卷会静默变成"这门语言的阶段一"，而界面上的标题还写着整门。
   * 这里让两条路显式分开写，多写一个三元表达式换掉一类静默错误。
   */
  const pool = filterIndex(deps.index, kind === 'stage' ? { lang, stage } : { lang })

  // 先解析、后组卷（理由见文件抬头）。挑战题**不排除** ——
  // 阶段/整门/每日挑战是它允许出现的三处（见 shared/difficulty.ts 的 relaxOrder）。
  const usable: { item: QuestionIndexItem; question: Question }[] = []
  for (const item of pool) {
    const question = deps.findQuestion(item)
    if (question) usable.push({ item, question })
  }

  const result = buildStagePaper(
    usable.map((u) => u.item),
    kind === 'stage' ? STAGE_PAPER_SIZE : LANG_PAPER_SIZE,
    kind === 'stage' ? STAGE_HARD_RATIO : LANG_HARD_RATIO,
    deps.rng
  )
  if (result.items.length === 0) return null

  const byKey = new Map(usable.map((u) => [u.item.key, u.question]))
  const entries = result.items.map((item) => ({ question: byKey.get(item.key)!, key: item.key }))

  /*
   * ⚠️ 洗牌必须走 `buildPaper`，而且**题和键一起洗**（`quiz-paper.ts` 抬头）。
   * 阶段卷尤其不能省：同一张卷子用户会反复开（"再来一卷"），
   * 不洗选项顺序的话第二遍就是纯背位置 —— 那正是这个项目修过的那个 bug。
   */
  const paper = buildPaper(entries, entries.length, deps.rng)

  return {
    kind,
    lang,
    stage,
    label:
      kind === 'stage' && stage !== undefined
        ? `${LANG_LABEL[lang]} · ${STAGE_LABEL[stage]}`
        : LANG_LABEL[lang],
    questions: paper.map((e) => e.question),
    keys: paper.map((e) => e.key),
    stats: result.stats
  }
}

export function useStageStarter() {
  const quiz = useQuizStore()

  /**
   * 开一局。
   *
   * @returns 进了卷子的题数（好让调用点断言"确实开了"，也方便测试）
   *
   * 【两个哨兵课号】`QuizSession.lessonId` 对非课内模式只是个占位
   * （见 stores/quiz.ts 的字段注释），真正认题的是 `keys`。
   * ⚠️ **keys 必须显式传** —— 不传的话 `startQuiz` 会拿哨兵课号去拼
   * `__stage__:q1` 这种垃圾键：答错了往错题本里灌一堆查不出题目的死条目，
   * 而且一声不吭（`stores/quiz.ts` 的 restart 注释记着同型 bug 的教训）。
   */
  function start(draft: PaperDraft): number {
    quiz.startQuiz(
      draft.kind,
      draft.kind === 'stage' ? '__stage__' : '__lang__',
      draft.questions,
      draft.keys
    )
    return draft.questions.length
  }

  return { start }
}

/**
 * 「点一下按钮」到「开卷」的完整动作 —— 视图只需要调这一个。
 *
 * 【为什么把 `prepare` 也包进来】视图里本该只有一行 `const d = prepare(...)`，
 * 但每个调用点都得先 `contentDeps()` 一次，写三遍就会有人漏掉 deps 那个参数
 * （它是可选的，漏了不报错，只是拿不到内容 → 静默组不出卷）。
 * 包一层之后调用点没有可漏的地方。
 *
 * 【`deps` 参数是测试通道，生产调用点一个都不传】真调用点走 `contentDeps()`。
 * 单测要喂手工索引（见 `stage-practice.test.ts` 抬头：不拖真内容包），
 * 而项目里零 `vi.mock` —— 替身一律显式传入。传了就用传的，其余全走真代码。
 * ⚠️ 它只有两个取值语境：不传（生产）/ 一份假索引（测试），不是"可选配置"。
 */
export function useStageRunner(deps?: StagePaperDeps) {
  const { start } = useStageStarter()
  return {
    prepare: (kind: PaperKind, lang: LangOfCode, stage?: Stage) =>
      buildPaperDraft(kind, lang, stage, deps ?? contentDeps()),
    start
  }
}

/**
 * 「点一下入口」到「开卷」的全部状态 —— 练习页的「阶段练习」页签和侧栏
 * 阶段末尾两处入口共用这一份（2026-10-01 从总览页搬出来的，逻辑零改动）。
 *
 * 【为什么连 `paperOpen` 一起收进来，而不是让调用点各自持有一个 ref】
 * `pendingPaper` 和 `paperOpen` 是一件事的两半：框开着的那一刻，`draft` 必然
 * 就是用户正在看的那一卷。让每个视图各拿一个 ref 拼起来，迟早有人只关框不清卷
 * （或反过来），表现是"再打开时框里还留着上一卷的题"——不报错。
 *
 * 【每次调用建独立闭包，不做模块级单例】侧栏是常驻组件，练习页切换页签也在
 * 同一棵树上 —— 两处同时活着。共用一个模块级的 `paperOpen` 是 bug 温床：
 * 侧栏打开确认框，练习页那边也"开着"。所以这里是普通工厂函数，谁调谁拿自己的一份。
 *
 * 【`deps` 参数同 `useStageRunner`：测试通道，生产不传】
 */
export function useStagePaperFlow(deps?: StagePaperDeps) {
  const runner = useStageRunner(deps)

  /** 组好等着用户点头的那一卷。null = 没有待确认的（框也就关着） */
  const pendingPaper = ref<PaperDraft | null>(null)
  const paperOpen = ref(false)

  /**
   * 点「综合练习」**先真组一遍**，组得出来才开确认框。
   *
   * 【为什么失败时是"什么都不发生"】`prepare()` 返回 null 只有一种情况：
   * 这一档的池子一道题都拿不到（索引空、或内容改过导致题面全解析不出来）。
   * 那时**不该弹一个空框**说"这一卷 0 道题"—— 那比不给入口更糟。
   * 眼下的内容包不会走到这儿（229 课全有正文、4023 道题的题面全在），
   * 它是内容被改坏时的兜底，所以安静地不开就是全部该做的事。
   */
  function openPaper(kind: PaperKind, lang: LangOfCode, stage?: Stage): void {
    const draft = runner.prepare(kind, lang, stage)
    if (!draft) return
    pendingPaper.value = draft
    paperOpen.value = true
  }

  /**
   * 确认开卷：**先关框再开卷**。
   *
   * 两句话是有顺序的：MiModal 的遮罩是 `position:fixed; inset:0; z-index:9000`，
   * 而答题遮罩（QuizOverlay）也是 9000 —— 框不先关，它那 190ms 的退场
   * 会盖在新开的答题界面上面（MiModal 现在给退场加了 `pointer-events:none`，
   * 点得动，但不该让用户看见一层正在消失的膜压在题目上）。
   * ⚠️ 现在有三个调用点（侧栏 / 练习页 / 确认框自己），各写各的迟早漏一处 ——
   * 收进这个 composable 的最大价值就在这一句。
   */
  function startPaper(draft: PaperDraft): void {
    paperOpen.value = false
    runner.start(draft)
  }

  return { pendingPaper, paperOpen, openPaper, startPaper }
}
