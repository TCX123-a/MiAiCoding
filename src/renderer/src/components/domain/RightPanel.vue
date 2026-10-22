<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useContentStore } from '../../stores/content'
import { useSettingsStore } from '../../stores/settings'
import { useLessonOpener } from '../../lib/openLesson'
import { usePracticeStarter } from '../../lib/startPractice'
import { useReviewPool } from '../../lib/review-practice'
import { LANG_LABEL } from '../../lib/labels'
import MiButton from '../base/MiButton.vue'
import MiEmpty from '../base/MiEmpty.vue'
import MiMascot from '../base/MiMascot.vue'
import { toast } from '../base/toast'
import { EMPTY, PANEL, REVIEW, TOAST } from '../../lib/copy'

// M2-04：右侧辅助面板（练习入口/复习状态/相关知识点）
// M3-05：练习入口接入 quiz 会话；相关知识点带状态图标、复用统一打开逻辑
const route = useRoute()
const router = useRouter()
const content = useContentStore()
const settings = useSettingsStore()
const pool = useReviewPool()
const { openLesson } = useLessonOpener()
const { startLessonPractice } = usePracticeStarter()

const currentLesson = computed(() =>
  route.name === 'lesson' ? content.lessonOf(String(route.params.id)) : null
)

/**
 * 相关知识点：**必须带语言徽章**。
 *
 * 【为什么】同一个知识点在四种语言里各有一节课，而**标题是一字不差的**：
 * `c-stage1-07` / `cpp-stage1-07` / `java-stage1-07` / `python-stage1-08`
 * 全叫「for 与 while——绕鱼干跑圈」。只显示标题的话，四行长得一模一样，
 * 看起来像**同一节课重复渲染了三遍** —— 主人就是这么报的（2026-09-27）。
 * 它们其实是四门语言里四节不同的课，点哪条就去哪门；看不出区别就没法选。
 *
 * 【为什么不去重】这里**没有任何重复**：四个 id 各不相同，按 id 去重一个都删不掉。
 * 真正的毛病是「四条长得一样」，所以修的是**可分辨性**，不是去重。
 * 去重反而是有害的 —— 那会把另外三门语言的课从面板上删掉。
 * 「同一节课不许出现两次」这件事由闸门保证（`content-validate.mjs` 的
 * 重复 id 检查），不在这里做静默兜底：兜底会把数据错误盖住。
 */
const refs = computed(() => {
  const l = currentLesson.value
  if (!l) return []
  return l.crossRefs.map((id) => {
    const target = content.lessonOf(id)
    return {
      id,
      title: content.titleOf(id) ?? id,
      lang: target ? LANG_LABEL[target.lang] : '',
      status: content.statusOf(id)
    }
  })
})

/**
 * 开始课后练习。
 *
 * ⚠️ 这里**必须**和详情页底部那个按钮走同一个入口（`usePracticeStarter`）。
 * 这两处原来各写了一份一模一样的实现，于是给课后练习加洗牌时，
 * 只改一处就会让「同一个动作，在两个位置点出来的卷子不一样」——
 * 而且不报错、不崩溃，只是安静地不一致。
 */
function startPractice() {
  startLessonPractice(currentLesson.value)
}

function statusIcon(status: string): string {
  if (status === 'learned') return '✓'
  if (status === 'locked') return '🔒'
  if (status === 'draft') return '📦'
  return ''
}
</script>

<template>
  <aside class="right-panel">
    <div class="panel-section">
      <div class="panel-title">{{ PANEL.TITLE_PRACTICE }}</div>
      <template v-if="currentLesson">
        <p class="panel-desc">{{ PANEL.practiceDesc(currentLesson.title) }}</p>
        <MiButton size="sm" variant="secondary" @click="startPractice">
          {{ PANEL.START_PRACTICE }}
        </MiButton>
      </template>
      <div v-else class="panel-card">{{ PANEL.NO_LESSON }}</div>
    </div>

    <!--
      每日复习卡（学习闭环 §7）。
      【为什么三种状态各有各的显示】这栏报的课数，用户会当成"复习池里有什么"：
      · `pool === null` —— 档案还没读完。此时说「先去学一课」可能是假话
        （他也许学了一堆，只是还没读到），所以只显示等待语，几十毫秒后自己变；
      · `pool === 0` —— 确实没课，指路；
      · `pool >= 1` —— 报课数 + 去复习按钮（课数只说"池子有多大"，
        做几道到复习页再选）。
      【开关关着时整段藏起来】它是用户自己关掉的功能，入口跟着一起消失，
      和 Sidebar 的处理保持一致。
    -->
    <div v-if="settings.config.reviewEnabled" class="panel-section">
      <div class="panel-title">{{ PANEL.TITLE_REVIEW }}</div>
      <template v-if="pool !== null && pool > 0">
        <p class="panel-desc">{{ PANEL.reviewDesc(pool) }}</p>
        <MiButton size="sm" variant="secondary" @click="router.push('/review')">
          {{ PANEL.GO_REVIEW }}
        </MiButton>
      </template>
      <div v-else-if="pool === 0" class="panel-card">{{ PANEL.NO_REVIEW }}</div>
      <p v-else class="panel-desc">{{ REVIEW.LOADING }}</p>
    </div>

    <div class="panel-section">
      <div class="panel-title">{{ PANEL.TITLE_RELATED }}</div>
      <div v-if="refs.length > 0" class="ref-list">
        <!-- V2-41：推荐课条目从 div 升成真 <button> —— 同一屏里有的条目
             Tab 停得上、有的停不上，行为不可预期；这里统一成按钮。 -->
        <button
          v-for="r in refs"
          :key="r.id"
          type="button"
          class="ref-item"
          :class="r.status"
          @click="openLesson(r.id)"
        >
          <span class="ref-status">{{ statusIcon(r.status) }}</span>
          <span v-if="r.lang" class="ref-lang">{{ r.lang }}</span>
          <span class="ref-title">{{ r.title }}</span>
        </button>
      </div>
      <MiEmpty v-else v-bind="EMPTY.NO_RELATED" />
    </div>

    <!--
      三段之后那条鱼。
      【为什么姿态是 think 而不是 remind】这一段下面**什么操作都没有**，
      纯粹是面板用完了剩下的空白。`remind`（叼着本子提醒你）在这个位置会读成
      「下面还有一条待办没显示出来」，而这里根本没有那条待办 —— 那是句假话。
      `think`（歪头思考）不承诺任何事，配上这栏「练习 / 复习 / 相关知识点」
      的定位，正好是「边看边想」的收尾。
      【为什么不铺满剩余高度】`.right-panel` 是 `overflow-y: auto` 的滚动容器，
      撑高度的元素在窗口变矮时会先被滚出视线。这条鱼贴着内容末尾走，
      用户滚到底就看得见。
    -->
    <div class="panel-mascot">
      <MiMascot pose="think" size="m" />
    </div>
  </aside>
</template>

<style scoped>
.right-panel {
  /* 同 Sidebar：宽度与左侧那条分割线已交给 splitpanes 的 pane 和分隔条 */
  height: 100%;
  padding: 16px 12px;
  /* glass 令牌（壁纸开时按 --mi-panel-alpha 稀释；关时逐字节同 --mi-card） */
  background: var(--mi-card-glass);
  overflow-y: auto;
  /* 同 Sidebar：.ref-item 悬浮时往右挪 2px，不挡住横向就不会闪滚动条 */
  overflow-x: hidden;
}
.panel-section {
  margin-bottom: 16px;
}
.panel-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}
.panel-desc {
  font-size: 12px;
  color: var(--mi-text-2);
  line-height: 1.8;
  margin-bottom: 8px;
}
.panel-card {
  padding: 14px;
  font-size: 12px;
  color: var(--mi-text-2);
  /* glass 令牌（同 Sidebar 那条；--mi-bg 是「浮层的白」，玻璃层对应 --mi-bg-glass） */
  background: var(--mi-bg-glass);
  border-radius: var(--mi-radius);
  box-shadow: var(--mi-shadow);
  line-height: 1.8;
}
.ref-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ref-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  font-size: 12px;
  color: var(--mi-text);
  /* glass 令牌；「悬浮时回实色」（下面 :hover 那条）是刻意的交互反馈，不在玻璃化范围 */
  background: var(--mi-bg-glass);
  border-radius: var(--mi-radius-sm);
  box-shadow: var(--mi-shadow);
  cursor: var(--mi-cursor, pointer);
  transition:
    background var(--mi-dur-fast) var(--mi-ease),
    box-shadow var(--mi-dur-fast) var(--mi-ease),
    transform var(--mi-dur-fast) var(--mi-ease);
}
/*
 * button.ref-item 重置（V2-41）：拆 UA 默认外观三件套 + 行高还原继承值
 * （理由与 Sidebar 的 button.lesson-item 同一份账）；width/text-align
 * 让按钮像 div 一样铺满整列、文字左对齐。
 */
button.ref-item {
  width: 100%;
  text-align: left;
  border: none;
  font-family: inherit;
  line-height: inherit;
  margin: 0;
}
button.ref-item:focus-visible {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 2px;
}
/* 往右挪 2px + 阴影托起来。这块本来就是「浮起来的小卡片」，
   阴影加深比背景变色更贴它自己的视觉语言。 */
.ref-item:hover {
  background: var(--mi-blue-light);
  box-shadow: var(--mi-shadow-lg);
  transform: translateX(2px);
}
.ref-item.learned .ref-title {
  color: var(--mi-success-deep);
}
/*
 * 未解锁态（locked / draft）的「压暗」不走整卡 opacity（2026-10-09 ⑧ 裁定）。
 * 【为什么】整卡 0.65 会把 12px 正文一起压暗：深色下 .ref-title 只剩 4.11、
 * .ref-lang 只剩 2.95（浅色 3.56 / 2.50）—— 而这两条**仍然可点**（@click 直连
 * openLesson），WCAG 的「禁用组件豁免」站不住，必须 ≥4.5。系数要抬到
 * ≥0.948（深）/ 0.984（浅）才能两处过线，那时「压暗」只剩正常态的 5%~15%，
 * 一眼分不出来 —— 所以锁定感改由状态位图标承担（🔒 / 📦 / ✓，见 .ref-status），
 * 正文颜色一律走正常色系。与 Sidebar 的 .lesson-status 同一口径：
 * 灰的是死的、亮的是能点的，灰留在图标上，不落在整行上。
 */
.ref-item.draft .ref-status {
  filter: grayscale(1);
  opacity: 0.45;
}
.ref-status {
  flex-shrink: 0;
  font-size: 11px;
}
/*
 * 语言徽章：让「同一课号、四种语言」的四节课分得开。
 * 样式照抄 `SearchPanel.vue` 的 `.lang-badge`（同一件事在项目里只该有一种长相），
 * 只把内边距和字号缩了一档 —— 右栏比搜索面板窄，字大了会把标题挤到折行。
 */
.ref-lang {
  flex-shrink: 0;
  padding: 1px 6px;
  font-size: 10px;
  color: var(--mi-text-2);
  background: var(--mi-blue);
  border-radius: 999px;
}
/* 徽章占了横向位置，标题要允许自己被压缩换行，否则会顶破卡片 */
.ref-title {
  min-width: 0;
}
/*
 * 底部那条鱼的落位。
 * 【为什么居中而不是靠左】它上面三段全是左对齐的卡片列表，
 * 靠左会被读成「第四段的开头」，居中才是「这栏说完了」。
 * 【为什么用 padding 不用 margin】上一段 `.panel-section` 已经带了
 * 16px 的下外边距，而**相邻兄弟的外边距会折叠** —— 这里再写 `margin-top: 16px`
 * 得到的不是 32px 而是 16px，鱼会贴上去，且这个「少了 16px」从代码上看不出来。
 * padding 不参与折叠，写多少就是多少。
 */
.panel-mascot {
  display: flex;
  justify-content: center;
  padding-top: 4px;
}
</style>
