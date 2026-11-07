/**
 * 自定义鼠标指针的主进程存储（src/main/cursor-store.ts）。
 *
 * 配真临时目录走真 fs —— 这里要守的是**文件与元数据的一致性**：
 *   · 元数据指向的文件必须真的在（用户手动删了素材，槽位要自动变空，不能
 *     显示「已设置」却画不出指针）；
 *   · 换素材/清空之后，旧文件要删掉（不然每换一次就多留一份）；
 *   · 但**另一个槽位还在引用**时绝不能删（两个槽位可以指向同一个文件）；
 *   · 写入顺序是「先 JSON、后删文件」：任何一步失败都不能留下
 *     「元数据指向不存在的文件」。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyCursorFile,
  clearCursorSlot,
  cursorsDir,
  cursorStateView,
  readCursorSlots,
  setCursorHotspot
} from '../cursor-store'

let base = ''
let dir = ''

/** 在一个槽位的素材目录里造一个文件（模拟用户导入后的物理文件） */
function put(name: string, bytes = 32): string {
  mkdirSync(dir, { recursive: true })
  const p = join(dir, name)
  writeFileSync(p, Buffer.alloc(bytes, 1))
  return p
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'miai-cursor-store-'))
  dir = cursorsDir(base)
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('cursorsDir / readCursorSlots', () => {
  it('素材目录是 <数据根>/cursors', () => {
    expect(cursorsDir(base)).toBe(join(base, 'cursors'))
  })

  it('首次启动（目录都不存在）→ 两个槽位为空，不报错', () => {
    expect(readCursorSlots(base)).toEqual({ normal: null, click: null })
  })

  it('应用了文件但 file 已不在 → 该槽位自动变空', () => {
    put('a.png')
    applyCursorFile(base, 'normal', 'a.png')
    expect(readCursorSlots(base).normal?.file).toBe('a.png')

    rmSync(join(dir, 'a.png'))
    expect(readCursorSlots(base)).toEqual({ normal: null, click: null })
  })

  it('坏 JSON → 两个槽位为空（读口绝不能让应用启动失败）', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'cursor.json'), '{ not json', 'utf-8')
    expect(readCursorSlots(base)).toEqual({ normal: null, click: null })
  })

  it('手改过的 JSON：越界热点归为自动、kind 按扩展名重算', () => {
    put('a.mp4')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'cursor.json'),
      JSON.stringify({
        version: 1,
        slots: {
          normal: { file: 'a.mp4', kind: 'image', hotspot: { x: 9, y: 0.5 } },
          click: { file: '../escape.png' }
        }
      }),
      'utf-8'
    )
    expect(readCursorSlots(base)).toEqual({
      normal: { file: 'a.mp4', kind: 'video', hotspot: null },
      click: null
    })
  })
})

describe('applyCursorFile', () => {
  it('落盘 file/kind/hotspot，hotspot 归为自动', () => {
    put('a.png')
    const slots = applyCursorFile(base, 'normal', 'a.png')
    expect(slots.normal).toEqual({ file: 'a.png', kind: 'image', hotspot: null })
    expect(slots.click).toBeNull()
    expect(readCursorSlots(base)).toEqual(slots)
  })

  it('种类按扩展名：mp4 → video', () => {
    put('loop.mp4')
    expect(applyCursorFile(base, 'click', 'loop.mp4').click?.kind).toBe('video')
  })

  it('白名单外扩展名 → 抛 TypeError，且不写盘', () => {
    put('a.txt')
    expect(() => applyCursorFile(base, 'normal', 'a.txt')).toThrow(TypeError)
    expect(readCursorSlots(base)).toEqual({ normal: null, click: null })
  })

  it('换素材时旧文件被删（不在任何槽位里了）', () => {
    const oldPath = put('old.png')
    put('new.png')
    applyCursorFile(base, 'normal', 'old.png')
    applyCursorFile(base, 'normal', 'new.png')
    expect(existsSync(oldPath)).toBe(false)
    expect(readCursorSlots(base).normal?.file).toBe('new.png')
  })

  it('★ 新文件正好被另一个槽位引用时，旧文件仍会删（只看它自己不再被引用）', () => {
    // 场景：normal 指向 old.png；click 指向 shared.png；现在把 normal 也换成 shared.png
    const oldPath = put('old.png')
    const sharedPath = put('shared.png')
    applyCursorFile(base, 'normal', 'old.png')
    applyCursorFile(base, 'click', 'shared.png')
    applyCursorFile(base, 'normal', 'shared.png')

    expect(existsSync(oldPath)).toBe(false)
    expect(existsSync(sharedPath)).toBe(true)
    expect(readCursorSlots(base)).toEqual({
      normal: { file: 'shared.png', kind: 'image', hotspot: null },
      click: { file: 'shared.png', kind: 'image', hotspot: null }
    })
  })

  it('换成同名文件 → 不删（它就是新文件）', () => {
    const p = put('same.png')
    applyCursorFile(base, 'normal', 'same.png')
    applyCursorFile(base, 'normal', 'same.png')
    expect(existsSync(p)).toBe(true)
  })

  it('新槽位的热点不继承旧槽位的（导入即自动定位）', () => {
    put('a.png')
    applyCursorFile(base, 'normal', 'a.png')
    setCursorHotspot(base, 'normal', { x: 0.2, y: 0.3 })
    put('b.png')
    applyCursorFile(base, 'normal', 'b.png')
    expect(readCursorSlots(base).normal?.hotspot).toBeNull()
  })
})

describe('clearCursorSlot', () => {
  it('清空槽位并删掉不再被引用的文件', () => {
    const p = put('a.png')
    applyCursorFile(base, 'normal', 'a.png')
    expect(clearCursorSlot(base, 'normal')).toEqual({ normal: null, click: null })
    expect(existsSync(p)).toBe(false)
  })

  it('空槽位清除是 no-op（不写盘、不报错）', () => {
    expect(clearCursorSlot(base, 'click')).toEqual({ normal: null, click: null })
    expect(existsSync(join(dir, 'cursor.json'))).toBe(false)
  })

  it('★ 另一个槽位还引用同一文件时不许删', () => {
    const p = put('shared.png')
    applyCursorFile(base, 'normal', 'shared.png')
    applyCursorFile(base, 'click', 'shared.png')

    clearCursorSlot(base, 'normal')
    expect(existsSync(p)).toBe(true)
    expect(readCursorSlots(base).click?.file).toBe('shared.png')

    clearCursorSlot(base, 'click')
    expect(existsSync(p)).toBe(false)
  })
})

describe('setCursorHotspot', () => {
  it('写显式热点；null 交还自动定位', () => {
    put('a.png')
    applyCursorFile(base, 'normal', 'a.png')

    const withSpot = setCursorHotspot(base, 'normal', { x: 0.125, y: 0.25 })
    expect(withSpot.normal?.hotspot).toEqual({ x: 0.125, y: 0.25 })
    expect(readCursorSlots(base).normal?.hotspot).toEqual({ x: 0.125, y: 0.25 })

    setCursorHotspot(base, 'normal', null)
    expect(readCursorSlots(base).normal?.hotspot).toBeNull()
  })

  it('越界 / NaN → 抛 RangeError，且盘上保持原值（不静默夹取）', () => {
    put('a.png')
    applyCursorFile(base, 'normal', 'a.png')
    setCursorHotspot(base, 'normal', { x: 0.5, y: 0.5 })

    expect(() => setCursorHotspot(base, 'normal', { x: 1.5, y: 0.5 })).toThrow(RangeError)
    expect(() => setCursorHotspot(base, 'normal', { x: Number.NaN, y: 0.5 })).toThrow(RangeError)
    expect(readCursorSlots(base).normal?.hotspot).toEqual({ x: 0.5, y: 0.5 })
  })

  it('空槽位设热点 → 抛（我们自己调用错了，不是用户操作）', () => {
    expect(() => setCursorHotspot(base, 'click', { x: 0.5, y: 0.5 })).toThrow()
  })
})

describe('cursorStateView', () => {
  it('给每个槽位补上 miai-wall:// 地址（指向 cursors 目录里的真实文件名）', () => {
    put('a.png')
    put('b.mp4')
    applyCursorFile(base, 'normal', 'a.png')
    applyCursorFile(base, 'click', 'b.mp4')

    const view = cursorStateView(base)
    expect(view.normal?.url).toBe(`miai-wall://s/${dir.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')}/a.png`)
    expect(view.click?.url.endsWith('/b.mp4')).toBe(true)
    expect(view.normal?.kind).toBe('image')
    expect(view.click?.kind).toBe('video')
  })

  it('空状态给出两个 null（不是空对象）', () => {
    expect(cursorStateView(base)).toEqual({ normal: null, click: null })
  })
})

describe('落盘形状', () => {
  it('cursor.json 是 {version:1, slots:{...}}（渲染层不读它，但手改要认得）', () => {
    put('a.png')
    applyCursorFile(base, 'normal', 'a.png')
    const written = JSON.parse(readFileSync(join(dir, 'cursor.json'), 'utf-8'))
    expect(written).toEqual({
      version: 1,
      slots: {
        normal: { file: 'a.png', kind: 'image', hotspot: null },
        click: null
      }
    })
  })
})
