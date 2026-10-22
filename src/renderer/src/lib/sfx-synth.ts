/**
 * 音效的**现场合成**部分 —— 没有素材文件的那些场合由它出声。
 *
 * 【为什么又要有合成了】
 * 一版历史：先是我合成（被否，"太电子太玩具"）→ 改由主人自备素材 →
 * 主人给了猫叫和鸭叫，但**点击 / 换页 / 完课这些不打算再找素材了**，
 * 于是回到合成。这次的分工是明确的：**能听出"是什么动物"的用素材，
 * 听不出物种的反馈音用合成**——后者本来就该是"一声轻响"，
 * 合成的电子味在这里不是缺点，反而比随便找一段音效更整齐。
 *
 * 【为什么和 `sfx.ts` 分家】
 * 本模块**不 import 任何东西、不碰 `AudioContext`、不碰 `window`** ——
 * 它只做一件事：给一段参数，算出一串 PCM 采样。于是它能在纯 node 环境下
 * 被单测直接跑，"这个音多长、峰值多少、有没有削顶"都能钉住。
 * 真正把 PCM 包成 `AudioBuffer` 的那一步在 `sfx.ts` 里（那一步非得有音频环境）。
 *
 * 【为什么不用 `OscillatorNode` 现场搭】
 * 那样每个音要建好几个节点、还要自己排时间表，而**播放路径会和素材那一套分叉**：
 * 素材走 `AudioBufferSourceNode`、合成走振荡器，于是节流、增益、随机抽签
 * 都得写两遍。算成 PCM 再包成 `AudioBuffer`，下游**一个字都不用改** ——
 * `playSfx` 根本不知道手里这个是文件解出来的还是算出来的。
 */

/**
 * 一个"音"。七个场合都由若干个音前后叠出来。
 *
 * 【为什么用"音"而不是直接写波形】
 * 写波形（比如"前 20ms 上坡、然后衰减"）能把音做得很自由，但**改不动**：
 * 想把「完课」的调子升高一点，得重新推一遍时间。拆成音之后，
 * 每个音只回答四个问题（什么频率、什么时候起、多长、多响），
 * 调旋律就是改数字。
 */
export interface SynthVoice {
  /** 起始频率（Hz） */
  from: number
  /** 结束频率（Hz）。和 `from` 相等就是平音；不相等就是一个短滑音 */
  to: number
  /** 从整段音频的第几秒开始响 */
  at: number
  /** 这个音多长（秒），含衰减尾巴 */
  dur: number
  /** 衰减快慢（1/秒）。越大越"点一下就没了"，越小越"余音绕梁" */
  decay: number
  /** 这个音自己的响度。用于让旋律里的某个音突出或让伴奏垫在后面 */
  gain: number
  /**
   * 这个音是**旋律**还是**伴奏**。省掉就是旋律。
   *
   * 【为什么要标出来，而不是让听的人自己分】
   * 伴奏音（`challengeDone` 末尾垫的那个低八度 C）**故意不跟着旋律往上走** ——
   * 它在那儿是为了让最后那声高音不"发飘"。但单测那条"旋律必须上行"
   * 分不清"旋律掉下来了"和"这是伴奏"，只能把伴奏也当旋律判，
   * 于是**要么放宽到测不出问题、要么冤枉一个正确的配方**。
   * 标出来之后，那条断言测的就是它真正想测的东西：**旋律本身**。
   */
  role?: 'melody' | 'bass'
}

/**
 * 一个场合的完整配方。
 *
 * `partials` 是音色：正弦波听起来像纯电子音，加两个泛音就软一些。
 * 每一项是 `[倍频, 权重]` —— `[1, 1]` 是基频，`[2, 0.35]` 是高八度。
 */
export interface SynthSpec {
  /** 整段多长（秒）。**必须不短于所有音的 `at + dur`**，否则尾巴被切掉 */
  total: number
  voices: readonly SynthVoice[]
  /** 泛音表。省掉就是纯正弦 */
  partials?: readonly (readonly [number, number])[]
}

/**
 * 默认音色：基频 + 高八度 + 十二度。听得出来是个"音"而不是"嘀"。
 *
 * ⚠️ 【它曾经是个死常量 —— 别让它再变回去】
 * 2026-09-15 发现：这个常量声明了、注释写着"默认音色"，但**五份配方里一份都没引用它**，
 * 于是 `click` 之外的四个音全都在用 `renderSamples` 的兜底 `[[1, 1]]`，
 * 也就是**纯正弦**——正是本文件开头嫌弃的那个"嘀"。
 *
 * 这种坏法不报错、不静音、单测全绿（当时没有任何一条测试看音色），
 * 唯一的症状是"听起来比预想的电子"，而我在开发时**听不见**，
 * 极容易把它归成口味问题放过。是写文档、去核对"泛音列到底写的是什么"时才撞见的。
 *
 * 现在靠 `sfx-synth.test.ts` 那条"每个配方都必须显式给出音色"盯着。
 */
const BELL: readonly (readonly [number, number])[] = [
  [1, 1],
  [2, 0.35],
  [3, 0.12]
]

/**
 * 闷一点的音色：只有基频和高八度，**故意不要第三泛音**。
 *
 * 亮 = 好事发生了，这是本模块从头到尾在和声语言上的约定（见下面 `SYNTH_SPECS`
 * 那段）。答错不是好事，所以它拿不到那个「被敲了一下的金属条」的高频成分 ——
 * 「温和」不是靠调小音量做出来的（调小了只是"听不见"，不是"温和"），
 * 是靠**把高频成分拿掉**。
 */
const SOFT: readonly (readonly [number, number])[] = [
  [1, 1],
  [2, 0.22]
]

/**
 * 音名 → 频率（十二平均律，以 A4 = 440Hz 为基准）。
 *
 * ⚠️ **这里踩过一次，写下来免得再踩**：八度号是**音名自己的八度**，
 * 不是"A 往上数几个半音"。第一版写成 `A(5, 12)` 当 A5 用 ——
 * 按前一种算法 5 是相对 A4 的偏移，于是它算出来是 **1760Hz（A6）**，
 * 整套音高**整整高了一个八度**，`challengeDone` 冲到了 2634Hz。
 * 音高错了**一点都不会报错**，只是听感"尖得刺耳"，
 * 而"这个音是不是太尖"在开发时极容易被归成"口味问题"放过。
 * 是单测里那条"旋律必须往上走"的断言把它揪出来的 —— 一个低音垫音
 * 意外排到了最高音后面，才暴露出那些"低音"其实并不低。
 *
 * 用音名而不是直接写数字，是为了让改旋律的人一眼看出调子，
 * 但**八度号必须是科学音高记号**（C4 = 261.63、A4 = 440、C5 = 523.25）。
 */
const NOTE_ORDER = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function note(octave: number, name: string): number {
  const i = NOTE_ORDER.indexOf(name)
  // `i - 9`：A 在数组里是第 9 个，而 A4 = 440 是基准，所以 A 的偏移必须是 0
  return 440 * Math.pow(2, octave - 4 + (i - 9) / 12)
}

const C4 = note(4, 'C') // 261.63 —— 低音区，答错那一对住在这儿
const E4 = note(4, 'E') // 329.63
const C5 = note(5, 'C') // 523.25
const E5 = note(5, 'E') // 659.26
const G5 = note(5, 'G') // 783.99
const A5 = note(5, 'A') // 880.00
const B5 = note(5, 'B') // 987.77
const C6 = note(6, 'C') // 1046.50
const E6 = note(6, 'E') // 1318.51

/**
 * 七个场合的配方。
 *
 * 【为什么每个都要"往上走"】
 * 反馈音的一个通用规律：**上行的音 = 好事发生了**。点击和换页也是上行
 * （哪怕只有两个音），因为那两件事的语义都是"又前进了一点"。
 * 真正的中性音（平音）只有一个 `click` —— 它响得最频繁，
 * 有旋律反而会在连点时变成噪音。
 *
 * 【为什么 `click` 刻意做得又短又轻】
 * 它是全界面响得最多的一个：点按钮、点开关、点行内小控件都是它。
 * 长了会拖沓，响了会烦人，有调子会"唱起来"。所以是 90 毫秒一个软软的下滑音，
 * 音量也压到最低 —— 它的正确感受是"手感"，不是"音效"。
 */
export const SYNTH_SPECS: Record<string, SynthSpec> = {
  /** 普通点击：一声很短的下滑，像爪子轻轻碰了一下 */
  click: {
    total: 0.1,
    voices: [{ from: A5, to: A5 * 0.82, at: 0, dur: 0.09, decay: 42, gain: 0.5 }],
    partials: [
      [1, 1],
      [2, 0.18]
    ]
  },

  /** 换页：两个音向上，比 click 多一点点"翻过去了"的意思 */
  nav: {
    total: 0.2,
    voices: [
      { from: G5, to: G5, at: 0, dur: 0.11, decay: 34, gain: 0.5 },
      { from: C6, to: C6, at: 0.055, dur: 0.14, decay: 30, gain: 0.42 }
    ],
    partials: BELL
  },

  /**
   * **答对**：一个上行的纯五度，两个音都在高音区，脆。
   *
   * 【为什么它必须和 `nav` 分得开】
   * 这个音会在练习场里**每答对一题响一次**，而 `nav` 是换页音 ——
   * 两个都是"两声短的上行"，混起来的话学员分不出"我做对了"还是"界面翻页了"。
   * 分开靠两件事（**不是靠音高** —— 两者音区本来就重叠，
   * `nav` 是 G5→C6，这里是 E5→B5，都在高音区）：
   *   · **音程大得多**（纯五度 vs 四度）：一耳朵就是"跳上去了"而不是"嗒嗒"
   *   · **长得多**（0.36s vs 0.2s，尾音衰减也慢一半）：`nav` 是"点两下"，
   *     这个是"叮——"
   *
   * ⚠️ 这一条**不能靠读代码验证**（我听不见）。所以 `sfx-synth.test.ts` 里
   * 有一组断言盯着它：上行、音区、亮度三项都得和答错那一半拉开。
   */
  answerRight: {
    total: 0.36,
    voices: [
      { from: E5, to: E5, at: 0, dur: 0.22, decay: 24, gain: 0.46 },
      { from: B5, to: B5, at: 0.07, dur: 0.29, decay: 15, gain: 0.5 }
    ],
    partials: BELL
  },

  /**
   * **答错**：一个下行的三度，两个音都在低音区，闷。
   *
   * 【为什么是"往下走"，而且必须比答对低一整段】
   * 设计规范里对答错的要求是"温和、不责备"（`docs/04` §8 那张表）。
   * 音乐上表达"不对"有两种做法：**不协和**（小二度、增四度）和**往下掉**。
   * 前者刺耳 —— 而"刺耳"和"责备"是一回事，正是要避免的。所以选往下掉。
   *
   * 音区选在 C4~E4（261~330Hz）而不是往下探到 C3：太低会闷成一坨"嗡"，
   * 在笔记本喇叭上干脆听不见。答对那一半在 E5~B5，两边**差着两个八度**，
   * 所以"对了还是错了"根本不用等听清旋律，第一个音就知道了。
   */
  answerWrong: {
    total: 0.5,
    voices: [
      { from: E4, to: E4, at: 0, dur: 0.3, decay: 13, gain: 0.46 },
      { from: C4, to: C4, at: 0.1, dur: 0.4, decay: 9, gain: 0.5 }
    ],
    partials: SOFT
  },

  /** 学完一课：大三和弦上行三个音。不吵，但是"做完了" */
  lessonDone: {
    total: 0.62,
    voices: [
      { from: C5, to: C5, at: 0, dur: 0.4, decay: 11, gain: 0.5 },
      { from: E5, to: E5, at: 0.085, dur: 0.44, decay: 11, gain: 0.5 },
      { from: G5, to: G5, at: 0.17, dur: 0.45, decay: 10, gain: 0.52 }
    ],
    partials: BELL
  },

  /** 做完一章：同一条旋律再往上顶一个八度，尾巴更长 */
  chapterDone: {
    total: 0.95,
    voices: [
      { from: C5, to: C5, at: 0, dur: 0.55, decay: 8, gain: 0.46 },
      { from: E5, to: E5, at: 0.08, dur: 0.6, decay: 8, gain: 0.46 },
      { from: G5, to: G5, at: 0.16, dur: 0.62, decay: 7.5, gain: 0.48 },
      { from: C6, to: C6, at: 0.24, dur: 0.7, decay: 6.5, gain: 0.5 }
    ],
    partials: BELL
  },

  /** 每日挑战完成：五个音冲上去，收在一个高音上 —— 最"值得"的一个 */
  challengeDone: {
    total: 1.25,
    voices: [
      { from: C5, to: C5, at: 0, dur: 0.6, decay: 7, gain: 0.44 },
      { from: E5, to: E5, at: 0.08, dur: 0.65, decay: 7, gain: 0.44 },
      { from: G5, to: G5, at: 0.16, dur: 0.7, decay: 6.5, gain: 0.46 },
      { from: C6, to: C6, at: 0.24, dur: 0.75, decay: 6, gain: 0.48 },
      { from: E6, to: E6, at: 0.32, dur: 0.9, decay: 4.5, gain: 0.5 },
      // 底下垫一个低音，让最后那声不那么"尖"
      { from: C5 / 2, to: C5 / 2, at: 0.32, dur: 0.9, decay: 4, gain: 0.34, role: 'bass' }
    ],
    partials: BELL
  }
}

/** 合成完统一归一到的峰值。留足余量，五段之间响度也一致 */
export const SYNTH_PEAK = 0.55

/** 起音时长（秒）。直接从 0 跳到满值会"啪"一声，这是消掉它的唯一目的 */
const ATTACK_SEC = 0.006

/**
 * 把一份配方算成 PCM 采样。
 *
 * 返回 **单声道**，取值 `-1 ~ 1`。采样率由调用方给（用音频上下文那个），
 * 本函数不假设 44.1k —— 主人的素材里就有 48k 的，两种都要能对上。
 *
 * 【返回类型为什么要写成 `Float32Array<ArrayBuffer>` 这个啰嗦样子】
 * 不写的话它就是默认的 `Float32Array<ArrayBufferLike>`，而那个"Like"
 * 把 `SharedArrayBuffer` 也算进去了。`AudioBuffer.copyToChannel` 只收
 * 前一种 —— 于是 `typecheck` 会在**完全正确的代码**上红一条，报的还是
 * 「SharedArrayBuffer 不能赋给 ArrayBuffer」这种看着像玄学的话。
 * 这里写成具体的那个，等于把"它一定是 `new` 出来的、底子是真 ArrayBuffer"
 * 这个事实说给类型系统听。**别顺手简化掉。**
 *
 * @param spec 配方
 * @param sampleRate 采样率（Hz）
 */
export function renderSamples(spec: SynthSpec, sampleRate: number): Float32Array<ArrayBuffer> {
  const n = Math.max(1, Math.ceil(spec.total * sampleRate))
  const out = new Float32Array(n)
  const partials = spec.partials ?? [[1, 1] as const]

  for (const v of spec.voices) {
    const start = Math.floor(v.at * sampleRate)
    const len = Math.floor(v.dur * sampleRate)
    if (len <= 0) continue
    const attack = Math.min(ATTACK_SEC, len / sampleRate / 2)
    // 尾巴的 12% 拉一个线性淡出。只靠指数衰减的话，它在 buffer 末尾还没到 0，
    // 播完那一下就是一次**突变到静音** —— 听感上是一个"咔"。
    const fadeFrom = Math.floor(len * 0.88)

    for (let i = 0; i < len; i++) {
      const idx = start + i
      if (idx >= n) break
      const t = i / sampleRate
      const u = i / len

      /*
       * 频率线性滑动时，相位是**频率的积分**，不能直接写 `sin(2π f(t) t)`。
       * 那种写法在 `from === to` 时是对的（退化成普通的 `sin(2πft)`），
       * 一旦滑动就错 —— 而且错得不难听，只是音高拐得和算的不一样，很难发现。
       * 线性调频的积分是 f0·t + (f1-f0)·t²/(2T)，就是下面这行。
       */
      const f0 = v.from
      const f1 = v.to
      const phase = 2 * Math.PI * (f0 * t + ((f1 - f0) * t * u) / 2)

      let wave = 0
      for (const [mult, weight] of partials) wave += weight * Math.sin(phase * mult)

      let env: number
      if (t < attack) env = t / attack
      else env = Math.exp(-(t - attack) * v.decay)
      if (i > fadeFrom) env *= 1 - (i - fadeFrom) / (len - fadeFrom)

      out[idx] += wave * env * v.gain
    }
  }

  // 归一：多音叠起来很容易越过 1.0，而削顶是**听得出**的（"爆了"），
  // 且它不报错。统一缩到 SYNTH_PEAK，五段的响度也顺带对齐了。
  let peak = 0
  for (let i = 0; i < n; i++) {
    const a = Math.abs(out[i] ?? 0)
    if (a > peak) peak = a
  }
  if (peak > 0) {
    const k = SYNTH_PEAK / peak
    for (let i = 0; i < n; i++) out[i] = (out[i] ?? 0) * k
  }
  return out
}

/**
 * 这个场合有没有配方。
 *
 * 存在的意义是让 `sfx.ts` **问一句再动手** —— 没有配方的场合（将来加了新场合
 * 但忘了写旋律）应当退回静默，而不是合成一段空 buffer 出来假装有声。
 */
export function hasSynth(name: string): boolean {
  return name in SYNTH_SPECS
}
