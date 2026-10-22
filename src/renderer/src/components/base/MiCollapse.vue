<script setup lang="ts">
defineProps<{
  modelValue: boolean
  title: string
}>()

defineEmits<{ 'update:modelValue': [v: boolean] }>()
</script>

<template>
  <div class="mi-collapse">
    <button class="head" @click="$emit('update:modelValue', !modelValue)">
      <span class="arrow" :class="{ open: modelValue }">▸</span>
      <span class="title">{{ title }}</span>
    </button>
    <div v-show="modelValue" class="body"><slot /></div>
  </div>
</template>

<style scoped>
.mi-collapse {
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  background: var(--mi-card);
  overflow: hidden;
}
.head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: none;
  background: none;
  cursor: var(--mi-cursor, pointer);
  font-family: var(--mi-font);
  font-size: 13px;
  color: var(--mi-text);
}
.head:hover {
  background: var(--mi-blue-light);
}
.arrow {
  font-size: 11px;
  color: var(--mi-text-3);
  transition: transform 0.2s ease;
}
.arrow.open {
  transform: rotate(90deg);
}
.title {
  font-weight: 600;
}
.body {
  padding: 4px 14px 14px 32px;
  font-size: 13px;
  color: var(--mi-text-2);
  line-height: 1.9;
}
</style>
