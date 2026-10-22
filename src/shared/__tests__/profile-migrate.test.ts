/**
 * profile.json 的版本迁移（src/shared/profile-migrate.ts）
 *
 * 【这个文件在守什么】
 * 迁移的输入是「**别人硬盘上那份我们没见过、也不该假设的**文件」，
 * 而档案是这个应用里**唯一不可再生的数据** —— 配置丢了可以重设，
 * 错题本丢了少看几条，档案丢了就是「白学了」。它的失败方式全是静默的：
 *
 *   1. **`learned` 被清空或丢失**。这是档案版的「apiKey 被抹掉」——
 *      而且比 apiKey 严重：Key 还能再去后台生成一把，学过的课没法重来一遍。
 *   2. **老档案（v1）读出来没有 `rewards`**。新代码一读它就是 `undefined`，
 *      发奖逻辑 `.gallery.includes(...)` 当场抛错 —— 而那条路只有
 *      「复习全对」才会走到，平时根本测不出来。
 *   3. **`stats.learnedCount` 和 `learned` 对不上**。界面显示「已学 12 课」、
 *      列表里只有 11 行，谁也查不出差在哪。
 *   4. **每次启动重迁一遍**：迁完不写版本号的话，磁盘上那份永远像"没迁过"。
 *   5. **签到明细（v3）进了假日子或坏形状**。`'2026-02-30'` 这种"格式对、
 *      日子不存在"的键画不出格子，按字符串排序还会把升序前提弄塌；
 *      而发饭闸门（`days.includes`）靠的正是这份明细 —— 清洗错一条，
 *      轻则月历少一格，重则同一日键能领两次大白饭（见 applyCheckin 的幂等用例）。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，字符串一律英文。
 */
import { describe, expect, it, vi } from 'vitest'
import { applyCheckin, CHECKIN_DAYS_MAX, EPOCH0_ISO, migrateProfile } from '../profile-migrate'
import { shiftDateKey } from '../dates'
import {
  CURRENT_PROFILE_VERSION,
  DEFAULT_PROFILE,
  type CheckinState,
  type UserProfile
} from '../types'

/** 一份**当前版本**的完整档案，用来做「迁移不该改动已经对了的东西」的基线 */
const current = (): UserProfile => structuredClone(DEFAULT_PROFILE)

/** 一份 v1 时代的真档案：没有 rewards，stats 里三个数都在 */
function v1Archive(): Record<string, unknown> {
  return {
    version: 1,
    learned: ['common-01', 'python-03'],
    favorites: ['common-01'],
    history: [{ lessonId: 'common-01', finishedAt: '2026-09-01T10:00:00.000Z' }],
    stats: { learnedCount: 2, practicedCount: 17, streakDays: 3 }
  }
}

/** 一份 v2 时代的真档案：有 rewards，**没有 checkin**（v3 才有的那一节） */
function v2Archive(): Record<string, unknown> {
  return {
    version: 2,
    learned: ['common-01', 'python-03'],
    favorites: ['common-01'],
    history: [{ lessonId: 'common-01', finishedAt: '2026-09-01T10:00:00.000Z' }],
    stats: { learnedCount: 2, practicedCount: 17, streakDays: 3 },
    rewards: { gallery: ['dafeiyu-01'], perfectPasses: 2 }
  }
}

/** 跑一次迁移并吞掉 warn（绝大多数用例不关心出声与否） */
function silent(raw: unknown): UserProfile {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    return migrateProfile(raw)
  } finally {
    warn.mockRestore()
  }
}

// ---------------------------------------------------------------- 最要紧的一条

describe('learned **绝对不能**在迁移里丢掉', () => {
  it('老档案（v1，没有 rewards）里的 learned 原样带过来', () => {
    // 这是整份迁移里唯一一条「弄错了会让用户真的损失东西」的规矩。
    // 别的字段错了顶多显示不对，这个错了就是「学了一学期的进度归零」，
    // 而且用户没有任何办法把它找回来（没有云端、没有别的副本）
    const out = migrateProfile(v1Archive())
    expect(out.learned).toEqual(['common-01', 'python-03'])
    expect(out.favorites).toEqual(['common-01'])
    expect(out.history).toEqual([
      { lessonId: 'common-01', finishedAt: '2026-09-01T10:00:00.000Z' }
    ])
  })

  it('**不 trim、不规范化**：课号是身份，一字不改地留着', () => {
    // 「顺手规范化」在这类字段上改的是身份本身 —— 带空格的课号反正是死值，
    // 但改它意味着我们**替用户改了他数据的意思**，而配置那边（apiKey）已经
    // 定过同一条规矩。真需要规范化的是保存入口，不是迁移
    const out = silent({ learned: [' common-01 ', 'x'], favorites: [] })
    expect(out.learned).toEqual([' common-01 ', 'x'])
  })

  it('反向验证：**空数组也是合法值**，不能被顶成默认值', () => {
    // 「全新安装、什么都没学」和「档案缺了 learned 这一栏」在迁移里必须区分开。
    // 少了这一条，上面那条「原样带过来」用一个写死的默认数组也能绿
    const out = migrateProfile({ version: 1, learned: [], favorites: [], history: [], stats: {} })
    expect(out.learned).toEqual([])
  })
})

// ---------------------------------------------------------------- v1 → v2

describe('v1 → v2：rewards 那一节', () => {
  it('老档案里**根本没有这一节** → 补一份空的（而不是 undefined）', () => {
    // 给 undefined 的话，升级上来的用户第一次「复习全对」时，
    // 发奖逻辑读 `.gallery` 当场抛错 —— 而那正是该高兴的时刻
    const out = migrateProfile(v1Archive())
    expect(out.rewards).toEqual({ gallery: [], perfectPasses: 0, lastImageDay: null })
  })

  it('已经有 rewards 的档案：一图一号原样留住', () => {
    const out = silent({
      version: 2,
      learned: [],
      favorites: [],
      history: [],
      stats: {},
      rewards: { gallery: ['dafeiyu-01', 'dafeiyu-02'], perfectPasses: 5 }
    })
    expect(out.rewards.gallery).toEqual(['dafeiyu-01', 'dafeiyu-02'])
    expect(out.rewards.perfectPasses).toBe(5)
  })

  it('gallery 里的坏值（非字符串/空串/重复）被清掉，好的留下', () => {
    // 图库清单是数组 = 集合语义：重复项会让「还差几张没拿到」算错，
    // 而非字符串一进 `includes` 比较就是永假 —— 那张图等于**永远发不出来**
    const out = silent({
      rewards: { gallery: ['a', 'a', '', 42, null, 'b', '  '], perfectPasses: 1 }
    })
    expect(out.rewards.gallery).toEqual(['a', 'b'])
  })

  it('perfectPasses 是坏数（负数/NaN/字符串）→ 退回 0，不是被钳成别的', () => {
    // 和 sfxVolume 那条同一个道理：NaN 的意思是「这个值没意义」，
    // 不是「用户通关了 0 次」。`Number.isFinite` 那一道挡的就是它
    for (const bad of [-3, Number.NaN, Number.POSITIVE_INFINITY, '5', null, {}]) {
      expect(silent({ rewards: { perfectPasses: bad } }).rewards.perfectPasses, String(bad)).toBe(0)
    }
    expect(silent({ rewards: { perfectPasses: 7.6 } }).rewards.perfectPasses).toBe(8)
  })

  it('rewards 整节是坏形状（数组/字符串）时给一份空的，不崩', () => {
    for (const bad of [[], 'nope', 42, null]) {
      expect(silent({ rewards: bad }).rewards).toEqual({ gallery: [], perfectPasses: 0, lastImageDay: null })
    }
  })
})

// ---------------------------------------------------------------- v5：lastImageDay

describe('v5：rewards.lastImageDay（每日一次图的判据）', () => {
  it('老档案（v2，没有这个键）→ null —— 不是 undefined、更不是"今天"', () => {
    // 补 null 而不是补今天：补今天等于宣布"你今天已经拿过了"，
    // 升级上来的用户第一次全对反而拿不到图（还查不出原因）
    const out = migrateProfile(v2Archive())
    expect(out.rewards.lastImageDay).toBeNull()
  })

  it('合法日键原样留住', () => {
    const out = silent({ rewards: { gallery: [], perfectPasses: 0, lastImageDay: '2026-10-15' } })
    expect(out.rewards.lastImageDay).toBe('2026-10-15')
  })

  it('坏键一律退回 null（形状不对 / 日子不存在 / 非字符串）—— 留着坏键图会**永远**发不出来', () => {
    // 判据是 `day <= lastImageDay`（字符串序）：坏键若留下，可能对任何真实日子
    // 都恒真 ⇒ 用户从此再也拿不到奖励图，而界面只表现为"全对之后什么都没发生"。
    // 清洗方向永远选"救得回来"那边：null 的代价最多是今天多发一张
    for (const bad of ['2026-2-3', '2026-02-30', 'zzz', '', 42, null, undefined, {}]) {
      expect(silent({ rewards: { lastImageDay: bad } }).rewards.lastImageDay, String(bad)).toBeNull()
    }
  })
})

// ---------------------------------------------------------------- v2 → v3

describe('v2 → v3：checkin 那一节', () => {
  it('老档案里**根本没有这一节** → 补一份空的（而不是 undefined），别的字段一字不动', () => {
    // 给 undefined 的话，月历第一笔 `checkin.days.includes(...)` 当场抛错，
    // 而它挂在总览页上 —— 升级上来的用户**一进首页就崩**，比抛在角落里严重
    const out = migrateProfile(v2Archive())
    expect(out.checkin).toEqual({ lastDate: null, streakDays: 0, totalDays: 0, days: [] })
    expect(out.learned).toEqual(['common-01', 'python-03'])
    expect(out.rewards).toEqual({ gallery: ['dafeiyu-01'], perfectPasses: 2, lastImageDay: null })
    expect(out.version).toBe(CURRENT_PROFILE_VERSION)
  })

  it('已经签过几天的档案：明细、连续、总量原样留住', () => {
    const out = silent({
      ...v2Archive(),
      checkin: { lastDate: '2026-10-08', streakDays: 2, totalDays: 9, days: ['2026-10-07', '2026-10-08'] }
    })
    expect(out.checkin).toEqual({
      lastDate: '2026-10-08',
      streakDays: 2,
      totalDays: 9,
      days: ['2026-10-07', '2026-10-08']
    })
  })
})

describe('checkin 明细：假日子/重复/非串全丢，升序，只留最近一年', () => {
  it('坏条目全丢、好的留下，并**出声一次**（汇总，不是每条一声）', () => {
    // 坏条目分三类，都可能混进 days：
    //   · '2026-2-3'   —— 形状不对（少补零），它排不进升序里该在的位置
    //   · '2026-02-30' —— 形状对、**日子不存在**（2 月没有 30 号）——
    //                    只查正则挡不住它，必须 parseDateKey 回环验一次
    //   · 重复项 / 非字符串 —— 集合语义的数组不该有
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const out = migrateProfile({
        checkin: {
          lastDate: '2026-10-08',
          streakDays: 2,
          totalDays: 2,
          days: ['2026-10-08', '2026-2-3', '2026-02-30', '2026-10-08', 42, null, '2026-10-07']
        }
      })
      expect(out.checkin.days).toEqual(['2026-10-07', '2026-10-08'])
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('乱序输入被修成升序（字符串序 = 时间序，闸门和截断都靠它）', () => {
    const out = silent({
      checkin: { days: ['2026-10-08', '2026-09-30', '2026-10-01'] }
    })
    expect(out.checkin.days).toEqual(['2026-09-30', '2026-10-01', '2026-10-08'])
  })

  it('超过一年：**保留最新 366**，早的被截掉；totalDays 不跟着退', () => {
    // 明细有上限（画不出也存不下无限格），但「累计天数」是成绩单，
    // 它**只增不减** —— 截明细把 total 一起截小是偷改用户的成绩
    const base = '2026-10-08'
    const days = Array.from({ length: 400 }, (_, i) => shiftDateKey(base, -i)!)
    const out = silent({ checkin: { days, totalDays: 400 } })
    expect(out.checkin.days.length).toBe(CHECKIN_DAYS_MAX)
    expect(out.checkin.days[out.checkin.days.length - 1]).toBe(base)
    expect(out.checkin.days[0]).toBe(shiftDateKey(base, -(CHECKIN_DAYS_MAX - 1)))
    expect(out.checkin.totalDays).toBe(400)
  })

  it('totalDays 的证据下界：明细比它多时抬到明细数（只往上修）', () => {
    // total < days.length 是自相矛盾（签过的日子都在明细里），
    // 而 total 是要显示给人看的数 —— 矛盾档案里以**证据**（明细）为准
    const out = silent({
      checkin: { totalDays: 1, days: ['2026-10-05', '2026-10-06', '2026-10-07'] }
    })
    expect(out.checkin.totalDays).toBe(3)
  })

  it('lastDate 规范形：不在 days 里 / 形状坏 → 回退 max(days)；days 空 → null', () => {
    // lastDate 只给 streak 接续用，它的不变量是「要么 null、要么等于明细里最新那天」。
    // 漂在 days 外面的 lastDate 会让下一次签到的 streak 接错
    const fallback = silent({
      checkin: { lastDate: '2026-01-01', days: ['2026-10-05', '2026-10-06'] }
    })
    expect(fallback.checkin.lastDate).toBe('2026-10-06')

    const badShape = silent({ checkin: { lastDate: '2026-2-3', days: ['2026-10-05'] } })
    expect(badShape.checkin.lastDate).toBe('2026-10-05')

    const empty = silent({ checkin: { lastDate: '2026-10-05', days: [] } })
    expect(empty.checkin.lastDate).toBeNull()
  })

  it('streakDays / totalDays 坏值钳成非负整数', () => {
    const out = silent({ checkin: { streakDays: Number.NaN, totalDays: 'x' } })
    expect(out.checkin.streakDays).toBe(0)
    expect(out.checkin.totalDays).toBe(0)
    expect(silent({ checkin: { streakDays: 4.6 } }).checkin.streakDays).toBe(5)
  })

  it('checkin 整节是坏形状（数组/字符串/数字）→ 给默认值，不崩、也不按"丢条目"出声', () => {
    // 与 rewards 同一条口径：**整节**没形状 = 静默给默认（没条目可数），
    // 条目级的丢失才出声 —— 不然老档案（没这节）升级时会白喊
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (const bad of [[], 'nope', 42, null]) {
        const out = migrateProfile({ checkin: bad })
        expect(out.checkin).toEqual({ lastDate: null, streakDays: 0, totalDays: 0, days: [] })
      }
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

// ---------------------------------------------------------------- stats

describe('stats：派生值重算，其余钳成正经数', () => {
  it('★ learnedCount **重算**，不信文件里那个数', () => {
    // 「已学 N 课」是界面上的一个数，而它必须和 learned 数组**永远对得上**。
    // 搬运的话，上面几道清洗丢掉一条坏记录之后，这个数就和数组矛盾了 ——
    // 界面显示「已学 12 课」而列表里只有 11 行，谁也查不出差在哪
    const out = silent({ ...v1Archive(), stats: { learnedCount: 999, practicedCount: 1, streakDays: 1 } })
    expect(out.stats.learnedCount).toBe(2)
  })

  it('清洗掉坏条目之后 learnedCount 跟着变（这就是重算的意义）', () => {
    const out = silent({
      learned: ['a', 42, 'b', ''],
      stats: { learnedCount: 4, practicedCount: 0, streakDays: 0 }
    })
    expect(out.learned).toEqual(['a', 'b'])
    expect(out.stats.learnedCount).toBe(2)
  })

  it('practicedCount：非负整数兜底，坏值退回 0', () => {
    const out = silent({ stats: { practicedCount: -5, streakDays: Number.NaN } })
    expect(out.stats.practicedCount).toBe(0)

    const ok = silent({ stats: { practicedCount: 12.4, streakDays: 3 } })
    expect(ok.stats.practicedCount).toBe(12)
  })

  it('★ stats.streakDays 是**签到镜像**（v3 起），文件里那个旧数不搬', () => {
    // 连续天数从 v3 起只有一个真源 = checkin.streakDays（照 learnedCount 的派生先例）。
    // 搬老档案里那个遗留数字的话，「月历上一格都没签、统计却说连续 3 天」
    // 这类自相矛盾会永久留在档里 —— 而它是界面上一个要被人看见的数
    const stale = silent({ stats: { practicedCount: 1, streakDays: 3 } })
    expect(stale.stats.streakDays).toBe(0)

    const real = silent({
      checkin: { lastDate: '2026-10-08', streakDays: 5, totalDays: 9, days: ['2026-10-07', '2026-10-08'] }
    })
    expect(real.stats.streakDays).toBe(5)
  })

  it('stats 整节不在（或不是对象）时给一份全 0 的，不崩', () => {
    for (const bad of [undefined, null, 'nope', []]) {
      expect(silent({ learned: ['a'], stats: bad }).stats).toEqual({
        learnedCount: 1,
        practicedCount: 0,
        streakDays: 0
      })
    }
  })
})

// ---------------------------------------------------------------- 版本

describe('版本号', () => {
  it('产物**永远**是当前版本号（哪怕输入是 v1 或压根没写）', () => {
    // 不这么写的话迁完还是老版本号，下次读又得再迁一遍 ——
    // 而且磁盘上那份永远看起来像「没迁过」。
    // 这里**故意不写 `toBe(2)`**：它和上一行验的是同一个表达式，一点判别力都不加，
    // 却会在每次 bump 时变成一个和现实不符、又没人会注意的假货
    for (const raw of [v1Archive(), {}, { version: 1 }, { version: undefined }, { version: 'x' }]) {
      expect(migrateProfile(raw).version).toBe(CURRENT_PROFILE_VERSION)
    }
  })

  it('版本**比当前还新**时照常搬运，认识的字段全留住', () => {
    // 用户装过更新版本又装回旧版。另一种做法（整份拒绝、退回默认）
    // 会把他**全部**进度清掉，比丢掉几个未来字段严重得多
    const out = silent({ ...v1Archive(), version: 99 })
    expect(out.learned).toEqual(['common-01', 'python-03'])
    expect(out.version).toBe(CURRENT_PROFILE_VERSION)
  })
})

// ---------------------------------------------------------------- 坏数据

describe('坏条目：丢掉、好的留下，并且**出声**', () => {
  it('learned 里的非字符串/空串被丢，其余留下；并且 warn 一次', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const out = migrateProfile({ learned: ['a', 42, '', null, 'b'] })
      expect(out.learned).toEqual(['a', 'b'])
      // 「档案里少了几条」这件事不该等到用户自己发现
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('重复的课号被去掉（它是集合，重复项会让派生计数虚高）', () => {
    const out = silent({ learned: ['a', 'b', 'a'], stats: {} })
    expect(out.learned).toEqual(['a', 'b'])
    expect(out.stats.learnedCount).toBe(2)
  })

  it('history 里缺字段的记录被丢，完整的那条留下', () => {
    const out = silent({
      history: [
        { lessonId: 'a', finishedAt: 't1' },
        { lessonId: 'b' },
        { finishedAt: 't2' },
        { lessonId: '', finishedAt: 't3' },
        null,
        'nope',
        { lessonId: 'c', finishedAt: 't4', extra: 'ignored' }
      ]
    })
    // 「逐字段搬运」：多余的字段不带进来
    expect(out.history).toEqual([
      { lessonId: 'a', finishedAt: 't1' },
      { lessonId: 'c', finishedAt: 't4' }
    ])
  })

  it('成功路径**不出声**（别把正常情况也喊成异常）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      migrateProfile(current())
      migrateProfile(v1Archive())
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('输入整份坏掉时：给默认档案，但**必须出声**', () => {
  it('null / 数字 / 字符串 / 数组 → 默认档案 + 每次都 warn', () => {
    // 静默重建是铁律明令禁止的：不然用户报「我的进度全没了」时，
    // 日志里一个字都没有
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (const raw of [null, undefined, 42, 'nope', []]) {
        expect(migrateProfile(raw)).toEqual(DEFAULT_PROFILE)
      }
      expect(warn).toHaveBeenCalledTimes(5)
    } finally {
      warn.mockRestore()
    }
  })

  it('返回的是**深拷贝**：改产物不会污染 DEFAULT_PROFILE', () => {
    // `DEFAULT_PROFILE` 是模块级单例，全进程共用一份（渲染层的 INITIAL 也由它克隆）。
    // 不克隆的话，任何一次「拿到默认档案之后顺手改一改」都会**永久改掉默认值** ——
    // 而且那个改动会跟着流进之后每一个新装的用户
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const out = migrateProfile(null)
      out.learned.push('MUTATED')
      out.rewards.gallery.push('MUTATED')
      out.checkin.days.push('2026-10-08')
      expect(DEFAULT_PROFILE.learned).toEqual([])
      expect(DEFAULT_PROFILE.rewards.gallery).toEqual([])
      expect(DEFAULT_PROFILE.checkin.days).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })
})

// ---------------------------------------------------------------- 幂等

describe('幂等：迁过的档案再迁一次**什么都不变**', () => {
  it('migrate(migrate(x)) === migrate(x)', () => {
    // 这条守的是「主进程每次读档案都会跑一遍迁移」这个事实。
    // 不幂等的话，用户每重启一次应用，某些值就漂移一点 ——
    // 漂移是单向累积的，几天后档案就面目全非了
    const once = migrateProfile(v1Archive())
    expect(migrateProfile(once)).toEqual(once)
  })

  it('已经是对的了的一份档案，迁完还是它自己', () => {
    const profile = current()
    expect(migrateProfile(profile)).toEqual(profile)
  })
})

// ---------------------------------------------------------------- applyCheckin
//  主进程 `checkin:submit` 的纯函数核心：闸门、streak、截断全在这儿。

describe('applyCheckin：发饭闸门是 `days`，不是 lastDate（C9）', () => {
  const empty = (): CheckinState => ({ lastDate: null, streakDays: 0, totalDays: 0, days: [] })

  it('第一次签到：awarded=true，streak=1，总量 1 —— 且**不算断签**（没有"断"可言）', () => {
    const { checkin, awarded, streakReset } = applyCheckin(empty(), '2026-10-08')
    expect(awarded).toBe(true)
    expect(streakReset).toBe(false)
    expect(checkin).toEqual({
      lastDate: '2026-10-08',
      streakDays: 1,
      totalDays: 1,
      days: ['2026-10-08']
    })
  })

  it('★ 幂等：这一天已在 days 里 → awarded=false，且返回的是**原对象**（一个字节没动）', () => {
    // 引用相等（toBe）不是苛刻：主进程靠 awarded 决定"写不写档、发不发饭"，
    // 内容相等的新对象也能让闸门看起来对，但"没签成"这条路必须真的是 no-op
    const cur: CheckinState = {
      lastDate: '2026-10-08',
      streakDays: 1,
      totalDays: 1,
      days: ['2026-10-08']
    }
    const res = applyCheckin(cur, '2026-10-08')
    expect(res.awarded).toBe(false)
    expect(res.checkin).toBe(cur)
    // 幂等重放里"断没断签"不该有结论：什么都没发生（空转[2] 的播报据此闭嘴）
    expect(res.streakReset).toBe(false)
  })

  it('★ 时钟回拨→前拨：同一个日键**不会**领到第二份饭', () => {
    // 只看 lastDate 的闸门在这个时序下会重复发饭：回拨补签会把它写旧，
    // 前拨回"真实今天"时 lastDate ≠ today，"判过了"就失效。
    // days 闸门不吃这一套 —— 这就是拍板把闸门定成 days.includes 的原因
    const cur: CheckinState = {
      lastDate: '2026-10-08',
      streakDays: 4,
      totalDays: 4,
      days: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']
    }
    // 回拨到已签的 10-07：在 days 里 → 不发
    expect(applyCheckin(cur, '2026-10-07').awarded).toBe(false)
    // 回拨到没签过的 10-05... 它也在 days 里（上面那份就是），换一个没签的 10-01
    const back = applyCheckin(cur, '2026-10-01')
    expect(back.awarded).toBe(true) // 它确实没签过，算补签
    expect(back.checkin.streakDays).toBe(1) // 断签 4 天 → streak 清零重来
    expect(back.streakReset).toBe(true) // 补签也把链断了：播报同样要说（空转[2]）
    expect(back.checkin.lastDate).toBe('2026-10-08') // 最新签到日不被一次回拨改写
    // 前拨回真实的 10-08：days 里已有 → 不重复发
    expect(applyCheckin(back.checkin, '2026-10-08').awarded).toBe(false)
  })

  it('跨月连签：1/31 → 2/1 接上（日期算术走 Date 构造器，不用毫秒加减）', () => {
    const cur: CheckinState = {
      lastDate: '2026-01-31',
      streakDays: 1,
      totalDays: 1,
      days: ['2026-01-31']
    }
    const { checkin, awarded, streakReset } = applyCheckin(cur, '2026-02-01')
    expect(awarded).toBe(true)
    // 接上了：这次不是断签（空转[2] 的播报靠它决定说不说"重新数起"）
    expect(streakReset).toBe(false)
    expect(checkin.streakDays).toBe(2)
    expect(checkin.days).toEqual(['2026-01-31', '2026-02-01'])
  })

  it('断签：隔了一天没签 → streak 清零重来，total 从不后退，且**如实报 streakReset**', () => {
    const cur: CheckinState = {
      lastDate: '2026-01-30',
      streakDays: 6,
      totalDays: 10,
      days: ['2026-01-29', '2026-01-30']
    }
    const { checkin, streakReset } = applyCheckin(cur, '2026-02-01')
    expect(checkin.streakDays).toBe(1)
    expect(checkin.totalDays).toBe(11)
    // 空转[2]：这一签把 6 天的链断了 —— 界面播报必须带这句（复核实测曾全程无人提）
    expect(streakReset).toBe(true)
  })

  it('非法日键：awarded=false、原样返回（没证据的路上不许发饭）', () => {
    const cur = empty()
    for (const bad of ['2026-2-3', '2026-02-30', 'x', '', '2026-10-08T00:00:00Z']) {
      const res = applyCheckin(cur, bad)
      expect(res.awarded, bad).toBe(false)
      expect(res.checkin, bad).toBe(cur)
      expect(res.streakReset, bad).toBe(false) // 没签成，就没有"断没断"可说
    }
  })

  it('★ 366 上限：明细满了又回拨补签 —— 刚签的这天**必须留在 days 里**', () => {
    // 闸门就是 days：刚签的日键被截掉的话，同一个日键还能再领一次饭。
    // 所以截头要留一个口子：踢掉最老的、把新签的放进去
    const base = '2026-10-08'
    const days = Array.from({ length: CHECKIN_DAYS_MAX }, (_, i) => shiftDateKey(base, -i)!)
    const cur: CheckinState = { lastDate: base, streakDays: 3, totalDays: 400, days }
    const { checkin, awarded } = applyCheckin(cur, '2020-01-01')
    expect(awarded).toBe(true)
    expect(checkin.days.length).toBe(CHECKIN_DAYS_MAX) // 容量没破
    expect(checkin.days).toContain('2020-01-01') // 刚签的没被挤掉
    // 被挤掉的是**最老的那条**（容量规则照旧：截头）
    expect(checkin.days).not.toContain(shiftDateKey(base, -(CHECKIN_DAYS_MAX - 1)))
    // 同一日键再签 → 不再发（闸门真的还在）
    expect(applyCheckin(checkin, '2020-01-01').awarded).toBe(false)
  })

  it('产物与 cleanCheckin 的规范形对齐（在线签到和读档清洗产出同一条 lastDate 规则）', () => {
    // 两条路若不一致，「签完 → 重启读档」就会发生 lastDate 漂移，
    // 每次启动都漂一次的样子是"签到功能自己会改写数据"
    const cur: CheckinState = {
      lastDate: '2026-10-09',
      streakDays: 2,
      totalDays: 2,
      days: ['2026-10-08', '2026-10-09']
    }
    const signed = applyCheckin(cur, '2026-10-05') // 回拨补签 —— lastDate 处理最容易漂的一条路
    expect(signed.awarded).toBe(true)
    const cleaned = silent({ checkin: signed.checkin })
    expect(cleaned.checkin).toEqual(signed.checkin)
  })
})

// ---------------------------------------------------------------- v4：时间戳与墓碑

describe('v4：learnedAt / favoriteAt 与墓碑区', () => {
  it('★ 老档案回填 **epoch0**，绝不伪造 now（伪造的会永久吞掉别的设备发来的取消）', () => {
    // 时间戳是给合并裁决用的（条目 vs 墓碑，新者胜）。升级时盖一个 now，
    // 等于宣布「这些条目是刚刚标记的」—— 之后任何一条真实墓碑都赢不过它，
    // 用户在别的设备上的取消会被静默吞掉。epoch0 只输不赢，方向才安全
    const out = silent(v1Archive())
    expect(out.learnedAt).toEqual({ 'common-01': EPOCH0_ISO, 'python-03': EPOCH0_ISO })
    expect(out.favoriteAt).toEqual({ 'common-01': EPOCH0_ISO })
  })

  it('已有的合法时间戳原样保留 —— 包括**已不在 learned 里**的条目（那是"移除过"的证据）', () => {
    // 有表、没条目的 id 一个都不许丢：合并要拿它和别的设备的墓碑比时间
    const out = silent({
      learned: ['a'],
      favorites: [],
      learnedAt: { a: '2026-05-01T00:00:00.000Z', gone: '2026-04-01T00:00:00.000Z' }
    })
    expect(out.learnedAt).toEqual({ a: '2026-05-01T00:00:00.000Z', gone: '2026-04-01T00:00:00.000Z' })
  })

  it('时间戳值坏了 → 按缺失回填 epoch0（坏值不冒充时间），并且出声', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const out = migrateProfile({
        learned: ['a'],
        learnedAt: { a: 42, b: '2026-01-01T00:00:00.000Z' }
      })
      expect(out.learnedAt).toEqual({ a: EPOCH0_ISO, b: '2026-01-01T00:00:00.000Z' })
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('tombstones 缺失 / 坏形状 → 两张空表（绝不 undefined —— 它一进合并比较就抛）', () => {
    for (const raw of [v1Archive(), { tombstones: null }, { tombstones: [] }, { tombstones: 'x' }]) {
      const out = silent(raw)
      expect(out.tombstones).toEqual({ learned: {}, lessonFavorites: {} })
    }
  })

  it('墓碑条目原样保留；**读口不做冲突裁决**（learned 与墓碑并存时两个都留）', () => {
    // 「又存在又有墓碑」的坏对由**写口**在下次保存时修（profile-apply 有专门用例）。
    // 迁移阶段（读口）替用户裁决的两个方向都危险：删条目=静默清进度，
    // 删墓碑=复活一条已经取消的记录。搬它原样，让合并去按时间戳判
    const out = silent({
      learned: ['a'],
      tombstones: {
        learned: { a: '2026-06-01T00:00:00.000Z', b: 7, '': 'x' },
        lessonFavorites: { c: '2026-06-02T00:00:00.000Z' }
      }
    })
    expect(out.learned).toContain('a')
    expect(out.tombstones.learned).toEqual({ a: '2026-06-01T00:00:00.000Z' })
    expect(out.tombstones.lessonFavorites).toEqual({ c: '2026-06-02T00:00:00.000Z' })
  })

  it('v4 迁移幂等：第二遍一个字节都不改（回填不会二次漂移）', () => {
    const once = silent(v2Archive())
    expect(silent(once)).toEqual(once)
    const withV4 = silent({
      learned: ['a'],
      learnedAt: { a: '2026-05-01T00:00:00.000Z' },
      favoriteAt: { a: '2026-05-02T00:00:00.000Z' },
      tombstones: { learned: { b: '2026-05-03T00:00:00.000Z' }, lessonFavorites: {} }
    })
    expect(silent(withV4)).toEqual(withV4)
  })
})
