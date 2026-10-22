/**
 * 画廊「保存图片」的落盘写法闸门（`src/main/app.ts` 的 `IPC.gallerySaveImage` handler）。
 *
 * 【为什么值得单独钉一条】（2026-10-14 修复批·#4）
 * 这个 handler 和 media-import.ts 是同一类病：目标路径由用户在系统对话框里
 * 挑（任意位置、任意盘，甚至网络盘），而**拷贝是同步的** —— `copyFileSync`
 * 在主进程里整段占住事件循环：拷贝期间所有窗口的 IPC、窗口状态推送、壁纸帧
 * 调度全部停摆。当前素材（50 张 PNG 共 16.4MB）还小、病还没发作，
 * 属于**预防性修复**；本闸门钉的因此不是"实测到卡死"，而是两条不变量：
 *   ① 拷贝走异步 API 且被 await；
 *   ② tmp + rename 原子替换 —— 拷贝中途失败（盘满/被杀）时，用户挑的位置
 *      不留下半截文件；rename 在 Windows 上是 MOVEFILE_REPLACE_EXISTING，
 *      覆盖已有文件也是原子的。
 *
 * 【为什么是源码闸门】行为面（真弹系统保存框）没法在单测里跑；而"用的哪个
 * API"恰是可以静态判定的（同 ipc-wiring / media-import 的接线闸门口径）。
 * 它抓不到什么：只抓字面写法，间接别名（`const c = copyFileSync`）抓不住 ——
 * 所以下面配了**尺子自带种坏自检**：先把坏写法喂给同一把尺子看它报红，
 * 尺子本身没牙的话那两条断言全是假绿。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { maskComments } from '../../shared/__tests__/mask-comments'

/** 读进来第一件事剥注释（先例：ipc-wiring.test.ts 头注释）——本仓库注释里
 *  为了讲清规则会写 `copyFileSync(...)` 这样的示例，不剥会把自己绊倒 */
const appSrc = maskComments(readFileSync(join(__dirname, '..', 'app.ts'), 'utf8'))

/** 只取 gallerySaveImage 的 handler 段：从通道名出现处切到下一个 ipcMain.handle。
 *  （全文件口径会被**将来别的** handler 里的写法顶替 —— 判据必须落在真源上） */
function handlerBody(text: string): string {
  const i = text.indexOf('IPC.gallerySaveImage')
  if (i === -1) return ''
  const j = text.indexOf('ipcMain.handle', i + 1)
  return text.slice(i, j === -1 ? undefined : j)
}

/** 判据本体：返回这段文本里违反的不变量（空数组 = 合格）。
 *  **测试字符串与真源码走同一把尺子** —— 种坏自检量的是它，不是另写一套正则。 */
function violations(text: string): string[] {
  const out: string[] = []
  if (/copyFileSync\s*\(/.test(text)) out.push('用了 copyFileSync（整段拷贝期间冻住主进程事件循环）')
  if (!/await\s+copyFile\s*\(/.test(text)) out.push('缺 `await copyFile(`（异步拷贝不在、没被 await、或换成了别的写法）')
  if (!/await\s+rename\s*\(/.test(text)) out.push('缺 `await rename(`（tmp+rename 原子替换不在）')
  if (!/await\s+rm\s*\(/.test(text)) out.push('缺 `await rm(`（失败路径不清理 .tmp，用户会在目标目录看到半截垃圾）')
  return out
}

describe('画廊保存：异步拷贝 + tmp/rename 原子替换（2026-10-14 修复批）', () => {
  const body = handlerBody(appSrc)

  it('非空自检：切出来的确实是 gallerySaveImage 的 handler（切错文件/改名会在这红）', () => {
    expect(body, 'app.ts 里找不到 IPC.gallerySaveImage 的 handler 段').not.toBe('')
    expect(body, '切出来的段不像那个 handler（应含 showSaveDialog）').toContain('showSaveDialog')
  })

  it('★ handler 必须满足四条不变量（坏了会冻主进程 / 留下半截文件）', () => {
    expect(violations(body), 'gallerySaveImage 的落盘写法违规').toEqual([])
  })

  it('尺子自带种坏自检：把坏写法喂给同一把尺子，它必须报得出来', () => {
    // ① 修复前的真形态（copyFileSync 一把梭）→ 必须至少报出"冻主进程"
    const before = violations('try { copyFileSync(src, filePath) } catch (err) { return }')
    expect(before.some((v) => v.includes('copyFileSync')), '尺子对 copyFileSync 瞎了').toBe(true)
    // ② 拷了但没 await / 没有原子替换 → 两条都要报
    const half = violations('copyFile(src, filePath)')
    expect(half.length, '尺子对"没 await 没 rename"的写法瞎了').toBeGreaterThanOrEqual(3)
    // ③ 反面：合格写法必须零违规（不然闸门把对的也毙了）
    const good = violations('const tmp = `${filePath}.tmp`\nawait copyFile(src, tmp)\nawait rename(tmp, filePath)\nawait rm(tmp, {force:true})')
    expect(good, '尺子把合格写法也判违规了').toEqual([])
  })
})
