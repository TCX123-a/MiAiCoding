/**
 * 奖励 store（stores/reward.ts）—— V1-38「每日一次 + 满池不空弹」的三分支
 *
 * 【这个文件在守什么】
 * 发奖链路的最后一步是「**要不要弹奖励窗**」：弹窗一出现就等于对用户宣布
 * 「这张图是你的了」。主进程回的 `kind` 有三种，只有 granted 该弹：
 *   · granted     → pending 立起来（弹窗）；
 *   · daily-limit → 今天已经发过一张（每日一次），toast 说明、**不弹空窗**；
 *   · full        → 图库全收集完，toast 说明、**不弹空窗**。
 * 2026-10-17 起「发不发图」不看分数：grant(perfect) 的 perfect 只决定
 * 台账与弹窗标题那句；所以三种结果里 perfectPasses 变没变，要看传进去的旗
 * （主进程按它 +1，这层只管换内存）。三种结果都要把内存换上、补一次本地写
 * 广播 —— 只在"弹不弹"这一步分叉。
 *
 * 【为什么要钉住"抽的是哪张"】`id` 是渲染层抽的（弹窗当场要用它显示图），
 * 主进程只校验。抽奖本身（等概率、全得到返回 null）由 shared 的单测钉着，
 * 这里钉的是**接线**：满池时送出去的确实是 null（而不是随便一张）。
 *
 * 这些全是「界面上看不出异常」的行为（不弹窗、多弹窗、战绩没换上都不报错），
 * 只能靠机器守着。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { stubMiai } from './miai-stub'
import { toasts } from '../../components/base/toast'
import { TOAST } from '../../lib/copy'
import { onLocalWrite } from '../../lib/local-write-bus'
import { useProgressStore } from '../progress'
import { useRewardStore } from '../reward'
import { GALLERY_IDS } from '../../../../shared/gallery'
import type { ProfileRewards } from '../../../../shared/types'

/** 让在飞的微任务/定时器跑一轮（progress 在 setup 里就 `void load()`） */
const settle = () => new Promise((r) => setTimeout(r, 0))

/** 图库里"只差最后一张"与"已经集齐"两个极端 —— 抽奖结果因此是确定的 */
const ALL_BUT_LAST = GALLERY_IDS.slice(0, -1)
const LAST = GALLERY_IDS[GALLERY_IDS.length - 1]

/** 奖励台账（当前版本形状；不写死数字的规矩不适用 —— 这里就是三字段本身） */
function rewards(over: Partial<ProfileRewards> = {}): ProfileRewards {
  return { gallery: [], perfectPasses: 0, lastImageDay: null, ...over }
}

/**
 * 装假 window → 建 progress → 等读档完 → 摆好奖励台账 → 建 reward store。
 * 顺序不能换：progress 在 setup 时就读 `window`（挂 beforeunload）。
 */
async function setup(
  owned: ProfileRewards,
  grant?: Parameters<typeof stubMiai>[0]
) {
  const h = stubMiai(grant)
  const progress = useProgressStore()
  await settle()
  progress.profile.rewards = owned
  const reward = useRewardStore()
  return { h, progress, reward }
}

beforeEach(() => {
  setActivePinia(createPinia())
  // toast 是模块级单例：不清的话上一条弹的气泡会被下一条数进去（假绿/假红都从这里来）
  toasts.splice(0, toasts.length)
})

describe('grant()：三种 kind 三种下一步（V1-38）', () => {
  it('granted：弹窗立起来，id 就是抽中的那张，rewards 换成主进程回的那份', async () => {
    const returned = rewards({ gallery: GALLERY_IDS.slice(), perfectPasses: 4, lastImageDay: '2026-10-16' })
    const { h, progress, reward } = await setup(
      rewards({ gallery: [...ALL_BUT_LAST], perfectPasses: 3, lastImageDay: '2026-10-15' }),
      { grantResult: { rewards: returned, stamp: { epoch: 0, rev: 9 }, kind: 'granted' } }
    )

    await reward.grant(true)

    // 只差最后一张 → 抽出来的必须就是它（接线：抽的 id 真的送出去了）
    expect(h.grantCalls).toEqual([LAST])
    // 全对旗真的送到了主进程（发图不看它，但台账要靠它）
    expect(h.grantPerfects).toEqual([true])
    expect(reward.pending?.id).toBe(LAST)
    expect(reward.pending?.perfect).toBe(true)
    // 弹窗上的进度拿的就是主进程回的那份（不是本地自己拼的）
    expect(reward.pending?.rewards.perfectPasses).toBe(4)
    // 内存换上主进程那份 —— 下次 pickRewardId 靠它才知道这张到手了
    expect(progress.profile.rewards.gallery).toEqual(GALLERY_IDS.slice())
    expect(progress.profile.rewards.perfectPasses).toBe(4)
    expect(progress.profile.rewards.lastImageDay).toBe('2026-10-16')
    // 正常发图不弹任何 toast（弹窗本身就是播报）
    expect(toasts).toHaveLength(0)
  })

  it('daily-limit：**不弹空窗**、只说一句；但战绩照样换上、广播照样发', async () => {
    const before = rewards({ gallery: [...ALL_BUT_LAST], perfectPasses: 3, lastImageDay: '2026-10-16' })
    // 主进程的裁决：今天已经发过 → gallery 不变，perfectPasses 照 +1
    const after = rewards({ gallery: [...ALL_BUT_LAST], perfectPasses: 4, lastImageDay: '2026-10-16' })
    const { progress, reward } = await setup(before, {
      grantResult: { rewards: after, stamp: { epoch: 0, rev: 9 }, kind: 'daily-limit' }
    })
    const wrote: string[] = []
    const off = onLocalWrite((doc) => wrote.push(doc))
    try {
      await reward.grant(true)
    } finally {
      off()
    }

    expect(reward.pending).toBeNull() // 关键：不弹窗
    expect(toasts).toHaveLength(1)
    expect(toasts[0].type).toBe('info') // 不是错误：这是一条规矩，不是故障
    expect(toasts[0].text).toBe(TOAST.REWARD_DAILY_DONE)
    // 这一轮全对是真的：战绩换上了、盘上真变了（同步节拍器要知道）
    expect(progress.profile.rewards.perfectPasses).toBe(4)
    expect(wrote).toEqual(['profile'])
  })

  it('full：图库集齐 → 抽出来的是 null（不硬塞一张）、不弹窗、说"集齐了"', async () => {
    const full = rewards({ gallery: GALLERY_IDS.slice(), perfectPasses: 7, lastImageDay: '2026-10-15' })
    const after = rewards({ gallery: GALLERY_IDS.slice(), perfectPasses: 8, lastImageDay: '2026-10-15' })
    const { h, progress, reward } = await setup(full, {
      grantResult: { rewards: after, stamp: { epoch: 0, rev: 9 }, kind: 'full' }
    })

    await reward.grant(true)

    // 满池时渲染层抽出来就是 null（pickRewardId 的活），送出去的也是 null
    expect(h.grantCalls).toEqual([null])
    expect(reward.pending).toBeNull()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].text).toBe(TOAST.REWARD_ALL_COLLECTED)
    expect(progress.profile.rewards.perfectPasses).toBe(8)
  })

  it('记账失败（IPC 抛）：报错、不弹窗、内存一个字不改', async () => {
    const before = rewards({ gallery: [...ALL_BUT_LAST], perfectPasses: 3, lastImageDay: '2026-10-15' })
    const { progress, reward } = await setup(before, { failGrant: true })

    await reward.grant(true)

    expect(reward.pending).toBeNull()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].type).toBe('error')
    expect(toasts[0].text).toBe(TOAST.REWARD_FAILED)
    // 主进程没写成功 → 本地也不许"先换上再说"（那会让图鉴和记忆对不上）
    expect(progress.profile.rewards.perfectPasses).toBe(3)
    expect(progress.profile.rewards.gallery).toEqual([...ALL_BUT_LAST])
  })
})

describe('grant(false)：考得不好也有图（2026-10-17 口径）', () => {
  it('没全对 → 图照发：弹窗立起来、perfect 旗如实送 false、台账由主进程回话说了算', async () => {
    // 主进程照 perfect=false 裁决：发了图、perfectPasses 没动（3 → 3）
    const after = rewards({ gallery: GALLERY_IDS.slice(), perfectPasses: 3, lastImageDay: '2026-10-16' })
    const { h, progress, reward } = await setup(
      rewards({ gallery: [...ALL_BUT_LAST], perfectPasses: 3, lastImageDay: '2026-10-15' }),
      { grantResult: { rewards: after, stamp: { epoch: 0, rev: 9 }, kind: 'granted' } }
    )

    await reward.grant(false)

    expect(h.grantCalls).toEqual([LAST])
    expect(h.grantPerfects).toEqual([false])
    // 弹窗照弹，只是标题用「复习完成」那句（RewardDialog 按 pending.perfect 选）
    expect(reward.pending?.id).toBe(LAST)
    expect(reward.pending?.perfect).toBe(false)
    // 图进了图鉴；全对次数没被这轮掺进去
    expect(progress.profile.rewards.gallery).toEqual(GALLERY_IDS.slice())
    expect(progress.profile.rewards.perfectPasses).toBe(3)
  })

  it('没全对 + 今天已经发过 → 不弹窗，只说"今天已经拿过"（perfect 旗仍送出）', async () => {
    const before = rewards({ gallery: [...ALL_BUT_LAST], perfectPasses: 3, lastImageDay: '2026-10-16' })
    const { h, reward } = await setup(before, {
      grantResult: { rewards: before, stamp: { epoch: 0, rev: 9 }, kind: 'daily-limit' }
    })

    await reward.grant(false)

    expect(h.grantPerfects).toEqual([false])
    expect(reward.pending).toBeNull()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].text).toBe(TOAST.REWARD_DAILY_DONE)
  })
})
