/**
 * 头像的纯函数（lib/avatar.ts）。
 *
 * 【这个文件在守什么】
 * 1. **上传校验的顺序**：先类型后大小 —— 一个 5MB 的 gif 该报「格式不对」，
 *    而不是「图太大」（用户换了格式才发现还超大，白换一次）。
 * 2. **显示解析的二值性**：预设走 MiMascot、上传走 `<img>`，解析结果只有
 *    四种落点，垃圾输入**必须**落到默认预设 —— 界面永远有一个能画出来的头像。
 * 3. **防手改存档塞巨图**：超长 dataURL 落默认（别让它压垮 localStorage）。
 *
 * fileToAvatarDataUrl 用 DOM（画布/objectURL），node 测试碰不到 ——
 * 那一条靠真窗口探针兜（视图里 validateAvatarFile 不过就根本不会走到它）。
 */
import { describe, expect, it } from 'vitest'
import {
  AVATAR_ALLOWED_TYPES,
  AVATAR_DATA_URL_MAX,
  AVATAR_MAX_BYTES,
  AVATAR_PRESETS,
  AVATAR_SIZE,
  DEFAULT_AVATAR,
  isImageDataUrl,
  isPresetAvatar,
  normalizeAvatar,
  resolveAvatar,
  validateAvatarFile
} from '../avatar'

const DATA_URL = 'data:image/png;base64,iVBORw0KGgo='

describe('validateAvatarFile：先类型后大小', () => {
  it('三种白名单类型全放行（含恰好 2MB 的边界整）', () => {
    for (const type of AVATAR_ALLOWED_TYPES) {
      expect(validateAvatarFile({ type, size: AVATAR_MAX_BYTES }), type).toEqual({ ok: true })
      expect(validateAvatarFile({ type, size: 1 }), type).toEqual({ ok: true })
    }
  })

  it('白名单外一律 BAD_IMAGE（gif / svg / 空串 / 非图片）', () => {
    for (const type of ['image/gif', 'image/svg+xml', '', 'text/plain', 'image/png ']) {
      expect(validateAvatarFile({ type, size: 100 }), JSON.stringify(type)).toEqual({
        ok: false,
        code: 'BAD_IMAGE'
      })
    }
  })

  it('超过 2MB 一格即拒：IMAGE_TOO_BIG（2MB + 1 字节）', () => {
    expect(validateAvatarFile({ type: 'image/png', size: AVATAR_MAX_BYTES + 1 })).toEqual({
      ok: false,
      code: 'IMAGE_TOO_BIG'
    })
  })

  it('坏类型 + 超大：报 BAD_IMAGE（类型先判 —— 顺序被这条钉住）', () => {
    expect(
      validateAvatarFile({ type: 'image/gif', size: AVATAR_MAX_BYTES + 1 })
    ).toEqual({ ok: false, code: 'BAD_IMAGE' })
  })
})

describe('normalizeAvatar / resolveAvatar：显示的四种落点', () => {
  it('预设原样保留', () => {
    for (const id of AVATAR_PRESETS) expect(normalizeAvatar(id)).toBe(id)
  })

  it('未知字符串 / 空 / 非字符串一律落默认', () => {
    for (const v of ['cat', '', 'foo.png', 'data:', null, undefined, 42, {}, []]) {
      expect(normalizeAvatar(v), JSON.stringify(v)).toBe(DEFAULT_AVATAR)
    }
  })

  it('合规 dataURL 原样保留；非 image 的 dataURL 落默认', () => {
    expect(normalizeAvatar(DATA_URL)).toBe(DATA_URL)
    expect(normalizeAvatar('data:text/html;base64,PGI+')).toBe(DEFAULT_AVATAR)
  })

  it('超长 dataURL 落默认（手改存档塞巨图进不来）', () => {
    const huge = 'data:image/png;base64,' + 'A'.repeat(AVATAR_DATA_URL_MAX)
    expect(huge.length).toBeGreaterThan(AVATAR_DATA_URL_MAX)
    expect(normalizeAvatar(huge)).toBe(DEFAULT_AVATAR)
  })

  it('resolveAvatar 二分：preset / image / 垃圾→默认预设', () => {
    expect(resolveAvatar('yay')).toEqual({ kind: 'preset', preset: 'yay' })
    expect(resolveAvatar(DATA_URL)).toEqual({ kind: 'image', src: DATA_URL })
    expect(resolveAvatar('whatever')).toEqual({ kind: 'preset', preset: DEFAULT_AVATAR })
  })
})

describe('形状判据', () => {
  it('isImageDataUrl：data:image/…; 才算；http 与 text/html 都不算', () => {
    expect(isImageDataUrl('data:image/jpeg;base64,x')).toBe(true)
    expect(isImageDataUrl('data:text/html;base64,x')).toBe(false)
    expect(isImageDataUrl('https://example.com/a.png')).toBe(false)
    expect(isImageDataUrl('data:image/png')).toBe(false) // 缺分号，不是完整 dataURL 头
    expect(isImageDataUrl(42)).toBe(false)
  })

  it('isPresetAvatar 只认表内 id', () => {
    expect(isPresetAvatar('welcome')).toBe(true)
    expect(isPresetAvatar('proud')).toBe(false) // 是合法姿态名，但不是头像预设 —— 两条表各管各的
    expect(isPresetAvatar(null)).toBe(false)
  })
})

describe('常量自检', () => {
  it('AVATAR_SIZE 固定 256（画布导出与预览共用同一个数）', () => {
    expect(AVATAR_SIZE).toBe(256)
  })

  it('默认预设必须在预设表里（否则 normalize 的兜底本身就是坏的）', () => {
    expect(AVATAR_PRESETS as readonly string[]).toContain(DEFAULT_AVATAR)
  })
})
