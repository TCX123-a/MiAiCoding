/**
 * 组卷：把一批题变成「一张卷子」—— 抽几道、洗题目顺序、**洗选项顺序**。
 *
 * 【为什么要有这个文件】
 * 主人做通用知识的课后练习，发现「每次做都一模一样，非常单调」。
 * 查下来是三件事同时成立：
 *   1. 课内练习把 `lesson.questions` **原数组、原顺序**整个塞进会话；
 *   2. 随机组卷虽然洗了题目顺序，**选项一个都没洗**；
 *   3. 于是选择题的正确答案下标是**固定的**（`answer: 0` 永远在第一个）——
 *      做第二遍连"选第几个"都记得住。
 *
 * 第 3 条是最要命的那条：它让复习退化成**背位置**，而不是回忆知识。
 * 而它恰恰是最便宜能修的一条 —— 洗选项不需要新题目，只需要把 `answer` 跟着搬。
 *
 * 【为什么洗牌要单独一个文件，不塞进 challenge.ts】
 * `challenge.ts` 的抬头写着「抽题候选池」，池子是**按课过滤**的东西；
 * 而本模块服务的是全部四种组卷入口（课内练习 / 随机组卷 / 错题重做 / 每日挑战），
 * 其中课内练习和错题重做**压根不经过池子**。放一起会让那个抬头变成一句谎话。
 *
 * 【为什么每个函数都收 `rng`】
 * 项目惯例：**测试里塞一个确定性的假随机源**，才能断言「洗出来就是这几个」。
 * 直接用 `Math.random()` 的话，测试只能验「长度对」，验不了「洗对了」——
 * 而洗牌洗错（比如洗了题目忘了洗 keys）恰恰是这个文件唯一会出的 bug。
 */
import type { Question } from './types'
import { referencesOptionPosition } from './option-ref'

/**
 * 课后练习出几道题。
 *
 * 【为什么是 5】
 * 和随机组卷的最小档取同一个数 ——「一局 5 道」是这个应用里练习的基本单位。
 * （每日挑战 2026-10-10 晚 v3 起抽**整个已学题库**、无题数上限 ——
 *  它和这里彻底解绑了：上界 5000 只是服务端的健全性护栏，
 *  见 `shared/cloud/protocol.ts` 的 CHALLENGE_RUN_MAX，不再和这个数对齐。）
 *
 * ⚠️ **这是一道有代价的取舍，不是纯粹的改进**：现在每节课的题库是 7 道，
 * 抽 5 道意味着**每次有 2 道不会被考到**。选 5 的理由是「7 道里换着考 5 道」
 * 比「7 道永远全考」更能让人每次都得真的读题；代价是单次覆盖不全，
 * 得多练几轮才能把一节课的题都见过。
 * 把它调成 `Number.MAX_SAFE_INTEGER` 就等于「全考，只洗顺序」——
 * 一个数字而已，改这里就行。
 */
export const LESSON_PRACTICE_SIZE = 5

/**
 * Fisher-Yates 洗牌，返回**新数组**（原数组一个元素都不动）。
 *
 * 【为什么必须不改原数组 —— 这条比看上去重要】
 * 题目的真源是内容包（`content.bundle.lessons[*].questions`）。
 * 如果这里原地 `sort` 或原地交换，洗的就不只是"这一张卷子"，
 * 而是**把内容包本身给洗了** —— 后果是退出练习再进课文，
 * 课文里的例题顺序也变了；而且这是**进程内持久**的，重启前一直歪着。
 * 这种 bug 没有任何报错，只会让人觉得"这软件怪怪的"。
 *
 * 【无偏性】从后往前，`j` 取 `[0, i]`（含两端）。写成 `[0, i)` 会让
 * 排列不均匀 —— 表现是"某几道题总是排在前面"，同样没人查得出来。
 */
export function shuffled<T>(arr: readonly T[], rng: () => number = Math.random): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * 洗一道题的**选项顺序**，并把 `answer` 跟着搬过去。
 *
 * 【这是「背答案」这个问题的正解】
 * 选项顺序固定时，学员记住的是"选 B"；洗过之后，他每次都得把四个选项读完
 * 才能找到对的那个 —— **记忆的负担从位置回到了内容上**，这才是复习该有的样子。
 *
 * 【非选择题原样返回】
 * 填空、读代码题的答案是字符串，没有"顺序"可洗。返回**同一个引用**而不是
 * 复制一份：复制会让人以为这里做了什么，而它什么都没做。
 *
 * 【`answer` 怎么搬才对】
 * `order[newIndex] = oldIndex`，所以 `newAnswer = order.indexOf(q.answer)`。
 * 反着写（`order[q.answer]`）是个**很容易犯、而且大部分时候看起来是对的**的错：
 * 只有洗完之后正确项恰好没动时两者才相等。单测里钉的是
 * 「`options[answer]` 必须还是原来那句正确的话」，而不是某个具体下标 ——
 * 后者会被 rng 的取值影响，钉不住。
 *
 * 【解析按字母/位置指代选项时，这道题**不洗**】
 * `answer` 能跟着选项搬，散文搬不动：源题答案在 D、解析写「D 说的顺序与牵连」，
 * 洗过之后正确项到了 B，学员看到的就是「选了 B，解析却在讲 D」
 * （2026-10-21 宣传片里真抓到过）。判据在 `option-ref.ts`，那里写清了
 * 为什么宁可误判。返回**同一个引用**：这道题这次什么都没做。
 */
export function shuffleOptions(q: Question, rng: () => number = Math.random): Question {
  if (q.type !== 'choice') return q
  /*
   * 解析和**选项文本**都要查。
   *
   * 解析是散文，洗了会指错；选项文本本身也可能按位置说话 ——
   * 「上面两件都归它管」只有在它上面真有两项时才成立（2026-10-21 审计抓到
   * java/stage3/25-maven-gradle q1）。这种选项洗到第一位就变成病句，
   * 而解析再怎么引原话也救不回来。
   */
  if (referencesOptionPosition(q.explanation)) return q
  if (q.options.some((o) => referencesOptionPosition(o))) return q
  const order = shuffled(
    q.options.map((_, i) => i),
    rng
  )
  return {
    ...q,
    options: order.map((i) => q.options[i]),
    answer: order.indexOf(q.answer)
  }
}

/** 卷子上的一项：题目本体 + 任何必须**跟着它走**的伴随数据 */
export interface PaperEntry {
  question: Question
}

/**
 * 组一张卷子：洗题目顺序 → 取前 n 道 → 每道题洗选项顺序。
 *
 * **返回的是 `{...entry, question}` 的新对象**，原数组和原题目都不动（理由见 `shuffled`）。
 *
 * 【为什么收「带 question 字段的对象」而不是直接收 `Question[]`】
 * 这是本模块最容易出人命的地方。错题重做和随机组卷都要**同时**拿两个数组：
 * 题目数组，和一一对应的错题本键（`keys[i]` 必须是 `questions[i]` 的键）。
 * 如果洗牌只洗题目那一个数组，键就**整体错位** —— 后果是
 * 「错的题被记到别的题头上」「答对了却消除不掉原来那道错题」，
 * 而且**一声不吭**（这个错位在项目里真出过一次，见 stores/quiz.ts 的 restart 注释）。
 *
 * 收成「题 + 伴随数据」的一项，配对就成了**结构上的事**：
 * 想拿到题目就必须连伴随数据一起拿着，洗的时候也没法只洗一半。
 * （和 `PoolItem` 收 `lessonId` 是同一条理由，见 shared/challenge.ts 抬头。）
 *
 * @param items  带 `question` 字段的列表（`PoolItem`、`{question, key}`… 都行）
 * @param size   抽几道。**不传就是全要**（只洗顺序，不淘汰）
 */
export function buildPaper<T extends PaperEntry>(
  items: readonly T[],
  size: number = items.length,
  rng: () => number = Math.random
): T[] {
  const n = Math.max(0, Math.min(Math.floor(size), items.length))
  return shuffled(items, rng)
    .slice(0, n)
    .map((it) => ({ ...it, question: shuffleOptions(it.question, rng) }))
}

/**
 * 只有题目、没有伴随数据时的方便写法（课内练习用）。
 *
 * 单独一个函数而不是让调用点写 `.map((question) => ({ question }))`：
 * 那个 map 挨着 `startQuiz` 看很像多余的噪音，容易被下一个人"顺手删掉"。
 */
export function buildQuestionPaper(
  questions: readonly Question[],
  size: number = questions.length,
  rng: () => number = Math.random
): Question[] {
  return buildPaper(
    questions.map((question) => ({ question })),
    size,
    rng
  ).map((e) => e.question)
}
