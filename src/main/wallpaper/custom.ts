/**
 * 自定义壁纸扫描 —— <用户数据>/wallpapers 里找「用户导入的单文件壁纸」。
 *
 * 【和 steam-scan 的关系】两条扫描链产出同一种 WallpaperItem，但输入形态
 * 完全不同：steam-scan 读的是 WE 的目录树（project.json + pkg / 视频 + 海报），
 * 本文件读的是「用户从对话框挑进来的一个文件」。**不合并成一条链**是有意的：
 * 那边全部逻辑围着 project.json 转，这里根本没有那东西（也不需要 —— 单文件
 * 不需要元数据就能放）。catalog.ts 的 discover() 把两份清单拼起来对外一份。
 *
 * 【item 形状怎么对上渲染管线（2026-10-06 定案）】
 *   · 图片（jpg / png / webp / gif）→ `type: 'image'`（WALLPAPER_KINDS 新成员）
 *     + `previewAbs = 文件自身`：WallpaperLayer 的 planMedia 对「非 video、
 *     非可挂场景」的条目本来就走海报图分支（<img>），这张图就是画面本身，
 *     零改动复用整条管线；gif 在 <img> 里天然会动。
 *   · 视频（mp4）→ `type: 'video'` + `mainFileAbs = 文件自身`，
 *     和 WE 的 video 条目走同一条 <video> 路。
 *
 * 【id 为什么要带 `custom:` 前缀】id 会落进配置（selectedId、轮播池、
 * itemProps 的键），工坊 id 是纯数字字符串，用户完全可能导入一个叫
 * `846718487.mp4` 的文件 —— 前缀让两套命名空间永不相撞，也让配置里
 * 一眼能看出这个 id 是导入的（source 字段不进这些键）。
 *
 * 【过滤口径对齐开屏素材扫描（splash/material.ts）】隐藏文件跳过、
 * 隐式排序用逐字符比较（跨机器确定）、1KB 以下不认（断点残片/占位文件
 * 够不上「一张壁纸」）。这条下限和导入校验共用同一个常量
 * （media-import.ts 的 MIN_IMPORT_BYTES），否则会出现
 * 「提示导入成功、列表里却没有」。
 */
import { readdirSync, statSync } from 'fs'
import { join } from 'path'
import type { WallpaperItem } from '../../shared/wallpaper'
import { WALLPAPER_IMAGE_EXTS, WALLPAPER_VIDEO_EXTS } from '../../shared/media-import'
import { MIN_IMPORT_BYTES } from '../media-import'

/**
 * 扫一个目录。目录不存在 = 没有自定义壁纸（**不是错误**，用户还没导入过）；
 * 单个文件 stat 失败 = 跳过那一个。`dir` 为空字符串（配置尚未就绪）时同样
 * 返回空 —— 由调用方决定「目录在哪」，本函数不猜。
 */
export function scanCustomWallpapers(dir: string): WallpaperItem[] {
  if (!dir) return []
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

  const out: WallpaperItem[] = []
  for (const name of names) {
    if (name.startsWith('.')) continue
    const dot = name.lastIndexOf('.')
    if (dot <= 0) continue
    const ext = name.slice(dot + 1).toLowerCase()
    const isImage = (WALLPAPER_IMAGE_EXTS as readonly string[]).includes(ext)
    const isVideo = !isImage && (WALLPAPER_VIDEO_EXTS as readonly string[]).includes(ext)
    if (!isImage && !isVideo) continue

    const abs = join(dir, name)
    let sizeBytes = 0
    try {
      const st = statSync(abs)
      if (!st.isFile()) continue
      sizeBytes = st.size
    } catch {
      continue
    }
    if (sizeBytes < MIN_IMPORT_BYTES) continue

    out.push({
      id: `custom:${name}`,
      source: 'custom',
      dir,
      title: name.slice(0, dot),
      type: isImage ? 'image' : 'video',
      file: name,
      mainFileAbs: abs,
      mainSizeBytes: sizeBytes,
      // 图片的「海报」就是它自己（见文件头）；视频没有现成海报帧，为 null
      previewAbs: isImage ? abs : null,
      contentrating: null
    })
  }
  return out
}
