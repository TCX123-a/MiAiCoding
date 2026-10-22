import { describe, expect, it } from 'vitest'
import { parseRange, pathFence } from '../protocol'

/**
 * protocol.ts 的两个纯函数：Range 解析与路径围栏。
 * 它们守的是**安全边界**（围栏）与**播放正确性**（Range）—— 前者漏了是任意文件读，
 * 后者错了是视频静默降级成整份下载。两件都值得钉死。
 * （顶层 import electron 在 node 下拿到 undefined 但不炸；这两个函数不碰它。）
 */

describe('parseRange', () => {
  it('没带 / 不认识的形态 → null（按 200 全量处理）', () => {
    expect(parseRange(null, 100)).toBeNull()
    expect(parseRange('', 100)).toBeNull()
    expect(parseRange('items=0-9', 100)).toBeNull()
    expect(parseRange('bytes=0-9, 20-29', 100)).toBeNull() // 多段不认（引擎只发单段）
  })

  it('bytes=N- → 从 N 到文件尾（引擎每次请求的形状）', () => {
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 })
  })

  it('bytes=A-B → 闭区间，B 超界钳到 size-1', () => {
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseRange('bytes=50-999', 100)).toEqual({ start: 50, end: 99 })
  })

  it('bytes=-N → 末尾 N 字节', () => {
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-1000', 100)).toEqual({ start: 0, end: 99 }) // 超全长度按全长
  })

  it('合法但不可满足 → invalid（回 416），不是 null', () => {
    expect(parseRange('bytes=100-', 100)).toBe('invalid') // start >= size
    expect(parseRange('bytes=50-10', 100)).toBe('invalid') // start > end
    expect(parseRange('bytes=-', 100)).toBe('invalid') // 两头都空
    expect(parseRange('bytes=-0', 100)).toBe('invalid') // 末尾 0 字节没意义
  })

  it('空文件的边界：bytes=0- → invalid（start>=size=0）', () => {
    expect(parseRange('bytes=0-', 0)).toBe('invalid')
  })
})

describe('pathFence', () => {
  const ok = (p: string): string[] | null => {
    const r = pathFence(p)
    return r.ok ? r.segs : null
  }

  it('正常路径：拆段 + 解码（中文/空格）', () => {
    expect(ok('/C:/x/%E4%BD%90%E5%8A%A9/a.mp4')).toEqual(['C:', 'x', '佐助', 'a.mp4'])
    expect(ok('/C:/my%20dir/b.mp4')).toEqual(['C:', 'my dir', 'b.mp4'])
  })

  it('拒绝 .. / . / 空段（路径穿越）', () => {
    expect(pathFence('/C:/x/../secret')).toEqual({ ok: false, why: 'dot-or-empty' })
    expect(pathFence('/C:/x/./y')).toEqual({ ok: false, why: 'dot-or-empty' })
    expect(pathFence('/C:/x//y')).toEqual({ ok: false, why: 'dot-or-empty' })
  })

  it('拒绝反斜杠与 NUL（反斜杠是 Windows 路径穿越的绕行路）', () => {
    expect(pathFence('/C:/x/%5C..%5Cy')).toEqual({ ok: false, why: 'nul-or-backslash' })
    expect(pathFence('/C:/x/%00y')).toEqual({ ok: false, why: 'nul-or-backslash' })
  })

  it('编码坏了 → decode-fail，不是抛异常', () => {
    expect(pathFence('/C:/x/%ZZ')).toEqual({ ok: false, why: 'decode-fail' })
  })

  it('编码过的 ..（%2E%2E）照样拦住 —— 先解码再判，顺序不能反', () => {
    expect(pathFence('/C:/x/%2E%2E/y')).toEqual({ ok: false, why: 'dot-or-empty' })
  })

  it('★ 解码后夹带 / 的段（%2F 走私）→ 拒（回归：曾放行 ⇒ 围栏外任意文件读）', () => {
    // 2026-10-14 夜巡 PoC（probe-wall2）在真应用里复现过：段 '..%2Fsecret.txt'
    // 解码成 '../secret.txt'，旧围栏只拒**恰好等于** '..' 的段 ⇒ 放行；
    // join 后 allowed() 是纯字符串前缀比对（'<根>/../secret.txt' 仍以根开头）⇒
    // 读到围栏根之外。合法文件名段解码后不可能含 '/'（拼 URL 时逐段 encode），
    // 含 '/' 只可能是走私 —— 一律拒。
    expect(pathFence('/C:/x/..%2Fsecret.txt')).toEqual({ ok: false, why: 'slash-in-segment' })
    expect(pathFence('/C:/x/a%2Fb')).toEqual({ ok: false, why: 'slash-in-segment' })
    expect(pathFence('/C:/x%2Fy/z')).toEqual({ ok: false, why: 'slash-in-segment' })
    // %2f 小写同样算
    expect(pathFence('/C:/x/..%2fsecret.txt')).toEqual({ ok: false, why: 'slash-in-segment' })
  })
})
