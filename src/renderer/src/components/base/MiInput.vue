<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    type?: string
    disabled?: boolean
    width?: string
    /** 多行：渲染成 `<textarea>`，换行变成**内容**，Enter 不再当提交 */
    multiline?: boolean
    /** 多行时的可见行数（超出会滚动） */
    rows?: number
  }>(),
  { rows: 4 }
)

const emit = defineEmits<{ 'update:modelValue': [v: string]; enter: [] }>()

/**
 * 单行 `/` 多行共用**同一个根槽位**。
 *
 * 【为什么不是 `v-if` 两个根】
 * 两个根节点会让 Vue 关掉属性透传，而调用方（`QuizCode.vue`）正是靠透传把
 * `readonly` 和红绿描边的 `class` 挂上来的 —— 拆成两个根，提交后输入框**锁不上**，
 * 学员能接着改一个已经判过的答案。
 */
const tag = computed(() => (props.multiline ? 'textarea' : 'input'))

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement | HTMLTextAreaElement).value)
}

/**
 * Enter 的两种含义。
 *
 * 单行：Enter = 提交（原有行为，一字未改）。
 * 多行：Enter = **换行** —— 学员要打的就是一段好几行的输出，把换行吞掉这题就没法答了。
 *       提交改走 Ctrl+Enter（下面的按钮一直在，不依赖这条捷径）。
 */
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter') return
  if (props.multiline && !e.ctrlKey) return
  emit('enter')
}
</script>

<template>
  <component
    :is="tag"
    class="mi-input"
    :class="{ disabled }"
    :type="multiline ? undefined : (type ?? 'text')"
    :rows="multiline ? rows : undefined"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :style="width ? { width } : undefined"
    @input="onInput"
    @keydown="onKeydown"
  />
</template>

<style scoped>
.mi-input {
  padding: 7px 12px;
  font-size: 13px;
  font-family: var(--mi-font);
  color: var(--mi-text);
  background: var(--mi-bg);
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.mi-input:focus {
  border-color: var(--mi-blue-deep);
  box-shadow: 0 0 0 3px var(--mi-blue-light);
}
.mi-input::placeholder {
  color: var(--mi-text-3);
}
.mi-input.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 多行档：等宽字体（打的是程序输出，本来就该对齐），纵向可拉，别把换行藏起来 */
textarea.mi-input {
  display: block;
  box-sizing: border-box;
  font-family: var(--mi-code);
  line-height: 1.6;
  resize: vertical;
  min-height: 72px;
  white-space: pre;
}
</style>
