/**
 * 开屏页（src/renderer/public/splash.html）的静态闸门
 *
 * 【为什么开屏页需要静态测试】它是一个 public/ 下的**静态文件**：
 *   · import 不到 shared/splash.ts 的常量，也 import 不到 copy.ts 的文案 ——
 *     跨文件一致性只能靠「读源码文本 + 断言」的静态比对守住；
 *   · 它是全应用第一个出现的窗口，坏了连主界面都进不去 —— 没有「将就着用」
 *     的余地，宁可静态测试把话说死。
 *
 * 【三对必须同步的东西】
 *   ① 渐隐时长：页面 CSS `transition: opacity 250ms` ↔ shared 的 FADE_MS
 *      （主进程按 FADE_MS + DESTROY_SLOP 决定何时 destroy，漂了会切画面）；
 *   ② 两句页面文案 ↔ copy.ts 的 SPLASH_PAGE_HINT / SPLASH_PAGE_HOLD
 *      （设置页/开屏页说两样话，谁都不知道哪句是"官方"的）；
 *   ③ 页面调的 window.miaiSplash.{report,getConfig,onFade,onHold} ↔
 *      preload/splash.ts 里真的暴露了这四个名字（桥对不上是
 *      `Cannot read properties of undefined`，而页面里那句 catch 会把它
 *      吞成静默的 error 上报，排障时难得多）。
 *
 * 【底线：去网络化】default-src 'none' 是开屏页唯一的安全属性锚点，
 * 另外整页不许出现任何 http(s) 字样 —— 出现即红灯，让人来解释它。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { FADE_MS } from '../splash'
import { SETTINGS } from '../../renderer/src/lib/copy'

// __dirname = src/shared/__tests__ → 上两级 = src
const root = join(__dirname, '..', '..')
const html = readFileSync(join(root, 'renderer', 'public', 'splash.html'), 'utf8')
const preloadSrc = readFileSync(join(root, 'preload', 'splash.ts'), 'utf8')

describe('开屏页 ↔ 共享常量 / preload 的静态一致性', () => {
  it('渐隐时长与 FADE_MS 同源（改一边不改另一边会红在这条）', () => {
    expect(FADE_MS).toBe(250) // 常量本身也别偷偷动：动了就得连带想一遍 DESTROY_SLOP
    expect(html).toContain(`transition: opacity ${FADE_MS}ms`)
  })

  it('两句页面文案与 copy.ts 逐字一致（开屏页 import 不到 copy.ts，只能靠这条钉）', () => {
    expect(html).toContain(SETTINGS.SPLASH_PAGE_HINT)
    expect(html).toContain(SETTINGS.SPLASH_PAGE_HOLD)
  })

  it('页面调的四个桥名字，preload 里真的都暴露了；preload 暴露的不多不少', () => {
    // 页面侧（源码里就是这四个调用形状）
    for (const call of ['api.report(', 'api.getConfig(', 'api.onFade(', 'api.onHold(']) {
      expect(html, `开屏页没在用 ${call} —— 机制变了就得同步改这条测试的名单`).toContain(call)
    }
    // preload 侧
    expect(preloadSrc).toContain(`exposeInMainWorld('miaiSplash'`)
    for (const key of ['report:', 'getConfig:', 'onFade:', 'onHold:']) {
      expect(preloadSrc, `preload 暴露面里缺 ${key}`).toContain(key)
    }
  })

  it('内容安全策略：default-src none + 媒体只认 miai-wall:（去网络化的机械保障）', () => {
    expect(html).toContain(`default-src 'none'`)
    expect(html).toContain('media-src miai-wall:')
    // CSP 里没写的字面量兜底：整页任何角落都不许出现 http(s)。
    // 出现了就来解释它是什么（这一条故意写得死，参考 copy 那套闸门的脾气）。
    expect(html, '开屏页出现了 http(s) —— 开屏页必须完全离线').not.toMatch(/https?:/)
  })

  it('首帧前画面是品牌底、视频透明；首帧标记的"五路判定"还在（驱动差异下缺一路就是假阴性）', () => {
    // 首帧淡入的门控：没 has-frame 就看不见视频（防黑帧/花帧闪一下）
    expect(html).toContain('body.has-frame #v')
    expect(html).toContain('has-frame')
    // 五路判定每一路都是对某类驱动/素材先到的那一路，删任何一路都要先想清楚
    for (const leg of [
      'loadeddata',
      'canplay',
      'timeupdate',
      'requestVideoFrameCallback'
    ]) {
      expect(html, `首帧判定缺了一路：${leg}`).toContain(leg)
    }
  })

  it('烤录文字覆盖层在场：层/窗口字段/逐帧亮灭都在（DSH 字样替换的机制面）', () => {
    expect(html).toContain('id="cover-layer"')
    expect(html).toContain("el.className = 'cover'")
    expect(html).toContain('startMs')
    expect(html).toContain('endMs')
    expect(html).toContain('requestAnimationFrame')
  })

  it('覆盖框坐标映射走 object-fit 同一套缩放数学（contain 取 min / cover 取 max + 居中偏移）', () => {
    // 少任何一项，contain 留黑边时框就会整体偏移 —— 这个错在 16:9 全屏
    // 测试环境里**看不出来**（偏移为零），只有非 16:9 窗口才现形。
    expect(html).toContain('Math.max(cw / vw, ch / vh)')
    expect(html).toContain('Math.min(cw / vw, ch / vh)')
    expect(html).toContain('videoWidth')
    expect(html).toContain('videoHeight')
    expect(html).toContain('objectFit')
  })

  it('覆盖文案不在页面里写死：窗口数据从主进程来（cfg.covers），文案唯一真源是 copy.ts', () => {
    expect(html).toContain('cfg.covers')
    // 页面自己出现「咪爱编程」四个字 = 第二份会漂移的真源，红灯。
    // （文案经 copy.ts → splash-covers.ts → 主进程 payload 下发。）
    expect(html, '开屏页写死了覆盖文案 —— 必须走 copy.ts → payload 下发').not.toContain('咪爱编程')
  })
})
