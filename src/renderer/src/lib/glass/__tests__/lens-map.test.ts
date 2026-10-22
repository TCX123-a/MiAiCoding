import { describe, expect, it } from 'vitest'
import {
  LENS_MAP_UNIT,
  LENS_NEUTRAL,
  lensMapPixels,
  lensSample,
  type LensMapOpts,
  type LensRect
} from '../lens-map'

/**
 * 折射贴图的**通道契约**。lens-map.ts 是纯函数（文件自己的口吻：「单测可以只验
 * 这个纯函数，不必起浏览器」），这里就钉它在没有浏览器时也说得清的那部分：
 *
 *   · 通道方向：R/G 是位移（左边缘往外折 = R>128…），B 恒 0，A = 在不在玻璃里
 *   · 中性值：矩形外和玻璃正中心都是 (128,128)，alpha 0 / 255 各就各位
 *   · 归一化：位移按 LENS_MAP_UNIT 记账，两侧都留钳位余量（这是「拖强度不重画贴图」
 *     和「流动呼吸复用同一张图」两个设计的地基）
 *   · 两个 boost 各自独立地起作用（bottom / corner），以及环宽夹取
 *   · 像素缓冲的落位（scale 折半映射）与退化矩形
 *
 * 【成对断言】方向类判据一律左右/上下成对写：只写一边的话，整条链符号翻反了
 * 它照样绿 —— 这个项目里「假绿」的账已经够多了。
 *
 * 【±0】位移是 `-nx * d` 算出来的：轴向法线的另一个分量是 ±0，而 toBe 走
 * Object.is —— Object.is(-0, 0) 是 false。所以「位移是 0」的断言一律先
 * Math.abs 归一，别直接 .toBe(0)，那会假红。
 *
 * 【悬崖已抹平（裁定修复，2026-10-09）】edgeNormal 曾把「内缩矩形之外」整圈
 * 判成 corner —— 不只是四角，**四条直边靠外一圈（深度 ≤ 圆角半径）也算**，
 * cornerBoost 于是在 深度 = 圆角半径 处整圈跳变（200×120 / 半径 16 的面板，
 * 左边缘中点 0.5px 步进实测 15.5px → 62.9、16px → 45.0，邻跳 17.9 个通道级）。
 * 现改成连续权重 cornerF = min(bx, by)（bx/by = 各轴超出内缩矩形多少个圆角
 * 半径，夹到 0..1）：直边整条带 cornerF = 0、真角区从角区边界平滑爬升、角点处
 * → 1。连续化的判据在「位移场无处跳变」一组；直边带不再受 cornerBoost 影响是
 * 裁定接受的观感微调（直边剖面一律 = 30 环宽的无加成曲线）。
 */
const RECT: LensRect = { x: 100, y: 100, w: 200, h: 120, radius: 16 }
const DEFAULTS: Omit<LensMapOpts, 'scale'> = {
  ring: 30,
  strength: LENS_MAP_UNIT,
  bottomBoost: 1.35,
  cornerBoost: 1.25
}

/** 写成人话的采样：返回位移模长，免得每条断言都 Math.hypot */
const mag = (px: number, py: number, o = DEFAULTS): number => {
  const s = lensSample(px, py, RECT, o)
  return Math.hypot(s.ox, s.oy)
}

describe('lensSample 的方向与中性值', () => {
  it('矩形外一律不偏、且标为不在玻璃内', () => {
    for (const [x, y] of [
      [50, 160],
      [350, 160],
      [200, 50],
      [200, 250],
      [50, 50]
    ]) {
      expect(lensSample(x, y, RECT, DEFAULTS)).toEqual({ ox: 0, oy: 0, inside: false })
    }
  })

  it('正中心是中性点：在玻璃内、位移为零', () => {
    const s = lensSample(200, 160, RECT, DEFAULTS)
    expect(s.inside).toBe(true)
    expect(Math.abs(s.ox)).toBe(0) // ±0 归一，见文件头
    expect(Math.abs(s.oy)).toBe(0)
  })

  it('四条边都朝内折（成对：左右一组、上下一组）', () => {
    // 边缘内侧 1px。方向约定见文件头：位移取「向内」，即反法线方向。
    expect(lensSample(101, 160, RECT, DEFAULTS).ox).toBeGreaterThan(0) // 左 → 往右采
    expect(lensSample(299, 160, RECT, DEFAULTS).ox).toBeLessThan(0) // 右 → 往左采
    expect(lensSample(200, 101, RECT, DEFAULTS).oy).toBeGreaterThan(0) // 上 → 往下采
    expect(lensSample(200, 219, RECT, DEFAULTS).oy).toBeLessThan(0) // 下 → 往上采
    // 直边中点的法线必须是纯轴向：混进另一个分量 = 边缘会斜着扭
    expect(Math.abs(lensSample(101, 160, RECT, DEFAULTS).oy)).toBeLessThan(1e-9)
    expect(Math.abs(lensSample(200, 101, RECT, DEFAULTS).ox)).toBeLessThan(1e-9)
  })

  it('从边缘往里单调衰减，环带内边界之外恒为零', () => {
    // 单调按 0.5px 步长验到 34；注意这条在「悬崖」两侧依然成立（悬崖只是陡，不是涨）。
    let prev = mag(100, 160)
    for (let d = 0.5; d <= 34; d += 0.5) {
      const m = mag(100 + d, 160)
      expect(m).toBeLessThanOrEqual(prev + 1e-9)
      prev = m
    }
    expect(mag(100 + 30, 160)).toBe(0) // 环带内边界（30）处归零
    expect(mag(100 + 34, 160)).toBe(0)
  })

  it('strength 或 ring 归零 ⇒ 退化成纯遮罩：还在玻璃内，但不偏', () => {
    for (const o of [
      { ...DEFAULTS, strength: 0 },
      { ...DEFAULTS, ring: 0 }
    ]) {
      expect(lensSample(101, 160, RECT, o)).toEqual({ ox: 0, oy: 0, inside: true })
      expect(lensSample(200, 160, RECT, o)).toEqual({ ox: 0, oy: 0, inside: true })
    }
  })

  it('归一化：最外一圈约 = LENS_MAP_UNIT，且离 0/255 两端都留足余量', () => {
    // 正好在边缘（sd=0 → smoothstep 到 1）时位移应逼近整个记账单位。
    const atEdge = mag(100, 160)
    expect(atEdge).toBeLessThanOrEqual(LENS_MAP_UNIT)
    expect(atEdge).toBeGreaterThan(LENS_MAP_UNIT * 0.95)
    // 余量：中性值 ± 记账单位都不许出界 —— 出了界就会被钳成平顶。
    expect(LENS_NEUTRAL + LENS_MAP_UNIT).toBeLessThanOrEqual(255)
    expect(LENS_NEUTRAL - LENS_MAP_UNIT).toBeGreaterThanOrEqual(0)
  })

  it('底边加成（bottomBoost）：默认下下边比左右折得狠，把它调回 1 两边就一样', () => {
    // 深 10 与深 20 各取一对（都在直边轴向带；修后圆角加成只在真角区，不参与这里）
    for (const d of [10, 20]) {
      const bottom = mag(200, 220 - d)
      const left = mag(100 + d, 160)
      expect(bottom).toBeGreaterThan(0)
      expect(left).toBeGreaterThan(0)
      expect(bottom).toBeGreaterThan(left)
      // 归因：把 bottomBoost 摘掉，差值必须整个消失 —— 否则差来自别处。
      const flat = { ...DEFAULTS, bottomBoost: 1 }
      expect(mag(200, 220 - d, flat)).toBeCloseTo(mag(100 + d, 160, flat), 9)
    }
  })

  it('圆角加成（cornerBoost）：真角区仍在，直边带不再受影响', () => {
    // 这条替掉旧版「摘掉它，浅层位移整体变小」——旧版拿直边深 10 处（110,160）
    // 做断言，钉的其实是 bug 行为：「直边靠外一圈也算角区」正是被抹平的那道悬崖。
    // 修后 cornerBoost 只作用于真角区（cornerF > 0），所以改在角弧内侧断言。
    // （测试不许把 bug 写成规矩。）
    const noCorner = { ...DEFAULTS, cornerBoost: 1 }
    // (112,112)：左上角弧内侧（sd < 0）、cornerF = 0.25 —— 加成存在且不小
    expect(mag(112, 112)).toBeGreaterThan(mag(112, 112, noCorner))
    expect(mag(112, 112) - mag(112, 112, noCorner)).toBeGreaterThan(2) // 实测 2.71
    // 对照组：直边带 cornerF 恒 0 ⇒ 加成必须**逐位相同**（不是「差不多」）
    expect(mag(110, 160)).toBe(mag(110, 160, noCorner))
    expect(mag(200, 110)).toBe(mag(200, 110, noCorner))
  })

  it('环宽被夹到短边的 45%：细条中间留得出中性区', () => {
    // 顶条那种 400×20 的细长条：ring=30 会被夹到 9
    const bar: LensRect = { x: 0, y: 0, w: 400, h: 20, radius: 0 }
    const mid = lensSample(200, 10, bar, DEFAULTS)
    expect(mid.inside).toBe(true)
    expect(Math.abs(mid.ox)).toBe(0) // ±0 归一，见文件头
    expect(Math.abs(mid.oy)).toBe(0) // 深 10 > 9 ⇒ 已出环带，中性
    // 对照：同样深 10，高面板却没到环带边界 —— 证明上面那个 0 是夹取的功劳
    expect(mag(110, 160)).toBeGreaterThan(50)
    // 靠边 4px 处仍有位移（环带没被夹没）
    expect(Math.abs(lensSample(200, 4, bar, DEFAULTS).oy)).toBeGreaterThan(0)
    // 夹取上限本身：深 9 处应已归零（t 恰为 0）
    expect(Math.abs(lensSample(200, 9, bar, DEFAULTS).oy)).toBe(0)
  })

  it('rad = 0 的矩形在轴边界点上是确定值（0/0 = NaN 的防呆，clamp 挡不住 NaN）', () => {
    // 这两点恰好踩在 0/0 上：radius=0 时 ix=hx ⇒ (|dx| - ix)/rad；点在边线上
    // 时 |dx|==ix 且 rad==0。clamp 对 NaN 不设防（NaN 两个比较都是 false）、
    // Math.min 也传染 NaN —— 没有 rad>0 防呆时位移会整条变 NaN（写进
    // Uint8ClampedArray 会被静默转成 0）。坐标精确落在边线上，就是为了钉住它。
    const bar: LensRect = { x: 0, y: 0, w: 400, h: 20, radius: 0 }
    const onEdgeY = lensSample(150, 0, bar, DEFAULTS) // y 恰在上边线
    expect(onEdgeY.inside).toBe(true)
    expect(onEdgeY.oy).toBe(100) // 边上取满、取向内（+y）；NaN 下这行必红
    expect(Math.abs(onEdgeY.ox)).toBe(0)
    const onEdgeX = lensSample(0, 10, bar, DEFAULTS) // x 恰在左边线
    expect(onEdgeX.inside).toBe(true)
    expect(onEdgeX.ox).toBe(100) // 左边缘往右采 = 向内
    expect(Math.abs(onEdgeX.oy)).toBe(0)
  })
})

describe('lensMapPixels 的像素缓冲契约', () => {
  const SQUARE: LensRect = { x: 50, y: 50, w: 100, h: 100, radius: 0 }
  const OPTS: LensMapOpts = { ...DEFAULTS, scale: 1 }

  it('缓冲区尺寸 = w*h*4；矩形外的像素是「中性 + 全透明」', () => {
    const W = 160
    const H = 160
    const px = lensMapPixels([SQUARE], OPTS, W, H)
    expect(px.length).toBe(W * H * 4)
    for (const [x, y] of [
      [10, 10],
      [10, 100],
      [159, 159]
    ]) {
      const k = (y * W + x) * 4
      expect([px[k], px[k + 1], px[k + 2], px[k + 3]]).toEqual([LENS_NEUTRAL, LENS_NEUTRAL, 0, 0])
    }
  })

  it('B 通道恒为 0（feDisplacementMap 不看它，写了就是脏数据）', () => {
    const px = lensMapPixels([SQUARE], OPTS, 160, 160)
    let dirty = 0
    for (let k = 2; k < px.length; k += 4) if (px[k] !== 0) dirty++
    expect(dirty).toBe(0)
  })

  it('玻璃正中心：alpha 满、通道中性', () => {
    const px = lensMapPixels([SQUARE], OPTS, 160, 160)
    const k = (100 * 160 + 100) * 4
    expect([px[k], px[k + 1], px[k + 3]]).toEqual([LENS_NEUTRAL, LENS_NEUTRAL, 255])
  })

  it('四条边的通道方向成对正确，外圈羽化带不拖画面', () => {
    const px = lensMapPixels([SQUARE], OPTS, 160, 160)
    const at = (x: number, y: number): number[] => {
      const k = (y * 160 + x) * 4
      return [px[k], px[k + 1], px[k + 2], px[k + 3]]
    }
    const left = at(50, 100)
    const right = at(149, 100)
    const top = at(100, 50)
    const bottom = at(100, 149)
    expect(left[0]).toBeGreaterThan(LENS_NEUTRAL) // 左：R > 128
    expect(right[0]).toBeLessThan(LENS_NEUTRAL)
    expect(top[1]).toBeGreaterThan(LENS_NEUTRAL) // 上：G > 128
    expect(bottom[1]).toBeLessThan(LENS_NEUTRAL)
    // 四边内侧像素都在玻璃里
    for (const p of [left, right, top, bottom]) expect(p[3]).toBe(255)
    // 再往外一格是羽化带：alpha 归零、颜色仍是中性（不把别处画面拖过来）
    expect(at(49, 100)[3]).toBe(0)
    expect(at(49, 100).slice(0, 2)).toEqual([LENS_NEUTRAL, LENS_NEUTRAL])
  })

  it('尺度折半：CSS 矩形按 MAP_SCALE 落位（100 → 50 那一格开始）', () => {
    const css: LensRect = { x: 100, y: 100, w: 200, h: 120, radius: 0 }
    const W = 160
    const H = 120
    const px = lensMapPixels([css], { ...DEFAULTS, scale: 0.5 }, W, H)
    let minX = W
    let maxX = -1
    let minY = H
    let maxY = -1
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (px[(y * W + x) * 4 + 3] > 0) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    // 左 100→50、右 300→150、上 100→50、下 220→110，像素格含左端不含右端
    expect([minX, maxX, minY, maxY]).toEqual([50, 149, 50, 109])
  })

  it('退化矩形（w 或 h 为 0）被跳过，不碰缓冲', () => {
    const px = lensMapPixels(
      [
        { x: 0, y: 0, w: 0, h: 100, radius: 0 },
        { x: 100, y: 0, w: 0, h: 0, radius: 0 }
      ],
      OPTS,
      160,
      160
    )
    let any = 0
    for (let k = 3; k < px.length; k += 4) if (px[k] !== 0) any++
    expect(any).toBe(0)
  })

  it('多个矩形都画得出来（别只画了第一个）', () => {
    const a: LensRect = { x: 0, y: 0, w: 60, h: 60, radius: 0 }
    const b: LensRect = { x: 100, y: 100, w: 60, h: 60, radius: 0 }
    const px = lensMapPixels([a, b], OPTS, 160, 160)
    expect(px[(30 * 160 + 30) * 4 + 3]).toBe(255)
    expect(px[(130 * 160 + 130) * 4 + 3]).toBe(255)
  })
})

describe('位移场无处跳变（悬崖已抹平）', () => {
  // 两批悬崖，同一族：**布尔网关吃方向分量**。
  // 第一批（2026-10-09 上半天）：edgeNormal 的布尔 corner 判定让 cornerBoost 在
  // 深度 = 圆角半径 处整圈跳变（左缘中点 0.5px 步进实测邻跳 17.9）。修后 cornerF
  // 连续。第二批（同日裁定）：bottomBoost 的 `ny > 0.5` 布尔开关（左底 (108,208.5)
  // 实测 5.24）+ axial tie-break 在对角落线上的硬切换（(120,200) 25.93 /
  // (270,190) 17.40）+ 内缩角点旁 1/len 无界方向旋转（45° 过 (116,204) ~10）。
  // 修后 ny 走连续因子、tie 软混、径向在角点邻域向轴向收拢，全程一阶连续。
  //
  // 本组现在钉三类线：直边中点法向、距边切向（含底部过渡带全段）、两条对角线，
  // 外加「底角内侧过渡带」一组定向扫描（四处收报坐标的邻域）。
  // 阈值由来：ringW = 30、strength = 100 时 smoothstep 固有最大斜率 = 150/30 =
  // 5 通道级/px（= 2.5/0.5px）。据此取 ≤ 3.0/0.5px ⇒ 步长 0.25px 下 ≤ 1.5。
  // 断言按相邻对逐条写（不是攒个最大值），失败时会点名具体位置和两个读数。
  const LIMIT = 1.5
  const STEP = 0.25

  // 按弧长步进（对角线也用弧长：按参数步进会把几何步长放大 √(1+0.36) 倍，
  // 把固有斜率顶到阈值上）。
  const walk = (from: readonly [number, number], to: readonly [number, number]) => {
    const len = Math.hypot(to[0] - from[0], to[1] - from[1])
    const n = Math.round(len / STEP)
    const pts: Array<readonly [number, number]> = []
    for (let i = 0; i <= n; i++) {
      const t = i / n
      pts.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t])
    }
    return pts
  }

  const checkLine = (
    name: string,
    from: readonly [number, number],
    to: readonly [number, number],
    maskCrossings: number
  ): void => {
    const pts = walk(from, to)
    let crossings = 0
    for (let i = 1; i < pts.length; i++) {
      const a = lensSample(pts[i - 1][0], pts[i - 1][1], RECT, DEFAULTS)
      const b = lensSample(pts[i][0], pts[i][1], RECT, DEFAULTS)
      if (a.inside !== b.inside) {
        // 遮罩边界两侧：sd ≈ 0 那条线是设计边界（矩形外恒为「不偏、透明」，
        // 场从 ~100 直接归 0 是契约本身，不是折射场内部台阶）——显式跳过。
        crossings++
        continue
      }
      if (!a.inside) continue // 两侧都在遮罩外：恒零，差恒 0，不进判据
      const ma = Math.hypot(a.ox, a.oy)
      const mb = Math.hypot(b.ox, b.oy)
      expect(
        Math.abs(mb - ma),
        `${name}：(${pts[i - 1][0].toFixed(2)}, ${pts[i - 1][1].toFixed(2)}) mag=${ma.toFixed(3)} → ` +
          `(${pts[i][0].toFixed(2)}, ${pts[i][1].toFixed(2)}) mag=${mb.toFixed(3)}`
      ).toBeLessThanOrEqual(LIMIT)
    }
    // 跳过分支必须真的在预期位置触发（对角线各 2 个跨点；其余线整条在遮罩内）
    expect(crossings, `${name}：遮罩边界跨越对数`).toBe(maskCrossings)
  }

  // 直边中点法向扫描：从边缘向内 34px（环带内外都扫到）。修前在 深度 = 圆角
  // 半径（16px）处整圈跳变，这条线就是当初量到 17.9 的那条。
  it('左/右/上/下四条直边中点法向无跳变', () => {
    checkLine('左缘中点法向', [100, 160], [134, 160], 0)
    checkLine('右缘中点法向', [300, 160], [266, 160], 0)
    checkLine('上缘中点法向', [200, 100], [200, 134], 0)
    checkLine('下缘中点法向', [200, 220], [200, 186], 0)
  })

  // 距边 8px 的切向扫描：跨过角区边界线（cornerF 从 0 开始爬升的那条线）。
  // 左/右现在扫到 y=216（2026-10-09 裁定前只扫到 208——再往下的 208.6 处是
  // bottomBoost 布尔开关线，当时属「既有台阶未修」；现已连续化，全段扫进来）。
  // 104..216 完整跨过 y=116 与 y=204 两条角区边界线、旧的 ny=0.5 开关线
  // （x=108 上约在 y≈202.7）与底角外带。
  it('左/右/上/下四条距边 8px 切向无跳变（跨角区边界线）', () => {
    checkLine('左切向', [108, 104], [108, 216], 0)
    checkLine('右切向', [292, 104], [292, 216], 0)
    checkLine('上切向', [104, 108], [296, 108], 0)
    checkLine('下切向', [104, 212], [296, 212], 0)
  })

  // 底角内侧过渡带（2026-10-09 裁定第二批悬崖的四处收报坐标邻域）：
  //   (120,200)/(270,190) —— axial tie 对角线穿点（修前 25.93 / 17.40）
  //   (108,208.5~)—— bottomBoost 布尔开关线（修前 5.24，已被上面左/右切向覆盖）
  //   (116,204)      —— 内缩矩形角点的 1/len 方向奇异区（修前 45° 线 ~10）
  // 四条竖线各跨一条 tie 线；45° 线与 tie 垂线穿过角点邻域；横线钉住复核扫描
  // 报过的残带 (116,205.8)。竖直方向的选取与前一轮收报坐标的测量方向一致。
  it('底角内侧过渡带（四处收报坐标的邻域）无跳变', () => {
    checkLine('左底 tie 邻域（竖）', [120, 188], [120, 218], 0)
    checkLine('右底 tie 邻域（竖）', [280, 188], [280, 218], 0)
    checkLine('右底外带（竖）', [270, 176], [270, 198], 0)
    checkLine('左底角弧带（竖）', [112, 196], [112, 216], 0)
    checkLine('右底角弧带（竖）', [288, 196], [288, 216], 0)
    checkLine('45° 过内缩角点', [110, 198], [122, 210], 0)
    checkLine('tie 点垂线', [114, 194], [126, 206], 0)
    checkLine('底角弧残带（横）', [106, 205.75], [126, 205.75], 0)
  })

  // 两条对角线（角到角），每条在两端各穿一次遮罩边界 ⇒ 各跳过 2 对跨越点。
  it('两条对角线无跳变（遮罩边界跨点显式跳过）', () => {
    checkLine('对角1', [100, 100], [300, 220], 2)
    checkLine('对角2', [100, 220], [300, 100], 2)
  })
})
