/**
 * 云端协议真源（src/shared/cloud/protocol.ts）的**等价闸门**。
 *
 * 【为什么需要这个文件】protocol.ts 不能 import 项目里既有的真源（它要能被
 * 三个运行环境直接加载、还要逐字节复制给服务端），所以每种数值都是"抄"的一
 * 份。这个测试把"抄得对不对"变成机器可判——四个方向：
 *   ① 与 shared/difficulty.ts 的默认难度规则做 (题型 × 阶段) 全矩阵对拍；
 *   ② 与 shared/pet.ts 的饭碗常量逐项对拍（含 feedPet/grantPetRice/
 *      grantRunReward 的**真实过账行为**，不是只比数字）；
 *   ③ 复现 docs/26 §5.5 的带数字算例（550/700）——公式与权重一起钉死；
 *      并守卫批长上界：单局挑战的本地段封顶 + 挑战 AI 段 ≤ CHALLENGE_RUN_MAX
 *      （2026-10-21 起题库总量可以超过单局上界，靠抽题时封顶保证协议安全）；
 *   ④ 与 server/src/protocol.ts 逐字节相等（协议同步闸门的客户端一侧）。
 *
 * 【每个比较器都带种坏自检】坏样本必须被**同一条比较器**抓出来，否则比较器
 * 恒真，绿了也不算证据（memory: miai-false-positive-rule）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import * as P from '../cloud/protocol'
import { DIFFICULTIES as CLIENT_DIFFICULTIES, resolveDifficulty } from '../difficulty'
import { CHALLENGE_AI_BLOCK, CHALLENGE_LOCAL_CAP } from '../challenge'
import { MAX_AI_QUESTIONS } from '../ai-question'
import {
  PET_CHASE_COST,
  PET_CHAT_COST,
  PET_RICE_DAILY_CAPS,
  PET_RICE_MAX,
  PET_REWARD_RICE,
  PET_RUN_REWARD_DAILY_MAX,
  PET_RUN_REWARD_RICE,
  RUN_FP_RE,
  defaultPetState,
  exertPet,
  feedPet,
  grantPetRice,
  grantRunReward,
  type PetState
} from '../pet'
import type { Question, Stage } from '../types'

const ISO = '2026-10-08T00:00:00.000Z'

// ---------------------------------------------------------------- ① 难度规则矩阵

const STAGES = [0, 1, 2, 3] as const

function matrixMismatches(f: (type: P.QuestionType, stage: number) => P.Difficulty): string[] {
  const bad: string[] = []
  for (const t of P.QUESTION_TYPES) {
    for (const s of STAGES) {
      const expected = resolveDifficulty({ type: t } as Question, s as Stage)
      if (f(t, s) !== expected) bad.push(`${t}@stage${s}: ${f(t, s)} != ${expected}`)
    }
  }
  return bad
}

// ---------------------------------------------------------------- 全库题量（内容侧）

/** content/ 根。common 课目录是一层；c/cpp/java/python 各多一层 stageN/ */
const CONTENT_DIR = new URL('../../../content/', import.meta.url)

/** 递归列出 content/ 下全部 .json（子目录要带尾斜杠再进 new URL，才解析成它下面） */
function contentJsonFiles(dir: URL): URL[] {
  const out: URL[] = []
  for (const name of readdirSync(dir)) {
    const child = new URL(name, dir)
    if (statSync(child).isDirectory()) out.push(...contentJsonFiles(new URL(`${name}/`, dir)))
    else if (name.endsWith('.json')) out.push(child)
  }
  return out
}

/**
 * 全库题量，两半分开数（数到哪半丢了能直接报出来）：
 *   · 课文 `questions.json` 的 `questions`
 *   · `challenge-bank/**` 的 `items`
 * 两半在 content-build 时才并成 Lesson.questions（scripts/content-build.mjs），
 * 也就是挑战一天的抽题池 —— 只数一类就漏掉半个库。
 */
function libraryQuestionCount(): { hand: number; bank: number } {
  const out = { hand: 0, bank: 0 }
  for (const f of contentJsonFiles(CONTENT_DIR)) {
    const j = JSON.parse(readFileSync(f, 'utf8')) as { questions?: unknown[]; items?: unknown[] }
    if (Array.isArray(j.questions)) out.hand += j.questions.length
    if (Array.isArray(j.items)) out.bank += j.items.length
  }
  return out
}

describe('难度默认规则：protocol.defaultDifficulty 与 shared/difficulty.ts 全矩阵等价', () => {
  it('6 题型 × 4 阶段 = 24 格全部一致', () => {
    expect(matrixMismatches(P.defaultDifficulty)).toEqual([])
  })

  it('种坏自检：把 codewrite 改成 medium 的坏副本必须被同一条比较器抓出', () => {
    const corrupted = (t: P.QuestionType, s: number): P.Difficulty =>
      t === 'codewrite' ? 'medium' : P.defaultDifficulty(t, s)
    expect(matrixMismatches(corrupted).length).toBeGreaterThan(0)
  })

  it('难度值域与客户端 DIFFICULTIES 同序同值', () => {
    expect([...P.DIFFICULTIES]).toEqual([...CLIENT_DIFFICULTIES])
  })

  it('批长上界：协议 CHALLENGE_RUN_MAX = 5000（健全性上界，不再是「每天最多 20 题」的产品规则）', () => {
    expect(P.CHALLENGE_RUN_MAX).toBe(5000)
  })

  it('内容扩容守卫：单局挑战（本地段封顶 + AI 段）≤ CHALLENGE_RUN_MAX', () => {
    const { hand, bank } = libraryQuestionCount()
    // 先证明两半都真扫到了 —— 一半静默丢了的话，下面那条 ≤ 就成了假绿
    expect(hand, '课文 questions.json 一题都没扫到（content/ 布局变了？）').toBeGreaterThan(1000)
    expect(bank, 'challenge-bank items 一题都没扫到（布局变了？）').toBeGreaterThan(1000)
    /*
     * 2026-10-21：题库总量已经超过 5000（课文 1754 + 题库 4271 = 6025）。
     * 协议上界不再靠「全库 ≤ 5000」保证，而是靠**抽题时的本地段封顶**：
     *   min(全库, CHALLENGE_LOCAL_CAP) + CHALLENGE_AI_BLOCK ≤ CHALLENGE_RUN_MAX
     * 真正验证「draw() 会不会照做」的是 stores/__tests__/challenge.test.ts 的
     * 「单局上界」用例；这里守的是常量推导本身不许漂。
     */
    expect(CHALLENGE_LOCAL_CAP).toBe(P.CHALLENGE_RUN_MAX - CHALLENGE_AI_BLOCK)
    expect(Math.min(hand + bank, CHALLENGE_LOCAL_CAP) + CHALLENGE_AI_BLOCK).toBeLessThanOrEqual(
      P.CHALLENGE_RUN_MAX
    )
  })

  it('挑战 AI 段恒 20 道，且不超过 AI 解析层上限 MAX_AI_QUESTIONS', () => {
    expect(CHALLENGE_AI_BLOCK).toBe(20)
    expect(CHALLENGE_AI_BLOCK).toBeLessThanOrEqual(MAX_AI_QUESTIONS)
  })
})

// ---------------------------------------------------------------- ② 大白饭常量

/**
 * 把协议里的 delta 表与 pet.ts 常量逐项对拍（返回全部不一致项）。
 *
 * 【2026-10-10 夜更正】chase/chat 不再对拍 -PET_CHASE_COST/-PET_CHAT_COST ——
 * 那两条"等价"拿**饱食度常量**当饭流水依据，等于把 bug 写成规矩（§6.2 表同错）。
 * 事实：chase/chat 的实现是 exertPet，只扣饱食度、不产生饭流水；协议里这两行
 * 是冻结白名单值（服务端宽容收），**v1 客户端从不上行**。下面有反向对拍钉死
 * "exertPet 绝不碰 rice"。
 */
function riceMismatches(tbl: Record<string, number>): string[] {
  const bad: string[] = []
  const check = (kind: string, expected: number): void => {
    if (tbl[kind] !== expected) bad.push(`${kind}: ${String(tbl[kind])} != ${expected}`)
  }
  check('adopt', 0) // 来源标记恒 0（不携带余额，见 §6.1）
  check('lesson', PET_REWARD_RICE.lesson)
  check('review', PET_REWARD_RICE.review)
  check('answer', PET_REWARD_RICE.answer)
  check('run', PET_RUN_REWARD_RICE)
  check('feed', -1) // 喂饭固定 -1（feedPet 真实过账行为下面另有对拍）
  check('checkin', PET_REWARD_RICE.checkin)
  return bad
}

describe('大白饭：protocol 数值与 shared/pet.ts 逐项等价', () => {
  it('delta 白名单 7 个有客户端依据的 kind 全部对齐（含 checkin）', () => {
    expect(riceMismatches(P.RICE_DELTA_BY_KIND)).toEqual([])
  })

  it('种坏自检：lesson 改成 3 的坏副本必须被抓出', () => {
    expect(riceMismatches({ ...P.RICE_DELTA_BY_KIND, lesson: 3 }).length).toBe(1)
  })

  it('9 种 kind 每种都有 delta；8 种消费/收入均有日上限（adopt 除外）', () => {
    expect(P.RICE_LEDGER_KINDS.length).toBe(9)
    for (const kind of P.RICE_LEDGER_KINDS) {
      expect(typeof P.RICE_DELTA_BY_KIND[kind], kind).toBe('number')
      if (kind !== 'adopt') {
        expect(typeof P.RICE_DAILY_CAP_BY_KIND[kind], kind).toBe('number')
        expect(P.RICE_DAILY_CAP_BY_KIND[kind], kind).toBeGreaterThan(0)
      }
    }
  })

  it('余额上界与客户端 PET_RICE_MAX 同值（999）', () => {
    expect(P.RICE_MAX).toBe(PET_RICE_MAX)
  })

  it('日上限：run 抄客户端常量、checkin=1；chase/chat 是冻结值（不与任何客户端常量绑定）', () => {
    expect(P.RICE_DAILY_CAP_BY_KIND.run).toBe(PET_RUN_REWARD_DAILY_MAX)
    expect(P.RICE_DAILY_CAP_BY_KIND.checkin).toBe(1) // 签到每日一次
    // 冻结白名单值：数值被钉死，但 chase/chat 的真实客户端实现（exertPet）与"饭"无关，
    // PET_CHASE_COST/PET_CHAT_COST/PET_CHAT_DAILY_MAX 都是**饱食度**口径，不得再拿来对拍
    expect(P.RICE_DAILY_CAP_BY_KIND.chase).toBe(300)
    expect(P.RICE_DAILY_CAP_BY_KIND.chat).toBe(120)
  })

  it('过账行为对拍：feedPet 实际扣饭量 == RICE_DELTA_BY_KIND.feed', () => {
    const before = { ...defaultPetState(ISO), rice: 5, satiety: 10 }
    const r = feedPet(before)
    expect(r.ok).toBe(true)
    expect(r.state.rice - before.rice).toBe(P.RICE_DELTA_BY_KIND.feed)
    expect(r.state.rice - before.rice).toBe(-1)
  })

  it('过账行为对拍：grantPetRice 四种发放（学习奖三种 + 签到）实际加饭量 == 白名单', () => {
    for (const kind of ['lesson', 'review', 'answer', 'checkin'] as const) {
      const before = { ...defaultPetState(ISO), rice: 0 }
      const { state: after, gained } = grantPetRice(before, kind, ISO)
      expect(gained).toBe(P.RICE_DELTA_BY_KIND[kind])
      expect(after.rice - before.rice).toBe(P.RICE_DELTA_BY_KIND[kind])
      // V1-42 客户端日上限必须不高于账本白名单上限 —— 客户端先拦的前提是
      // 「拦下来的账本也不会拒」；哪天把客户端额度调到白名单之上，这里红
      expect(PET_RICE_DAILY_CAPS[kind]).toBeLessThanOrEqual(P.RICE_DAILY_CAP_BY_KIND[kind])
    }
  })

  it('反向对拍：exertPet（chase/chat 的真实实现）只扣饱食度、绝不碰 rice', () => {
    const before: PetState = { ...defaultPetState(ISO), rice: 5, satiety: 10 }
    for (const cost of [PET_CHASE_COST, PET_CHAT_COST]) {
      const after = exertPet(before, cost)
      expect(after.rice, `cost=${cost}`).toBe(before.rice)
      expect(after.satiety, `cost=${cost}`).toBe(before.satiety - cost)
    }
    // 种坏自检：一个"顺手扣饭"的坏实现必须被同一断言抓到（否则"不碰 rice"是假绿）
    const corrupt = (s: PetState, c: number): PetState => ({ ...exertPet(s, c), rice: s.rice - 1 })
    expect(corrupt(before, PET_CHAT_COST).rice).not.toBe(before.rice)
  })

  it('过账行为对拍：grantRunReward 实际加饭量 == RICE_DELTA_BY_KIND.run（含指纹去重闸）', () => {
    const before = { ...defaultPetState(ISO), rice: 0 }
    const g = grantRunReward(before, '1a2b:c0ffee', ISO)
    expect(g.granted).toBe(true)
    expect(g.state.rice - before.rice).toBe(P.RICE_DELTA_BY_KIND.run)
    // 同一指纹二次发奖被拒（不是靠数值，是靠行为）——阴性对照
    const again = grantRunReward(g.state, '1a2b:c0ffee', ISO)
    expect(again.granted).toBe(false)
    expect(again.state).toBe(g.state)
  })

  it('run 指纹正则与 pet.ts RUN_FP_RE 逐字符同源', () => {
    expect(P.RICE_RUN_FINGERPRINT_RE.source).toBe(RUN_FP_RE.source)
    for (const s of ['1a2b:c0ffee', 'zz:0', 'a:ffffffff']) {
      expect(P.RICE_RUN_FINGERPRINT_RE.test(s), s).toBe(true)
      expect(RUN_FP_RE.test(s), s).toBe(true)
    }
    for (const s of ['', ':00', 'ABC:00', '1:zz', 'toolongprefix123:00']) {
      expect(P.RICE_RUN_FINGERPRINT_RE.test(s), s).toBe(false)
      expect(RUN_FP_RE.test(s), s).toBe(false)
    }
  })
})

// ---------------------------------------------------------------- ③ docs/26 §5.5 算例

describe('计分公式：复现 docs/26 §5.5 的带数字算例（5 题对 4 = 550 / 满分 700）', () => {
  const BATCH = [
    { lang: 'common', type: 'choice', stage: 0, ok: true, docDifficulty: 'easy' },
    { lang: 'python', type: 'fill', stage: 1, ok: true, docDifficulty: 'easy' },
    { lang: 'c', type: 'code', stage: 1, ok: false, docDifficulty: 'medium' },
    { lang: 'cpp', type: 'codefill', stage: 2, ok: true, docDifficulty: 'medium' },
    { lang: 'java', type: 'codefix', stage: 3, ok: true, docDifficulty: 'hard' }
  ] as const

  it('每题的难度解析结果与 docs/26 §5.5 表列一致', () => {
    for (const row of BATCH) {
      const d = resolveDifficulty({ type: row.type } as Question, row.stage as Stage)
      expect(d, `${row.lang}/${row.type}`).toBe(row.docDifficulty)
    }
  })

  it('逐题得分与总和对齐文档：550 实得 / 700 满分', () => {
    let score = 0
    let max = 0
    const points: number[] = []
    for (const row of BATCH) {
      const d = resolveDifficulty({ type: row.type } as Question, row.stage as Stage)
      const p = P.weightedPoints(d, row.lang)
      points.push(row.ok ? p : 0)
      max += p
      if (row.ok) score += p
    }
    expect(points).toEqual([100, 100, 0, 150, 200])
    expect(score).toBe(550)
    expect(max).toBe(700)
  })

  it('单日上限与挑战档满分：250/题 × 5000 = 1,250,000', () => {
    expect(P.weightedPoints('challenge', 'cpp')).toBe(250)
    expect(P.DAILY_SCORE_MAX).toBe(1250000)
  })

  it('DAILY_SCORE_MAX 与 CHALLENGE_RUN_MAX 联动 —— 改任一个都必须见红', () => {
    expect(P.DAILY_SCORE_MAX).toBe(P.CHALLENGE_RUN_MAX * P.weightedPoints('challenge', 'cpp'))
  })
})

// ---------------------------------------------------------------- ④ 字节闸门

describe('协议真源字节闸门：src/shared/cloud/protocol.ts == server/src/protocol.ts', () => {
  const src = readFileSync(new URL('../cloud/protocol.ts', import.meta.url))
  const dst = readFileSync(new URL('../../../server/src/protocol.ts', import.meta.url))

  it('两份文件逐字节相等（改动真源后必须跑 npm run protocol:sync）', () => {
    expect(src.equals(dst)).toBe(true)
  })

  it('种坏自检：翻转一个字节后比较器必须报不等', () => {
    const flipped = Buffer.from(src)
    flipped[Math.floor(flipped.length / 2)]! ^= 0x01
    expect(src.equals(flipped)).toBe(false)
  })
})

// ---------------------------------------------------------------- 自洽小检查

describe('协议自洽：令牌 / entryKey / 日期键 / 能力位', () => {
  it('TOKEN_REGEX：ms1_ + 43 个 base64url 字符', () => {
    expect(P.TOKEN_REGEX.test(P.TOKEN_PREFIX + 'A'.repeat(43))).toBe(true)
    expect(P.TOKEN_REGEX.test(P.TOKEN_PREFIX + 'A'.repeat(42))).toBe(false)
    expect(P.TOKEN_REGEX.test(P.TOKEN_PREFIX + 'A'.repeat(44))).toBe(false)
    expect(P.TOKEN_REGEX.test('ms2_' + 'A'.repeat(43))).toBe(false)
  })

  it('RICE_ENTRY_KEY_RE：installId(uuid) : localSeq', () => {
    expect(P.RICE_ENTRY_KEY_RE.test('9f2c77aa-0000-4000-8000-000000000000:1042')).toBe(true)
    expect(P.RICE_ENTRY_KEY_RE.test('9f2c77aa-0000-4000-8000-000000000000')).toBe(false)
    expect(P.RICE_ENTRY_KEY_RE.test('not-a-uuid:1')).toBe(false)
  })

  it('日期键/周键形状', () => {
    expect(P.DATE_KEY_RE.test('2026-10-08')).toBe(true)
    expect(P.DATE_KEY_RE.test('2026-1-8')).toBe(false)
    expect(P.WEEK_KEY_RE.test('2026-W41')).toBe(true)
    expect(P.WEEK_KEY_RE.test('2026-41')).toBe(false)
  })

  it('能力位三项、协议版本 1、文档类型四份', () => {
    expect([...P.CAPABILITIES]).toEqual(['challenge_settle', 'rice_ledger', 'leaderboard'])
    expect(P.PROTOCOL_CURRENT).toBe(1)
    expect(P.PROTOCOL_FLOOR).toBe(1)
    expect(P.API_VERSION).toBe(1)
    expect([...P.DOC_TYPES]).toEqual(['profile', 'wrongbook', 'favorites', 'practice'])
  })
})

// ---------------------------------------------------------------- 用户名违禁词（2026-10-22）

describe('findSensitiveUsernameWord —— 归一化 + 词边界', () => {
  it('干净网名一律 null（含几个「看起来像、实际不该误伤」的阴性对照）', () => {
    for (const name of [
      'alice',
      '大肥鱼学徒',
      '猫娘小课堂',
      'Sussex', // 里面有 sex，但 \b 词边界挡住
      'Dickens', // 里面有 dick
      'Classic', // 里面有 ass？没有；但确实是常用词
      'Scunthorpe',
      'shuttle',
      'assignment'
    ]) {
      expect(P.findSensitiveUsernameWord(name), name).toBe(null)
    }
    expect(P.findSensitiveUsernameWord('')).toBe(null)
  })

  it('中文按去空白/零宽后的子串命中：返回命中的原词', () => {
    expect(P.findSensitiveUsernameWord('我是傻逼')).toBe('傻逼')
    expect(P.findSensitiveUsernameWord('傻 逼')).toBe('傻逼') // 空格夹字
    expect(P.findSensitiveUsernameWord('傻​逼')).toBe('傻逼') // 零宽空格
    expect(P.findSensitiveUsernameWord('大肥鱼_傻-逼')).toBe('傻逼') // 下划线/连字符
  })

  it('英文按词边界 + 大小写归一：fuck-you / a_nazi_b 命中，连写另收', () => {
    expect(P.findSensitiveUsernameWord('FUCK')).toBe('fuck')
    expect(P.findSensitiveUsernameWord('fuck-you')).toBe('fuck')
    expect(P.findSensitiveUsernameWord('a_nazi_b')).toBe('nazi')
    expect(P.findSensitiveUsernameWord('fuckyou')).toBe('fuckyou')
    expect(P.findSensitiveUsernameWord('MotherFucker')).toBe('motherfucker')
  })

  it('NFKC 全角归一（全角字母也会被认出来）', () => {
    expect(P.findSensitiveUsernameWord('ＦＵＣＫ')).toBe('fuck')
    expect(P.findSensitiveUsernameWord('ｓｈｉｔ')).toBe('shit')
  })

  it('词库每条都能被自己命中（防「加了词但匹配器漏掉它」的静默失效）', () => {
    // 英文词需要词边界，包一层前缀/后缀即可；中文直接原样。唯一的种坏自检：
    // 把所有词条首字改掉后，命中数必须归零（证明上面的循环不是恒真）。
    const all = [...P.SENSITIVE_USERNAME_WORDS]
    for (const word of all) {
      // 两侧加分隔符：英文词需要词边界；中文的去分隔符逻辑会把它吃掉，不影响子串判定
      expect(P.findSensitiveUsernameWord(`x-${word}-x`), word).not.toBe(null)
    }
    const broken = all.map((w) => `x-${w.slice(1)}-x`)
    expect(broken.filter((name) => P.findSensitiveUsernameWord(name) === null).length).toBe(all.length)
  })
})
