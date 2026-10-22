/**
 * 预览规格：条目 → 预览窗该放什么（2026-10-06，主人点名「壁纸/开屏要能提前
 * 预览，别每次都启动应用去试」）。
 *
 * 规则（唯一真源，选择弹窗与设置页的池子行共用；各写一遍必然漂移）：
 *   · 视频 / 图片壁纸 → 直接播**主文件**（那才是挂到桌面上会看到的东西；
 *     previewAbs 只是工坊海报/缩略图，用它预览等于给人看错画面）；
 *   · 场景（.pkg）/ 网页 / 应用类 → 主文件引擎外放不了，退回海报图
 *     （posterOnly=true，宿主负责如实标注「只能看海报」，不许假装是完整预览）；
 *   · 两者都没有 → null（宿主隐藏预览按钮 —— 没有可预览的东西就别摆按钮）。
 *
 * 为什么是纯函数：可单测、无 Vue 依赖；URL 拼装统一走 miaiWallUrl
 * （miai-wall: 已在 renderer 的 CSP media-src/img-src 白名单里，主窗口直接能播）。
 */
import { miaiWallUrl } from './url'
import type { SplashMaterialRef } from '../../../../shared/splash'
import type { WallpaperItem } from '../../../../shared/wallpaper'

export interface MediaPreviewSpec {
  /** 已拼好的 miai-wall:// URL */
  url: string
  kind: 'video' | 'image'
  /** true = 这不是完整预览（场景/网页类只有海报图），宿主应如实标注 */
  posterOnly: boolean
}

export function wallpaperPreviewSpec(it: WallpaperItem): MediaPreviewSpec | null {
  if (it.mainFileAbs && (it.type === 'video' || it.type === 'image')) {
    return { url: miaiWallUrl(it.mainFileAbs), kind: it.type, posterOnly: false }
  }
  if (it.previewAbs) {
    return { url: miaiWallUrl(it.previewAbs), kind: 'image', posterOnly: true }
  }
  return null
}

/** 开屏素材全是视频（主进程扫描就按 VIDEO_EXTS 过滤），没有海报这一档 */
export function splashPreviewSpec(m: SplashMaterialRef): MediaPreviewSpec {
  return { url: miaiWallUrl(m.abs), kind: 'video', posterOnly: false }
}
