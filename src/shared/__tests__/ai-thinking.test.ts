/**
 * 思考强度域（v23）：推荐档、能力说明、请求参数翻译。
 *
 * 这些函数同时被设置页（显示什么）和请求层（真的发什么）使用，
 * 所以这里断言的不是「算出来好看」，而是**界面说的事等于请求做的事**：
 * 推荐档随模型变、关不掉的模型不许标成「关闭」、切换 chat/reasoner 只发生在
 * DeepSeek 的那两个确切 id 上。
 */
import { describe, expect, it } from 'vitest'
import {
  AI_THINKING_LEVELS,
  AI_THINKING_MAP_CAP,
  aiThinkingCapability,
  aiThinkingKey,
  aiThinkingOf,
  isAiThinking,
  planAiThinking,
  planNeedsReasoningHeadroom,
  planReasoningHeadroom,
  readAiThinking,
  recommendedAiThinking,
  resolveAiThinking,
  sanitizeAiThinkingMap
} from '../ai-thinking'

describe('基础校验与键', () => {
  it('只认四档字面量', () => {
    for (const level of AI_THINKING_LEVELS) expect(isAiThinking(level)).toBe(true)
    expect(isAiThinking('HIGH')).toBe(false)
    expect(isAiThinking('')).toBe(false)
    expect(isAiThinking(null)).toBe(false)
    expect(aiThinkingOf(undefined)).toBe('medium')
    expect(aiThinkingOf('garbage', 'low')).toBe('low')
  })

  it('记忆键带 mode + provider + model：同一个 id 在不同厂商/池里互不串', () => {
    expect(aiThinkingKey('api', 'deepseek', ' deepseek-chat ')).toBe('api:deepseek:deepseek-chat')
    expect(aiThinkingKey('pool', 'deepseek', 'deepseek-chat')).not.toBe(
      aiThinkingKey('api', 'deepseek', 'deepseek-chat')
    )
  })

  it('sanitize：丢掉空键、超长键和非法档位，合法项原样保留', () => {
    const out = sanitizeAiThinkingMap({
      'api:deepseek:deepseek-chat': 'high',
      '': 'low',
      ['k'.repeat(201)]: 'low',
      'api:openai:gpt-5': 'ultra',
      'api:qwen:qwen3-max': 'off'
    })
    expect(out).toEqual({
      'api:deepseek:deepseek-chat': 'high',
      'api:qwen:qwen3-max': 'off'
    })
    expect(sanitizeAiThinkingMap(null)).toEqual({})
    expect(sanitizeAiThinkingMap(['x'])).toEqual({})
  })
})

describe('readAiThinking（读路径，不写记忆表）', () => {
  it('显式档位优先于记忆与推荐', () => {
    const r = readAiThinking({
      mode: 'api',
      provider: 'deepseek',
      model: 'deepseek-chat',
      rawThinking: 'off',
      rawMap: { 'api:deepseek:deepseek-chat': 'high' }
    })
    expect(r.thinking).toBe('off')
    expect(r.thinkingByModel).toEqual({ 'api:deepseek:deepseek-chat': 'high' })
  })

  it('没有显式档位时用记忆值', () => {
    const r = readAiThinking({
      mode: 'api',
      provider: 'deepseek',
      model: 'deepseek-chat',
      rawThinking: undefined,
      rawMap: { 'api:deepseek:deepseek-chat': 'low' }
    })
    expect(r.thinking).toBe('low')
  })

  it('都没有时用模型推荐值，且**不往表里写**（读一次配置不该改用户文件）', () => {
    const rawMap = {}
    const r = readAiThinking({
      mode: 'api',
      provider: 'deepseek',
      model: 'deepseek-chat',
      rawThinking: undefined,
      rawMap
    })
    expect(r.thinking).toBe('medium')
    expect(r.thinkingByModel).toEqual({})
    expect(rawMap).toEqual({})
  })
})

describe('resolveAiThinking（写路径，记住当前选择）', () => {
  it('把当前路由的选择写进记忆表', () => {
    const r = resolveAiThinking({
      mode: 'api',
      provider: 'deepseek',
      model: 'deepseek-chat',
      rawThinking: 'high',
      rawMap: {}
    })
    expect(r.thinking).toBe('high')
    expect(r.thinkingByModel).toEqual({ 'api:deepseek:deepseek-chat': 'high' })
  })

  it('旧路由的记忆保留（切回来还在）', () => {
    const r = resolveAiThinking({
      mode: 'api',
      provider: 'openai',
      model: 'gpt-5',
      rawThinking: 'low',
      rawMap: { 'api:deepseek:deepseek-chat': 'high' }
    })
    expect(r.thinkingByModel).toEqual({
      'api:deepseek:deepseek-chat': 'high',
      'api:openai:gpt-5': 'low'
    })
  })

  it('表超过上限时淘汰最老的，且**当前键必须留下**', () => {
    const map: Record<string, 'low'> = {}
    for (let i = 0; i < AI_THINKING_MAP_CAP; i++) map[`api:deepseek:m${i}`] = 'low'
    const r = resolveAiThinking({
      mode: 'api',
      provider: 'deepseek',
      model: 'newest',
      rawThinking: 'high',
      rawMap: map
    })
    expect(Object.keys(r.thinkingByModel)).toHaveLength(AI_THINKING_MAP_CAP)
    expect(r.thinkingByModel['api:deepseek:newest']).toBe('high')
    expect(r.thinkingByModel['api:deepseek:m0']).toBeUndefined()
    expect(r.thinkingByModel['api:deepseek:m1']).toBe('low')
  })
})

describe('recommendedAiThinking', () => {
  it('推理模型→高；小模型→低；旗舰→中；免费池→中', () => {
    expect(recommendedAiThinking('api', 'openai', 'o1')).toBe('high')
    // 推理系里的小型号给中档：它本来就会想，再逼它长链是坏交易
    expect(recommendedAiThinking('api', 'openai', 'o3-mini')).toBe('medium')
    expect(recommendedAiThinking('api', 'openai', 'gpt-4o-mini')).toBe('low')
    expect(recommendedAiThinking('api', 'openai', 'gpt-4o')).toBe('medium')
    expect(recommendedAiThinking('api', 'anthropic', 'claude-opus-5-5')).toBe('high')
    expect(recommendedAiThinking('api', 'anthropic', 'claude-haiku-5-5')).toBe('low')
    expect(recommendedAiThinking('api', 'deepseek', 'deepseek-reasoner')).toBe('high')
    expect(recommendedAiThinking('api', 'deepseek', 'deepseek-v4-flash')).toBe('low')
    expect(recommendedAiThinking('api', 'deepseek', 'deepseek-v4-pro')).toBe('high')
    expect(recommendedAiThinking('api', 'qwen', 'qwen3-max')).toBe('high')
    expect(recommendedAiThinking('api', 'kimi', 'kimi-thinking')).toBe('high')
    expect(recommendedAiThinking('pool', 'deepseek', 'kilo-auto/free')).toBe('medium')
  })

  it('minimax 里的 max / mini 都不算档位词（词边界）', () => {
    expect(recommendedAiThinking('api', 'qwen', 'minimax-m2')).toBe('medium')
    expect(recommendedAiThinking('api', 'deepseek', 'minimax-m2')).toBe('medium')
    expect(recommendedAiThinking('api', 'openai', 'minimax-m2')).toBe('medium')
  })

  it('2026-11-01 新增五家：按型号词根推荐，不按厂商硬编码', () => {
    expect(recommendedAiThinking('api', 'zhipu', 'glm-4.7-flash')).toBe('low')
    expect(recommendedAiThinking('api', 'zhipu', 'glm-4.6')).toBe('medium')
    expect(recommendedAiThinking('api', 'zhipu', 'glm-4-plus')).toBe('medium')
    expect(recommendedAiThinking('api', 'xai', 'grok-4.3')).toBe('medium')
    expect(recommendedAiThinking('api', 'xai', 'grok-4.7')).toBe('medium')
    expect(recommendedAiThinking('api', 'gemini', 'gemini-2.5-flash')).toBe('low')
    expect(recommendedAiThinking('api', 'gemini', 'gemini-2.5-pro')).toBe('high')
    expect(recommendedAiThinking('api', 'gemini', 'gemini-3-thinking')).toBe('high')
    expect(recommendedAiThinking('api', 'baidu', 'ernie-5.1')).toBe('medium')
    expect(recommendedAiThinking('api', 'baidu', 'ernie-speed-8k')).toBe('low')
    expect(recommendedAiThinking('api', 'hunyuan', 'hy3')).toBe('medium')
    expect(recommendedAiThinking('api', 'hunyuan', 'hy4-preview')).toBe('medium')
    expect(recommendedAiThinking('api', 'hunyuan', 'hy-mt2-lite')).toBe('low')
  })
})

describe('aiThinkingCapability：界面能不能说「关掉了」', () => {
  it('免费池：网关选模型，只能靠提示词', () => {
    const c = aiThinkingCapability('pool', 'deepseek', 'kilo-auto/free')
    expect(c.note).toBe('pool')
    expect(c.wire).toBe(false)
    expect(c.canOff).toBe(false)
  })

  it('OpenAI 推理模型：能调 effort，但关不掉', () => {
    const c = aiThinkingCapability('api', 'openai', 'gpt-5')
    expect(c.note).toBe('min-only')
    expect(c.wire).toBe(true)
    expect(c.canOff).toBe(false)
  })

  it('OpenAI 普通模型：纯提示词', () => {
    const c = aiThinkingCapability('api', 'openai', 'gpt-4o')
    expect(c.note).toBe('prompt-only')
    expect(c.wire).toBe(false)
    expect(c.canOff).toBe(true)
  })

  it('DeepSeek 的两个确切 id 才能切模型', () => {
    expect(aiThinkingCapability('api', 'deepseek', 'deepseek-chat').note).toBe('model-switch')
    expect(aiThinkingCapability('api', 'deepseek', 'deepseek-reasoner').note).toBe('model-switch')
    // 未来的新 id 不猜：切模型规则写死在这两个 id 上，新 id 走提示词。
    expect(aiThinkingCapability('api', 'deepseek', 'deepseek-v4-pro').note).toBe('prompt-only')
  })

  it('Anthropic：默认就会思考，接口关不掉', () => {
    const c = aiThinkingCapability('api', 'anthropic', 'claude-sonnet-5-5')
    expect(c.note).toBe('always-on')
    expect(c.wire).toBe(false)
    expect(c.canOff).toBe(false)
  })

  it('Qwen：一律纯提示词（不赌第三方网关认不认 enable_thinking）', () => {
    const c = aiThinkingCapability('api', 'qwen', 'qwen3-max')
    expect(c.note).toBe('prompt-only')
    expect(c.wire).toBe(false)
    expect(c.canOff).toBe(true)
  })

  it('2026-11-01 新增五家：全部纯提示词，不往请求体塞没把握的字段', () => {
    for (const [provider, model] of [
      ['zhipu', 'glm-4.7-flash'],
      ['xai', 'grok-4.3'],
      ['gemini', 'gemini-2.5-flash'],
      ['baidu', 'ernie-5.1'],
      ['hunyuan', 'hy3']
    ] as const) {
      const c = aiThinkingCapability('api', provider, model)
      expect(c.note, provider).toBe('prompt-only')
      expect(c.wire, provider).toBe(false)
      expect(c.canOff, provider).toBe(true)
    }
  })
})

describe('planAiThinking：真的发出去的参数', () => {
  it('OpenAI 推理模型：off 退到 low（它关不掉）', () => {
    const plan = planAiThinking({ mode: 'api', provider: 'openai', model: 'gpt-5', level: 'off' })
    expect(plan.reasoningEffort).toBe('low')
    expect(plan.wire).toBe(true)
    expect(plan.model).toBe('gpt-5')
  })

  it('OpenAI 推理模型：low/medium/high 原样', () => {
    for (const level of ['low', 'medium', 'high'] as const) {
      expect(
        planAiThinking({ mode: 'api', provider: 'openai', model: 'gpt-5', level }).reasoningEffort
      ).toBe(level)
    }
  })

  it('OpenAI 普通模型、Anthropic、Qwen 与新增五家：请求体一个字都不改', () => {
    for (const [provider, model] of [
      ['openai', 'gpt-4o'],
      ['anthropic', 'claude-sonnet-5-5'],
      ['qwen', 'qwen3-max'],
      ['zhipu', 'glm-4.7-flash'],
      ['xai', 'grok-4.3'],
      ['gemini', 'gemini-2.5-flash'],
      ['baidu', 'ernie-5.1'],
      ['hunyuan', 'hy3']
    ] as const) {
      const plan = planAiThinking({ mode: 'api', provider, model, level: 'high' })
      expect(plan.wire, provider).toBe(false)
      expect(plan.model, provider).toBe(model)
      expect(plan.reasoningEffort, provider).toBeUndefined()
    }
  })

  it('DeepSeek：chat + 高 → reasoner；reasoner + 关闭/低 → chat', () => {
    expect(
      planAiThinking({ mode: 'api', provider: 'deepseek', model: 'deepseek-chat', level: 'high' })
    ).toMatchObject({ model: 'deepseek-reasoner', switched: true, wire: true })
    expect(
      planAiThinking({ mode: 'api', provider: 'deepseek', model: 'deepseek-chat', level: 'low' })
    ).toMatchObject({ model: 'deepseek-chat', switched: false, wire: false })
    expect(
      planAiThinking({
        mode: 'api',
        provider: 'deepseek',
        model: 'deepseek-reasoner',
        level: 'off'
      })
    ).toMatchObject({ model: 'deepseek-chat', switched: true, wire: true })
    expect(
      planAiThinking({
        mode: 'api',
        provider: 'deepseek',
        model: 'deepseek-reasoner',
        level: 'medium'
      })
    ).toMatchObject({ model: 'deepseek-reasoner', switched: false, wire: false })
  })

  it('免费池 / 自定义：不改模型、不加参数', () => {
    expect(
      planAiThinking({ mode: 'pool', provider: 'deepseek', model: 'deepseek-chat', level: 'high' })
    ).toMatchObject({ model: 'deepseek-chat', wire: false })
    expect(
      planAiThinking({
        mode: 'api',
        provider: 'custom',
        model: 'deepseek-chat',
        level: 'high'
      })
    ).toMatchObject({ model: 'deepseek-chat', wire: false })
  })
})

describe('planNeedsReasoningHeadroom', () => {
  it('真的会先花思考 token 的路由才加预算', () => {
    expect(
      planNeedsReasoningHeadroom('openai', {
        model: 'gpt-5',
        level: 'high',
        reasoningEffort: 'high',
        switched: false,
        wire: true
      })
    ).toBe(true)
    expect(
      planNeedsReasoningHeadroom('deepseek', {
        model: 'deepseek-reasoner',
        level: 'high',
        switched: true,
        wire: true
      })
    ).toBe(true)
    expect(
      planNeedsReasoningHeadroom('deepseek', {
        model: 'deepseek-chat',
        level: 'medium',
        switched: false,
        wire: false
      })
    ).toBe(false)
  })

  it('Gemini 2.5+ 默认先思考，要预留输出预算；1.5 不需要', () => {
    const plan = (model: string) =>
      planNeedsReasoningHeadroom('gemini', {
        model,
        level: 'high',
        switched: false,
        wire: false
      })
    expect(plan('gemini-2.5-pro')).toBe(true)
    expect(plan('gemini-2.5-flash')).toBe(true)
    expect(plan('gemini-3-pro')).toBe(true)
    expect(plan('gemini-1.5-pro')).toBe(false)
    expect(plan('gemini-1.5-flash')).toBe(false)
  })

  it('余量分两档：默认思考的新厂商给 8K，其余给 1K —— 出题 8192 会整批丢掉', () => {
    const plan = (model: string) => ({
      model,
      level: 'high' as const,
      switched: false,
      wire: false
    })
    // 默认思考、且输出上限远高于 16K 的新厂商
    expect(planReasoningHeadroom('gemini', plan('gemini-2.5-flash'))).toBe(8192)
    expect(planReasoningHeadroom('zhipu', plan('glm-4.7-flash'))).toBe(8192)
    expect(planReasoningHeadroom('zhipu', plan('glm-4.6'))).toBe(8192)
    expect(planReasoningHeadroom('hunyuan', plan('hy3'))).toBe(8192)
    expect(planReasoningHeadroom('hunyuan', plan('hy4-preview'))).toBe(8192)
    // 不思考的老世代：不占额度
    expect(planReasoningHeadroom('gemini', plan('gemini-1.5-flash'))).toBe(0)
    expect(planReasoningHeadroom('zhipu', plan('glm-4-plus'))).toBe(0)
    expect(planReasoningHeadroom('hunyuan', plan('hy-mt2-lite'))).toBe(0)
    expect(planReasoningHeadroom('baidu', plan('ernie-5.1'))).toBe(0)
    // 老规则仍然是 1K：DeepSeek reasoner / OpenAI 推理 / 自定义推理 id
    expect(planReasoningHeadroom('deepseek', plan('deepseek-reasoner'))).toBe(1024)
    expect(
      planReasoningHeadroom('openai', {
        model: 'o1',
        level: 'high',
        switched: false,
        wire: true,
        reasoningEffort: 'high'
      })
    ).toBe(1024)
    expect(planReasoningHeadroom('custom', plan('some-reasoner'))).toBe(1024)
  })

  it('自定义网关只有在模型名看着像推理模型时才加（不认识的 id 不乱猜）', () => {
    expect(
      planNeedsReasoningHeadroom('custom', {
        model: 'some-reasoner',
        level: 'high',
        switched: false,
        wire: false
      })
    ).toBe(true)
    expect(
      planNeedsReasoningHeadroom('custom', {
        model: 'plain-chat',
        level: 'high',
        switched: false,
        wire: false
      })
    ).toBe(false)
  })
})
