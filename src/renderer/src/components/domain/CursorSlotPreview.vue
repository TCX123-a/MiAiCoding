<script setup lang="ts">
/**
 * 一个指针槽位的预览 + 落点拾取（v7 模块六，2026-10-31）。
 *
 * 【为什么点预览 = 设落点，而不是拖一个标记】
 * 落点是「图片上的某一个像素」，点击给出的就是这个像素本身；拖动多一层
 * "拖到哪算哪"的模糊感，而指针落点恰恰是最不该模糊的东西。
 *
 * 【预览框为什么正好等于素材的显示尺寸】
 * 如果用一个固定方框 + `object-fit: contain`，点击坐标要先扣掉黑边
 * 才能换算成素材坐标（letterbox 映射），一旦算错，用户设的落点就整体偏移。
 * 这里直接让外框等于素材按比例缩放后的尺寸，点击坐标除以框的宽高就是
 * 归一化坐标 —— 没有第二套映射，也就没有算错的机会。
 */
import { computed, ref, watch } from 'vue'
import { SETTINGS } from '../../lib/copy'
import { autoHotspot, fitSize } from '../../lib/cursor-plan'
import { loadCursorImage } from '../../lib/custom-cursor'
import type { CursorHotspot, CursorSlotView } from '../../../../shared/cursor'

const props = defineProps<{ view: CursorSlotView }>()
const emit = defineEmits<{ pick: [hotspot: CursorHotspot] }>()

/** 预览边长上限（允许放大：16×16 的指针图不放大的话根本没法点准） */
const PREVIEW_MAX = 180
/** 素材还没加载出来时的占位框 */
const PLACEHOLDER = 120

const natural = ref<{ width: number; height: number } | null>(null)
const alpha = ref<Uint8ClampedArray | null>(null)
const imgSrc = ref('')
const failed = ref(false)

/**
 * 键盘落点（2026-10-31 自检 P2）。
 *
 * 【为什么需要】旧实现只有 `@click`：鼠标点哪落点在哪，键盘用户却连预览框都
 * 进不去（`role="img"` + 没有 tabindex）。指针落点是「图片上的某个像素」，
 * 键盘没法一口气指到，所以给一套离散操作：
 *   · 方向键每次移动 5%（Shift + 方向键 1%）；
 *   · 回车/空格 = 把当前落点交给上层（与点击等价的落盘动作）；
 *   · 键盘一动就把落点钉在 `keyHotspot` 上，不再跟随自动算法
 *     （否则「自动落点在尖端」时按一下方向键会从尖端跳走，没有连续感）。
 * 换素材（url 变）时清空 —— 上一张图的落点对这张没有意义。
 */
const keyHotspot = ref<CursorHotspot | null>(null)
const KEY_STEP = 0.05
const KEY_STEP_FINE = 0.01

const shownHotspot = computed<CursorHotspot>(() => keyHotspot.value ?? hotspot.value)

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

function onKeyPick(e: KeyboardEvent): void {
  if (failed.value || !natural.value) return
  const cur = keyHotspot.value ?? { ...hotspot.value }
  const step = e.shiftKey ? KEY_STEP_FINE : KEY_STEP
  switch (e.key) {
    case 'ArrowLeft':
      keyHotspot.value = { x: clamp01(cur.x - step), y: cur.y }
      break
    case 'ArrowRight':
      keyHotspot.value = { x: clamp01(cur.x + step), y: cur.y }
      break
    case 'ArrowUp':
      keyHotspot.value = { x: cur.x, y: clamp01(cur.y - step) }
      break
    case 'ArrowDown':
      keyHotspot.value = { x: cur.x, y: clamp01(cur.y + step) }
      break
    case 'Enter':
    case ' ':
      emit('pick', cur)
      break
    default:
      return
  }
  e.preventDefault()
}

/** 竞态令牌：快速切换素材时，先出发晚返回的加载结果必须丢掉 */
let token = 0

async function loadImage(view: CursorSlotView): Promise<void> {
  const mine = ++token
  const source = await loadCursorImage(view.url)
  if (mine !== token) return
  if (!source) {
    failed.value = true
    return
  }
  imgSrc.value = source.src
  alpha.value = source.alpha
  natural.value = { width: source.width, height: source.height }
}

watch(
  // 只看 url，不看整个 view：点预览改热点时主进程会回一份新对象，
  // 依赖整个对象的话每次点落点都会重新解码图片（预览框闪一下）。
  // kind 不可能脱离 url 单独变 —— url 变了才是"换了素材"。
  () => props.view.url,
  () => {
    natural.value = null
    alpha.value = null
    imgSrc.value = ''
    failed.value = false
    // 换素材：键盘落点也作废（上一张图的相对位置对这张没有意义）
    keyHotspot.value = null
    // 视频的尺寸由 <video> 的 loadedmetadata 提供（解码器才知道真实画面大小）
    if (props.view.kind === 'image') void loadImage(props.view)
  },
  { immediate: true }
)

const box = computed(() => {
  if (!natural.value) return { width: PLACEHOLDER, height: PLACEHOLDER }
  const size = fitSize(natural.value.width, natural.value.height, PREVIEW_MAX, true)
  return size.width > 0 ? size : { width: PLACEHOLDER, height: PLACEHOLDER }
})

/**
 * 现在真正生效的落点：显式值优先；否则和装配器同一套自动算法
 * （图片扫 alpha 尖端，视频落中心）—— 预览与真实行为必须一模一样。
 */
const hotspot = computed<CursorHotspot>(() => {
  if (props.view.hotspot) return props.view.hotspot
  if (!natural.value) return { x: 0.5, y: 0.5 }
  if (props.view.kind === 'video') return { x: 0.5, y: 0.5 }
  return autoHotspot(alpha.value, natural.value.width, natural.value.height)
})

function onVideoMeta(event: Event): void {
  const video = event.target as HTMLVideoElement
  if (video.videoWidth > 0 && video.videoHeight > 0) {
    natural.value = { width: video.videoWidth, height: video.videoHeight }
  }
}

function onPick(event: MouseEvent): void {
  if (failed.value || !natural.value) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  emit('pick', {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
  })
}
</script>

<template>
  <div
    class="cursor-preview"
    :style="{ width: box.width + 'px', height: box.height + 'px' }"
    role="button"
    tabindex="0"
    :aria-label="SETTINGS.CURSOR_PREVIEW_ARIA"
    @click="onPick"
    @keydown="onKeyPick"
  >
    <img
      v-if="view.kind === 'image' && imgSrc"
      :src="imgSrc"
      alt=""
      draggable="false"
    />
    <video
      v-else-if="view.kind === 'video'"
      :src="view.url"
      autoplay
      muted
      loop
      playsinline
      @loadedmetadata="onVideoMeta"
      @error="failed = true"
    />
    <!-- 落点标记。白色圆环 + 深色描边：任何底色上都看得见 -->
    <span
      v-if="!failed"
      class="cursor-hotspot"
      :style="{ left: shownHotspot.x * 100 + '%', top: shownHotspot.y * 100 + '%' }"
    />
    <p v-if="failed" class="cursor-preview-failed">{{ SETTINGS.CURSOR_PREVIEW_FAILED }}</p>
  </div>
</template>

<style scoped>
.cursor-preview {
  position: relative;
  margin: 8px 0 4px;
  border: 1px dashed var(--mi-border);
  border-radius: var(--mi-radius-sm);
  cursor: var(--mi-cursor, pointer);
  /* 透明棋盘格：透明背景的指针图放上来才分得清"空白"和"白色" */
  background-color: var(--mi-bg);
  background-image:
    linear-gradient(45deg, rgba(127, 127, 127, 0.16) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(127, 127, 127, 0.16) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(127, 127, 127, 0.16) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(127, 127, 127, 0.16) 75%);
  background-size: 12px 12px;
  background-position: 0 0, 0 6px, 6px -6px, -6px 0;
}
/* 键盘焦点环：与全仓按钮同一套约定（2px 笔画色、offset 2px） */
.cursor-preview:focus-visible {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 2px;
}
.cursor-preview img,
.cursor-preview video {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: var(--mi-radius-sm);
  user-select: none;
  pointer-events: none;
}
.cursor-hotspot {
  position: absolute;
  width: 14px;
  height: 14px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: rgba(43, 95, 217, 0.55);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.65);
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.cursor-preview-failed {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  margin: 0;
  padding: 0 10px;
  font-size: 12px;
  color: var(--mi-text-3);
  text-align: center;
}
</style>
