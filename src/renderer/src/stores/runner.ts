/**
 * 运行器 store：代码运行面板的状态与动作。
 *
 * 【为什么编译运行不在这里做】
 * 真正干活的是主进程（src/main/runner/runner.ts）：写临时文件、调 gcc/javac、
 * 超时杀进程树、解码输出。渲染层只负责「把代码递出去、把结果摆出来」。
 * 这是 Electron 的安全边界——渲染层跑不了系统命令，也不该跑。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { failedRun } from '../../../shared/run-grading'
import { followSample, findSampleOf } from '../../../shared/samples'
import { codeFingerprint } from '../../../shared/code-hash'
import type { LangOfCode, RunResult } from '../../../shared/types'
import { decideNativeRun } from '../lib/native-confirm'

export const useRunnerStore = defineStore('runner', () => {
  const lang = ref<LangOfCode>('python')

  /**
   * 四门语言**各一格**代码。
   *
   * 【为什么不是一格 —— 2026-09-13 主人验收时踩到的】
   * 只有一格时，「选中的语言」和「编辑器里的代码」可以各说各话：
   * 主人选了 Java、编辑器里还是 C 代码，点运行就拿 C 代码去当 Java 编译，
   * 回一句「这段代码里没有 class」；拨到 Python 再跑，报 SyntaxError。
   * 主人当然以为软件坏了。详见 shared/samples.ts 的 followSample。
   *
   * 【为什么每门各记各的，而不是换语言就清空】
   * 清空同样有代价：主人写了两行 C、手滑切到 Java、再切回来，代码没了。
   * 四种语言对零基础用户就是四个草稿本，各写各的才符合直觉。
   */
  const codes = ref<Record<LangOfCode, string>>({ c: '', cpp: '', java: '', python: '' })

  /** 当前语言那一格。编辑器 v-model 绑的是它，读写自动落到当前语言的格子里 */
  const code = computed({
    get: () => codes.value[lang.value],
    set: (v: string) => {
      codes.value[lang.value] = v
    }
  })

  const stdin = ref('')
  /** 正在跑。界面靠它显示「运行中」，按钮靠它防连点 */
  const running = ref(false)
  /**
   * 正在等「这一趟用谁的编译器」的答案。
   *
   * 和 `running` **必须分开**：这时候一行代码都还没跑，界面上不该显示「运行中」
   * （用户会觉得已经跑起来了、自己刚才点的那下白点了）。它唯一的作用是挡住
   * 弹窗开着时的第二次点击。
   */
  const asking = ref(false)
  const lastResult = ref<RunResult | null>(null)

  /**
   * 这是第几次运行（从 0 数）。只做一件事：给输出区那条小鱼的**图池抽签**当种子。
   *
   * 【为什么不能在图池那边调 Math.random()】
   * 输出区每次重渲染都会重新求值一次随机数，于是同一轮运行里图会不停换 ——
   * 用户看到的不是「每跑一次换一张」，是**图在抖**。
   * 计数器每轮只加一次：跑一次换一张，同一轮里纹丝不动。
   */
  const runSeq = ref(0)

  /**
   * 每门语言「载入时那份官方内容（示例/课文/题目骨架）的指纹」。它就是 own
   * 判定的基准（2026-10-06 大白饭经济）：跑/导出时拿当前代码的指纹一比 ——
   * 相等 = 一字未改的官方代码（不发奖），不等 = 用户动过（自己的作品）。
   * null = 这一格从没载过官方内容（从零自己敲的 = 当然是自己的）。
   */
  const seedFps = ref<Record<LangOfCode, string | null>>({ c: null, cpp: null, java: null, python: null })

  /**
   * 最近一次运行时快照的 own 证据（**跑前**算好，见 run()）。
   * 【为什么不在上报时现算】运行要几百毫秒到几秒，跑完再算会把"运行期间用户
   * 又敲的字"算进这一趟 —— 奖要记在**跑的那份**头上，不是上报那一刻的屏上之物。
   */
  const lastRunFp = ref<string | null>(null)
  const lastRunOwn = ref(false)

  /**
   * 编辑器里**此刻**这段代码是不是用户自己的（≠ 载入官方内容的原文）。
   * 「本地 IDE 打开 / 导出」带上它（own）：官方示例导出去不挂编译观察、
   * 跑它不发奖；用户改过一个字符指纹就变，判定自动翻面。
   */
  const currentOwn = computed(
    () => codeFingerprint(codes.value[lang.value]) !== seedFps.value[lang.value]
  )

  /**
   * 从别处载入一段代码：课文对比块的「运行试试」、练习场的示例按钮都走这里。
   *
   * 【为什么连输入框和上一次的结果一起清掉】
   * 只换代码的话，界面上会同时出现「新代码」和「上一段程序留下的输出」，
   * 用户的第一反应是「我刚贴的代码跑出来了这个」——一个纯粹的假象。
   * 输入框同理：上一段要输入，不代表这一段要；留着用户会莫名其妙，
   * 还会以为自己上次输错了。三个一起换，界面才是自洽的。
   */
  function setCode(l: LangOfCode, src: string) {
    lang.value = l
    codes.value[l] = src
    // 三个调用点（练习场示例按钮 / 课文对比块 / 对比网格）载入的都是官方内容
    // → 记下这一份的指纹当 own 基准（一字不改地跑它 = 不算用户作品）
    seedFps.value[l] = codeFingerprint(src)
    stdin.value = ''
    lastResult.value = null
  }

  /**
   * 换语言（下拉框走这里，别直接改 lang）。
   *
   * 三条规则：
   *   ① 目标语言自己那格里的代码留着，切回去还在（四个草稿本，各写各的）；
   *   ② 若编辑器里现在这条**恰好是一条一字未改的示例**，就跟到目标语言的
   *      同一条示例（连它需要的输入一起）—— 这样「换个语言看同一个例子」
   *      直接点运行就行，不必先去找示例按钮。规则细节见 followSample；
   *   ③ 但跟随**只在目标格空着、或也只是示例原文时**才落笔（2026-10-14 修）。
   *      目标格里有用户草稿 ⇒ 跟随让位，草稿留下 —— 否则「载入 C 示例 →
   *      切到 Java」这一下会把 Java 格里的手写代码静默顶掉，四个草稿本的
   *      承诺当场破功（正是规则②针对的那个坑的另一面：不许自动改用户的字）。
   *
   * 用户自己敲过的代码绝不自动替换：那种「自动改用户写的东西」比原 bug 更糟。
   */
  function setLang(next: LangOfCode) {
    if (next === lang.value) return
    const follow = followSample(lang.value, next, code.value)
    lang.value = next
    // 目标格「可落笔」= 空着，或本身就是某条示例原文（机器填的不心疼）。
    // 判据与 followSample 同源（findSampleOf 逐字节比对），不另立一套。
    const target = codes.value[next]
    const targetIsFree = target.trim() === '' || findSampleOf(next, target) !== undefined
    if (follow && targetIsFree) {
      codes.value[next] = follow.code
      // 跟过去的也是一条**一字未改**的官方示例 → 新格子同样记基准
      seedFps.value[next] = codeFingerprint(follow.code)
      stdin.value = follow.stdin
    } else {
      // 没跟随就把输入框清掉：留着上一门语言填的输入、配着另一段代码，
      // 用户会以为自己已经填过了。和 setCode 里清输入是同一个道理。
      // （跟随被目标格草稿挡下时同样清：输入框要配的是即将显示的草稿，
      //  上一门语言的输入留着只会张冠李戴。）
      stdin.value = ''
    }
    // 上一次的结果同样不作数了——留着会让用户以为
    // 「Python 的输出」是 Java 跑出来的
    lastResult.value = null
  }

  /** 清掉上一次的结果。换了语言或载入了新代码时调用，避免旧输出被当成本次结果 */
  function clearResult() {
    lastResult.value = null
  }

  /**
   * 这一趟走不走原生模式。返回 `null` = **这一趟不跑**（用户把弹窗关掉了）。
   *
   * 判断本身在 `lib/native-confirm.ts`（`decideNativeRun`）—— 答题那边
   * （`QuizCodeRun.vue`）不走这个 store，但必须做**同一个**判断。
   * 这里只多包一件事：`asking` 这面旗，用来挡住弹窗开着时的第二次点击
   * （那时 `running` 还是 false，挡不住）。
   */
  async function decideNativeRunGuarded(): Promise<boolean | null> {
    asking.value = true
    try {
      return await decideNativeRun()
    } finally {
      asking.value = false
    }
  }

  async function run() {
    // 连点两次不该排两个队：主进程是单任务队列，第二次只会白等
    if (running.value) return
    // 空代码不浪费一次编译（界面那边按钮也会置灰，这里是第二道闸）
    if (!code.value.trim()) return
    // 弹窗开着的时候再点一次运行：此时 running 还是 false（还没跑），
    // 少了这道闸，两次点击会各自 await 同一个答案、然后**各跑一遍**。
    // 界面上看不出来（第二次的结果直接盖掉第一次），但队列白排了一次。
    if (asking.value) return

    // ── 原生模式：先问「这一趟谁来跑」──
    //
    // 【为什么问在**清空结果之前**】选「不跑」（关掉小窗）时，上一次的输出必须
    // 原封不动地留在屏幕上。先清后问的话，用户会看到一个空输出区，
    // 而那看起来就像「刚跑过、这次什么都没打印」—— 比留着旧结果更容易误解。
    const useNative = await decideNativeRunGuarded()
    if (useNative === null) return

    // 先加计数再置 running：小鱼的图池靠它换张，而「运行中」那张要在
    // running 变 true 的那一刻就已经是新的一张，否则会先闪一下旧图
    runSeq.value++
    running.value = true
    // 先清空：否则「上一次的输出」会一直挂在那儿，
    // 用户点了运行、看到有输出，会以为这次已经跑完了
    lastResult.value = null

    try {
      // own 证据快照（2026-10-06）：和这次 runCode 读的是**同一刻**的 code.value ——
      // 奖记在"跑的那份"头上；跑完再算会把运行期间用户敲的字错算进来
      lastRunFp.value = codeFingerprint(code.value)
      lastRunOwn.value = lastRunFp.value !== seedFps.value[lang.value]
      lastResult.value = await window.miai.runCode({
        lang: lang.value,
        code: code.value,
        // 空字符串当成「没有输入」——有些程序会等 stdin，传个空串和传 undefined 行为不同
        stdin: stdin.value.length > 0 ? stdin.value : undefined,
        // 只有真的要原生时才带这个字段：`native: false` 也是一个明确的请求，
        // 而「不传」才是「我没提过这回事」。主进程按 `=== true` 判，两边一致。
        ...(useNative ? { native: true } : {})
      })
    } catch (e) {
      // 主进程抛错只有两种：入参不合法、代码/输入超过 200KB（被挡在门外）。
      // 渲染层分辨不出是哪种，统一兜成一条文案——总比界面什么都不显示、
      // 按钮永远停在「运行中」强。
      // 消息用英文：这是给开发者看的日志，不是面向用户的文案
      // （用户看到的是 `failedRun()` 里带的那条 RUNNER.UNEXPECTED）
      console.error('[runner] run request failed:', e)
      lastResult.value = failedRun()
    } finally {
      // 放 finally 里而不是 try 末尾：try 末尾在抛错时根本走不到，
      // 「运行中」会永远停在 true——界面上的表现是运行按钮一直转圈、
      // 再也点不动，用户唯一出路是重启软件。已由单测钉住。
      //
      // （注：其实有 catch 兜着的话，写在 try/catch 之后也能跑到。
      //   选 finally 是为了挡住后来的改动——比如有人在 try 里加个 return，
      //   或者 catch 里再抛错，那些情况下只有 finally 还管用。）
      running.value = false
    }
  }

  return {
    lang,
    code,
    codes,
    stdin,
    running,
    lastResult,
    runSeq,
    lastRunFp,
    lastRunOwn,
    currentOwn,
    setCode,
    setLang,
    clearResult,
    run
  }
})
