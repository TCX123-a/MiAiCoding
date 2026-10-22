import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { maskComments } from '../../../../shared/__tests__/mask-comments'

/**
 * 可操作控件描边的对比度闸门（V1-60，2026-10-16 夜 UX 整改）。
 *
 * 【它守什么】未勾选的复选框/单选钮，2px 边框原来吃分隔线色 --mi-border：
 * 浅色对纸面 1.28:1、深色对卡片 1.44:1 —— 当分隔线够用，当一枚 15px 小方框的
 * **边界**太淡（WCAG 1.4.11 对操作性控件边界要 ≥3:1）。「边界靠形状记忆才能
 * 摸到」是那种不报错、不崩、鼠标用户零感知的坏法。
 *
 * 【为什么是算术而不是文本断言】这类令牌改动最安静的坏法是「换个颜色，
 * 但没算过」。所以这里不复述颜色值，而是**从 tokens.css 现场取真值**再算
 * 对比度：值随便改，账必须当场对得上。
 *
 * 【它抓不到什么】真机渲染的最终像素（壁纸玻璃叠加、禁用态 0.5 透明度）。
 * 禁用态按 WCAG 对非活动控件豁免，不在这里算；玻璃只动底不动描边。
 *
 * ⚠️ 新增「控件会落上去的底」时，把它加进 SURFACES —— 这张表是人工清单，
 * 闸门只能验表里的，验不了表外的。
 */

const STYLES = join(__dirname, '..', '..', 'styles')
const BASE_DIR = join(__dirname, '..', '..', 'components', 'base')

const tokensCss = maskComments(readFileSync(join(STYLES, 'tokens.css'), 'utf8'))

/** 取一个令牌在 tokens.css 里的**全部** hex 定义（文件顺序 = 先浅色、后深色） */
function defsOf(name: string): string[] {
  const re = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`, 'g')
  return [...tokensCss.matchAll(re)].map((m) => m[1].toLowerCase())
}

/** WCAG 相对亮度（sRGB，0.03928 段线性化） */
function luminance(hex: string): number {
  const c = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 对比度（亮者在前） */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * 控件可能落上去的底（两个主题各取同名令牌的第 1/2 个定义）。
 * 五个都在列，是因为勾选框/单选钮既住在卡片里，也可能住在斑马行、
 * 当前行高亮或代码块样式的小面板上 —— 取最坏的那个底说话。
 */
const SURFACES = ['--mi-card', '--mi-bg', '--mi-zebra', '--mi-blue-light', '--mi-code-bg']

/** 某个主题（0=浅色 1=深色）下，某颜色对五种底的**最小**对比度与最坏底名 */
function worstRatio(color: string, themeIndex: number): { min: number; worst: string } {
  let min = Number.POSITIVE_INFINITY
  let worst = ''
  for (const s of SURFACES) {
    const defs = defsOf(s)
    expect(defs.length, `${s} 在 tokens.css 里应有浅/深两个定义`).toBe(2)
    const r = contrast(color, defs[themeIndex])
    if (r < min) {
      min = r
      worst = s
    }
  }
  return { min, worst }
}

describe('尺子自检：旧的 --mi-border 必须过不了 3:1（证明这条门槛有分辨力）', () => {
  it('浅色与深色下 --mi-border 的最小对比度都 < 3（就是 V1-60 的病灶）', () => {
    // 没有这条自检，下面「≥3」可能是恒真的（比如五种底全被取错成白色，
    // 或 contrast() 写坏成恒返回大数）。先让尺子在已知的坏值上红一次。
    // ⚠️ 若哪天有人把 --mi-border 本身加深到 ≥3:1（分隔线审美变了），
    // 这条会红 —— 那不是回归，是通知你：自检的负样本没了，需人工过目后
    // 决定是改写自检还是撤掉它（对应「已接受清单」口径）。
    const border = defsOf('--mi-border')
    expect(border.length).toBe(2)
    expect(worstRatio(border[0], 0).min, '浅色 --mi-border 竟然过了 3:1？').toBeLessThan(3)
    expect(worstRatio(border[1], 1).min, '深色 --mi-border 竟然过了 3:1？').toBeLessThan(3)
  })
})

describe('--mi-border-control：两个主题下对五种底全部 ≥3:1（WCAG 1.4.11）', () => {
  const defs = defsOf('--mi-border-control')

  it('浅/深各恰好一个定义（多一个少一个都要人工过目）', () => {
    expect(defs.length, `tokens.css 里的定义：${defs.join(', ')}`).toBe(2)
  })

  it('浅色：最小对比度 ≥ 3', () => {
    const { min, worst } = worstRatio(defs[0], 0)
    expect(min, `浅色最坏底=${worst}，比值 ${min.toFixed(2)}`).toBeGreaterThanOrEqual(3)
  })

  it('深色：最小对比度 ≥ 3', () => {
    const { min, worst } = worstRatio(defs[1], 1)
    expect(min, `深色最坏底=${worst}，比值 ${min.toFixed(2)}`).toBeGreaterThanOrEqual(3)
  })
})

describe('组件接线：勾选框/单选钮的边界真的吃了这枚令牌', () => {
  const files = {
    'MiCheckbox.vue': join(BASE_DIR, 'MiCheckbox.vue'),
    'MiRadio.vue': join(BASE_DIR, 'MiRadio.vue')
  }

  it.each(Object.entries(files))('%s：2px 边框是 --mi-border-control，且不再吃 --mi-border', (_n, p) => {
    const src = maskComments(readFileSync(p, 'utf8'))
    expect(src, '边界没接上专用描边令牌').toContain('border: 2px solid var(--mi-border-control);')
    // 反面：分隔线色不许再出现在这两枚控件上（出现了就是没改干净/改回去了）
    expect(src.includes('var(--mi-border)'), '还在吃分隔线色 --mi-border').toBe(false)
  })

  it('勾选态的视觉没有被顺手改掉（仍是 --mi-blue-deep 系）', () => {
    const box = maskComments(readFileSync(files['MiCheckbox.vue'], 'utf8'))
    const dot = maskComments(readFileSync(files['MiRadio.vue'], 'utf8'))
    expect(box).toContain('border-color: var(--mi-blue-deep);')
    expect(dot).toContain('border-color: var(--mi-blue-deep);')
  })
})
