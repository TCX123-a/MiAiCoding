/**
 * `profile:save` 写口与**保留区**纪律（src/main/store/profile-apply.ts）
 *
 * 【这个文件在守什么】旧写口按白名单**重建对象**，v4 新加的
 * learnedAt / favoriteAt / tombstones（以及任何将来的键）会被渲染层的
 * **一次普通保存**静默抹掉，再跟着下一轮同步推回云端 —— P10.1 的头号 bug。
 * 这里钉死修复后的三条纪律（docs/21 §8.3 逐字）：
 *   1. **保留区 apply**：以磁盘原始 JSON 为基底，未知键与无关墓碑全留；
 *   2. **主进程独占区**：时间戳 / 墓碑 / rewards / checkin 一律不听渲染层，
 *      由这里的 diff（syncToggles）维护 —— 防抖保存会把「刚发的奖励图 /
 *      刚签的到」静默抹掉，那是同一笔账；
 *   3. **墓碑可撤销**：载荷里重新出现的 id 销墓碑、盖新时间戳 ——
 *      没有这一条，用户重新学会/重新收藏会被自己的墓碑永久吞掉。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，字符串一律英文。
 */
import { describe, expect, it, vi } from 'vitest'
import { EPOCH0_ISO, migrateProfile } from '../../../shared/profile-migrate'
import { CURRENT_PROFILE_VERSION } from '../../../shared/types'
import { applyProfileSave } from '../profile-apply'

const NOW = '2026-10-10T12:00:00.000Z'
const EARLIER = '2026-05-01T00:00:00.000Z'

function silent(raw: unknown): ReturnType<typeof migrateProfile> {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    return migrateProfile(raw)
  } finally {
    warn.mockRestore()
  }
}

/**
 * 磁盘上那份原始 JSON。刻意安排了三处「坏账」：
 *   · `sql-02` 在 learned 里、墓碑表里也有同名（历史坏对，写口要顺带修）；
 *   · `sql-02` 没有 learnedAt（迁移会回填 epoch0 —— 断言"没被当成新增重盖 now"）；
 *   · `futureSection` 是今天代码不认识的键（保留区的证据本体）。
 */
function diskArchive(): Record<string, unknown> {
  return {
    version: 4,
    learned: ['common-01', 'java-07', 'sql-02'],
    favorites: ['common-01'],
    history: [{ lessonId: 'common-01', finishedAt: '2026-09-01T10:00:00.000Z' }],
    stats: { learnedCount: 3, practicedCount: 11, streakDays: 2 },
    rewards: { gallery: ['dafeiyu-01'], perfectPasses: 1 },
    checkin: {
      lastDate: '2026-10-09',
      streakDays: 2,
      totalDays: 2,
      days: ['2026-10-08', '2026-10-09']
    },
    learnedAt: { 'common-01': EARLIER, 'java-07': EARLIER },
    favoriteAt: { 'common-01': EARLIER },
    tombstones: {
      learned: { 'python-03': EARLIER, 'sql-02': EARLIER },
      lessonFavorites: { 'java-07': EARLIER }
    },
    futureSection: { fromTheFuture: true }
  }
}

/** 渲染层交上来的普通快照（读口剥墓碑之后的形状：只有业务字段） */
function payload(learned: string[], favorites: string[]): Record<string, unknown> {
  return {
    learned,
    favorites,
    history: [{ lessonId: 'common-01', finishedAt: '2026-09-01T10:00:00.000Z' }],
    stats: { learnedCount: learned.length, practicedCount: 3, streakDays: 2 }
  }
}

/** 主场景载荷：保留 common-01 / sql-02、重学 python-03（墓碑里躺着）、移除 java-07 */
function payloadA(): Record<string, unknown> {
  return payload(['common-01', 'sql-02', 'python-03'], ['common-01'])
}

function save(diskRaw: unknown, p: unknown, current = silent(diskRaw)): ReturnType<typeof applyProfileSave> {
  return applyProfileSave({ diskRaw, current, payload: p, now: NOW })
}

// ---------------------------------------------------------------- 头号 bug

describe('保留区：一次普通保存后，磁盘上"不认识的东西"必须还在', () => {
  it('★ 未知键与无关墓碑全留（P10.1 头号 bug 的回归测试）', () => {
    // 抹掉的样子：保存后 futureSection 消失、lessonFavorites 的 java-07 墓碑
    // 消失 —— 再同步出去，所有设备的同一份数据跟着丢
    const out = save(diskArchive(), payloadA())
    // 未知键不在 UserProfile 类型上（它正是"将来版本的键"）—— 从落盘对象上看
    expect((out as unknown as Record<string, unknown>).futureSection).toEqual({ fromTheFuture: true })
    expect(out.tombstones.lessonFavorites['java-07']).toBe(EARLIER)
    expect(out.version).toBe(CURRENT_PROFILE_VERSION)
    expect(out.learned).toEqual(['common-01', 'sql-02', 'python-03'])
  })
})

// ---------------------------------------------------------------- 时间戳维护

describe('时间戳维护（syncToggles）：新增盖 now、移除盖墓碑、没动的条目不刷新', () => {
  it('learned 与 favorites 两条路同账', () => {
    const out = save(diskArchive(), payloadA())
    expect(out.learnedAt['common-01']).toBe(EARLIER) // 保留：时间戳不刷新
    expect(out.learnedAt['java-07']).toBeUndefined() // 移除：删时间戳
    expect(out.tombstones.learned['java-07']).toBe(NOW) // 移除：盖墓碑
    expect(out.learnedAt['python-03']).toBe(NOW) // 新增（重学）：盖 now
    expect(out.favoriteAt['common-01']).toBe(EARLIER) // 课程级收藏同账
  })

  it('全移除时，prev 里每个 id 都盖墓碑（不只是"被替换掉的那个"）', () => {
    const current = silent(diskArchive())
    const out = applyProfileSave({
      diskRaw: diskArchive(),
      current,
      payload: { learned: ['dup', 'dup', 42], favorites: [], history: [] },
      now: NOW
    })
    // 写口不替读口清洗：数组**原样落盘**（坏条目由下次读口的迁移兜住），
    // 与旧写口一字不差的口径。非字符串不进时间戳表，'dup' 算新增
    expect(out.learned).toEqual(['dup', 'dup', 42])
    expect(out.learnedAt).toEqual({ dup: NOW })
    expect(out.favoriteAt).toEqual({})
    expect(out.tombstones.learned).toEqual({
      'common-01': NOW,
      'java-07': NOW,
      'sql-02': NOW,
      'python-03': EARLIER // 本来就在墓碑里、没人碰它 → 原样
    })
    expect(out.tombstones.lessonFavorites).toEqual({ 'java-07': EARLIER, 'common-01': NOW })
  })
})

// ---------------------------------------------------------------- 撤销与坏对

describe('墓碑可撤销（红队三处独立发现，单机可复现）', () => {
  it('★ 重新学会 → 销墓碑、盖 now；「又存在又有墓碑」的坏对顺带修', () => {
    const out = save(diskArchive(), payloadA())
    // python-03 之前在墓碑里，这次被重新标记 —— 不销的话用户被自己的墓碑永久吞掉
    expect(out.tombstones.learned['python-03']).toBeUndefined()
    expect(out.learnedAt['python-03']).toBe(NOW)
    // sql-02：历史坏对（条目在、墓碑也占着同名），载荷里它没动 —— 墓碑照样销
    expect(out.tombstones.learned['sql-02']).toBeUndefined()
    // 但它**不是**新增：迁移回填的 epoch0 不许被重盖成 now（重盖 = 伪造"刚刚标记"）
    expect(out.learnedAt['sql-02']).toBe(EPOCH0_ISO)
  })
})

// ---------------------------------------------------------------- 独占区

describe('主进程独占区：渲染层塞什么都没用', () => {
  it('version / rewards / checkin / learnedAt / favoriteAt / tombstones 一律不听载荷', () => {
    const current = silent(diskArchive())
    const smuggled = {
      ...payloadA(),
      version: 1,
      rewards: { gallery: [], perfectPasses: 0 },
      checkin: { lastDate: null, streakDays: 0, totalDays: 0, days: [] },
      learnedAt: {},
      favoriteAt: {},
      tombstones: { learned: {}, lessonFavorites: {} }
    }
    const out = applyProfileSave({ diskRaw: diskArchive(), current, payload: smuggled, now: NOW })
    expect(out.version).toBe(CURRENT_PROFILE_VERSION)
    expect(out.rewards).toEqual(current.rewards) // 载荷里的空台账没生效
    expect(out.checkin).toEqual(current.checkin) // 刚签的到没被防抖保存抹掉
    expect(out.learnedAt['common-01']).toBe(EARLIER) // 空表没把时间戳抹掉
    expect(out.tombstones.learned['java-07']).toBe(NOW) // 空墓碑没把新墓碑抹掉
    // stats 是业务字段（渲染层现算的派生值）：听载荷的，磁盘上那个 11 被 3 覆盖
    expect(out.stats.practicedCount).toBe(3)
  })
})

// ---------------------------------------------------------------- 坏载荷与残缺

describe('坏载荷与残缺载荷', () => {
  it('形状不对（非对象 / 三个数组字段缺任一）→ 抛 invalid profile payload，一个字节不产出', () => {
    const current = silent(diskArchive())
    for (const bad of [
      null,
      undefined,
      [],
      'x',
      42,
      {},
      { learned: [], favorites: [] },
      { learned: [], history: [] },
      { learned: [], favorites: 'x', history: [] }
    ]) {
      expect(
        () => applyProfileSave({ diskRaw: diskArchive(), current, payload: bad, now: NOW }),
        JSON.stringify(bad)
      ).toThrow('invalid profile payload')
    }
  })

  it('磁盘上还没有文件（diskRaw null）→ 照常产出一份完整档案（首次保存）', () => {
    const out = save(null, payload(['a'], []))
    expect(out.learned).toEqual(['a'])
    expect(out.learnedAt).toEqual({ a: NOW })
    expect(out.favoriteAt).toEqual({})
    expect(out.tombstones).toEqual({ learned: {}, lessonFavorites: {} })
    expect(out.version).toBe(CURRENT_PROFILE_VERSION)
  })

  it('stats 缺失（残缺载荷）→ 听磁盘的，统计不被清零', () => {
    const current = silent(diskArchive())
    const out = applyProfileSave({
      diskRaw: diskArchive(),
      current,
      payload: { learned: ['common-01', 'java-07', 'sql-02'], favorites: ['common-01'], history: [] },
      now: NOW
    })
    expect(out.stats).toEqual(current.stats)
    expect(out.stats.practicedCount).toBe(11)
  })
})
