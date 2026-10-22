/**
 * 「随机池」勾选代数 —— 开屏素材池（SplashConfig.pool）与壁纸轮播池
 * （WallpaperRotationConfig.pool）**共用同一份**实现。
 *
 * 【为什么两个池要共用一份】两边的存储语义完全相同：pool 空数组 = 全部参与；
 * 非空 = 只参与列表里的名字（见两个字段各自的注释）。句法相同、勾选交互相同
 * （勾选 / 全选 / 反选 / 「不能取消最后一个」），各写一份的漂移形态是
 * 「开屏那边拦住空池、壁纸这边放过去」这种只在一边复现的怪病。
 *
 * 【空池歧义 —— 这个模块存在的第一理由】把最后一个勾去掉时池子变空，
 * 语义**反转**成「全部参与」：用户看到的是「我明明全取消了，怎么又全勾上了」。
 * 所以 togglePoolItem 在结果为空时**拒绝**（返回 null），由界面给提示，
 * 而不是替用户把这个歧义解释成任一种意思。
 *
 * 【幽灵名】池子里可能存在清单/磁盘上已经没有的名字（素材被删、壁纸退订）。
 * 显示层只渲染全量清单里的名字（checkedNames），但切换时**保留**这些幽灵名
 * （base 用原池）—— 素材哪天回来，池子里的记忆还在。「全选」「反选」是整体
 * 操作，以眼前这份全量为准，幽灵名随之清掉（刻意的：反选的语义就是
 * 「以眼前清单为准」）。
 *
 * 【规范态】勾满 = 存回空数组（「空 = 全部」的规范形态）：新素材导入后
 * 自动参与，存储也最小。判据是「全量的每一个都在结果里」，不是长度相等 ——
 * 幽灵名会让长度撒谎。
 *
 * 纯函数、无依赖；本文件零 import（同 splash.ts 的叶子纪律，main/preload/
 * renderer 三边都能直接用）。
 */

/** 显示用：当前参与随机的名字集合（空池 = 全量；幽灵名不在其中） */
export function checkedNames(pool: string[], all: string[]): Set<string> {
  if (pool.length === 0) return new Set(all)
  const allSet = new Set(all)
  return new Set(pool.filter((n) => allSet.has(n)))
}

/** 显示用：已选数量（= checkedNames 的大小；给「已选 x/y」读数） */
export function poolCount(pool: string[], all: string[]): number {
  return checkedNames(pool, all).size
}

/** 「勾到满是空池」的规范化：结果覆盖了全量 → 回 []; 否则原样 */
function canonical(pool: string[], all: string[]): string[] {
  const set = new Set(pool)
  const coversAll = all.every((n) => set.has(n))
  return coversAll && all.length > 0 ? [] : pool
}

/**
 * 切换一项的勾选。返回**新的池数组**（可直接落盘）；结果为空（= 要取消
 * 最后一个可见项）时返回 null —— 界面应拒绝这次操作并给提示。
 *
 * base 展开规则：池子非空时以**原池**为底（保留幽灵名）；池子为空时以
 * 全量为底（空 = 全勾着，取消一项 = 全量减一项，落成实体列表）。
 */
export function togglePoolItem(pool: string[], all: string[], name: string, on: boolean): string[] | null {
  const base = pool.length > 0 ? pool.slice() : all.slice()
  const next = on
    ? base.includes(name)
      ? base
      : [...base, name]
    : base.filter((n) => n !== name)
  if (next.length === 0) return null
  return canonical(next, all)
}

/**
 * 反选：以眼前全量为准，未勾的变勾上、勾上的变没勾。结果为空时返回
 * null（全勾着再反选 = 全取消，同样触发空池歧义，拒绝并提示）。
 * 幽灵名不参与反选（见文件头：反选的语义就是「以眼前清单为准」）。
 */
export function invertPool(pool: string[], all: string[]): string[] | null {
  const cur = checkedNames(pool, all)
  const next = all.filter((n) => !cur.has(n))
  if (next.length === 0) return null
  return canonical(next, all)
}

/**
 * 全选 = 规范态空池（不是把名字抄一遍 —— 那样新导入的素材默认不参与，
 * 与「全选」的字面意思相反）。
 */
export function allPool(): string[] {
  return []
}
