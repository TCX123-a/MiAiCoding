/**
 * 头像缓存 store（renderer/stores/avatar.ts，2026-10-22 用户系统批次）单测。
 *
 * 【这个文件在守什么】
 *   ① 合批 + 去重：同一帧里 N 个组件要同一个 hash，只发一个 IPC；
 *   ② 失败即降级：IPC 抛 / 返回空 / 返回非 data URL，都不许把界面炸掉，
 *      也不许把「没取到」记成「取到了」；
 *   ③ 重试窗口：失败 60s 后 bump tick，组件据此重新请求（断网恢复后头像自己回来）；
 *   ④ remember：本人刚上传的图立刻可见，且不会再发一次 GET。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAvatarStore } from '../avatar'

const H1 = 'a'.repeat(64)
const H2 = 'b'.repeat(64)
const H3 = 'c'.repeat(64)
const DATA1 = 'data:image/png;base64,AAAA'
const DATA2 = 'data:image/png;base64,BBBB'

interface World {
  calls: string[][]
  handler: (
    hashes: string[],
    n: number
  ) => Promise<{ images: Record<string, string>; dead: string[] }>
}

function stubWorld(): World {
  const w: World = {
    calls: [],
    handler: async (hashes) => ({
      images: Object.fromEntries(hashes.map((h) => [h, DATA1])),
      dead: []
    })
  }
  ;(globalThis as unknown as { window: unknown }).window = {
    miai: {
      cloud: {
        getAvatars: async (
          hashes: string[]
        ): Promise<{ images: Record<string, string>; dead: string[] }> => {
          const n = w.calls.length
          w.calls.push([...hashes])
          return w.handler(hashes, n)
        }
      }
    }
  }
  return w
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('avatar store：合批与缓存', () => {
  it('同帧多次请求同一个 hash 只发一个包；取到后 srcOf 命中，再请求不再发', async () => {
    const w = stubWorld()
    const avatars = useAvatarStore()

    avatars.request([H1, H1, null, undefined, 'not-a-hash'])
    avatars.request([H1])
    expect(w.calls).toHaveLength(0) // 16ms 合批窗口内还没发
    await vi.advanceTimersByTimeAsync(16)

    expect(w.calls).toEqual([[H1]])
    expect(avatars.srcOf(H1)).toBe(DATA1)
    expect(avatars.srcOf(null)).toBe(null)
    expect(avatars.srcOf(H2)).toBe(null)

    avatars.request([H1])
    await vi.advanceTimersByTimeAsync(16)
    expect(w.calls).toHaveLength(1)
  })

  it('一帧内的不同 hash 合成一批（不是逐个发）', async () => {
    const w = stubWorld()
    w.handler = async (hashes) => ({
      images: Object.fromEntries(hashes.map((h) => [h, h === H1 ? DATA1 : DATA2])),
      dead: []
    })
    const avatars = useAvatarStore()

    avatars.request([H1])
    avatars.request([H2])
    await vi.advanceTimersByTimeAsync(16)

    expect(w.calls).toHaveLength(1)
    expect(new Set(w.calls[0])).toEqual(new Set([H1, H2]))
    expect(avatars.srcOf(H1)).toBe(DATA1)
    expect(avatars.srcOf(H2)).toBe(DATA2)
  })

  it('remember：立刻可显示、并挡住后续请求', async () => {
    const w = stubWorld()
    const avatars = useAvatarStore()
    avatars.remember(H1, DATA1)
    expect(avatars.srcOf(H1)).toBe(DATA1)

    avatars.request([H1])
    await vi.advanceTimersByTimeAsync(16)
    expect(w.calls).toHaveLength(0)
  })

  it('hash 形状非法：remember 不收（内容寻址的键必须是 64 位 hex）', () => {
    stubWorld()
    const avatars = useAvatarStore()
    avatars.remember('not-a-hash', DATA1)
    expect(avatars.srcOf('not-a-hash')).toBe(null)
  })
})

describe('avatar store：失败降级与重试', () => {
  it('一批里缺的 hash 不报错：保留默认头像，并且 60s 后 tick 自增允许重试', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const w = stubWorld()
      w.handler = async (hashes, n) =>
        n === 0
          ? { images: { [H1]: DATA1 }, dead: [] }
          : { images: Object.fromEntries(hashes.map((h) => [h, DATA2])), dead: [] }
      const avatars = useAvatarStore()
      const before = avatars.tick

      avatars.request([H1, H2])
      await vi.advanceTimersByTimeAsync(16)
      expect(avatars.srcOf(H1)).toBe(DATA1)
      expect(avatars.srcOf(H2)).toBe(null) // 缺图 = 默认头像，不是错误
      expect(avatars.tick).toBe(before)
      expect(warn).not.toHaveBeenCalled()

      // 重试窗口未到：再请求也不发包
      avatars.request([H2])
      await vi.advanceTimersByTimeAsync(16)
      expect(w.calls).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(60_000)
      expect(avatars.tick).toBe(before + 1) // 组件 watchEffect 读到它 → 重新 request

      avatars.request([H2])
      await vi.advanceTimersByTimeAsync(16)
      expect(w.calls).toHaveLength(2)
      expect(avatars.srcOf(H2)).toBe(DATA2)
    } finally {
      warn.mockRestore()
    }
  })

  it('retryNow：登录成功后立刻放行 missing（不必等 60s 窗口）', async () => {
    const w = stubWorld()
    w.handler = async (hashes, n) =>
      n === 0 ? { images: {}, dead: [] } : { images: Object.fromEntries(hashes.map((h) => [h, DATA1])), dead: [] }
    const avatars = useAvatarStore()
    const before = avatars.tick

    avatars.request([H1])
    await vi.advanceTimersByTimeAsync(16)
    expect(avatars.srcOf(H1)).toBe(null)
    // 窗口未到：再请求也不发
    avatars.request([H1])
    await vi.advanceTimersByTimeAsync(16)
    expect(w.calls).toHaveLength(1)

    avatars.retryNow()
    expect(avatars.tick).toBe(before + 1)
    avatars.request([H1])
    await vi.advanceTimersByTimeAsync(16)
    expect(w.calls).toHaveLength(2)
    expect(avatars.srcOf(H1)).toBe(DATA1)
  })

  it('IPC 抛异常：当作整批没拿到（控制台留证），不抛给界面，随后仍可重试', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const w = stubWorld()
      w.handler = async () => {
        throw new Error('ipc exploded')
      }
      const avatars = useAvatarStore()
      avatars.request([H1])
      await vi.advanceTimersByTimeAsync(16)
      expect(avatars.srcOf(H1)).toBe(null)
      expect(warn).toHaveBeenCalled()

      w.handler = async (hashes) => ({
        images: Object.fromEntries(hashes.map((h) => [h, DATA1])),
        dead: []
      })
      await vi.advanceTimersByTimeAsync(60_000)
      avatars.request([H1])
      await vi.advanceTimersByTimeAsync(16)
      expect(avatars.srcOf(H1)).toBe(DATA1)
    } finally {
      warn.mockRestore()
    }
  })

  it('主进程回了怪值（非 data URL / 非字符串）：不许记成成功', async () => {
    const w = stubWorld()
    w.handler = async () => ({ images: { [H1]: 'http://evil.example/x.png' }, dead: [] })
    const avatars = useAvatarStore()
    avatars.request([H1])
    await vi.advanceTimersByTimeAsync(16)
    expect(avatars.srcOf(H1)).toBe(null)
  })

  it('服务端确认永久不存在（dead）：记死、不挂重试、60s 后也不再打（2026-10-22 夜间自查）', async () => {
    const w = stubWorld()
    w.handler = async () => ({ images: {}, dead: [H1, H2] })
    const avatars = useAvatarStore()

    avatars.request([H1, H2])
    await vi.advanceTimersByTimeAsync(16)
    expect(w.calls).toEqual([[H1, H2]])
    expect(avatars.srcOf(H1)).toBe(null) // 仍显示默认大肥鱼

    // 重试窗口到点：tick 仍会自增（那是给别的可重试 hash 的），但 dead 不再发
    await vi.advanceTimersByTimeAsync(60_000)
    avatars.request([H1, H2])
    await vi.advanceTimersByTimeAsync(16)
    expect(w.calls).toHaveLength(1)
  })
})
