/**
 * 自定义鼠标指针的**浏览器装配**（v7 模块六，2026-10-31）。
 *
 * 两条完全不同的显示路线，由素材种类决定：
 *
 *   ① **图片指针走 CSS**（和内置猫爪同一条路）：把图缩到 ≤128px、写成 data URL，
 *      塞进 `--mi-cursor-paw` / `--mi-cursor-paw-down`。这样文本光标、禁止符、
 *      拖拽光标那些"有信息量的手型"仍然按原样工作 —— 和内置猫爪的体验一致。
 *
 *   ② **视频指针走跟随浮层**：CSS 的 cursor 只能放图片，放不了视频。于是
 *      隐藏系统指针，用一个 `position:fixed; pointer-events:none` 的 `<video>`
 *      跟着鼠标走。代价写在设置页的提示里：文字光标/禁止符也会一起藏掉。
 *
 * 【为什么只要有一个槽位是视频，两个槽位都走浮层】
 * 系统指针只能整体藏或整体显示。一半 CSS、一半浮层的话，按下的瞬间要么
 * 出现两个指针（CSS 的猫爪 + 浮层视频），要么系统指针藏了之后常态指针
 * 凭空消失。统一走浮层至少保证"任何时刻都恰好有一个指针"。
 *
 * 【为什么图片要先过 canvas，而不是直接把 miai-wall:// 地址塞进 cursor】
 *   1. Chromium 对自定义指针有尺寸上限（约 128×128），超了**静默忽略**；
 *   2. 自动热点要扫 alpha 通道，必须拿到像素数据。
 * 缩放比例按归一化热点反算，所以存 0~1 的坐标在任何尺寸下都对得上。
 *
 * 【失败时退回什么】任何一个槽位加载失败 = 那半截退回内置猫爪（不报错、
 * 不占位、不闪），和 cursor.ts 里"没有素材"的既有语义完全一致。
 * 视频全部加载失败时，连"隐藏系统指针"也一并撤销 —— 绝不允许出现
 * "指针藏了、替代品没出来"这种把鼠标弄丢的状态。
 */
import { applyCursorAssets } from './cursor'
import {
  autoHotspot,
  cursorCssValue,
  CURSOR_IMAGE_MAX,
  fitSize,
  hotspotPx
} from './cursor-plan'
import type { CursorSlotView, CursorStateView } from '../../../shared/cursor'

/** 加载后的图片素材：src 可能是缩过的 data URL，也可能是原 miai-wall 地址 */
export interface CursorImageSource {
  src: string
  width: number
  height: number
  /** alpha 通道（扫热点用）；拿不到像素（跨源脏画布）时为 null */
  alpha: Uint8ClampedArray | null
}

/** 浮层里的一份素材（图片或视频） */
interface OverlayMedia {
  el: HTMLImageElement | HTMLVideoElement
  width: number
  height: number
  /** 归一化热点 */
  hotspot: { x: number; y: number }
}

interface Overlay {
  layer: HTMLDivElement
  destroy: () => void
}

let currentState: CursorStateView | null = null
let loadedOnce = false
let inflight: Promise<CursorStateView | null> | null = null
let generation = 0
let overlay: Overlay | null = null

/** 最近一次读到的状态（设置页首次渲染直接用它，省一次 IPC） */
export function cursorStateNow(): CursorStateView | null {
  return currentState
}

/**
 * 读一次主进程状态并应用。应用失败只留日志 —— 这是外观功能，
 * 读不到就用内置猫爪，不应该把启动流程拖垮。
 */
export async function refreshCustomCursor(): Promise<CursorStateView | null> {
  try {
    const state = await window.miai.cursor.get()
    await applyCustomCursorState(state)
    return state
  } catch (err) {
    console.warn('[cursor] custom cursor load failed:', err)
    return null
  }
}

/** 设置页首次打开用：有缓存就返回缓存，没有才真去读一次 */
export async function ensureCustomCursor(): Promise<CursorStateView | null> {
  if (loadedOnce) return currentState
  if (!inflight) {
    inflight = refreshCustomCursor().finally(() => {
      inflight = null
    })
  }
  return inflight
}

/**
 * 启动时调用一次：异步读状态并应用，**不等待**（main.ts 在 mount 前调它）。
 *
 * 不返回 Promise 是故意的：调用方没有任何"指针装好之后再做什么"的后续动作，
 * 返回 Promise 只会诱导别人去 await —— 那会把首屏挂起一次 IPC + 图片解码，
 * 换来的只是"早几十毫秒出现的指针"，完全不值。
 *
 * 走 ensureCustomCursor 而不是直接 refresh：设置页可能在同一瞬间挂载，
 * 两边共享同一次读取（省一条 IPC，也避免两次应用互相盖）。
 * 失败在内部消化（内置猫爪继续用），不比内置状态更差。
 */
export function installCustomCursor(): void {
  void ensureCustomCursor()
}

/** 应用一份状态（启动时、以及设置页每次写成功之后都走这里） */
export async function applyCustomCursorState(state: CursorStateView): Promise<void> {
  currentState = state
  loadedOnce = true
  const gen = ++generation

  // 先把上一轮的浮层拆干净，并把 CSS 变量还原成内置猫爪 ——
  // 之后两条路线各自只覆盖自己需要的部分。
  if (overlay) {
    overlay.destroy()
    overlay = null
  }
  delete document.documentElement.dataset.cursorMode
  applyCursorAssets()

  const useOverlay = state.normal?.kind === 'video' || state.click?.kind === 'video'
  if (!useOverlay) {
    const [up, down] = await Promise.all([
      state.normal ? nativeImageCursor(state.normal) : Promise.resolve(null),
      state.click ? nativeImageCursor(state.click) : Promise.resolve(null)
    ])
    if (gen !== generation) return
    if (up) document.documentElement.style.setProperty('--mi-cursor-paw', up)
    if (down) document.documentElement.style.setProperty('--mi-cursor-paw-down', down)
    return
  }

  await ensureBody()
  if (gen !== generation) return

  const upView = effectiveView(state, false)
  const downView = effectiveView(state, true)
  const up = upView ? await buildMedia(upView) : null
  if (gen !== generation) {
    disposeMedia(up)
    return
  }
  const down = downView ? await buildMedia(downView) : null
  if (gen !== generation) {
    disposeMedia(up)
    disposeMedia(down)
    return
  }

  let upFinal = up
  let downFinal = down
  if (!upFinal && !downFinal) {
    // 视频/图片全都加载失败：撤销"隐藏系统指针"，回到内置猫爪。
    // （上面已经 applyCursorAssets 还原过变量，这里只需不挂浮层。）
    console.warn('[cursor] overlay media failed to load, falling back to native cursor')
    return
  }
  if (!upFinal) upFinal = downFinal!
  if (!downFinal) downFinal = upFinal!

  overlay = createOverlay(upFinal, downFinal)
  document.documentElement.dataset.cursorMode = 'overlay'
}

/**
 * 某个状态该用哪个槽位：优先自己的；自己没设置就借另一个。
 *
 * 「点击槽位空着」时按下仍然显示常态素材 —— 比"按下的瞬间指针消失"合理得多。
 * 反方向（只有点击槽位）同理：平常也显示那一个，至少鼠标一直看得见。
 */
function effectiveView(state: CursorStateView, pressed: boolean): CursorSlotView | null {
  return pressed ? state.click ?? state.normal : state.normal ?? state.click
}

// ---------------------------------------------------------------- 图片路线

function loadImageElement(url: string, anonymous: boolean): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    // 跨源（miai-wall:// 是独立 origin）读像素必须走 CORS。协议的响应带
    // `Access-Control-Allow-Origin: *`，所以预检会过；万一没过，下面还有
    // 一次不带 crossOrigin 的重试（那时只能拿尺寸，扫不了 alpha）。
    if (anonymous) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/**
 * 把一张指针图缩到 ≤128px；能读像素就顺手把 alpha 通道带出来。
 *
 * 浏览器解码失败（文件其实不是图片 / 编码坏了）返回 null ——
 * 调用方按"这个槽位没设置"处理，退回内置猫爪。
 *
 * 设置页的预览也走这一份（同一个缩放与热点算法），
 * 保证"预览里看到的落点"和"真正装上去的落点"是同一个数。
 */
export async function loadCursorImage(url: string): Promise<CursorImageSource | null> {
  const img =
    (await loadImageElement(url, true)) ?? (await loadImageElement(url, false))
  if (!img) return null
  const size = fitSize(img.naturalWidth, img.naturalHeight, CURSOR_IMAGE_MAX, false)
  if (size.width === 0) return null

  try {
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas context')
    ctx.drawImage(img, 0, 0, size.width, size.height)
    const data = ctx.getImageData(0, 0, size.width, size.height).data
    const src = canvas.toDataURL('image/png')
    return { src, width: size.width, height: size.height, alpha: data }
  } catch {
    // 脏画布 / 没有 canvas：只要原图本来就在 128 以内，仍可直接用原地址。
    // （超过上限的图浏览器会静默忽略，不如老实退回内置猫爪。）
    const natural = fitSize(img.naturalWidth, img.naturalHeight, CURSOR_IMAGE_MAX, false)
    const tooBig = img.naturalWidth > CURSOR_IMAGE_MAX || img.naturalHeight > CURSOR_IMAGE_MAX
    if (tooBig || natural.width === 0) return null
    return {
      src: url,
      width: img.naturalWidth,
      height: img.naturalHeight,
      alpha: null
    }
  }
}

/** 图片指针的 CSS 值；加载失败 → null（调用方保持内置猫爪） */
async function nativeImageCursor(view: CursorSlotView): Promise<string | null> {
  const source = await loadCursorImage(view.url)
  if (!source) return null
  const spot = hotspotPx(
    view.hotspot ?? autoHotspot(source.alpha, source.width, source.height),
    source.width,
    source.height
  )
  return cursorCssValue(source.src, spot.x, spot.y)
}

// ---------------------------------------------------------------- 视频路线

function waitForVideo(video: HTMLVideoElement, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      video.removeEventListener('loadedmetadata', onReady)
      video.removeEventListener('error', onError)
      resolve(ok)
    }
    const onReady = (): void => finish(video.videoWidth > 0 && video.videoHeight > 0)
    const onError = (): void => finish(false)
    const timer = setTimeout(() => finish(false), timeoutMs)
    video.addEventListener('loadedmetadata', onReady)
    video.addEventListener('error', onError)
  })
}

function disposeMedia(media: OverlayMedia | null): void {
  if (!media) return
  if (media.el instanceof HTMLVideoElement) {
    media.el.pause()
    media.el.removeAttribute('src')
    media.el.load()
  }
  media.el.remove()
}

async function buildMedia(view: CursorSlotView): Promise<OverlayMedia | null> {
  if (view.kind === 'video') {
    const video = document.createElement('video')
    video.muted = true
    video.loop = true
    video.autoplay = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = view.url
    const ready = await waitForVideo(video)
    if (!ready) {
      video.removeAttribute('src')
      video.load()
      return null
    }
    const size = fitSize(video.videoWidth, video.videoHeight, CURSOR_IMAGE_MAX)
    if (size.width === 0) return null
    video.style.width = `${size.width}px`
    video.style.height = `${size.height}px`
    void video.play().catch(() => {
      // 自动播放被拦（例如省电模式）：静帧也比没有强，不打断后续流程
    })
    return {
      el: video,
      width: size.width,
      height: size.height,
      hotspot: view.hotspot ?? { x: 0.5, y: 0.5 }
    }
  }

  const source = await loadCursorImage(view.url)
  if (!source) return null
  const img = document.createElement('img')
  img.src = source.src
  img.draggable = false
  img.style.width = `${source.width}px`
  img.style.height = `${source.height}px`
  return {
    el: img,
    width: source.width,
    height: source.height,
    hotspot: view.hotspot ?? autoHotspot(source.alpha, source.width, source.height)
  }
}

function ensureBody(): Promise<void> {
  if (document.body) return Promise.resolve()
  return new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', () => resolve(), { once: true })
  })
}

/**
 * 建立跟随浮层。返回的对象负责三件事：跟鼠标、按下时换素材、销毁时
 * 把监听器和视频解码一起收干净（视频不 release 的话，Windows 上会占着
 * 文件句柄，用户清空指针后文件删不掉）。
 */
function createOverlay(up: OverlayMedia, down: OverlayMedia): Overlay {
  const layer = document.createElement('div')
  layer.className = 'mi-cursor-overlay'
  layer.setAttribute('aria-hidden', 'true')
  layer.style.cssText =
    'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647;display:none;'

  const same = up === down
  const elements = same ? [up.el] : [up.el, down.el]
  for (const el of elements) {
    el.style.position = 'absolute'
    el.style.left = '0'
    el.style.top = '0'
    el.style.pointerEvents = 'none'
    el.style.display = same || el === up.el ? 'block' : 'none'
    layer.appendChild(el)
  }
  document.body.appendChild(layer)

  let pressed = false
  let visible = false
  let lastX = 0
  let lastY = 0

  const active = (): OverlayMedia => (pressed ? down : up)

  const place = (): void => {
    const media = active()
    const spot = hotspotPx(media.hotspot, media.width, media.height)
    media.el.style.transform = `translate3d(${lastX - spot.x}px, ${lastY - spot.y}px, 0)`
  }

  const swap = (): void => {
    if (!same) {
      up.el.style.display = pressed ? 'none' : 'block'
      down.el.style.display = pressed ? 'block' : 'none'
    }
    const video = active().el
    if (video instanceof HTMLVideoElement) void video.play().catch(() => {})
    place()
  }

  const showAt = (x: number, y: number): void => {
    lastX = x
    lastY = y
    if (!visible) {
      visible = true
      layer.style.display = 'block'
      swap()
      return
    }
    place()
  }

  const hide = (): void => {
    visible = false
    layer.style.display = 'none'
  }

  const onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return
    showAt(e.clientX, e.clientY)
  }
  const onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return
    showAt(e.clientX, e.clientY)
    pressed = true
    swap()
  }
  const onUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return
    pressed = false
    swap()
  }
  const onCancel = (): void => {
    pressed = false
    swap()
  }
  const onLeave = (): void => hide()
  const onEnter = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') showAt(e.clientX, e.clientY)
  }
  const onBlur = (): void => {
    pressed = false
    hide()
  }

  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerdown', onDown, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onCancel, true)
  document.documentElement.addEventListener('pointerleave', onLeave)
  document.documentElement.addEventListener('pointerenter', onEnter)
  window.addEventListener('blur', onBlur)

  return {
    layer,
    destroy: () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onCancel, true)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      document.documentElement.removeEventListener('pointerenter', onEnter)
      window.removeEventListener('blur', onBlur)
      disposeMedia(up)
      if (!same) disposeMedia(down)
      layer.remove()
    }
  }
}
