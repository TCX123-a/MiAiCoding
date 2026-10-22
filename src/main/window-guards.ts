/**
 * 窗口守卫：两把纯函数闸门 —— 外链白名单（shell.openExternal 用）与
 * 应用内导航裁决（will-navigate 用）。P10.1 §7.1-12。
 *
 * 【为什么需要 —— 现状的两个洞】
 * · 外链：app.ts 现有的 setWindowOpenHandler 是「盲丢一切」——
 *   shell.openExternal(details.url) 不看来路，页面想开什么就替它开什么。
 *   危险不在 http(s) 外链本身，而在 file: 与自定义协议（能唤起本机程序的
 *   那类）会原样交给系统处理器 —— 必须由白名单收口。
 * · 导航：will-navigate 完全没装。页面一旦被导航去别处（钓鱼页 / 远程页），
 *   新文档就跑在同一个带 preload 的语境里，没有任何东西拦它。
 *
 * 【口径】默认「哪里都别去」：只有能证明「这是同一份文档 / 同一个来源 /
 * 同一张本地页面」时才开小口放行，其余一律拒。漏拦的代价（任意 URL 进
 * openExternal、渲染层被导航走）比误拦的代价（一次不该发生的跳转没发生）
 * 大一个数量级 —— 所以做成默认拒绝、逐条论证的允许清单。
 *
 * 【边界】本文件只提供**纯函数**（node 环境可直接单测、不碰 Electron）；
 * 真正的接线 —— 在 setWindowOpenHandler 里先查 isExternalUrlAllowed 再开、
 * 给 webContents 挂 will-navigate 调 decideNavigation —— 在 app.ts，由
 * P10.1 主干负责。两个函数相互独立：同一个 URL 在两处的结论允许不同
 * （file:// 同文档导航要放行，但作为外链一律拒）。
 *
 * 【字符串纪律】代码内字符串一律英文；中文只在注释里。
 */

export type NavigationDecision = 'allow' | 'block'

/** 解析不出给 null —— 调用方按「未知即拒」处理：不抛异常，也绝不静默放行 */
function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/** http(s) 才算「网页」；file: / 自定义协议走各自的分支 */
function isHttpUrl(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:'
}

/**
 * 外链白名单：只放行 http / https。
 * javascript: / data: / file: / 自定义协议（含 miai-wall:）即便解析得出也
 * 一律 false —— shell.openExternal 会把自定义协议交给系统处理器，能不能
 * 唤起本机程序是**系统**说了算，绝不能由页面单方面决定；解析不出
 * （空串、'not a url' 之类）同样 false。
 */
export function isExternalUrlAllowed(rawUrl: string): boolean {
  const url = parseUrl(rawUrl)
  if (url === null) return false
  return url.protocol === 'http:' || url.protocol === 'https:'
}

/**
 * in-app 导航裁决：同源（或同 file 页面）放行，其余 block；解析失败 block。
 *
 * 规则按顺序（每条都是「先自证同一，再放行」）：
 */
export function decideNavigation(targetUrl: string, currentUrl: string): NavigationDecision {
  const target = parseUrl(targetUrl)
  const current = parseUrl(currentUrl)
  // 任何一边解析失败 ⇒ block：形状未知的东西没有理由被放行
  if (target === null || current === null) return 'block'

  // ① 同文档（忽略 hash）⇒ allow：完全相同、或仅 hash 变化都是同一份文档。
  //    in-app hash 路由（#/lesson/x → #/lesson/y）与 dev HMR 整页刷新到
  //    同一 URL 都长这样；hash 变化根本不换文档，拦它只会坏自家人。
  if (
    target.protocol === current.protocol &&
    target.host === current.host &&
    target.pathname === current.pathname &&
    target.search === current.search
  ) {
    return 'allow'
  }

  // ② http(s) 同源 ⇒ allow：dev 服务器（http://localhost:端口）上 HMR 的
  //    整页 reload、以及无 hash 的 in-app 跳转（/a → /b）都长这样。
  //    origin = 协议 + 主机 + 端口：跨端口（5173 → 6000）、http↔https
  //    都不算同源，自然落到下面的 block。
  if (isHttpUrl(target) && isHttpUrl(current) && target.origin === current.origin) {
    return 'allow'
  }

  // ③ file: 且 host / pathname / search 全同 ⇒ allow：生产环境整页 reload
  //    会带着相同的 search 回来（file:///.../index.html?x=1）。
  //    file: 的 origin 是字符串 "null"，不能按 origin 比，只能逐段比。
  //    【为什么与 ① 看似重复还要显式写】① 是同文档总则，③ 把 file 的口径
  //    钉死在这里：将来谁把 ① 收窄成 http-only、或让它连 search 一起忽略，
  //    file 的放行范围不会跟着静默漂走 —— 安全判据宁可显式。
  //    （注意：file 的 query 不同即视作不同 URL，不走本条。）
  if (
    target.protocol === 'file:' &&
    current.protocol === 'file:' &&
    target.host === current.host &&
    target.pathname === current.pathname &&
    target.search === current.search
  ) {
    return 'allow'
  }

  // ④ 其余一律 block：跨源 http(s)（含 http↔https、跨端口、跨主机）、任何
  //    自定义协议（miai-wall: 等）、file→http / http→file、javascript:/data:。
  //    「没被上面任何一条证明为同一 ⇒ 拒绝」是这两把闸的默认姿态。
  return 'block'
}
