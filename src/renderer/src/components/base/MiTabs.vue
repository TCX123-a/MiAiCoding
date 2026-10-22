<script setup lang="ts">
import { ref } from 'vue'
import { tabNavTarget } from '../../lib/tab-nav'

const props = defineProps<{
  tabs: { key: string; label: string }[]
  modelValue: string
  /** 整组禁用（壁纸关着时面板里的分段控件一并灰掉；默认 false 向后兼容） */
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [v: string] }>()

/**
 * ←/→（还带 Home/End）在页签之间**巡回**（⑤ 给排行榜三页签加的键盘路径，
 * 判定逻辑在 lib/tab-nav.ts、单测在那儿）。两件事必须一起做：
 * 换选中态（emit）+ 真把焦点挪过去 —— 只换选中态的话，键盘党按第二下
 * 方向键时焦点还在原来那格，走动的是别人看不见的东西。
 */
const btns = ref<HTMLButtonElement[]>([])

// ref 挂在原生 <button> 上，vue 传进来的就是元素本身，不是组件实例 ——
// 收 unknown 是让 vue-tsc 的 VNodeRef 联合类型（Element | 组件实例）能直接对得上，
// 真正的资格判定只认 instanceof。
function setBtn(el: unknown, i: number): void {
  if (el instanceof HTMLButtonElement) btns.value[i] = el
}

function onKeydown(e: KeyboardEvent, i: number): void {
  const target = tabNavTarget(e.key, i, props.tabs.length)
  if (target === null) return
  // 只有真接管的键才 preventDefault（Tab/Escape 等照常走自己的路）
  e.preventDefault()
  emit('update:modelValue', props.tabs[target].key)
  btns.value[target]?.focus()
}
</script>

<template>
  <div class="mi-tabs" :class="{ 'is-disabled': disabled }">
    <button
      v-for="(t, i) in tabs"
      :key="t.key"
      :ref="(el) => setBtn(el, i)"
      class="mi-tab"
      :class="{ active: modelValue === t.key }"
      :disabled="disabled"
      @click="$emit('update:modelValue', t.key)"
      @keydown="onKeydown($event, i)"
    >
      {{ t.label }}
    </button>
  </div>
</template>

<style scoped>
.mi-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  background: var(--mi-card);
  border-radius: var(--mi-radius-sm);
}
.mi-tab {
  padding: 6px 14px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 13px;
  color: var(--mi-text-2);
  cursor: var(--mi-cursor, pointer);
  /*
   * 批⑥（2026-10-16）：原先 `transition: all .15s ease`。会变的是底与字色；
   * **font-weight 刻意不入列** —— 重量被渐变时字宽一路在抖（150ms 的老毛病），
   * 激活时直接落位反而更利落。`all` 时代它是被顺带过渡的，这里收掉。
   */
  transition:
    background var(--mi-dur-fast) var(--mi-ease),
    color var(--mi-dur-fast) var(--mi-ease);
}
.mi-tab:hover {
  color: var(--mi-text);
}
.mi-tab.active {
  background: var(--mi-blue);
  color: var(--mi-text);
  font-weight: 600;
}
/* 键盘焦点环：与左栏 rail 同一套约定（2px 笔画色、offset 2px）。
   只有 :focus-visible 才画 —— 鼠标点击不弹环，键盘走到才弹。 */
.mi-tab:focus-visible {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 2px;
}
.mi-tab:disabled {
  cursor: default;
  opacity: 0.5;
}
.mi-tabs.is-disabled .mi-tab:hover {
  color: var(--mi-text-2);
}</style>
