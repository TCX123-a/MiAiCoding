/**
 * `chat.json` 的**形状、清洗与追加** —— 纯函数，不碰文件系统、不碰 Electron
 * （落盘由 app.ts 用 `createJsonStore` 接上，原子写 / .bak 那一套照旧）。
 *
 * 【为什么对话历史要落盘，而 AI 出的题只缓存不持久化】
 * 出题是"用一次就完"的产物，缓存它只是省钱；对话是**主人自己的上下文**——
 * 关掉软件再打开，他期待刚才那段还没聊完的解释还在（docs/27 §7 把"会话历史"
 * 列进了 P1 范围）。所以它进的是"用户数据"，不是"缓存"。
 *
 * 【为什么不进 AI 缓存（ai-cache.json）】
 * docs/27 §10 写死了：对话**不写入** ai-cache。那个文件按 prompt 哈希存
 * 一题一题的 JSON，键短、命中率高；对话是长文本、几乎不会命中，
 * 写进去只会把出题缓存挤出去（上限 200 条）。
 *
 * 【解析失败怎么办】
 * 铁律 6 的精神：**不许静默重建**。这里返回空结构，但把「为什么」交给调用方
 * 记日志 —— 清洗函数是纯的，它不该自己 console。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律英文**，中文只出现在注释里。
 */
import type { AiChatMessage } from '../../shared/types'

/** `chat.json` 的 schema 版本。改结构就 bump + 写迁移（铁律 6） */
export const CURRENT_AI_CHAT_VERSION = 1

/**
 * 最多留多少条消息（docs/27 §13.4 的候选值：200 条）。
 *
 * 【为什么是按"条"而不是按"轮"或"天"】条数直接对应文件大小与提示词成本，
 * 而轮数会被"一条超长消息"绕过 —— 上限得钉在**真正会增长的那个维度**上。
 * 200 条 ≈ 一百轮对话，正常使用一周也到不了；到不了就说明它只在防"永远不清理"。
 */
export const AI_CHAT_CAP = 200

/**
 * 单条正文最多留多少字符。
 *
 * 【为什么落盘也要截】上限按条数算，一条就能绕过它：有人把整份代码粘进来，
 * 一条几十万字，200 条就是几十兆。截断在**写入的那一侧**做，
 * 读回来的一定是已经截过的，界面上不会出现"历史里那句被吞了一半"的错觉
 * （它本来就在输入框里看得见全文）。
 */
export const AI_CHAT_MAX_CONTENT_CHARS = 8000

export interface AiChatFile {
  version: number
  messages: AiChatMessage[]
}

export function emptyChatFile(): AiChatFile {
  return { version: CURRENT_AI_CHAT_VERSION, messages: [] }
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x)
}

/**
 * 把磁盘上读到的任意东西洗成可用的文件。
 *
 * 只保留**结构上成立**的条目：role 必须是 user/assistant、content 必须是非空字符串。
 * 单条坏掉就丢那一条，不丢整个文件 —— 对话历史里丢一句的代价，
 * 比"整个历史清零"小得多（后者会让用户以为软件把他的记录删了）。
 */
export function normalizeChatFile(raw: unknown): AiChatFile {
  if (!isPlainObject(raw)) return emptyChatFile()
  // 版本对不上：不猜、不迁移（P1 只有 v1，将来真改结构时在这里补迁移函数）
  if (raw.version !== CURRENT_AI_CHAT_VERSION) return emptyChatFile()
  const list = Array.isArray(raw.messages) ? raw.messages : []
  const messages: AiChatMessage[] = []
  for (const item of list) {
    if (!isPlainObject(item)) continue
    const role = item.role
    const content = item.content
    if (role !== 'user' && role !== 'assistant') continue
    if (typeof content !== 'string') continue
    const text = content.slice(0, AI_CHAT_MAX_CONTENT_CHARS)
    if (text.trim() === '') continue
    messages.push({ role, content: text })
  }
  return { version: CURRENT_AI_CHAT_VERSION, messages: messages.slice(-AI_CHAT_CAP) }
}

/**
 * 追加一条消息，返回**要落盘的新文件**（不原地改入参：调用方手里那份还得当旧值用）。
 *
 * 【超上限丢最旧的】**丢的是最旧的消息，不是最旧的"会话"** —— P1 只有一个
 * 侧栏会话，没有"会话"这个层级可丢；硬造一个层级只会让"翻不回去"变得不可解释。
 * 这也和 ai-cache 的淘汰方向一致：最近还在用的先留下。
 */
export function appendChatMessage(
  file: AiChatFile | null,
  message: AiChatMessage,
  cap: number = AI_CHAT_CAP
): AiChatFile {
  const base = normalizeChatFile(file)
  const text = message.content.slice(0, AI_CHAT_MAX_CONTENT_CHARS)
  if (text.trim() === '') return base
  const messages = [...base.messages, { role: message.role, content: text }]
  return {
    version: CURRENT_AI_CHAT_VERSION,
    messages: messages.length > cap ? messages.slice(messages.length - cap) : messages
  }
}

/** 清空（保留文件与版本，只把列表抹掉 —— 用户点"清空对话"就是这个语义） */
export function clearChatFile(): AiChatFile {
  return emptyChatFile()
}
