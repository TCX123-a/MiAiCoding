<script setup lang="ts">
defineProps<{
  options: { label: string; value: string }[]
  modelValue: string
  placeholder?: string
  disabled?: boolean
}>()

defineEmits<{ 'update:modelValue': [v: string] }>()
</script>

<template>
  <select
    class="mi-select"
    :class="{ disabled }"
    :value="modelValue"
    :disabled="disabled"
    @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
  >
    <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
    <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
  </select>
</template>

<style scoped>
.mi-select {
  padding: 7px 10px;
  font-size: 13px;
  font-family: var(--mi-font);
  color: var(--mi-text);
  background: var(--mi-bg);
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  outline: none;
  cursor: var(--mi-cursor, pointer);
  transition: border-color 0.15s ease;
}
.mi-select:focus {
  border-color: var(--mi-blue-deep);
}
.mi-select.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
