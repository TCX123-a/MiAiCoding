<script setup lang="ts">
/**
 * M?-01：知识点动态演示播放器（`demo` 围栏的渲染组件，2026-09-19 新增）。
 *
 * 【它只做一件事：把作者写好的第 N 步显示出来】
 * 播放器**不推断任何东西**：高亮哪一行、变量是什么值、这一句在讲什么，
 * 全都是课文里逐字写好的（格式见 `lib/md.ts` 的 `parseDemo`）。
 * 这里只负责「换到第 N 步」+「换的时候动一下」，没有任何教学判断。
 *
 * 【默认不自动播放】
 * 主人点一下才动。理由有两条：
 *   ① 课文读到一半，眼睛还在上一句，底下自己动起来是**抢注意力**；
 *   ② docs/04 把正文阅读区列为「不许有动画」的地方，这条块是它唯一的例外
 *      （例外条款见 docs/04 §6.2）。例外的边界就靠「用户主动要求才动」来守。
 *
 * 【减动效：不是「动得慢一点」，是「直接跳到终态」】
 * `styles/motion.css` 的总闸只能盖住 CSS transition / animation，而 anime.js 是
 * 在 rAF 里**逐帧写内联样式**的，`transition-duration: 1ms !important` 对它**完全无效**。
 * 所以这里必须自己挂一层 `matchMedia` 闸门 —— 少了它，开了「减弱动效」的用户
 * 照样会看到画面在动，而且**没有任何地方会报错**。
 * 降级方式对教学反而更好：步进按钮一个不少，每步仍然到位，
 * 只是不再补间。「循环怎么走」这件事的信息量一点没少。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { animate, set as applyStyles } from 'animejs'
import MiMascot from '../base/MiMascot.vue'
import { DEMO } from '../../lib/copy'
import type { MascotPose } from '../../lib/mascot'
import type { DemoBlock } from '../../lib/md'

const props = defineProps<{ block: DemoBlock }>()

/** 当前停在第几步（0 起）。**初始是第 1 步，不是自动开跑** */
const step = ref(0)
/** 正在自动播放。播放中那个按钮会变成「暂停」 */
const playing = ref(false)

const root = ref<HTMLElement | null>(null)
/** 高亮条：绝对定位在代码区里，靠 translateY 走到当前那一行 */
const bar = ref<HTMLElement | null>(null)
/** 气泡那一格。每换一步弹一下，作为「这句是新出来的」的提示 */
const bubble = ref<HTMLElement | null>(null)

const total = computed(() => props.block.steps.length)
const current = computed(() => props.block.steps[step.value] ?? null)
const title = computed(() => props.block.title || DEMO.DEFAULT_TITLE)

/**
 * 这块演示要不要带大肥鱼气泡。
 *
 * 【判据是「作者写了没有」，不是「这是哪一课」】
 * 主人这次的边界是「只给循环、堆栈、递归这类复杂知识点加，基础概念不加」。
 * 但组件**不该知道课号** —— 把 `lessonId === 'common/06-loop'` 写进来，
 * 下次给堆栈加气泡就得回来改组件，而组件是最不该为了内容改动的地方。
 * 作者在课文里写了 `meow:` 就有，不写就没有：**边界落在内容那一侧**，
 * 于是「循环有没有气泡」这件事和「循环怎么讲」住在同一个文件里。
 * 这也正好让 `checkDemoBlock` 那条「要么全有要么全无」的闸门说了算。
 */
const hasMeow = computed(() => props.block.steps.some((s) => s.meow))
/** 这一步气泡里那句话。作者没写这一块时是空串，但那行整个不渲染 */
const meow = computed(() => current.value?.meow ?? '')

/**
 * 这一步立绘摆什么姿态（2026-09-20 加）。
 *
 * 【为什么要跟着步骤换】
 * 「正在往下钻」和「叼着战利品回来了」是两种完全不同的处境，
 * 一张从头挂到尾的固定图等于把这个信息丢掉了。
 *
 * 【回落规则：作者没写这一步的 pose，就用 DEMO.MEOW_POSE】
 * 一个姿势都没写的块（老课文）行为和以前**逐字节一样**；
 * 只给关键几步写了 pose 的块，别的步骤停在默认姿势上 —— 这是允许的，
 * 和 `meow` 那种「要么全有要么全无」不同：气泡缺一步会**让整块跳动**
 * （那一行存在与否会改变下面所有内容的位置），而立绘那一格**一直都在**，
 * 只是换个姿势，不会动版面。所以这条不需要闸门强制。
 *
 * 【为什么不做成「按 say 的内容猜姿势」】
 * 播放器一推断就又开始替教学内容下判断了 —— 和 `meow` 同一条理由，见 md.ts 的 DemoStep。
 *
 * 【⚠️ 这里的 `as MascotPose` 是有意的，别把它「修」成一个兜底分支】
 * `DemoStep.pose` 的类型是 `string`，因为 `md.ts` 是正文解析层，
 * **它不该知道**有哪些姿态（姿态表的真源是 `lib/mascot.ts`）。
 * 真正逐条对白名单的是 `content-validate.mjs` 的 `checkDemoBlock` ——
 * 它**从 mascot.ts 现场解析** `MASCOT_POSES`，写错的名字当场把闸门弄红、内容进不了产包。
 * 所以跑到这一行的值，正常情况下一定合法。
 *
 * 那万一呢？**让它坏得看得见。** 写成
 * `MASCOT_POSES.includes(want) ? want : DEMO.MEOW_POSE` 那种兜底看起来更稳，
 * 实际上是「判定为真的路上插了一条不需要证据的分支」：
 * 一旦闸门哪天漏了（比如 `MASCOT_POSES` 改了写法、解析静默失效），
 * 学员会看到一段**姿势不对但完全正常**的演示，没有任何人会发现。
 * 而按原样传下去，`MiMascot` 找不到那张图会显示一个**虚线占位框** ——
 * 一眼就能看出「这里坏了」，坏得响亮。
 */
const pose = computed(() => (current.value?.pose || DEMO.MEOW_POSE) as MascotPose)

/**
 * 当前该高亮**第几行代码**（0 起）。
 *
 * 【⚠️ 为什么必须只有这一个地方算它 —— 2026-09-19 实测踩到的 bug】
 * 第一版**没有**这个 computed：模板里写 `i === current.at - 1`（对），
 * 而 `syncBar` 收到的是**步号**，却直接拿去索引**代码行**（`rows[i]`）——
 * 两个完全不同的数列被当成了一个。
 *
 * 后果是：本课 8 步、代码只有 2 行，走到第 3 步时 `rows[2]` 是 `undefined`，
 * `syncBar` 一声不吭地 `return` 了 —— **从第 3 步往后，高亮条就再也不动了**，
 * 而行的加粗（模板那条路）一直是对的。两个判据、一个对、一个悄悄地错，
 * 正是 `md.ts:48-58` 记着的那类事故。
 *
 * 现在模板和 `syncBar` **都读这一个**，两边不可能再各算各的。
 * 注意 `at` 是**1 起**（作者在课文里数行号从 1 数），这里减掉。
 */
const atRow = computed(() => (current.value?.at ?? 1) - 1)

/** 第 1 步不能再往前，最后一步不能再往后 —— 按钮据此置灰 */
const atFirst = computed(() => step.value <= 0)
const atLast = computed(() => step.value >= total.value - 1)

/**
 * 这一步里**值变了**的变量名。
 *
 * 只有变的那个才闪一下 —— 每一步都让所有变量一起闪，等于没闪，
 * 学员的视线会被平均分给所有变量，反而看不出「这次动的是 total」。
 * 拿上一步比：第一步没有上一步，所以第一步**全是新的**，全部算变（都闪）。
 */
const changed = computed<Set<string>>(() => {
  const now = current.value
  if (!now) return new Set()
  const prev = props.block.steps[step.value - 1]
  if (!prev) return new Set(now.vars.map((v) => v.name))
  const before = new Map(prev.vars.map((v) => [v.name, v.value]))
  const out = new Set<string>()
  for (const v of now.vars) if (before.get(v.name) !== v.value) out.add(v.name)
  return out
})

// ---------------------------------------------------------------- 动效闸门

/** 系统「减弱动效」开着没有。开着就一步也不补间，直接落到终态 */
const reduced = ref(false)
let mq: MediaQueryList | null = null
const onMqChange = (e: MediaQueryListEvent): void => {
  reduced.value = e.matches
}

onMounted(() => {
  mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  reduced.value = mq.matches
  // 必须监听变化：用户在系统里改开关时，不能要求他重启应用才生效
  mq.addEventListener('change', onMqChange)
  void nextTick(() => syncBar(true))
})

onBeforeUnmount(() => {
  stopPlay()
  mq?.removeEventListener('change', onMqChange)
})

// ---------------------------------------------------------------- 逐步切换

const STEP_MS = 1200
const DUR = 420
let timer: ReturnType<typeof setTimeout> | null = null

function stopPlay(): void {
  playing.value = false
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

/**
 * 把高亮条挪到**当前这一步**该在的那一行上。
 *
 * 【为什么不收「第几步」这个参数】收了就得有人负责传对 —— 第一版正是栽在这上面
 * （传的是步号，用的地方当成了行号）。现在它只认 `atRow`，
 * 而 `atRow` 又是从 `current` 算出来的，**跟模板那行加粗读的是同一个值**，
 * 没有第二个地方可以传错。
 * 【`silent` 只给「刚上屏」那一次用】这一块是随课文本体一起画出来的，
 * 那一刻**没有任何人点过播放**。docs/04 那条例外是靠「用户主动要求才动」守住的，
 * 所以初次落位必须是**直接出现在那儿**，不能自己滑一段。
 *
 * 【为什么量的是 DOM 而不是自己算「行高 × 行号」】
 * 代码行会折行（长表达式、窄窗口），行高不是常数。量 `offsetTop/offsetHeight`
 * 拿到的是**真实排版结果**，折多少行都对。
 * 【为什么 `height` 也要动】
 * 折成两行的那些行比别的行高一截，条子不跟着长就会露出下面半行没被盖住。
 */
function syncBar(silent = false): void {
  const el = bar.value
  const host = root.value?.querySelector<HTMLElement>('.demo-code')
  if (!el || !host) return
  const rows = host.querySelectorAll<HTMLElement>('.demo-line')
  const row = rows[atRow.value]
  if (!row) return
  const y = row.offsetTop
  const h = row.offsetHeight
  if (silent || reduced.value) applyStyles(el, { y, height: h, duration: 0 })
  else animate(el, { y, height: h, duration: DUR, ease: 'outQuad' })
}

/** 变量闪一下：证明「这一步动的是它」，不是重画了整块 */
function pulseVars(): void {
  const host = root.value
  if (!host || reduced.value) return
  for (const el of host.querySelectorAll<HTMLElement>('[data-pulse]')) {
    animate(el, {
      scale: [1, 1.14, 1],
      duration: DUR + 120,
      ease: 'outQuad'
    })
  }
}

/** 「这一句在讲什么」换掉时轻轻推一下，让眼睛跟得上（不动就没有这个提示） */
function slideSay(): void {
  const el = root.value?.querySelector<HTMLElement>('.demo-say')
  if (!el || reduced.value) return
  animate(el, { opacity: [0, 1], y: [6, 0], duration: DUR, ease: 'outQuad' })
}

/**
 * 气泡弹一下。
 *
 * 【为什么是「弹出」而不是和讲解一样「滑入」】
 * 这两个元素挨着，都是每步换一次字。用同一个动作，用户会把它们读成**同一件事的
 * 两半**（比如「上面是标题、下面是正文」）—— 而它们不是：
 * 讲解是**主**（学会循环靠它），气泡是**配菜**（让眼睛愿意停在这儿）。
 * 一个「啪地弹出来」、一个「轻轻推上来」，动起来就能看出是两回事。
 * 更实际的一条：气泡缩放在左边缘、带一点回弹，看起来像**从大肥鱼嘴里冒出来的**，
 * 这正是它该有的样子；同样的动作放在讲解上就只是晃。
 *
 * 【为什么 `scale` 不能用 `[0, 1]`】
 * 从 0 开始会让文字在头几帧被压成一条线再撑开，糊得很明显。
 * 从 0.86 起步只走一小段，读起来是「弹出来」，不是「长出来」。
 */
function popMeow(): void {
  const el = bubble.value
  if (!el || reduced.value) return
  animate(el, { scale: [0.86, 1], opacity: [0, 1], duration: DUR, ease: 'outBack' })
}

/** 切到第 i 步（越界钳住，不报错也不乱跳） */
function goTo(i: number): void {
  const next = Math.min(Math.max(i, 0), Math.max(total.value - 1, 0))
  const moved = next !== step.value
  step.value = next
  if (!moved) return
  void nextTick(() => {
    syncBar()
    pulseVars()
    slideSay()
    popMeow()
  })
}

function next(): void {
  if (atLast.value) {
    stopPlay()
    return
  }
  goTo(step.value + 1)
}

function prev(): void {
  stopPlay()
  goTo(step.value - 1)
}

/**
 * 自动播放。
 *
 * 【为什么是 `setTimeout` 链，不是让 anime.js 的 timeline 一路跑到底】
 * 播放中用户随时可能点「上一步」或者拖到别的步骤，那时**必须能立刻打断**。
 * timeline 打断要自己管 pause/cancel 和当前进度，而这里每一步之间是**离散的**、
 * 动画本身只有几百毫秒 —— 用一个「到点就走下一步」的定时器，打断就是 `clearTimeout`，
 * 行为和状态永远对得上。
 * 【为什么停在最后一步就自己停】
 * 走到头还亮着「暂停」，用户会以为它还在跑，等半天没有下一步。
 */
function play(): void {
  if (total.value <= 1) return
  // 已经在最后一步时按播放：从头再放一遍，而不是原地不动
  if (atLast.value) goTo(0)
  playing.value = true
  const tick = (): void => {
    if (!playing.value) return
    if (atLast.value) {
      stopPlay()
      return
    }
    next()
    timer = setTimeout(tick, STEP_MS)
  }
  timer = setTimeout(tick, STEP_MS)
}

function togglePlay(): void {
  if (playing.value) stopPlay()
  else play()
}
</script>

<template>
  <div ref="root" class="demo">
    <div class="demo-head">
      <span class="demo-title">{{ title }}</span>
      <span class="demo-badge">{{ DEMO.BADGE }}</span>
    </div>

    <!-- 代码区。高亮条是这一格里绝对定位的一层，靠 translateY 走到当前行 -->
    <div class="demo-code">
      <div ref="bar" class="demo-bar" aria-hidden="true"></div>
      <div
        v-for="(line, i) in props.block.code"
        :key="i"
        class="demo-line"
        :class="{ 'is-at': i === atRow }"
      >
        <span class="demo-ln">{{ i + 1 }}</span>
        <span class="demo-src">{{ line || ' ' }}</span>
      </div>
    </div>

    <!--
      大肥鱼 + 气泡。
      只在作者写了 `meow:` 的块里出现 —— 判据落在内容那一侧，组件不知道课号（见 hasMeow）。
      立绘取 `xl` 档 = 160px（2026-09-20 从 48px 提上来，主人说「太小了」）。
      姿态跟着步骤走（见 `pose`）：想事情的时候 `think`、叼回东西的时候 `yay`、
      平稳收工的时候 `proud`。作者不写就停在默认姿势上。
    -->
    <div v-if="hasMeow" class="demo-meow">
      <MiMascot :pose="pose" size="xl" class="demo-meow-pet" />
      <p ref="bubble" class="demo-bubble">
        <span class="demo-bubble-who">{{ DEMO.MEOW_ROLE }}</span>
        <span class="demo-bubble-text">{{ meow }}</span>
      </p>
    </div>

    <div class="demo-body">
      <div class="demo-vars">
        <div class="demo-vars-title">{{ DEMO.VARS_TITLE }}</div>
        <p v-if="!current || current.vars.length === 0" class="demo-vars-empty">
          {{ DEMO.NO_VARS }}
        </p>
        <div
          v-for="v in current?.vars ?? []"
          :key="v.name"
          class="demo-var"
          :data-pulse="changed.has(v.name) ? '' : null"
        >
          <span class="demo-var-name">{{ v.name }}</span>
          <span class="demo-var-eq">=</span>
          <span class="demo-var-val">{{ v.value }}</span>
        </div>
      </div>

      <div class="demo-say-wrap">
        <div v-if="current" class="demo-say">
          <div class="demo-say-label">{{ current.label }}</div>
          <div class="demo-say-text">{{ current.say }}</div>
        </div>
      </div>
    </div>

    <div class="demo-foot">
      <button type="button" :disabled="atFirst" @click="prev">{{ DEMO.PREV }}</button>
      <button type="button" :disabled="total <= 1" @click="togglePlay">
        {{ playing ? DEMO.PAUSE : DEMO.PLAY }}
      </button>
      <button type="button" :disabled="atLast" @click="next">{{ DEMO.NEXT }}</button>
      <span class="demo-count">{{ DEMO.stepCounter(total ? step + 1 : 0, total) }}</span>
    </div>
  </div>
</template>

<style scoped>
.demo {
  margin: 20px 0;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius);
  background: var(--mi-card);
  overflow: hidden;
}
.demo-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--mi-border);
}
.demo-title {
  font-family: var(--mi-font-title);
  font-size: 14px;
  font-weight: 600;
  color: var(--mi-text);
}
.demo-badge {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  /* 和「运行试试」那类小按钮同一个淡蓝底，读作「一个功能标记」而不是标题的一部分 */
  background: var(--mi-blue-light);
  color: var(--mi-blue-ink);
}

/*
 * 代码区。`position: relative` 是给高亮条当参考系用的 ——
 * 条子的 `translateY` 是相对**这一格**的，不是相对整页。
 * `overflow: hidden` 防止条子（宽度 100% 加圆角）在边缘露出一个像素。
 */
.demo-code {
  position: relative;
  padding: 8px 0;
  overflow: hidden;
  /* 同 CompareGrid：并进 --mi-code-bg，深色下才不会是一块白 */
  background: var(--mi-code-bg);
}
/*
 * 高亮条。**放在所有代码行下面**（z-index 0 对行的 1），
 * 所以它盖不住文字，只是把当前那一行的底色换掉。
 */
.demo-bar {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 0;
  background: var(--mi-blue-light);
  border-left: 3px solid var(--mi-blue);
  z-index: 0;
  will-change: transform, height;
}
.demo-line {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 10px;
  padding: 0 12px;
  font-family: var(--mi-code);
  font-size: 13px;
  line-height: 1.8;
  color: var(--mi-text);
}
/* 行号是**辅助**，不能和代码一样重，否则视线会先去读数字 */
.demo-ln {
  flex-shrink: 0;
  width: 2ch;
  text-align: right;
  color: var(--mi-text-3);
  user-select: none;
}
/* 代码原文要保留缩进 —— `pre` 的空白规则，用 `pre-wrap` 让它该折行时能折 */
.demo-src {
  white-space: pre-wrap;
  word-break: break-word;
}
.demo-line.is-at .demo-src {
  font-weight: 700;
}

/*
 * 大肥鱼 + 气泡那一格。
 *
 * 【为什么单开一格，而不是浮在代码上、或塞进抬头】
 *   · 浮在代码上：这一步的主角是代码（高亮条正指着它），盖住任何一行都是遮挡信息；
 *   · 塞进抬头：抬头只有 30 出头那么高，立绘会把标题栏撑成两倍，
 *     而且那点宽度里气泡稍微长一句就折成三行。
 * 单开一格是唯一同时满足「立绘放得下、气泡展得开、不压任何主内容」的位置。
 *
 * 【2026-09-20 改版：从「左图右话」改成「上图下话」，整格居中】
 * 立绘从 `s`（48px）提到 `xl`（160px）之后，横排就不成立了：
 * 160px 的鱼会把气泡挤到右边一条窄缝里，而且尾巴朝**左**指着鱼肚子 ——
 * 那个角度在 160px 面前是错的（尾巴该指着鱼，不是指着鱼肚子）。
 * 改成竖排之后，大肥鱼在正中、气泡在它正下方、尾巴朝**上**指着它。
 * 主人这次的原话是「至少要放大到 128x128 或 256x256，并做居中显示」。
 */
.demo-meow {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 14px 12px;
  border-top: 1px solid var(--mi-border);
}

/*
 * 立绘不许被压。
 * `flex-shrink: 0` 是关键：窄窗口下 flex 会先拿它开刀，把 160px 的鱼挤成一条缝 ——
 * 而气泡是**可以**换行的、立绘不能。能屈的那个去屈。
 */
.demo-meow-pet {
  flex-shrink: 0;
}

/*
 * 气泡本体。
 *
 * 尾巴用两个伪元素叠出来，不放图片：纯 CSS 跟着字号走，也少一个资产文件。
 * `transform-origin: center top` 是给 `popMeow` 的缩放用的 ——
 * 从顶上（大肥鱼那一侧）往下弹，看起来才像是从它嘴里冒出来的话。
 *
 * 【为什么这一格的 `min-height` 钉在「两行」而不是「实际字数」】
 * 气泡字多字少会换行，行数一变高度就变，**它下面所有内容跟着上下跳**。
 * 把两行的高度写死：一句话的步骤留着第二行的空位，两句话的步骤正好填满，
 * 两边高度**一样**。不会再出现「按一下下一步，页面自己往上蹦一截」。
 * 74 = 上下内边距 8×2 + 上下边框 1×2 + 「大肥鱼说」那行 10×1.4 + 正文两行 13×1.6×2。
 */
.demo-bubble {
  position: relative;
  width: 100%;
  max-width: 360px;
  min-height: 74px;
  /* 一句话的步骤文字只有一行，居中放才不会吊在顶上、底下空一大块 */
  display: flex;
  flex-direction: column;
  justify-content: center;
  margin: 0;
  padding: 8px 14px;
  border: 1px solid var(--mi-border);
  border-radius: 10px;
  background: var(--mi-bg);
  text-align: center;
  transform-origin: center top;
  will-change: transform, opacity;
}
.demo-bubble::before,
.demo-bubble::after {
  content: '';
  position: absolute;
  left: 50%;
  width: 0;
  height: 0;
  border: 6px solid transparent;
  transform: translateX(-50%);
}
/*
 * 外层三角＝尾巴的**描边**：颜色取边框色，位置比内层靠上 2px，
 * 于是它露出来的那一圈正好是 1px 描边。
 * 用 `border-bottom-color` 出来的三角尖朝**上**（顶在 `top + 6` 那个点上）。
 * `top: -12px` 让它的底边正好落在气泡的上边框上（0px）。
 */
.demo-bubble::before {
  top: -12px;
  border-bottom-color: var(--mi-border);
}
/*
 * 内层三角＝尾巴的**填充**：颜色取气泡底色，往下多探 2px。
 * 多出来那 2px 正好盖住气泡自己的上边框（0~1px），
 * 于是尾巴和气泡是**连通**的，而不是贴上去的一个三角形。
 */
.demo-bubble::after {
  top: -10px;
  border-bottom-color: var(--mi-bg);
}

/* 「大肥鱼说」——一行小字。它同时是这一格给人读、也给读屏软件读的名字 */
.demo-bubble-who {
  display: block;
  font-size: 10px;
  line-height: 1.4;
  color: var(--mi-text-3);
}
.demo-bubble-text {
  display: block;
  font-size: 13px;
  line-height: 1.6;
  color: var(--mi-text);
}

/*
 * 变量 + 讲解。
 * 【为什么是两栏而不是上下堆】
 * 变量和讲解是同一步的两面，左右并排时眼睛不用来回跳；窄窗口下 auto-fit 会
 * 自己折成一栏，不需要写媒体查询。
 */
.demo-body {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1px;
  /* 用背景色画分隔线：两个格子之间有 1px 的缝，透出来的就是这条线 */
  background: var(--mi-border);
  border-top: 1px solid var(--mi-border);
}
.demo-vars {
  padding: 10px 12px;
  background: var(--mi-card);
}
.demo-vars-title {
  font-size: 11px;
  color: var(--mi-text-3);
  margin-bottom: 6px;
}
.demo-vars-empty {
  margin: 0;
  font-size: 12px;
  color: var(--mi-text-3);
}
.demo-var {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-family: var(--mi-code);
  font-size: 13px;
  line-height: 2;
  /* 缩放脉冲围绕自己中心，不然会从左边缘弹出去 */
  transform-origin: left center;
}
.demo-var-name {
  color: var(--mi-text-2);
}
.demo-var-eq {
  color: var(--mi-text-3);
}
.demo-var-val {
  font-weight: 700;
  color: var(--mi-blue-ink);
}
.demo-say-wrap {
  padding: 10px 12px;
  background: var(--mi-card);
}
/*
 * 【为什么给讲解留一个最小高度】
 * 每一步都重画这块，文字长的步骤会把整个块顶高、短的一步又缩回来 ——
 * 卡片跟着一伸一缩，比内容本身更显眼。给个下限把常见长度的句子兜住。
 */
.demo-say {
  min-height: 54px;
}
.demo-say-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--mi-text);
  margin-bottom: 4px;
}
.demo-say-text {
  font-size: 13px;
  line-height: 1.8;
  color: var(--mi-text-2);
}

/*
 * 控制条。`flex-wrap` 是为了窄窗口 —— 三个按钮加计数在 320px 里挤不下，
 * 不换行就是横向溢出（和挑战页那两条鱼同一个道理）。
 */
.demo-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--mi-border);
}
.demo-foot button {
  font-family: var(--mi-font);
  font-size: 12px;
  padding: 3px 10px;
  border: 1px solid var(--mi-border);
  border-radius: 999px;
  background: var(--mi-bg);
  color: var(--mi-text-2);
  cursor: var(--mi-cursor, pointer);
  /*
   * 批⑥（2026-10-16）：原先 `transition: all .15s ease`。会变的三样：hover 的底/字色、
   * 到头置灰的 opacity（下面 :disabled 那条 0.45，淡出要留）。
   */
  transition:
    background var(--mi-dur-fast) var(--mi-ease),
    color var(--mi-dur-fast) var(--mi-ease),
    opacity var(--mi-dur-fast) var(--mi-ease);
}
.demo-foot button:hover:not(:disabled) {
  background: var(--mi-blue);
  color: var(--mi-text);
}
/*
 * 到头 / 到尾的按钮置灰。
 *
 * 【为什么用真的 `:disabled`，不只是改个样子】
 * 这两个按钮到了边界**按下去确实什么也不会发生**（`goTo` 会把越界的步号钳回去），
 * 所以 `disabled` 说的是实话。读屏软件会念出「不可用」，比让用户点一下没反应强。
 * 代价是它会从 Tab 序列里被摘掉 —— 这是 `disabled` 的标准行为，
 * 这里认了：用户在这一行里能按的就那几个，少一个不会找不到。
 * `goTo` 里那道钳位**不是**为按钮写的，是给「将来有人从别处调 goTo」兜底的。
 */
.demo-foot button:disabled {
  opacity: 0.45;
  cursor: default;
}
.demo-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--mi-text-3);
}
</style>
