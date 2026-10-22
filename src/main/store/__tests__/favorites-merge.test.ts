/**
 * favorites.json 的清洗、校形与写口 apply（src/main/store/favorites-merge.ts）
 *
 * 【这个文件在守什么】
 * 收藏是**用户亲手点出来的东西** —— 它坏掉的方式全都不出声：
 *
 *   1. **AI 题没带本体**。收藏里躺着一条点不开的题：题干空白、重做时被静默跳过。
 *      和错题本当年那条死条目一模一样，所以规矩也一模一样 —— 写盘前当场拒掉。
 *   2. **孤儿 folderId**。条目指向一个已经不存在的文件夹 → 它在任何文件夹筛选里
 *      都不出现，用户看到的是「我收藏的东西自己少了」。
 *   3. **写口悄悄丢条目**。界面上显示收藏成功了，重启之后没了 ——
 *      所以写口的规矩和读口相反：坏东西**抛**，不丢。
 *   4. **写口动了不该动的东西**（v2，P10.1）：`applyFavoritesSave` 以磁盘原始
 *      JSON 为基底保留未知键，并**独占**维护 `updatedAt` 与两张墓碑表 ——
 *      业务没变就不刷时间戳、磁盘有载荷没有就盖墓碑、重新收藏撤墓碑；
 *      渲染层交来的 `updatedAt` / 墓碑一律不听（听了这几条合并纪律当场失效）。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，字符串一律英文。
 */
import { describe, expect, it, vi } from 'vitest'
import { applyFavoritesSave, cleanFavoritesPayload, normalizeFavorites } from '../favorites-merge'
import { CURRENT_FAVORITES_VERSION, type Question } from '../../../shared/types'

function q(id: string): Question {
  return { id, type: 'fill', stem: `题干 ${id}`, answer: 'x', explanation: '解析' }
}

const AI_KEY = 'common-01:ai-2026-09-13-1'
const UNKNOWN_TIME = '1970-01-01T00:00:00.000Z'
const T1 = '2026-09-01T10:00:00.000Z'
const NOW = '2026-09-20T10:00:00.000Z'
const LATER = '2026-09-21T10:00:00.000Z'

/**
 * 一份 v2 收藏文件（信封补齐：updatedAt + 两张墓碑表）。
 * `over` 用来造「信封缺一块 / 版本不认识」的场景 —— v2 起缺了这几样会被读口标重写。
 */
function fav(folders: unknown[], items: unknown[], over: Record<string, unknown> = {}) {
  return {
    version: CURRENT_FAVORITES_VERSION,
    updatedAt: T1,
    folders,
    items,
    removedItems: {},
    removedFolders: {},
    ...over
  }
}

/** 读口产物当写口的 `current`（墓碑与 updatedAt 的真源）—— 和真实接线一致 */
function currentOf(raw: unknown) {
  return normalizeFavorites(raw).file
}

/** 渲染层交上来的业务快照（只有 folders / items 两个数组） */
function payload(folders: unknown[], items: unknown[]) {
  return { folders, items }
}

/** 跑一段会对坏文件出声的代码，把 warn 收走（大多数用例不关心出声与否） */
function silent<T>(fn: () => T): T {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    return fn()
  } finally {
    warn.mockRestore()
  }
}

// ---------------------------------------------------------------- 读口

describe('normalizeFavorites（读口）', () => {
  it('文件不存在（null / undefined）→ 空信封（v2 完整形状），但**不标重写**', () => {
    for (const raw of [null, undefined]) {
      expect(normalizeFavorites(raw)).toEqual({
        file: {
          version: CURRENT_FAVORITES_VERSION,
          updatedAt: UNKNOWN_TIME,
          folders: [],
          items: [],
          removedItems: {},
          removedFolders: {}
        },
        needsRewrite: false
      })
    }
  })

  it('★ 信封、版本正确、条目干净 → needsRewrite **false**（别每次启动重写文件）', () => {
    const raw = fav(
      [{ id: 'f1', name: '难点', createdAt: T1 }],
      [{ key: 'common-01:q1', addedAt: T1, folderId: 'f1' }]
    )
    expect(normalizeFavorites(raw).needsRewrite).toBe(false)
  })

  it('整份坏掉（字符串 / 数字 / {} / folders 或 items 不是数组）→ 空信封 + 重写 + **每次都出声**', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (const raw of ['nope', 42, {}, [], { folders: [], items: 'x' }, { folders: null, items: [] }]) {
        const { file, needsRewrite } = normalizeFavorites(raw)
        expect(file, String(raw)).toEqual({
          version: CURRENT_FAVORITES_VERSION,
          updatedAt: UNKNOWN_TIME,
          folders: [],
          items: [],
          removedItems: {},
          removedFolders: {}
        })
        expect(needsRewrite).toBe(true)
      }
      expect(warn).toHaveBeenCalledTimes(6)
    } finally {
      warn.mockRestore()
    }
  })

  it('版本不认识（99 / 没写）→ 内容照读，标重写', () => {
    for (const raw of [
      fav([], [{ key: 'common-01:q1' }], { version: 99 }),
      // 干脆没写 version 的老文件（v2 之前的形状）
      { updatedAt: T1, folders: [], items: [{ key: 'common-01:q1' }], removedItems: {}, removedFolders: {} }
    ]) {
      const { file, needsRewrite } = normalizeFavorites(raw)
      expect(file.items).toHaveLength(1)
      expect(needsRewrite).toBe(true)
    }
  })

  it('★ v2 信封缺字段（没 updatedAt / 没墓碑表）→ 内容照读，标重写（下次落盘补齐）', () => {
    // 不标的话磁盘上这份永远是「半个 v2」：合并逻辑直接读墓碑表，
    // 缺表的那份会在「并集 − 墓碑」里把已删除的东西又冒出来
    const raw = { version: CURRENT_FAVORITES_VERSION, folders: [], items: [{ key: 'common-01:q1' }] }
    const { file, needsRewrite } = normalizeFavorites(raw)
    expect(file.items).toHaveLength(1)
    expect(needsRewrite).toBe(true)
    expect(file.updatedAt).toBe(UNKNOWN_TIME) // 文件级时间戳按「最古老」回填（不伪造 now）
    expect(file.removedItems).toEqual({})
    expect(file.removedFolders).toEqual({})
  })

  it('★ lessonId / qid **一律从 key 重算**，不听文件里那份', () => {
    const { file } = silent(() =>
      normalizeFavorites(fav([], [{ key: 'common-01:q7', lessonId: 'evil-course', qid: 'evil' }]))
    )
    expect(file.items[0].lessonId).toBe('common-01')
    expect(file.items[0].qid).toBe('q7')
  })

  it('AI 题**没有本体** → 丢掉并出声（这种条目点不开）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { file, needsRewrite } = normalizeFavorites(fav([], [{ key: AI_KEY }]))
      expect(file.items).toHaveLength(0)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(needsRewrite).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  it('AI 题**带着本体** → 留下，本体原样在', () => {
    const body = q('ai-2026-09-13-1')
    const { file } = silent(() => normalizeFavorites(fav([], [{ key: AI_KEY, ai: body }])))
    expect(file.items[0].ai).toEqual(body)
  })

  it('同一条题收藏了两次 → 去重留第一条（重复项会让列表出现两条一模一样的），并出声', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { file } = normalizeFavorites(
        fav([], [{ key: 'common-01:q1', note: '第一次' }, { key: 'common-01:q1', note: '第二次' }])
      )
      expect(file.items).toHaveLength(1)
      expect(file.items[0].note).toBe('第一次')
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('文件夹 id 重复 → 去重留第一条（不然「移动到这里」指到哪个说不清）', () => {
    const { file } = silent(() =>
      normalizeFavorites(
        fav([{ id: 'f1', name: '先来的' }, { id: 'f1', name: '后来的' }], [])
      )
    )
    expect(file.folders).toHaveLength(1)
    expect(file.folders[0].name).toBe('先来的')
  })

  it('笔记**不 trim**（首尾空白是内容的一部分），但整条全空白按「没有」算', () => {
    const { file } = silent(() =>
      normalizeFavorites(
        fav(
          [],
          [
            { key: 'common-01:q1', note: '  留白  \n' },
            { key: 'common-01:q2', note: '   ' },
            { key: 'common-01:q3', note: 42 }
          ]
        )
      )
    )
    expect(file.items[0].note).toBe('  留白  \n')
    expect('note' in file.items[1]).toBe(false)
    expect('note' in file.items[2]).toBe(false)
  })

  it('addedAt 丢了或坏了 → 按「最古老」兜底（不假装知道是什么时候收的）', () => {
    for (const bad of [undefined, '', 42]) {
      const { file } = silent(() => normalizeFavorites(fav([], [{ key: 'common-01:q1', addedAt: bad }])))
      expect(file.items[0].addedAt).toBe(UNKNOWN_TIME)
      // v2 的 updatedAt 跟着 addedAt 一起兜底 —— 读口交出去的条目必带它
      expect(file.items[0].updatedAt).toBe(UNKNOWN_TIME)
    }
  })

  it('★ v1 条目 / 文件夹缺 updatedAt → 按 addedAt / createdAt 回填（不伪造 now）', () => {
    const { file } = silent(() =>
      normalizeFavorites(
        fav(
          [{ id: 'f1', name: '难点', createdAt: T1 }],
          [{ key: 'common-01:q1', addedAt: T1 }]
        )
      )
    )
    expect(file.items[0].updatedAt).toBe(T1)
    expect(file.folders[0].updatedAt).toBe(T1)
  })

  it('★ 孤儿 folderId：条目**一条都不许丢**，只把 folderId 摘掉回未分组，并标重写', () => {
    // 不摘的话，这条题在任何文件夹筛选里都不出现 —— 看着就是"收藏自己少了"。
    // 标重写：否则界面按文件夹筛选时它一直落在看不见的地方，
    // 直到下一次保存才被顺手修好
    const { file, needsRewrite } = silent(() =>
      normalizeFavorites(
        fav(
          [{ id: 'f1', name: '难点' }],
          [
            { key: 'common-01:q1', folderId: 'f1' },
            { key: 'common-01:q2', folderId: 'gone' }
          ]
        )
      )
    )
    expect(file.items).toHaveLength(2)
    expect(file.items[0].folderId).toBe('f1')
    expect('folderId' in file.items[1]).toBe(false)
    expect(needsRewrite).toBe(true)
    // 读口不动墓碑区：孤儿清理不是「删除事件」
    expect(file.removedItems).toEqual({})
  })

  it('★ 未分组条目**不是孤儿**：v2 信封完整时 needsRewrite 必须 false（回归：曾被算成孤儿）', () => {
    // 2026-10-14 夜巡复现：orphans 公式把「本来就没有 folderId」的条目也计入 ⇒
    // 只要磁盘有一条未分组收藏（不建文件夹的用户的常态），needsRewrite 永真 ⇒
    // readFavorites() 每次读都写盘（rev++）⇒ favorites:save 写回调里
    // readFavorites() 自顶一戳、带渲染层旧戳的写必被 StaleRevError 拒 ——
    // 界面显示收藏成功、重启后消失（真应用探针 probe-fav1 已复现）。
    const raw = fav([], [{ key: 'common-01:q1', addedAt: T1, updatedAt: T1 }])
    expect(normalizeFavorites(raw).needsRewrite).toBe(false)

    // 混合：一条在文件夹里 + 一条未分组 —— 未分组那条不许把重写标亮
    const mixed = normalizeFavorites(
      fav(
        [{ id: 'f1', name: '难点' }],
        [
          { key: 'common-01:q1', addedAt: T1, updatedAt: T1, folderId: 'f1' },
          { key: 'common-01:q2', addedAt: T1, updatedAt: T1 }
        ]
      )
    )
    expect(mixed.needsRewrite).toBe(false)
  })

  it('key 不是字符串 / 空串 / 条目不是对象 → 丢（folderId 为空串同样当没有）', () => {
    const { file } = silent(() =>
      normalizeFavorites(fav([], [null, 'nope', { key: '' }, { key: 42 }, { key: 'common-01:q1', folderId: '  ' }]))
    )
    expect(file.items).toHaveLength(1)
    expect(file.items[0].key).toBe('common-01:q1')
    expect('folderId' in file.items[0]).toBe(false)
  })

  it('文件夹缺 id 或 name → 丢（一个没有名字的文件夹没法显示、也没法重命名）', () => {
    const { file } = silent(() =>
      normalizeFavorites(fav([{ id: 'f1' }, { name: '有名字没 id' }, { id: 'f2', name: '好的' }], []))
    )
    expect(file.folders).toHaveLength(1)
    expect(file.folders[0].id).toBe('f2')
  })
})

// ---------------------------------------------------------------- 写口校形

describe('cleanFavoritesPayload（入参校形）：坏东西**抛**，不悄悄丢', () => {
  it('合法整份 → 清洗后原样返回（只出 folders / items 两个业务数组）', () => {
    const out = cleanFavoritesPayload(
      payload(
        [{ id: 'f1', name: '难点', createdAt: T1 }],
        [{ key: 'common-01:q1', addedAt: T1, folderId: 'f1', note: '再看一眼' }]
      )
    )
    // 信封（version / updatedAt / 墓碑）不归它管 —— 那是 applyFavoritesSave 的活
    expect(Object.keys(out).sort()).toEqual(['folders', 'items'])
    expect(out.folders).toHaveLength(1)
    expect(out.items[0]).toMatchObject({
      key: 'common-01:q1',
      lessonId: 'common-01',
      qid: 'q1',
      folderId: 'f1',
      note: '再看一眼'
    })
  })

  it('★ AI 题没带本体 → **抛**（悄悄丢的后果：界面显示收藏了，重启之后没了）', () => {
    expect(() => cleanFavoritesPayload(payload([], [{ key: AI_KEY }]))).toThrow()
  })

  it('★ 同一条题交了两遍 → **抛**（写进来的东西必须是干净的）', () => {
    expect(() =>
      cleanFavoritesPayload(
        payload([], [{ key: 'common-01:q1', addedAt: T1 }, { key: 'common-01:q1', addedAt: T1 }])
      )
    ).toThrow()
  })

  it('坏文件夹 / 坏条目 / 整份坏 → 一律抛', () => {
    expect(() => cleanFavoritesPayload(payload([{ id: 'f1' }], []))).toThrow()
    expect(() => cleanFavoritesPayload(payload([], [{ key: '' }]))).toThrow()
    expect(() => cleanFavoritesPayload(payload([], [null]))).toThrow()
    expect(() => cleanFavoritesPayload(null)).toThrow()
    expect(() => cleanFavoritesPayload('nope')).toThrow()
    expect(() => cleanFavoritesPayload({ folders: [], items: 'x' })).toThrow()
  })

  it('读口与写口对同一条坏条目的态度相反：读口丢（出声），写口抛', () => {
    // 这条钉的是「两个口共用 cleanItem、但遇到坏东西的处置相反」这个设计。
    // 若哪天写口改成"顺手丢"，这条会红
    const bad = fav([], [{ key: AI_KEY }])
    const read = silent(() => normalizeFavorites(bad))
    expect(read.file.items).toHaveLength(0)
    expect(() => cleanFavoritesPayload(bad)).toThrow()
  })
})

// ---------------------------------------------------------------- 写口 apply（v2）

describe('applyFavoritesSave（写口 apply）：保留区、墓碑与 updatedAt', () => {
  it('★ 保留区：磁盘上的未知键在普通保存后仍在', () => {
    // 这是「渲染层零改动」成立的前提：写口以磁盘原始 JSON 为基底，
    // 不认识的键一个都不许丢
    const disk = { ...fav([], []), futureField: { hello: 1 }, legacyNote: ['x'] }
    const out = applyFavoritesSave({
      diskRaw: disk,
      current: currentOf(disk),
      payload: payload([], [{ key: 'common-01:q1', addedAt: T1 }]),
      now: NOW
    })
    // FavoritesFile 的类型上没有这两个键 —— 这正是「保留区」要测的点
    const raw = out as unknown as Record<string, unknown>
    expect(raw.futureField).toEqual({ hello: 1 })
    expect(raw.legacyNote).toEqual(['x'])
    // 认识的键逐个覆盖：信封补成当前版本 + 本次 now
    expect(out.version).toBe(CURRENT_FAVORITES_VERSION)
    expect(out.updatedAt).toBe(NOW)
    expect(out.items).toHaveLength(1)
  })

  it('★ 墓碑生命周期：载荷里没了 → 盖墓碑=now；再收藏回来 → 撤销墓碑、updatedAt=now', () => {
    const disk = fav([], [{ key: 'common-01:q1', addedAt: T1 }])
    const { file: current } = normalizeFavorites(disk)

    // 第一段：磁盘上有、载荷里没了 → 该 key 进 removedItems，时刻 = now
    const removed = applyFavoritesSave({ diskRaw: disk, current, payload: payload([], []), now: NOW })
    expect(removed.items).toEqual([])
    expect(removed.removedItems).toEqual({ 'common-01:q1': NOW })

    // 第二段：重新收藏（载荷里回来）→ 墓碑被撤销、条目 updatedAt = 本次 now。
    // 没有这一条，用户重新收藏会被自己的墓碑永久吞掉
    const back = applyFavoritesSave({
      diskRaw: removed,
      current: removed,
      payload: payload([], [{ key: 'common-01:q1', addedAt: T1 }]),
      now: LATER
    })
    expect(back.removedItems).toEqual({})
    expect(back.items).toHaveLength(1)
    expect(back.items[0].updatedAt).toBe(LATER)
  })

  it('★ 业务没变 → updatedAt 保持磁盘原值（不是每次保存都把全表刷成 now）', () => {
    const EDITED_AT = '2026-09-05T10:00:00.000Z'
    const disk = fav([], [{ key: 'common-01:q1', addedAt: T1, note: '笔记', updatedAt: EDITED_AT }])
    const out = applyFavoritesSave({
      diskRaw: disk,
      current: currentOf(disk),
      // 载荷是渲染层手里的快照（这里干脆不带 updatedAt —— 带了也不听）
      payload: payload([], [{ key: 'common-01:q1', addedAt: T1, note: '笔记' }]),
      now: NOW
    })
    expect(out.items[0].updatedAt).toBe(EDITED_AT)
    expect(out.items[0].updatedAt).not.toBe(NOW)
  })

  it('★ note 被编辑 → updatedAt=now', () => {
    const disk = fav([], [{ key: 'common-01:q1', addedAt: T1, note: '原来的笔记' }])
    const out = applyFavoritesSave({
      diskRaw: disk,
      current: currentOf(disk),
      payload: payload([], [{ key: 'common-01:q1', addedAt: T1, note: '改过的笔记' }]),
      now: NOW
    })
    expect(out.items[0].note).toBe('改过的笔记')
    expect(out.items[0].updatedAt).toBe(NOW)
  })

  it('★ 载荷自带的 updatedAt / 墓碑表一律不听（那两样归主进程独占）', () => {
    const disk = fav([], [], { removedItems: { 'common-01:q9': T1 } })
    const out = applyFavoritesSave({
      diskRaw: disk,
      current: currentOf(disk),
      payload: {
        folders: [],
        items: [{ key: 'common-01:q1', addedAt: T1, updatedAt: '1999-01-01T00:00:00.000Z' }],
        updatedAt: '1999-01-01T00:00:00.000Z',
        removedItems: { 'common-01:q2': '1999-01-01T00:00:00.000Z' },
        removedFolders: { f9: '1999-01-01T00:00:00.000Z' }
      },
      now: NOW
    })
    expect(out.updatedAt).toBe(NOW)
    expect(out.items[0].updatedAt).toBe(NOW) // 新条目：now，不是载荷里那个 1999
    // 渲染层的假墓碑没进来；磁盘上的旧墓碑（别人的删除证据）原样保留
    expect(out.removedItems).toEqual({ 'common-01:q9': T1 })
    expect(out.removedFolders).toEqual({})
  })

  it('★ folders 同套：没变保持 updatedAt；删掉盖 removedFolders；回来撤销并刷新', () => {
    const disk = fav([{ id: 'f1', name: '难点', createdAt: T1, updatedAt: T1 }], [])
    const { file: current } = normalizeFavorites(disk)

    const keep = applyFavoritesSave({
      diskRaw: disk,
      current,
      payload: payload([{ id: 'f1', name: '难点', createdAt: T1 }], []),
      now: NOW
    })
    expect(keep.folders[0].updatedAt).toBe(T1)

    const gone = applyFavoritesSave({ diskRaw: disk, current, payload: payload([], []), now: NOW })
    expect(gone.folders).toEqual([])
    expect(gone.removedFolders).toEqual({ f1: NOW })

    const back = applyFavoritesSave({
      diskRaw: gone,
      current: gone,
      payload: payload([{ id: 'f1', name: '难点', createdAt: T1 }], []),
      now: LATER
    })
    expect(back.removedFolders).toEqual({})
    expect(back.folders[0].updatedAt).toBe(LATER)
  })

  it('★ 指向已删文件夹的 folderId 在 apply 后仍被摘掉（孤儿清理照旧）', () => {
    // 承接旧版「写口也摘掉孤儿 folderId」用例的语义 —— 摘除搬到了 apply 的末段
    // （dropOrphanFolders）；clean 只校形：不抛，也不摘
    const disk = fav([{ id: 'f1', name: '难点', createdAt: T1 }], [])
    const p = payload([], [{ key: 'common-01:q1', addedAt: T1, folderId: 'f1' }])
    expect(() => cleanFavoritesPayload(p)).not.toThrow()

    const out = applyFavoritesSave({ diskRaw: disk, current: currentOf(disk), payload: p, now: NOW })
    // 文件夹没了 → 条目留下、folderId 摘掉回未分组（条目一条都不许丢）
    expect(out.items).toHaveLength(1)
    expect('folderId' in out.items[0]).toBe(false)
  })

  it('★ 坏载荷 → 一律抛 invalid favorites payload（写口一个字节都不许写）', () => {
    const args = { diskRaw: null, current: currentOf(null), now: NOW }
    // 缺 items / 条目缺 key / AI 键没带 ai 本体 —— 三种都过不了校形
    expect(() => applyFavoritesSave({ ...args, payload: { folders: [] } })).toThrow('invalid favorites payload')
    expect(() => applyFavoritesSave({ ...args, payload: payload([], [{ note: '没有 key' }]) })).toThrow(
      'invalid favorites payload'
    )
    expect(() => applyFavoritesSave({ ...args, payload: payload([], [{ key: AI_KEY }]) })).toThrow(
      'invalid favorites payload'
    )
  })
})
