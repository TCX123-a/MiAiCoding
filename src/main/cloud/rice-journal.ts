/**
 * 大白饭镜像账 · 账本文件与**唯一本地写口**（P10.x 上行接线）。
 *
 * 【账本文件在哪】跟随盒：客人盒在根目录、账号盒进 `accounts/<id>/` ——
 * 文件本体是 `rice-ledger.json`（与 pet.json / profile.json 同级；.sync/ 只放
 * 同步元数据，账本是真数据不是元数据）。形状与全部纯函数语义在
 * `src/shared/cloud/rice-ledger.ts`（本模块只负责：落盘、装载、发号、记账）。
 *
 * 【谁是唯一写口】pet.json.rice 只是 `balanceOf(账本)` 的镜像 —— 任何改动大白饭
 * 数的行为（喂饭/学习奖/跑步奖/签到）都必须经由本模块的 `record()` 记一条账，
 * 再拿它的返回值（新余额镜像）覆盖 pet 状态。brain 里自己算的那个数一律被覆盖。
 *
 * 【genesis：换新版首启时存量饭的落点】升级前的 pet.json 里已有 N 碗饭，但账本
 * 是空的 —— 镜像语义会把 N 抹成 0（违背 §6.1「我攒的饭没有消失」）。所以首次
 * 建账时若 N > 0，记一条 genesis 条目：
 *   { entryKey: `<installId>:0`（seq 0 保留给 genesis）, kind: 'adopt', delta: N,
 *     cloud: 'rejected', ref: { installId, carried: N } }
 * 几个为什么：
 *   · cloud:'rejected'（沿用三态，不发明第四态）—— 永不被 pendingEntries
 *     （只取 'pending'）挑走，即「从不上行」：存量饭是设备本地的事实，
 *     不属于账号流水；
 *   · kind:'adopt' 只取「来源标记」语义（delta 落 N 上，余额只认 delta）；
 *   · ref.carried 是机器可读判别器：收编的 adopt 标记是 `{installId}`，**没有**
 *     carried —— 收编查重必须按 `!ref.carried` 过滤，否则 genesis 会被误判成
 *     「已收编」；
 *   · N = 0 不建 genesis（空账本来就是余额 0，建一条 delta 0 的条目没有意义）。
 * 【已知代价（接受）】genesis 不上行 ⇒ 同账号第二台设备的镜像缺第一台的存量
 * （各设备按各自迁移存量发散）；收编是纯并集不受影响；上限饱和时有一次性
 * 「免费喂饭」的空间（skip-when-zero 在第一次真实消费后对齐）。
 *
 * 【账本坏档的处置】parseLedger 判 null（主档 + .bak 都不可用/形状坏）⇒ 把坏档
 * 副本留在旁边（`rice-ledger.bad-<ms>.json`，取证用）、出声、**按 genesis 路径
 * 重建**（carriedRice = 此刻 pet.json.rice）—— 优先保住用户看得见的余额。
 * 已知代价：若此刻已登录且服务端有流水，水位归零后的全量重拉会把服务端部分
 * 再记一遍（余额虚高、被 999 上限钳住，直到消费把它磨回来）——错误路径的错误
 * 路径，优先保余额、优先出声，不假装从没坏过。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律英文**，中文只出现在注释里。
 */
import { copyFileSync, existsSync } from 'fs'
import { join } from 'path'
import { RICE_DELTA_BY_KIND, RICE_MAX, type RiceKind } from '../../shared/cloud/protocol'
import {
  appendLocal,
  balanceOf,
  emptyLedger,
  parseLedger,
  type RiceEntry,
  type RiceLedger
} from '../../shared/cloud/rice-ledger'
import { petDayKey } from '../../shared/pet'
import { createJsonStore, type JsonStore } from '../store/json-store'

const FILE_NAME = 'rice-ledger.json'

/** 账本文件名（导出给 account-flow 的收编共用同一份 —— 名字漂移=收编读写到不存在的档） */
export const RICE_LEDGER_FILE = FILE_NAME

export interface RiceJournalDeps {
  /** 当前盒目录（**现读**：切盒后必须再调 load() 换档，本模块不自己监听切盒） */
  dir: () => string
  /** device.json 的 installId（entryKey 前缀；也是 genesis 的 seq 0 归属者） */
  installId: string
  /**
   * 设备级序号分配器：给「本机 installId 前缀下账本最大 seq」（没有则 -1）返回
   * 下一个可用号（≥1）。实现方（app.ts）负责 max(device.riceSeq, ledgerMax+1)
   * 与发号后的落盘 —— 分配器必须单调，序号回卷 = 新条目撞服务端幂等键。
   */
  nextSeq: (ledgerMaxSeq: number) => number
  /** 建账时刻 pet.json.rice（genesis 的 N；取不到/坏值按 0） */
  carriedRice: () => number
  /** 时钟注入缝（at / dayKey / 坏档副本名） */
  now?: () => Date
}

export interface RiceJournal {
  /** 装载（启动与切盒后各调一次）：有档读档，无档建档（含 genesis），坏档出声重建 */
  load(): RiceLedger
  /** 当前内存账本（未装载则先 load） */
  current(): RiceLedger
  /** 当前余额镜像（= balanceOf(current())） */
  balance(): number
  /**
   * 记一条本地事件（brain 饭变动的唯一入口）并返回**新余额镜像**。
   * skip-when-zero：append 后余额不变（上限饱和的 wart 区）⇒ 不记、不占号、
   * 不落盘，原样返回当前余额 —— 调用方拿它覆盖 pet 状态即可。
   */
  record(ev: { kind: RiceKind; ref: Record<string, unknown> | null }): number
  /**
   * 在**最新**账本上跑一次变换并落盘（上行层专用：push/pull 结果的应用）。
   * fn 返回同一引用 = 无改动 = 不落盘。fn 必须是同步纯变换（本函数同步执行，
   * 期间没有别的写口能插进来）。
   */
  mutate(fn: (ledger: RiceLedger) => RiceLedger): RiceLedger
}

/** 非空字符串（ref 的逐 kind 要求用） */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

/**
 * 逐 kind 的 ref 硬要求（与 server/src/lib/rice-rules.ts 对齐的三条）。
 * 服务端对「lesson 缺 lessonId」这类违反是**整批 400**（不是逐条拒收）——
 * 一条坏条目会毒死整个推送队列，所以本地在记账时就把它标成 'rejected'
 * （保留余额贡献、永不上行），而不是让它排队等着炸批次。
 */
function refViolation(kind: RiceKind, ref: Record<string, unknown> | null): string | null {
  if (kind === 'lesson' && !isNonEmptyString(ref?.['lessonId'])) return 'lesson without ref.lessonId'
  if (kind === 'run' && !isNonEmptyString(ref?.['fingerprint'])) return 'run without ref.fingerprint'
  return null
}

/**
 * 本机 installId 前缀下账本最大 seq；没有 → -1（genesis 的 :0 也按 0 参与）。
 * 导出给 account-flow.ts 的收编用：合并后的账号账本要用它算 `nextSeq` 起点，
 * 免得收编发的新号撞上账号盒里已有的本地号。
 */
export function maxLocalSeq(ledger: RiceLedger, installId: string): number {
  const prefix = `${installId}:`
  let max = -1
  for (const e of ledger.entries) {
    if (!e.entryKey.startsWith(prefix)) continue
    const suffix = e.entryKey.slice(prefix.length)
    if (!/^[0-9]{1,19}$/.test(suffix)) continue
    const n = Number(suffix)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max
}

export function createRiceJournal(deps: RiceJournalDeps): RiceJournal {
  const nowDate = deps.now ?? ((): Date => new Date())
  let ledger: RiceLedger | null = null

  function store(): JsonStore<RiceLedger> {
    return createJsonStore<RiceLedger>(deps.dir(), FILE_NAME)
  }

  /** 坏档取证副本：拷一份放旁边（绝不删原作、绝不覆盖同名） */
  function preserveBadFile(): void {
    const src = join(deps.dir(), FILE_NAME)
    if (!existsSync(src)) return
    const dest = join(deps.dir(), `rice-ledger.bad-${nowDate().getTime()}.json`)
    try {
      copyFileSync(src, dest)
    } catch {
      /* 取证副本失败不阻塞重建 */
    }
  }

  /**
   * 建账（首跑 / 坏档重建共用）：N = 此刻 pet.json.rice（夹到 [0, RICE_MAX]，
   * 免得坏值把 Σ 顶到上限之外、skip-when-zero 从此恒真、账本永久静默停摆）。
   */
  function buildFresh(recovered: boolean): RiceLedger {
    const raw = deps.carriedRice()
    const carried = Number.isFinite(raw) ? Math.min(RICE_MAX, Math.max(0, Math.floor(raw))) : 0
    if (carried <= 0) return emptyLedger()
    const nowIso = nowDate().toISOString()
    const genesis: RiceEntry = {
      entryKey: `${deps.installId}:0`,
      kind: 'adopt',
      delta: carried,
      dayKey: petDayKey(nowIso),
      at: nowIso,
      ref: { installId: deps.installId, carried, ...(recovered ? { recovered: true } : {}) },
      cloud: 'rejected'
    }
    return { ...emptyLedger(), entries: [genesis] }
  }

  function load(): RiceLedger {
    const raw: unknown = store().read()

    if (raw === null) {
      // 读到 null 两种：文件根本不在（首跑，静默建 genesis），以及主档 + .bak
      // 连 JSON 都读不出来（坏透了，必须出声 + 留证 —— 静默重建是铁律禁止的）
      const fileExists = existsSync(join(deps.dir(), FILE_NAME))
      if (fileExists) {
        console.warn('[miai] rice ledger is unreadable, rebuilt from pet.json balance')
        preserveBadFile()
      }
      ledger = buildFresh(fileExists)
      // 空账不落盘（没东西可存；等第一条账自然落）。genesis 必须立刻落盘：
      // 不落的话下次启动 carriedRice 可能已经变小，存量会在两次启动之间被吃掉
      if (ledger.entries.length > 0) store().write(ledger)
      return ledger
    }

    const parsed = parseLedger(raw)
    if (parsed === null) {
      console.warn('[miai] rice ledger has an invalid shape, rebuilt from pet.json balance')
      preserveBadFile()
      ledger = buildFresh(true)
      if (ledger.entries.length > 0) store().write(ledger)
      return ledger
    }

    ledger = parsed
    return ledger
  }

  function ensure(): RiceLedger {
    return ledger ?? load()
  }

  function commit(next: RiceLedger): RiceLedger {
    // 先落盘再更新内存：写失败时内存保持旧值，磁盘与内存不许分叉
    // （json-store 的 write 是 tmp+rename 原子替换，抛了就是没写）
    store().write(next)
    ledger = next
    return next
  }

  return {
    load,
    current: ensure,
    balance: () => balanceOf(ensure()),

    record(ev): number {
      const l = ensure()
      const delta = RICE_DELTA_BY_KIND[ev.kind]
      const nowIso = nowDate().toISOString()
      const dayKey = petDayKey(nowIso)

      // skip-when-zero 预判：先拿一条**占位键**的探针 append 模拟「真记会怎样」
      // —— 余额不变就不占号、不落盘（判断依据必须是 appendLocal+balanceOf 的
      // 真实过账行为，不是 clamp(cur+delta) 的手抄公式：Σ 与余额在饱和度上
      // 不等价，手抄会在 wart 区判错方向）。探针键含非数字后缀，永远撞不上真键。
      const probe = appendLocal(l, {
        entryKey: `${deps.installId}:~`,
        kind: ev.kind,
        delta,
        dayKey,
        at: nowIso,
        ref: ev.ref
      })
      const after = balanceOf(probe)
      if (after === balanceOf(l)) return after

      const seq = deps.nextSeq(maxLocalSeq(l, deps.installId))
      let next = appendLocal(l, {
        entryKey: `${deps.installId}:${seq}`,
        kind: ev.kind,
        delta,
        dayKey,
        at: nowIso,
        ref: ev.ref
      })
      // 分配器违约（发了已用过的号）时 appendLocal 幂等返回原账 —— 防御性地
      // 出声而不是静默吞掉这条饭（违约本身是 app.ts 分配器的 bug）
      if (next === l) {
        console.warn(`[miai] rice seq allocator returned a used seq (${seq}), entry dropped`)
        return balanceOf(l)
      }

      const violation = refViolation(ev.kind, ev.ref)
      if (violation !== null) {
        // 本地记下（余额照涨）、标记 rejected 永不上行：整批 400 的引信就地拆除
        console.warn(`[miai] rice entry kept local only: ${violation}`)
        const bad = next.entries[next.entries.length - 1]
        const marked: RiceEntry = { ...bad, cloud: 'rejected' }
        next = { ...next, entries: [...next.entries.slice(0, -1), marked] }
      }

      commit(next)
      return balanceOf(next)
    },

    mutate(fn): RiceLedger {
      const l = ensure()
      const next = fn(l)
      return next === l ? l : commit(next)
    }
  }
}
