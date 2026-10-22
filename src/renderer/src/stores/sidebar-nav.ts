/**
 * 侧栏手风琴的折叠状态读写口（localStorage）—— 视图侧一半。
 *
 * 【为什么不进 config.json】同 zoom.ts / wall-hidden.ts 的 doctrine：它是
 * **纯视图偏好**（「我习惯把哪组收起来」），不是学习数据。进 config 要动
 * schema/迁移/合并三处，那条路上任何一处写错，最坏结果是学习进度被静默
 * 清零；收益只是少一个 localStorage 键。键名自带版本号
 * `miai:sidebar-nav:v2`（同 zoom / wall-hidden 的口径）。
 *
 * 【v1 → v2 为什么换键（2026-10-10 侧栏 IA 重构）】折叠图的形状变了：
 * 四组（learn / review / me / lessons）→ 三组（learn / review / me，
 * 知识点课列表并进学习组）。doctrine 是「改形状必须换键」—— 与其让旧四键
 * 存档在新归一化里被整体作废、或半截放行出怪行为，不如从零开始：没存过
 * 就是自动态（跟随路由），用户没做过的新选择不该被旧形状的灰数据影响。
 * 旧 v1 键就留在那儿不读不删（读它就要猜旧形状，那正是换键要避开的事）。
 *
 * 【为什么没存过 = null，而不是直接给默认图】「自动态」与「用户选择」是两
 * 种状态：没存过 → 每次进应用按**当前路由**自动展开（你落在哪组就开哪组）；
 * 存过 → 用户点过组头，从此他说了算（哪怕三组全收起也是他的选择）。
 * 自动态的推导是纯函数 defaultOpenMap（lib/sidebar-nav.ts）；本 store 不
 * 掺路由 —— 拿「当前生效图」当入参由调用方给（store 不依赖 router）。
 * 落盘只发生在 toggle 那一刻；挂载时不写（写了「自动」就成一次性快照，
 * 重启后不再跟随路由）。
 *
 * 【读写全包 try/catch】同 wall-hidden：打包后渲染进程是 file:// 起源，
 * localStorage「通常能用、但没有任何东西保证」——拿不到就降级成「只在本
 * 进程有效」，绝不让一个视图开关把应用卡在启动上。
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'
import {
  flipGroup,
  normalizeOpenMap,
  soloToggleGroup,
  type NavGroupId,
  type NavOpenMap
} from '../lib/sidebar-nav'

/** 存储键自带版本号，理由见文件头（v1→v2 = 四组→三组那次形状变更） */
const STORAGE_KEY = 'miai:sidebar-nav:v2'

function readStored(): NavOpenMap | null {
  try {
    const s = window.localStorage.getItem(STORAGE_KEY)
    if (s === null) return null
    return normalizeOpenMap(JSON.parse(s))
  } catch {
    return null
  }
}

function writeStored(map: NavOpenMap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // 存不下就算了，见文件头。故意不 warn：用户看不到控制台。
  }
}

export const useSidebarNavStore = defineStore('sidebar-nav', () => {
  /** null = 自动态（跟随路由）；非 null = 用户显式选择（三键齐全） */
  const explicit = ref<NavOpenMap | null>(readStored())

  /**
   * 【唯一写口】点组头进来：以「当前生效图」为底翻一格、整图落盘。
   * effective 由调用方算（自动态时是按路由推的那张）——这样第一次点组头
   * 存下来的就是「眼前所见 + 这一翻」，不会把手势做一半丢掉。
   */
  function toggle(id: NavGroupId, effective: NavOpenMap): void {
    const next = flipGroup(effective, id)
    explicit.value = next
    writeStored(next)
  }

  /**
   * 【手风琴·现行写口，2026-10-10 主人批·图一】点组头进来：开一组就收起其它
   * 两组；点已开组 = 全收。语义在纯函数 soloToggleGroup（lib/sidebar-nav.ts，
   * 有单测）。与 toggle 同一套底账（effective 由调用方给「当前生效图」、
   * 整图落盘 v2 键）—— 两个写口的落盘形状分毫不变，只差「下一张图怎么算」。
   * 【toggle 为什么不删】它是「只翻指定键」的既有契约（另有用例钉着），
   * 本次一个字不动。
   */
  function toggleSolo(id: NavGroupId, effective: NavOpenMap): void {
    const next = soloToggleGroup(effective, id)
    explicit.value = next
    writeStored(next)
  }

  return { explicit, toggle, toggleSolo }
})
