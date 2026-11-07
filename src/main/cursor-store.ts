/**
 * 自定义鼠标指针的**主进程存储**（v7 模块六，2026-10-31）。
 *
 * 目录：`<数据目录>/cursors/`，里面是 `cursor.json` + 用户导入的素材文件。
 * 素材和元数据放同一层，不建子目录的理由：它同时是 miai-wall:// 的白名单根
 * （见 app.ts 的 addProtocolRootProvider），同一层最省事，也方便用户自己打开
 * 文件夹看看放了什么。
 *
 * 【为什么不用 config.json 存】
 * 配置有版本迁移链（config-migrate.ts），每加一个字段都要动迁移；而指针素材
 * 是**文件 + 元数据**的一对东西，天然属于一个独立目录。放 config 里只能存
 * 路径，文件还得另找地方放，反而把一件事拆成两半。
 *
 * 【本文件零 electron 依赖】可以配真临时目录整条测（同 media-import 的理由）。
 *
 * 【写入顺序：先改 JSON、再删旧文件】
 * 反过来的话，删完旧文件、写 JSON 失败 —— 元数据还指向一个不存在的文件，
 * 用户下次打开设置页看到「已设置」但指针是坏的。现在最坏情况是旧文件多留
 * 一份（占几百 KB），指针本身一切正常。
 *
 * 【只在确认「两个槽位都不再引用它」之后才删】
 * 两个槽位可能指向同一个文件（用户手动把两边都改成了同一个名字；
 * 导入走的是复制，不会产生这种局面，但读口必须容得下）。删之前两个槽位都查。
 */
import { existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { createJsonStore, type JsonStore } from './store/json-store'
import { miaiWallUrl } from '../shared/miai-wall-url'
import {
  cursorKindOfFile,
  sanitizeCursorSlots,
  sanitizeHotspot,
  type CursorSlot,
  type CursorSlots,
  type CursorStateView,
  type CursorHotspot,
  type CursorSlotMeta
} from '../shared/cursor'

const STORE_FILE = 'cursor.json'
const STORE_VERSION = 1

/** 某个数据根下的指针素材目录 */
export function cursorsDir(base: string): string {
  return join(base, 'cursors')
}

interface CursorStoreFile {
  version: number
  slots: CursorSlots
}

function storeFor(base: string): JsonStore<CursorStoreFile> {
  return createJsonStore<CursorStoreFile>(cursorsDir(base), STORE_FILE)
}

/**
 * 读槽位表。不存在 / 坏 JSON / 手改坏字段 → 全空（不是错误：首次启动就是这样）。
 * 文件已经不在了的条目也在这里丢掉 —— 返回的每一个 `file` 都保证真实存在。
 */
export function readCursorSlots(base: string): CursorSlots {
  const dir = cursorsDir(base)
  const sanitized = sanitizeCursorSlots(storeFor(base).read())
  const alive = (meta: CursorSlotMeta | null): CursorSlotMeta | null =>
    meta && existsSync(join(dir, meta.file)) ? meta : null
  return { normal: alive(sanitized.normal), click: alive(sanitized.click) }
}

function writeCursorSlots(base: string, slots: CursorSlots): void {
  storeFor(base).write({ version: STORE_VERSION, slots })
}

/** 给渲染层的视图：补上 miai-wall:// 地址（协议根已在 app.ts 登记） */
export function cursorStateView(base: string): CursorStateView {
  const dir = cursorsDir(base)
  const slots = readCursorSlots(base)
  const view = (meta: CursorSlotMeta | null) =>
    meta ? { ...meta, url: miaiWallUrl(join(dir, meta.file)) } : null
  return { normal: view(slots.normal), click: view(slots.click) }
}

/**
 * 槽位不再引用的旧文件删掉。
 *
 * 只接受**纯文件名**（不含路径分隔符）—— 元数据读口已经挡过一次，
 * 这里再挡一次是为了「写口自己拼错了」的路径：这个函数的输入必须是
 * `cursors/` 目录里的一层文件，不能顺着 `..` 删到用户别处。
 */
function cleanupFile(base: string, file: string, next: CursorSlots): void {
  if (file.includes('\\') || file.includes('/') || file === '.' || file === '..') return
  if (next.normal?.file === file || next.click?.file === file) return
  try {
    unlinkSync(join(cursorsDir(base), file))
  } catch {
    // 删不掉（文件被播放器占着 / 已被用户手动删掉）：不影响任何功能，
    // 下次导入还会走同样的清理，残留文件最多占一点磁盘。
  }
}

/** 把「刚导入成功的文件」挂到一个槽位上（kind 由扩展名确定，热点归零为自动） */
export function applyCursorFile(base: string, slot: CursorSlot, fileName: string): CursorSlots {
  const kind = cursorKindOfFile(fileName)
  if (!kind) throw new TypeError(`cursor: unsupported file: ${fileName}`)
  const prev = readCursorSlots(base)
  const next: CursorSlots = { ...prev, [slot]: { file: fileName, kind, hotspot: null } }
  writeCursorSlots(base, next)
  if (prev[slot] && prev[slot]!.file !== fileName) cleanupFile(base, prev[slot]!.file, next)
  return next
}

/** 清空一个槽位（该状态回到内置猫爪） */
export function clearCursorSlot(base: string, slot: CursorSlot): CursorSlots {
  const prev = readCursorSlots(base)
  const old = prev[slot]
  if (!old) return prev
  const next: CursorSlots = { ...prev, [slot]: null }
  writeCursorSlots(base, next)
  cleanupFile(base, old.file, next)
  return next
}

/**
 * 写一个槽位的热点。`null` = 交还给自动定位。
 * 槽位没设置时抛 —— 这是「我们自己调用错了」，不是用户能触发的常态。
 */
export function setCursorHotspot(
  base: string,
  slot: CursorSlot,
  hotspot: CursorHotspot | null
): CursorSlots {
  const prev = readCursorSlots(base)
  const old = prev[slot]
  if (!old) throw new Error(`cursor: no file in slot ${slot}`)
  // 显式坐标再过一次清洗口：NaN / 越界一律拒（不静默夹取，见 shared/cursor.ts）
  if (hotspot !== null) {
    const clean = sanitizeHotspot(hotspot.x, hotspot.y)
    if (!clean) throw new RangeError('cursor: hotspot out of range')
    hotspot = clean
  }
  const next: CursorSlots = { ...prev, [slot]: { ...old, hotspot } }
  writeCursorSlots(base, next)
  return next
}
