/**
 * .sync/pending-ops.json —— 挑战结算的本地待办队列（P10.x 上行接线）。
 *
 * 【这个文件是干什么的】收工 watcher 在渲染层把一天的挑战结果交给主进程入队；
 * 上行 runner（uplink.ts）在登录态下逐条 POST /v1/challenge/days。落盘是刻意的：
 * 结算不能指望"提交那一刻正好在线"—— 断网/未登录时排着，下次触达服务端再发。
 *
 * 【为什么整条 payload 原样存】结算的幂等键 = submissionId + **整个提交体的
 * sha256**（challenge.ts:151/257）—— 重试必须逐字节复用首次的提交体，改任何一个
 * 字节都会变成"另一批"→ 409。所以队列存的是发送原文（除 installId 外全部字段），
 * 重试时只把 installId 现贴上去（它跟机器走，换机重登后照样对）。
 *
 * 【读口 / 写口两种性子】与 sync-state 同一套：
 *   · `readPendingOps` = 读口：坏条目丢掉 + 出声汇总，能救的必须救（这一份全都能
 *     从 challenge.json 重建 —— 丢的是"还没发的差事"，不是档案本身）；
 *   · `writePendingOps` = 写口：入参是我们自己的代码交上来的，形状不对就**抛**。
 *
 * 【队列入口在 IPC handler 上先过同一份校验】`parseSettlePayload` 两处共用：
 * handler 拿到渲染层载荷先 parse（null → 抛，照 checkinSubmit 的"载荷不合法=代码
 * bug，抛不吞"先例）；读口对磁盘上每条 op 再 parse（null → 丢条目 + 计数出声）。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律英文**，中文只出现在注释里。
 */
import { existsSync } from 'fs'
import { join } from 'path'
import {
  CHALLENGE_PICKABLE_LANGS,
  CHALLENGE_RUN_MAX,
  DATE_KEY_RE,
  DIFFICULTIES,
  LANGS,
  MAX_STAGE,
  QUESTION_TYPES,
  type PickableLang
} from '../../shared/cloud/protocol'
import type { ChallengeSettlePayload } from '../../shared/cloud/dto'
import { isCanonicalUuid } from '../store/account-id'
import { createJsonStore, type JsonStore } from '../store/json-store'
import { SYNC_DIR } from '../store/sync-state'

export const PENDING_OPS_VERSION = 1

/** 队列长度上限：约两个月的离线积压（服务端结算窗只有 30 天，更老的本来也发不出去） */
export const SETTLE_QUEUE_MAX = 60

/**
 * 结算提交体里**跟设备走**的那两个字段（submissionId / installId）由上层在
 * 发送/入队时贴 —— 队列里存的是其余全部字段（重试须逐字节复用的那份原文）。
 * 类型直接用 shared 的公开别名（渲染层 IPC 的载荷同型），不另抄一份 Omit ——
 * 两份形状迟早漂。
 */
export type SettlePayload = ChallengeSettlePayload

export interface PendingSettleOp {
  /** 幂等键的一半（另一半是 payload 的 sha256，服务端算）；入队时生成，重试不变 */
  submissionId: string
  /** 冗余存一份：入队去重（同一天只排一次）与日志都按它找，不用深挖 payload */
  dateKey: string
  payload: SettlePayload
  /** 上行失败累计次数（400 这类永久失败靠它让界面能说"重试 N 次仍未入云"） */
  attempts: number
  /** 最近一次失败的一句话（CloudFailure.code + message；成功即整条移除） */
  lastError: string | null
  queuedAt: string
}

export interface PendingOps {
  version: number
  settles: PendingSettleOp[]
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

/** 可解析的时刻串（ISO 或其他 Date.parse 认得的形状；服务端 zod 还会再收严） */
function isParsableTime(v: unknown): v is string {
  return typeof v === 'string' && Number.isFinite(Date.parse(v))
}

const LANG_SET: ReadonlySet<string> = new Set(LANGS)
const TYPE_SET: ReadonlySet<string> = new Set(QUESTION_TYPES)
const DIFFICULTY_SET: ReadonlySet<string> = new Set(DIFFICULTIES)
const PICKABLE_SET: ReadonlySet<string> = new Set(CHALLENGE_PICKABLE_LANGS)

/**
 * 逐题校验（challenge.ts:51-62 的形状抄本，值域只查枚举与整数域）。
 * 深度到此为止：key 的 `lesson:qid` 正则、批内 key 互异、难度复核这些是**服务端**
 * 的语义闸 —— 这里放行的漏网之鱼最多换来一次 400（attempts+1 留在队列里），
 * 而多拦一条合法题会让一整天的结算永远发不出去。
 */
function parseQuestion(v: unknown): boolean {
  if (!isObject(v)) return false
  if (!isNonEmptyString(v.key) || !isNonEmptyString(v.lessonId) || !isNonEmptyString(v.qid)) return false
  if (typeof v.lang !== 'string' || !LANG_SET.has(v.lang)) return false
  if (typeof v.stage !== 'number' || !Number.isInteger(v.stage) || v.stage < 0 || v.stage > MAX_STAGE) return false
  if (typeof v.type !== 'string' || !TYPE_SET.has(v.type)) return false
  if (typeof v.difficulty !== 'string' || !DIFFICULTY_SET.has(v.difficulty)) return false
  if (v.source !== 'local' && v.source !== 'ai') return false
  return typeof v.ok === 'boolean'
}

/**
 * 结算提交体（除 submissionId/installId）的形状闸 —— IPC 入队与磁盘读口共用。
 * pickedLangs 特例：显式空数组在服务端会被 zod 拒（challenge.ts:210-215），
 * 这里**当作缺省**抹掉（语义 = legacy 客户端，服务端从题批派生）而不是判 null ——
 * "挑战没勾语言"这种账不该让一整天的分数作废。
 */
export function parseSettlePayload(v: unknown): SettlePayload | null {
  if (!isObject(v)) return null
  if (typeof v.dateKey !== 'string' || !DATE_KEY_RE.test(v.dateKey)) return null
  if (v.source !== 'local' && v.source !== 'ai') return null
  if (!isParsableTime(v.finishedAt)) return null
  if (!Array.isArray(v.questions)) return null
  if (v.questions.length < 1 || v.questions.length > CHALLENGE_RUN_MAX) return null
  for (const q of v.questions) {
    if (!parseQuestion(q)) return null
  }

  const payload: SettlePayload = {
    dateKey: v.dateKey,
    source: v.source,
    finishedAt: v.finishedAt,
    questions: v.questions as SettlePayload['questions']
  }
  // startedAt 是可选装饰：坏值只丢字段（服务端"给了必须 ≤ finishedAt"，不给就完事），
  // 不连坐整份 payload。晚于 finishedAt 的也丢 —— 服务端对这种是 400，
  // 留着它 = 这笔结算永远发不出去（冻结字段第二道闸，第一道在渲染层的构建器）
  if (isParsableTime(v.startedAt) && Date.parse(v.startedAt) <= Date.parse(v.finishedAt)) {
    payload.startedAt = v.startedAt
  }

  if (v.pickedLangs !== undefined) {
    if (!Array.isArray(v.pickedLangs)) return null
    if (v.pickedLangs.length > 0) {
      const seen = new Set<string>()
      for (const l of v.pickedLangs) {
        if (typeof l !== 'string' || !PICKABLE_SET.has(l) || seen.has(l)) return null
        seen.add(l)
      }
      payload.pickedLangs = v.pickedLangs as PickableLang[]
    }
  }
  return payload
}

/** 队列条目的形状闸（读口逐条过；不过的丢条目） */
function cleanSettleOp(v: unknown): PendingSettleOp | null {
  if (!isObject(v)) return null
  if (!isCanonicalUuid(v.submissionId)) return null
  if (typeof v.dateKey !== 'string' || !DATE_KEY_RE.test(v.dateKey)) return null
  const payload = parseSettlePayload(v.payload)
  if (payload === null) return null
  // payload 的 dateKey 必须与索引字段一致：不一致 = 有人拆了我们的文件，
  // 留哪边都是猜 —— 丢掉
  if (payload.dateKey !== v.dateKey) return null
  if (typeof v.attempts !== 'number' || !Number.isInteger(v.attempts) || v.attempts < 0) return null
  if (v.lastError !== null && typeof v.lastError !== 'string') return null
  if (!isNonEmptyString(v.queuedAt)) return null
  return {
    submissionId: v.submissionId,
    dateKey: v.dateKey,
    payload,
    attempts: v.attempts,
    lastError: v.lastError,
    queuedAt: v.queuedAt
  }
}

export function emptyPendingOps(): PendingOps {
  return { version: PENDING_OPS_VERSION, settles: [] }
}

/** 落点固定为 <boxDir>/.sync/pending-ops.json（与 state.json 同目录） */
function opsStore(boxDir: string): JsonStore<PendingOps> {
  return createJsonStore<PendingOps>(join(boxDir, SYNC_DIR), 'pending-ops.json')
}

/**
 * 读口：磁盘上什么形状都认。坏条目丢掉、能救的必须救，出声一次汇总。
 * **不写盘** —— 修复是写口的事。
 */
export function readPendingOps(boxDir: string): PendingOps {
  const raw: unknown = opsStore(boxDir).read()

  if (raw === null) {
    if (existsSync(join(boxDir, SYNC_DIR, 'pending-ops.json'))) {
      console.warn('[miai] pending ops is unreadable JSON, starting empty')
    }
    return emptyPendingOps()
  }
  if (!isObject(raw)) {
    console.warn('[miai] pending ops is not an object, starting empty')
    return emptyPendingOps()
  }

  const settles: PendingSettleOp[] = []
  let dropped = 0
  if (raw.settles !== undefined && raw.settles !== null) {
    if (Array.isArray(raw.settles)) {
      for (const entry of raw.settles) {
        const one = cleanSettleOp(entry)
        if (one) settles.push(one)
        else dropped++
      }
    } else {
      dropped++
    }
  }
  if (dropped > 0) {
    console.warn(`[miai] pending ops: dropped ${dropped} invalid entries`)
  }
  // version 一律以当前版本返回（写口也会无条件覆盖，照 sync-state 口径）
  return { version: PENDING_OPS_VERSION, settles }
}

/** 写口：校形后整份写。形状不对**抛**（入参是我们自己的代码交上来的）。 */
export function writePendingOps(boxDir: string, ops: PendingOps): void {
  if (!isObject(ops) || !Array.isArray(ops.settles)) {
    throw new Error('invalid pending ops: not an object')
  }
  for (const entry of ops.settles) {
    if (cleanSettleOp(entry) === null) throw new Error('invalid pending ops: settle entry')
  }
  opsStore(boxDir).write({
    version: PENDING_OPS_VERSION,
    settles: ops.settles
  })
}

// ---------------------------------------------------------------- 纯变换（uplink 与 IPC 共用）

/**
 * 入队一条结算。**同一天只排一次**（dateKey 已在队 = 原样返回）：
 * 收工 watcher 有 finishedAt 一次性守卫，正常路径不会重复入队；这里是第二道
 * 闸 —— 重复入队会让同一天出现两个 submissionId，第二个必被服务端 409 拒。
 * 队满（SETTLE_QUEUE_MAX）丢**最老的**（按 dateKey）并出声：能排到队满的
 * 已经远超服务端 30 天结算窗，最老的那些本来就发不出去了。
 */
export function addSettle(ops: PendingOps, op: PendingSettleOp): PendingOps {
  if (ops.settles.some((s) => s.dateKey === op.dateKey || s.submissionId === op.submissionId)) {
    return ops
  }
  let settles = [...ops.settles, op]
  if (settles.length > SETTLE_QUEUE_MAX) {
    settles = settles.slice().sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0))
    const dropped = settles.slice(0, settles.length - SETTLE_QUEUE_MAX)
    console.warn(`[miai] pending ops full, dropped ${dropped.length} oldest (${dropped.map((d) => d.dateKey).join(',')})`)
    settles = settles.slice(settles.length - SETTLE_QUEUE_MAX)
  }
  return { ...ops, settles }
}

/** 出队（成功结算 / 409 已被别的设备结算过，共用同一个口） */
export function removeSettle(ops: PendingOps, submissionId: string): PendingOps {
  const settles = ops.settles.filter((s) => s.submissionId !== submissionId)
  if (settles.length === ops.settles.length) return ops
  return { ...ops, settles }
}

/** 记一次失败（不动队列顺序、不丢条目；入口永远是下一次上行触发） */
export function markSettleAttempt(ops: PendingOps, submissionId: string, error: string): PendingOps {
  let changed = false
  const settles = ops.settles.map((s) => {
    if (s.submissionId !== submissionId) return s
    changed = true
    return { ...s, attempts: s.attempts + 1, lastError: error }
  })
  return changed ? { ...ops, settles } : ops
}

/** 绑盒的读写信封（app.ts 与 uplink 共用；dir 现读，切盒后自动跟到新盒） */
export interface PendingOpsStore {
  read(): PendingOps
  write(ops: PendingOps): void
}

export function createPendingOpsStore(dir: () => string): PendingOpsStore {
  return {
    read: () => readPendingOps(dir()),
    write: (ops) => writePendingOps(dir(), ops)
  }
}
