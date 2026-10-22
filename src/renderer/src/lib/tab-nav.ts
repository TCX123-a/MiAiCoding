/**
 * MiTabs 的 ←/→ 巡回逻辑（⑤ 十项升级给排行榜三个页签加的键盘路径）。
 *
 * 【为什么下沉成纯函数】仓库惯例：组件/视图不进 vitest，能测的只有 lib。
 * 把「按了哪个键 → 焦点该去第几格」收成一个纯函数，边界（绕圈、单页签、
 * 非法下标）就都有单测钉着；组件那边只剩「调它、移焦点」两行。
 *
 * 【为什么 ←/→ 要绕圈，而不是到头顶住】这是分段控件（segmented control）
 * 的通行行为：三个页签排一排本来就没有"尽头"的隐喻，绕圈让「再多按一下
 * 回到第一个」可预期 —— 到头停住的话，用户要多按两下反方向键才能回来。
 *
 * 【为什么 Home/End 也认】一行三格时它俩价值不大，但这套逻辑与格数无关，
 * 哪天页签长到七八个，Home/End 就是「一秒到两端」的捷径，现在顺手带上零成本。
 *
 * 【为什么返回 null 而不是原下标】null = 「这个键不归我管」，调用方要据此
 * 决定**不** preventDefault（让 Tab 之类的键照常走自己的路）。返回原下标
 * 的话调用方分不清「没动」和「动到了自己」，一不小心就把事件吞了。
 */
export function tabNavTarget(key: string, index: number, count: number): number | null {
  if (count <= 0 || !Number.isInteger(index) || index < 0 || index >= count) return null
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count
    case 'ArrowLeft':
      return (index - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
