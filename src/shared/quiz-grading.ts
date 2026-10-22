/**
 * 判分引擎（M4-03，纯函数 + 单测目标）。
 * 规则：
 * - choice：下标相等即对
 * - fill：两端去空白 + 内部连续空白折叠为单空格 + 默认大小写不敏感；accept 列表按同样规则归一后比对
 * - code：**与真跑判分共用同一份输出契约**（换行统一 + 去行尾空白 + 去首尾空行，大小写敏感）
 * - codefill：**每个空各按 fill 的规则比一次**，全对才算对
 *
 * `codefix` / `codewrite` **不在这里** —— 它们要真编译真运行，走 `shared/run-grading.ts`。
 * 这个文件从头到尾都是**同步纯函数**，收不下需要 `await` 的东西。
 */
import type { CodeFillQuestion, Question, RunGradedQuestion } from './types'
import { splitCodeFillAnswer } from './codefill'
import { normalizeRunOutput } from './run-grading'

export function gradeChoice(user: number | null, answer: number): boolean {
  return user === answer
}

/** fill 归一化：trim + 空白折叠 + 小写化 */
export function normalizeFill(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function gradeFill(user: string, answer: string, accept: string[] = []): boolean {
  const u = normalizeFill(user)
  if (u === '') return false
  if (u === normalizeFill(answer)) return true
  return accept.some((a) => u === normalizeFill(a))
}

/**
 * code 归一化 —— **就是真跑判分那份输出契约**，不另写一份。
 *
 * 【为什么这里是"转调"而不是"内容一样的两份实现"】
 * `code` 题的答案是一段**程序输出**，和 `codefix` / `codewrite` 要判的是同一个东西。
 * 从前这里手写了一份（去行尾空白 + 去首尾空行），**唯独漏了换行统一**，
 * 于是 Windows 上从记事本粘一段答案进来（`\r\n` 是它的默认换行）就会：
 * `normalizeCode("3\r\n")` → `"3\r"`，而 `normalizeCode("3")` → `"3"`，**两者不相等**。
 * 学员写得一字不差却判错，而且**肉眼比对两份答案是同一个样子**，根本查不出来。
 * （`run-grading.ts` 讲第 1 条规则时早就把这笔账记下了，这里补的是那个缺口。）
 *
 * 转调而不是复制，是因为规则只要存在两份，就一定会漂移成两个判据 ——
 * 而"判据只能有一处"是这个项目的铁律。
 */
export function normalizeCode(s: string): string {
  return normalizeRunOutput(s)
}

export function gradeCode(user: string, answer: string, accept: string[] = []): boolean {
  const u = normalizeCode(user)
  if (u === '') return false
  if (u === normalizeCode(answer)) return true
  return accept.some((a) => u === normalizeCode(a))
}

/**
 * 这条 `code` 题的答案**是好几行**吗 —— 答题界面靠它决定用单行框还是多行框。
 *
 * 【判据必须"归一化之后再问有没有换行"，不能直接看原串里有没有 `\n`】
 * 2026-09-15 在真窗口里抓到的：`python-stage1-01 q7` 的答案是 `"1 + 1"`（一行），
 * 可是它的 `accept` 里挂着一条 `"1 + 1\n"` —— 那只是**末尾换行的容忍写法**，
 * 不是"这题有好几行"。直接 `includes('\n')` 的话这题会**变成多行框**，
 * 而它本该是单行题。归一化会把末尾那个空行去掉（见上面第 3 条规则），
 * 于是"有用意的换行"和"随手多敲的回车"在这里被干净地分开了。
 *
 * 【为什么住在这一层，而不是写在 `QuizCode.vue` 里】
 * 它问的是**判分契约**的口径（"归一化之后长什么样"），不是界面的口味。
 * 放在这里就能被单测钉住，而写在组件里只能靠真窗口跑一遍才发现 ——
 * 上面那个 bug 就是这么漏出去的。
 */
export function isMultilineCodeAnswer(answer: string, accept: string[] = []): boolean {
  if (normalizeCode(answer).includes('\n')) return true
  return accept.some((a) => normalizeCode(a).includes('\n'))
}

/**
 * 逐空判分：返回每个空对不对（给界面画绿/红描边，也告诉学员**哪几个空错了**）。
 *
 * 【为什么要有"逐空"这一层，而不是只给一个总的对错】
 * 一道题有三个空、学员错了中间那个 —— 只告诉他"答错了"，他得把三个空重读一遍
 * 才知道该改哪儿；而且这道题提交后就锁上了（输入框 `readonly`），这一遍是
 * 他唯一一次机会。逐空标记把这个信息量免费还给了他。
 *
 * 【复用 `gradeFill` 而不是另写一份比对】
 * 一个空就是一个微型的 `fill` 题 —— 大小写不敏感、accept 列表、空白折叠，
 * 规则必须完全一样。另写一份的后果是同一句话在两处判出不同结果，
 * 而这正是项目里反复防的那类漂移。
 */
export function gradeCodeFillBlanks(user: string, q: CodeFillQuestion): boolean[] {
  const values = splitCodeFillAnswer(user, q.blanks.length)
  return q.blanks.map((b, i) => gradeFill(values[i] ?? '', b.answer, b.accept ?? []))
}

/** 整道 codefill 对不对：**每个空都填对**才算对 */
export function gradeCodeFill(user: string, q: CodeFillQuestion): boolean {
  const marks = gradeCodeFillBlanks(user, q)
  // 空位为 0 的题（内容坏了，校验器会拦）判**错**而不是判对 ——
  // `[].every()` 是 `true`，照直写会让一道没有空位的题变成"人人都答对"
  return marks.length > 0 && marks.every(Boolean)
}

/**
 * 这道题**够不够格提交**。
 *
 * 三个原有题型的行为和以前一模一样（非空即可提交）—— 这里只是把
 * `String(a).trim() !== ''` 这条规则从 store 搬过来，让按题型分叉的规则
 * 跟判分住在同一个文件里。
 *
 * 【codefill 必须单独一条规则，这不是洁癖】
 * 各个空是按 `\n` 拼成一串的：只填了第一个空时这一串是 `"int\n\n"`，
 * **非空**。照旧规则就能提交 —— 而提交之后输入框立刻锁上（`readonly`），
 * 学员剩下两个空**再也填不进去了**，这道题永久作废。
 * 所以 codefill 要求"每个空都填了"，把半成品挡在提交之前。
 */
export function isAnswered(q: Question, user: string | number | null): boolean {
  if (user === null) return false
  if (q.type === 'codefill') {
    if (typeof user !== 'string') return false
    const values = splitCodeFillAnswer(user, q.blanks.length)
    return values.length > 0 && values.every((v) => normalizeFill(v) !== '')
  }
  return String(user).trim() !== ''
}

/**
 * 按题型分发判分（QuizOverlay 统一入口）。
 *
 * ⚠️ `switch` **没有 `default`**，而且这是故意的：`Question` 是一个联合类型，
 * 少写一个 `case` 会让这个函数在某些分支上不返回值 —— **`typecheck` 当场报红**。
 * 也就是说"加了新题型忘了接判分"这件事在编译期就被拦住了，不用等到有人做到
 * 那道题才发现（那时表现是"答对了也判错"，且只有那一种题型受影响）。
 *
 * ⚠️⚠️ **参数类型是"排除掉真跑题型"之后的那一半**，这也不是洁癖。
 * `codefix` / `codewrite` 要真编译真运行才能判，而这个函数是**同步纯函数**，
 * 它无论如何都算不出那两类题的答案。三条路：
 *
 *   · 给它俩写个 `return false` —— **最坏的一条**。它"类型是对的"，所以
 *     `typecheck` 拦不住；运行时表现是**每个学员做这两类题都被判错**，
 *     而且这正好是最像"内容出错了"的症状，会把人引去查内容。
 *   · `throw` —— 比上一条好，但只有真跑到那一刻才发现。而且它会出现在
 *     Vue 的事件处理器里，用户那边只是"点了没反应"。
 *   · **把类型收窄，让编译器逼每个调用点分叉** —— 就是现在这条。
 *     调用方必须先用 `isRunGraded()` 问一下，问过之后 TS 才让它调这个函数。
 *
 * 于是"忘了处理真跑题型"从**运行时的静默判错**变成了**编译期的报错**，
 * 而且是在写代码那一刻就报，不用等有人做到那道题。
 * 真跑判分在 `shared/run-grading.ts`。
 */
export type SyncGradedQuestion = Exclude<Question, RunGradedQuestion>

export function gradeQuestion(q: SyncGradedQuestion, user: string | number | null): boolean {
  if (user === null) return false
  switch (q.type) {
    case 'choice':
      return typeof user === 'number' && gradeChoice(user, q.answer)
    case 'fill':
      return typeof user === 'string' && gradeFill(user, q.answer, q.accept)
    case 'code':
      return typeof user === 'string' && gradeCode(user, q.answer, q.accept)
    case 'codefill':
      return typeof user === 'string' && gradeCodeFill(user, q)
  }
}
