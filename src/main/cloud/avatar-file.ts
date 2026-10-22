/**
 * 头像选图的本地校验（2026-10-22 用户系统批次）—— 纯 fs，零网络。
 *
 * 【为什么主进程要再验一遍】渲染层的 <input type=file> 不是信任边界：
 * IPC 载荷可以伪造、对话框可以手打文件名、文件可以在选中后**被改名/截断**
 * （用户在资源管理器里改了另一个文件）。所以主进程按「磁盘上此刻的真实字节」
 * 验三件事，任何一条不过都回 CloudResult 失败，绝不把半个图片交给渲染层：
 *   1. 后缀 ∈ {png, jpg, jpeg}（对话框的 filter 只是提示，不是判据）；
 *   2. 体积 ≤ AVATAR_PICK_MAX_BYTES（2MB：预览与裁剪都在内存里做，不能任人
 *      拖一个 200MB 的扫描件进来把渲染进程撑死）；
 *   3. **magic 字节与后缀一致**（PNG 签名 / JPEG 的 FF D8 FF）—— 后缀叫 .png
 *      但内容不是 PNG = 拒绝；空文件 = 拒绝。
 * 损坏得更深的图片（magic 对、内部结构烂）交给渲染层 createImageBitmap 解码
 * 失败兜底：这里只做「不可能是图片」的第一道闸，不解码（主进程没有 canvas，
 * 也不该为了校验去引一个图片库）。
 *
 * 【返回什么】原图的 data URL + 文件名（文件名只用于界面显示，绝不参与路径
 * 拼接）。取消选择由调用方回 ok(null)——那是用户意志，不是错误。
 */
import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'

import type { AvatarPickView, CloudResult } from '../../shared/cloud/dto'
import { cloudFail, cloudOk } from './transport'

/**
 * 选图体积上限 2MB（主人 2026-10-22 需求原文「限制大小如 2MB 以内」）。
 * 注意与上传上限 AVATAR_MAX_BYTES（512KB，裁剪后的 256×256 PNG）区分：
 * 2MB 是**原图**进内存的门，512KB 是**上传体**的门。
 */
export const AVATAR_PICK_MAX_BYTES = 2 * 1024 * 1024

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
/** JPEG 以 SOI (FF D8) + 第一个 marker 的 FF 开头；FF D8 FF 足以判定不是别的格式 */
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const

export type AvatarFileKind = 'png' | 'jpeg'

/** 只看文件头：认得出是 PNG/JPEG 就回类型，认不出回 null */
export function detectAvatarImageKind(bytes: Uint8Array): AvatarFileKind | null {
  if (bytes.length >= PNG_MAGIC.length) {
    let png = true
    for (let i = 0; i < PNG_MAGIC.length; i += 1) {
      if (bytes[i] !== PNG_MAGIC[i]) {
        png = false
        break
      }
    }
    if (png) return 'png'
  }
  if (bytes.length >= JPEG_MAGIC.length) {
    let jpeg = true
    for (let i = 0; i < JPEG_MAGIC.length; i += 1) {
      if (bytes[i] !== JPEG_MAGIC[i]) {
        jpeg = false
        break
      }
    }
    if (jpeg) return 'jpeg'
  }
  return null
}

/** 后缀 → 期望类型；不认识的后缀回 null（判据是白名单，不是黑名单） */
function kindFromExtension(filePath: string): AvatarFileKind | null {
  switch (extname(filePath).toLowerCase()) {
    case '.png':
      return 'png'
    case '.jpg':
    case '.jpeg':
      return 'jpeg'
    default:
      return null
  }
}

/**
 * 读并校验一个用户选中的文件。
 * 失败一律是 CloudResult.failure（界面按 code 出大肥鱼语气文案）：
 *   · PAYLOAD_TOO_LARGE      —— 超过 2MB
 *   · UNSUPPORTED_MEDIA_TYPE —— 后缀不认识 / 内容不是真图片 / 后缀与内容不符 / 读不了
 */
export function readAvatarPick(filePath: string): CloudResult<AvatarPickView> {
  const expected = kindFromExtension(filePath)
  if (expected === null) {
    return cloudFail('UNSUPPORTED_MEDIA_TYPE', 'avatar must be a .png, .jpg or .jpeg file')
  }

  let size: number
  try {
    size = statSync(filePath).size
  } catch {
    return cloudFail('UNSUPPORTED_MEDIA_TYPE', 'cannot read the selected file')
  }
  if (size === 0) {
    return cloudFail('UNSUPPORTED_MEDIA_TYPE', 'the selected file is empty')
  }
  if (size > AVATAR_PICK_MAX_BYTES) {
    return cloudFail('PAYLOAD_TOO_LARGE', `avatar image must be at most ${AVATAR_PICK_MAX_BYTES} bytes`)
  }

  let bytes: Uint8Array
  try {
    bytes = readFileSync(filePath)
  } catch {
    // 选中后到读取前被删/被占用：仍按「这个文件用不了」上报，不让 fs 异常跨 IPC
    return cloudFail('UNSUPPORTED_MEDIA_TYPE', 'cannot read the selected file')
  }
  /*
   * 再量一次真实读到的字节（2026-10-22 夜间自查）：stat 与 readFile 之间
   * 文件可能被追加/替换（用户或同步盘都会干这事），只看 stat 的旧尺寸就
   * 会让一个已经超过 2MB 的文件进内存。尺寸以**实际读到的**为准。
   */
  if (bytes.length > AVATAR_PICK_MAX_BYTES) {
    return cloudFail('PAYLOAD_TOO_LARGE', `avatar image must be at most ${AVATAR_PICK_MAX_BYTES} bytes`)
  }

  const actual = detectAvatarImageKind(bytes)
  if (actual === null) {
    return cloudFail('UNSUPPORTED_MEDIA_TYPE', 'the selected file is not a real image')
  }
  if (actual !== expected) {
    // .png 里装 JPEG（或反过来）：改名骗不了 magic —— 按内容落 MIME，但既然
    // 后缀与内容已经互相矛盾，最稳妥的是拒绝并要求重新选
    return cloudFail('UNSUPPORTED_MEDIA_TYPE', 'file extension does not match its content')
  }

  const mime = actual === 'png' ? 'image/png' : 'image/jpeg'
  return cloudOk({
    dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`,
    fileName: basename(filePath)
  })
}
