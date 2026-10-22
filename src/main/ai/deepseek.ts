/**
 * DeepSeek 调用 —— **全项目唯一会联网的地方**。
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
import type { AppConfig, AiResult, AiFailReason, GlossaryTerm } from '../../shared/types'
import { buildExplainPrompt, buildQuestionsPrompt, type TopicInput } from '../../shared/ai-prompt'
import { normalizeStem, parseAiQuestions, type AiParseResult } from '../../shared/ai-question'
import type { PoolItem } from '../../shared/challenge'
import { PET_PROMPT } from '../../shared/copy'
import type { PetChatMessage } from '../../shared/pet'

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

// ---------------------------------------------------------------- 内部工具

function fail(reason: AiFailReason, detail?: string): AiResult<never> {
  return detail === undefined ? { ok: false, reason } : { ok: false, reason, detail }
}

/** 把 baseUrl 拼成 chat/completions。用户可能填了结尾的斜杠，也可能填了 /v1 */
function chatUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/chat/completions`
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

interface ChatBody {
  model: string
  messages: ChatMessage[]
  temperature: number
  max_tokens: number
  stream: false
  /** 出题时开 JSON 模式。**要求提示词里出现 json 字样**，否则接口直接报错 */
  response_format?: { type: 'json_object' }
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
  body: ChatBody,
  timeoutMs: number = AI_TIMEOUT_MS
): Promise<AiResult<string>> {
  const apiKey = cfg.ai.apiKey.trim()
  // 没配 Key 不是错误，是「这个功能还没开」——界面该引导去设置页，不是报错
  if (apiKey === '') return fail('no-key')

  // 开跑之前就被取消了（用户点了取消，请求才轮到）
  if (deps.signal?.aborted) return fail('canceled')

  const ac = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ac.abort()
  }, timeoutMs)
  const onExternalAbort = (): void => ac.abort()
  deps.signal?.addEventListener('abort', onExternalAbort, { once: true })

  try {
    const res = await deps.fetch(chatUrl(cfg.ai.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
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

    return extractContent(raw)
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

// ---------------------------------------------------------------- 对外功能

/** 讲报错：把代码和报错交给 AI，拿回一段人话 */
export async function explainError(
  deps: AiDeps,
  input: { lang: Parameters<typeof buildExplainPrompt>[0]['lang']; code: string; error: string; terms: GlossaryTerm[] }
): Promise<AiResult<string>> {
  const cfg = deps.getConfig()
  const { system, user } = buildExplainPrompt(input)
  return postChat(deps, cfg, {
    model: cfg.ai.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: TEMP_EXPLAIN,
    max_tokens: MAX_TOKENS_EXPLAIN,
    stream: false
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
    model: cfg.ai.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: TEMP_QUESTIONS,
    max_tokens: MAX_TOKENS_QUESTIONS,
    stream: false,
    response_format: { type: 'json_object' }
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

/** 设置页的「测试连接」：发一条最小的请求，一次验完 Key、baseUrl、模型名三样 */
export async function testConnection(
  deps: AiDeps
): Promise<AiResult<{ model: string }>> {
  const cfg = deps.getConfig()
  const res = await postChat(deps, cfg, {
    model: cfg.ai.model,
    messages: [{ role: 'user', content: 'ping' }],
    temperature: 0,
    max_tokens: MAX_TOKENS_PING,
    stream: false
  })
  if (!res.ok) return res
  return { ok: true, data: { model: cfg.ai.model } }
}

// ---------------------------------------------------------------- 余额查询（V1-30）

/**
 * 余额查询的等待上限。**比聊天短得多**：它不是"AI 在想"，而是一次读数 ——
 * 菜单点下去是交互动作，10 秒还问不到就别让用户对着菜单干等（超时后气泡
 * 会说「过会儿再点点看」，用户随时可以再点）。
 */
export const BALANCE_TIMEOUT_MS = 10_000

/**
 * 挑出来的余额四元组（全部字符串 —— 与 dsh-pet 的 deepseek 余额形状
 * `{currency,total,granted,toppedUp}` 逐字对齐；那个形状的消费方在供应商
 * bundle 的 balance.ts 里，我们只负责喂数据，不替它算"还剩几成"）。
 */
export interface DeepseekBalance {
  currency: string
  total: string
  granted: string
  toppedUp: string
}

/** 用户可能填了结尾的斜杠 —— 与 chatUrl 同款修剪 */
function balanceUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/user/balance`
}

/**
 * 查一次 DeepSeek 余额（GET /user/balance）。**不花 token、不计费**，
 * 但照样走注入的 fetch / 现读配置 / 结构化失败 —— 与 postChat 同一套纪律
 * （超时掐掉与外部取消靠 `name` 分辨，异常一个都不许漏出去）。
 *
 * 【失败原因码复用 AiFailReason】宿主（host.ts 的 refreshBalance）把它翻成
 * dsh-pet 的三档 reason（credential-missing / fetch-error）和一句人话小字；
 * 这里照旧零中文。
 */
export async function fetchBalance(deps: AiDeps): Promise<AiResult<DeepseekBalance>> {
  const cfg = deps.getConfig()
  const apiKey = cfg.ai.apiKey.trim()
  if (apiKey === '') return fail('no-key')
  if (deps.signal?.aborted) return fail('canceled')

  const ac = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ac.abort()
  }, BALANCE_TIMEOUT_MS)
  const onExternalAbort = (): void => ac.abort()
  deps.signal?.addEventListener('abort', onExternalAbort, { once: true })

  try {
    const res = await deps.fetch(balanceUrl(cfg.ai.baseUrl), {
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
    return extractBalance(raw)
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
 * 从余额响应里挑出四元组。响应形状（官方文档）：
 * `{is_available, balance_infos:[{currency, total_balance, granted_balance,
 * topped_up_balance}]}`。多币种时**优先 CNY** —— 气泡里的「¥」是写死的，
 * 拿到 USD 金额按 ¥ 显示就是报错账；没有 CNY 才退回第一条。
 * is_available=false 或列表为空都算 bad-response（拿不到数就是拿不到，
 * 不许编一个 0 出来）。
 */
function extractBalance(raw: string): AiResult<DeepseekBalance> {
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
      currency: typeof info.currency === 'string' ? info.currency : 'CNY',
      total: info.total_balance,
      granted: typeof info.granted_balance === 'string' ? info.granted_balance : '0',
      toppedUp: typeof info.topped_up_balance === 'string' ? info.topped_up_balance : '0'
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
    model: cfg.ai.model,
    messages: [{ role: 'system', content: system }, ...history],
    temperature: TEMP_PET,
    max_tokens: MAX_TOKENS_PET,
    stream: false
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
