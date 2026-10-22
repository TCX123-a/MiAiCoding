import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { DAILY_SCORE_MAX, LANGS, LEADERBOARD_PERIODS } from '../../../../shared/cloud/protocol'
import { maskComments } from '../../../../shared/__tests__/mask-comments'
import { LEADERBOARD } from '../copy'

/**
 * 排行榜页签契约 + 占位数据的格式闸门
 * （⑤ 十项升级 2026-10-08 建；UI 大修轮 2026-10-09 扩为五页签；
 * 2026-10-10 加语言列 + 规则面板接线检查）。
 *
 * 【页签契约（本轮定稿）】
 *   UI 页签键 = 本地 UI 数组 [daily, weekly, monthly, yearly, alltime]，
 *   顺序即 LeaderboardView 的呈现顺序（日 → 周 → 月 → 年 → 总）；
 *   2026-10-10 起协议 LEADERBOARD_PERIODS 也已是这五键（monthly/yearly
 *   在服务端补齐，不再是「纯前端演示页签」），契约仍按「UI ⊇ 协议」守
 *   —— 协议再加键时这里必须先红，逼着 UI 跟上。
 *   顺序的真源是视图里的 `UI_TAB_KEYS` 字面量，所以这里从 .vue 源码里
 *   **抠出来比对**：只断言 copy.ts 的话，视图自己把顺序改了也照样绿 ——
 *   那这条契约就是假的。
 *
 * 【为什么占位数据也要测】它将来会被**换成真榜数据**，现在摆的形状就是
 * 表格的结构合同。四条合同，一条都不能松：
 *   ① 五件套字段名 = 服务端 entrySchema（server/src/routes/leaderboard.ts）
 *      的 rank / username / langs / score / days —— 接真榜时只换数据源不换表格；
 *   ② 名次按服务端 rank() 口径（并列同名次、下一名跳号）——这里是**重算**
 *      后逐行比对，不是把 123456 抄一遍；
 *   ③ 五期页签全覆盖、每期 6 行（少一期这页就少一个页签 / 空一张表）；
 *   ④ langs 的取值域与顺序 = 协议 LANGS 去 common（服务端快照同口径）；
 *   ⑤ 分数在 v3 计分制下**说得通**：服务端 score = 窗口内每日积分之和、
 *      days = 有分的天数，单日 ≤ DAILY_SCORE_MAX。2026-10-10 挑战 v3：
 *      单题分只由难度决定（100/150/200/250）、单日上限 = 5000 × 250 =
 *      1,250,000，演示数据同批重算为新量级。
 *      这条守住粗边界（上限 × 天数、周期嵌套）+ 一条**可机器验的面值
 *      约束**：单题分全是 50 的倍数 ⇒ 由真实作答攒出来的任何聚合分必是
 *      50 的倍数，不是 50 倍数的 score 就是手编的失实数（4180 类），
 *      当场见红。分数「能不能由某套题目面值精确凑出来」的全量校验仍
 *      不做 —— 演示数据的这一层不值当，别把它读成保证。
 */

/** UI 页签键：契约值逐字照抄（不从 copy.ts 反推 —— 反推会让「少了 monthly」也自洽） */
const UI_TAB_KEYS = ['daily', 'weekly', 'monthly', 'yearly', 'alltime'] as const

/**
 * LeaderboardView.vue 源码（剥注释后）。剥注释是老规矩（mask-comments 头注释）：
 * 注释里为讲清规则常写字面量样例，不剥的话闸门会被自己的说明文字绊倒。
 */
const VIEW_SRC = maskComments(
  readFileSync(join(__dirname, '..', '..', 'views', 'LeaderboardView.vue'), 'utf8')
)

/** 从视图源码里抠 `const UI_TAB_KEYS = [...] as const` 的键；抠不到返回 null */
function viewTabKeys(): string[] | null {
  const m = VIEW_SRC.match(/const UI_TAB_KEYS\s*=\s*\[([^\]]*)\]\s*as const/)
  if (!m) return null
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter((s) => s.length > 0)
}

describe('页签契约：UI 五键 = [日,周,月,年,总]，且 ⊇ 协议键', () => {
  it('LeaderboardView.vue 的本地页签数组 = [daily, weekly, monthly, yearly, alltime]', () => {
    const keys = viewTabKeys()
    // 抠不到字面量（改名/改写法）= 红，不是静默跳过 —— 覆盖面缺口必须响
    expect(keys, '没在 LeaderboardView.vue 里找到 `const UI_TAB_KEYS = [...] as const` 字面量').not.toBeNull()
    expect(keys).toEqual([...UI_TAB_KEYS])
  })

  it('copy.ts 的 TABS 键 = UI 数组（含顺序 —— 视图按键取标签，顺序错 = 页签排错）', () => {
    expect(Object.keys(LEADERBOARD.TABS)).toEqual([...UI_TAB_KEYS])
  })

  it('⊇ 协议键：一个都不能少（协议 2026-10-10 起同为五键，缺一个就红）', () => {
    for (const p of LEADERBOARD_PERIODS) {
      expect([...UI_TAB_KEYS], `协议期 ${p} 不在 UI 页签里`).toContain(p)
    }
  })

  it('演示数据与刷新字幕的键集 = UI 五键（视图按键直取，缺键页面上就是 undefined）', () => {
    expect(Object.keys(LEADERBOARD.DEMO_ROWS).sort()).toEqual([...UI_TAB_KEYS].sort())
    expect(Object.keys(LEADERBOARD.REFRESH_TIP)).toEqual([...UI_TAB_KEYS])
  })

  it('刷新字幕随页签变：五条非空且两两不同，视图真的消费 REFRESH_TIP', () => {
    const tips = UI_TAB_KEYS.map((k) => LEADERBOARD.REFRESH_TIP[k])
    for (const t of tips) expect(t.length).toBeGreaterThan(0)
    // 两条一样 = 切页签时字幕纹丝不动，等于没做「随 tab 变化」
    expect(new Set(tips).size).toBe(UI_TAB_KEYS.length)
    // 接线检查（同 wall-glass 里 main.ts 那条的先例）：文案在 copy.ts 里睡着
    // 不算数，视图得真把它渲染出来
    expect(VIEW_SRC).toContain('LEADERBOARD.REFRESH_TIP')
  })

  it('每期 6 行演示数据（空一期页面上就是一张空表）', () => {
    for (const k of UI_TAB_KEYS) {
      expect(LEADERBOARD.DEMO_ROWS[k].length, `${k} 的行数`).toBe(6)
    }
  })
})

describe('LEADERBOARD 占位数据：与服务器 entrySchema 逐字段对齐', () => {
  const ALL = UI_TAB_KEYS.flatMap((p) =>
    LEADERBOARD.DEMO_ROWS[p].map((row) => ({ period: p, row }))
  )

  it('每行恰好五个字段：rank / username / langs / score / days（多一个少一个都红）', () => {
    for (const { period, row } of ALL) {
      expect(Object.keys(row).sort(), `${period} 的某行`).toEqual([
        'days',
        'langs',
        'rank',
        'score',
        'username'
      ])
    }
  })

  it('langs 取值域 = 协议 LANGS 去 common，无重复、按声明序（与服务端快照同口径）', () => {
    // 声明序：C → C++ → Java → Python（协议 LANGS 的顺序去掉 common）
    const order: readonly string[] = LANGS.filter((l) => l !== 'common')
    for (const { period, row } of ALL) {
      const ls: readonly string[] = row.langs
      expect(Array.isArray(ls), `${period}/${row.username} langs 是数组`).toBe(true)
      for (const l of ls) {
        expect(order, `${period}/${row.username} 的 langs 含未知语言 ${l}`).toContain(l)
      }
      expect(new Set(ls).size, `${period}/${row.username} langs 有重复`).toBe(ls.length)
      // 按声明序过滤一遍后逐位相等 = 本来就按声明序排
      expect([...ls], `${period}/${row.username} langs 未按声明序`).toEqual(
        order.filter((l) => ls.includes(l))
      )
    }
  })

  it('语言列与规则面板真的接在视图上（文案在 copy.ts 里睡着不算数）', () => {
    // 同 REFRESH_TIP 那条接线检查的先例：这里守的是「视图真消费了这几组键」
    expect(VIEW_SRC).toContain('LEADERBOARD.COL_LANGS')
    expect(VIEW_SRC).toContain('LANG_LABEL')
    expect(VIEW_SRC).toContain('LEADERBOARD.RULES_TITLE')
    expect(VIEW_SRC).toContain('LEADERBOARD.RULES_CLOSE')
  })

  it('字段类型与值域：整数、正分、天数 ≥1、名字非空', () => {
    for (const { period, row } of ALL) {
      expect(Number.isInteger(row.rank), `${period}/${row.username} rank`).toBe(true)
      expect(Number.isInteger(row.score), `${period}/${row.username} score`).toBe(true)
      expect(Number.isInteger(row.days), `${period}/${row.username} days`).toBe(true)
      expect(row.score, `${period}/${row.username} score`).toBeGreaterThan(0)
      expect(row.days, `${period}/${row.username} days`).toBeGreaterThanOrEqual(1)
      expect(row.username.length, `${period}/${row.username} 名字`).toBeGreaterThan(0)
    }
  })

  it('所有 score 都是 50 的倍数（v3 单题分 100/150/200/250 全含 50 ⇒ 聚合分不可能落在余数上）', () => {
    // 「4180 类失实值」的机器守卫：真实分数 = 若干单题分的整数和，
    // 而每个单题分都是 50 的倍数 —— 不是 50 倍数的值直接红
    for (const { period, row } of ALL) {
      expect(row.score % 50, `${period}/${row.username} 的 score=${row.score} 不是 50 的倍数`).toBe(0)
    }
  })

  it('积分量级在加权制下说得通：单日上限 × 天数，且周期嵌套只增不减', () => {
    // ① 每日积分有硬上限（5000 题 × 满档 250 = 1,250,000）：score ≤ DAILY_SCORE_MAX × days。
    //    「日榜 9000」「总榜比年榜还小」这类越界数在这里红
    for (const { period, row } of ALL) {
      expect(
        row.score,
        `${period}/${row.username} 的分超过「单日上限 × 天数」= ${DAILY_SCORE_MAX * row.days}`
      ).toBeLessThanOrEqual(DAILY_SCORE_MAX * row.days)
    }
    // ② 周期嵌套（窗口小的 ⊂ 窗口大的 → 分数与天数只增不减）：
    //    日⊆周、日⊆月、月⊆年、年⊆总。**周→月不查** —— ISO 周可以跨月，
    //    周榜 ≠ 月榜的子集，把它写成合同是假合同
    const NESTED = [
      ['daily', 'weekly'],
      ['daily', 'monthly'],
      ['monthly', 'yearly'],
      ['yearly', 'alltime']
    ] as const
    for (const [small, big] of NESTED) {
      const smallByUser = new Map(LEADERBOARD.DEMO_ROWS[small].map((r) => [r.username, r]))
      for (const row of LEADERBOARD.DEMO_ROWS[big]) {
        const s = smallByUser.get(row.username)
        expect(s, `${small} 榜里没有 ${row.username}（两份演示名单必须同班人马）`).toBeDefined()
        expect(
          row.score,
          `${row.username}：${small} ${s!.score} > ${big} ${row.score}（窗口大的反而少）`
        ).toBeGreaterThanOrEqual(s!.score)
        expect(
          row.days,
          `${row.username}：${small} 天数 ${s!.days} > ${big} 天数 ${row.days}`
        ).toBeGreaterThanOrEqual(s!.days)
      }
    }
  })

  it('名次与服务端 rank() 口径一致：重算 = 1 + 比它分高的人数（并列同名次、跳号）', () => {
    for (const p of UI_TAB_KEYS) {
      const rows = LEADERBOARD.DEMO_ROWS[p]
      const scores = rows.map((r) => r.score)
      rows.forEach((row, i) => {
        const recomputed = 1 + scores.filter((s) => s > row.score).length
        expect(row.rank, `${p} 第 ${i + 1} 行（${row.username}）的名次`).toBe(recomputed)
      })
    }
  })

  it('行序就是榜序：分数不升（服务端 ORDER BY score DESC）', () => {
    for (const p of UI_TAB_KEYS) {
      const scores = LEADERBOARD.DEMO_ROWS[p].map((r) => r.score)
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i], `${p} 第 ${i + 1} 行`).toBeLessThanOrEqual(scores[i - 1])
      }
      expect(scores[0]).toBeGreaterThan(0)
    }
  })

  it('演示行必须一眼可辨是假的：名字都带「示例」前缀', () => {
    for (const { period, row } of ALL) {
      expect(row.username.startsWith('示例'), `${period}/${row.username}`).toBe(true)
    }
  })
})

/**
 * P10.6（2026-10-11）：真榜接线检查。
 * ④ 之前这一页只有演示行；这批把「数据路径 + 三态文案 + 名次卡 + opt-in」
 * 全接上。检查口径同前面几条接线检查：文案在 copy.ts 里睡着不算数、
 * store 建了不调也不算数 —— 视图源码里得真出现这些消费点。
 * 数据路径按**带括号的调用形**断言（`useLeaderboardStore()` 而不是裸名字）：
 * 只 import 不调用也会命中裸名字，那就是假绿。
 */
describe('P10.6 真榜接线（2026-10-11）', () => {
  it('数据路径真接了：两个 store 被调用，load / loadMore / setOptIn 三动作在视图里', () => {
    expect(VIEW_SRC).toContain('useLeaderboardStore()')
    expect(VIEW_SRC).toContain('useAccountStore()')
    expect(VIEW_SRC).toContain('board.load(')
    expect(VIEW_SRC).toContain('board.loadMore(')
    expect(VIEW_SRC).toContain('board.setOptIn(')
  })

  it('三态 + 两空的文案全被消费（默认回退为有数据 = 这页的撒谎）', () => {
    for (const key of ['LOADING', 'FAIL_NONE', 'FAIL_KEEP', 'BTN_MORE', 'BTN_GO_CHALLENGE']) {
      expect(VIEW_SRC, `视图没消费 LEADERBOARD.${key}`).toContain(`LEADERBOARD.${key}`)
    }
    // V1-54：两套「空表」文案走 EMPTY 组（MiEmpty 的规矩：有文案就有图）
    expect(VIEW_SRC, '视图没消费 EMPTY.LEADERBOARD_NO_SNAPSHOT').toContain(
      'EMPTY.LEADERBOARD_NO_SNAPSHOT'
    )
    expect(VIEW_SRC, '视图没消费 EMPTY.LEADERBOARD_NOBODY').toContain('EMPTY.LEADERBOARD_NOBODY')
  })

  it('V2-10：排行榜的「再试一次」不许回来（主人裁定「完全应该删了」）', () => {
    // 两条腿都钉：文案键没了、视图里没有消费点。只钉一边的话，
    // 「把按钮改回来但换个键名复用 FAIL_NONE」这类半回滚会悄悄过关。
    // 删它的理由（写回 copy.ts 的注释里）：点下去按钮不转、说明行不变，
    // 看不出重试有没有发生 —— 比没有按钮更伤信任。
    expect(Object.keys(LEADERBOARD)).not.toContain('BTN_RETRY')
    expect(VIEW_SRC).not.toContain('BTN_RETRY')
  })

  it('名次卡与榜期键被消费（含 opt-in 三件套与演示横幅）', () => {
    // ME_OPTIN 那条带收尾引号：不带的话 ME_OPTIN_NOTE / ME_OPTIN_FAIL 会把它
    // 子串命中 —— 开关主体没接上也照样绿
    for (const token of [
      'LEADERBOARD.ME_RANK',
      'LEADERBOARD.ME_UNRANKED',
      'LEADERBOARD.ME_TODAY',
      'LEADERBOARD.ME_OPTIN"',
      'LEADERBOARD.ME_OPTIN_NOTE',
      'LEADERBOARD.ME_OPTIN_FAIL',
      'LEADERBOARD.PERIOD_KEY',
      'LEADERBOARD.DEMO_BANNER'
    ]) {
      expect(VIEW_SRC, `视图没消费 ${token}`).toContain(token)
    }
  })
})
