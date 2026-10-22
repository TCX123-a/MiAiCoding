/**
 * 「练相关题」的统一入口：把搜索命中的题组一张微型卷并开局（模式 `search`）。
 *
 * 【和 `extend.ts` / `favorite-practice.ts` 是同一个模式】
 * 动作只有一个定义，调用点（搜索面板的练题行）只管调它。
 * 组卷规则拆两层：**哪些题命中**在 `shared/search.ts` 的 `searchQuestions`
 * （纯函数、有单测，挑战题已经在那一层滤掉了），
 * **怎么洗牌、怎么配 keys** 在这里 —— 用 `buildPaper` 把题和键一起洗。
 *
 * 【为什么内容查找要能注入】
 * 照 `resolveWrongQuestion` 注入 `findBuiltIn` 的老规矩：真调用点不传，
 * 默认走内容 store；单测传一份假的 —— 免去在测试里啃 15MB 的真内容包。
 */
import { useQuizStore } from '../stores/quiz'
import { useContentStore } from '../stores/content'
import { toast } from '../components/base/toast'
import { TOAST } from './copy'
import { buildPaper } from '../../../shared/quiz-paper'
import { parseQuestionKey } from '../../../shared/question-key'
import type { QuestionSearchHit } from '../../../shared/search'
import type { Question } from '../../../shared/types'

/** 真调用点不传时走内容 store；单测注入假的（同 ExtendDeps / FavoriteQuestionDeps） */
export interface SearchPracticeDeps {
  findBuiltIn: (lessonId: string, qid: string) => Question | null
}

function contentDeps(): SearchPracticeDeps {
  const content = useContentStore()
  return {
    findBuiltIn: (lessonId, qid) =>
      content.lessonOf(lessonId)?.questions.find((q) => q.id === qid) ?? null
  }
}

export function useSearchStarter() {
  const quiz = useQuizStore()

  /**
   * 开一局搜索微型卷。
   *
   * @param hits 面板那一路的命中（`searchQuestions` 的输出，≤ SEARCH_QUIZ_MAX）
   * @returns 真的进了卷子的题数（0 = 一道都没解析出来，也没开局）
   *
   * 【一条都解析不出来时**静默**返回 0，不弹提示】
   * 命中条目和题目本体出自**同一份内存内容**（索引由 `bundle.lessons` 现场构建，
   * 解析也从它查）—— 真机上这条路径不可能发生，没有话可说就不说。
   * 这一点和收藏练习不同：那边条目是**存在磁盘上**的，内容改版后真的会对不上号，
   * 所以那边有一整套"哪些没带进来"的说法（favorite-practice.ts）。
   *
   * 【不为短的卷子找借口，但把实话说了】部分命中解析不出来（理论上同样不可能）
   * 时照开，toast 报**实际**题数 —— 悄悄少给几道，用户会以为搜索漏了题。
   */
  function startSearch(hits: readonly QuestionSearchHit[], deps?: SearchPracticeDeps): number {
    const d = deps ?? contentDeps()

    // 命中条目只有"档案"，题目本体回内容包按 key 拿（照 extend.ts 的 flatMap 模式：
    // 拿不到的条目直接不产出，不产生 undefined 占位）
    const pool = hits.flatMap((h) => {
      const { lessonId, qid } = parseQuestionKey(h.item.key)
      const q = d.findBuiltIn(lessonId, qid)
      return q ? [{ question: q, key: h.item.key }] : []
    })
    if (pool.length === 0) return 0

    // ⚠️ 用 buildPaper 洗：题目顺序和 keys **一起**洗，还顺手洗了选择题的选项顺序。
    // 只洗题目数组的话键会整体错位 ——「错的题记到别的题头上」（quiz-paper.ts 抬头）
    const paper = buildPaper(pool)
    quiz.startQuiz(
      'search',
      '__search__',
      paper.map((x) => x.question),
      paper.map((x) => x.key)
    )
    toast(TOAST.searchStarted(paper.length), 'success')
    return paper.length
  }

  return { startSearch }
}
