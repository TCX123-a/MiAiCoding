/**
 * 自定义鼠标指针 —— 主进程与渲染层共用的契约（v7 模块六，2026-10-31）。
 *
 * 【为什么单独一个文件】
 * 这份形状有三条腿：主进程的存储与 IPC、渲染层的应用器、设置页的预览。
 * 任何一条腿自己拼一份字段，最容易出现的漂移是「kind 写成 video 但渲染层
 * 按图片走」——症状是视频指针永远不出现，而界面上明明显示已设置。
 *
 * 【两个槽位是独立的两件东西】
 * `normal` 是松开时的指针，`click` 是按下时的指针。它们可以一个是图片、
 * 一个是视频、一个空着 —— 空着 = 该状态沿用内置猫爪（不是错误）。
 *
 * 【热点为什么用 0~1 的归一化坐标】
 * 指针图在渲染层会被缩到 ≤128px 再交给浏览器（Chromium 的自定义指针上限），
 * 用户看到的像素尺寸和原图不一样。存归一化坐标，缩放多少都不会算歪；
 * 存像素坐标的话，换一台缩放比不同的机器/换一次上限就要重新换算。
 *
 * 【hotspot 为 null = 自动定位】
 * 图片：渲染层扫 alpha 通道找最靠左上的不透明像素（常见指针图的「箭尖」）。
 * 视频：没有 alpha 通道，落在正中间。
 * 用户点一下预览就会写入显式坐标；点「自动定位」再写回 null。
 */

/** 两个槽位。顺序 = 设置页上下的顺序（常态在上、点击在下） */
export const CURSOR_SLOTS = ['normal', 'click'] as const
export type CursorSlot = (typeof CURSOR_SLOTS)[number]

/** 图片类扩展名（CursorCard 的按钮提示与主进程白名单共用这一份） */
export const CURSOR_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] as const
/** 视频类扩展名。只收浏览器能直接解码的两种（不做转码） */
export const CURSOR_VIDEO_EXTS = ['mp4', 'webm'] as const
/** 对话框筛选器全列表 */
export const CURSOR_UPLOAD_EXTS: readonly string[] = [...CURSOR_IMAGE_EXTS, ...CURSOR_VIDEO_EXTS]

/**
 * 导入的体积上下限。
 *
 * 【为什么下限不是 1KB】壁纸/开屏素材的 1KB 门槛是给扫描器对齐用的，
 * 而指针图本来就可能很小（16×16 的 PNG 只有几百字节）。这里只挡「空文件」
 * 和「明显损坏」，真正能不能当指针由浏览器解码结果说了算。
 *
 * 【上限 64MB】指针是一小块视觉元素，不该接受几百 MB 的文件；
 * 而且视频指针要预载进内存，给太大只会拖慢启动。
 */
export const CURSOR_MIN_BYTES = 16
export const CURSOR_MAX_BYTES = 64 * 1024 * 1024

/** 素材种类。判据只有扩展名 —— 这一层不做魔数嗅探（浏览器解码时才知道） */
export type CursorKind = 'image' | 'video'

/** 归一化热点（0~1）。null 见文件头「自动定位」 */
export interface CursorHotspot {
  x: number
  y: number
}

/** 落盘的单个槽位元数据。`file` 是素材目录里的**纯文件名**，不是路径 */
export interface CursorSlotMeta {
  file: string
  kind: CursorKind
  hotspot: CursorHotspot | null
}

export interface CursorSlots {
  normal: CursorSlotMeta | null
  click: CursorSlotMeta | null
}

/** 给渲染层的槽位视图：多一个可直接塞进 <img>/<video> 的 miai-wall:// 地址 */
export interface CursorSlotView extends CursorSlotMeta {
  url: string
}

/** 一次读取的完整状态（两个槽位各自可能为空） */
export interface CursorStateView {
  normal: CursorSlotView | null
  click: CursorSlotView | null
}

/** 操作失败原因码。与 MediaImportResult.reason 对齐，另加一个存储失败 */
export type CursorFailReason =
  | 'cancelled'
  | 'bad-ext'
  | 'too-small'
  | 'too-large'
  | 'copy-failed'
  | 'store-failed'

/**
 * 三条写通道（导入/清除/改热点）的统一回话。
 * `state` 永远是**写完之后**的完整状态 —— 调用方直接换上，
 * 省一次 cursor:get 往返，也不会出现「写成功了、读到的还是旧的」。
 */
export type CursorOpResult =
  | { ok: true; state: CursorStateView }
  | { ok: false; reason: CursorFailReason; message?: string }

export function isCursorSlot(value: unknown): value is CursorSlot {
  return typeof value === 'string' && (CURSOR_SLOTS as readonly string[]).includes(value)
}

/** 从文件名判种类。认不出（不在白名单 / 没有点）= null */
export function cursorKindOfFile(name: string): CursorKind | null {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  const ext = name.slice(dot + 1).toLowerCase()
  if ((CURSOR_IMAGE_EXTS as readonly string[]).includes(ext)) return 'image'
  if ((CURSOR_VIDEO_EXTS as readonly string[]).includes(ext)) return 'video'
  return null
}

/**
 * 收一个热点坐标：必须是有限数且落在 0~1 内，否则 null。
 *
 * 越界的值**不夹取**（不像渲染层算像素时那样），因为落盘的口子是「用户拖出来的
 * 一个位置」，越界只能是上游算错或文件被手改 —— 静默夹到边上会把一个 bug
 * 变成"看起来能用"，而 null（自动定位）至少是诚实且可用的。
 */
export function sanitizeHotspot(x: unknown, y: unknown): CursorHotspot | null {
  if (typeof x !== 'number' || typeof y !== 'number') return null
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x, y }
}

/** 文件名必须是纯文件名：带路径分隔符/NUL/`..` 的一律不认（防越界读） */
function safeFileName(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null
  if (value.includes('\0') || value.includes('\\') || value.includes('/')) return null
  if (value === '.' || value === '..') return null
  return value
}

function sanitizeSlotMeta(raw: unknown): CursorSlotMeta | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const file = safeFileName(rec['file'])
  if (!file) return null
  // 种类以**磁盘上的扩展名**为准：元数据里的 kind 是写口顺手记的，
  // 文件被改名后（用户手动整理素材目录）残留的旧 kind 会骗过渲染层。
  const kind = cursorKindOfFile(file)
  if (!kind) return null
  const hotspot = sanitizeHotspot(
    (rec['hotspot'] as Record<string, unknown> | null | undefined)?.['x'],
    (rec['hotspot'] as Record<string, unknown> | null | undefined)?.['y']
  )
  return { file, kind, hotspot }
}

/**
 * 清洗一份落盘/入参的槽位表。任何认不出的槽位按「未设置」处理。
 *
 * 宽容读、严格写：读口不能让一个手改坏的 JSON 把应用卡在启动失败上；
 * 写口（主进程）只写这个函数认可的形状。
 */
export function sanitizeCursorSlots(raw: unknown): CursorSlots {
  const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  const slots = (rec?.['slots'] && typeof rec['slots'] === 'object'
    ? rec['slots']
    : rec) as Record<string, unknown> | null
  return {
    normal: sanitizeSlotMeta(slots?.['normal']),
    click: sanitizeSlotMeta(slots?.['click'])
  }
}
