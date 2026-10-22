/**
 * 壁纸开启时「UI 面板透多少、画布盖多厚」+「面板底色换成什么」的**单一真源** ——
 * 默认值、合法区间、净化函数全在这里一份，渲染层 store 与设置页控件共用。
 *
 * 【这份设置管的是什么（和 wallpaper.ts 的分工）】
 * wallpaper.ts 管的是**壁纸自己**（选哪个、压多暗、模糊多少……），它落在
 * config.json 里、走服务器同步。这里管三样**界面自身**的东西：
 *   · panelAlpha —— UI 面板（卡片/侧栏/右栏）背景的不透明度：往小 = 面板更透、壁纸更显，
 *     但字仍然压在**不透明**的文字与代码块上（硬底线见下）。
 *   · veil —— 画布遮罩：面板与媒体之间那道画布色蒙版的浓度。往大 = 字更稳、壁纸更淡。
 *   · panelColor —— 面板底色的覆盖色（2026-10-07 个性化新增）：null = 不覆盖、
 *     用主题自带色；有值则覆盖 `--mi-card`**一个基色令牌**（卡片/侧栏/右栏/顶条的
 *     公共底）。玻璃令牌是 `color-mix(var(--mi-card) × --mi-panel-alpha)` 在**元素处**
 *     求值的，所以只换基色、玻璃自动跟随 —— 绝不直接覆盖 --mi-card-glass：
 *     那和 wallpaper.css 的门控块同特异性，胜负按源码顺序定，会静默失效。
 * 前两者在 2026-10-04 修「壁纸被 UI 完全遮挡」时新增（主人实测反馈）。
 *
 * 【硬底线：这里**没有任何一个旋钮能让文字变透明**】
 * 本文件产出两个百分比 + 一个基色覆盖 + 一个材料系数（V2-30），它们只会被
 * 注入成 `--mi-panel-alpha` / `--mi-wall-veil` / `--mi-card` / `--mi-material-fade`：
 *   ① `--mi-panel-alpha` 只被 tokens.css 里那三个 glass 令牌消费，而 glass 令牌
 *      只挂在**容器面**（卡片底、侧栏底、面板底）的 `background` 上；
 *      材料系数 `--mi-material-fade`（V2-30）只会被 wallpaper.css 门控块里
 *      那对 `--mi-glass-rim/--mi-glass-depth-color` 的 color-mix 消费，
 *      同样只落在**面板自己的 box-shadow** 上 —— 依然够不着任何文字；
 *   ② `--mi-wall-veil` 只被 `.layout` 的画布背景消费；
 *   ③ `--mi-card` 是**容器底面的基色**（卡片/侧栏/右栏/顶条共用）—— 换的只是底，
 *      文字色令牌（--mi-text 一族）一个都不吃。
 * 代码块、正文文字、题目、大肥鱼图标**一个都不吃这三个变量** —— 它们是
 * 「面板透明了、字还是实心的」这条要求的机械保障，由 wall-glass.test.ts 的
 * 静态闸门（IN 精确计数 + OUT 零令牌 + opacity 声明数快照）钉死。
 *
 * 【panelColor 是唯一一个「有意逃出对比度预算」的旋钮 —— 说清楚，不装没有】
 * 上面两个百分比都有预算推导（见 WALL_UI_DEFAULTS 的注释）；颜色没有：用户
 * 可以把面板挑成任意色，字压上去可能不达标。这是面板取色器规格里**明说**的
 * 取舍 —— 自选色是用户自负的个性化，我们只保两条机械边界：① 只动底、不动字；
 * ② 玻璃透明度仍叠在它上面（面板透的时候它就是「底色 × alpha」，不绕开面板链）。
 * 因此它的净化只放行**一眼能验证的形态**（严格 6 位 hex），非法值一律当
 * 「不覆盖」处理，坏字符串绝不许喂给 setProperty（理由见 normalizeHexColor）。
 *
 * 【为什么落 localStorage 而不是 config.json 一字段（同 zoom.ts 那份论证）】
 * 加 config 字段要动 types / migrate / merge 三处再补迁移，最坏风险是学习进度
 * 静默清零；而这只是几个界面偏好。所以单独存 `miai:wall-ui:v1`（自带版本号的钥匙）。
 * 也因此它**不参与服务器同步** —— 属于「只动渲染层、不碰同步模块」红线之内。
 *
 * 【为什么加了 panelColor 也不用升 v2】
 * 旧数据里没有这个字段，normalize 后补 null（= 不覆盖，语义正确）；旧版本的
 * 应用读到新字段会忽略它（读口只认自己认识的形状）。双向兼容，升版本除了
 * 制造一次迁移没有收益。
 *
 * 【为什么按主题各记一份（light / dark 两个子对象）】
 * 两个主题对透明度的**需求方向相反**：浅色界面本来就亮，面板透 40% 仍然压得住字；
 * 深色界面字是浅色的、壁纸一透进来对比度掉得快的方向一样但幅度不同 —— 实测预算
 * （深色按纯白壁纸最坏区推算）要求面板 alpha ≥ 55。所以默认值两个主题各给一套，
 * 用户各调各的，互不覆盖。切换主题时设置页显示的、应用的也是当前主题那一份。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫（见 renderer/src/lib/__tests__/copy.test.ts），
 *    **字符串一律英文**，中文只出现在注释里。
 */

import type { MiThemeName } from './types'

/** UI 面板不透明度区间（%）。0 = 全透（字仍实心），100 = 和没开壁纸一样 */
export const WALL_PANEL_ALPHA_MIN = 0
export const WALL_PANEL_ALPHA_MAX = 100

/**
 * V2-30（2026-10-16）：材料（面板的棱线 + 内侧厚度阴影）的**淡出拐点** ——
 * 面板 alpha 低于 30 时，棱与厚度跟着面板一起线性淡出，到 0 时一丝不剩。
 *
 * 【为什么要有这个数（用户看到的 bug）】
 * 棱和厚度是画在面板自己身上的静态 box-shadow（wallpaper.css 的门控块，
 * 不透明、不吃任何旋钮）。于是 alpha 拖到 0 时：面板底全没了、字直接压在
 * 壁纸上，但那圈棱和厚度还在原地 —— 用户要来的是「全隐藏」，得到的却是
 * 「一个没有底的框」。看起来不像"你调到底了"，像"没生效/渲染坏了"。
 *
 * 【为什么拐点选 30，而不是全程线性】
 * 出厂默认浅色 40 / 深色 65。拐点 30 保证**出厂观感一个字不变**
 * （40、65 都落在满材料区 → 系数 1 → 与改动前逐字节相同），只有用户
 * 主动拖过 30 才进入淡出区。这是"微调"，不是"改观感"。
 * 下限不封顶：主人 2026-10-16 裁定「用户调到 0 就是为了全隐藏，这点不能变」
 * —— 0 必须是真 0，所以这里是淡出不是钳位。
 */
export const WALL_MATERIAL_FADE_KNEE = 30

/**
 * panelAlpha(%) → 材料保留系数 [0,1]。≥拐点 = 1（满材料）；拐点以下线性
 * 降到 0（alpha=0 → 0，材料全隐）。纯函数，单测钉在 wall-ui 的测试里。
 *
 * 【为什么在 main.ts 算好再注入，而不是 CSS 里 calc()】
 * 消费端是 `color-mix(in srgb, <色> <pct>, transparent)` —— 百分比位置直接
 * 塞 calc() 是较新语法，解析路径不稳。算成一个普通百分比字符串注入最稳，
 * 与 --mi-panel-alpha 同一套路（数字的净化与换算留在 TS，CSS 只消费成品）。
 *
 * 【非有限数回 1（满材料），理由】
 * 与 clampPercent 的无效回退方向对齐：panelAlpha 一旦是坏值，面板本身会
 * 回落到出厂默认（40/65，都 ≥30 = 满材料区），材料也必须跟着回满 ——
 * 不然就是"底是默认的、棱却没了"的新裂缝。正常路径里 alpha 早已被
 * normalizeWallUi 钳成 0..100 的整数，这条只是防线，不是常态分支。
 */
export function materialFadeOf(alpha: number): number {
  if (!Number.isFinite(alpha)) return 1
  return Math.min(1, Math.max(0, alpha) / WALL_MATERIAL_FADE_KNEE)
}

/** 一个主题下的旋钮：两个百分比（整数）+ 一个可选的面板底色覆盖 */
export interface WallUiPerTheme {
  /** UI 面板背景不透明度：控制卡片/侧栏/右栏的底有多透 */
  panelAlpha: number
  /** 画布遮罩：面板与壁纸之间那道画布色蒙版有多厚 */
  veil: number
  /**
   * 面板底色覆盖（会被注入成 `--mi-card`）。null = 不覆盖、用主题自带色；
   * 有值 = **小写 `#rrggbb`**（净化时把大小写归一化，见 normalizeHexColor）。
   */
  panelColor: string | null
}

/** 画布遮罩浓度区间（%）。0 = 画布全透（壁纸最显），100 = 画布全实（壁纸只能从面板缝里露） */
export const WALL_VEIL_MIN = 0
export const WALL_VEIL_MAX = 100

/*
 * ── 液态玻璃（2026-10-08）─────────────────────────────────────────────────
 * 区间全部是**机械边界**：滑杆拖到头也不会让画面崩掉或算出非法值。
 * 上限怎么定的：
 *   · strength 48 —— 位移超过约 50px 时边缘那圈会开始「拖影」，像糊了一层；
 *   · ring 72 —— 超过这个数环带就吃掉大半块面板，分不出「面」和「边」；
 *   · blur 10 —— 再糊就只剩色块，面板底下的壁纸全没了（对比度是另一条线，
 *     由 panelAlpha/veil 管，blur 只影响观感不影响文字的对比预算）；
 *   · flow 100 —— 百分数，映射到周期与振幅（见 lib/glass/refraction.ts）；
 *   · shadow 40 —— 面板内侧那道厚度阴影的深度，超过 40 整块面板会显脏。
 * 这些值都进 CSS 变量或 SVG 属性，**没有一个能动文字**（同 panelAlpha 那条硬底线）。
 */
export const WALL_GLASS_STRENGTH_MIN = 0
export const WALL_GLASS_STRENGTH_MAX = 48
export const WALL_GLASS_RING_MIN = 8
export const WALL_GLASS_RING_MAX = 72
export const WALL_GLASS_BLUR_MIN = 0
export const WALL_GLASS_BLUR_MAX = 10
export const WALL_GLASS_FLOW_MIN = 0
export const WALL_GLASS_FLOW_MAX = 100
export const WALL_GLASS_SHADOW_MIN = 0
export const WALL_GLASS_SHADOW_MAX = 40

/**
 * 液态玻璃的一整套旋钮。
 *
 * 【为什么这一个**不分主题**（和上面两个百分比相反）】
 * panelAlpha / veil 分主题是因为它们直接决定对比度预算，而深浅两色的预算方向
 * 与数值都不同（见 WALL_UI_DEFAULTS 那段）。玻璃这一组是**几何与动力学**：
 * 折射多强、环多宽、糊多少、流动多快、阴影多深 —— 和明暗没有关系。硬拆成
 * 两份只会让用户「白天调好的手感，切到夜里就变了」。所以它是 config 下面的
 * 一个平级字段，只有一个主题之外的来源。
 *
 * 【refract 是可关的】它是唯一会持续消耗性能的一项（镜像 canvas + 滤镜链）。
 * 关掉之后一切回到「半透明底 + 内侧厚度阴影」那套静态观感，零额外开销。
 */
export interface WallGlassConfig {
  /** 折射总开关（关 = 不跑镜像与滤镜链，其余旋钮保留但无效） */
  refract: boolean
  /** 折射强度：边缘最大位移（px） */
  strength: number
  /** 环带宽度：边缘往内多少像素发生位移（px） */
  ring: number
  /** 背景模糊：面板底下壁纸的磨砂程度（px） */
  blur: number
  /** 流动：玻璃「呼吸」的速度与幅度（0 = 完全静止） */
  flow: number
  /** 阴影扩散：面板内侧那道厚度阴影的深度（px） */
  shadow: number
}

/** 两个主题各一份。**故意不是「一份 + 主题换算」** —— 需求方向不同，各调各的 */
export interface WallUiConfig {
  light: WallUiPerTheme
  dark: WallUiPerTheme
  /** 液态玻璃：几何旋钮，不分主题（理由见 WallGlassConfig 头注释） */
  glass: WallGlassConfig
}

/**
 * 每个主题的出厂默认值。
 *
 * 【浅色 panelAlpha 40 是主人亲口点的】（原话「比如 40%」）—— 40 压在他的
 * 真实观感上，不是算出来的。
 *
 * 【浅色 veil 75 是探针 J 实测逼出来的 —— 第一版 70 不及格】（2026-10-04）
 * 第一版配套值 70 的注释曾断言「浅色余量极大、最坏区 12:1」—— 那条断言建立
 * 在「正文都压在近白卡片上」这个**不成立的前提**上：课文标题
 * （.lesson-page .lesson-title）在卡片之外、**直接压在 veil 上**（J 实测它的
 * 祖先栈里只有 .layout 一层）。纯黑视频像素下 veil 70 时标题对底实测只有
 * 4.03:1。按预先定好的「不达标 +5」循环改到 75：同一最坏点合成对比度
 * 4.64:1（反解：veil ≥ 74 才过线，向上取到 75）。探针 J 同时用**真实截图
 * 像素**复核（只统计非文字像素 —— 动态背景下众数会塌到文字色上），两条都
 * ≥4.5 才算数。以后谁再动画布色或标题色，这条预算要重算，别把 75 当魔法数字。
 *
 * 【深色 65/75 是按最坏区推算的】深色面板底 #19202a 压在**纯白壁纸**上：
 * 合成亮度 = 0.65 × 深色 + 0.35 × 白，正文 #b6c1d0 压上去仍需 ≥ 4.5:1 ——
 * 解出来面板 alpha ≥ 55；取 65 留了一个身位的余量。veil 75 把画布那一层
 * （比面板更薄）也拉回同一区间 —— 深色的最坏视频像素方向相反（**白**把
 * 背景拉亮、浅字对比下降），J 实测 6.15:1。
 *
 * panelColor 两主题都默认 null（**不覆盖**）—— 出厂观感一个字不变。覆盖是
 * 用户自选动作，默认值不替用户挑色（挑错了也是用户自己挑的，见头注释那段
 * 「有意逃出对比度预算」的取舍）。
 */
export const WALL_UI_DEFAULTS: WallUiConfig = {
  light: { panelAlpha: 40, veil: 75, panelColor: null },
  dark: { panelAlpha: 65, veil: 75, panelColor: null },
  /*
   * 玻璃出厂值：refract 开、强度 22、环 30、糊 3、流动 0.35、阴影 14。
   * 【为什么默认是开的】这是主人点名要的观感升级（需求⑧），出厂就该看得见；
   * 关掉它是给「性能吃紧 / 想安静」留的退路，不是默认态。
   * 【为什么 ring 默认 30 而不是更宽】30px 是实验（exp4）里量过的一组：
   * 环带差异 9.37（79% 像素变化）、内部与外部严格为 0，说明环带既看得出来
   * 又没漏出去。再宽会让「面」变得太少。
   * 【为什么 flow 默认 35 而不是 0】0 = 完全静止，那等于把这台机器的招牌
   * 效果藏起来；35 对应约 11 秒一个来回、振幅 6% —— 眼睛能看出「活着」，
   * 但盯久了不会晕（振幅是相对强度，强度越大呼吸越明显）。
   * 【为什么 shadow 默认 14】内侧那道厚度阴影在 14px 时刚好能把面板从
   * 画布上「抬起来」一档；40 会让浅色主题的面板边缘发脏。
   */
  glass: { refract: true, strength: 22, ring: 30, blur: 3, flow: 35, shadow: 14 }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 数字净化：**先判 `Number.isFinite` 再钳位**，绝不直接 `Math.min(Math.max(...))`。
 * NaN 能穿过那个式子（它和谁比都是 false），于是 NaN 会被原样写进存储 ——
 * 之后 `--mi-panel-alpha: NaN%` 让消费它的 color-mix 在**用值时刻**失效（IACVT）：
 * 该声明按 unset 处理、background 取初值 transparent —— 面板全透、正文直接
 * 压在 veil/壁纸上，是往读性崩坏方向去的静默坏法（2026-10-04 复核修正了这里
 * 原先写反的失败方向；同 layout.ts clampSize / wallpaper.ts clampNum 的教训）。
 * 四舍五入到整数：滑杆是整数步进，存储里不该出现 39.999999。
 */
function clampPercent(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(Math.max(Math.round(v), min), max)
}

/**
 * 面板底色覆盖的净化：**只放行严格 6 位 hex**（`#` + 6 个 [0-9a-f]），
 * 大小写归一化到小写；其余一切（命名色、rgb()、三位缩写、缺 #、数字、
 * 缺字段、带空白的串）→ null（= 不覆盖，用主题自带色）。
 *
 * 【为什么必须是「一眼能验证」的形态，而不是尽力而为地宽松】
 * 这个值会原样进 `setProperty('--mi-card', ...)`。任何浏览器认不出的字符串
 * 会让那条行内声明在**用值时刻**失效（IACVT）—— --mi-card 按 unset 处理，
 * 卡片/侧栏/顶条的底退回初值（继承到底画布色），不报错、不警告，界面只是
 * 「看着怪怪的」。同上面 clampPercent 那段 NaN 论证的同一个坏法：坏值要么在
 * 进存储之前拦死，要么它就变成一个说不清哪来的怪现象。宽松解析（容忍 'red'、
 * '#abc'、'rgb(...)'）只会扩大「写进去的东西我验证不了」的面。
 * 归一化到小写还有第二个理由：同一个颜色只许有一种存储形态 —— 否则
 * 「#A1B2C3 换成 #a1b2c3」会被 patch 的相等判断当成两次真实改动来回写盘。
 */
function normalizeHexColor(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.toLowerCase()
  return /^#[0-9a-f]{6}$/.test(s) ? s : null
}

function normalizeTheme(raw: unknown, fallback: WallUiPerTheme): WallUiPerTheme {
  const o = isObject(raw) ? raw : {}
  return {
    panelAlpha: clampPercent(o.panelAlpha, fallback.panelAlpha, WALL_PANEL_ALPHA_MIN, WALL_PANEL_ALPHA_MAX),
    veil: clampPercent(o.veil, fallback.veil, WALL_VEIL_MIN, WALL_VEIL_MAX),
    // 非法/缺字段 → null（不覆盖）。**不从 fallback 取色**：fallback 的唯一
    // 来源是 WALL_UI_DEFAULTS，而出厂默认两主题都刻意是 null —— 「默认」的
    // 语义就是「不覆盖」，想改出厂色应该改的是 tokens.css（改这里等于把
    // 主题自带色在 TS 里又抄一份，见 shared/theme.ts 里那张表的注释）。
    panelColor: normalizeHexColor(o.panelColor)
  }
}

/**
 * 布尔净化：**只认真正的 boolean**。字符串 'false'、数字 0、undefined 一律
 * 回落到默认值 —— 不做「像假的就当假」的宽松解释。理由同 normalizeHexColor：
 * 这个值会决定「跑不跑那一整条滤镜链」，一个被误读成 true 的垃圾值不是
 * 显示错，是白烧性能；被误读成 false 则表现为「玻璃突然没了」。
 * 宁可两边都不猜。
 */
function clampBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/** 玻璃那一组：五个整数 + 一个布尔，走同一道「先判有限再钳位」 */
function normalizeGlass(raw: unknown, fallback: WallGlassConfig): WallGlassConfig {
  const o = isObject(raw) ? raw : {}
  return {
    refract: clampBool(o.refract, fallback.refract),
    strength: clampPercent(o.strength, fallback.strength, WALL_GLASS_STRENGTH_MIN, WALL_GLASS_STRENGTH_MAX),
    ring: clampPercent(o.ring, fallback.ring, WALL_GLASS_RING_MIN, WALL_GLASS_RING_MAX),
    blur: clampPercent(o.blur, fallback.blur, WALL_GLASS_BLUR_MIN, WALL_GLASS_BLUR_MAX),
    flow: clampPercent(o.flow, fallback.flow, WALL_GLASS_FLOW_MIN, WALL_GLASS_FLOW_MAX),
    shadow: clampPercent(o.shadow, fallback.shadow, WALL_GLASS_SHADOW_MIN, WALL_GLASS_SHADOW_MAX)
  }
}

/**
 * 把任意形状的东西**规整成一份合法的壁纸 UI 配置**（整树新造普通对象）。
 *
 * 与 normalizeLayout / normalizeWallpaper 同款职责：localStorage 里躺着的
 * 可能是上个大版本写的、被手改坏的、或干脆没有这个键 —— 读口这一道全部兜住。
 * **整树新造**：返回入参引用会让「写回存储的那份」和「来源那份」共用子对象，
 * 而且响应式代理经 JSON 往返才落盘，先新造再 stringify 最稳（同 pickIdePaths 纪律）。
 *
 * v1 存的数据里没有 glass 字段（2026-10-08 之前）—— 这一道补上默认值即可，
 * **不需要升 v2**：旧应用读到新字段只会忽略，新应用读旧数据补默认，双向兼容
 * （同当初加 panelColor 时的判断）。
 */
export function normalizeWallUi(raw: unknown): WallUiConfig {
  const o = isObject(raw) ? raw : {}
  return {
    light: normalizeTheme(o.light, WALL_UI_DEFAULTS.light),
    dark: normalizeTheme(o.dark, WALL_UI_DEFAULTS.dark),
    glass: normalizeGlass(o.glass, WALL_UI_DEFAULTS.glass)
  }
}

/**
 * 取某个主题那一份。**主题名不认识时给浅色**（和 windowBgOf / themeName 同一个
 * 退让方向：宁可显成浅色的默认，也不要拿 undefined 去喂 setProperty —— 那会
 * 把变量设成字符串 'undefined%'，消费它的 color-mix 在**用值时刻**失效（IACVT）：
 * 按 unset 处理、background 取初值 transparent，面板全透，静默 —— 2026-10-04
 * 复核修正：原写「退回全实色」，方向反了，真发生的是读性崩坏那一侧）。
 */
export function wallUiOf(config: WallUiConfig, theme: MiThemeName): WallUiPerTheme {
  return config[theme] ?? config.light
}
