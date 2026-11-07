/**
 * AI 服务商目录：**谁能用、地址是什么、模型从哪来**。
 *
 * 【为什么要有一张表】旧版让用户手填 BaseURL，零基础用户只能去网上抄一段
 * 别人帖子里的地址；抄错一个字母就是「连不上」，而他根本不知道错在哪。
 * 2026-11-01 起改成「选厂商 → 填 Key → 选模型」，地址由这张表给。
 *
 * 【它和 magpie / FISH Dock 的关系】FISH Dock 的做法是在本机跑一个网关
 * （OFM / magpie），把各家渠道归一成 OpenAI 兼容 API，客户端只填
 * `127.0.0.1:18901/v1`。那套东西是**另一个独立软件**，有自己的进程、
 * 端口和更新节奏，不能塞进咪爱编程的安装包。这里采用同一条策略的轻量版：
 * 把「渠道适配」收在主进程的 AI 层（src/main/ai/deepseek.ts），用户仍然
 * 只选厂商、只填 Key，不需要知道 BaseURL 长什么样。
 *
 * ⚠️ 本文件会被 renderer 与 main 同时引用，**只放数据与纯函数**：
 * 不放 fetch、不放 Node API，也不放用户可见的中文文案（文案在 copy.ts）。
 */

export const AI_PROVIDER_IDS = [
  'deepseek',
  'openai',
  'anthropic',
  'qwen',
  'kimi',
  'zhipu',
  'xai',
  'gemini',
  'baidu',
  'hunyuan',
  'custom'
] as const

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number]

/** 接口方言：OpenAI 兼容的 chat/completions，还是 Anthropic 的 messages */
export type AiWireFormat = 'openai' | 'anthropic'

/** 余额接口的方言；`none` = 该厂商没有公开的余额查询接口 */
export type AiBalanceKind = 'deepseek' | 'kimi' | 'none'

export interface AiProviderMeta {
  id: AiProviderId
  /** 官方地址。`custom` 是空串 —— 它的地址由用户自己填 */
  baseUrl: string
  format: AiWireFormat
  /** 下拉框里列出的常用模型。**顺序就是展示顺序** */
  models: readonly string[]
  /** 是否支持 OpenAI 的 `response_format: json_object` */
  jsonMode: boolean
  balance: AiBalanceKind
  /** 这个厂商的 Key 在哪个后台拿（给设置页做链接，不参与请求） */
  keyUrl: string
}

export const AI_PROVIDERS: Record<AiProviderId, AiProviderMeta> = {
  deepseek: {
    id: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    format: 'openai',
    // deepseek-chat 是通用对话（出题/讲报错/聊天都用它）；
    // reasoner 留给想省钱的用户自己选，它更慢但更会推理。
    models: ['deepseek-chat', 'deepseek-reasoner'],
    jsonMode: true,
    balance: 'deepseek',
    keyUrl: 'https://platform.deepseek.com/api_keys'
  },
  openai: {
    id: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    format: 'openai',
    // gpt-4o 是主人点名的默认档；o1 系走 reasoning 分支（见 isOpenAiReasoningModel）
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o1', 'o1-mini', 'o3-mini'],
    jsonMode: true,
    // OpenAI 的余额接口要组织管理员 Key，个人 Key 查不到 —— 如实降级
    balance: 'none',
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  anthropic: {
    id: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    format: 'anthropic',
    /*
     * 只列**当前在售**的 Claude 5 家族（2026-11 口径）：
     *   · claude-sonnet-5-5 是默认档（速度与质量平衡，出题/聊天够用）；
     *   · opus 更强也更贵，haiku 最便宜。
     * 旧 ID（claude-3-5-sonnet-20241022 等）已经退役，列在框里只会让
     * 用户选到一个必然 404 的模型 —— 下拉框里每个选项都必须是「能接通」的。
     */
    models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'],
    jsonMode: false,
    balance: 'none',
    keyUrl: 'https://console.anthropic.com/settings/keys'
  },
  qwen: {
    id: 'qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    format: 'openai',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-coder-plus'],
    // 百炼兼容模式对 response_format 的支持随模型而异；关掉它靠提示词要 JSON，
    // safeJson 会剥围栏。宁可少一层保障，也不要一开就 400。
    jsonMode: false,
    balance: 'none',
    keyUrl: 'https://bailian.console.aliyun.com/'
  },
  kimi: {
    id: 'kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    format: 'openai',
    models: ['kimi-latest', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    jsonMode: false,
    balance: 'kimi',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys'
  },
  /*
   * 2026-11-01 第二批多厂商（主人点名）：
   * 智谱、xAI、Google、百度千帆、腾讯混元。全部走 OpenAI 兼容的
   * chat/completions，因此 format 都是 openai，不需要新的 wire 分支。
   *
   * 这几家的 `models` 只用于「切厂商时的默认模型 + 清单排序」；真实下拉框
   * 仍然由 /models 动态拉取（见 ai-models.ts）。厂商出新模型不需要改这里，
   * 只有默认档想换时才动。
   *
   * ⚠️ 下面五组模型名不是照抄需求原文：原文给的几个档位在 2026-11-01 已经
   * 下线或不存在，抄进去等于让用户的第一次调用必然 404。逐条证据见
   * 2026-11-01 的调研（每条都对应下面那条注释）：
   *   · zhipu  glm-4-plus / glm-4-flash 不在现行请求 schema 的 model 枚举里，
   *     且输出上限只有 4095（出题要 8192）；现行免费档是 glm-4.7-flash。
   *   · xAI    grok-beta 早在 2024-12 就废弃，2025-06 起已是 model-not-found。
   *     现役最便宜的对话档是 grok-4.3。
   *   · Gemini 1.5 整个家族 2025-09-24 关停（404）；现役是 2.5 线。
   *   · 百度   ernie-4.0-8k 不在 2026-10-29 的文本生成模型清单里，现旗舰 ernie-5.1。
   *   · 腾讯   旧平台 api.hunyuan.cloud.tencent.com 已于 2026-09-30 停服，
   *     hunyuan-standard / hunyuan-pro 已于 2026-06-22 下线；现役入口是
   *     TokenHub，默认档 hy3。
   *
   * jsonMode 一律 false：每家对 `response_format` 的支持随模型/版本而变，
   * 多一个字段就多一种 400 的可能。出题的提示词本来就把 JSON 形状写死了，
   * safeJson 还会剥围栏，少这一层保障是划算的。
   */
  zhipu: {
    id: 'zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    format: 'openai',
    // glm-4.7-flash 是现行免费档；glm-4.6 是付费档里最便宜的一档。
    models: ['glm-4.7-flash', 'glm-4.6'],
    jsonMode: false,
    balance: 'none',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys'
  },
  xai: {
    id: 'xai',
    baseUrl: 'https://api.x.ai/v1',
    format: 'openai',
    // grok-4.3 是现役最便宜的对话档（1M 上下文）；grok-4.7 是旗舰。
    models: ['grok-4.3', 'grok-4.7'],
    jsonMode: false,
    balance: 'none',
    keyUrl: 'https://console.x.ai/'
  },
  gemini: {
    id: 'gemini',
    // Google 官方 OpenAI 兼容层的地址。尾斜杠是官方文档的写法，拼接前会剥掉。
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    format: 'openai',
    // flash 在前 = 默认选便宜的；pro 给需要更强推理的人。
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    jsonMode: false,
    balance: 'none',
    keyUrl: 'https://aistudio.google.com/app/apikey'
  },
  baidu: {
    id: 'baidu',
    // 千帆 v2 的 OpenAI 兼容入口。**只认这一个精确域名**：baidubce.com 底下
    // 还有很多别的服务，不能像 *.aliyuncs.com 那样整个域都算数。
    baseUrl: 'https://qianfan.baidubce.com/v2',
    format: 'openai',
    models: ['ernie-5.1'],
    jsonMode: false,
    balance: 'none',
    keyUrl: 'https://console.bce.baidu.com/qianfan/'
  },
  hunyuan: {
    id: 'hunyuan',
    /*
     * 混元现役入口是 TokenHub（旧平台 2026-09-30 停服，Key 也不通用）。
     * 同样只认精确域名：腾讯云底下还有对象存储、短信等一堆服务，不能把
     * 整个 tencent.com / tencentmaas.com 认成混元。
     *
     * hy3 是性价比档（256k 上下文），hy4-preview 是旗舰档；旧名
     * hunyuan-standard / hunyuan-pro 已于 2026-06-22 下线。
     */
    baseUrl: 'https://tokenhub.tencentmaas.com/v1',
    format: 'openai',
    models: ['hy3', 'hy4-preview'],
    jsonMode: false,
    balance: 'none',
    keyUrl: 'https://console.cloud.tencent.com/tokenhub/apikey'
  },
  custom: {
    id: 'custom',
    baseUrl: '',
    format: 'openai',
    models: [],
    jsonMode: true,
    balance: 'none',
    keyUrl: ''
  }
}

export function isAiProviderId(v: unknown): v is AiProviderId {
  return typeof v === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(v)
}

/** 读厂商元数据。**坏值退回 deepseek**，与默认配置同一方向 */
export function aiProviderOf(id: unknown): AiProviderMeta {
  return isAiProviderId(id) ? AI_PROVIDERS[id] : AI_PROVIDERS.deepseek
}

/** 新选一个厂商时用哪个模型：列表第一条；`custom` 没有列表，给空串让用户填 */
export function defaultModelOf(id: AiProviderId): string {
  return AI_PROVIDERS[id].models[0] ?? ''
}

/**
 * 从旧配置的 BaseURL 认厂商（v20 → v21 迁移用）。
 *
 * 认不出来 = 用户当年填的是中转/自建网关 → `custom`，**地址和 Key 原样保留**。
 * 绝不能把它硬塞给某个官方厂商：那会把请求发到官方域名，用户的 Key 和
 * 中转的配额都不对。
 */
export function providerForBaseUrl(baseUrl: string): AiProviderId {
  let host = ''
  try {
    const raw = /^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrl.trim())
      ? baseUrl.trim()
      : `https://${baseUrl.trim()}`
    host = new URL(raw).hostname.toLowerCase()
  } catch {
    return 'custom'
  }
  if (host === 'api.deepseek.com' || host.endsWith('.deepseek.com')) return 'deepseek'
  if (host === 'api.openai.com' || host.endsWith('.openai.com')) return 'openai'
  if (host === 'api.anthropic.com' || host.endsWith('.anthropic.com')) return 'anthropic'
  /*
   * 只有百炼（DashScope）的两个域名算 qwen。
   * **不能写成 `*.aliyuncs.com`**：阿里云底下还有 OSS / ECS / 短信等一长串
   * 服务，用户把其中任意一个粘进来都会被认成 qwen，于是 Key 被发去
   * dashscope.aliyuncs.com —— 跨服务发凭据，比认不出严重得多。
   */
  if (host === 'dashscope.aliyuncs.com' || host === 'dashscope-intl.aliyuncs.com') return 'qwen'
  if (host === 'api.moonshot.cn' || host === 'api.moonshot.ai' || host.endsWith('.moonshot.cn') || host.endsWith('.moonshot.ai')) {
    return 'kimi'
  }
  // 2026-11-01 新增的五家（v20 老配置的地址识别）。同样遵守「只认官方域」：
  // 百度和腾讯只认精确主机名，绝不把 *.baidubce.com / *.tencent.com 整片认走
  // —— 那些域下还有对象存储、短信等一堆服务，认错就会跨服务发 Key。
  if (host === 'open.bigmodel.cn' || host.endsWith('.bigmodel.cn')) return 'zhipu'
  if (host === 'api.x.ai' || host.endsWith('.x.ai')) return 'xai'
  if (host === 'generativelanguage.googleapis.com') return 'gemini'
  if (host === 'qianfan.baidubce.com') return 'baidu'
  /*
   * 混元：现役是 TokenHub 的四个官方主机名（广州/新加坡/英文文档写法），
   * 旧平台 api.hunyuan.cloud.tencent.com 也一并认领 —— 它已经停服，但老
   * 配置认出来后会迁到现役地址，比继续往一个死地址发请求强。
   */
  if (
    host === 'tokenhub.tencentmaas.com' ||
    host === 'tokenhub.tencentmaas.cn' ||
    host === 'tokenhub.tencentcloudmaas.com' ||
    host === 'tokenhub-intl.tencentmaas.com' ||
    host === 'api.hunyuan.cloud.tencent.com'
  ) {
    return 'hunyuan'
  }
  return 'custom'
}

/** 厂商在某次请求里真正该用的地址：官方厂商用表里的，自定义用用户填的 */
export function baseUrlOf(provider: AiProviderId, customBaseUrl: string): string {
  return provider === 'custom' ? customBaseUrl.trim() : AI_PROVIDERS[provider].baseUrl
}

/**
 * OpenAI 的推理模型（o1/o3/o4/gpt-5 系）与普通聊天模型有四处不同：
 *   · 用 `max_completion_tokens`，不认 `max_tokens`；
 *   · 不认 `temperature`（传了会 400）；
 *   · system 角色要写成 `developer`；
 *   · 部分型号不认 `response_format`，所以出题时也不带它。
 * 不处理这四条，用户一选 o1 就会看到「服务地址或模型名不对」。
 */
export function isOpenAiReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5)/i.test(model.trim())
}

/**
 * 从 Key 的形状认厂商（设置页「填哪家出哪家」）。
 *
 * **只认有把握的前缀**：
 *   · `sk-ant-` → Anthropic（Claude 的 Key 固定这么开头）
 *   · `sk-proj-` / `sk-svcacct-` / `sk-admin-` → OpenAI（新版项目/服务账号 Key）
 *
 * 【为什么不能看到 `sk-` 就猜】DeepSeek、Kimi、阿里百炼的 Key 全都是
 * `sk-` 开头，而且其中好几家是 `sk-` + 32 位十六进制 —— **同一个形状**。
 * 猜错不是显示问题：它会把用户的 Key 发到另一家服务商。宁可让用户在
 * 上面的下拉框里自己确认一次，也不能替他猜。
 *
 * 返回 `null` = 认不出，调用方保持当前选择。
 */
export function detectAiProviderFromKey(key: string): AiProviderId | null {
  const k = key.trim()
  if (/^sk-ant-[A-Za-z0-9_-]{8,}$/.test(k)) return 'anthropic'
  if (/^sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{8,}$/i.test(k)) return 'openai'
  return null
}
