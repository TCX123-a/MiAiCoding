/**
 * 「这一趟用你自己装的编译器吗？」—— 确认弹窗的**状态**（全应用单例）。
 *
 * 【为什么必须是单例，而不是每个调用点挂一个弹窗组件】
 * 能发起运行的**有两个地方**：练习场（`stores/runner.ts`）和答题遮罩里的
 * `QuizCodeRun.vue`。后者**不走 runner store**（见那个文件的注释：答题要按题
 * 各自的代码跑，混用一份全局状态会串题）。于是「问一句」这件事如果各做各的，
 * 就会出现两个框叠在一起 —— 而更糟的是，将来再加第三个入口没人会记得检查。
 *
 * 所以这里放状态、App.vue 挂**唯一**一个组件、两个入口都只调 `askNativeRun()`。
 *
 * 【为什么是「共享同一个 Promise」而不是「重入就返回 false」】
 * askNativeRun 被连点、或被两个入口同时调到（练习场点运行、遮罩里也点运行）
 * 时，正确的结果是**两边都拿到用户那一个回答**，而不是「后来的一律按取消」——
 * 后者会在界面上表现为「点了运行、什么都没发生」，而用户明明点了「用我自己的」。
 * 于是这里只开一个框、只问一次、答案发给所有等着的人。
 *
 * 【为什么 Promise 要放在模块作用域，而不是 Pinia store 里】
 * 它管的不是「应用的状态」，而是「此刻有没有一个框开着」。放进 store 就得
 * 处理 store 重置、热更新之类的额外情形，而这里的语义简单到不需要那些。
 */
import { ref } from 'vue'
import { useSettingsStore } from '../stores/settings'

/** 框开着没。组件绑它（`v-model:visible` 的 visible 那半边） */
export const nativeAskVisible = ref(false)

/** 等答案的那些人。settle 为 null = 现在没有框开着 */
let settle: ((answer: NativeAskAnswer) => void) | null = null

/**
 * 问一次。返回用户选的是不是「用我自己的」。
 *
 * ⚠️ **直接关掉小窗（✕ / Esc / 点旁边）算「不用」**，而且不是「用应用自己的」那种
 * 不用，是**这一趟压根不跑**（返回 null）—— 见下面对三态的说明。
 * 调用方拿到 null 必须原样返回、什么都不做（上一次的输出要留在屏幕上）。
 */
export type NativeAskAnswer = boolean | null

let pending: Promise<NativeAskAnswer> | null = null

export function askNativeRun(): Promise<NativeAskAnswer> {
  if (pending) return pending
  nativeAskVisible.value = true
  pending = new Promise<NativeAskAnswer>((resolve) => {
    settle = resolve
  })
  return pending
}

/**
 * 用户做了选择（或者把框关掉了）。
 *
 * 【为什么关掉 = null 而不是 false】false 的意思是「这一趟用应用自己的编译器」，
 * 那是一个**会跑起来**的动作。而关掉小窗表达的是「我不想回答 / 我不想跑」——
 * 替他选任何一条都是替用户做决定；其中「跑」这一条还更重（会覆盖掉上一次的输出）。
 * 语义上最靠近的动作是「这一趟什么都不做」。
 *
 * 【为什么重复调用是安全的】组件那边 `nativeAskVisible = false` 会触发
 * MiModal 的 `update:visible(false)`，也就是再进来一次。而这里 `settle` 一取就置空，
 * 第二次调用是空操作 —— 这正是「先关框、再发答案」顺序下必须成立的性质。
 */
export function answerNativeRun(useNative: NativeAskAnswer): void {
  nativeAskVisible.value = false
  const s = settle
  settle = null
  pending = null
  s?.(useNative)
}

/**
 * 这一趟走不走原生模式 —— **两个运行入口共用这一个判断**（练习场、答题）。
 *
 * 返回 `true` = 原生、`false` = 用应用自己的、`null` = 这一趟不跑（用户关了窗）。
 *
 * 【三道读配置的闸为什么都写在函数里，而不是让调用方先自己判断】
 *   ① **开关没开时不问**：绝大多数用户永远不会打开那个开关，这条路上不该多一次
 *      await、也不该让一个弹窗组件参与进来。判断收在这里，将来再加运行入口
 *      （终端课、Git 课）就自动是对的。
 *   ② **勾过「不再提醒」时也不问**（`nativeRunQuiet`，2026-10-01 加的）：
 *      用户在弹窗里勾了「不再提醒，以后都这样」，再弹第二次就是打自己的脸。
 *      这里**直接返回 true**（用原生）——「不再提醒」记的永远是「用我自己的」
 *      那条路；「用应用自己的 + 不再提醒」在弹窗那边翻译成**把总开关关掉**
 *      （nativeRunEnabled = false，见 NativeRunConfirm.vue），会先在 ① 被拦下。
 *      ⚠️ 所以这个字段的含义是「默认走原生」，**不是**「默认走上次那个按钮」——
 *      它没有记忆"上次选了什么"的能力，两个按钮的去向也不对称。改动这条语义前
 *      先想清楚「用应用自己的 + 不再提醒」那个组合该落到哪儿。
 *   ③ **先把配置读进来再判断**：`nativeRunEnabled` / `nativeRunQuiet` 的真值都在
 *      config.json 里。如果在 store 还没加载完时读到默认值 false，就会**静默**按
 *      「不用原生」跑 —— 而用户明明开着开关。这类「读配置读早了」的窗口很窄
 *      （用户手速再快也够不到应用启动的头几毫秒），但它的表现形式是「开关有时
 *      不生效」，属于最难查的那一类，所以这里显式等一次加载（`load()` 是幂等的）。
 */
export async function decideNativeRun(): Promise<NativeAskAnswer> {
  const settings = useSettingsStore()
  if (!settings.loaded) await settings.load()
  if (settings.config.nativeRunEnabled !== true) return false
  if (settings.config.nativeRunQuiet === true) return true
  return askNativeRun()
}
