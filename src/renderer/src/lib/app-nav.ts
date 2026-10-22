/**
 * 「桌宠菜单 → 一键直达设置」在渲染层的接收端（2026-10-06）。
 *
 * 链路：宠物窗右键 → menu → 主进程 popupMenu → openSettings()（restore/show/
 * focus 主窗 + 发 app:nav 指令）→ 这里 → `router.push('/settings?card=…')`。
 *
 * 【为什么把目标塞进 route.query，而不是在这里直接滚 DOM】落地页是设置页 ——
 * "壁纸卡长什么样、要不要先切回 wall 页签"只有它知道。写进查询参数还让
 * "要去哪"变成路由状态：探针读 location.hash 就能看到同一份真值，前进/
 * 后退/热重载也不会脱节。
 *
 * 【`at`（时间戳 nonce）是干什么的】同一个快捷入口连点两次时，第二次的
 * query 与第一次完全相同 —— vue-router 不产生变化，设置页的 watcher 也就
 * 不会再滚一次（用户第一次到达后可能已经滚走了）。带上发起时刻，每次
 * 都是一份"新的" query，滚动逻辑照常重跑。
 *
 * 【订阅为什么不退订】应用级单例接线（同 installSfxWire / installCursor 的
 * 处境）：这条线活到窗口销毁为止，没有"卸载"这个时刻。
 */
import type { Router } from 'vue-router'
import type { AppNavPayload } from '../../../shared/pet'

export function installAppNav(router: Router): void {
  window.miai.onAppNav((p: AppNavPayload) => {
    // 载荷来自主进程也要过一遍守卫：坏值静默忽略，页面不动比乱跳好
    if (!p || (p.card !== 'wall' && p.card !== 'ai')) return
    void router.push({ path: '/settings', query: { card: p.card, at: String(p.ts) } })
  })
}
