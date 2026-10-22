/**
 * 云文档同步客户端（P10.4 第一步）—— 三个动作：list / get / put。
 *
 * 【为什么 transport 上一步发不出这三个请求】
 * `CloudRequestSpec.method` 原本只有 `'GET' | 'POST'`，而文档同步的写口是 **PUT**
 * （docs/22 §3.4 #13）。这一步把 PUT 并进同一条执行路径（同语义的合并，不是新开一条），
 * 并把条件 GET 的 304 从"失败"里择出来（见 transport.ts 的 NOT_MODIFIED 注释：
 * Fetch 的 `res.ok` 对 304 是 false，漏掉它会把一次正常的缓存命中报成 BAD_REQUEST）。
 *
 * 【三个动作各自的形状纪律，与 account.ts 同款】
 * 服务端是权威，但"权威"不等于"永远回形状正确的东西"（版本漂移、代理插页）。
 * 认不出的形状一律 MALFORMED_RESPONSE —— 宁可当错误，也不把半个对象透传给上层。
 * 尤其是 `list()`：四个键**恒在**（sync.ts:151-166 先铺 null 再填），
 * 所以"缺键"和"值为 null"是两件事，这里把缺键判成 MALFORMED 而不是补个 null ——
 * 补 null 会把"服务端换形状了"这条真信号抹平成"云端还没有这份文档"。
 *
 * 【token 从哪来】注入的 TokenStore（与 account.ts 共用同一个实例）。没 token
 * 时**一个包都不发**：本地就知道"我没登录"，没必要为了形式走一趟网络再收个 401
 * —— 这与 account.ts 的 logout/session 是同一条口径（失败即值，且不带 httpStatus，
 * 因为服务端根本没回过话）。
 *
 * 【不做的事】
 * · 不做本地缓存、不做离线队列、不做自动重试。docs/22 §3.7 的冻结重试语义是
 *   P10.4 后续步骤的范围，落地前"谁都不重试"是它的安全子集（同 transport 的口径）。
 *   这一层只保证：**发出去的请求形状对、回来的东西认得出、认不出就如实报错**。
 */
import { DOC_TYPES, type DocType } from '../../shared/cloud/protocol'
import type {
  CloudDocView,
  CloudFailure,
  CloudResult,
  DocsSummary,
  DocSummary,
  PutDocRequest,
  PutDocResponse
} from '../../shared/cloud/dto'
import { cloudOk, createTransport, NOT_MODIFIED, type CloudLogger, type FetchLike } from './transport'
import type { TokenStore } from './account'

export interface CloudDocsDeps {
  baseUrl: string
  fetch: FetchLike
  timeoutMs?: number
  logger?: CloudLogger
  /** 重试退避的等待实现（注入缝，见 transport 的 CloudTransportDeps.sleep） */
  sleep?: (ms: number) => Promise<void>
  /** 与账号客户端共用同一个 store —— 登录一次，两边都看得到 */
  tokens: TokenStore
}

export interface CloudDocsClient {
  /** GET /v1/docs —— 四份摘要（不含 payload） */
  list(): Promise<CloudResult<DocsSummary>>
  /**
   * GET /v1/docs/:docType。传 `ifNoneMatchRevision`（= 你手上那份的 revision）走条件 GET：
   * 没变时返回 `{notModified:true}`（服务端 304，**没有 payload**，用你本地那份）；
   * 变了则是完整文档。不传就是无条件拉取。
   */
  get(docType: DocType, opts?: { ifNoneMatchRevision?: number }): Promise<CloudResult<CloudDocView>>
  /** PUT /v1/docs/:docType —— 条件写（CAS）。`baseRevision: null` = 首次推送 */
  put(docType: DocType, input: PutDocRequest): Promise<CloudResult<PutDocResponse>>
}

// ---------------------------------------------------------------- 形状校验

const DOC_TYPE_SET: ReadonlySet<string> = new Set(DOC_TYPES)

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
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

function parseSummary(v: unknown): DocSummary | null {
  if (!isPlainObject(v)) return null
  const revision = num(v.revision)
  const docVer = num(v.docVer)
  const updatedAt = str(v.updatedAt)
  const sizeBytes = num(v.sizeBytes)
  if (revision === null || docVer === null || updatedAt === null || sizeBytes === null) return null
  return { revision, docVer, updatedAt, sizeBytes }
}

/** 四键恒在：缺键 ⇒ null；值是 null ⇒ 合法（云端还没有这份文档） */
function parseDocsSummary(v: unknown): DocsSummary | null {
  if (!isPlainObject(v)) return null
  const out = {} as DocsSummary
  for (const key of DOC_TYPES) {
    if (!(key in v)) return null
    const raw = (v as Record<string, unknown>)[key]
    if (raw === null) {
      out[key] = null
      continue
    }
    const parsed = parseSummary(raw)
    if (parsed === null) return null
    out[key] = parsed
  }
  return out
}

function parseGetDoc(v: unknown): Extract<CloudDocView, { notModified: false }> | null {
  if (!isPlainObject(v)) return null
  const docVer = num(v.docVer)
  const revision = num(v.revision)
  const updatedAt = str(v.updatedAt)
  if (docVer === null || revision === null || updatedAt === null) return null
  if (!isPlainObject(v.payload)) return null
  return { notModified: false, docVer, revision, updatedAt, payload: v.payload }
}

function parsePutDoc(v: unknown): PutDocResponse | null {
  if (!isPlainObject(v)) return null
  const revision = num(v.revision)
  const docVer = num(v.docVer)
  const updatedAt = str(v.updatedAt)
  if (revision === null || docVer === null || updatedAt === null) return null
  return { revision, docVer, updatedAt }
}

// ---------------------------------------------------------------- 主入口

const PATH_DOCS = '/v1/docs'

export function createCloudDocsClient(deps: CloudDocsDeps): CloudDocsClient {
  const transport = createTransport({
    baseUrl: deps.baseUrl,
    fetch: deps.fetch,
    timeoutMs: deps.timeoutMs,
    logger: deps.logger,
    sleep: deps.sleep
  })

  /** docType 是编译期就定死的字面量联合；传进来别的东西 = 绕过了 TS，属于我们自己传错参数 */
  function assertDocType(docType: DocType): void {
    if (!DOC_TYPE_SET.has(docType)) {
      throw new TypeError(`unknown doc type: ${String(docType)}`)
    }
  }

  return {
    async list(): Promise<CloudResult<DocsSummary>> {
      const token = deps.tokens.get()
      if (token === null) return { ok: false, failure: UNLOGGED }
      const result = await transport.request({ method: 'GET', path: PATH_DOCS, token })
      if (!result.ok) return result
      const parsed = parseDocsSummary(result.data)
      if (parsed === null) return { ok: false, failure: malformed('docs summary') }
      return cloudOk(parsed)
    },

    async get(docType, opts): Promise<CloudResult<CloudDocView>> {
      assertDocType(docType)
      const token = deps.tokens.get()
      if (token === null) return { ok: false, failure: UNLOGGED }
      const spec = {
        method: 'GET' as const,
        path: `${PATH_DOCS}/${docType}`,
        token,
        // ETag 的引号是服务端口径（sync.ts:203 `"${revision}"`，且 :205 是**全等**比较）——
        // 拼装只在客户端这一处发生，将来服务端换 ETag 形状只改这一行
        ...(opts?.ifNoneMatchRevision !== undefined
          ? { ifNoneMatch: `"${opts.ifNoneMatchRevision}"` }
          : {})
      }
      const result = await transport.request(spec)
      if (!result.ok) return result
      // 哨兵是 transport 给条件 GET 的唯一成功特例，认不得就是形状错（绝不当成"没变"）
      if (result.data === NOT_MODIFIED) return cloudOk({ notModified: true })
      const parsed = parseGetDoc(result.data)
      if (parsed === null) return { ok: false, failure: malformed(`${docType} document`) }
      return cloudOk(parsed)
    },

    async put(docType, input): Promise<CloudResult<PutDocResponse>> {
      assertDocType(docType)
      // docVer ≙ payload.version 是**客户端这边的义务**（sync.ts:235-237 是它的服务端镜像）。
      // 它属于"我们自己传错参数"，不是用户数据 —— 在这里拦下，比让服务端回一个
      // 400 VALIDATION_FAILED（读起来像"请求形状坏了"）更接近真因。
      if (input.payload.version !== input.docVer) {
        throw new TypeError('payload.version must equal docVer (docs/22 §4.3)')
      }
      const token = deps.tokens.get()
      if (token === null) return { ok: false, failure: UNLOGGED }
      const result = await transport.request({
        method: 'PUT',
        path: `${PATH_DOCS}/${docType}`,
        token,
        body: { docVer: input.docVer, baseRevision: input.baseRevision, payload: input.payload }
      })
      if (!result.ok) return result
      const parsed = parsePutDoc(result.data)
      if (parsed === null) return { ok: false, failure: malformed(`${docType} write result`) }
      return cloudOk(parsed)
    }
  }
}
