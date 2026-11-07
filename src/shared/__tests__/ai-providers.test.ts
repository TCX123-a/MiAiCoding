/**
 * AI 服务商目录（v24，2026-11-01 第二批多厂商）。
 *
 * 这张表是设置页下拉框、默认模型、请求地址和 v20 老配置迁移的共同真源。
 * 少一家 = 下拉框里没有；多一个坏地址 = 用户的 Key 被发到别处。所以这里
 * 既钉「五家新厂商都在」，也钉「不是官方域就绝不认领」。
 */
import { describe, expect, it } from 'vitest'
import {
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  aiProviderOf,
  baseUrlOf,
  defaultModelOf,
  detectAiProviderFromKey,
  isAiProviderId,
  providerForBaseUrl
} from '../ai-providers'

describe('服务商目录', () => {
  it('每个 id 只出现一次，custom 排最后（下拉框顺序 = 目录顺序）', () => {
    expect(new Set(AI_PROVIDER_IDS).size).toBe(AI_PROVIDER_IDS.length)
    expect(AI_PROVIDER_IDS[AI_PROVIDER_IDS.length - 1]).toBe('custom')
  })

  it('2026-11-01 新增的五家都在目录里', () => {
    for (const id of ['zhipu', 'xai', 'gemini', 'baidu', 'hunyuan'] as const) {
      expect(AI_PROVIDER_IDS).toContain(id)
      expect(isAiProviderId(id)).toBe(true)
    }
  })

  it('官方厂商的元数据完整：https 地址、至少一个常用模型、有拿 Key 的入口', () => {
    for (const id of AI_PROVIDER_IDS) {
      const meta = AI_PROVIDERS[id]
      expect(meta.id, id).toBe(id)
      expect(['openai', 'anthropic']).toContain(meta.format)
      if (id === 'custom') {
        expect(meta.baseUrl).toBe('')
        expect(meta.models).toEqual([])
        expect(meta.keyUrl).toBe('')
        continue
      }
      expect(meta.baseUrl, id).toMatch(/^https:\/\//)
      expect(meta.models.length, id).toBeGreaterThan(0)
      expect(meta.keyUrl, id).toMatch(/^https:\/\//)
      for (const model of meta.models) expect(model.trim(), `${id}:${model}`).not.toBe('')
    }
  })

  it('新五家的默认模型是 2026-11-01 现行可用档（需求原文里的档位已下线）', () => {
    // 这些不是需求原文的值：原文的 glm-4-plus / grok-beta / gemini-1.5-* /
    // ernie-4.0-8k / hunyuan-standard 在 2026-11 已经 404 或停服。
    // 钉在这里，防止以后有人「照需求改回去」。
    expect(defaultModelOf('zhipu')).toBe('glm-4.7-flash')
    expect(defaultModelOf('xai')).toBe('grok-4.3')
    expect(defaultModelOf('gemini')).toBe('gemini-2.5-flash')
    expect(defaultModelOf('baidu')).toBe('ernie-5.1')
    expect(defaultModelOf('hunyuan')).toBe('hy3')
  })

  it('混元走 TokenHub 的现役地址（旧平台 2026-09-30 已停服）', () => {
    expect(AI_PROVIDERS.hunyuan.baseUrl).toBe('https://tokenhub.tencentmaas.com/v1')
    expect(AI_PROVIDERS.hunyuan.models).toEqual(['hy3', 'hy4-preview'])
  })

  it('官方厂商永远用目录地址，custom 才看用户填的那一格', () => {
    expect(baseUrlOf('zhipu', 'https://evil.example.com')).toBe(
      'https://open.bigmodel.cn/api/paas/v4'
    )
    expect(baseUrlOf('gemini', 'https://evil.example.com')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/'
    )
    expect(baseUrlOf('custom', '  https://gw.example.com/v1  ')).toBe(
      'https://gw.example.com/v1'
    )
  })

  it('坏 id 退回 deepseek（与默认配置同一方向）', () => {
    expect(aiProviderOf('not-a-provider')).toBe(AI_PROVIDERS.deepseek)
    expect(isAiProviderId('not-a-provider')).toBe(false)
  })
})

describe('providerForBaseUrl：v20 老配置的地址识别', () => {
  it('五家官方的地址各自认对（含带路径/尾斜杠的写法）', () => {
    expect(providerForBaseUrl('https://open.bigmodel.cn/api/paas/v4')).toBe('zhipu')
    expect(providerForBaseUrl('https://api.x.ai/v1')).toBe('xai')
    expect(
      providerForBaseUrl('https://generativelanguage.googleapis.com/v1beta/openai/')
    ).toBe('gemini')
    expect(providerForBaseUrl('https://qianfan.baidubce.com/v2')).toBe('baidu')
    // 现役 TokenHub 的四个官方主机名
    expect(providerForBaseUrl('https://tokenhub.tencentmaas.com/v1')).toBe('hunyuan')
    expect(providerForBaseUrl('https://tokenhub.tencentmaas.cn/v1')).toBe('hunyuan')
    expect(providerForBaseUrl('https://tokenhub.tencentcloudmaas.com/v1')).toBe('hunyuan')
    expect(providerForBaseUrl('https://tokenhub-intl.tencentmaas.com/v1')).toBe('hunyuan')
    // 旧平台已经停服，但老配置认出来后会迁到现役地址，比往死地址发请求强
    expect(providerForBaseUrl('https://api.hunyuan.cloud.tencent.com/v1')).toBe('hunyuan')
  })

  it('伪装域 / 同公司的其它服务不认领 —— 认错会把 Key 发错地方', () => {
    expect(providerForBaseUrl('https://qianfan.baidubce.com.evil.example/v2')).toBe('custom')
    expect(providerForBaseUrl('https://api.hunyuan.cloud.tencent.com.evil.example/v1')).toBe(
      'custom'
    )
    expect(providerForBaseUrl('https://tokenhub.tencentmaas.com.evil.example/v1')).toBe('custom')
    expect(providerForBaseUrl('https://notbigmodel.cn/v4')).toBe('custom')
    expect(providerForBaseUrl('https://console.cloud.tencent.com/v1')).toBe('custom')
    expect(providerForBaseUrl('https://generativelanguage.googleapis.com.evil.example')).toBe(
      'custom'
    )
    expect(providerForBaseUrl('')).toBe('custom')
  })
})

describe('Key 形状识别：新增厂商不参与猜测', () => {
  it('这五家的 Key 没有足够独特的前缀，一律返回 null（保持当前选择）', () => {
    const keys = [
      'AIzaSyA1234567890abcdefghijklmnopqrstu', // Google API key 形状
      'bce-v3/ALTAK-abcdefghijklmnopqrstuvwxyz', // 百度千帆形状
      'xai-abcdefghijklmnopqrstuvwxyz', // xAI 风格
      '0123456789abcdef0123456789abcdef.ABCDEFGHIJKLMNOP', // 智谱 id.secret
      'sk-0123456789abcdef0123456789abcdef' // 含糊的 sk-，多家中招
    ]
    for (const key of keys) expect(detectAiProviderFromKey(key), key).toBeNull()
  })

  it('有把握的前缀仍然只认 Anthropic / OpenAI', () => {
    expect(detectAiProviderFromKey('sk-ant-api03-abcdefgh')).toBe('anthropic')
    expect(detectAiProviderFromKey('sk-proj-abcdefghijklmnop')).toBe('openai')
  })
})
