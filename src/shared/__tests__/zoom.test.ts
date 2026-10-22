import { describe, expect, it } from 'vitest'
import {
  clampZoom,
  normalizeZoom,
  stepZoom,
  zoomScale,
  ZOOM_BUTTON_STEP,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN
} from '../zoom'

/**
 * 缩放纯逻辑的闸门。
 *
 * 这一层值得有测试，是因为它守的都是**不报错的那种坏**：
 * 越界的值进了 CSS，页面不会崩，只会「放大到头还能再放大」或者
 * 「拖到 137.6% 之后字号变成 13.6px 这种带小数的怪值」。
 * 这类问题在真机上要靠肉眼盯半天，在这里一行断言就钉死了。
 */

describe('钳位', () => {
  it('区间内原样返回', () => {
    expect(clampZoom(100)).toBe(100)
    expect(clampZoom(ZOOM_MIN)).toBe(ZOOM_MIN)
    expect(clampZoom(ZOOM_MAX)).toBe(ZOOM_MAX)
  })

  it('越界钳到边界，而不是原样放行', () => {
    expect(clampZoom(0)).toBe(ZOOM_MIN)
    expect(clampZoom(-999)).toBe(ZOOM_MIN)
    expect(clampZoom(999)).toBe(ZOOM_MAX)
  })

  it('小数四舍五入成整数', () => {
    // 带小数的百分比会原样进 CSS，算出 13.6px 这种字号 —— 看着就是「糊」
    expect(clampZoom(137.6)).toBe(138)
    expect(clampZoom(137.4)).toBe(137)
  })

  it('非有限数退回默认值，而不是钳到边界', () => {
    // 这一条是和「越界」分开的两种情形：越界是人在拖，NaN 是数据坏了。
    // 数据坏了的时候，当成 100% 才是安全的猜测 —— 当成 50% 会让用户
    // 打开软件看到一个缩得看不清的界面，还以为是自己弄坏的。
    expect(clampZoom(NaN)).toBe(ZOOM_DEFAULT)
    expect(clampZoom(Infinity)).toBe(ZOOM_DEFAULT)
    expect(clampZoom(-Infinity)).toBe(ZOOM_DEFAULT)
  })
})

describe('从存储里读回来的值', () => {
  it('认得数字和数字字符串', () => {
    expect(normalizeZoom(150)).toBe(150)
    expect(normalizeZoom('150')).toBe(150)
    // localStorage 存的永远是字符串，所以这条才是真实路径
    expect(normalizeZoom('100')).toBe(ZOOM_DEFAULT)
  })

  it('认不出来的东西一律退回默认值', () => {
    for (const bad of [null, undefined, '', 'abc', '{}', [], {}, true, false, NaN]) {
      expect(normalizeZoom(bad), String(bad)).toBe(ZOOM_DEFAULT)
    }
  })

  it('能读出来的越界值照样钳', () => {
    expect(normalizeZoom('9999')).toBe(ZOOM_MAX)
    expect(normalizeZoom('1')).toBe(ZOOM_MIN)
  })

  it('对象不会被 String() 蒙混过关', () => {
    // 这条是真会咬人的：`String([])` 是 ''，但 `String(['150'])` 是 '150'，
    // 要是实现写成「先 String() 再 parseInt」而不先挡掉非字符串/非数字，
    // 一个数组就能把缩放设成 150%。上面那条用例只覆盖了空数组。
    expect(normalizeZoom(['150'])).toBe(ZOOM_DEFAULT)
    expect(normalizeZoom({ toString: () => '150' })).toBe(ZOOM_DEFAULT)
  })
})

describe('步进', () => {
  it('加一步、减一步', () => {
    expect(stepZoom(100, 1)).toBe(100 + ZOOM_BUTTON_STEP)
    expect(stepZoom(100, -1)).toBe(100 - ZOOM_BUTTON_STEP)
  })

  it('顶到边界就停住，不会越过去', () => {
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX)
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN)
    // 差一步就到顶的情形：结果必须正好落在上限上，不能是 195 + 10 = 205
    expect(stepZoom(ZOOM_MAX - 1, 1)).toBe(ZOOM_MAX)
  })

  it('从坏值出发也能被拉回合法区间', () => {
    // 坏值先被当成「钳到边界」，再走一步 —— 而不是在坏值上硬加：
    // 0 是「比下限还小」，所以它先去 ZOOM_MIN，再 +10；
    // NaN 是「数据坏了」，所以它先去 ZOOM_DEFAULT，再 +10。
    expect(stepZoom(NaN, 1)).toBe(ZOOM_DEFAULT + ZOOM_BUTTON_STEP)
    expect(stepZoom(0, 1)).toBe(ZOOM_MIN + ZOOM_BUTTON_STEP)
  })
})

describe('换算成 CSS 倍数', () => {
  it('百分比除以 100', () => {
    expect(zoomScale(100)).toBe(1)
    expect(zoomScale(ZOOM_MIN)).toBe(0.5)
    expect(zoomScale(ZOOM_MAX)).toBe(2)
  })

  it('100% 必须是**精确的** 1', () => {
    // 不精确的 1（比如 1.0000000000000002）会让 `zoom` 在 100% 时
    // 也走一遍缩放路径，CodeMirror 的 getScale 补偿会被无谓地唤醒。
    expect(zoomScale(ZOOM_DEFAULT)).toBe(1)
  })

  it('坏值不会算出 NaN 或负数', () => {
    for (const bad of [NaN, Infinity, -Infinity, 0, -50]) {
      const s = zoomScale(bad)
      expect(Number.isFinite(s), String(bad)).toBe(true)
      expect(s).toBeGreaterThanOrEqual(0.5)
      expect(s).toBeLessThanOrEqual(2)
    }
  })
})

describe('边界常量自洽', () => {
  it('下限小于默认值、默认值小于上限', () => {
    expect(ZOOM_MIN).toBeLessThan(ZOOM_DEFAULT)
    expect(ZOOM_DEFAULT).toBeLessThan(ZOOM_MAX)
  })

  it('默认值本身就在区间里（钳一遍不该变）', () => {
    expect(clampZoom(ZOOM_DEFAULT)).toBe(ZOOM_DEFAULT)
  })

  it('默认值恰好是步进的整数倍，点回 100% 不需要歪着走', () => {
    expect(ZOOM_DEFAULT % ZOOM_BUTTON_STEP).toBe(0)
    expect(ZOOM_MIN % ZOOM_BUTTON_STEP).toBe(0)
    expect(ZOOM_MAX % ZOOM_BUTTON_STEP).toBe(0)
  })
})
