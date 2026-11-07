<script setup lang="ts">
/**
 * 设置页的「自定义鼠标指针」卡片正文（v7 模块六，2026-10-31）。
 *
 * 两个槽位、四类动作（导入 / 清除 / 点预览定落点 / 交还自动定位）。
 * 每次写成功都拿主进程回的**完整新状态**，顺手调 applyCustomCursorState，
 * 所以设置页上改完立刻就能看到效果 —— 不用重启，也不用等下一次启动。
 *
 * 【为什么清除不弹二次确认】这里的"清除"只是把**应用自己拷贝的那一份**忘掉，
 * 用户自己的源文件还在原处；重新选一次就回来了。为一个可逆动作加确认框，
 * 只会练出"看到确认框就点确定"的肌肉记忆（真正危险的删除反而没人细看）。
 *
 * 【为什么按钮的 loading 按槽位分开】两个槽位是独立的两件事；
 * 给上面换图的时候，下面那个「恢复默认」不该跟着转圈。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import MiButton from '../base/MiButton.vue'
import { toast } from '../base/toast'
import { SETTINGS } from '../../lib/copy'
import { applyCustomCursorState, ensureCustomCursor } from '../../lib/custom-cursor'
import type {
  CursorHotspot,
  CursorOpResult,
  CursorSlot,
  CursorSlotView,
  CursorStateView
} from '../../../../shared/cursor'
import CursorSlotPreview from './CursorSlotPreview.vue'

const SLOTS: { key: CursorSlot; label: string }[] = [
  { key: 'normal', label: SETTINGS.CURSOR_LABEL_NORMAL },
  { key: 'click', label: SETTINGS.CURSOR_LABEL_CLICK }
]

const state = ref<CursorStateView | null>(null)
const busy = reactive<Record<CursorSlot, boolean>>({ normal: false, click: false })

const hasVideo = computed(
  () => state.value?.normal?.kind === 'video' || state.value?.click?.kind === 'video'
)

onMounted(async () => {
  state.value = await ensureCustomCursor()
})

const hasSlot = (slot: CursorSlot): boolean => !!state.value?.[slot]

/** 只在 `hasSlot(slot)` 为真的模板块里调用（状态还没读回来时不会渲染这些块） */
const viewOf = (slot: CursorSlot): CursorSlotView => state.value![slot]!

function stateText(view: CursorSlotView | null): string {
  if (!view) return ''
  return view.kind === 'image'
    ? SETTINGS.CURSOR_KIND_IMAGE(view.file)
    : SETTINGS.CURSOR_KIND_VIDEO(view.file)
}

/** 成功后统一换上主进程回的新状态并立即应用 */
async function adopt(next: CursorStateView): Promise<void> {
  state.value = next
  await applyCustomCursorState(next)
}

function toastImportFailure(result: Extract<CursorOpResult, { ok: false }>): void {
  if (result.reason === 'bad-ext') toast(SETTINGS.CURSOR_IMPORT_BAD_EXT, 'warn')
  else if (result.reason === 'too-small') toast(SETTINGS.CURSOR_IMPORT_TOO_SMALL, 'warn')
  else if (result.reason === 'too-large') toast(SETTINGS.CURSOR_IMPORT_TOO_LARGE, 'warn')
  else if (result.reason !== 'cancelled') {
    toast(SETTINGS.CURSOR_IMPORT_FAILED(result.message ?? ''), 'error')
  }
}

async function onImport(slot: CursorSlot): Promise<void> {
  if (busy[slot]) return
  busy[slot] = true
  try {
    const result = await window.miai.cursor.import(slot)
    if (!result.ok) {
      toastImportFailure(result)
      return
    }
    await adopt(result.state)
    toast(SETTINGS.CURSOR_IMPORT_OK(result.state[slot]?.file ?? ''), 'success')
  } catch (err) {
    // 走到这里基本是我们自己的形状 bug（槽位名不认识等）；照实报，不假装成功
    console.warn('[cursor] import failed:', err)
    toast(SETTINGS.CURSOR_IMPORT_FAILED(err instanceof Error ? err.message : String(err)), 'error')
  } finally {
    busy[slot] = false
  }
}

async function onClear(slot: CursorSlot): Promise<void> {
  if (busy[slot]) return
  busy[slot] = true
  try {
    const result = await window.miai.cursor.clear(slot)
    if (!result.ok) {
      toast(SETTINGS.CURSOR_STORE_FAILED, 'error')
      return
    }
    await adopt(result.state)
    toast(SETTINGS.CURSOR_CLEAR_OK, 'success')
  } catch (err) {
    console.warn('[cursor] clear failed:', err)
    toast(SETTINGS.CURSOR_STORE_FAILED, 'error')
  } finally {
    busy[slot] = false
  }
}

async function writeHotspot(slot: CursorSlot, hotspot: CursorHotspot | null): Promise<void> {
  if (busy[slot]) return
  busy[slot] = true
  try {
    const result = await window.miai.cursor.updateHotspot(slot, hotspot)
    if (!result.ok) {
      toast(SETTINGS.CURSOR_STORE_FAILED, 'error')
      return
    }
    await adopt(result.state)
  } catch (err) {
    console.warn('[cursor] update hotspot failed:', err)
    toast(SETTINGS.CURSOR_STORE_FAILED, 'error')
  } finally {
    busy[slot] = false
  }
}

function onPick(slot: CursorSlot, hotspot: CursorHotspot): void {
  void writeHotspot(slot, hotspot)
}
</script>

<template>
  <div v-for="slot in SLOTS" :key="slot.key" class="cursor-slot">
    <div class="cursor-slot-head">
      <span class="cursor-slot-label">{{ slot.label }}</span>
      <div class="cursor-slot-actions">
        <MiButton size="sm" :loading="busy[slot.key]" @click="onImport(slot.key)">
          {{ hasSlot(slot.key) ? SETTINGS.CURSOR_BTN_REPLACE : SETTINGS.CURSOR_BTN_UPLOAD }}
        </MiButton>
        <MiButton
          v-if="hasSlot(slot.key)"
          size="sm"
          variant="ghost"
          :disabled="busy[slot.key]"
          @click="onClear(slot.key)"
        >
          {{ SETTINGS.CURSOR_BTN_CLEAR }}
        </MiButton>
      </div>
    </div>

    <p v-if="!hasSlot(slot.key)" class="hint">{{ SETTINGS.CURSOR_EMPTY }}</p>
    <template v-else>
      <div class="cursor-slot-meta">
        <span class="cursor-slot-name">{{ stateText(viewOf(slot.key)) }}</span>
        <MiButton
          size="sm"
          variant="secondary"
          :disabled="busy[slot.key] || viewOf(slot.key).hotspot === null"
          @click="writeHotspot(slot.key, null)"
        >
          {{ SETTINGS.CURSOR_BTN_AUTO }}
        </MiButton>
      </div>
      <CursorSlotPreview
        :view="viewOf(slot.key)"
        @pick="(hotspot: CursorHotspot) => onPick(slot.key, hotspot)"
      />
      <p class="hint">
        {{ viewOf(slot.key).hotspot === null ? SETTINGS.CURSOR_HOTSPOT_AUTO : SETTINGS.CURSOR_HOTSPOT_MANUAL }}
      </p>
      <p class="hint">{{ SETTINGS.CURSOR_HOTSPOT_CLICK_HINT }}</p>
    </template>
  </div>

  <p class="hint">{{ SETTINGS.CURSOR_HINT }}</p>
  <p v-if="hasVideo" class="hint cursor-video-hint">{{ SETTINGS.CURSOR_VIDEO_HINT }}</p>
</template>

<style scoped>
.cursor-slot {
  padding: 4px 0 10px;
}
.cursor-slot + .cursor-slot {
  border-top: 1px dashed var(--mi-border);
  padding-top: 12px;
}
.cursor-slot-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.cursor-slot-label {
  color: var(--mi-text-2);
}
.cursor-slot-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cursor-slot-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 6px;
  font-size: 13px;
  color: var(--mi-text-2);
}
.cursor-slot-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cursor-video-hint {
  color: var(--mi-text-3);
}
</style>
