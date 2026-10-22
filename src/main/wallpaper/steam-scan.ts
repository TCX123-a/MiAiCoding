// 壁纸库扫描与归一（自 prototype/lib/steam/scan.mjs 移植，P1 实测通过；方案 docs/23 §4.1/§4.3）
//
// 扫描根 = WE 安装目录 projects/{defaultprojects,myprojects}
//         + 每个工坊库 steamapps/workshop/content/431960
// 归一：project.json → { id, title, type, file, preview, contentrating }
//   type 规则：有 type 字符串 → toLowerCase；否则 inferType(file)；
//   仍不在 KINDS → 回落 'scene'（本机 defaultprojects 有 3 项无 type：audiophile / techno / sheep.exe）。
// 主容器（scene）：declared → scene.pkg → scene.json → 目录里唯一 *.pkg。

import { readdir, readFile, stat } from 'node:fs/promises'

import {
  WALLPAPER_KINDS,
  type WallpaperItem,
  type WallpaperKind,
} from '../../shared/wallpaper'
import { WE_APPID } from './steam-locate'

// WallpaperItem（扫描产出 / IPC 传输形状）定义在 shared/wallpaper.ts ——
// 它要跨进程，住在这里的话 preload 与渲染层就得 import main 侧代码。
export type { WallpaperItem }

export const PREVIEW_CANDIDATES = ['preview.jpg', 'preview.png', 'preview.gif', 'preview.webp']

export function inferType(file: string): WallpaperKind {
  if (/\.(mp4|webm|mkv|avi|mov)$/i.test(file)) return 'video'
  if (/\.(html?|js)$/i.test(file)) return 'web'
  return 'scene'
}

function pjoin(a: string, b: string): string {
  return `${String(a).replace(/\/+$/, '')}/${b}`
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

export interface NormalizedProject {
  id: string
  title: string
  type: WallpaperKind
  file: string
  preview: string | null
  contentrating: string | null
}

/** 读一个壁纸目录的 project.json → 归一对象；无 project.json / 无 file 字段返回 null */
export async function readProject(dir: string): Promise<NormalizedProject | null> {
  const pj = pjoin(dir, 'project.json')
  if (!(await pathExists(pj))) return null
  try {
    const o = JSON.parse((await readFile(pj, 'utf8')).replace(/^﻿/, '')) as Record<string, unknown>
    if (!o || typeof o !== 'object' || !o.file) return null
    const file = String(o.file)
    let type: WallpaperKind =
      typeof o.type === 'string' ? (o.type.toLowerCase() as WallpaperKind) : inferType(file)
    if (!(WALLPAPER_KINDS as readonly string[]).includes(type)) type = 'scene'
    const fallbackId = dir.split(/[\\/]/).filter(Boolean).pop() || dir
    return {
      id: fallbackId,
      title: typeof o.title === 'string' ? o.title : fallbackId,
      type,
      file,
      preview: typeof o.preview === 'string' ? o.preview : null,
      contentrating: typeof o.contentrating === 'string' ? o.contentrating : null,
    }
  } catch {
    return null
  }
}

/** 场景主容器解析：declared → scene.pkg → scene.json → 唯一 *.pkg；全无返回 null */
export async function resolveSceneMainFile(dir: string, declared: string | null): Promise<string | null> {
  for (const candidate of [declared, 'scene.pkg', 'scene.json']) {
    if (!candidate) continue
    if (await pathExists(pjoin(dir, candidate))) return candidate
  }
  let pkgs: string[] = []
  try {
    pkgs = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith('.pkg'))
  } catch {
    return null
  }
  return pkgs.length === 1 ? pkgs[0] : null
}


/**
 * 扫描壁纸库 → 归一列表（按 title 排序）。
 * @param installDir WE 安装目录（可空）
 * @param libraryDirs 工坊库根列表
 */
export async function scanWallpapers(
  installDir: string | null,
  libraryDirs: string[],
  { chunk = 24 }: { chunk?: number } = {},
): Promise<WallpaperItem[]> {
  const found = new Map<string, WallpaperItem>()
  const roots: { root: string; source: 'default' | 'my' | 'workshop' }[] = []
  if (installDir) {
    for (const sub of ['defaultprojects', 'myprojects'] as const) {
      const p = pjoin(installDir, `projects/${sub}`)
      if (await pathExists(p)) roots.push({ root: p, source: sub === 'defaultprojects' ? 'default' : 'my' })
    }
  }
  for (const lib of libraryDirs) {
    const ws = pjoin(lib, `steamapps/workshop/content/${WE_APPID}`)
    if (await pathExists(ws)) roots.push({ root: ws, source: 'workshop' })
  }

  const dirs: { dir: string; source: 'default' | 'my' | 'workshop' }[] = []
  for (const { root, source } of roots) {
    let entries: string[] = []
    try {
      entries = await readdir(root)
    } catch {
      continue
    }
    for (const entry of entries) {
      const dir = pjoin(root, entry)
      if (await isDir(dir)) dirs.push({ dir, source })
    }
  }

  for (let i = 0; i < dirs.length; i += chunk) {
    const slice = dirs.slice(i, i + chunk)
    const results = await Promise.all(
      slice.map(async ({ dir, source }) => {
        const p = await readProject(dir)
        return p ? { dir, source, p } : null
      }),
    )
    for (const hit of results) {
      if (!hit) continue
      const { dir, source, p } = hit
      if (found.has(p.id)) continue // 同名以先见者为准（defaultprojects 先于工坊）
      let previewAbs: string | null = p.preview ? pjoin(dir, p.preview) : null
      if (previewAbs && !(await pathExists(previewAbs))) previewAbs = null
      if (!previewAbs) {
        for (const c of PREVIEW_CANDIDATES) {
          const t = pjoin(dir, c)
          if (await pathExists(t)) {
            previewAbs = t
            break
          }
        }
      }
      const mainFile = p.type === 'scene' ? (await resolveSceneMainFile(dir, p.file)) || p.file : p.file
      const mainFileAbs = pjoin(dir, mainFile)
      // 主文件字节数（2026-10-05 场景引擎接入）：场景首帧预算与
      // isRenderableItem 的 scene 分支都要它。stat 失败 = null（条目仍可
      // 用海报兜底），**这里只 stat 一次**，别在渲染层再去碰文件系统。
      let mainSizeBytes: number | null = null
      try {
        const st = await stat(mainFileAbs)
        if (st.isFile()) mainSizeBytes = st.size
      } catch {
        // 声明了但盘上没有 —— null 就是这条事实的载体
      }
      found.set(p.id, {
        id: p.id,
        source,
        dir,
        title: p.title,
        type: p.type,
        file: p.file,
        mainFileAbs,
        mainSizeBytes,
        previewAbs,
        contentrating: p.contentrating,
      })
    }
  }
  return [...found.values()].sort((a, b) => (a.title || '').localeCompare(b.title || ''))
}

export interface SelectedMonitorEntry {
  file: string | null
  playlist: string[] | null
}

/**
 * 从 WE config.json 读「当前正在运行的壁纸」文件路径列表。
 * 口径：只认 {user}.general.wallpaperconfig.selectedwallpapers（含各显示器 file 字段；
 * playlist 形态取 items）；刻意不扫 wallpaperconfigrecent（那是历史记录，不是当前）。
 */
export async function readSelectedWallpapers(installDir: string): Promise<{
  files: string[]
  monitors: Record<string, SelectedMonitorEntry>
}> {
  const cfgPath = pjoin(installDir, 'config.json')
  if (!(await pathExists(cfgPath))) return { files: [], monitors: {} }
  let cfg: Record<string, unknown>
  try {
    cfg = JSON.parse((await readFile(cfgPath, 'utf8')).replace(/^﻿/, '')) as Record<string, unknown>
  } catch {
    return { files: [], monitors: {} }
  }
  const files: string[] = []
  const monitors: Record<string, SelectedMonitorEntry> = {}
  for (const [userKey, userVal] of Object.entries(cfg || {})) {
    if (userKey.startsWith('?') || !userVal || typeof userVal !== 'object') continue
    const general = (userVal as Record<string, unknown>).general as Record<string, unknown> | undefined
    const sel = (general?.wallpaperconfig as Record<string, unknown> | undefined)?.selectedwallpapers
    if (!sel || typeof sel !== 'object') continue
    for (const [monitor, row] of Object.entries(sel as Record<string, unknown>)) {
      if (!row || typeof row !== 'object') continue
      const entry: SelectedMonitorEntry = { file: null, playlist: null }
      const rowObj = row as Record<string, unknown>
      if (typeof rowObj.file === 'string' && rowObj.file) entry.file = rowObj.file
      const pl = rowObj.playlist as Record<string, unknown> | undefined
      if (pl && typeof pl === 'object' && Array.isArray(pl.items)) {
        entry.playlist = (pl.items as unknown[]).filter((x): x is string => typeof x === 'string')
      }
      monitors[`${userKey}/${monitor}`] = entry
      if (entry.file) files.push(entry.file)
      if (entry.playlist) files.push(...entry.playlist)
    }
  }
  return { files, monitors }
}
