/**
 * 正文 / 代码缩放的**纯逻辑**：取值范围、钳位、步进、百分比换算。
 *
 * 【为什么单独抽一份放在 shared/ 下】
 * 这个项目的规矩是「能被 Vitest 直接测的东西必须是纯函数」（vitest 跑在 node
 * 环境，没有 DOM）。缩放真正落地要碰 `documentElement` 和 localStorage，
 * 那部分留在渲染层的 store 里；这里只留**算数**。于是「50~200 之外的值一律
 * 钳回来」「137.6 不会变成一个带小数的 CSS 值」这类事可以被断言钉死。
 *
 * 【为什么边界要用常量而不是散落的字面量】
 * 上下限同时出现在三个地方：滑块（min/max）、按钮（什么时候禁用）、
 * 以及从 localStorage 读回来的钳位。三处各写一遍，迟早会有一处改了另两处没改。
 * 那种不一致不会报错，只会让滑块能拖到 210% 而按钮在 200% 就点不动。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫（见 renderer/src/lib/__tests__/copy.test.ts），
 *    **字符串一律英文**，中文只出现在注释里。
 */

/** 缩放下限（%）。再小就不是缩放而是缩略图了 —— 正文会碎成一团看不出结构 */
export const ZOOM_MIN = 50

/** 缩放上限（%）。电子书阅读器的常见上限；再大正文一屏放不下几个字，反而更难读 */
export const ZOOM_MAX = 200

/** 100% = 什么都不变。也是默认值，也是「复位」的目标 */
export const ZOOM_DEFAULT = 100

/** `+` / `-` 按钮点一次的步进（%）。10 是一档明显的视觉变化，点两下就看得出来 */
export const ZOOM_BUTTON_STEP = 10

/**
 * 滑块的步进（%）。比按钮细一档：按钮要的是「跳一格」，
 * 滑块要的是「拖起来是连续的」，两件事用同一个步进会有一边别扭。
 */
export const ZOOM_SLIDER_STEP = 5

/**
 * 把任意数字钳进 [ZOOM_MIN, ZOOM_MAX] 并取整。
 *
 * 非有限数（NaN / Infinity / 从 `parseInt` 掉下来的 NaN）一律退回默认值，
 * **不是**钳到边界：这两种情况的来源完全不同 —— 越界是用户在拖，
 * NaN 是数据坏了。数据坏了的时候「当成 100%」才是安全的猜测。
 */
export function clampZoom(v: number): number {
  if (!Number.isFinite(v)) return ZOOM_DEFAULT
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(v)))
}

/**
 * 把「从存储里读出来的任意东西」变成合用的百分比。
 *
 * 入参刻意是 `unknown`：它的全部意义就是「存着的东西不一定长成什么样」。
 * 声明成 `number` 等于自欺欺人 —— 类型系统会假装它是好的，
 * 调用方就会理所当然地直接用，而那正是要防的事。
 */
export function normalizeZoom(raw: unknown): number {
  if (typeof raw === 'number') return clampZoom(raw)
  if (typeof raw !== 'string') return ZOOM_DEFAULT
  const n = Number.parseInt(raw, 10)
  return clampZoom(n)
}

/**
 * 步进。`dir` 为 +1 / -1。
 *
 * 先 `clampZoom(current)` 再加减：万一 current 是个坏值（比如 0 或 NaN），
 * 一次步进也应该把它带回合法区间，而不是在坏值上继续算。
 */
export function stepZoom(current: number, dir: 1 | -1): number {
  return clampZoom(clampZoom(current) + dir * ZOOM_BUTTON_STEP)
}

/**
 * 百分比 → 给 CSS 用的**无单位倍数**（0.5 ~ 2）。
 *
 * 用倍数而不是 `150%` 是因为 `zoom` 属性两种写法都收，但无单位写法在
 * 更老的 Chromium 上也认；而且这个值将来若要参与 `calc()` 运算，
 * 带百分号会直接算不了。
 */
export function zoomScale(percent: number): number {
  return clampZoom(percent) / 100
}
