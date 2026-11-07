/**
 * 自定义鼠标指针的共享契约（src/shared/cursor.ts）。
 *
 * 【这里守什么】契约层的每一条都是**静默坏**的那一种：
 *   · 扩展名判反 → 图片按视频走（永远不出现）/ 视频按图片走（浏览器忽略）；
 *   · 文件名里带 `..` 或分隔符 → miai-wall:// 围栏拒绝该段，指针凭空消失；
 *   · 元数据里的 kind 被信任 → 用户手动改名后渲染层按错的解码器走；
 *   · 热点的 NaN/越界被静默夹取 → 一个 bug 变成"看起来能用"。
 *
 * 全部是纯函数，不需要 Electron / DOM。
 */
import { describe, expect, it } from 'vitest'
import {
  CURSOR_IMAGE_EXTS,
  CURSOR_VIDEO_EXTS,
  cursorKindOfFile,
  isCursorSlot,
  sanitizeCursorSlots,
  sanitizeHotspot
} from '../cursor'

describe('isCursorSlot', () => {
  it('只认两个槽位名', () => {
    expect(isCursorSlot('normal')).toBe(true)
    expect(isCursorSlot('click')).toBe(true)
  })

  it('大小写不同 / 别的名字 / 非字符串都不认', () => {
    expect(isCursorSlot('Normal')).toBe(false)
    expect(isCursorSlot('down')).toBe(false)
    expect(isCursorSlot(null)).toBe(false)
    expect(isCursorSlot(1)).toBe(false)
    expect(isCursorSlot({ slot: 'normal' })).toBe(false)
  })
})

describe('cursorKindOfFile：只按扩展名判种类', () => {
  it('图片白名单逐个都认（大小写不敏感）', () => {
    for (const ext of CURSOR_IMAGE_EXTS) {
      expect(cursorKindOfFile(`cursor.${ext}`)).toBe('image')
      expect(cursorKindOfFile(`CURSOR.${ext.toUpperCase()}`)).toBe('image')
    }
  })

  it('视频白名单逐个都认（大小写不敏感）', () => {
    for (const ext of CURSOR_VIDEO_EXTS) {
      expect(cursorKindOfFile(`cursor.${ext}`)).toBe('video')
      expect(cursorKindOfFile(`CURSOR.${ext.toUpperCase()}`)).toBe('video')
    }
  })

  it('无点 / 点开头 / 点结尾 / 白名单外 → null', () => {
    expect(cursorKindOfFile('png')).toBeNull()
    expect(cursorKindOfFile('.png')).toBeNull()
    expect(cursorKindOfFile('cursor.')).toBeNull()
    expect(cursorKindOfFile('cursor.txt')).toBeNull()
    expect(cursorKindOfFile('cursor.mov')).toBeNull()
    // 中间的"扩展名"不算数：看的是最后一段
    expect(cursorKindOfFile('a.mp4.png')).toBe('image')
    expect(cursorKindOfFile('a.png.mp4')).toBe('video')
  })
})

describe('sanitizeHotspot：0~1 的有限数，否则 null（不夹取）', () => {
  it('边界 0 与 1 都合法', () => {
    expect(sanitizeHotspot(0, 0)).toEqual({ x: 0, y: 0 })
    expect(sanitizeHotspot(1, 1)).toEqual({ x: 1, y: 1 })
    expect(sanitizeHotspot(0.25, 0.75)).toEqual({ x: 0.25, y: 0.75 })
  })

  it('越界一丁点也是 null（不静默夹到边上）', () => {
    expect(sanitizeHotspot(-0.001, 0.5)).toBeNull()
    expect(sanitizeHotspot(0.5, 1.001)).toBeNull()
  })

  it('NaN / Infinity / 字符串 / 非数字 → null', () => {
    expect(sanitizeHotspot(Number.NaN, 0.5)).toBeNull()
    expect(sanitizeHotspot(0.5, Number.POSITIVE_INFINITY)).toBeNull()
    expect(sanitizeHotspot('0.5', 0.5)).toBeNull()
    expect(sanitizeHotspot(null, undefined)).toBeNull()
  })
})

describe('sanitizeCursorSlots：宽容读、严格写', () => {
  it('null / 非对象 → 两个槽位都空', () => {
    expect(sanitizeCursorSlots(null)).toEqual({ normal: null, click: null })
    expect(sanitizeCursorSlots('x')).toEqual({ normal: null, click: null })
    expect(sanitizeCursorSlots(42)).toEqual({ normal: null, click: null })
  })

  it('裸槽位对象与 {version, slots} 两种形状都接受', () => {
    expect(sanitizeCursorSlots({ normal: { file: 'a.png' }, click: null })).toEqual({
      normal: { file: 'a.png', kind: 'image', hotspot: null },
      click: null
    })
    expect(
      sanitizeCursorSlots({ version: 1, slots: { normal: null, click: { file: 'b.mp4' } } })
    ).toEqual({
      normal: null,
      click: { file: 'b.mp4', kind: 'video', hotspot: null }
    })
  })

  it('★ 文件名必须是纯文件名：路径分隔符 / NUL / . 与 .. 一律丢弃', () => {
    for (const file of ['../escape.png', '..\\escape.png', 'a/b.png', 'a\\b.png', '.', '..', '']) {
      expect(sanitizeCursorSlots({ normal: { file } }), file).toEqual({
        normal: null,
        click: null
      })
    }
  })

  it('NUL 字节（手改 JSON 时可能出现）也拒', () => {
    expect(sanitizeCursorSlots({ normal: { file: 'a\0.png' } }).normal).toBeNull()
  })

  it('★ kind 以磁盘扩展名为准，忽略元数据里记的 kind', () => {
    expect(sanitizeCursorSlots({ normal: { file: 'a.mp4', kind: 'image' } }).normal?.kind).toBe(
      'video'
    )
    expect(sanitizeCursorSlots({ normal: { file: 'a.png', kind: 'video' } }).normal?.kind).toBe(
      'image'
    )
  })

  it('白名单外的扩展名 → 槽位丢弃（文件在也不认）', () => {
    expect(sanitizeCursorSlots({ normal: { file: 'a.txt' } }).normal).toBeNull()
    expect(sanitizeCursorSlots({ normal: { file: 'README' } }).normal).toBeNull()
  })

  it('热点坏了只丢热点、不丢槽位（退回自动定位）', () => {
    const r = sanitizeCursorSlots({ normal: { file: 'a.png', hotspot: { x: 2, y: 0.5 } } })
    expect(r.normal).toEqual({ file: 'a.png', kind: 'image', hotspot: null })
  })

  it('合法的显式热点原样保留', () => {
    const r = sanitizeCursorSlots({
      normal: { file: 'a.png', hotspot: { x: 0.125, y: 0.25 } }
    })
    expect(r.normal?.hotspot).toEqual({ x: 0.125, y: 0.25 })
  })

  it('两个槽位互不影响（一个是坏文件名，另一个仍然保留）', () => {
    const r = sanitizeCursorSlots({
      normal: { file: '../bad.png' },
      click: { file: 'good.webm' }
    })
    expect(r).toEqual({ normal: null, click: { file: 'good.webm', kind: 'video', hotspot: null } })
  })
})
