import { describe, expect, it } from 'vitest'
import { miaiWallUrl } from '../url'
import { pathFence } from '../../../../../main/wallpaper/protocol'

/**
 * miai-wall:// URL 拼装（renderer/src/lib/wallpaper/url.ts）。
 *
 * 【为什么跨树引 pathFence 一起测】这两个文件是一对**联手才能工作**的模块：
 * 编码端拼出的 URL，解码端（主进程协议围栏）必须原样认得。只测一边的话，
 * 两边各自"看着对"、合起来 403 —— 而症状只是「视频不显示」，没有任何报错。
 * 这里直接把拼出来的 URL 喂给真围栏，等于把这一对原地对接了一次。
 *
 * （protocol.ts 顶层 import electron 在 node 下是 undefined 但不炸；
 * pathFence 是纯函数，不碰它。）
 */

describe('miaiWallUrl：协议面三条约束', () => {
  it('host 恒为 s，反斜杠先整成正斜杠（围栏拒绝含 \\ 的段）', () => {
    // 盘符的冒号也照编不误（encodeURIComponent(':') = '%3A'）——与 P1 原型
    // app.mjs 的拼法逐字一致（split('/').map(encodeURIComponent)），
    // 围栏那端按段 decode 后还原成 `D:`，最后一格有跨树回环钉住。
    const u = miaiWallUrl('D:\\Steam\\steamapps\\content\\431960\\3284636810\\佐助-壁纸.mp4')
    expect(u.startsWith('miai-wall://s/')).toBe(true)
    expect(u).not.toContain('\\')
    expect(u).toBe(
      'miai-wall://s/D%3A/Steam/steamapps/content/431960/3284636810/%E4%BD%90%E5%8A%A9-%E5%A3%81%E7%BA%B8.mp4'
    )
  })

  it('逐段编码：空格 / # / ? / % 都不许活到 URL 里（# 之后的内容根本到不了服务端）', () => {
    const u = miaiWallUrl('C:/my dir/a#b?c%d.mp4')
    expect(u).toBe('miai-wall://s/C%3A/my%20dir/a%23b%3Fc%25d.mp4')
  })

  it('正斜杠输入同样工作（两个路径形态都从真实数据里来）', () => {
    expect(miaiWallUrl('C:/a/b.png')).toBe('miai-wall://s/C%3A/a/b.png')
  })

  it('开头斜杠 / 重复斜杠不产生空段（空段会被围栏 403）', () => {
    expect(miaiWallUrl('/C://a///b.png')).toBe('miai-wall://s/C%3A/a/b.png')
  })

  it('★ 亲手喂给主进程围栏：拼出来的每一段都必须过栏', () => {
    const samples = [
      'D:\\Steam\\steamapps\\workshop\\content\\431960\\3284636810\\佐助-壁纸.mp4',
      'C:\\Program Files (x86)\\Steam\\wallpaper_engine\\projects\\defaultprojects\\scene.pkg',
      'D:/mixed/斜杠/a b#c.mp4'
    ]
    for (const abs of samples) {
      const u = new URL(miaiWallUrl(abs))
      expect(u.host).toBe('s')
      const fence = pathFence(u.pathname)
      expect(fence.ok, `被围栏拒了（${fence.ok ? '' : fence.why}）：${u.pathname}`).toBe(true)
      if (fence.ok) {
        // 解码回来的绝对路径 = 输入归一后的样子（toPosix + 去空段）
        const roundTrip = fence.segs.join('/')
        expect(roundTrip).toBe(abs.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/|\/$/g, ''))
      }
    }
  })
})
