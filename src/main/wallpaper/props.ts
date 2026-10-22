/**
 * 「壁纸自带属性」原文读取（`wallpaper:props` 的 main 侧）。
 *
 * 只做一件事：把条目 project.json 里 `general.properties` 与
 * `general.localization` 的**原文**抠出来，装成解析器吃的「最小 project 壳」
 * 交给渲染层 —— 解析器（shared/wallpaper-props.ts）是纯计算、又要和用户
 * 覆盖值合并，而覆盖值住在渲染层的配置里，所以解析统一在渲染层做，只有一份
 * 实现（两份解析器的漂移症状是「面板显示的值和保存的不是一回事」）。
 *
 * 【为什么不做缓存】调用频率 = 「用户打开属性页签 / 换一张壁纸」，一次几 KB 的
 * 文件读取；渲染层按 itemId 做缓存（lib/wallpaper/props.ts）。主进程再加一层
 * 反而会在壁纸更新后失鲜 —— catalog 的 60s TTL 是「扫描整个 Steam 库」贵才值的，
 * 读单文件不配。
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { WallpaperPropsResult } from '../../shared/wallpaper'
import { getWallpaperCatalog } from './catalog'

/** project.json 体积上限：正常几 KB~几十 KB；超限的文件多半畸形，不值得解析 */
const MAX_PROJECT_JSON_BYTES = 4 * 1024 * 1024

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export async function readWallpaperProps(itemId: string): Promise<WallpaperPropsResult> {
  // 复用 60s TTL 的扫描结果定位条目（用户刚在弹窗里选过壁纸，清单基本都在缓存里）
  const cat = await getWallpaperCatalog()
  const item = cat.items.find((x) => x.id === itemId)
  if (!item) return { project: null, path: null }
  const file = path.join(item.dir, 'project.json')
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return { project: null, path: file }
  }
  if (text.length > MAX_PROJECT_JSON_BYTES) return { project: null, path: file }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { project: null, path: file }
  }
  const general = isObject(parsed) && isObject(parsed.general) ? parsed.general : null
  const properties = general && isObject(general.properties) ? general.properties : null
  // 没有 properties 块 = 这张没有自带属性（面板显示空态）；与「读失败」同为
  // project=null —— 面板对两者的展示相同，区别在 path 有没有值
  if (!properties) return { project: null, path: file }
  const localization = general && isObject(general.localization) ? general.localization : null
  return {
    project: localization ? { general: { properties, localization } } : { general: { properties } },
    path: file
  }
}
