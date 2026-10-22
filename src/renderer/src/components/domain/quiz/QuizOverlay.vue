<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useQuizStore } from '../../../stores/quiz'
import { useChallengeStore } from '../../../stores/challenge'
import { useSettingsStore } from '../../../stores/settings'
import { usePetStore } from '../../../stores/pet'
import { useProgressStore } from '../../../stores/progress'
import MiProgressBar from '../../base/MiProgressBar.vue'
import MiButton from '../../base/MiButton.vue'
import MiModal from '../../base/MiModal.vue'
import QuizChoice from './QuizChoice.vue'
import QuizFill from './QuizFill.vue'
import QuizCode from './QuizCode.vue'
import QuizCodeFill from './QuizCodeFill.vue'
import QuizCodeRun from './QuizCodeRun.vue'
import MiMascot from '../../base/MiMascot.vue'
import MiRichText from '../../base/MiRichText.vue'
import FavoriteStar from '../FavoriteStar.vue'
import { isRunGraded } from '../../../../../shared/run-grading'
import { PET_REWARD_RICE } from '../../../../../shared/pet'
import { CHALLENGE, QUIZ } from '../../../lib/copy'
import { wallpaperOverlayDim } from '../../../lib/wallpaper/overlay-dim'

// M4-01：全局练习遮罩（一次一题、顶部进度、计时、退出确认、结果页猫咪评价）
const quiz = useQuizStore()
// 挑战模式的两处专属展示（进度行的「已连对」、结算页的积分行）要读挑战存档 ——
// 积分的写入方也在挑战 store（finish watcher，flush:'sync'），判分与它同 tick 完成，
// 所以结果页读到的就是刚记完的那一份
const challenge = useChallengeStore()
// 退出确认的正文要读设置（fav 模式 + 开关关着时不记账，文案得跟着变）——
// 选择逻辑在 QUIZ.exitConfirmBody 里（copy.ts），组件只负责取值
const settings = useSettingsStore()
// 答对时闪的那枚「🍚 +1」回执（V2-22）读它的 riceInTick —— 见下面的 watcher。
// 组件不自己发 grant、也不自己数答对：加一的判据在 stores/quiz.ts（真涨了才 ping）
const pet = usePetStore()
// 课后练习结果页的自动已学回写（V2-14）走它 —— 判据与理由见下面 finished 的 watcher
const progress = useProgressStore()
// 结果页两颗去处按钮（去错题本 V1-22 / 去排行榜 V1-25）跳路由用
const router = useRouter()

const isChallenge = computed(() => quiz.session?.mode === 'challenge')
const isReview = computed(() => quiz.session?.mode === 'review')

/**
 * 结果页**不给「再来一遍」**的模式。
 *
 * 【挑战】今天的挑战重做一遍没有意义，而且会重复记账（第二次做完又会往
 * challenge.json 里写一次分数）。
 *
 * 【每日复习】它是"每天第一次做完发奖励"的模式，而同一张卷子刚做完、解析都看过了 ——
 * 「再来一遍」等于拿着答案再填一遍，那条捷径不能留。要接着练，关掉遮罩
 * 回复习页点「开始复习」，组的是**另一张**卷子（课和题都会重新抽）。
 * 挑战那边也是同一个落点：关掉就回到挑战页的结算区。
 */
const noRestart = computed(() => isChallenge.value || isReview.value)

const exitConfirmOpen = ref(false)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

/**
 * 答对回执「🍚 大白饭 +1」的显示状态（V2-22）。
 *
 * 【为什么是"事件计数 + 布尔"而不是一个 toast 队列】同一局里每答对一题都要
 * 闪一次，连对时两枚之间不能叠着 —— 计数（ricePopKey）让 v-if 里的节点
 * 换 key 重挂、动画从头播；布尔（ricePopOn）管 1.1 秒后的收场。
 *
 * 【它只做"显示"】"这一笔账真涨了"的判据在 stores/quiz.ts 的
 * grantPetRiceOnce（拿 grant 回话里的新快照跟发之前的余额比）——
 * 日上限、满仓、通道不在那几笔，ping 根本不会发出来，这里也就不会闪。
 */
const ricePopKey = ref(0)
const ricePopOn = ref(false)
let ricePopTimer: number | null = null
/** 回执在屏幕上停多久（毫秒）。够看清 +1，又不至于压着下一题的作答区 */
const RICE_POP_MS = 1100

const s = computed(() => quiz.session)
const finished = computed(() => s.value?.finishedAt != null)
const total = computed(() => s.value?.questions.length ?? 0)
const percent = computed(() =>
  total.value === 0 ? 0 : Math.round(((s.value?.index ?? 0) + 1) / total.value * 100)
)
const elapsedText = computed(() => {
  if (!s.value) return '00:00'
  const secs = Math.max(0, Math.floor((now.value - new Date(s.value.startedAt).getTime()) / 1000))
  const m = String(Math.floor(secs / 60)).padStart(2, '0')
  const ss = String(secs % 60).padStart(2, '0')
  return `${m}:${ss}`
})

const verdict = computed(() => QUIZ.resultOf(total.value === 0 ? 0 : quiz.correctCount / total.value, total.value))

/**
 * 挑战里**这一题答错了** —— 也就是「答错即停」落刀的那一刻（2026-10-10 改版）。
 *
 * 【判据为什么就是 `isCurrentCorrect === false`】它是 `checked && !verdict`：
 * 选择/填空提交即定；真跑题型交过之后还能改再交 —— 哪种都算数。
 * 只对 challenge 生效：别的模式答错了当然还能接着做/接着改。
 *
 * 【真跑题型拿它当锁】挑战里答错之后编辑器与「运行/提交」全锁（`locked` 通道）——
 * 不锁的话，重交一次翻成对的，等于「答错没停」。文案走 `lockedHint` 挑挑战专用的
 * 那句（默认那句说的是「已经答对啦」，在这里是假话）。
 */
const challengeStopped = computed(() => isChallenge.value && quiz.isCurrentCorrect === false)

/** QuizCodeRun 的两个锁合一：答对封口（原有）× 挑战答错即停（新增） */
const codeRunLocked = computed(() => quiz.isCurrentCorrect === true || challengeStopped.value)
const codeRunLockedHint = computed(() =>
  challengeStopped.value ? CHALLENGE.STOPPED_HINT : undefined
)

/**
 * 挑战结算页的积分行数据。`null` = 不显示（不是挑战、或旧批次没记过积分）。
 *
 * 旧批次（2026-10-10 改版前收工的）`score` 里没有 `points` —— 按「没有就不显示」
 * 处理，不能拿 0 顶替（「0 分」和「当时还没有积分制」是两件事）。
 */
const challengePoints = computed(() => {
  if (!isChallenge.value) return null
  const sc = challenge.scoreToday
  if (!sc || sc.points === undefined || sc.pointsMax === undefined) return null
  return { points: sc.points, max: sc.pointsMax }
})

/**
 * 「答错即停」提前收工的那一局 —— 结算页要说一句为什么只做了这几道。
 *
 * 判据收敛到 store 的 `challenge.stoppedEarly`（答对数 < 结算总题数）。
 * 【为什么旧判据必须换】v2 这里写的是「整批题数 > 结算总题数」；v3 收工记账
 * 把 questions 与 answers 成对重写为做过的前缀之后，两者**永远相等**，
 * 旧判据恒假 —— 结算页从此不再解释「为什么只做了这几道」，且不报错。
 * 判据搬去 store 是因为挑战页结算卡（ChallengeView）也要用同一句话，
 * 两处各写一套迟早漂移（v3 发现时就是两处都写过、两处都过期了）。
 */
const challengeStoppedEarly = computed(
  () => isChallenge.value && finished.value && challenge.stoppedEarly
)

/**
 * 错题本毕业行（V1-26）：本局有几道错题答对后**真写盘**毕业了。
 *
 * 数据源是 store 的 `QuizSession.lastCleared`（成功才累加，见 flushWrongbook）——
 * 组件不自己数"答对了几道 wrong 模式的题"，那种数法会把写盘失败也算成毕业。
 * 0 = 不显示（不是 wrong 模式、或一道都没毕业）。
 *
 * 注意它是**响应式跟涨的**：最后一题提交后才发的消除请求若还挂着，
 * 结果页先出来、回话一到行就补上 —— 这是刻意如此（宁可晚一拍，不报没发生的事）。
 */
const graduatedCount = computed(() => s.value?.lastCleared ?? 0)

/**
 * 这一局**已判分且答错**的题数（V1-22 的回执行读数）。
 *
 * 【为什么走 `quiz.verdictAt(i)`】判分只有那一条路（真跑题型的结论在
 * store 的 runResults 里，组件自己算不出来）。没判分的题不算数：
 * 没答就是没答，不是答错（与 flushWrongbook 的记账口径同一条 ——
 * 拿"空答案现算出 false"当错题，是把没发生的事记成错）。
 */
const wrongsThisRun = computed(() => {
  const v = s.value
  if (!v) return 0
  let n = 0
  v.questions.forEach((_q, i) => {
    if (v.checked[i] && !quiz.verdictAt(i)) n++
  })
  return n
})

/**
 * 这一局的模式**答错记不记错题本** —— 与 store 的 flushWrongbook 逐字同一条
 * 判据（fav 看设置，其余模式全记）。回执行和「去错题本」都看它：
 * 在关了开关的 fav 局里说「已经记进错题本」，是拿没发生的事报喜。
 */
const recordsWrong = computed(
  () => s.value !== null && (s.value.mode !== 'fav' || settings.config.favWrongToBook)
)

/** 回执行的出现条件：结果页 + 真错了 + 真在记（三条缺一不出现） */
const showWrongReceipt = computed(
  () => finished.value && wrongsThisRun.value > 0 && recordsWrong.value
)

/**
 * 「这节课自动记成已学」的回执行（V2-14）的显示状态。由下面 finished 的
 * watcher 点亮 —— 只有"这一下真把课从没学翻成已学"才亮，早学过的课不报账。
 */
const autoLearned = ref(false)

/**
 * 当前这道题的全局键 —— ⭐ 拿它认人。
 *
 * 取的是 `session.keys[index]`，**不是**自己拿 `lessonId + id` 拼一个：
 * 会话的课号在 random/wrong/challenge/fav 这些模式下是哨兵（`__random__`），
 * 拼出来的键和错题本、收藏、练习史里那份对不上（`stores/quiz.ts` 记过这个现场）。
 * 键的真源只有 `startQuiz` 里那一次 —— 这里只读。
 *
 * 空串 = 这一局没给键（理论上不会有），此时不摆 ⭐：点下去会写进一条
 * `__random__:q1` 这种谁也找不回来的收藏。
 */
const currentKey = computed(() => {
  const v = s.value
  return v ? (v.keys[v.index] ?? '') : ''
})

/**
 * 当前这道题的题型，这个版本认不认识。
 *
 * 用在两处：渲染分支的兜底、以及底部按钮是给"提交"还是给"跳过"。
 * **两处必须看同一个判断** —— 分开写的话，有一天会出现"界面说它不认识这道题，
 * 却还是给了个提交按钮"这种自相矛盾的状态。
 */
const knownType = computed(() => {
  const t = quiz.current?.type
  return (
    t === 'choice' ||
    t === 'fill' ||
    t === 'code' ||
    t === 'codefill' ||
    // 真跑题型。**加在这里还不够** —— 下面模板里的 `v-else-if` 分支也要跟着加一条，
    // 少任何一处，表现都是"界面说它认识这道题，却渲染成未知题型的兜底"（或反过来）。
    // 两处的判据不能各写一套：同步的那四个走 `knownType`，真跑的这两个走
    // `isRunGraded()`（那个函数是全项目"这题要不要真跑"的唯一判据）。
    t === 'codefix' ||
    t === 'codewrite'
  )
})

/**
 * 底部那排按钮要不要出现。
 *
 * 【真跑题型为什么不按 `checked` 判断——这一条 store 里专门留了话】
 * 其余题型"提交即锁"，所以 `checked` 一真就说明答题结束，按钮换成「下一题」是对的。
 * 真跑题型**答错了还能接着改、接着交**（`canSubmit` 特意为它留的规则），
 * 照 `checked` 换按钮的话，「提交」会在第一次答错后就消失 ——
 * 学员明明还有机会，按钮却没了。
 *
 * 所以它们的按钮排是：**「运行 / 提交」一直在**（在 `QuizCodeRun` 里面，
 * 因为那两个共用一份运行中的状态），这一排只在**已经交过之后**补一个「下一题」。
 * 交了之后想继续改也行 —— 两个按钮都还在，`checked` 会被下一次改动清掉。
 */
const showActionRow = computed(() => {
  const q = quiz.current
  if (!q) return false
  if (!isRunGraded(q)) return true
  return s.value?.checked[s.value.index] === true
})

watch(
  () => s.value,
  (v) => {
    if (v && !v.finishedAt && !timer) {
      timer = setInterval(() => (now.value = Date.now()), 1000)
    } else if ((!v || v.finishedAt) && timer) {
      clearInterval(timer)
      timer = null
    }
  },
  { immediate: true }
)

/**
 * 「这一碗大白饭真进盒了」→ 闪回执（V2-22）。
 *
 * 【为什么还要在组件里再挡一道 finishedAt】ping 的来源在 store，它不知道
 * 结果页开没开。收尾那几笔（比如复习发图的一笔）回话稍慢时，结果页已经
 * 盖上来 —— 那时候再飘一枚「+1」会被读成"答对这道题又加了一碗"，
 * 而它其实是另一笔账。宁可漏闪，不许点错名（与 grantPetRiceOnce 的
 * 「真涨了才 ping」同一条口径）。
 */
watch(
  () => pet.riceInTick,
  () => {
    if (!s.value || s.value.finishedAt) return
    ricePopKey.value += 1
    ricePopOn.value = true
    if (ricePopTimer !== null) window.clearTimeout(ricePopTimer)
    ricePopTimer = window.setTimeout(() => {
      ricePopOn.value = false
      ricePopTimer = null
    }, RICE_POP_MS)
  }
)

onBeforeUnmount(() => {
  // 浮层计数兜底（2026-10-08 体感卡顿修复）：遮罩还开着时组件被卸载 → 补 pop
  syncDim(false)
  // 键盘监听同款兜底（V2-37）：卸载时可能没走过 watch 的关闭分支
  window.removeEventListener('keydown', onQuizKey)
  if (timer) clearInterval(timer)
  // 回执的收场定时器（V2-22）：组件没了就不必再收场
  if (ricePopTimer !== null) window.clearTimeout(ricePopTimer)
})

/**
 * 结果页的自动已学回写（V2-14）。2026-10-16 主人裁定「做了题之后应该自动变
 * 已学，**也能**自己标记是否已学」——后半句是课页那颗手动按钮，原样保留。
 *
 * 【为什么落在"结果页出现"这一拍】finish() 一落这一局就结束了，此刻把课
 * 记成已学：解锁链当场往下走一步，课页的「下一课 →」也跟着有了去处。
 * 用户不用再猜"练习做完了算不算学完"。
 *
 * 【为什么只有 lesson 模式】其余模式的 lessonId 是哨兵（`__random__` 这些，
 * 见 QuizSession 字段注释），拿它去记已学等于往档案里写一节不存在的课。
 * 只有 lesson 模式带真课号。
 *
 * 【为什么先查 learned 再标】markLearned 本身幂等，但"本来就会"的课再练
 * 一遍不该弹"自动记成已学"的回执行 —— 回执行只报这一下真实发生的翻转。
 *
 * 【为什么不弹 toast】结果页自己有一条回执行（QUIZ.AUTO_LEARNED）；
 * toast 会压在遮罩层上再说一遍同一件事。
 */
watch(finished, (fin) => {
  if (!fin) return
  const v = s.value
  if (!v || v.mode !== 'lesson') return
  if (progress.profile.learned.includes(v.lessonId)) return
  progress.markLearned(v.lessonId, true)
  autoLearned.value = true
})

/**
 * 浮层计数配对位（2026-10-08 体感卡顿修复）：练习遮罩全屏盖住时壁纸层降级
 * （停透视/频谱、场景降帧），关闭即恢复。判据与模板 `v-if="s"` 同源（session
 * 非空）；配对纪律见 lib/wallpaper/overlay-dim.ts。
 */
let dimPushed = false
function syncDim(v: boolean): void {
  if (v && !dimPushed) {
    dimPushed = true
    wallpaperOverlayDim.push()
  } else if (!v && dimPushed) {
    dimPushed = false
    wallpaperOverlayDim.pop()
  }
}
watch(() => !!s.value, syncDim, { immediate: true })

// 重开一局交给 store —— 组件里那份漏了 keys，见 stores/quiz.ts 的 restart()
function restart() {
  quiz.restart()
}

/**
 * 键盘纪律（V2-37，2026-10-16 主人裁定「应用确实需要 Esc 习惯」）。
 *
 * 【修的是两件事】
 *   ① Esc 无反应：全应用每个弹层、全屏菜单都能 Esc 关，唯独这块最大的浮层
 *      没挂 —— 按 Esc 想退出/暂停一律石沉大海。
 *   ② 焦点不进来：从「开始挑战」按钮点开之后，焦点还留在蒙层背后那颗按钮上，
 *      Tab 先在看不见的页面上游走才轮到浮层。
 *
 * 【Esc 的落点】做题中 → 走现成的退出确认框（防误退，与 ✕ 同一个落点，
 * 不是新语义）；结果页 → 直接收（这一局都结算完了，没有可丢的东西，
 * 再多问一次是噪音）。
 *
 * 【套娃弹层的礼让】退出确认/奖励图/参考答案卡都是 MiModal（Teleport 到 body）。
 * 它们开着时，Esc 归它们处理 —— 判据就是页面上有 .mi-modal-mask。
 * 没有这道礼让的话，一次 Esc 会同时命中两边：MiModal 关掉确认框、
 * 这个监听又立刻把它开回来（或反过来），按一下等于没按。
 */
const panel = ref<HTMLElement | null>(null)
/** 打开时的焦点来处；关闭时还给它（元素还在场才还）—— 与 MiModal/FullscreenMenu 同一套 */
let restoreTo: HTMLElement | null = null

function focusables(): HTMLElement[] {
  const root = panel.value
  if (!root) return []
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => !el.hasAttribute('disabled'))
}

function trapTab(e: KeyboardEvent): void {
  // 套娃弹层自带陷阱（MiModal 的）：焦点在它们那儿时不要抢
  if (document.querySelector('.mi-modal-mask')) return
  const els = focusables()
  if (els.length === 0) {
    e.preventDefault()
    panel.value?.focus()
    return
  }
  const first = els[0]
  const last = els[els.length - 1]
  const active = document.activeElement
  const inside = active instanceof HTMLElement && els.includes(active)
  if (e.shiftKey && (!inside || active === first)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (!inside || active === last)) {
    e.preventDefault()
    first.focus()
  }
}

function onQuizKey(e: KeyboardEvent): void {
  if (e.key === 'Tab') {
    trapTab(e)
    return
  }
  if (e.key !== 'Escape') return
  // 套娃弹层开着：礼让（理由见上面）
  if (document.querySelector('.mi-modal-mask')) return
  if (finished.value) {
    quiz.close()
    return
  }
  if (s.value) exitConfirmOpen.value = true
}

watch(
  () => !!s.value,
  (open) => {
    if (open) {
      restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
      window.addEventListener('keydown', onQuizKey)
      // 焦点进面板（tabindex="-1"）：Tab 从下一格开始就是浮层里的内容，
      // 而不是蒙层背后那张看不见的页面。面板本身不是激活目标，压掉焦点环。
      void nextTick(() => panel.value?.focus())
    } else {
      window.removeEventListener('keydown', onQuizKey)
      if (restoreTo?.isConnected) restoreTo.focus()
      restoreTo = null
    }
  },
  { immediate: true }
)

/**
 * 结果页的「去错题本」（V1-22 + V2-16，2026-10-16 主人裁定「要给入口必须优化」）。
 * 收遮罩 + 落到练习页的**错题本页签**。走 quiz.close() 而不是手动置空：
 * 收尾补账/浮层计数都在它里面，绕过去等于开第二条关局路径。
 * query 让练习页直接停在错题本页签（PracticeView 读 `?tab=`，同总览页
 * `?card=` 的深链口径）。
 */
function goWrongbook(): void {
  quiz.close()
  void router.push({ path: '/practice', query: { tab: 'wrongbook' } })
}

/**
 * 结果页的「去排行榜」（V1-25，主人裁定「必须改一键跳转之类的指示」）。
 * 挑战分数在 finish 那一刻已同步落账（challenge store 的 finish watcher，
 * flush:'sync'），此刻排行榜读到的就是刚记完的那一份。
 */
function goLeaderboard(): void {
  quiz.close()
  void router.push('/leaderboard')
}

function confirmExit() {
  quiz.close()
  exitConfirmOpen.value = false
}
</script>

<template>
  <Teleport to="body">
    <Transition name="quiz">
      <div v-if="s" class="quiz-mask">
        <!-- mi-zoom-layer（V1-61）：内容卡跟正文一起吃 --mi-zoom，遮罩外壳不缩放。
             160% 用户点开练习时字号不再从 22px 掉回 15px；机制与边界见 zoom.css
             V2-37：面板接住打开时的焦点 + dialog 语义（Tab 陷阱在 onQuizKey 里）
             ⚠️ tabindex="-1" 挂在 mi-zoom-layer 同一个元素上，别挪去外层遮罩 ——
             焦点陷阱查的就是这颗元素的子树 -->
        <div
          ref="panel"
          class="quiz-panel mi-zoom-layer"
          tabindex="-1"
          role="dialog"
          aria-modal="true"
          :aria-label="QUIZ.DIALOG_LABEL"
        >
          <!-- 答对回执（V2-22）：饭盒真涨了一碗才闪（判据在 stores/quiz.ts）。
               :key 逐次换新 → 连对时每枚都从头播；aria-hidden 因为它只是
               把刚落下的账念一声，读屏用户从总览页的余额读同一件事。 -->
          <span
            v-if="ricePopOn"
            :key="ricePopKey"
            class="rice-pop"
            aria-hidden="true"
          >{{ QUIZ.RICE_GAIN(PET_REWARD_RICE.answer) }}</span>
          <!-- 顶栏：进度 + 计时 + 退出 -->
          <div class="quiz-head">
            <!--
              挑战的进度行与别的模式不同：写「第 n 题 · 已连对 x 题」而不是
              「第 n / 总数」。v3 起一次抽整个已学题库（几千道），
              写「第 3 / 4189 题」比 v2 的「第 3 / 20 题」更没意义 ——
              答错即停之后做不满是常态，总数字只会让人以为还剩几千道要做。
            -->
            <span class="quiz-count">
              {{
                finished
                  ? QUIZ.FINISHED
                  : isChallenge
                    ? CHALLENGE.progressRun(s.index + 1, quiz.correctCount)
                    : QUIZ.progress(s.index, total)
              }}
            </span>
            <span v-if="!finished" class="quiz-timer">⏱ {{ elapsedText }}</span>
            <button
              type="button"
              class="quiz-close"
              :title="QUIZ.EXIT_TITLE"
              :aria-label="QUIZ.EXIT_TITLE"
              @click="exitConfirmOpen = true"
            >
              ✕
            </button>
          </div>
          <!-- 挑战**不给进度条**（v3 起）：它的分母是整池几千道，而答错即停让现实局
               通常连对不足 20 道 —— 条形整局读 0%，是个常量死读数。进度看顶栏那行
               「第 n 题 · 已连对 x 题」（progressRun），那才是这一局的真实记分方式。 -->
          <MiProgressBar v-if="!isChallenge" :percent="finished ? 100 : percent" :height="5" />

          <!-- 结果页 -->
          <div v-if="finished" class="quiz-body quiz-result">
            <MiMascot :pose="verdict.pose" size="l" />
            <div class="result-score">{{ QUIZ.score(quiz.correctCount, total) }}</div>
            <!-- 挑战专属：积分行（2026-10-10 加权计分改版；旧批次没有积分就不显示） -->
            <div v-if="challengePoints" class="result-points">
              {{ CHALLENGE.points(challengePoints.points, challengePoints.max) }}
            </div>
            <!-- 积分行下面接一句去向（V1-25）：攒分的地方（这里）和看分的地方
                 （排行榜）此前互不指路，点按钮之前先说清分数落到了哪 -->
            <div v-if="challengePoints" class="result-board">
              {{ CHALLENGE.POINTS_TO_BOARD }}
            </div>
            <!-- 错题本毕业行（V1-26）：只在 wrong 模式真毕业过才出现 -->
            <div v-if="graduatedCount > 0" class="result-graduated">
              {{ QUIZ.graduated(graduatedCount) }}
            </div>
            <!-- 错题回执行（V1-22）：错了 + 真在记才有这句；去向做成下面那颗按钮 -->
            <div v-if="showWrongReceipt" class="result-wrongs">
              {{ QUIZ.wrongReceipt(wrongsThisRun) }}
            </div>
            <!-- 自动已学回执行（V2-14）：这节课刚被这一局翻成「已学」才有 -->
            <div v-if="autoLearned" class="result-learned">
              {{ QUIZ.AUTO_LEARNED }}
            </div>
            <div class="result-text">{{ verdict.text }}</div>
            <!-- 挑战专属：答错即停提前收工的一句话（只做 2 道就结算，得说清为什么） -->
            <div v-if="challengeStoppedEarly" class="result-stopped">
              {{ CHALLENGE.STOPPED_RESULT }}
            </div>
            <div class="result-actions">
              <!-- 挑战与复习**不给「再来一遍」**（理由见上面 noRestart 的注释）：
                   挑战是「去看看奖励」（落到挑战页结算区），复习是「收工」
                   （关掉遮罩就回到复习页，想接着练在那儿点「开始复习」）。
                   两颗去处按钮（V1-22 去错题本 / V1-25 去排行榜）都是 ghost：
                   它们是"顺路看看"，不是这一拍的主动作（主动作在右侧）。 -->
              <MiButton v-if="challengePoints" variant="ghost" @click="goLeaderboard">
                {{ CHALLENGE.GO_LEADERBOARD }}
              </MiButton>
              <MiButton v-if="showWrongReceipt" variant="ghost" @click="goWrongbook">
                {{ QUIZ.GO_WRONGBOOK }}
              </MiButton>
              <MiButton v-if="noRestart" variant="primary" @click="quiz.close()">
                {{ isChallenge ? CHALLENGE.SEE_REWARD : QUIZ.DONE }}
              </MiButton>
              <template v-else>
                <MiButton variant="secondary" @click="restart">{{ QUIZ.RESTART }}</MiButton>
                <MiButton variant="primary" @click="quiz.close()">{{ QUIZ.DONE }}</MiButton>
              </template>
            </div>
          </div>

          <!-- 答题区 -->
          <div v-else-if="quiz.current" class="quiz-body">
            <!--
              题干行：题干 + 行尾那颗 ⭐（题目收藏，学习闭环 §6）。

              ⭐ 放在**题干这一行**而不是结果页：收藏是题目的属性，
              跟"这一次答没答对"没关系。做一半觉得这题该留着，
              当场就能收 —— 等结果页的话，中途退出就收不成了。
            -->
            <div class="quiz-stem">
              <!-- 题干也过 `MiRichText`：内容里的题干带内联标记
                   （2026-09-15 实测 58 条里 26 条，例如「租仓库的时候要是没租到，
                   `malloc` 叼回来的是 ____。」）。裸插值会把反引号一起显示出来 -->
              <!-- class 会落到 MiRichText 的单根 span 上（配合下面的 .stem-text
                   加固；修复前它是无根 Fragment，attrs 会被整个丢弃） -->
              <MiRichText :text="quiz.current.stem" class="stem-text" />
              <FavoriteStar
                v-if="currentKey"
                class="quiz-stem-star"
                :q-key="currentKey"
                :question="quiz.current"
                :source="s.mode"
              />
            </div>

            <QuizChoice
              v-if="quiz.current.type === 'choice'"
              :question="quiz.current"
              :user-answer="(s.answers[s.index] as number | null)"
              :submitted="s.checked[s.index]"
              @update="quiz.answerCurrent"
            />
            <QuizFill
              v-else-if="quiz.current.type === 'fill'"
              :question="quiz.current"
              :user-answer="String(s.answers[s.index] ?? '')"
              :submitted="s.checked[s.index]"
              @update="quiz.answerCurrent"
            />
            <QuizCode
              v-else-if="quiz.current.type === 'code'"
              :question="quiz.current"
              :user-answer="String(s.answers[s.index] ?? '')"
              :submitted="s.checked[s.index]"
              @update="quiz.answerCurrent"
            />
            <QuizCodeFill
              v-else-if="quiz.current.type === 'codefill'"
              :question="quiz.current"
              :user-answer="String(s.answers[s.index] ?? '')"
              :submitted="s.checked[s.index]"
              @update="quiz.answerCurrent"
            />
            <!--
              真跑题型（代码改错 / 写代码大题）。两个类型共用这一个组件 ——
              它们的界面差别只有"预填什么代码"和"头顶那句提示"，其余四样
              （运行链路、输出比对、报错讲解卡、两个按钮）必须永远一致。
              理由写在 QuizCodeRun.vue 的开头。

              `@run` 交回 store 记的是**结果**（`RunResult`）而不是对错：
              "对错"是从结果算出来的，而且中间还有"没跑通"这第三种状态（见 stores/quiz.ts）。
              它还多带一个**开跑那一刻的题号**（`:index` 的快照，由组件在第一个
              await 之前钉下）—— 真跑是异步的，跑完时 `s.index` 可能已经被
              「下一题」换走，落账必须落在发起的那一格（见 store 的 `recordRun`）。
            -->
            <QuizCodeRun
              v-else-if="isRunGraded(quiz.current)"
              :question="quiz.current"
              :index="s.index"
              :session-id="s.sessionId"
              :user-answer="String(s.answers[s.index] ?? '')"
              :result="s.runResults[s.index]"
              :can-submit="quiz.canSubmit"
              :can-reveal="quiz.canRevealReference"
              :submitted="s.checked[s.index]"
              :wrong="quiz.isCurrentCorrect === false"
              :auto-reveal="quiz.shouldAutoRevealReference"
              :locked="codeRunLocked"
              :locked-hint="codeRunLockedHint"
              @update="quiz.answerCurrent"
              @run="quiz.recordRun"
              @submit="quiz.submitRun()"
              @seen-auto-reveal="quiz.ackAutoReveal()"
            />
            <!--
              ⚠️ 这个兜底**必须是最后一条**，而且**必须显示点什么**。

              原来这里挂的是 `<QuizCode v-else>` —— 那是"三分支假设"的写法：
              内容里任何一个这个版本不认识的题型，都会被**静默地当成代码阅读题**
              渲染出来。学员看到的是一道题干问 A、界面答 B 的题，
              而没有任何地方报错。加 codefill 时差点又踩进去：
              新分支写 `v-else-if` 之后，最后一个 `v-else` 会顺位接管所有未知题型。
              所以每一种题型都写全 `v-else-if`，兜底留给"真的不认识"，
              并且给它一句能落地的话 + 一条出路（跳过），而不是一片空白。
            -->
            <div v-else class="quiz-unknown">
              <div class="unknown-text">{{ QUIZ.UNKNOWN_TYPE }}</div>
            </div>

            <!--
              判分后：猫咪解析卡 + 下一题

              ⚠️ 这里**不能**用 `s.checked[s.index]` 当判据。对真跑题型来说，
              答错之后 `checked` 也是 true，照它显示的话**错一次就把答案讲完了** ——
              而真跑题型的解析本身就是答案（「改成 `i <= 5` 就对了」），
              上面那张诊断卡特意只说"哪儿错了、拿到什么、要什么"，
              就是为了不越过这道线。门槛统一收在 store 的 `canShowExplanation` 里。

              【2026-09-22：真跑题型那条路现在多了两张面孔，别和这里混淆】
              真跑题型答错时，屏幕上会依次出现三样，各管各的：
                ① `QuizRunDiagnosis`（在 QuizCodeRun 内部）—— 见诊断，**不含答案**
                ② 这个 `quiz-explain` 卡 —— 讲答案
                ③ `QuizReferenceModal` —— 自动弹（错够两次）或按钮（随时）
              ①③ 都归 `QuizCodeRun` 管；这里只管 ②，判据一个都不变。
            -->
            <div v-if="quiz.canShowExplanation" class="quiz-explain" :class="quiz.isCurrentCorrect ? 'ok' : 'bad'">
              <!-- 只在**判分之后**出现：答题进行中不放形象，docs/04 §6.2 #17 -->
              <MiMascot :pose="quiz.isCurrentCorrect ? 'yay' : 'soothe'" size="s" />
              <div class="explain-body">
                <div class="explain-title">
                  {{ quiz.isCurrentCorrect ? QUIZ.CORRECT : QUIZ.WRONG }}
                </div>
                <!--
                  解析文案过 `MiRichText`：内容里是**按有内联标记写的**
                  （2026-09-15 实测 58 条 `explanation` 里 46 条含反引号或星号，
                  例如「`malloc` 是租，`free` 是还」）。
                  裸插值会把反引号原样摆给学员看，和错误讲解卡是同一个 bug ——
                  那一处修过之后漏了这一处。理由见 lib/rich-text.ts。
                -->
                <div class="explain-text"><MiRichText :text="quiz.current.explanation" /></div>
              </div>
            </div>

            <div v-if="showActionRow" class="quiz-actions">
              <!--
                未知题型没有"提交"可点（它压根没法判分），给的是"跳过"。
                跳过走的是 store 现成的 `next()`：它不改 `checked[i]`，
                所以 `finish()` 不会把这道题记进错题本，`correctCount` 也不计它 ——
                正是"跳过"该有的语义，不用新加动作。
              -->
              <MiButton v-if="!knownType" variant="secondary" @click="quiz.next()">
                {{ QUIZ.SKIP_UNKNOWN }}
              </MiButton>
              <!--
                真跑题型交过之后的那一个「下一题」。**不能合并进下面那条 `v-else`** ——
                那条的前提是"其余题型提交即锁"，而真跑题型提交之后按钮排还得留着
                「运行 / 提交」（答错了还能再改）。所以它的「下一题」是**追加**，
                不是替换。
              -->
              <MiButton
                v-else-if="isRunGraded(quiz.current)"
                variant="primary"
                @click="quiz.next()"
              >
                {{ s.index < total - 1 ? QUIZ.NEXT : QUIZ.SEE_RESULT }}
              </MiButton>
              <MiButton
                v-else-if="!s.checked[s.index]"
                variant="primary"
                :disabled="!quiz.canSubmit"
                @click="quiz.submit()"
              >
                {{ QUIZ.SUBMIT }}
              </MiButton>
              <MiButton
                v-else
                variant="primary"
                @click="quiz.next()"
              >
                {{ s.index < total - 1 ? QUIZ.NEXT : QUIZ.SEE_RESULT }}
              </MiButton>
            </div>
          </div>
        </div>

        <!-- 退出确认 -->
        <!-- 正文按模式与设置选（QUIZ.exitConfirmBody）——fav + 开关关着时
             这一局不记账，不能说"答错的题会照常进错题本"（2026-10-01 复核修复） -->
        <MiModal v-model:visible="exitConfirmOpen" :title="QUIZ.EXIT_CONFIRM_TITLE" :width="360">
          <p class="exit-text">{{ QUIZ.exitConfirmBody(s.mode, settings.config.favWrongToBook) }}</p>
          <template #footer>
            <MiButton variant="ghost" @click="exitConfirmOpen = false">{{ QUIZ.EXIT_CANCEL }}</MiButton>
            <MiButton variant="danger" @click="confirmExit">{{ QUIZ.EXIT_CONFIRM }}</MiButton>
          </template>
        </MiModal>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.quiz-mask {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--mi-overlay) 45%, transparent);
}
.quiz-panel {
  width: 640px;
  max-width: 92vw;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: var(--mi-bg);
  border-radius: var(--mi-radius-lg);
  box-shadow: 0 16px 48px color-mix(in srgb, var(--mi-overlay) 30%, transparent);
  overflow: hidden;
  /* 答对回执（V2-22）绝对定位的包含块 —— 没有它 .rice-pop 会以视口定位，
     fixed 遮罩下看着"也对"，但退出动画/缩放层里会漂走 */
  position: relative;
}
/* 面板的 tabindex="-1" 只为接住焦点并当 Tab 陷阱的边界（V2-37），
   不是可见控件：整块面板描焦点环既吵又随主题串味，压掉。 */
.quiz-panel:focus {
  outline: none;
}
/*
 * 答对回执「🍚 大白饭 +1」（V2-22）。
 *
 * 摆位在顶栏下缘右侧：那是眼睛刚点完「提交」后自然回落的位置，
 * 又不会盖住题干与选项。底色用 --mi-warn + --mi-on-fill 这对已验过
 * 对比度的组合（同 SearchPanel 的标记底色），暗亮两套主题都过 4.5。
 *
 * 【动效与 prefers-reduced-motion】结束帧必须"看得见"（opacity: 1）：
 * motion.css 的全局降级只把时长压成 1ms、保留结束帧 —— 动画若收在
 * opacity: 0，降级用户看到的是一枚从未出现过的回执。fill: both 保证
 * 起手帧（透明）在延迟阶段也生效，否则首帧会先闪一下全亮。
 */
.rice-pop {
  position: absolute;
  top: 47px;
  right: 20px;
  z-index: 1;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--mi-warn);
  color: var(--mi-on-fill);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  pointer-events: none;
  animation: rice-pop-in 0.28s ease-out both;
}
@keyframes rice-pop-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.9);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
/*
 * mi-zoom-layer（V1-61）的视口上限校正。
 *
 * 【为什么必须折算】vh/vw 在缩放层里**不跟着缩放走**（实测：zoom:1.5 的子树里
 * 100vh 仍是 782px 的"缩放前视口"）。于是 86vh=672px 的"视觉"上限实际是
 * 672×1.5=1008px —— 比 782px 的视口还高一头：内容是跟着 zoom 长高的
 * （557px 自然高 ×1.5=835px），面板上下各被裁 26px，进度条和 ✕ 钮直接出屏。
 * 修法 = 两者取严：zoom=1 时 min() 右项（100vh-16px）比 86vh 松，逐字不动原样式；
 * 放大后右项按 ÷zoom 折算回**本地单位**，视觉高度就压回视口里（150% 时 758px）。
 *
 * 【为什么写在组件里而不在 zoom.css】scoped 的 [data-v] 把 .quiz-panel[data-v]
 * 抬到了 (0,2,0)，外部一条 .mi-zoom-layer (0,1,0) 压不过它 —— 挂进组件的
 * .quiz-panel.mi-zoom-layer[data-v]=(0,3,0) 才盖得住 86vh。挂缩放白名单的
 * 规矩与边界见 styles/zoom.css。
 */
.quiz-panel.mi-zoom-layer {
  max-height: min(86vh, calc(100vh / var(--mi-zoom) - 16px));
  max-width: min(92vw, calc(100vw / var(--mi-zoom) - 16px));
}
.quiz-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px 10px;
}
.quiz-count {
  font-size: 13px;
  font-weight: 600;
  color: var(--mi-text);
}
.quiz-timer {
  font-family: var(--mi-code);
  font-size: 12px;
  color: var(--mi-text-3);
}
.quiz-close {
  margin-left: auto;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--mi-text-3);
  font-size: 13px;
  cursor: var(--mi-cursor, pointer);
  transition: background 0.15s ease;
}
.quiz-close:hover {
  background: var(--mi-blue-light);
  color: var(--mi-text);
}
.quiz-body {
  padding: 18px 24px 24px;
  overflow-y: auto;
}
.quiz-stem {
  /*
   * flex 只为把那颗 ⭐ 顶到右上角：题干长起来是好几行，
   * 让它跟在最后一行末尾的话，题一长星星就跑到屏幕中间去了（还随题干长度上下跳）。
   */
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.8;
  margin-bottom: 14px;
}
/*
 * 2026-10-01 竖柱事故的加固层：MiRichText 现在是单根 span（事故根因已修），
 * 但 flex 的默认 min-width:auto（= min-content）仍可能让长题干挤压 ⭐ 或溢出。
 * flex:1 + min-width:0 把 span 钉成唯一可收缩项。
 * 顺带：这个 class 能落到 span 上，本身就是「修复后 attrs 穿透链没断」的活体检查。
 */
.stem-text {
  flex: 1;
  min-width: 0;
}
.quiz-stem-star {
  margin-left: auto;
  flex-shrink: 0;
}
.quiz-explain {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: var(--mi-radius-sm);
  font-size: 13px;
  line-height: 1.8;
}
/* min-width:0 是必须的：flex 子项默认不肯缩到内容宽度以下，长解析会把卡片撑破 */
.explain-body {
  flex: 1;
  min-width: 0;
}
.quiz-explain.ok {
  /* 这两个正是 --mi-success-fill / --mi-error-fill 的浅色值，
     别处（QuizChoice / QuizFill / QuizReview）早就并进令牌了，只有这里还留着字面量 ——
     深色下它就是课文旁边两块刺眼的浅色块。 */
  background: var(--mi-success-fill);
  border: 1px solid color-mix(in srgb, var(--mi-success) 60%, transparent);
}
.quiz-explain.bad {
  background: var(--mi-error-fill);
  border: 1px solid color-mix(in srgb, var(--mi-error) 60%, transparent);
}
.explain-title {
  font-weight: 700;
  margin-bottom: 4px;
}
.quiz-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 18px;
}
/* 题型兜底：样子要像一个"提示"，不是一个"错误"。它多半不是学员做错了什么，
   而是内容和程序版本对不上（见 copy.ts 的 UNKNOWN_TYPE） */
.quiz-unknown {
  padding: 14px;
  border: 1px dashed var(--mi-border);
  border-radius: var(--mi-radius-sm);
  background: var(--mi-bg);
}
.unknown-text {
  font-size: 13px;
  color: var(--mi-text-2);
  line-height: 1.8;
}
.quiz-result {
  text-align: center;
  padding: 36px 24px;
}
.result-score {
  font-family: var(--mi-font-title);
  font-size: 22px;
  font-weight: 700;
  margin: 12px 0 6px;
}
/* 挑战积分行：和「答对 x / y 题」同排出现，用蓝墨那支（对比度审计过的 token） */
.result-points {
  font-family: var(--mi-font-title);
  font-size: 15px;
  font-weight: 700;
  color: var(--mi-blue-ink);
  margin-bottom: 6px;
}
/* 答错即停的说明行：收在正文行下方、按钮上方，语气是解释不是警告 */
.result-stopped {
  font-size: 13px;
  color: var(--mi-text-2);
  margin: -12px 0 20px;
}
/* 错题本毕业行（V1-26）：蓝墨那支（与 result-points 同 token，对比度审计过） */
.result-graduated {
  font-size: 13px;
  font-weight: 600;
  color: var(--mi-blue-ink);
  margin-bottom: 6px;
}
/* 积分行的去向说明（V1-25）：比积分行弱一档 —— 它是注解，不是又一笔账 */
.result-board {
  font-size: 13px;
  color: var(--mi-text-2);
  margin: -2px 0 6px;
}
/* 错题回执行（V1-22）：与毕业行同族（蓝墨 13px 600，同为"账目行"） */
.result-wrongs {
  font-size: 13px;
  font-weight: 600;
  color: var(--mi-blue-ink);
  margin-bottom: 6px;
}
/* 自动已学回执行（V2-14）：同上，账目行一族 */
.result-learned {
  font-size: 13px;
  font-weight: 600;
  color: var(--mi-blue-ink);
  margin-bottom: 6px;
}
.result-text {
  font-size: 14px;
  color: var(--mi-text-2);
  margin-bottom: 20px;
}
.result-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
}
.exit-text {
  font-size: 13px;
  color: var(--mi-text-2);
  line-height: 1.8;
}
.quiz-enter-active,
.quiz-leave-active {
  transition: opacity var(--mi-dur) var(--mi-ease-out);
}
.quiz-enter-active .quiz-panel,
.quiz-leave-active .quiz-panel {
  transition: transform var(--mi-dur) var(--mi-ease-out);
}
.quiz-enter-from,
.quiz-leave-to {
  opacity: 0;
}
.quiz-enter-from .quiz-panel,
.quiz-leave-to .quiz-panel {
  transform: scale(0.96);
}
</style>
