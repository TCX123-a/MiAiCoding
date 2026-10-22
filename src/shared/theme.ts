/**
 * 主题相关的**跨进程**常量（窗口底色、顶栏按钮符号色），外加一张给设置页
 * 取色器用的**面板底色表**（THEME_PANEL_BG，2026-10-07 面板颜色个性化加入）。
 * 第三张表不是跨进程值，收进来的理由单独写在那张表的注释里 —— 别当成
 * 「这个文件就是跨进程专用的」而把它挪走，theme.test.ts 的闸门拴在它上面。
 *
 * 【为什么这个文件非存在不可】
 * 主题名本身在 `types.ts` 里（它是一份配置字段）。但「每个主题对应的**窗口底色**」
 * 只有主进程要用：`BrowserWindow` 的 `backgroundColor` 是**原生层**的东西，
 * 由 Chromium 在渲染进程还没来得及画之前直接刷上去。而主进程**读不到 CSS 变量**
 * —— `tokens.css` 里的 `--mi-canvas` 对它来说是一个不存在的字符串。
 *
 * 于是同一件事有了两个真源：CSS 一份、这里一份。**这是本项目最忌讳的形状**
 * （`md.ts:48-58` 记着一次真实事故就是「同一件事两个判据，出错了两边都不报」）。
 * 所以配了一条单测把两边钉死：`src/shared/__tests__/theme.test.ts` 会去读
 * `tokens.css`，把三个令牌逐一抠出来和这三张表逐字比对。**CSS 改了而这里没改，
 * 测试会红** —— 这比在注释里写一句「记得同步」可靠。
 */
import type { MiThemeName } from './types'

/**
 * 每个主题下窗口的底色 = `tokens.css` 里 `body` 用的那个 `--mi-canvas`。
 *
 * 【它到底在什么时候能被看见 —— 别指望它「防止白屏」】
 * 窗口是 `show: false` + `ready-to-show` 才显形的，所以**开屏那一下本来就看不见白屏**：
 * 等窗口显出来时，渲染进程早就把第一帧（含已经铺好的主题）画完了。
 *
 * 真正会用到它的是**调窗口大小的时候**：拖动边框变宽，新露出来的那一条区域
 * 在 Chromium 补上内容之前，是**由原生层直接刷底色的**。
 * 不设这个值，默认就是白色 —— 深色主题下拖一下窗口会出现白杠，
 * 一闪一闪的比静态配色不对更刺眼。**这才是本字段存在的唯一理由。**
 */
export const THEME_WINDOW_BG: Record<MiThemeName, string> = {
  light: '#edf2f8',
  dark: '#12171f'
}

/**
 * 取窗口底色。**主题名不认识时给浅色**，和 `config-migrate.ts` 的 `themeName()`
 * 是同一个退让方向：宁可显成浅的，也不要拿一个 undefined 去喂 `BrowserWindow`
 * （那会让原生层退回白色 —— 深色用户看到的就是一道白杠）。
 */
export function windowBgOf(theme: MiThemeName): string {
  return THEME_WINDOW_BG[theme] ?? THEME_WINDOW_BG.light
}

/**
 * 每个主题下 **Window Controls Overlay 按钮符号**（最小化 / 最大化 / 关闭）
 * 的颜色 —— `titleBarOverlay.symbolColor` 的取值（2026-10-05 顶条玻璃化）。
 *
 * 和 THEME_WINDOW_BG 是同一类东西：那三个按钮是系统画的，不认 CSS 变量，
 * 主进程只能喂一个颜色过去。取值 = `tokens.css` 里两套 `--mi-text` ——
 * 顶条标题文字用的就是它，按钮符号和标题并排，跟着文字走最自然。
 * 这份对应关系由 `theme.test.ts` 一并钉在 tokens.css 上（改了 CSS 没改这里会红）。
 */
export const THEME_TITLE_SYMBOL: Record<MiThemeName, string> = {
  light: '#3a4756',
  dark: '#b6c1d0'
}

/**
 * 取顶栏按钮符号色。**主题名不认识时给浅色** —— 和 `windowBgOf` 同一个退让
 * 方向：宁可显成浅的，也不要拿一个 undefined 去喂 `setTitleBarOverlay`
 * （喂了会静默不生效，深色主题下按钮符号停在系统默认色）。
 */
export function titleSymbolColorOf(theme: MiThemeName): string {
  return THEME_TITLE_SYMBOL[theme] ?? THEME_TITLE_SYMBOL.light
}

/**
 * 每个主题下 **UI 面板的底色**（`tokens.css` 的 `--mi-card`）—— 设置页取色器的
 * 「当前主题默认色」（2026-10-07 面板颜色个性化）。
 *
 * 【为什么前两张表是跨进程的，这一张却收进来】
 * 这一张**不是**跨进程值：它只在渲染层用，多写一份本来正是「同一件事两个真源」
 * 的形状。收它的理由只有一个 —— `<input type="color">` 的 value 只能吃具体的
 * `#rrggbb` 字符串（吃不了 `var(--mi-card)`），而取色器在「用户没有覆盖色」时
 * 必须显示**当前主题真实的底色**（显示错了，用户会以为默认色就是那个错的）。
 * 代价用和上面两张表**同款的闸门**抹平：theme.test.ts 把这张表逐字钉在
 * tokens.css 的 `--mi-card` 上 —— 改了 CSS 没改这里，测试红。
 * （除这三张表外，其余令牌依旧一份都不抄：没有消费方需要它们的字面值，
 * 抄一遍只会多一处会走散的真源。）
 */
export const THEME_PANEL_BG: Record<MiThemeName, string> = {
  light: '#fbfdff',
  dark: '#19202a'
}

/**
 * 取面板底色默认值。**主题名不认识时给浅色** —— 同 windowBgOf 的退让方向：
 * 取色器宁可显示浅色的默认，也不要拿 undefined 去喂 `input[type=color]`
 * （那会静默变成黑色 #000000，用户看到的「默认色」就是错的）。
 */
export function panelBgOf(theme: MiThemeName): string {
  return THEME_PANEL_BG[theme] ?? THEME_PANEL_BG.light
}
