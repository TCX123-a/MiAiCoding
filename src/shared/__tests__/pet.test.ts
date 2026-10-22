/**
 * 大肥鱼桌宠的纯逻辑闸门（shared/pet.ts）。
 *
 * 【为什么这些逻辑值得单独钉】它们全部是**看得见的承诺**，错了不会崩、只会默默说谎：
 *   · normalize 是磁盘文件的读口 —— 手改坏一个字段，桌宠要照常起来（回默认），
 *     但**不许当回声筒**（坏值原样带出去 = 界面拿 NaN 算出个"饿"字）；
 *   · petFace 的优先级（饿 > 情绪 > 困 > 心情）是四个功能叠在同一个脸上，
 *     顺序错了不会报错，只会在凌晨把"傲娇"显示成"打盹"；
 *   · 聊天三道闸（10 秒 / 120 次 / 6 万 token）是成本护栏的全部实现 ——
 *     算错了就是真花钱，而且是"慢慢花"，没人看得见。
 *
 * 时刻一律用 `local(y, m, d, h, min)` 造（本地时间构造再转 ISO）：
 * petFace 的"困"看的是**本地小时**，直接写 `'...T23:00:00'` 这种无时区串
 * 在不同时区的 CI 上会翻车成假红。local() 保证"造出来的那个小时"就是
 * petFace 里 getHours() 读到的小时，跟运行机器的时区无关。
 */
import { describe, expect, it } from 'vitest'
import {
  addAffection,
  approxPetTokens,
  awayMs,
  decayAffection,
  decayPet,
  defaultPetAffectionDay,
  defaultPetState,
  exertPet,
  feedPet,
  grantPetRice,
  grantRunReward,
  lastWrongLabel,
  lessonStreak,
  normalizePetAffectionDay,
  normalizePetRunLedger,
  normalizePetState,
  parsePetAction,
  parsePetHitRects,
  normalizeRunReport,
  petAffectionTier,
  petChatCommit,
  petChatGate,
  petDayKey,
  petFace,
  petHungerTier,
  petMood,
  PET_AFFECTION_CLOSE_AT,
  PET_AFFECTION_DECAY_PERIOD_MS,
  PET_AFFECTION_FAMILIAR_AT,
  PET_AFFECTION_INITIAL,
  PET_AFFECTION_LIKE_AT,
  PET_AFFECTION_LOVE_AT,
  PET_AFFECTION_MAX,
  PET_AFFECTION_RULES,
  PET_AFFECTION_TIERS,
  PET_CHAT_DAILY_MAX,
  PET_CHAT_DAILY_TOKENS,
  PET_CHECKIN_RICE,
  PET_DECAY_OFFLINE_PERIOD_MS,
  PET_DECAY_ONLINE_PERIOD_MS,
  PET_HUNGER_FULL_AT,
  PET_HUNGER_MILD_AT,
  PET_HUNGER_MEDIUM_AT,
  PET_HUNGER_SEVERE_AT,
  PET_MEMORY_MAX,
  PET_MEMORY_STREAK_WINDOW_MS,
  PET_OFFLINE_DECAY_FLOOR,
  PET_REWARD_RICE,
  PET_RICE_DAILY_CAPS,
  PET_RICE_MAX,
  PET_RUN_LEDGER_MAX,
  PET_RUN_REWARD_DAILY_MAX,
  PET_SIZE_DEFAULT,
  PET_SIZES,
  PET_VERSION,
  pushPetMemory,
  setPetEmotion,
  setPetMode,
  setPetPos,
  setPetSize,
  snapshotOf,
  withPetEnabled
} from '../pet'

/** 本地某个时刻的 ISO 串（见文件头：时区无关的造时刻方式） */
function local(y: number, mo: number, d: number, h: number, mi = 0): string {
  return new Date(y, mo - 1, d, h, mi, 0, 0).toISOString()
}

describe('normalizePetState：读口的"缺就补、坏就扔"', () => {
  it('v1 老文件（没有 memory / emotion / size）升到当前版本：补一份空白记忆 + 默认体型，不是映射假历史', () => {
    const now = local(2026, 10, 6, 12)
    const v1 = {
      version: 1,
      enabled: true,
      satiety: 55,
      rice: 3,
      fedTotal: 1,
      earnedTotal: 3,
      lastDecayAt: now,
      mode: 'follow',
      x: 0.4,
      y: 0.5
    }
    const s = normalizePetState(v1, now)
    expect(s.version).toBe(PET_VERSION)
    expect(s.satiety).toBe(55) // 老字段原样保留
    expect(s.mode).toBe('follow')
    expect(s.memory.events).toEqual([]) // 迁移 = 补空白，不编历史
    expect(s.memory.lastSeenAt).toBe(now)
    expect(s.memory.chatCallsToday).toBe(0)
    expect(s.memory.chatDay).toBe(petDayKey(now))
    expect(s.emotion).toBe(null)
    expect(s.size).toBe(PET_SIZE_DEFAULT) // v2→v3 迁移：老文件没有 size 就补默认档
  })

  it('v2 老文件（有记忆、没有 size）升到 v3：补默认体型；白名单外的 size 回默认', () => {
    const now = local(2026, 10, 6, 12)
    const v2 = { ...defaultPetState(now) } as Record<string, unknown>
    delete v2.size
    expect(normalizePetState(v2, now).size).toBe(PET_SIZE_DEFAULT)
    // 白名单：假的 number（250）/ 字符串 / NaN / null 都不认 —— 页面会拿 size
    // 拼素材文件名，认下一个假值 = 去 load 一个不存在的图（透明的空窗）。
    for (const bad of [250, '238', 'big', Number.NaN, null, {}, 306.5]) {
      expect(
        normalizePetState({ ...v2, size: bad }, now).size,
        `size=${String(bad)} 不该被认下`
      ).toBe(PET_SIZE_DEFAULT)
    }
    for (const good of PET_SIZES) {
      expect(normalizePetState({ ...v2, size: good }, now).size).toBe(good)
    }
  })

  it('v3 老文件（有 size、没有 runLedger）升到 v4：补一本空白运行账（当天起算）；runLedger 是垃圾也回默认', () => {
    const now = local(2026, 10, 6, 12)
    const v3 = { ...defaultPetState(now), size: 238 } as Record<string, unknown>
    delete v3.runLedger
    const s = normalizePetState(v3, now)
    expect(s.version).toBe(PET_VERSION)
    expect(s.size).toBe(238) // 老字段原样保留
    expect(s.runLedger).toEqual({ day: petDayKey(now), count: 0, hashes: [] })
    // 垃圾形状（非对象 / 字符串 / 数组）→ 同一本默认账，不抛
    for (const bad of ['garbage', 42, [1, 2], true]) {
      expect(
        normalizePetState({ ...v3, runLedger: bad }, now).runLedger,
        `runLedger=${String(bad)} 不该被认下`
      ).toEqual({ day: petDayKey(now), count: 0, hashes: [] })
    }
  })

  it('坏字段回默认、不吃回声：NaN 饱食度 / 白名单外的 mode / 越界比例 / 假时刻', () => {
    const now = local(2026, 10, 6, 12)
    const s = normalizePetState(
      {
        satiety: Number.NaN,
        rice: 1e9,
        mode: 'teleport',
        x: 7,
        y: -3,
        lastDecayAt: 'not-a-date',
        emotion: 'rage',
        enabled: 'yes'
      },
      now
    )
    const d = defaultPetState(now)
    expect(s.satiety).toBe(d.satiety)
    expect(s.rice).toBe(PET_RICE_MAX) // 钳到上限而不是回默认——数字本身是有限的
    expect(s.mode).toBe('wander')
    expect(s.x).toBe(1)
    expect(s.y).toBe(0)
    expect(s.lastDecayAt).toBe(now) // 编不出的时刻锚回当下
    expect(s.emotion).toBe(null) // 白名单外
    expect(s.enabled).toBe(true) // 非布尔回默认
  })

  it('整包不是对象（null / 字符串 / 数组）→ 一份全新默认状态，不抛', () => {
    const now = local(2026, 10, 6, 12)
    for (const bad of [null, 'x', 42, [1, 2]]) {
      expect(normalizePetState(bad, now)).toEqual(defaultPetState(now))
    }
  })

  it('坏记忆条目丢弃、好条目留下（加法日志不做连坐）', () => {
    const now = local(2026, 10, 6, 12)
    const s = normalizePetState(
      {
        memory: {
          events: [
            { kind: 'wrong', at: local(2026, 10, 5, 9), label: '好条目' },
            { kind: 'gossip', at: now, label: '白名单外' }, // kind 不认 → 丢
            { kind: 'wrong', at: 'garbage', label: '坏时刻' }, // 时刻编不出 → 丢
            { kind: 'lesson', at: local(2026, 10, 6, 11), label: 42 }, // label 非串 → null，条目留下
            { kind: 'run-ok', at: now, label: '' } // 空串同理 → null，条目留下
          ]
        }
      },
      now
    )
    // 逐条对形状：坏的没了、好的原样、坏 label 落成 null（不是整条丢）
    expect(s.memory.events).toEqual([
      { kind: 'wrong', at: local(2026, 10, 5, 9), label: '好条目' },
      { kind: 'lesson', at: local(2026, 10, 6, 11), label: null },
      { kind: 'run-ok', at: now, label: null }
    ])
  })

  it('记忆环按容量截尾：满员丢**最老的**，留下的是最后 MAX 条', () => {
    const now = local(2026, 10, 6, 12)
    const many = Array.from({ length: PET_MEMORY_MAX + 5 }, (_, i) => ({
      kind: 'wrong',
      at: local(2026, 10, 1, 12, i),
      label: `课${i}`
    }))
    const s = normalizePetState({ memory: { events: many, chatCallsToday: 3 } }, now)
    expect(s.memory.events.length).toBe(PET_MEMORY_MAX)
    // 丢最老的：留下的标签是尾部的 课5..课(MAX+4)，头部 5 条不在了
    expect(s.memory.events.map((e) => e.label)).toEqual(
      many.slice(-PET_MEMORY_MAX).map((e) => e.label)
    )
    expect(s.memory.events.some((e) => e.label === '课0')).toBe(false)
    expect(s.memory.chatCallsToday).toBe(3) // 账本数字照收
  })
})

describe('petFace：饿 > 情绪 > 困 > 心情', () => {
  const noon = local(2026, 10, 6, 12)
  const night = local(2026, 10, 6, 23, 30)

  it('饿压过一切：饿着 + 傲娇 + 深夜 → 还是"求喂饭"（可行动的那档）', () => {
    let s = defaultPetState(noon)
    s = { ...s, satiety: 10 }
    s = setPetEmotion(s, 'tsundere', night)
    expect(petFace(s, night)).toBe('hungry')
  })

  it('时效内的情绪压过"困"：凌晨连点五下该看见的是傲娇，不是打盹', () => {
    let s = defaultPetState(noon)
    s = { ...s, satiety: 80 }
    s = setPetEmotion(s, 'tsundere', night)
    expect(petFace(s, night)).toBe('tsundere')
  })

  it('情绪过期现算：TTL 过了自动回落，深夜回落到 sleepy、白天回落到心情', () => {
    let s = defaultPetState(noon)
    s = setPetEmotion(s, 'tsundere', noon) // 60 秒时效
    const after = new Date(Date.parse(noon) + 61_000).toISOString()
    expect(petFace(s, after)).toBe('happy')
    // 同一个状态换到深夜再看 → 困
    const lateNight = local(2026, 10, 6, 23, 30)
    const after2 = new Date(Date.parse(lateNight) + 61_000).toISOString()
    expect(petFace(s, after2)).toBe('sleepy')
  })

  it('时段边界：23:00 与 05:59 是困、06:00 与 22:59 不是', () => {
    const s = { ...defaultPetState(noon), satiety: 80 }
    expect(petFace(s, local(2026, 10, 6, 23, 0))).toBe('sleepy')
    expect(petFace(s, local(2026, 10, 7, 5, 59))).toBe('sleepy')
    expect(petFace(s, local(2026, 10, 7, 6, 0))).toBe('happy')
    expect(petFace(s, local(2026, 10, 6, 22, 59))).toBe('happy')
  })

  it('心情三档照旧：≥66 元气、≥33 还行、以下饿扁', () => {
    expect(petMood(100)).toBe('happy')
    expect(petMood(66)).toBe('happy')
    expect(petMood(65)).toBe('ok')
    expect(petMood(33)).toBe('ok')
    expect(petMood(32)).toBe('hungry')
  })

  it('snapshotOf 带上 face：广播出去的那份快照里就有它（设置卡直接显示）', () => {
    const s = { ...defaultPetState(noon), satiety: 80 }
    expect(snapshotOf(s, noon).face).toBe('happy')
  })
})

describe('setPetEmotion：TTL 是"落盘的失效时刻"', () => {
  const t0 = local(2026, 10, 6, 12)
  it('傲娇 60 秒、兴奋 90 秒；覆盖旧情绪', () => {
    let s = defaultPetState(t0)
    s = setPetEmotion(s, 'tsundere', t0)
    expect(Date.parse(s.emotionUntil) - Date.parse(t0)).toBe(60_000)
    const t1 = new Date(Date.parse(t0) + 5_000).toISOString()
    s = setPetEmotion(s, 'excited', t1)
    expect(s.emotion).toBe('excited')
    expect(Date.parse(s.emotionUntil) - Date.parse(t1)).toBe(90_000)
  })

  it('时刻编不出来时退回 Date.now()（防线内的兜底，不许 NaN 落盘）', () => {
    const s = setPetEmotion(defaultPetState(t0), 'tsundere', 'garbage')
    expect(Number.isFinite(Date.parse(s.emotionUntil))).toBe(true)
  })
})

describe('记忆环与聊天账本', () => {
  const now = local(2026, 10, 6, 12)

  it('pushPetMemory 截尾且丢最老的；lastWrongLabel 取"最近一条带课名的错题"', () => {
    let s = defaultPetState(now)
    for (let i = 0; i < PET_MEMORY_MAX + 3; i++) {
      s = pushPetMemory(s, 'wrong', `课${i}`, local(2026, 10, 6, 10, i))
    }
    expect(s.memory.events.length).toBe(PET_MEMORY_MAX)
    expect(s.memory.events[0].label).toBe('课3') // 前三条被挤掉
    expect(lastWrongLabel(s)).toBe(`课${PET_MEMORY_MAX + 2}`)
    // 最新的错题没有课名 → 往前找带课名的那条，而不是直接 null
    s = pushPetMemory(s, 'wrong', null, local(2026, 10, 6, 11, 59))
    expect(lastWrongLabel(s)).toBe(`课${PET_MEMORY_MAX + 2}`)
    // 全是无课名的错题 → null（主进程走"通用台词"，不编）
    let t = defaultPetState(now)
    t = pushPetMemory(t, 'wrong', null, now)
    expect(lastWrongLabel(t)).toBe(null)
  })

  it('lessonStreak 只数窗口内的"lesson"，窗口外与未来时刻都不算', () => {
    let s = defaultPetState(now)
    s = pushPetMemory(s, 'lesson', null, new Date(Date.parse(now) - 1000).toISOString())
    s = pushPetMemory(s, 'lesson', null, new Date(Date.parse(now) - 60_000).toISOString())
    s = pushPetMemory(s, 'wrong', null, now) // 不是 lesson
    s = pushPetMemory(
      s,
      'lesson',
      null,
      new Date(Date.parse(now) - PET_MEMORY_STREAK_WINDOW_MS - 1000).toISOString()
    )
    expect(lessonStreak(s, now)).toBe(2)
    // 时钟回拨产生的"未来"条目不许算进来（now - t 为负）
    let f = defaultPetState(now)
    f = pushPetMemory(f, 'lesson', null, new Date(Date.parse(now) + 60_000).toISOString())
    expect(lessonStreak(f, now)).toBe(0)
  })

  it('awayMs：正常差值、时钟回拨当 0（不触发"多日不见"这种误伤）', () => {
    let s = defaultPetState(local(2026, 10, 1, 12))
    expect(awayMs(s, local(2026, 10, 3, 12))).toBe(48 * 60 * 60_000)
    expect(awayMs(s, local(2026, 9, 30, 12))).toBe(0) // 现在比"上次"还早
  })

  it('聊天三道闸：冷却 / 当日次数 / 当日 token；跨日自动清账', () => {
    const d = defaultPetState(now)
    // 刚聊过 → 冷却
    let s = { ...d, memory: { ...d.memory, lastChatAt: new Date(Date.parse(now) - 5_000).toISOString() } }
    expect(petChatGate(s, now)).toBe('cooldown')
    // 冷却已过、次数顶格 → daily
    s = {
      ...d,
      memory: {
        ...d.memory,
        lastChatAt: new Date(Date.parse(now) - 60_000).toISOString(),
        chatDay: petDayKey(now),
        chatCallsToday: PET_CHAT_DAILY_MAX
      }
    }
    expect(petChatGate(s, now)).toBe('daily')
    // token 顶格 → tokens
    s = { ...s, memory: { ...s.memory, chatCallsToday: 1, chatTokensToday: PET_CHAT_DAILY_TOKENS } }
    expect(petChatGate(s, now)).toBe('tokens')
    // 账本还停在昨天 → 今天从零开始（哪怕昨天爆了表）
    s = {
      ...s,
      memory: { ...s.memory, chatDay: '2026-10-05', chatCallsToday: 999, chatTokensToday: 9_999_999 }
    }
    expect(petChatGate(s, now)).toBe('ok')
  })

  it('饿扁优先于一切：冷却中 + 当日次数/token 都爆表 → 仍是 hungry（不是 cooldown/daily/tokens）', () => {
    const d = defaultPetState(now)
    const s = {
      ...d,
      satiety: 0,
      memory: {
        ...d.memory,
        lastChatAt: new Date(Date.parse(now) - 5_000).toISOString(), // 冷却窗口内
        chatDay: petDayKey(now),
        chatCallsToday: PET_CHAT_DAILY_MAX,
        chatTokensToday: PET_CHAT_DAILY_TOKENS
      }
    }
    expect(petChatGate(s, now)).toBe('hungry')
  })

  it('饿扁是"零 API 拦下"：其余一切正常也拒；satiety=1 就回落到原三档', () => {
    const d = defaultPetState(now)
    expect(petChatGate({ ...d, satiety: 0 }, now)).toBe('hungry')
    // 差 1 点不触发 hungry：原本的三档行为不变
    expect(petChatGate({ ...d, satiety: 1 }, now)).toBe('ok')
    const cool = {
      ...d,
      satiety: 1,
      memory: { ...d.memory, lastChatAt: new Date(Date.parse(now) - 5_000).toISOString() }
    }
    expect(petChatGate(cool, now)).toBe('cooldown')
  })

  it('petChatCommit：同日累加、跨日重置、lastChatAt 落成"这次"，且每聊一次扣饱腹度', () => {
    const d = defaultPetState(now) // satiety 80
    let s = petChatCommit(d, now, 100)
    expect(s.memory.chatCallsToday).toBe(1)
    expect(s.memory.chatTokensToday).toBe(100)
    expect(s.memory.lastChatAt).toBe(now)
    expect(s.satiety).toBe(78) // PET_CHAT_COST = 2（思考是体力活）
    const later = new Date(Date.parse(now) + 30_000).toISOString()
    s = petChatCommit(s, later, 50)
    expect(s.memory.chatCallsToday).toBe(2)
    expect(s.memory.chatTokensToday).toBe(150)
    expect(s.satiety).toBe(76)
    // 跨日：昨天记的 3 次不算数，从 1 开始
    const tomorrow = local(2026, 10, 7, 9)
    s = petChatCommit(s, tomorrow, 10)
    expect(s.memory.chatCallsToday).toBe(1)
    expect(s.memory.chatTokensToday).toBe(10)
    expect(s.memory.chatDay).toBe(petDayKey(tomorrow))
    expect(s.satiety).toBe(74)
    // 负数用量被夹成 0（防御性：不许账本倒退）
    s = petChatCommit(s, tomorrow, -500)
    expect(s.memory.chatTokensToday).toBe(10)
    expect(s.satiety).toBe(72)
  })

  it('petChatCommit 扣体力夹在 0 以上：1 → 0，已经 0 仍 0（记账照记，闸在 petChatGate 不在这）', () => {
    const d = defaultPetState(now)
    const one = petChatCommit({ ...d, satiety: 1 }, now, 10)
    expect(one.satiety).toBe(0)
    const zero = petChatCommit({ ...d, satiety: 0 }, now, 10)
    expect(zero.satiety).toBe(0)
    expect(zero.memory.chatCallsToday).toBe(1)
    expect(zero.memory.chatTokensToday).toBe(10)
  })

  it('approxPetTokens：中文约 1 token/字、混排折半 —— 护栏量级就够，不追求精确', () => {
    expect(approxPetTokens('')).toBe(0)
    expect(approxPetTokens('喵')).toBe(1)
    expect(approxPetTokens('一二三四')).toBe(2)
  })
})

/**
 * 饥饿五档（P3 ③ 拍板 2026-10-08）：80/50/20/1 与衰减 2min/6min。
 *
 * 【为什么边界要逐点写死数字】这四档同时决定三件事：跃迁台词、报错降级、
 * 菜单进度条颜色 —— 边界漂一格不会报错，只会让 79 的人先听到"有点饿了"
 * 再听到"饱饱"（两句话在日志里都合法）。拍板值就钉在这个 describe 里；
 * 行为测试（brain/extras）一律从常量派生，改常量只让这里红一次。
 */
describe('饥饿五档（petHungerTier）：档界逐点 + 拍板常量', () => {
  it('拍板常量：档界 80/50/20/1、在线 2min、离线 6min 且两速率必须不同', () => {
    expect([PET_HUNGER_FULL_AT, PET_HUNGER_MILD_AT, PET_HUNGER_MEDIUM_AT, PET_HUNGER_SEVERE_AT]).toEqual([
      80, 50, 20, 1
    ])
    expect(PET_DECAY_ONLINE_PERIOD_MS).toBe(2 * 60_000)
    expect(PET_DECAY_OFFLINE_PERIOD_MS).toBe(6 * 60_000)
    // 两个速率相同的话「离线更慢」的设计就没了（桌宠压力应指向"好久没回来"，
    // 而不是"忘了关电脑"）；brain 的离线衰减行为测试依赖这条成立
    expect(PET_DECAY_OFFLINE_PERIOD_MS).not.toBe(PET_DECAY_ONLINE_PERIOD_MS)
    expect(PET_DECAY_OFFLINE_PERIOD_MS).toBeGreaterThan(PET_DECAY_ONLINE_PERIOD_MS)
    // 离线衰减下限（V2-21）：值就是 medium 档界 20 —— 回来时是"饿得直催"
    // 而不是静音的 0 档。改值 = 改体验口径，必须在这里红一次。
    expect(PET_OFFLINE_DECAY_FLOOR).toBe(20)
    expect(PET_OFFLINE_DECAY_FLOOR).toBe(PET_HUNGER_MEDIUM_AT)
  })

  it('档界值逐点：80/79/50/49/20/19/1/0（闭下界；尺子自证：每个边界两侧必须不同档）', () => {
    const points: [number, string][] = [
      [100, 'full'],
      [80, 'full'],
      [79, 'mild'],
      [50, 'mild'],
      [49, 'medium'],
      [20, 'medium'],
      [19, 'severe'],
      [1, 'severe'],
      [0, 'empty']
    ]
    for (const [s, tier] of points) {
      expect(petHungerTier(s), `satiety=${s}`).toBe(tier)
    }
    // 尺子自证：把整张表映射成同一个档的"恒真尺子"过不了这四条
    expect(petHungerTier(80)).not.toBe(petHungerTier(79))
    expect(petHungerTier(50)).not.toBe(petHungerTier(49))
    expect(petHungerTier(20)).not.toBe(petHungerTier(19))
    expect(petHungerTier(1)).not.toBe(petHungerTier(0))
    // 比较方向自证：边界 +1 仍在高档（把 >= 写成 <= 的实现会在这露馅）
    expect(petHungerTier(81)).toBe('full')
    expect(petHungerTier(51)).toBe('mild')
    expect(petHungerTier(21)).toBe('medium')
    expect(petHungerTier(2)).toBe('severe')
  })

  it('NaN / 负数是 empty 方向（判定不出"饱"就当饿 —— 静默永远比错说一句安全）', () => {
    for (const bad of [Number.NaN, -1, -100]) {
      expect(petHungerTier(bad), `satiety=${String(bad)}`).toBe('empty')
    }
  })
})

describe('衰减 / 喂饭 / 发奖 / 位置', () => {
  const t0 = local(2026, 10, 6, 12)

  it('decayPet 按整周期推进锚点：零头原地留着，不给心跳频率漂移的机会', () => {
    const s = { ...defaultPetState(t0), satiety: 50 }
    // 3 分钟周期，过了 7 分 29 秒 = 2 个整周期 + 1 分 29 秒零头
    const at = new Date(Date.parse(t0) + 7 * 60_000 + 29_000).toISOString()
    const { state, dropped } = decayPet(s, at, 3 * 60_000)
    expect(dropped).toBe(2)
    expect(state.satiety).toBe(48)
    // 锚点 = t0 + 2 周期（不是 at！）——若写成 at，下次的零头就没了
    expect(Date.parse(state.lastDecayAt) - Date.parse(t0)).toBe(6 * 60_000)
  })

  it('decayPet 不满一个周期什么都不动；锚点在未来（时钟回拨）重锚不减', () => {
    const s = { ...defaultPetState(t0), satiety: 50 }
    const a = decayPet(s, new Date(Date.parse(t0) + 60_000).toISOString(), 3 * 60_000)
    expect(a.dropped).toBe(0)
    expect(a.state).toBe(s) // 原样返回，不算新对象
    const future = new Date(Date.parse(t0) + 60 * 60_000).toISOString()
    const b = decayPet(s, t0, 3 * 60_000)
    expect(b.state.lastDecayAt).toBe(t0)
    // 锚点在未来的那一种：重锚到 now，不扣
    const s2 = { ...s, lastDecayAt: future }
    const c = decayPet(s2, t0, 3 * 60_000)
    expect(c.dropped).toBe(0)
    expect(c.state.lastDecayAt).toBe(t0)
  })

  it('decayPet floor（V2-21 离线下限）：跌破时停在 floor，dropped 报实际掉了多少', () => {
    const s = { ...defaultPetState(t0), satiety: 100 }
    // 离线 24 小时 + 90 秒零头 = 240 个整周期（6min 周期），名义该扣 240
    const at = new Date(Date.parse(t0) + 24 * 60 * 60_000 + 90_000).toISOString()
    const { state, dropped } = decayPet(s, at, PET_DECAY_OFFLINE_PERIOD_MS, PET_OFFLINE_DECAY_FLOOR)
    expect(state.satiety).toBe(PET_OFFLINE_DECAY_FLOOR) // 100 → 20，不是 0
    expect(dropped).toBe(100 - PET_OFFLINE_DECAY_FLOOR) // 实际掉了 80，不是名义 240
    // 锚点照推进（时间确实过去了）：旧锚 + 240 个整周期，90 秒零头仍留在锚里
    expect(Date.parse(state.lastDecayAt) - Date.parse(t0)).toBe(240 * PET_DECAY_OFFLINE_PERIOD_MS)
    // 尺子自证：同一份输入不传 floor（在线默认）必须掉到 0 —— 是下限在起作用，
    // 不是种子/周期凑巧。两条都要真，否则这个 describe 恒绿。
    const noFloor = decayPet(s, at, PET_DECAY_OFFLINE_PERIOD_MS)
    expect(noFloor.state.satiety).toBe(0)
    expect(noFloor.dropped).toBe(100)
  })

  it('decayPet floor 不反向：本来就低于 floor 的状态离线期间原地不动，不许被"拉回"', () => {
    // 0 档关的软件（比如一直挂着被看饿的）：离线一天也不许凭空涨回 20 —— 那是喂饭的活儿
    const s = { ...defaultPetState(t0), satiety: 5 }
    const at = new Date(Date.parse(t0) + 24 * 60 * 60_000).toISOString()
    const { state, dropped } = decayPet(s, at, PET_DECAY_OFFLINE_PERIOD_MS, PET_OFFLINE_DECAY_FLOOR)
    expect(state.satiety).toBe(5)
    expect(dropped).toBe(0)
    expect(state.lastDecayAt).not.toBe(t0) // 锚点照推进
    // 对比：同一起点不传 floor 会掉到 0（下限的"只设卡、不抬升"语义两向都钉住）
    expect(decayPet(s, at, PET_DECAY_OFFLINE_PERIOD_MS).state.satiety).toBe(0)
  })

  it('在线心跳走默认 floor=0：盯着它还不喂，0 档照样到得了（看得见的疏忽该饿扁就饿扁）', () => {
    const s = { ...defaultPetState(t0), satiety: 3 }
    const at = new Date(Date.parse(t0) + 10 * 60_000).toISOString() // 10min = 5 个在线周期
    const { state, dropped } = decayPet(s, at, PET_DECAY_ONLINE_PERIOD_MS)
    expect(state.satiety).toBe(0)
    expect(dropped).toBe(3)
  })

  it('喂饭：饭盒空 → reason empty；吃饱了拒喂（reason full，饭不凭空蒸发）；正常一碗 +20 封顶 100', () => {
    // 饭盒空：拒，原样返回（同引用 —— 调用方靠 next !== prev 判要不要落盘）
    const empty = { ...defaultPetState(t0), rice: 0 }
    const r1 = feedPet(empty)
    expect(r1.ok).toBe(false)
    expect(r1.reason).toBe('empty')
    expect(r1.state).toBe(empty)
    // 已经吃饱：拒，且**饭盒不动**（允许喂 = rice 扣了、satiety 没涨，玩家看到"喂了没反应"）
    const fullStomach = { ...defaultPetState(t0), rice: 2, satiety: 100 }
    const r2 = feedPet(fullStomach)
    expect(r2.ok).toBe(false)
    expect(r2.reason).toBe('full')
    expect(r2.state).toBe(fullStomach)
    expect(r2.state.rice).toBe(2)
    // 两种"喂不进"必须可区分：调用方要各出一句不同的台词
    expect(r1.reason).not.toBe(r2.reason)
    // 正常喂：扣 1 碗、+20 封顶 100、fedTotal +1（这一路才产生新状态）
    const hungry = { ...defaultPetState(t0), rice: 1, satiety: 95 }
    const r3 = feedPet(hungry)
    expect(r3.ok).toBe(true)
    expect(r3.reason).toBe('ok')
    expect(r3.state).not.toBe(hungry)
    expect(r3.state.rice).toBe(0)
    expect(r3.state.satiety).toBe(100) // 95+20 封顶
    expect(r3.state.fedTotal).toBe(1)
  })

  it('发奖按 kind 走表，大白饭封顶 999（V1-46：摸头不再发饭，本表只测学习奖）', () => {
    const s = { ...defaultPetState(t0), rice: 998 }
    expect(grantPetRice(s, 'lesson', t0).state.rice).toBe(999) // 2 碗封顶
    expect(grantPetRice(s, 'review', t0).gained).toBe(2)
    expect(grantPetRice(s, 'answer', t0).gained).toBe(1)
    // V1-42 / 空转[1]：credited = **真进盒**的碗数（998+2 只进 1 碗、满仓进 0 碗），
    // gained 保持名义值 —— earnedTotal（终生功劳簿）不因装不下打折
    expect(grantPetRice(s, 'lesson', t0).credited).toBe(1)
    expect(grantPetRice({ ...defaultPetState(t0), rice: 997 }, 'lesson', t0).credited).toBe(2)
    const full = grantPetRice({ ...defaultPetState(t0), rice: PET_RICE_MAX }, 'lesson', t0)
    expect(full.credited).toBe(0)
    expect(full.state.rice).toBe(PET_RICE_MAX)
    expect(full.state.earnedTotal).toBe(2) // 名义功劳照记
    // 签到（P3 ①）：固定 2 碗、连签不递增 —— 递增会把"漏一天"的代价
    // 变成复利（见 PET_CHECKIN_RICE 的注释），所以这儿钉死它没有随天数变化的参数
    expect(PET_CHECKIN_RICE).toBe(2)
    expect(PET_REWARD_RICE.checkin).toBe(PET_CHECKIN_RICE)
    expect(grantPetRice(s, 'checkin', t0).gained).toBe(PET_CHECKIN_RICE)
    expect(grantPetRice({ ...defaultPetState(t0), rice: 0 }, 'checkin', t0).state.rice).toBe(2)
  })

  it('V1-42 日上限：到额度的这笔不扣不加 + capped；满仓那几笔不占额度；跨日重置；按 kind 独立', () => {
    // checkin 当日额度 = 1：第一笔进账，第二笔起被闸拦下（原样返回 —— 同引用可判 no-op）
    const day1 = { ...defaultPetState(t0), rice: 0 }
    const a = grantPetRice(day1, 'checkin', t0)
    expect(a.capped).toBe(false)
    expect(a.state.rice).toBe(PET_CHECKIN_RICE)
    const b = grantPetRice(a.state, 'checkin', t0)
    expect(b.capped).toBe(true)
    expect(b.state).toBe(a.state) // 不扣不加：引用原样
    expect(b.gained).toBe(PET_CHECKIN_RICE) // 名义值照回（调用方要说"今天赚满了"）
    expect(b.credited).toBe(0)
    // 满仓那几笔不占额度（credited=0 不计数）：回到"装不下"而不是"今天赚满"
    const f = grantPetRice({ ...defaultPetState(t0), rice: PET_RICE_MAX }, 'checkin', t0)
    expect(f.capped).toBe(false)
    expect(f.credited).toBe(0)
    // 跨日重置：明天再来一笔照发
    const t1 = local(2026, 10, 7, 12)
    expect(grantPetRice(a.state, 'checkin', t1).state.rice).toBe(PET_CHECKIN_RICE * 2)
    // 额度按 kind 独立：同一天 answer 不受 checkin 用掉额度的影响
    expect(grantPetRice(a.state, 'answer', t0).state.rice).toBe(
      PET_CHECKIN_RICE + PET_REWARD_RICE.answer
    )
    // 表本身（冻结口径，改数先红这里）：四类齐、签到是最紧的那格
    expect(Object.keys(PET_RICE_DAILY_CAPS).sort()).toEqual(['answer', 'checkin', 'lesson', 'review'])
    expect(PET_RICE_DAILY_CAPS.checkin).toBe(1)
    expect(PET_RICE_DAILY_CAPS.lesson).toBe(10)
    expect(PET_RICE_DAILY_CAPS.review).toBe(4)
    expect(PET_RICE_DAILY_CAPS.answer).toBe(40)
  })

  it('setPetMode / setPetSize / setPetPos / withPetEnabled 都是纯替换', () => {
    const s = defaultPetState(t0)
    expect(setPetMode(s, 'still').mode).toBe('still')
    expect(setPetPos(s, 2, -1).x).toBe(1) // 钳 0..1
    expect(setPetPos(s, 2, -1).y).toBe(0)
    expect(withPetEnabled(s, false).enabled).toBe(false)
    // 体型：换档返回新状态、原对象一字节不动（主人可随手来回调，别把旧引用改脏）
    const big = setPetSize(s, 306)
    expect(big.size).toBe(306)
    expect(s.size).toBe(PET_SIZE_DEFAULT)
    expect(big).not.toBe(s)
    // 快照要把 size 带出去（宠物窗换素材、设置卡显示选中态都靠它）
    expect(snapshotOf(big, t0).size).toBe(306)
    expect(snapshotOf(s, t0).size).toBe(PET_SIZE_DEFAULT)
  })
})

describe('exertPet：干活扣饱食度，夹在 0 以上', () => {
  const t0 = local(2026, 10, 6, 12)

  it('cost 非正原样返回（同引用）：没干活就不产生新状态，调用方不必落盘', () => {
    const s = { ...defaultPetState(t0), satiety: 50 }
    expect(exertPet(s, 0)).toBe(s)
    expect(exertPet(s, -3)).toBe(s)
  })

  it('扣不落负：3 点体力干 5 点的活 → 0（不是 -2）；已经饿扁（0）照旧不动', () => {
    expect(exertPet({ ...defaultPetState(t0), satiety: 3 }, 5).satiety).toBe(0)
    const flat = { ...defaultPetState(t0), satiety: 0 }
    expect(exertPet(flat, 5)).toBe(flat)
  })

  it('cost 四舍五入：2.4 → 扣 2（PET_CHAT_COST=2 这种整数照扣）', () => {
    const s = { ...defaultPetState(t0), satiety: 50 }
    expect(exertPet(s, 2.4).satiety).toBe(48)
    expect(exertPet(s, 2).satiety).toBe(48)
  })
})

describe('运行奖：grantRunReward 的指纹去重 / 日上限 / 环容量', () => {
  const day1 = local(2026, 10, 6, 12)
  const day2 = local(2026, 10, 7, 12)
  /** 形状合法的假指纹（= shared/code-hash 的产出形状） */
  const fp = (n: number): string => `2:${n.toString(16)}`

  it('首发：granted true、rice/earnedTotal +1、账本当天起算 count=1、指纹进表', () => {
    const s = { ...defaultPetState(day1), rice: 2, earnedTotal: 5 }
    const r = grantRunReward(s, '2:1a2b3c4d', day1)
    expect(r.granted).toBe(true)
    expect(r.state).not.toBe(s) // 发奖必须产生新状态（调用方据此落盘）
    expect(r.state.rice).toBe(3) // +PET_RUN_REWARD_RICE（=1）
    expect(r.state.earnedTotal).toBe(6)
    expect(r.state.runLedger).toEqual({ day: petDayKey(day1), count: 1, hashes: ['2:1a2b3c4d'] })
  })

  it('同一指纹再跑：granted false 且原样返回（state 同引用 = 没领过的才算数）', () => {
    const s = defaultPetState(day1)
    const first = grantRunReward(s, '2:1a2b3c4d', day1)
    const again = grantRunReward(first.state, '2:1a2b3c4d', day1)
    expect(again.granted).toBe(false)
    expect(again.state).toBe(first.state)
    expect(again.state.rice).toBe(1) // 第二碗没发出去
    expect(again.state.runLedger.count).toBe(1)
  })

  it('日上限：当日 10 条不同指纹发满后，第 11 条新指纹也拒（count 不再涨）', () => {
    let s = defaultPetState(day1)
    for (let i = 0; i < PET_RUN_REWARD_DAILY_MAX; i++) {
      const r = grantRunReward(s, fp(i + 1), day1)
      expect(r.granted).toBe(true)
      s = r.state
    }
    expect(s.runLedger.count).toBe(PET_RUN_REWARD_DAILY_MAX)
    expect(s.rice).toBe(PET_RUN_REWARD_DAILY_MAX) // 10 条 = 10 碗整
    // 第 11 条**没见过**的指纹：不是去重拦的，是日上限拦的
    const over = grantRunReward(s, '2:ff', day1)
    expect(over.granted).toBe(false)
    expect(over.state).toBe(s)
    expect(over.state.runLedger.count).toBe(PET_RUN_REWARD_DAILY_MAX)
  })

  it('跨天：count 归零（昨天顶格、今天照发第一条新代码）；昨天用过的指纹仍拒（hashes 跨天保留）', () => {
    let s = defaultPetState(day1)
    for (let i = 0; i < PET_RUN_REWARD_DAILY_MAX; i++) s = grantRunReward(s, fp(i + 1), day1).state
    // 新的一天：count 若没归零，这里会被日上限误拒
    const r = grantRunReward(s, fp(100), day2)
    expect(r.granted).toBe(true)
    expect(r.state.runLedger.day).toBe(petDayKey(day2))
    expect(r.state.runLedger.count).toBe(1)
    // 同一份作业不因跨天重新可领
    const again = grantRunReward(r.state, fp(1), day2)
    expect(again.granted).toBe(false)
    expect(again.state).toBe(r.state)
    expect(again.state.runLedger.hashes).toContain(fp(1)) // 指纹表跨天不归零
  })

  it('垃圾指纹一律拒、同引用：没有可信证据就不发饭（绝不默认回退为成功）', () => {
    const s = { ...defaultPetState(day1), rice: 5 }
    const bads: unknown[] = [
      '', // 空串
      'abc', // 没有冒号
      'zz:zz', // 冒号右边不是十六进制
      '12:XYZ', // 大写
      123, // 非字符串
      null,
      undefined,
      '2:1a2b3c4d5e6f', // 哈希段超 8 位
      '12345678901:1a' // 长度段超 10 位
    ]
    for (const bad of bads) {
      const r = grantRunReward(s, bad as string, day1)
      expect(r.granted, `fingerprint=${String(bad)} 不该发奖`).toBe(false)
      expect(r.state).toBe(s)
    }
    expect(s.rice).toBe(5) // 一碗都没发出去
    expect(s.runLedger.count).toBe(0)
  })

  it(`指纹环满员（${PET_RUN_LEDGER_MAX} 条）再发：最老的被挤出、新指纹进尾部、长度恒 ${PET_RUN_LEDGER_MAX}`, () => {
    const seeded = Array.from({ length: PET_RUN_LEDGER_MAX }, (_, i) => fp(i))
    const s = {
      ...defaultPetState(day1),
      runLedger: { day: petDayKey(day1), count: 0, hashes: seeded }
    }
    const r = grantRunReward(s, '3:ffffffff', day1)
    expect(r.granted).toBe(true)
    expect(r.state.runLedger.hashes.length).toBe(PET_RUN_LEDGER_MAX)
    expect(r.state.runLedger.hashes[0]).toBe(seeded[1]) // 最老的 seeded[0] 被挤掉
    expect(r.state.runLedger.hashes).not.toContain(seeded[0])
    expect(r.state.runLedger.hashes[PET_RUN_LEDGER_MAX - 1]).toBe('3:ffffffff') // 新指纹在尾部
  })
})

describe('运行奖：normalizePetRunLedger 读口清洗与 runRewardsToday 快照', () => {
  const now = local(2026, 10, 6, 12)

  it('非对象 → 默认账：day 用传入时刻的日键、count 0、空表（不抛）', () => {
    for (const bad of [undefined, null, 'x', 42, [1, 2], true]) {
      expect(normalizePetRunLedger(bad, now)).toEqual({ day: petDayKey(now), count: 0, hashes: [] })
    }
  })

  it('day 只认 YYYY-MM-DD 形状：坏的回今天的日键，合法的原样保留（昨天就是昨天）', () => {
    for (const bad of ['', 'yesterday', '2026/10/06', '2026-10-6', 20261006, null]) {
      expect(
        normalizePetRunLedger({ day: bad, count: 3 }, now).day,
        `day=${String(bad)} 不该被认下`
      ).toBe(petDayKey(now))
    }
    expect(normalizePetRunLedger({ day: '2026-10-05', count: 3 }, now).day).toBe('2026-10-05')
  })

  it('count 逐种钳位：NaN/Infinity/负数 → 0，超大 → 100000，小数四舍五入', () => {
    expect(normalizePetRunLedger({ count: Number.NaN }, now).count).toBe(0)
    expect(normalizePetRunLedger({ count: Number.POSITIVE_INFINITY }, now).count).toBe(0)
    expect(normalizePetRunLedger({ count: -5 }, now).count).toBe(0)
    expect(normalizePetRunLedger({ count: 1e9 }, now).count).toBe(100_000)
    expect(normalizePetRunLedger({ count: 3.6 }, now).count).toBe(4)
  })

  it('hashes 逐条丢坏留好（不是整表作废）：非串 / 坏形状进不来，好指纹原样留', () => {
    const raw = {
      day: petDayKey(now),
      count: 2,
      hashes: ['2:1a2b', 42, 'bad!', { x: 1 }, 'no-colon', '12:XYZ', '2:gg', '3:ff', null, '']
    }
    expect(normalizePetRunLedger(raw, now).hashes).toEqual(['2:1a2b', '3:ff'])
  })

  it(`hashes 容量截断到 ${PET_RUN_LEDGER_MAX}：丢最老的、留尾部；count 不被表影响`, () => {
    const many = Array.from({ length: PET_RUN_LEDGER_MAX + 5 }, (_, i) => `2:${(i + 1).toString(16)}`)
    const s = normalizePetRunLedger({ day: petDayKey(now), count: 3, hashes: many }, now)
    expect(s.hashes.length).toBe(PET_RUN_LEDGER_MAX)
    expect(s.hashes).toEqual(many.slice(-PET_RUN_LEDGER_MAX))
    expect(s.count).toBe(3)
  })

  it('snapshotOf 的 runRewardsToday：账本是今天就报 count、是昨天就报 0', () => {
    const today = {
      ...defaultPetState(now),
      runLedger: { day: petDayKey(now), count: 7, hashes: [] }
    }
    expect(snapshotOf(today, now).runRewardsToday).toBe(7)
    expect(snapshotOf(today, local(2026, 10, 7, 12)).runRewardsToday).toBe(0) // 跨天读作 0
    expect(snapshotOf(defaultPetState(now), now).runRewardsToday).toBe(0)
  })
})

describe('IPC 入参清洗（parsePetAction / parsePetHitRects / normalizeRunReport）', () => {
  it('parsePetAction：简单动作过、白名单外的落 null', () => {
    for (const a of ['feed', 'pat', 'show', 'hide', 'menu', 'chat', 'rua']) {
      expect(parsePetAction({ action: a })).toEqual({ action: a })
    }
    expect(parsePetAction({ action: 'explode' })).toBe(null)
    expect(parsePetAction(null)).toBe(null)
    expect(parsePetAction({ action: 'grant', reward: 'gold' })).toBe(null)
    expect(parsePetAction({ action: 'grant', reward: 'lesson' })).toEqual({
      action: 'grant',
      reward: 'lesson'
    })
    // 签到也在奖励白名单里（P3 ①）：不在的话主进程发的 grant 载荷
    // 会在解析这一关被丢掉 —— 症状是"签到成功但饭永远到不了"
    expect(parsePetAction({ action: 'grant', reward: 'checkin' })).toEqual({
      action: 'grant',
      reward: 'checkin'
    })
    expect(parsePetAction({ action: 'mode', mode: 'fly' })).toBe(null)
    expect(parsePetAction({ action: 'mode', mode: 'follow' })).toEqual({ action: 'mode', mode: 'follow' })
    // size 走同一个白名单守卫：三档之一才收，250 这种"数值合法但没素材"的不收
    expect(parsePetAction({ action: 'size', size: 238 })).toEqual({ action: 'size', size: 238 })
    expect(parsePetAction({ action: 'size', size: 250 })).toBe(null)
    expect(parsePetAction({ action: 'size', size: '238' })).toBe(null)
    expect(parsePetAction({ action: 'size' })).toBe(null)
  })

  it('parsePetAction 的 wrong：课名/顺序是装饰，洗坏一个不许把整条上报毙掉（答错了鱼必须吭声）', () => {
    expect(parsePetAction({ action: 'wrong', title: '  指针  ', order: 12, learned: true })).toEqual({
      action: 'wrong',
      title: '指针',
      order: 12,
      learned: true
    })
    // title 非串 / 空串 → null；order 越界 / 非整数 → null；learned 非 true → false
    expect(parsePetAction({ action: 'wrong', title: 7, order: 0, learned: 'yes' })).toEqual({
      action: 'wrong',
      title: null,
      order: null,
      learned: false
    })
    expect(parsePetAction({ action: 'wrong', title: '   ', order: 1000, learned: true })).toEqual({
      action: 'wrong',
      title: null,
      order: null,
      learned: true
    })
    // 超长课名截到 60（防注入一串巨大文本进记忆环的气泡）
    const long = parsePetAction({ action: 'wrong', title: 'x'.repeat(200), order: 1, learned: false })
    expect((long as { title: string }).title.length).toBe(60)
  })

  it('parsePetAction 的 pos：两个有限数才收，否则整条作废', () => {
    expect(parsePetAction({ action: 'pos', x: 0.2, y: 0.8 })).toEqual({ action: 'pos', x: 0.2, y: 0.8 })
    expect(parsePetAction({ action: 'pos', x: Number.NaN, y: 0.5 })).toBe(null)
    expect(parsePetAction({ action: 'pos', x: '0.5', y: 0.5 })).toBe(null)
  })

  it('parsePetHitRects：空数组合法（动画中间没东西可点）；非法整条 null；上限 8', () => {
    expect(parsePetHitRects([])).toEqual([])
    expect(parsePetHitRects([{ x: 1, y: 2, w: 3, h: 4 }])).toEqual([{ x: 1, y: 2, w: 3, h: 4 }])
    expect(parsePetHitRects([{ x: 1, y: 2, w: 0, h: 4 }])).toBe(null) // 零宽
    expect(parsePetHitRects([{ x: 1, y: 2, w: 3 }])).toBe(null)
    expect(parsePetHitRects({})).toBe(null)
    expect(parsePetHitRects(Array.from({ length: 9 }, () => ({ x: 0, y: 0, w: 1, h: 1 })))).toBe(null)
  })

  it('normalizeRunReport：没有 ok 布尔的上报整条丢（补出来的"失败"会把鱼叫到屏幕中央说错话）', () => {
    expect(normalizeRunReport(null)).toBe(null)
    expect(normalizeRunReport({ kind: 'compile' })).toBe(null)
    // 老渲染层不发 own/hash → 洗成"没证据"（own:false / hash:null），其余字段照洗
    expect(normalizeRunReport({ ok: false, kind: 'compile', line: 3, rect: null })).toEqual({
      ok: false,
      kind: 'compile',
      line: 3,
      rect: null,
      own: false,
      hash: null
    })
    // kind 不认识 → 'other'；line 非法 → null；rect 宽高非正 → null（老字段清洗行为不变）
    expect(normalizeRunReport({ ok: true, kind: 'wat', line: 0, rect: { x: 0, y: 0, width: 0, height: 10 } })).toEqual({
      ok: true,
      kind: 'other',
      line: null,
      rect: null,
      own: false,
      hash: null
    })
  })

  it('normalizeRunReport 的 own/hash 是发奖证据：形状不对当"没证据"，但不毙整条上报', () => {
    const base = { ok: true, kind: 'run', line: 1, rect: null }
    // own 只有真布尔 true 才算"他自己写的"（缺省 false = 没证据 = 不发奖）
    expect(normalizeRunReport({ ...base, own: true, hash: '3:1a2b3c4d' })).toEqual({
      ok: true,
      kind: 'run',
      line: 1,
      rect: null,
      own: true,
      hash: '3:1a2b3c4d'
    })
    for (const badOwn of [undefined, false, 'yes', 1, 0, null]) {
      const r = normalizeRunReport({ ...base, own: badOwn })
      // 先钉"清洗没把整条毙掉"，再看字段 —— 直接 ?.own 在返回 null 时
      // 变成 undefined ≠ false 也算红，但红在"字段不对"上，指错了方向
      expect(r, `own=${String(badOwn)} 时不该整条作废`).not.toBeNull()
      expect(r?.own, `own=${String(badOwn)} 不算证据`).toBe(false)
    }
    // hash 形状不对 → null：没冒号 / 非串 / 大写 hex / 哈希段超长 / 长度段超长 / 一串纯文本
    for (const badHash of ['abc', 42, '12:XYZ', '2:1a2b3c4d5e6f', '12345678901:1a', 'a'.repeat(200)]) {
      const r = normalizeRunReport({ ...base, hash: badHash })
      expect(r, `hash=${String(badHash)} 时不该整条作废`).not.toBeNull()
      expect(r?.hash, `hash=${String(badHash)} 不该被认下`).toBe(null)
    }
    // 证据缺失只影响发不发奖：报错跑腿的字段不受牵连（整条不被毙）
    expect(
      normalizeRunReport({
        ok: false,
        kind: 'compile',
        line: 7,
        rect: { x: 1, y: 2, width: 3, height: 4 },
        own: 'yes',
        hash: 'bad'
      })
    ).toEqual({
      ok: false,
      kind: 'compile',
      line: 7,
      rect: { x: 1, y: 2, width: 3, height: 4 },
      own: false,
      hash: null
    })
  })
})

// ════════════════════════════════════════════════════════════ 好感度（P3 ④）

describe('好感度：计分表与档界常量（拍板值钉死）', () => {
  it('计分表逐项对账：delta 正负与日上限', () => {
    // 拍板表（契约 §2）：喂+2/3、摸+1/5、学习+2/6、挑战+3/1、复习满分+5/1、
    // 签到+1/1、错题-1/3、挨饿-2/1、久离-5/1。逐项写死是有意的 ——
    // 改表必须同时改这里，改完两边一起红才叫"看得见"
    expect(PET_AFFECTION_RULES).toEqual({
      feed: { delta: 2, cap: 3 },
      pat: { delta: 1, cap: 5 },
      study: { delta: 2, cap: 6 },
      challenge: { delta: 3, cap: 1 },
      review: { delta: 5, cap: 1 },
      checkin: { delta: 1, cap: 1 },
      wrong: { delta: -1, cap: 3 },
      starving: { delta: -2, cap: 1 },
      'long-away': { delta: -5, cap: 1 }
    })
    expect(PET_AFFECTION_INITIAL).toBe(50)
    expect(PET_AFFECTION_MAX).toBe(100)
    expect(PET_AFFECTION_DECAY_PERIOD_MS).toBe(24 * 60 * 60_000)
  })

  it('档界值逐点：20/40/60/80（闭下界；尺子自证：每个边界两侧必须不同档）', () => {
    const points: [number, string][] = [
      [0, 'cold'],
      [19, 'cold'],
      [20, 'familiar'],
      [39, 'familiar'],
      [40, 'close'],
      [59, 'close'],
      [60, 'like'],
      [79, 'like'],
      [80, 'love'],
      [100, 'love']
    ]
    for (const [v, tier] of points) expect(petAffectionTier(v), `${v}`).toBe(tier)
    // 尺子自证：四个边界各自两侧必须给出不同档（写成一个恒等函数也想过？没门）
    for (const b of [
      PET_AFFECTION_FAMILIAR_AT,
      PET_AFFECTION_CLOSE_AT,
      PET_AFFECTION_LIKE_AT,
      PET_AFFECTION_LOVE_AT
    ]) {
      expect(petAffectionTier(b), `界 ${b} 与 ${b - 1} 必须不同档`).not.toBe(petAffectionTier(b - 1))
    }
    // 五档名清单与 shared/pet.ts 的顺序表一致（brain 的跨档方向按它取 indexOf）
    expect(PET_AFFECTION_TIERS).toEqual(['cold', 'familiar', 'close', 'like', 'love'])
  })

  it('★ 不复用 mood 的 66/33：66 是 like、33 是 familiar（两套档界并存不合并）', () => {
    expect(petAffectionTier(66)).toBe('like')
    expect(petAffectionTier(33)).toBe('familiar')
  })

  it('NaN / 负数是 cold 方向（判定不出"亲"就当不亲）；+Infinity 是 love 方向（同饥饿档的判定方向）', () => {
    for (const bad of [Number.NaN, Number.NEGATIVE_INFINITY, -5]) {
      expect(petAffectionTier(bad), `affection=${String(bad)}`).toBe('cold')
    }
    expect(petAffectionTier(Number.POSITIVE_INFINITY)).toBe('love')
  })
})

describe('好感度：addAffection 的三道闸', () => {
  const t0 = local(2026, 10, 6, 12)

  it('加分：喂饭 +2 并计数；钳制后 delta 记的是**实际变化**（99 + 2 → 100, delta 1）', () => {
    const s = defaultPetState(t0)
    expect(s.affection).toBe(PET_AFFECTION_INITIAL)
    const r = addAffection(s, 'feed', t0)
    expect(r.applied).toBe(true)
    expect(r.delta).toBe(2)
    expect(r.state.affection).toBe(52)
    expect(r.state.affectionDay).toEqual({ day: petDayKey(t0), counts: { feed: 1 } })
    // 顶格钳制：99 + 2 → 100，delta 1（不是 2 —— 调用方拿它做日志/跨档判断）
    const top = addAffection({ ...s, affection: 99 }, 'feed', t0)
    expect(top.state.affection).toBe(100)
    expect(top.delta).toBe(1)
    expect(top.applied).toBe(true)
  })

  it('减分：错题 -1；钳底后 0 - 1 → 0, delta 0 但 **applied 仍真**（事件确实发生了，要计数）', () => {
    const s = defaultPetState(t0)
    const r = addAffection(s, 'wrong', t0)
    expect(r.state.affection).toBe(49)
    expect(r.delta).toBe(-1)
    const bottom = addAffection({ ...s, affection: 0 }, 'wrong', t0)
    expect(bottom.state.affection).toBe(0)
    expect(bottom.delta).toBe(0)
    expect(bottom.applied).toBe(true)
    // 计数照记（它记的是"发生了几次"）：否则 0 分时错题不计数，
    // 回血后再错就能多刷一次 -1
    expect(bottom.state.affectionDay.counts.wrong).toBe(1)
  })

  it('★ 日上限第 cap+1 次 no-op：原样返回（同引用）+ applied false + delta 0，计数不再涨', () => {
    let s = defaultPetState(t0)
    for (let i = 1; i <= 3; i++) {
      const r = addAffection(s, 'feed', t0)
      expect(r.applied, `第 ${i} 次应当计入`).toBe(true)
      s = r.state
    }
    expect(s.affection).toBe(56) // 50 + 2*3
    expect(s.affectionDay.counts.feed).toBe(3)
    const fourth = addAffection(s, 'feed', t0)
    expect(fourth.applied).toBe(false)
    expect(fourth.state).toBe(s) // 同一引用：调用方靠它判"要不要落盘/播报"
    expect(fourth.delta).toBe(0)
    expect(fourth.state.affectionDay.counts.feed).toBe(3)
    // 尺子自证：同样第 4 次的位置，摸头（cap 5）还应当计得进去 ——
    // 若上面那条 no-op 是"所有 kind 一视同仁地停"（拿错 kind 的白名单），这里会红
    expect(addAffection(s, 'pat', t0).applied).toBe(true)
  })

  it('跨日重置：今天计满，明天同 kind 重新计（day 键换了 → 空账重开）', () => {
    const t1 = local(2026, 10, 7, 9)
    let s = defaultPetState(t0)
    for (let i = 0; i < 3; i++) s = addAffection(s, 'feed', t0).state
    expect(addAffection(s, 'feed', t0).applied).toBe(false)
    const tomorrow = addAffection(s, 'feed', t1)
    expect(tomorrow.applied).toBe(true)
    expect(tomorrow.state.affectionDay).toEqual({ day: petDayKey(t1), counts: { feed: 1 } })
    // 跨日重置只清计数，不动分数
    expect(tomorrow.state.affection).toBe(s.affection + 2)
  })

  it('事件不重置衰减锚点：addAffection 之后 lastAffectionAt 一个字节不动', () => {
    const s = defaultPetState(t0)
    const r = addAffection(s, 'study', t0)
    expect(r.state.lastAffectionAt).toBe(s.lastAffectionAt)
    expect(r.state.lastAffectionAt).toBe(Date.parse(t0))
  })
})

describe('好感度：decayAffection 的锚点法', () => {
  const t0 = local(2026, 10, 6, 12)
  const DAY = PET_AFFECTION_DECAY_PERIOD_MS

  it('★ 跨 3 天恰扣 3 次 -1：零头原地留着（锚点 = t0 + 3 天，不是 now）', () => {
    const s = defaultPetState(t0)
    // 3 天 + 5 小时：3 个整周期 + 5 小时零头
    const at = new Date(Date.parse(t0) + 3 * DAY + 5 * 60 * 60_000).toISOString()
    const { state, dropped } = decayAffection(s, at)
    expect(dropped).toBe(3)
    expect(state.affection).toBe(PET_AFFECTION_INITIAL - 3)
    expect(state.lastAffectionAt - Date.parse(t0)).toBe(3 * DAY)
  })

  it('不满一天什么都不动（同引用）；锚点在未来（时钟回拨）重锚到 now、不扣', () => {
    const s = defaultPetState(t0)
    const early = decayAffection(s, new Date(Date.parse(t0) + 23 * 60 * 60_000).toISOString())
    expect(early.dropped).toBe(0)
    expect(early.state).toBe(s) // 原样返回
    const future = new Date(Date.parse(t0) + 10 * DAY).toISOString()
    const back = decayAffection({ ...s, lastAffectionAt: Date.parse(future) }, t0)
    expect(back.dropped).toBe(0)
    expect(back.state.lastAffectionAt).toBe(Date.parse(t0))
    expect(back.state.affection).toBe(PET_AFFECTION_INITIAL)
  })

  it('下限 0：分数不够扣时 dropped 只有实际扣掉的量，但锚点仍按整周期推进', () => {
    const s = { ...defaultPetState(t0), affection: 2 }
    const at = new Date(Date.parse(t0) + 5 * DAY + 60_000).toISOString()
    const { state, dropped } = decayAffection(s, at)
    expect(dropped).toBe(2) // min(2, 5)
    expect(state.affection).toBe(0)
    // 锚点照走 5 个周期：否则"停在 0 这几天"会被攒成 5 次欠债，
    // 回血的第一天立刻又被连扣
    expect(state.lastAffectionAt - Date.parse(t0)).toBe(5 * DAY)
  })

  it('时刻编不出来（now 非法）原样返回，不抛不扣', () => {
    const s = defaultPetState(t0)
    const r = decayAffection(s, 'not-a-date')
    expect(r.state).toBe(s)
    expect(r.dropped).toBe(0)
  })
})

describe('好感度：normalize 读口（v4 → v5 迁移与坏值清洗）', () => {
  const now = local(2026, 10, 6, 12)

  it('v4 老文件（没有 affection 三件套）→ 50 分起步、锚到当下、空账（不清零历史）', () => {
    const v4 = { ...defaultPetState(now) } as Record<string, unknown>
    delete v4.affection
    delete v4.lastAffectionAt
    delete v4.affectionDay
    const s = normalizePetState(v4, now)
    expect(s.version).toBe(PET_VERSION)
    expect(s.affection).toBe(PET_AFFECTION_INITIAL)
    expect(s.lastAffectionAt).toBe(Date.parse(now))
    expect(s.affectionDay).toEqual({ day: petDayKey(now), counts: {} })
  })

  it('坏值回默认、不吃回声：NaN/串回落 50、越界钳 0..100', () => {
    const base = defaultPetState(now) as unknown as Record<string, unknown>
    expect(normalizePetState({ ...base, affection: Number.NaN }, now).affection).toBe(
      PET_AFFECTION_INITIAL
    )
    expect(normalizePetState({ ...base, affection: '80' }, now).affection).toBe(
      PET_AFFECTION_INITIAL
    )
    expect(normalizePetState({ ...base, affection: 250 }, now).affection).toBe(PET_AFFECTION_MAX)
    expect(normalizePetState({ ...base, affection: -3 }, now).affection).toBe(0)
    expect(normalizePetState({ ...base, lastAffectionAt: 'x' }, now).lastAffectionAt).toBe(
      Date.parse(now)
    )
  })

  it('affectionDay 条目级过滤：白名单外的 kind 丢、合法条目留、day 非法回今天', () => {
    const s = normalizePetState(
      {
        affectionDay: {
          day: '2026-10-05',
          counts: { feed: 2, gossip: 9, wrong: -1, pat: 1.4 }
        }
      },
      now
    )
    // day 合法就原样保留（昨天就是昨天），垃圾 day 才回今天
    expect(s.affectionDay.day).toBe('2026-10-05')
    // 未知 kind 丢；负数丢（n>0 才留）；小数四舍五入收下
    expect(s.affectionDay.counts).toEqual({ feed: 2, pat: 1 })
    expect(normalizePetState({ affectionDay: { day: 'x', counts: {} } }, now).affectionDay.day).toBe(
      petDayKey(now)
    )
    // 尺度兜底：非对象 / null → 整份空账
    for (const bad of [null, 'x', 42, []]) {
      expect(normalizePetAffectionDay(bad, now)).toEqual(defaultPetAffectionDay(now))
    }
  })
})

describe('好感度：parsePetAction 的 event（challenge / review）', () => {
  it('两个合法 kind 过；缺失/白名单外/整条非对象 → null（没有"能没有"的装饰字段）', () => {
    expect(parsePetAction({ action: 'event', kind: 'challenge' })).toEqual({
      action: 'event',
      kind: 'challenge'
    })
    expect(parsePetAction({ action: 'event', kind: 'review' })).toEqual({
      action: 'event',
      kind: 'review'
    })
    for (const bad of [undefined, null, 'feed', 'challenge2', '', 42, {}]) {
      expect(parsePetAction({ action: 'event', kind: bad }), `kind=${String(bad)}`).toBe(null)
    }
    expect(parsePetAction({ action: 'event' })).toBe(null)
  })
})

