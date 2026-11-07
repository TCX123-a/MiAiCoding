<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
import MiModal from '../components/base/MiModal.vue'
import CompareGrid from '../components/domain/CompareGrid.vue'
import DemoPlayer from '../components/domain/DemoPlayer.vue'
import { toast } from '../components/base/toast'
import {
  clampScrollTop,
  readLessonScroll,
  writeLessonScroll,
  type ScrollStorage
} from '../lib/lesson-scroll'
import { ACTION, EMPTY, LESSON, SETTLE, TOAST } from '../lib/copy'
import { PET_REWARD_RICE } from '../../../shared/pet'

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

// ---- 「学到这里啦喵」（2026-10-31）：一键把前面的课全部点亮 ----
/** 确认框开着时，这次要变绿的课（含本课） */
const settleTargets = ref<string[]>([])
const settleConfirmOpen = ref(false)
const settleBusy = ref(false)
/** 结算结果弹窗：{ 新变绿几课, 实际到账几碗, 实际涨几点好感（null = 桌宠没起来算不出） } */
const settleResult = ref<{
  newLessons: number
  rice: number | null
  affection: number | null
} | null>(null)

/** 这一次点「学到这里啦喵」会动到哪些还没绿的课（大纲前缀，见 content store） */
function unlearnedPrefix(): string[] {
  const prefix = content.writtenPrefixUpTo(id.value)
  return prefix.filter((x) => !progress.learnedSet.has(x))
}

async function settle(ids: readonly string[]): Promise<void> {
  if (ids.length === 0 || settleBusy.value) return
  settleBusy.value = true
  try {
    const res = await progress.markLearnedMany(ids)
    progress.clearPendingSettle(id.value)
    settleConfirmOpen.value = false
    settleTargets.value = []
    settleResult.value = {
      newLessons: res.newLessons,
      rice: res.riceCredited,
      affection: res.affectionCredited
    }
  } catch {
    // 写盘/桌宠出岔子：不能假装成功。关窗那条路有自己的兜底文案
    toast(TOAST.PROFILE_SAVE_FAILED, 'error')
  } finally {
    settleBusy.value = false
  }
}

/**
 * 按钮入口：没有前置要补就只标本课；有的话先确认。
 *
 * 【为什么"只有本课没学"也要走批量函数】
 * 发饭、history、写协议账本、防抖保存这四件事只有一条实现 ——
 * 单课路径 `markLearned` 与批量路径各写一份，迟早出现「同一课在两处发不同碗数」。
 */
function onSettleClick(): void {
  if (!lesson.value) return
  const unlearned = unlearnedPrefix()
  if (unlearned.length === 0) {
    toast(SETTLE.NOTHING_BEFORE, 'success')
    return
  }
  if (unlearned.length === 1 && unlearned[0] === id.value) {
    void settle(unlearned)
    return
  }
  settleTargets.value = unlearned
  settleConfirmOpen.value = true
}

/** 取消学习标记（保留旧能力；它不是"学到这里"的反向操作） */
function unlearn(): void {
  progress.markLearned(id.value, false)
  progress.clearPendingSettle(id.value)
  toast(TOAST.MARK_LEARNED_OFF, 'success')
}

// ---- 读到末尾就算"刚刚学完"（关窗拦截的判据，见 App.vue） ----
let scroller: HTMLElement | null = null

/**
 * 滚动位置的存档（2026-11-01 主人令）。
 *
 * 【为什么防抖 400ms 而不是每次 scroll 都写】
 * 一次滚轮能发几十个 scroll；localStorage 的写是同步的，每次都写会在
 * 低端机上把滚动拖出顿挫。400ms 在「切页面立刻回来」的场景里也够用：
 * 离开时 unmount / pagehide 还会各兜一次底（见下）。
 *
 * 【为什么恢复期间要挡住「读到末尾」】
 * 程序化 scrollTo 同样会派发 scroll 事件。不挡的话，恢复到一个存下来的
 * 底部位置会被当成用户刚读到末尾，悄悄替人记上「刚学完」—— 打开课文
 * 就触发关窗拦截，正是最烦的那种假状态。
 */
const SAVE_DEBOUNCE_MS = 400
/** 恢复最多试 30 帧（约 0.5s）。内容还没撑开时多等几帧，够了就停。 */
const RESTORE_MAX_FRAMES = 30

/** 当前这一份课文的内存快照属于哪个课号（路由切换时先写旧号再换） */
let trackedId = id.value
let restoring = false
let userTookOver = false
let restoreToken = 0
let saveTimer: ReturnType<typeof setTimeout> | null = null

/** 隐私模式 / 配额满时访问 localStorage 本身就会抛 —— 存储不可用就等于没有记忆 */
function scrollStorage(): ScrollStorage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** 立刻写死当前位置（离开页面、关窗、切后台、切课前各调一次） */
function saveScrollNow(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  // 恢复还没落定、用户也没接手：此刻的 scrollTop 是程序刚设的中间值，
  // 写回去会把原来存下的位置覆盖掉（切页面快一点就能触发）。
  if (restoring && !userTookOver) return
  if (!scroller || trackedId === '') return
  writeLessonScroll(scrollStorage(), trackedId, scroller.scrollTop)
}

function scheduleScrollSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveScrollNow()
  }, SAVE_DEBOUNCE_MS)
}

/** 用户只要真的动手滚/点，就把恢复让给他 —— 不能把人从当前位置硬拽走 */
function onUserScrollIntent(): void {
  if (!restoring) return
  userTookOver = true
  restoring = false
}

const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '])
function onScrollKey(e: KeyboardEvent): void {
  if (restoring && SCROLL_KEYS.has(e.key)) onUserScrollIntent()
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') saveScrollNow()
}

/**
 * 恢复上次读到的位置。
 *
 * 三处必须一起成立，缺一条都会静默失败：
 * ① 等正文把 DOM 高度撑开（`scrollHeight` 还是 0 时 scrollTo 无处可去）；
 * ② 每次按**当前**可滚范围夹一遍（课文改版后旧位置可能超出新长度）；
 * ③ 用户一动手就停（恢复是"接上上次"，不是"抢方向盘"）。
 */
function restoreScroll(lessonId: string, saved: number): void {
  if (saved <= 0) return
  const token = ++restoreToken
  restoring = true
  userTookOver = false
  let frames = 0

  const tick = (): void => {
    if (token !== restoreToken || trackedId !== lessonId) return
    if (!scroller || userTookOver) {
      restoring = false
      return
    }
    const max = scroller.scrollHeight - scroller.clientHeight
    const target = clampScrollTop(saved, max)
    if (Math.abs(scroller.scrollTop - target) > 1) scroller.scrollTop = target
    frames++
    if (frames < RESTORE_MAX_FRAMES) {
      requestAnimationFrame(tick)
      return
    }
    /*
     * 最后一帧设完 scrollTop 后，浏览器派发的 scroll 事件在**下一次渲染**才到；
     * 此刻立刻把 restoring 放掉的话，那一发程序滚动会被当成用户滚动 ——
     * 存档位置恰好在底部时，打开课文就替人记上「读到末尾」。
     * 多等一帧再解除守卫。
     */
    requestAnimationFrame(() => {
      if (token === restoreToken) restoring = false
    })
  }
  requestAnimationFrame(tick)
}

/** 这一课没有存档时回到顶部（和旧行为一致，只是不再无条件清掉别的课的存档） */
function goTop(): void {
  scroller?.scrollTo({ top: 0 })
}

/** 挂上这一课的位置记忆：读存档 → 恢复或置顶 */
function armScrollMemory(lessonId: string): void {
  if (!scroller) scroller = document.querySelector<HTMLElement>('main.content')
  if (!scroller) return
  const saved = readLessonScroll(scrollStorage(), lessonId)
  if (saved > 0) {
    restoreScroll(lessonId, saved)
    return
  }
  goTop()
  restoring = false
}

function onContentScroll(): void {
  if (!scroller || trackedId === '') return
  // 恢复期间的滚动是程序发的：既不存（会把夹过的位置写回去），也不算读完
  if (restoring) return
  scheduleScrollSave()
  if (!lesson.value || isLearned.value) return
  // 48px 的余量：最后一段代码块/提示框的底边贴着视口底不算"没读完"
  if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 48) {
    progress.noteLessonEnd(trackedId)
  }
}

/**
 * 整篇一屏放得下时**根本不会产生滚动事件** —— 只靠 onContentScroll 的话，
 * 短课永远不算「读到底」，关窗拦截对它们是一道静默失效的闸。
 * 停留 3 秒再记：刚点开就记会把「只是路过看一眼」也当成学完。
 */
let shortPageTimer: ReturnType<typeof setTimeout> | null = null
function armShortPageCheck(): void {
  if (shortPageTimer !== null) {
    clearTimeout(shortPageTimer)
    shortPageTimer = null
  }
  if (!scroller || !lesson.value || isLearned.value) return
  if (scroller.scrollHeight > scroller.clientHeight + 48) return
  shortPageTimer = setTimeout(() => {
    shortPageTimer = null
    if (!isLearned.value) progress.noteLessonEnd(trackedId)
  }, 3000)
}

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

// 切课时滚动到顶部 / 恢复上次位置：见上面的 armScrollMemory（2026-11-01）
onMounted(() => {
  // 关窗拦截要知道「最后停在哪一课」：打开就算，不要求滚到底。
  // 放在 nextTick 外面 —— 即使滚动容器一时找不到，这一课也已经被访问过。
  progress.noteLessonVisit(trackedId)
  void nextTick(() => {
    // 滚动容器是内层 `main.content`，不是 document —— 见 App.vue 的 .content
    scroller = document.querySelector<HTMLElement>('main.content')
    if (!scroller) return
    scroller.addEventListener('scroll', onContentScroll, { passive: true })
    scroller.addEventListener('wheel', onUserScrollIntent, { passive: true })
    scroller.addEventListener('touchstart', onUserScrollIntent, { passive: true })
    scroller.addEventListener('pointerdown', onUserScrollIntent, { passive: true })
    window.addEventListener('keydown', onScrollKey, { passive: true })
    // 关窗 / 切后台：防抖还没落地的那一段也要写死
    window.addEventListener('beforeunload', saveScrollNow)
    window.addEventListener('pagehide', saveScrollNow)
    document.addEventListener('visibilitychange', onVisibilityChange)
    armScrollMemory(trackedId)
    armShortPageCheck()
  })
})
onBeforeUnmount(() => {
  // 顺序：先存旧位置，再拆监听，最后让在跑的恢复循环失效
  saveScrollNow()
  restoreToken++
  restoring = false
  scroller?.removeEventListener('scroll', onContentScroll)
  scroller?.removeEventListener('wheel', onUserScrollIntent)
  scroller?.removeEventListener('touchstart', onUserScrollIntent)
  scroller?.removeEventListener('pointerdown', onUserScrollIntent)
  window.removeEventListener('keydown', onScrollKey)
  window.removeEventListener('beforeunload', saveScrollNow)
  window.removeEventListener('pagehide', saveScrollNow)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  scroller = null
  if (shortPageTimer !== null) {
    clearTimeout(shortPageTimer)
    shortPageTimer = null
  }
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
})
watch(id, (nextId) => {
  // 同组件内换课（路由 key 保证多数时候会重建；真被复用时也不能把位置带过去）
  saveScrollNow()
  trackedId = nextId
  progress.noteLessonVisit(nextId)
  restoreToken++
  // 下一帧 armScrollMemory 之前，旧页面的 scrollTop 会被新正文的高度变化带走；
  // 先把守卫立起来，避免那一发中间滚动被写进新课的键里
  restoring = true
  userTookOver = false
  void nextTick(() => {
    armScrollMemory(nextId)
    armShortPageCheck()
  })
})
// 学完（含答题自动标记）就把"待结算"摘掉 —— 关窗时不该再拦一次
watch(
  isLearned,
  (v) => {
    if (v) progress.clearPendingSettle(id.value)
  },
  { immediate: true }
)
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

    <!--
      未解锁 → **软锁**（2026-10-31 主人令）：不再拦人，正文照常渲染，
      只在顶上提醒一句"这门课可能有点难哦喵"。真正的解锁动作交给课末的
      「学到这里啦喵」——一键把前面的课全部点亮，见脚本里的 settle()。
    -->
    <template v-else-if="lesson">
      <div v-if="status === 'locked'" class="lesson-soft-lock">
        <span class="lesson-soft-lock-icon">🐟</span>
        <p class="lesson-soft-lock-text">{{ SETTLE.LOCK_WARNING }}</p>
      </div>

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
        <MiButton :variant="isLearned ? 'ghost' : 'primary'" @click="onSettleClick">
          <span class="settle-btn-stack">
            <span>{{ isLearned ? ACTION.SETTLE_HERE_LEARNED : ACTION.SETTLE_HERE }}</span>
            <span v-if="!isLearned" class="settle-btn-sub">{{ ACTION.SETTLE_SUB }}</span>
          </span>
        </MiButton>
        <!-- 旧的"取消标记"能力保留，但它不再是主按钮 -->
        <MiButton v-if="isLearned" variant="ghost" @click="unlearn">
          {{ ACTION.LEARNED }}
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

    <!-- 确认框：前面还有没绿的课，讲清楚会一起点亮、饭按课数发 -->
    <MiModal
      v-model:visible="settleConfirmOpen"
      :title="SETTLE.CONFIRM_TITLE"
      :width="520"
      :closable="!settleBusy"
    >
      <p class="settle-text">
        {{ SETTLE.CONFIRM_BODY(settleTargets.length, settleTargets.length * PET_REWARD_RICE.lesson) }}
      </p>
      <div class="settle-actions">
        <MiButton variant="ghost" :disabled="settleBusy" @click="settleConfirmOpen = false">
          {{ SETTLE.CONFIRM_CANCEL }}
        </MiButton>
        <MiButton variant="primary" :disabled="settleBusy" @click="settle(settleTargets)">
          {{ SETTLE.CONFIRM_OK }}
        </MiButton>
      </div>
    </MiModal>

    <!-- 到账弹窗：显眼位置报「大白饭 +X 已到账喵！」 -->
    <MiModal
      :visible="settleResult !== null"
      :title="SETTLE.RESULT_TITLE"
      :width="460"
      @close="settleResult = null"
    >
      <p class="settle-text settle-result">
        {{
          settleResult
            ? SETTLE.RESULT_BODY(
                settleResult.newLessons,
                settleResult.rice,
                settleResult.affection
              )
            : ''
        }}
      </p>
      <div class="settle-actions">
        <MiButton variant="primary" @click="settleResult = null">{{ SETTLE.RESULT_OK }}</MiButton>
      </div>
    </MiModal>
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
/* 软锁提醒：不拦人，只把"这课可能有点难"说在前面 */
.lesson-soft-lock {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  margin-bottom: 14px;
  border: 1px solid var(--mi-warn-edge);
  border-radius: var(--mi-radius-sm);
  background: var(--mi-warn-fill);
}
.lesson-soft-lock-icon {
  flex-shrink: 0;
  font-size: 18px;
  line-height: 1.4;
}
.lesson-soft-lock-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--mi-warn-deep);
}
.settle-text {
  margin: 0 0 18px;
  font-size: 14px;
  line-height: 1.8;
  color: var(--mi-text);
}
.settle-result {
  font-size: 15px;
  font-weight: 600;
}
/*
 * 「学到这里啦喵」两行式：主文案 + 一句小字说明动作。
 * 一行按钮里塞不下"点了会发生什么"，而这是本页唯一会改写学习进度的按钮 ——
 * 第一次看到的人有权在点之前知道它只是标记，不是"跳到下一课"。
 */
.settle-btn-stack {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  line-height: 1.25;
}
.settle-btn-sub {
  font-size: 10px;
  font-weight: 400;
  /* 用当前文字色的 78% 稀释，不写 opacity：整段 opacity 会让 10px 小字连
     抗锯齿一起变淡，且全库 opacity 闸门要求新增必须先过人工审。 */
  color: color-mix(in srgb, currentColor 78%, transparent);
}
.settle-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
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
