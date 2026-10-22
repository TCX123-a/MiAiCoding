/**
 * 云同步节拍器（stores/cloud-sync.ts）的单测（P10.6）。
 *
 * 【这个文件在守什么 —— 它是最容易"看起来在工作"的那种模块】
 *   ① **去重**：在飞时来的触发只许合并成"跑完补一轮"，绝不并发两轮、
 *      也绝不丢触发（丢了 = 那次本地写永远同步不上去）；
 *   ② **停闸**：客人盒 / 令牌已死 / 协议被拒 —— 跑了也没用的轮次不发 IPC；
 *      令牌重新登进来时 authInvalid 闸要能打开（否则"重登之后同步死了"）；
 *   ③ **协调器**：只重载 changedDocs 点名的那几份 store（多载 = 白读盘，
 *      少载 = 界面上是云端数据的旧影子）；
 *   ④ **节拍**（假时钟）：本地写防抖 30s 且连点合并、focus 冷却、定时兜底。
 *
 * 【假 window 的纪律】同 progress.test.ts：structuredClone 收件、戳用单调 rev。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAccountStore } from '../account'
import { useCloudSyncStore, LOCAL_WRITE_DEBOUNCE_MS, PERIODIC_SYNC_MS } from '../cloud-sync'
import { useFavoritesStore } from '../favorites'
import { useProgressStore } from '../progress'
import { notifyLocalWrite } from '../../lib/local-write-bus'
import { CURRENT_FAVORITES_VERSION } from '../../../../shared/types'
import type {
  CloudAccountState,
  SyncRoundResult,
  UplinkResult
} from '../../../../shared/cloud/dto'

const accountBox: CloudAccountState = {
  signedIn: true,
  accountId: 'acc-1',
  username: 'alice',
  avatarHash: null,
  activated: true,
  boxAccountId: 'acc-1'
}

const signedOut: CloudAccountState = {
  signedIn: false,
  accountId: null,
  username: null,
  avatarHash: null,
  activated: false,
  boxAccountId: null
}

function roundResult(patch: Partial<SyncRoundResult> = {}): SyncRoundResult {
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

function uplinkResult(patch: Partial<UplinkResult> = {}): UplinkResult {
  return {
    skipped: false,
    authInvalid: false,
    ricePushed: 0,
    riceRejected: 0,
    ricePulled: 0,
    settlesSent: 0,
    settlesDropped: 0,
    failures: [],
    at: '2026-10-11T00:00:00.000Z',
    ...patch
  }
}

interface World {
  st: CloudAccountState
  /** 每次 syncNow 的入参（原样收，undefined 也要看得见） */
  syncCalls: Array<{ force?: boolean } | undefined>
  /** cloud.syncCancel（V1-65 取消口）的调用次数 */
  syncCancelCalls: number
  handler: () => { sync: SyncRoundResult; uplink: UplinkResult }
  /** 四个 store 的读口计数（协调器的判据看它） */
  counts: { profile: number; favorites: number; wrongbook: number; practice: number }
  /** 非 null 时 syncNow 悬在这里（测在飞去重） */
  gate: Promise<void> | null
  /** 状态读口抛错（测"读不到状态也照发启动轮"） */
  failState: boolean
  fireFocus: () => void
}

function stubWorld(patch: Partial<CloudAccountState> = {}): World {
  const w: World = {
    st: { ...accountBox, ...patch },
    syncCalls: [],
    syncCancelCalls: 0,
    handler: () => ({ sync: roundResult(), uplink: uplinkResult() }),
    counts: { profile: 0, favorites: 0, wrongbook: 0, practice: 0 },
    gate: null,
    failState: false,
    fireFocus: () => {}
  }
  const listeners: Record<string, (() => void)[]> = {}

  ;(globalThis as unknown as { window: unknown }).window = {
    addEventListener: (type: string, fn: () => void) => {
      ;(listeners[type] ??= []).push(fn)
    },
    removeEventListener: (type: string, fn: () => void) => {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn)
    },
    miai: {
      getProfile: async () => {
        w.counts.profile += 1
        return { data: null, stamp: { epoch: 0, rev: w.counts.profile } }
      },
      saveProfile: async () => ({ ok: true as const, stamp: { epoch: 0, rev: 99 } }),
      getFavorites: async () => {
        w.counts.favorites += 1
        return {
          data: { version: CURRENT_FAVORITES_VERSION, folders: [], items: [] },
          stamp: { epoch: 0, rev: w.counts.favorites }
        }
      },
      saveFavorites: async () => ({ ok: true as const, stamp: { epoch: 0, rev: 99 } }),
      getWrongbook: async () => {
        w.counts.wrongbook += 1
        return []
      },
      getPractice: async () => {
        w.counts.practice += 1
        return { history: [] }
      },
      cloud: {
        state: async (): Promise<CloudAccountState> => {
          if (w.failState) throw new Error('state read failed')
          return structuredClone(w.st)
        },
        syncNow: async (o?: { force?: boolean }) => {
          w.syncCalls.push(o)
          if (w.gate) {
            const g = w.gate
            w.gate = null
            await g
          }
          return w.handler()
        },
        // V1-65：取消口只竖旗、即时返回（真实 handler 不 await 引擎收尾）
        syncCancel: async (): Promise<void> => {
          w.syncCancelCalls += 1
        }
      }
    }
  }
  w.fireFocus = () => listeners.focus?.forEach((f) => f())
  return w
}

/** 让出若干轮微任务 + 一个宏任务（watch/写协议链/load 都在这些上面跑） */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  // 节拍器的定时器与总线订阅必须停掉：不然它会活到下一个测试里，
  // 打到那个测试的假 window 上（同 progress.test.ts 的幽灵定时器教训）
  try {
    useCloudSyncStore().stop()
  } catch {
    /* 这个测试没建过节拍器 */
  }
})

describe('节拍器：触发与去重（P10.6）', () => {
  it('启动轮：读到账号盒 → 发一轮，结果落进 lastRound / lastUplink', async () => {
    const w = stubWorld()
    w.handler = () => ({
      sync: roundResult({ pendingPush: ['profile'] }),
      uplink: uplinkResult({ ricePushed: 2 })
    })
    const cs = useCloudSyncStore()
    await cs.start()
    await settle()

    expect(w.syncCalls).toHaveLength(1)
    expect(cs.lastRound?.pendingPush).toEqual(['profile'])
    expect(cs.lastUplink?.ricePushed).toBe(2)
    expect(cs.running).toBe(false)
  })

  it('在飞时来的触发合并成"跑完补一轮"：不并发、也不丢', async () => {
    const w = stubWorld()
    let release!: () => void
    w.gate = new Promise<void>((r) => (release = r))
    const cs = useCloudSyncStore()

    await cs.start()
    await settle()
    expect(w.syncCalls).toHaveLength(1) // 第一轮在飞（gate 悬着）

    // 在飞期间来三个触发 —— 合并，不叠轮
    void cs.trigger('manual')
    void cs.trigger('focus')
    void cs.trigger('local-write')
    await settle()
    expect(w.syncCalls).toHaveLength(1)

    release()
    await cs.whenIdle()
    // 恰好补一轮：三个触发不许变成三轮（白打服务端），也不许一个不跑（丢触发）
    expect(w.syncCalls).toHaveLength(2)
  })

  it('★ V1-65 取消口：在飞时点停 → IPC 收旗、攒下的触发一起作废、收尾复位 stopping', async () => {
    const w = stubWorld()
    let release!: () => void
    w.gate = new Promise<void>((r) => (release = r))
    w.handler = () => ({ sync: roundResult({ canceled: true }), uplink: uplinkResult() })
    const cs = useCloudSyncStore()

    await cs.start()
    await settle()
    expect(w.syncCalls).toHaveLength(1) // 启动轮在飞（gate 悬着）

    void cs.trigger('periodic') // 在飞期间攒一个触发（正常流程 = 跑完补一轮）
    await cs.cancelNow()
    expect(w.syncCancelCalls).toBe(1) // 旗发到主进程
    expect(cs.stopping).toBe(true) // 收束期间按钮显示「正在停下…」
    expect(cs.running).toBe(true)

    release()
    await cs.whenIdle()
    await settle()
    expect(w.syncCalls).toHaveLength(1) // 攒下的触发作废 —— 不补轮（用户说了现在就停）
    expect(cs.stopping).toBe(false) // run 退出复位
    expect(cs.lastRound?.canceled).toBe(true) // 取消旗原样进 lastRound（界面据此不报「同步好啦」）
  })

  it('没在飞时点停：真 no-op（不发 IPC、stopping 不许卡亮）', async () => {
    const w = stubWorld()
    const cs = useCloudSyncStore()
    await cs.start()
    await settle()
    await cs.cancelNow()
    expect(w.syncCancelCalls).toBe(0)
    expect(cs.stopping).toBe(false)
  })

  it('force 只属于手动那一次：补轮不带 force（退避窗口照常生效）', async () => {
    const w = stubWorld()
    let release!: () => void
    w.gate = new Promise<void>((r) => (release = r))
    const cs = useCloudSyncStore()

    await cs.start()
    await settle()
    void cs.trigger('manual', { force: true })
    await settle()
    release()
    await cs.whenIdle()

    expect(w.syncCalls).toHaveLength(2)
    expect(w.syncCalls[1]).toEqual({ force: true }) // 补轮 = 手动触发点名的那个
    void cs.trigger('manual')
    await cs.whenIdle()
    expect(w.syncCalls[2]).toBeUndefined() // 普通手动（无 force）不带参数
  })

  it('客人盒停闸：不发起 IPC；手动 trigger 同样不发', async () => {
    const w = stubWorld({ boxAccountId: null, signedIn: true, activated: false, accountId: 'acc-1' })
    const cs = useCloudSyncStore()
    await cs.start()
    await settle()
    expect(w.syncCalls).toHaveLength(0)

    void cs.trigger('manual', { force: true })
    await settle()
    expect(w.syncCalls).toHaveLength(0)
  })

  it('状态读口失败：启动轮照发（主进程自己裁决），不假装成功也不缺席', async () => {
    const w = stubWorld()
    w.failState = true
    const cs = useCloudSyncStore()
    await cs.start()
    await settle()
    expect(w.syncCalls).toHaveLength(1)
    expect(cs.lastRound).not.toBeNull()
  })
})

describe('节拍器：authInvalid / protocolBlocked 停闸（P10.6）', () => {
  it('令牌已死 → 停闸 + 刷新账号状态；重新登录后闸开、同步恢复', async () => {
    const w = stubWorld()
    w.handler = () => ({
      sync: roundResult({ authInvalid: true }),
      uplink: uplinkResult({ authInvalid: true })
    })
    const cs = useCloudSyncStore()
    const account = useAccountStore()
    await cs.start()
    await settle()
    expect(cs.authInvalid).toBe(true)
    expect(w.syncCalls).toHaveLength(1)

    // 令牌死了 → 停闸：再触发也不打服务端
    void cs.trigger('manual', { force: true })
    await settle()
    expect(w.syncCalls).toHaveLength(1)

    // 主进程侧令牌吊销（盒还停账号位 —— 这是令牌死与登出的区别）
    w.st = { ...signedOut, boxAccountId: 'acc-1' }
    await account.refresh()
    await settle()

    // 重新登录（同一个盒）：闸要开，立刻补一轮
    w.handler = () => ({ sync: roundResult(), uplink: uplinkResult() })
    w.st = { ...accountBox }
    await account.refresh()
    await settle()
    await settle()
    expect(cs.authInvalid).toBe(false)
    expect(w.syncCalls).toHaveLength(2)
  })

  it('protocolBlocked（426）：停闸到重启为止（再触发也不发）', async () => {
    const w = stubWorld()
    w.handler = () => ({ sync: roundResult({ protocolBlocked: true }), uplink: uplinkResult() })
    const cs = useCloudSyncStore()
    await cs.start()
    await settle()
    expect(cs.protocolBlocked).toBe(true)

    void cs.trigger('manual', { force: true })
    await settle()
    expect(w.syncCalls).toHaveLength(1)
  })
})

describe('节拍器：lastDoneAt（「上次同步」的时间口径，P10.6）', () => {
  it('真跑过的轮才更新时间；skipped 轮不动它（尝试 ≠ 同步过）', async () => {
    const w = stubWorld()
    // 真轮的 docs 至少有一份结局（引擎对每份处理到的文档都记 outcome）——
    // 夹具照真形状给，别用空数组（空数组 = 轮次刚开就 abort，见 V1-63 用例）
    w.handler = () => ({
      sync: roundResult({
        at: '2026-10-11T10:00:00.000Z',
        docs: [{ docType: 'profile', status: 'synced' }]
      }),
      uplink: uplinkResult()
    })
    const cs = useCloudSyncStore()
    await cs.start()
    await settle()
    expect(cs.lastDoneAt).toBe('2026-10-11T10:00:00.000Z')

    // 退避窗口里的 skipped 轮：lastRound.at 会更新（那是**尝试**时刻），
    // lastDoneAt 必须纹丝不动 —— 否则账号页把"什么都没发"说成"刚同步过"
    w.handler = () => ({
      sync: roundResult({ skipped: true, skipReason: 'backoff', at: '2026-10-11T10:05:00.000Z' }),
      uplink: uplinkResult({ skipped: true, skipReason: 'signed-out' })
    })
    void cs.trigger('manual')
    await cs.whenIdle()
    expect(cs.lastRound?.at).toBe('2026-10-11T10:05:00.000Z')
    expect(cs.lastDoneAt).toBe('2026-10-11T10:00:00.000Z')
  })

  it('四份全 failed 的轮也不动它（V1-63：一个包都没落成 ≠ 刚同步过）', async () => {
    const w = stubWorld()
    w.handler = () => ({
      sync: roundResult({
        at: '2026-10-11T10:00:00.000Z',
        docs: [{ docType: 'profile', status: 'synced' }]
      }),
      uplink: uplinkResult()
    })
    const cs = useCloudSyncStore()
    await cs.start()
    await settle()
    expect(cs.lastDoneAt).toBe('2026-10-11T10:00:00.000Z')

    // 第二轮：断网，四份全 failed —— lastRound 更新（尝试过），lastDoneAt 不动
    w.handler = () => ({
      sync: roundResult({
        at: '2026-10-11T10:05:00.000Z',
        docs: [
          { docType: 'profile', status: 'failed', failureCode: 'NETWORK' },
          { docType: 'favorites', status: 'failed', failureCode: 'NETWORK' },
          { docType: 'wrongbook', status: 'failed', failureCode: 'NETWORK' },
          { docType: 'practice', status: 'failed', failureCode: 'NETWORK' }
        ],
        pendingPush: ['profile', 'favorites', 'wrongbook', 'practice']
      }),
      uplink: uplinkResult()
    })
    void cs.trigger('manual')
    await cs.whenIdle()
    expect(cs.lastRound?.at).toBe('2026-10-11T10:05:00.000Z')
    expect(cs.lastDoneAt).toBe('2026-10-11T10:00:00.000Z')
  })

  it('部分失败但有一份 unchanged：算"对上过云端"，时刻照样推进（V1-63 的边界）', async () => {
    const w = stubWorld()
    w.handler = () => ({
      sync: roundResult({
        at: '2026-10-11T10:00:00.000Z',
        docs: [
          { docType: 'profile', status: 'unchanged' },
          { docType: 'favorites', status: 'failed', failureCode: 'NETWORK' },
          { docType: 'wrongbook', status: 'synced' },
          { docType: 'practice', status: 'blocked', blockReason: 'DOC_VER_TOO_NEW' }
        ],
        pendingPush: ['favorites', 'practice']
      }),
      uplink: uplinkResult()
    })
    const cs = useCloudSyncStore()
    await cs.start()
    await settle()
    expect(cs.lastDoneAt).toBe('2026-10-11T10:00:00.000Z')
  })
})

describe('节拍器：安全点协调器（P10.6）', () => {
  it('changedDocs 点名谁就重载谁：profile/wrongbook 被重载，favorites/practice 一次不碰', async () => {
    const w = stubWorld()
    const cs = useCloudSyncStore()
    await cs.start()
    await settle()
    // 启动轮空 changedDocs：四个 store 一个都不该被建起来
    expect(w.counts).toEqual({ profile: 0, favorites: 0, wrongbook: 0, practice: 0 })

    w.handler = () => ({
      sync: roundResult({ changedDocs: ['profile', 'wrongbook'] }),
      uplink: uplinkResult()
    })
    void cs.trigger('manual')
    await cs.whenIdle()
    // resolveExternal 的「重载 + 重放」在写协议的串行链上 —— 多让几轮
    await settle()
    await settle()

    // profile：建店 load 一次 + resolveExternal 重载一次
    expect(w.counts.profile).toBe(2)
    // wrongbook：loadWrongbook 一次
    expect(w.counts.wrongbook).toBe(1)
    // 没被点名的两份：一次都不许读（这就是"只重载被点名的"与"全量重载"的分界）
    expect(w.counts.favorites).toBe(0)
    expect(w.counts.practice).toBe(0)
    expect(cs.lastRound?.changedDocs).toEqual(['profile', 'wrongbook'])
  })

  it('登录（未激活）不发；激活切盒 → 四份全量重载 + 一轮；登出回客人盒 → 重载不再触发', async () => {
    const w = stubWorld({ ...signedOut })
    const cs = useCloudSyncStore()
    const account = useAccountStore()
    await cs.start()
    await settle()
    expect(w.syncCalls).toHaveLength(0) // 客人盒：启动轮停闸

    // 登录成功、还没激活：盒仍客人位 —— 一轮都不发（跑了也是 skipped）
    w.st = { ...signedOut, signedIn: true, accountId: 'acc-1' }
    await account.refresh()
    await settle()
    expect(w.syncCalls).toHaveLength(0)

    // 激活：盒切进账号位 → 全量重载 + 触发一轮
    w.st = { ...accountBox }
    await account.refresh()
    await settle()
    await settle()
    expect(w.syncCalls).toHaveLength(1)
    expect(w.counts.profile).toBeGreaterThanOrEqual(1)
    expect(w.counts.favorites).toBeGreaterThanOrEqual(1)
    expect(w.counts.wrongbook).toBeGreaterThanOrEqual(1)
    expect(w.counts.practice).toBeGreaterThanOrEqual(1)

    // 登出：回客人盒 → 重载回客人盘面，但不触发（没东西可同步）
    const before = w.syncCalls.length
    w.st = { ...signedOut }
    await account.refresh()
    await settle()
    expect(w.syncCalls).toHaveLength(before)
  })
})

describe('节拍器：节拍（假时钟）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** 只推微任务（假时钟下 setTimeout(0) 不安全，settle 用不了） */
  const flushAll = async (): Promise<void> => {
    for (let i = 0; i < 30; i++) await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
  }

  it('本地写防抖：连点合并（重排后从新点起算 30s）、到点发一轮', async () => {
    const w = stubWorld()
    const cs = useCloudSyncStore()
    await cs.start()
    await flushAll()
    expect(w.syncCalls).toHaveLength(1) // 启动轮

    const t0 = Date.now()
    notifyLocalWrite('profile')
    await vi.advanceTimersByTimeAsync(LOCAL_WRITE_DEBOUNCE_MS - 1000)
    await flushAll()
    expect(w.syncCalls).toHaveLength(1) // 还没到点

    // 连点：防抖重排 —— 若实现忘了 clearTimeout，下一次推进会在 t0+30s 处炸出第二轮
    notifyLocalWrite('profile')
    await vi.advanceTimersByTimeAsync(16_000) // 走到 t0+45s
    await flushAll()
    expect(w.syncCalls).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(15_000) // 走到 t0+60s > 重排后的 t0+59s
    await flushAll()
    expect(w.syncCalls).toHaveLength(2)
  })

  it('focus：一轮刚跑过就冷却跳过；冷却过后聚焦触发一轮', async () => {
    const w = stubWorld()
    const cs = useCloudSyncStore()
    await cs.start()
    await flushAll()
    expect(w.syncCalls).toHaveLength(1)

    // 启动轮刚跑完（lastRunAt = 现在）——立刻聚焦：冷却内，跳过
    w.fireFocus()
    await flushAll()
    expect(w.syncCalls).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(61_000) // 越过 60s 冷却
    w.fireFocus()
    await flushAll()
    expect(w.syncCalls).toHaveLength(2)
  })

  it('定时兜底：5 分钟一到自己发一轮（所有事件源全哑也最多漏 5 分钟）', async () => {
    const w = stubWorld()
    const cs = useCloudSyncStore()
    await cs.start()
    await flushAll()
    expect(w.syncCalls).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(PERIODIC_SYNC_MS - 1000)
    await flushAll()
    expect(w.syncCalls).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(2000)
    await flushAll()
    expect(w.syncCalls).toHaveLength(2)
  })

  it('stop() 之后节拍全停：本地写/定时/聚焦都不再触发', async () => {
    const w = stubWorld()
    const cs = useCloudSyncStore()
    await cs.start()
    await flushAll()
    expect(w.syncCalls).toHaveLength(1)

    cs.stop()
    notifyLocalWrite('profile')
    await vi.advanceTimersByTimeAsync(PERIODIC_SYNC_MS + LOCAL_WRITE_DEBOUNCE_MS + 61_000)
    w.fireFocus()
    await flushAll()
    expect(w.syncCalls).toHaveLength(1)
  })
})
