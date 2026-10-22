/**
 * 云传输层（P10.3 第一步）—— 全仓第二个会联网的文件（第一个是 ai/deepseek.ts）。
 *
 * 【为什么单独一层】网络是不可控的（断网、超时、代理、5xx），把一次 HTTP 往返
 * 收敛成一个 CloudResult 之后，上层（account.ts / IPC）只认结构化结果。
 * `fetch` 是**注入**的（同 deepseek 的先例）：本文件与它的测试一次都不真的联网。
 *
 * 【四条纪律，各有单测】
 *   1. 超时：AbortController，默认 CLOUD_TIMEOUT_MS = 10s（deps.timeoutMs 可注入，
 *      测试塞 20ms 就能离线跑完超时分支）。闸门**覆盖「发 → 读完体」整段** ——
 *      "响应头到了、体挂住"也是超时，不是等下去（2026-10-14 修，回归测试在
 *      transport.test.ts「响应头到了、体挂住」）。
 *   2. **重试 = §3.7 冻结表整张落地**（P10.3 补齐，此前是「谁都不重试」的安全
 *      子集）：次数按 (method, path) 由 `retryPlanFor` 集中查表 —— GET * 与
 *      PUT /v1/docs/* 各 2 次、POST login 1 次、PUT /v1/avatar 1 次、
 *      challenge/rice 两条上行各 2 次（docs/26 §4.8），register / logout /
 *      DELETE account 0 次（防「实际成功但响应丢包」的重复注册；本地状态机为准）。
 *      **只重试 NETWORK**：表里 login 那行把「连接错误重试 1 次」与「超时不重试」
 *      分开写，证明「网络错误」与「超时」是两类 —— 故本层把「网络错误」按同口径
 *      只认 NETWORK，TIMEOUT 一律不重发（是否再试留给引擎的整轮退避）。
 *      HTTP 错误（4xx/5xx）同样不重发：那是服务端给过的明确答复，重发只会重复
 *      撞同一堵墙（PUT 撞 409 的「重拉重合并」是同步引擎的事，不在这层）。
 *      退避 0.5s/2s（RETRY_BACKOFF_MS）；`sleep` 是注入缝 —— 测试塞零延迟假件，
 *      一次都不用真等。
 *   3. 错误码映射：HTTP 状态 + 错误体 code → CloudFailureCode。**裁定：错误体里
 *      是 ERROR_CODES 成员时以它为准** —— 服务端的 HTTP 状态本来就由 code 派生
 *      （server/src/plugins/error-handler.ts:16 = HTTP_STATUS_BY_CODE[code]），
 *      两者不一致只可能来自中间代理或版本漂移，应用级 code 比运输层状态更具体；
 *      原文状态仍留在 failure.httpStatus 里给调用方看。code 缺失/不认识
 *      （代理换掉了响应体）时按状态码兜底（statusToCode）。
 *   4. 凭据纪律：**Authorization 头与 token 不进任何日志/错误信息**。日志事件
 *      （CloudLogEvent）只有 method/path/status/code/durationMs 五个安全字段；
 *      错误信息只用服务端错误体的 message（截断）或本层自造的定长文案。
 *
 * 【协议头】每个请求带 `x-sync-protocol: PROTOCOL_CURRENT`（docs/22 §3.3）。
 *
 * 【返回形状】失败即值（CloudResult），不抛 —— 同 deepseek 的 AiResult 先例。
 */
import {
  ERROR_CODES,
  PROTOCOL_CURRENT,
  SYNC_PROTOCOL_HEADER,
  TOKEN_REGEX,
  type ErrorCode
} from '../../shared/cloud/protocol'
import type { CloudFailure, CloudFailureCode, CloudResult } from '../../shared/cloud/dto'

/** 只要能读状态码和正文就够了 —— 定这么小是为了让测试里的假货好写（全局 fetch 的 Response 天然满足）。
 *  二进制读口（头像）额外用 arrayBuffer/headers；两者都是可选的，纯 JSON 的老假货零改动。 */
export interface HttpResponseLike {
  ok: boolean
  status: number
  text(): Promise<string>
  arrayBuffer?(): Promise<ArrayBuffer>
  headers?: { get(name: string): string | null }
}

/**
 * 注入的 fetch。**实现必须尊重 init.signal**（超时靠它掐断）——而且是在
 * **任意时刻**都算数：响应头已到、正在读体时被 abort，体也要跟着断
 * （真 fetch 就是这个语义；超时闸覆盖到读完体，见文件头第 1 条）。
 * 测试的假货照做（见 transport.test.ts 的 hangingFetch 与 stalledBodyFetch）。
 */
export type FetchLike = (url: string, init: RequestInit) => Promise<HttpResponseLike>

/** 一次请求最多等多久。10s 是「用户还愿意看转圈」与「弱网偶尔就是慢」的折中 */
export const CLOUD_TIMEOUT_MS = 10_000

/** §3.7 冻结退避（毫秒）：第 1 次重试前等 0.5s、第 2 次前等 2s */
export const RETRY_BACKOFF_MS = [500, 2000] as const

/**
 * 重试分类表（docs/22 §3.7 + docs/26 §4.8）—— **全仓唯一重试点**：
 * 调用方不自己重试，次数按 (method, path) 在这里集中定死。
 * 表里没点名的操作一律 0 次（保守默认：宁可不重发，也不给没设计幂等的写造重复）。
 *
 * 超出 [0, RETRY_BACKOFF_MS.length] 的次数不需要新退避档：将来若给某条路加第 3 次，
 * 退避取最后一档（见 request 里的 clamp），并把这里与新档位同批补齐。
 */
export function retryPlanFor(method: string, path: string): number {
  // GET *：安全幂等 → 2 次（含条件 GET 与一切下行拉取）
  if (method === 'GET') return 2
  // PUT /v1/docs/:docType：CAS 使重试安全 → 2 次（撞 409 由同步引擎「重拉重合并」处置）
  if (method === 'PUT' && path.startsWith('/v1/docs/')) return 2
  // POST login：连接错误 1 次（超时在上面统一不重试 —— 表里 login 行就是分两类写的）
  if (method === 'POST' && path === '/v1/auth/login') return 1
  // POST /v1/challenge/days：submissionId 幂等 → 2 次（docs/26 §4.8；撞 409 不重试）
  if (method === 'POST' && path === '/v1/challenge/days') return 2
  // POST /v1/rice/entries：entry_key 幂等 → 2 次（同上）
  if (method === 'POST' && path === '/v1/rice/entries') return 2
  // PUT /v1/avatar：内容寻址幂等 → 1 次
  if (method === 'PUT' && path === '/v1/avatar') return 1
  // register（防重复注册）/ logout / DELETE account（本地状态机为准）：0 次
  return 0
}

/** 服务端错误体 message 透传上限：代理塞一条巨型正文时，别让它灌进日志 */
const MAX_MESSAGE_CHARS = 300

/**
 * 一条请求留下的唯一痕迹。字段是白名单，**没有 headers / body / token** ——
 * 加字段前先想清楚它会不会泄凭据（token 只经 Authorization 头出去）。
 */
export interface CloudLogEvent {
  method: string
  path: string
  /** HTTP 状态；超时/断网/没配（没走到响应）为 null */
  status: number | null
  /** 失败码；成功为 'OK' */
  code: CloudFailureCode | 'OK'
  durationMs: number
}

export type CloudLogger = (event: CloudLogEvent) => void

export interface CloudTransportDeps {
  /** 空串 = 未配置（NOT_CONFIGURED），绝不静默换一个主机 */
  baseUrl: string
  fetch: FetchLike
  timeoutMs?: number
  /** 默认只把失败打到 console.warn（安全字段；见 CloudLogEvent） */
  logger?: CloudLogger
  /**
   * 重试退避的等待实现（注入缝）：默认真等（setTimeout）。
   * 测试塞一个 **记录参数并立即返回**的假件 —— 既零耗时，又能断言退避序列 [500, 2000]。
   */
  sleep?: (ms: number) => Promise<void>
}

export interface CloudRequestSpec {
  /**
   * PUT 是给条件写（文档同步 `PUT /v1/docs/:docType`）用的。
   * 它的语义与 POST 完全同款（有体发 Content-Type、零重试），所以合并进同一条执行路径，
   * 不为它另开一条 —— 另开就会有两份"零重试"要各自记得。
   */
  method: 'GET' | 'POST' | 'PUT'
  /** 以 / 开头的路由（如 /v1/auth/login）；不含查询串 */
  path: string
  /** 有体才发 Content-Type；对象会被 JSON.stringify */
  body?: unknown
  /** 原始字节体（头像上传）。与 body 互斥；有它时 Content-Type 用 contentType */
  bodyBytes?: Uint8Array
  /** bodyBytes 的媒体类型（默认 application/octet-stream） */
  contentType?: string
  /** 有令牌才发 `Authorization: Bearer <token>` */
  token?: string | null
  /** 条件 GET：原样发 `If-None-Match`（ETag 的引号由调用方按服务端口径拼，见 docs.ts） */
  ifNoneMatch?: string
  // 【刻意没有 headers 字段】曾经有一个 `headers?: Record<string,string>`，本意是"给 Accept 之类
  // 留个口"。它是个**凭据旁路**：铺开之后再让专属字段去覆盖，只有"专属字段在场"时才盖得住 ——
  // 调用方只要不传 token、把 `Authorization` 塞进 headers，那一条就原样发出去了。
  // 而全仓当时根本没有调用方用它。**没有这个口，就不需要那条纪律**：把字段删掉，
  // 头只能由下面四行写（协议头 / Content-Type / Authorization / If-None-Match），
  // 旁路在类型上就不存在（运行期硬塞进来的键也会被忽略，有单测钉着）。
}

/** 二进制成功体（头像 GET）：字节原样 + 服务端声明的媒体类型 */
export interface CloudBinaryResponse {
  bytes: Uint8Array
  contentType: string | null
}

export interface CloudTransport {
  request(spec: CloudRequestSpec): Promise<CloudResult<unknown>>
  /**
   * 与 request 同一条执行路径（超时/重试/错误码映射/凭据纪律完全一致），
   * 差别只在成功时读 `arrayBuffer()` 而不是 `text()` + JSON.parse。
   * 非 2xx 仍按 text() 读错误体（服务端错误体恒为 JSON）。
   */
  requestBytes(spec: CloudRequestSpec): Promise<CloudResult<CloudBinaryResponse>>
}

// ---------------------------------------------------------------- 结果小工具（account.ts 也用）

/**
 * 条件 GET 命中缓存（服务端回 304）时 `CloudTransport.request` 的成功值。
 *
 * 【为什么需要一个哨兵，而不是 cloudOk(null)】304 与「204 无体」「体是 JSON null」
 * 是三件不同的事，调用方要做的动作也不同（304 = 用本地那份，204 = 操作成功无返回）。
 * 用 null 表示会把 304 混进"成功但没内容"，将来谁读错谁就静默丢一次同步。
 * 用**唯一符号**表示：只有转发的调用方认得出，认不出就是类型错，不会静默走错分支。
 */
export const NOT_MODIFIED: unique symbol = Symbol('cloud.not-modified')
export type NotModified = typeof NOT_MODIFIED

export function cloudOk<T>(data: T): CloudResult<T> {
  return { ok: true, data }
}

export function cloudFail<T = never>(
  code: CloudFailureCode,
  message: string,
  opts: { httpStatus?: number | null; retryAfterMs?: number; details?: unknown } = {}
): CloudResult<T> {
  const failure: CloudFailure = { code, message, httpStatus: opts.httpStatus ?? null }
  if (opts.retryAfterMs !== undefined) failure.retryAfterMs = opts.retryAfterMs
  if (opts.details !== undefined) failure.details = opts.details
  return { ok: false, failure }
}

// ---------------------------------------------------------------- 状态码兜底映射

/**
 * 错误体不可用（代理换掉响应体/非 JSON）时按 HTTP 状态归类。
 * 每一条都被 transport.test.ts 与 protocol.ts 的 HTTP_STATUS_BY_CODE 对拍（自洽）。
 * 409 无 code 时归到协议里最泛的冲突码 CONFLICT_STALE —— 拿得到 code 的场合
 * 永远不会走到这里（真服务端的 409 一定带 code：USERNAME_TAKEN 等）。
 */
const STATUS_FALLBACK: Record<number, ErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT_STALE',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  426: 'PROTOCOL_TOO_OLD',
  429: 'RATE_LIMITED',
  500: 'INTERNAL',
  503: 'DB_UNAVAILABLE'
}

export function statusToCode(status: number): ErrorCode {
  const mapped = STATUS_FALLBACK[status]
  if (mapped !== undefined) return mapped
  // 没登记过的状态：5xx 归内部错误（会让调用方等下再试），其余按请求形状错处理
  return status >= 500 ? 'INTERNAL' : 'BAD_REQUEST'
}

// ---------------------------------------------------------------- 错误体解析

const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES)

interface ParsedErrorBody {
  code: ErrorCode
  message: string
  retryAfterMs?: number
  details?: unknown
}

// ---------------------------------------------------------------- 凭据红线：出我们手的文案一律过筛

/**
 * 令牌形状的**全文扫描**正则：从 protocol 的 TOKEN_REGEX 去掉首尾锚点得来
 * （真源仍是 protocol.ts —— 令牌长度/字符集改了，这里跟着改，不另立一份）。
 */
const TOKEN_SCAN_RE = new RegExp(TOKEN_REGEX.source.replace(/^\^/, '').replace(/\$$/, ''), 'g')

/**
 * 抹掉文本里任何令牌形状的子串。
 *
 * 【为什么连"我们没主动写"的字符串也要筛】fetch 的实现（或中间代理、
 * 或将来某个还没见过的运行时）可能把请求头原样带进异常文案或错误体 ——
 * 「Authorization 与 token 不进任何日志/错误信息」这条纪律不能建立在
 * "别人不会这么干"的假设上。**复制任何外来文本进 failure.message 之前先过这里**。
 */
export function redactTokens(s: string): string {
  return s.replace(TOKEN_SCAN_RE, '[redacted]')
}

/** 抠服务端统一错误体；不是那个形状（或 code 不认识）就返回 null，交给状态码兜底 */
function parseErrorBody(raw: string): ParsedErrorBody | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const error = (parsed as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return null
  const { code, message, retryAfterMs, details } = error as {
    code?: unknown
    message?: unknown
    retryAfterMs?: unknown
    details?: unknown
  }
  if (typeof code !== 'string' || !ERROR_CODE_SET.has(code)) return null
  const out: ParsedErrorBody = {
    code: code as ErrorCode,
    // 先抹令牌再截断：先截断的话，一个跨截断点的令牌会"少几个字符"地漏出去
    message:
      typeof message === 'string' && message !== '' ? redactTokens(message).slice(0, MAX_MESSAGE_CHARS) : ''
  }
  if (typeof retryAfterMs === 'number') out.retryAfterMs = retryAfterMs
  if (details !== undefined) out.details = details
  return out
}

/** 非 2xx 的收口：能认出服务端错误体就用它（code 为准），否则按状态兜底 */
function failureFromHttp(status: number, raw: string): CloudFailure {
  const body = parseErrorBody(raw)
  if (body !== null) {
    const failure: CloudFailure = {
      code: body.code,
      message: body.message === '' ? `http request failed (status ${status})` : body.message,
      httpStatus: status
    }
    if (body.retryAfterMs !== undefined) failure.retryAfterMs = body.retryAfterMs
    if (body.details !== undefined) failure.details = body.details
    return failure
  }
  return {
    code: statusToCode(status),
    message: `http request failed (status ${status})`,
    httpStatus: status
  }
}

/** 传输层异常（fetch 抛了）的文案：message 先抹令牌再截断；不含我们发出去的头/体 */
function transportMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  return msg === ''
    ? 'network request failed'
    : `network request failed: ${redactTokens(msg).slice(0, MAX_MESSAGE_CHARS)}`
}

const defaultLogger: CloudLogger = (event) => {
  if (event.code === 'OK') return
  // 安全事件对象（白名单字段）——绝不是 headers/body 原文
  console.warn('[miai] cloud request failed', event)
}

// ---------------------------------------------------------------- 请求执行

export function createTransport(deps: CloudTransportDeps): CloudTransport {
  const timeoutMs = deps.timeoutMs ?? CLOUD_TIMEOUT_MS
  const logger = deps.logger ?? defaultLogger
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  /**
   * 一条请求的唯一执行路径。binary=false = JSON（默认），true = 成功体读字节。
   * 两个公开口（request / requestBytes）只是这里的两种读法 —— 超时、重试、
   * 错误码映射、凭据纪律只有一份。
   */
  async function run(spec: CloudRequestSpec, binary: boolean): Promise<CloudResult<unknown>> {
      if (deps.baseUrl === '') {
        // 没配服务器地址 = 这条路本来就没通，如实说，绝不猜一个主机发出去。
        // 这不是网络抖动，一次都不重试。
        const startedAt = Date.now()
        logger({
          method: spec.method,
          path: spec.path,
          status: null,
          code: 'NOT_CONFIGURED',
          durationMs: Date.now() - startedAt
        })
        return cloudFail('NOT_CONFIGURED', 'cloud base url is not configured')
      }

      const url = `${deps.baseUrl.replace(/\/+$/, '')}${spec.path}`
      // 从空对象起手（不是从调用方给的对象展开）：请求头只能由下面这几行写。
      // 见 CloudRequestSpec 的注 —— 这里曾经有个 headers 口，是个凭据旁路，已删除。
      const headers: Record<string, string> = {}
      headers[SYNC_PROTOCOL_HEADER] = String(PROTOCOL_CURRENT)
      if (spec.bodyBytes !== undefined) {
        headers['Content-Type'] = spec.contentType ?? 'application/octet-stream'
      } else if (spec.body !== undefined) {
        headers['Content-Type'] = 'application/json'
      }
      if (spec.token !== undefined && spec.token !== null && spec.token !== '') {
        headers['Authorization'] = `Bearer ${spec.token}`
      }
      if (spec.ifNoneMatch !== undefined) headers['If-None-Match'] = spec.ifNoneMatch

      /** 一次尝试 = 一次完整的「发→读」往返。每次尝试都有自己的日志与超时计时 */
      const attemptOnce = async (): Promise<CloudResult<unknown>> => {
        const startedAt = Date.now()
        const log = (status: number | null, code: CloudLogEvent['code']): void => {
          logger({ method: spec.method, path: spec.path, status, code, durationMs: Date.now() - startedAt })
        }

        const ac = new AbortController()
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          ac.abort()
        }, timeoutMs)

        // 【超时闸管到**读完体**为止】（2026-10-14 修）clearTimeout 原来挂在
        // fetch 那个 try 的 finally 上 —— 而 fetch 在**响应头到齐**时就 resolve，
        // 计时器于是提前缴械：`res.text()` 阶段没有任何超时兜底。服务端"头发了、
        // 体不发"（半开连接 / 坏代理）时这一趟**永远挂住**，timeoutMs 形同虚设，
        // 重试表里「TIMEOUT 不重发」的裁定也根本没机会生效（回归测试见
        // transport.test.ts「响应头到了、体挂住」）。
        // 现在「发 → 读体」整段共用这一个闸，全函数唯一的缴械点在这个 finally 里；
        // abort 在任意时刻都算数——体读到一半被掐时 `res.text()` 抛 AbortError，
        // 由下面按 timedOut 旗标归到 TIMEOUT（真 fetch 的语义就是这样）。
        try {
          let res: HttpResponseLike
          try {
            res = await deps.fetch(url, {
              method: spec.method,
              headers,
              body:
                spec.bodyBytes !== undefined
                  ? (spec.bodyBytes as unknown as RequestInit['body'])
                  : spec.body === undefined
                    ? undefined
                    : JSON.stringify(spec.body),
              signal: ac.signal
            })
          } catch (e) {
            // 超时和网络错误都会走到这里，靠我们的 timedOut 闸分辨（同 deepseek 的写法；
            // 用 name 而不是 instanceof：Node 的 fetch 抛 DOMException，它不是 Error 子类）
            if (timedOut) {
              log(null, 'TIMEOUT')
              return cloudFail('TIMEOUT', `request timed out after ${timeoutMs}ms`)
            }
            log(null, 'NETWORK')
            return cloudFail('NETWORK', transportMessage(e))
          }

          // 204（logout）= 成功且无体，不是"空响应"
          if (res.status === 204) {
            log(204, 'OK')
            return cloudOk(null)
          }

          // 304 必须排在这里：Fetch 的 `res.ok` 对 304 是 **false**（它只认 200-299），
          // 所以漏掉这一条，条件 GET 命中缓存会掉进下面的 `!res.ok` 分支，被 statusToCode(304)
          // 兜成 BAD_REQUEST —— 一个"同步很正常"的场景报出一个请求形状错，最难查的那种。
          // 语义上 304 是条件 GET 的**成功**结局（服务端在说"你手上那份就是最新的"），
          // 故记 OK 并回哨兵；调用方认不得哨兵就是类型错，不会静默走错分支。
          if (res.status === 304) {
            log(304, 'OK')
            return cloudOk(NOT_MODIFIED)
          }

          // 读体阶段的失败收口：超时（头已到，status 是已知事实）与真网络错共用。
          // 两者都**不重发**的规矩照旧：TIMEOUT 不在重试表里，NETWORK 由调用方循环决定。
          const readFailed = (e: unknown): CloudResult<unknown> => {
            if (timedOut) {
              log(res.status, 'TIMEOUT')
              return cloudFail('TIMEOUT', `request timed out after ${timeoutMs}ms`, { httpStatus: res.status })
            }
            log(res.status, 'NETWORK')
            return cloudFail('NETWORK', transportMessage(e), { httpStatus: res.status })
          }

          // 非 2xx：错误体恒为 JSON（二进制端点也一样），按 text 读才能解析 code
          if (!res.ok) {
            let raw: string
            try {
              raw = await res.text()
            } catch (e) {
              return readFailed(e)
            }
            const failure = failureFromHttp(res.status, raw)
            log(res.status, failure.code)
            return { ok: false, failure }
          }

          // 二进制成功体：字节原样，不经过 text()（那会把 PNG 读坏）
          if (binary) {
            if (res.arrayBuffer === undefined) {
              log(res.status, 'MALFORMED_RESPONSE')
              return cloudFail('MALFORMED_RESPONSE', 'binary response reader is unavailable', {
                httpStatus: res.status
              })
            }
            let buf: ArrayBuffer
            try {
              buf = await res.arrayBuffer()
            } catch (e) {
              return readFailed(e)
            }
            log(res.status, 'OK')
            return cloudOk({
              bytes: new Uint8Array(buf),
              contentType: res.headers?.get('content-type') ?? null
            } satisfies CloudBinaryResponse)
          }

          let raw: string
          try {
            raw = await res.text()
          } catch (e) {
            return readFailed(e)
          }

          let parsed: unknown
          try {
            parsed = JSON.parse(raw)
          } catch {
            log(res.status, 'MALFORMED_RESPONSE')
            return cloudFail('MALFORMED_RESPONSE', `response is not JSON (status ${res.status})`, {
              httpStatus: res.status
            })
          }
          log(res.status, 'OK')
          return cloudOk(parsed)
        } finally {
          clearTimeout(timer)
        }
      }

      const retries = retryPlanFor(spec.method, spec.path)
      let result = await attemptOnce()
      for (let i = 0; i < retries; i++) {
        // 只重试 NETWORK（见文件头第 2 条）：TIMEOUT 与一切 HTTP 答复都不重发
        if (result.ok || result.failure.code !== 'NETWORK') return result
        // 失败的那次已经在 attemptOnce 里记过日志；这里只等退避再发下一次
        await sleep(RETRY_BACKOFF_MS[Math.min(i, RETRY_BACKOFF_MS.length - 1)])
        result = await attemptOnce()
      }
      return result
  }

  return {
    request: (spec) => run(spec, false),
    requestBytes: (spec) =>
      run(spec, true) as Promise<CloudResult<CloudBinaryResponse>>
  }
}
