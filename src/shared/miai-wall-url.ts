/**
 * 把本机绝对路径拼成 miai-wall:// 资产 URL。
 *
 * 协议与路径围栏在 src/main/wallpaper/protocol.ts，三条约束和这里一一对应：
 *   ① host 恒为 's'（协议面只认这一个 host，别的当 404）；
 *   ② 逐段 encodeURIComponent —— 工坊标题里有中文、空格、`#`、`?`，
 *      整串 encode 会把 '/' 也吃掉，不 encode 则 `#` 后面的内容根本到不了服务端；
 *   ③ **反斜杠先整成正斜杠** —— 围栏明确拒绝含 `\` 的段（防路径穿越）。
 *      忘了这步不会报错，只会 403，而症状看起来就是「视频不显示」。
 *
 * 为什么不做缓存/记忆化：字符串拼接比 Map 查询还便宜，而缓存键就是入参本身。
 *
 * 【为什么住在 shared】2026-10-05 从 renderer/src/lib/wallpaper/url.ts 平移上来：
 * 开屏动画（main/splash）也要给视频素材拼这个 URL，而协议白名单两条腿走路——
 * 渲染层拼错、主进程登记错，症状都是同一个「视频不显示」。拼法收口到一处，
 * 主/渲染两个进程共用，url.ts 那份保留为 re-export（引用方一行不改）。
 */
export function miaiWallUrl(abs: string): string {
  const segs = String(abs)
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s !== '')
  return 'miai-wall://s/' + segs.map((s) => encodeURIComponent(s)).join('/')
}
