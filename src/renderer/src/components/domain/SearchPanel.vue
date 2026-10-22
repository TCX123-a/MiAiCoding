<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useSearchStore } from '../../stores/search'
import { useLessonOpener } from '../../lib/openLesson'
import { useSearchStarter } from '../../lib/search-practice'
import { moveActive, searchActions } from '../../lib/search-panel'
import { LANG_LABEL } from '../../lib/labels'
import { EMPTY, PLACEHOLDER, SEARCH } from '../../lib/copy'
import { wallpaperOverlayDim } from '../../lib/wallpaper/overlay-dim'
import MiEmpty from '../base/MiEmpty.vue'
import type { SearchResult } from '../../../../shared/search'

// M2-05：Ctrl+K 命令面板（侧栏搜索框聚焦也会打开）
//
// 学习闭环 §9：结果列表尾巴上多了「相关题目练习」入口。它**不是**装饰——
// ↑↓ 的巡回范围从"课程结果数组"改成了 `searchActions()` 合成的动作清单
// （课程在前、练题在最后），否则鼠标点得到、键盘永远走不过去（计划 §10.5）。
const search = useSearchStore()
const { openLesson } = useLessonOpener()
const { startSearch } = useSearchStarter()

const inputEl = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const activeIndex = ref(0)

/** ↑↓ 走的是这份清单，不是课程结果数组 —— 理由见 lib/search-panel.ts 的抬头 */
const actions = computed(() => searchActions(search.results, search.questionHits))
/** 「练相关题」那行在巡回清单里的下标；从清单里**找**，不假设它排第几（没有时 -1） */
const practiceIndex = computed(() => actions.value.findIndex((a) => a.kind === 'practice'))

/**
 * combobox 的 aria-activedescendant：焦点从不离开输入框，把「当前选到哪一行」
 * 用 id 报给读屏。清单空时整个属性不出现（undefined ⇒ Vue 摘掉它）。
 */
const activeDesc = computed(() => (actions.value.length > 0 ? `search-opt-${activeIndex.value}` : undefined))

/**
 * ↑↓ 把选择移出可视区时把这行滚进视野。
 *
 * 【为什么必须有】结果上限 30 条、可视区只有 46vh —— 键盘往下按过十来下之后，
 * 高亮行滑出列表底部，屏幕上不再有任何东西指示"现在按回车会开哪一课"。
 * 鼠标走 mouseenter 不经过这里，所以只在键盘/程序性移动时补这一下。
 * `block:'nearest'`：已经在视野里就一动不动，免得按一下跳一下。
 */
watch(activeIndex, async () => {
  await nextTick()
  listEl.value?.querySelector('.result-item.active')?.scrollIntoView({ block: 'nearest' })
})

/**
 * 关闭时把焦点还给来处（元素还在场才还）—— 逐字照 FullscreenMenu 的焦点纪律。
 * 修复现场（V2-42）：原来关掉面板焦点**不还**，键盘党从此不知道光标在哪。
 */
let restoreTo: HTMLElement | null = null

/**
 * 面板级键盘纪律（修复现场 V2-33）。
 *
 * 【原来错在哪】Escape 只挂在输入框的 `@keydown` 上。Tab 一次焦点就出了输入框、
 * 掉到蒙层背后的页面控件上 —— 此后 Esc 永远关不掉面板，回车还会触发背后看不见的控件。
 *
 * 【修法为什么是「钉住焦点」而不是"把结果行做成可聚焦"】
 * 这是个 combobox（命令面板）语义：焦点自始至终在输入框，结果行由 ↑↓ 巡回、
 * 用 aria-activedescendant 报位 —— 与 VS Code 命令面板同一套。Tab 在面板里
 * 唯一该待的地方就是输入框，所以陷阱 = 把 Tab 扣下、把焦点拽回来。
 */
function trapTab(e: KeyboardEvent): void {
  e.preventDefault()
  inputEl.value?.focus()
}

function onWindowKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    search.closePanel()
  } else if (e.key === 'Tab') {
    trapTab(e)
  }
}

/**
 * 浮层计数配对位（2026-10-08 体感卡顿修复）：搜索面板盖全屏时壁纸层降级
 * （停透视/频谱、场景降帧），关闭即恢复。配对纪律见 overlay-dim.ts。
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
onBeforeUnmount(() => {
  syncDim(false)
  window.removeEventListener('keydown', onWindowKey)
})

watch(
  () => search.open,
  async (v) => {
    syncDim(v)
    activeIndex.value = 0
    if (v) {
      // 来处要在焦点被抢走**之前**记下（打开时焦点通常还在侧栏搜索框/触发的钮上）
      restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
      window.addEventListener('keydown', onWindowKey)
      await nextTick()
      inputEl.value?.focus()
      inputEl.value?.select()
    } else {
      window.removeEventListener('keydown', onWindowKey)
      if (restoreTo?.isConnected) restoreTo.focus()
      restoreTo = null
    }
  }
)

// 两路结果任一变化都回到第一行（原来只盯课程结果的条数）
watch(
  () => actions.value.length,
  () => {
    activeIndex.value = 0
  }
)

/**
 * 输入框内的按键（↑↓ 巡回 / Enter 执行）。
 * Escape 与 Tab **不在这里** —— 它们挂面板级 window 监听（见 `onWindowKey`），
 * 因为焦点一旦离开输入框，挂在这儿的处理器就再也收不到键了（V2-33 的根因）。
 */
function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = moveActive(activeIndex.value, 1, actions.value.length)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = moveActive(activeIndex.value, -1, actions.value.length)
  } else if (e.key === 'Enter') {
    const a = actions.value[activeIndex.value]
    if (!a) return
    if (a.kind === 'lesson') openResult(a.result)
    else startPractice()
  }
}

function openResult(r: SearchResult) {
  search.closePanel()
  search.query = ''
  openLesson(r.entry.id)
}

/**
 * 开搜索微型卷。
 *
 * ⚠️ 先抓命中快照、再清查询：清查询会走防抖计时器 —— 顺序反了的话，
 * 快照可能落在"查询已清空"之后，开出一张空卷（0 道 = 什么都没发生）。
 */
function startPractice() {
  const hits = search.questionHits
  search.closePanel()
  search.query = ''
  startSearch(hits)
}

/** 把命中片段里的查询词包上高亮（大小写不敏感） */
function highlight(text: string): string {
  const q = search.query.trim()
  if (!q) return escapeHtml(text)
  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, 'gi'))
  return parts.map((p) => (p.toLowerCase() === q.toLowerCase() ? `<mark>${escapeHtml(p)}</mark>` : escapeHtml(p))).join('')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="search">
      <div v-if="search.open" class="search-mask" @click.self="search.closePanel()">
        <div class="search-panel" role="dialog" aria-modal="true" :aria-label="PLACEHOLDER.SEARCH_PANEL">
          <!--
            combobox 语义（V2-33 键盘可达）：焦点常驻输入框，↑↓ 的选择通过
            aria-activedescendant 报给读屏 —— 结果行因此**不需要** tabindex。
          -->
          <input
            ref="inputEl"
            v-model="search.query"
            class="search-input"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            :aria-controls="'search-listbox'"
            :aria-activedescendant="activeDesc"
            :placeholder="PLACEHOLDER.SEARCH_PANEL"
            @keydown="onKey"
          />
          <!--
            v-auto-animate 挂在**结果列表**上，不是挂在 .search-mask / .search-panel 上。
            外面那两层归 <Transition name="search"> 的 CSS 管（它会给面板写
            `transform: translateY(-10px)`），再挂一个会往同一批元素上写内联 transform，
            两套动画打架。挂在这一层就互不干扰 —— 它们操作的是不同的元素。
          -->
          <div
            id="search-listbox"
            ref="listEl"
            class="search-results"
            role="listbox"
            :aria-label="SEARCH.RESULTS_LABEL"
            v-auto-animate
          >
            <div
              v-for="(r, i) in search.results"
              :id="`search-opt-${i}`"
              :key="r.entry.id"
              class="result-item"
              role="option"
              :aria-selected="i === activeIndex"
              :class="{ active: i === activeIndex }"
              @mouseenter="activeIndex = i"
              @click="openResult(r)"
            >
              <div class="result-title">
                <span class="lang-badge">{{ LANG_LABEL[r.entry.lang] ?? r.entry.lang }}</span>
                <span v-html="highlight(r.entry.title)" />
              </div>
              <div class="result-snippet" v-html="highlight(r.snippet)" />
            </div>
            <!--
              「练相关题」入口（学习闭环 §9）：搜到题才有这一行（搜不到就不摆假按钮）。
              它也进 ↑↓ 的巡回 —— 顺序由 lib/search-panel.ts 的 searchActions() 定死，
              activeIndex 对上的是那份清单里的下标（practiceIndex 是找出来的，不是猜的）。
            -->
            <div
              v-if="search.questionHits.length > 0"
              :id="`search-opt-${practiceIndex}`"
              class="result-item practice-row"
              role="option"
              :aria-selected="activeIndex === practiceIndex"
              :class="{ active: activeIndex === practiceIndex }"
              @mouseenter="activeIndex = practiceIndex"
              @click="startPractice"
            >
              <div class="result-title">{{ SEARCH.practiceRow(search.questionHits.length) }}</div>
              <div class="result-snippet">{{ SEARCH.PRACTICE_SUB }}</div>
            </div>
            <!--
              空态：课程与题目**两路都没有**才算"没有找到"。
              题目命中套着课程正文（打包器的检索文本把题干也拼进去了），
              今天命中题目 ⇒ 必然也有课程结果 —— 但那是打包器的实现细节，
              哪天它变了，这里不该冒出一句"没找到"压着一行能点的练题入口。
              `!search.pending`（2026-10-17 夜间批）：防抖窗口没跑完时结果集
              还停在上一个词上，此刻的"两路都空"不是结论 —— 空态必须等结果
              追上来（否则每次重新搜索都会先闪一句假的"没有找到"）。
            -->
            <MiEmpty
              v-if="
                search.query.trim() &&
                !search.pending &&
                search.results.length === 0 &&
                search.questionHits.length === 0
              "
              v-bind="EMPTY.SEARCH_NO_RESULT"
            />
          </div>
          <div class="search-foot">{{ SEARCH.FOOT_KEYS }}</div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.search-mask {
  position: fixed;
  inset: 0;
  z-index: 9500;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
  background: color-mix(in srgb, var(--mi-overlay) 30%, transparent);
}
.search-panel {
  width: 580px;
  max-width: 92vw;
  background: var(--mi-bg);
  border-radius: var(--mi-radius-lg);
  box-shadow: 0 16px 48px color-mix(in srgb, var(--mi-overlay) 28%, transparent);
  overflow: hidden;
}
.search-input {
  width: 100%;
  padding: 14px 18px;
  font-size: 15px;
  font-family: var(--mi-font);
  color: var(--mi-text);
  border: none;
  border-bottom: 1px solid var(--mi-border);
  outline: none;
  background: transparent;
}
/*
 * V2-31：这个输入框是全仓唯一「outline:none 且没有任何替代焦点样式」的
 * 表单控件 —— Tab 走开再回来时，界面上看不出焦点在哪。照 MiInput/MiSelect
 * 的先例补一条（打开面板时的自动聚焦也会走到这里，出现蓝线当属正常：
 * 它此刻确实拿着焦点）。
 */
.search-input:focus {
  border-bottom-color: var(--mi-blue-deep);
}
.search-input::placeholder {
  color: var(--mi-text-3);
}
.search-results {
  max-height: 46vh;
  overflow-y: auto;
  padding: 8px;
}
.result-item {
  padding: 9px 12px;
  border-radius: var(--mi-radius-sm);
  cursor: var(--mi-cursor, pointer);
}
.result-item.active {
  background: var(--mi-blue-light);
}
/* 「练相关题」行：和课程结果是两种动作，用一条虚线隔开（颜色全走令牌，深色自理） */
.practice-row {
  margin-top: 6px;
  border-top: 1px dashed var(--mi-border);
}
.result-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--mi-text);
}
.lang-badge {
  flex-shrink: 0;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 400;
  color: var(--mi-text-2);
  background: var(--mi-blue);
  border-radius: 999px;
}
.result-snippet {
  margin-top: 3px;
  font-size: 12px;
  color: var(--mi-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/*
 * 命中词的高亮（V1-56 修复现场）。
 *
 * 【原来错在哪】`color: var(--mi-text)` 压在**两主题同值**的浅黄底 --mi-warn 上：
 * 浅色下 --mi-text 是深墨（6.66:1 ✓），深色下它翻成浅灰 #b6c1d0 —— 浅灰压浅黄
 * 只剩 **1.28:1**，全页最该看清的那个词恰恰最看不清。
 *
 * 【修法】背景继续用 --mi-warn（两主题都是那支记号笔黄，高亮的身份不变），
 * 字色改用 --mi-on-fill —— 它就是为"浅色填充上的字"准备的令牌，两主题都翻对
 * （浅 7.28:1 / 深 11.12:1）。这对组合已钉进对比度验收清单。
 */
.result-item :deep(mark) {
  background: var(--mi-warn);
  color: var(--mi-on-fill);
  border-radius: 2px;
  padding: 0 1px;
}
.search-foot {
  padding: 8px 16px;
  font-size: 11px;
  color: var(--mi-text-3);
  border-top: 1px solid var(--mi-border);
  background: var(--mi-card);
}
.search-enter-active,
.search-leave-active {
  transition: opacity var(--mi-dur) var(--mi-ease-out);
}
.search-enter-active .search-panel,
.search-leave-active .search-panel {
  transition: transform var(--mi-dur) var(--mi-ease-out);
}
.search-enter-from,
.search-leave-to {
  opacity: 0;
}
.search-enter-from .search-panel,
.search-leave-to .search-panel {
  transform: translateY(-10px);
}
</style>
