<script setup lang="ts">
/**
 * 把 `rich-text.ts` 切好的片段画出来：强调是 `<strong>`，代码是 `<code>`。
 *
 * 【为什么做成组件，而不是两个页面各写一遍 v-for】
 * 错误讲解卡有**两个渲染点**：答题界面（`QuizCodeRun.vue`）和练习场（`RunnerPanel.vue`）。
 * 两处吃的是同一批文案（都从 `runView()` 出来），所以样式必须放在一处 ——
 * 各写一遍的话，迟早变成"答题界面里是粗体、练习场里不是"，
 * 而这种不一致没有任何人会去测。理由和 `runView()` 本身是同一个：
 * 防漂移靠的是共享的**实现**，不是共享的约定。
 *
 * 【为什么不用 v-html】
 * `splitInline()` 返回的是结构化片段，不是 HTML 字符串，Vue 按片段直接建元素。
 * 内容里的 `<` `>` 和引号天然就是文本 —— 不需要谁"记得转义"。
 */
import { computed } from 'vue'
import { splitInline } from '../../lib/rich-text'

const props = defineProps<{ text: string }>()

const segments = computed(() => splitInline(props.text ?? ''))
</script>

<template>
  <!--
    必须有且只有一个根节点，且必须是 inline 的 `<span>`：
    2026-10-01 题干排版事故 —— 本组件原先没有根节点（Fragment），
    在 `QuizOverlay.vue` 的 `.quiz-stem`（display:flex）里每个片段
    各成一个 flex item，被 min-content 压成一排竖着的窄柱。
    span 在普通文档流里与 Fragment 完全等效，却堵死了这个分裂。
    另外这里只能是 span 不能是 div：另有 12 处调用点在块级环境里
    依赖它跟着前面的文字/标签走**同一行**（如 `.ec-fix` 的「标签 + 正文」、
    `.review-explain` 的「💡 + 正文」），div 会把这些正文顶到单独一行。
  -->
  <span>
    <!--
      四个分支 = 加粗(是/否) × 代码(是/否)。
      第一种（粗体里的代码片段）是真实内容里就有的写法：
      `……**先把 `{}` 一起打出来**……`，所以不能省。
      注意：这段注释必须留在 span **里面** —— 留在外面的话 dev 构建下
      注释自己也算一个根节点（生产构建才剥注释），会 dev/prod 行为分叉、
      attrs 被当 fragment 整个丢弃。
    -->
    <template v-for="(seg, i) in segments" :key="i">
      <strong v-if="seg.bold && seg.kind === 'code'"><code>{{ seg.text }}</code></strong>
      <strong v-else-if="seg.bold">{{ seg.text }}</strong>
      <code v-else-if="seg.kind === 'code'">{{ seg.text }}</code>
      <template v-else>{{ seg.text }}</template>
    </template>
  </span>
</template>

<style scoped>
/*
 * 600 而不是默认的 700：和 `.ec-title` 保持同一个粗细。
 * 卡片里正文本来就是长段落，满屏 700 会把整块压得喘不过气。
 */
strong {
  font-weight: 600;
}
/*
 * 代码片段。在讲解卡这种正文环境里，光换成等宽字体不够 ——
 * 一行的密度没有变化，眼睛扫过去还是会把它当普通字。
 * 加一层淡蓝底 + 内边距，它才会"跳出来"变成一小块代码。
 *
 * `strong code` 要单独写一条：`code` 的颜色/背景继承父级没问题，
 * 但 `.ec-fix` 之类的地方父级有自己颜色，显式钉住更稳。
 */
code,
strong code {
  padding: 0 3px;
  border-radius: 3px;
  background: var(--mi-blue-light);
  color: var(--mi-text);
  font-family: var(--mi-code);
  font-size: 0.95em;
}
</style>
