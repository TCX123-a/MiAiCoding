/**
 * 壁纸（动态壁纸引擎移植）设置的**单一真源** —— 默认值、合法区间、枚举白名单
 * 全在这里一份，读（config-migrate）、写（config-merge）、渲染层 setter（settings store）
 * 三处共用。理由同 layout.ts：两份定义就是两处漂移，而漂移的症状是
 * 「保存时能到 100、从老文件迁移出来却是 35」这种没人会去查的东西。
 *
 * 【设计依据】docs/23 §3.4.2 的键映射表 + §10 决策点 7（默认开、只垫渐变底）。
 *
 * 【为什么默认 enabled 是 false（2026-10-17 朋友分享版拍板，覆盖决策点 7）】
 * 决策点 7 的「默认开」前提是**开发者本机**：本机装着 Wallpaper Engine、
 * 素材就在手边，开了也只垫一层主题渐变。分享版面对的是陌生电脑 ——
 * 没装 WE 的用户开箱看到的就是一层空渐变，还要自己去设置里关；更要紧的是
 * 「动态壁纸」四个字会让人以为软件自带壁纸。所以分享版默认关，用户主动
 * 勾选时才现场探测 WE 并给出友好提示（见设置页）。
 * **只影响全新配置**：normalizeWallpaper 对显式布尔值原样保留，
 * 老用户已经打开的壁纸不会被这次改默认值关掉。
 *
 * 单位口径：dim/opacity/volume 是**给用户看的 0~100 整数**（界面写「35%」）；
 * brightness/contrast/saturate/playbackRate 是**倍率小数**。
 * 两类别混 —— 混了的表现是差 100 倍，一耳朵/一眼就能看出，但顺着现象
 * 第一个被怀疑的会是渲染实现而不是存的那个数（sfxVolume 同款教训）。
 */

import type { WallpaperPropValue } from './wallpaper-props'

// ---------------------------------------------------------------- 枚举白名单

/** 壁纸形态（project.json 归一后的 type；docs/23 §4.1）。
 *  `'image'` 是 v15 起**自定义上传**的图片形态（jpg/png/webp/gif 直接铺屏，
 *  不走场景引擎 —— 渲染端按海报图分支用原图渲染，见 WallpaperLayer 的
 *  planMedia）。WE 自带的 project.json 不会声明它，扫描侧的 inferType 映射
 *  不变（steam-scan 的白名单照收，只是现实中不会出现）。 */
export const WALLPAPER_KINDS = ['scene', 'video', 'web', 'application', 'image'] as const
export type WallpaperKind = (typeof WALLPAPER_KINDS)[number]

export const WALLPAPER_SOURCES = ['steam', 'folder'] as const
export type WallpaperSource = (typeof WALLPAPER_SOURCES)[number]

/** 过场动画 7 种 + random（docs/23 §3.3.2 的全矩阵） */
export const WALLPAPER_TRANSITIONS = ['cut', 'fade', 'push', 'wipe', 'iris', 'zoom', 'bars', 'random'] as const
export type WallpaperTransition = (typeof WALLPAPER_TRANSITIONS)[number]

export const WALLPAPER_TRANSITION_SPEEDS = [0.6, 1, 1.6] as const
export type WallpaperTransitionSpeed = (typeof WALLPAPER_TRANSITION_SPEEDS)[number]

/**
 * 「无上限」档的哨兵值（**v15 → v16 新增档**，与 120 一起来；主人点名）。
 * 为什么是 1000 而不是 0/Infinity：
 *  · 引擎 FrameGate 是 `1e3/n` 毫秒闸门，1000 ⇒ 1ms ⇒ 每个 rAF 都提交
 *    = 跑满显示器刷新率，正是「无上限」的语义；
 *  · 0 会被引擎里满地的 `rt.cfg.sceneFps || 60` 吞成 60（falsy）；
 *  · Infinity 会让自适应参照 capNow 拿到 Infinity 把画质瞬间降没。
 *    自适应参照另有构建期热修钳在 ≤60（build/webwallgl-hotfix.ts 的
 *    [miai-fps-hotfix]）—— 没有它，120/1000 在 60Hz 屏上会让 autoQuality
 *    八秒内把后处理全降掉。
 */
export const FPS_UNLIMITED = 1000

export const WALLPAPER_SCENE_FPS = [15, 30, 60, 120, FPS_UNLIMITED] as const
export type WallpaperSceneFps = (typeof WALLPAPER_SCENE_FPS)[number]

/**
 * 画质档。**`'auto'` 不是引擎 API** —— 消费时映射成 `autoQuality: true`
 * （引擎枚举是 PostQuality=off/low/medium/high + 独立 autoQuality 布尔，
 * 直传 `quality:'auto'` 会静默无效；docs/23 §3.4.2 行注）。
 */
export const WALLPAPER_QUALITIES = ['off', 'high', 'auto'] as const
export type WallpaperQuality = (typeof WALLPAPER_QUALITIES)[number]

/** 音频反应采集路线（决策点 4：v1 走 native；bridge 是可选增强包） */
export const WALLPAPER_AUDIO_SOURCES = ['native', 'bridge', 'off'] as const
export type WallpaperAudioSource = (typeof WALLPAPER_AUDIO_SOURCES)[number]

export const WALLPAPER_ROTATION_ORDERS = ['sequential', 'random'] as const
export type WallpaperRotationOrder = (typeof WALLPAPER_ROTATION_ORDERS)[number]

/**
 * 过场方向（**v11 → v12 新增键**）。只对 push/wipe/bars 三种方向性过场有效
 * （上游口径：方向 segmented 行只在 `switchTr.directional` 时出现）；cut/fade/
 * iris/zoom 走同一条「无方向」分支，带上方向也不生效 —— 但值照存不误。
 */
export const WALLPAPER_TRANSITION_DIRS = ['left', 'right', 'up', 'down'] as const
export type WallpaperTransitionDir = (typeof WALLPAPER_TRANSITION_DIRS)[number]

/**
 * 画面适配（**v11 → v12 新增键**，上游「适配」行的四档）。
 * `'center'` 不是 CSS `object-fit` 的合法值 —— 消费时映射成
 * `object-fit: none` + `object-position: center`（原始尺寸居中），这是本键
 * **唯一**允许的消费口径（WallpaperLayer 的 fitMediaStyle）。
 */
export const WALLPAPER_OBJECT_FITS = ['cover', 'contain', 'center', 'fill'] as const
export type WallpaperObjectFit = (typeof WALLPAPER_OBJECT_FITS)[number]

// ---------------------------------------------------------------- 合法区间

export const DIM_MIN = 0
export const DIM_MAX = 100
export const BLUR_MIN = 0
export const BLUR_MAX = 40
/** brightness / contrast / saturate 共用一对边界（同一根 --mi-wall-filter 串） */
export const MEDIA_ADJUST_MIN = 0.5
export const MEDIA_ADJUST_MAX = 1.5
export const OPACITY_MIN = 0
export const OPACITY_MAX = 100
export const PLAYBACK_RATE_MIN = 0.5
export const PLAYBACK_RATE_MAX = 2
/**
 * 播放倍速六档（0.5× ~ 2×）。**唯一真源** —— 全局倍速行与逐张微调的
 * playbackRate 白名单共用（渲染层别再自己拼一份：档位漂移的表现是
 * 「面板选得到、净化时被丢掉」这种静默失效）。
 */
export const WALLPAPER_RATE_STEPS = [PLAYBACK_RATE_MIN, 0.75, 1, 1.25, 1.5, PLAYBACK_RATE_MAX] as const
/** 逐张微调的缩放倍率区间（乘进模糊补偿；1 = 与全局一致） */
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2
export const PARALLAX_AMOUNT_MIN = 0
export const PARALLAX_AMOUNT_MAX = 10
export const PARALLAX_SMOOTH_MIN = 0
export const PARALLAX_SMOOTH_MAX = 98
export const AUDIO_GAIN_MIN = 0
export const AUDIO_GAIN_MAX = 4
export const VOLUME_MIN = 0
export const VOLUME_MAX = 100
export const ROTATION_INTERVAL_MIN = 1
export const ROTATION_INTERVAL_MAX = 240
/** 轮播池上限：防手改配置塞进超大数组（规范化时截断，不是报错；同 SPLASH_POOL_MAX 的口径） */
export const WALLPAPER_POOL_MAX = 500

// ---------------------------------------------------------------- 形状

export interface WallpaperRotationConfig {
  enabled: boolean
  /** 轮播间隔（分钟） */
  intervalMin: number
  order: WallpaperRotationOrder
  /**
   * 参与轮播的条目 id 列表（**v14 → v15 新增键**）。**空数组 = 全部可渲染
   * 条目参与**（零行为变化的默认值；同 SplashConfig.pool 的口径）。
   * 非空但一个 id 都对不上清单 → 轮播池为空、如实不轮播（syncRotation 的
   * pool<2 分支会停表），不偷偷回退成「全量」—— 用户勾的池子没了，偷偷
   * 播别的更失礼（同 decideSplash 的 pool-missing 纪律）。
   */
  pool: string[]
}

export interface WallpaperParallaxConfig {
  enabled: boolean
  /** 透视幅度（px 量级，0~10；实际位移 = 幅度 × 指针偏移比例） */
  amount: number
  /** 平滑系数（0~98，越大越跟手） */
  smooth: number
  // v12 曾有 mascotFollow（吉祥物跟随侧栏大肥鱼），v13 删除 —— 主人实测
  // 认为挪起来违和、确认不要。老配置里残留的键由 normalizeWallpaper
  // 整树重建时静默丢弃（本文件就是读侧兜底，不需要迁移 switch）。
}

export interface WallpaperAudioConfig {
  enabled: boolean
  source: WallpaperAudioSource
  /** 反应增益倍率（0~4；引擎侧另有自动增益，这里只乘在快照上） */
  gain: number
}

export interface WallpaperPowerConfig {
  pauseOnMinimize: boolean
  pauseOnBlur: boolean
  pauseOnBattery: boolean
}

/**
 * 逐张壁纸的「本张微调」（v13 新增）—— **全稀疏**：`undefined` = 跟随全局
 * 或该效果不生效；不改的键不落存储（照 DSH「与默认相等即删」的语义）。
 *
 * 【语义三态（面板的 hint 按这张表说话）】
 *  · 覆盖：flipH / flipV / playbackRate —— 设了就以这张为准；
 *  · 乘法：brightness / contrast / saturate / opacity / zoom —— 乘在全局值之上
 *    （默认 1 / 100，等于默认时删键）；
 *  · 加法：blur —— 与全局 blur 相加（默认 0；总和超上限按 BLUR_MAX 钳）。
 */
export interface WallpaperItemTune {
  /** 水平翻转；undefined = 跟随全局 flip（false 是有效覆盖：全局翻开时这张不翻） */
  flipH?: boolean
  /** 垂直翻转（v13 新键）；undefined = 不翻（没有全局对应物，true 才有意义） */
  flipV?: boolean
  /** 亮度倍率（乘在全局之上） */
  brightness?: number
  /** 对比度倍率（同上） */
  contrast?: number
  /** 饱和度倍率（同上） */
  saturate?: number
  /** 附加模糊 px（与全局相加） */
  blur?: number
  /** 透明度 0~100（乘在全局之上；100 = 不改，显示域同 OPACITY） */
  opacity?: number
  /** 缩放倍率（乘进模糊补偿） */
  zoom?: number
  /** 覆盖播放速度（WALLPAPER_RATE_STEPS 六档；undefined = 跟随全局） */
  playbackRate?: number
}

export interface WallpaperConfig {
  enabled: boolean
  source: WallpaperSource
  /** steam 源时是工坊 id；folder 源时是目录路径。'' = 没选（只垫渐变底） */
  selectedId: string
  /** 压暗遮罩 0~100（默认 35：文字可读的第一道保险） */
  dim: number
  /** 壁纸层模糊 0~40px */
  blur: number
  brightness: number
  contrast: number
  saturate: number
  /** 壁纸层不透明度 0~100（垫底实色不随它变） */
  opacity: number
  /** 水平镜像（scaleX(-1)） */
  flip: boolean
  /**
   * 画面适配（**v11 → v12 新增键**）。这键名对齐 CSS 的 object-fit 口径，
   * 但含 `'center'` 一档（上游「适配」四档之一）——见 WALLPAPER_OBJECT_FITS。
   */
  objectFit: WallpaperObjectFit
  transition: WallpaperTransition
  transitionSpeed: WallpaperTransitionSpeed
  /** 过场方向（**v11 → v12 新增键**）；仅 push/wipe/bars 生效 */
  transitionDir: WallpaperTransitionDir
  rotation: WallpaperRotationConfig
  /**
   * 隐藏的条目 id 列表（**v15 → v16 新增键**；主人点名的隐私功能：R18 壁纸
   * 不希望在列表/池子里被看到）。空数组 = 没有隐藏任何东西（零行为变化）。
   * 规则住在消费点，这里只存事实：
   *  · 过滤只发生在「列表展示 + 参与轮播」两处（WallpaperPickerModal、
   *    SettingsView 的池子候选与计数、WallpaperLayer 的 rotationPool）；
   *  · **findCatalogItem 不过滤** —— 正在播的恰好是隐藏壁纸时，画面照播
   *    （藏的是「展示」，不是「正在用」；把正在播的掐黑屏是更糟的失礼）；
   *  · 「显示隐藏项目」小开关是纯视图状态（localStorage，不进 config）。
   */
  hidden: string[]
  /** 倍速 0.5~2（仅视频形态） */
  playbackRate: number
  /** 场景渲染帧率（决策点 8：低内存档引擎会自适应再降） */
  sceneFps: WallpaperSceneFps
  quality: WallpaperQuality
  parallax: WallpaperParallaxConfig
  audio: WallpaperAudioConfig
  power: WallpaperPowerConfig
  /** 壁纸自带音量 0~100（默认 0 = 静音起步） */
  volume: number
  /**
   * 壁纸音轨开关（**v11 → v12 新增键**，上游「壁纸音轨」行）。
   * 假 = 强制静音，但**音量数值原样保留**——上游口径：「关闭 = 静音
   * （保留音量数值）· 开启时音量 0 自动 50%」；那条「自动 50%」是
   * 上游 UI 层的补齐行为，消费时由面板负责，本字段只管开关语义。
   */
  trackOn: boolean
  /**
   * 壁纸**自带属性**的逐张覆盖值（v13 新增，「壁纸属性」面板）：
   * itemId → { 属性名: 值 }。只有用户动过的条目才有键 —— 切壁纸、重启
   * 都保留（工单硬要求）；净化见 normalizeItemProps。
   */
  itemProps: Record<string, Record<string, WallpaperPropValue>>
  /** 逐张微调（v13 新增）：itemId → WallpaperItemTune；净化见 normalizeItemTuning */
  itemTuning: Record<string, WallpaperItemTune>
}

// ---------------------------------------------------------------- 默认值

/**
 * 标量默认值（子块在 defaultWallpaper() 里现造 —— 深结构不放共享常量，
 * 否则两个调用方拿到的是同一批子对象，谁原地改一下另一份就跟着变）。
 */
const DEFAULTS = {
  // 2026-10-17 分享版拍板：全新配置默认关（理由见文件头）；
  // 老配置里显式写下的 true/false 由 normalizeWallpaper 原样保留
  enabled: false,
  source: 'steam',
  selectedId: '',
  dim: 35,
  blur: 0,
  brightness: 1,
  contrast: 1,
  saturate: 1,
  opacity: 100,
  flip: false,
  objectFit: 'cover',
  transition: 'fade',
  transitionSpeed: 1,
  transitionDir: 'left',
  playbackRate: 1,
  sceneFps: 30,
  quality: 'auto',
  volume: 0,
  trackOn: true
} as const

/** 每次现造一份全新深对象（理由同 emptyIdePaths：防两个配置实例共享子块） */
export function defaultWallpaper(): WallpaperConfig {
  return {
    enabled: DEFAULTS.enabled,
    source: DEFAULTS.source,
    selectedId: DEFAULTS.selectedId,
    dim: DEFAULTS.dim,
    blur: DEFAULTS.blur,
    brightness: DEFAULTS.brightness,
    contrast: DEFAULTS.contrast,
    saturate: DEFAULTS.saturate,
    opacity: DEFAULTS.opacity,
    flip: DEFAULTS.flip,
    objectFit: DEFAULTS.objectFit,
    transition: DEFAULTS.transition,
    transitionSpeed: DEFAULTS.transitionSpeed,
    transitionDir: DEFAULTS.transitionDir,
    rotation: { enabled: false, intervalMin: 10, order: 'sequential', pool: [] },
    hidden: [],
    playbackRate: DEFAULTS.playbackRate,
    sceneFps: DEFAULTS.sceneFps,
    quality: DEFAULTS.quality,
    // 透视默认开：它是四特性里**最便宜的一个**（只在指针移动时动 rAF，
    // 复位即停），决策点 8 的低内存档描述就是「默认只出海报+视差」——
    // 也就是说视差被当作低配也扛得住的默认体验，不是要用户自己去开的东西。
    parallax: { enabled: true, amount: 3, smooth: 85 },
    // 音频反应默认关（决策点 4：opt-in。勾选后走 setAudio 运行期热换 ——
    // 2026-10-05 原型实证引擎支持挂载后换源，**不需要**重挂当前壁纸）
    audio: { enabled: false, source: 'off', gain: 1 },
    // 前两项是主人的硬性要求（失焦全停），默认全开；电池检测默认关（不是所有人的机器都有电池）
    power: { pauseOnMinimize: true, pauseOnBlur: true, pauseOnBattery: false },
    volume: DEFAULTS.volume,
    trackOn: DEFAULTS.trackOn,
    // 逐张表默认全空：没动过任何一张时不占存储（净化同样保持空表为空）
    itemProps: {},
    itemTuning: {}
  }
}

// ---------------------------------------------------------------- IPC 传输形状
//
// 这几种形状跨进程（main ↔ preload ↔ renderer），**必须住在 shared**：
// main 侧的扫描器按它产出、preload 按它收窄返回值、渲染层按它消费。
// 字段全是普通值（字符串/数字/布尔/null），能过结构化克隆 —— 别往里加
// 函数、Date、Map 这类东西（跨不过去，而且炸点在 IPC 那层、不在类型上）。

/** 壁纸条目的来路：WE 自带 / 用户自建 / 工坊订阅 / **用户上传**（v15 起，
 *  「导入壁纸」拷进 <用户数据>/wallpapers 的那批文件） */
export type WallpaperItemSource = 'default' | 'my' | 'workshop' | 'custom'

/** 扫描归一后的壁纸条目（paths 是**绝对路径、本机原样**；URL 形由渲染层现拼） */
export interface WallpaperItem {
  /** project.json 所在目录名（工坊条目 = 创意工坊 id，字符串形态） */
  id: string
  source: WallpaperItemSource
  /** 条目目录（绝对路径） */
  dir: string
  title: string
  type: WallpaperKind
  /** project.json 里声明的入口文件名（相对 dir） */
  file: string
  /** 主容器绝对路径（scene 已解析出 pkg；video 即视频文件本身） */
  mainFileAbs: string
  /**
   * 主容器的字节数（扫描时 stat 到的真值）；读不到为 null。
   *
   * 两个消费点（2026-10-05 场景引擎接入新增）：
   *  · `isRenderableItem` 的 scene 分支 —— 「project.json 声明了、盘上却没有」
   *    的条目引擎挂载必失败，只能靠海报；没有海报就不该算「能显示出画面」；
   *  · 场景首帧预算 B = clamp(15s…90s, 大小 ÷ 8MBps)（docs/23 §3.3.2），
   *    没数时上游退回 60s 缺省。
   */
  mainSizeBytes: number | null
  /** 预览图绝对路径（preview.* 探针扫出来的）；没有为 null */
  previewAbs: string | null
  contentrating: string | null
}

/**
 * 条目在「咪爱」里能不能真的显示出画面 —— 引擎换片与轮播池共用的判据。
 * video 有条目主文件（mainFileAbs 恒在）随时能放；**scene 且主文件真的
 * 在盘上时由场景引擎渲染**（挂载失败会降级 preview 海报 —— 那是运行期
 * 兜底，不影响「能不能试一下」这个静态判据）；其余类型（web/application）
 * 以及没有主文件的 scene 统一降级为海报图，**没有预览图就是空白**。
 *
 * ⚠️ 必须只有这一份判据：WallpaperLayer 的换片（planMedia）与轮播池、选择
 * 弹窗的条目禁用全走它。2026-10-05 对抗复核抓到的正是「各写一份」的漂移形态：
 * 轮播池自己排除了这类条目，弹窗漏了同一道闸 —— 点下去 selectedId 落了盘、
 * 面板宣布「播放中」，屏上什么都没换（引擎的 doShow 只 console.warn 保旧层）。
 */
export function isRenderableItem(it: WallpaperItem): boolean {
  return it.type === 'video' || it.previewAbs !== null || sceneMainReady(it)
}

/**
 * scene 且主文件**真的在盘上**（扫描时 stat 到了字节数）。
 * 场景挂载前的静态判据：没有它，「声明了 scene.pkg 但文件不存在」的条目
 * 会被当成可渲染，mount 必然失败、白等一个首帧预算，最后还占着一条 warn。
 */
export function sceneMainReady(it: WallpaperItem): boolean {
  return it.type === 'scene' && typeof it.mainSizeBytes === 'number' && it.mainSizeBytes > 0
}

/**
 * 壁纸发现链的产出（`wallpaper:list` 的返回体）。
 *
 * 【为什么发现失败是 `available: false` 而不是抛错】没装 Steam / 没装 WE
 * 是完全正常的使用形态（用户可能只用内置素材）——照 AiResult 那套
 * 「失败即值」的语义，让调用方一个分支处理完，而不是 try/catch。
 */
export interface WallpaperCatalog {
  /** 找到 WE 安装目录（或至少一个工坊库）就算 true */
  available: boolean
  /** WE 安装目录绝对路径；没找到为 null */
  installDir: string | null
  /** 工坊库根目录列表（Steam 库的 steamapps 父级） */
  libraryDirs: string[]
  items: WallpaperItem[]
  /**
   * WE 当前正在运行的壁纸（把 WE config.json 里 selectedwallpapers 的文件路径
   * 反查成条目 id）。读不到 / 对不上任何条目时为 null —— 不是错误，
   * 只是「无从知道」。
   */
  currentFromWe: string | null
  scannedAt: number
}

/**
 * 窗口原生状态（`wallpaper:state` 推送 + `wallpaper:state:get` 的载荷）。
 *
 * 【为什么主进程只推这三个布尔】它们是**只有主进程知道的原生事实**。
 * 「失焦要不要停」是用户配置（pauseOnBlur），属于策略 —— 策略跟着
 * 响应式配置在渲染层推导：配置一改，暂停语义立刻跟着变，不需要主进程
 * 重新读配置、也不会有「配置改了但主进程那份是旧的」这种缝。
 */
export interface WallpaperWindowState {
  focused: boolean
  minimized: boolean
  visible: boolean
  /**
   * 桌宠窗此刻有没有焦点（2026-10-06）。主窗失焦的**分拣器**：点桌宠也会让
   * 主窗 blur，但"主人在逗鱼"不等于"主人离开了程序"——暂停策略
   * （pauseOnBlur 一族）追问一句它就能区分。**可选**：老载荷（或测试里手搓的
   * 最小载荷）没有这个键时按 false 读。
   */
  petFocused?: boolean
  /** 产生时刻（Date.now()），渲染层用来防乱序（旧推送晚到不覆盖新状态） */
  at: number
  /** 触发事件名（focus/blur/minimize/restore/show/hide/init/recheck/poke），排查用 */
  ev: string
}

/**
 * `wallpaper:props` 的返回体 —— 壁纸条目自带属性的**原文**（未解析、未净化）。
 *
 * `project` 是给 shared 解析器（wallpaper-props.ts 的 parseUserPropDefs）吃的
 * 「最小 project 壳」：`{ general: { properties, localization } }` —— 与
 * project.json 同形但砍掉 preview/shaders 等面板用不到的大块。条目不存在 /
 * 文件读不到 / JSON 坏了时 `project` 为 null（**失败即值**，不是错误；
 * 面板据此显示「本张没有自带属性」）。
 */
export interface WallpaperPropsResult {
  project: Record<string, unknown> | null
  /** 读的文件绝对路径（排查用；没走到读文件那一步时为 null） */
  path: string | null
}

// ---------------------------------------------------------------- 净化

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 数字净化：**先判 `Number.isFinite`，绝不直接 `Math.min(Math.max(...))`**。
 * `NaN` 能穿过那个式子（NaN 和谁比都是 false），于是 NaN 会被原样写进配置 ——
 * 之后 `blur: NaN` 让整条 filter 串失效、`dim: NaN` 让遮罩透明，全都是静默的。
 * 同款防线见 layout.ts 的 clampSize 与 config-migrate.ts 的 clampVolume。
 *
 * `int=true` 的字段四舍五入（给用户看的整数），浮点字段保留两位小数
 * （0.1 步进的滑杆值不落 0.30000000000000004 进文件）。
 */
function clampNum(v: unknown, fallback: number, min: number, max: number, int = false): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  const n = int ? Math.round(v) : Math.round(v * 100) / 100
  return Math.min(Math.max(n, min), max)
}

/** 枚举白名单：不在名单里一律退回 fallback（同 themeName 的教训：写进去不生效最难查） */
function pickEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback
}

/** 数字枚举白名单（0.6/1/1.6、15/30/60 这类，按字面量全等匹配） */
function pickNumEnum<T extends number>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/**
 * 逐张属性表的存储上限。**这不是洁癖，是 2G 低内存机器的底线**（工单红线）：
 * 手改过的配置文件可能塞进一条巨型字符串或上千个键，面板渲染前先截短。
 */
export const ITEM_ID_MAX_LEN = 128
export const PROP_NAME_MAX_LEN = 64
export const ITEM_PROPS_MAX_KEYS = 64
export const PROP_VALUE_STR_MAX_LEN = 512

/**
 * 「壁纸自带属性覆盖值」净化：itemId → { 属性名: 值 }。
 * 只留 string / number(有限) / boolean 三类值；名字与字符串值截长；
 * 每张键数封顶；**空表删 id 键**（照 DSH「整张没有覆盖 → delete token 键」）。
 */
function normalizeItemProps(raw: unknown): Record<string, Record<string, WallpaperPropValue>> {
  if (!isObject(raw)) return {}
  const out: Record<string, Record<string, WallpaperPropValue>> = {}
  for (const [id, props] of Object.entries(raw)) {
    if (id === '' || id.length > ITEM_ID_MAX_LEN) continue
    if (!isObject(props)) continue
    const kept: Record<string, WallpaperPropValue> = {}
    let n = 0
    for (const [name, v] of Object.entries(props)) {
      if (n >= ITEM_PROPS_MAX_KEYS) break
      if (name === '' || name.length > PROP_NAME_MAX_LEN) continue
      if (typeof v === 'string') {
        kept[name] = v.length > PROP_VALUE_STR_MAX_LEN ? v.slice(0, PROP_VALUE_STR_MAX_LEN) : v
      } else if (typeof v === 'number') {
        if (!Number.isFinite(v)) continue
        kept[name] = v
      } else if (typeof v === 'boolean') {
        kept[name] = v
      } else {
        continue
      }
      n++
    }
    if (n > 0) out[id] = kept
  }
  return out
}

/** 数值微调项：非有限数丢；**先钳位再比中性**——等于「不生效默认值」丢（相等即删） */
function tuneNum(v: unknown, neutral: number, min: number, max: number, int = false): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  const r = int ? Math.round(v) : Math.round(v * 100) / 100
  // 钳位在前：越界值钳回端点后若恰好落在中性值上（opacity 999 → 100、blur -3 → 0），
  // 它就是一个**不该存的键** —— 先比中性再钳的话会把这枚中性值写进存储，
  // 输出不是不动点（第二遍净化才删掉它），幂等测试会红
  const n = Math.min(Math.max(r, min), max)
  if (n === neutral) return undefined
  return n
}

/**
 * 「逐张微调」净化：itemId → WallpaperItemTune（见接口上的语义三态）。
 * 布尔项：flipH 两个极性都收（false 是有效覆盖）；flipV 只收 true。
 * **净化后空对象删 id 键**（没调过的壁纸不进存储）。
 */
function normalizeItemTuning(raw: unknown): Record<string, WallpaperItemTune> {
  if (!isObject(raw)) return {}
  const out: Record<string, WallpaperItemTune> = {}
  for (const [id, v] of Object.entries(raw)) {
    if (id === '' || id.length > ITEM_ID_MAX_LEN) continue
    if (!isObject(v)) continue
    const t: WallpaperItemTune = {}
    if (typeof v.flipH === 'boolean') t.flipH = v.flipH
    if (v.flipV === true) t.flipV = true
    const b = tuneNum(v.brightness, 1, MEDIA_ADJUST_MIN, MEDIA_ADJUST_MAX)
    if (b !== undefined) t.brightness = b
    const c = tuneNum(v.contrast, 1, MEDIA_ADJUST_MIN, MEDIA_ADJUST_MAX)
    if (c !== undefined) t.contrast = c
    const s = tuneNum(v.saturate, 1, MEDIA_ADJUST_MIN, MEDIA_ADJUST_MAX)
    if (s !== undefined) t.saturate = s
    const bl = tuneNum(v.blur, 0, BLUR_MIN, BLUR_MAX, true)
    if (bl !== undefined) t.blur = bl
    const op = tuneNum(v.opacity, OPACITY_MAX, OPACITY_MIN, OPACITY_MAX, true)
    if (op !== undefined) t.opacity = op
    const z = tuneNum(v.zoom, 1, ZOOM_MIN, ZOOM_MAX)
    if (z !== undefined) t.zoom = z
    if (typeof v.playbackRate === 'number' && (WALLPAPER_RATE_STEPS as readonly number[]).includes(v.playbackRate)) {
      t.playbackRate = v.playbackRate
    }
    if (Object.keys(t).length > 0) out[id] = t
  }
  return out
}

/**
 * 轮播池净化：过滤非字符串与空串、保序去重、截断到 WALLPAPER_POOL_MAX。
 * 与 normalizeSplash 的池子同一套规则（那边注释更细：空池=全部的语义住在
 * 消费点，这里只负责把脏值洗掉）。
 */
function normalizeIdPool(raw: unknown): string[] {
  const out: string[] = []
  if (!Array.isArray(raw)) return out
  const seen = new Set<string>()
  for (const it of raw) {
    if (typeof it !== 'string') continue
    const s = it.trim()
    if (s === '' || seen.has(s)) continue
    seen.add(s)
    out.push(s)
    if (out.length >= WALLPAPER_POOL_MAX) break
  }
  return out
}

/**
 * 把任意形状的东西**规整成一份合法的壁纸配置**（整树新造普通对象）。
 *
 * 与 normalizeLayout 同款职责：老配置文件里没有这一节（它是在 v10 之前写下的），
 * json-store 不做字段级兜底，所以读侧、写侧、渲染层 setter 三道都过这里补缺 + 钳位。
 *
 * 【为什么必须整树新造、不能浅合并】四个子块（rotation/parallax/audio/power）
 * 是响应式代理的高发区：渲染层那份配置里嵌套对象读出来仍是代理，
 * structuredClone 一碰就炸（settings store 有专门的回归闸）；即便拿到普通对象，
 * 返回入参引用也会让「写盘的那份」和「来源那份」共用同一个子对象。逐字段重建，
 * 两个病一起省掉（同 pickIdePaths 的「输出恒为全新对象」纪律）。
 */
export function normalizeWallpaper(raw: unknown): WallpaperConfig {
  const o = isObject(raw) ? raw : {}
  const rotation = isObject(o.rotation) ? o.rotation : {}
  const parallax = isObject(o.parallax) ? o.parallax : {}
  const audio = isObject(o.audio) ? o.audio : {}
  const power = isObject(o.power) ? o.power : {}
  return {
    // 默认 true（决策点 7）。⚠️ 这里写 `bool(o.enabled, true)` 而不是
    // `!== false` —— bool() 的语义就是「非布尔退回 fallback」，两者等价；
    // 用 bool 是为了和下面 power 子块（fallback 三种极性）保持同一种读法。
    enabled: bool(o.enabled, DEFAULTS.enabled),
    source: pickEnum(o.source, WALLPAPER_SOURCES, DEFAULTS.source),
    // 路径形态的 id 首尾空白按脏值处理（Windows 路径尾空格本就非法）；'' 是合法终态（= 没选）
    selectedId: typeof o.selectedId === 'string' ? o.selectedId.trim() : DEFAULTS.selectedId,
    dim: clampNum(o.dim, DEFAULTS.dim, DIM_MIN, DIM_MAX, true),
    blur: clampNum(o.blur, DEFAULTS.blur, BLUR_MIN, BLUR_MAX, true),
    brightness: clampNum(o.brightness, DEFAULTS.brightness, MEDIA_ADJUST_MIN, MEDIA_ADJUST_MAX),
    contrast: clampNum(o.contrast, DEFAULTS.contrast, MEDIA_ADJUST_MIN, MEDIA_ADJUST_MAX),
    saturate: clampNum(o.saturate, DEFAULTS.saturate, MEDIA_ADJUST_MIN, MEDIA_ADJUST_MAX),
    opacity: clampNum(o.opacity, DEFAULTS.opacity, OPACITY_MIN, OPACITY_MAX, true),
    flip: bool(o.flip, DEFAULTS.flip),
    objectFit: pickEnum(o.objectFit, WALLPAPER_OBJECT_FITS, DEFAULTS.objectFit),
    transition: pickEnum(o.transition, WALLPAPER_TRANSITIONS, DEFAULTS.transition),
    transitionSpeed: pickNumEnum(o.transitionSpeed, WALLPAPER_TRANSITION_SPEEDS, DEFAULTS.transitionSpeed),
    transitionDir: pickEnum(o.transitionDir, WALLPAPER_TRANSITION_DIRS, DEFAULTS.transitionDir),
    rotation: {
      enabled: bool(rotation.enabled, false),
      // 最小值 1 分钟：0 会让轮播每帧都想换 —— 那是「壁纸疯狂闪烁」而不是「轮播」
      intervalMin: clampNum(rotation.intervalMin, 10, ROTATION_INTERVAL_MIN, ROTATION_INTERVAL_MAX, true),
      order: pickEnum(rotation.order, WALLPAPER_ROTATION_ORDERS, 'sequential'),
      // v14 → v15 新增键：老配置没有 → []（= 全部参与，与升级前逐字节同行为）
      pool: normalizeIdPool(rotation.pool)
    },
    // v15 → v16 新增键：老配置没有 → []（= 没有隐藏，与升级前逐字节同行为）
    hidden: normalizeIdPool(o.hidden),
    playbackRate: clampNum(o.playbackRate, DEFAULTS.playbackRate, PLAYBACK_RATE_MIN, PLAYBACK_RATE_MAX),
    sceneFps: pickNumEnum(o.sceneFps, WALLPAPER_SCENE_FPS, DEFAULTS.sceneFps),
    quality: pickEnum(o.quality, WALLPAPER_QUALITIES, DEFAULTS.quality),
    parallax: {
      enabled: bool(parallax.enabled, true),
      amount: clampNum(parallax.amount, 3, PARALLAX_AMOUNT_MIN, PARALLAX_AMOUNT_MAX, true),
      // 上限 98 不是笔误：smooth=100 时 `1 - (1-a)^(dt/T)` 恒等于 1，
      // 平滑器退化成硬跟随（docs/23 §3.2.3 的帧率补偿公式，留 2 档余量）
      smooth: clampNum(parallax.smooth, 85, PARALLAX_SMOOTH_MIN, PARALLAX_SMOOTH_MAX, true)
    },
    audio: {
      enabled: bool(audio.enabled, false),
      source: pickEnum(audio.source, WALLPAPER_AUDIO_SOURCES, 'off'),
      gain: clampNum(audio.gain, 1, AUDIO_GAIN_MIN, AUDIO_GAIN_MAX)
    },
    power: {
      pauseOnMinimize: bool(power.pauseOnMinimize, true),
      pauseOnBlur: bool(power.pauseOnBlur, true),
      pauseOnBattery: bool(power.pauseOnBattery, false)
    },
    volume: clampNum(o.volume, DEFAULTS.volume, VOLUME_MIN, VOLUME_MAX, true),
    trackOn: bool(o.trackOn, DEFAULTS.trackOn),
    itemProps: normalizeItemProps(o.itemProps),
    itemTuning: normalizeItemTuning(o.itemTuning)
  }
}
