/**
 * 磁盘 TokenStore（P10.5）—— 把 account.ts 的端口接到 session.bin 上。
 *
 * 【它是什么】`createMemoryTokenStore` 的落盘兄弟：同一套 `get/set` 端口语义，
 * 但 set 会把完整会话（safeStorage 加密后）写进 `accounts/<sub>/session.bin`，
 * 外加两个只有落盘实现才有的口：
 *   · `hydrate(session)` —— 启动扫描（scanSessionFiles）判定 active 后把
 *     会话注回内存（**不动磁盘**：文件本来就在，这次只是读）；
 *   · `current()` —— 当前内存里的完整会话（含 sub/expiresAt），给激活流程
 *     （account-flow.ts）用；`get()` 依旧只回 token 串（端口契约）。
 *
 * 【「至多一份 session.bin」不变式靠谁守】session.ts 的扫描规则 5：发现 ≥2 份
 * 就把全部作废（防串号）。所以**本实现的换账号写必须先把旧 sub 的文件清掉**，
 * 再写新的 —— 否则登录 B 时会短暂存在 A、B 两份，下一次启动扫描把两份全删，
 * 用户「莫名其妙被登出」。清旧文件是尽力而为（clearSessionFile 自己吞删除失败），
 * 顺序是「先清旧、后写新」：中途崩了，最坏是 0 份（= 重新登录），不是 2 份。
 *
 * 【哪些失败只降级、不抛】
 *   · sub 不是 canonical UUID（服务端坏 id、版本漂移）：**只进内存** —— 不写、
 *     不清、不抛。登录刚成功就被一个 id 形状炸掉是最坏的失败方式；判不了落哪
 *     就不落，令牌还在内存里，本次运行照常可用（退出即失，同加密不可用款）；
 *   · safeStorage 不可用 / 写盘失败：writeSessionFile 自己回 false 并告警，
 *     这里同样只降级到内存 + 一行 warn（docs/22 §5.1：绝不落明文）；
 *   · 写口入参校验抛（TypeError）：catch 住同款降级。它只会在服务端回了
 *     形状对（过了 account.ts 的解析）但语义空的值（如 expiresAt: ''）时响，
 *     同样不许把一次成功登录变成异常。
 *
 * 【凭据纪律】token / 明文绝不进 console、绝不进异常信息（同 transport.ts 红线）。
 * 本文件的告警只有固定英文文案，连 sub 都不带。
 *
 * ⚠️ 本文件在 `src/main/cloud/**`（零网络闸门扫描面）：只用 fs，不碰任何网络原语。
 */
import { isCanonicalUuid } from '../store/account-id'
import type { TokenRecord, TokenStore } from './account'
import { clearSessionFile, writeSessionFile, type SafeStorageLike, type StoredSession } from './session'

/** 落盘 TokenStore：端口 + 启动注入口 + 完整会话读口 */
export interface SessionTokenStore extends TokenStore {
  /** 启动扫描判定 active 后把会话注回内存（不写盘） */
  hydrate(session: StoredSession): void
  /** 当前内存里的完整会话；null = 未登录 */
  current(): StoredSession | null
  /** 本实现恒有（TokenStore 上是可选口，磁盘实现必须提供） */
  updateProfile(patch: { username?: string; avatarHash?: string | null }): void
  /** 本实现恒有：给 session 探测做「只补缺」的合并依据 */
  currentProfile(): { username?: string; avatarHash?: string | null } | null
}

export interface SessionTokenStoreDeps {
  /** 存储根目录（= StoreBox 的 baseDir；session.bin 落在 <baseDir>/accounts/<sub>/） */
  baseDir: string
  /** Electron safeStorage（真实现由 app.ts 从 electron 传进来） */
  safe: SafeStorageLike
  /** issuedAt 的时间源（注入缝，测试用） */
  now?: () => string
  /** 降级告警出口（默认 console.warn；只收固定英文文案） */
  log?: (message: string) => void
}

export function createSessionTokenStore(deps: SessionTokenStoreDeps): SessionTokenStore {
  const now = deps.now ?? ((): string => new Date().toISOString())
  const log = deps.log ?? ((message: string): void => console.warn(message))

  /** 当前内存会话。set 一律先落这里再尝试磁盘 —— 磁盘失败时内存态已经是对的 */
  let current: StoredSession | null = null

  /** 尽力清掉某个 sub 的落盘会话；sub 判不了（非 canonical）就什么都不做 */
  function clearDisk(sub: string): void {
    if (!isCanonicalUuid(sub)) return
    try {
      clearSessionFile(deps.baseDir, sub)
    } catch {
      // clearSessionFile 内部已吞 rm 失败、只对坏 accountId 抛 —— 走到这里
      // 说明 isCanonicalUuid 与 assertSafeAccountId 口径起了分歧（不该发生），
      // 依旧不许把登出/换账号炸掉：告警后按「清不掉」继续
      log('[miai] session store: skipped clearing an unrecognized account session')
    }
  }

  return {
    get: () => current?.token ?? null,

    current: () => current,

    currentProfile: () =>
      current === null ? null : { username: current.username, avatarHash: current.avatarHash },

    hydrate(session: StoredSession): void {
      current = session
    },

    set(next: TokenRecord | null): void {
      const prev = current

      if (next === null) {
        current = null
        if (prev !== null) clearDisk(prev.sub)
        return
      }

      // 换账号（大小写归一后不同）：先清旧、后写新 —— 两处顺序都是规格（见文件头）
      if (prev !== null && prev.sub.toLowerCase() !== next.sub.toLowerCase()) {
        clearDisk(prev.sub)
      }

      const stored: StoredSession = {
        v: 1,
        sub: next.sub,
        token: next.token,
        // issuedAt 是「这份落盘是什么时候写的」：现盖，不用服务端的任何时刻
        issuedAt: now(),
        expiresAt: next.expiresAt
      }
      // 资料快照（2026-10-22）：有就带上；undefined = 这个客户端不认识该字段，不写
      if (typeof next.username === 'string' && next.username !== '') stored.username = next.username
      if (next.avatarHash === null || (typeof next.avatarHash === 'string' && next.avatarHash !== '')) {
        stored.avatarHash = next.avatarHash
      }
      current = stored

      // 落哪判不了（非 canonical sub）：只进内存（见文件头）。不写不清不抛。
      if (!isCanonicalUuid(next.sub)) {
        log('[miai] session store: unrecognized account id shape; token kept in memory only')
        return
      }

      try {
        if (!writeSessionFile(deps.baseDir, stored, deps.safe)) {
          // false = 加密不可用或写盘失败（session.ts 已按「绝不落明文」处理）
          log('[miai] session store: session file not persisted; token kept in memory only')
        }
      } catch {
        // 写口的入参校验抛（语义空的 expiresAt 等）：同为降级，不炸登录
        log('[miai] session store: session file rejected; token kept in memory only')
      }
    },

    /**
     * 资料快照更新（2026-10-22）：只改 username/avatarHash，token/sub/expiresAt 原样。
     * 先改内存（界面立刻拿到新值），再尽力重写 session.bin ——
     * 写盘失败（加密不可用/权限）只降级为「本次运行有效」，与 set 同款口径。
     * issuedAt 保持登录时那次写入的时刻：它是会话的元数据，不随资料刷新而改。
     */
    updateProfile(patch: { username?: string; avatarHash?: string | null }): void {
      if (current === null) return
      const next: StoredSession = { ...current }
      if (typeof patch.username === 'string' && patch.username !== '') next.username = patch.username
      if (patch.avatarHash === null) next.avatarHash = null
      else if (typeof patch.avatarHash === 'string' && patch.avatarHash !== '') {
        next.avatarHash = patch.avatarHash
      }
      current = next

      if (!isCanonicalUuid(next.sub)) return
      try {
        if (!writeSessionFile(deps.baseDir, next, deps.safe)) {
          log('[miai] session store: profile snapshot not persisted; kept in memory only')
        }
      } catch {
        log('[miai] session store: profile snapshot rejected; kept in memory only')
      }
    }
  }
}
