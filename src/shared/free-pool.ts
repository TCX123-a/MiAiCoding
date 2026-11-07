/**
 * 免费公开池（团队 OFM 开源项目那一侧）的**唯一真源**。
 *
 * 【它是什么】FISH Dock 的 `dsh-our-free-model` 把一批免费模型汇到一条
 * OpenAI 兼容的网关后面（`https://api.kilo.ai/api/gateway`）。这套东西
 * **不需要 Key**：`GET /models` 列出渠道，`POST /chat/completions` 直接聊，
 * 免费档在清单里带 `isFree: true`。
 *
 * 【为什么不把 FISH Dock / magpie 塞进安装包】它们是独立进程、独立端口、
 * 独立更新节奏的另一套软件。咪爱编程只取它**服务端已经公开的那条 HTTP
 * 接口**，本进程照旧只有 `src/main/ai/deepseek.ts` 一处联网 —— 用户不用
 * 额外装东西，也不用知道网关长什么样。
 *
 * 【为什么要固定一个默认模型】免费池的清单是**远端**给的，第一次打开设置页
 * 时可能正好断网。没有兜底模型的话，模式 B 会在「清单拉不到」时变成一个
 * 空下拉框 —— 用户看到的是「这个模式坏了」。固定一个 `kilo-auto/free`
 * （由服务端自动挑一个免费模型）先能跑，清单回来后再补充可选项。
 *
 * ⚠️ 本文件同时被 main 与 renderer 引用，**只放常量与纯函数**：
 * 不放 fetch、不放 Node API、不放用户可见的中文文案（文案在 copy.ts）。
 */

/** 两种接入方式：A = 用户自己的 Key；B = 免费公开池 */
export const AI_MODES = ['api', 'pool'] as const

export type AiMode = (typeof AI_MODES)[number]

/** 免费池网关的根地址（与 dsh-our-free-model 的 KILO_BASE 同值） */
export const FREE_POOL_BASE = 'https://api.kilo.ai/api/gateway'

/**
 * 兜底模型。服务端会把它路由到一个当前可用的免费模型；
 * 清单拉不到时它就是唯一选项，保证模式 B 仍然能用。
 */
export const FREE_POOL_DEFAULT_MODEL = 'kilo-auto/free'

/** `/models` 的等待上限：设置页的一次列表请求，不该让人干等 */
export const POOL_MODELS_TIMEOUT_MS = 15_000

/** 从免费池清单里挑出来的一项 */
export interface AiPoolModel {
  id: string
  /** 展示名。远端没给 name 时等于 id，界面直接显示 */
  name: string
}

export function isAiMode(v: unknown): v is AiMode {
  return typeof v === 'string' && (AI_MODES as readonly string[]).includes(v)
}

/**
 * 读模式。**坏值一律退回 `api`** —— 与 v21 之前的行为逐字节相同：
 * 老配置没有这个字段时，用户仍然用自己的 Key 走专属模式。
 */
export function aiModeOf(v: unknown): AiMode {
  return isAiMode(v) ? v : 'api'
}

/** 读免费池模型名。空白/非字符串退回兜底模型，绝不让请求发一个空模型名 */
export function poolModelOf(v: unknown): string {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : FREE_POOL_DEFAULT_MODEL
}
