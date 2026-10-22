<script setup lang="ts">
/**
 * 提示条。文本之外可选一枚动作按钮（撤销）—— 见 toast.ts 的注释。
 *
 * 【为什么 runAction 要先查 id 还在不在】
 * 点击处理是同步的，而 Vue 把 DOM 更新排在下一个 tick：连点两下时，
 * 第二次点击落在**还没被移除**的那个按钮上。不查的话撤销会跑两遍
 * （软删的撤销跑两遍不算灾难，但这个守卫是"动作只执行一次"的保证，
 * 将来把动作换成一个不可重复的操作时，它就是唯一挡住重复的那道）
 *
 * 【V2-38：键盘党够不到撤销，怎么修】2026-10-16。
 * 带动作的 toast 出现时把焦点**主动送到那颗动作按钮上**；同时整条 toast
 * 容器补 role="status" + aria-live（读屏用户至少能听见"已移除 + 撤销"）。
 * 现状背景：撤销窗口只有 5 秒，而 toast 的 DOM 挂在整页内容之后 ——
 * 键盘党从文档开头 Tab 过去要几十次，5 秒早过，等于没有这条路。
 * 抢焦点这一下是刻意的例外：出现带动作 toast 的时刻几乎都是用户刚按下
 * 「删除」—— 焦点本来就在一次刚完成的动作旁边，落到"反悔键"上是连贯的。
 * 没有动作的普通 toast 不抢（那才是打扰）。
 */
import { nextTick, watch } from 'vue'
import { toasts, dismissToast, type ToastItem } from './toast'

function runAction(t: ToastItem): void {
  if (!toasts.some((x) => x.id === t.id)) return
  dismissToast(t.id)
  t.action?.run()
}

/** id → 动作按钮元素。模板 ref 回调收集；元素被摘时 Vue 以 null 回调，顺手清 */
const actionEls = new Map<number, HTMLElement>()
function setActionEl(el: unknown, id: number): void {
  if (el instanceof HTMLButtonElement) actionEls.set(id, el)
  else actionEls.delete(id)
}

/**
 * 盯「最新一条的 id」而不是数组长度：同一 tick 里"走一条、来一条"时
 * 长度不变，只看长度会漏掉新来的那条。
 */
watch(
  () => toasts[toasts.length - 1]?.id ?? 0,
  (id) => {
    if (!id) return
    const t = toasts.find((x) => x.id === id)
    if (!t?.action) return
    // 等它真正进 DOM（TransitionGroup 的入场元素当帧已在），再聚焦
    void nextTick(() => actionEls.get(id)?.focus())
  }
)
</script>

<template>
  <div class="mi-toast-wrap" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id" class="mi-toast" :class="t.type">
        <span class="mi-toast-text">{{ t.text }}</span>
        <button
          v-if="t.action"
          :ref="(el) => setActionEl(el, t.id)"
          type="button"
          class="mi-toast-action"
          @click="runAction(t)"
        >
          {{ t.action.label }}
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.mi-toast-wrap {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}
.mi-toast {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 420px;
  padding: 9px 18px;
  font-size: 13px;
  color: var(--mi-text);
  background: var(--mi-bg);
  border: 1px solid var(--mi-border);
  border-radius: 999px;
  box-shadow: var(--mi-shadow);
}
/* 外层 wrap 是 pointer-events:none（不然整条横幅会挡住底下的点击），
   动作按钮要**自己**把它拿回来，否则它看得见、点不着 */
.mi-toast-action {
  pointer-events: auto;
  padding: 0;
  font: inherit;
  color: var(--mi-blue-ink);
  background: none;
  border: none;
  cursor: var(--mi-cursor, pointer);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.mi-toast-action:hover {
  color: var(--mi-blue-deep);
}
/* 键盘焦点环（V2-38）：它现在会被程序化聚焦，必须看得见"焦点在哪"。
   offset 收紧到 1px：toast 是 999px 圆角胶囊，2px 环在两端会飘到胶囊外 */
.mi-toast-action:focus-visible {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 1px;
  border-radius: 4px;
}
/* 描边用深档：1px 的浅色边压在浅蓝上几乎看不见（实测 1.67 / 1.99 / 1.40）。
   提示条那圈边是「这条是什么性质」的唯一线索，看不见就等于没有。 */
.mi-toast.success {
  border-color: var(--mi-success-deep);
}
.mi-toast.error {
  border-color: var(--mi-error-deep);
}
.mi-toast.warn {
  border-color: var(--mi-warn-deep);
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--mi-dur) var(--mi-ease-out),
    transform var(--mi-dur) var(--mi-ease-out);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
