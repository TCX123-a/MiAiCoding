/**
 * provider 收口单测（P10.1 第 11 项）—— 收口层与假件，全部离线
 *（函数式假 fetch，不开端口，一次都不真的联网）。
 *
 * 【这块测什么】收口层本身没有逻辑（就是组装），所以测的都是"组装有没有装错"：
 *   · 令牌共享：login 拿到的令牌，listDocs 必须带上 —— account 与 docs 两个
 *     客户端共用同一个 TokenStore（内部默认内存实现也只能有一份）；
 *   · 失败直通：401 原样上行、**只发一次**（零重试是硬口径，重试只会再收一个 401）；
 *   · 没登录别发包：session() **零请求**（本地就知道的事，不去讨一个 401 ——
 *     断网时那一趟还会把"未登录"伪装成 NETWORK 失败）；
 *   · 304 直通：条件 GET 的"没变"到 provider 面仍是"没变"（不是失败、没有 payload）；
 *   · 假件自证：剧本按序回放、队列空回默认、单条恒回 —— 地基先在自己尺子上量一遍。
 *
 * 【与 account/docs 两套单测的分工】那边测各自客户端的规矩；这边只测收口
 *（转发与共用令牌）。假 fetch / jsonRes 夹具同款，改一处要一起改。
 */
import { describe, expect, it } from 'vitest'
import { createApiProvider } from '../provider-impl'
import { createFakeProvider } from './provider-fake'
import { createMemoryTokenStore, type TokenStore } from '../account'
import { cloudFail, cloudOk, type FetchLike, type HttpResponseLike } from '../transport'
import type { ApiProvider } from '../provider'
import type { CloudAuthView, CloudFailure, CloudResult } from '../../../shared/cloud/dto'

const BASE = 'http://127.0.0.1:8787'

/** 形状合法的假令牌（ms1_ + 43 个 base64url 字符）—— 与 account/docs 两套单测同一把 */
const FAKE_TOKEN = 'ms1_' + 'Zk7Q'.repeat(10) + 'abc'

// ---------------------------------------------------------------- 夹具（与 account.test.ts / docs.test.ts 同款）

interface RecordedCall {
  url: string
  init: RequestInit
}

function makeFetch(
  handler: (url: string, init: RequestInit, callIndex: number) => Promise<HttpResponseLike>
): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  return {
    calls,
    fetch: (url, init) => {
      const callIndex = calls.length
      calls.push({ url, init })
      return handler(url, init, callIndex)
    }
  }
}

function jsonRes(status: number, body: unknown): HttpResponseLike {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }
}

function rawRes(status: number, raw: string): HttpResponseLike {
  return { ok: status >= 200 && status < 300, status, text: async () => raw }
}

function errorRes(status: number, code: string): HttpResponseLike {
  // 服务端真实错误体形状（transport 的解析真源）：{error:{code,message,requestId}}
  return rawRes(status, JSON.stringify({ error: { code, message: `boom: ${code}`, requestId: 'req_test' } }))
}

function headersOf(call: RecordedCall): Record<string, string> {
  return (call.init.headers ?? {}) as Record<string, string>
}

function expectOk<T>(result: CloudResult<T>): T {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`expected ok, got ${result.failure.code}`)
  return result.data
}

function expectFailure<T>(result: CloudResult<T>): CloudFailure {
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('expected a failure result')
  return result.failure
}

/** 服务端 AuthResponse 的成功体（形状抄本见 shared/cloud/dto.ts） */
function authBody(token = FAKE_TOKEN): unknown {
  return {
    token,
    expiresAt: '2026-11-09T00:00:00.000Z',
    absoluteExpiresAt: '2027-04-08T00:00:00.000Z',
    account: { id: 'acc_1', username: 'alice', avatarHash: null, createdAt: '2026-10-10T00:00:00.000Z' }
  }
}

/** 服务端 GET /v1/docs 的成功体（四个键恒在，见 dto.DocsSummary） */
function summaryBody(): unknown {
  return {
    profile: { revision: 3, docVer: 2, updatedAt: '2026-10-10T01:00:00.000Z', sizeBytes: 412 },
    wrongbook: null,
    favorites: null,
    practice: null
  }
}

/** 假 view 字面量（script 里的 CloudAuthView 成功值；形状 = account.test.ts 的 authBody 减 token） */
function authView(): CloudAuthView {
  return {
    expiresAt: '2026-11-09T00:00:00.000Z',
    absoluteExpiresAt: '2027-04-08T00:00:00.000Z',
    account: { id: 'acc_1', username: 'alice', avatarHash: null, createdAt: '2026-10-10T00:00:00.000Z' }
  }
}

/** 已登录的 store（经注入缝塞进 provider —— 它是 CloudApiProviderDeps.tokens 的消费者） */
function signedIn(): TokenStore {
  return createMemoryTokenStore(FAKE_TOKEN)
}

/** 统一的 provider 造法；logger 静音（失败分支默认会走 console.warn） */
function providerOf(fetchImpl: FetchLike, tokens?: TokenStore) {
  return createApiProvider({ baseUrl: BASE, fetch: fetchImpl, timeoutMs: 50, logger: () => {}, tokens })
}

// ---------------------------------------------------------------- 令牌共享（收口的头号义务）

describe('provider 令牌共享', () => {
  it('login 成功后 listDocs 带上登录拿到的令牌 —— 两个客户端共用同一个 TokenStore', async () => {
    const fake = makeFetch(async (url) =>
      url === `${BASE}/v1/auth/login` ? jsonRes(200, authBody()) : jsonRes(200, summaryBody())
    )
    // 刻意**不**注入 tokens：走 provider-impl 内部默认的内存 store。
    // 这条咬的就是"内部默认实现也必须只有一份"—— 各建各的 store 会让 docs 侧
    // 永远看不到登录令牌（表现为 listDocs 直接 UNAUTHENTICATED、一个包都不发）。
    const provider = providerOf(fake.fetch)

    const auth = expectOk(await provider.login({ username: 'alice', password: 'p@ssw0rd-long' }))
    expect(auth.account.username).toBe('alice')
    // 视图里不许带 token（凭据纪律在 account 层保证，收口不许把它漏回来）
    expect('token' in auth).toBe(false)

    const docs = expectOk(await provider.listDocs())
    expect(fake.calls.length).toBe(2)
    expect(fake.calls[0].url).toBe(`${BASE}/v1/auth/login`)
    expect(fake.calls[1].url).toBe(`${BASE}/v1/docs`)
    expect(fake.calls[1].init.method).toBe('GET')
    // 第二个请求必须带着刚登录的令牌：这就是"共用一份 TokenStore"的机器证据
    expect(headersOf(fake.calls[1])['Authorization']).toBe(`Bearer ${FAKE_TOKEN}`)
    expect(docs.profile?.revision).toBe(3)
  })
})

// ---------------------------------------------------------------- 失败直通

describe('provider 失败直通', () => {
  it('putDoc 收 401（UNAUTHENTICATED / TOKEN_EXPIRED）：原样上行、只发一次（零重试）', async () => {
    // 这两个码就是 provider.ts 头注释里的「令牌已死」判据 —— 同步引擎据此重新登录。
    // 收口层不许把它们改写成别的码（哪怕是"同义"的），也不许失败后自动再试。
    for (const code of ['UNAUTHENTICATED', 'TOKEN_EXPIRED'] as const) {
      const fake = makeFetch(async () => errorRes(401, code))
      const provider = providerOf(fake.fetch, signedIn())

      const failure = expectFailure(
        await provider.putDoc('profile', { docVer: 2, baseRevision: 3, payload: { version: 2 } })
      )
      expect(failure.code).toBe(code)
      expect(failure.httpStatus).toBe(401)
      // 只发一次：重试只会再收一个 401（调用计数是零重试的见证）
      expect(fake.calls.length).toBe(1)
      expect(fake.calls[0].url).toBe(`${BASE}/v1/docs/profile`)
      expect(fake.calls[0].init.method).toBe('PUT')
      expect(headersOf(fake.calls[0])['Authorization']).toBe(`Bearer ${FAKE_TOKEN}`)
    }
  })
})

// ---------------------------------------------------------------- 未登录 / 条件 GET

describe('provider 未登录与条件 GET', () => {
  it('无令牌 session()：ok(null) 且**零请求**（本地就知道，不去讨一个 401）', async () => {
    const fake = makeFetch(async () =>
      jsonRes(200, {
        account: { id: 'acc_1', username: 'alice', avatarHash: null, createdAt: '2026-10-10T00:00:00.000Z' },
        idleExpiresAt: '2026-11-09T00:00:00.000Z',
        absoluteExpiresAt: '2027-04-08T00:00:00.000Z'
      })
    )
    const provider = providerOf(fake.fetch)

    const data = expectOk(await provider.session())
    expect(data).toBeNull()
    // 零请求是重点：走到网络再收 401 也能得到 ok(null)（account 层会清令牌），
    // 但那趟白跑 —— 断网时它还会把"未登录"伪装成 NETWORK 失败。
    expect(fake.calls.length).toBe(0)
  })

  it('getDoc 撞 304：notModified 直通（成功、无 payload），If-None-Match 原样发出', async () => {
    const fake = makeFetch(async () => rawRes(304, ''))
    const provider = providerOf(fake.fetch, signedIn())

    const data = expectOk(await provider.getDoc('profile', { ifNoneMatchRevision: 3 }))
    expect(data).toEqual({ notModified: true })
    // "没变"与"变了"是一个判别联合，不是一个可空字段：不许有 payload 混进来
    expect('payload' in data).toBe(false)
    expect(fake.calls.length).toBe(1)
    expect(fake.calls[0].url).toBe(`${BASE}/v1/docs/profile`)
    // 引号是服务端口径（全等比较），少一对就永远命中不了 —— 咬死字节
    expect(headersOf(fake.calls[0])['If-None-Match']).toBe('"3"')
  })
})

// ---------------------------------------------------------------- 假件自证

describe('createFakeProvider 假件自证（地基先在自己尺子上量一遍）', () => {
  it('script 队列按序回放：先成功后失败；calls 如实记录两次 login', async () => {
    const p = createFakeProvider({
      login: [cloudOk(authView()), cloudFail('NETWORK', 'cable unplugged')]
    })

    const first = expectOk(await p.login({ username: 'alice', password: 'x' }))
    expect(first.account.username).toBe('alice')

    const failure = expectFailure(await p.login({ username: 'alice', password: 'x' }))
    expect(failure.code).toBe('NETWORK')

    expect(p.calls).toHaveLength(2)
    expect(p.calls.map((c) => c.method)).toEqual(['login', 'login'])
    expect(p.calls[0].args).toEqual([{ username: 'alice', password: 'x' }])
  })

  it('默认成功值三条路径（无剧本 / 队列耗尽 / 单条恒回），且能当 ApiProvider 用', async () => {
    // 类型面自证：不带任何剧本的假件也必须满足 ApiProvider（Spec 里点名的那一行）
    const bare = createFakeProvider()
    const asApi: ApiProvider = bare

    const session = expectOk(await asApi.session())
    expect(session).toBeNull() // 默认 = 未登录，不是"拿不到数据"
    const summary = expectOk(await bare.listDocs())
    expect(summary).toEqual({ profile: null, wrongbook: null, favorites: null, practice: null })
    const doc = expectOk(await bare.getDoc('profile'))
    expect(doc).toEqual({ notModified: true })

    // 队列耗尽 ⇒ 回默认成功值（第一条剧本照放）
    const drained = createFakeProvider({ login: [cloudFail('TIMEOUT', 'too slow')] })
    expectFailure(await drained.login({ username: 'a', password: 'b' }))
    const fallback = expectOk(await drained.login({ username: 'a', password: 'b' }))
    expect(fallback.account.username).toBe('fake-user')

    // 单条（非数组）⇒ 一直回放那一条
    const stuck = createFakeProvider({ session: cloudFail('NETWORK', 'offline') })
    expectFailure(await stuck.session())
    expectFailure(await stuck.session())

    // calls 的实参原样记录（编排断言靠它）—— docType 与 opts 都要在
    expect(bare.calls.map((c) => c.method)).toEqual(['session', 'listDocs', 'getDoc'])
    expect(bare.calls[2].args).toEqual(['profile', undefined])
  })
})
