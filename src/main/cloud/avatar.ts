/**
 * 头像客户端（2026-10-22 用户系统批次）—— 主进程侧唯一碰头像字节的地方。
 *
 * 【为什么单独一个客户端】头像有两条与 JSON 通道不同的规则：
 *   · PUT 的体是**原始 PNG 字节**（transport.requestBytes / bodyBytes）；
 *   · GET 的响应是**二进制**，不能走 text() + JSON.parse。
 * 其余一切（超时 10s、GET 2 次 / PUT 1 次重试、错误码映射、Authorization 纪律）
 * 全部复用 transport 的同一条执行路径，不另写一套。
 *
 * 【缓存】GET 结果按 hash 缓存在内存（data URL），上限 MAX_CACHE_ENTRIES。
 * hash 是内容寻址的，同一 hash 的字节永不改变 —— 缓存无需失效。
 * 只存内存：重启后重新拉；断网时渲染层落到默认大肥鱼头像。
 *
 * 【校验】上传前再验一遍 PNG magic 与体积（渲染层裁剪/校验不是信任边界）；
 * 服务端回的 hash 与本地 sha256 对拍，不一致按 MALFORMED_RESPONSE —— 一个
 * 对不上的 hash 会让用户看到别人的头像，宁可当失败，也不把错值写进会话。
 *
 * ⚠️ 本文件在 `src/main/cloud/**`（零网络闸门扫描面）：网络只能经 transport。
 */
import { createHash } from 'node:crypto'

import type {
  AvatarReadView,
  AvatarUploadResponse,
  CloudResult
} from '../../shared/cloud/dto'
import {
  AVATAR_HASH_RE,
  AVATAR_MAX_BYTES
} from '../../shared/cloud/protocol'
import type { CloudLogger, FetchLike } from './transport'
import { cloudFail, cloudOk, createTransport } from './transport'
import type { TokenStore } from './account'

/** PNG 签名（RFC 2083 §3.1） */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

/** 内存缓存条数上限：50 人榜 × 多页 ≈ 数百；256 条 × ≤512KB 的最坏占用可控 */
const MAX_CACHE_ENTRIES = 256

export interface CloudAvatarDeps {
  baseUrl: string
  fetch: FetchLike
  timeoutMs?: number
  logger?: CloudLogger
  sleep?: (ms: number) => Promise<void>
  /** 与账号客户端共用同一个 TokenStore（令牌只住主进程） */
  tokens: TokenStore
}

export interface CloudAvatarClient {
  upload(png: Uint8Array): Promise<CloudResult<AvatarUploadResponse>>
  read(hash: string): Promise<CloudResult<AvatarReadView>>
}

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_MAGIC.length) return false
  for (let i = 0; i < PNG_MAGIC.length; i += 1) {
    if (bytes[i] !== PNG_MAGIC[i]) return false
  }
  return true
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function createCloudAvatarClient(deps: CloudAvatarDeps): CloudAvatarClient {
  const transport = createTransport({
    baseUrl: deps.baseUrl,
    fetch: deps.fetch,
    timeoutMs: deps.timeoutMs,
    logger: deps.logger,
    sleep: deps.sleep
  })

  /** hash → data URL（Map 保持插入序，超限时删最早一条 = 简易 LRU） */
  const cache = new Map<string, string>()

  function remember(hash: string, dataUrl: string): void {
    cache.delete(hash)
    cache.set(hash, dataUrl)
    while (cache.size > MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }

  return {
    async upload(png: Uint8Array): Promise<CloudResult<AvatarUploadResponse>> {
      const token = deps.tokens.get()
      if (token === null) return cloudFail('UNAUTHENTICATED', 'not signed in')
      if (png.length === 0) {
        return cloudFail('UNSUPPORTED_MEDIA_TYPE', 'avatar must not be empty')
      }
      if (png.length > AVATAR_MAX_BYTES) {
        return cloudFail('PAYLOAD_TOO_LARGE', `avatar must be at most ${AVATAR_MAX_BYTES} bytes`)
      }
      if (!isPng(png)) {
        return cloudFail('UNSUPPORTED_MEDIA_TYPE', 'avatar must be a PNG')
      }

      const result = await transport.request({
        method: 'PUT',
        path: '/v1/avatar',
        bodyBytes: png,
        contentType: 'image/png',
        token
      })
      if (!result.ok) return result

      const hash = isRecord(result.data) ? result.data['hash'] : undefined
      if (typeof hash !== 'string' || !AVATAR_HASH_RE.test(hash)) {
        return cloudFail('MALFORMED_RESPONSE', 'unexpected avatar upload response')
      }
      if (hash !== sha256Hex(png)) {
        // 服务端算出的内容地址与本地不一致：不把错 hash 交给会话/界面
        return cloudFail('MALFORMED_RESPONSE', 'avatar hash does not match uploaded bytes')
      }
      // 新上传的字节就是当前头像：顺手放进缓存，省一次往返
      remember(hash, `data:image/png;base64,${Buffer.from(png).toString('base64')}`)
      // 会话里的资料快照同步跟上（写盘失败由 TokenStore 自己降级到内存）
      deps.tokens.updateProfile?.({ avatarHash: hash })
      return cloudOk({ hash })
    },

    async read(hash: string): Promise<CloudResult<AvatarReadView>> {
      if (!AVATAR_HASH_RE.test(hash)) return cloudFail('NOT_FOUND', 'no avatar for this hash')
      const cached = cache.get(hash)
      if (cached !== undefined) {
        remember(hash, cached)
        return cloudOk({ dataUrl: cached })
      }

      const token = deps.tokens.get()
      if (token === null) return cloudFail('UNAUTHENTICATED', 'not signed in')

      const result = await transport.requestBytes({
        method: 'GET',
        path: `/v1/avatar/${hash}`,
        token
      })
      if (!result.ok) return result
      if (!isPng(result.data.bytes)) {
        return cloudFail('MALFORMED_RESPONSE', 'avatar response is not a PNG')
      }
      /*
       * 读口也要对拍 hash（2026-10-22 夜间自查）：内容寻址的全部意义是
       * 「URL 里的 hash 就是字节的指纹」。只在写口对拍的话，服务端回错一张
       * 图（缓存串号、发版 bug）就会被当成这个人的头像显示出去 —— 和上传时
       * 防的是同一件事，不能只防一半。
       */
      if (sha256Hex(result.data.bytes) !== hash) {
        return cloudFail('MALFORMED_RESPONSE', 'avatar bytes do not match hash')
      }
      const dataUrl = `data:image/png;base64,${Buffer.from(result.data.bytes).toString('base64')}`
      remember(hash, dataUrl)
      return cloudOk({ dataUrl })
    }
  }
}
