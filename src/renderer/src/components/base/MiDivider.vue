<script setup lang="ts">
defineProps<{ text?: string }>()
</script>

<template>
  <div class="mi-divider">
    <span class="line" />
    <span v-if="text" class="text">{{ text }}</span>
    <span v-if="text" class="line" />
  </div>
</template>

<style scoped>
.mi-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 14px 0;
}
.line {
  flex: 1;
  height: 1px;
  background: var(--mi-border);
}
.text {
  font-size: 12px;
  color: var(--mi-text-3);
  white-space: nowrap;
}
</style>
