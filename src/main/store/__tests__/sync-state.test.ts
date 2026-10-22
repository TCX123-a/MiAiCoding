/**
 * .sync/state.json 的读 / 写 / 激活幂等（src/main/store/sync-state.ts）
 *
 * 【这个文件在守什么】
 *   1. **激活守卫不许被覆盖**。收编（客人档案 → 账号盒）的幂等完全押在
 *      `activatedAt` 上：守卫被打破的表现不是报错，而是某次重新登录把客人盒
 *      的数据又并一遍。「★ 连调两次」用例把「第二次调用一个字节都不写」钉死
 *      （内容不变 + 连 .bak 都没生成）。
 *   2. **读口能救的必须救**。磁盘上的坏条目（revision 是字符串、不认识的
 *      docType……）要逐条丢、汇总出声一次 —— 静默丢数据与整份拒收都不行。
 *   3. **写口不许糊**。形状不对必须抛，且抛之前一个字节都没写
 *      （「★ 形状不对 → 抛」用例）。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，字符串一律英文。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  SYNC_STATE_VERSION,
  emptySyncState,
  markActivated,
  readSyncState,
  writeSyncState,
  type SyncState
} from '../sync-state'
import { DOC_TYPES } from '../../../shared/cloud/protocol'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'miai-sync-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function statePath(): string {
  return join(dir, '.sync', 'state.json')
}

/** 直接往磁盘上摆一份原始内容（模拟外部改过 / 老版本），绕过写口 */
function writeRaw(content: string): void {
  mkdirSync(join(dir, '.sync'), { recursive: true })
  writeFileSync(statePath(), content, 'utf-8')
}

/** 跑一段会出声的代码，把 warn 收走 */
function silent<T>(fn: () => T): T {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    return fn()
  } finally {
    warn.mockRestore()
  }
}

describe('readSyncState：读口', () => {
  it('文件缺失 → emptySyncState（version 1 / activatedAt null），且读口不建文件', () => {
    const s = readSyncState(dir)
    expect(s).toEqual({ version: SYNC_STATE_VERSION, activatedAt: null, docs: {}, blocked: null, pendingPush: [] })
    expect(s.version).toBe(1)
    expect(s.activatedAt).toBeNull()
    // 读口不是修复口：它一个字节都不写（写盘是写口 / markActivated 的事）
    expect(existsSync(statePath())).toBe(false)
  })

  it('写读往返：整份形状原样回来（含 docs 两键、blocked、pendingPush）', () => {
    const state: SyncState = {
      version: SYNC_STATE_VERSION,
      activatedAt: '2026-10-10T08:00:00.000Z',
      docs: {
        profile: { revision: 4, hash: 'sha256:aa', syncedAt: '2026-10-10T08:00:01.000Z' },
        practice: { revision: 9, hash: 'sha256:bb', syncedAt: '2026-10-10T08:00:02.000Z' }
      },
      blocked: { code: 'DOC_VER_BLOCKED', message: 'server rejected base revision', at: '2026-10-10T08:00:03.000Z' },
      pendingPush: [
        { docType: 'favorites', at: '2026-10-10T08:00:04.000Z' },
        { docType: 'wrongbook', at: '2026-10-10T08:00:05.000Z' }
      ]
    }

    writeSyncState(dir, state)

    // json-store 的 mkdir recursive 生效：.sync 目录是自动建的
    expect(existsSync(statePath())).toBe(true)
    expect(readSyncState(dir)).toEqual(state)
  })

  it('坏文件（数组 / 连 JSON 都不是）→ empty + 不抛 + 出声', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      writeRaw('[1,2,3]')
      expect(readSyncState(dir)).toEqual(emptySyncState())

      // 坏 JSON：主文件读不出、又没 .bak 可救 → 出声，而不是静默当空
      writeRaw('{ not json at all')
      expect(readSyncState(dir)).toEqual(emptySyncState())

      expect(warn).toHaveBeenCalledTimes(2)
    } finally {
      warn.mockRestore()
    }
  })

  it('★ docs 里坏条目被丢（revision 是字符串 / key 不认识），合法的留下、出声汇总一次', () => {
    writeRaw(
      JSON.stringify({
        version: 1,
        activatedAt: null,
        docs: {
          profile: { revision: 3, hash: 'h3', syncedAt: 'T1' },
          practice: { revision: '3', hash: 'h-p', syncedAt: 'T2' },
          legacy: { revision: 1, hash: 'h-l', syncedAt: 'T3' }
        },
        blocked: null,
        pendingPush: []
      })
    )

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const s = readSyncState(dir)
      expect(s.docs).toEqual({ profile: { revision: 3, hash: 'h3', syncedAt: 'T1' } })
      expect('practice' in s.docs, 'revision 是字符串的条目必须丢').toBe(false)
      expect('legacy' in s.docs, '不认识的 key 必须丢').toBe(false)
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('★ 其余字段同一套清洗：activatedAt 非字符串归 null、blocked 缺字段丢、pendingPush 只留认得的', () => {
    // 负样本自检：'challenge' 必须始终不在 DOC_TYPES 里（protocol 只预留了 DB，
    // API 面没有它）。哪天它被登记了，这条用例的负样本就失效了，这里是刹车
    expect((DOC_TYPES as readonly string[]).includes('challenge')).toBe(false)

    writeRaw(
      JSON.stringify({
        version: 1,
        activatedAt: 42,
        docs: {},
        blocked: { code: 'DOC_VER_BLOCKED' }, // 缺 message / at → 整条丢
        pendingPush: [
          { docType: 'wrongbook', at: 'T1' }, // 留
          { docType: 'challenge', at: 'T2' }, // 不在 DOC_TYPES → 丢
          { docType: 'profile' } // 缺 at → 丢
        ]
      })
    )

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const s = readSyncState(dir)
      expect(s.activatedAt).toBeNull()
      expect(s.blocked).toBeNull()
      expect(s.pendingPush).toEqual([{ docType: 'wrongbook', at: 'T1' }])
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('writeSyncState：写口', () => {
  it('★ 形状不对 → 抛，且抛之前一个字节都没写', () => {
    const bad: unknown[] = [
      null,
      'nope',
      { ...emptySyncState(), activatedAt: 7 },
      { ...emptySyncState(), docs: [] },
      { ...emptySyncState(), docs: { profile: { revision: '3', hash: 'h', syncedAt: 'T' } } },
      { ...emptySyncState(), docs: { mystery: { revision: 1, hash: 'h', syncedAt: 'T' } } },
      { ...emptySyncState(), blocked: { code: 'X' } },
      { ...emptySyncState(), pendingPush: 'x' },
      { ...emptySyncState(), pendingPush: [{ docType: 'challenge', at: 'T' }] }
    ]
    for (const v of bad) {
      expect(() => writeSyncState(dir, v as SyncState), JSON.stringify(v)).toThrow()
    }
    expect(existsSync(statePath())).toBe(false)
  })

  it('version 无条件写 SYNC_STATE_VERSION：传 99 也按当前版本落盘、读回来也是当前版本', () => {
    writeSyncState(dir, { ...emptySyncState(), version: 99 })
    const onDisk: unknown = JSON.parse(readFileSync(statePath(), 'utf-8'))
    expect(onDisk).toMatchObject({ version: SYNC_STATE_VERSION })
    expect(readSyncState(dir).version).toBe(SYNC_STATE_VERSION)
  })
})

describe('markActivated：激活幂等守卫', () => {
  it('首次激活：写盘 + alreadyActive=false，activatedAt 是传进来的时刻', () => {
    const t1 = '2026-10-10T08:00:00.000Z'
    const first = markActivated(dir, t1)
    expect(first.alreadyActive).toBe(false)
    expect(first.state.activatedAt).toBe(t1)
    expect(existsSync(statePath())).toBe(true)
    expect(readSyncState(dir).activatedAt).toBe(t1)
  })

  it('★ 连调两次：第二次 alreadyActive=true，时刻还是第一次的，文件一个字节不动', () => {
    const t1 = '2026-10-10T08:00:00.000Z'
    const t2 = '2026-10-11T09:00:00.000Z'

    const first = markActivated(dir, t1)
    expect(first.alreadyActive).toBe(false)
    const bytes = readFileSync(statePath(), 'utf-8')

    const second = markActivated(dir, t2)

    expect(second.alreadyActive).toBe(true)
    // 首次激活时刻是永久事实：绝不被后来的时刻覆盖
    expect(second.state.activatedAt).toBe(t1)
    expect(readSyncState(dir).activatedAt).toBe(t1)
    // 文件内容逐字节不变；连 .bak 都没生成 = 真没写盘（重写会先备份一份）
    expect(readFileSync(statePath(), 'utf-8')).toBe(bytes)
    expect(existsSync(statePath() + '.bak')).toBe(false)
  })

  it('已激活的档上再激活：文件内容一个字节不变', () => {
    const t1 = '2026-10-10T08:00:00.000Z'
    markActivated(dir, t1)
    const bytes = readFileSync(statePath(), 'utf-8')

    markActivated(dir, '2026-10-12T00:00:00.000Z')

    expect(readFileSync(statePath(), 'utf-8')).toBe(bytes)
  })

  it('老档里 activatedAt 是坏值（数字）→ 读口归 null，于是走首次激活写新时刻', () => {
    writeRaw(JSON.stringify({ version: 1, activatedAt: 42, docs: {}, blocked: null, pendingPush: [] }))
    const t = '2026-10-10T08:00:00.000Z'
    const result = silent(() => markActivated(dir, t))
    expect(result.alreadyActive).toBe(false)
    expect(result.state.activatedAt).toBe(t)
    expect(readSyncState(dir).activatedAt).toBe(t)
  })

  it('坏时刻（空串）→ 写口校形抛出，一个字节都不写（调用方写错了要炸得响亮）', () => {
    expect(() => markActivated(dir, '')).toThrow()
    expect(existsSync(statePath())).toBe(false)
  })
})
