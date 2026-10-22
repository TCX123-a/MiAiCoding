/**
 * docs 单测（P10.4 第一步）—— list / get / put 三条，全部离线（假 fetch）。
 *
 * 【这块测的是"同步不许静默走错分支"】文档同步全是条件请求：没变要说"没变"、
 * 撞版本要说"撞了"、抄错形状要说"认不出"。这三件任意一件塌成别的意思，用户看到的是
 * "同步没反应"或"我的错题本被覆盖了"，而不是一条错误。所以每条断言都咬着一个
 * **具体字节**（If-None-Match 的引号、baseRevision 的 null、请求发没发出去）。
 *
 * 【与 account.test.ts 的分工】那边测的是凭据红线（token 不许出去 / 注册不许重发）；
 * 这边测的是同步语义。两边的假 fetch / jsonRes 夹具同款，改一处要一起改。
 */
import { describe, expect, it } from 'vitest'
import { createCloudDocsClient } from '../docs'
import { createMemoryTokenStore, type TokenStore } from '../account'
import type { FetchLike, HttpResponseLike } from '../transport'
import type { CloudFailure, CloudResult } from '../../../shared/cloud/dto'

const BASE = 'http://127.0.0.1:8787'
const FAKE_TOKEN = 'ms1_' + 'Zk7Q'.repeat(10) + 'abc'

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

/** 已登录的 store */
function signedIn(): TokenStore {
  return createMemoryTokenStore(FAKE_TOKEN)
}

/** 服务端 GET /v1/docs 的成功体（四个键恒在，见 shared/cloud/dto.ts 的 DocsSummary） */
function summaryBody(): unknown {
  return {
    profile: { revision: 3, docVer: 2, updatedAt: '2026-10-10T01:00:00.000Z', sizeBytes: 412 },
    wrongbook: null,
    favorites: { revision: 1, docVer: 1, updatedAt: '2026-10-09T20:00:00.000Z', sizeBytes: 88 },
    practice: null
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

function client(fetchImpl: FetchLike, tokens: TokenStore = signedIn()) {
  return createCloudDocsClient({ baseUrl: BASE, fetch: fetchImpl, tokens, logger: () => {} })
}

// ---------------------------------------------------------------- list

describe('docs.list —— GET /v1/docs', () => {
  it('带令牌与协议头发一个 GET，解析四份摘要（null 是一等公民）', async () => {
    const { fetch, calls } = makeFetch(async () => jsonRes(200, summaryBody()))
    const data = expectOk(await client(fetch).list())

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${BASE}/v1/docs`)
    expect(calls[0].init.method).toBe('GET')
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${FAKE_TOKEN}`)
    expect(headersOf(calls[0])['x-sync-protocol']).toBeDefined()
    // 无体 ⇒ 不许发 Content-Type（服务端没体却带 Content-Type 会被 fastify 判 415）
    expect(headersOf(calls[0])['Content-Type']).toBeUndefined()
    expect(calls[0].init.body).toBeUndefined()

    expect(data.profile).toEqual({ revision: 3, docVer: 2, updatedAt: '2026-10-10T01:00:00.000Z', sizeBytes: 412 })
    expect(data.wrongbook).toBeNull()
    expect(data.favorites?.revision).toBe(1)
    expect(data.practice).toBeNull()
  })

  it('**缺键 ≠ 值为 null**：少一个键就是 MALFORMED_RESPONSE，绝不补成 null', async () => {
    // 这条是刻意的：把缺键补成 null，等于把"服务端换形状了"这个真信号
    // 抹平成"云端还没有这份文档"，而后者会让客户端拿 baseRevision:null 去首推、
    // 覆盖掉云端已有的那份。宁可当场报错。
    const body = summaryBody() as Record<string, unknown>
    delete body.practice
    const { fetch } = makeFetch(async () => jsonRes(200, body))
    const failure = expectFailure(await client(fetch).list())
    expect(failure.code).toBe('MALFORMED_RESPONSE')
    expect(failure.httpStatus).toBeNull()
  })

  it('摘要字段类型不对 ⇒ MALFORMED_RESPONSE（revision 是字符串这种）', async () => {
    const { fetch } = makeFetch(async () =>
      jsonRes(200, {
        profile: { revision: '3', docVer: 2, updatedAt: 'x', sizeBytes: 1 },
        wrongbook: null,
        favorites: null,
        practice: null
      })
    )
    expect(expectFailure(await client(fetch).list()).code).toBe('MALFORMED_RESPONSE')
  })
})

// ---------------------------------------------------------------- get

describe('docs.get —— GET /v1/docs/:docType（含条件 GET）', () => {
  it('无条件拉取：不发 If-None-Match，回完整文档', async () => {
    const { fetch, calls } = makeFetch(async () =>
      jsonRes(200, {
        docVer: 2,
        revision: 3,
        updatedAt: '2026-10-10T01:00:00.000Z',
        payload: { version: 2, entries: [] }
      })
    )
    const data = expectOk(await client(fetch).get('wrongbook'))

    expect(calls[0].url).toBe(`${BASE}/v1/docs/wrongbook`)
    expect(headersOf(calls[0])['If-None-Match']).toBeUndefined()
    expect(data).toEqual({
      notModified: false,
      docVer: 2,
      revision: 3,
      updatedAt: '2026-10-10T01:00:00.000Z',
      payload: { version: 2, entries: [] }
    })
  })

  it('条件 GET：If-None-Match 的引号逐字节等于服务端口径（`"3"`，不是 `3` 也不是 W/"3"）', async () => {
    // sync.ts:203 发的是 `"${revision}"`，:205 是**全等**比较 —— 少一对引号就永远命中不了，
    // 表现为"每次都全量拉"，不报错。所以这里咬死字节。
    const { fetch, calls } = makeFetch(async () => rawRes(304, ''))
    await client(fetch).get('profile', { ifNoneMatchRevision: 3 })
    expect(headersOf(calls[0])['If-None-Match']).toBe('"3"')
  })

  it('**304 是成功**：回 {notModified:true}，不是任何一种失败', async () => {
    // 这条是 transport 那个 304 分支的守门人：Fetch 的 res.ok 对 304 是 false，
    // 少了那条分支，这里会变成 BAD_REQUEST —— 一次正常的缓存命中报成请求形状错。
    const { fetch } = makeFetch(async () => rawRes(304, ''))
    const data = expectOk(await client(fetch).get('profile', { ifNoneMatchRevision: 9 }))
    expect(data).toEqual({ notModified: true })
    // 且不许有 payload 字段混进来（"没变"与"变了"是一个判别联合，不是可选字段）
    expect('payload' in data).toBe(false)
  })

  it('revision 0 也发得出去（0 是合法 revision，不许被当成"没传"）', async () => {
    const { fetch, calls } = makeFetch(async () => rawRes(304, ''))
    await client(fetch).get('profile', { ifNoneMatchRevision: 0 })
    expect(headersOf(calls[0])['If-None-Match']).toBe('"0"')
  })

  it('2xx 但 payload 不是对象 ⇒ MALFORMED_RESPONSE', async () => {
    const { fetch } = makeFetch(async () =>
      jsonRes(200, { docVer: 1, revision: 1, updatedAt: 'x', payload: 'not-an-object' })
    )
    expect(expectFailure(await client(fetch).get('profile')).code).toBe('MALFORMED_RESPONSE')
  })

  it('404 NOT_FOUND 原样透传（云端没有这份文档 = 走 baseRevision:null 首推）', async () => {
    const { fetch } = makeFetch(async () => errorRes(404, 'NOT_FOUND'))
    const failure = expectFailure(await client(fetch).get('practice'))
    expect(failure.code).toBe('NOT_FOUND')
    expect(failure.httpStatus).toBe(404)
  })
})

// ---------------------------------------------------------------- put

describe('docs.put —— PUT /v1/docs/:docType（条件写）', () => {
  it('首推：baseRevision 发的是 JSON null（不是被 stringify 丢掉的 undefined）', async () => {
    // JSON.stringify 会把值为 undefined 的键**整个丢掉**，服务端 zod 收到的是缺键 ⇒ 400。
    // 首推恰恰是每个新用户的第一步，这条坏了整个同步起不来。
    const { fetch, calls } = makeFetch(async () =>
      jsonRes(200, { revision: 1, docVer: 1, updatedAt: '2026-10-10T02:00:00.000Z' })
    )
    const data = expectOk(
      await client(fetch).put('wrongbook', { docVer: 1, baseRevision: null, payload: { version: 1, entries: [] } })
    )

    expect(calls[0].url).toBe(`${BASE}/v1/docs/wrongbook`)
    expect(calls[0].init.method).toBe('PUT')
    expect(headersOf(calls[0])['Content-Type']).toBe('application/json')
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${FAKE_TOKEN}`)
    expect(calls[0].init.body).toBe(
      JSON.stringify({ docVer: 1, baseRevision: null, payload: { version: 1, entries: [] } })
    )
    expect('baseRevision' in bodyOf(calls[0])).toBe(true)
    expect(bodyOf(calls[0]).baseRevision).toBeNull()
    expect(data).toEqual({ revision: 1, docVer: 1, updatedAt: '2026-10-10T02:00:00.000Z' })
  })

  it('CAS：baseRevision 是数字时原样发', async () => {
    const { fetch, calls } = makeFetch(async () =>
      jsonRes(200, { revision: 5, docVer: 2, updatedAt: '2026-10-10T02:00:00.000Z' })
    )
    await client(fetch).put('profile', { docVer: 2, baseRevision: 4, payload: { version: 2 } })
    expect(bodyOf(calls[0])).toEqual({ docVer: 2, baseRevision: 4, payload: { version: 2 } })
  })

  it('撞版本：409 CONFLICT_STALE 带上服务端的 details（currentRevision 要能读到）', async () => {
    // 冲突处理完全靠 details.currentRevision —— 丢了这个字段，调用方只能盲目重拉
    const { fetch } = makeFetch(async () => errorRes(409, 'CONFLICT_STALE', { details: { currentRevision: 7, currentDocVer: 2 } }))
    const failure = expectFailure(await client(fetch).put('profile', { docVer: 2, baseRevision: 3, payload: { version: 2 } }))
    expect(failure.code).toBe('CONFLICT_STALE')
    expect(failure.httpStatus).toBe(409)
    expect(failure.details).toEqual({ currentRevision: 7, currentDocVer: 2 })
  })

  it('docVer ≙ payload.version 抄错 ⇒ 拒绝并抛 TypeError，且**一个包都不发**', async () => {
    const { fetch, calls } = makeFetch(async () => jsonRes(200, {}))
    // 注意 .rejects 而不是 toThrow：put 是 async，async 方法**永远不同步抛**，
    // 写 toThrow 会恒不成立（一条假红等着下一个人）。这里也顺带钉住"它是拒绝不是返回值"。
    await expect(
      client(fetch).put('profile', { docVer: 3, baseRevision: 1, payload: { version: 2 } })
    ).rejects.toThrow(TypeError)
    // 关键：抛之前没发出去。发出去的话服务端回一个 400 VALIDATION_FAILED，
    // 读起来像"请求形状坏了"，真因（我们自己参数配错）就被掩盖了。
    expect(calls).toHaveLength(0)
  })

  it('2xx 但回体缺 revision ⇒ MALFORMED_RESPONSE（不许把 undefined 当新版本号用）', async () => {
    const { fetch } = makeFetch(async () => jsonRes(200, { docVer: 2, updatedAt: 'x' }))
    const failure = expectFailure(await client(fetch).put('profile', { docVer: 2, baseRevision: 1, payload: { version: 2 } }))
    expect(failure.code).toBe('MALFORMED_RESPONSE')
    expect(failure.httpStatus).toBeNull()
  })

  it('429 RATE_LIMITED 带 retryAfterMs（A5 的文档写入桶就长这样）', async () => {
    const { fetch } = makeFetch(async () => errorRes(429, 'RATE_LIMITED', { retryAfterMs: 3_600_000 }))
    const failure = expectFailure(await client(fetch).put('practice', { docVer: 1, baseRevision: 1, payload: { version: 1 } }))
    expect(failure.code).toBe('RATE_LIMITED')
    expect(failure.retryAfterMs).toBe(3_600_000)
  })
})

// ---------------------------------------------------------------- 未登录 / 参数护栏

describe('docs —— 未登录与参数护栏', () => {
  it('没令牌时三个动作都回 UNAUTHENTICATED，且**零请求**（不发出去再收 401）', async () => {
    const { fetch, calls } = makeFetch(async () => jsonRes(200, summaryBody()))
    const c = client(fetch, createMemoryTokenStore())

    expect(expectFailure(await c.list()).code).toBe('UNAUTHENTICATED')
    expect(expectFailure(await c.get('profile')).code).toBe('UNAUTHENTICATED')
    expect(expectFailure(await c.put('profile', { docVer: 1, baseRevision: null, payload: { version: 1 } })).code).toBe(
      'UNAUTHENTICATED'
    )
    expect(calls).toHaveLength(0)
    // httpStatus 必须是 null：服务端根本没回过话，写 401 就是在编造读数
    expect(expectFailure(await c.list()).httpStatus).toBeNull()
  })

  it('docType 不在枚举里 ⇒ 拒绝并抛 TypeError 且零请求（绕过 TS 的调用方由这里拦）', async () => {
    const { fetch, calls } = makeFetch(async () => jsonRes(200, {}))
    const c = client(fetch)
    const bogus = 'notes' as unknown as Parameters<typeof c.get>[0]

    await expect(c.get(bogus)).rejects.toThrow(TypeError)
    await expect(c.put(bogus, { docVer: 1, baseRevision: null, payload: { version: 1 } })).rejects.toThrow(TypeError)
    expect(calls).toHaveLength(0)
  })
})
