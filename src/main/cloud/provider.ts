/**
 * 云提供方接口桩（P10.1 第 11 项）—— L5 云适配层的收口。
 *
 * 【收口是什么】P10.3 的同步引擎（以及更远的一切联网功能）只依赖这一个接口，
 * **不直接摸 transport / account / docs 客户端** —— 换实现（真联网 / 测试假件 /
 * 将来的离线包装）不动调用方一行。方法名与签名是三层客户端语义的并集：
 * 四条认证调用 + 三条文档调用，一个不多一个不少。
 *
 * 【401 语义（单令牌定稿）】任何调用返回 UNAUTHENTICATED / TOKEN_EXPIRED
 * 即「令牌已死」⇒ 调用方把它当**未授权 → 重新登录**；
 * **没有 refresh 状态机、不做自动续期**。这是主人拍板的口径，改这里之前先问。
 *
 * 【命名注记】docs/22 §7.1 第 11 项草案里叫 `ApiResult`；落地沿用 P10.3 已有的
 * `CloudResult`（失败即值那套，先例见 shared/cloud/dto.ts）——不另起平行类型，
 * 草案 → 落地的这处差异记录在案（docs/22 修订时以此为准）。
 *
 * 【返回形状】失败即值（CloudResult），网络/协议类失败绝不抛；只有
 * 「我们自己传错参数」（docType 不在枚举、docVer 与 payload.version 不一致）
 * 才抛 TypeError —— 同 docs 客户端的先例，由 provider-impl 原样透传。
 *
 * 【零网络原语】本文件与 provider-impl.ts 同规格：没有任何发起请求的能力，
 * 被 `src/main/cloud/**` 的零网络闸门整目录扫（白名单之外多一行必红）。
 * 一切请求经 provider-impl 的注入缝（转交 account / docs 客户端）出去；
 * 本文件是**纯类型**，连实现都没有。
 */
import type { DocType } from '../../shared/cloud/protocol'
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
} from '../../shared/cloud/dto'

export interface ApiProvider {
  /**
   * POST /v1/auth/register（201）。成功后令牌已进 TokenStore —— 视图里没有它。
   * 入参是 CloudRegisterInput（2026-10-13 起注册必带一问一答）而不是
   * CloudCredentials —— 这两个形状不同是**故意**的：登录只要账号密码，
   * 注册还要安全问题，混用一个类型会让"注册少带问答"在编译期溜过去。
   */
  register(input: CloudRegisterInput): Promise<CloudResult<CloudAuthView>>
  /** POST /v1/auth/login（200）。同上：令牌只落 TokenStore，不随结果上行 */
  login(input: CloudCredentials): Promise<CloudResult<CloudAuthView>>
  /**
   * POST /v1/auth/logout（204，幂等）。本地没令牌时一个包都不发、直接 ok(null)
   *（同 account 客户端口径）；有令牌但失败则**保留令牌** —— 网络抖一下 ≠ 要登出。
   */
  logout(): Promise<CloudResult<null>>
  /** GET /v1/auth/session。`ok(null)` = 未登录（本地没令牌，或服务端判定令牌已死） */
  session(): Promise<CloudResult<CloudSessionView | null>>
  /** GET /v1/docs —— 四份摘要（不含 payload）；没令牌时不发包，回 UNAUTHENTICATED */
  listDocs(): Promise<CloudResult<DocsSummary>>
  /**
   * GET /v1/docs/:docType。传 `ifNoneMatchRevision`（= 你手上那份的 revision）走条件 GET：
   * 没变回 `{notModified:true}`（服务端 304，**没有 payload**，用你本地那份）；变了回完整文档。
   */
  getDoc(docType: DocType, opts?: { ifNoneMatchRevision?: number }): Promise<CloudResult<CloudDocView>>
  /** PUT /v1/docs/:docType —— 条件写（CAS）。`baseRevision: null` = 首次推送 */
  putDoc(docType: DocType, input: PutDocRequest): Promise<CloudResult<PutDocResponse>>
}
