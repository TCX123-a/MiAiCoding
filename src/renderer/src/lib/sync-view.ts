/**
 * 手动「立即同步」的结局判定（P10.6 账号页）：把「这一轮到底跑没跑」从
 * cloud-sync store 的两次快照里读出来 —— 按钮点下去的 toast 说什么，全看它。
 *
 * 【为什么用对象引用比较，而不是比时间戳】`lastRound` 每轮被 applyResults
 * 赋成 IPC 回话里**新克隆的对象**；而 `at` 是主进程在轮首盖的毫秒时间戳 ——
 * 同一毫秒内两轮会撞出相同的 `at`，「时间戳没变」就成了假阴性：真跑成的一轮
 * 被报成「没同步上」（好消息被吞的那种坏法，还会骗用户去重试）。
 * 引用相等则严格等价于「await 期间没有任何一轮落进 lastRound」——
 * IPC 抛了、节拍器没启动、在飞被停闸，都可能让引用纹丝不动，那时说
 * 「没跑成」才是诚实的。
 *
 * 【skipped 为什么单独一档】停闸/退避的轮次也是真实回话（`at` 会更新），
 * 但它一个包都没发 —— 对它说「同步好啦」是假成功，说「没同步上」又冤枉了
 * 主进程（它按规矩跳的）。单独报「跳过了」再加一句为什么，才是事实。
 *
 * ⚠️ 本文件在 `src/renderer/src` 下、被文案闸门扫，**字符串一律英文**。
 */
import type { SyncRoundResult } from '../../../shared/cloud/dto'

export type ManualSyncOutcome = 'done' | 'skipped' | 'none'

/**
 * @param before 按下按钮**之前**的 `cloudSync.lastRound`（原样传入，别先解构）
 * @param after  await trigger(...) 之后现取的 `cloudSync.lastRound`
 */
export function manualSyncOutcome(
  before: SyncRoundResult | null,
  after: SyncRoundResult | null
): ManualSyncOutcome {
  if (after === null || after === before) return 'none'
  return after.skipped ? 'skipped' : 'done'
}
