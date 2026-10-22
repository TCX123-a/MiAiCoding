/**
 * 云账号 store（P10.6）：渲染层关于「账号」的**唯一状态面** —— 登录态、激活态、
 * 最近一次失败，以及五个动作（登录 / 注册 / 登出 / 激活 / 找回三步链）。
 *
 * 【它管什么、不管什么】
 *   · 管：`cloud:state` 的读口 + 五个动作 + 收编预览，还有**切盒前的干涸**
 *     （登出 / 激活会换整个数据面，未落盘的本地写必须先停稳，见 quiesce）。
 *   · 不管：什么时候跑云同步 —— 那是 cloud-sync store 的独占职责。本文件
 *     **不 import cloud-sync**（依赖方向单向：cloud-sync → account）。「登录
 *     成功后触发一轮同步」是 cloud-sync 对 `account.state` 的 watch 做的事，
 *     不是登录动作里写一行 `syncNow()` —— 声明式接管，谁登录都覆盖得到。
 *
 * 【busy 为什么是单槽】五个动作互斥（登录页一次只能点一个），UI 也只需要
 * 「现在有没有动作在飞」这一个问题。做成每动作一个布尔迟早会出现"注册转圈
 * 时登录按钮还可点"这种没人写过的组合。找回三步链共用 'recover' 一格 ——
 * 一步步来，本来就不可能两步同时在飞。
 *
 * 【失败为什么是值不是异常】见 shared/cloud/dto.ts 的 CloudResult 抬头：
 * code 决定界面的下一步（改密码 / 稍后再试 / 去账号目录看现场），跨 IPC
 * 抛异常会把 code 整个丢掉。这里把最近一次失败留在 lastFailure 里给界面出
 * 文案；返回值原样透传给调用方。
 *
 * ⚠️ 本文件在 `src/renderer/src` 下、被文案闸门扫，**字符串一律英文**。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { toast } from '../components/base/toast'
import { ACCOUNT } from '../lib/copy'
import type {
  Account,
  AvatarPickView,
  AvatarUploadResponse,
  CloudAccountState,
  CloudActivatePreviewView,
  CloudActivateView,
  CloudAdoptMode,
  CloudAuthView,
  CloudCredentials,
  CloudFailure,
  CloudRegisterInput,
  CloudResult,
  RecoverQuestionResponse,
  RecoverResetResponse,
  RecoverVerifyResponse
} from '../../../shared/cloud/dto'
import { useAvatarStore } from './avatar'
import { useFavoritesStore } from './favorites'
import { useProgressStore } from './progress'

/** busy 的取值 = 六个互斥动作（找回三步链共用 'recover' 一格；资料区共用 'profile'） */
export type AccountOp = 'login' | 'register' | 'logout' | 'activate' | 'recover' | 'profile'

export const useAccountStore = defineStore('account', () => {
  /**
   * 主进程的账号状态（`cloud:state`，纯本地读盘、零网络）。
   * null = 还没问过 —— 界面据此区分「还没读到」和「读到了，是未登录」，
   * 同 progress/favorites 的 loaded 一条理由。
   */
  const state = ref<CloudAccountState | null>(null)
  /** 登录/注册回话里的用户名（内存里活一次；重启后靠 state 快照 / probeSession 补） */
  const username = ref<string | null>(null)
  /** 当前账号的头像 hash（null = 没设头像 → 默认大肥鱼）；同上，由主进程快照补 */
  const avatarHash = ref<string | null>(null)
  /**
   * 资料版本（2026-10-22）：改名/换头像成功后自增。
   * 排行榜 store 与视图依赖它清快照并重拉 —— 服务端是按 users 表现 JOIN 的，
   * 下一次拉取就会带上新名字/新头像；没有这个信号，已打开的榜面会一直摊着旧快照。
   */
  const profileVersion = ref(0)
  /** 正在飞的动作（按钮禁用/转圈）；null = 空闲 */
  const busy = ref<AccountOp | null>(null)
  /** 最近一次动作的失败（成功即清）；界面按 code 出文案 */
  const lastFailure = ref<CloudFailure | null>(null)

  const signedIn = computed(() => state.value?.signedIn ?? false)
  const activated = computed(() => state.value?.activated ?? false)
  /**
   * 登录了但没激活 —— **正常中间态**（docs 里反复点名的那种）：盒仍停客人位，
   * 界面该引导收编，不是报错。sync 的引擎在客人盒上本来就零动作
   * （`box.currentAccountId() === null` ⇒ skipped），所以这个态不触发同步。
   */
  const needsActivation = computed(() => signedIn.value && !activated.value)

  /** 状态读口。任何动作成功后都要刷一次 —— 界面只认 state，不自己拼状态 */
  async function refresh(): Promise<void> {
    state.value = await window.miai.cloud.state()
    if (!state.value.signedIn) {
      // 未登录时清掉残留资料：登出/令牌失效后不许还挂着上一个人的名字/头像
      username.value = null
      avatarHash.value = null
    } else {
      // 主进程的 session.bin 快照是重启/断网时唯一的名字来源；登录回话里的
      // 那份只在内存里活过一次。null = 这份旧会话文件还没带资料字段。
      if (state.value.username !== null) username.value = state.value.username
      avatarHash.value = state.value.avatarHash
    }
  }

  /**
   * 切盒前的干涸（docs/21 §3.5.1 的渲染层一半）：把防抖中的整份写全部推出去、
   * 等在飞的写完。主进程那半（sync/uplink 的 whenIdle）在 `cloud:logout` handler 里。
   *
   * 【为什么必须做】登出/激活会切盒、换 epoch —— 切盒之后旧戳的写会被屏障拒掉
   * （那是机制不是毛病，防的是错盒写入），但「用户点登出前最后 300ms 的操作」
   * 会因此丢掉。干涸把那个窗口关掉：先落盘，再换盒。
   *
   * 【激活为什么也要】收编（merge-local）是**读**客人盒当时的文件做合并 ——
   * 防抖中的写晚到一步，那几笔操作就进不了账号盒（客人盒留着，但用户看到的
   * 是"我刚点的收藏没跟过去"）。同一个窗口，同一道闸。
   */
  async function quiesce(): Promise<void> {
    const progress = useProgressStore()
    const favorites = useFavoritesStore()
    progress.flush()
    favorites.flush()
    // allSettled：干涸是尽力而为的纵深，任何一侧的异常都不许吞掉登出/激活本身
    await Promise.allSettled([progress.whenIdle(), favorites.whenIdle()])
  }

  async function login(cred: CloudCredentials): Promise<CloudResult<CloudAuthView>> {
    busy.value = 'login'
    try {
      const res = await window.miai.cloud.login(cred)
      if (res.ok) {
        lastFailure.value = null
        username.value = res.data.account.username
        avatarHash.value = res.data.account.avatarHash
        // 登录前以未登录态拉过榜时头像全在 60s 重试窗口里，登录成功要立刻放行
        useAvatarStore().retryNow()
        await refresh()
        /*
         * 已激活账号重登 = 直达（docs/22 拍板#7：「已激活账号重登直达同步、
         * 绝不重跑收编」）。2026-10-17 夜间批修：这一步原来**没有任何人做**
         * —— 登出后盒回了客人位，主进程 login 只存令牌，谁也不把盒切回账号。
         * 后果（活窗 + 文件系统双证）：登录态下同步轮被 cloud-sync 的客人盒
         * 闸（boxAccountId === null）静默跳过、本地写全部落进客人盒文件；
         * 重开应用才由 restoreOnStartup 切回账号盒 —— 用户看到的是
         * 「重新登录之后学的东西全没了」。
         * 直达的实现在主进程 activateAccount 的 already 分支（switchTo +
         * 装账本，绝不重跑收编）；这里只把那一脚踩下去。成功后 refresh()
         * 让 boxAccountId 翻真 —— cloud-sync 的 watch 据此全量重载 + 跑一轮。
         * 失败（LEDGER_CORRUPT：账号盒账本读不回）出声：这是"登录了但数据
         * 面没接回来"的停摆态，不许静默；盒留在客人位是坏账本的既定处置。
         * busy 保持 'login' 一格不切 activate（这个动作对用户就是"登录"，
         * 按钮的转圈不该在中途熄一下）。
         */
        if (activated.value) {
          await quiesce()
          const act = await window.miai.cloud.activate()
          if (act.ok) await refresh()
          else toast(ACCOUNT.ERR[act.failure.code], 'error')
        }
      } else {
        lastFailure.value = res.failure
      }
      return res
    } finally {
      busy.value = null
    }
  }

  async function register(input: CloudRegisterInput): Promise<CloudResult<CloudAuthView>> {
    busy.value = 'register'
    try {
      const res = await window.miai.cloud.register(input)
      if (res.ok) {
        lastFailure.value = null
        username.value = res.data.account.username
        avatarHash.value = res.data.account.avatarHash
        useAvatarStore().retryNow()
        await refresh()
      } else {
        lastFailure.value = res.failure
      }
      return res
    } finally {
      busy.value = null
    }
  }

  /**
   * 改昵称（2026-10-22）：服务端落库后本地立刻跟上，profileVersion 自增让
   * 已打开的排行榜画面重拉（服务端 JOIN users，下一次拉取就是新名字）。
   * 失败码原样进 lastFailure（USERNAME_TAKEN / USERNAME_FORBIDDEN / …）。
   */
  async function updateUsername(name: string): Promise<CloudResult<Account>> {
    busy.value = 'profile'
    try {
      const res = await window.miai.cloud.updateUsername(name)
      if (res.ok) {
        lastFailure.value = null
        username.value = res.data.username
        avatarHash.value = res.data.avatarHash
        if (state.value !== null) {
          state.value = {
            ...state.value,
            username: res.data.username,
            avatarHash: res.data.avatarHash
          }
        }
        profileVersion.value += 1
      } else {
        lastFailure.value = res.failure
      }
      return res
    } finally {
      busy.value = null
    }
  }

  /**
   * 换头像（2026-10-22）：png 是渲染层裁好的 256×256 PNG 字节。
   * `previewDataUrl` 只在成功后被记进头像缓存 —— 本人立刻看到新头像，
   * 不必等下一次 GET 往返。失败同样进 lastFailure。
   */
  async function uploadAvatar(
    png: Uint8Array,
    previewDataUrl?: string
  ): Promise<CloudResult<AvatarUploadResponse>> {
    busy.value = 'profile'
    try {
      const res = await window.miai.cloud.uploadAvatar(png)
      if (res.ok) {
        lastFailure.value = null
        avatarHash.value = res.data.hash
        if (state.value !== null) {
          state.value = { ...state.value, avatarHash: res.data.hash }
        }
        if (previewDataUrl !== undefined) {
          useAvatarStore().remember(res.data.hash, previewDataUrl)
        }
        profileVersion.value += 1
      } else {
        lastFailure.value = res.failure
      }
      return res
    } finally {
      busy.value = null
    }
  }

  /** 系统对话框选图（取消 = ok(null)；校验失败是 CloudResult.failure） */
  function pickAvatar(): Promise<CloudResult<AvatarPickView | null>> {
    return window.miai.cloud.pickAvatar()
  }

  /**
   * 找回密码三步链（2026-10-13）：取问题 → 验答案 → 重置。三步共用 busy='recover'
   * 一格（一步步来，不可能两步同时在飞）；失败进 lastFailure、返回值原样透传 ——
   * 与 login/register 同构。**不调 refresh()**：三端点都不产生本地会话，登录态
   * 没有任何变化可言，刷了也是白刷。
   */
  async function recoverQuestion(name: string): Promise<CloudResult<RecoverQuestionResponse>> {
    busy.value = 'recover'
    try {
      const res = await window.miai.cloud.recoverQuestion({ username: name })
      if (res.ok) {
        lastFailure.value = null
      } else {
        lastFailure.value = res.failure
      }
      return res
    } finally {
      busy.value = null
    }
  }

  async function recoverVerify(
    name: string,
    answer: string
  ): Promise<CloudResult<RecoverVerifyResponse>> {
    busy.value = 'recover'
    try {
      const res = await window.miai.cloud.recoverVerify({ username: name, answer })
      if (res.ok) {
        lastFailure.value = null
      } else {
        lastFailure.value = res.failure
      }
      return res
    } finally {
      busy.value = null
    }
  }

  async function recoverReset(
    name: string,
    answer: string,
    newPassword: string
  ): Promise<CloudResult<RecoverResetResponse>> {
    busy.value = 'recover'
    try {
      const res = await window.miai.cloud.recoverReset({
        username: name,
        answer,
        newPassword
      })
      if (res.ok) {
        lastFailure.value = null
      } else {
        lastFailure.value = res.failure
      }
      return res
    } finally {
      busy.value = null
    }
  }

  /**
   * 登出。失败（网络抖一下）时**一切原样**：令牌保留、盒子不动、界面还在登录态 ——
   * 服务端那侧 logout 幂等，"没登成"和"没登录"是两件事，不许把后者当前者。
   */
  async function logout(): Promise<CloudResult<null>> {
    busy.value = 'logout'
    try {
      await quiesce()
      const res = await window.miai.cloud.logout()
      if (res.ok) {
        lastFailure.value = null
        username.value = null
        await refresh()
      } else {
        lastFailure.value = res.failure
      }
      return res
    } finally {
      busy.value = null
    }
  }

  /**
   * 仅本机退出（V1-62）：丢本地令牌 + 回客人盒，**零网络** —— 断网时
   * 「退出登录」失败后的那条出路（主进程恒成功，无失败分支）。quiesce 照旧
   * 先跑（切盒前把渲染层的未落盘写口收干净），但它不再有网络等待。
   * 服务端会话原样活到过期；重新登录要再输一次密码（界面文案说清了这点）。
   */
  async function logoutLocal(): Promise<CloudResult<null>> {
    busy.value = 'logout'
    try {
      await quiesce()
      const res = await window.miai.cloud.logoutLocal()
      if (res.ok) {
        lastFailure.value = null
        username.value = null
        await refresh()
      } else {
        lastFailure.value = res.failure
      }
      return res
    } finally {
      busy.value = null
    }
  }

  /**
   * 激活（首激活收编 / 已激活直达）。`mode` 省略 = 直达（已激活账号重登）；
   * 首激活必须给 mode（'merge-local' | 'cloud-only'），不给主进程会抛
   * （那是我们自己的接线 bug，不翻译成温和失败 —— 见 app.ts 的注释）。
   */
  async function activate(mode?: CloudAdoptMode): Promise<CloudResult<CloudActivateView>> {
    busy.value = 'activate'
    try {
      await quiesce()
      const res = await window.miai.cloud.activate(mode ? { adopt: mode } : undefined)
      if (res.ok) {
        lastFailure.value = null
        await refresh()
      } else {
        lastFailure.value = res.failure
      }
      return res
    } finally {
      busy.value = null
    }
  }

  /** 首激活前的预览：云端有没有数据（决定界面说「云端已有数据」还是「新账号」） */
  function activatePreview(): Promise<CloudResult<CloudActivatePreviewView>> {
    return window.miai.cloud.activatePreview()
  }

  /**
   * 会话探测（GET /v1/auth/session，**走网络**）：账号页打开时补用户名 ——
   * 重启后 restoreOnStartup 静默恢复的会话，渲染层手里没有 username
   * （登录回话只在内存里活过一次）。探测失败静默：拿不到名字不影响任何动作，
   * 更不许把一次断网记成"账号出错了"（lastFailure 是动作的，不是探测的）。
   */
  async function probeSession(): Promise<void> {
    // 探测是启动时发出的慢请求（弱网最坏 10s×3）；期间用户可能已经改名/换头像。
    // 迟到的旧回话不许把刚写好的资料打回旧值 —— await 前记版本，回来变了就丢。
    const version = profileVersion.value
    try {
      const res = await window.miai.cloud.session()
      if (res.ok && res.data && profileVersion.value === version) {
        username.value = res.data.account.username
        /*
         * 旧版服务端不回 avatarHash → 解析成 null（版本漂移兼容）。
         * 这个 null 的含义是「服务端不知道」，不是「用户删了头像」：本地
         * session.bin 快照里已经有 hash 时不许被它冲掉 —— 否则每次启动的
         * session 探测都会让刚换好的头像消失一次。真取不到图时 UserAvatar
         * 会按 404 回落默认大肥鱼，视觉上仍是对的。
         */
        const nextAvatarHash = res.data.account.avatarHash
        if (nextAvatarHash !== null || avatarHash.value === null) {
          avatarHash.value = nextAvatarHash
        }
        if (state.value !== null) {
          state.value = {
            ...state.value,
            username: res.data.account.username,
            avatarHash: avatarHash.value
          }
        }
      }
    } catch {
      /* 探测失败不打扰 */
    }
  }

  return {
    state,
    username,
    avatarHash,
    profileVersion,
    busy,
    lastFailure,
    signedIn,
    activated,
    needsActivation,
    refresh,
    login,
    register,
    updateUsername,
    uploadAvatar,
    pickAvatar,
    logout,
    logoutLocal,
    activate,
    activatePreview,
    probeSession,
    recoverQuestion,
    recoverVerify,
    recoverReset
  }
})
