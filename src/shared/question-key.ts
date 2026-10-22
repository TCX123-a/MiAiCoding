/**
 * 题目全局键 —— 错题本认题的**唯一凭据**。
 *
 * 一道题在项目里有三个身份：课 id（`common-01`）、题 id（`q1`，只在课内唯一）、
 * 以及二者拼起来的全局键（`common-01:q1`）。错题本存的是全局键，
 * 因为 `q1` 这门课有、那门课也有，**只存 `q1` 会指到别的题上去**。
 *
 * 【为什么单独一个文件】
 * 这个格式原本**硬编码在两个地方**：渲染进程拼（stores/quiz.ts），
 * 主进程拆（main/index.ts）。两处必须永远一致，但没有任何东西保证它们一致 ——
 * 改了一处忘了另一处，错题本就会「存得进去、查不出来」，
 * 而且**不报错**，只是安静地什么都不匹配。收成一个函数，两边都从这里拿。
 */

/**
 * 拼全局键。`lessonId='common-01'` + `qid='q1'` → `'common-01:q1'`
 *
 * 注意 AI 出的题也走这里，但它的 qid 带命名空间前缀（`ai-2026-09-13-1`），
 * 和内置题的 `q1` 天然错开 —— 理由见 shared/ai-question.ts。
 */
export function questionKey(lessonId: string, qid: string): string {
  return `${lessonId}:${qid}`
}

/**
 * 拆全局键。**按第一个冒号切**，不是按最后一个、也不是全切。
 *
 * 这样题 id 里就算含冒号也能活下来（`'common-01:a:b'` → 课 `common-01` + 题 `a:b`）。
 * 当前的课 id 是 `common-01` 这种不带冒号的形状，题 id 是 `q1` 这种，
 * 两种切法结果一样 —— 但**「结果一样」不等于「随便哪种都行」**：
 * 将来课程改成 `lang:c:01` 这种带冒号的命名，按最后一个冒号切就会把课 id 砍坏。
 *
 * 没有冒号时（老数据 / 手写脏数据）：整个键当课 id，题 id 给空串 ——
 * 保持和主进程原有行为一致，不偷偷改变已有数据的意思。
 */
export function parseQuestionKey(key: string): { lessonId: string; qid: string } {
  const sep = key.indexOf(':')
  if (sep === -1) return { lessonId: key, qid: '' }
  return { lessonId: key.slice(0, sep), qid: key.slice(sep + 1) }
}

/** AI 现场出的题的题号前缀。形状是 `ai-<日期>-<序号>`，如 `ai-2026-09-13-1` */
export const AI_QID_PREFIX = 'ai-'

/**
 * 这个题号是不是 AI 现场出的题。
 *
 * 【这不只是个命名约定 —— 它决定这道题**怎么**被处理】
 * 错题本和挑战存档都得靠 **课号 + 题号** 去内容包里把题目找回原样
 * （`content.lessonOf(课号).questions.find(题号)`），而 **AI 出的题不在任何一课里，
 * 永远找不回来** —— 不管是显示题干还是点「再练一次」组卷，它都是一条**死条目**。
 *
 * 所以 AI 题**走到哪儿都得带着自己的本体**：
 *   - 挑战存档：`ChallengeQuestion.ai`
 *   - 错题本：`WrongBookEntry.ai`（主人 2026-09-13 拍板收它们进来，前提就是带本体）
 * 带着本体的判定统一从这里出发，别处不要另写一套前缀比对。
 *
 * ⚠️ 判定必须是 `startsWith('ai-')` 这种**够具体**的前缀，不能图省事写成 `'a'`：
 * 前缀太宽会把将来的内置题号误判成 AI 题，那就反过来把该收的错题丢掉了。
 */
export function isAiQid(qid: string): boolean {
  return qid.startsWith(AI_QID_PREFIX)
}

/** 这个全局键是不是 AI 题 —— 错题本收不收它，就问这一个函数 */
export function isAiKey(key: string): boolean {
  return isAiQid(parseQuestionKey(key).qid)
}

/**
 * 哨兵课号的前缀（`__random__` / `__wrong__` / `__challenge__` / `__review__` …）。
 *
 * 【哨兵是什么】会话级组卷（随机、错题重做、挑战、复习、搜索巩固…）**没有宿主课**，
 * 但 `questionKey()` 要求一个课号，于是拿这些名字顶上。
 *
 * 【为什么前缀要集中定义在这里】从 2026-09-29 的学习闭环起，组卷模式会一个个变多
 * （review / stage / lang / fav / extend / search），每一个都会带来一个新哨兵。
 * 不集中定义的话，每个落盘口要自己写一遍 `startsWith('__')` —— 而漏写的那一处
 * 不会报错，只会安静地往文件里存一批查不出题目的死条目
 * （见 shared/challenge.ts 头注释里那段 `__random__:q1` 的教训）。
 */
export const SENTINEL_LESSON_PREFIX = '__'

/**
 * 这个课号是不是哨兵。**落盘口拿它挡门**：哨兵不是课，不在课表里，
 * 按它查不到任何内容 —— 一旦进了要持久化的记录（错题本、练习史），
 * 就是一条永远显示不出题干的记录。
 */
export function isSentinelLesson(lessonId: string): boolean {
  return lessonId.startsWith(SENTINEL_LESSON_PREFIX)
}
