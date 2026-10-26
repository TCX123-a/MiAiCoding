/**
 * `stores/aiChat.send()` 的**入参形状闸门**。
 *
 * 【为什么值得单独一条测试】2026-10-25 的真事故：`messages.value` 是 Vue 的
 * 响应式数组，里面是 Proxy；IPC 入参要过结构化克隆，`structuredClone(proxy)`
 * 直接抛 `DataCloneError`。表现是**点了发送什么都没发生** ——
 * 主进程一次请求都没收到，界面也没有任何提示，靠读代码几乎看不出来。
 *
 * 所以这条测试只钉两件事，而且都是那次事故的直接反面：
 *   ① 交给 `window.miai.aiChatStart` 的入参**必须能被 structuredClone**（纯数据）；
 *   ② `requestId` 必须**出发前就已经定了**（否则增量可能比回话先到，被当成别人的丢掉）。
 *
 * 它不测网络、不测 UI —— 那两个在 `main/ai/__tests__/chat-stream.test.ts` 里。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAiChatStore } from '../aiChat'
import type { AiChatStartInput } from '../../../../shared/types'

/** 主进程回话的假实现：把入参扣下来，供断言 */
let captured: AiChatStartInput | null = null
let accepted = true
const noop = (): void => {}

beforeEach(() => {
  setActivePinia(createPinia())
  captured = null
  accepted = true
  // 只放 store 真正用到的那几个口子；多一个都不给，缺了就会当场报错
  ;(globalThis as unknown as { window: unknown }).window = {
    miai: {
      onAiChatDelta: () => noop,
      onAiChatDone: () => noop,
      aiChatStart: async (input: AiChatStartInput) => {
        captured = input
        return { requestId: input.requestId ?? 'generated', accepted }
      },
      aiCancel: async () => {},
      getChatHistory: async () => ({ messages: [] }),
      clearChat: async () => {}
    }
  }
})

describe('aiChat.send：发给主进程的东西必须是纯数据', () => {
  it('入参可被 structuredClone（响应式数组会在这里抛 DataCloneError）', async () => {
    const ai = useAiChatStore()
    ai.draft = '这段报错什么意思？'
    await ai.send({ code: 'print(1)', lang: 'python' })

    expect(captured, '主进程一个请求都没收到 —— 多半是入参在克隆那一步就炸了').not.toBeNull()
    // ★ 这条就是那次事故的复现点
    expect(() => structuredClone(captured)).not.toThrow()
  })

  it('只带用户说过的话：不含那条空的 assistant 占位', async () => {
    const ai = useAiChatStore()
    ai.draft = '你好'
    await ai.send({})
    expect(captured?.messages).toEqual([{ role: 'user', content: '你好' }])
  })

  it('requestId 在出发前就定了，且与 preload 回话里的一致', async () => {
    const ai = useAiChatStore()
    ai.draft = '你好'
    await ai.send({})
    expect(typeof captured?.requestId).toBe('string')
    expect((captured?.requestId ?? '').length).toBeGreaterThan(0)
    expect(ai.requestId).toBe(captured?.requestId)
  })

  it('上下文原样带上（代码 / 语言 / 选区 / 运行输出 / 术语）', async () => {
    const ai = useAiChatStore()
    ai.draft = '看看'
    await ai.send({
      code: 'int main(){}',
      lang: 'c',
      selection: { text: 'int main(){}', fromLine: 1, toLine: 1 },
      runOutput: 'error: x',
      terms: [{ key: 'k', originals: ['函数'], cat: '函数=技能/招式', example: '' }]
    })
    expect(captured?.context).toMatchObject({
      code: 'int main(){}',
      lang: 'c',
      runOutput: 'error: x'
    })
    expect(captured?.context?.selection?.fromLine).toBe(1)
    expect(captured?.context?.terms).toHaveLength(1)
  })

  it('主进程说没接受（busy/throttled）：撤回那两句、草稿还回来、人话写在 failText', async () => {
    accepted = false
    const ai = useAiChatStore()
    ai.draft = '回头再问'
    await ai.send({})
    expect(ai.messages).toHaveLength(0)
    expect(ai.draft).toBe('回头再问')
    expect(ai.streaming).toBe(false)
    expect(ai.failText).toBeTruthy()
  })
})
