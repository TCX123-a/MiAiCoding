/**
 * 大白饭镜像账 · 账本核心（docs/26 §6）—— 纯函数，零 I/O、零 node 依赖。
 *
 * 【这是什么】客户端本地那份「大白饭流水账」的读写核心：条目并集合并、去重、
 * 余额重算、上行批次挑选、推送结果应用、下行水位。三个运行环境（渲染层 /
 * 主进程 / 单测）都要能直接加载，所以本文件只从 ./protocol 引常量与类型，
 * 不碰 fs、不碰网络、不读时钟（日键与时刻都由调用方随条目带进来）。
 *
 * 【为什么是「镜像账」而不是一个计数器】本地存的 rice 数字与服务端账户余额
 * 都是 **clamp(Σdelta, 0, RICE_MAX) 的派生值**，条目才是唯一事实（docs/26 §6.1）。
 * 任何一侧丢一条、多一条，都能用同一套纯函数当场重算发现 —— 对账判据 =
 * 存储值 === balanceOf(账本)，不需要两端互相猜。
 *
 * 【引用纪律（本仓库惯例）】所有函数不改入参；**无变化时原样返回入参引用**，
 * 调用方用 `!==` 判「要不要落盘」（幂等重放因此不会把文件的 mtime 无谓翻新）。
 * entries 永远保持插入序、不排序：顺序 = 设备给号（seq）的顺序，先记的先上行。
 *
 * 【cloud 三态】字段缺席 = 已入云（含全部服务端下行条目）；'pending' = 本地
 * 记了、尚未上行成功（appendLocal 给新条目盖的章）；'rejected' = 服务端拒收
 * （本地保留、界面标「未入云」）。mergeEntries 的「服务端确认」特例与
 * applyPushResult 的三态迁移都以它为准 —— 这两个口是「本地账」与「云端账」
 * 之间仅有的两座桥，桥宽就是这三态。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律英文**，中文只出现在注释里。
 */
import type { RiceKind } from './protocol'
// RICE_LEDGER_KINDS 也必须从 protocol 引，不在本文件另抄一份 kind 列表：
// 抄一份就成了第二个真源 —— protocol 每加一个 kind，本模块都会把新条目当
// 「形状非法」静默挡在门外（parseLedger 甚至会整份判 null）。这种漂移不会报错，
// 只有对账时才发现「今天少了两碗饭」（正是 pet.ts.rice 被漏项抹掉的同款事故）。
import { RICE_LEDGER_KINDS, RICE_MAX } from './protocol'
// RiceKind 出现在本模块公开类型面上（RiceEntry.kind / appendLocal 入参），
// 再导出一次省得使用方绕回 protocol 找（类型指回 protocol 的同一声明，非复制）
export type { RiceKind }

/** 一条账本条目的落盘形状（docs/26 §6.1） */
export interface RiceEntry {
  /** `${installId}:${seq}`（设备级分配器给号；本模块只当不透明字符串） */
  entryKey: string
  kind: RiceKind
  delta: number
  /** 客户端本地日 YYYY-MM-DD */
  dayKey: string
  /** 发生时刻 ISO */
  at: string
  ref: Record<string, unknown> | null
  /** 同步侧状态：'pending'=已记本地未上行成功；'rejected'=服务端拒收（保留本地标"未入云"）；
      字段缺席 = 已入云（含全部云端下行条目）。 */
  cloud?: 'pending' | 'rejected'
}

export interface RiceLedger {
  version: 1
  entries: RiceEntry[]
  /** 下一个待分配的本地序号（配合设备级分配器；本模块只透传/保存） */
  localSeq: number
  /** 下行水位：已应用到哪个服务端 seq */
  appliedServerSeq: number
}

// ---------------------------------------------------------------- 形状判据（读入口与收件口共用）

/** 普通对象 = 字面量或 Object.create(null)；数组 / null / 类实例一律不算。
    与 cloud/merge.ts 的 isObject 同口径：ref 的类型是 Record<string, unknown>，
    "ref 是数组"是坏形状而不是载荷（数组过不了这条路 —— 偏严的方向是安全的：
    多拒一条只会让整份读回 null 由调用方处置，误收才会把坏档带进落盘路径）。 */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 非负整数（localSeq / appliedServerSeq / 下行水位的口径） */
function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

/** kind 取值域判定；列表本身从 protocol 引（理由见文件头 import 处） */
function isKind(v: unknown): v is RiceKind {
  return typeof v === 'string' && (RICE_LEDGER_KINDS as readonly string[]).includes(v)
}

/**
 * 逐字段校验一条未知形状的条目 —— mergeEntries / applyPull / parseLedger
 * **共用这同一份判据**：运行时收件与落盘读回若各写一份，迟早漂成「收得进、
 * 读不回」的账（session 一多没人查得出是哪一轮丢的）。认不出 → null，
 * 绝不抛、绝不半信。
 * 只验「是不是这个形状」，不验「值合不合业务规则」：entryKey 的形状（
 * RICE_ENTRY_KEY_RE）与 kind 的 delta 白名单/日上限都是服务端的活，本地读回
 * 只需保证「同一条能被同一个键稳定认出来」。未知键丢弃 —— 本模块产出的条目
 * 形状固定；形状真要进化就升 version，让旧读者整份判 null，而不是带着不认识的
 * 状态继续跑。
 */
function asEntry(v: unknown): RiceEntry | null {
  if (!isObject(v)) return null
  const entryKey = v.entryKey
  const dayKey = v.dayKey
  const at = v.at
  const delta = v.delta
  if (typeof entryKey !== 'string' || typeof dayKey !== 'string' || typeof at !== 'string') return null
  if (!isKind(v.kind)) return null
  if (typeof delta !== 'number' || !Number.isFinite(delta)) return null
  if (v.ref !== null) {
    if (!isObject(v.ref)) return null
  }
  const cloud = v.cloud
  if (cloud !== undefined && cloud !== 'pending' && cloud !== 'rejected') return null
  const entry: RiceEntry = { entryKey, kind: v.kind, delta, dayKey, at, ref: v.ref as Record<string, unknown> | null }
  if (cloud !== undefined) entry.cloud = cloud // 缺席与显式 undefined 同义：不写这个键
  return entry
}

// ---------------------------------------------------------------- 账本

/** 空账本（水位 0、序号 0；version 固定 1） */
export function emptyLedger(): RiceLedger {
  return { version: 1, entries: [], localSeq: 0, appliedServerSeq: 0 }
}

/**
 * 余额 = clamp(Σdelta, 0, RICE_MAX)。
 * Σ 用普通加法（条目数上限几千、delta 是两位数量级，没有溢出问题）；
 * 下界 0 是**镜像**语义：服务端与本地存的余额都夹在这段区间里，本函数重算
 * 出的值就是「显示值」。上界从 protocol 引（不要抄 999 —— 它是两端与
 * DB CHECK 同值的真源）。
 */
export function balanceOf(ledger: RiceLedger): number {
  let sum = 0
  for (const e of ledger.entries) sum += e.delta
  return Math.min(RICE_MAX, Math.max(0, sum))
}

/**
 * 追加一条本地条目（entryKey 由调用方/设备分配器给定；本模块不生成）。
 * 新条目一律带 cloud:'pending'：本地刚记的账在推送成功前都算「未入云」，
 * 而入参里根本没有 cloud 字段 —— 这个章只能由本函数盖，否则 pendingEntries
 * 永远选不出新账，上行静默停摆。
 * localSeq 不动：给号与递增是设备级分配器的活，本模块只透传/保存它。
 * **重复 entryKey：原样返回入参引用**（幂等重放/双击这类重复写入不该产生
 * 新对象 —— 调用方按 `!==` 判落盘，重复写盘会让 mtime 乱动、同步器每轮空转）。
 */
export function appendLocal(
  ledger: RiceLedger,
  input: { entryKey: string; kind: RiceKind; delta: number; dayKey: string; at: string; ref: Record<string, unknown> | null }
): RiceLedger {
  for (const e of ledger.entries) {
    if (e.entryKey === input.entryKey) return ledger
  }
  const entry: RiceEntry = {
    entryKey: input.entryKey,
    kind: input.kind,
    delta: input.delta,
    dayKey: input.dayKey,
    at: input.at,
    ref: input.ref,
    cloud: 'pending'
  }
  return { ...ledger, entries: [...ledger.entries, entry] }
}

/**
 * 并集合并（收编与下行共用）：按 entryKey 去重、**已有者胜** —— 本地条目是
 * 事实，服务端回来的同键条目只是「我们也知道它了」，不拿它覆盖本地字段。
 *
 * 【计数口径】added = 真正追加的键；duplicated = 键已存在（含下面特例的更新档
 * —— 它没有新增条目）；invalid = 形状非法被跳过的档。三个计数只给调用方写日志 /
 * 报错用，收编判定本身不受它们影响。
 *
 * 【服务端确认特例】已有条目带 cloud 字段、incoming 同键且**没有** cloud 字段
 * （= 来自服务端）→ 说明服务端已收下这条：把已有条目的 cloud 摘掉，其余字段
 * 一字不动（字段以本地为准）。这是「本地 pending 被下行回声结清」的唯一路径
 * —— 少了它，一条上行成功后又被别的设备拉回来的条目会永远挂在 pending 上
 * 反复上行，直到被日上限拒收。
 *
 * 【绝不抛】形状非法的 incoming 条目跳过并计入 invalid；incoming 不是数组按
 * 空数组算（调用方吃到坏响应时账本保持原样，绝不半信写入）。
 */
export function mergeEntries(
  ledger: RiceLedger,
  incoming: unknown[]
): { ledger: RiceLedger; added: number; duplicated: number; invalid: number } {
  const raw = Array.isArray(incoming) ? incoming : []
  const index = new Map<string, number>()
  ledger.entries.forEach((e, i) => {
    if (!index.has(e.entryKey)) index.set(e.entryKey, i) // 病态重复键：首个为准
  })

  let out: RiceEntry[] | null = null // null = 尚无改动，仍共享原数组（copy-on-write）
  let added = 0
  let duplicated = 0
  let invalid = 0
  for (const item of raw) {
    const next = asEntry(item)
    if (next === null) {
      invalid++
      continue
    }
    const at = index.get(next.entryKey)
    if (at === undefined) {
      if (out === null) out = ledger.entries.slice()
      index.set(next.entryKey, out.length)
      out.push(next)
      added++
      continue
    }
    duplicated++
    const prev = (out ?? ledger.entries)[at]
    if (prev.cloud === undefined || next.cloud !== undefined) continue
    // 服务端确认：摘 cloud，其余字段（含 kind/delta）一字不动
    // （先补写再读 —— `const base = out ?? …` 这种暂存写法会让 TS 的
    //  控制流分析绕进自引用推断（TS7022），补写式同一语义且类型干净）
    if (out === null) out = ledger.entries.slice()
    const confirmed: RiceEntry = { ...out[at] }
    delete confirmed.cloud
    out[at] = confirmed
  }

  if (out === null) return { ledger, added, duplicated, invalid }
  return { ledger: { ...ledger, entries: out }, added, duplicated, invalid }
}

/**
 * 上行批次：cloud==='pending' 的条目按数组序取前 limit 条。
 * 取序 = 数组序 = 设备给号（seq）序，先记的先上行；limit ≤ 0（含 NaN）→
 * 空数组 —— 必须显式拦下来：slice 对负数参数是"从尾部倒着取"的语义，
 * `slice(0, -1)` 会**去掉最后一条**把其余全发出去，与「传坏数就什么都不发」
 * 正好相反（这个坑由 rice-ledger.test.ts 的 limit=-1 用例钉着）。
 */
export function pendingEntries(ledger: RiceLedger, limit: number): RiceEntry[] {
  if (!(limit > 0)) return [] // 同时兜住 0 / 负数 / NaN
  return ledger.entries.filter((e) => e.cloud === 'pending').slice(0, limit)
}

/** 待上行条数（界面角标/日志用；与 pendingEntries 同一条判据） */
export function pendingCount(ledger: RiceLedger): number {
  let n = 0
  for (const e of ledger.entries) if (e.cloud === 'pending') n++
  return n
}

/** 服务端拒收条数（界面「未入云」角标） */
export function rejectedCount(ledger: RiceLedger): number {
  let n = 0
  for (const e of ledger.entries) if (e.cloud === 'rejected') n++
  return n
}

/** 字符串数组的清洗：非字符串项丢弃（对服务端响应形状的兜底，本模块不替它报错） */
function stringList(v: unknown): string[] {
  const out: string[] = []
  if (!Array.isArray(v)) return out
  for (const item of v) if (typeof item === 'string') out.push(item)
  return out
}

/**
 * 应用推送结果（服务端 push 响应体）：
 *   · accepted / duplicated 里的键 → 摘掉 cloud 字段（已入云）；
 *   · rejected[].entryKey → cloud='rejected'（服务端拒收，本地留着但标未入云；
 *     reason 只进日志、不落账本 —— 账本形状里没有它）；
 *   · 认不出的键静默忽略（服务端可能回了本机没有的条目），绝不抛。
 * 【同键同时出现在拒收与接受里】拒收后应用（拒收赢）：服务端自相矛盾时偏保守
 * —— 宁可把已到手的标成「未入云」再上行一次（幂等，服务端去重），也不能把
 * 没收下的标成「已入云」（那一条就永远不再上行，对账时表现为「云端少两碗饭」）。
 * 无改动时原样返回入参引用。
 */
export function applyPushResult(
  ledger: RiceLedger,
  result: { accepted: string[]; duplicated: string[]; rejected: Array<{ entryKey: string; reason: string }> }
): RiceLedger {
  const confirmed = new Set<string>()
  for (const k of stringList(result.accepted)) confirmed.add(k)
  for (const k of stringList(result.duplicated)) confirmed.add(k)
  const rejected = new Set<string>()
  for (const r of Array.isArray(result.rejected) ? result.rejected : []) {
    if (isObject(r) && typeof r.entryKey === 'string') rejected.add(r.entryKey)
  }

  let out: RiceEntry[] | null = null
  ledger.entries.forEach((e, i) => {
    const cloud: RiceEntry['cloud'] = rejected.has(e.entryKey)
      ? 'rejected'
      : confirmed.has(e.entryKey)
        ? undefined
        : e.cloud
    if (cloud === e.cloud) return
    if (out === null) out = ledger.entries.slice()
    const next: RiceEntry = { ...e }
    if (cloud === undefined) delete next.cloud
    else next.cloud = cloud
    out[i] = next
  })
  if (out === null) return ledger
  return { ...ledger, entries: out }
}

/**
 * 下行应用：把服务端条目并入（去重语义与 mergeEntries 逐字相同 —— 两个口各写
 * 一份判据的话，收编与下行的重复档处理迟早漂移），水位取 **max(现水位, nextSeq)**：
 * 水位只增不减（乱序/重放的下行包不倒退 —— 倒退会让下一次上行重发已确认条目）。
 * nextSeq 只接受非负整数，坏值按「没有新水位」处理而不是写进账本：账本要落盘
 * 再读回，一粒 NaN / 小数就能让 parseLedger 整份判 null（全部数据读不回来）。
 * added 只计真正新增的条目（水位推进不算）。
 */
export function applyPull(
  ledger: RiceLedger,
  entries: unknown[],
  nextSeq: number
): { ledger: RiceLedger; added: number } {
  const merged = mergeEntries(ledger, entries)
  const seq = isCount(nextSeq) ? Math.max(ledger.appliedServerSeq, nextSeq) : ledger.appliedServerSeq
  if (merged.ledger === ledger && seq === ledger.appliedServerSeq) return { ledger, added: merged.added }
  return { ledger: { ...merged.ledger, appliedServerSeq: seq }, added: merged.added }
}

/**
 * 磁盘读入口的形状解析：认不出 → **null**（绝不抛）。
 * 【为什么不是「默认回退为空账本」】判 null 是把处置权交回调用方（备份坏档、
 * 重建还是界面报错由它决定）；这里若替它决定「就当没有账」，一份坏档会被空账
 * 静默替换，下一次落盘就把原始数据永久抹了 —— 默认回退为成功是事故。
 * 校验：version===1；entries 是数组、每条走 asEntry（与运行时收件同一份判据）；
 * localSeq / appliedServerSeq 非负整数。**任何一条坏 → 整份 null**，不做部分
 * 收编（半份账的余额是假余额，比没有账更坏）。
 */
export function parseLedger(v: unknown): RiceLedger | null {
  if (!isObject(v)) return null
  if (v.version !== 1) return null
  if (!Array.isArray(v.entries)) return null
  if (!isCount(v.localSeq) || !isCount(v.appliedServerSeq)) return null
  const entries: RiceEntry[] = []
  for (const raw of v.entries) {
    const entry = asEntry(raw)
    if (entry === null) return null
    entries.push(entry)
  }
  return { version: 1, entries, localSeq: v.localSeq, appliedServerSeq: v.appliedServerSeq }
}
