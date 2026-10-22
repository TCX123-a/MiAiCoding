/**
 * device.json 的建档 / 幂等 / 修复（src/main/store/device.ts）
 *
 * 【这个文件在守什么】
 *   1. **installId 变了 = 身份没了**。它同时是 practice 会话 uid 的前缀与
 *      服务端 install_id 列的取值：换一次 id，两边的账就各归各的，而没有任何
 *      地方会报错。所以「能救则救」：installId 有效就绝不动它。
 *   2. **启动路径不许有写**。有效文件被重写一次，mtime 就动一次、.bak 就多一份，
 *      按 mtime 判新旧的东西（P10.3 同步）从此误判。「★ 再次调用」用例把这条钉死：
 *      逐字节相等 + mtime 不动 + 连 .bak 都没生成。
 *   3. **静默重建是铁律禁止的**。文件在但坏（形状不对 / 连 JSON 都不是）必须出声；
 *      只有「文件不在」才是静默的首跑。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，字符串一律英文。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DEVICE_FILE_VERSION, ensureDeviceFile } from '../device'
import { isCanonicalUuid } from '../account-id'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'miai-device-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function devicePath(): string {
  return join(dir, 'device.json')
}

describe('ensureDeviceFile：建档', () => {
  it('新目录（文件不存在）→ 静默建出 device.json：canonical UUID + 合法 label', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const info = ensureDeviceFile(dir, { hostname: () => 'study-pc' })
      // 文件不在 = 正常的首跑，**不出声**（出声只留给「文件在但坏」）
      expect(warn).not.toHaveBeenCalled()
      expect(info.version).toBe(DEVICE_FILE_VERSION)
      expect(isCanonicalUuid(info.installId)).toBe(true)
      expect(info.clientLabel).toBe('study-pc')
      expect(info.clientLabel.length).toBeGreaterThan(0)
      expect(info.clientLabel.length).toBeLessThanOrEqual(64)
      expect(existsSync(devicePath())).toBe(true)
      expect(JSON.parse(readFileSync(devicePath(), 'utf-8'))).toEqual(info)
    } finally {
      warn.mockRestore()
    }
  })

  it('注入 hostname 返回空白 → label 退成 device', () => {
    const info = ensureDeviceFile(dir, { hostname: () => '   ' })
    expect(info.clientLabel).toBe('device')
  })

  it('hostname 超长（100 字符）→ 截到 64', () => {
    const info = ensureDeviceFile(dir, { hostname: () => 'x'.repeat(100) })
    expect(info.clientLabel).toBe('x'.repeat(64))
    expect(info.clientLabel.length).toBe(64)
  })
})

describe('ensureDeviceFile：幂等（启动路径每次都会调它）', () => {
  it('★ 再次调用：返回值相同、文件逐字节相同、mtime 不动、连 .bak 都不生成', () => {
    const opts = { hostname: () => 'study-pc' }
    const first = ensureDeviceFile(dir, opts)
    const bytes = readFileSync(devicePath())
    const mtime = statSync(devicePath()).mtimeMs

    const second = ensureDeviceFile(dir, opts)

    expect(second).toEqual(first)
    // 逐字节比对（读口「原样返回」的硬证据）
    expect(readFileSync(devicePath()).equals(bytes)).toBe(true)
    // 「一个字节都不写」再补两条旁证：重写会动 mtime、会先备份出 .bak
    expect(statSync(devicePath()).mtimeMs).toBe(mtime)
    expect(existsSync(devicePath() + '.bak')).toBe(false)
  })

  it('同一个目录连调三次都不会翻车（返回值恒定）', () => {
    const opts = { hostname: () => 'study-pc' }
    const a = ensureDeviceFile(dir, opts)
    const b = ensureDeviceFile(dir, opts)
    const c = ensureDeviceFile(dir, opts)
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })
})

describe('ensureDeviceFile：修复（能救的必须救，但绝不静默）', () => {
  it('★ installId 是垃圾值（../x）→ 换成合法 UUID、保住有效的 clientLabel、出一声', () => {
    writeFileSync(devicePath(), JSON.stringify({ version: 1, installId: '../x', clientLabel: 'my laptop' }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const info = ensureDeviceFile(dir, { hostname: () => 'ignored-host' })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(isCanonicalUuid(info.installId)).toBe(true)
      expect(info.installId).not.toBe('../x')
      // label 有效就原样保留（不是从 hostname 重取 —— hostname 注入的是 ignored-host）
      expect(info.clientLabel).toBe('my laptop')
      expect(JSON.parse(readFileSync(devicePath(), 'utf-8'))).toEqual(info)
    } finally {
      warn.mockRestore()
    }
  })

  it('installId 有效但 clientLabel 缺失 → 保住 installId、补一个合法 label、出一声', () => {
    const id = '11111111-2222-3333-4444-555555555555'
    writeFileSync(devicePath(), JSON.stringify({ version: 1, installId: id }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const info = ensureDeviceFile(dir, { hostname: () => 'study-pc' })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(info.installId).toBe(id) // 身份不能被换
      expect(info.clientLabel).toBe('study-pc')
      expect(JSON.parse(readFileSync(devicePath(), 'utf-8'))).toEqual(info)
    } finally {
      warn.mockRestore()
    }
  })

  it('version 不是有限数（外部改过）→ 补回当前版本，installId / label 都保住、出一声', () => {
    const id = '11111111-2222-3333-4444-555555555555'
    writeFileSync(devicePath(), JSON.stringify({ version: '1', installId: id, clientLabel: 'my laptop' }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const info = ensureDeviceFile(dir, { hostname: () => 'ignored-host' })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(info).toEqual({ version: DEVICE_FILE_VERSION, installId: id, clientLabel: 'my laptop' })
      expect(JSON.parse(readFileSync(devicePath(), 'utf-8'))).toEqual(info)
    } finally {
      warn.mockRestore()
    }
  })

  it('★ 文件是垃圾（数组 / 连 JSON 都不是）→ 出声 + 全新 identity（绝不静默重建）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (const junk of ['[1,2,3]', '{ not json']) {
        // 每次都从「只有一份坏主文件」开始：不然坏主文件会先被 .bak 抢救，
        // 走的就不是本用例要测的那条分支了
        rmSync(devicePath(), { force: true })
        rmSync(devicePath() + '.bak', { force: true })
        writeFileSync(devicePath(), junk)

        const info = ensureDeviceFile(dir, { hostname: () => 'study-pc' })
        expect(isCanonicalUuid(info.installId), junk).toBe(true)
        expect(info.clientLabel).toBe('study-pc')
        expect(JSON.parse(readFileSync(devicePath(), 'utf-8'))).toEqual(info)
      }
      expect(warn).toHaveBeenCalledTimes(2)
    } finally {
      warn.mockRestore()
    }
  })

  it('未认识的有限 version（将来版本的文件）→ 原样返回、一个字节不写', () => {
    const future = { version: 2, installId: '11111111-2222-3333-4444-555555555555', clientLabel: 'my laptop' }
    writeFileSync(devicePath(), JSON.stringify(future))
    const bytes = readFileSync(devicePath())

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const info = ensureDeviceFile(dir, { hostname: () => 'ignored-host' })
      // 未来版本不是「坏文件」：降级安装不许把新版本文件打回去
      expect(warn).not.toHaveBeenCalled()
      expect(info).toEqual(future)
      expect(readFileSync(devicePath()).equals(bytes)).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })
})
