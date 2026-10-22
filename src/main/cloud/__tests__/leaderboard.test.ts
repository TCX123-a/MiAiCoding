/**
 * leaderboard 单测 —— getBoard / setOptIn / summary 三条，全部离线（假 fetch）。
 *
 * 【游标是本文件的主角】keyset 游标是 base64(score:accountId)（protocol.ts:294）。
 * `+` 直接拼进 query 会被服务端读成空格、`=`/`&` 会截断参数 —— 所以有一条**含
 * `+`/`/`/`=` 的游标**用例：既要"URL 里的原始字节是编码后的"（种坏自检：若
 * 原始字节 == 原文，说明编码被绕过，必须红），也要"解码回来一字不差"。
 *
 * 【period 两种错法分得很开】不认识的值 = 我们自己传错参数 → TypeError 且零请求
 * （断言零 fetch，防"抛之前先把包发了"）；缺省 = 不造默认值、不拼参数（服务端
 * period 必填，缺省会让它的 400 原样透传——本层不猜一个"看着正常"的榜期）。
 *
 * 【缺键 ≠ 值为 null】这一节的 nullable 键最多：periodKey / me.rank / computedAt /
 * nextCursor / filter.lang / filter.difficulty / stats.lastActiveDay /
 * leaderboard.rankAllTime。显式 null 合法、缺键判 MALFORMED_RESPONSE，坏样本表里
 * 逐个点名。见文末「种坏自检实跑记录」。
 */
import { describe, expect, it } from 'vitest'
import { createCloudLeaderboardClient } from '../leaderboard'
import { createMemoryTokenStore, type TokenStore } from '../account'
import type { FetchLike, HttpResponseLike } from '../transport'
import type { CloudFailure, CloudResult } from '../../../shared/cloud/dto'
import { LEADERBOARD_LIMIT_MAX, type LeaderboardPeriod } from '../../../shared/cloud/protocol'

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
  return createCloudLeaderboardClient({
    baseUrl: BASE,
    fetch: fetchImpl,
    tokens,
    logger: () => {},
    sleep: async () => {}
  })
}

/** 深拷贝好样本再"只改坏一处"（同 rice.test.ts 的地基） */
function broken(base: unknown, mutate: (b: any) => void): unknown {
  const copy = JSON.parse(JSON.stringify(base)) as any
  mutate(copy)
  return copy
}

// ---------------------------------------------------------------- getBoard 夹具

/** GET /v1/leaderboard 200 好样本（leaderboard.ts:93-109 responseSchema 逐字段） */
function boardOkBody(): Record<string, unknown> {
  return {
    period: 'daily',
    periodKey: '2026-10-09',
    filter: { lang: null, difficulty: null },
    entries: [
      { rank: 1, username: 'alice', avatarHash: null, score: 900, days: 3, langs: ['c'] },
      { rank: 2, username: 'bob', avatarHash: null, score: 350, days: 1, langs: ['python', 'java'] }
    ],
    me: { rank: 3, score: 100, optedIn: true, scoreToday: 100 },
    computedAt: '2026-10-10T03:05:00.000Z',
    nextCursor: 'MQ=='
  }
}

/** alltime 空榜：全部 nullable 键**在**且为 null（不是缺键） */
function alltimeBoardBody(): Record<string, unknown> {
  return {
    period: 'alltime',
    periodKey: null,
    filter: { lang: 'c', difficulty: 'hard' },
    entries: [],
    me: { rank: null, score: 0, optedIn: false, scoreToday: 0 },
    computedAt: '2026-10-10T10:00:00.000Z',
    nextCursor: null
  }
}

const BOARD_BROKEN: Array<[string, (b: any) => void]> = [
  ['period 不在枚举里（hourly）', (b) => (b.period = 'hourly')],
  ['period 缺键', (b) => delete b.period],
  ['periodKey 缺键（缺键 ≠ null）', (b) => delete b.periodKey],
  ['periodKey 是数字', (b) => (b.periodKey = 20261009)],
  ['filter 缺键', (b) => delete b.filter],
  ['filter.lang 不在枚举里（rust）', (b) => (b.filter.lang = 'rust')],
  ['filter.lang 缺键', (b) => delete b.filter.lang],
  ['filter.difficulty 是数字', (b) => (b.filter.difficulty = 1)],
  ['entries 不是数组', (b) => (b.entries = {})],
  ['entry 缺 days', (b) => delete b.entries[0].days],
  ['entry.avatarHash 形状坏（非 hex）', (b) => (b.entries[0].avatarHash = 'bad')],
  ['entry.langs 含未知语言（rust）', (b) => (b.entries[0].langs = ['rust'])],
  ['entry.langs 是字符串', (b) => (b.entries[0].langs = 'c')],
  ['me 缺键', (b) => delete b.me],
  ['me.rank 缺键', (b) => delete b.me.rank],
  ['me.optedIn 是字符串', (b) => (b.me.optedIn = 'true')],
  ['computedAt 缺键', (b) => delete b.computedAt],
  ['nextCursor 缺键', (b) => delete b.nextCursor],
  ['nextCursor 是数字', (b) => (b.nextCursor = 12)]
]

// ---------------------------------------------------------------- summary / optIn 夹具

/** GET /v1/me/summary 200 好样本（me.ts:22-41 summarySchema 逐字段） */
function summaryOkBody(): Record<string, unknown> {
  return {
    stats: { learnedCount: 12, practicedCount: 30, streakDays: 4, lastActiveDay: '2026-10-10', totalScore: 900 },
    rice: { balance: 17, earnedTotal: 25, spentTotal: 8 },
    leaderboard: { rankAllTime: 3, scoreAllTime: 900, scoreToday: 100, optedIn: true }
  }
}

/** 新账号零态：lastActiveDay / rankAllTime 为 null（键必须在） */
function summaryZeroBody(): Record<string, unknown> {
  return {
    stats: { learnedCount: 0, practicedCount: 0, streakDays: 0, lastActiveDay: null, totalScore: 0 },
    rice: { balance: 0, earnedTotal: 0, spentTotal: 0 },
    leaderboard: { rankAllTime: null, scoreAllTime: 0, scoreToday: 0, optedIn: false }
  }
}

const SUMMARY_BROKEN: Array<[string, (b: any) => void]> = [
  ['stats 缺键', (b) => delete b.stats],
  ['stats.learnedCount 是字符串', (b) => (b.stats.learnedCount = '12')],
  ['stats.lastActiveDay 缺键（缺键 ≠ null）', (b) => delete b.stats.lastActiveDay],
  ['stats.lastActiveDay 是数字', (b) => (b.stats.lastActiveDay = 20261010)],
  ['rice 缺键', (b) => delete b.rice],
  ['rice.spentTotal 缺键', (b) => delete b.rice.spentTotal],
  ['leaderboard 缺键', (b) => delete b.leaderboard],
  ['leaderboard.rankAllTime 缺键', (b) => delete b.leaderboard.rankAllTime],
  ['leaderboard.rankAllTime 是字符串', (b) => (b.leaderboard.rankAllTime = '3')],
  ['leaderboard.optedIn 是字符串', (b) => (b.leaderboard.optedIn = 'yes')],
  ['leaderboard.scoreToday 是字符串', (b) => (b.leaderboard.scoreToday = '100')]
]

const OPTIN_BROKEN: Array<[string, (b: any) => void]> = [
  ['optIn 缺键', (b) => delete b.optIn],
  ['optIn 是字符串', (b) => (b.optIn = 'true')],
  ['optIn 是 null', (b) => (b.optIn = null)]
]

// ---------------------------------------------------------------- getBoard

describe('leaderboard.getBoard —— GET /v1/leaderboard', () => {
  it('happy path：URL/方法/凭据头 + 响应逐字段（含 entries[].langs 顺序原样）', async () => {
    const { fetch, calls } = makeFetch(async () => jsonRes(200, boardOkBody()))
    const data = expectOk(await client(fetch).getBoard({ period: 'daily' }))

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${BASE}/v1/leaderboard?period=daily`)
    expect(calls[0].init.method).toBe('GET')
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${FAKE_TOKEN}`)
    expect(headersOf(calls[0])['x-sync-protocol']).toBeDefined()
    expect(calls[0].init.body).toBeUndefined()

    expect(data).toEqual({
      period: 'daily',
      periodKey: '2026-10-09',
      filter: { lang: null, difficulty: null },
      entries: [
        { rank: 1, username: 'alice', avatarHash: null, score: 900, days: 3, langs: ['c'] },
        { rank: 2, username: 'bob', avatarHash: null, score: 350, days: 1, langs: ['python', 'java'] }
      ],
      me: { rank: 3, score: 100, optedIn: true, scoreToday: 100 },
      computedAt: '2026-10-10T03:05:00.000Z',
      nextCursor: 'MQ=='
    })
    expect(data.entries[1].langs).toEqual(['python', 'java'])
    expect(data.me.scoreToday).toBe(100)
    expect(data.nextCursor).toBe('MQ==')
  })

  it('旧版服务端 entries 缺 avatarHash：按 null 接，整张榜不判坏（版本漂移兼容）', async () => {
    const body = boardOkBody()
    for (const entry of body.entries as Array<Record<string, unknown>>) delete entry.avatarHash
    const { fetch } = makeFetch(async () => jsonRes(200, body))
    const data = expectOk(await client(fetch).getBoard({ period: 'daily' }))
    expect(data.entries.map((e) => e.avatarHash)).toEqual([null, null])
  })

  it('alltime 空榜：nullable 键**在**且为 null（缺键会在坏样本表里见红）', async () => {
    const { fetch, calls } = makeFetch(async () => jsonRes(200, alltimeBoardBody()))
    const data = expectOk(await client(fetch).getBoard({ period: 'alltime' }))

    expect(calls[0].url).toBe(`${BASE}/v1/leaderboard?period=alltime`)
    expect(data.periodKey).toBeNull()
    expect(data.nextCursor).toBeNull()
    expect(data.me.rank).toBeNull()
    expect(data.me.optedIn).toBe(false)
    expect('periodKey' in data).toBe(true)
    expect('nextCursor' in data).toBe(true)
    expect('rank' in data.me).toBe(true)
    expect(data.filter).toEqual({ lang: 'c', difficulty: 'hard' })
  })

  it('cursor 含 `+`/`/`/`=`：编码后发出、解码回来一字不差（两向都钉住）', async () => {
    // 服务端现行 base64url 恰好不含这三个字符（leaderboard-cursor.ts:16-18），
    // 但客户端**不依赖那个巧合** —— 这条用例就是那份不依赖的证明。
    const cursor = 'a+b/c=='
    const { fetch, calls } = makeFetch(async () => jsonRes(200, boardOkBody()))
    await client(fetch).getBoard({ period: 'daily', cursor })

    const url = new URL(calls[0].url)
    expect(url.pathname).toBe('/v1/leaderboard')
    expect(url.searchParams.get('period')).toBe('daily')
    // URLSearchParams 取出来是解码后的：必须与原文全等
    expect(url.searchParams.get('cursor')).toBe(cursor)

    const rawCursor = /[?&]cursor=([^&]*)/.exec(calls[0].url)?.[1]
    expect(rawCursor).toBeDefined()
    expect(rawCursor).toBe(encodeURIComponent(cursor))
    // 种坏自检：原始字节若与原文相等 ⇒ 编码步骤被绕过（+ 会被服务端读成空格）⇒ 这一句先红
    expect(rawCursor).not.toBe(cursor)
    // 反向：解码回来一字不差（多编一层 / 编错字符集都会红）
    expect(decodeURIComponent(rawCursor as string)).toBe(cursor)
  })

  it('不含特殊字符的 base64url 游标原样通过（编码不许把正常值改形）', async () => {
    const cursor = 'eyJzIjo5MDB9' // base64url 常态：字母数字，无 +/=
    const { fetch, calls } = makeFetch(async () => jsonRes(200, boardOkBody()))
    await client(fetch).getBoard({ period: 'daily', cursor })
    expect(calls[0].url).toBe(`${BASE}/v1/leaderboard?period=daily&cursor=${cursor}`)
  })

  it('period 不认识 ⇒ 抛 TypeError 且**零请求**（绕过 TS 的调用方在这里被拦下）', async () => {
    const { fetch, calls } = makeFetch(async () => jsonRes(200, boardOkBody()))
    const bogus = 'hourly' as unknown as LeaderboardPeriod
    await expect(client(fetch).getBoard({ period: bogus })).rejects.toThrow(TypeError)
    expect(calls).toHaveLength(0)
  })

  it('period 缺省：不拼参数、不造默认榜期（服务端的 400 会原样透传）', async () => {
    const { fetch, calls } = makeFetch(async () => jsonRes(200, boardOkBody()))
    await client(fetch).getBoard()
    expect(calls[0].url).toBe(`${BASE}/v1/leaderboard`)
    await client(fetch).getBoard({})
    expect(calls[1].url).toBe(`${BASE}/v1/leaderboard`)
  })

  it('dateKey 可选项：给了才拼（缺省不拼空参数）', async () => {
    const { fetch, calls } = makeFetch(async () => jsonRes(200, boardOkBody()))
    await client(fetch).getBoard({ period: 'daily' })
    expect(calls[0].url).toBe(`${BASE}/v1/leaderboard?period=daily`)
    await client(fetch).getBoard({ period: 'daily', dateKey: '2026-10-10' })
    expect(calls[1].url).toBe(`${BASE}/v1/leaderboard?period=daily&dateKey=2026-10-10`)
  })

  it('limit 超上限夹到 LEADERBOARD_LIMIT_MAX；合法值原样', async () => {
    const { fetch, calls } = makeFetch(async () => jsonRes(200, boardOkBody()))
    await client(fetch).getBoard({ period: 'weekly', limit: 9999 })
    expect(calls[0].url).toBe(`${BASE}/v1/leaderboard?period=weekly&limit=${LEADERBOARD_LIMIT_MAX}`)
    await client(fetch).getBoard({ period: 'weekly', limit: 30 })
    expect(calls[1].url).toBe(`${BASE}/v1/leaderboard?period=weekly&limit=30`)
  })

  it('429（API 限流）带 retryAfterMs 原样透传', async () => {
    const { fetch } = makeFetch(async () => errorRes(429, 'RATE_LIMITED', { retryAfterMs: 12_000 }))
    const failure = expectFailure(await client(fetch).getBoard({ period: 'daily' }))
    expect(failure.code).toBe('RATE_LIMITED')
    expect(failure.httpStatus).toBe(429)
    expect(failure.retryAfterMs).toBe(12_000)
  })

  it('400 错误体带 details（cursor is malformed 一类）不丢都读得回', async () => {
    const { fetch } = makeFetch(async () =>
      errorRes(400, 'VALIDATION_FAILED', { details: { cursor: 'a+b/c==' } })
    )
    const failure = expectFailure(await client(fetch).getBoard({ period: 'daily', cursor: 'a+b/c==' }))
    expect(failure.code).toBe('VALIDATION_FAILED')
    expect(failure.httpStatus).toBe(400)
    expect(failure.details).toEqual({ cursor: 'a+b/c==' })
  })
})

// ---------------------------------------------------------------- setOptIn

describe('leaderboard.setOptIn —— PUT /v1/me/leaderboard-opt-in', () => {
  it('happy path：PUT + {optIn} 逐字节 + 响应回显；false 也回 false（幂等写口）', async () => {
    const { fetch, calls } = makeFetch(async (url, init) =>
      jsonRes(200, { optIn: JSON.parse(String(init.body)).optIn })
    )
    const on = expectOk(await client(fetch).setOptIn({ optIn: true }))
    expect(calls[0].url).toBe(`${BASE}/v1/me/leaderboard-opt-in`)
    expect(calls[0].init.method).toBe('PUT')
    expect(headersOf(calls[0])['Content-Type']).toBe('application/json')
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${FAKE_TOKEN}`)
    expect(calls[0].init.body).toBe(JSON.stringify({ optIn: true }))
    expect(on).toEqual({ optIn: true })

    const off = expectOk(await client(fetch).setOptIn({ optIn: false }))
    expect(calls[1].init.body).toBe(JSON.stringify({ optIn: false }))
    expect(off).toEqual({ optIn: false })
    expect(off.optIn).toBe(false)
  })

  it('403 FORBIDDEN（账号被封禁一类）原样透传', async () => {
    const { fetch } = makeFetch(async () => errorRes(403, 'FORBIDDEN'))
    const failure = expectFailure(await client(fetch).setOptIn({ optIn: true }))
    expect(failure.code).toBe('FORBIDDEN')
    expect(failure.httpStatus).toBe(403)
  })
})

// ---------------------------------------------------------------- summary

describe('leaderboard.summary —— GET /v1/me/summary', () => {
  it('happy path：不带 dateKey 时无查询串；响应三段逐字段', async () => {
    const { fetch, calls } = makeFetch(async () => jsonRes(200, summaryOkBody()))
    const data = expectOk(await client(fetch).summary())

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${BASE}/v1/me/summary`)
    expect(calls[0].init.method).toBe('GET')
    expect(data).toEqual({
      stats: { learnedCount: 12, practicedCount: 30, streakDays: 4, lastActiveDay: '2026-10-10', totalScore: 900 },
      rice: { balance: 17, earnedTotal: 25, spentTotal: 8 },
      leaderboard: { rankAllTime: 3, scoreAllTime: 900, scoreToday: 100, optedIn: true }
    })
    expect(data.stats.streakDays).toBe(4)
    expect(data.rice.balance).toBe(17)
    expect(data.leaderboard.rankAllTime).toBe(3)
  })

  it('新账号零态：lastActiveDay / rankAllTime 为 null（键在），不是缺键', async () => {
    const { fetch } = makeFetch(async () => jsonRes(200, summaryZeroBody()))
    const data = expectOk(await client(fetch).summary())
    expect(data.stats.lastActiveDay).toBeNull()
    expect(data.leaderboard.rankAllTime).toBeNull()
    expect('lastActiveDay' in data.stats).toBe(true)
    expect('rankAllTime' in data.leaderboard).toBe(true)
  })

  it('dateKey 可选项：给了才拼 ?dateKey=（本地日修复口径）', async () => {
    const { fetch, calls } = makeFetch(async () => jsonRes(200, summaryOkBody()))
    await client(fetch).summary({ dateKey: '2026-10-10' })
    expect(calls[0].url).toBe(`${BASE}/v1/me/summary?dateKey=2026-10-10`)
    await client(fetch).summary()
    expect(calls[1].url).toBe(`${BASE}/v1/me/summary`)
  })

  it('503 DB_UNAVAILABLE 带 retryAfterMs 原样透传', async () => {
    const { fetch } = makeFetch(async () => errorRes(503, 'DB_UNAVAILABLE', { retryAfterMs: 2000 }))
    const failure = expectFailure(await client(fetch).summary())
    expect(failure.code).toBe('DB_UNAVAILABLE')
    expect(failure.httpStatus).toBe(503)
    expect(failure.retryAfterMs).toBe(2000)
  })
})

// ---------------------------------------------------------------- 坏形状（种坏自检）

describe('leaderboard —— 坏形状必须被同一句断言抓出', () => {
  async function expectMalformed(result: CloudResult<unknown>): Promise<void> {
    const failure = expectFailure(result)
    expect(failure.code).toBe('MALFORMED_RESPONSE')
    expect(failure.httpStatus).toBeNull()
    expect(failure.message.startsWith('unexpected response shape: ')).toBe(true)
  }

  for (const [name, mutate] of BOARD_BROKEN) {
    it(`board 坏形状：${name}`, async () => {
      const { fetch } = makeFetch(async () => jsonRes(200, broken(boardOkBody(), mutate)))
      await expectMalformed(await client(fetch).getBoard({ period: 'daily' }))
    })
  }

  for (const [name, mutate] of SUMMARY_BROKEN) {
    it(`summary 坏形状：${name}`, async () => {
      const { fetch } = makeFetch(async () => jsonRes(200, broken(summaryOkBody(), mutate)))
      await expectMalformed(await client(fetch).summary())
    })
  }

  for (const [name, mutate] of OPTIN_BROKEN) {
    it(`opt-in 坏形状：${name}`, async () => {
      const { fetch } = makeFetch(async () => jsonRes(200, broken({ optIn: true }, mutate)))
      await expectMalformed(await client(fetch).setOptIn({ optIn: true }))
    })
  }

  it('坏形状自检的反例：好样本不许被判成坏形状（防判据恒红）', async () => {
    const { fetch } = makeFetch(async () => jsonRes(200, boardOkBody()))
    const data = expectOk(await client(fetch).getBoard({ period: 'daily' }))
    expect(data.entries).toHaveLength(2)
  })
})

// ---------------------------------------------------------------- 未登录

describe('leaderboard —— 未登录', () => {
  it('没令牌时三个动作都回 UNLOGGED，且**一次 fetch 都没有**', async () => {
    const { fetch, calls } = makeFetch(async () => jsonRes(200, boardOkBody()))
    const c = client(fetch, createMemoryTokenStore())

    const boardFailure = expectFailure(await c.getBoard({ period: 'daily' }))
    expect(boardFailure.code).toBe('UNAUTHENTICATED')
    expect(boardFailure.message).toBe('not signed in')
    expect(boardFailure.httpStatus).toBeNull()

    expect(expectFailure(await c.setOptIn({ optIn: true })).code).toBe('UNAUTHENTICATED')
    expect(expectFailure(await c.summary()).code).toBe('UNAUTHENTICATED')

    expect(calls).toHaveLength(0)
  })

  it('参数错优先于未登录（period 传坏值：没令牌也抛 TypeError，不发包）', async () => {
    const { fetch, calls } = makeFetch(async () => jsonRes(200, boardOkBody()))
    const bogus = 'hourly' as unknown as LeaderboardPeriod
    await expect(client(fetch, createMemoryTokenStore()).getBoard({ period: bogus })).rejects.toThrow(TypeError)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------- 种坏自检实跑记录
//
// 【怎么验的（2026-10-10 实跑）】
//   ① 把 cursor 往返用例里 `expect(rawCursor).toBe(encodeURIComponent(cursor))` 临时改成
//      期望原文 cursor —— 必须红（说明这条真的在看编码后的字节），已见红改回；
//   ② 把 board happy path 的期望对象里 `periodKey` 临时拼成 `periodkey` —— toEqual 必红
//      （多余/缺失属性），已见红改回；
//   ③ BOARD_BROKEN / SUMMARY_BROKEN / OPTIN_BROKEN 三张表：每个字段各一条"只改坏一处"
//      的样本，走同一句断言 —— 任何"默认回退为成功"的护栏缺口都会当场见红。
