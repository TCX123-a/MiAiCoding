<script setup lang="ts">
/**
 * 「这一卷要考什么」—— 开卷前的确认框。
 *
 * 【为什么阶段卷要点一下确认，而别的练习入口不用】
 * 别的入口用户知道自己在点啥："我选中的这几道"、"这道错题的同类题"。
 * 阶段卷不是 —— 按钮上只有「综合练习」四个字，点下去之前他**无从知道**
 * 这一卷是 10 道全简单题（那这门语言的困难题池空了）还是 10 道里 4 道困难
 * （那强度跟课后练习完全不是一回事）。不告诉他就开卷，做完他只会觉得
 * "怎么这么难 / 这么水"，而说不出为什么。
 *
 * 【所以这里摆的每个数字都是**已经发生的事实**】
 * 全部来自 `draft.stats`（组卷的真实结果），不是"我们打算出几道难题"。
 * 尤其 `short` 为真时那句（`PAPER.shortNote`）：池子里的困难题不够，
 * 就该把**供给量**说出来（"一共只有 3 道"），而不是把 40% 印在屏幕上当没发生过。
 *
 * 【这个组件不组卷、不开局】组卷在 `lib/stage-practice.ts`（纯函数、有单测），
 * 开局也在那儿。这里只做两件事：把 `draft` 摆成人话、把两个按钮翻译成事件。
 * 这样"确认框上的数字"和"卷子上真实的题"永远出自同一个 `draft` ——
 * 组件自己算一遍的话，两处迟早会漂移，而漂移了没人看得出来。
 */
import MiModal from '../base/MiModal.vue'
import MiButton from '../base/MiButton.vue'
import { PAPER } from '../../lib/copy'
import type { PaperDraft } from '../../lib/stage-practice'

defineProps<{
  visible: boolean
  /** 已组好的那一卷；没有它就不显示内容（调用方组不出卷时压根不打开这个框） */
  draft: PaperDraft | null
}>()

const emit = defineEmits<{
  'update:visible': [v: boolean]
  /** 用户点了「开始练习」，把**同一个** draft 交出去开卷 */
  start: [draft: PaperDraft]
}>()

function onVisible(v: boolean): void {
  emit('update:visible', v)
}

function onStart(draft: PaperDraft | null): void {
  if (!draft) return
  emit('start', draft)
}
</script>

<template>
  <MiModal
    :visible="visible"
    :title="draft ? PAPER.dialogTitle(draft.label) : ''"
    :width="420"
    @update:visible="onVisible"
  >
    <template v-if="draft">
      <ul class="paper-stats">
        <li>{{ PAPER.sizeLabel(draft.stats.size) }}</li>
        <li>{{ PAPER.lessonsLabel(draft.stats.lessons) }}</li>
        <li>{{ PAPER.hardLabel(draft.stats.hard, draft.stats.challenge) }}</li>
      </ul>
      <!-- 只在池子里的困难题不够时出现（理由见 copy.ts 的 shortNote） -->
      <p v-if="draft.stats.short" class="paper-short">
        {{ PAPER.shortNote(draft.label, draft.stats.hardAvailable) }}
      </p>
      <p class="paper-hint">{{ PAPER.HINT }}</p>
    </template>
    <template #footer>
      <!--
        取消那半边用 ghost、不叫「取消」叫「再想想」—— 和退出练习的二次确认
        同一个说法（QUIZ.EXIT_CANCEL）。用户点的是"开始综合练习"，
        弹出来才决定不做了，这两个字比「取消」少一层"我操作失败了"的暗示。
      -->
      <MiButton variant="ghost" @click="emit('update:visible', false)">
        {{ PAPER.CANCEL }}
      </MiButton>
      <MiButton variant="primary" :disabled="!draft" @click="onStart(draft)">
        {{ PAPER.START }}
      </MiButton>
    </template>
  </MiModal>
</template>

<style scoped>
/*
 * 三行实况：前面一个圆点、字号略小。用 <ul> 而不是三个 <p> ——
 * 它是"这一卷的构成"一份清单，读屏软件按列表念比按三个段落念更像回事。
 */
.paper-stats {
  margin: 0;
  padding-left: 18px;
  list-style: disc;
}
.paper-stats li {
  line-height: 2;
}
/*
 * 颜色一律走令牌（`tokens.css`）—— 这里的短供说明是"提醒"不是"报错"，
 * 所以取 --mi-text-2 而不是 --mi-warn：它报告的是内容现状，
 * 不是用户做错了什么。深色模式下令牌自己会翻，别写死颜色。
 */
.paper-short {
  margin: 8px 0 0;
  color: var(--mi-text-2);
  font-size: 13px;
}
.paper-hint {
  margin: 10px 0 0;
  color: var(--mi-text-3);
  font-size: 13px;
}
</style>
