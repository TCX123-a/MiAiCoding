/**
 * 「这一趟用你自己装的编译器吗」确认弹窗的状态机（lib/native-confirm.ts）
 *
 * 【这个文件在守什么】这一段逻辑的坏法**全都是静默的**，而且症状离原因很远：
 *
 *   1. **两个框叠在一起**。能发起运行的有两处（练习场 store、答题遮罩），
 *      各问各的话就会弹出两个框 —— 用户答完上面那个，下面那个还开着。
 *   2. **答案丢了**。两处同时问、而实现是「重入就返回 false」的话，
 *      后问的那一处会拿到「不用原生」，于是**用户明明点了「用我自己的」，
 *      界面上却什么都没发生**。
 *   3. **关一次窗就永远问不出来了**。`pending` 没清干净，之后每次问都拿到
 *      同一个已经 settle 的 Promise，表现为「开关开着但再也不弹窗了」。
 *   4. **读配置读早了**（`decideNativeRun` 里那句 `await load()`）。
 *      少了它，store 还没加载完时读到默认值 false，会**静默按「不用原生」跑** ——
 *      而用户明明开着开关。窗口只有几毫秒，手速再快也够不到，所以只能靠测试守。
 *
 * ⚠️ 这个模块的状态在**模块作用域**（`nativeAskVisible` / `pending`），
 * 一个测试文件里是共享的。所以每一格开始前必须把它复位，见 `resetAsk()`。
 * 不复位的话，前一格留下的「框开着」会让后一格从一开始就是错的。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  answerNativeRun,
  askNativeRun,
  decideNativeRun,
  nativeAskVisible
} from '../native-confirm'
import { useSettingsStore } from '../../stores/settings'
import { CURRENT_CONFIG_VERSION, DEFAULT_APP_CONFIG, defaultPetConfig, emptyIdePaths, type PublicAppConfig } from '../../../../shared/types'
import { DEFAULT_LAYOUT } from '../../../../shared/layout'
import { defaultWallpaper } from '../../../../shared/wallpaper'
import { defaultSplash } from '../../../../shared/splash'

function publicConfig(over: Partial<PublicAppConfig> = {}): PublicAppConfig {
  return {
    version: CURRENT_CONFIG_VERSION,
    reviewEnabled: true,
    runTimeoutSec: 10,
    soundEnabled: true,
    theme: 'light',
    nativeRunEnabled: false,
    // 必填字段，照生产默认值写（理由同 settings.test.ts 里那份夹具的注释）：
    // quiet 默认 false = 「每次都问」，写 true 会让「开关开着必须弹窗」
    // 那几格静默变成「不弹窗」，测的就不是它们要测的事了
    nativeRunQuiet: false,
    favWrongToBook: true,
    // 必填字段（v9 四键表），照生产默认值写四键全空（未配置）
    nativeIdePaths: emptyIdePaths(),
    // 必填字段（v10 壁纸块），照生产默认值写（理由同 settings.test.ts）
    wallpaper: defaultWallpaper(),
    // 必填字段（v14 开屏块），照生产默认值写 —— 「默认开、随机、静音」
    splash: defaultSplash(),
    // 必填字段（v17 桌宠块），照生产默认值写 —— 「默认开 / 462px / 右下角」
    pet: defaultPetConfig(),
    sfxVolume: 100,
    layout: { ...DEFAULT_LAYOUT },
    envCache: {},
    ai: { hasKey: false, baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', dynamicEnabled: false },
    ...over
  }
}

/** 装上假的 window.miai。`nativeRunEnabled` 决定开关状态 */
function stubMiai(cfg: PublicAppConfig = publicConfig()): void {
  ;(globalThis as unknown as { window: unknown }).window = {
    miai: {
      getConfig: () => Promise.resolve(structuredClone(cfg)),
      saveConfig: () => Promise.resolve(),
      detectEnv: () => Promise.resolve({})
    }
  }
}

/**
 * 把弹窗状态复位。
 *
 * 直接改 `pending` 是做不到的（它是模块私有的），所以走唯一的出口：
 * `answerNativeRun(null)` —— 关掉框、清掉 pending。**没开着的时候调它是空操作**，
 * 所以这行对每一格都安全。
 */
function resetAsk(): void {
  answerNativeRun(null)
  expect(nativeAskVisible.value, '复位失败：框还开着，后面的用例会从一开始就是错的').toBe(false)
}

beforeEach(() => {
  setActivePinia(createPinia())
  resetAsk()
})

/**
 * 走 `decideNativeRun()` 问一次，等框**真的弹出来**，再把「答案的 Promise」交出来。
 *
 * ⚠️ 两个坑，都是第一版踩过的（4 格全超时，而超时信息指不到原因）：
 *
 *   1. **别数微任务**。`decideNativeRun` 里可能有一次 `await load()`，
 *      `load()` 自己还套着 `getConfig()` 的 Promise —— 链有多长是实现细节。
 *      数少了的表现是「框根本没开、应答落空」，然后测试超时。所以等到**状态**变。
 *   2. ★ **返回值不能是 `Promise<Promise<…>>`**。async 函数return 一个 Promise 时，
 *      它自己的 Promise 会**接管**那个内层 Promise（thenable 会被逐层摊平）——
 *      于是 `await openAsk()` 等的是**用户点答案**，而不是「框弹出来」，
 *      直接死锁到超时。类型标注写 `Promise<Promise<T>>` 是句谎话，JS 做不到。
 *      所以用对象包一层，让摊平在对象边界上停住。
 */
async function openAsk(): Promise<{ answer: Promise<boolean | null> }> {
  const answer = decideNativeRun()
  for (let i = 0; i < 100 && !nativeAskVisible.value; i++) await Promise.resolve()
  expect(nativeAskVisible.value, '等了 100 个微任务，框还是没弹出来').toBe(true)
  return { answer }
}

// ---------------------------------------------------------------- 开关是闸门

describe('开关没开：一次都不问', () => {
  it('`decideNativeRun()` 直接返回 false，**不弹窗**', async () => {
    // 绝大多数用户永远不会打开那个开关。这条路上不该多一个弹窗、
    // 也不该让一个组件参与进来 —— 那会让「从没要求过的人」看到一个
    // 他看不懂的问题。
    stubMiai(publicConfig({ nativeRunEnabled: false }))
    expect(await decideNativeRun()).toBe(false)
    expect(nativeAskVisible.value).toBe(false)
  })

  it('★ **配置还没加载时也问对了**（读早了会静默按「不用原生」跑）', async () => {
    // 这条是冲着 `decideNativeRun` 里那句 `if (!settings.loaded) await settings.load()`
    // 来的：去掉它，store 的初值是默认配置（nativeRunEnabled: false），
    // 于是开关明明开着也返回 false —— 而且**不报错、不弹窗**，
    // 用户只会觉得「这个开关有时候不生效」。窗口只有启动后几毫秒，人工复现不了。
    stubMiai(publicConfig({ nativeRunEnabled: true }))
    expect(useSettingsStore().loaded, '前提：这一格开始时配置确实没加载过').toBe(false)

    const { answer } = await openAsk()
    answerNativeRun(false)
    expect(await answer).toBe(false)
  })
})

// ---------------------------------------------------------------- 三态

describe('开关开着：三个答案各归各位', () => {
  beforeEach(() => {
    stubMiai(publicConfig({ nativeRunEnabled: true }))
  })

  it('点「用我自己的」→ true', async () => {
    const { answer } = await openAsk()
    answerNativeRun(true)
    expect(await answer).toBe(true)
  })

  it('点「用应用自己的」→ false', async () => {
    const { answer } = await openAsk()
    answerNativeRun(false)
    expect(await answer).toBe(false)
  })

  it('★ **关掉小窗 → null**（这一趟不跑，不是「用应用自己的」）', async () => {
    // 两者必须分开：false 是「跑，但用应用自己的」，那是一个**会覆盖上次输出**
    // 的动作。关窗表达的是「我不想回答」—— 替他选任何一条都是替他做决定。
    const { answer } = await openAsk()
    answerNativeRun(null)
    expect(await answer).toBeNull()
  })
})

// ---------------------------------------------------------------- 不再提醒

describe('勾过「不再提醒」：弹窗不再出现，直接走原生', () => {
  it('开关开着 + quiet=true → 直接返回 true，**不弹窗**', async () => {
    // 2026-10-01 主人要求：「这次选择后不再提醒」。勾过之后每跑一次
    // 还弹窗就是打自己的脸。这条路上也**绝不能**留下一个悬着的 Promise ——
    // 那会让运行按钮停在「运行中」。
    stubMiai(publicConfig({ nativeRunEnabled: true, nativeRunQuiet: true }))
    expect(await decideNativeRun()).toBe(true)
    expect(nativeAskVisible.value, '勾过不再提醒却还是弹窗了').toBe(false)
  })

  it('开关关着 + quiet=true → 仍然一次都不问（enabled 是总闸，先被拦）', async () => {
    // 「用应用自己的 + 不再提醒」在弹窗那边落成的是 enabled=false，
    // quiet 不跟着置位（见 NativeRunConfirm.vue 的 choose）。但万一将来
    // 有人把两个字段都置上，总闸必须仍先起作用：返回 false（用应用自己的），
    // 而不是 true（那会把用户送进他从没开着的原生模式）。
    stubMiai(publicConfig({ nativeRunEnabled: false, nativeRunQuiet: true }))
    expect(await decideNativeRun()).toBe(false)
    expect(nativeAskVisible.value).toBe(false)
  })

  it('quiet=false（默认）→ 照旧弹窗（回归：默认这条必须走 ask）', async () => {
    // 少了这条，一个「看见 quiet 字段存在就静默」的实现也能骗过上面两格。
    stubMiai(publicConfig({ nativeRunEnabled: true, nativeRunQuiet: false }))
    const { answer } = await openAsk()
    answerNativeRun(true)
    expect(await answer).toBe(true)
  })
})

// ---------------------------------------------------------------- 单例

describe('全应用只有一个框：重入共享同一个答案', () => {
  beforeEach(() => {
    stubMiai(publicConfig({ nativeRunEnabled: true }))
  })

  it('★ 同时问两次 → 只开一个框，两个调用拿到**同一个**答案', async () => {
    // 这是本文件最要紧的一格。用户点了练习场的运行、又在答题遮罩里点了运行
    // （或者只是连点了两下），正确行为是「问一次、答案发给所有等着的人」。
    // 写成「重入就返回 false」的话，后问的那一处会拿到 false ——
    // 界面上表现为「用户点了『用我自己的』，却什么都没跑」。
    const a = askNativeRun()
    const b = askNativeRun()
    expect(nativeAskVisible.value).toBe(true)

    answerNativeRun(true)
    expect(await a).toBe(true)
    expect(await b, '重入的那一次没拿到同一个答案 —— 它要么被当成「用应用自己的」，要么被丢掉').toBe(true)
  })

  it('★ 连问两次之后关窗 → **两个**都拿到 null（不能只喂饱一个）', async () => {
    const a = askNativeRun()
    const b = askNativeRun()
    answerNativeRun(null)
    expect(await a).toBeNull()
    expect(await b).toBeNull()
  })

  it('★ 重复应答是安全的（组件那条 `update:visible(false)` 会再进来一次）', async () => {
    // `answerNativeRun` 第一件事是把 `nativeAskVisible` 置回 false，
    // 而这个赋值会触发 MiModal 的 `update:visible(false)` → 组件再调一次
    // `answerNativeRun(null)`。取走的 `settle` 一置空，第二次就是空操作。
    // 少了这条性质，第二次应答会**覆盖掉第一次的答案**：用户点「用我自己的」，
    // 结果被紧随其后的 null 顶掉 —— 又一例「点了没反应」。
    const p = askNativeRun()
    answerNativeRun(true)
    answerNativeRun(null) // 组件那条回声
    answerNativeRun(true) // 再来一次也无妨
    expect(await p).toBe(true)
  })

  it('★ 关窗之后**还能再问**（pending 清干净了，不是一次性开关）', async () => {
    // 这条守的是「开关开着却再也不弹窗」。第一格关窗时若只置了 visible、
    // 没清 pending，第二次 ask 会**直接返回那个已经 settle 的 Promise**，
    // 于是框永远不再出现，而运行会拿到上一次的旧答案 —— 全静默。
    const first = askNativeRun()
    answerNativeRun(null)
    expect(await first).toBeNull()
    expect(nativeAskVisible.value).toBe(false)

    const second = askNativeRun()
    expect(nativeAskVisible.value, '第二次问的时候框必须重新弹出来').toBe(true)
    answerNativeRun(true)
    expect(await second).toBe(true)
  })

  it('复位之后状态干净：visible 为假、也没有残留的应答者', async () => {
    resetAsk()
    expect(nativeAskVisible.value).toBe(false)
    // 再问一次必须是**新的**框（而不是回到上一次那个已结算的 Promise）
    const p = askNativeRun()
    expect(nativeAskVisible.value).toBe(true)
    answerNativeRun(false)
    expect(await p).toBe(false)
  })
})

// ---------------------------------------------------------------- 前提自检

describe('前提自检：夹具本身别是假的', () => {
  it('这份 publicConfig 的默认值就是生产默认值（false）', () => {
    // 夹具里的取值写死 true 的话，上面「开关没开」那一组会**测到别的东西**。
    expect(publicConfig().nativeRunEnabled).toBe(DEFAULT_APP_CONFIG.nativeRunEnabled)
    expect(DEFAULT_APP_CONFIG.nativeRunEnabled).toBe(false)
    // 同一条：quiet 夹具写死 true 的话，「开关开着必须弹窗」会静默变成
    // 「不弹窗」——那几格测的就不是它们要测的事了
    expect(publicConfig().nativeRunQuiet).toBe(DEFAULT_APP_CONFIG.nativeRunQuiet)
    expect(DEFAULT_APP_CONFIG.nativeRunQuiet).toBe(false)
  })
})
