// 壁纸发现链的收口（catalog）：定位 → 扫描 → 装协议 → 回一份 WallpaperCatalog。
//
// 【为什么三件事要收在一个模块里】发现链里有三件互相依赖的事：
//   ① 定位（注册表/vdf/探针，各自有 TTL 缓存）；
//   ② 扫描（几百个目录、逐目录读 project.json，全链最贵的一步）；
//   ③ miai-wall:// 的根白名单必须**跟着扫描结果走** —— 协议只服务清单里
//      出现过的目录；重扫之后白名单也得跟上。
// 对外只暴露 getWallpaperCatalog()：调用方（IPC handler）拿到的永远是
// 「同一次扫描里自洽」的快照。（P1 原型 app/main.mjs 的 discover() 就是
// 这个形状，本文件是它的 TS 版。）
//
// 【TTL 里为什么要带 inflight 去重】渲染层可能同时在几个组件里问清单
// （壁纸层 + 将来的设置页卡片）；扫描是几百次磁盘 IO，并发重入等于把
// 同一份扫描做 N 遍。让并发的调用者共享同一次在飞的 promise。

import type { WallpaperCatalog } from '../../shared/wallpaper'
import { installWallProtocol } from './protocol'
import { librariesOwningWE, locateWallpaperEngine, steamProbeDirs, toPosix } from './steam-locate'
import { readSelectedWallpapers, scanWallpapers } from './steam-scan'
import { scanCustomWallpapers } from './custom'

const TTL_MS = 60_000

let cache: { at: number; value: WallpaperCatalog } | null = null
let inflight: Promise<WallpaperCatalog> | null = null
let protocolInstalled = false

/**
 * 自定义壁纸目录的**活读口**（2026-10-06，「导入壁纸」功能）。
 *
 * 【为什么又是 provider 而不是直接传值】和 extraRootProviders 同一个问题：
 * 目录就在 storageDir()/wallpapers，但 storageDir() 依赖 app 是否 ready /
 * portable 判定，注册这一刻（很可能发生在 ready 之前）还不能安全调用。
 * 传函数 = 扫描时现取，注册方（main/index.ts）什么时候装都行。
 *
 * 【它同时回答了「白名单怎么覆盖上传目录」】currentRoots() 取的是**扫描
 * 结果里每个条目的 dir** —— 自定义条目落进 cache 快照后，它们的 dir
 * （就是这个目录）自然进白名单。导入成功后 handler 会 force 重扫，
 * 白名单随之刷新，上传的图片/视频马上可通过 miai-wall:// 播放。
 */
let customDirProvider: (() => string) | null = null
export function setCustomWallpaperDirProvider(fn: () => string): void {
  customDirProvider = fn
}

/** 协议根白名单 = 当前清单里每张壁纸的目录（比库根更紧：引擎只会请求条目内的文件）
 *  + 常驻目录（extraRootProviders，如开屏素材）——后者与快照无关，
 *  由 provider 活读（见 addProtocolRootProvider 的注释）。 */
function currentRoots(): string[] {
  const wp = cache ? cache.value.items.map((it) => it.dir) : []
  const extra: string[] = []
  for (const fn of extraRootProviders) {
    try {
      extra.push(...fn())
    } catch {
      // provider 自己炸了不该连累协议白名单（壁纸照常服务）
    }
  }
  return [...wp, ...extra]
}

/**
 * 注册一个常驻协议根 provider（2026-10-05，开屏素材用）。
 *
 * 【为什么需要「provider」而不是直接 push 进数组】开屏素材目录在
 * primeWallProtocol（app ready 后、任何窗口出生前就得装协议的那个时刻）
 * 就要可服务，但那时壁纸扫描还没跑（cache null）、配置也可能还没读。
 * provider 是个**活读口**：协议每次请求现调，注册一次、值随外部变。
 *
 * 【和壁纸目录的白名单语义不同】壁纸的根跟着扫描快照走（只服务清单里
 * 出现过的目录，重扫后跟上）；provider 的根是「进程生命周期内恒定」
 * 的少数几个目录，不受 TTL/重扫影响 —— 两套语义各管各的，别混。
 */
const extraRootProviders: Array<() => string[]> = []
export function addProtocolRootProvider(fn: () => string[]): void {
  extraRootProviders.push(fn)
}

async function discover(): Promise<WallpaperCatalog> {
  const probes = await steamProbeDirs()
  const installDir = await locateWallpaperEngine(probes)
  const libraryDirs = await librariesOwningWE(probes)

  // 自定义（导入）壁纸在前，WE 扫描的在后的顺序对外可见（选择弹窗按这个
  // 顺序渲染）——用户自己刚导入的东西应该最好找。两套 id 命名空间不相交
  // （custom.ts 的 `custom:` 前缀），拼接不需要去重。
  const customDir = customDirProvider ? safeCustomDir() : ''
  const custom = scanCustomWallpapers(customDir)
  const scanned = await scanWallpapers(installDir, libraryDirs)
  const items = [...custom, ...scanned]

  // 「WE 当前正在跑的壁纸」→ 清单里的 id。WE config 里存的是 Windows 反斜杠
  // 绝对路径；两边都整成正斜杠 + 小写再比。先按主文件匹配，不中再按目录匹配
  // （playlist/旧版条目可能只对得上目录层级 —— P1 实测口径）。
  let currentFromWe: string | null = null
  if (installDir) {
    const sel = await readSelectedWallpapers(installDir)
    const wanted = sel.files.map((p) => toPosix(p).toLowerCase())
    const hit =
      items.find((it) => wanted.includes(toPosix(it.mainFileAbs).toLowerCase())) ||
      items.find((it) => wanted.includes(toPosix(it.dir).toLowerCase()))
    currentFromWe = hit ? hit.id : null
  }

  return {
    // 只有自定义壁纸也算「有壁纸可用」（available 的语义是「清单里有没有东西」
    // 的弱化版：它只用来区分「没装 WE」和「发现链坏了」；自定义条目走的是
    // 另一条链，不该被 WE 的缺席连累）
    available: installDir !== null || libraryDirs.length > 0 || custom.length > 0,
    installDir,
    libraryDirs,
    items,
    currentFromWe,
    scannedAt: Date.now(),
  }
}

/** provider 自己炸了不该拖垮整条扫描：退化成「没有自定义目录」 */
function safeCustomDir(): string {
  try {
    return customDirProvider ? customDirProvider() : ''
  } catch {
    return ''
  }
}

/**
 * 在**第一个窗口出现之前**把 miai-wall:// 处理器装好（main/index.ts 在
 * createWindow() 前调用）。
 *
 * 【为什么必须是「窗口出生之前」而不是「首次取清单时」—— 2026-10-04 实测定论】
 * 渲染进程对特权 scheme 的认知在它**出生那一刻**就定型了。晚于某个渲染进程
 * 安装的 handler，那个进程里所有 miai-wall:// 请求都以 `ERR_UNKNOWN_URL_SCHEME`
 * 失败（<video>/<img>/fetch 全灭，且 Page.reload 也救不回来 —— 换帧不换进程），
 * 而**主进程侧** `session.fetch('miai-wall://…')` 却完全正常（206 + Range 都对）。
 * 两个事实摆在一起，极难往「装晚了」这个方向想 —— P3 集成时真栽在这里：
 * 首次 getWallpaperCatalog() 是渲染层通过 IPC 发起的，那时窗口早已出生，
 * 懒装永远慢一步。P1 原型能跑通，只因为它的 installWallProtocol 就在
 * `new BrowserWindow` 前一行。
 *
 * 白名单走 currentRoots() 活读口：装的时候 cache 多半还是 null（空根 = 谁都不
 * 放行），但任何真实请求都发生在首次扫描写进 cache 之后，届时白名单自然跟上
 * （roots 是每次请求现取的函数，见 protocol.ts installWallProtocol 的注释）。
 */
export function primeWallProtocol(): void {
  if (protocolInstalled) return
  installWallProtocol({ roots: currentRoots })
  protocolInstalled = true
}

/**
 * 拿一份目录快照（60s TTL；并发调用共享同一次在飞的扫描）。
 *
 * `force=true` 无视 TTL 立刻重扫 —— 渲染层「刷新」按钮走这条。没有它，
 * 刷新会被这里的 TTL 静默吞掉：用户刚在 WE 订阅完新壁纸点刷新，拿到的
 * 最多是 60 秒前的旧快照（2026-10-05 复核抓到的形态）。在途请求照旧共享
 * （那本来就是最新的一次扫描，没必要再起一个）。
 *
 * scheme 的 privileges 不在这里注册（那个必须 pre-ready，见 protocol.ts）；
 * handler 由 primeWallProtocol() 在窗口出生前装好 —— 这里的懒装只是兜底，
 * 给直接调 catalog 的调用方用（生产路径上恒为 no-op）。
 */
export async function getWallpaperCatalog(force = false): Promise<WallpaperCatalog> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const value = await discover()
      cache = { at: Date.now(), value }
      // 兜底安装：production 里 primeWallProtocol() 已装过（装晚了渲染进程
      // 不认这个 scheme，见它的注释）；这条路径留给直接调 catalog 的场景。
      if (!protocolInstalled) {
        installWallProtocol({ roots: currentRoots })
        protocolInstalled = true
      }
      return value
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** 测试专用：清缓存/重装标记（生产代码不许调） */
export function __resetCatalogForTests(): void {
  cache = null
  inflight = null
  protocolInstalled = false
}
