/**
 * chat.json 清洗与追加的靶向单测。
 *
 * 【这层为什么值得测】它是"用户数据"那一侧的唯一闸门：文件被手改、
 * 版本漂移、单条形状不对，都在这里被挡。挡得好 = 历史还在；
 * 挡得差 = 用户的对话记录被静默清零，而界面什么都不会说。
 */
import { describe, expect, it } from 'vitest'
import {
  AI_CHAT_CAP,
  AI_CHAT_MAX_CONTENT_CHARS,
  appendChatMessage,
  clearChatFile,
  CURRENT_AI_CHAT_VERSION,
  emptyChatFile,
  normalizeChatFile
} from '../ai-chat'

const msg = (content: string, role: 'user' | 'assistant' = 'user') => ({ role, content })

describe('normalizeChatFile：坏文件不许把整份历史带走', () => {
  it('null / 数组 / 字符串 → 空结构', () => {
    for (const bad of [null, undefined, [], 'x', 42]) {
      expect(normalizeChatFile(bad)).toEqual(emptyChatFile())
    }
  })

  it('版本对不上 → 空结构（不猜、不迁移）', () => {
    const raw = { version: CURRENT_AI_CHAT_VERSION + 1, messages: [msg('hi')] }
    expect(normalizeChatFile(raw).messages).toEqual([])
  })

  it('单条形状不对只丢那一条，其余照留', () => {
    const raw = {
      version: CURRENT_AI_CHAT_VERSION,
      messages: [
        msg('留下的'),
        { role: 'system', content: '不该有的角色' },
        { role: 'user' },
        { role: 'user', content: '   ' },
        { content: '没角色' },
        'not an object',
        msg('也留下', 'assistant')
      ]
    }
    expect(normalizeChatFile(raw).messages).toEqual([msg('留下的'), msg('也留下', 'assistant')])
  })

  it('超长单条被截断（上限按条数算，拦不住一条巨无霸）', () => {
    const raw = { version: CURRENT_AI_CHAT_VERSION, messages: [msg('x'.repeat(50_000))] }
    expect(normalizeChatFile(raw).messages[0].content.length).toBe(AI_CHAT_MAX_CONTENT_CHARS)
  })

  it('超过上限的旧文件读回来只留最后 200 条', () => {
    const messages = Array.from({ length: AI_CHAT_CAP + 20 }, (_v, i) => msg(`m${i}`))
    const file = normalizeChatFile({ version: CURRENT_AI_CHAT_VERSION, messages })
    expect(file.messages).toHaveLength(AI_CHAT_CAP)
    expect(file.messages[file.messages.length - 1].content).toBe(`m${AI_CHAT_CAP + 19}`)
  })
})

describe('appendChatMessage：追加与淘汰', () => {
  it('从 null 起也能追加（首次使用）', () => {
    const file = appendChatMessage(null, msg('你好'))
    expect(file).toEqual({ version: CURRENT_AI_CHAT_VERSION, messages: [msg('你好')] })
  })

  it('追加不改入参（调用方那份还要当旧值用）', () => {
    const base = { version: CURRENT_AI_CHAT_VERSION, messages: [msg('a')] }
    const next = appendChatMessage(base, msg('b', 'assistant'))
    expect(base.messages).toEqual([msg('a')])
    expect(next.messages).toEqual([msg('a'), msg('b', 'assistant')])
  })

  it('空内容不写（不留空条目污染历史）', () => {
    expect(appendChatMessage(null, msg('  ')).messages).toEqual([])
  })

  it('超上限丢最旧的', () => {
    let file = emptyChatFile()
    for (let i = 0; i < AI_CHAT_CAP + 5; i++) file = appendChatMessage(file, msg(`m${i}`))
    expect(file.messages).toHaveLength(AI_CHAT_CAP)
    expect(file.messages[0].content).toBe('m5')
  })

  it('落盘前截断单条正文', () => {
    const file = appendChatMessage(null, msg('y'.repeat(20_000)))
    expect(file.messages[0].content.length).toBe(AI_CHAT_MAX_CONTENT_CHARS)
  })

  it('clearChatFile 只抹列表、保留版本', () => {
    expect(clearChatFile()).toEqual({ version: CURRENT_AI_CHAT_VERSION, messages: [] })
  })
})
