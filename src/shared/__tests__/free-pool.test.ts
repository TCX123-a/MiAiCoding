/**
 * 双模式（shared/free-pool.ts）与 Key 前缀识别（shared/ai-providers.ts）。
 *
 * 【为什么单独钉这两组纯函数】
 *   · `aiModeOf` / `poolModelOf` 是**坏配置的最后一道兜底**：读迁移、合并、
 *     发请求三条路都经过它们。写反一个分支不会崩，只会让请求悄悄走错路。
 *   · `detectAiProviderFromKey` 决定「这把 Key 存到哪家账上」。猜错不是显示
 *     问题 —— 它会把用户的凭据发到另一家服务商。所以它的规矩是「只认有把握
 *     的前缀，认不出就返回 null」，这里逐条钉住，尤其钉住**不许瞎猜 sk-**。
 */
import { describe, expect, it } from 'vitest'
import {
  FREE_POOL_DEFAULT_MODEL,
  aiModeOf,
  isAiMode,
  poolModelOf
} from '../free-pool'
import { detectAiProviderFromKey } from '../ai-providers'

describe('aiModeOf：坏值一律退回 api', () => {
  it('两个合法值原样返回', () => {
    expect(aiModeOf('api')).toBe('api')
    expect(aiModeOf('pool')).toBe('pool')
  })

  it.each([undefined, null, '', 'free', 'POOL', ' api ', 0, 1, true, {}, []])(
    '坏值 %s → api（免费池必须由用户明确选中，不能猜）',
    (v) => {
      expect(aiModeOf(v)).toBe('api')
    }
  )

  it('isAiMode 只认两个字面量', () => {
    expect(isAiMode('api')).toBe(true)
    expect(isAiMode('pool')).toBe(true)
    expect(isAiMode('API')).toBe(false)
    expect(isAiMode(undefined)).toBe(false)
  })
})

describe('poolModelOf：保证下一次请求有模型名可发', () => {
  it('非空字符串去掉首尾空白后原样返回', () => {
    expect(poolModelOf('  x/free  ')).toBe('x/free')
  })

  it.each([undefined, null, '', '   ', 42, true, {}, []])('坏值 %s → 兜底模型', (v) => {
    expect(poolModelOf(v)).toBe(FREE_POOL_DEFAULT_MODEL)
  })
})

describe('detectAiProviderFromKey：只认有把握的前缀', () => {
  it('sk-ant- → anthropic', () => {
    expect(detectAiProviderFromKey('sk-ant-api03-abcdefgh')).toBe('anthropic')
    expect(detectAiProviderFromKey('  sk-ant-abcdefgh  ')).toBe('anthropic')
  })

  it('OpenAI 的新版项目 / 服务账号 / 管理 Key → openai', () => {
    for (const k of [
      'sk-proj-abcdefgh',
      'sk-svcacct-abcdefgh',
      'sk-admin-abcdefgh',
      'SK-PROJ-abcdefgh'
    ]) {
      expect(detectAiProviderFromKey(k), k).toBe('openai')
    }
  })

  it('**含糊的 sk- 一律不猜**（DeepSeek / Kimi / 百炼同形状，猜错等于跨家发凭据）', () => {
    for (const k of [
      'sk-0123456789abcdef0123456789abcdef',
      'sk-abcdefgh',
      'sk-ant-',
      'sk-proj-',
      'sk-proj-short',
      'not-a-key',
      '',
      '   '
    ]) {
      expect(detectAiProviderFromKey(k), k).toBeNull()
    }
  })
})
