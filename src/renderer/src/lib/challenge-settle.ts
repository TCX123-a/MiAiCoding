/**
 * 挑战结算载荷的**纯构建器**（P10.x 上行接线）—— 把收工后的 ChallengeDay
 * 转成 POST /v1/challenge/days 的提交体（减 submissionId/installId，那两个
 * 字段由主进程入队时贴，见 shared/cloud/dto.ts 的 ChallengeSettlePayload）。
 *
 * 【为什么单独一个纯函数】收工 watcher 里现拼的话，这段逻辑只有"真做一天
 * 挑战"才能被走到 —— 前缀/跳过/裁剪这些边界全在冷路径上。抽成纯函数之后
 * 单测能直接喂构造的 day 钉住每一条边界。
 *
 * 【三条形状纪律（与服务端 zod 逐条对齐，见 pending-ops.ts 的 parseQuestion）】
 *   · 前缀语义：answers 是「做过的前缀」，遇到第一条缺作答就停 —— 答错即停
 *     之后没见到的题不许上行（服务端会把它计成"答错"，分数被冤枉）；
 *   · 找不回原题的跳过（内容包改过）：type/difficulty 都在原题身上，
 *     编不出来 —— 宁可少算，不虚报（同收工记账的口径）；
 *   · ≤ CHALLENGE_RUN_MAX（5000）：超了只发前 5000 —— 服务端对超长批是
 *     **整批 400**（这一天就永远发不出去了），截断至少保住大头。
 *
 * 【startedAt 的口径】用 day.createdAt（这天开抽的时刻），但只在
 * 「解析得出且 ≤ finishedAt」时才带上：服务端对"开始晚于结束"是 400，
 * 而本机时钟被拨过这种事不值得让一整天作废 —— 丢弃装饰字段，不丢整批。
 *（主进程读口对磁盘上的载荷还有第二道同款判据，见 pending-ops.ts。）
 */
import type { ChallengeDay, ChallengeQuestion, Question, Stage } from '../../../shared/types'
import {
  CHALLENGE_PICKABLE_LANGS,
  CHALLENGE_RUN_MAX,
  DIFFICULTIES,
  type Difficulty,
  type Lang,
  type PickableLang
} from '../../../shared/cloud/protocol'
import type { ChallengeSettlePayload } from '../../../shared/cloud/dto'
import { resolveDifficulty } from '../../../shared/difficulty'

const DIFFICULTY_SET: ReadonlySet<string> = new Set(DIFFICULTIES)
const PICKABLE_SET: ReadonlySet<string> = new Set(CHALLENGE_PICKABLE_LANGS)

export interface SettleBuildDeps {
  /** 存档条目 → 可判分的原题（内容包改过的题找不回 → null，该题跳过） */
  resolve: (cq: ChallengeQuestion) => Question | null
  /** 题宿主课的属性；查不到（课被删/改号）按 common/阶段 0 计 —— 与
      pointsOf 的既有下限口径一致（宁少不虚），不因它跳过整题 */
  lessonOf: (lessonId: string) => { lang: Lang; stage: Stage } | null
}

/**
 * 构建结算载荷。**收不了工（null）的两种情形**：还没收工（无 finishedAt）、
 * 一道有效题都没有 —— 都交给调用方跳过这次上行，绝不发一份空批
 * （服务端 questions 至少 1 条）。
 */
export function buildSettlePayload(
  day: ChallengeDay,
  deps: SettleBuildDeps
): ChallengeSettlePayload | null {
  if (!day.finishedAt) return null
  const finishedAt = day.finishedAt
  const answers = day.answers ?? []

  const questions: ChallengeSettlePayload['questions'] = []
  for (let i = 0; i < day.questions.length; i++) {
    if (questions.length >= CHALLENGE_RUN_MAX) break
    const cq = day.questions[i]
    const ans = answers[i]
    if (!ans) break // 前缀语义：没做到的不上行（后面的也一定没做到）
    const q = deps.resolve(cq)
    if (!q) continue // 原题找不回：type/difficulty 编不出来，跳过
    const lesson = deps.lessonOf(cq.lessonId)
    const stage: Stage = lesson?.stage ?? 0
    const difficulty: Difficulty = resolveDifficulty(q, stage)
    if (!DIFFICULTY_SET.has(difficulty)) continue // 内容包坏值：跳过（少算不虚报，也不炸整天）
    questions.push({
      key: cq.key,
      lessonId: cq.lessonId,
      qid: cq.qid,
      lang: lesson?.lang ?? 'common',
      stage,
      type: q.type,
      difficulty,
      source: cq.ai ? 'ai' : 'local',
      ok: ans.ok === true
    })
  }
  if (questions.length === 0) return null

  const payload: ChallengeSettlePayload = {
    dateKey: day.dateKey,
    source: day.source,
    finishedAt,
    questions
  }

  // startedAt 装饰字段：解析得出且不晚于 finishedAt 才带
  const startMs = Date.parse(day.createdAt)
  const endMs = Date.parse(finishedAt)
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && startMs <= endMs) {
    payload.startedAt = day.createdAt
  }

  // pickedLangs 契约字段：只留可勾选语言、去重；一个不剩（或本来就没有）
  // 就不带 —— 显式空数组会被服务端 400，缺省 = legacy 语义（服务端从题批派生）
  if (day.pickedLangs && day.pickedLangs.length > 0) {
    const picked: PickableLang[] = []
    const seen = new Set<string>()
    for (const l of day.pickedLangs) {
      if (!PICKABLE_SET.has(l) || seen.has(l)) continue
      seen.add(l)
      picked.push(l as PickableLang)
    }
    if (picked.length > 0) payload.pickedLangs = picked
  }

  return payload
}
