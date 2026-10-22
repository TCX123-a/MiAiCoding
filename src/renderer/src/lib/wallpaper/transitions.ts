/**
 * 壁纸过场动画 —— P1 原型 prototype/app/renderer/transitions.mjs 的 TS 逐字移植
 *（那份又是从上游开源项目 elysia395/dsh-wallpaper-engine 的 client.js:890-997 /
 * layer-core.js:84-105 逐字移植的；2026-10-04 P3 第二步「外观面板完整移植」）。
 *
 * 上游：https://github.com/elysia395/dsh-wallpaper-engine
 * 许可证：MIT，Copyright (c) 2026 elysia395；全文见 THIRD-PARTY-CODE-NOTICES.md。
 *
 * 【与原型唯一的有意偏差：className 整体重写 → classList 增删】
 * 原型里槽位节点是裸 DOM，过场路由 `node.className = 'wp-slot wp-slot--switch'`
 * 一刀重写。本项目槽位住在 Vue 模板里，模板上必须只写静态 `class="wp-slot"`
 *（**禁止 :class 动态绑定**——Vue 的 patchClass 会把整个 className 重写成绑定值，
 * 把这里用 classList 加上的过场类悄悄抹掉，症状是过场偶发地"没有动画"）。
 * 等价的 classList 增删写在下面，其余逻辑逐字保留。
 *
 * 三条铁律（上游注释口径，一个字没改）：
 *   ① 每种过场只动 transform / opacity / clip-path —— 全是合成器友好属性；
 *   ② 所有过场都守同一条：**旧层保持不透明垫在新层之下**（没有「淡到黑」的中间态）；
 *   ③ cut 不走本函数：调用方走「立即拆旧层」的硬切路径。
 *
 * 时序（ms = 基准 × 速度档，cut=0）：旧层 zIndex=1 → 新层 zIndex=2 → 写 inFrom →
 * 写 --wp-switch-ms → 类切换（顺带脱 --pending）→ 非 fade 给旧层挂 switch-out →
 * void offsetWidth 强制 reflow（让初态成为 transition 起点）→ 写 inTo/outTo →
 * ms+100 移除旧层（onRetire）→ ms+60 清新层样式。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫：**字符串一律英文/类名**，中文只出现在注释里
 *（过场的中文名在 copy.ts，界面层按 id 取词）。
 */
import {
  WALLPAPER_TRANSITION_DIRS,
  WALLPAPER_TRANSITION_SPEEDS,
  type WallpaperTransition,
  type WallpaperTransitionDir
} from '../../../../shared/wallpaper'

/** 非「随机」的七种过场（random 在调用方先解析成其中之一）。'cut' 的 ms=0 表示硬切 */
export type WallpaperSwitchId = Exclude<WallpaperTransition, 'random'>

/** 基准时长（ms），逐字移植自上游（cut 恒 0 = 不走过场） */
export const SWITCH_TRANSITIONS: { id: WallpaperSwitchId; ms: number }[] = [
  { id: 'cut', ms: 0 },
  { id: 'fade', ms: 1800 },
  { id: 'push', ms: 700 },
  { id: 'wipe', ms: 700 },
  { id: 'iris', ms: 800 },
  { id: 'zoom', ms: 900 },
  { id: 'bars', ms: 800 }
]

/** 只有这三种吃「方向」（上游口径） */
export const SWITCH_DIRECTIONAL: WallpaperSwitchId[] = ['push', 'wipe', 'bars']

export const SWITCH_BARS_TEETH = 7

/** DSH 默认 switchTransitionDir = left */
const DEFAULT_DIR: WallpaperTransitionDir = 'left'

/** 槽位的类名（CSS 在 styles/wallpaper.css；组件与过场路由共用这几个常量） */
export const SLOT_CLASS = 'wp-slot'
export const SLOT_PENDING_CLASS = 'wp-slot--pending'
export const SLOT_SWITCH_CLASS = 'wp-slot--switch'
export const SLOT_SWITCH_OUT_CLASS = 'wp-slot--switch-out'

export interface TransitionSpec {
  id: WallpaperSwitchId
  dir: WallpaperTransitionDir
  directional: boolean
  ms: number
}

/**
 * `{id, dir, directional, ms}`；ms = max(60, round(base×factor))，cut 恒 0。
 *
 * 与原型的一处数值差异（有意）：速度档从字符串 'fast'/'normal'/'slow' 换成
 * 配置里存的数字（0.6 / 1 / 1.6，shared/wallpaper.ts 的 WALLPAPER_TRANSITION_SPEEDS
 * 是唯一真源，面板和这里共用）。不在白名单里的值退回 1（normal），不猜。
 */
/** 'fade' 的基准（找不到时的兜底；id 不在七种里只可能是调用方传错，不应发生） */
const FALLBACK_DEF: { id: WallpaperSwitchId; ms: number } = { id: 'fade', ms: 1800 }

export function transitionSpec(id: WallpaperTransition, speed: number, dir: WallpaperTransitionDir): TransitionSpec {
  const def = SWITCH_TRANSITIONS.find((t) => t.id === id) ?? FALLBACK_DEF
  const factor = (WALLPAPER_TRANSITION_SPEEDS as readonly number[]).includes(speed) ? speed : 1
  const d = (WALLPAPER_TRANSITION_DIRS as readonly string[]).includes(dir) ? dir : DEFAULT_DIR
  return {
    id: def.id,
    dir: d,
    directional: SWITCH_DIRECTIONAL.includes(def.id),
    ms: def.ms > 0 ? Math.max(60, Math.round(def.ms * factor)) : 0
  }
}

/** 'random' 时随机挑一个非 cut 过场（cut 作为「随机」选项没有意义） */
export function randomTransitionId(rand: () => number = Math.random): WallpaperSwitchId {
  const pool = SWITCH_TRANSITIONS.filter((t) => t.id !== 'cut')
  const pick = pool[Math.floor(rand() * pool.length) % pool.length] ?? FALLBACK_DEF
  return pick.id
}

/** 把配置里的过场值（可能是 'random'）解析成一次具体的过场 id */
export function resolveTransition(id: WallpaperTransition, rand: () => number = Math.random): WallpaperSwitchId {
  return id === 'random' ? randomTransitionId(rand) : id
}

/** 擦除的起始 inset：从新画面「进入」的那一侧长出来（left = 新画面自右进入） */
function wipeInset(dir: WallpaperTransitionDir): string {
  if (dir === 'right') return 'inset(0 100% 0 0)'
  if (dir === 'up') return 'inset(100% 0 0 0)'
  if (dir === 'down') return 'inset(0 0 100% 0)'
  return 'inset(0 0 0 100%)' // left
}

/**
 * 条带 / 百叶窗：N 块独立的板从「进入侧」一起长出来，板间留缝。
 * outer = 进入侧（left/up 取 1，right/down 取 0），深度 depth=p；脊（spine ≤0.4%）
 * 把不相连的板串成一个连通区域（polygon 只能画一个连通区域）；点数恒 4N+1 才可平滑插值。
 *（逐字移植，未改一个算式。）
 */
function barsPolygon(dir: WallpaperTransitionDir, p: number): string {
  const horizontal = dir === 'left' || dir === 'right'
  const fromEnd = dir === 'left' || dir === 'up'
  const outer = fromEnd ? 1 : 0
  const inward = fromEnd ? -1 : 1
  const n = SWITCH_BARS_TEETH
  const period = 1 / n
  const depth = p
  const spine = Math.min(0.004, depth)
  const slat = p / n
  const pt = (a: number, t: number): [number, number] => (horizontal ? [outer + inward * a, t] : [t, outer + inward * a])
  const pts: [number, number][] = [pt(0, 0)]
  for (let i = 0; i < n; i++) {
    const y0 = i * period
    pts.push(pt(depth, y0))
    pts.push(pt(depth, y0 + slat))
    if (i < n - 1) {
      pts.push(pt(spine, y0 + slat))
      pts.push(pt(spine, y0 + period))
    }
  }
  pts.push(pt(spine, 1))
  pts.push(pt(0, 1))
  return 'polygon(' + pts.map(([x, y]) => (x * 100).toFixed(2) + '% ' + (y * 100).toFixed(2) + '%').join(', ') + ')'
}

interface SwitchFrames {
  inFrom: Record<string, string>
  inTo: Record<string, string>
  outTo: Record<string, string>
}

/** 每种过场的「入场层初态 / 入场层终态 / 退场层终态」，直接写成内联样式 */
export function switchFrames(id: WallpaperSwitchId, dir: WallpaperTransitionDir): SwitchFrames {
  const inFrom: Record<string, string> = {
    left: 'translate3d(100%, 0, 0)',
    right: 'translate3d(-100%, 0, 0)',
    up: 'translate3d(0, 100%, 0)',
    down: 'translate3d(0, -100%, 0)'
  }
  const off = inFrom[dir]
  const outTo = {
    left: 'translate3d(-100%, 0, 0)',
    right: 'translate3d(100%, 0, 0)',
    up: 'translate3d(0, -100%, 0)',
    down: 'translate3d(0, 100%, 0)'
  }[dir] as string
  if (id === 'push') {
    return { inFrom: { transform: off }, inTo: { transform: 'translate3d(0, 0, 0)' }, outTo: { transform: outTo } }
  }
  if (id === 'wipe') {
    return { inFrom: { clipPath: wipeInset(dir) }, inTo: { clipPath: 'inset(0)' }, outTo: {} }
  }
  if (id === 'iris') {
    // circle(75%) 覆盖全视口（100% 参考长度 = 对角线/√2，角点距离 ≈ 70.7%）
    return { inFrom: { clipPath: 'circle(0% at 50% 50%)' }, inTo: { clipPath: 'circle(75% at 50% 50%)' }, outTo: {} }
  }
  if (id === 'zoom') {
    return {
      inFrom: { transform: 'scale(1.06)', opacity: '0' },
      inTo: { transform: 'scale(1)', opacity: '1' },
      // 旧层只轻微前推、不改 opacity（保持不透明垫底）
      outTo: { transform: 'scale(1.04)' }
    }
  }
  if (id === 'bars') {
    return { inFrom: { clipPath: barsPolygon(dir, 0) }, inTo: { clipPath: barsPolygon(dir, 1) }, outTo: {} }
  }
  return { inFrom: { opacity: '0' }, inTo: { opacity: '1' }, outTo: {} } // fade
}

function applyInlineStyle(node: Element | null, style: Record<string, string>): void {
  if (!node) return
  const el = node as HTMLElement
  if (!el.style) return
  for (const k in style) {
    try {
      ;(el.style as unknown as Record<string, string>)[k] = style[k]
    } catch {
      /* 个别属性名浏览器不认：跳过，不影响其余 */
    }
  }
}

/** 过场收尾：新层必须回到「干净」状态（上游口径——不留常驻合成层） */
export function resetSwitchStyles(node: Element | null): void {
  if (!node) return
  const el = node as HTMLElement
  try {
    el.classList.remove(SLOT_PENDING_CLASS, SLOT_SWITCH_CLASS, SLOT_SWITCH_OUT_CLASS)
    el.style.transform = ''
    el.style.opacity = ''
    el.style.clipPath = ''
    el.style.removeProperty('--wp-switch-ms')
    el.style.removeProperty('will-change')
  } catch {
    /* 元素已游离：无妨 */
  }
}

export interface TransitionHooks {
  /** 旧层移除点（ms+100）——调用方在此清场（pause 视频、清槽位状态） */
  onRetire?: () => void
}

/**
 * 启动一次过场。node=入场层（新），outgoing=退场层（旧）。
 * 调用方保证：tr.ms > 0 且旧层确实有内容（cut 与「没有旧层」走调用方的硬切路径）。
 */
export function startLayerTransition(node: Element, outgoing: Element, tr: TransitionSpec, hooks: TransitionHooks = {}): void {
  const el = node as HTMLElement
  const old = outgoing as HTMLElement
  // 两者默认都是同层 z-index，谁在上面靠 DOM 顺序 —— 过场期间显式把旧层压到新层之下
  try {
    old.style.zIndex = '1'
    el.style.zIndex = '2'
  } catch {
    /* 忽略 */
  }
  const frames = switchFrames(tr.id, tr.dir)
  applyInlineStyle(el, frames.inFrom)
  try {
    el.style.setProperty('--wp-switch-ms', tr.ms + 'ms')
  } catch {
    /* 忽略 */
  }
  // 类切换顺带脱掉 --pending（新层从这一刻起参与绘制）
  el.classList.remove(SLOT_PENDING_CLASS)
  el.classList.add(SLOT_SWITCH_CLASS)
  // 除 fade 外都给旧层挂 switch-out（上游口径：注释说只有推移/缩放，代码是除 fade 外全挂；
  // wipe/iris/bars 的 outTo={} 故无可见差别）
  if (tr.id !== 'fade') old.classList.add(SLOT_SWITCH_CLASS, SLOT_SWITCH_OUT_CLASS)
  void el.offsetWidth // 强制 reflow：让初态成为 transition 起点
  applyInlineStyle(el, frames.inTo)
  applyInlineStyle(old, frames.outTo)
  // 【为什么这两条 setTimeout 不存句柄、不取消（2026-10-17 夜检复核：记录不修）】
  // 两个回调都是**幂等重放**：onRetire 是调用方的清场（pause 视频、清槽位状态），
  // resetSwitchStyles 只清类名与内联样式 —— 重复执行、或元素已移除后执行，结果
  // 都相同（resetSwitchStyles 自带游离保护，调用方的收尸路径也是幂等的）。
  // 元素级重入也不成立：WallpaperLayer 的流水线要等 onRetire（ms+100）落地才
  // 放行下一次切换，而 reset 在 ms+60 —— 两个回调都先于任何对同一槽位的复用。
  // 加取消句柄反而多一个「句柄在谁手里、什么时候清」的失效点，收益为负。
  window.setTimeout(() => {
    if (hooks.onRetire) hooks.onRetire()
  }, tr.ms + 100)
  window.setTimeout(() => resetSwitchStyles(el), tr.ms + 60)
}
