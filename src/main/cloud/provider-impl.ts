/**
 * 云提供方真实现（P10.1 第 11 项）—— 纯组装：把 account / docs 两个客户端
 * 接进 ApiProvider 的七个口，**一行新的网络逻辑都不写**。
 *
 * 【Transport 注入缝 = deps.fetch】一切请求都经注入的 FetchLike 出去：
 * 单测 / e2e 从这个缝换假实现（真货只由 app 启动处提供）。请求发什么形状、
 * 错误码怎么映射、重试与否 —— 全在 transport / account / docs 三层里各有单测；
 * 收口层的职责只有两件：**转发**，和**让两个客户端共用一份令牌状态**。
 *
 * 【令牌生命周期 = 单独一个 TokenStore】account 客户端与 docs 客户端
 * **共用同一个 store 实例**（登录一次、两边都看得到；deps.tokens 可注入，
 * 省略则内存实现）。P10.5 换 safeStorage 落盘实现时，这里一行不改 ——
 * 换的是 TokenStore 的实现，不是本文件。
 *
 * 【401 语义】见 provider.ts 头注释：UNAUTHENTICATED / TOKEN_EXPIRED ⇒
 * 令牌已死 ⇒ 调用方重新登录。本层不做续期、不加重试（transport 本就零重试）。
 *
 * 【零网络原语】与 provider.ts 同规格：本文件不发起任何请求，
 * 被 `src/main/cloud/**` 的零网络闸门整目录扫。
 */
import type { CloudLogger, FetchLike } from './transport'
import { createCloudAccountClient, createMemoryTokenStore, type TokenStore } from './account'
import { createCloudDocsClient } from './docs'
import type { ApiProvider } from './provider'

export interface CloudApiProviderDeps {
  /** 空串 = 未配置（transport 见空串回 NOT_CONFIGURED、零请求），绝不在这里换主机 */
  baseUrl: string
  fetch: FetchLike
  timeoutMs?: number
  logger?: CloudLogger
  /** 重试退避的等待实现（注入缝，见 transport 的 CloudTransportDeps.sleep） */
  sleep?: (ms: number) => Promise<void>
  /** 省略 = 内存实现；P10.5 的落盘实现从这里注入，本文件其余不动 */
  tokens?: TokenStore
}

export function createApiProvider(deps: CloudApiProviderDeps): ApiProvider {
  // 先定令牌状态，两个客户端拿到**同一个实例** —— 这就是「登录一次、两边都可用」
  // 的全部机制。把 `?? createMemoryTokenStore()` 拆成两次调用会让 docs 侧永远
  // 看不到登录令牌（表现为 listDocs 直接 UNAUTHENTICATED、一个包都不发）；
  // provider-impl.test.ts 第 1 条咬的就是这一幕。
  const tokens = deps.tokens ?? createMemoryTokenStore()

  const account = createCloudAccountClient({
    baseUrl: deps.baseUrl,
    fetch: deps.fetch,
    timeoutMs: deps.timeoutMs,
    logger: deps.logger,
    sleep: deps.sleep,
    tokens
  })
  const docs = createCloudDocsClient({
    baseUrl: deps.baseUrl,
    fetch: deps.fetch,
    timeoutMs: deps.timeoutMs,
    logger: deps.logger,
    sleep: deps.sleep,
    tokens
  })

  // 七个口逐一委托：不包装、不改写、不吞错误 —— ApiProvider 的语义就是两边
  // 客户端语义的并集（含 docs 客户端对「我们自己传错参数」的 TypeError 抛出）。
  return {
    register: (input) => account.register(input),
    login: (input) => account.login(input),
    logout: () => account.logout(),
    session: () => account.session(),
    listDocs: () => docs.list(),
    getDoc: (docType, opts) => docs.get(docType, opts),
    putDoc: (docType, input) => docs.put(docType, input)
  }
}
