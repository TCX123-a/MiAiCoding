/**
 * rice 单测 —— push / pull 两条，全部离线（假 fetch）。
 *
 * 【这块测的是"HTTP 200 ≠ 整批成功"】push 的 200 里 rejected[] 是逐条拒收
 * （服务端 rice.ts:245-287：窗口外 / kind 日上限 / adopt 重复都只逐条拒），
 * 整批失败只有 409 ENTRY_CONFLICT 一种。happy path 不许只断言 ok:true ——
 * rejected[] 里的**具体条目**要逐字段读回来，否则"整批都被拒了"也会绿。
 *
 * 【缺键 ≠ 值为 null】pull 的 ref / flags 键恒在（rice.ts:90-91 是 `.nullable()` 与
 * 数组）：显式 null 合法、缺键判 MALFORMED_RESPONSE —— 补 null 会把"服务端换形状了"
 * 这条真信号抹成"这条没有 ref"。坏形状表里两种都点名。
 *
 * 【种坏自检】两张坏样本表（PUSH_BROKEN / PULL_BROKEN：每个字段各一条"只改坏一处"
 * 的样本，其余字节与好样本全等）喂给**同一句断言**（code === MALFORMED_RESPONSE +
 * httpStatus === null + message 前缀），必须条条见红。见文末「种坏自检实跑记录」。
 */
import { describe, expect, it } from 'vitest'
import { createCloudRiceClient } from '../rice'
import { createMemoryTokenStore, type TokenStore } from '../account'
import type { FetchLike, HttpResponseLike } from '../transport'
import type { CloudFailure, CloudResult, RicePushRequest } from '../../../shared/cloud/dto'
import { RICE_PULL_LIMIT_MAX } from '../../../shared/cloud/protocol'

const BASE = 'http://127.0.0.1:8787'
const FAKE_TOKEN = 'ms1_' + 'Zk7Q'.repeat(10) + 'abc'
const INSTALL = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b'
const KEY_A = `${INSTALL}:1`
const KEY_B = `${INSTALL}:2`

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

function errorRes(status: number, code: string, extra: Record<string, unknown> = {}): HttpResponseLike {
  return rawRes(status, JSON.stringify({ error: { code, message: `boom: ${code}`, requestId: 'req_test', ...extra } }))
}

function headersOf(call: RecordedCall): Record<string, string> {
  return (call.init.headers ?? {}) as Record<string, string>
}

function bodyOf(call: RecordedCall): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>
}

function signedIn(): TokenStore {
  return createMemoryTokenStore(FAKE_TOKEN)
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

function client(fetchImpl: FetchLike, tokens: TokenStore = signedIn()) {
  return createCloudRiceClient({
    baseUrl: BASE,
    fetch: fetchImpl,
    tokens,
    logger: () => {},
    // 重试退避的注入缝：NETWORK 用例会真的重发，零延迟假件让测试不等 0.5s/2s
    sleep: async () => {}
  })
}

/** 深拷贝好样本再"只改坏一处"——坏样本必须与好样本一切其余字节相同（种坏自检的地基） */
function broken(base: unknown, mutate: (b: any) => void): unknown {
  const copy = JSON.parse(JSON.stringify(base)) as any
  mutate(copy)
  return copy
}

// ---------------------------------------------------------------- push 夹具

function pushRequest(): RicePushRequest {
  return {
    installId: INSTALL,
    entries: [
      {
        entryKey: KEY_A,
        kind: 'lesson',
        delta: 2,
        dayKey: '2026-10-10',
        at: '2026-10-10T09:00:00.000Z',
        ref: { lessonId: 'c-01' }
      },
      { entryKey: KEY_B, kind: 'feed', delta: -1, dayKey: '2026-10-10', at: '2026-10-10T09:05:00.000Z', ref: null }
    ]
  }
}

/** POST /v1/rice/entries 200 好样本（rice.ts:67-74 pushResponseSchema 逐字段） */
function pushOkBody(): Record<string, unknown> {
  return { accepted: 1, duplicated: 1, rejected: [], balance: 17, earnedTotal: 25, spentTotal: 8 }
}

/** 每个字段一条坏样本；键名与断言是同一份夹具，坏一处必须被同一句断言抓出 */
const PUSH_BROKEN: Array<[string, (b: any) => void]> = [
  ['accepted 是字符串', (b) => (b.accepted = '1')],
  ['duplicated 缺键', (b) => delete b.duplicated],
  ['rejected 不是数组', (b) => (b.rejected = null)],
  ['rejected 元素缺 detail', (b) => (b.rejected = [{ entryKey: KEY_A, code: 'OVER_DAILY_CAP' }])],
  ['rejected 元素 entryKey 是数字', (b) => (b.rejected = [{ entryKey: 1, code: 'X', detail: 'y' }])],
  ['balance 是字符串', (b) => (b.balance = '17')],
  ['earnedTotal 是 null', (b) => (b.earnedTotal = null)],
  ['spentTotal 缺键', (b) => delete b.spentTotal]
]

// ---------------------------------------------------------------- pull 夹具

/** GET /v1/rice/entries 200 好样本（rice.ts:81-96 pullResponseSchema 逐字段） */
function pullOkBody(): Record<string, unknown> {
  return {
    entries: [
      {
        seq: 7,
        entryKey: KEY_A,
        kind: 'lesson',
        delta: 2,
        dayKey: '2026-10-10',
        at: '2026-10-10T09:00:00.000Z',
        ref: { lessonId: 'c-01' },
        flags: []
      },
      {
        seq: 9,
        entryKey: KEY_B,
        kind: 'adopt',
        delta: 0,
        dayKey: '2026-10-01',
        at: '2026-10-01T00:00:00.000Z',
        ref: null,
        flags: ['clock_skew']
      }
    ],
    nextSeq: 9,
    balance: 17
  }
}

const PULL_BROKEN: Array<[string, (b: any) => void]> = [
  ['entries 不是数组', (b) => (b.entries = {})],
  ['entry.seq 是字符串', (b) => (b.entries[0].seq = '7')],
  ['entry 缺 ref 键（缺键 ≠ null）', (b) => delete b.entries[0].ref],
  ['entry.ref 是数组（不是对象也不是 null）', (b) => (b.entries[0].ref = [])],
  ['entry 缺 flags 键', (b) => delete b.entries[0].flags],
  ['entry.flags 含数字', (b) => (b.entries[0].flags = ['clock_skew', 1])],
  ['entry 缺 at 键', (b) => delete b.entries[0].at],
  ['nextSeq 缺键', (b) => delete b.nextSeq],
  ['balance 是字符串', (b) => (b.balance = '17')]
]

// ---------------------------------------------------------------- push

describe('rice.push —— POST /v1/rice/entries', () => {
  it('happy path：请求形状（URL/方法/凭据头/体逐字节）与响应逐字段', async () => {
    const { fetch, calls } = makeFetch(async () => jsonRes(200, pushOkBody()))
    const data = expectOk(await client(fetch).push(pushRequest()))

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${BASE}/v1/rice/entries`)
    expect(calls[0].init.method).toBe('POST')
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${FAKE_TOKEN}`)
    expect(headersOf(calls[0])['x-sync-protocol']).toBeDefined()
    expect(headersOf(calls[0])['Content-Type']).toBe('application/json')
    // 请求体逐字节：尤其 ref:null 不能因为 JSON.stringify 丢 undefined 键而消失
    expect(calls[0].init.body).toBe(JSON.stringify(pushRequest()))
    expect(bodyOf(calls[0]).entries).toEqual([
      { entryKey: KEY_A, kind: 'lesson', delta: 2, dayKey: '2026-10-10', at: '2026-10-10T09:00:00.000Z', ref: { lessonId: 'c-01' } },
      { entryKey: KEY_B, kind: 'feed', delta: -1, dayKey: '2026-10-10', at: '2026-10-10T09:05:00.000Z', ref: null }
    ])

    // 响应逐字段（toEqual 一把钉全形：多字段/少字段/改类型都会红）
    expect(data).toEqual({ accepted: 1, duplicated: 1, rejected: [], balance: 17, earnedTotal: 25, spentTotal: 8 })
    expect(data.balance).toBe(17)
    expect(data.earnedTotal).toBe(25)
    expect(data.spentTotal).toBe(8)
  })

  it('200 带 rejected[]：逐条拒收是**值**不是错误（这一条拆穿了"200 = 全收下"）', async () => {
    const body = {
      accepted: 1,
      duplicated: 0,
      rejected: [
        { entryKey: KEY_B, code: 'OVER_DAILY_CAP', detail: 'lesson <= 20/day' },
        { entryKey: `${INSTALL}:3`, code: 'VALIDATION_FAILED', detail: 'dayKey 与服务器日差 2 天' }
      ],
      balance: 10,
      earnedTotal: 10,
      spentTotal: 0
    }
    const { fetch } = makeFetch(async () => jsonRes(200, body))
    const data = expectOk(await client(fetch).push(pushRequest()))

    expect(data.rejected).toHaveLength(2)
    expect(data.rejected[0]).toEqual({ entryKey: KEY_B, code: 'OVER_DAILY_CAP', detail: 'lesson <= 20/day' })
    expect(data.rejected[1].code).toBe('VALIDATION_FAILED')
    expect(data.rejected[1].detail).toBe('dayKey 与服务器日差 2 天')
  })

  it('409 ENTRY_CONFLICT：code/状态/details 原样透传（details.entryKey 是调用方的裁决依据）', async () => {
    const { fetch } = makeFetch(async () => errorRes(409, 'ENTRY_CONFLICT', { details: { entryKey: KEY_A } }))
    const failure = expectFailure(await client(fetch).push(pushRequest()))
    expect(failure.code).toBe('ENTRY_CONFLICT')
    expect(failure.httpStatus).toBe(409)
    expect(failure.details).toEqual({ entryKey: KEY_A })
  })

  it('429 带 retryAfterMs（日条数配额）：两个字段都原样读到，不包装', async () => {
    const { fetch } = makeFetch(async () => errorRes(429, 'RATE_LIMITED', { retryAfterMs: 3_600_000 }))
    const failure = expectFailure(await client(fetch).push(pushRequest()))
    expect(failure.code).toBe('RATE_LIMITED')
    expect(failure.httpStatus).toBe(429)
    expect(failure.retryAfterMs).toBe(3_600_000)
  })

  it('断网（fetch 抛）：NETWORK 原样透传（不改写成别的 code）', async () => {
    // POST /v1/rice/entries 在 transport 的重试表里是 2 次（entry_key 幂等）——
    // fetch 会真重发，sleep 假件已注入；这里只咬"code 原样、httpStatus null"
    const { fetch } = makeFetch(async () => {
      throw new Error('socket hang up')
    })
    const failure = expectFailure(await client(fetch).push(pushRequest()))
    expect(failure.code).toBe('NETWORK')
    expect(failure.httpStatus).toBeNull()
  })
})

// ---------------------------------------------------------------- pull

describe('rice.pull —— GET /v1/rice/entries?since&limit', () => {
  it('happy path：since 恒拼、limit 缺省不拼；响应逐字段（ref 的两种形态都读回来）', async () => {
    const { fetch, calls } = makeFetch(async () => jsonRes(200, pullOkBody()))
    const data = expectOk(await client(fetch).pull({ since: 0 }))

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${BASE}/v1/rice/entries?since=0`)
    expect(calls[0].init.method).toBe('GET')
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${FAKE_TOKEN}`)
    expect(calls[0].init.body).toBeUndefined()

    expect(data).toEqual({
      entries: [
        {
          seq: 7,
          entryKey: KEY_A,
          kind: 'lesson',
          delta: 2,
          dayKey: '2026-10-10',
          at: '2026-10-10T09:00:00.000Z',
          ref: { lessonId: 'c-01' },
          flags: []
        },
        {
          seq: 9,
          entryKey: KEY_B,
          kind: 'adopt',
          delta: 0,
          dayKey: '2026-10-01',
          at: '2026-10-01T00:00:00.000Z',
          ref: null,
          flags: ['clock_skew']
        }
      ],
      nextSeq: 9,
      balance: 17
    })
    // "ref: null 是合法值"与"ref 键在不在"是两件事：这里键必须在
    expect('ref' in data.entries[1]).toBe(true)
    expect(data.entries[1].ref).toBeNull()
    expect(data.entries[0].flags).toEqual([])
    expect(data.nextSeq).toBe(9)
    expect(data.balance).toBe(17)
  })

  it('since=0 是值不是"没传"（显式发出去）；since 非零照发', async () => {
    const { fetch, calls } = makeFetch(async () => jsonRes(200, pullOkBody()))
    await client(fetch).pull({ since: 0 })
    expect(calls[0].url).toBe(`${BASE}/v1/rice/entries?since=0`)
    await client(fetch).pull({ since: 4096 })
    expect(calls[1].url).toBe(`${BASE}/v1/rice/entries?since=4096`)
  })

  it('limit 超上限夹到 RICE_PULL_LIMIT_MAX（夹的是我们发出去的请求，不留注定 400 的字节）', async () => {
    const { fetch, calls } = makeFetch(async () => jsonRes(200, pullOkBody()))
    await client(fetch).pull({ since: 0, limit: 5000 })
    expect(calls[0].url).toBe(`${BASE}/v1/rice/entries?since=0&limit=${RICE_PULL_LIMIT_MAX}`)
    await client(fetch).pull({ since: 0, limit: RICE_PULL_LIMIT_MAX + 1 })
    expect(calls[1].url).toBe(`${BASE}/v1/rice/entries?since=0&limit=${RICE_PULL_LIMIT_MAX}`)
    // 上限本身不夹、正数原样（钳取只在"超过"时发生，不许把合法值改小）
    await client(fetch).pull({ since: 0, limit: RICE_PULL_LIMIT_MAX })
    expect(calls[2].url).toBe(`${BASE}/v1/rice/entries?since=0&limit=${RICE_PULL_LIMIT_MAX}`)
    await client(fetch).pull({ since: 12, limit: 50 })
    expect(calls[3].url).toBe(`${BASE}/v1/rice/entries?since=12&limit=50`)
  })

  it('空页：entries=[] 且 nextSeq === since（可重入游标，不是 null）', async () => {
    const { fetch } = makeFetch(async () => jsonRes(200, { entries: [], nextSeq: 42, balance: 0 }))
    const data = expectOk(await client(fetch).pull({ since: 42 }))
    expect(data).toEqual({ entries: [], nextSeq: 42, balance: 0 })
  })

  it('400 VALIDATION_FAILED 原样透传（code + details）', async () => {
    const { fetch } = makeFetch(async () => errorRes(400, 'VALIDATION_FAILED', { details: { received: 900 } }))
    const failure = expectFailure(await client(fetch).pull({ since: 0 }))
    expect(failure.code).toBe('VALIDATION_FAILED')
    expect(failure.httpStatus).toBe(400)
    expect(failure.details).toEqual({ received: 900 })
  })
})

// ---------------------------------------------------------------- 坏形状（种坏自检）

describe('rice —— 坏形状必须被同一句断言抓出（MALFORMED_RESPONSE + httpStatus null）', () => {
  /** 一切坏形状走同一个断言：code 必须是 MALFORMED_RESPONSE、httpStatus 必须为 null（我们侧的判定）、message 前缀钉死 */
  async function expectMalformed(result: CloudResult<unknown>): Promise<CloudFailure> {
    const failure = expectFailure(result)
    expect(failure.code).toBe('MALFORMED_RESPONSE')
    expect(failure.httpStatus).toBeNull()
    expect(failure.message.startsWith('unexpected response shape: ')).toBe(true)
    return failure
  }

  for (const [name, mutate] of PUSH_BROKEN) {
    it(`push 坏形状：${name}`, async () => {
      const { fetch } = makeFetch(async () => jsonRes(200, broken(pushOkBody(), mutate)))
      await expectMalformed(await client(fetch).push(pushRequest()))
    })
  }

  for (const [name, mutate] of PULL_BROKEN) {
    it(`pull 坏形状：${name}`, async () => {
      const { fetch } = makeFetch(async () => jsonRes(200, broken(pullOkBody(), mutate)))
      await expectMalformed(await client(fetch).pull({ since: 0 }))
    })
  }

  it('坏形状自检的**反例**：好样本走同一句断言必须不红（防"判据恒红"的假报警）', async () => {
    // 若 expectMalformed 恒真（比如 data 根本没解析），上面那些用例会全绿但毫无意义。
    // 这一条把好样本喂进去，断言它 **不是** MALFORMED —— 两向都钉住。
    const { fetch } = makeFetch(async () => jsonRes(200, pullOkBody()))
    const data = expectOk(await client(fetch).pull({ since: 0 }))
    expect(data.entries).toHaveLength(2)
  })
})

// ---------------------------------------------------------------- 未登录

describe('rice —— 未登录', () => {
  it('没令牌时 push / pull 都回 UNLOGGED，且**一次 fetch 都没有**（不发出去再收 401）', async () => {
    const { fetch, calls } = makeFetch(async () => jsonRes(200, pushOkBody()))
    const c = client(fetch, createMemoryTokenStore())

    const pushFailure = expectFailure(await c.push(pushRequest()))
    expect(pushFailure.code).toBe('UNAUTHENTICATED')
    expect(pushFailure.message).toBe('not signed in')
    expect(pushFailure.httpStatus).toBeNull()

    const pullFailure = expectFailure(await c.pull({ since: 0 }))
    expect(pullFailure.code).toBe('UNAUTHENTICATED')
    expect(pullFailure.httpStatus).toBeNull()

    expect(calls).toHaveLength(0)
  })

  it('未登录优先于形状问题：就算服务端会回坏形状，我们也不发（本地就知道没登录）', async () => {
    const { fetch, calls } = makeFetch(async () => jsonRes(200, { garbage: true }))
    await client(fetch, createMemoryTokenStore()).push(pushRequest())
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------- 种坏自检实跑记录
//
// 【怎么验的（2026-10-10 实跑）】把上面「push happy path」里的请求体断言从
//   expect(calls[0].url).toBe(`${BASE}/v1/rice/entries`)
// 的手抄值临时改成 `${BASE}/v1/rice/entry`（少一个 s），该用例必须红
// （Expected/Received 只有一字符之差）——已实测见红后改回。
// 这个动作证明的正是"断言真的在比较字节"：如果它曾经是恒真的一句（比如比较了
// 两个都恒 undefined 的量），少一个字符不会红。响应侧的对应自检是 PUSH_BROKEN /
// PULL_BROKEN 两张表：每个字段各一条"只改坏一处"的样本，走**同一句**断言抓出。
