import type { WallpaperPowerConfig, WallpaperWindowState } from '../../../../shared/wallpaper'

/**
 * 暂停语义推导（docs/23 §2.4；原型 P1 口径）。
 *
 * 【为什么是纯函数 + 放渲染层】主进程只推「原生事实」（focused/minimized/
 * visible/petFocused），用户策略（pauseOnBlur 一族）是响应式配置 —— 配置一改，
 * 下一次求值立刻用上新策略，不需要主进程重读配置、也没有「配置改了主进程那份是旧的」。
 * 「最小化」与「页面不可见」在这条链里是同一个家族：窗口最小化时 Chromium 会
 * 把页面标成 hidden，hide() 同理（P1 实测 E1：失焦本身**不会**触发 hidden，
 * 所以两条都要看）。
 *
 * 返回 `why` 是为了排查：探针与日志里能看出「停在哪条规则上」，
 * 而不是只知道 paused=true。
 */
export function derivePause(
  win: Pick<WallpaperWindowState, 'focused' | 'minimized' | 'visible' | 'petFocused'>,
  power: WallpaperPowerConfig,
  pageHidden: boolean,
  onBattery: boolean
): { paused: boolean; why: string } {
  if (!win.visible && power.pauseOnMinimize) return { paused: true, why: 'window-hidden' }
  if ((win.minimized || pageHidden) && power.pauseOnMinimize) return { paused: true, why: 'minimized' }
  // 点桌宠会把焦点从主窗抢走，但那不是"主人离开了程序"—— pauseOnBlur 对它豁免
  //（主人口径 2026-10-06：壁纸暂停只认最小化/彻底失焦，不认桌宠互动）。
  // 豁免仅此一条：最小化与电池省电两条，都不看 petFocused。
  if (!win.focused && power.pauseOnBlur && win.petFocused !== true) return { paused: true, why: 'blur' }
  if (onBattery && power.pauseOnBattery) return { paused: true, why: 'battery' }
  return { paused: false, why: 'playing' }
}
