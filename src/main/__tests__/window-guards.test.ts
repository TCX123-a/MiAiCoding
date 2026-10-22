import { describe, expect, it } from 'vitest'
import { decideNavigation, isExternalUrlAllowed } from '../window-guards'

/**
 * 窗口守卫纯函数单测（P10.1 §7.1-12）
 *
 * 不起 Electron：两张闸都是纯函数，这里只喂字符串、只看返回值。
 * 三条纪律：
 *  ① allow 清单证明「该放的行放了」、block 清单证明「不该放的行被拦了」——
 *    两个方向互为对照，某个常量写反之后不可能两边同时假绿。
 *  ② block 侧特意放「几乎一样但差一处」的样本（同主机跨端口、http↔https、
 *    file 同 pathname 不同 query）：判据必须落在真正的那一处差别上，
 *    拿 startsWith / includes 凑的近似实现打不过这些用例。
 *  ③ 种坏自检（手工做过一次）：把 decideNavigation 的同源判断改成恒真 ⇒
 *    跨源 / 跨端口 / http↔https 的 block 用例当场红；精确还原后全绿。
 *
 * 【字符串纪律】代码内字符串一律英文；中文只在注释里。
 */

describe('decideNavigation: allow cases (proven same-document / same-origin only)', () => {
  it('identical URL is allowed (http and file)', () => {
    expect(decideNavigation('http://localhost:5173/', 'http://localhost:5173/')).toBe('allow')
    expect(decideNavigation('file:///C:/app/index.html', 'file:///C:/app/index.html')).toBe('allow')
  })

  it('hash-only change is allowed (in-app hash routing / dev HMR full reload)', () => {
    expect(decideNavigation('http://localhost:5173/#/lesson/x', 'http://localhost:5173/#/lesson/y')).toBe('allow')
    expect(decideNavigation('file:///C:/app/index.html#a', 'file:///C:/app/index.html#b')).toBe('allow')
  })

  it('same-origin http path change is allowed (dev server full reload / in-app route)', () => {
    expect(decideNavigation('http://localhost:5173/b', 'http://localhost:5173/a')).toBe('allow')
    expect(decideNavigation('https://example.com/b?q=1', 'https://example.com/a')).toBe('allow')
  })

  it('file URL with same pathname and same search is allowed (production full reload)', () => {
    expect(decideNavigation('file:///C:/app/index.html?x=1', 'file:///C:/app/index.html?x=1')).toBe('allow')
    expect(decideNavigation('file:///C:/app/index.html?x=1#b', 'file:///C:/app/index.html?x=1#a')).toBe('allow')
  })
})

describe('decideNavigation: block cases (anything not proven same-document / same-origin)', () => {
  it('http -> https on the same host is blocked (origin includes the scheme)', () => {
    expect(decideNavigation('https://localhost:5173/a', 'http://localhost:5173/a')).toBe('block')
  })

  it('cross-port http is blocked (origin includes the port)', () => {
    expect(decideNavigation('http://localhost:6000/a', 'http://localhost:5173/a')).toBe('block')
  })

  it('https -> http downgrade is blocked', () => {
    expect(decideNavigation('http://example.com/a', 'https://example.com/a')).toBe('block')
  })

  it('cross-host http is blocked', () => {
    expect(decideNavigation('https://evil.example/a', 'https://example.com/a')).toBe('block')
  })

  it('file -> file with a different pathname is blocked', () => {
    expect(decideNavigation('file:///C:/app/other.html', 'file:///C:/app/index.html')).toBe('block')
  })

  it('file -> file with a different search is blocked (a query makes it a different URL)', () => {
    expect(decideNavigation('file:///C:/app/index.html?x=2', 'file:///C:/app/index.html?x=1')).toBe('block')
  })

  it('file -> http and http -> file are blocked', () => {
    expect(decideNavigation('http://localhost:5173/', 'file:///C:/app/index.html')).toBe('block')
    expect(decideNavigation('file:///C:/app/index.html', 'http://localhost:5173/')).toBe('block')
  })

  it('javascript: and data: targets are blocked', () => {
    expect(decideNavigation('javascript:alert(1)', 'http://localhost:5173/')).toBe('block')
    expect(decideNavigation('data:text/html,x', 'http://localhost:5173/')).toBe('block')
  })

  it('custom scheme targets are blocked (miai-wall:)', () => {
    expect(decideNavigation('miai-wall://x', 'http://localhost:5173/')).toBe('block')
  })

  it('unparsable target or current is blocked (unknown shape means deny)', () => {
    expect(decideNavigation('', 'http://localhost:5173/')).toBe('block')
    expect(decideNavigation('not a url', 'http://localhost:5173/')).toBe('block')
    expect(decideNavigation('http://localhost:5173/', '')).toBe('block')
    expect(decideNavigation('http://localhost:5173/', 'not a url')).toBe('block')
  })
})

describe('isExternalUrlAllowed: only http / https pass', () => {
  it('http and https are allowed', () => {
    expect(isExternalUrlAllowed('https://x.com/a')).toBe(true)
    expect(isExternalUrlAllowed('http://x')).toBe(true)
    expect(isExternalUrlAllowed('http://localhost:5173/')).toBe(true)
  })

  it('dangerous schemes are rejected even though they parse', () => {
    expect(isExternalUrlAllowed('javascript:alert(1)')).toBe(false)
    expect(isExternalUrlAllowed('data:text/html,x')).toBe(false)
    expect(isExternalUrlAllowed('file:///C:/x')).toBe(false)
    expect(isExternalUrlAllowed('miai-wall://x')).toBe(false)
  })

  it('unparsable input is rejected', () => {
    expect(isExternalUrlAllowed('not a url')).toBe(false)
    expect(isExternalUrlAllowed('')).toBe(false)
  })

  it('the two gates are independent: a same-document file URL navigates but never opens externally', () => {
    expect(decideNavigation('file:///C:/app/index.html', 'file:///C:/app/index.html')).toBe('allow')
    expect(isExternalUrlAllowed('file:///C:/app/index.html')).toBe(false)
  })
})
