<script setup lang="ts">
withDefaults(
  defineProps<{
    percent: number
    showLabel?: boolean
    color?: string
    height?: number
  }>(),
  { showLabel: false, height: 8 }
)
</script>

<template>
  <div class="mi-progress">
    <div class="mi-progress-track" :style="{ height: height + 'px' }">
      <div
        class="mi-progress-fill"
        :style="{
          width: Math.min(100, Math.max(0, percent)) + '%',
          height: height + 'px',
          background: color ?? 'var(--mi-blue-deep)'
        }"
      />
    </div>
    <span v-if="showLabel" class="mi-progress-label">{{ percent }}%</span>
  </div>
</template>

<style scoped>
.mi-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mi-progress-track {
  flex: 1;
  background: var(--mi-blue-light);
  border-radius: 999px;
  overflow: hidden;
}
.mi-progress-fill {
  border-radius: 999px;
  transition: width 0.3s ease;
}
.mi-progress-label {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--mi-text-2);
}
</style>
