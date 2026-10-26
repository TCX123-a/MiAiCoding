<script setup lang="ts">
/**
 * 代码编辑器。基于 CodeMirror 6，做成 `v-model` 用法：
 *
 *   <CodeEditor v-model="code" lang="c" />
 *
 * 语法、配色、扩展清单、内容替换算法都在 `lib/editor-setup.ts` 里
 * （那边有单测守着），这里只干三件事：挂载、把用户敲的同步出去、把外面传的推进来。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Compartment, EditorState } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { LangOfCode } from '../../../../shared/types'
import { useSettingsStore } from '../../stores/settings'
import {
  baseEditorExtensions,
  languageExtension,
  miEditorTheme,
  miHighlightStyle,
  minimalChange
} from '../../lib/editor-setup'

const props = defineProps<{
  modelValue: string
  lang: LangOfCode
  /** 不传则用样式表里的默认高度（260px） */
  height?: string
  /** 锁住不让编辑。运行期间用它：既防止「跑的是旧代码、看到的是新代码」，也让编辑器变暗，运行状态一眼可见 */
  readonly?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [v: string]
  /**
   * 选区状态变化（P1，给 AI 侧栏的 @选区 用）。
   *
   * 【为什么由编辑器广播、而不是让侧栏来问】侧栏在应用外壳里，编辑器在这一层
   * 之下 —— 外壳问不到它。而且"有没有选区"是**用户动作的结果**，只有
   * CodeMirror 的 updateListener 当场知道。
   *
   * 只播**布尔**，不播正文：正文每次现取（见 lib/editor-selection.ts 的理由），
   * 播正文会让每动一次光标就克隆一段字符串。
   */
  'selection-change': [hasSelection: boolean]
}>()

const host = ref<HTMLDivElement>()

/**
 * 用 `shallowRef` 而不是 `ref`：EditorView 内部挂着整棵语法树和 DOM 结构，
 * 被 Vue 深度代理会拖慢每一次按键（表现为「打字有黏滞感」）。
 * 编辑器实例是「整体替换、不深改」的东西，本来也不需要深度响应。
 */
const view = shallowRef<EditorView>()

/** 语法扩展的插槽。换语言时只换这一格，编辑器本身和撤销历史都留着。 */
const langSlot = new Compartment()

/** 只读开关的插槽，同理——不重建编辑器也能切换 */
const editableSlot = new Compartment()

/**
 * 主题插槽（夜间模式）。**必须是第三个 Compartment，不能在 onMounted 里写死。**
 *
 * 【为什么非它不可】`miEditorTheme` / `miHighlightStyle` 这两个扩展一旦在
 * `onMounted` 里直接铺进去，就**再也换不掉了** —— CodeMirror 没有"改一个已装扩展"的接口。
 * 换主题的代价会变成「销毁整个 EditorView 再建一个」，而那样会连带丢掉
 * **撤销历史、光标位置、滚动位置**：用户切一下夜间模式，正在写的那半段代码
 * 撤不回去了、光标跳回开头，而界面上什么错都不报。
 *
 * 走 Compartment 就只换语法着色那两格，`doc` / `selection` / `history` 全在原地不动。
 */
const themeSlot = new Compartment()

/**
 * 主题**不做成 prop**，直接读设置 store。
 *
 * 【为什么不走 prop】`CodeEditor` 现在有两处使用（练习场的 RunnerPanel、答题页的
 * QuizCodeRun），以后还会有。走 prop 意味着每个调用点都得记得 `:theme="..."` 一次，
 * 而**漏掉的那一处不会报错** —— 它只是安静地留在浅色语法色上，表现为
 * 「别的地方都变暗了，就这一块代码还是亮的」。挂在组件自己身上，几个入口都一样。
 *
 * 【为什么 watch 的是这个 computed 而不是 `settings.config.theme`】
 * 效果一样，但 computed 让「这个组件依赖主题」这件事在代码里看得见，
 * 而不是藏在一句对全局对象的属性访问里。
 */
const settings = useSettingsStore()
const theme = computed(() => settings.config.theme)

/**
 * 「这次改动是外面推进来的，不是用户敲的」。
 *
 * 【为什么需要这个标志，而不是拿 doc 和 props 比一下】
 * 回调里比的是 `props.modelValue`，但它是**上一次渲染的快照**：
 * 父组件拿到 update 事件后要等下一个刷新周期才把新值传回来，
 * 这中间 props 还是旧的。于是「用户敲了一个字」和「外面刚推进来一段」
 * 这两种情形在回调里长得一模一样，只能靠猜。标志位把这件事说死：
 * 置位期间的所有变更一律不往回报，一个都不会漏、一个都不会多。
 */
let applyingExternal = false

/**
 * 锁住编辑要**两层一起**：
 *   `EditorState.readOnly` 管的是「命令与快捷键」，比如 Ctrl+Z 撤销；
 *   `EditorView.editable` 管的是 DOM 那层的 contenteditable。
 * 只设一个的话，可能出现「打不了字但还能按快捷键改内容」这种半吊子状态。
 */
function editableExtensions(readonly: boolean): Extension {
  return [
    EditorState.readOnly.of(readonly),
    EditorView.editable.of(!readonly)
  ]
}

/**
 * 把一段「外面的内容」推进编辑器。
 *
 * 走最小替换而不是整篇重写：整篇重写会把整个文档当成「删掉重建」，
 * 光标只要不在文档末尾，就会被甩回文首（实测数据见 minimalChange 的注释）。
 * 用户在打字途中只要撞上一次，看到的就是「光标突然跳走」。算法与理由见 minimalChange。
 *
 * 返回是否真的改了（没改就不返回 true，好让调用方知道可以跳过后续动作）。
 */
function applyExternal(next: string): boolean {
  const v = view.value
  if (!v || next === v.state.doc.toString()) return false
  const change = minimalChange(v.state.doc.toString(), next)
  // dispatch 会**同步**触发 updateListener，所以置位/复位必须夹住这一次调用。
  // 放在 try/finally 里：万一 dispatch 抛错，标志位不能卡在 true 上——
  // 那会让编辑器之后再也不会把用户的输入同步出去（比原来的 bug 更隐蔽）。
  applyingExternal = true
  try {
    v.dispatch({ changes: change })
  } finally {
    applyingExternal = false
  }
  return true
}

/** 把焦点交给编辑器。跑完代码后由外面调用（理由见 shouldRestoreFocus） */
function focus() {
  view.value?.focus()
}

/**
 * 清空全部代码，并把焦点留在编辑器里。
 *
 * 不 emit 而是直接 dispatch：dispatch 会触发 updateListener 自动把新内容
 * 同步给 v-model。手动 emit 一次的话，同一个值会被送出去两遍。
 */
function clear() {
  const v = view.value
  if (!v) return
  if (v.state.doc.length > 0) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: '' } })
  // 清完把光标放回编辑器：主人的下一个动作一定是「开始写新代码」，
  // 这时候焦点要还在别处，他敲的第一个字就丢了。
  v.focus()
}

/**
 * 第 n 行（1 起）在**视口**里的矩形（CSS px），给桌宠的报错联动用。
 * 行号不合法 / 行不在视口里 → `null`（调用方退到"输出区整体"那个兜底矩形）。
 *
 * 【为什么行不在视口里不自动滚过去】自动滚会**抢走用户的视野**：他可能正
 * 盯着下面几行改代码，报错行一出现画面就跳走 —— 而诊断卡已经把"第几行"
 * 写在屏幕上了，看与不看是他的选择。桌宠退到编辑器旁边站好即可，
 * 少一点精确、不打扰，这个交换是划算的。
 *
 * 【为什么要夹到编辑器自己的矩形里】横向滚动过、或者行尾超出可视宽度时，
 * `coordsAtPos` 给出的坐标可能在编辑器框外 —— 桌宠的落脚点会算到侧边栏
 * 甚至窗口外。夹一道，保证"在编辑器里"这个语义不破。
 */
function lineRect(n: number): { x: number; y: number; width: number; height: number } | null {
  const v = view.value
  if (!v) return null
  if (!Number.isInteger(n) || n < 1 || n > v.state.doc.lines) return null
  const coords = v.coordsAtPos(v.state.doc.line(n).from)
  if (!coords) return null
  const box = v.dom.getBoundingClientRect()
  const left = Math.max(coords.left, box.left)
  const right = Math.min(coords.right, box.right)
  return {
    x: left,
    y: coords.top,
    width: Math.max(1, right - left),
    height: Math.max(1, coords.bottom - coords.top)
  }
}

/**
 * 当前选区（1 起的行号 + 原文）。**只读，给 AI 侧栏的「@选区」用**
 * （P1，docs/27 §8.4）。
 *
 * 【为什么在这里加一个口子，而不是在侧栏里自己算】选区只有 EditorView 知道；
 * 从 DOM 的 `window.getSelection()` 反推会丢掉 CodeMirror 的换行映射与虚拟滚动，
 * 拿到的是"看起来选中的那几个字"，行号一定不对 —— 而提示词里写的正是行号。
 *
 * 【为什么是"每次现取"的函数，而不是一个响应式的 value】
 * 侧栏只在**发送的那一刻**需要它。做成响应式就得给编辑器挂 selection 监听，
 * 那是每敲一次方向键一次回调，而收益为零（没人盯着那行字看）。
 *
 * 空选区返回 `null`（不是空字符串）：调用方据此决定"这次别带选区"。
 */
function selection(): { text: string; fromLine: number; toLine: number } | null {
  const v = view.value
  if (!v) return null
  const { from, to } = v.state.selection.main
  if (from === to) return null
  const text = v.state.sliceDoc(from, to)
  if (text.trim() === '') return null
  // 行号用 doc.lineAt 求（不是数 \n）：偏移落在行首/行尾时它才是对的
  return {
    text,
    fromLine: v.state.doc.lineAt(from).number,
    toLine: v.state.doc.lineAt(to).number
  }
}

defineExpose({ focus, clear, lineRect, selection })

onMounted(() => {
  if (!host.value) return
  view.value = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        ...baseEditorExtensions((doc) => {
          // 外面推的那次不回传（详见 applyingExternal）。
          // 用户敲的照单全收：这里**故意不比 props**——props 是上一次渲染的
          // 快照，拿它做判断等于用旧地图找新路，会漏掉该同步的输入。
          // 回传后父组件把同一个值传回来时，applyExternal 会发现
          // 「和当前内容一样」直接返回，不会绕成死循环。
          if (!applyingExternal) emit('update:modelValue', doc)
        }),
        /*
         * 选区广播：只在 selectionSet 或 docChanged 时算一次布尔。
         * 不挂在普通事务上 —— 滚动/主题切换也会产生事务，那些和选区无关。
         */
        EditorView.updateListener.of((u) => {
          if (!u.selectionSet && !u.docChanged) return
          emit('selection-change', !u.state.selection.main.empty)
        }),
        langSlot.of(languageExtension(props.lang)),
        editableSlot.of(editableExtensions(props.readonly ?? false)),
        themeSlot.of([miEditorTheme(theme.value), miHighlightStyle(theme.value)])
      ]
    })
  })
})

// 外面改了内容（比如「载入示例代码」）→ 推进编辑器
watch(() => props.modelValue, (next) => applyExternal(next))

// 外面换了语言（比如下拉框切到 Python）→ 只重配语法，其余不动
watch(
  () => props.lang,
  (lang) => {
    view.value?.dispatch({ effects: langSlot.reconfigure(languageExtension(lang)) })
  }
)

// 切主题（夜间模式）→ 只换语法着色那两格，正文/撤销历史/光标都不动
watch(
  theme,
  (theme) => {
    view.value?.dispatch({
      effects: themeSlot.reconfigure([miEditorTheme(theme), miHighlightStyle(theme)])
    })
  }
)

// 锁 / 解锁编辑
watch(
  () => props.readonly,
  (ro) => {
    view.value?.dispatch({ effects: editableSlot.reconfigure(editableExtensions(ro ?? false)) })
  }
)

onBeforeUnmount(() => {
  // 必须显式销毁：EditorView 在 window 上挂了 resize / selection 等监听，
  // 不销毁的话，每次进出练习场都会多留一份，页面越用越卡。
  view.value?.destroy()
  view.value = undefined
})
</script>

<template>
  <div ref="host" class="mi-code-editor" :class="{ locked: readonly }" :style="height ? { height } : undefined" />
</template>

<style scoped>
.mi-code-editor {
  /* 默认高度，外部传 height 时被行内样式覆盖 */
  height: 260px;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  overflow: hidden;
  background: var(--mi-bg);
  /* 焦点环由编辑器内部的光标和选区表达，外层不再加一圈，免得看着像两个框 */
  transition: border-color 0.15s ease;
}
.mi-code-editor:focus-within {
  border-color: var(--mi-blue-deep);
}
/* 运行期间锁住。模糊 + 变暗是故意的：让「正在跑，先别动」这件事
   不用看文字就能感觉到，比单靠一句提示可靠得多 */
.mi-code-editor.locked {
  opacity: 0.65;
  filter: saturate(0.7);
}
.mi-code-editor.locked :deep(.cm-content) {
  cursor: progress;
}
</style>
