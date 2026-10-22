/**
 * 跨设备文档合并（shared/cloud/merge.ts）的规矩台。
 *
 * 【这份测试守的是什么】合并是**没有第二道防线**的一段逻辑：它错了不会抛，
 * 只会安静地把一份并集写成"看起来对"的文档，再被推到所有设备上 ——
 * 事后谁都查不出是哪一轮丢的。所以这里把 docs/21 §8.3 的合并矩阵逐格钉死：
 *   1. 幂等：merge(x, x) 必须 changed=false（键序不同也不算变）——
 *      否则同步器每轮空转写盘 + 推送；
 *   2. 收敛：merge(merge(a,b), ·) 与 merge(a,b) 深度相等；数组乱序输入下
 *      输出逐字节一致 —— 两台设备各自合并必得同一份；
 *   3. 保留区：两侧未知键（含嵌套一层、数组元素字段）全部保留；
 *   4. 墓碑矩阵：条目 vs 墓碑「严格更新才删」，相等 → 条目留、墓碑销；
 *   5. stats 读时重算 / 签到四条规则 / wrongbook 复活语义（逐字复刻单设备版）；
 *   6. favorites 的 note 冲突、重收藏撤墓碑、等时戳 canonical 平局、
 *      孤儿 folderId、信封 updatedAt；practice 的 uid 并集与 (at, uid) 裁剪；
 *   7. 坏输入（null / 字符串 / 数组）按 {} 处理，绝不抛。
 *
 * 【种坏见红】两条关键缝各做过一次：墓碑比较 `>` 改 `>=`、practice 裁剪方向
 * 反转 —— 预期变红的用例与 sha256 前后值见 P10.4 交付报告。
 */
import { describe, expect, it } from 'vitest'
import {
  CURRENT_FAVORITES_VERSION,
  CURRENT_PRACTICE_VERSION,
  CURRENT_PROFILE_VERSION,
  CURRENT_WRONGBOOK_VERSION,
  PRACTICE_KEEP_SESSIONS
} from '../types'
import { EPOCH0_ISO } from '../profile-migrate'
import { mergeFavoritesDoc, mergePracticeDoc, mergeProfileDoc, mergeWrongbookDoc } from '../cloud/merge'

type Json = Record<string, unknown>
type Merger = (local: unknown, remote: unknown) => { merged: Json; changed: boolean }

function obj(v: unknown): Json {
  return (v ?? {}) as Json
}
function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

const T1 = '2026-09-01T10:00:00.000Z'
const T2 = '2026-09-02T10:00:00.000Z'
const T3 = '2026-09-03T10:00:00.000Z'
const T4 = '2026-09-04T10:00:00.000Z'
const T5 = '2026-09-05T10:00:00.000Z'

/** uid 的形状是 `${installId}:${id}`（installId=36 位 uuid）—— 两个不撞号的设备 */
const UID_A = '01234567-89ab-cdef-0123-456789abcdef'
const UID_B = 'fedcba98-7654-3210-fedc-ba9876543210'

// ---------------------------------------------------------------- 夹具

/** 规范形空档案（字段齐全、键序固定）；over 覆盖任意字段 */
function profileDoc(over: Json = {}): Json {
  return {
    version: CURRENT_PROFILE_VERSION,
    learned: [],
    favorites: [],
    history: [],
    stats: { learnedCount: 0, practicedCount: 0, streakDays: 0 },
    rewards: { gallery: [], perfectPasses: 0, lastImageDay: null },
    checkin: { lastDate: null, streakDays: 0, totalDays: 0, days: [] },
    learnedAt: {},
    favoriteAt: {},
    tombstones: { learned: {}, lessonFavorites: {} },
    ...over
  }
}

function wrongbookDoc(entries: unknown[] = []): Json {
  return { version: CURRENT_WRONGBOOK_VERSION, entries }
}

function entry(key: string, over: Json = {}): Json {
  const sep = key.indexOf(':')
  return {
    key,
    lessonId: key.slice(0, sep),
    qid: key.slice(sep + 1),
    wrongCount: 1,
    lastWrongAt: T1,
    cleared: false,
    ...over
  }
}

function entryByKey(merged: Json, key: string): Json {
  const hit = list(merged.entries)
    .map(obj)
    .find((e) => e.key === key)
  expect(hit).toBeTruthy()
  return hit as Json
}

function favoritesDoc(over: Json = {}): Json {
  return {
    version: CURRENT_FAVORITES_VERSION,
    updatedAt: T1,
    folders: [],
    items: [],
    removedItems: {},
    removedFolders: {},
    ...over
  }
}

function favItem(key: string, over: Json = {}): Json {
  const sep = key.indexOf(':')
  return {
    key,
    lessonId: key.slice(0, sep),
    qid: key.slice(sep + 1),
    addedAt: T1,
    updatedAt: T1,
    ...over
  }
}

function folder(id: string, over: Json = {}): Json {
  return { id, name: id, createdAt: T1, updatedAt: T1, ...over }
}

function practiceDoc(history: unknown[] = []): Json {
  return { version: CURRENT_PRACTICE_VERSION, history }
}

function session(uid: string, at: string, over: Json = {}): Json {
  return {
    id: 1,
    uid,
    at,
    mode: 'lesson',
    items: [{ key: 'common-01:q1', lessonId: 'common-01', ok: true }],
    ...over
  }
}

/** n 条会话（uid 递增、at 每秒一条）—— 用来撞 5000 的上限 */
function practiceMany(prefix: string, count: number, startMs: number): Json[] {
  const out: Json[] = []
  for (let i = 0; i < count; i++) {
    out.push(session(`${prefix}:${i + 1}`, new Date(startMs + i * 1000).toISOString(), { id: i + 1 }))
  }
  return out
}

// ---- 幂等 / 收敛用的规范形"满档"

function fullProfile(): Json {
  return profileDoc({
    learned: ['common-01', 'common-02'],
    favorites: ['common-01'],
    history: [
      { lessonId: 'common-01', finishedAt: T1 },
      { lessonId: 'common-02', finishedAt: T2 }
    ],
    stats: { learnedCount: 2, practicedCount: 7, streakDays: 2 },
    rewards: { gallery: ['g-01', 'g-02'], perfectPasses: 3, lastImageDay: '2026-09-02' },
    checkin: { lastDate: '2026-09-02', streakDays: 2, totalDays: 6, days: ['2026-09-01', '2026-09-02'] },
    learnedAt: { 'common-01': T1, 'common-02': T2 },
    favoriteAt: { 'common-01': T1 }
  })
}

function fullWrongbook(): Json {
  return wrongbookDoc([
    entry('common-01:q1', { wrongCount: 3, lastWrongAt: T2, source: 'lesson' }),
    entry('common-01:q2', { cleared: true, clearedAt: T3, lastWrongAt: T1 })
  ])
}

function fullFavorites(): Json {
  return favoritesDoc({
    updatedAt: T3,
    folders: [folder('folder-01', { name: 'Favorites', updatedAt: T2 })],
    items: [
      favItem('common-01:q1', { updatedAt: T2, folderId: 'folder-01' }),
      favItem('common-02:q1', { updatedAt: T1, note: 'note text' })
    ]
  })
}

function fullPractice(): Json {
  return practiceDoc([session(`${UID_A}:1`, T1), session(`${UID_A}:2`, T2)])
}

// ---- 收敛 / 乱序测试用的两份"半重叠"文档

function profileA(): Json {
  return profileDoc({
    learned: ['b-01', 'a-01', 'c-01'], // 故意非规范序
    favorites: ['c-01'],
    history: [
      { lessonId: 'b-01', finishedAt: T2 },
      { lessonId: 'a-01', finishedAt: T1 }
    ],
    stats: { learnedCount: 3, practicedCount: 4, streakDays: 1 },
    rewards: { gallery: ['img-2', 'img-1'], perfectPasses: 1, lastImageDay: '2026-09-02' },
    checkin: { lastDate: '2026-09-02', streakDays: 1, totalDays: 2, days: ['2026-09-01', '2026-09-02'] },
    learnedAt: { 'b-01': T2, 'a-01': T1, 'c-01': T1 },
    favoriteAt: { 'c-01': T1 },
    tombstones: { learned: { 'gone-01': T1 }, lessonFavorites: {} }
  })
}

function profileB(): Json {
  return profileDoc({
    learned: ['c-01', 'd-01'],
    favorites: ['c-01', 'e-01'],
    history: [
      { lessonId: 'a-01', finishedAt: T1 }, // 与 A 的同一条（去重目标）
      { lessonId: 'd-01', finishedAt: T3 }
    ],
    stats: { learnedCount: 2, practicedCount: 9, streakDays: 3 },
    rewards: { gallery: ['img-1', 'img-3'], perfectPasses: 2, lastImageDay: '2026-09-05' },
    checkin: { lastDate: '2026-09-05', streakDays: 3, totalDays: 3, days: ['2026-09-05'] },
    learnedAt: { 'c-01': T3, 'd-01': T3 },
    favoriteAt: { 'c-01': T2, 'e-01': T3 },
    tombstones: { learned: { 'b-01': T1 }, lessonFavorites: {} }
  })
}

function wrongBookA(): Json {
  return wrongbookDoc([
    entry('common-02:q1', { wrongCount: 2, lastWrongAt: T2 }),
    entry('common-01:q1', { cleared: true, clearedAt: T3, lastWrongAt: T1, source: 'lesson' })
  ])
}

function wrongBookB(): Json {
  return wrongbookDoc([
    entry('common-01:q1', { wrongCount: 4, lastWrongAt: T4, hole: true }), // 更晚答错 → cleared 复活
    entry('common-03:q1', { removed: true, removedAt: T3, lastWrongAt: T1 })
  ])
}

function favoritesA(): Json {
  return favoritesDoc({
    updatedAt: T2,
    folders: [folder('folder-01', { name: 'Old name', updatedAt: T1 })],
    items: [
      favItem('common-01:q1', { updatedAt: T2, note: 'local note', folderId: 'folder-01' }),
      favItem('common-02:q1', { updatedAt: T1 }) // B 侧把它删了（墓碑更新）
    ],
    removedItems: { 'common-03:q1': T2 } // A 删过，B 侧又重新收藏
  })
}

function favoritesB(): Json {
  return favoritesDoc({
    updatedAt: T4,
    folders: [folder('folder-01', { name: 'New name', updatedAt: T3 }), folder('folder-02')],
    items: [
      favItem('common-01:q1', { updatedAt: T1, note: 'remote note' }),
      favItem('common-03:q1', { updatedAt: T3 })
    ],
    removedItems: { 'common-02:q1': T3 },
    removedFolders: {}
  })
}

function practiceA(): Json {
  return practiceDoc([
    session(`${UID_A}:2`, T2, { mode: 'review' }),
    session(`${UID_A}:1`, T1) // 非规范序
  ])
}

function practiceB(): Json {
  return practiceDoc([
    session(`${UID_B}:1`, T3),
    session(`${UID_A}:1`, T1, { mode: 'review' }) // 同 uid、内容与 A 不同（理论不该有）
  ])
}

// ---- 乱序输入（只反转"并集型"集合的顺序；元素内部的载荷数组不是并集语义，不在此列）

function reverseObject(o: Json): Json {
  return Object.fromEntries(Object.entries(o).reverse())
}

function permuteProfileArrays(d: Json): Json {
  const rewards = obj(d.rewards)
  const checkin = obj(d.checkin)
  const tombstones = obj(d.tombstones)
  return {
    ...d,
    learned: [...list(d.learned)].reverse(),
    favorites: [...list(d.favorites)].reverse(),
    history: [...list(d.history)].reverse(),
    rewards: { ...rewards, gallery: [...list(rewards.gallery)].reverse() },
    checkin: { ...checkin, days: [...list(checkin.days)].reverse() },
    tombstones: { ...tombstones, learned: reverseObject(obj(tombstones.learned)) }
  }
}

function permuteWrongbookArrays(d: Json): Json {
  return { ...d, entries: [...list(d.entries)].reverse() }
}

function permuteFavoritesArrays(d: Json): Json {
  return {
    ...d,
    items: [...list(d.items)].reverse(),
    folders: [...list(d.folders)].reverse(),
    removedItems: reverseObject(obj(d.removedItems)),
    removedFolders: reverseObject(obj(d.removedFolders))
  }
}

function permutePracticeArrays(d: Json): Json {
  return { ...d, history: [...list(d.history)].reverse() }
}

// ---------------------------------------------------------------- 通用面

describe('通用：幂等 / 收敛 / 保留区 / 坏输入', () => {
  it('幂等：merge(x, x) 四个口都 changed=false 且文档不动（规范形输入）', () => {
    const cases: Array<[string, Merger, Json]> = [
      ['profile', mergeProfileDoc, fullProfile()],
      ['wrongbook', mergeWrongbookDoc, fullWrongbook()],
      ['favorites', mergeFavoritesDoc, fullFavorites()],
      ['practice', mergePracticeDoc, fullPractice()]
    ]
    for (const [name, merge, doc] of cases) {
      const res = merge(doc, doc)
      expect(res.merged, name).toEqual(doc)
      expect(res.changed, name).toBe(false)
    }
  })

  it('幂等：整份文档键序不同不算 changed（深度比较，不是裸 JSON 串比较）', () => {
    const x1 = fullProfile()
    const x2: Json = {}
    for (const k of Object.keys(x1).reverse()) x2[k] = x1[k]
    // 嵌套层也换序
    x2.stats = { streakDays: 2, practicedCount: 7, learnedCount: 2 }
    x2.checkin = { days: ['2026-09-01', '2026-09-02'], totalDays: 6, streakDays: 2, lastDate: '2026-09-02' }

    const res = mergeProfileDoc(x1, x2)
    expect(res.changed).toBe(false)
    expect(res.merged).toEqual(x1)
  })

  it('收敛：merge(merge(a, b), ·) 不再变化；两侧换序也同结果（四个口）', () => {
    const cases: Array<[string, Merger, Json, Json]> = [
      ['profile', mergeProfileDoc, profileA(), profileB()],
      ['wrongbook', mergeWrongbookDoc, wrongBookA(), wrongBookB()],
      ['favorites', mergeFavoritesDoc, favoritesA(), favoritesB()],
      ['practice', mergePracticeDoc, practiceA(), practiceB()]
    ]
    for (const [name, merge, a, b] of cases) {
      const ab = merge(a, b).merged
      expect(merge(ab, a).merged, name).toEqual(ab)
      expect(merge(a, ab).merged, name).toEqual(ab)
      expect(merge(b, a).merged, name).toEqual(ab)
    }
  })

  it('收敛：数组乱序输入 ⇒ 输出逐字节相同（四个口）', () => {
    const cases: Array<[string, Merger, Json, Json, (d: Json) => Json]> = [
      ['profile', mergeProfileDoc, profileA(), profileB(), permuteProfileArrays],
      ['wrongbook', mergeWrongbookDoc, wrongBookA(), wrongBookB(), permuteWrongbookArrays],
      ['favorites', mergeFavoritesDoc, favoritesA(), favoritesB(), permuteFavoritesArrays],
      ['practice', mergePracticeDoc, practiceA(), practiceB(), permutePracticeArrays]
    ]
    for (const [name, merge, a, b, permute] of cases) {
      const straight = merge(a, b).merged
      const unorderly = merge(a, permute(b)).merged
      expect(JSON.stringify(unorderly), name).toBe(JSON.stringify(straight))
    }
  })

  it('保留区：未知顶层键与嵌套未知子键全保留；未知键冲突按 canonical 大者胜（两侧同裁决）', () => {
    const a = profileDoc({ extraTopA: { deep: 1 }, conflict: 'aaa' })
    const b = profileDoc({ extraTopB: 2, conflict: 'zzz' })
    obj(a.checkin).cloud = { lastSyncedAt: T1 } // types 里给 checkin 留的保留位
    obj(b.checkin).futureFlag = true // 对侧另一个未知子键
    obj(a.stats).customStat = 'x'
    obj(b.rewards).badgeOrder = ['b', 'a']

    const m = mergeProfileDoc(a, b).merged
    expect(m.extraTopA).toEqual({ deep: 1 })
    expect(m.extraTopB).toBe(2)
    expect(m.conflict).toBe('zzz')
    expect(obj(obj(m.checkin).cloud).lastSyncedAt).toBe(T1)
    expect(obj(m.checkin).futureFlag).toBe(true)
    expect(obj(m.stats).customStat).toBe('x')
    expect(obj(m.rewards).badgeOrder).toEqual(['b', 'a'])
    expect(mergeProfileDoc(b, a).merged.conflict).toBe('zzz') // 换序同一赢家 ⇒ 收敛
  })

  it('坏输入：null / 字符串 / 数组 / undefined 一侧按 {} 处理，绝不抛', () => {
    expect(() => mergeProfileDoc(null, fullProfile())).not.toThrow()
    expect(mergeProfileDoc(null, fullProfile()).merged).toEqual(mergeProfileDoc({}, fullProfile()).merged)
    expect(mergeProfileDoc('x', 42).merged.version).toBe(CURRENT_PROFILE_VERSION)
    expect(list(mergeWrongbookDoc([], 'x').merged.entries)).toEqual([])
    expect(list(mergeFavoritesDoc(undefined, null).merged.items)).toEqual([])
    expect(list(mergePracticeDoc('', { history: 'nope' }).merged.history)).toEqual([])
  })

  it('changed 是本侧视角：本侧 {} 对侧有料 ⇒ true；对侧空则不动本侧（不幻影写盘）', () => {
    expect(mergeProfileDoc({}, fullProfile()).changed).toBe(true)
    expect(mergeProfileDoc(fullProfile(), {}).changed).toBe(false)
    expect(mergeWrongbookDoc(wrongbookDoc([]), fullWrongbook()).changed).toBe(true)
    // favorites 的信封 updatedAt 取 max —— 本侧空档（updatedAt=T1）合进满档后
    // 连信封都变了，所以这里是 true；反过来（本侧满、对侧空）才不动
    expect(mergeFavoritesDoc(favoritesDoc(), fullFavorites()).changed).toBe(true)
    expect(mergeFavoritesDoc(fullFavorites(), favoritesDoc()).changed).toBe(false)
    expect(mergePracticeDoc(practiceDoc([]), fullPractice()).changed).toBe(true)
  })
})

// ---------------------------------------------------------------- profile

describe('profile：墓碑矩阵（learned / 课程级收藏）', () => {
  it('条目胜：本侧条目时刻更新 ⇒ 条目保留、墓碑销掉（重新标记 = 撤销）', () => {
    const a = profileDoc({ learned: ['common-01'], learnedAt: { 'common-01': T3 } })
    const b = profileDoc({ tombstones: { learned: { 'common-01': T1 }, lessonFavorites: {} } })
    const m = mergeProfileDoc(a, b).merged
    expect(m.learned).toEqual(['common-01'])
    expect(obj(obj(m.tombstones).learned)).toEqual({})
  })

  it('相等平局：条目保留、墓碑销掉（严格更新才删，保守方向）', () => {
    const a = profileDoc({ learned: ['common-01'], learnedAt: { 'common-01': T3 } })
    const b = profileDoc({ tombstones: { learned: { 'common-01': T3 }, lessonFavorites: {} } })
    const m = mergeProfileDoc(a, b).merged
    expect(m.learned).toEqual(['common-01'])
    expect(obj(obj(m.tombstones).learned)).toEqual({})
  })

  it('墓碑胜：墓碑严格更新 ⇒ 条目删、墓碑带原时刻留在输出（别的设备还要靠它）', () => {
    const a = profileDoc({ learned: ['common-01'], learnedAt: { 'common-01': T2 } })
    const b = profileDoc({ tombstones: { learned: { 'common-01': T3 }, lessonFavorites: {} } })
    const m = mergeProfileDoc(a, b).merged
    expect(m.learned).toEqual([])
    expect(obj(obj(m.tombstones).learned)).toEqual({ 'common-01': T3 })
  })

  it('两边都没有条目的旧墓碑：取 max 保留（「添加过、后来移除」的证据不丢）', () => {
    const a = profileDoc({ tombstones: { learned: { 'ghost-01': T1 }, lessonFavorites: {} } })
    const b = profileDoc({ tombstones: { learned: { 'ghost-01': T2, 'ghost-02': T1 }, lessonFavorites: {} } })
    const m = mergeProfileDoc(a, b).merged
    expect(m.learned).toEqual([])
    expect(obj(obj(m.tombstones).learned)).toEqual({ 'ghost-01': T2, 'ghost-02': T1 })
  })

  it('课程级收藏（favorites / lessonFavorites）走同一套墓碑规矩', () => {
    const a = profileDoc({ favorites: ['lesson-01'], favoriteAt: { 'lesson-01': T1 } })
    const b = profileDoc({ tombstones: { learned: {}, lessonFavorites: { 'lesson-01': T2 } } })
    const m = mergeProfileDoc(a, b).merged
    expect(m.favorites).toEqual([])
    expect(obj(obj(m.tombstones).lessonFavorites)).toEqual({ 'lesson-01': T2 })
  })

  it('learned 条目缺时间戳 ⇒ 回填 epoch0（不伪造 now）', () => {
    const a = profileDoc({ learned: ['common-01'], learnedAt: {} })
    const m = mergeProfileDoc(a, profileDoc()).merged
    expect(obj(m.learnedAt)['common-01']).toBe(EPOCH0_ISO)
  })

  it('时间戳表：两侧并集取 max；不在集合里的旧时间戳也保留', () => {
    const a = profileDoc({ learned: ['a-01'], learnedAt: { 'a-01': T1, 'gone-01': T2 } })
    const b = profileDoc({ learned: ['a-01'], learnedAt: { 'a-01': T3 } })
    const m = mergeProfileDoc(a, b).merged
    expect(obj(m.learnedAt)).toEqual({ 'a-01': T3, 'gone-01': T2 })
  })

  it('版本号：无条件写当前值', () => {
    expect(mergeProfileDoc({ version: 1 }, {}).merged.version).toBe(CURRENT_PROFILE_VERSION)
  })
})

describe('profile：history 与 stats', () => {
  it('history：按 (lessonId, finishedAt) 去重、并集，按 finishedAt 升序（并列按 lessonId）', () => {
    const a = profileDoc({
      history: [
        { lessonId: 'b-01', finishedAt: T2 },
        { lessonId: 'a-01', finishedAt: T2 },
        { lessonId: 'a-01', finishedAt: T1 }
      ]
    })
    const b = profileDoc({ history: [{ lessonId: 'a-01', finishedAt: T1, extra: 'keep' }] })
    expect(mergeProfileDoc(a, b).merged.history).toEqual([
      { lessonId: 'a-01', finishedAt: T1, extra: 'keep' },
      { lessonId: 'a-01', finishedAt: T2 },
      { lessonId: 'b-01', finishedAt: T2 }
    ])
  })

  it('history：缺字段的坏条目丢掉（不抛、不伪造）', () => {
    const a = profileDoc({ history: [{ lessonId: 'a-01' }, 'junk', { lessonId: 'a-01', finishedAt: '' }] })
    expect(mergeProfileDoc(a, profileDoc()).merged.history).toEqual([])
  })

  it('stats：不搬运 —— learnedCount 由并集派生、practicedCount 取 max、streakDays 跟着签到', () => {
    const a = profileDoc({
      learned: ['a-01'],
      stats: { learnedCount: 99, practicedCount: 5, streakDays: 99 } // 故意和数组不一致
    })
    const b = profileDoc({
      learned: ['a-01', 'b-01'],
      stats: { learnedCount: 2, practicedCount: 8, streakDays: 1 },
      checkin: { lastDate: '2026-09-02', streakDays: 3, totalDays: 3, days: ['2026-09-01', '2026-09-02'] }
    })
    expect(mergeProfileDoc(a, b).merged.stats).toEqual({ learnedCount: 2, practicedCount: 8, streakDays: 3 })
  })
})

describe('profile：签到四条规则', () => {
  it('days 并集升序；lastDate 取 max（也抬到明细最新）；totalDays 取 max；streak 跟较晚一侧', () => {
    const a = profileDoc({
      checkin: { lastDate: '2026-09-02', streakDays: 2, totalDays: 4, days: ['2026-09-01', '2026-09-02'] }
    })
    const b = profileDoc({
      checkin: { lastDate: '2026-09-05', streakDays: 1, totalDays: 5, days: ['2026-09-04', '2026-09-05'] }
    })
    const c = obj(mergeProfileDoc(a, b).merged.checkin)
    expect(c.days).toEqual(['2026-09-01', '2026-09-02', '2026-09-04', '2026-09-05'])
    expect(c.lastDate).toBe('2026-09-05')
    expect(c.totalDays).toBe(5)
    expect(c.streakDays).toBe(1) // lastDate 较晚那侧的值，哪怕它更小
  })

  it('streakDays 平局取较大值；一侧 lastDate 为 null 时按另一侧算', () => {
    const tieA = profileDoc({
      checkin: { lastDate: '2026-09-05', streakDays: 2, totalDays: 2, days: ['2026-09-05'] }
    })
    const tieB = profileDoc({
      checkin: { lastDate: '2026-09-05', streakDays: 4, totalDays: 4, days: ['2026-09-05'] }
    })
    expect(obj(mergeProfileDoc(tieA, tieB).merged.checkin).streakDays).toBe(4)

    const nullSide = profileDoc({ checkin: { lastDate: null, streakDays: 0, totalDays: 0, days: [] } })
    expect(obj(mergeProfileDoc(nullSide, tieB).merged.checkin).streakDays).toBe(4)
  })

  it('totalDays 抬到明细下界（两侧都小于明细数时 —— cleanCheckin 的证据下界）', () => {
    const a = profileDoc({
      checkin: { lastDate: '2026-09-01', streakDays: 1, totalDays: 1, days: ['2026-09-01'] }
    })
    const b = profileDoc({
      checkin: { lastDate: '2026-09-02', streakDays: 1, totalDays: 0, days: ['2026-09-02'] }
    })
    expect(obj(mergeProfileDoc(a, b).merged.checkin).totalDays).toBe(2)
  })

  it('days 超 366 截尾部（容量设计）；伪造日键不进门', () => {
    const base = Date.UTC(2025, 0, 1)
    const days366: string[] = []
    for (let i = 0; i < 366; i++) days366.push(new Date(base + i * 86400000).toISOString().slice(0, 10))
    const extraDay = new Date(base + 366 * 86400000).toISOString().slice(0, 10)

    const a = profileDoc({ checkin: { lastDate: days366[365], streakDays: 3, totalDays: 400, days: days366 } })
    const b = profileDoc({
      checkin: { lastDate: extraDay, streakDays: 1, totalDays: 400, days: [extraDay, '2026-02-30'] }
    })
    const c = obj(mergeProfileDoc(a, b).merged.checkin)
    const kept = list(c.days)
    expect(kept.length).toBe(366)
    expect(kept[0]).toBe(days366[1]) // 最旧的一天被容量挤掉
    expect(kept[365]).toBe(extraDay)
    expect(c.lastDate).toBe(extraDay)
  })
})

describe('profile：rewards.lastImageDay（v5 每日一次图）取较晚', () => {
  it('两边各发过图 → 取较晚的那天（字符串序=时间序）；换序同一结果', () => {
    const a = profileDoc({ rewards: { gallery: [], perfectPasses: 1, lastImageDay: '2026-10-10' } })
    const b = profileDoc({ rewards: { gallery: [], perfectPasses: 1, lastImageDay: '2026-10-12' } })
    expect(obj(mergeProfileDoc(a, b).merged.rewards).lastImageDay).toBe('2026-10-12')
    expect(obj(mergeProfileDoc(b, a).merged.rewards).lastImageDay).toBe('2026-10-12')
  })

  it('一边没有 → 取有的那边；两边都没有 → null', () => {
    const withDay = profileDoc({ rewards: { gallery: [], perfectPasses: 1, lastImageDay: '2026-10-12' } })
    expect(obj(mergeProfileDoc(withDay, profileDoc()).merged.rewards).lastImageDay).toBe('2026-10-12')
    expect(obj(mergeProfileDoc(profileDoc(), profileDoc()).merged.rewards).lastImageDay).toBeNull()
  })

  it('坏键当"没有"处理 —— 留下它判据可能恒真、图永远发不出来', () => {
    const bad = profileDoc({ rewards: { gallery: [], perfectPasses: 1, lastImageDay: '2026-02-30' } })
    const good = profileDoc({ rewards: { gallery: [], perfectPasses: 1, lastImageDay: '2026-10-01' } })
    expect(obj(mergeProfileDoc(bad, good).merged.rewards).lastImageDay).toBe('2026-10-01')
    expect(obj(mergeProfileDoc(bad, profileDoc()).merged.rewards).lastImageDay).toBeNull()
  })
})

// ---------------------------------------------------------------- wrongbook

describe('wrongbook：复活语义（跨设备版，逐字复刻 wrongbook-merge）', () => {
  it('wrongCount 取 max、lastWrongAt 取 max（缺时间戳按最旧）', () => {
    const a = wrongbookDoc([entry('common-01:q1', { wrongCount: 3, lastWrongAt: T2 })])
    const b = wrongbookDoc([{ key: 'common-01:q1', wrongCount: 5, cleared: false }]) // 没带 lastWrongAt
    const e = entryByKey(mergeWrongbookDoc(a, b).merged, 'common-01:q1')
    expect(e.wrongCount).toBe(5)
    expect(e.lastWrongAt).toBe(T2)
  })

  it('cleared 被更晚的答错复活：cleared=false、clearedAt 摘键', () => {
    const a = wrongbookDoc([entry('common-01:q1', { cleared: true, clearedAt: T2, lastWrongAt: T1 })])
    const b = wrongbookDoc([entry('common-01:q1', { wrongCount: 4, lastWrongAt: T3 })])
    const e = entryByKey(mergeWrongbookDoc(a, b).merged, 'common-01:q1')
    expect(e.cleared).toBe(false)
    expect('clearedAt' in e).toBe(false)
    expect(e.wrongCount).toBe(4)
  })

  it('cleared 没被反超（严格更新）⇒ 保留旗子与时刻', () => {
    const a = wrongbookDoc([entry('common-01:q1', { cleared: true, clearedAt: T3, lastWrongAt: T1 })])
    const b = wrongbookDoc([entry('common-01:q1', { lastWrongAt: T1 })])
    const e = entryByKey(mergeWrongbookDoc(a, b).merged, 'common-01:q1')
    expect(e.cleared).toBe(true)
    expect(e.clearedAt).toBe(T3)
  })

  it('cleared 相等时刻不算「较新」⇒ 偏复活方向（保守：宁可多留一条，不静默藏起）', () => {
    const a = wrongbookDoc([entry('common-01:q1', { cleared: true, clearedAt: T2, lastWrongAt: T1 })])
    const b = wrongbookDoc([entry('common-01:q1', { lastWrongAt: T2 })])
    const e = entryByKey(mergeWrongbookDoc(a, b).merged, 'common-01:q1')
    expect(e.cleared).toBe(false)
    expect('clearedAt' in e).toBe(false)
  })

  it('removed 被更晚的答错复活 ⇒ removed / removedAt 一起消失；没被反超则留下', () => {
    const a = wrongbookDoc([entry('common-01:q1', { removed: true, removedAt: T2, lastWrongAt: T1 })])
    const b = wrongbookDoc([entry('common-01:q1', { lastWrongAt: T3 })])
    const revived = entryByKey(mergeWrongbookDoc(a, b).merged, 'common-01:q1')
    expect('removed' in revived).toBe(false)
    expect('removedAt' in revived).toBe(false)

    const c = wrongbookDoc([entry('common-01:q1', { removed: true, removedAt: T3, lastWrongAt: T1 })])
    const d = wrongbookDoc([entry('common-01:q1', { lastWrongAt: T1 })])
    const kept = entryByKey(mergeWrongbookDoc(c, d).merged, 'common-01:q1')
    expect(kept.removed).toBe(true)
    expect(kept.removedAt).toBe(T3)
  })

  it('hole 取或：任一侧 true ⇒ true；都没有 ⇒ 字段不存在', () => {
    const a = wrongbookDoc([entry('common-01:q1', { hole: true })])
    const withHole = entryByKey(mergeWrongbookDoc(a, wrongbookDoc([entry('common-01:q1')])).merged, 'common-01:q1')
    expect(withHole.hole).toBe(true)

    const noHole = entryByKey(
      mergeWrongbookDoc(wrongbookDoc([entry('common-01:q1')]), wrongbookDoc([entry('common-01:q1')])).merged,
      'common-01:q1'
    )
    expect('hole' in noHole).toBe(false)
  })

  it('source 跟随较新的 lastWrongAt；较新侧没带 ⇒ 旧徽章留住', () => {
    const a = wrongbookDoc([entry('common-01:q1', { source: 'lesson', lastWrongAt: T1 })])
    const b = wrongbookDoc([entry('common-01:q1', { source: 'review', lastWrongAt: T3 })])
    expect(entryByKey(mergeWrongbookDoc(a, b).merged, 'common-01:q1').source).toBe('review')

    const c = wrongbookDoc([entry('common-01:q1', { lastWrongAt: T3 })]) // 更晚但没带来源
    expect(entryByKey(mergeWrongbookDoc(a, c).merged, 'common-01:q1').source).toBe('lesson')
  })

  it('ai 本体跟随较新的 lastWrongAt 一侧', () => {
    const aiOld = { qid: 'ai-2026-09-13-1', stem: 'old stem' }
    const aiNew = { qid: 'ai-2026-09-13-1', stem: 'new stem' }
    const key = 'common-01:ai-2026-09-13-1'
    const a = wrongbookDoc([entry(key, { ai: aiOld, lastWrongAt: T1 })])
    const b = wrongbookDoc([entry(key, { ai: aiNew, lastWrongAt: T3 })])
    expect(entryByKey(mergeWrongbookDoc(a, b).merged, key).ai).toEqual(aiNew)
  })

  it('entries 键并集按 key 升序；条目未知字段与顶层未知键保留', () => {
    const a = { ...wrongbookDoc([entry('common-02:q1'), entry('common-01:q1', { marker: 'keep-me' })]), cursor: 7 }
    const b = wrongbookDoc([entry('common-01:q2')])
    const m = mergeWrongbookDoc(a, b).merged
    expect(list(m.entries).map((e) => obj(e).key)).toEqual(['common-01:q1', 'common-01:q2', 'common-02:q1'])
    expect(entryByKey(m, 'common-01:q1').marker).toBe('keep-me')
    expect(m.cursor).toBe(7)
  })

  it('版本号：无条件写当前值', () => {
    expect(mergeWrongbookDoc({ version: 0, entries: [] }, {}).merged.version).toBe(CURRENT_WRONGBOOK_VERSION)
  })
})

// ---------------------------------------------------------------- favorites

describe('favorites：冲突、平局与墓碑', () => {
  it('note 编辑冲突：updatedAt 新者胜', () => {
    const a = favoritesDoc({ items: [favItem('common-01:q1', { note: 'old note', updatedAt: T1 })] })
    const b = favoritesDoc({ items: [favItem('common-01:q1', { note: 'new note', updatedAt: T3 })] })
    const item = obj(list(mergeFavoritesDoc(a, b).merged.items)[0])
    expect(item.note).toBe('new note')
    expect(item.updatedAt).toBe(T3)
  })

  it('等时戳 + 内容不同：canonical JSON 大者胜（两侧独立算出同一赢家 ⇒ 收敛）', () => {
    const a = favoritesDoc({ items: [favItem('common-01:q1', { note: 'aaa' })] })
    const b = favoritesDoc({ items: [favItem('common-01:q1', { note: 'zzz' })] })
    const ab = mergeFavoritesDoc(a, b).merged
    const ba = mergeFavoritesDoc(b, a).merged
    expect(obj(list(ab.items)[0]).note).toBe('zzz')
    expect(ba).toEqual(ab)
  })

  it('重收藏撤销墓碑（条目时刻新/平 ⇒ 条目留、墓碑销掉）', () => {
    const a = favoritesDoc({ items: [favItem('common-01:q1', { updatedAt: T3 })] })
    const b = favoritesDoc({ removedItems: { 'common-01:q1': T1 } })
    const m = mergeFavoritesDoc(a, b).merged
    expect(list(m.items).length).toBe(1)
    expect(obj(m.removedItems)).toEqual({})

    const c = favoritesDoc({ items: [favItem('common-01:q1', { updatedAt: T2 })] })
    const d = favoritesDoc({ removedItems: { 'common-01:q1': T2 } })
    expect(list(mergeFavoritesDoc(c, d).merged.items).length).toBe(1) // 平局不算删
  })

  it('墓碑严格更新才删条目：条目删、墓碑带原时刻留证', () => {
    const a = favoritesDoc({ items: [favItem('common-01:q1', { updatedAt: T1 })] })
    const b = favoritesDoc({ removedItems: { 'common-01:q1': T2 } })
    const m = mergeFavoritesDoc(a, b).merged
    expect(list(m.items)).toEqual([])
    expect(obj(m.removedItems)).toEqual({ 'common-01:q1': T2 })
  })

  it('文件夹改名冲突 updatedAt 新者胜；removedFolders 走同一套墓碑规矩', () => {
    const a = favoritesDoc({ folders: [folder('folder-01', { name: 'old', updatedAt: T1 }), folder('folder-02')] })
    const b = favoritesDoc({
      folders: [folder('folder-01', { name: 'new', updatedAt: T3 })],
      removedFolders: { 'folder-02': T2 }
    })
    const m = mergeFavoritesDoc(a, b).merged
    expect(m.folders).toEqual([folder('folder-01', { name: 'new', updatedAt: T3 })])
    expect(obj(m.removedFolders)).toEqual({ 'folder-02': T2 })
  })

  it('孤儿 folderId 摘键：指向不存在的文件夹的条目回"未分组"，指向存在的保留', () => {
    const a = favoritesDoc({
      folders: [folder('folder-01')],
      items: [
        favItem('common-01:q1', { folderId: 'folder-01' }),
        favItem('common-02:q1', { folderId: 'folder-99' })
      ]
    })
    const items = list(mergeFavoritesDoc(a, favoritesDoc()).merged.items).map(obj)
    expect(items[0].folderId).toBe('folder-01')
    expect('folderId' in items[1]).toBe(false)
  })

  it('信封 updatedAt 取两侧 max；两侧都缺则不发明（键保持缺失）', () => {
    const a = favoritesDoc({ updatedAt: T2 })
    const b = favoritesDoc({ updatedAt: T5 })
    expect(mergeFavoritesDoc(a, b).merged.updatedAt).toBe(T5)

    const bare: Json = { version: CURRENT_FAVORITES_VERSION, folders: [], items: [] }
    expect('updatedAt' in mergeFavoritesDoc(bare, bare).merged).toBe(false)
  })

  it('版本号：无条件写当前值', () => {
    expect(mergeFavoritesDoc({ version: 1 }, {}).merged.version).toBe(CURRENT_FAVORITES_VERSION)
  })
})

// ---------------------------------------------------------------- practice

describe('practice：uid 并集与 (at, uid) 裁剪', () => {
  it('uid 并集；同 uid 内容不同 canonical 大者胜（两侧独立同结果）', () => {
    const a = practiceDoc([session(`${UID_A}:1`, T1, { mode: 'lesson' })])
    const b = practiceDoc([session(`${UID_A}:1`, T1, { mode: 'review' })])
    const ab = mergePracticeDoc(a, b).merged
    const ba = mergePracticeDoc(b, a).merged
    expect(obj(list(ab.history)[0]).mode).toBe('review')
    expect(ba).toEqual(ab)
  })

  it('(at, uid) 全序升序输出 —— 同一时刻用 uid 破并', () => {
    const a = practiceDoc([session(`${UID_A}:2`, T2), session(`${UID_A}:1`, T1)])
    const b = practiceDoc([session(`${UID_B}:1`, T1), session(`${UID_B}:2`, T2)])
    const uids = list(mergePracticeDoc(a, b).merged.history).map((s) => obj(s).uid)
    expect(uids).toEqual([`${UID_A}:1`, `${UID_B}:1`, `${UID_A}:2`, `${UID_B}:2`])
  })

  it('恰 5000 条不裁；5001 条丢全序最旧那一条（尾部保留）', () => {
    const base = Date.UTC(2026, 0, 1)
    const fiveK = practiceDoc(practiceMany(UID_A, 5000, base))
    const oneMore = practiceDoc([session(`${UID_B}:1`, new Date(base + 5000 * 1000).toISOString())])

    const trimmed = list(mergePracticeDoc(fiveK, oneMore).merged.history).map((s) => obj(s).uid)
    expect(trimmed.length).toBe(PRACTICE_KEEP_SESSIONS)
    expect(trimmed).not.toContain(`${UID_A}:1`)
    expect(trimmed).toContain(`${UID_B}:1`)
    expect(trimmed[trimmed.length - 1]).toBe(`${UID_B}:1`)

    const exact = list(mergePracticeDoc(fiveK, practiceDoc()).merged.history).map((s) => obj(s).uid)
    expect(exact.length).toBe(PRACTICE_KEEP_SESSIONS)
    expect(exact).toContain(`${UID_A}:1`) // 恰在上限 = 一条不丢
  })

  it('uid 缺失或形状不合法的会话跳过（跨设备定不了身），不抛', () => {
    const a = practiceDoc([
      { id: 3, at: T1, mode: 'lesson', items: [] }, // 没有 uid
      session('dev-a:1', T2), // uid 形状不合法
      session(`${UID_A}:1`, T3)
    ])
    const uids = list(mergePracticeDoc(a, practiceDoc()).merged.history).map((s) => obj(s).uid)
    expect(uids).toEqual([`${UID_A}:1`])
  })

  it('未知顶层键与会话未知字段保留', () => {
    const a = { ...practiceDoc([session(`${UID_A}:1`, T1, { custom: 'keep' })]), extraTop: true }
    const m = mergePracticeDoc(a, practiceDoc()).merged
    expect(m.extraTop).toBe(true)
    expect(obj(list(m.history)[0]).custom).toBe('keep')
  })

  it('版本号：无条件写当前值', () => {
    expect(mergePracticeDoc({ version: 1 }, {}).merged.version).toBe(CURRENT_PRACTICE_VERSION)
  })
})
