<script setup lang="ts">
import { computed } from 'vue'
import type { CodeQuestion } from '../../../../../shared/types'
import { gradeCode, isMultilineCodeAnswer } from '../../../../../shared/quiz-grading'
import { highlightCode } from '../../../lib/md'
import MiInput from '../../base/MiInput.vue'
import { QUIZ } from '../../../lib/copy'

// M4-02：代码阅读题（高亮代码 + 输出填空；提交后绿/红描边，答错显示正确输出）
const props = defineProps<{
  question: CodeQuestion
  userAnswer: string
  submitted: boolean
}>()

const emit = defineEmits<{ update: [value: string] }>()

const highlighted = computed(() => highlightCode(props.question.code, props.question.lang))
const isCorrect = computed(() => props.submitted && gradeCode(props.userAnswer, props.question.answer, props.question.accept))

/**
 * 这道题的答案是**好几行**吗 —— 是的话输入框要变成多行。
 *
 * 【为什么由答案推出来，而不是在内容里加个字段】
 * 加了字段就有"填错"和"忘了填"两种坏法，而坏掉的样子是**这题永远做不对**：
 * 答案是 `"1\n2\n3"`，学员手上却只有个单行框，回车一按就交卷，
 * 他这辈子打不出第二个 `2`。由 `answer` 现推，内容侧就没有填错的余地 ——
 * 题型形状跟着内容自己走，这是不会漂移的那一种写法。
 *
 * ⚠️ **判据不是"原串里有没有 `\n`"**，是"归一化之后还有没有" —— 理由是
 * `accept` 里挂着的 `"…\n"` 只是末尾换行的容忍写法，不是"好几行"。
 * 2026-09-15 真窗口里就是因为这个把一道单行题渲染成了多行框。
 * 判据本身住在 `isMultilineCodeAnswer()`（`shared/quiz-grading.ts`），有单测盯着。
 */
const multiline = computed(() => isMultilineCodeAnswer(props.question.answer, props.question.accept ?? []))

const placeholder = computed(() =>
  multiline.value ? QUIZ.CODE_PLACEHOLDER_MULTILINE : QUIZ.CODE_PLACEHOLDER
)

function onInput(v: string) {
  if (props.submitted) return
  emit('update', v)
}
</script>

<template>
  <div class="quiz-code">
    <pre class="code-view"><code class="hljs" v-html="highlighted" /></pre>
    <MiInput
      :model-value="userAnswer"
      :class="{
        correct: submitted && isCorrect,
        wrong: submitted && !isCorrect
      }"
      :placeholder="placeholder"
      :multiline="multiline"
      :rows="Math.min(3 + (question.answer.match(/\n/g)?.length ?? 0), 8)"
      width="100%"
      :readonly="submitted"
      @update:model-value="onInput"
    />
    <div v-if="multiline && !submitted" class="code-hint">{{ QUIZ.CODE_MULTILINE_HINT }}</div>
    <div v-if="submitted && !isCorrect" class="code-answer" :class="{ multiline }">
      {{ QUIZ.OUTPUT_IS }}<code>{{ question.answer }}</code>
    </div>
  </div>
</template>

<style scoped>
.quiz-code {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.code-view {
  margin: 0;
  padding: 12px 14px;
  /* 原为写死的 #fafbfd（和课文代码块是同一个值、同样没走令牌），跟着 --mi-code-bg 走 */
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
/* 同 QuizFill：边与光晕都跟深档走，免得出现「深边框 + 亮光圈」两截色 */
.quiz-code :deep(.mi-input.correct) {
  border-color: var(--mi-success-deep);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mi-success-deep) 22%, transparent);
}
.quiz-code :deep(.mi-input.wrong) {
  border-color: var(--mi-error-deep);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mi-error-deep) 22%, transparent);
}
/* 多行题才有的那句「回车是换行」提示，别喧宾夺主 */
.code-hint {
  font-size: 12px;
  color: var(--mi-text-3);
  margin-top: -4px;
}
.code-answer {
  font-size: 13px;
  color: var(--mi-text-2);
}
/* 多行答案（`1\n2\n3` 这种）：文字和答案各占一行，否则多行答案会从文字右边开始折，
   折出来的形状和学员自己打的、和参考解都对不上号 */
.code-answer.multiline {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}
.code-answer code {
  font-family: var(--mi-code);
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--mi-success-fill);
  color: var(--mi-success-deep);
  font-weight: 700;
  /* 换行是这份答案的内容，HTML 默认会把它折叠成空格 —— 折掉之后
     学员看到的是「1 2 3」，和正确答案「三行」是两回事 */
  white-space: pre;
  text-align: left;
  max-width: 100%;
  overflow-x: auto;
}
</style>
