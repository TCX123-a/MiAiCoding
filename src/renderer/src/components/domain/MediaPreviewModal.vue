<script setup lang="ts">
/**
 * 媒体预览悬浮卡（2026-10-06，主人点名：壁纸与开屏动画要能提前预览，
 * 别每次都启动应用去试）。
 *
 * 【形态】MiModal 悬浮卡（宽 560、ESC/点遮罩即关）—— 不新开窗口：
 * 打开独立 BrowserWindow 要过主进程、还要复刻主题与 i18n，成本高且没有收益；
 * 而 miai-wall: 协议早就在渲染层的 CSP 白名单里（media-src/img-src），
 * 主窗口里直接播是零新增基础设施的路。
 *
 * 【宿主负责解析】本组件只吃**已拼好的 URL** 与 kind，不碰目录/清单逻辑
 * （那些在 lib/wallpaper/preview.ts，纯函数可测）。note 是宿主翻译好的
 * 诚实说明（场景壁纸只有海报图时别让用户以为预览坏了）。
 *
 * 【自动播放】muted 起步是 autoplay 策略的硬要求（带声音的自动播放会被
 * 浏览器拒）；controls 留给用户自己开声音。关窗立即 pause：退场过渡还有
 * 190ms，不暂停的话声音会多响一小截。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫：字符串一律走 copy，中文只在注释里。
 */
import { nextTick, ref, watch } from 'vue'
import { SETTINGS } from '../../lib/copy'
import MiModal from '../base/MiModal.vue'

const props = defineProps<{
  visible: boolean
  /** 已解析的 miai-wall:// URL（'' 时不出媒体，宿主不该这么开） */
  src: string
  kind: 'video' | 'image'
  /** 卡片标题（条目名） */
  title: string
  /** 诚实说明；不传则不显示 */
  note?: string
}>()

const emit = defineEmits<{ 'update:visible': [v: boolean] }>()

const videoEl = ref<HTMLVideoElement | null>(null)

watch(
  () => props.visible,
  async (v) => {
    if (!v) {
      videoEl.value?.pause()
      return
    }
    // 属性归属性、property 归 property：某些 Chromium 版本里动态创建的
    // <video muted> 只带内容属性不看 property，autoplay 会被策略拒 ——
    // 打开时显式写一次 property 再 play（play 失败无所谓，controls 在，
    // 用户可以自己点）。
    await nextTick()
    const el = videoEl.value
    if (el) {
      el.muted = true
      void el.play().catch(() => {})
    }
  },
  { immediate: true }
)
</script>

<template>
  <MiModal
    :visible="visible"
    :title="SETTINGS.WALL_PREVIEW_TITLE(title)"
    :width="560"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="pv-stage">
      <video
        v-if="kind === 'video'"
        ref="videoEl"
        class="pv-media"
        :src="src"
        autoplay
        loop
        muted
        controls
        playsinline
      ></video>
      <img v-else class="pv-media" :src="src" alt="" />
    </div>
    <p v-if="note" class="pv-note">{{ note }}</p>
  </MiModal>
</template>

<style scoped>
/* ⚠️ 不写 opacity 声明、不写玻璃令牌（wall-glass.test.ts 的快照闸门盯着全库） */
.pv-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--mi-overlay);
  border-radius: var(--mi-radius-sm);
  overflow: hidden;
}
.pv-media {
  display: block;
  max-width: 100%;
  max-height: 58vh;
}
.pv-note {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--mi-text-3);
}
</style>
