/**
 * 自定义指针的**纯计算**：尺寸缩放、热点换算、alpha 扫描（v7 模块六，2026-10-31）。
 *
 * 【为什么要单独一层】
 * 这几条规则错了**一条都不会报错**：
 *   · 热点算偏 → 指针看起来"点不准"，但界面一切正常；
 *   · 拼 cursor 值少了 `, pointer` 收尾 → 整条声明作废（本项目栽过，见 cursor.css）；
 *   · 缩放比例算错 → 图糊了或者被浏览器直接忽略。
 * 它们全在 node 环境里可测，所以从 DOM 代码里拆出来单测（同 cursor-assets 的分工）。
 *
 * 浏览器上的那半截（加载图片 / 建 canvas / 挂监听）在 custom-cursor.ts。
 */
import type { CursorHotspot } from '../../../shared/cursor'

/**
 * 自定义指针的显示上限（每条边）。
 *
 * Chromium 对 CSS 自定义指针有尺寸上限（超过约 128×128 的图会被忽略，
 * 退回系统指针）。这里统一缩到 ≤128 再交给浏览器 —— 同时把 data URL
 * 的体积压下来（原图可能是 4K）。
 */
export const CURSOR_IMAGE_MAX = 128

/**
 * 等比缩放到「长边不超过 max」。
 *
 * @param allowUpscale 设置页的预览要允许放大（16×16 的指针图直接显示成 16px
 *   根本看不清热点），而真正装到鼠标上的图**只许缩不许放** —— 放大一个小图
 *   只会得到一团糊，还可能超过上面的 128 上限。
 * @returns 非法尺寸（0 / 负数 / NaN）→ `{width:0, height:0}`，调用方据此放弃。
 */
export function fitSize(
  width: number,
  height: number,
  max: number,
  allowUpscale = false
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 }
  }
  if (!Number.isFinite(max) || max <= 0) return { width: 0, height: 0 }
  const raw = max / Math.max(width, height)
  const scale = allowUpscale ? raw : Math.min(raw, 1)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}

/**
 * 归一化热点 → 指针图上的像素坐标。
 *
 * 用 `floor` 不用 `round`：`scanAlphaTip` 返回的 `x / width` 恰好落在像素
 * 格子的左边界上，floor 能原样还原成那个像素下标；改成 round 在奇数宽度时
 * 会整体右移一格。最后再夹进 `[0, 边长-1]`（越界热点会让整条 cursor
 * 声明无效，比"偏一格"严重得多）。
 */
export function hotspotPx(
  hotspot: CursorHotspot,
  width: number,
  height: number
): { x: number; y: number } {
  const clamp = (value: number, max: number): number => {
    if (!Number.isFinite(value)) return 0
    return Math.min(Math.max(Math.floor(value), 0), Math.max(0, max - 1))
  }
  return { x: clamp(hotspot.x * width, width), y: clamp(hotspot.y * height, height) }
}

/**
 * 扫 alpha 通道，找第一个「看得见」的像素 —— 常见指针图的箭尖就在那儿。
 *
 * 逐行（从上到下）、行内从左到右，是**故意**的顺序：指针图的实体部分
 * 通常从左上往右下展开，第一个不透明像素就是整张图最靠外的尖端。
 *
 * 阈值而不是 `alpha > 0`：抗锯齿边缘有大量 alpha=1~5 的像素，拿它们当热点
 * 会让指针整体偏移一两个像素（视觉上像"点不准"，但没有任何报错）。
 *
 * @returns 归一化坐标；整张图都透明（或没有 alpha 通道）→ null，交给调用方兜底。
 */
export function scanAlphaTip(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 24
): CursorHotspot | null {
  if (width <= 0 || height <= 0) return null
  if (data.length < width * height * 4) return null
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3]! >= threshold) {
        return { x: x / width, y: y / height }
      }
    }
  }
  return null
}

/**
 * 自动热点的兜底值：图片扫不到 alpha 尖端（JPEG / 全透明图）、
 * 或者素材本来就是视频（没有 alpha 通道）时，落在正中间。
 */
export const CURSOR_AUTO_HOTSPOT: CursorHotspot = { x: 0.5, y: 0.5 }

/** 图片自动热点：优先扫尖端，扫不到用中心 */
export function autoHotspot(
  data: Uint8ClampedArray | null,
  width: number,
  height: number
): CursorHotspot {
  return (data && scanAlphaTip(data, width, height)) || CURSOR_AUTO_HOTSPOT
}

/**
 * 拼一条**合法**的 CSS cursor 值（data URL 版本）。
 *
 * ⚠️ 必须带 `, pointer` 收尾 —— 少了它不是"猫爪不显示"，是整条声明作废、
 * 全站 `pointer` 手型一起消失（详见 cursor.css 开头那段，本项目踩过）。
 * 这条规则由单测钉着，别在别处手拼。
 */
export function cursorCssValue(dataUrl: string, x: number, y: number): string {
  return `url("${dataUrl}") ${x} ${y}, pointer`
}
