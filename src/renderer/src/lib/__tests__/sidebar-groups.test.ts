import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { maskComments } from '../../../../shared/__tests__/mask-comments'
import { SIDEBAR } from '../copy'

/**
 * 模块一（全局 UI 布局重组）的静态判据 —— 契约 §一 判据 1/3/4 的可执行版：
 *
 *   ① 侧栏导航全集 = 16 项（review 的 v-if 另算）+ 三个组标题在场；
 *   ② 组归属与契约 §1.1 的表**逐项相等**（组内顺序也在内 —— 顺序就是产品决定）；
 *   ③ 三处 parity：侧栏整宽（三组 + 页脚）=== 侧栏 rail === 全屏菜单宫格，
 *      逐项同序。宫格那一处的顺序纪律从 P3 起就有，四分组轮把三处重新对齐。
 *
 * 【2026-10-09 三合一】签到并入总览（独立「每日签到」格三处同删，16 项）、
 * 三组 + 知识点组进手风琴（组头升 button + .group-body 开合）、状态块两枚徽记
 * 升 button（点击去设置页 ?card=pet）。手风琴的开合**逻辑**（路由→默认展开图 /
 * 存量归一化）在 lib/sidebar-nav.ts，单测在 sidebar-nav.test.ts；这里钉的是
 * 源码接线与样式纪律（含「开合动画禁用 opacity」—— wall-glass 快照件）。
 *
 * 【2026-10-10 IA 重构：知识点并进学习组】第 4 个手风琴组（lessons）撤销 ——
 * 主人裁定「点学习才看到语言、点知识点才看到课」反直觉。课列表 / N-M 计数 /
 * 阶段选择 / 阶段综合练习整块并进学习组内部；组数 4 → 3（.group-body 与
 * .group-arrow 各剩 3 个），课列表改 .lesson-scroll 内滚（原 .side-section.grow
 * 的 flex 药方随撤销的组一并删除）。导航 16 项与三处 parity 一概没动
 * （本次没有增删项；rail 那列本来就没有知识点组，一个字没改）。
 *
 * 【2026-10-10 主人批·图一：手风琴让位 + 学习组吃满】点组头改互斥口径
 * （开一组 = 收其它两组；点已开组 = 全收 —— 逻辑在 lib/sidebar-nav.ts 的
 * soloToggleGroup，单测在 sidebar-nav.test.ts）；学习组（.nav-group.grow）
 * 展开时吃满侧栏剩余高度，课列表的「max-height: 200px 内滚」旧口径撤销、
 * 改 flex 驱动 —— 新高度账（.nav-group / .nav-group.grow / .sec-lessons）
 * 的断言在下面「开合样式」那条 it。导航 16 项与三处 parity 依旧没动。
 *
 * 【为什么读源码文本，不挂载组件】本仓 vitest 跑在 node 环境、没装 vue 插件
 * （见 copy.test.ts / wall-glass.test.ts 的同一处境），.vue 文件进不来。
 * 所以照抄 copy.test.ts 的「读文件 + maskComments」套路 —— 本仓注释里写了
 * 大量和代码长得一模一样的示例，不剥注释，每条闸门都会被自己的说明文字绊倒。
 *
 * 【为什么断言「模板源文本里的 NAV 键序列」】三处 parity 的唯一漂移方式就是
 * 有人改了模板 / 数组的顺序 —— 源文本序列恰好就是它。键 → id 的映射
 * （NAV.PRACTICE → 'practice'）是机械的。⚠️ 别把「中文标题」写进这里：
 * 文案真源只有 copy.ts 一处（同 copy.test 的纪律，手抄一份会漂）。
 */

const SRC_DIR = join(__dirname, '..', '..')

const SIDEBAR_PATH = join(SRC_DIR, 'components', 'domain', 'Sidebar.vue')
const MENU_PATH = join(SRC_DIR, 'components', 'domain', 'FullscreenMenu.vue')
const APP_PATH = join(SRC_DIR, 'App.vue')
const OVERVIEW_PATH = join(SRC_DIR, 'views', 'OverviewView.vue')

const raw = (p: string): string => readFileSync(p, 'utf8')

/** 契约 §1.1 的规范顺序：三处 parity 的基准（设置殿后 = 底部工具区，无组标题） */
const CANON_ORDER = [
  'common',
  'c',
  'cpp',
  'java',
  'python', // 学习组：5 语言
  'practice',
  'playground',
  'memo',
  'review',
  'challenge',
  'favorites',
  'warehouse', // 复习与挑战组
  'overview',
  'leaderboard',
  'login', // 个人中心组（签到格 2026-10-09 并入总览，三处同删）
  'settings' // 工具区
]

/** 契约 §1.1 的三张组表（逐项，含组内顺序） */
const GROUP_LEARN_ITEMS = ['common', 'c', 'cpp', 'java', 'python', 'practice', 'playground', 'memo']
const GROUP_REVIEW_ITEMS = ['review', 'challenge', 'favorites', 'warehouse']
const GROUP_ME_ITEMS = ['overview', 'leaderboard', 'login']

/** 源码里找标记；找不到就当场红（别让 indexOf 的 -1 悄悄滑进切片里） */
function idxOrDie(src: string, marker: string, where: string): number {
  const i = src.indexOf(marker)
  expect(i, `${where} 里找不到标记：${marker}`).toBeGreaterThan(-1)
  return i
}

/** 取某条 CSS 规则的规则体（`选择器 {` 到下一个 `}`）；找不到给空串（断言会红） */
function ruleBody(src: string, selector: string): string {
  const i = src.indexOf(`${selector} {`)
  if (i === -1) return ''
  return src.slice(i, src.indexOf('}', i) + 1)
}

/**
 * 从 `['common', 'c', ...] as const` 这类字面量里抠语言表 —— 每处模板的
 * v-for 展开都用**该文件自己的**语言字面量：三处若语言顺序不一致，
 * 展开出来的序列就对不上 CANON，红。
 */
function parseLangs(src: string): string[] {
  const m = src.match(/\[\s*((?:'[a-z]+'\s*,?\s*)+)\]\s*(?:as const)?/)
  if (!m) return []
  return [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1])
}

/** 这一格是不是被 `v-if="settings.config.reviewEnabled"` 守着（往左找到最近的 `<`） */
function guardedByReview(slice: string, at: number): boolean {
  const lt = slice.lastIndexOf('<', at)
  return lt !== -1 && slice.slice(lt, at).includes('v-if="settings.config.reviewEnabled"')
}

describe('模块一 · 侧栏三组（§1.1）', () => {
  const sidebar = maskComments(raw(SIDEBAR_PATH))
  const langs = parseLangs(sidebar)

  // 三个组标题 + 页脚就是切片的分界（都断言其存在 —— 找不到时 idxOrDie 先红）；
  // 学习组切片现在同时罩着它内联的课列表（2026-10-10 IA 重构，见下面专门一条）。
  const iLearn = idxOrDie(sidebar, '{{ SIDEBAR.GROUP_LEARN }}', 'Sidebar.vue')
  const iReview = idxOrDie(sidebar, '{{ SIDEBAR.GROUP_REVIEW }}', 'Sidebar.vue')
  const iMe = idxOrDie(sidebar, '{{ SIDEBAR.GROUP_ME }}', 'Sidebar.vue')
  const iFooter = idxOrDie(sidebar, 'class="side-footer"', 'Sidebar.vue')
  const iTplEnd = idxOrDie(sidebar, '</template>', 'Sidebar.vue')

  const learnSlice = sidebar.slice(iLearn, iReview)
  const reviewSlice = sidebar.slice(iReview, iMe)
  const meSlice = sidebar.slice(iMe, iFooter)
  const footerSlice = sidebar.slice(iFooter, iTplEnd)

  /** 整宽态一段切片里的 NAV 键序列（v-for 展开成语言表） */
  function navIdsInSlice(slice: string): string[] {
    const out: string[] = []
    const re = /v-for="m in LEARN_MODULES"|\{\{\s*NAV\.([A-Z_]+)\s*\}\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(slice)) !== null) {
      if (m[1] === undefined) out.push(...langs)
      else out.push(m[1].toLowerCase())
    }
    return out
  }

  it('三组标题在场的两个前提：语言字面量可解析、copy 键非空', () => {
    expect(langs, `语言字面量解析失败或长度不对：${langs.join(',')}`).toEqual([
      'common',
      'c',
      'cpp',
      'java',
      'python'
    ])
    expect(SIDEBAR.GROUP_LEARN.length).toBeGreaterThan(0)
    expect(SIDEBAR.GROUP_REVIEW.length).toBeGreaterThan(0)
    expect(SIDEBAR.GROUP_ME.length).toBeGreaterThan(0)
  })

  it('组归属与契约表逐项相等（含组内顺序）', () => {
    expect(navIdsInSlice(learnSlice)).toEqual(GROUP_LEARN_ITEMS)
    expect(navIdsInSlice(reviewSlice)).toEqual(GROUP_REVIEW_ITEMS)
    expect(navIdsInSlice(meSlice)).toEqual(GROUP_ME_ITEMS)
    // 设置留在 .side-footer 原位、不设组标题
    expect(navIdsInSlice(footerSlice)).toEqual(['settings'])
  })

  it('学习组内联（2026-10-10 IA 重构）：阶段选择 + 知识点小标题（含 N/M 计数）+ 课列表 + 综合练习都在组内', () => {
    // 点「学习」一眼看全「语言 → 阶段 → 课」：这三样原先分属顶块与第 4 组，
    // 本轮全部并进学习组切片（learnSlice 的终点是 GROUP_REVIEW 标记）。
    expect(learnSlice).toContain('{{ SIDEBAR.STAGE_SELECT }}')
    expect(learnSlice).toContain('{{ SIDEBAR.LESSONS_TITLE }}')
    expect(learnSlice).toContain('class="lesson-scroll"')
    expect(learnSlice).toContain('class="lesson-list"')
    // N/M 计数（全侧栏唯一显示课程进度的地方）原地保留
    expect(learnSlice).toContain('content.activeLessons.filter((l) => l.hasContent).length')
    expect(learnSlice).toContain('{{ content.activeLessons.length }}')
    // 阶段综合练习跟着列表走（stageProgress 挂态、点击 openStagePaper）
    expect(learnSlice).toContain('stageProgress')
    expect(learnSlice).toContain('@click="openStagePaper"')
    // 「知识点」全侧栏只此一处（不再有独立的第 4 组小标题）
    expect((sidebar.match(/SIDEBAR\.LESSONS_TITLE/g) ?? []).length).toBe(1)
  })

  it('第 4 组「知识点」的折叠接线整个撤销（课列表跟学习组一起开合）', () => {
    expect(sidebar).not.toContain('openGroups.lessons')
    expect(sidebar).not.toContain("toggleGroup('lessons')")
    expect(sidebar).not.toContain('lessons-collapsed')
  })

  it('整宽态全集 = 16 项；review 是唯一条件项（挂在设置开关的 v-if 上）', () => {
    const full = [
      ...navIdsInSlice(learnSlice),
      ...navIdsInSlice(reviewSlice),
      ...navIdsInSlice(meSlice),
      ...navIdsInSlice(footerSlice)
    ]
    expect(full).toEqual(CANON_ORDER)
    expect(new Set(full).size).toBe(16)

    const at = reviewSlice.indexOf('{{ NAV.REVIEW }}')
    expect(at).toBeGreaterThan(-1)
    expect(guardedByReview(reviewSlice, at), '复习格没挂 v-if reviewEnabled').toBe(true)
  })

  it('rail 态：顺序与整宽态逐项相同（16 项）+ review 同一条 v-if', () => {
    const iRail = idxOrDie(sidebar, 'class="rail-col"', 'Sidebar.vue')
    const iElse = idxOrDie(sidebar, '<template v-else>', 'Sidebar.vue')
    const railSlice = sidebar.slice(iRail, iElse)

    const out: string[] = []
    const re = /v-for="m in LEARN_MODULES"|:title="NAV\.([A-Z_]+)"/g
    let m: RegExpExecArray | null
    while ((m = re.exec(railSlice)) !== null) {
      if (m[1] === undefined) out.push(...langs)
      else out.push(m[1].toLowerCase())
    }
    expect(out).toEqual(CANON_ORDER)

    const at = railSlice.indexOf(':title="NAV.REVIEW"')
    expect(at).toBeGreaterThan(-1)
    expect(guardedByReview(railSlice, at), 'rail 复习格没挂 v-if reviewEnabled').toBe(true)
  })

  it('全屏菜单宫格：顺序与侧栏两态逐项相同（16 项）+ 分组小节标题', () => {
    const menu = maskComments(raw(MENU_PATH))
    const iStart = idxOrDie(menu, 'const items = computed<MenuItem[]>(() => [', 'FullscreenMenu.vue')
    const iEnd = menu.indexOf('\n])', iStart)
    expect(iEnd, 'items computed 的收尾 `])` 没找到').toBeGreaterThan(iStart)
    const itemsSlice = menu.slice(iStart, iEnd)

    const menuLangs = parseLangs(menu)
    expect(menuLangs, `菜单里的语言字面量解析失败：${menuLangs.join(',')}`).toEqual([
      'common',
      'c',
      'cpp',
      'java',
      'python'
    ])

    const out: string[] = []
    const re = /\.\.\.LANGS\.map|pageItem\('([a-z]+)'/g
    let m: RegExpExecArray | null
    while ((m = re.exec(itemsSlice)) !== null) {
      if (m[1] === undefined) out.push(...menuLangs)
      else out.push(m[1])
    }
    expect(out).toEqual(CANON_ORDER)

    // 复习格同一判据（菜单里也是三元展开；关掉开关跟着少一格）
    expect(itemsSlice).toMatch(/\(settings\.config\.reviewEnabled\s*\?\s*\[pageItem\('review'/)

    // 小节标题：模板里真插了 full-span 行 + 样式是通栏
    expect(menu).toContain('class="fs-section"')
    expect(ruleBody(menu, '.fs-section')).toContain('grid-column: 1 / -1')
  })
})

describe('模块一 · 壳层接线（§1.2~§1.5）', () => {
  const sidebar = maskComments(raw(SIDEBAR_PATH))
  const app = maskComments(raw(APP_PATH))
  const overview = maskComments(raw(OVERVIEW_PATH))

  it('App.vue：旧 ⊞ 悬浮钮零残留（原始文本——注释里也不许留），新入口两处在', () => {
    // 原始文本而不是剥注释后的：不然「无 panel-toggle--menu」只能靠注释满足，
    // 等于没锚（layout.test.ts 的静态锚点注释记过同一条教训）。
    expect(raw(APP_PATH)).not.toContain('panel-toggle--menu')
    // 侧栏九点阵按钮 → App 的落点
    expect(app).toContain('@open-menu="openMenu"')
    // 全局 Ctrl+Shift+M（在既有 Ctrl+K 旁；输入框聚焦时不拦 —— 无冲突字母）
    expect(app).toContain("e.key.toLowerCase() === 'm'")
  })

  it('Sidebar：emit 契约、九点阵菜单钮、身份区、状态块都在', () => {
    expect(sidebar).toContain("defineEmits<{ 'open-menu': [] }>()")
    expect(sidebar).toContain("emit('open-menu')")
    // 九点阵是内联 SVG 3×3（不是 ⊞/田 字符）
    expect(sidebar).toContain('viewBox="0 0 18 18"')
    expect(sidebar).toContain('{{ SIDEBAR.MENU_BTN }}')
    expect(sidebar).toContain('SIDEBAR.MENU_BTN_TITLE')

    // 身份区（§1.2 → P10.6 接云账号）：头像 + 未登录/用户名；名字来自
    // account store（头像通道 P10.7 云头像回来时恢复，届时这里补回 avatar.ts 的锚点）
    expect(sidebar).toContain('class="identity"')
    expect(sidebar).toContain('SIDEBAR.IDENTITY_GUEST')
    expect(sidebar).toContain('useAccountStore')

    // 状态块（§1.5）：环 + ❤（档位色保留）+ 🍚（satiety 口径）
    expect(sidebar).toContain('class="status-block"')
    expect(sidebar).toContain('affectionTierClass')
    expect(sidebar).toContain('satietyText')

    // 状态规则透明化（2026-10-09）：徽记必须是 <button>（键盘党 Tab 停得上），
    // 悬停/读屏说明走 METER_GUIDE_TIP 拼串（既报读数、又报「可点」）。
    // 【2026-10-16 批④（V1-47）】第三枚「脸色」徽记加入 —— 主人裁定「确实需要
    // 常驻表现来体现好感度」。它守同一套规矩：<button> + 点击去设置页互动说明；
    // 悬停说明是 faceTip（= METER_GUIDE_TIP(MOOD_NAMES 整句)，自己已包好，
    // 见 Sidebar.vue 脚本段）。所以这里的计数从 2 升到 3 —— 数字再掉回 2
    // 说明脸色徽记被摘掉了，得先过主人那道裁定。
    const meters = sidebar.match(/<button\s+type="button"\s+class="meter"/g) ?? []
    expect(meters.length, '三枚徽记（❤/🍚/脸色）必须都是 <button>').toBe(3)
    expect(sidebar).toContain(':title="SIDEBAR.METER_GUIDE_TIP(affectionTip)"')
    expect(sidebar).toContain(':title="SIDEBAR.METER_GUIDE_TIP(satietyTip)"')
    expect(sidebar).toContain(':title="faceTip"')
    // 点它们 = 去设置页「大肥鱼互动规则」卡（?card=pet + at nonce；nonce 缺了
    // 在设置页里再点就静默不滚 —— 见 Sidebar.vue openPetGuide 注释）
    expect((sidebar.match(/@click="openPetGuide"/g) ?? []).length).toBe(3)
    expect(sidebar).toContain("path: '/settings'")
    expect(sidebar).toContain("card: 'pet'")
    expect(sidebar).toContain('at: String(Date.now())')

    // 签到（§1.4 → 模块三）：入口格已删（并入总览），未签圆点改挂总览格
    expect(sidebar).not.toContain('NAV.CHECKIN')
    expect(sidebar).not.toContain('NAV_ICON.CHECKIN')
    expect(sidebar).not.toContain("'/overview?card=checkin'")
    expect(sidebar).toContain('showCheckinDot')
    expect(sidebar).toContain('checkin-dot')
    expect(sidebar).toContain("router.push('/overview')")
  })

  it('Sidebar：手风琴接线（组头升 button、三组同开合、写口只有 store）', () => {
    // 三组组头各自绑 aria-expanded + toggleGroup（learn/review/me）
    for (const id of ['learn', 'review', 'me']) {
      expect(sidebar, `${id} 组头缺 aria-expanded`).toContain(`:aria-expanded="openGroups.${id}"`)
      expect(sidebar, `${id} 组头缺 toggle 接线`).toContain(`toggleGroup('${id}')`)
    }
    // 4 → 3（2026-10-10 IA 重构）：知识点不再是组，它的组体/箭头随撤销删除
    expect((sidebar.match(/class="group-body"/g) ?? []).length).toBe(3)
    expect((sidebar.match(/class="group-arrow"/g) ?? []).length).toBe(3)
    // 折叠态的唯一真源在 store（localStorage 版本键那条 doctrine），组件只算「生效图」
    expect(sidebar).toContain('useSidebarNavStore')
    // 【陈旧断言修复，2026-10-10】原来断言 'defaultOpenMap(route.name)'，但组件
    // 自 c90eea8 起就是把 route.name **收窄成 routeName** 再喂进去（symbol 路由名
    // 当"不认识"，见脚本段那两行注释）—— 这条断言从落地那天起就一直红着（文本
    // 里根本不含 route.name 这个拼法）。钉实际接线：
    expect(sidebar).toContain('defaultOpenMap(routeName.value)')
  })

  it('Sidebar：被替换掉的旧块真的没了（logo 区 / 两条状态行）', () => {
    expect(sidebar).not.toContain('class="logo"')
    expect(sidebar).not.toContain('logo-cat')
    expect(sidebar).not.toContain('progress-row')
    expect(sidebar).not.toContain('affection-row')
  })

  it('Sidebar：分组 / 分割线 / 圆点的样式按契约落到位', () => {
    expect(ruleBody(sidebar, '.nav-groups')).toContain('gap: 14px')
    expect(ruleBody(sidebar, '.group-title')).toContain('font-size: 11px')
    // 2026-10-10 主人批·图一：颜色从 --mi-text-3 升到 --mi-text-2（最淡档
    // 在玻璃底 + 壁纸稀释下掉到可读线以下；折叠头是导航，该用次强档）。
    // 这条 pin 随契约一起改 —— 改回去（或再往下调档）在这里红。
    expect(ruleBody(sidebar, '.group-title')).toContain('var(--mi-text-2)')
    expect(ruleBody(sidebar, '.group-title')).not.toContain('var(--mi-text-3)')
    expect(ruleBody(sidebar, '.rail-divider')).toContain('height: 1px')
    expect(ruleBody(sidebar, '.rail-divider')).toContain('var(--mi-border)')
    // 圆点 6px、右上角（模块三：Badge 挂总览格右上角）；颜色是 --mi-error-deep
    // （契约写的 --mi-accent 全库不存在，见 Sidebar.vue 该规则上的注释 ——
    // 这里把替换后的真值也钉住）
    expect(ruleBody(sidebar, '.checkin-dot')).toContain('6px')
    expect(ruleBody(sidebar, '.checkin-dot')).toContain('var(--mi-error-deep)')
    expect(ruleBody(sidebar, '.checkin-dot')).toContain('top: 2px')
  })

  it('Sidebar：手风琴开合样式（0fr↔1fr、禁 opacity、收起后不可 Tab）+ 学习组吃满的高度账', () => {
    const body = ruleBody(sidebar, '.group-body')
    expect(body).toContain('grid-template-rows: 1fr')
    expect(body).toContain('var(--mi-dur)')
    expect(ruleBody(sidebar, '.group-body.collapsed')).toContain('grid-template-rows: 0fr')
    const inner = ruleBody(sidebar, '.group-body-inner')
    expect(inner).toContain('overflow: hidden')
    // 收起后内容仍在 DOM：不许再被 Tab 摸到（invisible 元素不可聚焦）
    expect(ruleBody(sidebar, '.group-body.collapsed .group-body-inner')).toContain(
      'visibility: hidden'
    )
    // 开合动画禁用 opacity（wall-glass 快照件：全库 46 处钉死，一个都不许新增）
    expect(body).not.toContain('opacity')
    expect(inner).not.toContain('opacity')
    // 状态块按钮的悬停/焦点：只用蓝底与笔画环，同样不碰 opacity
    expect(ruleBody(sidebar, 'button.meter')).not.toContain('opacity')

    // ── 课列表的高度账（2026-10-10 主人批·图一重写）──────────────────────
    // 旧口径「max-height: 200px 内滚」整个撤销（主人嫌内嵌小滚轮）：新契约 =
    // 受 flex 链驱动、占满学习组剩余高度，子项过多时在这里内滚；横向必须
    // hidden（hover 的 2px 位移别闪出滚动条）；96px 是极端窗口的兜底下限。
    const scroll = ruleBody(sidebar, '.lesson-scroll')
    expect(scroll).not.toContain('max-height')
    expect(scroll).toContain('flex: 1')
    expect(scroll).toContain('min-height: 96px')
    expect(scroll).toContain('overflow-y: auto')
    expect(scroll).toContain('overflow-x: hidden')
    // 旧药方撤干净：全文件不再有 .side-section.grow（代码里；注释剥离后不计）
    expect(sidebar).not.toContain('.side-section.grow')

    // ── 学习组吃满剩余高度：四段新规则 + 模板接线（2026-10-10 主人批·图一）──
    // .nav-groups 让出可分配空间（flex:1），学习组（grow）才有高度可吃；
    // min-height:0 是各环放行收缩的通行证（否则矮窗口会被内容高顶爆）
    const groups = ruleBody(sidebar, '.nav-groups')
    expect(groups).toContain('flex: 1')
    expect(groups).toContain('min-height: 0')
    // 每组竖排 flex：组标题自然高、组体吃剩余
    const group = ruleBody(sidebar, '.nav-group')
    expect(group).toContain('display: flex')
    expect(group).toContain('flex-direction: column')
    expect(group).toContain('min-height: 0')
    // grow 只给学习组（复习/个人中心项少，拉伸只会多出空玻璃）
    const grow = ruleBody(sidebar, '.nav-group.grow')
    expect(grow).toContain('flex: 1')
    expect(grow).toContain('min-height: 0')
    // 组体跟着吃满；组体内竖排（同一件事在 .group-body-inner 原规则里钉）
    const growBody = ruleBody(sidebar, '.nav-group.grow .group-body')
    expect(growBody).toContain('flex: 1')
    expect(growBody).toContain('min-height: 0')
    expect(inner).toContain('display: flex')
    expect(inner).toContain('flex-direction: column')
    // 课列表那一节：小标题保持自然高，.lesson-scroll 吃剩余
    const secLessons = ruleBody(sidebar, '.nav-group.grow .sec-lessons')
    expect(secLessons).toContain('flex: 1')
    expect(secLessons).toContain('display: flex')
    expect(secLessons).toContain('flex-direction: column')
    // 模板接线：grow 的动态类只挂在学习组那个 div 上（class="nav-group" 字面量
    // 原样保留 —— 另有按串计数的闸门）；课列表那一节挂 sec-lessons
    expect(sidebar).toContain(':class="{ grow: openGroups.learn }"')
    expect(sidebar).toContain('class="side-section sec-lessons"')

    // 页脚钉底：原来靠 .side-section.grow 的 flex:1，现在靠 auto 外边距 + 最小间隔
    expect(ruleBody(sidebar, '.side-footer')).toContain('margin-top: auto')
    expect(ruleBody(sidebar, '.side-footer')).toContain('padding-top: 10px')
  })

  it('OverviewView：?card=checkin 直达 = 滚动 + 600ms 一次性高亮', () => {
    expect(overview).toContain('route.query.card')
    expect(overview).toContain("'.checkin-card'")
    expect(overview).toContain('scrollIntoView')
    expect(overview).toContain('animation: card-flash 0.6s')
    // 高亮只许动 box-shadow：全库 opacity 声明数是快照件（wall-glass.test.ts），
    // 本轮一个都不许新增 —— 动画也不行
    expect(ruleBody(overview, '.card-flash')).not.toContain('opacity')
  })

  it('OverviewView：未签引导（模块三）= 闪签到卡 + 聚焦按钮，且不抢显式深链', () => {
    // 显式 ?card= 深链优先：guideToCheckin 遇到 query.card 必须让路
    expect(overview).toContain("if (route.query.card) return")
    // 未签才引导（loaded 前不作数、签过不打扰）—— 视图写成守卫式提前 return，
    // 两个条件钉在同一行：少任何一个条件这里都红。
    expect(overview).toContain('if (!progress.loaded || progress.checkedInToday) return')
    expect(overview).toContain('flashCardAt')
    expect(overview).toContain("button:not([disabled])")
    expect(overview).toContain('focus({ preventScroll: true })')
    // 挂载跑一次 + 档案迟到时补一拍（冷启动 loaded 还是 false 的窗口）
    expect(overview).toContain('guideToCheckin()')
    expect(overview).toContain('() => progress.loaded')
  })
})
