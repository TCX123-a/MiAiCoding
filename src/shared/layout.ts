/**
 * 三栏布局的尺寸定义 —— 主进程校验与渲染进程渲染**共用这一份**，避免两处数字漂移。
 *
 * 【为什么单位是百分比，不是像素】
 * ① splitpanes 的 `size` 天生就是百分比：源码里是把它 `parseFloat` 之后直接当
 * `${size}%` 用，塞像素值进去只会被当成一个超大的百分比夹掉。
 * ② 它**没有暴露任何编程式设置尺寸的方法**，改尺寸只能走 `size` prop —— 好在
 * pane 内部对 prop 挂了 watcher、渲染尺寸走 registry，**prop 变了会重新生效**
 * （2026-10-04 复核修正：此处原写「prop 变了也不会重新生效」，说反了；折叠后
 * 落盘值 10.1→11 的再应用正是靠这条路）。真正「只在挂载那一刻取一次」的是
 * `givenSize`，见文件末尾那段。
 * 结论仍是顺着它的模型存百分比：省一层换算，而且「在场各栏和 = 100」这条
 * 不变量能直接写进测试（布局不漂的全部依据，见下）。
 *
 * 【百分比的含义不随任一面板开合改变，这一点是整套设计的支点】
 * splitpanes 报出来的 size 是「占整宽的百分之几」，哪一栏开着还是收着，
 * 同一个数字指的是同一件事。
 *
 * 【在场的那几栏尺寸加起来必须**正好 100** —— 这是让布局不漂的唯一办法】
 * splitpanes 内部那几个重算函数里，真正会动尺寸的只有一条路：
 *
 *   `readjustSizes(leftToAllocate, …)` —— 而它**只在总和 ≠ 100 时**才会被调用。
 *
 * 总和 = **在场**栏目的 size 之和（收起的面板不参与 —— 它那一栏整个不在）。
 * 只要这个和正好 100，增删 pane 也好、它自己重排也好，都动不了它们 ——
 * 布局就是配置里写的那样，一个百分点都不会自己走。
 * 总和一旦对不上，**每走一次重排就把差额平摊给每一栏**，越走越偏。
 *
 * 这也是为什么主区**也必须显式给 `size`**（用 mainSizeOf() 算），不能像最初设想的那样
 * 留空。留空的话主区会走 `equalizeAfterAddOrRemove`，那条路要读 pane 的 `givenSize`,
 * 而 **`givenSize` 只在 pane 挂载那一刻取一次、之后永不更新**（pane.vue 里那个 watcher
 * 只推 `size`）。用户拖过一次，givenSize 就和真实宽度对不上了，那份差额会在用户每次
 * 收起/展开面板时被平摊掉 —— 实测来回一趟左栏就少 58px，而配置里一个字都没变。
 */

/**
 * 左栏宽度（占整宽的百分比）。三常量一套，和右栏逐条对称（2026-10-04 主人
 * 要求「左栏也要拖到极窄松手即折叠」后改的）：
 * 拖拽能到 0（SIDEBAR_MIN_SIZE），松手 ≤ 10 走折叠、不写宽度，
 * 会被存下来的「开着」宽度钳到 ≥ 11（SIDEBAR_STORE_MIN_SIZE）。
 * 每条的理由与右栏完全同构，详见下面右栏三常量各自的注释（把「右」读成「左」）。
 * ⚠️ 左栏这里有一条自己的旧账：原拖拽下限 14 已不存在 —— 谁再看到 14
 * 出现在左栏相关代码里，那是没改干净的残留。
 */
export const SIDEBAR_MIN_SIZE = 0
export const SIDEBAR_MAX_SIZE = 32

/** 左栏松手折叠阈值（%）：拖到 ≤ 这个宽度松手 ⇒ 整个折起来。同右栏 */
export const SIDEBAR_COLLAPSE_SIZE = 10

/** 左栏宽度的**落盘下限**（%）。「开着」就意味着至少 11% —— 同右栏 */
export const SIDEBAR_STORE_MIN_SIZE = 11

/**
 * 左栏「拖没了」的判定上限（%）：拖到比它还窄松手 ⇒ 整个隐藏（比 rail 更彻底）。
 *
 * 【为什么不是 0】蓝图原文是「拖到 0 全隐」，但拖拽报的是一长串浮点，拖到墙边
 * 未必恰好是 0。0.5% 在 1200px 窗口上是 6px——这个宽度里连 rail 的图标都放不下，
 * 「比它窄」和「到 0」对用户是同一件事。留余量的方向和折叠阈值同理（防手抖），
 * 只是这里抖的余地更小：rail 是「留着一排图标」，全隐是「什么都不留」。
 */
export const SIDEBAR_HIDE_SIZE = 0.5

/**
 * 左栏 rail（图标窄栏）态的**钉死宽度**（%）。
 *
 * 【rail 是什么】三态循环 open → rail → hidden 里的中间态（见 sidebarTogglePatch）：
 * 左栏收窄成一条只放图标的窄排（Sidebar.vue 的 `.sidebar.is-rail`），
 * 用户拖出来的宽度原样留在 sidebarSize 里，展开时原样回来。
 *
 * 【为什么钉宽】rail 态里 Pane 的 min-size = max-size = 这个值，拖不动：
 * ① rail 的排版就是照这个宽度调的（一列居中图标），允许拖宽只会拖出一个
 * 「半宽不宽」的尴尬中间态；② 拖拽宽度写盘那条路在 rail 期整个关掉
 * （见 layoutPatchFromResize），钉宽让「拖了也没用」在手感上先成立，
 * 不会出现「拖了一下、松手弹回去」。4.2% 是蓝图（执行蓝图 IA-7）定的数：
 * 1200px 窗口 ≈ 50px，一列图标放得下。
 */
export const RAIL_SIZE = 4.2

/**
 * 右栏宽度（占整宽的百分比）。
 *
 * 【为什么下限是 0 而不是一个「最小可用宽度」】2026-10-04 主人实测：
 * 拖到最窄时卡在一个固定位置再也拖不动 —— 那个位置就是旧下限 16。
 * 他要求解除最小宽度限制：拖得到接近 0，拖到极窄松手就自动折叠。
 * 于是**拖拽**下限放到 0；「多窄算没用」交给折叠阈值管（见下）。
 * ⚠️ 这个常量只喂 Pane 的 min-size（拖拽钳制）。**落盘**的下限是
 * RIGHT_PANEL_STORE_MIN_SIZE —— 两个数不一样是有意的，见它那段注释。
 */
export const RIGHT_PANEL_MIN_SIZE = 0
export const RIGHT_PANEL_MAX_SIZE = 32

/**
 * 右栏松手折叠阈值：拖到 ≤ 这个宽度（%）松手 ⇒ 整个折起来。
 *
 * 【为什么不是 0】低于这个宽度，右栏里的 12px 文字已经全部挤成不可读，
 * 「窄条」没有信息量、只占地方；而用户拖到这个尺度还继续往右使劲，
 * 意图就是「关掉它」。留一点余量是因为手抖 —— 想拖窄但仍要留着的用户
 * 会在 10~16 之间停手，不会误触。
 */
export const RIGHT_PANEL_COLLAPSE_SIZE = 10

/**
 * 右栏宽度的**落盘下限**（%）。「开着」就意味着至少 11% —— 恰好比折叠
 * 阈值大 1，这个关系是刻意的：
 * - 拖拽能到 0（RIGHT_PANEL_MIN_SIZE），但松手 ≤ 10 走折叠、**不写宽度**；
 * - 所以唯一会被写进配置的「开着」宽度必然 > 10，钳到 ≥ 11 对合法值恒等；
 * - 手改配置、或旧版本残留的小值（0~10）由读口救回 11 —— 不管的话，
 *   `rightPanelOpen: true` + `rightPanelSize: 3` 会开出一条 3% 宽的缝：
 *   那种宽度上分隔条根本点不到，用户没有任何途径把它救回来。
 */
export const RIGHT_PANEL_STORE_MIN_SIZE = 11

/**
 * 主内容区至少留这么宽 —— 两边拖到头也不许把课文挤成一条缝。
 *
 * 它撑着的是一条**不等式**：左栏最大 + 右栏最大 + 主区最小 ≤ 100
 * （32 + 32 + 32 = 96），所以两边**同时**拖到最大，主区仍然剩 36 ≥ 这个值。
 * 换句话说主区不用自己设下限 —— 挡着它的是左栏和右栏的上限。
 * 由 layout.test.ts 钉死。
 */
export const MAIN_MIN_SIZE = 32

export interface LayoutConfig {
  /** 左栏宽度，占整宽的百分比 */
  sidebarSize: number
  /** 左栏是否展开。收起时那一栏整个从 splitpanes 里移除 */
  sidebarOpen: boolean
  /**
   * 左栏是否处于 rail（图标窄栏）态（v18 加）。只在 sidebarOpen 时成立 ——
   * 「收起」与「窄栏」是互斥的两种形态，normalizeLayout 把第四种组合钳掉。
   * rail 期 sidebarSize **原样保留**：它只是个标志，不是宽度。
   */
  sidebarRail: boolean
  /** 右栏宽度，占整宽的百分比 */
  rightPanelSize: number
  /** 右栏是否展开。收起时那一栏整个从 splitpanes 里移除 */
  rightPanelOpen: boolean
}

export const DEFAULT_LAYOUT: LayoutConfig = {
  // 这两个数是照着改造前的固定宽度定的：1200px 窗口下 18% ≈ 216px（原先 220px）、
  // 22% ≈ 264px（原先 260px）。也就是说第一眼看上去和改造前一模一样。
  sidebarSize: 18,
  // 两个面板默认都开着：从没见过这个字段的老配置补出来的第一眼，
  // 和升级前一模一样 —— 收起是用户自己拖出来的动作，不能让升级替他做。
  sidebarOpen: true,
  // rail 默认关 = 左栏以正常宽度出场 —— 方向同两个 Open：rail 是用户
  // 亲手按出来的形态（☰ 或拖窄），升级不能替他做这个动作。
  sidebarRail: false,
  rightPanelSize: 22,
  rightPanelOpen: true
}

/**
 * 左栏当前以一个多宽的 pane 出场：rail 态恒是钉死的 RAIL_SIZE，
 * 其余情况是它自己存的宽度。
 *
 * ⚠️ 这是**渲染口径**，不是落盘口径 —— 别拿它去改写 sidebarSize：
 * rail 是个临时形态，用户原来拖出来的宽度要原封不动留着（展开时回来）。
 */
export function sidebarPaneSizeOf(layout: LayoutConfig): number {
  return layout.sidebarRail ? RAIL_SIZE : layout.sidebarSize
}

/**
 * 主区的宽度 —— 剩下的全给它。哪一栏收着，哪一栏那份也算在主区头上。
 *
 * 【为什么抽成函数】因为它撑着一条**必须恒成立**的不变量：**在场**各栏
 * （收起的不算）的 size 加起来正好 100。
 * 见文件开头那段 —— splitpanes 只在总和 ≠ 100 时才调用 readjustSizes，
 * 而只要一调用就会把差额平摊给每一栏，用户每次收起/展开面板宽度就少一截。
 *
 * rail 期左栏以 RAIL_SIZE 参与（走 sidebarPaneSizeOf）—— 这正是「rail 是
 * 状态不是宽度」的落点：sidebarSize 留着，但此刻在场的那个 pane 是 4.2%。
 *
 * 所以这个函数不能靠肉眼保证，得让测试去遍历整个取值区间验一遍。
 */
export function mainSizeOf(layout: LayoutConfig): number {
  return (
    100 -
    (layout.sidebarOpen ? sidebarPaneSizeOf(layout) : 0) -
    (layout.rightPanelOpen ? layout.rightPanelSize : 0)
  )
}

/**
 * 把一个数夹进 `[min, max]`。**非数字一律退回 fallback**。
 *
 * ⚠️ 这里**必须先判 `Number.isFinite`，不能直接 `Math.min(Math.max(...))`**。
 * `NaN` 能穿过那个式子（它和谁比都是 false，`Math.max(NaN, 1)` 还是 `NaN`），
 * 于是 NaN 会被原样写进配置，之后 `width: NaN%` 让那一栏直接塌成 0 ——
 * 而配置文件**已经写坏了，改不回来**。同一个坑在 config-merge.ts 的
 * runTimeoutSec 那里已经踩过一次，这里照同一套规矩防。
 */
export function clampSize(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(Math.max(v, min), max)
}

/**
 * 把任意形状的东西**规整成一份合法的布局配置**。
 *
 * 【为什么必须先过这一道，而不是拿到就直接用】
 * `config.json` 是主人机器上**已经存在**的文件 —— 它是「还没有 layout 这一节」
 * 的时候写下的，里面根本没有这个字段。而 json-store 的 `read()` 只在
 * **整个文件不存在**时才返回 null，**不做字段级兜底**。
 * 所以主进程和渲染进程都会拿到 `layout: undefined`。
 * 少了这一步，升级后的第一次启动就是白屏 —— 而且是主人自己那份配置触发的那种，
 * 开发机上永远复现不了。
 *
 * 顺带它也兼任**写盘前的钳位**：入参不合法时钳进合法区间，而不是原样存下去。
 * ⚠️ 两侧宽度用的都是 **STORE 下限（11）**，不是拖拽下限（0）：拖拽过程中的
 * 小值不经过这里，会经过这里的是「会被存下来、下次照此打开」的那个值。
 */
export function normalizeLayout(raw: unknown): LayoutConfig {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  // 「不是布尔就当没这个字段」→ 补默认 true。绝不能把杂值当成 false：
  // 那等于一次数据意外就把用户的左栏静默关掉了（方向同 rightPanelOpen）。
  const sidebarOpen = typeof o.sidebarOpen === 'boolean' ? o.sidebarOpen : DEFAULT_LAYOUT.sidebarOpen
  return {
    sidebarSize: clampSize(
      o.sidebarSize,
      DEFAULT_LAYOUT.sidebarSize,
      SIDEBAR_STORE_MIN_SIZE,
      SIDEBAR_MAX_SIZE
    ),
    sidebarOpen,
    // rail（v18）：只在左栏开着时才成立 —— 「收起」和「窄栏」互斥，
    // 两个都写的档案（旧版残留、手改、意外组合）在写盘/读口这里被归一。
    // ⚠️ 脏值的处理方向与上面两个 Open **相反**：杂值一律回 false，不是回
    // 默认 true —— false 是「正常宽度的左栏」，落回它不藏任何东西；
    // true 是「只剩一排图标」，不该从脏数据里推断出来。
    // （`=== true` 的写法同时挡掉 'yes' / 1 这类「看着像真」的杂值。）
    sidebarRail: o.sidebarRail === true && sidebarOpen,
    rightPanelSize: clampSize(
      o.rightPanelSize,
      DEFAULT_LAYOUT.rightPanelSize,
      RIGHT_PANEL_STORE_MIN_SIZE,
      RIGHT_PANEL_MAX_SIZE
    ),
    rightPanelOpen: typeof o.rightPanelOpen === 'boolean' ? o.rightPanelOpen : DEFAULT_LAYOUT.rightPanelOpen
  }
}

/**
 * 左栏三态的归一化读法（open → rail → hidden，循环见 sidebarTogglePatch）。
 *
 * 【为什么不直接看两个布尔】「开/关」与「是不是 rail」是两个键，组合有四种、
 * 合法的只有三种（见 normalizeLayout 的钳位）。谁要判「现在是哪一态」都从
 * 这里读 —— 各组件自己写 `if (open && rail)` 的话，迟早有人把第四种组合当真。
 */
export type SidebarMode = 'open' | 'rail' | 'hidden'

export function sidebarModeOf(layout: LayoutConfig): SidebarMode {
  if (!layout.sidebarOpen) return 'hidden'
  return layout.sidebarRail ? 'rail' : 'open'
}

/**
 * ☰ 按钮按一下的补丁：open → rail（收成图标栏）→ hidden（整个隐藏）→ open。
 *
 * 【为什么循环顺序是这个】一路按下去是「越来越少」（整栏 → 图标 → 没有），
 * 而任何一态继续按都回到完整展开 —— 用户不需要知道自己在第几态，
 * 连按最多两下总能回去。
 * 返回「补丁」而不是完整配置：落地照旧走 setLayout → normalizeLayout，
 * 这里只描述变化的那几个键。
 */
export function sidebarTogglePatch(layout: LayoutConfig): Partial<LayoutConfig> {
  const mode = sidebarModeOf(layout)
  if (mode === 'open') return { sidebarRail: true }
  if (mode === 'rail') return { sidebarOpen: false, sidebarRail: false }
  return { sidebarOpen: true, sidebarRail: false }
}

/**
 * 载荷里的 `event` 是不是**键盘事件**（分隔条可聚焦，方向键每下 5%）。
 *
 * 【为什么要单独认这个】splitpanes 把键盘调整实现成「一次真拖拽」：
 * 载荷形状与鼠标拖拽完全相同（event 在场、index 也在场）。但折叠的
 * 「松手就收起」预告（App.vue 的 .is-fold-hint）依赖拖动是个**持续过程** ——
 * 键盘的一次按键里 resize 和 resized 在同一个同步任务里连发，预告挂上即摘、
 * 浏览器根本来不及画，等于无预警整个消失。所以折叠这个手势**只属于
 * 鼠标/触摸**：键盘只走普通宽度路径，下限由落盘钳位（≥11）兜住。
 *
 * duck-type（`key` 是字符串）而不是 `instanceof KeyboardEvent`：这个文件
 * 的测试跑在 node 环境里，那边没有 DOM 的 KeyboardEvent 构造器。
 */
function isKeyboardEventLike(e: unknown): boolean {
  return typeof e === 'object' && e !== null && typeof (e as { key?: unknown }).key === 'string'
}

/** splitpanes `resized` / `resize` 事件的载荷（只取我们要读的字段） */
export interface ResizePayload {
  event?: unknown
  /**
   * 被拖的那根分隔条的序号 —— **按在场栏目 DOM 序数**（桥 i 夹在
   * panes[i] 与 panes[i+1] 之间，这是 splitpanes 自己的分配方式）。
   * 所以：左右都开着时左桥 = 0、右桥 = 1；**左栏收起时唯一的桥（右桥）
   * 顶到 0**；右栏收起时左桥仍是 0。把数字当「固定身份」用是写错这种
   * 代码的经典方式 —— 桥属于哪一侧必须结合当前开关判，见
   * foldIntentFromResize。只要不是增删 pane 引发的那次载荷，它就恒在场。
   */
  index?: number
  panes: { size: number }[]
}

/** 折叠意图的落点；`null` = 这次不算折叠 */
export type FoldIntent =
  /** 左栏拖到 ≤ 折叠阈值：落成图标窄栏（宽度留在 sidebarSize 里，展开还回来） */
  | 'sidebar-rail'
  /** 左栏拖到贴墙（≤ SIDEBAR_HIDE_SIZE）：整个隐藏 */
  | 'sidebar-hidden'
  /** 右栏拖到 ≤ 折叠阈值：整个折叠 */
  | 'right-panel'

/**
 * 这次拖拽是否构成「把某一侧拖到极窄、该折叠了」—— 返回落到哪一态，否则 null。
 *
 * 【左栏为什么是两个去向、右栏只有一个】v18 起左栏是三态（open → rail →
 * hidden，见 sidebarTogglePatch）：拖到 ≤ 10 是「收成图标栏」（rail），
 * 拖到贴墙才是「整个消失」。右栏没有 rail 态，≤ 10 一律折叠。
 *
 * 【为什么不能沿用「右桥 index === 1」】那是「三栏都在场」时的数字。
 * 左栏一收起，右桥就顶到 index 0（桥的序号按在场栏目 DOM 序现算，见
 * ResizePayload.index 的注释）—— 只看 index === 1 的话，左栏收着时
 * **折叠右栏的能力会整个消失**，而且不报错。反过来，把「桥 0」当成
 * 左桥同样会误判。
 *
 * 【怎么认定一根桥的身份】桥 i 夹在 panes[i] 与 panes[i+1] 之间：
 *   · 左桥 ⇔ 左邻是左栏 ⇔ `sidebarOpen && i === 0`
 *     （左栏在场时它恒是 panes[0]，见 App.vue 的渲染序；rail 期它在场但
 *     被钉成 RAIL_SIZE，拖不动，任何带 event 的载荷都到不了这一支）
 *   · 右桥 ⇔ 右邻是右栏 ⇔ `rightPanelOpen && i === n - 2`
 * 两栏都收着时根本没有桥，也就不会有任何带 event 的载荷能进来。
 *
 * 【为什么必须同时看桥的身份和 size】调左栏宽度时右栏的 size 碰巧很小是
 * 完全可能的（它本来就小），只看 size 会把「调左栏」误判成「关右栏」。
 * 反过来只看身份也不行 —— 把某一侧拖**大**当然不算折叠。
 *
 * 【这条判定有一个在载荷层面无法区分的场景 —— 靠别处兜住，不要在这里猜】
 * splitpanes 双击分隔条的「最大化」快捷方式也会发一模一样形状的载荷
 * （event 在场、index 与 size 齐全）。**从载荷上分不出它和「真拖到 ≤ 10」**。
 * 唯一的分界线是 App.vue 上关了 `maximize-panes` —— 那个载荷永远不产生。
 * 谁要是哪天把它打开，双击任一桥都会误折叠对应那一侧。
 * 这个远端耦合宁可钉在这段注释里，也不要留给下一个人从现象反推。
 */
export function foldIntentFromResize(payload: ResizePayload, current: LayoutConfig): FoldIntent | null {
  if (!payload.event) return null
  if (isKeyboardEventLike(payload.event)) return null
  if (!Array.isArray(payload.panes)) return null

  const panes = payload.panes
  const n = panes.length
  const i = payload.index
  // 桥必须有左右两邻：i 必须落在 [0, n-2]。不是整数（缺席/脏值）时不猜。
  if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= n - 1) return null

  if (current.sidebarOpen && i === 0) {
    const s = panes[0]?.size
    if (typeof s !== 'number' || !Number.isFinite(s)) return null
    // 贴墙（≤ SIDEBAR_HIDE_SIZE）比「拖窄」更狠一档：用户要的是没有它。
    // 两档之间没有第三档 —— 蓝图 IA-7：≤10 松手进 rail、到 0 全隐。
    if (s <= SIDEBAR_HIDE_SIZE) return 'sidebar-hidden'
    return s <= SIDEBAR_COLLAPSE_SIZE ? 'sidebar-rail' : null
  }
  if (current.rightPanelOpen && i === n - 2) {
    const s = panes[n - 1]?.size
    return typeof s === 'number' && Number.isFinite(s) && s <= RIGHT_PANEL_COLLAPSE_SIZE
      ? 'right-panel'
      : null
  }
  return null
}

/**
 * 从一次 `resized` 载荷里算出**该存什么**；返回 `null` 表示「这次不该存」。
 *
 * 【为什么抽成纯函数】因为里面那条最要紧的规矩只能靠测来守：
 *
 * **没有 `event` 字段的，就不是用户拖的。**
 * splitpanes 在**增删 pane 之后也会补发一次 `resized`** —— 而收起/展开任一栏
 * 都是增删 pane。那一次是它内部的重排（把腾出来的空间分给别的栏），
 * 尺寸数字会自己动。不加区分地存下去，用户**每开合一次面板，宽度就被悄悄
 * 改写一次**，而他从没碰过分隔条。判据来自 splitpanes 自己的类型定义：
 * `resized` 的载荷里，增删引起的那次不带 `event`/`index`。
 *
 * 【谁站在 panes 的哪一格，由开关决定，不能按固定下标读】
 * 左栏收着时 panes[0] 是主区 —— 照旧读 panes[0] 会把**主区宽度存成左栏宽度**，
 * 打开左栏那天它就会以那个宽度蹦出来。所以每一侧都先问「它在场吗」，
 * 在场才读它那格：左栏恒是 panes[0]，右栏恒是 panes[末位]。
 * 在场形状与开关推算的对不上（增删过渡的半拍）时整份不存 —— 宁可不猜。
 *
 * 【差得太小就不存】splitpanes 报的是一长串浮点。先四舍五入再比，
 * 免得「拖了两下又拖回原位」也白写一次盘 —— 而配置写盘是整份重写。
 */
export function layoutPatchFromResize(
  payload: ResizePayload,
  current: LayoutConfig
): Partial<LayoutConfig> | null {
  if (!payload.event) return null

  // ⚠️ 解构之前必须先确认它真是个数组。这条不是洁癖：解构 null 会**抛异常**，
  // 而这个函数是在 mouseup 里被调的 —— 抛出去的表现是「拖了一下，界面崩了」，
  // 而且崩在事件回调里，堆栈指不到是哪个功能。
  if (!Array.isArray(payload.panes)) return null
  const panes = payload.panes

  // 每一格都得是有限数，且至少两格（一根桥至少要有左右两邻）。
  // 原实现只查 panes[0]；现在「哪一格是左栏」要看开关、读到的格子变多了，
  // 整份一起查最简单也最稳 —— 一格坏 = 整份不采信，宁可不存。
  if (panes.length < 2 || panes.some((p) => !p || !Number.isFinite(p.size))) return null

  // 在场形状与开关推算的对不上（增删过渡的半拍）→ 什么都不存
  const expected = 1 + (current.sidebarOpen ? 1 : 0) + (current.rightPanelOpen ? 1 : 0)
  if (panes.length !== expected) return null

  // 「拖到极窄松手 ⇒ 落进更少的一态」：只翻标志、**不写宽度** ——
  // 折叠不把用户原来的宽度弄没，点按钮重新展开还是他上次拖到的尺寸
  // （判定细节与双击载荷的纠葛，见 foldIntentFromResize 的注释）。
  const intent = foldIntentFromResize(payload, current)
  if (intent === 'sidebar-rail') {
    // rail 是标志位：宽度一个字不动（留在 sidebarSize 里）。已经在 rail
    // （或栏根本不在场）就没有可存的 —— rail 期的左栏被钉成 RAIL_SIZE、拖不动，
    // 这一支正常到不了，防的是键盘/意外载荷。
    return current.sidebarOpen && !current.sidebarRail ? { sidebarRail: true } : null
  }
  if (intent === 'sidebar-hidden') {
    // ⚠️ 两个键一起写：隐藏的同时 rail 必须清零（「收起」与「窄栏」互斥）。
    // 不写的话 normalizeLayout 的钳位也能救，但读 patch 的人就得绕一圈才知道
    // 「隐藏意味着 rail 也归零」—— 这里让它一眼可见。
    return current.sidebarOpen ? { sidebarOpen: false, sidebarRail: false } : null
  }
  if (intent === 'right-panel') {
    return current.rightPanelOpen ? { rightPanelOpen: false } : null
  }

  const patch: Partial<LayoutConfig> = {}
  // ⚠️ rail 期的左栏被钉成 RAIL_SIZE（min == max），它根本没有「拖出来的
  // 宽度」可存 —— 这一支整个跳过。不跳的话，键盘调整之类能到达这里的载荷
  // 会把 4.2 这种值当宽度存下去（读口钳到 11 也救不回用户原来的 18）。
  // 注意：只跳**左栏这一支**。右栏的算法与写盘照旧 —— rail 期间右栏
  // 照样能拖能存，别在回调入口一刀切地把整个持久化停了。
  if (current.sidebarOpen && !current.sidebarRail) {
    const side = panes[0]
    if (Math.round(side.size) !== Math.round(current.sidebarSize)) {
      patch.sidebarSize = side.size
    }
  }
  // 右栏收起来时它不在场 —— 那就只存左栏，别把右栏宽度抹了（也不要把
  // 主区的那一格错存成右栏宽度：右栏在场时它恒是末位，不在场直接跳过）
  if (current.rightPanelOpen) {
    const right = panes[panes.length - 1]
    if (Math.round(right.size) !== Math.round(current.rightPanelSize)) {
      patch.rightPanelSize = right.size
    }
  }
  return Object.keys(patch).length > 0 ? patch : null
}
