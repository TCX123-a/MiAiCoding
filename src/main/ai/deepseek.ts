/**
 * AI 调用（多厂商）—— **全项目唯一会联网的地方**。
 *
 * 2026-11-01 起从「DeepSeek 专用」扩成一张厂商目录（shared/ai-providers.ts）：
 * 设置页选厂商、填 Key，适配层在这里按 `format` 分派到
 * OpenAI 兼容的 `chat/completions` 或 Anthropic 的 `messages`。
 * 文件名保留 deepseek.ts 是历史原因（几十处 import 与测试都指着它），
 * 语义以本段为准。
 *
 * 【为什么单独一层，不直接写在 IPC handler 里】
 * 网络是这个项目里最不可控的东西：断网、超时、401、余额不足、对方服务器抽风。
 * 把这些全部收在一个文件里，好处有三个：
 *   1. `fetch` 是**注入**进来的，测试塞一个假货就能把每条失败分支跑一遍，
 *      不用真的联网、不用 `vi.mock`（全项目零 mock 是条惯例）；
 *   2. 上层拿到的是**结构化的结果**（`AiResult`），不是异常 —— 见 types.ts 里的理由；
 *   3. 想换服务商（任何 OpenAI 兼容接口）只改这一个文件。
 *
 * 【这个文件里不许出现中文】
 * 它在 `src/` 下，会被文案闸门扫。要显示的文案在 copy.ts，
 * 这里只回**原因码**（英文），由界面翻成人话。
 */
import type {
  AppConfig,
  AiBalance,
  AiModelInfo,
  AiResult,
  AiFailReason,
  GlossaryTerm
} from '../../shared/types'
import { buildExplainPrompt, buildQuestionsPrompt, type TopicInput } from '../../shared/ai-prompt'
import { normalizeStem, parseAiQuestions, type AiParseResult } from '../../shared/ai-question'
import type { PoolItem } from '../../shared/challenge'
import { AI_THINKING_PROMPT, PET_PROMPT } from '../../shared/copy'
import type { PetChatMessage } from '../../shared/pet'
import {
  AI_PROVIDERS,
  baseUrlOf,
  isAiProviderId,
  isOpenAiReasoningModel,
  type AiProviderId
} from '../../shared/ai-providers'
import {
  FREE_POOL_BASE,
  FREE_POOL_DEFAULT_MODEL,
  POOL_MODELS_TIMEOUT_MS,
  aiModeOf,
  poolModelOf,
  type AiMode,
  type AiPoolModel
} from '../../shared/free-pool'
import {
  modelsUrlCandidates,
  parseAiModelList,
  prettyAiModelName
} from '../../shared/ai-models'
import {
  isAiThinking,
  planAiThinking,
  planNeedsReasoningHeadroom,
  planReasoningHeadroom,
  recommendedAiThinking,
  type AiThinking,
  type AiThinkingPlan
} from '../../shared/ai-thinking'

// ---------------------------------------------------------------- 依赖注入

/** 只要能读状态码和正文就够了 —— 定这么小是为了让测试里的假货好写 */
export interface HttpResponseLike {
  ok: boolean
  status: number
  text(): Promise<string>
}

export type FetchLike = (url: string, init: RequestInit) => Promise<HttpResponseLike>

export interface AiDeps {
  fetch: FetchLike
  /** 每次现读配置：用户可能在设置页改了 Key / 模型，不该等到重启才生效 */
  getConfig: () => AppConfig
  /**
   * 本次请求的取消信号。**由 main/index.ts 持有**（`ai:cancel` 通道调它的 abort）。
   *
   * 做成参数而不是模块级单例，是为了测试之间不会互相污染 ——
   * 模块级状态在测试里是最难查的一类脏东西：跑单个测试绿，整个文件一起跑就红。
   */
  signal?: AbortSignal
  /**
   * 对 AI 出的 `code` 题做一次本地沙盒复核：返回 `false` 就**丢弃这道题**。
   *
   * 【为什么必须由主进程注入】判断一段代码真正输出什么，只能交给本机编译器/
   * 解释器；而「怎么跑」的实现在 runner.ts，AI 层不该自己再起一套进程。
   * 生产接线在 app.ts（用学生点「运行」的同一条 runCode 链路）。
   *
   * **省略 ≠ 放行**：省略时所有 `code` 题都会以 `code-not-verified` 被丢弃
   * （实现见本文件下半段），测试里也只保留 choice/fill。这样「没验过」永远
   * 不会变成「端给用户」——宁可少一道题，也不破这条规矩。
   *
   * 复核**失败/抛错/超时**一律按「不通过」处理。
   */
  verifyCode?: (item: PoolItem) => Promise<boolean>
}

// ---------------------------------------------------------------- 参数

/** 一次请求最多等多久。30 秒是「用户还愿意盯着看」和「大模型偶尔就是慢」的折中 */
export const AI_TIMEOUT_MS = 30_000

/**
 * 出题请求的超时。**比聊天长得多，这不是随便放宽**。
 *
 * 聊天一次只吐一两段话；出题一次要吐 20 道题的完整 JSON（max_tokens 8192）。
 * 30 秒在真实网络下根本不够 —— 模型还在慢悠悠地写第 8 道，我们这边已经把
 * 连接掐了，上层拿到的就是 timeout，然后**静默回退本地题库**：用户看到的是
 * 「AI 动态出题好像从来没生效过」，日志里却没有任何报错。这正是 2026-10-21
 * 这批要修的「AI 出题不工作」的另一半原因（前一半是 max_tokens 2048 截断）。
 *
 * 180 秒仍在用户耐心内：抽题界面有明确的「取消」按钮（真的掐断请求），
 * 补题走的是后台静默路径，超时也只是这一批没有补上，不影响做题。
 */
export const QUESTIONS_TIMEOUT_MS = 180_000

/**
 * 出题的温度。
 *
 * 【为什么不设 0】设 0 的话 AI 会变得极其保守，出题千篇一律，而且**猫咪味会掉** ——
 * 语气这种东西本来就是采样出来的。实测 0 的时候它更爱说「该程序将输出……」。
 *
 * 【为什么不设 1.3】DeepSeek 官方对「通用对话」推荐 1.3，但那是聊天场景。
 * 出题是**要严格 JSON** 的活儿，温度一高就开始漂：选项给三个、answer 越界、
 * 中文字段名。1.0 是两边的折中。
 *
 * ⚠️ 这个值是**根据文档推的，不是实测定的**。第 3 步会用真实调用对比几个取值，
 * 哪个好就改成哪个，并且把对比结果写进这里。
 */
export const TEMP_QUESTIONS = 1.0

/** 讲报错的温度。这个任务不需要花样，但要保住语气，同样取 1.0 */
export const TEMP_EXPLAIN = 1.0

/**
 * 桌宠聊天的温度。**这里才用得上官方推荐的 1.3**（「通用对话」档）。
 *
 * 【为什么敢比出题高】出题是严格 JSON，温度一高就漂（见 TEMP_QUESTIONS）；
 * 聊天是自由文本，温度高恰好是优点 —— 桌宠要的就是每次回话都不太一样的那点
 * 灵气。40 字短回复本来就没多少"漂"的空间。
 */
export const TEMP_PET = 1.3

/**
 * 出题的输出上限。
 *
 * 【为什么是 8192，不是 2048】每日挑战一次要 20 道题（CHALLENGE_AI_BLOCK），
 * 每道题带选项和 30~120 字解析，实测 2048 会把 JSON **从中间截断** ——
 * `finish_reason=length`，解析失败，一道都收不下，界面于是静默退回本地题库。
 * 2026-10-21 用真实 Key 复现过：2048 截断、8192 能完整返回 20 道。
 * deepseek-chat 的输出上限本身是 8192，写这个数不会越界。
 */
const MAX_TOKENS_QUESTIONS = 8192

/** 讲报错要求 200 字以内，512 足够；给多了它会开始长篇大论 */
const MAX_TOKENS_EXPLAIN = 1024

/**
 * 桌宠回话的输出上限。人设要求 40 字以内（≈80 token），200 是两倍余量 ——
 * 给到 1024 的话，偶发的人设漂移会变成一段谁也读不完的客服腔。
 */
const MAX_TOKENS_PET = 200

/** 测试连接只要一个字的回复 */
const MAX_TOKENS_PING = 8

/**
 * 免费池的推理余量。池里有些模型会先把预算花在 reasoning 上再吐正文；
 * 不给余量的话，测连接（8 token）和桌宠（200 token）都会拿到空正文，
 * 表现成「连不上」—— 那是个查错方向的假故障。
 */
const POOL_REASONING_HEADROOM = 1024

/**
 * Ceiling for the new providers whose output limits are far above ours
 * (Gemini 2.5 / GLM-4.7 / Hunyuan Hy3 all allow 64K~128K). A question batch
 * costs 8192 base + 8192 thinking headroom = 16384; clamping at the old 8192
 * would throw the headroom away and bring back the truncated-JSON bug the
 * headroom exists to prevent.
 *
 * Deliberately NOT applied to deepseek (8192 hard limit), openai (kept at its
 * existing budget) or custom (an unknown gateway may reject anything above
 * the request's own value).
 */
const API_HEADROOM_CAP = 16384

/**
 * Reasoning models can spend a long time before the first visible token. The
 * ordinary 30s budget was tuned for a chat reply; a reasoning ping that thinks
 * for 40s would be reported as "connection failed" even though the network and
 * key are fine. Questions already have their own 180s budget; this only lifts
 * the short paths (test connection / explain / pet).
 */
const REASONING_TIMEOUT_MS = 60_000

// ---------------------------------------------------------------- 内部工具

function fail(reason: AiFailReason, detail?: string): AiResult<never> {
  return detail === undefined ? { ok: false, reason } : { ok: false, reason, detail }
}

/**
 * 把 baseUrl 拼成 chat/completions。
 *
 * 用户可能填的三种形态（2026-10-31 自定义服务地址支持）：
 *   ① `https://api.deepseek.com`          → 追加 /chat/completions
 *   ② `https://api.deepseek.com/v1/`      → 去掉尾斜杠再追加（OpenAI 兼容写法）
 *   ③ `https://x/v1/chat/completions`     → **已经是一整条端点，原样使用**
 * 第三种是第三方中转/自建网关最常见的给法（面板上直接给一整条 URL）。
 * 不给它这一条，用户粘进来的地址会变成 `.../chat/completions/chat/completions`，
 * 对面回 404，而界面上只能看到「服务地址或模型名不对」—— 找不到真正原因。
 */
function chatUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(base)) return base
  return `${base}/chat/completions`
}

interface ChatMessage {
  /**
   * `assistant` 是 2026-10-06 桌宠聊天加进来的：多轮对话要把模型自己之前的
   * 回复带回上下文，否则每一句都是"第一次聊天"，它会反复自我介绍。
   * 出题/讲报错那两条路径照旧只发 system + user，形状没变。
   */
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatRequest {
  model: string
  messages: ChatMessage[]
  temperature: number
  max_tokens: number
  /** 出题时要求返回 JSON。**提示词里必须出现 json 字样**，否则部分接口直接报错 */
  json?: boolean
}

/** 当前选中的厂商。坏值退回 deepseek —— 与迁移/裁剪的兜底同一方向 */
function activeProvider(cfg: AppConfig): AiProviderId {
  return isAiProviderId(cfg.ai.provider) ? cfg.ai.provider : 'deepseek'
}

/**
 * 当前厂商的 Key。**读的是 apiKeys[provider]，不是某一家的固定字段**；
 * 未来某条读路径漏了迁移、表不在了，也只会退回空串（走 no-key 引导），
 * 而不是抛异常把设置页炸掉。
 */
function activeKey(cfg: AppConfig): string {
  const key = cfg.ai.apiKeys?.[activeProvider(cfg)]
  return typeof key === 'string' ? key.trim() : ''
}

/** 官方厂商用目录里的地址，自定义服务用用户填的 */
function activeBase(cfg: AppConfig): string {
  return baseUrlOf(activeProvider(cfg), cfg.ai.baseUrl)
}

/** 当前接入方式。坏值退回 api —— 与迁移/裁剪的兜底同一方向 */
function activeMode(cfg: AppConfig): AiMode {
  return aiModeOf(cfg.ai.mode)
}

/**
 * 这次请求真正要发出去的模型名。
 *
 * 专属模式 = 用户选的那家模型；免费池模式 = poolModel（远端清单里的 id）。
 * **两套模型名不能混用**：把 `deepseek-chat` 发给免费池只会得到一个 404，
 * 而界面上看起来一切正常。
 *
 * Thinking may switch the model too (deepseek-chat + high -> deepseek-reasoner).
 * That switch must be reflected here, because this value is what the settings
 * page reports as "the model that actually answered" and what the question
 * cache uses as its discriminator.
 */
export function effectiveAiModel(cfg: AppConfig): string {
  return effectiveThinkingPlan(cfg).model
}

/**
 * Cache discriminator: the wire model **plus** the thinking level.
 *
 * The cache key is computed before postChat injects the thinking instruction
 * into the system prompt, so the model alone is not enough: asking the same
 * question with low and high would otherwise return the low-depth answer from
 * cache. The level is part of the key on purpose.
 */
export function aiCacheModelOf(cfg: AppConfig): string {
  const level = currentThinkingLevel(cfg)
  return `${effectiveThinkingPlan(cfg).model}|thinking:${level}`
}

/** Current level for the route on disk. Bad/missing values get the recommendation. */
function currentThinkingLevel(cfg: AppConfig): AiThinking {
  const mode = activeMode(cfg)
  const provider = activeProvider(cfg)
  const model = mode === 'pool' ? poolModelOf(cfg.ai.poolModel) : cfg.ai.model
  return isAiThinking(cfg.ai.thinking)
    ? cfg.ai.thinking
    : recommendedAiThinking(mode, provider, model)
}

/** The plan for the route on disk (used by effectiveAiModel / cache key). */
function effectiveThinkingPlan(cfg: AppConfig): AiThinkingPlan {
  const mode = activeMode(cfg)
  const provider = activeProvider(cfg)
  const model = mode === 'pool' ? poolModelOf(cfg.ai.poolModel) : cfg.ai.model
  return planAiThinking({
    mode,
    provider,
    model,
    level: currentThinkingLevel(cfg)
  })
}

/**
 * Append the thinking instruction to the existing system prompt.
 *
 * Deliberately **does not create** a system message when there is none: the
 * only request without one is the 8-token connection ping, and the persona /
 * persona-adjacent instructions are what this addition must refine. Every real
 * path (questions / explain / pet) already has a system message, so the
 * instruction always lands where the persona lives and cannot replace it.
 */
function withThinkingInstruction(req: ChatRequest, level: AiThinking): ChatRequest {
  const instruction = AI_THINKING_PROMPT[level]
  if (instruction === '') return req
  let applied = false
  const messages = req.messages.map((m) => {
    if (applied || m.role !== 'system') return m
    applied = true
    return { ...m, content: `${m.content}\n\n${instruction}` }
  })
  return applied ? { ...req, messages } : req
}

/** Anthropic 的回复端点（它的 base 已经带 /v1） */
function messagesUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (/\/messages$/i.test(base)) return base
  return `${base}/messages`
}

/**
 * 采样温度的「线材规则」：不是每家都吃我们这几个固定值。
 *
 * 应用里有三个固定温度：出题/讲解 1.0、桌宠 1.3、连通性测试 0。各家的
 * 可接受范围并不一样，原样发出去就是 400 —— 用户看到的是「AI 用不了」，
 * 根本猜不到是温度越界。
 *
 *   · Gemini：2.5 起文档把 sampling 参数标为弃用，3.x 预览对显式
 *     temperature 直接回 400。**不发** = 用模型默认值，所有型号都安全。
 *   · 智谱：官方的 OpenAI 兼容说明把区间写成 **(0,1) 开区间**，官方
 *     zai-sdk 与 LangChain 集成都把上界夹到 0.99。测试用的 0 变成 0.01，
 *     出题/桌宠的 1.0/1.3 变成 0.99 —— 这三个值都在合法区间内。
 *     不夹上界的话，1.3 一定 400；1.0 处在开区间的边界上，官方 SDK 自己
 *     也会改写成 0.99，我们跟着改写，别把边界值赌在服务端实现上。
 *   · 其余 OpenAI 兼容厂商（DeepSeek / OpenAI / Qwen / Kimi / xAI /
 *     百度 / 混元）文档范围覆盖 [0,2]，原样发。
 *
 * 返回 undefined = 这个字段压根不该出现在请求体里。
 */
function wireTemperature(provider: AiProviderId, t: number): number | undefined {
  if (provider === 'gemini') return undefined
  if (provider === 'zhipu') return Math.min(Math.max(t, 0.01), 0.99)
  return t
}

/**
 * 输出上限的「线材规则」。
 *
 *   · 智谱 GLM-4 老世代（glm-4-plus / air / airx / flash / flashx）单次输出
 *     上限只有 4095；带日期的 glm-4-flash-250414 / flashx-250414 是 32768；
 *     glm-4v-flash 只有 1024。统一按 8192 发出题请求，用户一旦在下拉框里
 *     选中这几档老模型就是 400。新世代（4.5 / 4.6 / 4.7 / 5.x）上限在
 *     98K 以上，不夹。
 *   · 其余 OpenAI 兼容厂商原样：它们都接受 max_tokens，且各档上限都高于
 *     本应用的预算（出题 8192）。
 *
 * `pool` 模式下请求发去免费池网关，模型名与厂商无关，不能套用这条规则。
 */
function wireMaxTokens(
  provider: AiProviderId,
  model: string,
  maxTokens: number,
  pool: boolean
): number {
  if (pool || provider !== 'zhipu') return maxTokens
  const m = model.trim().toLowerCase()
  if (/^glm-4v-flash$/.test(m)) return Math.min(maxTokens, 1024)
  if (/^glm-4-(?:flash|flashx)-\d{6}$/.test(m)) return Math.min(maxTokens, 32768)
  if (/^glm-4-(?:plus|air|airx|flash|flashx)$/.test(m)) return Math.min(maxTokens, 4095)
  return maxTokens
}

/**
 * 组 OpenAI 兼容的请求体。
 *
 * o1/o3 这类推理模型有四处不同（`max_completion_tokens`、不认 temperature、
 * system 要写 developer、部分型号不认 response_format），全在
 * shared/ai-providers.ts 的 isOpenAiReasoningModel 里判定 —— 不处理的话，
 * 用户一选 o1 就会得到 400，而界面只会说「模型名不对」。
 */
function openAiBody(
  req: ChatRequest,
  provider: AiProviderId,
  pool = false,
  reasoningEffort?: 'low' | 'medium' | 'high'
): Record<string, unknown> {
  const reasoning = provider === 'openai' && isOpenAiReasoningModel(req.model)
  /*
   * DeepSeek 的 reasoner 不属于 OpenAI 的 o 系（它照旧用 `max_tokens` 和
   * `system`），但它同样**不认 temperature / response_format**。不单列这一档
   * 的话，用户在下拉框里选了 deepseek-reasoner，出题一开 JSON 模式就会 400 ——
   * 而界面只会说「模型名不对」，根本查不到原因。
   */
  const reasoner = provider === 'deepseek' && /reasoner/i.test(req.model.trim())
  const messages = reasoning
    ? req.messages.map((m) =>
        m.role === 'system' ? { role: 'developer', content: m.content } : m
      )
    : req.messages
  const body: Record<string, unknown> = {
    model: req.model,
    messages,
    stream: false
  }
  const maxTokens = wireMaxTokens(provider, req.model, req.max_tokens, pool)
  if (reasoning) {
    body.max_completion_tokens = maxTokens
    // Documented by OpenAI for o-series / GPT-5. Never sent to any other
    // provider: an unknown field there can be a 400, and a 400 here looks like
    // "your model name is wrong" to the user.
    if (reasoningEffort !== undefined) body.reasoning_effort = reasoningEffort
  } else if (!pool && provider === 'xai') {
    /*
     * xAI keeps max_tokens only for backward compatibility and documents
     * max_completion_tokens as the supported field. It caps visible output
     * only, so a reasoning model (grok-4.7 always thinks) does not silently
     * eat the whole reply budget. `pool` never takes this branch: the gateway
     * is not xAI.
     */
    body.max_completion_tokens = maxTokens
    const temp = wireTemperature(provider, req.temperature)
    if (temp !== undefined) body.temperature = temp
  } else {
    body.max_tokens = maxTokens
    const temp = wireTemperature(provider, req.temperature)
    if (!reasoner && temp !== undefined) body.temperature = temp
  }
  /*
   * 免费池**不带 response_format**：那批免费模型来自不同上游，不是每一家
   * 都认这个字段；有的会直接 400，有的会静默忽略。出题的提示词本来就把
   * JSON 形状写死了，safeJson 还会剥 markdown 围栏 —— 少这一层保障换
   * 「换一个模型也不会突然 400」，划算。
   */
  if (!pool && req.json && AI_PROVIDERS[provider].jsonMode && !reasoning && !reasoner) {
    body.response_format = { type: 'json_object' }
  }
  return body
}

/**
 * 组 Anthropic Messages 的请求体：`system` 不在 messages 里，而是顶层字段。
 *
 * 【为什么**完全不发** temperature】2026-10-21 起 Anthropic 的现行模型
 * （Claude 5 家族）对 `temperature` 一律回 400。桌宠的 TEMP_PET=1.3 本来
 * 就超了它 0~1 的上限，以前靠夹一次能过，现在夹了也过不去 —— 正确做法是
 * 这个字段根本不出现在请求里（不传 = 用模型默认值）。风格差异由 system 段
 * 的人设提示词负责，不靠采样温度。
 *
 * 【不传 thinking】现行模型默认就是自适应思考；显式传 `{type:'disabled'}`
 * 在部分型号上同样会 400。少写一项，少一条会过期的规则。
 */
function anthropicBody(req: ChatRequest): Record<string, unknown> {
  const system = req.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
  const messages = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }))
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.max_tokens,
    messages
  }
  if (system !== '') body.system = system
  return body
}

/**
 * 发一次对话请求，返回**助手回复的正文**。
 *
 * 所有失败都从这里统一出口，转换成 `AiResult`。
 * 超时用的是和 runner 同一套思路：一个 `done` 闸 + 幂等的 `finish()`，
 * 保证「超时掐掉」和「正常返回」谁先到都不会重复 resolve。
 */
async function postChat(
  deps: AiDeps,
  cfg: AppConfig,
  req: ChatRequest,
  timeoutMs: number = AI_TIMEOUT_MS
): Promise<AiResult<string>> {
  const mode = activeMode(cfg)
  const pool = mode === 'pool'
  const provider = activeProvider(cfg)
  const apiKey = activeKey(cfg)
  /*
   * 免费池**不需要 Key**，这是模式 B 的全部意义。专属模式没配 Key 也不是
   * 错误，是「这个功能还没开」——界面该引导去设置页，不是报错。
   */
  if (!pool && apiKey === '') return fail('no-key')

  const base = pool ? FREE_POOL_BASE : activeBase(cfg)
  if (base === '') return fail('offline', 'base url is empty')

  // 开跑之前就被取消了（用户点了取消，请求才轮到）
  if (deps.signal?.aborted) return fail('canceled')

  const meta = AI_PROVIDERS[provider]
  const url = pool ? chatUrl(base) : meta.format === 'anthropic' ? messagesUrl(base) : chatUrl(base)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (!pool) {
    if (meta.format === 'anthropic') {
      headers['x-api-key'] = apiKey
      // Anthropic 要求显式版本头；不写会 400，而错误正文只说 missing header。
      headers['anthropic-version'] = '2023-06-01'
    } else {
      headers.Authorization = `Bearer ${apiKey}`
    }
  }

  /*
   * Thinking depth (v23). Translate the saved level into this model's real
   * controls before building the body:
   *   - OpenAI reasoning models -> reasoning_effort;
   *   - DeepSeek -> swap chat <-> reasoner at the two ends;
   *   - Anthropic / Qwen / Zhipu / xAI / Gemini / Baidu / Hunyuan / custom /
   *     pool -> prompt only (no risky unknown fields).
   * The plan's model is used on the wire, and the instruction is appended to
   * the existing system prompt so the persona is never replaced.
   */
  const level: AiThinking = isAiThinking(cfg.ai.thinking)
    ? cfg.ai.thinking
    : recommendedAiThinking(mode, provider, req.model)
  const plan = planAiThinking({ mode, provider, model: req.model, level })

  const planned: ChatRequest = pool
    ? { ...req, model: poolModelOf(cfg.ai.poolModel) }
    : { ...req, model: plan.model }

  /*
   * Reasoning tokens count against the output budget and are spent BEFORE the
   * first content token. Without headroom, a reasoning model given 8 tokens
   * for the connection test (or 200 for the pet) returns empty content and the
   * UI says "connection failed" -- a false alarm that sends the user looking
   * at the network and the key instead of the budget.
   *
   * The pool path keeps its original unconditional headroom; the API path only
   * pays it when the model actually reasons.
   */
  const headroom = pool ? POOL_REASONING_HEADROOM : planReasoningHeadroom(provider, plan)
  const budgetCap =
    pool || provider === 'deepseek' || provider === 'openai' || provider === 'custom'
      ? 8192
      : API_HEADROOM_CAP
  const budgeted: ChatRequest =
    headroom > 0
      ? {
          ...planned,
          max_tokens: Math.min(planned.max_tokens + headroom, budgetCap)
        }
      : planned
  const finalReq = withThinkingInstruction(budgeted, level)

  const body =
    !pool && meta.format === 'anthropic'
      ? anthropicBody(finalReq)
      : openAiBody(finalReq, provider, pool, plan.reasoningEffort)

  const ac = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ac.abort()
  }, planNeedsReasoningHeadroom(provider, plan) && timeoutMs < REASONING_TIMEOUT_MS
    ? REASONING_TIMEOUT_MS
    : timeoutMs)
  const onExternalAbort = (): void => ac.abort()
  deps.signal?.addEventListener('abort', onExternalAbort, { once: true })

  try {
    const res = await deps.fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ac.signal
    })

    const raw = await res.text()

    if (!res.ok) {
      // 状态码分开，是因为用户的下一步动作完全不同：
      // 401 要去改 Key，402 要去充值，503 只要等一会儿再试
      if (res.status === 401 || res.status === 403) return fail('unauthorized', detailOf(raw, res))
      if (res.status === 402 || res.status === 429) return fail('quota', detailOf(raw, res))
      if (res.status >= 500) return fail('server', detailOf(raw, res))
      return fail('bad-response', detailOf(raw, res))
    }

    return meta.format === 'anthropic' ? extractAnthropicContent(raw) : extractContent(raw)
  } catch (e) {
    // 取消和超时都会走到这里，靠 name 分辨。
    // 用 name 而不是 instanceof：Node 里 fetch 抛的是 DOMException，
    // 它**不是** Error 的子类，instanceof 判断会漏。
    const name = (e as { name?: string } | null)?.name
    if (name === 'AbortError' || name === 'TimeoutError') {
      return fail(timedOut ? 'timeout' : 'canceled')
    }
    // 剩下的基本都是连不上：DNS 失败、断网、代理拦了
    return fail('offline', e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
    deps.signal?.removeEventListener('abort', onExternalAbort)
  }
}

/** 从接口的错误响应里抠一句能用来排查的话 */
function detailOf(raw: string, res: HttpResponseLike): string {
  const m = /"message"\s*:\s*"([^"]{0,200})"/.exec(raw)
  return `HTTP ${res.status}${m ? `: ${m[1]}` : ''}`
}

/** 从正常响应里取出助手正文。少一层、少一个字段都算 bad-response */
function extractContent(raw: string): AiResult<string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fail('bad-response', 'response is not JSON')
  }
  const choices = (parsed as { choices?: unknown })?.choices
  if (!Array.isArray(choices) || choices.length === 0) return fail('bad-response', 'no choices')
  const content = (choices[0] as { message?: { content?: unknown } })?.message?.content
  if (typeof content !== 'string') return fail('bad-response', 'no message content')
  const trimmed = content.trim()
  // 【官方文档承认会偶发空内容】这时候不该当成「AI 说没话说」，
  // 而是当成一次失败，好让上层决定重试还是回退本地题库
  if (trimmed === '') return fail('bad-response', 'empty content')
  return { ok: true, data: trimmed }
}

/**
 * 从 Anthropic Messages 的回复里取正文：`content` 是一组带类型的块，
 * 只拼 `type:'text'` 的那些（thinking/tool_use 不是给用户看的话）。
 * 块之间用换行拼，避免两段话粘成一句。
 */
function extractAnthropicContent(raw: string): AiResult<string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fail('bad-response', 'response is not JSON')
  }
  const content = (parsed as { content?: unknown })?.content
  if (!Array.isArray(content)) return fail('bad-response', 'no content')
  const text = content
    .filter(
      (b): b is { type: string; text: string } =>
        !!b &&
        typeof b === 'object' &&
        (b as { type?: unknown }).type === 'text' &&
        typeof (b as { text?: unknown }).text === 'string'
    )
    .map((b) => b.text)
    .join('\n')
    .trim()
  if (text === '') return fail('bad-response', 'empty content')
  return { ok: true, data: text }
}

// ---------------------------------------------------------------- 对外功能

/** 讲报错：把代码和报错交给 AI，拿回一段人话 */
export async function explainError(
  deps: AiDeps,
  input: { lang: Parameters<typeof buildExplainPrompt>[0]['lang']; code: string; error: string; terms: GlossaryTerm[] }
): Promise<AiResult<string>> {
  const cfg = deps.getConfig()
  const { system, user } = buildExplainPrompt(input)
  return postChat(deps, cfg, {
    model: effectiveAiModel(cfg),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: TEMP_EXPLAIN,
    max_tokens: MAX_TOKENS_EXPLAIN
  })
}

/**
 * 出题：把知识点交给 AI，拿回**已经校验过、能直接判分**的题。
 *
 * 这里直接把 `parseAiQuestions` 接上，是因为「AI 说了什么」和「我们收下了什么」
 * 中间那段是最容易出脏数据的地方，**不该让调用方有机会拿到未经校验的原文**。
 *
 * ⚠️ 全部题都没通过校验时返回 `bad-response`，而不是 `ok: true` 但空数组 ——
 * 后者会让调用方以为「AI 说今天不出题」，而实际上是我们把它的题全扔了。
 * 这两件事的下一步动作不同：前者该回退本地题库，后者该提示用户。
 */
export async function generateQuestions(
  deps: AiDeps,
  input: { topics: TopicInput[]; count: number; terms: GlossaryTerm[]; dateKey: string }
): Promise<AiResult<AiParseResult>> {
  const cfg = deps.getConfig()
  // dateKey 既写进提示词（每日换题 + 缓存键每日变），也用于铸题号。
  const { system, user } = buildQuestionsPrompt({ ...input, freshness: input.dateKey })
  const res = await postChat(deps, cfg, {
    model: effectiveAiModel(cfg),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: TEMP_QUESTIONS,
    max_tokens: MAX_TOKENS_QUESTIONS,
    json: true
  }, QUESTIONS_TIMEOUT_MS)
  if (!res.ok) return res

  const parsed = parseAiQuestions(safeJson(res.data), {
    topics: input.topics.map((t) => ({ lessonId: t.lessonId, lessonTitle: t.title })),
    dateKey: input.dateKey
  })

  /*
   * ① 和**完整**旧题干去重。
   *
   * 提示词为了省 token 每课只放 3 道样例（见 ai-prompt.ts），模型看不到全部
   * 旧题，所以「不要重复」不能只靠它自觉。这里拿入参里完整的 stems 再筛一遍 ——
   * 这一步在解析之后，不增加任何 API 成本。
   */
  const existing = new Set(
    input.topics.flatMap((t) => t.stems.map((s) => normalizeStem(s))).filter((s) => s !== '')
  )
  const kept: PoolItem[] = []
  let duplicateExisting = 0
  for (const item of parsed.items) {
    if (existing.has(normalizeStem(item.question.stem))) {
      duplicateExisting++
      continue
    }
    kept.push(item)
  }

  /*
   * ② `code` 题必须在本地沙盒跑通。
   *
   * 只验 code：choice/fill 是纯字符串题，没有可执行的东西；codefix/codewrite
   * 本来就不在 AI 白名单里。超过上限的 code 题直接丢 —— 20 道题里正常也就
   * 几道 code，设 10 是防跑飞，不是常态。
   */
  const CODE_VERIFY_LIMIT = 10
  let codeDropped = 0
  let codeSeen = 0
  const verified: PoolItem[] = []
  for (const item of kept) {
    if (item.question.type !== 'code') {
      verified.push(item)
      continue
    }
    codeSeen++
    if (!deps.verifyCode || codeSeen > CODE_VERIFY_LIMIT) {
      // 生产必定注入 verifyCode；超出上限的 code 题宁可不要，也不破「必须验过」的规矩
      codeDropped++
      continue
    }
    if (deps.signal?.aborted) return fail('canceled')
    let ok = false
    try {
      ok = await deps.verifyCode(item)
    } catch {
      ok = false
    }
    if (ok) verified.push(item)
    else codeDropped++
  }

  const reasons = [
    ...parsed.reasons,
    ...(duplicateExisting ? ['duplicate-existing-stem'] : []),
    ...(codeDropped ? ['code-not-verified'] : [])
  ]
  if (verified.length === 0) {
    const why = reasons.join(',') || 'no questions'
    return fail(
      'bad-response',
      `all dropped: ${why}; duplicate-existing=${duplicateExisting}; code-not-verified=${codeDropped}`
    )
  }
  return {
    ok: true,
    data: {
      ...parsed,
      items: verified,
      dropped: parsed.dropped + duplicateExisting + codeDropped,
      reasons
    }
  }
}

/** 设置页的「测试连接」：发一条最小的请求，一次验完 Key、厂商、模型名三样 */
export async function testConnection(
  deps: AiDeps
): Promise<AiResult<{ model: string; provider: AiProviderId; mode: AiMode }>> {
  const cfg = deps.getConfig()
  const res = await postChat(deps, cfg, {
    model: effectiveAiModel(cfg),
    messages: [{ role: 'user', content: 'ping' }],
    temperature: 0,
    max_tokens: MAX_TOKENS_PING
  })
  if (!res.ok) return res
  return {
    ok: true,
    data: { model: effectiveAiModel(cfg), provider: activeProvider(cfg), mode: activeMode(cfg) }
  }
}

/**
 * 免费公开池的模型清单（模式 B 的下拉框）。
 *
 * 只挑 `isFree === true` 的行 —— 那个网关同时挂着付费模型，把它们列进来
 * 等于让用户点一个「没有 Key 时必然 401」的选项。
 *
 * **失败不抛**：清单拉不到时界面照旧能用兜底模型（`kilo-auto/free`），
 * 所以这里返回 AiResult，让界面决定是显示「重试」还是直接开跑。
 * 也**不走 withAi**：拉清单不该取消用户正在等的出题/聊天请求。
 */
export async function listPoolModels(deps: {
  fetch: FetchLike
  signal?: AbortSignal
}): Promise<AiResult<AiPoolModel[]>> {
  if (deps.signal?.aborted) return fail('canceled')

  const ac = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ac.abort()
  }, POOL_MODELS_TIMEOUT_MS)
  const onExternalAbort = (): void => ac.abort()
  deps.signal?.addEventListener('abort', onExternalAbort, { once: true })

  try {
    const res = await deps.fetch(`${FREE_POOL_BASE}/models`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: ac.signal
    })
    const raw = await res.text()
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return fail('unauthorized', detailOf(raw, res))
      if (res.status === 402 || res.status === 429) return fail('quota', detailOf(raw, res))
      if (res.status >= 500) return fail('server', detailOf(raw, res))
      return fail('bad-response', detailOf(raw, res))
    }
    return extractPoolModels(raw)
  } catch (e) {
    const name = (e as { name?: string } | null)?.name
    if (name === 'AbortError' || name === 'TimeoutError') {
      return fail(timedOut ? 'timeout' : 'canceled')
    }
    return fail('offline', e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
    deps.signal?.removeEventListener('abort', onExternalAbort)
  }
}

/**
 * 从 `/models` 的响应里挑出免费模型。
 *
 * 兼容三种常见形状：OpenAI 风格的 `{data:[...]}`、`{models:[...]}`、裸数组。
 * 每一项只认 `id` 是字符串且 `isFree === true`；`name` 缺了就用 id，
 * 界面永远不会显示一个空标签。
 */
function extractPoolModels(raw: string): AiResult<AiPoolModel[]> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fail('bad-response', 'response is not JSON')
  }
  const root = parsed as { data?: unknown; models?: unknown }
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(root.data)
      ? root.data
      : Array.isArray(root.models)
        ? root.models
        : null
  if (rows === null) return fail('bad-response', 'no model list')

  const out: AiPoolModel[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const obj = row as { id?: unknown; name?: unknown; isFree?: unknown }
    if (typeof obj.id !== 'string' || obj.id.trim() === '') continue
    if (obj.isFree !== true) continue
    const id = obj.id.trim()
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      // Readable label for the dropdown; the id above is still the wire value.
      // `name` from the pool is already a display name when present.
      name:
        typeof obj.name === 'string' && obj.name.trim() !== ''
          ? prettyAiModelName('pool', id, obj.name.trim())
          : prettyAiModelName('pool', id)
    })
  }

  /*
   * 兜底模型永远排第一：它是唯一「清单为空也能发请求」的选项。
   * 远端没把它标成免费时也补上 —— 这个 id 由网关自己路由，不是我们编的。
   */
  const fallbackIdx = out.findIndex((m) => m.id === FREE_POOL_DEFAULT_MODEL)
  if (fallbackIdx >= 0) {
    const [fallback] = out.splice(fallbackIdx, 1)
    out.unshift(fallback)
  } else {
    out.unshift({
      id: FREE_POOL_DEFAULT_MODEL,
      name: prettyAiModelName('pool', FREE_POOL_DEFAULT_MODEL)
    })
  }
  return { ok: true, data: out }
}

/**
 * Auth header for one model-list candidate URL.
 *
 * Most providers take `Authorization: Bearer`. Two exceptions:
 *   - Anthropic: `x-api-key` + `anthropic-version`;
 *   - Gemini's **native** `/v1beta/models`: `x-goog-api-key`. The
 *     `/v1beta/openai` compatibility path still takes Bearer.
 *
 * Headers are computed per URL because one Gemini call may try the compat
 * endpoint and then the native fallback. The key is still only ever sent to
 * Google's own host: the fallback URL is added only for the official base
 * (see modelsUrlCandidates).
 */
function modelsListHeaders(
  provider: AiProviderId,
  key: string,
  url: string
): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (provider === 'anthropic') {
    headers['x-api-key'] = key
    headers['anthropic-version'] = '2023-06-01'
    return headers
  }
  if (provider === 'gemini' && /\/v1beta\/models(?:[?#]|$)/i.test(url)) {
    headers['x-goog-api-key'] = key
    return headers
  }
  headers.Authorization = `Bearer ${key}`
  return headers
}

/**
 * 拉**当前专属厂商**的模型清单（设置页模式 A 的下拉框，v23）。
 *
 * 【为什么必须真的问远端】厂商出新模型的速度比我们发版快得多。写死一份
 * 清单的结果是：用户后台明明有 V5，下拉框里永远只有 V4；而改这份清单
 * 要等下一次发版。清单由接口自己给，出了新模型下一次拉取就能看到。
 *
 * 【失败必须如实上报】这是本函数和「兜底」最容易走偏的地方：拉不到时
 * 绝不能返回一份写死的选项假装成功 —— 用户会以为那是这台 Key 的真实
 * 能力，选中一个不存在的模型，然后得到一个看不懂的 404。失败就返回
 * AiResult 的失败分支，界面显示「无法获取模型列表，请检查 Key 或网络」。
 *
 * 【不走 withAi】和 listPoolModels 同一条理由：只读列表请求，不该掐掉
 * 用户正在等的出题/聊天。
 */
export async function listProviderModels(deps: AiDeps): Promise<AiResult<AiModelInfo[]>> {
  const cfg = deps.getConfig()
  const provider = activeProvider(cfg)
  const key = activeKey(cfg)
  if (key === '') return fail('no-key')

  const base = activeBase(cfg)
  const candidates = modelsUrlCandidates(provider, base)
  if (candidates.length === 0) return fail('offline', 'base url is empty')
  if (deps.signal?.aborted) return fail('canceled')

  const ac = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ac.abort()
  }, POOL_MODELS_TIMEOUT_MS)
  const onExternalAbort = (): void => ac.abort()
  deps.signal?.addEventListener('abort', onExternalAbort, { once: true })

  let lastFail: AiResult<AiModelInfo[]> | null = null
  try {
    for (const url of candidates) {
      const headers = modelsListHeaders(provider, key, url)
      const res = await deps.fetch(url, { method: 'GET', headers, signal: ac.signal })
      const raw = await res.text()

      if (!res.ok) {
        const detail = detailOf(raw, res)
        /*
         * 401/403: the key is the problem; another path will not fix it.
         *
         * Gemini is the one exception. Its compat surface authenticates with
         * Bearer, while native /v1beta/models wants x-goog-api-key; there are
         * reports of a valid key getting 401 on the compat list endpoint.
         * That is exactly what the second candidate is for, so try it before
         * declaring the key bad. If the native call also 401s, its detail is
         * the one we report.
         */
        const canFallBack =
          provider === 'gemini' && url !== candidates[candidates.length - 1]
        if ((res.status === 401 || res.status === 403) && canFallBack) {
          lastFail = fail('unauthorized', detail)
          continue
        }
        if (res.status === 401 || res.status === 403) return fail('unauthorized', detail)
        // 402/429: same key, same host; retrying another path just burns time.
        if (res.status === 402 || res.status === 429) return fail('quota', detail)
        if (res.status >= 500) return fail('server', detail)
        // 404/405/400 are the "wrong path" family for custom gateways: try the
        // one fallback candidate before giving up.
        lastFail = fail('bad-response', detail)
        continue
      }

      const models = parseAiModelList(raw, provider)
      if (models !== null) return { ok: true, data: models }
      lastFail = fail('bad-response', 'no model list in response')
    }
    return lastFail ?? fail('bad-response', 'no model list in response')
  } catch (e) {
    const name = (e as { name?: string } | null)?.name
    if (name === 'AbortError' || name === 'TimeoutError') {
      return fail(timedOut ? 'timeout' : 'canceled')
    }
    // Same host for every candidate: a network failure will not improve by
    // trying the fallback path, so return immediately instead of waiting twice.
    return fail('offline', e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
    deps.signal?.removeEventListener('abort', onExternalAbort)
  }
}

// ---------------------------------------------------------------- 余额查询（V1-30）

/**
 * 余额查询的等待上限。**比聊天短得多**：它不是"AI 在想"，而是一次读数 ——
 * 菜单点下去是交互动作，10 秒还问不到就别让用户对着菜单干等（超时后气泡
 * 会说「过会儿再点点看」，用户随时可以再点）。
 */
export const BALANCE_TIMEOUT_MS = 10_000

/**
 * DeepSeek 余额地址：复用 chatUrl 的归一化规则（2026-10-31 自检 P2）。
 *
 * 用户可能填整条 `.../chat/completions` 或 `.../v1`。DeepSeek 的余额端点
 * 在 `/user/balance`（不在 /v1 下），所以先把两段后缀剥掉再拼。
 */
function deepseekBalanceUrl(baseUrl: string): string {
  let base = baseUrl.trim().replace(/\/+$/, '')
  base = base.replace(/\/chat\/completions$/i, '')
  base = base.replace(/\/v1$/i, '')
  return `${base}/user/balance`
}

/** Kimi（Moonshot）余额：`/v1/users/me/balance`，base 已经带 /v1 */
function kimiBalanceUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/users/me/balance`
}

/**
 * 查一次余额。**不花 token、不计费**，但照样走注入的 fetch / 现读配置 /
 * 结构化失败 —— 与 postChat 同一套纪律（超时掐掉与外部取消靠 `name` 分辨，
 * 异常一个都不许漏出去）。
 *
 * 【多厂商怎么降级】DeepSeek 与 Kimi 有公开的余额接口；OpenAI / Anthropic /
 * 百炼没有（或要组织管理员 Key），一律返回 `unsupported` —— 这是**如实说明**，
 * 不是故障，聊天和出题照常可用。界面看到 unsupported 只显示一句
 * 「该模型不支持余额查询喵」，不拦任何功能。
 *
 * 【失败原因码复用 AiFailReason】宿主（host.ts 的 refreshBalance）把它翻成
 * dsh-pet 的三档 reason（credential-missing / fetch-error / unsupported）；
 * 这里照旧零中文。
 */
export async function fetchBalance(deps: AiDeps): Promise<AiResult<AiBalance>> {
  const cfg = deps.getConfig()
  /*
   * 免费池没有「余额」这个概念：它不是用户的账号，也没有可查的计费后台。
   * 如实返回 unsupported，界面在池模式下本来就不摆这一行。
   */
  if (activeMode(cfg) === 'pool') return fail('unsupported')
  const provider = activeProvider(cfg)
  const kind = AI_PROVIDERS[provider].balance
  if (kind === 'none') return fail('unsupported')

  const apiKey = activeKey(cfg)
  if (apiKey === '') return fail('no-key')
  if (deps.signal?.aborted) return fail('canceled')

  const base = activeBase(cfg)
  if (base === '') return fail('offline', 'base url is empty')
  const url = kind === 'deepseek' ? deepseekBalanceUrl(base) : kimiBalanceUrl(base)

  const ac = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ac.abort()
  }, BALANCE_TIMEOUT_MS)
  const onExternalAbort = (): void => ac.abort()
  deps.signal?.addEventListener('abort', onExternalAbort, { once: true })

  try {
    const res = await deps.fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ac.signal
    })
    const raw = await res.text()
    if (!res.ok) {
      // 状态码分档口径与 postChat 逐条一致（同一套"用户下一步动作不同"的理由）
      if (res.status === 401 || res.status === 403) return fail('unauthorized', detailOf(raw, res))
      if (res.status === 402 || res.status === 429) return fail('quota', detailOf(raw, res))
      if (res.status >= 500) return fail('server', detailOf(raw, res))
      return fail('bad-response', detailOf(raw, res))
    }
    return kind === 'deepseek' ? extractDeepseekBalance(raw, provider) : extractKimiBalance(raw, provider)
  } catch (e) {
    const name = (e as { name?: string } | null)?.name
    if (name === 'AbortError' || name === 'TimeoutError') {
      return fail(timedOut ? 'timeout' : 'canceled')
    }
    return fail('offline', e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
    deps.signal?.removeEventListener('abort', onExternalAbort)
  }
}

/**
 * DeepSeek 余额响应：
 * `{is_available, balance_infos:[{currency, total_balance, granted_balance,
 * topped_up_balance}]}`。多币种时**优先 CNY** —— 界面上的「¥」是写死的，
 * 拿到 USD 金额按 ¥ 显示就是报错账；没有 CNY 才退回第一条。
 * 列表为空算 bad-response（拿不到数就是拿不到，不许编一个 0 出来）。
 */
function extractDeepseekBalance(raw: string, provider: AiProviderId): AiResult<AiBalance> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fail('bad-response', 'response is not JSON')
  }
  const infos = (parsed as { balance_infos?: unknown })?.balance_infos
  if (!Array.isArray(infos) || infos.length === 0) return fail('bad-response', 'no balance_infos')

  const objs = infos.filter(
    (i): i is Record<string, unknown> => !!i && typeof i === 'object'
  )
  const info = objs.find((i) => i.currency === 'CNY') ?? objs[0]
  if (!info || typeof info.total_balance !== 'string') return fail('bad-response', 'no total_balance')
  return {
    ok: true,
    data: {
      provider,
      currency: typeof info.currency === 'string' ? info.currency : 'CNY',
      total: info.total_balance,
      granted: typeof info.granted_balance === 'string' ? info.granted_balance : '0',
      toppedUp: typeof info.topped_up_balance === 'string' ? info.topped_up_balance : '0'
    }
  }
}

/** 金额可能是数字也可能是字符串；统一成两位小数字符串。坏值给 null */
function amountText(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v.toFixed(2)
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n.toFixed(2)
  }
  return null
}

/**
 * Kimi 余额响应：
 * `{code:0, status:true, data:{available_balance, voucher_balance, cash_balance}}`
 * （金额可能是数字也可能是字符串，见 amountText）。
 * `status` 不是 true、或没有 data / available_balance，都算 bad-response。
 */
function extractKimiBalance(raw: string, provider: AiProviderId): AiResult<AiBalance> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fail('bad-response', 'response is not JSON')
  }
  const root = parsed as { code?: unknown; status?: unknown; data?: unknown }
  /*
   * 显式失败先拦：Kimi 的响应带 `status` / `code`，失败时仍可能给一个
   * 空的或全是 0 的 data。只看 data 有没有数，会把一次「Key 没权限」读成
   * 余额 ¥0.00 —— 用户看到「没钱了」就去充值，而真正该做的是换 Key。
   * 只拒绝**明确表达失败**的取值；字段缺失照旧往下读（不同版本响应形状有差）。
   */
  if (root.status === false || (typeof root.code === 'number' && root.code !== 0)) {
    return fail('bad-response', 'api status not ok')
  }
  const data = root?.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return fail('bad-response', 'no data')
  }
  const obj = data as Record<string, unknown>
  const total = amountText(obj.available_balance)
  if (total === null) return fail('bad-response', 'no available_balance')
  return {
    ok: true,
    data: {
      provider,
      currency: 'CNY',
      total,
      granted: amountText(obj.voucher_balance) ?? '0.00',
      toppedUp: amountText(obj.cash_balance) ?? '0.00'
    }
  }
}

/**
 * 大肥鱼桌宠的聊天（2026-10-06）。**人设 system 段由本函数补**——
 * 调用方只负责把历史对话排好队（清洗在 shared/pet.ts 的 sanitizePetChat），
 * 拼装与温度这些"和模型打交道"的细节收在唯一会联网的这一个文件里，
 * 同 explainError / generateQuestions 的分工。
 *
 * 失败照旧返回 AiResult —— 桌宠会把 reason 翻成一句卖萌的抱怨（copy.ts 的
 * PET.CHAT_FAIL），不是红色报错弹窗。
 */
export async function chatPet(
  deps: AiDeps,
  input: { messages: PetChatMessage[]; memory?: string }
): Promise<AiResult<string>> {
  const cfg = deps.getConfig()
  const history = input.messages.filter((m) => m.role !== 'system')
  // 【记忆块为什么不走 messages 数组】它不是一轮对话，而是"人设的一部分"——
  // 塞成 user/assistant 会污染对话回合（模型会对着回忆继续演，而不是回主人
  // 刚问的那句）。拼在 system 段尾、由主进程压成一两行（copy.ts 的
  // MEMORY_BLOCK），是 token 账上最省、行为上最不像"另一个人插话"的做法。
  const system =
    input.memory && input.memory.trim() !== ''
      ? `${PET_PROMPT.PERSONA}\n\n${input.memory.trim()}`
      : PET_PROMPT.PERSONA
  return postChat(deps, cfg, {
    model: effectiveAiModel(cfg),
    messages: [{ role: 'system', content: system }, ...history],
    temperature: TEMP_PET,
    max_tokens: MAX_TOKENS_PET
  })
}

/**
 * 解析 JSON，失败也不抛 —— 上游只管拿到 `unknown` 交给校验器。
 * 开了 JSON 模式理论上一定合法，但「理论上」在这个项目里不算数：
 * 接口偶尔会在 JSON 外面裹一层 markdown 围栏，那就剥掉再试一次。
 */
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    const stripped = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
    try {
      return JSON.parse(stripped)
    } catch {
      return null
    }
  }
}
