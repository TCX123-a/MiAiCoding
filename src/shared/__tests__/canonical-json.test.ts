/**
 * canonicalJson（src/shared/cloud/canonical-json.ts）—— 「同不同」判据的唯一尺子。
 *
 * 【这个文件在守什么】
 *   1. **键序不参与**：同一份数据的两种键序 ⇒ 逐字节相同的串。同步引擎的
 *      「内容一致就不推」（§8.2 第 6 步）与两处平局裁决都站在这一条上 ——
 *      它坏了的表现是「明明一样却一直互推」，网络层看不出任何错。
 *   2. **与 JSON 语义对齐**：undefined 属性丢弃、undefined 数组成 null、
 *      NaN/Infinity→null、Date 走 toJSON —— 差一个字节就是哈希不同。
 *   3. **平局裁决可交换**：`a vs b` 与 `b vs a` 选出同一个赢家（收敛保护，
 *      两台设备各自算必须得到同一个结论）。
 *   4. **幂等**：canonicalJson(canonicalJson(x) 的 parse 结果) 还是它自己。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，字符串一律英文。
 */
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../cloud/canonical-json'

describe('canonicalJson：键序不参与', () => {
  it('★ 键序不同的同一份数据 ⇒ 逐字节相同的串（含嵌套）', () => {
    const a = { b: 1, a: { d: 2, c: [3, 4] } }
    const b = { a: { c: [3, 4], d: 2 }, b: 1 }
    expect(canonicalJson(a)).toBe(canonicalJson(b))
    expect(canonicalJson(a)).toBe('{"a":{"c":[3,4],"d":2},"b":1}')
  })

  it('数组保序（数组是序列不是集合）', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
  })

  it('数组里的对象也排序', () => {
    expect(canonicalJson([{ y: 1, x: 2 }])).toBe('[{"x":2,"y":1}]')
  })

  it('★ 平局裁决可交换：a vs b 与 b vs a 选出同一个赢家', () => {
    const a = { k: [1] }
    const b = { k: [2] }
    const pick = <T,>(x: T, y: T): T => (canonicalJson(x) >= canonicalJson(y) ? x : y)
    expect(pick(a, b)).toBe(b)
    expect(pick(b, a)).toBe(b) // 交换入参，结论不换
  })

  it('键集合不同 ⇒ 串不同（多一个键就是不同的内容）', () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 1, b: 2 }))
  })
})

describe('canonicalJson：JSON 语义对齐', () => {
  it('undefined 属性丢弃、undefined 数组元素成 null（与 JSON.stringify 同款）', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
    expect(canonicalJson([1, undefined, 2])).toBe('[1,null,2]')
    expect(canonicalJson(undefined)).toBe('null')
  })

  it('NaN / Infinity → null；null 原样', () => {
    expect(canonicalJson(NaN)).toBe('null')
    expect(canonicalJson(Infinity)).toBe('null')
    expect(canonicalJson(null)).toBe('null')
  })

  it('parse 回来与原生 JSON 往返一致（JSON 能表达的数据）', () => {
    const value = { n: 1.5, s: 'x', b: true, z: null, arr: [{ q: [1, 2] }] }
    expect(JSON.parse(canonicalJson(value))).toEqual(value)
  })

  it('Date 走 toJSON（非普通对象交给原生，不自造）', () => {
    const iso = '2026-10-10T00:00:00.000Z'
    expect(canonicalJson(new Date(iso))).toBe(JSON.stringify(iso))
  })

  it('空对象 / 空数组', () => {
    expect(canonicalJson({})).toBe('{}')
    expect(canonicalJson([])).toBe('[]')
  })

  it('键里的特殊字符由 JSON.stringify 转义（不裸拼）', () => {
    expect(canonicalJson({ 'a"b': 1 })).toBe('{"a\\"b":1}')
  })

  it('幂等：解析回来再序列化，逐字节相同', () => {
    const value = { z: [1, { b: 2, a: 3 }], a: 'x' }
    const once = canonicalJson(value)
    expect(canonicalJson(JSON.parse(once) as unknown)).toBe(once)
  })
})
