/**
 * base-url 单测 —— 「往哪发」的三条规则各有一组用例：
 * 打包版恒走构建期默认地址（忽略环境变量）/ 明文 http 只放行回环 /
 * 不合法就是空串（绝不静默回退）。全是纯函数，零网络。
 */
import { describe, expect, it } from 'vitest'
import {
  BASE_URL_ENV_VAR,
  DEV_DEFAULT_BASE_URL,
  PROD_DEFAULT_BASE_URL,
  resolveCloudBaseUrl
} from '../base-url'

/** 造一个环境（只带这一个变量） */
function env(value: string | undefined): Record<string, string | undefined> {
  return value === undefined ? {} : { [BASE_URL_ENV_VAR]: value }
}

describe('base-url 开发版默认值', () => {
  it('没设环境变量 → 开发期默认（127.0.0.1:8787，与 server 的 PORT 默认一致）', () => {
    expect(DEV_DEFAULT_BASE_URL).toBe('http://127.0.0.1:8787')
    expect(resolveCloudBaseUrl({ packaged: false, env: env(undefined) })).toBe(DEV_DEFAULT_BASE_URL)
  })

  it('环境变量是空串 = 没设 → 默认值', () => {
    expect(resolveCloudBaseUrl({ packaged: false, env: env('') })).toBe(DEV_DEFAULT_BASE_URL)
  })

  it('环境变量名是钉死的那个（改名字要同批改启动脚本与文档）', () => {
    expect(BASE_URL_ENV_VAR).toBe('MIAI_CLOUD_BASE_URL')
  })
})

describe('base-url 明文 http 只放行回环', () => {
  it('127.0.0.1 / localhost / [::1] 照收，尾斜杠削掉', () => {
    expect(resolveCloudBaseUrl({ packaged: false, env: env('http://127.0.0.1:8787/') })).toBe(
      'http://127.0.0.1:8787'
    )
    expect(resolveCloudBaseUrl({ packaged: false, env: env('http://localhost:9000') })).toBe('http://localhost:9000')
    expect(resolveCloudBaseUrl({ packaged: false, env: env('http://[::1]:8787') })).toBe('http://[::1]:8787')
  })

  it('非回环的明文 http 一律拒收 → 空串（用户名密码不许明文上公网）', () => {
    expect(resolveCloudBaseUrl({ packaged: false, env: env('http://192.168.1.5:8787') })).toBe('')
    expect(resolveCloudBaseUrl({ packaged: false, env: env('http://cloud.example.com') })).toBe('')
  })
})

describe('base-url https 与路径', () => {
  it('https 任意主机放行；带路径的地址保留路径、只削尾斜杠', () => {
    expect(resolveCloudBaseUrl({ packaged: false, env: env('https://cloud.example.com/') })).toBe(
      'https://cloud.example.com'
    )
    expect(resolveCloudBaseUrl({ packaged: false, env: env('https://cloud.example.com/api/') })).toBe(
      'https://cloud.example.com/api'
    )
    expect(resolveCloudBaseUrl({ packaged: false, env: env('  https://cloud.example.com  ') })).toBe(
      'https://cloud.example.com'
    )
  })
})

describe('base-url 不合法 = 未配置（绝不静默回退默认值）', () => {
  it('不是 URL / 不是 http(s) → 空串，而不是偷偷用回环默认值', () => {
    // 静默回退会把「我配错了」伪装成「我连的是默认服务器」——最费命的一种假象
    expect(resolveCloudBaseUrl({ packaged: false, env: env('not a url') })).toBe('')
    expect(resolveCloudBaseUrl({ packaged: false, env: env('ftp://cloud.example.com') })).toBe('')
    expect(resolveCloudBaseUrl({ packaged: false, env: env('http://') })).toBe('')
  })
})

describe('base-url 打包版恒走构建期默认地址（忽略环境变量）', () => {
  it('开源版默认未配置（空串）：仓库不内置任何作者的服务器地址', () => {
    expect(PROD_DEFAULT_BASE_URL).toBe('')
  })

  it('打包版设了 https 环境变量也不认（防凭据重定向）——照走构建期默认值', () => {
    expect(resolveCloudBaseUrl({ packaged: true, env: env('https://attacker.example.com') })).toBe(
      PROD_DEFAULT_BASE_URL
    )
  })

  it('打包版没设环境变量 → 构建期默认值（开源版为空串 = 未配置）', () => {
    expect(resolveCloudBaseUrl({ packaged: true, env: env(undefined) })).toBe(PROD_DEFAULT_BASE_URL)
  })
})
