<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    percent: number
    size?: number
    stroke?: number
    label?: string
  }>(),
  { size: 72, stroke: 6 }
)

const r = computed(() => (props.size - props.stroke) / 2)
const c = computed(() => 2 * Math.PI * r.value)
const pct = computed(() => Math.min(100, Math.max(0, props.percent)))
const dash = computed(() => `${(pct.value / 100) * c.value} ${c.value}`)
</script>

<template>
  <div class="mi-ring" :style="{ width: size + 'px', height: size + 'px' }">
    <svg :width="size" :height="size">
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="r"
        fill="none"
        stroke="var(--mi-blue-light)"
        :stroke-width="stroke"
      />
      <circle
        class="ring-fill"
        :cx="size / 2"
        :cy="size / 2"
        :r="r"
        fill="none"
        stroke="var(--mi-blue-deep)"
        :stroke-width="stroke"
        stroke-linecap="round"
        :stroke-dasharray="dash"
        transform="rotate(-90)"
        :transform-origin="`${size / 2}px ${size / 2}px`"
      />
    </svg>
    <div class="mi-ring-label">{{ label ?? pct + '%' }}</div>
  </div>
</template>

<style scoped>
.mi-ring {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.mi-ring-label {
  position: absolute;
  font-size: 13px;
  font-weight: 700;
  color: var(--mi-text);
}
.ring-fill {
  transition: stroke-dasharray 0.3s ease;
}
</style>
