// 窗口状态推送（主工程第一条 main→renderer 推送通道；方案 docs/23 §2.4）
//
// 口径：主进程只推「原生事实」（focused/minimized/visible/petFocused），不替
// 渲染层做策略——pauseOnMinimize/pauseOnBlur 是用户配置，渲染层拿着响应式配置
// 自己推导暂停语义。
//
// petFocused（2026-10-06）：主窗失焦**原因**的分拣。点桌宠会让主窗 blur，
// 但那不是"主人离开了程序"——暂停语义由渲染层决定（pauseOnBlur 一族豁免它），
// 这里只如实捎带"桌宠窗此刻有没有焦点"。它是 getter（不是快照字段），
// 因为它的真源在主进程 app.ts 的 petFocused 变量里，宿主上报时顺手 poke。
//
// 自愈：原生模态框等场景会丢失 focus/blur 事件（DSH 教训），故 3s 轮询原生状态，
// 与上次推送不同才补一推（占用可忽略；状态不变 = 零流量）。
// 去重键 = focused|minimized|visible|petFocused；did-finish-load（含重载）强制补一推。
//
// 返回 { detach, poke }（2026-10-06）：poke = 强制立刻推一条 —— petFocused 的
// 变化不产生窗口事件，靠 3s 轮询自愈最坏要等 3 秒（人眼可感）；宿主上报焦点
// 变化时 poke 一下，壁纸的暂停/恢复即刻跟上。
//
// 瞬态失焦合并（2026-10-06 第二轮实测修复）：点/拖/右键桌宠会让主窗原生 blur
// 几乎瞬时就到，而「桌宠持焦」的事实要走 helper→宿主→app 一条跨进程慢路 ——
// blur 那一刻它还没到，渲染层于是先停一次、恢复又被去抖压着，主人看到的就是
// 「rua 一下壁纸卡一下」。现在非 force 的**瞬态失焦**（失焦但还可见、没最小化、
// 宠物也没持焦的中间态）先压进待定槽 300ms：期间任何更新的观察（pet-focus
// 到达后的 poke、回焦事件、甚至下一拍自愈轮询）都会让它作废 —— 于是「桌宠持焦」
// 先到一步，暂停**从未发生**。真走人（300ms 内没人取消）才如实送达，
// 唯一代价是真失焦晚 300ms 暂停（不可感知）。最小化/隐藏不吃延迟（不是中间态）。
// 到点那一刻还会**重读活状态**再送（见定时器处注释）：慢路在最后一毫秒赶到
// 也不发旧快照。

import type { BrowserWindow } from 'electron'
import type { WallpaperWindowState } from '../../shared/wallpaper'

const WIN_EVENTS = ['focus', 'blur', 'minimize', 'restore', 'show', 'hide', 'maximize', 'unmaximize'] as const

const DEFAULT_RECHECK_MS = 3000

/**
 * 瞬态失焦的合并窗口（ms）。
 *
 * 取值依据：pet-focus 慢路（extras→桥→宿主→app）实测在几十毫秒级，
 * 300 够它走完还有余量；而真失焦晚 300ms 暂停刚好压在人「眨眼可辨」的
 * 门槛之下。渲染层恢复侧另有一条 300ms 去抖（WallpaperLayer）—— 两条
 * 数值相等纯属巧合，改这里不必动那边。
 */
const UNFOCUS_MERGE_DELAY_MS = 300

/**
 * 「失焦但可能是瞬态」的中间态：还可见、没最小化、桌宠也没持焦。
 * 正是「blur 先到、petFocused 还在路上」的那个窗口形状 —— 也是**唯一**
 * 吃合并延迟的状态（最小化/隐藏是明说的离开，立刻如实送达）。
 */
function isTransientUnfocus(s: WallpaperWindowState): boolean {
  return !s.focused && !s.petFocused && s.visible && !s.minimized
}

/**
 * Electron 的 `on/removeListener` 是**逐事件名的重载**，静态上喂不进
 * 「字符串 union」——但这里事件名来自 WIN_EVENTS 常量表（就是那八个
 * 字面量本身），运行时完全合法。收窄成一个最小面而不是把类型改宽。
 */
function evented(win: BrowserWindow): {
  on(ev: string, fn: () => void): void
  removeListener(ev: string, fn: () => void): void
} {
  return win as unknown as {
    on(ev: string, fn: () => void): void
    removeListener(ev: string, fn: () => void): void
  }
}

/**
 * 读一次窗口当前状态（与推送载荷同形）。
 * 推送之外的第二个读口：渲染层订阅建立前的首帧兜底（wallpaper:state:get），
 * 以及将来的探针 —— 两边读的是同一段代码，样式不会漂。
 */
export function readWindowState(
  win: BrowserWindow,
  ev = 'poll',
  getPetFocused?: () => boolean,
): WallpaperWindowState {
  return {
    focused: win.isFocused(),
    minimized: win.isMinimized(),
    visible: win.isVisible(),
    petFocused: getPetFocused?.() === true,
    at: Date.now(),
    ev,
  }
}

/**
 * 给窗口挂状态推送。返回 detach：
 *   · 窗口正常销毁**前**调用 —— 摘监听、清轮询；
 *   · 窗口已销毁（'closed' 回调）**后**调用 —— 清轮询后直接返回，不碰窗口。
 * 真 Electron 里窗口对象销毁后**访问它的任何属性**（含 webContents getter）
 * 都会抛 `TypeError: Object has been destroyed` —— 若从 detach 里裸访问，
 * 异常会逃出 'closed' 回调触发原生 Error 框、卡住退出（2026-10-06 实测事故）。
 */
export function attachWindowStatePush(
  win: BrowserWindow,
  channel: string,
  recheckMs: number = DEFAULT_RECHECK_MS,
  getPetFocused?: () => boolean,
): { detach: () => void; poke: (ev?: string) => void } {
  let lastKey = ''
  // 瞬态失焦待定**计时**（见文件头注释；到点重读活状态，不缓存快照，
  // 只留最近一次观察的 ev 标签继续给送达件署名）。定时器只在它缺席时
  // 布防 —— 已布防时连续观察不重置时钟，保证「第一次瞬态起至多 300ms 送达」。
  let pendingTimer: ReturnType<typeof setTimeout> | null = null
  let pendingEv = 'blur'

  /** 待定计时作废：任何「比它新」的观察（可立即送达的、或同样事实已送过的）都调它 */
  const cancelPending = (): void => {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer)
      pendingTimer = null
    }
  }

  const sendNow = (s: WallpaperWindowState): void => {
    lastKey = `${s.focused}|${s.minimized}|${s.visible}|${s.petFocused}`
    win.webContents.send(channel, s)
  }

  const push = (ev: string, force: boolean): void => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    const s = readWindowState(win, ev, getPetFocused)
    const key = `${s.focused}|${s.minimized}|${s.visible}|${s.petFocused}`
    if (!force && isTransientUnfocus(s)) {
      // 已送达过同样的中间态 → 槽里的（连同它的定时器）是陈的，作废即可；
      // 否则压进槽、等 300ms 没人来取消才送达
      if (key === lastKey) {
        cancelPending()
      } else {
        pendingEv = s.ev // 连续观察刷新署名（与旧快照语义一致：署名 = 最近一次观察的事件名）
        if (pendingTimer === null) {
          pendingTimer = setTimeout(() => {
            pendingTimer = null
            // 定时器跑进已销毁窗口：'closed' 后 detach 正常会清掉它，
            // 但销毁与 detach 之间可能就差一拍 —— 守卫照抄 push 开头那条
            if (win.isDestroyed() || win.webContents.isDestroyed()) return
            // 【2026-10-06 夜间取证修复：到点重读活状态，别照发 300ms 前的快照】
            // 待定计时存的是 blur 那一刻的形状；「桌宠持焦」这条跨进程慢路正是
            // 在这段延迟里赶路（实测波动 5ms~300ms+，全量套件条件下偶尔晚于
            // 到点）。照发旧快照的话，晚到的正确事实只能把刚送出的暂停纠回来
            // （240Hz 实测 25ms×6 帧的可感停顿）。重读之后：慢路已到 → 送的就是
            // 对的状态（渲染层根本不停）；仍在途 → 送**此刻**的事实（防抖语义
            // 不变：首次瞬态起至多 300ms 送达）。已回到上次送过的形状（回焦）
            // → key 相等，直接不发。
            const fresh = readWindowState(win, pendingEv, getPetFocused)
            const freshKey = `${fresh.focused}|${fresh.minimized}|${fresh.visible}|${fresh.petFocused}`
            if (freshKey === lastKey) return
            sendNow(fresh)
          }, UNFOCUS_MERGE_DELAY_MS)
        }
      }
      return
    }
    // 到这儿 = 可立即送达（force，或状态已离开瞬态）：此刻的事实比槽里新，槽作废
    cancelPending()
    if (!force && key === lastKey) return
    sendNow(s)
  }

  const ev = evented(win)
  const handlers = WIN_EVENTS.map((name) => {
    const fn = (): void => push(name, false)
    ev.on(name, fn)
    return { name, fn }
  })
  const onLoaded = (): void => push('init', true)
  win.webContents.on('did-finish-load', onLoaded)

  const timer = setInterval(() => push('recheck', false), recheckMs)

  return {
    poke: (ev2 = 'poke') => push(ev2, true),
    detach: () => {
      clearInterval(timer)
      cancelPending()
      // 'closed' 里调进来时窗口已销毁：isDestroyed() 是唯一安全的问法，
      // 监听与轮询都随窗口一起消亡，没有需要补救的。
      if (win.isDestroyed()) return
      for (const { name, fn } of handlers) ev.removeListener(name, fn)
      if (!win.webContents.isDestroyed()) win.webContents.removeListener('did-finish-load', onLoaded)
    },
  }
}
