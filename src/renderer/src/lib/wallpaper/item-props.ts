/**
 * 壁纸自带属性**原文**的渲染层缓存（按 itemId）。
 *
 * 【为什么要有这一层】「壁纸属性」页签每翻进来一次就组一次面板；原文（project.json
 * 的 general.properties）在应用运行期是**准静态**的 —— 只有壁纸更新才会变，而更新
 * 要重启应用/重扫才可见。缓存把「翻页签 → 主进程读文件」的往返降到一次，
 * 代价只是「壁纸在本次运行中被工坊更新」时读到旧属性（可接受，注释记在案）。
 *
 * 【失败不缓存】IPC 真抛了（通道坏了）不写缓存 —— 下次翻页签要再试一次，
 * 不把一次故障固化成「这张没有属性」。反之 `project: null`（没有 properties 块 /
 * 文件读不到）是**稳定事实**，照常缓存。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫：字符串一律英文，中文只出现在注释里。
 */
import type { WallpaperPropsResult } from '../../../../shared/wallpaper'

const cache = new Map<string, WallpaperPropsResult>()
const inflight = new Map<string, Promise<WallpaperPropsResult>>()

/** 已缓存的原文（没读过返回 undefined）—— 面板用它决定首帧要不要进加载态 */
export function cachedItemProps(id: string): WallpaperPropsResult | undefined {
  return cache.get(id)
}

const EMPTY: WallpaperPropsResult = { project: null, path: null }

/** 拉一张壁纸的属性原文（带缓存 + 在途合流）。**永不 reject**（IPC 失败即值） */
export function loadItemProps(id: string): Promise<WallpaperPropsResult> {
  const hit = cache.get(id)
  if (hit) return Promise.resolve(hit)
  const flying = inflight.get(id)
  if (flying) return flying
  const p = window.miai
    .readWallpaperProps(id)
    .then((res) => {
      cache.set(id, res)
      return res
    })
    .catch((err: unknown) => {
      console.warn('[wallpaper] readWallpaperProps failed:', err)
      return EMPTY
    })
    .finally(() => {
      inflight.delete(id)
    })
  inflight.set(id, p)
  return p
}
