<script setup lang="ts">
defineProps<{
  options: { label: string; value: string }[]
  modelValue: string
  disabled?: boolean
}>()

defineEmits<{ 'update:modelValue': [v: string] }>()

/**
 * 行尾动作插槽（可选）—— 2026-10-06 开屏「播放哪段」用它挂「预览」小按钮：
 * 单选行与预览入口必须在同一行，否则又要回到「预览藏哪儿了」的老问题。
 * 插槽渲染在 label 内部、`.label` 之后；点按钮的处理器请自带 `.stop`。
 */
defineSlots<{ action?: (props: { option: { label: string; value: string } }) => unknown }>()
</script>

<template>
  <div class="mi-radio-list">
    <label
      v-for="o in options"
      :key="o.value"
      class="mi-radio"
      :class="{ checked: modelValue === o.value, disabled }"
    >
      <input
        type="radio"
        :value="o.value"
        :checked="modelValue === o.value"
        :disabled="disabled"
        @change="$emit('update:modelValue', o.value)"
      />
      <span class="dot" />
      <span class="label">{{ o.label }}</span>
      <slot name="action" :option="o" />
    </label>
  </div>
</template>

<style scoped>
.mi-radio-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mi-radio {
  /* 给下面那个隐形 input 当定位基准（同 MiSwitch.vue） */
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  cursor: var(--mi-cursor, pointer);
  font-size: 13px;
}
/*
 * 【为什么不能再用 display:none】（V1-59）
 * 同 MiSwitch.vue 的教训：隐形输入收不到焦点，Tab 直接跳过 —— 单选就只剩
 * 鼠标能碰。但**这里不抄「铺满整行」**：行尾动作插槽（开屏「预览」按钮）
 * 也住在 label 里，而绝对定位的 input 会画在静态定位的按钮之上、把它的
 * 点击整个吞掉（预览按不动、行反被选中）。所以隐形 input 只占 1×1：
 * 键盘照样 Tab 得到、Space 能切换；鼠标点哪儿由 label 转发给 input ——
 * 与 display:none 时代的手感逐字一致。
 */
.mi-radio input {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  cursor: var(--mi-cursor, pointer);
}
/* 键盘焦点必须看得见；描边令牌同 MiSwitch（--mi-blue-deep，两主题同色） */
.mi-radio input:focus-visible + .dot {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 2px;
}
/* 名称吃剩余宽度、行尾插槽贴右边（flex:1 + min-width:0 是省略号生效的开关） */
.label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dot {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  /* V1-60：同 MiCheckbox —— 可操作控件的边界走专用描边（≥3:1） */
  border: 2px solid var(--mi-border-control);
  border-radius: 50%;
  position: relative;
  /*
   * 批⑥（2026-10-16）：原先 `transition: all .15s ease`。会变的只有选中态的
   * 边框色（内点 ::after 本来就不吃 .dot 的 transition，保持瞬现）。点名列出。
   */
  transition: border-color var(--mi-dur-fast) var(--mi-ease);
}
.checked .dot {
  border-color: var(--mi-blue-deep);
}
.checked .dot::after {
  content: '';
  position: absolute;
  inset: 2px;
  border-radius: 50%;
  background: var(--mi-blue-deep);
}
/* ⚠️ 原选择器写的是 `.radio.disabled`，而类名是 `.mi-radio` —— 从来没命中过
   （这个组件此前无人使用，坏样式一直没人看见）。本次启用顺手改成真类名。 */
.mi-radio.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
