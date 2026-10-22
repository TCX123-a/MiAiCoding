/**
 * 开屏素材扫描 —— 两个目录里找「可播的视频文件」。
 *
 * 目录模型（docs/24 §素材）：
 *   [0] 内置：随包发布（dev 从 src/renderer/public/splash 读源码目录，
 *       打包后从 resources/renderer/splash 读 —— public/** 会被 Vite
 *       原样拷进 out/renderer）。
 *   [1] 用户自放：<用户数据>/data/splash（portable 版在解压目录里，
 *       storageDir() 已经把这个分叉处理好了，这里只管拼子目录名）。
 * 数组顺序**就是优先级**：同名文件内置的赢（用户放了个同名覆盖文件？
 * 不，是用户不该被自己无意拷进来的文件顶掉随包素材 —— 想覆盖请改名或
 * 删掉内置那份不现实，所以同名时以内置为准，行为可预期）。
 *
 * 【为什么过滤这么狠】所有「不是视频」的输入在这里被挡掉，后面的
 * decideSplash / 播放端就能假定文件列表是可播的候选。残片（断点下载）、
 * 0 字节占位、隐藏文件（macOS 的 ._ 前缀、编辑器 swap）都不是素材。
 * 真坏的视频（能过 stat 但解码失败）由开屏页的 error 事件兜底收场。
 */
import { readdirSync, statSync } from 'fs'
import { join } from 'path'
import type { SplashMaterialRef } from '../../shared/splash'

/** 认的视频扩展名（小写比对）。webm/mov/m4v 留着：Chromium 通吃，
 *  以后素材库换格式不用改代码 */
const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.m4v']

/** 小于这个体积的一律不认（1KB）：断点残片/占位文件够不上「一个视频」 */
const MIN_MATERIAL_BYTES = 1024

/**
 * 算出两个素材目录。**纯路径计算，不碰磁盘** —— 它还被用在
 * 「把素材目录登记进 miai-wall 协议白名单」那一步（协议必须早于任何
 * 窗口出生，那时连目录在不在都不知道，也不该知道）。
 */
export function splashMaterialDirs(opts: {
  isDev: boolean
  appPath: string
  mainDir: string
  storageDir: string
}): string[] {
  const builtin = opts.isDev
    ? join(opts.appPath, 'src', 'renderer', 'public', 'splash')
    : join(opts.mainDir, '..', 'renderer', 'splash')
  const user = join(opts.storageDir, 'splash')
  return [builtin, user]
}

/**
 * 扫描素材。目录不存在 = 没有素材（**不是错误**，用户还没放东西而已）；
 * 单个文件 stat 失败 = 跳过那一个。排序用逐字符比较而不是 localeCompare ——
 * 「候选第一个」是 fixed 选片未命中时的回退目标，排序必须跨机器确定，
 * locale 会把它变成运气。
 */
export function scanSplashMaterials(dirs: string[]): SplashMaterialRef[] {
  const out: SplashMaterialRef[] = []
  const seen = new Set<string>()
  for (const dir of dirs) {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    for (const name of names) {
      if (name.startsWith('.')) continue
      const lower = name.toLowerCase()
      if (!VIDEO_EXTS.some((ext) => lower.endsWith(ext))) continue
      const abs = join(dir, name)
      let sizeBytes = 0
      try {
        const st = statSync(abs)
        if (!st.isFile()) continue
        sizeBytes = st.size
      } catch {
        continue
      }
      if (sizeBytes < MIN_MATERIAL_BYTES) continue
      if (seen.has(name)) continue
      seen.add(name)
      out.push({ name, abs, sizeBytes })
    }
  }
  return out
}
