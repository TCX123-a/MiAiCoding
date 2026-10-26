/**
 * SSE（Server-Sent Events）解析 —— **纯函数，可被 Vitest 直接测**。
 *
 * 【为什么单独一个文件，而不是塞进 deepseek.ts】
 * 解析要跟「网络怎么读」分开：网络那层只会给我们**不保证按行切开**的字节块
 * （一个 chunk 可能在 `data: {"choi` 中间断开），而 SSE 的语义是**按行**的。
 * 这两件事混在一起写，典型表现是「本地测得好好的，一上真实网络就偶尔少几个字」——
 * 而且极难复现。拆开之后：`createSseParser()` 只管粘行、切块，
 * `readSsePayload()` 只管把一条 data 解释成动作，两者都能用字符串喂到每一个分支。
 *
 * 【它不认识 DeepSeek，只认识 SSE】
 * `readSsePayload` 里那层 `choices[0].delta.content` 是 OpenAI 兼容协议的形状，
 * 但函数只做「认不出来就 ignore」，所以换成任何兼容服务商都不用改。
 *
 * 【为什么解析器有状态、却不是类】
 * 一个类只为了藏两个变量（残余缓冲、当前事件块的 data 行）不值当；
 * 闭包返回 `{feed, end}` 就够了，而且天然不可能被外部改坏内部状态。
 *
 * 【零中文】本文件在 `src/` 下、被文案闸门扫：字符串一律 ASCII。
 */

/** 结束哨兵。它在 SSE 里是**一条 data**，语义由上层给（解析器不吞它） */
export const SSE_DONE = '[DONE]'

/** 一条 SSE 事件：同一个事件块里所有 `data:` 行的内容，用 `\n` 连接 */
export interface SseEvent {
  data: string
}

export interface SseParser {
  /** 喂一个（可能半行的）文本块，返回本次能完整切出的事件 */
  feed(chunk: string): SseEvent[]
  /** 流结束：把残余的最后一块吐出来（服务端偶发不发结束空行） */
  end(): SseEvent[]
}

/**
 * 造一个解析器。
 *
 * 行处理按 SSE 规范（WHATWG）：
 *   · 空行 = 一块结束 → 吐事件；
 *   · `:` 开头 = 注释（常见于 keep-alive `: ping`）→ 丢弃，**不结束当前块**；
 *   · `data` 字段 → 追加一行（**只去掉一个前导空格**，多空格是正文）；
 *   · `event` / `id` / `retry` → 本项目用不到，忽略；
 *   · 行尾 `\r\n` 与 `\n` 等价（中间层会改写）。
 */
export function createSseParser(): SseParser {
  /** 还没凑成整行的尾巴（半行） */
  let buffer = ''
  /** 当前事件块攒下的 data 行 */
  let dataLines: string[] = []
  /** 有没有 data 行 —— 只有 keep-alive 的块不该吐空事件 */
  let hasData = false

  function dispatch(out: SseEvent[]): void {
    if (hasData) out.push({ data: dataLines.join('\n') })
    dataLines = []
    hasData = false
  }

  function consumeLine(rawLine: string, out: SseEvent[]): void {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line === '') {
      dispatch(out)
      return
    }
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    if (field !== 'data') return
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    dataLines.push(value)
    hasData = true
  }

  return {
    feed(chunk: string): SseEvent[] {
      const out: SseEvent[] = []
      buffer += chunk
      let nl = buffer.indexOf('\n')
      while (nl >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        consumeLine(line, out)
        nl = buffer.indexOf('\n')
      }
      return out
    },
    end(): SseEvent[] {
      const out: SseEvent[] = []
      if (buffer !== '') {
        const tail = buffer
        buffer = ''
        consumeLine(tail, out)
        // 残留的**不是空行**，所以块还没结束：下面的 dispatch 负责收尾
      }
      dispatch(out)
      return out
    }
  }
}

/**
 * 一条 data 的三种命运：
 *   · `done`   —— 服务端说完了（`[DONE]`）；
 *   · `delta`  —— 正文增量（**空字符串不算**，那是保活帧）；
 *   · `ignore` —— 认不出来。**不抛、不当作错误**：流里偶尔夹一条
 *                 我们没见过的帧（心跳、新的字段、代理塞的注释），
 *                 为此把整条流判死，用户看到的是"说到一半自己停了"。
 */
export type SsePayload =
  | { kind: 'delta'; text: string }
  /**
   * 思考增量（`delta.reasoning_content`）。**不进正文**，但它证明"流是活的"。
   *
   * 【为什么要单列一档】带思考的模型（本项目实测 `deepseek-flash` 的
   * `effort.default_level = high`）会先吐一段思考、再吐正文。若把思考帧当
   * `ignore`，上层"首字 20s 闸"就看不到任何动静 —— 思考一长就被误判成超时，
   * 用户看到的是"等太久"，而模型其实一直在干活。
   */
  | { kind: 'reasoning' }
  | { kind: 'done' }
  | { kind: 'ignore' }

/**
 * 把一条 data 翻译成动作。
 *
 * 【为什么 `role` 首帧要 ignore】OpenAI 兼容流的第一条帧通常只带
 * `delta:{role:'assistant'}`、没有 content。把它当"空回复"会让上层误判
 * "AI 什么都没说"，而它其实只是开场白。
 *
 * 【finish_reason 帧同理】它也没有 content，只是通知结束；
 * 真正的结束以 `[DONE]` 为准。
 */
export function readSsePayload(data: string): SsePayload {
  const raw = data.trim()
  if (raw === '') return { kind: 'ignore' }
  if (raw === SSE_DONE) return { kind: 'done' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: 'ignore' }
  }
  const choices = (parsed as { choices?: unknown } | null)?.choices
  if (!Array.isArray(choices) || choices.length === 0) return { kind: 'ignore' }
  const delta = (choices[0] as { delta?: { content?: unknown; reasoning_content?: unknown } } | null)
    ?.delta
  const text = delta?.content
  if (typeof text === 'string' && text !== '') return { kind: 'delta', text }
  // 正文为空、但有思考增量：活着的证据，交给上层"续命"，不往界面吐
  const reasoning = delta?.reasoning_content
  if (typeof reasoning === 'string' && reasoning !== '') return { kind: 'reasoning' }
  return { kind: 'ignore' }
}
