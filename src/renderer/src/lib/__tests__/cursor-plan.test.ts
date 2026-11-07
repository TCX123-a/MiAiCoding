/**
 * 自定义指针的纯计算（src/renderer/src/lib/cursor-plan.ts）。
 *
 * 这几条规则全是「错了也不报错」的那一类：热点偏一两像素、缩放算歪、
 * cursor 值少个收尾关键字 —— 界面一切正常，只是鼠标"点不准"或干脆消失。
 * 所以每条都钉死，尤其是 `cursorCssValue` 的 `, pointer` 收尾。
 */
import { describe, expect, it } from 'vitest'
import {
  autoHotspot,
  cursorCssValue,
  CURSOR_AUTO_HOTSPOT,
  CURSOR_IMAGE_MAX,
  fitSize,
  hotspotPx,
  scanAlphaTip
} from '../cursor-plan'

/** 造一张 w×h 的全透明图（alpha 全 0），再按坐标点亮若干像素 */
function blank(w: number, h: number): Uint8ClampedArray {
  return new Uint8ClampedArray(w * h * 4)
}
function setAlpha(data: Uint8ClampedArray, w: number, x: number, y: number, alpha: number): void {
  data[(y * w + x) * 4 + 3] = alpha
}

describe('fitSize：等比缩到长边 ≤ max', () => {
  it('宽图按长边缩', () => {
    expect(fitSize(256, 128, 128)).toEqual({ width: 128, height: 64 })
  })

  it('高图按长边缩', () => {
    expect(fitSize(64, 512, 128)).toEqual({ width: 16, height: 128 })
  })

  it('本来就小的图不放大（默认 allowUpscale=false）', () => {
    expect(fitSize(64, 32, 128)).toEqual({ width: 64, height: 32 })
  })

  it('allowUpscale=true 才放大（设置页预览要看清小图）', () => {
    expect(fitSize(64, 32, 128, true)).toEqual({ width: 128, height: 64 })
    expect(fitSize(16, 16, 180, true)).toEqual({ width: 180, height: 180 })
  })

  it('四舍五入后至少 1 像素（极端长条不能算成 0）', () => {
    const r = fitSize(1000, 1, 128)
    expect(r.width).toBe(128)
    expect(r.height).toBe(1)
  })

  it('非法尺寸 → {0,0}（调用方据此放弃）', () => {
    expect(fitSize(0, 100, 128)).toEqual({ width: 0, height: 0 })
    expect(fitSize(100, -1, 128)).toEqual({ width: 0, height: 0 })
    expect(fitSize(Number.NaN, 100, 128)).toEqual({ width: 0, height: 0 })
    expect(fitSize(100, 100, 0)).toEqual({ width: 0, height: 0 })
  })

  it('内置上限是 128（Chromium 的自定义指针上限，改了要连浏览器行为一起验证）', () => {
    expect(CURSOR_IMAGE_MAX).toBe(128)
  })
})

describe('hotspotPx：归一化坐标 → 像素（floor + 夹取）', () => {
  it('0 与 1 分别落在第一个/最后一个像素', () => {
    expect(hotspotPx({ x: 0, y: 0 }, 10, 20)).toEqual({ x: 0, y: 0 })
    expect(hotspotPx({ x: 1, y: 1 }, 10, 20)).toEqual({ x: 9, y: 19 })
  })

  it('中心', () => {
    expect(hotspotPx({ x: 0.5, y: 0.5 }, 10, 10)).toEqual({ x: 5, y: 5 })
  })

  it('★ 与 scanAlphaTip 的 x/width 精确往返（floor 不是 round）', () => {
    const w = 7
    const data = blank(w, 3)
    setAlpha(data, w, 3, 1, 255)
    const tip = scanAlphaTip(data, w, 3)
    expect(tip).toEqual({ x: 3 / w, y: 1 / 3 })
    expect(hotspotPx(tip!, w, 3)).toEqual({ x: 3, y: 1 })
  })

  it('越界输入夹进有效像素（越界热点会让整条 cursor 声明失效）', () => {
    expect(hotspotPx({ x: -0.5, y: 2 }, 10, 10)).toEqual({ x: 0, y: 9 })
  })

  it('NaN 当 0（不产生非法 CSS）', () => {
    expect(hotspotPx({ x: Number.NaN, y: Number.NaN }, 10, 10)).toEqual({ x: 0, y: 0 })
  })
})

describe('scanAlphaTip：逐行找第一个不透明像素', () => {
  it('★ 行优先于列（先比 y，再比 x）', () => {
    const w = 4
    const data = blank(w, 3)
    setAlpha(data, w, 3, 0, 255) // 第一行最右
    setAlpha(data, w, 0, 1, 255) // 第二行最左 —— 它更"靠左"，但行序更后
    expect(scanAlphaTip(data, w, 3)).toEqual({ x: 3 / w, y: 0 })
  })

  it('阈值：alpha 23 不算、24 算（抗锯齿边缘不能当热点）', () => {
    const w = 2
    const data = blank(w, 1)
    setAlpha(data, w, 0, 0, 23)
    setAlpha(data, w, 1, 0, 24)
    expect(scanAlphaTip(data, w, 1)).toEqual({ x: 0.5, y: 0 })
  })

  it('全透明 → null', () => {
    expect(scanAlphaTip(blank(4, 4), 4, 4)).toBeNull()
  })

  it('尺寸非法 / 数据不够长 → null（不越界读）', () => {
    expect(scanAlphaTip(blank(2, 2), 0, 2)).toBeNull()
    expect(scanAlphaTip(new Uint8ClampedArray(3), 2, 2)).toBeNull()
  })
})

describe('autoHotspot：扫不到就用中心', () => {
  it('有 alpha 尖端用尖端', () => {
    const w = 4
    const data = blank(w, 4)
    setAlpha(data, w, 1, 1, 255)
    expect(autoHotspot(data, w, 4)).toEqual({ x: 0.25, y: 0.25 })
  })

  it('没有像素数据（JPEG / 脏画布）→ 中心', () => {
    expect(autoHotspot(null, 64, 64)).toEqual(CURSOR_AUTO_HOTSPOT)
  })

  it('全透明 → 中心', () => {
    expect(autoHotspot(blank(8, 8), 8, 8)).toEqual(CURSOR_AUTO_HOTSPOT)
  })

  it('中心常量就是 0.5/0.5', () => {
    expect(CURSOR_AUTO_HOTSPOT).toEqual({ x: 0.5, y: 0.5 })
  })
})

describe('cursorCssValue：必须能作为一条合法声明', () => {
  it('★ 以 ", pointer" 收尾（少了它整条声明作废，全站手型一起消失）', () => {
    const v = cursorCssValue('data:image/png;base64,AAA', 3, 4)
    expect(v.endsWith(', pointer')).toBe(true)
    expect(v).toBe('url("data:image/png;base64,AAA") 3 4, pointer')
  })

  it('url 用双引号包住（data URL 里的分号/逗号会被当成分隔符）', () => {
    expect(cursorCssValue('x', 0, 0).startsWith('url("x")')).toBe(true)
  })
})
