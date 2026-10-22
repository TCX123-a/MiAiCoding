import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { RUNNER } from '../../../../shared/copy'
import { sampleByKey } from '../../../../shared/samples'
import {
  CURRENT_CONFIG_VERSION,
  DEFAULT_APP_CONFIG,
  defaultPetConfig,
  emptyIdePaths,
  type PublicAppConfig,
  type RunRequest,
  type RunResult
} from '../../../../shared/types'
import { DEFAULT_LAYOUT } from '../../../../shared/layout'
import { defaultWallpaper } from '../../../../shared/wallpaper'
import { defaultSplash } from '../../../../shared/splash'
import { answerNativeRun, askNativeRun, nativeAskVisible } from '../../lib/native-confirm'
import { useRunnerStore } from '../runner'

/**
 * 运行器 store 的闸门。
 *
 * 【为什么这个 store 值得测】
 * 它管着 `running` 这个开关。开关一旦卡在 true，界面上的表现是
 * **运行按钮永远点不动、一直转圈**——用户唯一的出路是重启整个软件。
 * 而这恰恰是最容易写错的地方：主进程抛错时如果不走 finally，
 * 开关就再也回不来了。这种 bug 手工测很难碰到（要刚好触发异常），
 * 但一旦发生就是灾难级体验。
 *
 * 这里不碰真的 IPC：把 `window.miai` 换成一个可控的假货，
 * 就能精确地制造「正常返回」「抛错」「一直不返回」三种情况。
 */

function result(over: Partial<RunResult> = {}): RunResult {
  return {
    ok: true,
    phase: 'run',
    stdout: '你好',
    stderr: '',
    exitCode: 0,
    timedOut: false,
    truncated: false,
    durationMs: 12,
    ...over
  }
}

/** 一份最小的公开配置。`nativeRunEnabled` 默认取生产默认值（false） */
function publicConfig(over: Partial<PublicAppConfig> = {}): PublicAppConfig {
  return {
    version: CURRENT_CONFIG_VERSION,
    reviewEnabled: true,
    runTimeoutSec: 10,
    soundEnabled: true,
    theme: 'light',
    nativeRunEnabled: false,
    // 必填字段，照生产默认值写（理由同 settings.test.ts 里那份夹具的注释）：
    // quiet 默认 false = 「每次都问」——那几格「开关开着必须弹窗」靠它成立
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

/**
 * 装上假的 window.miai，返回被调用过的请求清单。
 *
 * ⚠️ `getConfig` 不是可有可无的装饰：`run()` 现在会先问一句「这一趟用谁跑」
 * （`decideNativeRunGuarded`），而那个判断**必须**读配置才知道开关开没开。
 * 少了它，store 里会 `Cannot read properties of undefined (reading 'getConfig')`，
 * 本文件 8 格全红 —— 而报错栈指向的是 store，看起来像 store 坏了。
 *
 * 默认 `nativeRunEnabled: false`：绝大多数用例关心的是「正常运行」这条路，
 * 而开关关着时**一次都不弹窗**，正好不打扰它们。
 */
function stubRunCode(
  impl: (req: RunRequest) => Promise<RunResult>,
  opts: { nativeRunEnabled?: boolean; nativeRunQuiet?: boolean } = {}
): RunRequest[] {
  const calls: RunRequest[] = []
  ;(globalThis as unknown as { window: unknown }).window = {
    miai: {
      runCode: (req: RunRequest) => {
        calls.push(req)
        return impl(req)
      },
      getConfig: () =>
        Promise.resolve(
          structuredClone(
            publicConfig({
              nativeRunEnabled: opts.nativeRunEnabled === true,
              nativeRunQuiet: opts.nativeRunQuiet === true
            })
          )
        ),
      saveConfig: () => Promise.resolve()
    }
  }
  return calls
}

beforeEach(() => {
  setActivePinia(createPinia())
  // 弹窗状态在**模块作用域**，一个文件里是共享的。上一格要是留下一个没答的框，
  // 下一格会从一开始就是错的（`asking` 卡住、或者拿到上一次的答案）。
  answerNativeRun(null)
  expect(nativeAskVisible.value, '复位失败：框还开着').toBe(false)
})

/**
 * 等到 store 真的进入「运行中」。
 *
 * ⚠️ 别用 `await Promise.resolve()` 数微任务代替它。`run()` 里现在有一道
 * `await decideNativeRunGuarded()`（要读配置才知道开关开没开），
 * 而 `load()` 自己还套着 `getConfig()` 的 Promise —— 链有多长是实现细节。
 * 数少了的表现是：断言跑在「还没开跑」的时刻上，于是**测试红、功能却是对的**，
 * 而且改一行 await 就可能时红时绿。
 */
async function waitRunning(s: ReturnType<typeof useRunnerStore>): Promise<void> {
  for (let i = 0; i < 100 && !s.running; i++) await Promise.resolve()
  expect(s.running, '等了很久也没进入运行中').toBe(true)
}

describe('runner store', () => {
  it('空代码不发请求（别浪费一次编译）', async () => {
    const calls = stubRunCode(async () => result())
    const s = useRunnerStore()

    await s.run()
    s.code = '   \n  '
    await s.run()

    expect(calls).toEqual([])
    expect(s.running).toBe(false)
  })

  it('正常运行：结果写进 lastResult，运行开关复位', async () => {
    const calls = stubRunCode(async () => result({ stdout: '喵' }))
    const s = useRunnerStore()
    s.setCode('python', 'print("喵")')

    await s.run()

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ lang: 'python', code: 'print("喵")' })
    expect(s.lastResult?.stdout).toBe('喵')
    expect(s.running).toBe(false)
  })

  it('运行前先清掉上一次的结果', async () => {
    // 不清的话，用户点了运行、看到屏幕上还挂着旧输出，
    // 会以为「这次已经跑完了」，然后对着旧结果找新代码的错
    let release: (() => void) | null = null
    stubRunCode(
      () =>
        new Promise<RunResult>((res) => {
          release = () => res(result({ stdout: '新结果' }))
        })
    )
    const s = useRunnerStore()
    s.setCode('python', 'print(1)')
    s.lastResult = result({ stdout: '旧结果' })

    const p = s.run()
    // 「运行期间」= 从开跑到出结果。这一格两边都要等：先等它真的开跑
    // （清空发生在那里），别在「还没开跑」的时刻上断言。
    await waitRunning(s)
    expect(s.lastResult, '运行期间不该还挂着旧结果').toBeNull()

    release!()
    await p
    expect(s.lastResult?.stdout).toBe('新结果')
  })

  it('主进程抛错时，运行开关也必须复位（否则按钮永久卡死）', async () => {
    stubRunCode(async () => {
      // 主进程对「代码超过 200KB」「入参非法」是抛错而不是返回 ok:false
      throw new Error('code too large')
    })
    const s = useRunnerStore()
    s.setCode('c', 'int main(){}')

    await s.run()

    expect(s.running, '抛错后 running 还停在 true，用户就再也点不动运行按钮了').toBe(false)
    expect(s.lastResult?.ok).toBe(false)
    expect(s.lastResult?.message).toBe(RUNNER.UNEXPECTED)
  })

  it('运行中再点一次，不会发出第二个请求', async () => {
    // 主进程是单任务队列，第二个请求只会白排队、还要等两次
    let release: (() => void) | null = null
    const calls = stubRunCode(
      () =>
        new Promise<RunResult>((res) => {
          release = () => res(result())
        })
    )
    const s = useRunnerStore()
    s.setCode('python', 'print(1)')

    const first = s.run()
    await waitRunning(s)
    await s.run() // 连点
    release!()
    await first

    expect(calls).toHaveLength(1)
  })

  it('stdin 为空时不传（传空串和传 undefined 对某些程序行为不同）', async () => {
    const calls = stubRunCode(async () => result())
    const s = useRunnerStore()
    s.setCode('python', 'x = input()')

    await s.run()
    expect(calls[0].stdin).toBeUndefined()

    s.stdin = '42'
    await s.run()
    expect(calls[1].stdin).toBe('42')
  })

  it('载入新代码时，旧输出和旧输入一起清掉', async () => {
    // 这是从课文对比块「运行试试」跳过来时最坑的一幕：
    // 只换代码不清结果的话，界面会同时显示「刚跳过来的新代码」和
    // 「上一段程序留下的输出」。用户理所当然地以为是新代码跑出来的，
    // 然后对着一个根本不存在的 bug 发懵。不发生任何报错，纯误导。
    const s = useRunnerStore()

    s.setCode('python', 'print("旧")')
    s.stdin = '21'
    s.lastResult = result({ stdout: '旧代码的输出' })

    s.setCode('c', 'int main() { return 0; }')

    expect(s.lang).toBe('c')
    expect(s.code).toBe('int main() { return 0; }')
    expect(s.lastResult, '旧输出必须清掉，不然会伪装成新代码的结果').toBeNull()
    expect(s.stdin, '上一段要输入不代表这一段要').toBe('')
  })

  /**
   * runSeq 是输出区那条小鱼的图池种子（M5-05）。
   *
   * 【为什么必须每跑一次才加一】
   * 图池要的效果是「跑一次换一张」。要是改成在渲染时取随机数，
   * 输出区每次重渲染都会换一张 —— 用户看到的不是轮换，是**图在抖**。
   * 计数器把「换图」这件事钉在「点了运行」这个动作上，和重渲染彻底脱钩。
   */
  it('每跑一次，runSeq 加一（小鱼的图池靠它换张）', async () => {
    stubRunCode(async () => result())
    const s = useRunnerStore()
    s.setCode('python', 'print(1)')

    const before = s.runSeq
    await s.run()
    expect(s.runSeq, '跑完没加，图池就永远是同一张').toBe(before + 1)
    await s.run()
    expect(s.runSeq).toBe(before + 2)
  })

  it('没跑起来的两条路都不加 runSeq（空代码、连点第二次）', async () => {
    // 白加一次的后果：用户点了运行却没跑（比如代码是空的），图却换了一张，
    // 看起来像「这次跑成功了」。计数必须和「真的跑了一次」严格一一对应。
    let release: (() => void) | null = null
    stubRunCode(
      () =>
        new Promise<RunResult>((res) => {
          release = () => res(result())
        })
    )
    const s = useRunnerStore()
    s.setCode('python', '')

    const before = s.runSeq
    await s.run()
    expect(s.runSeq, '空代码不该计数').toBe(before)

    s.code = 'print(1)'
    const first = s.run() // 故意不 await：让它停在运行中
    await waitRunning(s)
    await s.run() // 连点第二次，应当直接返回
    expect(s.runSeq, '连点第二次不该计数').toBe(before + 1)

    release!()
    await first
  })
})

/**
 * 原生模式那道弹窗，在 store 这一侧的接线（3.0 任务二）。
 *
 * 【为什么 store 也要测一遍】弹窗状态机本身在 `lib/__tests__/native-confirm.test.ts`
 * 已经逐格钉过了，这里只管**接线**：答案有没有正确地变成请求里的 `native` 字段，
 * 以及「这一趟不跑」时有没有真的什么都不做。
 *
 * 判据都在**请求本身**上（`calls`），不在界面上 —— 界面看不出来：
 * 少了 `native: true`，主进程照样用应用自己的链路跑出一个正确结果，
 * 用户点了「用我自己的编译器」，实际上跑的还是应用那套，**全程无异常**。
 */
describe('原生模式：开关与弹窗', () => {
  /** 请求里 `native` 字段的真值。没传 = undefined（「我没提过这回事」） */
  const nativeOf = (calls: RunRequest[], i = 0): boolean | undefined => calls[i]?.native

  it('开关关着：请求里**不带** native 字段（不是 false，是不带）', async () => {
    // 「不带」和「带 false」在主进程那侧是两个意思：不带 = 用户没提过这件事，
    // 带 false = 用户明确说了这趟不要原生。开关关着时属于前者。
    const calls = stubRunCode(async () => result())
    const s = useRunnerStore()
    s.setCode('python', 'print(1)')

    await s.run()

    expect(calls).toHaveLength(1)
    expect(nativeOf(calls), '开关关着却带了 native 字段 —— 那是个用户从没做过的声明').toBeUndefined()
    expect(nativeAskVisible.value, '开关关着不该弹窗').toBe(false)
  })

  it('开关开着 + 点「用我自己的」→ 带 native: true', async () => {
    const calls = stubRunCode(async () => result(), { nativeRunEnabled: true })
    const s = useRunnerStore()
    s.setCode('python', 'print(1)')

    const p = s.run()
    // 让它走到弹窗那一步（链有多长是实现细节，等状态而不是数微任务）
    for (let i = 0; i < 100 && !nativeAskVisible.value; i++) await Promise.resolve()
    expect(nativeAskVisible.value, '开关开着，点运行必须先把框弹出来').toBe(true)
    answerNativeRun(true)
    await p

    expect(nativeOf(calls)).toBe(true)
  })

  it('开关开着 + 已勾不再提醒 → **不弹窗**，直接带 native: true', async () => {
    // P3（2026-10-01）：勾过「不再提醒」之后，这条路上没有弹窗、没有悬着的
    // Promise。判据就藏在 `await s.run()` 本身里 —— 实现若还要弹窗，
    // 这一格会**永远等不到应答**、直接超时见红，而不是假绿。
    const calls = stubRunCode(async () => result(), {
      nativeRunEnabled: true,
      nativeRunQuiet: true
    })
    const s = useRunnerStore()
    s.setCode('python', 'print(1)')

    await s.run()

    expect(calls).toHaveLength(1)
    expect(nativeOf(calls), '勾过不再提醒，这一趟该直接带 native: true').toBe(true)
    expect(nativeAskVisible.value, '勾过不再提醒，运行不该再弹窗').toBe(false)
  })

  it('开关开着 + 点「用应用自己的」→ 不带 native 字段，照样跑', async () => {
    const calls = stubRunCode(async () => result({ stdout: '应用自己的输出' }), {
      nativeRunEnabled: true
    })
    const s = useRunnerStore()
    s.setCode('python', 'print(1)')

    const p = s.run()
    for (let i = 0; i < 100 && !nativeAskVisible.value; i++) await Promise.resolve()
    answerNativeRun(false)
    await p

    expect(calls, '「用应用自己的」是**要跑**的，不是取消').toHaveLength(1)
    expect(nativeOf(calls)).toBeUndefined()
    expect(s.lastResult?.stdout).toBe('应用自己的输出')
  })

  it('★ **关掉小窗 → 一个请求都不发**，而且上一次的输出原封不动', async () => {
    // 这一格守的是「问在清结果之前」那个顺序（见 store 里那段注释）。
    // 顺序反了的表现：用户关掉小窗、什么都没跑，可输出区**已经被清空了** ——
    // 屏幕上是一片空白，看起来就像「刚跑过、这次什么都没打印」。
    // 比留着旧结果更容易误解，而且全程不报错。
    const calls = stubRunCode(async () => result(), { nativeRunEnabled: true })
    const s = useRunnerStore()
    s.setCode('python', 'print(1)')
    s.lastResult = result({ stdout: '上一次的输出' })
    const seqBefore = s.runSeq

    const p = s.run()
    for (let i = 0; i < 100 && !nativeAskVisible.value; i++) await Promise.resolve()
    answerNativeRun(null)
    await p

    expect(calls, '关了窗还发请求 —— 用户明明说了「这趟不跑」').toHaveLength(0)
    expect(s.lastResult?.stdout, '不跑的一趟不该动上一次的输出').toBe('上一次的输出')
    expect(s.runSeq, '没跑就不该换图（换图 = 看起来像跑过了）').toBe(seqBefore)
    expect(s.running, 'running 必须复位，否则按钮永久卡死').toBe(false)
  })

  it('★ 弹窗开着时连点运行：**只问一次、只跑一遍**', async () => {
    // `asking` 那面旗守的就是这一幕。少了它，两次点击会各自 await 同一个答案，
    // 然后**各跑一遍** —— 界面上看不出来（第二次的结果盖掉第一次），
    // 但队列白排了一次，runSeq 也会多加一个（图池多换一张）。
    const calls = stubRunCode(async () => result(), { nativeRunEnabled: true })
    const s = useRunnerStore()
    s.setCode('python', 'print(1)')
    const seqBefore = s.runSeq

    const first = s.run()
    for (let i = 0; i < 100 && !nativeAskVisible.value; i++) await Promise.resolve()
    const second = s.run() // 框还开着的时候再点
    answerNativeRun(true)
    await Promise.all([first, second])

    expect(calls, '两次点击跑了两个请求').toHaveLength(1)
    expect(s.runSeq, '只跑了一遍，图却换了两张').toBe(seqBefore + 1)
  })

  it('前提自检：`askNativeRun` 与本文件复位用的是同一个模块实例', () => {
    // 夹具要是加载到了另一份模块（路径写法不一致之类），
    // 上面几格的 `nativeAskVisible` 永远读不到 store 里那个真实的框，
    // 于是「开关开着必须弹窗」会**假绿**。这条把它钉死。
    expect(nativeAskVisible.value).toBe(false)
    const p = askNativeRun()
    expect(nativeAskVisible.value).toBe(true)
    answerNativeRun(null)
    return p
  })
})

/**
 * 换语言：四个草稿本 + 示例自动跟随。
 *
 * 【守的是什么】
 * 2026-09-13 主人验收时踩到：选了 C 点「打印一句话」，下拉框拨到 Java
 * 直接点运行 → 应用拿 C 代码当 Java 编译，回「这段代码里没有 class」；
 * 拨到 Python 再跑 → SyntaxError。主人当然以为软件坏了。
 *
 * 修法有两条相反方向，都要钉住：
 *   ① 示例要跟得过去（漏了 = 原 bug）；
 *   ② 用户亲手写的代码绝不能被动（多跟了 = 比原 bug 更让人火大）。
 */
describe('换语言 setLang', () => {
  it('四门语言各记各的，来回切都不丢（四个草稿本）', () => {
    const s = useRunnerStore()

    s.setCode('c', 'int main() { return 0; }')
    s.setCode('java', 'class M {}')

    s.setLang('c')
    expect(s.code).toBe('int main() { return 0; }')
    s.setLang('java')
    expect(s.code, '切回来时 Java 自己那份必须还在').toBe('class M {}')
    s.setLang('python')
    expect(s.code, 'Python 没写过，就该是空的').toBe('')
  })

  it('编辑器里是没改过的示例时，换语言自动跟成同一条示例', () => {
    const s = useRunnerStore()
    const hello = sampleByKey('hello')!

    s.setCode('c', hello.byLang.c.code)
    s.setLang('java')

    expect(s.lang).toBe('java')
    expect(s.code, '不跟的话，这段 C 代码会被当 Java 编译，当场报「没有 class」').toBe(
      hello.byLang.java.code
    )
  })

  it('用户自己写的代码不会被跟随顶掉', () => {
    const s = useRunnerStore()
    const mine = 'int main() { printf("我写的"); return 0; }'

    s.setCode('c', mine)
    s.setLang('java')
    expect(s.code, 'Java 那格本来就是空的，不该被 C 的代码填空').toBe('')

    s.setLang('c')
    expect(s.code, '我写的代码必须原封不动地等着我回来').toBe(mine)
  })

  it('★ 目标语言那格有自己的草稿时，跟随不许顶掉它（2026-10-14 修）', () => {
    // 触发路：先在 Java 格里写点自己的东西 → 载入一条 C 示例 → 切到 Java。
    // 此时「编辑器里是一条一字未改的示例」，旧码无条件跟随 ⇒ Java 草稿被
    // 示例静默顶掉、四个草稿本的承诺当场破功。
    const s = useRunnerStore()
    const hello = sampleByKey('hello')!
    const mine = 'public class Main { public static void main(String[] a) { System.out.println("我写的"); } }'

    s.setCode('java', mine)
    s.setCode('c', hello.byLang.c.code)
    s.setLang('java')

    expect(s.lang).toBe('java')
    expect(s.code, 'Java 格里有用户草稿，示例必须先让位').toBe(mine)
  })

  it('目标格只是一条没改过的示例（哪怕是另一条）时，跟随照旧（防止修过头）', () => {
    const s = useRunnerStore()
    const hello = sampleByKey('hello')!
    const math = sampleByKey('math')!

    s.setCode('java', math.byLang.java.code)
    s.setCode('c', hello.byLang.c.code)
    s.setLang('java')

    expect(s.code, '机器填的示例不心疼：目标格是示例原文时跟随照旧').toBe(hello.byLang.java.code)
  })

  it('跟随时把示例需要的输入一起带过去（只带代码会卡在等输入上直到超时）', () => {
    const s = useRunnerStore()
    const input = sampleByKey('input')!

    s.setCode('python', input.byLang.python.code)
    s.setLang('java')

    expect(s.stdin, '输入没跟过去，换完语言一跑就卡住').toBe(input.byLang.java.stdin)
  })

  it('不跟随时把输入框清掉（不能留着上一门语言填的输入）', () => {
    const s = useRunnerStore()

    s.setCode('c', 'int main() { return 0; }')
    s.stdin = '21'
    s.setLang('java')

    expect(s.stdin).toBe('')
  })

  it('换语言清掉上一次的输出（否则 Python 的输出会被当成 Java 跑的）', async () => {
    stubRunCode(async () => result({ stdout: 'Python 的输出' }))
    const s = useRunnerStore()

    s.setCode('python', 'print("旧")')
    await s.run()
    expect(s.lastResult).not.toBeNull()

    s.setLang('java')
    expect(s.lastResult, '旧输出留着会让用户以为是 Java 跑出来的').toBeNull()
  })

  it('切到当前这门语言本身，什么都不动', () => {
    const s = useRunnerStore()
    s.setCode('c', 'int main() { return 0; }')
    s.lastResult = result()

    s.setLang('c')

    expect(s.code).toBe('int main() { return 0; }')
    expect(s.lastResult, '切到自己不该顺手清结果').not.toBeNull()
  })
})
