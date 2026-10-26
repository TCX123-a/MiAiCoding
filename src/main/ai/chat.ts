/**
 * AI 侧栏对话的**编排层**（P1，docs/27 §6.2 / §13.2-4）。
 *
 * 【它负责三件事，一件都不多做】
 *   ① 限流：同一会话最小间隔 800ms、连续失败 3 次退避 30s（§8.3）；
 *   ② 上下文拼装：按 §8.4 的顺序把「人设 → 术语 → 代码 → 选区 → 运行输出 → 历史」
 *      拼成一次请求；
 *   ③ 失败原因码：只回 `AiFailReason`，一句中文都不许出现（界面在 copy.ts 翻）。
 *
 * 【它不做什么】
 *   · **不 fetch**：走 `deepseek.ts` 注入的 `AiDeps.fetch`。全项目唯一会联网的
 *     文件只有那一个，这条纪律破了，Key 的隔离边界就没了（§3.4）；
 *   · **不落盘**：历史写盘在 `store/ai-chat.ts`，编排层只管"这一次请求"；
 *   · **不管并发**：`aiInflight` 的那张 Map 在 app.ts（它才看得见 IPC 生命周期）。
 *
 * 【零中文】本文件在 `src/` 下、被文案闸门扫：字符串一律 ASCII，
 * 提示词里的中文全部来自 `shared/copy.ts` 的 `AI_CHAT_PROMPT`。
 */
import type {
  AiChatContext,
  AiChatStartInput,
  AiFailReason,
  AiResult,
  AppConfig,
  GlossaryTerm
} from '../../shared/types'
import { AI_CHAT_PROMPT, langName } from '../../shared/copy'
import { renderGlossary, truncateLines } from '../../shared/ai-prompt'
import { streamChat, type FetchLike } from './deepseek'

// ---------------------------------------------------------------- 参数

/**
 * 同一会话两次发送之间的最小间隔（docs/27 §8.3）。
 * 防的是连点：每一次点击都是一次真金白银的请求。
 */
export const CHAT_MIN_INTERVAL_MS = 800

/** 连续失败多少次开始退避 */
export const CHAT_BACKOFF_AFTER = 3

/** 退避时长。取 30 秒：够让"手抖连点"的人停下来，又不至于像坏了 */
export const CHAT_BACKOFF_MS = 30_000

/**
 * 历史带几轮。
 *
 * 【为什么是 10 条消息（≈5 轮）】每一轮都算 input token，而主人的问题通常
 * 只和上一两条有关；带太多既贵又容易让模型跑题。真要追问很早以前的内容，
 * 上下文里的「当前代码」通常已经把它说清楚了。
 */
export const CHAT_HISTORY_MAX_MESSAGES = 10

/** 单条历史消息最多留多少字符（防止一次粘贴把整个窗口顶掉） */
export const CHAT_MESSAGE_MAX_CHARS = 4000

/** 代码最多带多少行（两头留、中间省略，理由同 ai-prompt 的 truncateLines） */
export const CHAT_CODE_MAX_LINES = 120
const CHAT_CODE_HEAD_LINES = 80

/** 运行输出最多带多少行 */
export const CHAT_RUN_OUTPUT_MAX_LINES = 40
const CHAT_RUN_OUTPUT_HEAD_LINES = 20

/**
 * 对话的温度。**取 1.0**（与讲报错同档）：这是要照着改代码的回答，
 * 温度再高就开始"差不多这样写吧"，而桌宠用的 1.3 只适合 40 字闲聊。
 */
export const TEMP_CHAT = 1.0

/**
 * 一次回答的输出上限。
 *
 * 【为什么是 2048】侧栏要能给完整代码片段，512 那种预算会把它拦腰截断；
 * 但 8192（出题档）意味着一次能烧掉出题两倍的钱，而对话并不需要 20 道题的量。
 * 2048 ≈ 一千多个汉字 + 一段代码，正好是"讲清一个问题"的体量。
 */
const MAX_TOKENS_CHAT = 2048

// ---------------------------------------------------------------- 限流闸门

/**
 * 限流闸门。**状态是闭包里的，不是模块级的** —— 模块级状态在测试里最难查：
 * 跑单个用例绿，整个文件一起跑就红（前一个用例把退避计时器留下了）。
 */
export interface ChatGate {
  /**
   * 想开一条新请求：放行返回 `null`，挡下返回原因码。
   * 放行时**当场记账**（lastStartAt = now），所以连点第二下必然被挡。
   */
  tryStart(now: number): AiFailReason | null
  /** 一次请求真的结束了（成功 / 失败 / 取消）之后回报，喂退避状态 */
  noteResult(outcome: 'ok' | 'fail' | 'cancel', now: number): void
  /** 只给测试与排查用：看一眼当前状态 */
  state(): { consecutiveFailures: number; backoffUntil: number; lastStartAt: number }
}

export function createChatGate(opts?: {
  minIntervalMs?: number
  backoffAfter?: number
  backoffMs?: number
}): ChatGate {
  const minIntervalMs = opts?.minIntervalMs ?? CHAT_MIN_INTERVAL_MS
  const backoffAfter = opts?.backoffAfter ?? CHAT_BACKOFF_AFTER
  const backoffMs = opts?.backoffMs ?? CHAT_BACKOFF_MS

  let lastStartAt = 0
  let consecutiveFailures = 0
  let backoffUntil = 0

  return {
    tryStart(now: number): AiFailReason | null {
      // 退避窗优先报：它比"间隔太快"更值得让用户知道（要等半分钟，不是等一下）
      if (now < backoffUntil) return 'throttled'
      // lastStartAt === 0 表示"从没发过"，不能被当成"刚发过"
      if (lastStartAt !== 0 && now - lastStartAt < minIntervalMs) return 'throttled'
      lastStartAt = now
      return null
    },
    noteResult(outcome: 'ok' | 'fail' | 'cancel', now: number): void {
      if (outcome === 'ok') {
        consecutiveFailures = 0
        backoffUntil = 0
        return
      }
      // 取消是用户自己的意志，**不算失败**，也不清零 —— 清零会让
      // "连点取消"这类操作把真实故障计数洗掉（故障还在，只是没被看见）
      if (outcome === 'cancel') return
      consecutiveFailures += 1
      if (consecutiveFailures >= backoffAfter) backoffUntil = now + backoffMs
    },
    state: () => ({ consecutiveFailures, backoffUntil, lastStartAt })
  }
}

// ---------------------------------------------------------------- 上下文拼装

export type ChatTurn = { role: 'system' | 'user' | 'assistant'; content: string }

/** 用三引号围栏包一段原文。围栏本身是 ASCII，不带语言标记（模型不需要） */
function fence(body: string): string {
  return '```\n' + body + '\n```'
}

/**
 * 把只读上下文渲染成一段文字。**没有一项可带时返回 null**（整段不出现），
 * 而不是留一句"没有上下文"的空话 —— 空段落会让模型以为我们忘了给。
 */
export function buildContextBlock(context: AiChatContext | undefined): string | null {
  if (!context) return null
  const sections: string[] = []

  const code = (context.code ?? '').trim()
  if (code !== '') {
    const lang = context.lang ? langName(context.lang) : ''
    sections.push(
      [
        context.lang ? AI_CHAT_PROMPT.CODE_TITLE(lang) : AI_CHAT_PROMPT.CODE_TITLE('-'),
        fence(truncateLines(code, CHAT_CODE_MAX_LINES, CHAT_CODE_HEAD_LINES))
      ].join('\n')
    )
  }

  const selection = context.selection
  const selectionText = (selection?.text ?? '').trim()
  if (selection && selectionText !== '') {
    sections.push(
      [
        AI_CHAT_PROMPT.SELECTION_TITLE(selection.fromLine, selection.toLine),
        fence(truncateLines(selectionText, CHAT_CODE_MAX_LINES, CHAT_CODE_HEAD_LINES))
      ].join('\n')
    )
  }

  const runOutput = (context.runOutput ?? '').trim()
  if (runOutput !== '') {
    sections.push(
      [
        AI_CHAT_PROMPT.RUN_OUTPUT_TITLE,
        fence(truncateLines(runOutput, CHAT_RUN_OUTPUT_MAX_LINES, CHAT_RUN_OUTPUT_HEAD_LINES))
      ].join('\n')
    )
  }

  if (sections.length === 0) return null
  return [AI_CHAT_PROMPT.CONTEXT_TITLE, ...sections].join('\n\n')
}

/** 术语表那一段（标题 + 全表）。**与出题/讲报错同一份渲染器**，三处不可能漂 */
function glossaryBlock(terms: GlossaryTerm[] | undefined): string | null {
  if (!terms || terms.length === 0) return null
  return [AI_CHAT_PROMPT.GLOSSARY_TITLE, renderGlossary(terms)].join('\n\n')
}

/**
 * 拼出真正要发出去的 messages。**纯函数** —— 提示词是没法靠读代码调优的东西，
 * 只有能把它原样打印出来，才谈得上"这次为什么答偏了"。
 *
 * 顺序严格照 docs/27 §8.4：
 *   system = 人设 → 规矩 → 术语表 → 上下文（代码 → 选区 → 运行输出）
 *   user/assistant = 最近 N 条历史（含刚敲的这条）
 *
 * 【为什么上下文进 system 而不是塞进最后一条 user】
 * 它是**环境描述**，不是这一轮说的话。塞进 user 会让模型以为主人在复述代码，
 * 而且下一轮还会被当成"他说过的话"带进历史 —— 越聊越贵、越聊越糊。
 */
export function buildChatMessages(input: AiChatStartInput): ChatTurn[] {
  const history = input.messages
    .slice(-CHAT_HISTORY_MAX_MESSAGES)
    .map((m): ChatTurn => ({
      role: m.role,
      content: m.content.slice(0, CHAT_MESSAGE_MAX_CHARS)
    }))

  const system = [
    AI_CHAT_PROMPT.PERSONA,
    AI_CHAT_PROMPT.RULES,
    glossaryBlock(input.context?.terms),
    buildContextBlock(input.context)
  ]
    .filter((x): x is string => typeof x === 'string' && x !== '')
    .join('\n\n')

  return [{ role: 'system', content: system }, ...history]
}

// ---------------------------------------------------------------- 一次对话

/** 只挑编排层真正要用的两样依赖（同 AiDeps 的形状，方便直接传） */
export interface ChatDeps {
  fetch: FetchLike
  getConfig: () => AppConfig
  signal?: AbortSignal
}

/**
 * 跑一次对话。**唯一出口**：成功给拼接后的全文，失败给原因码。
 *
 * 【入参校验只做一件事：最后一条必须是 user】
 * 其余形状由 app.ts 的 `assertAiChatStart` 在进门前挡掉（"我们自己传错了才抛"）。
 * 这一条留在这里，是因为它决定的是**语义**而不是形状：
 * 一次请求的最后一条不是用户的话，模型会把助手上一句当问题再答一遍。
 */
export async function runChat(
  deps: ChatDeps,
  input: AiChatStartInput,
  onDelta: (delta: string) => void
): Promise<AiResult<string>> {
  const messages = buildChatMessages(input)
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'user') {
    return { ok: false, reason: 'bad-response', detail: 'last message is not user' }
  }
  return streamChat(deps, { messages, temperature: TEMP_CHAT, maxTokens: MAX_TOKENS_CHAT }, onDelta)
}
