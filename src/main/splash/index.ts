/**
 * 开屏闸门（createSplashGate）—— 开屏动画的状态机与窗口生命周期，一处收口。
 * 设计全量依据见 docs/24-开屏动画方案.md；主人批复口径见 shared/splash.ts 头注释。
 *
 * 【它解决的三类事故，每条都有一次真实翻车史】
 * ① **零窗口闪退**：`window-all-closed` 在非 darwin 直接 app.quit()。所以
 *    铁律是「任何时刻至少一个窗口存活」——主窗必须先构造（隐藏），开屏窗
 *    才是第二个窗口；交接顺序写死为「先把主窗 show 上屏 → 再销毁开屏窗」，
 *    所有失败/超时/崩溃分支统一走 handoff()，不允许任何分支单独 destroy。
 * ② **白闪/黑闪**：开屏窗 show:false + ready-to-show 再 show（官方防闪
 *    机制）；收场用页面内 CSS 渐隐（250ms）+ 主进程独立倒计时后 destroy
 *    （渲染层卡死也不悬挂，渐隐只是观感不是完成条件）。
 * ③ **协议出生锁**：开屏素材走 miai-wall://，协议与白名单必须早于开屏窗
 *    出生（custom-protocol-birth-lock 的教训），所以素材目录的登记在主进程
 *    index.ts 里 primeWallProtocol **之前**完成，与本模块无关——本模块只
 *    负责「怎么播、怎么收场」。
 *
 * 【时间线】timeline 从 t0（本模块创建时刻）记六个刻度 + 事件流水，
 * 收场时推给主窗渲染层（window.__splashStats）—— P2 的定标判据全从这里取值，
 * **快照必须来自真时间戳，不许事后估算**。
 */
import { BrowserWindow, screen, type WebContents } from 'electron'
import { totalmem } from 'os'
import { join } from 'path'
import { IPC } from '../../shared/ipc-channels'
import { miaiWallUrl } from '../../shared/miai-wall-url'
import {
  DESTROY_SLOP_MS,
  FADE_MS,
  HARD_CAP_MS,
  HOLD_HINT_MS,
  MAX_PLAY_MS,
  MEDIA_DEADLINE_MS,
  SHOW_GUARD_MS,
  SPLASH_OPAQUE_BG,
  decideSplash,
  type SplashConfig,
  type SplashEndReason,
  type SplashPageEvent,
  type SplashPagePayload,
  type SplashTimeline
} from '../../shared/splash'
import { scanSplashMaterials } from './material'
import { coversFor } from '../../shared/splash-covers'

export interface SplashGateDeps {
  /** 主窗（已构造、show:false、尚未 load —— 见 index.ts 的调用顺序） */
  mainWindow: BrowserWindow
  /** 主窗就绪承诺（ready-to-show / 加载失败 / 渲染进程崩溃三选一兑现） */
  mainReady: Promise<void>
  config: SplashConfig
  /** [内置, 用户] 顺序即同名去重优先级（splashMaterialDirs 算出来的） */
  materialDirs: string[]
  /** out/preload/splash.js 的绝对路径 */
  preloadPath: string
  /** 打包后的 renderer 根目录（loadFile('splash.html') 的基） */
  rendererDir: string
  /** dev 下 Vite 的 http 根（有它就走 loadURL 而不是 loadFile）；生产恒 null */
  rendererUrl: string | null
  /** `--no-splash` / MIAI_NO_SPLASH=1 */
  noSplashFlag: boolean
  /** MIAI_SPLASH_FORCE=1（越过低内存安全阀） */
  force: boolean
}

export interface SplashGate {
  /** 开屏窗；跳过时 null（主进程 module 级 splashWinRef 也指向它，供主题遍历跳过） */
  splashWindow: BrowserWindow | null
  /** `splash:event` 的转发口（index.ts 的 handler 调它；sender 在内部校验） */
  onEvent(sender: WebContents, ev: unknown): void
  /** `splash:get` 的应答；来源不对/没在播 → null（页面据此自报 error 收场） */
  getPayload(sender: WebContents): SplashPagePayload | null
  /** `splash:stats:get` 的应答（深拷贝快照，防外部改到活对象） */
  stats(): SplashTimeline
}

export function createSplashGate(deps: SplashGateDeps): SplashGate {
  const t0 = Date.now()
  const at = (): number => Math.round(Date.now() - t0)
  const timeline: SplashTimeline = {
    t0,
    tSplashShow: null,
    tFirstFrame: null,
    tMainReady: null,
    tHandoff: null,
    tMainShown: null,
    tDestroyed: null,
    reason: null,
    skipped: null,
    file: null,
    materialCount: 0,
    totalMemGB: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    events: []
  }
  const note = (e: string): void => {
    timeline.events.push(e)
  }

  let splashWindow: BrowserWindow | null = null
  let settled = false // 播放侧收场原因已定（幂等）
  let forced = false // HARD_CAP 已到，允许不等 mainReady 就交接
  let handedOff = false // handoff() 已执行（幂等）
  let statsPushed = false

  const files = scanSplashMaterials(deps.materialDirs)
  timeline.materialCount = files.length
  const decision = decideSplash({
    config: deps.config,
    noSplashFlag: deps.noSplashFlag,
    force: deps.force,
    totalMemGB: timeline.totalMemGB,
    files,
    rand: Math.random
  })

  /** 所有延时都从这里走：一次性的 setTimeout，用内部守卫幂等，不维护取消表 */
  const later = (ms: number, fn: () => void): void => {
    setTimeout(fn, ms)
  }

  // 主窗「首次显示」刻度 —— 字段注释见 shared/splash.ts 的 tMainShown。
  // 挂窗口 'show' 事件而不是包 show() 调用点：任何路径把主窗推上屏都被如实
  // 记下（堵「抢跑」类回归）；首次之后不再改写。
  deps.mainWindow.on('show', () => {
    if (timeline.tMainShown === null) timeline.tMainShown = at()
  })

  // mainReady 的兑现先记时间线（注册顺序保证早于下面的交接判断）
  deps.mainReady.then(() => {
    timeline.tMainReady = at()
    note('main-ready')
    maybeHandoff()
  })

  /** 播放侧收场：记原因（只记第一次），然后看能不能交接 */
  function settle(reason: SplashEndReason): void {
    if (settled) return
    settled = true
    timeline.reason = reason
    note('settle:' + reason)
    maybeHandoff()
    // 「播完了主窗还没好」→ 过一会儿把页面提示从「跳过」切成「正在准备界面」
    later(HOLD_HINT_MS, () => {
      if (handedOff || timeline.tMainReady !== null) return
      note('hold-hint')
      sendToSplash(IPC.splashHold)
    })
  }

  function maybeHandoff(): void {
    if (handedOff) return
    if (!settled) return
    if (timeline.tMainReady === null && !forced) return
    handoff()
  }

  /**
   * 交接 —— 全流程唯一的收场口，幂等。
   * 顺序铁律：**先让主窗上屏，再动开屏窗**（零窗口闪退 + 黑屏空窗都堵在这）。
   */
  function handoff(): void {
    if (handedOff) return
    if (!settled) return
    if (timeline.tMainReady === null && !forced) return
    handedOff = true
    timeline.tHandoff = at()
    note('handoff')

    if (deps.mainWindow.isDestroyed()) {
      // 主窗已被外力关掉（开屏期间收到 WM_CLOSE / 消息闭环等）：没有可交接的
      // 对象了。不判这一下的话，下面的 show()/isVisible() 都会对已销毁窗口
      // 抛 TypeError（2026-10-06 关窗卡死事故同源），异常逃出去就是原生 Error 框。
      // 直接收场开屏窗，剩下的交给 window-all-closed → app.quit()。
      note('main-gone')
      finishHandoff()
      return
    }

    try {
      deps.mainWindow.show()
    } catch (err) {
      console.error('[miai] splash: mainWindow.show() failed', err)
    }
    if (!deps.mainWindow.isVisible()) {
      // 显示守卫：show() 没生效（极罕见，驱动/合成层故障）→ 1500ms 后重试
      // 一次再收开屏窗；开屏窗此刻是唯一可见的窗口，先留着当兜底。
      note('show-retry')
      later(SHOW_GUARD_MS, () => {
        try {
          deps.mainWindow.show()
        } catch (err) {
          console.error('[miai] splash: mainWindow.show() retry failed', err)
        }
        finishHandoff()
      })
      return
    }
    finishHandoff()
  }

  function finishHandoff(): void {
    const win = splashWindow
    if (!win || win.isDestroyed()) {
      // 没有开屏窗（跳过路径 / 外力已关）——交接到此为止，推时间线
      pushStats()
      return
    }
    note('fade')
    win.setIgnoreMouseEvents(true) // 渐隐期间别让将死的开屏窗再吃输入
    sendToSplash(IPC.splashFade)
    later(FADE_MS + DESTROY_SLOP_MS, () => {
      if (win.isDestroyed()) return
      win.destroy() // closed 事件里记 tDestroyed + pushStats
    })
  }

  function sendToSplash(channel: string): void {
    const win = splashWindow
    if (!win || win.isDestroyed()) return
    win.webContents.send(channel)
  }

  /**
   * 推时间线给主窗渲染层。幂等；主窗还在加载就先等 did-finish-load
   * （销毁先于渲染层挂载发生时不能丢证据）。
   */
  function pushStats(): void {
    if (statsPushed) return
    statsPushed = true
    const mw = deps.mainWindow
    if (mw.isDestroyed()) return // 主窗已销毁：webContents getter 会抛，证据止步于此
    const wc = mw.webContents
    if (wc.isDestroyed()) return
    const payload = gate.stats()
    const deliver = (): void => {
      try {
        wc.send(IPC.splashStats, payload)
      } catch {
        /* 窗口正在销毁的竞态：证据已经尽力，不再补 */
      }
    }
    if (wc.isLoading()) wc.once('did-finish-load', deliver)
    else deliver()
  }

  // ---------------------------------------------------------------- 播放路径

  if (decision.action === 'play') {
    timeline.file = decision.file.name

    const wa = screen.getPrimaryDisplay().workAreaSize
    const width = Math.min(1280, Math.round(wa.width * 0.85))
    const height = Math.min(720, Math.round(wa.height * 0.85))

    const win = new BrowserWindow({
      width,
      height,
      show: false,
      frame: false,
      // 默认透明（批复⑥）；opaque=true 是一键兜底（驱动透明失效时用）
      transparent: !deps.config.opaque,
      backgroundColor: deps.config.opaque ? SPLASH_OPAQUE_BG : '#00000000',
      hasShadow: false,
      roundedCorners: false, // 满幅视频不要 DWM 圆角（Win11 无边框窗默认给）
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      // ⚠️ 必须置顶：交接时主窗 show() 会抢到最前，没有它渐隐被盖住=硬切
      alwaysOnTop: true,
      // ⚠️ 绝不设 paintWhenInitiallyHidden（保持默认 true）——置 false 会让
      // ready-to-show 永不触发，show 信号整条链断掉，且失败方式是静默的。
      // focusable 也不设：保持默认 true，「任意键跳过」靠它。
      webPreferences: {
        preload: deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // 开屏窗被别的窗遮住时（alwaysOnTop 之下几乎不可能）也别冻掉计时器
        backgroundThrottling: false
      }
    })
    splashWindow = win
    win.center()

    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      win.show()
      timeline.tSplashShow = at()
      note('splash-show')
      // 首帧等候上限从「显示那一刻」起算（素材读取慢是允许的，6s 是上限）
      later(MEDIA_DEADLINE_MS, () => {
        if (!settled && timeline.tFirstFrame === null) settle('no-frame')
      })
      // 显示守卫的另一半：1500ms 后复核窗口真的可见（幂等再 show 一次）
      later(SHOW_GUARD_MS, () => {
        if (win.isDestroyed() || handedOff) return
        if (!win.isVisible()) {
          note('show-guard-retry')
          win.show()
        }
      })
    })

    // 页面加载失败（splash.html 没打进包 / 路径错）——如实收场，不悬挂
    win.webContents.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) {
        note('page-fail:' + String(code))
        settle('media-error')
      }
    })

    win.on('closed', () => {
      splashWindow = null
      if (timeline.tDestroyed === null) timeline.tDestroyed = at()
      note('destroyed')
      if (handedOff) {
        pushStats()
      } else {
        // 外力关闭（正常路径到不了这里）：开屏窗没了也得照样把主窗交出去
        settle('window-gone')
      }
    })

    // 跳过：主进程侧键盘兜底（页面解析前的 100~300ms 输入窗口也被盖住）
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown') {
        note('key')
        settle('skip')
      }
    })
    // 跳过：主进程侧鼠标兜底（滤成按下，移动不算）
    win.webContents.on('before-mouse-event', (_e, mouse) => {
      if (mouse.type === 'mouseDown') {
        note('mouse')
        settle('skip')
      }
    })

    if (deps.rendererUrl) {
      win.loadURL(deps.rendererUrl.replace(/\/+$/, '') + '/splash.html')
    } else {
      win.loadFile(join(deps.rendererDir, 'splash.html'))
    }
  } else {
    timeline.skipped = decision.reason
    // ⚠️ 跳过路径也要把「播放侧已收场」置位 —— 否则 maybeHandoff 永远等
    // settle()，主窗一直不 show，只能干等到 15 秒硬上限（真机上就是
    // 「关掉开屏后启动反而慢 15 秒」）。跳过与播放的区分靠 timeline.skipped，
    // 不靠 settled；settled 只表示「不会再有播放事件了」。
    settled = true
    note('skip:' + decision.reason)
    maybeHandoff()
  }

  // 绝对上限：无论卡在哪一步（窗口没显示/主窗没就绪/视频没首帧），一律交接
  later(HARD_CAP_MS, () => {
    if (handedOff) return
    forced = true
    note('hard-cap')
    if (!settled) settle('hard-cap')
    else maybeHandoff()
  })

  // ---------------------------------------------------------------- 对外口

  function onEvent(sender: WebContents, ev: unknown): void {
    const win = splashWindow
    if (!win || win.isDestroyed() || sender !== win.webContents) return // 只认开屏窗
    const type = (ev as SplashPageEvent | null)?.type
    switch (type) {
      case 'meta':
        note('meta')
        break
      case 'first-frame':
        if (timeline.tFirstFrame === null) {
          timeline.tFirstFrame = at()
          note('first-frame')
          // 首帧后最多再播 MAX_PLAY（长素材的收口；短视频自然走 ended）
          later(MAX_PLAY_MS, () => {
            if (!settled) settle('max-play')
          })
        }
        break
      case 'ended':
        settle('ended')
        break
      case 'error': {
        const code = (ev as SplashPageEvent).code
        note('media-error:' + String(code ?? '?'))
        settle('media-error')
        break
      }
      case 'stalled':
        note('stalled')
        break
      case 'skip':
        note('skip-asked')
        settle('skip')
        break
      default:
        break // 未知事件不采信（页面是被校验过的，但多一道不亏）
    }
  }

  function getPayload(sender: WebContents): SplashPagePayload | null {
    const win = splashWindow
    if (!win || win.isDestroyed() || sender !== win.webContents) return null
    if (decision.action !== 'play') return null
    return {
      url: miaiWallUrl(decision.file.abs),
      sound: deps.config.sound,
      volume: deps.config.volume,
      fit: deps.config.fit,
      name: decision.file.name,
      // 烤录文字覆盖块按**实际播的文件**查表（不是用户指定的名字——fixed
      // 未命中回退时播的和配的可能不是一个文件，覆盖必须跟着实际画面走）
      covers: coversFor(decision.file.name)
    }
  }

  const gate: SplashGate = {
    get splashWindow() {
      return splashWindow
    },
    onEvent,
    getPayload,
    stats: () => ({ ...timeline, events: [...timeline.events] })
  }
  return gate
}
