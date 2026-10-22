/**
 * 音频采集自愈机的单测（2026-10-06，对应主人实测的「首次加载音频监控永久失效」修复）。
 *
 * 钉的契约（每根都对应一条老实现的静默死路）：
 *  · enable() 失败**不谎报**：requesting 期间并发调用共享同一次尝试的真实结果
 *    （老实现直接返回 {ok:true}，调用方以为在跑、其实那次尝试早已失败）；
 *  · 失败一定排重试：1/2/4/8/15s 快速档 → 60s 慢速档，持续到成功或关闭，
 *    结果带 retrying:true（调用方据此**不回滚开关**）；
 *  · 8s 超时算失败，但**迟到的流被收编**（还在意且没在采就挂上）或**当场回收**
 *    （关闭/换代就停轨，绝不占着屏幕捕获）；
 *  · 音轨被系统掐断（'ended'）→ 'revoked' 事件 + 800ms 自动重挂；
 *  · disable 中止一切：重试阶梯、在途请求、已挂的流；
 *  · ctx 出生即 suspended 的手势兜底：**resume 成功才摘监听**（失败不摘，
 *    等下一个手势 —— 老实现成败都摘，摘后再点也救不回来）。
 *
 * ⚠️ vitest 环境是 node（无 jsdom）：window / navigator / AudioContext 全靠
 * vi.stubGlobal 造。fake window 的计时器方法必须**调用时才查** globalThis
 * （写成 (fn, ms) => globalThis.setTimeout(fn, ms)），否则 vi.useFakeTimers()
 * 换掉的全局计时器它看不见 —— 重试阶梯测试会静默走过真实时间。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUDIO_BANDS, createAudioCapture, type AudioCapture, type AudioCaptureEvent } from '../audio'

// ---------------------------------------------------------------- 夹具

interface FakeTrack {
  label: string
  stopped: boolean
  settings: Record<string, unknown>
  listeners: Map<string, Array<() => void>>
  stop(): void
  getSettings(): Record<string, unknown>
  addEventListener(type: string, cb: () => void): void
  applyConstraints(c: unknown): Promise<void>
}

function makeTrack(label: string, settings: Record<string, unknown> = {}): FakeTrack {
  const listeners = new Map<string, Array<() => void>>()
  return {
    label,
    stopped: false,
    settings: { channelCount: 2, ...settings },
    listeners,
    stop(): void {
      this.stopped = true
    },
    getSettings(): Record<string, unknown> {
      return this.settings
    },
    addEventListener(type: string, cb: () => void): void {
      const a = listeners.get(type) ?? []
      a.push(cb)
      listeners.set(type, a)
    },
    applyConstraints(): Promise<void> {
      return Promise.resolve()
    }
  }
}

interface FakeStream {
  audio: FakeTrack
  video: FakeTrack
  media: MediaStream
  fireEnded(): void
}

function makeStream(): FakeStream {
  const audio = makeTrack('fake-audio')
  const video = makeTrack('fake-video')
  const media = {
    getAudioTracks: () => [audio],
    getVideoTracks: () => [video],
    getTracks: () => [audio, video]
  } as unknown as MediaStream
  return {
    audio,
    video,
    media,
    fireEnded(): void {
      for (const cb of audio.listeners.get('ended') ?? []) cb()
    }
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 假 window：计时器方法**调用时**活查 globalThis —— 兼容 vi.useFakeTimers() */
const winListeners = new Map<string, Set<() => void>>()
const fakeWindow = {
  setTimeout: (fn: () => void, ms?: number): number =>
    globalThis.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id: number): void => globalThis.clearTimeout(id),
  setInterval: (fn: () => void, ms?: number): number =>
    globalThis.setInterval(fn, ms) as unknown as number,
  clearInterval: (id: number): void => globalThis.clearInterval(id),
  addEventListener: (type: string, cb: () => void): void => {
    const s = winListeners.get(type) ?? new Set()
    s.add(cb)
    winListeners.set(type, s)
  },
  removeEventListener: (type: string, cb: () => void): void => {
    winListeners.get(type)?.delete(cb)
  }
}

/** 假 AudioContext：出生状态与 resume 成败可控（手势兜底测试用） */
let ctxSuspendedAtBirth = false
let ctxResumeFailures = 0
let ctxResumeCalls = 0
class FakeAnalyser {
  fftSize = 0
  smoothingTimeConstant = 0
  maxDecibels = 0
  frequencyBinCount = 1024
  getByteFrequencyData(): void {
    // 全 0 = 静音；本测试不验频谱数值
  }
  disconnect(): void {}
}
class FakeAudioContext {
  state: string = ctxSuspendedAtBirth ? 'suspended' : 'running'
  createAnalyser(): FakeAnalyser {
    return new FakeAnalyser()
  }
  createMediaStreamSource(): { connect(): void } {
    return { connect: () => {} }
  }
  createChannelSplitter(): { connect(): void } {
    return { connect: () => {} }
  }
  resume(): Promise<void> {
    ctxResumeCalls += 1
    if (ctxResumeFailures > 0) {
      ctxResumeFailures -= 1
      return Promise.reject(new Error('blocked-by-autoplay-policy'))
    }
    this.state = 'running'
    return Promise.resolve()
  }
  close(): Promise<void> {
    return Promise.resolve()
  }
}

// ---------------------------------------------------------------- 每测重置

let queue: Array<() => Promise<MediaStream>>
const getDisplayMedia = vi.fn((): Promise<MediaStream> => {
  const next = queue.shift()
  return next ? next() : new Promise<MediaStream>(() => {}) // 无排队 = 永远挂起
})
let cap: AudioCapture
let events: AudioCaptureEvent[]

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  queue = []
  events = []
  winListeners.clear()
  ctxSuspendedAtBirth = false
  ctxResumeFailures = 0
  ctxResumeCalls = 0
  getDisplayMedia.mockClear()
  vi.stubGlobal('window', fakeWindow)
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } })
  vi.stubGlobal('AudioContext', FakeAudioContext)
  cap = createAudioCapture({ getGain: () => 1 })
  cap.onChange((ev) => events.push(ev))
})

afterEach(() => {
  cap.disable()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const kinds = (): string[] => events.map((e) => e.kind)

// ---------------------------------------------------------------- 用例

describe('自愈机 · 超时与重试', () => {
  it('8s 超时 → 排重试（retrying:true）→ 重试成功 → live；enable 不再谎报', async () => {
    const d1 = deferred<MediaStream>()
    queue.push(() => d1.promise) // 第一次：永远挂起（模拟宿主 handler 卡死）
    queue.push(() => Promise.resolve(makeStream().media)) // 重试：成功

    const p = cap.enable()
    // 还没到点：requesting，且 wanted（意图）与 status（事实）分家
    expect(cap.info().status).toBe('requesting')
    expect(cap.info().wanted).toBe(true)

    await vi.advanceTimersByTimeAsync(8000)
    const r = await p
    // 本次尝试如实报失败；但因为已排重试，调用方不应回滚开关
    expect(r.ok).toBe(false)
    expect(r.retrying).toBe(true)
    expect(r.msg).toContain('timeout')
    expect(cap.info().status).toBe('error')
    expect(cap.info().attempts).toBe(1)
    expect(kinds()).toContain('retrying')

    // 快速档第一档 = 1000ms
    await vi.advanceTimersByTimeAsync(1000)
    expect(cap.info().status).toBe('live')
    expect(cap.info().attempts).toBe(0) // 成功清零
    expect(cap.info().wanted).toBe(true)
    expect(cap.info().ctxState).toBe('running')
    expect(kinds()).toContain('live')
    expect(getDisplayMedia).toHaveBeenCalledTimes(2)

    // live 状态下再 enable：短路成功，不再发起采集
    const again = await cap.enable()
    expect(again.ok).toBe(true)
    expect(getDisplayMedia).toHaveBeenCalledTimes(2)

    // 采样源恒为 64 段数组（静音 = 全 0，绝不为 null —— 引擎回落的坑）
    const snap = cap.source.snapshot()
    expect(snap.left.length).toBe(AUDIO_BANDS)
    expect(snap.right.length).toBe(AUDIO_BANDS)
  })

  it('连续失败走 1/2/4/8/15s 退避，第 6 次起转 60s 慢速档（事件带 fast 标记）', async () => {
    const boom = (): Promise<MediaStream> => Promise.reject(new Error('NotAllowedError: denied'))
    for (let i = 0; i < 20; i++) queue.push(boom)

    const p = cap.enable()
    await vi.advanceTimersByTimeAsync(0)
    expect((await p).retrying).toBe(true)
    expect(getDisplayMedia).toHaveBeenCalledTimes(1)

    // 逐档验证：每一跳恰好触发一次新尝试
    for (const [step, wantCalls] of [
      [1000, 2],
      [2000, 3],
      [4000, 4],
      [8000, 5],
      [15000, 6]
    ] as const) {
      await vi.advanceTimersByTimeAsync(step)
      expect(getDisplayMedia).toHaveBeenCalledTimes(wantCalls)
    }
    expect(cap.info().attempts).toBe(6)
    // 第 6 次事件的 fast=false（已转慢速档），前 5 次都是 fast
    const retryEvents = events.filter((e) => e.kind === 'retrying')
    expect(retryEvents.length).toBe(6)
    expect(retryEvents.slice(0, 5).every((e) => e.kind === 'retrying' && e.fast)).toBe(true)
    expect(retryEvents[5]).toMatchObject({ kind: 'retrying', fast: false, attempt: 6 })

    // 慢速档 = 60s：差 1ms 不动，补足才动
    await vi.advanceTimersByTimeAsync(59999)
    expect(getDisplayMedia).toHaveBeenCalledTimes(6)
    await vi.advanceTimersByTimeAsync(1)
    expect(getDisplayMedia).toHaveBeenCalledTimes(7)
  })

  it('并发 enable() 合流：同一次尝试共享真实结果（老实现谎报 ok:true 的回归点）', async () => {
    const d = deferred<MediaStream>()
    queue.push(() => d.promise)
    const p1 = cap.enable()
    const p2 = cap.enable()
    expect(getDisplayMedia).toHaveBeenCalledTimes(1) // 只有一次真尝试

    d.reject(new Error('boom'))
    await vi.advanceTimersByTimeAsync(0)
    const r1 = await p1
    const r2 = await p2
    expect(r1.ok).toBe(false)
    expect(r2.ok).toBe(false)
    expect(r1.retrying).toBe(true)
    expect(r2.retrying).toBe(true)
  })

  it('超时后迟到的流被**收编**（进度更快的路）且原定重试自行让路', async () => {
    const d = deferred<MediaStream>()
    queue.push(() => d.promise)
    const st = makeStream()
    const p = cap.enable()
    await vi.advanceTimersByTimeAsync(8000)
    expect((await p).retrying).toBe(true)

    // 迟到的流在重试定时器（1000ms）之前到
    d.resolve(st.media)
    await vi.advanceTimersByTimeAsync(0)
    expect(cap.info().status).toBe('live')
    expect(kinds()).toContain('live')

    // 原定 1000ms 的重试到点后应让路（已经 live），不再发起采集
    await vi.advanceTimersByTimeAsync(1000)
    expect(getDisplayMedia).toHaveBeenCalledTimes(1)
    expect(st.audio.stopped).toBe(false) // 被挂上的流当然不能停
  })
})

describe('自愈机 · 掐断与关闭', () => {
  it("音轨被系统掐断（'ended'）→ revoked 事件 → 800ms 自动重挂", async () => {
    const st1 = makeStream()
    const st2 = makeStream()
    queue.push(() => Promise.resolve(st1.media))
    queue.push(() => Promise.resolve(st2.media))

    await cap.enable()
    expect(cap.info().status).toBe('live')

    st1.fireEnded()
    expect(cap.info().status).toBe('ended')
    expect(kinds()).toContain('revoked')
    // 掐断不是采集失败：下一次重挂拿完整快速档
    await vi.advanceTimersByTimeAsync(800)
    expect(cap.info().status).toBe('live')
    expect(st2.audio.stopped).toBe(false)
    expect(getDisplayMedia).toHaveBeenCalledTimes(2)
  })

  it('disable 中止重试阶梯：此后时钟再走多久都不再发起采集', async () => {
    queue.push(() => Promise.reject(new Error('denied')))
    const p = cap.enable()
    await vi.advanceTimersByTimeAsync(0)
    expect((await p).retrying).toBe(true)

    cap.disable()
    expect(cap.info().status).toBe('off')
    expect(cap.info().wanted).toBe(false)
    await vi.advanceTimersByTimeAsync(300_000) // 慢速档也走 5 分钟
    expect(getDisplayMedia).toHaveBeenCalledTimes(1)
  })

  it('关闭后迟到的流被**当场回收**（停轨），不留占着屏幕捕获的孤儿', async () => {
    const d = deferred<MediaStream>()
    queue.push(() => d.promise)
    const st = makeStream()
    void cap.enable()
    await vi.advanceTimersByTimeAsync(0)

    cap.disable()
    d.resolve(st.media) // 迟到
    await vi.advanceTimersByTimeAsync(0)
    expect(st.audio.stopped).toBe(true)
    expect(st.video.stopped).toBe(true)
    expect(cap.info().status).toBe('off')
  })

  it('disable 后重新 enable：新代生效，旧代的一切不再干扰', async () => {
    const dOld = deferred<MediaStream>()
    queue.push(() => dOld.promise)
    void cap.enable()
    await vi.advanceTimersByTimeAsync(0)
    cap.disable()

    const st = makeStream()
    queue.push(() => Promise.resolve(st.media))
    const r = await cap.enable()
    expect(r.ok).toBe(true)
    expect(cap.info().status).toBe('live')

    // 旧代的迟到流到达：不该顶掉新流
    dOld.resolve(makeStream().media)
    await vi.advanceTimersByTimeAsync(0)
    expect(cap.info().status).toBe('live')
  })
})

describe('自愈机 · 自动播放策略兜底', () => {
  it('ctx 出生即 suspended：resume 失败**不摘**手势监听，成功才摘', async () => {
    ctxSuspendedAtBirth = true
    ctxResumeFailures = 2 // 自动尝试 + 第一个手势都失败，第二个手势成功
    queue.push(() => Promise.resolve(makeStream().media))
    await cap.enable()
    expect(cap.info().status).toBe('live')
    expect(cap.info().ctxState).toBe('suspended')
    expect(ctxResumeCalls).toBe(1) // 安装时自动试过一次
    expect(winListeners.get('pointerdown')?.size).toBe(1)
    expect(winListeners.get('keydown')?.size).toBe(1)

    // 手势一：resume 又失败 —— 监听必须留着（老实现这里就摘了，之后永远救不回）
    for (const cb of [...(winListeners.get('pointerdown') ?? [])]) cb()
    await vi.advanceTimersByTimeAsync(0)
    expect(ctxResumeCalls).toBe(2)
    expect(winListeners.get('pointerdown')?.size).toBe(1)

    // 手势二：resume 成功 —— 这才摘
    for (const cb of [...(winListeners.get('pointerdown') ?? [])]) cb()
    await vi.advanceTimersByTimeAsync(0)
    expect(ctxResumeCalls).toBe(3)
    expect(cap.info().ctxState).toBe('running')
    expect(winListeners.get('pointerdown')?.size ?? 0).toBe(0)
    expect(winListeners.get('keydown')?.size ?? 0).toBe(0)
  })
})
