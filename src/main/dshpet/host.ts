import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join, resolve, sep } from 'path'
import { net, screen } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { PET_AFFECTION_LOVE_AT, PET_HUNGER_MILD_AT, petAffectionTier, type AppNavPayload, type PetSnapshot, type PetVitals } from '../../shared/pet'
import { beijingParts } from '../../shared/dates'
import type { AppConfig } from '../../shared/types'
import { pickQuip } from '../../shared/pet-quips'
import { PET, PET_DSH } from '../../shared/copy'
import { createPetStore } from '../pet/store'
import { chatPet, fetchBalance } from '../ai/deepseek'
import { createPetBrain, PET_HEARTBEAT_MS, type PetBrainDeps } from './brain'
import { createPetChatService } from './chat'
import { loadPetConfigFile, normalizePetConfig, type PetConfig } from './config'
import { writeSayLeaf } from './say-gate'

/**
 * dsh-pet 桌面引擎 · 迷你宿主（src/main/dshpet/host.ts，2026-10-06）
 *
 * 这个文件是「站在巨人肩膀上」的接口层：dsh-pet 的桌面模式本来就要一个
 * 宿主进程应答它的桥请求（素材、配置、状态、对话…）。官方宿主是 DSH 插件，
 * 我们不做 DSH —— 这里实现**恰好够用的一小块**：应答渲染端经
 * `dsh-pet-bridge://` 发来的四类请求（配置/状态/素材/动作），并把咪爱主进程
 * 的事件（菜单跳设置、互动、碎碎念）灌回它的 /state 通道。
 *
 * ── 行为大脑（brain.ts，2026-10-06 迁移轮）────────────────────────────
 *  旧引擎（main/pet）的互动/语言语义搬进了 brain.ts：喂饭/摸头/rua/发奖/
 *  答错/报错语言/心跳衰减/主动搭话。本文件只剩「接线」：把渲染端与扩展脚本
 *  上报的动作（POST /miai/feed|pat|rua、petAct 通道）转发给 brain，把
 *  brain 的输出（say/anim）写进状态叶子；出场问候挂在渲染端**首拉 /state
 *  之后**（首拉只记基线不渲染，见 events.js 的 stateBaseline——早于它的
 *  气泡会被当成历史静默跳过，这是问候必须晚于首拉的原因）。
 *
 * ── 桥协议（照抄官方 helper-process.ts 的契约，不许改口径）──────────────
 *  子进程 stdout 逐行输出 `dsh-pet-bridge:{id,method,url,body,cb}`；
 *  宿主把响应 POST 回 `cb`（子进程自己起的 127.0.0.1 随机端口回环服务），
 *  载荷 {id,status,contentType?,body?|file?}。素材走 `file`（绝对路径），
 *  二进制不过管道。
 *
 * ── 为什么子进程用两种姿势拉起来 ───────────────────────────────────────
 *  helper 是一整个 Electron 应用（自己的 main.js + 透明窗），必须独立进程：
 *  它的 `window-all-closed → app.quit()` 与我们主应用的窗口生命周期互不相干。
 *  · 开发（electron-vite dev 里 process.execPath 就是 node_modules/electron）：
 *    `electron <helperDir>` —— 直接拿它当 app 目录跑，最贴近官方姿势。
 *  · 打包（process.execPath 是我们自己的 exe，Electron 打包件不再认
 *    「app 目录」参数）：`<自己的 exe> --dsh-pet-helper`，由 src/main/index.ts
 *    最顶层的短路分支把这一进程变成纯 helper（require helper 的 main.js 后
 *    不再初始化咪爱本体）。helper main.js 的绝对路径经 MIAI_PET_HELPER_MAIN
 *    传给子进程，因为它自己的 __dirname 在打包后不是我们猜得出来的位置。
 *
 * ── 出网姿势（2026-10-06 定，2026-10-16 V1-30 扩）──────────────────────
 *  出箱状态只有**用户主动触发**的两条链出网，都走用户自己填的 DeepSeek Key：
 *  「跟本鱼聊天」（/chat → ./chat.ts 编排）和「查看余额」（V1-30：菜单
 *  「查看余额」→ POST /balance → refreshBalance 现查一次，不花 token）。
 *  其余全不出网：工作状态叶子我们**从不写入**（data 恒 null，渲染端拿到
 *  null 会静默跳过——takeChanged 的既有行为）；碎碎念是本地静态池
 *  （shared/pet-quips）。余额查不到（没 Key/断网）不弹错误框，走气泡里的
 *  一句小字（PET.BALANCE_FAIL），用户随时可以再点。聊天的编排（护栏/记忆/
 *  历史/失败分档）在 ./chat.ts，本文件只接桥的 /chat 路由。
 */

/** 主窗句柄的最小结构面（dshpet 只用这几个动作；结构类型让单测可以造假窗）。
 *  send 走 `webContents` 而不是拍平到窗口上：BrowserWindow 本身就是这个形状，
 *  直接对齐它就不需要适配层（拍平版的后果是一个 TS2322 加一层转接壳）。 */
export interface PetMainWindowLike {
  isDestroyed(): boolean
  isMinimized(): boolean
  isVisible(): boolean
  isFocused(): boolean
  restore(): void
  show(): void
  focus(): void
  /** 窗口屏幕矩形（DIP）。关闭键热区轮询用 */
  getBounds(): { x: number; y: number; width: number; height: number }
  /** 内容区屏幕矩形（DIP）。报错 rect 的「视口 → 屏幕」换算原点 */
  getContentBounds(): { x: number; y: number; width: number; height: number }
  webContents: {
    send(channel: string, payload: unknown): void
    /** 页面缩放（CSS px → DIP 的倍率）。老假窗不带它，调用处有 ?? 1 兜底 */
    getZoomFactor?(): number
  }
}

export interface DshPetHostOptions {
  /** vendored helper 目录（out/pet-helper），含 main.js 与 assets/ */
  helperDir: string
  /** 是否为打包产物（决定子进程启动姿势，见文件头） */
  packaged: boolean
  /** pet.json 的家（行为大脑的状态账本；portable 下是 data/） */
  storageDir: string
  getMainWindow: () => PetMainWindowLike | null
  /**
   * 整份应用配置（app.ts 的 readConfig 读口，每次现读）。
   * 两种消费姿势：宠物旋钮在 spawnChild/applySettings 时读；聊天的 ai 段
   * 由 chatPet 每次 /chat 现读——用户中途改了 Key/模型，不必等到重启
   * （deepseek.ts 的既有口径）。
   */
  getConfig: () => AppConfig
  /**
   * 音效设置（config 根上的 soundEnabled / sfxVolume）。给渲染端的小黄鸭
   * 音效闸门用（GET /miai/flags）——宠物窗读不到 config（权限最小化的代价），
   * 这个闭包就是它唯一的读口。
   */
  getSound: () => { enabled: boolean; volume: number }
  /**
   * 宠物窗焦点变化回调（true = 焦点进了宠物窗）。壁纸链用它区分「主窗被
   * 宠物抢了焦点」（不该暂停）与「彻底失焦」（该暂停）—— 宿主自己不做
   * 策略，只把原生事实转给 app.ts（同 window-state 的「只推事实」哲学）。
   * 只在**变化**时回调（渲染端 window focus/blur 会连发）。
   */
  onPetFocus?: (focused: boolean) => void
  /**
   * 右键菜单「关闭大肥鱼」（POST /miai/pet-off）→ 这里。职责在 app.ts：
   * 把 config.pet.enabled 落成 false 并广播 config:external（设置页开关跟着
   * 灭）；宿主随后立刻 applySettings()，配置已落 false ⇒ stopChildForDisable：
   * helper 收到本请求的回包后自退（app.exit），宽限内没退才硬收兜底。
   * 宿主自己**不碰 config**（配置真源在 app.ts，同 config:save 的分工）。
   */
  onMenuDisable?: () => void
  /** 探针口子：显式设了才给 helper 开远程调试端口（同 MIAI_DEBUG_PORT 的哲学） */
  debugPort?: string
  /**
   * 大白饭镜像出口（P10.x 上行接线，可选）：原样转给 brain（语义见 brain.ts
   * 的 PetBrainDeps.onRice）—— 宿主只做转发，一行业务判断都不加（本文件
   * 的既有分工）。app.ts 接的是 rice-journal 的 record()；不接 = v1 本地算术。
   */
  onRice?: PetBrainDeps['onRice']
  log?: (line: string) => void
}

export interface DshPetHost {
  stop(): void
  reload(): void
  applySettings(): void
  /** 桌宠快照（旧 petInit 通道的读口；渲染层现阶段没有消费方，仍如实应答） */
  init(): PetSnapshot
  /** 执行一个动作（旧 petAct 通道的转发口：grant/wrong 是**活的**调用点） */
  act(raw: unknown): PetSnapshot
  /** 运行结果上报（旧 pet:report-run 通道的转发口；rect 在这里换到屏幕系） */
  reportRun(raw: unknown): void
  /** 撒娇挽留（设置卡按钮/主窗关闭键悬停 → app.ts → 这里）。8s 冷却，无窗静默 */
  plead(): void
  /**
   * 正文编辑区的视口矩形上报（渲染层 RunnerPanel 的 pet:report-work-rect
   * 转发口，CSS px；null=没了）。跟随的"让位"规则唯一的数据源。
   */
  reportWorkRect(raw: unknown): void
  /** 原生路径的运行奖（native-watch 编译成功 → 这里）。fp 主进程算好，去重在 brain */
  grantRun(fp: string): boolean
  /**
   * 账本余额镜像（P10.5 账号通道）：原样转给 brain（语义见 brain.ts 的
   * PetBrain.mirrorRice）。app.ts 在上行/激活/登出/启动恢复后推账本余额；
   * brain 相等即 no-op。
   */
  mirrorRice(n: number): void
  debugState(): Record<string, unknown>
}

interface BridgeRequest {
  id: number
  method: string
  url: string
  body?: unknown
  cb: string
}

interface BridgeResponse {
  status: number
  contentType?: string
  body?: string
  file?: string
}

const BRIDGE_PREFIX = 'dsh-pet-bridge:'
const RESTART_BASE_MS = 750
const RESTART_MAX_FAILS = 6
/** 碎碎念周期：比官方 300s 密一点（咪爱台词池是纯本地的，不心疼频率） */
const WHISPER_INTERVAL_MS = 240_000
const STARTUP_QUIP_DELAY_MS = 80_000
/** 撒娇挽留的冷却：悬停事件会连发，8 秒内只说一句 */
const PLEAD_COOLDOWN_MS = 8_000
/**
 * 关闭桌宠的软停宽限（stopChildForDisable）：helper 收到 /miai/pet-off 回包
 * 后会自己 app.exit(0)（补丁里延 120ms 一枪毙命，不走 Chromium teardown）。
 * 宽限内等它自退；到点还活着（旧 helper / 补丁失效）再走老路 TerminateProcess
 * 硬收兜底 —— 行为与从前一致。
 */
const SOFT_STOP_GRACE_MS = 800
/** 主窗关闭键悬停轮询周期（只读光标坐标 + 窗口矩形，代价可忽略；150ms 一拍 = 悬停最晚 0.15s 被认到） */
const HOVER_POLL_MS = 150
/**
 * 关闭键热区（DIP，右沿贴主窗内容区右上角）。按钮由**系统绘制**、拿不到精确
 * 矩形，热区是实测近似：WCO 隔离档探针量到右侧按钮带 137 CSS px ÷ 3 个
 * ≈ 45.7 宽、overlay 高 30（高多给 4px 宽容，底部越界 4px 仍在标题栏区域内）。
 */
const CLOSE_BUTTON_W = 46
const CLOSE_BUTTON_H = 34
/**
 * 跟随落点：光标下方 R = 0.25×体型处（鱼**中心**）。0.25 与命中区上沿
 * （主进程兜底口径 0.203125×体型）之间留 ≈0.047×体型≈22px 净空 —— 光标
 * 悬在鱼头顶正上方，既"贴着"又不压住它的可点身体（补充模块一）。
 */
const FOLLOW_OFFSET_RATIO = 0.25
/** 跟随目标写入死区（px）：150ms 一拍里光标没挪出这个范围就不重写叶子 */
const FOLLOW_DEADBAND_PX = 2
/**
 * 跟随资格线的饱食度下界（2026-10-10，主人裁定「有资格才提」）。
 * 取 PET_HUNGER_MILD_AT（50）= 饥饿档还在 mild/full 那两档之内：低于它进 medium，
 * 鱼自己都在冒泡催饭（NAG_FEED），再挂着"跟着我走"就是自相矛盾的人设。
 * 0（饿扁死机档）当然更不在资格内。
 */
const FOLLOW_MIN_SATIETY = PET_HUNGER_MILD_AT
/**
 * 「光标已经凑到鱼身上」的外扩（× 体型）：跟随稳态下光标停在鱼**头顶上方**
 * 约 0.027×体型处（R=0.25 与命中区上沿 0.2227 之差），比命中区高一点点 ——
 * 想抓住鱼（右键菜单）就得把这一线之隔的判定放宽。0.06×体型 ≈ 11px@187。
 */
const FOLLOW_HOVER_PAD_RATIO = 0.06
/**
 * 撒娇台词「想跟随鼠标」的最小间隔：资格线在 50 上下抖动时（喂一碗 +20
 * 只要掉回 49 再喂就来回跨线；V1-46 后摸头已不再顶饱食度）不重复唠叨。
 * 说一次是撒娇，每喂一碗说一次是复读。
 */
const FOLLOW_WISH_GAP_MS = 10 * 60_000
/** 让位规则的缓冲（px）：光标进入正文编辑区外扩这么多就认为"要写代码了" */
const WORK_RECT_PAD = 8
/** 沿边等待的站位间隙（× 体型）：鱼的命中区离编辑区边缘留这么远 */
const WORK_GAP_RATIO = 0.6
/**
 * 挽留停靠点到关闭键的净空：G=横向（鱼命中区右沿 ↔ 按钮左沿），
 * G2=纵向（鱼命中区上沿 ↔ 按钮下沿）。X 键"物理点得动"的保证全靠这两道
 * 净空 + 偏移（见 parkPointFor 的推导注释）—— 改小之前先重读那段。
 */
const PARK_GAP_X = 24
const PARK_GAP_Y = 12
/**
 * 身体命中区半宽/半高（× 体型）。取**主进程兜底口径**（比渲染端宽一档：
 * 渲染端 0.15625，兜底 0.203125 —— 命中判定哪边宽哪边说了算，站位的净空
 * 按宽的那个算才安全）。横向两侧口径一致，都是 0.1875。
 */
const HIT_HALF_W_RATIO = 0.1875
const HIT_HALF_H_RATIO = 0.22265625
/** 跑腿 ACK 兜底：这么久没收到 /miai/chase-arrived 就当这趟失败 */
const CHASE_ACK_TIMEOUT_MS = 6_000
/**
 * 出场问候的落点：渲染端首拉 /state **之后**再等这么久。
 * 【为什么必须晚】渲染端的首拉只记基线不渲染（events.js 的 stateBaseline），
 * 早于它的 say 会被当成历史静默吞掉 —— 问候就成了永远不响的空炮。
 * 2.5s 又刚好够窗口画完第一帧（气泡挂在画好的窗口上，不是屏幕外闪现）。
 */
const GREET_DELAY_MS = 2_500

export function startDshPetHost(opts: DshPetHostOptions): DshPetHost {
  const log = opts.log ?? ((line: string) => console.log(`[dshpet] ${line}`))
  const assetsDir = join(opts.helperDir, 'assets')
  const configPath = join(assetsDir, 'config.jsonc')
  const helperMainPath = join(opts.helperDir, 'main.js')

  let child: ChildProcessWithoutNullStreams | null = null
  let childPid = 0
  let stopping = false
  /**
   * 退出是「预期」的子进程实例（关闭桌宠时 helper 自退）。其 exit 事件不触发
   * 崩溃重启。WeakSet 以实例为键：旧实例退得再晚也不会误伤顶替它的新实例
   * （单个布尔 flag 在「软停宽限内又被启用」的时序里会串台）。
   */
  const expectedExit = new WeakSet<ChildProcessWithoutNullStreams>()
  let fails = 0
  let restarts = 0
  let quackServed = 0
  let lastError = ''
  let lastSpawnSettings: PetConfig | null = null
  let restartTimer: NodeJS.Timeout | null = null
  let whisperTimer: NodeJS.Timeout | null = null
  let startupTimer: NodeJS.Timeout | null = null
  let greetTimer: NodeJS.Timeout | null = null
  let stdoutBuf = ''
  /** 渲染端拉过几次 /state（首拉只记基线 ⇒ 问候的触发器是「第 1 次拉取」） */
  let statePulls = 0
  /** 这次子进程生命周期里还欠不欠一次出场问候（spawnChild 时重置） */
  let greetPending = false
  /** 问候整个宿主生命周期只送一次：改体型/崩溃重启都不算「重新出场」 */
  let greeted = false

  // /state 当前快照：每个叶子 {counter, data}，counter 严格递增（契约）。
  // data 初始 null —— 渲染端首拉只记基线且跳过 null（takeChanged 既有行为），
  // 所以我们晚一点才写第一条台词也不会「补播」历史。
  const state = {
    // sections：非 pets 域的共享叶子。目前只有 balance（V1-30）——
    // dsh-pet 的 events.js 按 `sections.balance` 这个**路径名**订阅（walkLeaves
    // 拼 "sections." + name），拼错一个字母 = 静默收不到：不报错，气泡永远
    // 不出来。data 形状由供应商的 toBalanceState 定死（见 balanceLeafDataOf）。
    sections: {
      // 余额（V1-30，2026-10-16 夜）：**用户主动**点菜单「查看余额」才现查
      // DeepSeek（POST /balance → refreshBalance），不点不查、不轮询 —— 这是
      // 「最稳」的选择：零自动出网 = 零意外费用、零断网期的静默失败循环。
      balance: { counter: 0, data: null as null | Record<string, unknown> }
    },
    pets: {
      main: {
        say: { counter: 0, data: null as null | { text: string; image?: string } },
        anim: { counter: 0, data: null as null | { name: string } },
        // 跑腿目的地（**屏幕 DIP 坐标**）。渲染端的 miai-extras 每拍轮询这颗
        // 叶子；seq 是「哪一趟」的序号，ACK 时带回来核对（陈旧/乱序回执作废）
        goto: { counter: 0, data: null as null | { x: number; y: number; seq: number } },
        // 饱食/饭盒/心情读数（P3 ③）：brain 状态一变就推（指纹去重），渲染端
        // 右键菜单的饥饿进度条读 data 画宽度与颜色。**只读叶子** —— 不接指令。
        vitals: { counter: 0, data: null as null | PetVitals },
        // 跟随鼠标（补充模块一，2026-10-09）：**电平语义** —— on:true 时
        // x/y 是鱼**中心**该去的屏幕 DIP 点（光标下方 R；光标进正文区时改为
        // 沿边等待点）。渲染端按最新值做指数趋近，鼠标没动就不重写（死区）。
        follow: { counter: 0, data: null as null | { on: boolean; x: number | null; y: number | null } },
        // 关闭挽留位移（补充模块二）：**事件语义**（同 goto）—— go=游到
        // 停靠点（x/y 屏幕 DIP），back=游回原处（x/y 为 null，原处渲染端
        // 自己记）。seq 递增，回执带回来核对；渲染端首拉只记基线。
        recall: {
          counter: 0,
          data: null as null | { seq: number; phase: 'go' | 'back'; x: number | null; y: number | null }
        }
      }
    }
  }

  /** 最近说过的几条（防同一句话连着出现；pickQuip 的 recent 契约） */
  const recentSaid: string[] = []

  // ── 跑腿与宠物窗焦点（2026-10-06 第三阶段）────────────────────────────
  /** 宠物窗是否持有焦点（渲染端 /miai/pet-focus 上报；壁纸暂停策略的输入） */
  let petFocused = false
  /** 跑腿序号：每次出动 +1，ACK 靠它核对「哪一趟到了」（陈旧回执作废） */
  let chaseSeq = 0
  /** 本次跑腿的 6s 兜底定时器（渲染端带 seq 的 ACK 到达即清） */
  let chaseTimer: NodeJS.Timeout | null = null
  /** plead 上次说的时刻（悬停会连发，8s 冷却） */
  let lastPleadAt = 0
  let pleadCount = 0
  /** 主窗关闭键悬停轮询与边缘触发标志（悬停一次只喊一声） */
  let hoverTimer: NodeJS.Timeout | null = null
  let hoverArmed = true

  // ── 跟随鼠标与关闭挽留（2026-10-09 补充模块一/二）──────────────────────
  /**
   * 右键菜单的手动覆盖：null/true=跟随（有资格就跟），false=用户点过「别跟着啦」。
   * **会话级、不落盘** —— 它是一时兴起的开关，不是设置；设置页的「允许跟随」才是
   * 落盘的总闸（config.pet.followMouse）。注意它**只能关、不能越过资格线**（见
   * followWanted 的注释）。
   */
  let followOverride: boolean | null = null
  /** 跟随叶子当前是不是 on（失效时负责补一条 off；写叶与 debugState 用） */
  let followOn = false
  let followWrites = 0
  /** 上一拍是否有资格（false→true 那条沿 = 说「想跟随鼠标」的那一刻） */
  let followEligiblePrev = false
  /** 上一次撒娇说「想跟随鼠标」的时刻（FOLLOW_WISH_GAP_MS 节流，见常量注释） */
  let lastFollowWishAt = 0
  let followWishCount = 0
  /** 光标此刻是否正压在鱼身上（跟随暂停中）；配对计数只记**进入**的次数 */
  let followHovering = false
  let followHoverPauses = 0
  /** 资格不满足而被拒的菜单跟随点击次数（探针读数；每次在日志里有对应行） */
  let followRefused = 0
  /** 挽留状态机：active=go 已发出还没走完（含停靠中）；parked=已到停靠点 */
  let recallActive = false
  let recallParked = false
  let recallSeq = 0
  let recallGoArrived = 0
  let recallBackArrived = 0
  /**
   * 正文编辑区的**视口 CSS px** 矩形（渲染端 pet:report-work-rect 上报，
   * null=不知道/编辑区不在）。跟随的"让位"规则唯一的数据源 —— 拿不到就当
   * 没有让位对象（跟着走就是全部规则），绝不猜一个矩形出来。
   */
  let workRectCss: { x: number; y: number; width: number; height: number } | null = null

  // ── 行为大脑（brain.ts）：v1 语义的唯一住所 ─────────────────────────────
  // 这里只喂四件事：账本（pet.json）、两个写叶子的出口、主窗焦点读口、日志。
  // 台词/冷却/分档全在 brain 里 —— 宿主多写一行业务判断都是错位。
  /*
   * 起步配置在这里读（末尾起步块与 brain 构造共用这一份）。
   * 【为什么从文件末尾上移过来】空转[4]（2026-10-16）：起步时就关着的话，
   * brain 必须**一开始就冻结**（startPaused）—— 否则「关着宠物」的那几天
   * 在装载路径上照样按离线速率扣饱食度/好感、还落一次见面盘。构造与起步
   * 块之间没有任何配置写入，读一次与原先读一次语义相同。
   */
  const initial = normalizePetConfig(opts.getConfig().pet)
  const brainStore = createPetStore(opts.storageDir)
  const brain = createPetBrain({
    store: brainStore,
    // 起步关着 → 冻结：tick 空转、装载不衰减不落盘（契约见 pet.ts/brain.ts）
    startPaused: !initial.enabled,
    // 三参：跑腿到达的台词带 meme（pet-quips 的 chase 池有配图条目）
    say: (text, tag, meme) => sayText(tag, text, meme),
    anim: playAnim,
    // 好感度跨档的台词出口（P3 ④）：走 pet-quips 的 affection 场景池。
    // **直接引用**（不包一层箭头）：包一层的话 say-gate.test.ts 的静态扫描
    // 会把 'affection' 这类字面量扫成间接实参，跨档播报的 tag 就脱离对账。
    quip: sayQuip,
    // 读数出口（P3 ③）：brain 每次 commit 里推（指纹去重，含构造时的启动一发）。
    // writeVitals 是函数声明（提升）—— 构造时就会被调到，必须在闭包任何位置都可用
    vitals: (v) => writeVitals(v),
    // 跑腿出口：写 goto 叶子 + 返回本趟 seq（0 = 没送出去）。writeGoto 是
    // 函数声明（提升），真正被调用的时刻远晚于本构造 —— 没有 TDZ 问题
    chase: (x, y) => writeGoto(x, y),
    // 饭镜像出口（P10.x）：原样转发 app.ts 给的 sink（未接 = undefined，
    // brain 回退 v1 本地算术）。条件展开保住 exactOptionalPropertyTypes 语义
    ...(opts.onRice ? { onRice: opts.onRice } : {}),
    getMainFocused: () => {
      const mw = opts.getMainWindow()
      if (!mw || mw.isDestroyed() || !mw.isVisible() || mw.isMinimized()) return false
      return mw.isFocused()
    },
    log: (line) => log(`brain| ${line}`)
  })

  /**
   * 心跳：30s 一拍（在线衰减 / 饿嘟囔 / CPU / 久不动搭话）。挂宿主的整条
   * 生命周期而不是子进程的 —— 宠物窗崩了重启、改了体型重启，账本照走
   * （v1 的 attach 之后同款）。unref 是为了不把 Electron 主进程的退出
   * 钉在定时器上（窗口全关后靠 app 生命周期退出，不靠它）。
   *
   * 【空转[4]（2026-10-16）：关掉 = 这条表也停】原先它无条件常驻 ——
   * 「设置里关掉宠物」之后账本照走（复核实测：关掉 30 分钟后饱食度 57→50）。
   * 现在改成可停可起的一对函数：关（applySettings disabled / stop）停表，
   * 开（applySettings enabled / 起步）起表。brain 里另有一道 setPaused
   * 双保险 —— 哪怕将来谁又把它接回常驻，tick 也是 no-op。
   */
  let brainTimer: NodeJS.Timeout | null = null
  function startBrainTimer(): void {
    if (brainTimer) return
    brainTimer = setInterval(() => brain.tick(), PET_HEARTBEAT_MS)
    brainTimer.unref?.()
  }
  function stopBrainTimer(): void {
    if (!brainTimer) return
    clearInterval(brainTimer)
    brainTimer = null
  }

  /**
   * 主窗关闭键悬停 → 撒娇挽留。标题栏按钮是**系统绘制**的：命中判定在
   * 原生层先于网页发生（app.ts 建窗注释已定案，渲染层收不到它的 hover）——
   * 唯一能"知道鼠标在 X 上"的办法是主进程看光标。150ms 一拍、主窗活着
   * 且（自己在前台 **或宠物窗持焦**）时算命中；边缘触发（hoverArmed）
   * 保证悬停一次只喊一声。
   *
   * 【为什么焦点门必须放 petFocused 进来】2026-10-06 第二轮主人实测：
   * 点一下大肥鱼（拖/rua/右键同）主窗立刻 blur，此后悬停 X 整段被
   * `!mw.isFocused()` 挡掉 —— 设置卡按钮那条路通着、悬停这条静默。
   * 桌宠窗 focusable:true（对话输入框要用它），这个失焦是常态不是"离开"。
   * 【为什么是 getContentBounds 不是 getBounds】按钮画在**内容区**右上角；
   * getBounds 含几像素隐形边框，热区会整体偏出按钮（左沿悬停失灵）。
   * screen 与两个 bounds 都是 DIP，直接相减。
   *
   * 【2026-10-09 起它同时是三条节奏的节拍器】悬停一次要做三件事：冒泡挽留
   * （plead）、把鱼叫到键旁边（startRecall）、离开时归位（endRecall）。
   * 此外跟随写入（followTick）也骑在这里 —— 主进程里再没有第二条 150ms
   * 心跳，跟随不放独立定时器（多一条就是多一份相位错乱的面）。
   */
  function hoverPoll(): void {
    // 跟随写入（补充模块一）骑在这条 150ms 轮询上：它不需要主窗焦点门
    // （鱼在桌面上跟光标走是天性），自己的条件都在 followTick 里判。
    followTick()
    const mw = opts.getMainWindow()
    if (
      !mw ||
      mw.isDestroyed() ||
      !mw.isVisible() ||
      mw.isMinimized() ||
      !(mw.isFocused() || petFocused)
    ) {
      hoverArmed = true
      endRecall() // 窗口不在场就没有"被关"这件事：鱼归位（幂等）
      return
    }
    let inZone = false
    try {
      const p = screen.getCursorScreenPoint()
      const b = mw.getContentBounds()
      inZone =
        p.x >= b.x + b.width - CLOSE_BUTTON_W &&
        p.x < b.x + b.width &&
        p.y >= b.y &&
        p.y < b.y + CLOSE_BUTTON_H
    } catch {
      /* 显示器拔插等瞬时态：这一拍跳过（重新布防），下一拍再试 */
      hoverArmed = true
      endRecall()
      return
    }
    if (inZone) {
      if (hoverArmed) {
        hoverArmed = false
        // 触发日志：验收/探针靠它把「认到悬停」与「8s 冷却吞掉」分开
        log('hover close -> plead')
        // 顺序有讲究：先在飞的跑腿结账（它说兜底台词），再冒泡（挽留台词压
        // 在最后 —— 同一只叶子先来后到，用户该看到的是挽留），最后动身。
        cancelChaseForRecall()
        plead()
        startRecall(mw)
      }
    } else {
      hoverArmed = true
      endRecall() // 离开热区：鱼游回原处（幂等，没在挽留时零动作）
    }
  }

  /*
   * 【空转[4]（2026-10-16）：关掉 = 这条轮询也停】它原先无条件常驻：宠物
   * 关着时这 150ms 一拍还在跑（跟随写入在无宠物窗时自己判空、无害；悬停
   * 挽留判定则对着不存在的气泡说话）。与心跳同一口径：关（applySettings
   * disabled / stop）停表，开（enabled / 起步）起表。停表期间 hoverArmed /
   * petFocused 这些由窗口事件维护的状态不动 —— 重开时下一拍自然重新布防。
   */
  function startHoverTimer(): void {
    if (hoverTimer) return
    hoverTimer = setInterval(hoverPoll, HOVER_POLL_MS)
    hoverTimer.unref?.()
  }
  function stopHoverTimer(): void {
    if (!hoverTimer) return
    clearInterval(hoverTimer)
    hoverTimer = null
  }

  /**
   * 聊天（编排在 ./chat.ts）。护栏与记账走 brain（pet.json 账本唯一持有者），
   * 台词走 sayText（与碎碎念共用同一只气泡叶子）。chatPet 的 fetch 用
   * globalThis.fetch——Electron 主进程的 fetch 没有渲染层的 CORS/CSP 约束。
   */
  const chatService = createPetChatService({
    gate: () => brain.chatGate(),
    commit: (tokens) => brain.chatCommit(tokens),
    memoryBlock: () => brain.chatMemoryBlock(),
    // 【别直接写 say: sayText】sayText 是 (tag, text)，聊天服务的契约是 (text, tag) ——
    // 两边都是 (string, string) => void，写错了 typecheck 抓不到，气泡会原样显示 tag。
    say: (text, tag) => sayText(tag, text),
    isOnline: () => net.isOnline(),
    chat: (input) => chatPet({ fetch: (url, init) => globalThis.fetch(url, init), getConfig: opts.getConfig }, input),
    log: (line) => log(`chat| ${line}`)
  })

  /**
   * 余额叶子数据的组装（V1-30，2026-10-16 夜）。形状是供应商 bundle 的
   * toBalanceState 认的那一种（deepseek 支）：成功 = {provider, kind,
   * ok:true, data:{currency,total,granted,toppedUp}}；失败 = {provider,
   * ok:false, reason, message}，reason 只认供应商的三枚举，这里用到两个：
   * credential-missing（没配 Key）与 fetch-error（其余失败全归它——气泡
   * 大标题本来就不细分，细分原因码进日志）。message 是失败气泡那行小字，
   * 文案在家：shared/copy.ts 的 PET.BALANCE_FAIL。
   */
  function balanceLeafDataOf(res: Awaited<ReturnType<typeof fetchBalance>>): Record<string, unknown> {
    if (res.ok) {
      return {
        provider: 'deepseek',
        kind: 'deepseek',
        ok: true,
        data: {
          currency: res.data.currency,
          total: res.data.total,
          granted: res.data.granted,
          toppedUp: res.data.toppedUp
        }
      }
    }
    if (res.reason === 'no-key') {
      return {
        provider: 'deepseek',
        ok: false,
        reason: 'credential-missing',
        message: PET.BALANCE_FAIL['no-key']
      }
    }
    return { provider: 'deepseek', ok: false, reason: 'fetch-error', message: PET.BALANCE_FAIL.fetch }
  }

  /** 正在查余额。菜单可以连点：在飞时忽略重复请求，落账以第一发为准 */
  let balanceRefreshing = false

  /**
   * 现查一次余额并写 sections.balance（V1-30）。**只由菜单点播驱动** ——
   * 没有定时器、没有启动预热（零自动出网的姿态见文件头）。查询失败也照写
   * 叶子（ok:false），失败气泡的小字就是从它出来的；日志记原因码（英文）。
   */
  async function refreshBalance(): Promise<void> {
    if (balanceRefreshing) return
    balanceRefreshing = true
    try {
      const res = await fetchBalance({
        fetch: (url, init) => globalThis.fetch(url, init),
        getConfig: opts.getConfig
      })
      const leaf = state.sections.balance
      leaf.counter += 1
      // manual:true 随叶子带上：供应商只认它决定「同因也重弹」（连点两次
      // 同一条失败，第二次仍然要有反馈）。
      leaf.data = { ...balanceLeafDataOf(res), manual: true }
      log(`balance#${leaf.counter} ${res.ok ? 'ok' : 'fail:' + res.reason}`)
    } finally {
      balanceRefreshing = false
    }
  }

  /**
   * 写 vitals 读数叶子（P3 ③，brain 的 vitals 出口）。counter 严格递增，
   * data 是完整快照（渲染端按最新值渲染，不需要增量语义）。
   */
  function writeVitals(v: PetVitals): void {
    const leaf = state.pets.main.vitals
    leaf.counter += 1
    leaf.data = { satiety: v.satiety, rice: v.rice, mood: v.mood, affection: v.affection }
    log(`vitals#${leaf.counter} satiety=${v.satiety} rice=${v.rice} mood=${v.mood} affection=${v.affection}`)
  }

  /** 现在多饿（归零静默闸门的输入）。读不到读数回 null —— 闸门对 null 放行 */
  function currentSatiety(): number | null {
    const v = state.pets.main.vitals.data
    return v !== null && Number.isFinite(v.satiety) ? v.satiety : null
  }

  /**
   * 现在多亲（2026-10-09 补充模块一②的冷漠抑制输入）。读不到读数回 null ——
   * 与 say-gate 同款 fail-open：不知道的时候照常说，桌宠突然变哑巴比多说
   * 一句糟得多；"以为冷着、其实从没生效"的假绿由 whisper 的那行日志抓。
   */
  function currentAffection(): number | null {
    const v = state.pets.main.vitals.data
    return v !== null && Number.isFinite(v.affection) ? v.affection : null
  }

  /** 被静默闸拦下的条数（探针读数；每一条在日志里都有对应行，可归因） */
  let sayDroppedStarving = 0
  /** 碎碎念因冷漠(<20)跳过的次数（2026-10-09 补充模块一②；同上，可归因） */
  let whisperColdSkipped = 0

  /**
   * 气泡叶子的**唯一**写口（P3 ③ 契约：归零静默的闸门收敛到此处）。
   * 判定与写法在 say-gate.ts（不碰 electron、有靶向单测）；这里只把"现在
   * 多饿"备齐。被拦下时不动 counter（渲染端不会看见"空条目"），理由：见
   * say-gate 文件头。
   */
  function writeSay(entry: { tag: string; text: string; meme?: string; logTag?: string }): boolean {
    const ok = writeSayLeaf(state.pets.main.say, entry, currentSatiety(), (line) => log(line))
    if (!ok) sayDroppedStarving += 1
    return ok
  }

  /**
   * 引擎自带的台词池（shared/pet-quips）：碎碎念/菜单点播/好感跨档走这条。
   * `tag`（可选，P3 ④ C3）= 只进日志的二级标签（如 affection-up/down）——
   * 气泡叶子的 tag 仍只记场景名（闸门白名单/recent 记账都以场景为键），
   * 二级标签出现在日志行 `say#n (scene) tag text` 里供探针对账。
   */
  function sayQuip(
    scene: 'menu' | 'idle' | 'lateNight' | 'startup' | 'plead' | 'affection' | 'followWish',
    tag?: string
  ): void {
    const q = pickQuip(scene, { recent: recentSaid.slice(-8) })
    // recentSaid 只在**真的说出去**之后才记账：被闸门拦下的不算"说过" ——
    // 否则饿扁期间的几次拦截会搅乱台词池的轮转（喂回饭后第一句可能马上重复）
    if (!writeSay({ tag: scene, logTag: tag, text: q.text, meme: q.meme })) return
    recentSaid.push(q.text)
    if (recentSaid.length > 16) recentSaid.splice(0, recentSaid.length - 16)
  }

  /** brain 的台词出口（文案真源是 copy.ts 的 PET 段，brain 已拼好）。
   *  与 sayQuip 共用同一只叶子：对话气泡只有一条通道，先来后到不折叠。
   *  meme 可选：跑腿到达说的是 pet-quips 的 chase 池台词，配图照池子设计走。 */
  function sayText(tag: string, text: string, meme?: string): void {
    writeSay({ tag, text, meme })
  }

  /** 宿主侧点播动画（咪爱事件 → anim 叶子；渲染端走 onMenuAction 同一条播放路径） */
  function playAnim(name: string): void {
    const leaf = state.pets.main.anim
    leaf.counter += 1
    leaf.data = { name }
    log(`anim#${leaf.counter} ${name}`)
  }

  /**
   * 跑腿：把「去屏幕 (x,y) 走一趟」写进 goto 叶子，返回本趟 seq。
   * 渲染端的 miai-extras 每拍（自己一条 1s 轮询，与本宿主错开相位）读这颗
   * 叶子，把屏幕点换算成宠物坐标系里的落点、缓动走过去，到了 POST
   * /miai/chase-arrived。seq=0 = 没送出去（没宠物窗）——brain 收到 0 会
   * 原地说话术（降级，不是错）。
   *
   * 【为什么走 /state 叶子】宿主到 helper 只有这一条下行通道（stdout 只进
   * 不出、桥的 fetch 是渲染端发起的应答语义）——见 locomotion 侦察的定案。
   * 叶子的 counter 机制天生「最新值覆盖」，正好匹配「只有一趟在飞」的状态机。
   *
   * 【6 秒兜底】渲染端 ACK 可能丢（helper 恰在崩、页面正忙）：到点没 ACK 就
   * 当这趟失败（brain 说兜底台词）—— 不兜底的话 pendingChase 永远挂着。
   */
  function writeGoto(x: number, y: number): number {
    if (!child) return 0
    chaseSeq += 1
    const seq = chaseSeq
    const leaf = state.pets.main.goto
    leaf.counter += 1
    leaf.data = { x, y, seq }
    log(`goto#${leaf.counter} seq=${seq} (${Math.round(x)},${Math.round(y)})`)
    if (chaseTimer) clearTimeout(chaseTimer)
    chaseTimer = setTimeout(() => {
      chaseTimer = null
      brain.chaseTimeout(seq)
    }, CHASE_ACK_TIMEOUT_MS)
    return seq
  }

  /** 渲染端 ACK「到了」：清兜底定时器 + 交 brain 核对 seq（陈旧回执作废） */
  function chaseArrived(seq: number): void {
    if (chaseTimer) {
      clearTimeout(chaseTimer)
      chaseTimer = null
    }
    brain.chaseArrived(seq)
  }

  /**
   * 取消在飞的跑腿（挽留专用，补充模块二）。优先级：拖拽 > 跑腿 > 挽留 ——
   * 挽留只赢在"用户手已经放到关闭键上"这一件事上，而跑腿的路正是被挽留
   * 抢走的：不清账的话 6s 兜底会在鱼已经趴到 X 旁边之后再冒一句"跑腿黄了"。
   * chaseTimeout 就是 brain 为"这趟没了"设计的出口（说兜底台词、清 pending）。
   */
  function cancelChaseForRecall(): void {
    if (!chaseTimer) return
    clearTimeout(chaseTimer)
    chaseTimer = null
    brain.chaseTimeout(chaseSeq)
  }

  /**
   * 撒娇挽留：三个来源都打这儿 —— 设置卡「叫它出来」开关悬停（经 app.ts 的
   * pet:plead 通道）、主窗关闭键悬停（上面的轮询）、右键菜单项悬停（渲染端
   * miai-extras.js 直连 POST /miai/plead，见 route()）。8 秒冷却 —— 悬停事件
   * 会连发，一句就够；没宠物窗（child=null）静默：关的就是它，没人听。
   */
  function plead(): void {
    if (!child) return
    const now = Date.now()
    if (now - lastPleadAt < PLEAD_COOLDOWN_MS) return
    lastPleadAt = now
    pleadCount += 1
    sayQuip('plead')
  }

  /**
   * 挽留的停靠点（鱼**中心**的屏幕 DIP）：关闭键左下外沿，留两道净空。
   *
   * 【X 点得动的推导（2026-10-09，补丁方案被否后的替代保证）】命中区
   * 相对身体中心：横向 ±0.1875s、纵向向上 0.203125s（主进程兜底口径，
   * 两侧取宽者）。停靠中心取 (右沿−46−24−0.1875s, 上沿+34+12+0.22265625s)
   * ⇒ 命中区右沿离按钮左沿 24px、上沿离按钮下沿 12px、**且整个命中区都在
   * 按钮的左下外侧**（y 式是加法：中心落在按钮下沿之下，鱼身贴的是内容区
   * 右上角往下的空白，不是按钮本体；此处旧注释误写"左上"，公式为准）。
   * 渲染端另有 body 钳位保证命中区全程在屏。残余风险（渲染进程假死导致
   * 穿透状态没翻回来）已记档验收报告，不为此 patch 供应商 bundle。
   */
  function parkPointFor(mw: PetMainWindowLike): { x: number; y: number } {
    const s = normalizePetConfig(opts.getConfig().pet).size
    const b = mw.getContentBounds()
    return {
      x: b.x + b.width - CLOSE_BUTTON_W - PARK_GAP_X - HIT_HALF_W_RATIO * s,
      y: b.y + CLOSE_BUTTON_H + PARK_GAP_Y + HIT_HALF_H_RATIO * s
    }
  }

  /**
   * 关闭挽留（补充模块二）：把「游到关闭键旁停下」写进 recall 叶子。
   * 与 plead() 分工：plead 管气泡（8s 冷却），recall 管位移（悬停边缘
   * 触发一次）。叶子是**事件语义**（seq 递增），渲染端首拉只记基线 ——
   * 与 goto 同款，防重启后的旧指令被重放。
   */
  function startRecall(mw: PetMainWindowLike): void {
    if (!child || recallActive) return
    const pt = parkPointFor(mw)
    recallActive = true
    recallParked = false
    recallSeq += 1
    const leaf = state.pets.main.recall
    leaf.counter += 1
    leaf.data = { seq: recallSeq, phase: 'go', x: pt.x, y: pt.y }
    log(`recall#${leaf.counter} go seq=${recallSeq} (${Math.round(pt.x)},${Math.round(pt.y)})`)
  }

  /** 悬停离开热区：让鱼归位。没在挽留时零动作（幂等；每拍都会调） */
  function endRecall(): void {
    if (!recallActive) return
    recallActive = false
    recallParked = false
    recallSeq += 1
    const leaf = state.pets.main.recall
    leaf.counter += 1
    leaf.data = { seq: recallSeq, phase: 'back', x: null, y: null }
    log(`recall#${leaf.counter} back seq=${recallSeq}`)
  }

  /**
   * 渲染端回执「到位了」（POST /miai/recall-arrived）。纯簿记：不接 brain、
   * 不吃冷却、不扣饭。go 到位播一次 PLEAD 动画（"摆撒娇可怜动作"的落点）；
   * seq 对不上 = 陈旧回执（鱼已经被叫回去了/又出门了），静默作废。
   */
  function recallArrived(seq: number, phase: 'go' | 'back'): void {
    if (seq !== recallSeq || (phase === 'go' && !recallActive)) {
      log(`recall-arrived stale seq=${seq}/${phase} (current ${recallSeq})`)
      return
    }
    if (phase === 'go') {
      recallParked = true
      recallGoArrived += 1
      playAnim(PET_DSH.ANIM.PLEAD)
      log(`recall arrived seq=${seq} -> plead anim`)
    } else {
      recallBackArrived += 1
      log(`recall back seq=${seq}`)
    }
  }

  /**
   * 跟随**资格**与**跟不了的原因**（2026-10-10 主人裁定「有资格才提」；2026-10-16
   * 凌晨 V1-49 主人批「是bug要修」——没资格时不再整项消失，改成在场置灰、括号里
   * 写明差在哪）。三道硬门，缺一不可：
   *   ① 总闸 config.pet.followMouse（设置页「允许跟随」）；
   *   ② 不挨饿：饱食度 ≥ FOLLOW_MIN_SATIETY(50) —— medium/severe/empty 三档都没资格，
   *      鱼自己都在冒泡催饭（NAG_FEED），再挂着"跟着我走"是自相矛盾的人设；
   *   ③ 够亲：好感 ≥ PET_AFFECTION_LOVE_AT(80)。
   * 【为什么原因与判定共用这一个函数】两处判据必须同门同序：改一处漏一处 = 菜单灰行
   * 写着「饱腹 0%/50%」其实卡在好感上，比什么都不显示还糟。所以唯一实现是
   * followBlockReason()，followEligible() = 它返回空串。要加门，只加在 reason 里。
   * 资格同时决定右键菜单那一项**可不可点**（/miai/flags.followEligible + followBlock
   * → 渲染端 __miaiExtras → sprite.js 菜单补丁）：有资格 = 可点的「跟着我走/别跟着啦」
   * 三元开关；没资格 = 置灰不可点的「跟着我走（差在哪）」。于是**可点** ⇔ 点了真的会
   * 动，没有"点了没反应的僵尸项"（10-10 裁定的魂没变，只是没资格时从消失改成灰着）。
   * 【判定为真必须有证据】vitals 还没写过（null）⇒ 没资格 —— 饿不饿、够不够亲都
   * 不知道的时候，静默待着比扑上去撒娇安全（原因行照样给「状态还没同步」）。
   */
  function followBlockReason(): string {
    if (!child) return PET.FOLLOW_BLOCK.NOT_HOME
    if (recallActive || chaseTimer) return PET.FOLLOW_BLOCK.BUSY
    const s = normalizePetConfig(opts.getConfig().pet)
    if (!s.followMouse) return PET.FOLLOW_BLOCK.SWITCHED_OFF
    const v = state.pets.main.vitals.data
    if (!v) return PET.FOLLOW_BLOCK.NOT_SYNCED
    if (!(v.satiety >= FOLLOW_MIN_SATIETY)) {
      // 数字+门槛，一眼知道差在哪、差多少（菜单列宽的缘故见 copy.ts 那条注释）
      return PET.FOLLOW_BLOCK.HUNGRY(v.satiety, FOLLOW_MIN_SATIETY)
    }
    if (v.affection < PET_AFFECTION_LOVE_AT) {
      return PET.FOLLOW_BLOCK.NOT_CLOSE(v.affection, PET_AFFECTION_LOVE_AT)
    }
    return ''
  }

  function followEligible(): boolean {
    return followBlockReason() === ''
  }

  /**
   * 跟随是否该生效（电平语义，每一拍现算）= **有资格** && 没被用户明确关掉。
   * 【为什么 override 不再是越过资格线的口子】上一版 `override===true` 直接 return true
   * —— 饿到 0 也能从菜单把跟随点开。主人裁定那是错的：过低时"不显示也无法跟随"，
   * 不给任何人越过它的入口。override 现在只剩一个方向：把**已经有资格**的跟随临时
   * 关掉（会话级，重启不记）；null 与 true 等价。
   * 【为什么没有"主窗在前台"这道门】鱼在桌面上跟光标走是天性，用户切到别的窗口它跟着
   * 游也合理；真正会打架的场景（拖拽/菜单/聊天）在渲染端有本地的暂停守卫，比"窗口在
   * 不在前台"准得多。
   */
  function followWanted(): boolean {
    if (!followEligible()) return false
    return followOverride !== false
  }

  /**
   * 光标是不是已经凑到鱼身上了（跟随的"让我抓住你"暂停判据）。
   * 用**上一拍写出去的落点**当鱼的位置：跟随是电平，鱼收敛到落点就停，稳态下落点 =
   * 鱼中心；在途时判早一拍，最坏结果是这一拍不写新落点、鱼就地停下 —— 停下之后这个
   * 模型立刻变准。外扩 FOLLOW_HOVER_PAD_RATIO 的理由见常量注释（稳态下光标停在鱼头顶
   * 上方约 0.027×体型处，正好卡在命中区外一线）。
   * 【为什么是"停下"而不是"躲开"】跟随中的鱼永远在光标前 0.25×体型处 —— 用户**永远
   * 追不上它**，想右键点它（关掉跟随 / 喂一碗饭）就必须先让它停。光标凑近 = 用户想抓它。
   */
  function cursorOnPet(p: { x: number; y: number }, size: number): boolean {
    const last = state.pets.main.follow.data
    if (!last || last.on !== true || typeof last.x !== 'number' || typeof last.y !== 'number') {
      return false
    }
    const halfW = HIT_HALF_W_RATIO * size
    const halfH = HIT_HALF_H_RATIO * size
    const pad = FOLLOW_HOVER_PAD_RATIO * size
    return (
      p.x >= last.x - halfW - pad &&
      p.x <= last.x + halfW + pad &&
      p.y >= last.y - halfH - pad &&
      p.y <= last.y + halfH + pad
    )
  }


  /**
   * 跟随落点（鱼中心，屏幕 DIP）：默认光标下方 R；光标进正文编辑区
   * （外扩 WORK_RECT_PAD）时改为**沿边等待** —— 下 → 上 → 左 → 右取第一个
   * 身体放得下的边；四条边都放不下就返回 null（原地不动：宁可不跟，也
   * 绝不盖在代码上 —— 这是补充模块一点名的底线）。
   */
  function followTargetFor(p: { x: number; y: number }, size: number): { x: number; y: number } | null {
    const R = size * FOLLOW_OFFSET_RATIO
    const wr = workRectScreen()
    if (
      wr &&
      p.x >= wr.x - WORK_RECT_PAD &&
      p.x <= wr.x + wr.width + WORK_RECT_PAD &&
      p.y >= wr.y - WORK_RECT_PAD &&
      p.y <= wr.y + wr.height + WORK_RECT_PAD
    ) {
      const gap = size * WORK_GAP_RATIO
      const halfW = HIT_HALF_W_RATIO * size
      const halfH = HIT_HALF_H_RATIO * size
      const cx = Math.min(Math.max(p.x, wr.x), wr.x + wr.width)
      const cy = Math.min(Math.max(p.y, wr.y), wr.y + wr.height)
      let wa = { x: wr.x, y: wr.y, width: 1920, height: 1080 }
      try {
        wa = screen.getDisplayNearestPoint({ x: Math.round(p.x), y: Math.round(p.y) }).workArea
      } catch {
        /* 显示器拔插瞬时态：按"下方永远放得下"处理，下方是首选位 */
      }
      const candidates = [
        { x: cx, y: wr.y + wr.height + gap }, // 下方（首选：紧贴编辑区下沿）
        { x: cx, y: wr.y - gap }, // 上方
        { x: wr.x - gap, y: cy }, // 左侧
        { x: wr.x + wr.width + gap, y: cy } // 右侧
      ]
      for (const c of candidates) {
        if (
          c.x - halfW >= wa.x &&
          c.x + halfW <= wa.x + wa.width &&
          c.y - halfH >= wa.y &&
          c.y + halfH <= wa.y + wa.height
        ) {
          return c
        }
      }
      return null
    }
    return { x: p.x, y: p.y + R }
  }

  /**
   * 跟随写入（补充模块一）：骑在 150ms 轮询上。条件成立写 {on:true,x,y}
   * （死区内不重写，鼠标不动就不刷 counter）；条件失效补一条 {on:false}
   * （幂等）。渲染端按叶子最新值做指数趋近 —— 宿主只发"电平"，不发每帧
   * 路径（每帧的插值在渲染端，因为只有它知道鱼的当前位置）。
   */
  function followTick(): void {
    const leaf = state.pets.main.follow
    if (!followWanted()) {
      followEligiblePrev = false
      followHovering = false
      if (followOn) {
        followOn = false
        leaf.counter += 1
        leaf.data = { on: false, x: null, y: null }
        log(`follow#${leaf.counter} off`)
      }
      return
    }
    let p: { x: number; y: number }
    try {
      p = screen.getCursorScreenPoint()
    } catch {
      return // 显示器拔插瞬时态：这一拍跳过，下一拍再试
    }
    const size = normalizePetConfig(opts.getConfig().pet).size
    // 资格刚刚成立（false→true 的那条沿）：先说一句撒娇话「想跟随鼠标」，再走常路写落点。
    // 主人裁定的联动就在这一沿上：够亲 + 不饿 ⇒ 它自己开口想跟；同一沿也把菜单项放出来
    // （followEligible 进 /miai/flags）。节流见 FOLLOW_WISH_GAP_MS。
    if (!followEligiblePrev) {
      followEligiblePrev = true
      const now = Date.now()
      if (now - lastFollowWishAt >= FOLLOW_WISH_GAP_MS) {
        lastFollowWishAt = now
        followWishCount += 1
        sayQuip('followWish', 'follow-wish')
      }
    }
    // 光标凑到鱼身上了：**这一拍不写新落点**（鱼收敛到上一拍的目标就地停住），让人抓得到。
    // 不写 off 叶子：跟随仍然是"开"的（菜单标签不该翻），只是这一拍不动身 —— 光标一挪开
    // 下一拍照常续上。计数只记**进入**那一次（每 150ms 加一不是"暂停次数"）。
    if (cursorOnPet(p, size)) {
      if (!followHovering) {
        followHovering = true
        followHoverPauses += 1
        log(`follow hover-pause (cursor on pet, size=${size})`)
      }
      return
    }
    followHovering = false
    const target = followTargetFor(p, size)
    if (!target) return
    const last = leaf.data
    if (
      followOn &&
      last?.on === true &&
      typeof last.x === 'number' &&
      typeof last.y === 'number' &&
      Math.abs(last.x - target.x) < FOLLOW_DEADBAND_PX &&
      Math.abs(last.y - target.y) < FOLLOW_DEADBAND_PX
    ) {
      return
    }
    followOn = true
    leaf.counter += 1
    leaf.data = { on: true, x: target.x, y: target.y }
    followWrites += 1
  }

  /**
   * 正文编辑区的视口矩形上报（渲染端 pet:report-work-rect，CSS px）。
   * null = 编辑区不在/窗口要卸了 → 让位规则整体关掉（跟随退回"光标下方"）。
   * 坏载荷按 null 处理 + 日志 —— 半截矩形比没有矩形危险（会让让位算错边）。
   */
  function reportWorkRect(raw: unknown): void {
    if (raw === null || raw === undefined) {
      if (workRectCss) {
        workRectCss = null
        log('work-rect cleared')
      }
      return
    }
    const r = (typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const nums = [r['x'], r['y'], r['width'], r['height']]
    if (
      !nums.every((v) => typeof v === 'number' && Number.isFinite(v)) ||
      (r['width'] as number) <= 0 ||
      (r['height'] as number) <= 0
    ) {
      workRectCss = null
      log('work-rect dropped (bad payload)')
      return
    }
    const next = {
      x: r['x'] as number,
      y: r['y'] as number,
      width: r['width'] as number,
      height: r['height'] as number
    }
    // 幂等重报（窗口没动、渲染层却按节流又报了一遍）不写日志：拖分隔条
    // 一秒几十报，刷屏的日志会把真正有用的行挤掉。值有变才落一行。
    const prev = workRectCss
    workRectCss = next
    if (!prev || prev.x !== next.x || prev.y !== next.y || prev.width !== next.width || prev.height !== next.height) {
      log(
        `work-rect (${Math.round(next.x)},${Math.round(next.y)},${Math.round(next.width)}x${Math.round(next.height)})`
      )
    }
  }

  /** workRect 的屏幕系换算（withScreenRect 同款数学：内容区原点 + CSS×zoom）。
   *  窗口不在场（隐藏/最小化）就当没有 —— 看不见的编辑区不需要让位。 */
  function workRectScreen(): { x: number; y: number; width: number; height: number } | null {
    if (!workRectCss) return null
    const mw = opts.getMainWindow()
    if (!mw || mw.isDestroyed() || !mw.isVisible() || mw.isMinimized()) return null
    let zoom = 1
    try {
      zoom = mw.webContents.getZoomFactor?.() ?? 1
    } catch {
      zoom = 1 // 半死窗口：按 1 算，宁可落点有偏差也别丢整条让位规则
    }
    const b = mw.getContentBounds()
    return {
      x: b.x + workRectCss.x * zoom,
      y: b.y + workRectCss.y * zoom,
      width: workRectCss.width * zoom,
      height: workRectCss.height * zoom
    }
  }

  function spawnChild(): void {
    const settings = normalizePetConfig(opts.getConfig().pet)
    lastSpawnSettings = settings
    // 新渲染端 = 新的基线：/state 拉取计数归零，欠的问候重新排上
    statePulls = 0
    greetPending = !greeted
    const env: NodeJS.ProcessEnv = { ...process.env }
    // 【必须】子进程是「真 Electron 应用」，不是纯 Node —— ELECTRON_RUN_AS_NODE
    // 会让 electron require 直接抛（官方 helperSpawnEnv 同款清障，issue 现场）
    delete env['ELECTRON_RUN_AS_NODE']
    env['DSH_PET_BRIDGE'] = '1'
    env['DSH_PET_HOST_PID'] = String(process.pid)
    env['DSH_PET_PETS'] = JSON.stringify([{ id: 'main', size: settings.size }])
    env['MIAI_PET_HELPER_MAIN'] = helperMainPath

    // dev：官方 standalone 就是 `electron <…>/main.js`（lib/standalone.js defaultLaunch
    // 的 args = [helperPath]，路径是 main.js 文件而非目录），照抄这条已验证的姿势。
    const args = opts.packaged ? ['--dsh-pet-helper'] : [helperMainPath]
    if (opts.debugPort) args.push(`--remote-debugging-port=${opts.debugPort}`)

    /*
     * cwd 必须是**真实存在**的目录：打包后 helperDir 落在 app.asar 里，
     * asar 是虚拟路径，Windows 的 spawn 会把它当不存在的目录直接 ENOENT
     * （2026-10-17 打包冒烟实测：整个应用被 Electron 的 Error 模态框卡死）。
     * dev 仍用 helperDir（官方姿势要找 app 目录）；发布版用 exe 所在安装目录。
     */
    child = spawn(process.execPath, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.packaged ? dirname(process.execPath) : opts.helperDir
    }) as ChildProcessWithoutNullStreams
    childPid = child.pid ?? 0
    log(`helper spawned pid=${childPid} size=${settings.size} ${opts.packaged ? '(--dsh-pet-helper)' : '(dev: app dir)'}`)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdoutBuf += chunk
      let nl = stdoutBuf.indexOf('\n')
      while (nl >= 0) {
        const line = stdoutBuf.slice(0, nl).replace(/\r$/, '')
        stdoutBuf = stdoutBuf.slice(nl + 1)
        if (line.startsWith(BRIDGE_PREFIX)) {
          void handleBridgeLine(line.slice(BRIDGE_PREFIX.length))
        } else if (line.trim()) {
          log(`helper| ${line}`)
        }
        nl = stdoutBuf.indexOf('\n')
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      const text = String(chunk).trim()
      if (text) log(`helper! ${text.split('\n').slice(0, 4).join(' ⏎ ')}`)
    })
    const spawned = child
    /*
     * spawn 失败（ENOENT/EACCES…）**只发 'error' 不发 'exit'**。没有监听器
     * 就是 uncaughtException —— Electron 弹「A JavaScript error occurred in
     * the main process」模态框，主窗停在 show:false，用户看到的是整个应用
     * 起不来。桌宠起不来是可接受的降级，拖垮主程序不行：只记录、不重试
     * （这类错误基本是路径/权限问题，重试只是循环刷日志）。
     */
    spawned.on('error', (err) => {
      log(`helper spawn error: ${err.message}`)
      if (child !== spawned) return
      child = null
      childPid = 0
      lastError = `helper spawn failed: ${err.message}`
    })
    spawned.on('exit', (code, signal) => {
      log(`helper exited code=${code} signal=${signal}`)
      // 已被顶替（软停宽限内又被启用）或已被 killChild 交卸：这条退出与现状无关，不插手
      if (child !== spawned) return
      child = null
      childPid = 0
      // 挽留态作废（崩溃时子进程没走 childBookkeeping 那条路）：不重置的话
      // recallActive 会永久钉住"别跟"的门，跟随再也回不来。跟随的 off 叶子
      // 由下一拍 followTick 补写（child=null ⇒ 条件不成立 ⇒ 幂等关闭）。
      recallActive = false
      recallParked = false
      // 焦点态同样作废（2026-10-14 修，探针 probe-crash6 RED→GREEN）：崩溃时子
      // 进程也没走 childBookkeeping —— 它里面那句「宠物窗没了 = 焦点不可能还在
      // 它身上（否则主窗会永远"petFocused"，壁纸暂停策略被一条死掉的宠物窗钉住）」
      // 对崩溃路径一字不差地成立。不重置的话：崩溃前刻若宠物窗持焦（实测冷启动
      // 它就是持焦的），petFocused 会永久钉在 true，此后主窗真失焦壁纸也不暂停，
      // 直到下一次真正点/离开宠物窗才自愈。expectedExit/stopping 分支走到这儿时
      // 它多半已是 false（前两者走 childBookkeeping 清过）—— if 守卫使其幂等。
      if (petFocused) {
        petFocused = false
        opts.onPetFocus?.(false)
      }
      // 关闭桌宠的预期自退（stopChildForDisable 登记过）：不触发崩溃重启
      if (expectedExit.has(spawned)) return
      if (stopping) return
      if (fails >= RESTART_MAX_FAILS) {
        lastError = `helper crashed ${fails} times in a row, giving up restart`
        log(lastError)
        return
      }
      fails += 1
      restarts += 1
      const delay = RESTART_BASE_MS * Math.pow(2, fails - 1)
      log(`helper exited unexpectedly; restart #${restarts} in ${delay}ms`)
      restartTimer = setTimeout(() => {
        restartTimer = null
        if (!stopping) spawnChild()
      }, delay)
    })
  }

  /**
   * 子进程交卸的公共簿记（killChild 与 stopChildForDisable 共用；幂等，可重复跑）。
   * 宠物窗没了 = 焦点不可能还在它身上（否则主窗会永远"petFocused"，壁纸暂停
   * 策略被一条死掉的宠物窗钉住）。顺带清跑腿兜底与悬停边缘标志；欠着的问候
   * 跟着这次子进程一起作废：等新渲染端自己的首拉再来排（防在没有渲染端的
   * 时间里空写叶子，也防重启后问候落在基线上被吞）。
   */
  function childBookkeeping(): void {
    if (restartTimer) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
    if (petFocused) {
      petFocused = false
      opts.onPetFocus?.(false)
    }
    if (chaseTimer) {
      clearTimeout(chaseTimer)
      chaseTimer = null
    }
    // 跟随/挽留的会话态跟着子进程一起作废：新渲染端 = 新的基线。叶子上
    // 残留的 on:true 要清掉（否则重启后的渲染端首拉就照着旧坐标游过去）；
    // followOverride 是**用户意图**，不随子进程重置（重启后照他的选择来）。
    if (followOn || state.pets.main.follow.data?.on) {
      followOn = false
      const leaf = state.pets.main.follow
      leaf.counter += 1
      leaf.data = { on: false, x: null, y: null }
    }
    recallActive = false
    recallParked = false
    hoverArmed = true
    greetPending = false
    if (greetTimer) {
      clearTimeout(greetTimer)
      greetTimer = null
    }
  }

  function killChild(): void {
    childBookkeeping()
    if (child) {
      child.removeAllListeners('exit')
      try {
        child.kill()
      } catch {
        /* 已死透：kill 抛也无事可做 */
      }
      child = null
      childPid = 0
    }
  }

  /**
   * 关闭桌宠（applySettings 的 disabled 分支专用）：先礼后兵 —— 给 helper 一条
   * 体面自退的路，到点没退再硬收。
   *
   * 【为什么不当场 child.kill()】Windows 的 child.kill() = TerminateProcess。长寿命
   * helper（拖拽/右键/音频等一整套交互跑过之后）被它命中时会落进内核态等待：47 个
   * 线程塌成 1 个主线程残骸，CPU/内存冻结，taskkill /T /F 连句柄都打不开（报
   * "找不到此进程的运行实例"），tasklist 里还挂 2~5 分钟才散 —— 探针 menuoff 臂
   * 「helper 进程消失」8s 判据因此红（2026-10-06 实测；同款 kill 打在新鲜实例上
   * 500ms 内干净死 —— 状态相关的内核层卡死，用户态没有强制解法）。
   * 配套补丁在 helper 的 main.js：收到本宿主对 /miai/pet-off 的回包后自己
   * app.exit(0)（一枪毙命、不走 Chromium teardown）。这里宽限 SOFT_STOP_GRACE_MS
   * 等它自退；到点还活着（旧 helper / 补丁失效）→ killChild() 硬收兜底。
   * 状态簿记立即做：那些是「有没有宠物窗」的判定资料，与进程何时真正消失解耦。
   */
  function stopChildForDisable(): void {
    childBookkeeping()
    if (!child) return
    const dying = child
    expectedExit.add(dying)
    const grace = setTimeout(() => {
      // 到点还没退（没等到自退）→ 硬收兜底。按**实例**收：若期间已被新实例顶替
      // （宽限内又被启用），旧的这条照样得收掉——按「当前 child」判活会把它漏成孤儿。
      if (dying.exitCode !== null || dying.signalCode !== null) return
      dying.removeAllListeners('exit')
      if (child === dying) {
        childBookkeeping()
        child = null
        childPid = 0
      }
      try {
        dying.kill()
      } catch {
        /* 已死透：kill 抛也无事可做 */
      }
    }, SOFT_STOP_GRACE_MS)
    grace.unref?.()
  }

  // ── 桥请求路由 ─────────────────────────────────────────────────────────
  async function handleBridgeLine(json: string): Promise<void> {
    let req: BridgeRequest
    try {
      req = JSON.parse(json) as BridgeRequest
    } catch {
      log(`bridge request parse failed: ${json.slice(0, 200)}`)
      return
    }
    let resp: BridgeResponse
    try {
      resp = await route(req)
    } catch (err) {
      lastError = String(err)
      log(`route error ${req.url}: ${lastError}`)
      resp = { status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'miai-host-error' }) }
    }
    try {
      await fetch(req.cb, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: req.id, ...resp }),
        signal: AbortSignal.timeout(15_000)
      })
    } catch (err) {
      log(`callback failed id=${req.id}: ${String(err)}`)
    }
  }

  function resolveAsset(rel: string): string | null {
    // 防目录穿越：解析后必须仍在 assets 根内（渲染端 URL 是外部输入）
    const root = resolve(assetsDir)
    const target = resolve(root, rel)
    if (target !== root && !target.startsWith(root + sep)) return null
    return target
  }

  function fileResp(path: string | null, contentType: string): BridgeResponse {
    if (!path || !existsSync(path)) return { status: 404, contentType: 'text/plain', body: 'not found' }
    return { status: 200, file: path, contentType }
  }

  /**
   * 出场问候的排程（在 /state 路由里被顺手叫一下，别处不用）。
   * 判据：欠着 + 渲染端已拉过至少一次 /state（基线已记）+ 宿主还没问候过。
   * 排上后 2.5s 落话 —— 那时渲染端早过了首拉，下一拍轮询就能看见。
   */
  function maybeGreet(): void {
    if (!greetPending || greeted || statePulls < 1) return
    greetPending = false
    greeted = true
    greetTimer = setTimeout(() => {
      greetTimer = null
      brain.greet()
    }, GREET_DELAY_MS)
  }

  async function route(req: BridgeRequest): Promise<BridgeResponse> {
    // 【坑】桥请求行的 url 是 helper 侧 `url.pathname + url.search`（main.js:596），
    // 是**相对路径** —— 直接 new URL(req.url) 会抛 Invalid URL，把每个请求都变成 500。
    // 给一个不存在的基址只为让解析器高兴，pathname/searchParams 两者都不受影响。
    const u = new URL(req.url, 'http://dsh-pet-bridge.invalid')
    // 渲染端 BASE = dsh-pet-bridge://dsh-pet/dsh-pet-7340 → pathname 带这个前缀
    const path = u.pathname.replace(/^\/dsh-pet-7340/, '')
    const method = req.method.toUpperCase()

    if (method === 'GET' && path === '/config') {
      const settings = normalizePetConfig(opts.getConfig().pet)
      const merged = loadPetConfigFile(configPath, settings)
      return { status: 200, contentType: 'application/json', body: JSON.stringify(merged) }
    }
    if (method === 'GET' && path === '/state') {
      statePulls += 1
      maybeGreet()
      return { status: 200, contentType: 'application/json', body: JSON.stringify(state) }
    }
    if (method === 'GET' && path.startsWith('/thumb/')) {
      // /thumb/main/<file>：动画 webm。file 可能被 encodeURIComponent 过
      const file = decodeURIComponent(path.slice('/thumb/'.length).replace(/^main\//, ''))
      return fileResp(resolveAsset(join('webm', file)), 'video/webm')
    }
    if (method === 'GET' && path === '/miai/quack.wav') {
      quackServed += 1
      return fileResp(resolveAsset(join('miai-assets', 'quack.wav')), 'audio/wav')
    }
    if (method === 'GET' && path.startsWith('/miai-assets/')) {
      const file = decodeURIComponent(path.slice('/miai-assets/'.length))
      return fileResp(resolveAsset(join('miai-assets', file)), 'application/octet-stream')
    }
    if (method === 'GET' && path.startsWith('/pic/memes/')) {
      // 剥素材根段，与 /thumb/ 同款：渲染端拼 URL 时带 assetRoot（=宠物 id "main/"），
      // 磁盘上 memes/ 是一层平铺 —— 不剥则整类贴纸全 404（2026-10-06 主人截图「就一碗」裂图）
      const file = decodeURIComponent(path.slice('/pic/memes/'.length).replace(/^main\//, ''))
      return fileResp(resolveAsset(join('memes', file)), 'image/png')
    }
    if (method === 'GET' && path.startsWith('/pic/')) {
      const file = decodeURIComponent(path.slice('/pic/'.length))
      return fileResp(resolveAsset(join('pic', file)), 'image/png')
    }
    if (method === 'GET' && path.startsWith('/font/')) {
      const file = decodeURIComponent(path.slice('/font/'.length))
      return fileResp(resolveAsset(join('fonts', file)), 'font/ttf')
    }
    if (method === 'POST' && path === '/miai/open-settings') {
      const tab = u.searchParams.get('tab')
      const card = tab === 'ai' ? 'ai' : 'wall'
      const mw = opts.getMainWindow()
      if (!mw || mw.isDestroyed()) return { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }
      // 三件套与旧引擎 openSettings 同口径：restore 管最小化、show 管没露头、
      // focus 管被盖住；app:nav 由渲染层 app-nav.ts 接住滚到对应卡
      if (mw.isMinimized()) mw.restore()
      if (!mw.isVisible()) mw.show()
      mw.focus()
      try {
        const payload: AppNavPayload = { card, ts: Date.now() }
        mw.webContents.send(IPC.appNav, payload)
      } catch {
        /* 半死窗口：指令丢了就丢了，窗口本身已经拉起来了 */
      }
      log(`menu -> open settings (${card})`)
      return { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }
    }
    if (method === 'POST' && path === '/whisper') {
      // 菜单「听大肥鱼碎碎念」：立刻写 say 叶子，渲染端 pollStateNow 后 0 延迟可见
      sayQuip('menu')
      return { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }
    }
    if (method === 'POST' && path === '/balance') {
      // 菜单「查看余额」（V1-30）：现查一次 DeepSeek 并写 sections.balance。
      // 应答恒 ok:true —— 它只表示「动作收到了」，查询成败在叶子数据里
      // （供应商的 postAction 拿 ok 只决定一条 console.warn，气泡照走 /state）。
      // 写叶发生在应答**之前**（await）：渲染端拿到 ok 后会立刻 pollStateNow，
      // 那一刻新叶子必须已经在——顺序反了就得干等下一个 1s 轮询。
      await refreshBalance()
      return { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }
    }
    // ── 互动三条：菜单项与鱼身上的点击仲裁都打这儿 ──────────────────────
    // 判定（冷却/台词/动画）全在 brain —— 这里只转发与应答，零业务。
    if (method === 'POST' && path === '/miai/feed') {
      brain.act({ action: 'feed' })
      return { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }
    }
    if (method === 'POST' && path === '/miai/pat') {
      brain.act({ action: 'pat' })
      return { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }
    }
    if (method === 'POST' && path === '/miai/rua') {
      brain.act({ action: 'rua' })
      return { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }
    }
    if (method === 'GET' && path === '/miai/flags') {
      // 宠物窗读不到 config（权限最小化的代价），小黄鸭音效的开关读数走这儿。
      // 补充模块一（2026-10-09）扩了两格：follow=跟随当前是否在生效（渲染端
      // 拿它调轮询节奏与菜单标签的对账），roam=「饥饿时活跃乱跑」总闸
      // （渲染端的自主漫游闸门；renderer 的过期纪律是 5s，见 miai-extras）。
      // 2026-10-10 再加 followEligible=跟随资格（总闸开 && 不挨饿 && 够亲）——
      // 右键菜单那一项可不可点就看它（渲染端 __miaiExtras.followEligible）。
      // 2026-10-16 V1-49 配套再加 followBlock=跟不了的原因（没资格时菜单灰行
      // 括号里那句话，如「饱腹 0%/50%」）。两者**同一次求值**：有资格必是空串，
      // 保证渲染端永远不可能拿到「不合格 + 没原因」这种摆不出的组合。
      const s = opts.getSound()
      const pet = normalizePetConfig(opts.getConfig().pet)
      const followBlock = followBlockReason()
      return {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sound: !!s.enabled && s.volume > 0,
          volume: s.volume,
          follow: followOn,
          followEligible: followBlock === '',
          followBlock,
          roam: pet.hungryRoam
        })
      }
    }
    if (method === 'POST' && path === '/miai/anim') {
      const name = u.searchParams.get('name') ?? ''
      if (!name) return { status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false }) }
      playAnim(name)
      return { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }
    }
    if (method === 'POST' && path === '/miai/chase-arrived') {
      // 跑腿到达回执（miai-extras 走到落点后 POST；body 与 /chat 同姿势：
      // 原始 JSON 文本）。seq 必须是正整数 —— 对不上是陈旧回执，brain 里
      // 核对后静默作废；body 坏了按 bad-request 回，别把协议错藏成"没到达"。
      let seq = Number.NaN
      try {
        seq = Number((JSON.parse(String(req.body)) as { seq?: unknown } | null)?.seq)
      } catch {
        seq = Number.NaN
      }
      if (!Number.isInteger(seq) || seq <= 0) {
        return { status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false }) }
      }
      chaseArrived(seq)
      return { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }
    }
    if (method === 'POST' && path === '/miai/pet-focus') {
      // 宠物窗焦点上报（渲染端 window focus/blur）。**只上报变化**——壁纸链
      // 收到一次就强推一次窗口状态，去重在这里先做一半。非布尔载荷 = 协议
      // 坏了，回 400 不改状态（宁可少报一次，也别把坏 JSON 读成"失焦"）。
      let focused: boolean
      try {
        const parsed = JSON.parse(String(req.body)) as { focused?: unknown } | null
        if (typeof parsed?.focused !== 'boolean') throw new Error('bad focused payload')
        focused = parsed.focused
      } catch {
        return { status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false }) }
      }
      if (focused !== petFocused) {
        petFocused = focused
        opts.onPetFocus?.(focused)
        log(`pet-focus ${focused ? 'in' : 'out'}`)
      }
      return { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }
    }
    if (method === 'POST' && path === '/miai/pet-off') {
      // 右键菜单「关闭大肥鱼」。分工：app.ts 把 enabled=false 写进 config 并
      // 广播（设置页开关跟着灭），宿主随后 applySettings() —— 此刻配置已是
      // false，stopChildForDisable 软停收窗（helper 收到本请求的回包后自退，
      // 宽限内没退才硬收）。onMenuDisable 缺席（宿主独立跑的单测）时
      // applySettings 读到 enabled 仍 true = 什么都不发生：**宁可无动作，
      // 不许假装关掉了**（气泡还在原地 = 失败可见，不搞善意的假成功）。
      log('menu -> pet off')
      try {
        opts.onMenuDisable?.()
      } catch (err) {
        log(`pet-off handler failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      applySettings()
      return { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }
    }
    if (method === 'POST' && path === '/miai/plead') {
      // 右键菜单项悬停挽留（渲染端 miai-extras.js 的 mouseover 委托打过来）。
      // 与设置页悬停、主窗关闭键悬停共用这一个 plead()：**冷却只在 plead 里做**
      //（三个入口共享 8 秒窗），这里不重复限流。child 不在时 plead() 自己静默 ——
      // 那个时刻要关的就是它，没有听的耳朵；路由照常回 ok（不是失败，是没对象）。
      plead()
      return { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }
    }
    if (method === 'POST' && path === '/miai/follow') {
      // 右键菜单「跟着我走 / 别跟着啦」（补充模块一）：翻转**当前生效的**
      // 跟随状态，落成会话级覆盖。菜单那一项的三元与这里同源（读渲染端
      // __miaiExtras.followOn，它跟的就是这颗叶子）—— 这里翻的就是用户
      // 看着点下去的那一项。不等下一个 150ms，当场补一拍（点击要跟手）。
      //
      // 2026-10-10（主人裁定「有资格才提」）：**没资格就拒绝**。渲染端已经把
      // 没资格的那一项从菜单里藏了，这里是第二道：菜单是"约定"，这里是"事实"——
      // 陈旧读数（flags 5s 一拍）或手搓请求都可能让一个不该出现的点击到达。
      // 拒绝不是错误：回 ok:true + turned:'refused'，日志留一行可归因。
      if (!followEligible()) {
        followRefused += 1
        log(`menu -> follow refused (ineligible satiety/affection)`)
        return {
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, turned: 'refused' })
        }
      }
      const before = followWanted()
      followOverride = !before
      log(`menu -> follow ${followOverride ? 'on' : 'off'} (override)`)
      followTick()
      return { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }
    }
    if (method === 'POST' && path === '/miai/recall-arrived') {
      // 关闭挽留的到位回执（渲染端走到停靠点/退回原位后 POST；body 与
      // /miai/chase-arrived 同姿势：原始 JSON 文本）。纯簿记 —— 不接
      // brain、不吃冷却、不扣饭；seq/phase 坏掉按 bad-request 回，别把
      // 协议错藏成"没到位"。
      let seq = Number.NaN
      let phase = ''
      try {
        const parsed = JSON.parse(String(req.body)) as { seq?: unknown; phase?: unknown } | null
        seq = Number(parsed?.seq)
        phase = String(parsed?.phase ?? '')
      } catch {
        seq = Number.NaN
      }
      if (!Number.isInteger(seq) || seq <= 0 || (phase !== 'go' && phase !== 'back')) {
        return { status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false }) }
      }
      recallArrived(seq, phase)
      return { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }
    }
    if (method === 'GET' && path === '/miai/theme') {
      // 主题读数（渲染端给右键菜单挂 html[data-miai-theme] 用）。宠物窗读不到
      // config（同 /miai/flags 的权限最小化口径），宿主转一手；只认 'dark'，
      // 其余一律 'light' —— 渲染端同样只认 'dark' 分支，两侧口径一字不差。
      const theme = opts.getConfig().theme === 'dark' ? 'dark' : 'light'
      return { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, theme }) }
    }
    if (method === 'POST' && path === '/reload') {
      // 渲染端菜单「重载宠物」：重启 helper 进程（重新拉 /config、重建窗口）
      log('reload requested -> restarting helper')
      setTimeout(() => reload(), 120)
      return { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }
    }
    if (method === 'POST' && path === '/chat') {
      // 「跟本鱼聊天」的收件口（渲染端对话弹窗 → 桥 → 这里 → ./chat.ts 编排）。
      // 桥的 body 是**原始 JSON 文本**（main.js 用 request.text() 读的），
      // 解析失败按 bad-request 回——脏 body 藏进气泡会掩盖协议层的真 bug。
      let text: unknown = null
      try {
        text = (JSON.parse(String(req.body)) as { text?: unknown } | null)?.text ?? null
      } catch {
        text = null
      }
      const reply = await chatService.handle(text)
      return { status: 200, contentType: 'application/json', body: JSON.stringify(reply) }
    }
    log(`unimplemented route ${method} ${path}`)
    return { status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'not-implemented' }) }
  }

  // ── 碎碎念定时器（纯本地台词池，零 API）────────────────────────────────
  function startWhisperTimers(): void {
    stopWhisperTimers()
    startupTimer = setTimeout(() => sayQuip('startup'), STARTUP_QUIP_DELAY_MS)
    whisperTimer = setInterval(() => {
      // 冷漠抑制（2026-10-09 补充模块一②「20%- 冷漠」）：好感 <20 的鱼不
      // 碎碎念 —— 与 brain 的 proactiveTick 抑制同一条口径，两端一起冷。
      // 只看周期性这条；startup 那条一次性问候照旧（它是"鱼还在桌上"的
      // 信号，也是引擎自带的出场语，冷档把它也掐掉会让桌宠像坏了）。
      // 读数读不到（null）不拦：同 say-gate 的 fail-open。
      const aff = currentAffection()
      if (aff !== null && petAffectionTier(aff) === 'cold') {
        whisperColdSkipped += 1
        log(`whisper skipped (cold ${aff})`)
        return
      }
      const h = beijingParts(new Date()).h
      sayQuip(h >= 23 || h < 6 ? 'lateNight' : 'idle')
    }, WHISPER_INTERVAL_MS)
  }

  function stopWhisperTimers(): void {
    if (startupTimer) {
      clearTimeout(startupTimer)
      startupTimer = null
    }
    if (whisperTimer) {
      clearInterval(whisperTimer)
      whisperTimer = null
    }
  }

  function reload(): void {
    if (stopping) return
    fails = 0
    killChild()
    spawnChild()
  }

  function applySettings(): void {
    if (stopping) return
    const next = normalizePetConfig(opts.getConfig().pet)
    if (!next.enabled) {
      if (child) log('settings: pet disabled -> stopping helper')
      stopChildForDisable()
      stopWhisperTimers()
      /*
       * 空转[4]（2026-10-16）：关掉 = 彻底关。三件事缺一不可 ——
       * 之前只停了子进程与碎碎念，30s 心跳照走，账本一直在动
       * （复核实测 30 分钟 57→50），这就是主人点名要整改的那条。
       */
      stopBrainTimer()
      stopHoverTimer()
      brain.setPaused(true)
      return
    }
    // 开着（含从关到开）：先解冻再起表。setPaused(false) 只在**真转换**时
    // 动作（把冻结期从三个锚点上抹掉并落盘），重复调用是 no-op ——
    // 每次保存设置都走到这里，不幂等的话改个主题都会清衰减零头。
    brain.setPaused(false)
    startBrainTimer()
    startHoverTimer()
    if (!child || expectedExit.has(child)) {
      // expectedExit 命中的是「正在软停、还没退完」的实例：等同无窗，照常起新的
      // （旧实例自退很快；它的 exit 事件因 child 已被顶替而不插手，宽限定时器同理）
      log('settings: pet enabled -> starting helper')
      spawnChild()
      startWhisperTimers()
      return
    }
    if (lastSpawnSettings && (lastSpawnSettings.size !== next.size || lastSpawnSettings.corner !== next.corner)) {
      log(`settings changed size=${next.size} corner=${next.corner} -> restarting helper`)
      reload()
    }
  }

  function stop(): void {
    stopping = true
    stopWhisperTimers()
    stopBrainTimer()
    stopHoverTimer()
    killChild()
  }

  // 起步：enabled 才拉子进程、起两条表；关闭时保持静默
  //（设置页开开关会走 applySettings）。initial 的读取已上移（brain 构造
  // 要用 startPaused），这里只消费那一份。
  if (initial.enabled) {
    spawnChild()
    startWhisperTimers()
    startBrainTimer()
    startHoverTimer()
  } else {
    log('pet disabled in settings; skipping spawn (brain paused, timers off)')
  }

  /**
   * 上报载荷的 rect 换算：渲染层报的是**主窗视口 CSS px**，跑腿要的是**屏幕
   * DIP**。换算 = 内容区原点 + rect × 页面缩放（CSS px 与 DIP 的固定倍率
   * 关系）。拿不到窗口/窗口死了 → rect 置 null（brain 收到 null 只说话不动
   * 身，降级不是错）；rect 缺字段/不是对象 → 原样交回（形状合法性问题归
   * normalizeRunReport 的判据，别在这里重复第二份）。
   */
  function withScreenRect(raw: unknown): unknown {
    if (typeof raw !== 'object' || raw === null) return raw
    const report = raw as Record<string, unknown>
    const r = report['rect']
    if (typeof r !== 'object' || r === null) return raw
    const { x, y, width, height } = r as Record<string, unknown>
    if (![x, y, width, height].every((v) => typeof v === 'number' && Number.isFinite(v))) {
      return { ...report, rect: null }
    }
    const mw = opts.getMainWindow()
    if (!mw || mw.isDestroyed()) return { ...report, rect: null }
    let zoom = 1
    try {
      zoom = mw.webContents.getZoomFactor?.() ?? 1
    } catch {
      zoom = 1 // 半死窗口：按 1 算，宁可落点有偏差也别丢整条上报
    }
    const b = mw.getContentBounds()
    return {
      ...report,
      rect: {
        x: b.x + (x as number) * zoom,
        y: b.y + (y as number) * zoom,
        width: (width as number) * zoom,
        height: (height as number) * zoom
      }
    }
  }

  return {
    stop,
    reload,
    applySettings,
    init: () => brain.init(),
    act: (raw: unknown) => brain.act(raw),
    // rect 进 brain 之前先换到屏幕系（跑腿的目标点是屏幕 DIP）
    reportRun: (raw: unknown) => brain.reportRun(withScreenRect(raw)),
    plead,
    reportWorkRect,
    grantRun: (fp: string) => brain.grantRun(fp),
    mirrorRice: (n: number) => brain.mirrorRice(n),
    debugState: () => ({
      pid: childPid,
      restarts,
      fails,
      quackServed,
      lastError,
      sayCounter: state.pets.main.say.counter,
      animCounter: state.pets.main.anim.counter,
      gotoCounter: state.pets.main.goto.counter,
      vitalsCounter: state.pets.main.vitals.counter,
      // C13：vitals 的**当前值**也要露出来（探针拿它和菜单进度条宽度对账，
      // 只给 counter 的话"宽度 = satiety 换算值"这条判据没有第二份真值可比）
      vitals: state.pets.main.vitals.data,
      // P3 ③ 的静默证据链：被闸掉的条数（每条在日志里有 'say dropped' 行）
      sayDroppedStarving,
      // 补充模块一② 的冷漠抑制读数（碎碎念跳过几次；每条日志一行 'whisper skipped'）
      whisperColdSkipped,
      chaseSeq,
      petFocused,
      pleads: pleadCount,
      // 补充模块一/二（2026-10-09）的探针读数：跟随电平与写入计数、手动
      // 覆盖、让位矩形（CSS 系原样，探针知道它和屏幕系的换算）、挽留状态机。
      followOn,
      followWrites,
      followOverride,
      // 2026-10-10「有资格才提」+「跟随吞点击」修复的探针读数：
      // followEligible=资格线当前真假（/miai/flags 同源）；followBlock=跟不了的原因
      // （V1-49 探针：菜单灰行文案的宿主侧真值，'' = 有资格）；followWishCount=说过几次
      // 「想跟随鼠标」；followHoverPauses=光标压到鱼身上而暂停跟随的次数（进入沿计数）；
      // followRefused=没资格却被点了菜单跟随的次数（每次日志一行 'follow refused'）。
      followEligible: followEligible(),
      followBlock: followBlockReason(),
      followWishCount,
      followHoverPauses,
      followRefused,
      workRect: workRectCss,
      recallSeq,
      recallActive,
      recallParked,
      recallGoArrived,
      recallBackArrived,
      size: lastSpawnSettings?.size ?? null,
      corner: lastSpawnSettings?.corner ?? null,
      statePulls,
      greetPending,
      greeted,
      chatHistoryLen: chatService.historyLength(),
      brain: brain.debugState()
    })
  }
}
