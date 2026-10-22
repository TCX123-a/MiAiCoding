/**
 * 液态玻璃的**运行时**：镜像画布 + 折射滤镜 + 节流调度。
 *
 * 【整条链路的形状（为什么必须长这样）】
 * 2026-10-08 的三轮实验（_glassx-20261008/exp2·3·4）把可行路径钉死成一条：
 *
 *   · `backdrop-filter: url(#svgFilter)` + feDisplacementMap = **静默零效果**。
 *     这是最像「正确做法」的那条路，恰恰是死的 —— 不许再试（R7）。
 *   · `backdrop-filter: blur(N)` 确实生效，但深色半透明面板上视觉影响极轻
 *     （实测 sd 只掉 6%），而且开销是真的。它只做兜底，不承担折射。
 *   · **元素级 `filter: url(#f)` + feImage + feDisplacementMap = 完全可用**
 *     （实测精确 30px 位移，与理论 scale 吻合）。
 *
 * 于是本文件搭的是「E 案」：
 *   一张全屏、0.5 缩放的镜像 canvas —— 它把壁纸**照着原样重画一遍**
 *   （cover 数学 + 适配层的翻转/滤镜/不透明度全部复制），上面挂一个 SVG 滤镜：
 *       feImage(折射贴图) → feGaussianBlur(镜像) → feDisplacementMap → feComposite(in 贴图)
 *   贴图（lib/glass/lens-map.ts）同时是位移场和遮罩：面板矩形内 = 磨砂镜像，
 *   边缘一圈 = 折射位移，矩形外 = 透明。
 *   镜像画布挂在 `.wp-stage` 与 `.wp-dim` 之间 —— 压暗遮罩照样盖它（不然面板
 *   底下的画面会比四周亮一块），壁纸层本来就在 z:-1，正文与卡片天然盖住它。
 *
 * 【为什么镜像要「重画」而不是抓屏】Chromium 没有给「读回自己这层后面的像素」
 * 的接口（backdrop 那条死路就是证明）。重画是唯一可控的路子，代价是这一层
 * 自己承担一份 drawImage —— 实测（exp4）全速 121.6fps / 1/8 节流 227.9fps
 * （基线 240），所以 30fps 节流是**硬要求**，不是优化项。
 *
 * 【保真度】镜像与真壁纸的对照 meanAbs 1.85（exp4 的 F 臂）—— 面板边框处
 * 看不出接缝。要保住这个数，绘制时必须逐项复制：cover/contain/fill 的适配
 * 数学、元素自身的 scale（翻转）、fit 与槽位的 opacity、fit 上的 filter。
 * **少复制任何一项，面板边缘都会出现一条错位缝**（而这条缝在半透明面板后面
 * 是「看着有点糊」而不是报错，最容易糊弄过去）。
 *
 * 【失效安全】这段代码坏了不许拖垮壁纸 —— 所有 DOM/滤镜操作都包在 try/catch
 * 里，第一次抛错就整体停用（`failed`）并把滤镜摘掉，壁纸本身照常。
 *
 * 【本文件被文案闸门扫】字符串一律英文，中文只出现在注释里。
 */

import { lensMapPixels, LENS_MAP_UNIT, type LensRect } from './lens-map'
import { measureLensRects, rectsSignature } from './surfaces'

/** 镜像画布的分辨率比例：0.5 = 半分辨率（实验口径） */
export const MAP_SCALE = 0.5

/** 动态源（视频/场景在动）时的重画间隔 —— 30fps 节流（见文件头） */
const TICK_DYNAMIC_MS = 33
/** 静态源（图片 / 暂停的视频）时的轮询间隔：只用来发现几何变化 */
const TICK_STATIC_MS = 250
/** 长时间没变化时的空闲间隔：几乎不花电，但仍然能发现改窗口大小 */
const TICK_IDLE_MS = 1000
/** 两次几何测量之间的最小间隔（毫秒）—— 拖动窗口时别把布局引擎打爆 */
const MEASURE_MIN_GAP_MS = 180
/** 「流动」呼吸的最慢/最快周期（毫秒）与最大振幅（相对强度） */
const FLOW_PERIOD_SLOW_MS = 14000
const FLOW_PERIOD_FAST_MS = 5000
const FLOW_AMP_MAX = 0.18
/** 静态源时呼吸的更新间隔（6fps）：慢正弦，肉眼看是连续的 */
const FLOW_STEP_MS = 160
/** 空闲判定：连续这么多次测量都没有任何变化就降到 TICK_IDLE_MS */
const IDLE_AFTER = 4

const SVG_NS = 'http://www.w3.org/2000/svg'
const FILTER_ID = 'mi-glass-refract'
const SVG_ID = 'mi-glass-svg'

/** 玻璃参数（由 stores/wall-ui.ts 提供，store 一变就 sync()） */
export interface GlassParams {
  /** 总开关 */
  refract: boolean
  /** 折射强度（px，最大位移量） */
  strength: number
  /** 环带宽度（px） */
  ring: number
  /** 背景模糊（px） */
  blur: number
  /** 流动（0 = 静止；越大越快越明显） */
  flow: number
}

export interface RefractionDeps {
  /** 镜像画布（模板里那个 `.wp-refract`） */
  canvas: HTMLCanvasElement
  /** 当前参数 */
  params: () => GlassParams
  /** 壁纸层现在是不是真的在显示媒体（'media' 档）—— 不是就别画 */
  mediaShown: () => boolean
}

export interface RefractionStats {
  on: boolean
  failed: boolean
  /** 'dynamic' | 'static' | 'idle' | 'off' */
  mode: string
  draws: number
  mapRebuilds: number
  lastDrawMs: number
  lastMapMs: number
  rects: number
  scale: number
  /** 最近一次绘制为什么没画出来（分辨「没画」和「画了但是空的」） */
  lastSkip: string
}

export interface RefractionHandle {
  /** 参数变化：下一拍生效 */
  sync(): void
  /** 几何可能变了（切路由/折叠侧栏/窗口尺寸）：立刻重测并重画 */
  invalidate(): void
  destroy(): void
  stats(): RefractionStats
}

type Drawable = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement

interface Source {
  fit: HTMLElement
  slot: HTMLElement
  media: Drawable
}

/**
 * 装上折射层。返回句柄；调用方（WallpaperLayer）在卸载时 destroy()。
 *
 * 【为什么是「拉」不是「推」】参数、媒体状态、几何三样东西的变化源全在外面
 * （store / 壁纸状态机 / 布局），这里只在自己的节拍上把它们各读一遍。
 * 推送式（每个变化都调一次 update）会把「视频每帧都要重画」变成「谁在何时
 * 触发」的一堆调用点；节拍式把「多久重画一次」这件事收在几个常量里。
 */
export function installRefraction(deps: RefractionDeps): RefractionHandle {
  const stats: RefractionStats = {
    on: false,
    failed: false,
    mode: 'off',
    draws: 0,
    mapRebuilds: 0,
    lastDrawMs: 0,
    lastMapMs: 0,
    rects: 0,
    scale: 0,
    lastSkip: ''
  }
  let destroyed = false
  let failed = false
  let timer: number | null = null
  let visible = false

  // SVG 滤镜骨架（一次建好，之后只改属性）
  let svgEl: SVGSVGElement | null = null
  let feImageEl: SVGFEImageElement | null = null
  let blurEl: SVGFEGaussianBlurElement | null = null
  let dispEl: SVGFEDisplacementMapElement | null = null

  // 贴图（离屏画布，只在几何变化时重画）
  let mapCanvas: HTMLCanvasElement | null = null
  let mapCtx: CanvasRenderingContext2D | null = null
  let mapW = 0
  let mapH = 0
  let mapSig = ''

  // 节拍状态
  let nextAt = 0
  let nextDrawAt = 0
  let lastMeasureTs = -1e9
  let lastStaticKey = ''
  let idleStreak = 0
  let lastScaleAttr = ''
  let lastBlurAttr = ''

  const warnOnce = (err: unknown): void => {
    failed = true
    quiet()
    console.warn('[glass] refraction disabled:', err instanceof Error ? err.message : String(err))
  }

  /** 建一次 SVG 骨架。已存在（热重载/上次没卸干净）就先摘掉，避免同名 id 打架 */
  function ensureSvg(): void {
    if (svgEl && feImageEl && blurEl && dispEl) return
    document.getElementById(SVG_ID)?.remove()
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('id', SVG_ID)
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.setAttribute('aria-hidden', 'true')
    svg.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:hidden'
    const f = document.createElementNS(SVG_NS, 'filter')
    f.setAttribute('id', FILTER_ID)
    // 滤镜区域 = 元素自身（objectBoundingBox 默认单位），100% 表示整块画布
    f.setAttribute('x', '0')
    f.setAttribute('y', '0')
    f.setAttribute('width', '100%')
    f.setAttribute('height', '100%')
    // sRGB：默认的 linearRGB 会让位移值和通道值不成线性，位移量对不上
    f.setAttribute('color-interpolation-filters', 'sRGB')
    const img = document.createElementNS(SVG_NS, 'feImage')
    img.setAttribute('preserveAspectRatio', 'none')
    // ⚠️ 显式四件套缺一不可：exp3 的 E2 臂就是没写 width/height=100%，
    // 贴图只铺在左上角，整个实验因此读出「零效果」的假结论
    img.setAttribute('x', '0')
    img.setAttribute('y', '0')
    img.setAttribute('width', '100%')
    img.setAttribute('height', '100%')
    img.setAttribute('result', 'map')
    const blur = document.createElementNS(SVG_NS, 'feGaussianBlur')
    blur.setAttribute('in', 'SourceGraphic')
    blur.setAttribute('stdDeviation', '0')
    // edgeMode=duplicate：画布外没有像素，默认会采到透明 —— 贴着屏幕边的那圈
    //（顶条上缘、侧栏左缘）会糊出一条透明带。Chromium 认这个属性；不认也不致命，
    // 只是那圈磨砂弱一点（探针里有一条专门看它）。
    blur.setAttribute('edgeMode', 'duplicate')
    blur.setAttribute('result', 'frost')
    const disp = document.createElementNS(SVG_NS, 'feDisplacementMap')
    disp.setAttribute('in', 'frost')
    disp.setAttribute('in2', 'map')
    disp.setAttribute('xChannelSelector', 'R')
    disp.setAttribute('yChannelSelector', 'G')
    disp.setAttribute('scale', '0')
    disp.setAttribute('result', 'refr')
    const comp = document.createElementNS(SVG_NS, 'feComposite')
    comp.setAttribute('in', 'refr')
    comp.setAttribute('in2', 'map')
    comp.setAttribute('operator', 'in')
    f.append(img, blur, disp, comp)
    svg.appendChild(f)
    document.body.appendChild(svg)
    svgEl = svg
    feImageEl = img
    blurEl = blur
    dispEl = disp
  }

  function ensureMapCanvas(): void {
    const w = Math.max(1, Math.round(window.innerWidth * MAP_SCALE))
    const h = Math.max(1, Math.round(window.innerHeight * MAP_SCALE))
    if (mapCanvas && mapCtx && mapW === w && mapH === h) return
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('lens map 2d context unavailable')
    mapCanvas = c
    mapCtx = ctx
    mapW = w
    mapH = h
    mapSig = '' // 尺寸变了必须重画
  }

  /**
   * 镜像画布的**背衬尺寸**（CSS 尺寸由 wallpaper.css 的 `.wp-refract` 定成 100%）。
   *
   * 【必须显式设置，而且是每帧都要确认的】canvas 的 width/height 属性既决定
   * 背衬分辨率、也决定**坐标系**：src 里的 setTransform(MAP_SCALE...) 是把
   * 「CSS 像素」换算成背衬像素的，背衬尺寸一旦和视口脱钩，画出来的整块就是
   * 错的（半屏、拉伸、或干脆空白）。改窗口大小时浏览器**不会**自动改它 ——
   * 这一条就是那次「改完窗口镜像没跟上」的修法。
   * 顺带：赋 width/height 会清空画布，所以只在真的变了的时候赋值（见守卫）。
   */
  function ensureCanvasSize(): void {
    const cv = deps.canvas
    const w = Math.max(1, Math.round(window.innerWidth * MAP_SCALE))
    const h = Math.max(1, Math.round(window.innerHeight * MAP_SCALE))
    if (cv.width === w && cv.height === h) return
    cv.width = w
    cv.height = h
    lastStaticKey = '' // 背衬换了 = 上一帧内容没了，必须重画
  }

  /** 重建贴图（几何/环宽变了才走这里；强度与模糊都不进来） */
  function rebuildMap(rects: readonly LensRect[], p: GlassParams): void {
    if (!mapCtx || !feImageEl || !mapCanvas) return
    const t0 = performance.now()
    const px = lensMapPixels(
      rects,
      {
        ring: p.ring,
        // 归一化基准：真实强度由滤镜 scale 换算（见 LENS_MAP_UNIT 的论证）
        strength: LENS_MAP_UNIT,
        bottomBoost: 1.35,
        cornerBoost: 1.25,
        scale: MAP_SCALE
      },
      mapW,
      mapH
    )
    mapCtx.putImageData(new ImageData(px, mapW, mapH), 0, 0)
    feImageEl.setAttribute('href', mapCanvas.toDataURL('image/png'))
    stats.lastMapMs = Math.round((performance.now() - t0) * 10) / 10
    stats.mapRebuilds++
  }

  /** 当前矩形 + 环宽摊成签名：只有它变了才重画贴图 */
  const currentSig = (rects: readonly LensRect[], p: GlassParams): string =>
    `${rectsSignature(rects, mapW, mapH)}|r${Math.round(p.ring)}`

  /**
   * 强度 → 滤镜 scale（换算见 LENS_MAP_UNIT）。breath 是「流动」的呼吸系数。
   * 同值不重设：SVG 属性写一次就是一次滤镜重算，空闲节拍上白写会一直烧电。
   */
  function applyScale(p: GlassParams, breath: number): void {
    if (!dispEl) return
    const s = Math.max(0, p.strength) * breath * (255 / LENS_MAP_UNIT)
    const attr = s.toFixed(2)
    stats.scale = Math.round(s * 100) / 100
    if (attr === lastScaleAttr) return
    lastScaleAttr = attr
    dispEl.setAttribute('scale', attr)
  }

  function pushBlur(p: GlassParams): void {
    if (!blurEl) return
    const attr = Math.max(0, p.blur).toFixed(2)
    if (attr === lastBlurAttr) return
    lastBlurAttr = attr
    blurEl.setAttribute('stdDeviation', attr)
  }

  /** 画布的显示开关（关掉时连滤镜一起摘：没滤镜的镜像画布等于一层错的壁纸） */
  function show(on: boolean): void {
    if (on === visible) return
    visible = on
    deps.canvas.style.display = on ? '' : 'none'
    deps.canvas.style.filter = on ? `url(#${FILTER_ID})` : 'none'
    stats.on = on
  }

  /** 当前活着的那块镜像源：非 pending 槽位里的 .wp-fit */
  function findSource(): Source | null {
    const slots = document.querySelectorAll<HTMLElement>('.wallpaper-layer .wp-slot')
    for (const slot of slots) {
      if (slot.classList.contains('wp-slot--pending')) continue
      const fit = slot.querySelector<HTMLElement>('.wp-fit')
      if (!fit) continue
      const media = fit.querySelector<Drawable>('video, img, canvas')
      if (!media) continue
      return { fit, slot, media }
    }
    return null
  }

  function intrinsicOf(el: Drawable): [number, number] {
    if (el instanceof HTMLVideoElement) return [el.videoWidth, el.videoHeight]
    if (el instanceof HTMLImageElement) return [el.naturalWidth, el.naturalHeight]
    return [el.width, el.height]
  }

  /**
   * 重画镜像。返回 '' = 画好了；否则是一句「为什么没画」（进 stats.lastSkip，
   * 让探针能分辨「渲染坏了」和「压根没跑」——两者在截图上都是「没变化」）。
   */
  function drawSource(src: Source): string {
    const media = src.media
    if (media instanceof HTMLVideoElement && media.readyState < 2) return 'video-not-ready'
    const [iw, ih] = intrinsicOf(media)
    if (!iw || !ih) return 'no-intrinsic'

    const ctx = deps.canvas.getContext('2d')
    if (!ctx) throw new Error('mirror 2d context unavailable')

    const r = src.fit.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return 'zero-rect'
    const cs = getComputedStyle(src.fit)
    // ── 适配：object-fit 四档，逐项抄自 exp4 的 __e4drawVideo（F 臂验过）──
    const mode = getComputedStyle(media).objectFit
    let dw: number
    let dh: number
    if (mode === 'contain') {
      const s = Math.min(r.width / iw, r.height / ih)
      dw = iw * s
      dh = ih * s
    } else if (mode === 'fill') {
      dw = r.width
      dh = r.height
    } else if (mode === 'none') {
      dw = iw
      dh = ih
    } else {
      const s = Math.max(r.width / iw, r.height / ih)
      dw = iw * s
      dh = ih * s
    }
    // ── 翻转：applyFit 把 scale 写在 .wp-fit 上（负值 = 翻转）──
    const sc = cs.scale.split(' ')
    const sx = Number.parseFloat(sc[0] ?? '1')
    const syRaw = sc.length > 1 ? Number.parseFloat(sc[1]) : sx
    const sy = Number.isFinite(syRaw) ? syRaw : sx
    // ── 不透明度：fit × 槽位（过场期间槽位会淡入淡出，少乘一项就是一条硬边）──
    const opFit = Number.parseFloat(cs.opacity)
    const opSlot = Number.parseFloat(getComputedStyle(src.slot).opacity)
    const op = (Number.isFinite(opFit) ? opFit : 1) * (Number.isFinite(opSlot) ? opSlot : 1)
    // ── 滤镜：亮度/对比度/饱和度那一串写在 .wp-fit 上 ──
    const filt = cs.filter

    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    ctx.setTransform(MAP_SCALE, 0, 0, MAP_SCALE, 0, 0)
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
    ctx.save()
    ctx.globalAlpha = op <= 0 ? 0 : op > 1 ? 1 : op
    if (filt && filt !== 'none') ctx.filter = filt
    ctx.translate(cx, cy)
    ctx.scale(sx < 0 ? -1 : 1, sy < 0 ? -1 : 1)
    ctx.translate(-cx, -cy)
    ctx.drawImage(media, cx - dw / 2, cy - dh / 2, dw, dh)
    ctx.restore()
    stats.draws++
    return ''
  }

  /** 源是不是「在动」—— 动的才配 30fps 的节拍，静的降到轮询 */
  function isDynamic(src: Source): boolean {
    if (src.media instanceof HTMLVideoElement) return !src.media.paused && !src.media.ended
    return src.media instanceof HTMLCanvasElement
  }

  /**
   * 静态源的「身份」：换了图 / 换了适配 / **暂停的视频被拖了进度** 都得重画一次
   * （不靠每帧比对像素）。
   *
   * ⚠️ `currentTime` 必须在里面，这是 2026-10-08 实测踩到的坑：视频**暂停**时
   * isDynamic() 为 false，画不画**全看这个 key** —— 少写它，镜像就永久冻在它
   * 第一次画的那一帧上。真实症状极具误导性：暂停后拖进度条（或程序在播放前先
   * seek），真视频画面变了、面板底下还是老一帧；而第一帧常常是黑场，于是整块
   * 玻璃看上去「根本没画出来」，连种坏成纯品红都测不到变化（因为坏的是贴图，
   * 不是那帧黑镜像，而黑的镜像压在暗色面板下什么都看不出来）。
   *
   * 适配层的**观感**（不透明度 / 滤镜 / 缩放）也一并入 key：壁纸的亮度调节、
   * 过场淡入淡出都写在 .wp-fit 上，光看矩形和 URL 发现不了。
   */
  function staticKey(src: Source): string {
    const m = src.media
    const id =
      m instanceof HTMLImageElement
        ? m.currentSrc || m.src
        : m instanceof HTMLVideoElement
          ? m.currentSrc || String(m.src)
          : 'canvas'
    const t = m instanceof HTMLVideoElement ? m.currentTime.toFixed(3) : ''
    const r = src.fit.getBoundingClientRect()
    const cs = getComputedStyle(src.fit)
    return `${id}|${t}|${Math.round(r.width)}x${Math.round(r.height)}|${Math.round(r.left)},${Math.round(r.top)}|${cs.opacity}|${cs.scale}|${cs.filter}`
  }

  /**
   * 一个节拍。顺序刻意固定：先看要不要开 → 对齐画布尺寸 → 测几何 → 画
   * → 调强度/模糊 → 排下一拍。任何一步抛错都被 warnOnce 整体停用（见文件头）。
   */
  function tick(): void {
    if (destroyed || failed) return
    try {
      const now = performance.now()
      const p = deps.params()
      if (!p.refract || !deps.mediaShown()) {
        show(false)
        stats.mode = 'off'
        nextAt = now + TICK_IDLE_MS
        return
      }
      const src = findSource()
      if (!src) {
        show(false)
        stats.mode = 'off'
        nextAt = now + TICK_STATIC_MS
        return
      }
      show(true)
      ensureSvg()
      ensureMapCanvas()
      ensureCanvasSize()
      pushBlur(p)

      // ── 几何：节流测量，变了才重建贴图 ──
      if (now - lastMeasureTs >= MEASURE_MIN_GAP_MS) {
        lastMeasureTs = now
        const rects = measureLensRects(document)
        stats.rects = rects.length
        const sig = currentSig(rects, p)
        if (sig !== mapSig) {
          rebuildMap(rects, p)
          mapSig = sig
          idleStreak = 0
          lastStaticKey = '' // 几何变了，静态源也得重画一次
        }
      }

      // ── 流动：呼吸系数（flow=0 时恒 1，一次属性都不写）──
      let breath = 1
      if (p.flow > 0) {
        const ratio = p.flow / 100
        const amp = ratio * FLOW_AMP_MAX
        const period = FLOW_PERIOD_SLOW_MS - ratio * (FLOW_PERIOD_SLOW_MS - FLOW_PERIOD_FAST_MS)
        breath = 1 + amp * Math.sin((now / period) * Math.PI * 2)
      }

      const dynamic = isDynamic(src)
      // 动态源由节拍驱动，不必算 key（key 里有 getComputedStyle，别在 30fps 上跑）；
      // 静态源才靠 key 认「要不要重画」。动态期间把 key 留空 ⇒ 一停下来必重画一次，
      // 正好把暂停的那一帧锁死。
      const key = dynamic ? '' : staticKey(src)
      const needDraw = dynamic ? now >= nextDrawAt : key !== lastStaticKey
      if (needDraw) {
        const t0 = performance.now()
        stats.lastSkip = drawSource(src)
        lastStaticKey = key
        if (dynamic) nextDrawAt = now + TICK_DYNAMIC_MS
        // 只有真画了才记耗时，否则量到的是「没画」的速度（探针要读这个数）
        if (!stats.lastSkip) stats.lastDrawMs = Math.round((performance.now() - t0) * 10) / 10
      }
      applyScale(p, breath)

      // ── 排下一拍 ──
      if (stats.lastSkip && stats.draws === 0) {
        // 一次都没画成（媒体还没就位）：保持轮询等它
        stats.mode = 'static'
        idleStreak = 0
        nextAt = now + TICK_STATIC_MS
      } else if (dynamic) {
        stats.mode = 'dynamic'
        idleStreak = 0
        nextAt = now + TICK_DYNAMIC_MS
      } else if (p.flow > 0) {
        stats.mode = 'static'
        idleStreak = 0
        nextAt = now + FLOW_STEP_MS
      } else {
        idleStreak++
        const idle = idleStreak >= IDLE_AFTER
        stats.mode = idle ? 'idle' : 'static'
        nextAt = now + (idle ? TICK_IDLE_MS : TICK_STATIC_MS)
      }
    } catch (err) {
      warnOnce(err)
    }
  }

  function schedule(): void {
    if (destroyed || failed) return
    timer = window.setTimeout(() => {
      timer = null
      tick()
      schedule()
    }, Math.max(0, nextAt - performance.now()))
  }

  function quiet(): void {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
    show(false)
  }

  const handle: RefractionHandle = {
    sync(): void {
      if (destroyed || failed) return
      try {
        const p = deps.params()
        ensureSvg()
        pushBlur(p)
        stats.lastSkip = '' // 参数变了，允许立刻重画一次
        lastStaticKey = ''
      } catch (err) {
        warnOnce(err)
      }
    },
    invalidate(): void {
      if (destroyed || failed) return
      lastMeasureTs = -1e9
      lastStaticKey = ''
      idleStreak = 0
      nextAt = 0
    },
    destroy(): void {
      destroyed = true
      quiet()
      try {
        svgEl?.remove()
      } catch {
        /* 已经不在树上了 */
      }
      svgEl = null
      feImageEl = null
      blurEl = null
      dispEl = null
      mapCanvas = null
      mapCtx = null
    },
    stats(): RefractionStats {
      return { ...stats, failed }
    }
  }

  try {
    ensureSvg()
    pushBlur(deps.params())
    // 不在这里 show(true)：第一拍的 tick 会按 mediaShown() 决定，避免「挂载瞬间
    // 壁纸还没就位却先把镜像亮出来」闪一帧
  } catch (err) {
    warnOnce(err)
  }
  schedule()
  return handle
}
