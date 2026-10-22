/**
 * logoutFailureText（V1-62）：登出失败该说什么。
 *
 * 【这个文件在守什么】两条：
 *   ① NETWORK / TIMEOUT 必须走专文案 —— 断网时"退出登录需要联网"要说清
 *      "什么都没变"。退回通用 ERR.NETWORK 时这条红（而这正是修复前的样子）；
 *   ② 其余失败码**原样查表** —— 不许"顺手"把别的码也美化成网络说法
 *      （如实报码是第一纪律）。逐码遍历，将来加新码忘了分流也会在这里现形。
 */
import { describe, expect, it } from 'vitest'
import { ACCOUNT } from '../copy'
import { logoutFailureText } from '../account-view'
import type { CloudFailureCode } from '../../../../shared/cloud/dto'

const ALL_CODES = Object.keys(ACCOUNT.ERR) as CloudFailureCode[]

describe('logoutFailureText', () => {
  it('NETWORK 与 TIMEOUT → 专门的「登出需要联网」文案（不是通用查表）', () => {
    expect(logoutFailureText('NETWORK')).toBe(ACCOUNT.ERR_LOGOUT_NETWORK)
    expect(logoutFailureText('TIMEOUT')).toBe(ACCOUNT.ERR_LOGOUT_NETWORK)
    // 专文案必须真的和通用文案不同 —— 相同的话这条分流等于没做
    expect(ACCOUNT.ERR_LOGOUT_NETWORK).not.toBe(ACCOUNT.ERR.NETWORK)
    expect(ACCOUNT.ERR_LOGOUT_NETWORK).not.toBe(ACCOUNT.ERR.TIMEOUT)
  })

  it('其余失败码一律原样查表（逐码遍历，漏分流会在这条现形）', () => {
    const rest = ALL_CODES.filter((c) => c !== 'NETWORK' && c !== 'TIMEOUT')
    expect(rest.length).toBeGreaterThan(20) // ERR 表真的被读到（闸门不许空转）
    for (const code of rest) {
      expect(logoutFailureText(code), code).toBe(ACCOUNT.ERR[code])
    }
  })
})
