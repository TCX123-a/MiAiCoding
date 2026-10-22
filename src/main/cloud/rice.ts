/**
 * 大白饭流水云客户端（薄）—— 两个动作：push / pull。
 *
 * 【这一层是什么】docs/26 §6 的流水镜像账在客户端侧的**唯一网络口**：
 *   · push：把本地账本里还没上行的条目按批推上去（幂等键 = entryKey，重发安全）；
 *   · pull：按 seq 增量拉回服务端已确认的条目（换机恢复 / 本地对账）。
 * 它不做账本、不做离线队列、不做自动重试 —— 重试次数在 transport 的 (method, path)
 * 表里集中定（POST /v1/rice/entries 是 2 次、GET * 是 2 次），本层只保证
 * 「发出去的请求形状对、回来的东西认得出、认不出就如实报错」。
 *
 * 【HTTP 200 ≠ 整批成功】push 的成功体里有 `rejected[]`：窗口外 / kind 日上限 /
 * adopt 重复都只逐条拒收，**不做整批失败**（rice.ts:245-287）——200 是"服务端把这批
 * 处置完了"，不是"全收下了"。唯一整批失败是同 entry_key 不同内容 → 409
 * ENTRY_CONFLICT（rice.ts:346-350，details:{entryKey}），本层原样透传：不改写 code、
 * 不吞 details、不把 409 包装成 ok。
 *
 * 【形状纪律，与 docs.ts 同款】服务端是权威，但"权威"不等于"永远回形状正确的东西"
 * （版本漂移、代理插页）。认不出的形状一律 MALFORMED_RESPONSE —— 宁可当错误，也不把
 * 半个对象透传给上层（balance 是数字还是字符串，决定渲染层显示什么）。缺键与值为 null
 * 是两件事：pull 的 `ref`/`flags` 键**恒在**（rice.ts:90-91 是 `.nullable()` / 数组，
 * 不是 `.optional()`），缺键判 MALFORMED 而不是补 null —— 补 null 会把"服务端换形状了"
 * 这条真信号抹成"这条没有 ref"。
 *
 * 【token】注入的 TokenStore（与 account.ts / docs.ts 共用同一个实例）。没 token 时
 * **一个包都不发**：本地就知道"我没登录"，没必要为了形式走一趟网络再收个 401。
 */
import { RICE_PULL_LIMIT_MAX } from '../../shared/cloud/protocol'
import type {
  CloudFailure,
  CloudResult,
  RiceLedgerEntry,
  RicePullResponse,
  RicePushRequest,
  RicePushResponse,
  RiceRejectedEntry
} from '../../shared/cloud/dto'
import { cloudOk, createTransport, type CloudLogger, type FetchLike } from './transport'
import type { TokenStore } from './account'

export interface CloudRiceDeps {
  baseUrl: string
  fetch: FetchLike
  timeoutMs?: number
  logger?: CloudLogger
  /** 重试退避的等待实现（注入缝，见 transport 的 CloudTransportDeps.sleep） */
  sleep?: (ms: number) => Promise<void>
  /** 与账号客户端共用同一个 store —— 登录一次，两边都看得到 */
  tokens: TokenStore
}

export interface CloudRiceClient {
  /** POST /v1/rice/entries —— 批量幂等上行；200 里的 rejected[] 是逐条拒收（见文件头） */
  push(body: RicePushRequest): Promise<CloudResult<RicePushResponse>>
  /** GET /v1/rice/entries?since&limit —— seq 增量下行 + 余额快照 */
  pull(opts: { since: number; limit?: number }): Promise<CloudResult<RicePullResponse>>
}

// ---------------------------------------------------------------- 形状校验

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function parseStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const out: string[] = []
  for (const item of v) {
    if (typeof item !== 'string') return null
    out.push(item)
  }
  return out
}

/** 2xx 但形状对不上：**我们侧**的判定，不是服务端回的错 —— httpStatus 如实放 null */
function malformed(detail: string): CloudFailure {
  return { code: 'MALFORMED_RESPONSE', message: `unexpected response shape: ${detail}`, httpStatus: null }
}

const UNLOGGED: CloudFailure = {
  code: 'UNAUTHENTICATED',
  message: 'not signed in',
  httpStatus: null
}

function parseRejected(v: unknown): RiceRejectedEntry | null {
  if (!isPlainObject(v)) return null
  const entryKey = str(v.entryKey)
  const code = str(v.code)
  const detail = str(v.detail)
  if (entryKey === null || code === null || detail === null) return null
  return { entryKey, code, detail }
}

function parsePushResponse(v: unknown): RicePushResponse | null {
  if (!isPlainObject(v)) return null
  const accepted = num(v.accepted)
  const duplicated = num(v.duplicated)
  const balance = num(v.balance)
  const earnedTotal = num(v.earnedTotal)
  const spentTotal = num(v.spentTotal)
  if (
    accepted === null ||
    duplicated === null ||
    balance === null ||
    earnedTotal === null ||
    spentTotal === null
  ) {
    return null
  }
  if (!Array.isArray(v.rejected)) return null
  const rejected: RiceRejectedEntry[] = []
  for (const raw of v.rejected) {
    const parsed = parseRejected(raw)
    if (parsed === null) return null
    rejected.push(parsed)
  }
  return { accepted, duplicated, rejected, balance, earnedTotal, spentTotal }
}

function parseLedgerEntry(v: unknown): RiceLedgerEntry | null {
  if (!isPlainObject(v)) return null
  const seq = num(v.seq)
  const entryKey = str(v.entryKey)
  // kind 是 z.string()（rice.ts:86，值域在 DB CHECK）——这里刻意**不**收窄到枚举
  const kind = str(v.kind)
  const delta = num(v.delta)
  const dayKey = str(v.dayKey)
  const at = str(v.at)
  if (seq === null || entryKey === null || kind === null || delta === null || dayKey === null || at === null) {
    return null
  }
  // ref 键恒在（`.nullable()`）：显式 null 合法；缺键（undefined）走 `!== null` 分支判 MALFORMED
  if (v.ref !== null && !isPlainObject(v.ref)) return null
  const ref = v.ref === null ? null : (v.ref as Record<string, unknown>)
  const flags = parseStringArray(v.flags)
  if (flags === null) return null
  return { seq, entryKey, kind, delta, dayKey, at, ref, flags }
}

function parsePullResponse(v: unknown): RicePullResponse | null {
  if (!isPlainObject(v)) return null
  const nextSeq = num(v.nextSeq)
  const balance = num(v.balance)
  if (nextSeq === null || balance === null) return null
  if (!Array.isArray(v.entries)) return null
  const entries: RiceLedgerEntry[] = []
  for (const raw of v.entries) {
    const parsed = parseLedgerEntry(raw)
    if (parsed === null) return null
    entries.push(parsed)
  }
  return { entries, nextSeq, balance }
}

// ---------------------------------------------------------------- 主入口

const PATH_RICE_ENTRIES = '/v1/rice/entries'

/**
 * 查询串：`since` 恒发（**0 是值不是"没传"** —— 省略它服务端默认也是 0，但显式发出去
 * 才让"从头拉"这件事在日志里可见）；`limit` 未给时不拼（服务端默认 RICE_PULL_LIMIT_MAX），
 * 给了且超上限就**夹到上限**——rice.ts:78 的 zod `.max(RICE_PULL_LIMIT_MAX)` 对超限是
 * 直接 400，与其发一个注定 400 的请求，不如在这里夹好（夹的是我们发出去的请求字节）。
 */
function buildPullPath(opts: { since: number; limit?: number }): string {
  const params = [`since=${opts.since}`]
  if (opts.limit !== undefined) {
    params.push(`limit=${Math.min(opts.limit, RICE_PULL_LIMIT_MAX)}`)
  }
  return `${PATH_RICE_ENTRIES}?${params.join('&')}`
}

export function createCloudRiceClient(deps: CloudRiceDeps): CloudRiceClient {
  const transport = createTransport({
    baseUrl: deps.baseUrl,
    fetch: deps.fetch,
    timeoutMs: deps.timeoutMs,
    logger: deps.logger,
    sleep: deps.sleep
  })

  return {
    async push(body): Promise<CloudResult<RicePushResponse>> {
      const token = deps.tokens.get()
      if (token === null) return { ok: false, failure: UNLOGGED }
      // 请求体原样发：形状由 dto 的 RicePushRequest 在编译期守住，本层不重建字段
      // （重建只会多一处"客户端擅自改写上行数据"的机会）。值为 undefined 的键会被
      // JSON.stringify 丢掉 = 服务端可选字段的语义（zod 的 default/optional 处置）。
      const result = await transport.request({ method: 'POST', path: PATH_RICE_ENTRIES, token, body })
      if (!result.ok) return result
      const parsed = parsePushResponse(result.data)
      if (parsed === null) return { ok: false, failure: malformed('rice push response') }
      return cloudOk(parsed)
    },

    async pull(opts): Promise<CloudResult<RicePullResponse>> {
      const token = deps.tokens.get()
      if (token === null) return { ok: false, failure: UNLOGGED }
      const result = await transport.request({ method: 'GET', path: buildPullPath(opts), token })
      if (!result.ok) return result
      const parsed = parsePullResponse(result.data)
      if (parsed === null) return { ok: false, failure: malformed('rice pull response') }
      return cloudOk(parsed)
    }
  }
}
