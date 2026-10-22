/**
 * challenge 单测 —— settle 一条，全部离线（假 fetch）。
 *
 * 【这块最重要的是 409】同一天再交一批不同的题 → 409 CHALLENGE_DUPLICATE，
 * details={settledAt, score}（challenge.ts:166-168）。调用方全靠这两个字段判断
 * "是不是我自己刚才那批已经落库了"，所以本文件专门有一条**真服务端形状**的 409
 * 用例，咬死 details 不被吞、code 不被包装。同 submissionId + 同 payload 的重放
 * 是 200 + idempotent:true（challenge.ts:150-168）——那是成功，不许读成冲突。
 *
 * 【形状纪律】settled 是 zod literal(true)（challenge.ts:87）：200 里它不是 true
 * = 认不出的形状 → MALFORMED_RESPONSE（我们侧的判定，httpStatus null）。坏样本表
 * 每个字段各一条"只改坏一处"，走同一句断言抓出。
 *
 * 【种坏自检】见文末「种坏自检实跑记录」。
 */
import { describe, expect, it } from 'vitest'
import { createCloudChallengeClient } from '../challenge'
import { createMemoryTokenStore, type TokenStore } from '../account'
import type { FetchLike, HttpResponseLike } from '../transport'
import type { ChallengeSettleRequest, CloudFailure, CloudResult } from '../../../shared/cloud/dto'

const BASE = 'http://127.0.0.1:8787'
const FAKE_TOKEN = 'ms1_' + 'Zk7Q'.repeat(10) + 'abc'
const INSTALL = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b'

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
  return createCloudChallengeClient({
    baseUrl: BASE,
    fetch: fetchImpl,
    tokens,
    logger: () => {},
    // 重试退避的注入缝（POST /v1/challenge/days 在 transport 表里是 2 次重试）
    sleep: async () => {}
  })
}

/** 深拷贝好样本再"只改坏一处"（同 rice.test.ts 的地基） */
function broken(base: unknown, mutate: (b: any) => void): unknown {
  const copy = JSON.parse(JSON.stringify(base)) as any
  mutate(copy)
  return copy
}

// ---------------------------------------------------------------- settle 夹具

/** POST /v1/challenge/days 请求（challenge.ts:64-84 settleBodySchema） */
function settleRequest(): ChallengeSettleRequest {
  return {
    submissionId: '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f',
    installId: INSTALL,
    dateKey: '2026-10-10',
    source: 'local',
    finishedAt: '2026-10-10T09:30:00.000Z',
    questions: [
      {
        key: 'c-01:q1',
        lessonId: 'c-01',
        qid: 'q1',
        lang: 'c',
        stage: 0,
        type: 'choice',
        difficulty: 'easy',
        source: 'local',
        ok: true
      },
      {
        key: 'c-01:q2',
        lessonId: 'c-01',
        qid: 'q2',
        lang: 'c',
        stage: 1,
        type: 'codefix',
        difficulty: 'medium',
        source: 'ai',
        ok: false
      }
    ],
    pickedLangs: ['c']
  }
}

/** POST /v1/challenge/days 200 好样本（challenge.ts:86-95 settleResponseSchema 逐字段） */
function settleOkBody(): Record<string, unknown> {
  return {
    settled: true,
    idempotent: false,
    dateKey: '2026-10-10',
    correct: 1,
    total: 2,
    score: 100,
    scoreMax: 250,
    flags: []
  }
}

const SETTLE_BROKEN: Array<[string, (b: any) => void]> = [
  ['settled 缺键', (b) => delete b.settled],
  ['settled 是 false（literal(true) 的失败形态）', (b) => (b.settled = false)],
  ['idempotent 是字符串', (b) => (b.idempotent = 'no')],
  ['dateKey 缺键', (b) => delete b.dateKey],
  ['correct 是字符串', (b) => (b.correct = '1')],
  ['total 缺键', (b) => delete b.total],
  ['score 是字符串', (b) => (b.score = '100')],
  ['scoreMax 是 null', (b) => (b.scoreMax = null)],
  ['flags 不是数组', (b) => (b.flags = 'difficulty_downgraded')],
  ['flags 含数字', (b) => (b.flags = ['difficulty_downgraded', 1])]
]

// ---------------------------------------------------------------- settle

describe('challenge.settle —— POST /v1/challenge/days', () => {
  it('happy path：请求形状逐字节 + 响应逐字段（服务端算的分）', async () => {
    const { fetch, calls } = makeFetch(async () => jsonRes(200, settleOkBody()))
    const data = expectOk(await client(fetch).settle(settleRequest()))

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${BASE}/v1/challenge/days`)
    expect(calls[0].init.method).toBe('POST')
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${FAKE_TOKEN}`)
    expect(headersOf(calls[0])['x-sync-protocol']).toBeDefined()
    expect(headersOf(calls[0])['Content-Type']).toBe('application/json')
    expect(calls[0].init.body).toBe(JSON.stringify(settleRequest()))

    expect(data).toEqual({
      settled: true,
      idempotent: false,
      dateKey: '2026-10-10',
      correct: 1,
      total: 2,
      score: 100,
      scoreMax: 250,
      flags: []
    })
    expect(data.score).toBe(100)
    expect(data.scoreMax).toBe(250)
  })

  it('幂等重放：200 + idempotent:true 是**成功**（不是错误、不重算分）', async () => {
    const body = { ...settleOkBody(), idempotent: true }
    const { fetch } = makeFetch(async () => jsonRes(200, body))
    const data = expectOk(await client(fetch).settle(settleRequest()))
    expect(data.idempotent).toBe(true)
    expect(data.settled).toBe(true)
    expect(data.score).toBe(100)
  })

  it('409 CHALLENGE_DUPLICATE：真服务端形状的 details {settledAt, score} 原样透传', async () => {
    // 形状取自 challenge.ts:166-168（appError details={{ settledAt: toIso(...), score: num(...) }}）
    const { fetch } = makeFetch(async () =>
      errorRes(409, 'CHALLENGE_DUPLICATE', {
        details: { settledAt: '2026-10-10T09:31:02.000Z', score: 350 }
      })
    )
    const failure = expectFailure(await client(fetch).settle(settleRequest()))

    expect(failure.code).toBe('CHALLENGE_DUPLICATE')
    expect(failure.httpStatus).toBe(409)
    expect(failure.details).toEqual({ settledAt: '2026-10-10T09:31:02.000Z', score: 350 })
    // details 必须能按服务端字段名读出来（拼错键名这里会红）
    const details = failure.details as { settledAt: string; score: number }
    expect(details.settledAt).toBe('2026-10-10T09:31:02.000Z')
    expect(details.score).toBe(350)
  })

  it('400 VALIDATION_FAILED（dateKey 超结算窗）details {dateKey, dayOffset} 原样透传', async () => {
    // 形状取自 challenge.ts:204-208
    const { fetch } = makeFetch(async () =>
      errorRes(400, 'VALIDATION_FAILED', { details: { dateKey: '2026-08-01', dayOffset: -70 } })
    )
    const failure = expectFailure(await client(fetch).settle(settleRequest()))
    expect(failure.code).toBe('VALIDATION_FAILED')
    expect(failure.httpStatus).toBe(400)
    expect(failure.details).toEqual({ dateKey: '2026-08-01', dayOffset: -70 })
  })

  it('200 不是对象（数组 / 字符串）⇒ MALFORMED_RESPONSE，不是静默成功', async () => {
    const { fetch } = makeFetch(async () => jsonRes(200, [settleOkBody()]))
    const failure = expectFailure(await client(fetch).settle(settleRequest()))
    expect(failure.code).toBe('MALFORMED_RESPONSE')
    expect(failure.httpStatus).toBeNull()
  })
})

// ---------------------------------------------------------------- 坏形状（种坏自检）

describe('challenge —— 坏形状必须被同一句断言抓出', () => {
  async function expectMalformed(result: CloudResult<unknown>): Promise<void> {
    const failure = expectFailure(result)
    expect(failure.code).toBe('MALFORMED_RESPONSE')
    expect(failure.httpStatus).toBeNull()
    expect(failure.message.startsWith('unexpected response shape: ')).toBe(true)
  }

  for (const [name, mutate] of SETTLE_BROKEN) {
    it(`settle 坏形状：${name}`, async () => {
      const { fetch } = makeFetch(async () => jsonRes(200, broken(settleOkBody(), mutate)))
      await expectMalformed(await client(fetch).settle(settleRequest()))
    })
  }

  it('坏形状自检的反例：好样本不许被判成坏形状（防判据恒红）', async () => {
    const { fetch } = makeFetch(async () => jsonRes(200, settleOkBody()))
    const data = expectOk(await client(fetch).settle(settleRequest()))
    expect(data.settled).toBe(true)
  })
})

// ---------------------------------------------------------------- 未登录

describe('challenge —— 未登录', () => {
  it('没令牌时回 UNLOGGED，且**一次 fetch 都没有**', async () => {
    const { fetch, calls } = makeFetch(async () => jsonRes(200, settleOkBody()))
    const failure = expectFailure(await client(fetch, createMemoryTokenStore()).settle(settleRequest()))
    expect(failure.code).toBe('UNAUTHENTICATED')
    expect(failure.message).toBe('not signed in')
    expect(failure.httpStatus).toBeNull()
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------- 种坏自检实跑记录
//
// 【怎么验的（2026-10-10 实跑）】把 409 用例里期望对象的一个键名
//   failure.details).toEqual({ settledAt: '...', score: 350 })
// 临时拼错（settledAt → settledatt），该用例必须红；已实测见红后改回。
// 另一层：SETTLE_BROKEN 的 10 条坏样本（每字段各一条"只改坏一处"）走同一句断言，
// 任何一条漏判（比如没有"默认回退为成功"的护栏被删掉）都会当场见红。
