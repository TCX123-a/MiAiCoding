/**
 * 音效播放器 —— **有的场合放素材、有的场合现场合成，本模块负责把两者接上并放出声**。
 *
 * 【为什么是两条来源，而不是一条】
 * 主人给了猫叫和鸭叫的素材（那两种音的"像不像"很重要，合成不出来），
 * 但点击 / 换页 / 完课这些**不打算再找素材了** —— 它们本来就该是"一声轻响"，
 * 没有物种要去模仿。于是：**素材优先，缺的场合由 `sfx-synth.ts` 现场算一段 PCM 补上**。
 *
 * 【两条来源在哪儿合流 —— 这是本模块最要紧的一处设计】
 * 合成出来的 PCM 会被包成 `AudioBuffer`，**塞进和素材同一张 `buffers` 表**，
 * 用一个 `synth:` 开头的假地址当键。于是 `playSfx` **一个字都不用改** ——
 * 它根本不知道手里这个是文件解出来的还是算出来的，节流、增益、随机抽签
 * 这一整套也就不必写两遍（写两遍必然漂移，而漂移了不报错）。
 *
 * 【文件不在就静默不响】这条没有变，仍然是本模块对素材的态度。
 * 变的是"哪儿算缺"：素材没覆盖、合成也没配方的场合，才真的静默。
 *
 * 【为什么不直接用 `<audio>` 标签】
 * 三个理由，缺一个都能忍，凑齐了就不行：
 *   1. **延迟**。`new Audio(url)` 每次播放要重新走一遍解码/寻址，
 *      点击音效对这种延迟最敏感（听起来像"点完过一会儿才响"）。
 *      `AudioBufferSourceNode` 是内存里的 PCM，`start()` 那一瞬就出声。
 *   2. **不能叠加**。同一个 `HTMLAudioElement` 连续播两次，第二次会**打断**第一次
 *      （`currentTime = 0`）。用户连点两下猫咪，听到的是一声半。
 *      `AudioBufferSourceNode` 是一次性的，各播各的，天然能叠。
 *   3. **音量**。总线上一句 `GainNode` 就能统一调，`<audio>` 得逐个元素设。
 *
 * 【可测性 —— 这是本文件不 import 任何音频的原因】
 * 音源（glob 扫出来的地址）由 `setSfxSources()` **从外面注入**，本模块自己不碰文件系统、
 * 不 import 资源。于是它在纯 node 环境下**能 import 且不炸**，表结构和查找规则
 * 都能被单测直接钉住。真正碰 `window`/`AudioContext` 的只有 `playSfx` 内部那几行，
 * 而且都被 `typeof window` 守着 —— 没有音频环境时**静默返回，不抛错**。
 *
 * 【CSP 提示】
 * 音效素材走站内地址：CSP 的 `media-src` 是 `'self' miai-wall:`（P3 起显式写出，
 * 只为放行壁纸通道；`'self'` 与原先回退 `default-src 'self'` 时口径一致）。
 * 所以同源音频（Vite 给的站内地址）照旧放行，而 `blob:` / `data:` 会被拦。
 * 这也是"必须放文件、不能内联 base64"的技术原因之一。
 */
import { clampVolume, MAX_SFX_VOLUME } from '../../../shared/config-migrate'
import { SYNTH_SPECS, hasSynth, renderSamples } from './sfx-synth'

/**
 * **只用素材、不写合成配方**的场合。
 *
 * 判据是"这个音要不要像某种动物"：猫叫和鸭叫得真像猫和鸭，合成做不出来；
 * 其余七个是"一声轻响"，本来就该由代码定，找素材反而更费事。
 *
 * 【为什么要显式列出来，而不是靠"没配方就是素材专用"推出来】
 * 那样推的话，"加了新场合却忘了给它声音"和"这个场合故意用素材"会**长得一模一样** ——
 * 而前者的表现是**那个场合永远静默**，不报错、不留痕。列出来之后，
 * 新增一个 `SfxName` 就必须做一次明确选择：要么写配方，要么承认它是素材专用。
 * 单测（`sfx-synth.test.ts`）钉着这条，漏选会变红。
 */
export const MATERIAL_ONLY: readonly SfxName[] = ['meow', 'quack']

/**
 * 现场合成的音在 `buffers` 表里的地址前缀。
 *
 * 用一个**假的 URL** 当键，是为了让合成音和素材音在表里长得一样（见文件头那段）。
 * `synth:` 这个前缀不可能和 Vite 给出的真地址撞上 —— 那些不是 `/` 开头就是
 * `http(s)://` 开头。
 */
export const SYNTH_PREFIX = 'synth:'

/** 九种「场合」。名字说的是**什么时候响**，不是「什么声音」——换素材不该改调用点。 */
export type SfxName =
  /** 普通点击（按钮、开关、行内小控件） */
  | 'click'
  /** 切换课程 / 换页 / 换语言 —— 比 click 稍微有点「翻过去了」的意思 */
  | 'nav'
  /** 点猫咪贴图 */
  | 'meow'
  /** 点大肥鱼立绘 */
  | 'quack'
  /** 练习判分：**答对**了一题 */
  | 'answerRight'
  /** 练习判分：**答错**了一题 */
  | 'answerWrong'
  /** 学完一课 */
  | 'lessonDone'
  /** 做完一章练习 */
  | 'chapterDone'
  /** 完成每日挑战 */
  | 'challengeDone'

/**
 * 每种场合去 `assets/sounds/` 里找哪些**文件名主干**（不带扩展名）。
 *
 * 【为什么写主干而不是完整文件名】
 * 这样主人给 `.mp3` / `.ogg` / `.wav` / `.m4a` 都能用，见 `SOUND_EXT_PRIORITY`。
 * 他导出的格式取决于手上工具，不该反过来要求他转格式。
 *
 * 【为什么是**数组**，而不是一个主干】
 * 因为「点猫咪」主人给了**三段**猫叫（`小猫1/2/3.wav`），要**每次随机抽一段** ——
 * 同一只猫连叫两声不该是一模一样的。一个场合一条主干的话，这个需求无处安放。
 * 只给一段的场合就写一个元素的数组，写成数组不是"为将来预留"，
 * 是**同一个字段今天是两种用法**（单文件 / 多文件随机），类型必须容得下两者。
 *
 * 【多个主干之间的先后就是"抽签池"的内容，不是优先级】
 * 优先级只在**同一个主干的不同扩展名**之间生效（见 `SOUND_EXT_PRIORITY`）。
 * `cat-click-1` 和 `cat-click-2` 是两个不同的音，两个都进池子。
 *
 * 【现在只有两个是"必须有素材"的】
 * `cat-click-*`（点猫咪）和 `duck-click`（点大肥鱼）—— 这两个要**像某种动物**，
 * 合成不出来，主人给了素材。**其余七个一律由 `sfx-synth.ts` 现场合成**，
 * 所以它们**不再有"静默"这个状态**：没素材也有声音。
 *
 * ⚠️ `answer-right` / `answer-wrong` 两条主干**今天是空的**（目录里没这两个文件），
 * 写出来是为了让"将来主人想换成素材"有个名字可以用 —— 代码一个字都不用改。
 * 别看到名字就以为盘上该有这两个文件。
 *
 * 想让某个场合改用素材，把文件按主干名丢进 `assets/sounds/` 即可，
 * 素材会自动把合成音挤掉（见 `setSfxSources`）—— 代码一个字都不用改。
 * 所以这份表同时也是"能放些什么"的清单。
 */
export const SFX_FILES: Record<SfxName, readonly string[]> = {
  click: ['click'],
  nav: ['nav'],
  meow: ['cat-click-1', 'cat-click-2', 'cat-click-3'],
  quack: ['duck-click'],
  answerRight: ['answer-right'],
  answerWrong: ['answer-wrong'],
  lessonDone: ['lesson-complete'],
  chapterDone: ['chapter-complete'],
  challengeDone: ['challenge-complete']
}

/**
 * 找文件时按这个顺序挑扩展名。
 *
 * `mp3` 排第一是因为它最通用、主人手上多半就是它；`ogg` 次之（同体积音质更好）；
 * `wav` 体积大但无损、有些音效库只给这个；`m4a` 是 iPhone/录音笔的默认格式，
 * 顺手认一下不花成本。**同一个主干有多个格式时以靠前的为准**，
 * 免得同一句话今天响这个、明天响那个。
 */
export const SOUND_EXT_PRIORITY = ['mp3', 'ogg', 'wav', 'm4a'] as const

/**
 * 每种场合的音量倍数（1 = 原始音量）。
 *
 * 【为什么需要它】
 * 主人从不同来源找的音效，**响度几乎不可能一致** —— 一只猫叫的录音可能是
 * 通关音乐的十倍响。全部原样播出来的结果，是"有的听不见、有的吓一跳"。
 * 这里给一个不用重新导出文件就能调的音量旋钮。
 *
 * 现在的值都是 1（还没听过素材，不预先乱调）。主人听过之后如果觉得哪个不对，
 * **改这里的数字即可**，不用去动音频文件。
 */
export const SFX_GAIN: Record<SfxName, number> = {
  click: 1,
  nav: 1,
  meow: 1,
  quack: 1,
  answerRight: 1,
  answerWrong: 1,
  lessonDone: 1,
  chapterDone: 1,
  challengeDone: 1
}

/**
 * 单个候选文件的额外增益 —— 按**文件名主干**索引，和 `SFX_GAIN`（按场合）**相乘**。
 *
 * 【为什么 `SFX_GAIN` 不够用】
 * `SFX_GAIN` 一个场合只有一个数，所以它能修的只有"这个场合整体偏响/偏轻"。
 * 而"点猫咪"这个场合有**三段**猫叫，是随机抽的 —— 如果其中一段比另外两段轻一半，
 * 表现就是**三分之一的点击明显小声**，另外两次正常。那不是"猫叫音太大了"能描述的毛病，
 * 一个数也补不了：调大了，另外两段反而炸。
 *
 * 【1.97 这个数是怎么来的 —— 实测，不是估的】
 * 四段素材的有效段 RMS（`scripts/图片工具/` 之外另有量法，见提交说明）：
 *     duck-click 2537   cat-click-1 2636   cat-click-2 **1290**   cat-click-3 2549
 * 除了 cat-click-2，其余三段几乎一模一样（差 4% = 0.3dB，听不出来）。
 * cat-click-2 是 **0.51×**，也就是 -5.8dB。`2537 / 1290 ≈ 1.97`。
 *
 * 【为什么不直接把音频文件调响】
 * 素材是主人的，我只改代码。而且这样**换素材不用重新调**：
 * 哪天主人换了新的第二段猫叫，把这一行删掉就行，别的什么都不用动。
 * 代价是它绑在文件名上 —— 所以**改名要连这里一起改**（和 `SFX_FILES` 同理）。
 *
 * ⚠️ 主人如果自己把音频响度拉平了，**要把这一行删掉**，否则会反过来变成 2 倍响。
 */
export const SFX_BASE_GAIN: Record<string, number> = {
  'cat-click-2': 1.97
}

/**
 * 开头这一段（秒）以内**先找有没有静音**，找到就跳过 —— 见 `findOnset()`。
 *
 * 【为什么需要它】
 * 点击音效对延迟最敏感（本文件开头第 1 条理由）。而主人这四段素材实测的开头静音是：
 *     duck-click **135ms**   cat-click-1 **90ms**   cat-click-2 **100ms**   cat-click-3 10ms
 * 也就是说：点大肥鱼，**按下之后 135 毫秒才出声**。
 * 这正是 `AudioBufferSourceNode` 想避免的那个"点完过一会儿才响"——
 * 只不过这次的来源不是解码延迟，是**素材自己开头那段空白**。
 * 架构再快也快不过音频里的静音。
 */
export const ONSET_SCAN_MAX_SEC = 0.4

/** 跳过静音时**留一点余量**（秒）：起音那一下常常是渐强的，切到正头上会"啪"一声。 */
export const ONSET_HEADROOM_SEC = 0.005

/**
 * 找**真正的起音点**（秒）。`0` 表示不用跳。
 *
 * @param channels 每条声道的 PCM（`-1 ~ 1`）
 * @param sampleRate 采样率
 *
 * 【判据为什么是"峰值的 2%"】
 * 取相对值而不是绝对阈值：素材的绝对电平差好几倍（实测峰值 3521 ~ 9968），
 * 写死一个绝对数会让轻的那段整段被当成静音。2% 是 -34dB，比任何可闻的起音都低，
 * 又高于底噪。
 *
 * 【为什么不做"去尾部静音"】
 * 尾部静音不产生延迟，只让这个 buffer 大一点；而截尾要判断"结尾是不是渐弱"，
 * 判错的代价是**把余韵切掉**（比留一点静音难听得多）。收益和风险不成比例。
 */
export function findOnset(
  channels: readonly Float32Array[],
  sampleRate: number
): number {
  if (channels.length === 0 || sampleRate <= 0) return 0
  let peak = 0
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i] ?? 0)
      if (v > peak) peak = v
    }
  }
  if (peak <= 0) return 0 // 整段是静音：没有起音点，跳哪儿都一样

  const limit = Math.min(channels[0]?.length ?? 0, Math.floor(ONSET_SCAN_MAX_SEC * sampleRate))
  const threshold = peak * 0.02
  for (let i = 0; i < limit; i++) {
    for (const ch of channels) {
      if (Math.abs(ch[i] ?? 0) <= threshold) continue
      const at = Math.max(0, i / sampleRate - ONSET_HEADROOM_SEC)
      // 开头本来就是干净的（cat-click-3 只有 10ms）就**原样返回 0**：
      // 为一个听不出来的差值去改播放起点，只会多一个要解释的行为
      return at > 0.03 ? at : 0
    }
  }
  return 0
}

/**
 * 最短重触发间隔（毫秒）。防连点叠成噪音。
 *
 * 反馈音（学完一课/通关）给得长一些：它们是"一次事件"的声音，
 * 短时间内响第二遍会显得这个事件不值钱。点击类给得短，但**不能是 0** ——
 * 鼠标的 `click` 在快速连点下能到每秒十几次，叠起来就是一串爆音。
 */
export const SFX_THROTTLE_MS: Record<SfxName, number> = {
  click: 55,
  nav: 90,
  meow: 260,
  quack: 260,
  /*
   * 判分这对给 320ms，比 `nav`（90ms）长得多。
   *
   * 【为什么不能短】
   * 练习是**一题一题连着做**的：答对→下一题→答对，中间可能只隔几百毫秒。
   * 节流太短的话，两道题的两声会叠在一起变成一串；而这两声是**反馈**，
   * 叠起来就分不出哪一声对应哪一题了。320ms 足够让前一声的尾巴走完
   * （`answerRight` 全长才 0.36s，但响度早就衰下去了）。
   * 也不能长到盖住"下一题"——那是 `nav`（90ms），两者互不干扰。
   */
  answerRight: 320,
  answerWrong: 320,
  lessonDone: 700,
  chapterDone: 1100,
  challengeDone: 1400
}

/** 从 glob 的路径里取文件名主干：`../assets/sounds/cat-click.mp3` → `cat-click` */
export function soundBaseOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.[a-z0-9]+$/i, '')
}

/** 从 glob 的路径里取扩展名，小写、不带点：`…/cat-click.MP3` → `mp3` */
export function soundExtOf(path: string): string {
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  return dot > slash ? path.slice(dot + 1).toLowerCase() : ''
}

/**
 * 在「目录里现有的文件」里找某个主干对应的那一个。
 *
 * 返回 `null` 表示**这个音效没有素材** —— 这不是错误路径。
 * 主人可能只放了三张里的一张，也可能一张都还没放，两种情况都照常运行，只是不响。
 *
 * @param available glob 的**键**（路径），不是值
 * @param base 文件名主干，如 `cat-click`
 */
export function findSound(available: readonly string[], base: string): string | null {
  for (const ext of SOUND_EXT_PRIORITY) {
    const hit = available.find((p) => soundBaseOf(p) === base && soundExtOf(p) === ext)
    if (hit) return hit
  }
  return null
}

/**
 * 把「目录里有哪些文件」翻译成「每种场合该播哪个地址」。
 *
 * 纯函数，**是 wire 层和播放引擎之间唯一的那道缝**：wire 层负责 glob，
 * 翻译规则在这里，于是它能在单测里被完整驱动 —— 包括"目录是空的"这种
 * 现在真实存在的情况。
 */
export function resolveSources(
  available: readonly string[],
  urlOf: (path: string) => string
): Partial<Record<SfxName, string[]>> {
  const out: Partial<Record<SfxName, string[]>> = {}
  for (const name of Object.keys(SFX_FILES) as SfxName[]) {
    // 池子里**有几个算几个**：主人攒素材是陆续给的，三只猫叫只放了两只的时候，
    // 那两个照样能随机播 —— "只放一半"必须是完全可用的中间状态。
    const urls = SFX_FILES[name]
      .map((base) => findSound(available, base))
      .filter((p): p is string => p !== null)
      .map(urlOf)
    if (urls.length > 0) out[name] = urls
  }
  return out
}

/**
 * 从一个场合的候选里**随机抽一个**。
 *
 * 抽签的规则本身是纯的，所以它单独一个函数、单独被测 —— `playSfx` 里
 * 剩下的部分（解码表、音频上下文）在 node 环境里跑不起来，抽签要是埋在
 * 那里面，就只能靠"多播几次看看"来验证了。
 *
 * @param rand 测试注入用。默认 `Math.random`，取值应当是 `[0, 1)`
 */
export function pickSource(
  urls: readonly string[] | undefined,
  rand: number = Math.random()
): string | null {
  if (!urls || urls.length === 0) return null
  const first = urls[0]
  if (urls.length === 1 && first !== undefined) return first
  // `rand` 理论上是 [0,1)，但 1 或者 NaN 都可能被传进来 —— 越界会取到 `undefined`，
  // 表现是"偶尔点了没声音"，而查的时候只会去怀疑素材。夹一下，别信任调用方。
  const raw = Math.floor(rand * urls.length)
  const i = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), urls.length - 1) : 0
  return urls[i] ?? null
}

// ──────────────────────────────────────────────────────────── 播放

/** 场合 → 候选音频地址（多个就随机抽）。由 `setSfxSources()` 注入；缺的键就是"没素材，不响" */
let sources: Partial<Record<SfxName, string[]>> = {}

/** 已经解码好的 PCM，按地址缓存。没有这个缓存，每次播都要重新解码 */
const buffers = new Map<string, AudioBuffer>()

/** 每个地址的加载状态，防同一个文件被并发解好几遍 */
const loading = new Map<string, Promise<void>>()

/**
 * 每个地址**该从第几秒开始播**（跳过开头的静音），解码时算好。
 * 没算过的地址按 0 处理 —— 那不是错误路径，是"这段开头本来就干净"。
 */
const onsetOf = new Map<string, number>()

/**
 * 地址 → 文件名主干。**由 `setSfxSources()` 从 wire 层注入**。
 *
 * 播放时只有地址（`/assets/cat-click-2-a1b2c3.wav`），而 `SFX_BASE_GAIN` 是按主干索引的。
 * 不能自己从地址里反推主干：**打包后 Vite 会给文件名加内容哈希**
 * （`cat-click-2` → `cat-click-2-a1b2c3`），反推出来的主干跟 `SFX_BASE_GAIN` 的键对不上，
 * 而且**开发模式下是对的**（dev 不加哈希）—— 又是一个"上线才现形"的坑。
 * wire 层手上有 glob 的**原始路径**，那里的主干是准的，所以让它递进来。
 */
let baseByUrl: ReadonlyMap<string, string> = new Map()

/** 上一次**成功播放**的时刻，用于节流 */
const lastPlayedAt = new Map<SfxName, number>()

/** 总开关。拨到 false 时 `playSfx` 第一行就返回，连解码都不会触发 */
let enabled = true

/**
 * 总音量（**0~1 的增益倍数**，1 = 不衰减）。设置页那个滑块接的就是它。
 *
 * 【⚠️ 单位不是配置文件里的那个】config.json 里的 `sfxVolume` 是 0~100 的**百分比**
 * （给用户看的数），这里是 0~1 的**增益**（给 `GainNode` 用的数）。换算只发生在
 * `setSfxVolume` / `getSfxVolume` 这两个门口，模块内部一律是倍数 ——
 * 把百分比直接写进 `gain.gain.value` 的话，音量 100 就是 **100 倍增益**，
 * 一耳朵爆音，而且代码看着还挺对（"我设的就是 100 啊"）。
 *
 * 【一个数管两条来源】合成音和素材音在播放路径上没有区别（见文件头），
 * 两者最终都从同一个 `GainNode` 出去，所以**乘一次就同时管住了两条路** ——
 * 不需要"合成音音量"和"素材音量"两个旋钮，那种设计迟早会出现
 * "调了滑块，猫叫没变"这种没法解释的现象。
 */
let masterVolume = 1

/** 音频上下文。惰性创建 —— 没调用过 `playSfx`/`primeAudio` 就永远不会建 */
let ctx: AudioContext | null = null

/**
 * 拿到（必要时创建）音频上下文。**没有音频环境时返回 `null`，不抛错。**
 *
 * `typeof window` 那一句是给单测用的：vitest 跑在 node 环境，
 * 没有 `window`，直接写 `window.AudioContext` 会当场 ReferenceError。
 * 有了它，`playSfx` 在单测里就是一条安全的空路径 —— 这正是
 * "没有音频环境时静默但不抛错"这条要求的落地方式。
 */
function ensureCtx(): AudioContext | null {
  if (ctx) return ctx
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor()
  } catch {
    // 极端情况下（没有音频设备、被系统策略拒绝）构造会抛。这里吞掉：
    // 音效本来就是锦上添花，绝不能因为它让整个应用起不来。
    ctx = null
  }
  return ctx
}

/**
 * 现算一段合成音，包成 `AudioBuffer`。
 *
 * 【为什么要包成 `AudioBuffer` 而不是直接播振荡器】
 * 见文件头：包成 buffer 之后它和素材**在播放路径上没有任何区别**，
 * 于是 `playSfx` 不必知道有两套来源。
 *
 * 【没有配方的场合返回 `null`】
 * 这不是错误路径 —— 将来加了新场合却忘了写旋律，就该**安静地没声音**，
 * 而不是合成一段空 buffer 出来假装有声（那种"点了没反应但日志一切正常"
 * 最难查）。`null` 在这里会老老实实地让 `buffers` 里没有这个键，
 * 于是 `playSfx` 抽签时把它跳过。
 */
function makeSynthBuffer(c: AudioContext, name: string): AudioBuffer | null {
  if (!hasSynth(name)) return null
  const spec = SYNTH_SPECS[name]
  if (!spec) return null
  try {
    const pcm = renderSamples(spec, c.sampleRate)
    const buf = c.createBuffer(1, pcm.length, c.sampleRate)
    buf.copyToChannel(pcm, 0)
    return buf
  } catch {
    // 同 `ensureCtx` 的道理：音效是锦上添花，绝不能因为它让谁挂掉
    return null
  }
}

/**
 * 预解码一个音频文件。
 *
 * 【为什么要预解码，不能等播放时再解】
 * `decodeAudioData` 是异步的，一个几百 KB 的 mp3 要几十毫秒。
 * 等用户点了猫咪才开始解码，第一声必然延迟甚至丢掉。
 * 所以音频在**应用启动后、用户还没点到之前**就已经解好在内存里了。
 *
 * 【解码失败怎么办】
 * 吞掉。文件坏了、格式不被支持、路径 404 —— 结果都是"这个音效不响"，
 * 而为了它弹一个错误框，比没声音本身更烦人。
 * （但要注意：**这会让"主人放错了格式"表现为"没声音"而不是报错**，
 *   所以 `assets/sounds/README.md` 里明确写了支持的格式清单。）
 */
function preload(url: string): Promise<void> {
  const already = loading.get(url)
  if (already) return already

  const task = (async () => {
    const c = ensureCtx()
    if (!c) return

    /*
     * 合成那条路：不进 `try` 也不 fetch，**在这里就分叉**。
     * 起音点直接写 0 —— 合成的第一拍就是正拍，没有开头静音可跳
     * （`findOnset` 扫出来也会是 0，但没必要真扫一遍）。
     */
    if (url.startsWith(SYNTH_PREFIX)) {
      const buf = makeSynthBuffer(c, url.slice(SYNTH_PREFIX.length))
      if (buf) {
        buffers.set(url, buf)
        onsetOf.set(url, 0)
      }
      return
    }

    try {
      const res = await fetch(url)
      if (!res.ok) return
      const bytes = await res.arrayBuffer()
      const buf = await c.decodeAudioData(bytes)
      buffers.set(url, buf)
      // 起音点**在这里算**，不在每次播放时算：它要扫一遍 PCM，
      // 而播放是点击那一刻的事，多一毫秒都是延迟。解码本来就已经在后台了。
      const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i))
      onsetOf.set(url, findOnset(channels, buf.sampleRate))
    } catch {
      /* 见上：不响就是不响，不打扰用户 */
    }
  })()

  loading.set(url, task)
  return task
}

/**
 * 装上音源表 —— **由 `sfx-wire.ts` 在应用启动时调一次**。
 *
 * 调用它会**立刻开始预解码全部素材**（而不是等第一次播放）。
 * 理由见 `preload` 的注释：点击音效对延迟敏感，而解码是异步的。
 *
 * 【素材没覆盖到的场合，这里补一条合成音进去】
 * 补在这一层而不是 `playSfx` 里，是为了让"这个场合有没有声"在**装配阶段**
 * 就定下来：`sources` 装完之后，每个场合要么指向几个文件、要么指向一个 `synth:`。
 * `playSfx` 于是面对的是一个**没有空洞的表**，不必每次播放都判一次
 * "这个场合是不是没素材、那要不要合成"。
 *
 * ⚠️ **只在"一个都没有"时才补**：主人给猫叫放了三段，那三段照旧随机抽，
 * 绝不会被合成音挤掉一段 —— 素材永远是优先的那一路。
 */
export function setSfxSources(
  next: Partial<Record<SfxName, string[]>>,
  baseOfUrl: ReadonlyMap<string, string> = new Map()
): void {
  sources = withSynthFallback(next)
  baseByUrl = baseOfUrl
  for (const urls of Object.values(sources)) {
    for (const url of urls ?? []) if (url) void preload(url)
  }
}

/**
 * 把「只认素材」的音源表补成「**每个场合都有声**」的完整表。
 *
 * 抽成纯函数是为了能被单测直接驱动：补错了的表现是"某个场合没声音"，
 * 而没声音这件事**不会报错、也不会有日志**，只能靠断言钉住。
 *
 * @param next wire 层从 `assets/sounds/` 扫出来的东西（可能缺好几个场合）
 */
export function withSynthFallback(
  next: Partial<Record<SfxName, string[]>>
): Partial<Record<SfxName, string[]>> {
  const out: Partial<Record<SfxName, string[]>> = { ...next }
  for (const name of Object.keys(SFX_FILES) as SfxName[]) {
    const files = out[name]
    if (!files || files.length === 0) out[name] = [SYNTH_PREFIX + name]
  }
  return out
}

/**
 * 某个音效这一次的最终增益 = 场合增益 × 单文件增益 × 总音量。
 *
 * 【为什么抽成纯函数，而不是在 `playSfx` 里就地算】
 * 因为算出来的那个数在 node 单测里**够不着**：`playSfx` 走到 `ensureCtx()`
 * 就返回 null 了（没有音频环境），增益那几行根本执行不到。埋在里面的话，
 * 这条乘法只能靠耳朵验 —— 而"音量滑块拨到一半，响度是不是真减半了"
 * 恰恰是最该被数字钉住的事。抽出来之后它能被直接调。
 *
 * 三个因子各修一种病，缺一个都不行：
 *   · `SFX_GAIN`：某个场合整体偏响 / 偏轻（比如通关音乐太吵）
 *   · `SFX_BASE_GAIN`：同一个场合内部几段素材不齐（三段猫叫里有一段轻一半）
 *   · `masterVolume`：用户自己拨的总音量
 */
export function sfxGainOf(name: SfxName, base: string | undefined): number {
  return SFX_GAIN[name] * (SFX_BASE_GAIN[base ?? ''] ?? 1) * masterVolume
}

/**
 * 播一个音效。**任何一步不满足就静默返回** —— 不抛错、不排队、不倒放别的音。
 *
 * 静默的五种情况，每一种都是正常状态而不是故障：
 *   1. 总开关关着（设置页里关掉了音效）
 *   2. **总音量是 0**（滑块拉到底 —— 和关开关是同一个意思，见下）
 *   3. 这个场合没有素材（主人还没放 / 只放了一部分）
 *   4. 还在节流窗口里（用户连点）
 *   5. 音频还没解码完，或解码失败了
 *
 * 【音量 0 为什么和开关关掉走同一条早退，而不是"照播、只是增益乘 0"】
 * 数学上两者等价（乘 0 就是没声音），但**副作用不等价**：真播出去会吃掉
 * 节流窗口（`lastPlayedAt`），于是用户把滑块拉回来之后，头一声点击可能
 * 正好落在刚过去的窗口里 —— 表现是"调完音量发现点了没声音"。
 * 既然两种写法对用户是同一件事，就选开销小、且不留下这类尾巴的那个。
 */
export function playSfx(name: SfxName): void {
  if (!enabled) return
  if (masterVolume <= 0) return

  const urls = sources[name]
  if (!urls || urls.length === 0) return

  const now = Date.now()
  const last = lastPlayedAt.get(name) ?? 0
  if (now - last < SFX_THROTTLE_MS[name]) return

  /*
   * 只在**已经解码好**的那几个里抽签。
   *
   * 不筛的话，抽中一个还没解码完的地址只能静默返回 —— 三个猫叫里有一个没好，
   * 就变成"三分之一的点击没声音"。而这种"有时候响有时候不响"最容易被归因成
   * "有一段音频文件是坏的"，实际只是抽签抽到了没准备好的那个。
   * （素材在启动时就全部预解码了，所以这条主要管住刚开机那一小会儿。）
   */
  const url = pickSource(urls.filter((u) => buffers.has(u)))
  if (!url) return

  const buffer = buffers.get(url)
  if (!buffer) return

  const c = ensureCtx()
  if (!c) return

  // 从被系统挂起（用户还没交互过）的状态恢复。resume 是异步的，
  // 但**不 await** —— 这一声该响就响，为了等它而让点击卡顿不值得。
  if (c.state === 'suspended') void c.resume()

  const src = c.createBufferSource()
  src.buffer = buffer

  const gain = c.createGain()
  // 场合增益 × 单文件增益 × 总音量。三项各修一种病，见 `sfxGainOf`。
  gain.gain.value = sfxGainOf(name, baseByUrl.get(url))

  src.connect(gain)
  gain.connect(c.destination)
  // 第二个参数是**从缓冲区的第几秒开始播**：跳过素材开头那段静音，
  // 否则按下之后要等 90~135ms 才出声（实测数，见 ONSET_SCAN_MAX_SEC）。
  src.start(0, onsetOf.get(url) ?? 0)

  // 只在**真的播出去了**之后记账，否则"没解码好"的那几次会把节流窗口白白吃掉，
  // 等解码完成时反而被节流挡住 —— 表现为"第一次点击总是没声音"。
  lastPlayedAt.set(name, now)
}

/**
 * 解锁音频上下文 —— 在**用户第一次真实交互**时调用。
 *
 * 【为什么需要这一步】
 * 浏览器的自动播放策略规定：`AudioContext` 如果在用户手势之前创建，
 * 会停在 `suspended` 状态，此时播放**不会出声也不报错**。
 * `playSfx` 里已经顺手 `resume()` 了一次，但那个是补救；
 * 在 `pointerdown` 时主动解锁一次，能保证**第一声就响**。
 */
export function primeAudio(): void {
  const c = ensureCtx()
  if (c && c.state === 'suspended') void c.resume()
}

/**
 * 总开关。设置页里那个「音效」开关接的就是它。
 *
 * 【为什么关掉时不暂停已在播的声音】不做 —— 那些音最长也就一两秒，
 * 为了掐掉它们要维护一张"正在播的节点"表，收益接近零。
 */
export function setSfxEnabled(next: boolean): void {
  enabled = next
}

/** 当前是否启用（设置页试听、以及单测用） */
export function isSfxEnabled(): boolean {
  return enabled
}

/**
 * 总音量。设置页那个滑块接的就是它，入参是**百分比（0~100）**——
 * 和 config.json 里那个字段、界面上显示的那个数**同一套单位**。
 *
 * 【为什么门口一定是百分比，内部一定是倍数】
 * 换算只在这一行发生，两边就都不会记错单位。中间任何一处"顺手用另一个单位"
 * 都会变成上面 `masterVolume` 注释里那个 100 倍爆音，且代码看着完全正确。
 *
 * 【坏输入（NaN / 字符串 / 越界）一律当成 100】不是"当成 0"：
 * 拿不到数就把整个应用静音，用户会去怀疑音频驱动，而真实原因是一个我们没拦住的值。
 * 夹区间和"非数字退回 fallback"那两件事都归 `clampVolume` 管（和读配置同一份实现），
 * 这里不另写一遍 —— 两份实现就是两处漂移。
 */
export function setSfxVolume(percent: number): void {
  masterVolume = clampVolume(percent, MAX_SFX_VOLUME) / MAX_SFX_VOLUME
}

/**
 * 当前总音量，**单位是百分比（0~100）**。
 *
 * 乘回 100 之后四舍五入，是为了别把 `0.5 * 100 = 50.000000000000007`
 * 这种东西交出去 —— 设置页要拿它显示，单测要拿它断言。
 */
export function getSfxVolume(): number {
  return Math.round(masterVolume * MAX_SFX_VOLUME)
}

/**
 * 重置全部运行时状态。**只给单测用** —— 模块级变量跨用例会串味。
 */
export function __resetSfxForTest(): void {
  sources = {}
  buffers.clear()
  loading.clear()
  onsetOf.clear()
  baseByUrl = new Map()
  lastPlayedAt.clear()
  enabled = true
  // 音量也要归位：上一个用例把滑块拉到 0，下一个用例的 `playSfx` 就会
  // 在没料到的地方提前 return（"音量 0 早退"那条）—— 和总开关是同一个串味的形状。
  masterVolume = 1
  ctx = null
}
