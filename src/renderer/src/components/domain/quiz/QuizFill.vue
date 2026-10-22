<script setup lang="ts">
import { computed } from 'vue'
import type { FillQuestion } from '../../../../../shared/types'
import { gradeFill } from '../../../../../shared/quiz-grading'
import MiInput from '../../base/MiInput.vue'
import { QUIZ } from '../../../lib/copy'

// M4-02：填空题（提交后绿/红描边，答错显示正确答案）
const props = defineProps<{
  question: FillQuestion
  userAnswer: string
  submitted: boolean
}>()

const emit = defineEmits<{ update: [value: string] }>()

const isCorrect = computed(() => props.submitted && gradeFill(props.userAnswer, props.question.answer, props.question.accept))

function onInput(v: string) {
  if (props.submitted) return
  emit('update', v)
}
</script>

<template>
  <div class="quiz-fill">
    <MiInput
      :model-value="userAnswer"
      :class="{
        correct: submitted && isCorrect,
        wrong: submitted && !isCorrect
      }"
      :placeholder="QUIZ.FILL_PLACEHOLDER"
      width="100%"
      :readonly="submitted"
      @update:model-value="onInput"
    />
    <div v-if="submitted && !isCorrect" class="fill-answer">
      {{ QUIZ.ANSWER_IS }}<code>{{ question.answer }}</code>
      <span v-if="question.accept && question.accept.length > 0">
        {{ QUIZ.fillAccept(question.accept.join(' / ')) }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.quiz-fill {
  margin-top: 4px;
}
/* 边和光晕都用深档 —— 光晕原来写死的是浅档的 rgb，
   不改的话会出现「深绿边框 + 亮绿光圈」两截色。 */
.quiz-fill :deep(.mi-input.correct) {
  border-color: var(--mi-success-deep);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mi-success-deep) 22%, transparent);
}
.quiz-fill :deep(.mi-input.wrong) {
  border-color: var(--mi-error-deep);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mi-error-deep) 22%, transparent);
}
.fill-answer {
  margin-top: 10px;
  font-size: 13px;
  color: var(--mi-text-2);
}
/* 答案那个小色块：底浅、字深，和上面「底 fill / 字 deep」同一条规矩 */
.fill-answer code {
  font-family: var(--mi-code);
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--mi-success-fill);
  color: var(--mi-success-deep);
  font-weight: 700;
}
</style>
