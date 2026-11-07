// 场景沙箱的父页代理（P0 壁纸沙盒逃逸，方案 B 的父侧一半）。
//
// 形状：`mountScene()` 在 `.wp-fit` 里放一个 `sandbox="allow-scripts"` 的
// iframe（opaque origin），引擎与场景脚本全部跑在里面；再把它的
// postMessage 通道包成一个 **SceneInstance 形状的代理** 交还上层。上层
// （WallpaperLayer）一行不用改语义 —— 它看到的仍是一个 SceneInstance。
//
// 为什么不是 OffscreenCanvas（原方案 B 的设想）：实测把 OffscreenCanvas
// transfer 进任何跨源/sandbox iframe 都会当场杀掉渲染进程
// （`bad Mojo message ... Invalid client ID`，_offscreen-sandbox-prototype 四臂
// 矩阵复现）。iframe 自己持有 canvas 是唯一可行且不降性能的形状：真场景
// 55 层 60fps 实测通过（_iframe-engine-prototype）。
//
// 液态玻璃的取样：跨源 canvas 父页面读不到像素，但读得到 ImageBitmap。
// 沙箱按 0.5 缩放（与 refraction.ts 的 MAP_SCALE 同口径）每 33ms 回传一张，
// 父页面画进 `.wp-fit` 里的**隐藏镜像 canvas**；refraction 的 findSource 本来
// 就收 `canvas`，数学逐项不变（相同宽高比 ⇒ cover/contain 的 dw/dh 完全一致）。
// 只有玻璃折射开着时才启用（WallpaperLayer 的 setMirror 门控），关着零开销。
//
// 指针/音频：槽位链是 pointer-events:none，父页面本来就在 window 上收事件；
// 现在只是把这些值与 audioCapture 的频谱快照转进沙箱（30Hz，与采集节拍同频）。

import type {
  AudioSource,
  DiagnosticLevel,
  Fit,
  FrameStats,
  PropertyValue,
  QualityOptions,
  ResolvedQuality,
  SceneInfo,
  SceneInstance
} from 'webwallgl'

export interface SceneFrameOpts {
  /** 挂载点（`.wp-fit`） */
  el: HTMLElement
  /** 沙箱文档 URL（生产 miai-scene://s/scene-sandbox.html；dev 同源 http） */
  htmlUrl: string
  /** 场景目录的 miai-wall:// 基址 */
  dirUrl: string
  fit: Fit
  fps: number
  quality?: QualityOptions
  mountTimeoutMs: number
  /** null = 零频谱（引擎语义） */
  audio: AudioSource | null
  onDiagnostic?: (msg: string, level: DiagnosticLevel) => void
}

export interface SceneFrame {
  /** 沙箱就绪（引擎 mount 已 resolve）。失败时 reject。 */
  ready: Promise<SceneInstance>
  /** 液态玻璃取样的开关（父页面按玻璃折射设置调） */
  setMirror(on: boolean): void
  /**
   * 已收到的镜像帧数（只增）。玻璃面板发白时用它分辨「沙箱压根没回传」
   * 与「回传了但配色/贴图错了」—— 两者的截图都是「没变化」。
   */
  mirrorFrames(): number
  dispose(): void
}

/** 生产走特权协议；dev 走 Vite 的同源 HTTP（sandbox 属性照样给 opaque origin） */
export function sceneSandboxUrl(): string {
  if (location.protocol === 'file:') return 'miai-scene://s/scene-sandbox.html'
  return new URL('scene-sandbox.html', location.href).toString()
}

/** 引擎 Fit → 镜像 canvas 的 object-fit（refraction 读的是计算样式） */
function fitCss(fit: Fit): string {
  return fit === 'stretch' ? 'fill' : fit
}

export function createSceneFrame(opts: SceneFrameOpts): SceneFrame {
  let disposed = false
  let settled = false
  let pausedState = false
  let infoState: SceneInfo | null = null
  let qualityState: ResolvedQuality = {
    antiAliasing: 'off',
    particles: opts.quality?.particles ?? 'high',
    postProcessing: opts.quality?.postProcessing ?? 'high'
  }
  let audioSrc: AudioSource | null = opts.audio
  let audioTimer: number | null = null
  let mirrorWanted = false
  let mirrorCount = 0
  let seq = 0

  const stats: FrameStats = { fps: 0, running: false }

  let resolveReady!: (inst: SceneInstance) => void
  let rejectReady!: (err: Error) => void
  const ready = new Promise<SceneInstance>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  // 调用方一定 await；这里再挂一个空 catch，防「还没 await 就被 dispose」
  // 变成未处理拒绝（浏览器会打一条吓人的 console 错误）。
  ready.catch(() => {})

  // ── DOM：隐藏镜像 canvas + 沙箱 iframe，都铺满 .wp-fit ──────────────────
  const mirror = document.createElement('canvas')
  mirror.className = 'wp-scene-mirror'
  mirror.setAttribute('aria-hidden', 'true')
  mirror.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;visibility:hidden;pointer-events:none;' +
    `object-fit:${fitCss(opts.fit)};object-position:center`
  // 第一帧回传之前的固有尺寸：与 0.5 缩放的镜像同宽高比，折射数学不会先抖一下
  mirror.width = Math.max(1, Math.round(window.innerWidth * 0.5))
  mirror.height = Math.max(1, Math.round(window.innerHeight * 0.5))
  const mirrorCtx = mirror.getContext('2d')

  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts')
  // 场景 BGM 走 WebAudio：跨源 iframe 默认拿不到 autoplay 权限
  iframe.setAttribute('allow', 'autoplay')
  iframe.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;border:0;display:block;' +
    'background:#000;pointer-events:none'

  opts.el.appendChild(mirror)
  opts.el.appendChild(iframe)

  function send(op: string, args?: unknown): void {
    if (disposed) return
    try {
      iframe.contentWindow?.postMessage({ t: 'cmd', id: ++seq, op, args }, '*')
    } catch {
      // 文档已经没了：后续调用会在 disposed 上短路
    }
  }

  function startAudio(): void {
    if (audioTimer !== null || !audioSrc) return
    audioTimer = window.setInterval(() => {
      const src = audioSrc
      if (!src || disposed) return
      try {
        const snap = src.snapshot()
        // 拷贝再 transfer：audioCapture 复用同一对 Float32Array，直接转移会把
        // 它的缓冲区 detach 掉（宿主下一帧就推不出数据了）。
        const left = new Float32Array(snap.left)
        const right = new Float32Array(snap.right)
        iframe.contentWindow?.postMessage({ t: 'audio', left, right }, '*', [left.buffer, right.buffer])
      } catch {
        // 单帧失败无补救；下一拍照推
      }
    }, 33)
  }

  function stopAudio(): void {
    if (audioTimer !== null) {
      window.clearInterval(audioTimer)
      audioTimer = null
    }
  }

  function drawFrame(bmp: ImageBitmap): void {
    try {
      if (mirror.width !== bmp.width || mirror.height !== bmp.height) {
        mirror.width = bmp.width
        mirror.height = bmp.height
      }
      mirrorCtx?.drawImage(bmp, 0, 0)
    } catch {
      // 一帧画不上不影响下一帧
    } finally {
      try {
        bmp.close()
      } catch {
        /* 已经关了 */
      }
    }
  }

  const inst = {
    canvas: mirror,
    pause(): void {
      pausedState = true
      send('pause')
    },
    resume(): void {
      pausedState = false
      send('resume')
    },
    get paused(): boolean {
      return pausedState
    },
    setFit(fit: Fit): void {
      mirror.style.objectFit = fitCss(fit)
      send('setFit', { fit })
    },
    setFps(fps: number): void {
      send('setFps', { fps })
    },
    setVolume(volume: number): void {
      send('setVolume', { volume })
    },
    setRenderDpr(dpr: number): void {
      send('setRenderDpr', { dpr })
    },
    setQuality(patch: QualityOptions): void {
      qualityState = { ...qualityState, ...patch }
      send('setQuality', { patch })
    },
    setVideoTexScale(scale: number): void {
      send('setVideoTexScale', { scale })
    },
    getVideoTexScale(): number {
      return 0
    },
    setOcclusion(payload: unknown): void {
      send('setOcclusion', { payload })
    },
    getQuality(): ResolvedQuality {
      return qualityState
    },
    setProperties(props: Record<string, PropertyValue>): void {
      send('setProperties', { props })
    },
    getProperties(): Record<string, PropertyValue> {
      // 调用方（WallpaperLayer）从不读回；属性表留在沙箱里才是唯一真相。
      return {}
    },
    setAudio(src: AudioSource | null): void {
      audioSrc = src
      if (src) startAudio()
      else stopAudio()
    },
    setMedia(): void {
      // 本应用不接系统媒体源（WallpaperLayer 从不调用）；留空实现保持接口形状
    },
    media: {},
    pushPointer(u: number, v: number, buttons = 0, mods = 0): void {
      if (disposed) return
      try {
        iframe.contentWindow?.postMessage({ t: 'ptr', u, v, buttons, mods }, '*')
      } catch {
        /* 下一帧再推 */
      }
    },
    pointerLeave(): void {
      if (disposed) return
      try {
        iframe.contentWindow?.postMessage({ t: 'cmd', id: ++seq, op: 'pointerLeave' }, '*')
      } catch {
        /* 忽略 */
      }
    },
    pushWheel(dx: number, dy: number, mode = 0, mods = 0): void {
      send('pushWheel', { dx, dy, mode, mods })
    },
    load(): Promise<void> {
      return Promise.reject(new Error('scene proxy does not support load'))
    },
    release(): void {
      send('release')
    },
    restore(): void {
      send('restore')
    },
    destroy(): void {
      dispose()
    },
    get stats(): FrameStats {
      return stats
    },
    get info(): SceneInfo | null {
      return infoState
    },
    on(): () => void {
      return () => {}
    }
  } as unknown as SceneInstance

  function sendInit(): void {
    try {
      iframe.contentWindow?.postMessage(
        {
          t: 'init',
          dir: opts.dirUrl,
          fit: opts.fit,
          fps: opts.fps,
          quality: opts.quality,
          mountTimeoutMs: opts.mountTimeoutMs,
          audio: audioSrc !== null
        },
        '*'
      )
    } catch (err) {
      rejectReady(err instanceof Error ? err : new Error(String(err)))
    }
  }

  function onMessage(ev: MessageEvent): void {
    if (ev.source !== iframe.contentWindow) return
    const d = ev.data as Record<string, unknown> | null
    if (!d || typeof d !== 'object') return
    switch (d.t) {
      case 'boot':
        sendInit()
        break
      case 'ready': {
        infoState = (d.info as SceneInfo | null) ?? null
        if (d.quality) qualityState = d.quality as ResolvedQuality
        pausedState = false
        if (mirrorWanted) {
          try {
            iframe.contentWindow?.postMessage({ t: 'mirror', on: true }, '*')
          } catch {
            /* 忽略 */
          }
        }
        if (audioSrc) startAudio()
        settled = true
        resolveReady(inst)
        break
      }
      case 'fail': {
        const message = String(d.message ?? 'scene sandbox mount failed')
        const err = new Error(message)
        if (!settled) {
          settled = true
          rejectReady(err)
        }
        dispose()
        break
      }
      case 'diag':
        opts.onDiagnostic?.(String(d.msg ?? ''), (d.level as DiagnosticLevel) ?? 'warn')
        break
      case 'stats': {
        const s = d.stats as { fps?: number; running?: boolean } | undefined
        if (s) {
          stats.fps = Number(s.fps) || 0
          stats.running = s.running === true
        }
        if (typeof d.paused === 'boolean') pausedState = d.paused
        if (d.quality) qualityState = d.quality as ResolvedQuality
        break
      }
      case 'frame':
        mirrorCount++
        drawFrame(d.bmp as ImageBitmap)
        break
      case 'reply':
        if (d.ok !== true) {
          opts.onDiagnostic?.(`scene sandbox ${String(d.message ?? 'command failed')}`, 'warn')
        }
        if (typeof d.paused === 'boolean') pausedState = d.paused
        break
      default:
        break
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    stopAudio()
    window.removeEventListener('message', onMessage)
    // 文档一移除，引擎的 WebGL 上下文 / rAF / 音频节点全部由渲染器回收；
    // destroy 消息只是给它一次干净收尾的机会（异步，不等回执）。
    try {
      iframe.contentWindow?.postMessage({ t: 'cmd', id: ++seq, op: 'destroy' }, '*')
    } catch {
      /* 忽略 */
    }
    try {
      iframe.remove()
    } catch {
      /* 已不在树上 */
    }
    try {
      mirror.remove()
    } catch {
      /* 已不在树上 */
    }
    if (!settled) {
      settled = true
      rejectReady(new Error('scene sandbox disposed before ready'))
    }
  }

  window.addEventListener('message', onMessage)
  iframe.src = opts.htmlUrl

  return {
    ready,
    setMirror(on: boolean): void {
      mirrorWanted = on
      if (disposed) return
      try {
        iframe.contentWindow?.postMessage({ t: 'mirror', on }, '*')
      } catch {
        /* 忽略 */
      }
    },
    mirrorFrames(): number {
      return mirrorCount
    },
    dispose
  }
}
