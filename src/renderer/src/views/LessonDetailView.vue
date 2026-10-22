<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useContentStore } from '../stores/content'
import { useProgressStore } from '../stores/progress'
import { useRunnerStore } from '../stores/runner'
import { useLessonOpener } from '../lib/openLesson'
import { usePracticeStarter } from '../lib/startPractice'
import { LANG_LABEL, STAGE_LABEL } from '../lib/labels'
import {
  firstRunnableBlock,
  renderMarkdown,
  collectCompare,
  splitSlots,
  type CompareBlock,
  type DemoBlock,
  type SlotPart
} from '../lib/md'
import MiCard from '../components/base/MiCard.vue'
import MiButton from '../components/base/MiButton.vue'
import MiTag from '../components/base/MiTag.vue'
import MiEmpty from '../components/base/MiEmpty.vue'
import CompareGrid from '../components/domain/CompareGrid.vue'
import DemoPlayer from '../components/domain/DemoPlayer.vue'
import { toast } from '../components/base/toast'
import { ACTION, EMPTY, LESSON, TOAST } from '../lib/copy'

// M3-02：知识点详情页（元信息 + markdown 正文 + compare 对比区 + 底部操作栏）
const route = useRoute()
const router = useRouter()
const content = useContentStore()
const progress = useProgressStore()
const runner = useRunnerStore()
const { openLesson } = useLessonOpener()
const { startLessonPractice } = usePracticeStarter()

const id = computed(() => String(route.params.id ?? ''))
const lesson = computed(() => content.lessonOf(id.value))
const status = computed(() => (id.value ? content.statusOf(id.value) : 'draft'))
/**
 * 课号在不在大纲里 —— 和 `lesson` **不是一回事**：
 * `lesson` 只认写好正文的那 5 节，`inOutline` 认全部 194 节。
 * 判断「课号对不对」用它，判断「有没有正文可渲染」用 lesson。
 */
const inOutline = computed(() => (id.value ? content.inOutline(id.value) : false))

const isLearned = computed(() => progress.profile.learned.includes(id.value))
const isFavorite = computed(() => progress.profile.favorites.includes(id.value))

/**
 * 下一课（V2-15 / V1-24）：大纲顺序里**这一课之后**第一节有正文的课。
 * 判据在 content store → `shared/lesson-nav.ts`（纯函数、有单测；
 * 那里记着"为什么不能拿 nextUpId 顶用"的现场）。null = 没有下一课
 * （已经是最后一节），按钮整颗不出现 —— 不给一颗点不动的。
 */
const nextId = computed(() => (id.value ? content.nextWrittenAfterId(id.value) : null))

/** 正文渲染结果（compare / demo 块都换成占位元素 + 结构数据） */
const rendered = computed(() => (lesson.value ? renderMarkdown(lesson.value.body) : null))

/**
 * 正文切成的片段序列：`html` 段直接贴，`compare` 段渲染 CompareGrid，
 * `demo` 段渲染 DemoPlayer。
 *
 * 【为什么要切开，而不是把整篇 HTML 一次 v-html】
 * 这两种块都是 Vue 组件（对比块列头带复制/运行按钮，演示块带步进控件），
 * 塞不进 `v-html` 的字符串里。详情页只能把正文按占位元素切成几截，
 * 在切缝里插组件 —— 这样它们就出现在**课文提到它的那个位置**，
 * 而不是被挪到整篇文章的最后。
 *
 * 【2026-09-19：`splitCompareSlots` 改名成 `splitSlots`】
 * 演示块和对比块走的是同一个切分器（判据只有一处，理由见 `lib/md.ts`）。
 * 切出来的片段多了 `demo` 这一种 kind，所以类型也从 `ComparePart` 变成 `SlotPart`。
 */
const bodyParts = computed<SlotPart[]>(() =>
  rendered.value ? splitSlots(rendered.value.html) : []
)

/**
 * 第 i 个演示块 —— 找不到时给 `null`。
 *
 * 【为什么要这个函数，而不是模板里直接 `rendered.demoBlocks[p.index]`】
 * 占位元素里的编号来自渲染那一侧，和 `demoBlocks` 数组本该一一对应；
 * 万一哪天线接错了（比如 `env` 传的是一个、读的是另一个），
 * 模板里的 `undefined` 会让组件在**渲染中途**炸掉，整页白屏。
 * 这里返回 `null`，模板用 `v-if` 跳过那一个块 —— 坏一个块，正文还在。
 */
function demoAt(index: number): DemoBlock | null {
  return rendered.value?.demoBlocks[index] ?? null
}

/**
 * 语言课引用的通用课对比块（lesson.compare: [common-XX]）。
 *
 * 这些块在**本课正文里没有位置**（它们来自另一课），所以只能整体附在文末。
 */
const referencedBlocks = computed<CompareBlock[]>(() => {
  const l = lesson.value
  if (!l || l.compare.length === 0) return []
  return l.compare.flatMap((refId) => {
    const refLesson = content.lessonOf(refId)
    return refLesson ? collectCompare(refLesson.body) : []
  })
})

const lockedRequired = computed(() =>
  lesson.value ? lesson.value.required.map((r) => ({ id: r, title: content.titleOf(r) ?? r })) : []
)

// 正文内交互（事件委托）：复制按钮 + lesson:// 链接
function onBodyClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const copyBtn = target.closest('[data-copy]')
  if (copyBtn) {
    const codeEl = copyBtn.closest('.code-block')?.querySelector('code')
    if (codeEl) void copyText(codeEl.textContent ?? '')
    return
  }
  const link = target.closest('[data-lesson]')
  if (link) {
    const targetId = link.getAttribute('data-lesson') ?? ''
    if (targetId) openLesson(targetId)
  }
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  toast(TOAST.CODE_COPIED, 'success')
}

function toggleLearned() {
  progress.markLearned(id.value, !isLearned.value)
  toast(isLearned.value ? TOAST.MARK_LEARNED_ON : TOAST.MARK_LEARNED_OFF, 'success')
}

function toggleFavorite() {
  progress.toggleFavorite(id.value)
  toast(isFavorite.value ? TOAST.FAVORITE_ON : TOAST.FAVORITE_OFF, 'success')
}

/**
 * 开始课后练习。
 *
 * 抽题、洗题目顺序、洗选项顺序**都在 `usePracticeStarter` 里**，这里只负责传课。
 * 之所以不再就地写那三行：右栏有一个一模一样的按钮，两份分开写的话，
 * 改了一处忘了另一处，同一个动作在两个位置点出来的卷子会不一样 —— 不报错。
 */
function startPractice() {
  startLessonPractice(lesson.value)
}

/**
 * 把这一课的示例代码送进练习场跑（对应底部操作栏的「运行代码」）。
 *
 * 【为什么是「完整的那一块」而不是第一块】见 `lib/md.ts` 的 `firstRunnableBlock`：
 * 课文里第一段带标签的代码常是片段（`int fish = 3;`），原样送进练习场会
 * 编译/链接失败，看起来像应用发了段坏代码。
 *
 * 【为什么挑不到时只提示、不跳转】空着手跳过去，练习场显示的是上一次的
 * 草稿 —— 用户会以为这节课的代码已经在编辑器里了。留在原地说明去哪复制，
 * 比把人丢到一个没有这节课代码的页面诚实。
 */
function runCode() {
  const block = lesson.value ? firstRunnableBlock(lesson.value.body) : null
  if (!block) {
    toast(TOAST.NO_RUNNABLE_CODE, 'warn')
    return
  }
  runner.setCode(block.lang, block.code)
  toast(TOAST.CODE_SENT_TO_PLAYGROUND, 'success')
  router.push('/playground')
}

// 切课时滚动到顶部
function scrollTop() {
  document.querySelector('main.content')?.scrollTo({ top: 0 })
}
onMounted(scrollTop)
watch(id, scrollTop)
</script>

<template>
  <div class="lesson-page">
    <!--
      课号在大纲里根本不存在（手改 URL / 过期链接）。**这一条必须问 inOutline，
      不能问 lesson** —— `lesson` 只认写好正文的那 5 节，用它判会把 189 节空壳课
      全部说成「课号不对」，正是主人抱怨的那类误导（详见 stores/content.ts）。
    -->
    <MiCard v-if="!inOutline" class="block-card">
      <MiEmpty v-bind="EMPTY.LESSON_NOT_FOUND" />
    </MiCard>

    <!-- 正文还没写：给他一条出路，别只把人晾在「还在写」三个字上 -->
    <MiCard v-else-if="status === 'draft'" class="block-card">
      <MiEmpty v-bind="EMPTY.LESSON_DRAFT">
        <div class="block-actions">
          <MiButton v-if="content.nextUpId" variant="primary" @click="openLesson(content.nextUpId)">
            {{ ACTION.GO_WRITTEN }}
          </MiButton>
          <MiButton variant="ghost" @click="router.back()">{{ ACTION.BACK }}</MiButton>
        </div>
      </MiEmpty>
    </MiCard>

    <!-- 锁定：显示前置课 -->
    <MiCard v-else-if="status === 'locked'" class="block-card">
      <MiEmpty v-bind="EMPTY.LESSON_LOCKED" />
      <div class="required-list">
        <!-- V2-41：锁定页里「先学这门」是屏内最直接的出路 —— div 版
             键盘党点不开（搜索面板还能按课名兜，但屏内这条路不该断）。
             升成真 <button>，点击行为不变。 -->
        <button
          v-for="r in lockedRequired"
          :key="r.id"
          type="button"
          class="required-item"
          @click="openLesson(r.id)"
        >
          <span class="required-icon">{{ content.statusOf(r.id) === 'learned' ? '✓' : '🔒' }}</span>
          <span class="required-title">{{ r.title }}</span>
          <span class="required-arrow">›</span>
        </button>
      </div>
      <div class="block-actions">
        <MiButton variant="ghost" @click="router.back()">{{ ACTION.BACK }}</MiButton>
      </div>
    </MiCard>

    <!-- 正文 -->
    <template v-else-if="lesson">
      <div class="lesson-head">
        <div class="lesson-badges">
          <MiTag :color="lesson.lang === 'common' ? 'blue' : 'green'">
            {{ LANG_LABEL[lesson.lang] }}
          </MiTag>
          <MiTag v-if="lesson.lang !== 'common'" color="purple">
            {{ LESSON.stageSuffix(STAGE_LABEL[lesson.stage] ?? String(lesson.stage)) }}
          </MiTag>
          <MiTag v-if="isLearned" color="green">{{ LESSON.STATUS_LEARNED }}</MiTag>
          <MiTag v-else color="blue">{{ LESSON.STATUS_LEARNING }}</MiTag>
        </div>
        <h1 class="lesson-title">{{ lesson.title }}</h1>
        <div class="lesson-meta">
          <MiTag v-for="t in lesson.tags" :key="t" color="gray">{{ t }}</MiTag>
          <MiTag color="gray" class="lesson-minutes">{{ LESSON.estMinutes(lesson.estMinutes) }}</MiTag>
        </div>
      </div>

      <MiCard>
        <!--
          正文按 `.compare-slot` 占位元素切成几截，在切缝里插 CompareGrid ——
          对比块于是出现在**课文提到它的那个位置**，而不是整篇文章的最后。

          ⚠️ **切出来的每一截各是一个 `<article class="markdown-body">`，
          不是一个 article 里套几个 div**。两种写法看着都对，差别在 CompareGrid：
          它一旦落进 `.markdown-body`，就会继承那儿的 `font-size: 14px;
          line-height: 1.9`（`md.css`），而它原本是挂在 `.lesson-page` 下的。
          对比块的按钮和标题会被这行 1.9 悄悄撑高一点 —— 不报错、不崩，
          只是"看着和以前不一样了"。分成多个 article 就没有这个问题：
          对比块始终在 `.markdown-body` **外面**，样式上下文和以前一字不差。

          （正文里没有这两种块时，切出来就一截，DOM 和改动前完全一样。）

          ── 2026-09-19 新增：`demo` 段渲染 DemoPlayer ──
          它和 CompareGrid 落在**同一个层级**（`<article>` 外面），所以上一条
          「不要落进 .markdown-body」的理由对它一样成立：演示块的步骤条、
          变量行都是按自己的字号排的，被 `.markdown-body` 的 1.9 行高接管会整体发虚。
        -->
        <template v-for="(part, i) in bodyParts" :key="i">
          <article
            v-if="part.kind === 'html'"
            class="markdown-body"
            v-html="part.html"
            @click="onBodyClick"
          />
          <CompareGrid
            v-else-if="part.kind === 'compare' && rendered?.compareBlocks[part.index]"
            :blocks="[rendered.compareBlocks[part.index]]"
          />
          <DemoPlayer
            v-else-if="part.kind === 'demo' && demoAt(part.index)"
            :block="demoAt(part.index)!"
          />
        </template>
      </MiCard>

      <CompareGrid v-if="referencedBlocks.length > 0" :blocks="referencedBlocks" />

      <div class="lesson-actions">
        <MiButton
          :variant="isLearned ? 'ghost' : 'primary'"
          @click="toggleLearned"
        >
          {{ isLearned ? ACTION.LEARNED : ACTION.MARK_LEARNED }}
        </MiButton>
        <MiButton variant="secondary" @click="startPractice">{{ ACTION.ENTER_QUIZ }}</MiButton>
        <MiButton variant="secondary" @click="runCode">{{ ACTION.RUN_CODE }}</MiButton>
        <MiButton variant="ghost" @click="toggleFavorite">
          {{ isFavorite ? ACTION.FAVORITED : ACTION.FAVORITE }}
        </MiButton>
        <!--
          下一课（V2-15 / V1-24）：主链是单线前进，课末必须有一个往前走一步的
          出口 —— 没有它，每学完一节都要回侧栏从几十行截断的课名里认下一行。
          摆在最右（"向前"的方向就是右手边）；没有下一课时整颗不出现。
          title 带下一课的名字：点之前就知道去哪儿，不用点进去才发现。
        -->
        <MiButton
          v-if="nextId"
          variant="secondary"
          :title="ACTION.nextLessonTitle(content.titleOf(nextId) ?? '')"
          @click="openLesson(nextId)"
        >
          {{ ACTION.NEXT_LESSON }}
        </MiButton>
      </div>
    </template>
  </div>
</template>

<style scoped>
.lesson-page {
  max-width: 860px;
  margin: 0 auto;
}
.block-card {
  margin-top: 40px;
}
.required-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 420px;
  margin: 12px auto 0;
}
.required-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  /* glass 令牌：壁纸关时逐字节同 --mi-card；开时按 --mi-panel-alpha 稀释 */
  background: var(--mi-card-glass);
  cursor: var(--mi-cursor, pointer);
  /*
   * 原先这里是 `transition: all .15s ease`。改成把属性一个个写出来 ——
   * `all` 会连**你没打算动的东西**一起过渡（这个元素身上有 border-radius、
   * padding、font-size），将来谁调一下 padding，它会莫名其妙地「滑」过去。
   * 而且 `all` 和 auto-animate 的内联 transform 会抢同一个属性，埋雷。
   */
  transition:
    background var(--mi-dur-fast) var(--mi-ease),
    border-color var(--mi-dur-fast) var(--mi-ease),
    transform var(--mi-dur-fast) var(--mi-ease),
    box-shadow var(--mi-dur-fast) var(--mi-ease);
}
/*
 * button.required-item 重置（V2-41）：铺满 + 左对齐 + 字体/行高继承
 * （与 Sidebar button.lesson-item、RightPanel button.ref-item 同一份账）。
 * border 不动 —— 上面类里那条 1px 描边是它的卡片外观。
 */
button.required-item {
  width: 100%;
  text-align: left;
  color: inherit;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  margin: 0;
}
button.required-item:focus-visible {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 2px;
}
.required-item:hover {
  background: var(--mi-blue-light);
  border-color: var(--mi-blue);
  transform: translateX(2px);
  box-shadow: var(--mi-shadow);
}
.required-icon {
  flex-shrink: 0;
  font-size: 13px;
}
.required-title {
  flex: 1;
  font-size: 13px;
  color: var(--mi-text);
}
.required-arrow {
  color: var(--mi-text-3);
}
.block-actions {
  display: flex;
  /* 备课中那个分支现在有两个按钮（去学写好的课 / 返回），没有缝它们会贴在一起。
     锁定分支只有一个，加 gap 对它无害。 */
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 16px;
}
.lesson-head {
  margin-bottom: 14px;
}
.lesson-badges {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.lesson-title {
  font-family: var(--mi-font-title);
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 8px;
}
.lesson-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}
/*
 * 「⏱ 约 15 分钟」。它现在是最后一枚 MiTag（灰 chip，与同排标签同款）——
 * 右对齐（margin-left:auto）与 12px 不变。为什么必须上 chip：这一行里只有它是
 * **裸文字直接坐在 layout 玻璃面上**，而近白壁纸下那块合成底最亮（#4d5157），
 * 三级文字压上去只有 2.68（2026-10-09 审计实测）。chip 的底是实色 --mi-zebra
 * （α1），壁纸透不到字背后，链就断在这里。
 * 不写 color：字色由 MiTag 的 .gray（--mi-text-2）决定，免得同一元素两处各写一份。
 */
.lesson-minutes {
  margin-left: auto;
  font-size: 12px;
}
.lesson-actions {
  display: flex;
  gap: 10px;
  /* 极端[4]（2026-10-16）：中栏拖窄/高缩放下四个按钮曾被压成一字一行的竖条，
     窄到 1000px 时「☆ 收藏」整个被裁没。同页 .block-actions（备课中分支）
     一直是换行的 —— 补齐同一行为，别让同一页两副面孔。 */
  flex-wrap: wrap;
  margin: 20px 0 40px;
  padding: 14px;
  /* glass 令牌（同上） */
  background: var(--mi-card-glass);
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-lg);
}
</style>
