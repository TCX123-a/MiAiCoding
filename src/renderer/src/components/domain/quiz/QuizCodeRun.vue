<script setup lang="ts">
/**
 * 真跑题型的作答区：`codefix`（代码改错）和 `codewrite`（写代码大题）**共用这一个组件**。
 *
 * 【为什么两种题型不拆成两个组件】
 * 它们的界面差别只有两处：编辑器里预填什么、头顶那句提示说什么。
 * 而剩下的四样 —— 运行链路（`runner:run`）、输出比对（`gradeByRun`）、
 * 报错讲解卡（`runView`）、运行/提交两个按钮的行为 —— **必须永远一致**。
 * 拆成两个组件，这四样就要各写两遍；抄第二遍就等于给自己埋一个迟早会漂的地方。
 * 判分那边是同一个道理（见 docs/09：防漂移的是共享的**函数**，不是共享的类型）。
 *
 * 【为什么「运行」和「提交」两个按钮在组件里，不在遮罩底部那排】
 * 遮罩底部那排（`QuizOverlay` 的 `.quiz-actions`）装的是"做完这道题之后"的动作
 * （下一题 / 查看结果）。这两个是"做题当中"的动作，而且它们**共用同一份运行状态**：
 * 正在编译时两个都得按不动。那份状态（`busy`）是这个组件的内部状态 ——
 * 把按钮挪到父组件去，就得把 `busy` 一起提上去，多一层没有任何好处的搬运。
 *
 * 【为什么不用 `stores/runner`（练习场那个 store）】
 * 它的 `code` 是"当前语言那一格"的 computed 代理，两个编辑器绑同一个 `runner.code`
 * 会**互改内容**。而答题遮罩是 `/playground` 上的覆盖层，练习场的 `RunnerPanel`
 * 在遮罩打开时**仍然挂载着** —— "两个编辑器同时活着"不是假设，是默认状态。
 * 所以答题的代码存在会话里（`quiz.answers[i]`），这个组件只复用
 * `runner:run` 这个 IPC 和 `runView` 这个纯函数，**不碰 runner store 一个字段**。
 *
 * 【运行和提交的分工】
 * 「运行」= 真编译真跑一遍，把输出摆给学员看，**不判对错**（跟练习场一样）。
 * 「提交」= 拿刚才那次运行的结果判分，**不重复编译**。
 * 这个分工决定了三件事，每一件都是刻意的：
 *   · 等待提示（「翻译官喵正在编译…」）出现在点「运行」的时候 —— 那才是真在编译
 *   · 没跑通过就不能交（`canSubmit`），逼他先看见自己的代码到底跑出了什么
 *   · 改了代码上一次的结果就作废（`answerCurrent` 清的），提交按钮跟着灰下去
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { RunGradedQuestion, RunResult } from '../../../../../shared/types'
import { failedRun, initialCodeOf } from '../../../../../shared/run-grading'
import { codeFingerprint } from '../../../../../shared/code-hash'
import { ERROR_UI, RUNNER_UI, QUIZ } from '../../../lib/copy'
import { toast } from '../../base/toast'
import MiModal from '../../base/MiModal.vue'
import { shouldRestoreFocus } from '../../../lib/editor-setup'
import { decideNativeRun } from '../../../lib/native-confirm'
import { reportRunToPet, type PetViewRect } from '../../../lib/pet-bridge'
import { claimWorkRect, releaseWorkRect } from '../../../lib/pet-work-rect'
import { diagnosisOf } from '../../../lib/run-diagnosis'
import { runView } from '../../../lib/run-result-view'
import { useContentStore } from '../../../stores/content'
import MiButton from '../../base/MiButton.vue'
import MiRichText from '../../base/MiRichText.vue'
import CodeEditor from '../CodeEditor.vue'
import QuizReferenceModal from './QuizReferenceModal.vue'
import QuizRunDiagnosis from './QuizRunDiagnosis.vue'

const props = defineProps<{
  question: RunGradedQuestion
  /**
   * 这道题在会话里的下标 —— **开跑那一刻**钉下来，跑完随结果交回 store。
   *
   * 【为什么运行结果需要一个"题号"】（2026-10-14 修）
   * `run()` 里有 `await`（真编译，几秒都可能），而这期间学员**是有路切走的**：
   * 答错交过一次之后，底部按钮排就多出「下一题」，同时本组件的「运行」按钮
   * 还在（答错了还能改、还能重跑）。切走之后会话的 `index` 已经换人 ——
   * 完成时刻再去读"当前题号"，结果就会整份落到**下一题**头上（旧版本正是
   * 这么错的：题 1 凭空"跑通过了"，题 0 的结果丢了，全程静默）。
   * 所以这里给的不是"现在在看哪一题"，是**发起时刻**的题号：
   * `run()` 第一行快照，emit 时原样交回；store 用它落账。
   */
  index: number
  /**
   * 这一局的身份（`QuizSession.sessionId`）—— 与 `index` 同样**开跑那一刻**
   * 钉下来、跑完随结果交回。
   *
   * 【为什么题号之外还需要它】（2026-10-14 修）
   * 换局这条路不关界面：搜索面板点「练相关题」、挑战页重开，都在本组件
   * 还没卸载、旧 run 还在途时就换了 session。只交题号的话，旧局同号题的
   * 结果会落进新局（新题上什么都没做，输出区却出现旧题输出）。
   * 题号管"这一局里的哪一题"，身份管"哪一局" —— 两层都得有。
   */
  sessionId: number
  /** 学员当前写的代码（会话里那一份） */
  userAnswer: string
  /** 最近一次运行的结果。`null` = 还没跑过，或者改了代码之后作废了 */
  result: RunResult | null
  /** 现在能不能交。规则在 `stores/quiz.ts` 的 `canSubmit`，这里只负责画 */
  canSubmit: boolean
  /**
   * 这一版**已经交过卷**了（`session.checked[i]`）。
   *
   * 给诊断卡用：跑通了、也交过、还判错了 → 才说「答案还不对」。
   * 没交卷之前不许替他下这个结论（见 `lib/run-diagnosis.ts` 的 `diagnosisOf`）。
   */
  submitted: boolean
  /** 交的那一版**判错了**。没交过卷时恒为 false */
  wrong: boolean
  /**
   * 这题**已经答对并交过**了 —— 封口。
   *
   * 封口之后编辑器和两个按钮一起锁住，理由不是"做完了就别动"，
   * 而是**不锁会出真事**：`answerCurrent()` 会把 `runResults` 和 `checked` 一起清掉，
   * 所以学员只要在答对之后再敲一个字（哪怕只是碰了一下键盘），
   * 这道题就**从"答对"变回"没答"** —— 结果页少一分，收工时还会被记进错题本。
   * 其余题型不会有这个问题：它们提交之后输入框就 `readonly` 了。
   */
  locked: boolean
  /**
   * 锁住之后，那几个被禁用的控件上悬停显示的说明。不传就用 `QUIZ.LOCKED_HINT`。
   *
   * 【为什么默认文案还要能换 —— 同一把锁，两种相反的事实】
   * `locked` 的默认语义是「**答对**封口」（见上一条）。但每日挑战 2026-10-10
   * 改版后多了第二种锁：**答错即停，这一版不许再交**（不锁的话，重交一次
   * 翻成对的，等于"答错没停"）。同一次锁屏，一边是"你已经做对了"、
   * 一边是"你已经答错了"，文案不分家就会对答错的人说"这题已经答对啦" ——
   * 假话比没有提示更糟。所以让调用方把事实递进来，组件自己不猜。
   */
  lockedHint?: string
  /**
   * 要不要给「查看猫咪解析」那个按钮 —— 也就是**这一版交过卷了没有**。
   *
   * 由父组件从 store 的 `quiz.canRevealReference` 传进来，而不是这个组件自己去问：
   * 这个组件到现在为止**一个 store 都没碰过**（代码、结果、能不能交全是 props），
   * 为了一个按钮引一个 store 进来，等于给它开一个"还能改会话状态"的口子，
   * 而它恰恰是靠"什么都不改"才敢和练习场共存的（见文件头那段）。
   */
  canReveal: boolean
  /**
   * 该不该**自动**把参考解摊开 —— 错够次数了（`REVEAL_AFTER_WRONG`）。
   *
   * 和 `canReveal` 是两件事：「自动弹」是我们替他打开，「有按钮」是他自己点。
   * 判据在 store 的 `shouldAutoRevealReference`，这里只负责响应。
   */
  autoReveal: boolean
}>()

const emit = defineEmits<{
  /** 学员改了代码 */
  update: [value: string]
  /** 跑完了（成功的、失败的、IPC 自己炸了的，都从这儿走）。
   *  第二个参数＝**开跑那一刻**的题号（见 `index` prop），store 用它落账；
   *  第三个参数＝**开跑那一刻**的局身份（见 `sessionId` prop），跨局迟到的结果靠它丢弃 */
  run: [result: RunResult, at: number, token: number]
  /** 点了提交 */
  submit: []
  /** 参考解已经自动弹过了 —— 请 store 记下来，别再弹第二次 */
  seenAutoReveal: []
}>()

const content = useContentStore()

/** 正在编译/运行。**防连点的唯一一道闸**：主进程的任务队列没有取消入口，
 *  连点几次就是排队真编译几次，越点越慢 —— 不能指望队列拦住。 */
const busy = ref(false)

// 「这一趟谁来跑」由 `decideNativeRun()` 判断（`lib/native-confirm.ts`），
// **和练习场用的是同一个函数**。两边各写一遍的话，最危险的那种漂移是
// 「练习场按开关走、答题不按」—— 而答题是要判分的：静默换编译器
// 等于在分数背后改判据。开关没开时它直接返回 false：不弹窗、不多一次 IPC。

const editor = ref<{
  focus: () => void
  clear: () => void
  lineRect: (n: number) => PetViewRect | null
} | null>(null)

/** 输出区正文（桌宠的兜底落脚点）：报错行不在视口里 / 认不出行号时站它上沿 */
const outBodyEl = ref<HTMLElement>()

/** 视口矩形小工具：拿不到元素（还没渲染）就 null */
function rectOfEl(el: HTMLElement | undefined): PetViewRect | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null
}

/**
 * 代码编辑区的外框 —— 桌宠让位对象的登记元素（跟随鼠标的「绝不遮挡代码」，
 * 机制与坑都在 `lib/pet-work-rect.ts`）。
 *
 * 【为什么量这一格，而不是整个 `.quiz-run`】让位规则的对象是「用户正在打字的
 * 代码」—— 对齐练习场 RunnerPanel 的 `editorSlotEl`，量的都得是紧紧裹住
 * CodeEditor 的那一格。圈上整个 `.quiz-run` 的话，输出框、按钮排、诊断卡
 * （鱼压在那些地方根本不碍事）也会被算进让位范围，鱼会被推得离光标老远 ——
 * 让位过头和不让位一样是「这鱼坏了」。
 *
 * 【为什么要包一层自己的 div，而不是量 CodeEditor 的根节点】
 * `.mi-code-editor` 是 CodeEditor 的内部实现（类名哪天改了，这里会**静默**
 * 量错一块）；包一层自己的元素，只依赖本模板里明写的东西。
 */
const editorSlotEl = ref<HTMLElement>()

onMounted(() => {
  claimWorkRect('quiz', editorSlotEl.value)
})

onBeforeUnmount(() => {
  // 出栈（不是报 null）：栈里若还压着练习场那块（遮罩是 /playground 上的
  // 覆盖层，它一直开着），立刻会被重报上去 —— 让位规则不会整体熄火。
  releaseWorkRect('quiz')
})

/** 参考解对比卡开着没有。纯粹是这个组件的界面状态，不往 store 走 */
const revealOpen = ref(false)

/** 重置确认框开着没有。同上，界面状态 */
const resetOpen = ref(false)

/**
 * 「刚打开这道题时编辑器里是什么」—— 判据不在这里，在 `shared/run-grading.ts`
 * 的 `initialCodeOf()`（`codefix` 取那段坏代码、`codewrite` 取骨架）。
 * 这里取来用两次：**重置成什么**，以及**要不要禁用按钮**的比对基准。
 *
 * 【为什么必须和会话初始化用同一个函数】会话里那份初始代码就是
 * `initialCodeOf(q)` 算出来的（见 `stores/quiz.ts` 的 `start()`）。这里要是
 * 自己再写一遍 `q.type === 'codefix' ? … : …`，两处一旦漂，按钮的语义就变成
 * "回到某个第二套规则算出来的样子"：按下去代码**确实变了**，但和刚打开时不一样，
 * 而屏幕上没有任何东西能解释这件事。
 */
const initialCode = computed(() => initialCodeOf(props.question))

/**
 * 这个按钮现在能不能点。
 *
 * 【为什么"内容与初始相同"要禁用】不禁用的话，点下去会弹确认框、按确定、
 * 然后**什么都没变** —— 学员看到的是"这个按钮是坏的"。灰着一个按钮，
 * 比一个按了没反应的按钮诚实（和提交按钮那条 `canSubmit` 同一个道理）。
 *
 * 【为什么逐字比对、不 trim】多打的那个空格也是**他写的**，重置就该清掉；
 * trim 之后比对会让"我只多按了一下空格"这种情况按钮点不动。
 */
const canReset = computed(
  () => !props.locked && !busy.value && props.userAnswer !== initialCode.value
)

/**
 * 重置 = 把初始代码**原路写回会话**（emit 出去，由父组件走 `quiz.answerCurrent()`）。
 *
 * 【为什么不在这里直接改 `userAnswer`】它是 prop，改不得。更要紧的是写入那一趟
 * 还负责**作废上一次的运行结果**（`answerCurrent()` 清的）—— 绕过去就会出现
 * "拿重置前那一刻的输出、判重置后的代码"，正是文件头那段说的那类静默错误。
 *
 * 【为什么给一句轻提示】重置完编辑器**可能看起来没变**（他改的那个字符在屏幕外，
 * 或者那段坏代码本来就和现在差不多）。"已经换回刚打开时的代码"是他唯一能确认
 * 这件事真发生了的地方。
 */
function doReset(): void {
  emit('update', initialCode.value)
  resetOpen.value = false
  toast(QUIZ.RESET_DONE, 'info')
}

const hint = computed(() =>
  props.question.type === 'codefix' ? QUIZ.CODEFIX_HINT : QUIZ.CODEWRITE_HINT
)

/**
 * 「界面该显示什么」交给 `lib/run-result-view.ts` 算 —— 那一整张状态表
 * （编译错 / 运行错 / 超时 / 截断 / 环境没装 / 被系统按停）都被单测钉着，
 * 而且练习场用的是同一个函数，两边的解释不会漂成两套说法。
 *
 * 递进去的两样是讲解卡要的：**哪门语言的规则**（Java 的报错当然查 Java 的规则）
 * 和**规则库本体**（跟着内容包一起打进 bundle，离线可用）。
 */
const view = computed(() =>
  runView(props.result, busy.value, {
    lang: props.question.lang,
    errorLib: content.bundle.errorLib
  })
)

/** 空代码不给跑：省一次编译，也免得学员对着"没输出"发懵（和练习场同一条规矩） */
const canRun = computed(() => !busy.value && !props.locked && props.userAnswer.trim().length > 0)

/**
 * 锁住时那几个禁用控件的悬停说明 —— 事实由调用方给（见 `lockedHint` prop），
 * 不给就还是「答对封口」那句默认。
 */
const lockTitle = computed(() =>
  props.locked ? (props.lockedHint ?? QUIZ.LOCKED_HINT) : undefined
)

/**
 * 现在该不该给诊断卡、给哪一种。判据全在 `lib/run-diagnosis.ts`（纯函数、有单测）。
 *
 * 【为什么 `running` 也要递进去】
 * 正在编译时 `props.result` 里还是**上一版**的结果。不拦的话，
 * 学员点下「跑跑看」的那一瞬间，屏幕上会按旧结果闪一下诊断卡 ——
 * 而那张卡说的是一件已经被他改掉的代码。
 */
const diagnosis = computed(() =>
  diagnosisOf({
    result: props.result,
    running: busy.value,
    submitted: props.submitted,
    wrong: props.wrong,
    expectedOutput: props.question.expectedOutput
  })
)

/**
 * 错够次数了 → 把参考解自动摊开，然后**立刻销账**。
 *
 * 【为什么销账要单独发一次事件，而不是 store 那边"弹了就知道"】
 * store 看不见界面。让它在 computed 里顺手改状态，那个 computed 就成了
 * "求值即写状态"的东西 —— 什么时候求值、求几次，都不由调用方说了算。
 * 所以判据留在 store（`shouldAutoRevealReference`），动作也留在 store
 * （`ackAutoReveal()`），中间这一次"我弹了"由界面负责说。
 *
 * 【为什么 `revealOpen` 先置真、再 emit】
 * 反过来的话，emit 一发出 store 就把 `autoReveal` 变成 false，
 * 这个 watch 又会带着 false 跑一次 —— 顺序一乱，"弹"这个动作就丢了。
 *
 * 【为什么不加 `immediate`】
 * 加上它，这个 watch 会在 `setup()` 里同步跑一遍，于是**父组件正在渲染的时候**
 * 被叫去改 store（`ackAutoReveal()`）—— 那是"渲染期间改状态"，
 * 轻则警告、重则多刷一轮。而它本来也不需要：真跑题型每题各记各的
 * `autoRevealed`，组件挂载时这一格必然是 false（换题不会带着上一题的账）。
 */
watch(
  () => props.autoReveal,
  (yes) => {
    if (!yes) return
    revealOpen.value = true
    emit('seenAutoReveal')
  }
)

async function run() {
  if (!canRun.value) return
  busy.value = true
  // 这一趟运行属于**哪一题**：在第一个 `await` 之前钉下来 —— 之后再读
  // `props.index` 就可能已经被「下一题」换掉了（理由见 `index` prop 的长注释）。
  // 跑完（含失败）连结果一起交回，让 store 落在发起的那一格上。
  const at = props.index
  // 属于**哪一局**：同一个道理，同一个时刻钉（换局同样不关界面，
  // 见 `sessionId` prop 的长注释）。两份一起交回，store 先认局再认题。
  const token = props.sessionId
  try {
    // ── 原生模式（3.0）：答题里**同样要问**，理由见下面这段 ──
    //
    // 【为什么这里不能豁免】练习场问、答题不问的话，「开关有没有生效」就变成
    // 一件看场景的事：学员在练习场被问过、进了答题就静默用机主的环境跑，
    // 而答题**是要判分的** —— 静默换编译器等于在分数背后改判据。
    // 问的位置在 `busy` 之后：弹窗开着时两个按钮都按不动，
    // 也就不会出现「问的同时又点了一次提交」。
    //
    // 【为什么答「不跑」就直接返回】和练习场同一条规矩：上一次的输出原样留着。
    // 这里返回前不用打点任何状态，`finally` 会把 busy 放掉。
    const useNative = await decideNativeRun()
    if (useNative === null) return
    // own 证据快照（2026-10-06）：跑前算好 —— 跑完再算会把"运行期间学员又敲的字"
    // 算进这一趟。题目初始代码（codefix 的坏代码 / codewrite 的骨架）原样跑 →
    // own=false（官方骨架不算作品，不发奖）；改过哪怕一个字符 → own=true。
    // 指纹一并带上：主进程凭它去重（同一段代码只发一次奖励）
    const fp = codeFingerprint(props.userAnswer)
    const seed = codeFingerprint(initialCode.value)
    // stdin 是**题目给的**，不是学员填的 —— 这套题型考的是写代码，
    // 不是"猜程序要什么输入"。所以没有输入框，直接透传 `question.stdin`。
    const result = await window.miai.runCode({
      lang: props.question.lang,
      code: props.userAnswer,
      stdin: props.question.stdin,
      ...(useNative ? { native: true } : {})
    })
    emit('run', result, at, token)
    // 顺手告诉桌宠：它自己判断这一趟值不值得说一句 / 要不要走到报错行旁边。
    // 放在 emit 后面 —— 界面先更新，鱼是**锦上添花**，不许挡在学员前面。
    reportRunToPet(result, {
      lineRect: (n) => editor.value?.lineRect(n) ?? null,
      fallbackRect: rectOfEl(outBodyEl.value),
      own: fp !== seed,
      hash: fp
    })
  } catch (e) {
    // 主进程抛错只有两种：入参不合法、代码/输入超过 200KB。不兜的话
    // `runResults[i]` 一格都不动，学员点了按钮看到的是**什么都没发生**。
    console.error('[quiz] run request failed:', e)
    emit('run', failedRun(), at, token)
    // 这条**不上报**给桌宠：它不是学员代码的错（判据在 pet-bridge 里也有一道，
    // 这里少走一次 IPC；两处都不冤枉他才算数）
  } finally {
    busy.value = false
  }
}

/**
 * 跑完了，把焦点还回编辑器。
 *
 * 学员跑一次就是为了看完输出接着改，焦点不还回去的话，他敲的第一个字就丢了。
 * 三条触发路径（按钮、以后的快捷键、代码里的 intent）都会经过这个 watch，
 * 所以盯着 `busy` 这个状态，而不是在某一次点击后面补一句。
 *
 * `flush: 'post'` 不能省：默认的 pre 时机跑在 DOM 更新**之前**，那一刻编辑器
 * 还停在 `contenteditable="false"` 上，只读元素 focus() 是无效的 ——
 * 这一行会静默地什么都不做，看起来就像没写。理由与 `shouldRestoreFocus`
 * 同一份，见 `RunnerPanel.vue` 里那段说明。
 */
watch(
  busy,
  (now, before) => {
    if (!before || now) return
    const el = document.activeElement as HTMLElement | null
    const active = el ? { tagName: el.tagName, editable: el.isContentEditable } : null
    if (shouldRestoreFocus(active)) editor.value?.focus()
  },
  { flush: 'post' }
)
</script>

<template>
  <div class="quiz-run">
    <div class="run-hint">{{ hint }}</div>

    <!--
      `:model-value` + `@update:model-value` 而不是 `v-model`：
      v-model 会直接改写 prop（`userAnswer`），而它属于会话 store。
      写入必须走 emit → 父组件 → `quiz.answerCurrent()` —— 那一步同时负责
      **作废上一次的运行结果**，绕过去就会出现"用旧代码的输出判新代码的生死"。

      外面包的一层 div 是桌宠让位对象的登记点（为什么是这一格、为什么不是
      整个 .quiz-run，见脚本段 `editorSlotEl` 的注释）。它不加任何样式，
      只是把 CodeEditor 圈起来 —— 量出来的矩形紧贴编辑框。
    -->
    <div ref="editorSlotEl" class="quiz-editor-slot">
      <CodeEditor
        ref="editor"
        :model-value="userAnswer"
        :lang="question.lang"
        :readonly="locked || busy"
        height="200px"
        @update:model-value="(v: string) => emit('update', v)"
      />
    </div>

    <div class="run-actions">
      <MiButton
        variant="secondary"
        :loading="busy"
        :disabled="!canRun"
        :title="lockTitle"
        @click="run"
      >
        {{ busy ? QUIZ.RUNNING : QUIZ.RUN }}
      </MiButton>
      <MiButton variant="primary" :disabled="!canSubmit || busy || locked" @click="emit('submit')">
        {{ QUIZ.SUBMIT }}
      </MiButton>
      <!--
        重置代码 —— 靠右单独放（`margin-left: auto`），**不混进"跑 → 交"那条动线**。

        【为什么是这个位置】上面两个按钮是"这道题往下走"，它是"这道题往回退"。
        紧挨着排会被当成第三个常规操作、顺手点到（而它删的是他自己写的东西）。
        推到行尾、又用 ghost 小按钮，是让它**看得见但够不着手指**。

        【为什么禁用而不是藏起来】做对封口之后（`locked`）按钮留着、灰着、
        带 `lockTitle` 的 tooltip —— 和那两个按钮同一套规矩：
        控件突然消失比一个灰按钮更让人慌（"是不是我弄坏了什么"）。
      -->
      <MiButton
        class="run-reset"
        variant="ghost"
        size="sm"
        :disabled="!canReset"
        :title="lockTitle"
        @click="resetOpen = true"
      >
        {{ QUIZ.RESET }}
      </MiButton>
      <!--
        提交按钮灰着的时候必须说明为什么。一个灰按钮不给理由是典型的"界面骗人"：
        学员会以为软件坏了，或者以为自己哪里填错了。
        已经封口（做对了）时不显示这句 —— 那时候没什么要解释的。
      -->
      <span v-if="!canSubmit && !locked" class="run-note">{{ QUIZ.SUBMIT_NEED_RUN }}</span>
      <span v-else-if="canSubmit && view.phase === 'done'" class="run-note ok">
        {{ QUIZ.RUN_READY }}
      </span>
    </div>

    <!--
      诊断卡 —— 「没做对」时屏幕上的第一句人话。

      【为什么卡在按钮和输出框**之间**，而不是跟在输出框后面】
      输出框里可能是几十行编译器原文。跟在后面的话，恰恰在**最需要它的那种情况**
      （编译报错）下，它被顶到屏幕外面去了 —— 学员点了「跑跑看」，
      眼睛还在按钮那一带，底下多出来一句他得往下滚才能看见的话，等于没说。
      这和输出框内那把 `ec-card`（讲解卡在原始报错**上面**）是同一条道理：
      先给结论，再给证据。

      【为什么不在这里顺便把编译报错原文也贴一遍】
      底下那个输出框就是干这个的，而且带 `showStderr` 全套高亮。
      同一屏贴两份一模一样的报错，只会让人怀疑自己看漏了什么。
      这张卡独有的价值是**指到第几行**和**猫咪那口气的框定**。
    -->
    <QuizRunDiagnosis v-if="diagnosis" :diagnosis="diagnosis" />

    <!-- 输出区。抬头条 + 正文拼成一个框，和练习场那块长得一样 -->
    <div class="run-out" :class="view.tone">
      <div class="out-head">
        <span class="out-title">{{ RUNNER_UI.OUTPUT_TITLE }}</span>
        <span v-if="view.statusText && !view.showMessage" class="out-status">
          <span class="dot" />
          <span class="out-status-text">{{ view.statusText }}</span>
          <span v-if="view.showDuration" class="out-time">· {{ RUNNER_UI.duration(view.durationMs) }}</span>
        </span>
      </div>

      <div ref="outBodyEl" class="out-body">
        <!-- 还没跑过 -->
        <div v-if="view.phase === 'idle'" class="hint">
          <div class="hint-main">{{ QUIZ.RUN_IDLE }}</div>
          <div class="hint-sub">{{ QUIZ.RUN_IDLE_SUB }}</div>
        </div>

        <!-- 正在编译 / 正在跑 -->
        <div v-else-if="view.phase === 'running'" class="hint running">
          <span class="dots">
            <i class="mi-motion-keep" /><i class="mi-motion-keep" /><i class="mi-motion-keep" />
          </span>
          <div class="hint-main">{{ QUIZ.RUNNING }}</div>
          <div class="hint-sub">{{ QUIZ.RUNNING_SUB }}</div>
        </div>

        <!-- 有结果 -->
        <template v-else>
          <!-- 长解释（环境没装之类）单独占一块说，不挤在单行截断的结果条上 -->
          <div v-if="view.showMessage" class="callout">{{ view.statusText }}</div>

          <!--
            报错讲解卡。位置在**原始报错上面**：零基础的人看到
            `expected ';' before 'return'` 第一反应是「这什么鬼」，
            猫咪解释才是他真正需要先读到的东西；编译器原文退到下面当证据。
            卡片内容完全来自 `runView()` → `matchError()`，这一层不自己编话。

            三段文案（标题/解释/怎么办）都过 `MiRichText`：错误库里是按
            「有内联标记」写的（`**强调**` 和 `` `代码` ``），
            不过一道就会把星号和反引号原样摆给学员看。理由见 `lib/rich-text.ts`。
          -->
          <div v-if="view.errorCard" class="err-card">
            <div class="ec-tag">{{ view.errorCard.tag }}</div>
            <div class="ec-title"><MiRichText :text="view.errorCard.title" /></div>
            <div class="ec-explain"><MiRichText :text="view.errorCard.explain" /></div>
            <div class="ec-fix">
              <span class="ec-fix-label">{{ ERROR_UI.FIX_LABEL }}</span>
              <MiRichText :text="view.errorCard.fixHint" />
            </div>
          </div>

          <!--
            编译告警。摆在 stdout 前面（时间上它就先发生）。
            刻意不并进 stdout：判分是拿 stdout 逐字比的，
            掺一行 warning 学员就会看到"写对了却判错"。
          -->
          <div v-if="view.showCompileWarnings" class="warn-card">
            <div class="wc-title">{{ RUNNER_UI.COMPILE_WARNED }}</div>
            <pre class="wc-body">{{ view.compileWarnings }}</pre>
          </div>

          <pre v-if="view.stdout" class="out-text">{{ view.stdout }}</pre>
          <pre v-if="view.showStderr" class="out-text err">{{ view.stderr }}</pre>
          <!-- 原生模式那一趟：这一趟是谁跑的。答题里更需要这一行 ——
               这一屏的输出**是要判分的**，学员得知道判据背后用的是哪个编译器。 -->
          <div v-if="view.nativeLine" class="note">{{ view.nativeLine }}</div>
          <div v-if="view.truncated" class="note">{{ RUNNER_UI.TRUNCATED }}</div>
          <div v-if="view.showNoOutput" class="hint">
            <div class="hint-main">{{ RUNNER_UI.NO_OUTPUT }}</div>
          </div>
        </template>
      </div>
    </div>

    <!--
      参考解入口 —— **主动**那条路（"我不想再试了，给我看答案"）。

      【它和上面那张诊断卡的分工，2026-09-22 主人定下的】
      诊断卡是**推**：答错就自动出现，但只给"哪儿错了、拿到什么、要什么"。
      这个按钮是**拉**：学员自己决定什么时候认输。两者互补 ——
      少了按钮，卡住的人只能靠"再错一次"来换解析（而再错一次是要先改代码的）；
      少了诊断卡，第一次答错就只剩一个按钮，那正是主人报的那个洞。

      【门槛：交过卷就有，不再是"错够两次"】
      原先它挂着 `REVEAL_AFTER_WRONG`，理由是不想让答案唾手可得。
      但那条门槛和"自动弹"叠在一起会出真问题：错两次时解析**自动**摊开，
      于是按钮事实上只在"错两次之后还手动关掉弹窗"时才用得上 ——
      等于没有。现在自动弹由 `autoRevealed` 保证只弹一次，
      按钮就退回它本来的职责：**随时可用的人手出口**。

      放在输出框**下面**、另起一行，不混进运行/提交那一排：
      它不属于"做题"那条动线（跑 → 交），混进去会被当成第三个常规操作，
      而它恰恰应该**想不起来去点**才对（点它就等于这一题练到这儿了）。
    -->
    <div v-if="canReveal" class="run-reveal">
      <MiButton variant="ghost" size="sm" @click="revealOpen = true">
        {{ QUIZ.VIEW_ANALYSIS }}
      </MiButton>
    </div>

    <QuizReferenceModal
      v-model:visible="revealOpen"
      :question="question"
      :user-answer="userAnswer"
    />

    <!--
      重置的二次确认。**破坏性动作保留确认**（红线 15）：它删掉的是学员自己写的代码，
      而且没有"撤销重置"这条路。
      文案说清"丢什么、拿回什么"，不是一句没有信息量的"确定吗"。
    -->
    <MiModal v-model:visible="resetOpen" :title="QUIZ.RESET_CONFIRM_TITLE" :width="380">
      <p class="reset-text">{{ QUIZ.RESET_CONFIRM_BODY }}</p>
      <template #footer>
        <MiButton variant="ghost" @click="resetOpen = false">{{ QUIZ.RESET_CANCEL }}</MiButton>
        <MiButton variant="danger" @click="doReset">{{ QUIZ.RESET_CONFIRM }}</MiButton>
      </template>
    </MiModal>
  </div>
</template>

<style scoped>
.quiz-run {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.run-hint {
  font-size: 12px;
  color: var(--mi-text-2);
  line-height: 1.7;
}

/* ── 操作按钮区 ── */
.run-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
/* min-width:0 不能省：flex 子项默认不肯缩到内容宽度以下，长提示会把按钮挤变形 */
.run-note {
  min-width: 0;
  font-size: 12px;
  color: var(--mi-text-3);
  line-height: 1.5;
}
.run-note.ok {
  color: var(--mi-blue-ink);
}
/* 重置按钮推到行尾，和"跑 → 交"那对拉开距离 —— 理由见模板里那段 */
.run-reset {
  margin-left: auto;
  flex-shrink: 0;
}

.reset-text {
  margin: 0;
  line-height: 1.8;
}

/* 参考解入口。靠左对齐、和上面那排按钮同一起点 —— 它虽然另起一行，
   视觉上仍属于"操作区"，不该看起来像浮动在别处的东西。
   （不再有 `margin-top` 负值：它上面现在是输出框，不是按钮排。） */
.run-reveal {
  display: flex;
}

/* ── 输出区 ── */
.run-out {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  background: var(--mi-card);
  overflow: hidden;
}
.out-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  border-bottom: 1px solid var(--mi-border);
  font-size: 12px;
}
.out-title {
  color: var(--mi-text-3);
}
.out-status {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
  min-width: 0;
}
.out-status-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 34ch;
}
.out-time {
  color: var(--mi-text-3);
  flex-shrink: 0;
}
/* 状态点和状态字一起并进功能色深档 —— 和练习场同一套色（--mi-success-deep 那三个） */
.dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}
.ok .out-status {
  color: var(--mi-success-deep);
}
.bad .out-status {
  color: var(--mi-error-deep);
}
.warn .out-status {
  color: var(--mi-warn-deep);
}

/*
 * 正文区。
 * `max-height` + 滚动而不是让它撑开：编译报错动辄二三十行，
 * 不封顶的话遮罩会一路长到 86vh，把上面的代码挤得只剩一条缝 ——
 * 而学员这时候正要看着代码改。
 */
.out-body {
  max-height: 190px;
  overflow: auto;
  padding: 9px 12px;
  font-family: var(--mi-code);
  font-size: 12.5px;
  line-height: 1.6;
}
.out-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--mi-text);
}
/* 报错用红字但不刺眼，和整体柔和调子一致 */
.out-text.err {
  color: var(--mi-error-deep);
}
.out-text + .out-text {
  margin-top: 8px;
}

.callout {
  margin-bottom: 8px;
  padding: 8px 11px;
  border-radius: var(--mi-radius-sm);
  border-left: 4px solid var(--mi-blue-deep);
  background: var(--mi-blue-light);
  color: var(--mi-text);
  font-family: var(--mi-font);
  font-size: 12.5px;
  line-height: 1.7;
  white-space: pre-wrap;
}

/* ── 报错讲解卡 ──
   和 .callout 有意区分开：callout 是主进程给的一行提示，这张卡是**成段的教学内容**。
   所以用卡片（有边、有底色、有标题层级），不用左侧色条那种「一句话提示」的样子。 */
.err-card {
  margin-bottom: 10px;
  padding: 10px 12px;
  border-radius: var(--mi-radius);
  border: 1px solid var(--mi-border);
  border-left: 4px solid var(--mi-blue-deep);
  background: var(--mi-bg);
  color: var(--mi-text);
  font-family: var(--mi-font);
  font-size: 12.5px;
  line-height: 1.75;
}
.ec-tag {
  margin-bottom: 4px;
  font-size: 11px;
  color: var(--mi-text-3);
}
.ec-title {
  font-weight: 600;
  font-size: 13px;
}
.ec-explain {
  margin-top: 5px;
  /* 规则文案里用 \n 分段（json 里写的），这里要让它真的换行 */
  white-space: pre-wrap;
}
.ec-fix {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--mi-border);
  color: var(--mi-text-2);
  white-space: pre-wrap;
}
.ec-fix-label {
  display: inline-block;
  margin-right: 6px;
  padding: 0 6px;
  border-radius: var(--mi-radius-sm);
  background: var(--mi-blue-light);
  color: var(--mi-blue-ink);
  font-size: 11px;
}

.note {
  margin-top: 8px;
  padding: 6px 10px;
  border-radius: var(--mi-radius-sm);
  background: color-mix(in srgb, var(--mi-warn) 30%, transparent);
  color: var(--mi-warn-deep);
  font-family: var(--mi-font);
  font-size: 12px;
}

/*
 * 编译告警块。和 RunnerPanel.vue 里那份是**同一套样式**（刻意各写一份：
 * 那是两个独立的展示点，抽公共组件会把「练习场」和「答题」的版式绑死）。
 * 改这里就改那里，否则会出现"练习场里是暖黄、答题界面里不是"。
 */
.warn-card {
  margin-bottom: 10px;
  padding: 9px 12px;
  border-radius: var(--mi-radius);
  border: 1px solid color-mix(in srgb, var(--mi-warn) 45%, var(--mi-border));
  border-left: 4px solid var(--mi-warn-deep);
  background: color-mix(in srgb, var(--mi-warn) 14%, var(--mi-card));
  font-family: var(--mi-font);
}
.wc-title {
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--mi-warn-deep);
}
.wc-body {
  margin: 6px 0 0;
  padding: 0;
  font-family: var(--mi-code);
  font-size: 12px;
  line-height: 1.6;
  color: var(--mi-text-2);
  white-space: pre-wrap;
  word-break: break-word;
}

/* ── 空白 / 运行中提示 ── */
.hint {
  font-family: var(--mi-font);
  color: var(--mi-text-3);
  text-align: center;
  padding: 10px 0;
}
.hint-main {
  font-size: 12.5px;
  color: var(--mi-text-2);
}
.hint-sub {
  margin-top: 4px;
  font-size: 12px;
}
.running .hint-main {
  color: var(--mi-blue-ink);
}
.dots {
  display: inline-flex;
  gap: 5px;
  margin-bottom: 8px;
}
/* `mi-motion-keep` 挂在 `<i>` 上而不是 `.dots` 上：动画作用的是 `.dots i`，
   总闸按元素匹配，挂在父元素上放行的就不是同一个东西了。见 styles/motion.css */
.dots i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--mi-blue-deep);
  animation: mi-quiz-run-bounce 1.1s infinite ease-in-out;
}
.dots i:nth-child(2) {
  animation-delay: 0.15s;
}
.dots i:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes mi-quiz-run-bounce {
  0%,
  70%,
  100% {
    transform: translateY(0);
    opacity: 0.35;
  }
  35% {
    transform: translateY(-6px);
    opacity: 1;
  }
}
</style>
