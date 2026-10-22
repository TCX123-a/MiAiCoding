/**
 * 「大肥鱼互动说明」数值对账单测（UI 大修轮 2026-10-09；契约 §2.2）。
 *
 * 【这个文件在守什么】设置页那块常显说明面板里的**每一个数字**都必须来自
 * src/shared/pet.ts 真源，而不是手抄一份 —— 手抄的数字会在下次调参时静默
 * 变成假话（界面照样好看，只是教用户的规则已经过期）。五段链路缺一不可：
 *
 *   ① 真源常量 === 冻结台账（FROZEN）：改任何 pet.ts 常量 → 红，逼一次人工复核；
 *   ② copy.ts 的 PET_GUIDE_* 用真源常量调用 === 冻结台账：改文案 → 红；
 *   ③ SettingsView.vue 的表达式 === 期望表达式（静态抽取）：视图必须**引用**
 *      常量（把 2 写成字面量就红）—— 附尺子自证（种坏样本必须被同一段判据抓住）；
 *   ④ 模板面板在场 + 位置正确（桌宠卡尾）+ 正文零字面量数字（全走 {{ }} 插值）；
 *   ⑤ 好感衰减步进：pet.ts 的步进是 decayAffection 里的**字面量**（无具名导出），
 *      用真函数实跑 7 个周期测出来，与视图钉的 AFF_DECAY_STEP 对账。
 *
 * 【为什么冻结台账这么重】这些数字是主人拍板口径（契约 §2.2 逐条列出）。
 * 台账红了先问「新数字对不对、文案要不要跟着改」，改台账是**人工动作** ——
 * 跟 wall-glass.test.ts 的 opacity 快照同一个思路：数字变了不是一定错，
 * 是必须过目。
 *
 * 【它抓不到什么】静态文本判据不渲染 Vue 组件（node 环境没有 vue 插件）：
 * 它证明「视图引用的是常量」「模板没有写死数字」，不证明浏览器里排出来的
 * 样子 —— 视觉验收是收尾探针的活。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  decayAffection,
  defaultPetState,
  PET_AFFECTION_DECAY_PERIOD_MS,
  PET_AFFECTION_FAMILIAR_AT,
  PET_AFFECTION_LOVE_AT,
  PET_AFFECTION_RULES,
  PET_CHECKIN_RICE,
  PET_DECAY_OFFLINE_PERIOD_MS,
  PET_DECAY_ONLINE_PERIOD_MS,
  PET_FEED_GAIN,
  PET_HUNGER_FULL_AT,
  PET_HUNGER_MEDIUM_AT,
  PET_HUNGER_MILD_AT,
  PET_HUNGER_SEVERE_AT,
  PET_RICE_MAX,
  PET_REWARD_RICE
} from '../../../../shared/pet'
import { SETTINGS } from '../copy'
import { maskComments } from '../../../../shared/__tests__/mask-comments'

/** 本文件在 src/renderer/src/lib/__tests__ 下 */
const VIEW_PATH = join(__dirname, '..', '..', 'views', 'SettingsView.vue')
const RAW = readFileSync(VIEW_PATH, 'utf8')
/** 剥注释（块 / 行 / HTML）后的源码：所有判据都在它上面跑，注释里的示例不算数 */
const MASKED = maskComments(RAW)

/** 模板区（indexOf/lastIndexOf 显式取，-1 时响亮失败 —— 查空不许静默跳过） */
const T_START = MASKED.indexOf('<template>')
const T_END = MASKED.lastIndexOf('</template>')
if (T_START === -1 || T_END === -1 || T_END <= T_START) {
  throw new Error('SettingsView.vue 里取不到模板区（判据已漂移？）')
}
const TEMPLATE = MASKED.slice(T_START, T_END + '</template>'.length)

/**
 * 冻结台账（2026-10-09 大修版，主人拍板口径）。
 * 改任何一个数字/一句话之前，先想清楚「引擎（pet.ts）变了没、文案跟不跟」。
 *
 * 【2026-10-15 夜更新（V1-46 / V1-42 / V1-49）】饱腹从三条变四条：学习三源
 * 与饭盒上限 999 上了明面（V1-42 要求"能赚多少、哪天赚不动"都能查到）；
 * 0 档那句删掉「学一节课就能唤醒」（摸头/学课都不再直接回饱食度，喂饭是
 * 唯一唤醒路径）；跟随说明从一道门变两道门（好感 + 饱腹，V1-49 的 bug 就是
 * 它原先只写了前者）；好感九类增量与界值本身未动。
 */
const FROZEN = {
  rules: {
    feed: 2,
    pat: 1,
    checkin: 1,
    study: 2,
    challenge: 3,
    review: 5,
    wrong: -1,
    starving: -2,
    'long-away': -5
  } as const,
  affDecayPeriodMs: 24 * 60 * 60_000,
  onlinePeriodMs: 2 * 60_000,
  offlinePeriodMs: 6 * 60_000,
  feedGain: 20,
  checkinRice: 2,
  hungerAt: { full: 80, mild: 50, medium: 20, severe: 1 },
  /** 好感两端的行为分界（补充模块一②：「80+ 主动跟随/频繁撒娇、20- 冷漠」） */
  affectionAt: { love: 80, coldBelow: 20 },
  affGain: [
    '喂一碗大白饭 +2',
    '摸摸鱼头 +1',
    '每天签到 +1',
    '学完一课 +2',
    '完成每日挑战 +3',
    '复习考满分 +5'
  ],
  affDown: ['答错题 -1', '让它饿到 0 -2', '很久不来看它 -5'],
  affDecay: '另外，超过一天没来，好感每天会悄悄 -1，最低掉到 0 就不再掉了喵。',
  hunger: [
    '开着电脑时约每 2 分钟 -1，关掉电脑时约每 6 分钟 -1',
    '喂一碗大白饭 +20；每天签到送 2 碗大白饭',
    '大白饭还从学习里来：学完一课 +2、复习考满分 +2、每答对一题 +1',
    '饭盒最多攒 999 碗；只有喂饭能垫肚子（摸头只攒好感），哪天赚不进了它会说一声喵'
  ],
  tiers: [
    '80 及以上：肚子饱饱——满屋撒欢乱跑，报错也说得清清楚楚',
    '50 ~ 79：吃得不差——照常乱跑，偶尔催你喂一口',
    '20 ~ 49：有点饿了——行动迟缓下来；报错变成讨饭，跑腿还能跑',
    '1 ~ 19：饿扁了——一步三挪地追着催饭，报错功能关了，跑腿也停了',
    '0：彻底饿趴——趴在桌面上一动不动，喂口饭就能唤醒喵'
  ],
  /** 好感两端的行为三行（补充模块一②；数字 = affectionAt 的真源界值） */
  affTiers: [
    '80 及以上：黏人模式——主动跟在你光标边上，还时不时蹭过来撒娇',
    '20 以下：冷淡模式——不主动找你搭话（喂饭、摸摸能慢慢哄回来）',
    '20 ~ 79：普通模式——不黏人也不冷淡，正常陪着你'
  ],
  /** 跟随开关的行下说明（那两道门必须来自真源；改口径先红这里）
   *  【V1-49（2026-10-16 凌晨）】没资格时菜单项从"整项藏掉"改成"在场置灰 +
   *  括号里写差在哪"（bug 修复），这句冻结文案随之改口 —— 再改文案先红这里。 */
  followHint:
    '关掉＝总闸：它不再主动凑向你的光标（被点、被喂、跑腿回话一概照旧）。' +
    '开着也讲交情——肚子吃饱（饱腹度 50 及以上）又好感到 80，它才会自己贴过来；' +
    '还差得远时右键菜单里那项「跟着我走」是灰的，括号里写着差在哪（先喂口饭、多相处几天喵）。'
}

const DAY_MS = 24 * 60 * 60_000

/** 从视图源码里抽 AFF_DECAY_STEP（抽不到 = 判据漂移，响亮失败） */
function viewAffDecayStep(src: string = MASKED): number {
  const m = /const\s+AFF_DECAY_STEP\s*=\s*(\d+)/.exec(src)
  if (!m) throw new Error('SettingsView.vue 里找不到 `const AFF_DECAY_STEP = <数字>`（判据已漂移？）')
  return Number(m[1])
}

/** 视图里的「每天」衰减值（与视图同一式子算一遍） */
const VIEW_DECAY_PER_DAY = (DAY_MS / PET_AFFECTION_DECAY_PERIOD_MS) * viewAffDecayStep()

// ---------------------------------------------------------------- ① 真源常量

describe('① 真源常量 === 冻结台账（pet.ts 调参必须过这里）', () => {
  it('好感九类增量逐值相等', () => {
    for (const [kind, want] of Object.entries(FROZEN.rules)) {
      expect(PET_AFFECTION_RULES[kind as keyof typeof PET_AFFECTION_RULES].delta, kind).toBe(want)
    }
    // 反向：台账里的九类就是全部计分表（pet.ts 加了新类别而文案没讲，这里提醒）
    expect(Object.keys(PET_AFFECTION_RULES).sort()).toEqual(Object.keys(FROZEN.rules).sort())
  })

  it('衰减周期 / 在线离线周期 / 喂饭收益 / 签到大白饭 / 五档界值', () => {
    expect(PET_AFFECTION_DECAY_PERIOD_MS).toBe(FROZEN.affDecayPeriodMs)
    expect(PET_DECAY_ONLINE_PERIOD_MS).toBe(FROZEN.onlinePeriodMs)
    expect(PET_DECAY_OFFLINE_PERIOD_MS).toBe(FROZEN.offlinePeriodMs)
    expect(PET_FEED_GAIN).toBe(FROZEN.feedGain)
    expect(PET_CHECKIN_RICE).toBe(FROZEN.checkinRice)
    expect(PET_HUNGER_FULL_AT).toBe(FROZEN.hungerAt.full)
    expect(PET_HUNGER_MILD_AT).toBe(FROZEN.hungerAt.mild)
    expect(PET_HUNGER_MEDIUM_AT).toBe(FROZEN.hungerAt.medium)
    expect(PET_HUNGER_SEVERE_AT).toBe(FROZEN.hungerAt.severe)
    expect(PET_AFFECTION_LOVE_AT).toBe(FROZEN.affectionAt.love)
    expect(PET_AFFECTION_FAMILIAR_AT).toBe(FROZEN.affectionAt.coldBelow)
  })

  it('周期恰好是 24 小时（「超过一天没来 / 每天」这两句措辞的前提）', () => {
    expect(PET_AFFECTION_DECAY_PERIOD_MS).toBe(DAY_MS)
    expect(PET_DECAY_ONLINE_PERIOD_MS % 60_000).toBe(0)
    expect(PET_DECAY_OFFLINE_PERIOD_MS % 60_000).toBe(0)
  })
})

// ---------------------------------------------------------------- ② copy 输出

describe('② copy.ts 的 PET_GUIDE_* 用真源调用 === 冻结台账（改文案先红）', () => {
  it('好感加分六条 / 扣分三条 / 衰减一句', () => {
    expect(
      SETTINGS.PET_GUIDE_AFF_LINES(
        PET_AFFECTION_RULES.feed.delta,
        PET_AFFECTION_RULES.pat.delta,
        PET_AFFECTION_RULES.checkin.delta,
        PET_AFFECTION_RULES.study.delta,
        PET_AFFECTION_RULES.challenge.delta,
        PET_AFFECTION_RULES.review.delta
      )
    ).toEqual(FROZEN.affGain)
    expect(
      SETTINGS.PET_GUIDE_AFF_DOWN(
        Math.abs(PET_AFFECTION_RULES.wrong.delta),
        Math.abs(PET_AFFECTION_RULES.starving.delta),
        Math.abs(PET_AFFECTION_RULES['long-away'].delta)
      )
    ).toEqual(FROZEN.affDown)
    expect(SETTINGS.PET_GUIDE_AFF_DECAY(VIEW_DECAY_PER_DAY)).toBe(FROZEN.affDecay)
  })

  it('饱腹四条 / 五档五行', () => {
    expect(
      SETTINGS.PET_GUIDE_HUN_LINES(
        PET_DECAY_ONLINE_PERIOD_MS / 60_000,
        PET_DECAY_OFFLINE_PERIOD_MS / 60_000,
        PET_FEED_GAIN,
        PET_CHECKIN_RICE,
        PET_REWARD_RICE.lesson,
        PET_REWARD_RICE.review,
        PET_REWARD_RICE.answer,
        PET_RICE_MAX
      )
    ).toEqual(FROZEN.hunger)
    expect(
      SETTINGS.PET_GUIDE_TIER_LINES(
        PET_HUNGER_FULL_AT,
        PET_HUNGER_MILD_AT,
        PET_HUNGER_MEDIUM_AT,
        PET_HUNGER_SEVERE_AT
      )
    ).toEqual(FROZEN.tiers)
  })

  it('好感行为三行 / 跟随开关说明（两道门都要来自真源 —— V1-49 补饱腹门）', () => {
    expect(SETTINGS.PET_GUIDE_AFF_TIER_LINES(PET_AFFECTION_LOVE_AT, PET_AFFECTION_FAMILIAR_AT)).toEqual(
      FROZEN.affTiers
    )
    expect(SETTINGS.PET_FOLLOW_HINT(PET_AFFECTION_LOVE_AT, PET_HUNGER_MILD_AT)).toBe(FROZEN.followHint)
  })

  it('尺子自证：台账与真源输出「不相同」时必须真的不等（抗恒真比较器）', () => {
    // 拿一个手工改坏的输出比一下（喂饭 21 而不是 20）：相等判据必须给 false
    const doctored = SETTINGS.PET_GUIDE_HUN_LINES(
      PET_DECAY_ONLINE_PERIOD_MS / 60_000,
      PET_DECAY_OFFLINE_PERIOD_MS / 60_000,
      PET_FEED_GAIN + 1,
      PET_CHECKIN_RICE,
      PET_REWARD_RICE.lesson,
      PET_REWARD_RICE.review,
      PET_REWARD_RICE.answer,
      PET_RICE_MAX
    )
    expect(doctored).not.toEqual(FROZEN.hunger)
    // 跟随说明的饱腹门同理：80/51 与台账的 80/50 必须不等
    expect(SETTINGS.PET_FOLLOW_HINT(PET_AFFECTION_LOVE_AT, PET_HUNGER_MILD_AT + 1)).not.toBe(
      FROZEN.followHint
    )
  })
})

// ---------------------------------------------------------------- ③ 视图表达式

/** 去掉所有空白后的视图源码（排版怎么调都不影响匹配；表达式拼写原样保留） */
const VIEW_TIGHT = MASKED.replace(/\s+/g, '')

/** 期望算式（实参必须**引用**真源常量，不许出现字面量） */
const EXPECT_CALLS = [
  'constMINUTE_MS=60_000',
  'constDAY_MS=24*60*60_000',
  'constAFF_DECAY_STEP=1',
  'constAFF_DECAY_PER_DAY=(DAY_MS/PET_AFFECTION_DECAY_PERIOD_MS)*AFF_DECAY_STEP',
  'SETTINGS.PET_GUIDE_AFF_LINES(PET_AFFECTION_RULES.feed.delta,PET_AFFECTION_RULES.pat.delta,PET_AFFECTION_RULES.checkin.delta,PET_AFFECTION_RULES.study.delta,PET_AFFECTION_RULES.challenge.delta,PET_AFFECTION_RULES.review.delta)',
  "SETTINGS.PET_GUIDE_AFF_DOWN(Math.abs(PET_AFFECTION_RULES.wrong.delta),Math.abs(PET_AFFECTION_RULES.starving.delta),Math.abs(PET_AFFECTION_RULES['long-away'].delta))",
  'SETTINGS.PET_GUIDE_AFF_DECAY(AFF_DECAY_PER_DAY)',
  'SETTINGS.PET_GUIDE_HUN_LINES(PET_DECAY_ONLINE_PERIOD_MS/MINUTE_MS,PET_DECAY_OFFLINE_PERIOD_MS/MINUTE_MS,PET_FEED_GAIN,PET_CHECKIN_RICE,PET_REWARD_RICE.lesson,PET_REWARD_RICE.review,PET_REWARD_RICE.answer,PET_RICE_MAX)',
  'SETTINGS.PET_GUIDE_TIER_LINES(PET_HUNGER_FULL_AT,PET_HUNGER_MILD_AT,PET_HUNGER_MEDIUM_AT,PET_HUNGER_SEVERE_AT)',
  'SETTINGS.PET_GUIDE_AFF_TIER_LINES(PET_AFFECTION_LOVE_AT,PET_AFFECTION_FAMILIAR_AT)',
  'SETTINGS.PET_FOLLOW_HINT(PET_AFFECTION_LOVE_AT,PET_HUNGER_MILD_AT)'
]

/** 缺失清单（空的 = 全部在场） */
function missingFrom(tight: string): string[] {
  return EXPECT_CALLS.filter((c) => !tight.includes(c))
}

describe('③ SettingsView 的算式必须引用真源常量（静态抽取）', () => {
  it('九条算式全部在场（含时间单位常数与衰减推导）', () => {
    expect(missingFrom(VIEW_TIGHT), '缺哪条上面列着 —— 视图把手抄数字/改了引用都会这样红').toEqual([])
  })

  it('尺子自证 ①：把加分第一项换成字面量 2，同一条判据必须抓住', () => {
    const bad = VIEW_TIGHT.replace('PET_AFFECTION_RULES.feed.delta', '2')
    expect(missingFrom(bad)).toContain(EXPECT_CALLS[4])
    // 且坏样本确实被改到了（否则这条自证自己就是空的）
    expect(bad).not.toBe(VIEW_TIGHT)
  })

  it('尺子自证 ②：把喂饭收益写死成 20，同一段判据必须抓住', () => {
    const bad = VIEW_TIGHT.replace('PET_FEED_GAIN,PET_CHECKIN_RICE', '20,2')
    expect(missingFrom(bad)).toContain(EXPECT_CALLS[7])
    expect(bad).not.toBe(VIEW_TIGHT)
  })

  it('尺子自证 ③：好感两界写死成 80,20，同一条判据必须抓住', () => {
    const bad = VIEW_TIGHT.replace('PET_AFFECTION_LOVE_AT,PET_AFFECTION_FAMILIAR_AT', '80,20')
    expect(missingFrom(bad)).toContain(EXPECT_CALLS[9])
    // 且跟随说明那句的两道门写死同样要被抓（V1-49 后它有两个实参，各咬一口）
    // ⚠️ 替换串必须带逗号：紧排后的真调用是 (PET_AFFECTION_LOVE_AT,PET_HUNGER_MILD_AT)，
    // 拿「…LOVE_AT)」当针是找不到的 —— replace 静默 no-op、坏样本=好样本（自证立刻红）
    const bad2 = VIEW_TIGHT.replace('SETTINGS.PET_FOLLOW_HINT(PET_AFFECTION_LOVE_AT,', 'SETTINGS.PET_FOLLOW_HINT(80,')
    expect(missingFrom(bad2)).toContain(EXPECT_CALLS[10])
    const bad3 = VIEW_TIGHT.replace(
      'SETTINGS.PET_FOLLOW_HINT(PET_AFFECTION_LOVE_AT,PET_HUNGER_MILD_AT)',
      'SETTINGS.PET_FOLLOW_HINT(PET_AFFECTION_LOVE_AT,50)'
    )
    expect(missingFrom(bad3)).toContain(EXPECT_CALLS[10])
    expect(bad).not.toBe(VIEW_TIGHT)
    expect(bad2).not.toBe(VIEW_TIGHT)
    expect(bad3).not.toBe(VIEW_TIGHT)
  })
})

// ---------------------------------------------------------------- ④ 模板面板

/**
 * 从模板里抠出 pet-guide 整块（按 <div>/</div> 数深度配对）。
 * 抠不到/配不上都抛错 —— 「查空返回 '' 然后断言全绿」是这类闸门最安静的坏法。
 */
function guideBlockOf(template: string): string {
  const start = template.indexOf('<div class="pet-guide">')
  if (start === -1) throw new Error('模板里找不到 <div class="pet-guide">（面板被删了？）')
  const re = /<div\b|<\/div>/g
  re.lastIndex = start
  let depth = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(template)) !== null) {
    if (m[0] === '<div') depth++
    else {
      depth--
      if (depth === 0) return template.slice(start, m.index + m[0].length)
    }
  }
  throw new Error('pet-guide 块的 </div> 配不上（嵌套结构被改坏了？）')
}

/**
 * 位置判据抽成函数：返回「该红的理由」清单（空 = 全过）。
 * 抽出来的意义 = 种坏样本走**同一条判据** —— 判据自己写错的话，
 * 拿着原样文档的断言会绿、拿坏样本的自证也会跟着绿（那种绿不算证据）。
 */
function guideOrderViolations(template: string): string[] {
  const out: string[] = []
  const idx = (piece: string, label: string): number => {
    const i = template.indexOf(piece)
    if (i === -1) out.push(`模板里找不到${label}`)
    return i
  }
  const iChat = idx('PET_CHAT_HINT', '聊天提示行')
  const iKey = idx('PET_AI_KEY_ON', 'AI Key 行')
  const iGuide = idx('class="pet-guide"', 'pet-guide 面板')
  const iNext = idx('card wall-card', '下一张卡（card wall-card）')
  if (iGuide !== -1 && iChat !== -1 && iGuide <= iChat) out.push('面板没在聊天提示行之后')
  if (iGuide !== -1 && iKey !== -1 && iGuide <= iKey) out.push('面板没在 AI Key 行之后')
  if (iGuide !== -1 && iNext !== -1 && iGuide >= iNext)
    out.push('面板不在下一张卡之前（跑到卡外了）')
  return out
}

/** 面板里该出现的插值（键名生在 copy.ts，值生在脚本段；模板不许自己造词） */
const NEED_PIECES = [
  '{{SETTINGS.PET_GUIDE_TITLE}}',
  '{{SETTINGS.PET_GUIDE_INTRO}}',
  '{{SETTINGS.PET_GUIDE_AFF_TITLE}}',
  '{{SETTINGS.PET_GUIDE_AFF_DOWN_TITLE}}',
  '{{SETTINGS.PET_GUIDE_AFF_TIER_TITLE}}',
  '{{SETTINGS.PET_GUIDE_HUN_TITLE}}',
  '{{SETTINGS.PET_GUIDE_TIER_TITLE}}',
  '{{SETTINGS.PET_GUIDE_NOTE}}',
  '{{SETTINGS.PET_GUIDE_FLAGS_NOTE}}',
  '{{petGuideAffDecay}}',
  'v-for="lineinpetGuideAffGain"',
  'v-for="lineinpetGuideAffDown"',
  'v-for="lineinpetGuideAffTiers"',
  'v-for="lineinpetGuideHunger"',
  'v-for="lineinpetGuideTiers"'
]

/** 缺哪条插值（空 = 全在） */
function missingPieces(block: string): string[] {
  const tight = block.replace(/\s+/g, '')
  return NEED_PIECES.filter((p) => !tight.includes(p))
}

describe('④ 模板：面板在场、位置正确、正文零写死数字', () => {
  it('面板在桌宠卡尾：聊天提示行 / AI Key 行之后、下一张卡（wall-card）之前', () => {
    expect(guideOrderViolations(TEMPLATE), '红什么上面写着').toEqual([])
  })

  it('尺子自证：面板被删 / 滑到卡外 → 同一条判据必须给红', () => {
    // ① 面板整个消失（类名换掉）：必须报「找不到面板」
    const gone = TEMPLATE.replace('<div class="pet-guide">', '<div class="other">')
    expect(gone).not.toBe(TEMPLATE)
    expect(guideOrderViolations(gone).join()).toContain('模板里找不到pet-guide 面板')
    // ② 面板滑到下一张卡之后：位置判据必须报「跑到卡外」
    const slid = 'PET_CHAT_HINT|x|PET_AI_KEY_ON|card wall-card|class="pet-guide"'
    expect(guideOrderViolations(slid)).toContain('面板不在下一张卡之前（跑到卡外了）')
    // ③ 干净的合成样本上判据必须给空 —— 防「恒报红」的坏判据拿假红冒充证据
    const fine = 'PET_CHAT_HINT|x|PET_AI_KEY_ON|class="pet-guide"|x|card wall-card'
    expect(guideOrderViolations(fine)).toEqual([])
  })

  it('面板正文与全部 {{ }} 插值在场（零字面量数字 / 零中文字面量）', () => {
    const block = guideBlockOf(TEMPLATE)
    // 正文里一个阿拉伯数字都不许有（数字全部走脚本→copy.ts 函数键）
    const digits = block.match(/\d/g) ?? []
    expect(digits, `pet-guide 面板出现写死的数字：${digits.join('')}`).toEqual([])
    expect(missingPieces(block), '面板里缺哪条插值上面写着').toEqual([])
  })

  it('尺子自证：抠掉一条插值 / 塞一个写死数字 → 两条判据必须各自咬住', () => {
    const block = guideBlockOf(TEMPLATE)
    const holey = block.replace('{{ SETTINGS.PET_GUIDE_NOTE }}', '')
    expect(holey).not.toBe(block)
    expect(missingPieces(holey)).toContain('{{SETTINGS.PET_GUIDE_NOTE}}')
    const numbered = block.replace('{{ petGuideAffDecay }}', '每天 -1')
    expect(numbered).not.toBe(block)
    expect((numbered.match(/\d/g) ?? []).length, '写死的 -1 必须被数字判据抓到').toBeGreaterThan(0)
  })

  it('尺子自证：抠块器在两种坏模板上必须抛错（不是返回空串然后静默全绿）', () => {
    // ① 面板被整个删掉 → 抠块器必须抛错
    expect(() => guideBlockOf('<div class="card"></div>')).toThrow()
    // ② </div> 配不上 → 抛错
    expect(() => guideBlockOf('<div class="pet-guide"><p>x</p>')).toThrow()
    // ③ 真模板上必须不抛（防「恒抛错」的坏抠块器：它在自证里假绿、在真文档上假红）
    expect(() => guideBlockOf(TEMPLATE)).not.toThrow()
  })
})

// ---------------------------------------------------------------- ⑤ 衰减步进

describe('⑤ 好感衰减步进：引擎实跑 vs 视图钉的值', () => {
  it('真 decayAffection 跑 7 个周期：每期 -1（= 视图的 AFF_DECAY_STEP）', () => {
    const t0 = Date.UTC(2026, 0, 1)
    const base = defaultPetState(new Date(t0).toISOString())
    const periods = 7
    const later = new Date(t0 + periods * PET_AFFECTION_DECAY_PERIOD_MS).toISOString()
    const { dropped } = decayAffection(base, later)
    expect(dropped, '初始好感 50 足够掉满 7 期').toBe(periods)
    const engineStep = dropped / periods
    expect(viewAffDecayStep(), '视图钉的 AFF_DECAY_STEP 与引擎实跑不符').toBe(engineStep)
    // 尺子自证：抽取器在改过的样本上必须给出别的值（防「正则恒给 1」）
    expect(viewAffDecayStep(MASKED.replace('const AFF_DECAY_STEP = 1', 'const AFF_DECAY_STEP = 3'))).toBe(3)
    expect(() => viewAffDecayStep('const NOPE = 1')).toThrow()
  })

  it('文案里的「每天 -N」=== 引擎步进 × 每天期数（当前周期下恰好就是步进）', () => {
    const periodsPerDay = DAY_MS / PET_AFFECTION_DECAY_PERIOD_MS
    const out = SETTINGS.PET_GUIDE_AFF_DECAY(VIEW_DECAY_PER_DAY)
    const shown = Number(/-(\d+)/.exec(out)?.[1])
    expect(viewAffDecayStep() * periodsPerDay, '视图的每天衰减值').toBe(VIEW_DECAY_PER_DAY)
    expect(shown, `文案里没抠到「-N」：${out}`).toBe(VIEW_DECAY_PER_DAY)
    // 尺子自证：同一段抠数正则在改过的句子上必须给出别的数
    expect(Number(/-(\d+)/.exec('好感每天会悄悄 -12，')?.[1])).toBe(12)
  })
})
