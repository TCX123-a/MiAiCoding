/**
 * 学习档案的落盘（stores/progress.ts）
 *
 * 【这个文件在守什么】
 * 守的是**「学过的东西，关掉应用再打开还在」**。
 *
 * 这一条从 M3 一直坏到 M6：保存时写的是 `structuredClone(profile.value)`，
 * 而 `profile.value` 是 Vue 的**响应式代理**，`structuredClone` 克隆不了代理，
 * **当场同步抛错**。而两条保存路径——防抖落盘（`.catch(() => {})`）和
 * 退出冲刷（在 `beforeunload` 里抛，没人接）——**都把错吞了**。
 *
 * 所以症状是：不报错、不崩溃、界面一切正常，只是硬盘上那个 `profile.json`
 * **从来没被写出来过**。用户看到的是「学了一晚上，第二天打开进度归零」。
 *
 * 【为什么假 window 故意用 structuredClone 收件】
 * 真实的 `ipcRenderer.invoke` 用的就是这个算法。用同一个算法做假货，
 * 「入参里混进了响应式代理」才会**在测试里当场炸**，而不是等用户点了标记已学
 * 之后、重启应用才发现东西没了。同 settings.test.ts 的做法。
 *
 * 【2026-10-08（P3 ①）】签到那一节加进来了。这一节的断言盯三件事：
 *   1. 签的是**哪个日键**（`checkinCalls` —— 时序用例全靠注入日键才测得动）；
 *   2. 本地档案换上的必须是**主进程回的那份**（不是界面自己乐观拼的）；
 *   3. toast 的三种出口（成功 / 饭没发到 / 写盘失败）各自说什么话，
 *      以及「今天已签过」那条**什么也不说**（幂等重放不是错误）。
 *
 * 【2026-10-16（空转[2]）】第 3 条多了个维度：主进程回话里的 `streakReset`
 *   为真时，awarded 的每种播报都要换成"先说断签"的版本。判定（接续规则）
 *   在 applyCheckin，这里守的是**转述不吞** —— 正常版那句同时不许出现。
 *
 * 【2026-10-11（P10.6）】签到/发图这类**主进程 RMW** 与新写协议的交接：
 * 回包带回来的戳必须被收下（`noteStamp`），否则下一次本地写带着过期戳
 * 去撞 STALE_REV；而回包送来的镜像是"收话对齐"，**不许**再回声写一遍。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { SAVE_DEBOUNCE_MS, useProgressStore } from '../progress'
import {
  CURRENT_PROFILE_VERSION,
  type CheckinSubmitResult,
  type UserProfile
} from '../../../../shared/types'
import type { BoxStamp, DocWriteResult, StampedDoc } from '../../../../shared/doc-write'
import { todayKey } from '../../../../shared/dates'
import { TOAST } from '../../lib/copy'
import { toasts } from '../../components/base/toast'

/** 空档案。**每次新建一份**：store 会原地改它，共用一份会串测试 */
function emptyProfile(): UserProfile {
  return {
    // 版本号走共享常量，**不写死数字**：等档案升到 v3 时，
    // 写死 2 的夹具会变成一个"和现实不符、却没人会注意"的假货（同 settings.test.ts 的规矩）
    version: CURRENT_PROFILE_VERSION,
    learned: [],
    favorites: [],
    history: [],
    stats: { learnedCount: 0, practicedCount: 0, streakDays: 0 },
    rewards: { gallery: [], perfectPasses: 0, lastImageDay: null },
    checkin: { lastDate: null, streakDays: 0, totalDays: 0, days: [] },
    // v4（P10.1）：同步合并的时间戳与墓碑区。主进程发回来的档案必有这几节
    // （同上面版本号的规矩：夹具比现实少一块，就会替读它的代码把错挡住）。
    // 本文件的用例不读它们，空表即可（语义不变）
    learnedAt: {},
    favoriteAt: {},
    tombstones: { learned: {}, lessonFavorites: {} }
  }
}

interface StubOpts {
  /** 读档返回什么（不传 = 首次运行，没有档案） */
  existing?: UserProfile
  /** 读档挂住不返回 —— 模拟「档案还没读完」 */
  hang?: boolean
  /** `checkinSubmit` 回什么（不传 = 签到成功、发了饭、checkin 取空档 + 今天） */
  checkinResult?: CheckinSubmitResult
  /** 让 `checkinSubmit` 直接 reject —— 测「写盘失败时界面怎么说话」 */
  failCheckin?: boolean
  /** 下一次 `saveProfile` 回一次 STALE_REV（current 用这一份）—— 测「冲突重载重放」 */
  conflictOnce?: UserProfile
}

/**
 * 装上假的 window.miai。
 *
 * ⚠️ 除了 `miai`，还必须给 `addEventListener`：store 在 setup 时就会
 * `window.addEventListener('beforeunload', flush)`，不给的话**整个 store 建不起来**。
 * 顺手把它记下来，测试就能真的「关一次窗口」。
 *
 * 【P10.6：读写口都是带戳的信封】形状照 shared/doc-write.ts：
 * 读口回 `{data, stamp}`、写口收 `(payload, stamp)` 并回 `DocWriteResult`。
 * 戳在本替身里是**单调 rev**（照主进程 BoxedStore 的语义：写成功 rev+1）——
 * 这样"转发链"（读来的戳原样带去下一次写、写回的新戳续上下一次）才有判据。
 */
function stubMiai(opts: StubOpts = {}) {
  const saved: UserProfile[] = []
  /** 每次 saveProfile **尝试**带上的戳（成功与冲突都记）—— 转发协议的判据看它 */
  const saveStamps: (BoxStamp | null | undefined)[] = []
  const listeners: Record<string, (() => void)[]> = {}
  /** 每次 `checkinSubmit` 收到的日键（断言"签的是哪天"看它） */
  const checkinCalls: string[] = []
  /**
   * 每次发给桌宠的 grant 载荷（2026-10-17 夜间批：发饭幂等的判据看它 ——
   * 原来没有这个记录口，「学完发饭」这件事在本文件里是隐形的）
   */
  const grants: { action: string; reward: string; lessonId?: string }[] = []
  let failCheckin = opts.failCheckin === true
  /** 主进程侧的写次数 —— 回话里的新戳从它来（写成功才 +1，冲突不加） */
  let rev = 0
  const stampNow = (): BoxStamp => ({ epoch: 0, rev })
  /** 还欠着一次冲突（见 StubOpts.conflictOnce） */
  let pendingConflict: UserProfile | null = opts.conflictOnce ?? null
  const checkinResult: CheckinSubmitResult = opts.checkinResult ?? {
    ok: true,
    awarded: true,
    // 默认不是断签（空转[2]）：断签播报的用例在下面单独种 streakReset: true
    streakReset: false,
    checkin: {
      lastDate: todayKey(),
      streakDays: 1,
      totalDays: 1,
      days: [todayKey()]
    },
    riceGranted: true,
    riceCredited: 2,
    stamp: stampNow()
  }

  ;(globalThis as unknown as { window: unknown }).window = {
    addEventListener: (type: string, fn: () => void) => {
      ;(listeners[type] ??= []).push(fn)
    },
    miai: {
      getProfile: (): Promise<StampedDoc<UserProfile | null>> =>
        opts.hang
          ? new Promise<StampedDoc<UserProfile | null>>(() => {})
          : Promise.resolve({
              data: opts.existing ? structuredClone(opts.existing) : null,
              stamp: stampNow()
            }),
      saveProfile: (p: UserProfile, stamp?: BoxStamp | null): Promise<DocWriteResult<UserProfile | null>> => {
        saveStamps.push(stamp)
        if (pendingConflict) {
          // 冲突 = 一个字节没写：盘面已被"别的写口"推开（rev+1），回最新数据 + 现戳
          const current = structuredClone(pendingConflict)
          pendingConflict = null
          rev += 1
          return Promise.resolve({ ok: false, code: 'STALE_REV', current, stamp: stampNow() })
        }
        // ⚠️ 这一行是这个文件的重点：真实 ipcRenderer.invoke 就是这么收件的。
        // 入参里混进响应式代理 → 这里会像真实环境一样抛 DataCloneError
        saved.push(structuredClone(p))
        rev += 1
        return Promise.resolve({ ok: true, stamp: stampNow() })
      },
      // 先记录再拒绝（同 miai-stub.ts）：记的是"这一下发出去过"，
      // 「失败后重试成功」的用例正是靠这个事实
      checkinSubmit: (day: string) => {
        checkinCalls.push(day)
        if (failCheckin) return Promise.reject(new Error('stub: checkin failed'))
        return Promise.resolve(structuredClone(checkinResult))
      },
      // 发饭口（pet-bridge.grantPetRice 的落点）。记下每次载荷再回 null ——
      // 回 null = 拿不到快照，调用方（progress 这一侧）不看回话，语义不变
      petAct: (arg: { action: string; reward: string; lessonId?: string }) => {
        grants.push(structuredClone(arg))
        return Promise.resolve(null)
      }
    }
  }

  return {
    saved,
    saveStamps,
    checkinCalls,
    grants,
    /** 挂上下一次冲突（用例中途也可以种） */
    conflictNext: (current: UserProfile) => {
      pendingConflict = current
    },
    /** 中途把失败开关关掉 —— 验「失败之后按钮还能按，再按能成」 */
    recover: () => {
      failCheckin = false
    },
    /** 触发一次某个事件（用来模拟真的要关窗口了） */
    fire: (type: string) => listeners[type]?.forEach((f) => f())
  }
}

/**
 * 让出一轮，把 store 里所有异步的东西跑完。
 *
 * 【为什么每次 flush 之前都要先 await 一次】
 * `watch(profile, persist, { deep: true })` 默认是**异步**的（微任务队列）。
 * 所以 `markLearned(); flush()` 这么连着写，flush 跑在 watcher **前面**：
 * 它清掉的是「上一次」的定时器，而 watcher 随后才排上「这一次」的定时器 ——
 * 那个定时器会活到测试结束之后，在**下一个测试**里触发一次保存，
 * 把下一个测试的断言数搞乱（实测：本该 1 次保存，数出来 4 次）。
 *
 * 等一轮再 flush，watcher 已经排好定时器，flush 就能干净地把它清掉。
 * 这也更贴近真实：用户点一下，等一会儿，然后才关窗口。
 */
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  setActivePinia(createPinia())
  // toast 是**模块级单例**（全进程一份），不清的话上一条用例弹的气泡
  // 会被下一条的数字看到 —— 签到那节逐条数气泡，串了就变成假红/假绿
  toasts.splice(0, toasts.length)
})

describe('学习档案落盘', () => {
  it('标记已学之后冲刷，档案真的写得出去（核心回归）', async () => {
    const { saved } = stubMiai()
    const p = useProgressStore()
    await settle()

    p.markLearned('common-01', true)
    await settle()
    p.flush()
    // flush 只是把写排进写协议的串行链（P10.6）——让出一轮再断言
    await settle()

    expect(saved).toHaveLength(1)
    expect(saved[0].learned).toEqual(['common-01'])
  })

  it('退出冲刷不会同步抛错（原来的 bug 就是在这一句抛的）', async () => {
    stubMiai()
    const p = useProgressStore()
    await settle()

    p.markLearned('common-01', true)
    await settle()
    // 原来是 `structuredClone(响应式代理)`，会在这里同步抛 ——
    // 而它跑在 beforeunload 里，抛了也没人接，进度就这么没了
    expect(() => p.flush()).not.toThrow()
    await settle()
  })

  it('关窗口（beforeunload）时会把档案冲刷出去', async () => {
    const { saved, fire } = stubMiai()
    const p = useProgressStore()
    await settle()

    p.markLearned('common-01', true)
    p.toggleFavorite('common-01')
    await settle()
    fire('beforeunload')
    await settle()

    expect(saved).toHaveLength(1)
    expect(saved[0].learned).toEqual(['common-01'])
    expect(saved[0].favorites).toEqual(['common-01'])
  })

  it('不手动冲刷，防抖到点也会自己落盘', async () => {
    const { saved } = stubMiai()
    const p = useProgressStore()
    await settle()

    p.markLearned('common-01', true)
    await new Promise((r) => setTimeout(r, SAVE_DEBOUNCE_MS + 150))

    expect(saved).toHaveLength(1)
    expect(saved[0].learned).toEqual(['common-01'])
  })

  it('连着改两次只存一次（防抖真的在防抖）', async () => {
    const { saved } = stubMiai()
    const p = useProgressStore()
    await settle()

    // ⚠️ 两次改动之间**必须各让出一轮**，让 watcher 各自排上一个定时器。
    // 中间不让的话，Vue 会把两次改动合成一批、watcher 只跑一次 ——
    // 那样这条测试即使把 clearTimeout 整个删掉也照样通过（实测过，是假绿）。
    p.markLearned('common-01', true)
    await settle()
    p.markLearned('common-02', true)
    await settle()
    await new Promise((r) => setTimeout(r, SAVE_DEBOUNCE_MS + 150))

    // 防抖生效 = 后一次把前一次的定时器顶掉，只落一次盘。
    // 丢了 clearTimeout 的话这里会是 2 —— 每改一下课就写一次硬盘
    expect(saved).toHaveLength(1)
    expect(saved[0].learned).toEqual(['common-01', 'common-02'])
  })

  it('档案还没读完之前不保存（否则空档案会盖掉真档案）', async () => {
    const { saved } = stubMiai({ hang: true })
    const p = useProgressStore()

    // 读档还挂着就标记已学 —— 这时 profile 里是初始空档，
    // 此刻保存等于拿一份空档案覆盖用户真正的那份
    p.markLearned('common-01', true)
    p.flush()
    await settle()

    expect(saved).toHaveLength(0)
    expect(p.loaded).toBe(false)
  })

  it('保存的是完整档案，不是只有动过的那一项', async () => {
    const { saved } = stubMiai()
    const p = useProgressStore()
    await settle()

    p.markLearned('common-01', true)
    await settle()
    p.flush()
    await settle()

    expect(saved[0].version).toBe(CURRENT_PROFILE_VERSION)
    expect(saved[0].history).toHaveLength(1)
    expect(saved[0].stats.learnedCount).toBe(1)
  })

  it('取消标记已学也会落盘', async () => {
    const { saved } = stubMiai({ existing: { ...emptyProfile(), learned: ['common-01'] } })
    const p = useProgressStore()
    await settle()

    p.markLearned('common-01', false)
    await settle()
    p.flush()
    await settle()

    expect(saved).toHaveLength(1)
    expect(saved[0].learned).toEqual([])
  })

  it('取消标记再重新标记：大白饭**不重发**（同一课只发一次，2026-10-17 夜间批）', async () => {
    const { saved, grants } = stubMiai()
    const p = useProgressStore()
    await settle()

    // 头一次学完 → 发饭（这是基线：0 → 1 的那一发必须发出去）
    p.markLearned('common-01', true)
    await settle()
    expect(grants).toHaveLength(1)
    // 我搞错了，取消
    p.markLearned('common-01', false)
    await settle()
    // 再标回来 —— 修前这里会**再发一次**：取消/重标可在日上限内白刷饭
    p.markLearned('common-01', true)
    await settle()

    expect(grants).toHaveLength(1)
    // 别的课不受影响（幂等是按 lessonId 判的，不是"整节课只发一次全局"）
    p.markLearned('common-02', true)
    await settle()
    expect(grants).toHaveLength(2)

    // 落盘侧照旧：重标回来的这一课在盘上、history 是追加型（两条记录，无害）
    p.flush()
    await settle()
    expect(saved[0].learned).toEqual(['common-01', 'common-02'])
  })

  it('保存失败出声（2026-10-17 夜间批）：写口抛错时弹 error 吐司，不再是零提示', async () => {
    stubMiai()
    const p = useProgressStore()
    await settle()

    // 磁盘满/只读/被锁的替身：写口直接抛（不是冲突 —— 冲突有自己的重载重放路）
    ;(window.miai as unknown as { saveProfile: unknown }).saveProfile = () =>
      Promise.reject(new Error('stub: disk full'))
    p.markLearned('common-01', true)
    await settle()
    p.flush()
    await settle()

    expect(toasts.at(-1)?.text).toBe(TOAST.PROFILE_SAVE_FAILED)
    expect(toasts.at(-1)?.type).toBe('error')
  })

  it('读档失败出声（2026-10-17 夜间批）：IPC 抛错弹 STORE_READ_FAILED，别让用户以为数据被删了', async () => {
    stubMiai()
    ;(window.miai as unknown as { getProfile: unknown }).getProfile = () =>
      Promise.reject(new Error('stub: ipc down'))
    const p = useProgressStore()
    await settle()

    // 读失败照旧落到初始空档并置 loaded（现状不变）；变的是**不再静默**
    expect(p.loaded).toBe(true)
    expect(toasts.at(-1)?.text).toBe(TOAST.STORE_READ_FAILED)
    expect(toasts.at(-1)?.type).toBe('error')
  })

  it('读回来的档案会被用上（不是永远显示空档）', async () => {
    stubMiai({ existing: { ...emptyProfile(), learned: ['common-01', 'common-02'] } })
    const p = useProgressStore()
    await settle()

    expect(p.loaded).toBe(true)
    expect(p.learnedSet.has('common-01')).toBe(true)
    expect(p.profile.stats.learnedCount).toBe(2)
  })
})

describe('本地写协议：戳与冲突（P10.6）', () => {
  it('读来的戳原样带去第一次写，写回的新戳续上下一次', async () => {
    const { saved, saveStamps } = stubMiai()
    const p = useProgressStore()
    await settle()

    p.markLearned('common-01', true)
    await settle()
    p.flush()
    await settle()
    expect(saved).toHaveLength(1)
    // 第一写带的是读档时那份戳（替身的主进程侧 rev 从 0 起）
    expect(saveStamps[0]).toEqual({ epoch: 0, rev: 0 })

    p.markLearned('common-02', true)
    await settle()
    p.flush()
    await settle()
    expect(saved).toHaveLength(2)
    // 第二写带的是第一写回话里的新戳（写成功 → 主进程 rev+1）——
    // 转发链断在哪一端，下一次写都会撞 STALE_REV
    expect(saveStamps[1]).toEqual({ epoch: 0, rev: 1 })
  })

  it('冲突：重载最新一份、把本地操作重放上去、带新戳再写 —— 两边的学习记录都不丢', async () => {
    const { saved, saveStamps, conflictNext } = stubMiai()
    const p = useProgressStore()
    await settle()

    // 载入之后，"别的写口"（同步引擎并入了云端数据）把档案推到了 common-09 已学
    conflictNext({
      ...emptyProfile(),
      learned: ['common-09'],
      history: [{ lessonId: 'common-09', finishedAt: '2026-09-01T00:00:00.000Z' }],
      stats: { learnedCount: 1, practicedCount: 0, streakDays: 0 }
    })

    p.markLearned('common-01', true)
    await settle()
    p.flush()
    await settle()

    // 第一次写撞屏障（一个字节没写），重载 + 重放后第二次写成 —— 只落一次盘
    expect(saveStamps).toHaveLength(2)
    expect(saved).toHaveLength(1)
    // 云端刚并进来的那门课没被本地顶掉，本地这次操作也没丢
    expect(saved[0].learned).toEqual(['common-09', 'common-01'])
    expect(saved[0].stats.learnedCount).toBe(2)
    // 重写带的是冲突回话里的新戳（冲突本身也把主进程 rev 推进了）
    expect(saveStamps.at(-1)).toEqual({ epoch: 0, rev: 1 })
  })
})

describe('每日签到（P3 ①）', () => {
  it('签到成功：日键用本地今天、checkin 换上**主进程回的那份**、streak 镜像同步、戳续上', async () => {
    const day = todayKey()
    const { saved, saveStamps, checkinCalls } = stubMiai({
      checkinResult: {
        ok: true,
        awarded: true,
        streakReset: false,
        checkin: { lastDate: day, streakDays: 3, totalDays: 7, days: ['2026-09-01', day] },
        riceGranted: true,
        riceCredited: 2,
        // 载入时的戳是 rev 0；签到这次 RMW 把主进程侧的 rev 推到了 7 ——
        // 下面靠"下一次写带的戳"分辨 noteStamp 到底有没有发生
        stamp: { epoch: 0, rev: 7 }
      }
    })
    const p = useProgressStore()
    await settle()

    const ok = await p.checkInToday()
    expect(ok).toBe(true)
    // 签的是本地"今天"：主进程不知道用户时区，日键只能渲染层算
    expect(checkinCalls).toEqual([day])
    // 换上的是回包那份（含新 days 与 streakDays），不是界面自己拼的乐观值
    expect(p.checkin.days).toContain(day)
    expect(p.profile.stats.streakDays).toBe(3)
    expect(p.checkedInToday).toBe(true)

    /*
     * 签到的落盘在**主进程那条通道里已经完成了**（判重 + 写档 + 发饭都是 RMW）。
     * 渲染层换上镜像只是"收话对齐"——镜像变化**不该**再触发一次整份回写：
     * 账本空 = 没有未保存的东西，writeNow 是 no-op（回写等于把主进程刚写的
     * 那份原样顶一遍，白翻一个 rev）。
     */
    await settle()
    p.flush()
    await settle()
    expect(saved).toHaveLength(0)

    /*
     * 但**戳必须续上**：签到写口动了档案，渲染层手里载入时那份戳已经过期。
     * 紧接着的真实本地写要带**回包里的新戳**（'noteStamp(res.stamp)' 的对错
     * 全看这一条），否则真机上会撞 STALE_REV 假冲突 —— "别人改过"的警报被
     * 我们自己的签到写口误触。
     */
    p.markLearned('common-01', true)
    await settle()
    p.flush()
    await settle()
    expect(saved).toHaveLength(1)
    // 镜像是快照的一部分：这份写出去的 checkin 已经是回包那份
    expect(saved[0].checkin.days).toContain(day)
    expect(saved[0].stats.streakDays).toBe(3)
    // 带上的是签到回包的戳，不是载入时的
    expect(saveStamps.at(-1)).toEqual({ epoch: 0, rev: 7 })
  })

  it('成功播报：只说一句、是 success、碗数取**真进盒**的 riceCredited', async () => {
    const { checkinCalls } = stubMiai({ checkinResult: submittedToday() })
    const p = useProgressStore()
    await settle()

    await p.checkInToday()

    expect(checkinCalls).toHaveLength(1)
    expect(toasts).toHaveLength(1)
    expect(toasts[0].text).toBe(TOAST.CHECKIN_OK(2))
    expect(toasts[0].type).toBe('success')
    // 别把"饭没端稳"/"满仓"也弹了 —— 各出口互斥
    expect(toasts.some((t) => t.text === TOAST.CHECKIN_RICE_FAILED())).toBe(false)
    expect(toasts.some((t) => t.text === TOAST.CHECKIN_RICE_FULL())).toBe(false)
  })

  it('半仓（V1-42）：碗数播报取 riceCredited 的真值（进 1 碗就只说 1 碗）', async () => {
    const { checkinCalls } = stubMiai({
      checkinResult: { ...submittedToday(), riceCredited: 1 }
    })
    const p = useProgressStore()
    await settle()

    await p.checkInToday()

    expect(checkinCalls).toHaveLength(1)
    expect(toasts).toHaveLength(1)
    expect(toasts[0].text).toBe(TOAST.CHECKIN_OK(1))
    expect(toasts[0].type).toBe('success')
  })

  it('awarded=false（今天已签过）：**什么也不弹**，但 checkin 照换（幂等重放不是错误）', async () => {
    const day = todayKey()
    const { checkinCalls } = stubMiai({
      checkinResult: {
        ok: true,
        awarded: false,
        streakReset: false,
        checkin: { lastDate: day, streakDays: 1, totalDays: 1, days: [day] },
        riceGranted: false,
        riceCredited: null,
        stamp: { epoch: 0, rev: 0 }
      }
    })
    const p = useProgressStore()
    await settle()

    const ok = await p.checkInToday()
    expect(ok).toBe(true)
    expect(checkinCalls).toHaveLength(1)
    // 用户看到的按钮本来就是"今天签过啦"；再弹一句是噪音
    expect(toasts).toHaveLength(0)
  })

  it('riceGranted=false（签到记下了、饭没发到）：弹 warn，绝不说"到手了"', async () => {
    const { checkinCalls } = stubMiai({
      checkinResult: { ...submittedToday(), riceGranted: false, riceCredited: null }
    })
    const p = useProgressStore()
    await settle()

    await p.checkInToday()

    expect(checkinCalls).toHaveLength(1)
    expect(toasts).toHaveLength(1)
    expect(toasts[0].text).toBe(TOAST.CHECKIN_RICE_FAILED())
    expect(toasts[0].type).toBe('warn')
  })

  it('饭盒满仓（V1-42/空转[1]）：grant 执行了但进 0 碗 → 弹"满仓" warn，绝不报"到手"', async () => {
    const { checkinCalls } = stubMiai({
      checkinResult: { ...submittedToday(), riceGranted: true, riceCredited: 0 }
    })
    const p = useProgressStore()
    await settle()

    await p.checkInToday()

    expect(checkinCalls).toHaveLength(1)
    expect(toasts).toHaveLength(1)
    expect(toasts[0].text).toBe(TOAST.CHECKIN_RICE_FULL())
    expect(toasts[0].type).toBe('warn')
    // "满仓"和"没端稳"是两句不同的话（下一步不同）：不许混用
    expect(toasts.some((t) => t.text === TOAST.CHECKIN_RICE_FAILED())).toBe(false)
    expect(toasts.some((t) => t.text.startsWith('签到成功'))).toBe(false)
  })

  it('断签（空转[2]）：吐司**先说断签**再报饭 —— 主进程说 streakReset 就如实转述', async () => {
    // 复核实测的原始现象：连签 30 天的档隔天再签，吐司只提大白饭，
    // 卡片上的「30 天」当场变「1 天」—— 断签这条事实没有任何地方说过。
    // 判定在 applyCheckin（主进程侧），这里守的是渲染层**转述不吞**
    const { checkinCalls } = stubMiai({ checkinResult: { ...submittedToday(), streakReset: true } })
    const p = useProgressStore()
    await settle()

    await p.checkInToday()

    expect(checkinCalls).toHaveLength(1)
    expect(toasts).toHaveLength(1)
    expect(toasts[0].text).toBe(TOAST.CHECKIN_OK(2, true))
    expect(toasts[0].type).toBe('success')
    // 正常版那句**不许再出现**：同一次签到弹两条互相打脸的播报比不弹还差
    expect(toasts.some((t) => t.text === TOAST.CHECKIN_OK(2))).toBe(false)
  })

  it('断签 + 饭盒满仓：断签说明与满仓说明**两句都在**（谁也别盖过谁）', async () => {
    stubMiai({ checkinResult: { ...submittedToday(), riceCredited: 0, streakReset: true } })
    const p = useProgressStore()
    await settle()

    await p.checkInToday()

    expect(toasts).toHaveLength(1)
    expect(toasts[0].text).toBe(TOAST.CHECKIN_RICE_FULL(true))
    expect(toasts[0].type).toBe('warn')
    expect(toasts.some((t) => t.text === TOAST.CHECKIN_RICE_FULL())).toBe(false)
  })

  it('没断签（streakReset=false）：播报与从前**逐字节相同** —— 别把正常签到说成断签', async () => {
    const { checkinCalls } = stubMiai({ checkinResult: submittedToday() })
    const p = useProgressStore()
    await settle()

    await p.checkInToday()

    expect(checkinCalls).toHaveLength(1)
    expect(toasts).toHaveLength(1)
    expect(toasts[0].text).toBe(TOAST.CHECKIN_OK(2))
    expect(toasts.some((t) => t.text === TOAST.CHECKIN_OK(2, true))).toBe(false)
  })

  it('写盘失败（reject）：弹 error、本地档案**不动**、按钮还能再按（再按能成）', async () => {
    const stub = stubMiai({ failCheckin: true })
    const p = useProgressStore()
    await settle()

    // 快照要展平着抄：p.checkin 是 Vue 的响应式代理，structuredClone 克隆不了它
    // （这正是本文件头号回归的同一个坑，见文件头）
    const before = { ...p.checkin, days: [...p.checkin.days] }
    const ok = await p.checkInToday()
    expect(ok).toBe(false)
    // 失败不标记：月历不许出现"其实没存下来的钩"
    expect(p.checkin).toEqual(before)
    expect(p.checkedInToday).toBe(false)
    expect(toasts.at(-1)?.text).toBe(TOAST.CHECKIN_FAILED)
    expect(toasts.at(-1)?.type).toBe('error')

    // 修好了再按一次 —— 这条路必须真的能走通，不然失败就是死路
    stub.recover()
    expect(await p.checkInToday()).toBe(true)
    expect(stub.checkinCalls).toHaveLength(2)
  })

  it('档案还没读完就按签到：不发车、不弹泡（等读到了才算数）', async () => {
    const { checkinCalls } = stubMiai({ hang: true })
    const p = useProgressStore()

    expect(await p.checkInToday()).toBe(false)
    expect(checkinCalls).toHaveLength(0)
    expect(toasts).toHaveLength(0)
  })

  it('checkedInToday 的判据与主进程闸门同一个（days.includes 今天，不是看 lastDate）', async () => {
    const day = todayKey()
    stubMiai()
    const p = useProgressStore()
    await settle()

    // 交叉用例才是判别性的：lastDate 和 days 故意**互相对不上**
    // ① lastDate 空、days 里有今天 → 签过（只看 lastDate 的实现会在这一格错）
    p.profile.checkin = { lastDate: null, streakDays: 1, totalDays: 1, days: [day] }
    expect(p.checkedInToday).toBe(true)
    // ② lastDate 写的是今天、days 里没有 → **没签过**（days 才是闸门；
    //    这种档在"时钟回拨后又拨回来"之后真的可能出现）
    p.profile.checkin = { lastDate: day, streakDays: 1, totalDays: 1, days: ['2026-09-30'] }
    expect(p.checkedInToday).toBe(false)
    // ③ days 里只有别的日子 → 没签过
    p.profile.checkin = { lastDate: null, streakDays: 0, totalDays: 3, days: ['2026-09-29', '2026-09-30'] }
    expect(p.checkedInToday).toBe(false)
  })
})

/** 一份「今天签到成功、发了饭」的回包（多条用例的底座）。默认不是断签 */
function submittedToday(): CheckinSubmitResult {
  const day = todayKey()
  return {
    ok: true,
    awarded: true,
    streakReset: false,
    checkin: { lastDate: day, streakDays: 1, totalDays: 1, days: [day] },
    riceGranted: true,
    riceCredited: 2,
    stamp: { epoch: 0, rev: 0 }
  }
}
