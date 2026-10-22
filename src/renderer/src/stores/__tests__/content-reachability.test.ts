/**
 * 内容可达性：**不许有任何一节「有正文的课」被永久锁死**。
 *
 * 【这个 bug 长什么样，为什么非钉不可】
 * 解锁规则是「前置全部已学完」，而没有正文的课**永远无法被标记为已学** ——
 * 点它只会弹一句「还在备课中」（见 lib/openLesson.ts）。于是只要某节课的前置
 * 恰好没生成，那节课就**永远打不开**，而且界面上完全看不出原因：它只显示
 * 「还锁着」，锁着的原因是另一节不存在的课。
 *
 * 真实事故：`c-stage2-04`(动态内存) 的前置是 `c-stage2-03`(指针)，
 * `c-stage3-03`(链表) 的前置是 `c-stage3-02`(位运算)，
 * `java-stage1-16`(包与 import) 的前置是 `java-stage1-04`(Scanner) ——
 * 三节课都有正文，却全都进不去。（主人是**挑着生成**的，前置不在盘上。）
 *
 * 【为什么当时所有闸门都是绿的】
 * 打包器 `effectiveRequired` 有一条缺省规则「同 stage 的上一节」，它是**推算**出来的；
 * 而验证器只检查 frontmatter 里**手写**的 `required` 引用是否存在 ——
 * 推算出来的那条没人查。这道闸补的就是这个缺口。
 *
 * 【所以这条测试读的是**真的 bundle**，不是构造的假数据】
 * 用假数据只能证明 `computeUnlocked` 这个纯函数是对的，而它本来就是对的 ——
 * 出事的是喂给它的数据。只有拿真实产物来问「新用户能不能一路走到每一节课」，
 * 才能在主人下次又挑着生成内容时当场变红。
 */
import { describe, expect, it } from 'vitest'
import bundleJson from '../../generated/content-bundle.json'
import { computeUnlocked } from '../../../../shared/unlock'
import type { ContentBundle } from '../../../../shared/types'

const bundle = bundleJson as unknown as ContentBundle
const lessons = bundle.lessons
const ids = new Set(lessons.map((l) => l.id))

/** 前置的传递闭包（带访问集，环也能安全走完） */
function prereqClosure(id: string, seen = new Set<string>()): Set<string> {
  const l = lessons.find((x) => x.id === id)
  if (!l) return seen
  for (const r of l.required) {
    if (seen.has(r)) continue
    seen.add(r)
    prereqClosure(r, seen)
  }
  return seen
}

describe('内容可达性（读真实 bundle）', () => {
  it('至少有一节课，否则这条测试自己是空转的', () => {
    expect(lessons.length).toBeGreaterThan(0)
  })

  it('★ 每一节有正文的课，前置闭包里全都是**有正文**的课', () => {
    // 这是「永久锁死」的判据：前置里只要混进一节没正文的课，那节课就再也解不开。
    const broken: string[] = []
    for (const l of lessons) {
      const missing = [...prereqClosure(l.id)].filter((r) => !ids.has(r))
      if (missing.length > 0) broken.push(`${l.id} ← ${missing.join(', ')}（无正文）`)
    }
    expect(broken, `这些课被永久锁死：\n  ${broken.join('\n  ')}`).toEqual([])
  })

  it('解锁图里没有环（有环的话谁都出不来）', () => {
    // 自己是否在自己的前置闭包里 = 有环
    const cyclic = lessons.filter((l) => prereqClosure(l.id).has(l.id)).map((l) => l.id)
    expect(cyclic).toEqual([])
  })

  it('★ 新用户（一节课都没学）至少能打开每一节**没有前置**的课', () => {
    // 这条是对着主人的原话钉的：「保证我点开任何一节有内容的课程，都能正常显示」
    // 注意它**不是**要求「所有课一进来就全开」—— 有前置的课正常锁着是对的，
    // 上一条测试已经保证了那些前置都是学得到的。
    const unlocked = computeUnlocked(lessons, new Set())
    const free = lessons.filter((l) => l.required.length === 0).map((l) => l.id)
    expect(free.length).toBeGreaterThan(0)
    for (const id of free) expect(unlocked.has(id), `${id} 无前置却没解锁`).toBe(true)
  })

  it('顺着学下去，每一节课最终都能解锁（真的走一遍，不是只看图）', () => {
    // 模拟新用户按顺序学：反复「把当前解锁的课标成已学」，直到不再有新解锁。
    // 收尾时若还有课没解锁，说明它在一条走不通的链后面。
    const learned = new Set<string>()
    for (let round = 0; round < lessons.length + 1; round++) {
      const unlocked = computeUnlocked(lessons, learned)
      const before = learned.size
      for (const id of unlocked) learned.add(id)
      if (learned.size === before) break
    }
    const stuck = lessons.filter((l) => !learned.has(l.id)).map((l) => l.id)
    expect(stuck, `这些课顺着学也到不了：${stuck.join(', ')}`).toEqual([])
  })
})
