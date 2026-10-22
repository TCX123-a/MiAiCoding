/**
 * practice.json 的清洗、校形与追加（src/main/store/practice-merge.ts）
 *
 * 【这个文件在守什么】
 * 练习史是**每日复习按错误率加权的真源**。它坏掉的方式全都无声无息：
 *
 *   1. **哨兵课号进库**（`__review__` 这类）。加权是「按课统计」，
 *      一门不存在的课进了库，那份权重就永远对不上任何真实内容 ——
 *      复习会一直抽一些"查无此课"的记录，而没有任何地方会报错。
 *   2. **只有课号、没有题号的 key**（上游拿课号当 key 了）。将来拿它去
 *      内容包里找题，得到的是"题目已被移走"的死记录。
 *   3. **一次记录悄悄没落**。练习做了、记录没写 —— 从此这块数据
 *      在加权里缺失，偏差不会被任何地方发现。
 *   4. **v2（P10.1）身份改口**：会话身份从数字 id 改成 uid
 *      （`${installId}:${id}`）。两台设备各自 max+1 会铸出**相同的数字 id**，
 *      合并按 id 去重会把另一端的整段会话当重复项吃掉；去重、铸号、
 *      超上限裁剪（按 `(at, uid)` 全序）全部改用它。老会话按本机
 *      installId 回填 uid —— 回填**必须落盘**（needsRewrite）。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，字符串一律英文。
 */
import { describe, expect, it, vi } from 'vitest'
import { appendPractice, assertPracticeInput, normalizePractice } from '../practice-merge'
import {
  CURRENT_PRACTICE_VERSION,
  PRACTICE_KEEP_SESSIONS,
  type PracticeFile
} from '../../../shared/types'

const NOW = '2026-09-29T10:00:00.000Z'
const UNKNOWN_TIME = '1970-01-01T00:00:00.000Z'

/** 本机 installId（36 位 uuid —— uid 形状 `${installId}:${id}` 由 protocol 的冻结正则校验） */
const INSTALL = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
/** 另一台设备的 installId（跨设备合并：uid 前缀不同，数字 id 撞了也不是同一条） */
const OTHER_INSTALL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

/** 一条作答记录（`lessonId` 故意写错：读口必须从 key 重算，不听它） */
function item(key: string, ok = true) {
  return { key, lessonId: 'WRONG', ok }
}

/**
 * 一条会话（v2：uid = `${installId}:${id}`）。
 * `over` 用来造老文件（无 uid）、坏 uid、以及逐条控制 at 的场景。
 */
function session(id: number, items: unknown[], over: Record<string, unknown> = {}) {
  return { id, uid: `${INSTALL}:${id}`, at: '2026-09-01T10:00:00.000Z', mode: 'lesson', items, ...over }
}

/** 按 id 造一个递增的 at（id=1 最旧）—— 给「按 (at, uid) 全序裁剪」的用例控制新旧 */
function atOf(id: number): string {
  return new Date(Date.UTC(2026, 0, 1) + id * 60_000).toISOString()
}

/** 一份练习史文件 */
function file(history: unknown[], version: unknown = CURRENT_PRACTICE_VERSION): unknown {
  return { version, history }
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

// ---------------------------------------------------------------- 写口入参

describe('assertPracticeInput：形状不对属于调用方写错了，该炸得响亮', () => {
  it('合法入参（含 AI 题 key）→ 放行', () => {
    // AI 题 key 是 `宿主课号:ai-日期-序号`，拆得出真实课号，所以照样合法
    expect(() =>
      assertPracticeInput({
        mode: 'review',
        items: [{ key: 'common-01:q1', ok: true }, { key: 'common-01:ai-2026-09-13-1', ok: false }]
      })
    ).not.toThrow()
  })

  it('★ 哨兵课号 → 抛（复习的加权是「按课统计」，不存在的课一进库权重就永远对不上）', () => {
    for (const key of ['__review__:q1', '__wrong__:q1', '__challenge__:q1']) {
      expect(() => assertPracticeInput({ mode: 'review', items: [{ key, ok: true }] }), key).toThrow()
    }
  })

  it('★ 只有课号、没有题号（没有冒号）→ 抛', () => {
    // `common-01` 说明上游把课号当 key 用了。将来拿它去找题 = 死记录，
    // 而这种错不报错，只会在每日复习里悄悄少一条
    expect(() => assertPracticeInput({ mode: 'lesson', items: [{ key: 'common-01', ok: true }] })).toThrow()
  })

  it('mode 空 / ok 非布尔 / items 空或非数组 / 不是对象 → 一律抛', () => {
    const bad: unknown[] = [
      null,
      'nope',
      { mode: '', items: [{ key: 'common-01:q1', ok: true }] },
      { mode: 'lesson', items: [] },
      { mode: 'lesson', items: 'x' },
      { mode: 'lesson', items: [{ key: 'common-01:q1' }] },
      { mode: 'lesson', items: [{ key: 'common-01:q1', ok: 'yes' }] },
      { mode: 'lesson', items: [null] }
    ]
    for (const v of bad) {
      expect(() => assertPracticeInput(v), String(v)).toThrow()
    }
  })
})

// ---------------------------------------------------------------- 追加

describe('appendPractice：一次做完落一条', () => {
  const empty: PracticeFile = { version: CURRENT_PRACTICE_VERSION, history: [] }

  it('id 由这里铸：= 现有最大 id + 1；uid = `${installId}:${id}`（不让渲染层传号，两个写口各自编号会撞）', () => {
    const cur: PracticeFile = {
      version: CURRENT_PRACTICE_VERSION,
      history: [
        session(3, [item('common-01:q1')]),
        session(7, [item('common-01:q1')])
      ] as never
    }
    const next = appendPractice(cur, { mode: 'lesson', items: [{ key: 'common-01:q1', ok: true }] }, NOW, INSTALL)
    expect(next.history.at(-1)?.id).toBe(8)
    expect(next.history.at(-1)?.uid).toBe(`${INSTALL}:8`)
  })

  it('★ 铸 uid 时把**别的设备合并来的大 id**也算进 max（我机 max id=2 + 对端 id=7 → 下一条是 8）', () => {
    // max 只看数字 id，不看 uid 前缀：只数本机那几条的实现会铸出 `${INSTALL}:3`，
    // 而它将来和本机更早的号没有任何协调余地（合并去重就是靠 uid 不相撞）
    const cur: PracticeFile = {
      version: CURRENT_PRACTICE_VERSION,
      history: [
        session(2, [item('common-01:q1')]),
        session(7, [item('common-01:q1')], { uid: `${OTHER_INSTALL}:7` })
      ] as never
    }
    const next = appendPractice(cur, { mode: 'lesson', items: [{ key: 'common-01:q1', ok: true }] }, NOW, INSTALL)
    expect(next.history.at(-1)?.id).toBe(8)
    expect(next.history.at(-1)?.uid).toBe(`${INSTALL}:8`)
  })

  it('★ lessonId 从 key 拆 —— 入参只报 key 和 ok（AI 题拆出来的是宿主课号）', () => {
    const next = appendPractice(
      empty,
      {
        mode: 'wrong',
        items: [
          { key: 'common-01:q1', ok: true },
          { key: 'python-03:ai-2026-09-13-1', ok: false }
        ]
      },
      NOW,
      INSTALL
    )
    expect(next.history[0].items).toEqual([
      { key: 'common-01:q1', lessonId: 'common-01', ok: true },
      { key: 'python-03:ai-2026-09-13-1', lessonId: 'python-03', ok: false }
    ])
  })

  it('at 用传进来的 now，mode 原样带上', () => {
    const next = appendPractice(empty, { mode: 'challenge', items: [{ key: 'common-01:q1', ok: true }] }, NOW, INSTALL)
    expect(next.history[0].at).toBe(NOW)
    expect(next.history[0].mode).toBe('challenge')
  })

  it('不改动传进来的那份文件（调用方手里那份还得当旧值用）', () => {
    const cur: PracticeFile = {
      version: CURRENT_PRACTICE_VERSION,
      history: [session(1, [item('common-01:q1')])] as never
    }
    const snapshot = JSON.parse(JSON.stringify(cur))
    appendPractice(cur, { mode: 'lesson', items: [{ key: 'common-01:q1', ok: true }] }, NOW, INSTALL)
    expect(cur).toEqual(snapshot)
  })

  it(`正好 ${PRACTICE_KEEP_SESSIONS} 条时**一条都不丢**（边界）`, () => {
    const history = Array.from({ length: PRACTICE_KEEP_SESSIONS - 1 }, (_, i) => session(i + 1, [item('common-01:q1')]))
    const next = appendPractice(
      { version: CURRENT_PRACTICE_VERSION, history } as never,
      { mode: 'lesson', items: [{ key: 'common-01:q1', ok: true }] },
      NOW,
      INSTALL
    )
    expect(next.history).toHaveLength(PRACTICE_KEEP_SESSIONS)
  })

  it('★ 超上限丢的是 (at, uid) 全序最旧的那条（不是数组第一条），其余顺序原样不动', () => {
    // 文件里的顺序理论上就是时间顺序，但外部改过的文件可以把新旧打乱；
    // at 才是「谁老」的凭据（同一 at 时用 uid 破并，见读口那条同 at 用例）。
    // 这里把 id=1（at 最旧）故意放在数组中间：按下标丢的实现会丢错 id=2 ——
    // 而它才刚做过
    const ids = Array.from({ length: PRACTICE_KEEP_SESSIONS }, (_, i) => i + 1)
    const order = [2, PRACTICE_KEEP_SESSIONS, 1, ...ids.slice(2, PRACTICE_KEEP_SESSIONS - 1)]
    const history = order.map((id) => session(id, [item('common-01:q1')], { at: atOf(id) }))
    const next = appendPractice(
      { version: CURRENT_PRACTICE_VERSION, history } as never,
      { mode: 'lesson', items: [{ key: 'common-01:q1', ok: true }] },
      NOW,
      INSTALL
    )
    expect(next.history).toHaveLength(PRACTICE_KEEP_SESSIONS)
    expect(next.history.find((s) => s.id === 1), 'at 最旧的那条没被丢').toBeUndefined()
    // 顺序保住：前三条仍是 [2, 5000, 3]（就地 sort 的实现会变成按 at 升序 [2, 3, 4]）
    expect(next.history.slice(0, 3).map((s) => s.id)).toEqual([2, PRACTICE_KEEP_SESSIONS, 3])
  })
})

// ---------------------------------------------------------------- 读口

describe('normalizePractice（读口）', () => {
  it('文件不存在（null / undefined）→ 空信封，但**不标重写**', () => {
    for (const raw of [null, undefined]) {
      expect(normalizePractice(raw, INSTALL)).toEqual({
        file: { version: CURRENT_PRACTICE_VERSION, history: [] },
        needsRewrite: false
      })
    }
  })

  it('信封、版本正确、内容干净 → needsRewrite **false**', () => {
    const raw = file([session(1, [item('common-01:q1')])])
    expect(normalizePractice(raw, INSTALL).needsRewrite).toBe(false)
  })

  it('“没有 version”也标重写（但不属于坏文件，不出声）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { file: out, needsRewrite } = normalizePractice({ history: [] }, INSTALL)
      expect(needsRewrite).toBe(true)
      expect(out.history).toEqual([])
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('整份坏掉（字符串 / 数字 / {} / history 不是数组）→ 空信封 + 重写 + **每次都出声**', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (const raw of ['nope', 42, {}, { history: 'x' }, { history: null }]) {
        const { file: out, needsRewrite } = normalizePractice(raw, INSTALL)
        expect(out, String(raw)).toEqual({ version: CURRENT_PRACTICE_VERSION, history: [] })
        expect(needsRewrite).toBe(true)
      }
      expect(warn).toHaveBeenCalledTimes(5)
    } finally {
      warn.mockRestore()
    }
  })

  it('★ v1 老文件（无 uid）→ uid 回填 `${installId}:${id}`、needsRewrite=true（回填必须落盘）', () => {
    // 回填不落盘的话，每次读都要重做一遍，而且推给对端的那一份没有 uid ——
    // 合并根本去不了重。两个夹具：v1（版本老）与 v2 却缺 uid（回填单独也能触发重写）
    for (const raw of [
      { version: 1, history: [{ id: 4, at: NOW, mode: 'lesson', items: [item('common-01:q1')] }] },
      file([{ id: 4, at: NOW, mode: 'lesson', items: [item('common-01:q1')] }])
    ]) {
      const { file: out, needsRewrite } = normalizePractice(raw, INSTALL)
      expect(out.history[0].uid).toBe(`${INSTALL}:4`)
      expect(needsRewrite).toBe(true)
      expect(out.version).toBe(CURRENT_PRACTICE_VERSION)
    }
  })

  it('★ 干净的 v2 文件 → needsRewrite=false、uid 原样保留（别人设备的号一个字都不动）', () => {
    const raw = file([session(4, [item('common-01:q1')], { uid: `${OTHER_INSTALL}:4` })])
    const { file: out, needsRewrite } = normalizePractice(raw, INSTALL)
    expect(needsRewrite).toBe(false)
    expect(out.history[0].uid).toBe(`${OTHER_INSTALL}:4`)
  })

  it('★ uid 坏（如 garbage）→ 用 id 重建 `${installId}:${id}`，并标重写', () => {
    const { file: out, needsRewrite } = normalizePractice(
      file([session(3, [item('common-01:q1')], { uid: 'garbage' })]),
      INSTALL
    )
    expect(out.history[0].uid).toBe(`${INSTALL}:3`)
    expect(needsRewrite).toBe(true)
  })

  it('★ 作答记录里 lessonId 重算、哨兵/无题号/坏 ok 的条目被滤掉，好的留下', () => {
    const { file: out } = silent(() =>
      normalizePractice(
        file([
          session(1, [
            { key: 'common-01:q1', lessonId: 'WRONG', ok: true },
            { key: '__review__:q1', ok: true },
            { key: 'common-01', ok: true },
            { key: 'common-01:q2', ok: 'yes' },
            null,
            { key: 'common-01:q3', ok: false }
          ])
        ]),
        INSTALL
      )
    )
    expect(out.history[0].items).toEqual([
      { key: 'common-01:q1', lessonId: 'common-01', ok: true },
      { key: 'common-01:q3', lessonId: 'common-01', ok: false }
    ])
  })

  it('★ 一条有效作答都没有的会话**整条丢掉**（空会话占着上限，什么都算不出来）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { file: out, needsRewrite } = normalizePractice(
        file([session(1, []), session(2, [{ key: '__review__:q1', ok: true }]), session(3, [item('common-01:q1')])]),
        INSTALL
      )
      expect(out.history).toHaveLength(1)
      expect(out.history[0].id).toBe(3)
      expect(needsRewrite).toBe(true)
      // 两条会话被丢 → 出声一次（一次请求里丢的条数合并成一条消息）
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('id 重复（uid 随之重复）→ 留第一条（文件被外部改过），多出来的出声', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { file: out } = normalizePractice(
        file([session(1, [item('common-01:q1')]), session(1, [item('common-01:q2')])]),
        INSTALL
      )
      expect(out.history).toHaveLength(1)
      expect(out.history[0].items[0].key).toBe('common-01:q1')
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('★ 同一 uid 出现两次（数字 id 不同）→ 留第一条、后一条算丢（去重键是 uid）', () => {
    // 按 id 去重的实现会以为这是两条（id 5 / 6），两条都留 —— 这条因此红。
    // uid 才是身份：同一个 uid 就是同一条会话，文件被外部改过或两端串了号
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { file: out, needsRewrite } = normalizePractice(
        file([
          session(5, [item('common-01:q1')]),
          session(6, [item('common-01:q2')], { uid: `${INSTALL}:5` })
        ]),
        INSTALL
      )
      expect(out.history).toHaveLength(1)
      expect(out.history[0].items[0].key).toBe('common-01:q1')
      expect(needsRewrite).toBe(true)
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('★ 数字 id 相同、uid 不同（两台设备各自铸的号）→ 两条都留（uid 就是为这个存在的）', () => {
    // 两台设备各自 max+1，id=5 会撞；uid 带 installId 前缀，撞不了。
    // 按 id 去重的实现会把第二条吃掉 —— 这正是 v1 的老 bug
    const { file: out, needsRewrite } = normalizePractice(
      file([
        session(5, [item('common-01:q1')], { uid: `${INSTALL}:5` }),
        session(5, [item('common-01:q2')], { uid: `${OTHER_INSTALL}:5` })
      ]),
      INSTALL
    )
    expect(out.history).toHaveLength(2)
    expect(out.history.map((s) => s.items[0].key)).toEqual(['common-01:q1', 'common-01:q2'])
    expect(needsRewrite).toBe(false)
  })

  it('id 坏掉 → 按 0 算（排在最前，将来超上限先丢它），但只留一条', () => {
    const { file: out } = silent(() =>
      normalizePractice(file([session(Number.NaN, [item('common-01:q1')]), session(Number.NaN, [item('common-01:q2')])]), INSTALL)
    )
    expect(out.history).toHaveLength(1)
    expect(out.history[0].id).toBe(0)
    // uid 也按回填规则重建：`${INSTALL}:NaN` 不是合法 uid → `${installId}:0`
    expect(out.history[0].uid).toBe(`${INSTALL}:0`)
  })

  it('mode 丢了 → 留空串（**不编**一个假模式），at 坏了 → 按最古老兜底', () => {
    const { file: out } = silent(() =>
      normalizePractice(file([session(1, [item('common-01:q1')], { mode: '', at: 42 })]), INSTALL)
    )
    expect(out.history[0].mode).toBe('')
    expect(out.history[0].at).toBe(UNKNOWN_TIME)
  })

  it(`★ 读的时候也按 ${PRACTICE_KEEP_SESSIONS} 条裁，**丢 (at, uid) 全序最旧的**并出声`, () => {
    // 上限是**文件的不变式**，不能假设磁盘上那份一定守规矩
    const history = Array.from({ length: PRACTICE_KEEP_SESSIONS + 3 }, (_, i) =>
      session(i + 1, [item('common-01:q1')], { at: atOf(i + 1) })
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { file: out, needsRewrite } = normalizePractice(file(history), INSTALL)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(out.history).toHaveLength(PRACTICE_KEEP_SESSIONS)
      expect(out.history.find((s) => s.id <= 3), '该丢的是最旧的 3 条').toBeUndefined()
      expect(out.history[0].id).toBe(4)
      expect(needsRewrite).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  it('★ 同一 at 的两条：uid **字典序**小的先被丢（全序才收敛，按数字比不算数）', () => {
    // 两台设备合并后同一时刻的会话不止一条；丢法必须由 (at, uid) 全序定死，
    // 否则 A 机丢左、B 机丢右，两份文件永远收敛不了。
    // 夹具故意选 id 2 与 id 10 共用最旧的 at：字符串上 ':10' < ':2'，
    // 而数字上 2 < 10 —— 按 id（或 uid 里的数字）比较的实现会丢错那条，这条红
    const oldest = '2026-08-01T00:00:00.000Z'
    const history = Array.from({ length: PRACTICE_KEEP_SESSIONS + 1 }, (_, i) =>
      session(i + 1, [item('common-01:q1')])
    )
    history[1] = session(2, [item('common-01:q1')], { at: oldest }) // 下标 1 = id 2
    history[9] = session(10, [item('common-01:q1')], { at: oldest }) // 下标 9 = id 10
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { file: out, needsRewrite } = normalizePractice(file(history), INSTALL)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(out.history).toHaveLength(PRACTICE_KEEP_SESSIONS)
      expect(out.history.find((s) => s.uid === `${INSTALL}:10`), '字典序小的那条先丢').toBeUndefined()
      expect(out.history.find((s) => s.uid === `${INSTALL}:2`)).toBeDefined()
      expect(needsRewrite).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  it('items 不是数组的会话 → 整条丢', () => {
    const { file: out } = silent(() =>
      normalizePractice(file([session(1, 'x' as never), session(2, [item('common-01:q1')])]), INSTALL)
    )
    expect(out.history).toHaveLength(1)
    expect(out.history[0].id).toBe(2)
  })
})
