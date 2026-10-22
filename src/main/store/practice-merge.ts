/**
 * practice.json 的清洗、校形与追加 —— 纯函数，不碰文件系统。
 *
 * 【这个文件是干什么的】一次**做完**的练习落一条会话（`{id, uid, at, mode, items}`）。
 * 它是「每日复习按错误率加权抽样」的**真源** —— 不是错题本的 `wrongCount`
 * （那个是累计次数、而且答对一次就被 `clear` 重置了，用它加权会让复习永远只出那几道）。
 *
 * 【两个口，两种性子】和 favorites-merge 同一套：
 *   · `normalizePractice(raw, installId)` = **读口**：磁盘上什么形状都认，坏东西丢掉+出声；
 *   · `assertPracticeInput(v)` / `appendPractice(...)` = **写口**：入参是渲染层
 *     交上来的，形状不对就抛。
 *
 * 【三条规矩必须在这里守住（错了都不会报错，只会安静地把统计搅偏）】
 *   1. **`lessonId` 从 key 拆**，不听入参 —— key 才是认题的凭据（shared/question-key.ts）；
 *   2. **哨兵课号进不了库**（`__review__` 这类）。复习的加权是「按课统计」，
 *      一门不存在的课进了库，那个权重就永远对不上任何真实内容；
 *   3. **身份是 uid 不是 id（v2，P10.1）**：数字 id 是「本机内的号」，
 *      两台设备各自 max+1 会铸出**相同的数字 id** —— 合并按 id 去重会把
 *      另一端的整段会话当重复项吃掉。uid = `${installId}:${id}`，
 *      以设备为命名空间，跨设备天然不撞。去重、裁剪排序全改用 uid。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律英文**，中文只出现在注释里。
 */
import {
  CURRENT_PRACTICE_VERSION,
  PRACTICE_KEEP_SESSIONS,
  type PracticeFile,
  type PracticeItem,
  type PracticeRecordInput,
  type PracticeSession
} from '../../shared/types'
import { isSentinelLesson, parseQuestionKey } from '../../shared/question-key'
// uid 的形状判据**从冻结区 import，不在本文件重写一份**（先例：profile-migrate 引 DATE_KEY_RE）——
// 两份「什么算合法 uid」早晚会漂移，而漂移的症状是「主进程写得进、云端的接收校验不认」。
// protocol.ts 零 import，无环。
import { RICE_ENTRY_KEY_RE } from '../../shared/cloud/protocol'

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 非空字符串才算数；空的、纯空白的、非字符串一律 null */
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/** 时刻丢了（文件写坏）时按「最古老」算：这个时刻只用于显示和排序，不参与加权 */
const UNKNOWN_TIME = '1970-01-01T00:00:00.000Z'

/** uid 形状 = `${installId}:${id}`（installId 是 36 位 uuid，id 是十进制数字串） */
function isUid(v: unknown): v is string {
  return typeof v === 'string' && RICE_ENTRY_KEY_RE.test(v)
}

/**
 * 清洗一条作答记录。**认不出就返回 null**（读口丢掉）。
 *
 * 判据三条，缺一不可：key 拆得出**课号 + 题号**、课号不是哨兵、`ok` 是布尔。
 * 拆不出题号的 key（`common-01` 这种只有课号的）只会来自上游写错 ——
 * 留着它，将来拿它去内容包里找题会得到一条"题目已被移走"的死记录。
 */
function cleanItem(raw: unknown): PracticeItem | null {
  if (!isObject(raw)) return null
  const key = str(raw.key)
  if (!key) return null
  if (typeof raw.ok !== 'boolean') return null

  const { lessonId, qid } = parseQuestionKey(key)
  if (lessonId === '' || qid === '') return null
  if (isSentinelLesson(lessonId)) return null

  return { key, lessonId, ok: raw.ok }
}

/**
 * 清洗一条会话。**没有一条有效作答的会话直接丢掉** ——
 * 一条空会话在加权里没有任何作用，留着只是让 5000 条的上限提前用完。
 *
 * `installId` 只用于**老会话（v1，没有 uid）的回填**：`${installId}:${id}`。
 * 这些会话本来就是这台设备上产生的，用本机 installId 认领它们是对的 ——
 * 不认领（丢掉）就是白做，认错了（共用别的设备的命名空间）才会和真身撞。
 */
function cleanSession(raw: unknown, installId: string): PracticeSession | null {
  if (!isObject(raw)) return null
  if (!Array.isArray(raw.items)) return null

  const items: PracticeItem[] = []
  for (const it of raw.items) {
    const one = cleanItem(it)
    if (one) items.push(one)
  }
  if (items.length === 0) return null

  // id 写坏时按 0 算：真实 id 从 1 起，0 保证排在所有会话前面 ——
  // 将来超上限要丢时，先丢的就是这些"不知道什么时候做的"
  const id = typeof raw.id === 'number' && Number.isFinite(raw.id) ? Math.max(Math.round(raw.id), 1) : 0

  return {
    id,
    // 老文件没有 uid（或写坏了）→ 用本机 installId 回填，**绝不丢会话**（见函数头）
    uid: isUid(raw.uid) ? raw.uid : `${installId}:${id}`,
    at: str(raw.at) ?? UNKNOWN_TIME,
    // mode 只用来显示/将来分模式统计，丢了就留空 —— **不编**一个假模式
    mode: str(raw.mode) ?? '',
    items
  }
}

/**
 * 读口：把磁盘上那坨东西搬成一份完整的练习史（v2）。
 *
 * 版本表：
 *   1 = 2026-09-29（学习闭环）起：这个文件才出现（只有数字 id）；
 *   2 = P10.1：加 `uid`（`${installId}:${id}`）。老会话按本机 installId 回填 ——
 *       回填结果必须**落进文件**（needsRewrite），否则每次读都要回填一遍，
 *       而且合并推送出去的那一份没有 uid（对端根本没法去重）。
 *
 * 【裁剪按 (at, uid) 全序】（合并矩阵逐字）：超 5000 裁最旧。全序 = 两端
 * 各自合并同一份数据后**丢的是同几条** —— 只按 at 的话，同一时刻的两条
 * 会话在 A 机丢左、在 B 机丢右，两份文件永远收敛不了。
 */
export function normalizePractice(
  raw: unknown,
  installId: string
): {
  file: PracticeFile
  needsRewrite: boolean
} {
  const empty: PracticeFile = { version: CURRENT_PRACTICE_VERSION, history: [] }

  if (raw === null || raw === undefined) return { file: empty, needsRewrite: false }

  if (!isObject(raw) || !Array.isArray(raw.history)) {
    // 不是这个文件的形状。**出声**再给一份空的（铁律不许静默重建）；
    // 写回去之前 json-store 会先备份成 .bak，原件还查得到
    console.warn('[miai] practice.json is not a practice file, starting empty')
    return { file: empty, needsRewrite: true }
  }

  const history: PracticeSession[] = []
  const seenUids = new Set<string>()
  let dropped = 0
  let backfilled = 0
  for (const rawSession of raw.history) {
    const s = cleanSession(rawSession, installId)
    // 同一个 uid 出现两次 = 文件被外部改过（或两台设备共用了 installId）；留第一条
    if (!s || seenUids.has(s.uid)) {
      dropped++
      continue
    }
    if (!isUid(isObject(rawSession) ? rawSession.uid : undefined)) backfilled++
    seenUids.add(s.uid)
    history.push(s)
  }

  // 读的时候也裁一次：上限是**文件的不变式**，不该假设磁盘上那份一定守规矩
  // （外部改过、或者老版本根本没裁过）
  const excess = Math.max(history.length - PRACTICE_KEEP_SESSIONS, 0)

  if (dropped > 0) {
    console.warn(`[miai] practice.json: dropped ${dropped} invalid entries during migration`)
  }
  if (excess > 0) {
    console.warn('[miai] practice.json: over the session cap, dropped the oldest sessions')
  }

  return {
    file: {
      version: CURRENT_PRACTICE_VERSION,
      history: excess > 0 ? dropOldest(history, excess) : history
    },
    needsRewrite:
      dropped > 0 ||
      backfilled > 0 || // uid 回填必须落盘（见版本表）
      excess > 0 ||
      raw.version !== CURRENT_PRACTICE_VERSION
  }
}

/**
 * 写口：校验 `practice:record` 的入参。非法一律抛（一个字节都不写）。
 *
 * 和 runner:run 一个规矩：形状不对属于**调用方写错了**，该炸得响亮 ——
 * 糊过去的后果是「练习做了、记录没落」，而每日复习的加权从此少一块，
 * 这种偏差没有任何地方会报错。
 */
export function assertPracticeInput(v: unknown): asserts v is PracticeRecordInput {
  if (!isObject(v)) throw new Error('invalid practice payload')
  if (str(v.mode) === null) throw new Error('invalid practice payload')
  if (!Array.isArray(v.items) || v.items.length === 0) throw new Error('invalid practice payload')

  for (const it of v.items) {
    if (!isObject(it)) throw new Error('invalid practice payload')
    const key = str(it.key)
    if (!key) throw new Error('invalid practice payload')
    if (typeof it.ok !== 'boolean') throw new Error('invalid practice payload')

    const { lessonId, qid } = parseQuestionKey(key)
    // 只有课号、没有题号的 key（`common-01`）说明上游拿课号当 key 了 —— 拼错了，
    // 而且这种错**不报错**，只会在每天复习里悄悄少一条记录。当场拒掉
    if (lessonId === '' || qid === '') throw new Error('invalid practice payload')
    // 哨兵课号进不了库，理由见文件头
    if (isSentinelLesson(lessonId)) throw new Error('invalid practice payload')
  }
}

/**
 * 把一次做完的练习追加进历史，返回**要落盘的新文件**。
 *
 * 【id 由这里铸，= 现有最大 id + 1；uid = `${installId}:${id}`】不让渲染层传 id：
 * 自增是文件自己的事。max+1 保证 id 大于文件里**所有**（含别的设备合并来的）
 * 数字 id，所以 `${installId}:${nextId}` 绝不会和任何已有 uid 相撞。
 *
 * 【超上限丢最老的】按 **(at, uid) 全序**丢（见 normalizePractice 的头注释）。
 * 用 Set 记住被丢的 uid 再回原数组里过滤，是为了**保住剩下的顺序**
 * （就地 sort + slice 会把文件的顺序永久改掉，而它是给人和排查用的）。
 */
export function appendPractice(
  current: PracticeFile,
  input: PracticeRecordInput,
  now: string,
  installId: string
): PracticeFile {
  assertPracticeInput(input)

  const nextId = current.history.reduce((max, s) => Math.max(max, s.id), 0) + 1
  const session: PracticeSession = {
    id: nextId,
    uid: `${installId}:${nextId}`,
    at: now,
    mode: input.mode,
    items: input.items.map((it) => ({
      key: it.key,
      // 课号从这里拆 —— 入参只报 key 和 ok，见 types.ts 里 PracticeRecordItem 的注释
      lessonId: parseQuestionKey(it.key).lessonId,
      ok: it.ok
    }))
  }

  const history = [...current.history, session]
  const excess = history.length - PRACTICE_KEEP_SESSIONS
  return {
    version: CURRENT_PRACTICE_VERSION,
    history: excess > 0 ? dropOldest(history, excess) : history
  }
}

/** (at, uid) 全序比较：at 是定长 ISO 串，字符串序 = 时间序；同一时刻用 uid 破并 */
function compareOrder(a: PracticeSession, b: PracticeSession): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1
  if (a.uid === b.uid) return 0
  return a.uid < b.uid ? -1 : 1
}

/** 丢掉 (at, uid) 全序里最旧的 n 条，**其余顺序不动** */
function dropOldest(history: PracticeSession[], n: number): PracticeSession[] {
  const doomed = new Set(
    [...history]
      .sort(compareOrder)
      .slice(0, n)
      .map((s) => s.uid)
  )
  return history.filter((s) => !doomed.has(s.uid))
}
