/**
 * 壁纸「自带属性」解析 —— elysia395/dsh-wallpaper-engine `lib/we-props.js`
 * 的 TS 移植（2026-10-05 P3 第四步「壁纸属性」面板，照源码逐段搬）。
 *
 * 上游：https://github.com/elysia395/dsh-wallpaper-engine
 * 许可证：MIT，Copyright (c) 2026 elysia395；全文见 THIRD-PARTY-CODE-NOTICES.md。
 *
 * 【管线分工】主进程只读 project.json 里 `general.properties` + `general.localization`
 * 的**原文**（`wallpaper:props` IPC，见 main/wallpaper/props.ts），渲染层用本文件
 * 解析成面板条目、合并用户覆盖值。这么分是因为：解析是纯计算（可独立测、
 * 两份解析器不允许漂移），而覆盖值的读写都在渲染层的配置 store 里。
 *
 * 【上游按上千个真实属性校准出的反直觉结论 —— 实现里别顺手「简化」掉】
 *  - `order` 按**浮点**读（真实壁纸用 32.5 / 1151.0022 做细分排序键），并列时按
 *    **码位**比较 —— localeCompare 会做大小写不敏感的整理，与 WE 侧字节序不一致，
 *    实测会让同 order 的属性换位；
 *  - `combo` 选项值保留声明的 JSON 类型：整数/字符串/布尔混用是常态，统一
 *    字符串化会让壁纸里的 `===` / `switch` 全部失配；
 *  - 文案取壁纸自带 `general.localization`，按 zh-chs → zh-cht → en-us **逐键**
 *    回退（表是残缺的，逐语言按表回退会漏键）；**查表的键是 text / label 字段
 *    里的 token 本身**（见差异③）；
 *  - `text` 类型是静态说明 / 分节标题，不是输入框（大量 text 属性连 value 都没有）；
 *  - `condition` 只影响本面板的显隐，**绝不在解析时按它过滤** —— 被隐藏的属性的
 *    值仍要完整保留（上游口径：WE 里被隐藏的属性照样下发给壁纸，过滤会让壁纸
 *    读不到值而异常）；
 *  - `editable: false` 是作者在 WE 编辑器里标记的「用户不可编辑」（典型是壁纸
 *    脚本自读自写的工作变量）。WE 的语义是**属性照样下发给壁纸**，只是编辑器里
 *    不显示；**本实现与 WE（及 DSH）一致：整条丢弃** —— 直接 continue，于是它
 *    既不进属性面板、也不进任何下游通道。可观察后果：壁纸脚本拿到的是它自己的
 *    默认值（场景快照里那份），而不是 project.json 里写的那个值。
 *
 * 【与 DSH 的三处有意差异】
 * ① file / directory 类型：DSH 会把候选文件枚举出来渲染成下拉；本机全库
 *    `general.properties` 里没有这两种类型（deep_space 的 replacetexture 在
 *    `templateoptions` 段，不是用户属性），且场景引擎尚未接入、枚举了也没有下游
 *    消费 —— 本步不做候选枚举，面板走文本输入兜底。等分发通道接入时补
 *    `listFiles` 选项（DSH 的 FILE_EXT 分类表也那时再搬）。
 * ② 文案兜底多一层「WE 官方内置文案」词表（见 WE_BUILTIN_TEXT）：DSH 对
 *    `ui_browse_properties_*` 这类键查不到壁纸自带 localization 就原样显示键名；
 *    本机 9 张工坊壁纸的属性文案全是这种键，键名直接摆上界面不成话。
 * ③ **属性文案的 localization 查表键**：DSH 对选项按 label（=token）查表，对
 *    属性却按**属性名**查（`resolveText(project, def.text, name, name)`）——
 *    与 WE 官方文档不符：Property Translation 页（docs.wallpaperengine.io）
 *    写明查表键就是 `text` / `label` 字段里的 token 本身（「properties 里的键
 *    不参与查表」），作者按文档写 `localization[<lang>]["ui_xxx"] = 译文` 时，
 *    DSH 那条路会整个落空、把 token 原样摆上界面。本实现统一按 token 查表
 *    （属性与选项同一条路），按属性名写的表不命中（WE 自己也不会认）。
 * ④ 新增第三方**推广行标记**（promo，2026-10-07）：部分壁纸作者把支持/赞助/
 *    社交入口与二维码图混进 `general.properties`（实测 3308867900 泡水灵梦
 *    113 行里 18 行，本机 31 个 project.json（工坊 10 + WE 自带项目 21）全量
 *    扫描的唯一命中）。这类行对
 *    用户是无效第三方 UI，**面板**不呈现；但绝不整条丢弃 —— 行照常出现在
 *    解析结果里（多一个 `promo: true`），画面推送（WallpaperLayer 的
 *    pushSceneProps）仍是全量，渲染与 WE 侧行为零变化。判定见 isPromoProp：
 *    只对**原始 text 与 key** 匹配（img 行去标签后为空、resolveText 会回退成
 *    200 字符乱码键，拿解析结果匹配会漏判），WE 内置 token 一律豁免。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫：字符串一律英文/键名，中文只许出现在
 * WE_BUILTIN_TEXT / PROMO_KEYWORDS 两张数据表里（它们是「数据表」不是界面
 * 文案，与 copy.ts 的分工同理；copy.test.ts 的例外条目同步解释了这一点）。
 */

/** 属性值的「线格式」：能过 IPC / JSON / 结构化克隆的普通值 */
export type WallpaperPropValue = string | number | boolean

/** 属性类型（未知类型落 'other'，面板按文本输入兜底） */
export const WALLPAPER_PROP_TYPES = [
  'color',
  'bool',
  'slider',
  'combo',
  'text',
  'textinput',
  'file',
  'directory',
  'group',
  'other'
] as const
export type WallpaperPropType = (typeof WALLPAPER_PROP_TYPES)[number]

export interface WallpaperPropOption {
  label: string
  /** 保留声明类型（见文件头 combo 条） */
  value: WallpaperPropValue
  condition?: string
}

/** 面板消费的条目形状（值已合并用户覆盖） */
export interface WallpaperPropEntry {
  name: string
  ptype: WallpaperPropType
  text: string
  order: number
  /** 当前生效值（覆盖优先，否则声明默认）；无值（如未选文件的 file）为 null */
  value: WallpaperPropValue | null
  /** project.json 里声明的默认值；无值为 null */
  default: WallpaperPropValue | null
  overridden: boolean
  /**
   * 第三方推广行标记（作者夹带的赞助/社交入口/二维码图，判定见 isPromoProp）。
   * **只有面板隐藏读它**；画面推送照旧全量带出（见文件头④），别在别的链路按它过滤。
   */
  promo: boolean
  condition?: string
  options?: WallpaperPropOption[]
  min?: number
  max?: number
  step?: number
  precision?: number
  fileType?: string
}

/** 支持的语言标签（按序逐键回退）；表里大小写不敏感 */
const LANG_ORDER = ['zh-chs', 'zh-cht', 'en-us']

/**
 * WE 官方内置文案词表（`ui_*` 键 → 中文）。
 *
 * 【数据源】WE 安装目录 `locale/ui_zh-chs.json`（3320 键）里、本机全部已装壁纸的
 * `general.properties` 实际用到的 23 个键 —— 用官方案例逐个抠出来的，不是手翻。
 * 若工坊新壁纸带来新键：先查那份官方表，抄进这里；**绝不自由发挥**（键名猜错
 * 了不会有人发现，界面会静默显示一串英文键名）。
 */
export const WE_BUILTIN_TEXT: Record<string, string> = {
  ui_browse_properties_scheme_color: '主题配色',
  ui_browse_properties_background_color: '背景色',
  ui_browse_properties_accent_color: '强调色',
  ui_browse_properties_car_body_color: '汽车车身颜色',
  ui_browse_properties_car_stripes_color: '汽车条纹颜色',
  ui_browse_properties_clouds: '云朵',
  ui_browse_properties_count: '计数',
  ui_browse_properties_glow: '发光',
  ui_browse_properties_grid_background: '网格（背景）',
  ui_browse_properties_grid_far: '网格（远处）',
  ui_browse_properties_grid_near: '网格（近处）',
  ui_browse_properties_horizon: '地平线',
  ui_browse_properties_mountain_scale: '山脉比例',
  ui_browse_properties_noise_fx: '噪声效果',
  ui_browse_properties_rims_color: '轮辋颜色',
  ui_browse_properties_shading: '着色',
  ui_browse_properties_style: '风格',
  ui_browse_properties_sun_bottom: '太阳底部',
  ui_browse_properties_sun_top: '太阳顶部',
  ui_editor_properties_brightness: '亮度',
  ui_editor_properties_length: '长度',
  ui_editor_properties_mode: '模式',
  ui_editor_properties_speed: '速度'
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 能过 JSON 的三元组值，其余（对象/数组/null）视为无效 */
function toWire(raw: unknown): WallpaperPropValue | undefined {
  return typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? raw : undefined
}

function orderOf(def: Record<string, unknown>): number {
  const n = Number(def.order)
  return Number.isFinite(n) ? n : 0
}

/** 非空字符串字段 */
function strField(v: Record<string, unknown>, key: string): string | undefined {
  const s = v[key]
  if (typeof s !== 'string') return undefined
  const t = s.trim()
  return t === '' ? undefined : t
}

/** 去标签 + 解常见实体（WE 属性文案里带 HTML 是常态） */
function stripHtml(raw: string): string {
  if (raw === '') return ''
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

/** localization 查表：{ lang: { key: text } }，语言标签大小写不敏感、逐键回退 */
function lookupLocalization(project: unknown, key: string): string | undefined {
  const general = isObject(project) ? project.general : undefined
  const table = isObject(general) ? general.localization : undefined
  if (!isObject(table)) return undefined
  // 表里的语言名大小写不一（zh-CHS / en-US 都出现过）：先做一次小写索引
  const byLang: Record<string, unknown> = {}
  for (const k of Object.keys(table)) byLang[k.toLowerCase()] = table[k]
  for (const lang of LANG_ORDER) {
    const entry = byLang[lang]
    if (isObject(entry) && typeof entry[key] === 'string') return entry[key]
  }
  return undefined
}

/** 属性/选项文案：localization（**键 = 文案 token 本身**，见差异③）→ 官方内置词表 → 原文（去标签）→ 回退值 */
function resolveText(project: unknown, raw: unknown, fallback: string): string {
  // 没写 text / label（raw 为空）时跳过查表，直接走内置词表与回退值
  const loc = typeof raw === 'string' && raw.trim() !== '' ? lookupLocalization(project, raw) : undefined
  const src = typeof loc === 'string' && loc.trim() !== '' ? loc : raw
  const clean = stripHtml(typeof src === 'string' ? src : '')
  if (clean !== '' && Object.prototype.hasOwnProperty.call(WE_BUILTIN_TEXT, clean)) return WE_BUILTIN_TEXT[clean]
  return clean !== '' ? clean : fallback
}

/** project.json 属性值 → 线格式；无值（如未选文件的 file）返回 undefined */
function wireValue(ptype: WallpaperPropType, def: Record<string, unknown>): WallpaperPropValue | undefined {
  if (!('value' in def)) return undefined
  const raw = def.value
  if (raw === null || raw === undefined) return undefined
  switch (ptype) {
    case 'color':
      return typeof raw === 'string' ? raw : undefined
    case 'bool':
      return typeof raw === 'boolean' ? raw : undefined
    case 'slider': {
      const n = typeof raw === 'number' ? raw : Number(raw)
      return Number.isFinite(n) ? n : undefined
    }
    case 'combo':
      // 保留声明类型（数字 / 字符串 / 布尔混用）
      return toWire(raw)
    default: {
      if (typeof raw === 'string') return raw
      const s = JSON.stringify(raw)
      return typeof s === 'string' ? s : undefined
    }
  }
}

/** 只有带 `type` 的条目算真属性（跳过 tip / ui_* 之类的纯显示项） */
function rawProps(project: unknown): Array<[string, Record<string, unknown>]> {
  const general = isObject(project) ? project.general : undefined
  const props = isObject(general) ? general.properties : undefined
  if (!isObject(props)) return []
  const out: Array<[string, Record<string, unknown>]> = []
  for (const [name, v] of Object.entries(props)) {
    if (isObject(v) && typeof v.type === 'string') out.push([name, v])
  }
  // order 浮点升序；并列按码位（不是 localeCompare，见文件头）
  out.sort((a, b) => orderOf(a[1]) - orderOf(b[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return out
}

/**
 * 推广行窄关键词表（isPromoProp 的规则 R3）—— **数据表，绝不许加宽**。
 *
 * 【为什么是这张表】只收「赞助 / 打赏入口」本身的地道说法。定稿时明确排除
 * 了一整批看似相关、实则高频误杀的词：点击跳转 / 链接 / url / about / qq /
 * 群 —— 尤其 link 类匹配会误杀 `Blink Animation` 这种遍地都是的合法属性文案。
 * 表内拉丁词一律小写（匹配时把被查串统一 toLowerCase，两边对齐）。
 */
const PROMO_KEYWORDS = [
  '赞助',
  '打赏',
  '捐赠',
  '投喂',
  '爱发电',
  'afdian',
  '微信',
  'wechat',
  '公众号',
  '关注',
  '二维码',
  '扫码',
  '加群',
  '交流群',
  '三连',
  '个人主页',
  '关于作者',
  '鸣谢',
  '支持一下',
  '你们的支持',
  '充电',
  '投币',
  '赞赏',
  'sponsor',
  'donate',
  'paypal',
  'patreon',
  'bilibili',
  'pixiv'
]

/** R1 结构标记：URL / 图片标签 / 带 href 的 a 标签（大小写不敏感） */
const PROMO_RE_STRUCT = /https?:\/\/|www\.|<img\b|<\s*a\b[^>]*href/i

/** R2 的名字长度门槛：> 24 才算「WE 自动生成的垃圾键」（img 键动辄 100+ 字符） */
const PROMO_BARE_NAME_MIN = 24

/**
 * 判定一条用户属性是不是「第三方推广行」（面板隐藏读它，画面链路不看它，见文件头④）。
 *
 * 【匹配对象必须是原始 text 与 key，不能用 resolveText / 显示名解析结果】带 img
 * 标签的行去标签后为空，resolveText 会回退成 `name` —— 而 WE 自动生成的键是
 * 200 字符乱码（如 3308867900），拿解析结果匹配既漏 R1（URL 藏在被剥掉的标签
 * 里）、又可能拿乱码键撞关键词。三条规则：
 *   R1 结构：text/key 出现 http(s):// 、www. 、img 标签或带 href 的 a 标签；
 *   R2 纯图/无文字：text 去标签后为空、且显示名（= 回退的 key）长于 24；
 *   R3 窄关键词：text/key 命中 PROMO_KEYWORDS（不许加宽）。
 * WE 内置 token（ui_* 文案键）是官方系统属性、一律豁免 —— 当前 23 键里没有任何
 * 一条会撞上规则，这是给未来新增键留的保险（改表时不必再回来核一遍）。
 */
export function isPromoProp(def: Record<string, unknown>, name: string): boolean {
  const text = typeof def.text === 'string' ? def.text : ''
  const plain = stripHtml(text)
  // 内置 token 豁免：与 resolveText 的内置词表命中同口径（按去标签后的 token 查表）
  if (plain !== '' && Object.prototype.hasOwnProperty.call(WE_BUILTIN_TEXT, plain)) return false
  // text 与 key 拼成一个 haystack（\n 分隔，防「text 尾巴 + key 开头」拼出假关键词）
  const haystack = text + '\n' + name
  if (PROMO_RE_STRUCT.test(haystack)) return true
  if (plain === '' && name.length > PROMO_BARE_NAME_MIN) return true
  const lower = haystack.toLowerCase()
  return PROMO_KEYWORDS.some((kw) => lower.includes(kw))
}

/**
 * 解析成面板用的属性列表（顺序照 project.json 的 order）。
 *
 * @param project  project.json 的原文（对象；读不到就传 null）
 * @param overrides 用户覆盖值 `{name: value}`（来自 wallpaper.itemProps[itemId]）
 */
export function parseUserPropDefs(project: unknown, overrides: unknown): WallpaperPropEntry[] {
  const ov = isObject(overrides) ? overrides : {}
  const out: WallpaperPropEntry[] = []
  for (const [name, def] of rawProps(project)) {
    // 作者标记「用户不可编辑」：整条丢弃（面板与下游都不含它，见文件头）
    if (def.editable === false) continue
    // 第三方推广行（赞助/社交入口/二维码图）：只打标记、**不丢行**（见文件头④与 isPromoProp）
    const promo = isPromoProp(def, name)
    const ptypeRaw = String(def.type || 'other')
    const kind: WallpaperPropType = (WALLPAPER_PROP_TYPES as readonly string[]).includes(ptypeRaw)
      ? (ptypeRaw as WallpaperPropType)
      : 'other'
    const dflt = wireValue(kind, def)
    const hasOv = Object.prototype.hasOwnProperty.call(ov, name)
    const ovVal = hasOv ? toWire(ov[name]) : undefined
    // 覆盖值本身无效（非三元组）时视为没覆盖 —— 覆盖值来自我们自己的配置 store，
    // 净化过；这一层是防「手改配置文件的怪值」把面板带崩
    const overridden = hasOv && ovVal !== undefined
    const value = overridden ? ovVal : dflt
    const entry: WallpaperPropEntry = {
      name,
      ptype: kind,
      text: resolveText(project, typeof def.text === 'string' ? def.text : '', name),
      order: orderOf(def),
      value: value === undefined ? null : value,
      default: dflt === undefined ? null : dflt,
      overridden,
      promo
    }
    const cond = strField(def, 'condition')
    if (cond) entry.condition = cond
    if (Array.isArray(def.options)) {
      const options: WallpaperPropOption[] = []
      for (const o of def.options) {
        if (!isObject(o) || typeof o.label !== 'string' || !('value' in o)) continue
        const optVal = toWire(o.value)
        if (optVal === undefined) continue
        const opt: WallpaperPropOption = {
          label: resolveText(project, o.label, String(o.value)),
          value: optVal
        }
        const oc = strField(o, 'condition')
        if (oc) opt.condition = oc
        options.push(opt)
      }
      if (options.length) entry.options = options
    }
    if (Number.isFinite(Number(def.min))) entry.min = Number(def.min)
    if (Number.isFinite(Number(def.max))) entry.max = Number(def.max)
    if (Number.isFinite(Number(def.step))) entry.step = Number(def.step)
    if (Number.isFinite(Number(def.precision))) entry.precision = Number(def.precision)
    const ft = strField(def, 'fileType')
    if (ft) entry.fileType = ft
    out.push(entry)
  }
  return out
}

/** 只保留 project.json 里声明过的覆盖值（属性被作者删掉后，陈旧覆盖值忽略） */
export function filterKnownOverrides(project: unknown, overrides: unknown): Record<string, WallpaperPropValue> {
  const ov = isObject(overrides) ? overrides : {}
  const declared = new Set(rawProps(project).map(([name]) => name))
  const out: Record<string, WallpaperPropValue> = {}
  for (const [name, v] of Object.entries(ov)) {
    if (!declared.has(name)) continue
    const w = toWire(v)
    if (w !== undefined) out[name] = w
  }
  return out
}
