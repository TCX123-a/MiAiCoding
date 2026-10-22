/**
 * 云账号 store（stores/account.ts）的单测（P10.6）。
 *
 * 【这个文件在守什么】
 *   ① **干涸顺序**：登出/激活会切盒换 epoch，切盒后旧戳的写会被屏障拒掉 ——
 *      所以「flush 本地写」必须发生在「登出/激活 IPC」**之前**。这条判据的
 *      种坏方式=把 quiesce() 从动作里删掉，顺序数组里 saveProfile 直接缺席。
 *   ② 失败即值：登录/激活失败留在 lastFailure 里、状态纹丝不动；
 *      busy 单槽在飞时占用、落地即释放。
 *
 * 【假 window 的纪律同 progress.test.ts】structuredClone 收件、戳用单调 rev。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAccountStore } from '../account'
import { useFavoritesStore } from '../favorites'
import { useProgressStore } from '../progress'
import { toasts } from '../../components/base/toast'
import { ACCOUNT } from '../../lib/copy'
import {
  CURRENT_FAVORITES_VERSION,
  type FavoritesFile,
  type UserProfile
} from '../../../../shared/types'
import type {
  CloudAccountState,
  CloudAuthView,
  CloudResult,
  CloudActivateView,
  RecoverQuestionResponse,
  RecoverResetResponse,
  RecoverVerifyResponse
} from '../../../../shared/cloud/dto'
import type { BoxStamp, DocWriteResult, StampedDoc } from '../../../../shared/doc-write'

const stamp = (rev: number): BoxStamp => ({ epoch: 0, rev })

function authView(username: string): CloudAuthView {
  return {
    expiresAt: '2026-11-10T00:00:00.000Z',
    absoluteExpiresAt: '2027-04-09T00:00:00.000Z',
    account: { id: 'acc-1', username, avatarHash: null, createdAt: '2026-10-11T00:00:00.000Z' }
  }
}

const signedOut: CloudAccountState = {
  signedIn: false,
  accountId: null,
  username: null,
  avatarHash: null,
  activated: false,
  boxAccountId: null
}

function stateOf(patch: Partial<CloudAccountState>): CloudAccountState {
  return { ...signedOut, ...patch }
}

interface World {
  order: string[]
  /** 直接改它 = 模拟主进程侧状态变化，然后调 account.refresh() */
  st: CloudAccountState
  loginRes: CloudResult<CloudAuthView>
  /**
   * 登录成功后 state() 该读到什么（缺省 = 新登录的未激活账号）。
   * 「已激活账号重登」的用例靠它把 activated=true 装进回话时序里 ——
   * 2026-10-17 夜间批：重登直达的判据要从这里长出来。
   */
  loginState: Partial<CloudAccountState> | null
  activateRes: CloudResult<CloudActivateView>
  /** 非 null 时 login 悬在这里（测 busy 在飞态用） */
  loginGate: Promise<void> | null
  /** 找回三步链（2026-10-13）：假实现收到的每次调用（函数名 + 原样参数） */
  recoverCalls: { fn: 'question' | 'verify' | 'reset'; arg: unknown }[]
  recoverQuestionRes: CloudResult<RecoverQuestionResponse>
  recoverVerifyRes: CloudResult<RecoverVerifyResponse>
  recoverResetRes: CloudResult<RecoverResetResponse>
}

function stubWorld(): World {
  const w: World = {
    order: [],
    st: { ...signedOut },
    loginRes: { ok: true, data: authView('alice') },
    loginState: null,
    activateRes: { ok: true, data: { outcome: 'adopted', adopt: 'merge-local', accountId: 'acc-1' } },
    loginGate: null,
    recoverCalls: [],
    recoverQuestionRes: { ok: true, data: { question: '你的第一只宠物叫什么？' } },
    recoverVerifyRes: { ok: true, data: { verified: true } },
    recoverResetRes: { ok: true, data: { ok: true } }
  }
  const listeners: Record<string, (() => void)[]> = {}
  const emptyFav = (): FavoritesFile => ({
    version: CURRENT_FAVORITES_VERSION,
    folders: [],
    items: []
  })

  ;(globalThis as unknown as { window: unknown }).window = {
    addEventListener: (type: string, fn: () => void) => {
      ;(listeners[type] ??= []).push(fn)
    },
    removeEventListener: () => {},
    miai: {
      // 文档读写（progress/favorites 建店就要用；内容不重要，形状要对）
      getProfile: (): Promise<StampedDoc<UserProfile | null>> =>
        Promise.resolve({ data: null, stamp: stamp(0) }),
      saveProfile: (_p: UserProfile, _s?: BoxStamp | null): Promise<DocWriteResult<UserProfile | null>> => {
        w.order.push('saveProfile')
        return Promise.resolve({ ok: true, stamp: stamp(1) })
      },
      getFavorites: (): Promise<StampedDoc<FavoritesFile>> =>
        Promise.resolve({ data: emptyFav(), stamp: stamp(0) }),
      saveFavorites: (_f: FavoritesFile, _s?: BoxStamp | null): Promise<DocWriteResult<FavoritesFile>> => {
        w.order.push('saveFavorites')
        return Promise.resolve({ ok: true, stamp: stamp(1) })
      },
      cloud: {
        state: async (): Promise<CloudAccountState> => structuredClone(w.st),
        login: async (): Promise<CloudResult<CloudAuthView>> => {
          w.order.push('login')
          if (w.loginGate) await w.loginGate
          // 真主进程在回话**之前**就把令牌收进 TokenStore 了 —— 所以登录
          // 成功后的 state() 必须已经翻成"已登录"（照抄这个时序，不照抄的话
          // refresh 会把 username 又清掉，测试会指向一个不存在的 bug）
          if (w.loginRes.ok) {
            // loginState 给「已激活账号重登」用（activated:true 但盒还停客人位
            // —— 2026-10-17 夜间批的原始现场）；缺省 = 新登录的未激活账号
            w.st = stateOf(
              w.loginState ?? {
                signedIn: true,
                accountId: w.loginRes.data.account.id,
                activated: false,
                boxAccountId: null
              }
            )
          }
          return structuredClone(w.loginRes)
        },
        register: async (): Promise<CloudResult<CloudAuthView>> => structuredClone(w.loginRes),
        // 找回三步链（2026-10-13）：记下每次调用的函数名与**原样参数**，
        // 判据里的「参数不许被 store 动过」就靠它
        recoverQuestion: async (arg: unknown): Promise<CloudResult<RecoverQuestionResponse>> => {
          w.recoverCalls.push({ fn: 'question', arg })
          return structuredClone(w.recoverQuestionRes)
        },
        recoverVerify: async (arg: unknown): Promise<CloudResult<RecoverVerifyResponse>> => {
          w.recoverCalls.push({ fn: 'verify', arg })
          return structuredClone(w.recoverVerifyRes)
        },
        recoverReset: async (arg: unknown): Promise<CloudResult<RecoverResetResponse>> => {
          w.recoverCalls.push({ fn: 'reset', arg })
          return structuredClone(w.recoverResetRes)
        },
        logout: async (): Promise<CloudResult<null>> => {
          w.order.push('logout')
          return { ok: true, data: null }
        },
        // V1-62：仅本机退出 —— 零网络、恒成功；真主进程会丢令牌 + 回客人盒，
        // 所以回话前 state() 已翻成未登录（照抄时序，同 login 的注解）
        logoutLocal: async (): Promise<CloudResult<null>> => {
          w.order.push('logoutLocal')
          w.st = { ...signedOut }
          return { ok: true, data: null }
        },
        activate: async (): Promise<CloudResult<CloudActivateView>> => {
          w.order.push('activate')
          // 成功 = 主进程 switchTo(accountId) + 装账本已生效（回话前盒子已切到
          // 账号位）；失败 = 盒子纹丝不动 —— 这是「激活失败状态原样」用例的桩面
          if (w.activateRes.ok) {
            w.st = stateOf({
              signedIn: true,
              accountId: w.activateRes.data.accountId,
              activated: true,
              boxAccountId: w.activateRes.data.accountId
            })
          }
          return structuredClone(w.activateRes)
        },
        activatePreview: async () => ({ ok: true as const, data: { cloudEmpty: true } }),
        session: async () => ({
          ok: true as const,
          data: {
            account: { id: 'acc-1', username: 'alice', createdAt: '2026-10-11T00:00:00.000Z' },
            idleExpiresAt: '2026-11-10T00:00:00.000Z',
            absoluteExpiresAt: '2027-04-09T00:00:00.000Z'
          }
        })
      }
    }
  }
  return w
}

/** 让出若干轮微任务 + 一个宏任务（load、watch、写协议链都在这些上面跑） */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(async () => {
  // 文档 store 的防抖定时器要冲干，免得活到下一个测试里去（同 progress.test.ts）
  await settle()
  try {
    useProgressStore().flush()
    useFavoritesStore().flush()
  } catch {
    /* 这个测试没建过这两个店 */
  }
})

describe('账号状态与动作（P10.6）', () => {
  it('refresh 读到状态：三个派生量各自正确', async () => {
    const w = stubWorld()
    const a = useAccountStore()

    w.st = stateOf({ signedIn: true, accountId: 'acc-1', activated: false, boxAccountId: null })
    await a.refresh()
    expect(a.signedIn).toBe(true)
    expect(a.activated).toBe(false)
    // 登录了没激活 = 正常中间态（界面该引导收编）
    expect(a.needsActivation).toBe(true)

    w.st = stateOf({ signedIn: true, accountId: 'acc-1', activated: true, boxAccountId: 'acc-1' })
    await a.refresh()
    expect(a.needsActivation).toBe(false)
  })

  it('登录成功：记用户名、清失败、刷新状态；未登录刷新时用户名清掉', async () => {
    const w = stubWorld()
    const a = useAccountStore()

    const res = await a.login({ username: 'alice', password: 'x'.repeat(12) })
    expect(res.ok).toBe(true)
    expect(a.username).toBe('alice')
    expect(a.lastFailure).toBeNull()
    expect(a.state?.signedIn).toBe(true) // 登录成功后的 refresh 读到的是已登录

    // 登出态的刷新会把残留用户名清掉（不挂上一个不认识的名字）
    w.st = { ...signedOut }
    await a.refresh()
    expect(a.username).toBeNull()
  })

  it('登录失败：失败进 lastFailure、用户名与状态都不动', async () => {
    const w = stubWorld()
    w.loginRes = {
      ok: false,
      failure: { code: 'BAD_CREDENTIALS', message: 'bad credentials', httpStatus: 401 }
    }
    const a = useAccountStore()

    const res = await a.login({ username: 'alice', password: 'wrong' })
    expect(res.ok).toBe(false)
    expect(a.lastFailure?.code).toBe('BAD_CREDENTIALS')
    expect(a.username).toBeNull()
  })

  it('busy 单槽：在飞时占着、落地即释放（失败也一样释放）', async () => {
    const w = stubWorld()
    const a = useAccountStore()
    let release!: () => void
    w.loginGate = new Promise<void>((r) => {
      release = r
    })

    const p = a.login({ username: 'alice', password: 'x'.repeat(12) })
    await settle()
    expect(a.busy).toBe('login')
    release()
    await p
    expect(a.busy).toBeNull()

    w.loginRes = {
      ok: false,
      failure: { code: 'NETWORK', message: 'offline', httpStatus: null }
    }
    await a.login({ username: 'alice', password: 'x'.repeat(12) })
    expect(a.busy).toBeNull()
  })

  /*
   * 重登直达（2026-10-17 夜间批）。原始现场：已激活账号登出后重新登录，
   * 主进程 login 只存令牌、**没有任何人**把盒切回账号位（activateAccount 的
   * already 分支只被收编面板与启动恢复调用）—— 盒子停在客人位，cloud-sync 的
   * 客人盒闸把整轮同步静默跳过，本地写全落进客人盒文件，用户看到
   * 「重新登录之后学的东西全没了」。修法 = login() 成功后自动踩一脚 activate()。
   *
   * 种坏自检：删掉 account.ts login() 里那段 `if (activated.value)` → 第一条红
   * （order 缺 'activate'、boxAccountId 停在 null）；把守卫改成恒真 → 第二条红
   * （未激活首登不该走直达，那是收编面板的路）。
   */
  it('已激活账号重登：登录后自动直达切盒（activate 被调、盒位翻真、不重跑收编）', async () => {
    const w = stubWorld()
    const a = useAccountStore()
    // 重登的现场：已登录已激活，但盒还停在客人位（登出时回客人盒留下的）
    w.loginState = { signedIn: true, accountId: 'acc-1', activated: true, boxAccountId: null }

    const res = await a.login({ username: 'alice', password: 'x'.repeat(12) })
    expect(res.ok).toBe(true)
    // 顺序判据：先登录、后直达 —— 不许倒过来，也不许多调
    expect(w.order).toEqual(['login', 'activate'])
    // 直达的结局：盒位翻真（cloud-sync 的 watch 据此全量重载 + 跑一轮）
    expect(a.state?.boxAccountId).toBe('acc-1')
    expect(a.needsActivation).toBe(false)
    expect(a.busy).toBeNull()
    expect(a.lastFailure).toBeNull()
  })

  it('未激活账号登录：不发 activate（首登该由收编面板走 merge-local/cloud-only）', async () => {
    const w = stubWorld()
    const a = useAccountStore()

    const res = await a.login({ username: 'alice', password: 'x'.repeat(12) })
    expect(res.ok).toBe(true)
    expect(w.order).toEqual(['login'])
    // 登录了没激活 = 正常中间态，界面据此引导收编
    expect(a.needsActivation).toBe(true)
  })

  it('重登直达失败（LEDGER_CORRUPT）：出声报码、盒留在客人位、登录本身仍算成功', async () => {
    const w = stubWorld()
    const a = useAccountStore()
    w.loginState = { signedIn: true, accountId: 'acc-1', activated: true, boxAccountId: null }
    w.activateRes = {
      ok: false,
      failure: { code: 'LEDGER_CORRUPT', message: 'ledger unreadable', httpStatus: null }
    }
    toasts.splice(0, toasts.length)

    const res = await a.login({ username: 'alice', password: 'x'.repeat(12) })
    // 登录回话本身是成功的（令牌拿到了）—— 失败的是数据面接回，不许吞
    expect(res.ok).toBe(true)
    expect(w.order).toEqual(['login', 'activate'])
    // 可见吐司 = 该码的文案（现场抠 ACCOUNT.ERR，不手打）
    expect(toasts.at(-1)?.text).toBe(ACCOUNT.ERR.LEDGER_CORRUPT)
    expect(toasts.at(-1)?.type).toBe('error')
    // 盒留在客人位是坏账本的既定处置（同 activate 的失败口径：纹丝不动）
    expect(a.state?.boxAccountId).toBeNull()
  })

  it('激活失败（LEDGER_CORRUPT）：失败进 lastFailure，状态纹丝不动', async () => {
    const w = stubWorld()
    const a = useAccountStore()
    await a.refresh()
    // 展开取纯值：a.state 是响应式代理，structuredClone 克隆不了它
    // （这就是项目里踩过四次的代理坑，测试里也不许踩）
    const before = { ...a.state }
    w.activateRes = {
      ok: false,
      failure: { code: 'LEDGER_CORRUPT', message: 'ledger unreadable', httpStatus: null }
    }
    await a.activate('merge-local')
    expect(a.lastFailure?.code).toBe('LEDGER_CORRUPT')
    // 「纹丝不动」= 与刷新后那份**逐字段相等**（失败不 refresh，也不许自作主张改）
    expect(a.state).toEqual(before)
  })

  it('probeSession：拿回话补用户名；失败静默不改任何状态', async () => {
    const w = stubWorld()
    const a = useAccountStore()
    await a.probeSession()
    expect(a.username).toBe('alice')
    expect(a.lastFailure).toBeNull()

    // 探测失败（损坏的返回）—— 不许记成"账号出错了"
    ;(window.miai.cloud as unknown as { session: () => Promise<unknown> }).session = async () => {
      throw new Error('ipc down')
    }
    await a.probeSession()
    expect(a.username).toBe('alice')
    expect(a.lastFailure).toBeNull()
    void w
  })

  it('probeSession：旧版服务端回 avatarHash=null 时不冲掉本地快照里的头像', async () => {
    const w = stubWorld()
    const HASH = 'a'.repeat(64)
    w.st = stateOf({
      signedIn: true,
      accountId: 'acc-1',
      username: 'alice',
      avatarHash: HASH,
      activated: true,
      boxAccountId: 'acc-1'
    })
    const a = useAccountStore()
    await a.refresh()
    expect(a.avatarHash).toBe(HASH)

    // 夹具里的 session 回话本来就缺 avatarHash；主进程解析旧服务端时归一成 null
    ;(window.miai.cloud as unknown as { session: () => Promise<unknown> }).session = async () => ({
      ok: true,
      data: {
        account: { id: 'acc-1', username: 'alice', avatarHash: null, createdAt: '2026-10-11T00:00:00.000Z' },
        idleExpiresAt: '2026-11-10T00:00:00.000Z',
        absoluteExpiresAt: '2027-04-09T00:00:00.000Z'
      }
    })
    await a.probeSession()
    expect(a.avatarHash).toBe(HASH)
    expect(a.state?.avatarHash).toBe(HASH)
  })
})

describe('找回三步链（2026-10-13 主人令）', () => {
  /**
   * 【这条判据钉什么】① 三步的参数**原样**到 IPC（store 不许自作主张 trim/降格 ——
   * 归一化是服务端的活，客户端偷偷处理会把"服务端归一后又不同了"的 bug 藏掉）；
   * ② busy 单槽共用 'recover' 且落地即释放；③ 找回**不产生会话**：三步跑完
   * state 仍然一片空白（没人调过 refresh，也没人写 username）。
   */
  it('三步成功：参数原样透传、busy 释放、不产生会话（state/username 纹丝不动）', async () => {
    const w = stubWorld()
    const a = useAccountStore()

    const q = await a.recoverQuestion('alice')
    expect(q.ok).toBe(true)
    // 原样等于夹具的问题（全角问号也是内容的一部分 —— 不许被"顺手规整"）
    if (q.ok) expect(q.data.question).toBe('你的第一只宠物叫什么？')

    // 答案带尾部空格与大小写 —— 就是要原样过去（服务端 NFKC+trim+小写）
    const v = await a.recoverVerify('alice', 'XiaoHei ')
    expect(v.ok).toBe(true)

    const r = await a.recoverReset('alice', 'XiaoHei ', 'new-pass-6')
    expect(r.ok).toBe(true)

    expect(w.recoverCalls).toEqual([
      { fn: 'question', arg: { username: 'alice' } },
      { fn: 'verify', arg: { username: 'alice', answer: 'XiaoHei ' } },
      { fn: 'reset', arg: { username: 'alice', answer: 'XiaoHei ', newPassword: 'new-pass-6' } }
    ])
    expect(a.busy).toBeNull()
    expect(a.lastFailure).toBeNull()
    // 不产生会话：state 从没被 refresh 过（null），username 也没被写上
    expect(a.state).toBeNull()
    expect(a.username).toBeNull()
    expect(a.signedIn).toBe(false)
  })

  it('单步失败：码进 lastFailure、busy 照常释放、透传原结果', async () => {
    const w = stubWorld()
    w.recoverVerifyRes = {
      ok: false,
      failure: { code: 'BAD_SECURITY_ANSWER', message: 'bad answer', httpStatus: 401 }
    }
    const a = useAccountStore()

    const res = await a.recoverVerify('alice', 'wrong')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.failure.code).toBe('BAD_SECURITY_ANSWER')
    expect(a.lastFailure?.code).toBe('BAD_SECURITY_ANSWER')
    expect(a.busy).toBeNull()

    // 下一步成功了要把失败清掉（lastFailure = 最近一次动作的，不是历史的）
    const ok = await a.recoverReset('alice', 'right', 'new-pass-6')
    expect(ok.ok).toBe(true)
    expect(a.lastFailure).toBeNull()
  })
})

describe('切盒前的干涸（P10.6）', () => {
  /**
   * 【这条判据钉的是顺序，不是"有没有存过"】
   * 防抖窗口里攒着的写，如果在登出 IPC **之后**才落盘，就会撞上切盒的新
   * epoch 被屏障拒掉 —— 用户点登出前最后几下操作静默丢失。所以要断言
   * `saveProfile` / `saveFavorites` 出现在 `logout` **之前**。
   * 种坏=删掉 logout 里的 quiesce()：两个 save 根本不会在登出前发生。
   */
  it('logout：本地写先落盘、再登出', async () => {
    const w = stubWorld()
    const a = useAccountStore()
    const p = useProgressStore()
    const f = useFavoritesStore()
    await settle() // 两个店读完档（ready=true），防抖才有意义

    p.markLearned('common-01', true)
    f.toggle('python-03:q1', null, 'lesson')
    // 此刻两笔都还在防抖窗口里 —— 正是干涸要救的那个窗口
    expect(w.order).toEqual([])

    await a.logout()

    const iSave = w.order.indexOf('saveProfile')
    const iFav = w.order.indexOf('saveFavorites')
    const iOut = w.order.indexOf('logout')
    expect(iSave).toBeGreaterThanOrEqual(0)
    expect(iFav).toBeGreaterThanOrEqual(0)
    expect(iOut).toBeGreaterThanOrEqual(0)
    expect(iSave).toBeLessThan(iOut)
    expect(iFav).toBeLessThan(iOut)
  })

  it('activate：同样先干涸再收编（收编是读客人盒现状做的合并）', async () => {
    const w = stubWorld()
    const a = useAccountStore()
    const p = useProgressStore()
    await settle()

    p.markLearned('common-02', true)
    await a.activate('merge-local')

    const iSave = w.order.indexOf('saveProfile')
    const iAct = w.order.indexOf('activate')
    expect(iSave).toBeGreaterThanOrEqual(0)
    expect(iAct).toBeGreaterThanOrEqual(0)
    expect(iSave).toBeLessThan(iAct)
  })

  it('logoutLocal（V1-62 仅本机退出）：同样先干涸再退；真登出的 IPC 一次都不发', async () => {
    const w = stubWorld()
    const a = useAccountStore()
    const p = useProgressStore()
    const f = useFavoritesStore()
    await settle()

    p.markLearned('common-01', true)
    f.toggle('python-03:q1', null, 'lesson')
    expect(w.order).toEqual([])

    const res = await a.logoutLocal()
    expect(res.ok).toBe(true)

    const iSave = w.order.indexOf('saveProfile')
    const iFav = w.order.indexOf('saveFavorites')
    const iOut = w.order.indexOf('logoutLocal')
    expect(iSave).toBeGreaterThanOrEqual(0)
    expect(iFav).toBeGreaterThanOrEqual(0)
    expect(iOut).toBeGreaterThanOrEqual(0)
    expect(iSave).toBeLessThan(iOut)
    expect(iFav).toBeLessThan(iOut)
    // 零网络出口的定义：走的是 logoutLocal，不碰要联网的 logout
    expect(w.order).not.toContain('logout')
  })

  it('logoutLocal 成功：state 翻到未登录、用户名清掉、busy 释放（界面回登录页的依据）', async () => {
    const w = stubWorld()
    const a = useAccountStore()
    w.st = stateOf({ signedIn: true, accountId: 'acc-1', activated: true, boxAccountId: 'acc-1' })
    await a.refresh()
    await a.probeSession()
    expect(a.username).toBe('alice')
    expect(a.signedIn).toBe(true)

    const res = await a.logoutLocal()
    expect(res.ok).toBe(true)
    expect(a.signedIn).toBe(false)
    expect(a.username).toBeNull()
    expect(a.busy).toBeNull()
    expect(a.lastFailure).toBeNull()
  })
})

/*
 * V2-11（回车可重复提交）：繁忙闸钉在 LoginView 三个推进函数的**首条语句**。
 *
 * views/ 不在 vitest 的 include 里（组件测不了），按 pet-static.test.ts 的
 * 静态闸门打法：读源码、剥注释，断言守卫原样在。**行为面**（连敲两回车只发
 * 一发 IPC）由真窗口探针钉（_uxfix-20261015/probe-enter.mjs）。
 *
 * 种坏自检：删掉任意一个函数的守卫 → 对应 it 立刻红（本班亲手验过）。
 */
const loginViewSrc = readFileSync(
  join(__dirname, '..', '..', 'views', 'LoginView.vue'),
  'utf8'
)
  // 剥注释：断言不许被注释里复述的同一句话满足（pet-static 同款纪律）
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')

function firstStatementOf(fn: string): string {
  const i = loginViewSrc.indexOf(`async function ${fn}(`)
  expect(i, `LoginView.vue 里找不到 async function ${fn}`).toBeGreaterThan(-1)
  const body = loginViewSrc.slice(loginViewSrc.indexOf('{', i) + 1)
  return body.trim().split('\n')[0].trim()
}

describe('V2-11：LoginView 各推进函数的繁忙闸（静态锚点）', () => {
  it.each([
    ['onLogin', '登录'],
    ['onRegister', '注册'],
    ['recoverNext', '找回密码推进'],
    ['saveName', '改名预检'],
    ['confirmNameChange', '改名二次确认']
  ])('%s（%s）的首条语句是 busy 闸 —— 守卫没了回车连发就重进', (fn) => {
    expect(firstStatementOf(fn)).toBe('if (acct.busy !== null) return')
  })
})
