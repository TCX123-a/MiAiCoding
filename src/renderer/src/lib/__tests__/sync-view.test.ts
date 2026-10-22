/**
 * 手动同步结局判定（lib/sync-view.ts）的单测（P10.6）。
 *
 * 【在守什么】「按了立即同步，toast 该说什么」全压在这一个函数上：
 *   · 新的一轮真的落进 lastRound → done；
 *   · 跑了个 skipped 轮 → skipped（它是真回话，但一个包都没发，
 *     报「同步好啦」是假成功）；
 *   · await 期间 lastRound 纹丝不动（IPC 抛了 / 节拍器没启动）→ none
 *     （报成功就是骗用户，还会让他以为已同步而不去重试）。
 *
 * 【为什么单独钉「at 相同但对象不同」这一条】判据的正确实现是**引用比较**；
 * 退化成「比 at 时间戳」也能跑绿常规场景，只在同一毫秒两轮时把真跑成的轮
 * 误报成没跑成 —— 下面那条用例就是给这种退化准备的。
 */
import { describe, expect, it } from 'vitest'
import { manualSyncOutcome } from '../sync-view'
import type { SyncRoundResult } from '../../../../shared/cloud/dto'

function round(patch: Partial<SyncRoundResult> = {}): SyncRoundResult {
  return {
    skipped: false,
    authInvalid: false,
    protocolBlocked: false,
    changedDocs: [],
    docs: [],
    pendingPush: [],
    at: '2026-10-11T00:00:00.000Z',
    ...patch
  }
}

describe('manualSyncOutcome（P10.6）', () => {
  it('新的一轮落进 lastRound → done', () => {
    const before = round({ at: '2026-10-11T10:00:00.000Z' })
    const after = round({ at: '2026-10-11T10:00:05.000Z' })
    expect(manualSyncOutcome(before, after)).toBe('done')
  })

  it('at 一模一样、但对象是新的（同一毫秒两轮）→ 仍算 done —— 判据不许退化成比时间戳', () => {
    const at = '2026-10-11T10:00:00.000Z'
    expect(manualSyncOutcome(round({ at }), round({ at }))).toBe('done')
  })

  it('skipped 轮（退避等）→ skipped，不许报成同步成功', () => {
    expect(manualSyncOutcome(null, round({ skipped: true, skipReason: 'backoff' }))).toBe('skipped')
  })

  it('引用纹丝不动 / 两次都是 null → none（IPC 抛了、节拍器没启动）', () => {
    const same = round()
    expect(manualSyncOutcome(same, same)).toBe('none')
    expect(manualSyncOutcome(null, null)).toBe('none')
  })
})
