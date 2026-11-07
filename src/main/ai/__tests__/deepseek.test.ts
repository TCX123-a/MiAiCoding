/**
 * DeepSeek 网络层（src/main/ai/deepseek.ts）
 *
 * 【这个文件在守什么】
 * 守的是**「AI 出问题的时候，用户看到的是哪一句话」**。
 * 断网、Key 过期、余额用完、对方服务器抽风——这些全都不是「程序坏了」，
 * 而是使用 AI 的日常。docs/03 A7 明令「不得弹失败弹窗或阻塞操作」，
 * 所以每一种失败都必须**走到一个明确的原因码**，界面才好给出对应的下一步。
 *
 * 具体要守住三件事：
 *   1. **每种失败认得出自己的原因**。401 说成「断网了」，用户就会去检查路由器，
 *      查一晚上也查不出 Key 填错了。
 *   2. **一个异常都不许漏出去**。漏一个 = 上层白屏。
 *   3. **取消和超时要分得开**。用户自己点的取消，不该看到「超时了喵」。
 *
 * 一次都不真的联网：fetch 是注入的，这里塞的全是假货。
 */

import { describe, expect, it, vi } from 'vitest'
import {
  explainError,
  generateQuestions,
  testConnection,
  fetchBalance,
  listPoolModels,
  listProviderModels,
  effectiveAiModel,
  aiCacheModelOf,
  chatPet,
  AI_TIMEOUT_MS,
  QUESTIONS_TIMEOUT_MS,
  BALANCE_TIMEOUT_MS,
  TEMP_QUESTIONS,
  type AiDeps,
  type FetchLike,
  type HttpResponseLike
} from '../deepseek'
import { DEFAULT_APP_CONFIG, type AppConfig, type GlossaryTerm } from '../../../shared/types'
import { FREE_POOL_BASE, FREE_POOL_DEFAULT_MODEL } from '../../../shared/free-pool'
import { AI_PROMPT, AI_THINKING_PROMPT, PET_PROMPT } from '../../../shared/copy'

// ---------------------------------------------------------------- 假货

const TERMS: GlossaryTerm[] = [
  { key: 'loop', originals: ['循环'], cat: '绕鱼干跑圈', example: '循环就是让代码绕鱼干跑圈' }
]

/**
 * 测试夹具允许写 `apiKey` 这个便捷字段：多厂商之后真正的存储是
 * `apiKeys[provider]`，逐个用例写一整张表会把「测什么」淹掉。这里把它
 * 映射到**当前厂商**的槽位；`apiKeys` 显式给了就按显式值覆盖。
 */
type AiPatch = Partial<AppConfig['ai']> & { apiKey?: string }

function cfgWith(ai: AiPatch = {}): AppConfig {
  const { apiKey, ...rest } = ai
  const provider = rest.provider ?? DEFAULT_APP_CONFIG.ai.provider
  const merged = { ...DEFAULT_APP_CONFIG.ai, ...rest, provider }
  const keys: Record<string, string> = { ...merged.apiKeys, [provider]: 'sk-test' }
  if (apiKey !== undefined) keys[provider] = apiKey
  return {
    ...structuredClone(DEFAULT_APP_CONFIG),
    ai: { ...merged, apiKeys: keys as AppConfig['ai']['apiKeys'] }
  }
}

/** 一个正常的 OpenAI 兼容响应 */
function chatResponse(content: string): HttpResponseLike {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }))
  }
}

function errorResponse(status: number, message: string): HttpResponseLike {
  return { ok: false, status, text: () => Promise.resolve(JSON.stringify({ error: { message } })) }
}

/** 记录下每次请求，方便断言「发了什么出去」 */
function deps(
  fetchImpl: FetchLike,
  ai: AiPatch = {}
): AiDeps & { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = []
  return {
    calls,
    fetch: (url, init) => {
      calls.push({ url, init })
      return fetchImpl(url, init)
    },
    getConfig: () => cfgWith(ai)
  }
}

const okDeps = (content: string, ai: AiPatch = {}) =>
  deps(() => Promise.resolve(chatResponse(content)), ai)

/** 一次合法的出题响应 */
const GOOD_QUESTIONS = JSON.stringify({
  questions: [
    {
      topicIndex: 0,
      type: 'choice',
      stem: '绕鱼干跑圈（循环）会让代码怎么样？',
      options: ['重复做同一件事', '只做一次', '什么都不做', '报错'],
      answer: 0,
      explanation: '循环就是让代码绕鱼干跑圈，同一件事做好多遍喵。'
    }
  ]
})

/** 一次带 code 题的合法响应（沙盒复核用） */
const CODE_RESPONSE = JSON.stringify({
  questions: [
    {
      topicIndex: 0,
      type: 'code',
      lang: 'python',
      stem: '看看这段绕圈代码会打印什么？',
      code: 'print(1)',
      answer: '1',
      explanation: '它只打印一个 1。'
    }
  ]
})

const TOPIC = [{ lessonId: 'python-stage1-08', title: 'for 与 while', tags: ['循环'], stems: [] }]

const ask = (d: AiDeps) =>
  generateQuestions(d, { topics: TOPIC, count: 5, terms: TERMS, dateKey: '2026-09-13' })

// ---------------------------------------------------------------- 没配 Key

describe('没配 Key：不是错误，是功能没开', () => {
  it('apiKey 为空 → no-key，而且**一个请求都不发**', async () => {
    const d = deps(() => Promise.reject(new Error('不该走到这里')), { apiKey: '' })
    const r = await ask(d)
    expect(r).toEqual({ ok: false, reason: 'no-key' })
    expect(d.calls).toHaveLength(0)
  })

  it('apiKey 只有空白也算没配', async () => {
    const d = deps(() => Promise.reject(new Error('不该走到这里')), { apiKey: '   ' })
    expect((await ask(d)).ok).toBe(false)
    expect(d.calls).toHaveLength(0)
  })

  it('三个功能都认这条', async () => {
    const d = deps(() => Promise.reject(new Error('不该走到这里')), { apiKey: '' })
    expect((await testConnection(d)).ok).toBe(false)
    expect((await explainError(d, { lang: 'python', code: 'x', error: 'e', terms: TERMS })).ok).toBe(false)
    expect(d.calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------- 失败分支

describe('每种失败认得出自己的原因', () => {
  const cases: [number, string, string][] = [
    [401, 'Authentication Fails', 'unauthorized'],
    [403, 'Forbidden', 'unauthorized'],
    [402, 'Insufficient Balance', 'quota'],
    [429, 'Rate Limit Reached', 'quota'],
    [500, 'Internal Server Error', 'server'],
    [503, 'Server Overloaded', 'server'],
    [422, 'Invalid Parameters', 'bad-response'],
    [418, "I'm a teapot", 'bad-response']
  ]

  it.each(cases)('HTTP %i → %s', async (status, message, reason) => {
    const r = await ask(deps(() => Promise.resolve(errorResponse(status, message))))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toBe(reason)
  })

  it('**401 和 402 必须分开** —— 一个要改 Key，一个要充值', async () => {
    const a = await ask(deps(() => Promise.resolve(errorResponse(401, 'bad key'))))
    const b = await ask(deps(() => Promise.resolve(errorResponse(402, 'no money'))))
    expect(!a.ok && a.reason).toBe('unauthorized')
    expect(!b.ok && b.reason).toBe('quota')
  })

  it('报错信息里带上状态码和接口原话，好排查', async () => {
    const r = await ask(deps(() => Promise.resolve(errorResponse(401, 'Authentication Fails'))))
    expect(!r.ok && r.detail).toContain('401')
    expect(!r.ok && r.detail).toContain('Authentication Fails')
  })

  it('接口没给 message 也不崩', async () => {
    const r = await ask(deps(() => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('oops') })))
    expect(!r.ok && r.reason).toBe('server')
    expect(!r.ok && r.detail).toBe('HTTP 500')
  })

  it('连不上（断网 / DNS 失败）→ offline，不抛异常', async () => {
    const r = await ask(deps(() => Promise.reject(new TypeError('fetch failed'))))
    expect(!r.ok && r.reason).toBe('offline')
    expect(!r.ok && r.detail).toContain('fetch failed')
  })

  it('**抛出来的东西不是 Error 也不会漏出去**', async () => {
    // 真实世界见过：某些代理库直接 reject 一个字符串
    const r = await ask(deps(() => Promise.reject('炸了')))
    expect(!r.ok && r.reason).toBe('offline')
  })
})

// ---------------------------------------------------------------- 坏响应

describe('回来了但形状不对', () => {
  const bad: [string, string][] = [
    ['正文不是 JSON', '这不是 json'],
    ['没有 choices', JSON.stringify({ id: 'x' })],
    ['choices 是空数组', JSON.stringify({ choices: [] })],
    ['没有 message', JSON.stringify({ choices: [{ finish_reason: 'stop' }] })],
    ['content 不是字符串', JSON.stringify({ choices: [{ message: { content: 42 } }] })]
  ]

  it.each(bad)('%s → bad-response', async (_name, body) => {
    const r = await ask(okDeps(body))
    expect(!r.ok && r.reason).toBe('bad-response')
  })

  it('**内容是空的也算失败** —— 官方文档承认会偶发', async () => {
    // 当成「AI 说今天不出题」的话，用户看到的就是「挑战没有题目」而不知道为什么；
    // 当成失败，上层才能回退到本地题库
    const r = await ask(okDeps(''))
    expect(!r.ok && r.reason).toBe('bad-response')
    expect(!r.ok && r.detail).toBe('empty content')
  })

  it('内容只有空白同样算失败', async () => {
    expect((await ask(okDeps('   \n  '))).ok).toBe(false)
  })
})

// ---------------------------------------------------------------- 超时与取消

describe('超时和取消要分得开', () => {
  it('聊天 30 秒没回话 → timeout', async () => {
    vi.useFakeTimers()
    try {
      // 一个永不 resolve 的 fetch，但会响应 abort
      const d = deps(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const e = new Error('aborted')
              e.name = 'AbortError'
              reject(e)
            })
          })
      )
      const p = explainError(d, { lang: 'python', code: 'x', error: 'e', terms: TERMS })
      await vi.advanceTimersByTimeAsync(AI_TIMEOUT_MS + 10)
      const r = await p
      expect(!r.ok && r.reason).toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('**出题**按长超时走：30 秒不到期，180 秒才掐', async () => {
    vi.useFakeTimers()
    try {
      const d = deps(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const e = new Error('aborted')
              e.name = 'AbortError'
              reject(e)
            })
          })
      )
      let settled = false
      const p = ask(d).then((r) => {
        settled = true
        return r
      })
      // 聊天超时点已经过了，出题请求必须还活着 —— 20 道 JSON 的真实耗时
      // 远不止 30 秒，这里短了就等于「AI 出题永远静默回退本地题库」
      await vi.advanceTimersByTimeAsync(AI_TIMEOUT_MS + 10)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(QUESTIONS_TIMEOUT_MS - AI_TIMEOUT_MS + 10)
      const r = await p
      expect(!r.ok && r.reason).toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('用户自己点取消 → canceled（不是 timeout）', async () => {
    const ac = new AbortController()
    const d: AiDeps = {
      ...deps(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const e = new Error('aborted')
              e.name = 'AbortError'
              reject(e)
            })
          })
      ),
      signal: ac.signal
    }
    const p = ask(d)
    ac.abort()
    const r = await p
    // 说成「超时了喵」的话，用户会去等 30 秒，其实是他自己刚点的取消
    expect(!r.ok && r.reason).toBe('canceled')
  })

  it('**开跑之前就被取消了**：一个请求都不发', async () => {
    const ac = new AbortController()
    ac.abort()
    const d = { ...okDeps(GOOD_QUESTIONS), signal: ac.signal }
    const r = await ask(d)
    expect(!r.ok && r.reason).toBe('canceled')
    expect(d.calls).toHaveLength(0)
  })

  it('正常返回之后，超时定时器要被清掉（否则会挂住进程）', async () => {
    vi.useFakeTimers()
    try {
      const d = okDeps(GOOD_QUESTIONS)
      expect((await ask(d)).ok).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('取消之后不再监听外部信号（不留悬挂的监听器）', async () => {
    const ac = new AbortController()
    const d: AiDeps = { ...okDeps(GOOD_QUESTIONS), signal: ac.signal }
    await ask(d)
    expect(ac.signal.aborted).toBe(false)
  })
})

// ---------------------------------------------------------------- 请求内容

describe('发出去的请求长什么样', () => {
  it('官方厂商**只用目录里的地址**：存档里残留的任何 baseUrl 都不得把 Key 送去别处', async () => {
    const d = okDeps(GOOD_QUESTIONS, { provider: 'deepseek', baseUrl: 'https://evil.example.com/' })
    await ask(d)
    expect(d.calls[0].url).toBe('https://api.deepseek.com/chat/completions')
  })

  it('自定义服务填了 /v1 也照样能用（OpenAI 兼容写法）', async () => {
    const d = okDeps(GOOD_QUESTIONS, { provider: 'custom', baseUrl: 'https://api.deepseek.com/v1' })
    await ask(d)
    expect(d.calls[0].url).toBe('https://api.deepseek.com/v1/chat/completions')
  })

  it('自定义服务地址可用 —— 第三方中转/自建网关不是官方域名也行，尾斜杠不拼双斜杠', async () => {
    const d = okDeps(GOOD_QUESTIONS, { provider: 'custom', baseUrl: 'https://api.example.com/v1/' })
    await ask(d)
    expect(d.calls[0].url).toBe('https://api.example.com/v1/chat/completions')
  })

  it('用户直接粘了一整条 chat/completions 端点 → 原样使用，不再叠一层', async () => {
    const d = okDeps(GOOD_QUESTIONS, {
      provider: 'custom',
      baseUrl: 'https://gateway.example.com/v1/chat/completions'
    })
    await ask(d)
    expect(d.calls[0].url).toBe('https://gateway.example.com/v1/chat/completions')
  })

  it('Key 放在 Authorization 头里，且是 Bearer 前缀', async () => {
    const d = okDeps(GOOD_QUESTIONS, { apiKey: 'sk-abc123' })
    await ask(d)
    const headers = d.calls[0].init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer sk-abc123')
  })

  it('**出题开 JSON 模式**（比求它输出 JSON 再抠文本稳得多）', async () => {
    const d = okDeps(GOOD_QUESTIONS)
    await ask(d)
    const body = JSON.parse(String(d.calls[0].init.body))
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('temperature 用约定的那个值，不是随手写的', async () => {
    const d = okDeps(GOOD_QUESTIONS)
    await ask(d)
    expect(JSON.parse(String(d.calls[0].init.body)).temperature).toBe(TEMP_QUESTIONS)
  })

  it('**带上了费用上限，且是 8192**（20 道题在 2048 下会被截断）', async () => {
    // 2026-10-21 真机复现：2048 时 finish_reason=length，JSON 从中间断掉，
    // 20 道题一道都收不下 → 界面静默回退本地题库。8192 能完整返回。
    // 这里钉死具体数字，防止有人"优化"回 2048。
    const d = okDeps(GOOD_QUESTIONS)
    await ask(d)
    const body = JSON.parse(String(d.calls[0].init.body))
    expect(body.max_tokens).toBe(8192)
    expect(body.stream).toBe(false)
  })

  it('**日期进了 user 段** —— 同一天复用、跨天换题', async () => {
    const a = okDeps(GOOD_QUESTIONS)
    await ask(a)
    const bodyA = JSON.parse(String(a.calls[0].init.body))
    expect(bodyA.messages[1].content).toContain('2026-09-13')

    const b = okDeps(GOOD_QUESTIONS)
    await generateQuestions(b, {
      topics: TOPIC,
      count: 5,
      terms: TERMS,
      dateKey: '2026-09-14'
    })
    const bodyB = JSON.parse(String(b.calls[0].init.body))
    expect(bodyB.messages[1].content).not.toBe(bodyA.messages[1].content)
    expect(bodyB.messages[0].content).toBe(bodyA.messages[0].content)
  })

  it('system 和 user 两段都发出去了，system 里有术语表', async () => {
    const d = okDeps(GOOD_QUESTIONS)
    await ask(d)
    const body = JSON.parse(String(d.calls[0].init.body))
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toContain('小鱼干仓库') // 术语表真的在里面
    expect(body.messages[1].role).toBe('user')
    expect(body.messages[1].content).toContain('python-stage1-08')
  })

  it('讲报错用同样的套路，但**不开 JSON 模式**（要的是人话）', async () => {
    const d = okDeps('这个错是因为……')
    const r = await explainError(d, { lang: 'python', code: 'for i in range(3)', error: 'NameError', terms: TERMS })
    expect(r.ok).toBe(true)
    const body = JSON.parse(String(d.calls[0].init.body))
    expect(body.response_format).toBeUndefined()
    expect(body.messages[0].content).toContain('小鱼干仓库')
  })
})

// ---------------------------------------------------------------- 余额查询（V1-30）

/**
 * 菜单「查看余额」背后那一次读数（GET /user/balance）。它不花 token，但
 * 仍是**联网**动作：失败要落到与聊天同一套原因码（host 再翻成三档 reason
 * 和一句人话小字），不许编数字、不许把异常漏给上层。
 */
describe('fetchBalance：菜单「查看余额」走的那一次读数', () => {
  const okRes = (raw: string): HttpResponseLike => ({ ok: true, status: 200, text: () => Promise.resolve(raw) })
  const balanceDeps = (res: HttpResponseLike, ai: Partial<AppConfig['ai']> = {}) =>
    deps(() => Promise.resolve(res), ai)

  const MULTI = JSON.stringify({
    is_available: true,
    balance_infos: [
      { currency: 'USD', total_balance: '12.34', granted_balance: '0.00', topped_up_balance: '12.34' },
      { currency: 'CNY', total_balance: '88.88', granted_balance: '5.00', topped_up_balance: '83.88' }
    ]
  })

  it('成功：挑出四元组且**优先 CNY**（气泡里的 ¥ 是写死的，拿 USD 当 ¥ 就是报错账）', async () => {
    const r = await fetchBalance(balanceDeps(okRes(MULTI)))
    expect(r).toEqual({
      ok: true,
      data: { provider: 'deepseek', currency: 'CNY', total: '88.88', granted: '5.00', toppedUp: '83.88' }
    })
  })

  it('没有 CNY 才退回第一条（四元组字节原样，绝不自己算"还剩几成"）', async () => {
    const onlyUsd = JSON.stringify({
      balance_infos: [{ currency: 'USD', total_balance: '12.34', granted_balance: '0', topped_up_balance: '12.34' }]
    })
    const r = await fetchBalance(balanceDeps(okRes(onlyUsd)))
    expect(r).toEqual({
      ok: true,
      data: { provider: 'deepseek', currency: 'USD', total: '12.34', granted: '0', toppedUp: '12.34' }
    })
  })

  it('URL 是 baseUrl + /user/balance，GET，且官方厂商**不吃存档里的用户地址**', async () => {
    const d = balanceDeps(okRes(MULTI), { baseUrl: 'https://api.deepseek.com/' })
    await fetchBalance(d)
    expect(d.calls[0].url).toBe('https://api.deepseek.com/user/balance')
    expect(d.calls[0].init.method).toBe('GET')

    const hostile = balanceDeps(okRes(MULTI), { baseUrl: 'https://evil.example.com/v1/' })
    await fetchBalance(hostile)
    expect(hostile.calls[0].url).toBe('https://api.deepseek.com/user/balance')
  })

  it('没配 Key → no-key，一个请求都不发', async () => {
    const d = deps(() => Promise.reject(new Error('不该走到这里')), { apiKey: '' })
    expect(await fetchBalance(d)).toEqual({ ok: false, reason: 'no-key' })
    expect(d.calls).toHaveLength(0)
  })

  it('开跑之前就被取消 → canceled，一个请求都不发（与聊天同款）', async () => {
    const ac = new AbortController()
    ac.abort()
    const d = { ...balanceDeps(okRes(MULTI)), signal: ac.signal }
    const r = await fetchBalance(d)
    expect(!r.ok && r.reason).toBe('canceled')
    expect(d.calls).toHaveLength(0)
  })

  it('状态码分档与聊天逐条同款：401/403→unauthorized、402/429→quota、5xx→server、其余→bad-response', async () => {
    const cases: [number, string][] = [
      [401, 'unauthorized'],
      [403, 'unauthorized'],
      [402, 'quota'],
      [429, 'quota'],
      [500, 'server'],
      [503, 'server'],
      [418, 'bad-response']
    ]
    for (const [status, reason] of cases) {
      const r = await fetchBalance(balanceDeps(errorResponse(status, 'nope')))
      expect(!r.ok && r.reason, `status ${status}`).toBe(reason)
    }
  })

  it('形状不对（非 JSON / 缺 balance_infos / 空列表 / 缺 total_balance）→ bad-response，绝不编一个 0.00', async () => {
    const bads = [
      'not json at all',
      '{}',
      JSON.stringify({ balance_infos: [] }),
      JSON.stringify({ balance_infos: [{ currency: 'CNY' }] })
    ]
    for (const raw of bads) {
      const r = await fetchBalance(balanceDeps(okRes(raw)))
      expect(!r.ok && r.reason, raw).toBe('bad-response')
    }
  })

  it('网络异常 → offline（一个异常都不许漏出去）', async () => {
    const d = deps(() => Promise.reject(new TypeError('fetch failed')))
    const r = await fetchBalance(d)
    expect(!r.ok && r.reason).toBe('offline')
  })

  it('10 秒没回话 → timeout（比聊天的 30 秒短：这是读数，不是"AI 在想"）', async () => {
    vi.useFakeTimers()
    try {
      const d = deps(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const e = new Error('aborted')
              e.name = 'AbortError'
              reject(e)
            })
          })
      )
      const p = fetchBalance(d)
      await vi.advanceTimersByTimeAsync(BALANCE_TIMEOUT_MS + 10)
      const r = await p
      expect(!r.ok && r.reason).toBe('timeout')
      // 与聊天不同档的证据：到 AI_TIMEOUT_MS（30s）之前就该结束了——上面等的是 10s+10ms，
      // 若误用聊天档位，这里会挂在 pending（advance 只推进了 10s）
      expect(BALANCE_TIMEOUT_MS).toBeLessThan(AI_TIMEOUT_MS)
    } finally {
      vi.useRealTimers()
    }
  })

  it('正常返回后超时定时器被清掉（否则会挂住进程）', async () => {
    vi.useFakeTimers()
    try {
      expect((await fetchBalance(balanceDeps(okRes(MULTI)))).ok).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

// ---------------------------------------------------------------- 多厂商方言

describe('多厂商：每种方言发出去的请求长什么样', () => {
  const ok = (raw: string): HttpResponseLike => ({
    ok: true,
    status: 200,
    text: () => Promise.resolve(raw)
  })

  it('Anthropic：/messages 端点、x-api-key + 版本头、绝不带 Authorization', async () => {
    const d = okDeps('喵', {
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      baseUrl: 'https://evil.example.com'
    })
    await testConnection(d)
    expect(d.calls[0].url).toBe('https://api.anthropic.com/v1/messages')
    const headers = d.calls[0].init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-test')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['Authorization']).toBeUndefined()
  })

  it('Anthropic：system 搬到顶层，messages 里不许出现 system；**不发 temperature**', async () => {
    // 2026-10-21 起现行模型收到 temperature 一律 400（连夹到 0~1 也过不去），
    // 所以这个字段必须根本不出现 —— 用「选了它会失败」的负面断言钉住。
    const d = okDeps('喵', { provider: 'anthropic', model: 'claude-haiku-5-5' })
    await ask(d)
    const body = JSON.parse(String(d.calls[0].init.body))
    expect(typeof body.system).toBe('string')
    expect(body.system.length).toBeGreaterThan(0)
    expect(
      (body.messages as { role: string }[]).every((m) => m.role !== 'system')
    ).toBe(true)
    expect(body.temperature).toBeUndefined()
    expect(body.max_tokens).toBe(8192)
    // 该厂商没有 JSON 模式：不许多发一个它不认的字段
    expect(body.response_format).toBeUndefined()
  })

  it('OpenAI 推理模型：max_completion_tokens、无 temperature、system→developer、无 response_format', async () => {
    const d = okDeps('{}', { provider: 'openai', model: 'o1' })
    await ask(d)
    expect(d.calls[0].url).toBe('https://api.openai.com/v1/chat/completions')
    const body = JSON.parse(String(d.calls[0].init.body))
    expect(body.max_completion_tokens).toBe(8192)
    expect(body.max_tokens).toBeUndefined()
    expect(body.temperature).toBeUndefined()
    expect(body.response_format).toBeUndefined()
    expect(body.messages[0].role).toBe('developer')
  })

  it('普通 OpenAI 模型照旧走 max_tokens + temperature + json 模式', async () => {
    const d = okDeps('{}', { provider: 'openai', model: 'gpt-4o' })
    await ask(d)
    const body = JSON.parse(String(d.calls[0].init.body))
    expect(body.max_tokens).toBe(8192)
    expect(body.temperature).toBe(TEMP_QUESTIONS)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0].role).toBe('system')
  })

  it('DeepSeek reasoner：保留 max_tokens / system，但不发 temperature 和 response_format', async () => {
    const d = okDeps('{}', { provider: 'deepseek', model: 'deepseek-reasoner' })
    await ask(d)
    const body = JSON.parse(String(d.calls[0].init.body))
    expect(body.max_tokens).toBe(8192)
    expect(body.temperature).toBeUndefined()
    expect(body.response_format).toBeUndefined()
    expect(body.messages[0].role).toBe('system')
  })

  it('Gemini：请求体里根本没有 temperature（3.x 会对显式值回 400），出题留足思考额度', async () => {
    const d = okDeps('喵', { provider: 'gemini', model: 'gemini-2.5-flash' })
    await ask(d)
    const body = JSON.parse(String(d.calls[0].init.body))
    expect(body.temperature).toBeUndefined()
    // 8192 出题 + 8192 思考余量；只有 8192 时 20 道题的 JSON 会被思考截断
    expect(body.max_tokens).toBe(16384)
  })

  it('智谱：温度夹进 (0,1) 开区间；测试用 0、出题/桌宠的 1.0+/1.3 都不会越界 400', async () => {
    const ping = okDeps('喵', { provider: 'zhipu', model: 'glm-4.7-flash' })
    await testConnection(ping)
    expect(JSON.parse(String(ping.calls[0].init.body)).temperature).toBe(0.01)

    const q = okDeps('{}', { provider: 'zhipu', model: 'glm-4.7-flash' })
    await ask(q)
    expect(JSON.parse(String(q.calls[0].init.body)).temperature).toBe(0.99)

    const pet = okDeps('喵', { provider: 'zhipu', model: 'glm-4.7-flash' })
    await chatPet(pet, { messages: [{ role: 'user', content: '在吗' }] })
    expect(JSON.parse(String(pet.calls[0].init.body)).temperature).toBe(0.99)
  })

  it('智谱老 GLM-4 的输出上限：glm-4-plus 8192 → 4095，别让老模型一出题就 400', async () => {
    const plus = okDeps('{}', { provider: 'zhipu', model: 'glm-4-plus' })
    await ask(plus)
    expect(JSON.parse(String(plus.calls[0].init.body)).max_tokens).toBe(4095)

    // 带日期的 flash 是 32768 档，不该被 4095 规则误伤
    const flash = okDeps('{}', { provider: 'zhipu', model: 'glm-4-flash-250414' })
    await ask(flash)
    expect(JSON.parse(String(flash.calls[0].init.body)).max_tokens).toBe(8192)

    // 新世代（默认档）不夹：8192 出题 + 8192 思考余量
    const modern = okDeps('{}', { provider: 'zhipu', model: 'glm-4.7-flash' })
    await ask(modern)
    expect(JSON.parse(String(modern.calls[0].init.body)).max_tokens).toBe(16384)
  })

  it('xAI：走 max_completion_tokens（max_tokens 已是 deprecated），且不吃思考余量', async () => {
    const d = okDeps('{}', { provider: 'xai', model: 'grok-4.7' })
    await ask(d)
    const body = JSON.parse(String(d.calls[0].init.body))
    expect(body.max_completion_tokens).toBe(8192)
    expect(body.max_tokens).toBeUndefined()
    expect(body.temperature).toBe(TEMP_QUESTIONS)

    const ping = okDeps('喵', { provider: 'xai', model: 'grok-4.7' })
    await testConnection(ping)
    const pingBody = JSON.parse(String(ping.calls[0].init.body))
    expect(pingBody.max_completion_tokens).toBe(8)
    expect(pingBody.max_tokens).toBeUndefined()
  })

  it('腾讯混元 Hy3：思考与正文共用额度，出题要 8192 + 8192', async () => {
    const d = okDeps('{}', { provider: 'hunyuan', model: 'hy3' })
    await ask(d)
    const body = JSON.parse(String(d.calls[0].init.body))
    expect(body.max_tokens).toBe(16384)
    expect(body.max_completion_tokens).toBeUndefined()
    expect(body.temperature).toBe(TEMP_QUESTIONS)
  })

  it('百度千帆：不发 xAI 专属字段，max_tokens 原样', async () => {
    const d = okDeps('{}', { provider: 'baidu', model: 'ernie-5.1' })
    await ask(d)
    const body = JSON.parse(String(d.calls[0].init.body))
    expect(body.max_tokens).toBe(8192)
    expect(body.max_completion_tokens).toBeUndefined()
    expect(body.temperature).toBe(TEMP_QUESTIONS)
  })

  it('Kimi 余额：/v1/users/me/balance，金额按字符串两位小数收下', async () => {
    const d = deps(
      () =>
        Promise.resolve(
          ok(
            JSON.stringify({
              code: 0,
              status: true,
              data: { available_balance: 12.5, voucher_balance: '2', cash_balance: 10.5 }
            })
          )
        ),
      { provider: 'kimi', model: 'kimi-latest' }
    )
    const r = await fetchBalance(d)
    expect(d.calls[0].url).toBe('https://api.moonshot.cn/v1/users/me/balance')
    expect(r).toEqual({
      ok: true,
      data: {
        provider: 'kimi',
        currency: 'CNY',
        total: '12.50',
        granted: '2.00',
        toppedUp: '10.50'
      }
    })
  })

  it('Kimi 明确报失败（status:false / code≠0）时不许读成 ¥0.00', async () => {
    for (const raw of [
      { status: false, data: { available_balance: 0, voucher_balance: 0, cash_balance: 0 } },
      { code: 401, data: { available_balance: 0 } }
    ]) {
      const r = await fetchBalance(
        deps(() => Promise.resolve(ok(JSON.stringify(raw))), { provider: 'kimi' })
      )
      expect(!r.ok && r.reason).toBe('bad-response')
    }
  })

  it('没有余额接口的厂商 → unsupported，而且一个请求都不发（聊天/出题照常）', async () => {
    for (const provider of ['openai', 'anthropic', 'qwen', 'custom'] as const) {
      const d = deps(() => Promise.reject(new Error('不该走到这里')), { provider })
      expect(await fetchBalance(d)).toEqual({ ok: false, reason: 'unsupported' })
      expect(d.calls, provider).toHaveLength(0)
    }
  })
})

// ---------------------------------------------------------------- 出题结果收口

describe('generateQuestions：交给校验器之后', () => {
  it('好数据原样收下，并且带上宿主课', async () => {
    const r = await ask(okDeps(GOOD_QUESTIONS))
    expect(r.ok).toBe(true)
    expect(r.ok && r.data.items).toHaveLength(1)
    expect(r.ok && r.data.items[0].lessonId).toBe('python-stage1-08')
    expect(r.ok && r.data.items[0].question.id).toBe('ai-2026-09-13-1')
  })

  it('**全被校验器丢掉时返回 bad-response**，不是「成功了但是空的」', async () => {
    // 前者该回退本地题库，后者会让用户以为「AI 今天不想出题」
    const r = await ask(
      okDeps(JSON.stringify({ questions: [{ topicIndex: 0, type: 'essay', stem: '写一篇作文' }] }))
    )
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toBe('bad-response')
    expect(!r.ok && r.detail).toContain('bad-type')
  })

  it('坏的那道丢掉、好的留下：**不算失败**', async () => {
    const mixed = JSON.stringify({
      questions: [
        JSON.parse(GOOD_QUESTIONS).questions[0],
        { topicIndex: 0, type: 'essay', stem: '写一篇作文' }
      ]
    })
    const r = await ask(okDeps(mixed))
    expect(r.ok).toBe(true)
    expect(r.ok && r.data.items).toHaveLength(1)
    expect(r.ok && r.data.dropped).toBe(1)
  })

  it('接口把 JSON 裹在 markdown 围栏里也能救回来（实测会发生）', async () => {
    const wrapped = '```json\n' + GOOD_QUESTIONS + '\n```'
    const r = await ask(okDeps(wrapped))
    expect(r.ok).toBe(true)
  })

  it('围栏里装的还是烂东西 → 照旧 bad-response', async () => {
    const r = await ask(okDeps('```json\n{ 这不是 json\n```'))
    expect(!r.ok && r.reason).toBe('bad-response')
  })

  it('**和完整旧题干撞车就丢**（提示词只给 3 道样例，靠这里兜底）', async () => {
    const topic = [{ ...TOPIC[0], stems: ['看看这段绕圈代码会打印什么？'] }]
    const r = await generateQuestions(okDeps(CODE_RESPONSE), {
      topics: topic,
      count: 5,
      terms: TERMS,
      dateKey: '2026-09-13'
    })
    expect(!r.ok && r.reason).toBe('bad-response')
    expect(!r.ok && r.detail).toContain('duplicate-existing-stem')
  })

  it('**code 题没注入沙盒复核 → 一律丢掉**（宁可少一道，也不能没验就端出去）', async () => {
    const r = await ask(okDeps(CODE_RESPONSE))
    expect(!r.ok && r.reason).toBe('bad-response')
    expect(!r.ok && r.detail).toContain('code-not-verified')
  })

  it('code 题复核通过才留下，复核函数真的拿到了那道题', async () => {
    const seen: string[] = []
    const d = okDeps(CODE_RESPONSE)
    const r = await generateQuestions(
      { ...d, verifyCode: (item) => { seen.push(item.question.stem); return Promise.resolve(true) } },
      { topics: TOPIC, count: 5, terms: TERMS, dateKey: '2026-09-13' }
    )
    expect(r.ok).toBe(true)
    expect(r.ok && r.data.items).toHaveLength(1)
    expect(seen).toEqual(['看看这段绕圈代码会打印什么？'])
  })

  it('code 题复核不通过 → 丢掉；抛异常也按不通过算', async () => {
    const d = okDeps(CODE_RESPONSE)
    const r = await generateQuestions(
      { ...d, verifyCode: () => Promise.reject(new Error('sandbox boom')) },
      { topics: TOPIC, count: 5, terms: TERMS, dateKey: '2026-09-13' }
    )
    expect(!r.ok && r.reason).toBe('bad-response')
    expect(!r.ok && r.detail).toContain('code-not-verified')
  })

  it('choice 题不过沙盒 —— 复核函数一次都不该被调用', async () => {
    let called = false
    const r = await generateQuestions(
      {
        ...okDeps(GOOD_QUESTIONS),
        verifyCode: () => {
          called = true
          return Promise.resolve(false)
        }
      },
      { topics: TOPIC, count: 5, terms: TERMS, dateKey: '2026-09-13' }
    )
    expect(r.ok).toBe(true)
    expect(called).toBe(false)
  })
})

// ---------------------------------------------------------------- 测试连接

describe('testConnection', () => {
  it('成功时回报用了哪个模型和哪家厂商（设置页要显示出来）', async () => {
    const r = await testConnection(okDeps('喵', { model: 'deepseek-chat' }))
    // mode 是 v22 双模式加上的：设置页要按它决定「余额那一行显不显示」，
    // 所以回报里必须带上当前走的是专属 API 还是免费公开池。
    expect(r).toEqual({
      ok: true,
      data: { model: 'deepseek-chat', provider: 'deepseek', mode: 'api' }
    })
  })

  it('Key 不对时如实说 unauthorized', async () => {
    const r = await testConnection(deps(() => Promise.resolve(errorResponse(401, 'Authentication Fails'))))
    expect(!r.ok && r.reason).toBe('unauthorized')
  })

  it('**温度用 0** —— 测试连接不该有任何创造性', async () => {
    const d = okDeps('喵')
    await testConnection(d)
    expect(JSON.parse(String(d.calls[0].init.body)).temperature).toBe(0)
  })

  it('不带 response_format（不是所有模型都支持，测连接要挑最普通的请求）', async () => {
    const d = okDeps('喵')
    await testConnection(d)
    expect(JSON.parse(String(d.calls[0].init.body)).response_format).toBeUndefined()
  })
})

// ---------------------------------------------------------------- 配置是现读的

describe('配置每次现读', () => {
  it('**调用之间改了 Key 立刻生效**，不用重启应用', async () => {
    // 用户在设置页填完 Key 点「测试连接」，如果配置是启动时读一次的，
    // 他会一直看到「Key 不对」，然后以为是自己填错了
    let key = 'sk-old'
    const sent: string[] = []
    const d: AiDeps = {
      fetch: (_url, init) => {
        sent.push((init.headers as Record<string, string>)['Authorization'])
        return Promise.resolve(chatResponse('喵'))
      },
      getConfig: () => cfgWith({ apiKey: key })
    }
    await testConnection(d)
    key = 'sk-new'
    await testConnection(d)
    expect(sent).toEqual(['Bearer sk-old', 'Bearer sk-new'])
  })

  it('调用之间改了模型名也立刻生效', async () => {
    let model = 'deepseek-chat'
    const sent: string[] = []
    const d: AiDeps = {
      fetch: (_url, init) => {
        sent.push(JSON.parse(String(init.body)).model)
        return Promise.resolve(chatResponse('喵'))
      },
      getConfig: () => cfgWith({ model })
    }
    await testConnection(d)
    model = 'deepseek-reasoner'
    await testConnection(d)
    expect(sent).toEqual(['deepseek-chat', 'deepseek-reasoner'])
  })
})

// ---------------------------------------------------------------- 双模式：免费公开池

/**
 * 模式 B（免费公开池）走的是**同一个 postChat**，但请求形状有三处必须不同：
 *   · 地址固定成网关，不读用户配置的 baseUrl；
 *   · **不带任何认证头**（这是「免费池」的字面含义，带 Key 反而是把凭据
 *     发给第三方）；
 *   · 模型名读 poolModel，不读专属模式的 model。
 *
 * 另外 `kilo-auto/free` 可能路由到推理模型：推理 token 也吃 max_tokens，
 * 给太小会返回 `content: null`（实测 32 tokens 时必现）。所以模式 B 统一
 * 加一段 headroom —— 这条不加上，用户会看到「连上了但一句话都没有」。
 */
describe('模式 B：免费公开池', () => {
  const poolCfg = (over: AiPatch = {}): AiPatch => ({
    mode: 'pool',
    poolModel: 'kilo-auto/free',
    apiKey: '',
    ...over
  })

  it('地址固定成网关、无认证头、模型用 poolModel', async () => {
    const d = deps(() => Promise.resolve(chatResponse(GOOD_QUESTIONS)), poolCfg())
    const r = await ask(d)
    expect(r.ok).toBe(true)

    expect(d.calls).toHaveLength(1)
    expect(d.calls[0].url).toBe(`${FREE_POOL_BASE}/chat/completions`)
    const headers = d.calls[0].init.headers as Record<string, string>
    expect(headers['Authorization']).toBeUndefined()
    expect(headers['x-api-key']).toBeUndefined()

    const body = JSON.parse(String(d.calls[0].init.body))
    expect(body.model).toBe('kilo-auto/free')
  })

  it('**没有 Key 也照常发请求**（不再走 no-key 短路）', async () => {
    const d = deps(() => Promise.resolve(chatResponse(GOOD_QUESTIONS)), poolCfg())
    const r = await ask(d)
    expect(r.ok).toBe(true)
    expect(d.calls).toHaveLength(1)
  })

  it('给推理模型留 token 余量，且不带 response_format（网关不一定支持）', async () => {
    // 同一份请求分别用两种模式发，比较实际的 max_tokens
    const api = okDeps('喵')
    await ask(api)
    const apiBody = JSON.parse(String(api.calls[0].init.body))

    const pool = okDeps('喵', poolCfg())
    await ask(pool)
    const poolBody = JSON.parse(String(pool.calls[0].init.body))

    expect(poolBody.max_tokens).toBe(Math.min(apiBody.max_tokens + 1024, 8192))
    expect(poolBody.response_format).toBeUndefined()
  })

  it('专属模式仍然带 Authorization（不能因为加了池模式把这条弄丢）', async () => {
    const d = okDeps('喵')
    await ask(d)
    expect((d.calls[0].init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test')
  })

  it('免费池**不查余额**：直接 unsupported，一个请求都不发', async () => {
    const d = deps(() => Promise.reject(new Error('不该走到这里')), poolCfg())
    expect(await fetchBalance(d)).toEqual({ ok: false, reason: 'unsupported' })
    expect(d.calls).toHaveLength(0)
  })

  it('人设锁：两种模式的 system 段都带 PET_PROMPT.PERSONA', async () => {
    for (const ai of [{}, poolCfg()]) {
      const d = okDeps('喵', ai)
      await chatPet(d, { messages: [{ role: 'user', content: '在吗' }] })
      const body = JSON.parse(String(d.calls[0].init.body))
      expect(body.messages[0].role).toBe('system')
      expect(body.messages[0].content).toContain(PET_PROMPT.PERSONA)
    }
  })

  it('人设锁：免费池出题仍用同一份猫娘大肥鱼世界观提示词', async () => {
    const api = okDeps(GOOD_QUESTIONS)
    await ask(api)
    const pool = okDeps(GOOD_QUESTIONS, poolCfg())
    await ask(pool)
    // 两种模式发出去的 system 段逐字相同 —— 换路由不许换人格
    const apiSystem = JSON.parse(String(api.calls[0].init.body)).messages[0].content
    const poolSystem = JSON.parse(String(pool.calls[0].init.body)).messages[0].content
    expect(poolSystem).toBe(apiSystem)
    expect(poolSystem).toContain(AI_PROMPT.PERSONA)
  })
})

// ---------------------------------------------------------------- 免费池模型清单

describe('listPoolModels', () => {
  const json = (body: unknown): HttpResponseLike => ({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body))
  })

  it('只留 isFree === true，去重，兜底模型排第一', async () => {
    const r = await listPoolModels({
      fetch: () =>
        Promise.resolve(
          json({
            data: [
              { id: 'paid/one', isFree: false },
              { id: 'free/b', name: 'B 模型', isFree: true },
              { id: 'free/a', isFree: true },
              { id: 'free/a', name: '重复的 A', isFree: true },
              { id: '', isFree: true },
              { id: 42, isFree: true },
              { id: 'kilo-auto/free', name: '自动挑一个', isFree: true }
            ]
          })
        )
    })
    expect(r).toEqual({
      ok: true,
      data: [
        { id: 'kilo-auto/free', name: '自动挑一个' },
        { id: 'free/b', name: 'B 模型' },
        { id: 'free/a', name: 'free/a' }
      ]
    })
  })

  it('远端清单里没有兜底模型时也要补上（否则空清单时下拉框无项可选）', async () => {
    const r = await listPoolModels({
      fetch: () => Promise.resolve(json([{ id: 'free/a', isFree: true }]))
    })
    expect(r.ok && r.data.map((m) => m.id)).toEqual([FREE_POOL_DEFAULT_MODEL, 'free/a'])
  })

  it('兼容 {models:[]} 与裸数组两种形状', async () => {
    const a = await listPoolModels({
      fetch: () => Promise.resolve(json({ models: [{ id: 'free/a', isFree: true }] }))
    })
    const b = await listPoolModels({
      fetch: () => Promise.resolve(json([{ id: 'free/b', isFree: true }]))
    })
    expect(a.ok && a.data.some((m) => m.id === 'free/a')).toBe(true)
    expect(b.ok && b.data.some((m) => m.id === 'free/b')).toBe(true)
  })

  it('401 → unauthorized；429 → quota；5xx → server', async () => {
    for (const [status, reason] of [
      [401, 'unauthorized'],
      [403, 'unauthorized'],
      [429, 'quota'],
      [500, 'server']
    ] as const) {
      const r = await listPoolModels({
        fetch: () => Promise.resolve(errorResponse(status, 'nope'))
      })
      expect(!r.ok && r.reason, String(status)).toBe(reason)
    }
  })

  it('不是 JSON → bad-response（不是抛异常）', async () => {
    const r = await listPoolModels({
      fetch: () =>
        Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('<html>') })
    })
    expect(!r.ok && r.reason).toBe('bad-response')
  })
})

// ---------------------------------------------------------------- 专属厂商模型清单（v23）

describe('listProviderModels', () => {
  const listJson = (body: unknown): HttpResponseLike => ({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body))
  })

  it('DeepSeek：GET /models + Bearer，回来的是易读名但 value 仍是 id', async () => {
    const d = deps(() =>
      Promise.resolve(
        listJson({
          object: 'list',
          data: [{ id: 'deepseek-reasoner' }, { id: 'deepseek-chat' }]
        })
      )
    )
    const r = await listProviderModels(d)
    expect(d.calls[0].url).toBe('https://api.deepseek.com/models')
    expect((d.calls[0].init.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk-test'
    )
    expect(r).toEqual({
      ok: true,
      data: [
        { id: 'deepseek-chat', name: 'DeepSeek Chat' },
        { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' }
      ]
    })
  })

  it('Anthropic：x-api-key + 版本头，地址是 /v1/models，display_name 优先', async () => {
    const d = deps(
      () =>
        Promise.resolve(
          listJson({
            data: [
              { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' },
              { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' }
            ]
          })
        ),
      { provider: 'anthropic', model: 'claude-sonnet-5-5' }
    )
    const r = await listProviderModels(d)
    expect(d.calls[0].url).toBe('https://api.anthropic.com/v1/models')
    const headers = d.calls[0].init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-test')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers.Authorization).toBeUndefined()
    expect(r.ok && r.data.map((m) => m.name)).toEqual(['Claude Sonnet 5.5', 'Claude Haiku 5.5'])
  })

  it('2026-11-01 新增五家：各走自己的 /models，鉴权一律 Bearer', async () => {
    const cases = [
      ['zhipu', 'glm-4.7-flash', 'https://open.bigmodel.cn/api/paas/v4/models'],
      ['xai', 'grok-4.3', 'https://api.x.ai/v1/models'],
      ['gemini', 'gemini-2.5-flash', 'https://generativelanguage.googleapis.com/v1beta/openai/models'],
      ['baidu', 'ernie-5.1', 'https://qianfan.baidubce.com/v2/models'],
      ['hunyuan', 'hy3', 'https://tokenhub.tencentmaas.com/v1/models']
    ] as const
    for (const [provider, model, url] of cases) {
      const d = deps(
        () => Promise.resolve(listJson({ object: 'list', data: [{ id: model }] })),
        { provider, model }
      )
      const r = await listProviderModels(d)
      expect(d.calls[0].url, provider).toBe(url)
      const headers = d.calls[0].init.headers as Record<string, string>
      expect(headers.Authorization, provider).toBe('Bearer sk-test')
      expect(r.ok && r.data[0]?.id, provider).toBe(model)
    }
  })

  it('Gemini：兼容层 404 → 原生清单，改用 x-goog-api-key 并把 models/ 前缀剥掉', async () => {
    const urls: string[] = []
    const d = deps(
      (url) => {
        urls.push(url)
        if (url.includes('/v1beta/openai/models')) {
          return Promise.resolve(errorResponse(404, 'not found'))
        }
        return Promise.resolve(
          listJson({
            models: [
              { name: 'models/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro' },
              { name: 'models/gemini-1.5-flash', displayName: 'Gemini 1.5 Flash' }
            ]
          })
        )
      },
      { provider: 'gemini', model: 'gemini-1.5-pro' }
    )
    const r = await listProviderModels(d)
    expect(urls).toEqual([
      'https://generativelanguage.googleapis.com/v1beta/openai/models',
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000'
    ])
    const first = d.calls[0].init.headers as Record<string, string>
    const second = d.calls[1].init.headers as Record<string, string>
    expect(first.Authorization).toBe('Bearer sk-test')
    expect(first['x-goog-api-key']).toBeUndefined()
    expect(second.Authorization).toBeUndefined()
    expect(second['x-goog-api-key']).toBe('sk-test')
    expect(r.ok && r.data.map((m) => m.id)).toEqual([
      'gemini-1.5-flash',
      'gemini-1.5-pro'
    ])
  })

  it('Gemini：兼容层 401 也先试原生（有效 Key 在兼容层被拒确有报告）', async () => {
    const urls: string[] = []
    const d = deps(
      (url) => {
        urls.push(url)
        if (url.includes('/v1beta/openai/models')) {
          return Promise.resolve(errorResponse(401, 'ACCESS_TOKEN_TYPE_UNSUPPORTED'))
        }
        return Promise.resolve(
          listJson({ models: [{ name: 'models/gemini-2.5-flash' }] })
        )
      },
      { provider: 'gemini', model: 'gemini-2.5-flash' }
    )
    const r = await listProviderModels(d)
    expect(urls).toEqual([
      'https://generativelanguage.googleapis.com/v1beta/openai/models',
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000'
    ])
    expect(r.ok && r.data[0]?.id).toBe('gemini-2.5-flash')
  })

  it('Gemini：两条都 401 → unauthorized，绝不拿空清单假装成功', async () => {
    const d = deps(() => Promise.resolve(errorResponse(401, 'bad key')), {
      provider: 'gemini',
      model: 'gemini-2.5-flash'
    })
    const r = await listProviderModels(d)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toBe('unauthorized')
    expect(d.calls).toHaveLength(2)
  })

  it('别的厂商 401 只发一次：没有第二条路可试，别把 Key 多送一遍', async () => {
    const d = deps(() => Promise.resolve(errorResponse(401, 'bad key')), {
      provider: 'zhipu',
      model: 'glm-4-plus'
    })
    const r = await listProviderModels(d)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toBe('unauthorized')
    expect(d.calls).toHaveLength(1)
  })

  it('Gemini 兼容层直接成功：不碰原生地址（少一次往返）', async () => {
    const d = deps(
      () =>
        Promise.resolve(
          listJson({ object: 'list', data: [{ id: 'gemini-1.5-pro' }] })
        ),
      { provider: 'gemini', model: 'gemini-1.5-pro' }
    )
    const r = await listProviderModels(d)
    expect(d.calls).toHaveLength(1)
    expect(d.calls[0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/models'
    )
    expect(r.ok).toBe(true)
  })

  it('没 Key → no-key，一个请求都不发', async () => {
    const d = deps(() => Promise.reject(new Error('不该走到这里')), { apiKey: '' })
    expect(await listProviderModels(d)).toEqual({ ok: false, reason: 'no-key' })
    expect(d.calls).toHaveLength(0)
  })

  it('401/403 → unauthorized；429 → quota；5xx → server', async () => {
    for (const [status, reason] of [
      [401, 'unauthorized'],
      [403, 'unauthorized'],
      [429, 'quota'],
      [500, 'server']
    ] as const) {
      const d = deps(() => Promise.resolve(errorResponse(status, 'nope')))
      const r = await listProviderModels(d)
      expect(!r.ok && r.reason, String(status)).toBe(reason)
    }
  })

  it('自定义网关：第一个地址 404 就试第二个，两个都记在案', async () => {
    const urls: string[] = []
    const d = deps(
      (url) => {
        urls.push(url)
        return Promise.resolve(
          url.endsWith('/v1/models')
            ? listJson([{ id: 'gw-1' }])
            : errorResponse(404, 'not found')
        )
      },
      { provider: 'custom', baseUrl: 'https://gw.example.com', model: 'gw-1' }
    )
    const r = await listProviderModels(d)
    expect(urls).toEqual([
      'https://gw.example.com/models',
      'https://gw.example.com/v1/models'
    ])
    expect(r.ok && r.data.map((m) => m.id)).toEqual(['gw-1'])
  })

  it('自定义网关两个地址都 404 → bad-response（不是「成功但清空」）', async () => {
    const d = deps(() => Promise.resolve(errorResponse(404, 'nope')), {
      provider: 'custom',
      baseUrl: 'https://gw.example.com',
      model: 'x'
    })
    const r = await listProviderModels(d)
    expect(!r.ok && r.reason).toBe('bad-response')
    expect(d.calls).toHaveLength(2)
  })

  it('200 但不是模型清单 → bad-response', async () => {
    const d = deps(() =>
      Promise.resolve(listJson({ error: { message: 'bad key' } }))
    )
    const r = await listProviderModels(d)
    expect(!r.ok && r.reason).toBe('bad-response')
  })

  it('网络异常 → offline，且不再试第二个地址（同一台主机，重试只多等一次）', async () => {
    const d = deps(() => Promise.reject(new TypeError('fetch failed')), {
      provider: 'custom',
      baseUrl: 'https://gw.example.com',
      model: 'x'
    })
    const r = await listProviderModels(d)
    expect(!r.ok && r.reason).toBe('offline')
    expect(d.calls).toHaveLength(1)
  })

  it('外部取消 → canceled', async () => {
    const ac = new AbortController()
    ac.abort()
    const d = deps(() => Promise.reject(new Error('不该走到这里')), {
      provider: 'custom',
      baseUrl: 'https://gw.example.com',
      model: 'x'
    })
    const r = await listProviderModels({ ...d, signal: ac.signal })
    expect(!r.ok && r.reason).toBe('canceled')
    expect(d.calls).toHaveLength(0)
  })

  it('空地址 → offline（没法拼出任何候选地址）', async () => {
    const d = deps(() => Promise.reject(new Error('不该走到这里')), {
      provider: 'custom',
      baseUrl: '   ',
      model: 'x'
    })
    expect(await listProviderModels(d)).toEqual({ ok: false, reason: 'offline', detail: 'base url is empty' })
    expect(d.calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------- 思考强度（v23）

describe('思考强度：真的发出去的参数', () => {
  const bodyOf = (d: { calls: { init: RequestInit }[] }): Record<string, unknown> =>
    JSON.parse(String(d.calls[0].init.body)) as Record<string, unknown>

  it('OpenAI 推理模型：高档真的带 reasoning_effort=high', async () => {
    const d = okDeps('喵', { provider: 'openai', model: 'o1', thinking: 'high' })
    await ask(d)
    expect(bodyOf(d).reasoning_effort).toBe('high')
    expect(bodyOf(d).max_completion_tokens).toBe(8192)
  })

  it('OpenAI 推理模型：选「关闭」退到 low（它关不掉，不许假装关掉）', async () => {
    const d = okDeps('喵', { provider: 'openai', model: 'o1', thinking: 'off' })
    await ask(d)
    expect(bodyOf(d).reasoning_effort).toBe('low')
  })

  it('普通模型不发 reasoning_effort（不认识的字段会 400）', async () => {
    const d = okDeps('喵', { provider: 'openai', model: 'gpt-4o', thinking: 'high' })
    await ask(d)
    expect(bodyOf(d).reasoning_effort).toBeUndefined()
  })

  it('DeepSeek chat + 高 → 真的改用 deepseek-reasoner，且不再发 temperature/response_format', async () => {
    const d = okDeps('喵', { provider: 'deepseek', model: 'deepseek-chat', thinking: 'high' })
    await ask(d)
    const body = bodyOf(d)
    expect(body.model).toBe('deepseek-reasoner')
    expect(body.temperature).toBeUndefined()
    expect(body.response_format).toBeUndefined()
  })

  it('DeepSeek reasoner + 关闭 → 改用 deepseek-chat，普通对话字段回来了', async () => {
    const d = okDeps('喵', { provider: 'deepseek', model: 'deepseek-reasoner', thinking: 'off' })
    await ask(d)
    const body = bodyOf(d)
    expect(body.model).toBe('deepseek-chat')
    expect(body.temperature).toBe(TEMP_QUESTIONS)
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('高档指令**追加在人设之后**：人设一个字都没被替换', async () => {
    const d = okDeps('喵', { provider: 'deepseek', model: 'deepseek-chat', thinking: 'high' })
    await ask(d)
    const system = String((bodyOf(d).messages as { content: string }[])[0].content)
    expect(system).toContain(AI_PROMPT.PERSONA)
    expect(system).toContain(AI_THINKING_PROMPT.high)
  })

  it('2026-11-01 新增五家：高档指令同样只追加在人设之后，且不塞没把握的字段', async () => {
    for (const [provider, model] of [
      ['zhipu', 'glm-4.7-flash'],
      ['xai', 'grok-4.3'],
      ['gemini', 'gemini-2.5-flash'],
      ['baidu', 'ernie-5.1'],
      ['hunyuan', 'hy3']
    ] as const) {
      const d = okDeps('喵', { provider, model, thinking: 'high' })
      await ask(d)
      const body = bodyOf(d)
      expect(body.model, provider).toBe(model)
      expect(body.reasoning_effort, provider).toBeUndefined()
      expect(body.response_format, provider).toBeUndefined()
      const system = String((body.messages as { content: string }[])[0].content)
      expect(system, provider).toContain(AI_PROMPT.PERSONA)
      expect(system.endsWith(AI_THINKING_PROMPT.high), provider).toBe(true)
    }
  })

  it('「关闭」不加任何思考指令 —— 也不许删掉人设', async () => {
    const d = okDeps('喵', { provider: 'deepseek', model: 'deepseek-chat', thinking: 'off' })
    await ask(d)
    const system = String((bodyOf(d).messages as { content: string }[])[0].content)
    expect(system).toContain(AI_PROMPT.PERSONA)
    for (const level of ['low', 'medium', 'high'] as const) {
      expect(system).not.toContain(AI_THINKING_PROMPT[level])
    }
  })

  it('免费池：模型永远是池里那个（思考档不许把 deepseek-chat 发去池网关）', async () => {
    const d = okDeps(GOOD_QUESTIONS, {
      mode: 'pool',
      poolModel: 'kilo-auto/free',
      apiKey: '',
      model: 'deepseek-chat',
      thinking: 'high'
    })
    await ask(d)
    const body = bodyOf(d)
    expect(body.model).toBe('kilo-auto/free')
    const system = String((body.messages as { content: string }[])[0].content)
    expect(system).toContain(AI_PROMPT.PERSONA)
    expect(system).toContain(AI_THINKING_PROMPT.high)
  })

  it('Anthropic：指令进 system 顶层，且**不发任何 thinking 参数**', async () => {
    const d = okDeps('喵', {
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      thinking: 'high'
    })
    await ask(d)
    const body = bodyOf(d)
    expect(String(body.system)).toContain(AI_PROMPT.PERSONA)
    expect(String(body.system)).toContain(AI_THINKING_PROMPT.high)
    expect(body.thinking).toBeUndefined()
  })

  it('测试连接：推理模型的最小请求也要留出思考预算（否则空回复被说成连不上）', async () => {
    const d = okDeps('喵', { provider: 'openai', model: 'o1', thinking: 'medium' })
    await testConnection(d)
    expect(bodyOf(d).max_completion_tokens as number).toBeGreaterThan(8)
  })

  it('缓存判别式带档位：同一个模型 low 与 high 不是同一个键', () => {
    const low = aiCacheModelOf(cfgWith({ model: 'deepseek-chat', thinking: 'low' }))
    const high = aiCacheModelOf(cfgWith({ model: 'deepseek-chat', thinking: 'high' }))
    expect(low).toBe('deepseek-chat|thinking:low')
    expect(high).toBe('deepseek-reasoner|thinking:high')
    expect(low).not.toBe(high)
  })

  it('effectiveAiModel 跟着档位切：设置页显示的模型 = 真正发出去的模型', () => {
    expect(effectiveAiModel(cfgWith({ model: 'deepseek-chat', thinking: 'high' }))).toBe(
      'deepseek-reasoner'
    )
    expect(effectiveAiModel(cfgWith({ model: 'deepseek-chat', thinking: 'medium' }))).toBe(
      'deepseek-chat'
    )
  })

  it('**红线**：高档 + 换模型之后，code 题仍然必须过沙盒复核，不合格照丢', async () => {
    const seen: string[] = []
    const d = okDeps(CODE_RESPONSE, {
      provider: 'deepseek',
      model: 'deepseek-chat',
      thinking: 'high'
    })
    const r = await generateQuestions(
      {
        ...d,
        verifyCode: (item) => {
          seen.push(item.question.stem)
          return Promise.resolve(false)
        }
      },
      { topics: TOPIC, count: 5, terms: TERMS, dateKey: '2026-09-13' }
    )
    // 复核函数被真的调用了（不能因为换了模型/加了思考就跳过）
    expect(seen).toEqual(['看看这段绕圈代码会打印什么？'])
    // 唯一一道题被丢 → 整批失败，绝不当成「成功地出了 0 道题」
    expect(!r.ok && r.reason).toBe('bad-response')
    expect(!r.ok && r.detail).toContain('code-not-verified')
  })
})

