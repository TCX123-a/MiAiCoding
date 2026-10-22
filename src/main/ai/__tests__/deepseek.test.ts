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
  AI_TIMEOUT_MS,
  QUESTIONS_TIMEOUT_MS,
  BALANCE_TIMEOUT_MS,
  TEMP_QUESTIONS,
  type AiDeps,
  type FetchLike,
  type HttpResponseLike
} from '../deepseek'
import { DEFAULT_APP_CONFIG, type AppConfig, type GlossaryTerm } from '../../../shared/types'

// ---------------------------------------------------------------- 假货

const TERMS: GlossaryTerm[] = [
  { key: 'loop', originals: ['循环'], cat: '绕鱼干跑圈', example: '循环就是让代码绕鱼干跑圈' }
]

function cfgWith(ai: Partial<AppConfig['ai']> = {}): AppConfig {
  return { ...structuredClone(DEFAULT_APP_CONFIG), ai: { ...DEFAULT_APP_CONFIG.ai, apiKey: 'sk-test', ...ai } }
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
function deps(fetchImpl: FetchLike, ai: Partial<AppConfig['ai']> = {}): AiDeps & { calls: { url: string; init: RequestInit }[] } {
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

const okDeps = (content: string, ai: Partial<AppConfig['ai']> = {}) =>
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
  it('URL 是 baseUrl + /chat/completions，结尾斜杠不会拼出双斜杠', async () => {
    const d = okDeps(GOOD_QUESTIONS, { baseUrl: 'https://api.deepseek.com/' })
    await ask(d)
    expect(d.calls[0].url).toBe('https://api.deepseek.com/chat/completions')
  })

  it('用户填了 /v1 也照样能用（OpenAI 兼容写法）', async () => {
    const d = okDeps(GOOD_QUESTIONS, { baseUrl: 'https://api.deepseek.com/v1' })
    await ask(d)
    expect(d.calls[0].url).toBe('https://api.deepseek.com/v1/chat/completions')
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
      data: { currency: 'CNY', total: '88.88', granted: '5.00', toppedUp: '83.88' }
    })
  })

  it('没有 CNY 才退回第一条（四元组字节原样，绝不自己算"还剩几成"）', async () => {
    const onlyUsd = JSON.stringify({
      balance_infos: [{ currency: 'USD', total_balance: '12.34', granted_balance: '0', topped_up_balance: '12.34' }]
    })
    const r = await fetchBalance(balanceDeps(okRes(onlyUsd)))
    expect(r).toEqual({ ok: true, data: { currency: 'USD', total: '12.34', granted: '0', toppedUp: '12.34' } })
  })

  it('URL 是 baseUrl + /user/balance，GET，且结尾斜杠不拼双斜杠', async () => {
    const d = balanceDeps(okRes(MULTI), { baseUrl: 'https://api.deepseek.com/' })
    await fetchBalance(d)
    expect(d.calls[0].url).toBe('https://api.deepseek.com/user/balance')
    expect(d.calls[0].init.method).toBe('GET')
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
  it('成功时回报用了哪个模型（设置页要显示出来）', async () => {
    const r = await testConnection(okDeps('喵', { model: 'deepseek-chat' }))
    expect(r).toEqual({ ok: true, data: { model: 'deepseek-chat' } })
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
