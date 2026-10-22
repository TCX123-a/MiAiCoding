/**
 * 账号 ID 的白名单校验（src/main/store/account-id.ts）
 *
 * 【这个文件在守什么】accountId 会被拼进文件路径（accounts/<id>/），而它来自
 * 服务端响应 —— 「上游可信」不是拼路径的理由：一个 `../../` 形状的 id 就能把
 * 读写引到账号目录之外，事故级别是「A 读写 B 的档案」甚至「覆盖任意文件」，
 * 而且什么都不报错。防线只有一条：**拼路径前先白名单全匹配**（canonical UUID），
 * 不是黑名单查 `..`（黑名单永远漏）。这里的用例就是这条防线的坐标。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，字符串一律英文。
 */
import { describe, expect, it } from 'vitest'
import { randomUUID } from 'crypto'
import { assertSafeAccountId, isCanonicalUuid } from '../account-id'

const UUID = '3f2a6c14-9d5b-4e7a-8c01-2b3d4e5f6a70'

// ---------------------------------------------------------------- 放行

describe('assertSafeAccountId：放行', () => {
  it('canonical UUID 原样放行；crypto.randomUUID 回环（真实来源的形状）', () => {
    expect(assertSafeAccountId(UUID)).toBe(UUID)
    const fresh = randomUUID()
    expect(assertSafeAccountId(fresh)).toBe(fresh)
  })

  it('大写归一成小写（同一个账号不许有大写、小写两套目录）', () => {
    expect(assertSafeAccountId(UUID.toUpperCase())).toBe(UUID)
  })

  it('nil UUID 放行 —— 版本位是服务端的事，不是路径安全的事', () => {
    const nil = '00000000-0000-0000-0000-000000000000'
    expect(assertSafeAccountId(nil)).toBe(nil)
  })
})

// ---------------------------------------------------------------- 拒绝

describe('assertSafeAccountId：拒绝（一律 TypeError）', () => {
  it('穿越 / 分隔符 / 绝对路径 / 空串 —— 这些是真正的威胁形状', () => {
    for (const bad of ['../../evil', '..', 'a/b', 'a\\b', 'C:/tmp', '/abs', './x', '', '   ']) {
      expect(() => assertSafeAccountId(bad), JSON.stringify(bad)).toThrow(TypeError)
    }
  })

  it('形状差一点也拒（去连字符 / 多一位 / 少一位 / 非十六进制 / 带空白）', () => {
    for (const bad of [
      UUID.replace(/-/g, ''), // 32 hex：是 UUID，但不是 canonical 写法
      UUID + 'a',
      UUID.slice(0, -1),
      'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz',
      ` ${UUID}`,
      `${UUID} `,
      `${UUID}\n`
    ]) {
      expect(() => assertSafeAccountId(bad), JSON.stringify(bad)).toThrow(TypeError)
    }
  })

  it('非字符串（null / undefined / 数字 / 对象 / 数组 / 布尔）也拒 —— 类型检查不是可选项', () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      expect(() => assertSafeAccountId(bad)).toThrow(TypeError)
    }
  })

  it('错误消息带**截断后**的原值（排查要看得到"到底是什么东西被拒了"）', () => {
    let msg = ''
    try {
      assertSafeAccountId('x'.repeat(200))
    } catch (err) {
      msg = (err as Error).message
    }
    expect(msg.startsWith('unsafe account id:')).toBe(true)
    // JSON 引号包裹的**恰好 80 个 x**：证明截到了 80。若没截，200 个 x 连排里
    // 不会出现「80 个 x 后面紧跟一个引号」的形状
    expect(msg).toContain(`"${'x'.repeat(80)}"`)
    expect(msg).not.toContain(`"${'x'.repeat(81)}"`)
  })

  it('非字符串在消息里如实标出类型（不是闷声一个 TypeError）', () => {
    let msg = ''
    try {
      assertSafeAccountId(42)
    } catch (err) {
      msg = (err as Error).message
    }
    expect(msg).toBe('unsafe account id: number')
  })
})

// ---------------------------------------------------------------- 只问形状

describe('isCanonicalUuid：只回答形状，不抛', () => {
  it('真值表', () => {
    expect(isCanonicalUuid(UUID)).toBe(true)
    expect(isCanonicalUuid(UUID.toUpperCase())).toBe(true)
    for (const bad of [null, undefined, 42, {}, [], '../../x', `${UUID} `, UUID.slice(0, -1)]) {
      expect(isCanonicalUuid(bad), JSON.stringify(bad)).toBe(false)
    }
  })
})
