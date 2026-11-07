// 两个壁纸特权 scheme 的**唯一**登记点（miai-wall + miai-scene）。
//
// 【为什么必须合成一次调用 —— 2026-10-31 实测，差点把 P0 变成「场景壁纸全挂」】
// Electron 的 protocol.registerSchemesAsPrivileged 在进程里只能生效一次：
// 第二次调用不是追加、也不是被忽略，而是**整表替换** —— 第一次登记的 scheme
// 静默失去 standard/secure/supportFetchAPI 等一切 privileges。症状极具迷惑性：
//  · <img>/<video> 照样能显示（那走的是 handler，不看 fetch 特权）；
//  · 只有 fetch() 挂，且报 "URL scheme \"miai-wall\" is not supported"
//    —— 看起来像协议没装，实际是特权被后一次登记抹掉了。
// 最小复现（<workspace>\_scheme-order-probe，Electron 44.9.3）：
//  两次调用：probe-a（先）ERR Failed to fetch，probe-b（后）status 200；
//  一次调用：两个都 status 200。
//
// 【时序铁律】ready 之前必须提交完：渲染进程对特权 scheme 的认知在出生那
// 一刻定型（与 catalog.ts primeWallProtocol 同一个坑）。

import { protocol, type CustomScheme } from 'electron'
import { WALL_SCHEME } from './protocol'
import { SCENE_SCHEME } from './scene-protocol'

let committed = false

/**
 * 登记全部壁纸 scheme。必须在 app ready 之前、且**只调一次**。
 *
 * 第二次调用直接抛错而不是静默跳过：本函数的重复调用只可能来自代码结构
 * 被改坏，而它造成的后果（整表替换）在运行期是静默的 —— 唯一的出声机会
 * 就在这里（「不许默认回退为成功」）。
 */
export function registerWallpaperSchemes(): void {
  if (committed) throw new Error('wallpaper schemes already registered')
  committed = true
  const schemes: CustomScheme[] = [WALL_SCHEME, SCENE_SCHEME]
  protocol.registerSchemesAsPrivileged(schemes)
}
