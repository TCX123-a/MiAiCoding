/**
 * 本地演示账号（UI 大修轮 2026-10-09 · 契约 §5.1）。
 *
 * 【2026-10-11 起：已被真云账号取代，界面零消费】P10.6 把登录页接到了
 * server/ 的真账号（渲染层的 stores/account.ts + shared/cloud 协议）——
 * 本文件从那天起**不再是任何界面的数据层**。保留它是为实验台与回归面
 * （单测、头像工具链还引用它），不是「还有人在用」。别再给它加新功能，
 * 也别把新界面接回来。
 *
 * 【这一版是什么】账号体系的**纯前端占位**：注册 / 登录 / 安全词找回的闭环
 * 在本机完整可玩，但账号只住在这台机器的 localStorage（键 `mi.beta.auth`），
 * 不上云、也不进 profile.json —— 那份档案有自己的迁移链，往里塞东西要付迁移成本。
 * 后端（server/）接通那天，**替换的就是本文件**，界面一行不动。
 *
 * 【为什么密码不存明文】存的是「随机盐 + 迭代摘要」（saltHash）。把话说清楚：
 * **它不是密码学哈希**，挡得住的是「随手打开存档就看见密码」这类事故；
 * 真实强度等后端做。安全词答案同理，也不留明文。
 *
 * 【为什么自带内存兜底存储】单测跑在 node 环境（vitest.config.ts 的
 * `environment: 'node'`），那里没有 localStorage。backend() 探测不到真身时
 * 落到模块级 Map —— 于是本文件的全部判定都能进单测，而不是只能靠真窗口探针。
 *
 * 【为什么写失败要静默、还要一层 cache】localStorage 会满（QuotaExceeded）、
 * 隐私模式会拒写。账号是演示功能：写不进去顶多下次打开丢了，绝不能抛成一个
 * 炸在注册按钮上的异常。cache 保证「写失败后本会话内行为仍一致」——
 * 不然会出现注册刚报「成功」、侧栏立刻回「未登录」的鬼故事。
 */
import { ref, type Ref } from 'vue'
import { normalizeAvatar } from './avatar'

/** 账号存档的 localStorage 键。**独立于 profile.json**（理由见文件头） */
export const AUTH_STORAGE_KEY = 'mi.beta.auth'

/** 昵称长度界（按码点算，emoji 记 1 个）：与文案 ERR_BAD_NAME 的「2~12 个字」同源 */
export const NAME_MIN = 2
export const NAME_MAX = 12

/** 密码下限：与文案 ERR_BAD_PASS 的同源 */
export const PASS_MIN = 4

/** 对外的一副面孔：存进存档、给界面看的字段就这么两个 */
export interface DemoUser {
  name: string
  /** 头像引用：预设 id（avatar.ts 的 AVATAR_PRESETS）或 dataURL；读取永远过 normalizeAvatar */
  avatar: string
}

/** 存档里的一条账号记录（含凭证摘要；**不出这个文件**） */
interface UserRecord {
  name: string
  /** saltHash(密码, salt) */
  pass: string
  salt: string
  question: string
  /** saltHash(归一化答案, salt) —— 答案也不存明文 */
  answer: string
  avatar: string
}

/** 存档形状。`v` 留给将来改结构时迁移用（与 profile 的惯例一致，虽然当前恒为 1） */
interface StoreFile {
  v: 1
  users: UserRecord[]
  /** 当前登录的昵称；没登录是 null。存名字不存下标 —— 数组顺序会变 */
  current: string | null
}

/**
 * 失败原因。code → 文案的翻译原来在 copy.ts 的 `LOGIN.ERR_*`（那一组随
 * P10.6 下线为 ACCOUNT 组）—— 现在只有实验台和单测消费这些码。
 */
export type AuthErrorCode =
  | 'BAD_NAME'
  | 'NAME_TAKEN'
  | 'BAD_PASS'
  | 'PASS_MISMATCH'
  | 'BAD_SECURITY'
  | 'NO_USER'
  | 'BAD_PASS_LOGIN'
  | 'BAD_ANSWER'

export type RegisterResult = { ok: true; user: DemoUser } | { ok: false; code: AuthErrorCode }
export type LoginResult = RegisterResult
export type QuestionResult = { ok: true; question: string } | { ok: false; code: AuthErrorCode }
export type SimpleResult = { ok: true } | { ok: false; code: AuthErrorCode }

// ──────────────────────────────────────────────────────────── 存储后端

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** node 测试的落脚点（真机走 localStorage，用不到它） */
const memory = new Map<string, string>()

const MEMORY_BACKEND: StorageLike = {
  getItem: (k) => (memory.has(k) ? (memory.get(k) as string) : null),
  setItem: (k, v) => void memory.set(k, v)
}

function backend(): StorageLike {
  try {
    // 某些环境连「读这个全局名字」都会抛（无痕/被策略禁）——落到内存档
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    /* 落到内存档 */
  }
  return MEMORY_BACKEND
}

// ──────────────────────────────────────────────────────────── 凭证摘要

/**
 * 占位摘要：djb2-xor 迭代 256 轮 + 盐。**不是密码学哈希**（文件头已声明）——
 * 迭代轮数只是让手工从摘要反推明文没那么「一眼可见」，别当安全边界用。
 * 输出恒为 8 位十六进制。
 */
export function saltHash(input: string, salt: string): string {
  let h = 5381
  const s = `${salt}\u0000${input}`
  for (let round = 0; round < 256; round++) {
    for (let i = 0; i < s.length; i++) {
      h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
    }
    h = (h ^ round) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function newSalt(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

// ──────────────────────────────────────────────────────────── 归一化

/** 昵称归一：只 trim。大小写不折（「Ann」和「ann」是两个人 —— 汉字用户无所谓，英文昵称用户在乎） */
function normalizeName(raw: string): string {
  return raw.trim()
}

/** 答案归一：trim + 折小写（「蓝色」和「 蓝色 」是同一条答案，「Blue」和「blue」同理） */
function normalizeAnswer(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * 一条记录的答案对不对（归一化答案的摘要比对）。
 * **比较逻辑全库只住这一处** —— verifyAnswer（找回第二步当场判定）与
 * resetPassword（最后一步纵向复核）共用它，两处判定不可能各自漂移。
 * 只回 true/false：不把期望值、原文或摘要带出函数，错多错少都不透露。
 */
function answerMatches(rec: UserRecord, raw: string): boolean {
  return saltHash(normalizeAnswer(raw), rec.salt) === rec.answer
}

/** 码点计数：emoji 记 1 个，不用 UTF-16 码元数（'🐟'.length === 2 会骗人） */
function nameLength(s: string): number {
  return [...s].length
}

// ──────────────────────────────────────────────────────────── 读档 / 写档

/**
 * 本会话的存档镜像。写口先更 cache 再落盘（落盘可失败）——
 * 见文件头「写失败要静默」段。跨会话一致性由磁盘（localStorage）负责。
 */
let cache: StoreFile | null = null

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

/** 一条记录的形状校验；坏形状给 null（读口丢、不炸） */
function cleanRecord(x: unknown): UserRecord | null {
  if (!isObject(x)) return null
  const { name, pass, salt, question, answer } = x
  if (typeof name !== 'string' || name === '') return null
  if (typeof pass !== 'string' || pass === '') return null
  if (typeof salt !== 'string' || salt === '') return null
  if (typeof question !== 'string' || question === '') return null
  if (typeof answer !== 'string' || answer === '') return null
  return { name, pass, salt, question, answer, avatar: normalizeAvatar(x.avatar) }
}

/** 把任意 JSON 洗成合法存档：坏 JSON/坏版本/坏记录 → 各自有明确的降级出口 */
function sanitizeStore(data: unknown): StoreFile {
  const empty: StoreFile = { v: 1, users: [], current: null }
  if (!isObject(data) || data.v !== 1 || !Array.isArray(data.users)) return empty
  const users: UserRecord[] = []
  const seen = new Set<string>()
  for (const u of data.users) {
    const rec = cleanRecord(u)
    // 同名记录只留第一条：find() 本来就取第一条，重名的第二条若写回去会让存档不断长大
    if (rec && !seen.has(rec.name)) {
      seen.add(rec.name)
      users.push(rec)
    }
  }
  const current =
    typeof data.current === 'string' && users.some((u) => u.name === data.current)
      ? data.current
      : null
  return { v: 1, users, current }
}

function readStore(): StoreFile {
  if (cache) return cache
  let raw: string | null = null
  try {
    raw = backend().getItem(AUTH_STORAGE_KEY)
  } catch {
    raw = null // 读都被拒的罕见环境 —— 当空档，不炸
  }
  let parsed: StoreFile
  if (!raw) {
    parsed = { v: 1, users: [], current: null }
  } else {
    try {
      parsed = sanitizeStore(JSON.parse(raw))
    } catch {
      parsed = { v: 1, users: [], current: null } // 坏 JSON 当空档：宁可丢演示账号，不炸启动
    }
  }
  cache = parsed
  return parsed
}

function writeStore(store: StoreFile): void {
  cache = store
  try {
    backend().setItem(AUTH_STORAGE_KEY, JSON.stringify(store))
  } catch {
    /* 写满/拒写：本会话照常（cache 已是新值），下次打开丢就丢了 —— 演示账号，不炸界面 */
  }
}

// ──────────────────────────────────────────────────────────── 响应式镜像

const user = ref<DemoUser | null>(null)

function syncUser(): void {
  user.value = currentUser()
}

/**
 * 当前登录用户的响应式镜像。侧栏身份区 / 登录页读它。
 * 模块加载即同步一次：**上次登录的账号在启动时就亮在侧栏**。
 */
export function useAuth(): { user: Ref<DemoUser | null> } {
  return { user }
}

/** 当前登录用户（读盘口径；无登录/记录坏掉都是 null） */
export function currentUser(): DemoUser | null {
  const store = readStore()
  if (!store.current) return null
  const rec = store.users.find((u) => u.name === store.current)
  return rec ? { name: rec.name, avatar: rec.avatar } : null
}

// ──────────────────────────────────────────────────────────── 动作与判定

export interface RegisterInput {
  name: string
  password: string
  /** 再输一遍（视图侧收集；数据层也必须校验 —— 视图不进单测，判定不能只住在那儿） */
  confirm: string
  /** 安全问题（用户自设） */
  question: string
  /** 安全词答案 */
  answer: string
  /** 头像引用（预设 id 或 dataURL）；缺省/非法 → 默认预设 */
  avatar?: string
}

/**
 * 注册。成功后**直接进入登录态**（注册完还要再登一遍是多余的一步）。
 * 校验顺序：昵称 → 重名 → 密码 → 一致 → 安全词。先到先报（视图一次只弹一条）。
 */
export function register(input: RegisterInput): RegisterResult {
  const name = normalizeName(input.name)
  if (nameLength(name) < NAME_MIN || nameLength(name) > NAME_MAX) {
    return { ok: false, code: 'BAD_NAME' }
  }
  const store = readStore()
  if (store.users.some((u) => u.name === name)) {
    return { ok: false, code: 'NAME_TAKEN' }
  }
  if (input.password.length < PASS_MIN) {
    return { ok: false, code: 'BAD_PASS' }
  }
  if (input.password !== input.confirm) {
    return { ok: false, code: 'PASS_MISMATCH' }
  }
  const question = input.question.trim()
  const answer = normalizeAnswer(input.answer)
  if (!question || !answer) {
    return { ok: false, code: 'BAD_SECURITY' }
  }
  const salt = newSalt()
  const record: UserRecord = {
    name,
    salt,
    pass: saltHash(input.password, salt),
    question,
    answer: saltHash(answer, salt),
    avatar: normalizeAvatar(input.avatar)
  }
  store.users.push(record)
  store.current = name
  writeStore(store)
  syncUser()
  return { ok: true, user: { name, avatar: record.avatar } }
}

/** 登录。昵称同样先 trim；密码错与账号不存在**分开报**（演示版没有防枚举顾虑，用户更需要准确提示） */
export function login(name: string, password: string): LoginResult {
  const n = normalizeName(name)
  const store = readStore()
  const rec = store.users.find((u) => u.name === n)
  if (!rec) return { ok: false, code: 'NO_USER' }
  if (saltHash(password, rec.salt) !== rec.pass) return { ok: false, code: 'BAD_PASS_LOGIN' }
  store.current = rec.name
  writeStore(store)
  syncUser()
  return { ok: true, user: { name: rec.name, avatar: rec.avatar } }
}

/** 找回第一步：给出该账号自设的安全问题（账号不存在给 NO_USER） */
export function getQuestion(name: string): QuestionResult {
  const n = normalizeName(name)
  const rec = readStore().users.find((u) => u.name === n)
  if (!rec) return { ok: false, code: 'NO_USER' }
  return { ok: true, question: rec.question }
}

/**
 * 找回第二步的**当场判定**：这个账号、这个答案，对不对。
 *
 * 【为什么要有这个读口】主人口径是「答对即可重置」——「答对」是一个当场动作。
 * 旧流程里第二步只收答案、走到第三步提交新密码时才发现答错；这个口让
 * 「验证」按钮真的验，答对才放行（视图侧 LoginView 的 onFindNext 消费它）。
 *
 * 【为什么返回 boolean、不返回摘要或更多信息】答案原文与摘要是机密：
 * 既不在返回值里带期望值，也不区分「错得接近」与「完全不对」；账号不存在
 * 同样给 false（演示版对「账号不存在」已在 getQuestion 一步单独报过，
 * 这里再分一档只会多一个枚举口，也给不出对用户有用的差别）。
 *
 * 【只读】不落盘、不动登录态：验证 ≠ 登录（它只放行到重设密码那一步）。
 * 重设前 resetPassword 还会再核一遍（纵深：判定不能只住在视图层，
 * 防有人跳步直接调最后一步）——两处共用 answerMatches，比较口径同一份。
 */
export function verifyAnswer(name: string, answer: string): boolean {
  const n = normalizeName(name)
  const rec = readStore().users.find((u) => u.name === n)
  if (!rec) return false
  return answerMatches(rec, answer)
}

/**
 * 找回最后一步：核对答案 → 重设密码。**答案在这里会再核一遍**（纵深，
 * 见 verifyAnswer 注释）——视图那关可以被人跳过，这一关跳不过。
 * 校验顺序：账号 → 答案 → 新密码（答案错了就不该泄露"新密码合不合规"）。
 * 重设成功后**换新盐**：旧摘要、旧盐一起作废（同一密码在不同轮次下的摘要恒不同）。
 * 注意答案摘要也要用新盐重算 —— 否则这条账号第二次找回会永远答「错」。
 */
export function resetPassword(name: string, answer: string, newPassword: string): SimpleResult {
  const n = normalizeName(name)
  const store = readStore()
  const rec = store.users.find((u) => u.name === n)
  if (!rec) return { ok: false, code: 'NO_USER' }
  if (!answerMatches(rec, answer)) return { ok: false, code: 'BAD_ANSWER' }
  if (newPassword.length < PASS_MIN) return { ok: false, code: 'BAD_PASS' }
  const norm = normalizeAnswer(answer)
  rec.salt = newSalt()
  rec.pass = saltHash(newPassword, rec.salt)
  rec.answer = saltHash(norm, rec.salt)
  writeStore(store)
  return { ok: true }
}

/** 登出。**只清 current，不删账号**（账号删不删将来由后端定，演示版不做销号） */
export function logout(): void {
  const store = readStore()
  store.current = null
  writeStore(store)
  syncUser()
}

// ──────────────────────────────────────────────────────────── 单测专用出口

/**
 * 单测专用钩子（真机代码不消费）。
 * node 测试没有 localStorage，唯一能碰内存档与 cache 的口子在这里：
 *   wipe()      每例之间的清零（内存档 + cache 一起 —— 只清一个会让下例读到上例的档）
 *   coldStart() 模拟重启：只丢 cache、留存储 —— 「关掉再开还在不在」的判据靠它
 *   raw()       看存档原文（断言"密码不进明文"这类不变量）
 *   seed()      往存储里种一段原始文本（坏 JSON / 坏形状的兜底用例）
 */
export const __authTestHooks = {
  wipe(): void {
    memory.clear()
    cache = null
    syncUser()
  },
  coldStart(): void {
    cache = null
    syncUser()
  },
  raw(): string | null {
    return memory.get(AUTH_STORAGE_KEY) ?? null
  },
  seed(text: string): void {
    memory.set(AUTH_STORAGE_KEY, text)
    cache = null
    syncUser()
  }
}

// 模块加载即同步一次：上次登录的账号在启动瞬间就亮（见 useAuth 注释）
syncUser()
