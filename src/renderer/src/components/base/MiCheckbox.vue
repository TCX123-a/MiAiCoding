<script setup lang="ts">
defineProps<{
  modelValue: boolean
  label?: string
  disabled?: boolean
}>()

defineEmits<{ 'update:modelValue': [v: boolean] }>()
</script>

<template>
  <label class="mi-checkbox" :class="{ checked: modelValue, disabled }">
    <input
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span class="box">{{ modelValue ? '✓' : '' }}</span>
    <span v-if="label" class="label">{{ label }}</span>
  </label>
</template>

<style scoped>
.mi-checkbox {
  /* 给下面那个「铺满式」的隐形 input 当定位基准（同 MiSwitch.vue） */
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: var(--mi-cursor, pointer);
  font-size: 13px;
}
/*
 * 【为什么不能再用 display:none】（V1-59）
 * 同 MiSwitch.vue 的教训：display:none 的控件收不到焦点，Tab 直接跳过 ——
 * 勾选框就只剩鼠标能碰。改成「视觉上隐形、但仍然是一个真控件」：
 * 铺满整枚勾选框 + opacity:0。它同时接管点击，点哪儿都只触发一次。
 * 【为什么这里可以铺满】label 里没有别的可点东西（MiSwitch 同理）；
 * MiRadio 的行尾有动作插槽（预览按钮），那边就不铺满 —— 见 MiRadio.vue。
 */
.mi-checkbox input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: var(--mi-cursor, pointer);
}
/* 键盘焦点必须看得见（看不见的焦点等于没有焦点）；描边令牌同 MiSwitch：
   --mi-blue-deep 在两个主题下都是 #6faeff，是本项目已有的焦点约定 */
.mi-checkbox input:focus-visible + .box {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 2px;
}
.box {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  /* 勾选后底是 --mi-blue-deep（浅蓝），白勾压在上面只有 2.29 —— 和主按钮同一条毛病 */
  color: var(--mi-on-fill);
  /* V1-60：未勾选态的边界换操作性控件专用描边（对五种底都 ≥3:1）；
     --mi-border 是分隔线色，对纸面只有 1.28:1，管不了点击目标的可发现性 */
  border: 2px solid var(--mi-border-control);
  border-radius: 4px;
  /*
   * 批⑥（2026-10-16）：原先 `transition: all .15s ease`。这个盒子上会变的
   * 只有勾选态的底与描边，点名列出 —— `all` 连圆角都过渡，将来调圆角它会「滑」。
   */
  transition:
    background var(--mi-dur-fast) var(--mi-ease),
    border-color var(--mi-dur-fast) var(--mi-ease);
}
.checked .box {
  background: var(--mi-blue-deep);
  border-color: var(--mi-blue-deep);
}
.mi-checkbox.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
