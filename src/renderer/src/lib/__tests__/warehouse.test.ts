/**
 * 大肥鱼仓库（P3 ⑨）：图鉴格子视图模型 + 下载三态映射的全部边界。
 *
 * 【为什么这条测试盯「未知 id」盯得这么死】
 * 老档案里可能躺着已被主人删掉的图 id（`shared/gallery.ts` 抬头那段）。
 * 它要是混进格子，界面上就是「已收集 51/50 张」，或者一个永远打不开的格子 ——
 * 而这两种都只在**用户自己身上**复现，开发机上看不到（开发档里没有陌生 id）。
 * 所以这里配一把"来者不拒 + 留痕"的假取图器：假 id 真混进去，断言必红。
 *
 * 【这些 id 不是手打的】g01 之类全部现取自 `GALLERY_IDS` —— 手打会在图库
 * 改名时留下一条"还在引用旧名字"的假绿（表挪了，测试还在自说自话）。
 */
import { describe, expect, it } from 'vitest'
import { GALLERY_IDS } from '../../../../shared/gallery'
import { GALLERY } from '../copy'
import {
  buildWarehouseGrid,
  fileNameOf,
  saveToastOf
} from '../warehouse'

/**
 * 表外末位 id：**现算而不是写死 'g99'** —— 2026-10-17 图库扩到 g200 后 g99 进册，
 * 「陌生 id」这条用例会拿真 id 测（假绿）。maxN + 1 永远在表外。
 */
const maxN = Math.max(...GALLERY_IDS.map((x) => Number(x.replace(/^g/, ''))).filter(Number.isFinite))
const OFF_TABLE = `g${maxN + 1}`

/** 假取图器：任何 id 都给同一个地址，同时把每次询问记下来（"没被问过"也是证据） */
function spyUrlOf(url: string | null = 'blob:fake'): {
  calls: string[]
  urlOf: (id: string) => string | null
} {
  const calls: string[] = []
  return {
    calls,
    urlOf: (id: string) => {
      calls.push(id)
      return url
    }
  }
}

describe('格子数就是图库的表（列数自适应，与表长解绑）', () => {
  it('格子顺序 = GALLERY_IDS 的顺序，且格子里只有表里的 id', () => {
    const g = buildWarehouseGrid([], spyUrlOf().urlOf)
    expect(g.cells.map((c) => c.id)).toEqual([...GALLERY_IDS])
    expect(g.total).toBe(GALLERY_IDS.length)
  })
})

describe('owned / locked 映射与 0、集齐两个边界', () => {
  it('一张都没有：全 locked、url 全 null、收藏数 0，而且取图器一次都没被问过', () => {
    const { calls, urlOf } = spyUrlOf()
    const g = buildWarehouseGrid([], urlOf)
    expect(g.cells).toHaveLength(GALLERY_IDS.length)
    expect(g.cells.every((c) => !c.owned && c.url === null)).toBe(true)
    expect(g.ownedCount).toBe(0)
    // locked 的格子画的是占位符，没有取图这回事 —— 问了就说明多走了不该走的岔路
    expect(calls).toEqual([])
  })

  it('集齐（全收集边界）：全 owned、每格都拿到地址、收藏数 = 表长', () => {
    const g = buildWarehouseGrid(GALLERY_IDS.slice(), spyUrlOf('blob:x').urlOf)
    expect(g.ownedCount).toBe(GALLERY_IDS.length)
    expect(g.cells.every((c) => c.owned && c.url === 'blob:x')).toBe(true)
  })

  it('收了一部分：owned 的就那几张，其余 locked（顺序仍跟表走）', () => {
    const some = [GALLERY_IDS[2], GALLERY_IDS[6]]
    const g = buildWarehouseGrid(some, spyUrlOf().urlOf)
    expect(g.cells.filter((c) => c.owned).map((c) => c.id)).toEqual(some)
    expect(g.ownedCount).toBe(2)
  })

  it('已收集但图缺位（打包版路径差异）：格子照样 owned，只是 url 为 null（视图据此画占位）', () => {
    const g = buildWarehouseGrid([GALLERY_IDS[1]], () => null)
    const cell = g.cells.find((c) => c.id === GALLERY_IDS[1])!
    expect(cell.owned).toBe(true)
    expect(cell.url).toBeNull()
    expect(g.ownedCount).toBe(1)
  })
})

describe('未知 id / 重复 id：不占格、不计数、走不到取图那一步', () => {
  it('尺子自证：一个来者不拒的取图器也救不回假 id（真混进格必红）', () => {
    const { calls, urlOf } = spyUrlOf()
    // 老档案里常见的两种脏：已被删掉的图 id、被手改过的串
    const g = buildWarehouseGrid(
      [OFF_TABLE, GALLERY_IDS[0], 'not-a-reward', GALLERY_IDS[0]],
      urlOf
    )
    // 干净档（[]）与脏档的格子一模一样 —— 假 id 一个像素都没漏进来
    const clean = buildWarehouseGrid([], spyUrlOf().urlOf)
    expect(g.cells.map((c) => c.id)).toEqual(clean.cells.map((c) => c.id))
    expect(g.cells.map((c) => c.id)).toEqual([...GALLERY_IDS])
    // 重复的合法 id 不双算，假 id 不入账
    expect(g.cells.filter((c) => c.owned).map((c) => c.id)).toEqual([GALLERY_IDS[0]])
    expect(g.ownedCount).toBe(1)
    // 关键取证：取图器只被问过一次，问的是那个合法 id —— 假 id 连这一步都没走到
    expect(calls).toEqual([GALLERY_IDS[0]])
  })

  it('整个档案都是陌生 id：收藏数 0，不是"有 N 个"', () => {
    const g = buildWarehouseGrid(['a', 'b', 'c'], spyUrlOf().urlOf)
    expect(g.ownedCount).toBe(0)
    expect(g.cells.every((c) => !c.owned)).toBe(true)
  })
})

describe('纯函数：不改入参（冻结的数组也能喂）', () => {
  it('入参原样不动，结果与入参的写时快照无关', () => {
    const owned = Object.freeze([GALLERY_IDS[0], GALLERY_IDS[4]])
    const before = [...owned]
    const g = buildWarehouseGrid(owned, spyUrlOf().urlOf)
    expect([...owned]).toEqual(before)
    expect(g.ownedCount).toBe(2)
  })
})

describe('下载三态 → toast（复用 GALLERY.SAVE_*，三态不许合并）', () => {
  it('存好了：success，报文件名而不是整条路径', () => {
    const t = saveToastOf({ ok: true, path: 'C:\\Users\\me\\Pictures\\g01.png' })
    expect(t.type).toBe('success')
    expect(t.text).toBe(GALLERY.SAVED('g01.png'))
    expect(t.text).not.toContain('Pictures')
  })

  it('用户取消：info（不是错误），且与失败那句不是同一句', () => {
    const cancelled = saveToastOf({ ok: false, reason: 'cancelled' })
    expect(cancelled).toEqual({ text: GALLERY.SAVE_CANCELLED, type: 'info' })
    const failed = saveToastOf({ ok: false, reason: 'failed' })
    expect(cancelled.text).not.toBe(failed.text)
    expect(cancelled.type).not.toBe(failed.type)
  })

  it('图找不到（missing）/ 拷贝失败（failed）：都如实报 error', () => {
    expect(saveToastOf({ ok: false, reason: 'missing' })).toEqual({
      text: GALLERY.SAVE_FAILED,
      type: 'error'
    })
    expect(saveToastOf({ ok: false, reason: 'failed' })).toEqual({
      text: GALLERY.SAVE_FAILED,
      type: 'error'
    })
  })

  it('fileNameOf：两种分隔符都只取最后一段，光秃秃的名字原样给回', () => {
    expect(fileNameOf('C:\\Users\\me\\Pictures\\g01.png')).toBe('g01.png')
    expect(fileNameOf('/home/me/Pictures/g12.png')).toBe('g12.png')
    expect(fileNameOf('g03.png')).toBe('g03.png')
  })
})
