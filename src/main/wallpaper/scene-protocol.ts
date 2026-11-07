// miai-scene:// 特权协议 —— 场景沙箱文档与其构建产物的**唯一**来源。
//
// 为什么需要它：P0 壁纸沙盒逃逸把 webwallgl 引擎关进
// `sandbox="allow-scripts"` 的 iframe（opaque origin）。生产环境主窗走
// `file://`，而 Chromium 对 file:// 的 ES module 一律按 CORS 拒绝 —— 沙箱
// 入口页面必须从一个「标准、安全、参与 CORS」的 scheme 提供，这正是本协议。
// （实测：沙箱 iframe 从特权 scheme 加载模块 + 跨 scheme fetch 均通过，
//  _iframe-engine-prototype/scene-proto.js。）
//
// 服务面刻意收得很窄：只放行 `scene-sandbox.html` 与 `assets/**`（Vite 的
// 构建产物）。构建产物文件名带哈希，不会与壁纸资产目录重叠；壁纸本身仍走
// miai-wall://（两套白名单互不扩大对方的暴露面）。
//
// 与 miai-wall 同样的铁律：privileges 必须在 app ready **之前**声明，handler
// 必须在第一个窗口出生**之前**装好 —— 渲染进程对特权 scheme 的认知在出生那
// 一刻定型，装晚了就是成片的 ERR_UNKNOWN_URL_SCHEME（见 catalog.ts
// primeWallProtocol 的实测注释，同一个坑）。

import { protocol, type CustomScheme } from 'electron'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'

/**
 * miai-scene 的 scheme privileges（与 WALL_SCHEME 一起由 scheme-privileges.ts
 * 一次提交 —— registerSchemesAsPrivileged 全进程只能调一次，别在这里调）。
 */
export const SCENE_SCHEME: CustomScheme = {
  scheme: 'miai-scene',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    corsEnabled: true,
  },
}

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
}

function mimeFor(p: string): string {
  const name = p.split('/').pop() || ''
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  return MIME[ext] || 'application/octet-stream'
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'range',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, Content-Type',
    'Cache-Control': 'no-store',
  }
}

/** 主进程 tsconfig 没有 DOM lib：BodyInit 从构造器签名里取（同 protocol.ts） */
type ResponseBody = ConstructorParameters<typeof Response>[0]

/** 路径段围栏：拒绝 `..` / `.` / 空段 / NUL / 反斜杠（与 miai-wall 同口径） */
function pathSegments(pathname: string): string[] | null {
  const raw = pathname.replace(/^\/+/, '')
  if (!raw) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null
  const segs = decoded.split('/')
  for (const s of segs) {
    if (s === '' || s === '.' || s === '..') return null
  }
  return segs
}

/**
 * 安装处理器。`rendererDir` = 打包后的 renderer 根（out/renderer）。
 * 开发模式下沙箱页走 Vite 同源 URL，本协议不参与（装了也无害）。
 */
export function installSceneProtocol(opts: { rendererDir: string }): void {
  const root = opts.rendererDir.replace(/\\/g, '/').replace(/\/+$/, '')

  protocol.handle('miai-scene', async (request) => {
    const method = request.method || 'GET'
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
    if (method !== 'GET' && method !== 'HEAD') {
      return new Response('method not allowed', { status: 405, headers: corsHeaders() })
    }
    let u: URL
    try {
      u = new URL(request.url)
    } catch {
      return new Response('bad url', { status: 400, headers: corsHeaders() })
    }
    if (u.host !== 's') return new Response('unknown host', { status: 404, headers: corsHeaders() })

    const segs = pathSegments(u.pathname)
    if (!segs) return new Response('bad path', { status: 403, headers: corsHeaders() })
    const rel = segs.join('/')
    // 只服务沙箱入口与构建产物（Vite 资源都进 assets/）
    if (rel !== 'scene-sandbox.html' && !rel.startsWith('assets/')) {
      return new Response('not found', { status: 404, headers: corsHeaders() })
    }

    const full = `${root}/${rel}`
    let st
    try {
      st = await stat(full)
    } catch {
      return new Response('not found', { status: 404, headers: corsHeaders() })
    }
    if (!st.isFile()) return new Response('not found', { status: 404, headers: corsHeaders() })

    const headers = {
      ...corsHeaders(),
      'Content-Type': mimeFor(rel),
      'Content-Length': String(st.size),
    }
    if (method === 'HEAD') return new Response(null, { status: 200, headers })
    return new Response(createReadStream(full) as unknown as ResponseBody, {
      status: 200,
      headers,
    })
  })
}
