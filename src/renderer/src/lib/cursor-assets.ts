/**
 * 猫爪鼠标指针 —— **图案由主人自备，本模块只负责「把它接上」**。
 *
 * 【为什么这里没有一个像素的图形】
 * 我合成的 SVG 猫爪被否了（"太电子、太玩具"），改由主人自己找素材。
 * 于是这个文件的职责从"画一只爪"变成"找一张图、拼成合法的 cursor 值"：
 * 图不在就什么都不做，退回系统 `pointer`，**不报错、不占位、不闪**。
 *
 * 【为什么图和逻辑要分家】
 * 本模块**不 import 任何文件**（glob 在 `cursor.ts` 里），所以它是纯的，
 * 能在 node 环境下被单测直接跑。拼 cursor 值这件事有两条硬规则
 * （见 `cursorValue`），而它们**错了完全不报错**——只有单测能钉住。
 *
 * 【文件名约定】
 *   按下前：`cat-claw.cur`        （也认 `cat-claw.png`）
 *   按下去：`cat-claw-click.cur`  （也认 `cat-claw-click.png`）
 * 见 `assets/cursors/README.md`。
 */

/** 两张图各自的文件名主干。改名字只改这里，代码其余部分跟着走 */
export const CURSOR_FILES = {
  /** 松开时（常态） */
  up: 'cat-claw',
  /** 按下时（"攥住"） */
  down: 'cat-claw-click'
} as const

/**
 * PNG 的热点坐标 —— **只对 `.png` 生效**。
 *
 * 指针的"落点"是热点。`11 7` 是为 **32×32 的图**定的：它压在整只爪最靠左上的实处。
 * 取 (0,0) 会让热点落在空白处，爪印整体偏右下，点小目标时总觉得"差一点没点到"。
 *
 * 【`.cur` 为什么不用它】
 * `.cur` 文件**自带热点**，浏览器按文件里的走。所以用 `.cur` 的话，
 * 图多大、热点在哪，都是主人自己定的，代码一个字都不用改 —— **这是推荐用 `.cur` 的原因**。
 * 代价是热点错了我们这边看不出来（文件里那个数我们读不到），
 * 所以 README 里明确写了"改热点要在你自己的编辑器里改"。
 */
export const PAW_HOTSPOT = '11 7'

/** `.cur` 比 `.png` 优先：前者自带热点，后者得靠 `PAW_HOTSPOT` 猜 */
export const CURSOR_EXT_PRIORITY = ['cur', 'png'] as const

/** 从 glob 的路径里取文件名主干：`../assets/cursors/cat-claw.cur` → `cat-claw` */
export function cursorBaseOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.[a-z0-9]+$/i, '')
}

/** 从 glob 的路径里取扩展名，小写、不带点：`…/cat-claw.cur` → `cur` */
export function cursorExtOf(path: string): string {
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  return dot > slash ? path.slice(dot + 1).toLowerCase() : ''
}

/**
 * 在「目录里现有的文件」里找某个主干对应的那一张。
 *
 * 按 `CURSOR_EXT_PRIORITY` 挑：**先 `.cur` 再 `.png`**。
 * 两个都在时以 `.cur` 为准 —— 它是"更完整"的那个（自带热点），
 * 而同时放两份多半是主人想试试 png 效果却忘了删旧的，此时跟着 `.cur` 走不会出意外。
 *
 * 返回 `null` 表示**这张图不存在**。这不是错误路径：主人还没放素材，
 * 或者只放了按下的那张，都是正常的，调用方照常退回系统指针。
 *
 * @param available glob 的**键**（路径），不是值
 * @param base 文件名主干，如 `cat-claw`
 */
export function findCursor(available: readonly string[], base: string): string | null {
  for (const ext of CURSOR_EXT_PRIORITY) {
    const hit = available.find((p) => cursorBaseOf(p) === base && cursorExtOf(p) === ext)
    if (hit) return hit
  }
  return null
}

/**
 * 拼出一条**合法的** CSS `cursor` 值。
 *
 * ⚠️⚠️ **两条硬规则，错了都不报错**（本项目在这上面栽过，见 `styles/cursor.css` 的长注释）：
 *
 *   1. **`url()` 后面必须有关键字收尾**。`cursor: url("x.png") 11 7` 整条声明作废，
 *      浏览器把 `cursor` 当没写过 —— 一声不吭，`getComputedStyle` 平静地返回 `auto`。
 *      症状不是"猫爪不显示"，而是**全站 `pointer` 手型一起消失**。
 *   2. **`.png` 要带热点坐标，`.cur` 不能带**。`.cur` 的热点存在文件里，
 *      再在外面写一对坐标**不会覆盖它**，只会让两处分歧 —— 而外面那个数是猜的。
 *
 * @param url Vite 给出的图片地址
 * @param ext 扩展名，小写不带点
 */
export function cursorValue(url: string, ext: string): string {
  const quoted = `url("${url}")`
  return ext === 'cur'
    ? `${quoted}, pointer`
    : `${quoted} ${PAW_HOTSPOT}, pointer`
}

/**
 * 一张图都找不到时的兜底值。
 *
 * 就是**纯关键字 `pointer`**，不是 `url()` 也不是空串 —— 见 `cursor.css`：
 * 变量没被 JS 覆盖时，全站的 `var(--mi-cursor, pointer)` 就落在这个值上，
 * 于是"没放素材"和"放了素材"在行为上只差一张图，**没有任何降级态**。
 */
export const CURSOR_FALLBACK = 'pointer'
