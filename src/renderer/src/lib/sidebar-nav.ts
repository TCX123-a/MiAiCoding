/**
 * 侧栏手风琴的折叠状态（2026-10-09，「侧边栏 UI 收纳」模块）。
 *
 * 【为什么是 lib 纯函数】仓库惯例：组件/视图不进 vitest（node 环境没有 vue
 * 插件，.vue 只能做静态源码断言）—— 能测的逻辑一律落 lib 配单测（同
 * tab-nav.ts / overview.ts 的处境）。「路由 → 默认展开哪组」与「存量 JSON
 * 归一化」恰好是这块里仅有的两处判断逻辑。
 *
 * 【2026-10-10 侧栏 IA 重构：第 4 组「知识点」撤销】原先是 3 个导航组
 * （learn / review / me）+ 1 个侧栏独有的手风琴组（lessons = 知识点课列表），
 * 四组平行 —— 主人裁定「点学习才看到语言、点知识点才看到课」反直觉。
 * 课列表整块并进学习组（见 Sidebar.vue），于是本表回到三组：
 * learn / review / me，与 FullscreenMenu.vue 的 MenuGroup（learn/review/me
 * 三组 + tools 工具区）逐一对齐。折叠图的形状随之变化（四键 → 三键），
 * 落盘键已换 v2（理由见 stores/sidebar-nav.ts）。
 */

export const NAV_GROUP_IDS = ['learn', 'review', 'me'] as const

export type NavGroupId = (typeof NAV_GROUP_IDS)[number]

/** 三组的开合布尔集（每键必在 —— 缺键由 normalizeOpenMap 整体拒绝） */
export type NavOpenMap = Record<NavGroupId, boolean>

/**
 * 路由名 → 它属于哪一组（「默认只展开正在使用的模块」的唯一判据）。
 * 兜底 learn：settings 之类不隶属任何组的页，回到主人点名的默认组。
 * （overview?card=checkin 看 route.name 就够，不看 query —— query 只是页内定位。）
 *
 * 【lesson 为什么也回 learn】2026-10-10 IA 重构后课列表就在学习组内部：
 * 读课（课详情路由）时默认展开「学习」组，左侧直接是语言 + 阶段 + 课列表，
 * 不再需要先点一下 —— 这正是本轮重构要消掉的那一步。
 */
export function groupOfRoute(name: string | null | undefined): NavGroupId {
  switch (name) {
    case 'review':
    case 'challenge':
    case 'favorites':
    case 'warehouse':
      return 'review'
    case 'overview':
    case 'leaderboard':
    case 'login':
      return 'me'
    default:
      // learn / practice / playground / memo / lesson（课详情，见上方注释）
      // 与 settings/未知一律回学习组
      return 'learn'
  }
}

/** 自动态（用户还没点过任何组头）的展开图：只开当前路由所在的那一组 */
export function defaultOpenMap(name: string | null | undefined): NavOpenMap {
  const g = groupOfRoute(name)
  return { learn: g === 'learn', review: g === 'review', me: g === 'me' }
}

/**
 * 存量归一化：三键齐、键键是布尔才认；差一键整体作废（null = 当作没存过，
 * 回到自动态）。偏严是有意的 —— 半截数据放行，界面上就是某组莫名消失。
 * 多余键忽略（未来版本加了新组也不会把这份 JSON 判死）。
 * 旧四键（含 lessons）的 v1 存档在换键后根本读不到，不会走到这里 ——
 * 「不猜旧形状」靠换键保证，不靠这里（见 stores/sidebar-nav.ts 文件头）。
 */
export function normalizeOpenMap(raw: unknown): NavOpenMap | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const out = {} as NavOpenMap
  for (const id of NAV_GROUP_IDS) {
    const v = o[id]
    if (typeof v !== 'boolean') return null
    out[id] = v
  }
  return out
}

/** 点一次组头：只翻它、其余原样（返回新对象，别让调用方拿到旧引用改出幽灵态） */
export function flipGroup(map: NavOpenMap, id: NavGroupId): NavOpenMap {
  return { ...map, [id]: !map[id] }
}

/**
 * 手风琴口径的「点一次组头」（2026-10-10 主人批·图一）：该组关着 → 只开它、
 * 其余两组全收；该组开着 → 三键全收（「点已开组 = 收起」，全收是合法选择，
 * 与 normalizeOpenMap 对全 false 的认口径一致）。「开一组 = 其余让位」是这次
 * 产品决定，不是把 flipGroup 拧一下 —— 所以单独开一条路，flipGroup 的
 * 「只翻指定键」契约原样保留（另有用例钉着，别动）。
 *
 * 纯函数纪律同 flipGroup：返回新对象、不动入参（旧引用会养出幽灵态）；
 * 键集恒是 NAV_GROUP_IDS 三键 —— 入参上多挂的键不会被复制进来（与
 * normalizeOpenMap 的「多余键忽略」同一条口径）。
 */
export function soloToggleGroup(map: NavOpenMap, id: NavGroupId): NavOpenMap {
  const open = !map[id]
  const next = {} as NavOpenMap
  for (const g of NAV_GROUP_IDS) next[g] = open && g === id
  return next
}
