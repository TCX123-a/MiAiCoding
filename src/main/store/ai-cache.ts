/**
 * ai-cache.json 的**键、存取与落地流程** —— 纯函数，不碰文件系统、不碰 Electron。
 * （文件头到 `cachePut` 是键与存取；文件末尾的 `questionsWithCache` 是把它们
 * 接上「查 → 问 → 存」的编排，依赖全部注入 —— 单测不用起 Electron、不用出网。）
 *
 * 【它解决的问题】AI 出的题是**花了钱的**（每一次调用都在烧 token）。
 * 同一份 prompt（同样的模型、同样的要求、同样的知识点）再问一次，
 * 拿回来的东西十有八九一样 —— 而每日复习的「题目不够就补几道」和
 * 延展练习的补题**天天会走到这条路上**，问的还是那几个老知识点。
 * 缓存命中就是纯赚。
 *
 * 【键为什么是 hash(model + system + user)】
 *   · **日期必须进 user 段**（`buildQuestionsPrompt` 的 `freshness`）。曾经它只在
 *     题号里出现，于是同一个知识点跨天也是同一个键 —— 表现是「每日挑战天天
 *     同一批题」。现在日期是 prompt 的一部分：每天换键 = 每天换题；
 *     同一天内重抽仍然命中 = 不重复烧钱。
 *   · 换模型、改 prompt 文本，键**自动**就变了：失效逻辑不需要"清缓存"这种动作，
 *     哈希自己就是失效规则。少一个能忘、能写错的地方。
 *   · 用 `JSON.stringify([...])` 拼串而不是裸拼接：裸拼 `a+b` 的话
 *     `('ab','c')` 和 `('a','bc')` 是同一个键，两份不同的提问会互相污染。
 *     JSON 数组带引号和逗号，分段天然无歧义。
 *
 * 【apiKey 绝不进缓存】键里没有它（也不该有：它是凭据不是内容），
 * 值里更没有 —— 缓存文件躺在用户硬盘上，Key 进去就等于写了一份明文副本。
 *
 * 【为什么类型定义在这个文件里，而不是 shared/types.ts】
 * 它只给主进程用（缓存是主进程的事，渲染层拿不到也不需要），
 * 而且 payload 的类型来自 `shared/ai-question.ts` —— 放进 types.ts 会绕一个
 * types ⇄ ai-question 的循环导入。**等真有第二个消费方再搬**。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律英文**，中文只出现在注释里。
 */
import { createHash } from 'node:crypto'
import { buildQuestionsPrompt } from '../../shared/ai-prompt'
import type { AiParseResult } from '../../shared/ai-question'
import type { AiGenerateInput, AiResult } from '../../shared/types'

/** 缓存里的一条：什么时候存的 + 当时 AI 交回来的**已校验**结果 */
export interface AiCacheEntry {
  at: string
  payload: AiParseResult
}

/** `ai-cache.json` 的根 */
export interface AiCacheFile {
  version: number
  /** 键 = `cacheKeyOf(...)` 算出来的十六进制串 */
  entries: Record<string, AiCacheEntry>
}

export const CURRENT_AI_CACHE_VERSION = 1

/**
 * 最多留多少条。
 *
 * 【为什么是 200】一条 ≈ 几道题的题干 + 选项 + 解析（几 KB），200 条也就几百 KB ——
 * 对一个"能省一次 API 调用就省一次"的缓存来说，这个体量完全不值得心疼磁盘。
 * 而再多就没有意义了：键是 prompt 的哈希，同一个知识点问出的花样是有限的，
 * 200 条足够覆盖最近在做的那一批；更早的即使命中，也说明它在反复问同一件事。
 */
export const AI_CACHE_CAP = 200

/**
 * 算缓存键。三段内容用 JSON 数组编码（理由见文件头），再取 sha256。
 *
 * 用 sha256 而不是把 prompt 本身当键：prompt 可以很长（几千字符），
 * 拿来当对象的键既占地方、又让它直接躺在文件里可读可搜 —— 没必要。
 * 哈希是单向的，缓存文件里不会留下"用户问过什么"的原文。
 */
export function cacheKeyOf(model: string, system: string, user: string): string {
  return createHash('sha256').update(JSON.stringify([model, system, user]), 'utf8').digest('hex')
}

/** 普通对象（不是 null / 数组）—— 文件被手改成数组时，别拿数字键当条目 */
function isPlainObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x)
}

/**
 * 缓存文件里**可用的** entries。
 *
 * 版本对不上、entries 不是对象、或者整个文件是畸形 JSON，一律当「没有缓存」——
 * 宁可多问一次 AI，也不把一条形状不对的旧数据端给界面（那会在解析层炸，
 * 而且报错会指向"AI 回的话看不懂"，把排查引到完全错误的方向）。
 */
function entriesOf(file: AiCacheFile | null): Record<string, AiCacheEntry> {
  if (!isPlainObject(file)) return {}
  if (file.version !== CURRENT_AI_CACHE_VERSION) return {}
  return isPlainObject(file.entries) ? (file.entries as Record<string, AiCacheEntry>) : {}
}

/**
 * 一条缓存值能不能用：`at` 是字符串，payload 有 `items` 数组。
 *
 * 只校验到这一层：再往下逐题查形状就是把解析层的活重做一遍。这里拦的是
 * **版本漂移/文件被改坏**会造成的结构性错误（payload 整个缺失、items 不是数组），
 * 那种错误一旦进界面就是白屏；单题字段歪了由解析层和生产端共同保证。
 */
function isUsableEntry(x: unknown): x is AiCacheEntry {
  if (!isPlainObject(x)) return false
  if (typeof x.at !== 'string') return false
  const payload = x.payload
  if (!isPlainObject(payload)) return false
  return Array.isArray(payload.items)
}

/** 查一条。没有就是 null（**「没有」不是错误**，调用方照常去问 AI） */
export function cacheGet(file: AiCacheFile | null, key: string): AiCacheEntry | null {
  const hit = entriesOf(file)[key]
  return isUsableEntry(hit) ? hit : null
}

/**
 * 存一条，返回**要落盘的新文件**（不原地改入参：调用方手里那份还得当旧值用）。
 *
 * 【只该拿成功的结果来调它】失败的响应（超时、限流、Key 过期）**不许写进来** ——
 * 缓存了失败，网络恢复之后还会一直拿那份失败当答案，等于把一次偶发故障
 * 变成了永久的。判断"成不成功"是调用方的事（阶段 7 接线时只有 `ok: true` 才进来）。
 *
 * 【淘汰：超上限丢 `at` 最早的】和错题本裁 AI 题同一条规矩：
 * 最近还在用的先留下。重存同一个键会刷新它的 `at`（等于把它挪到最新），
 * 所以它是"最近写过"而不是"最早存过"。
 */
export function cachePut(
  file: AiCacheFile | null,
  key: string,
  payload: AiParseResult,
  now: string
): AiCacheFile {
  // 版本不对/形状坏掉的旧文件不参与合并 —— 否则一条坏条目会被新写入"救活"，
  // 而且坏 payload 的 `at` 可能在排序时把好条目挤掉
  const entries: Record<string, AiCacheEntry> = { ...entriesOf(file), [key]: { at: now, payload } }

  const keys = Object.keys(entries)
  if (keys.length > AI_CACHE_CAP) {
    const doomed = keys
      .sort((a, b) => entries[a].at.localeCompare(entries[b].at))
      .slice(0, keys.length - AI_CACHE_CAP)
    for (const k of doomed) delete entries[k]
  }

  return { version: CURRENT_AI_CACHE_VERSION, entries }
}

// ---------------------------------------------------------------- 落地流程

/**
 * `questionsWithCache` 的全部依赖。除了 `generate` 都是纯数据/纯函数，
 * 单测直接注入 —— 不起 Electron、不出网、不碰磁盘。
 */
export interface QuestionsWithCacheDeps {
  /**
   * 用户在设置页的「AI 动态出题」总开关。
   *
   * **为什么主进程还要判一次**：渲染层已经在抽题/补题前判过了，但那是"界面
   * 自觉"。开关的语义是**用户没授权花 Token**，这条红线不该只由一个调用方
   * 守住 —— 渲染层写错、旧版本残留、或者别的入口直接 invoke，都会绕过它。
   * 关着时连缓存都不查：缓存里的题也是 AI 出的，开关关着就不该冒出来。
   */
  dynamicEnabled: boolean
  /** 当前模型名（进缓存键；换模型 = 换键 = 旧缓存自动失效，不需要谁记得清理） */
  model: string
  /**
   * `ai:generate-questions` 的入参**原样**。
   * 键和真正发出去的 prompt 都由它算出来 —— 调用方不要在这里"精简"字段，
   * 精简掉一个字段，键就和 `generateQuestions` 发出去的 prompt 对不上了。
   */
  input: AiGenerateInput
  /** 真去问 AI。**只有没命中缓存时才会被调用**；失败以 `ok:false` 返回，不抛 */
  generate: () => Promise<AiResult<AiParseResult>>
  read: () => AiCacheFile | null
  write: (file: AiCacheFile) => void
  /** 现在几点（注入是为了单测能断言 `at`；生产传 `() => new Date().toISOString()`） */
  now: () => string
}

/**
 * 「先查缓存，没有才问 AI，成功了才存」—— `ai:generate-questions` 的完整落地流程。
 *
 * 【键从哪来】与 `generateQuestions` 将要发送的 prompt **同一份**：
 * 两边都调 `buildQuestionsPrompt(input)`，纯函数、同参同串，
 * 所以"缓存里的键"和"这次提问的指纹"必然一致 —— 不一致的话问题就出在这里。
 *
 * 【失败绝不进缓存】`cachePut` 只在 `res.ok` 时被调用。缓存了失败
 * （断网、401、余额不足），网络恢复之后还会一直拿那份失败当答案 ——
 * 等于把一次偶发故障变成永久的。`generate` 抛出的异常同样什么都不写（异常直接向上抛）。
 *
 * 【命中时不走 generate】命中的那个 `generate` 实现里包着 `withAi`（单飞 + 取消）——
 * 没发请求就没有"在飞的请求"要管，也就没有要取消的东西。
 */
export async function questionsWithCache(
  deps: QuestionsWithCacheDeps
): Promise<AiResult<AiParseResult>> {
  // 总开关关着 = 用户没授权花 Token：缓存不查、API 不问、文件不写。
  // 放在最前面，保证这条路径上没有任何一步会产生费用或改动缓存。
  if (!deps.dynamicEnabled) return { ok: false, reason: 'disabled' }

  // `freshness` 就是入参里的 dateKey —— 它同时实现「每日换题」和「当天复用」。
  const { system, user } = buildQuestionsPrompt({
    ...deps.input,
    freshness: deps.input.dateKey
  })
  const key = cacheKeyOf(deps.model, system, user)

  const hit = cacheGet(deps.read(), key)
  if (hit) return { ok: true, data: hit.payload }

  const res = await deps.generate()
  if (res.ok) {
    deps.write(cachePut(deps.read(), key, res.data, deps.now()))
  }
  return res
}
