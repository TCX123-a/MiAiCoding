/**
 * transport 单测（P10.3 第一步）—— 一次都不联网：fetch 全是注入的假货。
 *
 * 【每条判据都要能"种坏见红"】写这些断言时挨个问过：如果实现往反方向改，
 * 这条会不会红？（例：删掉零重试断言里的 calls.length 检查，重试就测不出来了。）
 * 文件里带「尺子自检」标记的用例是**阴性对照**：故意喂一个坏样本，
 * 证明判据真的在量东西（而不是恒真的装饰）。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  CLOUD_TIMEOUT_MS,
  createTransport,
  NOT_MODIFIED,
  retryPlanFor,
  statusToCode,
  type CloudLogEvent,
  type FetchLike,
  type HttpResponseLike
} from '../transport'
import type { CloudFailure, CloudResult } from '../../../shared/cloud/dto'
import { HTTP_STATUS_BY_CODE, PROTOCOL_CURRENT, SYNC_PROTOCOL_HEADER } from '../../../shared/cloud/protocol'

const BASE = 'http://127.0.0.1:8787'

/** 形状合法的假令牌（ms1_ + 43 个 base64url 字符）。挑了个绝不会在别处偶然出现的串 */
const FAKE_TOKEN = 'ms1_' + 'Zk7Q'.repeat(10) + 'abc'

// ---------------------------------------------------------------- 夹具

interface RecordedCall {
  url: string
  init: RequestInit
}

interface FakeFetch {
  fetch: FetchLike
  calls: RecordedCall[]
}

/** 脚本化的假 fetch：每次调用记账，响应/异常由 handler 按调用序号决定 */
function makeFetch(
  handler: (url: string, init: RequestInit, callIndex: number) => Promise<HttpResponseLike>
): FakeFetch {
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

/** 服务端统一错误体（错误码映射的输入；requestId 服务端必发） */
function errorRes(status: number, code: string, extra: Record<string, unknown> = {}): HttpResponseLike {
  return rawRes(status, JSON.stringify({ error: { code, message: `boom: ${code}`, requestId: 'req_test', ...extra } }))
}

/** 会挂到被 abort 为止的 fetch（超时路径专用；尊重 init.signal 是假货的合同义务） */
const hangingFetch: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => {
      const err = new Error('The operation was aborted.')
      err.name = 'AbortError'
      reject(err)
    })
  })

function captureLogs(): { logger: (e: CloudLogEvent) => void; events: CloudLogEvent[] } {
  const events: CloudLogEvent[] = []
  return { logger: (e) => events.push(e), events }
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

// ---------------------------------------------------------------- 请求组装

describe('transport 请求组装', () => {
  it('拼 URL 吃掉 base 尾斜杠；协议头恒在；Content-Type 与 Authorization 该有才有', async () => {
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, { ok: true })))
    const t = createTransport({ baseUrl: 'http://127.0.0.1:8787/', fetch: fake.fetch, timeoutMs: 50 })

    await t.request({
      method: 'POST',
      path: '/v1/auth/login',
      body: { username: 'u', password: 'p' },
      token: FAKE_TOKEN
    })
    await t.request({ method: 'GET', path: '/v1/auth/session' })

    expect(fake.calls.length).toBe(2)
    expect(fake.calls[0].url).toBe(`${BASE}/v1/auth/login`)
    expect(fake.calls[1].url).toBe(`${BASE}/v1/auth/session`)

    const withBody = fake.calls[0].init.headers as Record<string, string>
    expect(SYNC_PROTOCOL_HEADER).toBe('x-sync-protocol')
    expect(withBody[SYNC_PROTOCOL_HEADER]).toBe(String(PROTOCOL_CURRENT))
    expect(withBody['Content-Type']).toBe('application/json')
    expect(withBody['Authorization']).toBe(`Bearer ${FAKE_TOKEN}`)
    expect(fake.calls[0].init.method).toBe('POST')
    expect(fake.calls[0].init.body).toBe(JSON.stringify({ username: 'u', password: 'p' }))

    const bare = fake.calls[1].init.headers as Record<string, string>
    expect(bare[SYNC_PROTOCOL_HEADER]).toBe(String(PROTOCOL_CURRENT))
    expect(bare['Content-Type']).toBeUndefined()
    expect(bare['Authorization']).toBeUndefined()
    expect(fake.calls[1].init.body).toBeUndefined()
  })

  it('默认超时是 10s（注入只是测试/上层改写用的缝）', () => {
    expect(CLOUD_TIMEOUT_MS).toBe(10_000)
  })
})

// ---------------------------------------------------------------- 成功路径

describe('transport 成功路径', () => {
  it('200 JSON → ok(true) 原样数据 + 一条 OK 事件', async () => {
    const { logger, events } = captureLogs()
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, { hello: 'world' })))
    const t = createTransport({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, logger })

    const data = expectOk(await t.request({ method: 'GET', path: '/v1/auth/session' }))
    expect(data).toEqual({ hello: 'world' })
    expect(events.length).toBe(1)
    expect(events[0].code).toBe('OK')
    expect(events[0].status).toBe(200)
    expect(events[0].method).toBe('GET')
    expect(events[0].path).toBe('/v1/auth/session')
  })

  it('204 → ok(null) 且根本不读 body（读一下就会炸，用来证明"没读"）', async () => {
    const res: HttpResponseLike = {
      ok: true,
      status: 204,
      text: async () => {
        throw new Error('204 must not be read')
      }
    }
    const fake = makeFetch(() => Promise.resolve(res))
    const t = createTransport({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50 })

    const data = expectOk(await t.request({ method: 'POST', path: '/v1/auth/logout', token: FAKE_TOKEN }))
    expect(data).toBe(null)
  })
})

// ---------------------------------------------------------------- 条件 GET 与 PUT（P10.4 加的）

describe('transport 条件 GET 与 PUT', () => {
  it('304 → ok(NOT_MODIFIED) 哨兵 + 一条 OK 事件，且根本不读 body', async () => {
    // 【为什么 304 必须是成功】Fetch 的 `res.ok` 对 304 是 false。少了这个分支，
    // 一次正常的缓存命中会掉进 !res.ok 被 statusToCode(304) 兜成 BAD_REQUEST ——
    // 「同步一切正常」却报一个请求形状错。这条断言就是那个分支的守门人。
    const { logger, events } = captureLogs()
    const res: HttpResponseLike = {
      ok: false, // 真 fetch 对 304 就是 false，夹具照实写（写成 true 就测不到真场景）
      status: 304,
      text: async () => {
        throw new Error('304 must not be read')
      }
    }
    const fake = makeFetch(() => Promise.resolve(res))
    const t = createTransport({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, logger })

    const data = expectOk(await t.request({ method: 'GET', path: '/v1/docs/profile', token: FAKE_TOKEN }))
    expect(data).toBe(NOT_MODIFIED)
    expect(events).toHaveLength(1)
    expect(events[0].code).toBe('OK')
    expect(events[0].status).toBe(304)
  })

  it('哨兵的唯一性：它不等于 null，也不等于任何"成功但没内容"', () => {
    // 塌成 null 的话，将来谁把 304 读成"204 那种成功"就静默丢一次同步
    expect(NOT_MODIFIED).not.toBe(null)
    expect(typeof NOT_MODIFIED).toBe('symbol')
  })

  it('ifNoneMatch 原样透传（引号归调用方拼，传输层不做任何规范化）', async () => {
    const fake = makeFetch(() => Promise.resolve(rawRes(304, '')))
    const t = createTransport({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50 })

    await t.request({ method: 'GET', path: '/v1/docs/profile', ifNoneMatch: '"7"' })
    expect((fake.calls[0].init.headers as Record<string, string>)['If-None-Match']).toBe('"7"')

    await t.request({ method: 'GET', path: '/v1/docs/profile' })
    expect((fake.calls[1].init.headers as Record<string, string>)['If-None-Match']).toBeUndefined()
  })

  it('PUT 与 POST 同款：有体发 Content-Type、体被 JSON.stringify、只发一次', async () => {
    const fake = makeFetch((_u, _i, i) => Promise.resolve(i === 0 ? errorRes(500, 'INTERNAL') : jsonRes(200, {})))
    const t = createTransport({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50 })

    const result = await t.request({
      method: 'PUT',
      path: '/v1/docs/practice',
      body: { docVer: 1, baseRevision: null, payload: { version: 1 } },
      token: FAKE_TOKEN
    })

    expect(expectFailure(result).code).toBe('INTERNAL')
    expect(fake.calls).toHaveLength(1) // 零重试对 PUT 同样成立
    expect(fake.calls[0].init.method).toBe('PUT')
    expect(fake.calls[0].init.body).toBe(JSON.stringify({ docVer: 1, baseRevision: null, payload: { version: 1 } }))
    const headers = fake.calls[0].init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['Authorization']).toBe(`Bearer ${FAKE_TOKEN}`)
  })

  it('**凭据旁路已封死**：运行期硬塞一个 headers 键进 spec，它一个字段都进不了真请求头', async () => {
    // 这条钉住的是"曾经有过的那个口"。TS 上 spec 已经没有 headers 字段了，
    // 但 JS 调用方/将来重构都可能再塞进来 —— 传输层从空对象起手，多出来的键一律忽略。
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, {})))
    const t = createTransport({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50 })

    const smuggled = {
      method: 'GET' as const,
      path: '/v1/docs/profile',
      headers: {
        Authorization: 'Bearer ms1_ATTACKERATTACKERATTACKERATTACKERATTACKER',
        'Content-Type': 'text/plain',
        'X-Evil': '1'
      }
    }
    await t.request(smuggled)

    const headers = fake.calls[0].init.headers as Record<string, string>
    expect(headers['Authorization']).toBeUndefined()
    expect(headers['Content-Type']).toBeUndefined()
    expect(headers['X-Evil']).toBeUndefined()
    // 协议头仍在（白名单里只有它，且由传输层自己写）
    expect(headers[SYNC_PROTOCOL_HEADER]).toBe(String(PROTOCOL_CURRENT))
  })
})

// ---------------------------------------------------------------- 超时与网络错误

describe('transport 超时与网络错误', () => {
  it('超时 → TIMEOUT（httpStatus null），发出的超时值就是注入值，只发一次', async () => {
    // 挂起式假 fetch（记账照做）
    const hanging = makeFetch(hangingFetch)
    const { logger, events } = captureLogs()
    const t = createTransport({ baseUrl: BASE, fetch: hanging.fetch, timeoutMs: 20, logger })

    const t0 = Date.now()
    const failure = expectFailure(await t.request({ method: 'POST', path: '/v1/auth/login', body: {} }))
    const elapsed = Date.now() - t0

    expect(failure.code).toBe('TIMEOUT')
    expect(failure.httpStatus).toBe(null)
    expect(failure.message).toBe('request timed out after 20ms')
    expect(hanging.calls.length).toBe(1)
    // 注入值是 20ms：若实现偷用默认 10s，这一条会拖到 10 秒并在这里见红
    expect(elapsed).toBeLessThan(3000)
    expect(events.length).toBe(1)
    expect(events[0].code).toBe('TIMEOUT')
    expect(events[0].status).toBe(null)
  })

  it('★ 响应头到了、体挂住 → 一样是 TIMEOUT（回归：计时器曾在读完体之前就缴械）', async () => {
    // 【这条守的是什么】真 fetch 的语义是"响应头到齐 = fetch() resolve"，
    // 体是随后流式读的。旧实现把 clearTimeout 挂在 fetch 那个 try 的 finally 上，
    // 头一到就把超时闸拆了 —— `res.text()` 阶段再没有任何兜底：服务端"头发了、
    // 体不发"（半开连接 / 坏代理），这一趟**永远挂住**，timeoutMs 形同虚设，
    // 重试表里「TIMEOUT 不重发」的裁定也根本没机会生效。
    // 修前这条会以 "Test timed out in 5000ms" 见红 —— 红本身就复现了挂死。
    const stalledBodyFetch: FetchLike = (_url, init) =>
      Promise.resolve({
        ok: true,
        status: 200,
        // 头即刻到达；体永远不来 —— 直到 signal 掐断（真 fetch 的体也会被一起掐，假货照做）
        text: () =>
          new Promise<string>((_resolve, reject) => {
            const abortErr = (): Error => {
              const err = new Error('The operation was aborted.')
              err.name = 'AbortError'
              return err
            }
            if (init.signal?.aborted) reject(abortErr())
            else init.signal?.addEventListener('abort', () => reject(abortErr()))
          })
      })
    const stalled = makeFetch(stalledBodyFetch)
    const { logger, events } = captureLogs()
    const t = createTransport({ baseUrl: BASE, fetch: stalled.fetch, timeoutMs: 20, logger })

    const t0 = Date.now()
    const failure = expectFailure(await t.request({ method: 'GET', path: '/v1/auth/session' }))
    const elapsed = Date.now() - t0

    expect(failure.code).toBe('TIMEOUT')
    expect(elapsed).toBeLessThan(3000) // 注入值是 20ms：偷用默认 10s 或挂死都会在这里见红
    expect(stalled.calls.length).toBe(1) // 读体超时同样不重发（TIMEOUT 不是 NETWORK）
    expect(failure.httpStatus).toBe(200) // 头已到：状态码是已知事实，带上供排查
    expect(events.length).toBe(1)
    expect(events[0].code).toBe('TIMEOUT')
  })

  it('我们自己的超时闸没响时，AbortError 形状的异常按 NETWORK 算（分辨靠旗标不靠名字）', async () => {
    const abortShapedFetch: FetchLike = () => {
      const err = new Error('The operation was aborted.')
      err.name = 'AbortError'
      return Promise.reject(err)
    }
    // 这条走的是 GET 的 NETWORK 重试路径（共 3 发）：sleep 注入零延迟假件，别真等 2.5s
    const t = createTransport({ baseUrl: BASE, fetch: abortShapedFetch, timeoutMs: 50, sleep: async () => {} })
    const failure = expectFailure(await t.request({ method: 'GET', path: '/v1/auth/session', token: FAKE_TOKEN }))
    expect(failure.code).toBe('NETWORK')
    expect(failure.httpStatus).toBe(null)
  })

  it('fetch 直接抛（断网）→ NETWORK，原文进 message 供排查', async () => {
    const refused: FetchLike = () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:8787'))
    const t = createTransport({ baseUrl: BASE, fetch: refused, timeoutMs: 50, sleep: async () => {} })
    const failure = expectFailure(await t.request({ method: 'GET', path: '/v1/auth/session' }))
    expect(failure.code).toBe('NETWORK')
    expect(failure.message).toContain('ECONNREFUSED')
  })
})

// ---------------------------------------------------------------- 重试表（P10.3 补齐 §3.7）

describe('重试分类表 retryPlanFor', () => {
  it('逐行查表：§3.7 七行 + docs/26 §4.8 两行；没点名的一律 0', () => {
    // GET * → 2；PUT /docs → 2（CAS 使重试安全）
    expect(retryPlanFor('GET', '/v1/auth/session')).toBe(2)
    expect(retryPlanFor('GET', '/v1/docs/profile')).toBe(2)
    expect(retryPlanFor('PUT', '/v1/docs/profile')).toBe(2)
    // login 连接错误 1 次；avatar（内容寻址幂等）1 次
    expect(retryPlanFor('POST', '/v1/auth/login')).toBe(1)
    expect(retryPlanFor('PUT', '/v1/avatar')).toBe(1)
    // 上行两条（docs/26 §4.8，靠 submissionId / entry_key 幂等）→ 2
    expect(retryPlanFor('POST', '/v1/challenge/days')).toBe(2)
    expect(retryPlanFor('POST', '/v1/rice/entries')).toBe(2)
    // 明令不重试 → 0（register 防重复注册；logout / delete 本地状态机为准）
    expect(retryPlanFor('POST', '/v1/auth/register')).toBe(0)
    expect(retryPlanFor('POST', '/v1/auth/logout')).toBe(0)
    expect(retryPlanFor('DELETE', '/v1/auth/account')).toBe(0)
    // 没点名的 path 保守 0：将来加新端点，不重试是默认，想开要显式进表
    expect(retryPlanFor('POST', '/v1/whatever')).toBe(0)
    expect(retryPlanFor('PUT', '/v1/whatever')).toBe(0)
  })
})

describe('重试行为：只重发 NETWORK，退避 0.5s/2s', () => {
  it('GET 断网 → 共 3 发（1+2）、退避恰为 [500, 2000]，最终失败回 NETWORK', async () => {
    const sleeps: number[] = []
    const { logger, events } = captureLogs()
    const fake = makeFetch(() => Promise.reject(new Error('ECONNREFUSED')))
    const t = createTransport({
      baseUrl: BASE,
      fetch: fake.fetch,
      timeoutMs: 50,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      logger
    })

    const failure = expectFailure(await t.request({ method: 'GET', path: '/v1/docs' }))
    expect(failure.code).toBe('NETWORK')
    expect(fake.calls.length).toBe(3) // 1 + 2 次重试
    // 精确退避序列（写死 500/2000 —— 它们就是 §3.7 的「0.5s/2s」，改常数必须在这里见红）
    expect(sleeps).toEqual([500, 2000])
    // 每次落网都留痕：三发三条 NETWORK 事件（每发各记各的耗时）
    expect(events.map((e) => e.code)).toEqual(['NETWORK', 'NETWORK', 'NETWORK'])
  })

  it('GET 先断后通 → 第二发成功返回，退避只走一档 [500]', async () => {
    const sleeps: number[] = []
    const { logger, events } = captureLogs()
    const fake = makeFetch((_u, _i, i) =>
      i === 0 ? Promise.reject(new Error('ECONNRESET')) : Promise.resolve(jsonRes(200, { ok: 1 }))
    )
    const t = createTransport({
      baseUrl: BASE,
      fetch: fake.fetch,
      timeoutMs: 50,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      logger
    })

    expect(expectOk(await t.request({ method: 'GET', path: '/v1/docs' }))).toEqual({ ok: 1 })
    expect(fake.calls.length).toBe(2)
    expect(sleeps).toEqual([500])
    expect(events.map((e) => e.code)).toEqual(['NETWORK', 'OK'])
  })

  it('最终失败 = 最后一次尝试的失败（三发三种错，回的是第三种）', async () => {
    const fake = makeFetch((_u, _i, i) => Promise.reject(new Error(`boom-${i}`)))
    const t = createTransport({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, sleep: async () => {} })
    const failure = expectFailure(await t.request({ method: 'GET', path: '/v1/docs' }))
    expect(failure.message).toContain('boom-2')
    expect(failure.message).not.toContain('boom-1')
  })

  it('★ 超时（TIMEOUT）不重发：GET 也一样 —— 表里 login 行把「超时」单拎出来，证明它是独立一类', async () => {
    const sleeps: number[] = []
    const hanging = makeFetch(hangingFetch)
    const t = createTransport({
      baseUrl: BASE,
      fetch: hanging.fetch,
      timeoutMs: 20,
      sleep: async (ms) => {
        sleeps.push(ms)
      }
    })
    const failure = expectFailure(await t.request({ method: 'GET', path: '/v1/docs' }))
    expect(failure.code).toBe('TIMEOUT')
    expect(hanging.calls.length).toBe(1)
    expect(sleeps).toEqual([])
  })

  it('★ 负控：GET 上的 HTTP 500 不重发（重试范围 = NETWORK，不是「一切失败」）', async () => {
    // sleep 一旦被调用就抛：实现若错误地把 HTTP 失败也纳入重试，这里立刻见红
    const fake = makeFetch(() => Promise.resolve(rawRes(500, 'oops')))
    const t = createTransport({
      baseUrl: BASE,
      fetch: fake.fetch,
      timeoutMs: 50,
      sleep: async () => {
        throw new Error('must not sleep')
      }
    })
    const failure = expectFailure(await t.request({ method: 'GET', path: '/v1/docs' }))
    expect(failure.code).toBe('INTERNAL')
    expect(fake.calls.length).toBe(1)
  })

  it('POST login 断网 → 重试 1 次（共 2 发、退避 [500]）', async () => {
    const sleeps: number[] = []
    const fake = makeFetch(() => Promise.reject(new Error('ECONNREFUSED')))
    const t = createTransport({
      baseUrl: BASE,
      fetch: fake.fetch,
      timeoutMs: 50,
      sleep: async (ms) => {
        sleeps.push(ms)
      }
    })
    const failure = expectFailure(await t.request({ method: 'POST', path: '/v1/auth/login', body: {} }))
    expect(failure.code).toBe('NETWORK')
    expect(fake.calls.length).toBe(2)
    expect(sleeps).toEqual([500])
  })

  it('PUT /v1/docs/:docType 断网 → 重试 2 次（CAS 使重试安全），先断两发后成功', async () => {
    const sleeps: number[] = []
    const fake = makeFetch((_u, _i, i) =>
      i < 2 ? Promise.reject(new Error('ECONNRESET')) : Promise.resolve(jsonRes(200, { revision: 2 }))
    )
    const t = createTransport({
      baseUrl: BASE,
      fetch: fake.fetch,
      timeoutMs: 50,
      sleep: async (ms) => {
        sleeps.push(ms)
      }
    })
    const data = expectOk(
      await t.request({
        method: 'PUT',
        path: '/v1/docs/profile',
        body: { docVer: 4, baseRevision: 1, payload: { version: 4 } },
        token: FAKE_TOKEN
      })
    )
    expect(data).toEqual({ revision: 2 })
    expect(fake.calls.length).toBe(3)
    expect(sleeps).toEqual([500, 2000])
  })

  it('PUT /v1/docs 撞 409（CONFLICT_STALE）→ 不重发，交给同步引擎「重拉重合并」', async () => {
    // sleep 一旦被调就抛（负控）：HTTP 答复永远不触发重发
    const fake = makeFetch(() => Promise.resolve(errorRes(409, 'CONFLICT_STALE')))
    const t = createTransport({
      baseUrl: BASE,
      fetch: fake.fetch,
      timeoutMs: 50,
      sleep: async () => {
        throw new Error('must not sleep')
      }
    })
    const failure = expectFailure(
      await t.request({ method: 'PUT', path: '/v1/docs/profile', body: {}, token: FAKE_TOKEN })
    )
    expect(failure.code).toBe('CONFLICT_STALE')
    expect(fake.calls.length).toBe(1)
  })

  it('POST /v1/rice/entries 断网 → 2 次重试（entry_key 幂等）；register 断网 0 次（对照）', async () => {
    const riceFetch = makeFetch(() => Promise.reject(new Error('ECONNRESET')))
    const t = createTransport({ baseUrl: BASE, fetch: riceFetch.fetch, timeoutMs: 50, sleep: async () => {} })
    expect(expectFailure(await t.request({ method: 'POST', path: '/v1/rice/entries', body: {} })).code).toBe('NETWORK')
    expect(riceFetch.calls.length).toBe(3)

    const regFetch = makeFetch(() => Promise.reject(new Error('ECONNRESET')))
    const t2 = createTransport({ baseUrl: BASE, fetch: regFetch.fetch, timeoutMs: 50, sleep: async () => {} })
    expect(expectFailure(await t2.request({ method: 'POST', path: '/v1/auth/register', body: {} })).code).toBe('NETWORK')
    expect(regFetch.calls.length).toBe(1)
  })
})

// ---------------------------------------------------------------- 不重试的硬要求（原「零重试」组）

describe('重试表：0 次的真的一次都不多发', () => {
  it('硬要求：POST register 脚本「先断网、后成功」，结果仍失败且只发一次', async () => {
    const fake = makeFetch((_url, _init, callIndex) =>
      callIndex === 0
        ? Promise.reject(new Error('ECONNRESET'))
        : Promise.resolve(jsonRes(201, { token: FAKE_TOKEN }))
    )
    const t = createTransport({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 100 })

    const failure = expectFailure(
      await t.request({ method: 'POST', path: '/v1/auth/register', body: { username: 'u', password: 'p' } })
    )
    expect(failure.code).toBe('NETWORK')
    // 重发会造重复账号 —— 第二次调用根本不存在的证明就是这一行
    expect(fake.calls.length).toBe(1)
  })

  it('HTTP 失败（500）不自动重发：脚本「先 500 后 200」只发一次（login 有 1 次计划也不例外）', async () => {
    // 选 login 是刻意的：它是有重试计划（1 次）的端点 —— 证明 HTTP 答复即使在
    // "有重试额度"的路上也不重发，重试范围严格 = NETWORK
    const fake = makeFetch((_url, _init, callIndex) =>
      callIndex === 0 ? Promise.resolve(rawRes(500, 'oops')) : Promise.resolve(jsonRes(200, {}))
    )
    const t = createTransport({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 100 })
    const failure = expectFailure(await t.request({ method: 'POST', path: '/v1/auth/login', body: {} }))
    expect(failure.code).toBe('INTERNAL')
    expect(fake.calls.length).toBe(1)
  })
})

// ---------------------------------------------------------------- 错误码映射

describe('transport 错误码映射', () => {
  it('错误体 code 与 HTTP 状态不一致时以 code 为准，原状态留在 httpStatus', async () => {
    const fake = makeFetch(() => Promise.resolve(errorRes(429, 'PROTOCOL_TOO_OLD')))
    const t = createTransport({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50 })
    const failure = expectFailure(await t.request({ method: 'GET', path: '/v1/auth/session' }))
    expect(failure.code).toBe('PROTOCOL_TOO_OLD')
    expect(failure.httpStatus).toBe(429)
    expect(failure.message).toBe('boom: PROTOCOL_TOO_OLD')
  })

  it('retryAfterMs 从错误体透传（429 提示等多久）', async () => {
    const fake = makeFetch(() => Promise.resolve(errorRes(429, 'RATE_LIMITED', { retryAfterMs: 2500 })))
    const t = createTransport({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50 })
    const failure = expectFailure(await t.request({ method: 'POST', path: '/v1/auth/login', body: {} }))
    expect(failure.code).toBe('RATE_LIMITED')
    expect(failure.retryAfterMs).toBe(2500)
  })

  it('错误体不可用（代理换掉响应体）→ 按状态码兜底：503 → DB_UNAVAILABLE', async () => {
    const fake = makeFetch(() => Promise.resolve(rawRes(503, '<html>gateway is sad</html>')))
    const t = createTransport({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50 })
    const failure = expectFailure(await t.request({ method: 'GET', path: '/v1/auth/session' }))
    expect(failure.code).toBe('DB_UNAVAILABLE')
    expect(failure.httpStatus).toBe(503)
    expect(failure.message).toContain('503')
  })

  it('错误体是 JSON 但 code 不认识 → 同样走状态码兜底', async () => {
    const fake = makeFetch(() =>
      Promise.resolve(rawRes(429, JSON.stringify({ error: { code: 'MADE_UP', message: 'x' } })))
    )
    const t = createTransport({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50 })
    const failure = expectFailure(await t.request({ method: 'POST', path: '/v1/auth/login', body: {} }))
    expect(failure.code).toBe('RATE_LIMITED')
  })

  it('409 无错误体 → 最泛的冲突码 CONFLICT_STALE（真服务端的 409 一定带具体 code）', async () => {
    const fake = makeFetch(() => Promise.resolve(rawRes(409, 'nope')))
    const t = createTransport({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50 })
    const failure = expectFailure(await t.request({ method: 'POST', path: '/v1/auth/register', body: {} }))
    expect(failure.code).toBe('CONFLICT_STALE')
  })

  it('statusToCode 与 protocol 的 HTTP_STATUS_BY_CODE 对拍（11 个登记状态自洽）', () => {
    const canonical = [400, 401, 403, 404, 409, 413, 415, 426, 429, 500, 503]
    for (const status of canonical) {
      expect(HTTP_STATUS_BY_CODE[statusToCode(status)]).toBe(status)
    }
    // 没登记的：5xx 归内部错误，其余按请求形状错
    expect(statusToCode(418)).toBe('BAD_REQUEST')
    expect(statusToCode(302)).toBe('BAD_REQUEST')
    expect(statusToCode(599)).toBe('INTERNAL')
  })

  it('2xx 但不是 JSON → MALFORMED_RESPONSE（不把半截东西当成功）', async () => {
    const fake = makeFetch(() => Promise.resolve(rawRes(200, 'not json at all')))
    const t = createTransport({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50 })
    const failure = expectFailure(await t.request({ method: 'GET', path: '/v1/auth/session' }))
    expect(failure.code).toBe('MALFORMED_RESPONSE')
    expect(failure.httpStatus).toBe(200)
  })
})

// ---------------------------------------------------------------- 未配置

describe('transport 未配置', () => {
  it('baseUrl 空串 → NOT_CONFIGURED，一个包都不发', async () => {
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, {})))
    const { logger, events } = captureLogs()
    const t = createTransport({ baseUrl: '', fetch: fake.fetch, timeoutMs: 50, logger })
    const failure = expectFailure(await t.request({ method: 'POST', path: '/v1/auth/login', body: {} }))
    expect(failure.code).toBe('NOT_CONFIGURED')
    expect(failure.httpStatus).toBe(null)
    expect(fake.calls.length).toBe(0)
    expect(events.length).toBe(1)
    expect(events[0].code).toBe('NOT_CONFIGURED')
    expect(events[0].status).toBe(null)
  })
})

// ---------------------------------------------------------------- 凭据纪律（token 不进日志/错误信息）

describe('transport 凭据纪律', () => {
  it('日志事件的字段是白名单：没有 headers / body / token', async () => {
    const { logger, events } = captureLogs()
    const fake = makeFetch((_url, _init, callIndex) =>
      callIndex === 0
        ? Promise.resolve(jsonRes(200, { token: FAKE_TOKEN }))
        : Promise.resolve(rawRes(500, 'oops'))
    )
    const t = createTransport({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, logger })
    await t.request({
      method: 'POST',
      path: '/v1/auth/login',
      body: { username: 'u', password: 'hunter2' },
      token: FAKE_TOKEN
    })
    await t.request({ method: 'GET', path: '/v1/auth/session', token: FAKE_TOKEN })

    expect(events.length).toBe(2)
    // 结构断言：将来有人往事件里加 token/headers 字段，这一行当场红
    expect(Object.keys(events[0]).sort()).toEqual(['code', 'durationMs', 'method', 'path', 'status'])
    const flat = JSON.stringify(events)
    expect(flat).not.toContain(FAKE_TOKEN)
    expect(flat).not.toContain('Zk7Q')
    expect(flat).not.toContain('hunter2')
    expect(flat).not.toContain('Bearer')
    expect(flat).not.toContain('Authorization')
  })

  it('尺子自检（阴性对照）：故意往事件里塞 token 的话，同一判据会命中它', () => {
    // 这是"种坏见红"的对照样本 —— 证明上面的 not.toContain 真在量东西。
    // 如果哪天有人把日志事件改宽了，用下面这个形状的捕获器就能看见 token：
    const leaky: { method: string; diary: string }[] = [
      { method: 'POST', diary: `Authorization: Bearer ${FAKE_TOKEN}` }
    ]
    expect(JSON.stringify(leaky)).toContain(FAKE_TOKEN)
  })

  it('fetch 抛的异常原文里带 token 也会被抹掉（[redacted]）', async () => {
    const raw = `proxy said: Bearer ${FAKE_TOKEN} is bad`
    // 对照：这条原文确实含 token（不抹的话下面的断言会红）
    expect(raw).toContain(FAKE_TOKEN)
    const leakingFetch: FetchLike = () => Promise.reject(new Error(raw))
    // GET 断网会重试 2 次：零延迟假件，别真等 2.5s
    const t = createTransport({ baseUrl: BASE, fetch: leakingFetch, timeoutMs: 50, sleep: async () => {} })
    const failure = expectFailure(await t.request({ method: 'GET', path: '/v1/auth/session', token: FAKE_TOKEN }))
    expect(failure.code).toBe('NETWORK')
    expect(failure.message).not.toContain(FAKE_TOKEN)
    expect(failure.message).toContain('[redacted]')
  })

  it('服务端错误体 message 里带 token 也会被抹掉', async () => {
    const fake = makeFetch(() =>
      Promise.resolve(rawRes(400, JSON.stringify({ error: { code: 'BAD_REQUEST', message: `bad Bearer ${FAKE_TOKEN}`, requestId: 'r' } })))
    )
    const t = createTransport({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50 })
    const failure = expectFailure(await t.request({ method: 'POST', path: '/v1/auth/logout', token: FAKE_TOKEN }))
    expect(failure.code).toBe('BAD_REQUEST')
    expect(failure.message).not.toContain(FAKE_TOKEN)
    expect(failure.message).toContain('[redacted]')
  })

  it('默认 logger：失败打 console.warn（白名单事件），成功不打', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const okT = createTransport({
        baseUrl: BASE,
        fetch: makeFetch(() => Promise.resolve(jsonRes(200, {}))).fetch,
        timeoutMs: 50
      })
      await okT.request({ method: 'GET', path: '/v1/auth/session' })
      expect(warn).not.toHaveBeenCalled()

      const failT = createTransport({
        baseUrl: BASE,
        fetch: makeFetch(() => Promise.resolve(rawRes(500, 'oops'))).fetch,
        timeoutMs: 50
      })
      await failT.request({ method: 'GET', path: '/v1/auth/session' })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toBe('[miai] cloud request failed')
      expect(JSON.stringify(warn.mock.calls[0])).not.toContain('Bearer')
    } finally {
      warn.mockRestore()
    }
  })
})

// ---------------------------------------------------------------- 二进制口（头像）

describe('transport 二进制请求 / 响应（2026-10-22 头像链路）', () => {
  const BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x7f])

  /** 二进制成功体：text() 故意抛 —— 走错读法会立刻见红 */
  function binaryRes(bytes: Uint8Array, contentType: string | null = 'image/png'): HttpResponseLike {
    return {
      ok: true,
      status: 200,
      text: async () => {
        throw new Error('binary body must not be read as text')
      },
      arrayBuffer: async () => Uint8Array.from(bytes).buffer,
      headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) }
    }
  }

  it('requestBytes：GET 原样回字节 + content-type，不走 text()', async () => {
    const fake = makeFetch(() => Promise.resolve(binaryRes(BYTES)))
    const t = createTransport({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50 })

    const data = expectOk(
      await t.requestBytes({ method: 'GET', path: '/v1/avatar/' + 'a'.repeat(64), token: FAKE_TOKEN })
    )
    expect(data.contentType).toBe('image/png')
    expect(Buffer.from(data.bytes).equals(Buffer.from(BYTES))).toBe(true)
    expect(fake.calls[0].url).toBe(`${BASE}/v1/avatar/${'a'.repeat(64)}`)
    const headers = fake.calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${FAKE_TOKEN}`)
    expect(headers[SYNC_PROTOCOL_HEADER]).toBe(String(PROTOCOL_CURRENT))
  })

  it('二进制响应没有 arrayBuffer 读口：MALFORMED_RESPONSE（不猜内容）', async () => {
    const fake = makeFetch(() =>
      Promise.resolve({ ok: true, status: 200, text: async () => 'not used' })
    )
    const t = createTransport({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50 })
    const failure = expectFailure(await t.requestBytes({ method: 'GET', path: '/v1/avatar/x' }))
    expect(failure.code).toBe('MALFORMED_RESPONSE')
    expect(failure.httpStatus).toBe(200)
  })

  it('二进制端点的**错误体仍是 JSON**：按 text 读并映射成码', async () => {
    const fake = makeFetch(() => Promise.resolve(errorRes(404, 'NOT_FOUND')))
    const t = createTransport({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50 })
    const failure = expectFailure(await t.requestBytes({ method: 'GET', path: '/v1/avatar/x' }))
    expect(failure.code).toBe('NOT_FOUND')
    expect(failure.httpStatus).toBe(404)
  })

  it('二进制响应缺 headers：contentType 回 null（不炸）', async () => {
    const fake = makeFetch(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => '',
        arrayBuffer: async () => Uint8Array.from(BYTES).buffer
      })
    )
    const t = createTransport({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50 })
    const data = expectOk(await t.requestBytes({ method: 'GET', path: '/v1/avatar/x' }))
    expect(data.contentType).toBe(null)
    expect(Buffer.from(data.bytes).equals(Buffer.from(BYTES))).toBe(true)
  })

  it('bodyBytes：原始字节原样进 body，Content-Type 用显式值；不给就 octet-stream', async () => {
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, { hash: 'h' })))
    const t = createTransport({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50 })

    await t.request({
      method: 'PUT',
      path: '/v1/avatar',
      bodyBytes: BYTES,
      contentType: 'image/png',
      token: FAKE_TOKEN
    })
    await t.request({ method: 'PUT', path: '/v1/avatar', bodyBytes: BYTES })

    const first = fake.calls[0].init
    expect((first.headers as Record<string, string>)['Content-Type']).toBe('image/png')
    // 同一份字节，不是 JSON.stringify / base64 字符串
    expect(Buffer.from(first.body as Uint8Array).equals(Buffer.from(BYTES))).toBe(true)

    const second = fake.calls[1].init
    expect((second.headers as Record<string, string>)['Content-Type']).toBe('application/octet-stream')
    expect(Buffer.from(second.body as Uint8Array).equals(Buffer.from(BYTES))).toBe(true)
  })
})
