<script setup lang="ts">
/**
 * 「你的代码 vs 参考解」对比卡 —— 真跑题型专属，错够了次数才出现。
 *
 * 【它要解决的那个具体问题】
 * 学员卡住了，看到一份参考解。如果只是把两段代码并排摆出来，他要**用眼睛去找**
 * 哪儿不一样 —— 而"一段 8 行的代码里改了一个字符、两栏看起来一模一样"
 * 恰恰是零基础学员最不擅长的。所以这里喂给他的是 `diffLines()` 对齐过的行：
 * **不一样的行自己涂上色**，左右两边在同一水平线上。教学价值全在那一抹颜色上。
 *
 * 【为什么带上「参考解不是唯一答案」那句话】
 * 见 `QUIZ.REFERENCE_MORE` 的说明。这一条不是客套 —— 真跑题型判的是输出，
 * 学员想出别的写法是**这个题型最想要的结果**，而一份"官方答案"摆在面前
 * 会让他以为那是唯一的。这是这个卡片唯一可能造成伤害的地方。
 *
 * 【为什么两栏的代码用 `<pre>` 而不是再挂两个 CodeMirror】
 * ① 一页里会有三个编辑器实例（答题区一个 + 这里两个），而这里要的是**只读对照**，
 *    语法高亮在这种场合反而帮倒忙 —— 多了十几种颜色，那一抹"改动的行"就被淹了。
 * ② 行级涂色要自己控制每一行的 DOM，CodeMirror 的行装饰是另一套 API，
 *    为一张只读卡去写它不划算。
 * ③ `CompareGrid` 展示课文代码块用的也是 `<pre>`，样式有现成的可以对齐。
 */
import { computed } from 'vue'
import { diffLines } from '../../../lib/line-diff'
import { referenceOf } from '../../../../../shared/run-grading'
import { QUIZ } from '../../../lib/copy'
import MiModal from '../../base/MiModal.vue'
import MiButton from '../../base/MiButton.vue'
import MiRichText from '../../base/MiRichText.vue'
import type { RunGradedQuestion } from '../../../../../shared/types'

const props = defineProps<{
  visible: boolean
  question: RunGradedQuestion
  /** 学员此刻写的那份（会话里那一份，不是某一次历史版本） */
  userAnswer: string
}>()

const emit = defineEmits<{ 'update:visible': [v: boolean] }>()

const rows = computed(() => diffLines(props.userAnswer, referenceOf(props.question)))

/** 一共几处不一样。用来在表头上给个总数 —— "有 3 处不同"比让人自己数有用 */
const changedCount = computed(() => rows.value.filter((r) => r.kind !== 'same').length)
</script>

<template>
  <MiModal
    :visible="visible"
    :title="QUIZ.REFERENCE_TITLE"
    :width="820"
    @update:visible="emit('update:visible', $event)"
  >
    <p class="ref-legend">{{ QUIZ.REFERENCE_LEGEND }}</p>

    <div class="ref-grid">
      <div class="ref-head">
        <span>{{ QUIZ.REFERENCE_YOURS }}</span>
        <span>{{ QUIZ.REFERENCE_REF }}</span>
      </div>

      <div
        v-for="(row, i) in rows"
        :key="i"
        class="ref-row"
        :class="row.kind"
      >
        <!--
          左栏。`yoursNo === null` 表示这一侧没有对应的行（参考解多出来的那行）——
          留一块斜纹占位，让"这里空着"和"这里是一个空行"看得出区别。
        -->
        <div class="ref-cell" :class="{ gap: row.yoursNo === null }">
          <span class="ref-ln">{{ row.yoursNo ?? '' }}</span>
          <span class="ref-code">{{ row.yours ?? '' }}</span>
        </div>
        <div class="ref-cell" :class="{ gap: row.refNo === null }">
          <span class="ref-ln">{{ row.refNo ?? '' }}</span>
          <span class="ref-code">{{ row.ref ?? '' }}</span>
        </div>
      </div>
    </div>

    <div class="ref-why">
      <div class="why-head">
        <span class="why-label">{{ QUIZ.REFERENCE_ANALYSIS }}</span>
        <span class="why-count">{{ QUIZ.referenceDiffNote(changedCount) }}</span>
      </div>
      <!-- 解析文案过 MiRichText：内容是按有内联标记写的，理由见 lib/rich-text.ts -->
      <MiRichText :text="question.explanation" />
    </div>

    <!-- 这一句必须在最下面、单独一行 —— 它是这个卡片唯一防"抄答案"的东西 -->
    <p class="ref-more">{{ QUIZ.REFERENCE_MORE }}</p>

    <template #footer>
      <MiButton variant="primary" @click="emit('update:visible', false)">
        {{ QUIZ.REFERENCE_CLOSE }}
      </MiButton>
    </template>
  </MiModal>
</template>

<style scoped>
.ref-legend {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--mi-text-2);
}

/* ── 对比表 ── */
.ref-grid {
  /* 封顶 + 内部滚动：参考解可能是一整个程序（几十行），
     不封顶的话卡片会长到 86vh 上限，下面那段解析被挤出屏幕 ——
     而"看了解析才明白哪儿错了"的人，正好就是需要滚到底的那个人。 */
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  background: var(--mi-card);
}
.ref-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  background: var(--mi-bg);
  border-bottom: 1px solid var(--mi-border);
}
.ref-head span {
  flex: 1 1 50%;
  min-width: 0;
  padding: 5px 10px;
  font-size: 11.5px;
  color: var(--mi-text-3);
}
.ref-head span + span {
  border-left: 1px solid var(--mi-border);
}

.ref-row {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid color-mix(in srgb, var(--mi-border) 45%, transparent);
}
.ref-row:last-child {
  border-bottom: none;
}
.ref-cell {
  flex: 1 1 50%;
  min-width: 0;
  display: flex;
  gap: 8px;
  padding: 1px 8px 1px 0;
  /* 允许选中：这一栏是给人"看着抄回去"的，禁掉选中是没道理的刁难。
     全局 `body { user-select: none }` 是为了让应用有原生质感，这里开个口子。 */
  user-select: text;
}
.ref-cell + .ref-cell {
  border-left: 1px solid var(--mi-border);
}
.ref-ln {
  flex-shrink: 0;
  width: 30px;
  padding-right: 6px;
  text-align: right;
  color: var(--mi-text-3);
  font-family: var(--mi-code);
  font-size: 11.5px;
  line-height: 1.7;
  user-select: none;
}
.ref-code {
  flex: 1;
  min-width: 0;
  font-family: var(--mi-code);
  font-size: 12px;
  line-height: 1.7;
  /* 换行而不是横向滚动：两栏各自横向滚的话，"同一行"会滚到不同的位置，
     对照关系当场就没了。宁可让它折行。 */
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--mi-text);
}

/* ── 涂色：只有"不一样"的行有色。
   改过 = 蓝（两边都有、内容不同）；多/少 = 绿/红（一边有一边没有）。
   三色都取项目现成的**浅底填充档**（`-light` / `-fill`），
   不在这儿新调颜色 —— 全站的功能色填充都是这三个值。 ── */
.ref-row.change .ref-cell {
  background: var(--mi-blue-light);
}
.ref-row.add .ref-cell:last-child {
  background: var(--mi-success-fill);
}
.ref-row.remove .ref-cell:first-child {
  background: var(--mi-error-fill);
}
/* `gap` 的斜纹要在涂色**上面**才看得见 —— 一行既是"改过"又有一侧缺行时，
   两者会叠在同一个格子上，斜纹被底色盖掉就分不出"少了一行"和"这行是空的"。 */
.ref-cell.gap {
  background-image: repeating-linear-gradient(
    45deg,
    transparent,
    transparent 5px,
    color-mix(in srgb, var(--mi-text-3) 22%, transparent) 5px,
    color-mix(in srgb, var(--mi-text-3) 22%, transparent) 6px
  );
}

/* ── 解析 ── */
.ref-why {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: var(--mi-radius-sm);
  border-left: 4px solid var(--mi-blue-deep);
  background: var(--mi-blue-light);
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--mi-text);
}
.why-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.why-label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--mi-blue-ink);
}
.why-count {
  padding: 0 6px;
  border-radius: var(--mi-radius-sm);
  background: var(--mi-card);
  color: var(--mi-text-3);
  font-size: 11px;
}

.ref-more {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--mi-text-2);
  text-align: center;
}
</style>
