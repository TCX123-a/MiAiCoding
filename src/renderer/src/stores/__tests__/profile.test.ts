/**
 * 资料编辑（改用户名 / 换头像）在账号 store 里的行为（2026-10-22 用户系统批次）。
 *
 * 【这个文件在守什么】
 *   ① 成功路径：IPC 回话的 username/avatarHash 必须同时落到 store 与 state，
 *      并 bump profileVersion（排行榜靠它清快照重拉）；
 *   ② 失败路径：失败码进 lastFailure，本地值纹丝不动、profileVersion 不涨
 *      —— 否则界面会先把旧名字换成"看起来改了但没落库"的新名字；
 *   ③ 头像是字节 + 预览两条通道：字节原样交给主进程，预览图直接进头像缓存
 *      （本人立刻看到，不等 GET）；
 *   ④ pickAvatar 取消 = ok(null)，不是错误。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAccountStore } from '../account'
import { useAvatarStore } from '../avatar'
import type {
  Account,
  AvatarPickView,
  AvatarUploadResponse,
  CloudAccountState,
  CloudResult
} from '../../../../shared/cloud/dto'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const PREVIEW = 'data:image/png;base64,UFJFVklFVA=='

const signedInState = (patch: Partial<CloudAccountState> = {}): CloudAccountState => ({
  signedIn: true,
  accountId: 'acc-1',
  username: 'alice',
  avatarHash: null,
  activated: true,
  boxAccountId: 'acc-1',
  ...patch
})

const signedOut: CloudAccountState = {
  signedIn: false,
  accountId: null,
  username: null,
  avatarHash: null,
  activated: false,
  boxAccountId: null
}

function accountOf(username: string, avatarHash: string | null): Account {
  return { id: 'acc-1', username, avatarHash, createdAt: '2026-10-11T00:00:00.000Z' }
}

interface World {
  st: CloudAccountState
  updateRes: CloudResult<Account>
  uploadRes: CloudResult<AvatarUploadResponse>
  pickRes: CloudResult<AvatarPickView | null>
  sessionRes: CloudResult<{ account: Account; idleExpiresAt: string; absoluteExpiresAt: string } | null>
  updateCalls: string[]
  uploadCalls: Uint8Array[]
  pickCalls: number
}

function stubWorld(): World {
  const w: World = {
    st: signedInState(),
    updateRes: { ok: true, data: accountOf('alice2', null) },
    uploadRes: { ok: true, data: { hash: HASH_B } },
    pickRes: { ok: true, data: null },
    sessionRes: {
      ok: true,
      data: {
        account: accountOf('alice', null),
        idleExpiresAt: '2026-11-10T00:00:00.000Z',
        absoluteExpiresAt: '2027-04-09T00:00:00.000Z'
      }
    },
    updateCalls: [],
    uploadCalls: [],
    pickCalls: 0
  }
  ;(globalThis as unknown as { window: unknown }).window = {
    miai: {
      cloud: {
        state: async (): Promise<CloudAccountState> => structuredClone(w.st),
        updateUsername: async (name: string): Promise<CloudResult<Account>> => {
          w.updateCalls.push(name)
          return structuredClone(w.updateRes)
        },
        uploadAvatar: async (png: Uint8Array): Promise<CloudResult<AvatarUploadResponse>> => {
          // 抄一份：判据要看「原样传过去」，不是同一引用被后改
          w.uploadCalls.push(Uint8Array.from(png))
          return structuredClone(w.uploadRes)
        },
        pickAvatar: async (): Promise<CloudResult<AvatarPickView | null>> => {
          w.pickCalls += 1
          return structuredClone(w.pickRes)
        },
        session: async () => structuredClone(w.sessionRes)
      }
    }
  }
  return w
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(async () => {
  // 等失败的微信任务落干净，别漏到下一个测试
  await settle()
})

describe('账号 store：refresh / probeSession 的资料同步', () => {
  it('refresh：登录态同步 username + avatarHash；登出态清空（不挂上一个人的资料）', async () => {
    const w = stubWorld()
    const a = useAccountStore()

    w.st = signedInState({ username: '大肥鱼学徒', avatarHash: HASH_A })
    await a.refresh()
    expect(a.username).toBe('大肥鱼学徒')
    expect(a.avatarHash).toBe(HASH_A)

    w.st = { ...signedOut }
    await a.refresh()
    expect(a.username).toBe(null)
    expect(a.avatarHash).toBe(null)
  })

  it('probeSession 成功：用户名与头像一起补进 store 与 state', async () => {
    const w = stubWorld()
    w.sessionRes = {
      ok: true,
      data: {
        account: accountOf('probed', HASH_B),
        idleExpiresAt: '2026-11-10T00:00:00.000Z',
        absoluteExpiresAt: '2027-04-09T00:00:00.000Z'
      }
    }
    const a = useAccountStore()
    await a.refresh()
    await a.probeSession()
    expect(a.username).toBe('probed')
    expect(a.avatarHash).toBe(HASH_B)
    expect(a.state?.username).toBe('probed')
    expect(a.state?.avatarHash).toBe(HASH_B)
  })

  it('probeSession 失败：静默（lastFailure 是动作的，不是探测的）', async () => {
    const w = stubWorld()
    w.sessionRes = {
      ok: false,
      failure: { code: 'NETWORK', message: 'down', httpStatus: null }
    }
    const a = useAccountStore()
    await a.refresh()
    const before = { username: a.username, avatarHash: a.avatarHash }
    await a.probeSession()
    expect(a.lastFailure).toBe(null)
    expect({ username: a.username, avatarHash: a.avatarHash }).toEqual(before)
  })

  it('probeSession 迟到的旧回话：期间改名/换头像成功 → 旧值一律丢弃（2026-10-22 夜间自查）', async () => {
    const w = stubWorld()
    const a = useAccountStore()
    await a.refresh()

    // 探测像弱网一样卡住：先把回话扣在手里
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    ;(window as unknown as { miai: { cloud: { session: () => Promise<unknown> } } }).miai.cloud.session =
      async () => {
        await gate
        return {
          ok: true,
          data: {
            account: accountOf('探测到的旧名字', HASH_A),
            idleExpiresAt: '2026-11-10T00:00:00.000Z',
            absoluteExpiresAt: '2027-04-09T00:00:00.000Z'
          }
        }
      }
    const probing = a.probeSession()

    // 用户在探测回来之前改了名 + 换了头像
    w.updateRes = { ok: true, data: accountOf('新名字', HASH_B) }
    await a.updateUsername('新名字')
    const version = a.profileVersion

    release()
    await probing
    expect(a.username).toBe('新名字')
    expect(a.avatarHash).toBe(HASH_B)
    expect(a.state?.username).toBe('新名字')
    expect(a.state?.avatarHash).toBe(HASH_B)
    expect(a.profileVersion).toBe(version)
  })
})

describe('账号 store：改用户名', () => {
  it('成功：参数原样、state 同刷、busy 释放、profileVersion 自增', async () => {
    const w = stubWorld()
    w.updateRes = { ok: true, data: accountOf('大肥鱼学徒', HASH_A) }
    const a = useAccountStore()
    await a.refresh()
    const beforeVersion = a.profileVersion

    const res = await a.updateUsername('大肥鱼学徒')
    expect(res.ok).toBe(true)
    expect(w.updateCalls).toEqual(['大肥鱼学徒'])
    expect(a.username).toBe('大肥鱼学徒')
    expect(a.avatarHash).toBe(HASH_A)
    expect(a.state?.username).toBe('大肥鱼学徒')
    expect(a.state?.avatarHash).toBe(HASH_A)
    expect(a.profileVersion).toBe(beforeVersion + 1)
    expect(a.busy).toBe(null)
    expect(a.lastFailure).toBe(null)
  })

  it('失败（USERNAME_TAKEN）：lastFailure 记码、三个值全部不动、profileVersion 不涨', async () => {
    const w = stubWorld()
    w.updateRes = {
      ok: false,
      failure: { code: 'USERNAME_TAKEN', message: 'taken', httpStatus: 409 }
    }
    const a = useAccountStore()
    await a.refresh()
    const before = {
      username: a.username,
      avatarHash: a.avatarHash,
      stateUser: a.state?.username,
      version: a.profileVersion
    }

    const res = await a.updateUsername('alice')
    expect(res.ok).toBe(false)
    expect(a.lastFailure?.code).toBe('USERNAME_TAKEN')
    expect(a.username).toBe(before.username)
    expect(a.avatarHash).toBe(before.avatarHash)
    expect(a.state?.username).toBe(before.stateUser)
    expect(a.profileVersion).toBe(before.version)
    expect(a.busy).toBe(null) // 失败也要释放 busy，按钮不能永久禁用
  })

  it('成功后再失败：lastFailure 不会把上一次的成功状态又擦掉', async () => {
    const w = stubWorld()
    w.updateRes = { ok: true, data: accountOf('alice2', null) }
    const a = useAccountStore()
    await a.refresh()
    await a.updateUsername('alice2')

    w.updateRes = {
      ok: false,
      failure: { code: 'USERNAME_FORBIDDEN', message: 'forbidden', httpStatus: 400 }
    }
    await a.updateUsername('傻逼')
    expect(a.username).toBe('alice2')
    expect(a.lastFailure?.code).toBe('USERNAME_FORBIDDEN')
  })
})

describe('账号 store：换头像', () => {
  it('成功：字节原样交给主进程；hash/state/缓存/版本一起更新', async () => {
    const w = stubWorld()
    w.uploadRes = { ok: true, data: { hash: HASH_B } }
    const a = useAccountStore()
    await a.refresh()
    const beforeVersion = a.profileVersion
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

    const res = await a.uploadAvatar(png, PREVIEW)
    expect(res.ok).toBe(true)
    expect(w.uploadCalls).toHaveLength(1)
    expect(Buffer.from(w.uploadCalls[0]).equals(Buffer.from(png))).toBe(true)
    expect(a.avatarHash).toBe(HASH_B)
    expect(a.state?.avatarHash).toBe(HASH_B)
    expect(a.profileVersion).toBe(beforeVersion + 1)
    expect(a.busy).toBe(null)
    // 本人立刻看到新图：预览进了缓存，不会再发 GET
    expect(useAvatarStore().srcOf(HASH_B)).toBe(PREVIEW)
  })

  it('失败：hash 与 state 不动、profileVersion 不涨、缓存也不许种进失败图', async () => {
    const w = stubWorld()
    w.uploadRes = {
      ok: false,
      failure: { code: 'PAYLOAD_TOO_LARGE', message: 'too big', httpStatus: 413 }
    }
    const a = useAccountStore()
    await a.refresh()
    const before = { hash: a.avatarHash, version: a.profileVersion }

    const res = await a.uploadAvatar(Uint8Array.from([1, 2, 3]), PREVIEW)
    expect(res.ok).toBe(false)
    expect(a.lastFailure?.code).toBe('PAYLOAD_TOO_LARGE')
    expect(a.avatarHash).toBe(before.hash)
    expect(a.profileVersion).toBe(before.version)
    expect(a.busy).toBe(null)
    expect(useAvatarStore().srcOf(HASH_B)).toBe(null)
  })

  it('不给预览图：只更新 hash，不往缓存里写（下次由 GET 补）', async () => {
    const w = stubWorld()
    w.uploadRes = { ok: true, data: { hash: HASH_B } }
    const a = useAccountStore()
    await a.refresh()
    expect((await a.uploadAvatar(Uint8Array.from([1]))).ok).toBe(true)
    expect(a.avatarHash).toBe(HASH_B)
    expect(useAvatarStore().srcOf(HASH_B)).toBe(null)
  })
})

describe('账号 store：选图对话框', () => {
  it('取消 = ok(null) 原样透传（不是错误，也不改任何状态）', async () => {
    const w = stubWorld()
    w.pickRes = { ok: true, data: null }
    const a = useAccountStore()
    await a.refresh()
    const res = await a.pickAvatar()
    expect(res).toEqual({ ok: true, data: null })
    expect(w.pickCalls).toBe(1)
    expect(a.lastFailure).toBe(null)
    expect(a.busy).toBe(null) // 选图不占动作 busy（对话框自己转）
  })

  it('校验失败按 CloudResult 透传（界面按 code 出文案）', async () => {
    const w = stubWorld()
    w.pickRes = {
      ok: false,
      failure: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'not an image', httpStatus: 415 }
    }
    const a = useAccountStore()
    const res = await a.pickAvatar()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.failure.code).toBe('UNSUPPORTED_MEDIA_TYPE')
  })
})
