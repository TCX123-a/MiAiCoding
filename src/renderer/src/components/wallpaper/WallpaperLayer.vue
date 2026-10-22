<script setup lang="ts">
/**
 * 壁纸层（docs/23；P3 第二步 = 双槽过场 + 轮播 + 鼠标透视 + 壁纸音轨 + 手动暂停）。
 *
 * 【它在页面里的位置与画序】挂 `App.vue` 的 `.layout` 第一子，`position: fixed;
 * inset: 0; z-index: -1`。**刻意避开 zoom 祖先**（zoom.css 那条教训：fixed 进
 * 缩放层定位基准会飘）；`z-index: -1` 让它在绘制序上位于 body 与一切内容
 * 之下 —— 壁纸永远只当背景（「谁能透出壁纸」由门控与 glass 令牌决定）。
 *
 * 【双槽 A/B（黑屏根因的修法，逐字保留自 P1 原型）】两个常驻 `.wp-slot` 交替
 * 出图，过场在槽间跑；**退役槽当场压到 z-index:1** 垫在活动槽（CSS 默认 2）
 * 之下 —— 两槽同 z 时 DOM 靠后的 slotB 恒在 slotA 上，换到 A 槽的图会被 B 槽
 * 残留内容整帧盖住（2026-10-04 实测的黑屏根因）。
 *
 * 【层次的划分（谁动什么）】
 *   .wp-stage    —— 鼠标透视的目标（独立属性 translate/scale，写在 wallpaper.css）
 *   .wp-slot ×2  —— **过场的唯一目标**：transform/opacity/clip-path 全是内联写
 *   .wp-fit      —— 持久视觉样式（filter/opacity/翻转/模糊补偿），一次写入
 *   video/img    —— 只管 object-fit（画面适配）
 * 分这么多层是为了互不覆盖：resetSwitchStyles 清的是**槽位**的内联样式，用户
 * 调的透明度/滤镜写在 .wp-fit 上，过场跑完不会把它擦掉。
 *
 * ⚠️ Vue 模板铁律：`.wp-slot` 上**只写静态 class，禁止 :class 绑定** ——
 * patchClass 会把整个 className 重写成绑定值，把 transitions.ts 用 classList
 * 加上的过场类悄悄抹掉（症状是过场偶发地"没有动画"）。槽位内部的节点也全部由
 * 本文件 imperative 创建（Vue 模板里槽位是空 div，不 patch 其子节点）。
 *
 * 【换片流水线（show → doShow）】全程串行：`switching` 一直保持到旧层的
 * onRetire（过场 ms+100）落地才放行下一次；期间的连点合并成 pendingSwitch
 * （只留最后一次）。串行化的代价是连续切换不重叠（P1 原型允许重叠，但那会让
 * "上一场的 onRetire"误杀当前层），收益是任何时刻至多一层在途、退役对象不会认错。
 *
 * 【就绪门（内容闸）】新层先挂 `--pending`（opacity:0，不参与绘制，屏上留给
 * 旧层）→ 等媒体就绪（video=loadeddata/img=load；20s 超时先查 readyState>=2
 * 放行）→ 就绪才起过场。视频失败且条目带海报图 → 降级重试海报；连海报都没有
 * → 弃本次保旧层（绝不把"坏掉了"伪装成"换好了"）。
 *
 * 【暂停链】主进程推原生事实（focused/minimized/visible）+ 首帧 getWallpaperState
 * 兜底 + 本地 visibilitychange → derivePause（纯函数）→ stopped = 原生暂停 ||
 * 手动暂停（lib/wallpaper/play-state，会话态不落盘）。stopped 统一驱动视频
 * 与视差（parallax.setSuspended）；恢复加 300ms 去抖（P1 口径；**短停 <1s
 * 例外**——刚落下的停止多半是竞态误停，立即恢复，见 stopped watch 注释）。
 *
 * 【音频闸】双槽共存期间只允许**一个**视频发声：audioGate = 当前展示层的
 * video 元素（过场开始时切换，退役 ms+100 释放）；其余一律 muted。音量 0 或
 * trackOn=false 时全静音。【2026-10-07 场景 BGM 接线】场景进同一只闸的孪生
 * sceneGate（当前展示层的场景 rec）：挂载期一律 muted 起步（engine 恒传
 * volume:0），音量只在闸移交点（handoffSceneAudio）与配置热更（applySceneSettings）
 * 写，都走引擎唯一法定入口 inst.setVolume；闸从场景移走就当场收 0，新层是场景
 * 时旧视频当场让位 —— 过场期绝不同时出声（R7 单声源）。
 *
 * 【轮播】池 = 可渲染条目（isRenderableItem：视频或带预览图），≥2 才转；
 * 定时器到点时若 stopped/switching → rotationDue=true 延后，show 结束或恢复
 * 去抖后补切（P1 口径）。**欠账会被销号**：轮播关掉或选中被清除（selectedId
 * 为空）时 due 作废 —— 否则恢复播放会把「清除」掉的壁纸轮回来、或让已关的
 * 轮播偷切一张（2026-10-05 复核的两条实锤）。轮播也写 selectedId 落盘 ——
 * 设置页「当前壁纸」与屏上内容必须是同一个事实。
 *
 * 【场景引擎（P3 第三步，2026-10-05）】scene 类型条目不再降级海报：交给
 * lib/wallpaper/engine.ts 的 mountScene 挂 WebGL 画布（挂进 .wp-fit，与
 * video/img 同层位）。四个要点：
 *  · **挂载永远 settle**：超时/失败都在 engine.ts 里收掉半成品（err.instance
 *    与迟到实例），本文件拿到失败统一走海报降级（连海报都没有就保旧层）；
 *  · **暂停链与视频共用**：syncPaused = syncVideos + syncScenes；挂载完成
 *    当场对齐暂停态（停了就 pause，别等下一次 watch）；
 *  · **指针与音频单向推**：两条入口共用 pushPointerAll —— ①视差 onPointer
 *    （pointermove，受视差开关门控）②单击/双击转发（pointerdown/up，2026-10-07
 *    Bug2 修复，不受视差门控）。槽位整条链 pointer-events:none，引擎自己的
 *    DOM 监听收不到事件，这两条是全部通道；
 *    audio.ts 频谱源经 setAudio 绑定 —— 挂载时未启用传 null（=频谱全 0），
 *    运行期开关两个方向都传 snapshot 源，**绝不 setAudio(null)**（那是引擎
 *    「回落内置模拟源」的语义，壁纸会在音频关闭时自嗨）。2026-10-06 起采集端
 *    带自愈重试：失败不再回滚开关，挂上/重连成功（'live' 事件）时对所有实例
 *    重推源；配套的引擎侧 audioSim 闸门热修（build/webwallgl-hotfix.ts）让
 *    晚到的 setAudio 真正开闸 —— 两处缺一，首载失效都修不完整；
 *  · **壁纸自带属性**（cfg.itemProps）落座后异步接通：loadItemProps 缓存命中
 *    时毫秒级，发**全量「默认 + 覆盖」**而不是只发覆盖 —— 面板的「恢复默认」
 *    是删覆盖键，只发覆盖的话运行中的场景不会跟着回默认（静默失效）。
 *
 * 【场景预热（Bug1 切换卡顿修复，2026-10-07 深夜）】选择壁纸弹窗悬停场景条目
 * （preload.ts 意图总线）→ 把该场景提前挂进非活动槽（--pending 隐身、首帧后
 * 当场 pause）→ 点选命中时原地「转正」（doShow 的 adopted 分支）：退休与挂载
 * 两块同步重活全免，只剩既有 cross-fade。单热身槽（活动 1 + 热身 1 = 既有
 * 过场期并存口径，不新增内存峰值）；换别条 / 关弹窗 / 点选视频即 drop 收尸。
 * 机制细节与已知副作用面见「场景预热」节。
 *
 * 【浮层降级（2026-10-08 体感卡顿修复）】模态弹窗/抽屉/搜索面板盖上来时
 * （lib/wallpaper/overlay-dim 计数 >0），背景转「降级档」把算力让给前端 UI：
 * 停鼠标透视（parallax.setSuspended 并集）、停音频频谱轮询
 * （capture.setActive 并集）、场景降到 DIM_SCENE_FPS=24（走 applySceneSettings
 * 的 setFps 口径，挂载参数同步取值 —— 两处缺一，挂载会漏掉降级）。
 * 关闭即平滑恢复。**并集纪律**：stopped（暂停链）与浮层降级两路各自独立，
 * 任一为真即降、全假才恢复 —— 谁都不许直接写裸布尔复位（会吞掉另一路的
 * 暂停）。视频在降级档不降（原生元素没有限帧面）；引擎的 setOcclusion
 * 分档系统考察后未采用（其脏矩形语义要心跳维持，setFps 一行直达且可测）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSettingsStore } from '../../stores/settings'
import { useWallUiStore } from '../../stores/wall-ui'
import { SETTINGS, TOAST } from '../../lib/copy'
import { miaiWallUrl } from '../../lib/wallpaper/url'
import { derivePause } from '../../lib/wallpaper/pause'
import { ensureCatalog, findCatalogItem, wallpaperCatalog } from '../../lib/wallpaper/catalog'
import { resetManualPause, wallpaperPlayState } from '../../lib/wallpaper/play-state'
import { wallpaperReapply } from '../../lib/wallpaper/reapply'
import { wallpaperPreload } from '../../lib/wallpaper/preload'
import { wallpaperOverlayDim } from '../../lib/wallpaper/overlay-dim'
import { createParallax } from '../../lib/wallpaper/parallax'
import { destroyScene, fitForScene, mountScene, qualityPatchForScene, sceneVolumeFor } from '../../lib/wallpaper/engine'
import { createAudioCapture } from '../../lib/wallpaper/audio'
import { loadItemProps } from '../../lib/wallpaper/item-props'
import {
  SLOT_PENDING_CLASS,
  resetSwitchStyles,
  resolveTransition,
  startLayerTransition,
  transitionSpec
} from '../../lib/wallpaper/transitions'
import { BLUR_MAX, OPACITY_MAX, isRenderableItem, sceneMainReady } from '../../../../shared/wallpaper'
import { parseUserPropDefs } from '../../../../shared/wallpaper-props'
import { installRefraction, type RefractionHandle } from '../../lib/glass/refraction'
import { toast } from '../base/toast'
import type { SceneInstance } from 'webwallgl'
import type { WallpaperItem, WallpaperItemTune, WallpaperWindowState } from '../../../../shared/wallpaper'
import type { WallpaperPropValue } from '../../../../shared/wallpaper-props'

const settings = useSettingsStore()
const cfg = computed(() => settings.config.wallpaper)
const active = computed(() => cfg.value.enabled)

// ---------------------------------------------------------------- 选中项与清单

/** 清单是模块级共享的（设置页的选择器弹窗共用一份，见 lib/wallpaper/catalog） */
const catalogItems = wallpaperCatalog.items

/**
 * 选中条目 = 按 id 在共享清单里找；`selectedId` 为空 = 没选，只垫渐变底 ——
 * 决策点 7 拍板的默认形态，不是「坏掉了」。
 *
 * 【v15 起不再拿 config.source 当门槛】原来这里挡着 `w.source !== 'steam'`
 * （folder 源未实装时代的占位闸）。现在清单里混着导入的自定义条目
 * （条目级 source='custom'，见 main/wallpaper/custom.ts），它们按 id 找得到
 * 就该放行。config.source 字段本身保留不动，只是不再是一道只挡自己人的闸。
 */
const item = computed<WallpaperItem | null>(() => {
  const w = cfg.value
  if (!w.enabled || !w.selectedId) return null
  return findCatalogItem(w.selectedId)
})
const shownId = computed(() => item.value?.id ?? null)

// ---------------------------------------------------------------- 槽位与运行态

type MediaKind = 'none' | 'video' | 'img' | 'scene'
type ReadyResult = 'ready' | 'error' | 'timeout' | 'abort'

interface SlotRec {
  el: HTMLElement
  fit: HTMLElement | null
  media: HTMLVideoElement | HTMLImageElement | null
  kind: MediaKind
  itemId: string | null
  src: string | null
  /** 本次展示是「失败后的海报降级」（视频挂掉、或场景挂载失败；探针与日志用） */
  degraded: boolean
  /** 还在等就绪 / 过场未启动（不参与绘制，也不计入 mediaShown） */
  pending: boolean
  /** 就绪等待者的代令牌（retireSlot 用它中止在途等待） */
  gen: number
  /** scene 档的引擎实例（kind!=='scene' 时恒 null；retireSlot 负责 destroy） */
  inst: SceneInstance | null
  /** 场景真实挂载耗时（毫秒；探针要的读数，非 scene 为 null） */
  mountMs: number | null
  /** 本次挂载用的首帧预算（探针/诊断回显「为什么等这么久」） */
  budgetMs: number | null
  /** 引擎最后一条诊断（挂载失败后的排查线索；成功路径保持 null） */
  diag: string | null
}

const slotARef = ref<HTMLElement | null>(null)
const slotBRef = ref<HTMLElement | null>(null)
const recs: [SlotRec | null, SlotRec | null] = [null, null]
let activeSlot = 0
/** 「放不出来」已出声过的条目 id（挂载周期内去重；见 mountInto 尾部的吐司闸） */
const unrenderableNotified = new Set<string>()
/** 唯一有权发声的视频（见文件头「音频闸」） */
let audioGate: HTMLVideoElement | null = null
/**
 * 场景展示闸（audioGate 的孪生，见文件头「音频闸」）：指向「当前有权发声的
 * 场景 rec」，非场景展示层恒 null。**闸位只表达谁是当前展示层** —— trackOn 与
 * 音量值现读现算（sceneVolOf）；把开关/数值也写进闸的赋值点的话，用户拨回
 * 开关或拉回滑杆时没人再赋值，声音永远回不来（静默坏法）。
 */
let sceneGate: SlotRec | null = null
/** 引擎代令牌：retireAll/卸载 时自增，使一切在途 doShow 作废 */
let epoch = 0
let genSeq = 0
let switching = false
let pendingSwitch: { item: WallpaperItem; reason: string; force: boolean } | null = null
let settleRelease: (() => void) | null = null
let resumeTimer: number | null = null
/** 最近一次 stopped 变真的墙钟（短停速回的判据；0 = 从未停过） */
let stopBeganAt = 0
let rotationTimer: number | null = null
let rotationDue = false
let lastTransition: { id: string; dir: string; ms: number; reason: string; at: number } | null = null
/** 最近一次「重新应用」（属性面板顶部按钮）的结果：toast 之外的机器可读留痕 */
let lastReapply: { tick: number; at: number; pushed: number; remounted: boolean } | null = null

// ---- 场景预热状态（Bug1，2026-10-07 深夜；机制细节见「场景预热」节）----
// 单热身槽：这五个字段描述「非活动槽里那个隐身的预热实例」；转正时复位（实例
// 留下继续用），收尸时随 retireSlot 的自愈分支一起清。探针面 = snapshotStats.preload。
let preloadSlotIdx: number | null = null
let preloadItemId: string | null = null
let preloadState: 'idle' | 'mounting' | 'ready' = 'idle'
let preloadMs: number | null = null
let preloadPromise: Promise<boolean> | null = null

const READY_TIMEOUT_MS = 20000
/** 短停速回阈值：停止起因距今 < 此值 = 多半是竞态误停（见 stopped watch），恢复不再等去抖 */
const RECENT_STOP_MS = 1000
const waiters = new Map<number, (r: ReadyResult) => void>()

/** 真有媒体在屏上（决定 veil 档与 dim 遮罩；pending 不算） */
const mediaShown = ref(false)

function syncMediaShown(): void {
  mediaShown.value = recs.some((r) => !!r && r.kind !== 'none' && !r.pending)
}

function freshRec(el: HTMLElement): SlotRec {
  return {
    el,
    fit: null,
    media: null,
    kind: 'none',
    itemId: null,
    src: null,
    degraded: false,
    pending: false,
    gen: 0,
    inst: null,
    mountMs: null,
    budgetMs: null,
    diag: null
  }
}

/**
 * 模板 refs → 槽位记录。关→开时 Vue 会**重建**槽位元素，旧记录整体作废
 * （运行态一并复位——新挂载从零开始）。
 */
function ensureRecs(): boolean {
  const a = slotARef.value
  const b = slotBRef.value
  if (!a || !b) return false
  if (recs[0] && recs[0].el === a && recs[1] && recs[1].el === b) return true
  recs[0] = freshRec(a)
  recs[1] = freshRec(b)
  activeSlot = 0
  audioGate = null
  sceneGate = null
  return true
}

/** 等 Vue 把 v-if 的 DOM 补出来，再确保槽位记录就位（所有换片入口的前置） */
async function whenReady(): Promise<boolean> {
  await nextTick()
  return active.value && ensureRecs()
}

function activeItemId(): string | null {
  const rec = recs[activeSlot]
  return rec ? rec.itemId : null
}

function activeVideo(): HTMLVideoElement | null {
  const rec = recs[activeSlot]
  return rec && rec.media instanceof HTMLVideoElement ? rec.media : null
}

// ---------------------------------------------------------------- 暂停链

/**
 * 初始乐观值 focused=true：真窗口推送到达前先按「播放」起步（晚几毫秒被
 * 纠正，代价远小于反过来「开屏永远先停一下」）；`at: 0` 保证任何真状态都能赢。
 */
const winState = ref<WallpaperWindowState>({
  focused: true,
  minimized: false,
  visible: true,
  petFocused: false,
  at: 0,
  ev: 'init'
})
const pageHidden = ref(document.hidden)
const onBattery = ref(false)

/** 旧状态晚到不覆盖新状态（推送与 get 兜底走两条通道，可能交错） */
function applyState(s: WallpaperWindowState): void {
  if (s.at >= winState.value.at) winState.value = s
}

const paused = computed(() => derivePause(winState.value, cfg.value.power, pageHidden.value, onBattery.value))
/** 原生暂停 || 手动暂停（手动暂停是会话态，见 lib/wallpaper/play-state） */
const stopped = computed(() => paused.value.paused || wallpaperPlayState.manualPaused.value)

// ---------------------------------------------------------------- 视差引擎与指针

/** 频谱源（音频响应）。getGain 每 tick 现读 —— 滑杆拖动即时生效（原型同口径） */
const audioCapture = createAudioCapture({ getGain: () => cfg.value.audio.gain })

/**
 * 采集自愈机的事件订阅（audio.ts，2026-10-06 首载失效修复）。
 * 'live' = 挂上 / 被掐断后重挂成功 / 失败重试成功 —— **此刻必须把源重推给所有
 * 实例**：引擎侧 audioSim 闸门热修（build/webwallgl-hotfix.ts）之后，晚到的
 * setAudio 才能真正开闸（修之前挂载时 audio:null 的实例永久闭死）。
 * 之前报过「还没连上」的话，恢复时补一条成功 toast（失败不可能永远静默）。
 */
let audioTroubleToasted = false
const unsubAudioEvents = audioCapture.onChange((ev) => {
  if (ev.kind === 'live') {
    pushAudioSource()
    if (audioTroubleToasted) {
      audioTroubleToasted = false
      toast(SETTINGS.WALL_AUDIO_RECOVERED, 'success')
    }
    return
  }
  if (ev.kind === 'retrying' && !ev.fast && !audioTroubleToasted) {
    // 快速档耗尽转慢速（每分钟一次，直到成功或关闭）：此刻才值得打扰用户
    audioTroubleToasted = true
    toast(SETTINGS.WALL_AUDIO_RETRYING(ev.msg), 'warn')
  }
})

/** 把采集源（恒非 null；关掉时全 0）推给所有在跑实例 —— 绝不 setAudio(null) */
function pushAudioSource(): void {
  for (const rec of recs) {
    if (!rec || !rec.inst) continue
    try {
      rec.inst.setAudio(audioCapture.source)
    } catch (err) {
      console.warn('[wallpaper] scene setAudio failed:', err)
    }
  }
}

/**
 * 指针转发（场景实例的 pushPointer）。两个入口共用：
 *  ① 视差 onPointer（pointermove，见下）——与原型同位置、同门控：视差关/暂停
 *     挂起时不推，场景的指针移动特性随之关闭（原型口径，不是本次新增）。
 *  ② 单击/双击转发（pointerdown/up，见「单击/双击转发」节）——**不受视差开关
 *     门控**：双击动画是场景自带交互，不是视差特性。
 * 槽位整条链 pointer-events:none，引擎自己挂的 DOM 监听一个事件都收不到，
 * 这两条是全部通道。mods 位按引擎契约（dist 实读）：bit0 ctrl=1 / bit1 shift=2 /
 * bit2 alt=4 / bit3 meta=8 —— 原型写反了 shift/ctrl，以契约为准。
 * u/v 用 clientX/innerWidth、clientY/innerHeight：视觉坐标归一化，zoom 不影响。
 */
function pushPointerAll(clientX: number, clientY: number, buttons: number, mods: number): void {
  const u = clientX / Math.max(1, window.innerWidth)
  const v = clientY / Math.max(1, window.innerHeight)
  for (const rec of recs) {
    if (!rec || !rec.inst) continue
    try {
      rec.inst.pushPointer(u, v, buttons, mods)
    } catch {
      // 单帧推送失败无补救；下一帧照推
    }
  }
}

function pointerModsOf(e: PointerEvent): number {
  return (e.ctrlKey ? 1 : 0) | (e.shiftKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0)
}

function pushPointerToScenes(e: PointerEvent): void {
  pushPointerAll(e.clientX, e.clientY, e.buttons, pointerModsOf(e))
}

const parallax = createParallax({
  getSettings: () => ({
    enabled: cfg.value.parallax.enabled && active.value,
    amount: cfg.value.parallax.amount,
    smooth: cfg.value.parallax.smooth
  }),
  onPointer: pushPointerToScenes
})

/** 降级档的场景帧率上限：24 = 引擎遮挡分档的 heavyFps 缺省口径
 *  （引擎文档明说帧率下限 20——再低粒子/脚本/骨骼动画会肉眼失步，别下探） */
const DIM_SCENE_FPS = 24

/** 浮层降级是否生效：浮层开着**且**壁纸启用（壁纸关着时无所谓） */
const dimActive = computed(() => active.value && wallpaperOverlayDim.depth.value > 0)

/** suspended 驱动开关：恢复时 setSuspended(false) 内部会再 sync() 一次。
 *  stopped 与浮层降级取**并集** —— 直接写 stopped.value 的话，浮层开着时
 *  任一暂停链恢复都会把透视又打开（降级被吞，2026-10-08 修）。 */
function applyParallax(): void {
  parallax.setSuspended(stopped.value || dimActive.value)
}

/**
 * 浮层降级总闸（2026-10-08 体感卡顿修复）：弹窗/抽屉/搜索面板开合时把背景
 * 开销让给 UI —— 透视停推、频谱停采、场景降帧；恢复走同一函数（幂等，
 * 任一路变化都全量重算，并集口径见 applyParallax）。挂在 watch(dimActive) 上。
 */
function applyDim(): void {
  applyParallax()
  audioCapture.setActive(!stopped.value && !dimActive.value)
  for (const rec of recs) {
    if (rec) applySceneSettings(rec)
  }
}

/** 失焦/指针离窗 = 指针离开（引擎 onLeaveWindow 同款语义）：只清按键保留位置，
 *  场景不会「一直按着」 */
function pointerLeaveScenes(): void {
  for (const rec of recs) {
    if (!rec || !rec.inst) continue
    try {
      rec.inst.pointerLeave()
    } catch {
      // 同上
    }
  }
}

function onWinBlur(): void {
  pointerLeaveScenes()
}

// ------------------------------------------------------------ 单击/双击转发（Bug2）

/**
 * 2026-10-07 Bug2 修复：场景自带交互（双击动画、单击反应、场景内媒体按钮）全部
 * 依赖引擎指针管线产出 cursorDown/Up/Click 序列 —— 引擎没有 dblclick 原语，
 * 双击由场景脚本在 click 序列上自判（dist 43730-43768：down=按下沿、up=松开沿、
 * click=松开且仍悬停）。而引擎自己的 DOM 监听得不到任何事件（只挂 canvas，
 * 43505-43514；canvas 在 pointer-events:none 的槽位链里）⇒ 修复前只有
 * pointermove 在喂管线（视差），按钮状态永远没有沿 ⇒ 双击毫无反应。
 *
 * 修法 = 引擎官方为「窗口收不到鼠标事件」预留的外部注入通道（pushPointer，
 * types.d.ts 文档）：窗口级（document 捕获相、被动）监听 pointerdown/up，
 * 把按钮位掩码（bit0 左键）与位置推给全部实例。
 * **不碰任何 CSS 命中层** ⇒ UI 按钮/滚动/文本选择的命中行为零变化（零死区）；
 * 转发只读事件流（passive），不 preventDefault / stopPropagation / 不碰焦点；
 * document 捕获相先于任何内层 stopPropagation 看到事件（不改写，仅旁听）。
 * 门控：视差开关**不**门控本通道（双击是场景交互）；暂停（stopped）时不推。
 * 过滤：down 落点在具体交互控件上不转（点按钮/滑杆不该惊动壁纸；与桌面版壁纸
 * 引擎「图标拦截、空白透传」的语义一致）；**up 恒转** —— 守住「按在空白、
 * 松在控件上」的配对，引擎在无按下沿时对松开天然 no-op（applyButtons 早退）。
 * 指针移出窗口（无 blur 的悬空按下）→ pointerLeave 只清键，防「卡住的按下」。
 * 副作用面警戒：转发会让场景对普通点击产生反应（含场景可能的点击音效）——
 * 故只放行「非控件」落点，日常 UI 操作（全是控件）不会误触。
 */
const CLICK_FWD_BLOCK =
  'button, a, input, select, textarea, label, summary, pre, code, ' +
  '[role="button"], [role="tab"], [role="link"], [role="menuitem"], [contenteditable="true"], ' +
  '.splitpanes__splitter, .topbar, .sidebar, .right-panel, .side-section, .lesson-actions, ' +
  '.pick-item, .pick-btn, .lesson-item, .module-item, .stage-chip, .ref-item, ' +
  '.cm-editor, .mi-modal, .mi-tabs, .mi-select, .mi-switch, .mi-checkbox, ' +
  // 全屏菜单的**居中面板**（⑦）：面板上的操作不惊动壁纸；整张 .fs-mask 刻意
  // 不进本表 —— 遮罩空白处照旧转发，菜单开着时壁纸双击动画仍能触发（主人底线）
  '.fs-menu'

/** 探针面（只读快照进 __wallpaperStats.pointerFwd）：证明转发真发生过、被门控时看得见 */
const pointerFwd = { down: 0, up: 0, blocked: 0, leave: 0, lastButtons: 0, lastAt: 0 }

function onFwdPointerDown(e: PointerEvent): void {
  if (!active.value || stopped.value) return
  pointerFwd.lastButtons = e.buttons
  pointerFwd.lastAt = Date.now()
  const t = e.target
  if (t instanceof Element && t.closest(CLICK_FWD_BLOCK)) {
    pointerFwd.blocked += 1
    return
  }
  pointerFwd.down += 1
  pushPointerAll(e.clientX, e.clientY, e.buttons, pointerModsOf(e))
}

function onFwdPointerUp(e: PointerEvent): void {
  if (!active.value || stopped.value) return
  pointerFwd.up += 1
  pointerFwd.lastButtons = e.buttons
  pointerFwd.lastAt = Date.now()
  pushPointerAll(e.clientX, e.clientY, e.buttons, pointerModsOf(e))
}

/** 指针离开窗口（引擎同款挂法：document mouseleave；blur 由 onWinBlur 兜底） */
function onFwdDocLeave(): void {
  if (!active.value) return
  pointerFwd.leave += 1
  pointerLeaveScenes()
}

// ------------------------------------------------------------ 场景预热（Bug1）

/**
 * 2026-10-07 Bug1 修复 —— 场景壁纸切换顿挫的根因与修法（动这段代码前先读完）。
 *
 * 【根因（引擎源码实读，见 prep/engine-lifecycle.md）】切换本体是「新层先挂、
 * 旧层保持、就绪起过场」的就绪门流水线，**代码里没有「切黑帧」路径**；顿挫 =
 * 挂载期的一段同步主线程重活（mountWallpaper 一次调用里的 parsePkg/parseScene/
 * GL 上下文/纹理 texImage2D 上传/首帧 shader 编译）把新旧两层的 rAF 一起冻住。
 * 视频壁纸便宜（原生 <video> 换 src）所以从不顿挫 —— 差异全在这块同步重活。
 *
 * 【修法】同步块没法原地消灭（引擎内部实现），能动的只有两件事：
 *   ① 何时付钱：从不想要的时刻（点选那一瞬）挪到可接受时刻（悬停浏览时，
 *      用户浏览几十上百张列表本来就要花几秒）；
 *   ② 付钱时谁扛画面：旧层始终保留 —— 既有 --pending 就绪门原样不动。
 * 机制：弹窗悬停场景条目（停留过 dwell 由弹窗侧把关）→ preload.ts 意图总线
 * → preloadScene 把该场景提前挂进**非活动槽** → 点选命中（doShow 的 adopted
 * 分支）跳过「退休 + 挂载」直接起既有过场（cross-fade 是原有机制，无新动画）。
 *
 * 【三条纪律】
 *  · 单热身槽：任何时刻至多「活动 1 + 热身 1」两个引擎实例 = 与既有 cross-fade
 *    期并存口径持平（转正/收尸即刻 destroyScene 释放 WebGL 上下文，不攒实例）；
 *    换别条 / 关弹窗 / 点选视频（doShow 未命中分支）即 drop 收尸。
 *  · 不打扰：switching/stopped/壁纸关/条目就是当前活动项时不热身；热身实例恒
 *    静音落座（未上闸，见 preloadInto）、首帧后当场 pause（不占渲染开销、不进
 *    音频闸）—— 悬停浏览不会让壁纸多跑一份 60fps。
 *  · 可放弃：热身进行中收到新意图或 drop ⇒ retireSlot 的代令牌让在途挂载就地
 *    自收（abort 分支绝不 retireSlot —— 槽位可能已被更晚的挂载接手，退役会误杀
 *    新层），不泄漏上下文。
 * 已知副作用面：热身实例挂载会覆盖引擎的粒子全局钩子（REFRACT 粒子按「后挂载
 * 者生效」，见 prep/webwallgl-internals.md §3.3）——该窗口在每次 cross-fade
 * 期间本就存在，本机制把它延长到「悬停时长」；影响面仅限用 REFRACT 粒子的场景。
 */
function dropPreload(): void {
  if (preloadSlotIdx !== null) retireSlot(preloadSlotIdx) // 自愈分支顺带清字段
  preloadSlotIdx = null
  preloadItemId = null
  preloadState = 'idle'
  preloadMs = null
  preloadPromise = null
}

/** 预热入口（意图 watch / show 收尾补跑共用）。不满足条件就返回 false；同一条目已在热身时幂等。 */
function preloadScene(it: WallpaperItem): Promise<boolean> {
  if (!active.value || stopped.value || switching) return Promise.resolve(false)
  if (it.type !== 'scene' || !sceneMainReady(it)) return Promise.resolve(false)
  if (activeItemId() === it.id) return Promise.resolve(false)
  if (preloadItemId === it.id && preloadState !== 'idle') return preloadPromise ?? Promise.resolve(false)
  dropPreload() // 替换策略：单热身槽
  const idx = 1 - activeSlot
  if (!recs[idx]) return Promise.resolve(false)
  retireSlot(idx) // 兜底：目标槽此刻应为空（既有流水线不变量），空也是幂等
  const p = preloadInto(idx, it, epoch)
  preloadPromise = p
  return p
}

/**
 * 把条目提前挂进槽位（attemptScene 的「热身版」：同参镜像，差别只在——
 * 不降级海报：热身失败只静默收场，点选时走正常挂载，那时才谈降级）。
 */
async function preloadInto(idx: number, it: WallpaperItem, myEpoch: number): Promise<boolean> {
  const rec = recs[idx]
  const plan = planMedia(it)
  if (!rec || !plan || plan.kind !== 'scene') return false
  preloadSlotIdx = idx
  preloadItemId = it.id
  preloadState = 'mounting'
  preloadMs = null
  rec.pending = true
  rec.el.classList.add(SLOT_PENDING_CLASS)
  const gen = ++genSeq
  rec.gen = gen
  const fit = document.createElement('div')
  fit.className = 'wp-fit'
  rec.el.appendChild(fit)
  let lastDiag: string | null = null
  try {
    const handle = await mountScene({
      el: fit,
      dir: plan.dir,
      fit: fitForScene(cfg.value.objectFit),
      fps: dimActive.value ? DIM_SCENE_FPS : cfg.value.sceneFps,
      quality: cfg.value.quality,
      sizeBytes: it.mainSizeBytes,
      // 与 attemptScene 逐字同参（热身 rec 未上场景闸 ⇒ sceneVolOf 实值也是 0）
      initialVolume: sceneVolOf(rec),
      // 未启用 = 显式 null（引擎语义：null 是零频谱；不传键是内置模拟源自嗨）
      audio: cfg.value.audio.enabled ? audioCapture.source : null,
      onDiagnostic: (msg) => {
        lastDiag = msg
      }
    })
    if (myEpoch !== epoch || gen !== rec.gen) {
      // 挂载期间被清场/替换：实例已诞生，就地收尸（同 attemptScene 的 abort
      // 分支；这里绝不 retireSlot —— 槽位可能已被更晚的挂载接手，退役会误杀新层）
      destroyScene(handle.inst)
      try {
        fit.remove()
      } catch {
        /* 忽略 */
      }
      return false
    }
    rec.diag = lastDiag
    rec.fit = fit
    rec.media = null
    rec.kind = 'scene'
    rec.itemId = it.id
    rec.src = plan.dir
    rec.degraded = false
    rec.inst = handle.inst
    rec.mountMs = handle.mountMs
    rec.budgetMs = handle.budgetMs
    // mount resolve = 首帧已真画出（引擎就绪信号的唯一权威）⇒ 当场暂停：热身的层
    // 不占渲染开销；像素留在画布（preserveDrawingBuffer 恒开），转正 resume 即刻接上
    rec.inst.pause()
    applyFit(rec)
    void pushSceneProps(rec)
    preloadState = 'ready'
    preloadMs = handle.mountMs
    return true
  } catch (err) {
    const diag = lastDiag ?? String(err instanceof Error ? err.message : err)
    try {
      fit.remove()
    } catch {
      /* 忽略 */
    }
    if (myEpoch === epoch && gen === rec.gen) {
      rec.diag = diag
      console.warn('[wallpaper] scene preload failed:', diag)
      retireSlot(idx) // 收干净（含热身状态自愈）；点选时走正常挂载 + 海报降级
    }
    return false
  }
}

/** 换片收尾的补跑：switching 期间被门挡下的悬停意图在这里兑现（幂等） */
function maybePreloadFromIntent(): void {
  const v = wallpaperPreload.intent.value
  if (v) void preloadScene(v.item)
}

// ---------------------------------------------------------------- 媒体就绪等待

/**
 * 等到「有画面可看」：video 等 loadeddata（或 readyState>=2）、img 等 load。
 * 20s 超时先复核一次再判 timeout —— 大视频在慢盘上晚到不等于坏掉。
 * 等待者按代登记在 waiters 里，retireSlot 能凭代令牌立刻中止它（否则被退役的
 * 元素会一直占着一个在途 Promise，直到超时）。
 */
function waitReady(el: HTMLVideoElement | HTMLImageElement, kind: 'video' | 'img', gen: number): Promise<ReadyResult> {
  return new Promise((resolve) => {
    let done = false
    let timer: number | null = null
    const finish = (r: ReadyResult): void => {
      if (done) return
      done = true
      if (timer !== null) window.clearTimeout(timer)
      if (waiters.get(gen) === finish) waiters.delete(gen)
      resolve(r)
    }
    const readyNow = (): boolean =>
      kind === 'video'
        ? (el as HTMLVideoElement).readyState >= 2
        : (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0
    waiters.set(gen, finish)
    if (readyNow()) {
      finish('ready')
      return
    }
    el.addEventListener(kind === 'video' ? 'loadeddata' : 'load', () => finish('ready'), { once: true })
    el.addEventListener('error', () => finish('error'), { once: true })
    timer = window.setTimeout(() => finish(readyNow() ? 'ready' : 'timeout'), READY_TIMEOUT_MS)
  })
}

// ---------------------------------------------------------------- 视觉样式（.wp-fit）

type MediaPlan =
  | {
      kind: 'video'
      url: string
      /** 视频失败时的降级海报（非视频条目没有第二次机会） */
      fallbackUrl: string | null
    }
  | { kind: 'img'; url: string; fallbackUrl: null }
  | {
      /** scene 且主文件（.pkg）真实可读 → 场景引擎；失败由挂载层降级海报 */
      kind: 'scene'
      /** 条目目录（引擎按名取资源，全走 miai-wall://） */
      dir: string
      fallbackUrl: string | null
    }

/** 'center' 在 CSS 里的对应物是 object-fit:none + 居中（原尺寸） */
const FIT_CSS: Record<string, { fit: string; pos: string }> = {
  cover: { fit: 'cover', pos: 'center' },
  contain: { fit: 'contain', pos: 'center' },
  center: { fit: 'none', pos: 'center' },
  fill: { fit: 'fill', pos: 'center' }
}

function planMedia(it: WallpaperItem): MediaPlan | null {
  if (!isRenderableItem(it)) return null
  if (it.type === 'video') {
    return { kind: 'video', url: miaiWallUrl(it.mainFileAbs), fallbackUrl: it.previewAbs ? miaiWallUrl(it.previewAbs) : null }
  }
  // scene 且主文件真实可读 → 场景引擎（有没有海报都走这条路：引擎才是本体）
  if (it.type === 'scene' && sceneMainReady(it)) {
    return { kind: 'scene', dir: it.dir, fallbackUrl: it.previewAbs ? miaiWallUrl(it.previewAbs) : null }
  }
  // web/application/主文件缺失的 scene：降级为海报图（引擎形态不在本步，且
  // sceneMainReady 已排除"文件都读不到的伪场景"）；
  // 上面 isRenderableItem 已保证非 video 走到这必有 previewAbs
  const poster = it.previewAbs
  if (poster === null) return null
  return { kind: 'img', url: miaiWallUrl(poster), fallbackUrl: null }
}

function applyMediaElStyle(el: HTMLVideoElement | HTMLImageElement): void {
  const m = FIT_CSS[cfg.value.objectFit] ?? FIT_CSS.cover
  el.style.objectFit = m.fit
  el.style.objectPosition = m.pos
}

/** 当前这张的「本张微调」（没选 / 没调过 = undefined，一切走全局值） */
function tuneOf(rec: SlotRec): WallpaperItemTune | undefined {
  return rec.itemId ? cfg.value.itemTuning[rec.itemId] : undefined
}

/**
 * 持久视觉样式写在 .wp-fit 上（过滤器/透明度/翻转/模糊补偿）。
 * 翻转与模糊补偿都走 CSS **独立属性 scale**（不用 transform）—— 过场的内联
 * transform 写在槽位层，两者层级不同、属性不同，互不覆盖。
 *
 * 有效值 = 全局与本张微调（WallpaperItemTune 的语义三态）合成：覆盖类
 * （flipH/flipV）本张优先；乘法类乘在全局之上；blur 相加（总和按 BLUR_MAX 钳）。
 * **挂载落座（attempt）与配置变化（watch）都从这里走** —— 只在 watch 里写样式
 * 的话，换片后的新层在下次配置变化前是「裸」的（boot 时 watch 都没触发过）。
 */
function applyFit(rec: SlotRec): void {
  const fit = rec.fit
  if (!fit) return
  const w = cfg.value
  const t = tuneOf(rec)
  const brightness = w.brightness * (t?.brightness ?? 1)
  const contrast = w.contrast * (t?.contrast ?? 1)
  const saturate = w.saturate * (t?.saturate ?? 1)
  const blur = Math.min(BLUR_MAX, w.blur + (t?.blur ?? 0))
  const parts: string[] = []
  if (brightness !== 1) parts.push(`brightness(${brightness})`)
  if (contrast !== 1) parts.push(`contrast(${contrast})`)
  if (saturate !== 1) parts.push(`saturate(${saturate})`)
  if (blur > 0) parts.push(`blur(${blur}px)`)
  fit.style.filter = parts.length > 0 ? parts.join(' ') : ''
  fit.style.opacity = String((w.opacity / 100) * ((t?.opacity ?? OPACITY_MAX) / 100))
  // 模糊的边缘补偿（docs/23 §3.4.2）+ 本张缩放（乘进同一个 comp，见 v13 语义表）
  const comp = (1 + blur * 0.006) * (t?.zoom ?? 1)
  const h = t?.flipH ?? w.flip
  const v = t?.flipV === true
  fit.style.setProperty('scale', `${h ? -comp : comp} ${v ? -comp : comp}`)
}

function applyAllFits(): void {
  for (const rec of recs) {
    if (!rec) continue
    applyFit(rec)
    if (rec.media) applyMediaElStyle(rec.media)
  }
}

const dimStyle = computed(() => `rgba(0, 0, 0, ${cfg.value.dim / 100})`)

// ---------------------------------------------------------------- 视频播放

function tryPlay(v: HTMLVideoElement): void {
  const p = v.play()
  if (p && typeof p.catch === 'function') {
    p.catch((err: unknown) => {
      // 自动播放被拒（音量 > 0 且用户还没交互过才会发生）：不假装在播，
      // 挂一次性交互监听 —— 用户第一次点/敲就补播
      console.warn('[wallpaper] play() rejected:', err)
      window.addEventListener('pointerdown', retryOnGesture, { once: true, capture: true })
      window.addEventListener('keydown', retryOnGesture, { once: true, capture: true })
    })
  }
}

function retryOnGesture(): void {
  if (!stopped.value) syncPaused()
}

/**
 * 视频状态总闸：音量/静音（音频闸）/倍速/播停。**pending 的层不在这里暂停** ——
 * 挂载期的静音 play() 是为了让解码启动（就绪门在等 loadeddata），它是屏上看
 * 不见的（槽位还挂着 --pending），且受装载时长天然限时。
 */
function syncVideos(): void {
  const vol = Math.min(1, Math.max(0, cfg.value.volume / 100))
  const baseRate = cfg.value.playbackRate
  const isStopped = stopped.value
  for (const rec of recs) {
    if (!rec || !(rec.media instanceof HTMLVideoElement)) continue
    const v = rec.media
    v.volume = vol
    // 音频闸：只有 audioGate（当前展示层）且 trackOn 且音量>0 才允许发声
    v.muted = !(v === audioGate && cfg.value.trackOn && vol > 0)
    // 「本张微调」的单独倍速优先（undefined = 跟随全局；现读，面板改动一轮即达）
    v.playbackRate = (rec.itemId ? cfg.value.itemTuning[rec.itemId]?.playbackRate : undefined) ?? baseRate
    if (isStopped && !rec.pending) {
      if (!v.paused) v.pause()
    } else if (!isStopped && v.paused) {
      tryPlay(v)
    }
  }
}

// ---------------------------------------------------------------- 场景实例（engine.ts 接线）

/**
 * 场景实例状态总闸（syncVideos 的场景版）：stopped 立即生效，恢复走同一套
 * 300ms 去抖（在 stopped watch 里）。**pending 的层不在这里动** —— 挂载中的
 * 实例由 attemptScene 在落座当场对齐暂停态（挂载即对齐，见文件头）。
 */
function syncScenes(): void {
  const isStopped = stopped.value
  for (const rec of recs) {
    if (!rec || !rec.inst) continue
    try {
      if (isStopped && !rec.pending) {
        if (!rec.inst.paused) rec.inst.pause()
      } else if (!isStopped && rec.inst.paused) {
        rec.inst.resume()
      }
    } catch (err) {
      console.warn('[wallpaper] scene pause/resume failed:', err)
    }
  }
}

/**
 * 场景 rec 的有效音量（0~1）：闸位（当前展示层）&& trackOn 才是 cfg.volume/100，
 * 其余一律 0。与视频侧 audioGate 的判据同构（syncVideos 里 `v === audioGate &&
 * trackOn && vol > 0`）；纯映射在 engine.ts 的 sceneVolumeFor（单测钉双读）。
 */
function sceneVolOf(rec: SlotRec): number {
  return sceneVolumeFor(rec === sceneGate, cfg.value.trackOn, cfg.value.volume)
}

/**
 * 场景音量总闸：把「按闸算出的音量」写给每个在跑实例（引擎唯一法定入口
 * inst.setVolume）。挂载期一律 muted 起步（engine 的 volume:0），**出声只靠
 * 两处写**：闸移交（handoffSceneAudio）与配置热更（applySceneSettings）。
 */
function syncSceneAudio(): void {
  for (const rec of recs) {
    if (!rec || !rec.inst) continue
    try {
      rec.inst.setVolume(sceneVolOf(rec))
    } catch (err) {
      console.warn('[wallpaper] scene setVolume failed:', err)
    }
  }
}

/**
 * 音频闸移交（doShow 的两个 audioGate 赋值点，R7 单声源）：场景闸指向新展示层
 * （是场景才是闸），随即整体重算场景音量 —— 旧场景立刻收 0（它还要活到
 * onRetire，不掐就会和过场后半段的新声源叠成双声源），新场景立刻出声（挂载期
 * 一直是 muted，移交是它最初的出声时刻）。
 * 新层是场景时视频侧也当场重算：场景从移交那刻起就出声，旧视频若按既有口径拖
 * 到过场结束才收声（syncPaused 才刷 muted），这一整段过场就是双声源；此刻所有
 * 视频都不在闸上（新层是场景 ⇒ doShow 的 newVideo 恒 null），这一次 syncVideos
 * 等效于「全部哑」。新层是视频/图时不动视频侧：它的收声/出声仍在过场结束的
 * syncPaused（音画同步的既有口径，不在这里改）。
 */
function handoffSceneAudio(newRec: SlotRec): void {
  sceneGate = newRec.kind === 'scene' ? newRec : null
  syncSceneAudio()
  if (sceneGate !== null) syncVideos()
}

/** 暂停链总闸 = 视频 + 场景（doShow 尾、stopped watch、retryOnGesture 共用） */
function syncPaused(): void {
  syncVideos()
  syncScenes()
}

/** 画面适配/场景帧率/画质/音量 → 运行中的场景实例（热更，不重挂） */
function applySceneSettings(rec: SlotRec): void {
  if (!rec.inst) return
  try {
    rec.inst.setFit(fitForScene(cfg.value.objectFit))
    // 帧率按「当前该不该降级」取值：浮层降级档 24fps（DIM_SCENE_FPS），
    // 否则用户设置档 —— 挂载参数同口径，两处缺一挂载后会漏掉降级
    rec.inst.setFps(dimActive.value ? DIM_SCENE_FPS : cfg.value.sceneFps)
    rec.inst.setQuality(qualityPatchForScene(cfg.value.quality))
    // 音量走同一纪律（sceneVolOf：闸位 && trackOn 才是音量值，否则 0）。
    // 注意「音乐大小」是属性面板的另一路写口（元素音量层，引擎 L51462-51465），
    // 与本条的主增益各管一层 —— 两个旋钮都不去改对方，不去动那条路径。
    rec.inst.setVolume(sceneVolOf(rec))
  } catch (err) {
    console.warn('[wallpaper] scene apply settings failed:', err)
  }
}

/**
 * 把「壁纸自带属性」的全量生效 map 推给场景实例。**发全量（默认 + 覆盖）
 * 而不是只发覆盖**：属性面板的「恢复默认」是删覆盖键，只发覆盖的话运行中
 * 的场景不会跟着回默认（静默失效，见文件头④）。
 * 原文读不到时（读文件真失败）只能把覆盖值原样发 —— 「恢复默认」在这条路上
 * 回不去，是如实降级不是伪装成功。
 * 异步收口：await 期间实例可能被退役/换片，推之前复核 rec 身份。
 */
async function pushSceneProps(rec: SlotRec): Promise<void> {
  const id = rec.itemId
  const inst = rec.inst
  if (!id || !inst) return
  const res = await loadItemProps(id)
  if (rec.inst !== inst || rec.itemId !== id) return
  const overrides = cfg.value.itemProps[id] ?? {}
  const out: Record<string, WallpaperPropValue> = {}
  if (res.project) {
    for (const e of parseUserPropDefs(res.project, overrides)) {
      if (e.value !== null) out[e.name] = e.value
    }
  } else {
    for (const [k, v] of Object.entries(overrides)) out[k] = v
  }
  if (!Object.keys(out).length) return
  try {
    inst.setProperties(out)
  } catch (err) {
    console.warn('[wallpaper] scene setProperties failed:', err)
  }
}

// ---------------------------------------------------------------- 槽位生命周期

/**
 * 退役一个槽位（P1 原型的 retire 逐字移植 + 本项目特有收尾）：
 * 暂停视频、断下载、释放音频闸、清 DOM、类名归位、**z-index 压到 1**
 * （黑屏根因修法）。幂等，可重复调用。
 */
function retireSlot(idx: number): void {
  const rec = recs[idx]
  if (!rec) return
  if (idx === preloadSlotIdx) {
    // 热身槽被退役（drop / 换条 / 清场都走这条出口）：热身状态一并作废。
    // 自愈口必须在这里而不是只在 dropPreload —— retireSlot 的调用方遍布全文件，
    // 漏掉任何一条都会留下悬空字段（点选时误判「热身就绪」转正一个空槽）
    preloadSlotIdx = null
    preloadItemId = null
    preloadState = 'idle'
    preloadMs = null
    preloadPromise = null
  }
  const w = waiters.get(rec.gen)
  if (w) {
    waiters.delete(rec.gen)
    w('abort')
  }
  rec.gen = 0
  if (rec.media instanceof HTMLVideoElement) {
    const v = rec.media
    try {
      v.pause()
      v.removeAttribute('src')
      v.load() // 打断在途下载（挂了一半的大视频不会继续占带宽）
    } catch {
      /* 已游离：无妨 */
    }
    if (audioGate === v) audioGate = null
  } else if (rec.media instanceof HTMLImageElement) {
    try {
      rec.media.removeAttribute('src')
    } catch {
      /* 忽略 */
    }
  }
  // 场景实例：destroy 收掉 WebGL 上下文与 rAF 循环（releasePkgCache ——
  // 桌面壁纸逐张切换的语义是"销毁即放弃"，见 engine.ts 头注释）
  // 场景闸若压在这个 rec 上：先摘闸再收尸（实例马上销毁，不用 setVolume(0)；
  // 不摘的话悬空引用会让下一次场景音量重算对着已退役 rec 跑）
  if (sceneGate === rec) sceneGate = null
  if (rec.inst) {
    destroyScene(rec.inst)
    rec.inst = null
  }
  rec.fit = null
  rec.media = null
  rec.kind = 'none'
  rec.itemId = null
  rec.src = null
  rec.degraded = false
  rec.pending = false
  rec.mountMs = null
  rec.budgetMs = null
  rec.diag = null
  try {
    rec.el.innerHTML = ''
    rec.el.style.zIndex = '1'
  } catch {
    /* 忽略 */
  }
  resetSwitchStyles(rec.el)
  syncMediaShown()
}

/** 全收摊：作废一切在途换片、放掉在途 settle、双槽退役 */
function retireAll(): void {
  epoch++
  const release = settleRelease
  settleRelease = null
  if (release) release()
  pendingSwitch = null
  retireSlot(0)
  retireSlot(1)
  activeSlot = 0
}

// ---------------------------------------------------------------- 换片流水线

/**
 * 把条目挂进指定槽位并等到就绪。返回 true = 已落座（槽位仍挂 --pending，
 * 由调用方决定走硬切还是过场）。
 */
async function mountInto(idx: number, it: WallpaperItem, myEpoch: number): Promise<boolean> {
  const rec = recs[idx]
  const plan = planMedia(it)
  if (!rec || !plan) return false

  const attempt = async (kind: 'video' | 'img', url: string): Promise<ReadyResult> => {
    const gen = ++genSeq
    rec.gen = gen
    let el: HTMLVideoElement | HTMLImageElement
    if (kind === 'video') {
      const v = document.createElement('video')
      v.className = 'wp-media-el'
      v.loop = true
      v.muted = true
      v.playsInline = true
      v.preload = 'auto'
      v.setAttribute('playsinline', '')
      el = v
    } else {
      const img = document.createElement('img')
      img.className = 'wp-media-el'
      img.alt = ''
      el = img
    }
    applyMediaElStyle(el)
    const fit = document.createElement('div')
    fit.className = 'wp-fit'
    fit.appendChild(el)
    el.src = url
    rec.el.appendChild(fit)
    // 静音 play() 让解码启动（就绪门在等 loadeddata；屏上不可见，见 syncVideos 注释）
    if (kind === 'video') tryPlay(el as HTMLVideoElement)
    const res = await waitReady(el, kind, gen)
    // 等待期间被清场（retireSlot 会把 gen 归零；retireAll 会推 epoch）
    if (myEpoch !== epoch || gen !== rec.gen) {
      try {
        fit.remove()
      } catch {
        /* 忽略 */
      }
      return 'abort'
    }
    if (res !== 'ready') {
      try {
        fit.remove()
      } catch {
        /* 忽略 */
      }
      return res
    }
    rec.fit = fit
    rec.media = el
    rec.kind = kind
    rec.itemId = it.id
    rec.src = url
    rec.degraded = kind === 'img' && plan.kind !== 'img' // 视频/场景失败后的海报降级
    // 落座即写持久样式（挂载缺口的修法：配置 watch 在挂载完成前已跑完/未触发，
    // 不补这一刀，新层会一直裸着 —— 换片后丢 blur/brightness、boot 时从没有过）
    applyFit(rec)
    return 'ready'
  }

  /**
   * 场景挂载（engine.ts 的 mountScene）。与 attempt 同构：代令牌防退役竞态，
   * 过期即对**已诞生的实例**就地收尸（destroyScene —— 引擎的半成品/迟到实例
   * 由 engine.ts 收，这一层只管"落座前被清场"的成实例）。挂载期间只记一条
   * 最后诊断，失败后连同降级决定一起进 rec.diag / console（排查线）。
   */
  const attemptScene = async (dir: string): Promise<ReadyResult> => {
    const gen = ++genSeq
    rec.gen = gen
    const fit = document.createElement('div')
    fit.className = 'wp-fit'
    rec.el.appendChild(fit)
    let lastDiag: string | null = null
    try {
      const handle = await mountScene({
        el: fit,
        dir,
        fit: fitForScene(cfg.value.objectFit),
        fps: dimActive.value ? DIM_SCENE_FPS : cfg.value.sceneFps,
        quality: cfg.value.quality,
        sizeBytes: it.mainSizeBytes,
        // 落座音量走 initialVolume 通道（mountOpts.volume 只是静音布尔，不是
        // 旋钮 —— 传 0.8 会得到满音量，见 engine.ts）。挂载期闸尚未移交（本
        // rec 还没上闸）⇒ 这里实值为 0 = 静音落座：既不 blip，也把 userVolume
        // 钉死防引擎按 muted 回退；真正的出声在 doShow 的闸移交点。
        initialVolume: sceneVolOf(rec),
        // 未启用 = 显式 null（引擎语义：null 是零频谱；不传键是内置模拟源自嗨）
        audio: cfg.value.audio.enabled ? audioCapture.source : null,
        onDiagnostic: (msg) => {
          lastDiag = msg
        }
      })
      if (myEpoch !== epoch || gen !== rec.gen) {
        // 挂载期间被清场：实例已诞生，就地收尸（含 WebGL 上下文与 rAF）
        destroyScene(handle.inst)
        try {
          fit.remove()
        } catch {
          /* 忽略 */
        }
        return 'abort'
      }
      rec.diag = lastDiag
      rec.fit = fit
      rec.media = null
      rec.kind = 'scene'
      rec.itemId = it.id
      rec.src = dir
      rec.degraded = false
      rec.inst = handle.inst
      rec.mountMs = handle.mountMs
      rec.budgetMs = handle.budgetMs
      // 挂载即对齐暂停态：stopped 的变化可能发生在挂载期间，watch 不会补发
      if (stopped.value) rec.inst.pause()
      applyFit(rec)
      // 壁纸自带属性（全量「默认+覆盖」；异步，缓存命中时毫秒级）——不 await：
      // 渲染层不该等在属性上（见 pushSceneProps 的异步收口）
      void pushSceneProps(rec)
      return 'ready'
    } catch (err) {
      rec.diag = lastDiag ?? String(err instanceof Error ? err.message : err)
      console.warn('[wallpaper] scene mount failed:', rec.diag)
      try {
        fit.remove()
      } catch {
        /* 忽略 */
      }
      return 'error'
    }
  }

  rec.pending = true
  rec.el.classList.add(SLOT_PENDING_CLASS)

  let res =
    plan.kind === 'scene' ? await attemptScene(plan.dir) : await attempt(plan.kind, plan.url)
  if (res === 'ready') return true
  if (res === 'abort') return false
  // 场景/视频失败且有海报 → 降级重试（img 失败没有第二次机会）
  if (plan.kind !== 'img' && plan.fallbackUrl) {
    console.warn('[wallpaper] media load failed, falling back to poster:', plan.kind)
    res = await attempt('img', plan.fallbackUrl)
    if (res === 'ready') return true
    if (res === 'abort') return false
  }
  console.warn('[wallpaper] item unrenderable, keeping current layer:', it.id, res)
  /*
   * 【2026-10-17 夜间批】这里原来只有 console.warn —— 用户选中一个坏文件
   * （下载中断的 mp4、改名装 png 的文本）后屏上什么都不变、也没人告诉他
   * 为什么，看起来就是"选壁纸坏了"（夜检活窗实测：0 吐司、0 变化）。
   * 播放/解码失败是**值**不是异常，与「失败即值」同一条纪律：失败即出声。
   * 每个条目**每个挂载周期只出一次**：轮播池里混进坏条目时每次轮到它都会
   * 失败，不设闸会变成每隔几十秒一条吐司的复读机。挂载周期（而不是永久）
   * 是给"用户去修了文件再回来"留的第二次机会。
   */
  if (!unrenderableNotified.has(it.id)) {
    unrenderableNotified.add(it.id)
    toast(TOAST.WALL_UNRENDERABLE, 'error')
  }
  retireSlot(idx)
  return false
}

/** 等一次过场的旧层退役落地（onRetire），ms+600 兜底；retireAll 可即时解结 */
function beginSettleWait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    let timer: number | null = null
    const finish = (): void => {
      if (done) return
      done = true
      if (timer !== null) window.clearTimeout(timer)
      if (settleRelease === finish) settleRelease = null
      resolve()
    }
    settleRelease = finish
    timer = window.setTimeout(finish, ms + 600)
  })
}

async function doShow(it: WallpaperItem, reason: string): Promise<void> {
  const myEpoch = epoch
  const idx = 1 - activeSlot
  const oldIdx = activeSlot
  const rec = recs[idx]
  const oldRec = recs[oldIdx]
  if (!rec || !oldRec) return

  const plan = planMedia(it)
  if (!plan) {
    console.warn('[wallpaper] nothing renderable for item, keeping current layer:', it.id)
    return
  }

  const tr = transitionSpec(resolveTransition(cfg.value.transition), cfg.value.transitionSpeed, cfg.value.transitionDir)

  // Bug1（2026-10-07 深夜，见「场景预热」节）：热身槽命中 = 跳过「退休 + 挂载」。
  // 预热还在挂载中就把剩下的等完 —— pkg 拉取/解析那一截已经付过，比从头挂快。
  if (preloadSlotIdx === idx && preloadItemId === it.id && preloadState === 'mounting' && preloadPromise) {
    await preloadPromise
    if (myEpoch !== epoch) return
  }
  const adopted =
    preloadSlotIdx === idx &&
    preloadItemId === it.id &&
    preloadState === 'ready' &&
    rec.kind === 'scene' &&
    rec.inst !== null &&
    rec.pending
  if (adopted) {
    // 交接：从此刻起它是本次展示的主角，不再是「热身」（字段复位，实例留下）
    preloadSlotIdx = null
    preloadItemId = null
    preloadState = 'idle'
    preloadMs = null
    preloadPromise = null
  } else if (preloadSlotIdx !== null || preloadItemId !== null) {
    dropPreload() // 点的是别的条目：热身实例立刻收掉（单热身槽纪律）
  }
  if (!adopted) {
    retireSlot(idx) // 目标槽此刻应是空置的；兜底清一次（幂等）
    if (myEpoch !== epoch) return
    const ok = await mountInto(idx, it, myEpoch)
    if (!ok || myEpoch !== epoch) return
  }
  const rec2 = recs[idx]
  const oldRec2 = recs[oldIdx]
  if (!rec2 || !oldRec2 || rec2 !== rec) return

  // 换壁纸自动解除手动暂停（play-state 的口径：暂停只作用在它被按下的那一张上）
  resetManualPause()

  const newVideo = rec2.media instanceof HTMLVideoElement ? rec2.media : null
  if (tr.id === 'cut' || oldRec2.kind === 'none') {
    // 硬切 / 没有旧层可过场：立即拆旧、新层直接落座
    retireSlot(oldIdx)
    rec2.pending = false
    rec2.el.classList.remove(SLOT_PENDING_CLASS)
    resetSwitchStyles(rec2.el)
    rec2.el.style.zIndex = '' // 收回退役槽那套 inline 1，回到 CSS 默认（高于退役槽）
    // 转正的热身实例在热身期是 pause 过的：上场前 resume（硬切没有过场时间可摊）。
    // 只碰 adopted —— 正常挂载的实例一直在跑，对运行中的实例再 resume 会重复 kickLoop
    if (adopted && rec2.inst && !stopped.value) {
      try {
        rec2.inst.resume()
      } catch {
        /* resume 失败无补救：下一次 syncPaused 还会兜一刀 */
      }
    }
    activeSlot = idx
    audioGate = newVideo
    handoffSceneAudio(rec2) // 场景闸同刻移交（R7，见函数头）
  } else {
    rec2.pending = false // 状态先行；--pending 类由 startLayerTransition 摘
    audioGate = newVideo // 过场一开始音频就归新层（单声源）
    handoffSceneAudio(rec2) // 场景闸同刻移交（R7，见函数头）
    // （2026-10-08 深夜撤除）上批在此给退场层 setFps(DIM_SCENE_FPS) 降帧省开销，
    // 但主人的验收点正是「旧场景退出那一瞬间」：淡出期旧层必须是满帧的活画面，
    // 且让帧补丁已把挂载期同步冻结消灭，双跑 0.8s 的 GPU 代价不再值得用观感换。
    // 谁将来想恢复，先在探针里看退场相位的 gap 时间线再决定。
    // 转正的热身实例在热身期是 pause 过的：过场开始前 resume，淡入的才是活画面。
    // 只碰 adopted —— 正常挂载的实例一直在跑，再 resume 会重复 kickLoop 排两条 rAF 链
    if (adopted && rec2.inst && !stopped.value) {
      try {
        rec2.inst.resume()
      } catch {
        /* resume 失败无补救：下一次 syncPaused 还会兜一刀 */
      }
    }
    const settled = beginSettleWait(tr.ms)
    startLayerTransition(rec2.el, oldRec2.el, tr, {
      onRetire: () => {
        retireSlot(oldIdx)
        if (settleRelease) settleRelease()
      }
    })
    activeSlot = idx
    await settled
    if (myEpoch !== epoch) return
  }
  syncPaused()
  syncMediaShown()
  lastTransition = { id: tr.id, dir: tr.dir, ms: tr.ms, reason, at: Date.now() }
}

/**
 * 换片入口（唯一）。串行：switching 保持到旧层退役落地；期间的请求合并成
 * pendingSwitch（只留最后一次 —— 连点选壁纸不叠层）。
 * force=true（「重新应用」按钮的重挂路径）：即便当前就是这条目也真重挂一次
 * —— 场景挂载失败降级成海报后，这是用户可见的重试口。
 */
async function show(it: WallpaperItem, reason: string, force = false): Promise<void> {
  if (!active.value) return
  if (switching) {
    pendingSwitch = { item: it, reason, force }
    return
  }
  switching = true
  let next: { item: WallpaperItem; reason: string; force: boolean } | null = { item: it, reason, force }
  try {
    while (next) {
      const cur = next
      next = null
      // 已经就是它（且没被清场）→ 不必重挂（两条入口——启用与选中——可能同时到达）；
      // force 跳过这一条：同一条目也要真重来一次
      if (cur.force || cur.item.id !== activeItemId()) {
        try {
          await doShow(cur.item, cur.reason)
        } catch (err) {
          console.warn('[wallpaper] show failed:', err)
        }
      }
      if (!active.value) break
      if (pendingSwitch) {
        next = pendingSwitch
        pendingSwitch = null
      }
    }
  } finally {
    switching = false
  }
  // 轮播若在换片期间到点，补在这里（P1 口径：switching 时挂起、闲下来立刻切）
  flushDeferredRotation()
  // Bug1：换片期间悬停到达、被 switching 门挡下的预热意图在这里补跑
  // （弹窗的 dwell 只保证「用户真的停留过」，被挡下时没人会重发 —— 不补这条，
  //  悬停恰逢换片的用户会拿到一个永远不热身的条目）
  maybePreloadFromIntent()
}

// ---------------------------------------------------------------- 轮播

/**
 * 池 = 可渲染条目 ∩ 用户勾选的轮播池（v15）∩ **未被隐藏**（v16）。
 * 可渲染判据统一走 isRenderableItem（弹窗禁用同一份，别各写各的）；
 * 勾选池为空 = 全部参与（存储规范态，见 shared/media-pool.ts）。
 * 池里全是幽灵名（勾过的壁纸被删了）时如实过滤到空 —— 空池轮播不转，
 * 与 decideSplash 同纪律：宁可不动，不要偷偷回退成全量。
 *
 * 【隐藏过滤是**无条件**的，与设置页「显示隐藏项目」开关无关】那个开关只
 * 决定用户能不能在列表里看见条目；被隐藏的壁纸**任何情况下都不进轮播** ——
 * 隐私诉求的原义在这里：轮播是后台行为，私密内容自己转上桌面才是事故面。
 * ⚠️ 正在播的那张被隐藏**不掐断**（item 不经过这里）：突然黑屏比多播一会儿
 * 更糟；用户点「清除」或到点换片即自然离开。
 */
function rotationPool(): WallpaperItem[] {
  const renderable = catalogItems.value.filter(isRenderableItem)
  const hidden = cfg.value.hidden
  const candidates =
    hidden.length === 0 ? renderable : renderable.filter((it) => !hidden.includes(it.id))
  const pool = cfg.value.rotation.pool
  if (pool.length === 0) return candidates
  const allow = new Set(pool)
  return candidates.filter((it) => allow.has(it.id))
}

function syncRotation(): void {
  if (rotationTimer !== null) {
    window.clearInterval(rotationTimer)
    rotationTimer = null
  }
  // 轮播关了（或壁纸整个关掉）时，攒下的「到点未切」欠账一并销掉 —— 否则
  // 关轮播后的某次恢复会把欠账补出去：2026-10-05 复核实锤 = 开轮播 + 手动
  // 暂停跨过 tick（due=true）→ 关轮播 → 恢复播放 → 300ms 去抖 flush 在轮播
  // 已关的状态下偷换一张。
  if (!active.value || !cfg.value.rotation.enabled) {
    rotationDue = false
    return
  }
  if (rotationPool().length < 2) return
  const ms = Math.max(1, cfg.value.rotation.intervalMin) * 60_000
  rotationTimer = window.setInterval(() => {
    // 「清除」之后没有选中项：轮播不该把它复活 —— 2026-10-05 复核实锤：
    // rotateNext 在 cur 为空时 findIndex=-1 兜底到 pool[0]，于是「开着轮播点
    // 清除」的壁纸下个周期自己就回来了（默认 10 分钟）。销 due 防旧账。
    if (!cfg.value.selectedId) {
      rotationDue = false
      return
    }
    if (stopped.value || switching) {
      rotationDue = true // 到点了但正在停/正在换：延后，等闲下来补
      return
    }
    rotateNext()
  }, ms)
}

function rotateNext(): void {
  const pool = rotationPool()
  if (pool.length < 2) return
  const cur = item.value?.id ?? cfg.value.selectedId
  let nextId: string
  if (cfg.value.rotation.order === 'random') {
    const cands = pool.filter((x) => x.id !== cur)
    nextId = (cands[Math.floor(Math.random() * cands.length)] ?? pool[0]).id
  } else {
    const i = pool.findIndex((x) => x.id === cur)
    nextId = pool[(i + 1) % pool.length].id
  }
  // 轮播也走 selectedId 落盘：设置页「当前壁纸」与屏上内容才是同一个事实
  settings.setWallpaper({ selectedId: nextId })
}

function flushDeferredRotation(): void {
  if (!rotationDue) return
  // 欠账作废的两种情况：轮播关了 / 选中被清除（syncRotation 与 tick 也各自
  // 销账，这里是补切前再确认一次的双保险 —— 绝不把废账补出去）。
  if (!cfg.value.rotation.enabled || !cfg.value.selectedId) {
    rotationDue = false
    return
  }
  // 还不满足执行时机（壁纸没开 / 正在换片 / 停着）：保留欠账等下次机会。
  if (!active.value || switching || stopped.value) return
  rotationDue = false
  rotateNext()
}

// ---------------------------------------------------------------- 生命周期

let unsubState: (() => void) | null = null
let batteryCleanup: (() => void) | null = null

function onVisibility(): void {
  pageHidden.value = document.hidden
}

interface BatteryLike {
  charging: boolean
  addEventListener: (t: string, cb: () => void) => void
  removeEventListener: (t: string, cb: () => void) => void
}

/** 探针/排查用只读面（P1 的 __audioStats 同款）：没有任何写口 */
const probeWindow = window as Window & {
  __wallpaperStats?: () => Record<string, unknown>
  __glassStats?: () => unknown
}

function styleVar(el: HTMLElement | null, prop: string): string {
  return el ? el.style.getPropertyValue(prop) : ''
}

function snapshotStats(): Record<string, unknown> {
  const v = activeVideo()
  const rec = recs[activeSlot]
  const stageEl = document.querySelector('.wp-stage') as HTMLElement | null
  const cap = audioCapture.info()
  return {
    // ── P3 第一步就有的字段（名字保持向后兼容） ──
    enabled: cfg.value.enabled,
    selectedId: cfg.value.selectedId,
    itemId: item.value?.id ?? null,
    itemType: item.value?.type ?? null,
    mediaKind: v ? 'video' : rec && rec.kind === 'scene' ? 'scene' : rec && rec.kind === 'img' ? 'poster' : 'none',
    src: v
      ? v.currentSrc
      : rec && rec.kind === 'scene'
        ? rec.src
        : rec && rec.media instanceof HTMLImageElement
          ? rec.media.src
          : null,
    networkState: v?.networkState ?? null,
    readyState: v?.readyState ?? null,
    paused: v?.paused ?? null,
    currentTime: v?.currentTime ?? null,
    videoWidth: v?.videoWidth ?? 0,
    videoHeight: v?.videoHeight ?? 0,
    shouldPause: paused.value.paused,
    pauseWhy: paused.value.why,
    mediaFailed: recs.some((r) => !!r && r.degraded),
    // ── P3 第二步新增（过场/轮播/透视/音轨/手动暂停） ──
    activeSlot,
    switching,
    pendingSwitch: pendingSwitch?.item.id ?? null,
    slots: recs.map((r) =>
      r
        ? {
            kind: r.kind,
            itemId: r.itemId,
            pending: r.pending,
            degraded: r.degraded,
            z: r.el.style.zIndex,
            gen: r.gen,
            inst: !!r.inst,
            mountMs: r.mountMs,
            budgetMs: r.budgetMs,
            diag: r.diag
          }
        : null
    ),
    transition: lastTransition,
    reapply: lastReapply,
    // Bug1 新增（场景预热：悬停→热身→转正的可观测面；探针只读）——
    // state: idle 无热身 / mounting 挂载中 / ready 首帧已画出、暂停待转正
    preload: {
      slotIdx: preloadSlotIdx,
      itemId: preloadItemId,
      state: preloadState,
      mountMs: preloadMs
    },
    transitionCfg: { id: cfg.value.transition, speed: cfg.value.transitionSpeed, dir: cfg.value.transitionDir },
    rotation: {
      enabled: cfg.value.rotation.enabled,
      intervalMin: cfg.value.rotation.intervalMin,
      order: cfg.value.rotation.order,
      due: rotationDue,
      pool: rotationPool().length,
      timer: rotationTimer !== null
    },
    parallax: {
      cfg: { ...cfg.value.parallax },
      // 2026-10-08 浮层降级：读**生效并集**（applyParallax 的真实入参）——
      // 只读 stopped 的话弹窗降级期间探针读到 false，读数骗人
      suspended: stopped.value || dimActive.value,
      attr: document.body.getAttribute('data-wp-parallax'),
      bg: document.body.style.getPropertyValue('--wp-parallax-bg'),
      x: styleVar(stageEl, '--wp-parallax-x'),
      y: styleVar(stageEl, '--wp-parallax-y')
    },
    // ── Bug2 新增（单击/双击转发的可观测面；down/up/blocked/leave 是转发真
    //    发生过的证据，被门控与过滤也在此看得见，探针只读；blockSel 随快照
    //    带出过滤选择器原文 —— 探针复用同一字符串，杜绝两边手打漂移）──
    pointerFwd: { ...pointerFwd, blockSel: CLICK_FWD_BLOCK },
    visual: {
      dim: cfg.value.dim,
      blur: cfg.value.blur,
      brightness: cfg.value.brightness,
      contrast: cfg.value.contrast,
      saturate: cfg.value.saturate,
      opacity: cfg.value.opacity,
      flip: cfg.value.flip,
      objectFit: cfg.value.objectFit
    },
    // ── P3 第四步新增（「壁纸属性」页签的逐张微调；这是**回显**，有效值以
    //    .wp-fit 内联样式为准 —— 探针双读交叉核对，按数据形状自证的教训）──
    tuning: rec && rec.itemId
      ? { itemId: rec.itemId, overrides: { ...(cfg.value.itemTuning[rec.itemId] ?? {}) } }
      : null,
    audio: {
      volume: cfg.value.volume,
      // 元素上的实际音量（0~1；没视频元素时 null）。上面那行是配置回显 ——
      // 引擎音量接线断了它照样对，按数据形状自证的教训：探针要断言这个。
      elVolume: v?.volume ?? null,
      trackOn: cfg.value.trackOn,
      playbackRate: cfg.value.playbackRate,
      gatePresent: audioGate !== null,
      muted: v?.muted ?? null,
      // ── P3 第三步新增（音频响应链路；capture* 是采集器真状态，react/gain 是配置回显）──
      // captureWanted/Attempts/ctx：自愈机的可观测面（wanted=开关意图，attempts=
      // 连续失败数，ctx=AudioContext 状态）——探针据此证明「重试真发生过」。
      react: cfg.value.audio.enabled,
      gain: cfg.value.audio.gain,
      capture: cap.status,
      captureActive: cap.active,
      captureErr: cap.errMsg || null,
      captureWanted: cap.wanted,
      captureAttempts: cap.attempts,
      captureCtx: cap.ctxState
    },
    // ── 2026-10-08 浮层降级（体感卡顿修复）实测面：overlay=计数>0 原始读数，
    //    active=与壁纸启用合并后的生效态，depth=计数（嵌套弹窗错配的排查面）──
    dim: {
      overlay: wallpaperOverlayDim.depth.value > 0,
      active: dimActive.value,
      depth: wallpaperOverlayDim.depth.value
    },
    // ── P3 第三步新增（场景引擎；scene 是**运行中实例的真读数**，不是配置回显）──
    scene:
      rec && rec.inst
        ? {
            mountMs: rec.mountMs,
            budgetMs: rec.budgetMs,
            fps: rec.inst.stats.fps,
            running: rec.inst.stats.running,
            paused: rec.inst.paused,
            quality: rec.inst.getQuality(),
            info: rec.inst.info,
            diag: rec.diag
          }
        : null,
    sceneCfg: { fps: cfg.value.sceneFps, quality: cfg.value.quality },
    manualPaused: wallpaperPlayState.manualPaused.value,
    at: Date.now()
  }
}

// ---------------------------------------------------------------- 订阅与接线

// 选中/启用 → 换片。id 从 null 变出（首挂载/启用/清单晚到）也走这里。
watch(
  shownId,
  (id, prev) => {
    if (id) {
      void (async () => {
        await ensureCatalog()
        if (!(await whenReady())) return
        const it = item.value
        if (it && it.id === id) void show(it, prev ? 'select' : 'boot')
      })()
    } else if (prev) {
      // 选中被清空（壁纸还开着）：收摊回渐变垫底
      retireAll()
    }
  },
  { immediate: true }
)

// 启用/关闭
watch(active, (on) => {
  if (on) {
    syncRotation()
    applyDim()
  } else {
    retireAll()
    resetManualPause()
    syncRotation()
    applyDim()
  }
})

/** 恢复动作（去抖路径与短停速回共用；执行时 stopped 又变真则本次作废） */
function resumeNow(): void {
  if (stopped.value) return
  syncPaused()
  applyDim() // 频谱/透视/场景帧率的恢复全走并集总闸（浮层开着时不许恢复）
  flushDeferredRotation()
}

// 浮层降级随弹窗/抽屉/搜索面板开合（overlay-dim 计数跨 0 边界才触发；
// applyDim 幂等 —— 与 stopped 的并集在函数内重算，两路互不吞恢复）
watch(dimActive, () => applyDim())

// 暂停链：停立即生效；恢复 300ms 去抖（P1 口径：alt-tab 快速来回不打断播放）。
// 【短停速回（2026-10-06 夜间取证修复）】刚落下的停止（距今 < RECENT_STOP_MS）
// 多半是「主窗 blur 先到、桌宠持焦慢路后到」被纠正 —— 此时去抖只会把一次
// 本不该发生的停顿再拖满 300ms（240Hz 全量实测：停顿窗口≈去抖时长本身）。
// 真离开的恢复（停够久的）仍走 300ms 去抖，口径不变。
watch(stopped, (s) => {
  if (resumeTimer !== null) {
    window.clearTimeout(resumeTimer)
    resumeTimer = null
  }
  if (s) {
    stopBeganAt = Date.now()
    syncPaused()
    // 频谱停采/透视停推走并集总闸（浮层降级共用，见 applyDim）
    applyDim()
  } else if (stopBeganAt !== 0 && Date.now() - stopBeganAt < RECENT_STOP_MS) {
    stopBeganAt = 0
    resumeNow()
  } else {
    resumeTimer = window.setTimeout(() => {
      resumeTimer = null
      resumeNow()
    }, 300)
  }
})

// 媒体属性随配置走
watch(
  () => [cfg.value.volume, cfg.value.trackOn, cfg.value.playbackRate],
  () => syncVideos()
)
// 画面调节随配置走（滤镜/透明度/翻转/适配）
watch(
  () => [cfg.value.blur, cfg.value.brightness, cfg.value.contrast, cfg.value.saturate, cfg.value.opacity, cfg.value.flip, cfg.value.objectFit],
  () => applyAllFits()
)
// 场景三键（适配/帧率/画质）+ 全局音量/音轨开关随配置走：热更到运行中的实例，
// 不重挂。**volume/trackOn 必须在依赖里**（2026-10-07 场景 BGM 接线）：场景的
// 出声口只有这里与闸移交两处，不跟的话「怎么调音量都没声音」修一半 —— 拉滑杆、
// 拨音轨开关对场景全是死键。
watch(
  () => [cfg.value.objectFit, cfg.value.sceneFps, cfg.value.quality, cfg.value.volume, cfg.value.trackOn],
  () => {
    for (const rec of recs) {
      if (rec && rec.inst) applySceneSettings(rec)
    }
  }
)
// 壁纸自带属性（A 段）随配置走：面板拖动中直接改 store 内存态（不落盘），
// 这里深侦听当帧推给运行中的场景（发全量「默认+覆盖」，见 pushSceneProps）
watch(
  () => cfg.value.itemProps,
  () => {
    for (const rec of recs) {
      if (rec && rec.inst) void pushSceneProps(rec)
    }
  },
  { deep: true }
)
// 「重新应用」请求（设置页「壁纸属性」面板顶部按钮）：对每个在跑的场景实例把
// 全量属性重推一遍 —— 引擎侧文字热更补丁（build/webwallgl-hotfix.ts）会在这一推
// 里把 text/pointsize 回填到扁平字段并强制重栅格，所以「改完没跟上」点一下就补上。
// 一个实例都没有、而当前条目本来就是场景时，真重挂一次（force）—— 场景挂载失败
// 降级成海报后，这是用户可见的重试口。三态各自如实 toast，结果记进 snapshotStats。
watch(wallpaperReapply.tick, () => {
  const it = item.value
  if (!it) return
  let pushed = 0
  for (const rec of recs) {
    if (rec && rec.inst) {
      void pushSceneProps(rec)
      pushed += 1
    }
  }
  const remounted = pushed === 0 && it.type === 'scene' && sceneMainReady(it)
  if (remounted) void show(it, 'reapply', true)
  lastReapply = { tick: wallpaperReapply.tick.value, at: Date.now(), pushed, remounted }
  if (pushed > 0) toast(SETTINGS.WALL_PROPS_REAPPLY_DONE)
  else if (remounted) toast(SETTINGS.WALL_PROPS_REAPPLY_RELOAD)
  else toast(SETTINGS.WALL_PROPS_REAPPLY_NONE)
})
// 场景预热意图（Bug1，2026-10-07 深夜）：选择壁纸弹窗悬停 → preload.ts 总线。
// 置空（关弹窗且非选中）→ 收掉热身实例；新意图 → 按现场门控决定挂不挂
// （机制与三条纪律见「场景预热」节；挂载失败只静默收场，点选时走正常挂载 + 海报降级）。
watch(wallpaperPreload.intent, (v) => {
  if (v) {
    void preloadScene(v.item)
  } else {
    dropPreload()
  }
})
// 音频响应开关（播放页签）与 boot 补刀。
//
// 【2026-10-06 语义修订：失败**不再回滚开关**】老版本 enable 失败一次就把
// enabled 落盘回滚成 false + toast —— 那是「第一次打开应用加载壁纸，采集
// 环境瞬态失败 → 开关被悄悄关掉 → 之后切壁纸/重开窗都不再尝试 → 只有彻底
// 重启才恢复」的根源之一（另一处是引擎侧 audioSim 闸门，见 hotfix）。
// 现在：采集端自己重试（快速档 1s..15s，之后每分钟一次直到成功或关闭），
// 调用方只负责「如实告知 + 恢复时报喜」，开关停在用户拨的位置。
// 'live' 时重推源给所有实例由 audioCapture.onChange 订阅统一负责（见上）。
// boot 也要走一遍（onMounted 里调）：持久化配置里 enabled=true 时 watch 不会
// 触发，不补这一刀采集永远不启动 —— 开关显示"开"、画面纹丝不动的静默坏法。
async function applyAudioSetting(): Promise<void> {
  if (cfg.value.audio.enabled) {
    const r = await audioCapture.enable()
    if (!r.ok) {
      console.warn('[wallpaper] audio capture enable failed:', r.msg ?? r.status)
      if (r.retrying && !audioTroubleToasted) {
        audioTroubleToasted = true
        toast(SETTINGS.WALL_AUDIO_RETRYING(r.msg ?? r.status), 'warn')
      }
      return
    }
    // 等待期间被关掉：收掉刚建立的采集，不推送（防竞态）
    if (!cfg.value.audio.enabled) {
      audioCapture.disable()
      return
    }
  } else {
    audioCapture.disable()
  }
  pushAudioSource()
}

watch(
  () => cfg.value.audio.enabled,
  () => {
    void applyAudioSetting()
  }
)
// 「壁纸属性」页签的逐张微调随配置走：面板拖动中直接改 store 内存态（不落盘），
// 这里深侦听当帧重画；倍速不在滤镜里，同步刷一遍视频
watch(
  () => cfg.value.itemTuning,
  () => {
    applyAllFits()
    syncVideos()
  },
  { deep: true }
)
// 视差参数随配置走（拖动滑块即时反馈：引擎每帧现读设置，sync 只决定活不活）
watch(
  () => [cfg.value.parallax.enabled, cfg.value.parallax.amount, cfg.value.parallax.smooth],
  () => applyParallax(),
  { immediate: true }
)
// 轮播随配置与清单走。pool 用 join 成字符串比对（不是拿数组引用当键）：
// 配置整份替换时 pool 每次都换新数组，引用比对会让任何一次无关的设置保存
// 都触发 syncRotation —— 那会**重置轮播倒计时**（interval 重建），
// 症状是「改了个音量，等了 9 分钟的下一张又从头数」。'\u0000' 作分隔符：
// 文件名不可能含 NUL，拼接不会产生假相等。
watch(
  () => [
    cfg.value.rotation.enabled,
    cfg.value.rotation.intervalMin,
    cfg.value.rotation.order,
    cfg.value.rotation.pool.join('\u0000'),
    // v16：隐藏集合也改变轮播池 —— 隐藏到只剩一张时 syncRotation 要重新评估
    // （< 2 张不转），不跟的话定时器空转、界面像卡住
    cfg.value.hidden.join('\u0000')
  ],
  () => syncRotation()
)
watch(
  () => catalogItems.value.length,
  () => syncRotation()
)

/**
 * `data-wallpaper` 挂 `document.documentElement`（同 data-theme / data-cursor 先例）。
 * 三态：'media' = 有媒体 / 'on' = 只垫渐变（画布不动；veil 选择器只挂 media 档）
 * / 不存在 = 壁纸关（一切原样）。组件自持 set/delete，卸载即删。
 */
watch(
  [active, mediaShown],
  ([on, media]) => {
    if (!on) delete document.documentElement.dataset.wallpaper
    else document.documentElement.dataset.wallpaper = media ? 'media' : 'on'
  },
  { immediate: true }
)

/*
 * ── 液态玻璃：镜像画布与折射滤镜的运行时装在这里（2026-10-08）─────────────
 *
 * 【为什么装在壁纸层里，而不是做成一个独立的组件/全局单例】
 * 它画的是「壁纸的副本」，位置也必须卡在 `.wp-stage` 与 `.wp-dim` 之间 ——
 * 这两件事都只有壁纸层自己知道（画序是 wallpaper.css 里定死的，状态机是
 * 这一层在跑）。挂在别处就得反向依赖回来，还要自己再判一次「现在是不是
 * media 档」。所以：模板里多一个 canvas、这里多做两件事（装/卸 + 参数同步），
 * 全部逻辑在 lib/glass/refraction.ts，这一层只负责**
 * 把「现在该用哪份参数」和「现在有没有媒体」喂给它**。
 *
 * 【为什么用 watch(refractRef) 而不是在 onMounted 里装一次】
 * canvas 在 `v-if="active"` 里面 —— 壁纸关着时整层不渲染，ref 就是 null。
 * 用户可以在运行时开关壁纸：关→开时 ref 才第一次有值。watch + immediate
 * 同时盖住「挂载时就开着」和「运行中才打开」两条路，且不必手写 if。
 * flush: 'post' 保证拿到的是**已经进 DOM 的**元素（ref 写值在 patch 之后）。
 *
 * 【参数从哪来】store 里的 glass 一组（不分主题，见 shared/wall-ui.ts）。
 * 用 watch 而不是每帧去读 store：参数只在设置页变动，变动时 sync() 一下，
 * 运行时自己的节拍里不再回头问 store（省得把 Vue 的响应式和 rAF 绑在一起）。
 */
const wallUi = useWallUiStore()
const refractRef = ref<HTMLCanvasElement | null>(null)
let refractHandle: RefractionHandle | null = null

function ensureRefraction(): void {
  const el = refractRef.value
  if (el && !refractHandle) {
    refractHandle = installRefraction({
      canvas: el,
      params: () => wallUi.config.glass,
      mediaShown: () => mediaShown.value
    })
    probeWindow.__glassStats = () => refractHandle?.stats() ?? null  } else if (!el && refractHandle) {
    refractHandle.destroy()
    refractHandle = null
    delete probeWindow.__glassStats
  }
}

watch(refractRef, ensureRefraction, { immediate: true, flush: 'post' })

watch(
  () => wallUi.config.glass,
  () => refractHandle?.sync()
)

// 尺寸/档位变化直接让几何作废：等运行时的下一拍太慢（那一下是「镜头没跟上窗口」）
watch(mediaShown, () => refractHandle?.invalidate())

onMounted(() => {
  unsubState = window.miai.onWallpaperState(applyState)
  // 首帧兜底：订阅只收增量，did-finish-load 的强制推发生在本订阅之前
  window.miai
    .getWallpaperState()
    .then(applyState)
    .catch((err: unknown) => console.warn('[wallpaper] getWallpaperState failed:', err))

  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('blur', onWinBlur)
  // Bug2 修复：单击/双击转发（捕获相、被动；只旁听不改写，与既有全局监听并存）
  document.addEventListener('pointerdown', onFwdPointerDown, { capture: true, passive: true })
  document.addEventListener('pointerup', onFwdPointerUp, { capture: true, passive: true })
  document.addEventListener('mouseleave', onFwdDocLeave)

  const nav = navigator as unknown as { getBattery?: () => Promise<BatteryLike> }
  nav
    .getBattery?.()
    .then((b) => {
      onBattery.value = !b.charging
      const onCharging = (): void => {
        onBattery.value = !b.charging
      }
      b.addEventListener('chargingchange', onCharging)
      batteryCleanup = () => b.removeEventListener('chargingchange', onCharging)
    })
    .catch(() => {
      /* 没有电池子系统（台式机）—— pauseOnBattery 本来就默认关 */
    })

  probeWindow.__wallpaperStats = snapshotStats
  void ensureCatalog()
  // 持久化配置里音频响应已开时，watch 不会触发 —— boot 补一次（见 applyAudioSetting）
  if (cfg.value.audio.enabled) void applyAudioSetting()
})

onBeforeUnmount(() => {
  epoch++
  if (settleRelease) settleRelease()
  pendingSwitch = null
  if (resumeTimer !== null) window.clearTimeout(resumeTimer)
  if (rotationTimer !== null) window.clearInterval(rotationTimer)
  retireSlot(0)
  retireSlot(1)
  parallax.stop()
  audioCapture.disable()
  unsubAudioEvents()
  unsubState?.()
  unsubState = null
  batteryCleanup?.()
  batteryCleanup = null
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('blur', onWinBlur)
  document.removeEventListener('pointerdown', onFwdPointerDown, { capture: true })
  document.removeEventListener('pointerup', onFwdPointerUp, { capture: true })
  document.removeEventListener('mouseleave', onFwdDocLeave)
  // 折射运行时：连 SVG 滤镜骨架一起摘干净（它挂在 body 上，不在本组件子树里）
  refractHandle?.destroy()
  refractHandle = null
  delete probeWindow.__glassStats
  delete document.documentElement.dataset.wallpaper
  delete probeWindow.__wallpaperStats
})
</script>

<template>
  <div v-if="active" class="wallpaper-layer" aria-hidden="true">
    <!-- 垫底：主题双套色微渐变（不透明；兼作决策点 7 的默认兜底） -->
    <div class="wp-underlay"></div>

    <!-- 视差舞台：鼠标透视的 translate/scale 目标（消费规则在 wallpaper.css）。
         槽位里只写静态 class（见文件头铁律），子节点全部由脚本 imperative 创建。 -->
    <div class="wp-stage">
      <div ref="slotARef" class="wp-slot"></div>
      <div ref="slotBRef" class="wp-slot"></div>
    </div>

    <!-- 液态玻璃的镜像画布（2026-10-08）：壁纸的副本 + 折射滤镜。位置必须夹在
         .wp-stage 与 .wp-dim 之间（画序论证见 styles/wallpaper.css 里那条规则）。
         内容与开关全由 lib/glass/refraction.ts 管；这里只留一个静态 class ——
         同 .wp-slot 的铁律：壁纸层里的元素不写 :class 绑定。 -->
    <canvas ref="refractRef" class="wp-refract" aria-hidden="true"></canvas>

    <!-- 压暗遮罩：媒体的第一道文字保险（垫底渐变已按主题配过色，不压） -->
    <div v-if="mediaShown" class="wp-dim" :style="{ background: dimStyle }"></div>
  </div>
</template>
