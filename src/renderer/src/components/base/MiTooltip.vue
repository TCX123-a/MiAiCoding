<script setup lang="ts">
defineProps<{
  text: string
  position?: 'top' | 'bottom' | 'left' | 'right'
}>()
</script>

<template>
  <span class="mi-tooltip">
    <slot />
    <span class="tip" :class="position ?? 'top'">{{ text }}</span>
  </span>
</template>

<style scoped>
.mi-tooltip {
  position: relative;
  display: inline-flex;
}
.tip {
  position: absolute;
  z-index: 8000;
  padding: 5px 10px;
  font-size: 12px;
  line-height: 1.5;
  white-space: nowrap;
  /* 提示条是一颗**永远深色**的小药丸：浅色下是深藏青、深色下走纯黑底，
     两种主题里字都是白的 —— 这是全仓唯一保留 `#fff` 字面量的地方，
     因为它压的底**不跟主题翻**。对比度由 _verify-contrast.mjs 的「提示条」那条盯着。 */
  color: #fff;
  background: color-mix(in srgb, var(--mi-overlay) 92%, transparent);
  border-radius: 6px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}
.mi-tooltip:hover .tip {
  opacity: 1;
}
.tip.top {
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
}
.tip.bottom {
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
}
.tip.left {
  right: calc(100% + 6px);
  top: 50%;
  transform: translateY(-50%);
}
.tip.right {
  left: calc(100% + 6px);
  top: 50%;
  transform: translateY(-50%);
}
</style>
