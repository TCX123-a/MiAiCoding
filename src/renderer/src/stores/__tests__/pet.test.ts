/**
 * 桌宠镜像 store（stores/pet.ts）的 P3 ④ 面：好感镜像 + 全应用唯一的轮询器。
 *
 * 【为什么轮询器值得单测】`ensurePetPoller` 是**全应用唯一一条 5s IPC 表**
 * （侧栏爱心与总览页共用它，见 C7/契约）。它有两种安静坏法：
 *   · 退订不幂等（refcount 减穿）→ 表停得比最后一个引用者早：
 *     爱心还挂着、数字却再也不动；
 *   · 该停不停 → 切走页面后一条谁也不看的 IPC 永远空转。
 * 两种都不报错、界面上都看不出 —— 只有对着 `petInit` 的**调用次数**数数
 * 才抓得到（假替身如实计数，见 miai-stub）。
 *
 * 【为什么快照要经 structuredClone】同 miai-stub 的总注释：真 IPC 的守门员
 * 就是结构化克隆。这里顺带验 "init/pull 拿到的是干净副本"。
 *
 * 【时钟】轮询用 vi.useFakeTimers 拨表；假 window 的 setInterval 是
 * 调用时转发到 globalThis 的（stub 里那两行注释），所以假表管得住它。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { PET_POLL_MS, usePetStore } from '../pet'
import { snapshotOf, defaultPetState, petAffectionTier } from '../../../../shared/pet'
import { stubMiai, type MiaiLog } from './miai-stub'

const T0 = new Date(2026, 9, 6, 12, 0, 0).toISOString()
/** 造一份真形状的快照，只把 affection 换成用例点名要看的值 */
const snapWith = (affection: number) => ({ ...snapshotOf(defaultPetState(T0), T0), affection })

let log: MiaiLog

beforeEach(() => {
  setActivePinia(createPinia())
  log = stubMiai()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('好感镜像（P3 ④）：null 口径与档位派生', () => {
  it('还没读到快照：affection/affectionTier 都是 null（界面画 --% 而不是 0%）', () => {
    const pet = usePetStore()
    expect(pet.snap).toBeNull()
    expect(pet.affection).toBeNull()
    expect(pet.affectionTier).toBeNull()
  })

  it('init 后镜像快照值；档位由 shared/pet.ts 派生（不在这里另存一份界值）', async () => {
    log.petSnapshot = snapWith(73)
    const pet = usePetStore()
    await pet.init()
    expect(pet.affection).toBe(73)
    expect(pet.affectionTier).toBe(petAffectionTier(73))
    expect(pet.affectionTier).toBe('like')
    // subscribed 守卫：只订一次广播
    await pet.init()
    expect(log.petStateSubs).toBe(1)
  })

  it('广播推来新快照：镜像跟着换（affection 12 → cold 档）', async () => {
    const pet = usePetStore()
    await pet.init()
    log.petStateListeners[0](snapWith(12))
    expect(pet.affection).toBe(12)
    expect(pet.affectionTier).toBe('cold')
  })

  it('act：动作真的送出去、返回的快照换上（好感跟着动作后的那份走）', async () => {
    const pet = usePetStore()
    await pet.init()
    log.petActResult = snapWith(60)
    await pet.act({ action: 'pat' })
    expect(log.petActCalls).toEqual([{ action: 'pat' }])
    expect(pet.affection).toBe(60)
    expect(pet.affectionTier).toBe('like')
  })
})

describe('轮询器（ensurePetPoller）：refcount 单例 / 5s 一拍 / 退订幂等', () => {
  it('第一个引用者立即拉一次并上表；第二个引用者不再另起一条表', async () => {
    const pet = usePetStore()
    await pet.init() // 初始读一次
    expect(log.petInitCalls).toBe(1)
    const r1 = pet.ensurePetPoller() // 立即拉：+1
    await vi.advanceTimersByTimeAsync(0)
    expect(log.petInitCalls).toBe(2)
    const r2 = pet.ensurePetPoller() // 已有表：不另拉、不另起
    await vi.advanceTimersByTimeAsync(0)
    expect(log.petInitCalls).toBe(2)
    // 每 5s 一拍 —— 两个引用者也只有一条表（多一条就会翻倍，这条咬住它）
    await vi.advanceTimersByTimeAsync(PET_POLL_MS)
    expect(log.petInitCalls).toBe(3)
    await vi.advanceTimersByTimeAsync(PET_POLL_MS)
    expect(log.petInitCalls).toBe(4)
    r1()
    r2()
    await vi.advanceTimersByTimeAsync(PET_POLL_MS)
    expect(log.petInitCalls).toBe(4) // 都退了：表停
  })

  it('先退一个引用：表照跑；退到零才停（再拨 3 个周期也一个字节不拉）', async () => {
    const pet = usePetStore()
    const r1 = pet.ensurePetPoller()
    const r2 = pet.ensurePetPoller()
    await vi.advanceTimersByTimeAsync(0)
    expect(log.petInitCalls).toBe(1) // 首拉一份
    r1()
    await vi.advanceTimersByTimeAsync(PET_POLL_MS)
    expect(log.petInitCalls).toBe(2) // 还剩一个引用者 → 继续跑
    r2()
    await vi.advanceTimersByTimeAsync(3 * PET_POLL_MS)
    expect(log.petInitCalls).toBe(2) // 表已停
  })

  it('退订幂等：重复调同一次退订不把 refcount 减穿（表停得比最后一个引用者早）', async () => {
    const pet = usePetStore()
    const r1 = pet.ensurePetPoller()
    await vi.advanceTimersByTimeAsync(0)
    expect(log.petInitCalls).toBe(1)
    r1()
    r1() // 重复退订 = 无操作（released 守卫）
    await vi.advanceTimersByTimeAsync(PET_POLL_MS)
    expect(log.petInitCalls).toBe(1)
    // 重进：refcount 必须从 0 回到 1（减穿的话这里会是 -1+1=0，静默不上表）
    const r2 = pet.ensurePetPoller()
    await vi.advanceTimersByTimeAsync(0)
    expect(log.petInitCalls).toBe(2) // 立即拉
    await vi.advanceTimersByTimeAsync(PET_POLL_MS)
    expect(log.petInitCalls).toBe(3) // 新表在跑
    r2()
    await vi.advanceTimersByTimeAsync(PET_POLL_MS)
    expect(log.petInitCalls).toBe(3)
  })

  it('两个页脚分别退订的顺序不影响：先退后进（总览 → 侧栏还没退）也只剩一条表', async () => {
    const pet = usePetStore()
    const overview = pet.ensurePetPoller()
    await vi.advanceTimersByTimeAsync(0)
    overview() // 总览退出
    const sidebar = pet.ensurePetPoller() // 侧栏进（若表被误停，这里该重新上表：+1 首拉）
    await vi.advanceTimersByTimeAsync(0)
    expect(log.petInitCalls).toBe(2)
    await vi.advanceTimersByTimeAsync(PET_POLL_MS)
    // 表只有一条：这个 5s 窗口里恰好 +1（两条表的话是 +2）
    expect(log.petInitCalls).toBe(3)
    sidebar()
  })
})
