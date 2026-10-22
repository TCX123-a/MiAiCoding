/**
 * 自定义素材导入的**执行体** —— 拷一个文件进用户素材目录。
 * 壁纸（<用户数据>/wallpapers）与开屏视频（<用户数据>/splash）共用这一份。
 *
 * 【为什么弹框要注入（pickFile 回调），不在这里 import dialog】
 * 本文件因此**零 electron 依赖**，可以被 Vitest 直接测：测试注入一个
 * 「假装用户选了 X」的 pickFile，配一个真临时目录，把 取消 / 坏扩展名 /
 * 太小 / 拷贝成功 / 重名去重 全部走一遍真 fs。electron 那侧的弹框逻辑
 * （showOpenDialog + 父窗）留在 main/index.ts —— 那本来就只有几行。
 *
 * 【结果形状】没有异常通道：取消、坏扩展名、文件太小、拷贝失败，
 * 全部是**返回值**（同 dialogPickExe / gallerySaveImage 的「失败即值」）。
 * 成功返回**实际落盘的文件名** —— 重名会自动加序号，调用方别拿原文件名
 * 当判据（名字可能已经变成「星空 (2).png」）。
 *
 * 【重名为什么加序号而不是拒绝或覆盖】覆盖 = 悄悄毁掉用户上一张同名壁纸；
 * 拒绝 = 用户得自己去文件管理器改名再回来（他还不知道往哪改）。
 * 「星空.png」→「星空 (2).png」是资源管理器自己的说法，用户一看就懂。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫：字符串**一律英文**（给开发者看的），
 *   中文只出现在注释里；用户可见的失败文案由渲染层按 reason 码拼。
 */
import { existsSync, statSync } from 'fs'
import { copyFile, mkdir } from 'fs/promises'
import { basename, join } from 'path'
import type { MediaImportResult } from '../shared/media-import'

/**
 * 导入的下限体积（1KB）。**必须与素材扫描器同一口径**
 * （wallpaper/custom.ts 与 splash/material.ts 都跳过 <1KB 的文件）——
 * 否则小文件「提示导入成功、列表里却没有」，用户只会以为功能坏了。
 */
export const MIN_IMPORT_BYTES = 1024

/**
 * 导入的上限体积（2 GiB）。**主人 2026-10-14 拍板：超过就报错提示**。
 *
 * 【为什么必须有】没有上限时，用户选中一个 50GB 的错文件 = 主进程默默往
 * 用户盘上搬 50GB：盘被占满、应用长时间无响应，而且中途没有任何时刻能
 * 「反悔」。上限不是性能优化，是在**落第一个字节之前**把错误摆回对话框
 * 那一刻（与 too-small 同一个姿势：说清楚，而不是收下之后再说）。
 *
 * 【为什么只管"导入一刻"，不管扫描器】素材扫描器（wallpaper/custom.ts、
 * splash/material.ts）不看体积 —— 手动从文件管理器放进素材目录的大文件
 * 照常被列出。要管那是另一件事：扫描器的语义是"跳过"（文件还在、列表里
 * 没有），而这里要的是"拒收 + 提示"，两者不是同一条规则。别在这里假装
 * 顺手管了。
 *
 * 【这不是安全边界】size 取自 stat、拷贝另起一步，中间有 TOCTOU 缝隙；
 * 防的是错误与手滑，不是攻击者（本机用户对自己盘有全部权限，没有可防的
 * 对象）。别把它当配额系统用。
 *
 * 【为什么恰好 2GiB 放行】边界口径与 MIN_IMPORT_BYTES 相反相成：恰在
 * 线上收，只拒严格大于（"允许的最大值"的人话语义）。
 */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024 * 1024

/** 弹框请求：标题 + 筛选器名 + 扩展名白名单（全来自 shared/copy.ts 与 shared/media-import.ts） */
export interface PickFileRequest {
  title: string
  filterName: string
  exts: readonly string[]
}

/** 注入的「让用户挑一个文件」：取消返回 null（不是错误）。实现见 main/index.ts */
export type PickFileFn = (req: PickFileRequest) => Promise<string | null>

/**
 * 在 dir 里为 name 找一个不冲突的文件名：没冲突原样返回；重名 → 插
 * 「 (2)」「 (3)」……在扩展名前。全部被占（999 个同名）返回 null ——
 * 这是荒诞场景，但**循环必须有界**（无界循环=最坏情况把主进程焊死）。
 *
 * 判据用 existsSync 逐候选现查（不预读目录清单）：Windows 文件系统本身
 * 大小写不敏感，existsSync 天然按目标盘的真实语义比对 —— 预读清单自己
 * 写比对规则，就是在重实现一件已有事实的事。
 */
export function uniqueDestName(dir: string, name: string): string | null {
  if (!existsSync(join(dir, name))) return name
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 2; i <= 999; i++) {
    const candidate = `${stem} (${i})${ext}`
    if (!existsSync(join(dir, candidate))) return candidate
  }
  return null
}

/** 把底层异常压成一行摘要（IPC 那边要过结构化克隆，Error 对象别直接塞） */
function summarize(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 完整的一次导入：弹框 → 校验扩展名 → 校验体积 → 拷进 destDir（重名加序号）。
 *
 * 【扩展名判据用「最后一个点」，认不出扩展名 = 拒收】`README` 这种没有点的
 * 文件名不在任何白名单里，自然被拒 —— 正确的方向：宁可在这一刻说清楚，
 * 也不要拷进来之后在列表里静默消失。
 */
export async function importMedia(opts: {
  pickFile: PickFileFn
  destDir: string
  allowedExts: readonly string[]
  title: string
  filterName: string
  /** 上限注入口（**只给测试**）：缺省 = MAX_IMPORT_BYTES。生产调用方不传 */
  maxBytes?: number
}): Promise<MediaImportResult> {
  const picked = await opts.pickFile({ title: opts.title, filterName: opts.filterName, exts: opts.allowedExts })
  if (!picked) return { ok: false, reason: 'cancelled' }

  const base = basename(picked)
  const dot = base.lastIndexOf('.')
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
  if (ext === '' || !opts.allowedExts.includes(ext)) return { ok: false, reason: 'bad-ext' }

  let size = 0
  try {
    const st = statSync(picked)
    if (!st.isFile()) return { ok: false, reason: 'copy-failed', message: 'not a regular file' }
    size = st.size
  } catch (err) {
    return { ok: false, reason: 'copy-failed', message: summarize(err) }
  }
  if (size < MIN_IMPORT_BYTES) return { ok: false, reason: 'too-small' }
  // 上限检查与 too-small 并排、在任何落盘动作（mkdir/copyFile）与自我拷贝
  // no-op **之前**：超限就一个字节都不落 —— 挪到 no-op 后面的话，用户从
  // 素材目录里选中一个超限旧文件会拿到「成功」（与 too-small 的处理不对称，
  // too-small 的自我拷贝同样返回 too-small）。
  if (size > (opts.maxBytes ?? MAX_IMPORT_BYTES)) return { ok: false, reason: 'too-large' }

  // 用户挑的正是库里已经有的那个文件（在对话框里导航进了素材目录）：
  // 自己拷自己会 EBUSY，而且「已经在库里」本来就是成功语义 —— 直接认了。
  if (picked.toLowerCase() === join(opts.destDir, base).toLowerCase()) {
    return { ok: true, name: base }
  }

  try {
    // 【异步拷贝】2026-10-14 修：原来这里与上一行都是同步 API。导入的是
    // 壁纸/开屏视频，几百 MB 是常态 —— copyFileSync 在主进程里整段占住
    // 事件循环，拷贝期间所有窗口的 IPC / 窗口状态推送 / 壁纸帧调度全停摆。
    // 换 await copyFile 之后函数签名（async）与调用方（ipcMain.handle 已 await）
    // 一字不动。接线闸门在 __tests__/media-import.test.ts。
    await mkdir(opts.destDir, { recursive: true })
    const dest = uniqueDestName(opts.destDir, base)
    if (dest === null) return { ok: false, reason: 'copy-failed', message: 'too many name collisions' }
    await copyFile(picked, join(opts.destDir, dest))
    return { ok: true, name: dest }
  } catch (err) {
    return { ok: false, reason: 'copy-failed', message: summarize(err) }
  }
}
