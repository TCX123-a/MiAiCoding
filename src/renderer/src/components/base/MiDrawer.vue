<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'

import { wallpaperOverlayDim } from '../../lib/wallpaper/overlay-dim'

const props = withDefaults(
  defineProps<{
    visible: boolean
    title?: string
    width?: number
    closable?: boolean
  }>(),
  { width: 380, closable: true }
)

const emit = defineEmits<{ 'update:visible': [v: boolean]; close: [] }>()

function close() {
  if (!props.closable) return
  emit('update:visible', false)
  emit('close')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

/**
 * 浮层计数配对位（2026-10-08 体感卡顿修复）：抽屉开着时告诉壁纸层降级，
 * 关闭即恢复。push/pop 必须严格成对（见 lib/wallpaper/overlay-dim.ts 纪律）。
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
    if (v) window.addEventListener('keydown', onKey)
    else window.removeEventListener('keydown', onKey)
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  // 组件整个卸载时抽屉还开着：补 pop，否则计数泄漏（背景永久降级）
  syncDim(false)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="visible" class="mi-drawer-mask" @click.self="close">
        <div class="mi-drawer" :style="{ width: width + 'px' }">
          <div class="mi-drawer-head">
            <div class="mi-drawer-title">{{ title }}</div>
            <button v-if="closable" class="mi-drawer-close" @click="close">✕</button>
          </div>
          <div class="mi-drawer-body"><slot /></div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mi-drawer-mask {
  position: fixed;
  inset: 0;
  z-index: 9000;
  background: color-mix(in srgb, var(--mi-overlay) 25%, transparent);
}
.mi-drawer {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--mi-bg);
  box-shadow: -6px 0 24px color-mix(in srgb, var(--mi-overlay) 15%, transparent);
}
.mi-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 10px;
  border-bottom: 1px solid var(--mi-border);
}
.mi-drawer-title {
  font-size: 16px;
  font-weight: 600;
}
.mi-drawer-close {
  border: none;
  background: none;
  font-size: 14px;
  color: var(--mi-text-3);
  cursor: var(--mi-cursor, pointer);
  padding: 4px 6px;
  border-radius: 6px;
}
.mi-drawer-close:hover {
  background: var(--mi-blue-light);
}
.mi-drawer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px;
  line-height: 1.8;
}
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity var(--mi-dur) var(--mi-ease-out);
}
.drawer-enter-active .mi-drawer,
.drawer-leave-active .mi-drawer {
  transition: transform var(--mi-dur) var(--mi-ease-out);
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
.drawer-enter-from .mi-drawer,
.drawer-leave-to .mi-drawer {
  transform: translateX(40px);
}
</style>
