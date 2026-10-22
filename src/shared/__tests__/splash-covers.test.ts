/**
 * 烤录文字覆盖表（src/shared/splash-covers.ts）—— **退役态守则**（2026-10-05 v4）
 *
 * 【这个文件现在在守什么】表为空是复核过的正确状态（像素级烘焙已接管字样
 * 替换，见 splash-covers.ts 头注释）。但「空」有两种：退役后的空，和
 * **不小心被清掉的空** —— 后者在运行期与前者完全无法区分（老测试的第一条
 * 拦路桩「表非空」正是为此）。所以退役态的守则是反过来的：
 *   ① **表必须保持空** —— 谁加回窗口，这条先红，逼他回答「为什么烘焙不够」；
 *      同时下面 skipIf 包着的一整套数据形状检查会在表非空时**自动复活**，
 *      不用手工恢复；
 *   ② coversFor 对未知文件如实回空（接口行为不许变）；
 *   ③ 深拷贝保证不能丢 —— 真表已空，用**注入合成表**测这条（不依赖真数据）。
 */
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { SPLASH_COVER_WINDOWS, coversFor } from '../splash-covers'
import { SPLASH_COVER_TEXT } from '../copy'
import type { SplashCover } from '../splash'

// __dirname = src/shared/__tests__ → 上两级 = src
const splashDir = join(__dirname, '..', '..', 'renderer', 'public', 'splash')
const entries = Object.entries(SPLASH_COVER_WINDOWS)
const allowedTexts = new Set<string>(Object.values(SPLASH_COVER_TEXT))

describe('coversFor：查表口', () => {
  it('未知文件名如实回空数组（没覆盖的素材本来就合法，不是错误）', () => {
    expect(coversFor('nope.mp4')).toEqual([])
    expect(coversFor('')).toEqual([])
  })

  it('注入合成表：返回整树新造 —— 改返回值不污染表（载荷要过 IPC，引用共享是温床）', () => {
    // 真表已空（退役态），本条靠注入的合成表保持覆盖：
    // 深拷贝保证是 coversFor 的接口行为，与表的实际内容无关。
    const row: SplashCover = { startMs: 100, endMs: 200, x: 1, y: 2, w: 3, h: 4, text: '合成' }
    const fake: Record<string, SplashCover[]> = { 'fake.mp4': [row] }
    const got = coversFor('fake.mp4', fake)
    expect(got).toEqual([row])
    expect(got).not.toBe(fake['fake.mp4'])
    expect(got[0]).not.toBe(row)
    got[0].startMs = -12345
    expect(fake['fake.mp4'][0].startMs).toBe(100)
    expect(row.startMs).toBe(100)
  })
})

describe('退役态：表必须保持空', () => {
  it('**表为空是正确状态** —— v4 像素烘焙已接管；加回窗口 = 先读 splash-covers.ts 头注释并确认数据形状检查全绿', () => {
    expect(
      Object.keys(SPLASH_COVER_WINDOWS),
      '覆盖表非空：若这是有意为之（新素材又需要遮挡），请先确认像素烘焙为何不够，' +
        '并让下面「数据形状」一节的检查全部通过；若是意外加回，请清空。'
    ).toEqual([])
  })
})

// 表非空时（有人重新启用覆盖功能）这套检查自动生效，不需要手工恢复。
describe.skipIf(entries.length === 0)('覆盖表的数据形状（表非空时自动启用）', () => {
  it('每个键的文件都在随包素材目录里（文件名打错 = 那支视频静默无覆盖）', () => {
    expect(existsSync(splashDir), `素材目录不存在：${splashDir}`).toBe(true)
    const files = new Set(readdirSync(splashDir))
    for (const [name] of entries) {
      expect(files.has(name), `覆盖表里的 ${name} 不在素材目录里（名字打错了？）`).toBe(true)
    }
  })

  it('逐条：窗口按 startMs 升序、坐标在画幅内、文案出自 copy.ts 真源', () => {
    for (const [name, list] of entries) {
      expect(list.length, `${name} 挂了个空列表（要么删键，要么补窗口）`).toBeGreaterThan(0)
      // 只要求按 startMs 升序（渲染顺序确定、便于人工校对）。
      // 并不禁止时间重叠：两条窗口同时亮是合法的——只要它们盖的是**不同
      // 屏幕区域**（历史数据里 console 块和欢迎 toast 就是同一时段的两个
      // 不同位置）。真正要防的「后盖的闪一下」是同区域重叠，靠几何互斥
      // 判断太脆，交给逐帧目检。
      let lastStart = -1
      for (const c of list) {
        expect(c.endMs, `${name}: endMs 必须大于 startMs`).toBeGreaterThan(c.startMs)
        expect(c.startMs, `${name}: 窗口按 startMs 升序`).toBeGreaterThanOrEqual(lastStart)
        lastStart = c.startMs
        expect(c.w, `${name}: 宽必须为正`).toBeGreaterThan(0)
        expect(c.h, `${name}: 高必须为正`).toBeGreaterThan(0)
        expect(c.x, `${name}: x 越界`).toBeGreaterThanOrEqual(0)
        expect(c.y, `${name}: y 越界`).toBeGreaterThanOrEqual(0)
        // 0.5 的容差：数据来自逐帧量测，允许贴边
        expect(c.x + c.w, `${name}: 框右缘出画幅`).toBeLessThanOrEqual(100.5)
        expect(c.y + c.h, `${name}: 框下缘出画幅`).toBeLessThanOrEqual(100.5)
        expect(
          allowedTexts.has(c.text),
          `${name}: 文案「${c.text}」不在 copy.ts 的 SPLASH_COVER_TEXT 里（不许就地写死）`
        ).toBe(true)
      }
    }
  })
})
