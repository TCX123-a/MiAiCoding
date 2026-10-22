/**
 * 鼠标透视（3D 视差）—— P1 原型 prototype/app/renderer/parallax.mjs 的 TS 逐字移植
 *（那份逐字移植自上游 elysia395/dsh-wallpaper-engine 的 src/parallax-layer.js
 * + styles.js 视差段；2026-10-04 P3 第二步接入 main 应用）。
 *
 * 上游：https://github.com/elysia395/dsh-wallpaper-engine
 * 许可证：MIT，Copyright (c) 2026 elysia395；全文见 THIRD-PARTY-CODE-NOTICES.md。
 *
 * 【与原型的两处有意偏差】
 * ① 目标选择器：原型是写死的 '.wp-slot'（P1 只有壁纸层）。这里改成选择器表：
 *    · '.wp-stage' —— 壁纸舞台（translate + scale 补边都在 CSS 里合成）。
 *    v12 曾把侧栏大肥鱼挂件也列进表（mascotFollow 开关按同一缓动距离一起挪），
 *    v13 移除 —— 主人实测认为挪起来违和、确认不要。表虽恒为单元素，
 *    targetsRefresh 的增量同步保留：舞台是 v-if 的，开关壁纸仍会换元素。
 * ② 设置源：原型的 state.settings.parallax 换成注入的 getSettings()（读 config）；
 *    onPointer 钩子（P3 第三步场景引擎接入时补上，2026-10-05）：指针移动时把
 *    事件转发给场景实例（pushPointer）—— 与原型同位置、同门控（视差关/挂起
 *    时不推，场景指针特性随之关闭，这是原型口径不是本次新增的口径）。
 *
 * 不变量（上游口径，一个字没改）：
 *   ① 一个 DOM 节点都不建，只写 CSS 变量；系数写 body（设置变了才写），
 *      步长写目标元素自己（每帧）；
 *   ② 只能用 CSS 独立属性 translate / scale，**绝不能用 transform**（过场会内联
 *      写/清 transform，独立属性才与之叠加而不互相清掉）；
 *   ③ 挂了才活、到位就停：光标不动时零帧零 CPU；帧率封顶 60Hz；帧循环期间加临时
 *      合成层类、收工立刻摘（不留常驻合成层）；
 *   ④ 设置每帧现读（拖滑块即时反馈）；事件幂等绑定（重复 sync 不叠监听）。
 *
 * 设置口径（v10 键）：parallax.enabled / amount(0..10 默认3) / smooth(0..98
 * 默认85)。百分比 = 「光标走完整条最长对角线时位移改变
 * 对角线长的百分之几」；scale=1+pct/100 补边（在 wallpaper.css 的消费规则里）。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫：**字符串一律英文/类名/选择器**。
 */

/** 与 miai 坐标取向一致（光标往右下 → 画面往左上挪，即"从窗口往里看"的反向） */
const PARALLAX_DIRECTION = -1
const PARALLAX_BG_MIN = 0
const PARALLAX_BG_MAX = 10
const PARALLAX_SMOOTH_MIN = 0
const PARALLAX_SMOOTH_MAX = 98
const PARALLAX_SETTLE_PX = 0.02
const PARALLAX_FRAME_MS = 1000 / 60
const PARALLAX_DT_MAX = 64
const PARALLAX_MIN_FRAME_MS = PARALLAX_FRAME_MS * 0.75
const PARALLAX_SETTLE_VISIBLE_PX = 0.25
const PARALLAX_IDLE_MS = 180
const PARALLAX_IDLE_VISIBLE_PX = 1
const PARALLAX_MOVING_CLASS = 'wp-parallax--moving'
const PARALLAX_TARGETS_MS = 250
const PARALLAX_BG_DEFAULT = 3
const PARALLAX_SMOOTH_DEFAULT = 85
const PARALLAX_VAR_X = '--wp-parallax-x'
const PARALLAX_VAR_Y = '--wp-parallax-y'
const PARALLAX_VAR_BG = '--wp-parallax-bg'
const PARALLAX_ATTR = 'data-wp-parallax'

/** 舞台选择器（CSS 消费规则在 styles/wallpaper.css） */
export const PARALLAX_STAGE_SELECTOR = '.wp-stage'

export interface ParallaxSettings {
  enabled: boolean
  amount: number
  smooth: number
}

export interface ParallaxEngine {
  /** 设置变了就调一次（只决定该不该活，参数每帧现读） */
  sync(): void
  /** 暂停（最小化/失焦/手动暂停）期间全停 */
  setSuspended(v: boolean): void
  stop(): void
}

interface TargetRec {
  el: HTMLElement
  key: string
  kept?: boolean
}

export function createParallax({
  getSettings,
  onPointer
}: {
  getSettings: () => ParallaxSettings
  /** 指针移动钩子（场景实例 pushPointer 用；见头注释 ②） */
  onPointer?: (e: PointerEvent) => void
}): ParallaxEngine {
  let on = false
  let bound = false
  let raf = 0
  let x = 0
  let y = 0
  let seen = false
  let stepX = 0
  let stepY = 0
  let lastMs = 0
  let stepKey = ''
  let ratioKey = ''
  let vw = 0
  let vh = 0
  let moveMs = 0
  let targets: TargetRec[] = []
  let targetsMs = 0
  let suspended = false

  function now(): number {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
  }
  function clamp(v: unknown, lo: number, hi: number, fb: number): number {
    const n = typeof v === 'number' && isFinite(v) ? v : Number(v)
    if (!isFinite(n)) return fb
    return Math.min(hi, Math.max(lo, n))
  }

  function settings(): { on: boolean; bg: number; smooth: number } {
    const s = getSettings()
    return {
      on: s.enabled === true,
      bg: clamp(s.amount, PARALLAX_BG_MIN, PARALLAX_BG_MAX, PARALLAX_BG_DEFAULT),
      smooth: clamp(s.smooth, PARALLAX_SMOOTH_MIN, PARALLAX_SMOOTH_MAX, PARALLAX_SMOOTH_DEFAULT)
    }
  }

  /** 目标选择器表：v13 起恒为舞台一个（挂件跟随已删）；去重仍在 targetsRefresh 里做保险 */
  function targetSelectors(): string[] {
    return [PARALLAX_STAGE_SELECTOR]
  }

  function varOn(el: HTMLElement | null | undefined, prop: string, value: string): void {
    const style = el && el.style
    if (!style || typeof style.setProperty !== 'function') return
    if (typeof style.getPropertyValue === 'function' && style.getPropertyValue(prop) === value) return
    style.setProperty(prop, value)
  }

  function readViewport(): void {
    const w = Math.round(Number(window.innerWidth))
    const h = Math.round(Number(window.innerHeight))
    vw = isFinite(w) && w > 0 ? w : 0
    vh = isFinite(h) && h > 0 ? h : 0
  }

  function targetLift(el: HTMLElement, lift: boolean): void {
    if (!el || !el.classList) return
    if (lift) el.classList.add(PARALLAX_MOVING_CLASS)
    else el.classList.remove(PARALLAX_MOVING_CLASS)
  }

  function targetClear(rec: TargetRec | null | undefined): void {
    const el = rec && rec.el
    if (!el) return
    targetLift(el, false)
    try {
      el.style.removeProperty(PARALLAX_VAR_X)
      el.style.removeProperty(PARALLAX_VAR_Y)
    } catch {
      /* 忽略 */
    }
    rec.key = ''
  }

  function targetsClear(): void {
    for (const rec of targets) targetClear(rec)
    targets = []
    targetsMs = 0
  }

  function targetsRefresh(t: number): void {
    const next: TargetRec[] = []
    let fresh = false
    for (const sel of targetSelectors()) {
      for (const el of document.querySelectorAll(sel)) {
        const node = el as HTMLElement
        if (next.some((r) => r.el === node)) continue // 选择器表理论上不相交，去重是保险
        let rec: TargetRec | null = null
        for (const p of targets) {
          if (p.el === node) {
            rec = p
            p.kept = true
            break
          }
        }
        if (!rec) {
          rec = { el: node, key: '' }
          fresh = true
        }
        next.push(rec)
      }
    }
    for (const p of targets) {
      if (p.kept) {
        p.kept = false
        continue
      }
      targetClear(p) // 目标没了（舞台被 v-if 拆掉重建）：变量与临时层类一并清掉
    }
    targets = next
    targetsMs = t
    if (fresh) stepKey = ''
  }

  function targetsSettle(): void {
    for (const rec of targets) targetLift(rec.el, false)
  }

  function ratios(st: { bg: number }): void {
    const key = String(st.bg)
    if (key === ratioKey) return
    ratioKey = key
    varOn(document.body, PARALLAX_VAR_BG, key)
  }

  function ratioClear(): void {
    try {
      document.body.style.removeProperty(PARALLAX_VAR_BG)
    } catch {
      /* 忽略 */
    }
  }

  function steps(): void {
    if (!targets.length) return
    const key = stepX.toFixed(2) + '|' + stepY.toFixed(2)
    if (key === stepKey) return
    stepKey = key
    const sx = stepX.toFixed(2) + 'px'
    const sy = stepY.toFixed(2) + 'px'
    for (const rec of targets) {
      rec.key = key
      targetLift(rec.el, true)
      varOn(rec.el, PARALLAX_VAR_X, sx)
      varOn(rec.el, PARALLAX_VAR_Y, sy)
    }
  }

  function attr(onOff: boolean): void {
    if (onOff) document.body.setAttribute(PARALLAX_ATTR, 'on')
    else document.body.removeAttribute(PARALLAX_ATTR)
  }

  function onMove(e: PointerEvent): void {
    if (!on || suspended) return
    x = e.clientX
    y = e.clientY
    seen = true
    moveMs = now()
    kick()
    if (onPointer) onPointer(e)
  }

  function onResize(): void {
    if (!on || suspended) return
    readViewport()
    kick()
  }

  function bind(): void {
    if (bound) return
    document.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('resize', onResize, { passive: true })
    bound = true
  }

  function unbind(): void {
    if (!bound) return
    try {
      document.removeEventListener('pointermove', onMove)
      window.removeEventListener('resize', onResize)
    } catch {
      /* 忽略 */
    }
    bound = false
  }

  function kick(): void {
    if (raf || suspended) return
    if (typeof requestAnimationFrame !== 'function') return
    raf = requestAnimationFrame(frame)
  }

  function frame(ms: number): void {
    raf = 0
    if (!on || suspended) return
    const st = settings()
    if (!st.on) {
      stop()
      return
    }
    const t = typeof ms === 'number' ? ms : now()
    if (lastMs && t - lastMs < PARALLAX_MIN_FRAME_MS) {
      kick()
      return
    } // 帧率封顶 60Hz
    if (vw <= 0 || vh <= 0) readViewport()
    if (!targets.length || t - targetsMs >= PARALLAX_TARGETS_MS) targetsRefresh(t)
    const W = vw > 0 ? vw : 1
    const H = vh > 0 ? vh : 1
    const cx = seen ? x : W / 2
    const cy = seen ? y : H / 2
    const targetX = (PARALLAX_DIRECTION * (cx - W / 2)) / 100
    const targetY = (PARALLAX_DIRECTION * (cy - H / 2)) / 100
    if (st.bg <= 0) {
      // 系数 0：一次落位收工，一帧都不多排
      stepX = targetX
      stepY = targetY
      steps()
      targetsSettle()
      return
    }
    const a = 1 - st.smooth / 100 // smooth=0 ⇒ a=1 ⇒ 直接落位
    const dt = lastMs ? Math.min(PARALLAX_DT_MAX, Math.max(1, t - lastMs)) : PARALLAX_FRAME_MS
    lastMs = t
    const f = a <= 0 ? 1 : 1 - Math.pow(1 - a, dt / PARALLAX_FRAME_MS)
    stepX += (targetX - stepX) * f
    stepY += (targetY - stepY) * f
    const idle = moveMs > 0 && t - moveMs >= PARALLAX_IDLE_MS
    const settle = Math.max(PARALLAX_SETTLE_PX, (idle ? PARALLAX_IDLE_VISIBLE_PX : PARALLAX_SETTLE_VISIBLE_PX) / st.bg)
    const doneX = Math.abs(targetX - stepX) <= settle
    const doneY = Math.abs(targetY - stepY) <= settle
    if (doneX) stepX = targetX
    if (doneY) stepY = targetY
    ratios(st)
    steps()
    if (!doneX || !doneY) kick()
    else targetsSettle()
  }

  function start(): void {
    if (typeof requestAnimationFrame !== 'function') return
    on = true
    attr(true)
    readViewport()
    ratios(settings())
    bind()
    kick()
  }

  function stop(): void {
    on = false
    if (raf) {
      try {
        cancelAnimationFrame(raf)
      } catch {
        /* 忽略 */
      }
      raf = 0
    }
    unbind()
    targetsClear()
    ratioClear()
    stepX = 0
    stepY = 0
    seen = false
    lastMs = 0
    moveMs = 0
    stepKey = ''
    ratioKey = ''
    vw = 0
    vh = 0
    attr(false)
  }

  return {
    sync(): void {
      if (settings().on && !suspended) {
        start()
        // 目标表立刻跟上（舞台是 v-if 的：开关壁纸时不用等 250ms 例行刷新）
        targetsRefresh(now())
        kick()
      } else {
        stop()
      }
    },
    setSuspended(v: boolean): void {
      suspended = !!v
      if (suspended) stop()
      else this.sync()
    },
    stop
  }
}
