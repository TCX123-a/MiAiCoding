/**
 * StoreBox（P10.1）：**账号分区**的目录路由 —— 所有「跟人走」的数据文件的落脚点。
 *
 * 【盒子是什么】每个账号一份完整的档案目录。登出回到「客人盒」——
 * 也就是**现在的数据目录本身**（`storageDir()` 根）。这一条是刻意的：
 * 客人档案（老用户升级前攒的全部数据）**一个字节都不搬** ——
 * 「本机（客人）档案在任何路径下都不移动、不删除」是收编语义的红线，
 * 物理上不动它，就是这条红线最便宜的落实方式。
 * 账号盒落在 `<base>/accounts/<accountId>/`。
 *
 * 【epoch 是干什么的】盒可以在运行时切换（登录/登出/切换账号），而渲染层的
 * 一次保存请求（IPC 往返）可能在切换**之后**才到达主进程 —— 不设防的话，
 * A 账号界面里攒的一次保存会写进 B 账号的盒（或者客人盒）。
 * epoch 是**屏障**：switchTo 一律 +1；写口拿着请求发起时的 epoch 来比对，
 * 对不上就拒（StaleEpochError），由上层决定重放还是丢弃。
 *
 * 【为什么 switchTo 到同一个账号也 +1】「一律」比「变了才加」多一层保险：
 * 重登同一个账号也会让在途的旧请求作废 —— 那种请求依据的会话/同步状态
 * 可能已经作废（令牌轮换、干涸协议重跑），让它们作废是保守方向。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律英文**，中文只出现在注释里。
 */
import { join } from 'path'
import { assertSafeAccountId } from './account-id'

/**
 * 拿到手的盒已经不是当初那一个（epoch 对不上）。
 *
 * 刻意做成**具名错误类**而不是普通 Error：调用方（IPC handler）要能
 * `instanceof` 地把它和「磁盘写失败」分开处置 —— 前者是「这次写不该发生」，
 * 后者是「写不进去」，混成一个错误类别的话，在途请求撞上切换会被当成
 * IO 故障重试，而重试只会一次次撞在同一条屏障上。
 */
export class StaleEpochError extends Error {
  constructor(expected: number, actual: number) {
    super(`stale epoch: write was stamped ${expected}, box is now at ${actual}`)
    this.name = 'StaleEpochError'
  }
}

/**
 * 同盒之内，写所依据的版本已经过期（磁盘被别的写口动过之后又拿旧 rev 来写）。
 *
 * 【为什么 rev 必须拒（P10.1 只记、P10.3 起消费）】rev 的用途是「让写者
 * 察觉手里的快照旧了」。只记不拒的话，旧快照照样整份覆盖 —— 同步引擎刚
 * 并进来的数据会被一次基于旧快照的保存吞掉，而两处都不报错。拒掉之后
 * 调用方的正路是**重载 + 重放**（docs/21 §8.2 本地写协议三件套之二）。
 * 与 StaleEpochError 分开是刻意的：一个是「位置错了」（切了盒）、一个是
 * 「版本旧了」（同盒但落伍），处置都是重载，但日志与判据里分得清。
 */
export class StaleRevError extends Error {
  constructor(expected: number, actual: number) {
    super(`stale rev: write was based on rev ${expected}, file is now at rev ${actual}`)
    this.name = 'StaleRevError'
  }
}

/**
 * 条件写的最小缝（P10.6 起**真源在 shared/doc-write.ts**：它要过 IPC、
 * 渲染层要保管它 —— 这里只 re-export，老 import 面一个都不动）。
 * 语义：`epoch` 与 `rev` 都**必校**（rev 的完整消费者从 P10.3 起）。
 */
export type { BoxStamp } from '../../shared/doc-write'

export interface StoreBox {
  /** 当前盒的目录（**现读**，不是创建时快照）—— 拼文件路径之前先过这里 */
  currentDir(): string
  /** 当前账号 id；null = 客人盒 */
  currentAccountId(): string | null
  /** 当前屏障号 */
  epoch(): number
  /**
   * 切换盒。`null` = 客人盒。accountId 先过 `assertSafeAccountId`
   * （白名单 + 小写归一）再落定 —— 校验不通过就抛，**且什么都不改**。
   */
  switchTo(accountId: string | null): void
}

export function createStoreBox(baseDir: string): StoreBox {
  let accountId: string | null = null
  let epoch = 0

  return {
    // 客人盒 = baseDir 本身（见文件头：老档案不搬家）
    currentDir: () => (accountId === null ? baseDir : join(baseDir, 'accounts', accountId)),
    currentAccountId: () => accountId,
    epoch: () => epoch,
    switchTo(next: string | null): void {
      // 先校验后落定：`assertSafeAccountId` 抛的话，上面两个变量原样不动
      const normalized = next === null ? null : assertSafeAccountId(next)
      accountId = normalized
      epoch++ // 一律 +1，包括"切到同一个"（见文件头）
    }
  }
}
