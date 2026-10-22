<script setup lang="ts">
defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
}>()

defineEmits<{ click: [e: MouseEvent] }>()
</script>

<template>
  <button
    class="mi-btn"
    :class="[variant ?? 'primary', size ?? 'md']"
    :disabled="disabled || loading"
    @click="$emit('click', $event)"
  >
    <!-- `mi-motion-keep` 是「减弱动效」总闸的放行条：转圈必须一直转下去，
         停住的转圈图标和「这个按钮卡死了」长得一模一样。见 styles/motion.css -->
    <span v-if="loading" class="spinner mi-motion-keep" />
    <slot />
  </button>
</template>

<style scoped>
.mi-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid transparent;
  border-radius: var(--mi-radius-sm);
  cursor: var(--mi-cursor, pointer);
  font-family: var(--mi-font);
  /*
   * 批⑥（2026-10-16）：原先 `transition: all .15s ease`，展开成具名属性 ——
   * `all` 会连 padding/字号这些「没打算动的东西」一起过渡，将来谁调一下尺寸，
   * 按钮会自己「滑」过去。列出的就是这套按钮真的会变的：四种 variant 的底/字/边、
   * 填色按钮 hover 的 filter、禁用态的 opacity、按下的 transform。
   */
  transition:
    background var(--mi-dur-fast) var(--mi-ease),
    color var(--mi-dur-fast) var(--mi-ease),
    border-color var(--mi-dur-fast) var(--mi-ease),
    filter var(--mi-dur-fast) var(--mi-ease),
    opacity var(--mi-dur-fast) var(--mi-ease),
    transform var(--mi-dur-fast) var(--mi-ease);
  user-select: none;
}
.mi-btn:active:not(:disabled) {
  transform: translateY(1px);
}
.mi-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sm {
  padding: 4px 12px;
  font-size: 12px;
}
.md {
  padding: 8px 18px;
  font-size: 14px;
}
.lg {
  padding: 11px 26px;
  font-size: 15px;
}

/*
 * 填色按钮上的字色 = --mi-on-fill，**不是白字**。
 *
 * 【为什么】--mi-blue-deep(#6faeff) 和 --mi-error(#ff9a9e) 都是**浅色填充**，
 * 白字压在上面只有 2.29 / 2.03 —— 比「不达标」还难看（主人点名要修的就是这条）。
 * #36414f 压主按钮 4.53 ✓、压危险按钮 4.68 ✓，而且带一点蓝灰，
 * 比纯黑柔和，配得上「猫窝浅蓝」的调性。详见 tokens.css 里 --mi-on-fill 的说明。
 */
.primary {
  background: var(--mi-blue-deep);
  color: var(--mi-on-fill);
}
.primary:hover:not(:disabled) {
  filter: brightness(0.95);
}
.secondary {
  background: var(--mi-bg);
  border-color: var(--mi-border);
  color: var(--mi-text);
}
.secondary:hover:not(:disabled) {
  background: var(--mi-blue-light);
}
.ghost {
  background: transparent;
  color: var(--mi-text-2);
}
.ghost:hover:not(:disabled) {
  background: var(--mi-blue-light);
}
.danger {
  background: var(--mi-error);
  color: var(--mi-on-fill);
}
.danger:hover:not(:disabled) {
  filter: brightness(0.95);
}

/*
 * 转圈跟着**字色**走（currentColor），不写死白色 ——
 * 填色按钮的字已经是深墨了，再配一个白圈会变成「深字 + 亮圈」两截色。
 * 四种 variant 的字色各不相同，currentColor 让转圈自动都对。
 */
.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
