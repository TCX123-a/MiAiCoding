/**
 * 头像客户端（main/cloud/avatar.ts，2026-10-22 用户系统批次）单测 —— 零网络。
 *
 * 【这个文件在守什么】
 *   ① 上传前**本地三道闸**：没登录 / 空字节 / 非 PNG / >512KB 一律不发包；
 *   ② 上传走的是**原始字节**（bodyBytes + image/png），不是 JSON；
 *   ③ 服务端回的 hash 必须与本地 sha256 对拍 —— 对不上按 MALFORMED_RESPONSE，
 *      **绝不**把错 hash 写进会话（否则用户会看到别人的头像）；
 *   ④ 读口是二进制：成功体必须走 arrayBuffer（text() 会把 PNG 读坏）；
 *      同一 hash 第二次直接命中内存缓存，不再发包；
 *   ⑤ 任何失败都是 CloudResult 的值，不抛。
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createMemoryTokenStore, type TokenStore } from '../account'
import { createCloudAvatarClient } from '../avatar'
import { AVATAR_MAX_BYTES } from '../../../shared/cloud/protocol'
import type { CloudFailure, CloudResult } from '../../../shared/cloud/dto'
import type { FetchLike, HttpResponseLike } from '../transport'

const BASE = 'http://127.0.0.1:8787'
/** 形状合法的假令牌（ms1_ + 43 个 base64url 字符） */
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

function errorRes(status: number, code: string): HttpResponseLike {
  return {
    ok: false,
    status,
    text: async () => JSON.stringify({ error: { code, message: code, requestId: 'req_test' } })
  }
}

/** 二进制成功体：text() 故意抛 —— 实现若走错读法会立刻见红 */
function binaryRes(bytes: Uint8Array, contentType = 'image/png'): HttpResponseLike {
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

/** 1×1 PNG 的**真实字节**（内容不重要，签字要对） */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** 令牌 store + 资料快照捕获口（updateProfile 是可选的 —— 这里必须真的在） */
function tokensWithProfileCapture(): { tokens: TokenStore; patches: Array<{ username?: string; avatarHash?: string | null }> } {
  const tokens = createMemoryTokenStore(FAKE_TOKEN)
  const patches: Array<{ username?: string; avatarHash?: string | null }> = []
  tokens.updateProfile = (patch) => patches.push(patch)
  return { tokens, patches }
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

// ---------------------------------------------------------------- 上传

describe('avatar.upload —— 本地闸门与原始字节', () => {
  it('没登录：UNAUTHENTICATED，不发包', async () => {
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, { hash: sha256Hex(PNG_1X1) })))
    const client = createCloudAvatarClient({
      baseUrl: BASE,
      fetch: fake.fetch,
      timeoutMs: 50,
      tokens: createMemoryTokenStore()
    })
    expect(expectFailure(await client.upload(PNG_1X1)).code).toBe('UNAUTHENTICATED')
    expect(fake.calls.length).toBe(0)
  })

  it('空字节 / 非 PNG / 超过 512KB：各自的码，全部不发包', async () => {
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, { hash: sha256Hex(PNG_1X1) })))
    const client = createCloudAvatarClient({
      baseUrl: BASE,
      fetch: fake.fetch,
      timeoutMs: 50,
      tokens: createMemoryTokenStore(FAKE_TOKEN)
    })

    expect(expectFailure(await client.upload(new Uint8Array(0))).code).toBe('UNSUPPORTED_MEDIA_TYPE')
    expect(expectFailure(await client.upload(new TextEncoder().encode('not a png'))).code).toBe(
      'UNSUPPORTED_MEDIA_TYPE'
    )
    // 签名对但超体积：头 8 字节是 PNG，后面补齐到上限 +1
    const huge = new Uint8Array(AVATAR_MAX_BYTES + 1)
    huge.set(PNG_1X1.subarray(0, 8))
    expect(expectFailure(await client.upload(huge)).code).toBe('PAYLOAD_TOO_LARGE')
    expect(fake.calls.length).toBe(0)
  })

  it('成功：PUT /v1/avatar、image/png、原始字节原样、hash 对拍、资料快照同步', async () => {
    const hash = sha256Hex(PNG_1X1)
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, { hash })))
    const { tokens, patches } = tokensWithProfileCapture()
    const client = createCloudAvatarClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    const data = expectOk(await client.upload(PNG_1X1))
    expect(data).toEqual({ hash })
    expect(fake.calls.length).toBe(1)
    expect(fake.calls[0].url).toBe(`${BASE}/v1/avatar`)
    expect(fake.calls[0].init.method).toBe('PUT')
    const headers = fake.calls[0].init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('image/png')
    expect(headers.Authorization).toBe(`Bearer ${FAKE_TOKEN}`)
    // body 必须是**同一份字节**（不是 JSON、不是 base64、不是拷坏的副本）
    expect(Buffer.from(fake.calls[0].init.body as Uint8Array).equals(PNG_1X1)).toBe(true)
    expect(patches).toEqual([{ avatarHash: hash }])
  })

  it('服务端回错 hash（与本地 sha256 不符）：MALFORMED_RESPONSE，资料快照不许被污染', async () => {
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, { hash: 'a'.repeat(64) })))
    const { tokens, patches } = tokensWithProfileCapture()
    const client = createCloudAvatarClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    expect(expectFailure(await client.upload(PNG_1X1)).code).toBe('MALFORMED_RESPONSE')
    expect(patches).toEqual([])
  })

  it('回话缺 hash / hash 形状非法：MALFORMED_RESPONSE', async () => {
    for (const body of [{}, { hash: 'not-hex' }, { hash: 123 }]) {
      const fake = makeFetch(() => Promise.resolve(jsonRes(200, body)))
      const { tokens, patches } = tokensWithProfileCapture()
      const client = createCloudAvatarClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })
      expect(expectFailure(await client.upload(PNG_1X1)).code).toBe('MALFORMED_RESPONSE')
      expect(patches).toEqual([])
    }
  })

  it('HTTP 错误原样上抛（429 RATE_LIMITED），不吞成成功', async () => {
    const fake = makeFetch(() => Promise.resolve(errorRes(429, 'RATE_LIMITED')))
    const { tokens, patches } = tokensWithProfileCapture()
    const client = createCloudAvatarClient({ baseUrl: BASE, fetch: fake.fetch, timeoutMs: 50, tokens })

    const failure = expectFailure(await client.upload(PNG_1X1))
    expect(failure.code).toBe('RATE_LIMITED')
    expect(failure.httpStatus).toBe(429)
    expect(patches).toEqual([])
  })
})

// ---------------------------------------------------------------- 读取

describe('avatar.read —— 二进制读口与内容寻址缓存', () => {
  it('hash 形状非法：NOT_FOUND，不发包（不是去问服务端）', async () => {
    const fake = makeFetch(() => Promise.resolve(binaryRes(PNG_1X1)))
    const client = createCloudAvatarClient({
      baseUrl: BASE,
      fetch: fake.fetch,
      timeoutMs: 50,
      tokens: createMemoryTokenStore(FAKE_TOKEN)
    })
    for (const bad of ['', 'abc', 'A'.repeat(64), 'g'.repeat(64)]) {
      expect(expectFailure(await client.read(bad)).code).toBe('NOT_FOUND')
    }
    expect(fake.calls.length).toBe(0)
  })

  it('没登录：UNAUTHENTICATED，不发包', async () => {
    const fake = makeFetch(() => Promise.resolve(binaryRes(PNG_1X1)))
    const client = createCloudAvatarClient({
      baseUrl: BASE,
      fetch: fake.fetch,
      timeoutMs: 50,
      tokens: createMemoryTokenStore()
    })
    const hash = sha256Hex(PNG_1X1)
    expect(expectFailure(await client.read(hash)).code).toBe('UNAUTHENTICATED')
    expect(fake.calls.length).toBe(0)
  })

  it('成功：GET /v1/avatar/<hash>、走 arrayBuffer、data URL 的字节与原图全等', async () => {
    const hash = sha256Hex(PNG_1X1)
    const fake = makeFetch(() => Promise.resolve(binaryRes(PNG_1X1)))
    const client = createCloudAvatarClient({
      baseUrl: BASE,
      fetch: fake.fetch,
      timeoutMs: 50,
      tokens: createMemoryTokenStore(FAKE_TOKEN)
    })

    const data = expectOk(await client.read(hash))
    expect(fake.calls.length).toBe(1)
    expect(fake.calls[0].url).toBe(`${BASE}/v1/avatar/${hash}`)
    expect(fake.calls[0].init.method).toBe('GET')
    const headers = fake.calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${FAKE_TOKEN}`)
    const prefix = 'data:image/png;base64,'
    expect(data.dataUrl.startsWith(prefix)).toBe(true)
    expect(Buffer.from(data.dataUrl.slice(prefix.length), 'base64').equals(PNG_1X1)).toBe(true)
  })

  it('同一 hash 第二次：命中内存缓存，不发第二个包', async () => {
    const hash = sha256Hex(PNG_1X1)
    const fake = makeFetch(() => Promise.resolve(binaryRes(PNG_1X1)))
    const client = createCloudAvatarClient({
      baseUrl: BASE,
      fetch: fake.fetch,
      timeoutMs: 50,
      tokens: createMemoryTokenStore(FAKE_TOKEN)
    })

    const first = expectOk(await client.read(hash))
    const second = expectOk(await client.read(hash))
    expect(second.dataUrl).toBe(first.dataUrl)
    expect(fake.calls.length).toBe(1)
  })

  it('上传成功后顺手入缓存：立刻读同一个 hash 不再发 GET', async () => {
    const hash = sha256Hex(PNG_1X1)
    const fake = makeFetch(() => Promise.resolve(jsonRes(200, { hash })))
    const client = createCloudAvatarClient({
      baseUrl: BASE,
      fetch: fake.fetch,
      timeoutMs: 50,
      tokens: createMemoryTokenStore(FAKE_TOKEN)
    })

    expectOk(await client.upload(PNG_1X1))
    const data = expectOk(await client.read(hash))
    expect(data.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(fake.calls.length).toBe(1) // 只有那次 PUT
  })

  it('服务端回的 PNG 与 hash 不符：MALFORMED_RESPONSE（读口也做内容寻址对拍）', async () => {
    const hash = sha256Hex(PNG_1X1)
    // 仍是合法 PNG 签名（过 magic），但字节不是这个 hash 的 —— 例如服务端缓存串号
    const otherPng = new Uint8Array([...PNG_1X1, 0x00])
    const fake = makeFetch(() => Promise.resolve(binaryRes(otherPng)))
    const client = createCloudAvatarClient({
      baseUrl: BASE,
      fetch: fake.fetch,
      timeoutMs: 50,
      tokens: createMemoryTokenStore(FAKE_TOKEN)
    })
    expect(expectFailure(await client.read(hash)).code).toBe('MALFORMED_RESPONSE')
  })

  it('服务端回了非 PNG 字节：MALFORMED_RESPONSE（不把 HTML 错误页当图片）', async () => {
    const hash = sha256Hex(PNG_1X1)
    const fake = makeFetch(() =>
      Promise.resolve(binaryRes(new TextEncoder().encode('<html>oops</html>')))
    )
    const client = createCloudAvatarClient({
      baseUrl: BASE,
      fetch: fake.fetch,
      timeoutMs: 50,
      tokens: createMemoryTokenStore(FAKE_TOKEN)
    })
    expect(expectFailure(await client.read(hash)).code).toBe('MALFORMED_RESPONSE')
  })

  it('404 → NOT_FOUND；401 → UNAUTHENTICATED（都是值，不抛）', async () => {
    const hash = sha256Hex(PNG_1X1)
    for (const [status, code] of [
      [404, 'NOT_FOUND'],
      [401, 'UNAUTHENTICATED']
    ] as const) {
      const fake = makeFetch(() => Promise.resolve(errorRes(status, code)))
      const client = createCloudAvatarClient({
        baseUrl: BASE,
        fetch: fake.fetch,
        timeoutMs: 50,
        tokens: createMemoryTokenStore(FAKE_TOKEN)
      })
      const failure = expectFailure(await client.read(hash))
      expect(failure.code).toBe(code)
      expect(failure.httpStatus).toBe(status)
    }
  })
})
