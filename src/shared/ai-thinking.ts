/**
 * Thinking depth: what the user picks, what the model can actually do, and the
 * wire-level translation.
 *
 * Why this is a separate pure module:
 *   - The settings page needs the same recommendation and capability flags as
 *     the request layer. Two copies would drift, and the symptom would be
 *     "the UI says high but the request still uses the default".
 *   - Every value here is plain data. Main, renderer and Vitest all import the
 *     same functions, so a bad value cannot sneak in through one side only.
 *
 * No user-visible strings and no I/O live here. The four hint sentences are in
 * shared/copy.ts; this file only returns the level, the note kind and the
 * request parameters.
 */
import { isOpenAiReasoningModel, type AiProviderId } from './ai-providers'
import type { AiMode } from './free-pool'

export const AI_THINKING_LEVELS = ['off', 'low', 'medium', 'high'] as const

export type AiThinking = (typeof AI_THINKING_LEVELS)[number]

/**
 * Per-model memory is a convenience, not a dataset. A hundred entries would
 * already mean the user tried more models than this app can reasonably show;
 * keeping the map small also keeps config.json readable.
 */
export const AI_THINKING_MAP_CAP = 64

/** Longest acceptable key. Real keys are mode:provider:model, well under this. */
const THINKING_KEY_MAX = 200

export function isAiThinking(v: unknown): v is AiThinking {
  return typeof v === 'string' && (AI_THINKING_LEVELS as readonly string[]).includes(v)
}

/**
 * Read a level. A missing/garbled value falls back to `medium`; the
 * model-aware recommendation is applied by resolveAiThinking, not here, because
 * this helper is also used where only a safe default is needed.
 */
export function aiThinkingOf(v: unknown, fallback: AiThinking = 'medium'): AiThinking {
  return isAiThinking(v) ? v : fallback
}

/**
 * Key for one remembered choice.
 *
 * Mode and provider are part of the key on purpose: the same model id means
 * different wire capabilities at different providers, and the free pool is a
 * different route entirely. Switching back to a route restores exactly the
 * choice made there.
 */
export function aiThinkingKey(mode: AiMode, provider: AiProviderId, model: string): string {
  return `${mode}:${provider}:${model.trim()}`
}

/**
 * Keep only well-formed entries. This is a read-side guard for old/corrupted
 * config files: an unknown level must not reach the select (it would render as
 * an empty choice) and a non-string key must not become `[object Object]`.
 */
export function sanitizeAiThinkingMap(v: unknown): Record<string, AiThinking> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, AiThinking> = {}
  for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
    if (key === '' || key.length > THINKING_KEY_MAX) continue
    if (!isAiThinking(value)) continue
    out[key] = value
  }
  return out
}

/**
 * Cap the map while making sure the current key survives.
 *
 * Objects preserve insertion order, so "last N entries" is the closest thing
 * to "most recently used" without storing timestamps. The current key is
 * inserted last so a just-made choice can never be the one evicted.
 */
function capThinkingMap(
  map: Record<string, AiThinking>,
  keep: string
): Record<string, AiThinking> {
  const keys = Object.keys(map)
  const others = keys.filter((k) => k !== keep)
  const room = map[keep] === undefined ? AI_THINKING_MAP_CAP : AI_THINKING_MAP_CAP - 1
  const kept = room > 0 ? others.slice(-room) : []
  const out: Record<string, AiThinking> = {}
  for (const k of kept) out[k] = map[k]
  if (map[keep] !== undefined) out[keep] = map[keep]
  return out
}

export interface AiThinkingState {
  thinking: AiThinking
  thinkingByModel: Record<string, AiThinking>
}

/**
 * Resolve without remembering anything.
 *
 * Used by read paths (config migration, toPublicConfig): opening the app must
 * not invent state. If the user never picked a level, the recommendation is
 * returned but the map stays empty, so the file on disk is not rewritten just
 * by being read. Write paths use resolveAiThinking below.
 */
export function readAiThinking(input: {
  mode: AiMode
  provider: AiProviderId
  model: string
  rawThinking: unknown
  rawMap: unknown
}): AiThinkingState {
  const map = sanitizeAiThinkingMap(input.rawMap)
  const remembered = map[aiThinkingKey(input.mode, input.provider, input.model)]
  return {
    thinking: isAiThinking(input.rawThinking)
      ? input.rawThinking
      : (remembered ?? recommendedAiThinking(input.mode, input.provider, input.model)),
    thinkingByModel: map
  }
}

/**
 * Resolve the current level and the map together.
 *
 * Priority:
 *   1. an explicit valid top-level level (the user's latest action);
 *   2. a valid remembered entry for this mode/provider/model;
 *   3. the recommendation for this model.
 *
 * The current key is always written back to the map, so a choice made once is
 * still there after a round trip through another model.
 */
export function resolveAiThinking(input: {
  mode: AiMode
  provider: AiProviderId
  model: string
  rawThinking: unknown
  rawMap: unknown
}): AiThinkingState {
  const map = sanitizeAiThinkingMap(input.rawMap)
  const key = aiThinkingKey(input.mode, input.provider, input.model)
  const remembered = isAiThinking(map[key]) ? map[key] : undefined
  const thinking = isAiThinking(input.rawThinking)
    ? input.rawThinking
    : (remembered ?? recommendedAiThinking(input.mode, input.provider, input.model))
  map[key] = thinking
  return { thinking, thinkingByModel: capThinkingMap(map, key) }
}

/**
 * Which control actually exists:
 *   - `prompt-only` : no wire parameter; only the system prompt changes;
 *   - `always-on`   : the model thinks on its own and the API cannot turn it off;
 *   - `min-only`    : the wire accepts effort but not a full off;
 *   - `model-switch`: deepseek-chat and deepseek-reasoner are swapped;
 *   - `pool`        : the gateway picks the model, so capability is unknown.
 */
export type AiThinkingNote =
  | 'prompt-only'
  | 'always-on'
  | 'min-only'
  | 'model-switch'
  | 'pool'

export interface AiThinkingCapability {
  recommended: AiThinking
  note: AiThinkingNote
  /** True when the level changes something in the request body/model. */
  wire: boolean
  /** False when even the lowest choice cannot fully stop the model thinking. */
  canOff: boolean
}

/** Model-family helpers shared by the recommendation and custom-model checks. */
function looksLikeReasoner(model: string): boolean {
  const m = model.trim().toLowerCase()
  return isOpenAiReasoningModel(m) || /(?:reasoner|thinking|\br[12]\b)/.test(m)
}

function looksSmall(model: string): boolean {
  // Word boundaries matter: `minimax` contains `mini` but is a flagship family,
  // not a small one. Every real small-model token stands as its own segment
  // (gpt-4o-mini, qwen-turbo, deepseek-v4-flash), which `\b` recognizes even
  // across hyphens.
  return /\b(?:mini|nano|flash|turbo|lite|small|speed)\b/.test(model.trim().toLowerCase())
}

/**
 * The level the UI marks as recommended for this exact model.
 *
 * The rule is deliberately conservative:
 *   - dedicated reasoning models get `high` (that is what they are for);
 *   - small/fast models get `low` (asking them for long chains is a bad trade);
 *   - flagship non-reasoning models get `high` for question quality;
 *   - everything else gets `medium`.
 *
 * Free pool is a special case: the gateway chooses the model, so there is no
 * capability to adapt to and `medium` is the honest middle.
 */
export function recommendedAiThinking(
  mode: AiMode,
  provider: AiProviderId,
  model: string
): AiThinking {
  if (mode === 'pool') return 'medium'
  const m = model.trim().toLowerCase()
  if (provider === 'anthropic') {
    if (m.includes('opus')) return 'high'
    if (m.includes('haiku')) return 'low'
    return 'medium'
  }
  if (provider === 'openai') {
    if (isOpenAiReasoningModel(m)) return looksSmall(m) ? 'medium' : 'high'
    if (looksSmall(m)) return 'low'
    return 'medium'
  }
  if (provider === 'deepseek') {
    if (/(?:reasoner|thinking|\br[12]\b)/.test(m)) return 'high'
    if (looksSmall(m)) return 'low'
    // Word boundaries: `minimax-m2` contains "max" but is not a max tier.
    if (/\b(?:pro|max)\b/.test(m)) return 'high'
    return 'medium'
  }
  if (provider === 'qwen') {
    if (looksSmall(m)) return 'low'
    if (/\b(?:max|pro)\b/.test(m)) return 'high'
    return 'medium'
  }
  if (provider === 'kimi') {
    if (/(?:thinking|reason|\bk[23]\b)/.test(m)) return 'high'
    if (looksSmall(m)) return 'low'
    return 'medium'
  }
  /*
   * 2026-11-01 的五家 OpenAI 兼容厂商（智谱 / xAI / Google / 百度 / 腾讯混元）。
   *
   * 没有为每家写一套专属规则：这些厂商的型号命名本身就是「档位 + 家族」
   * （glm-4-flash、gemini-1.5-pro、ernie-speed、hunyuan-pro），按型号词根
   * 判断比按厂商硬编码更不容易过期。将来它们换名字也仍然有效。
   */
  if (
    provider === 'zhipu' ||
    provider === 'xai' ||
    provider === 'gemini' ||
    provider === 'baidu' ||
    provider === 'hunyuan'
  ) {
    if (looksLikeReasoner(m)) return looksSmall(m) ? 'medium' : 'high'
    if (looksSmall(m)) return 'low'
    if (/\b(?:pro|max)\b/.test(m)) return 'high'
    return 'medium'
  }
  // custom: infer from the model id only; the gateway itself is unknown.
  if (looksLikeReasoner(m)) return looksSmall(m) ? 'medium' : 'high'
  if (looksSmall(m)) return 'low'
  if (/\b(?:pro|max)\b/.test(m)) return 'high'
  return 'medium'
}

export function aiThinkingCapability(
  mode: AiMode,
  provider: AiProviderId,
  model: string
): AiThinkingCapability {
  const recommended = recommendedAiThinking(mode, provider, model)
  if (mode === 'pool') return { recommended, note: 'pool', wire: false, canOff: false }
  if (provider === 'custom') {
    return { recommended, note: 'prompt-only', wire: false, canOff: true }
  }
  if (provider === 'openai') {
    if (isOpenAiReasoningModel(model)) {
      return { recommended, note: 'min-only', wire: true, canOff: false }
    }
    return { recommended, note: 'prompt-only', wire: false, canOff: true }
  }
  if (provider === 'deepseek') {
    const m = model.trim().toLowerCase()
    if (m === 'deepseek-chat' || m === 'deepseek-reasoner') {
      return { recommended, note: 'model-switch', wire: true, canOff: true }
    }
    return { recommended, note: 'prompt-only', wire: false, canOff: true }
  }
  if (provider === 'anthropic') {
    // Current Claude models think adaptively; an explicit thinking parameter
    // has already caused 400s (see anthropicBody). Prompt-only is the honest
    // description of what this control does here.
    return { recommended, note: 'always-on', wire: false, canOff: false }
  }
  /*
   * Qwen, Zhipu, xAI, Gemini, Baidu and Hunyuan are deliberately prompt-only.
   *
   * Each vendor has some native thinking switch (`enable_thinking`,
   * `reasoning_effort`, Gemini thinkingConfig, ...), but the support differs by
   * model *and* by the OpenAI-compatibility layer. An unknown field in the body
   * is a hard 400 on several of them -- and the user only sees "model name is
   * wrong". A prompt instruction costs a few tokens; a rejected request costs
   * the whole answer. The instruction is appended to the existing system
   * prompt, so the cat/fish persona is never replaced.
   */
  return { recommended, note: 'prompt-only', wire: false, canOff: true }
}

export interface AiThinkingPlan {
  /** Model id actually sent on the wire (deepseek may swap chat/reasoner). */
  model: string
  /** Preserved for the prompt instruction and diagnostics. */
  level: AiThinking
  /** OpenAI reasoning_effort. Off becomes low on models that cannot fully stop. */
  reasoningEffort?: 'low' | 'medium' | 'high'
  /** True when the plan changed the model id. */
  switched: boolean
  /** True when something besides the prompt changes on the wire. */
  wire: boolean
}

/**
 * Translate the selected level into request parameters.
 *
 * Nothing here is sent unless the provider/model is known to accept it:
 *   - OpenAI o-series/GPT-5: reasoning_effort (low/medium/high);
 *   - DeepSeek: swap deepseek-chat <-> deepseek-reasoner at the two ends;
 *   - Anthropic/Qwen/Zhipu/xAI/Gemini/Baidu/Hunyuan/custom: prompt only
 *     (no risky unknown fields).
 */
export function planAiThinking(input: {
  mode: AiMode
  provider: AiProviderId
  model: string
  level: AiThinking
}): AiThinkingPlan {
  const { mode, provider, level } = input
  const model = input.model.trim()
  const base: AiThinkingPlan = { model, level, switched: false, wire: false }

  if (mode === 'pool' || provider === 'custom') return base

  if (provider === 'openai') {
    if (!isOpenAiReasoningModel(model)) return base
    return {
      ...base,
      wire: true,
      reasoningEffort: level === 'off' ? 'low' : level
    }
  }

  if (provider === 'deepseek') {
    const m = model.toLowerCase()
    if (m === 'deepseek-chat' && level === 'high') {
      return { ...base, model: 'deepseek-reasoner', switched: true, wire: true }
    }
    if (m === 'deepseek-reasoner' && (level === 'off' || level === 'low')) {
      return { ...base, model: 'deepseek-chat', switched: true, wire: true }
    }
    return base
  }

  return base
}

/**
 * Reasoning models spend output budget before writing the answer. A ping with
 * `max_tokens: 8` would come back empty and look like "connection failed".
 * The request layer adds headroom when this returns a positive number.
 *
 * Two sizes:
 *   - 1K for the models that already had headroom before v24 (OpenAI
 *     reasoning, DeepSeek reasoner, unknown custom ids that look like
 *     reasoners). Their useful output is the only thing that needs protecting.
 *   - 8K for models whose thinking runs by default through a compatibility
 *     layer (Gemini 2.5+, Zhipu GLM-4.5/4.6/4.7/5.x, Hunyuan Hy3/Hy4). Those
 *     do a full internal pass for a 20-question JSON task, and 1K would still
 *     leave the visible answer truncated -- which the app reports as "AI did
 *     not generate anything" and silently falls back to the local bank.
 *
 * A bigger max_tokens is only a ceiling, not a spend: the provider bills the
 * tokens actually produced. Passing too small a ceiling is the expensive bug --
 * it throws away the whole request.
 */
const HEADROOM_SMALL = 1024
const HEADROOM_LARGE = 8192

export function planReasoningHeadroom(
  provider: AiProviderId,
  plan: AiThinkingPlan
): number {
  if (plan.reasoningEffort !== undefined) return HEADROOM_SMALL
  if (provider === 'deepseek' && /reasoner/i.test(plan.model)) return HEADROOM_SMALL
  if (provider === 'gemini' && geminiThinksByDefault(plan.model)) return HEADROOM_LARGE
  if (provider === 'zhipu' && zhipuThinksByDefault(plan.model)) return HEADROOM_LARGE
  if (provider === 'hunyuan' && hunyuanThinksByDefault(plan.model)) return HEADROOM_LARGE
  if (provider === 'custom' && looksLikeReasoner(plan.model)) return HEADROOM_SMALL
  return 0
}

export function planNeedsReasoningHeadroom(
  provider: AiProviderId,
  plan: AiThinkingPlan
): boolean {
  return planReasoningHeadroom(provider, plan) > 0
}

/**
 * Gemini 2.5+ answers only after an internal thinking pass, even through the
 * OpenAI compatibility layer. A short ping (the connection test or one pet
 * line) with a tiny output budget can come back with empty content, which the
 * UI would report as a connection failure. 1.5 and earlier do not think by
 * default, so they keep their original budget.
 */
function geminiThinksByDefault(model: string): boolean {
  const m = model.trim().toLowerCase()
  if (m.includes('thinking')) return true
  return /(?:^|[-/])2\.5(?:[-.]|$)/.test(m) || /(?:^|[-/])3(?:[-.]|$)/.test(m)
}

/**
 * Zhipu's thinking mode is on by default for GLM-4.5 / 4.6 / 4.7 / 5.x, and
 * its reasoning tokens count against `max_tokens`. The legacy GLM-4 generation
 * (glm-4-plus, glm-4-flash) does not think, so it must not pay the bigger
 * ceiling (its own output cap is only 4095 anyway).
 */
function zhipuThinksByDefault(model: string): boolean {
  return /^glm-(?:5|4\.[567])(?:[-.]|$)/.test(model.trim().toLowerCase())
}

/**
 * Hunyuan's Hy3 / Hy4 are thinking-first models and Tencent documents that
 * reasoning and answer share `max_tokens` (recommended total >= 16000).
 * hy-mt2 (translation) and hy-role are not in this family.
 */
function hunyuanThinksByDefault(model: string): boolean {
  return /^hy[34](?:[-.]|$)/.test(model.trim().toLowerCase())
}
