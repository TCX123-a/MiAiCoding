/**
 * 现场合成的七个反馈音（lib/sfx-synth.ts + `withSynthFallback`）
 *
 * 【为什么这些音需要测试】
 * 合成音的坏法**全都是听出来的，不是看出来的**：
 *   · 归一化漏了 → 叠了几个音越过 1.0 → 削顶 → 听感"爆了"，但代码不报错
 *   · 音的尾巴超出 `total` → 被切在半路上 → 每响一次都有个"咔"
 *   · 起音没做斜坡 → 从 0 直接跳到满值 → 也是一声"啪"
 *   · 加了新场合忘了写旋律 → `hasSynth` 为假 → 那个场合**永远静默**，
 *     而"没声音"和"主人没放素材"长得一模一样
 * 这几条没有一条会让人在开发时发现 —— 除非恰好竖起耳朵听。所以钉在这里。
 *
 * 【特别说清楚：这里不测"好不好听"】
 * 好不好听是主人拍板的事，机器判不了。这里管的是**物理上站不站得住**：
 * 长度对不对、有没有削顶、边界干不干净、旋律是不是真在往上走。
 */
import { describe, expect, it } from 'vitest'
import { SYNTH_PEAK, SYNTH_SPECS, hasSynth, renderSamples } from '../sfx-synth'
import { MATERIAL_ONLY, SFX_FILES, SYNTH_PREFIX, withSynthFallback, type SfxName } from '../sfx'

const NAMES = Object.keys(SYNTH_SPECS)
const SR = 44100

/** 有效段里的最大绝对值（跳过起音那几毫秒之外的全曲） */
const peakOf = (pcm: Float32Array): number => {
  let p = 0
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i] ?? 0)
    if (a > p) p = a
  }
  return p
}

describe('配方本身要自洽', () => {
  /*
   * 【这条守的是"新增场合"这件事，不是"现在这几个"】
   * 每个 `SfxName` 都必须做一次明确选择：写合成配方，或者承认自己素材专用。
   * 两者都不占的话，那个场合就是**永远静默** —— 而"没声音"和"主人还没放素材"
   * 长得一模一样，谁也不会发现。
   */
  it('**每个场合要么有旋律、要么被显式列为素材专用** —— 不许有第三种', () => {
    for (const name of Object.keys(SFX_FILES) as SfxName[]) {
      const ok = hasSynth(name) || MATERIAL_ONLY.includes(name)
      expect(ok, `场合 ${name} 既没有合成配方、也没列进 MATERIAL_ONLY —— 它会永远静音`).toBe(
        true
      )
    }
  })

  it('素材专用的那两个**确实没有配方**（列错了会被上面那条掩盖掉）', () => {
    for (const name of MATERIAL_ONLY) {
      expect(hasSynth(name), `${name} 被列为素材专用，却又写了合成配方`).toBe(false)
    }
  })

  it('**每个音的尾巴都在 total 之内** —— 超出去的那截会被切掉，听感是一个"咔"', () => {
    for (const [name, spec] of Object.entries(SYNTH_SPECS)) {
      for (const v of spec.voices) {
        expect(v.at + v.dur, `${name} 里的一个音超出了 total`).toBeLessThanOrEqual(
          spec.total + 1e-9
        )
      }
    }
  })

  it('每条旋律至少一个音，而且没有零长度的音', () => {
    for (const [name, spec] of Object.entries(SYNTH_SPECS)) {
      expect(spec.voices.length, `${name} 一个音都没有`).toBeGreaterThan(0)
      expect(spec.total).toBeGreaterThan(0)
      for (const v of spec.voices) {
        expect(v.dur, `${name} 里有个音时长为 0`).toBeGreaterThan(0)
        expect(v.decay, `${name} 里有个音衰减速率非正`).toBeGreaterThan(0)
        expect(v.gain).toBeGreaterThan(0)
        expect(v.from).toBeGreaterThan(0)
      }
    }
  })

  /*
   * 【这条是补一个真实踩过的坑，不是防患于未然】
   * `BELL`（基频 + 高八度 + 十二度）声明了、注释写着"默认音色"，
   * 但一度**没有任何配方引用它** —— 四个庆祝音于是全都在用兜底的 `[[1, 1]]`，
   * 也就是纯正弦。不报错、不静音、当时也没有任何测试看音色，
   * 症状只有"听起来比预想的电子"，而我听不见。**没有这条测试，它还会再发生一次。**
   */
  it('**每个配方都必须显式给出音色** —— 兜底那条是纯正弦，不是这里的默认', () => {
    for (const [name, spec] of Object.entries(SYNTH_SPECS)) {
      const partials = spec.partials
      expect(partials, `${name} 没写 partials，会退化成纯正弦（"嘀"一声）`).toBeDefined()
      expect(partials!.length, `${name} 的泛音少于两层，听感是电子表`).toBeGreaterThan(1)
      expect(partials!.some(([mult]) => mult === 1), `${name} 的泛音表里没有基频`).toBe(true)
    }
  })
})

describe('renderSamples：算出来的 PCM', () => {
  it('长度 = total × 采样率（换个采样率长度跟着变，时长不变）', () => {
    for (const [name, spec] of Object.entries(SYNTH_SPECS)) {
      for (const sr of [44100, 48000]) {
        const pcm = renderSamples(spec, sr)
        expect(pcm.length, `${name}@${sr}`).toBe(Math.ceil(spec.total * sr))
        // 时长是"这一段多长"，它和采样率**无关** —— 48k 的机器上不该变长
        expect(pcm.length / sr).toBeCloseTo(spec.total, 6)
      }
    }
  })

  it('**峰值正好落在 SYNTH_PEAK 上，一个采样都没越过 1.0**', () => {
    for (const [name, spec] of Object.entries(SYNTH_SPECS)) {
      const pcm = renderSamples(spec, SR)
      const peak = peakOf(pcm)
      expect(peak, `${name} 峰值不对`).toBeCloseTo(SYNTH_PEAK, 4)
      // 削顶是听得出、看不出的一类坏法：越过 1.0 之后被硬夹平，
      // 波形顶部出现一段平的 —— 听感是"炸了"
      for (let i = 0; i < pcm.length; i++) {
        expect(Math.abs(pcm[i] ?? 0)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('**一头一尾都贴在 0 上** —— 边界上跳变就是一次"咔"', () => {
    for (const [name, spec] of Object.entries(SYNTH_SPECS)) {
      const pcm = renderSamples(spec, SR)
      expect(Math.abs(pcm[0] ?? 0), `${name} 开头不在 0`).toBeLessThan(1e-3)
      expect(Math.abs(pcm[pcm.length - 1] ?? 0), `${name} 结尾不在 0`).toBeLessThan(1e-3)
    }
  })

  it('没有 NaN / Infinity（滑音的相位算错就会出这个）', () => {
    for (const [name, spec] of Object.entries(SYNTH_SPECS)) {
      const pcm = renderSamples(spec, SR)
      for (let i = 0; i < pcm.length; i++) {
        expect(Number.isFinite(pcm[i] ?? NaN), `${name} 第 ${i} 个采样不是数`).toBe(true)
      }
    }
  })

  it('空配方不炸：零个音 → 全 0，长度仍然对', () => {
    const pcm = renderSamples({ total: 0.05, voices: [] }, SR)
    expect(pcm.length).toBe(Math.ceil(0.05 * SR))
    expect(peakOf(pcm)).toBe(0)
  })
})

describe('旋律的形状：反馈音都该是"往上走"的', () => {
  /**
   * 反馈音的一条通用规律：**上行 = 好事发生了**（见 sfx-synth.ts 里那段说明）。
   * 这条不是审美偏好，是它会让"做完了"听起来像"做完了"而不是"出错了"。
   *
   * 只取 `role !== 'bass'` 的音，按开始时间排序 —— **那才是人耳听到的旋律**。
   * 伴奏音故意不跟着走（`challengeDone` 末尾那个低八度 C 就是），
   * 把它算进来会让这条断言要么测不出问题、要么冤枉一个正确的配方。
   */
  const melodyOf = (name: string): number[] =>
    [...(SYNTH_SPECS[name]?.voices ?? [])]
      .filter((v) => (v.role ?? 'melody') === 'melody')
      .sort((a, b) => a.at - b.at)
      .map((v) => v.from)

  it('完课 / 通关这三条是**严格上行**的', () => {
    for (const name of ['lessonDone', 'chapterDone', 'challengeDone']) {
      const mel = melodyOf(name)
      expect(mel.length).toBeGreaterThanOrEqual(3)
      for (let i = 1; i < mel.length; i++) {
        expect(mel[i] ?? 0, `${name} 的旋律在第 ${i} 个音掉下来了`).toBeGreaterThan(
          mel[i - 1] ?? 0
        )
      }
    }
  })

  it('`challengeDone` 的伴奏**确实比旋律低**（标了 bass 却不是低音就白标了）', () => {
    const voices = SYNTH_SPECS['challengeDone']?.voices ?? []
    const bass = voices.filter((v) => v.role === 'bass')
    const mel = voices.filter((v) => (v.role ?? 'melody') === 'melody')
    expect(bass.length).toBeGreaterThan(0)
    for (const b of bass) {
      expect(b.from).toBeLessThan(Math.min(...mel.map((v) => v.from)))
    }
  })

  it('`click` 是**平/下滑**的 —— 它响得最多，有上行调子会在连点里"唱起来"', () => {
    const v = SYNTH_SPECS['click']?.voices[0]
    expect(v).toBeDefined()
    expect(v!.to).toBeLessThanOrEqual(v!.from)
    // 而且必须短：长了会拖沓
    expect(SYNTH_SPECS['click']!.total).toBeLessThanOrEqual(0.15)
  })

  it('七段互相不一样（复制粘贴配方的翻版错误）', () => {
    const fingerprints = NAMES.map((n) => {
      const pcm = renderSamples(SYNTH_SPECS[n]!, SR)
      // 只取前 0.1 秒的粗指纹就够区分了，也比整段快
      return Array.from(pcm.slice(0, Math.floor(0.1 * SR)))
        .map((v) => v.toFixed(3))
        .join(',')
    })
    expect(new Set(fingerprints).size, '有两段合成音一模一样').toBe(NAMES.length)
  })
})

/*
 * 答对 / 答错这一对。
 *
 * 【为什么这一组测试比别的都重要】
 * 别的声音只是"好不好听"，这一对是**功能性**的：练习场里学员必须
 * **不看屏幕就能知道刚才那题做对没有**。分不开的话他不是没声音，
 * 是听到了错的信息 —— 比静音坏。
 *
 * 【为什么全是可量测的判据，而不是写一句"要好听"】
 * 我听不见（这是本次会话里反复出现的约束）。所以"清脆""低沉""鲜明区分"
 * 这三件事必须翻译成能算的数：**走向**（频率序列）、**音区**（最高/最低音）、
 * **亮度**（零交叉率）。这三条都错了的时候是能听见的，但都对的时候
 * 至少证明设计意图被落实了 —— 比"看一眼配方觉得差不多"强。
 */
describe('答对 / 答错：两条判分反馈音必须一听就分得开', () => {
  /** 按开始时间排好的旋律频率 */
  const melodyOf = (name: string): number[] =>
    [...(SYNTH_SPECS[name]?.voices ?? [])]
      .filter((v) => (v.role ?? 'melody') === 'melody')
      .sort((a, b) => a.at - b.at)
      .map((v) => v.from)

  /**
   * 零交叉率 —— 用**数数**代替我听不见的耳朵。
   *
   * 【为什么它够用】
   * 这里七个配方全是几个正弦的叠加，没有噪声。这种波形的零交叉率
   * 和它的**主频**是单调的：音越高，一秒内穿零轴越多次。
   * 它顺便把泛音成分也算进去了（泛音多 → 波形更"棱"，穿零更多），
   * 而"泛音多"正好就是"亮"的定义 —— 这两件事在这个场景里是一回事。
   */
  const zcrOf = (name: string): number => {
    const pcm = renderSamples(SYNTH_SPECS[name]!, SR)
    let crossings = 0
    for (let i = 1; i < pcm.length; i++) {
      const a = pcm[i - 1] ?? 0
      const b = pcm[i] ?? 0
      if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) crossings++
    }
    return crossings / (pcm.length / SR)
  }

  it('**答对是上扬的、答错是下沉的** —— 走向本身就是"对"和"错"的信号', () => {
    const right = melodyOf('answerRight')
    const wrong = melodyOf('answerWrong')
    expect(right.length).toBeGreaterThanOrEqual(2)
    expect(wrong.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < right.length; i++) {
      expect(right[i] ?? 0, `答对第 ${i} 个音掉下来了`).toBeGreaterThan(right[i - 1] ?? 0)
    }
    for (let i = 1; i < wrong.length; i++) {
      expect(wrong[i] ?? 0, `答错第 ${i} 个音居然往上走了`).toBeLessThan(wrong[i - 1] ?? 0)
    }
    // 音程不能小到听不出方向：小二度以下的差别在笔记本喇叭上等于没有
    expect((right[right.length - 1] ?? 1) / (right[0] ?? 1)).toBeGreaterThan(1.2)
    expect((wrong[0] ?? 1) / (wrong[wrong.length - 1] ?? 1)).toBeGreaterThan(1.1)
  })

  it('**两个音区完全不重叠** —— 答错的最高音还要低于答对的最低音', () => {
    const right = melodyOf('answerRight')
    const wrong = melodyOf('answerWrong')
    expect(Math.max(...wrong), '答错和答对挤在同一个音区里了').toBeLessThan(Math.min(...right))
  })

  it('**答对听起来比答错亮**（零交叉率差着一倍以上）', () => {
    const zr = zcrOf('answerRight')
    const zw = zcrOf('answerWrong')
    /*
     * 七个配方在 44.1kHz 下的实测零交叉率（`--reporter=verbose` 打出来的，
     * 不是估的）：
     *     answerWrong 550   |   click 1440   lessonDone 1466
     *     answerRight 1844  |   nav 1890   chapterDone 1922   challengeDone 2219
     * 两者差 3.35 倍。阈值取 2 倍是留了余量的：将来微调音高（比如把答对
     * 整体降半音）不该让这条测试红，但"两边调到一个音区去"必须红。
     *
     * ⚠️ 注意 answerRight(1844) 和 nav(1890) **几乎一样** —— 所以"亮度"
     * 这一项**区分不了这两个**，它们靠音程和时长区分（见 `sfx-synth.ts` 里的说明）。
     * 这条断言管的是答对 vs 答错，别拿它当"和 nav 分得开"的证据。
     */
    expect(zr, `答对 ${zr.toFixed(0)} vs 答错 ${zw.toFixed(0)} —— 拉不开`).toBeGreaterThan(zw * 2)
  })

  it('**答错的音色里没有第三泛音** —— "温和"是靠拿掉高频成分，不是靠调小音量', () => {
    const partials = SYNTH_SPECS['answerWrong']?.partials ?? []
    expect(partials.some(([mult]) => mult >= 3), '答错带上了刺耳的第三泛音').toBe(false)
    // 答对那一半必须**有**，否则这个断言测的就不是"两边不同"而是"两边都没有"
    const rightPartials = SYNTH_SPECS['answerRight']?.partials ?? []
    expect(rightPartials.some(([mult]) => mult >= 3)).toBe(true)
  })
})

describe('withSynthFallback：哪种场合用素材、哪种用合成', () => {
  it('**有素材的场合原样保留，一个音都不许挤掉**', () => {
    const out = withSynthFallback({
      meow: ['/a/cat-click-1.wav', '/a/cat-click-2.wav', '/a/cat-click-3.wav'],
      quack: ['/a/duck-click.wav']
    })
    expect(out.meow).toEqual(['/a/cat-click-1.wav', '/a/cat-click-2.wav', '/a/cat-click-3.wav'])
    expect(out.quack).toEqual(['/a/duck-click.wav'])
  })

  it('**没素材的场合补一个 `synth:` 地址**，而不是留空', () => {
    const out = withSynthFallback({ quack: ['/a/duck-click.wav'] })
    expect(out.click).toEqual([SYNTH_PREFIX + 'click'])
    expect(out.nav).toEqual([SYNTH_PREFIX + 'nav'])
    expect(out.lessonDone).toEqual([SYNTH_PREFIX + 'lessonDone'])
    expect(out.chapterDone).toEqual([SYNTH_PREFIX + 'chapterDone'])
    expect(out.challengeDone).toEqual([SYNTH_PREFIX + 'challengeDone'])
  })

  it('**空目录也一个都不落**（这正是主人今天的现状：只有猫叫和鸭叫）', () => {
    const out = withSynthFallback({})
    for (const name of Object.keys(SFX_FILES) as SfxName[]) {
      expect(out[name]?.length, `场合 ${name} 补完之后仍然是空的`).toBeGreaterThan(0)
    }
  })

  it('传进来是空数组也算"没素材"（不能因为键在就以为有声）', () => {
    const out = withSynthFallback({ click: [] })
    expect(out.click).toEqual([SYNTH_PREFIX + 'click'])
  })

  it('不改传进来的那个对象（调用方可能还要用）', () => {
    const input: Partial<Record<SfxName, string[]>> = { meow: ['/a/1.wav'] }
    withSynthFallback(input)
    expect(input.click).toBeUndefined()
  })
})
