/**
 * account 单测（P10.3 第一步）—— 四条认证调用 + token 生命周期，全部离线（假 fetch）。
 *
 * 【这块测的是"钱与账号"的规矩】注册不许自动重发（重发 = 重复账号）、
 * 断网不许把人登出（token 保留规则）、token 不许随 IPC 出去。
 * 每条都有对应的断言，谁改坏了都会红在半句话能说清的地方。
 */
import { describe, expect, it } from 'vitest'
import { createCloudAccountClient, createMemoryTokenStore } from '../account'
import { SECURITY_QUESTIONS } from '../../../shared/cloud/protocol'
import type { CloudLogEvent, FetchLike, HttpResponseLike } from '../transport'
import type {
  CloudFailure,
  CloudRegisterInput,
  CloudResult
} from '../../../shared/cloud/dto'

const BASE = 'http://127.0.0.1:8787'

/** 形状合法的假令牌（ms1_ + 43 个 base64url 字符） */
const FAKE_TOKEN = 'ms1_' + 'Zk7Q'.repeat(10) + 'abc'

/** 注册必填的安全问答（2026-10-13）：问题取预设枚举成员，答案随用例编 */
const QA = { securityQuestion: SECURITY_QUESTIONS[0], securityAnswer: 'XiaoHei' } as const

// ---------------------------------------------------------------- 夹具

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
  return rawRes(status, JSON.stringify({ error: { code, message: `boom: ${code}`, requestId: 'req_test' } }))
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

function sessionBody(): unknown {
  return {
    account: { id: 'acc_1', username: 'alice', avatarHash: null, createdAt: '2026-10-10T00:00:00.000Z' },
    idleExpiresAt: '2026-11-09T00:00:00.000Z',
    absoluteExpiresAt: '2027-04-08T00:00:00.000Z'
  }
}

function expectFailure<T>(result: CloudResult<T>): CloudFailure {
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('expected a failure result')
  return result.failure
}

function expectOk<T>(result: CloudResult<T>): T {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`expected ok, got ${result.failure.code}`)
  return result.data
}

function captureLogs(): { logger: (e: CloudLogEvent) => void; events: CloudLogEvent[] } {
  const events: CloudLogEvent[] = []
  return { logger: (e) => events.push(e), events }
}

// ---------------------------------------------------------------- 注册 / 登录

describe('account 注册与登录', () => {
  it('register 成功：token 进 store；IPC 视图里没有 token；请求体只带认识的键', async () => {
    const tokens = createMemoryTokenStore()
    const fake = makeFetch(() => Promise.resolve(jsonRes(201, authBody())))
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    // 故意夹带一个多余键：门口必须把它剔掉（IPC 入参不可信）
    const input = { username: 'alice', password: 'p@ssw0rd-long', ...QA, evil: 'x' } as CloudRegisterInput
    const data = expectOk(await client.register(input))

    expect(tokens.get()).toBe(FAKE_TOKEN)
    expect(data.account.username).toBe('alice')
    expect('token' in data).toBe(false)
    expect(JSON.stringify(data)).not.toContain(FAKE_TOKEN)

    expect(fake.calls.length).toBe(1)
    expect(fake.calls[0].url).toBe(`${BASE}/v1/auth/register`)
    const sent = JSON.parse(String(fake.calls[0].init.body)) as Record<string, unknown>
    // 2026-10-13 起注册必带安全问答：认识的四键原样上行
    expect(Object.keys(sent).sort()).toEqual([
      'password',
      'securityAnswer',
      'securityQuestion',
      'username'
    ])
    expect(sent['securityQuestion']).toBe(QA.securityQuestion)
    expect(sent['securityAnswer']).toBe(QA.securityAnswer)
    expect(sent['evil']).toBeUndefined()
  })

  it('login 成功：走 /v1/auth/login，token 同样只落 store', async () => {
    const tokens = createMemoryTokenStore()
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, authBody())))
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    const data = expectOk(await client.login({ username: 'alice', password: 'whatever' }))
    expect(fake.calls[0].url).toBe(`${BASE}/v1/auth/login`)
    expect(tokens.get()).toBe(FAKE_TOKEN)
    expect('token' in data).toBe(false)
  })

  it('旧版服务端回话缺 avatarHash：按 null 接，登录照常成功（版本漂移兼容）', async () => {
    const oldShape = authBody() as {
      account: { avatarHash?: string | null }
    }
    delete oldShape.account.avatarHash
    const tokens = createMemoryTokenStore()
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, oldShape)))
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    const data = expectOk(await client.login({ username: 'alice', password: 'whatever' }))
    expect(tokens.get()).toBe(FAKE_TOKEN)
    expect(data.account.avatarHash).toBe(null)
    expect(tokens.currentProfile?.()).toEqual({ username: 'alice', avatarHash: null })
  })

  it('register 失败（409 USERNAME_TAKEN）：失败原样上行、token 不写、只发一次', async () => {
    const tokens = createMemoryTokenStore()
    const fake = makeFetch(() => Promise.resolve(errorRes(409, 'USERNAME_TAKEN')))
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    const failure = expectFailure(await client.register({ username: 'alice', password: 'p@ssw0rd-long', ...QA }))
    expect(failure.code).toBe('USERNAME_TAKEN')
    expect(failure.httpStatus).toBe(409)
    expect(tokens.get()).toBe(null)
    // 硬要求的账号层体现：注册失败绝不自动重发
    expect(fake.calls.length).toBe(1)
  })

  it('201 但 token 形状不对（伪造/代理）→ MALFORMED_RESPONSE、token 不写', async () => {
    const tokens = createMemoryTokenStore()
    const fake = makeFetch(() => Promise.resolve(jsonRes(201, authBody('definitely-not-a-token'))))
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    const failure = expectFailure(await client.login({ username: 'alice', password: 'x' }))
    expect(failure.code).toBe('MALFORMED_RESPONSE')
    // 这是解析侧的判定（登录实际回的是 200，但我们不替服务端报状态）——如实 null
    expect(failure.httpStatus).toBe(null)
    expect(tokens.get()).toBe(null)
  })

  it('201 但缺 account → MALFORMED_RESPONSE', async () => {
    const tokens = createMemoryTokenStore()
    const fake = makeFetch(() => Promise.resolve(jsonRes(201, { token: FAKE_TOKEN, expiresAt: 'a', absoluteExpiresAt: 'b' })))
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })
    const failure = expectFailure(await client.register({ username: 'alice', password: 'p', ...QA }))
    expect(failure.code).toBe('MALFORMED_RESPONSE')
    expect(tokens.get()).toBe(null)
  })
})

// ---------------------------------------------------------------- 找回三步链

describe('account 找回三步链（question / verify / reset）', () => {
  it('recoverQuestion：POST 对路径、body 只带 username、200 {question} 原样回；不带 Authorization、不碰 token', async () => {
    // 本机故意放一枚旧令牌：找回链既不该带它出去，也不该把它清掉/覆盖
    const tokens = createMemoryTokenStore(FAKE_TOKEN)
    const fake = makeFetch(() =>
      Promise.resolve(jsonRes(200, { question: '你的第一只宠物叫什么？' }))
    )
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    const data = expectOk(await client.recoverQuestion({ username: 'alice' }))
    expect(data.question).toBe('你的第一只宠物叫什么？')
    expect(fake.calls.length).toBe(1)
    expect(fake.calls[0].url).toBe(`${BASE}/v1/auth/recover/question`)
    expect(fake.calls[0].init.method).toBe('POST')
    const sent = JSON.parse(String(fake.calls[0].init.body)) as Record<string, unknown>
    expect(Object.keys(sent)).toEqual(['username'])
    const headers = fake.calls[0].init.headers as Record<string, string>
    expect(headers['Authorization']).toBeUndefined()
    expect(tokens.get()).toBe(FAKE_TOKEN)
  })

  it('recoverVerify：body {username, answer}；200 {verified:true} 通过', async () => {
    const tokens = createMemoryTokenStore()
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, { verified: true })))
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    const data = expectOk(await client.recoverVerify({ username: 'alice', answer: '小黑' }))
    expect(data.verified).toBe(true)
    expect(fake.calls[0].url).toBe(`${BASE}/v1/auth/recover/verify`)
    const sent = JSON.parse(String(fake.calls[0].init.body)) as Record<string, unknown>
    expect(sent).toEqual({ username: 'alice', answer: '小黑' })
    expect(tokens.get()).toBe(null)
  })

  it('recoverVerify：200 但 verified 不是 true → MALFORMED_RESPONSE（判定为真的路上不许有不需要证据的分支）', async () => {
    const tokens = createMemoryTokenStore()
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, { verified: false })))
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })
    const failure = expectFailure(await client.recoverVerify({ username: 'alice', answer: 'x' }))
    expect(failure.code).toBe('MALFORMED_RESPONSE')
  })

  it('recoverReset：body {username, answer, newPassword}；200 {ok:true} 通过且 token 仍不写', async () => {
    const tokens = createMemoryTokenStore()
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, { ok: true })))
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    const data = expectOk(
      await client.recoverReset({ username: 'alice', answer: 'xiaohei', newPassword: 'new pass 456' })
    )
    expect(data.ok).toBe(true)
    expect(fake.calls[0].url).toBe(`${BASE}/v1/auth/recover/reset`)
    const sent = JSON.parse(String(fake.calls[0].init.body)) as Record<string, unknown>
    expect(sent).toEqual({ username: 'alice', answer: 'xiaohei', newPassword: 'new pass 456' })
    // 三端点都不自动发 token（服务端有意）——重置成功也拿不到现成会话
    expect(tokens.get()).toBe(null)
  })

  it('recoverReset：200 但 ok 不是 true → MALFORMED_RESPONSE', async () => {
    const tokens = createMemoryTokenStore()
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, { ok: false })))
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })
    const failure = expectFailure(
      await client.recoverReset({ username: 'alice', answer: 'x', newPassword: 'abcdef' })
    )
    expect(failure.code).toBe('MALFORMED_RESPONSE')
  })

  it('失败码原样上行：404 无此账号 / 404 没设过问答 / 401 答案错 / 429 限流', async () => {
    const cases: { status: number; code: string }[] = [
      { status: 404, code: 'NOT_FOUND' },
      { status: 404, code: 'NO_SECURITY_QUESTION' },
      { status: 401, code: 'BAD_SECURITY_ANSWER' },
      { status: 429, code: 'RATE_LIMITED' }
    ]
    for (const c of cases) {
      const tokens = createMemoryTokenStore()
      const fake = makeFetch(() => Promise.resolve(errorRes(c.status, c.code)))
      const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })
      const failure = expectFailure(await client.recoverVerify({ username: 'alice', answer: 'x' }))
      expect(failure.code, c.code).toBe(c.code)
      expect(failure.httpStatus, c.code).toBe(c.status)
    }
  })
})

// ---------------------------------------------------------------- 登出

describe('account 登出', () => {
  it('本地没 token：ok(null) 且一个包都不发', async () => {
    const tokens = createMemoryTokenStore()
    const fake = makeFetch(() => Promise.resolve(jsonRes(204, null)))
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    const data = expectOk(await client.logout())
    expect(data).toBe(null)
    expect(fake.calls.length).toBe(0)
  })

  it('有 token：POST /v1/auth/logout 带 Authorization；204 → token 清掉', async () => {
    const tokens = createMemoryTokenStore(FAKE_TOKEN)
    const fake = makeFetch(
      () => Promise.resolve({ ok: true, status: 204, text: async () => '' })
    )
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    expectOk(await client.logout())
    expect(fake.calls.length).toBe(1)
    expect(fake.calls[0].url).toBe(`${BASE}/v1/auth/logout`)
    const headers = fake.calls[0].init.headers as Record<string, string>
    expect(headers['Authorization']).toBe(`Bearer ${FAKE_TOKEN}`)
    expect(tokens.get()).toBe(null)
  })

  it('登出失败（500）：失败上行但 token 保留（网络抖一下 ≠ 要登出）', async () => {
    const tokens = createMemoryTokenStore(FAKE_TOKEN)
    const fake = makeFetch(() => Promise.resolve(rawRes(500, 'oops')))
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    const failure = expectFailure(await client.logout())
    expect(failure.code).toBe('INTERNAL')
    expect(tokens.get()).toBe(FAKE_TOKEN)
  })
})

// ---------------------------------------------------------------- 会话探测

describe('account 会话探测', () => {
  it('本地没 token：ok(null)（未登录不是错误），不发包', async () => {
    const tokens = createMemoryTokenStore()
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, sessionBody())))
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    const data = expectOk(await client.session())
    expect(data).toBe(null)
    expect(fake.calls.length).toBe(0)
  })

  it('200 → 会话视图，token 保留（滑动会话照常续）', async () => {
    const tokens = createMemoryTokenStore(FAKE_TOKEN)
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, sessionBody())))
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    const data = expectOk(await client.session())
    expect(data?.account.username).toBe('alice')
    expect(fake.calls[0].url).toBe(`${BASE}/v1/auth/session`)
    expect(fake.calls[0].init.method).toBe('GET')
    expect(tokens.get()).toBe(FAKE_TOKEN)
  })

  it('200 且本地快照已是最新（刚改名/换头像）：一个字段都不回写 —— 迟到的旧回话不许覆盖（2026-10-22 夜间自查）', async () => {
    const HASH = 'd'.repeat(64)
    const tokens = createMemoryTokenStore(FAKE_TOKEN)
    // 模拟「探测已在飞，用户刚改名+换头像」：本地快照是新的
    tokens.set({
      token: FAKE_TOKEN,
      sub: 'acc_1',
      expiresAt: '2026-11-09T00:00:00.000Z',
      username: '刚改的新名字',
      avatarHash: HASH
    })
    const patches: Array<{ username?: string; avatarHash?: string | null }> = []
    const realUpdate = tokens.updateProfile
    tokens.updateProfile = (patch) => {
      patches.push(patch)
      realUpdate?.(patch)
    }
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, sessionBody())))
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    const data = expectOk(await client.session())
    // 回话本身原样交给调用方（旧值由渲染层的版本闸挡）
    expect(data?.account.username).toBe('alice')
    // 落盘快照纹丝不动
    expect(tokens.currentProfile?.()).toEqual({ username: '刚改的新名字', avatarHash: HASH })
    expect(patches).toEqual([])
  })

  it('200 且本地只有名字：只补 avatarHash，名字不被回话改掉（逐字段补缺）', async () => {
    const tokens = createMemoryTokenStore(FAKE_TOKEN)
    tokens.set({
      token: FAKE_TOKEN,
      sub: 'acc_1',
      expiresAt: '2026-11-09T00:00:00.000Z',
      username: '刚改的新名字'
      // avatarHash 未知（undefined）
    })
    const patches: Array<{ username?: string; avatarHash?: string | null }> = []
    const realUpdate = tokens.updateProfile
    tokens.updateProfile = (patch) => {
      patches.push(patch)
      realUpdate?.(patch)
    }
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, sessionBody())))
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    expectOk(await client.session())
    expect(patches).toEqual([{ avatarHash: null }])
    expect(tokens.currentProfile?.()).toEqual({ username: '刚改的新名字', avatarHash: null })
  })

  it('401 UNAUTHENTICATED / TOKEN_EXPIRED → 判定令牌已死：清 token、ok(null)', async () => {
    for (const code of ['UNAUTHENTICATED', 'TOKEN_EXPIRED']) {
      const tokens = createMemoryTokenStore(FAKE_TOKEN)
      const fake = makeFetch(() => Promise.resolve(errorRes(401, code)))
      const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

      const data = expectOk(await client.session())
      expect(data).toBe(null)
      expect(tokens.get()).toBe(null)
    }
  })

  it('断网（fetch 抛）→ failure NETWORK、**token 保留**（断网不等于被登出）', async () => {
    const tokens = createMemoryTokenStore(FAKE_TOKEN)
    const refused: FetchLike = () => Promise.reject(new Error('ECONNREFUSED'))
    // session 是 GET：断网会按 §3.7 重试 2 次 —— sleep 注入零延迟假件，别真等 2.5s
    const client = createCloudAccountClient({
      baseUrl: BASE,
      fetch: refused,
      timeoutMs: 50,
      tokens,
      sleep: async () => {}
    })

    const failure = expectFailure(await client.session())
    expect(failure.code).toBe('NETWORK')
    expect(tokens.get()).toBe(FAKE_TOKEN)
  })

  it('200 但形状坏 → MALFORMED_RESPONSE、token 保留（这是解析失败，不是服务端判死）', async () => {
    const tokens = createMemoryTokenStore(FAKE_TOKEN)
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, { nonsense: true })))
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    const failure = expectFailure(await client.session())
    expect(failure.code).toBe('MALFORMED_RESPONSE')
    expect(tokens.get()).toBe(FAKE_TOKEN)
  })
})

// ---------------------------------------------------------------- 改用户名（2026-10-22）

describe('account.updateUsername 改用户名', () => {
  const HASH = 'c'.repeat(64)

  function usernameBody(username = '大肥鱼学徒'): unknown {
    return {
      account: {
        id: 'acc_1',
        username,
        avatarHash: HASH,
        createdAt: '2026-10-10T00:00:00.000Z'
      }
    }
  }

  function tokensWithProfileCapture(): {
    tokens: ReturnType<typeof createMemoryTokenStore>
    patches: Array<{ username?: string; avatarHash?: string | null }>
  } {
    const tokens = createMemoryTokenStore(FAKE_TOKEN)
    const patches: Array<{ username?: string; avatarHash?: string | null }> = []
    tokens.updateProfile = (patch) => patches.push(patch)
    return { tokens, patches }
  }

  it('没登录：UNAUTHENTICATED，不发包（改名的前提是有会话）', async () => {
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, usernameBody())))
    const client = createCloudAccountClient({
      baseUrl: BASE,
      fetch: fake.fetch,
      timeoutMs: 50,
      tokens: createMemoryTokenStore()
    })
    const failure = expectFailure(await client.updateUsername('新名字'))
    expect(failure.code).toBe('UNAUTHENTICATED')
    expect(fake.calls.length).toBe(0)
  })

  it('成功：PUT /v1/me/username、体只带 username、回话逐字段、资料快照同步', async () => {
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, usernameBody('大肥鱼学徒'))))
    const { tokens, patches } = tokensWithProfileCapture()
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    const account = expectOk(await client.updateUsername('大肥鱼学徒'))
    expect(account).toEqual({
      id: 'acc_1',
      username: '大肥鱼学徒',
      avatarHash: HASH,
      createdAt: '2026-10-10T00:00:00.000Z'
    })
    expect(fake.calls.length).toBe(1)
    expect(fake.calls[0].url).toBe(`${BASE}/v1/me/username`)
    expect(fake.calls[0].init.method).toBe('PUT')
    const headers = fake.calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${FAKE_TOKEN}`)
    expect(headers['Content-Type']).toBe('application/json')
    // 载荷只带认识的键（IPC 入参可能夹带别的 — 门口必须剔掉）
    expect(JSON.parse(String(fake.calls[0].init.body))).toEqual({ username: '大肥鱼学徒' })
    expect(patches).toEqual([{ username: '大肥鱼学徒', avatarHash: HASH }])
    // 令牌原样（改名不是重新登录）
    expect(tokens.get()).toBe(FAKE_TOKEN)
  })

  it('409 USERNAME_TAKEN：失败码原样上抛，资料快照不动', async () => {
    const fake = makeFetch(() => Promise.resolve(errorRes(409, 'USERNAME_TAKEN')))
    const { tokens, patches } = tokensWithProfileCapture()
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    const failure = expectFailure(await client.updateUsername('alice'))
    expect(failure.code).toBe('USERNAME_TAKEN')
    expect(failure.httpStatus).toBe(409)
    expect(patches).toEqual([])
  })

  it('400 USERNAME_FORBIDDEN 也原样上抛（本地预检过了，服务端仍是权威）', async () => {
    const fake = makeFetch(() => Promise.resolve(errorRes(400, 'USERNAME_FORBIDDEN')))
    const { tokens, patches } = tokensWithProfileCapture()
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    const failure = expectFailure(await client.updateUsername('傻逼'))
    expect(failure.code).toBe('USERNAME_FORBIDDEN')
    expect(patches).toEqual([])
  })

  it('回话缺 avatarHash：按 null 接，不把旧服务端判成坏形状（版本漂移兼容）', async () => {
    const fake = makeFetch(() =>
      Promise.resolve(
        jsonRes(200, { account: { id: 'acc_1', username: 'bob', createdAt: '2026-10-10T00:00:00.000Z' } })
      )
    )
    const { tokens, patches } = tokensWithProfileCapture()
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    const account = expectOk(await client.updateUsername('bob'))
    expect(account.avatarHash).toBe(null)
    expect(patches).toEqual([{ username: 'bob', avatarHash: null }])
  })

  it('avatarHash 形状坏 / account 缺失：MALFORMED_RESPONSE，不把半个账号写进快照', async () => {
    const bodies: unknown[] = [
      { account: { id: 'acc_1', username: 'bob', avatarHash: 'bad', createdAt: '2026-10-10T00:00:00.000Z' } },
      { account: null },
      {}
    ]
    for (const body of bodies) {
      const fake = makeFetch(() => Promise.resolve(jsonRes(200, body)))
      const { tokens, patches } = tokensWithProfileCapture()
      const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })
      expect(expectFailure(await client.updateUsername('bob')).code).toBe('MALFORMED_RESPONSE')
      expect(patches).toEqual([])
    }
  })
})

// ---------------------------------------------------------------- 未配置

describe('account 未配置', () => {
  it('baseUrl 空串：登录得到 NOT_CONFIGURED、一个包不发、token 不写', async () => {
    const tokens = createMemoryTokenStore()
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, authBody())))
    const client = createCloudAccountClient({ baseUrl: '', fetch: fake.fetch, timeoutMs: 50, tokens })

    const failure = expectFailure(await client.login({ username: 'alice', password: 'p' }))
    expect(failure.code).toBe('NOT_CONFIGURED')
    expect(fake.calls.length).toBe(0)
    expect(tokens.get()).toBe(null)
  })
})

// ---------------------------------------------------------------- 凭据纪律

describe('account 凭据纪律', () => {
  it('全程日志事件里没有 token / Bearer / Authorization（成功与失败都跑一趟）', async () => {
    const tokens = createMemoryTokenStore(FAKE_TOKEN)
    const fake = makeFetch((_url, _init, callIndex) =>
      callIndex === 0
        ? Promise.resolve(jsonRes(200, sessionBody())) // session 成功
        : Promise.resolve(rawRes(500, 'oops')) // logout 失败
    )
    const { logger, events } = captureLogs()
    const client = createCloudAccountClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens, logger })

    await client.session()
    const failure = expectFailure(await client.logout())

    const flat = JSON.stringify(events)
    expect(flat).not.toContain(FAKE_TOKEN)
    expect(flat).not.toContain('Zk7Q')
    expect(flat).not.toContain('Bearer')
    expect(flat).not.toContain('Authorization')
    // 失败信息本身也不带凭据（message 由 transport 的出文案红线保证）
    expect(JSON.stringify(failure)).not.toContain(FAKE_TOKEN)
    expect(events.length).toBe(2)
  })
})
