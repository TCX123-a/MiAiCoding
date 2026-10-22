/**
 * 云账号客户端（P10.3 第一步）—— 四条认证调用的收口（register / login / logout / session）。
 *
 * 【token 住哪】经一个注入的 `TokenStore` 端口存取。app.ts 接的是**磁盘实现**
 * （session-store.ts：safeStorage 加密进 `accounts/<id>/session.bin`，docs/22 §5.1）；
 * 测试与「加密不可用」的降级用 `createMemoryTokenStore`（写口对内存实现是 no-op 落盘）。
 * ⚠️ token 不进日志、不进错误信息、不随 IPC 出去（出 IPC 的是
 * CloudAuthView = AuthResponse 减 token）。
 *
 * 【注册绝不自动重试】transport 层已是零重试；本层更不允许在失败后
 * "再试一次"—— POST /v1/auth/register 重发会造重复账号（第一步报告的硬约束）。
 * register 失败就是失败，重试由用户点按钮决定。
 *
 * 【登出的两个细节，各有单测】
 *   · 本地没 token：**一个包都不发**，直接 ok(null)（服务端 logout 幂等，
 *     但"没登录"这事本地就知道，没必要为了形式走一趟网络）。
 *   · 有 token 且服务端回了失败：**保留 token**。网络抖一下就把本地令牌清了，
 *     用户看到的是"莫名其妙被登出"；下次 session 探测才是裁决真伪的地方。
 *
 * 【session 探测的语义】返回 ok(null) = 未登录/令牌已死，ok(data) = 登录有效。
 * UNAUTHENTICATED / TOKEN_EXPIRED 是**确定性的**令牌已死（服务端查过库），
 * 这时才清本地 token；网络类失败（TIMEOUT/NETWORK/…）原样透传且 token 保留 ——
 * 断网不等于被登出（失败即值的好处正在这里：调用方能区分两者）。
 *
 * 【找回三步链（2026-10-13）】question / verify / reset 三个方法**都不写 token**
 * —— 服务端有意不发（拿到的是"改完密码自己去登录"）。边界情形：如果本机残留着
 * 某个旧令牌、而它所属的账号恰好在别处走了找回重置，服务端已把全部会话吊销 ——
 * 那个令牌由下一次 session 探测按 UNAUTHENTICATED 清掉，本文件不为此加"主动清"
 * 的分支（reset 成功 ≠ 本机这个令牌就是那个账号的，凭证据说话）。
 */
import { AVATAR_HASH_RE, TOKEN_REGEX } from '../../shared/cloud/protocol'
import type {
  AuthResponse,
  CloudAuthView,
  CloudCredentials,
  CloudFailure,
  CloudRegisterInput,
  CloudResult,
  CloudSessionView,
  RecoverQuestionRequest,
  RecoverQuestionResponse,
  RecoverResetRequest,
  RecoverResetResponse,
  RecoverVerifyRequest,
  RecoverVerifyResponse,
  SessionResponse
} from '../../shared/cloud/dto'
import { cloudFail, cloudOk, createTransport, type CloudLogger, type FetchLike } from './transport'

// ---------------------------------------------------------------- token 端口

/**
 * 一次登录态的全部内容（P10.5 端口扩展）：令牌原文 + 归属账号 + 过期时刻。
 * 磁盘实现（session-store.ts）需要后两者才能把令牌落进
 * `accounts/<sub>/session.bin`；内存实现只消费 token。
 * ⚠️ 三个字段都是凭据级 / 账号级数据：不进日志、不进错误信息、不随 IPC 出去。
 */
export interface TokenRecord {
  /** 令牌原文（`ms1_` 前缀 + 43 字符 base64url） */
  token: string
  /** 归属账号 id（服务端 account.id）—— 磁盘实现用它决定落进哪个账号目录 */
  sub: string
  /** 服务端回的过期时刻（ISO）—— 磁盘实现原样存进 StoredSession.expiresAt */
  expiresAt: string
  /** 资料快照（2026-10-22）：用户名；可选，内存实现容忍缺失 */
  username?: string
  /** 资料快照（2026-10-22）：头像 hash；null = 没设头像 */
  avatarHash?: string | null
}

/**
 * 令牌存取口。只有两个动作：读（只要 token 串，够发 Authorization 就行）、
 * 写（写 null = 清除）。写口收完整的 TokenRecord，因为**落盘的实现需要
 * sub/expiresAt**；读口不收宽 —— 本层（认证调用）从不需要后两者。
 * 换实现 = 换一个 TokenStore（P10.5 起是 session-store.ts），本文件其余逻辑不动。
 */
export interface TokenStore {
  get(): string | null
  set(next: TokenRecord | null): void
  /**
   * 可选：更新当前会话里的资料快照（用户名/头像 hash）。
   * 落盘实现（session-store.ts）会重写 session.bin；内存实现忽略即可。
   * 只在会话仍归属同一账号时生效（实现方自行比对）。
   */
  updateProfile?(patch: { username?: string; avatarHash?: string | null }): void
  /**
   * 可选：读当前资料快照（2026-10-22 夜间自查）。
   * session 探测用它决定「哪些字段本地还没有」——只补缺、绝不覆盖本地已有的
   * 值：探测是在飞 10s 的慢请求，期间改名/换头像成功后，迟到的旧回话不许把
   * 新资料打回旧值（尤其不能写进 session.bin）。
   */
  currentProfile?(): { username?: string; avatarHash?: string | null } | null
}

/**
 * 内存实现（测试与「safeStorage 不可用」的降级共用）。
 * sub/expiresAt 收下但不消费（落盘才用得上）—— 构造参数保持收**裸 token 串**，
 * 让所有老调用点与测试零改动。
 */
export function createMemoryTokenStore(initial: string | null = null): TokenStore {
  let record: TokenRecord | null = initial === null ? null : { token: initial, sub: '', expiresAt: '' }
  return {
    get: () => record?.token ?? null,
    set: (next) => {
      record = next
    },
    updateProfile: (patch) => {
      if (record === null) return
      if (typeof patch.username === 'string' && patch.username !== '') {
        record.username = patch.username
      }
      if (patch.avatarHash === null) record.avatarHash = null
      else if (typeof patch.avatarHash === 'string' && patch.avatarHash !== '') {
        record.avatarHash = patch.avatarHash
      }
    },
    currentProfile: () =>
      record === null ? null : { username: record.username, avatarHash: record.avatarHash }
  }
}

// ---------------------------------------------------------------- 依赖与出口

export interface CloudAccountDeps {
  baseUrl: string
  fetch: FetchLike
  timeoutMs?: number
  logger?: CloudLogger
  /** 重试退避的等待实现（注入缝，见 transport 的 CloudTransportDeps.sleep） */
  sleep?: (ms: number) => Promise<void>
  /** 省略 = 内存实现（测试与降级路径；app.ts 接 session-store.ts 的磁盘实现） */
  tokens?: TokenStore
  /**
   * 设备显示名（device.json 的 clientLabel，P10.1 第 2 项）：注册/登录时告诉
   * 服务端"这是哪台设备"（dto.ts:172 契约的可选字段，服务端 zod 1~64）。
   * 省略 = 不发这个字段（服务端按可选处理）—— 老调用方与测试因此零改动。
   */
  clientLabel?: string
}

export interface CloudAccountClient {
  register(input: CloudRegisterInput): Promise<CloudResult<CloudAuthView>>
  login(input: CloudCredentials): Promise<CloudResult<CloudAuthView>>
  logout(): Promise<CloudResult<null>>
  /** ok(null) = 未登录（本地没 token 或服务端判定令牌已死） */
  session(): Promise<CloudResult<CloudSessionView | null>>
  /** 找回链第 1 步：取回注册时选的安全问题（账号不存在/没设过各有专用错误码） */
  recoverQuestion(input: RecoverQuestionRequest): Promise<CloudResult<RecoverQuestionResponse>>
  /** 找回链第 2 步：验答案（防爆破两层在服务端，失败原样上行） */
  recoverVerify(input: RecoverVerifyRequest): Promise<CloudResult<RecoverVerifyResponse>>
  /** 找回链第 3 步：换密码（服务端会再核一遍答案；成功即吊销全部旧会话） */
  recoverReset(input: RecoverResetRequest): Promise<CloudResult<RecoverResetResponse>>
  /**
   * 改用户名（2026-10-22 用户系统批次；PUT /v1/me/username）。
   * 成功 = 服务端已落库 + 本地资料快照已同步（token 不动 —— 用户名只是身份，不是凭据）。
   * 失败原样上行：USERNAME_TAKEN / USERNAME_FORBIDDEN / RATE_LIMITED / VALIDATION_FAILED 各有文案。
   */
  updateUsername(username: string): Promise<CloudResult<AuthResponse['account']>>
}

// ---------------------------------------------------------------- 形状校验
//
// 服务端是权威，但"权威"不等于"永远回形状正确的东西"（版本漂移、代理插页）。
// 认不出的形状一律 MALFORMED_RESPONSE —— 宁可当错误，也不把半个对象
// 透传给渲染层（判定为真的路上不许有不需要证据的分支）。校验只认认识的键，
// 多余字段丢弃（同 dto.ts 的抄本纪律）。

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

function parseAccount(v: unknown): AuthResponse['account'] | null {
  if (typeof v !== 'object' || v === null) return null
  const a = v as { id?: unknown; username?: unknown; avatarHash?: unknown; createdAt?: unknown }
  if (!isString(a.id) || !isString(a.username) || !isString(a.createdAt)) return null
  /*
   * avatarHash：null = 没设；字符串必须是 64 位小写 hex（形状不对 = 整份不可信）。
   *
   * 缺键兼容（2026-10-22 夜间自查）：2026-10-22 之前的服务端**根本不发这个键**。
   * 客户端先更新、服务端后部署是发布常态，这段窗口里把「没这个字段」判成
   * MALFORMED 会让登录/注册/会话探测整条链一起坏 —— 用户看到的是「密码没错
   * 却登不上」。旧服务端缺键时按 null 接（就是默认大肥鱼头像），安全且不阻塞
   * 登录；一旦字段出现，形状纪律照旧（坏 hex 仍然整份拒绝）。
   */
  const avatarHash = a.avatarHash === undefined ? null : a.avatarHash
  if (avatarHash !== null && !(isString(avatarHash) && AVATAR_HASH_RE.test(avatarHash))) {
    return null
  }
  return { id: a.id, username: a.username, avatarHash, createdAt: a.createdAt }
}

/** register 201 / login 200 的成功体 → AuthResponse；另外钉死 token 形状（protocol 的 TOKEN_REGEX） */
function parseAuthResponse(v: unknown): AuthResponse | null {
  if (typeof v !== 'object' || v === null) return null
  const r = v as { token?: unknown; expiresAt?: unknown; absoluteExpiresAt?: unknown; account?: unknown }
  if (!isString(r.token) || !TOKEN_REGEX.test(r.token)) return null
  if (!isString(r.expiresAt) || !isString(r.absoluteExpiresAt)) return null
  const account = parseAccount(r.account)
  if (account === null) return null
  return { token: r.token, expiresAt: r.expiresAt, absoluteExpiresAt: r.absoluteExpiresAt, account }
}

/** PUT /v1/me/username 200 → `{account}`（2026-10-22） */
function parseAccountEnvelope(v: unknown): AuthResponse['account'] | null {
  if (typeof v !== 'object' || v === null) return null
  return parseAccount((v as { account?: unknown }).account)
}

/** GET /v1/auth/session 200 → SessionResponse */
function parseSessionResponse(v: unknown): SessionResponse | null {
  if (typeof v !== 'object' || v === null) return null
  const r = v as { account?: unknown; idleExpiresAt?: unknown; absoluteExpiresAt?: unknown }
  const account = parseAccount(r.account)
  if (account === null) return null
  if (!isString(r.idleExpiresAt) || !isString(r.absoluteExpiresAt)) return null
  return { account, idleExpiresAt: r.idleExpiresAt, absoluteExpiresAt: r.absoluteExpiresAt }
}

/** recover/question 200 → {question}（非空字符串；服务端恒回预设枚举的成员） */
function parseQuestionResponse(v: unknown): RecoverQuestionResponse | null {
  if (typeof v !== 'object' || v === null) return null
  const r = v as { question?: unknown }
  if (!isString(r.question) || r.question.length === 0) return null
  return { question: r.question }
}

/**
 * recover/verify 200 → {verified}：**只认 true**。服务端答错一律 401
 * （verified:false 这一支不存在）——把它当成功形状放行等于给"判定为真"开了
 * 一条不需要证据的分支，这里宁可当形状坏。
 */
function parseVerified(v: unknown): RecoverVerifyResponse | null {
  if (typeof v !== 'object' || v === null) return null
  if ((v as { verified?: unknown }).verified !== true) return null
  return { verified: true }
}

/** recover/reset 200 → {ok}：同理只认 true（服务端失败全走非 2xx 错误体） */
function parseResetOk(v: unknown): RecoverResetResponse | null {
  if (typeof v !== 'object' || v === null) return null
  if ((v as { ok?: unknown }).ok !== true) return null
  return { ok: true }
}

/** 2xx 但形状对不上：这是**我们侧**的判定，不是服务端回的错 —— httpStatus 如实放 null
 *（transport 层自己读到了状态，它那边的 MALFORMED_RESPONSE 才带状态；这里只见过解析后的对象）。 */
function malformed(detail: string): CloudFailure {
  return {
    code: 'MALFORMED_RESPONSE',
    message: `unexpected response shape: ${detail}`,
    httpStatus: null
  }
}

/** 减掉 token 再出 IPC —— 这是 token 与渲染层之间唯一的一道墙，别绕 */
function toAuthView(r: AuthResponse): CloudAuthView {
  return { expiresAt: r.expiresAt, absoluteExpiresAt: r.absoluteExpiresAt, account: r.account }
}

// ---------------------------------------------------------------- 主入口

const PATH_REGISTER = '/v1/auth/register'
const PATH_LOGIN = '/v1/auth/login'
const PATH_LOGOUT = '/v1/auth/logout'
const PATH_SESSION = '/v1/auth/session'
const PATH_USERNAME = '/v1/me/username'
const PATH_RECOVER_QUESTION = '/v1/auth/recover/question'
const PATH_RECOVER_VERIFY = '/v1/auth/recover/verify'
const PATH_RECOVER_RESET = '/v1/auth/recover/reset'

export function createCloudAccountClient(deps: CloudAccountDeps): CloudAccountClient {
  const tokens = deps.tokens ?? createMemoryTokenStore()
  const transport = createTransport({
    baseUrl: deps.baseUrl,
    fetch: deps.fetch,
    timeoutMs: deps.timeoutMs,
    logger: deps.logger,
    sleep: deps.sleep
  })

  /** register 与 login 共用「POST → parseAuthResponse → 写 token」这一串，收口成
   *  一处，免得两边的"存 token"行为漂移（请求体各自现造，只有路径不同） */
  async function postAuth(
    path: string,
    body: Record<string, unknown>
  ): Promise<CloudResult<CloudAuthView>> {
    // clientLabel（P10.1）：来自 device.json，**不是**渲染层入参 —— 它由主进程
    // 现读，跟 ipc 载荷里有没有这一项无关；deps 没给就整个字段不发。
    const payload = deps.clientLabel === undefined ? body : { ...body, clientLabel: deps.clientLabel }
    const result = await transport.request({ method: 'POST', path, body: payload })
    if (!result.ok) return result
    const parsed = parseAuthResponse(result.data)
    if (parsed === null) return { ok: false, failure: malformed('auth response') }
    // 完整记录交给端口：磁盘实现（P10.5）要靠 sub 落对账号目录、靠 expiresAt 存形状；
    // 2026-10-22 起带上资料快照（用户名/头像 hash），重启后不联网也能显示自己
    tokens.set({
      token: parsed.token,
      sub: parsed.account.id,
      expiresAt: parsed.expiresAt,
      username: parsed.account.username,
      avatarHash: parsed.account.avatarHash
    })
    return cloudOk(toAuthView(parsed))
  }

  return {
    register: (input) =>
      postAuth(PATH_REGISTER, {
        // 只重建认识的字段（渲染层传了什么多余键都不带走）
        username: input.username,
        password: input.password,
        securityQuestion: input.securityQuestion,
        securityAnswer: input.securityAnswer
      }),
    login: (input) => postAuth(PATH_LOGIN, { username: input.username, password: input.password }),

    async logout(): Promise<CloudResult<null>> {
      const token = tokens.get()
      if (token === null) {
        // 本地就没登录 —— 没有可登出的会话，一个包都不发（见文件头）
        return cloudOk(null)
      }
      const result = await transport.request({ method: 'POST', path: PATH_LOGOUT, token })
      if (!result.ok) {
        // 失败保留 token（网络抖一下 ≠ 要登出），failure 原样上行
        return result
      }
      tokens.set(null)
      return cloudOk(null)
    },

    async session(): Promise<CloudResult<CloudSessionView | null>> {
      const token = tokens.get()
      if (token === null) return cloudOk(null)
      const result = await transport.request({ method: 'GET', path: PATH_SESSION, token })
      if (!result.ok) {
        if (result.failure.code === 'UNAUTHENTICATED' || result.failure.code === 'TOKEN_EXPIRED') {
          // 服务端查过库：令牌真的死了 —— 清本地，按"未登录"上报（不是错误）
          tokens.set(null)
          return cloudOk(null)
        }
        return result
      }
      const parsed = parseSessionResponse(result.data)
      if (parsed === null) return { ok: false, failure: malformed('session response') }
      /*
       * 服务端是资料的权威，但**只补本地缺的字段**：
       * 探测在弱网下能拖 10s×3，期间用户可能刚改名/换头像（updateUsername /
       * upload 已经更新了快照）。这时迟到的 session 回话是旧值 —— 无条件
       * updateProfile 会把它写回 session.bin，界面/重启后都挂着旧名字。
       * 逐字段比对「本地有没有」：有就跳过，没有才补。
       */
      const snapshot = tokens.currentProfile?.() ?? null
      const patch: { username?: string; avatarHash?: string | null } = {}
      if (snapshot?.username === undefined || snapshot.username === null) {
        patch.username = parsed.account.username
      }
      if (snapshot === null || snapshot.avatarHash === undefined || snapshot.avatarHash === null) {
        patch.avatarHash = parsed.account.avatarHash
      }
      if (patch.username !== undefined || patch.avatarHash !== undefined) {
        tokens.updateProfile?.(patch)
      }
      return cloudOk(parsed)
    },

    async updateUsername(username: string): Promise<CloudResult<AuthResponse['account']>> {
      const token = tokens.get()
      if (token === null) return cloudFail('UNAUTHENTICATED', 'not signed in')
      const result = await transport.request({
        method: 'PUT',
        path: PATH_USERNAME,
        body: { username },
        token
      })
      if (!result.ok) return result
      const account = parseAccountEnvelope(result.data)
      if (account === null) return { ok: false, failure: malformed('username response') }
      // 服务端已落库 —— 本地快照立即跟上（写盘失败只降级到内存，由端口自己吞）
      tokens.updateProfile?.({ username: account.username, avatarHash: account.avatarHash })
      return cloudOk(account)
    },

    // ---- 找回三步链（2026-10-13）：不带 token 发（服务端也不发 token 回来）。
    // 三个方法形状同构：POST → 失败原样上行 → 形状 parse 不过走 MALFORMED_RESPONSE。
    async recoverQuestion(input: RecoverQuestionRequest): Promise<CloudResult<RecoverQuestionResponse>> {
      const result = await transport.request({
        method: 'POST',
        path: PATH_RECOVER_QUESTION,
        body: { username: input.username }
      })
      if (!result.ok) return result
      const parsed = parseQuestionResponse(result.data)
      if (parsed === null) return { ok: false, failure: malformed('recover question response') }
      return cloudOk(parsed)
    },

    async recoverVerify(input: RecoverVerifyRequest): Promise<CloudResult<RecoverVerifyResponse>> {
      const result = await transport.request({
        method: 'POST',
        path: PATH_RECOVER_VERIFY,
        body: { username: input.username, answer: input.answer }
      })
      if (!result.ok) return result
      const parsed = parseVerified(result.data)
      if (parsed === null) return { ok: false, failure: malformed('recover verify response') }
      return cloudOk(parsed)
    },

    async recoverReset(input: RecoverResetRequest): Promise<CloudResult<RecoverResetResponse>> {
      const result = await transport.request({
        method: 'POST',
        path: PATH_RECOVER_RESET,
        body: { username: input.username, answer: input.answer, newPassword: input.newPassword }
      })
      if (!result.ok) return result
      const parsed = parseResetOk(result.data)
      if (parsed === null) return { ok: false, failure: malformed('recover reset response') }
      return cloudOk(parsed)
    }
  }
}
