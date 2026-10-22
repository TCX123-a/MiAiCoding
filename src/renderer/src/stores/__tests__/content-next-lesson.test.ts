/**
 * 「下一课 →」在**真 bundle** 上的链路冒烟（V2-15 / V1-24）。
 *
 * 【为什么单测里已经有一份假大纲，这里还要读真产物】
 * 假大纲钉的是函数的分支行为；这里钉的是**数据形状**：大纲是全序的、
 * 有正文的课一节不落。将来内容生成器改了（比如把某节挪出大纲、
 * 或者跳号），假数据全绿而用户点着「下一课」走进死胡同 ——
 * 链条从这里一路 walk 到底，凡是「有正文却没被链到」的课都算红。
 */
import { describe, expect, it } from 'vitest'
import bundleJson from '../../generated/content-bundle.json'
import { nextWrittenAfter } from '../../../../shared/lesson-nav'
import type { ContentBundle } from '../../../../shared/types'

const bundle = bundleJson as unknown as ContentBundle

describe('下一课链路（真 bundle）', () => {
  const flat = bundle.outline.flatMap((m) => m.lessons)
  const written = flat.filter((l) => l.hasContent).map((l) => l.id)

  it('从第一节有正文的课出发，链条恰好走完所有有正文的课、到最后一节停', () => {
    expect(written.length).toBeGreaterThan(0)
    const visited: string[] = []
    let cur: string | null = written[0]
    while (cur !== null) {
      visited.push(cur)
      cur = nextWrittenAfter(bundle.outline, cur)
      // 防环：真数据里出现环的话，上限挡住死循环，让断言报红而不是挂住
      if (visited.length > flat.length + 1) break
    }
    // 链条走出来的顺序 = 大纲里"有正文"的课的顺序，一节不缺、一节不多
    expect(visited).toEqual(written)
  })

  it('最后一节有正文的课后面没有下一课 → null', () => {
    expect(nextWrittenAfter(bundle.outline, written[written.length - 1])).toBe(null)
  })

  it('课号不在大纲里 → null', () => {
    expect(nextWrittenAfter(bundle.outline, 'no-such-lesson')).toBe(null)
  })
})
