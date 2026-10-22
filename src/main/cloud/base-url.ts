/**
 * 云服务器地址的裁决处 —— 全仓唯一决定「往哪发」的地方。
 *
 * 【三条规则，各有单测】
 *   1. **打包版忽略环境变量**：环境变量是开发/调试设施，打包版还认它的话，
 *      一个被改过的环境变量就能把整机应用的凭据引到别人的服务器上
 *      （凭据重定向）。打包版一律走构建期常量 PROD_DEFAULT_BASE_URL。
 *   2. **明文 http 只放行回环地址**：`http://127.0.0.1:8787`（本地开发服务器）
 *      不加密只是本地回环、出不了本机；一旦主机名不是回环，必须 https ——
 *      否则用户名密码就明文上公网了。不合法 = 空串（未配置），
 *      绝不"退回默认值"或"先记下来"（判定为真的路上不许有不需要证据的分支）。
 *   3. **空串 = 未配置**：不是错误，是如实状态（渲染层显示"服务器未配置"），
 *      transport 见空串直接回 NOT_CONFIGURED、一次网络都不发。
 *
 * 【开源版的默认值】本仓库**不内置任何作者的服务器地址**：打包版默认值
 * 是空串（未配置），此时云同步/账号相关功能显示"服务器未配置"。想接自建
 * 后端的发行者，请在打包前把 PROD_DEFAULT_BASE_URL 改成自己的 https 地址，
 * 并同批更新 base-url.test.ts 里钉这个字符串的用例。地址只许随发版改变，
 * 改地址 = 发一版（与规则 1 同源）。
 */
/** 开发期默认服务器（server 的 PORT 默认 8787，见 server/src/config.ts） */
export const DEV_DEFAULT_BASE_URL = 'http://127.0.0.1:8787'

/**
 * 打包版默认服务器 —— 开源版为空串（未配置），不指向任何作者基础设施。
 * 自建后端时改成自己的 https 地址；必须同批更新 base-url.test.ts 钉这个
 * 字符串的用例。
 */
export const PROD_DEFAULT_BASE_URL = ''

/** 覆盖开发期默认值的环境变量名。⚠️ 只在打包版**之外**生效（见文件头规则 1） */
export const BASE_URL_ENV_VAR = 'MIAI_CLOUD_BASE_URL'

/** 回环判定：localhost / 127.0.0.0/8 / [::1]。只看主机名，不看端口 */
function isLoopbackHost(hostname: string): boolean {
  if (hostname === 'localhost') return true
  if (hostname === '[::1]' || hostname === '::1') return true
  if (/^127(\.\d{1,3}){3}$/.test(hostname)) return true
  return false
}

/**
 * 收口一条候选地址；不合法返回 null（由调用方决定是"未配置"还是"退回默认值"）。
 * 顺带把末尾斜杠削掉，让拼接 `/v1/...` 的地方只有一种形状。
 */
function normalizeBaseUrl(candidate: string): string | null {
  const trimmed = candidate.trim()
  if (trimmed === '') return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) return null
  // 带路径的地址（如 https://host/api）保留路径，只削末尾斜杠
  return url.href.replace(/\/+$/, '')
}

export interface CloudBaseUrlContext {
  /** 打包了吗（Electron 的 app.isPackaged）；决定环境变量是否放行 */
  packaged: boolean
  /** 环境变量来源（进程环境）；打包版忽略之 */
  env: Record<string, string | undefined>
}

/**
 * 返回本次运行该用的服务器根地址；空串 = 未配置（见文件头规则 3）。
 *
 * 打包版**恒为** PROD_DEFAULT_BASE_URL（开源版默认为空串；环境变量不参与，
 * 见规则 1）；开发版走环境变量或回环默认值。
 * ⚠️ 改 PROD_DEFAULT_BASE_URL 必须同批更新 base-url.test.ts 里钉
 * "打包版给的就是默认地址"的用例 —— 测试是契约的看门人。
 */
export function resolveCloudBaseUrl(ctx: CloudBaseUrlContext): string {
  if (ctx.packaged) return PROD_DEFAULT_BASE_URL
  const fromEnv = ctx.env[BASE_URL_ENV_VAR]
  if (fromEnv !== undefined && fromEnv !== '') {
    const normalized = normalizeBaseUrl(fromEnv)
    if (normalized !== null) return normalized
    // 环境变量给了但不合法：不静默退回默认值 —— 静默退回会把"我配错了"
    // 伪装成"我连的是默认服务器"，调试时最费命的一种假象
    return ''
  }
  return DEV_DEFAULT_BASE_URL
}
