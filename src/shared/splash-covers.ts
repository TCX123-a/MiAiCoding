/**
 * 烤录文字覆盖表 —— **已退役**（2026-10-05，v4 像素烘焙方案落地后）。
 *
 * 【为什么退役】旧方案是页面按本表往视频上盖一层 CSS 盒子遮住 DSH 烤录字样——
 * 主人实测「盖子太违和，还露出原版的字」。现在两支开屏素材已在像素层重做：
 * bake.mjs 逐帧擦除旧字形材料（并把新字笔画经过的瞬态动画一并清理），
 * AE 工程再按原动画节奏重绘「咪爱编程」字样重出片。视频里不再有任何需要
 * 页面遮盖的字样，表为空是**复核过的正确状态**，不是数据缺失。
 *
 * 【为什么文件还留着】coversFor 是主进程 getPayload 的调用点（main/splash/index.ts）
 * 与 splash.html 覆盖渲染通道（休眠中）的对接口——将来某支新素材若又要遮挡，
 * 唯一正确的入口在这里。表空由单测钉死：谁往里加窗口，splash-covers.test.ts
 * 会先红（要求他回答「为什么烘焙不够」并自动恢复那整套数据形状检查）。
 *
 * 【历史】退役前的窗口数据（console 三行 / 欢迎 toast / 品牌片头欢迎语）见
 * git 历史；推翻它的全帧审计记录在作者工作区的 `_splashplay-20261005/`（不随仓库分发）
 * （leakscan 全帧扫描：品牌区羽化带泄漏 1204px → 0px）。
 *
 * ⚠️ 改本文件后跑 `npx vitest run src/shared/__tests__/splash-covers.test.ts`。
 */
import type { SplashCover } from './splash'

/**
 * 素材文件名（basename）→ 覆盖窗口列表。**当前恒为空表**（见文件头注释）；
 * table 参数是给单测注入合成表的接缝——深拷贝保证不能因为真表空掉就失去测试。
 */
export const SPLASH_COVER_WINDOWS: Record<string, SplashCover[]> = {}

/**
 * 取某个素材的覆盖窗口。**返回整树新造的数组**——调用方（主进程 getPayload）
 * 会把它塞进 IPC 载荷，引用共享是改一处四处动的温床（照 normalizeSplash 的
 * 规矩）；未知文件名如实回空数组（不是错误：没覆盖的素材本来就合法）。
 */
export function coversFor(fileName: string, table = SPLASH_COVER_WINDOWS): SplashCover[] {
  const list = table[fileName]
  return list ? list.map((c) => ({ ...c })) : []
}
