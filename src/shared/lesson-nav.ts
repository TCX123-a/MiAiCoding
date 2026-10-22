/**
 * 课间导航纯函数（V2-15 / V1-24，2026-10-16 主人裁定「确实需要下一课快捷
 * 选择更方便」）。课详情页底部那颗「下一课 →」靠它找人。
 *
 * 【为什么不用 content store 现成的 nextUpId —— 复核报告那条建议实测被推翻】
 * nextUpId 回答的是另一个问题：「全局第一节能上的课」（它服务的是备课中
 * 空态的「去学写好的课」按钮）。顺着主链学的人站在第 3 课（有正文、
 * 已解锁、还没标记已学）时，那个答案是第 3 课**自己** —— 拿它做「下一课」
 * 按钮，点下去原地不动。两个问题的答案在最常见的场景里恰好重合，
 * 这才是它看起来能用的原因；一旦重合就是 bug。
 *
 * 【口径】
 * · 按大纲**全序**找位置：当前课自己没正文（draft）时，返回的也是它
 *   之后第一节有正文的课 —— 语义是"这个位置之后的下一节可学的课"。
 * · 课号不在大纲里（手改 URL / 过期链接）→ null，不猜。
 * · 已经是最后一节有正文的课 → null（按钮就不出现，而不是给颗点不动的）。
 * · **不看解锁状态**：下一课还锁着也返回它 —— 课页会把前置列清楚，
 *   比"藏起来让人以为到头了"诚实（同 openLesson 对锁课的口径）。
 */
import type { OutlineModule } from './types'

export function nextWrittenAfter(outline: OutlineModule[], id: string): string | null {
  const all = outline.flatMap((m) => m.lessons)
  const at = all.findIndex((l) => l.id === id)
  if (at === -1) return null
  for (let i = at + 1; i < all.length; i++) {
    if (all[i].hasContent) return all[i].id
  }
  return null
}
