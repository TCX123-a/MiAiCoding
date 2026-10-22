/**
 * challenge.json 的合并与裁剪 —— **纯函数，不碰文件系统**。
 *
 * 【为什么不写在 IPC handler 里】
 * 和 config-merge.ts 同一个理由：handler 里那段逻辑**没法单测**，
 * 而「30 天窗口裁得对不对」恰恰是最该被测试钉住的地方 —— 裁错了不会报错，
 * 只会某天突然发现学员昨天的挑战记录没了。抽成纯函数，喂 31 天进去断言最老那天消失。
 *
 * 【为什么裁剪在主进程而不是渲染进程】
 * 渲染进程只关心「今天」。让它去管「文件别无限长」，等于把一条跟界面无关的
 * 责任塞进 UI，而且**每多一个调用点就要多写一遍**。放这里一处生效。
 *
 * 【这个文件里不许出现中文】（它在 src/ 下，会被文案闸门扫）
 */
import {
  CHALLENGE_KEEP_DAYS,
  type ChallengeDay,
  type ChallengeQuestion,
  type ChallengeRecord,
  type ChallengeToday
} from '../../shared/types'
import { isWithinDays } from '../../shared/dates'
import { lastSeenOf } from '../../shared/challenge'

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 校验一道题。
 *
 * 只校验**结构**，不校验题目内容本身 —— 内置题的本体在内容包里，
 * 那边坏没坏由 validate:content 管；AI 题的本体在存进来之前已经过
 * `parseAiQuestions()` 的严格校验。这里再查一遍内容是重复劳动，
 * 而且两套规则一旦漂移，同一个字段会在两处有不同结论。
 */
function assertQuestion(q: unknown): asserts q is ChallengeQuestion {
  if (!isObject(q)) throw new Error('invalid challenge payload')
  if (typeof q.key !== 'string' || q.key === '') throw new Error('invalid challenge payload')
  if (typeof q.lessonId !== 'string' || q.lessonId === '') {
    throw new Error('invalid challenge payload')
  }
  if (typeof q.qid !== 'string' || q.qid === '') throw new Error('invalid challenge payload')
  // ai 是选填的，但**给了就必须是个对象** —— 给了个 null 或字符串说明调用方写错了
  if (q.ai !== undefined && !isObject(q.ai)) throw new Error('invalid challenge payload')
}

/** 校验一整个批次。非法一律抛，和 config-merge 一个规矩：宁可报错，不写半条脏数据 */
export function assertChallengeDay(v: unknown): asserts v is ChallengeDay {
  if (!isObject(v)) throw new Error('invalid challenge payload')
  if (typeof v.dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.dateKey)) {
    throw new Error('invalid challenge payload')
  }
  if (v.source !== 'local' && v.source !== 'ai') throw new Error('invalid challenge payload')
  // pickedLangs (v3) is optional: batches drawn before the language picker
  // shipped have no such field. When present it must be a deduplicated subset
  // of the four non-common languages in the protocol's LANGS declaration
  // ('common' is always included implicitly, so it is never a valid pick).
  if (v.pickedLangs !== undefined) {
    if (!Array.isArray(v.pickedLangs)) throw new Error('invalid challenge payload')
    if (v.pickedLangs.length > 4) throw new Error('invalid challenge payload')
    const seenLangs = new Set<unknown>()
    for (const lang of v.pickedLangs) {
      if (lang !== 'c' && lang !== 'cpp' && lang !== 'java' && lang !== 'python') {
        throw new Error('invalid challenge payload')
      }
      if (seenLangs.has(lang)) throw new Error('invalid challenge payload')
      seenLangs.add(lang)
    }
  }
  // format (v3) is optional: absent means v1, the pre-v3 layout whose
  // questions/answers were not rewritten as a matched pair (and are therefore
  // not reliable to review). When present it must be an integer >= 1; the
  // writer only ever emits 2 today.
  if (v.format !== undefined) {
    if (typeof v.format !== 'number' || !Number.isInteger(v.format) || v.format < 1) {
      throw new Error('invalid challenge payload')
    }
  }
  // submittedAt (P10.6) is optional: absent means the settle op was never
  // confirmed enqueued (the crash-window marker). When present it must be a
  // string — the ISO timestamp written by the finish path right after the
  // main process confirmed the enqueue.
  if (v.submittedAt !== undefined && typeof v.submittedAt !== 'string') {
    throw new Error('invalid challenge payload')
  }
  if (!Array.isArray(v.questions)) throw new Error('invalid challenge payload')
  for (const q of v.questions) assertQuestion(q)
  if (typeof v.createdAt !== 'string') throw new Error('invalid challenge payload')
  if (v.finishedAt !== null && typeof v.finishedAt !== 'string') {
    throw new Error('invalid challenge payload')
  }
  if (v.score !== null) {
    if (!isObject(v.score)) throw new Error('invalid challenge payload')
    const { correct, total, points, pointsMax } = v.score
    if (
      typeof correct !== 'number' || !Number.isInteger(correct) || correct < 0 ||
      typeof total !== 'number' || !Number.isInteger(total) || total < 0
    ) {
      throw new Error('invalid challenge payload')
    }
    // 答对数不可能超过总题数。这条不查的话，界面上会显示出「7/5 分」这种东西
    if (correct > total) throw new Error('invalid challenge payload')
    // points/pointsMax: optional (batches saved before the 2026-10-10 weighted
    // scoring have neither). When present they must be a consistent pair:
    // non-negative integers with points <= pointsMax (points is the sum over
    // the answered-correct subset, pointsMax over all answered questions).
    if (points !== undefined || pointsMax !== undefined) {
      if (
        typeof points !== 'number' || !Number.isInteger(points) || points < 0 ||
        typeof pointsMax !== 'number' || !Number.isInteger(pointsMax) || pointsMax < 0
      ) {
        throw new Error('invalid challenge payload')
      }
      if (points > pointsMax) throw new Error('invalid challenge payload')
    }
  }
  // answers 是选填的（逐题回顾上线前的批次没有），但**给了就必须逐条对得上**。
  // 2026-10-10 「答错即停」改版后它是 questions 的**前缀**（只存真正作答过的）,
  // so the length check is "not longer than", not "equal to":
  // a shorter answers array means the run stopped early, which is normal now.
  if (v.answers !== undefined) {
    if (!Array.isArray(v.answers)) throw new Error('invalid challenge payload')
    if (v.answers.length > v.questions.length) throw new Error('invalid challenge payload')
    // Cross-check against the score total when both are present: the finish
    // watcher writes total = answers.length by construction (both are derived
    // from the same truncated session), so a mismatch means the payload was
    // assembled wrong. Guarded on answers !== undefined so pre-review batches
    // (score without answers) stay readable.
    if (v.score !== null && isObject(v.score) && v.score.total !== v.answers.length) {
      throw new Error('invalid challenge payload')
    }
    for (const a of v.answers) {
      if (!isObject(a)) throw new Error('invalid challenge payload')
      if (typeof a.ok !== 'boolean') throw new Error('invalid challenge payload')
      // your 是三态：选择题下标 / 填空代码字符串 / 没作答时是 null
      if (a.your !== null && typeof a.your !== 'string' && typeof a.your !== 'number') {
        throw new Error('invalid challenge payload')
      }
      // 没作答就不该判成对 —— 这两个字段打架时，回顾页会显示「你答对了」
      // 却拿不出你答的是什么，比显示错还难解释
      if (a.your === null && a.ok) throw new Error('invalid challenge payload')
    }
  }
}

/**
 * 把一天写进记录，并裁掉滚出窗口的老批次。
 *
 * `days` 传空对象即可（全新安装）；传进来的 key 会原样保留 —— 裁剪的判据是
 * **日期字符串本身**，不是「记录里有几天」，所以记录里本来就有的脏日期不会
 * 因为「数够了 30 个」而留下来。
 *
 * `today` 由调用方给，不在这个函数里读时钟：读时钟的函数没法测，
 * 而「30 天边界」正是最需要测的地方（第 30 天还在、第 31 天没了）。
 */
export function mergeChallengeDay(
  current: ChallengeRecord | null,
  day: ChallengeDay,
  today: string
): ChallengeRecord {
  assertChallengeDay(day)

  const days: Record<string, ChallengeDay> = { ...(current?.days ?? {}) }
  days[day.dateKey] = day

  const kept: Record<string, ChallengeDay> = {}
  for (const [key, value] of Object.entries(days)) {
    // isWithinDays(key, 30) 的窗口是「今天往前数 30 天（含今天）」——
    // 也就是第 30 天还在、第 31 天滚蛋。日期格式不对的直接丢，省得它永远赖着
    if (isWithinDays(key, CHALLENGE_KEEP_DAYS, today)) kept[key] = value
  }

  return { version: current?.version ?? 1, days: kept }
}

/** 从记录里取某一天。读的时候顺手把格式不对的都当没读过 —— 上层只需处理 null 一种情况 */
export function getChallengeDay(
  record: ChallengeRecord | null,
  dateKey: string
): ChallengeDay | null {
  const day = record?.days?.[dateKey]
  if (!day) return null
  try {
    assertChallengeDay(day)
    return day
  } catch {
    // 文件被手改坏了：当成「今天还没抽过题」，重新抽一批。
    // 不抛错，是因为这一条坏数据不该让整个挑战页打不开
    return null
  }
}

/**
 * 渲染进程抽题要的全部历史信息：今天那批 + 排除清单 + 待补交清单。
 *
 * 排除清单（`lastSeen`）**只统计能读出形状的批次**：某个批次的文件坏了，
 * 它里面的题就当作「没出过」。这个方向的错是安全的 —— 最坏结果是那道题
 * 被再考一次，而反过来（把坏数据当成出过）会让好题被无端排除掉。
 *
 * 待补交清单（`unsent`，P10.6 ⑤）＝ 收工了、但「已提交」标记没写上的批次 ——
 * 即「收工 → 入队落盘」之间进程没走完的那些。只报形状事实（finishedAt 有、
 * submittedAt 没有），「能不能补交」（format < 2 不补）由渲染层按保守口径
 * 自己把 —— 同一份判据两边各写一遍迟早漂移。坏批次与 lastSeen 同一刀跳过。
 */
export function challengeToday(
  record: ChallengeRecord | null,
  dateKey: string
): ChallengeToday {
  const days: ChallengeDay[] = []
  for (const value of Object.values(record?.days ?? {})) {
    try {
      assertChallengeDay(value)
      days.push(value)
    } catch {
      /* 坏批次跳过，理由见上 */
    }
  }
  const lastSeen = lastSeenOf(days)

  // 按 dateKey 升序：补交顺序确定（最老的先交），也让测试可断言
  const unsent = days
    .filter((d) => d.finishedAt != null && d.submittedAt == null)
    .sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0))

  return {
    day: getChallengeDay(record, dateKey),
    // 今天的批次**自己也算进去**：重复点「重新抽题」时，
    // 已经出过的那批会被排到后面，新抽的更可能是没出过的
    lastSeen,
    unsent
  }
}
