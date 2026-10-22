/**
 * 挑战结算云客户端（薄）—— 一个动作：settle。
 *
 * 【这一层是什么】每日挑战的**唯一结算口**：逐题事实（对错/难度/题型）上行，
 * 服务端按 §7.2 复核难度、§5 唯一算分，回一份已结算摘要。客户端不预览分数、
 * 不自己算分（预览在渲染层另有口径），本层只负责把请求发对、把响应认对。
 *
 * 【幂等与 409 是这一层的重点】
 *   · 幂等键 = submissionId + **整个 payload 的 sha256**（challenge.ts:151 + :257）。
 *     网络层会重发同一个请求（transport 对 POST /v1/challenge/days 登记了 2 次重试），
 *     服务端把"同 submissionId 且同 payload"的重放判成 200 + idempotent:true
 *     （返回库中值）——所以重试不需要本层做任何事，**也不能**在重试时改动请求体。
 *   · 已结算日再交一批不同的 → 409 CHALLENGE_DUPLICATE，details={settledAt, score}
 *     （challenge.ts:166-168）。这是"你已经结算过了"的诚实读数，本层**原样透传**：
 *     不改写 code、不吞 details（调用方要靠 settledAt/score 判断是不是自己刚才那批）。
 *
 * 【形状纪律，与 docs.ts 同款】服务端是权威，但"权威"不等于"永远回形状正确的东西"。
 * 认不出的形状一律 MALFORMED_RESPONSE。尤其 `settled` 是 zod literal(true)
 * （challenge.ts:87）：200 里它不是 true = 认不出的形状，**不许**当成"还没结算"放行。
 *
 * 【token】注入的 TokenStore；没 token 时一个包都不发（UNLOGGED）。
 */
import type {
  ChallengeSettleRequest,
  ChallengeSettleResponse,
  CloudFailure,
  CloudResult
} from '../../shared/cloud/dto'
import { cloudOk, createTransport, type CloudLogger, type FetchLike } from './transport'
import type { TokenStore } from './account'

export interface CloudChallengeDeps {
  baseUrl: string
  fetch: FetchLike
  timeoutMs?: number
  logger?: CloudLogger
  /** 重试退避的等待实现（注入缝，见 transport 的 CloudTransportDeps.sleep） */
  sleep?: (ms: number) => Promise<void>
  /** 与账号客户端共用同一个 store —— 登录一次，两边都看得到 */
  tokens: TokenStore
}

export interface CloudChallengeClient {
  /**
   * POST /v1/challenge/days —— 一天一批（PK = account_id + dateKey，先到先得）。
   * 200 = 已结算/幂等重放（看 idempotent）；409 = 这天已经有另一批了（看 details）。
   */
  settle(body: ChallengeSettleRequest): Promise<CloudResult<ChallengeSettleResponse>>
}

// ---------------------------------------------------------------- 形状校验

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

function parseStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const out: string[] = []
  for (const item of v) {
    if (typeof item !== 'string') return null
    out.push(item)
  }
  return out
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

function parseSettleResponse(v: unknown): ChallengeSettleResponse | null {
  if (!isPlainObject(v)) return null
  // settled 是 zod literal(true)：200 但派不出 true = 认不出的形状（没有"未结算"这个成功分支）
  if (v.settled !== true) return null
  const idempotent = bool(v.idempotent)
  const dateKey = str(v.dateKey)
  const correct = num(v.correct)
  const total = num(v.total)
  const score = num(v.score)
  const scoreMax = num(v.scoreMax)
  if (
    idempotent === null ||
    dateKey === null ||
    correct === null ||
    total === null ||
    score === null ||
    scoreMax === null
  ) {
    return null
  }
  const flags = parseStringArray(v.flags)
  if (flags === null) return null
  return { settled: true, idempotent, dateKey, correct, total, score, scoreMax, flags }
}

// ---------------------------------------------------------------- 主入口

const PATH_CHALLENGE_DAYS = '/v1/challenge/days'

export function createCloudChallengeClient(deps: CloudChallengeDeps): CloudChallengeClient {
  const transport = createTransport({
    baseUrl: deps.baseUrl,
    fetch: deps.fetch,
    timeoutMs: deps.timeoutMs,
    logger: deps.logger,
    sleep: deps.sleep
  })

  return {
    async settle(body): Promise<CloudResult<ChallengeSettleResponse>> {
      const token = deps.tokens.get()
      if (token === null) return { ok: false, failure: UNLOGGED }
      // 请求体原样发（形状由 dto 的 ChallengeSettleRequest 在编译期守住）——
      // 尤其 submissionId 与 questions 必须与幂等判定的那份 payload 一模一样，
      // 本层不做任何"顺手修补"，免得把一次重放偷偷变成另一批。
      const result = await transport.request({ method: 'POST', path: PATH_CHALLENGE_DAYS, token, body })
      // 409 CHALLENGE_DUPLICATE 走这里原样上行：code / message / httpStatus / details
      // 一个都不改（details.settledAt + details.score 是调用方的裁决依据）
      if (!result.ok) return result
      const parsed = parseSettleResponse(result.data)
      if (parsed === null) return { ok: false, failure: malformed('challenge settle response') }
      return cloudOk(parsed)
    }
  }
}
