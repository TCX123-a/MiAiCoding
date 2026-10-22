/**
 * 壁纸清单（catalog）的共享加载器 —— 模块级单例，壁纸层与「选择壁纸」弹窗共用一份。
 *
 * 【为什么不放在组件里】P3 第一步时清单只在 WallpaperLayer.vue 里加载（那时只有它
 * 一个消费方）。第二步冒出了第二个消费方（设置页的选择器弹窗），如果各拉各的：
 * ① 同一份目录被 listWallpapers 拉两遍（主进程要扫 Steam 工坊目录，不快）；
 * ② 两边各自持有 ref，刷新按钮按了之后另一边不更新，症状是「刷新了但列表没变」。
 * 所以清单提升为模块级共享状态，加载请求按代合流（见下）。
 *
 * 【失败即值契约】`listWallpapers` 那一头保证「没装 Steam 是 available:false 而
 * 不是抛」（见 preload/主进程）；真抛了就是发现链自己坏了 —— 记日志、标记
 * `tried` 让下次（重开开关 / 按刷新）再试，绝不把坏掉伪装成「没有壁纸」。
 *
 * 【合流语义（inflight）】同一时刻只允许一个在途请求：期间再来 ensure 直接复用
 * 同一个 Promise（force=true 也一样 —— force 是「绕过 tried 缓存」，不是「并行
 * 多拉一份」）。加载完成后清空 inflight；下一次 ensure 视 tried 决定是否再拉。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫：**字符串一律英文**，中文只出现在注释里。
 */
import { ref } from 'vue'
import type { WallpaperCatalog, WallpaperItem } from '../../../../shared/wallpaper'

const items = ref<WallpaperItem[]>([])
/**
 * 发现链的 `available`（有 WE 安装目录 / 工坊库 / 用户导入的壁纸，任一即真）。
 * null = 还没扫过（**不是**「没有」—— 首启判断前必须先 ensureCatalog）。
 */
const available = ref<boolean | null>(null)
/**
 * 有没有找到 **Wallpaper Engine 本体/工坊库**（2026-10-17 分享版）。
 * 与 `available` 分开：用户没装 WE、但自己导入过视频/图片壁纸时，
 * available=true（功能能用）而 hasEngine=false（创意工坊那边是空的）。
 * 用 available 去提示「需要安装 WE」会冤枉后者 —— 他明明有壁纸可选。
 */
const hasEngine = ref<boolean | null>(null)
/** WE 安装目录（没找到为 null）；设置页/提示文案可拿来显示路径 */
const installDir = ref<string | null>(null)
/** 已经「尝试过加载」——不代表成功（失败也置 true，等下一次 force 再试） */
const tried = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
let inflight: Promise<WallpaperItem[]> | null = null

export const wallpaperCatalog = {
  items,
  available,
  hasEngine,
  installDir,
  tried,
  loading,
  error
}

/**
 * 确保清单已加载：没试过（或 force）才真发请求，其余情况直接返回。
 * 在途请求按代合流，重复调用不产生第二个 listWallpapers。
 * force 会一路传到主进程 —— 穿透它的 60s TTL：刷新按钮要的是「此刻重扫」，
 * 不是「最多 60 秒前的旧快照」（2026-10-05 复核；只绕过这里的 tried 不够）。
 */
export function ensureCatalog(force = false): Promise<WallpaperItem[]> {
  if (inflight) return inflight
  if (tried.value && !force) return Promise.resolve(items.value)
  tried.value = true
  loading.value = true
  error.value = null
  inflight = window.miai
    .listWallpapers(force)
    .then((cat: WallpaperCatalog) => {
      items.value = cat.items
      available.value = cat.available
      // 工坊侧有没有「源头」：安装目录或至少一个库目录。
      // 不能只看 items.length —— 订阅了但没下载完的库同样该算「装了 WE」。
      hasEngine.value = cat.installDir !== null || cat.libraryDirs.length > 0
      installDir.value = cat.installDir
      return cat.items
    })
    .catch((err: unknown) => {
      // 允许下次再试（tried 归位），错误记号留给界面显示。
      // available/hasEngine 保持 null：**扫描失败 ≠ 没装 WE**，
      // 拿一次网络/文件系统抖动去喊「快去装壁纸引擎」是假话。
      tried.value = false
      error.value = err instanceof Error ? err.message : String(err)
      console.warn('[wallpaper] listWallpapers failed:', err)
      return items.value
    })
    .finally(() => {
      loading.value = false
      inflight = null
    })
  return inflight
}

/** 刷新按钮：强制重拉（在途中则合流到那一次） */
export function refreshCatalog(): Promise<WallpaperItem[]> {
  return ensureCatalog(true)
}

/** 按 id 找条目（选中项解析用；清单没加载过时返回 null，调用方不必等） */
export function findCatalogItem(id: string | null | undefined): WallpaperItem | null {
  if (!id) return null
  return items.value.find((it) => it.id === id) ?? null
}
