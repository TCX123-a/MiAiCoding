<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { Pane, Splitpanes } from 'splitpanes'
import Sidebar from './components/domain/Sidebar.vue'
import RightPanel from './components/domain/RightPanel.vue'
import AiPanel from './components/domain/AiPanel.vue'
import SearchPanel from './components/domain/SearchPanel.vue'
import QuizOverlay from './components/domain/quiz/QuizOverlay.vue'
import RewardDialog from './components/domain/quiz/RewardDialog.vue'
import NativeRunConfirm from './components/domain/NativeRunConfirm.vue'
import ZoomControl from './components/domain/ZoomControl.vue'
import WallpaperLayer from './components/wallpaper/WallpaperLayer.vue'
import TopBar from './components/domain/TopBar.vue'
import FullscreenMenu from './components/domain/FullscreenMenu.vue'
import MiToast from './components/base/MiToast.vue'
import { AI_CHAT, LAYOUT } from './lib/copy'
import { useCloudSyncStore } from './stores/cloud-sync'
import { useSearchStore } from './stores/search'
import { useSettingsStore } from './stores/settings'
import {
  foldIntentFromResize,
  layoutPatchFromResize,
  mainSizeOf,
  MAIN_MIN_SIZE,
  RAIL_SIZE,
  RIGHT_PANEL_MAX_SIZE,
  RIGHT_PANEL_MIN_SIZE,
  SIDEBAR_MAX_SIZE,
  SIDEBAR_MIN_SIZE,
  sidebarModeOf,
  sidebarPaneSizeOf,
  sidebarTogglePatch,
  type FoldIntent,
  type LayoutConfig,
  type ResizePayload
} from '../../shared/layout'
import 'splitpanes/dist/splitpanes.css'

/**
 * 三栏布局壳：左侧导航（Sidebar，可收起）+ 主内容（router-view）+ 右侧辅助面板（可收起）。
 *
 * 两条边界都是可拖拽的，拖出来的宽度落在 config.json 的 `layout` 一节里。
 * 尺寸为什么用百分比、以及「主区为什么不设 size」，见 shared/layout.ts 开头那段 ——
 * 那是整套设计里最容易写错的地方。
 */
const search = useSearchStore()
const settings = useSettingsStore()
const route = useRoute()

/**
 * 裸壳路由（⑤ 的登录页，router 里 meta.bare 声明）：
 * 只保留壁纸 + 顶条 + 视图本身 —— 三栏壳（Splitpanes）与两枚面板开合按钮
 * 整个不进 DOM。壁纸与顶条留着是刻意的：背景不闪回、窗口还能拖。
 * 其余全局挂件（搜索面板/答题遮罩/奖励弹窗/原生运行确认/MiToast）统统留在场：
 * 它们要么是本组件之外的状态（弹一个少一个），要么是裸页也要用的反馈通道
 * （登录按钮的 toast 就走 MiToast）。
 */
const isBare = computed(() => route.meta.bare === true)

/**
 * 全屏菜单（⑦）的开合态。只此一处读写：入口有两处 —— 侧栏底部九点阵按钮
 * （Sidebar emit('open-menu') → openMenu()）与全局快捷键 Ctrl+Shift+M ——
 * 关闭由 FullscreenMenu 自己发 update:visible（Esc / 点空白 / 点格子 / 点 ✕）。
 * 不需要 store——组件就挂在本文件里，没有第二个消费方。
 *
 * 【旧入口已退役】2026-10-09 UI 大修轮 §1.3：左缘那枚 ⊞ 悬浮按钮
 * （panel-toggle 家族的 menu 变体）整个删掉，入口搬进侧栏底部工具区
 * （与「设置」同排）—— 本文件里只剩开合态，不再有入口按钮的 DOM。
 */
const menuOpen = ref(false)

/** 侧栏九点阵按钮的落点（Sidebar 只发事件，开合态的唯一真源仍在本文件） */
function openMenu(): void {
  menuOpen.value = true
}

/**
 * 右栏当前显示哪一页（P1，docs/27 §8.5 落点修订）。
 *
 * 【为什么右栏要做成两个页签】默认 1200 窗口下主区只有 720px
 * （左栏 18% + 右栏 22%）。把 AI 侧栏当成"第四栏"或塞进主区，
 * 都会把编辑器和首页卡片压到 366px —— 那是把主界面改窄，不是加功能。
 * 右栏本来就是给辅助信息留的位置，还能被用户拖宽，是唯一不伤主区的落点。
 *
 * 【为什么默认 'panel'】默认值必须是"旧行为"：升级完第一眼看到的还是
 * 练习入口/复习状态，AI 想用的人自己点一下页签（只加少减，§5.2）。
 *
 * 【为什么不落配置】它是一次交互状态，不是用户的长期设定（docs/27 §10：
 * P1 不新增配置字段，schema 保持 v20）。
 */
const rightTab = ref<'panel' | 'ai'>('panel')

const layout = computed<LayoutConfig>(() => settings.config.layout)
const rightPanelOpen = computed(() => layout.value.rightPanelOpen)
const sidebarOpen = computed(() => layout.value.sidebarOpen)

/**
 * 左栏当前在哪一态：open（整栏）/ rail（图标窄栏）/ hidden（收起）。
 * 三态循环的单一出处是 shared/layout.ts 的 sidebarModeOf / sidebarTogglePatch ——
 * 这里和模板都从它们读，别自己写 `open && rail` 的组合判断（第四种组合不存在）。
 */
const sidebarMode = computed(() => sidebarModeOf(layout.value))

/**
 * 左栏 pane 此刻该以多宽出场：rail 态是钉死的 RAIL_SIZE，其余是存的宽度。
 * 注意 rail 期 min==max==RAIL_SIZE（模板里），拖不动 —— 它只是形态的视觉呈现。
 */
const sidebarPaneSize = computed(() => sidebarPaneSizeOf(layout.value))

/** ☰ 按钮的三态外观：图标 + 悬停说明（说的都是「按下去会去哪一态」） */
const SIDEBAR_TOGGLE = {
  open: { icon: '‹', title: LAYOUT.RAIL_SIDEBAR },
  rail: { icon: '«', title: LAYOUT.HIDE_SIDEBAR },
  hidden: { icon: '›', title: LAYOUT.EXPAND_SIDEBAR }
} as const

/**
 * 主区的宽度 = 剩下全给它。**必须显式传给 Pane，不能留空**。
 *
 * 留空的话 splitpanes 会走 `equalizeAfterAddOrRemove`，那条路依赖 pane 的 `givenSize`,
 * 而 `givenSize` 只在 pane 挂载那一刻取一次（见 shared/layout.ts 开头那段）——
 * 用户拖过一次之后它就和真实宽度对不上了，差额会在每次收起/展开面板时被平摊掉。
 * 显式传的话在场各栏的 size 正好凑满 100，splitpanes 的重算逻辑一次都不会被触发。
 */
const mainSize = computed(() => mainSizeOf(layout.value))

function togglePanel() {
  void settings.setLayout({ rightPanelOpen: !rightPanelOpen.value })
}

/** 左栏的开合按钮（togglePanel 的镜像），落在同一个 setLayout 通道上。
 *  v18 起是**三态循环**：open → rail（图标窄栏）→ hidden → open ——
 *  循环顺序与理由在 shared/layout.ts 的 sidebarTogglePatch。 */
function toggleSidebar() {
  void settings.setLayout(sidebarTogglePatch(layout.value))
}

/**
 * 拖完一次分隔条就记一次。判定逻辑在 shared/layout.ts 的 layoutPatchFromResize 里 ——
 * 那儿才有「增删 pane 引起的那次重排不算数」和「拖右栏到极窄 ⇒ 折叠」两条规矩的单测，
 * 这里只管落地。
 */
function onResized(payload: ResizePayload) {
  clearFoldHint()
  const patch = layoutPatchFromResize(payload, layout.value)
  if (patch) void settings.setLayout(patch)
}

/**
 * 「松手就换态」预告：拖任一栏拖到 ≤ 折叠阈值时，给那根分隔条加粗变蓝
 * （.is-fold-hint），在松手之前先告诉用户会发生什么。
 *
 * 【为什么需要预告】左栏落进 rail 是「整栏变成一排图标」、右栏折叠是「整个
 * 消失」—— 都是大变化，不预告的话，用户拖到底松手那一瞬间那一栏变了样，
 * 看起来像拖坏了。预告让「松手会发生什么」在松手之前可见。
 *
 * 【为什么这里直接碰 DOM、不走 Vue 的 class 绑定】分隔条不是我们渲染的 ——
 * 它是 splitpanes 运行时插进容器里的元素，没有对应的 Vue 节点可绑。
 * 全 app 只有这一段命令式样式，收敛在 setFoldHint / clearFoldHint 两个函数里。
 *
 * 【怎么知道拖的是哪一侧、是哪根桥】判定全在 shared/layout.ts 的
 * foldIntentFromResize（完整真值表在 layout.test.ts）。要点：桥的序号是
 * splitpanes 按**在场**栏目现算的 —— 左栏收起后右桥会顶到 index 0，
 * 所以身份必须结合当前开关判，不能把 index 当固定身份。
 *
 * 【@resize 拖拽中每帧都发，这里也敢 querySelectorAll 的原因】全部开销
 * = 查 1~2 个元素 + 一次对象比较；且与上一帧相同时直接 return ——
 * 稳态拖拽的每一帧只做「读几个属性 + 一次比较」，零 DOM 写。
 */
const foldHint = ref<{ intent: FoldIntent; index: number } | null>(null)

function setFoldHint(payload: ResizePayload): void {
  const intent = foldIntentFromResize(payload, layout.value)
  // foldIntentFromResize 只在 index 是合法整数时才返回非 null，这里的断言安全
  const next = intent === null ? null : { intent, index: payload.index as number }
  if (next?.intent === foldHint.value?.intent && next?.index === foldHint.value?.index) return
  foldHint.value = next
  // 文档序 = 分隔条在 splitpanes 里的序号，与载荷里的 index 一一对应
  document
    .querySelectorAll('.miai-split .splitpanes__splitter')
    .forEach((el, i) => el.classList.toggle('is-fold-hint', next !== null && i === next.index))
}

function clearFoldHint(): void {
  if (foldHint.value === null) return
  foldHint.value = null
  document
    .querySelectorAll('.miai-split .splitpanes__splitter')
    .forEach((el) => el.classList.remove('is-fold-hint'))
}

function onGlobalKey(e: KeyboardEvent) {
  // 裸壳页（登录）不接 Ctrl+K：那儿没有课程内容，搜索面板盖上去只会挡路。
  // 排行榜不是裸壳，照常能用。
  if (isBare.value) return
  /*
   * 全屏菜单（§1.3）：Ctrl+Shift+M。不跳过输入框聚焦 —— M 不是输入里的
   * 冲突字母（同 Ctrl+K 的纪律：搜索面板在输入框聚焦时也照开），
   * 遮罩开合的关闭一律交给 FullscreenMenu 的 Esc / 点空白，这里只管开。
   */
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'm') {
    e.preventDefault()
    menuOpen.value = true
    return
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    search.openPanel()
  }
}

/**
 * 窗口失焦也收预告（2026-10-04 复核补的一条兜底）。
 *
 * 【为什么】预告只有 resized 一条清除路径，而 resized 依赖 splitpanes 挂在
 * document 上的 release —— 拖动中 Alt+Tab、或触屏被系统手势抢走时，那个
 * pointerup/mouseup 永远到不了本窗口，预告类就留在桥上长亮（要等下一次
 * 能到达 document 的 release 才自愈）。失焦是这类「拖到一半被打断」在我们
 * 这侧必然能观测到的信号 —— 同 cursor.ts 为「Alt+Tab 后 pointerup 永不到达」
 * 写 blur 兜底，是同一条理由。库自身的 .splitpanes--dragging 不归这里救：
 * 那 3px 蓝条本来就代表「正在拖」且同样会被下一次 release 自愈。
 */
onMounted(() => {
  window.addEventListener('keydown', onGlobalKey)
  window.addEventListener('blur', clearFoldHint)
  /*
   * 云同步节拍器开机（P10.6）：唯一调度者在这里起步 —— 启动轮、本地写防抖
   * （30s）、定时兜底（5 分钟）、窗口 focus、登录/切盒都由它内部接管。
   * start() 自己幂等；失败（状态读口异常）不挡应用启动，它内部吞掉后靠
   * 下一个触发点自愈。不 await：开窗不等网络。
   */
  void useCloudSyncStore().start()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey)
  window.removeEventListener('blur', clearFoldHint)
})
</script>

<template>
  <div class="layout">
    <!--
      壁纸层：`.layout` 第一子、fixed + z:-1（绘制序在一切内容之下），
      刻意**不在** Splitpanes/zoom 里（fixed 进缩放层定位基准会飘，见 zoom.css）。
      组件自己管 data-wallpaper 门控与暂停链；关了就是零残留（v-if 在组件内部）。
    -->
    <WallpaperLayer />

    <!--
      顶条（WCO 的网页部分，2026-10-05）。fixed 在窗口最上，玻璃底吃
      --mi-card-glass（受「UI 面板不透明度」统一控制），整条是拖拽区；
      系统画的三个窗口按钮悬浮在它右上角，点在原生层先命中。
      本组件里**不许放任何可点元素**（会被拖拽区吃掉点击）—— 边界详见
      TopBar.vue 头注释。`.layout` 的 padding-top 吃同一个 --mi-topbar-h，
      三栏整体从条下面开始。
    -->
    <TopBar />

    <!--
      `:maximize-panes="false"` 是折叠机制的必要条件，不是审美偏好：
      双击分隔条最大化会发出**和「真拖到极窄」形状一样**的 resized 载荷
      （event 在场、index 恰好也是桥号、那一栏被压到 min）—— 开着它，双击
      任一桥都会误折叠对应那一侧。两条注释对钉：shared/layout.ts 的
      foldIntentFromResize。
    -->
    <Splitpanes v-if="!isBare" class="miai-split" :maximize-panes="false" @resize="setFoldHint" @resized="onResized">
      <!--
        左栏三态（v18，见 shared/layout.ts 的 sidebarTogglePatch）：
        · open —— 按存下来的 sidebarSize 出场，min/max 是常规拖拽区间；
        · rail（图标窄栏）—— 这一栏**仍在场**，但 size / min-size / max-size
          全钉成 RAIL_SIZE（min == max，拖不动）：它是形态的呈现，不是宽度 ——
          用户原来拖出来的宽度还留在 sidebarSize 里，展开时原样回来；
        · hidden —— `v-if` 把这一栏整个从 splitpanes 里移除（和右栏同一套，
          不占位也不可拖）。
      -->
      <Pane
        v-if="sidebarOpen"
        :size="sidebarPaneSize"
        :min-size="sidebarMode === 'rail' ? RAIL_SIZE : SIDEBAR_MIN_SIZE"
        :max-size="sidebarMode === 'rail' ? RAIL_SIZE : SIDEBAR_MAX_SIZE"
      >
        <Sidebar @open-menu="openMenu" />
      </Pane>

      <!-- 在场各栏的 size 加起来正好 100，splitpanes 的重算逻辑就一次都不会被触发 -->
      <Pane :size="mainSize" :min-size="MAIN_MIN_SIZE">
        <!--
          `.main-pane` 这一层只有一个作用：给缩放控件当定位基准。
          缩放控件是 `main.content` 的**兄弟**而不是孩子 —— 因为
          `main.content` 的孩子整体吃 `zoom`（见 styles/zoom.css），
          控件落在里面就会跟着一起缩放，「点一下 − 按钮就往光标底下缩」。
          它自己也**不能**用 `position: fixed` 挂在窗口上：那样右栏一开，
          它会压在右栏身上。挂在中间这一栏里，栏宽多少它就跟着走，
          一行 JS 都不用写（分隔条拖拽、右栏收起展开全自动跟上）。
        -->
        <div class="main-pane">
          <main class="content">
            <!--
              路由切换过渡。`mode="out-in"` 和 `:key` 各自都是必需的：
              · `out-in` —— 两个视图同时在场的话它们是块级元素、都在正常流里，
                第二个会直接掉到第一个下面去，过渡期间内容高度翻倍、滚动条猛跳。
                详见 styles/motion.css 里那段。
              · `:key="route.path"` —— 没有它的话 Vue 认为「还是同一个组件」，
                直接就地复用，过渡根本不会被触发。带上 path 之后
                从 /lesson/c1 走到 /lesson/c2 也会重放一遍动画（这俩是同一个组件）。
              · 过渡类名（.mi-route-*）定义在全局样式里，不在这里写 scoped ——
                原因见 styles/motion.css 开头。
            -->
            <router-view v-slot="{ Component, route }">
              <Transition name="mi-route" mode="out-in">
                <component :is="Component" :key="route.path" />
              </Transition>
            </router-view>
          </main>

          <ZoomControl />
        </div>
      </Pane>

      <Pane
        v-if="rightPanelOpen"
        :size="layout.rightPanelSize"
        :min-size="RIGHT_PANEL_MIN_SIZE"
        :max-size="RIGHT_PANEL_MAX_SIZE"
      >
        <div class="right-dock">
          <div class="right-tabs">
            <button
              type="button"
              class="right-tab"
              :class="{ active: rightTab === 'panel' }"
              :aria-pressed="rightTab === 'panel'"
              :title="LAYOUT.TAB_PANEL_TITLE"
              @click="rightTab = 'panel'"
            >
              {{ LAYOUT.TAB_PANEL }}
            </button>
            <button
              type="button"
              class="right-tab"
              :class="{ active: rightTab === 'ai' }"
              :aria-pressed="rightTab === 'ai'"
              :title="AI_CHAT.TAB_TITLE"
              @click="rightTab = 'ai'"
            >
              {{ AI_CHAT.TAB }}
            </button>
          </div>
          <div class="right-dock-body">
            <RightPanel v-if="rightTab === 'panel'" />
            <AiPanel v-else />
          </div>
        </div>
      </Pane>
    </Splitpanes>

    <!--
      裸壳分支（⑤ 的登录页）：三栏壳整个不进 DOM，路由视图顶上来。
      过渡与 :key 的规矩与上面主分支逐字一致（mode="out-in" 与 :key="route.path"
      各自的为什么见主分支那段注释）。这里解构成 r 是因为 script 里已经有一个
      同名 route（useRoute() 的返回值）。
    -->
    <router-view v-else v-slot="{ Component, route: r }">
      <Transition name="mi-route" mode="out-in">
        <component :is="Component" :key="r.path" />
      </Transition>
    </router-view>

    <!--
      两侧各一枚开合按钮：右栏还是两态（开/合），左栏是三态循环
      （open → rail → hidden → open，文案/图标见脚本里的 SIDEBAR_TOGGLE）。
      左栏箭头随态走：整栏 '‹'（收成图标栏）、图标栏 '«'（再收就没了）、
      隐藏 '›'（点回来）。裸壳页没有栏可开合，两枚都不渲染。
    -->
    <button
      v-if="!isBare"
      class="panel-toggle panel-toggle--left"
      :title="SIDEBAR_TOGGLE[sidebarMode].title"
      @click="toggleSidebar"
    >
      {{ SIDEBAR_TOGGLE[sidebarMode].icon }}
    </button>

    <button
      v-if="!isBare"
      class="panel-toggle"
      :title="rightPanelOpen ? LAYOUT.COLLAPSE_PANEL : LAYOUT.EXPAND_PANEL"
      @click="togglePanel"
    >
      {{ rightPanelOpen ? '›' : '‹' }}
    </button>

    <!--
      全屏菜单（⑦）：开合态在脚本里（入口 = 侧栏底部九点阵按钮 / Ctrl+Shift+M，
      §1.3 起左缘那枚 ⊞ 悬浮钮已退役）。裸壳页没有三栏壳也没有入口，不渲染。
    -->
    <FullscreenMenu v-if="!isBare" v-model:visible="menuOpen" />

    <MiToast />
    <SearchPanel />
    <QuizOverlay />
    <!--
      奖励弹窗（每日第一次复习发图，学习闭环 §7）。**挂在 App 上，不挂在 QuizOverlay 里**：
      它的状态（`reward.pending`）比一局练习活得久 —— 会话一关，遮罩里的东西
      全卸载了但 pending 还在，下次开练习时陈年弹窗会跟着冒出来。
      挂在这儿，它的生死只由 store 决定，和 NativeRunConfirm 是同一条理由。
    -->
    <RewardDialog />
    <!--
      「用你自己装的编译器吗」的确认框。**全应用只此一个**，且必须挂在这里 ——
      能发起运行的有练习场和答题遮罩两处，各挂一个的话会叠两个框；
      而答题遮罩挂在 body 的 Teleport 里，挂在别处也盖不住它。
      见 lib/native-confirm.ts。
    -->
    <NativeRunConfirm />
  </div>
</template>

<style scoped>
.layout {
  position: relative;
  height: 100%;
  /*
   * 顶条把三栏整体往下让一条 —— 值必须和 TopBar 的高度吃**同一个**
   * --mi-topbar-h（tokens.css，WCO 真空高/33px 兜底）。少了它，
   * 侧栏与正文第一行会被顶条盖住；两边各写各的兜底，迟早对不上。
   * box-sizing: border-box（全局 *）下，padding 不吃掉 100% 高度：
   * 内容盒 = 100% - 条高，splitpanes 的 height:100% 正好接上。
   */
  padding-top: var(--mi-topbar-h);
}

/*
 * 中间栏的定位基准。只干这一件事：让内部的 `.zoom-ctl` 用 `position: absolute`
 * 钉在「中间这一栏」的右下角，而不是钉在窗口上 —— 理由见模板里那段。
 * 高度和宽度都交给父级（splitpanes 的 pane 是 `width/height: 100%` 的块盒），
 * 所以这里写 100% 不会把任何一栏挤变形。
 */
.main-pane {
  position: relative;
  width: 100%;
  height: 100%;
}

.content {
  height: 100%;
  overflow-y: auto;
  /*
   * ⚠️ `overflow-x: hidden` 是路由过渡的必要条件，不是排版偏好。
   *
   * 路由进场时视图会从右边 12px 处推进来。`overflow-x` 不写的话它按规范会
   * **计算成 auto**（因为另一个轴已经是 auto 了），于是那 12px 的越界会被
   * 当成「内容比容器宽」—— 过渡的 200 多毫秒里，底部会闪一下横向滚动条。
   * 时间很短，但它是**每切一次页面就闪一次**，比一直显着还烦。
   *
   * 内容区本来也不该横向滚动：真正需要横滚的是代码块，那是它们自己（`pre`）的事，
   * 不是整页的事。
   */
  overflow-x: hidden;
  padding: 24px;
  /* 正文区的底 = 画布（最暗的那层）。卡片压在它上面才浮得起来 ——
     2026-09-14 之前它和卡片同为白/近白，对比 1.00，看不出层次。 */
  background: var(--mi-canvas);
}

.panel-toggle {
  position: fixed;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 22px;
  height: 48px;
  border: 1px solid var(--mi-border);
  border-right: none;
  border-radius: var(--mi-radius-sm) 0 0 var(--mi-radius-sm);
  background: var(--mi-bg);
  color: var(--mi-text-2);
  font-size: 16px;
  cursor: var(--mi-cursor, pointer);
  z-index: 100;
}
.panel-toggle:hover {
  background: var(--mi-blue-light);
}

/*
 * 左栏那枚：基础类的镜像。`right: 0` 在基础类里写死，这里改回 auto，
 * `left: 0` 才立得住；描边与圆角整个反过来（贴左缘 = 左边不留边）。
 * 悬浮态不用重写：`.panel-toggle:hover` 对两枚都命中。
 */
.panel-toggle--left {
  right: auto;
  left: 0;
  border: 1px solid var(--mi-border);
  border-left: none;
  border-radius: 0 var(--mi-radius-sm) var(--mi-radius-sm) 0;
}

/*
 * 全屏菜单入口（⑦ → §1.3 改造）：这里原来还有一枚贴左缘的 ⊞ 悬浮按钮
 * （panel-toggle 家族的 menu 变体，top: calc(50% - 60px)），随改造整个退役 ——
 * 入口搬去侧栏底部工具区（Sidebar 的 .side-footer，与「设置」同排，九点阵 SVG）。
 * 对应样式一并删除（不是留着不用）：「还有一条死样式」会让人以为按钮还在别处。
 */

/* ── 分隔条 ──────────────────────────────────────────────────────────────
   不挂 splitpanes 自带的 `default-theme`：那套是灰底配两根小竖线，相当「工业感」，
   和设计规范里「避免工业感、极客感」那条冲突。自己画：
   静止时它就是一条 1px 的 --mi-border 细线 —— 和改造前两侧写死的 border 一模一样，
   所以第一眼观感是零变化；鼠标靠上去才浮出一条浅蓝的圆角细条，告诉用户「这儿能拖」。

   【拖拽的平滑感是 splitpanes 自带的，不用我们再写】
   它的 `.splitpanes--ready .splitpanes__pane` 上挂着 `transition: width .2s ease-out`，
   而 `.splitpanes--dragging` 时又把 transition 关掉 —— 这恰好就是拖拽该有的手感：
   拖的过程中跟手（零延迟、不拖泥带水），松手之后若触发重排才滑过去（不硬跳）。 */
.layout :deep(.splitpanes__splitter) {
  position: relative;
  /**
   * ⚠️ 这一行是「左分隔条根本拖不到」的修复（2026-10-04 主人实测），别删。
   *
   * 上面那段负外边距让分隔条的盒子有 6px 压在**右邻那一栏**身上。绘制序里
   * 定位元素画在非定位元素之上；同是定位、又都 z-index:auto 时，才轮到树序
   * 决胜负（后画的在上）。左桥的右邻是主区 `.main-pane` —— 它 position:relative
   * 且树序在后，恰好把两个条件占全：这 6px 连同 ::before 那条 1px 线整个
   * 被主区盖住。表现出来就是「左栏看不到分隔条」（线被盖没了）、「拖不动」
   * （elementFromPoint 实测命中的是 MAIN.content）。
   * 右桥的右邻是右栏 —— 那边整棵子树都没有定位，非定位内容画在所有定位元素
   * **下面**，所以右桥那条线一直看得见。判据是「右邻是否定位」，**与树序无关**：
   * 右栏哪天加了 position，右桥立刻步左桥的后尘（2026-10-04 复核改：这里原先
   * 把右桥的幸免归因于树序，那是说反的 —— 树序在后只会让它更容易被盖）。
   *
   * z-index:1 把两根桥都提到窗格之上。桥本体是 transparent，视觉零变化，
   * 只有那条线从"被盖住"变回可见；上层里 .panel-toggle 是 z:100、
   * ZoomControl 是 z:50，都高于 1，层级关系不动。
   */
  z-index: 1;
  flex-shrink: 0;
  width: 6px;
  /**
   * ⚠️ 这个负外边距**不是排版微调，是让拖拽不漂的必要条件**，别顺手删掉。
   *
   * splitpanes 算拖拽位置时是「光标像素 ÷ 容器宽」——它**默认分隔条不占任何宽度**。
   * 分隔条实打实占 6px 的话，三栏的 100% 加上两个分隔条就超出容器 12px，
   * flex 只好按比例把窗格压掉（实测压缩比 1186/1198 = 0.99）。
   * 于是每次拖拽都拿「被压缩过的像素位置」换算成一个更小的百分比存回去，
   * **每拖一次缩水 1%，而且是累积的**：实测原地连点三下，左栏 231 → 229 → 226 → 224。
   *
   * 负右边距把 6px 的占位抵消掉（净占位 0），同时分隔条的**左边缘正好落在边界上**，
   * 于是「光标位置 ÷ 容器宽」和窗格的百分比严格相等，一次拖拽一个字节都不会漂。
   * 分隔条视觉上向右边那栏探进 6px，但 `::before` 那条线仍然是居中画的，
   * 位置和改之前一模一样。
   */
  margin-right: -6px;
  /*
   * 【为什么从 --mi-bg 改成 transparent —— 这是配色改动逼出来的】
   * 上面那行负边距让这 6px 是**压在右边那一栏身上**的（而且它 position:relative，
   * 图层上盖得住后面的窗格）。原先填 --mi-bg（白），左栏/右栏都是 #f7f9fc，
   * 色差只有 1.03 —— 白条子压上去看不出来。
   * 现在右栏是 #fbfdff、画布是 #edf2f8，色差涨到 1.10，同样一条 6px 会变成
   * 右栏左边一道显眼的浅蓝竖条。
   *
   * 不填色就没有这个问题：**透过它直接看到底下那一栏**，左右两条都自动跟背景一致，
   * 以后再怎么调配色都不用回来改这一行。分隔线仍在（`::before` 那 1px）。
   */
  background: transparent;
}
.layout :deep(.splitpanes__splitter)::before {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: 1px;
  height: 100%;
  border-radius: 999px;
  background: var(--mi-border);
  transition:
    width 0.18s ease,
    background-color 0.18s ease;
}
.layout :deep(.splitpanes__splitter:hover)::before,
.layout :deep(.splitpanes--dragging .splitpanes__splitter)::before,
.layout :deep(.splitpanes__splitter:focus-visible)::before {
  width: 3px;
  background: var(--mi-blue-deep);
}
/* 「松手就收起」预告（setFoldHint 每帧挂/摘）：比 hover 再粗一档。
   同一条 ::before，与上面 hover / 拖拽 / focus-visible 三条规则**特异度
   打平**（编译后都是 0,4,1）—— 仗着写在源码最后取胜（2026-10-04 复核改：
   原写「选择器更具体」不成立）。谁把它挪到那三条前面，预告的 4px 就会被
   hover 态的 3px 盖回。 */
.layout :deep(.splitpanes__splitter.is-fold-hint)::before {
  width: 4px;
  background: var(--mi-blue-deep);
}

/* ---------------------------------------------------------------- 右栏页签（P1）

   右栏在 P1 起有两个页签：「辅助信息」（原来那一栏，默认）与「大肥鱼」（AI 侧栏）。
   页签条只占 32px，两栏的**宽度逻辑一个字没动** —— 仍然是用户拖出来的那个百分比，
   所以「只加少减」在这里是"右栏里多了一个页签"，不是"多了一栏"。 */
.right-dock {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.right-tabs {
  display: flex;
  gap: 2px;
  padding: 6px 8px 0;
  flex-shrink: 0;
}
.right-tab {
  flex: 1;
  min-width: 0;
  padding: 5px 6px;
  border: none;
  border-radius: var(--mi-radius-sm) var(--mi-radius-sm) 0 0;
  background: transparent;
  color: var(--mi-text-2);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.right-tab:hover {
  color: var(--mi-text);
}
/* 选中态用底色 + 字色两个信号，不只靠颜色深浅 —— 264px 的窄栏里
   只变字重几乎看不出来（对比度硬线也要求文字始终实心，不用 opacity） */
.right-tab.active {
  background: var(--mi-bg);
  color: var(--mi-text);
  font-weight: 600;
}
.right-dock-body {
  flex: 1;
  min-height: 0;
  /* 子组件（RightPanel / AiPanel）各自管自己的滚动；这里只负责给它们确定的高度 */
  overflow: hidden;
}
</style>
