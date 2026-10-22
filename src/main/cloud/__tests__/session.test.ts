/**
 * session.bin 单测（P10.1）—— 启动扫描七条铁律 + 读写协议，全部离线。
 *
 * 【为什么这块必须逐条钉死】session.bin 是「谁是当前账号」的唯一凭据来源：
 * 判宽了 = 拿别人的令牌上网（串号）；判严了 / 删多了 = 用户莫名登出、
 * 甚至档案被打散。所以每条分支都有专门用例，且**「删没删」一律用 existsSync
 * 直接验磁盘** —— 只看返回值会把「没删」当成「删了」，这是本文件最能骗人的地方。
 *
 * 假 safeStorage：把明文 base64 包一层（不是加密，但足以断言「落盘的不是明文」），
 * 可配置成解密抛异常 / 加密不可用两种故障。真 DPAPI 一次都不碰。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearSessionFile,
  parseSessionPlaintext,
  scanSessionFiles,
  writeSessionFile,
  type SafeStorageLike,
  type SessionScanResult,
  type StoredSession
} from '../session'

// ---------------------------------------------------------------- 夹具

/** 形状合法的假令牌（ms1_ + 43 个 base64url 字符，过 protocol 的 TOKEN_REGEX） */
const FAKE_TOKEN = 'ms1_' + 'Zk7Q'.repeat(10) + 'abc'

const ACC_A = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d'
const ACC_B = 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e'
const ACC_A_UPPER = ACC_A.toUpperCase()

interface FakeSafeOptions {
  /** false = 模拟 safeStorage 不可用（isEncryptionAvailable 恒 false） */
  available?: boolean
  /** true = 解密抛异常（模拟 DPAPI 换了用户 / 文件被截断） */
  decryptThrows?: boolean
}

/**
 * 假 safeStorage。密文 = `enc:` + 明文的 base64 —— 可逆、可篡改，
 * 好让「落盘 ≠ 明文」和「解密抛」两条都能离线断言。
 */
function makeSafe(opts: FakeSafeOptions = {}): SafeStorageLike {
  return {
    isEncryptionAvailable: () => opts.available ?? true,
    encryptString: (plainText) => Buffer.from(`enc:${Buffer.from(plainText, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (encrypted) => {
      if (opts.decryptThrows === true) throw new Error('decrypt failed')
      const raw = encrypted.toString('utf8')
      if (!raw.startsWith('enc:')) throw new Error('not a ciphertext')
      return Buffer.from(raw.slice(4), 'base64').toString('utf8')
    }
  }
}

function makeSession(sub: string): StoredSession {
  return {
    v: 1,
    sub,
    token: FAKE_TOKEN,
    issuedAt: '2026-10-10T00:00:00.000Z',
    expiresAt: '2026-11-09T00:00:00.000Z'
  }
}

/**
 * 绕过写口、直接往磁盘放一份 session.bin（内容任意）。
 * 测的是扫描协议 —— 夹具必须能造出写口根本不许写出来的坏文件。
 */
function plantSessionFile(root: string, dirName: string, plaintext: string, safe: SafeStorageLike): string {
  const dir = join(root, 'accounts', dirName)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'session.bin')
  writeFileSync(file, safe.encryptString(plaintext))
  return file
}

/** 临时根目录现造现拆（每个用例一个，互不串） */
const roots: string[] = []
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'miai-session-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 收窄 active 结果（kind 不匹配直接红，不靠类型断言蒙混） */
function expectActive(result: SessionScanResult): { accountId: string; session: StoredSession } {
  expect(result.kind).toBe('active')
  if (result.kind !== 'active') throw new Error('expected an active session')
  return result
}

// ---------------------------------------------------------------- 扫描协议

describe('scanSessionFiles 启动扫描协议', () => {
  it('① 没有 accounts 目录 ⇒ guest，且扫描本身不建任何东西', () => {
    const root = makeRoot()
    expect(scanSessionFiles(root, makeSafe())).toEqual({ kind: 'guest' })
    expect(existsSync(join(root, 'accounts'))).toBe(false)
  })

  it('② 有账号目录但没有 session.bin ⇒ guest', () => {
    const root = makeRoot()
    mkdirSync(join(root, 'accounts', ACC_A), { recursive: true })
    expect(scanSessionFiles(root, makeSafe())).toEqual({ kind: 'guest' })
  })

  it('③ 恰好一份且 sub 与目录名一致 ⇒ active（accountId 为小写、内容逐字段对上、文件保留）', () => {
    const root = makeRoot()
    const safe = makeSafe()
    const file = plantSessionFile(root, ACC_A, JSON.stringify(makeSession(ACC_A)), safe)

    const active = expectActive(scanSessionFiles(root, safe))
    expect(active.accountId).toBe(ACC_A)
    expect(active.session).toEqual(makeSession(ACC_A))
    expect(existsSync(file)).toBe(true)
  })

  it('④ sub 与目录名不符 ⇒ guest，且该 session.bin 已被删除（防串号）', () => {
    const root = makeRoot()
    const safe = makeSafe()
    const file = plantSessionFile(root, ACC_A, JSON.stringify(makeSession(ACC_B)), safe)

    expect(scanSessionFiles(root, safe)).toEqual({ kind: 'guest' })
    expect(existsSync(file)).toBe(false)
    // 只清 session.bin：账号目录本身还在
    expect(existsSync(join(root, 'accounts', ACC_A))).toBe(true)
  })

  it('⑤ 两份 session.bin ⇒ 全部删除 ⇒ guest（账号目录与其中的邻居文件一个字节不动）', () => {
    const root = makeRoot()
    const safe = makeSafe()
    const fileA = plantSessionFile(root, ACC_A, JSON.stringify(makeSession(ACC_A)), safe)
    const fileB = plantSessionFile(root, ACC_B, JSON.stringify(makeSession(ACC_B)), safe)
    const sibling = join(root, 'accounts', ACC_A, 'profile.json')
    writeFileSync(sibling, '{}')

    expect(scanSessionFiles(root, safe)).toEqual({ kind: 'guest' })
    expect(existsSync(fileA)).toBe(false)
    expect(existsSync(fileB)).toBe(false)
    expect(existsSync(sibling)).toBe(true)
    expect(existsSync(join(root, 'accounts', ACC_B))).toBe(true)
  })

  it('⑥ 解密抛异常 ⇒ guest，且文件仍在（不删数据、不丢证据）', () => {
    const root = makeRoot()
    const file = plantSessionFile(root, ACC_A, JSON.stringify(makeSession(ACC_A)), makeSafe())

    expect(scanSessionFiles(root, makeSafe({ decryptThrows: true }))).toEqual({ kind: 'guest' })
    expect(existsSync(file)).toBe(true)
  })

  it('⑥b 解密成功但解析回 null（坏 JSON / 坏形状）⇒ guest，且文件仍在', () => {
    for (const plaintext of ['{not json', JSON.stringify({ v: 2, sub: ACC_A }), JSON.stringify('a string')]) {
      const root = makeRoot()
      const safe = makeSafe()
      const file = plantSessionFile(root, ACC_A, plaintext, safe)

      expect(scanSessionFiles(root, safe)).toEqual({ kind: 'guest' })
      expect(existsSync(file)).toBe(true)
    }
  })

  it('⑦ safeStorage 不可用 ⇒ 扫描 guest 且文件不动；写口回 false 且一个字节都不落盘', () => {
    const root = makeRoot()
    const safe = makeSafe()
    const file = plantSessionFile(root, ACC_A, JSON.stringify(makeSession(ACC_A)), safe)
    const unavailable = makeSafe({ available: false })

    expect(scanSessionFiles(root, unavailable)).toEqual({ kind: 'guest' })
    expect(existsSync(file)).toBe(true)

    const freshRoot = makeRoot()
    expect(writeSessionFile(freshRoot, makeSession(ACC_A), unavailable)).toBe(false)
    expect(readdirSync(freshRoot)).toEqual([])
    expect(existsSync(join(freshRoot, 'accounts'))).toBe(false)
  })

  it('⑩ 非 UUID 目录被整体跳过：不算份数、不删里面任何东西、也不破坏正常的 active', () => {
    // (a) 只有非 UUID 目录（哪怕里面躺着"看起来对"的 session.bin）⇒ guest，文件仍在
    const root = makeRoot()
    const safe = makeSafe()
    const lone = plantSessionFile(root, 'not-a-uuid', JSON.stringify(makeSession(ACC_A)), safe)

    expect(scanSessionFiles(root, safe)).toEqual({ kind: 'guest' })
    expect(existsSync(lone)).toBe(true)

    // (b) 非 UUID 目录 + 恰好一份合法 ⇒ 仍是 active（脏目录不计份数，不触发"多份全清"）
    const root2 = makeRoot()
    const good = plantSessionFile(root2, ACC_A, JSON.stringify(makeSession(ACC_A)), safe)
    const junk = plantSessionFile(root2, 'legacy-backup', JSON.stringify(makeSession(ACC_B)), safe)

    const active = expectActive(scanSessionFiles(root2, safe))
    expect(active.accountId).toBe(ACC_A)
    expect(existsSync(good)).toBe(true)
    expect(existsSync(junk)).toBe(true)
  })

  it('⑪ 目录名大写、sub 小写 ⇒ active 且 accountId 归一为小写', () => {
    const root = makeRoot()
    const safe = makeSafe()
    const file = plantSessionFile(root, ACC_A_UPPER, JSON.stringify(makeSession(ACC_A)), safe)

    const active = expectActive(scanSessionFiles(root, safe))
    expect(active.accountId).toBe(ACC_A)
    expect(active.accountId).not.toBe(ACC_A_UPPER)
    expect(active.session.sub).toBe(ACC_A)
    expect(existsSync(file)).toBe(true)
  })
})

// ---------------------------------------------------------------- 写口

describe('writeSessionFile 落盘协议', () => {
  it('⑧ 正常往返：写完 scan 读出同一 session；落盘内容不是明文；目录里只有这一个文件', () => {
    const root = makeRoot()
    const safe = makeSafe()
    const session = makeSession(ACC_A)

    expect(writeSessionFile(root, session, safe)).toBe(true)
    const active = expectActive(scanSessionFiles(root, safe))
    expect(active.accountId).toBe(ACC_A)
    expect(active.session).toEqual(session)
    // 原子写不留渣：没有 .tmp 残留
    expect(readdirSync(join(root, 'accounts', ACC_A))).toEqual(['session.bin'])
    // 凭据纪律的落盘侧：文件里没有明文 JSON（token 原文当然也不在）
    const onDisk = readFileSync(join(root, 'accounts', ACC_A, 'session.bin')).toString('utf8')
    expect(onDisk).not.toContain(FAKE_TOKEN)
    expect(onDisk).not.toContain('"token"')
  })

  it('⑨ writeSessionFile 坏 sub（../evil）⇒ 抛 TypeError，且目录里外都没有文件被建', () => {
    const root = makeRoot()
    const safe = makeSafe()
    const evil = { ...makeSession(ACC_A), sub: '../evil' }

    expect(() => writeSessionFile(root, evil, safe)).toThrow(TypeError)
    expect(readdirSync(root)).toEqual([])
    expect(existsSync(join(root, 'evil'))).toBe(false)
    expect(existsSync(join(root, 'accounts'))).toBe(false)
  })

  it('坏入参（v≠1 / 空 token / 空时间戳）⇒ TypeError，且一个字节不落盘', () => {
    const root = makeRoot()
    const safe = makeSafe()
    const wrongVersion = { ...makeSession(ACC_A), v: 2 } as unknown as StoredSession

    expect(() => writeSessionFile(root, wrongVersion, safe)).toThrow(TypeError)
    expect(() => writeSessionFile(root, { ...makeSession(ACC_A), token: '' }, safe)).toThrow(TypeError)
    expect(() => writeSessionFile(root, { ...makeSession(ACC_A), issuedAt: '' }, safe)).toThrow(TypeError)
    expect(() => writeSessionFile(root, { ...makeSession(ACC_A), expiresAt: '' }, safe)).toThrow(TypeError)
    expect(readdirSync(root)).toEqual([])
  })

  it('入参校验先于加密可用性检查（顺序是规格的一部分：坏入参任何时候都抛）', () => {
    const root = makeRoot()
    const wrongVersion = { ...makeSession(ACC_A), v: 2 } as unknown as StoredSession
    expect(() => writeSessionFile(root, wrongVersion, makeSafe({ available: false }))).toThrow(TypeError)
  })

  it('sub 大写：目录名用归一后的小写、payload 里的 sub 原样保存（扫描按大小写归一比对）', () => {
    const root = makeRoot()
    const safe = makeSafe()

    expect(writeSessionFile(root, makeSession(ACC_A_UPPER), safe)).toBe(true)
    expect(existsSync(join(root, 'accounts', ACC_A, 'session.bin'))).toBe(true)
    const active = expectActive(scanSessionFiles(root, safe))
    expect(active.accountId).toBe(ACC_A)
    expect(active.session.sub).toBe(ACC_A_UPPER)
  })
})

// ---------------------------------------------------------------- 清档

describe('clearSessionFile 登出清档', () => {
  it('只删那一个 session.bin：账号目录与其中的邻居文件不动', () => {
    const root = makeRoot()
    const safe = makeSafe()
    const file = plantSessionFile(root, ACC_A, JSON.stringify(makeSession(ACC_A)), safe)
    const sibling = join(root, 'accounts', ACC_A, 'profile.json')
    writeFileSync(sibling, '{"x":1}')

    clearSessionFile(root, ACC_A)
    expect(existsSync(file)).toBe(false)
    expect(existsSync(sibling)).toBe(true)
    expect(existsSync(join(root, 'accounts', ACC_A))).toBe(true)
  })

  it('文件不存在（连 accounts 目录都没有）⇒ 静默成功、不抛', () => {
    const root = makeRoot()
    mkdirSync(join(root, 'accounts', ACC_A), { recursive: true })
    expect(() => clearSessionFile(root, ACC_A)).not.toThrow()
    expect(() => clearSessionFile(makeRoot(), ACC_A)).not.toThrow()
  })

  it('传大写 id 也能清掉（拼路径用的是白名单的归一返回值）', () => {
    const root = makeRoot()
    const safe = makeSafe()
    const file = plantSessionFile(root, ACC_A, JSON.stringify(makeSession(ACC_A)), safe)

    clearSessionFile(root, ACC_A_UPPER)
    expect(existsSync(file)).toBe(false)
  })

  it('坏 accountId（../evil）⇒ 抛 TypeError，不碰任何文件', () => {
    const root = makeRoot()
    const safe = makeSafe()
    const file = plantSessionFile(root, ACC_A, JSON.stringify(makeSession(ACC_A)), safe)

    expect(() => clearSessionFile(root, '../evil')).toThrow(TypeError)
    expect(existsSync(file)).toBe(true)
  })
})

// ---------------------------------------------------------------- 纯解析

describe('parseSessionPlaintext 形状校验', () => {
  function sessionJsonOf(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({ ...makeSession(ACC_A), ...overrides })
  }
  function sessionJsonWithout(key: keyof StoredSession): string {
    const obj: Record<string, unknown> = { ...makeSession(ACC_A) }
    delete obj[key]
    return JSON.stringify(obj)
  }

  it('合法 JSON ⇒ 五个字段原样返回', () => {
    expect(parseSessionPlaintext(sessionJsonOf())).toEqual(makeSession(ACC_A))
  })

  it('v 缺失 / 不是 1（数字或字符串）⇒ null', () => {
    expect(parseSessionPlaintext(sessionJsonWithout('v'))).toBe(null)
    expect(parseSessionPlaintext(sessionJsonOf({ v: 2 }))).toBe(null)
    expect(parseSessionPlaintext(sessionJsonOf({ v: '1' }))).toBe(null)
  })

  it('sub/token/issuedAt/expiresAt 缺失或是空串 ⇒ null', () => {
    for (const key of ['sub', 'token', 'issuedAt', 'expiresAt'] as const) {
      expect(parseSessionPlaintext(sessionJsonWithout(key))).toBe(null)
      expect(parseSessionPlaintext(sessionJsonOf({ [key]: '' }))).toBe(null)
    }
    expect(parseSessionPlaintext(sessionJsonOf({ sub: 123 }))).toBe(null)
  })

  it('token 不过 TOKEN_REGEX（前缀/长度不对）⇒ null', () => {
    expect(parseSessionPlaintext(sessionJsonOf({ token: 'plain-secret' }))).toBe(null)
    expect(parseSessionPlaintext(sessionJsonOf({ token: FAKE_TOKEN + 'x' }))).toBe(null)
    expect(parseSessionPlaintext(sessionJsonOf({ token: FAKE_TOKEN.slice(0, -1) }))).toBe(null)
  })

  it('不是 JSON / 不是对象（数组、null、字符串、数字、布尔）⇒ null、不抛', () => {
    for (const raw of ['', '{', 'null', '[]', '"ms1_x"', '42', 'true']) {
      expect(parseSessionPlaintext(raw)).toBe(null)
    }
  })

  it('名单外的多余键被忽略（形状只看五个键）', () => {
    const parsed = parseSessionPlaintext(sessionJsonOf({ extra: 'x' }))
    expect(parsed).toEqual(makeSession(ACC_A))
    expect(parsed !== null && 'extra' in parsed).toBe(false)
  })
})
