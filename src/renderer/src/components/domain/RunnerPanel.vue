<script setup lang="ts">
/**
 * 运行面板：语言选择 + 代码编辑器 + 输入框 + 运行按钮 + 输出区。
 *
 * 【布局为什么是上下而不是左右】
 * 屏幕左边有侧栏，窄一点的笔记本上左右并排会把编辑器和输出都挤成细条，
 * 长一点的代码就得左右拖着看。上下摆则天然适应窄屏，也贴合
 * 「先在上边写、再往下看结果」的直觉。
 *
 * 【「正在运行中」为什么要做得这么重】
 * 代码从点下按钮到出结果，中间要编译、要跑，可能好几秒。
 * 这几秒里界面如果只是「安静地等着」，零基础用户的第一反应是
 * 「是不是卡死了？」，然后开始狂点按钮。所以这里三重提示：
 * 按钮转圈变文字、编辑器变暗锁住、输出区出现跳动的点。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useRunnerStore } from '../../stores/runner'
import { useContentStore } from '../../stores/content'
import { useSettingsStore } from '../../stores/settings'
import { LANG_LABEL } from '../../lib/labels'
import { ACTION, ERROR_UI, RUNNER_UI, TOAST } from '../../lib/copy'
import { EDITOR_LANGS, shouldRestoreFocus } from '../../lib/editor-setup'
import { detectIdeOnce, planIdeChoice, type IdePickHint } from '../../lib/ide-detect'
import { runView } from '../../lib/run-result-view'
import { markSelectionState, registerSelectionSource, releaseSelectionSource } from '../../lib/editor-selection'
import { reportRunToPet, type PetViewRect } from '../../lib/pet-bridge'
import { claimWorkRect, releaseWorkRect } from '../../lib/pet-work-rect'
import MiButton from '../base/MiButton.vue'
import MiInput from '../base/MiInput.vue'
import MiMascot from '../base/MiMascot.vue'
import MiRichText from '../base/MiRichText.vue'
import MiSelect from '../base/MiSelect.vue'
import { toast } from '../base/toast'
import CodeEditor from './CodeEditor.vue'
import IdePickerModal from './IdePickerModal.vue'
import type { IdeCandidate, LangOfCode } from '../../../../shared/types'

const runner = useRunnerStore()
const content = useContentStore()
const settings = useSettingsStore()
const router = useRouter()

const LANG_OPTIONS = EDITOR_LANGS.map((l) => ({ label: LANG_LABEL[l], value: l }))

/**
 * MiSelect 认的是 string，这里做一次收窄，别让 any 漏进 store。
 *
 * 必须走 `setLang` 而不是直接 `runner.lang = v`：换语言时编辑器里的代码可能
 * 要跟着一起换（编辑器里还是一条没改过的示例时），清结果也在里面。
 * 直接赋值就会退回「选中的语言和编辑器里的代码各说各话」那个 bug —— 见 shared/samples.ts。
 */
const langModel = computed({
  get: () => runner.lang as string,
  set: (v: string) => {
    runner.setLang(v as LangOfCode)
  }
})

/** 空代码不给跑：省一次编译，也避免用户对着「没输出」发懵 */
const canRun = computed(() => !runner.running && runner.code.trim().length > 0)

/**
 * 「🛠 本地 IDE 打开」和「📤 导出并复制路径」的行内反馈
 * （未配置 / 路径找不到 / 这次没成）。`settings: true` 的那几档配一个
 * 「去设置」按钮 —— 没配置和路径失效的下一步都是去设置页，只是问题不同。
 *
 * 【为什么走行内提示而不是弹窗或纯 toast】三种失败的下一步各不相同
 * （去配置 / 换路径 / 看系统原话重试），而且有两条要带正文（路径、
 * 系统详情）。toast 一闪而过、塞不下按钮；弹窗太重。摆输出区上沿
 * 和 `envIssue` 的 GO_SETTINGS 是同一种做法（同一对 .callout/.callout-action）。
 */
const ideIssue = ref<{ text: string; settings: boolean } | null>(null)

/**
 * 「打开 / 导出」有一个在飞（2026-10-17 夜间批）。
 *
 * 【为什么要有】两颗按钮的 disabled 只绑 `canRun`（= 不在运行 + 有代码），
 * 点下去到回话之间没有闸：连点 5 次 = 主进程真的起 5 个 IDE 进程 / 写 5 次
 * 导出文件（native-ide 每次调用各 makeRunDir + spawn）。检测按钮早有
 * `detecting` 闸，这两颗漏了。一个 ref 管两颗按钮：它们的重活都在主进程、
 * 互斥着用不会有人觉得别扭（同一瞬间点两个本来就说不清要哪个）。
 */
const opening = ref<null | 'ide' | 'export'>(null)

/**
 * 用该语言配好的本地 IDE 打开当前代码。
 *
 * 【两种开头（v9 起）】该语言配了路径 → 直接打开（老路）；**没配 → 就地
 * 现检现荐**，不让用户先跑一趟设置页。配了但路径失效的（missing），行内
 * 提示里那颗「自动检测」也走同一条推荐流（见 detectIdeAndOpen）。
 *
 * 【失败不抛、不弹窗，走行内提示】三种失败都是日常（没配 / 路径失效 /
 * 启动不了），各自有各的下一步，见上面 ideIssue 的注释。成功才 toast ——
 * 成功没有任何「下一步」，一句回执就够了（和「导出并复制」对称）。
 */
async function openInIde(): Promise<void> {
  if (opening.value !== null) return
  opening.value = 'ide'
  try {
    ideIssue.value = null
    if (settings.config.nativeIdePaths[runner.lang].trim() !== '') {
      await doOpen(runner.lang)
      return
    }
    await detectIdeAndOpen(runner.lang)
  } finally {
    opening.value = null
  }
}

/**
 * 真正发起「打开」并翻译主进程的三种失败。**打开路径的唯一出口** ——
 * 普通打开、现检现荐、选择框选完三条路最后都汇到这里。
 *
 * `recommendedName`：现检现荐**直接选中**时带上被选中程序的名字 ——
 * 成功回执换成点名版（理由见 TOAST.IDE_OPENED_RECOMMENDED 的注释）。
 */
async function doOpen(lang: LangOfCode, recommendedName?: string): Promise<void> {
  try {
    // own（2026-10-06）：此刻编辑器里这段是不是用户自己写的（≠ 载入的官方示例）。
    // 主进程凭它决定要不要挂编译观察（编译成功 → 桌宠发运行奖）
    const r = await window.miai.openInIde({ lang, code: runner.code, own: runner.currentOwn })
    if (r.ok) {
      // 成功也要清行内提示：现检现荐那条路会在点「打开」时先挂一行「正在帮你找…」
      // （见 detectIdeAndOpen），成功这条分支不把它摘掉的话，打开明明成了，
      // 屏上却还挂着「正在找」—— 探针 2026-10-01 实测拍到的就是这一条。
      ideIssue.value = null
      toast(
        recommendedName ? TOAST.IDE_OPENED_RECOMMENDED(recommendedName, lang) : TOAST.IDE_OPENED,
        'success'
      )
    } else if (r.reason === 'unconfigured') {
      ideIssue.value = { text: RUNNER_UI.IDE_UNCONFIGURED, settings: true }
    } else if (r.reason === 'missing') {
      // detail 由主进程填成配置里那个路径 —— 用户要拿它对照自己填过什么
      ideIssue.value = { text: RUNNER_UI.IDE_MISSING(r.detail ?? ''), settings: true }
    } else {
      ideIssue.value = { text: RUNNER_UI.IDE_FAILED(r.detail), settings: false }
    }
  } catch {
    /*
     * 理论上到不了：失败都是正常返回值（见 preload 的注释）。
     * 能进这一支的只有「我们传错了形状」这种自家的错 —— 照实说，
     * 别赖到用户的路径或系统上（同 AI_TEST_UNEXPECTED 的口径）。
     */
    ideIssue.value = { text: RUNNER_UI.IDE_REQUEST_FAILED, settings: false }
  }
}

/**
 * 导出代码到临时文件，并把文件路径复制到剪贴板。
 *
 * 【复制为什么在渲染层做】`clipboard` 只有渲染进程有，主进程那条
 * `runner:export-code` 只写文件（见 preload 注释）。照 `CompareGrid`
 * 的老办法：先 `navigator.clipboard`，不行退回 execCommand ——
 * 但**退回那一步要看返回值**：路径是要拿去用的东西，假装复制成功
 * 比明说失败坏得多（用户会拿着剪贴板里的旧内容去找文件）。
 */
async function exportCode() {
  if (opening.value !== null) return
  opening.value = 'export'
  try {
    ideIssue.value = null
    const r = await window.miai.exportCode({ lang: runner.lang, code: runner.code, own: runner.currentOwn })
    if (!r.ok) {
      ideIssue.value = { text: RUNNER_UI.EXPORT_FAILED(r.detail), settings: false }
    } else if (await copyPath(r.path)) {
      toast(TOAST.EXPORT_COPIED, 'success')
    } else {
      // 文件写好了、只是没复制成：把路径亮出来让人手抄，别说一句「失败」完事
      ideIssue.value = { text: RUNNER_UI.EXPORTED_PATH(r.path), settings: false }
    }
  } catch {
    ideIssue.value = { text: RUNNER_UI.EXPORT_FAILED(), settings: false }
  } finally {
    opening.value = null
  }
}

/** 复制一段文本，**如实返回成没成**（execCommand 的返回值也算数） */
async function copyPath(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    /* 继续走下面的兜底 */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/**
 * 该语言没配程序（或路径失效）时的**就地现检现荐**：检完按 planIdeChoice 分派。
 *
 * 【为什么"直接选最优"】主人 2026-10-01 验收拍板：不知情的用户碰上一半语言
 * 乱码会以为卡 bug —— 选最优 → 落盘 → 打开一条龙，按一下就把事办完；
 * 只有真分不出高下（平手 / 全不合适还有得挑）才摆选择框。判定口径与设置页
 * 共用 `lib/ide-detect.ts`，两处的差别只在「找到之后干什么」。
 *
 * 【先给一行「正在找」】扫描要一两秒 —— 静悄悄的两秒会被当成卡死了。
 */
const detecting = ref(false)
const pickerOpen = ref(false)
const pickerList = ref<IdeCandidate[]>([])
/** 选择框是替哪门语言开的 —— 关框再选那下 runner.lang 可能已经换了，别现读 */
const pickerLang = ref<LangOfCode>('c')
const pickerHint = ref<IdePickHint>('tie')
const pickerRecommended = ref<string | null>(null)

async function detectIdeAndOpen(lang: LangOfCode): Promise<void> {
  if (detecting.value) return
  detecting.value = true
  ideIssue.value = { text: RUNNER_UI.IDE_AUTO_LOOKING, settings: false }
  try {
    const plan = planIdeChoice(lang, await detectIdeOnce())
    if (plan.kind === 'choose') {
      await applyIdeAndOpen(lang, plan.candidate.path, plan.candidate.name)
    } else if (plan.kind === 'pick') {
      // 摆选择框前把「正在找」清掉 —— 用户在框里挑多久，行内都不该还挂着那句话
      ideIssue.value = null
      pickerLang.value = lang
      pickerList.value = plan.candidates
      pickerHint.value = plan.hint
      pickerRecommended.value = plan.recommendedPath
      pickerOpen.value = true
    } else if (plan.kind === 'none') {
      ideIssue.value = { text: RUNNER_UI.IDE_DETECT_NONE_FOR_LANG(lang), settings: true }
    } else {
      ideIssue.value = { text: RUNNER_UI.IDE_DETECT_FAILED, settings: true }
    }
  } finally {
    detecting.value = false
  }
}

/**
 * 检测选中后：先存路径，**等它真的落盘**，再照常走一次「打开」。
 *
 * 【为什么必须 await setIdePath 再打开】exe 是主进程从 `readConfig()`
 * **现读**的（安全边界，见 preload 注释）——落盘只要还没到，主进程读到的
 * 就还是空路径，这一次打开必然报回「没配置」，用户看到的是「检测成功了，
 * 但它说我没配置」，比不检测还迷惑。
 */
async function applyIdeAndOpen(
  lang: LangOfCode,
  path: string,
  recommendedName?: string
): Promise<void> {
  await settings.setIdePath(lang, path)
  await doOpen(lang, recommendedName)
}

/** 选择框里点了一个（关框由弹窗自己做，见 IdePickerModal） */
function onPickerPick(c: IdeCandidate): void {
  void applyIdeAndOpen(pickerLang.value, c.path)
}

const result = computed(() => runner.lastResult)

/**
 * 「界面该显示什么」全部交给 lib/run-result-view.ts 算——那段是纯函数，
 * 十几种状态组合都由单测钉着（超时不能说成「跑完啦」、环境没装不能
 * 甩系统英文报错、没输出不能留空白）。组件这边只负责摆样子。
 *
 * 递进去的两样东西是讲解卡要用的：**哪门语言的规则**（Java 的报错当然查
 * Java 的规则）和**规则库本体**（跟着内容包一起打进 bundle，离线可用）。
 */
const view = computed(() =>
  runView(result.value, runner.running, {
    lang: runner.lang,
    errorLib: content.bundle.errorLib
  })
)

/**
 * 编辑器的把手。只用到 clear —— focus 是给下面那个 watch 用的。
 *
 * 类型手写而不是 `InstanceType<typeof CodeEditor>`：defineExpose 出来的东西
 * 走的是 `ComponentPublicInstance`，泛型推导在这里只会得到一堆 any；
 * 手写两个方法签名，写错了编译器当场就红。
 */
const editor = ref<{
  focus: () => void
  clear: () => void
  lineRect: (n: number) => PetViewRect | null
  selection: () => { text: string; fromLine: number; toLine: number } | null
} | null>(null)

/**
 * 把编辑器的选区透出去（P1，AI 侧栏的「@选区」）。
 *
 * 【为什么加这一层转发，而不是让侧栏直接拿 CodeEditor】编辑器实例住在这一层
 * （它是 RunnerPanel 的子组件）；侧栏和 RunnerPanel 是**兄弟**，
 * 兄弟之间不该知道对方的内部结构。父组件（PlaygroundView）拿到的就是这个函数 ——
 * 侧栏只认"能现取一段选区"这个契约，不认 CodeEditor。
 */
function selection(): { text: string; fromLine: number; toLine: number } | null {
  return editor.value?.selection() ?? null
}

/*
 * 把"取选区"这件事登记给侧栏（P1）。侧栏在外壳里，拿不到这个组件实例 ——
 * 登记处是两者之间唯一的桥（理由见 lib/editor-selection.ts）。
 * 卸载时**必须撤销并比对是不是自己**，否则路由切走之后侧栏还会指着一个
 * 已销毁的 EditorView。
 */
const selectionSource = (): { text: string; fromLine: number; toLine: number } | null =>
  editor.value?.selection() ?? null

onMounted(() => {
  registerSelectionSource(selectionSource)
})

onBeforeUnmount(() => {
  releaseSelectionSource(selectionSource)
})

/** 编辑器报上来的"有没有选区"（只透传，不解释） */
function onSelectionChange(has: boolean): void {
  markSelectionState(has)
}

defineExpose({ selection })

/**
 * 输出区正文（桌宠的兜底落脚点）：报错行不在视口里 / 认不出行号时，
 * 鱼站到输出区的上沿（见 lib/pet-bridge.ts 的上报口径）。
 */
const outBodyEl = ref<HTMLElement>()

/** 视口矩形小工具：拿不到元素（还没渲染）就 null */
function rectOfEl(el: HTMLElement | undefined): PetViewRect | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null
}

/**
 * 正文编辑区的**让位对象登记**（跟随鼠标的「绝不遮挡代码」规则，2026-10-09
 * 补充模块一）。主进程拿它算「光标是不是进了编辑区」，进了就让鱼沿边等待
 * 而不是继续贴光标 —— 编辑区在哪只有渲染层知道（同 pet-bridge 报错 rect 的
 * 既有口径：报**视口** CSS px，屏幕系换算归主进程）。
 *
 * 【为什么观测（ResizeObserver / resize / 捕获阶段 scroll / 120ms 节流）不在这里了】
 * 答题页那个编辑器（QuizCodeRun）也要同一个让位对象，而两边**同时挂着** ——
 * 答题遮罩是 /playground 上的覆盖层，遮罩打开时这一块还在屏幕上。观测各写一份
 * 的话，最危险的那种漂移是「答题遮罩关掉时撤让位，把练习场这份还开着的连坐撤掉」。
 * 所以整套观测收进 `lib/pet-work-rect.ts` 的登记表（栈语义 + 坑的来龙去脉都在那边），
 * 这里只剩认领/释放两句话：键 'runner' 与 QuizCodeRun 的 'quiz' 配对，
 * 后认领的在上（遮罩压在练习场之上）。
 */
const editorSlotEl = ref<HTMLElement>()

onMounted(() => {
  claimWorkRect('runner', editorSlotEl.value)
})

onBeforeUnmount(() => {
  // 出栈，不是直接报 null：栈里还有别人（遮罩还开着）时，会立刻把栈顶那个重报上去。
  // 直接报 null 会把别人的让位对象一起撤掉 —— 理由详见 lib/pet-work-rect.ts 的 release。
  releaseWorkRect('runner')
})

/**
 * 每次跑完，把结果告诉桌宠（它自己决定值不值得说一句 / 要不要走过来）。
 *
 * 【为什么 watch 结果对象而不是在点击处理里调】运行有多条触发路径
 * （工具栏按钮、以后的快捷键），跟在某一处只盖住那一条 —— 同下面
 * 那个「还焦点」watcher 的理由。结果对象每跑一次都是新的，
 * 值相同的两次运行也不会被 Vue 吞掉（它比的是引用）。
 */
watch(
  () => runner.lastResult,
  (r) => {
    reportRunToPet(r, {
      lineRect: (n) => editor.value?.lineRect(n) ?? null,
      fallbackRect: rectOfEl(outBodyEl.value),
      // own/hash：**跑的那份**的"是不是用户自己写的"与指纹（run() 开始时快照，
      // 见 runner store）—— 主进程凭它发运行奖（大白饭 +1）与去重
      own: runner.lastRunOwn,
      hash: runner.lastRunFp
    })
  },
  { flush: 'post' }
)

function clearCode() {
  editor.value?.clear()
}

/**
 * 跑完了，把焦点还回编辑器。
 *
 * 【为什么是 watch 而不是在点击处理里 await run()】
 * 运行有三条触发路径（工具栏按钮、以后的快捷键、代码里的 intent），
 * 把「还焦点」写在某一条的后面，另外两条就漏了。盯着 running 这个状态，
 * 谁触发的不重要。
 *
 * 【为什么必须 flush: 'post'】
 * 默认的 pre 时机跑在 DOM 更新**之前**，那一刻编辑器还停在
 * contenteditable="false" 上——只读元素 focus() 是无效的，
 * 这一行会静默地什么都不做，看起来就像没写。post 等 DOM 更新完再跑。
 */
watch(
  () => runner.running,
  (now, before) => {
    // 开始跑（false→true）：把上一次 IDE/导出留下的行内提示清掉 ——
    // 它说的是上一个动作的结果，紧跟着输出区就要换这一趟的内容，留着会串台。
    if (now) {
      ideIssue.value = null
      return
    }
    // 只在「刚跑完」那一下动手：本来就没在跑（false→false）不用管
    if (!before) return
    const el = document.activeElement as HTMLElement | null
    const active = el ? { tagName: el.tagName, editable: el.isContentEditable } : null
    if (shouldRestoreFocus(active)) editor.value?.focus()
  },
  { flush: 'post' }
)
</script>

<template>
  <section class="runner-panel">
    <div class="toolbar">
      <div class="tb-row">
        <span class="tb-label">{{ RUNNER_UI.LANG_LABEL }}</span>
        <MiSelect v-model="langModel" :options="LANG_OPTIONS" :disabled="runner.running" />
        <span class="spacer" />
        <!--
          「本地 IDE 打开」和「运行」并列，但**它不跑代码**：把代码写进临时
          文件、交给本机一个合适的程序打开。该语言没配时也可点 —— 点击就地
          现检现荐（v9 拍板：直接选最优），灰按钮不解释原因，而这条功能的
          第一道门恰是"先有一个程序"。检测中临时禁点：连点会叠着扫三遍。
        -->
        <MiButton
          variant="secondary"
          :loading="opening === 'ide'"
          :disabled="!canRun || detecting"
          :title="RUNNER_UI.OPEN_IDE_HINT"
          @click="openInIde"
        >
          {{ RUNNER_UI.OPEN_IDE }}
        </MiButton>
        <MiButton
          variant="secondary"
          :loading="opening === 'export'"
          :disabled="!canRun"
          :title="RUNNER_UI.EXPORT_CODE_HINT"
          @click="exportCode"
        >
          {{ RUNNER_UI.EXPORT_CODE }}
        </MiButton>
        <MiButton :loading="runner.running" :disabled="!canRun" @click="runner.run()">
          {{ runner.running ? RUNNER_UI.RUNNING : RUNNER_UI.RUN }}
        </MiButton>
      </div>
      <div class="tb-row">
        <span class="tb-label">{{ RUNNER_UI.STDIN_LABEL }}</span>
        <MiInput
          v-model="runner.stdin"
          :placeholder="RUNNER_UI.STDIN_PLACEHOLDER"
          :disabled="runner.running"
          width="100%"
        />
      </div>
    </div>

    <div class="code-area">
      <div class="code-bar">
        <span class="out-title">{{ RUNNER_UI.CODE_TITLE }}</span>
        <!--
          清空代码。禁而不是藏：这个按钮的位置是固定的，运行时藏起来会让下方
          编辑器整块往上跳一下，主人会以为界面抽了一下。置灰则一眼看出
          「现在不能清」。
        -->
        <button
          type="button"
          class="bar-btn"
          :title="RUNNER_UI.CLEAR_CODE_HINT"
          :disabled="runner.running || runner.code.length === 0"
          @click="clearCode"
        >
          {{ RUNNER_UI.CLEAR_CODE }}
        </button>
      </div>
      <div ref="editorSlotEl" class="editor-slot">
        <CodeEditor
          ref="editor"
          v-model="runner.code"
          :lang="runner.lang"
          :readonly="runner.running"
          height="100%"
          @selection-change="onSelectionChange"
        />
      </div>
    </div>

    <div class="output" :class="view.tone">
      <div class="out-head">
        <span class="out-title">{{ RUNNER_UI.OUTPUT_TITLE }}</span>
        <!-- 长解释（showMessage）不挤在这一行：这行是单行省略号截断的，
             整段解释塞进来会被切成半句话 -->
        <span v-if="view.statusText && !view.showMessage" class="out-status">
          <span class="dot" />
          <span class="out-status-text">{{ view.statusText }}</span>
          <span v-if="view.showDuration" class="out-time">· {{ RUNNER_UI.duration(view.durationMs) }}</span>
        </span>
        <!-- 只在真有东西可清的时候出现，免得是个点了没反应的死按钮 -->
        <button
          v-if="!runner.running && result"
          type="button"
          class="bar-btn"
          :title="RUNNER_UI.CLEAR_HINT"
          @click="runner.clearResult()"
        >
          {{ RUNNER_UI.CLEAR }}
        </button>
      </div>

      <!--
        输出区右栏：跟着运行状态换表情的小鱼。
        它和正文**并排**而不是浮在正文上面：浮上去的话，输出一长，
        文字就从鱼身上穿过去，看着像界面坏了。并排则永远不会打架。
        seed 用「第几次运行」，所以每跑一次换一张（图池见 lib/mascot.ts）。
      -->
      <div class="out-main">
        <div ref="outBodyEl" class="out-body">
          <!--
            「本地 IDE 打开 / 导出并复制路径」的反馈（未配置 / 路径失效 / 这次没成）。
            摆在**所有状态分支之前**：这两个动作和运行无关（没跑过任何代码也能用），
            反馈若藏在「有结果」那一支里，第一次点的人会什么都看不见。
            成对的 .callout / .callout-action 和下面 envIssue 那对是同一套样式。
          -->
          <div v-if="ideIssue" class="callout">{{ ideIssue.text }}</div>
          <div v-if="ideIssue?.settings" class="callout-action">
            <!--
              「自动检测」摆在「去设置」前面：没配置和路径失效这两档里，
              用户的第一诉求都是「那帮我找到一个啊」—— 就地找比指挥他去
              设置页再找一遍少一次往返（设置页那个按钮是给「专门来配」的人）。
              检测中禁点 + 换字（扫描要一两秒，没回执会挨猛戳）。
            -->
            <MiButton size="sm" variant="secondary" :disabled="detecting" @click="detectIdeAndOpen(runner.lang)">
              {{ detecting ? ACTION.DETECTING : ACTION.AUTO_DETECT }}
            </MiButton>
            <MiButton size="sm" variant="secondary" @click="router.push('/settings')">
              {{ RUNNER_UI.IDE_GO_SETTINGS }}
            </MiButton>
          </div>

          <!-- 还没跑过 -->
          <div v-if="view.phase === 'idle'" class="hint">
            <div class="hint-main">{{ RUNNER_UI.IDLE }}</div>
            <div class="hint-sub">{{ RUNNER_UI.IDLE_SUB }}</div>
          </div>

          <!-- 正在跑 -->
          <div v-else-if="view.phase === 'running'" class="hint running">
            <!-- `mi-motion-keep` 挂在 `<i>` 上而不是 `.dots` 上：**动画作用的是 `.dots i`**
                 （见样式里的 `animation: mi-run-bounce ...`），总闸按元素匹配，
                 挂在父元素上放行的就不是同一个东西了。见 styles/motion.css -->
            <span class="dots">
              <i class="mi-motion-keep" /><i class="mi-motion-keep" /><i class="mi-motion-keep" />
            </span>
            <div class="hint-main">{{ RUNNER_UI.RUNNING_HINT }}</div>
            <div class="hint-sub">{{ RUNNER_UI.RUNNING_SUB }}</div>
          </div>

          <!-- 有结果 -->
          <template v-else>
            <div v-if="view.showMessage" class="callout">{{ view.statusText }}</div>
            <div v-if="view.envIssue" class="callout-action">
              <MiButton size="sm" variant="secondary" @click="router.push('/settings')">
                {{ RUNNER_UI.GO_SETTINGS }}
              </MiButton>
            </div>

            <!--
              报错讲解卡。
              位置在**原始报错上面**：零基础的人看到 `NameError: name 'a' is not defined`
              第一反应是「这什么鬼」，猫咪解释才是他真正需要先读到的东西；
              编译器原文退到下面当证据，想深究的人自然会往下看。

              三段文案都过 `MiRichText` —— 和答题界面（`QuizCodeRun.vue`）用的是
              同一个组件、同一批文案。**两处必须同步改**：错误库里的
              `**强调**` 和 `` `代码` `` 不过这一道就会原样显示成星号和反引号，
              只修一边就会出现"练习场里是粗体、答题界面里不是"。
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
              编译过了、编译器却仍说的话（-Wall 的告警）。
              摆在 stdout **前面**，因为它按时间就发生在前面：翻译官喵先嘀咕，
              程序才开始跑。摆在后面会让人读成"跑完才出的问题"。
              它和 stdout 是两条通道，绝不并成一条：stdout 是判分依据，
              掺一行告警就会变成"写对了却判错"。
            -->
            <div v-if="view.showCompileWarnings" class="warn-card">
              <div class="wc-title">{{ RUNNER_UI.COMPILE_WARNED }}</div>
              <pre class="wc-body">{{ view.compileWarnings }}</pre>
            </div>

            <pre v-if="view.stdout" class="out-text">{{ view.stdout }}</pre>
            <pre v-if="view.showStderr" class="out-text err">{{ view.stderr }}</pre>
            <!-- 原生模式那一趟：把「刚才到底是谁跑的」写在明面上。
                 放在输出的**下面**：它是这一趟的注脚（谁跑的），
                 不是结果本身（跑出了什么）；摆上面会先抢走注意力。 -->
            <div v-if="view.nativeLine" class="note">{{ view.nativeLine }}</div>
            <div v-if="view.truncated" class="note">{{ RUNNER_UI.TRUNCATED }}</div>
            <div v-if="view.showNoOutput" class="hint">
              <div class="hint-main">{{ RUNNER_UI.NO_OUTPUT }}</div>
            </div>
          </template>
        </div>

        <div v-if="view.mascotPose" class="out-side">
          <MiMascot :pose="view.mascotPose" size="m" :seed="runner.runSeq" />
        </div>
      </div>
    </div>

    <!--
      面板底部的常驻小鱼（2026-09-19 新增）。

      【为什么在这儿，而不是填进输出框右边那块空】
      输出框右边那条鱼（`.out-side` 上面那条）的「摆不摆、摆哪张」由
      `run-result-view.ts` 的 `mascotPose` **独家**说了算，而它的定义里写死了
      「还没跑过就**不摆鱼**」—— 理由是空输出区里多一条鱼会被当成输出内容。
      这一格早先想填进去，撞上那条决定，于是挪到**面板最底下**：
      它不属于输出框，不进 `runView()` 的判据，`mascotPose` 说不说话都跟它无关。
      **判据仍然只有一处** —— 输出区摆不摆鱼问 `mascotPose`，这一条永远在这儿。

      【为什么是 `think` 而不是别的姿态】
      这一格**不随任何状态变**，所以它的姿态不能被读成一种状态：
        `busy`/`yay`/`soothe` 是运行三态的专用面孔，放这儿等于伪装成状态；
        `remind` 会读成「下面还有一条待办」；`expect` 读成「有个入口在等你点」。
      `think`（歪头思考）不承诺任何事，正合「你写、我看」这个位置。

      【为什么在最底下而不是跟着工具条】见下面 .panel-foot 那段注释。
    -->
    <div class="panel-foot">
      <MiMascot pose="think" size="s" />
    </div>

    <!-- 检测到多个（或全不合适）时的选择框（关框由弹窗自己发 update:visible，见该组件注释） -->
    <IdePickerModal
      :visible="pickerOpen"
      :candidates="pickerList"
      :lang="pickerLang"
      :hint="pickerHint"
      :recommended-path="pickerRecommended"
      @update:visible="pickerOpen = $event"
      @pick="onPickerPick"
    />
  </section>
</template>

<style scoped>
.runner-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 0;
}

/* ── 工具条 ── */
.toolbar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}
.tb-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tb-label {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--mi-text-2);
}
.spacer {
  flex: 1;
}

/* ── 代码区（抬头条 + 编辑器，合起来当一个框）── */
.code-area {
  flex: 1.3;
  min-height: 160px;
  /* min-height:0 不能省：flex 子项默认 min-height:auto，
     内容高了会把整个面板顶出去，输出区被挤没 */
  display: flex;
  flex-direction: column;
}

/*
 * 代码抬头条：左边「代码」两个字，右边「清空代码」。
 * 和下面的编辑器**拼成一个框**：这条只画上、左、右三边，下边留给编辑器自己，
 * 圆角也只圆上面两个角。否则两个各自完整的框叠在一起，中间会多出一条双线。
 */
.code-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 6px 3px 12px;
  border: 1px solid var(--mi-border);
  border-bottom: none;
  border-radius: var(--mi-radius-sm) var(--mi-radius-sm) 0 0;
  background: var(--mi-card);
  font-size: 12px;
}

.editor-slot {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.editor-slot > * {
  flex: 1;
  min-height: 0;
}
/* 上面那块已经给过圆角了，这里抹平，两边才接得上 */
.editor-slot :deep(.mi-code-editor) {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}

/* ── 输出区 ── */
.output {
  flex: 1;
  min-height: 120px;
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
  padding: 6px 12px;
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
  max-width: 42ch;
}
.out-time {
  color: var(--mi-text-3);
  flex-shrink: 0;
}

/* 两个抬头条上共用的小按钮：代码区那个「清空代码」、输出区那个「清空」 */
.bar-btn {
  flex-shrink: 0;
  padding: 2px 8px;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  background: transparent;
  color: var(--mi-text-3);
  font-family: var(--mi-font);
  font-size: 12px;
  cursor: var(--mi-cursor, pointer);
}
/*
 * 悬停效果要排除禁用态。少了 :not(:disabled)，鼠标扫过一个灰按钮
 * 它照样亮成蓝色 —— 看起来能点，点下去没反应，是最典型的「界面骗人」。
 */
.bar-btn:not(:disabled):hover {
  border-color: var(--mi-blue-deep);
  color: var(--mi-blue-ink);
}
.bar-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

/*
 * 把抬头条最后那个按钮推到最右边。
 * 有状态文字时不能推：状态文字自己带 margin-left:auto，两个 auto 会把空白
 * **平分**，状态文字就飘到中间去了。所以那时把按钮的 auto 撤掉，
 * 让状态文字一个人把整段空白吃掉、顺带把按钮顶到最右。
 * 两条规则同权重，靠书写顺序分胜负 —— 下面那条必须写在后面。
 */
.out-title ~ .bar-btn {
  margin-left: auto;
}
.out-status ~ .bar-btn {
  margin-left: 0;
}
.dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}
/* 那三个小圆点（background: currentColor）+ 状态字，一并并进功能色深档。
   原来是另写的一套绿红黄，和 --mi-success/error/warn 对不上，且都不达标。 */
.ok .out-status {
  color: var(--mi-success-deep);
}
.bad .out-status {
  color: var(--mi-error-deep);
}
.warn .out-status {
  color: var(--mi-warn-deep);
}

/* 正文滚动区 + 右边那条鱼。滚动条只归正文那一格，鱼不跟着往上滚走 */
.out-main {
  flex: 1;
  min-height: 0;
  display: flex;
}
.out-body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 10px 12px;
  font-family: var(--mi-code);
  font-size: 13px;
  line-height: 1.6;
}
.out-side {
  flex-shrink: 0;
  /* 上边距和 .out-body 的 padding-top 对齐，鱼顶就和第一行文字齐平 */
  padding: 10px 12px 0 0;
}

/*
 * 面板最底下那条常驻小鱼（2026-09-19 新增）。
 *
 * 【为什么不跟工具条挤一行，非要单独占一条】
 * 工具条那两行是「选语言 / 填输入 / 点运行」，每一个都是**操作**。
 * 把鱼塞进去，它就会落在一排控件的正中间 —— 用户的视线在那儿是找按钮的，
 * 一个不响应点击的形象混在里面，最轻是多余，最重是让人去点它。
 * 独占最后一条，它和上面所有可点的东西之间隔着整块输出框，没有任何歧义。
 *
 * 【⚠️ 为什么靠左，不靠右 —— 靠右会撞上缩放控件】
 * 第一版写的是 `justify-content: flex-end`（靠右），想法是让它和输出框里
 * 那条状态鱼（`.out-side`，右边距 12px）的右缘落在同一条竖线上，看着整齐。
 * **实测撞车了**：`.zoom-ctl`（正文缩放控件，我上一轮做的）是
 * `position: absolute; right: 14px; bottom: 14px; z-index: 50`，实测矩形
 * x 936~1172 / y 698~730；而靠右的鱼在 x 1066~1114 / y 672~720 ——
 * **横竖都有交叠，缩放控件把鱼下半截 22px 整个盖住**。
 * 这不是「谁压谁」的问题（z-index 50 当然赢），是那个角落**本来就属于它**：
 * 鱼放那儿只有被遮住这一种结局。
 * 靠左之后鱼的 x 是 238 起，离 936 有一大截，这个冲突从根上没有了。
 *
 * 【为什么靠左反而是更好的落点】
 * `padding-left: 12px` 是照着 `.out-body` 的 `padding: 10px 12px` 写的 ——
 * 鱼的左缘正好和输出框里正文的左缘对齐，读作「这一栏的字从这里开始，我站这儿看着」。
 *
 * 【它要花掉多少高度 —— 这是这次改动的真实代价，实测过】
 * 鱼的 S 档是 48px，`.runner-panel` 的 `gap: 10px` 再算一条，共 **58px**。
 * 同一页面、同一时刻、只把那一条 `display:none` 再量一次：
 *   代码区 271 → 238（**−33px**）  输出框 209 → 184（**−25px**）  面板总高不变
 * 两个框各自的 `min-height`（160 / 120）是兜底：窗口压到最矮时先到底的是它们。
 * 实测 1200×780 下面板溢出=false、页面纵向溢出=false。
 *
 * 【为什么这一条自己也 `flex-shrink: 0`】
 * 不写的话它默认可以缩，而它里面的 `.mi-mascot` 是**缩不了**的（组件契约）。
 * 一旦这一格被压到 48px 以下，鱼就会从格子里探出来，压到底下别的东西上 ——
 * 缩了一条却什么也没省下，只是把溢出从「整条少一点」换成「鱼戳出去」。
 * 所以让它硬气地占住 48px：真要挤不下，宁可上面两个框先到底。
 */
.panel-foot {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-start;
  padding-left: 12px;
}

.out-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--mi-text);
}
/* 报错用红字但不用刺眼的纯红，和整体柔和调子一致 */
.out-text.err {
  color: var(--mi-error-deep);
}
.out-text + .out-text {
  margin-top: 8px;
}

.callout {
  margin-bottom: 8px;
  padding: 9px 12px;
  border-radius: var(--mi-radius-sm);
  border-left: 4px solid var(--mi-blue-deep);
  background: var(--mi-blue-light);
  color: var(--mi-text);
  font-family: var(--mi-font);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
}
.callout-action {
  /* 一行里可能摆两颗按钮（IDE 那档：自动检测 + 去设置），
     用 flex 排而不是让 inline 空白决定间距 */
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

/* ── 报错讲解卡（M5-04）──
   和 .callout 有意区分开：callout 是主进程给的一行提示，这张卡是**成段的教学内容**，
   会比它长得多。所以用卡片（有边、有底色、有标题层级），不用左侧色条那种
   「一句话提示」的样子 —— 视觉上就告诉用户「这段值得读」。 */
.err-card {
  margin-bottom: 10px;
  padding: 11px 13px;
  border-radius: var(--mi-radius);
  border: 1px solid var(--mi-border);
  border-left: 4px solid var(--mi-blue-deep);
  background: var(--mi-card);
  color: var(--mi-text);
  font-family: var(--mi-font);
  font-size: 13px;
  line-height: 1.75;
}
.ec-tag {
  margin-bottom: 5px;
  font-size: 11px;
  color: var(--mi-text-3);
}
.ec-title {
  font-weight: 600;
  font-size: 13.5px;
}
.ec-explain {
  margin-top: 5px;
  color: var(--mi-text);
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
 * 编译告警块。
 * 刻意**不用** .err-card 那套红/蓝描边——它要传达的第一件事是
 * 「这段代码能跑」，一描成报错色，学员就以为又错了。
 * 用暖黄这条"提醒"色，和 .note 同族但更显眼（它有原文要贴）。
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
  /* 编译器原话一行可能很长，要能换行，不能撑破卡片 */
  white-space: pre-wrap;
  word-break: break-word;
}

/* ── 空白 / 运行中提示 ── */
.hint {
  font-family: var(--mi-font);
  color: var(--mi-text-3);
  text-align: center;
  padding: 14px 0;
}
.hint-main {
  font-size: 13px;
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
.dots i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--mi-blue-deep);
  animation: mi-run-bounce 1.1s infinite ease-in-out;
}
.dots i:nth-child(2) {
  animation-delay: 0.15s;
}
.dots i:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes mi-run-bounce {
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
