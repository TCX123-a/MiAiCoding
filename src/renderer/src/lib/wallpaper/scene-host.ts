// 场景沙箱宿主（P0 壁纸沙盒逃逸，方案 B）。
//
// 这个模块**只**在 `sandbox="allow-scripts"` 的 iframe 里跑（opaque origin）：
// webwallgl 引擎、场景脚本（new Function）、canvas 全部关在这份文档里，场景
// 拿不到父页面的 DOM / preload / IPC。父页面（engine.ts 的 SceneFrame 代理）
// 通过 postMessage 喂它参数、指针、频谱，并把它当 SceneInstance 用。
//
// 三条实测定论（2026-10-31，_iframe-engine-prototype）：
//  · 引擎能在这个沙箱里挂真场景并跑满 60fps（3840x2160 / 55 层 / 粒子）。
//  · `caches` 的 getter 在沙箱上下文里**读一下就抛** SecurityError，而引擎的
//    可选烘焙缓存用 `typeof caches !== "undefined"` 探测 —— 不先摘掉，
//    整个 mount 会以一条被吞掉的 DOMException 失败。引擎自己的
//    installOpaqueOriginFallbacks 兜了 localStorage/sessionStorage/cookie，
//    **故意不兜 caches**（假成功比抛错危险），所以这里把它定义成 undefined，
//    让引擎选内存后端 —— 这不是伪装成功，是让它走它自己的降级分支。
//  · 这个 iframe 在祖先 opacity:0 时 rAF 不跑（挂载照样 resolve）；转正后
//    自动恢复 60fps。预热的场景本来就会被 pause()，两边行为一致。
//
// 消息面（父 → 这里）：
//   init（一次）  dir/fit/fps/quality/mountTimeoutMs/audio
//   ptr           u/v/buttons/mods（60Hz，无 id）
//   audio         left/right Float32Array（30Hz，无 id）
//   mirror        开/关画面回传（液态玻璃取样用）
//   cmd           { id, op, args }，op = pause/resume/setFit/setFps/setVolume/
//                 setQuality/setProperties/setAudio/pushWheel/destroy/...
// 这边 → 父：
//   boot / ready / fail / diag / stats / frame / reply

import type {
  AudioSource,
  DiagnosticLevel,
  Fit,
  PropertyValue,
  QualityOptions,
  SceneInstance,
  SceneInfo
} from 'webwallgl'

type InitMessage = {
  t: 'init'
  dir: string
  fit: Fit
  fps: number
  quality?: QualityOptions
  mountTimeoutMs: number
  audio: boolean
}

type CmdMessage = { t: 'cmd'; id: number; op: string; args?: unknown }

type InMessage = InitMessage | CmdMessage | { t: 'ptr' } | { t: 'audio' } | { t: 'mirror' }

const ZERO_AUDIO = { left: new Float32Array(64), right: new Float32Array(64) }

function post(message: Record<string, unknown>, transfer?: Transferable[]): void {
  try {
    parent.postMessage(message, '*', transfer ?? [])
  } catch {
    // 父窗口已经走了：这条消息没有意义，吞掉
  }
}

function warn(message: string, level: DiagnosticLevel = 'warn'): void {
  post({ t: 'diag', msg: message, level })
}

// ── 必须在引擎 import 之前 ────────────────────────────────────────────────
// 沙箱 opaque origin 里 window.caches 的 getter 抛 SecurityError（读一下就抛），
// 引擎的烘焙缓存探测在挂载早期就会摸到它。定义成 undefined 即可让它走内存分支。
try {
  Object.defineProperty(window, 'caches', { value: undefined, configurable: true })
} catch {
  // 定义不上就只能在 mount 失败时把原因报到父页面（fail 消息带 stack）
}

let inst: SceneInstance | null = null
let started = false
let latestAudio: { left: Float32Array; right: Float32Array } | null = null
let mirrorWanted = false
let mirrorTimer: number | null = null
let mirrorBusy = false
let mirrorCanvas: HTMLCanvasElement | null = null
let mirrorCtx: CanvasRenderingContext2D | null = null
let statsTimer: number | null = null

/** 指针/音频是热路径：不带 id、不回执，丢了下一帧再推。 */
function onHotMessage(d: { t: string } & Record<string, unknown>): void {
  if (!inst) return
  try {
    if (d.t === 'ptr') {
      inst.pushPointer(d.u as number, d.v as number, d.buttons as number, d.mods as number)
    } else if (d.t === 'audio') {
      latestAudio = { left: d.left as Float32Array, right: d.right as Float32Array }
    } else if (d.t === 'mirror') {
      mirrorWanted = d.on === true
      syncMirror()
    }
  } catch {
    // 单帧推送失败无补救；下一帧照推（与父页面既有的 pushPointerAll 同纪律）
  }
}

/** 画面回传：0.5 缩放 2D 快照 → ImageBitmap → transfer 给父页面。
 *  只在「父页面要（玻璃折射开着）且没暂停」时跑；一次 0.14ms（实测本机）。 */
function syncMirror(): void {
  // 暂停的场景不产生新帧 —— 回传只是重复同一张图，关掉省电（玻璃那一层
  // 会继续用最后一张静帧，正是暂停该有的样子）
  const want = mirrorWanted && !!inst && !inst.paused
  if (want && mirrorTimer === null) {
    mirrorTimer = window.setInterval(() => void pumpMirror(), 33)
  } else if (!want && mirrorTimer !== null) {
    window.clearInterval(mirrorTimer)
    mirrorTimer = null
  }
}

async function pumpMirror(): Promise<void> {
  if (mirrorBusy || !inst) return
  mirrorBusy = true
  try {
    const source = inst.canvas
    if (!mirrorCanvas) {
      mirrorCanvas = document.createElement('canvas')
      mirrorCtx = mirrorCanvas.getContext('2d')
    }
    const w = Math.max(1, Math.round(window.innerWidth * 0.5))
    const h = Math.max(1, Math.round(window.innerHeight * 0.5))
    if (mirrorCanvas.width !== w || mirrorCanvas.height !== h) {
      mirrorCanvas.width = w
      mirrorCanvas.height = h
    }
    if (!mirrorCtx) throw new Error('mirror 2d context unavailable')
    mirrorCtx.drawImage(source, 0, 0, w, h)
    const bmp = await createImageBitmap(mirrorCanvas)
    post({ t: 'frame', bmp }, [bmp])
  } catch (err) {
    // 回传坏了不许拖累场景本体：关掉并报一条诊断（父页面会自己停止等待）
    mirrorWanted = false
    if (mirrorTimer !== null) {
      window.clearInterval(mirrorTimer)
      mirrorTimer = null
    }
    warn(`scene mirror disabled: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    mirrorBusy = false
  }
}

function makeAudioSource(): AudioSource {
  return {
    // 引擎每帧拉一次；父页面以 30Hz 推，和主进程里 audioCapture 的节拍一致
    snapshot: () => latestAudio ?? ZERO_AUDIO
  }
}

async function start(d: InitMessage): Promise<void> {
  if (started) return
  started = true
  let mod: typeof import('webwallgl')
  try {
    mod = await import('webwallgl')
  } catch (err) {
    post({ t: 'fail', stage: 'import', message: String(err instanceof Error ? err.stack || err.message : err) })
    return
  }
  const t0 = performance.now()
  let mounted: SceneInstance
  try {
    mounted = await mod.mount(document.body, {
      source: mod.httpSource(d.dir),
      fit: d.fit,
      fps: d.fps,
      // 与 engine.ts 的既有口径逐字一致：volume 只是静音布尔，真实音量走
      // setVolume；renderDpr 0 = 跟随设备；autoQuality 恒开。
      volume: 0,
      autoplay: true,
      renderDpr: 0,
      autoQuality: true,
      mountTimeoutMs: d.mountTimeoutMs,
      ...(d.quality ? { quality: d.quality } : {}),
      // null = 零频谱（不传键会回落内置模拟源自嗨，见 engine.ts 的注释）
      audio: d.audio ? makeAudioSource() : null,
      onDiagnostic: (msg: string, level: DiagnosticLevel) => {
        post({ t: 'diag', msg: String(msg), level })
      }
    })
  } catch (err) {
    // 半成品实例由引擎挂在 err.instance 上；沙箱文档马上会被父页面移除，
    // 这里显式 destroy 一次是为了让引擎自己的 pkg 缓存/监听先松手。
    const salvage = (err as { instance?: SceneInstance } | null)?.instance
    if (salvage) {
      try {
        salvage.destroy({ releasePkgCache: true })
      } catch {
        /* 半成品状态不保证完整 */
      }
    }
    post({
      t: 'fail',
      stage: 'mount',
      message: String(err instanceof Error ? err.stack || err.message : err),
      mountMs: Math.round(performance.now() - t0)
    })
    return
  }
  inst = mounted
  const info: SceneInfo | null = mounted.info ? { ...mounted.info } : null
  post({
    t: 'ready',
    mountMs: Math.round(performance.now() - t0),
    info,
    quality: mounted.getQuality()
  })
  // 4Hz 镜像：父页面的 snapshotStats 读的是这份缓存（引擎自己的 fps 就是在
  // 一秒窗口上算的，250ms 粒度足够，且不让同步 API 变成异步）
  statsTimer = window.setInterval(() => {
    if (!inst) return
    post({
      t: 'stats',
      stats: { fps: inst.stats.fps, running: inst.stats.running },
      paused: inst.paused,
      quality: inst.getQuality()
    })
  }, 250)
  syncMirror()
}

function callCmd(d: CmdMessage): void {
  if (!inst) {
    post({ t: 'reply', id: d.id, ok: false, message: 'not-ready' })
    return
  }
  const a = (d.args ?? {}) as Record<string, unknown>
  try {
    switch (d.op) {
      case 'pause':
        inst.pause()
        break
      case 'resume':
        inst.resume()
        break
      case 'setFit':
        inst.setFit(a.fit as Fit)
        break
      case 'setFps':
        inst.setFps(a.fps as number)
        break
      case 'setVolume':
        inst.setVolume(a.volume as number)
        break
      case 'setQuality':
        inst.setQuality((a.patch ?? {}) as QualityOptions)
        break
      case 'setProperties':
        inst.setProperties((a.props ?? {}) as Record<string, PropertyValue>)
        break
      case 'pushWheel':
        inst.pushWheel(a.dx as number, a.dy as number, a.mode as number, a.mods as number)
        break
      case 'destroy':
        inst.destroy({ releasePkgCache: true })
        inst = null
        if (statsTimer !== null) window.clearInterval(statsTimer)
        statsTimer = null
        syncMirror()
        break
      default:
        post({ t: 'reply', id: d.id, ok: false, message: `unknown-op:${d.op}` })
        return
    }
    if (d.op === 'pause' || d.op === 'resume') syncMirror()
    post({ t: 'reply', id: d.id, ok: true, paused: inst ? inst.paused : true })
  } catch (err) {
    post({ t: 'reply', id: d.id, ok: false, message: String(err instanceof Error ? err.message : err) })
  }
}

window.addEventListener('message', (ev: MessageEvent<InMessage>) => {
  const d = ev.data
  if (!d || typeof d !== 'object') return
  if (d.t === 'init') {
    void start(d as InitMessage)
    return
  }
  if (d.t === 'cmd') {
    callCmd(d as CmdMessage)
    return
  }
  onHotMessage(d as { t: string } & Record<string, unknown>)
})

window.addEventListener('error', (ev) => {
  warn(`sandbox error: ${String(ev.message || ev.error || '')}`, 'error')
})

// 先装监听再报 boot：父页面收到 boot 才发 init，避免初始化消息抢跑。
post({ t: 'boot' })
