/**
 * Model-list helpers: URL derivation, response parsing, readable names.
 *
 * All providers expose a model list under a slightly different path, and most
 * return ids that are not meant for humans (`deepseek-chat`, `gpt-4o-mini`).
 * The settings page needs both: the real id for the request, a readable label
 * for the dropdown.
 *
 * Kept pure and free of I/O so the network layer, the renderer and tests share
 * one implementation. No user-visible Chinese strings live here; the UI's
 * failure sentences are in copy.ts.
 */
import { AI_PROVIDERS, type AiProviderId } from './ai-providers'
import type { AiModelInfo } from './types'

/** Model lists come from either an official provider or the free pool. */
export type AiModelVendor = AiProviderId | 'pool'

/**
 * Paths where a provider may expose GET /models.
 *
 * Official providers have a known base URL, so exactly one candidate is
 * returned. Custom gateways are the wild west: users paste either the root,
 * a /v1 base, or a full /chat/completions endpoint. For those we try the
 * obvious path first and one fallback, never more -- two network requests is
 * an acceptable discovery cost, a retry storm is not.
 */
export function modelsUrlCandidates(
  provider: AiProviderId,
  baseUrl: string
): string[] {
  let base = baseUrl.trim().replace(/\/+$/, '')
  base = base.replace(/\/chat\/completions$/i, '')
  if (base === '') return []
  if (/\/models$/i.test(base)) return [base]

  const urls = [`${base}/models`]
  /*
   * Gemini 的 OpenAI 兼容层在部分区域/版本里不提供 GET /models（社区里两种
   * 说法都有）。原生 GET /v1beta/models 一定存在，返回 {models:[{name,
   * displayName}]}。先试兼容层、404 再试原生，两条都在同一台 Google 主机上，
   * Key 不会离开它该去的域。
   *
   * 只在**官方 base 精确相等**时加这条兜底：如果以后有人把 gemini 指向
   * 自己的网关，绝不能把 Google 的 Key 发到那个网关上。
   */
  if (
    provider === 'gemini' &&
    base === 'https://generativelanguage.googleapis.com/v1beta/openai'
  ) {
    urls.push('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000')
  }
  if (provider !== 'custom') return [...new Set(urls)]

  // A /v1 base might still serve the list at the root (and vice versa).
  if (/\/v1$/i.test(base)) {
    urls.push(`${base.replace(/\/v1$/i, '')}/models`)
  } else {
    urls.push(`${base}/v1/models`)
  }
  return [...new Set(urls)]
}

/**
 * Curated names for models that are worth getting exactly right.
 *
 * The heuristic below is good enough for unknown ids, but these are the ones
 * users see first; a wrong space or a lost brand case is immediately visible.
 * Add future families here as they appear; ids not listed still work.
 */
const KNOWN_NAMES: Record<string, string> = {
  'deepseek-chat': 'DeepSeek Chat',
  'deepseek-reasoner': 'DeepSeek Reasoner',
  'deepseek-v4': 'DeepSeek V4',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'deepseek-v4.1': 'DeepSeek V4.1',
  'deepseek-v4.1-pro': 'DeepSeek V4.1 Pro',
  'deepseek-v4.1-flash': 'DeepSeek V4.1 Flash',
  'qwen3-max': 'Qwen3 Max',
  'qwen3-plus': 'Qwen3 Plus',
  'qwen3-turbo': 'Qwen3 Turbo',
  'qwen-max': 'Qwen Max',
  'qwen-plus': 'Qwen Plus',
  'qwen-turbo': 'Qwen Turbo',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o mini',
  'gpt-4.1': 'GPT-4.1',
  'gpt-4.1-mini': 'GPT-4.1 mini',
  'gpt-5': 'GPT-5',
  'gpt-5-mini': 'GPT-5 mini',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
  'kimi-latest': 'Kimi Latest',
  'kimi-k3-1': 'Kimi K3-1',
  'glm-5.3': 'GLM-5.3',
  'glm-4.7': 'GLM-4.7',
  'glm-4.7-flash': 'GLM-4.7 Flash',
  'glm-4.7-flashx': 'GLM-4.7 FlashX',
  'glm-4.6': 'GLM-4.6',
  'glm-4-plus': 'GLM-4 Plus',
  'glm-4-flash': 'GLM-4 Flash',
  'glm-4.5': 'GLM-4.5',
  'glm-4.5-air': 'GLM-4.5 Air',
  'grok-beta': 'Grok Beta',
  'grok-2': 'Grok 2',
  'grok-3': 'Grok 3',
  'grok-4.3': 'Grok 4.3',
  'grok-4.7': 'Grok 4.7',
  'gemini-1.5-pro': 'Gemini 1.5 Pro',
  'gemini-1.5-flash': 'Gemini 1.5 Flash',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'ernie-4.0-8k': 'ERNIE 4.0 8K',
  'ernie-4.0-turbo-8k': 'ERNIE 4.0 Turbo 8K',
  'ernie-5.1': 'ERNIE 5.1',
  'hunyuan-standard': 'Hunyuan Standard',
  'hunyuan-pro': 'Hunyuan Pro',
  'hunyuan-lite': 'Hunyuan Lite',
  hy3: 'Hunyuan Hy3',
  'hy4-preview': 'Hunyuan Hy4 Preview',
  'kilo-auto/free': 'Auto Free'
}

/** Brand casing that a plain capitalize() would get wrong. */
const BRANDS: Record<string, string> = {
  ai: 'AI',
  anthropic: 'Anthropic',
  api: 'API',
  baidu: 'Baidu',
  baichuan: 'Baichuan',
  claude: 'Claude',
  cohere: 'Cohere',
  command: 'Command',
  deepseek: 'DeepSeek',
  doubao: 'Doubao',
  ernie: 'ERNIE',
  gemini: 'Gemini',
  gemma: 'Gemma',
  glm: 'GLM',
  gpt: 'GPT',
  grok: 'Grok',
  hunyuan: 'Hunyuan',
  kimi: 'Kimi',
  llama: 'Llama',
  meta: 'Meta',
  minimax: 'MiniMax',
  mistral: 'Mistral',
  moonshot: 'Moonshot',
  nemotron: 'Nemotron',
  nvidia: 'NVIDIA',
  o1: 'o1',
  o3: 'o3',
  o4: 'o4',
  o5: 'o5',
  ocr: 'OCR',
  openai: 'OpenAI',
  phi: 'Phi',
  qianfan: 'Qianfan',
  qwen: 'Qwen',
  spark: 'Spark',
  step: 'Step',
  tts: 'TTS',
  vl: 'VL',
  xai: 'xAI',
  yi: 'Yi',
  zhipu: 'Zhipu'
}

/** Tokens that read better with their original casing. */
const ACRONYMS: Record<string, string> = {
  asr: 'ASR',
  moe: 'MoE',
  omni: 'Omni',
  r1: 'R1',
  r2: 'R2',
  sft: 'SFT',
  vl: 'VL'
}

function capToken(token: string): string {
  const lower = token.toLowerCase()
  if (BRANDS[lower]) return BRANDS[lower]
  if (ACRONYMS[lower]) return ACRONYMS[lower]
  if (/^v\d+(?:\.\d+)*$/.test(lower)) return `V${lower.slice(1)}`
  if (/^\d+(?:\.\d+)*[a-z]?$/.test(lower)) {
    // 70b -> 70B, 128k -> 128K, 8k -> 8K; 4o stays 4o.
    return lower.replace(/^(\d+(?:\.\d+)*)([a-z])$/, (_m, n: string, c: string) =>
      `${n}${c.toUpperCase()}`
    )
  }
  // Brand fused with a version: qwen3 -> Qwen3, glm5.3 -> GLM5.3.
  const fused = /^(deepseek|qwen|glm|kimi|llama|gemma|phi|yi|minimax|mistral|gemini|claude|gpt|ernie|doubao|hunyuan|baichuan)(v?\d.*)$/i.exec(
    token
  )
  if (fused) return `${BRANDS[fused[1].toLowerCase()] ?? fused[1]}${fused[2]}`
  return token === '' ? '' : token[0].toUpperCase() + token.slice(1)
}

function heuristicName(id: string): string {
  let core = id.trim()
  if (core === '') return id

  const colon = core.split(':')
  core = colon[0]
  const freeTag = colon.slice(1).some((t) => t.toLowerCase() === 'free')

  // Vendor prefixes are useful for disambiguation but not for reading.
  const slash = core.lastIndexOf('/')
  if (slash >= 0) core = core.slice(slash + 1)

  core = core.replace(/@/g, '-').replace(/_/g, '-')
  // qwen3max -> qwen-3-max; deepseekv5pro -> deepseek-v5-pro.
  core = core.replace(
    /^(deepseek|qwen|glm|kimi|llama|gemma|phi|yi|minimax|mistral|gemini|claude|gpt|ernie|doubao|hunyuan|baichuan)(?=v?\d)/i,
    '$1-'
  )
  // 3max -> 3-max, but 4o/70b/8k stay together.
  core = core.replace(/(\d)([a-z]{2,})/gi, '$1-$2')

  const tokens = core.split(/[\s-]+/).filter((t) => t !== '')
  const name = tokens.map(capToken).join(' ')
  if (name === '') return id
  // A one- or two-character label ("A" from "free/a") reads as a rendering bug,
  // not a model name. The raw id is at least recognizable, so keep it.
  if (name.replace(/\s/g, '').length <= 2 && id.trim().length > 2) return id
  return freeTag ? `${name} Free` : name
}

/**
 * Readable label for one model id.
 *
 * An API-provided `display_name` wins when it looks human (it contains spaces
 * or CJK). Otherwise the id is prettified. The id itself is never lost: the
 * select's value is always the wire id.
 */
export function prettyAiModelName(
  _vendor: AiModelVendor,
  id: string,
  apiName?: string
): string {
  const raw = id.trim()
  if (raw === '') return id

  const api = (apiName ?? '').trim()
  if (api !== '' && api.toLowerCase() !== raw.toLowerCase()) {
    // 含有空格或汉字 = 厂商给的就是人话，直接照用。用码点判断而不是正则里的
    // 汉字范围：这个文件被文案闸门扫，源码里不该出现中文。
    const hasCjk = [...api].some((ch) => {
      const c = ch.codePointAt(0) ?? 0
      return c >= 0x3400 && c <= 0x9fff
    })
    if (hasCjk || /\s/.test(api)) return api
    return heuristicName(api)
  }

  const lower = raw.toLowerCase()
  if (KNOWN_NAMES[lower]) return KNOWN_NAMES[lower]
  const last = lower.slice(lower.lastIndexOf('/') + 1)
  if (KNOWN_NAMES[last]) return KNOWN_NAMES[last]
  return heuristicName(raw)
}

/**
 * Drop obvious non-chat endpoints from a provider list. These ids would always
 * fail the chat endpoint, so showing them is a guaranteed dead end.
 *
 * `veo` (Google video), `imagen` (Google image) and `live` (Gemini realtime)
 * are family names rather than separator-delimited tokens, so they are listed
 * explicitly. `cogview` / `cogvideo` are Zhipu's image/video families.
 *
 * If EVERY row looks non-chat, the original list is returned: a custom gateway
 * may use names we do not recognize, and an empty dropdown is worse than a
 * list the user can inspect.
 */
function filterChatModels(models: AiModelInfo[]): AiModelInfo[] {
  const nonChat =
    /(?:^|[-_/.])(?:embed(?:ding|dings)?|rerank(?:er)?|tts|speech|transcri(?:be|ption)|whisper|audio|realtime|moderation|dall-e|image|images|video|music|ocr|diffusion|flux|sdxl|midjourney|veo|imagen|live|cogview|cogvideo)(?:$|[-_/.])/i
  const filtered = models.filter((m) => !nonChat.test(m.id))
  return filtered.length > 0 ? filtered : models
}

/**
 * Catalogs that are broader than the vendor label promise one extra pass.
 *
 * TokenHub's `/models` is the whole Tencent platform (Hunyuan + DeepSeek + GLM
 * + Kimi + ...), and Qianfan's v2 catalog mixes ERNIE with third-party models
 * and non-chat endpoints. Showing those under a "腾讯混元" / "百度文心一言"
 * label is technically callable but reads as a bug to a beginner, and picking
 * a retired row is a guaranteed 4xx.
 *
 * Returning false only *demotes* the row: if the vendor filter empties the
 * list, the parser falls back to the unfiltered rows (see parseAiModelList),
 * because an empty dropdown is a worse dead end than an imperfect one.
 */
function vendorRowAllowed(
  vendor: AiModelVendor,
  obj: Record<string, unknown>,
  id: string
): boolean {
  if (vendor === 'hunyuan') {
    // Hunyuan family ids: hy3, hy4-preview, hy-role, hy-mt2-*, hunyuan-role-*.
    if (!/^(?:hy|hunyuan)(?:[-.]|$|\d)/i.test(id)) return false
    // `pre-offline` models are about to disappear; only online ones belong here.
    return typeof obj.status !== 'string' || obj.status.toLowerCase() === 'online'
  }
  if (vendor === 'baidu') {
    // Qianfan rows carry type/status; only chat rows are callable here.
    if (typeof obj.type === 'string' && obj.type.toLowerCase() !== 'chat') return false
    if (typeof obj.status === 'string' && obj.status.toLowerCase() === 'offline') return false
    // Keep the label honest: ERNIE models only.
    return /^ernie(?:[-.]|$)/i.test(id)
  }
  if (vendor === 'xai') {
    // grok-imagine-* are image/video models, not chat models.
    return !/^grok-imagine(?:[-.]|$)/i.test(id)
  }
  if (vendor === 'gemini') {
    // The native route is explicit about what each model can do. The compat
    // route omits this field, so absence is not a rejection.
    if (Array.isArray(obj.supportedGenerationMethods)) {
      return obj.supportedGenerationMethods.includes('generateContent')
    }
    return true
  }
  return true
}

/**
 * Two different ids can prettify to the same label (for example a vendor
 * prefix stripped away). Append the real id only when that happens, so the
 * common case stays clean.
 */
function disambiguate(models: AiModelInfo[]): AiModelInfo[] {
  const counts = new Map<string, number>()
  for (const m of models) counts.set(m.name, (counts.get(m.name) ?? 0) + 1)
  return models.map((m) =>
    (counts.get(m.name) ?? 0) > 1 ? { ...m, name: `${m.name} (${m.id})` } : m
  )
}

/**
 * Known models first (the catalog order is curated), then the rest by label.
 * Stable ordering means the dropdown does not reshuffle between fetches.
 */
function orderModels(vendor: AiModelVendor, models: AiModelInfo[]): AiModelInfo[] {
  const known = vendor === 'pool' ? [] : AI_PROVIDERS[vendor].models
  const rank = new Map<string, number>(known.map((id, i) => [id, i]))
  return [...models].sort((a, b) => {
    const ra = rank.get(a.id)
    const rb = rank.get(b.id)
    if (ra !== undefined && rb !== undefined) return ra - rb
    if (ra !== undefined) return -1
    if (rb !== undefined) return 1
    return a.name.localeCompare(b.name, 'en')
  })
}

function rowsOf(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed
  if (!parsed || typeof parsed !== 'object') return null
  const root = parsed as Record<string, unknown>
  if (Array.isArray(root.data)) return root.data
  if (Array.isArray(root.models)) return root.models
  if (root.data && typeof root.data === 'object') {
    const nested = (root.data as Record<string, unknown>).models
    if (Array.isArray(nested)) return nested
  }
  if (Array.isArray(root.result)) return root.result
  return null
}

/**
 * Parse a `/models` response.
 *
 * Supported shapes: `{data:[...]}`, `{models:[...]}`, `{data:{models:[...]}}`,
 * `{result:[...]}` and a bare array. A row must have a string `id` (some
 * gateways call it `model`); `display_name`, `displayName` or `name` is used as
 * the label when present.
 *
 * Returns null when the response is not a model list or contains no usable
 * rows. The caller turns that into the user-visible "cannot fetch" state --
 * never into an empty but "successful" dropdown.
 */
export function parseAiModelList(
  raw: string,
  vendor: AiModelVendor
): AiModelInfo[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const rows = rowsOf(parsed)
  if (rows === null) return null

  const collect = (vendorOnly: boolean): AiModelInfo[] => {
    const out: AiModelInfo[] = []
    const seen = new Set<string>()
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const obj = row as Record<string, unknown>
      const idRaw =
        typeof obj.id === 'string'
          ? obj.id
          : typeof obj.model === 'string'
            ? obj.model
            : // Gemini's native list puts the id in `name` (models/...), with no
              // `id` field at all.
              vendor === 'gemini' && typeof obj.name === 'string'
              ? obj.name
              : ''
      /*
       * Gemini's native list prefixes every id with `models/`. The OpenAI
       * compatibility chat endpoint takes the id without that prefix; sending
       * `models/gemini-1.5-pro` there is a 404 on some versions.
       */
      const id =
        vendor === 'gemini' ? idRaw.trim().replace(/^models\//i, '') : idRaw.trim()
      if (id === '' || seen.has(id)) continue
      if (vendorOnly && !vendorRowAllowed(vendor, obj, id)) continue
      const apiName =
        typeof obj.display_name === 'string'
          ? obj.display_name
          : typeof obj.displayName === 'string'
            ? obj.displayName
            : typeof obj.name === 'string'
              ? obj.name
              : undefined
      seen.add(id)
      out.push({ id, name: prettyAiModelName(vendor, id, apiName) })
    }
    return out
  }

  // Prefer rows that belong to the selected vendor; fall back to the raw list
  // when that would leave the dropdown empty (see vendorRowAllowed).
  const preferred = collect(true)
  const out = preferred.length > 0 ? preferred : collect(false)
  if (out.length === 0) return null

  return orderModels(vendor, disambiguate(filterChatModels(out)))
}
