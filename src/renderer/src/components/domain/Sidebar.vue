<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useContentStore } from '../../stores/content'
import { useProgressStore } from '../../stores/progress'
import { useSearchStore } from '../../stores/search'
import { useSettingsStore } from '../../stores/settings'
import { usePetStore } from '../../stores/pet'
import { useSidebarNavStore } from '../../stores/sidebar-nav'
import { useAccountStore } from '../../stores/account'
import { useLessonOpener } from '../../lib/openLesson'
import { STAGE_LABEL } from '../../lib/labels'
import { defaultOpenMap, type NavGroupId, type NavOpenMap } from '../../lib/sidebar-nav'
import { computePerLang, overallPercent, type StageProgress } from '../../lib/overview'
import { useStagePaperFlow } from '../../lib/stage-practice'
import { ACCOUNT, AFFECTION, NAV, NAV_ICON, PAPER, PLACEHOLDER, SIDEBAR } from '../../lib/copy'
// MOOD_NAMES（六条整句心情名）—— V1-47 起脸色徽记的悬停说明消费者
import { PET } from '../../../../shared/copy'
import { logoutFailureText } from '../../lib/account-view'
import MiProgressRing from '../base/MiProgressRing.vue'
import MiInput from '../base/MiInput.vue'
import UserAvatar from './UserAvatar.vue'
import MiButton from '../base/MiButton.vue'
import MiModal from '../base/MiModal.vue'
import { toast } from '../base/toast'
import StagePaperDialog from './StagePaperDialog.vue'
import { sidebarModeOf } from '../../../../shared/layout'
import type { Lang } from '../../../../shared/types'

// M2-03：侧边栏完整版（Logo/总进度环/阶段选择/模块切换/知识点列表带锁与收藏徽标/设置入口）
// M2-05 接入搜索框逻辑
const route = useRoute()
const router = useRouter()
const content = useContentStore()
const progress = useProgressStore()
const search = useSearchStore()
const settings = useSettingsStore()
const { openLesson } = useLessonOpener()

/**
 * 侧栏底部九点阵按钮（UI 大修轮 §1.3）的出口：往上抛事件，App.vue 收到置
 * menuOpen=true（菜单本体挂在那儿，v-if="!isBare"）。侧栏不自己持开合态 ——
 * 开合的唯一真源是 App 的 menuOpen（关闭一律由 FullscreenMenu 处理：Esc /
 * 点空白 / 点格子 / 点 ✕）。
 */
const emit = defineEmits<{ 'open-menu': [] }>()

/**
 * 顶上那枚总进度环。
 *
 * 【为什么分母在这儿现取，不在 store 里算】见 stores/progress.ts 里那段注释：
 * 那个 store 是内容 store 的**上游**，读不到 `bundle.lessons`，而分母必须是
 * 「有正文的课数」。算式在 lib/overview.ts（纯函数、有单测），这里只负责喂数据。
 */
const allPercent = computed(() => overallPercent(progress.learnedSet, content.bundle.lessons))

/**
 * 左栏当前是不是 rail（图标窄栏）态 —— v18 三态循环（open → rail → hidden）的
 * 中间态，循环与判定在 shared/layout.ts 的 sidebarTogglePatch / sidebarModeOf。
 * rail 期整个内容换成图标列（pane 宽只有 RAIL_SIZE ≈ 50px，整宽态那套排版
 * 一个都用不上）；判定只此一处，模板别自己写 open && rail 的组合。
 */
const rail = computed(() => sidebarModeOf(settings.config.layout) === 'rail')

/**
 * 身份区（UI 大修轮 §1.2 → P10.6 接云账号 → 2026-10-22 用户系统）：
 * 名字来自 account store ——「未登录」就是未登录，登录了显示用户名（重启恢复
 * 的会话先读主进程 session.bin 的资料快照，cloud-sync 启动时的 probeSession
 * 再从服务器补齐；还没读到时用 IDENTITY_USER 兜底，不拿上一个人的名字冒充）。
 * 头像走 UserAvatar：有云头像就显示内容寻址的图片，没设/没取到就退回默认
 * 大肥鱼立绘（未登录用 guide 指路，已登录用 welcome）。
 * 点击：未登录 = 去登录；已登录 = 展开下拉菜单（账号中心 / 退出登录，
 * 2026-10-13 主人令）—— 退出与换账号不再需要先进账号页再找按钮。
 */
const account = useAccountStore()
const identityName = computed(() =>
  account.signedIn ? (account.username ?? SIDEBAR.IDENTITY_USER) : SIDEBAR.IDENTITY_GUEST
)
const identityTip = computed(() =>
  account.signedIn ? SIDEBAR.IDENTITY_USER_TIP : SIDEBAR.IDENTITY_GUEST_TIP
)
/** 没设置头像时的兜底姿态：未登录给向导（指路去登录）、已登录给打招呼 */
const identityPose = computed(() => (account.signedIn ? 'welcome' : 'guide'))

/**
 * 身份区下拉菜单（2026-10-13 主人令：退出登录要有醒目入口）。
 * 未登录点身份区照旧直接去登录页；已登录点它开合菜单（账号中心 / 退出登录）。
 * 「切换账号」走的正是退出登录这条路 —— 干净退回登录页后直接登另一个号
 * （单会话令牌决定换号只能是"先退再登"，不另立一颗按钮说同一句话）。
 */
const identityMenu = ref<HTMLElement | null>(null)
const identityMenuOpen = ref(false)

function toggleIdentityMenu(): void {
  if (!account.signedIn) {
    void router.push('/login')
    return
  }
  identityMenuOpen.value = !identityMenuOpen.value
}

function closeIdentityMenu(): void {
  identityMenuOpen.value = false
}

/** 账号中心：就是 /login（已登录态那页渲染的正是账号面板：当前账号 + 同步块） */
function goAccountCenter(): void {
  closeIdentityMenu()
  void router.push('/login')
}

/**
 * 退出登录。清凭证的活在主进程（stores/account.ts 的 logout → cloud:logout），
 * 这里只管「成功才翻脸」：失败（网络抖一下）原样报码 ——
 * 「没登成」和「没登录」是两件事，不许把后者当前者（同 store 里那条注释）。
 *
 * ⚠️ 菜单的收起不再由这条管（V2-12 起）：点「退出登录」先收菜单、开确认框
 * （askLogoutFromMenu），真退时菜单早已收起 —— 原来那句「失败时菜单不收」
 * 描述的是没有确认框时的形态，已随这次改动作废，别照着旧注释去猜。
 */
async function logoutFromMenu(): Promise<void> {
  const res = await account.logout()
  if (!res.ok) {
    // V1-62：断网时说清"退出登录需要联网、什么都没变"（映射与判据在
    // lib/account-view.ts，两个出口共用）
    toast(logoutFailureText(res.failure.code), 'error')
    return
  }
  toast(ACCOUNT.OK_LOGOUT, 'success')
  // 干净退回登录/注册页（登录页签）：登录态已由 store.refresh 翻掉，这里只管走
  void router.push('/login')
}

/**
 * 退出确认框（V2-12）。原来点「退出登录」一点即退 —— 它和「账号中心」上下
 * 相邻，误点的代价是回登录页重新输密码。危险动作要有二次确认（同删除类
 * 动作的惯例：MemoView / FavoritesView 都是 MiModal + 危险色确认）。
 *
 * 【为什么先收菜单再开框】菜单是「点外面就关」的浮层，留着它，确认框弹出来
 * 的同时菜单还挂着，两层浮层叠着像出了两次错。
 */
const logoutConfirmVisible = ref(false)

function askLogoutFromMenu(): void {
  closeIdentityMenu()
  logoutConfirmVisible.value = true
}

/** 确认框里那颗「退出登录」：关框 → 走原来的真退（失败报码那条路不变） */
function confirmLogoutFromMenu(): void {
  logoutConfirmVisible.value = false
  void logoutFromMenu()
}

/** 点菜单外关闭：mousedown 而不是 click —— click 要等鼠标抬起，拖拽选词出菜单外也会命中 */
function onIdentityDocDown(e: MouseEvent): void {
  if (identityMenu.value && !identityMenu.value.contains(e.target as Node)) closeIdentityMenu()
}
function onIdentityDocKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeIdentityMenu()
}

// 只在开着时挂全局监听，收掉不留常驻（Escape 与点外关闭是"开门才有门"）
watch(identityMenuOpen, (open) => {
  if (open) {
    document.addEventListener('mousedown', onIdentityDocDown)
    document.addEventListener('keydown', onIdentityDocKey)
  } else {
    document.removeEventListener('mousedown', onIdentityDocDown)
    document.removeEventListener('keydown', onIdentityDocKey)
  }
})

// 模块名与阶段名一律走 copy/labels，不再在本文件里各写一遍
const LEARN_MODULES: { lang: Lang; label: string }[] = (
  ['common', 'c', 'cpp', 'java', 'python'] as const
).map((lang) => ({ lang, label: SIDEBAR.moduleLabel(lang) }))

const STAGES: { value: 1 | 2 | 3; label: string }[] = ([1, 2, 3] as const).map((value) => ({
  value,
  label: STAGE_LABEL[value]
}))

function selectModule(lang: Lang) {
  content.selectLang(lang)
  router.push('/learn')
}

// ---- 阶段末尾的综合练习入口（2026-10-01 与练习页「阶段练习」页签一起加的）

/** 确认框那一步的全部状态（组卷/开卷都在 `lib/stage-practice.ts`，与练习页共用） */
const { pendingPaper, paperOpen, openPaper, startPaper } = useStagePaperFlow()

/**
 * 当前（语言 × 阶段）的综合练习实况。null = 这一格不该出现按钮
 * （common 没有阶段卷；这一档还没排正文时 total 也是 0）。
 *
 * 【判据为什么从 computePerLang 取】「学完了没」的算式在 `lib/overview.ts`
 * （纯函数、有单测），总览页和练习页用的是同一份 —— 侧栏自己数一遍的话，
 * 三处的「还差 N 课」迟早对不上。`common` 不显示阶段相关 UI（docs/19 的结论）。
 */
const stageProgress = computed<StageProgress | null>(() => {
  if (content.activeLang === 'common') return null
  const p = computePerLang(content.bundle.outline, content.bundle.lessons, progress.learnedSet).find(
    (x) => x.lang === content.activeLang
  )
  const s = p?.stages.find((x) => x.stage === content.activeStage)
  return s && s.total > 0 ? s : null
})

/**
 * 点侧栏这颗按钮 = 直接走「组卷 → 确认框」，和练习页那条路同一个 composable。
 *
 * ⚠️ 这里再问一次 `activeLang` 不是兜底（`stageProgress` 自己就拦了 common），
 * 是给类型收窄用的 —— `openPaper` 的 lang 参数不收 'common'。
 */
function openStagePaper(): void {
  const s = stageProgress.value
  if (!s || content.activeLang === 'common') return
  openPaper('stage', content.activeLang, s.stage)
}

/*
 * 每行末尾那枚状态徽标。
 *
 * 【为什么 draft 从 📦 换成 💬】
 * 📦 是个**箱子**，读起来像「里面有东西，打开它」—— 而这一行的意思恰好相反：
 * 里面什么都没有，点了也进不去。主人正是照着自己的直觉去点，才连撞几次
 * 「还在备课」。💬（还没说话）表达的是「这一格还没开口」，而且 CSS 能把它
 * 压成灰的（emoji 自带颜色不跟主题走，只能靠 filter），一眼就和写好的课分得开。
 *
 * 【为什么 open 从空字符串换成 📖】
 * 原来「能学的课」不画任何图标，结果整列要么是 📦 要么是 🔒，
 * 唯一能点的那几行反而**长得最不起眼**。给写好的课一个亮书图标，
 * 「哪些能点」不用试就知道。learned 的 ✓ 保持不动（它信息量更大）。
 */
function statusIcon(status: string): string {
  if (status === 'learned') return '✓'
  if (status === 'locked') return '🔒'
  if (status === 'draft') return '💬'
  return '📖'
}

// ---- 好感度爱心（P3 ④，2026-10-08）

/**
 * 数据 = 渲染层宠物镜像（`stores/pet.ts`），这一栏不自己问主进程。
 * 快照还没到时 `affection` 是 `null`：**画 `--%`，不画 `0%`** ——
 * 0 是"处得很差"，还没读到就是还没读到（同 store 里 face 的 null 口径：
 * 不许替鱼说谎）。
 */
const pet = usePetStore()

/** 百分比文字。round 到整数（好感是 0..100 的慢变量，小数位没有信息量） */
const affectionText = computed(() =>
  pet.affection === null ? '--%' : `${Math.round(pet.affection)}%`
)

/**
 * 五档配色：走**主题感知的 ink/deep 档令牌**（浅色是压深的那批、深色会翻成
 * 亮色那批），而不是 --mi-success/--mi-error 那组"填充色"——填充色压在白底上
 * 对比度不够，当文字色用会跌破 4.5。令牌名到档名的映射只此一处。
 */
const affectionTierClass = computed(() => `aff-${pet.affectionTier ?? 'none'}`)

/** 悬停提示：报出档名（百分比看得见，档名只有这里说；快照没到就不编一个） */
const affectionTip = computed(() =>
  pet.affectionTier === null
    ? SIDEBAR.AFFECTION
    : AFFECTION.TIP(AFFECTION.TIERS[pet.affectionTier])
)

// ---- 饱腹度徽记 + 签到徽记（UI 大修轮 §1.5 / §1.4，2026-10-09）

/**
 * 🍚 百分比文字。快照没到 → '--%'，不画 0% —— 同爱心那段的 null 口径：
 * 「还没读到」不是「0 分」。
 * ⚠️ store 的 satiety computed 在快照缺席时会**兜成 0**（见 stores/pet.ts），
 * 所以判空必须看 `pet.snap` 本体，不能看 satiety 的值。
 */
const satietyText = computed(() => (pet.snap === null ? '--%' : `${Math.round(pet.satiety)}%`))

/** 🍚 悬停说明：走 copy 的函数键（快照没到就如实说"还在加载"，同 SATIETY_TIP 的口径） */
const satietyTip = computed(() =>
  SIDEBAR.SATIETY_TIP(pet.snap ? pet.satiety : null, pet.snap ? pet.rice : null)
)

// ---- 脸色徽记（V1-47，2026-10-15 夜）

/**
 * 「脸色」= 饿/困/傲娇/兴奋…（现算规则在 shared/pet.ts 的 petFace，这里只镜像）。
 * 快照还没到 → `pet.face` 是 `null`：图标画 🐟、短名画 `--`，不替它挑一张脸
 * （同好感/饱腹的 null 口径：还没读到就是还没读到）。
 */
const faceIcon = computed(() => (pet.face === null ? '🐟' : SIDEBAR.FACE_ICON[pet.face]))
const faceText = computed(() => (pet.face === null ? '--' : SIDEBAR.FACE_SHORT[pet.face]))

/**
 * 脸色的短名配色（同 aff-* 的账：走**主题感知的 ink/deep 档令牌**，
 * 不用填充色当字色）。只给三种"要注意"的脸色上色 —— 饿=红、困=灰、
 * 情绪（傲娇/兴奋）=琥珀；happy/ok/未读到保持默认 --mi-text-3，
 * 常驻元素满屏彩字反而没有重点。
 */
const faceTextClass = computed(() => {
  switch (pet.face) {
    case 'hungry':
      return 'face-hungry'
    case 'sleepy':
      return 'face-sleepy'
    case 'tsundere':
    case 'excited':
      return 'face-mood'
    default:
      return ''
  }
})

/**
 * 悬停说明 = MOOD_NAMES 的**整句**（「傲娇中（刚被 rua 完，正在消气）」——
 * 说清"为什么"）+ 可点后缀。短名只说"是什么"，长句挂在这条 tip 上，
 * 六条 MOOD_NAMES 从此有了真消费者（V1-47 前它们全仓零引用）。
 */
const faceTip = computed(() =>
  SIDEBAR.METER_GUIDE_TIP(pet.face === null ? SIDEBAR.FACE_LOADING : PET.MOOD_NAMES[pet.face])
)

/**
 * 未签徽记（§1.4）：只在档案装载完成、且今天还没签到时亮。
 * `!loaded` 不画点 —— 档案还没读到是「还不知道」，不是「没签」（同上两条的口径）。
 *
 * 【签到并入总览（2026-10-09 模块三）】原来这份圆点挂在独立「每日签到」格上，
 * 那格与「总览」同路由双高亮、已删除；圆点改挂「总览」格 —— 点开总览即达
 * 签到卡（未签时总览页自己会滚过去 + 闪一下 + 把焦点给签到按钮，见
 * OverviewView.guideToCheckin）。
 */
const showCheckinDot = computed(() => progress.loaded && !progress.checkedInToday)

/**
 * 点状态块两枚徽记（❤ / 🍚）= 去设置页的「大肥鱼互动说明」面板
 * （2026-10-09「状态规则透明化」模块）。
 *
 * 【为什么必须带 at nonce】设置页 watch 的是 `route.query.at` 而不是 card
 * （`lib/app-nav.ts` 的先例）—— 已在设置页时再点，「同 URL 不产生导航变化」，
 * 不带 nonce 就静默不滚。nonce 用时间戳，连点两次也各算一次。
 */
function openPetGuide(): void {
  void router.push({ path: '/settings', query: { card: 'pet', at: String(Date.now()) } })
}

// ---- 手风琴（2026-10-09「侧边栏 UI 收纳」模块；2026-10-10 IA 重构改三组）

/**
 * 三组折叠态：用户点过组头 → 他说了算（store 里存的三键布尔集）；
 * 没点过 → 自动态，只展开当前路由所在的那一组（判据在 lib/sidebar-nav.ts，
 * 有单测；settings 之类不隶属任何组的页兜底回「学习」）。
 *
 * 【2026-10-10 IA 重构】第 4 组「知识点」撤销：课列表 / N-M 计数 / 阶段综合
 * 练习整块并进学习组内部，跟着学习组一起开合，不再单独折叠。课详情（lesson）
 * 路由也因此回学习组 —— 读课时左侧默认展开的就是「学习」：语言 + 阶段 + 课。
 *
 * rail 态不消费它 —— 图标窄栏里没有组头，也没有「折叠」可言（见 rail 分支注释）。
 */
const sidebarNav = useSidebarNavStore()
// route.name 的类型是 string | symbol | undefined（vue-router 的 RouteRecordNameGeneric）；
// 本应用的路由名全是字符串，symbol（命名路由之外没人这么写）当作"不认识"→ 兜底 learn，
// 与未知名字同一条路。收窄放在这里，lib 那层保持 string 契约（单测钉的就是它）。
const routeName = computed<string | null>(() => (typeof route.name === 'string' ? route.name : null))
const openGroups = computed<NavOpenMap>(() => sidebarNav.explicit ?? defaultOpenMap(routeName.value))

/**
 * 点组头（2026-10-10 主人批·图一改成手风琴口径）：以「当前生效图」为底算
 * 下一张图 —— 开一组就收起其它两组；点已开组 = 全收（语义在纯函数
 * soloToggleGroup，见 lib/sidebar-nav.ts；store 仍是唯一写口）。
 */
function toggleGroup(id: NavGroupId): void {
  sidebarNav.toggleSolo(id, openGroups.value)
}

/**
 * 轮询引用（refcount 单例在 store 里，全应用一条 5s 表）。
 *
 * 【为什么挂载即引用，不按 rail 切换起停】rail 态不显示爱心，但"随 rail
 * 反复起停"要给表加一条状态机；5s 一发的 IPC 成本远小于状态机出错的代价。
 */
let releasePetPoll: (() => void) | null = null

onMounted(() => {
  void pet.init()
  releasePetPoll = pet.ensurePetPoller()
})

onBeforeUnmount(() => {
  releasePetPoll?.()
  releasePetPoll = null
  // 菜单开着时被卸载（切路由换壳等）：监听跟着走，别留一条指向死组件的全局键
  document.removeEventListener('mousedown', onIdentityDocDown)
  document.removeEventListener('keydown', onIdentityDocKey)
})
</script>

<template>
  <aside class="sidebar" :class="{ 'is-rail': rail }">
    <!--
      rail 态（v18 三态循环的中间态）：一整列图标 —— 整宽态那套
      （状态块/阶段选择/课程列表）在 ~50px 里一个都放不下（rail 显示集
      是蓝图 IA-7 定的：身份头像 + 功能格 + 设置；搜索与 5 个语言格是
      记录在案的偏离 —— 模块切换是主要导航，整个拿掉它导航就断了一条腿）。
      每格的 title 取整串可读名（icon+文字），键盘/读屏拿得到名字。
      顺序与整宽态**逐项一致**（§1.1 四分组：语言/复习挑战/个人中心），
      组间细分割线代替组标题文字；宽度本身归 App.vue 的 Pane 管（min==max 钉死）。
    -->
    <div v-if="rail" class="rail-col">
      <!-- 身份区（§1.2）：28px 圆头像、无文字，点一下去 /login（与整宽态同一落点） -->
      <button
        type="button"
        class="rail-item rail-identity"
        :title="identityTip"
        @click="router.push('/login')"
      >
        <span class="avatar avatar-sm">
          <UserAvatar :hash="account.avatarHash" :px="28" :fallback-pose="identityPose" />
        </span>
      </button>

      <!-- 搜索：整宽态是输入框，rail 里退化成图标钮 —— 打开的是同一个搜索面板 -->
      <button
        class="rail-item"
        :title="PLACEHOLDER.SIDEBAR_SEARCH"
        @click="search.openPanel(search.query)"
      >
        🔍
      </button>

      <!-- 学习：5 语言 → 练习 → 运行代码 → 备忘录（图标单配：copy.ts 的
           moduleIcon / NAV_ICON —— 别再拿 moduleLabel 的 🐾） -->
      <button
        v-for="m in LEARN_MODULES"
        :key="m.lang"
        class="rail-item"
        :class="{ active: route.name === 'learn' && content.activeLang === m.lang }"
        :title="m.label"
        @click="selectModule(m.lang)"
      >
        {{ SIDEBAR.moduleIcon(m.lang) }}
      </button>
      <button
        class="rail-item"
        :class="{ active: route.name === 'practice' }"
        :title="NAV.PRACTICE"
        @click="router.push('/practice')"
      >
        {{ NAV_ICON.PRACTICE }}
      </button>
      <button
        class="rail-item"
        :class="{ active: route.name === 'playground' }"
        :title="NAV.PLAYGROUND"
        @click="router.push('/playground')"
      >
        {{ NAV_ICON.PLAYGROUND }}
      </button>
      <button
        class="rail-item"
        :class="{ active: route.name === 'memo' }"
        :title="NAV.MEMO"
        @click="router.push('/memo')"
      >
        {{ NAV_ICON.MEMO }}
      </button>

      <div class="rail-divider" aria-hidden="true"></div>

      <!-- 复习与挑战：每日复习（v-if reviewEnabled，与整宽态同一条规矩 ——
           关掉 = 全应用入口消失）→ 每日挑战 → 收藏 → 仓库 -->
      <button
        v-if="settings.config.reviewEnabled"
        class="rail-item"
        :class="{ active: route.name === 'review' }"
        :title="NAV.REVIEW"
        @click="router.push('/review')"
      >
        {{ NAV_ICON.REVIEW }}
      </button>
      <button
        class="rail-item"
        :class="{ active: route.name === 'challenge' }"
        :title="NAV.CHALLENGE"
        @click="router.push('/challenge')"
      >
        {{ NAV_ICON.CHALLENGE }}
      </button>
      <button
        class="rail-item"
        :class="{ active: route.name === 'favorites' }"
        :title="NAV.FAVORITES"
        @click="router.push('/favorites')"
      >
        {{ NAV_ICON.FAVORITES }}
      </button>
      <button
        class="rail-item"
        :class="{ active: route.name === 'warehouse' }"
        :title="NAV.WAREHOUSE"
        @click="router.push('/warehouse')"
      >
        {{ NAV_ICON.WAREHOUSE }}
      </button>

      <div class="rail-divider" aria-hidden="true"></div>

      <!-- 个人中心：总览（未签带圆点）→ 排行榜 → 登录（签到并入总览，2026-10-09） -->
      <button
        class="rail-item"
        :class="{ active: route.name === 'overview' }"
        :title="NAV.OVERVIEW"
        @click="router.push('/overview')"
      >
        {{ NAV_ICON.OVERVIEW }}
        <span v-if="showCheckinDot" class="checkin-dot" aria-hidden="true"></span>
      </button>
      <button
        class="rail-item"
        :class="{ active: route.name === 'leaderboard' }"
        :title="NAV.LEADERBOARD"
        @click="router.push('/leaderboard')"
      >
        {{ NAV_ICON.LEADERBOARD }}
      </button>
      <button
        class="rail-item"
        :class="{ active: route.name === 'login' }"
        :title="NAV.LOGIN"
        @click="router.push('/login')"
      >
        {{ NAV_ICON.LOGIN }}
      </button>

      <!-- 底部工具区（§1.3）：这条分割线的 margin-top:auto 把「线 + 菜单 + 设置」
           整段钉到列底（全列**唯一**的 auto 外边距；再加第二个会把空白劈成两半），
           菜单在上、设置在下 —— 与整宽态 .side-footer 的一行两钮一一对应 -->
      <div class="rail-divider rail-foot-start" aria-hidden="true"></div>
      <button class="rail-item" :title="SIDEBAR.MENU_BTN_TITLE" @click="emit('open-menu')">
        <svg class="grid-icon" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="3" cy="3" r="1.6" />
          <circle cx="9" cy="3" r="1.6" />
          <circle cx="15" cy="3" r="1.6" />
          <circle cx="3" cy="9" r="1.6" />
          <circle cx="9" cy="9" r="1.6" />
          <circle cx="15" cy="9" r="1.6" />
          <circle cx="3" cy="15" r="1.6" />
          <circle cx="9" cy="15" r="1.6" />
          <circle cx="15" cy="15" r="1.6" />
        </svg>
      </button>
      <button
        class="rail-item"
        :class="{ active: route.name === 'settings' }"
        :title="NAV.SETTINGS"
        @click="router.push('/settings')"
      >
        {{ NAV_ICON.SETTINGS }}
      </button>
    </div>

    <template v-else>
      <!--
        身份区（UI 大修轮 §1.2）：原来是 .logo 一整块（🐱 + 猫咪立绘 + 品牌名/
        标语）—— 那套吉祥物与品牌语在主页 Welcome 卡里已有同一份，这里是第二份，
        整块收掉（不是搬走）。换成「你是谁」：32px 圆头像 + 昵称/未登录。
        点击：未登录=去登录；已登录=开合下面的下拉菜单（账号中心 / 退出登录，
        2026-10-13 主人令）—— 退出与换账号不再藏进账号页。
      -->
      <div ref="identityMenu" class="identity-wrap">
        <button
          type="button"
          class="identity"
          :title="identityTip"
          :aria-expanded="account.signedIn ? identityMenuOpen : undefined"
          :aria-haspopup="account.signedIn ? 'menu' : undefined"
          @click="toggleIdentityMenu"
        >
          <span class="avatar">
            <UserAvatar :hash="account.avatarHash" :px="32" :fallback-pose="identityPose" />
          </span>
          <span class="identity-name">{{ identityName }}</span>
        </button>

        <!--
          下拉菜单：只给已登录的人准备（未登录点身份区直接去登录页，没有菜单）。
          signedIn 连读：令牌在别处死掉（authInvalid）时菜单跟着收 —— 不许给
          已掉线的人留一颗"退出登录"。「退出登录」用危险色写全 ——
          主人令里的「醒目」就落在这里那颗的配色上。
        -->
        <div
          v-if="identityMenuOpen && account.signedIn"
          class="identity-menu"
          role="menu"
          :aria-label="SIDEBAR.IDENTITY_MENU_LABEL"
        >
          <button
            type="button"
            class="identity-menu-item"
            role="menuitem"
            :disabled="account.busy !== null"
            @click="goAccountCenter"
          >
            <span class="identity-menu-main">{{ SIDEBAR.IDENTITY_MENU_ACCOUNT }}</span>
            <span class="identity-menu-sub">{{ SIDEBAR.IDENTITY_MENU_ACCOUNT_SUB }}</span>
          </button>
          <button
            type="button"
            class="identity-menu-item identity-menu-logout"
            role="menuitem"
            :disabled="account.busy !== null"
            @click="askLogoutFromMenu"
          >
            <span class="identity-menu-main">{{ SIDEBAR.IDENTITY_MENU_LOGOUT }}</span>
            <span class="identity-menu-sub">{{ SIDEBAR.IDENTITY_MENU_LOGOUT_SUB }}</span>
          </button>
        </div>
      </div>

      <!--
        状态块（UI 大修轮 §1.5）：原来「进度环 + 学习总进度」与「好感度爱心」
        上下两行合成一块 —— 环 56px 原样（百分比本来就画在环心里，外面那行
        标签收进 title），右侧徽记并排：❤ 好感度（档位配色 aff-* 原样保留）
        + 🍚 饱腹度（快照没到画 --%，口径见脚本段）+ 「脸色」（V1-47 新增，
        六档心情常驻可见，整句解释走 MOOD_NAMES）。悬停说明各自带全。
        【2026-10-09 状态规则透明化】徽记从 span 升成 button：点一下去
        设置页的「大肥鱼互动说明」面板（?card=pet 直达，滚过去 + 闪一下）——
        悬停提示里补一句「点一下看…」（SIDEBAR.METER_GUIDE_TIP）。
      -->
      <div class="status-block">
        <MiProgressRing :percent="allPercent" :size="56" :stroke="5" :title="SIDEBAR.PROGRESS_LABEL" />
        <div class="status-meters">
          <button
            type="button"
            class="meter"
            :title="SIDEBAR.METER_GUIDE_TIP(affectionTip)"
            :aria-label="SIDEBAR.METER_GUIDE_TIP(affectionTip)"
            @click="openPetGuide"
          >
            <span class="meter-icon meter-heart" aria-hidden="true">❤</span>
            <span class="meter-num" :class="affectionTierClass">{{ affectionText }}</span>
          </button>
          <button
            type="button"
            class="meter"
            :title="SIDEBAR.METER_GUIDE_TIP(satietyTip)"
            :aria-label="SIDEBAR.METER_GUIDE_TIP(satietyTip)"
            @click="openPetGuide"
          >
            <span class="meter-icon" aria-hidden="true">🍚</span>
            <span class="meter-num">{{ satietyText }}</span>
          </button>
          <!--
            脸色徽记（V1-47）：饿/困/傲娇/兴奋常驻可见 —— 完整解释
            （MOOD_NAMES 整句）在悬停说明里。快照没到画 🐟 + --，不替鱼挑脸。
          -->
          <button
            type="button"
            class="meter"
            :title="faceTip"
            :aria-label="faceTip"
            @click="openPetGuide"
          >
            <span class="meter-icon" aria-hidden="true">{{ faceIcon }}</span>
            <span class="meter-num" :class="faceTextClass">{{ faceText }}</span>
          </button>
        </div>
      </div>

      <div class="side-section">
        <!--
          开面板的口子（V2-42 修复现场，2026-10-15）：
          `@focus` 原来是**原生**监听（MiInput 的 emits 里没有 focus，属性透传到根元素），
          于是 Tab 路过这个输入框就会弹面板 —— 键盘党每绕侧栏一圈都吃一记全屏弹层。
          改成 `@click`（同样是原生透传）：鼠标点进来照旧弹；键盘党走 `@enter`，
          Tab 只是停在这儿，想开再按回车。两条路一心一意，不再有"路过即弹"。
        -->
        <MiInput
          v-model="search.query"
          :placeholder="PLACEHOLDER.SIDEBAR_SEARCH"
          width="100%"
          @click="search.openPanel(search.query)"
          @enter="search.openPanel(search.query)"
        />
      </div>

      <!--
        三组导航（UI 大修轮 §1.1；2026-10-10 IA 重构：课列表并入学习组，回到
        三组）：学习（内含语言格 / 阶段选择 / 课列表 / 综合练习 / 功能格）/
        复习与挑战 / 个人中心 + 底部设置（.side-footer，不设组标题，留在原位）。
        【顺序纪律】组内顺序 = rail 列 = 全屏菜单宫格，三处逐项同序（rail 那列
        与 FullscreenMenu.vue 里各有一条同样的注释指过来）—— 加/删/挪一项，
        三处必须成组动。
        【宽度预算】每组仍是 11px 字的两列网格 —— 那套数字是被 146px 内容宽
        顶出来的（见 .module-list 那段注释），组标题只多一行 11px 文字。
        【手风琴（2026-10-09；2026-10-10 主人批·图一改成互斥口径）】组标题升成
        按钮：点关着的组 = 开它并收起其它两组（点已开组 = 全收）—— aria-expanded
        绑态、▸ 旋转，走 store 的 toggleSolo（写口唯一）；开合动画走 .group-body
        的 grid-template-rows（禁 opacity）。组标题里的 {{ SIDEBAR.GROUP_* }}
        文本节点原样保留 —— 它是 sidebar-groups.test.ts 四段切片的分界锚。
        开合状态见脚本段 openGroups。
      -->
      <div class="side-section nav-groups">
        <!--
          学习组（2026-10-10 IA 重构）：语言格 → 阶段选择 → 课列表（知识点）
          → 阶段综合练习 → 练习/运行代码/备忘录。
          本轮之前这里只有 8 个功能格，课列表是侧栏外面第 4 个独立手风琴组 ——
          点「学习」看不到任何课、要再点一次「知识点」，主人裁定反直觉。
          课列表整块并进本组：点开「学习」一眼看全「语言 → 阶段 → 课」，
          课详情路由默认展开的也是这一组（groupOfRoute 里 lesson → learn）。
          【grow 只给这一组（2026-10-10 主人批·图一）】展开时整组吃满侧栏剩余
          高度，把课列表从「内嵌小滚轮」里放出来；复习/个人中心项少，拉伸只会
          多出一片空玻璃，不挂这个类。class="nav-group" 字面量原样保留（有闸门
          按串计数），只加动态类。
        -->
        <div class="nav-group" :class="{ grow: openGroups.learn }">
          <button
            type="button"
            class="group-title"
            :aria-expanded="openGroups.learn"
            @click="toggleGroup('learn')"
          >
            {{ SIDEBAR.GROUP_LEARN }}
            <span class="group-arrow" :class="{ open: openGroups.learn }" aria-hidden="true">▸</span>
          </button>
          <div class="group-body" :class="{ collapsed: !openGroups.learn }">
            <div class="group-body-inner">
              <!-- 语言格：通用知识 + 四门编程语言。
                   V2-34（2026-10-16）：从 div 升成真 <button> —— 键盘党 Tab
                   停得上、回车切得动（全屏菜单是替代入口，但屏内主路径不该断）。
                   默认外观重置见下面 button.module-item 那段。 -->
              <div class="module-list">
                <button
                  v-for="m in LEARN_MODULES"
                  :key="m.lang"
                  type="button"
                  class="module-item"
                  :class="{ active: route.name === 'learn' && content.activeLang === m.lang }"
                  @click="selectModule(m.lang)"
                >
                  {{ m.label }}
                </button>
              </div>

              <!--
                阶段选择：原来独立一行顶块；随 IA 重构挪进学习组内部（课列表
                是「该语言该阶段」的课，阶段与语言必须挨着看）。common 没有
                阶段概念，整块隐藏（原 v-if 原样保留）。
              -->
              <div v-if="content.activeLang !== 'common'" class="side-section">
                <div class="side-title">{{ SIDEBAR.STAGE_SELECT }}</div>
                <div class="stage-row">
                  <!-- V2-34：阶段小方块是键盘党**唯一没有替代路径**的一格
                       （全屏菜单与搜索面板都不提供阶段切换），必须真按钮。 -->
                  <button
                    v-for="s in STAGES"
                    :key="s.value"
                    type="button"
                    class="stage-chip"
                    :class="{ active: content.activeStage === s.value }"
                    data-sfx="nav"
                    @click="content.selectStage(s.value)"
                  >
                    {{ s.label }}
                  </button>
                </div>
              </div>

              <!--
                知识点（原第 4 组整块搬来，2026-10-10）：小标题 + N/M 计数 +
                课列表 + 阶段综合练习按钮。
                【小标题为什么不带折叠】它现在是学习组内的一段静态小标题，
                不再是组头 —— 计数是全侧栏唯一显示课程进度的地方，跟着学习组
                一起开合（收起学习组才跟着藏）。
                【高度从哪来（2026-10-10 主人批·图一重写）】原来这段靠
                .lesson-scroll 的 max-height 200px 内滚，主人嫌内嵌小滚轮难用 ——
                现在学习组展开时整组吃满侧栏剩余高度（.nav-group.grow 那套），
                sec-lessons 竖排 flex：小标题保持自然高，课列表 flex:1 吃满剩余、
                子项过多时才在列表内滚。类名只加在**这一处** side-section 上
                （sec-lessons），阶段选择/功能格那两节不参与高度分配。
              -->
              <div class="side-section sec-lessons">
                <div class="side-title">
                  {{ SIDEBAR.LESSONS_TITLE }}
                  <span class="side-title-right">
                    <!--
                      V2-20：这个 N/M 是**内容就绪率**（写好的课 / 本阶段全部课），
                      与学习进度无关 —— 但它光秃秃挂在「知识点」旁边，读起来
                      像「已学 N / 共 M」。补一个说明词，M 与 N 相等的阶段
                      （内容全写完时）就不会再被误读成「全学完了」。
                    -->
                    <span class="count-label">{{ SIDEBAR.LESSONS_READY }}</span>
                    <span class="count">{{ content.activeLessons.filter((l) => l.hasContent).length }}/{{ content.activeLessons.length }}</span>
                  </span>
                </div>
                <div class="lesson-scroll">
                  <div class="lesson-list">
                    <!-- V2-34：课列表整行升成 <button> —— 进课程是主路径，
                         键盘党之前只能绕搜索面板。locked/draft 行保持可聚焦：
                         点了有解释文案（openLesson 自己处理），比摸不到诚实。 -->
                    <button
                      v-for="l in content.activeLessons"
                      :key="l.id"
                      type="button"
                      class="lesson-item"
                      :class="[content.statusOf(l.id), { current: route.name === 'lesson' && route.params.id === l.id }]"
                      :title="l.title"
                      @click="openLesson(l.id)"
                    >
                      <span class="lesson-order">{{ String(l.order).padStart(2, '0') }}</span>
                      <span class="lesson-title">{{ l.title }}</span>
                      <span v-if="progress.favoriteSet.has(l.id)" class="lesson-fav">⭐</span>
                      <span class="lesson-status">{{ statusIcon(content.statusOf(l.id)) }}</span>
                    </button>
                    <div v-if="content.activeLessons.length === 0" class="empty-hint">{{ SIDEBAR.NO_LESSON }}</div>
                  </div>

                  <!--
                    阶段末尾那颗「综合练习」（2026-10-01 新入口）。
                    【为什么在这儿】主人原话是「入口做在左侧课程列表对应章节末尾」——
                    列表里就是当前阶段那几节课，走到底正好是"该给这一阶段收个尾"的位置。
                    它挂在 .lesson-scroll 的滚动区里：跟着列表一起滚，
                    不动上面几块的高度账。
                    【未解锁为什么也显示】灰按钮上那句「还差 N 课」本身就是"接下来干什么"；
                    藏起来的话，学员根本不知道这一阶段还有这么一个去处。
                    【空阶段不显示】total 是 0 时 stageProgress 就是 null（见脚本里的算式）。
                  -->
                  <div v-if="stageProgress" class="stage-go-wrap">
                    <MiButton
                      size="sm"
                      variant="secondary"
                      :disabled="!stageProgress.done"
                      @click="openStagePaper"
                    >
                      {{ stageProgress.done ? PAPER.STAGE_GO : PAPER.missing(stageProgress.missing) }}
                    </MiButton>
                  </div>
                </div>
              </div>

              <!-- 练习 / 运行代码 / 备忘录三个功能格：排在学习组末尾（课列表之后）。
                   V2-34：三格全部从 div 升成真 <button>。 -->
              <div class="side-section">
                <div class="module-list">
                  <button type="button" class="module-item func" :class="{ active: route.name === 'practice' }" @click="router.push('/practice')">
                    {{ NAV.PRACTICE }}
                  </button>
                  <button type="button" class="module-item func" :class="{ active: route.name === 'playground' }" @click="router.push('/playground')">
                    {{ NAV.PLAYGROUND }}
                  </button>
                  <!--
                    备忘录（P3 ②）挪进「学习」组、排在运行代码后：它和收藏/仓库那种
                    「我自己攒下来的」不是一类，而是「学的时候顺手记」的随身本。
                    ⚠️ rail 那列与菜单宫格里也有同一格 —— 三面刻意一一对应。
                  -->
                  <button type="button" class="module-item func" :class="{ active: route.name === 'memo' }" @click="router.push('/memo')">
                    {{ NAV.MEMO }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 复习与挑战：每日复习（开关关 = 入口消失）→ 每日挑战 → 收藏 → 仓库 -->
        <div class="nav-group">
          <button
            type="button"
            class="group-title"
            :aria-expanded="openGroups.review"
            @click="toggleGroup('review')"
          >
            {{ SIDEBAR.GROUP_REVIEW }}
            <span class="group-arrow" :class="{ open: openGroups.review }" aria-hidden="true">▸</span>
          </button>
          <div class="group-body" :class="{ collapsed: !openGroups.review }">
            <div class="group-body-inner">
              <div class="module-list">
                <!--
                  每日复习的入口跟着设置里的开关走（学习闭环 §7：那个开关的文案已从
                  「复习提醒」换成「每日复习」，现在是这个功能的总开关）。
                  关掉 = 全应用入口一起消失，而不是留一个"点进去才知道被关了"的按钮
                  （rail 与菜单宫格同一判据）。
                -->
                <button
                  v-if="settings.config.reviewEnabled"
                  type="button"
                  class="module-item func"
                  :class="{ active: route.name === 'review' }"
                  @click="router.push('/review')"
                >
                  {{ NAV.REVIEW }}
                </button>
                <!--
                  每日挑战排在收藏之前：它是首页主推的入口，和「复习」同属"系统给我出的"。
                  ⚠️ 收藏（**题目的**收藏）与侧栏课程列表里那个 ⭐（.lesson-fav）是
                  课级收藏，两者同名不同义、不合并（见 types.ts 的 FavoriteItem）。
                -->
                <button type="button" class="module-item func" :class="{ active: route.name === 'challenge' }" @click="router.push('/challenge')">
                  {{ NAV.CHALLENGE }}
                </button>
                <button type="button" class="module-item func" :class="{ active: route.name === 'favorites' }" @click="router.push('/favorites')">
                  {{ NAV.FAVORITES }}
                </button>
                <!-- 仓库（P3 ⑨）紧挨收藏：都是「我自己攒下来的」（收藏攒题、仓库攒奖励图） -->
                <button type="button" class="module-item func" :class="{ active: route.name === 'warehouse' }" @click="router.push('/warehouse')">
                  {{ NAV.WAREHOUSE }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 个人中心：总览（未签带圆点）→ 排行榜 → 登录（签到并入总览，2026-10-09） -->
        <div class="nav-group">
          <button
            type="button"
            class="group-title"
            :aria-expanded="openGroups.me"
            @click="toggleGroup('me')"
          >
            {{ SIDEBAR.GROUP_ME }}
            <span class="group-arrow" :class="{ open: openGroups.me }" aria-hidden="true">▸</span>
          </button>
          <div class="group-body" :class="{ collapsed: !openGroups.me }">
            <div class="group-body-inner">
              <div class="module-list">
                <!--
                  总览（2026-10-09 模块三：原独立「每日签到」格并入这里）。
                  点它 = 去总览页；未签到时那边自己会滚到签到卡 + 闪一下 +
                  把焦点给签到按钮（OverviewView.guideToCheckin），所以落点是
                  **plain /overview**，不再带 ?card=（?card= 直达机制保留给
                  显式深链，两条不叠加）。未签时右上角亮 6px 圆点，
                  签过不显示（数据口径见脚本段 showCheckinDot）。
                  【为什么是 <button>】与旁边登录/排行榜同规矩：键盘党 Tab 停得上
                  （div 版功能格从出生就摸不到）。
                -->
                <button
                  type="button"
                  class="module-item func"
                  :class="{ active: route.name === 'overview' }"
                  @click="router.push('/overview')"
                >
                  {{ NAV.OVERVIEW }}
                  <span v-if="showCheckinDot" class="checkin-dot" aria-hidden="true"></span>
                </button>
                <button class="module-item func" :class="{ active: route.name === 'leaderboard' }" @click="router.push('/leaderboard')">
                  {{ NAV.LEADERBOARD }}
                </button>
                <!--
                  登录 / 排行榜（⑤ 十项升级，2026-10-08）。
                  【为什么是 <button> 不是 <div>】旁边那些功能格是 div + click，
                  鼠标能用、键盘党摸不到。新加的这几格从出生就当按钮做：Tab 停得上、
                  回车点得动（焦点环见下面 CSS）。代价是 <button> 自带一圈浏览器
                  默认外观，得整套拆掉（button.module-item 那段）——拆不干净它俩
                  会以灰底描边方块的样子混进旁边一圈 div 格子里，一眼露馅。
                -->
                <button class="module-item func" :class="{ active: route.name === 'login' }" @click="router.push('/login')">
                  {{ NAV.LOGIN }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!--
        底部工具区（§1.3）：一行两钮 —— [九点阵 菜单] [⚙ 设置]（设置留在原位，
        不设组标题）。菜单钮开的是 App.vue 的全屏菜单（emit 上去置 menuOpen）。
        九点阵图标是**内联 SVG**（9 个小圆，currentColor），不是 ⊞/田 字符 ——
        字符在不同机器上会落进不同的 emoji/符号字形，还不跟主题色走。
      -->
      <div class="side-footer">
        <button
          type="button"
          class="footer-btn"
          :title="SIDEBAR.MENU_BTN_TITLE"
          @click="emit('open-menu')"
        >
          <svg class="grid-icon" viewBox="0 0 18 18" aria-hidden="true">
            <circle cx="3" cy="3" r="1.6" />
            <circle cx="9" cy="3" r="1.6" />
            <circle cx="15" cy="3" r="1.6" />
            <circle cx="3" cy="9" r="1.6" />
            <circle cx="9" cy="9" r="1.6" />
            <circle cx="15" cy="9" r="1.6" />
            <circle cx="3" cy="15" r="1.6" />
            <circle cx="9" cy="15" r="1.6" />
            <circle cx="15" cy="15" r="1.6" />
          </svg>
          {{ SIDEBAR.MENU_BTN }}
        </button>
        <button
          type="button"
          class="footer-btn"
          :class="{ active: route.name === 'settings' }"
          @click="router.push('/settings')"
        >
          {{ NAV.SETTINGS }}
        </button>
      </div>
    </template>

    <!-- 确认框（Teleport 到 body，摆在这儿只是随它的调用点） -->
    <StagePaperDialog v-model:visible="paperOpen" :draft="pendingPaper" @start="startPaper" />

    <!-- 退出登录的二次确认（V2-12，同样是 Teleport 到 body 的浮层） -->
    <MiModal v-model:visible="logoutConfirmVisible" :title="ACCOUNT.BTN_LOGOUT">
      <p class="logout-confirm-body">{{ ACCOUNT.LOGOUT_CONFIRM }}</p>
      <template #footer>
        <MiButton variant="secondary" @click="logoutConfirmVisible = false">
          {{ ACCOUNT.LOGOUT_CANCEL }}
        </MiButton>
        <MiButton variant="danger" @click="confirmLogoutFromMenu">
          {{ ACCOUNT.BTN_LOGOUT }}
        </MiButton>
      </template>
    </MiModal>
  </aside>
</template>

<style scoped>
.sidebar {
  /* 宽度和右边那条分割线都不在这儿了：宽度归 splitpanes 的 pane 管（可拖拽），
     分割线归分隔条自己画。这里只要把高度铺满 pane 就行。 */
  height: 100%;
  display: flex;
  flex-direction: column;
  /* 12 → 10px：给内容区多让出 4px 宽、4px 高。宽度是给下面两列网格的
     （见 .module-item 那段 —— 那三个四字标签就差几个像素），
     高度是给课程列表的。10px 贴着分割条已经足够，再窄就发挤了。 */
  padding: 10px;
  /* glass 令牌：壁纸关时 = --mi-card 逐字节相同；壁纸开时按 --mi-panel-alpha 稀释。
     这条是「左栏挡死壁纸」的修复 —— 只动这一行底，字一概不动（硬底线）。 */
  background: var(--mi-card-glass);
  /*
   * 【兜底用的，正常情况下不该出现滚动条】
   * 下面 `aside` 里每块的高度都是「内容撑出来的」，加起来有可能超过窗口
   * （窗口最小高度是 700，比这里所有块加起来还矮）。没有这一条的话，
   * 塞不下的内容会被 `.splitpanes__pane` 的 `overflow: hidden` 直接**切掉** ——
   * 而且是**悄悄**切掉：不报错、不出现滚动条、用户只会觉得「怎么少了一块」。
   * 这正是「左栏课程列表整个消失」那次的成因。宁可多一条滚动条，也不能丢内容。
   */
  overflow-y: auto;
  /* 同 `.content` 与 `.lesson-scroll`：只写 overflow-y 的话横向会被算成 auto，
     下面 `.lesson-item:hover` 那 2px 位移就会闪出横向滚动条 */
  overflow-x: hidden;
}

/*
 * 身份区（§1.2）。替代旧 .logo（🐱 + 立绘 + 品牌语那一整块 —— 已收掉，
 * 理由见模板段）。.identity 是裸 <button>：头像 + 昵称/未登录。
 * 全套重置（边框/底色/字体）与 .rail-item / button.module-item 同一套理由：
 * 不重置的话 Windows 上 Chrome 会给系统字体和 13.33px 字号，和旁边对不齐。
 * 外层 .identity-wrap 只为下拉菜单提供定位锚（菜单撑出按钮外，不能挂在按钮里）。
 */
.identity-wrap {
  position: relative;
}
.identity {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 4px 6px 6px;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 13px;
  color: var(--mi-text);
  text-align: left;
  border-radius: var(--mi-radius-sm);
  cursor: var(--mi-cursor, pointer);
  transition: background var(--mi-dur-fast) var(--mi-ease);
}
.identity:hover {
  background: var(--mi-blue-light);
}
.identity:focus-visible {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 2px;
}

/*
 * 身份区下拉菜单（2026-10-13 主人令：退出登录要有醒目入口）。
 * 实色 --mi-card 面板 + 阴影浮在侧栏内容上（不用玻璃令牌 —— 玻璃计数是
 * wall-glass.test.ts 的快照件，且这枚小面板要随时读得清，同 .back-chip 一条理由）。
 * z-index 30：压过状态块与课程列表，但低过全屏菜单/遮罩那几层。
 */
.identity-menu {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  z-index: 30;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--mi-card);
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  box-shadow: var(--mi-shadow);
}
/* 菜单项：与 .identity 同一套重置（裸 button 在 Windows Chrome 上的系统字体问题） */
.identity-menu-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  margin: 0;
  padding: 6px 8px;
  border: none;
  background: transparent;
  font-family: inherit;
  color: var(--mi-text);
  text-align: left;
  border-radius: var(--mi-radius-sm);
  cursor: var(--mi-cursor, pointer);
  transition: background var(--mi-dur-fast) var(--mi-ease);
}
.identity-menu-item:hover {
  background: var(--mi-blue-light);
}
.identity-menu-item:focus-visible {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: -2px;
}
.identity-menu-item:disabled {
  color: var(--mi-text-3);
  cursor: default;
  background: transparent;
}
.identity-menu-main {
  font-size: 13px;
  font-weight: 600;
}
.identity-menu-sub {
  font-size: 11.5px;
  color: var(--mi-text-3);
}
/* 退出登录：危险色写全（主人令里的「醒目」）——悬停底色用 --mi-error-fill 顶出来 */
.identity-menu-logout .identity-menu-main {
  color: var(--mi-error-deep);
}
.identity-menu-logout:hover {
  background: var(--mi-error-fill);
}
.identity-menu-logout:disabled .identity-menu-main {
  color: var(--mi-text-3);
}
/* 退出确认框的正文（V2-12）：普通段落尺寸，说明退出的后果与保留的东西 */
.logout-confirm-body {
  font-size: 13px;
  color: var(--mi-text-2);
  line-height: 1.8;
}
/*
 * 头像圆（32px，整宽态；rail 态换 .avatar-sm 28px）。
 * overflow:hidden + border-radius:50% 把立绘画像统一裁成圆。
 * （P10.6 起头像只有 MiMascot 一条通道；P10.7 云头像回来时补回
 * `img` 那条 —— object-fit:cover 居中填满不拉伸，与老写法一致。）
 */
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 50%;
  overflow: hidden;
}
.avatar-sm {
  width: 28px;
  height: 28px;
}
.identity-name {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  /* 用户名最长 30 字（服务端 2026-10-13 放宽：2~30 位中英文/数字/下划线）：
     放不下宁可省略号，不换行把块撑高 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/*
 * 状态块（§1.5）：进度环 56px + 右侧两枚徽记并排。原来是上下两行
 * （.progress-row + .affection-row），合成一块省一行高度 —— 环心里本来就画着
 * 百分比，外面那行「学习总进度」收进 title（悬停/读屏仍拿得到全名）。
 * 环形与 padding 跟旧 .progress-row 对齐（左右 6px），视线带位置不变。
 */
.status-block {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 6px 4px;
}
/* 徽记组（❤ 好感度 / 🍚 饱腹度 / 脸色，V1-47）：窄栏放不下就换行，不挤成省略号 */
.status-meters {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 8px;
  min-width: 0;
  font-size: 12px;
}
.meter {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
/*
 * button 版 .meter（2026-10-09 状态规则透明化）：裸 <button> 全套重置
 * （同 button.module-item / .rail-item 的账）—— 不重置的话 Windows 上
 * Chrome 会给 'Segoe UI' + 13.33px，和环旁边的排版对不齐。
 * 悬停反馈只用 --mi-blue-light 底、焦点环只用 --mi-blue-deep —— 禁 opacity、
 * 禁玻璃令牌（wall-glass 快照件：全库 opacity 声明数与玻璃令牌处数都是钉死的）。
 * padding / margin 一正一负：底色药丸有呼吸位，外层换行排布的间距分毫不动。
 */
button.meter {
  margin: -1px -3px;
  padding: 1px 3px;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  color: inherit;
  cursor: var(--mi-cursor, pointer);
  border-radius: var(--mi-radius-sm);
  transition: background var(--mi-dur-fast) var(--mi-ease);
}
button.meter:hover {
  background: var(--mi-blue-light);
}
button.meter:focus-visible {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 2px;
}
.meter-icon {
  font-size: 11px;
}
.meter-heart {
  color: var(--mi-error-deep);
}
/*
 * 百分比用主题感知的 ink/deep 档令牌（对比度 ≥4.5），浅深主题各自翻极性 ——
 * 这套五档配色（aff-*）原本挂在 .affection-num 上，随状态块改造移到 .meter-num，
 * 档名一字未动（AFFECTION.TIERS 与 affectionTierClass 是同一份）。
 */
.meter-num {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--mi-text-3);
}
.meter-num.aff-cold {
  color: var(--mi-text-3);
}
.meter-num.aff-familiar {
  color: var(--mi-blue-ink);
}
.meter-num.aff-close {
  color: var(--mi-success-deep);
}
.meter-num.aff-like {
  color: var(--mi-warn-deep);
}
.meter-num.aff-love {
  color: var(--mi-error-deep);
}
/* 脸色徽记（V1-47）的三种强调色 —— 判定与理由见脚本段 faceTextClass */
.meter-num.face-hungry {
  color: var(--mi-error-deep);
}
.meter-num.face-sleepy {
  color: var(--mi-text-3);
}
.meter-num.face-mood {
  color: var(--mi-warn-deep);
}

.side-section {
  margin-top: 10px;
}
/*
 * 课列表的滚动区（2026-10-10 主人批·图一重写；旧口径「只吃 200px」已废）。
 *
 * 【前身两代】最初它是顶层 .side-section.grow，靠 flex:1 + min-height: 200px
 * 从整个侧栏的剩余高度里拿高；IA 重构把它并进学习组后一度改成
 * **max-height: 200px 内滚** —— 主人看到的是一颗内嵌小滚轮。现在两条旧口径
 * 都不用：高度由 flex 链驱动（.nav-group.grow → .group-body-inner →
 * .sec-lessons，账在 .nav-group 那一段），本容器 flex:1 占满学习组的剩余
 * 高度，子项过多时**在这里**内滚；课少时也照样吃满（列表顶对齐、下方留白），
 * 不再是「列表只有几行高、滚轮贴着走」。
 *
 * 【min-height: 96px 是兜底】极端矮窗口下这条 flex 链会被层层压 —— 约 3 行
 * 是「还能当列表用」的下限，宁可让 .sidebar 的兜底滚动接手，也不把它挤没
 * （「左栏课程列表整个消失」那次的教训，见 .sidebar 那段）。
 *
 * overflow-x: hidden 同 `.sidebar` 那一账：只写 overflow-y 的话横向会被算成
 * auto，下面 `.lesson-item:hover` 那 2px 位移就成了「内容比容器宽」——
 * 鼠标每划过一行，底边就闪一下横向滚动条。
 */
.lesson-scroll {
  flex: 1;
  min-height: 96px;
  overflow-y: auto;
  overflow-x: hidden;
}
/*
 * 小标题行（阶段选择 / 知识点）：12px 静态副标题，右端顶 count。
 * 【2026-10-10 IA 重构】手风琴轮给它升的整套 <button> 重置随「知识点组
 * 撤销」拆掉 —— 两处用法（阶段选择、知识点小标题）现在都是纯文字、不可点：
 * cursor / hover / 焦点环会假装可点。开合只属于组头（.group-title）。
 */
.side-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--mi-text-3);
  padding: 0 6px 6px;
}
/* count 顶到右端（文字头仍在左） */
.side-title-right {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.count {
  font-size: 11px;
}
/* N/M 前的说明词（V2-20）：比数字更弱一档，不抢读 */
.count-label {
  font-size: 11px;
  color: var(--mi-text-3);
  margin-right: 3px;
}

.stage-row {
  display: flex;
  gap: 6px;
  padding: 0 6px;
}
.stage-chip {
  flex: 1;
  text-align: center;
  padding: 5px 0;
  font-size: 12px;
  border-radius: var(--mi-radius-sm);
  background: var(--mi-bg);
  color: var(--mi-text-2);
  cursor: var(--mi-cursor, pointer);
  /*
   * 批⑥（2026-10-16）：原先 `transition: all .15s ease`。会变的是底与字色；
   * font-weight 同 MiTabs —— 不入列，激活时直接落位（重量渐变会一直抖字宽）。
   */
  transition:
    background var(--mi-dur-fast) var(--mi-ease),
    color var(--mi-dur-fast) var(--mi-ease);
}
.stage-chip:hover {
  background: var(--mi-blue-light);
}
.stage-chip.active {
  background: var(--mi-blue);
  color: var(--mi-text);
  font-weight: 600;
}

/*
 * 【为什么改成两列】这里 10 项、每项 33px，一共 391px —— 是左栏里最大的一块。
 * 而「课程列表被挤没」总共只缺 42px，光靠压内边距（33→27px，省 60px）不仅够，
 * 还能富余；但那样只解决「今天」，明天再加一个入口就又不够了。
 * 改两列是把它从「随入口数线性增长」变成「按行增长」，一次把余量做厚。
 *
 * ── 列宽是怎么定下来的（数字全是实测，不是算的）────────────────────────
 *
 * 这张预算表是照左栏 14% = 166px 推的 —— 它是改造前的拖拽下限，也是这套
 * 数字当年级别最窄的落点。2026-10-04 起拖拽下限放到 0、≤10% 松手即折叠
 * （见 shared/layout.ts 的折叠三常量），「比 14% 还窄但开着」因此可达，
 * 那几档里这格标签会开始挤 —— 那是用户主动拖窄的选择，14% 仍是基准线。
 *
 * 166px 减去左右各 10px 内边距 = 146px 内容宽，减去 4px 中缝，两列各 71px。
 * 再减掉 .module-item 自己的横向内边距 2px×2，每个标签拿到 67px。
 *
 * 而三条四字标签（📚 通用知识 / 🎯 每日挑战 / ▶️ 运行代码）是这一格的
 * **实际约束**：12px 字号下要 68px（emoji 比汉字还宽），**放不下**；
 * 11px 字号下要 62.4px，**剩 4.6px 余量**。
 *
 * 【所以字号只能是 11px，这是被宽度顶出来的，不是随手挑的】
 * 试过的其它走法都不成立，记在这儿省得下次再试一遍：
 *   · 12px + 加宽到 aside 8px 内边距 → 仍差 1px
 *   · 12px + 缝 0 + 内边距 0        → 仍差 1px
 *   · 12px + 字母缝 -4px            → 仍差 5px（emoji 不跟着字距缩）
 *   · 单列整行                       → 放得下，但模块列表长到 ~280px，
 *                                     挤到课程列表只剩 117px，破主人的 200px 底线
 * 当时的备选是**把拖拽下限从 14 抬到 16**（166→190px，12px 字就有 11px 余量），
 * 没这么做是因为那会动主人已经拖好的布局 —— 一升级就被强行推宽 24px。
 * 2026-10-04 折叠机制把「栏太窄」的正确出路改成了折叠（松手即收），
 * 「抬下限」这条备选就此作废。哪天觉得 11px 小了，能动的是宽度预算
 * （先读 shared/layout.ts 的折叠三常量），不是在这里硬抠字号。
 *
 * 【横向内边距为什么只有 2px —— 它不是「留白」，是纯预算旋钮】
 * 文字是 text-align: center + nowrap，底色块（悬浮/选中态）本来就占满整格，
 * 所以这 2px 对观感零影响，唯一的用途是从文字手里扣宽度。既然它是成本，就压到最小。
 */
.module-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.module-item {
  /* 签到圆点（.checkin-dot）的定位参照 */
  position: relative;
  padding: 5px 2px;
  border-radius: var(--mi-radius-sm);
  font-size: 11px;
  color: var(--mi-text-2);
  cursor: var(--mi-cursor, pointer);
  text-align: center;
  /* 万一将来模块名变长：宁可省略号，也不要换行把某一格撑成两行
     —— 一格变高整行都变高，网格的节奏就乱了 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background var(--mi-dur-fast) var(--mi-ease);
}
.module-item:hover {
  background: var(--mi-blue-light);
}
.module-item.active {
  background: var(--mi-blue);
  color: var(--mi-text);
  font-weight: 600;
}
.module-item.func {
  color: var(--mi-text-2);
}

/*
 * button 版 .module-item（登录/排行榜，⑤）。
 * <button> 出场自带四样默认外观 —— 边框、灰底、字体、字号 —— 这里把前三样
 * 拆干净；字号/配色/圆角/内边距全部复用上面 .module-item 那一套（同一个
 * 宽度预算，见 540 行那段注释）。漏掉 font-family 的话这两格会用系统 UI 字体，
 * 和旁边格子差一个字形，属于「说不上哪里怪」的那种坏。
 */
button.module-item {
  border: none;
  background: transparent;
  font-family: inherit;
  margin: 0;
}
/* 键盘焦点环：与左栏 rail 同一套约定（2px 笔画色、offset 2px）。
   div 版功能格没有这条（它们压根不可聚焦）—— 这是按钮版多出来的好处。 */
button.module-item:focus-visible {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 2px;
}

/*
 * button 版 .stage-chip / .lesson-item（V2-34，2026-10-16 全量转按钮）。
 * 与 button.module-item 同款重置：<button> 出场自带四样默认外观（边框/灰底/
 * 字体/行高），拆不干净会一眼露馅。逐项：
 *   · border/background —— .stage-chip 自己的底靠类压过 UA；.lesson-item
 *     没写底，必须在这里给 transparent，否则是 UA 的灰底。
 *   · font-family —— 类里没写，不 inherit 会用系统 UI 字体，和旁边格子差一个字形。
 *   · line-height —— 这条最容易漏：UA 的 font 简写把行高打回 normal，而换算前
 *     的 div/span 是继承父级行高的。inherit 把它恢复成"转按钮前那一刻的计算值"，
 *     转换因此逐像素无视觉变化。字号/配色/圆角/内边距继续走类上原样那套。
 */
button.stage-chip {
  border: none;
  font-family: inherit;
  line-height: inherit;
  margin: 0;
}
button.lesson-item {
  border: none;
  background: transparent;
  font-family: inherit;
  line-height: inherit;
  margin: 0;
}
/* 同款焦点环（offset 用 0：课列表行与行只隔 2px，2px 环会糊到邻行上） */
button.stage-chip:focus-visible,
button.lesson-item:focus-visible {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 0;
}

/*
 * 四分组（§1.1）：三组各自「小标题 + 两列网格」，组间距 14px；
 * 「设置」不设组标题，留在 .side-footer。分组只是把原来那一个长网格
 * 切成三段，格子尺寸/字号/两列预算一概没动（见上面 .module-list 的账）。
 *
 * 【flex: 1 的来账（2026-10-10 主人批·图一）】这一节吃满侧栏剩余高度，
 * 学习组（.nav-group.grow）才有可分配的 flex 空间把课列表托起来 ——
 * 高度账全在下面 .nav-group.grow 那一段。min-height: 0 是 flex 收缩的通行证：
 * 极端窗口塞不下时允许这一节被压小（再由 .sidebar 的兜底滚动接住），
 * 不然它会撑着内容高，把 .side-footer 顶出可视区。
 */
.nav-groups {
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
  min-height: 0;
}
.group-title {
  /* 组标题不进 .mi-* 组件体系：11px 是契约钉死的一档。
     颜色 2026-10-10（主人批·图一「学习组标题对比度很低」）从 --mi-text-3
     升到 --mi-text-2：text-3（最淡档）在玻璃底 + 壁纸稀释下会掉到
     可读线以下；这是折叠头、是导航，不是装饰性说明文字，用次强档。
     hover 相应从 text-2 升到 --mi-text（保持原有的「悬停再深一档」手感）。 */
  /* 2026-10-09 手风琴：从 div 升成裸 <button> —— 全套默认外观重置
     （同 button.meter / button.module-item 的账），整行铺满当折叠头，
     ▸ 箭头靠 space-between 顶到右端。 */
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  margin: 0;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 11px;
  color: var(--mi-text-2);
  padding: 0 6px 4px;
  cursor: var(--mi-cursor, pointer);
  text-align: left;
}
.group-title:hover {
  color: var(--mi-text);
}
button.group-title:focus-visible {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 2px;
}

/*
 * 手风琴的组体与箭头（2026-10-09「侧边栏 UI 收纳」）。
 * 【开合动画为什么是 grid-template-rows 0fr↔1fr】display:none 杀过渡
 * （MiCollapse / 属性面板的 v-show 就是这么废掉的）；height:auto 不可过渡；
 * opacity 被 wall-glass 快照钉死（全库 46 处，一个都不许新增）—— 0fr/1fr
 * 是剩下那条路。时长用 --mi-dur（tokens.css 该行注释就写着「展开」= 180ms），
 * reduced-motion 由 motion.css 全局总闸自动盖，组件不写第二份。
 * 【内层的 padding 4px + margin -4px】给模块格的焦点环（outline 2px +
 * offset 2px = 4px）留出不被 overflow 裁掉的余地；box-sizing: border-box
 * 保证收起时这圈 padding 不撑出残高。
 * 【visibility 延迟切换】收起后组体仍在 DOM 里 —— invisible 的按钮不许再
 * 被 Tab 摸到；延迟 --mi-dur 是为了收起动画那 180ms 里内容还看得见。
 */
.group-body {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows var(--mi-dur) var(--mi-ease);
}
.group-body.collapsed {
  grid-template-rows: 0fr;
}
.group-body-inner {
  overflow: hidden;
  min-height: 0;
  box-sizing: border-box;
  margin: -4px;
  padding: 4px;
  visibility: visible;
  transition: visibility 0s linear 0s;
  /* 2026-10-10 主人批·图一：组体内改竖排 flex —— 学习组展开时，
     课列表那一节（.sec-lessons）才能 flex:1 吃到组体剩下的高度。
     其余两组内容照旧自然高（没有 flex:1 的子项，排布与 block 无差）。 */
  display: flex;
  flex-direction: column;
}
.group-body.collapsed .group-body-inner {
  visibility: hidden;
  transition-delay: var(--mi-dur);
}
.group-arrow {
  font-size: 9px;
  line-height: 1;
  transition: transform var(--mi-dur-fast) var(--mi-ease);
}
.group-arrow.open {
  transform: rotate(90deg);
}

/*
 * 学习组吃满剩余高度（2026-10-10 主人批·图一）。
 *
 * 【要解决什么】IA 重构把课列表并进学习组后，它退回「max-height: 200px 内滚」
 * ——主人看到的是一颗内嵌小滚轮。现在把高度还给它：学习组展开时整组吃满
 * .nav-groups 里的剩余高，课列表（.lesson-scroll）跟着吃满组内剩余高，
 * 只有课多到装不下时，滚动才发生在列表自己身上。
 *
 * 【高度链（从外到内，缺一环整条不成立）】
 *   .sidebar（flex 列，height:100%）
 *   └ .nav-groups           flex:1;min-height:0   ← 上述那条规则
 *     └ .nav-group (grow)   flex:1;min-height:0   ← 只挂学习组
 *       └ .group-body       flex:1;min-height:0（grid 行 1fr 撑满它）
 *         └ .group-body-inner  display:flex 竖排（上面那条规则）
 *           └ .sec-lessons     flex:1;min-height:0;display:flex 竖排
 *             └ .lesson-scroll flex:1（小标题保持自然高）
 *
 * 【为什么是一堆 min-height: 0】竖排 flex 的项默认 min-height:auto（= 内容高），
 * 内容一多整条链就拒绝收缩、被矮窗口顶爆 —— 每一环都要显式放行收缩。
 * 【grow 为什么只给学习组】复习/个人中心项少，拉长只会多出一片空玻璃。
 * 【收起瞬间为什么允许一跳】grow 类跟 openGroups.learn 走，点收起时它同帧
 * 撤掉、可分配高度瞬间归零，而 grid-template-rows 的 0fr 过渡还在走 ——
 * 有一帧轻微跳变，接受（换成延迟撤类会把「谁在吃高度」讲乱）。
 */
.nav-group {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.nav-group.grow {
  flex: 1;
  min-height: 0;
}
.nav-group.grow .group-body {
  flex: 1;
  min-height: 0;
}
.nav-group.grow .sec-lessons {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/*
 * 未签圆点（§1.4）：条目**右上角** 6px 实心点（2026-10-09 模块三：签到入口
 * 并入「总览」后，按主人原话「总览图标右上角加醒目红点 Badge」从右端居中
 * 挪到右上角），签过就整个不渲染（v-if 在模板上）。
 * ⚠️ 契约写的是 `--mi-accent`，但全库（tokens.css 与任何组件）**没有**这个
 * 令牌，本轮又不许动令牌文件 —— 就近取 `--mi-error-deep`：它是「当字/描边用」
 * 的深档红，深浅两主题下都过 3:1 非文本对比，是现有信号色里最抓眼的一枚。
 * right:3px 沿用格子横向内边距(2px)+1px 呼吸缝的老账；top:2px 同理贴住上缘。
 */
.checkin-dot {
  position: absolute;
  right: 3px;
  top: 2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mi-error-deep);
}

.lesson-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 2px;
}
.lesson-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--mi-radius-sm);
  font-size: 12px;
  color: var(--mi-text-2);
  cursor: var(--mi-cursor, pointer);
  transition:
    background var(--mi-dur-fast) var(--mi-ease),
    transform var(--mi-dur-fast) var(--mi-ease);
}
.lesson-item:hover {
  background: var(--mi-blue-light);
}
/*
 * 悬浮时往右挪 2px —— 「这一行在回应你」。
 * **只挪 2px**：导航条目挤得密，挪多了整列会像果冻一样抖。
 * `:not(.locked)` 不是洁癖：锁着的条目鼠标指针是「禁止」，还让它动就自相矛盾了。
 */
.lesson-item:not(.locked):hover {
  transform: translateX(2px);
}
/* 用深档：这是**课名文字**，压在侧栏上必须读得清。
   浅档 #7ed9a0 在这里只有 1.67 —— 主人点名要修的就是这一条。 */
.lesson-item.learned {
  color: var(--mi-success-deep);
}
.lesson-item.current {
  background: var(--mi-blue);
  font-weight: 600;
}
/*
 * 当前这一行的底是 --mi-blue(#b3d9ff)，**比软件里别的底都暗一大截**
 * （亮度 0.66，而画布 0.88、纸面 0.98）——
 * 于是压在它上面的课号（--mi-text-3）掉到 3.53，绿色的已学会课名也只剩 3.53。
 * 这是在真窗口里扫出来的：文件里按纸面/画布算了半天，全绿，一上真机就露馅。
 *
 * 【为什么是「换色」而不是「把蓝底调浅」】
 * 蓝底是主人刚验收过的选中态（「猫窝浅蓝看着非常舒服」），为一个数字去动它不划算。
 * 而这一行**本来就已经被高亮出来了**，状态色（绿=已学会）在这儿本来就是多余的强调 ——
 * 状态另有那个 📖/💬 图标在说。所以当前行统一走正文色系，靠图标区分状态。
 *
 * ⚠️ 选择器要写全：`.lesson-item.learned` 和 `.lesson-item.current` 是**同权重**(0,2,0)，
 * 光靠源码顺序压不住（以后谁把这两条挪个位置就失效了）。写 `.current.learned` 才是真的压住。
 */
.lesson-item.current,
.lesson-item.current.learned,
.lesson-item.current.open,
.lesson-item.current.draft {
  color: var(--mi-text);
}
.lesson-item.current .lesson-order {
  color: var(--mi-text-2);
}
.lesson-item.locked {
  /* 2026-10-10 对比度修复：原来用 opacity: 0.6 压暗，实测锁定课标题对比度只有 2.73
     （低于 4.5 硬线）——不透明度是整行连文字一起变淡，正好撞在硬底线上。
     改用与 .draft 同一枚次级文字色**直接换色**：视觉上同样是「未解锁的灰」，
     但颜色本身就是为可读性选的。 */
  color: var(--mi-text-3);
  cursor: not-allowed;
}
.lesson-item.draft {
  color: var(--mi-text-3);
  cursor: default;
}
.lesson-item.open {
  color: var(--mi-text);
}
.lesson-order {
  flex-shrink: 0;
  font-family: var(--mi-code);
  font-size: 11px;
  color: var(--mi-text-3);
}
.lesson-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lesson-fav {
  flex-shrink: 0;
  font-size: 11px;
}
.lesson-status {
  flex-shrink: 0;
  font-size: 11px;
}
/*
 * 空壳课的气泡压成灰的。
 * emoji 自带颜色、不跟设计令牌走，所以只能整体去色 + 降透明度 ——
 * 而这一压正是它和 📖（写好的课）在余光里的区别：**灰的是死的，亮的是能点的**。
 * 留在 `.draft` 底下而不是 `.lesson-status` 上，是为了不误伤 ✓ 和 🔒。
 */
.lesson-item.draft .lesson-status {
  filter: grayscale(1);
  opacity: 0.45;
}

.empty-hint {
  padding: 12px 8px;
  font-size: 12px;
  color: var(--mi-text-3);
  text-align: center;
}

/*
 * 阶段末尾那颗「综合练习」（2026-10-01）。
 * 撑满整列宽：侧栏最窄时内容区只有 146px，按钮跟列走比按内容宽更整齐，
 * 也和上面一行行的课程条目对齐。
 */
.stage-go-wrap {
  padding: 8px 2px 2px;
}
.stage-go-wrap :deep(.mi-btn) {
  width: 100%;
}

/*
 * 底部工具区（§1.3）：一行两钮，各占一半（flex:1）。选中态从旧容器的
 * .side-footer.active 挪到设置钮自己（.footer-btn.active）—— 现在这一行里
 * 只有设置是一个"页面"，菜单钮是动作、不该有选中态。
 * 【margin-top 为什么还是 auto（2026-10-10 主人批·图一更新）】页脚钉在侧栏
 * 列底 —— 这份活现在归 .nav-groups 的 flex:1（它吸满剩余空间，页脚自然落底）；
 * flex:1 在场时这条 auto 拿到的是 0、吸不到东西，留着当二道防线（哪天
 * .nav-groups 不再吃满，页脚仍落底）。塞不下时它同样退化成 0，由 padding-top
 * 保住 10px 的最小间隔，再多的内容交给 .sidebar 的兜底滚动（页脚仍可见可点）。
 */
.side-footer {
  display: flex;
  gap: 6px;
  margin-top: auto;
  padding-top: 10px;
}
.footer-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 0;
  padding: 8px 0;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 12px;
  color: var(--mi-text-2);
  border-radius: var(--mi-radius-sm);
  cursor: var(--mi-cursor, pointer);
  transition: background var(--mi-dur-fast) var(--mi-ease);
}
.footer-btn:hover {
  background: var(--mi-blue-light);
}
.footer-btn.active {
  background: var(--mi-blue);
  color: var(--mi-text);
  font-weight: 600;
}
.footer-btn:focus-visible {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 2px;
}

/*
 * 九点阵图标（§1.3）：内联 SVG，9 个小圆共用 currentColor（跟文字色走），
 * 不写 width/height 时 SVG 会给 300×150 的默认框 —— 尺寸在各上下文里给。
 */
.grid-icon {
  display: block;
  flex-shrink: 0;
  fill: currentColor;
}
.footer-btn .grid-icon {
  width: 14px;
  height: 14px;
}

/*
 * ── rail 态（v18 三态循环的中间态，2026-10-08）────────────────────────────
 * pane 宽被 App.vue 钉死在 RAIL_SIZE（1200px 窗宽下 ≈50px），这里只负责把
 * 内容排成一列图标。background / overflow 与整宽态共用（.sidebar 那两条），
 * 唯一要改的是内边距：10px 边距在 50px 里要吃掉 40%，收成 6px 每边，
 * 图标列拿到约 38px 宽。
 */
.sidebar.is-rail {
  padding: 8px 6px;
}
.rail-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
  /* flex:1 是为了让 .rail-foot-start 的 margin-top:auto 有可分配的空间
     （列自身不满高时 auto 无处可推，底部工具区就贴不到底） */
  flex: 1;
  min-height: 0;
}
/*
 * 身份区（§1.2）的 rail 版：只有一枚 28px 圆头像、无文字（宽度见 .avatar-sm
 * 与 .avatar 的 overflow:hidden —— xs 档位图 32px 会被裁成 28px 圆）；
 * 点击行为与整宽态一致，都去 /login。
 */
.rail-identity {
  padding: 6px 0;
}
/*
 * 组间细分割线（§1.1）：rail 里放不下组标题文字，改用 1px 线表达同一个
 * 分组关系；左右各留 6px，与 .sidebar.is-rail 的 6px 内边距凑成 12px 视觉边距。
 * flex-shrink:0：列不满高时 flex 会把可收缩项压扁，这条线不能被压成 0。
 */
.rail-divider {
  height: 1px;
  margin: 4px 6px;
  flex-shrink: 0;
  background: var(--mi-border);
}
/*
 * 底部工具区的起跑线（§1.3）：margin-top:auto 把「这条线 + 菜单钮 + 设置钮」
 * 整段推到列底。全列**唯一**的 auto 外边距 —— 再加第二个会把剩余空白劈成
 * 两半，底部工具区就贴不到底了（旧版这条职责挂在 .rail-settings 上，
 * 随两钮改造挪到线上）。
 */
.rail-foot-start {
  margin-top: auto;
}
/*
 * 【全套重置 —— 这是个裸 <button>】
 * 边框/底色/字体一个默认值都不要：不重置的话 Windows 上 Chrome 会给它
 * 'Segoe UI' 系统字体和 13.33px 字号，和旁边 emoji 的排版对不齐。
 * 焦点环抄 MiSwitch 的既有约定（--mi-blue-deep 在深浅两色下都是 #6faeff，
 * 是当**笔画**用的令牌；别拿当底色的 --mi-blue 画环 —— 深色下它几乎不存在）。
 */
.rail-item {
  display: block;
  /* 签到圆点（.checkin-dot）的定位参照 —— 与 .module-item 同一条 */
  position: relative;
  width: 100%;
  margin: 0;
  padding: 8px 0;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 15px;
  line-height: 1;
  text-align: center;
  color: var(--mi-text-2);
  border-radius: var(--mi-radius-sm);
  cursor: var(--mi-cursor, pointer);
  transition: background var(--mi-dur-fast) var(--mi-ease);
}
.rail-item:hover {
  background: var(--mi-blue-light);
}
/* 选中态与 .module-item.active / .side-footer.active 同一组配色
   （这组在对比度验收台上验过 ≥4.5:1，别在这儿另发明一组） */
.rail-item.active {
  background: var(--mi-blue);
  color: var(--mi-text);
  font-weight: 600;
}
.rail-item:focus-visible {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 2px;
}
/* 九点阵图标在 rail 里：15px（与 emoji 格里 15px 字号同档），块级 + auto 居中
   （display:block 之后 text-align:center 够不着它，只能自己吃外边距） */
.rail-item .grid-icon {
  width: 15px;
  height: 15px;
  margin: 0 auto;
}
</style>
