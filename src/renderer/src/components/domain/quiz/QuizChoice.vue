<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ChoiceQuestion } from '../../../../../shared/types'
import { gradeChoice } from '../../../../../shared/quiz-grading'
import { QUIZ } from '../../../lib/copy'

// M4-02：选择题（提交后正确答案绿描边、错选红描边）
//
// 【键盘可达（V2-32 修复现场，2026-10-15）】
// 原来选项是裸 `<div @click>`：无 tabindex、无 role、无 keydown —— 全应用最高频的
// 动作（选答案）键盘一步都走不了（活窗实测 optFocusable=0，连按 12 次 Tab 进不了浮层）。
// 现在的键盘路径（radiogroup 语义，向原生 radio 看齐）：
//   · Tab 停到选项上 → Enter/Space 选中；
//   · ↑↓←→ 在选项间移动焦点**并同时选中**（原生 radio 的行为；选中可改，提交前无副作用）；
//   · 数字键 1~9 直接选中第 n 个选项（window 级兜底：焦点在「提交」按钮上也能按 1 选 A）。
// 数字键监听挂在 window 上是为了兜底，所以它必须**绕开输入控件**（e.target 是
// input/textarea/contenteditable 时直接放行），否则将来某个题型在选择题里嵌输入框会打架。
//
// 【点击音（V1-44，2026-10-16）】选项是 `role="radio"` 的自绘 div —— 不在 sfx-wire 的
// NATURALLY_CLICKABLE（button/a/summary/select/[role=button]）里，此前这一下点击是
// **沉默**的：全应用最高频的动作（选答案）只有边框变色，没有声音确认。主人裁定
// 「V1-44要改」。现在选项显式挂 `data-sfx="click"`（与侧栏 nav、立绘 quack 同一套
// 表态机制；声音由 lib/sfx-wire.ts 的全局委托播，这里只表态、不碰播放）。
// 键盘路径（Enter/Space/方向键/数字键）不配声：委托层只认 pointerdown，
// 全应用的键盘交互一律无声，选项不搞特殊。
const props = defineProps<{
  question: ChoiceQuestion
  userAnswer: number | null
  submitted: boolean
}>()

const emit = defineEmits<{ update: [value: number] }>()

const isCorrect = computed(() => props.submitted && gradeChoice(props.userAnswer, props.question.answer))

const optRefs = ref<(HTMLElement | null)[]>([])
/** 模板 ref 回调：收 unknown，资格判定只认 instanceof（同 FullscreenMenu 的 setBtn） */
function setOpt(el: unknown, i: number): void {
  optRefs.value[i] = el instanceof HTMLElement ? el : null
}

function pick(i: number) {
  if (props.submitted) return
  emit('update', i)
}

/**
 * 选项上的按键：Enter/Space 选中；方向键移动焦点并选中（见文件头）。
 * 选中后把焦点挪过去，保证"看得见的焦点"和"选中的答案"永远指同一处。
 */
function onOptKey(e: KeyboardEvent, i: number) {
  if (props.submitted) return
  const n = props.question.options.length
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    pick(i)
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
    e.preventDefault()
    move(i, (i + 1) % n)
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
    e.preventDefault()
    move(i, (i - 1 + n) % n)
  }
}

function move(from: number, to: number) {
  pick(to)
  optRefs.value[to]?.focus()
  // from 用不到，但签名保留「从哪来」的语义，将来要加环绕动效时有地方接
  void from
}

/** 数字键兜底（window 级）—— 规则与豁免见文件头 */
function onWindowKey(e: KeyboardEvent) {
  if (props.submitted) return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const t = e.target
  if (
    t instanceof HTMLElement &&
    (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
  ) {
    return
  }
  const n = Number(e.key)
  if (!Number.isInteger(n) || n < 1 || n > props.question.options.length) return
  e.preventDefault()
  pick(n - 1)
  optRefs.value[n - 1]?.focus()
}

onMounted(() => window.addEventListener('keydown', onWindowKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKey))

function optionClass(i: number): string {
  if (!props.submitted) return props.userAnswer === i ? 'picked' : ''
  if (i === props.question.answer) return 'correct'
  if (props.userAnswer === i) return 'wrong'
  return ''
}
</script>

<template>
  <div class="quiz-choice" role="radiogroup" :aria-label="QUIZ.OPTIONS_LABEL">
    <div
      v-for="(opt, i) in question.options"
      :key="i"
      :ref="(el) => setOpt(el, i)"
      class="choice-opt"
      :class="optionClass(i)"
      role="radio"
      :aria-checked="userAnswer === i"
      :tabindex="submitted ? -1 : 0"
      data-sfx="click"
      @click="pick(i)"
      @keydown="onOptKey($event, i)"
    >
      <span class="opt-letter">{{ String.fromCharCode(65 + i) }}</span>
      <span class="opt-text">{{ opt }}</span>
      <span v-if="submitted && i === question.answer" class="opt-mark">✓</span>
      <span v-else-if="submitted && userAnswer === i" class="opt-mark">✗</span>
    </div>
  </div>
</template>

<style scoped>
.quiz-choice {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.choice-opt {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: 1.5px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  background: var(--mi-bg);
  cursor: var(--mi-cursor, pointer);
  /*
   * 批⑥（2026-10-16）：原先 `transition: all .15s ease`。选项会变的是描边与底
   * （hover / picked / correct / wrong 四态都只动这两样），点名列出。
   */
  transition:
    border-color var(--mi-dur-fast) var(--mi-ease),
    background var(--mi-dur-fast) var(--mi-ease);
  font-size: 14px;
}
.choice-opt:hover {
  border-color: var(--mi-blue-deep);
  background: var(--mi-blue-light);
}
/* 焦点环：与 rail / MiTabs / fs-item 同一套约定（2px 笔画色、offset 2px）——
   键盘党必须看得见"现在停在哪一项"（V2-32 的配套，光能选不够，还得看得见） */
.choice-opt:focus-visible {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 2px;
}
.choice-opt.picked {
  border-color: var(--mi-blue-deep);
  background: var(--mi-blue-light);
}
/* 边框走深档（1px 的浅边看不见），**浅色填充照旧** —— 这一条正是「一浅一深两档」的用法示范：
   底是填充（浅、不抢眼），边是标识（深、看得清）。 */
.choice-opt.correct {
  border-color: var(--mi-success-deep);
  background: var(--mi-success-fill);
}
.choice-opt.wrong {
  border-color: var(--mi-error-deep);
  background: var(--mi-error-fill);
}
.opt-letter {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--mi-card);
  font-family: var(--mi-code);
  font-size: 12px;
  color: var(--mi-text-2);
}
/* 这个 A/B/C/D 小圆圈**底改成深档、字留白**：
   原来浅底白字只有 1.70 / 2.03。反过来算了一下——深底白字是 5.12 / 5.54 ✓，
   而且白字压在深底上比深字压在浅底上更醒目，正好配「这就是你选的那个」的语义。

   ⚠️ **2026-09-20 改：`color: #fff` 换成 `var(--mi-seal-ink)`** —— 夜间模式。
   上面那段「深底白字」的账是**按浅色主题算的**：浅色下 --mi-success-deep(#257c46)
   是个深绿，白字压上去 5.18 ✓。可深色主题里这个令牌是**亮绿 #5ed08b** ——
   白字压上去只剩 1.93，那个 A/B/C/D 直接糊成一团白。
   病根不是我选错了色，是「填色的极性会翻、压在上面的字却写死了」。
   所以给这个圆形徽章配一个自己的字色令牌，浅色给白、深色给近黑（= --mi-on-fill 那个），
   和按钮的 --mi-on-fill 是同一套道理。 */
.correct .opt-letter {
  background: var(--mi-success-deep);
  color: var(--mi-seal-ink);
}
.wrong .opt-letter {
  background: var(--mi-error-deep);
  color: var(--mi-seal-ink);
}
.opt-text {
  flex: 1;
}
.opt-mark {
  font-weight: 700;
}
/* 那个 ✓ / ✗ 是**文字**（一个字符），照样要过 4.5。
   原来写死的是两个自己挑的色，和 --mi-success/error 那套没关系，
   正好一起并进深档，全仓再也不留这种「看着差不多就手写一个」的色。 */
.correct .opt-mark {
  color: var(--mi-success-deep);
}
.wrong .opt-mark {
  color: var(--mi-error-deep);
}
</style>
