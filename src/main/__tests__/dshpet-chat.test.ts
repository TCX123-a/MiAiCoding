import { describe, expect, it } from 'vitest'
import { createPetChatService, type PetChatServiceDeps } from '../dshpet/chat'
import { PET } from '../../shared/copy'
import {
  PET_CHAT_MAX_CHARS,
  PET_CHAT_MAX_MESSAGES,
  PET_CHAT_REPLY_TOKENS,
  approxPetTokens,
  type PetChatGate,
  type PetChatMessage
} from '../../shared/pet'
import type { AiFailReason, AiResult } from '../../shared/types'

/**
 * 聊天编排层（main/dshpet/chat.ts）的单测 —— 2026-10-06 晚「聊天补迁」批次。
 *
 * 【假什么、不假什么】gate/commit/memoryBlock/say/isOnline/chat 六个依赖全是
 * 注入的假货（chat 用一条应答队列，测试逐条喂）；**不假**的是 shared/pet.ts
 * 的清洗器与 copy.ts 的台词 —— 那些正是被测对象要消费的真源（同 brain 测试
 * 的口径：假掉它们等于测两个 mock 之间的对话）。
 *
 * 【反向判据为什么占一半】护栏/断网/失败分档的真正承诺是"**不**发生"：
 * 被拦下的一轮不许发请求、不许记账、不许进历史。只断言"说了哪句话"是假绿 ——
 * 把护栏整个删掉（句句都发）那些断言照样绿。所以每条拦截线都同时钉
 * calls / commits / historyLength 三个零。
 *
 * 【一处没测的分支（如实记录）】handle 里 sanitize 返回 null 的 tripwire
 * （log + bad-request）在当前代码下**不可达**：内存历史只有本文件在写、
 * 形状自证合法，且 deepseek.extractContent 保证成功回复非空（空内容按
 * bad-response 失败）—— 想构造它只能靠假 chat 塞空 data，那会把
 * "气泡说空话"这种不该存在的行为钉成预期。守它的判据在 deepseek 层
 * （extractContent 的 empty content 分支），不在这里重复。
 *
 * 【字符串纪律】本文件在 src/ 下：注释随便写中文，**字符串字面量**一律
 * 引用 copy.ts 常量或 ASCII（对话内容用 'msg-1' 这类即可，与逻辑无关）。
 */

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

interface Harness {
  svc: ReturnType<typeof createPetChatService>
  says: { text: string; tag: string }[]
  commits: number[]
  logs: string[]
  calls: { messages: PetChatMessage[]; memory: string }[]
  setGate: (g: PetChatGate) => void
  setOnline: (v: boolean) => void
  setMemory: (m: string) => void
  pushReply: (r: AiResult<string>) => void
}

/** 一台受控聊天服务：应答队列 + 可拨的护栏/断网/记忆旋钮 */
function makeChat(): Harness {
  const says: { text: string; tag: string }[] = []
  const commits: number[] = []
  const logs: string[] = []
  const calls: { messages: PetChatMessage[]; memory: string }[] = []
  const replies: AiResult<string>[] = []
  let gate: PetChatGate = 'ok'
  let online = true
  let memory = ''

  const deps: PetChatServiceDeps = {
    gate: () => gate,
    commit: (t) => commits.push(t),
    memoryBlock: () => memory,
    say: (text, tag) => says.push({ text, tag }),
    isOnline: () => online,
    chat: (input) => {
      calls.push(clone(input))
      const next = replies.shift()
      // 队列空 = 测试自己忘了喂应答：给一条合法的失败，跑挂在哪条断言上一目了然
      return Promise.resolve(next ?? { ok: false, reason: 'server' })
    },
    log: (line) => logs.push(line)
  }

  return {
    svc: createPetChatService(deps),
    says,
    commits,
    logs,
    calls,
    setGate: (g) => {
      gate = g
    },
    setOnline: (v) => {
      online = v
    },
    setMemory: (m) => {
      memory = m
    },
    pushReply: (r) => {
      replies.push(r)
    }
  }
}

// ---------------------------------------------------------------- 正常一轮

describe('正常一轮：清洗 → 调模型 → 记账 → 气泡', () => {
  it('成功：气泡说回复、commit 一次（口径 = 送出内容 + 回复上限开销）、历史 +2', async () => {
    const h = makeChat()
    h.pushReply({ ok: true, data: 'reply-1' })
    const res = await h.svc.handle('hello there')
    expect(res).toEqual({ ok: true })
    expect(h.says).toEqual([{ text: 'reply-1', tag: 'chat' }])
    expect(h.calls.length).toBe(1)
    expect(h.calls[0].messages).toEqual([{ role: 'user', content: 'hello there' }])
    expect(h.calls[0].memory).toBe('')
    expect(h.commits).toEqual([approxPetTokens('hello there') + PET_CHAT_REPLY_TOKENS])
    expect(h.svc.historyLength()).toBe(2)
  })

  it('第二轮：历史（user + assistant）原样带回，memory 每次现读', async () => {
    const h = makeChat()
    h.setMemory('MEM-A')
    h.pushReply({ ok: true, data: 'reply-1' })
    h.pushReply({ ok: true, data: 'reply-2' })
    await h.svc.handle('msg-1')
    h.setMemory('MEM-B')
    await h.svc.handle('msg-2')
    expect(h.calls[1].messages).toEqual([
      { role: 'user', content: 'msg-1' },
      { role: 'assistant', content: 'reply-1' },
      { role: 'user', content: 'msg-2' }
    ])
    expect(h.calls[0].memory).toBe('MEM-A')
    expect(h.calls[1].memory).toBe('MEM-B')
  })

  it('输入先 trim；超长截到 PET_CHAT_MAX_CHARS（v1 清洗器口径）', async () => {
    const h = makeChat()
    h.pushReply({ ok: true, data: 'reply-1' })
    await h.svc.handle('  ' + 'a'.repeat(500) + '  ')
    expect(h.calls[0].messages[0].content).toBe('a'.repeat(PET_CHAT_MAX_CHARS))
  })

  it('历史封顶 12 条：超出从最老的丢（第一个被挤掉的是最早那条 user）', async () => {
    const h = makeChat()
    for (let i = 1; i <= 7; i++) {
      h.pushReply({ ok: true, data: 'reply-' + i })
      await h.svc.handle('msg-' + i)
    }
    expect(h.svc.historyLength()).toBe(PET_CHAT_MAX_MESSAGES)
    const sent = h.calls[6].messages
    expect(sent.length).toBe(PET_CHAT_MAX_MESSAGES)
    expect(sent[0]).toEqual({ role: 'assistant', content: 'reply-1' }) // msg-1 的 user 已被丢
    expect(sent[sent.length - 1]).toEqual({ role: 'user', content: 'msg-7' })
  })
})

// ---------------------------------------------------------------- 三道护栏

describe('三道护栏：各自台词、不发请求、不记账', () => {
  const cases: { gate: PetChatGate; line: string }[] = [
    { gate: 'cooldown', line: PET.CHAT_BUSY },
    { gate: 'daily', line: PET.CHAT_DAILY_LIMIT },
    { gate: 'tokens', line: PET.CHAT_TOKEN_LIMIT }
  ]
  for (const c of cases) {
    it(c.gate + '：气泡说对应台词，chat 一次都不调、commit 零', async () => {
      const h = makeChat()
      h.setGate(c.gate)
      const res = await h.svc.handle('msg-1')
      expect(res).toEqual({ ok: true })
      expect(h.says).toEqual([{ text: c.line, tag: 'chat-gate' }])
      expect(h.calls.length).toBe(0)
      expect(h.commits.length).toBe(0)
      expect(h.svc.historyLength()).toBe(0)
    })
  }

  it('护栏是**每次现读**：挂起期间放开，下一句就能聊', async () => {
    const h = makeChat()
    h.setGate('cooldown')
    await h.svc.handle('msg-1')
    h.setGate('ok')
    h.pushReply({ ok: true, data: 'reply-1' })
    await h.svc.handle('msg-2')
    expect(h.calls.length).toBe(1)
  })
})

// ---------------------------------------------------------------- 断网

describe('断网：连请求都不发（不要 30s 超时干等）', () => {
  it('isOnline=false：说 offline 台词、chat 零调用、commit 零', async () => {
    const h = makeChat()
    h.setOnline(false)
    const res = await h.svc.handle('msg-1')
    expect(res).toEqual({ ok: true })
    expect(h.says).toEqual([{ text: PET.CHAT_FAIL['offline'], tag: 'chat-fail' }])
    expect(h.calls.length).toBe(0)
    expect(h.commits.length).toBe(0)
  })
})

// ---------------------------------------------------------------- 失败分档

describe('失败分档：每个 reason 都说人话抱怨，且不吃额度、不进历史', () => {
  const reasons = Object.keys(PET.CHAT_FAIL) as AiFailReason[]

  for (const reason of reasons) {
    it(reason + '：台词 = PET.CHAT_FAIL 对应档，commit 零、历史零', async () => {
      const h = makeChat()
      h.pushReply({ ok: false, reason })
      const res = await h.svc.handle('msg-1')
      expect(res).toEqual({ ok: true }) // 失败也回 ok：dsh-pet 的弹窗要安静关闭
      expect(h.says).toEqual([{ text: PET.CHAT_FAIL[reason], tag: 'chat-fail' }])
      expect(h.commits.length).toBe(0)
      expect(h.svc.historyLength()).toBe(0)
    })
  }

  it('失败不锁门：同句立刻重试，成功那轮照常记账、历史从这一轮开始', async () => {
    const h = makeChat()
    h.pushReply({ ok: false, reason: 'timeout' })
    h.pushReply({ ok: true, data: 'reply-1' })
    await h.svc.handle('msg-1')
    await h.svc.handle('msg-1')
    expect(h.says.map((s) => s.tag)).toEqual(['chat-fail', 'chat'])
    expect(h.commits.length).toBe(1)
    expect(h.svc.historyLength()).toBe(2)
    // 重试那轮送给模型的上下文里没有失败轮的影子（历史只在成功时推进）
    expect(h.calls[1].messages).toEqual([{ role: 'user', content: 'msg-1' }])
  })
})

// ---------------------------------------------------------------- 协议坏

describe('协议坏（bad-request）：走红字通道，不冒泡不记账（唯一不许藏进气泡的失败）', () => {
  it('非字符串 / 空白串：回 bad-request、气泡零、chat 零', async () => {
    const h = makeChat()
    for (const bad of [42, null, undefined, {}, ['x'], true, '', '   ']) {
      expect(await h.svc.handle(bad)).toEqual({ ok: false, reason: 'bad-request' })
    }
    expect(h.says).toEqual([])
    expect(h.calls.length).toBe(0)
    expect(h.commits.length).toBe(0)
  })

  it('协议检查先于护栏：坏输入 + 冷却中 → 仍是 bad-request（不许拿护栏台词盖住真 bug）', async () => {
    const h = makeChat()
    h.setGate('daily')
    expect(await h.svc.handle('')).toEqual({ ok: false, reason: 'bad-request' })
    expect(h.says).toEqual([])
  })
})
