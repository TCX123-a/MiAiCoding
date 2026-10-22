/**
 * 开屏动画的 schema 与判定 —— docs/24-开屏动画方案.md 的 P1 落地
 * （2026-10-05 主人批复：默认开 / 每次打开都放 / 默认静音可调 / 素材随包 /
 * 默认透明留一键不透明兜底 / 随机播放带素材池）。
 *
 * 【2026-10-17 朋友分享版改默认：enabled = false】
 * 开屏用的是**随包自带**的视频（分享版照旧带着素材，只是默认不播）。
 * 自用版每次启动看同一段开屏是仪式感；朋友第一次打开、还不知道这软件是
 * 什么的时候，先放三秒视频是拦路。所以全新配置默认关，设置里一键可开。
 * **只影响全新配置**：normalizeSplash 对显式布尔值原样保留，老用户
 * 已经打开的设置不会被这次改默认值动到。
 *
 * 【为什么这个文件零 import】它是 main / preload / renderer 三边共用的叶子：
 * types.ts 从这里拿 SplashConfig 与 defaultSplash，preload 拿 SplashTimeline，
 * main/splash 拿 decideSplash。任何反向依赖（比如为钳位去 import
 * config-migrate 的 clampVolume）都会在 types.ts 那一层绕出循环 import ——
 * 所以音量钳位这里自带一份 clampPct（0~100 整数、坏值回默认），
 * 语义与 config-migrate 的 clampVolume 对齐；能复制不拉线。
 * 纯函数、无副作用、无 node/electron API —— 单测直接 import。
 */

/** 开屏素材的选片方式：指定一个 / 随机（随机候选池见 pool） */
export const SPLASH_PICKS = ['fixed', 'random'] as const
export type SplashPick = (typeof SPLASH_PICKS)[number]

/** 视频铺法：contain 完整画面留黑边（默认） / cover 裁边铺满 */
export const SPLASH_FITS = ['contain', 'cover'] as const
export type SplashFit = (typeof SPLASH_FITS)[number]

export const SPLASH_VOLUME_MIN = 0
export const SPLASH_VOLUME_MAX = 100
/** 池子上限：防手改配置塞进超大数组（规范化时截断，不是报错） */
export const SPLASH_POOL_MAX = 200

/** 不透明兜底模式下窗口的 backgroundColor（和开屏页品牌底的深端同色） */
export const SPLASH_OPAQUE_BG = '#04070d'

export interface SplashConfig {
  /** 总开关（分享版默认关，2026-10-17；自用版可在设置里开）。关掉 = 下次启动直接进主界面 */
  enabled: boolean
  /** 指定 or 随机（默认随机） */
  pick: SplashPick
  /**
   * pick='fixed' 时播的文件名 —— **只存 basename，不存绝对路径**：
   * 绝对路径换机器/挪目录就失效，而素材本来就只有两个固定目录。
   */
  fixedFile: string
  /**
   * pick='random' 的候选文件名列表；**空数组 = 全部素材参与**（零行为变化的
   * 默认值）。非空但一个名字都对不上磁盘 → 如实跳过（见 decideSplash），
   * 不偷偷回退成「全随机」—— 用户勾的池子没了，偷偷播别的更失礼。
   */
  pool: string[]
  /** 开屏音效独立开关（默认静音）。只作用于开屏视频 */
  sound: boolean
  /** 开屏音量 0~100。只作用于开屏视频，与界面音效各管各的 */
  volume: number
  /** 视频铺法（默认 contain：不裁画面） */
  fit: SplashFit
  /**
   * 不透明兜底：默认 false（透明窗，渐隐收场时透出桌面）。部分显卡驱动上
   * 透明窗合成会失效（electron#40515 类），置 true 一键换不透明窗口。
   */
  opaque: boolean
}

/**
 * 时长常量（毫秒）—— 集中在这里，改档位只动这一处。
 * 开屏页里另有一份 250ms 的 CSS 渐隐时长，两处一致性由 splash-static
 * 静态测试钉住（改一边不改另一边会红）。
 *
 *   MEDIA_DEADLINE  开屏窗显示后等首帧的上限；超时 = 素材有问题 → 收场
 *   SHOW_GUARD      mainWindow.show() 一次没生效时的重试间隔（见 handoff）
 *   HOLD_HINT       播完还在等主窗时，过这么久把页面切到「正在准备界面」
 *   MAX_PLAY        首帧出现后视频最多再播这么久（防长片拖体感）
 *   HARD_CAP        绝对上限：无论卡在哪一步，这么久一律交接
 *   FADE            渐隐时长（= 开屏页 CSS transition 的 250ms）
 *   DESTROY_SLOP    渐隐结束到 destroy 的余量（防把还在过渡的帧收掉）
 */
export const MEDIA_DEADLINE_MS = 6000
export const SHOW_GUARD_MS = 1500
export const HOLD_HINT_MS = 1200
export const MAX_PLAY_MS = 9000
export const HARD_CAP_MS = 15000
export const FADE_MS = 250
export const DESTROY_SLOP_MS = 150

/**
 * 低内存硬底线（GB）：低于它自动跳过开屏 —— 这是防「开机卡死」的安全阀，
 * 不是用户偏好，所以**不设配置项**。2.0G 定标机在这条线上方，照常开屏可测；
 * 真要在更低内存上做实验，用逃生舱 MIAI_SPLASH_FORCE=1（对应 decideSplash
 * 的 force 入参）。
 */
export const LOW_MEM_GB = 1.5

/** 一个可用素材（扫描结果一行；name 是 basename，abs 是绝对路径） */
export interface SplashMaterialRef {
  name: string
  abs: string
  sizeBytes: number
}

/**
 * 烤录文字覆盖块 —— 素材视频里带 DSH 专属文字的部分，按时间窗口盖一层
 * 咪爱编程自己的文案（主人 2026-10-05 批复：视频里的 DeepSeek 光效/粒子/
 * Logo 保留，只把「初始化 DSH / 专业工作模式」这类字样替换掉）。
 *
 * 【坐标是相对**视频画面**的百分比，不是相对窗口】contain 铺法下窗口里
 * 视频只占中间一块（上下留黑边），按窗口算的框会整体偏移 —— 这是这个
 * 功能最容易犯且最难一眼看穿的错。页面拿到 videoWidth/videoHeight 后按
 * object-fit 的同一套缩放数学把百分比映射成像素（splash.html 内联实现，
 * 口径注释在那里）。
 *
 * 每条是一次「出现窗口」：视频时间轴 [startMs, endMs) 内显示 text，
 * 出入各有 240ms 的 CSS 渐隐（与页面 .cover 过渡同源，静态测试钉住）。
 */
export interface SplashCover {
  /** 出现时刻（视频时间轴，毫秒） */
  startMs: number
  /** 消失时刻（同轴；恒 > startMs） */
  endMs: number
  /** 左 / 上 / 宽 / 高，皆为相对视频画面的百分比（0-100，左上原点） */
  x: number
  y: number
  w: number
  h: number
  /** 覆盖文案（真源 shared/copy.ts，经 shared/splash-covers.ts 绑定） */
  text: string
}

/** 开屏页启动时向主进程拉的那一份播放配置（splash:get 的返回体） */
export interface SplashPagePayload {
  /** miai-wall:// 资产 URL（拼法在 shared/miai-wall-url.ts） */
  url: string
  sound: boolean
  /** 0~100（页面自己除 100 给 video.volume） */
  volume: number
  fit: SplashFit
  /** 素材文件名（timeline 同款口径，排障对得上） */
  name: string
  /** 该素材的烤录文字覆盖块；没有覆盖的素材是空数组（页面跳过整层） */
  covers: SplashCover[]
}

/** 开屏页 → 主进程的上报（splash:event；主进程按 sender 校验来源） */
export interface SplashPageEvent {
  type: 'meta' | 'first-frame' | 'ended' | 'error' | 'stalled' | 'skip'
  /** 仅 error：MediaError.code（1=ABORTED 2=NETWORK 3=DECODE 4=SRC_NOT_SUPPORTED） */
  code?: number
}

/**
 * 播放结局（timeline.reason；跳过时见 skipped 字段）。
 *   ended        视频自然播完
 *   skip         用户按键/点击跳过
 *   no-frame     开屏窗显示后 MEDIA_DEADLINE 内没等到首帧
 *   media-error  页面报了 error（解码失败/源不支持）
 *   max-play     首帧后播满 MAX_PLAY
 *   hard-cap     绝对上限兜底放行（含主窗始终没就绪的情况）
 *   load-fail    主窗主框架加载失败（主进程 did-fail-load）
 *   main-gone    主窗渲染进程没了（render-process-gone）
 *   window-gone  开屏窗被外力关闭（closed 事件先于收场）
 */
export type SplashEndReason =
  | 'ended'
  | 'skip'
  | 'no-frame'
  | 'media-error'
  | 'max-play'
  | 'hard-cap'
  | 'load-fail'
  | 'main-gone'
  | 'window-gone'

export type SplashSkipReason = 'flag' | 'disabled' | 'no-material' | 'pool-missing' | 'low-mem'

export type SplashDecision =
  | { action: 'play'; file: SplashMaterialRef }
  | { action: 'skip'; reason: SplashSkipReason }

/**
 * 开屏时间线 —— 从进程出生（t0，epoch ms）到交接收场的刻度表。
 * 除 t0 外全部是「距 t0 的毫秒差」（取整）；没发生的就是 null。
 * 两个读口：主进程在开屏结束时推 `splash:stats`（主窗挂 `window.__splashStats`，
 * 探针口径），晚挂载的渲染层用 `splash:stats:get` 补拉。
 * 【为什么记这么细】P2 的定标判据（「3 秒内出现首个窗口」「全程无黑/白闪」）
 * 全部从这里取值 —— 快照必须来自真时间戳，不许事后估算。
 */
export interface SplashTimeline {
  t0: number
  tSplashShow: number | null
  tFirstFrame: number | null
  tMainReady: number | null
  tHandoff: number | null
  /**
   * 主窗**首次显示**的时刻（mainWindow 'show' 事件，主进程窗口系统触发）。
   * 【为什么单独记它】渲染进程的 document.visibilityState 在 Electron 里对
   * 「创建了但没 show 过」的窗口也报 'visible'（2026-10-05 最小实验坐实），
   * 而交接后被遮挡又可能报 'hidden' —— 两头都说不了真话。「主窗没抢跑」这条
   * 判据（探针 a1~a6）只能以这个主进程侧刻度为准。
   */
  tMainShown: number | null
  tDestroyed: number | null
  /** 播放结局；跳过时 null（见 skipped） */
  reason: SplashEndReason | null
  /** 跳过原因；没跳过 null */
  skipped: SplashSkipReason | null
  /** 实际播的文件名；跳过时 null */
  file: string | null
  /** 跳过判定用到的素材总数（跳过时为全量扫描数） */
  materialCount: number
  /** 本机总内存（GB，一位小数）—— P2 低内存口径的取证字段 */
  totalMemGB: number
  /** 事件流水（'splash-show' / 'meta' / 'first-frame' / 'hold' / 'fade' / ...），按发生顺序 */
  events: string[]
}

function clampPct(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(SPLASH_VOLUME_MAX, Math.max(SPLASH_VOLUME_MIN, Math.round(v)))
}

export function defaultSplash(): SplashConfig {
  return {
    // 2026-10-17 朋友分享版拍板：全新配置默认关（素材仍随包，理由见文件头）
    enabled: false,
    pick: 'random',
    fixedFile: '',
    pool: [],
    sound: false,
    volume: 100,
    fit: 'contain',
    opaque: false
  }
}

/**
 * 把任意输入（磁盘上的老配置/手改的垃圾/更老版本缺字段）整树新造成一个
 * 合法的 SplashConfig。规则：坏值回默认、字符串 trim、数组净化（过滤非
 * 字符串与空串、保序去重、截断到 SPLASH_POOL_MAX）。
 * 【为什么整树新造】返回值会被四处保存（渲染层内存态、写盘载荷、主进程
 * 合并口），引用共享是改一处四处动的温床 —— 照 normalizeWallpaper 的规矩。
 */
export function normalizeSplash(raw: unknown): SplashConfig {
  const d = defaultSplash()
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return d
  const r = raw as Record<string, unknown>
  const pool: string[] = []
  if (Array.isArray(r.pool)) {
    const seen = new Set<string>()
    for (const it of r.pool) {
      if (typeof it !== 'string') continue
      const s = it.trim()
      if (s === '' || seen.has(s)) continue
      seen.add(s)
      pool.push(s)
      if (pool.length >= SPLASH_POOL_MAX) break
    }
  }
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    pick: SPLASH_PICKS.includes(r.pick as SplashPick) ? (r.pick as SplashPick) : d.pick,
    fixedFile: typeof r.fixedFile === 'string' ? r.fixedFile.trim() : d.fixedFile,
    pool,
    sound: typeof r.sound === 'boolean' ? r.sound : d.sound,
    volume: clampPct(r.volume, d.volume),
    fit: SPLASH_FITS.includes(r.fit as SplashFit) ? (r.fit as SplashFit) : d.fit,
    opaque: typeof r.opaque === 'boolean' ? r.opaque : d.opaque
  }
}

export interface DecideSplashInput {
  config: SplashConfig
  /** `--no-splash` / MIAI_NO_SPLASH=1（探针与排障的硬跳过，优先级最高） */
  noSplashFlag: boolean
  /** MIAI_SPLASH_FORCE=1：越过低内存安全阀（给低配定标机做实验用） */
  force: boolean
  /** os.totalmem() 折算的 GB；<=0（取不到）视为「未知」不拦 */
  totalMemGB: number
  /** 扫描到的全部可用素材 */
  files: SplashMaterialRef[]
  /** 注入随机源 [0,1)，测试钉死结果用 */
  rand: () => number
}

/**
 * 开屏判定 —— 纯函数，主进程的 createSplashGate 与单测共用同一份实现。
 *
 * 判定顺序（先到先拦，reason 即第一拦路者）：
 *   flag → disabled → 素材（no-material / pool-missing）→ low-mem → 挑片
 * 素材的两种空分开报：池子空是「磁盘上没有素材」，池子非空是「勾的名字
 * 都没了」—— 排障时这两个的修法完全不同，不能并成一个 reason。
 */
export function decideSplash(input: DecideSplashInput): SplashDecision {
  if (input.noSplashFlag) return { action: 'skip', reason: 'flag' }
  const cfg = input.config
  if (!cfg.enabled) return { action: 'skip', reason: 'disabled' }

  const candidates =
    cfg.pool.length > 0 ? input.files.filter((f) => cfg.pool.includes(f.name)) : input.files
  if (candidates.length === 0) {
    return { action: 'skip', reason: cfg.pool.length > 0 ? 'pool-missing' : 'no-material' }
  }

  if (!input.force && input.totalMemGB > 0 && input.totalMemGB < LOW_MEM_GB) {
    return { action: 'skip', reason: 'low-mem' }
  }

  let file: SplashMaterialRef
  if (cfg.pick === 'fixed' && cfg.fixedFile !== '') {
    // 指定文件在候选里找不到时**回退候选第一个**（不是跳过整个开屏）：
    // 磁盘上明明有素材、用户只是指到了一个已改名/被删的名字，播一个别的
    // 比黑着直接进界面体感好。实际播了哪个在 timeline.file 里如实记录，
    // 探针对得上账，不存在「静默换片还不留痕」。
    file = candidates.find((f) => f.name === cfg.fixedFile) ?? candidates[0]
  } else {
    // rand() 契约是 [0,1)；为防注入的假 rand 越界，floor 后再钳一次索引
    const idx = Math.min(candidates.length - 1, Math.max(0, Math.floor(input.rand() * candidates.length)))
    file = candidates[idx]
  }
  return { action: 'play', file }
}
