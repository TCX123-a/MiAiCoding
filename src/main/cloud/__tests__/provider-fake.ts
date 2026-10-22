/**
 * 可编排假提供方（P10.1 第 11 项）—— P10.3 / P10.4 测试的地基。
 *
 * 【谁用它】同步引擎的测试（挑战结算上行、四文档同步……）都靠它编排剧本：
 * 401/409/超时/队列耗尽 —— 被测代码走哪条分支，由 script 说了算，一次都不联网。
 *
 * 【回放规则】每次调用先把 {method, args} 记进 `calls`（编排断言读它），然后：
 *   · script 给了数组 ⇒ 按序 shift 回放（**数组被原地消耗**：一个剧本喂一个假件，
 *     要复用先自己 `[...queue]` 复制一份）；
 *   · script 给了单条（非数组）⇒ 一直回放那一条；
 *   · 没给、或数组已空 ⇒ 回该方法的**默认成功值**（见下面三个工厂）。
 *
 * 【默认值为什么长这样】默认 = 「最小且不凭空造数据」的成功：
 * session 默认 ok(null)（未登录是合法成功值），listDocs 默认四键全 null
 *（云端还没有任何文档），getDoc 默认 {notModified:true}（"你手上那份就是
 * 最新的"——刻意选信息量最小的一支：默认值若凭空造一份 payload，忘了编排
 * 剧本的测试会误以为云端真有内容）。要别的剧本就显式 script。
 *
 * 【类型安全】script 只能是 CloudResult<unknown>（一张表要装七个方法各自的
 * 返回类型，TS 表达不了按方法名索引出精确类型）；回放处用一次 `as` 收窄并注明
 * 为什么安全 —— 剧本里塞的东西与方法返回类型匹配，是**丢进剧本的人**的责任，
 * 这是假件的天然使用契约。全文件不许 any。
 */
import type { DocType } from '../../../shared/cloud/protocol'
import type {
  CloudAuthView,
  CloudCredentials,
  CloudDocView,
  CloudRegisterInput,
  CloudResult,
  CloudSessionView,
  DocsSummary,
  PutDocRequest,
  PutDocResponse
} from '../../../shared/cloud/dto'
import { cloudOk } from '../transport'
import type { ApiProvider } from '../provider'

/** 一次调用的记录：方法名 + 原样实参（编排断言直接读它） */
export interface ProviderCall {
  method: string
  args: unknown[]
}

/** 剧本的一条：数组 = 按序消耗的队列；单条 = 恒回放那一条 */
export type ProviderScriptEntry = Array<CloudResult<unknown>> | CloudResult<unknown>
export type ProviderScript = Partial<Record<keyof ApiProvider, ProviderScriptEntry>>

// ---------------------------------------------------------------- 默认成功值
//
// 时间戳一律写死（绝不取 now()）：假数据要逐字节可预期，断言才不会跟着时钟漂。
// 用工厂函数而不是共享常量：每次调用都回一个新对象，防跨用例互相改出鬼。

function defaultAuthView(): CloudAuthView {
  return {
    expiresAt: '2026-11-09T00:00:00.000Z',
    absoluteExpiresAt: '2027-04-08T00:00:00.000Z',
    account: {
      id: 'acc_fake',
      username: 'fake-user',
      avatarHash: null,
      createdAt: '2026-10-10T00:00:00.000Z'
    }
  }
}

function defaultDocsSummary(): DocsSummary {
  // 四键恒在、全 null（dto.DocsSummary 的形状：null = 云端还没有这份）
  return { profile: null, wrongbook: null, favorites: null, practice: null }
}

function defaultPutDocResponse(): PutDocResponse {
  // 最小成功：不是 CAS 语义模拟，只是"写成功了、这是新版本号"
  return { revision: 1, docVer: 1, updatedAt: '2026-10-10T00:00:00.000Z' }
}

// ---------------------------------------------------------------- 回放

function isQueue(entry: ProviderScriptEntry): entry is Array<CloudResult<unknown>> {
  return Array.isArray(entry)
}

/** 取这一条剧本：队列 shift 一条；单条恒回；没给或队列空 ⇒ null（走默认值） */
function take(entry: ProviderScriptEntry | undefined): CloudResult<unknown> | null {
  if (entry === undefined) return null
  if (!isQueue(entry)) return entry
  const next = entry.shift()
  return next === undefined ? null : next
}

/**
 * 剧本优先、默认兜底，并把结果收窄成方法自己的返回类型。
 *
 * 【为什么这个 `as` 安全】script 的类型只能是 CloudResult<unknown> —— 一张表
 * 要装七个方法各自的返回类型，TS 表达不了"按方法名索引出精确返回"；剧本里塞的
 * 到底是哪个方法的包，由测试作者保证（假件的使用契约）。默认值则都来自上面三个
 * 工厂（类型正确的字面量）。**全文件只在这一处收窄**，不许扩散成 any。
 */
function scripted<T>(entry: ProviderScriptEntry | undefined, fallback: CloudResult<T>): CloudResult<T> {
  const taken = take(entry)
  if (taken === null) return fallback
  return taken as CloudResult<T>
}

// ---------------------------------------------------------------- 主入口

export function createFakeProvider(script: ProviderScript = {}): ApiProvider & { calls: ProviderCall[] } {
  const calls: ProviderCall[] = []

  return {
    calls,

    // register 收 CloudRegisterInput（2026-10-13 起带一问一答）；参数类型必须与
    // ApiProvider 逐字对齐 —— 写成 CloudCredentials 靠方法参数的**双变检查**
    // 能骗过编译器，但那是个假签名：类型面说"假件=真接口"就不许留这处歪的
    async register(input: CloudRegisterInput): Promise<CloudResult<CloudAuthView>> {
      calls.push({ method: 'register', args: [input] })
      return scripted(script.register, cloudOk(defaultAuthView()))
    },

    async login(input: CloudCredentials): Promise<CloudResult<CloudAuthView>> {
      calls.push({ method: 'login', args: [input] })
      return scripted(script.login, cloudOk(defaultAuthView()))
    },

    async logout(): Promise<CloudResult<null>> {
      calls.push({ method: 'logout', args: [] })
      // 默认成功 = 登出成功且无返回（服务端 204 的形状）
      return scripted<null>(script.logout, cloudOk(null))
    },

    async session(): Promise<CloudResult<CloudSessionView | null>> {
      calls.push({ method: 'session', args: [] })
      // 默认 = 未登录（ok(null) 是 session 的合法成功值，不是"拿不到数据"）
      return scripted<CloudSessionView | null>(script.session, cloudOk(null))
    },

    async listDocs(): Promise<CloudResult<DocsSummary>> {
      calls.push({ method: 'listDocs', args: [] })
      return scripted(script.listDocs, cloudOk(defaultDocsSummary()))
    },

    async getDoc(docType: DocType, opts?: { ifNoneMatchRevision?: number }): Promise<CloudResult<CloudDocView>> {
      calls.push({ method: 'getDoc', args: [docType, opts] })
      return scripted<CloudDocView>(script.getDoc, cloudOk({ notModified: true }))
    },

    async putDoc(docType: DocType, input: PutDocRequest): Promise<CloudResult<PutDocResponse>> {
      calls.push({ method: 'putDoc', args: [docType, input] })
      return scripted(script.putDoc, cloudOk(defaultPutDocResponse()))
    }
  }
}
