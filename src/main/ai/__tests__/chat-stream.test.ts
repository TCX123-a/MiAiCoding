/**
 * 流式对话的靶向单测（docs/27 §8.6：注入假 fetch，**零 mock 惯例**）。
 *
 * 【为什么是"假 fetch"而不是 `vi.mock`】
 * 全项目零 mock：`fetch` 一直是**注入**的（`AiDeps.fetch`）。
 * 塞一个假货就能把 401 / 断网 / 首字超时 / 取消 / 半行分块每条分支跑一遍，
 * 一次都不用真的联网，也不用伪造整个模块图。这条惯例从 deepseek.test.ts 起就没破过。
 *
 * 【覆盖面】
 *   ① 字节流 → 增量回调 → 全文拼接（含跨 chunk 半行）；
 *   ② 四条失败分支：无 Key / 401 / 断网 / 空流 / 没有 body；
 *   ③ 双闸超时：首字 20s、总时长 120s（假计时器）；
 *   ④ 取消：外部 signal abort → `canceled`，不是 `timeout`；
 *   ⑤ 编排层：上下文拼装顺序（§8.4）、历史截断、限流闸门（§8.3）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig, AiChatStartInput } from '../../../shared/types'
import { streamChat, type FetchLike, type HttpResponseLike, type StreamReaderLike } from '../deepseek'
import {
  buildChatMessages,
  createChatGate,
  runChat,
  CHAT_BACKOFF_MS,
  CHAT_HISTORY_MAX_MESSAGES,
  CHAT_MIN_INTERVAL_MS,
  TEMP_CHAT
} from '../chat'

// ---------------------------------------------------------------- 夹具

function cfg(overrides?: Partial<AppConfig['ai']>): AppConfig {
  return {
    version: 20,
    ai: {
      apiKey: 'sk-test',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      dynamicEnabled: false,
      ...overrides
    }
  } as AppConfig
}

/** 一条 OpenAI 兼容的增量帧 */
function deltaFrame(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text }, index: 0 }] })}\n\n`
}

/** 把若干文本块做成一个响应体（每次 read 吐一块，最后 done） */
function bodyOf(chunks: string[]): { getReader(): StreamReaderLike } {
  let i = 0
  return {
    getReader(): StreamReaderLike {
      return {
        async read() {
          if (i >= chunks.length) return { done: true }
          const text = chunks[i]
          i += 1
          return { done: false, value: new TextEncoder().encode(text) }
        },
        async cancel() {
          /* 提前收场：什么都不用做 */
        }
      }
    }
  }
}

function okResponse(chunks: string[]): HttpResponseLike {
  return { ok: true, status: 200, text: async () => '', body: bodyOf(chunks) }
}

/** 记录最后一次请求，方便断言请求体 */
interface Recorder {
  url: string
  init: RequestInit
}

function fakeFetch(res: HttpResponseLike | (() => Promise<HttpResponseLike>), rec: Recorder): FetchLike {
  return async (url, init) => {
    rec.url = url
    rec.init = init
    return typeof res === 'function' ? res() : res
  }
}

/** 一个 AbortError（Node 的 fetch 抛的是 DOMException，不是 Error 子类） */
function abortError(): Error {
  return Object.assign(new Error('aborted'), { name: 'AbortError' })
}

/**
 * 一个"永远不主动吐数据"的读口：只在 abort 时 reject。
 * 用它模拟"字一直不来"——首字闸与总时长闸都靠这个场景验证。
 */
function hangingBody(signalBox: { signal?: AbortSignal }, firstChunk?: string) {
  let served = false
  return {
    getReader(): StreamReaderLike {
      return {
        read(): Promise<{ done: boolean; value?: Uint8Array }> {
          if (firstChunk !== undefined && !served) {
            served = true
            return Promise.resolve({ done: false, value: new TextEncoder().encode(firstChunk) })
          }
          const signal = signalBox.signal
          return new Promise((_resolve, reject) => {
            if (!signal) {
              reject(new Error('no signal captured'))
              return
            }
            if (signal.aborted) {
              reject(abortError())
              return
            }
            signal.addEventListener('abort', () => reject(abortError()), { once: true })
          })
        },
        async cancel() {
          /* 提前收场 */
        }
      }
    }
  }
}

const input = (messages: AiChatStartInput['messages'], context?: AiChatStartInput['context']) =>
  ({ messages, context }) as AiChatStartInput

const askOne = (text = '这段报错什么意思') =>
  input([{ role: 'user', content: text }])

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------- 流式读取

describe('streamChat：字节流 → 增量 → 全文', () => {
  it('正常流：三段增量按序回调，返回值是拼接全文', async () => {
    const rec: Recorder = { url: '', init: {} }
    const deltas: string[] = []
    const res = await streamChat(
      { fetch: fakeFetch(okResponse([deltaFrame('先'), deltaFrame('看'), deltaFrame('报错')]), rec), getConfig: cfg },
      { messages: [{ role: 'user', content: 'hi' }], temperature: 1, maxTokens: 128 },
      (d) => deltas.push(d)
    )

    expect(res).toEqual({ ok: true, data: '先看报错' })
    expect(deltas).toEqual(['先', '看', '报错'])

    // 请求体：stream:true、模型来自配置、URL 拼对
    expect(rec.url).toBe('https://api.deepseek.com/chat/completions')
    const body = JSON.parse(String(rec.init.body)) as { stream: boolean; model: string }
    expect(body.stream).toBe(true)
    expect(body.model).toBe('deepseek-chat')
    expect((rec.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
  })

  it('跨 chunk 半行也拼得对（一个字节一个字节喂）', async () => {
    const raw = deltaFrame('半') + deltaFrame('行')
    const rec: Recorder = { url: '', init: {} }
    const bytes = [...raw]
    const res = await streamChat(
      { fetch: fakeFetch(okResponse(bytes), rec), getConfig: cfg },
      { messages: [{ role: 'user', content: 'hi' }], temperature: 1, maxTokens: 128 },
      () => {}
    )
    expect(res).toEqual({ ok: true, data: '半行' })
  })

  it('[DONE] 之后不再收（后面的帧是垃圾，不该进正文）', async () => {
    const rec: Recorder = { url: '', init: {} }
    const res = await streamChat(
      {
        fetch: fakeFetch(okResponse([deltaFrame('好'), 'data: [DONE]\n\n', deltaFrame('不该出现')]), rec),
        getConfig: cfg
      },
      { messages: [{ role: 'user', content: 'hi' }], temperature: 1, maxTokens: 128 },
      () => {}
    )
    expect(res).toEqual({ ok: true, data: '好' })
  })

  it('服务端不发 [DONE]、直接关流：已收到的内容不能丢', async () => {
    const rec: Recorder = { url: '', init: {} }
    // 最后一段没有结束空行 —— 靠 parser.end() 兜住
    const res = await streamChat(
      { fetch: fakeFetch(okResponse([deltaFrame('a'), 'data: {"choices":[{"delta":{"content":"z"}}]}']), rec), getConfig: cfg },
      { messages: [{ role: 'user', content: 'hi' }], temperature: 1, maxTokens: 128 },
      () => {}
    )
    expect(res).toEqual({ ok: true, data: 'az' })
  })

  it('非法 JSON 帧被忽略，正文不受影响（不抛、不断流）', async () => {
    const rec: Recorder = { url: '', init: {} }
    const res = await streamChat(
      {
        fetch: fakeFetch(
          okResponse([`: keep-alive\n\n`, 'data: {broken\n\n', deltaFrame('还在'), deltaFrame('继续')]),
          rec
        ),
        getConfig: cfg
      },
      { messages: [{ role: 'user', content: 'hi' }], temperature: 1, maxTokens: 128 },
      () => {}
    )
    expect(res).toEqual({ ok: true, data: '还在继续' })
  })

  it('只有 [DONE]、一个字都没有 → bad-response（不是"AI 说没话说"）', async () => {
    const rec: Recorder = { url: '', init: {} }
    const res = await streamChat(
      { fetch: fakeFetch(okResponse(['data: [DONE]\n\n']), rec), getConfig: cfg },
      { messages: [{ role: 'user', content: 'hi' }], temperature: 1, maxTokens: 128 },
      () => {}
    )
    expect(res).toEqual({ ok: false, reason: 'bad-response', detail: 'empty stream' })
  })

  it('响应没有 body → bad-response（防御代理把流截成空响应）', async () => {
    const rec: Recorder = { url: '', init: {} }
    const res = await streamChat(
      {
        fetch: fakeFetch({ ok: true, status: 200, text: async () => '', body: null }, rec),
        getConfig: cfg
      },
      { messages: [{ role: 'user', content: 'hi' }], temperature: 1, maxTokens: 128 },
      () => {}
    )
    expect(res).toEqual({ ok: false, reason: 'bad-response', detail: 'no response body' })
  })
})

describe('streamChat：失败分支（口径与 postChat 逐条一致）', () => {
  it('没配 Key → no-key，且一个包都不发', async () => {
    let called = 0
    const res = await streamChat(
      {
        fetch: async () => {
          called += 1
          return okResponse([])
        },
        getConfig: () => cfg({ apiKey: '' })
      },
      { messages: [{ role: 'user', content: 'hi' }], temperature: 1, maxTokens: 128 },
      () => {}
    )
    expect(res).toEqual({ ok: false, reason: 'no-key' })
    expect(called, '没 Key 却发了请求 —— 这是拿空凭据去打人家的门').toBe(0)
  })

  it('401 → unauthorized（下一步是去改 Key）', async () => {
    const rec: Recorder = { url: '', init: {} }
    const res = await streamChat(
      {
        fetch: fakeFetch({ ok: false, status: 401, text: async () => '{"message":"bad key"}', body: null }, rec),
        getConfig: cfg
      },
      { messages: [{ role: 'user', content: 'hi' }], temperature: 1, maxTokens: 128 },
      () => {}
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('unauthorized')
      expect(res.detail).toBe('HTTP 401: bad key')
    }
  })

  it('402 → quota（下一步是去充值）', async () => {
    const rec: Recorder = { url: '', init: {} }
    const res = await streamChat(
      { fetch: fakeFetch({ ok: false, status: 402, text: async () => '', body: null }, rec), getConfig: cfg },
      { messages: [{ role: 'user', content: 'hi' }], temperature: 1, maxTokens: 128 },
      () => {}
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('quota')
  })

  it('503 → server', async () => {
    const rec: Recorder = { url: '', init: {} }
    const res = await streamChat(
      { fetch: fakeFetch({ ok: false, status: 503, text: async () => '', body: null }, rec), getConfig: cfg },
      { messages: [{ role: 'user', content: 'hi' }], temperature: 1, maxTokens: 128 },
      () => {}
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('server')
  })

  it('fetch 抛错（断网 / DNS 失败）→ offline', async () => {
    const rec: Recorder = { url: '', init: {} }
    const res = await streamChat(
      {
        fetch: fakeFetch(() => Promise.reject(new TypeError('fetch failed')), rec),
        getConfig: cfg
      },
      { messages: [{ role: 'user', content: 'hi' }], temperature: 1, maxTokens: 128 },
      () => {}
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('offline')
  })

  it('开跑前已被取消 → canceled，且不发请求', async () => {
    const ac = new AbortController()
    ac.abort()
    let called = 0
    const res = await streamChat(
      {
        fetch: async () => {
          called += 1
          return okResponse([])
        },
        getConfig: cfg,
        signal: ac.signal
      },
      { messages: [{ role: 'user', content: 'hi' }], temperature: 1, maxTokens: 128 },
      () => {}
    )
    expect(res).toEqual({ ok: false, reason: 'canceled' })
    expect(called).toBe(0)
  })

  it('流中途被取消 → canceled（不是 timeout：取消是用户意志）', async () => {
    const signalBox: { signal?: AbortSignal } = {}
    const ac = new AbortController()
    const deltas: string[] = []
    // 先吐一块（首字已到），然后挂住 —— 这时取消，必须落到 canceled
    const p = streamChat(
      {
        fetch: async (_url, init) => {
          signalBox.signal = init.signal ?? undefined
          return {
            ok: true,
            status: 200,
            text: async () => '',
            body: hangingBody(signalBox, deltaFrame('开头'))
          }
        },
        getConfig: cfg,
        signal: ac.signal
      },
      { messages: [{ role: 'user', content: 'hi' }], temperature: 1, maxTokens: 128 },
      (d) => deltas.push(d)
    )

    // 宏任务让微任务先跑完：第一块已被消费，循环正挂在第二次 read() 上
    await new Promise((r) => setTimeout(r, 0))
    expect(deltas).toEqual(['开头'])

    ac.abort()
    const res = await p
    expect(res).toEqual({ ok: false, reason: 'canceled' })
  })
})

describe('streamChat：思考帧（reasoning_content）', () => {
  /** 一条只带思考的帧 */
  const reasoningFrame = (t: string): string =>
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: t }, index: 0 }] })}\n\n`

  it('思考只续命、不进正文', async () => {
    const rec: Recorder = { url: '', init: {} }
    const deltas: string[] = []
    const res = await streamChat(
      {
        fetch: fakeFetch(okResponse([reasoningFrame('想'), reasoningFrame('一'), deltaFrame('答案')]), rec),
        getConfig: cfg
      },
      { messages: [{ role: 'user', content: 'hi' }], temperature: 1, maxTokens: 128 },
      (d) => deltas.push(d)
    )
    expect(res).toEqual({ ok: true, data: '答案' })
    expect(deltas, '思考内容漏进界面了').toEqual(['答案'])
  })

  it('长思考（首字前憋了 60 秒）不该被 20 秒首字闸杀掉', async () => {
    vi.useFakeTimers()
    const signalBox: { signal?: AbortSignal } = {}
    const deltas: string[] = []
    // 先给一帧思考（证明流活着），然后挂住；此时首字闸必须已被清掉
    const p = streamChat(
      {
        fetch: async (_url, init) => {
          signalBox.signal = init.signal ?? undefined
          return {
            ok: true,
            status: 200,
            text: async () => '',
            body: hangingBody(signalBox, reasoningFrame('思考中'))
          }
        },
        getConfig: cfg
      },
      { messages: [{ role: 'user', content: 'hi' }], temperature: 1, maxTokens: 128 },
      (d) => deltas.push(d)
    )

    await vi.advanceTimersByTimeAsync(1_000)
    let settled = false
    void p.then(() => {
      settled = true
    })
    // 越过首字闸（20s）再看：不该收场
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(settled, '思考帧没给首字闸续命 —— 长思考会被误判成超时').toBe(false)
    expect(deltas).toEqual([])

    // 总时长闸（120s）照旧收场
    await vi.advanceTimersByTimeAsync(120_000)
    const res = await p
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('timeout')
  })
})

// ---------------------------------------------------------------- 双闸超时

describe('streamChat：双闸超时（首字 20s / 总时长 120s）', () => {
  it('首字不来：20 秒 abort → timeout', async () => {
    vi.useFakeTimers()
    const signalBox: { signal?: AbortSignal } = {}
    const p = streamChat(
      {
        fetch: async (_url, init) => {
          signalBox.signal = init.signal ?? undefined
          return { ok: true, status: 200, text: async () => '', body: hangingBody(signalBox) }
        },
        getConfig: cfg
      },
      { messages: [{ role: 'user', content: 'hi' }], temperature: 1, maxTokens: 128 },
      () => {}
    )
    await vi.advanceTimersByTimeAsync(20_000)
    const res = await p
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('timeout')
  })

  it('首字来了、之后卡住：首字闸必须清掉，走 120 秒总时长闸', async () => {
    vi.useFakeTimers()
    const signalBox: { signal?: AbortSignal } = {}
    const deltas: string[] = []
    const p = streamChat(
      {
        fetch: async (_url, init) => {
          signalBox.signal = init.signal ?? undefined
          return {
            ok: true,
            status: 200,
            text: async () => '',
            body: hangingBody(signalBox, deltaFrame('开头'))
          }
        },
        getConfig: cfg
      },
      { messages: [{ role: 'user', content: 'hi' }], temperature: 1, maxTokens: 128 },
      (d) => deltas.push(d)
    )

    // 先让第一块跑完（首字已到，首字闸被 clearTimeout）
    await vi.advanceTimersByTimeAsync(1_000)
    expect(deltas).toEqual(['开头'])

    // 到 20 秒时不该被杀 —— 首字闸已经清掉了
    await vi.advanceTimersByTimeAsync(20_000)
    let settled = false
    void p.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled, '首字到了还被首字闸杀掉 —— 长回答会被误伤').toBe(false)

    // 到 120 秒总时长闸收场
    await vi.advanceTimersByTimeAsync(120_000)
    const res = await p
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('timeout')
  })
})

// ---------------------------------------------------------------- 编排层：上下文

describe('buildChatMessages：上下文按 §8.4 顺序拼装', () => {
  const terms = [
    { originals: ['变量'], cat: '变量=小鱼干仓库', example: 'int a;' },
    { originals: ['函数'], cat: '函数=技能/招式', example: '' }
  ]

  it('system 段顺序：人设 → 规矩 → 术语表 → 代码 → 选区 → 运行输出', () => {
    const messages = buildChatMessages(
      input([{ role: 'user', content: '帮我看看' }], {
        code: 'int main() { return 0; }',
        lang: 'c',
        selection: { text: 'return 0;', fromLine: 1, toLine: 1 },
        runOutput: 'error: expected ;',
        terms: terms as never
      })
    )
    expect(messages).toHaveLength(2)
    const system = messages[0].content
    expect(messages[0].role).toBe('system')
    const order = ['大肥鱼', '回答规矩', '术语', '当前编辑器里的代码', '选中的那一段', '最近一次运行的输出']
    const positions = order.map((k) => system.indexOf(k))
    for (const [i, pos] of positions.entries()) {
      expect(pos, `第 ${i} 段「${order[i]}」没出现在 system 里`).toBeGreaterThanOrEqual(0)
    }
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('术语表进提示词（铁律 2：不许另起一套词）', () => {
    const system = buildChatMessages(input([{ role: 'user', content: 'x' }], { terms: terms as never }))[0]
      .content
    expect(system).toContain('小鱼干仓库')
    expect(system).toContain('技能/招式')
  })

  it('没有上下文时 system 里不出现空上下文段', () => {
    const system = buildChatMessages(askOne())[0].content
    expect(system).toContain('大肥鱼')
    expect(system).not.toContain('当前编辑器里的代码')
    expect(system).not.toContain('最近一次运行的输出')
  })

  it('空白代码 / 空白选区不算上下文（用户勾了但编辑器是空的）', () => {
    const system = buildChatMessages(
      input([{ role: 'user', content: 'x' }], {
        code: '   \n  ',
        selection: { text: '  ', fromLine: 1, toLine: 1 }
      })
    )[0].content
    expect(system).not.toContain('当前编辑器里的代码')
    expect(system).not.toContain('选中的那一段')
  })

  it('历史只带最近 N 条，且顺序原样', () => {
    const many = Array.from({ length: 30 }, (_v, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `m${i}`
    }))
    const messages = buildChatMessages(input(many))
    const history = messages.slice(1)
    expect(history).toHaveLength(CHAT_HISTORY_MAX_MESSAGES)
    expect(history[history.length - 1].content).toBe('m29')
    expect(history[0].content).toBe('m20')
  })

  it('超长历史消息被截断（防一次粘贴顶掉整个窗口）', () => {
    const huge = 'x'.repeat(20_000)
    const messages = buildChatMessages(input([{ role: 'user', content: huge }]))
    expect(messages[1].content.length).toBeLessThan(huge.length)
  })
})

describe('runChat：唯一出口', () => {
  it('最后一条不是 user → bad-response，且不发请求', async () => {
    let called = 0
    const res = await runChat(
      {
        fetch: async () => {
          called += 1
          return okResponse([])
        },
        getConfig: cfg
      },
      input([{ role: 'assistant', content: '我先说一句' }]),
      () => {}
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('bad-response')
    expect(called).toBe(0)
  })

  it('正常请求：温度取对话档，messages 首条是 system', async () => {
    const rec: Recorder = { url: '', init: {} }
    const res = await runChat(
      { fetch: fakeFetch(okResponse([deltaFrame('好')]), rec), getConfig: cfg },
      askOne(),
      () => {}
    )
    expect(res).toEqual({ ok: true, data: '好' })
    const body = JSON.parse(String(rec.init.body)) as {
      temperature: number
      messages: { role: string }[]
    }
    expect(body.temperature).toBe(TEMP_CHAT)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[body.messages.length - 1].role).toBe('user')
  })
})

// ---------------------------------------------------------------- 限流闸门

describe('createChatGate：限流与退避（§8.3）', () => {
  it('第一次放行、紧接着第二次被挡（最小间隔 800ms）', () => {
    const gate = createChatGate()
    expect(gate.tryStart(1_000)).toBeNull()
    expect(gate.tryStart(1_000 + CHAT_MIN_INTERVAL_MS - 1)).toBe('throttled')
    expect(gate.tryStart(1_000 + CHAT_MIN_INTERVAL_MS)).toBeNull()
  })

  it('连续失败 3 次 → 退避 30 秒，期间一律 throttled', () => {
    const gate = createChatGate()
    gate.noteResult('fail', 0)
    gate.noteResult('fail', 0)
    expect(gate.state().consecutiveFailures).toBe(2)
    gate.noteResult('fail', 0)
    expect(gate.state().backoffUntil).toBe(CHAT_BACKOFF_MS)

    expect(gate.tryStart(CHAT_BACKOFF_MS - 1)).toBe('throttled')
    expect(gate.tryStart(CHAT_BACKOFF_MS)).toBeNull()
  })

  it('一次成功把失败计数与退避清零', () => {
    const gate = createChatGate()
    gate.noteResult('fail', 0)
    gate.noteResult('fail', 0)
    gate.noteResult('ok', 0)
    expect(gate.state()).toMatchObject({ consecutiveFailures: 0, backoffUntil: 0 })
  })

  it('取消不算失败，也不清零（用户的取消不该洗掉真实故障计数）', () => {
    const gate = createChatGate()
    gate.noteResult('fail', 0)
    gate.noteResult('cancel', 0)
    expect(gate.state().consecutiveFailures).toBe(1)
    gate.noteResult('fail', 0)
    gate.noteResult('cancel', 0)
    gate.noteResult('fail', 0)
    expect(gate.state().consecutiveFailures).toBe(3)
  })
})
