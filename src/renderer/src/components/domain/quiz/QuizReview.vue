<script setup lang="ts">
/**
 * 逐题回顾（每日挑战结算后看的那一页）。
 *
 * 【为什么它读的是存档、不是 `quiz.session`】
 * 做完题遮罩一关，`quiz.session` 就被置成 null 了 —— 而这个入口恰恰开在遮罩
 * 关掉之后的结算卡上。读 session 的话它一出生就是死的。读存档还白赚一件事：
 * 重开应用、过几天回来看，照样打得开。数据的来路见 stores/challenge.ts 的 reviewRows。
 *
 * 【为什么自己做一套渲染，不把 QuizChoice / QuizFill 复用过来】
 * 那两个是**答题控件**（可点、可输入、有提交态），回顾要的是**只读的对照**：
 * 正确的那个在哪、我选的那个在哪，两个标同时摆在一行里。硬把答题控件改成
 * 只读模式，等于给它们加一个「这次别响应点击」的开关 —— 一个控件两种人格，
 * 将来谁改都会漏掉另一半。这里要渲染的东西很少，各写各的更省心。
 */
import MiModal from '../../base/MiModal.vue'
import MiButton from '../../base/MiButton.vue'
import MiRichText from '../../base/MiRichText.vue'
import FavoriteStar from '../FavoriteStar.vue'
import { CHALLENGE } from '../../../lib/copy'
import { blankMark, splitCodeFillAnswer } from '../../../../../shared/codefill'
import type { CodeFillQuestion } from '../../../../../shared/types'
import type { ReviewRow } from '../../../stores/challenge'

defineProps<{ visible: boolean; rows: ReviewRow[] }>()
const emit = defineEmits<{ 'update:visible': [v: boolean] }>()

/**
 * 顶上的那个标。
 *
 * ⚠️ 「没作答」必须和「答错了」分开：用户中途退出过遮罩的话，
 * 那题他根本没写，标成「答错了」是在替他认一件他没做过的事。
 */
function markOf(row: ReviewRow): string {
  if (row.ok) return CHALLENGE.REVIEW_OK
  return row.your === null ? CHALLENGE.REVIEW_SKIPPED : CHALLENGE.REVIEW_BAD
}

/** 选择题的作答存的是**下标**，得翻成选项文字才能和正确答案并排看 */
function optionText(row: ReviewRow, i: number): string {
  const q = row.question
  return q.type === 'choice' ? (q.options[i] ?? '') : ''
}

/**
 * 这题算不算「代码类」—— 决定答案用不用等宽字体。
 *
 * 单独一个函数而不是在模板里写 `type === 'code' || type === 'codefill'`：
 * 那个条件在下面出现了两次，加 codefill 时漏掉一处，就会出现
 * 「同一道题，你的答案用等宽字体、正确答案用宋体」这种半截样式。
 */
function isCodeLike(row: ReviewRow): boolean {
  const t = row.question.type
  return t === 'code' || t === 'codefill' || t === 'codefix' || t === 'codewrite'
}

/**
 * 这一行该标什么。
 *
 * 真跑题型单独一个标签，理由见 `copy.ts` 里 `REVIEW_EXPECTED` 的说明：
 * 它们的「正确答案」是一整段代码，摆不进这一行，能给的是**应该输出什么**。
 */
function correctLabel(row: ReviewRow): string {
  const t = row.question.type
  return t === 'codefix' || t === 'codewrite' ? CHALLENGE.REVIEW_EXPECTED : CHALLENGE.REVIEW_CORRECT
}

/**
 * 代码填空题的答案排版：**每个空单独标号**，而不是把那一串原样倒出来。
 *
 * 会话里存的是各空按 `\n` 拼成的一串（见 shared/codefill.ts）。原样倒出来的话，
 * HTML 会把 `\n` 渲染成一个空格 —— `"int\nfor"` 显示成 `"int for"`，
 * 两个空挤成一行，看不出哪个是哪个。标上 ① ② 之后，和答题界面里
 * 输入框前面的标号是**同一套记号**，用户回头看对得上。
 */
function blanksText(joined: string, q: CodeFillQuestion): string {
  return splitCodeFillAnswer(joined, q.blanks.length)
    .map((v, i) => `${blankMark(i)} ${v.trim() === '' ? CHALLENGE.REVIEW_BLANK : v}`)
    .join('　')
}

/** 「你写的」那一行的内容。调用方已经保证 `row.your !== null` */
function yourText(row: ReviewRow): string {
  const q = row.question
  if (q.type === 'choice') {
    return typeof row.your === 'number' ? optionText(row, row.your) : String(row.your)
  }
  const s = String(row.your)
  if (q.type === 'codefill') return blanksText(s, q)
  return s.trim() === '' ? CHALLENGE.REVIEW_BLANK : s
}

/**
 * 「正确答案」那一行的文字（选择题翻成选项，代码填空逐空标号，真跑题型给期望输出）。
 *
 * 【真跑题型为什么给的是输出、不是那份参考解】
 * 参考解（`referenceFix` / `referenceSolution`）是一整段程序，而这里一屏要放
 * 五道题、每道题上面**已经**摆着学员自己那一段代码了。再各插一段参考解，
 * 这一页就变成"两屏代码对照"，回顾页该有的那种"一眼扫过去看错在哪"就没了。
 * 参考解的用处是**练习当中卡住时看一眼怎么写**（那个按钮在答题界面上），
 * 不是收工之后回顾时读的。
 */
function correctText(row: ReviewRow): string {
  const q = row.question
  if (q.type === 'choice') return optionText(row, q.answer)
  if (q.type === 'codefill') return q.blanks.map((b, i) => `${blankMark(i)} ${b.answer}`).join('　')
  if (q.type === 'codefix' || q.type === 'codewrite') return q.expectedOutput
  return q.answer
}
</script>

<template>
  <MiModal
    :visible="visible"
    :title="CHALLENGE.REVIEW_TITLE"
    :width="620"
    @update:visible="emit('update:visible', $event)"
  >
    <p class="review-hint">{{ CHALLENGE.REVIEW_HINT }}</p>

    <div class="review-list">
      <div
        v-for="(row, i) in rows"
        :key="row.key"
        class="review-item"
        :class="row.ok ? 'ok' : 'bad'"
      >
        <div class="review-head">
          <span class="review-no">{{ i + 1 }}</span>
          <span class="review-mark">{{ markOf(row) }}</span>
          <!-- AI 题要当场标出来：它的解析是 AI 写的，和内容包里校对过的不是一回事 -->
          <span v-if="row.ai" class="review-ai">{{ CHALLENGE.REVIEW_AI_TAG }}</span>
          <!--
            ⭐ 收藏（学习闭环 §6）：回顾页是**收 AI 题的唯一入口** ——
            AI 题只在每日挑战里现场出，做的时候来不及想"这题要不要留着"，
            翻回顾的时候才看得出来。`row.key` 就是当时那个全局键，
            所以收藏和这道题的其它记录（错题本）对得上同一个人。
          -->
          <FavoriteStar class="review-star" :q-key="row.key" :question="row.question" source="challenge" />
        </div>

        <!-- 题干过 `MiRichText`：内容里的题干带内联标记，裸插值会把标记符露出来 -->
        <div class="review-stem"><MiRichText :text="row.question.stem" /></div>

        <!-- 选择题：选项原样列出来，对的那个打一个标、你选错的那个打另一个标 -->
        <div v-if="row.question.type === 'choice'" class="review-options">
          <div
            v-for="(opt, oi) in row.question.options"
            :key="oi"
            class="review-option"
            :class="{ right: oi === row.question.answer, yours: !row.ok && oi === row.your }"
          >
            <span class="opt-text">{{ opt }}</span>
            <span v-if="oi === row.question.answer" class="opt-tag">{{ CHALLENGE.REVIEW_CORRECT }}</span>
            <span v-else-if="oi === row.your && !row.ok" class="opt-tag yours">
              {{ CHALLENGE.REVIEW_YOUR_CHOICE }}
            </span>
          </div>
        </div>

        <!-- 填空 / 代码：你的答案和正确答案各一行 -->
        <div v-else class="review-lines">
          <div v-if="row.your !== null" class="review-line">
            <span class="line-label">{{ CHALLENGE.REVIEW_YOUR }}</span>
            <span
              class="line-text"
              :class="{ code: isCodeLike(row), bad: !row.ok }"
            >{{ yourText(row) }}</span>
          </div>
          <!-- 答对了就不再重复一遍正确答案 —— 那两行会一模一样，纯噪音 -->
          <div v-if="!row.ok" class="review-line">
            <span class="line-label">{{ correctLabel(row) }}</span>
            <span
              class="line-text"
              :class="{ code: isCodeLike(row) }"
            >{{ correctText(row) }}</span>
          </div>
        </div>

        <!-- 解析文案过 `MiRichText`：内容是按有内联标记写的（58 条里 46 条含
             `反引号` 或 **星号**），裸插值会把标记符原样摆给学员看。
             和 `QuizOverlay` 的解析卡、错误讲解卡是同一件事，理由见 lib/rich-text.ts。 -->
        <div class="review-explain">💡 <MiRichText :text="row.question.explanation" /></div>
      </div>
    </div>

    <p v-if="rows.some((r) => r.ai)" class="review-ai-hint">{{ CHALLENGE.REVIEW_AI_HINT }}</p>

    <template #footer>
      <MiButton variant="primary" @click="emit('update:visible', false)">
        {{ CHALLENGE.REVIEW_CLOSE }}
      </MiButton>
    </template>
  </MiModal>
</template>

<style scoped>
.review-hint {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--mi-text-2);
}
.review-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.review-item {
  padding: 12px 14px;
  border-radius: var(--mi-radius-sm);
  border: 1px solid var(--mi-border);
  background: var(--mi-card);
}
/* 配色和答题页判分后那张解析卡保持一致 —— 同一个意思在软件里应当是同一个颜色。
   底和边原来都在这里手写了一遍（#effaf3 / rgba(126,217,160,.6)），
   跟 QuizChoice/QuizFill 那几处是同一个值抄了三份，现在一律走令牌。 */
.review-item.ok {
  background: var(--mi-success-fill);
  border-color: color-mix(in srgb, var(--mi-success-deep) 55%, transparent);
}
.review-item.bad {
  background: var(--mi-error-fill);
  border-color: color-mix(in srgb, var(--mi-error-deep) 55%, transparent);
}
.review-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
/* ⭐ 顶到这一行的最右边：它和左边那三个标说的是不同的事（一个是这次答得怎么样，
   一个是"我要不要留着它"），挨在一起会看着像第四个评分记号 */
.review-star {
  margin-left: auto;
}
.review-no {
  width: 20px;
  height: 20px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--mi-blue-light);
  color: var(--mi-text-2);
  font-size: 12px;
  font-weight: 600;
}
.review-mark {
  font-size: 13px;
  font-weight: 700;
}
.review-item.ok .review-mark {
  color: var(--mi-success-deep);
}
.review-item.bad .review-mark {
  color: var(--mi-error-deep);
}
.review-ai {
  margin-left: auto;
  font-size: 12px;
  color: var(--mi-text-3);
}
.review-stem {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.7;
  margin-bottom: 10px;
}
.review-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.review-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--mi-radius-sm);
  border: 1px solid var(--mi-border);
  /* 浅色下 --mi-bg 就是 #ffffff，算出来逐字节等于原来那句 rgba(255,255,255,.7)；
     深色下它变成「比卡片略亮的浮层」，而不是一块白。 */
  background: color-mix(in srgb, var(--mi-bg) 70%, transparent);
  font-size: 13px;
}
.review-option.right {
  border-color: color-mix(in srgb, var(--mi-success) 90%, transparent);
  background: color-mix(in srgb, var(--mi-success) 16%, transparent);
}
.review-option.yours {
  border-color: color-mix(in srgb, var(--mi-error) 90%, transparent);
  background: color-mix(in srgb, var(--mi-error) 16%, transparent);
}
/* min-width:0 拦住长选项把卡片撑破；标要 flex:none，否则会被压成竖排 */
.opt-text {
  flex: 1;
  min-width: 0;
}
.opt-tag {
  flex: none;
  font-size: 12px;
  font-weight: 600;
  color: var(--mi-success-deep);
}
.opt-tag.yours {
  color: var(--mi-error-deep);
}
.review-lines {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.review-line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
}
.line-label {
  flex: none;
  width: 62px;
  color: var(--mi-text-3);
}
.line-text {
  flex: 1;
  min-width: 0;
  padding: 3px 8px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--mi-bg) 75%, transparent);
  border: 1px solid var(--mi-border);
  word-break: break-word;
  white-space: pre-wrap;
}
.line-text.code {
  font-family: var(--mi-code);
  font-size: 12px;
}
.line-text.bad {
  border-color: color-mix(in srgb, var(--mi-error) 90%, transparent);
}
.review-explain {
  margin-top: 10px;
  font-size: 13px;
  color: var(--mi-text-2);
  line-height: 1.8;
}
.review-ai-hint {
  margin: 14px 0 0;
  font-size: 12px;
  color: var(--mi-text-3);
  line-height: 1.7;
}
</style>
