/**
 * 干涸等待的**带上限版**（V1-62）。
 *
 * 【它修的是什么】登出前要等两条写口停稳（uplink / sync 的 whenIdle —— 见
 * app.ts 的云账号 IPC 段）。断网时在飞的轮次可能挂在网络等待与退避里，
 * whenIdle 跟着一起钉住 —— 按钮转圈，"退出登录"这个用户意志被扣为人质。
 * 等不到就放行：干涸只是尽力而为的收尾，两条写口都是幂等重试的，
 * 令牌一撤它们的在飞请求也自然作废。
 *
 * 【为什么不用 Promise.race 裸写】race 本身一行就够，但裸写没法单测 ——
 * 这段逻辑的两条边界（等到了 / 到点了）各自错法都很安静：等到了却报超时
 * 会让登出永远慢 5 秒；到点了却不放行 = 原来的 bug 原样保留。抽出来
 * 才能用真定时器钉住两条边（__tests__/drain.test.ts）。
 *
 * 返回 true = 全部落定；false = 到点了还没停（调用方自己决定记不记一笔）。
 * allSettled 语义：whenIdle 除编程错误外不抛，这里也不让任何一侧的异常
 * 吞掉调用方的动作（纵深 —— 与 app.ts 里原来那句 allSettled 的理由相同）。
 */

/** 默认上限：5 秒（V1-62 施工单）。导出给调用方与测试共用，不写第二遍数字 */
export const DRAIN_CAP_MS = 5_000

export async function drainWithCap(
  promises: Promise<unknown>[],
  capMs: number = DRAIN_CAP_MS
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | null = null
  // allSettled 永不 reject —— 超时赢下来的那支里它继续在后台跑完，没有
  // unhandled rejection 之虞
  const all = Promise.allSettled(promises).then(() => true)
  const capped = await Promise.race([
    all,
    new Promise<boolean>((r) => {
      timer = setTimeout(() => r(false), capMs)
    })
  ])
  // 落定赢下来时别让 5 秒定时器在事件循环里空转（测试收尾会以"句柄未清"的
  // 形态撞上它；生产里也只是白醒一次，但没有理由留着）
  if (timer !== null) clearTimeout(timer)
  return capped
}
