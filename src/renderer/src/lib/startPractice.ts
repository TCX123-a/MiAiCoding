/**
 * 「开始练习」的统一入口。
 *
 * 【为什么必须收成一个】
 * 这个函数原来是**一模一样的两份**：详情页底部操作栏一份
 * （`views/LessonDetailView.vue`）、右栏一份（`components/domain/RightPanel.vue`）。
 * 两份都不报错、都"能用"，所以没人注意到它们已经分家了 ——
 * 直到要给课后练习加洗牌和抽题：**改一份忘一份的话，同一个按钮
 * 在页面不同位置点出来的卷子还是不一样的**，而且没有任何东西会提醒你。
 *
 * 这和 `lib/openLesson.ts` 是同一个模式（侧栏、搜索、正文内链接共用一个打开入口），
 * 理由也一样：**动作只有一个定义**。
 *
 * 【抽题和洗牌为什么在这里、不在 store 里】
 * `quiz.startQuiz()` 是"开一局"的**状态写入**，它最好保持确定性 ——
 * 悄悄在里面洗牌会让所有拿它当夹具的单测变成随机的（跑十次红一次，
 * 那种最难查的 flake）。所以组卷这件事留在调用点，由本模块统一替调用点做。
 * 组卷的规则本身在 `shared/quiz-paper.ts`，那里是纯函数、有完整的单测。
 */
import { useQuizStore } from '../stores/quiz'
import { toast } from '../components/base/toast'
import { TOAST } from './copy'
import { buildQuestionPaper, LESSON_PRACTICE_SIZE } from '../../../shared/quiz-paper'
import { isChallenge } from '../../../shared/difficulty'
import type { Lesson } from '../../../shared/types'

export function usePracticeStarter() {
  const quiz = useQuizStore()

  /**
   * 开一局**课后练习**：从本课的题里随机抽 `LESSON_PRACTICE_SIZE` 道，
   * 顺序打乱、每道选择题的选项也打乱。
   *
   * ⚠️ 抽题和洗牌**只在这一处发生**。错题本记账走的是 `quiz.finish()` 里
   * 按 `keys[i]` 配对的逻辑，而 `startQuiz` 不传 keys 时会用
   * `questionKey(lessonId, q.id)` 现拼 —— 拼的是**题目自己的 id**，
   * 所以题目怎么换顺序都不会错位。这是课内练习和错题重做的关键差别：
   * 后者从外面带 keys 进来，**必须**用 `buildPaper` 把题和键一起洗。
   *
   * 【挑战题不进课后练习】它们只在阶段综合练习 / 整门练习 / 每日挑战里出现
   * （主人规格）。过滤放在**组卷这一处**、规则本身在 `shared/difficulty.ts` ——
   * 七个练习入口共用同一条判据，谁也不用自己写一遍。
   *
   * @param lesson 传 `undefined` 也不会炸 —— 课还没加载完就点了按钮，
   *               走的就是这条路（和「这一课还没有练习题」共用同一句提示）。
   */
  function startLessonPractice(lesson: Lesson | null | undefined): void {
    const qs = (lesson?.questions ?? []).filter((q) => !isChallenge(q))
    if (!lesson || qs.length === 0) {
      toast(TOAST.LESSON_HAS_NO_QUIZ, 'warn')
      return
    }
    quiz.startQuiz('lesson', lesson.id, buildQuestionPaper(qs, LESSON_PRACTICE_SIZE))
    toast(TOAST.QUIZ_START, 'success')
  }

  return { startLessonPractice }
}
