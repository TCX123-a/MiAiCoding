/**
 * SSE 解析纯函数的靶向单测（docs/27 §6.2 / §8.6）。
 *
 * 【为什么这一层必须单独测】
 * 流式对话的所有「怪现象」几乎都出在这几十行里：一段话看起来"卡住"、
 * 最后几个字丢了、多轮之后 AI 开始重复、偶尔蹦出半句 JSON 原文——
 * 而这些现象在 UI 上长得**一模一样**（都是"回话不太对"）。
 * 解析器是纯函数，就能把「服务端字节到底被理解成了什么」钉在这里，
 * 不用起 Electron、不用出网、不用看界面。
 *
 * 【契约（实现必须逐条满足）】
 *   ① 跨 chunk 的半行要粘起来，不能把半行当整行处理；
 *   ② 同一事件块里的多行 `data:` 用 `\n` 连接（服务端会把长文本折行）；
 *   ③ `[DONE]` 是结束哨兵，不是正文；
 *   ④ 以 `:` 开头的 keep-alive 注释行不产生事件，也不打断当前事件块；
 *   ⑤ `\r\n` / `\r` 都要认（Windows 代理与中间层会改写行尾）；
 *   ⑥ 非法 JSON、缺字段、空 delta 一律 `ignore` —— **绝不抛**，
 *      抛一次整条流就断了，而用户看到的是"说到一半自己停了"；
 *   ⑦ `end()` 要把没有收尾空行的最后一段吐出来（服务端偶发不发送尾空行）。
 */
import { describe, expect, it } from 'vitest'
import { createSseParser, readSsePayload, SSE_DONE, type SseEvent } from '../sse'

/** 把一整段按给定切片喂进去，收集全部事件（模拟真实网络的分块） */
function feedAll(raw: string, chunkSize = 7): SseEvent[] {
  const p = createSseParser()
  const out: SseEvent[] = []
  for (let i = 0; i < raw.length; i += chunkSize) {
    out.push(...p.feed(raw.slice(i, i + chunkSize)))
  }
  out.push(...p.end())
  return out
}

/** 一条 OpenAI 兼容的增量帧（只保留本项目关心的字段） */
function deltaFrame(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text }, index: 0 }] })}\n\n`
}

describe('SSE 分块解析：跨 chunk 的半行与行尾形态', () => {
  it('一段普通的流按 1 字节切片喂进去，结果与整段喂完全相同', () => {
    const raw = deltaFrame('你') + deltaFrame('好') + deltaFrame('喵')
    const one = feedAll(raw, 1).map((e) => e.data)
    const whole = feedAll(raw, raw.length).map((e) => e.data)
    expect(one.length).toBe(3)
    expect(one).toEqual(whole)
  })

  it('跨 chunk 的半行要被粘起来（半行不是一条事件）', () => {
    const p = createSseParser()
    // 在 `data: {"choi` 中间断开
    expect(p.feed('data: {"choi')).toEqual([])
    const events = p.feed('ces":[{"delta":{"content":"a"}}]}\n\n')
    expect(events).toEqual([{ data: '{"choices":[{"delta":{"content":"a"}}]}' }])
  })

  it('\\r\\n 行尾与 \\n 行尾等价', () => {
    const lf = feedAll(deltaFrame('a'), 3).map((e) => e.data)
    const crlf = feedAll(deltaFrame('a').replace(/\n/g, '\r\n'), 3).map((e) => e.data)
    expect(crlf).toEqual(lf)
  })

  it('同一事件块里的多行 data: 用 \\n 连接（服务端折行）', () => {
    const events = feedAll('data: 第一行\ndata: 第二行\n\n')
    expect(events).toEqual([{ data: '第一行\n第二行' }])
  })

  it('值里的前导单个空格被去掉，多个空格保留（SSE 规范只去掉一个）', () => {
    expect(feedAll('data:  x\n\n')).toEqual([{ data: ' x' }])
  })
})

describe('SSE 特殊行：keep-alive、[DONE]、未知字段', () => {
  it('以 : 开头的 keep-alive 注释不产生事件，也不打断当前事件块', () => {
    const raw = ': keep-alive\n\n' + deltaFrame('a')
    expect(feedAll(raw).map((e) => e.data)).toHaveLength(1)
  })

  it('keep-alive 夹在一个事件块中间时，不把这块劈成两条', () => {
    const events = feedAll('data: a\n: ping\ndata: b\n\n')
    expect(events).toEqual([{ data: 'a\nb' }])
  })

  it('[DONE] 原样作为一条事件吐出（由上层判定结束，解析器不吞语义）', () => {
    const events = feedAll(deltaFrame('a') + `data: ${SSE_DONE}\n\n`)
    expect(events.map((e) => e.data)).toEqual([
      '{"choices":[{"delta":{"content":"a"},"index":0}]}',
      SSE_DONE
    ])
  })

  it('event: / id: / retry: 等字段被忽略，不污染 data', () => {
    const events = feedAll('event: message\nid: 7\nretry: 1000\ndata: x\n\n')
    expect(events).toEqual([{ data: 'x' }])
  })
})

describe('SSE 收尾：没有结束空行时也不能丢最后一段', () => {
  it('end() 吐出没有尾随空行的残留块', () => {
    const p = createSseParser()
    expect(p.feed('data: tail')).toEqual([])
    expect(p.end()).toEqual([{ data: 'tail' }])
  })

  it('end() 幂等：再调一次不会重复吐同一条', () => {
    const p = createSseParser()
    p.feed('data: once\n\n')
    expect(p.end()).toEqual([])
    expect(p.end()).toEqual([])
  })

  it('空块与只有 keep-alive 的块不产生事件', () => {
    expect(feedAll('\n\n: ping\n\n\n')).toEqual([])
  })
})

describe('readSsePayload：把一条 data 翻译成动作', () => {
  it('正常增量 → delta', () => {
    expect(readSsePayload('{"choices":[{"delta":{"content":"喵"}}]}')).toEqual({
      kind: 'delta',
      text: '喵'
    })
  })

  it('首帧只有 role、没有 content → ignore（不是空回复）', () => {
    expect(readSsePayload('{"choices":[{"delta":{"role":"assistant"}}]}')).toEqual({ kind: 'ignore' })
  })

  it('空字符串 delta → ignore（服务端会插空帧保活）', () => {
    expect(readSsePayload('{"choices":[{"delta":{"content":""}}]}')).toEqual({ kind: 'ignore' })
  })

  it('finish_reason 收尾帧（没有 content）→ ignore', () => {
    expect(readSsePayload('{"choices":[{"delta":{},"finish_reason":"stop"}]}')).toEqual({
      kind: 'ignore'
    })
  })

  it('[DONE] → done', () => {
    expect(readSsePayload(SSE_DONE)).toEqual({ kind: 'done' })
    expect(readSsePayload(` ${SSE_DONE} `)).toEqual({ kind: 'done' })
  })

  it('非法 JSON / 空 data / 缺 choices / choices 非数组 → 一律 ignore，绝不抛', () => {
    for (const bad of ['{not json', '', '   ', '{}', '{"choices":[]}', '{"choices":"x"}', 'null']) {
      expect(() => readSsePayload(bad), bad).not.toThrow()
      expect(readSsePayload(bad), bad).toEqual({ kind: 'ignore' })
    }
  })

  it('content 不是字符串 → ignore（防御服务端形状漂移）', () => {
    expect(readSsePayload('{"choices":[{"delta":{"content":123}}]}')).toEqual({ kind: 'ignore' })
  })

  /*
   * 思考帧（reasoning_content）：**不并进正文**，但要能被认出来。
   * 实测 deepseek-flash 的 effort 默认 high，会先想后说；把思考当 ignore 的话，
   * 上层首字闸在思考期间看不到任何动静，长思考会被误判成超时。
   */
  it('只有 reasoning_content → reasoning（不是正文，也不是 ignore）', () => {
    expect(readSsePayload('{"choices":[{"delta":{"reasoning_content":"先想一下"}}]}')).toEqual({
      kind: 'reasoning'
    })
  })

  it('content 与 reasoning_content 同时出现 → 只取正文（思考绝不进界面）', () => {
    expect(
      readSsePayload('{"choices":[{"delta":{"reasoning_content":"略","content":"答案"}}]}')
    ).toEqual({ kind: 'delta', text: '答案' })
  })
})
