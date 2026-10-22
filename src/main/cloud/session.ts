/**
 * session.bin 的落盘与启动扫描（P10.1）—— 令牌在本机唯一的住所。
 *
 * 【为什么有这个文件】docs/22 §5.1：认证是单枚不透明令牌（`ms1_` 前缀 + 43 字符
 * base64url），服务端只存它的 sha256；**令牌原文在本机只允许进
 * `accounts/<id>/session.bin`**，且必须经 safeStorage（Windows 上 = DPAPI）加密。
 * P10.1 只落「接口 + 单测」（§7.1-10），真正的接线（登录后写、启动时扫描、
 * 登出时清）是 P10.5 的事 —— 本文件不含 IPC、不含任何联网代码
 * （`src/main/cloud/**` 会被「零网络」静态闸门扫一遍）。
 *
 * 【safeStorage 不可用时怎么办】原文口径是「只进内存、退出即失，**绝不落明文**」：
 *   · writeSessionFile ⇒ 返回 false，**一个字节都不落盘**。内存里那份怎么活
 *     是调用方（P10.5）的事，本函数只守住「不落明文」这条底线；
 *   · scanSessionFiles ⇒ 直接 guest，**一个文件都不动**。解不开就判不了，
 *     判不了就不猜、更不能借机删用户数据（不可读 ≠ 该删）。
 *
 * 【扫描协议每条为什么这么定】账户目录同时是档案目录（profile/wrongbook/…），
 * 所以扫描的每一步都按「宁可当客人，也不误判、不误删」排布：
 *   1. 加密不可用 ⇒ guest（见上）。
 *   2. `accounts/` 不存在 ⇒ guest —— 新装机器 / 删档重来，是正常状态不是错误。
 *   3. **目录名不是 canonical UUID 的整个跳过**（判据复用 store/account-id.ts）：
 *      `.sync`、升级残留、用户手工放进去的东西都不属于任何账号。不看、不数、
 *      不删它里面的任何东西 —— 对认不出的东西，最小动作是**不动它**。
 *   4. 合法目录里 0 份 session.bin ⇒ guest。
 *   5. **≥2 份 ⇒ 全部删除 ⇒ guest**：「上次是哪个账号」这件事本身已经说不清
 *      （切换账号中途断电、目录被整体复制……）。留一份当权威就必须**挑**，
 *      挑错 = A 拿着 B 的令牌上网（串号，撞上 §7.1 的「A 永远不能读 B」）。
 *      无法安全裁决的局，答案是全部作废、重新登录：代价是一次登录，
 *      收益是**任何情况下都不串号**。
 *   6. 恰好 1 份 ⇒ 解密 + 解析 + 与目录名比对（小写归一后全等）：
 *      · 解密抛 / 解析回 null ⇒ guest，**文件保留**。这条专门防「丢证据」：
 *        解密失败可能是 DPAPI 换了用户、文件被截断、版本漂移 —— 都可能是
 *        **暂时**或将来可修复的状态，删掉就把「回得来」变成「回不来」。
 *        读不懂 ≠ 内容说它不属于这里，所以轮不到我们来清。
 *      · 解析成功但 sub 与目录名不符 ⇒ **删除该 session.bin** ⇒ guest。
 *        与「读不懂」不同，这是**读懂了、而且内容明确说它属于别的账号**：
 *        留着下次还是 guest，清掉既省一次重复劳动，也第一时间掐死
 *        「A 的令牌配上 B 的目录」这个串号组合（§7.1-10 原文）。
 *      · 相符 ⇒ active；accountId 用**目录名的小写归一**（与 account-id.ts
 *        同口径：UUID 大小写不区分，对外一律用归一后的形态）。
 *   删除失败（权限 / 文件被占）不抛穿：console.warn 一行英文文案后照常按 guest
 *   走 —— 清理是尽力而为，扫描本身绝不能把启动打断。
 *
 * 【凭据纪律】token / 明文绝不进 console、也绝不进异常信息（同 transport.ts
 * 的红线）。本文件的告警只带路径与固定英文文案；写口校验的报错只点**字段名**，
 * 不回显任何值 —— token 的坏值同样是凭据。
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, type Dirent } from 'fs'
import { join } from 'path'
import { TOKEN_REGEX } from '../../shared/cloud/protocol'
import { assertSafeAccountId, isCanonicalUuid } from '../store/account-id'

/**
 * Electron safeStorage 里我们真正用到的四个方法（注入而非 import electron：
 * 本文件在纯 node 的 vitest 里可跑，真实现由 P10.5 从 electron 传进来）。
 * 结构上 Electron 的 safeStorage 天然满足本接口。
 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

/**
 * session.bin 的**解密后**明文形状（docs/22 §5.1 冻结）：v 是形状版本，
 * sub = 账号 id（= 所在账号目录名，canonical UUID），token = 不透明令牌原文。
 */
export interface StoredSession {
  v: 1
  sub: string
  token: string
  issuedAt: string
  expiresAt: string
  /**
   * 2026-10-22 用户系统批次：资料快照（不是凭据）。
   * 存它只为「重启后不联网也能显示自己的名字/头像 hash」；旧版本文件没有这两个键
   * 照样能读（parse 把缺失当 undefined），写回时按有无决定是否落盘。
   */
  username?: string
  avatarHash?: string | null
}

export type SessionScanResult =
  | { kind: 'guest' }
  | { kind: 'active'; accountId: string; session: StoredSession }

/** 账户目录名与文件名各写死一处 —— 免得有人顺手只改一边 */
const ACCOUNTS_DIR = 'accounts'
const SESSION_FILE = 'session.bin'

// ---------------------------------------------------------------- 形状小工具

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v !== ''
}

function isDirectoryAt(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    // 不存在 / 没权限 / 不是目录 —— 对调用方都等价于「没有这个目录」
    return false
  }
}

function isFileAt(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- 纯解析（无 IO）

/**
 * 解密后的明文 → StoredSession。**不抛**：任何一条不满足都回 null
 * （调用方拿 null 一律按「这份不可信」处理，绝不能让它变成异常打断启动）。
 */
export function parseSessionPlaintext(raw: string): StoredSession | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  // 数组也是 object，显式排除 —— 形状是「一个对象字面量」，不是任意 JSON
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const rec = parsed as Record<string, unknown>
  if (rec['v'] !== 1) return null
  const sub = rec['sub']
  const token = rec['token']
  const issuedAt = rec['issuedAt']
  const expiresAt = rec['expiresAt']
  if (!isNonEmptyString(sub) || !isNonEmptyString(issuedAt) || !isNonEmptyString(expiresAt)) return null
  // 令牌形状以 protocol.ts 的 TOKEN_REGEX 为唯一真源（长度/字符集改在那里改）。
  // 形状不对的 token 写进内存也没用（服务端不认），更不该被当成「已登录」。
  if (!isNonEmptyString(token) || !TOKEN_REGEX.test(token)) return null
  // 名单外的键一律忽略（形状只看这五个）——将来加字段时旧版本的行为是可预测的
  const session: StoredSession = { v: 1, sub, token, issuedAt, expiresAt }
  // 可选资料快照：缺失/类型不对 = 当没有（不是「整份不可信」——它们不影响认证）
  if (isNonEmptyString(rec['username'])) session.username = rec['username']
  const avatarHash = rec['avatarHash']
  if (avatarHash === null) session.avatarHash = null
  else if (isNonEmptyString(avatarHash)) session.avatarHash = avatarHash
  return session
}

// ---------------------------------------------------------------- 扫描

/** 一个「合法账号目录里的 session.bin」；只有目录名过了 UUID 白名单才可能入列 */
interface SessionFileRef {
  /** 磁盘上的目录名（可能是大写形态，比对时小写归一） */
  dirName: string
  filePath: string
}

/**
 * 列出 accounts/ 下所有**合法账号目录**里的 session.bin。
 * 不合法（非 canonical UUID）的目录整个跳过 —— 不看、不数、不删。
 */
function listSessionFiles(accountsDir: string): SessionFileRef[] {
  const refs: SessionFileRef[] = []
  let entries: Dirent[]
  try {
    entries = readdirSync(accountsDir, { withFileTypes: true })
  } catch {
    // 目录读不了 = 没有任何可判定的会话（不猜、不删）
    return refs
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!isCanonicalUuid(entry.name)) continue
    const filePath = join(accountsDir, entry.name, SESSION_FILE)
    // 只认「文件」：同名的目录/坏链不构成一份会话，也不该进删除名单
    if (!isFileAt(filePath)) continue
    refs.push({ dirName: entry.name, filePath })
  }
  return refs
}

/**
 * 删一个 session.bin（只删文件本身）。失败只告警不抛穿 ——
 * 清理是尽力而为，扫描的返回值（guest）不因删除失败而改变。
 * 文案只有路径：没有 token、没有明文、没有密文。
 */
function removeSessionFile(filePath: string): void {
  try {
    rmSync(filePath, { force: true })
  } catch {
    console.warn('[miai] session scan: failed to remove a session file', filePath)
  }
}

/**
 * 启动扫描（协议见文件头注释，七条铁律逐条实现）。
 * 只读 + 最多删「判定为作废」的 session.bin；账号目录与其中的档案永不触碰。
 */
export function scanSessionFiles(baseDir: string, safe: SafeStorageLike): SessionScanResult {
  // 1. 加密不可用：一个文件都不动（不可读即不可判，不猜）
  if (!safe.isEncryptionAvailable()) return { kind: 'guest' }

  const accountsDir = join(baseDir, ACCOUNTS_DIR)
  // 2. 没有 accounts/ 目录：guest（正常状态，不是错误）
  if (!isDirectoryAt(accountsDir)) return { kind: 'guest' }

  // 3. + 4. 合法账号目录里的 session.bin 清单（非 UUID 目录已在列清单时整体跳过）
  const refs = listSessionFiles(accountsDir)
  if (refs.length === 0) return { kind: 'guest' }

  // 5. ≥2 份：说不清谁是谁，全部作废（防串号），档案不动
  if (refs.length > 1) {
    for (const ref of refs) removeSessionFile(ref.filePath)
    return { kind: 'guest' }
  }

  // 6. 恰好 1 份：解密 + 解析 + 与目录名比对
  const only = refs[0]
  let plaintext: string
  try {
    plaintext = safe.decryptString(readFileSync(only.filePath))
  } catch {
    // 读不了 / 解不开：当客人，**文件保留**（不丢证据；见文件头第 6 条）
    return { kind: 'guest' }
  }
  const session = parseSessionPlaintext(plaintext)
  if (session === null) {
    // 解密成功但形状不认识：同样当客人、同样保留文件（可能是将来才认识的版本）
    return { kind: 'guest' }
  }
  const accountId = only.dirName.toLowerCase()
  if (session.sub.toLowerCase() !== accountId) {
    // 读懂了、而且内容说它属于别的账号 —— 这份留着只会每次都判 guest，
    // 且构成「A 的令牌 + B 的目录」的串号组合，清掉
    removeSessionFile(only.filePath)
    return { kind: 'guest' }
  }
  return { kind: 'active', accountId, session }
}

// ---------------------------------------------------------------- 写口

/**
 * 入参校验（坏入参 = 调用方程序错，抛 TypeError 而不是返回值 ——
 * 与 docs.ts 的「我们自己传错参数」同款口径）。
 * 报错只点**字段名**，绝不回显值：token 的坏值同样是凭据。
 */
function assertNonEmptyStringField(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value === '') {
    throw new TypeError(`session field must be a non-empty string: ${field}`)
  }
}

/**
 * 写 `accounts/<sub>/session.bin`。
 *
 * 顺序是规格的一部分：**先校验入参**（坏入参任何时候都抛），再查加密可用性
 * （不可用 ⇒ false，一个字节都不落盘），最后才是 mkdir + 临时文件 + rename
 * 原子替换。目录名只许用 assertSafeAccountId 的**返回值**（小写归一 +
 * 路径穿越白名单，见 store/account-id.ts）。
 *
 * 写盘过程出错（磁盘满 / 权限 / 加密实现抛）不外抛：清掉可能残留的临时文件、
 * 告警一行、回 false —— false 对调用方的含义统一是「这份没落盘，请按内存态处理」。
 */
export function writeSessionFile(baseDir: string, session: StoredSession, safe: SafeStorageLike): boolean {
  if (typeof session !== 'object' || session === null) {
    throw new TypeError('session must be an object')
  }
  if (session.v !== 1) {
    throw new TypeError(`unsupported session version: ${String(session.v)}`)
  }
  // sub 走白名单断言；通过则拿到小写归一的 id，拼路径只用它
  const accountId = assertSafeAccountId(session.sub)
  assertNonEmptyStringField(session.token, 'token')
  assertNonEmptyStringField(session.issuedAt, 'issuedAt')
  assertNonEmptyStringField(session.expiresAt, 'expiresAt')

  if (!safe.isEncryptionAvailable()) return false

  const dir = join(baseDir, ACCOUNTS_DIR, accountId)
  const filePath = join(dir, SESSION_FILE)
  const tmpPath = `${filePath}.tmp`
  try {
    mkdirSync(dir, { recursive: true })
    // 按白名单重建五个键再序列化：调用方（或绕过 TS 的路径）多塞的键不进文件，
    // 文件形状是 protocol 冻结的。sub 原样保存（不在这里改写大小写）：
    // 目录名已用归一后的返回值，而扫描的比对本身就是大小写归一之后的 ——
    // 两个变体都落回同一判定，没必要在写口悄悄改用户数据的形态。
    const payload: StoredSession = {
      v: 1,
      sub: session.sub,
      token: session.token,
      issuedAt: session.issuedAt,
      expiresAt: session.expiresAt
    }
    // 可选资料快照：只在调用方给了才写（undefined = 不写，null = 明确「没设头像」）
    if (isNonEmptyString(session.username)) payload.username = session.username
    if (session.avatarHash === null || isNonEmptyString(session.avatarHash)) {
      payload.avatarHash = session.avatarHash
    }
    writeFileSync(tmpPath, safe.encryptString(JSON.stringify(payload)))
    renameSync(tmpPath, filePath)
    return true
  } catch {
    try {
      rmSync(tmpPath, { force: true })
    } catch {
      // 清理临时文件也是尽力而为：失败不影响 false 的语义
    }
    console.warn('[miai] session write: failed to persist a session file', filePath)
    return false
  }
}

/**
 * 清掉某个账号的 session.bin（登出 / 全撤时用）。
 * 只 rmSync 那一个文件：目录不删、别的文件不删、文件不存在也静默成功。
 * accountId 先过白名单（拼路径前必须的守门，与写口同一条）。
 */
export function clearSessionFile(baseDir: string, accountId: string): void {
  const safeId = assertSafeAccountId(accountId)
  const filePath = join(baseDir, ACCOUNTS_DIR, safeId, SESSION_FILE)
  try {
    rmSync(filePath, { force: true })
  } catch {
    // 登出不该因为一个删不掉的文件而崩：告警后照常返回
    console.warn('[miai] session clear: failed to remove a session file', filePath)
  }
}
