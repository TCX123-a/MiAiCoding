/**
 * 大肥鱼桌宠的**主进程控制器**（2026-10-06）—— 生命周期、状态、行为全在这。
 *
 * 【它是什么】一个覆盖整个工作区的透明置顶窗（宠物窗）+ 一份 pet.json 状态
 * （store.ts）+ 三件它自己会干的事：按时间饿、盯着 CPU、被叫去报错现场。
 * 桌宠的"智能"全在主进程：宠物窗（renderer/public/pet.html）是个**哑视图** ——
 * 只负责画和动，所有判定（该说什么话、走哪儿、还能不能喂）都在这份文件里，
 * 台词一律从 shared/copy.ts 取。这样"桌宠说了什么"可以脱离画面被审阅。
 *
 * 【为什么宠物窗是"全工作区透明窗 + 页内移动"，不是"小窗跟着走"】
 * 让宠物移动的朴素做法是每帧 win.setPosition —— 主进程以 60Hz 调原生窗口
 * 移动，抖动肉眼可见，而且跨 DPI 屏幕会漂。改成"窗口铺满工作区、精灵在页面里
 * 用 CSS 动"之后：60Hz 只是渲染进程的一次样式写入，零 IPC、零原生调用。
 * 代价是全窗默认要**鼠标穿透**（否则它会吞掉整个桌面/应用的点击）——
 * 穿透策略见下面的 cursorTick：轮询全局光标，只在光标的的确确落在精灵身上时
 * 才把窗口设成可点。这是开源项目（1190fasheqi/dafeiyu-pet）在同款场景下的
 * 成熟做法，我们照搬了它的核心不变量，用 JS 重写（不引 Python 依赖）。
 *
 * 【窗口为什么 focusable:true】看起来"桌面挂件"该 focusable:false（永不抢焦点），
 * 但聊天面板的输入框需要键盘焦点 —— focusable:false 的窗口收不到键盘。
 * 折中是：平时可点区域只有精灵本身（穿透策略保证），点它=主动互动，
 * 那一刻把焦点交给宠物窗是符合直觉的。
 *
 * 【生命周期铁律】宠物窗只在主窗存在时存在：
 *   · 主窗 closed → dispose()（宠物窗销毁、定时器全停）——**这一条同时是
 *     window-all-closed 的兜底**：宠物窗如果活着，主窗关了应用也不会退出；
 *   · 主窗最小化/隐藏 → 宠物窗 hide()（"桌宠只在咪爱编程打开时出现"的字面义）；
 *   · 用户开关（petAct show/hide）→ 建/毁宠物窗，状态落 pet.json。
 */
import { BrowserWindow, Menu, net, powerMonitor, screen, type MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { cpus } from 'os'
import { IPC } from '../../shared/ipc-channels'
import { PET } from '../../shared/copy'
import {
  PET_CHAT_REPLY_TOKENS,
  PET_DECAY_OFFLINE_PERIOD_MS,
  PET_DECAY_ONLINE_PERIOD_MS,
  PET_INTERACT_COOLDOWN_MS,
  PET_LONG_AWAY_MS,
  PET_MEMORY_STREAK,
  PET_PRAISE_COOLDOWN_MS,
  PET_PROACTIVE_COOLDOWN_MS,
  PET_PROACTIVE_IDLE_MS,
  PET_RUA_COOLDOWN_MS,
  PET_WRONG_COOLDOWN_MS,
  addAffection,
  approxPetTokens,
  awayMs,
  decayPet,
  feedPet,
  grantPetRice,
  lastWrongLabel,
  lessonStreak,
  normalizeRunReport,
  parsePetAction,
  parsePetHitRects,
  petChatCommit,
  petChatGate,
  petDayKey,
  petFace,
  pushPetMemory,
  sanitizePetChat,
  setPetEmotion,
  setPetMode,
  setPetSize,
  setPetPos,
  snapshotOf,
  touchPetSeen,
  withPetEnabled,
  type PetAction,
  type PetChatResult,
  type PetCmd,
  type PetHitRect,
  type PetMode,
  type PetRewardKind,
  type PetRunReport,
  type PetSettingsShortcut,
  type PetSnapshot,
  type PetState
} from '../../shared/pet'
import type { AppConfig } from '../../shared/types'
import { chatPet, type AiDeps } from '../ai/deepseek'
import { createPetStore, type PetStore } from './store'

export interface PetControllerDeps {
  storageDir: string
  /** out/preload/pet.js 的绝对路径 */
  preloadPath: string
  /** out/renderer 目录（pet.html 的家） */
  rendererDir: string
  /** dev 时的 Vite 地址；打包为 null */
  rendererUrl: string | null
  /** 现读配置（桌宠聊天要复用设置页配好的 Key / baseUrl / 模型） */
  getConfig: () => AppConfig
}

export interface PetController {
  /** 宠物窗（没建/已销毁时 null）。applyNativeTheme 要靠它跳过这个透明窗 */
  window(): BrowserWindow | null
  /** 主窗就绪后接上（建宠物窗、挂生命周期钩子、起心跳）。只接一次 */
  attach(mainWin: BrowserWindow): void
  /** 主窗销毁/应用退出时收摊：定时器全停、宠物窗销毁。幂等 */
  dispose(): void
  /** 拉当前快照（设置卡与宠物窗的读口） */
  init(): PetSnapshot
  /** 执行一个动作（入参未清洗，控制器内部过 parsePetAction） */
  act(raw: unknown): Promise<PetSnapshot>
  /** 主窗渲染层的运行结果上报 */
  reportRun(raw: unknown): void
  /** 宠物窗上报的鼠标命中区 */
  hit(raw: unknown): void
  /** 桌宠聊天 */
  chat(raw: unknown): Promise<PetChatResult>
}

/** 心跳：衰减、CPU 采样。30 秒一次 —— 分针级的行为，这个粒度绰绰有余 */
const HEARTBEAT_MS = 30_000
/** 光标轮询：穿透策略的判据。60ms ≈ 16Hz，比人手快，开销可忽略（一个原生调用） */
const CURSOR_POLL_MS = 60
/** 空闲判定轮询：1s 一次（原生调用极便宜）。醒要比"睡着"快 —— 一动就醒 */
const IDLE_POLL_MS = 1_000
/** 电脑无输入多久算"人不在"→ 桌宠自己去睡。3 分钟：够短到真的会触发，
 *  够长到"想了想事情没碰键鼠"不会误判 */
const PET_IDLE_SLEEP_SEC = 180
/** 跟随模式推光标位置的节流（再快就是在烧 IPC，宠物追得再紧也没意义） */
const FOLLOW_PUSH_MS = 100
/** CPU 判定：连续两次心跳（=1 分钟）都在这个水位以上才算"烧" */
const CPU_HOT_LEVEL = 0.9
const CPU_HOT_STREAK = 2
/** CPU 冒泡的冷却：这么热闹的提醒，十分钟一次已经够烦了 */
const CPU_QUIP_COOLDOWN_MS = 10 * 60_000

export function createPetController(deps: PetControllerDeps): PetController {
  const store: PetStore = createPetStore(deps.storageDir)
  /** 内存里那份真状态。所有改动都必须走 commit() 落盘 + 广播 */
  let state: PetState
  {
    // 启动时先把"关着软件的那段时间"扣掉：离线速率（-1/10min）比在线慢，
    // 睡一觉回来掉一半左右，一整天不碰才彻底饿扁 —— 每日学习是正反馈，
    // 旷一天也不至于看见尸体（本鱼不搞死亡机制，饿只是蔫）。
    const loaded = store.load(new Date().toISOString())
    const decayed = decayPet(loaded.state, new Date().toISOString(), PET_DECAY_OFFLINE_PERIOD_MS)
    state = decayed.state
    // 锚点变过也要落盘（不只是掉过饱食度）：饱食度 0 时的衰减、时钟回拨的
    // 重锚，都是 "dropped=0 但锚点必须存" 的情形 —— 只看 dropped 的话
    // 锚点会冻在过去，之后一喂饭就被"补扣"成 0（喂了跟没喂一样，还查不出原因）
    if (loaded.created || decayed.dropped > 0 || decayed.state.lastDecayAt !== loaded.state.lastDecayAt) {
      store.save(state)
    }
  }

  let win: BrowserWindow | null = null
  let mainWin: BrowserWindow | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let cursorTimer: ReturnType<typeof setInterval> | null = null
  let idleTimer: ReturnType<typeof setInterval> | null = null
  let disposed = false

  /** 桌宠当前是不是"睡着"（空闲指令的翻转记忆 —— 只在翻转时发指令） */
  let petSleeping = false

  /** 宠物窗报上来的可点区域（宠物窗坐标）。空数组 = 全穿透 */
  let hitRects: PetHitRect[] = []
  /** 穿透开关的现值，null = 还没设过。只在翻转时调原生接口（防抖/防闪） */
  let mouseIgnoring: boolean | null = null
  let lastFollowPush = 0

  /** 台词轮转计数：同一句连说两遍像坏掉的复读机 */
  let lineTick = 0
  const pickLine = (lines: readonly string[]): string => {
    const line = lines[lineTick % lines.length] ?? ''
    lineTick += 1
    return line
  }

  /** 互动冷却（喂饭/摸头共用一股）：按住连点不能刷饱食度 */
  let lastInteractAt = 0

  /** 饿扁了有没有喊过（回饱后清零）。喊一次就够，别每隔半分钟念一遍 */
  let sobbed = false

  /** CPU：上一次采样的 {idle,total} 与"连续过热"计数、上次冒泡时间 */
  let prevCpu: { idle: number; total: number } | null = null
  let cpuStreak = 0
  let lastCpuQuipAt = 0

  // ---- 活体模式的节拍器（2026-10-06 第二阶段）

  /**
   * "主人最后一次真的干了点什么"。喂饭/摸头/发奖/rua/答错/聊天/运行上报
   * 都戳它一下；长时间不动主动搭话就是 `now - lastActivityAt`。
   * 【为什么 `pos` 不算】它是宠物窗自己存位置的机器心跳，不是人干的事 ——
   * 把它算进去的话"长时间不动"永远不会触发（鱼一直在动，主人早走了）。
   */
  let lastActivityAt = Date.now()
  let lastRuaQuipAt = 0
  let lastWrongQuipAt = 0
  let lastPraiseAt = 0
  let lastProactiveAt = 0
  /** attach 那一刻算好的"这次隔了多久"（问候语按它选档）。touchPetSeen 之后就没了 */
  let awayOnLaunch = 0
  /** 没配 Key 的通告每次启动只说一次；定时器放句柄，dispose 要清 */
  let noKeyNoticed = false
  let noKeyTimer: ReturnType<typeof setTimeout> | null = null
  /** 音效设置现值（null = 还没推过）。心跳采样，**变了才推** */
  let lastSoundOn: boolean | null = null
  let lastSoundVolume = -1

  // ---------------------------------------------------------------- 落盘与广播

  function commit(): void {
    store.save(state)
    broadcast()
  }

  function broadcast(): void {
    const snap = snapshotOf(state, new Date().toISOString())
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue
      // 渲染进程崩了的窗口，send 会抛 "Object has been destroyed" 一类的错 ——
      // 一次广播炸掉整个心跳的话，饥饿衰减/主动搭话会跟着停摆。吞掉，等它重建
      try {
        w.webContents.send(IPC.petState, snap)
      } catch {
        /* 窗口半死：跳过这一家，别的窗口照收 */
      }
    }
  }

  function sendCmd(cmd: PetCmd): void {
    if (!win || win.isDestroyed()) return
    try {
      win.webContents.send(IPC.petCmd, cmd)
    } catch {
      /* 同上：喂给一个正在崩的窗口不该打断调用方（心跳） */
    }
  }

  function say(text: string): void {
    sendCmd({ kind: 'say', text })
  }

  // ---------------------------------------------------------------- 出场与降级（活体模式）

  /**
   * 出场问候的**选档**：多日不见 > 饿 > 夜里 > 平常。
   * 【为什么"多日不见"盖过"饿"】饿是衰减的结果，两天没来必然也饿着 ——
   * 但这两种委屈不是一回事：一句"好几天了喵"直接回应"你去哪儿了"，
   * 比任何数值都准。（awayOnLaunch 在 attach 时算好，见那里注释。）
   */
  function greetingLine(): string {
    if (awayOnLaunch >= PET_LONG_AWAY_MS) return pickLine(PET.GREETING_LONG_AWAY)
    const face = petFace(state, new Date().toISOString())
    if (face === 'hungry') return pickLine(PET.GREETING_HUNGRY)
    if (face === 'sleepy') return pickLine(PET.GREETING_SLEEPY)
    return pickLine(PET.GREETING)
  }

  /**
   * 音效设置采样：设置页改完开关/音量，下一次心跳（或下一次窗口加载）就同步。
   * 【为什么走 cmd 而不是塞进快照】宠物窗读不到 config（权限最小化的代价），
   * 而"能不能出声"是 config 的话。快照是每秒可能推好几次的高频广播，
   * 不该背着两个几乎不变的字段；音效变化本身低频，一条 cmd 说完就完。
   */
  function soundTick(force: boolean): void {
    let on = false
    let volume = 0
    try {
      const cfg = deps.getConfig()
      on = cfg.soundEnabled && cfg.sfxVolume > 0
      volume = cfg.sfxVolume
    } catch {
      return // 配置还没就绪：保持上一次；下一次心跳再采
    }
    if (!force && on === lastSoundOn && volume === lastSoundVolume) return
    lastSoundOn = on
    lastSoundVolume = volume
    sendCmd({ kind: 'sound', on, volume })
  }

  /** 没有 Key 的出场通告（每次启动最多一次，问候语说完几秒再补一句） */
  function notifyNoKey(): void {
    if (noKeyNoticed || disposed) return
    let hasKey = true
    try {
      hasKey = deps.getConfig().ai.apiKey.trim() !== ''
    } catch {
      return
    }
    if (hasKey) return
    noKeyNoticed = true
    if (noKeyTimer) clearTimeout(noKeyTimer)
    // 晚 6 秒：先让问候语把气泡占了（宠物窗的气泡是排队播的，这里只是
    // 不想两句话挤在一起开场）
    noKeyTimer = setTimeout(() => {
      noKeyTimer = null
      if (!disposed) say(PET.NO_KEY_NOTICE)
    }, 6_000)
  }

  // ---------------------------------------------------------------- 宠物窗

  function createWindow(): void {
    if (win && !win.isDestroyed()) return
    // 铺满**主显示器工作区**（不含任务栏）。只认主屏：多屏时把宠物放在
    // "写代码的那块屏"上才是对的，而应用窗口通常在主屏 —— 之后若要跟屏，
    // 改这里一处即可（坐标换算全是相对的，见 toPetAnchor）。
    const wa = screen.getPrimaryDisplay().workArea
    win = new BrowserWindow({
      x: wa.x,
      y: wa.y,
      width: wa.width,
      height: wa.height,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      // 透明窗的底色必须**构造时**给带 alpha 的值（'#00000000'）——
      // 和开屏窗踩过的是同一个坑：构造后 setBackgroundColor 给不出透明度。
      backgroundColor: '#00000000',
      webPreferences: {
        preload: deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // 被别的窗口盖住时页面里的 rAF 会被系统掐到 1Hz —— 走路动画会定格。
        // 断掉节流；hide() 时 rAF 本来就会停（那是我们要的：藏起来就别动）
        backgroundThrottling: false
      }
    })
    win.setIgnoreMouseEvents(true, { forward: true })
    mouseIgnoring = true
    hitRects = []

    const self = win
    win.once('ready-to-show', () => {
      // 主窗没显示（还在开屏/已最小化）就先不露头 —— 开屏盖全屏时一只鱼
      // 从开屏上飘过去是纯惊吓
      if (mainWin && !mainWin.isDestroyed() && mainWin.isVisible() && !mainWin.isMinimized()) {
        // showInactive 而不是 show：这个窗铺满全屏，show() 会**从主窗抢焦点** ——
        // 用户刚要打字，鱼一露头把键盘焦点端走了（"界面卡住"的体感来源）
        self?.showInactive()
      }
    })

    // 页面加载/渲染进程失败的**一次自愈**：重试一次 reload；再失败就认了
    // （一块全透明的破玻璃，人眼本来就看不见，重试风暴才是真问题）。
    // 主窗完全不受影响 —— 这是"断网/页面坏绝不拖垮主界面"在宠物窗上的对应条款。
    let healed = false
    const healOnce = (): void => {
      if (healed || disposed || self !== win || self.isDestroyed()) return
      healed = true
      setTimeout(() => {
        if (!disposed && self === win && !self.isDestroyed()) self.webContents.reload()
      }, 800)
    }
    win.webContents.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
      // -3 = ERR_ABORTED：窗口销毁/换页途中被掐断，不是失败
      if (isMainFrame && code !== -3) healOnce()
    })
    win.webContents.on('render-process-gone', () => {
      if (self === win) healOnce()
    })

    win.webContents.on('did-finish-load', () => {
      // 宠物窗每次加载完先灌状态、同步音效设置，再说第一句话（选档见 greetingLine）
      win?.webContents.send(IPC.petState, snapshotOf(state, new Date().toISOString()))
      soundTick(true)
      const greeting = greetingLine()
      awayOnLaunch = 0 // 用过一次就清（同一次会话重开桌宠不再"好几天不见"）
      say(greeting)
      notifyNoKey()
    })

    win.on('closed', () => {
      win = null
      mouseIgnoring = null
      hitRects = []
      stopCursorTimer()
      stopIdleTimer()
    })

    if (deps.rendererUrl) win.loadURL(`${deps.rendererUrl}/pet.html`)
    else win.loadFile(join(deps.rendererDir, 'pet.html'))

    startCursorTimer()
    startIdleTimer()
  }

  function destroyWindow(): void {
    stopCursorTimer()
    stopIdleTimer()
    if (win && !win.isDestroyed()) win.destroy()
    win = null
    mouseIgnoring = null
    hitRects = []
  }

  function showPet(): void {
    if (disposed || !state.enabled) return
    if (!win || win.isDestroyed()) createWindow()
    // showInactive：把鱼放出来时**不许动键盘焦点**（见 ready-to-show 的注释）
    else if (!win.isVisible()) win.showInactive()
    // 露头时必须醒着：藏着那段时间空闲轮询是静默的（见 idleTick），页面
    // 可能还停在"睡着"—— 一条显式的唤醒指令把主进程与页面对齐。
    // 新窗（还没 load 完）收不到这条，但新页面本来就是醒的，两边一致
    sendCmd({ kind: 'idle', on: false })
    petSleeping = false
  }

  function hidePet(): void {
    if (win && !win.isDestroyed() && win.isVisible()) win.hide()
  }

  // ---------------------------------------------------------------- 鼠标穿透

  /**
   * 光标轮询：全局光标落在宠物窗的哪个位置，决定窗口吃不吃鼠标。
   *
   * 【判据为什么用轮询全局光标，而不是页面里的 mouseenter】窗口在"穿透"
   * 状态时页面收不到任何鼠标事件（事件直达下层窗口），拿不到 enter ——
   * 死锁：穿透了就永远回不来。唯一可靠的信源是主进程的全局光标位置
   * （screen.getCursorScreenPoint），这也是开源项目的做法。
   *
   * 【只翻转，不重复设】setIgnoreMouseEvents 每次调用都是一次原生调用，
   * 60ms 一次一直设会让某些驱动上的光标出现高频闪烁 —— 记住现值，翻转才调。
   */
  function cursorTick(): void {
    const w = win
    if (!w || w.isDestroyed()) return
    const p = screen.getCursorScreenPoint()
    const pb = w.getContentBounds()
    const x = p.x - pb.x
    const y = p.y - pb.y
    const inside =
      x >= 0 &&
      y >= 0 &&
      x < pb.width &&
      y < pb.height &&
      hitRects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)
    const shouldIgnore = !inside
    if (mouseIgnoring !== shouldIgnore) {
      w.setIgnoreMouseEvents(shouldIgnore, { forward: true })
      mouseIgnoring = shouldIgnore
    }
    // 跟随模式：把光标位置推给宠物窗（它自己算朝哪儿走）。
    // 注意**不**受穿透开关影响：光标在编辑器里时鱼也要跟着走 ——
    // "忽略鼠标"说的是窗口不吃点击，不是"我看不见鼠标"。
    if (state.mode === 'follow') {
      const now = Date.now()
      if (now - lastFollowPush >= FOLLOW_PUSH_MS) {
        lastFollowPush = now
        sendCmd({ kind: 'cursor', x, y })
      }
    }
  }

  function startCursorTimer(): void {
    if (cursorTimer) return
    cursorTimer = setInterval(cursorTick, CURSOR_POLL_MS)
  }

  function stopCursorTimer(): void {
    if (cursorTimer) clearInterval(cursorTimer)
    cursorTimer = null
  }

  /**
   * 空闲轮询：电脑多久没人碰了（powerMonitor.getSystemIdleTime，秒）。
   * ≥ 阈值 → 发 idle:on 让鱼睡下；人一回来（空闲时间清零）→ idle:off 唤醒。
   *
   * 【只在翻转时发】1 秒一次的轮询里绝大多数时候什么都不做（一个原生调用 +
   * 一次比较），宠物窗不用每秒钟收一条"还没醒"。
   * 【隐藏时不发、但把状态归位】主窗最小化期间鱼也藏着 —— 给看不见的窗口
   * 发指令纯浪费，而且分不清"在睡觉"还是"没显示"。归位成"醒着"，下次
   * 露头就是正常状态；真还空着的话 3 分钟后自然再睡一遍。
   */
  function idleTick(): void {
    const w = win
    if (!w || w.isDestroyed()) return
    // 藏着时什么都不发（给看不见的窗口发指令纯浪费）；露头那一刻由 showPet
    // 显式发一条"醒着"把两边对齐 —— 不然"睡着时被藏起来"会卡在睡梦里
    if (!w.isVisible()) return
    const shouldSleep = powerMonitor.getSystemIdleTime() >= PET_IDLE_SLEEP_SEC
    if (shouldSleep === petSleeping) return
    petSleeping = shouldSleep
    sendCmd({ kind: 'idle', on: shouldSleep })
  }

  function startIdleTimer(): void {
    if (idleTimer) return
    idleTimer = setInterval(idleTick, IDLE_POLL_MS)
  }

  function stopIdleTimer(): void {
    if (idleTimer) clearInterval(idleTimer)
    idleTimer = null
    petSleeping = false
  }

  // ---------------------------------------------------------------- 心跳：饥饿与 CPU

  function heartbeatTick(): void {
    if (disposed) return
    const nowIso = new Date().toISOString()
    const { state: next, dropped } = decayPet(state, nowIso, PET_DECAY_ONLINE_PERIOD_MS)
    // 落盘条件是「掉过饱食度 **或** 锚点变过」——第二种是饱食度已为 0 时
    // 锚点仍在按整周期推进、以及时钟回拨的重锚。只看 dropped 的话锚点会
    // 悄悄冻在过去：饿扁期间喂一碗，下一次心跳会把攒了几小时的"补扣"一次
    // 吃完（喂了跟没喂一样，且现象完全无法归因）。锚点每 3 分钟才推进一档，
    // 不是每 30 秒都写盘。
    if (dropped > 0 || next.lastDecayAt !== state.lastDecayAt) {
      state = next
      store.save(state)
      broadcast()
      // 饿扁的第一时间喊一句（回饱之前不重复）
      if (state.satiety <= 0 && !sobbed) {
        sobbed = true
        say(PET.HUNGRY_SOB)
      }
    }
    if (state.satiety > 0) sobbed = false
    cpuTick()
    proactiveTick()
    soundTick(false)
  }

  /**
   * 长时间不动 → 主动搭话。
   *
   * 【为什么只在主窗**有焦点**时开口】鱼是常驻置顶窗：主人去别的软件里
   * 干正事的时候，屏幕上突然飘一句"还在吗喵"是最典型的好心办坏事。
   * 有焦点 = 他此刻确实在这个应用里，搭话才成立。
   *
   * 【为什么优先说"上次那道错题"】通用搭话（"在吗喵"）说三遍就是噪音；
   * 挂着一道没弄懂的题时，那句《课名》的问句是唯一**真的有用**的搭话——
   * 记忆环的全部意义就在这一句上。两条各有 20 分钟冷却，不会连珠炮。
   */
  function proactiveTick(): void {
    const w = win
    const mw = mainWin
    if (!w || w.isDestroyed() || !w.isVisible()) return
    if (!mw || mw.isDestroyed() || !mw.isFocused()) return
    const now = Date.now()
    if (now - lastActivityAt < PET_PROACTIVE_IDLE_MS) return
    if (now - lastProactiveAt < PET_PROACTIVE_COOLDOWN_MS) return
    lastProactiveAt = now
    const label = lastWrongLabel(state)
    say(label !== null ? PET.PROACTIVE_MEMORY(label) : pickLine(PET.PROACTIVE))
  }

  /**
   * CPU 采样：两次心跳之间 os.cpus() 的累计时间差算使用率。
   * 连续两个心跳 ≥90% 才算"烧"（单次 30 秒的高位很常见：编译正好撞上），
   * 冒泡有 10 分钟冷却（不然一出戏就一直在喊）。
   */
  function cpuTick(): void {
    let idle = 0
    let total = 0
    for (const c of cpus()) {
      idle += c.times.idle
      total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq
    }
    const prev = prevCpu
    prevCpu = { idle, total }
    if (!prev) return
    const dTotal = total - prev.total
    const dIdle = idle - prev.idle
    if (dTotal <= 0) return
    const usage = 1 - dIdle / dTotal
    cpuStreak = usage >= CPU_HOT_LEVEL ? cpuStreak + 1 : 0
    const now = Date.now()
    if (cpuStreak >= CPU_HOT_STREAK && now - lastCpuQuipAt >= CPU_QUIP_COOLDOWN_MS) {
      lastCpuQuipAt = now
      say(PET.CPU_HOT)
    }
  }

  // ---------------------------------------------------------------- 动作

  async function act(raw: unknown): Promise<PetSnapshot> {
    const action = parsePetAction(raw)
    const nowIso = new Date().toISOString()
    if (!action) return snapshotOf(state, nowIso)
    // 除了 'pos'（宠物窗存位置的机器心跳），其余都算"人干了点什么" ——
    // 主动搭话的"长时间不动"就靠这个戳（见 lastActivityAt 的注释）
    if (action.action !== 'pos') lastActivityAt = Date.now()
    switch (action.action) {
      case 'feed':
        doFeed()
        break
      case 'pat':
        doPat()
        break
      case 'grant':
        doGrant(action.reward)
        break
      case 'rua':
        doRua()
        break
      case 'chat':
        doChatOpen()
        break
      case 'wrong':
        doWrong(action)
        break
      case 'mode':
        state = setPetMode(state, action.mode)
        commit()
        break
      case 'size':
        // 换体型走 commit（要广播）：宠物窗收到新快照自己换素材、重报命中区
        state = setPetSize(state, action.size)
        commit()
        break
      case 'pos':
        // 只落盘、不广播：位置是宠物窗自己报回来的（它比谁都清楚），
        // 其余窗口没人看 x/y —— 广播一次就是全窗口白跑一趟 IPC
        state = setPetPos(state, action.x, action.y)
        store.save(state)
        break
      case 'show':
        if (!state.enabled) {
          state = withPetEnabled(state, true)
          commit()
        }
        showPet()
        break
      case 'hide':
        if (state.enabled) {
          state = withPetEnabled(state, false)
          commit()
        }
        destroyWindow()
        break
      case 'menu':
        popupMenu()
        break
    }
    return snapshotOf(state, new Date().toISOString())
  }

  function doFeed(): void {
    if (Date.now() - lastInteractAt < PET_INTERACT_COOLDOWN_MS) return
    lastInteractAt = Date.now()
    const { state: next, ok } = feedPet(state)
    if (!ok) {
      say(pickLine(PET.FEED_EMPTY))
      return
    }
    state = next
    commit()
    say(pickLine(PET.FEED_OK))
    sendCmd({ kind: 'anim', name: 'chomp' })
  }

  function doPat(): void {
    if (Date.now() - lastInteractAt < PET_INTERACT_COOLDOWN_MS) return
    lastInteractAt = Date.now()
    // V1-46（2026-10-15 夜）：摸头只涨好感、不再回饱食度 —— 旧 patPet 已删，
    // 这里改走唯一的好感入口 addAffection（kind='pat'，+1/日5）。
    // 本引擎已退役（活的是 dshpet/brain.ts），改动只为跟随口径不落反例。
    state = addAffection(state, 'pat', new Date().toISOString()).state
    commit()
    say(pickLine(PET.PAT))
  }

  /**
   * 被 rua（宠物窗数出"短时间连点 ≥5 下"才发这一条）。
   * 【为什么节流仍在这儿】阈值由宠物窗本地数（要即时的手感），但"说不说"
   * 由这里定：连点完隔两秒又来一轮，气泡会变成弹幕 —— 4 秒冷却，
   * 每轮最多一句。动作本身（压扁 + 吱一声）在宠物窗本地已经演完了。
   */
  function doRua(): void {
    const now = Date.now()
    if (now - lastRuaQuipAt < PET_RUA_COOLDOWN_MS) return
    lastRuaQuipAt = now
    // 被戳烦了 = 傲娇（一分钟内设置卡状态行与（将来的）姿态都看它）。
    // 没说台词的那几轮（冷却中）不触发情绪 —— 情绪跟"这句回嘴"绑定
    state = setPetEmotion(state, 'tsundere', new Date(now).toISOString())
    commit()
    say(pickLine(PET.RUA))
  }

  /**
   * 答错一题（主窗渲染层上报，课名由它查好带来 —— 主进程没有内容包）。
   *
   * 【为什么"学过/没学过"是两条台词】同一句"这个明明教过"对着**没学到那课**
   * 的学员说，就变成了指责（他当然没见过）；分开之后，没学过的那条从
   * "凶"变成"指路"。learned 由渲染层查 profile 得出，这里只管说。
   *
   * 【记忆照记、嘴按冷却】连错五道题只提一次（30 秒冷却，防念经），但记忆环
   * 该更新还是更新 —— "上次那道题"要的是**最后一道错的**，不是最后一次被
   * 念到的。（课名相同且紧接着再错，则不重复记，见下。）
   */
  function doWrong(action: Extract<PetAction, { action: 'wrong' }>): void {
    const now = Date.now()
    const nowIso = new Date(now).toISOString()
    const last = state.memory.events[state.memory.events.length - 1]
    const sameAsLast =
      last !== undefined &&
      last.kind === 'wrong' &&
      last.label === action.title &&
      now - Date.parse(last.at) < 60_000
    if (!sameAsLast) {
      state = pushPetMemory(state, 'wrong', action.title, nowIso)
      store.save(state)
    }
    if (now - lastWrongQuipAt < PET_WRONG_COOLDOWN_MS) return
    lastWrongQuipAt = now
    if (action.title === null) {
      say(pickLine(PET.WRONG_NO_TITLE))
      return
    }
    say(
      action.learned
        ? PET.WRONG_LEARNED(action.title, action.order)
        : PET.WRONG_NOT_LEARNED(action.title, action.order)
    )
  }

  function doGrant(kind: PetRewardKind): void {
    // V1-42 起 grantPetRice 收 nowIso（按日计数），返回值多了 credited/capped；
    // 本引擎已退役，不接账本镜像（那是 dshpet/app.ts 的路），照旧直落 state。
    const { state: next, gained } = grantPetRice(state, kind, new Date().toISOString())
    state = next
    // 学完/复习记进记忆（'answer' 不记 —— 每答对一题记一笔会把环刷成流水账，
    // 环里只留"值得回头提一句"的事；答对的高频反馈由气泡之外的形式给）
    if (kind !== 'answer') {
      state = pushPetMemory(state, 'lesson', null, new Date().toISOString())
    }
    commit()
    // answer 不冒泡：每答对一题都弹一句会把气泡变成弹幕；饭盒数字照涨，
    // 学习卡片的奖励反馈已经在界面上有了。lesson / review 是整块动作，值得说。
    if (kind === 'lesson') say(PET.GRANT_LESSON(gained))
    else if (kind === 'review') say(PET.GRANT_REVIEW(gained))
    // 「一口气学完好几课」的彩蛋：窗口内课数到线才说，说一次之后靠
    // 记忆环的自然衰减退场（不再重复说 —— 连学四课不必听两遍）
    const streak = lessonStreak(state, new Date().toISOString())
    if (streak === PET_MEMORY_STREAK && kind !== 'answer') {
      // 学爆了 = 兴奋（90 秒）：转圈动画 + 状态行"开心到转圈圈"
      state = setPetEmotion(state, 'excited', new Date().toISOString())
      commit()
      say(PET.SPIN)
      sendCmd({ kind: 'anim', name: 'spin' })
    }
  }

  /**
   * 聊天面板被打开（宠物窗双击 / 菜单）。**开场白由这里定**：
   * 挂着错题就说那句酝酿了很久的「上次那道题你弄懂了吗喵」，否则平常招呼。
   * 面板本体在宠物窗本地已经弹开了，这条 cmd 只补第一句话（它幂等，重复
   * 打开不会重复说 —— 页面只认第一次 hello）。
   */
  function doChatOpen(): void {
    const label = lastWrongLabel(state)
    sendCmd({
      kind: 'chat-open',
      hello: label !== null ? PET.RECALL(label) : PET.CHAT_HELLO
    })
  }

  /**
   * 菜单快捷入口（2026-10-06 主人点名）：把主窗拉起来并跳到设置页某张卡。
   * 【为什么由主进程转手】宠物窗是独立渲染进程，不知道也不该知道主窗路由；
   * 主窗句柄在主进程手里 —— restore/show/focus 三件套 + 一条 app:nav 指令。
   * 【三件套各管一件事】restore 管"最小化"（Windows 上对最小化的窗口 show()
   * 不会还原）；show 管"藏在开屏后面还没露头"；focus 管"就在屏幕上但被盖住"。
   * 三条都幂等，多调无害；渲染层收到 app:nav 再决定滚哪张卡。
   */
  function openSettings(card: PetSettingsShortcut): void {
    const mw = mainWin
    if (!mw || mw.isDestroyed()) return
    if (mw.isMinimized()) mw.restore()
    if (!mw.isVisible()) mw.show()
    mw.focus()
    try {
      mw.webContents.send(IPC.appNav, { card, ts: Date.now() })
    } catch {
      /* 半死窗口：跳过这一条（同 broadcast 的容错口吻） */
    }
  }

  function popupMenu(): void {
    if (!win || win.isDestroyed()) return
    const modes: PetMode[] = ['wander', 'follow', 'still']
    const template: MenuItemConstructorOptions[] = [
      // ---- 一键直达设置：放最上面（主人点名的位置），先于喂饭/摸头
      { label: PET.MENU.SETTINGS_WALL, click: () => openSettings('wall') },
      { label: PET.MENU.SETTINGS_AI, click: () => openSettings('ai') },
      { type: 'separator' },
      {
        label: PET.MENU.FEED,
        // 没饭时灰着而不是藏起来：看见"喂饭（灰）"才知道要去挣大白饭，
        // 藏起来只会让人以为没这个功能
        enabled: state.rice > 0,
        click: () => void act({ action: 'feed' })
      },
      { label: PET.MENU.PAT, click: () => void act({ action: 'pat' }) },
      { type: 'separator' },
      {
        label: PET.MENU.MODE_HEAD,
        submenu: modes.map((m) => ({
          label: PET.MODE_NAMES[m],
          type: 'radio' as const,
          checked: state.mode === m,
          click: () => void act({ action: 'mode', mode: m })
        }))
      },
      { type: 'separator' },
      { label: PET.MENU.CHAT, click: () => void act({ action: 'chat' }) },
      { label: PET.MENU.HIDE, click: () => void act({ action: 'hide' }) }
    ]
    Menu.buildFromTemplate(template).popup({ window: win })
  }

  // ---------------------------------------------------------------- 报错联动

  /**
   * 主窗视口坐标 → 宠物窗坐标（精灵**落脚点**：脚底中点）。
   *
   * 【为什么要过一道缩放】getBoundingClientRect 给的是 CSS px，而
   * BrowserWindow 的 bounds 是 DIP —— 应用里有缩放功能（stores/zoom），
   * 两者只在 100% 缩放下相等。漏掉这步的错法很安静：100% 缩放的机器上
   * 一切正常，缩放过的机器上鱼落在错误的位置（甚至屏幕外）。
   */
  function toPetAnchor(run: PetRunReport): { x: number; y: number } | null {
    const mw = mainWin
    const pw = win
    if (!run.rect || !mw || !pw || mw.isDestroyed() || pw.isDestroyed()) return null
    const mb = mw.getContentBounds()
    const pb = pw.getContentBounds()
    const zoom = mw.webContents.getZoomFactor() || 1
    // 落脚点取**行左端偏右一点**：鱼身宽 ~200px，站在整行中央会盖住他刚写的
    // 那半行字；贴左端站，气泡从鱼头上冒出来，指向性也够
    const sx = mb.x + (run.rect.x + Math.min(48, run.rect.width / 2)) * zoom
    // 脚底对到行**上沿**再抬 6px：鱼站在错误行上方，不压字
    const sy = mb.y + run.rect.y * zoom - 6
    return { x: Math.round(sx - pb.x), y: Math.round(sy - pb.y) }
  }

  function errorLine(run: PetRunReport): string {
    if (run.kind === 'timeout') return PET.ERR_TIMEOUT
    if (run.kind === 'compile') {
      return run.line !== null ? PET.ERR_COMPILE_LINE(run.line) : PET.ERR_COMPILE_NO_LINE
    }
    return run.line !== null ? PET.ERR_RUNTIME_LINE(run.line) : PET.ERR_RUNTIME_NO_LINE
  }

  function reportRun(raw: unknown): void {
    const run = normalizeRunReport(raw)
    if (!run) return
    lastActivityAt = Date.now()
    if (disposed || !win || win.isDestroyed()) return
    if (run.ok) {
      // 跑通了 → 表扬一句。90 秒冷却：跑通是高频动作（改一点跑一次），
      // 每次都喊就成了噪音；但记忆环照记（截流一下重复）——"主人刚跑通过"
      // 是聊天时值得用的上下文。
      const nowIso = new Date().toISOString()
      const last = state.memory.events[state.memory.events.length - 1]
      const recentSame =
        last !== undefined && last.kind === 'run-ok' && Date.now() - Date.parse(last.at) < 5 * 60_000
      if (!recentSame) {
        state = pushPetMemory(state, 'run-ok', null, nowIso)
        store.save(state)
      }
      const now = Date.now()
      if (now - lastPraiseAt >= PET_PRAISE_COOLDOWN_MS) {
        lastPraiseAt = now
        say(pickLine(PET.PRAISE_RUN))
        sendCmd({ kind: 'anim', name: 'hop' })
      }
      return
    }
    const text = errorLine(run)
    const anchor = toPetAnchor(run)
    if (anchor) sendCmd({ kind: 'alert', x: anchor.x, y: anchor.y, text })
    else sendCmd({ kind: 'say', text })
  }

  // ---------------------------------------------------------------- 聊天

  /**
   * 桌宠聊天**自己的**单飞控制器。
   *
   * 【为什么不共用 main/index.ts 的 withAi】那条的不变式是"新请求顶掉旧请求"，
   * 服务的是"同一处界面只显示一个 spinner"的场景。桌宠聊天和 AI 出题完全可以
   * 同时发生（学员一边等出题一边逗鱼），共用一个控制器会让两者互相掐断 ——
   * 表现出来是"AI 出题偶尔莫名失败"，极难查。同一套单飞的**思想**，
   * 两个独立实例。
   */
  let chatAbort: AbortController | null = null

  /** 两个时刻隔几个自然日（按 petDayKey 的日界算，23:59 和 00:01 不会算成"隔一天"） */
  function dayDiff(aIso: string, bIso: string): number {
    const a = Date.parse(`${petDayKey(aIso)}T00:00:00Z`)
    const b = Date.parse(`${petDayKey(bIso)}T00:00:00Z`)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
    return Math.round((a - b) / 86_400_000)
  }

  /**
   * 拼给模型看的记忆块（≤3 行，附在 system 人设尾部）。
   * 【为什么是"挑三样"不是"全倒出来"】每多一行都是每次聊天的固定 token 成本，
   * 而模型真正用得上的就三样：挂着的错题（接着聊）、刚跑通（话题）、
   * 上次聊天隔了多久（续旧）。挑不出东西就是空串 —— chatPet 会自动省掉它。
   */
  function memoryBlock(): string {
    const nowIso = new Date().toISOString()
    const lines: string[] = []
    const label = lastWrongLabel(state)
    if (label !== null) lines.push(PET.MEMORY_EVENT_WRONG(label))
    const lastEvt = state.memory.events[state.memory.events.length - 1]
    if (
      lastEvt !== undefined &&
      lastEvt.kind === 'run-ok' &&
      Date.now() - Date.parse(lastEvt.at) <= 15 * 60_000
    ) {
      lines.push(PET.MEMORY_EVENT_RUNOK)
    }
    const streak = lessonStreak(state, nowIso)
    if (streak >= 2) lines.push(PET.MEMORY_EVENT_LESSON(streak))
    const lastChat = state.memory.lastChatAt
    if (lastChat !== null) {
      const days = dayDiff(nowIso, lastChat)
      if (days <= 0) lines.push(PET.MEMORY_LAST_CHAT_TODAY)
      else if (days === 1) lines.push(PET.MEMORY_LAST_CHAT_YESTERDAY)
      else lines.push(PET.MEMORY_LAST_CHAT_DAYS(days))
    }
    if (lines.length === 0) return ''
    return `${PET.MEMORY_HEADER}${lines.slice(0, 3).join('；')}。`
  }

  async function chat(raw: unknown): Promise<PetChatResult> {
    const messages = sanitizePetChat(raw)
    if (!messages) return { ok: false, text: PET.CHAT_FAIL['bad-response'] }
    lastActivityAt = Date.now()

    /*
     * 三道护栏在**发起任何网络请求之前**（纯函数 petChatGate，账在
     * pet.json 的 memory 里）。被拦下时回的还是"人话"而不是红字：
     * 桌宠的失败分档从第一天起就全是卖萌的抱怨（PET.CHAT_FAIL），
     * 不能让护栏变成唯一一处"官方通知口吻"。
     */
    const gate = petChatGate(state, new Date().toISOString())
    if (gate === 'cooldown') return { ok: false, text: PET.CHAT_BUSY }
    if (gate === 'daily') return { ok: false, text: PET.CHAT_DAILY_LIMIT }
    if (gate === 'tokens') return { ok: false, text: PET.CHAT_TOKEN_LIMIT }

    /*
     * 断网即时降级：连请求都不发。net.isOnline() 是 Chromium 的连通性探测，
     * 不是精确判决 —— 但它说"没网"时请求几乎必然失败，而失败的代价是主人
     * 对着"正在输入…"干等 30 秒超时。断网时说不了话是事实（README 级的
     * 降级原则：断网不卡死、只是功能受限），那就立刻把事实说成人话。
     */
    if (!net.isOnline()) return { ok: false, text: PET.CHAT_FAIL['offline'] }

    const memory = memoryBlock()
    chatAbort?.abort()
    const ac = new AbortController()
    chatAbort = ac
    try {
      const aiDeps: AiDeps = {
        fetch: (url, init) => globalThis.fetch(url, init),
        getConfig: deps.getConfig,
        signal: ac.signal
      }
      const res = await chatPet(aiDeps, { messages, memory })
      if (res.ok) {
        /*
         * 只有**成功发出**才记账：失败和取消不吃额度 —— 网络断了的时候
         * 学员会连点重试，把每一次重试都算成一次调用的话，他修好网络时
         * 额度已经被吃光了，而他从头到尾没跟本鱼说上一句话。
         */
        const used =
          messages.reduce((n, m) => n + approxPetTokens(m.content), 0) + PET_CHAT_REPLY_TOKENS
        state = petChatCommit(state, new Date().toISOString(), used)
        store.save(state)
        return { ok: true, text: res.data }
      }
      return { ok: false, text: PET.CHAT_FAIL[res.reason] }
    } finally {
      if (chatAbort === ac) chatAbort = null
    }
  }

  // ---------------------------------------------------------------- 对外

  /*
   * 对象先存个名字再返回：`attach` 里挂的 `closed` 回调要调 `dispose()` ——
   * 它俩是同一个对象的两个方法，直接写 `dispose()` 在那个作用域里找不到这个名字
   * （对象字面量不会自我绑定），得经由这个引用。
   */
  const api = {
    window(): BrowserWindow | null {
      return win && !win.isDestroyed() ? win : null
    },

    attach(mainWindow: BrowserWindow): void {
      if (disposed) return
      mainWin = mainWindow
      /*
       * "这次隔了多久"必须**在 touchPetSeen 之前**算：touch 之后 lastSeenAt
       * 就是现在，再算永远是 0。算完就锚新（问候语用 awayOnLaunch 选档，
       * 见 greetingLine；createWindow 里读完就清零，同一次会话里反复开关
       * 桌宠不会再被"好几天不见"问候一遍）。
       */
      const nowIso = new Date().toISOString()
      awayOnLaunch = awayMs(state, nowIso)
      state = touchPetSeen(state, nowIso)
      store.save(state)
      if (state.enabled) createWindow()
      // 「主程序关了就没了」的三条路：closed（销毁）/ hide / minimize。
      // show / restore 对称地把鱼放出来。都在这里挂，别散到 index.ts ——
      // 生命周期只有这一个文件说了算。
      mainWindow.on('show', showPet)
      mainWindow.on('restore', showPet)
      mainWindow.on('hide', hidePet)
      mainWindow.on('minimize', hidePet)
      mainWindow.on('closed', () => {
        mainWin = null
        api.dispose()
      })
      if (!heartbeat) heartbeat = setInterval(heartbeatTick, HEARTBEAT_MS)
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      if (heartbeat) clearInterval(heartbeat)
      heartbeat = null
      if (noKeyTimer) clearTimeout(noKeyTimer)
      noKeyTimer = null
      chatAbort?.abort()
      chatAbort = null
      destroyWindow()
    },

    init(): PetSnapshot {
      return snapshotOf(state, new Date().toISOString())
    },

    act,

    reportRun,

    hit(raw: unknown): void {
      const rects = parsePetHitRects(raw)
      // null（非法）保持上一份；空数组合法（真没东西可点）
      if (rects) hitRects = rects
    },

    chat
  }
  return api
}
