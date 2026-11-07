import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * scheme 特权的登记形状（P0 壁纸沙盒逃逸的回归钉子）。
 *
 * 钉的是 Electron 的一条静默规则：`registerSchemesAsPrivileged` 第二次调用会
 * **整表替换**第一次 —— 先登记的 scheme 失去 fetch 能力，而 <img>/<video>
 * 照常显示，症状只表现为「场景 pkg 加载失败」（2026-10-31 在真应用里踩过，
 * 最小复现见 <workspace>\_scheme-order-probe）。所以这里只允许一次调用、两个 scheme。
 */

const h = vi.hoisted(() => ({ lists: [] as unknown[][] }))

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: (list: unknown[]) => {
      h.lists.push(list)
    },
  },
}))

beforeEach(() => {
  h.lists.length = 0
  vi.resetModules()
})

interface Entry {
  scheme: string
  privileges?: Record<string, boolean>
}

describe('registerWallpaperSchemes', () => {
  it('miai-wall 与 miai-scene 在同一次调用里登记，且五项特权齐全', async () => {
    const { registerWallpaperSchemes } = await import('../scheme-privileges')
    registerWallpaperSchemes()
    expect(h.lists).toHaveLength(1)
    const list = h.lists[0] as Entry[]
    expect(list.map((s) => s.scheme).sort()).toEqual(['miai-scene', 'miai-wall'])
    for (const s of list) {
      expect(s.privileges).toMatchObject({
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      })
    }
  })

  it('第二次调用直接抛错（不许静默整表替换）', async () => {
    const { registerWallpaperSchemes } = await import('../scheme-privileges')
    registerWallpaperSchemes()
    expect(() => registerWallpaperSchemes()).toThrow(/already registered/)
    expect(h.lists).toHaveLength(1)
  })
})
