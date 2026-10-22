/**
 * 磁盘 TokenStore（session-store.ts，P10.5）单测 —— account 端口接 session.bin 的那一层。
 *
 * 【这个文件在守什么】「至多一份 session.bin」不变式在**换账号**路径上不被自己破坏
 * （先清旧、后写新：中途失败最坏 0 份 = 重新登录，绝不是 2 份 = 下次启动全作废）；
 * 以及所有「不该把登录炸掉」的降级（坏 sub / 加密不可用 / 写口校验抛）。
 *
 * 【判据的尺子】「文件在不在」一律 existsSync 直接验磁盘（同 session.test.ts 的
 * 口径）；「剩几份」用真扫描器以外的手工清点 —— 两条尺子互为反例：
 * 换账号用例里同时断言「旧文件没了」「新文件恰 1 份」，并配一条手动种两份的
 * 自检（清点器真的数得出来 2），防「数不到 = 以为干净」的恒绿。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSessionTokenStore } from '../session-store'
import { parseSessionPlaintext, scanSessionFiles, type SafeStorageLike, type StoredSession } from '../session'

// ---------------------------------------------------------------- 夹具

/** 形状合法的假令牌（ms1_ + 43 个 base64url 字符，过 protocol 的 TOKEN_REGEX） */
const FAKE_TOKEN = 'ms1_' + 'Zk7Q'.repeat(10) + 'abc'
const OTHER_TOKEN = 'ms1_' + 'Ab3X'.repeat(10) + 'xyz'

const ACC_A = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d'
const ACC_B = 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e'
/** 服务端坏 id 的形状（account.test.ts 的夹具就是 acc_1 —— 解析层不查 UUID，这里必须兜住） */
const ACC_BAD = 'acc_1'

const FIXED_NOW = '2026-10-11T08:00:00.000Z'
const EXPIRES = '2026-11-09T00:00:00.000Z'

interface FakeSafe extends SafeStorageLike {
  opts: { available: boolean; encryptThrows: boolean }
}

/** 假 safeStorage：密文 = `enc:` + 明文 base64（可逆、可断言「落盘 ≠ 明文」） */
function makeSafe(opts: { available?: boolean; encryptThrows?: boolean } = {}): FakeSafe {
  const state = { available: opts.available ?? true, encryptThrows: opts.encryptThrows ?? false }
  return {
    opts: state,
    isEncryptionAvailable: () => state.available,
    encryptString: (plainText) => {
      if (state.encryptThrows) throw new Error('encrypt failed')
      return Buffer.from(`enc:${Buffer.from(plainText, 'utf8').toString('base64')}`, 'utf8')
    },
    decryptString: (encrypted) => {
      const raw = encrypted.toString('utf8')
      if (!raw.startsWith('enc:')) throw new Error('not a ciphertext')
      return Buffer.from(raw.slice(4), 'base64').toString('utf8')
    }
  }
}

let tmp = ''
let madeDirs: string[] = []
afterEach(() => {
  for (const dir of madeDirs) rmSync(dir, { recursive: true, force: true })
  madeDirs = []
  tmp = ''
})

function freshRoot(): string {
  tmp = mkdtempSync(join(tmpdir(), 'miai-session-store-'))
  madeDirs.push(tmp)
  return tmp
}

const sessionPath = (root: string, sub: string): string => join(root, 'accounts', sub.toLowerCase(), 'session.bin')

/** 直接解密读回磁盘上的会话（读不回来回 null） */
function readStored(root: string, sub: string, safe: SafeStorageLike): StoredSession | null {
  const p = sessionPath(root, sub)
  if (!existsSync(p)) return null
  return parseSessionPlaintext(safe.decryptString(readFileSync(p)))
}

/** 手工清点 accounts/ 下所有 session.bin（不走扫描器 —— 独立尺子） */
function countSessionFiles(root: string): number {
  const accountsDir = join(root, 'accounts')
  if (!existsSync(accountsDir)) return 0
  let n = 0
  for (const entry of readdirSync(accountsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(accountsDir, entry.name, 'session.bin'))) n++
  }
  return n
}

function makeStore(opts: { safe?: FakeSafe; logs?: string[] } = {}): ReturnType<typeof createSessionTokenStore> {
  const safe = opts.safe ?? makeSafe()
  return createSessionTokenStore({
    baseDir: freshRoot(),
    safe,
    now: () => FIXED_NOW,
    log: (m) => opts.logs?.push(m)
  })
}

const rec = (sub: string, token = FAKE_TOKEN): { token: string; sub: string; expiresAt: string } => ({
  token,
  sub,
  expiresAt: EXPIRES
})

// ---------------------------------------------------------------- 基本读写

describe('set / get / current', () => {
  it('set(record)：内存立刻可见，磁盘落一份能被真扫描器读回的加密会话', () => {
    const safe = makeSafe()
    const logs: string[] = []
    const store = makeStore({ safe, logs })
    const root = tmp

    store.set(rec(ACC_A))

    expect(store.get()).toBe(FAKE_TOKEN)
    expect(store.current()?.sub).toBe(ACC_A)
    expect(store.current()?.issuedAt).toBe(FIXED_NOW) // 现盖，不是服务端时刻

    // 真扫描器判 active，且读回的内容逐字段对得上
    const scan = scanSessionFiles(root, safe)
    expect(scan.kind).toBe('active')
    if (scan.kind !== 'active') throw new Error('unreachable')
    expect(scan.accountId).toBe(ACC_A)
    expect(scan.session).toEqual({ v: 1, sub: ACC_A, token: FAKE_TOKEN, issuedAt: FIXED_NOW, expiresAt: EXPIRES })

    // 落盘的是密文：原始字节里不许出现 token
    const raw = readFileSync(sessionPath(root, ACC_A), 'utf8')
    expect(raw).not.toContain(FAKE_TOKEN)
    expect(raw).not.toContain('ms1_')
    expect(logs).toEqual([])
  })

  it('同一账号重写：还是恰一份，内容换新（issuedAt 跟着新写时刻）', () => {
    const safe = makeSafe()
    const store = makeStore({ safe })
    const root = tmp

    store.set(rec(ACC_A))
    store.set(rec(ACC_A, OTHER_TOKEN))

    expect(countSessionFiles(root)).toBe(1)
    expect(store.get()).toBe(OTHER_TOKEN)
    expect(readStored(root, ACC_A, safe)?.token).toBe(OTHER_TOKEN)
  })

  it('set(null)：内存清空 + 磁盘文件删掉（开始没登录也不抛）', () => {
    const safe = makeSafe()
    const store = makeStore({ safe })
    const root = tmp

    store.set(null) // 空手登出：不抛、无副作用
    expect(store.get()).toBe(null)

    store.set(rec(ACC_A))
    expect(existsSync(sessionPath(root, ACC_A))).toBe(true)
    store.set(null)
    expect(store.get()).toBe(null)
    expect(store.current()).toBe(null)
    expect(existsSync(sessionPath(root, ACC_A))).toBe(false)
    expect(scanSessionFiles(root, safe).kind).toBe('guest')
  })
})

// ---------------------------------------------------------------- 换账号（核心不变式）

describe('换账号：先清旧、后写新', () => {
  it('A → B：A 的文件已删、B 恰一份、总量恒 ≤1', () => {
    const safe = makeSafe()
    const store = makeStore({ safe })
    const root = tmp

    store.set(rec(ACC_A))
    expect(countSessionFiles(root)).toBe(1) // 尺子自检：此刻真的数得出 1

    store.set(rec(ACC_B))

    expect(existsSync(sessionPath(root, ACC_A))).toBe(false)
    expect(countSessionFiles(root)).toBe(1)
    const scan = scanSessionFiles(root, safe)
    expect(scan.kind).toBe('active')
    if (scan.kind !== 'active') throw new Error('unreachable')
    expect(scan.accountId).toBe(ACC_B)
  })

  it('顺序证据：新写失败时旧文件**已经**被清掉了（清旧先行，不是写新后才清）', () => {
    const safe = makeSafe()
    const store = makeStore({ safe })
    const root = tmp

    store.set(rec(ACC_A))
    safe.opts.encryptThrows = true // B 的落盘必失败
    store.set(rec(ACC_B, OTHER_TOKEN)) // 不抛：降级到内存

    expect(store.get()).toBe(OTHER_TOKEN) // 内存是 B 的令牌
    expect(store.current()?.sub).toBe(ACC_B)
    expect(existsSync(sessionPath(root, ACC_A))).toBe(false) // 清旧已发生
    expect(countSessionFiles(root)).toBe(0) // 最坏 0 份，绝不是 2 份
  })

  it('大小写变体不算换账号（UUID 归一后同一个）：不误删自己的文件', () => {
    const safe = makeSafe()
    const store = makeStore({ safe })
    const root = tmp

    store.set(rec(ACC_A))
    store.set(rec(ACC_A.toUpperCase(), OTHER_TOKEN))

    expect(countSessionFiles(root)).toBe(1)
    expect(readStored(root, ACC_A, safe)?.token).toBe(OTHER_TOKEN)
  })

  it('清点器自检：手动种两份就是 2（防「数不到 = 以为干净」的恒绿）', () => {
    const root = freshRoot()
    for (const sub of [ACC_A, ACC_B]) {
      mkdirSync(join(root, 'accounts', sub), { recursive: true })
      writeFileSync(join(root, 'accounts', sub, 'session.bin'), 'x')
    }
    expect(countSessionFiles(root)).toBe(2)
  })
})

// ---------------------------------------------------------------- 降级路径（都不许抛）

describe('降级：登录不许被落盘问题炸掉', () => {
  it('sub 非 canonical UUID：只进内存，不落盘不抛；set(null) 也照样安全', () => {
    const safe = makeSafe()
    const logs: string[] = []
    const store = makeStore({ safe, logs })
    const root = tmp

    store.set(rec(ACC_BAD))
    expect(store.get()).toBe(FAKE_TOKEN) // 本次运行照常可用
    expect(store.current()?.sub).toBe(ACC_BAD)
    expect(existsSync(join(root, 'accounts'))).toBe(false) // 一个目录都没造
    expect(logs).toHaveLength(1)

    store.set(null) // 清内存即可（没有文件可清），不许因坏 id 抛
    expect(store.get()).toBe(null)
  })

  it('从坏 sub 换成好 sub：不抛，好 sub 正常落盘', () => {
    const safe = makeSafe()
    const store = makeStore({ safe })
    const root = tmp

    store.set(rec(ACC_BAD))
    store.set(rec(ACC_A))
    expect(countSessionFiles(root)).toBe(1)
    expect(readStored(root, ACC_A, safe)?.token).toBe(FAKE_TOKEN)
  })

  it('加密不可用：内存有、盘上没有（绝不落明文），告警一行', () => {
    const safe = makeSafe({ available: false })
    const logs: string[] = []
    const store = makeStore({ safe, logs })
    const root = tmp

    store.set(rec(ACC_A))
    expect(store.get()).toBe(FAKE_TOKEN)
    expect(countSessionFiles(root)).toBe(0)
    expect(scanSessionFiles(root, safe).kind).toBe('guest')
    expect(logs.length).toBeGreaterThan(0)
  })

  it('加密实现抛异常：同款降级，不抛穿', () => {
    const safe = makeSafe({ encryptThrows: true })
    const logs: string[] = []
    const store = makeStore({ safe, logs })

    expect(() => store.set(rec(ACC_A))).not.toThrow()
    expect(store.get()).toBe(FAKE_TOKEN)
    expect(logs.length).toBeGreaterThan(0)
  })

  it('expiresAt 空串（服务端回的形状过解析层、语义为空）：同款降级，不抛穿', () => {
    const safe = makeSafe()
    const logs: string[] = []
    const store = makeStore({ safe, logs })

    expect(() => store.set({ token: FAKE_TOKEN, sub: ACC_A, expiresAt: '' })).not.toThrow()
    expect(store.get()).toBe(FAKE_TOKEN)
    expect(logs.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------- hydrate（启动注入口）

describe('hydrate：扫描结果注回内存', () => {
  it('注回后 get/current 立即可用；随后 set(null) 能清掉那份文件', () => {
    const safe = makeSafe()
    const store = makeStore({ safe })
    const root = tmp

    // 先经写口造一份真会话，再走扫描 + 注入（模拟启动路径）
    store.set(rec(ACC_A))

    const scan = scanSessionFiles(root, safe)
    if (scan.kind !== 'active') throw new Error('fixture must be active')
    const revived = createSessionTokenStore({ baseDir: root, safe, now: () => FIXED_NOW })
    revived.hydrate(scan.session)

    expect(revived.get()).toBe(FAKE_TOKEN)
    expect(revived.current()).toEqual(scan.session)
    // hydrate 不动磁盘
    expect(existsSync(sessionPath(root, ACC_A))).toBe(true)

    revived.set(null)
    expect(existsSync(sessionPath(root, ACC_A))).toBe(false)
  })

  it('hydrate 后换账号：旧账号文件被清（注入口来的会话同样守不变式）', () => {
    const safe = makeSafe()
    const store = makeStore({ safe })
    const root = tmp
    store.set(rec(ACC_A))

    const scan = scanSessionFiles(root, safe)
    if (scan.kind !== 'active') throw new Error('fixture must be active')
    const revived = createSessionTokenStore({ baseDir: root, safe, now: () => FIXED_NOW })
    revived.hydrate(scan.session)
    revived.set(rec(ACC_B))

    expect(countSessionFiles(root)).toBe(1)
    expect(existsSync(sessionPath(root, ACC_A))).toBe(false)
  })
})

// ---------------------------------------------------------------- 资料快照（2026-10-22）

describe('updateProfile：资料快照（用户名 / 头像 hash）', () => {
  const HASH_A = 'a'.repeat(64)
  const HASH_B = 'b'.repeat(64)

  it('set 时带上的资料会落盘；updateProfile 只改资料，token/sub/expiresAt/issuedAt 原样', () => {
    const safe = makeSafe()
    const store = makeStore({ safe })
    const root = tmp
    store.set({ ...rec(ACC_A), username: 'alice', avatarHash: HASH_A })

    const before = readStored(root, ACC_A, safe)
    expect(before?.username).toBe('alice')
    expect(before?.avatarHash).toBe(HASH_A)
    expect(before?.issuedAt).toBe(FIXED_NOW)

    store.updateProfile({ username: '大肥鱼学徒', avatarHash: HASH_B })
    const after = readStored(root, ACC_A, safe)
    expect(after?.username).toBe('大肥鱼学徒')
    expect(after?.avatarHash).toBe(HASH_B)
    expect(after?.token).toBe(FAKE_TOKEN)
    expect(after?.sub).toBe(ACC_A)
    expect(after?.expiresAt).toBe(before?.expiresAt)
    // issuedAt 是「这份会话何时登录」的元数据，不随资料刷新而改
    expect(after?.issuedAt).toBe(FIXED_NOW)
    expect(store.current()?.username).toBe('大肥鱼学徒')
    expect(store.current()?.avatarHash).toBe(HASH_B)
    // currentProfile 是 session 探测「只补缺」的读口：必须是刚写进去的值
    expect(store.currentProfile()).toEqual({ username: '大肥鱼学徒', avatarHash: HASH_B })
  })

  it('currentProfile：未登录 = null；登录但没设头像 = avatarHash null（不是缺字段）', () => {
    const store = makeStore()
    expect(store.currentProfile()).toBeNull()
    store.set({ ...rec(ACC_A), username: 'alice', avatarHash: null })
    expect(store.currentProfile()).toEqual({ username: 'alice', avatarHash: null })
  })

  it('avatarHash: null 明确清除（没设头像 ≠ 不认识这个字段）', () => {
    const safe = makeSafe()
    const store = makeStore({ safe })
    const root = tmp
    store.set({ ...rec(ACC_A), username: 'alice', avatarHash: HASH_A })

    store.updateProfile({ avatarHash: null })
    expect(store.current()?.avatarHash).toBeNull()
    expect(readStored(root, ACC_A, safe)?.avatarHash).toBeNull()
    expect(readStored(root, ACC_A, safe)?.username).toBe('alice') // 没传的字段不动
  })

  it('未登录时是纯 no-op；空 username / 空 hash 字符串也不许把已有值擦掉', () => {
    const safe = makeSafe()
    const store = makeStore({ safe })
    store.updateProfile({ username: 'ghost' })
    expect(store.current()).toBeNull()

    const root = tmp
    store.set({ ...rec(ACC_A), username: 'alice', avatarHash: HASH_A })
    store.updateProfile({ username: '', avatarHash: '' })
    expect(store.current()?.username).toBe('alice')
    expect(store.current()?.avatarHash).toBe(HASH_A)
    expect(readStored(root, ACC_A, safe)?.username).toBe('alice')
  })

  it('sub 非 canonical UUID：只改内存、不落盘、不抛（同 set 的降级口径）', () => {
    const store = makeStore()
    store.set({ ...rec(ACC_BAD), username: 'alice' })
    expect(() => store.updateProfile({ username: 'bob', avatarHash: HASH_B })).not.toThrow()
    expect(store.current()?.username).toBe('bob')
    expect(store.current()?.avatarHash).toBe(HASH_B)
  })

  it('加密不可用 / 加密实现抛：内存照常更新，只留一行降级告警（不炸改名）', () => {
    for (const safe of [makeSafe({ available: false }), makeSafe({ encryptThrows: true })]) {
      const logs: string[] = []
      const store = makeStore({ safe, logs })
      store.set({ ...rec(ACC_A), username: 'alice' })
      const before = store.current()?.issuedAt
      expect(() => store.updateProfile({ username: 'bob' })).not.toThrow()
      expect(store.current()?.username).toBe('bob')
      expect(store.current()?.issuedAt).toBe(before)
      expect(logs.some((m) => m.includes('profile snapshot'))).toBe(true)
      expect(logs.join('\n')).not.toContain(FAKE_TOKEN)
    }
  })
})

// ---------------------------------------------------------------- 凭据纪律

describe('凭据纪律', () => {
  it('降级告警里没有 token / Bearer / 明文（把四条降级路径都踩一遍）', () => {
    const logs: string[] = []
    const cases: Array<() => void> = [
      () => makeStore({ safe: makeSafe({ available: false }), logs }).set(rec(ACC_A)),
      () => makeStore({ safe: makeSafe({ encryptThrows: true }), logs }).set(rec(ACC_A)),
      () => makeStore({ safe: makeSafe(), logs }).set(rec(ACC_BAD)),
      () => makeStore({ safe: makeSafe(), logs }).set({ token: FAKE_TOKEN, sub: ACC_A, expiresAt: '' })
    ]
    for (const run of cases) run()

    const flat = logs.join('\n')
    expect(logs.length).toBeGreaterThanOrEqual(4)
    expect(flat).not.toContain(FAKE_TOKEN)
    expect(flat).not.toContain('ms1_')
    expect(flat.toLowerCase()).not.toContain('bearer')
  })
})
