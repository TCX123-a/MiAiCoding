/**
 * 大肥鱼仓库（P3 ⑨）的**纯函数** —— 把「我收集到了哪几张」翻成图鉴格子视图模型，
 * 外加下载三态的 toast 映射。
 *
 * 【为什么判定全在这一个文件里，不进 WarehouseView.vue】
 * `views/` 不在 vitest 的 include 范围内（见 vitest.config.ts）—— 写进视图的
 * 边界判断（一张都没有、集齐了、老档案里躺着一个已被删掉的 id）**永远不会有测试**。
 * 收藏页与备忘录都在抬头记过同一条教训，仓库从出生就把算式放在能被测的地方。
 *
 * 【格子的唯一真源是 `shared/gallery.ts` 的 GALLERY_IDS】
 * 图库增删（主人挑图、png 换 webp）时唯一要动的是那张表；这里只负责"按表逐格翻"。
 * 格子总数 = 表长由单测钉住 —— 表又挪了而别处忘改会**先红在测试里**，
 * 而不是在界面上悄悄丢掉几张。
 *
 * 【列数为什么不在这儿（2026-10-09 UI 大修轮）】图池 12 → 50 之后，网格从
 * "4×3 与表长绑死"改成 CSS `auto-fill` 自适应：列数由容器宽度决定
 * （见 WarehouseView 的 `.wh-grid`），表再长一截也不用动这个文件 ——
 * 旧的 WAREHOUSE_COLS / WAREHOUSE_ROWS 两个硬编码常量随之退役。
 *
 * 【为什么取图函数（urlOf）从外面注入，不直接 import lib/gallery】
 * `lib/gallery.ts` 里的 `import.meta.glob` 是 Vite 的编译期语法，node 里跑不了
 * （它的抬头与 gallery.test.ts 都记过这一条）—— 本文件一旦 import 它，
 * 就进不了单测。注入之后：视图传真的 `rewardImageUrl`，测试传一个"来者不拒
 * 且留痕"的假货，于是「未知 id 连取图这一步都不会走到」这种事才有可能被断言。
 */
import { GALLERY_IDS } from '../../../shared/gallery'
import { GALLERY } from './copy'
import type { GallerySaveResult } from '../../../shared/types'
import type { ToastType } from '../components/base/toast'

/** 一格：图库里的一张图 + 我有没有它 + 打包后去哪取（取不到是 null） */
export interface WarehouseCell {
  id: string
  owned: boolean
  /** 只有 owned 的格子才会给地址；locked 恒 null（视图据此不画 `<img>`，见 WarehouseView） */
  url: string | null
}

/** 整张网格：格 + 两个计数（视图上的「已收集 N / M 张」直接用，不另算一遍） */
export interface WarehouseGrid {
  cells: WarehouseCell[]
  /** owned 的格数。**只数表里认得的 id** —— 老档案里的陌生 id 不算数（见下） */
  ownedCount: number
  total: number
}

/**
 * 把档案里的收集清单翻成图鉴格子视图模型（格数 = GALLERY_IDS.length）。
 *
 * 【为什么遍历 GALLERY_IDS 而不是遍历 owned】
 * owned（`profile.rewards.gallery`）是**用户档案**，可能带着历史包袱：
 * 主人删过图之后，老档案里会留着一个已经不存在的 id（`shared/gallery.ts`
 * 抬头那段说清了）。遍历 owned 的话它要么占掉一格、要么让格子数对不上表；
 * 遍历表则是"表说了算"—— 陌生 id 静默忽略（它既不占名额、也不进格）。
 *
 * 【url 只在 owned 的格子上求】locked 的格子画的是占位符，不需要地址；
 * 少问一次就少一次"为了不渲染的东西去碰 glob 表"的机会（也让单测里
 * 「一张都没有时取图器一次都没被问过」这条断言成立）。
 *
 * 纯函数：不改入参、不读全局、同样的入参给同样的结果（urlOf 也一样）。
 */
export function buildWarehouseGrid(
  owned: readonly string[],
  urlOf: (id: string) => string | null
): WarehouseGrid {
  const have = new Set(owned)
  const cells: WarehouseCell[] = GALLERY_IDS.map((id) => {
    const isOwned = have.has(id)
    return { id, owned: isOwned, url: isOwned ? urlOf(id) : null }
  })
  return {
    cells,
    // 数格而不是数 owned.length：重复的 id 不双算，陌生 id 不入账 —— 两个口子都在这一行关掉
    ownedCount: cells.filter((c) => c.owned).length,
    total: cells.length
  }
}

/**
 * 「保存奖励图」的三态 → 该弹哪句 toast（P3 ⑨，修正案 C8）。
 *
 * 【为什么值得单写一个函数】下载按钮走的是**既有 IPC**（gallery:save-image，
 * 主进程 app.ts 里那段：卡值域 → 找文件 → 弹系统另存框 → 拷贝），
 * 三态（存好/用户取消/失败）在应用里原本只有 RewardDialog 里 inline 的一段 ——
 * 全仓没有自动化覆盖（C8 复核结论）。抽成纯函数之后，「取消不是错误」
 * 「图找不到也是失败」这两条口径就有单测钉着，而不是靠肉眼看弹窗。
 *
 * 【文案复用 GALLERY.SAVE_\*，不另写三句】同一条链上同一件事的同一句话 ——
 * 仓库再写三句就是第二份会漂移的真源（契约 §4 也点名复用）。
 */
export function saveToastOf(res: GallerySaveResult): { text: string; type: ToastType } {
  if (res.ok) return { text: GALLERY.SAVED(fileNameOf(res.path)), type: 'success' }
  if (res.reason === 'cancelled') return { text: GALLERY.SAVE_CANCELLED, type: 'info' }
  // missing（认不出的 id / 源文件找不到）与 failed（拷贝出错）对用户是同一句话：
  // "这次没存成"。日志里分辨它们（主进程那段的 console.error）就够排查用了。
  return { text: GALLERY.SAVE_FAILED, type: 'error' }
}

/**
 * 取路径最后一段 —— 保存成功的 toast 里只报文件名（全路径太长，同 RewardDialog）。
 * 两种分隔符都认：Windows 上是 `\\`，而测试与将来别的形态可能是 `/`。
 */
export function fileNameOf(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}
