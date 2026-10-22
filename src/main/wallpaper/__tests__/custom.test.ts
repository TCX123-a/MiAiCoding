/**
 * 自定义壁纸扫描（src/main/wallpaper/custom.ts）
 *
 * 【这个文件在守什么】这里产出的条目会直接拼进壁纸清单（catalog discover），
 * 上线后的坏法两种方向都静默：
 *   1. **多收**（不该认的认了）→ 列表里出现一条永远播不出的条目，
 *      用户点了没反应，只会以为壁纸功能坏了；
 *   2. **少收**（过滤写狠了）→ 「我明明导入成功了啊」而列表里没有 ——
 *      比第一种更气人，因为导入对话框刚说过「成功」。
 * 另外三条形状判据是渲染管线的接口（见 custom.ts 文件头）：
 *   · 图片 previewAbs 必须指向文件自身（planMedia 靠它走 <img> 分支）；
 *   · 视频 previewAbs 为 null（没有现成海报帧）；
 *   · id 带 `custom:` 前缀（与工坊纯数字 id 永不相撞）。
 *
 * 全部夹具在系统临时目录现造现拆，不碰仓库里的任何真实目录。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MIN_IMPORT_BYTES } from '../../media-import'
import { scanCustomWallpapers } from '../custom'

let tmp = ''
let dir = ''

/** 造一个「体积够格」的素材文件（扫描只看扩展名与体积） */
function put(name: string, sizeBytes = 2048): string {
  const p = join(dir, name)
  writeFileSync(p, Buffer.alloc(sizeBytes, 1))
  return p
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'miai-custom-wall-'))
  dir = join(tmp, 'wallpapers')
  mkdirSync(dir)
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('scanCustomWallpapers：分类与形状', () => {
  it('图片 → type image + previewAbs 指向自身；mp4 → video + previewAbs null', () => {
    put('star.png')
    put('clip.mp4')

    const out = scanCustomWallpapers(dir)
    const img = out.find((it) => it.file === 'star.png')
    const vid = out.find((it) => it.file === 'clip.mp4')

    expect(img).toMatchObject({
      id: 'custom:star.png',
      source: 'custom',
      dir,
      title: 'star',
      type: 'image',
      mainFileAbs: join(dir, 'star.png'),
      mainSizeBytes: 2048,
      previewAbs: join(dir, 'star.png'),
      contentrating: null
    })
    expect(vid).toMatchObject({
      id: 'custom:clip.mp4',
      source: 'custom',
      type: 'video',
      mainFileAbs: join(dir, 'clip.mp4'),
      previewAbs: null
    })
  })

  it('图片全家：jpg / jpeg / png / webp / gif；大写扩展名也认（Windows 上随手改名很常见）', () => {
    for (const n of ['a.jpg', 'b.jpeg', 'c.png', 'd.webp', 'e.gif', 'f.WEBP', 'g.GIF']) put(n)
    expect(scanCustomWallpapers(dir).map((it) => it.file)).toEqual([
      'a.jpg',
      'b.jpeg',
      'c.png',
      'd.webp',
      'e.gif',
      'f.WEBP',
      'g.GIF'
    ])
    expect(scanCustomWallpapers(dir).every((it) => it.type === 'image')).toBe(true)
  })

  it('title 只去掉最后一段扩展名（文件名里的点留着）', () => {
    put('my star v1.2.png')
    expect(scanCustomWallpapers(dir)[0]?.title).toBe('my star v1.2')
  })
})

describe('scanCustomWallpapers：过滤，与导入校验同一口径', () => {
  it('隐藏文件 / 无扩展名 / 非白名单扩展名 / 过小残片 / 同名目录 全部挡在外面', () => {
    put('ok.png')
    put('.secret.png') // macOS/编辑器垃圾
    put('noext')
    put('notes.txt')
    put('tiny.png', MIN_IMPORT_BYTES - 1) // 断点残片的典型体积
    mkdirSync(join(dir, 'folder.png')) // 目录恰好叫了图片名

    expect(scanCustomWallpapers(dir).map((it) => it.file)).toEqual(['ok.png'])
  })

  it('体积下限恰好 = MIN_IMPORT_BYTES（1024 收、1023 不收）—— 与导入校验同一常量', () => {
    put('edge-in.png', MIN_IMPORT_BYTES)
    put('edge-out.png', MIN_IMPORT_BYTES - 1)
    expect(scanCustomWallpapers(dir).map((it) => it.file)).toEqual(['edge-in.png'])
  })

  it('目录不存在 / 空字符串 → 空数组（没导入过是正常形态，不是错误）', () => {
    expect(scanCustomWallpapers(join(tmp, 'nope'))).toEqual([])
    expect(scanCustomWallpapers('')).toEqual([])
  })
})

describe('scanCustomWallpapers：排序', () => {
  it('ASCII 逐字符序（不是 localeCompare）—— 跨机器确定', () => {
    // ASCII 里大写恒在小写前（B=66 < a=97 < c=99）；localeCompare 按字母
    // 基字比较会把 'a.png' 排到 'B.png' 前 —— 实现若换成 localeCompare，这格必红。
    put('c.png')
    put('B.png')
    put('a.png')
    expect(scanCustomWallpapers(dir).map((it) => it.file)).toEqual(['B.png', 'a.png', 'c.png'])
  })
})
