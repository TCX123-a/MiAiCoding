/**
 * 云模块导出面（P10.3 第一步）—— 主进程里 import 云功能只认这一个口。
 *
 * 【收口的理由】IPC 接线（main/app.ts）与将来的一切调用方都要正好拿到
 * 「该拿的那几件」。逐个点名导出（而不是 `export *`）：加一个新文件时
 * 必须在这里也被点名，导出面天然是白名单 —— 免得某个内部件（比如
 * 未定型的测试钩子）跟着星号漏出去。渲染层从来不许 import 本目录
 * （它只经 preload 的 miai.cloud 说话）。
 */
export {
  createCloudAccountClient,
  createMemoryTokenStore,
  type CloudAccountClient,
  type CloudAccountDeps,
  type TokenStore
} from './account'

export {
  createCloudDocsClient,
  type CloudDocsClient,
  type CloudDocsDeps
} from './docs'

// 头像（2026-10-22 用户系统批次）：二进制上传/读取客户端 + 选图本地校验
export {
  createCloudAvatarClient,
  type CloudAvatarClient,
  type CloudAvatarDeps
} from './avatar'

export {
  AVATAR_PICK_MAX_BYTES,
  detectAvatarImageKind,
  readAvatarPick,
  type AvatarFileKind
} from './avatar-file'

// P10.1 第 11 项：L5 云提供方收口 —— 同步引擎（P10.3）只认这一个接口/工厂，
// 不直接摸上面的 account/docs 客户端。真实现是纯组装（零网络原语）。
export {
  createApiProvider,
  type CloudApiProviderDeps
} from './provider-impl'

export type { ApiProvider } from './provider'

export {
  CLOUD_TIMEOUT_MS,
  cloudFail,
  cloudOk,
  createTransport,
  NOT_MODIFIED,
  redactTokens,
  statusToCode,
  type NotModified,
  type CloudLogEvent,
  type CloudLogger,
  type CloudRequestSpec,
  type CloudTransport,
  type CloudTransportDeps,
  type FetchLike,
  type HttpResponseLike
} from './transport'

export {
  BASE_URL_ENV_VAR,
  DEV_DEFAULT_BASE_URL,
  PROD_DEFAULT_BASE_URL,
  resolveCloudBaseUrl
} from './base-url'

// P10.x 上行接线：流水推/拉客户端、账本文件、结算队列、上行 runner
export { createCloudRiceClient, type CloudRiceClient, type CloudRiceDeps } from './rice'

export {
  createCloudChallengeClient,
  type CloudChallengeClient,
  type CloudChallengeDeps
} from './challenge'

// P10.6 榜面读口 + opt-in 写口（榜单/我的名次/曝光开关，见 leaderboard.ts）
export {
  createCloudLeaderboardClient,
  type CloudLeaderboardClient,
  type CloudLeaderboardDeps
} from './leaderboard'

export { createRiceJournal, type RiceJournal, type RiceJournalDeps } from './rice-journal'

export {
  addSettle,
  createPendingOpsStore,
  parseSettlePayload,
  type PendingOpsStore,
  type PendingSettleOp,
  type SettlePayload
} from './pending-ops'

// UplinkResult 的类型导出在下方 dto 一块（真源在 shared/cloud/dto.ts，
// 这里从 ./uplink 再导一次会与 dto 块重名 —— 一个名字一条路）
export { createUplink, type Uplink, type UplinkDeps } from './uplink'

// P10.5 账号通道：同步引擎、收编装配、磁盘 TokenStore、启动扫描
export {
  createSyncEngine,
  DOC_VERSIONS,
  normalizeDoc,
  rawVersionOf,
  type DocMerger,
  type SyncEngine,
  type SyncEngineDeps
} from './sync-engine'

export { CLOUD_DOC_MERGERS } from './mergers'

export { DRAIN_CAP_MS, drainWithCap } from './drain'

export {
  createSessionTokenStore,
  type SessionTokenStore,
  type SessionTokenStoreDeps
} from './session-store'

export {
  parseSessionPlaintext,
  scanSessionFiles,
  type SafeStorageLike,
  type SessionScanResult,
  type StoredSession
} from './session'

export {
  AccountFlowError,
  accountDirOf,
  activateAccount,
  isAccountActivated,
  leaveToGuest,
  logoutLocal,
  restoreOnStartup,
  type AccountFlowDeps,
  type ActivateMode,
  type ActivateOutcome,
  type StartupRestoreResult
} from './account-flow'

export type {
  Account,
  AuthResponse,
  AvatarBatchView,
  AvatarPickView,
  AvatarReadView,
  AvatarUploadResponse,
  CloudAccountState,
  CloudActivateInput,
  CloudActivatePreviewView,
  CloudActivateView,
  CloudAdoptMode,
  CloudAuthView,
  CloudCredentials,
  CloudDocView,
  CloudFailure,
  CloudFailureCode,
  CloudRegisterInput,
  CloudResult,
  CloudSessionView,
  ClientFailureCode,
  DocsSummary,
  DocSummary,
  ErrorBody,
  GetDocResponse,
  LoginRequest,
  PutDocRequest,
  PutDocResponse,
  RecoverQuestionRequest,
  RecoverQuestionResponse,
  RecoverResetRequest,
  RecoverResetResponse,
  RecoverVerifyRequest,
  RecoverVerifyResponse,
  RegisterRequest,
  SessionResponse,
  SyncBlockReason,
  SyncDocOutcome,
  SyncRoundResult,
  UplinkFailure,
  UplinkResult
} from '../../shared/cloud/dto'

export { CLIENT_FAILURE_CODES } from '../../shared/cloud/dto'
