/**
 * 头像：预设、上传校验、显示解析（UI 大修轮 2026-10-09 · 契约 §5.5）。
 *
 * 2026-10-22 用户系统批次：云头像接回来了 —— 主进程 dialog 选图并验过
 * 后缀/2MB/magic 之后，渲染层用 `imageDataUrlToAvatarPng` 居中裁成 256×256
 * PNG 再上传（服务端只收 image/png、≤512KB）。本文件仍然是纯判定 + DOM
 * 图像处理，不碰 IPC。
 *
 * 【为什么预设头像不在这里 import 图片】
 * MiMascot 已经掌握 `assets/mascot/` 的整张 glob 表，而且「小档位优先半身版」
 * 那条规矩它自己就会办（`mascotKeysFor`）—— 预设头像的内容就是「一个姿态名」，
 * 显示交给 `<MiMascot :pose>`，这里只回答「这个引用该走哪条通道」。
 * 附带好处：本文件保持纯函数、全部判定可进单测。真在这里 glob 一次，
 * `import.meta.glob` 的编译期语法会让整个文件进不了 node 测试
 * （`lib/gallery.ts` 抬头记过同一条，这里不重蹈）。
 *
 * 【两种头像引用，存档里是一个字符串】预设存 id（`'welcome'`），上传存
 * dataURL（`'data:image/png;base64,...'`）。读取侧永远过 `resolveAvatar`
 * 归一 —— 手改过的存档、将来的旧格式，都坏不进界面（最坏退回默认预设）。
 */
import { AVATAR_MAX_BYTES as AVATAR_UPLOAD_MAX_BYTES } from '../../../shared/cloud/protocol'

/** 预设头像的 id 表 = MiMascot 的姿态名里的两个「脸最好看」的（welcome=好奇打招呼，yay=小庆祝比心） */
export const AVATAR_PRESETS = ['welcome', 'yay'] as const

export type AvatarPreset = (typeof AVATAR_PRESETS)[number]

/** 没头像 / 头像坏掉时用哪一个 */
export const DEFAULT_AVATAR: AvatarPreset = 'welcome'

/** 上传图片的体积上限（2MB）。超过的直接在选文件那一步就挡下，不进解码 */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

/** 允许的图片类型。**白名单**：认不出的（gif、svg、heic…）一律 BAD_IMAGE */
export const AVATAR_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

/**
 * dataURL 引用的长度上限（≈400KB 字符，约 300KB 二进制）。
 * 界面上的正规来路是画布缩到 256×256 再导出（通常几十 KB），
 * 这个上限只挡「手改存档塞进一张巨图」——超了归一到默认，别让它压垮 localStorage。
 */
export const AVATAR_DATA_URL_MAX = 400_000

/** 上传头像的边长（px，正方形，居中裁） */
export const AVATAR_SIZE = 256

/**
 * 解码前的像素总数上限（2026-10-22 夜间自查）。
 * 2MB 的 PNG 可以是极小的纯色大图（几万×几万），解码后会占几百 MB～
 * 数 GB —— 主进程的体积闸门挡不住这种「压缩比炸弹」。4000 万像素
 * （≈ 6300×6300）已远超任何正常头像，超了直接按坏图对待。
 */
export const AVATAR_MAX_DECODE_PIXELS = 40_000_000

/** 形状判据：是否预设 id。**不含洗数**（洗数走 normalizeAvatar） */
export function isPresetAvatar(v: unknown): v is AvatarPreset {
  return typeof v === 'string' && (AVATAR_PRESETS as readonly string[]).includes(v)
}

/**
 * 形状判据：是否 dataURL 图片引用。
 * 只认 `data:image/...;` 开头 —— `data:text/html` 之类塞进来毫无意义，
 * 而将来渲染在 `<img src>` 上的一切输入都该先过这里。**不判长度**（长度归 normalizeAvatar）。
 */
export function isImageDataUrl(v: unknown): v is string {
  return typeof v === 'string' && /^data:image\/[a-z0-9.+-]+;/i.test(v)
}

/**
 * 把存档里的头像引用洗成一定可显示的值：预设 / 合规 dataURL / 默认预设。
 * 读口（demo-auth 读档、登录返回）与写口（注册）共用这一个函数 ——
 * 「什么算合法头像」只此一处定义。
 */
export function normalizeAvatar(v: unknown): string {
  if (isPresetAvatar(v)) return v
  if (isImageDataUrl(v) && v.length <= AVATAR_DATA_URL_MAX) return v
  return DEFAULT_AVATAR
}

/** 显示解析结果：两条通道二选一，视图照 kind 分支渲染 */
export type AvatarView = { kind: 'preset'; preset: AvatarPreset } | { kind: 'image'; src: string }

/**
 * 显示解析：`preset` → `<MiMascot :pose="preset">`（小档位自动用半身图）；
 * `image` → `<img :src>`。垃圾输入在这里就已经被洗成默认预设，视图不必再兜。
 */
export function resolveAvatar(v: unknown): AvatarView {
  const clean = normalizeAvatar(v)
  return isPresetAvatar(clean) ? { kind: 'preset', preset: clean } : { kind: 'image', src: clean }
}

/**
 * 选文件那一步的失败原因。原消费方（登录页的头像区）随 P10.6 下线 ——
 * 云头像（P10.7）接回来时，文案进 copy.ts 的 ACCOUNT 组，别再挂回 LOGIN
 * （那组已经不存在了）。
 */
export type AvatarFileError = 'BAD_IMAGE' | 'IMAGE_TOO_BIG'

export type AvatarFileCheck = { ok: true } | { ok: false; code: AvatarFileError }

/**
 * 前端校验用户挑的图片：**先类型后大小**（类型不对就不必再看大小了）。
 * 入参放宽成 `{ type, size }` 而不是 `File`：单测里不必造真的 File 对象。
 *
 * ⚠️ 后端接通后，这里之后还要过服务端的内容审核（违禁图拦截）——
 * 本地演示版没有上传行为，也就没有审核面；上传通道的含义见 `fileToAvatarDataUrl`。
 */
export function validateAvatarFile(file: { type: string; size: number }): AvatarFileCheck {
  if (!(AVATAR_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, code: 'BAD_IMAGE' }
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return { ok: false, code: 'IMAGE_TOO_BIG' }
  }
  return { ok: true }
}

// ---------------------------------------------------------------- 上传产物（2026-10-22）

/** 裁剪产物：dataUrl 用于预览/本地缓存，bytes 原样上传（两者逐字节一致） */
export interface AvatarPng {
  dataUrl: string
  bytes: Uint8Array
}

/** data URL 的 base64 段 → 字节（atob 在渲染进程与 Node 24 都有） */
function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return null
  try {
    const binary = atob(dataUrl.slice(comma + 1))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/** 解码 data URL → Image；坏图/空图回 null（从不让 onload 之外的路径 resolve 一个半成品） */
function loadImage(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onerror = () => resolve(null)
    img.onload = () => resolve(img)
    img.src = dataUrl
  })
}

/**
 * 把主进程选好的原图 data URL 居中裁成正方形 PNG（2026-10-22）。
 *
 * 【为什么有档位回退】服务端只收 ≤512KB 的 PNG。256×256 对照片通常
 * 100~250KB，但极端纹理（噪点图）可能顶破上限；先试 256，超了就 192、
 * 再 128 —— 宁可头像小一点，也不上传一个服务端必拒的包。
 *
 * 【失败一律 null】解码失败 / 画布被拒 / 三档都超限 —— 视图收到 null 弹
 * ERR_AVATAR_DECODE，绝不上传半成品。
 */
export async function imageDataUrlToAvatarPng(dataUrl: string): Promise<AvatarPng | null> {
  if (!isImageDataUrl(dataUrl)) return null
  const img = await loadImage(dataUrl)
  if (img === null) return null
  const width = img.naturalWidth || img.width
  const height = img.naturalHeight || img.height
  // 解码炸弹防线：体积门只能管压缩后的大小，管不了解压后的像素数
  if (!(width > 0) || !(height > 0) || width * height > AVATAR_MAX_DECODE_PIXELS) return null
  const side = Math.min(width, height)
  if (!(side > 0)) return null

  for (const size of [AVATAR_SIZE, 192, 128]) {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      // 居中裁方：以原图中心为锚，取最长可用正方形
      const sx = ((img.naturalWidth || img.width) - side) / 2
      const sy = ((img.naturalHeight || img.height) - side) / 2
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
      const out = canvas.toDataURL('image/png')
      const bytes = dataUrlToBytes(out)
      if (bytes !== null && bytes.length <= AVATAR_UPLOAD_MAX_BYTES) {
        return { dataUrl: out, bytes }
      }
    } catch {
      return null
    }
  }
  return null
}

/**
 * 把用户选的图片缩成 256×256 方图 dataURL（居中裁方）。
 *
 * 只在渲染进程里跑（node 测试碰不到 DOM，这条靠真窗口兜 —— 视图里
 * 校验先行的顺序保证：validateAvatarFile 不过就根本不会走到这里）。
 * **失败一律给 null**（objectURL 建不出、解码失败、画布被拒），
 * 视图收到 null 就弹 ERR_BAD_IMAGE —— 绝不 resolve 一个半成品。
 *
 * ⚠️ 后端接通时：上传的应该是这里的产物（256 方图 dataURL），
 * 服务端再过违禁图拦截；本地演示版它只进 localStorage，不出这台机器。
 */
export function fileToAvatarDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    let url = ''
    try {
      url = URL.createObjectURL(file)
    } catch {
      resolve(null)
      return
    }
    const img = new Image()
    const giveUp = (): void => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.onerror = giveUp
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = AVATAR_SIZE
        canvas.height = AVATAR_SIZE
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          giveUp()
          return
        }
        const side = Math.min(img.width, img.height)
        if (!(side > 0)) {
          giveUp()
          return
        }
        ctx.drawImage(
          img,
          (img.width - side) / 2,
          (img.height - side) / 2,
          side,
          side,
          0,
          0,
          AVATAR_SIZE,
          AVATAR_SIZE
        )
        const out = canvas.toDataURL('image/png')
        URL.revokeObjectURL(url)
        resolve(out)
      } catch {
        giveUp()
      }
    }
    img.src = url
  })
}
