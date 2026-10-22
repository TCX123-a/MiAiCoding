/**
 * 排行榜云客户端（薄）—— 三个动作：getBoard / setOptIn / summary。
 *
 * 【这一层是什么】docs/26 §4.5 的榜面读口 + §4.0 的「面板一屏」汇总，外加
 * 2026-10-10 夜 A4 裁定的 opt-in 写口（PUT /v1/me/leaderboard-opt-in）。
 * 不做本地缓存、不做轮询、不做自动刷新 —— 一次调用 = 一次往返。
 *
 * 【游标纪律（这一层最容易静默坏的地方）】keyset 游标 = base64(score:accountId)
 * （protocol.ts:294）。base64 字母表里的 `+` 直接拼进 query 会被服务端读成**空格**
 * （x-www-form-urlencoded 的经典坑），`&`/`=` 之类更会截断参数 —— 所以 cursor 一律
 * `encodeURIComponent` 后再拼（当前服务端用 base64url、字母表恰好不含 `+`/`/`/`=`，
 * 但客户端**不依赖那个巧合**，见 leaderboard-cursor.ts:16-18）。
 * 「下一页游标」是服务端回的 `nextCursor`（原样回传给下一次调用），客户端不自己编。
 *
 * 【period 的两种错法分得很开】
 *   · 不认识的值（'hourly' 之类）是**我们自己传错参数**（period 是编译期定死的字面量
 *     联合）→ 照 docs.ts 的 assertDocType 先例抛 TypeError，且一个包都不发；
 *   · 缺省（undefined）不是错——服务端 period 必填（leaderboard.ts:59），但本层
 *     **不造默认值**（造一个"猜的榜期"会把 400 藏成一个看着正常的榜面），缺省就不拼，
 *     让服务端的 400 VALIDATION_FAILED 原样透传。
 *
 * 【形状纪律，与 docs.ts 同款】服务端是权威，但认不出的形状一律 MALFORMED_RESPONSE。
 * 这一节的 nullable 键特别多（periodKey / me.rank / computedAt / nextCursor /
 * filter.lang / filter.difficulty），缺键与值为 null 是两件事：值 null 合法、缺键判错。
 * 唯一例外 = entries[].avatarHash：2026-10-22 之前的服务端不发这个键，缺键按 null 接
 * （见 parseBoardEntry；理由与 account.ts 的 parseAccount 同一段版本漂移说明）。
 *
 * 【token】注入的 TokenStore；没 token 时**一个包都不发**（UNLOGGED）。三个动作同款。
 */
import {
  AVATAR_HASH_RE,
  DIFFICULTIES,
  LANGS,
  LEADERBOARD_LIMIT_MAX,
  LEADERBOARD_PERIODS,
  type Difficulty,
  type Lang,
  type LeaderboardPeriod
} from '../../shared/cloud/protocol'
import type {
  CloudFailure,
  CloudResult,
  LeaderboardEntry,
  LeaderboardResponse,
  MeSummaryResponse,
  OptInResponse
} from '../../shared/cloud/dto'
import { cloudOk, createTransport, type CloudLogger, type FetchLike } from './transport'
import type { TokenStore } from './account'

export interface CloudLeaderboardDeps {
  baseUrl: string
  fetch: FetchLike
  timeoutMs?: number
  logger?: CloudLogger
  /** 重试退避的等待实现（注入缝，见 transport 的 CloudTransportDeps.sleep） */
  sleep?: (ms: number) => Promise<void>
  /** 与账号客户端共用同一个 store —— 登录一次，两边都看得到 */
  tokens: TokenStore
}

export interface CloudLeaderboardClient {
  /**
   * GET /v1/leaderboard —— 一页榜面 + 本人的名次/分数（me 恒在，不受 opt-in 影响）。
   * `cursor` 传上一页响应里的 `nextCursor`（原样）；返回 null 就是没有下一页。
   */
  getBoard(input?: {
    period?: LeaderboardPeriod
    dateKey?: string
    limit?: number
    cursor?: string
  }): Promise<CloudResult<LeaderboardResponse>>
  /** PUT /v1/me/leaderboard-opt-in —— 榜面曝光开关的唯一写口（幂等） */
  setOptIn(input: { optIn: boolean }): Promise<CloudResult<OptInResponse>>
  /** GET /v1/me/summary —— stats + 余额 + 名次，面板一屏（可选 ?dateKey= 本地日） */
  summary(input?: { dateKey?: string }): Promise<CloudResult<MeSummaryResponse>>
}

// ---------------------------------------------------------------- 形状校验

const PERIOD_SET: ReadonlySet<string> = new Set(LEADERBOARD_PERIODS)
const LANG_SET: ReadonlySet<string> = new Set(LANGS)
const DIFFICULTY_SET: ReadonlySet<string> = new Set(DIFFICULTIES)

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

/** 2xx 但形状对不上：**我们侧**的判定，不是服务端回的错 —— httpStatus 如实放 null */
function malformed(detail: string): CloudFailure {
  return { code: 'MALFORMED_RESPONSE', message: `unexpected response shape: ${detail}`, httpStatus: null }
}

const UNLOGGED: CloudFailure = {
  code: 'UNAUTHENTICATED',
  message: 'not signed in',
  httpStatus: null
}

function parseLangs(v: unknown): Lang[] | null {
  if (!Array.isArray(v)) return null
  const out: Lang[] = []
  for (const raw of v) {
    if (typeof raw !== 'string' || !LANG_SET.has(raw)) return null
    out.push(raw as Lang)
  }
  return out
}

function parseBoardEntry(v: unknown): LeaderboardEntry | null {
  if (!isPlainObject(v)) return null
  const rank = num(v.rank)
  const username = str(v.username)
  const score = num(v.score)
  const days = num(v.days)
  if (rank === null || username === null || score === null || days === null) return null
  const langs = parseLangs(v.langs)
  if (langs === null) return null
  /*
   * avatarHash：null = 没设头像（合法）；字符串必须是 64 位小写 hex。
   *
   * 缺键兼容（2026-10-22 夜间自查）：这是 dto 里**唯一**允许缺键的 nullable 字段。
   * 2026-10-22 之前的服务端不发 avatarHash；客户端先更新时若照「缺键判错」，
   * 整张榜会 MALFORMED_RESPONSE —— 用户看到的是排行榜整个打不开，而不是
   * 少一张头像。缺键按 null 接（默认大肥鱼），字段出现后形状纪律照旧。
   */
  const avatarHash = v.avatarHash === undefined ? null : v.avatarHash
  if (avatarHash !== null && (typeof avatarHash !== 'string' || !AVATAR_HASH_RE.test(avatarHash))) {
    return null
  }
  return { rank, username, avatarHash, score, days, langs }
}

/** 过滤器回显：两个键**恒在**（leaderboard.ts:417 组装时显式 ?? null）——缺键判错、值 null 合法 */
function parseFilter(v: unknown): LeaderboardResponse['filter'] | null {
  if (!isPlainObject(v)) return null
  if (v.lang !== null && (typeof v.lang !== 'string' || !LANG_SET.has(v.lang))) return null
  if (v.difficulty !== null && (typeof v.difficulty !== 'string' || !DIFFICULTY_SET.has(v.difficulty))) return null
  return { lang: v.lang as Lang | null, difficulty: v.difficulty as Difficulty | null }
}

function parseMe(v: unknown): LeaderboardResponse['me'] | null {
  if (!isPlainObject(v)) return null
  // rank 是 `.nullable()`：显式 null 合法（本人不在榜）；缺键（undefined）判 MALFORMED
  if (v.rank !== null && num(v.rank) === null) return null
  const score = num(v.score)
  const optedIn = bool(v.optedIn)
  const scoreToday = num(v.scoreToday)
  if (score === null || optedIn === null || scoreToday === null) return null
  return { rank: v.rank === null ? null : (v.rank as number), score, optedIn, scoreToday }
}

function parseBoard(v: unknown): LeaderboardResponse | null {
  if (!isPlainObject(v)) return null
  const period = str(v.period)
  if (period === null || !PERIOD_SET.has(period)) return null
  // periodKey / computedAt / nextCursor 三键同款纪律：显式 null 合法，缺键判错
  if (v.periodKey !== null && typeof v.periodKey !== 'string') return null
  if (v.computedAt !== null && typeof v.computedAt !== 'string') return null
  if (v.nextCursor !== null && typeof v.nextCursor !== 'string') return null
  const filter = parseFilter(v.filter)
  if (filter === null) return null
  if (!Array.isArray(v.entries)) return null
  const entries: LeaderboardEntry[] = []
  for (const raw of v.entries) {
    const parsed = parseBoardEntry(raw)
    if (parsed === null) return null
    entries.push(parsed)
  }
  const me = parseMe(v.me)
  if (me === null) return null
  return {
    period: period as LeaderboardPeriod,
    periodKey: v.periodKey === null ? null : (v.periodKey as string),
    filter,
    entries,
    me,
    computedAt: v.computedAt === null ? null : (v.computedAt as string),
    nextCursor: v.nextCursor === null ? null : (v.nextCursor as string)
  }
}

function parseOptIn(v: unknown): OptInResponse | null {
  if (!isPlainObject(v)) return null
  const optIn = bool(v.optIn)
  if (optIn === null) return null
  return { optIn }
}

function parseStats(v: unknown): MeSummaryResponse['stats'] | null {
  if (!isPlainObject(v)) return null
  const learnedCount = num(v.learnedCount)
  const practicedCount = num(v.practicedCount)
  const streakDays = num(v.streakDays)
  const totalScore = num(v.totalScore)
  if (learnedCount === null || practicedCount === null || streakDays === null || totalScore === null) {
    return null
  }
  // lastActiveDay 是 `.nullable()`：从未活跃 = null（不是 ''）；缺键判 MALFORMED
  if (v.lastActiveDay !== null && typeof v.lastActiveDay !== 'string') return null
  return {
    learnedCount,
    practicedCount,
    streakDays,
    lastActiveDay: v.lastActiveDay === null ? null : (v.lastActiveDay as string),
    totalScore
  }
}

function parseRiceBox(v: unknown): MeSummaryResponse['rice'] | null {
  if (!isPlainObject(v)) return null
  const balance = num(v.balance)
  const earnedTotal = num(v.earnedTotal)
  const spentTotal = num(v.spentTotal)
  if (balance === null || earnedTotal === null || spentTotal === null) return null
  return { balance, earnedTotal, spentTotal }
}

function parseBoardBox(v: unknown): MeSummaryResponse['leaderboard'] | null {
  if (!isPlainObject(v)) return null
  // rankAllTime 是 `.nullable()`（无分 = null，不是 0）：缺键判 MALFORMED
  if (v.rankAllTime !== null && num(v.rankAllTime) === null) return null
  const scoreAllTime = num(v.scoreAllTime)
  const scoreToday = num(v.scoreToday)
  const optedIn = bool(v.optedIn)
  if (scoreAllTime === null || scoreToday === null || optedIn === null) return null
  return {
    rankAllTime: v.rankAllTime === null ? null : (v.rankAllTime as number),
    scoreAllTime,
    scoreToday,
    optedIn
  }
}

function parseMeSummary(v: unknown): MeSummaryResponse | null {
  if (!isPlainObject(v)) return null
  const stats = parseStats(v.stats)
  const rice = parseRiceBox(v.rice)
  const leaderboard = parseBoardBox(v.leaderboard)
  if (stats === null || rice === null || leaderboard === null) return null
  return { stats, rice, leaderboard }
}

// ---------------------------------------------------------------- 主入口

const PATH_LEADERBOARD = '/v1/leaderboard'
const PATH_OPT_IN = '/v1/me/leaderboard-opt-in'
const PATH_ME_SUMMARY = '/v1/me/summary'

/** 空参数表 = 不带 `?`（不伪造 `?` 空查询串） */
function appendParams(basePath: string, params: string[]): string {
  return params.length === 0 ? basePath : `${basePath}?${params.join('&')}`
}

/**
 * 查询串构造（leaderboard.ts:58-76 querySchema）：period 缺省不拼（服务端必填，
 * 缺省由它的 400 说话，本层不造默认值）；dateKey/limit/cursor 给了才拼。
 * limit 超上限**夹到上限**——leaderboard.ts:74 的 zod `.max(LEADERBOARD_LIMIT_MAX)`
 * 对超限是直接 400，与其发一个注定 400 的请求，不如在这里夹好。
 * cursor/dateKey 一律 encodeURIComponent（见文件头「游标纪律」）。
 */
function buildBoardPath(
  input: { period?: LeaderboardPeriod; dateKey?: string; limit?: number; cursor?: string } | undefined
): string {
  const params: string[] = []
  if (input?.period !== undefined) params.push(`period=${input.period}`)
  if (input?.dateKey !== undefined) params.push(`dateKey=${encodeURIComponent(input.dateKey)}`)
  if (input?.limit !== undefined) params.push(`limit=${Math.min(input.limit, LEADERBOARD_LIMIT_MAX)}`)
  if (input?.cursor !== undefined) params.push(`cursor=${encodeURIComponent(input.cursor)}`)
  return appendParams(PATH_LEADERBOARD, params)
}

export function createCloudLeaderboardClient(deps: CloudLeaderboardDeps): CloudLeaderboardClient {
  const transport = createTransport({
    baseUrl: deps.baseUrl,
    fetch: deps.fetch,
    timeoutMs: deps.timeoutMs,
    logger: deps.logger,
    sleep: deps.sleep
  })

  /** period 是编译期就定死的字面量联合；传进来别的东西 = 绕过了 TS，属于我们自己传错参数 */
  function assertPeriod(period: LeaderboardPeriod): void {
    if (!PERIOD_SET.has(period)) {
      throw new TypeError(`unknown leaderboard period: ${String(period)}`)
    }
  }

  return {
    async getBoard(input): Promise<CloudResult<LeaderboardResponse>> {
      // 参数护栏先于 token 检查（同 docs.ts 的 assertDocType）：这是"我们自己传错"，
      // 不是"没登录"——绕过 TS 的调用方在这里就被拦下，一个包都不发
      if (input?.period !== undefined) assertPeriod(input.period)
      const token = deps.tokens.get()
      if (token === null) return { ok: false, failure: UNLOGGED }
      const result = await transport.request({ method: 'GET', path: buildBoardPath(input), token })
      if (!result.ok) return result
      const parsed = parseBoard(result.data)
      if (parsed === null) return { ok: false, failure: malformed('leaderboard response') }
      return cloudOk(parsed)
    },

    async setOptIn(input): Promise<CloudResult<OptInResponse>> {
      const token = deps.tokens.get()
      if (token === null) return { ok: false, failure: UNLOGGED }
      // 只重建认识的键（同 docs.ts 的 put）：渲染层多塞的东西不跟着出去。
      // 幂等（me.ts:178-181）→ 失败后重发安全，但重发由调用方决定，本层零重试兜底
      const result = await transport.request({
        method: 'PUT',
        path: PATH_OPT_IN,
        token,
        body: { optIn: input.optIn }
      })
      if (!result.ok) return result
      const parsed = parseOptIn(result.data)
      if (parsed === null) return { ok: false, failure: malformed('leaderboard opt-in response') }
      return cloudOk(parsed)
    },

    async summary(input): Promise<CloudResult<MeSummaryResponse>> {
      const token = deps.tokens.get()
      if (token === null) return { ok: false, failure: UNLOGGED }
      const params: string[] = []
      if (input?.dateKey !== undefined) params.push(`dateKey=${encodeURIComponent(input.dateKey)}`)
      const result = await transport.request({ method: 'GET', path: appendParams(PATH_ME_SUMMARY, params), token })
      if (!result.ok) return result
      const parsed = parseMeSummary(result.data)
      if (parsed === null) return { ok: false, failure: malformed('me summary response') }
      return cloudOk(parsed)
    }
  }
}
