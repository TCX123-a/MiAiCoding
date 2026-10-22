/**
 * 云同步节拍器（P10.6）：渲染层**唯一**决定「什么时候跑一轮云同步」的地方。
 *
 * 【六个触发源，全部从这里过一道闸】
 *   ① 启动后（start()）：`account.refresh()` 读到状态之后触发一轮；
 *   ② 登录成功后：对 `account.state` 的 watch —— signedIn false→true；
 *   ③ 激活/切盒后：同一个 watch —— boxAccountId 变化（盒换了 = 盘面换了）；
 *   ④ 本地写之后：local-write-bus 广播 → 防抖 LOCAL_WRITE_DEBOUNCE_MS（30s）；
 *   ⑤ 定时：PERIODIC_SYNC_MS（5 分钟）兜底 —— 别的触发源全哑了也最多漏 5 分钟；
 *   ⑥ 窗口 focus（带 FOCUS_MIN_INTERVAL_MS 冷却，防 alt-tab 风暴）+ 手动按钮
 *      （force = 跳过主进程退避窗口）。
 *   去重只有一条规则：**在飞时来的触发只置 queued，跑完补一轮**（多下合并成
 *   一轮，且绝不并发两轮 —— 引擎单飞是它的保险，这里不指望它）。
 *
 * 【两个停闸（不是节流，是"跑了也没用"）】
 *   · 客人盒（boxAccountId === null）：引擎在客人盒上恒 skipped —— 直接不发起
 *     IPC，省掉一串"空跑回合"。**state 还没读到时不拦**（启动那一轮不能等它）。
 *   · authInvalid / protocolBlocked：令牌已死 / 服务端要求更高协议 —— 再跑多少
 *     轮都是同一个结局。authInvalid 在重新登录（signedIn 再翻真）时清掉；
 *     protocolBlocked 到应用重启为止（升级客户端才是解法）。
 *
 * 【安全点协调器（applyResults）】同步轮回话里的 `changedDocs` = 主进程真的
 * 把云端数据并进了盘的那几份 —— 本 store 让对应 store 重载：profile/favorites
 * 走 doc-writer 的 `resolveExternal()`（重载 + 按账本重放未保存的操作，答题
 * 会话中自动挂起、会话结束收账），wrongbook/practice 直接重拉列表。**盘面
 * 只有主进程说得准**，这里不做任何本地的"应该变什么"推理。
 *
 * ⚠️ 本文件在 `src/renderer/src` 下、被文案闸门扫，**字符串一律英文**。
 */
import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { SyncRoundResult, UplinkResult } from '../../../shared/cloud/dto'
import type { DocType } from '../../../shared/cloud/protocol'
import { onLocalWrite } from '../lib/local-write-bus'
import { useAccountStore } from './account'
import { useFavoritesStore } from './favorites'
import { usePracticeStore } from './practice'
import { useProgressStore } from './progress'
import { useQuizStore } from './quiz'

/** 本地写之后等多久触发一轮（把连点几下合成一轮）。导出给测试 —— 写死数字会假绿 */
export const LOCAL_WRITE_DEBOUNCE_MS = 30_000
/** 定时兜底节拍：5 分钟 */
export const PERIODIC_SYNC_MS = 5 * 60_000
/** 两次"因 focus 触发"的最小间隔（按上一轮**开始**时刻算） */
export const FOCUS_MIN_INTERVAL_MS = 60_000

/** 触发源（日志/测试用；`box` = 激活/登出引起的切盒） */
export type SyncTriggerReason =
  | 'startup'
  | 'login'
  | 'box'
  | 'local-write'
  | 'periodic'
  | 'focus'
  | 'manual'

export const useCloudSyncStore = defineStore('cloud-sync', () => {
  const account = useAccountStore()

  /** 一轮（含 queued 补轮）在飞 */
  const running = ref(false)
  /**
   * V1-65：用户点过「停止」、这一轮还在收束（在飞的请求最迟 10s 超时后回话）。
   * 按钮据此显示「正在停下…」；run 退出时复位。只在 running 期间有意义。
   */
  const stopping = ref(false)
  const lastRound = ref<SyncRoundResult | null>(null)
  const lastUplink = ref<UplinkResult | null>(null)
  /** 令牌已死（任一轮报 authInvalid）—— 界面回登录页 + 停触发，重登才清 */
  const authInvalid = ref(false)
  /** 服务端要求更高协议（426）—— 全量停同步 + 升级提示，重启为止 */
  const protocolBlocked = ref(false)
  /** 轮末仍未推上去的文档（徽章显示用） */
  const pendingPush = ref<DocType[]>([])
  /**
   * 最近一次**真同步成了**（非 skipped，且至少一份文档真的对上云端）的轮次
   * 时刻（ISO）。界面「上次同步」只认它：
   *   · skipped 轮（退避/未登录）的 `at` 只是**尝试**时间，拿它冒充同步时间
   *     就是把「什么都没发」说成「刚同步过」；
   *   · 四份文档**全 failed/blocked** 的轮次同理（V1-63）：引擎在这一轮里
   *     一个包都没落成，界面却把「刚刚」献给它 —— 那也是假报。docs 里至少
   *     有一份 synced/unchanged 才算"真对上过云端"（unchanged 也是成功的
   *     对账：云端与本地一致）。docs 空数组（轮次刚开始就被 abort）不放行。
   */
  const lastDoneAt = ref<string | null>(null)

  // ---- 内部件（不出口）
  let started = false
  /** 在飞时来的触发合并成一个布尔；跑完补一轮 */
  let queued = false
  /** V1-65：用户点过「停止」—— 补轮不再跑（在飞期间攒下的触发一起作废，见 run 的循环条件） */
  let stopRequested = false
  /** 触发窗口里点过 force 的手动请求：补轮继承它（见 run 里的说明） */
  let queuedForce = false
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let periodicTimer: ReturnType<typeof setInterval> | null = null
  let unsubWrite: (() => void) | null = null
  let lastRunAtMs = 0
  let inflight: Promise<void> = Promise.resolve()

  /** 让对应 store 从主进程重读盘面（安全点协调器与切盒共用） */
  function reloadDoc(doc: DocType): void {
    if (doc === 'profile') useProgressStore().resolveExternal()
    else if (doc === 'favorites') useFavoritesStore().resolveExternal()
    else if (doc === 'wrongbook') void useQuizStore().loadWrongbook()
    else void usePracticeStore().load()
  }

  /**
   * 切盒 = 整个数据面换了：四份文档**全部**重读（不管这一轮同步有没有碰它们 ——
   * 登出/激活后盘上每一份都可能已经不是渲染层手里那份了）。
   */
  function reloadAllStores(): void {
    reloadDoc('profile')
    reloadDoc('favorites')
    reloadDoc('wrongbook')
    reloadDoc('practice')
  }

  function applyResults(res: { sync: SyncRoundResult; uplink: UplinkResult }): void {
    lastRound.value = res.sync
    lastUplink.value = res.uplink
    pendingPush.value = res.sync.pendingPush
    // 「上次同步」的门槛见 lastDoneAt 的注释（V1-63：全失败的轮次不算数）
    if (
      !res.sync.skipped &&
      res.sync.docs.some((d) => d.status === 'synced' || d.status === 'unchanged')
    ) {
      lastDoneAt.value = res.sync.at
    }
    const dead = res.sync.authInvalid || res.uplink.authInvalid
    if (dead) {
      authInvalid.value = true
      // 让账号状态翻到"未登录"（界面据此回登录页）——本地数据一律保留
      void account.refresh().catch(() => {})
    }
    if (res.sync.protocolBlocked) protocolBlocked.value = true
    for (const doc of res.sync.changedDocs) reloadDoc(doc)
  }

  /** 真跑一轮（含 queued 补轮）。触发侧只管调它，去重在这里面 */
  async function run(opts: { force?: boolean }): Promise<void> {
    running.value = true
    try {
      let force = opts.force === true
      do {
        queued = false
        lastRunAtMs = Date.now()
        let res: { sync: SyncRoundResult; uplink: UplinkResult }
        try {
          res = await window.miai.cloud.syncNow(force ? { force: true } : undefined)
        } catch {
          // invoke 抛 = 我们自己的接线 bug 或主进程异常。这轮按"没跑成"处理：
          // 不置任何旗标（下一个触发点自然重试），不假装成功
          return
        }
        /*
         * 补轮的 force 继承：由刚刚这轮**在飞期间**点过 force 的手动触发决定。
         * 不继承的话，用户在飞轮期间点「立即同步」会被悄悄降级成常规补轮 ——
         * 撞上主进程退避窗口照样 skip，按钮看起来死了。
         */
        force = queuedForce
        queuedForce = false
        applyResults(res)
        // V1-65：点过停止 = 补轮也不跑（在飞期间攒的触发一起作废 —— 用户已经
        // 表态"现在就停"，再补一轮等于把他的动作当没发生）
      } while (queued && !stopRequested && !authInvalid.value && !protocolBlocked.value)
    } finally {
      running.value = false
      stopping.value = false
      stopRequested = false
    }
  }

  /**
   * 触发一轮同步。所有触发源（含手动按钮）的唯一入口。
   * 返回的 promise 在**这一轮（含补轮）**跑完时 resolve —— 手动按钮可用它
   * 收尾；日常触发点 `void trigger(...)` 即可。
   */
  function trigger(_reason: SyncTriggerReason, opts: { force?: boolean } = {}): Promise<void> {
    if (!started) return Promise.resolve()
    if (running.value) {
      queued = true
      if (opts.force) queuedForce = true
      return inflight
    }
    if (authInvalid.value || protocolBlocked.value) return Promise.resolve()
    // pinia setup store 出口的 ref 已被拆包：account.state 就是值本身
    // （先前写成 account.state.value 恒 undefined —— 13 条测试整排红抓出来的）
    const st = account.state
    // 客人盒：引擎恒 skipped，IPC 都省了。state 未读到（null）不拦 ——
    // 启动那一轮必须发得出去，让主进程自己裁决
    if (st !== null && st.boxAccountId === null) return Promise.resolve()
    inflight = run(opts)
    return inflight
  }

  /**
   * V1-65：用户点「停止」—— 只对**在飞的那一轮**有意义（含它攒下的补轮）。
   * 语义是"不再发新的文档请求"：正在飞的那次 GET/PUT 由它自己的 10s 超时闸
   * 收束（主进程侧 cooperative，见 sync-engine 的 cancel 注释）。
   *
   * 【为什么不做"停完让按钮立刻回正常"】停下需要等在飞的请求回话（最迟 10s），
   * 这段窗口里再点「立即同步」只会排队补齐轮 —— 按钮不许假装空闲。stopping
   * 让按钮显示「正在停下…」，等 run 退出（finally 复位）才回到可点。
   *
   * 【invoke 抛异常】旗已在本进程竖好（补轮不跑、按钮进 stopping），
   * 主进程没收到旗的后果仅仅是"这一轮照常跑完"—— 不假装停成功，
   * 也不回滚本地旗（本地旗管的补轮与会话本次触发照样停）。
   */
  async function cancelNow(): Promise<void> {
    if (!running.value) return
    stopRequested = true
    stopping.value = true
    try {
      await window.miai.cloud.syncCancel()
    } catch {
      /* 接线异常：见上，旗留着 */
    }
  }

  function onFocus(): void {
    // alt-tab 风暴：一轮刚跑过就不为每次聚焦再跑一遍
    if (Date.now() - lastRunAtMs < FOCUS_MIN_INTERVAL_MS) return
    void trigger('focus')
  }

  /**
   * 开机（App.vue onMounted 调一次；幂等）。先把监听装好，再读账号状态，
   * 最后触发启动那一轮 —— 顺序反了的话"启动即登录态"的首轮会被停闸挡掉。
   */
  async function start(): Promise<void> {
    if (started) return
    started = true

    /*
     * 本地写广播 → 防抖 → 一轮。bus 带 doc 参数，这里**不看它**：
     * 该推哪些文档由同步轮自己从盘上重算（主进程的账本才是权威），
     * 在渲染层攒一个"写过什么"的集合是第二份真源，迟早跟盘对不上。
     */
    unsubWrite = onLocalWrite(() => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        void trigger('local-write')
      }, LOCAL_WRITE_DEBOUNCE_MS)
    })

    periodicTimer = setInterval(() => void trigger('periodic'), PERIODIC_SYNC_MS)
    window.addEventListener('focus', onFocus)

    try {
      await account.refresh()
    } catch {
      /* 状态读口失败不挡节拍：各触发点各自会再试 */
    }
    /*
     * 重启后恢复的会话手里没有用户名（登录回话只在内存里活过一次）——
     * 去服务器补一个。放在这里而不是账号页里：侧栏身份区也要这个名字，
     * 它不看账号页。探测失败静默（probeSession 自己吞），不挡下面的启动轮。
     */
    if (account.signedIn && account.username === null) void account.probeSession()
    void trigger('startup')
  }

  /** 下线（测试收尾用；真实应用一只活到进程结束） */
  function stop(): void {
    if (!started) return
    started = false
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (periodicTimer) {
      clearInterval(periodicTimer)
      periodicTimer = null
    }
    window.removeEventListener('focus', onFocus)
    unsubWrite?.()
    unsubWrite = null
  }

  /*
   * 账号状态迁移的声明式接管（唯一一处）：登录成功 → 跑一轮；切盒（激活/登出）
   * → 全量重载 + （不是回客人盒才）跑一轮。
   *
   * 【为什么 prev 为 null 时全部不动作】首次装填（start() 里的 refresh）不是
   * "迁移"：启动那一轮由 start() 显式触发，四个 store 也会自己载入 ——
   * 把装填当迁移会白跑一轮、白重载一遍。null→X 只有这一次，跳掉最干净。
   */
  watch(
    () => account.state,
    (next, prev) => {
      if (next === null || prev === null) return
      if (next.signedIn && !prev.signedIn) {
        // 重新登录 = 新令牌，把"令牌已死"的停留态清掉
        authInvalid.value = false
        void trigger('login')
      }
      if (next.boxAccountId !== prev.boxAccountId) {
        reloadAllStores()
        // 回到客人盒（登出）不触发同步（会走停闸，多此一举）；
        // 切进账号盒（激活）触发 —— 收编之后该把并进来的盘面推上去
        if (next.boxAccountId !== null) void trigger('box')
      }
    }
  )

  return {
    running,
    stopping,
    lastRound,
    lastUplink,
    lastDoneAt,
    authInvalid,
    protocolBlocked,
    pendingPush,
    start,
    stop,
    trigger,
    cancelNow,
    /** 等这一轮（含补轮）跑完；没有在飞 = 立刻 resolve */
    whenIdle() {
      return inflight
    }
  }
})
