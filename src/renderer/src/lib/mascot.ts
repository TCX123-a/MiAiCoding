/**
 * 大肥鱼形象：尺寸族与姿态定义。
 *
 * 【为什么单独一个文件而不是写在 .vue 里】
 * 这里全是「算出来的数」——字号会不会溢出、哪一档放得下文字。
 * 放进 .vue 就一条都测不了（vitest 跑在 node 环境，没有 DOM 也没有渲染器），
 * 而算错的后果是**界面上直接看得见**：文字撑破虚线框、或者小档位上糊成一坨。
 * 所以纯计算的部分全在这里，组件只负责把它渲染出来。
 *
 * 本文件**一个字的中文都不写**（注释除外）：面向用户的话全在 copy.ts 的 MASCOT 段，
 * 想改说法去那儿改。`copy.test.ts` 会扫渲染层所有 .ts/.vue 里的中文字面量，
 * 在这儿写一句人话就会让单测变红。
 *
 * 规格真源见 docs/13-图片资产需求清单.md，本文件的取值必须与之一致。
 */

/** 姿态 key —— 出图时的文件名就是 `<pose>_01.png`，也是 docs/13 §3 那张表的左列 */
export const MASCOT_POSES = [
  'welcome', // 好奇打招呼：首次启动欢迎卡、侧栏 Logo
  'expect', // 期待、指着前方：空状态「你的第一课在这里」
  'proud', // 骄傲、拍肚皮：错题本清空（是成就，不是缺憾）
  'think', // 歪头思考：搜索无结果、课文不存在
  'yay', // 小庆祝、比心：答对
  'soothe', // 温柔不责备：答错、运行报错（共用，目标是同一件事——降低焦虑）
  'milestone', // 狂喜、鲸跃：人生第一次跑通代码
  'busy', // 忙碌、深潜：加载等待、环境检测中
  'remind', // 提醒但不催、叼本子：复习到期
  'guide' // 当向导、指路扛工具箱：环境安装引导
] as const

export type MascotPose = (typeof MASCOT_POSES)[number]

export const MASCOT_SIZES = ['xs', 's', 'm', 'l', 'xl'] as const

export type MascotSize = (typeof MASCOT_SIZES)[number]

/**
 * 五档边长（px）。
 *
 * 【为什么是固定档位而不是每个调用点各传一个数】
 * 尺寸要拿来跟 LoRA 出图的规格比对——档位固定了，「这个位置要多大」才有唯一答案，
 * 出图时不用猜。各写各的数，迟早出现 76 / 80 / 84 三个几乎一样却互不相干的尺寸。
 */
export const MASCOT_SIZE_PX: Record<MascotSize, number> = {
  xs: 32,
  s: 48,
  m: 80,
  l: 112,
  xl: 160
}

/** 占位框内边距（px），参与「文字放不放得下」的计算，所以导出 */
export const PLACEHOLDER_PADDING = 6

/** 占位文字「大肥鱼待替换」的字数，同样是给上面那个计算用的 */
export const PLACEHOLDER_CHARS = 6

/**
 * 这一档放不放得下「大肥鱼待替换」六个字。
 *
 * xs(32) / s(48) 放不下——硬塞的结果是换行三四行、每行两三个字，比不放还难看。
 * 所以小档位只留一个 🐟 图形，完整信息走 title 悬浮提示。
 */
export function showsPlaceholderText(size: MascotSize): boolean {
  return MASCOT_SIZE_PX[size] >= MASCOT_SIZE_PX.m
}

/**
 * 占位文字的字号：跟着框走。
 *
 * 除以 7 是解出来的，不是拍脑袋：六个汉字占 6×字号，加两边内边距要 ≤ 边长，
 * 即 6f + 12 ≤ size → f ≤ (size-12)/6 = size/6 - 2。取 size/7 留出富余，
 * 免得字体渲染的细微差异把字顶出框外。下限 10px 是给 m 档兜底的：
 * 再小用户就真看不清那行字了。
 */
export function placeholderFontPx(size: MascotSize): number {
  return Math.max(10, Math.round(MASCOT_SIZE_PX[size] / 7))
}

// ──────────────────────────────────────────────────────────── 情绪

/**
 * 占位框的色调语义。
 *
 * 【为什么是「语义」而不是直接给色值】
 * 色值属于设计令牌，住在 tokens.css 里；写进 .ts 就等于开了第二个配色真源，
 * 改主题时必然漏掉一处。这里只回答「这张图属于哪一类情绪」，
 * 具体画成什么颜色由样式表按这个 class 决定。
 * 附带好处：色调是纯数据，可以单测；色值没法测。
 */
export type MascotTone = 'neutral' | 'busy' | 'good' | 'care'

/** 十张姿态各归哪一类。分组依据是 docs/13 §3 那张表的「情绪」一列 */
export const MASCOT_POSE_TONE: Record<MascotPose, MascotTone> = {
  welcome: 'neutral',
  expect: 'neutral',
  proud: 'good',
  think: 'neutral',
  yay: 'good',
  soothe: 'care',
  milestone: 'good',
  busy: 'busy',
  remind: 'neutral',
  guide: 'neutral'
}

/** 运行面板输出区的三种状态 —— 那块小鱼要跟着变 */
export type RunMascotState = 'running' | 'ok' | 'fail'

/**
 * 运行状态 → 用哪张姿态的图。
 *
 * 【为什么直接用已有姿态，不新开三个 key】
 * 查 docs/13 §3 的表，这三个场景**早就各有一张**了：
 *   running → `busy`  （#5 加载等待，「深潜绕圈游」正好就是「正在跑」）
 *   ok      → `yay`   （#6 答对，小庆祝）
 *   fail    → `soothe`（#9 编译运行报错，拍拍肩膀）
 * 另起三个新 key 会多出三张要出图、且和这三张长得几乎一样 —— 出图的钱花两遍。
 *
 * 【为什么成功不用 `milestone`】
 * `milestone` 是「人生第一次跑通代码」的一次性狂喜（#8），
 * 每跑通一次就狂喜一次，第一次的特殊感就没了。
 */
export const RUN_MASCOT_POSE: Record<RunMascotState, MascotPose> = {
  running: 'busy',
  ok: 'yay',
  fail: 'soothe'
}

// ──────────────────────────────────────────────────────────── 图池

/** 半身版的文件名后缀，例 `welcome-head_01.png`。要用它的原因见 `mascotKeysFor` */
export const HEAD_SUFFIX = '-head'

/**
 * 从 N 张同姿态的图里挑一张。
 *
 * 【为什么用 seed 而不是 Math.random()】
 * 随机数每被求值一次就换一张。而「该显示哪张图」会在**每次重渲染**时重新求值
 * （运行面板的输出区一直在重渲染：跑的过程中重渲染、出结果时又重渲染），
 * 结果不是「每次运行换一张」，而是**图在疯狂闪**。
 * seed 由「第几次运行」提供：每跑一次换一张，同一次运行纹丝不动。
 *
 * 取模两层是为了负数也不越界 —— 目前 seed 不会是负的，但取模的结果
 * 直接当数组下标用，这个函数以后被别处拿去用时不至于悄悄返回 undefined。
 */
export function pickVariantIndex(count: number, seed: number): number {
  if (count <= 0) return 0
  return ((Math.trunc(seed) % count) + count) % count
}

/**
 * 第 index 张变体的文件名主干（不含 `.png`）。
 *
 * **编号从 01 起、一律两位**（`busy_01.png` … `busy_10.png`）。
 * 之所以不是「第 1 张不编号、后面才加」：那样出图的人得记住「第一张要改名」这条
 * 额外规矩，批量出图时一定会忘。全部带编号则是一句话的规则，整批丢进去就行。
 */
export function variantBase(key: string, index: number): string {
  return `${key}_${String(index + 1).padStart(2, '0')}`
}

/** 从 glob 给的路径里取出文件名主干：`../../assets/mascot/yay_02.png` → `yay_02` */
export function mascotBaseOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/[.]png$/i, '')
}

/**
 * 某个 key 当前有哪些图可用，按编号排好。
 *
 * 认两种名字：
 *   `<key>_<N>`   标准写法，例 `busy_01`、`busy_10`
 *   `<key>`       宽容写法，例 `busy`（只放一张、懒得编号时用，算第 1 张）
 *
 * 【为什么宽容写法要留着】
 * 用户是零编程经验的人。他丢了一张 `busy.png` 进去、界面纹丝不动，
 * 只会得到「这软件坏了」的结论，而不会猜到是文件名少了两个字符。
 * 多认一个名字的成本是两行代码，收益是这类困惑根本不会发生。
 *
 * **必须按数字排，不能按字符串排**：字符串序下 `yay_10` 会排在 `yay_02` 前面，
 * 于是「第几张是哪张」就取决于图库里有没有第 10 张 —— 同一份代码在两台机器上
 * 抽出来的图不一样，还是个只在图变多之后才发作的 bug。
 */
export function variantsOf(key: string, available: string[]): string[] {
  // 转义正则元字符：key 目前只有小写字母和连字符（都是安全的），
  // 但这里拼的是正则，将来谁加个 `x.y` 之类的 key 就会静默匹配到别的图
  const safe = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^${safe}(?:_([0-9]+))?$`)
  const hits: { base: string; n: number }[] = []
  for (const base of available) {
    const m = re.exec(base)
    if (m) hits.push({ base, n: m[1] === undefined ? 1 : Number(m[1]) })
  }
  return hits
    .sort((a, b) => a.n - b.n || (a.base < b.base ? -1 : a.base > b.base ? 1 : 0))
    .map((h) => h.base)
}

/**
 * 这一档是不是必须用**半身/头像**构图。
 *
 * 【这条规矩从哪来】docs/13 §2.2：全身图 512 缩到 32px 是 16 倍压缩，
 * 鲸鱼耳、围裙上的鲸鱼图案全丢，屏幕上只剩一个蓝点，认不出是谁。
 * 分界线画在 s 与 m 之间——m 档（80px）起全身图还看得清。
 */
export function needsPortrait(size: MascotSize): boolean {
  return MASCOT_SIZE_PX[size] < MASCOT_SIZE_PX.m
}

/**
 * 这个位置该按哪个 key 去找图，**按优先级排**。
 *
 * 小档位优先找半身版（`welcome-head_01.png`），没有再退回全身版（`welcome_01.png`）。
 *
 * 【为什么是「退回」而不是「必须」】
 * 半身版是**额外**要出的一批图，不是每个姿态都有。用户只给 `welcome` 出了半身版，
 * 那么侧栏 Logo 用半身版、别的小档位（设置页检测中的 `busy`）自动用全身版，
 * 界面上不会空一块。等哪天他补上了 `busy-head_01.png`，那个位置自己就换过去，
 * **一行代码都不用改**。
 */
export function mascotKeysFor(pose: MascotPose, size: MascotSize): string[] {
  return needsPortrait(size) ? [`${pose}${HEAD_SUFFIX}`, pose] : [pose]
}

/**
 * 从一串稳定的字符（日期键、课号之类的）算一个抽签种子。
 *
 * 【什么时候用它】当一个位置「每次出现都该换一张脸，但没有天然的计数」时
 * ——比如挑战结算页：它每天只会出现一次，没有「第几次」这种数，
 * 但**同一天反复进出必须始终是同一张**（否则就是 `pickVariantIndex` 注释里那个「图在抖」）。
 * 拿日期键当种子正好：每天换一张，当天纹丝不动。
 *
 * 逐字符加权而不是直接 `Number(key)`：后者遇到带连字符的日期键
 * （`'2026-09-13'`）会得到 `NaN`，抽签直接退化成永远第一张。
 */
export function seedFromKey(key: string): number {
  let n = 0
  for (let i = 0; i < key.length; i++) n = (n * 31 + key.charCodeAt(i)) % 2147483647
  return n
}
