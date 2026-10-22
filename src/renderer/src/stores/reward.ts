/**
 * 奖励 store（学习闭环 §7）：每天第一次完成复习 → 抽一张图 → 主进程记账 → 弹窗。
 * 2026-10-17 主人改口径：**不再要求全对**，考得好不好都有图；全对只额外
 * 记进 `perfectPasses`（仓库页的「全对次数」）。
 *
 * 【为什么整条流程收在这儿，不摊在 QuizOverlay 或 finish() 里】
 * 「抽哪张」要读档案（`profile.rewards.gallery`）、「记账」要发 IPC、
 * 「弹窗」要一个跨越组件的状态 —— 三样分散在三个地方的话，
 * 「什么时候算发过奖」就有了三份理解。收成一个动作：`grant()`。
 *
 * 【为什么先记账、后弹窗，记账失败就不弹】
 * 弹窗一出现就等于对用户宣布「这张图是你的了」。要是那次 `profileStore.write`
 * 失败了（盘满 / 没权限），图根本没进图鉴 —— 下次复习抽到的是另一张，
 * 用户手里的"图鉴"和记忆里的对不上号，而没有任何地方能解释这个差异。
 * 所以失败时如实报一句、不庆祝。**不许默认回退为成功** —— 弹了窗就是
 * "发过了"的声明。
 *
 * 【三种结果的下一步（V1-38）】主进程回话里的 `kind` 决定庆祝方式：
 *   · granted     → 弹奖励窗（唯一弹窗的一种）；
 *   · daily-limit → 今天已经发过一张了（每日一次），toast 说明、**不弹空窗**；
 *   · full        → 图库全收集完了，toast 说明、不弹空窗。
 * 后两种里这一轮全对**可能**是真的：perfectPasses 已在主进程按 perfect 记账、
 * 档案也真写盘了 —— 所以内存替换、noteStamp、广播三件事三种结果**都要做**，
 * 只在"要不要弹窗"这一步分叉。
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useProgressStore } from './progress'
import { pickRewardId } from '../../../shared/gallery'
import { notifyLocalWrite } from '../lib/local-write-bus'
import { refreshRewardOverrides } from '../lib/reward-overrides'
import { toast } from '../components/base/toast'
import { TOAST } from '../lib/copy'
import type { ProfileRewards } from '../../../shared/types'
import type { BoxStamp } from '../../../shared/doc-write'
import type { RewardGrantKind } from '../../../shared/gallery'

/** 待展示的奖励。`id` 为 null 只在防御路径上出现（正常流程满池走 toast 不弹窗） */
export interface PendingReward {
  id: string | null
  /** 主进程合并后返回的那一份 —— 弹窗上的「图鉴 N/总数」拿它现算，不另存一份计数 */
  rewards: ProfileRewards
  /** 这一轮是否全对（只影响弹窗标题的那句庆祝话，不参与发图裁决） */
  perfect: boolean
}

export const useRewardStore = defineStore('reward', () => {
  const progress = useProgressStore()

  /** 非 null 时弹奖励窗（RewardDialog 挂在 App 上，见那儿的注释） */
  const pending = ref<PendingReward | null>(null)

  /**
   * 完成了一轮每日复习：在**还没得到的**图里等概率抽一张 → 请主进程合并记账
   * → 按结果庆祝。`perfect` = 这一轮是否全对；它只决定「全对次数」台账，
   * 以及弹窗标题用哪一句（发不发图由主进程按每日一次裁决，不看它）。
   *
   * 抽奖放渲染层是因为弹窗当场就要用这个 id 把图显示出来；
   * 主进程那边只做校验与落盘（它也会挡重复的 id、挡"今天已经发过"，
   * 见 shared/gallery.ts 的 grantReward）。
   */
  async function grant(perfect: boolean): Promise<void> {
    const id = pickRewardId(progress.profile.rewards.gallery)
    let res: { rewards: ProfileRewards; stamp: BoxStamp; kind: RewardGrantKind }
    try {
      res = await window.miai.grantReward(id, perfect)
    } catch {
      // 见文件头：记账失败就不庆祝，如实说一句
      toast(TOAST.REWARD_FAILED, 'error')
      return
    }
    /*
     * 把主进程那份合并结果换进内存 —— 下次 `pickRewardId` 靠它才知道
     * 这张已经到手了。只改本地不写盘是不行的：磁盘那份**归主进程写**
     * （profile:save 会丢弃入参里的 rewards，见 preload 的注释），
     * 所以这里必须先经过 grantReward 这一次 IPC，再拿返回值覆盖本地。
     *
     * 拿回话里的**新戳**对齐本地写协议（P10.6）：这次 RMW 顶掉了渲染层手里
     * 那份戳 —— 不对齐的话，下面 `profile.rewards = …` 触发的防抖保存会撞
     * STALE_REV 假冲突（"别人改过"的警报，被我们自己的写口误触）。
     *
     * 三种 kind 都要做这一段：daily-limit / full 里盘上的台账也可能变了
     * （全对时 perfectPasses +1），内存不换就是两边对不上，下一次保存还会
     * 拿旧数覆盖。
     */
    progress.noteProfileStamp(res.stamp)
    progress.profile.rewards = res.rewards
    // 发图也是主进程对档案的 RMW（走 grantReward 而不是 doc-writer）——
    // 档案在盘上真变了，手动补一次广播（签到那条同款理由，见 progress.checkInToday）
    notifyLocalWrite('profile')
    if (res.kind !== 'granted') {
      // 没有新图到手：**不弹空窗**，只说清是哪一种（V1-38）
      toast(res.kind === 'daily-limit' ? TOAST.REWARD_DAILY_DONE : TOAST.REWARD_ALL_COLLECTED, 'info')
      return
    }
    // 弹窗前刷新覆盖映射（2026-10-16）：「屏幕上这张」必须与「保存图片」
    // 取到的是同一张（覆盖机制两处同吃的显示侧，见 lib/reward-overrides.ts）
    await refreshRewardOverrides()
    pending.value = { id, rewards: res.rewards, perfect: perfect === true }
  }

  function dismiss(): void {
    pending.value = null
  }

  return { pending, grant, dismiss }
})
