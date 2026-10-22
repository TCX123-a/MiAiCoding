/**
 * 跨设备文档合并（P10.4）—— 纯函数，不碰文件系统、不碰网络、不读时钟。
 *
 * 【它在同步里的位置】同步引擎把「本机磁盘上的文档」与「云端拉下来的文档」
 * 交给这里的四个 `merge*Doc()`，拿回合并后的完整文档 + `changed` 标记，
 * 再决定写盘 / 回传。四个口都吃 `unknown`：非对象的一侧按 `{}` 算
 * （新设备上还没这个文件、或者对端那份压根是坏的），绝不抛。
 *
 * 【本文件是「合并应用口」，不是用户写口（docs/22 §7.1-8）】
 * 用户写口（src/main/store/*-apply.ts、*-merge.ts）负责维护墓碑：
 * 「集合缩小」= 用户删除 → 盖一枚 now 墓碑。合并应用口**不维护墓碑** ——
 * 它只合并既有墓碑、按「新者胜」裁决，**绝不在合并里新铸墓碑**。
 * 合并造成的集合收缩（一侧压根没有这个 id）若盖上 now 墓碑，会被推到所有
 * 设备上，把一次并集误记成一次跨设备删除。所以本文件里没有一处 `= now` 的盖章动作。
 *
 * 【权威】docs/21 §8.3 的逐文件合并矩阵。wrongbook 一节逐字复刻
 * src/main/store/wrongbook-merge.ts 的复活语义（那一条有自己的测试形态，
 * 这里只是把单设备的「再答错 / 再看一遍」搬到两台设备之间）。
 * 窗口内定稿的口径（矩阵没写到毫秒级的那几处）在各自函数头注明，测试钉着。
 *
 * 【收敛 —— 两条规矩一起守】
 *   · 所有数组集合按**确定的规范序**输出（排序键在每节注释里注明）；
 *   · 时间戳平局、内容不同的冲突用「canonical JSON 串大者胜」——
 *     两台设备各自合并同一对 (a,b) 会算出**同一个赢家**（串相同则值深度相等），
 *     数组顺序也逐字节一致，不会出现「A 机丢左、B 机丢右」的永久分歧。
 *
 * 【幂等】merge(x, x) ⇒ changed = false（对规范形输入）。changed 用深度比较
 * （键顺序不同不算不同）—— 裸 JSON 字符串比较会在键序变化时报 changed，
 * 同步器于是每轮空转写盘 + 推送。
 *
 * 【保留区】两侧的未知键（含已知对象的未知子键、数组元素的未知字段）
 * 一律保留（docs/21 §8.3 的保留区责任）：老客户端不认识的字段不能因为
 * 一次合并被抹掉。未知键冲突同样是 canonical 大者胜（对称 ⇒ 收敛）。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律 english**，中文只出现在注释里。
 */
import {
  CURRENT_FAVORITES_VERSION,
  CURRENT_PRACTICE_VERSION,
  CURRENT_PROFILE_VERSION,
  CURRENT_WRONGBOOK_VERSION,
  PRACTICE_KEEP_SESSIONS
} from '../types'
import { CHECKIN_DAYS_MAX, EPOCH0_ISO, countOf, dayKeyOf, recomputeStats } from '../profile-migrate'
import { parseDateKey } from '../dates'
import { parseQuestionKey } from '../question-key'
// 平局裁决的裁判（canonical JSON 大者胜）与同步引擎的文档哈希共用**同一份**
// 序列化实现（P10.3 接口冻结）—— 两份实现漂移会让「同不同」的判据永远收敛不了。
// 那个文件零 import，无环。
import { canonicalJson } from './canonical-json'
import { DATE_KEY_RE, RICE_ENTRY_KEY_RE } from './protocol'

export interface DocMergeResult {
  /** 合并后的完整文档（保留区：两侧未知键全保留） */
  merged: Record<string, unknown>
  /** merged 与本侧（local）语义上不同（深度相等比较；键顺序不同不算不同） */
  changed: boolean
}

// ---------------------------------------------------------------- 通用小工具

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 任意一侧 → 对象；非对象按「什么都没有」算（新设备的空档 / 对端坏载荷） */
function asObject(v: unknown): Record<string, unknown> {
  return isObject(v) ? v : {}
}

/** 非空字符串才算数；空的、纯空白的、非字符串一律 null（与三个 store 清洗器的 str 同口径） */
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/** [a, b] 里较大的字符串（null = 「没有」，输给任何真实值） */
function maxStr(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  return a > b ? a : b
}

/** 深度相等（键顺序不同不算不同）。合并里所有「变了没有」的判断都走它 */
function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqualJson(a[i], b[i])) return false
    }
    return true
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false
      if (!deepEqualJson(a[k], b[k])) return false
    }
    return true
  }
  return false
}

/**
 * 平局裁判：canonical JSON 大者胜（串相同 ⇒ 深度相等 ⇒ 取谁都一样）。
 * 裁判本人从 ./canonical-json import —— 与同步引擎的文档哈希是同一份实现
 * （P10.3 接口冻结）：两份实现漂移会让「同不同」的判据永远收敛不了。
 */
function canonicalPick<T>(a: T, b: T): T {
  return canonicalJson(a) >= canonicalJson(b) ? a : b
}

/**
 * 保留区：两对象的**键并集**。只在一侧出现的键原样保留；同名键内容不同 →
 * canonical 大者胜。返回新对象；绝不就地改传进来的两份。
 */
function unionKeys(l: Record<string, unknown>, r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...l }
  for (const [k, v] of Object.entries(r)) {
    if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = v
    else if (!deepEqualJson(out[k], v)) out[k] = canonicalPick(out[k], v)
  }
  return out
}

/**
 * 同一身份、两侧内容冲突时的元素合并：按 timeOf 新者胜（不传=没有可比的
 * 时间戳，平局 canonical 大者胜），**输家独有的字段留下** —— 「只取赢家整份」
 * 会静默丢掉另一侧的新字段（保留区纪律的对象版；删字段这类"负信息"不在此列，
 * 收藏的删除由墓碑表承载，不在元素里表达）。
 */
function mergeElement(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  timeOf?: (e: Record<string, unknown>) => string
): Record<string, unknown> {
  const ta = timeOf ? timeOf(a) : EPOCH0_ISO
  const tb = timeOf ? timeOf(b) : EPOCH0_ISO
  const winner = ta === tb ? canonicalPick(a, b) : ta > tb ? a : b
  const loser = winner === a ? b : a
  return { ...loser, ...winner }
}

/** 字符串数组字段的清洗：非空字符串、去重（与 profile-migrate.cleanList 同口径） */
function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of v) {
    if (typeof item !== 'string' || item.trim() === '') continue
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

/** Record<id, ISO> 表的清洗：非空字符串键 → 非空字符串值（与 cleanTimeMap 同口径） */
function timeMap(v: unknown): Record<string, string> {
  const map: Record<string, string> = {}
  if (!isObject(v)) return map
  for (const [key, value] of Object.entries(v)) {
    if (key.trim() === '' || typeof value !== 'string' || value.trim() === '') continue
    map[key] = value
  }
  return map
}

/** 多个键集合的确定性并集（升序）—— 输出的每个遍历都走它，字节序才稳 */
function unionKeysSorted(...maps: readonly string[][]): string[] {
  return [...new Set(maps.flat())].sort()
}

// ---------------------------------------------------------------- profile

/** 一组开关式集合（learned 或课程级 favorites）的合并结果 */
interface ToggleMerge {
  ids: string[]
  at: Record<string, string>
  tombstones: Record<string, string>
}

/**
 * 「id 列表 + 时间戳表 + 墓碑表」三件套的合并（learned 与课程级 favorites 共用）。
 *
 * 裁决（docs/21 §8.3 第 1 行）：
 *   · 集合 = 两侧并集；id 的条目时刻取两侧时间戳的 max，
 *     两边都没有时间戳（老档案）回填 EPOCH0（不伪造 now，理由见它的定义）；
 *   · 墓碑时刻取两侧 max；**墓碑严格更新才删条目**（tomb > entryAt）——
 *     相等不算删（平局偏保守方向：宁可多留一条，不静默丢），
 *     与用户写口「重新标记 = 撤销墓碑」互为镜像；
 *   · 墓碑胜出的 id：条目删、墓碑**留在输出**（别的设备还要靠它）；
 *   · 条目胜出 / 平局的 id：条目留、墓碑销掉；
 *   · 两侧都没有对应条目的旧墓碑：取 max 原样保留（那是「添加过、后来移除」的证据）。
 * 输出的 ids 升序、两张表按键升序插入 —— 规范序，两台设备字节一致。
 */
function mergeToggles(
  l: Record<string, unknown>,
  r: Record<string, unknown>,
  listKey: string,
  atKey: string,
  tombKey: string,
  lTomb: Record<string, unknown>,
  rTomb: Record<string, unknown>
): ToggleMerge {
  const lAt = timeMap(l[atKey])
  const rAt = timeMap(r[atKey])
  const lT = timeMap(lTomb[tombKey])
  const rT = timeMap(rTomb[tombKey])
  const union = unionKeysSorted(strList(l[listKey]), strList(r[listKey]))

  // 时间戳表：两侧并集取 max。含不在集合里的旧时间戳 —— 那是「添加过、后来移除」
  // 的证据，读口（profile-migrate）也原样留着它们，合并没有理由丢
  const at: Record<string, string> = {}
  for (const id of unionKeysSorted(Object.keys(lAt), Object.keys(rAt))) {
    const t = maxStr(lAt[id] ?? null, rAt[id] ?? null)
    if (t !== null) at[id] = t
  }

  const tombOut: Record<string, string> = {}
  const surviving = new Set<string>()
  for (const id of union) {
    const entryAt = at[id] ?? EPOCH0_ISO
    at[id] = entryAt
    const tomb = maxStr(lT[id] ?? null, rT[id] ?? null)
    if (tomb !== null && tomb > entryAt) {
      tombOut[id] = tomb // 墓碑严格更新：删条目、墓碑留证
    } else {
      surviving.add(id) // 条目胜出或平局：条目留、墓碑销掉
    }
  }
  // 两侧都有、但两边集合里都没有的旧墓碑：取 max 保留（写口不碰它们，合并也不碰）
  for (const id of unionKeysSorted(Object.keys(lT), Object.keys(rT))) {
    if (surviving.has(id) || id in tombOut) continue
    const tomb = maxStr(lT[id] ?? null, rT[id] ?? null)
    if (tomb !== null) tombOut[id] = tomb
  }

  return { ids: [...surviving].sort(), at, tombstones: tombOut }
}

/**
 * 学习历史：先按 **`(lessonId, finishedAt)`** 去重（同一条完成记录只可能来自
 * 同一次学习；两侧同名记录按元素合并、未知字段留下），再并集，
 * 最后 **`(finishedAt` 升序, `lessonId` 升序`)`** 规范排序。
 * 【排序键必须写死】只写「按时间排」而不说并列怎么办，两台设备会各自按
 * 稳定序留成两种顺序，同步永远收敛不了；(lessonId, finishedAt) 是这条记录的
 * 完整身份，拿它破并天然确定。
 */
function mergeHistory(lv: unknown, rv: unknown): Record<string, unknown>[] {
  const byKey = new Map<string, Record<string, unknown>>()
  for (const raw of [...(Array.isArray(lv) ? lv : []), ...(Array.isArray(rv) ? rv : [])]) {
    if (!isObject(raw)) continue
    const lessonId = str(raw.lessonId)
    const finishedAt = str(raw.finishedAt)
    if (lessonId === null || finishedAt === null) continue
    const key = JSON.stringify([lessonId, finishedAt])
    const prev = byKey.get(key)
    byKey.set(key, prev === undefined ? { ...raw } : mergeElement(prev, raw))
  }
  const out = [...byKey.values()]
  out.sort((a, b) => {
    const fa = str(a.finishedAt) ?? ''
    const fb = str(b.finishedAt) ?? ''
    if (fa !== fb) return fa < fb ? -1 : 1
    const la = str(a.lessonId) ?? ''
    const lb = str(b.lessonId) ?? ''
    if (la !== lb) return la < lb ? -1 : 1
    return 0
  })
  return out
}

/** 合法日键（格式 + 真实存在的日子）才算数 —— cleanCheckin 的判据，缺一不可 */
function dayKey(v: unknown): string | null {
  if (typeof v !== 'string') return null
  return DATE_KEY_RE.test(v) && parseDateKey(v) !== null ? v : null
}

function daysOf(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((d): d is string => dayKey(d) !== null)
}

/**
 * 签到合并（四条规则，2026-10-10 P10.4 定稿；原则 = 并集、max、不静默丢数据）：
 *   · days：两侧合法日键并集升序，超 CHECKIN_DAYS_MAX 截**尾部**（保留最新，
 *     与 cleanCheckin 的容量取舍一字不差）；
 *   · lastDate：两侧 lastDate 与 max(days) 的**最大者**（日键定长补零，
 *     字符串序 = 时间序）；全空 → null。明细里的最新一天一定是签过的，
 *     它同时兜住「一侧 lastDate 写丢了」的情形；
 *   · streakDays：取 **lastDate 较晚**那一侧的值 —— applyCheckin 的 streak 是
 *     「从 lastDate 的明天接续、断签清零」的，较晚那侧才代表它现在的连续段；
 *     平局（含两侧都 null）取较大值，保守方向，不静默砍掉；
 *   · totalDays：两侧取 max，再抬到 days.length 下界 —— applyCheckin 里
 *     totalDays 只增不减，cleanCheckin 又有「证据下界」先例（明细里每一天
 *     都是真签过的，totalDays 比明细数小是自相矛盾的档）。
 */
function mergeCheckin(lv: unknown, rv: unknown): { state: Record<string, unknown>; streakDays: number } {
  const l = asObject(lv)
  const r = asObject(rv)
  const state = unionKeys(l, r)

  const days = unionKeysSorted(daysOf(l.days), daysOf(r.days))
  const kept = days.length > CHECKIN_DAYS_MAX ? days.slice(days.length - CHECKIN_DAYS_MAX) : days

  const lLast = dayKey(l.lastDate)
  const rLast = dayKey(r.lastDate)
  const anchor = kept.length > 0 ? kept[kept.length - 1] : null
  const lastDate = maxStr(maxStr(lLast, rLast), anchor)

  const lStreak = countOf(l.streakDays, 0)
  const rStreak = countOf(r.streakDays, 0)
  let streakDays: number
  if (lLast !== null && (rLast === null || lLast > rLast)) streakDays = lStreak
  else if (rLast !== null && (lLast === null || rLast > lLast)) streakDays = rStreak
  else streakDays = Math.max(lStreak, rStreak)

  state.days = kept
  state.lastDate = lastDate
  state.streakDays = streakDays
  state.totalDays = Math.max(countOf(l.totalDays, 0), countOf(r.totalDays, 0), kept.length)
  return { state, streakDays }
}

/**
 * profile.json 的跨设备合并（docs/21 §8.3 第 1 行）。
 * 输出 version 一律 = CURRENT_PROFILE_VERSION。
 */
export function mergeProfileDoc(local: unknown, remote: unknown): DocMergeResult {
  const l = asObject(local)
  const r = asObject(remote)
  const merged = unionKeys(l, r)
  merged.version = CURRENT_PROFILE_VERSION

  // ── learned / 课程级 favorites：并集 × 墓碑新者胜（mergeToggles） ──
  const lTomb = asObject(l.tombstones)
  const rTomb = asObject(r.tombstones)
  const tombstones = unionKeys(lTomb, rTomb) // 未知子键（将来的第三张表）照留
  const learned = mergeToggles(l, r, 'learned', 'learnedAt', 'learned', lTomb, rTomb)
  const favorites = mergeToggles(l, r, 'favorites', 'favoriteAt', 'lessonFavorites', lTomb, rTomb)
  merged.learned = learned.ids
  merged.learnedAt = learned.at
  merged.favorites = favorites.ids
  merged.favoriteAt = favorites.at
  tombstones.learned = learned.tombstones
  tombstones.lessonFavorites = favorites.tombstones
  merged.tombstones = tombstones

  merged.history = mergeHistory(l.history, r.history)

  // ── 签到（四条规则见 mergeCheckin）──
  const checkin = mergeCheckin(l.checkin, r.checkin)
  merged.checkin = checkin.state

  // ── stats：不搬运，按读时重算规则重算（docs/21 §8.3「stats 不并入」）──
  // 公式唯一一份在 profile-migrate.recomputeStats。learnedCount 由并集后的
  // learned 派生；streakDays 跟着并集后的签到走；practicedCount 是单调计数
  // （只增不减），两侧各自清洗后取 max。未知子键照保留区纪律留下。
  const lStats = asObject(l.stats)
  const rStats = asObject(r.stats)
  const stats = unionKeys(lStats, rStats)
  Object.assign(
    stats,
    recomputeStats(
      learned.ids,
      { practicedCount: Math.max(countOf(lStats.practicedCount, 0), countOf(rStats.practicedCount, 0)) },
      { streakDays: checkin.streakDays }
    )
  )
  merged.stats = stats

  // ── rewards：gallery 并集升序、perfectPasses 取 max、lastImageDay 取较晚，
  //    未知子键保留 ──
  const lRewards = asObject(l.rewards)
  const rRewards = asObject(r.rewards)
  const rewards = unionKeys(lRewards, rRewards)
  rewards.gallery = unionKeysSorted(strList(lRewards.gallery), strList(rRewards.gallery))
  rewards.perfectPasses = Math.max(countOf(lRewards.perfectPasses, 0), countOf(rRewards.perfectPasses, 0))
  // lastImageDay（v5）：「最近一次真发出图的日子」取**较晚**的那个 ——
  // 字符串序=时间序（dates.ts 定长补零那条约定）。取较晚同时是**较严**的一边：
  // 每日一次判据是 `day <= lastImageDay`，两台设备各自发过图时，较晚的锚
  // 让两边都直接进入"今天已拿过"的档。与 gallery 的并集同方向：合并不放开限制。
  // 坏键一律当"没有"（dayKeyOf 与档案迁移共用的那把尺子），否则一个坏键
  // 会让判据对任何日子恒真、图永远发不出来。两个都合法时 maxStr 取的就是较晚那个。
  rewards.lastImageDay = maxStr(dayKeyOf(lRewards.lastImageDay), dayKeyOf(rRewards.lastImageDay))
  merged.rewards = rewards

  return { merged, changed: !deepEqualJson(merged, l) }
}

// ---------------------------------------------------------------- wrongbook

/** 一条错题的次数：**至少 1**（wrongbook-merge.times 的口径：在库=至少错过一次） */
function times(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1
  return Math.max(Math.round(v), 1)
}

/**
 * `cleared` / `removed` 旗子的裁决 —— 「较新的事件胜」：
 * 事件时刻（clearedAt / removedAt）与**两侧最新一次答错**（lastWrongAt 的 max）
 * 比较：严格更新 → 旗子为真、时刻随旗；相等或更旧 → 旗子为假、时刻一并抹掉。
 *
 * 【为什么是「严格更新才复活」】单设备的 mergeWrongRecord 里再答错一律把
 * cleared / removed 清掉（`delete ex.clearedAt` / `delete ex.removedAt`）——
 * 同一时刻的「清」和「错」谁先谁后无法分辨，偏保守方向：留条目（宁可多留，
 * 不静默丢；界面上最多多看一眼，不会丢数据）。缺时间戳按最旧算 ——
 * 它输给任何真实的答错时刻。
 *
 * 【写回形状照 cleanEntry 的口径】cleared 是必填布尔（丢旗子写 false）；
 * removed 只在 true 时写字段（字段在 = 删过），丢旗子时**摘键**。
 */
function applyEventFlag(
  out: Record<string, unknown>,
  flag: string,
  atKey: string,
  l: Record<string, unknown>,
  r: Record<string, unknown>,
  lastWrongAt: string,
  omitWhenFalse: boolean
): void {
  const lEvt = l[flag] === true ? str(l[atKey]) ?? EPOCH0_ISO : null
  const rEvt = r[flag] === true ? str(r[atKey]) ?? EPOCH0_ISO : null
  const newest = maxStr(lEvt, rEvt)
  if (newest !== null && newest > lastWrongAt) {
    out[flag] = true
    out[atKey] = newest
    return
  }
  if (omitWhenFalse) delete out[flag]
  else out[flag] = false
  delete out[atKey]
}

/** 两侧的字符串取一：时刻新的一侧胜；它没带（null）→ 留旧一侧的；
 * 时刻平局 → 相同取该值，不同 canonical 大者胜（对称 ⇒ 收敛） */
function pickSideValue(lv: string | null, rv: string | null, lt: string, rt: string): string | null {
  if (lt !== rt) return (lt > rt ? lv : rv) ?? (lt > rt ? rv : lv)
  if (lv === null) return rv
  if (rv === null) return lv
  return lv === rv ? lv : canonicalPick(lv, rv)
}

/**
 * 一条错题在**两台设备之间**的字段级合并 —— 单设备版在
 * src/main/store/wrongbook-merge.ts（`mergeWrongRecord`），复活语义逐条搬过来。
 * 单设备那边的 `now` 在这里换成两侧各自带的时刻，语义一字不动：
 *
 *   · lastWrongAt：max；缺时间戳按**最旧**算（UNKNOWN_TIME 口径），
 *     它输给任何真实的答错时刻；
 *   · wrongCount：max（累计次数只增不减）；
 *   · cleared / removed：与 lastWrongAt 比「严格新者胜」（applyEventFlag）——
 *     「较新的答错把清除/移除复活」这一条的跨设备版；
 *   · hole：取或（true 恒胜），都无则字段不存在（「字段在 = 真」的读法）；
 *   · source：跟随**较大 lastWrongAt** 的一侧；较大侧没带 → 留旧徽章
 *     （mergeWrongRecord:153「老条目再错、没带 source ⇒ 原徽章留住」）；
 *   · ai：跟随较大 lastWrongAt 的一侧（「本体跟着最新刷新」，一侧缺 → 留住另一侧，
 *     防死条目）；时刻平局 canonical 大者胜；
 *   · lessonId / qid：**从 key 重算**（cleanEntry 的口径：key 才是身份，
 *     文件里写歪的那份不听）。
 */
function mergeWrongEntry(
  key: string,
  lv: Record<string, unknown> | undefined,
  rv: Record<string, unknown> | undefined
): Record<string, unknown> {
  const l = lv ?? {}
  const r = rv ?? {}
  const out = unionKeys(l, r)

  out.key = key
  const lWrongAt = str(l.lastWrongAt) ?? EPOCH0_ISO
  const rWrongAt = str(r.lastWrongAt) ?? EPOCH0_ISO
  const lastWrongAt = lWrongAt > rWrongAt ? lWrongAt : rWrongAt
  out.lastWrongAt = lastWrongAt
  out.wrongCount = Math.max(times(l.wrongCount), times(r.wrongCount))

  applyEventFlag(out, 'cleared', 'clearedAt', l, r, lastWrongAt, false)
  applyEventFlag(out, 'removed', 'removedAt', l, r, lastWrongAt, true)

  // hole 取或：洞是真状态（「这道题没选项/给不出答案」），不可回退
  if (l.hole === true || r.hole === true) out.hole = true
  else delete out.hole

  const source = pickSideValue(str(l.source), str(r.source), lWrongAt, rWrongAt)
  if (source !== null) out.source = source
  else delete out.source

  const lAi = isObject(l.ai) ? l.ai : null
  const rAi = isObject(r.ai) ? r.ai : null
  let ai: Record<string, unknown> | null
  if (lWrongAt !== rWrongAt) ai = (lWrongAt > rWrongAt ? lAi : rAi) ?? (lWrongAt > rWrongAt ? rAi : lAi)
  else if (lAi === null) ai = rAi
  else if (rAi === null) ai = lAi
  else ai = canonicalPick(lAi, rAi)
  if (ai !== null) out.ai = ai
  else delete out.ai

  // lessonId / qid 重算（理由见函数头最后一条）
  const { lessonId, qid } = parseQuestionKey(key)
  out.lessonId = lessonId
  out.qid = qid

  return out
}

/** entries 数组 → key 索引（一侧内重复的 key 按元素合并 —— 确定的，坏文件也能收敛） */
function entriesOf(v: unknown): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>()
  if (!Array.isArray(v)) return map
  for (const raw of v) {
    if (!isObject(raw)) continue
    const key = str(raw.key)
    if (key === null) continue
    const prev = map.get(key)
    map.set(key, prev === undefined ? { ...raw } : mergeElement(prev, raw))
  }
  return map
}

/**
 * wrongbook.json 的跨设备合并（docs/21 §8.3 第 4 行）。entries 键并集、
 * 按 key 升序输出，逐条走 mergeWrongEntry；version = CURRENT_WRONGBOOK_VERSION。
 *
 * 【不在这里裁 AI_WRONG_CAP】上限裁剪在记录写口（wrongbook-merge.trimAi）——
 * 合并只做并集与裁决，剪枝会静默丢条目，不是合并该干的（矩阵里也没有这一条）。
 */
export function mergeWrongbookDoc(local: unknown, remote: unknown): DocMergeResult {
  const l = asObject(local)
  const r = asObject(remote)
  const merged = unionKeys(l, r)
  merged.version = CURRENT_WRONGBOOK_VERSION

  const lEntries = entriesOf(l.entries)
  const rEntries = entriesOf(r.entries)
  const keys = unionKeysSorted([...lEntries.keys()], [...rEntries.keys()])
  merged.entries = keys.map((key) => mergeWrongEntry(key, lEntries.get(key), rEntries.get(key)))

  return { merged, changed: !deepEqualJson(merged, l) }
}

// ---------------------------------------------------------------- favorites

/** 条目身份 = key；时刻 = updatedAt ?? addedAt ?? 最古老（cleanItem 的回填口径） */
function itemKeyOf(e: Record<string, unknown>): string | null {
  return str(e.key)
}
function itemTimeOf(e: Record<string, unknown>): string {
  return str(e.updatedAt) ?? str(e.addedAt) ?? EPOCH0_ISO
}

/** 文件夹身份 = id；时刻 = updatedAt ?? createdAt ?? 最古老（cleanFolder 的回填口径） */
function folderIdOf(e: Record<string, unknown>): string | null {
  return str(e.id)
}
function folderTimeOf(e: Record<string, unknown>): string {
  return str(e.updatedAt) ?? str(e.createdAt) ?? EPOCH0_ISO
}

interface KeyedAdjudication {
  list: Record<string, unknown>[]
  tombstones: Record<string, string>
}

/**
 * 「条目数组 + 同名墓碑表」的裁决（收藏的 items / folders 共用）：
 *   · 同 id 条目：时刻（timeOf）新者胜；平局且内容不同 → canonical 大者胜 ——
 *     **两台设备各自独立算出同一个赢家 ⇒ 收敛**（等时戳不同内容的平局若不裁决，
 *     "各自保留本地那份"就是永久分歧：A 机 note 是甲的、B 机是乙的）；
 *   · 条目 vs 墓碑：墓碑时刻取两侧 max，**严格更新才删条目**
 *     （与 profile 的 mergeToggles 同一条规矩，镜像 favorites-merge.applyToggles
 *     的「载荷里存在的 id 一律撤销墓碑」）；
 *   · 撤不掉条目 / 没有条目对应的旧墓碑：原样保留（别人设备的删除证据）。
 * 输出 list 按 id 升序、墓碑表按键升序 —— 规范序。
 */
function adjudicate(
  lList: unknown,
  rList: unknown,
  idOf: (e: Record<string, unknown>) => string | null,
  timeOf: (e: Record<string, unknown>) => string,
  lTomb: Record<string, string>,
  rTomb: Record<string, string>
): KeyedAdjudication {
  const byId = new Map<string, Record<string, unknown>>()
  for (const raw of [...(Array.isArray(lList) ? lList : []), ...(Array.isArray(rList) ? rList : [])]) {
    if (!isObject(raw)) continue
    const id = idOf(raw)
    if (id === null) continue
    const prev = byId.get(id)
    byId.set(id, prev === undefined ? { ...raw } : mergeElement(prev, raw, timeOf))
  }

  const list: Record<string, unknown>[] = []
  const surviving = new Set<string>()
  const tombstones: Record<string, string> = {}
  for (const id of [...byId.keys()].sort()) {
    const item = byId.get(id) as Record<string, unknown>
    const tomb = maxStr(lTomb[id] ?? null, rTomb[id] ?? null)
    if (tomb !== null && tomb > timeOf(item)) {
      tombstones[id] = tomb // 墓碑严格更新：删条目、墓碑留证
    } else {
      list.push(item)
      surviving.add(id)
    }
  }
  for (const id of unionKeysSorted(Object.keys(lTomb), Object.keys(rTomb))) {
    if (surviving.has(id) || id in tombstones) continue
    const tomb = maxStr(lTomb[id] ?? null, rTomb[id] ?? null)
    if (tomb !== null) tombstones[id] = tomb
  }
  return { list, tombstones }
}

/**
 * favorites.json 的跨设备合并（docs/21 §8.3 第 5 行）。
 * 信封 updatedAt = 两侧 max（只增不减的"最近变过"标记），version = 当前值。
 */
export function mergeFavoritesDoc(local: unknown, remote: unknown): DocMergeResult {
  const l = asObject(local)
  const r = asObject(remote)
  const merged = unionKeys(l, r)
  merged.version = CURRENT_FAVORITES_VERSION

  const items = adjudicate(l.items, r.items, itemKeyOf, itemTimeOf, timeMap(l.removedItems), timeMap(r.removedItems))
  const folders = adjudicate(
    l.folders,
    r.folders,
    folderIdOf,
    folderTimeOf,
    timeMap(l.removedFolders),
    timeMap(r.removedFolders)
  )

  // 孤儿 folderId 摘键（判据照 favorites-merge.dropOrphanFolders 一字不差：
  // 指向不存在文件夹的条目在任何筛选里都不出现，看着就是"收藏自己少了"）
  const folderIds = new Set(folders.list.map((f) => f.id as string))
  merged.items = items.list.map((it) => {
    if (it.folderId === undefined || folderIds.has(it.folderId as string)) return it
    const next = { ...it }
    delete next.folderId
    return next
  })
  merged.folders = folders.list
  merged.removedItems = items.tombstones
  merged.removedFolders = folders.tombstones

  const updatedAt = maxStr(str(l.updatedAt), str(r.updatedAt))
  if (updatedAt !== null) merged.updatedAt = updatedAt
  else delete merged.updatedAt // 两侧都没有就不发明一个

  return { merged, changed: !deepEqualJson(merged, l) }
}

// ---------------------------------------------------------------- practice

/**
 * (at, uid) 全序 —— at 是定长 ISO 串（字符串序 = 时间序），同一时刻用 uid 破并。
 * 与 practice-merge.ts 的 compareOrder 同口径：超上限裁剪时两端丢的是同几条。
 */
function compareSessionOrder(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const aa = str(a.at) ?? EPOCH0_ISO
  const ba = str(b.at) ?? EPOCH0_ISO
  if (aa !== ba) return aa < ba ? -1 : 1
  const au = str(a.uid) ?? ''
  const bu = str(b.uid) ?? ''
  if (au === bu) return 0
  return au < bu ? -1 : 1
}

/**
 * practice.json 的跨设备合并（docs/21 §8.3 第 6 行）。
 *   · uid 是跨设备身份（`${installId}:${id}`，见 practice-merge 头注释）；
 *     并集，同 uid 内容不同（理论上不该有）canonical 大者胜；
 *   · **`(at, uid)` 全序升序**输出（规范序）；超 PRACTICE_KEEP_SESSIONS
 *     丢全序**最旧**的 —— 只按 at 的话，同一时刻的两条会话在 A 机丢左、
 *     在 B 机丢右，两份文件永远收敛不了（normalizePractice 头注释同一条账）；
 *   · 没有合法 uid 的会话**跨设备定不了身**（数字 id 两台设备会撞号）：
 *     跳过 —— 读口保证磁盘上的会话都有 uid，走到这里的只能是手改坏的文件，
 *     宁可少一条，也不拿一个可能撞号的 id 去去重。
 */
export function mergePracticeDoc(local: unknown, remote: unknown): DocMergeResult {
  const l = asObject(local)
  const r = asObject(remote)
  const merged = unionKeys(l, r)
  merged.version = CURRENT_PRACTICE_VERSION

  const byUid = new Map<string, Record<string, unknown>>()
  for (const raw of [...(Array.isArray(l.history) ? l.history : []), ...(Array.isArray(r.history) ? r.history : [])]) {
    if (!isObject(raw)) continue
    const uid = typeof raw.uid === 'string' && RICE_ENTRY_KEY_RE.test(raw.uid) ? raw.uid : null
    if (uid === null) continue
    const prev = byUid.get(uid)
    byUid.set(uid, prev === undefined ? { ...raw } : mergeElement(prev, raw))
  }

  const history = [...byUid.values()]
  history.sort(compareSessionOrder)
  const excess = history.length - PRACTICE_KEEP_SESSIONS
  merged.history = excess > 0 ? history.slice(excess) : history

  return { merged, changed: !deepEqualJson(merged, l) }
}
