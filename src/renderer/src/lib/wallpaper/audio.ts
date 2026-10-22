// 音频回采 → 64 段双声道频谱 —— 场景引擎的「音频响应」数据源。
// 逐字移植 prototype/app/renderer/audio.mjs（P1/E2 认证工程化），三处本地化改动：
//
//  ① gain 域：原型 getGain 是 0..100（50 = ×1），本项目 config.audio.gain 是
//     0..4（1 = ×1）—— 直接用 getGain() 当乘数，别抄原型的 /50。
//  ② AudioContext 兜底：Electron 自动播放策略下 ctx 可能出生即 suspended，
//     挂载后 resume 一次 + 留手势监听（原型在 WE 宿主里没这问题）。
//  ③ TypeScript + 文案闸门（字符串一律英文，注释中文）。
//
// E2 实测结论（逐条继续有效，改动前先读）：
//   · getDisplayMedia({video:true, audio:{三个 false}}) 才拿到裸信号 + 立体声
//     （三 false 缺一个就被 WebRTC 加工/单声道化，对上不了引擎 {left,right} 契约）；
//   · 必须带 video 轨（屏幕捕获成本来源）→ applyConstraints({frameRate:1})
//     降成本，**绝不 stop 视频轨**（可能连带停整个捕获会话）；
//   · 走 byte 路径（getByteFrequencyData）——float 路径对零能量 bin 返回
//     -Infinity，静音会变成非法值；byte 天然 0..255，静音自然归 0；
//   · 触发延迟 ≈210-315ms 属 loopback 管线固有，别当 bug。
//
// 分箱（bgm-analyser/Rust/legacy 三方一致）：lo=2、usable=binCount*0.72、
//   f0=lo+floor(usable*(b/64)^2)、f1=max(f0+1, lo+floor(usable*((b+1)/64)^2))、
//   逐桶取峰值、/255。分析器参数：fftSize=2048 / smoothing=0.8 / maxDecibels=-25。
//
// snapshot() 契约：左右各 64 段、0..1，**永远返回数组**（静音 = 全 0，绝不
// 用 null/抛错表达静音——那会让引擎回落内置模拟源，壁纸在音频关闭时"自嗨"）。
//
// ---------------------------------------------------------------- 自愈机
// （2026-10-06 新增；主人实测「第一次打开应用加载夜莺，音频监控完全失效，
//   切壁纸、重开窗都不行，只有彻底重启才恢复」的修复本体之一，另一半是
//   引擎侧的 audioSim 闸门热修 —— 见 build/webwallgl-hotfix.ts，两边缺一不可：
//   引擎闸门在挂载时 audio:null 就永久闭死，之后 setAudio 也救不回来；
//   这里保证采集端**一定能走到 live**，并在走到时把源重新推给所有实例。）
//
// 老实现的三条静默死路（逐条对应本机实测症状）：
//   · enable() 失败一次就结束，调用方落盘回滚 enabled=false → 此后永不重试；
//   · status==='requesting' 时第二次 enable() 直接返回 {ok:true} 谎报成功
//     （调用方以为在跑，其实那次尝试早已失败）；
//   · 音轨被系统掐断（'ended'）只把状态改成 ended，无人重挂。
//
// 新语义（对调用方的契约，见 AudioCapture 接口注释）：
//   · enable() 只描述**本次尝试**的结果；失败时若已排定自动重试，
//     结果带 retrying:true —— 调用方**不要回滚开关**，靠事件等终态；
//   · 状态机事件 onChange：'live'（挂上/恢复/重连成功，调用方此刻重推 setAudio）、
//     'retrying'（失败已排重试，fast=快速档内）、'revoked'（被系统掐断，正在重挂）；
//   · 「开关」（wanted）与「采集真状态」（status）彻底分开：开关=意图，
//     status=事实，probe 两个都读得到（info()）。
// 重试阶梯：失败 #1..#5 退避 1/2/4/8/15s，之后每分钟一次**持续到成功或关闭**
//   （不设放弃线：这是本机回采，没有要保护的远端；租借别家的限流逻辑不适用）。
// 超时：getDisplayMedia 8s 无应答 = 本次失败；**迟到的流会被收编或当场停掉**
//   （没有任何手段能取消它，只能接管或回收，绝不留在那占着屏幕捕获）。
import type { AudioSource } from 'webwallgl'

export const AUDIO_BANDS = 64
const FFT_SIZE = 2048
const SMOOTHING = 0.8
const MAX_DB = -25
const POLL_MS = 33 // ~30Hz

/** getDisplayMedia 单次尝试的应答上限（正常 <1s；宿主 handler 卡死时不无限等） */
const ACQUIRE_TIMEOUT_MS = 8000
/** 快速重试档的退避表（次数用完转 RETRY_SLOW_MS 慢速档） */
const RETRY_FAST_DELAYS_MS = [1000, 2000, 4000, 8000, 15000] as const
/** 慢速档间隔（快速档用完后持续重试；开关关掉即中止） */
const RETRY_SLOW_MS = 60_000
/** 音轨被掐断（'ended'）后的重挂延迟（不是采集失败，速战速决） */
const REVOKED_RETRY_MS = 800
/** suspended 的 ctx 每隔这么多 tick 探一次 resume（60 tick ≈ 2s） */
const CTX_PROBE_TICKS = 60

export type AudioCaptureStatus = 'off' | 'requesting' | 'live' | 'ended' | 'error'

export interface AudioSettingsInfo {
  label: string
  channelCount?: number
  [k: string]: unknown
}

export interface AudioCaptureInfo {
  status: AudioCaptureStatus
  errMsg: string
  settings: AudioSettingsInfo | null
  active: boolean
  /** 用户意图（配置开关）；与 status（采集真状态）分开读 */
  wanted: boolean
  /** 本轮连续失败计数（成功或关闭清零）——探针用它证明「重试真发生过」 */
  attempts: number
  /** AudioContext 状态（null = 还没建过 ctx） */
  ctxState: string | null
}

export interface AudioEnableResult {
  ok: boolean
  status: AudioCaptureStatus
  msg?: string
  settings?: AudioSettingsInfo | null
  /** 本次失败后是否已排定自动重试（true ⇒ 调用方不该回滚开关，等事件即可） */
  retrying?: boolean
}

/** 状态机事件：调用方只消费它关心的 kind（模板见 WallpaperLayer 的订阅） */
export type AudioCaptureEvent =
  | { kind: 'live' }
  | { kind: 'retrying'; attempt: number; fast: boolean; msg: string }
  | { kind: 'revoked' }

export interface AudioCapture {
  /** 喂给引擎 setAudio 的源（快照恒为数组；关掉时全 0 而非 null） */
  source: AudioSource
  enable(): Promise<AudioEnableResult>
  disable(): AudioEnableResult
  /** 暂停态门控采集（tick 直接返回；恢复后自动继续） */
  setActive(v: boolean): void
  info(): AudioCaptureInfo
  /** 订阅状态机事件；返回注销函数 */
  onChange(cb: (ev: AudioCaptureEvent) => void): () => void
}

export function createAudioCapture({ getGain }: { getGain: () => number }): AudioCapture {
  const left = new Float32Array(AUDIO_BANDS)
  const right = new Float32Array(AUDIO_BANDS)
  const source: AudioSource = { snapshot: () => ({ left, right }) }

  let stream: MediaStream | null = null
  let ctx: AudioContext | null = null
  let analysers: AnalyserNode[] = []
  let bufs: Uint8Array<ArrayBuffer>[] = []
  let bins: [number, number][] = []
  let timer = 0
  let tickCount = 0
  let active = true
  let status: AudioCaptureStatus = 'off'
  let errMsg = ''
  let settingsInfo: AudioSettingsInfo | null = null
  /** 一次性手势兜底监听的注销（teardown 时必须摘掉） */
  let offGesture: (() => void) | null = null

  /** 用户意图（开关位置）。与 status（事实）分开 —— 开关开着但没采上是合法中间态 */
  let wanted = false
  /** 本轮连续失败计数；成功 / disable / 新 enable 清零 */
  let attempt = 0
  /** 在途重试的定时器（0 = 没有） */
  let retryTimer = 0
  /** 采集代：disable / 新尝试都会 ++，让在途与迟到的流过期 */
  let acquireSeq = 0
  /** enable() 的合流位：并发调用共享同一次尝试的真实结果（不再谎报 ok） */
  let enableInflight: Promise<AudioEnableResult> | null = null
  /** 合流位代：只有自己的代还在台上的 promise 才准清槽（防旧代 finally 清掉新代） */
  let enableGen = 0
  const listeners = new Set<(ev: AudioCaptureEvent) => void>()

  function emit(ev: AudioCaptureEvent): void {
    for (const cb of listeners) {
      try {
        cb(ev)
      } catch {
        // 单个订阅者的异常不阻塞采集机
      }
    }
  }

  /** 分箱表（binCount 变了重建） */
  function buildBins(binCount: number): [number, number][] {
    const lo = 2
    const usable = binCount * 0.72
    const out: [number, number][] = []
    for (let b = 0; b < AUDIO_BANDS; b++) {
      const f0 = lo + Math.floor(usable * Math.pow(b / AUDIO_BANDS, 2))
      const f1 = Math.max(f0 + 1, lo + Math.floor(usable * Math.pow((b + 1) / AUDIO_BANDS, 2)))
      out.push([Math.min(f0, binCount - 1), Math.min(f1, binCount)])
    }
    return out
  }

  function tick(): void {
    if (!analysers.length || !active) return
    tickCount += 1
    // ctx 健康检查（低频）：自动播放策略/系统挂起会让它悄悄变 suspended，
    // 用户之后点过任意地方就该能救活 —— 手势监听是一次性的，这里是持续兜底。
    if (ctx && ctx.state === 'suspended' && tickCount % CTX_PROBE_TICKS === 0) {
      void ctx.resume().catch(() => {})
    }
    // gain 直接当乘数：本项目域 0..4、1 = ×1（原型 0..100/50 的换算不要抄）
    const gain = getGain()
    for (let ch = 0; ch < 2; ch++) {
      const an = analysers[ch]
      const buf = bufs[ch]
      const out = ch === 0 ? left : right
      an.getByteFrequencyData(buf)
      for (let b = 0; b < AUDIO_BANDS; b++) {
        const [f0, f1] = bins[b]
        let peak = 0
        for (let i = f0; i < f1; i++) if (buf[i] > peak) peak = buf[i]
        out[b] = Math.min(1, (peak / 255) * gain)
      }
    }
  }

  function teardown(): void {
    if (timer) {
      window.clearInterval(timer)
      timer = 0
    }
    if (offGesture) {
      offGesture()
      offGesture = null
    }
    for (const a of analysers) {
      try {
        a.disconnect()
      } catch {
        // 断开失败无补救手段
      }
    }
    analysers = []
    bufs = []
    bins = []
    if (stream) {
      stopStream(stream)
      stream = null
    }
    if (ctx) {
      try {
        void ctx.close()
      } catch {
        // 同上
      }
      ctx = null
    }
    left.fill(0)
    right.fill(0)
  }

  function stopStream(s: MediaStream): void {
    try {
      s.getTracks().forEach((t) => t.stop())
    } catch {
      // 同上
    }
  }

  function cancelRetry(): void {
    if (retryTimer) {
      window.clearTimeout(retryTimer)
      retryTimer = 0
    }
  }

  function delayForAttempt(n: number): number {
    const fast = RETRY_FAST_DELAYS_MS[n - 1]
    return fast ?? RETRY_SLOW_MS
  }

  /** 排定下一次重试（已有在途的就不叠加；执行时再验意图与状态） */
  function scheduleRetry(delayMs: number): void {
    if (retryTimer) return
    retryTimer = window.setTimeout(() => {
      retryTimer = 0
      if (!wanted || status === 'live' || enableInflight) return
      console.warn('[wallpaper] audio capture retry (attempt', attempt + 1, ')')
      void runAcquire()
    }, delayMs)
  }

  /** 失败收口：过期/失去意图的尝试静默作废；真失败 → 计数 + 排重试 + 事件 */
  function finishFailure(msg: string, seq: number): AudioEnableResult {
    if (seq !== acquireSeq) return { ok: false, status, msg } // 过期尝试：不碰状态
    if (!wanted) {
      teardown()
      status = 'off'
      return { ok: false, status, msg }
    }
    teardown()
    status = 'error'
    errMsg = msg
    attempt += 1
    const fast = attempt <= RETRY_FAST_DELAYS_MS.length
    scheduleRetry(delayForAttempt(attempt))
    console.warn('[wallpaper] audio capture failed (attempt', attempt, '):', msg)
    emit({ kind: 'retrying', attempt, fast, msg })
    return { ok: false, status, msg, retrying: true }
  }

  function describe(e: unknown): string {
    return 'getDisplayMedia: ' + String(e instanceof Error ? e.message : e)
  }

  /**
   * 挂上一个已到手的流（正常路径与「迟到收编」共用）。
   * 先验代与意图：过期/已关 → 当场停轨（没有任何手段取消它，只能回收）。
   */
  async function installStream(s: MediaStream, seq: number): Promise<AudioEnableResult> {
    if (seq !== acquireSeq || !wanted) {
      stopStream(s)
      return { ok: false, status }
    }
    stream = s
    const at = s.getAudioTracks()
    if (!at.length) return finishFailure('no-audio-track', seq)
    try {
      settingsInfo = { ...(at[0].getSettings() as Record<string, unknown>), label: at[0].label }
    } catch {
      settingsInfo = null
    }
    // 屏幕捕获降载：申请 1fps（别 stop 视频轨——可能连带停整个捕获会话；失败静默）
    try {
      const vt = s.getVideoTracks()[0]
      if (vt && vt.applyConstraints) await vt.applyConstraints({ frameRate: 1 })
    } catch {
      // 不支持就算了
    }
    // 被系统掐断（'ended'）→ 还在意就自动重挂；'ended' 不会被 t.stop() 触发，
    // 但依然做重入保护（重挂前 teardown 会把监听连轨道一起收掉）。
    const onRevoked = (): void => {
      if (stream !== s) return
      teardown()
      attempt = 0 // 被掐断不是采集失败：下次重挂给完整快速档
      if (!wanted) {
        status = 'off'
        return
      }
      status = 'ended'
      emit({ kind: 'revoked' })
      console.warn('[wallpaper] audio capture track ended -- re-attaching')
      scheduleRetry(REVOKED_RETRY_MS)
    }
    for (const t of s.getTracks()) t.addEventListener('ended', onRevoked)

    try {
      ctx = new AudioContext()
      const octx = ctx
      // 自动播放策略兜底：出生即 suspended 时先 resume 一次；不给就挂手势监听
      // （pointerdown/keydown 捕获段均覆盖）—— **resume 成功才摘监听**：
      // 失败一次就摘掉的话，那之后用户点再多地方也救不回来了（老实现的缝）。
      if (octx.state === 'suspended') {
        void octx.resume().catch(() => {})
        const onGesture = (): void => {
          void octx.resume().then(
            () => {
              if (octx.state === 'running' && offGesture) {
                offGesture()
                offGesture = null
              }
            },
            () => {
              // 这次手势没救活：留着监听等下一次
            }
          )
        }
        window.addEventListener('pointerdown', onGesture, true)
        window.addEventListener('keydown', onGesture, true)
        offGesture = () => {
          window.removeEventListener('pointerdown', onGesture, true)
          window.removeEventListener('keydown', onGesture, true)
        }
      }
      const src = octx.createMediaStreamSource(s)
      const channels = settingsInfo?.channelCount || 2
      if (channels >= 2) {
        const splitter = octx.createChannelSplitter(2)
        src.connect(splitter)
        for (let ch = 0; ch < 2; ch++) {
          const an = octx.createAnalyser()
          an.fftSize = FFT_SIZE
          an.smoothingTimeConstant = SMOOTHING
          an.maxDecibels = MAX_DB
          splitter.connect(an, ch)
          analysers.push(an)
        }
      } else {
        // 单声道兜底：同一信号喂两个分析器（立体声缺失不会丢响应）
        for (let ch = 0; ch < 2; ch++) {
          const an = octx.createAnalyser()
          an.fftSize = FFT_SIZE
          an.smoothingTimeConstant = SMOOTHING
          an.maxDecibels = MAX_DB
          src.connect(an)
          analysers.push(an)
        }
      }
      bins = buildBins(analysers[0].frequencyBinCount)
      bufs = [
        new Uint8Array(analysers[0].frequencyBinCount),
        new Uint8Array(analysers[0].frequencyBinCount)
      ]
      timer = window.setInterval(tick, POLL_MS)
      status = 'live'
      attempt = 0
      errMsg = ''
      emit({ kind: 'live' })
      return { ok: true, status, settings: settingsInfo }
    } catch (e) {
      return finishFailure('graph: ' + String(e instanceof Error ? e.message : e), seq)
    }
  }

  /** 单次尝试：发起采集（带超时）→ 挂流；失败走 finishFailure（含排重试） */
  async function runAcquire(): Promise<AudioEnableResult> {
    status = 'requesting'
    errMsg = ''
    const seq = ++acquireSeq
    let raw: Promise<MediaStream>
    try {
      // 三 false：裸信号 + 立体声（E2 口径，逐字）。主进程侧由
      // setDisplayMediaRequestHandler 应答（见 main/index.ts 显示媒体段）。
      raw = navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      })
    } catch (e) {
      return finishFailure(describe(e), seq)
    }
    let timeoutId = 0
    let s: MediaStream
    try {
      s = await Promise.race([
        raw,
        new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(
            () => reject(new Error('timeout after ' + ACQUIRE_TIMEOUT_MS + 'ms')),
            ACQUIRE_TIMEOUT_MS
          )
        })
      ])
    } catch (e) {
      // 超时/拒绝：**没有任何手段取消那个在途请求** —— 它若迟到，能收编就
      // 收编（还想要且没在采），否则当场停轨，绝不让它占着屏幕捕获。
      raw.then(
        (late) => {
          if (seq === acquireSeq && wanted && status !== 'live' && !stream) {
            void installStream(late, seq)
          } else {
            stopStream(late)
          }
        },
        () => {
          // 拒绝已在 race 处处理过
        }
      )
      return finishFailure(describe(e), seq)
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId)
    }
    return installStream(s, seq)
  }

  async function enable(): Promise<AudioEnableResult> {
    wanted = true
    if (status === 'live') return { ok: true, status }
    // 并发合流：requesting 期间的重复调用共享同一次尝试的真实结果
    // （老实现直接返回 {ok:true} 谎报 —— 调用方以为在跑，其实早已失败）
    if (enableInflight) return enableInflight
    attempt = 0 // 用户新意图：重试预算重置
    cancelRetry()
    const gen = ++enableGen
    const p = runAcquire()
    enableInflight = p
    void p.finally(() => {
      if (enableGen === gen) enableInflight = null
    })
    return p
  }

  function disable(): AudioEnableResult {
    wanted = false
    enableGen += 1 // 作废合流位（在途 promise 自己的 finally 不再清槽）
    enableInflight = null
    acquireSeq += 1 // 令在途/迟到的一切过期（它们的流会被当场回收）
    cancelRetry()
    attempt = 0
    teardown()
    status = 'off'
    errMsg = ''
    return { ok: true, status }
  }

  return {
    source,
    enable,
    disable,
    setActive(v: boolean): void {
      active = !!v
    },
    info: () => ({
      status,
      errMsg,
      settings: settingsInfo,
      active,
      wanted,
      attempts: attempt,
      ctxState: ctx ? ctx.state : null
    }),
    onChange(cb: (ev: AudioCaptureEvent) => void): () => void {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    }
  }
}
