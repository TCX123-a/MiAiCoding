/**
 * 液态玻璃的**折射贴图**（纯函数，无 DOM、无副作用）。
 *
 * 【它在整条链路里的位置】
 * 渲染层往一张全屏 canvas 上重画一遍壁纸（镜像画布，0.5 缩放），画布上挂一个
 * 元素级 SVG 滤镜：
 *   feImage(本文件产出的贴图) → feGaussianBlur(镜像) → feDisplacementMap → feComposite(in, 贴图)
 * 贴图既是**位移场**（R/G 通道 = 该像素该往哪偏、偏多少）又是**遮罩**
 * （alpha = 这个像素算不算「压在玻璃底下」）。于是：面板矩形内 = 磨砂镜像
 * （背景模糊），面板边缘一圈 = 位移（光折射），矩形外 = 透明（原壁纸照常）。
 *
 * 【为什么贴图是「半分辨率 + 数值就是 CSS 像素」】
 * 贴图以 0.5 缩放存（见 refraction.ts 的 MAP_SCALE），再由 feImage 用
 * preserveAspectRatio='none' 拉回全屏。**通道值不会因为拉伸而变**：R=128+d
 * 到哪儿都还是「往右采 d 像素」。所以位移量直接在贴图里以 CSS 像素记账，
 * 滤镜那边的 scale 定死 255（(R/255-0.5)*255 = R-128 = d，一一对应）。
 * 于是单测可以只验这个纯函数，不必起浏览器。
 *
 * 【通道约定（和 exp2/exp3/exp4 三次实验里的判据完全一致）】
 *   · R = 128 + 水平位移；左边缘向外法线是 (-1,0) ⇒ 位移取反得 +x ⇒ R > 128
 *   · G = 128 + 垂直位移；上边缘 G > 128、下边缘 G < 128
 *   · B 恒 0（feDisplacementMap 不看它）
 *   · A = 255 在面板矩形内（含圆角），矩形外 0
 * 位移方向取「**向内**」：最外一圈像素采的是面板内侧的画面 —— 这就是玻璃边缘
 * 那圈「把背景压进来」的折射感（实验 M0/M1 的相位扫描验过：左环带 R 255→128）。
 *
 * 【三个可调量各自对应什么观感】
 *   · ring（环宽）—— 玻璃有多厚。环越宽，边缘那圈「厚玻璃」越明显。
 *   · strength（强度）—— 折射有多狠。0 = 贴图退化成纯遮罩（只剩磨砂）。
 *   · bottomBoost —— **玻璃底部畸变**：底下那圈比左右上更厚更狠（真实玻璃板
 *     下缘总是积得更厚、像水滴坠着），默认 1.35。
 *   · cornerBoost —— **水滴张力**：圆角处环带加宽（表面张力把液体拉成圆角饱满
 *     的一坨），默认 1.25。
 *
 * 【本文件被文案闸门扫】字符串一律英文，中文只出现在注释里。
 */

/** 一个玻璃面的屏幕矩形（CSS 像素，视口坐标）。radius = 圆角半径 */
export interface LensRect {
  x: number
  y: number
  w: number
  h: number
  radius: number
}

/** 出图参数（全部 CSS 像素；scale 是贴图缩放，见文件头） */
export interface LensMapOpts {
  /** 环带宽度：边缘往内多少像素之内发生位移 */
  ring: number
  /** 最大位移量 */
  strength: number
  /** 底边环宽倍率（玻璃底部畸变） */
  bottomBoost: number
  /** 圆角处环宽倍率（水滴张力） */
  cornerBoost: number
  /** 贴图缩放（0.5 = 半分辨率） */
  scale: number
}

export const LENS_DEFAULTS: Omit<LensMapOpts, 'scale'> = {
  ring: 30,
  strength: 22,
  bottomBoost: 1.35,
  cornerBoost: 1.25
}

/**
 * 贴图里的**归一化基准**：出图时按「最大位移 = 100 个通道级」记账，
 * 真实强度由滤镜的 scale 换算（scale = strength × 255 / 100）。
 *
 * 【为什么要脱开】强度滑杆是拖动交互：若位移量烧进贴图，每拖一格都要
 * 重算像素 + PNG 编码 + feImage 重解码（10ms 量级），拖起来就是一顿一顿的。
 * 归一化之后，拖强度 = 改一个 SVG 属性（瞬间），同一个贴图还能被「流动」
 * 的呼吸调制复用 —— 贴图只在**几何**（矩形/环宽/圆角加成）变化时才重画。
 * 100 落在 0..255 中间偏上：离两端都留足余量，不会因为边缘像素被钳位
 * 而在折射环外缘压出一条平顶。
 */
export const LENS_MAP_UNIT = 100

/** 位移通道的中性值 —— 128 = 不偏。feDisplacementMap 的 0.5 点 */
export const LENS_NEUTRAL = 128

/** 单点采样结果：位移（CSS px，可为负）+ 是否落在玻璃矩形内 */
export interface LensSample {
  ox: number
  oy: number
  inside: boolean
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/**
 * 轴向 tie-break 的软化半宽（单位 = mx-my，≈ 垂直方向 (TIE_SOFT×√2)/2 像素）。
 *
 * 【为什么需要】取「哪个轴离内缩矩形边界更近」做轴向法线时，x/y 两分支在
 * mx = my 的对角线列上硬切换：ny 整段 0 ↔ ±1 跳变。bottomBoost 的因子吃 ny，
 * 于是环宽在两条对角落线上整圈跳（200×120 / 圆角 16 / ring 30 / boost 1.35，
 * (120,200) 与 (270,190) 实测 25.93 与 17.40 个通道级/0.25px）。
 * 软混后方向在过渡带内连续旋转，±TIE_SOFT 之外与纯轴向**逐位相同**。
 * 取 10 的边界：rad=0 细条测试点 (0,10)（mx-my = -10）必须仍是纯 x-轴向
 * （见 __tests__「rad = 0 的矩形在轴边界点上是确定值」）。
 */
const TIE_SOFT = 10

/**
 * tie-break 软化带的**深度加宽**：T_eff = TIE_SOFT + TIE_DEPTH × min(|sd|, CAP)。
 *
 * 【为什么还要随深度加宽】tie 软混让 ny 在过渡带内以有限斜率爬升，但环宽
 * 因子乘以的 |sd|（到边的深度）在带底最大 —— 200×120/r16 面板在角对角线上
 * 深 20px 处，0.25px 一步仍有 2.39 个通道级（TIE_SOFT=10 定宽时实测）。
 * 让软化带宽随深度线性加宽：深处窗口放到 40（斜率 ÷4），而**深度的存在
 * 意味 t 曲线斜率 p' 还富余**，两下抵消。sd = 0（遮罩边界）处窗口仍是 10 ——
 * 「(0,10) 是纯 x-轴向」（rad=0 细条测试）这类边界点的逐位精确性由此保住；
 * 深 20 处 mx-my = ±40 的两点（(120,160)/(200,200)）仍精确纯轴向：
 * T_eff(20) = 40，w(−40) = 1−40/80 = 0、w(80) = 1（80/80+0.5 被钳）✓。
 */
const TIE_DEPTH = 1.5
const TIE_DEPTH_CAP = 20

/**
 * 径向方向向轴向软混方向收拢的带宽（单位 = len：径向分支下到最近内缩边界
 * 点的像素距离，即 max(ddx,ddy) 的模）。
 *
 * 【为什么需要】径向分支的方向场在内缩矩形角点附近旋转速率 ~1/len 无界：
 * (116,204) 角点旁一步 0.25px 内，单位方向从 (−0.1,0.99) 扫到 45°，
 * bottomBoost 的因子 bf(ny) 跟着 ny 一起被这个无界旋转率放大，留下
 * 11.3 个通道级/0.25px 的台阶（2026-10-09 独立复核实测）。把 len < 24 的
 * 邻域内方向按 smoothstep 权重混向轴向软混方向 A 之后：len ≥ 24 逐位不变
 * （旧值原样），len → 0 时恰好等于 A —— 而 A 在内缩边界上本就是径向的
 * 极限方向（轴向 45° 内角处的连续延拓），两支相接处不再有无界旋转。
 * 取 24 的边界：混的是方向不是环宽 —— 整条直边带上径向与 A 同向的点
 * （(101,160) 等单测精确值）逐位不受影响，只有角弧 24px 内方向做小幅收拢；
 * 而内缩角点 (116,204) 旁 0.25px 一步内方向要转 ~40°，(1−μ) 的权重必须
 * 压到 0.05 以下 —— 16 时角弧一段仍有 1.6 的邻跳，24 收掉（复核扫描实测）。
 */
const RADIAL_SOFT = 24

/**
 * 圆角矩形的**有符号距离**：内部为负、边界 0、外部为正，单位 = 像素。
 * 这是整套折射几何的地基 —— 环带、圆角、遮罩全从它推出来，所以它必须
 * 对「圆角半径大于半宽/半高」（退化成胶囊）也成立：innerHalf 先夹到 ≥0。
 */
function roundedRectSd(px: number, py: number, r: LensRect): number {
  const hx = r.w / 2
  const hy = r.h / 2
  const rad = Math.min(r.radius, hx, hy)
  const qx = Math.abs(px - (r.x + hx)) - Math.max(0, hx - rad)
  const qy = Math.abs(py - (r.y + hy)) - Math.max(0, hy - rad)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  const inside = Math.min(Math.max(qx, qy), 0)
  return outside + inside - rad
}

/**
 * 边界外法线（单位向量）+ **圆角权重 cornerF**（0 = 纯直边带、1 = 圆角饱和区）。
 *
 * 方向两段式（结构不动）：
 *   ① 点在「圆角内缩矩形」之外 ⇒ 落在圆角区：法线 = 从最近内缩点到该点的方向
 *      （没方向 = 正好落在内缩矩形的面上/内，退化到 ② 的轴向判定）
 *   ② 否则落在某条直边前：x/y 两轴法线按 TIE_SOFT 软混（越靠近哪个轴的直边
 *      越纯，等距时 45°；见下方 TIE_SOFT 的论证）
 * 两条分支的边界上方向是连续的：重出内缩矩形面时径向极限就是轴向（数值预检
 * 过：只有内缩矩形四个角点是零测度的方向奇异点，不影响观感）。
 *
 * cornerF 是**连续**权重：bx/by 各自记账「该轴超出内缩矩形多少个圆角半径」，
 * cornerF = min(bx, by)。直边整条带上至少有一个轴没超出 ⇒ cornerF = 0；
 * 真角区（两轴都超出）从角区边界平滑爬升，角点处 → 1。
 *
 * 为什么不是布尔判定：旧版把「内缩矩形之外」整圈判成角区，直边靠外一整圈
 * （深度 ≤ 圆角半径）也算，cornerBoost 在 深度 = 圆角半径 处整圈跳变
 * （200×120/半径16 的面板实测邻跳 17.9 通道级/0.5px）；而换成「两轴都超出」
 * 的布尔式又会在角区方块的边界短线段上引入一串新的小台阶。只有连续权重的
 * 场处处无台阶（见 __tests__ 的「位移场无处跳变」）。
 *
 * rad = 0（纯直角矩形）没有角区，cornerF 恒 0 —— 同时避开 0/0 = NaN
 * （clamp 对 NaN 不设防，NaN 会一路穿透进 ringW）。
 */
function edgeNormal(px: number, py: number, r: LensRect): { nx: number; ny: number; cornerF: number } {
  const hx = r.w / 2
  const hy = r.h / 2
  const rad = Math.min(r.radius, hx, hy)
  const ix = Math.max(0, hx - rad)
  const iy = Math.max(0, hy - rad)
  const cx = r.x + hx
  const cy = r.y + hy
  const dx = px - cx
  const dy = py - cy
  const kx = clamp(dx, -ix, ix)
  const ky = clamp(dy, -iy, iy)
  const ddx = dx - kx
  const ddy = dy - ky
  const len = Math.hypot(ddx, ddy)
  const cornerF =
    rad > 0
      ? Math.min(clamp((Math.abs(dx) - ix) / rad, 0, 1), clamp((Math.abs(dy) - iy) / rad, 0, 1))
      : 0
  // 轴向软混方向 A（x/y 两轴法线之间，见 TIE_SOFT）：mx-my 走完 ±TIE_SOFT 时
  // 方向从纯 x-轴向转进纯 y-轴向。不能退回布尔切换（mx<=my ? x : y）——
  // 那会让 ny 在两条对角落线上整跳。
  const mx = ix - Math.abs(dx)
  const my = iy - Math.abs(dy)
  const sd = roundedRectSd(px, py, r)
  const tSoft = TIE_SOFT + TIE_DEPTH * Math.min(Math.abs(sd), TIE_DEPTH_CAP)
  const w = clamp((mx - my) / (2 * tSoft) + 0.5, 0, 1)
  const sw = w * w * (3 - 2 * w)
  const ax = (1 - sw) * (dx >= 0 ? 1 : -1)
  const ay = sw * (dy >= 0 ? 1 : -1)
  // 径向分支在贴近内缩边界处（len < RADIAL_SOFT）向 A 收拢 —— 「ddx/ddy 的
  // soft 混合」。纯径向的方向场在内缩矩形角点附近旋转速率 ~1/len 无界
  // （(116,204) 一步 0.25px 内 ny 扫 0.707→1），bottomBoost 吃 ny 时那里
  // 会留下 11.3 个通道级/0.25px 的台阶；λ 随 len 平滑归零后外圈逐位不变。
  const la = len < RADIAL_SOFT ? 1 - len / RADIAL_SOFT : 0
  const mu = la * la * (3 - 2 * la)
  const vx = (1 - mu) * ddx + mu * ax
  const vy = (1 - mu) * ddy + mu * ay
  const vlen = Math.hypot(vx, vy)
  return { nx: vx / vlen, ny: vy / vlen, cornerF }
}

/**
 * 采样一点：给出该点的位移与是否在玻璃内。
 *
 * 位移曲线的两端都是**光滑**的（smoothstep）：边缘处最大、环带内边界处归零，
 * 中间没有折点 —— 折点会让折射外缘出现一道看得见的「台阶」。这条曲线就是
 * 「水滴张力」在数学上的那一半：液体表面是连续的，玻璃折射的过渡也得是。
 */
export function lensSample(
  px: number,
  py: number,
  r: LensRect,
  opts: Omit<LensMapOpts, 'scale'>
): LensSample {
  const sd = roundedRectSd(px, py, r)
  if (sd > 0) return { ox: 0, oy: 0, inside: false }
  if (opts.strength <= 0 || opts.ring <= 0) return { ox: 0, oy: 0, inside: true }
  const { nx, ny, cornerF } = edgeNormal(px, py, r)
  let ringW = opts.ring
  // 底部（法线朝下）比其它三边厚；圆角处再加一层张力加成。
  // bottomBoost 对 ny 用**连续因子**（底边正中 ny=1 全额、顶边 ny≤0 恒零）：
  // 不能退回布尔网关（ny>0.5 才乘），那会让环宽在过渡带整圈跳变 —— 方向过渡带
  // 上与底角内侧实测 5~26 个通道级/0.25px，见 __tests__「位移场无处跳变」。
  // cornerF 是连续权重：直边整条带 cornerF=0（等价于无加成），角区平滑爬升 ——
  // 不能退回布尔判定，否则 深度 = 圆角半径 处会出现整圈环宽台阶。
  const bf = clamp((ny - 0.5) / 0.5, 0, 1)
  ringW *= 1 + (opts.bottomBoost - 1) * bf
  ringW *= 1 + (opts.cornerBoost - 1) * cornerF
  // 环宽不许吃掉整块玻璃：顶条只有 33px 高，环宽 30 会让整条都在折射里
  // （看起来像整条被搅过一遍，而不是「一条玻璃」）。夹到短边的 45% ——
  // 留出中间那片**中性区**，玻璃才有「面」。（长边不受影响：侧栏 240 宽 ×
  // 760 高时短边是 240，30 远小于 0.45×240。）
  ringW = Math.min(ringW, Math.min(r.w, r.h) * 0.45)
  const t = clamp(1 + sd / ringW, 0, 1) // 1 = 正好在边缘，0 = 环带内边界
  const p = t * t * (3 - 2 * t) // smoothstep
  const d = p * opts.strength
  // 位移取「向内」= 反法线方向（见文件头通道约定）
  return { ox: -nx * d, oy: -ny * d, inside: true }
}

/**
 * 产出整张贴图的 RGBA 像素（行优先，长度 = outW*outH*4）。
 *
 * 返回 Uint8ClampedArray 而不是直接画进 canvas：这样它是个**纯函数**，
 * 单测能在 node 里逐像素验（vitest 环境没有 2D 上下文）。
 * 调用方（refraction.ts）拿 new ImageData(...) 原样 putImageData 即可 ——
 * ImageData 构造器吃的正是这个数组类型。
 *
 * 性能：只遍历每个矩形的外扩包围盒，整屏其它地方一次 memset 就位
 * （面板通常只占屏幕两三成，重建贴图因此是「几个矩形」的量级，不是全屏）。
 */
export function lensMapPixels(
  rects: readonly LensRect[],
  opts: LensMapOpts,
  outW: number,
  outH: number
): Uint8ClampedArray<ArrayBuffer> {
  const px = new Uint8ClampedArray(outW * outH * 4)
  // 先全屏铺「不偏、透明」：R/G 中性 128，alpha 0。中性值是**刻意**的 ——
  // 万一遮罩边界上有半像素漏出去，采样偏移为 0 = 视觉上等于没这条链，
  // 而不是把某个角落的画面整块拖过来。
  for (let i = 0; i < px.length; i += 4) {
    px[i] = LENS_NEUTRAL
    px[i + 1] = LENS_NEUTRAL
  }
  const s = opts.scale > 0 ? opts.scale : 1
  const field = { ring: opts.ring, strength: opts.strength, bottomBoost: opts.bottomBoost, cornerBoost: opts.cornerBoost }
  for (const r of rects) {
    if (!(r.w > 0) || !(r.h > 0)) continue
    const x0 = Math.max(0, Math.floor(r.x * s) - 1)
    const y0 = Math.max(0, Math.floor(r.y * s) - 1)
    const x1 = Math.min(outW - 1, Math.ceil((r.x + r.w) * s) + 1)
    const y1 = Math.min(outH - 1, Math.ceil((r.y + r.h) * s) + 1)
    for (let iy = y0; iy <= y1; iy++) {
      const cy = (iy + 0.5) / s
      const row = iy * outW * 4
      for (let ix = x0; ix <= x1; ix++) {
        const cxp = (ix + 0.5) / s
        const sd = roundedRectSd(cxp, cy, r)
        if (sd > 0.5 / s) continue // 矩形外：保持中性+透明
        const k = row + ix * 4
        // 边缘 1 个贴图像素的羽化：避免磨砂层的外缘出现一圈硬锯齿
        px[k + 3] = Math.round(clamp(0.5 - sd * s, 0, 1) * 255)
        if (opts.strength <= 0 || opts.ring <= 0) continue
        const smp = lensSample(cxp, cy, r, field)
        px[k] = clamp(LENS_NEUTRAL + smp.ox, 0, 255)
        px[k + 1] = clamp(LENS_NEUTRAL + smp.oy, 0, 255)
      }
    }
  }
  return px
}
