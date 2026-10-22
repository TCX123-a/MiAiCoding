/**
 * 随机池勾选代数（src/shared/media-pool.ts）
 *
 * 【这个文件在守什么】开屏素材池与壁纸轮播池**共用**这份代数，写错的方向
 * 每一条都难在界面上复现、但用户一看就知道「这软件坏了」：
 *   1. 空池歧义反转 —— 用户取消最后一项，池子变成空 = 语义反转成「全部参与」，
 *      界面把勾全勾回来。所以「结果为空就拒绝（返回 null）」是第一职责，
 *      下面真值表把「取消到最后一个」钉死；
 *   2. 幽灵名误杀 —— 素材临时不在（文件被挪走 / 工坊退订）时把池里的记忆
 *      一并清掉，素材回来也不再参与。单点切换必须保幽灵名，
 *      全选 / 反选才清（刻意的，见文件头）；
 *   3. 勾满不规范化 —— 存一份与全量等长的名单，新导入的素材默认被排除，
 *      与「全勾 = 全部参与」显示的含义相反。勾满必须存回空数组。
 */
import { describe, expect, it } from 'vitest'
import { allPool, checkedNames, invertPool, poolCount, togglePoolItem } from '../media-pool'

const ALL = ['a', 'b', 'c']

describe('checkedNames：空池 = 全量；幽灵名不显示', () => {
  it('空池 = 全勾', () => {
    expect([...checkedNames([], ALL)]).toEqual(ALL)
  })

  it('非空池：只显示还在全量里的名字（幽灵名留在池里、不上榜）', () => {
    expect([...checkedNames(['a', 'ghost'], ALL)]).toEqual(['a'])
  })

  it('全量也是空的时候不炸（清单没加载到时的 0 / 0）', () => {
    expect(checkedNames([], []).size).toBe(0)
    expect(checkedNames(['ghost'], []).size).toBe(0)
    expect(poolCount([], ALL)).toBe(3)
  })
})

describe('togglePoolItem：勾一项', () => {
  it('空池（= 全勾）取消一项 → 落成实体列表（其余仍在）', () => {
    expect(togglePoolItem([], ALL, 'b', false)).toEqual(['a', 'c'])
  })

  it('实体列表里取消一项 → 原样减掉', () => {
    expect(togglePoolItem(['a', 'c'], ALL, 'c', false)).toEqual(['a'])
  })

  it('取消**最后一个可见项** → null（空池歧义，界面拒绝并提示）', () => {
    expect(togglePoolItem(['a'], ALL, 'a', false)).toBeNull()
  })

  it('勾上一项：池非空时以原池为底', () => {
    expect(togglePoolItem(['a'], ALL, 'b', true)).toEqual(['a', 'b'])
  })

  it('勾上一项：幽灵名保留（素材回来时记忆还在）', () => {
    expect(togglePoolItem(['a', 'ghost'], ALL, 'b', true)).toEqual(['a', 'ghost', 'b'])
  })

  it('勾满 → 规范化回空数组（新素材自动参与；勾满时幽灵名一并清掉）', () => {
    expect(togglePoolItem(['a', 'b'], ALL, 'c', true)).toEqual([])
    expect(togglePoolItem(['a', 'b', 'ghost'], ALL, 'c', true)).toEqual([])
  })

  it('全勾状态下再勾已经是勾着的项 → 仍是规范态空数组（不膨胀成名单）', () => {
    expect(togglePoolItem([], ALL, 'b', true)).toEqual([])
  })

  it('取消防抖动：先把项取消、再勾回来 → 回到规范态', () => {
    const off = togglePoolItem([], ALL, 'b', false)
    expect(off).toEqual(['a', 'c'])
    expect(togglePoolItem(off as string[], ALL, 'b', true)).toEqual([])
  })
})

describe('invertPool：以眼前全量为准', () => {
  it('反选 = 未勾的勾上、勾上的没勾', () => {
    expect(invertPool(['a'], ALL)).toEqual(['b', 'c'])
  })

  it('全勾着再反选 = 空 → null（同一个空池歧义，拒绝）', () => {
    expect(invertPool([], ALL)).toBeNull()
  })

  it('池里只剩幽灵名：反选视为「眼前一个都没勾」→ 全勾（幽灵名随之清掉）', () => {
    expect(invertPool(['ghost'], ALL)).toEqual([])
  })

  it('全量为空时反选 → null（没有可操作的项）', () => {
    expect(invertPool([], [])).toBeNull()
  })
})

describe('allPool：全选 = 规范态空数组', () => {
  it('返回空数组（不是把名字抄一遍——那样新素材默认不参与）', () => {
    expect(allPool()).toEqual([])
  })
})
