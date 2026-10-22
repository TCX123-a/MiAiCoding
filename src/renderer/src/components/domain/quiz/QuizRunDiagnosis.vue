<script setup lang="ts">
/**
 * 诊断卡 —— 真跑题型「没做对」时，界面上第一句人话。
 *
 * 【它填的是哪个洞（2026-09-22 主人报的）】
 * 在这之前，代码题答错之后界面**一句话都不说**。输出框还是绿的（程序确实跑成功了）、
 * 底下直接就是「下一题」，学员根本不知道自己错了 —— 要等收工时在错题本里才发现，
 * 而那时候代码早就不在眼前了。
 *
 * 【它和「查看猫咪解析」的分工，是这个功能的全部设计】
 * 解析**就是答案**。诊断卡只给三样：**哪里出的事、我拿到的是什么、题目要的是什么**。
 * 三样都不足以让他跳过思考，但足以让他知道下一步看哪儿。
 * 所以「错两次才自动给解析」那道闸门保得住 —— 见 stores/quiz.ts 的 `canShowExplanation`。
 *
 * 【它为什么不自己算】
 * 「什么时候该说话、说什么」全在 `lib/run-diagnosis.ts`（纯函数、有单测），
 * 文案全在 `lib/copy.ts`。这个文件只负责把它们摆到屏幕上 ——
 * 一旦它开始自己判断，判断就有了第二份实现，而两份判据漂移的表现是静默的。
 */
import { computed } from 'vue'
import type { RunDiagnosisView } from '../../../lib/run-diagnosis'
import { QUIZ } from '../../../lib/copy'
import MiMascot from '../../base/MiMascot.vue'

const props = defineProps<{ diagnosis: RunDiagnosisView }>()

/** 标题 + 那句话，两档各一套。`failKind` 一定不是 `env`（那个档不会走到这里） */
const head = computed(() => {
  if (props.diagnosis.kind === 'output') return QUIZ.OUTPUT_TITLE
  return QUIZ.FAIL_TITLE
})

const body = computed(() => {
  if (props.diagnosis.kind === 'output') return QUIZ.OUTPUT_BODY
  // 环境问题在 `diagnosisOf()` 里就被挡掉了，所以这里的 `failKind` 只会是
  // compile / run / timeout 三个。真收到 null 也不编话，退回「跑不通」那句。
  return QUIZ.failDiagnosis(props.diagnosis.failKind ?? 'run', props.diagnosis.line)
})
</script>

<template>
  <div class="run-diag">
    <MiMascot pose="soothe" size="s" />
    <div class="diag-body">
      <div class="diag-title">{{ head }}</div>
      <div class="diag-said">{{ body }}</div>

      <!--
        「期望 / 得到」两行。只在**输出不对**那一档出现 ——
        跑不通的时候没有「得到」可言（程序压根没输出）。
      -->
      <div v-if="diagnosis.kind === 'output'" class="diag-pair">
        <div class="pair-row">
          <span class="pair-label">{{ QUIZ.DIAG_EXPECTED }}</span>
          <pre class="pair-text want">{{ diagnosis.expected }}</pre>
        </div>
        <div class="pair-row">
          <span class="pair-label">{{ QUIZ.DIAG_ACTUAL }}</span>
          <pre class="pair-text got">{{ diagnosis.actual }}</pre>
        </div>
      </div>

      <div class="diag-next">{{ QUIZ.DIAG_TRY_AGAIN }}</div>
    </div>
  </div>
</template>

<style scoped>
.run-diag {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--mi-radius-sm);
  /* 用「提醒」色而不是「错误」色：这不是判他错，是拍拍肩膀指个方向。
     答对/答错那两张卡（QuizOverlay 的 .quiz-explain）才是红绿分明的那一对。 */
  background: color-mix(in srgb, var(--mi-warn) 14%, var(--mi-card));
  border: 1px solid color-mix(in srgb, var(--mi-warn) 45%, var(--mi-border));
  border-left: 4px solid var(--mi-warn-deep);
  font-size: 13px;
  line-height: 1.8;
}
/* min-width:0 不能省：flex 子项默认不肯缩到内容宽度以下，长期望值会把卡片撑破 */
.diag-body {
  flex: 1;
  min-width: 0;
}
.diag-title {
  font-weight: 700;
  color: var(--mi-warn-deep);
}
.diag-said {
  margin-top: 2px;
  color: var(--mi-text);
}

/* ── 期望 / 得到 ── */
.diag-pair {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed color-mix(in srgb, var(--mi-warn) 45%, var(--mi-border));
}
.pair-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.pair-row + .pair-row {
  margin-top: 4px;
}
.pair-label {
  flex-shrink: 0;
  width: 3em;
  font-size: 11.5px;
  color: var(--mi-text-2);
}
/*
  `white-space: pre-wrap` 是必须的：多行输出（`1\n2\n3`）压成一行就变成了
  「1 2 3」，而"三行"和"一行三个数"是两道不同的题 —— 学员照着压平的那份改，
  永远改不对。理由同 `run-grading.ts` 的换行契约。
*/
.pair-text {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 1px 6px;
  border-radius: var(--mi-radius-sm);
  font-family: var(--mi-code);
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.pair-text.want {
  background: var(--mi-success-fill);
  color: var(--mi-success-deep);
}
.pair-text.got {
  background: var(--mi-error-fill);
  color: var(--mi-error-deep);
}

.diag-next {
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--mi-text-2);
}
</style>
