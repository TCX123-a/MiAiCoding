<script setup lang="ts">
defineProps<{
  modelValue: boolean
  label?: string
  disabled?: boolean
}>()

defineEmits<{ 'update:modelValue': [v: boolean] }>()
</script>

<template>
  <label class="mi-switch" :class="{ on: modelValue, disabled }">
    <input
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span class="track"><span class="thumb" /></span>
    <span v-if="label" class="label">{{ label }}</span>
  </label>
</template>

<style scoped>
.mi-switch {
  /* 给下面那个「铺满式」的隐形 input 当定位基准 */
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: var(--mi-cursor, pointer);
  font-size: 13px;
}
/*
 * 【为什么不能再用 display:none】
 * 那一条会把**键盘用户整个挡在外面**：`display:none` 的元素收不到焦点，
 * Tab 直接跳过它，开关就只剩鼠标能碰。
 * 2026-09-20 实测：对 input 调 `focus()` 之后 `document.activeElement` 仍是 `BODY` ——
 * 焦点压根没落上去。（换成 MiSwitch 之前那三个裸 checkbox 是能 Tab 到的，
 * 所以这是我换组件时引入的退化。）
 *
 * 现在改成「视觉上隐形、但仍然是一个真控件」：铺满整个开关 + `opacity: 0`。
 * 它同时接管了点击；`.track` 在 DOM 里排在它后面、又是定位元素，
 * 所以画在它上面——点药丸那条路照旧，两种点法都只触发一次。
 */
.mi-switch input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: var(--mi-cursor, pointer);
}
/*
 * 键盘焦点必须**看得见** —— 看不见的焦点等于没有焦点。
 * `:focus-visible` 只在键盘操作时亮，鼠标点不会闪圈。
 * input 和 .track 是紧挨着的兄弟，用 `+` 就够，不必上 `:has()`。
 *
 * 【⚠️ 这里第一版写的是 `var(--mi-blue)`，是个**真错**，2026-09-21 实测抓出来的】
 * 那个令牌在深色下是 `#263d57`（tokens.css:349）—— 它是**当底色用的**
 * （tokens.css:483 就是 `background: var(--mi-blue)`），不是当笔画用的。
 * 拿它画焦点环 = 深藏青压在深色画布上，**焦点环等于不存在**。
 * 实测那次的 `outlineColor` 打出 `rgb(38, 61, 87)`，一眼就能看出不对。
 *
 * 现在改用 `--mi-blue-deep`：它在**浅色和深色下都是 `#6faeff`**（tokens.css:8 / 354），
 * 而且这正是本项目**已有的焦点约定** —— `MiInput:focus`、`MiSelect:focus`、
 * 还有 App.vue 里 splitter 的 `:focus-visible`，用的都是它。
 * 抄现成的，不另发明一个。
 */
.mi-switch input:focus-visible + .track {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 2px;
}
.track {
  width: 38px;
  height: 20px;
  flex-shrink: 0;
  position: relative;
  /* 原先是写死的 #d7e2ec（浅色下和 --mi-border #dae5f0 只差 3/255，肉眼分不出）。
     深色下必须是暗色，否则那个「关」的开关是一颗亮白药丸。 */
  background: var(--mi-border);
  border-radius: 999px;
  transition: background 0.2s ease;
}
.thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  /* 浅色下 --mi-bg 就是 #ffffff，逐字节不变；深色下是浮层最亮那层，滑钮照样看得见 */
  background: var(--mi-bg);
  border-radius: 50%;
  box-shadow: 0 1px 3px color-mix(in srgb, var(--mi-overlay) 30%, transparent);
  transition: transform 0.2s ease;
}
.on .track {
  background: var(--mi-blue-deep);
}
.on .thumb {
  transform: translateX(18px);
}
.mi-switch.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
