<script setup lang="ts">
/**
 * 用户头像（2026-10-22 用户系统批次）—— 一条通道吃两种来源：
 *   · hash 有值且取到了 → `<img>`（服务端内容寻址的 PNG）；
 *   · hash 为空 / 没取到 / 断网 → 默认大肥鱼（MiMascot 的 welcome 姿态）。
 *
 * 【为什么默认头像不是「灰色圆 + 首字母」】主人的需求原文：用户没设头像时
 * 必须展示默认的大肥鱼头像。姿态借 welcome（打招呼）—— 与侧栏、账号页
 * 未登录态的形象一致，全站「你是谁」的问题只有一个答案。
 *
 * 【尺寸】px 是**精确像素**：MiMascot 只有五档固定尺寸，这里按最近的档位
 * 渲染再用 transform 缩到目标值 —— 24px 的榜面头像与 84px 的账号页头像都
 * 不会因为档位取整而忽大忽小。图片本身用 object-fit:cover，居中裁圆。
 */
import { computed, watchEffect } from 'vue'
import MiMascot from '../base/MiMascot.vue'
import { MASCOT_SIZE_PX, type MascotPose, type MascotSize } from '../../lib/mascot'
import { useAvatarStore } from '../../stores/avatar'

const props = withDefaults(
  defineProps<{
    /** 服务端头像 hash（64 位 hex）；null/undefined = 没设头像 */
    hash?: string | null
    /** 精确边长（px） */
    px?: number
    /** 无障碍名（一般 = 用户名）；默认空串 = 装饰图 */
    alt?: string
    /** 没有头像时用哪张默认立绘（侧栏未登录态用 guide 指路，其余 welcome） */
    fallbackPose?: MascotPose
  }>(),
  { hash: null, px: 32, alt: '', fallbackPose: 'welcome' }
)

const avatars = useAvatarStore()
const src = computed(() => avatars.srcOf(props.hash))

/**
 * 最近的立绘档位 + 缩放比。读 tick 是为了在 store 重试窗口打开时重新请求
 * （依赖关系本身就是「这个 hash 的图什么时候可能到」）。
 */
const mascot = computed(() => {
  const px = props.px
  const size: MascotSize =
    px <= MASCOT_SIZE_PX.xs
      ? 'xs'
      : px <= MASCOT_SIZE_PX.s
        ? 's'
        : px <= MASCOT_SIZE_PX.m
          ? 'm'
          : px <= MASCOT_SIZE_PX.l
            ? 'l'
            : 'xl'
  return { size, scale: px / MASCOT_SIZE_PX[size] }
})

watchEffect(() => {
  // 读 tick：重试窗口打开后重新发起请求（见 stores/avatar.ts）。
  // Pinia 的 setup store 会解包 ref —— 这里拿到的是 number 本身。
  void avatars.tick
  avatars.request([props.hash])
})

const boxStyle = computed(() => ({ width: `${props.px}px`, height: `${props.px}px` }))
const mascotStyle = computed(() => ({ transform: `scale(${mascot.value.scale})` }))
</script>

<template>
  <span
    class="user-avatar"
    :style="boxStyle"
    :role="alt ? 'img' : undefined"
    :aria-label="alt || undefined"
  >
    <img v-if="src" :src="src" :alt="alt" draggable="false" />
    <span v-else class="user-avatar-fallback" :style="mascotStyle">
      <MiMascot :pose="fallbackPose" :size="mascot.size" />
    </span>
  </span>
</template>

<style scoped>
.user-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 50%;
  overflow: hidden;
  background: var(--mi-bg);
  vertical-align: middle;
}
.user-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.user-avatar-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transform-origin: center;
  /* 缩到目标尺寸后不占额外布局空间：外层 overflow:hidden 负责裁 */
  pointer-events: none;
}
</style>
