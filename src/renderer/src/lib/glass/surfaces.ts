/**
 * 哪些界面元素算「液态玻璃面」—— 折射环要围着它们长。
 *
 * 【为什么只有三块固定框架，不含卡片】
 * 折射贴图是**按面板当前的屏幕矩形**画的（位置一变就得重画整张贴图：
 * 重算像素 + PNG 编码 + feImage 重新解码，一次 10ms 量级）。侧栏/顶栏/右栏
 * 是固定框架，位置只在「改窗口大小 / 折叠侧栏 / 切路由」时动 —— 那几种时刻
 * 重画一次完全可以接受。
 *
 * 内容区的卡片不一样：它们在滚动容器里，每滚一像素矩形就变了。把卡片纳入
 * 折射意味着滚动时每 100ms 重画一次贴图（≈ 10% 单核 + 镜头边缘永远慢半拍），
 * 换来的是「滚动时卡片边缘那圈折射」—— 代价和收益完全不成比例。所以卡片
 * 保持现状（受 --mi-panel-alpha 控制的半透底 + 下面的圆角高光纹理），
 * **不参与折射**。这条是主动取舍，不是漏了。
 *
 * 【选择器为什么用这些】
 *   · .sidebar / .topbar / .right-panel —— 三块的底都是 --mi-*-glass，是
 *     wall-glass.test.ts IN 清单里的容器面，和折射面的定义天然对齐。
 *   · 不用 .mi-card：那是「所有卡片」，包括上面说的滚动内容。
 *
 * 【本文件被文案闸门扫】字符串一律英文，中文只出现在注释里。
 */

import type { LensRect } from './lens-map'

/** 一个折射面：怎么找（selector）+ 叫什么（key，探针与日志用） */
export interface LensSurfaceSpec {
  key: string
  selector: string
}

/**
 * 折射面清单。顺序无关（每块各画各的矩形）。
 * 右栏整块取一次：它内部还有两个分区底（同为玻璃令牌），但**整栏的矩形**
 * 才是「一块玻璃板」的边界 —— 内部分区不需要各自的折射环，那会像碎玻璃。
 */
export const LENS_SURFACES: readonly LensSurfaceSpec[] = [
  { key: 'sidebar', selector: '.sidebar' },
  { key: 'topbar', selector: '.topbar' },
  { key: 'rightPanel', selector: '.right-panel' }
]

/** 圆角兜底：读不到 computedStyle（测试桩 / 元素已卸载）时当直角 */
const FALLBACK_RADIUS = 0

/**
 * 量出所有折射面的屏幕矩形（CSS px，**不裁到视口**）。
 *
 * 【为什么故意不裁】玻璃面经常比视口高（侧栏从窗口顶铺到底）。裁一刀会让
 * 「原本在屏幕外的底边」变成一条**屏幕内的假边**，贴图就会在那儿长出一圈
 * 不该有的折射环（而且只在窗口高度不够时出现 —— 最难查的那类）。不裁的话
 * 真实边缘该在哪儿就在哪儿，屏幕外的部分自然落在贴图之外。贴图绘制那侧
 * 本来就会把包围盒夹到画布范围内（见 lensMapPixels），不会多花算力。
 *
 * 尺寸为 0 / 没渲染（display:none）的元素直接跳过 —— 它们不是玻璃面。
 */
export function measureLensRects(doc: Document): LensRect[] {
  const out: LensRect[] = []
  for (const spec of LENS_SURFACES) {
    const el = doc.querySelector(spec.selector)
    if (!(el instanceof HTMLElement)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    out.push({
      x: r.left,
      y: r.top,
      w: r.width,
      h: r.height,
      radius: readRadius(el)
    })
  }
  return out
}

/**
 * 圆角半径取元素自己的（左上角那一个）。三块的面都是四个角同值；读真实值
 * 而不是在清单里写死数字，改 CSS 时贴图自动跟上 —— 这类「两处各写一份、
 * 迟早对不上」的重复正是本仓库反复踩过的坑。
 */
function readRadius(el: HTMLElement): number {
  try {
    const raw = getComputedStyle(el).borderTopLeftRadius
    const v = Number.parseFloat(raw)
    return Number.isFinite(v) && v > 0 ? v : FALLBACK_RADIUS
  } catch {
    return FALLBACK_RADIUS
  }
}

/**
 * 几何指纹：矩形集合 + 贴图尺寸合成一个字符串，**只用来判断「要不要重画」**。
 * 用 JSON 而不是哈希：这串只在内存里比，长度也就几十字节，出问题时还得
 * 能一眼读出来是哪块动了（哈希看不了）。
 */
export function rectsSignature(rects: readonly LensRect[], outW: number, outH: number): string {
  const parts = rects.map((r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)},${Math.round(r.radius)}`)
  return `${outW}x${outH}|${parts.join('|')}`
}
