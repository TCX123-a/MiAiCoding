import { describe, expect, it } from 'vitest'
import { splashPreviewSpec, wallpaperPreviewSpec } from '../preview'
import { miaiWallUrl } from '../url'
import { pathFence } from '../../../../../main/wallpaper/protocol'
import type { SplashMaterialRef } from '../../../../../shared/splash'
import type { WallpaperItem } from '../../../../../shared/wallpaper'

/**
 * 预览规格（renderer/src/lib/wallpaper/preview.ts）—— 2026-10-06 主人点名的
 * 「列表里要能先看效果」。这个纯函数是**唯一真源**：选择弹窗与设置页池子行
 * 的按钮/悬浮卡都读它，各写一份判据必然漂移（一边播主文件、一边播海报）。
 *
 * 【这一节守什么】分支顺序是这条功能的全部正确性：
 *   · video/image → 播**主文件**（挂桌面会看到的画面）。拿 previewAbs 当预览
 *     是「给人看错画面」—— 工坊海报常常和实际内容长得不一样；
 *   · scene/web/application → 引擎外放不了，退回海报图并**如实标注**
 *     posterOnly（宿主负责显示说明，不许假装是完整预览）；
 *   · 都没有 → null（宿主隐藏按钮）。
 * 顺序写反（先看 previewAbs 再判类型）在界面上没有任何报错，只是视频壁纸
 * 永远预览成一张静止海报 —— 所以这里逐分支钉死。
 */

function item(over: Partial<WallpaperItem>): WallpaperItem {
  return {
    id: '1',
    source: 'workshop',
    dir: 'D:/ws/1',
    title: 't',
    type: 'video',
    file: 'a.mp4',
    mainFileAbs: 'D:/ws/1/a.mp4',
    mainSizeBytes: 10,
    previewAbs: null,
    contentrating: null,
    ...over
  }
}

describe('wallpaperPreviewSpec：播什么、标什么', () => {
  it('视频壁纸 → 主文件直播（不是海报）', () => {
    const spec = wallpaperPreviewSpec(
      item({ type: 'video', mainFileAbs: 'D:/ws/1/a.mp4', previewAbs: 'D:/ws/1/preview.jpg' })
    )
    expect(spec).not.toBeNull()
    expect(spec?.kind).toBe('video')
    expect(spec?.posterOnly).toBe(false)
    expect(spec?.url).toBe(miaiWallUrl('D:/ws/1/a.mp4'))
    // 海报在场也**不能**被选中 —— 这条就是「顺序写反」的回归闸
    expect(spec?.url).not.toBe(miaiWallUrl('D:/ws/1/preview.jpg'))
  })

  it('图片壁纸 → 主文件（kind=image）', () => {
    const spec = wallpaperPreviewSpec(
      item({ type: 'image', file: 'a.png', mainFileAbs: 'D:/ws/1/a.png' })
    )
    expect(spec).toEqual({ url: miaiWallUrl('D:/ws/1/a.png'), kind: 'image', posterOnly: false })
  })

  it('场景壁纸（.pkg）→ 退回海报并标注 posterOnly=true', () => {
    const spec = wallpaperPreviewSpec(
      item({ type: 'scene', mainFileAbs: 'D:/ws/1/scene.pkg', previewAbs: 'D:/ws/1/preview.jpg' })
    )
    expect(spec).toEqual({
      url: miaiWallUrl('D:/ws/1/preview.jpg'),
      kind: 'image',
      posterOnly: true
    })
  })

  it.each(['web', 'application'] as const)('%s 类同样走海报 + 标注', (type) => {
    const spec = wallpaperPreviewSpec(item({ type, previewAbs: 'D:/ws/1/preview.jpg' }))
    expect(spec?.posterOnly).toBe(true)
    expect(spec?.url).toBe(miaiWallUrl('D:/ws/1/preview.jpg'))
  })

  it('主文件读不到（mainFileAbs 空）时视频退回海报档 —— 不给一条指向空路径的直播', () => {
    const spec = wallpaperPreviewSpec(
      item({ type: 'video', mainFileAbs: '', previewAbs: 'D:/ws/1/preview.jpg' })
    )
    expect(spec?.posterOnly).toBe(true)
    expect(spec?.url).toBe(miaiWallUrl('D:/ws/1/preview.jpg'))
  })

  it('主文件与海报都没有 → null（宿主据此隐藏预览按钮）', () => {
    expect(wallpaperPreviewSpec(item({ type: 'scene', mainFileAbs: '', previewAbs: null }))).toBeNull()
    expect(wallpaperPreviewSpec(item({ type: 'video', mainFileAbs: '' }))).toBeNull()
  })
})

describe('splashPreviewSpec：开屏素材恒为视频直播', () => {
  it('name 供标题、abs 供播放（不走海报档 —— 开屏库按扩展名只扫视频）', () => {
    const m: SplashMaterialRef = { name: 'nd-brand.mp4', abs: 'D:/app/resources/splash/nd-brand.mp4', sizeBytes: 1 }
    expect(splashPreviewSpec(m)).toEqual({
      url: miaiWallUrl('D:/app/resources/splash/nd-brand.mp4'),
      kind: 'video',
      posterOnly: false
    })
  })
})

describe('★ 跨树回环：预览 URL 必须过主进程协议围栏', () => {
  it('视频主文件、场景海报、开屏素材三个样本逐段过 pathFence', () => {
    // 与 url.test.ts 同一理由：拼装端与解码端是一对，各自「看着对」、
    // 合起来 403 时症状只是「预览窗一片黑」，没有任何报错。
    const samples = [
      wallpaperPreviewSpec(item({ type: 'video', mainFileAbs: 'D:\\Steam\\steamapps\\workshop\\content\\431960\\3284636810\\佐助.mp4' }))?.url,
      wallpaperPreviewSpec(item({ type: 'scene', mainFileAbs: '', previewAbs: 'C:\\Program Files (x86)\\Steam\\preview.jpg' }))?.url,
      splashPreviewSpec({ name: 'nd-startup.mp4', abs: 'D:/app/resources/renderer/splash/nd-startup.mp4', sizeBytes: 1 }).url
    ]
    for (const u of samples) {
      expect(u).toBeTruthy()
      const parsed = new URL(u as string)
      expect(parsed.host).toBe('s')
      const fence = pathFence(parsed.pathname)
      expect(fence.ok, `被围栏拒了：${parsed.pathname}`).toBe(true)
    }
  })
})
