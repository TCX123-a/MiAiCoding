/**
 * profile.json 的**版本迁移** —— 铁律 6 在「学习档案」上的落地。
 *
 * 【为什么档案比配置更需要它】
 * config.json 以前就吃过没迁移的亏（layout 的 version 永远停在 1），
 * 但配置搞坏了顶多是某个开关不对。档案里装的是**这个人学过的东西** ——
 * 一份老结构被新代码当新结构读，`rewards` 是 undefined，
 * 发奖逻辑一读它、或者整份重建，用户攒的进度就**静默清零**了。
 *
 * 【它和 config-migrate.ts 是同一套纪律】
 *   · 纯函数，可单测（最要命的几条：「learned 不能被清空」「version 必须回写」
 *     正是最该被钉死、又最容易被一次「顺手简化」弄坏的）；
 *   · 逐字段搬运，不整体 spread；
 *   · 输入不是对象时给默认档案，**并且出声**（静默重建是铁律禁止的）；
 *   · 产物无条件写成当前版本号。
 *
 * 【和 config-migrate 的一处不同】
 * 配置那边每个字段都有明确的"退回默认值"；档案的数组字段是**逐条清洗**：
 * 坏条目丢掉、好的留下。理由是丢一条历史记录和丢一整份档案完全不是一个量级 ——
 * 能救的必须救，救不了的才丢，丢的时候出声（一条汇总 warn）。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律英文**，中文只出现在注释里。
 */
import {
  CURRENT_PROFILE_VERSION,
  DEFAULT_PROFILE,
  type CheckinState,
  type LessonHistoryEntry,
  type ProfileRewards,
  type ProfileTombstones,
  type UserProfile
} from './types'
// 日键的格式正则**从冻结区 import，不在本文件重写一份**（C14）——
// 两份「什么算合法日键」早晚会漂移，而漂移的症状是「主进程收得进的键、
// 清洗不认」这种只在边界日期上出现的分歧。protocol.ts 零 import，无环。
import { DATE_KEY_RE } from './cloud/protocol'
import { parseDateKey, shiftDateKey } from './dates'

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 清洗一个「id 列表」字段（learned / favorites / rewards.gallery）：
 * 只留非空字符串，且**去重**。
 *
 * 【为什么去重算清洗而不是"顺手规范化"】
 * 这几列在语义上都是**集合**（markLearned 只在不存在时 push）。
 * 重复项一旦进来，`stats.learnedCount = learned.length` 这类派生值就会
 * 虚高 —— 进度条显示 130% 而没有任何东西报错。去重是在恢复它本来的语义。
 *
 * 【为什么不 trim】这些是**身份**（lessonId / 图 id），不是给人看的文本。
 * 带空格的 id 反正是对不上任何东西的死值；但我们**不动它的内容** ——
 * 「顺手规范化」在这类字段上改的是身份本身（config 的 apiKey 那条同理）。
 */
function cleanList(v: unknown): string[] {
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

/** 学习历史：只要「课号 + 时间戳」都像样的条目，坏条目丢掉（丢几条由调用方出声） */
function cleanHistory(v: unknown): LessonHistoryEntry[] {
  if (!Array.isArray(v)) return []
  const out: LessonHistoryEntry[] = []
  for (const item of v) {
    if (!isObject(item)) continue
    if (typeof item.lessonId !== 'string' || item.lessonId.trim() === '') continue
    if (typeof item.finishedAt !== 'string' || item.finishedAt.trim() === '') continue
    out.push({ lessonId: item.lessonId, finishedAt: item.finishedAt })
  }
  return out
}

/**
 * 计数：有限数取整钳到 ≥0，否则退回 fallback。
 * `Number.isFinite` 那一道不能省 —— NaN 能穿过 `Math.max`（和谁比都是 false），
 * 写进文件之后「连续学习 N 天」会显示成 NaN 天。
 *
 * 导出给跨设备合并（shared/cloud/merge.ts）——“一个计数怎么算干净”只能有一份
 * 实现，否则「合并时收得进的数、迁移时不认」这类分歧只会在边界值上现形，
 * 而且没有任何地方报错。
 */
export function countOf(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.max(Math.round(v), 0)
}

/** 日键清洗：合法（格式 + 真实存在的日子）才留，否则 null。
 *  和 cleanCheckin 用同一把尺子（DATE_KEY_RE + parseDateKey 回环）。
 *  导出给跨设备合并 —— "什么算合法日键"只能有一份实现（同 countOf 的理由）。 */
export function dayKeyOf(v: unknown): string | null {
  return typeof v === 'string' && DATE_KEY_RE.test(v) && parseDateKey(v) !== null ? v : null
}

/** 奖励台账：v1 → v2 新增的那一节（v5 补 lastImageDay）。缺失（老档案）就给一份空的 */
function rewardsOf(v: unknown): ProfileRewards {
  if (!isObject(v)) return { gallery: [], perfectPasses: 0, lastImageDay: null }
  return {
    gallery: cleanList(v.gallery),
    perfectPasses: countOf(v.perfectPasses, 0),
    // v5 的「每日一次图」判据。坏键（'2026-2-3'、'2026-02-30'、非字符串）一律退回 null ——
    // null 的含义是"没发过图"，代价最多是今天多发一张；而留着一个坏键，
    // 判据 `day <= lastImageDay` 就可能对**任何**日子恒真，图从此永远发不出来。
    // 清洗的方向永远选"救得回来"的那边。
    lastImageDay: dayKeyOf(v.lastImageDay)
  }
}

/** 清洗掉了多少条（只用来决定要不要出声；输入压根不是数组时不算"丢"） */
function droppedCount(input: unknown, output: unknown[]): number {
  return Array.isArray(input) ? Math.max(input.length - output.length, 0) : 0
}

// ---------------------------------------------------------------- 时间戳与墓碑（v4）

/**
 * 「时间不知道」的占位时刻：**epoch0（1970）**，不是 now。
 *
 * 【为什么不能回填 now —— 这一条是安全方向的分水岭】
 * v4 的时间戳是给合并裁决用的：「条目时间戳 vs 墓碑时间戳，新者胜」。
 * 老档案升级时凭空盖一个 now，等于宣布「这些条目是刚刚才标记的」——
 * 之后任何一条（别的设备发来的、真的比它新的）墓碑都赢不过它，
 * 用户在某台设备上的取消操作会被**永久吞掉**，而且没有任何地方报错。
 * epoch0 的反方向才是安全的：它输给任何真实的墓碑或条目时间，
 * 结算结果最坏也只是「保守方向」（宁可多留一条，不可静默丢）。
 * 这个字面量与 favorites-merge.ts 的 UNKNOWN_TIME 同值 —— 那是先例。
 */
export const EPOCH0_ISO = '1970-01-01T00:00:00.000Z'

/**
 * 清洗一张 `Record<id, ISO时刻>`（learnedAt / favoriteAt / tombstones 两张表共用）。
 * 只留「非空字符串键 → 非空字符串值」，坏条目丢弃并计数（由调用方汇总出声）。
 */
function cleanTimeMap(v: unknown): { map: Record<string, string>; dropped: number } {
  const map: Record<string, string> = {}
  if (!isObject(v)) return { map, dropped: 0 }
  let dropped = 0
  for (const [key, value] of Object.entries(v)) {
    if (key.trim() === '' || typeof value !== 'string' || value.trim() === '') {
      dropped++
      continue
    }
    map[key] = value
  }
  return { map, dropped }
}

/**
 * 清洗墓碑区。缺失（老档案）给空的两张表 —— 绝不 undefined：
 * undefined 一进合并逻辑（`tombstones.learned[id]` 的比较）就是当场抛错。
 */
function cleanTombstones(v: unknown): { tombstones: ProfileTombstones; dropped: number } {
  if (!isObject(v)) return { tombstones: { learned: {}, lessonFavorites: {} }, dropped: 0 }
  const learned = cleanTimeMap(v.learned)
  const lessonFavorites = cleanTimeMap(v.lessonFavorites)
  return {
    tombstones: { learned: learned.map, lessonFavorites: lessonFavorites.map },
    dropped: learned.dropped + lessonFavorites.dropped
  }
}

// ---------------------------------------------------------------- 每日签到（v3）

/**
 * 签到明细的容量：**保留最近 366 天**（C14）。为什么是一年：
 * 月历只画当月、「去年今天签过没有」往回看最多一年，再老的历史没有任何读者；
 * 而它跟着 profile 上云端（有体积门）。366 而不是 365 —— 闰年的一年就是 366 天。
 */
export const CHECKIN_DAYS_MAX = 366

/**
 * 清洗签到明细：把任意「从旧档案里读出来的 checkin」搬成**规范形**
 * （逐条清洗 → 去重 → 升序 → 截最新 366 → 定 lastDate，顺序即 C14 的顺序）。
 *
 * 【为什么不复用 cleanList】它只认「非空字符串」，而 `'2026-2-3'`、
 * `'2026-02-30'` 都是非空字符串。放它们进来，月历会在错误的格子里画钩
 * （或根本画不出来），而按字符串排序 `'2026-2-3'` 会排到 `'2026-02-30'` 后面 ——
 * 整个「升序」的前提塌掉，「最近 366」也截错。日键的合法性有它自己的判据：
 * 格式（DATE_KEY_RE）+ **真实存在的日子**（parseDateKey 回环挡掉 2 月 30 日）。
 *
 * 【两类"少掉的天"分开算】坏条目（形状不对 / 不存在的日子 / 重复项）算**丢**，
 * 要出声；超过一年的**尾部截断**是容量设计，不算丢、不出声（这里就是它的痕）。
 */
function cleanCheckin(v: unknown): { state: CheckinState; dropped: number } {
  const empty: CheckinState = { lastDate: null, streakDays: 0, totalDays: 0, days: [] }
  if (!isObject(v)) return { state: empty, dropped: 0 }

  const rawDays = Array.isArray(v.days) ? v.days : []
  const valid: string[] = []
  const seen = new Set<string>()
  for (const item of rawDays) {
    if (typeof item !== 'string') continue
    if (!DATE_KEY_RE.test(item) || parseDateKey(item) === null) continue
    if (seen.has(item)) continue
    seen.add(item)
    valid.push(item)
  }
  valid.sort() // 日键定长补零，字符串序 = 时间序（dates.ts 头部那条约定）
  const kept = valid.length > CHECKIN_DAYS_MAX ? valid.slice(valid.length - CHECKIN_DAYS_MAX) : valid

  // lastDate 的规范形：必须是**留在 days 里的合法日键**，否则退回 max(days) 或 null。
  // 用 rawLast 而不是随便取，是因为 lastDate > max(days) 时它承载着 streak 的接续；
  // 但它终究只是个锚，和明细对不上时以明细为准（明细才是发饭闸门的依据）。
  const rawLast = typeof v.lastDate === 'string' ? v.lastDate : null
  const lastDate =
    rawLast !== null && kept.includes(rawLast) ? rawLast : kept.length > 0 ? kept[kept.length - 1] : null

  return {
    state: {
      lastDate,
      streakDays: countOf(v.streakDays, 0),
      // 累计天数的**证据下界**：明细里每一条都是真签过的日子，
      // 所以「totalDays < days.length」是自相矛盾的档，修的方向只能是抬到明细数
      // （days 会被 366 截断，totalDays 比它大是正常态，永不往下修）。
      totalDays: Math.max(countOf(v.totalDays, 0), kept.length),
      days: kept
    },
    dropped: droppedCount(rawDays, valid)
  }
}

/**
 * 「签到一天」的纯函数核心：给定当前状态和要签的日键，算出新状态。
 *
 * 【为什么它住在这个文件】主进程那条 handler（app.ts）拿不到单测 ——
 * `src/main/app.ts` 不在 vitest 的 include 里。而签到最要命的三条规矩
 * （幂等、跨月接续、断签清零）**必须**有真测试钉着，所以它们下沉到这里，
 * handler 只做「校验载荷 → 调它 → 写盘 → 发饭」的搬运。
 *
 * 【幂等判据是 days，不是 lastDate（C9）】只看 lastDate 的话，把系统时钟
 * 往回拨一天、签一下、再拨回来，同一个日键能**重复领到大白饭**：
 * 回拨后 lastDate 被写旧，前拨回来 lastDate ≠ today，判重就失效了。
 * 「这一天签过没有」的唯一正确依据是这一天在不在明细里。
 *
 * 【streak 的接续】lastDate 的**明天**正好是今天 ⇒ 连续 +1；否则**清零重来**。
 * 用 shiftDateKey（Date 构造器进位）而不是毫秒加减：跨月（1/31 → 2/1）、
 * 跨年、夏令时都由日历自己算对（dates.ts:66-70 的理由）。时钟回拨
 * （lastDate 比今天还晚）不满足任何接续条件 ⇒ streak=1，如实重来。
 *
 * 【为什么把 streakReset 作为返回值（空转[2]，2026-10-16）】"这次签完是不是
 * 断签重来"曾经谁也没说 —— 界面只播报大白饭，卡片上的「连续签到 30 天」当着
 * 用户的面变成 1（复核实测的口径）。判断"接没接上"的规矩就写在下面这行
 * 三元里，把它**回传**出去（而不是让渲染层拿 lastDate 再判一遍）——
 * 「接续规则」只能有一份实现，抄第二份就是埋"改了一边、另一边还不知道"的假话。
 */
export function applyCheckin(
  cur: CheckinState,
  day: string
): { checkin: CheckinState; awarded: boolean; streakReset: boolean } {
  // 日键不合法 = 调用方传错了东西：不签、不改、**更不许假装签过**（awarded:false）
  if (!DATE_KEY_RE.test(day) || parseDateKey(day) === null) {
    return { checkin: cur, awarded: false, streakReset: false }
  }
  // 已签过：原样奉还（连对象都不换 —— 调用方拿引用比较都能看出"什么都没发生"）
  if (cur.days.includes(day)) return { checkin: cur, awarded: false, streakReset: false }

  const nextDay = cur.lastDate !== null ? shiftDateKey(cur.lastDate, 1) : null
  const streakDays = nextDay === day ? cur.streakDays + 1 : 1
  // 断签 = 有过上一次签到（lastDate 非空）、且接不上（它的明天不是今天）。
  // 第一次签到（lastDate 为 null）不算断签 —— 没有"断"可言，别去报一个不存在的丧
  const streakReset = nextDay !== null && nextDay !== day

  const sorted = [...new Set([...cur.days, day])].sort()
  let days = sorted
  if (days.length > CHECKIN_DAYS_MAX) {
    days = days.slice(days.length - CHECKIN_DAYS_MAX)
    if (!days.includes(day)) {
      // 极端形：回拨到比已有 366 天全都早的日子。刚签的这天不能被挤出明细 ——
      // 挤掉的话它就不在 days 里了，同一个日键明天还能再领一次饭（闸门就是 days）。
      // 代价是挤掉一条最老的记录：capacity 保住、闸门保住。
      days[0] = day
      days.sort()
    }
  }
  return {
    checkin: {
      // lastDate 取 max(days)：正常签到就是今天；回拨补签时它仍是**最新的**签到日，
      // 下次接续的 streak 从那条主线算，不会被一次时钟故障打断（C9：lastDate 只管 streak）。
      lastDate: days[days.length - 1] ?? null,
      streakDays,
      totalDays: cur.totalDays + 1, // 补签也 +1，但总量只增不减（断签不清零）
      days
    },
    awarded: true,
    streakReset
  }
}

/**
 * `stats` 的**读时重算** —— 三条公式的唯一一份实现（版本迁移与跨设备合并共用）。
 *
 * 【为什么单独抽出来】迁移（下面的 migrateProfile）与跨设备合并
 * （shared/cloud/merge.ts）都要产出这份 stats，而且只能是同一份：
 * 「合并后的档」与「读它时算出来的 stats」必须对得上。两边各写一份公式，
 * 漂移的症状是 `learnedCount` 出现两套数 —— 没有任何地方会报错。
 *
 * 【三个数各自的真源】
 *   · learnedCount：由 learned 数组派生（migrateProfile 函数头第 2 条的理由）；
 *   · practicedCount：单调计数（只增不减），清洗后原样搬 —— 「两侧取 max」
 *     这类合并裁决由调用方先做完再喂进来；
 *   · streakDays：跟着签到走（2026-10-08 拍板，注释见下）。
 *
 * `checkin` 只取结构里的 streakDays，参数类型故意收窄：合并侧手里那份签到
 * 是现拼的（Record<string, unknown>），不必为了这一步去凑一个 CheckinState。
 */
export function recomputeStats(
  learned: readonly string[],
  stats: Record<string, unknown>,
  checkin: { streakDays: number }
): UserProfile['stats'] {
  return {
    // 派生值重算（理由见 migrateProfile 函数头第 2 条）
    learnedCount: learned.length,
    practicedCount: countOf(stats.practicedCount, 0),
    // 连续天数跟着**签到**走（派生镜像，照 learnedCount 先例，2026-10-08 拍板）：
    // 文件里那个旧数字一律不搬 —— 签到是它唯一的真实来源，
    // 搬旧数字会让「月历上有 6 天、统计说连续 2 天」这类自相矛盾永久留在档里。
    streakDays: checkin.streakDays
  }
}

/**
 * 把任意一份「从 profile.json 读出来的东西」搬成**当前版本**的完整档案。
 *
 * 【不可动摇的规矩】
 *   1. **`learned` 绝不能丢** —— 它是「这个人学过什么」的唯一凭据，
 *      丢了就是白学。这一条有专门的单测（对应 config 那边的 apiKey）。
 *   2. **`stats.learnedCount` 是派生值，读的时候重算**，不从文件里搬。
 *      搬运的话，上面几道清洗丢掉一条坏记录之后，这个数就和数组对不上 ——
 *      界面显示「已学 12 课」而列表里只有 11 行，谁也查不出差在哪。
 *   3. **version 无条件写当前值**：迁移的产出永远是当前版本，这是它的定义。
 *   4. 输入不是对象 → 默认档案 + `console.warn`（重建可以，不许不留痕）。
 *
 * 【已知取舍：版本比当前还新时】和 config 一样不特殊处理：认识的字段保留、
 * 不认识的丢掉。另一种做法（整份拒绝）会把用户全部进度清掉，严重得多。
 */
export function migrateProfile(raw: unknown): UserProfile {
  if (!isObject(raw)) {
    // 走到这里说明 profile.json 里是个数组/字符串/null 之类的东西。
    // **必须出声**：这是「用户的档案文件坏了」，不是正常路径。
    console.warn('[miai] profile.json is not an object, falling back to defaults')
    return structuredClone(DEFAULT_PROFILE)
  }

  const learned = cleanList(raw.learned)
  const favorites = cleanList(raw.favorites)
  const history = cleanHistory(raw.history)
  const stats = isObject(raw.stats) ? raw.stats : {}
  const { state: checkin, dropped: checkinDropped } = cleanCheckin(raw.checkin)

  // ── v3 → v4 的那一节：时间戳与墓碑 ──────────────────────────────
  // 已有的合法条目原样保留（**不因为 id 不在 learned 里就丢** —— 那是
  // 「添加过、后来移除」的证据，合并裁决要用）；learned 里有、表里没有的
  // 回填 epoch0（理由见 EPOCH0_ISO）；墓碑区缺失给两张空表。
  const learnedAt = cleanTimeMap(raw.learnedAt)
  const favoriteAt = cleanTimeMap(raw.favoriteAt)
  for (const id of learned) {
    if (!(id in learnedAt.map)) learnedAt.map[id] = EPOCH0_ISO
  }
  for (const id of favorites) {
    if (!(id in favoriteAt.map)) favoriteAt.map[id] = EPOCH0_ISO
  }
  const { tombstones, dropped: tombstoneDropped } = cleanTombstones(raw.tombstones)

  const dropped =
    droppedCount(raw.learned, learned) +
    droppedCount(raw.favorites, favorites) +
    droppedCount(raw.history, history) +
    checkinDropped +
    learnedAt.dropped +
    favoriteAt.dropped +
    tombstoneDropped
  if (dropped > 0) {
    // 丢掉的是坏条目（非字符串 / 重复项 / 缺字段的历史记录 / 假日子键），好的都留下了。
    // 出声是因为「档案里少了几条」这件事不该等到用户自己发现。
    console.warn(`[miai] profile.json: dropped ${dropped} invalid entries during migration`)
  }

  return {
    // 无条件写成当前版本：不写成 raw.version，那样迁完还是老版本号，下次读又得再迁一遍
    version: CURRENT_PROFILE_VERSION,
    learned,
    favorites,
    history,
    // stats 的三条公式在 recomputeStats 里（与跨设备合并共用同一份实现）
    stats: recomputeStats(learned, stats, checkin),
    // ── v1 → v2 的那一节 ────────────────────────────────────────────
    // 老档案里没有它，`rewardsOf` 会给一份空的：升级上来的用户「一张图都没得过」，
    // 而不是 undefined —— undefined 一进发奖逻辑（`.gallery.includes(...)`）
    // 就是当场抛错，而那是每次复习全对才会走到的路。
    rewards: rewardsOf(raw.rewards),
    // ── v2 → v3 的那一节 ────────────────────────────────────────────
    // 同理（cleanCheckin 的 empty 分支）：升级上来的用户是「没签过」而不是 undefined ——
    // undefined 一进月历（`days.includes(...)` / 发饭闸门）就是当场抛错。
    checkin,
    // ── v3 → v4 的那一节 ────────────────────────────────────────────
    // 时间戳 = 老的按各自条目回填 epoch0、已存在的合法值原样保留；
    // 墓碑区缺失给两张空表（**绝不 undefined** —— 它一进合并比较就抛）。
    learnedAt: learnedAt.map,
    favoriteAt: favoriteAt.map,
    tombstones
  }
}
