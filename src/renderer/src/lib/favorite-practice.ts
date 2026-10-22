/**
 * 「练这几道」的统一入口：把收藏条目组一张卷子并开局（模式 `fav`）。
 *
 * 【和 `extend.ts` / `startPractice.ts` 是同一个模式】
 * 动作只有一个定义，调用点（收藏页的行内按钮、多选工具条）只管调它。
 * 「这一条能不能练」的判据在 `lib/favorites-view.ts` 的 `canPracticeFavorite`
 * （纯函数、有单测），这里只负责**把能练的攒起来、洗牌、开局**。
 *
 * 【为什么内容查找要能注入】照 `resolveWrongQuestion` 注入 `findBuiltIn` 的
 * 老规矩：真调用点不传，默认走内容 store；单测传一份假的 —— 免去在测试里啃
 * 15MB 的真内容包，断言也就不必写成"对真内容此刻成立"（那种断言内容一改就红，
 * 红了也说不清是谁的错）。
 */
import { useQuizStore } from '../stores/quiz'
import { useContentStore } from '../stores/content'
import { toast } from '../components/base/toast'
import { TOAST } from './copy'
import { buildPaper } from '../../../shared/quiz-paper'
import { canPracticeFavorite, resolveFavoriteQuestion, type FavoriteQuestionDeps } from './favorites-view'
import type { FavoriteItem, Question } from '../../../shared/types'

/** 真调用点不传时走内容 store；单测注入假的（同 ExtendDeps） */
function contentDeps(): FavoriteQuestionDeps {
  const content = useContentStore()
  return {
    findBuiltIn: (lessonId, qid) =>
      content.lessonOf(lessonId)?.questions.find((q) => q.id === qid) ?? null
  }
}

export function useFavoriteStarter() {
  const quiz = useQuizStore()

  /**
   * 开一局收藏练习。
   *
   * @param items 要练的那些收藏（行内按钮给一条，多选工具条给选中的一批）
   * @returns 真的进了卷子的题数（0 = 一道都没练成，也没开局）
   *
   * 【三种缺料各有各的说法，不许合并成一句】见 copy.ts 的 `FAVORITES_ALL_CHALLENGE`
   * 和 `favoritesSkipped`：挑战题是"故意不在这儿出"，找不到的题是"内容里真没了"。
   * 合成"有 N 道没进来"的话，用户不知道该去阶段练习找它、还是该把收藏删了。
   *
   * 【不为空的卷子找借口】能练的不到选中的那么多时**照开**，但把差额说出来 ——
   * 悄悄少给几道，用户会以为收藏丢了。
   */
  function startFavorites(items: readonly FavoriteItem[], deps?: FavoriteQuestionDeps): number {
    const d = deps ?? contentDeps()

    const pool: { question: Question; key: string }[] = []
    let broken = 0
    let challenge = 0
    for (const it of items) {
      const q = resolveFavoriteQuestion(it, d)
      if (!q) {
        broken++
        continue
      }
      // 挑战题不进这个入口（判据与界面上的按钮显不显示同一份，见 canPracticeFavorite）
      if (!canPracticeFavorite(it, d)) {
        challenge++
        continue
      }
      pool.push({ question: q, key: it.key })
    }

    // 空清单：没有要练的题，就不开局、也不说话（按钮本来就不该在这种情况下出现）。
    // 这一句也是下面 else 分支的前提 —— 有一条输入，就必然落进 broken / challenge 之一。
    if (items.length === 0) return 0

    if (pool.length === 0) {
      // 全灭时按**原因**挑说法：只说"没带进来"太含糊，说错原因更糟
      // （题明明在，却告诉用户"找不到了"，他会去删了重收，而重收还是练不了）
      if (challenge > 0 && broken === 0) toast(TOAST.FAVORITES_ALL_CHALLENGE, 'warn')
      else if (broken > 0 && challenge === 0) toast(TOAST.FAVORITES_BROKEN, 'warn')
      else toast(TOAST.favoritesSkipped(0, broken, challenge), 'warn')
      return 0
    }

    // ⚠️ 用 buildPaper 洗：题目顺序和 keys **一起**洗，还顺手洗了每道选择题的
    // 选项顺序。只洗题目数组的话键会整体错位 ——「错的题记到别的题头上」
    // （quiz-paper.ts 抬头）。收藏练习是同一批题**反复**做的地方，
    // 不洗选项顺序的话第二遍就是纯背位置。
    const paper = buildPaper(pool)
    quiz.startQuiz(
      'fav',
      '__fav__',
      paper.map((x) => x.question),
      paper.map((x) => x.key)
    )

    if (broken + challenge > 0) toast(TOAST.favoritesSkipped(paper.length, broken, challenge), 'warn')
    else toast(TOAST.favoriteStarted(paper.length), 'success')
    return paper.length
  }

  return { startFavorites }
}
