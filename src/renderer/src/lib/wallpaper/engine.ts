// 场景引擎接线层（P3 第三步，2026-10-05）：webwallgl 2.1.0 的**唯一**入口。
//
// 【P0 壁纸沙盒逃逸（2026-10-31）之后本层多了一层身份】
// 引擎不再跑在应用自己的文档里，而是跑在 `.wp-fit` 内的
// `sandbox="allow-scripts"` iframe（opaque origin）中 —— 场景脚本（new Function）
// 拿不到父页面 DOM / preload / IPC。父页面看到的仍是一个 SceneInstance 形状的
// 代理（scene-frame.ts），所以调用方 WallpaperLayer 一行没改语义。本文件负责
// 的仍是「永远 settle、失败可回收、超时有预算」，只是 mount 那一跳换成了
// iframe 握手。沙箱侧的宿主是 scene-host.ts。
//
// 为什么单独一层：库本身只认 miai-wall:// 之外的 URL 语义、只抛裸错误；
// 本层把它包成「永远 settle、失败可回收、超时有预算」的挂载器，供
// WallpaperLayer 消费。纯函数（预算/适配/画质映射）单独导出给单测。
//
// 三条实证口径（改动前先读，全部在 2026-10-05 逐行读过引擎 dist 源码）：
//  · mount() 失败时会把半成品实例挂在 err.instance 上（"可 destroy() 回收"）
//    —— 不回收就是一个泄漏的 WebGL 上下文 + rAF 循环，2G 档机器上尤其致命。
//  · autoQuality 只填「宿主没显式指定的键」：显式 quality.postProcessing
//    永不被软件渲染分支改写；且 allowAdaptive = 最终 postProcessing !== 'off'，
//    只有它才创建运行期降级器。⇒ quality 档位映射见 qualityForScene。
//  · mountTimeoutMs 是库自己的首帧看门狗（reject + 一条诊断）；本层的
//    deadline 比它再宽 5 秒，是「连看门狗都没等到结果」时的兜底 ——
//    两层都要有：库的超时带排查诊断，本层的超时保证调用方永远拿到 settle。
//
// ⚠️ 本文件在 src/ 下、被文案闸门（copy.test.ts）扫：字符串一律英文（错误
// 消息也英文，它只进 console 与诊断回调），注释中文。也别写 `opacity:`
// —— wall-glass 的静态快照按行文本数 `opacity:` 声明。

import type {
  AudioSource,
  DiagnosticLevel,
  Fit,
  QualityOptions,
  SceneInstance,
} from 'webwallgl'
import type { WallpaperObjectFit, WallpaperQuality } from '../../../../shared/wallpaper'
import { miaiWallUrl } from './url'
import { createSceneFrame, sceneSandboxUrl, type SceneFrame } from './scene-frame'

/** 挂载超时错误的 code（调用方按它区分「超时」与「引擎报错」，别对文案做匹配） */
export const SCENE_TIMEOUT_CODE = 'scene-mount-timeout'

export class SceneMountTimeoutError extends Error {
  readonly code = SCENE_TIMEOUT_CODE
  constructor(readonly budgetMs: number) {
    super(`scene mount timeout after ${budgetMs}ms`)
    this.name = 'SceneMountTimeoutError'
  }
}

/** pkg 读取预算速度（字节/毫秒）。本机磁盘 + 无网络，8MB/s 已非常保守 */
const BYTES_PER_MS = 8 * 1024 * 1024 / 1000
const BUDGET_MIN_MS = 15_000
const BUDGET_MAX_MS = 90_000
const BUDGET_FALLBACK_MS = 60_000

/**
 * 首帧预算 B = clamp(15s…90s, 大小 ÷ 8MB/s)（docs/23 §3.3.2）。
 * sizeBytes 缺省（stat 失败/旧扫描产物）退回引擎缺省 60s。
 * 非法输入（NaN/负数）按缺省处理 —— 预算是显示层输入，不是可信数据。
 */
export function mountBudgetMs(sizeBytes: number | null): number {
  if (sizeBytes === null || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return BUDGET_FALLBACK_MS
  const ms = Math.round(sizeBytes / BYTES_PER_MS)
  return Math.min(BUDGET_MAX_MS, Math.max(BUDGET_MIN_MS, ms))
}

/**
 * 本层 deadline = 库内看门狗 + 5s，且下限 20s（小包也不能比 15s 预算还急，
 * 否则两个看门狗几乎同时响，库的诊断信息反而来不及上报）。
 */
export function prepareTimeoutFor(budgetMs: number): number {
  return Math.max(20_000, budgetMs + 5_000)
}

/**
 * 画面适配 → 引擎 Fit 三档。`center`（不缩放、居中，对应 CSS object-fit:none）
 * 引擎没有等价档，映射到 contain —— 保纵横比是两者共同点，宁可轻微缩放
 * 也不要 stretch 的形变。
 */
export function fitForScene(fit: WallpaperObjectFit): Fit {
  if (fit === 'fill') return 'stretch'
  if (fit === 'contain' || fit === 'center') return 'contain'
  return 'cover'
}

/**
 * 画质档 → 挂载期 quality 参数（用户口径见 shared/wallpaper.ts 的
 * WALLPAPER_QUALITIES 注释）。`auto` 返回 undefined = **不传 quality 键**，
 * 让引擎的 autoQuality 全权接管（含软件渲染分支）；传 {particles:'high',
 * postProcessing:'high'} 会把"自动"锁死，等于把低配机器的保命机制关掉。
 *
 * 省电档为什么是 particles:'low' 而非 'off'：postProcessing 显式 'off' 已经
 * 关掉最贵的后处理，粒子留 low 保住场景的"活的"观感（主人点名的动态效果之一）。
 */
export function qualityForScene(quality: WallpaperQuality): QualityOptions | undefined {
  if (quality === 'off') return { particles: 'low', postProcessing: 'off' }
  if (quality === 'high') return { particles: 'high', postProcessing: 'high' }
  return undefined
}

/**
 * 画质档 → 运行期 setQuality 补丁（设置在设置页改动时热更，不重挂）。
 * 注意一个引擎边界：**挂载时按 auto（未创建自适应降级器）的实例，
 * 之后永远没有自适应**——setQuality 只能改档位，不能把没创建的东西
 * 创建出来。所以这里 auto 与 high 一样给实档，是"就当用户选了高"的口径；
 * 真正的自动降载由挂载期 autoQuality 的默认档负责，两处不冲突。
 */
export function qualityPatchForScene(quality: WallpaperQuality): QualityOptions {
  if (quality === 'off') return { particles: 'low', postProcessing: 'off' }
  return { particles: 'high', postProcessing: 'high' }
}

/**
 * 场景 BGM 的有效音量（0~1）＝挂载 initialVolume 与运行期 inst.setVolume 的
 * 唯一取值口径。判据与视频侧的音频闸同构（WallpaperLayer 里 `v === audioGate
 * && trackOn && vol > 0`）：
 *  · isGate = 这个 rec 是不是**当前展示层**（WallpaperLayer 的 sceneGate）；
 *  · trackOn = 壁纸音轨开关（假 = 强制静音，音量数值照旧保留）；
 *  · volumePercent = 配置里的 0~100 整数。
 * 非闸 / 关音轨恒 0 —— 双槽过场期绝不出两个声源（R7 单声源口径）；越界钳到
 * [0,1] 是配置净化之外的保险（手改配置文件不该能把增益顶爆）。
 */
export function sceneVolumeFor(isGate: boolean, trackOn: boolean, volumePercent: number): number {
  if (!isGate || !trackOn) return 0
  return Math.min(1, Math.max(0, volumePercent / 100))
}

/**
 * 收尸。destroy 里引擎可能还会抛（半成品实例的内部状态不保证完整），
 * 这里吞掉——收尸失败不该把调用方的主流程带崩（残留由 GC 兜）。
 * releasePkgCache: true —— 缓存默认跨实例保留，桌面壁纸逐张切换的语义是
 * "销毁即放弃"，旧 pkg 压缓存里就是 2G 档机器上白占的内存。
 */
export function destroyScene(inst: SceneInstance | null | undefined): void {
  if (!inst) return
  try {
    inst.destroy({ releasePkgCache: true })
  } catch {
    // 收尸失败无补救手段，也不该升级成用户可见错误
  }
}

export interface MountSceneOpts {
  /** 把沙箱 iframe 挂进哪个元素（`.wp-fit`；引擎在 iframe 内部自建 canvas） */
  el: HTMLElement
  /** 条目目录（本机绝对路径），引擎按名取资源全部走 miai-wall:// */
  dir: string
  fit: Fit
  fps: number
  quality: WallpaperQuality
  sizeBytes: number | null
  /** 音频反应源（audio.ts 的 capture.source）；未启用传 null */
  audio: AudioSource | null
  /**
   * 落座音量 0~1（可选；缺省 = 维持挂载参数的静音）。**真实音量必须从这条
   * 通道进**，不要去改 mountOpts.volume：那个键只被引擎映射成布尔静音
   * （dist L52725 `muted: (o.volume ?? 0) <= 0`），传 0.8 会得到「立即 100%
   * 满音量」。挂载成功后经实例方法 setVolume 落一次（dist L52999-53010：写
   * rt.userVolume / cfg.muted / sceneAudio.setVolume，是唯一法定入口）——
   * 引擎在 userVolume 未设时按 muted 回落（effectiveUserVolume），落座即写死
   * 一次才防得住回退。
   */
  initialVolume?: number
  /** 引擎诊断（msg + 级别），调用方自行节流/记录 */
  onDiagnostic?: (msg: string, level: DiagnosticLevel) => void
}

export interface SceneHandle {
  inst: SceneInstance
  /**
   * 液态玻璃取样的开关（沙箱代理专有；外部引擎实例没有这个入口）。
   * 只在玻璃折射开着时启用 —— 关着时沙箱一帧都不回传，零开销。
   */
  setMirror?: (on: boolean) => void
  /** 已收到的镜像帧数（探针用：分辨「没回传」与「回传了但画错」） */
  mirrorFrames?: () => number
  /** 从开始挂载到首帧的实测毫秒数（探针要的真实读数） */
  mountMs: number
  /** 本次用的预算（探针/诊断要回显"为什么等这么久"） */
  budgetMs: number
}

/**
 * 挂载一个场景，**永远 settle**：
 *  · 成功 → SceneHandle（调用方仍需检查自己的 epoch 是否过期，过期就
 *    destroyScene(handle.inst)）；
 *  · 任何失败（import/httpSource/mount 抛错、超时）→ reject，且**不泄漏**：
 *    迟到的实例、err.instance 半成品，都在本层收掉。
 * 上层（WallpaperLayer）拿到 reject 后走海报降级，不需要再碰回收。
 */
export async function mountScene(opts: MountSceneOpts): Promise<SceneHandle> {
  const budgetMs = mountBudgetMs(opts.sizeBytes)
  const deadlineMs = prepareTimeoutFor(budgetMs)
  const started = performance.now()

  let settled = false
  let expired = false
  let handle: SceneInstance | null = null
  let frame: SceneFrame | null = null

  /**
   * 收掉沙箱句柄。`frame` 只在 work / guard 两个闭包里被赋值，外层函数体里的
   * 流分析看不见那些赋值 —— 直接在 catch 里写 `if (frame) frame.dispose()`
   * 会被窄化成 never（TS2339）。把类型钉回显式形参，收尸也只写这一处。
   */
  const disposeFrame = (f: SceneFrame | null): void => {
    try {
      f?.dispose()
    } catch {
      // 文档已经没了：无妨
    }
  }

  // deadline 到期：标记 expired（让迟到的 mount 结果就地收尸），并 reject。
  let timer: ReturnType<typeof setTimeout> | null = null
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      if (settled) return
      expired = true
      if (handle) {
        destroyScene(handle)
        handle = null
      }
      // 沙箱还没 ready 就超时：iframe 一并拆掉（只 destroy 实例不够 ——
      // 挂载中的代理还没有实例可收，文档本身就是要收的那份资源）
      disposeFrame(frame)
      frame = null
      reject(new SceneMountTimeoutError(budgetMs))
    }, deadlineMs)
  })

  const work = (async (): Promise<SceneHandle> => {
    // 方案 B：引擎与场景脚本全部关在 sandbox="allow-scripts" 的 iframe 里。
    // 父页面拿到的 inst 是 postMessage 代理（形状与 SceneInstance 一致）。
    const f = createSceneFrame({
      el: opts.el,
      htmlUrl: sceneSandboxUrl(),
      dirUrl: miaiWallUrl(opts.dir),
      fit: opts.fit,
      fps: opts.fps,
      quality: qualityForScene(opts.quality),
      // 库内看门狗用预算本身；本层 deadline 比它宽 5s，先响的总是库，
      // 用户拿到的是带排查提示的诊断而不是我们的裸超时。
      mountTimeoutMs: budgetMs,
      // null 也要显式传：不传键时引擎回落**内置模拟频谱**（场景会"自嗨"地
      // 随假节拍抖动）。原型实证口径 = 未启用就是真 zero 频谱，不是假数据。
      audio: opts.audio,
      onDiagnostic: opts.onDiagnostic,
    })
    frame = f
    const inst = await f.ready
    handle = inst
    if (expired) {
      // 迟到的实例：guard 已经 reject 过，这里收尸且不再 resolve（race 已结算，
      // 本分支抛出的错误会被 race 的处理器吞掉，不会变成未处理拒绝）。
      f.dispose()
      frame = null
      handle = null
      throw new SceneMountTimeoutError(budgetMs)
    }
    // 落座即 setVolume（防回退，见 MountSceneOpts.initialVolume：挂载参数只是
    // 静音布尔，真实音量必须显式写一次，否则引擎按 muted 回落）。写失败不升级
    // —— 音量没落上不该把一次成功的挂载判死（上层在闸移交时还会再写一次）。
    if (typeof opts.initialVolume === 'number') {
      try {
        inst.setVolume(Math.min(1, Math.max(0, opts.initialVolume)))
      } catch (err) {
        console.warn('[wallpaper] scene setVolume on mount failed:', err)
      }
    }
    return {
      inst,
      setMirror: (on: boolean) => f.setMirror(on),
      mirrorFrames: () => f.mirrorFrames(),
      mountMs: performance.now() - started,
      budgetMs,
    }
  })()

  try {
    const h = await Promise.race([work, guard])
    settled = true
    return h
  } catch (err) {
    settled = true
    // mount 失败时半成品挂在这个字段上 —— 不清就是泄漏一个 WebGL 上下文。
    const salvage = (err as { instance?: SceneInstance } | null)?.instance
    if (salvage && salvage !== handle) destroyScene(salvage)
    // 沙箱侧的失败已经在 fail 消息里自行 dispose；这里再兜一次（幂等），
    // 覆盖「createSceneFrame 之后、ready 之前」抛出的其它路径。
    disposeFrame(frame)
    frame = null
    throw err
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}
