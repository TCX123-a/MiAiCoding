<script setup lang="ts">
/**
 * 猫咪对话气泡（docs/10-大肥鱼视觉宪法.md 的 UI 规范）：
 * 边框 #1C2833 实线 2px、填充纯白、文字深蓝 Bold；
 * think：云朵形气泡 + 左下角三个递减空心圆；surprise：边缘黄色放射线 #F4D03F。
 *
 * 【2026-09-20 夜间模式】上面那几个色值从这一版起走令牌：底 = --mi-bg（浅色下正好
 * 就是纯白）、描边与文字 = --mi-bubble-ink、放射线 = --mi-warn。
 * 浅色观感逐字节不变；深色下白纸片变成深纸片、藏青描边翻成浅色，气泡照样立得住。
 */
defineProps<{
  variant?: 'speak' | 'think' | 'surprise'
}>()
</script>

<template>
  <div class="mi-bubble" :class="variant ?? 'speak'">
    <!-- 思考气泡：云朵形突起 -->
    <div v-if="variant === 'think'" class="cloud-bumps">
      <span class="bump" style="width: 22px; height: 22px" />
      <span class="bump" style="width: 15px; height: 15px" />
      <span class="bump" style="width: 11px; height: 11px" />
    </div>

    <div class="bubble-body">
      <slot />
    </div>

    <!-- 思考气泡：左下角三个递减空心圆 -->
    <div v-if="variant === 'think'" class="think-dots">
      <span class="dot" style="width: 12px; height: 12px" />
      <span class="dot" style="width: 9px; height: 9px" />
      <span class="dot" style="width: 6px; height: 6px" />
    </div>

    <!-- 惊讶气泡：边缘黄色放射线 -->
    <div v-if="variant === 'surprise'" class="rays">
      <span v-for="i in 8" :key="i" class="ray" :style="{ transform: `rotate(${(i - 1) * 45}deg) translateY(-14px)` }" />
    </div>
  </div>
</template>

<style scoped>
.mi-bubble {
  position: relative;
  display: inline-block;
}
.bubble-body {
  position: relative;
  /* 底用 --mi-bg：浅色下它正好是 #ffffff（逐字节不变），深色下自动变成最亮那层浮层。
     描边走令牌，深色下翻成浅色，否则白气泡在深卡片上没有边。 */
  background: var(--mi-bg);
  border: 2px solid var(--mi-bubble-ink);
  border-radius: 14px;
  padding: 9px 14px;
  color: var(--mi-bubble-ink);
  font-weight: 700;
  font-size: 13px;
  line-height: 1.6;
}
/* 指向左侧形象的尖角尾巴 */
.mi-bubble.speak .bubble-body::after,
.mi-bubble.surprise .bubble-body::after {
  content: '';
  position: absolute;
  left: 14px;
  bottom: -8px;
  width: 12px;
  height: 12px;
  background: var(--mi-bg);
  border-right: 2px solid var(--mi-bubble-ink);
  border-bottom: 2px solid var(--mi-bubble-ink);
  transform: rotate(45deg);
}

/* 云朵形突起（绘制在气泡主体之前，被主体遮住内半侧） */
.cloud-bumps {
  position: absolute;
  left: 0;
  right: 0;
  top: -11px;
  display: flex;
  justify-content: center;
  gap: 7px;
}
.bump {
  background: var(--mi-bg);
  border: 2px solid var(--mi-bubble-ink);
  border-radius: 50%;
}

.think-dots {
  position: absolute;
  left: 8px;
  bottom: -20px;
  display: flex;
  align-items: center;
  gap: 5px;
}
.dot {
  display: inline-block;
  background: var(--mi-bg);
  border: 2px solid var(--mi-bubble-ink);
  border-radius: 50%;
}

.rays {
  position: absolute;
  inset: -10px;
  pointer-events: none;
}
.ray {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 12px;
  height: 3px;
  margin-left: -6px;
  margin-top: -1.5px;
  /* 原先是写死的 #f4d03f。用 --mi-warn：它深浅两色正好是同一个值，
     所以这条既跟着主题语义走，又不会在深色下变成一道扎眼的亮黄。 */
  background: var(--mi-warn);
  border-radius: 2px;
  transform-origin: center;
}
</style>
