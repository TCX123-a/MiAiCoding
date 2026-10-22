/**
 * 云协议 · 客户端类型面（P10.3 第一步）。
 *
 * 【真源 = 服务端 zod】本文件「服务端形状」一节逐字段抄自服务端代码（点名到行）：
 *   · `server/src/routes/schemas.ts:4-10` —— accountSchema / authResponseSchema；
 *   · `server/src/routes/auth.ts:48-51` 字段 schema（用户名正则 = protocol 的
 *     USERNAME_RE、密码 = PASSWORD_MIN/MAX_LENGTH、安全答案 1~64 字符），
 *     `:53-59` registerBodySchema（clientLabel 可选 1~64 + 安全问答必填）、
 *     `:61-64` loginBodySchema；
 *   · `server/src/routes/auth.ts:211` register → 201、`:279` login → 200、
 *     `:371` logout → 204（幂等：缺令牌/坏令牌/已吊销同样 204）；
 *     `:616` recover/question → 200{question}、`:640` recover/verify → 200{verified}、
 *     `:659` recover/reset → 200{ok} —— 找回三端点**都不自动发 token**；
 *   · `server/src/routes/me.ts:56` GET /v1/auth/session → 200
 *     `{account, idleExpiresAt, absoluteExpiresAt}`；
 *   · 错误体 `{"error":{code,message,retryAfterMs?,details?,requestId}}` ——
 *     `server/src/lib/errors.ts:74` + `server/src/plugins/error-handler.ts:12-17`
 *     （HTTP 状态 = HTTP_STATUS_BY_CODE[code]，由 code 派生）。
 *   密码策略（`server/src/lib/password-policy.ts:144` 6~128 位、`:152` 不得含用户名、
 *   WEAK_PASSWORDS 黑名单）只改变服务端的判定结果（VALIDATION_FAILED），不改形状；
 *   安全答案在写库前经 `server/src/lib/security-answer.ts:9` 归一化（NFKC+trim+小写），
 *   那是服务端内部行为，同样不改形状。
 *
 * 【协议冻结面 = protocol.ts】协议常量与纯规则（版本号 / 错误码枚举 / 状态码映射 /
 * 上限 / 正则）的唯一真源是 `src/shared/cloud/protocol.ts`（与 `server/src/protocol.ts`
 * 逐字节相等，被 `src/shared/__tests__/cloud-protocol.test.ts:204-217` 守着）。
 * **本文件只抄形状，一个常数都不重复定义** —— 上限与正则一律从 protocol.ts 引。
 *
 * 【改动的纪律】服务端 zod 加/改一个字段，本文件必须同批跟改：两侧不一致时
 * 客户端这边表现为 MALFORMED_RESPONSE 或少拿一个字段，而服务端测试不会替你发现。
 * 字段抄本只认认识的键：多余字段在客户端会被**丢弃**（不透传给上层）。
 */

import type { ErrorCode, SecurityQuestion } from './protocol'

// ---------------------------------------------------------------- 服务端形状（zod 抄本）

/** 账号视图（schemas.ts:4-9）；createdAt 是 ISO8601 UTC 字符串（docs/22 自由度 #10）
 *  avatarHash（2026-10-22 用户系统批次）：sha256 hex，null = 没设头像（显示默认大肥鱼） */
export interface Account {
  id: string
  username: string
  avatarHash: string | null
  createdAt: string
}

/**
 * register 201 / login 200 的响应体（schemas.ts:10-15）。
 * ⚠️ token 只允许活在**主进程**（account.ts 的 TokenStore），不随 IPC 出去 ——
 * 渲染进程拿到的是下面的 CloudAuthView（同形减 token）。
 */
export interface AuthResponse {
  token: string
  /** 空闲过期（30 天滑动；命名照服务端：expiresAt 就是 idle 那条） */
  expiresAt: string
  /** 绝对过期（180 天硬顶） */
  absoluteExpiresAt: string
  account: Account
}

/**
 * POST /v1/auth/register 请求体（auth.ts:53-59）。成功 = 201 + AuthResponse。
 * password 的下限对齐服务端策略（6~128 位，password-policy.ts:144）——
 * 客户端不预检（服务端才是权威），这里只是形状。
 * 【安全问答必填（2026-10-13）】question 只能从 protocol.SECURITY_QUESTIONS
 * 闭集里选；answer 明文原样上行（1~64 字符），归一化与哈希都是服务端的事。
 */
export interface RegisterRequest {
  /** 服务端合 protocol 的 USERNAME_RE：2~30 位，中文/英文/数字/下划线，不能以数字开头 */
  username: string
  password: string
  securityQuestion: SecurityQuestion
  securityAnswer: string
  /** 可选设备标签（1~64 字符，auth.ts:50）。P10.1 的 device.json 落地前客户端不带它 */
  clientLabel?: string
}

/**
 * POST /v1/auth/login 请求体（auth.ts:37-41）。
 * ⚠️ 登录侧的 password 只要求 1~128：短密码要走到 BAD_CREDENTIALS（防枚举），
 * 不是当场 VALIDATION_FAILED —— 这是服务端刻意的分流，客户端别"修正"它。
 */
export interface LoginRequest {
  username: string
  password: string
  clientLabel?: string
}

// ---- 找回密码三步链（2026-10-13 主人令；auth.ts:616/:640/:659）
//
// 流程 = question（拿问题）→ verify（验答案）→ reset（换密码）。三个端点
// **都不自动发 token**：找回路径拿到的是"改完密码自己去登录"，不给现成会话
// （服务端有意如此，别在客户端侧"顺手"续上）。防爆破两层在服务端
// （IP 10/15min + 账号 10/日 + 按用户名指数退避），客户端只如实透传
// RATE_LIMITED（带 retryAfterMs）。

/** POST /v1/auth/recover/question → 200 `{question}`（注册时选的那条，原样回显）。
 *  账号不存在 → 404 NOT_FOUND；没设过问答的存量账号 → 404 NO_SECURITY_QUESTION。 */
export interface RecoverQuestionRequest {
  username: string
}
export interface RecoverQuestionResponse {
  /** 服务端原样回显的预设问题（是 SECURITY_QUESTIONS 的成员，但读侧按 string 处理） */
  question: string
}

/** POST /v1/auth/recover/verify → 200 `{verified:true}`；答案错 → 401 BAD_SECURITY_ANSWER。
 *  通过 ≠ 放行重置：reset 会把答案**再核一遍**（纵深），调用方别把这一步当许可。 */
export interface RecoverVerifyRequest {
  username: string
  answer: string
}
export interface RecoverVerifyResponse {
  verified: boolean
}

/** POST /v1/auth/recover/reset → 200 `{ok:true}`。成功即吊销该账号全部会话 +
 *  置换密码哈希（旧密码与旧令牌当场作废）；弱密码同样 400 VALIDATION_FAILED。 */
export interface RecoverResetRequest {
  username: string
  answer: string
  newPassword: string
}
export interface RecoverResetResponse {
  ok: boolean
}

/**
 * POST /v1/auth/logout（auth.ts:241-264）：请求**无体**（令牌走 Authorization 头），
 * 成功 **204 无体**，幂等（缺令牌/坏令牌/已吊销同样 204）。
 * 所以这里没有任何 interface —— 形状就是「什么都没有」，客户端侧用 null 表示。
 */

/** GET /v1/auth/session 200（me.ts:56-61） */
export interface SessionResponse {
  account: Account
  /** 空闲过期（滑动） */
  idleExpiresAt: string
  /** 绝对过期（硬顶） */
  absoluteExpiresAt: string
}

// ---------------------------------------------------------------- 文档同步（docs/22 §3.4 #11-13）
//
// 真源 = `server/src/routes/sync.ts` 的四条 zod schema（行号点名在下面每条上）。
// 体积门（§4.4）与 docType 枚举在 protocol.ts（DOC_TYPES / DOC_SIZE_LIMITS），这里不重定义。

/**
 * GET /v1/docs 单份摘要（sync.ts:22-29 `docSummarySchema`）。
 * **可为 null** = 云端还没有这份文档（不是"空文档"）——这个区分决定客户端首推时
 * 用 `baseRevision: null` 还是拿一个 revision 去做 CAS。
 */
export interface DocSummary {
  revision: number
  docVer: number
  updatedAt: string
  /** 服务端口径 `octet_length(payload::text)`（sync.ts:145），不是 Content-Length */
  sizeBytes: number
}

/**
 * GET /v1/docs 200（sync.ts:124-130 response schema）。
 * ⚠️ 四个键**恒在**（sync.ts:151-166 先铺 null 再填）——缺键不是这个接口的形状，
 * 客户端按 `=== null` 判断，不要用 `in` / `?.` 兜。
 */
export interface DocsSummary {
  profile: DocSummary | null
  wrongbook: DocSummary | null
  favorites: DocSummary | null
  practice: DocSummary | null
}

/** GET /v1/docs/:docType 200（sync.ts:31-36）；无此文档 → 404 NOT_FOUND，不是空 payload */
export interface GetDocResponse {
  docVer: number
  revision: number
  updatedAt: string
  payload: Record<string, unknown>
}

/**
 * PUT /v1/docs/:docType 请求体（sync.ts:38-44 `putDocBodySchema`）。
 * `baseRevision: null` = 首次推送（建行为准，已有行则 409）；有值 = CAS。
 * ⚠️ 服务端硬规则（sync.ts:235-237）：**`payload.version` 必须 === `docVer`**，
 * 否则 400 VALIDATION_FAILED。这是 docVer ≙ payload.version 的协议约定，
 * 不是可选的一致性检查。
 */
export interface PutDocRequest {
  docVer: number
  baseRevision: number | null
  payload: Record<string, unknown>
}

/** PUT /v1/docs/:docType 200（sync.ts:46-50） */
export interface PutDocResponse {
  revision: number
  docVer: number
  updatedAt: string
}

/** 统一错误体（lib/errors.ts:61-76）。HTTP 状态由 `HTTP_STATUS_BY_CODE[code]` 派生 */
export interface ErrorBody {
  error: {
    code: ErrorCode
    message: string
    retryAfterMs?: number
    details?: unknown
    requestId: string
  }
}

// ---------------------------------------------------------------- 客户端 IPC 面（非服务端形状）
//
// 这一节不是 zod 抄本，是主进程 ↔ 渲染层的契约（`cloud:*` 四条通道 / preload 的
// miai.cloud）。凭据纪律在这里结构化：token 只住主进程，渲染层拿到的永远是不带
// token 的视图 + 结构化的失败码。
//
// 【为什么失败是值不是异常】跨 IPC 抛错误时 Electron 只带得走 message，CloudError
// 的 code 字段会整个丢掉；而渲染层的下一步动作完全由 code 决定（改密码 / 稍后再试 /
// 回登录页）。所以网络与协议类失败一律走下面的 CloudResult（同 AI 那套 AiResult 的
// 先例），只有「我们自己传错了参数」才抛。

/** 渲染层可提交的凭据。clientLabel 暂不开放（设备标签随 P10.1 device.json 一起做） */
export interface CloudCredentials {
  username: string
  password: string
}

/**
 * 渲染层可提交的注册输入 = 凭据 + 安全问答（2026-10-13 主人令）。
 * securityQuestion 只许从 protocol.SECURITY_QUESTIONS 闭集选（写侧是枚举成员）；
 * securityAnswer 明文原样上行（1~64 字符）—— 归一化与 argon2id 哈希都是服务端
 * 的事，客户端不做预处理（protocol.ts 的答案纪律）。
 */
export interface CloudRegisterInput extends CloudCredentials {
  securityQuestion: SecurityQuestion
  securityAnswer: string
}

/** register / login 成功后给渲染层的视图 —— 与 AuthResponse 同形**减去 token** */
export type CloudAuthView = Omit<AuthResponse, 'token'>

/** session 的成功视图（= 服务端 SessionResponse）；CloudResult.data 为 null = 未登录 */
export type CloudSessionView = SessionResponse

/**
 * 条件 GET 的结果视图：**"没变"与"变了"是两件事，不许塌成一个**。
 *
 * 服务端 304 时客户端拿不到任何 payload（那是重点：省掉一次传输），所以这一支
 * 只有"你手上那份就是最新的"这一个事实；调用方要拿 payload 就得用本地那份。
 * 塌成 `payload: null` 之类的话，读代码的人迟早会把"没变"读成"云端没有"。
 */
export type CloudDocView =
  | { notModified: true }
  // 「变了」这一支就是 GetDocResponse 加一个判别字段 —— 刻意**派生**而不是重抄一遍：
  // 两份写法迟早会漂（抄本改了、视图忘改），而漂的那一刻没有任何测试会红。
  | ({ notModified: false } & GetDocResponse)

/**
 * 客户端侧失败码（不属于协议错误码域，另起集合，绝不混进 ERROR_CODES 联合）：
 *   · TIMEOUT              —— 本地超时（默认 10s，AbortController 掐掉）
 *   · NETWORK              —— 连不上 / 传输中断（DNS、断网、代理拦了……）
 *   · MALFORMED_RESPONSE   —— 通了，但响应不是认得的 JSON 形状（代理页 / 版本漂移）
 *   · NOT_CONFIGURED       —— 服务器地址没配（baseUrl 为空；见 base-url.ts）
 *   · LEDGER_CORRUPT       —— 账号盒的饭账本在磁盘上读不回来（P10.5 激活流程）。
 *     不是网络错，是本地状态不允许安全继续：不"当空"、不覆盖，原样保留证据
 *     （见 account-flow.ts 文件头与 AccountFlowError）
 */
export const CLIENT_FAILURE_CODES = [
  'TIMEOUT',
  'NETWORK',
  'MALFORMED_RESPONSE',
  'NOT_CONFIGURED',
  'LEDGER_CORRUPT'
] as const
export type ClientFailureCode = (typeof CLIENT_FAILURE_CODES)[number]

/** 失败码全集：协议错误码 ∪ 客户端侧失败码 */
export type CloudFailureCode = ErrorCode | ClientFailureCode

export interface CloudFailure {
  code: CloudFailureCode
  /**
   * 给日志与开发者看的英文短语（服务端错误体原文或本层自造）。
   * **绝不含 token / Authorization 头**（由 transport.ts 的凭据纪律保证并被单测钉住）。
   * 给用户看的中文文案由渲染层按 code 出（同 AI 的 reason 码分工）。
   */
  message: string
  /** 服务端回过过的 HTTP 状态；客户端侧的判定（超时/断网/没配/形状对不上）为 null */
  httpStatus: number | null
  /** 服务端错误体携带的重试提示（毫秒） */
  retryAfterMs?: number
  /** 服务端错误体携带的补充信息（原样，不解释） */
  details?: unknown
}

/** 失败即值的结果包（成功 {ok:true,data} / 失败 {ok:false,failure}） */
export type CloudResult<T> = { ok: true; data: T } | { ok: false; failure: CloudFailure }

// ---------------------------------------------------------------- 大白饭 / 挑战 / 排行榜（服务端形状抄本）
//
// 真源 = `server/src/routes/rice.ts` / `challenge.ts` / `leaderboard.ts` / `me.ts` 的
// zod schema（行号点名在下面每条上）。这一节是三个云薄客户端
// （src/main/cloud/rice.ts / challenge.ts / leaderboard.ts）的类型面，纪律与上一节相同：
// 只抄认识的键（多余字段在客户端被丢弃）、缺键与值为 null 是两件事（`.nullable()` 的键
// 显式 null 合法，缺键判 MALFORMED_RESPONSE）、上限一律从 protocol.ts 引不在此重复定义。
//
// ⚠️ 注意几处**别抄错**的地方：
//   · 流水下行的 kind 在 zod 里是 `z.string()`（不是 RICE_LEDGER_KINDS 枚举）——值域闸在
//     DB CHECK，形状面故意宽容（rice.ts:86）；上行侧的 kind 才是枚举（rice.ts:48）。
//   · 挑战结算的 pickedLangs 是**可选**（缺省 = legacy 客户端，服务端从题批 lang 派生，
//     challenge.ts:210-215），而响应里的 flags/difficulty 复核标记是服务端生成的事实。
//   · 排行榜 me.rank 与 periodKey/computedAt/nextCursor 全是 `.nullable()`（键恒在、
//     值可为 null），filter.lang/difficulty 也是 null 而非缺省（leaderboard.ts:96-99）。
import type {
  Difficulty,
  DocType,
  Lang,
  LeaderboardPeriod,
  PickableLang,
  QuestionType,
  RiceKind
} from './protocol'

/**
 * 大白饭流水上行的单条（rice.ts:46-53 `riceEntrySchema`）。
 * ⚠️ 服务端的语义闸（rice-rules.ts:62-107）比 zod 严：delta 必须 === RICE_DELTA_BY_KIND[kind]
 * （白名单，多报不许），entryKey 形状 `installId:localSeq`（RICE_ENTRY_KEY_RE），
 * 且逐 kind 要求 ref（adopt 带 ref.installId / lesson 带 ref.lessonId / run 带 ref.fingerprint）
 * ——违反一律**整批 400**（rice.ts:210-216），不是逐条 rejected。
 */
export interface RicePushEntry {
  /** `${installId}:${localSeq}`（RICE_ENTRY_KEY_RE；长度 8~80，protocol.ts:263-265） */
  entryKey: string
  kind: RiceKind
  /** 必须 === RICE_DELTA_BY_KIND[kind]（protocol.ts:231-241），delta 绝对值 ≤ 999 */
  delta: number
  /** 本地日 YYYY-MM-DD；与服务器日差 > ±DAY_KEY_WINDOW_DAYS 天 → 逐条 rejected[] */
  dayKey: string
  /** ISO8601 带时区偏移；坏钟不限收，只记 flag（clock_skew / fingerprint_reuse） */
  at: string
  /**
   * 逐 kind 要求见上；其余 kind 选填。服务端 zod 是 `.nullable().default(null)`
   * （rice.ts:52）——省略 = null，重放对拍（rice.ts:340-345）两者等价。
   */
  ref: Record<string, unknown> | null
}

/**
 * POST /v1/rice/entries 请求体（rice.ts:55-59 `pushBodySchema`）。
 * entries 条数 ≤ RATE_LIMITS.riceEntriesPerPush = 200（protocol.ts:311）；超出服务端
 * 400 VALIDATION_FAILED（带 details.received），**不逐条 reject**。路由级 bodyLimit
 * 256KB（rice.ts:44），超了是传输层 413。
 */
export interface RicePushRequest {
  /** 安装实例 id（uuid）；也是 entryKey 前缀的来源 */
  installId: string
  entries: RicePushEntry[]
}

/** 逐条拒收（rice.ts:61-65 `rejectedSchema`）：HTTP 仍 200，只代表"这一条没收" */
export interface RiceRejectedEntry {
  entryKey: string
  /** 已知值：'VALIDATION_FAILED'（窗口外 / adopt 重复）、'OVER_DAILY_CAP'（kind 日上限）；按 string 收（forward-compatible） */
  code: string
  detail: string
}

/**
 * POST /v1/rice/entries 200（rice.ts:67-74 `pushResponseSchema`）。
 * ⚠️ push 的 HTTP **恒 200**（逐条处置，rice.ts:245-287）：200 不等于整批成功，
 * 每个请求条目恰好落进 accepted / duplicated / rejected[] 三桶之一。唯一整批失败是
 * 同 entry_key 不同内容 → 409 ENTRY_CONFLICT（rice.ts:346-350，details:{entryKey}）。
 */
export interface RicePushResponse {
  accepted: number
  /** 同键同内容的重放（幂等，不计日上限；rice.ts:335-356） */
  duplicated: number
  rejected: RiceRejectedEntry[]
  /** clamp(SUM(delta), 0, RICE_MAX=999) 的全量重算值（rice.ts:358-381） */
  balance: number
  earnedTotal: number
  spentTotal: number
}

/** GET /v1/rice/entries 下行单条（rice.ts:81-96 `pullResponseSchema`） */
export interface RiceLedgerEntry {
  /** 服务端自增序号；下行条件恒为 `seq > since`（rice.ts:422） */
  seq: number
  entryKey: string
  /**
   * ⚠️ zod 这里故意是 `z.string()`（rice.ts:86；上行侧才是枚举）——服务端将来加 kind 时
   * 老客户端照收不报 MALFORMED，值域闸在 DB CHECK。**别把它收窄成 RiceKind**。
   */
  kind: string
  delta: number
  dayKey: string
  at: string
  /** 键恒在（`.nullable()`）：null = 这条没有 ref */
  ref: Record<string, unknown> | null
  /** 服务端标记（'clock_skew' / 'fingerprint_reuse'，rice-rules.ts:29-30）：照收不拒，客户端据此提示而非改账 */
  flags: string[]
}

/**
 * GET /v1/rice/entries 200（rice.ts:81-96）。
 * 查询参数（rice.ts:76-79 `pullQuerySchema`）：since 缺省 0、limit 缺省与上限都是
 * RICE_PULL_LIMIT_MAX = 500（protocol.ts:299）。**空页时 nextSeq === since**（rice.ts:434
 * `rows.length > 0 ? 末条 seq : since`）——可重入的游标，不是 null。
 */
export interface RicePullResponse {
  entries: RiceLedgerEntry[]
  /** 下一页游标 = 本次返回的最大 seq；无新条目时原样回传 since（永不为 null） */
  nextSeq: number
  balance: number
}

/**
 * 挑战结算逐题事实（challenge.ts:51-62 `questionSchema`）。
 * ⚠️ 上行只有**事实**：ok / difficulty 是上报值，服务端按 §7.2 复核（取低）后唯一算分
 * （challenge.ts:244-255）——客户端从不上传分数。key 形状 `lesson:qid`（challenge.ts:53
 * 与 DB CHECK 同款正则），批内 key 必须互异（challenge.ts:227-230）。
 */
export interface ChallengeQuestionInput {
  key: string
  lessonId: string
  qid: string
  lang: Lang
  /** 0..MAX_STAGE=3（protocol.ts:136） */
  stage: number
  type: QuestionType
  difficulty: Difficulty
  source: 'local' | 'ai'
  ok: boolean
}

/**
 * POST /v1/challenge/days 请求体（challenge.ts:64-84 `settleBodySchema`）。
 * 幂等键 = submissionId + **整个 payload 的 sha256**（challenge.ts:151 + :257）——
 * 重试必须原样复用提交体，改任何一个字节都会变成"另一批"→ 409。
 * 结算窗口（challenge.ts:192-209）：dateKey ∈ [服务器日 − CHALLENGE_SETTLE_PAST_DAYS=30,
 * 服务器日 + DAY_KEY_WINDOW_DAYS=1]；超窗 400 + 审计 log（不静默收编）。
 */
export interface ChallengeSettleRequest {
  /** uuid；配合 payload hash 做幂等重放判定 */
  submissionId: string
  installId: string
  /** 本地日 YYYY-MM-DD；服务端还校验它是真实日期（challenge.ts:192-194） */
  dateKey: string
  source: 'local' | 'ai'
  /** 可选；给了必须 ≤ finishedAt（challenge.ts:234-242） */
  startedAt?: string
  finishedAt: string
  /** 1..CHALLENGE_RUN_MAX = 5000（健全性上界，非产品上限；protocol.ts:179） */
  questions: ChallengeQuestionInput[]
  /**
   * 挑战 v3 契约：开赛前勾选的语言（至少一门、四门内、无重复；protocol.ts:126）。
   * **可选**：缺省 = legacy 客户端，服务端从题批 lang 派生（challenge.ts:210-215）；
   * 显式 present 时空数组会被 zod 拒（400）。路由级 bodyLimit 2MiB（challenge.ts:180）。
   */
  pickedLangs?: PickableLang[]
}

/**
 * 渲染层 → 主进程的结算载荷：POST /v1/challenge/days 请求**减掉**
 * submissionId / installId —— 那两个字段跟着「这一次提交」与「这台设备」走
 * （submissionId 由主进程入队时现生成一次，installId 发送时现贴），
 * 队列与重试必须逐字节复用其余字段（幂等键 = submissionId + 提交体 sha256，
 * 见 main/cloud/pending-ops.ts 的文件头）。
 */
export type ChallengeSettlePayload = Omit<ChallengeSettleRequest, 'submissionId' | 'installId'>

/**
 * POST /v1/challenge/days 200（challenge.ts:86-95 `settleResponseSchema`），
 * 幂等重放（challenge.ts:150-168）与首次结算（challenge.ts:358-368）同形。
 * ⚠️ settled 是 `z.literal(true)`：200 即"已结算"，没有别的成功分支；idempotent 才是
 * "这次是重放"的判别位（重放返回库中值，不重复计分/加总）。
 */
export interface ChallengeSettleResponse {
  settled: true
  idempotent: boolean
  dateKey: string
  correct: number
  total: number
  /** 服务端算的分（§5；挑战 v3 起语言权重全 100，单题分只由难度定） */
  score: number
  /** 理论满分 Σ 难度分（含答错题）；不变式 score ≤ scoreMax（challenge.ts:246） */
  scoreMax: number
  /** 复核标记（当前唯一名字 'difficulty_downgraded'，scoring.ts:34；未知值照收） */
  flags: string[]
}

/** 榜面条目（leaderboard.ts:85-91 `entrySchema`） */
export interface LeaderboardEntry {
  rank: number
  username: string
  /** 头像 hash（sha256 hex）；null = 没设头像，客户端显示默认大肥鱼 */
  avatarHash: string | null
  score: number
  /** 榜期内有分的天数（score > 0 的日数；leaderboard.ts:353-366） */
  days: number
  /**
   * 该账号**榜期内挑战开赛前勾选过**的语言并集（challenge_days.picked_langs 口径，
   * leaderboard.ts:79-84 + :161-196），按 LANGS 声明序、**不含 'common'**；
   * 与请求的 lang/difficulty 过滤器无关（过滤器只改分数口径）。
   */
  langs: Lang[]
}

/**
 * GET /v1/leaderboard 200（leaderboard.ts:93-109 `responseSchema`）。
 * me 恒在（§4.5：本人名次不论是否 opt-in 都返回）；entries 只列 opt-in 且未封禁的
 * 账号，名次可能有洞（rank() 口径，leaderboard.ts:20-24）。periodKey 缺省口径：
 * daily = 刚结束的一天（服务器日 −1，leaderboard.ts:237-245）、weekly/monthly/yearly =
 * 服务器日所在周/月/年；alltime 不接受 periodKey（400，leaderboard.ts:233-236）。
 */
export interface LeaderboardResponse {
  period: LeaderboardPeriod
  /** alltime 恒 null；其余是已校验的键（daily=YYYY-MM-DD / weekly=YYYY-Www / monthly=YYYY-MM / yearly=YYYY） */
  periodKey: string | null
  /** 请求过滤器回显：显式 null 表示未过滤（不是缺省键；leaderboard.ts:417） */
  filter: { lang: Lang | null; difficulty: Difficulty | null }
  entries: LeaderboardEntry[]
  me: {
    /** null = 本人不在榜内（无分）；opt-in 只决定曝光，不影响名次 */
    rank: number | null
    /** 榜期分数；不在榜 = 0（leaderboard.ts:426-429） */
    score: number
    optedIn: boolean
    /** 该账号在 dateKey（缺省服务器北京日）当天的挑战分；无 = 0 */
    scoreToday: number
  }
  /** 快照的铸期（ISO）；null = 快照未生成（空榜，客户端显示空态；leaderboard.ts:302-308） */
  computedAt: string | null
  /**
   * keyset 分页游标 = base64(score:accountId)（protocol.ts:294；服务端用 base64url，
   * leaderboard-cursor.ts:16-18）；null = 没有下一页。回传时必须 encodeURIComponent
   * （base64 的 `+` 直接拼进 query 会被服务端读成空格）。
   */
  nextCursor: string | null
}

/** PUT /v1/me/leaderboard-opt-in 200（me.ts:182-200）——请求体 `{optIn:boolean}` 与响应同形；幂等（重复设同值也返回同值） */
export interface OptInResponse {
  optIn: boolean
}

/**
 * GET /v1/me/summary 200（me.ts:22-41 `summarySchema`；docs/26 §4.0「stats + 余额 + 名次，面板一屏」）。
 * 无 user_stats 行 → 统计全零 + lastActiveDay null；无 rice_balances 行 → 三零
 * （me.ts:156-173）——"没有行"与"零"在这里被服务端刻意塌成同一个读数。
 */
export interface MeSummaryResponse {
  stats: {
    learnedCount: number
    practicedCount: number
    streakDays: number
    /** 从未活跃 = null（不是 ''） */
    lastActiveDay: string | null
    totalScore: number
  }
  rice: {
    balance: number
    earnedTotal: number
    spentTotal: number
  }
  leaderboard: {
    /** 未封禁全部有分账号参与排序（opt-in 只是曝光开关）；无分 = null（me.ts:168-170） */
    rankAllTime: number | null
    scoreAllTime: number
    /** 按 ?dateKey=（±1 天容差）或服务器北京日查（me.ts:100-111） */
    scoreToday: number
    optedIn: boolean
  }
}

// ---------------------------------------------------------------- 账号激活与同步状态（P10.5，主进程 → 渲染层）
//
// 这一节的类型是 `cloud:state` / `cloud:activate` / `cloud:activate-preview` /
// `cloud:sync-now` 四条通道的形状。词汇真源在这里（main/cloud/account-flow.ts
// 的 ActivateMode/ActivateOutcome 是它的结构化同形）—— 通道名与 UI 都指着这一份，
// 免得「合并本机」「只用云端」在两个文件里各有一套拼写。

/**
 * 首激活的两种收编口径（docs/21 §8.4 / docs/22 拍板#7）：
 *   · 'merge-local' —— 把客人盒的档案与饭账并进账号盒（纯并集，客人盒不搬走）；
 *   · 'cloud-only'  —— 客人盒原样留着，账号盒只跟云端。
 * 已激活的账号重新登录**直达**同步，本字段被忽略（绝不重跑收编）。
 */
export type CloudAdoptMode = 'merge-local' | 'cloud-only'

/** `cloud:activate` 的入参；省略 adopt = 要求「已是激活账号的直达」 */
export interface CloudActivateInput {
  adopt?: CloudAdoptMode
}

/** `cloud:activate` 的成功视图 */
export interface CloudActivateView {
  /** 'adopted' = 本次跑完收编；'already' = 已激活直达（adopt 恒 null） */
  outcome: 'adopted' | 'already'
  /** 真正执行的收编口径；'already' 时恒 null */
  adopt: CloudAdoptMode | null
  /** 小写归一的账号 id */
  accountId: string
}

/**
 * `cloud:activate-preview` 的成功视图（首激活前的预览，P10.6 界面用）：
 * 云端四份文档全没有 ⇒ cloudEmpty:true（界面说「云端是新账号」），
 * 否则界面必须如实说「云端已有数据，合并还是覆盖」。网络失败走 CloudResult.failure。
 */
export interface CloudActivatePreviewView {
  cloudEmpty: boolean
}

/**
 * `cloud:state` 的成功视图（无需网络，纯本地事实）。
 * 【字段口径】signedIn = 本机有令牌（内存或 session.bin 注回）；
 * accountId = 登录账号（小写归一），未登录 null；username/avatarHash = 会话里缓存的
 * 资料（重启后不联网也能显示；null = 未登录或尚未读到）；activated = 该账号在本机
 * 已完成首激活（.sync/state.json 的 activatedAt 非空），未登录恒 false；
 * boxAccountId = 当前盒的账号（StoreBox.currentAccountId），null = 客人盒。
 * ⚠️ signedIn 且 !activated 是**正常中间态**（登录了但还没收编，盒仍停客人位）——
 * 界面要引导激活，不是报错（restoreOnStartup 的 needsActivation 同源）。
 */
export interface CloudAccountState {
  signedIn: boolean
  accountId: string | null
  /** 当前账号的用户名（登录/注册/会话探测/改名后由主进程写进 session.bin；null = 未登录或还没读到） */
  username: string | null
  /** 当前账号的头像 hash（同上；null = 没设头像，界面显示默认大肥鱼） */
  avatarHash: string | null
  activated: boolean
  boxAccountId: string | null
}

// ---------------------------------------------------------------- 用户资料（2026-10-22 用户系统批次）
//
// 头像的完整链路：主进程 dialog 选图 → 校验（后缀/大小/magic）→ 渲染层预览 +
// 居中裁成 256×256 PNG → IPC 回传字节 → 主进程 PUT /v1/avatar（image/png）→
// 服务端 sha256 内容寻址。读头像走 GET /v1/avatar/:hash（已登录即可，跨账号可读），
// 主进程转成 data URL 回渲染层 —— 渲染层不需要也不允许自己拿 token 发请求。

/** dialog 选图并校验后的成功视图（canceled 用 null 表示，不是错误） */
export interface AvatarPickView {
  /** `data:image/png;base64,...` 或 `data:image/jpeg;base64,...`（原图，供预览/裁剪） */
  dataUrl: string
  /** 用户选中的文件名（只用于界面显示，不参与任何路径拼接） */
  fileName: string
}

/** PUT /v1/avatar 的成功体 */
export interface AvatarUploadResponse {
  hash: string
}

/** 读头像的成功体（data URL；主进程内存缓存） */
export interface AvatarReadView {
  dataUrl: string
}

/**
 * 批量读头像的回话（2026-10-22 夜间自查补强）。
 *
 * 【为什么要分 images / dead 两桶】主进程知道每张图**为什么**没拿到，渲染层原先
 * 只拿到「缺了」，于是断网和 404 被当成同一件事：60s 后一律重试。永久 404 的
 * hash（榜上某人换了头像、旧快照行还挂着）会因此每 60 秒再打一轮，白烧账号的
 * 120 次/分钟额度。dead = 服务端明确说这张内容不存在（NOT_FOUND）—— 内容寻址
 * 的语义下它不会自己回来，渲染层记住后不再重试；其余失败（断网/超时/限流/
 * 未登录）仍走老路：进重试窗口，恢复后头像自己回来。
 */
export interface AvatarBatchView {
  images: Record<string, string>
  dead: string[]
}

// ---------------------------------------------------------------- 同步与上行结果（主进程 → 渲染层）
//
// 这两组类型**原先住在主进程模块**（main/cloud/sync-engine.ts 与 uplink.ts），
// P10.5 搬到这里：preload 的 import 面只许 shared/**（见 preload/index.ts 头部），
// `cloud:sync-now` 通道要给它结果类型，类型就得住在 shared。原模块原地
// re-export 同样的名字 —— 既有的 import 面（含全部测试）一个都没坏。

/** 一份文档被暂停（blocked）的原因（docs/21 §8.5 的闸门口径） */
export type SyncBlockReason = 'DOC_VER_TOO_NEW' | 'LOCAL_VER_TOO_NEW' | 'PAYLOAD_TOO_LARGE'

export interface SyncDocOutcome {
  docType: DocType
  status: 'synced' | 'unchanged' | 'blocked' | 'failed'
  /** status=blocked：为什么暂停这份文档 */
  blockReason?: SyncBlockReason
  /** status=failed：哪一类失败（CloudFailure.code 原样） */
  failureCode?: CloudFailureCode
}

export interface SyncRoundResult {
  /** 没登录（客人盒）—— 一个包都没发 */
  skipped: boolean
  /** skipped 的原因 */
  skipReason?: 'signed-out' | 'backoff'
  /** 退避窗口内返回：还有多久允许下一轮（毫秒） */
  retryAfterMs?: number
  /** 令牌已死（401）⇒ 渲染层回登录页；本地数据一律保留 */
  authInvalid: boolean
  /** 服务端协议下限高于本机（426）⇒ 全量停同步 + 升级提示 */
  protocolBlocked: boolean
  /** 本轮真的写了盘的文档（渲染层据此重载对应 store） */
  changedDocs: DocType[]
  /** 逐文档结局（只含本轮真正处理到的文档） */
  docs: SyncDocOutcome[]
  /** 轮末仍未推上去的文档（failed/blocked；徽章显示用） */
  pendingPush: DocType[]
  /**
   * V1-65：本轮被用户取消（sync-engine 的 cancel()）。取消在**文档之间**生效 ——
   * 正在飞的那次请求由它自己的 10s 超时闸收束（不打断），之后的文档一份都不再发。
   * 被取消的轮：不落同步状态（pendingPush/blocked 保持上次的完整结论）、
   * 不动退避档位（取消是用户意志，不是网络失败）。
   */
  canceled?: boolean
  /** 本轮时刻（ISO） */
  at: string
}

/** 上行一趟里一次失败的定位（phase 标出发生在哪一段） */
export interface UplinkFailure {
  phase: 'push' | 'pull' | 'settle' | 'stale'
  code: CloudFailureCode | 'STALE_EPOCH'
  message: string
}

export interface UplinkResult {
  /** 没登录（客人盒）—— 一个包都没发 */
  skipped: boolean
  skipReason?: 'signed-out'
  /** 令牌已死 ⇒ 渲染层回登录页；本地数据一律保留 */
  authInvalid: boolean
  /** 本轮被服务端确认入云的条数（含幂等重放） */
  ricePushed: number
  /** 本轮被服务端逐条拒收的条数（本地保留、标 'rejected'） */
  riceRejected: number
  /** 本轮下行并入的新条目数 */
  ricePulled: number
  /** 本轮成功结算的天数（含幂等重放） */
  settlesSent: number
  /** 本轮发现「已被别的设备结算过」（409）而移除的天数 */
  settlesDropped: number
  failures: UplinkFailure[]
  /** 服务端 429 回的等待建议（有就给渲染层的下次触发用） */
  retryAfterMs?: number
  at: string
}
