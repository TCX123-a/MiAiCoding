import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createStores } from '../stores'
import { StaleEpochError, StaleRevError } from '../box'
import { attemptDocWrite } from '../doc-write'
import type { UserProfile } from '../../../shared/types'

let dir: string

/** 盘面数据的替身：这些用例只关心"哪一份字节在盘上"，不关心档案的真实形状 */
function doc(v: string): UserProfile {
  return { v } as unknown as UserProfile
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'miai-docwrite-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('条件写执行器（attemptDocWrite）', () => {
  it('成功：写发生一次，回话带上写后的新戳', () => {
    const write = vi.fn()
    const res = attemptDocWrite<string>({
      write,
      readCurrent: () => 'never',
      stamp: () => ({ epoch: 0, rev: 7 })
    })
    expect(write).toHaveBeenCalledTimes(1)
    expect(res).toEqual({ ok: true, stamp: { epoch: 0, rev: 7 } })
  })

  it('StaleRevError → STALE_REV + 回读的最新数据 + 现戳（不抛）', () => {
    const readCurrent = vi.fn(() => 'disk-latest')
    const res = attemptDocWrite<string>({
      write: () => {
        throw new StaleRevError(2, 5)
      },
      readCurrent,
      stamp: () => ({ epoch: 0, rev: 5 })
    })
    expect(readCurrent).toHaveBeenCalledTimes(1)
    expect(res).toEqual({ ok: false, code: 'STALE_REV', current: 'disk-latest', stamp: { epoch: 0, rev: 5 } })
  })

  it('StaleEpochError → STALE_EPOCH（与 STALE_REV 分得开）', () => {
    const res = attemptDocWrite<string>({
      write: () => {
        throw new StaleEpochError(1, 2)
      },
      readCurrent: () => 'new-box',
      stamp: () => ({ epoch: 2, rev: 0 })
    })
    expect(res).toEqual({ ok: false, code: 'STALE_EPOCH', current: 'new-box', stamp: { epoch: 2, rev: 0 } })
  })

  it('别的错误一律原样抛 —— 磁盘写不进去不是冲突（不许吞）', () => {
    const readCurrent = vi.fn(() => 'never')
    expect(() =>
      attemptDocWrite<string>({
        write: () => {
          throw new Error('disk full')
        },
        readCurrent,
        stamp: () => ({ epoch: 0, rev: 0 })
      })
    ).toThrow('disk full')
    // 关键：IO 错误**不许**走到回读那一步 —— 变成冲突的话调用方会重载重放，
    // 再把同一个 IO 错误撞一遍，日志里一句真话都没有
    expect(readCurrent).not.toHaveBeenCalled()
  })

  it('（真存储）旧戳写被拒：盘上字节不变、回读的是新数据、新戳续得上', () => {
    const stores = createStores(dir)
    const s0 = stores.profile.stamp()
    expect(s0).toEqual({ epoch: 0, rev: 0 })

    // 第一次带戳写：ok，戳推进到 rev 1
    const ok = attemptDocWrite({
      write: () => stores.profile.write(doc('A'), s0),
      readCurrent: () => stores.profile.read(),
      stamp: () => stores.profile.stamp()
    })
    expect(ok).toEqual({ ok: true, stamp: { epoch: 0, rev: 1 } })

    // 盘面被"别的写口"（这里是裸写，模拟主进程 RMW）推进一步
    stores.profile.write(doc('B'))

    // 拿着 s0（旧戳）再写：拒，盘上仍是 B
    const stale = attemptDocWrite({
      write: () => stores.profile.write(doc('C'), s0),
      readCurrent: () => stores.profile.read(),
      stamp: () => stores.profile.stamp()
    })
    expect(stale.ok).toBe(false)
    if (stale.ok) throw new Error('unreachable')
    expect(stale.code).toBe('STALE_REV')
    expect(stale.current).toEqual({ v: 'B' })
    const onDisk = JSON.parse(readFileSync(join(dir, 'profile.json'), 'utf-8'))
    expect(onDisk).toEqual({ v: 'B' })

    // 用回话里的新戳续写：通
    const again = attemptDocWrite({
      write: () => stores.profile.write(doc('C'), stale.stamp),
      readCurrent: () => stores.profile.read(),
      stamp: () => stores.profile.stamp()
    })
    expect(again.ok).toBe(true)
  })

  it('（真存储）切盒后旧 epoch 写被拒：新盒一个字节不沾', () => {
    const stores = createStores(dir)
    const s0 = stores.profile.stamp()
    stores.profile.write(doc('guest'))

    stores.box.switchTo('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')

    const res = attemptDocWrite({
      write: () => stores.profile.write(doc('late'), s0),
      readCurrent: () => stores.profile.read(),
      stamp: () => stores.profile.stamp()
    })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.code).toBe('STALE_EPOCH')
    // 新盒里那份还没被创建（回读为 null = 什么都没写）
    expect(res.current).toBeNull()
    // 客人盒里的旧数据原样
    const guest = JSON.parse(readFileSync(join(dir, 'profile.json'), 'utf-8'))
    expect(guest).toEqual({ v: 'guest' })
  })
})
