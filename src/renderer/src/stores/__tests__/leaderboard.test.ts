/**
 * 排行榜 store（stores/leaderboard.ts）的单测（P10.6）。
 *
 * 【这个文件在守什么 —— 它是最容易"看起来在工作"的那种模块】
 *   ① **§8.2 的降级口径**：拉失败时**快照原样留着**（界面显示「截至 X」），
 *      从没拉到过才是空态 —— 失败把旧数据清掉 = 一次断网清空榜面；
 *   ② **按榜期分账**：一个榜期的失败不许动另一个榜期的快照；
 *   ③ **乱序守卫（seq）**：换账号时旧账号的回话晚到，不许落进新账号的盘面；
 *   ④ **loadMore 的游标纪律**：cursor 原样回传、entries 追加、nextCursor 跟随；
 *   ⑤ **opt-in 是账号级**：成功一次，所有榜期快照的 me.optedIn 一起翻。
 *
 * 【假 window 的纪律】同 cloud-sync.test.ts：structuredClone 收件、戳用单调 rev、
 * 每个测试收尾把在飞的东西放干净（gate 必须释放，不然微任务泄漏到下一条）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAccountStore } from '../account'
import { useLeaderboardStore } from '../leaderboard'
import type {
  CloudAccountState,
  CloudResult,
  LeaderboardResponse,
  OptInResponse
} from '../../../../shared/cloud/dto'

const accountBox: CloudAccountState = {
  signedIn: true,
  accountId: 'acc-1',
  username: 'alice',
  avatarHash: null,
  activated: true,
  boxAccountId: 'acc-1'
}

function boardResponse(patch: Partial<LeaderboardResponse> = {}): LeaderboardResponse {
  return {
    period: 'daily',
    periodKey: '2026-10-10',
    filter: { lang: null, difficulty: null },
    entries: [{ rank: 1, username: 'alice', avatarHash: null, score: 500, days: 1, langs: ['c'] }],
    me: { rank: 7, score: 300, optedIn: false, scoreToday: 0 },
    computedAt: '2026-10-11T00:00:00.000Z',
    nextCursor: null,
    ...patch
  }
}

interface BoardCall {
  period?: string
  dateKey?: string
  cursor?: string
}

interface World {
  st: CloudAccountState
  /** 每次 leaderboard 的入参（原样收） */
  boardCalls: BoardCall[]
  /** 第 n 次（0 起）leaderboard 调用的回话；测试里按调用序换内容 */
  handler: (input: BoardCall | undefined, n: number) => CloudResult<LeaderboardResponse>
  /** 每次 leaderboardOptIn 的入参 */
  optInCalls: Array<{ optIn: boolean }>
  optInHandler: () => CloudResult<OptInResponse>
  /** 非 null 时**第一次** leaderboard 调用悬在这里（测在飞/乱序） */
  gate: Promise<void> | null
  release: () => void
}

function stubWorld(patch: Partial<CloudAccountState> = {}): World {
  const w: World = {
    st: { ...accountBox, ...patch },
    boardCalls: [],
    handler: () => ({ ok: true, data: boardResponse() }),
    optInCalls: [],
    optInHandler: () => ({ ok: true, data: { optIn: true } }),
    gate: null,
    release: () => {}
  }

  ;(globalThis as unknown as { window: unknown }).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    miai: {
      cloud: {
        state: async (): Promise<CloudAccountState> => structuredClone(w.st),
        leaderboard: async (input?: BoardCall): Promise<CloudResult<LeaderboardResponse>> => {
          const n = w.boardCalls.length
          w.boardCalls.push(input === undefined ? {} : { ...input })
          if (w.gate) {
            const g = w.gate
            w.gate = null
            await g
          }
          return w.handler(input, n)
        },
        leaderboardOptIn: async (input: { optIn: boolean }): Promise<CloudResult<OptInResponse>> => {
          w.optInCalls.push({ ...input })
          return w.optInHandler()
        },
        // 改名通道（2026-10-22）：资料版本联动用例会走到它
        updateUsername: async (name: string) => ({
          ok: true as const,
          data: { id: 'acc-1', username: name, avatarHash: null, createdAt: '2026-10-11T00:00:00.000Z' }
        })
      }
    }
  }
  return w
}

/** 让出若干轮微任务 + 一个宏任务（watch/落账都在这些上面跑） */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** 造一个「悬着等 release()」的门 */
function makeGate(): { gate: Promise<void>; release: () => void } {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  return { gate, release }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(async () => {
  // 放干净在飞的门：不放的话挂起的 promise 会活到下一条测试里（幽灵微任务）
  await settle()
})

describe('排行榜 store：拉取与快照（P10.6）', () => {
  it('成功一轮：快照落账（五件套 + fetchedAt），loading 起落，failed 复位', async () => {
    const w = stubWorld()
    const lb = useLeaderboardStore()
    const p = lb.load('daily')
    expect(lb.loading.daily).toBe(true) // 在飞：界面据此显示「正在拉榜…」
    await p
    expect(lb.loading.daily).toBe(false)
    expect(lb.failed.daily).toBe(false)

    const snap = lb.boards.daily
    expect(snap).toBeDefined()
    expect(snap?.entries).toEqual([
      { rank: 1, username: 'alice', avatarHash: null, score: 500, days: 1, langs: ['c'] }
    ])
    expect(snap?.me.rank).toBe(7)
    expect(snap?.periodKey).toBe('2026-10-10')
    expect(snap?.computedAt).toBe('2026-10-11T00:00:00.000Z')
    expect(snap?.nextCursor).toBeNull()
    expect(Number.isNaN(Date.parse(snap?.fetchedAt ?? ''))).toBe(false)
    // 入参带本地日（scoreToday 的 UTC 日界校准），period 是本次拉的那个
    expect(w.boardCalls).toHaveLength(1)
    expect(w.boardCalls[0].period).toBe('daily')
    expect(w.boardCalls[0].dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(w.boardCalls[0].cursor).toBeUndefined()
  })

  it('在飞去重：同一榜期连点两次只发一个包', async () => {
    const w = stubWorld()
    const g = makeGate()
    w.gate = g.gate
    w.release = g.release
    const lb = useLeaderboardStore()
    const p1 = lb.load('daily')
    const p2 = lb.load('daily') // 在飞：合并，不再发包
    await settle()
    expect(w.boardCalls).toHaveLength(1)
    g.release()
    await Promise.all([p1, p2])
    expect(w.boardCalls).toHaveLength(1)
    expect(lb.boards.daily).toBeDefined()
  })

  it('首次拉取失败：无快照 → 空态读数（failed=true，boards 不含该期）；再来一轮成功即恢复', async () => {
    const w = stubWorld()
    w.handler = (_i, n) =>
      n === 0
        ? { ok: false, failure: { code: 'NETWORK', message: 'down', httpStatus: null } }
        : { ok: true, data: boardResponse() }
    const lb = useLeaderboardStore()
    await lb.load('daily')
    expect(lb.failed.daily).toBe(true)
    expect(lb.boards.daily).toBeUndefined()
    expect(lb.loading.daily).toBe(false)

    await lb.load('daily') // 重试
    expect(lb.failed.daily).toBe(false)
    expect(lb.boards.daily).toBeDefined()
  })

  it('§8.2：成功过一轮之后再失败 → 快照原样留着（「截至 X」的数据面），failed=true', async () => {
    const w = stubWorld()
    w.handler = (_i, n) =>
      n === 0
        ? { ok: true, data: boardResponse({ periodKey: '2026-10-09' }) }
        : { ok: false, failure: { code: 'TIMEOUT', message: 'slow', httpStatus: null } }
    const lb = useLeaderboardStore()
    await lb.load('daily')
    const before = lb.boards.daily
    await lb.load('daily')
    expect(lb.failed.daily).toBe(true)
    // 同一个对象原样还在（不是被清空、也不是被失败轮改写）
    expect(lb.boards.daily).toBe(before)
    expect(lb.boards.daily?.entries).toHaveLength(1)
  })

  it('按榜期分账：日榜失败不碰周榜的快照，反之亦然', async () => {
    const w = stubWorld()
    w.handler = (input) =>
      input?.period === 'weekly'
        ? { ok: true, data: boardResponse({ period: 'weekly', periodKey: '2026-W41' }) }
        : { ok: false, failure: { code: 'NETWORK', message: 'down', httpStatus: null } }
    const lb = useLeaderboardStore()
    await lb.load('weekly')
    expect(lb.boards.weekly?.periodKey).toBe('2026-W41')
    await lb.load('daily')
    expect(lb.failed.daily).toBe(true)
    expect(lb.failed.weekly).toBe(false) // 日榜的失败不许打到周榜头上
    expect(lb.boards.weekly?.periodKey).toBe('2026-W41')
    expect(lb.boards.daily).toBeUndefined()
  })
})

describe('排行榜 store：乱序与换账号（P10.6）', () => {
  it('换账号清空盘面：旧账号的回话晚到也不许落进新账号（seq 守卫）', async () => {
    const w = stubWorld()
    const g = makeGate()
    w.gate = g.gate
    w.handler = (input, n) => {
      // 第一次（acc-1，悬着那个）= 旧账号的数据；第二次（acc-2）= 新账号的数据
      const who = n === 0 ? 'old-user' : 'new-user'
      return {
        ok: true,
        data: boardResponse({
          period: (input?.period as LeaderboardResponse['period']) ?? 'daily',
          entries: [
            { rank: 1, username: who, avatarHash: null, score: n === 0 ? 111 : 222, days: 1, langs: [] }
          ]
        })
      }
    }
    const lb = useLeaderboardStore()
    const account = useAccountStore()
    await account.refresh() // acc-1

    const p1 = lb.load('daily') // 旧账号这一轮悬在门上
    await settle()
    expect(w.boardCalls).toHaveLength(1)

    // 换账号：watch 清空 + 推高 seq
    w.st = { ...accountBox, accountId: 'acc-2' }
    await account.refresh()
    await settle()
    expect(lb.boards.daily).toBeUndefined()

    // 新账号拉一轮（此时 loading 已被清，能够再发）
    await lb.load('daily')
    expect(lb.boards.daily?.entries[0]?.username).toBe('new-user')
    expect(lb.boards.daily?.entries[0]?.score).toBe(222)

    // 旧账号的回话现在才到 —— 必须被丢掉，不许把新账号的读数盖回去
    g.release()
    await p1
    await settle()
    expect(lb.boards.daily?.entries[0]?.username).toBe('new-user')
    expect(lb.boards.daily?.entries[0]?.score).toBe(222)
  })

  it('登出（accountId → null）也清空：me 卡里不许留着上一个人的名次', async () => {
    const w = stubWorld()
    const lb = useLeaderboardStore()
    const account = useAccountStore()
    await account.refresh()
    await lb.load('daily')
    expect(lb.boards.daily).toBeDefined()

    w.st = {
      signedIn: false,
      accountId: null,
      username: null,
      avatarHash: null,
      activated: false,
      boxAccountId: null
    }
    await account.refresh()
    await settle()
    expect(lb.boards.daily).toBeUndefined()
    expect(lb.failed.daily).toBeUndefined()
  })

  it('改名/换头像成功（profileVersion 变化）也清空盘面：下一次拉取才是新名字新头像', async () => {
    const w = stubWorld()
    const lb = useLeaderboardStore()
    const account = useAccountStore()
    await account.refresh()

    w.handler = (_input, n) => ({
      ok: true,
      data: boardResponse({
        entries: [
          {
            rank: 1,
            username: n === 0 ? 'alice' : '大肥鱼学徒',
            avatarHash: n === 0 ? null : 'a'.repeat(64),
            score: 500,
            days: 1,
            langs: ['c']
          }
        ]
      })
    })
    await lb.load('daily')
    expect(lb.boards.daily?.entries[0]?.username).toBe('alice')

    // 真的走 store 的改名动作（不是手动 bump 版本号 —— 那测不到接线）
    const renamed = await account.updateUsername('大肥鱼学徒')
    expect(renamed.ok).toBe(true)
    await settle()
    // 旧快照必须被清掉（否则榜面还摊着旧名字）
    expect(lb.boards.daily).toBeUndefined()

    await lb.load('daily')
    expect(lb.boards.daily?.entries[0]?.username).toBe('大肥鱼学徒')
    expect(lb.boards.daily?.entries[0]?.avatarHash).toBe('a'.repeat(64))
  })
})

describe('排行榜 store：加载更多与 opt-in（P10.6）', () => {
  it('loadMore：cursor 原样回传、entries 追加、nextCursor 跟随服务端', async () => {
    const w = stubWorld()
    w.handler = (input, n) => {
      if (n === 0) {
        return {
          ok: true,
          data: boardResponse({
            entries: [{ rank: 1, username: 'a', avatarHash: null, score: 900, days: 2, langs: [] }],
            nextCursor: 'CUR-A'
          })
        }
      }
      return {
        ok: true,
        data: boardResponse({
          entries: [{ rank: 2, username: 'b', avatarHash: null, score: 800, days: 2, langs: [] }],
          nextCursor: null,
          me: { rank: 9, score: 100, optedIn: true, scoreToday: 50 }
        })
      }
    }
    const lb = useLeaderboardStore()
    await lb.load('daily')
    expect(lb.boards.daily?.nextCursor).toBe('CUR-A')

    await lb.loadMore('daily')
    expect(w.boardCalls).toHaveLength(2)
    expect(w.boardCalls[1].cursor).toBe('CUR-A') // 原样，没有自己编
    expect(w.boardCalls[1].period).toBe('daily')
    const snap = lb.boards.daily
    expect(snap?.entries.map((e) => e.username)).toEqual(['a', 'b']) // 追加不是替换
    expect(snap?.nextCursor).toBeNull() // 服务端说没有下一页了
    expect(snap?.me.optedIn).toBe(true) // me 跟随最新一页

    // 没有下一页：再点也不发包
    await lb.loadMore('daily')
    expect(w.boardCalls).toHaveLength(2)
  })

  it('loadMore 失败：已显示的行不动（failed=true 让界面挂「截至」标注），游标未丢可再点', async () => {
    const w = stubWorld()
    w.handler = (_i, n) =>
      n === 0
        ? { ok: true, data: boardResponse({ nextCursor: 'CUR-A' }) }
        : { ok: false, failure: { code: 'NETWORK', message: 'down', httpStatus: null } }
    const lb = useLeaderboardStore()
    await lb.load('daily')
    await lb.loadMore('daily')
    expect(lb.failed.daily).toBe(true)
    expect(lb.boards.daily?.entries).toHaveLength(1) // 首屏的行还在
    expect(lb.boards.daily?.nextCursor).toBe('CUR-A') // 游标保留 = 再点一次即重试
    expect(lb.moreLoading).toBe(false)
  })

  it('setOptIn 成功：所有榜期快照的 me.optedIn 一起翻（账号级开关只有一份真值）', async () => {
    const w = stubWorld()
    w.handler = (input) => ({
      ok: true,
      data: boardResponse({
        period: (input?.period as LeaderboardResponse['period']) ?? 'daily',
        me: { rank: 3, score: 400, optedIn: false, scoreToday: 10 }
      })
    })
    w.optInHandler = () => ({ ok: true, data: { optIn: true } })
    const lb = useLeaderboardStore()
    await lb.load('daily')
    await lb.load('weekly')

    const ok = await lb.setOptIn(true)
    expect(ok).toBe(true)
    expect(w.optInCalls).toEqual([{ optIn: true }])
    expect(lb.boards.daily?.me.optedIn).toBe(true)
    expect(lb.boards.weekly?.me.optedIn).toBe(true)
    expect(lb.boards.daily?.me.rank).toBe(3) // 开关只改曝光，不动名次
  })

  it('setOptIn 失败：返回 false、开关值原样（界面自己弹回 + 报错文案）', async () => {
    const w = stubWorld()
    w.optInHandler = () => ({
      ok: false,
      failure: { code: 'NETWORK', message: 'down', httpStatus: null }
    })
    const lb = useLeaderboardStore()
    await lb.load('daily')
    const ok = await lb.setOptIn(true)
    expect(ok).toBe(false)
    expect(lb.boards.daily?.me.optedIn).toBe(false)
    expect(lb.optInBusy).toBe(false) // 失败也要释放 busy，不然开关永久禁用
  })
})
