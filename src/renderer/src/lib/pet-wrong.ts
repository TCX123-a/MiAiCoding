/**
 * 答错一题 → 桌宠的**查询层**（2026-10-06 活体模式）。
 *
 * 【为什么要单独一层，不并进 pet-bridge】
 * pet-bridge 是**叶子**：只 import 纯函数（run-diagnosis / run-result-view），
 * 它的判定表 `buildRunReport` 因此能被单测直接喂数据。这里要问两个 **store**
 * （内容包里的课名、学习进度里的"学过没"）—— 一旦并进 pet-bridge，它就不再
 * 是叶子，而这个文件又被 quiz store import：quiz → pet-bridge → content → progress，
 * 环就闭上了。所以分工是：**判定表留在叶子，store 查询放这一层**，
 * 依赖方向单向：quiz → pet-wrong → { content, progress } → pet-bridge。
 *
 * 【为什么课名要渲染层查】主进程没有内容包（`content.lessonOf` 在渲染进程），
 * 而「这个知识点明明在第 X 课《YYY》里教过呀」这句台词的**全部价值**就在于
 * 课名和顺序号是真的 —— 主进程自己编不出来，只能随上报带过去。
 *
 * 【一切都吞异常】调用点在学习流程正中间（判分那一行），这里任何一条路炸了
 * 都不许溅到判分上：查不到课名就报 `title: null`（主进程有通用台词，
 * 不编课名），store 没装上就按"没学过 + 没课名"报 —— **降级的方向是
 * "说得泛一点"，不是"不说"**（鱼对着一道错题沉默才是坏了）。
 */
import { parseQuestionKey } from '../../../shared/question-key'
import { useContentStore } from '../stores/content'
import { useProgressStore } from '../stores/progress'
import { reportWrongToPet } from './pet-bridge'

/**
 * 上报一道答错的题。`key` 是它的**全局键**（`${课号}:${题号}`，也就是错题本
 * 认题的同一把钥匙）—— 课号从键里拆（`parseQuestionKey`），而不是让调用点
 * 另传一个：调用点手里只有键，多一个参数就多一处能传错的地方。
 */
export function reportWrongAnswer(key: string): void {
  let title: string | null = null
  let order: number | null = null
  let learned = false
  try {
    const lessonId = parseQuestionKey(key).lessonId
    const lesson = useContentStore().lessonOf(lessonId)
    if (lesson) {
      title = lesson.title
      order = lesson.order
    }
    learned = useProgressStore().learnedSet.has(lessonId)
  } catch {
    /* store 还没装上（极早期 / 测试环境）—— 降级成通用台词，上报照发 */
  }
  reportWrongToPet({ title, order, learned })
}
