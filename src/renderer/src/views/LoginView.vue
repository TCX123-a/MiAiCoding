<script setup lang="ts">
/**
 * 账号页（P10.6 接真云账号 · docs/21 §3.5 数据流 / §8.4 首次登录收编）。
 *
 * 【这一页的三个形态，按判定优先级从上往下】
 *   ① 已登录且已激活 —— 账号页：当前账号 + 同步块（上次同步时间 / 未推完的
 *      份数 / 立即同步 / 两条停闸横幅）+ 退出登录。
 *   ② 登录了但没激活（needsActivation，**正常中间态**）—— 收编引导：先问
 *      云端空不空（activatePreview），空 = 单问「带上本机进度 / 从空白开始」，
 *      不空 = 两选一（合并进账号[推荐] / 只用云端）。面板底下留「退出登录」
 *      逃生口 —— 收编失败（连不上服务器等）的人不能被锁在这一页。
 *   ③ 未登录 —— 登录 / 注册双页签。
 *
 * 【状态从哪来】一切以主进程为准：stores/account.ts 的 state（cloud:state
 * 读口）是登录态唯一真源。动作成功后 store 自己 refresh，界面跟着翻面 ——
 * 本页没有一行「我登录成功了所以现在算已登录」。收编完成同样靠 watch
 * needsActivation 翻假，不靠 activate 的返回值改状态。
 *
 * 【为什么不做客户端策略复读】用户名 / 密码的规格判定权在服务端
 * （docs/22 §5.3：2026-10-13 放宽后 = 用户名 2~30 位中英文/数字/下划线、不能以
 * 数字开头；密码 ≥6 位、弱密码黑名单）。这里只判三件本地事：
 * 两次密码不一致、空字段不许提交、注册时安全问题必须从预设清单里选
 * （清单 = shared/cloud/protocol.ts 的 SECURITY_QUESTIONS，与服务端同一份）。
 * 其余一律让服务端回码、按 ACCOUNT.ERR 查表。
 *
 * 【找回密码为什么是三步向导而不是一屏表单（2026-10-13 主人令）】
 * 服务端把「取问题 / 验答案 / 重置」拆成三个端点（protocol.ts），每步各有
 * 自己的限流与失败码 —— 界面照端点的形状走：第 1 步先证明账号存在，
 * 第 2 步答错就停在第 2 步（答案不回显、不预填），第 3 步才设新密码。
 * 重置成功不自动登录（三端点都不发 token），回登录页签、用户名预填、
 * 新密码自己输一遍 —— 让人亲眼确认新密码能用，比"悄悄替你登进去"诚实。
 *
 * 【同步块的时间为什么只认 lastDoneAt】store 里 skipped 轮（退避等）也会
 * 更新 lastRound.at —— 那是"尝试"时间。拿它当"上次同步"就是把什么都没发
 * 说成刚同步过（同 sync-view.ts 里对象引用比较那条的理由）。
 *
 * 【裸路由】router 的 meta.bare：没有三栏壳 —— 壁纸与顶条留着（窗口还能拖），
 * 回程路由页面左上角的返回块自己带（裸壳没有侧栏可点）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import MiButton from '../components/base/MiButton.vue'
import MiInput from '../components/base/MiInput.vue'
import MiMascot from '../components/base/MiMascot.vue'
import MiModal from '../components/base/MiModal.vue'
import MiSelect from '../components/base/MiSelect.vue'
import MiTabs from '../components/base/MiTabs.vue'
import UserAvatar from '../components/domain/UserAvatar.vue'
import { toast } from '../components/base/toast'
import { imageDataUrlToAvatarPng, type AvatarPng } from '../lib/avatar'
import { ACCOUNT, SYNC } from '../lib/copy'
import { logoutFailureText } from '../lib/account-view'
import { formatSyncClock } from '../lib/labels'
import { manualSyncOutcome } from '../lib/sync-view'
import { useAccountStore } from '../stores/account'
import { useCloudSyncStore } from '../stores/cloud-sync'
import {
  findSensitiveUsernameWord,
  SECURITY_QUESTIONS,
  USERNAME_RE
} from '../../../shared/cloud/protocol'
import type { CloudAdoptMode, CloudFailureCode } from '../../../shared/cloud/dto'

const router = useRouter()
const acct = useAccountStore()
const cloudSync = useCloudSyncStore()

/** ③ 双页签 */
const tab = ref<'login' | 'register'>('login')
const TABS = [
  { key: 'login', label: ACCOUNT.TAB_LOGIN },
  { key: 'register', label: ACCOUNT.TAB_REGISTER }
]

const loginName = ref('')
const loginPass = ref('')
const regName = ref('')
const regPass = ref('')
const regConfirm = ref('')
/** 注册必填的一问一答（2026-10-13 主人令）：问题只能从预设清单里选 */
const regQuestion = ref('')
const regAnswer = ref('')

/**
 * 预设问题 → MiSelect 选项（label=value=问题原文）。
 * 真源是 shared/cloud/protocol.ts 的 SECURITY_QUESTIONS（与服务端逐字节同步）——
 * 这里现场 map，不另抄一份；提交时再回查一次清单收窄类型（MiSelect 只认 string）。
 */
const QUESTION_OPTIONS = SECURITY_QUESTIONS.map((q) => ({ label: q, value: q }))

/*
 * 找回密码三步向导（2026-10-13）：0 = 没开；1 输用户名 → 2 答安全问题 → 3 设新密码。
 * 每步的推进都是「服务端点头才走下一步」—— 取问题成功才有第 2 步可答，
 * 验答案成功才有第 3 步可设，失败就停在本步（已填内容不清，重试不用重打）。
 */
const recoverStep = ref<0 | 1 | 2 | 3>(0)
const recoverName = ref('')
const recoverAnswer = ref('')
/** 第 2 步服务端回显的问题原文（只显示、不回传 —— 重置带的是答案重放，见 account.ts） */
const recoverQuestion = ref('')
const recoverNewPass = ref('')
const recoverConfirm = ref('')

/** 失败码 → toast。文案在 copy.ts 的 ACCOUNT.ERR 整表（穷尽性由 typecheck 看住） */
function fail(code: CloudFailureCode): void {
  toast(ACCOUNT.ERR[code], 'error')
}

/*
 * 状态读口兜底：正常路径上启动时 cloud-sync.start() 已经刷过 state 了，
 * 这里只救「那次刷新失败、state 停在 null」的场合（纯本地 IPC、不碰网络）。
 * 失败也不弹错：界面按未登录渲染，动作自己的失败会报出来。
 */
onMounted(() => {
  if (acct.state === null) void acct.refresh().catch(() => {})
})

// ---- ② 收编引导（激活）

/** 面板三态；loadPreview（含重试）每次都从 loading 重来 */
const adoptPhase = ref<'loading' | 'ready' | 'failed'>('loading')
/** ready 时：云端是不是空的（决定面板走单问还是两选一） */
const adoptCloudEmpty = ref<boolean | null>(null)

async function loadPreview(): Promise<void> {
  adoptPhase.value = 'loading'
  adoptCloudEmpty.value = null
  try {
    const res = await acct.activatePreview()
    if (res.ok) {
      adoptCloudEmpty.value = res.data.cloudEmpty
      adoptPhase.value = 'ready'
    } else {
      adoptPhase.value = 'failed'
    }
  } catch {
    // IPC 层异常（接线问题）也归 failed：给「再试一次」，不假装看过云端
    adoptPhase.value = 'failed'
  }
}

/*
 * needsActivation 翻真就去问云端；immediate 让「带资格进来这一页」也立刻问。
 * 只管翻真那一沿：翻假（收编完成）后面板整个不渲染，陈旧的预览值无害 ——
 * 下次再翻真时 loadPreview 自己会把三态重置。
 */
watch(
  () => acct.needsActivation,
  (v) => {
    if (v) void loadPreview()
  },
  { immediate: true }
)

// ---- ① 登录 / 注册 / 收编动作

async function onLogin(): Promise<void> {
  /*
   * V2-11：MiInput 的 Enter 不看按钮脸色（base/MiInput 的 onKeydown 无条件
   * emit('enter')），按钮那边 disabled||loading 挡不住回车 —— 在飞时再敲一下
   * 就是第二发 IPC。繁忙闸补在这里，与 store 的 busy 单槽同一把尺子：
   * 重复提交静默吞掉（这不是错误，不弹 toast、什么都不做）。
   */
  if (acct.busy !== null) return
  const res = await acct.login({ username: loginName.value.trim(), password: loginPass.value })
  if (!res.ok) {
    fail(res.failure.code)
    return
  }
  loginPass.value = ''
  toast(ACCOUNT.OK_LOGIN(res.data.account.username), 'success')
  /*
   * 已激活账号（重登）：这页没别的事了，直接回学习。
   * 没激活的：留在本页 —— needsActivation 翻真，收编面板接管（§8.4）。
   */
  if (!acct.needsActivation) void router.push('/learn')
}

async function onRegister(): Promise<void> {
  // 同 onLogin 的繁忙闸（V2-11）：回车连发只认第一发
  if (acct.busy !== null) return
  // 本地能判的两条（见文件头：其余规格交服务端）
  if (regPass.value !== regConfirm.value) {
    toast(ACCOUNT.ERR_CONFIRM, 'error')
    return
  }
  /*
   * 类型收窄：MiSelect 只吐 string，而 register 要 SecurityQuestion。
   * 按钮的 disabled 已经挡住了空问题，这条分支是「select 被喂了清单外的值」
   * 的兜底（正常路径到不了）—— 到了也不许静默 no-op，照实报一条。
   */
  const question = SECURITY_QUESTIONS.find((q) => q === regQuestion.value)
  if (!question) {
    toast(ACCOUNT.ERR_QA, 'error')
    return
  }
  const res = await acct.register({
    username: regName.value.trim(),
    password: regPass.value,
    securityQuestion: question,
    // 答案原样上行（不 trim 不降格）：归一化是服务端的活（NFKC+trim+小写）
    securityAnswer: regAnswer.value
  })
  if (!res.ok) {
    fail(res.failure.code)
    return
  }
  regPass.value = ''
  regConfirm.value = ''
  regQuestion.value = ''
  regAnswer.value = ''
  toast(ACCOUNT.OK_REGISTERED(res.data.account.username), 'success')
  // 新账号一定是「登录了没激活」—— 收编面板接管（同上）
}

/** 收编：merge-local = 把本机进度并进账号盒；cloud-only = 账号只跟云端 */
async function onAdopt(mode: CloudAdoptMode): Promise<void> {
  const res = await acct.activate(mode)
  if (!res.ok) {
    fail(res.failure.code)
    return
  }
  toast(mode === 'merge-local' ? ACCOUNT.OK_ADOPT_MERGED : ACCOUNT.OK_ADOPT_BLANK, 'success')
}

// ---- 找回密码（三步向导）

/** 每步的说明句（步骤号是收窄联合，switch 写全没有 default 之外的缝） */
const recoverHint = computed(() => {
  switch (recoverStep.value) {
    case 2:
      return ACCOUNT.RECOVER_STEP2_HINT
    case 3:
      return ACCOUNT.RECOVER_STEP3_HINT
    default:
      return ACCOUNT.RECOVER_STEP1_HINT
  }
})

/** 推进键的可用性：本步必填齐了才能点（服务的限流/规格仍由服务端说了算） */
const recoverCanGo = computed(() => {
  switch (recoverStep.value) {
    case 1:
      return recoverName.value.trim() !== ''
    case 2:
      return recoverAnswer.value.trim() !== ''
    case 3:
      return recoverNewPass.value !== '' && recoverConfirm.value !== ''
    default:
      return false
  }
})

/** 退出向导并清空全部向导字段（成功与取消共用；登录/注册页签的字段不动） */
function endRecover(): void {
  recoverStep.value = 0
  recoverName.value = ''
  recoverAnswer.value = ''
  recoverQuestion.value = ''
  recoverNewPass.value = ''
  recoverConfirm.value = ''
}

/** 入口（登录页签的「忘记密码？」）：从干净态起步，不带上一次中途取消的残留 */
function startRecover(): void {
  endRecover()
  recoverStep.value = 1
}

/** 推进键（三步共用一颗按钮；文案按步在模板里选） */
async function recoverNext(): Promise<void> {
  // 同 onLogin 的繁忙闸（V2-11）：三步共用一颗推进键，回车连发只认第一发
  if (acct.busy !== null) return
  if (recoverStep.value === 1) {
    const res = await acct.recoverQuestion(recoverName.value.trim())
    if (!res.ok) {
      fail(res.failure.code)
      return
    }
    recoverQuestion.value = res.data.question
    recoverStep.value = 2
    return
  }
  if (recoverStep.value === 2) {
    const res = await acct.recoverVerify(recoverName.value.trim(), recoverAnswer.value)
    if (!res.ok) {
      fail(res.failure.code)
      return
    }
    recoverStep.value = 3
    return
  }
  // 第 3 步：本地先判两次一致（与注册同一条纪律），再交服务端
  if (recoverNewPass.value !== recoverConfirm.value) {
    toast(ACCOUNT.ERR_CONFIRM, 'error')
    return
  }
  const name = recoverName.value.trim()
  const res = await acct.recoverReset(name, recoverAnswer.value, recoverNewPass.value)
  if (!res.ok) {
    fail(res.failure.code)
    return
  }
  toast(ACCOUNT.OK_RECOVERED, 'success')
  endRecover()
  /*
   * 重置成功不自动登录（三端点都不发 token）：回登录页签、用户名预填，
   * 新密码让本人亲手输一遍 —— 顺便就当验收了。
   */
  tab.value = 'login'
  loginName.value = name
  loginPass.value = ''
}

// ---- ③ 已登录（账号 + 同步）

/** 名字可能还没探测到（重启恢复的会话）—— 不编名字，如实说没读回来 */
const meLine = computed(() =>
  acct.username ? ACCOUNT.LOGGED_IN_AS(acct.username) : ACCOUNT.ME_UNKNOWN
)

// ---- ① 个人资料：换头像（2026-10-22 用户系统批次）
//
// 链路：主进程 dialog 选图（验后缀/2MB/magic）→ 渲染层居中裁 256 PNG →
// 预览确认 → 上传（服务端 sha256 内容寻址）。取消选择不是错误；任何一步
// 失败都 toast 出原因，已经选好的预览留在框里可重试（网络失败尤其是）。
const avatarBusy = ref(false)
const avatarUploading = ref(false)
/** 预览的裁剪产物；null = 预览框关着 */
const avatarPreview = ref<AvatarPng | null>(null)
const avatarPreviewName = ref('')

/** MiModal 的 v-model：上传在飞时不许被遮罩/✕ 关掉（那会留下"传没传"的悬念） */
const avatarPreviewVisible = computed({
  get: () => avatarPreview.value !== null,
  set: (visible: boolean) => {
    if (!visible && !avatarUploading.value) avatarPreview.value = null
  }
})

async function onPickAvatar(): Promise<void> {
  if (avatarBusy.value || acct.busy !== null) return
  avatarBusy.value = true
  try {
    const picked = await acct.pickAvatar()
    if (!picked.ok) {
      toast(ACCOUNT.ERR[picked.failure.code], 'error')
      return
    }
    if (picked.data === null) return // 用户取消：正常意志，不提示
    const cropped = await imageDataUrlToAvatarPng(picked.data.dataUrl)
    if (cropped === null) {
      toast(ACCOUNT.ERR_AVATAR_DECODE, 'error')
      return
    }
    avatarPreviewName.value = picked.data.fileName
    avatarPreview.value = cropped
  } catch (err) {
    // IPC 抛 = 接线 bug 或主进程异常：控制台留证据，界面给一句人话
    console.warn('[miai] avatar pick failed', err)
    toast(ACCOUNT.ERR_AVATAR_DECODE, 'error')
  } finally {
    avatarBusy.value = false
  }
}

/**
 * 预览框的「换一张」：先关框（上传不在飞）再重新弹系统对话框。
 * 用户在新对话框里点取消、或选到一张坏图时，**原来那张预览要回来** ——
 * 否则「换一张 → 取消」= 把已经选好的图弄丢了，只能从头再选（夜间自查修）。
 */
async function pickAnotherAvatar(): Promise<void> {
  if (avatarUploading.value) return
  const previous = avatarPreview.value
  const previousName = avatarPreviewName.value
  avatarPreview.value = null
  await onPickAvatar()
  if (avatarPreview.value === null && previous !== null) {
    avatarPreview.value = previous
    avatarPreviewName.value = previousName
  }
}

async function confirmAvatar(): Promise<void> {
  const preview = avatarPreview.value
  if (preview === null || avatarUploading.value) return
  avatarUploading.value = true
  try {
    const res = await acct.uploadAvatar(preview.bytes, preview.dataUrl)
    if (!res.ok) {
      // 预览留着：网络类失败的重试只需再点一次「就用这张」
      toast(ACCOUNT.ERR[res.failure.code], 'error')
      return
    }
    avatarPreview.value = null
    toast(ACCOUNT.OK_AVATAR, 'success')
  } catch (err) {
    // IPC 抛（主进程崩/接线异常）不许变成未处理拒绝：预览留着，用户可重试
    console.warn('[miai] avatar upload failed', err)
    toast(ACCOUNT.ERR_PROFILE_BRIDGE, 'error')
  } finally {
    avatarUploading.value = false
  }
}

// ---- ① 个人资料：改昵称
const nameEditing = ref(false)
const newName = ref('')
const nameCanSave = computed(() => newName.value.trim() !== '')
/**
 * 二次确认（2026-10-22）：用户名同时是登录名，改完旧名字就登不上。
 * 本地校验全过之后先把名字锁进 pendingName，再弹这一道；确认前不发任何网络请求。
 * 取消/Esc/遮罩只关框，不动 nameEditing/newName —— 用户输的名字必须原样留着。
 */
const nameConfirmVisible = ref(false)
const pendingName = ref('')

function startNameEdit(): void {
  if (acct.busy !== null) return
  newName.value = acct.username ?? ''
  nameEditing.value = true
}

function cancelNameEdit(): void {
  if (acct.busy === 'profile') return
  nameEditing.value = false
  newName.value = ''
}

async function saveName(): Promise<void> {
  if (acct.busy !== null) return
  const name = newName.value.trim()
  if (name === '') {
    toast(ACCOUNT.ERR_NAME_EMPTY, 'error')
    return
  }
  if (name === (acct.username ?? '')) {
    toast(ACCOUNT.ERR_NAME_UNCHANGED, 'info')
    return
  }
  // 本地预检两条（2026-10-22 主人需求：违禁词命中立刻拦截）——
  // 服务端仍会再判一遍，这里只是即时反馈，不取代服务端。
  if (!USERNAME_RE.test(name)) {
    toast(ACCOUNT.ERR_NAME_FORMAT, 'error')
    return
  }
  if (findSensitiveUsernameWord(name) !== null) {
    toast(ACCOUNT.ERR_NAME_FORBIDDEN, 'error')
    return
  }
  // 校验全过才弹确认；待提交的名字锁进 pendingName，确认时发它而不是重读输入框
  // （输入框在弹窗背后仍然可编辑的理论窗口里也不会「审的是 A、发的是 B」）。
  pendingName.value = name
  nameConfirmVisible.value = true
}

/** 二次确认里的「确认修改」：真正发请求的唯一入口 */
async function confirmNameChange(): Promise<void> {
  if (acct.busy !== null) return
  const name = pendingName.value
  const res = await acct.updateUsername(name).catch((err: unknown) => {
    // IPC 抛 ≠ 服务端拒绝：控制台留证据，界面给可重试的人话（不把输入框关掉）
    console.warn('[miai] updateUsername failed', err)
    return null
  })
  if (res === null) {
    nameConfirmVisible.value = false
    toast(ACCOUNT.ERR_PROFILE_BRIDGE, 'error')
    return
  }
  if (!res.ok) {
    // 失败一律关掉确认框，回到背后仍开着的编辑器（文字原样保留）—— 改名失败
    // 基本都要改文本，闷在一个没有输入框的弹窗里没法重试。
    nameConfirmVisible.value = false
    // 404 = 云端还没部署改名端点（发布窗口里客户端先更新）：给版本漂移的
    // 人话，不要拿通用的「服务器上没找到这个账号喵」吓用户一跳。
    toast(
      res.failure.code === 'USERNAME_FORBIDDEN'
        ? ACCOUNT.ERR_NAME_FORBIDDEN
        : res.failure.code === 'NOT_FOUND'
          ? ACCOUNT.ERR_NAME_SERVER_OLD
          : ACCOUNT.ERR[res.failure.code],
      'error'
    )
    return
  }
  nameConfirmVisible.value = false
  pendingName.value = ''
  nameEditing.value = false
  newName.value = ''
  toast(ACCOUNT.OK_NAME, 'success')
}

/** 取消二次确认：只关框，编辑器与已输入的名字都留着 */
function cancelNameConfirm(): void {
  if (acct.busy === 'profile') return
  nameConfirmVisible.value = false
  pendingName.value = ''
}

/** 上次同步：只认真跑过的轮（skipped 轮是"尝试"，lastDoneAt 已经把这事钉住了） */
const syncWhen = computed(() =>
  cloudSync.lastDoneAt ? SYNC.LAST(formatSyncClock(cloudSync.lastDoneAt)) : SYNC.NEVER
)

/** 三行状态：停闸 > 排队 > 都同步好；空串 = 这行不渲染 */
const syncWarn = computed(() => {
  if (cloudSync.authInvalid) return SYNC.AUTH_INVALID
  if (cloudSync.protocolBlocked) return SYNC.PROTOCOL_BLOCKED
  return ''
})
const syncPending = computed(() => {
  const r = cloudSync.lastRound
  if (!r || r.skipped || cloudSync.pendingPush.length === 0) return ''
  return SYNC.PENDING(cloudSync.pendingPush.length)
})
const syncOk = computed(() => {
  const r = cloudSync.lastRound
  if (!r || r.skipped || cloudSync.pendingPush.length > 0) return ''
  return SYNC.ALL_OK
})
/** 令牌死 / 协议被拒：同步跑了也是同一个结局，按钮禁掉（出路在页脚那颗按钮） */
const syncBlocked = computed(() => cloudSync.authInvalid || cloudSync.protocolBlocked)

async function onSyncNow(): Promise<void> {
  /*
   * before / after 两个快照的**引用比较**判「这一轮到底跑没跑」——
   * 判定在 lib/sync-view.ts（那里写了为什么不能比时间戳）。停闸两条在前：
   * 令牌死了/协议被拒时同步根本不会跑，先说清原因，别报"没同步上"。
   */
  const before = cloudSync.lastRound
  await cloudSync.trigger('manual', { force: true })
  if (cloudSync.authInvalid) {
    toast(SYNC.AUTH_INVALID, 'warn')
    return
  }
  if (cloudSync.protocolBlocked) {
    toast(SYNC.PROTOCOL_BLOCKED, 'warn')
    return
  }
  /*
   * V1-65：这一轮被「停止」取消了 —— 三种结局一个都不许报。"引用变了"
   * 限定只认这一轮真跑过（同 manualSyncOutcome 的判据）；停止的确认 toast
   * 归 onStopSync（它等同一轮真收尾再报，点过停止就一定有那个报）。
   */
  if (cloudSync.lastRound !== before && cloudSync.lastRound?.canceled) return
  const outcome = manualSyncOutcome(before, cloudSync.lastRound)
  if (outcome === 'none') {
    toast(SYNC.TOAST_FAILED, 'error')
    return
  }
  if (outcome === 'skipped') {
    toast(SYNC.TOAST_SKIPPED, 'info')
    return
  }
  const pending = cloudSync.pendingPush.length
  if (pending > 0) toast(SYNC.PENDING(pending), 'warn')
  else toast(SYNC.TOAST_DONE, 'success')
}

/**
 * V1-65：同步块那颗「停止」。语义 = 不再发新的文档请求 —— 正在飞的那次由
 * 它自己的 10s 超时闸收束（cancelNow 只竖旗，即时返回）。这里等 whenIdle
 * 真收尾了再报「停下来了」：用户看到的确认和收尾发生在同一时刻，收束期间
 * 按钮显示「正在停下…」（cloudSync.stopping），不假装已经停下。
 */
async function onStopSync(): Promise<void> {
  await cloudSync.cancelNow()
  await cloudSync.whenIdle()
  toast(SYNC.TOAST_STOPPED, 'info')
}

// ---- 共用

/** 登出成功后把 ③ 未登录形态的表单复位（两个出口共用：真登出 / 仅本机退出） */
function resetAuthForms(): void {
  // 留在本页：下面就是登录页签 —— 换账号接着登
  tab.value = 'login'
  loginName.value = ''
  loginPass.value = ''
  regName.value = ''
  regPass.value = ''
  regConfirm.value = ''
  // 资料编辑态也一起复位：否则退出后换个账号登录，改名框会带着上一个人的名字复现
  nameEditing.value = false
  newName.value = ''
  nameConfirmVisible.value = false
  pendingName.value = ''
}

async function onLogout(): Promise<void> {
  const res = await acct.logout()
  if (!res.ok) {
    /*
     * V1-62：失败不许只报一句就完 —— 真登出在断网时恒失败（刻意的：一切
     * 原样），用户会被扣在登录态里，收编页的逃生口恰好在它要救的场景里失效。
     * 弹出路框：再试一次（要网络）/ 仅本机退出（零网络）。正文按失败码映射
     * （lib/account-view.ts，带单测）。
     */
    logoutFailCode.value = res.failure.code
    logoutFailVisible.value = true
    return
  }
  toast(ACCOUNT.OK_LOGOUT, 'success')
  resetAuthForms()
}

/*
 * 真登出失败的出路框（V1-62）。正文按码出（NETWORK/TIMEOUT 专门文案，
 * 其余查 ERR 表）；两颗按钮：再试一次 = 重跑 onLogout（再失败会再弹，
 * 不静默吞），仅本机退出 = 零网络出口（主进程恒成功）。
 */
const logoutFailVisible = ref(false)
const logoutFailCode = ref<CloudFailureCode | null>(null)
const logoutFailText = computed(() =>
  logoutFailCode.value === null ? '' : logoutFailureText(logoutFailCode.value)
)

/** 出路框的「再试一次」：关框 → 重跑真登出 */
function retryLogout(): void {
  logoutFailVisible.value = false
  void onLogout()
}

/**
 * 出路框的「仅本机退出」（V1-62）：丢本地令牌 + 回客人盒，零网络，主进程
 * 恒成功。终端态与一次成功的真登出完全相同 —— 表单照常复位、toast 照报。
 */
async function onLogoutLocal(): Promise<void> {
  const res = await acct.logoutLocal()
  logoutFailVisible.value = false
  if (!res.ok) {
    // 零网络的动作用不着 ERR_LOGOUT_NETWORK（"需要联网"在这条路上是错话）；
    // 恒成功的动作真回来了失败 = 我们自己的接线 bug，如实查表报码，不吞
    toast(ACCOUNT.ERR[res.failure.code], 'error')
    return
  }
  toast(ACCOUNT.OK_LOGOUT_LOCAL, 'success')
  resetAuthForms()
}

/**
 * 账号面板那颗主按钮的两个身份（V2-12 起）：
 *   · 令牌活着 →「退出登录」= 真退，先弹确认框（危险动作要有二次确认，
 *     照删除类动作的惯例；原来一点即退，误点就得重新输密码）；
 *   · 令牌已死（authInvalid，按钮写着「重新登录」）→ 那个动作本身就是
 *     "重新登录"，没有可退的登录态，**不弹**确认框（弹了只是拦路）。
 *
 * ⚠️ 收编引导里那个「退出登录」逃生口（下面 :465 那颗 link）**保持一点即退**：
 * 它的存在意义正是"收编连不上时不被锁在这一页"，加确认框等于把锁加回来。
 */
const logoutConfirmVisible = ref(false)

function askLogout(): void {
  if (cloudSync.authInvalid) {
    void onLogout()
    return
  }
  logoutConfirmVisible.value = true
}

/** 确认框里那颗「退出登录」：关框 → 走原来的真退 */
function confirmLogout(): void {
  logoutConfirmVisible.value = false
  void onLogout()
}

function goBack(): void {
  void router.push('/learn')
}
</script>

<template>
  <div class="login-page">
    <!-- 裸壳没有侧栏，回程路自己带：固定左上角的小胶囊（顶条下方，不挡拖拽区） -->
    <button class="back-chip" :title="ACCOUNT.BACK_TITLE" @click="goBack">{{ ACCOUNT.BACK }}</button>

    <section class="login-panel">
      <!-- ① 已登录且已激活：账号页 -->
      <template v-if="acct.signedIn && !acct.needsActivation">
        <div class="me">
          <span class="me-face">
            <UserAvatar :hash="acct.avatarHash" :px="84" :alt="acct.username ?? ''" />
          </span>
          <div class="me-name">{{ meLine }}</div>

          <!-- 个人资料（2026-10-22）：改头像 + 改昵称。两颗按钮共用 acct.busy
               单槽 —— 动作互斥，避免"改名在飞时又去换头像"的组合态。 -->
          <div class="profile-actions">
            <MiButton
              size="sm"
              variant="secondary"
              :loading="avatarBusy"
              :disabled="acct.busy !== null"
              @click="onPickAvatar"
            >
              {{ ACCOUNT.BTN_CHANGE_AVATAR }}
            </MiButton>
            <MiButton
              size="sm"
              variant="secondary"
              :disabled="acct.busy !== null || nameEditing"
              @click="startNameEdit"
            >
              {{ ACCOUNT.BTN_CHANGE_NAME }}
            </MiButton>
          </div>
          <p class="profile-hint">{{ ACCOUNT.PROFILE_AVATAR_HINT }}</p>

          <!-- 改昵称：就地展开，不另开一页（账号页本来就短） -->
          <div v-if="nameEditing" class="name-edit">
            <label class="field">
              <span class="field-label">{{ ACCOUNT.FIELD_NEW_NAME }}</span>
              <MiInput
                v-model="newName"
                :placeholder="ACCOUNT.NEW_NAME_PLACEHOLDER"
                width="100%"
                @enter="saveName"
              />
            </label>
            <div class="name-edit-actions">
              <MiButton
                size="sm"
                :loading="acct.busy === 'profile'"
                :disabled="!nameCanSave"
                @click="saveName"
              >
                {{ ACCOUNT.BTN_SAVE_NAME }}
              </MiButton>
              <MiButton
                size="sm"
                variant="secondary"
                :disabled="acct.busy === 'profile'"
                @click="cancelNameEdit"
              >
                {{ ACCOUNT.BTN_NAME_CANCEL }}
              </MiButton>
            </div>
          </div>
        </div>
        <p class="hint">{{ ACCOUNT.NOTE_LOGGED_IN }}</p>

        <div class="sync-block">
          <div class="sync-head">
            <span class="sync-title">{{ SYNC.TITLE }}</span>
            <span class="sync-when">{{ syncWhen }}</span>
          </div>
          <p v-if="syncWarn" class="sync-line sync-warn">{{ syncWarn }}</p>
          <p v-else-if="syncPending" class="sync-line sync-pending">{{ syncPending }}</p>
          <p v-else-if="syncOk" class="sync-line sync-ok">{{ syncOk }}</p>
          <div class="sync-actions">
            <MiButton
              size="lg"
              :loading="cloudSync.running"
              :disabled="syncBlocked"
              @click="onSyncNow"
            >
              {{ SYNC.BTN_NOW }}
            </MiButton>
            <!-- V1-65：同步在飞时旁边多一颗「停止」—— 停下不再发新请求，
                 在飞的那次最迟 10s 收束（收束期间按钮转成「正在停下…」） -->
            <MiButton
              v-if="cloudSync.running"
              size="lg"
              variant="secondary"
              :loading="cloudSync.stopping"
              @click="onStopSync"
            >
              {{ cloudSync.stopping ? SYNC.STOPPING : SYNC.BTN_STOP }}
            </MiButton>
          </div>
        </div>

        <MiButton size="lg" variant="secondary" :loading="acct.busy === 'logout'" @click="askLogout">
          {{ cloudSync.authInvalid ? ACCOUNT.BTN_RELOGIN : ACCOUNT.BTN_LOGOUT }}
        </MiButton>
      </template>

      <!-- ② 登录了但没激活：收编引导（docs/21 §8.4） -->
      <template v-else-if="acct.needsActivation">
        <MiMascot pose="guide" size="l" />
        <h1 class="title">{{ ACCOUNT.ADOPT_TITLE }}</h1>
        <p class="sub">{{ ACCOUNT.NOTE_LOGGED_IN }}</p>

        <p v-if="adoptPhase === 'loading'" class="adopt-line">{{ ACCOUNT.ADOPT_LOADING }}</p>
        <template v-else-if="adoptPhase === 'failed'">
          <p class="adopt-line adopt-warn">{{ ACCOUNT.ADOPT_FAILED }}</p>
          <MiButton size="lg" @click="loadPreview">{{ ACCOUNT.BTN_RETRY }}</MiButton>
        </template>
        <template v-else>
          <p class="adopt-line">
            {{ adoptCloudEmpty ? ACCOUNT.ADOPT_NEW_ASK : ACCOUNT.ADOPT_HAS_ASK }}
          </p>
          <p v-if="adoptCloudEmpty" class="adopt-note">{{ ACCOUNT.ADOPT_NEW_NOTE }}</p>
          <MiButton size="lg" :loading="acct.busy === 'activate'" @click="onAdopt('merge-local')">
            {{ adoptCloudEmpty ? ACCOUNT.BTN_ADOPT_LOCAL : ACCOUNT.BTN_ADOPT_MERGE }}<span
              v-if="!adoptCloudEmpty"
              class="rec"
              >{{ ACCOUNT.RECOMMENDED }}</span
            >
          </MiButton>
          <MiButton
            size="lg"
            variant="secondary"
            :disabled="acct.busy !== null"
            @click="onAdopt('cloud-only')"
          >
            {{ adoptCloudEmpty ? ACCOUNT.BTN_ADOPT_BLANK : ACCOUNT.BTN_ADOPT_CLOUD }}
          </MiButton>
        </template>

        <!-- 逃生口：收编失败（连不上服务器等）的人不能被锁在这一页 -->
        <button class="link" :disabled="acct.busy !== null" @click="onLogout">
          {{ ACCOUNT.BTN_LOGOUT }}
        </button>
      </template>

      <!-- ③ 未登录：登录 / 注册双页签（找回密码打开时整块换成三步向导） -->
      <template v-else>
        <MiMascot pose="expect" size="l" />
        <!-- 向导打开时标题换成「找回密码」；副题只在双页签态出现，不叠两层标题 -->
        <h1 class="title">{{ recoverStep > 0 ? ACCOUNT.RECOVER_TITLE : ACCOUNT.TITLE }}</h1>
        <p v-if="recoverStep === 0" class="sub">{{ ACCOUNT.SUB }}</p>

        <!-- 找回密码：三步向导（1 输用户名 → 2 答问题 → 3 设新密码，见脚本区注释） -->
        <template v-if="recoverStep > 0">
          <p class="hint">{{ recoverHint }}</p>

          <label v-if="recoverStep === 1" class="field">
            <span class="field-label">{{ ACCOUNT.FIELD_NAME }}</span>
            <MiInput
              v-model="recoverName"
              :placeholder="ACCOUNT.NAME_PLACEHOLDER"
              width="100%"
              @enter="recoverNext"
            />
          </label>

          <template v-else-if="recoverStep === 2">
            <!-- 服务端回显的问题原文：只读展示，不预填答案（答案是我们没存过的东西） -->
            <div class="field">
              <span class="field-label">{{ ACCOUNT.FIELD_QUESTION }}</span>
              <p class="recover-question">{{ recoverQuestion }}</p>
            </div>
            <label class="field">
              <span class="field-label">{{ ACCOUNT.FIELD_ANSWER }}</span>
              <MiInput
                v-model="recoverAnswer"
                :placeholder="ACCOUNT.ANSWER_PLACEHOLDER"
                width="100%"
                @enter="recoverNext"
              />
            </label>
          </template>

          <template v-else>
            <label class="field">
              <span class="field-label">{{ ACCOUNT.FIELD_PASSWORD }}</span>
              <MiInput
                v-model="recoverNewPass"
                type="password"
                :placeholder="ACCOUNT.PASSWORD_PLACEHOLDER"
                width="100%"
              />
            </label>
            <label class="field">
              <span class="field-label">{{ ACCOUNT.FIELD_CONFIRM }}</span>
              <MiInput
                v-model="recoverConfirm"
                type="password"
                :placeholder="ACCOUNT.CONFIRM_PLACEHOLDER"
                width="100%"
                @enter="recoverNext"
              />
            </label>
          </template>

          <MiButton
            size="lg"
            :loading="acct.busy === 'recover'"
            :disabled="!recoverCanGo"
            @click="recoverNext"
          >
            {{ recoverStep === 3 ? ACCOUNT.BTN_RECOVER_RESET : ACCOUNT.BTN_RECOVER_NEXT }}
          </MiButton>
          <button class="link" :disabled="acct.busy !== null" @click="endRecover">
            {{ ACCOUNT.BTN_RECOVER_CANCEL }}
          </button>
        </template>

        <!-- 双页签（向导没开时） -->
        <template v-else>
          <MiTabs v-model="tab" :tabs="TABS" />

          <!-- 登录页签 -->
          <template v-if="tab === 'login'">
            <label class="field">
              <span class="field-label">{{ ACCOUNT.FIELD_NAME }}</span>
              <MiInput
                v-model="loginName"
                :placeholder="ACCOUNT.NAME_PLACEHOLDER"
                width="100%"
              />
            </label>
            <label class="field">
              <span class="field-label">{{ ACCOUNT.FIELD_PASSWORD }}</span>
              <MiInput
                v-model="loginPass"
                type="password"
                :placeholder="ACCOUNT.PASSWORD_PLACEHOLDER"
                width="100%"
                @enter="onLogin"
              />
            </label>
            <MiButton
              size="lg"
              :loading="acct.busy === 'login'"
              :disabled="!loginName.trim() || !loginPass"
              @click="onLogin"
            >
              {{ ACCOUNT.BTN_LOGIN }}
            </MiButton>
            <!-- 忘记密码入口：就地链接式按钮（.link 先例见收编面板逃生口） -->
            <button class="link" :disabled="acct.busy !== null" @click="startRecover">
              {{ ACCOUNT.LINK_FORGOT }}
            </button>
            <p class="hint">{{ ACCOUNT.HINT }}</p>

            <div class="benefits">
              <div class="benefits-title">{{ ACCOUNT.BENEFITS_TITLE }}</div>
              <p class="benefit">{{ ACCOUNT.BENEFIT_SYNC }}</p>
              <p class="benefit">{{ ACCOUNT.BENEFIT_RANK }}</p>
              <p class="benefit">{{ ACCOUNT.BENEFIT_BACKUP }}</p>
            </div>
          </template>

          <!-- 注册页签 -->
          <template v-else>
            <label class="field">
              <span class="field-label">{{ ACCOUNT.FIELD_NAME }}</span>
              <MiInput v-model="regName" :placeholder="ACCOUNT.NAME_PLACEHOLDER" width="100%" />
            </label>
            <label class="field">
              <span class="field-label">{{ ACCOUNT.FIELD_PASSWORD }}</span>
              <MiInput
                v-model="regPass"
                type="password"
                :placeholder="ACCOUNT.PASSWORD_PLACEHOLDER"
                width="100%"
              />
            </label>
            <label class="field">
              <span class="field-label">{{ ACCOUNT.FIELD_CONFIRM }}</span>
              <MiInput
                v-model="regConfirm"
                type="password"
                :placeholder="ACCOUNT.CONFIRM_PLACEHOLDER"
                width="100%"
                @enter="onRegister"
              />
            </label>
            <!-- 找回密码的凭据（2026-10-13 主人令：注册必选一问一答） -->
            <label class="field">
              <span class="field-label">{{ ACCOUNT.FIELD_QUESTION }}</span>
              <MiSelect
                v-model="regQuestion"
                :options="QUESTION_OPTIONS"
                :placeholder="ACCOUNT.QUESTION_PLACEHOLDER"
              />
            </label>
            <label class="field">
              <span class="field-label">{{ ACCOUNT.FIELD_ANSWER }}</span>
              <MiInput
                v-model="regAnswer"
                :placeholder="ACCOUNT.ANSWER_PLACEHOLDER"
                width="100%"
                @enter="onRegister"
              />
            </label>
            <p class="hint">{{ ACCOUNT.REG_QA_HINT }}</p>
            <p class="hint">{{ ACCOUNT.REG_HINT }}</p>
            <MiButton
              size="lg"
              :loading="acct.busy === 'register'"
              :disabled="!regName.trim() || !regPass || !regConfirm || !regQuestion || !regAnswer.trim()"
              @click="onRegister"
            >
              {{ ACCOUNT.BTN_REGISTER }}
            </MiButton>
          </template>
        </template>
      </template>
    </section>

    <!-- 退出登录的二次确认（V2-12）：Teleport 到 body 的浮层，摆位随调用点 -->
    <!-- 新头像预览（2026-10-22）：确认之后才上传；上传在飞时不可关闭 -->
    <MiModal
      v-model:visible="avatarPreviewVisible"
      :title="ACCOUNT.AVATAR_PREVIEW_TITLE"
      :closable="!avatarUploading"
    >
      <div class="avatar-preview">
        <img :src="avatarPreview?.dataUrl ?? ''" alt="" />
        <p class="avatar-preview-name">{{ avatarPreviewName }}</p>
        <p class="hint">{{ ACCOUNT.AVATAR_PREVIEW_HINT }}</p>
      </div>
      <template #footer>
        <MiButton variant="secondary" :disabled="avatarUploading" @click="pickAnotherAvatar">
          {{ ACCOUNT.BTN_AVATAR_CANCEL }}
        </MiButton>
        <MiButton :loading="avatarUploading" @click="confirmAvatar">
          {{ ACCOUNT.BTN_AVATAR_CONFIRM }}
        </MiButton>
      </template>
    </MiModal>

    <!-- 改名的二次确认（2026-10-22）：用户名就是登录名，确认前不发请求 -->
    <MiModal
      v-model:visible="nameConfirmVisible"
      :title="ACCOUNT.NAME_CONFIRM_TITLE"
      :closable="acct.busy !== 'profile'"
    >
      <p class="logout-confirm-body">{{ ACCOUNT.NAME_CONFIRM_BODY }}</p>
      <template #footer>
        <MiButton
          variant="secondary"
          :disabled="acct.busy === 'profile'"
          @click="cancelNameConfirm"
        >
          {{ ACCOUNT.NAME_CONFIRM_CANCEL }}
        </MiButton>
        <MiButton variant="danger" :loading="acct.busy === 'profile'" @click="confirmNameChange">
          {{ ACCOUNT.BTN_NAME_CONFIRM }}
        </MiButton>
      </template>
    </MiModal>

    <MiModal v-model:visible="logoutConfirmVisible" :title="ACCOUNT.BTN_LOGOUT">
      <p class="logout-confirm-body">{{ ACCOUNT.LOGOUT_CONFIRM }}</p>
      <template #footer>
        <MiButton variant="secondary" @click="logoutConfirmVisible = false">
          {{ ACCOUNT.LOGOUT_CANCEL }}
        </MiButton>
        <MiButton variant="danger" @click="confirmLogout">
          {{ ACCOUNT.BTN_LOGOUT }}
        </MiButton>
      </template>
    </MiModal>

    <!-- 真登出失败的出路框（V1-62）：再试一次（要网络）或仅本机退出（零网络） -->
    <MiModal v-model:visible="logoutFailVisible" :title="ACCOUNT.LOGOUT_FAIL_TITLE">
      <p class="logout-confirm-body">{{ logoutFailText }}</p>
      <p class="logout-local-note">{{ ACCOUNT.LOGOUT_LOCAL_NOTE }}</p>
      <template #footer>
        <MiButton variant="secondary" :loading="acct.busy === 'logout'" @click="retryLogout">
          {{ ACCOUNT.BTN_RETRY }}
        </MiButton>
        <MiButton :loading="acct.busy === 'logout'" @click="onLogoutLocal">
          {{ ACCOUNT.BTN_LOGOUT_LOCAL }}
        </MiButton>
      </template>
    </MiModal>
  </div>
</template>

<style scoped>
.login-page {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  /*
   * 窗口比面板矮时能滚，不能切 —— 与 .sidebar 那条同源教训：
   * 不写 overflow 的话矮窗口下面板底部会被裁掉，而且是悄悄裁掉
   * （账号页比登录态高一大截，收编面板又更高，这条是每天都会走到的路）。
   */
  overflow-y: auto;
}

.login-panel {
  width: 380px;
  max-width: 100%;
  padding: 28px 26px 22px;
  border-radius: var(--mi-radius);
  /* glass 令牌：壁纸开时按 --mi-panel-alpha 稀释 —— 这一页壁纸一定在，
     面板正是主人要的「液态玻璃浮在沉浸背景上」；字一概实心（硬底线）。
     ⚠️ 全页唯一的玻璃面（wall-glass.test.ts 的 IN 清单钉着 1 处）——
     别再给任何子块套第二个玻璃令牌。 */
  background: var(--mi-card-glass);
  box-shadow: var(--mi-shadow);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}

.title {
  font-size: 20px;
  margin: 2px 0 0;
}
.sub {
  color: var(--mi-text-2);
  font-size: 13px;
  margin: 0 0 4px;
  line-height: 1.5;
}

/* 已登录：圆头像 + 「当前账号：××」 */
.me {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: 2px 0 6px;
}
.me-face {
  /* 86 = 84（UserAvatar）+ 两侧各 1px 边框；border-box 下内容区正好 84，
     头像一点不被裁（圆形裁切由 overflow 负责） */
  width: 86px;
  height: 86px;
  border-radius: 50%;
  overflow: hidden;
  border: 1px solid var(--mi-border);
  background: var(--mi-bg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.me-name {
  font-size: 14px;
  font-weight: 600;
}

/* 个人资料（2026-10-22）：两颗动作按钮 + 一行规格提示 + 就地展开的改名块 */
.profile-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}
.profile-hint {
  margin: 0;
  font-size: 11px;
  color: var(--mi-text-3);
  text-align: center;
}
.name-edit {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}
.name-edit-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
}

/* 头像预览：圆形 160px 居中；文件名只做"选的是哪张"的提示 */
.avatar-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.avatar-preview img {
  width: 160px;
  height: 160px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--mi-border);
  background: var(--mi-bg);
}
.avatar-preview-name {
  margin: 0;
  max-width: 100%;
  font-size: 12px;
  color: var(--mi-text-2);
  word-break: break-all;
  text-align: center;
}

/* 表单行：标签在左上，输入框吃满整行 */
.field {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
}
.field-label {
  font-size: 12px;
  color: var(--mi-text-2);
}
/* MiSelect 自身没有 width 档：原生 select 在这里要撑满整行（同 MiInput 的 width=100%） */
.field :deep(.mi-select) {
  width: 100%;
  box-sizing: border-box;
}

/* 找回第 2 步回显的问题原文：做成只读框的样子（底与边框同 .mi-select，不可编辑） */
.recover-question {
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 7px 10px;
  font-size: 13px;
  line-height: 1.5;
  text-align: left;
  color: var(--mi-text);
  background: var(--mi-bg);
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
}

.hint {
  font-size: 12px;
  color: var(--mi-text-2);
  margin: 2px 0 0;
  line-height: 1.5;
}

/* 收编引导中间那几行说明（loading / 失败 / 问句） */
.adopt-line {
  font-size: 13px;
  color: var(--mi-text-2);
  margin: 2px 0 0;
  line-height: 1.6;
}
.adopt-warn {
  color: var(--mi-warn-deep);
}
.adopt-note {
  font-size: 12px;
  color: var(--mi-text-3);
  margin: 0;
  line-height: 1.5;
}
/* 「推荐」小签：垫在合并按钮的文字后面（继承按钮文字色，白底叠一层即可） */
.rec {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.28);
}

/*
 * 同步块：与上方账号区一条分隔线 —— 上面是「你是谁」，下面是「数据怎么样了」，
 * 两段性质不同，得看得出分界（同 .benefits 的先例）。
 */
.sync-block {
  width: 100%;
  margin-top: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--mi-border);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
/* 同步按钮排（V1-65）：立即同步 + （在飞时才出现的）停止并排居中 */
.sync-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.sync-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  width: 100%;
}
.sync-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--mi-text-2);
}
.sync-when {
  font-size: 12px;
  color: var(--mi-text-3);
}
.sync-line {
  font-size: 12.5px;
  margin: 0;
  line-height: 1.5;
}
.sync-warn {
  color: var(--mi-warn-deep);
}
.sync-pending {
  color: var(--mi-text-2);
}
.sync-ok {
  color: var(--mi-success-deep);
}

/*
 * 「登录之后能做什么」清单：与表单之间一条分隔线 —— 上面是**现在能做的**
 * （打字、按按钮），下面是**登录之后才有的**，两段性质不同，得看得出分界。
 */
.benefits {
  width: 100%;
  margin-top: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--mi-border);
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.benefits-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--mi-text-2);
}
.benefit {
  font-size: 12.5px;
  color: var(--mi-text-2);
  margin: 0;
}

/* 就地链接式按钮（收编面板的逃生口）：真 <button> 才有键盘与读屏语义 */
.link {
  border: none;
  background: transparent;
  padding: 2px 4px;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--mi-blue-ink);
  cursor: var(--mi-cursor, pointer);
}
.link:hover {
  text-decoration: underline;
}
.link:disabled {
  color: var(--mi-text-3);
  cursor: default;
  text-decoration: none;
}
.link:focus-visible {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 2px;
}

/* 退出确认框的正文（V2-12）：普通段落尺寸，说清去向与保留的东西 */
.logout-confirm-body {
  font-size: 13px;
  color: var(--mi-text-2);
  line-height: 1.8;
}

/* 出路框的补充说明（V1-62）：比正文弱一档，交代「仅本机退出」的代价 */
.logout-local-note {
  font-size: 12.5px;
  color: var(--mi-text-3);
  line-height: 1.7;
  margin: 8px 0 0;
}

/*
 * 返回块：z-index 100 照 .panel-toggle 的先例（浮在内容之上、低过一切遮罩）。
 * 底色用实色 --mi-bg 而不是玻璃 —— 它压在**壁纸**上，玻璃令牌的稀释
 * （--mi-panel-alpha）到 10% 时这枚小胶囊会糊得看不清字。
 */
.back-chip {
  position: fixed;
  top: calc(var(--mi-topbar-h) + 10px);
  left: 12px;
  z-index: 100;
  padding: 6px 14px;
  border: 1px solid var(--mi-border);
  border-radius: 999px;
  background: var(--mi-bg);
  color: var(--mi-text-2);
  font-family: inherit;
  font-size: 13px;
  cursor: var(--mi-cursor, pointer);
  transition: background var(--mi-dur-fast) var(--mi-ease);
}
.back-chip:hover {
  background: var(--mi-blue-light);
}
/* 焦点环：与左栏 rail 同一套约定（2px 笔画色、offset 2px） */
.back-chip:focus-visible {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 2px;
}
</style>
