import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  THEME_PANEL_BG,
  THEME_TITLE_SYMBOL,
  THEME_WINDOW_BG,
  panelBgOf,
  titleSymbolColorOf,
  windowBgOf
} from '../theme'
import { THEME_NAMES } from '../types'

/**
 * 原生层颜色的闸门：**把 `theme.ts` 里那三张表钉在 `tokens.css` 上**
 * （窗口底色 THEME_WINDOW_BG ← `--mi-canvas`；顶栏按钮符号色
 * THEME_TITLE_SYMBOL ← `--mi-text`，2026-10-05 顶条玻璃化时加入；
 * 面板底色 THEME_PANEL_BG ← `--mi-card`，2026-10-07 面板颜色个性化加入）。
 *
 * 【为什么需要它】
 * `BrowserWindow.backgroundColor` 是原生层的东西，由 Chromium 在渲染进程还没画之前
 * 直接刷上去；而主进程**读不到 CSS 变量**。所以这两个值必然是**写在两处**的
 * —— CSS 一处、`theme.ts` 一处。本项目对「同一件事两个真源」是有旧账的
 * （`md.ts:48-58`：提取和渲染各持一套判据，结果「对比块凭空少了一个」而两边都不报错）。
 *
 * 本测试就是那道赔偿：**改了 CSS 没改这里，它必须红。**
 * 只靠注释里写「记得同步」是靠不住的 —— 那种约定没有牙齿。
 *
 * 【为什么钉的是 canvas / text / card 这三个令牌，不把整套令牌全钉一遍】
 * 前两个跨到了主进程（主进程读不到 CSS 变量，只能喂字面值）；
 * 第三个（card）**不是**跨进程值，但设置页的 `<input type="color">` 同样
 * 只能吃字面值（吃不了 `var()`），而它显示的必须是当前主题真实的底色 ——
 * 于是它也进了这张表，配同一套闸门（加它时把措辞从「两个令牌」改成现在这句，
 * 免得下一轮读注释的人以为规则被悄悄破坏了）。
 * 其余令牌依旧一个都不钉：没有任何消费方需要它们的字面值，抄一遍只会多一处漂移面。
 */

const CSS = readFileSync(
  join(__dirname, '..', '..', 'renderer', 'src', 'styles', 'tokens.css'),
  'utf8'
)

/**
 * 抠出某个主题下 `--mi-canvas` 的值。
 *
 * 【为什么先切块再找，而不是直接全文搜第一个 `--mi-canvas`】
 * 文件里那个名字出现两次（浅色块一次、深色块一次）。全文搜第一个的话，
 * **两个主题会拿到同一个值**，而下面的断言会「两个都等于浅色」——
 * 深色那半边等于没验。这正是本项目那类「假绿」的经典形状，所以按块切。
 */
function canvasOf(theme: string): string | undefined {
  const darkStart = CSS.indexOf(":root[data-theme='dark']")
  const block =
    theme === 'dark'
      ? CSS.slice(darkStart)
      : CSS.slice(CSS.indexOf(':root {'), darkStart)
  return /--mi-canvas:\s*([^;]+);/.exec(block)?.[1]?.trim()
}

/**
 * 抠出某个主题下 `--mi-text` 的值（符号色表钉它）。切块理由同 canvasOf。
 *
 * ⚠️ 正则里冒号**紧跟在 `text` 后面**：`--mi-text-2` / `--mi-text-3` 的冒号前
 * 还有 `-2`/`-3`，不会误命中。如果哪天把正则放宽成 `--mi-text[^:]*:`，
 * 就会悄悄拿错值 —— 那正是本文件开头说的「假绿」形状。
 */
function textOf(theme: string): string | undefined {
  const darkStart = CSS.indexOf(":root[data-theme='dark']")
  const block =
    theme === 'dark'
      ? CSS.slice(darkStart)
      : CSS.slice(CSS.indexOf(':root {'), darkStart)
  return /--mi-text:\s*([^;]+);/.exec(block)?.[1]?.trim()
}

/**
 * 抠出某个主题下 `--mi-card` 的值（面板底色表钉它）。切块理由同 canvasOf。
 *
 * ⚠️ 正则里冒号**紧跟在 `card` 后面**：`--mi-card-glass` 的冒号前还有 `-glass`、
 * `var(--mi-card)` 后面跟的是 `)`，都不会误命中。如果哪天把正则放宽成
 * `--mi-card[^:]*:`，就会悄悄拿错值 —— 那正是本文件开头说的「假绿」形状。
 */
function cardOf(theme: string): string | undefined {
  const darkStart = CSS.indexOf(":root[data-theme='dark']")
  const block =
    theme === 'dark'
      ? CSS.slice(darkStart)
      : CSS.slice(CSS.indexOf(':root {'), darkStart)
  return /--mi-card:\s*([^;]+);/.exec(block)?.[1]?.trim()
}

describe('窗口底色与设计令牌一致', () => {
  it('两个主题的 canvas 各自能读出来（防空匹配）', () => {
    // 先证明「测量本身有效」：正则一旦匹配不上会返回 undefined，
    // 而 undefined 和任何值比较都不会「碰巧通过」——但要是一路 undefined 下去，
    // 下面那条测试就成了「false === false」式的假绿。所以单独钉一刀。
    expect(canvasOf('light')).toMatch(/^#[0-9a-f]{6}$/)
    expect(canvasOf('dark')).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('两个主题的 canvas 不是同一个值（防切块没切开）', () => {
    expect(canvasOf('light')).not.toBe(canvasOf('dark'))
  })

  it('THEME_WINDOW_BG 逐字等于 tokens.css 的 --mi-canvas', () => {
    const actual = Object.fromEntries(
      THEME_NAMES.map((t) => [t, canvasOf(t)])
    )
    expect(THEME_WINDOW_BG).toEqual(actual)
  })

  it('主题名不认识时退回浅色，不吃 undefined', () => {
    expect(windowBgOf('dark')).toBe(THEME_WINDOW_BG.dark)
    // 直接喂一个合法类型之外的值，模拟配置里混进来的脏字符串。
    // 万一这里返回 undefined，BrowserWindow 会退回白色 —— 深色用户拖窗口看到白杠。
    expect(windowBgOf('sepia' as never)).toBe(THEME_WINDOW_BG.light)
  })
})

describe('顶栏按钮符号色与主文字色一致（2026-10-05 顶条玻璃化）', () => {
  it('两个主题的 --mi-text 各自能读出来（防空匹配）', () => {
    expect(textOf('light')).toMatch(/^#[0-9a-f]{6}$/)
    expect(textOf('dark')).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('两个主题的 --mi-text 不是同一个值（防切块没切开）', () => {
    expect(textOf('light')).not.toBe(textOf('dark'))
  })

  it('THEME_TITLE_SYMBOL 逐字等于 tokens.css 的 --mi-text', () => {
    const actual = Object.fromEntries(THEME_NAMES.map((t) => [t, textOf(t)]))
    expect(THEME_TITLE_SYMBOL).toEqual(actual)
  })

  it('titleSymbolColorOf 主题名不认识时退回浅色', () => {
    expect(titleSymbolColorOf('dark')).toBe(THEME_TITLE_SYMBOL.dark)
    expect(titleSymbolColorOf('sepia' as never)).toBe(THEME_TITLE_SYMBOL.light)
  })
})

describe('面板底色与设计令牌一致（2026-10-07 面板颜色个性化）', () => {
  it('两个主题的 --mi-card 各自能读出来（防空匹配）', () => {
    expect(cardOf('light')).toMatch(/^#[0-9a-f]{6}$/)
    expect(cardOf('dark')).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('两个主题的 --mi-card 不是同一个值（防切块没切开）', () => {
    expect(cardOf('light')).not.toBe(cardOf('dark'))
  })

  it('THEME_PANEL_BG 逐字等于 tokens.css 的 --mi-card', () => {
    const actual = Object.fromEntries(THEME_NAMES.map((t) => [t, cardOf(t)]))
    expect(THEME_PANEL_BG).toEqual(actual)
  })

  it('panelBgOf 主题名不认识时退回浅色', () => {
    expect(panelBgOf('dark')).toBe(THEME_PANEL_BG.dark)
    expect(panelBgOf('sepia' as never)).toBe(THEME_PANEL_BG.light)
  })
})
