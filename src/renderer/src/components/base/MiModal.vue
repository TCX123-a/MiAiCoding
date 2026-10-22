<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { wallpaperOverlayDim } from '../../lib/wallpaper/overlay-dim'
import { MODAL } from '../../lib/copy'

const props = withDefaults(
  defineProps<{
    visible: boolean
    title?: string
    width?: number
    closable?: boolean
  }>(),
  { width: 480, closable: true }
)

const emit = defineEmits<{ 'update:visible': [v: boolean]; close: [] }>()

function close() {
  if (!props.closable) return
  emit('update:visible', false)
  emit('close')
}

/**
 * 焦点纪律（V2-36，2026-10-16）：对齐 FullscreenMenu.vue 那套现成标准。
 *
 * 【三个坏法，各修一处】转按钮之前这里是全站最典型的失焦现场：
 *   ① 打开时焦点不进来 —— Tab 得先穿过蒙层背后剩下的整页控件
 *      （走到哪看不见，焦点框全在遮罩后面）；
 *   ② 关掉时焦点丢回 body —— 焦点若曾进过弹窗（鼠标点过里头的按钮），
 *      关闭后 activeElement 落在 body，下次 Tab 从页面开头重来；
 *   ③ ✕ 对读屏只读得出一个「乘号」符号。
 *
 * 【为什么聚焦目标是"运行现场现查"而不是像 FullscreenMenu 那样登记 refs】
 * FullscreenMenu 的格子是固定的菜单项，能预先登记；MiModal 的身体是使用方
 * 塞的 slot —— 有几颗按钮、有没有输入框只有渲染出来才知道。所以每次按键
 * 现查面板内的可聚焦元素（见 focusables()）。
 */
const panel = ref<HTMLElement | null>(null)
/** 打开时的焦点来处；关闭时还给它（元素还在场才还） */
let restoreTo: HTMLElement | null = null

/**
 * 面板内当前可聚焦的元素，按 DOM 顺序。
 * 用运行时查询而不是维护列表：slot 内容随使用方渲染/条件分支变化，
 * 列表会过期；查询永远是"此刻真实能 Tab 到的东西"。
 */
function focusables(): HTMLElement[] {
  const root = panel.value
  if (!root) return []
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => !el.hasAttribute('disabled'))
}

/**
 * Tab 陷阱：焦点在面板的最末/最前时环绕，不在面板里时拽回第一格。
 * 「不在面板里也拽回」是刻意的 —— 焦点万一跑到遮罩后面（脚本挪的、
 * 元素被禁用掉的），下一次 Tab 一定会先回到弹窗里，而不是越跑越远。
 */
function trapTab(e: KeyboardEvent): void {
  const els = focusables()
  if (els.length === 0) {
    // 没有任何可聚焦元素（纯文字通知类弹窗）：焦点钉在面板上
    e.preventDefault()
    panel.value?.focus()
    return
  }
  const first = els[0]
  const last = els[els.length - 1]
  const active = document.activeElement
  const inside = active instanceof HTMLElement && els.includes(active)
  if (e.shiftKey && (!inside || active === first)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (!inside || active === last)) {
    e.preventDefault()
    first.focus()
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
  else if (e.key === 'Tab') trapTab(e)
}

/**
 * 浮层计数配对位（2026-10-08 体感卡顿修复）：弹窗开着时告诉壁纸层降级
 * （停鼠标透视/音频频谱、引擎遮挡降帧），关闭即恢复。push/pop 必须严格成对
 * ——漏 pop 一次背景就永久降级（见 lib/wallpaper/overlay-dim.ts 纪律）。
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

watch(
  () => props.visible,
  (v) => {
    syncDim(v)
    if (v) {
      restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
      window.addEventListener('keydown', onKey)
      // 焦点进面板本身（tabindex="-1"），不是第一颗按钮 —— 刻意的一步之差：
      // 打开这颗弹窗往往就是按回车按出来的，若焦点落在 ✕ 上，按住回车的
      // 按键重复（keydown 连发）会立刻把这颗确认框又关掉。面板不是激活目标，
      // 读屏靠 aria-label 念出标题；下一个 Tab 才进 ✕、再进正文按钮。
      void nextTick(() => panel.value?.focus())
    } else {
      window.removeEventListener('keydown', onKey)
      if (restoreTo?.isConnected) restoreTo.focus()
      restoreTo = null
    }
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  // 组件被整个卸载时弹窗还开着（路由切走等）：补 pop，否则计数泄漏
  syncDim(false)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="mi-modal-mask" @click.self="close">
        <div
          ref="panel"
          class="mi-modal"
          tabindex="-1"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          :style="{ width: width + 'px' }"
        >
          <div class="mi-modal-head">
            <div class="mi-modal-title">{{ title }}</div>
            <button
              v-if="closable"
              type="button"
              class="mi-modal-close"
              :aria-label="MODAL.CLOSE_TITLE"
              :title="MODAL.CLOSE_TITLE"
              @click="close"
            >
              ✕
            </button>
          </div>
          <div class="mi-modal-body"><slot /></div>
          <div v-if="$slots.footer" class="mi-modal-foot"><slot name="footer" /></div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mi-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--mi-overlay) 35%, transparent);
}
.mi-modal {
  max-width: 92vw;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: var(--mi-bg);
  border-radius: var(--mi-radius-lg);
  box-shadow: 0 12px 40px color-mix(in srgb, var(--mi-overlay) 25%, transparent);
}
/* 面板的 tabindex="-1" 只为接住打开时的焦点（V2-36），不是可见控件：
   给整块面板描一圈焦点环既吵又会随主题变化串味，压掉。 */
.mi-modal:focus {
  outline: none;
}
.mi-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 0;
}
.mi-modal-title {
  font-size: 16px;
  font-weight: 600;
}
.mi-modal-close {
  border: none;
  background: none;
  font-size: 14px;
  color: var(--mi-text-3);
  cursor: var(--mi-cursor, pointer);
  padding: 4px 6px;
  border-radius: 6px;
}
.mi-modal-close:hover {
  background: var(--mi-blue-light);
}
/* 键盘焦点环：全仓按钮的统一约定（2px 笔画色、offset 2px） */
.mi-modal-close:focus-visible {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 2px;
}
.mi-modal-body {
  padding: 16px 20px;
  overflow-y: auto;
  line-height: 1.8;
}
.mi-modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 0 20px 18px;
}
.modal-enter-active,
.modal-leave-active {
  transition: opacity var(--mi-dur) var(--mi-ease-out);
}
.modal-enter-active .mi-modal,
.modal-leave-active .mi-modal {
  transition: transform var(--mi-dur) var(--mi-ease-out);
}
/*
 * 退场那段时间里，遮罩**不许再接点击**。
 *
 * 【为什么】`v-if` 关掉之后元素还要在 DOM 里待完整个过渡（190ms），
 * 而它带着 `position:fixed; inset:0; z-index:9000` —— 这期间它是**盖在整个
 * 应用最上层的一张透明膜**，谁点都点在它身上。两个后果：
 *   · 点别处（`@click.self`）会静默关掉本已经在关的框 —— 看起来"没反应"；
 *   · 更坏的是"关掉这个框、同时弹出下一个遮挡"的流程（阶段卷确认框 → 开始练习
 *     → 答题遮罩，两者都是 9000）：新界面刚出现的那 190ms 里**点什么都不动**，
 *     而它看起来完全正常。这不是理论 —— 退出练习的二次确认就踩过同一脚。
 *
 * 正在离开的界面不该再接收任何输入，所以这里不是"绕过某个 bug"，
 * 而是把这条本来就该成立的规则补上。
 */
.modal-leave-active {
  pointer-events: none;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .mi-modal,
.modal-leave-to .mi-modal {
  transform: scale(0.96);
}
</style>
