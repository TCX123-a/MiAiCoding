/**
 * `profile:save` 的**写口**（P10.1 头号 bug 的修复处）—— 纯函数，不碰文件系统。
 *
 * 【这个文件修的是什么】旧写口按白名单**重建对象字面量**（version/learned/
 * favorites/history/stats/rewards/checkin 七个键），于是 v4 新加的
 * `learnedAt` / `favoriteAt` / `tombstones`、以及任何将来的未知键，
 * 都会被渲染层的**一次普通保存**静默抹掉 —— 并跟着下一轮同步推回云端，
 * 让所有设备一起丢。修复 = 红队定稿的「保留区 apply」纪律：
 *   · **以磁盘原始 JSON 为基底**（未知键全保留），只 apply 业务字段；
 *   · 时间戳/墓碑**主进程独占**：渲染层交上来的一律不听，由这里的 diff 维护；
 *   · 读口剥墓碑（在 app.ts），渲染层手里那份快照**碰不到墓碑区**。
 *
 * 【墓碑维护规则（与 docs/21 §8.3 的合并矩阵对偶）】
 *   · 新增（含重新学会）→ `learnedAt[id] = now`，**撤销**同名墓碑；
 *   · 移除 → 删 `learnedAt[id]`，盖 `tombstones.learned[id] = now`；
 *   · 载荷里存在的 id 一律无墓碑（重新标记 = 撤销；顺带修「又存在又有墓碑」的坏对）。
 * 课程级收藏（favorites / favoriteAt / tombstones.lessonFavorites）同一套，
 * 换个表而已 —— 两条路共用一个 `syncToggles`。
 *
 * 【为什么不复用迁移函数来清洗入参】写口的入参是渲染层交上来的业务快照，
 * 沿用旧写口的口径：数组字段**原样落盘**（坏条目由读口的迁移兜住），
 * 只有「形状压根不对」才抛 —— 那是调用方写错了，该炸得响亮。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律英文**，中文只出现在注释里。
 */
import { CURRENT_PROFILE_VERSION, type ProfileTombstones, type UserProfile } from '../../shared/types'

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 维护一组「开关式集合」的时间戳与墓碑（learned 与 favorites 共用）。
 * 直接原地改传进来的三张表（调用方给的都是本函数刚拷出来的副本）。
 */
function syncToggles(
  prev: readonly unknown[],
  next: readonly unknown[],
  at: Record<string, string>,
  tomb: Record<string, string>,
  now: string
): void {
  // 只认字符串成员 —— 非字符串是坏载荷的残渣，落盘照旧（读口兜底），但别进时间戳表
  const prevSet = new Set(prev.filter((x): x is string => typeof x === 'string'))
  const nextSet = new Set(next.filter((x): x is string => typeof x === 'string'))

  for (const id of nextSet) {
    if (!prevSet.has(id)) at[id] = now // 新增/重新学会：时间戳刷新成这一刻
    delete tomb[id] // 载荷里存在的 id 一律无墓碑（重新标记 = 撤销）
  }
  for (const id of prevSet) {
    if (!nextSet.has(id)) {
      delete at[id]
      tomb[id] = now // 移除：盖章墓碑，合并时与别的设备的条目「新者胜」
    }
  }
}

export interface ProfileSaveInput {
  /** 磁盘原始 JSON（可能为 null = 还没有文件）。保留区的基底 */
  diskRaw: unknown
  /** 迁移后的磁盘现状（`readProfileRaw()` 的产物）—— 时间戳/墓碑的真源 */
  current: UserProfile
  /** 渲染层交上来的快照（业务字段） */
  payload: unknown
  /** 本次写入时刻（ISO） */
  now: string
}

/**
 * 返回**要落盘的那一份**。坏载荷（不是对象 / 三个数组字段缺失）抛
 * `invalid profile payload` —— 与旧写口一字不差。
 */
export function applyProfileSave(input: ProfileSaveInput): UserProfile {
  const { diskRaw, current, payload, now } = input
  if (
    !isObject(payload) ||
    !Array.isArray(payload.learned) ||
    !Array.isArray(payload.favorites) ||
    !Array.isArray(payload.history)
  ) {
    throw new Error('invalid profile payload')
  }

  const learned = payload.learned as string[]
  const favorites = payload.favorites as string[]
  const history = payload.history as UserProfile['history']

  const learnedAt = { ...current.learnedAt }
  const favoriteAt = { ...current.favoriteAt }
  const tombstones: ProfileTombstones = {
    learned: { ...current.tombstones.learned },
    lessonFavorites: { ...current.tombstones.lessonFavorites }
  }
  syncToggles(current.learned, learned, learnedAt, tombstones.learned, now)
  syncToggles(current.favorites, favorites, favoriteAt, tombstones.lessonFavorites, now)

  const base = isObject(diskRaw) ? diskRaw : {}
  return {
    ...base, // 保留区：磁盘上的未知键先摊进来，下面认识的键再逐个覆盖
    version: CURRENT_PROFILE_VERSION,
    learned,
    favorites,
    history,
    // stats 照收（渲染层现算的派生值）；缺了（残缺载荷）就听磁盘的，与旧口径一致
    stats: isObject(payload.stats) ? (payload.stats as UserProfile['stats']) : current.stats,
    // ⚠️ 这几样归主进程所有，一律不听入参（旧写口的注释里那笔账：防抖保存
    // 会把「刚发的奖励图 / 刚签的到」静默抹掉；时间戳与墓碑是同一类理由）
    rewards: current.rewards,
    checkin: current.checkin,
    learnedAt,
    favoriteAt,
    tombstones
  }
}
