/**
 * 桌宠快照的渲染层读口（2026-10-06）。设置页的「大肥鱼」卡用它。
 *
 * 【为什么是一份"镜像快照"而不是各组件自己问主进程】
 * 状态的真源在**主进程**（pet.json + 心跳衰减）：饱食度每 3 分钟自己会掉，
 * 学习发奖、喂饭、换模式也都会改它。渲染层只需要一份跟着广播走的镜像 ——
 * 所有窗口收到的是同一条 `pet:state` 广播，主进程不会为某个窗口单独算一份。
 *
 * 【失败怎么办】读不到（极早期、测试环境）就是 `null`，界面画"未启用"态。
 * 这里**不做任何重试**：桌宠是挂件，读不到就先不显示，等下一次广播自然到位。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  PET_MOOD_HAPPY_AT,
  petAffectionTier,
  type PetAction,
  type PetAffectionTier,
  type PetFace,
  type PetMode,
  type PetRewardKind,
  type PetSize,
  type PetSnapshot
} from '../../../shared/pet'

/** 轮询周期（毫秒）。饱食度/好感都是分钟级慢变量：5 秒跟得上，又不至于把 IPC 当心跳刷 */
export const PET_POLL_MS = 5000

export const usePetStore = defineStore('pet', () => {
  /** 最近一次快照。`null` = 还没读到（或桌宠没起来） */
  const snap = ref<PetSnapshot | null>(null)

  /** 广播只订阅一次（pinia 的 setup 在首次 usePetStore 时跑一次） */
  let subscribed = false

  async function init(): Promise<void> {
    if (subscribed) return
    subscribed = true
    try {
      snap.value = await window.miai.petInit()
    } catch {
      snap.value = null
    }
    try {
      window.miai.onPetState((s) => {
        snap.value = s
      })
    } catch {
      /* 订阅不上就当只读一次，见文件头 */
    }
  }

  /** 做一个动作并把返回的快照换上（主进程返回的就是动作之后的状态） */
  async function act(action: PetAction): Promise<void> {
    try {
      snap.value = await window.miai.petAct(action)
    } catch {
      /* 保持旧快照 */
    }
  }

  /**
   * 拉一次新快照换上（`ensurePetPoller` 的首拉与心跳都走这里）。
   *
   * ⚠️ **不能改调 `init()` 当轮询**：上面那句 `if (subscribed) return`
   * 是"只订阅一次"的守卫，第二次调直接返回、**一个字节都不拉** ——
   * 拿它轮询的话，界面会永远停在第一次那一刻的旧值，而且不报任何错。
   */
  async function pull(): Promise<void> {
    try {
      snap.value = await window.miai.petInit()
    } catch {
      /* 拉不到就保持旧快照 —— 桌宠是挂件，读不到先不显示 */
    }
  }

  /** 轮询器的引用计数与表把（见 `ensurePetPoller`；一个 store 实例一份） */
  let pollRefs = 0
  let pollTimer: number | null = null

  /**
   * 唯一的桌宠轮询器（P3 ④，2026-10-08）：refcount 5 秒，**全应用一条**。
   *
   * 【为什么必须收敛成一条】新引擎（dsh-pet 宿主）没有状态推送广播（见
   * `pet:state` 通道注释），所以"最新的饱食度/好感"只能靠轮询拿。此前只有
   * 总览页自持一条 interval；好感度爱心挂在**侧栏**（常驻组件）之后，
   * 各持一条就成了"几条 5s IPC 空转"，而且各自的退还时机（页签切换、
   * 侧栏 rail 切换）稍有出入就会漏停一条 —— 谁也不看它、它谁也停不掉。
   *
   * 【协议】返回退订函数；调用方在 `onBeforeUnmount` 里调它（或
   * `release = null` 前先调）。**第一个**引用者触发立即拉一次 + 上定时器；
   * **最后一个**引用者退订时停表。退订函数幂等 —— 重复调用不会把
   * refcount 减穿（那会让表停得比最后一个引用者早）。
   */
  function ensurePetPoller(): () => void {
    pollRefs += 1
    if (pollRefs === 1) {
      void pull()
      pollTimer = window.setInterval(() => void pull(), PET_POLL_MS)
    }
    let released = false
    return () => {
      if (released) return
      released = true
      pollRefs -= 1
      if (pollRefs === 0 && pollTimer !== null) {
        window.clearInterval(pollTimer)
        pollTimer = null
      }
    }
  }

  const satiety = computed(() => snap.value?.satiety ?? 0)
  const rice = computed(() => snap.value?.rice ?? 0)
  const mood = computed(() => snap.value?.mood ?? null)
  /**
   * 「脸色」= 心情 + 时段 + 瞬时情绪（饿 / 傲娇 / 兴奋 / 夜里打盹）。
   * `null` = 快照还没到 —— 界面**必须**区分它和"平静"（没有 null 的话，
   * 设置卡会把"还没读上来"显示成某个具体心情，那是在替鱼说谎）。
   * 派生规则（含"情绪过期现算"）全在 shared/pet.ts 的 petFace，这里只做镜像。
   */
  const face = computed<PetFace | null>(() => snap.value?.face ?? null)
  const mode = computed(() => snap.value?.mode ?? null)
  /** 体型（三档之一）。`null` = 快照还没到 —— 设置卡据此把三个按钮灰着 */
  const size = computed(() => snap.value?.size ?? null)
  const enabled = computed(() => snap.value?.enabled ?? false)
  /** 心情是不是"元气"档（设置卡的进度条配色用；阈值只此一份，在 shared/pet.ts） */
  const thriving = computed(() => (snap.value?.satiety ?? 0) >= PET_MOOD_HAPPY_AT)
  /**
   * 好感度（P3 ④ 镜像）。`null` = 快照还没到 —— 界面**必须**区分它和"0 分"：
   * 侧栏画 `--%` 而不是 `0%`（0 是"处得很差"，还没读到就是还没读到，
   * 同 face 的 null 口径：不许替鱼说谎）。
   */
  const affection = computed<number | null>(() => snap.value?.affection ?? null)
  /**
   * 好感五档（cold/familiar/close/like/love）。档界值（20/40/60/80）与档名
   * 的真源只在 shared/pet.ts 的 petAffectionTier；这里只做镜像。
   * `null` = 快照还没到（同 affection）。
   */
  const affectionTier = computed<PetAffectionTier | null>(() =>
    snap.value ? petAffectionTier(snap.value.affection) : null
  )

  /**
   * 「刚有一碗大白饭**真进盒**」的滴答计数（V2-22）。
   *
   * 答题界面（QuizOverlay）watch 它闪一枚 🍚 +1 —— 为什么不是一个布尔
   * 「正在显示」：每次答对都要重新起一次动画，计数递增是"又一次"的天然身份
   * （照 toast / 气泡那套"事件计数"的先例）。
   *
   * 加一的判据在 stores/quiz.ts 的 grantPetRiceOnce：拿 grant 成功回话里的
   * 新快照跟发之前的余额比，**真涨了**才 ping。日上限 / 满仓那几笔 rice 不动，
   * 界面就不许报 +1（不许默认回退为成功——回执也是账）。
   * 放在 pet store 而不是 quiz store：这是饭盒的账，不是答题的账；
   * 将来别的赚饭入口（学完课/复习）想加同款回执，也走这一条。
   */
  const riceInTick = ref(0)
  function pingRiceIn(): void {
    riceInTick.value += 1
  }

  return {
    snap,
    satiety,
    rice,
    mood,
    face,
    mode,
    size,
    enabled,
    thriving,
    affection,
    affectionTier,
    riceInTick,
    pingRiceIn,
    init,
    pull,
    ensurePetPoller,
    act,
    grant: (reward: PetRewardKind) => act({ action: 'grant', reward }),
    feed: () => act({ action: 'feed' }),
    pat: () => act({ action: 'pat' }),
    setMode: (m: PetMode) => act({ action: 'mode', mode: m }),
    setSize: (s: PetSize) => act({ action: 'size', size: s }),
    setEnabled: (on: boolean) => act({ action: on ? 'show' : 'hide' })
  }
})
