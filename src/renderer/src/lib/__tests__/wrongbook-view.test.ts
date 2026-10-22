/**
 * 错题本的四组筛选（src/renderer/src/lib/wrongbook-view.ts）。
 *
 * 【这个文件在守什么】
 * 四条判据每一条错了都不会报错，只会让**数字**悄悄不对：
 * 删掉的题还在列表里、毕业数跟着删题一起涨、漏洞数比点进去能看到的条目多。
 * 而它们原来住在 PracticeView.vue 的 computed 里 —— views/ 不在 vitest 的
 * include 范围内，搬出来才守得住（文件抬头写了完整理由）。
 *
 * 种坏值记录（写这条时亲手验过会红）：
 *   · cleared 改成 `all.length - active.length` →「★ 删掉的不算毕业」红
 *   · active 去掉 `!e.removed` →「★ 删掉的从列表消失」红
 *   · hole 去掉 `!e.removed` →「已移除的不算漏洞」红
 */
import { describe, expect, it } from 'vitest'
import { splitWrongbook } from '../wrongbook-view'
import type { WrongBookEntry } from '../../../../shared/types'

function entry(key: string, over: Partial<WrongBookEntry> = {}): WrongBookEntry {
  const sep = key.indexOf(':')
  return {
    key,
    lessonId: key.slice(0, sep),
    qid: key.slice(sep + 1),
    wrongCount: 1,
    lastWrongAt: '2026-09-01T10:00:00.000Z',
    cleared: false,
    ...over
  }
}

describe('splitWrongbook：四组筛选', () => {
  it('★ 删掉的从「在库」消失（少判 removed 的话它纹丝不动地躺在列表里）', () => {
    const { active } = splitWrongbook([
      entry('common-01:q1'),
      entry('common-01:q2', { removed: true, removedAt: '2026-09-20T10:00:00.000Z' })
    ])
    expect(active.map((e) => e.key)).toEqual(['common-01:q1'])
  })

  it('★ 删掉的不算毕业（写成「总数 − 在库」时这条红：删一条毕业数就涨一）', () => {
    const { cleared } = splitWrongbook([
      entry('common-01:q1', { cleared: true, clearedAt: '2026-09-02T10:00:00.000Z' }),
      entry('common-01:q2', { removed: true, removedAt: '2026-09-20T10:00:00.000Z' })
    ])
    expect(cleared.map((e) => e.key)).toEqual(['common-01:q1'])
  })

  it('毕业的题不进「在库」（重做答对即毕业 —— 列表里它该消失）', () => {
    const { active } = splitWrongbook([
      entry('common-01:q1', { cleared: true }),
      entry('common-01:q2')
    ])
    expect(active.map((e) => e.key)).toEqual(['common-01:q2'])
  })

  it('漏洞只在在库里筛：已移除的、毕业的都不算（数了却点不进去 = 说假话）', () => {
    const { hole } = splitWrongbook([
      entry('common-01:q1', { hole: true }),
      entry('common-01:q2', { hole: true, removed: true, removedAt: '2026-09-20T10:00:00.000Z' }),
      entry('common-01:q3', { hole: true, cleared: true }),
      entry('common-01:q4') // 没插旗
    ])
    expect(hole.map((e) => e.key)).toEqual(['common-01:q1'])
  })

  it('毕业过、又被删掉：removed 和 cleared 两边都在（两条判据各说各的真话）', () => {
    const e = entry('common-01:q1', {
      cleared: true,
      clearedAt: '2026-09-02T10:00:00.000Z',
      removed: true,
      removedAt: '2026-09-20T10:00:00.000Z'
    })
    const { removed, cleared, active, hole } = splitWrongbook([e])
    expect(removed.map((x) => x.key)).toEqual(['common-01:q1'])
    expect(cleared.map((x) => x.key)).toEqual(['common-01:q1'])
    expect(active).toEqual([])
    expect(hole).toEqual([])
  })

  it('空错题本 → 四组全空（新用户的第一屏）', () => {
    expect(splitWrongbook([])).toEqual({ active: [], removed: [], hole: [], cleared: [] })
  })
})
