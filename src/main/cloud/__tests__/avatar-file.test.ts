/**
 * 头像选图校验（main/cloud/avatar-file.ts，2026-10-22 用户系统批次）单测。
 *
 * 【这个文件在守什么】主进程是**唯一信任边界**：对话框的 filter 只是提示，
 * 用户可以手打文件名、可以在选中后换掉/截断文件。所以判据必须落在磁盘上的
 * 真实字节：后缀白名单、2MB 体积门、magic 与后缀一致、空文件/读不了。
 *
 * 【为什么每条都要真文件】纯函数 detectAvatarImageKind 单独测过之后，仍然
 * 需要一组真文件把「stat/readFile 的失败路径」跑出来 —— 那些分支只在文件
 * 系统上存在（mock fs 会把它们测成想象出来的形状）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { AVATAR_PICK_MAX_BYTES, detectAvatarImageKind, readAvatarPick } from '../avatar-file'

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0])

/** PNG 签名 + 一点尾巴（校验只看文件头，不负责解码） */
const PNG_BYTES = Buffer.concat([PNG_MAGIC, Buffer.from('rest-of-png')])
const JPEG_BYTES = Buffer.concat([JPEG_MAGIC, Buffer.from('rest-of-jpeg')])

let dirs: string[] = []
let seq = 0

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function writeTemp(name: string, bytes: Buffer | Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 'miai-avatar-pick-'))
  dirs.push(dir)
  const path = join(dir, name)
  writeFileSync(path, bytes)
  return path
}

function failureOf(path: string): { code: string; message: string } {
  const res = readAvatarPick(path)
  expect(res.ok).toBe(false)
  if (res.ok) throw new Error('expected a failure result')
  return res.failure
}

describe('detectAvatarImageKind —— 只看文件头', () => {
  it('认得 PNG / JPEG；太短、别的格式、空都回 null', () => {
    expect(detectAvatarImageKind(PNG_BYTES)).toBe('png')
    expect(detectAvatarImageKind(JPEG_BYTES)).toBe('jpeg')
    expect(detectAvatarImageKind(Buffer.alloc(0))).toBe(null)
    expect(detectAvatarImageKind(PNG_MAGIC.subarray(0, 7))).toBe(null)
    expect(detectAvatarImageKind(Buffer.from([0xff, 0xd8]))).toBe(null) // JPEG 差最后一个 FF
    expect(detectAvatarImageKind(Buffer.from('GIF89a'))).toBe(null)
    // 种坏自检：PNG 签名被改一个字节 ⇒ 必须认不出来（防「恒真」）
    const broken = Buffer.from(PNG_BYTES)
    broken[1] = 0x00
    expect(detectAvatarImageKind(broken)).toBe(null)
  })
})

describe('readAvatarPick —— 后缀白名单', () => {
  it('.png / .jpg / .jpeg（含大写后缀）都能读，data URL 前缀随真实类型', () => {
    const cases: Array<[string, Buffer, string]> = [
      ['a.png', PNG_BYTES, 'data:image/png;base64,'],
      ['b.PNG', PNG_BYTES, 'data:image/png;base64,'],
      ['c.jpg', JPEG_BYTES, 'data:image/jpeg;base64,'],
      ['d.jpeg', JPEG_BYTES, 'data:image/jpeg;base64,'],
      ['e.JPEG', JPEG_BYTES, 'data:image/jpeg;base64,']
    ]
    for (const [name, bytes, prefix] of cases) {
      const path = writeTemp(name, bytes)
      const res = readAvatarPick(path)
      expect(res.ok, name).toBe(true)
      if (!res.ok) continue
      expect(res.data.fileName).toBe(name)
      expect(res.data.dataUrl.startsWith(prefix)).toBe(true)
      expect(Buffer.from(res.data.dataUrl.slice(prefix.length), 'base64').equals(bytes)).toBe(true)
    }
  })

  it('不在白名单的后缀（.gif/.bmp/.txt/无后缀）一律 UNSUPPORTED_MEDIA_TYPE', () => {
    for (const name of ['a.gif', 'a.bmp', 'a.txt', 'a']) {
      // 内容即使是真 PNG，后缀不在白名单也不收（判据是白名单，不是内容恰好能认）
      expect(failureOf(writeTemp(name, PNG_BYTES)).code, name).toBe('UNSUPPORTED_MEDIA_TYPE')
    }
  })
})

describe('readAvatarPick —— 体积与内容', () => {
  it('空文件 → UNSUPPORTED_MEDIA_TYPE', () => {
    expect(failureOf(writeTemp('empty.png', Buffer.alloc(0))).code).toBe('UNSUPPORTED_MEDIA_TYPE')
  })

  it('恰好 2MB 能过体积门；2MB+1 字节 → PAYLOAD_TOO_LARGE', () => {
    const exact = Buffer.concat([PNG_MAGIC, Buffer.alloc(AVATAR_PICK_MAX_BYTES - PNG_MAGIC.length)])
    expect(exact.length).toBe(AVATAR_PICK_MAX_BYTES)
    expect(readAvatarPick(writeTemp('exact.png', exact)).ok).toBe(true)

    const over = Buffer.concat([PNG_MAGIC, Buffer.alloc(AVATAR_PICK_MAX_BYTES + 1 - PNG_MAGIC.length)])
    expect(over.length).toBe(AVATAR_PICK_MAX_BYTES + 1)
    const failure = failureOf(writeTemp('over.png', over))
    expect(failure.code).toBe('PAYLOAD_TOO_LARGE')
    expect(failure.message).toContain(String(AVATAR_PICK_MAX_BYTES))
  })

  it('后缀与内容不符（.png 里装 JPEG / 反之）→ UNSUPPORTED_MEDIA_TYPE', () => {
    expect(failureOf(writeTemp('fake.png', JPEG_BYTES)).code).toBe('UNSUPPORTED_MEDIA_TYPE')
    expect(failureOf(writeTemp('fake.jpg', PNG_BYTES)).code).toBe('UNSUPPORTED_MEDIA_TYPE')
  })

  it('后缀对但内容不是图片（HTML / 纯文本）→ UNSUPPORTED_MEDIA_TYPE', () => {
    expect(failureOf(writeTemp('page.png', Buffer.from('<html>404</html>'))).code).toBe(
      'UNSUPPORTED_MEDIA_TYPE'
    )
    expect(failureOf(writeTemp('notes.jpg', Buffer.from('hello'))).code).toBe(
      'UNSUPPORTED_MEDIA_TYPE'
    )
  })

  it('文件不存在 / 读不了 → UNSUPPORTED_MEDIA_TYPE（fs 异常不许跨 IPC）', () => {
    const missing = join(tmpdir(), `miai-avatar-missing-${process.pid}-${++seq}.png`)
    expect(failureOf(missing).code).toBe('UNSUPPORTED_MEDIA_TYPE')
    // 目录也能过 statSync，但 readFileSync 必失败 —— 覆盖「选中后变成目录」的怪情况
    // （名字必须以白名单后缀结尾，否则会先被后缀闸拦下，测不到读失败这一层）
    const dir = mkdtempSync(join(tmpdir(), 'miai-avatar-dir-'))
    dirs.push(dir)
    const dirAsPng = join(dir, 'folder.png')
    mkdirSync(dirAsPng)
    expect(failureOf(dirAsPng).code).toBe('UNSUPPORTED_MEDIA_TYPE')
  })
})
