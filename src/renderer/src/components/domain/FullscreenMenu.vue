<script setup lang="ts">
/**
 * 全屏遮罩菜单（⑦ 十项升级，2026-10-08）。
 *
 * 【是什么】盖满全屏的导航宫格：中央一块面板，里面是**所有去处**的大图标格。
 * 格子与侧栏是同一批目的地（5 语言 + 功能页），文案取同一份 NAV / NAV_ICON /
 * SIDEBAR.moduleIcon —— 菜单不自带第二张导航表，侧栏加一格这里跟着加。
 * UI 大修轮（§1.1）起：格子按侧栏四分组插小节标题（full-span 行），
 * 顺序与侧栏整宽/rail 两态**逐项同序**（sidebar-groups.test.ts 钉三处 parity）。
 *
 * 【穿透底线（主人点名：不能阻挡双击动画）—— 机制说清楚】
 * 指针转发是 WallpaperLayer 挂在 **document 捕获相**上的只读旁听（Bug2 修复，
 * 见那边的长注释）：它唯一的过滤是 CLICK_FWD_BLOCK 选择器。本组件的分工是：
 *   · `.fs-mask`（整张遮罩）**不进** CLICK_FWD_BLOCK ⇒ 在遮罩空白处按下/松开
 *     照旧转发给壁纸引擎，双击动画在菜单开着时依然能触发；
 *   · `.fs-menu`（居中面板）**登记**进 CLICK_FWD_BLOCK ⇒ 在面板上的按键不惊动
 *     壁纸（与 .mi-modal 同一条语义：控件上的操作不转发）。
 * 遮罩自己的 @click.self 只管「点空白顺手关菜单」，与转发通道互不相干 ——
 * 关菜单（Vue 的 click）和喂引擎（捕获相旁听）是两条并行的事。
 *
 * 【退场帧不收输入】.fs-leave-active{pointer-events:none} —— 逐字照 MiModal:137
 * 的先例（v-if 关掉后元素还要在 DOM 里待完整个过渡，那 190ms 里它是最上层的一张
 * 透明膜，会吃掉所有点击：「关掉 A 弹出 B」的流程会莫名失灵）。
 *
 * 【壁纸降级】开着时 push 浮层计数、关闭 pop（syncDim 三段照抄 MiModal:33-42）：
 * 壁纸层借此停鼠标透视/频谱、引擎降帧 —— 全屏浮层盖着时背景不必满负荷。
 * 纪律同 overlay-dim：push/pop 严格成对，组件卸载时若还开着必须补 pop。
 *
 * 【Reduce】不写组件级 reduce 块：styles/motion.css 的全局总闸（1ms 过渡）
 * 对整个 app 一视同仁，组件再写一份就是第二个真源。
 *
 * 【焦点纪律】开：记住来处（通常是 ☰ 入口按钮）→ 焦点进第一格；关：焦点还给
 * 来处（元素还在场才还）。Tab 在面板内环绕（首尾互换 + 从面板外拽回），
 * 不许跑到遮罩后面的界面上 —— 看得见的地方才接得到键盘。
 *
 * 【挂载面】App.vue，v-if="!isBare"：裸壳页（登录）没有三栏壳也没有入口按钮，
 * 菜单不通向那里。入口在**侧栏底部工具区**（Sidebar 的九点阵按钮
 * emit('open-menu') → App 置 menuOpen）与全局快捷键 Ctrl+Shift+M（§1.3）；
 * 原先那枚贴左缘、面板开合按钮上方的 ⊞ 悬浮钮已随本轮退役 —— 别再往左缘放
 * 入口：TopBar 整条是拖拽区，会吃掉点击（见 TopBar 头注释的红线）。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useContentStore } from '../../stores/content'
import { useSettingsStore } from '../../stores/settings'
import { wallpaperOverlayDim } from '../../lib/wallpaper/overlay-dim'
import { MENU, NAV, NAV_ICON, SIDEBAR } from '../../lib/copy'
import { LANG_DISPLAY } from '../../../../shared/copy'
import type { Lang } from '../../../../shared/types'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ 'update:visible': [v: boolean] }>()

const router = useRouter()
const content = useContentStore()
const settings = useSettingsStore()

/**
 * 分组（UI 大修轮 §1.1）：与侧栏四分组同一套 —— 学习 / 复习与挑战 / 个人中心；
 * 设置属于「工具」（宫格保持一格，不配小节标题 —— 侧栏里它也在工具区、无组标题）。
 */
type MenuGroup = 'learn' | 'review' | 'me' | 'tools'

interface MenuItem {
  key: string
  icon: string
  label: string
  /** 所属分组：渲染时按它在宫格里插一小节标题（full-span 行），tools 无标题 */
  group: MenuGroup
  run: () => void
}

/**
 * NAV[k] 是「图标 + 空格 + 名字」的整串（惯例由 copy.test 逐键钉住）。
 * 宫格里图标要单独放大出场，所以把前缀拆掉；万一哪天对齐惯例被破坏
 * （startsWith 不成立），不静默截断 —— 原样显示整串，看得出哪里不对。
 */
function labelOf(full: string, icon: string): string {
  return full.startsWith(icon) ? full.slice(icon.length).trim() : full
}
function pageItem(
  key: string,
  icon: string,
  full: string,
  path: string,
  group: MenuGroup
): MenuItem {
  return { key, icon, label: labelOf(full, icon), group, run: () => void router.push(path) }
}

const LANGS: readonly Lang[] = ['common', 'c', 'cpp', 'java', 'python']

/** 组名 → 组标题（copy.ts 是唯一真源；tools 空串 = 不画标题行） */
const GROUP_TITLE: Record<MenuGroup, string> = {
  learn: SIDEBAR.GROUP_LEARN,
  review: SIDEBAR.GROUP_REVIEW,
  me: SIDEBAR.GROUP_ME,
  tools: ''
}

/**
 * 宫格顺序 = 侧栏 rail 顺序 = 侧栏整宽分组顺序（§1.1 的 parity 纪律，三处逐项
 * 同序、由 sidebar-groups.test.ts 的静态断言钉住）：学习组（语言 5 → 练习 →
 * 运行代码 → 备忘录）→ 复习与挑战组（复习页按设置开关在场，与 Sidebar 的
 * v-if 同一判据）→ 个人中心组（总览 → 签到 → 排行榜 → 登录）→ 工具（设置）。
 *
 * 【为什么是 computed 不是一次性常量】组件在 App.vue 只挂一次（v-if=!isBare），
 * 设置里把「复习」关掉之后菜单要跟着少一格 —— 写死成常量的话，这一格会
 * 活到下次重启，点了还会进一个用户刚关掉的页面。
 */
const items = computed<MenuItem[]>(() => [
  ...LANGS.map((lang): MenuItem => ({
    key: `lang:${lang}`,
    icon: SIDEBAR.moduleIcon(lang),
    label: LANG_DISPLAY[lang],
    group: 'learn',
    run: () => {
      content.selectLang(lang)
      void router.push('/learn')
    }
  })),
  pageItem('practice', NAV_ICON.PRACTICE, NAV.PRACTICE, '/practice', 'learn'),
  pageItem('playground', NAV_ICON.PLAYGROUND, NAV.PLAYGROUND, '/playground', 'learn'),
  pageItem('memo', NAV_ICON.MEMO, NAV.MEMO, '/memo', 'learn'),
  ...(settings.config.reviewEnabled
    ? [pageItem('review', NAV_ICON.REVIEW, NAV.REVIEW, '/review', 'review')]
    : []),
  pageItem('challenge', NAV_ICON.CHALLENGE, NAV.CHALLENGE, '/challenge', 'review'),
  pageItem('favorites', NAV_ICON.FAVORITES, NAV.FAVORITES, '/favorites', 'review'),
  pageItem('warehouse', NAV_ICON.WAREHOUSE, NAV.WAREHOUSE, '/warehouse', 'review'),
  // 签到（§1.4）已并入总览（2026-10-09 模块三）：独立入口删除 —— 侧栏/菜单/总览
  // 三处只留「总览」一格；未签到时总览自带圆点徽标 + 进页自动闪签到卡引导。
  pageItem('overview', NAV_ICON.OVERVIEW, NAV.OVERVIEW, '/overview', 'me'),
  pageItem('leaderboard', NAV_ICON.LEADERBOARD, NAV.LEADERBOARD, '/leaderboard', 'me'),
  pageItem('login', NAV_ICON.LOGIN, NAV.LOGIN, '/login', 'me'),
  pageItem('settings', NAV_ICON.SETTINGS, NAV.SETTINGS, '/settings', 'tools')
])

/**
 * 渲染行：在 items 上叠「哪一格需要先画一节小标题」—— 组别变化处插一行。
 * index 保留原始下标，供键盘焦点环（btnRefs 按它存）用；标题行不参与 Tab 环
 * （它不是 button，焦点陷阱里按 HTMLButtonElement 过滤，天然跳过）。
 */
interface MenuRow {
  it: MenuItem
  index: number
  /** 非空 = 这一格前面先画一行小节标题 */
  heading: string
}
const rows = computed<MenuRow[]>(() => {
  let prev: MenuGroup | null = null
  return items.value.map((it, index) => {
    const heading = it.group === prev ? '' : GROUP_TITLE[it.group]
    prev = it.group
    return { it, index, heading }
  })
})

/**
 * 浮层计数配对位（严格照 MiModal:33-42 的三段式）。
 * 漏 pop 一次背景就永久卡在降级档（症状：壁纸再也不透视了，极难排查）。
 */
let dimPushed = false
function syncDim(v: boolean): void {
  if (v && !dimPushed) {
    dimPushed = true
    wallpaperOverlayDim.push()
  } else if (!v && dimPushed) {
    dimPushed = false
    wallpaperOverlayDim.pop()
  }
}

const btnRefs = ref<HTMLButtonElement[]>([])
/** 模板 ref 回调（与 MiTabs 同一套：收 unknown，资格判定只认 instanceof） */
function setBtn(el: unknown, i: number): void {
  if (el instanceof HTMLButtonElement) btnRefs.value[i] = el
}
/** 打开时的焦点来处；关闭时还给它（元素还在场才还） */
let restoreTo: HTMLElement | null = null

function close(): void {
  emit('update:visible', false)
}
function pick(item: MenuItem): void {
  close()
  item.run()
}

function trapTab(e: KeyboardEvent): void {
  const els = btnRefs.value.filter((x) => x instanceof HTMLButtonElement)
  if (els.length === 0) return
  const first = els[0]
  const last = els[els.length - 1]
  const active = document.activeElement
  const inside = active instanceof HTMLButtonElement && els.includes(active)
  if (e.shiftKey && (!inside || active === first)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (!inside || active === last)) {
    // 不在面板内也拽回第一格 —— 焦点跑丢到遮罩后面时 Tab 一定先进面板
    e.preventDefault()
    first.focus()
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  } else if (e.key === 'Tab') {
    trapTab(e)
  }
}

watch(
  () => props.visible,
  (v) => {
    syncDim(v)
    if (v) {
      restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
      window.addEventListener('keydown', onKey)
      // 进第一格：Transition 入场元素当帧已在 DOM（enter-from），下一帧聚焦即可
      void nextTick(() => btnRefs.value[0]?.focus())
    } else {
      window.removeEventListener('keydown', onKey)
      if (restoreTo?.isConnected) restoreTo.focus()
      restoreTo = null
    }
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  // 组件整个卸载时菜单还开着（切裸壳路由等）：补 pop，否则计数泄漏
  syncDim(false)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fs">
      <div v-if="visible" class="fs-mask" @click.self="close">
        <div class="fs-menu" role="dialog" aria-modal="true" :aria-label="MENU.TITLE">
          <div class="fs-head">
            <span class="fs-title">{{ MENU.TITLE }}</span>
            <button type="button" class="fs-close" :title="MENU.CLOSE_TITLE" @click="close">
              {{ MENU.CLOSE }}
            </button>
          </div>
          <div class="fs-grid">
            <template v-for="row in rows" :key="row.it.key">
              <!-- 分组小节标题（§1.1）：full-span 行；在组别变化处插一行
                   （由 rows 算好），「工具」那组的空标题不画 -->
              <div v-if="row.heading" class="fs-section">{{ row.heading }}</div>
              <button
                :ref="(el) => setBtn(el, row.index)"
                type="button"
                class="fs-item"
                @click="pick(row.it)"
              >
                <span class="fs-icon">{{ row.it.icon }}</span>
                <span class="fs-label">{{ row.it.label }}</span>
              </button>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fs-mask {
  position: fixed;
  inset: 0;
  /* 9000：与 MiModal/MiDrawer 同一层高 —— 盖过 TopBar(60) 与 panel-toggle(100) */
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--mi-overlay) 55%, transparent);
}

/*
 * 面板：实色底（不进玻璃令牌清单）——全屏菜单是最上层读物，
 * 字必须绝对清晰（与 MiModal 的取舍同一条）。
 */
.fs-menu {
  width: min(660px, 92vw);
  max-height: 86vh;
  overflow-y: auto;
  padding: 18px 20px 20px;
  background: var(--mi-bg);
  border-radius: var(--mi-radius-lg);
  box-shadow: 0 12px 40px color-mix(in srgb, var(--mi-overlay) 25%, transparent);
}
.fs-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.fs-title {
  font-size: 16px;
  font-weight: 600;
}
.fs-close {
  border: none;
  background: none;
  font-size: 14px;
  color: var(--mi-text-3);
  cursor: var(--mi-cursor, pointer);
  padding: 4px 6px;
  border-radius: 6px;
}
.fs-close:hover {
  background: var(--mi-blue-light);
}
.fs-close:focus-visible {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 2px;
}

/* 宫格：auto-fit 按面板宽度自适应列数（窄窗自动减列，不写媒体查询） */
.fs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
  gap: 10px;
}
/*
 * 分组小节标题（§1.1）：通栏一行（1 / -1），11px + --mi-text-3 —— 与侧栏
 * .group-title 同一档字号/颜色（两处刻意同款）。标题行不是 button，键盘
 * 焦点环（btnRefs 只收 HTMLButtonElement）天然跳过它。
 */
.fs-section {
  grid-column: 1 / -1;
  margin-top: 4px;
  font-size: 11px;
  color: var(--mi-text-3);
}
.fs-section:first-child {
  margin-top: 0;
}
.fs-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 8px 12px;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  background: var(--mi-card);
  color: var(--mi-text);
  font-family: inherit;
  font-size: 13px;
  cursor: var(--mi-cursor, pointer);
  transition: background var(--mi-dur-fast) var(--mi-ease);
}
.fs-item:hover {
  background: var(--mi-blue-light);
}
/* 焦点环：与 rail / MiTabs 同一套约定（2px 笔画色、offset 2px） */
.fs-item:focus-visible {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 2px;
}
.fs-icon {
  font-size: 26px;
  line-height: 1;
}
.fs-label {
  color: var(--mi-text-2);
}

/* 过渡：与 modal 同构（遮罩淡入、面板缩放） */
.fs-enter-active,
.fs-leave-active {
  transition: opacity var(--mi-dur) var(--mi-ease-out);
}
.fs-enter-active .fs-menu,
.fs-leave-active .fs-menu {
  transition: transform var(--mi-dur) var(--mi-ease-out);
}
/*
 * 退场那段时间遮罩不许再接点击 —— 逐字照 MiModal:137 先例的理据：
 * v-if 关掉后元素还要在 DOM 里待完整个过渡，而它是 fixed inset:0 z:9000 的
 * 整张透明膜；不摘掉点击的话，「关掉菜单、马上去点别处」的前 190ms 全被吞掉。
 */
.fs-leave-active {
  pointer-events: none;
}
.fs-enter-from,
.fs-leave-to {
  opacity: 0;
}
.fs-enter-from .fs-menu,
.fs-leave-to .fs-menu {
  transform: scale(0.96);
}
</style>
