<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CodeFillQuestion } from '../../../../../shared/types'
import { gradeCodeFillBlanks } from '../../../../../shared/quiz-grading'
import {
  blankMark,
  joinCodeFillAnswer,
  numberCodeFillBlanks,
  splitCodeFillAnswer
} from '../../../../../shared/codefill'
import { highlightCode } from '../../../lib/md'
import MiInput from '../../base/MiInput.vue'
import { QUIZ } from '../../../lib/copy'

/**
 * 代码填空题（`codefill`）：一块**只读高亮代码** + 下面 N 个输入框。
 *
 * 【为什么输入框排在代码下方，而不是嵌进代码的洞里】
 * 嵌进去的观感确实更好（像真的在填空），但实现是：把代码切成 token 流 →
 * 找到每个空所在的 token → 在那个位置把 token 流断开 → 在断口插一个 `<input>`，
 * 同时还要处理「空在一行的中间、缩进要跟着对齐」「空跨越了 token 边界」
 * 「高亮算法换了之后切点全变」这些情况。成本是**十倍**，而学员得到的东西
 * 几乎一样：他知道哪个空是哪个（靠编号），读得懂上下文（靠完整的代码块）。
 * 这个取舍在规划时就定了，见 docs/09 §2.2 的 `codefill` 条目。
 *
 * 【每个空单独描边，不是整题一个红绿】
 * 见 shared/quiz-grading.ts 里 `gradeCodeFillBlanks()` 的说明。
 */
const props = defineProps<{
  question: CodeFillQuestion
  /** 各个空按 `\n` 拼成的一串。为什么是这个形状，见 shared/codefill.ts */
  userAnswer: string
  submitted: boolean
}>()

const emit = defineEmits<{ update: [value: string] }>()

/** 代码里空位换成 ①②③ 的那一份。**替换在高亮之前**，理由见 codefill.ts */
const highlighted = computed(() =>
  highlightCode(numberCodeFillBlanks(props.question.code), props.question.lang)
)

/**
 * 各输入框的值。按**题目的空位数**补齐，学员只填了一个时后面两个输入框也得在。
 *
 * ⚠️ **不能直接拿 `props.userAnswer` 现算** —— 这是真窗口里踩出来的一个静默 bug。
 *
 * 属性是父组件传下来的，父组件要等**下一次渲染**才把它更新过来。于是同一个
 * tick 里连改多个输入框时，每次 `onInput` 读到的都是**改之前**那一份，
 * 各自从同一个基准算出"整串"、**最后一次把前几次整个盖掉**：
 * 三空题一次性写 `head` / `NULL` / `free`，三个输入框里都好好的，
 * 会话里存下来的却是 `"\n\nfree"` —— **答案被改乱，一句报错都没有**。
 *
 * ⚠️ 存成什么**取决于改之前那一份是什么**，所以这个 bug 每次长得都不一样：
 * 另一次真窗口里存下来的是 `"free\n\nfree"`。不变的只有那个特征 ——
 * **界面上全对，会话里是乱的**。所以查它要看会话里那一串，不能看输入框。
 *
 * 真人一次只敲一个键、中间隔着事件循环，所以这个错在手工点界面时基本撞不上；
 * 但**粘贴、输入法上屏、浏览器自动填充**都可能在一个 tick 里连改多个框。
 * 所以本地存一份、逐次在上面改，用 watch 跟着上游同步（"再来一遍"重置会话时，
 * 本地这份必须跟着回到空，否则新一局会带着上一局的答案）。
 *
 * 回归判据在 `<workspace>/_e2e-codefill.mjs` 的「同 tick 突发」那一步（不随仓库分发），它反向验证过：
 * 把这里退回旧写法，那一步就报红。
 */
const local = ref<string[]>(splitCodeFillAnswer(props.userAnswer, props.question.blanks.length))

watch(
  // 同时盯 `question`：换题时 userAnswer 一般也会变，但两件事一起盯才不用去
  // 赌"换题一定伴随答案变化"这个前提（练习遮罩换题时它是真的会变，可那是巧合）
  () => [props.userAnswer, props.question] as const,
  () => {
    local.value = splitCodeFillAnswer(props.userAnswer, props.question.blanks.length)
  }
)

/** 每个空的对错。没提交时是空数组 —— 界面靠 `submitted` 判断要不要用 */
const marks = computed(() =>
  props.submitted ? gradeCodeFillBlanks(props.userAnswer, props.question) : []
)

function onInput(i: number, v: string) {
  if (props.submitted) return
  const next = [...local.value]
  next[i] = v
  local.value = next
  // 拼回去而不是把数组直接 emit 出去：会话里存的是**一串**，
  // 转换只在这一个地方发生，判分那边就不用再猜"上游给的是数组还是串"
  emit('update', joinCodeFillAnswer(next))
}
</script>

<template>
  <div class="quiz-codefill">
    <pre class="code-view"><code class="hljs" v-html="highlighted" /></pre>

    <div class="codefill-hint">{{ QUIZ.CODEFILL_HINT }}</div>

    <div class="blank-rows">
      <div v-for="(b, i) in question.blanks" :key="i" class="blank-row">
        <span class="blank-mark">{{ blankMark(i) }}</span>
        <MiInput
          :model-value="local[i]"
          :class="{
            correct: submitted && marks[i],
            wrong: submitted && !marks[i]
          }"
          :placeholder="QUIZ.codeFillPlaceholder(i + 1)"
          width="100%"
          :readonly="submitted"
          @update:model-value="(v: string) => onInput(i, v)"
        />
        <span v-if="submitted && !marks[i]" class="blank-answer">
          {{ QUIZ.CODEFILL_ANSWER_IS }}<code>{{ b.answer }}</code>
          <span v-if="b.accept && b.accept.length > 0">
            {{ QUIZ.fillAccept(b.accept.join(' / ')) }}
          </span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.quiz-codefill {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.code-view {
  margin: 0;
  padding: 12px 14px;
  background: var(--mi-code-bg);
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  overflow-x: auto;
}
.code-view code.hljs {
  display: block;
  background: transparent;
  font-family: var(--mi-code);
  font-size: 13px;
  line-height: 1.7;
}
/* 提示语做得比正文淡一档：它是"怎么看这道题"的说明，不是题目内容本身 */
.codefill-hint {
  font-size: 12px;
  color: var(--mi-text-3);
}
.blank-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* 标记固定宽度 + 不收缩，几个输入框的左边缘才会对齐 ——
   不然 ① ② 的宽度差一点点，下面几个框就参差不齐 */
.blank-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.blank-mark {
  flex: 0 0 auto;
  width: 18px;
  text-align: center;
  font-size: 14px;
  color: var(--mi-text-2);
}
/* 同 QuizFill / QuizCode：边和光晕都跟深档走，免得出现「深边框 + 亮光圈」两截色 */
.quiz-codefill :deep(.mi-input.correct) {
  border-color: var(--mi-success-deep);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mi-success-deep) 22%, transparent);
}
.quiz-codefill :deep(.mi-input.wrong) {
  border-color: var(--mi-error-deep);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mi-error-deep) 22%, transparent);
}
/* 答错的那个空的正确答案，跟在它自己那一行右边。
   不收缩（长答案宁可把题面撑宽一点，也不要挤成一团看不清） */
.blank-answer {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--mi-text-2);
}
.blank-answer code {
  font-family: var(--mi-code);
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--mi-success-fill);
  color: var(--mi-success-deep);
  font-weight: 700;
}
</style>
