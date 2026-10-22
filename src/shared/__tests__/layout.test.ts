/**
 * 三栏布局的尺寸换算（src/shared/layout.ts）
 *
 * 【这个文件在守什么】
 * 守的是**用户亲手拖出来的那个宽度**。它坏掉的方式全是静默的，一句报错都不会有：
 *
 *   1. **收起任一栏顺手把宽度改写了**。splitpanes 在增删 pane 之后会补发一次
 *      `resized`，那是它内部的重排、不是用户拖的。不把这两种分清楚，
 *      用户每开合一次面板，宽度就被悄悄改一次 —— 而他从没碰过分隔条。
 *   2. **老配置文件里没有 layout 这一节**（它是后加的字段，`config.json` 早就在了）。
 *      少了兜底，升级后第一次启动就是白屏，而且开发机（配置是新的）永远复现不了。
 *   3. **NaN 落盘**。它能穿过 `Math.min(Math.max(...))`（和谁比都是 false），
 *      写进文件之后 `width: NaN%` 让那一栏直接塌成 0 —— 而配置已经改不回来了。
 *   4. **把「拖窄收起」误判成「双击最大化」**（2026-10-04 加，见下面折叠组）。
 *      splitpanes 双击分隔条发出的载荷与「真把某一栏拖到 ≤10 松手」在载荷层面
 *      **一模一样**；分界线是 App.vue 上那行 `:maximize-panes="false"`，
 *      在末尾钉成静态锚点 —— 谁改它，测试先红。
 *   5. **键盘方向键误触发折叠**（2026-10-04 复核加）。splitpanes 的键盘调整
 *      是「一次真拖拽」：载荷与鼠标同形。但预告（.is-fold-hint）依赖拖动是
 *      连续过程，键盘一下里 resize+resized 同同步任务连发、预告挂上即摘 ——
 *      等于无预警整个消失。折叠只属于鼠标/触摸，键盘走普通宽度路径。
 *   6. **左栏收起后右桥的 index 从 1 变成 0**（2026-10-04 左栏折叠加）。
 *      桥的序号是 splitpanes 按**在场**栏目现算的（splitter i 夹在 panes[i]
 *      与 panes[i+1] 之间）；`index === 1` 这种「固定身份」在左栏一收起就失效 ——
 *      折叠右栏的能力会整个消失，而且不报错。判身份必须结合开关
 *      （foldIntentFromResize），下面有专钉这个回归的用例。
 *   7. **rail 期把左栏宽度改写了**（v18 加）。rail 是**标志不是宽度** ——
 *      用户拖出来的 sidebarSize 必须原样留着（展开时回来）。rail 期的左栏
 *      pane 被钉成 RAIL_SIZE（4.2%），键盘调整之类能触达写盘路径的载荷
 *      会把 4.2 当「用户拖出来的宽度」存下去；而 rail 期间右栏的拖拽照旧
 *      要能存 —— 所以那条防线只包左栏分支，绝不能一刀切停掉整个持久化。
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAYOUT,
  foldIntentFromResize,
  layoutPatchFromResize,
  mainSizeOf,
  MAIN_MIN_SIZE,
  normalizeLayout,
  RAIL_SIZE,
  RIGHT_PANEL_COLLAPSE_SIZE,
  RIGHT_PANEL_MAX_SIZE,
  RIGHT_PANEL_MIN_SIZE,
  RIGHT_PANEL_STORE_MIN_SIZE,
  SIDEBAR_COLLAPSE_SIZE,
  SIDEBAR_HIDE_SIZE,
  SIDEBAR_MAX_SIZE,
  SIDEBAR_MIN_SIZE,
  SIDEBAR_STORE_MIN_SIZE,
  sidebarModeOf,
  sidebarPaneSizeOf,
  sidebarTogglePatch,
  type LayoutConfig
} from '../layout'
import { maskComments } from './mask-comments'

const at = (o: Partial<LayoutConfig> = {}): LayoutConfig => ({ ...DEFAULT_LAYOUT, ...o })

/** 「用户真的拖了一下」—— 载荷里带 `event` */
const dragged = (...sizes: number[]) => ({ event: {}, panes: sizes.map((size) => ({ size })) })

/**
 * 「splitpanes 因为增删 pane 自己重排了一次」—— **没有 `event`**。
 * 这不是我编的：splitpanes 自己的 index.d.ts 在 `SplitpanesResizedPayload` 上写着
 * 「resized fires both during splitter drag-end AND after pane add/remove —
 *   in the latter cases event/index/prevPane/nextPane are absent」。
 */
const reflowed = (...sizes: number[]) => ({ panes: sizes.map((size) => ({ size })) })

// ---------------------------------------------------------------- 最要紧的一条

describe('增删 pane 引起的那次 resized **不算数**', () => {
  it('**收起任一栏（三栏变两栏）→ 什么都不存**', () => {
    // 这是整个功能里最容易写错、也最难被发现的一处：
    // splitpanes 把收起来的栏腾出来的空间重分给了还站着的栏，于是它报上来的
    // 左栏尺寸会比用户设定的大一截。照着存下去，用户**每收起一次面板、
    // 左栏就被永久撑宽一点**，而他从没碰过分隔条。
    expect(layoutPatchFromResize(reflowed(23.1, 76.9), at({ sidebarSize: 18 }))).toBeNull()
  })

  it('**展开任一栏（两栏变三栏）→ 什么都不存**', () => {
    expect(layoutPatchFromResize(reflowed(18, 60, 22), at({ sidebarSize: 18 }))).toBeNull()
  })

  it('反向验证：**真拖拽不会被这条规矩误伤**（不然它就成了「永远不存」）', () => {
    // 少了这一条，上面两条光靠「什么都不存」也能绿 ——
    // 而那等于整个持久化功能根本没接上。
    expect(layoutPatchFromResize(dragged(23.1, 54.9, 22), at({ sidebarSize: 18 }))).toEqual({
      sidebarSize: 23.1
    })
  })
})

// ---------------------------------------------------------------- 真拖拽

describe('真拖拽：存变了的那个，不存没变的那个', () => {
  it('只拖左栏 → 只存左栏', () => {
    expect(layoutPatchFromResize(dragged(24, 54, 22), at())).toEqual({ sidebarSize: 24 })
  })

  it('只拖右栏 → 只存右栏（别顺手把左栏也写一遍）', () => {
    expect(layoutPatchFromResize(dragged(18, 54, 28), at())).toEqual({ rightPanelSize: 28 })
  })

  it('两边都被挤动了（pushOtherPanes）→ 两个一起存', () => {
    expect(layoutPatchFromResize(dragged(25, 50, 25), at())).toEqual({
      sidebarSize: 25,
      rightPanelSize: 25
    })
  })

  it('**右栏收着时拖左栏（只有两栏）→ 只存左栏，右栏宽度原封不动**', () => {
    // 右栏收起来时 `panes` 里根本没有第三项。这时候要是去读 `panes[2].size`
    // 就是一个 undefined，顺手存下去等于把用户拖好的右栏宽度抹了。
    expect(
      layoutPatchFromResize(dragged(26, 74), at({ rightPanelSize: 30, rightPanelOpen: false }))
    ).toEqual({ sidebarSize: 26 })
  })

  it('**左栏收着时拖右桥（只有两栏）→ 宽度落在 panes[末位]，绝不读成左栏宽度**', () => {
    // 左栏收着时 panes[0] 是**主区**。照旧「按固定下标读第 0 格」的写法，
    // 会把主区宽度存成 sidebarSize —— 用户哪天点开左栏，它以主区的宽度蹦出来，
    // 而他从没拖过左栏。这一条钉的就是「按开关定角色」。
    const patch = layoutPatchFromResize(
      { ...dragged(65, 25), index: 0 },
      at({ sidebarOpen: false, rightPanelSize: 22 })
    )
    expect(patch).toEqual({ rightPanelSize: 25 })
    expect(patch).not.toHaveProperty('sidebarSize')
  })
})

// ---------------------------------------------------------------- 白写盘

describe('没必要写的就不写（写盘是整份配置重写）', () => {
  it('**拖回原位 → 什么都不存**（浮点差一点点不算改）', () => {
    expect(layoutPatchFromResize(dragged(18.3, 59.7, 22), at())).toBeNull()
  })

  it('四舍五入之后一样就不存；一旦对不上就存', () => {
    expect(layoutPatchFromResize(dragged(18.4, 59.6, 22), at())).toBeNull()
    expect(layoutPatchFromResize(dragged(18.6, 59.4, 22), at())).toEqual({ sidebarSize: 18.6 })
  })

  it('右栏收着、左栏也没动 → 什么都不存', () => {
    expect(layoutPatchFromResize(dragged(18, 82), at({ rightPanelOpen: false }))).toBeNull()
  })
})

describe('载荷本身是坏的 → 宁可什么都不存', () => {
  it.each([
    ['一栏都没有', dragged()],
    ['size 是 NaN', dragged(Number.NaN, 60, 22)],
    ['size 是 undefined', { event: {}, panes: [{ size: undefined }] } as never],
    ['size 是字符串', { event: {}, panes: [{ size: '20' }, { size: 60 }, { size: 20 }] } as never],
    ['panes 不是数组', { event: {}, panes: null } as never]
  ])('%s → null（不抛错、不写盘）', (_name, payload) => {
    // 一条拖拽写坏了不该把整个界面带崩 —— 而且崩溃发生在 mouseup、
    // 用户只会看到「拖了一下，白屏了」。
    expect(() => layoutPatchFromResize(payload as never, at())).not.toThrow()
    expect(layoutPatchFromResize(payload as never, at())).toBeNull()
  })

  it.each([
    ['两栏载荷但两栏都开着（增删过渡的半拍）', dragged(23, 77), at()],
    ['三栏载荷但左栏收着', dragged(18, 60, 22), at({ sidebarOpen: false })],
    ['三栏载荷但右栏收着', dragged(18, 60, 22), at({ rightPanelOpen: false })]
  ])('形状和开关推算的对不上：%s → null', (_name, payload, current) => {
    // 「哪一格是谁」是按开关推的。形状对不上的那一刻（正在增删 pane 的
    // 半拍里），宁可不猜 —— 猜错的代价是把别人的宽度存进这一栏。
    expect(layoutPatchFromResize(payload as never, current)).toBeNull()
  })
})

// ---------------------------------------------------------------- 老配置兜底

describe('normalizeLayout：老配置文件里没有这一节', () => {
  it('**整节是 undefined → 补齐默认值**', () => {
    // 主人机器上的 config.json 是加 layout 之前写下的。json-store 的 read()
    // 只在「整个文件不存在」时返回 null，**不做字段级兜底** —— 所以这里拿到的
    // 就是 undefined。少了这一步，升级后第一次启动就是白屏。
    expect(normalizeLayout(undefined)).toEqual(DEFAULT_LAYOUT)
  })

  it.each([
    ['null', null],
    ['字符串', 'layout'],
    ['数字', 42],
    ['数组', []],
    ['布尔', true]
  ])('整节是 %s → 也补齐默认值，不抛错', (_name, junk) => {
    expect(() => normalizeLayout(junk)).not.toThrow()
    expect(normalizeLayout(junk)).toEqual(DEFAULT_LAYOUT)
  })

  it('只缺其中一两个字段 → 缺的补上，有的保住', () => {
    expect(normalizeLayout({ sidebarSize: 25 })).toEqual({ ...DEFAULT_LAYOUT, sidebarSize: 25 })
    expect(normalizeLayout({ sidebarOpen: false })).toEqual({ ...DEFAULT_LAYOUT, sidebarOpen: false })
    expect(normalizeLayout({ rightPanelOpen: false })).toEqual({ ...DEFAULT_LAYOUT, rightPanelOpen: false })
  })

  it('**两个 Open 丢了都补成 true**，不是 false', () => {
    // 补成 false 的话，用户升级完打开软件会发现面板没了 ——
    // 而面板本身没有任何「被关掉过」的痕迹，他不知道怎么找回来。
    expect(normalizeLayout({}).rightPanelOpen).toBe(true)
    expect(normalizeLayout({}).sidebarOpen).toBe(true)
  })

  it('**sidebarRail 丢了补成 false**（方向与两个 Open 相反，v18）', () => {
    // 两个 Open 补 true 是「别替用户关掉面板」；rail 补 false 是「别替用户
    // 收成图标栏」—— 补 true 的话老配置升级第一眼就是一条 50px 的窄排，
    // 用户从没按过 ☰。老配置（v17 及以前）里根本没有这个键，全是这条路。
    expect(normalizeLayout({}).sidebarRail).toBe(false)
    expect(normalizeLayout({ sidebarSize: 25 }).sidebarRail).toBe(false)
  })
})

describe('normalizeLayout：越界与脏数据在写盘前被钳住', () => {
  it.each([
    ['比上限还大', 999, SIDEBAR_MAX_SIZE],
    ['比落盘下限还小', -5, SIDEBAR_STORE_MIN_SIZE],
    ['刚好卡在上限', SIDEBAR_MAX_SIZE, SIDEBAR_MAX_SIZE],
    ['恰好落在落盘下限', SIDEBAR_STORE_MIN_SIZE, SIDEBAR_STORE_MIN_SIZE],
    ['中间值原样保留', 21.5, 21.5]
  ])('sidebarSize %s → %s', (_name, input, want) => {
    expect(normalizeLayout({ sidebarSize: input }).sidebarSize).toBe(want)
  })

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['字符串', '20'],
    ['null', null],
    ['空对象', {}]
  ])('sidebarSize 是 %s → 退回默认，**不是写进文件**', (_name, input) => {
    // NaN 特别要点名：`Math.min(Math.max(NaN, 11), 32)` 结果是 NaN，
    // 于是被原样写进配置，之后 `width: NaN%` 让那一栏塌成 0。
    // 同一个坑 runTimeoutSec 那边已经踩过一次，这里照同一套规矩防。
    expect(normalizeLayout({ sidebarSize: input }).sidebarSize).toBe(DEFAULT_LAYOUT.sidebarSize)
  })

  it('右栏宽度走的是**同一道**钳位，不是只防了左栏', () => {
    expect(normalizeLayout({ rightPanelSize: 999 }).rightPanelSize).toBe(RIGHT_PANEL_MAX_SIZE)
    expect(normalizeLayout({ rightPanelSize: Number.NaN }).rightPanelSize).toBe(
      DEFAULT_LAYOUT.rightPanelSize
    )
  })

  it.each([['yes'], [0], [1], [null], [undefined], ['']])(
    'rightPanelOpen 是 %s → 退回默认，**不是被当成 false**',
    (junk) => {
      // 「当成 false」的话，一次数据意外就把右栏静默关掉了，
      // 用户下次打开只看到面板没了，完全不知道跟升级有关。
      expect(normalizeLayout({ rightPanelOpen: junk }).rightPanelOpen).toBe(DEFAULT_LAYOUT.rightPanelOpen)
    }
  )

  it.each([['yes'], [0], [1], [null], [undefined], ['']])(
    'sidebarOpen 是 %s → 退回默认，**不是被当成 false**（和右栏同方向）',
    (junk) => {
      expect(normalizeLayout({ sidebarOpen: junk }).sidebarOpen).toBe(DEFAULT_LAYOUT.sidebarOpen)
    }
  )
})

describe('normalizeLayout：sidebarRail 的读写口钳位（v18 三态）', () => {
  it('true + 左栏开着 → 原样留住（用户亲手按出来的形态）', () => {
    expect(normalizeLayout({ sidebarRail: true, sidebarOpen: true }).sidebarRail).toBe(true)
  })

  it('**true 但左栏收着 → 钳回 false**（第四种组合：收起与窄栏互斥）', () => {
    // 合法组合只有三种（open / rail / hidden）。「open:false + rail:true」是
    // 读不出来的第四种 —— 收起优先，rail 归零。手改配置、旧版残留、
    // 意外写入都可能造出这个组合。
    expect(normalizeLayout({ sidebarRail: true, sidebarOpen: false }).sidebarRail).toBe(false)
  })

  it.each([['yes'], [1], [0], ['true'], [null], [undefined], ['']])(
    'sidebarRail 是 %s → 回 false，**不是回 true**（方向与两个 Open 相反）',
    (junk) => {
      // false 是「正常宽度的左栏」，落回它不藏任何东西；true 是「只剩一排
      // 图标」，不该从脏数据里推断出来。`=== true` 的写法同时挡掉 1 / 'yes'
      // 这类「看着像真」的杂值。
      expect(normalizeLayout({ sidebarRail: junk }).sidebarRail).toBe(false)
    }
  )

  it('rail 期 sidebarSize 原样保留 —— rail 是标志，钳位别顺手改写它', () => {
    // 展开时要原样回来，靠的就是这个宽度在 rail 期间没被动过。
    expect(normalizeLayout({ sidebarRail: true, sidebarOpen: true, sidebarSize: 27 }).sidebarSize).toBe(27)
  })
})

describe('normalizeLayout 是幂等的、也不碰共享常量', () => {
  it('**归一化两次和一次结果一样** —— 拖来拖去不会越存越偏', () => {
    const once = normalizeLayout({
      sidebarSize: 999,
      sidebarOpen: false,
      sidebarRail: true, // 脏组合（收起 + rail）：第一次归一就该钳掉
      rightPanelSize: 21.4,
      rightPanelOpen: false
    })
    expect(normalizeLayout(once)).toEqual(once)
    // 合法的 rail 组合同样幂等（别把留着的那位 normalize 掉）
    const legit = normalizeLayout({
      sidebarSize: 18,
      sidebarOpen: true,
      sidebarRail: true,
      rightPanelSize: 22,
      rightPanelOpen: true
    })
    expect(normalizeLayout(legit)).toEqual(legit)
  })

  it('**返回的是新对象，不是 DEFAULT_LAYOUT 本身**', () => {
    // 直接返回共享常量的话，调用方哪天原地改一下，默认值就跟着变了 ——
    // 而且是全局的、跨测试的。
    const a = normalizeLayout(undefined)
    expect(a).not.toBe(DEFAULT_LAYOUT)
    a.sidebarSize = 30
    expect(DEFAULT_LAYOUT.sidebarSize).toBe(18)
  })
})

// ---------------------------------------------------------------- 主区的尺寸
/**
 * 这一组守的是**「在场各栏的 size 加起来正好 100」**（收起的那栏不参与）。
 *
 * 为什么它值得单独一组：splitpanes 内部唯一会改动尺寸的是
 *   `readjustSizes(leftToAllocate, …)`
 * 而它**只在总和 ≠ 100 时**才被调用。也就是说这条等式一破，每走一次重排
 * （收起/展开任一栏就是一次）它就把差额平摊给每一栏，用户眼看着宽度越变越窄。
 *
 * 【这条曾经是怎么破的，两个坑都实测踩过】
 *   1. 主区留空不写 size。以为「没指定尺寸的那一栏会分到剩下的空间」，但 pane.vue 对
 *      没写 size 的栏取默认值 0 之后会**向上钳到 min-size** —— 于是主区带着 32 而不是 0
 *      参与首轮分配，三栏只有 72，readjustSizes 把每栏都平移了 9.33%：
 *      18/60/22 变成 27.33/41.33/31.33。
 *   2. 干脆不给主区设下限（min-size=0）让留空这一招成立。首轮分配是对了，但
 *      `equalizeAfterAddOrRemove` 要读 pane 的 `givenSize`，而 **givenSize 只在挂载那一刻
 *      取一次、之后永不更新**。用户拖过一次它就过期，差额在每次开合面板时被平摊 ——
 *      实测来回一趟左栏少 58px，配置里还一个字都没变（所以光看配置文件发现不了）。
 *
 * 结论：**主区也必须显式给 size，而且是 100 减去在场的那两栏**（mainSizeOf）。
 * 下面的用例就是在验这个减法在整个合法区间里都成立 —— 开关 × rail 的所有
 * 组合全走一遍（rail 期左栏以钉死的 RAIL_SIZE 参与，不是存下来的宽度）。
 */
describe('主区的尺寸：在场各栏加起来必须正好 100', () => {
  it('**收起右栏时主区拿到右栏让出来的每一分**', () => {
    expect(mainSizeOf(at({ sidebarSize: 20, rightPanelSize: 25, rightPanelOpen: false }))).toBe(80)
  })

  it('**收起左栏时同理**（2026-10-04 左栏折叠加）', () => {
    expect(mainSizeOf(at({ sidebarSize: 20, rightPanelSize: 25, sidebarOpen: false }))).toBe(75)
  })

  it('**展开右栏时右栏原样还回去，主区不多不少**', () => {
    expect(mainSizeOf(at({ sidebarSize: 20, rightPanelSize: 25, rightPanelOpen: true }))).toBe(55)
  })

  it('**遍历整个合法区间 × 开关 × rail：在场各栏永远正好 100**', () => {
    // 不抽查几个点，而是把区间走一遍 —— 这条等式一破就是「宽度自己越变越窄」，
    // 而且不会报任何错，靠抽查撞不上。起点用 SIDEBAR_MIN_SIZE（拖拽下限 0）：
    // 拖拽途中的任何值也在这个范围内。
    for (let side = SIDEBAR_MIN_SIZE; side <= SIDEBAR_MAX_SIZE; side++) {
      for (let right = RIGHT_PANEL_MIN_SIZE; right <= RIGHT_PANEL_MAX_SIZE; right++) {
        for (const sOpen of [true, false]) {
          for (const sRail of [true, false]) {
            for (const rOpen of [true, false]) {
              const l = at({
                sidebarSize: side,
                sidebarOpen: sOpen,
                sidebarRail: sRail,
                rightPanelSize: right,
                rightPanelOpen: rOpen
              })
              // 左栏以**此刻在场的宽度**参与：rail 期是 RAIL_SIZE，其余是存值
              const leftNow = sOpen ? sidebarPaneSizeOf(l) : 0
              expect(leftNow + mainSizeOf(l) + (rOpen ? right : 0)).toBe(100)
            }
          }
        }
      }
    }
  })

  it('**rail 期左栏以 RAIL_SIZE 参与**，存的宽度不参与减法（展开时原样回来）', () => {
    // sidebarSize 存了 30 也一样：此刻在场的是 4.2% 那条图标栏。
    // 落盘与渲染两条口径分家就分在这一处（见 sidebarPaneSizeOf 的注释）。
    expect(sidebarPaneSizeOf(at({ sidebarSize: 30, sidebarRail: true }))).toBe(RAIL_SIZE)
    expect(mainSizeOf(at({ sidebarSize: 30, sidebarRail: true }))).toBe(100 - RAIL_SIZE - 22)
  })

  it('sidebarPaneSizeOf：非 rail 时原样返回 sidebarSize（渲染口径 = 落盘口径）', () => {
    expect(sidebarPaneSizeOf(at({ sidebarSize: 21.5 }))).toBe(21.5)
  })

  it('**遍历整个合法区间：主区永远不窄于下限**', () => {
    // 主区自己没设下限，靠的是左右两栏的上限 —— 这条就是那个「靠」字落到实处的地方。
    for (let side = SIDEBAR_MIN_SIZE; side <= SIDEBAR_MAX_SIZE; side++) {
      for (let right = RIGHT_PANEL_MIN_SIZE; right <= RIGHT_PANEL_MAX_SIZE; right++) {
        for (const sOpen of [true, false]) {
          for (const sRail of [true, false]) {
            for (const rOpen of [true, false]) {
              const l = at({
                sidebarSize: side,
                sidebarOpen: sOpen,
                sidebarRail: sRail,
                rightPanelSize: right,
                rightPanelOpen: rOpen
              })
              expect(mainSizeOf(l)).toBeGreaterThanOrEqual(MAIN_MIN_SIZE)
            }
          }
        }
      }
    }
  })

  it('左栏最大 + 右栏最大 + 主区最小 ≤ 100 —— 上面那条的底气', () => {
    // 两边同时拖到头，主区还剩 100 - 32 - 32 = 36。以后谁要调大这两个上限，这里先红。
    expect(SIDEBAR_MAX_SIZE + RIGHT_PANEL_MAX_SIZE + MAIN_MIN_SIZE).toBeLessThanOrEqual(100)
  })

  it('默认布局也满足同一条（别把默认值定到栏杆外面去）', () => {
    expect(mainSizeOf(DEFAULT_LAYOUT)).toBeGreaterThanOrEqual(MAIN_MIN_SIZE)
    expect(DEFAULT_LAYOUT.sidebarSize + mainSizeOf(DEFAULT_LAYOUT) + DEFAULT_LAYOUT.rightPanelSize).toBe(100)
  })

  it('归一化之后仍然满足（脏配置进来也不能把等式撑破）', () => {
    for (const junk of [
      undefined,
      {},
      { sidebarSize: 999, rightPanelSize: -50 },
      { sidebarSize: NaN },
      { sidebarRail: true }, // 脏组合：只有 rail 没有 open
      { sidebarRail: true, sidebarOpen: true, sidebarSize: 999 }
    ]) {
      const l = normalizeLayout(junk)
      expect(
        (l.sidebarOpen ? sidebarPaneSizeOf(l) : 0) +
          mainSizeOf(l) +
          (l.rightPanelOpen ? l.rightPanelSize : 0)
      ).toBe(100)
      expect(mainSizeOf(l)).toBeGreaterThanOrEqual(MAIN_MIN_SIZE)
    }
  })
})

// ---------------------------------------------------------------- 拖到极窄 ⇒ 折叠
/**
 * 2026-10-04 主人口径：任一栏拖到极窄**松手即折叠**（›‹ 按钮开回来，宽度保留）。
 * 拖拽下限因此从 16/14 放到 0 —— 旧下限就是主人实测里「卡在固定位置拖不动」的那个位置。
 *
 * v18 起左栏分成**两个去向**（三态循环的中间态，见 sidebarTogglePatch）：
 * 拖到 ≤10 是「收成图标窄栏」（rail），拖到贴墙（≤0.5）才是「整个隐藏」；
 * 右栏没有 rail 档，≤10 一律折叠 —— 下面左右不再逐条对称，各测各的。
 *
 * 【这一组守的是六条线，每条都对应一种静默坏法】
 *   ① **只翻标志、不写宽度**。折叠/收栏对「开回来」必须是无损的：patch 里混进
 *      sidebarSize/rightPanelSize，用户点按钮展开时那一栏就是一条缝，而他没拖过第二下。
 *   ② **「拖窄」与「拖的是哪根桥」的区分**。只看 size 会把「拖右桥时左栏本来就窄」
 *      误判成折叠 —— 用户只是想调右栏，左栏却没了。
 *   ③ **与双击载荷的不可区分性**（载荷层面）。唯一防线是 App.vue 关掉
 *      maximize-panes，那条在末尾钉成静态锚点，别处没有任何东西挡得住。
 *   ④ **键盘方向键不触发折叠**。键盘调整被 splitpanes 实现成一次真拖拽、
 *      载荷与鼠标同形，但预告在屏幕上画不出来（同同步任务连发）——
 *      折叠这个手势只属于鼠标/触摸。
 *   ⑤ **桥的身份随开关漂移**。左右都在场时左桥 0、右桥 1；左栏一收起，
 *      右桥顶到 0。判身份只认数字（旧版的 index===1）会在那一刻静默报废。
 *   ⑥ **rail 期的载荷把 4.2 当宽度存下去**（v18 加）。rail 期左栏被钉成
 *      RAIL_SIZE，它没有「用户拖出来的宽度」；键盘调整之类触达写盘路径的
 *      载荷必须整支跳过 —— 但**只跳左栏那一支**，右栏照旧能拖能存。
 */
describe('拖到极窄松手 ⇒ 落进更少的一态（只翻标志，不动宽度）', () => {
  /** 左桥真拖到 `size`% 松手（三栏和=100，右栏 22 没动） */
  const collapseLeft = (size: number) => ({ ...dragged(size, 78 - size, 22), index: 0 })
  /** 右桥真拖到 `size`% 松手（三栏和=100，左栏 18 没动） */
  const collapseRight = (size: number) => ({ ...dragged(18, 82 - size, size), index: 1 })

  it('**左桥拖到 3% 松手 → `{ sidebarRail: true }`（收成图标窄栏），一个字都不写宽度**', () => {
    const patch = layoutPatchFromResize(collapseLeft(3), at({ sidebarOpen: true, sidebarSize: 18 }))
    expect(patch).toEqual({ sidebarRail: true })
    // 「收栏不改宽度 ⇒ 点按钮展开还是 18」全靠这两条：混进任一宽度键，
    // 展开回来就是一条缝 —— 而且用户从没见过那个宽度被设过。
    expect(patch).not.toHaveProperty('sidebarSize')
    expect(patch).not.toHaveProperty('rightPanelSize')
  })

  it('**左桥拖到贴墙（0）→ `{ sidebarOpen: false, sidebarRail: false }`（整个隐藏）**', () => {
    // rail 是「留一排图标」、贴墙是「什么都不留」—— 两档之间没有第三档。
    // 两个键一起写：隐藏的同时 rail 必须归零（收起与窄栏互斥，见 layoutPatchFromResize）。
    const patch = layoutPatchFromResize(collapseLeft(0), at({ sidebarOpen: true, sidebarSize: 18 }))
    expect(patch).toEqual({ sidebarOpen: false, sidebarRail: false })
    expect(patch).not.toHaveProperty('sidebarSize')
    expect(patch).not.toHaveProperty('rightPanelSize')
  })

  it('右桥拖到 3% 松手 → `{ rightPanelOpen: false }`，**一个字都不写宽度**', () => {
    const patch = layoutPatchFromResize(collapseRight(3), at({ rightPanelOpen: true, rightPanelSize: 22 }))
    expect(patch).toEqual({ rightPanelOpen: false })
    expect(patch).not.toHaveProperty('rightPanelSize')
    expect(patch).not.toHaveProperty('sidebarSize')
  })

  it('**左栏两条边界都测**：≤0.5 → 整个隐藏；0.6~10 → 收成图标栏；10.1 → 不折，存宽度', () => {
    expect(layoutPatchFromResize(collapseLeft(0.5), at())).toEqual({
      sidebarOpen: false,
      sidebarRail: false
    })
    expect(layoutPatchFromResize(collapseLeft(0.6), at())).toEqual({ sidebarRail: true })
    expect(layoutPatchFromResize(collapseLeft(10), at())).toEqual({ sidebarRail: true })
    // 10.1 是函数层的原始输出；落盘时会被 normalizeLayout 钳回 11（见下面「落盘下限」）
    expect(layoutPatchFromResize(collapseLeft(10.1), at())).toEqual({ sidebarSize: 10.1 })
  })

  it('**右栏的边界**：刚好 10 → 折叠；10.1 → 不折，走普通路径存宽度（右栏没有 rail 档）', () => {
    expect(layoutPatchFromResize(collapseRight(10), at())).toEqual({ rightPanelOpen: false })
    expect(layoutPatchFromResize(collapseRight(10.1), at())).toEqual({ rightPanelSize: 10.1 })
  })

  it('拖的是右桥 → 左栏再窄也**不折叠**', () => {
    // 「只看 size 不看桥」的写法在这里会把一次「调右栏」变成「左栏没了」。
    const patch = layoutPatchFromResize(
      { ...dragged(3, 75, 22), index: 1 },
      at({ sidebarSize: 3, rightPanelSize: 22 })
    )
    expect(patch).not.toEqual({ sidebarOpen: false })
    expect(patch).toBeNull() // 左栏 3 没动、右栏 22 没动 —— 本来就没有可存的
  })

  it('拖的是左桥 → 右栏再窄也**不折叠**', () => {
    const patch = layoutPatchFromResize(
      { ...dragged(18, 79, 3), index: 0 },
      at({ sidebarSize: 18, rightPanelSize: 3 })
    )
    expect(patch).not.toEqual({ rightPanelOpen: false })
    expect(patch).toBeNull() // 左栏 18 没动、右栏 3 没动 —— 本来就没有可存的
  })

  it('**左栏收起后右桥顶到 index 0 —— 折叠右栏依然生效（本组最要紧的回归）**', () => {
    // 桥的序号按在场栏目现算：左栏收着时唯一的桥（右桥）是 index 0。
    // 旧版「index === 1」的写法在这里会静默失效 —— 用户发现右栏怎么也折不掉了。
    const patch = layoutPatchFromResize(
      { ...dragged(65, 10), index: 0 },
      at({ sidebarOpen: false, rightPanelSize: 22 })
    )
    expect(patch).toEqual({ rightPanelOpen: false })
    expect(patch).not.toHaveProperty('rightPanelSize')
  })

  it('对称地：右栏收起后左桥仍是 index 0，收成图标栏照常', () => {
    const patch = layoutPatchFromResize(
      { ...dragged(10, 90), index: 0 },
      at({ sidebarOpen: true, rightPanelOpen: false })
    )
    expect(patch).toEqual({ sidebarRail: true })
  })

  it('载荷没带 index → 不折叠（现实中到不了：契约是 event 在场则 index 必在）', () => {
    // 万一真来了，宁可走普通路径，也不猜「这是折叠」。
    const noIndex = dragged(18, 79, 3)
    const patch = layoutPatchFromResize(noIndex as never, at({ rightPanelSize: 3 }))
    expect(patch).not.toEqual({ rightPanelOpen: false })
    expect(patch).toBeNull() // 左栏 18 没动、右栏 3 没动 —— 没有可存的
  })

  it('**没有 event 的「折叠形状」载荷 → null**（增删 pane 的重排，宁可不猜）', () => {
    // index 是 1、右栏被压到 0 —— 形状和真折叠一模一样，唯独没有 event。
    // 保守钉死：这种载荷什么都不存（连宽度也不存），语义以后再需要时另说。
    const reflow = { index: 1, panes: [{ size: 18 }, { size: 82 }, { size: 0 }] }
    expect(layoutPatchFromResize(reflow as never, at())).toBeNull()
  })

  it('**键盘方向键不折叠**：只走普通宽度路径（预告在键盘上画不出来）', () => {
    // splitpanes 把按键调整实现成一次真拖拽：载荷形状和鼠标一模一样
    // （event 在场、index 在场），只能靠 event.key 认出来。键盘到 6% 时不折叠，
    // 只是把 6 存下去 —— 落盘时 normalizeLayout 会钳回 11。
    // 反过来若这里折叠了：用户按一下方向键，那一栏整个消失，而屏幕上
    // 从未出现过「松手就收起」的预告（resize+resized 同一同步任务连发）。
    const kbRight = { ...collapseRight(6), event: { key: 'ArrowRight' } }
    const patch = layoutPatchFromResize(kbRight as never, at({ rightPanelOpen: true, rightPanelSize: 11 }))
    expect(patch).toEqual({ rightPanelSize: 6 })
    expect(patch).not.toHaveProperty('rightPanelOpen')

    const kbLeft = { ...collapseLeft(6), event: { key: 'ArrowLeft' } }
    expect(layoutPatchFromResize(kbLeft as never, at({ sidebarOpen: true, sidebarSize: 11 }))).toEqual({
      sidebarSize: 6
    })
  })

  it('**rail 期不写左栏宽度**（键盘载荷能到这一支）：整支跳过，宁可不存', () => {
    // rail 期左栏被钉成 RAIL_SIZE（min == max），鼠标根本拖不动它 —— 但键盘
    // 调整是「一次真拖拽」，载荷顺着普通宽度路径能走到写盘那一支。不跳的话，
    // 4.2 会被当成「用户拖出来的宽度」存下去（读口钳到 11 也救不回原来的 18）。
    const kbLeft = { ...collapseLeft(4.2), event: { key: 'ArrowLeft' } }
    expect(layoutPatchFromResize(kbLeft as never, at({ sidebarRail: true, sidebarSize: 18 }))).toBeNull()
  })

  it('**rail 期右栏照常能拖能存** —— 那道防线只包左栏，没把持久化整个停掉', () => {
    // 「只跳左栏那一支」的对照组：一刀切的做法会让 4.2 不落盘的同时，
    // 右栏宽度也永远存不进去 —— 用户拖右栏、重启后弹回去，不报任何错。
    expect(
      layoutPatchFromResize(
        { ...dragged(4.2, 73.8, 22), index: 1 },
        at({ sidebarRail: true, rightPanelSize: 22 })
      )
    ).toBeNull() // 右栏 22 没动 —— 本来就无可存（顺带证明 rail 的 4.2 没被存）
    expect(
      layoutPatchFromResize(
        { ...dragged(4.2, 51.8, 26), index: 1 },
        at({ sidebarRail: true, rightPanelSize: 22 })
      )
    ).toEqual({ rightPanelSize: 26 })
    // 右栏折叠在 rail 期也照常
    expect(
      layoutPatchFromResize({ ...dragged(4.2, 63.8, 10), index: 1 }, at({ sidebarRail: true }))
    ).toEqual({ rightPanelOpen: false })
  })

  it('已经在 rail 了再来一发「收成图标栏」→ null（没有可存的，不重复写盘）', () => {
    expect(layoutPatchFromResize(collapseLeft(3), at({ sidebarRail: true }))).toBeNull()
  })

  it('没有 `key` 的普通拖拽（event 是空对象/真 MouseEvent 形状）照常折叠 —— 排除面不能扩大', () => {
    // duck-type 是「key 是字符串」而不是「event 是个对象」：测试夹具里
    // event:{}（上面 collapseRight）与浏览器里真 MouseEvent 都必须继续折叠，
    // 否则这条修复会把整个鼠标路径一起废掉、还全绿。
    expect(layoutPatchFromResize(collapseRight(3), at({ rightPanelOpen: true }))).toEqual({
      rightPanelOpen: false
    })
    expect(layoutPatchFromResize(collapseLeft(3), at({ sidebarOpen: true }))).toEqual({
      sidebarRail: true
    })
  })

  it('收着的那一栏不在场 —— 它的桥根本不存在，不会有「再折一次」的载荷', () => {
    // 右栏收着时只剩左桥（index 0、两栏）：拖它不碰右栏，宽度没动就不存。
    expect(
      layoutPatchFromResize({ ...dragged(18, 82), index: 0 }, at({ rightPanelOpen: false }))
    ).toBeNull()
    // 对称地：左栏收着时只剩右桥（index 0、两栏），右栏宽度没动也不存。
    expect(
      layoutPatchFromResize(
        { ...dragged(82, 18), index: 0 },
        at({ sidebarOpen: false, rightPanelSize: 18 })
      )
    ).toBeNull()
  })
})

describe('foldIntentFromResize：真值表（桥的身份 + size 一起判）', () => {
  it.each([
    ['左桥、拖到 3% → 收成图标栏', { ...dragged(3, 75, 22), index: 0 }, at(), 'sidebar-rail'],
    ['左桥、刚好卡在折叠阈值 10', { ...dragged(10, 68, 22), index: 0 }, at(), 'sidebar-rail'],
    ['左桥、刚过贴墙线 0.6（还算「留一排图标」）', { ...dragged(0.6, 77.4, 22), index: 0 }, at(), 'sidebar-rail'],
    ['左桥、贴墙线 0.5（含）→ 整个隐藏', { ...dragged(0.5, 77.5, 22), index: 0 }, at(), 'sidebar-hidden'],
    ['左桥、拖到 0 → 整个隐藏', { ...dragged(0, 78, 22), index: 0 }, at(), 'sidebar-hidden'],
    ['左桥、比阈值大 0.1', { ...dragged(10.1, 67.9, 22), index: 0 }, at(), null],
    ['右桥、拖到 3%', { ...dragged(18, 79, 3), index: 1 }, at(), 'right-panel'],
    ['右桥、刚好卡在阈值 10', { ...dragged(18, 72, 10), index: 1 }, at(), 'right-panel'],
    ['右桥、比阈值大 0.1', { ...dragged(18, 71.9, 10.1), index: 1 }, at(), null],
    ['拖右桥、左栏本来就窄（size 小不等于要折左栏）', { ...dragged(3, 75, 22), index: 1 }, at({ sidebarSize: 3 }), null],
    ['左栏收着时右桥顶到 index 0（回归：按开关判身份）', { ...dragged(65, 3), index: 0 }, at({ sidebarOpen: false }), 'right-panel'],
    ['右栏收着时左桥 index 0', { ...dragged(3, 97), index: 0 }, at({ rightPanelOpen: false }), 'sidebar-rail'],
    ['键盘 ArrowLeft', { ...dragged(3, 75, 22), index: 0, event: { key: 'ArrowLeft' } }, at(), null],
    ['没有 event（增删重排）', { index: 0, panes: [{ size: 3 }, { size: 75 }, { size: 22 }] }, at(), null],
    ['载荷没带 index', dragged(3, 75, 22), at(), null],
    ['index 不是整数', { ...dragged(3, 75, 22), index: 0.5 }, at(), null],
    ['index 越界（3 栏里的 2 —— 那位置没有右邻）', { ...dragged(3, 75, 22), index: 2 }, at(), null],
    ['index 越界（3 栏里的 5）', { ...dragged(3, 75, 22), index: 5 }, at(), null],
    ['size 是 NaN', { ...dragged(Number.NaN, 75, 22), index: 0 }, at(), null],
    ['size 是 Infinity', { ...dragged(Number.POSITIVE_INFINITY, 75, 22), index: 0 }, at(), null],
    ['size 是字符串', { event: {}, panes: [{ size: '3' }, { size: 75 }, { size: 22 }], index: 0 }, at(), null]
  ])('%s → %s', (_name, payload, current, want) => {
    expect(foldIntentFromResize(payload as never, current)).toBe(want)
  })
})

describe('左栏三态：sidebarModeOf 的读法 + sidebarTogglePatch 的循环（v18）', () => {
  it.each([
    ['默认（开、非 rail）→ open', at(), 'open'],
    ['开着 + rail → rail', at({ sidebarRail: true }), 'rail'],
    ['收着 → hidden', at({ sidebarOpen: false }), 'hidden'],
    ['脏组合（收着 + rail:true）→ hidden（收起优先，别把第四种当真）', at({ sidebarOpen: false, sidebarRail: true }), 'hidden']
  ])('%s', (_name, layout, want) => {
    expect(sidebarModeOf(layout)).toBe(want)
  })

  it('**☰ 连按三步回到原点**：open → rail → hidden → open', () => {
    let l = at()
    const modes: string[] = []
    for (let i = 0; i < 4; i++) {
      modes.push(sidebarModeOf(l))
      l = { ...l, ...sidebarTogglePatch(l) }
    }
    // 前三步踩满三态，第四步回到 open —— 用户不需要知道自己在第几态，
    // 连按总能回去（循环顺序的注释在 sidebarTogglePatch 上）。
    expect(modes).toEqual(['open', 'rail', 'hidden', 'open'])
  })

  it('**补丁只描述变化的那几个键**（落地照旧走 setLayout → normalizeLayout）', () => {
    // open → rail：只写 sidebarRail —— 宽度一个字不动（展开时原样回来）
    expect(sidebarTogglePatch(at())).toEqual({ sidebarRail: true })
    // rail → hidden：两个键一起写（隐藏意味着 rail 归零，与拖拽路径同一口径）
    expect(sidebarTogglePatch(at({ sidebarRail: true }))).toEqual({
      sidebarOpen: false,
      sidebarRail: false
    })
    // hidden → open：rail 一并写回 false（别把上一轮的 rail 带回来）
    expect(sidebarTogglePatch(at({ sidebarOpen: false }))).toEqual({
      sidebarOpen: true,
      sidebarRail: false
    })
  })

  it('每一步的补丁过一遍 normalizeLayout 都还原成合法三态（补丁与钳位不打架）', () => {
    let l = at()
    const seen: string[] = []
    for (let i = 0; i < 3; i++) {
      l = normalizeLayout({ ...l, ...sidebarTogglePatch(l) })
      seen.push(sidebarModeOf(l))
    }
    // 每次落地都经 normalizeLayout（真实链路：setLayout 就是这么走的）——
    // 三态每个中间态都得是合法的，第三步回到 open。
    expect(seen).toEqual(['rail', 'hidden', 'open'])
    // 宽度全程没被碰过
    expect(l.sidebarSize).toBe(DEFAULT_LAYOUT.sidebarSize)
  })
})

describe('两侧三常量的关系（左右逐条对称，左栏另有一档 rail）', () => {
  it('**拖拽下限是 0** —— 主人点名「解除最小宽度限制」，两侧都要能拖到底', () => {
    expect(RIGHT_PANEL_MIN_SIZE).toBe(0)
    expect(SIDEBAR_MIN_SIZE).toBe(0)
  })

  it('落盘下限 = 折叠阈值 + 1（两侧都是）', () => {
    // 拖拽能到 0，但松手 ≤10 走折叠、不写宽度；所以落盘的「开着」宽度必然 >10，
    // 钳到 ≥11 对合法值恒等、对脏数据（手改的 3、旧版本残留）是救援。
    // 谁把这两个数改成相等或倒过来，就会出现「刚存下的宽度读回来就触发拆除逻辑」的死循环。
    expect(RIGHT_PANEL_STORE_MIN_SIZE).toBe(RIGHT_PANEL_COLLAPSE_SIZE + 1)
    expect(SIDEBAR_STORE_MIN_SIZE).toBe(SIDEBAR_COLLAPSE_SIZE + 1)
    expect(RIGHT_PANEL_MIN_SIZE).toBeLessThanOrEqual(RIGHT_PANEL_COLLAPSE_SIZE)
    expect(SIDEBAR_MIN_SIZE).toBeLessThanOrEqual(SIDEBAR_COLLAPSE_SIZE)
  })

  it('**左栏的四个档位依次排开**：贴墙线 < rail 钉宽 ≤ 折叠阈值 < 落盘下限', () => {
    // 0.5 < 4.2 ≤ 10 < 11 —— 每一档都占一个互不重叠的位置：
    //   · 贴墙线以下 = 整个隐藏（什么图标都放不下）；
    //   · rail 钉宽自成一档，且在折叠阈值之内（拖到 4.2 附近松手也归 rail）；
    //   · 折叠阈值与落盘下限差 1，保证「存下的开着宽度」钳位对合法值恒等。
    expect(SIDEBAR_HIDE_SIZE).toBeLessThan(RAIL_SIZE)
    expect(RAIL_SIZE).toBeLessThanOrEqual(SIDEBAR_COLLAPSE_SIZE)
    expect(SIDEBAR_COLLAPSE_SIZE).toBeLessThan(SIDEBAR_STORE_MIN_SIZE)
    // rail 的钉宽比「能被落盘的左栏最窄值」还窄：两个数永远不可能被混淆 ——
    // rail 的 4.2 只活在渲染口径（sidebarPaneSizeOf），从不落进 sidebarSize。
    expect(RAIL_SIZE).toBeLessThan(SIDEBAR_STORE_MIN_SIZE)
  })

  it.each([
    ['手改成 3', 3],
    ['误存的 0', 0],
    ['阈值附近的浮点 10.5', 10.5]
  ])('normalizeLayout 把**右栏** %s 救回 11（读口兜底）', (_name, junk) => {
    expect(normalizeLayout({ rightPanelSize: junk }).rightPanelSize).toBe(RIGHT_PANEL_STORE_MIN_SIZE)
  })

  it.each([
    ['手改成 3', 3],
    ['误存的 0', 0],
    ['阈值附近的浮点 10.5', 10.5]
  ])('normalizeLayout 把**左栏** %s 也救回 11（2026-10-04 起左栏同罪同罚）', (_name, junk) => {
    // 左栏收着时它的宽度照样存在盘里：右栏被救而左栏不救的话，
    // 那份 0~10 的脏值会在用户展开左栏那天以一条缝现身。
    expect(normalizeLayout({ sidebarSize: junk }).sidebarSize).toBe(SIDEBAR_STORE_MIN_SIZE)
  })

  it('刚好 11 两侧都是合法的，原样保留（钳位别钳到自家身上）', () => {
    expect(normalizeLayout({ rightPanelSize: 11 }).rightPanelSize).toBe(11)
    expect(normalizeLayout({ sidebarSize: 11 }).sidebarSize).toBe(11)
  })
})

describe('远端耦合的静态锚点（App.vue）', () => {
  // 本文件在 src/shared/__tests__ → 仓库根上面的 src/renderer/src/App.vue
  // ⚠️ 必须剥注释再断言（2026-10-04 复核）：裸读时，本文件里那条注释
  // （App.vue 模板上方解释为什么关 maximize-panes 的那段）逐字含
  // `:maximize-panes="false"` —— 把真代码改成 true、甚至整行删掉，
  // 只要注释还在，toContain 依然绿。静态锚点被注释满足等于没锚。
  const appSrc = maskComments(readFileSync(join(__dirname, '..', '..', 'renderer', 'src', 'App.vue'), 'utf8'))

  it('`:maximize-panes="false"` 在场 —— 双击分隔条不许再产生「折叠形状」的载荷', () => {
    // foldIntentFromResize 的注释里写明：双击分隔条的「最大化」发出的载荷
    // 与「真拖到 ≤10」在载荷层面**无法区分**（event 在场、index 恰好也是桥号、
    // 那一栏被压到 min）。改这一行之前先回去读那段注释。
    expect(appSrc).toContain(':maximize-panes="false"')
  })

  it('拖动中的「松手就收起」预告接线在场（@resize + is-fold-hint）', () => {
    expect(appSrc).toContain('@resize=')
    expect(appSrc).toContain('is-fold-hint')
  })

  it('**rail 期 Pane 被钉宽**（min == max == RAIL_SIZE）—— 「rail 不写宽度」防线的前提', () => {
    // layoutPatchFromResize 里「rail 期不写左栏宽度」那道防线有个前提：
    // rail 期左栏压根拖不动（min == max == RAIL_SIZE）。若只写 min 不写 max，
    // 往宽了拖依然能动 —— 那种「半宽不宽」的中间态没有对应的存档语义。
    expect(appSrc).toContain(':min-size="sidebarMode === \'rail\' ? RAIL_SIZE : SIDEBAR_MIN_SIZE"')
    expect(appSrc).toContain(':max-size="sidebarMode === \'rail\' ? RAIL_SIZE : SIDEBAR_MAX_SIZE"')
  })
})
