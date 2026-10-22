import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  HUNGRY_FACE_GAP_MS,
  NAG_GAP_MEDIUM_MS,
  NAG_GAP_MILD_MS,
  NAG_GAP_SEVERE_MS,
  NUZZLE_GAP_MS,
  PET_HEARTBEAT_MS,
  createPetBrain,
  type PetBrainDeps
} from '../dshpet/brain'
import { PET, PET_DSH } from '../../shared/copy'
import {
  decayPet,
  defaultPetMemory,
  defaultPetState,
  PET_AFFECTION_CLOSE_AT,
  PET_AFFECTION_DECAY_PERIOD_MS,
  PET_AFFECTION_FAMILIAR_AT,
  PET_AFFECTION_INITIAL,
  PET_AFFECTION_LIKE_AT,
  PET_AFFECTION_LOVE_AT,
  PET_AFFECTION_RULES,
  PET_CHASE_COOLDOWN_MS,
  PET_CHASE_COST,
  PET_CHAT_DAILY_MAX,
  PET_CHAT_DAILY_TOKENS,
  PET_DECAY_OFFLINE_PERIOD_MS,
  PET_DECAY_ONLINE_PERIOD_MS,
  PET_FEED_GAIN,
  PET_HUNGER_FULL_AT,
  PET_HUNGER_MEDIUM_AT,
  PET_HUNGER_MILD_AT,
  PET_HUNGER_SEVERE_AT,
  PET_MOOD_OK_AT,
  PET_OFFLINE_DECAY_FLOOR,
  PET_RICE_FULL_COOLDOWN_MS,
  PET_RICE_MAX,
  PET_RUN_REWARD_DAILY_MAX,
  petAffectionTier,
  petDayKey,
  petFace,
  petHungerTier,
  petMood,
  type PetState,
  type PetVitals
} from '../../shared/pet'
import { QUIP_POOL } from '../../shared/pet-quips'
import type { PetStore } from '../pet/store'

/**
 * 行为大脑（main/dshpet/brain.ts）的单测 —— 2026-10-06 从 v1（main/pet/index.ts，
 * 已退役）迁移的**每一条语义**在这里钉死：
 *
 *   互动冷却（喂/摸共享 1200ms；**摸头后紧跟的第一碗喂饭豁免** —— V1-45
 *   双击死带修复）· rua 4s 冷却 + 傲娇情绪 · 答错三档 + 30s 台词
 *   冷却 + 60s 记忆去重 · 表扬 90s 冷却 + run-ok 记忆 5min 去重 · 连学三课彩蛋
 *   · 出场问候四档选择 · 在线/离线两种衰减速率 + 锚点推进 · 饿嘟囔只说一次
 *   · CPU 连续两次过热的冒泡 · 久不动主动搭话（含"上次那道题"优先）·
 *   旧动作（pos/mode/…）不装执行。
 *
 * 【假什么、不假什么】store 是内存假货（落盘 = 往数组里推一份深拷贝，测试可查
 * "有没有真的存"）；时钟是受控的 now 注入；CPU 采样注入。**不假**的是 shared/pet.ts
 * 的纯函数与 copy.ts 的台词 —— 那些正是被测对象要消费的真源，假掉它们等于
 * 测了两个 mock 之间的对话。
 *
 * 【静态同源两道闸】
 *   ① PET_DSH.ANIM 的每个动画名必须逐字出现在包内 config.jsonc 里 —— 拼错
 *      一个字 = 点播静默变成"什么都没发生"，透明窗里看不出来；
 *   ② 补丁里的菜单标签（喂饭/摸头/聊天）必须与 PET.MENU 逐字一致 —— 菜单是
 *      build/dshpet-patch.mjs 写进 helper 的，两处各写一份就会漂。
 *   两者都带"必假反例"自证尺子能区分（防文件读空还全绿）。
 *
 * 【字符串纪律】本文件在 src/ 下：注释随便写中文，**字符串字面量**一律
 * 引用 copy.ts 常量或 ASCII（课名之类的测试数据用英文即可，与逻辑无关）。
 */

/** 北京时间某个时刻（显式 +08:00，不随测试机时区漂移） */
function bjMs(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  const p = (n: number): string => String(n).padStart(2, '0')
  return Date.parse(`${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(s)}+08:00`)
}

/** 北京时间中午 12:00 —— petFace 的时段判定（23:00–05:59 才是"困"）在白天档 */
const BASE_MS = bjMs(2026, 10, 6, 12, 0, 0)
/** 北京时间 23:30 —— 深夜档 */
const NIGHT_MS = bjMs(2026, 10, 6, 23, 30, 0)
const DAY_MS = 24 * 60 * 60_000
/** 测试用课名：内容与逻辑无关，ASCII 即可（避免在 src/ 下写中文字面量） */
const TITLE = 'Pointers'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const iso = (ms: number): string => new Date(ms).toISOString()

/** deps.chase 的假替身：记下每次出动的屏幕坐标，返回自增 seq（模拟宿主写 goto 叶子） */
function chaseStub(): { calls: [number, number][]; chase: (x: number, y: number) => number } {
  const calls: [number, number][] = []
  return {
    calls,
    chase: (x, y) => {
      calls.push([x, y])
      return 100 + calls.length
    }
  }
}

interface Harness {
  brain: ReturnType<typeof createPetBrain>
  /** meme 只在有值时出现（无配图的台词不带这个键，toEqual 的精确形状断言才稳） */
  says: { text: string; tag: string; meme?: string }[]
  /**
   * 场景池台词出口（P3 ④：目前唯一来源是好感跨档）。**与 says 分开记** ——
   * 跨档走的是 pet-quips 池子（宿主负责挑句子），混进 says 会让既有的
   * toEqual 精确形状断言全变假红，也分不清"哪条通道真的说过话"。
   */
  quips: { scene: string; tag?: string }[]
  anims: string[]
  logs: string[]
  saves: PetState[]
  setFocused: (v: boolean) => void
  advance: (ms: number) => void
  current: () => PetState
}

/**
 * 建一个受控大脑。seed 会叠在 defaultPetState（构造时刻的默认值）之上；
 * load 每次返回深拷贝（模拟"从磁盘读到的必然是新的对象树"）。
 */
function makeHarness(
  opts: {
    seed?: Partial<PetState>
    nowMs?: number
    focused?: boolean
    deps?: Partial<PetBrainDeps>
  } = {}
): Harness {
  const start = opts.nowMs ?? BASE_MS
  let clock = start
  const says: { text: string; tag: string; meme?: string }[] = []
  const quips: { scene: string; tag?: string }[] = []
  const anims: string[] = []
  const logs: string[] = []
  const saves: PetState[] = []
  let focused = opts.focused ?? false

  let disk: PetState = { ...defaultPetState(iso(start)), ...(opts.seed ?? {}) }
  const store: PetStore = {
    load: () => ({ state: clone(disk), created: false }),
    save: (s) => {
      const copy = clone(s)
      saves.push(copy)
      disk = copy
      return true
    }
  }

  const brain = createPetBrain({
    store,
    // meme 有值才记键：既有断言用的是 toEqual 精确形状（{text, tag}），
    // 多一个恒 undefined 的键会把它们全部变成假红
    say: (text, tag, meme) => says.push(meme === undefined ? { text, tag } : { text, tag, meme }),
    // 场景池出口（P3 ④）：必填依赖，假脑显式接上 —— 漏接的话"跨档没播"
    // 在测试里根本量不到（可选依赖静默跳过 = 假绿），所以它在 PetBrainDeps
    // 里是必填的，这里也必须给一个真记事的替身。
    quip: (scene, tag) => quips.push(tag === undefined ? { scene } : { scene, tag }),
    anim: (name) => anims.push(name),
    getMainFocused: () => focused,
    log: (line) => logs.push(line),
    now: () => clock,
    ...(opts.deps ?? {})
  })

  return {
    brain,
    says,
    quips,
    anims,
    logs,
    saves,
    setFocused: (v) => {
      focused = v
    },
    advance: (ms) => {
      clock += ms
    },
    current: () => disk
  }
}

// ---------------------------------------------------------------- 启动装载

describe('启动装载：离线衰减 + 见面时刻 + 问候锚点', () => {
  it('关着软件的那段按离线速率（-1/6min）扣，锚点按整周期推进（零头留在锚里）', () => {
    // 预期从 PET_DECAY_OFFLINE_PERIOD_MS 派生（P3 ③ 拍板把周期缩短过：
    // 拿字面量 10min 钉住的话，只改常量不改机制也会红得莫名其妙）
    const away = 30 * 60_000 + 90_000 // 关着 30 分 90 秒
    const periods = Math.floor(away / PET_DECAY_OFFLINE_PERIOD_MS)
    const h = makeHarness({
      seed: {
        satiety: 100,
        lastDecayAt: iso(BASE_MS - away)
      }
    })
    // 只按整周期扣（30 分 90 秒 = periods 个整周期，剩下的零头不扣）
    expect(h.brain.init().satiety).toBe(100 - periods)
    expect(h.brain.debugState().satiety).toBe(100 - periods)
    // 锚点 = 旧锚 + periods 个整周期（不是 now！）—— 90 秒零头还在锚里
    expect(h.current().lastDecayAt).toBe(iso(BASE_MS - away + periods * PET_DECAY_OFFLINE_PERIOD_MS))
    // 尺子自证：同一个时间窗，若误用**在线**速率会多扣一大截 ——
    // 两个常量在这段尺度上必须分得开，否则"离线更慢"这个判据本身是恒真的
    expect(Math.floor(away / PET_DECAY_ONLINE_PERIOD_MS)).toBeGreaterThan(periods)
  })

  it('离线下限（V2-21）：关着一整天回来停在 PET_OFFLINE_DECAY_FLOOR，不是静音的 0 档', () => {
    // 学生党典型作息：晚上关机、第二天放学回来 ≈ 18~24 小时
    const away = 24 * 60 * 60_000 + 90_000 // 一整天 + 90 秒零头
    const h = makeHarness({
      seed: {
        satiety: 100,
        lastDecayAt: iso(BASE_MS - away)
      }
    })
    // 名义该扣 240 点（6 分钟周期）→ 无下限会被扣成 0；有下限后停在 20（medium 档）
    const snap = h.brain.init()
    expect(snap.satiety).toBe(PET_OFFLINE_DECAY_FLOOR)
    expect(snap.satiety).toBeGreaterThan(0) // 0 档（主动全静音）不许是离线的落点
    expect(petHungerTier(snap.satiety)).toBe('medium')
    // 锚点照推进（90 秒零头仍留在锚里）：只拦"掉到 0"，不冻结时钟 ——
    // 否则回来后第一次在线心跳会把攒下的一整天按在线速率一次补扣
    const periods = Math.floor(away / PET_DECAY_OFFLINE_PERIOD_MS)
    expect(Date.parse(h.current().lastDecayAt)).toBe(BASE_MS - away + periods * PET_DECAY_OFFLINE_PERIOD_MS)
    // 尺子自证：没有下限时同一时间窗的确会掉到 0（这个判据不是恒真的）——
    // 直接对 shared 的 decayPet 传默认 floor=0 复算同一份输入
    const seeded = { ...defaultPetState(iso(BASE_MS - away)), satiety: 100 }
    expect(decayPet(seeded, iso(BASE_MS), PET_DECAY_OFFLINE_PERIOD_MS).state.satiety).toBe(0)
  })

  it('衰减过就落盘；没衰减也要落一次"见面时刻"', () => {
    const h = makeHarness({ seed: { satiety: 100, lastDecayAt: iso(BASE_MS - 30 * 60_000) } })
    // 至少两笔：衰减一笔 + touchPetSeen 一笔
    expect(h.saves.length).toBeGreaterThanOrEqual(2)
    expect(h.current().memory.lastSeenAt).toBe(iso(BASE_MS))
    const quiet = makeHarness({})
    // 没衰减：只有 touch 那一笔
    expect(quiet.saves.length).toBe(1)
    expect(quiet.current().memory.lastSeenAt).toBe(iso(BASE_MS))
  })

  it('awayOnLaunch 在 touch 之前算好（3 天没见 = 3 天，不是 0）', () => {
    const h = makeHarness({
      seed: { memory: { ...defaultPetMemory(iso(BASE_MS)), lastSeenAt: iso(BASE_MS - 3 * DAY_MS) } }
    })
    expect(h.brain.debugState().awayOnLaunchMs).toBe(3 * DAY_MS)
  })

  it('问候用完即清：同一次会话里第二次 greet 不再"好几天不见"', () => {
    const h = makeHarness({
      seed: {
        satiety: 90,
        memory: { ...defaultPetMemory(iso(BASE_MS)), lastSeenAt: iso(BASE_MS - 3 * DAY_MS) }
      }
    })
    h.brain.greet()
    expect(h.says[0].tag).toBe('greet:away')
    expect(PET.GREETING_LONG_AWAY as readonly string[]).toContain(h.says[0].text)
    h.brain.greet()
    expect(h.says[1].tag).toBe('greet')
    expect(PET.GREETING as readonly string[]).toContain(h.says[1].text)
  })
})

// ------------------------------------------- 空转[4]：关掉 = 完全冻结（2026-10-16）

/*
 * 复核现场：设置里关掉宠物后 30 分钟采样，饱食度 57→50 —— 心跳表没停、
 * 账本一直在动。主人裁定「关掉宠物必须彻底关掉」，口径 = **完全冻结**：
 * 关着的时间不饿、不掉好感、不写盘；重开接着原样来。
 * 冻结的两个入口：起步就关着（deps.startPaused）+ 中途拨开关（setPaused）。
 */
describe('关掉 = 完全冻结（空转[4]，2026-10-16）', () => {
  it('起步冻结：装载路径整块跳过 —— 关着的那天不扣、不记见面、零落盘', () => {
    const away = DAY_MS + 90_000
    /* lastSeenAt 显式种成"一天前" —— 不种的话默认值恰好是 iso(BASE_MS)，
       和 touch 后的值一字不差，"没记见面"这条就成了恒真判据（假绿陷阱） */
    const seed = {
      satiety: 100,
      lastDecayAt: iso(BASE_MS - away),
      memory: { ...defaultPetMemory(iso(BASE_MS)), lastSeenAt: iso(BASE_MS - away) }
    }
    const h = makeHarness({ seed, deps: { startPaused: true } })
    // 不衰减：饱食度原样，锚点也**不动**（不是"按整周期推进"那一套）
    expect(h.brain.init().satiety).toBe(100)
    expect(h.current().lastDecayAt).toBe(iso(BASE_MS - away))
    // 连见面时刻都不记（away/touch 整块跳过）—— 下次问候不是"好久不见"
    expect(h.current().memory.lastSeenAt).toBe(iso(BASE_MS - away))
    expect(h.brain.debugState().awayOnLaunchMs).toBe(0)
    // 零落盘 —— 冻结期的 pet.json 一个字节都不动（真机探针的 mtime 判据）
    expect(h.saves).toHaveLength(0)
    // 尺子自证：**同一份种子**不冻结时既会扣、会记见面、也会落盘 ——
    // 不然上面那组"不动"全是对着恒真判据绿的
    const open = makeHarness({ seed })
    expect(open.brain.init().satiety).toBe(PET_OFFLINE_DECAY_FLOOR)
    expect(open.current().memory.lastSeenAt).toBe(iso(BASE_MS))
    expect(open.brain.debugState().awayOnLaunchMs).toBeGreaterThanOrEqual(DAY_MS)
    expect(open.saves.length).toBeGreaterThan(0)
  })

  it('冻结期间 heartbeat tick 是 no-op：一小时后饱食度、落盘、vitals 全不动', () => {
    const pushes: PetVitals[] = []
    const h = makeHarness({
      seed: { satiety: 80 },
      deps: { startPaused: true, vitals: (v) => pushes.push(v) }
    })
    const pushesAtBoot = pushes.length // 构造时那一发（摆上叶子）不算 tick 的
    h.advance(60 * 60_000) // 冻着走一小时（在线速率够掉 30 点了）
    h.brain.tick()
    h.brain.tick()
    expect(h.brain.init().satiety).toBe(80)
    expect(h.saves).toHaveLength(0)
    expect(pushes).toHaveLength(pushesAtBoot)
    // 尺子自证：不冻结的同一颗种子，走一小时 + 两拍 tick 会掉一大截 ——
    // "tick 动不了它"不是因为时钟没走
    const open = makeHarness({ seed: { satiety: 80 } })
    open.advance(60 * 60_000)
    open.brain.tick()
    expect(open.brain.init().satiety).toBeLessThan(80)
  })

  it('解冻（setPaused(false)）把冻结期整段抹掉：三个锚点重锚到此刻并落盘', () => {
    const h = makeHarness({ seed: { satiety: 80 }, deps: { startPaused: true } })
    h.advance(3 * DAY_MS) // 冻着三天
    h.brain.setPaused(false)
    // 重锚落了一笔，三个锚点全是"此刻"（注意 lastAffectionAt 是**毫秒数**，
    // 另外两个才是 ISO 串 —— 形状不同是 PetState 的既有契约）
    expect(h.saves).toHaveLength(1)
    const now = iso(BASE_MS + 3 * DAY_MS)
    expect(h.current().lastDecayAt).toBe(now)
    expect(h.current().lastAffectionAt).toBe(BASE_MS + 3 * DAY_MS)
    expect(h.current().memory.lastSeenAt).toBe(now)
    expect(h.current().satiety).toBe(80) // 三天一滴没掉
    // 解冻后心跳恢复：再走一个在线周期，掉 1（表真活了）
    h.advance(PET_DECAY_ONLINE_PERIOD_MS)
    h.brain.tick()
    expect(h.brain.init().satiety).toBe(79)
  })

  it('中途拨到关：冻结后的 tick 不记账；再开也不补扣（重锚把整段划掉）', () => {
    const h = makeHarness({ seed: { satiety: 80 } })
    h.advance(90_000) // 开着走了 90 秒（不足一个周期，零头挂在锚上）
    h.brain.setPaused(true)
    const savesAtFreeze = h.saves.length
    h.advance(60 * 60_000)
    h.brain.tick() // 冻结中：no-op
    expect(h.brain.init().satiety).toBe(80)
    expect(h.saves).toHaveLength(savesAtFreeze)

    h.brain.setPaused(false)
    const reopened = iso(BASE_MS + 90_000 + 60 * 60_000)
    expect(h.current().lastDecayAt).toBe(reopened)
    // 尺子自证：不重锚的话（锚还停在 +90s 处）这一刻会一次补扣半小时的量 ——
    // 直接拿 shared 的 decayPet 对旧锚复算，证明"重锚"不是装饰
    const stale = { ...defaultPetState(iso(BASE_MS)), satiety: 80, lastDecayAt: iso(BASE_MS + 90_000) }
    const wrong = decayPet(stale, reopened, PET_DECAY_ONLINE_PERIOD_MS)
    expect(wrong.dropped).toBeGreaterThan(0)
    expect(decayPet(h.current(), reopened, PET_DECAY_ONLINE_PERIOD_MS).dropped).toBe(0)
  })

  it('重复解冻是 no-op：正常保存设置（改主题等）不会把在线衰减的零头清掉', () => {
    const h = makeHarness({})
    h.advance(90_000)
    const savesBefore = h.saves.length
    h.brain.setPaused(false) // 本来就开着：no-op
    expect(h.saves).toHaveLength(savesBefore)
    expect(h.current().lastDecayAt).toBe(iso(BASE_MS)) // 锚点没动
  })
})

// ---------------------------------------------------------------- 互动：喂饭 / 摸头

describe('喂饭与摸头：1200ms 共享冷却', () => {
  it('喂饭成功：饱食度 +20、饭盒 -1、台词 + 吃白饭动画、落盘', () => {
    const h = makeHarness({ seed: { rice: 1, satiety: 50 } })
    const snap = h.brain.act({ action: 'feed' })
    expect(snap.satiety).toBe(50 + PET_FEED_GAIN)
    expect(snap.rice).toBe(0)
    expect(h.says).toEqual([{ text: PET.FEED_OK[0], tag: 'feed-ok' }])
    expect(h.anims).toEqual([PET_DSH.ANIM.FEED])
    expect(h.current().fedTotal).toBe(1)
  })

  it('冷却内**完全忽略**：连点不刷饱食度，连"没饭"都不吭声', () => {
    const h = makeHarness({ seed: { rice: 1, satiety: 50 } })
    h.brain.act({ action: 'feed' })
    expect(h.brain.debugState().satiety).toBe(70)
    // 第二下在冷却内 —— 即便饭盒已空（若没拦住会出 FEED_EMPTY），也必须一声不吭
    h.brain.act({ action: 'feed' })
    expect(h.says.length).toBe(1)
    expect(h.brain.debugState().satiety).toBe(70)
    // 过冷却后再喂：这次饭盒真的空了，出"没饭"台词
    h.advance(1200)
    h.brain.act({ action: 'feed' })
    expect(h.says.length).toBe(2)
    expect(h.says[1].tag).toBe('feed-empty')
    expect(PET.FEED_EMPTY as readonly string[]).toContain(h.says[1].text)
  })

  it('摸头（V1-46 新语义）：只涨好感、**一点饱食度都不回**；独立台词；与喂饭共享冷却（喂完立刻摸 = 被拦）', () => {
    const h = makeHarness({ seed: { rice: 1, satiety: 50 } })
    h.brain.act({ action: 'pat' })
    // 钉死新口径：旧实现这里会 +2 饱食度（PET_PAT_GAIN 已删）—— 摸头只攒好感
    expect(h.brain.init().satiety).toBe(50)
    expect(h.brain.init().affection).toBe(PET_AFFECTION_INITIAL + PET_AFFECTION_RULES.pat.delta)
    expect(h.says[0].tag).toBe('pat')
    expect(PET.PAT as readonly string[]).toContain(h.says[0].text)
    // 共享冷却：喂饭成功之后立刻摸头 → 拦
    h.advance(1200)
    h.brain.act({ action: 'feed' })
    const n = h.says.length
    h.brain.act({ action: 'pat' })
    expect(h.says.length).toBe(n)
  })

  it('台词轮转：两次成功喂饭说两条不同的（不是复读机）', () => {
    const h = makeHarness({ seed: { rice: 2, satiety: 10 } })
    h.brain.act({ action: 'feed' })
    h.advance(1200)
    h.brain.act({ action: 'feed' })
    // 只看喂饭台词（P3 ③ 之后，这两口还各跨了一次档：severe→medium→mild，
    // 跃迁台词会插在中间 —— 那是另一条判据的事，别在这里顺手把它钉死）
    expect(
      h.says.filter((s) => s.tag === 'feed-ok').map((s) => s.text)
    ).toEqual([PET.FEED_OK[0], PET.FEED_OK[1]])
  })

  it('吃饱了拒喂："撑着呢"与"饭盒空了"是两码事；不扣饭、不加饱食度', () => {
    const h = makeHarness({ seed: { rice: 1, satiety: 100 } })
    h.brain.act({ action: 'feed' })
    expect(h.says).toEqual([{ text: PET.FEED_FULL[0], tag: 'feed-full' }])
    // 拒喂照空饭盒一样"原样退回"：饭还在、数字不动 —— 喂了没反应才是骗人
    expect(h.brain.debugState().rice).toBe(1)
    expect(h.brain.debugState().satiety).toBe(100)
    expect(h.current().fedTotal).toBe(0)
    // 轮转：第二句是池子里下一条
    h.advance(1200)
    h.brain.act({ action: 'feed' })
    expect(h.says[1]).toEqual({ text: PET.FEED_FULL[1], tag: 'feed-full' })
  })

  it('V1-45 双击死带：摸头后 600ms 到达的喂饭放行 —— 双击真的喂得进去', () => {
    // 双击时间线（miai-extras countClick）：第一下 +320ms 排摸头、第二下 +420ms
    // 排喂饭 ⇒ 喂饭到达摸头后「间隔+100ms」。Windows 默认双击容差 500ms 时
    // 就是 600ms —— 旧代码在这里静默 return（死带 (320,1100) 正中），
    // 用户只看到摸头台词、饭没喂进去（V1-45 现象）。
    const h = makeHarness({ seed: { rice: 1, satiety: 50 } })
    // pat 的读数走 act() 的 typed 快照（PetSnapshot），不走 debugState 的
    // `Record<string, unknown>` —— 后者进不了算术（TS18046），
    // 快照姿势与上面「喂饭成功」那条既有用例一致
    const afterPat = h.brain.act({ action: 'pat' }).satiety
    expect(h.says.map((s) => s.tag)).toEqual(['pat'])
    h.advance(600)
    h.brain.act({ action: 'feed' })
    // 两半都到位：喂饭这一碗的 +20 与台词/动画一个不少（用增量断言，
    // 不依赖摸头自己涨多少 —— V1-46 会把摸头的饱食增益拿掉，那时这里不用改）
    expect(h.brain.debugState().satiety).toBe(afterPat + PET_FEED_GAIN)
    expect(h.brain.debugState().rice).toBe(0)
    expect(h.says[h.says.length - 1].tag).toBe('feed-ok')
    expect(h.anims).toEqual([PET_DSH.ANIM.FEED])
  })

  it('V1-45 饭盒空的双击：被吞的"没饭"台词也回来了（学习引导不再丢）', () => {
    // 审查的受影响面里最疼的一条：饭盒空时"去学一课换碗大白饭"这句唯一
    // 的学习引导也被死带吞掉。放行的是同一条豁免，判据要咬住台词本身。
    const h = makeHarness({ seed: { rice: 0, satiety: 50 } })
    h.brain.act({ action: 'pat' })
    h.advance(600)
    h.brain.act({ action: 'feed' })
    expect(h.says[h.says.length - 1].tag).toBe('feed-empty')
    expect(PET.FEED_EMPTY as readonly string[]).toContain(h.says[h.says.length - 1].text)
  })

  it('V1-45 豁免只放行紧跟的这一碗：喂过之后连喂仍被静默拦（v1 连点口径收窄不破）', () => {
    const h = makeHarness({ seed: { rice: 2, satiety: 50 } })
    // 同上：afterPat 走 typed 快照
    const afterPat = h.brain.act({ action: 'pat' }).satiety
    h.advance(600)
    h.brain.act({ action: 'feed' }) // 豁免放行（第一碗）
    expect(h.brain.debugState().satiety).toBe(afterPat + PET_FEED_GAIN)
    const n = h.says.length
    h.advance(200)
    h.brain.act({ action: 'feed' }) // 冷却内第二碗：豁免已用掉，静默
    expect(h.says.length).toBe(n)
    expect(h.brain.debugState().satiety).toBe(afterPat + PET_FEED_GAIN)
    expect(h.brain.debugState().rice).toBe(1)
    // 反例自证：同一时刻的喂饭若换成"无摸头背景"也必须拦（喂→喂那条老用例
    // 在 :276 守着）；这里是它的对照 —— 拦的依据是豁免用尽，不是碰巧。
    h.advance(1200)
    h.brain.act({ action: 'feed' }) // 冷却过：正常放行第二碗
    expect(h.brain.debugState().rice).toBe(0)
  })
})

// ---------------------------------------------------------------- rua

describe('rua：4s 冷却 + 傲娇情绪', () => {
  it('被 rua：说一句、进入 tsundere（落盘 emotionUntil = now + 60s）', () => {
    const h = makeHarness({ seed: { satiety: 90 } })
    h.brain.act({ action: 'rua' })
    expect(h.says[0].tag).toBe('rua')
    expect(PET.RUA as readonly string[]).toContain(h.says[0].text)
    expect(h.current().emotion).toBe('tsundere')
    expect(Date.parse(h.current().emotionUntil)).toBe(BASE_MS + 60_000)
    // 脸色现算：satiety 90 本是 happy，情绪在时效内 → tsundere
    expect(h.brain.init().face).toBe('tsundere')
  })

  it('4 秒冷却：连 rua 两轮只说一次；过冷却恢复', () => {
    const h = makeHarness({ seed: { satiety: 90 } })
    h.brain.act({ action: 'rua' })
    h.brain.act({ action: 'rua' })
    expect(h.says.length).toBe(1)
    h.advance(4_000)
    h.brain.act({ action: 'rua' })
    expect(h.says.length).toBe(2)
  })

  it('情绪过期就回落（emotionUntil 过了 → 回到 happy）', () => {
    const h = makeHarness({ seed: { satiety: 90 } })
    h.brain.act({ action: 'rua' })
    h.advance(60_001)
    expect(h.brain.init().face).toBe('happy')
  })
})

// ---------------------------------------------------------------- 学习发奖

describe('学习发奖（grant）：饭盒 + 台词 + 连学三课彩蛋', () => {
  it('lesson：+2 碗、记账、说一句、记进记忆', () => {
    const h = makeHarness({})
    h.brain.act({ action: 'grant', reward: 'lesson' })
    expect(h.current().rice).toBe(2)
    expect(h.current().earnedTotal).toBe(2)
    expect(h.says[0]).toEqual({ text: PET.GRANT_LESSON(2), tag: 'grant-lesson' })
    const ev = h.current().memory.events
    expect(ev.length).toBe(1)
    expect(ev[0].kind).toBe('lesson')
  })

  it('review：+2 碗，另一句台词', () => {
    const h = makeHarness({})
    h.brain.act({ action: 'grant', reward: 'review' })
    expect(h.says[0]).toEqual({ text: PET.GRANT_REVIEW(2), tag: 'grant-review' })
  })

  it('满仓（V1-42/空转[1]）：说"饭盒满了"、不报假喜报；冷却内只说一次；earnedTotal/记忆照记', () => {
    const h = makeHarness({ seed: { rice: PET_RICE_MAX } })
    h.brain.act({ action: 'grant', reward: 'lesson' })
    expect(h.current().rice).toBe(PET_RICE_MAX) // 一碗都没进来
    expect(h.current().earnedTotal).toBe(2) // 名义功劳照记（功劳簿 ≠ 真入账）
    expect(h.says).toEqual([{ text: PET.RICE_FULL(PET_RICE_MAX), tag: 'rice-full' }])
    // 学习事实照旧进记忆环：饭没装下 ≠ 没学
    expect(h.current().memory.events.length).toBe(1)
    // 冷却内再发一块（checkin 也走 credited 判定）：不再冒泡
    h.advance(1_000)
    h.brain.act({ action: 'grant', reward: 'checkin' })
    expect(h.says.length).toBe(1)
    // 过了冷却：允许再说一次（用户可能中途喂过饭又刷满了）
    h.advance(PET_RICE_FULL_COOLDOWN_MS + 1_000)
    h.brain.act({ action: 'grant', reward: 'lesson' })
    expect(h.says.length).toBe(2)
    expect(h.says[1]).toEqual({ text: PET.RICE_FULL(PET_RICE_MAX), tag: 'rice-full' })
  })

  it('半仓（V1-42）：台词报**真进盒**的碗数（998+2 → 说"收到 1 碗"）', () => {
    const h = makeHarness({ seed: { rice: PET_RICE_MAX - 1 } })
    h.brain.act({ action: 'grant', reward: 'lesson' })
    expect(h.current().rice).toBe(PET_RICE_MAX)
    expect(h.says[0]).toEqual({ text: PET.GRANT_LESSON(1), tag: 'grant-lesson' })
  })

  it('当日赚满（V1-42）：第二笔 checkin 被拦 —— 明说 RICE_CAP_TODAY、不扣不加、**一个字不进账本**；跨日恢复', () => {
    // 账本替身：只记"谁来过"。返回 null = 镜像不生效（余额留在纯函数算出的值）
    const riceCalls: string[] = []
    const h = makeHarness({
      deps: {
        onRice: (ev) => {
          riceCalls.push(ev.kind)
          return null
        }
      }
    })
    // 第一笔签到：正常进账、走账本
    h.brain.act({ action: 'grant', reward: 'checkin' })
    expect(h.current().rice).toBe(2)
    expect(riceCalls).toEqual(['checkin'])
    // 同日第二笔：额度（checkin=1）拦下 —— 台词是"今天赚满了"，不是"饭盒满了"
    h.advance(1_000)
    h.brain.act({ action: 'grant', reward: 'checkin' })
    expect(h.current().rice).toBe(2)
    expect(h.current().earnedTotal).toBe(2) // 不扣不加：被闸拦下的没功劳可记
    expect(h.says[h.says.length - 1]).toEqual({ text: PET.RICE_CAP_TODAY, tag: 'rice-cap' })
    // ★账本护栏：capped 这笔必须一个字节都不进账本 —— 账本按 kind 独立加账，
    // 送进去 = 把这碗加回来，上限形同虚设（与 grantRun 的 granted 门同款）
    expect(riceCalls).toEqual(['checkin'])
    // 冷却：同一口气里再试一次不再冒泡（与 rice-full 共用冷却锚）
    h.advance(PET_RICE_FULL_COOLDOWN_MS - 2_000)
    h.brain.act({ action: 'grant', reward: 'checkin' })
    expect(h.says.filter((s) => s.tag === 'rice-cap').length).toBe(1)
    // 过了冷却再试：允许再说一次（用户可能中途喂过饭又回来学）
    h.advance(2_000)
    h.brain.act({ action: 'grant', reward: 'checkin' })
    expect(h.says.filter((s) => s.tag === 'rice-cap').length).toBe(2)
    // 跨日：额度重置，照发照进账本
    h.advance(DAY_MS)
    h.brain.act({ action: 'grant', reward: 'checkin' })
    expect(h.current().rice).toBe(4)
    expect(h.current().earnedTotal).toBe(4)
    expect(riceCalls).toEqual(['checkin', 'checkin'])
    expect(h.says[h.says.length - 1]).toEqual({ text: PET.GRANT_CHECKIN(2), tag: 'grant-checkin' })
  })

  it('answer：+1 碗、不冒泡、不进记忆（每答对一题都弹会变弹幕）', () => {
    const h = makeHarness({})
    h.brain.act({ action: 'grant', reward: 'answer' })
    expect(h.current().rice).toBe(1)
    expect(h.says).toEqual([])
    expect(h.current().memory.events.length).toBe(0)
  })

  it('checkin（P3 ①）：+2 碗、说拍板台词、**不进记忆环**、也不会顺带触发 SPIN 彩蛋', () => {
    const h = makeHarness({})
    // 先学两课（streak = 2）。这两条同时是判别器：签到若被当成学习行为
    // （remember: true），它会成为第 3 条 lesson 记忆 → streak 到线 → 误触 SPIN
    h.brain.act({ action: 'grant', reward: 'lesson' })
    h.advance(1_000)
    h.brain.act({ action: 'grant', reward: 'lesson' })
    h.advance(1_000)
    const memBefore = h.current().memory.events.length

    h.brain.act({ action: 'grant', reward: 'checkin' })

    expect(h.current().rice).toBe(2 + 2 + 2) // 两课 + 签到
    expect(h.current().earnedTotal).toBe(6)
    expect(h.says[h.says.length - 1]).toEqual({ text: PET.GRANT_CHECKIN(2), tag: 'grant-checkin' })
    // 记忆环不长（签到不是"学了一课"）
    expect(h.current().memory.events.length).toBe(memBefore)
    // 没转圈：SPIN 只属于学习行为（streak 仍 2，且即使到 3 也不该由签到触发）
    expect(h.says.some((s) => s.tag === 'spin')).toBe(false)
    expect(h.anims).not.toContain(PET_DSH.ANIM.SPIN)
    // C13 观测点：最后一个真的进到 doGrant 的种类
    expect(h.brain.debugState().lastGrantKind).toBe('checkin')
  })

  it('C13：解析失败的载荷到不了 doGrant —— lastGrantKind 不被动，但日志必须留痕', () => {
    const h = makeHarness({})
    expect(h.brain.debugState().lastGrantKind).toBe(null)
    h.brain.act({ action: 'grant', reward: 'checkin' })
    expect(h.brain.debugState().lastGrantKind).toBe('checkin')
    // 坏载荷：读数保持旧值（说明"没执行"）+ 日志有 dropped（说明"收到了但没执行"）——
    // 两个读数合起来才是完整证据链（只看读数分不清"没收到"和"收到没执行"）
    h.brain.act({ action: 'grant', reward: 'checkin2' })
    expect(h.brain.debugState().lastGrantKind).toBe('checkin')
    expect(h.logs.some((l) => l.includes('act dropped'))).toBe(true)
  })

  it('连学三课：第 3 课触发 SPIN 台词 + 转圈动画 + excited；第 4 课不再触发', () => {
    const h = makeHarness({})
    for (let i = 0; i < 3; i++) {
      h.brain.act({ action: 'grant', reward: 'lesson' })
      h.advance(1_000)
    }
    // 第 3 课：GRANT_LESSON + SPIN 两条
    const last = h.says[h.says.length - 1]
    expect(last).toEqual({ text: PET.SPIN, tag: 'spin' })
    expect(h.anims).toContain(PET_DSH.ANIM.SPIN)
    expect(h.current().emotion).toBe('excited')
    // 第 4 课：streak = 4 ≠ 3 → 不再彩蛋
    const n = h.says.length
    h.brain.act({ action: 'grant', reward: 'lesson' })
    expect(h.says.length).toBe(n + 1) // 只有 GRANT_LESSON
    expect(h.says[h.says.length - 1].tag).toBe('grant-lesson')
  })
})

// ---------------------------------------------------------------- 答错题

describe('答错题（wrong）：两档台词 + 30s 冷却 + 60s 记忆去重', () => {
  it('学过的课：指名道姓地"教过"（带课序）', () => {
    const h = makeHarness({})
    h.brain.act({ action: 'wrong', title: TITLE, order: 2, learned: true })
    expect(h.says[0]).toEqual({ text: PET.WRONG_LEARNED(TITLE, 2), tag: 'wrong' })
    expect(h.current().memory.events[0]).toMatchObject({ kind: 'wrong', label: TITLE })
  })

  it('没学过的课：不凶，指路', () => {
    const h = makeHarness({})
    h.brain.act({ action: 'wrong', title: TITLE, order: null, learned: false })
    expect(h.says[0].text).toBe(PET.WRONG_NOT_LEARNED(TITLE, null))
  })

  it('课名查不出来：说通用那档（不编课名）', () => {
    const h = makeHarness({})
    h.brain.act({ action: 'wrong', title: null, order: null, learned: false })
    expect(PET.WRONG_NO_TITLE as readonly string[]).toContain(h.says[0].text)
  })

  it('连错五道不同题：记忆照记 5 笔，嘴上只提一次（30s 冷却）', () => {
    const h = makeHarness({})
    for (const t of ['A', 'B', 'C', 'D', 'E']) {
      h.brain.act({ action: 'wrong', title: t, order: 1, learned: true })
    }
    expect(h.says.length).toBe(1)
    expect(h.current().memory.events.length).toBe(5)
  })

  it('同课名 60s 内不重复进记忆，但台词冷却过了照说', () => {
    const h = makeHarness({})
    h.brain.act({ action: 'wrong', title: TITLE, order: 1, learned: true })
    expect(h.current().memory.events.length).toBe(1)
    // t+30s：台词冷却过（30s），记忆去重内（60s）→ 说但不多记
    h.advance(30_000)
    h.brain.act({ action: 'wrong', title: TITLE, order: 1, learned: true })
    expect(h.says.length).toBe(2)
    expect(h.current().memory.events.length).toBe(1)
    // t+61s：去重窗过 → 记忆 +1
    h.advance(31_000)
    h.brain.act({ action: 'wrong', title: TITLE, order: 1, learned: true })
    expect(h.current().memory.events.length).toBe(2)
    expect(h.says.length).toBe(3)
  })
})

// ---------------------------------------------------------------- 运行上报

describe('运行上报（reportRun）：跑通表扬 + 报错语言三档', () => {
  it('跑通：表扬一句 + 开心跃动动画 + 记忆 run-ok', () => {
    const h = makeHarness({})
    h.brain.reportRun({ ok: true, kind: 'run', line: null, rect: null })
    expect(h.says[0].tag).toBe('run-ok')
    expect(PET.PRAISE_RUN as readonly string[]).toContain(h.says[0].text)
    expect(h.anims).toEqual([PET_DSH.ANIM.PRAISE])
    expect(h.current().memory.events[0].kind).toBe('run-ok')
  })

  it('表扬 90s 冷却 + 记忆 5min 去重（各自独立）', () => {
    const h = makeHarness({})
    const run = { ok: true, kind: 'run', line: null, rect: null }
    h.brain.reportRun(run)
    expect(h.says.length).toBe(1)
    // 【为什么必须有"冷却内不说"这半边】只断言"90s 后能说"是假绿：把冷却
    // 整个删掉（句句都说）它也照样绿（种坏③现场）。要咬住"冷却失效"这个方向，
    // 就得钉死"连发不说 + 差 1ms 仍不说"。
    h.brain.reportRun(run)
    h.advance(89_999)
    h.brain.reportRun(run)
    expect(h.says.length).toBe(1)
    // 90s 到：可以说，但记忆仍在 5min 去重窗内
    h.advance(1)
    h.brain.reportRun(run)
    expect(h.says.length).toBe(2)
    expect(h.current().memory.events.length).toBe(1)
    // 5min 后：记忆也记一笔
    h.advance(211_000)
    h.brain.reportRun(run)
    expect(h.says.length).toBe(3)
    expect(h.current().memory.events.length).toBe(2)
  })

  it('报错三档：编译/运行时 × 有行号/无行号', () => {
    const h = makeHarness({})
    h.brain.reportRun({ ok: false, kind: 'compile', line: 5, rect: null })
    h.brain.reportRun({ ok: false, kind: 'compile', line: null, rect: null })
    h.brain.reportRun({ ok: false, kind: 'run', line: 9, rect: null })
    h.brain.reportRun({ ok: false, kind: 'run', line: null, rect: null })
    expect(h.says.map((s) => s.text)).toEqual([
      PET.ERR_COMPILE_LINE(5),
      PET.ERR_COMPILE_NO_LINE,
      PET.ERR_RUNTIME_LINE(9),
      PET.ERR_RUNTIME_NO_LINE
    ])
    expect(h.says.every((s) => s.tag === 'run-err')).toBe(true)
  })

  it('超时单列一档：即使带着行号也走 timeout（它压根没走到编译器）', () => {
    const h = makeHarness({})
    h.brain.reportRun({ ok: false, kind: 'timeout', line: 3, rect: null })
    expect(h.says[0].text).toBe(PET.ERR_TIMEOUT)
  })

  it('报错不受表扬冷却影响：刚表扬过照样能报错', () => {
    const h = makeHarness({})
    h.brain.reportRun({ ok: true, kind: 'run', line: null, rect: null })
    h.brain.reportRun({ ok: false, kind: 'compile', line: 1, rect: null })
    expect(h.says[1].text).toBe(PET.ERR_COMPILE_LINE(1))
  })

  it('垃圾上报整条丢弃（不冒充失败，也不戳"人在"的时刻）', () => {
    const h = makeHarness({})
    for (const bad of [null, 42, 'x', {}, { ok: 'yes' }]) h.brain.reportRun(bad)
    expect(h.says).toEqual([])
    h.advance(1_000)
    expect(h.brain.debugState().idleMs).toBe(1_000)
  })
})

// ---------------------------------------------------------------- 跑腿（chase）

describe('跑腿报错（chase）：出动落点 / ACK 两出口 / 冷却 / 饿扁拒跑', () => {
  /** 报错框（视口矩形）：落点算成屏幕 DIP 是宿主的事，这里只验 brain 递出去的算式 */
  const RECT = { x: 100, y: 200, width: 300, height: 40 }
  const FAIL = { ok: false, kind: 'compile', line: 5, rect: RECT }

  it('出动落点 = 框右缘再右 72px、垂直居中；当趟不吭声、-1 饱食度、挂起待 ACK', () => {
    const stub = chaseStub()
    const h = makeHarness({ seed: { satiety: 80 }, deps: { chase: stub.chase } })
    h.brain.reportRun(FAIL)
    expect(stub.calls).toEqual([[100 + 300 + 72, 200 + 40 / 2]])
    // 台词等到了再说 —— 跑腿的重头戏是落点旁那句话，此刻一条都不许冒
    expect(h.says).toEqual([])
    expect(h.anims).toEqual([])
    // 跑腿费：-1 饱食度（落了盘）；这趟挂在 seq 101 上
    expect(h.brain.debugState().satiety).toBe(80 - PET_CHASE_COST)
    expect(h.current().satiety).toBe(80 - PET_CHASE_COST)
    expect(h.brain.debugState().pendingChaseSeq).toBe(101)
    expect(h.brain.debugState().lastChaseAt).toBe(BASE_MS)
  })

  it('到达（ACK）：行号前缀 + chase 池台词 + 配图透传；挂起清空', () => {
    const stub = chaseStub()
    const h = makeHarness({ seed: { satiety: 80 }, deps: { chase: stub.chase } })
    h.brain.reportRun(FAIL)
    h.brain.chaseArrived(101)
    const said = h.says[0]
    expect(said.tag).toBe('chase-arrived')
    const lead = PET.CHASE_LINE_LEAD(5)
    expect(said.text.startsWith(lead)).toBe(true)
    // 正文必须是 chase 池子里逐字的一条（台词真源在 pet-quips，不在本文件手打）
    const suffix = said.text.slice(lead.length)
    const q = QUIP_POOL.chase.find((x) => x.text === suffix)
    expect(q, `到达台词不在 chase 池子里: ${suffix}`).toBeDefined()
    expect(said.meme).toBe(q?.meme)
    expect(h.brain.debugState().pendingChaseSeq).toBe(0)
  })

  it('认不出行号：不带前缀，原样说一句池子台词', () => {
    const stub = chaseStub()
    const h = makeHarness({ seed: { satiety: 80 }, deps: { chase: stub.chase } })
    h.brain.reportRun({ ok: false, kind: 'run', line: null, rect: RECT })
    h.brain.chaseArrived(101)
    expect(QUIP_POOL.chase.some((q) => q.text === h.says[0].text)).toBe(true)
    expect(h.says[0].tag).toBe('chase-arrived')
  })

  it('陈旧回执作废：seq 对不上的到达/超时都不许动挂着的那趟', () => {
    const stub = chaseStub()
    const h = makeHarness({ seed: { satiety: 80 }, deps: { chase: stub.chase } })
    h.brain.reportRun(FAIL)
    h.brain.chaseArrived(999)
    h.brain.chaseTimeout(999)
    expect(h.says).toEqual([])
    expect(h.brain.debugState().pendingChaseSeq).toBe(101)
    // 真回执到了照常说话；已消费之后超时再来也不补说
    h.brain.chaseArrived(101)
    expect(h.says.length).toBe(1)
    h.brain.chaseTimeout(101)
    expect(h.says.length).toBe(1)
  })

  it('6s 超时：这趟作废、原地补说报错话术（降级照说，不是沉默）', () => {
    const stub = chaseStub()
    const h = makeHarness({ seed: { satiety: 80 }, deps: { chase: stub.chase } })
    h.brain.reportRun(FAIL)
    h.brain.chaseTimeout(101)
    expect(h.says).toEqual([{ text: PET.ERR_COMPILE_LINE(5), tag: 'run-err' }])
    expect(h.brain.debugState().pendingChaseSeq).toBe(0)
  })

  it('30s 冷却：差 1ms 不出动（照常说台词），满 30s 再出动', () => {
    const stub = chaseStub()
    const h = makeHarness({ seed: { satiety: 80 }, deps: { chase: stub.chase } })
    h.brain.reportRun(FAIL)
    h.brain.chaseArrived(101)
    h.advance(PET_CHASE_COOLDOWN_MS - 1)
    h.brain.reportRun(FAIL)
    expect(stub.calls.length).toBe(1)
    expect(h.says[h.says.length - 1]).toEqual({ text: PET.ERR_COMPILE_LINE(5), tag: 'run-err' })
    h.advance(1)
    h.brain.reportRun(FAIL)
    expect(stub.calls.length).toBe(2)
    expect(h.brain.debugState().pendingChaseSeq).toBe(102)
  })

  it('饿扁拒跑：不走也不扣饭，喊饿 + 垂头动画；喂一口立刻能出动（拒跑不占冷却）', () => {
    const stub = chaseStub()
    const h = makeHarness({ seed: { satiety: 0, rice: 1 }, deps: { chase: stub.chase } })
    h.brain.reportRun(FAIL)
    expect(stub.calls).toEqual([])
    expect(h.says).toEqual([{ text: PET.CHASE_HUNGRY[0], tag: 'chase-hungry' }])
    expect(h.anims).toEqual([PET_DSH.ANIM.HUNGRY])
    expect(h.brain.debugState().satiety).toBe(0) // 拒跑不扣跑腿费
    expect(h.brain.debugState().lastChaseAt).toBe(0) // 也不占 30s 冷却
    // 喂一碗（+20）→ 立刻再报 → 这次真的出动
    h.brain.act({ action: 'feed' })
    h.brain.reportRun(FAIL)
    expect(stub.calls.length).toBe(1)
    expect(h.brain.debugState().pendingChaseSeq).toBe(101)
  })

  it('没有 chase 出口 / seq=0（宠物窗不在）：原地说话，不挂起、不扣费', () => {
    // 假脑不接这条 = 永远走"原地说话"分支（宿主没上线时的行为）
    const noDep = makeHarness({ seed: { satiety: 80 } })
    noDep.brain.reportRun(FAIL)
    expect(noDep.says).toEqual([{ text: PET.ERR_COMPILE_LINE(5), tag: 'run-err' }])

    const zero = makeHarness({ seed: { satiety: 80 }, deps: { chase: () => 0 } })
    zero.brain.reportRun(FAIL)
    expect(zero.says).toEqual([{ text: PET.ERR_COMPILE_LINE(5), tag: 'run-err' }])
    expect(zero.brain.debugState().pendingChaseSeq).toBe(0)
    expect(zero.brain.debugState().satiety).toBe(80)
    expect(zero.brain.debugState().lastChaseAt).toBe(0)
  })

  it('连跑两趟不重句：第二趟的台词排除最近说过的', () => {
    const stub = chaseStub()
    const h = makeHarness({ seed: { satiety: 80 }, deps: { chase: stub.chase } })
    h.brain.reportRun(FAIL)
    h.brain.chaseArrived(101)
    h.advance(PET_CHASE_COOLDOWN_MS)
    h.brain.reportRun(FAIL)
    h.brain.chaseArrived(102)
    expect(h.says.length).toBe(2)
    expect(h.says[1].text).not.toBe(h.says[0].text)
  })
})

// ------------------------------------------- 状态规则（补充模块一②，2026-10-09）

describe('状态规则（补充模块一②）：催饭节拍 / 撒娇节拍 / 冷漠抑制 / 跑腿门槛', () => {
  /** CPU 采样注成零增量：这些用例只看环境音三条通道，不让真机 CPU 读数掺进来 */
  const QUIET_DEPS = { sampleCpu: () => ({ idle: 0, total: 0 }) }
  const nags = (h: Harness): { text: string; tag: string }[] => h.says.filter((s) => s.tag === 'nag')
  const proactives = (h: Harness): { text: string; tag: string }[] =>
    h.says.filter((s) => s.tag.startsWith('proactive'))

  it('催饭节拍：越饿越勤（severe 90s / medium 180s / mild 300s），差 1ms 不催、同一条不连说两遍', () => {
    // 尺子自证：三档节拍必须真的分得开，否则"越饿越勤"这条判据恒真
    expect(NAG_GAP_SEVERE_MS).toBeLessThan(NAG_GAP_MEDIUM_MS)
    expect(NAG_GAP_MEDIUM_MS).toBeLessThan(NAG_GAP_MILD_MS)
    const arms: [number, number][] = [
      [PET_HUNGER_SEVERE_AT + 10, NAG_GAP_SEVERE_MS],
      [PET_HUNGER_MEDIUM_AT + 10, NAG_GAP_MEDIUM_MS],
      [PET_HUNGER_MILD_AT + 10, NAG_GAP_MILD_MS]
    ]
    for (const [satiety, gap] of arms) {
      const h = makeHarness({ focused: true, seed: { satiety }, deps: QUIET_DEPS })
      // 差 1ms：节拍是真闸门，不是"每拍都催"的摆设
      h.advance(gap - 1)
      h.brain.tick()
      expect(nags(h).length, `satiety=${satiety} 差 1ms 不该催`).toBe(0)
      h.advance(1)
      h.brain.tick()
      expect(nags(h).length).toBe(1)
      // 台词必须是 NAG_FEED 池子里逐字的一条（真源在 copy.ts，不在这里手打）
      expect(PET.NAG_FEED as readonly string[]).toContain(nags(h)[0].text)
      // 戳一下把手感计时归零：免得"闲满 10 分钟"的主动搭话抢走下一拍的气泡
      // （miai 三条环境音一拍最多一句，那是另一条通道的用例）
      h.brain.act({ action: 'pat' })
      h.advance(gap)
      h.brain.tick()
      expect(nags(h).length).toBe(2)
      expect(nags(h)[1].text).not.toBe(nags(h)[0].text) // 同一条不连说两遍
      expect(h.brain.debugState().nagCount).toBe(2)
    }
  })

  it('催饭：主窗没焦点不催，且不烧节拍 —— 人一回来看下一拍立刻催', () => {
    const h = makeHarness({
      focused: false,
      seed: { satiety: PET_HUNGER_SEVERE_AT + 10 },
      deps: QUIET_DEPS
    })
    h.advance(5 * 60_000) // 早过 severe 的 90s 节拍，但在别的软件里干正事
    h.brain.tick()
    expect(nags(h).length).toBe(0)
    expect(h.brain.debugState().nagCount).toBe(0)
    // 切回主窗、时钟不动 → 立刻催（"没焦点"这几拍没把节拍烧掉）
    h.setFocused(true)
    h.brain.tick()
    expect(nags(h).length).toBe(1)
  })

  it('催饭：归零不催（那档是死机）；喂回饭后第一拍就催 —— 饿期的节拍没被烧', () => {
    const h = makeHarness({
      focused: true,
      seed: { satiety: 1, rice: 1 },
      deps: QUIET_DEPS
    })
    h.advance(PET_DECAY_ONLINE_PERIOD_MS)
    h.brain.tick()
    expect(h.brain.debugState().satiety).toBe(0) // 尺子自证：真的走到归零档了
    h.advance(20 * 60_000)
    h.brain.tick()
    expect(nags(h).length).toBe(0)
    // 喂一碗（+20 = medium）：下一拍立刻催，不用再等一个节拍
    h.brain.act({ action: 'feed' })
    expect(h.brain.debugState().satiety).toBe(PET_FEED_GAIN)
    h.brain.tick()
    expect(nags(h).length).toBe(1)
  })

  it('撒娇节拍：love 档每 4 分钟蹭一下（NUZZLE 动画 + affection 池台词）；差 1ms 不蹭、不挂焦点门', () => {
    // 尺子自证：池子非空 —— 空池子的话宿主那句台词静默失踪（假绿）
    expect(QUIP_POOL.affection.length).toBeGreaterThan(0)
    const h = makeHarness({
      focused: false, // 撒娇是环境音不是请求：主窗没焦点也蹭
      seed: { satiety: 90, affection: PET_AFFECTION_LOVE_AT },
      deps: QUIET_DEPS
    })
    h.advance(NUZZLE_GAP_MS - 1)
    h.brain.tick()
    expect(h.quips).toEqual([])
    expect(h.anims).toEqual([])
    h.advance(1)
    h.brain.tick()
    // logTag 只进这条记录（供探针对账），台词真源在 pet-quips 池子里由宿主挑
    expect(h.quips).toEqual([{ scene: 'affection', tag: 'love-nuzzle' }])
    expect(h.anims).toEqual([PET_DSH.ANIM.NUZZLE])
    expect(h.brain.debugState().nuzzleCount).toBe(1)
  })

  it('撒娇：非 love 档不蹭（差 1 点也不行）；归零档不蹭且不烧节拍 —— 喂回来立刻蹭', () => {
    const almost = makeHarness({
      focused: false,
      seed: { satiety: 90, affection: PET_AFFECTION_LOVE_AT - 1 },
      deps: QUIET_DEPS
    })
    expect(petAffectionTier(PET_AFFECTION_LOVE_AT - 1)).toBe('like') // 尺子自证：真的在门外
    almost.advance(NUZZLE_GAP_MS)
    almost.brain.tick()
    expect(almost.quips).toEqual([])
    expect(almost.brain.debugState().nuzzleCount).toBe(0)

    // 归零档：彻底死机趴桌面，撒娇与它矛盾
    const zero = makeHarness({
      focused: false,
      seed: { satiety: 0, affection: PET_AFFECTION_LOVE_AT, rice: 1 },
      deps: QUIET_DEPS
    })
    zero.advance(NUZZLE_GAP_MS)
    zero.brain.tick()
    expect(zero.quips).toEqual([])
    expect(zero.brain.debugState().nuzzleCount).toBe(0)
    // 喂一碗（20 点，love 档还在）→ 下一拍立刻蹭（死机期的节拍没被烧）
    zero.brain.act({ action: 'feed' })
    zero.brain.tick()
    expect(zero.quips).toEqual([{ scene: 'affection', tag: 'love-nuzzle' }])
  })

  it('饿脸节拍（V2-25）：脸色 hungry 每 3 分钟叹一口（HUNGRY 动画、不说话）；启动位播种、差 1ms 不叹、不挂焦点门', () => {
    // 尺子自证：这个饱食度真的落在"饿扁"脸上（挂错档的话后面全是假绿）
    const hungryState = { ...defaultPetState(iso(BASE_MS)), satiety: PET_MOOD_OK_AT - 1 }
    expect(petFace(hungryState, iso(BASE_MS))).toBe('hungry')
    const h = makeHarness({
      focused: false, // 环境音不是请求：主窗没焦点也叹（同 nuzzleTick）
      seed: { satiety: PET_MOOD_OK_AT - 1 },
      deps: QUIET_DEPS
    })
    // 启动位播种：出场问候自带动画，第一口叹气最早落在一个节拍之后
    h.brain.tick()
    expect(h.anims).toEqual([])
    h.advance(HUNGRY_FACE_GAP_MS - 1)
    h.brain.tick()
    expect(h.anims).toEqual([])
    h.advance(1)
    h.brain.tick()
    expect(h.anims).toEqual([PET_DSH.ANIM.HUNGRY])
    expect(h.says).toEqual([]) // 只动画面：气泡通道归 sob/nag，它一个字都不抢
    expect(h.brain.debugState().hungryFaceCount).toBe(1)
    expect(h.brain.debugState().lastHungryFaceAt).toBe(BASE_MS + HUNGRY_FACE_GAP_MS)
  })

  it('饿脸节拍：脸色不是 hungry 就不叹（33 这条线外——6 分钟也不叹）；归零档照叹（V1-50 的持续信号）', () => {
    // 33 分界：纯函数直接钉（不开时钟就不会被衰减搅进来）——33 是 ok 档，不是饿脸
    const okState = { ...defaultPetState(iso(BASE_MS)), satiety: PET_MOOD_OK_AT }
    expect(petFace(okState, iso(BASE_MS))).not.toBe('hungry')
    // 50（mild）：6 分钟在线衰减 3 点也到不了饿脸线，一口都不许叹
    const ok = makeHarness({ focused: false, seed: { satiety: PET_HUNGER_MILD_AT }, deps: QUIET_DEPS })
    ok.advance(6 * 60_000)
    ok.brain.tick()
    expect(ok.anims).toEqual([])
    expect(ok.brain.debugState().hungryFaceCount).toBe(0)

    // 归零档：说话通道只剩跨零那一记哭（seed 就在 0，第一拍补上），画面这条
    // 通道照旧每 3 分钟叹一口 —— "饿"在桌面上看得见（V1-50：不只是那一秒的哭）
    const zero = makeHarness({ focused: false, seed: { satiety: 0, rice: 1 }, deps: QUIET_DEPS })
    zero.advance(HUNGRY_FACE_GAP_MS)
    zero.brain.tick()
    expect(zero.anims).toEqual([PET_DSH.ANIM.HUNGRY])
    expect(zero.says).toEqual([{ text: PET.HUNGRY_SOB, tag: 'hungry-sob' }])
  })

  it('饿脸与撒娇同拍到期：饿脸让位（同拍两条动画互相打断），下一拍补上、不烧节拍', () => {
    const h = makeHarness({
      focused: false,
      seed: { satiety: PET_HUNGER_SEVERE_AT + 10, affection: PET_AFFECTION_LOVE_AT },
      deps: QUIET_DEPS
    })
    h.advance(NUZZLE_GAP_MS) // 4 分钟：撒娇(4min)与饿脸(3min)同时到期
    h.brain.tick()
    // 让位：撒娇是"气泡+动画"成套的那条，饿脸只是画面，下一拍再叹
    expect(h.anims).toEqual([PET_DSH.ANIM.NUZZLE])
    expect(h.brain.debugState().hungryFaceCount).toBe(0)
    h.advance(30_000)
    h.brain.tick()
    expect(h.anims).toEqual([PET_DSH.ANIM.NUZZLE, PET_DSH.ANIM.HUNGRY])
    expect(h.brain.debugState().hungryFaceCount).toBe(1)
  })

  it('冷漠抑制：好感 <20 条件全满足也不主动搭话（与饿扁分开记、冷却不烧）；喂回 20 立刻能搭话', () => {
    const h = makeHarness({
      focused: true,
      seed: { satiety: 90, affection: PET_AFFECTION_FAMILIAR_AT - 2, rice: 1 },
      deps: QUIET_DEPS
    })
    expect(petAffectionTier(PET_AFFECTION_FAMILIAR_AT - 2)).toBe('cold') // 尺子自证
    // 主动搭话的条件全满足（有焦点 + 闲满 10 分钟），冷着的它就是不凑过来
    h.advance(10 * 60_000)
    h.brain.tick()
    expect(proactives(h).length).toBe(0)
    expect(h.brain.debugState().coldSuppressed).toBeGreaterThanOrEqual(1)
    // 与归零档分开记：这次"没说话"的理由是冷漠，不是饿（探针要能分流）
    expect(h.brain.debugState().proactiveSuppressed).toBe(0)
    // 喂一碗：18 → 20（familiar），冷门松开。20 分钟冷却没被冷期偷走 ——
    // 再闲满 10 分钟立刻开口（若冷期烧了 lastProactiveAt，这一步是静的）
    h.brain.act({ action: 'feed' })
    // 18 + 2 = 20 = familiar 的闭下界（上面那条尺子自证了 19 还在 cold）
    expect(h.brain.debugState().affection).toBe(PET_AFFECTION_FAMILIAR_AT)
    h.advance(10 * 60_000)
    h.brain.tick()
    expect(proactives(h).length).toBe(1)
  })

  it('跑腿门槛：重度饥饿（1-19）报错功能关闭 —— 有落点也不出动、不扣费、不吃冷却；喂到 20 立刻出动', () => {
    const RECT = { x: 100, y: 200, width: 300, height: 40 }
    const FAIL = { ok: false, kind: 'compile', line: 5, rect: RECT }
    // 尺子自证：这条门槛与饥饿档表必须是同一根线（19 = severe 顶格、20 = medium）
    expect(petHungerTier(PET_HUNGER_MEDIUM_AT - 1)).toBe('severe')
    expect(petHungerTier(PET_HUNGER_MEDIUM_AT)).toBe('medium')

    const stub = chaseStub()
    const h = makeHarness({
      seed: { satiety: PET_HUNGER_MEDIUM_AT - 1, rice: 1 },
      deps: { chase: stub.chase }
    })
    h.brain.reportRun(FAIL)
    expect(stub.calls).toEqual([]) // 一个 goto 都不写
    expect(h.says).toEqual([]) // 这一档的嘴归催饭节拍，不归这里
    // 两条日志各说各的事：跑腿为什么跳过 + 降级链为什么静默（带档位）
    expect(h.logs).toContain(`chase skipped (hungry ${PET_HUNGER_MEDIUM_AT - 1})`)
    expect(h.logs).toContain('run-err dropped (severe)')
    expect(h.brain.debugState().lastChaseAt).toBe(0) // 不吃 30s 冷却
    expect(h.brain.debugState().satiety).toBe(PET_HUNGER_MEDIUM_AT - 1) // 不扣跑腿费
    expect(h.brain.debugState().pendingChaseSeq).toBe(0)
    // 喂一碗（19 → 39）：立刻能出动 —— 门槛拦的是"没饭吃"，不是"刚吃完饭"
    h.brain.act({ action: 'feed' })
    h.brain.reportRun(FAIL)
    expect(stub.calls).toEqual([[100 + 300 + 72, 200 + 40 / 2]])
    expect(h.brain.debugState().pendingChaseSeq).toBe(101)
  })
})

// ---------------------------------------------------------------- 运行奖（own → 大白饭）

describe('运行奖：指纹去重 / 日上限 / 顶掉口头表扬 / 两条路共用一本账', () => {
  /** 合法指纹形状（同 shared/code-hash 的产出：长度(36进制):FNV(十六进制)） */
  const FP = '12:abcdef01'

  it('自己写的代码跑通：发奖台词 + 表扬动画 + 饭 +1 + 记账 + 记忆环', () => {
    const h = makeHarness({})
    h.brain.reportRun({ ok: true, kind: 'run', line: null, rect: null, own: true, hash: FP })
    expect(h.says).toEqual([{ text: PET.RUN_REWARD[0], tag: 'run-reward' }])
    expect(h.anims).toEqual([PET_DSH.ANIM.PRAISE])
    expect(h.current().rice).toBe(1)
    expect(h.current().earnedTotal).toBe(1)
    expect(h.brain.debugState().runRewardsToday).toBe(1)
    expect(h.brain.debugState().runLedgerCount).toBe(1)
    // "刚跑通过"照样进记忆环 —— 发奖与聊天上下文是两回事
    expect(h.current().memory.events[0].kind).toBe('run-ok')
  })

  it('发奖顶掉这一轮口头表扬：紧接着的普通跑通不冒泡（不是两连发）', () => {
    const h = makeHarness({})
    h.brain.reportRun({ ok: true, kind: 'run', line: null, rect: null, own: true, hash: FP })
    h.brain.reportRun({ ok: true, kind: 'run', line: null, rect: null })
    expect(h.says.length).toBe(1)
    expect(h.says[0].tag).toBe('run-reward')
  })

  it('同一份指纹只发一次：重复跑不再涨饭；隔天同指纹仍然不发（去重跨天保留）', () => {
    const h = makeHarness({})
    const run = { ok: true, kind: 'run', line: null, rect: null, own: true, hash: FP }
    h.brain.reportRun(run)
    h.brain.reportRun(run)
    expect(h.current().rice).toBe(1)
    expect(h.brain.debugState().runRewardsToday).toBe(1)
    expect(h.says.length).toBe(1)
    h.advance(DAY_MS)
    h.brain.reportRun(run)
    expect(h.current().rice).toBe(1)
  })

  it('「证据不全」不发奖：hash 形状非法 / hash 缺省 → 退回普通表扬', () => {
    const bad = makeHarness({})
    bad.brain.reportRun({ ok: true, kind: 'run', line: null, rect: null, own: true, hash: 'NOT-HEX' })
    expect(bad.says[0].tag).toBe('run-ok') // PRAISE_RUN，不是 run-reward
    expect(bad.current().rice).toBe(0)
    const none = makeHarness({})
    none.brain.reportRun({ ok: true, kind: 'run', line: null, rect: null, own: true, hash: null })
    expect(none.says[0].tag).toBe('run-ok')
    expect(none.current().rice).toBe(0)
  })

  it('日上限 10：今天发满后新指纹也不发；隔天计数重置可再发', () => {
    const h = makeHarness({
      seed: {
        runLedger: { day: petDayKey(iso(BASE_MS)), count: PET_RUN_REWARD_DAILY_MAX, hashes: [] }
      }
    })
    h.brain.reportRun({ ok: true, kind: 'run', line: null, rect: null, own: true, hash: FP })
    expect(h.current().rice).toBe(0)
    expect(h.brain.debugState().runRewardsToday).toBe(PET_RUN_REWARD_DAILY_MAX)
    h.advance(DAY_MS)
    h.brain.reportRun({ ok: true, kind: 'run', line: null, rect: null, own: true, hash: FP })
    expect(h.current().rice).toBe(1)
  })

  it('grantRun（原生路径）：发奖 / 同指纹拒发 / 垃圾指纹拒发 / 戳"人在"', () => {
    const h = makeHarness({})
    h.advance(5_000)
    expect(h.brain.grantRun(FP)).toBe(true)
    expect(h.says).toEqual([{ text: PET.RUN_REWARD[0], tag: 'run-reward' }])
    expect(h.brain.debugState().idleMs).toBe(0) // 编译成功算"主人刚干过活"
    expect(h.brain.grantRun(FP)).toBe(false)
    expect(h.brain.grantRun('not a fingerprint')).toBe(false)
    expect(h.current().rice).toBe(1)
    expect(h.says.length).toBe(1)
  })

  it('原生与内置两条路共用一本账：同指纹在另一条路上不再发', () => {
    const h = makeHarness({})
    expect(h.brain.grantRun(FP)).toBe(true)
    h.brain.reportRun({ ok: true, kind: 'run', line: null, rect: null, own: true, hash: FP })
    expect(h.current().rice).toBe(1)
    // grantRun 的奖同样顶了表扬冷却 → 这条重跑一句都不冒
    expect(h.says.length).toBe(1)
  })
})

// ---------------------------------------------------------------- 出场问候

describe('出场问候：四档选择（away > 饿 > 夜 > 平常）', () => {
  it('≥48h 没见 → 好几天不见档', () => {
    const h = makeHarness({
      seed: {
        satiety: 90,
        memory: { ...defaultPetMemory(iso(BASE_MS)), lastSeenAt: iso(BASE_MS - 2 * DAY_MS) }
      }
    })
    h.brain.greet()
    expect(h.says[0].tag).toBe('greet:away')
  })

  it('多日不见盖过"饿"：两天没来必然也饿，但先回应"你去哪儿了"', () => {
    const h = makeHarness({
      seed: {
        satiety: 0,
        memory: { ...defaultPetMemory(iso(BASE_MS)), lastSeenAt: iso(BASE_MS - 3 * DAY_MS) }
      }
    })
    h.brain.greet()
    expect(h.says[0].tag).toBe('greet:away')
  })

  it('饿扁了（away 短）→ 求喂饭档', () => {
    const h = makeHarness({ seed: { satiety: 5 } })
    h.brain.greet()
    expect(h.says[0].tag).toBe('greet:hungry')
    expect(PET.GREETING_HUNGRY as readonly string[]).toContain(h.says[0].text)
  })

  it('深夜（away 短、不饿）→ 打哈欠档', () => {
    const h = makeHarness({ nowMs: NIGHT_MS, seed: { satiety: 80 } })
    h.brain.greet()
    expect(h.says[0].tag).toBe('greet:sleepy')
    expect(PET.GREETING_SLEEPY as readonly string[]).toContain(h.says[0].text)
  })

  it('平常 → 傲娇问候三条之一', () => {
    const h = makeHarness({ seed: { satiety: 80 } })
    h.brain.greet()
    expect(h.says[0].tag).toBe('greet')
    expect(PET.GREETING as readonly string[]).toContain(h.says[0].text)
  })
})

// ---------------------------------------------------------------- 心跳

describe('心跳：衰减 / 饿嘟囔 / CPU / 主动搭话', () => {
  it('在线衰减按 2min/-1（比离线的 6min 快）；不满一个周期一动不动', () => {
    // 预期一律从 PET_DECAY_ONLINE_PERIOD_MS 派生（P3 ③ 拍板改过周期值）
    const h = makeHarness({ seed: { satiety: 10 } })
    h.advance(PET_DECAY_ONLINE_PERIOD_MS)
    h.brain.tick()
    expect(h.brain.init().satiety).toBe(9)
    h.advance(PET_DECAY_ONLINE_PERIOD_MS)
    h.brain.tick()
    expect(h.brain.init().satiety).toBe(8)
    h.advance(PET_DECAY_ONLINE_PERIOD_MS - 1) // 差 1ms：不够一个整周期，不动
    h.brain.tick()
    expect(h.brain.init().satiety).toBe(8)
    // 尺子自证：两个速率必须真的不同 —— 同值的话这条测试什么都证明不了
    expect(PET_DECAY_ONLINE_PERIOD_MS).not.toBe(PET_DECAY_OFFLINE_PERIOD_MS)
  })

  it('饿到见底嘟囔一次；之后不再念；回饱后可以再触发一次', () => {
    const h = makeHarness({ seed: { satiety: 1, rice: 1 } })
    h.advance(PET_DECAY_ONLINE_PERIOD_MS)
    h.brain.tick()
    expect(h.brain.init().satiety).toBe(0)
    expect(h.says).toEqual([{ text: PET.HUNGRY_SOB, tag: 'hungry-sob' }])
    // 已是 0：再饿也不会再喊（dropped=0，且 sobbed 挡着）
    h.advance(10 * PET_DECAY_ONLINE_PERIOD_MS)
    h.brain.tick()
    expect(h.says.length).toBe(1)
    // 喂一碗回到 20 → sobbed 复位；再掉到 0 → 再喊一次
    h.brain.act({ action: 'feed' })
    expect(h.brain.debugState().satiety).toBe(20)
    h.brain.tick()
    expect(h.brain.debugState().sobbed).toBe(false)
    h.advance(20 * PET_DECAY_ONLINE_PERIOD_MS)
    h.brain.tick()
    expect(h.brain.init().satiety).toBe(0)
    expect(h.says.filter((s) => s.tag === 'hungry-sob').length).toBe(2)
  })

  it('CPU：连续两次心跳 ≥90% 才冒泡；10 分钟冷却', () => {
    let cpu = { idle: 0, total: 0 }
    const h = makeHarness({ deps: { sampleCpu: () => ({ ...cpu }) } })
    // 心跳 1：只记基线
    h.brain.tick()
    expect(h.says.length).toBe(0)
    // 心跳 2：95% → 连续 1 次
    cpu = { idle: 50, total: 1_000 }
    h.advance(PET_HEARTBEAT_MS)
    h.brain.tick()
    expect(h.says.length).toBe(0)
    // 心跳 3：又 95% → 连续 2 次 → 冒泡
    cpu = { idle: 100, total: 2_000 }
    h.advance(PET_HEARTBEAT_MS)
    h.brain.tick()
    expect(h.says).toEqual([{ text: PET.CPU_HOT, tag: 'cpu-hot' }])
    // 心跳 4：仍然热，但 10 分钟冷却内 → 闭嘴
    cpu = { idle: 150, total: 3_000 }
    h.advance(PET_HEARTBEAT_MS)
    h.brain.tick()
    expect(h.says.filter((s) => s.tag === 'cpu-hot').length).toBe(1)
    // 过 10 分钟再热 → 再冒泡
    //（这 10 分钟也会掉 5 点饱食度 80→75、跨一档报条档位台词——那是另一条通道，
    //  本条只看 cpu-hot 计数，档位通道有各自的用例）
    cpu = { idle: 200, total: 4_000 }
    h.advance(10 * 60_000)
    h.brain.tick()
    expect(h.says.filter((s) => s.tag === 'cpu-hot').length).toBe(2)
  })

  it('CPU：中途降下来会打断"连续"计数（单次高温不算数）', () => {
    let cpu = { idle: 0, total: 0 }
    const h = makeHarness({ deps: { sampleCpu: () => ({ ...cpu }) } })
    h.brain.tick() // 基线
    cpu = { idle: 50, total: 1_000 } // 95%
    h.advance(PET_HEARTBEAT_MS)
    h.brain.tick()
    cpu = { idle: 500, total: 2_000 } // 50%：打断
    h.advance(PET_HEARTBEAT_MS)
    h.brain.tick()
    cpu = { idle: 550, total: 3_000 } // 95%：重新数到 1
    h.advance(PET_HEARTBEAT_MS)
    h.brain.tick()
    expect(h.says.length).toBe(0)
  })

  it('主动搭话：主窗没焦点 / 没到 10 分钟，都不开口', () => {
    // 档位台词（饿到跨档自动报一次）与"主动搭话"是两条通道：
    // 这里只数 proactive 通道，档位通道另有专门用例。
    const proactiveCount = (h: Harness): number => h.says.filter((s) => s.tag === 'proactive').length
    const h = makeHarness({ focused: false })
    h.advance(11 * 60_000)
    h.brain.tick()
    expect(proactiveCount(h)).toBe(0) // 没焦点
    h.setFocused(true)
    const h2 = makeHarness({ focused: true })
    h2.advance(9 * 60_000)
    h2.brain.tick()
    expect(proactiveCount(h2)).toBe(0) // 还没到闲 10 分钟
  })

  it('主动搭话：闲 10 分钟开口一次，20 分钟冷却；喂饭会重置"闲"的计时', () => {
    const h = makeHarness({ focused: true, seed: { rice: 1, satiety: 90 } })
    // 只数 proactive 通道（档位台词是另一条通道，另有专门用例）
    const proactiveSays = (): { text: string; tag: string }[] =>
      h.says.filter((s) => s.tag === 'proactive')
    h.advance(10 * 60_000)
    h.brain.tick()
    expect(proactiveSays().length).toBe(1)
    expect(PET.PROACTIVE as readonly string[]).toContain(proactiveSays()[0].text)
    // 冷却内：再闲也不说
    h.advance(15 * 60_000)
    h.brain.tick()
    expect(proactiveSays().length).toBe(1)
    // 喂饭戳了 lastActivityAt：「闲」的计时归零 —— 5 分钟后再说就是错的
    h.brain.act({ action: 'feed' })
    h.advance(5 * 60_000)
    h.brain.tick()
    expect(proactiveSays().length).toBe(1)
    // 再闲满 10 分钟（冷却也早过了）→ 第二次开口
    h.advance(5 * 60_000)
    h.brain.tick()
    expect(proactiveSays().length).toBe(2)
  })

  it('有错题记忆时：优先说"上次那道题"（比通用搭话真的有用）', () => {
    const h = makeHarness({ focused: true })
    h.brain.act({ action: 'wrong', title: TITLE, order: 3, learned: true })
    h.advance(10 * 60_000)
    h.brain.tick()
    const last = h.says[h.says.length - 1]
    expect(last).toEqual({ text: PET.PROACTIVE_MEMORY(TITLE), tag: 'proactive-memory' })
  })
})

// ---------------------------------------------------------------- P3 ③ 饥饿档：跃迁 / 降级 / 静默 / vitals

describe('饥饿档跃迁（P3 ③）：跨档说一次，同档连 tick 不再出', () => {
  const tierSays = (h: Harness): { text: string; tag: string }[] =>
    h.says.filter((s) => s.tag.startsWith('hunger-tier:'))

  it('衰减跨档：full→mild 播一次；同档继续掉不再重复；再跨只播新档', () => {
    // sampleCpu 注入成"零增量"：本用例的读数只看台词，不让真机 CPU 采样掺进来
    const h = makeHarness({
      seed: { satiety: PET_HUNGER_FULL_AT },
      deps: { sampleCpu: () => ({ idle: 0, total: 0 }) }
    }) // 80 = full（闭下界）
    h.advance(PET_DECAY_ONLINE_PERIOD_MS)
    h.brain.tick() // 80 → 79：full → mild
    expect(tierSays(h)).toEqual([{ text: PET.HUNGER_MILD, tag: 'hunger-tier:mild' }])
    h.advance(PET_DECAY_ONLINE_PERIOD_MS)
    h.brain.tick() // 79 → 78：同档，一个字都不许多说
    expect(tierSays(h).length).toBe(1)
    h.advance(29 * PET_DECAY_ONLINE_PERIOD_MS)
    h.brain.tick() // 78 → 49：一次跨到 medium，也只播一次（说"当前档"）
    expect(tierSays(h).map((s) => s.tag)).toEqual(['hunger-tier:mild', 'hunger-tier:medium'])
    expect(tierSays(h)[1].text).toBe(PET.HUNGER_MEDIUM)
  })

  it('喂饭回升跨档同样播，且排在喂饭台词前面（气泡最后停在"嚼嚼"上）', () => {
    const h = makeHarness({ seed: { satiety: 10, rice: 1 } })
    expect(petHungerTier(10)).toBe('severe') // 尺子自证：这口饭真的从 severe 出发
    h.brain.act({ action: 'feed' }) // 10 → 30：severe → medium
    expect(h.says.map((s) => s.tag)).toEqual(['hunger-tier:medium', 'feed-ok'])
    expect(h.says[0].text).toBe(PET.HUNGER_MEDIUM)
  })

  it('静默对齐：不播报的改动（聊天扣体力）也把基线挪过去 —— 否则回升时会漏播', () => {
    const h = makeHarness({ seed: { satiety: 21, rice: 1 } }) // 21 = medium
    h.brain.chatCommit(10) // 21 → 19（-PET_CHAT_COST）：medium → severe，但这条改动静默
    expect(tierSays(h).length).toBe(0)
    h.brain.act({ action: 'feed' }) // 19 → 39：severe → medium
    // 若 lastTier 停在 'medium' 没跟着静默改动走，这一步的 t1 也是 medium，
    // 什么都不播 —— 下面的断言就是咬住那种实现
    expect(tierSays(h).map((s) => s.tag)).toEqual(['hunger-tier:medium'])
  })
})

describe('0 档静默（P3 ③）：brain 入口逐个调用，之后彻底安静且可归因', () => {
  it('主动搭话 / CPU 吐槽：条件全满足也闭麦，且各记一次——喂回饭后闸门松开（冷却没被烧掉）', () => {
    let cpu = { idle: 0, total: 0 }
    const h = makeHarness({
      focused: true,
      seed: { satiety: 0, rice: 1 },
      deps: { sampleCpu: () => ({ ...cpu }) }
    })
    // 主动搭话的条件全满足（有焦点 + 闲满 10 分钟），0 档也不许开口
    h.advance(10 * 60_000)
    h.brain.tick()
    expect(h.says.filter((s) => s.tag.startsWith('proactive')).length).toBe(0)
    expect(h.brain.debugState().proactiveSuppressed).toBeGreaterThanOrEqual(1)
    // CPU：连续两个心跳 ≥90% 也不吐槽；但**采样继续**（cpuStreak 在涨 ——
    // 恢复后的第一次差分不会被饿期稀释成假阴性）
    cpu = { idle: 50, total: 1_000 }
    h.advance(PET_HEARTBEAT_MS)
    h.brain.tick()
    cpu = { idle: 100, total: 2_000 }
    h.advance(PET_HEARTBEAT_MS)
    h.brain.tick()
    expect(h.says.filter((s) => s.tag === 'cpu-hot').length).toBe(0)
    expect(h.brain.debugState().cpuSuppressed).toBeGreaterThanOrEqual(1)
    expect(h.brain.debugState().cpuStreak).toBeGreaterThanOrEqual(2)
    // 喂一碗（+20）：归零段唯一被契约放行的出声是喂饭回复 + 一次叹息
    h.brain.act({ action: 'feed' })
    expect(h.brain.debugState().satiety).toBe(PET_FEED_GAIN)
    // 下一拍热读数照说 —— CPU 冒泡的 10 分钟冷却**没有**被饿期偷走
    cpu = { idle: 150, total: 3_000 }
    h.advance(PET_HEARTBEAT_MS)
    h.brain.tick()
    expect(h.says.filter((s) => s.tag === 'cpu-hot').length).toBe(1)
    // 全程：一次 hungry-sob、一条回升档台词、一条 cpu-hot。**外加解冻后的一声
    // 催饭**（2026-10-09 补充模块一②）：饿着的那整段 nag 一直被 0 档门挡着、
    // 节拍没被烧，喂到 20（medium）后第一拍就该催 —— "碗又空了"此刻字面为真
    //（那一碗刚把饭盒吃空），这正是"持续催促喂饭"的样子。
    expect(h.says.map((s) => s.tag).sort()).toEqual(
      ['cpu-hot', 'feed-ok', 'hunger-tier:medium', 'hungry-sob', 'nag'].sort()
    )
  })

  it('报错：无落地点的 empty 档彻底不说但留痕；有落点走"饿扁拒跑"（唯一例外，且不写 goto）', () => {
    const stub = chaseStub()
    const h = makeHarness({
      seed: { satiety: 0, rice: 1 },
      deps: { chase: stub.chase, sampleCpu: () => ({ idle: 0, total: 0 }) }
    })
    // rect=null（没有报错框可跑）：连报错台词都没有，只留一行日志
    h.brain.reportRun({ ok: false, kind: 'compile', line: 5, rect: null })
    expect(h.says).toEqual([])
    expect(h.logs.filter((l) => l === 'run-err dropped (empty)').length).toBe(1)
    // rect 有：饿扁拒跑 —— 出声是在回答用户刚按下的"跑"，但一个 goto 都不写
    h.brain.reportRun({ ok: false, kind: 'compile', line: 5, rect: { x: 1, y: 2, width: 3, height: 4 } })
    expect(stub.calls.length).toBe(0)
    expect(h.says).toEqual([{ text: PET.CHASE_HUNGRY[0], tag: 'chase-hungry' }])
    expect(h.brain.debugState().pendingChaseSeq).toBe(0)
    // 归零这一跳不播档台词（台词层 empty 缺席）；饿叹只叹一次，之后每拍都不再出声
    h.advance(PET_DECAY_ONLINE_PERIOD_MS)
    h.brain.tick()
    expect(h.says.filter((s) => s.tag === 'hungry-sob').length).toBe(1)
    expect(h.says.filter((s) => s.tag.startsWith('hunger-tier:')).length).toBe(0)
    h.advance(10 * PET_DECAY_ONLINE_PERIOD_MS)
    h.brain.tick()
    expect(h.says.filter((s) => s.tag === 'hungry-sob').length).toBe(1)
    expect(h.says.length).toBe(2) // 全程就这两条：chase-hungry + 一次 hungry-sob
  })
})

describe('报错降级矩阵（P3 ③）：5 档 × 没过/跑通', () => {
  const FAIL = { ok: false, kind: 'compile', line: 5, rect: null }
  // severe 自 2026-10-09 起也是 null（补充模块一②「报错功能关闭」）——
  // 它不再说 ERR_WEARY；静默的**理由**从日志档位读，不靠猜。
  const ROWS: [number, string, string | null][] = [
    [PET_HUNGER_FULL_AT + 10, 'full', PET.ERR_COMPILE_LINE(5)],
    [PET_HUNGER_MILD_AT + 5, 'mild', PET.ERR_COMPILE_LINE(5)],
    [PET_HUNGER_MEDIUM_AT + 5, 'medium', PET.ERR_IMPATIENT],
    [PET_HUNGER_SEVERE_AT + 5, 'severe', null],
    [0, 'empty', null]
  ]
  for (const [satiety, tier, line] of ROWS) {
    it(`${tier}（satiety=${satiety}）：没过 → ${line === null ? '不说但留痕' : '说对应档台词'}；跑通 → 表扬照旧`, () => {
      expect(petHungerTier(satiety)).toBe(tier) // 代表值真落在这一档（档表漂了这条先红）
      const fail = makeHarness({ seed: { satiety } })
      fail.brain.reportRun(FAIL)
      if (line === null) {
        expect(fail.says).toEqual([])
        // 留痕带**档位**：severe 与 empty 的静默是两种行为（关功能 / 死机），
        // 探针与人都要能分流 —— 同一个 'starving' 曾把两者混成一条。
        expect(fail.logs.filter((l) => l === `run-err dropped (${tier})`).length).toBe(1)
      } else {
        expect(fail.says).toEqual([{ text: line, tag: 'run-err' }])
      }
      // 跑通支：成功路径整个不随档位变（0 档的静默在宿主叶子闸门 —— say-gate.test.ts）
      const ok = makeHarness({ seed: { satiety } })
      ok.brain.reportRun({ ok: true, kind: 'run', line: null, rect: null })
      expect(ok.says.length).toBe(1)
      expect(ok.says[0].tag).toBe('run-ok')
      expect(PET.PRAISE_RUN as readonly string[]).toContain(ok.says[0].text)
    })
  }
})

describe('vitals 推送（P3 ③④）：变才推、指纹去重、affection 与 satiety 同刻', () => {
  it('构造即推一份；没变化一拍不推；喂饭/摸头/聊天/衰减各推一份且形态完整', () => {
    const pushes: PetVitals[] = []
    const h = makeHarness({
      seed: { satiety: 50, rice: 2 },
      deps: {
        sampleCpu: () => ({ idle: 0, total: 0 }), // 心跳的 CPU 支路受控（本用例只看推送）
        vitals: (v) => pushes.push({ ...v })
      }
    })
    // 构造就推：菜单可能在第一次心跳之前被打开，读不到读数就不画进度条
    expect(pushes.length).toBe(1)
    expect(pushes[0]).toEqual({
      satiety: 50,
      rice: 2,
      mood: petMood(50),
      affection: PET_AFFECTION_INITIAL
    })
    // 心跳没衰减：指纹不变，一条都不多推（counter 严格递增的前提）
    h.advance(PET_HEARTBEAT_MS)
    h.brain.tick()
    expect(pushes.length).toBe(1)
    // 喂饭：satiety +20、饭盒 -1、好感 +2（P3 ④ 同刻进同一份读数）
    h.brain.act({ action: 'feed' })
    expect(pushes.length).toBe(2)
    expect(pushes[1]).toEqual({
      satiety: 50 + PET_FEED_GAIN,
      rice: 1,
      mood: petMood(50 + PET_FEED_GAIN),
      affection: PET_AFFECTION_INITIAL + PET_AFFECTION_RULES.feed.delta
    })
    // 摸头（V1-46）：饱食度不动（一点不涨）也推 —— 好感 +1 同刻带上，读数照发
    h.advance(1200)
    h.brain.act({ action: 'pat' })
    expect(pushes.length).toBe(3)
    expect(pushes[2].satiety).toBe(50 + PET_FEED_GAIN)
    expect(pushes[2].affection).toBe(
      PET_AFFECTION_INITIAL + PET_AFFECTION_RULES.feed.delta + PET_AFFECTION_RULES.pat.delta
    )
    // 聊天扣体力：-2 也推（好感不动 —— 聊天不在计分表里，读数也不该动）
    h.brain.chatCommit(10)
    expect(pushes.length).toBe(4)
    expect(pushes[3].satiety).toBe(50 + PET_FEED_GAIN - 2)
    expect(pushes[3].affection).toBe(pushes[2].affection)
    // 衰减：推（2 分钟 < 24h，好感同一指纹里但值不变）
    h.advance(PET_DECAY_ONLINE_PERIOD_MS)
    h.brain.tick()
    expect(pushes.length).toBe(5)
    expect(pushes[4].satiety).toBe(pushes[3].satiety - 1)
    expect(pushes[4].affection).toBe(pushes[3].affection)
    // 每一份的 mood 都由 satiety 现算（宿主不重算、这边也不许自己编）
    for (const p of pushes) expect(p.mood).toBe(petMood(p.satiety))
    // 顺带：mood 真的会跟着跨档变（50 是 ok，70 还在 ok，别把恒等当证据）
    expect(petMood(30)).toBe('hungry')
    expect(petMood(70)).toBe('happy')
  })
})

// ---------------------------------------------------------------- P3 ④ 好感度：计分接入 / 跨档播报 / 衰减 / 上限

/**
 * debugState() 是对外读数口（`Record<string, unknown>`，字段多而杂）。
 * 本节要点名读 `affectionDay.counts` 这类嵌套字段 —— 收窄一处比六处 `as` 稳：
 * 真源字段改名时这里读到的会是 undefined，下游断言当场红，不是静默假绿。
 */
const dbgAff = (
  h: Harness
): {
  affection: number
  lastAffectionAt: number
  affectionDay: { day: string; counts: Record<string, number> }
  affectionUp: number
  affectionDown: number
  affectionCapped: number
} =>
  h.brain.debugState() as unknown as {
    affection: number
    lastAffectionAt: number
    affectionDay: { day: string; counts: Record<string, number> }
    affectionUp: number
    affectionDown: number
    affectionCapped: number
  }

describe('好感度计分接入（P3 ④）：动作/事件各记各的，跨档只在越界那次 quip', () => {
  it('喂饭 +2：跨进 close 播一次 affection-up；同档再摸不再报', () => {
    // 从 38 出发（familiar），+2 正好踩到 40（close 的闭下界）
    const h = makeHarness({ seed: { rice: 1, affection: PET_AFFECTION_CLOSE_AT - 2 } })
    // 尺子自证：40 属于 close（档表漂了这条先红）；邻居两档也各钉一个代表值
    expect(petAffectionTier(PET_AFFECTION_CLOSE_AT)).toBe('close')
    expect(petAffectionTier(PET_AFFECTION_CLOSE_AT - 1)).toBe('familiar')
    expect(petAffectionTier(PET_AFFECTION_FAMILIAR_AT)).toBe('familiar')
    h.brain.act({ action: 'feed' })
    expect(h.brain.debugState().affection).toBe(PET_AFFECTION_CLOSE_AT)
    // 跨档了才播：方向和档位对都写进 tag 与日志（探针的次级判据，C3）
    expect(h.quips).toEqual([{ scene: 'affection', tag: 'affection-up' }])
    expect(h.brain.debugState().affectionUp).toBe(1)
    expect(h.brain.debugState().affectionDown).toBe(0)
    expect(h.logs).toContain('affection tier familiar -> close')
    // 同一档里再动一下（+1 → 41）：一个字都不许多报
    h.advance(1200)
    h.brain.act({ action: 'pat' })
    expect(h.brain.debugState().affection).toBe(PET_AFFECTION_CLOSE_AT + 1)
    expect(h.quips.length).toBe(1)
  })

  it('答错 -1：跌出 close 播一次 affection-down；台词 30s 冷却不拖累计分', () => {
    const h = makeHarness({ seed: { affection: PET_AFFECTION_CLOSE_AT } })
    const wrong = { action: 'wrong', title: TITLE, learned: true, order: 1 }
    h.brain.act(wrong) // 40 → 39：close → familiar
    expect(h.brain.debugState().affection).toBe(PET_AFFECTION_CLOSE_AT - 1)
    expect(h.quips).toEqual([{ scene: 'affection', tag: 'affection-down' }])
    expect(h.brain.debugState().affectionDown).toBe(1)
    expect(h.logs).toContain('affection tier close -> familiar')
    // 立刻再错一道：口播被 30s 冷却压住，但**计分照走**（两条闸互不隶属）；
    // 39 → 38 同档 → 不再播
    h.brain.act(wrong)
    expect(h.brain.debugState().affection).toBe(PET_AFFECTION_CLOSE_AT - 2)
    expect(h.quips.length).toBe(1)
  })

  it('收工事件：challenge +3、review +5 各自记；review 跨档升报 affection-up；各自日上限', () => {
    // 58（close）出发：review +5 恰好跨进 like（60 闭下界）
    const h = makeHarness({ seed: { affection: PET_AFFECTION_LIKE_AT - 2 } })
    expect(petAffectionTier(PET_AFFECTION_LIKE_AT - 2)).toBe('close')
    h.brain.act({ action: 'event', kind: 'review' })
    expect(h.brain.debugState().affection).toBe(PET_AFFECTION_LIKE_AT + 3)
    expect(h.quips).toEqual([{ scene: 'affection', tag: 'affection-up' }])
    expect(h.logs).toContain('affection tier close -> like')
    // review 今天第二次：no-op（cap 1），有痕、值不动
    h.brain.act({ action: 'event', kind: 'review' })
    expect(h.brain.debugState().affection).toBe(PET_AFFECTION_LIKE_AT + 3)
    expect(h.brain.debugState().affectionCapped).toBe(1)
    expect(h.logs).toContain('affection no-op: review (daily cap)')
    // challenge 是另一档账：照计 +3；第二次才 no-op
    h.brain.act({ action: 'event', kind: 'challenge' })
    expect(h.brain.debugState().affection).toBe(PET_AFFECTION_LIKE_AT + 6)
    h.brain.act({ action: 'event', kind: 'challenge' })
    expect(h.brain.debugState().affection).toBe(PET_AFFECTION_LIKE_AT + 6)
    expect(h.brain.debugState().affectionCapped).toBe(2)
    expect(h.logs).toContain('affection no-op: challenge (daily cap)')
    // 当日事件账原样可查（探针核"第 N+1 次 no-op"的读口）
    expect(h.brain.debugState().affectionDay).toEqual({
      day: petDayKey(iso(BASE_MS)),
      counts: { review: 1, challenge: 1 }
    })
    // 白名单外的 kind 整条作废（与 grant 的 reward 同口径）：留痕、不动分
    h.brain.act({ action: 'event', kind: 'nope' })
    expect(h.brain.debugState().affection).toBe(PET_AFFECTION_LIKE_AT + 6)
    expect(h.logs).toContain('act dropped: payload not parseable')
  })

  it('喂饭日上限：第 4 碗 no-op（值不动、计数不涨、留痕），跨档播报只在第 3 碗前发生', () => {
    const h = makeHarness({ seed: { rice: 4, satiety: 10 } })
    for (let i = 0; i < 4; i += 1) {
      if (i > 0) h.advance(1200) // 互动冷却
      h.brain.act({ action: 'feed' })
    }
    // 前 3 碗每碗 +2：50 → 56；第 4 碗被 cap 拦（56 < 60，全程没跨档）
    expect(h.brain.debugState().affection).toBe(
      PET_AFFECTION_INITIAL + 3 * PET_AFFECTION_RULES.feed.delta
    )
    expect(h.brain.debugState().affectionCapped).toBe(1)
    expect(h.logs.filter((l) => l === 'affection no-op: feed (daily cap)').length).toBe(1)
    expect(h.brain.debugState().affectionDay).toEqual({
      day: petDayKey(iso(BASE_MS)),
      counts: { feed: 3 }
    })
    expect(h.quips).toEqual([])
  })

  it('表外动因一个字都不动：chatCommit / reportRun(跑通) / grantRun 前后好感一致', () => {
    const h = makeHarness({ seed: { satiety: 90 } })
    h.brain.chatCommit(10)
    expect(h.brain.debugState().affection).toBe(PET_AFFECTION_INITIAL)
    h.brain.reportRun({ ok: true, kind: 'run', line: null, rect: null })
    expect(h.brain.debugState().affection).toBe(PET_AFFECTION_INITIAL)
    expect(h.brain.grantRun('12:abcdef01')).toBe(true)
    expect(h.brain.debugState().affection).toBe(PET_AFFECTION_INITIAL)
    expect(dbgAff(h).affectionDay.counts).toEqual({})
    expect(h.quips).toEqual([])
  })
})

describe('好感度衰减与久离（P3 ④）：锚点法 / 时钟回拨 / -5 与 -2 的 cap', () => {
  it('跨 3 天恰 -3：锚点按整周期推进（零头留在锚里，不跳到 now）', () => {
    // satiety 0 出发：饿扁时 dropped 恒为 0，把"挨饿到 0 -2"那条支路隔离掉，
    // 本用例只看好感衰减这一条
    const h = makeHarness({ seed: { satiety: 0, affection: PET_AFFECTION_INITIAL } })
    for (let i = 0; i < 3; i += 1) {
      h.advance(DAY_MS)
      h.brain.tick()
    }
    expect(h.brain.debugState().affection).toBe(PET_AFFECTION_INITIAL - 3)
    expect(h.brain.debugState().lastAffectionAt).toBe(BASE_MS + 3 * PET_AFFECTION_DECAY_PERIOD_MS)
    // 整 3 天零整头：锚点与 now 重合；没跨档、没事件、没被 cap
    expect(h.brain.debugState().lastAffectionAt).toBe(BASE_MS + 3 * DAY_MS)
    expect(h.brain.debugState().affectionCapped).toBe(0)
    expect(dbgAff(h).affectionDay.counts).toEqual({})
    expect(h.quips).toEqual([])
  })

  it('时钟回拨：lastAffectionAt 在未来 → 重锚到 now、值不动（不补扣也不预扣）', () => {
    const h = makeHarness({
      seed: { satiety: 0, lastAffectionAt: BASE_MS + 5 * DAY_MS }
    })
    expect(h.brain.debugState().lastAffectionAt).toBe(BASE_MS)
    expect(h.brain.debugState().affection).toBe(PET_AFFECTION_INITIAL)
    // 重锚真的落盘了（不是只在内存里）
    expect(h.current().lastAffectionAt).toBe(BASE_MS)
  })

  it('久离 ≥48h：开局 -5 一次；启动不播报（基线在事后播种，跨档由问候语义承担）', () => {
    // 44 出发：-5 正好跌出 close（40）——跨档了也不 quip，这是启动口径
    const h = makeHarness({
      seed: {
        satiety: 90,
        affection: PET_AFFECTION_CLOSE_AT + 4,
        memory: { ...defaultPetMemory(iso(BASE_MS)), lastSeenAt: iso(BASE_MS - 3 * DAY_MS) }
      }
    })
    expect(h.brain.debugState().awayOnLaunchMs).toBe(3 * DAY_MS)
    expect(h.brain.debugState().affection).toBe(
      PET_AFFECTION_CLOSE_AT + 4 + PET_AFFECTION_RULES['long-away'].delta
    )
    expect(dbgAff(h).affectionDay.counts).toEqual({ 'long-away': 1 })
    expect(h.quips).toEqual([])
    expect(h.brain.debugState().affectionDown).toBe(0)
    // "说"归问候档：上一句是"好几天不见"
    h.brain.greet()
    expect(h.says[0].tag).toBe('greet:away')
  })

  it('短离（<48h）不罚：away 45h 不动好感', () => {
    const h = makeHarness({
      seed: {
        satiety: 90,
        memory: { ...defaultPetMemory(iso(BASE_MS)), lastSeenAt: iso(BASE_MS - 45 * 60 * 60_000) }
      }
    })
    expect(h.brain.debugState().affection).toBe(PET_AFFECTION_INITIAL)
    expect(dbgAff(h).affectionDay.counts).toEqual({})
  })

  it('挨饿到 0：-2 一次；躺在 0 上不重复罚；喂回再饿回 0 被日上限拦（有痕）', () => {
    const h = makeHarness({ seed: { satiety: 1, rice: 1 } })
    h.advance(PET_DECAY_ONLINE_PERIOD_MS)
    h.brain.tick() // 1 → 0：这一跳真的掉到 0
    expect(h.brain.debugState().affection).toBe(
      PET_AFFECTION_INITIAL + PET_AFFECTION_RULES.starving.delta
    )
    expect(dbgAff(h).affectionDay.counts).toEqual({ starving: 1 })
    // 躺在 0 上再走几拍：dropped=0，不补罚
    h.advance(5 * PET_DECAY_ONLINE_PERIOD_MS)
    h.brain.tick()
    expect(h.brain.debugState().affection).toBe(
      PET_AFFECTION_INITIAL + PET_AFFECTION_RULES.starving.delta
    )
    expect(h.brain.debugState().affectionCapped).toBe(0)
    // 喂一碗（+20，好感 +2）→ 再饿回 0：今天第二次挨饿 → cap 拦下
    h.brain.act({ action: 'feed' })
    expect(h.brain.debugState().affection).toBe(PET_AFFECTION_INITIAL)
    h.advance(10 * PET_DECAY_ONLINE_PERIOD_MS)
    h.brain.tick() // 20 → 10
    h.advance(10 * PET_DECAY_ONLINE_PERIOD_MS)
    h.brain.tick() // 10 → 0：第二次挨饿
    expect(h.brain.debugState().affection).toBe(PET_AFFECTION_INITIAL)
    expect(h.brain.debugState().affectionCapped).toBe(1)
    expect(dbgAff(h).affectionDay.counts).toEqual({ starving: 1, feed: 1 })
    expect(h.logs).toContain('affection no-op: starving (daily cap)')
  })
})

// ---------------------------------------------------------------- 旧动作边界

describe('旧动作：不装作执行（落地为日志），pos 连日志都不刷', () => {
  it('pos 静默：不冒泡、不记日志、也不算"主人动了"', () => {
    const h = makeHarness({})
    h.advance(1_000)
    h.brain.act({ action: 'pos', x: 0.5, y: 0.5 })
    expect(h.says).toEqual([])
    expect(h.logs).toEqual([])
    expect(h.brain.debugState().idleMs).toBe(1_000) // lastActivityAt 没被戳
  })

  it('mode / size / show / hide / menu / chat：记一行日志，不冒泡', () => {
    const h = makeHarness({})
    for (const raw of [
      { action: 'mode', mode: 'follow' },
      { action: 'size', size: 238 },
      { action: 'show' },
      { action: 'hide' },
      { action: 'menu' },
      { action: 'chat' }
    ]) {
      h.brain.act(raw)
    }
    expect(h.says).toEqual([])
    expect(h.logs.length).toBe(6)
    expect(h.logs.every((l) => l.includes('not wired'))).toBe(true)
  })

  it('垃圾输入：原样返回快照、不冒泡 —— 但每一发都**必须留痕**（C1）', () => {
    const h = makeHarness({})
    const before = h.brain.init()
    const bads = [null, 'feed', 42, { action: 'nonsense' }, { action: 'grant', reward: 'x' }]
    for (const bad of bads) {
      expect(h.brain.act(bad)).toEqual(before)
    }
    expect(h.says).toEqual([])
    // 【原来这里断言 logs 为空】那份"零副作用"把 C1 想要的东西也一起禁掉了：
    // 解析失败静默 return 时，"发饭请求根本没进 brain"和"brain 照常处理了"
    // 在主进程日志里长得一模一样（app.ts 的 riceGranted=false 也就无从对账）。
    // 现在改钉：**每一发垃圾载荷各留一行**（多了不行、少了也不行）
    expect(h.logs.length).toBe(bads.length)
    expect(h.logs.every((l) => l.includes('act dropped'))).toBe(true)
  })
})

// ---------------------------------------------------------------- 聊天（护栏读口 / 记账 / 记忆块）

describe('聊天三方法：护栏读口 / 记账落盘 / 记忆块', () => {
  it('chatGate：新档位 ok；commit 后 10s 内 cooldown（差 1ms 也不行），满 10s 恢复', () => {
    const h = makeHarness({})
    expect(h.brain.chatGate()).toBe('ok')
    h.brain.chatCommit(100)
    expect(h.brain.chatGate()).toBe('cooldown')
    h.advance(9_999)
    expect(h.brain.chatGate()).toBe('cooldown')
    h.advance(1)
    expect(h.brain.chatGate()).toBe('ok')
  })

  it('commit：落盘一笔、debugState 三项对齐；负 token 按 0 记（Math.max 口径）', () => {
    const h = makeHarness({})
    const n = h.saves.length
    h.brain.chatCommit(42)
    expect(h.saves.length).toBe(n + 1)
    expect(h.brain.debugState().chatCallsToday).toBe(1)
    expect(h.brain.debugState().chatTokensToday).toBe(42)
    expect(h.brain.debugState().lastChatAt).toBe(iso(BASE_MS))
    h.advance(10_000)
    h.brain.chatCommit(-5)
    expect(h.brain.debugState().chatTokensToday).toBe(42)
  })

  it('跨天重置：昨天 119 次 / 差 1 个 token 到限，今天从零重新算', () => {
    const h = makeHarness({
      seed: {
        memory: {
          ...defaultPetMemory(iso(BASE_MS)),
          chatDay: petDayKey(iso(BASE_MS - DAY_MS)),
          chatCallsToday: 119,
          chatTokensToday: 59_999
        }
      }
    })
    expect(h.brain.chatGate()).toBe('ok') // 昨天的账不是今天的
    h.brain.chatCommit(50)
    expect(h.brain.debugState().chatCallsToday).toBe(1)
    expect(h.brain.debugState().chatTokensToday).toBe(50)
  })

  it('日上限两档：次数到 120 → daily；token 到 6 万 → tokens', () => {
    const today = petDayKey(iso(BASE_MS))
    const calls = makeHarness({
      seed: {
        memory: { ...defaultPetMemory(iso(BASE_MS)), chatDay: today, chatCallsToday: PET_CHAT_DAILY_MAX }
      }
    })
    expect(calls.brain.chatGate()).toBe('daily')
    const toks = makeHarness({
      seed: {
        memory: { ...defaultPetMemory(iso(BASE_MS)), chatDay: today, chatTokensToday: PET_CHAT_DAILY_TOKENS }
      }
    })
    expect(toks.brain.chatGate()).toBe('tokens')
  })

  it('记忆块：全空回空串（不附）；跑通那句只在"末条事件且 15 分钟内"出现', () => {
    const h = makeHarness({})
    expect(h.brain.chatMemoryBlock()).toBe('')
    h.brain.reportRun({ ok: true, kind: 'run', line: null, rect: null })
    expect(h.brain.chatMemoryBlock()).toContain(PET.MEMORY_EVENT_RUNOK)
    h.advance(15 * 60_000 + 1)
    expect(h.brain.chatMemoryBlock()).not.toContain(PET.MEMORY_EVENT_RUNOK)
  })

  it('记忆块：错题 + 刚跑通 + 连学两课 = 三句；头尾格式对', () => {
    const h = makeHarness({})
    h.brain.act({ action: 'wrong', title: TITLE, order: 1, learned: true })
    h.brain.act({ action: 'grant', reward: 'lesson' })
    h.brain.act({ action: 'grant', reward: 'lesson' })
    // 跑通放最后：run-ok 那句只看**末条事件**（前面垫了 lesson 就轮不到它）
    h.brain.reportRun({ ok: true, kind: 'run', line: null, rect: null })
    const block = h.brain.chatMemoryBlock()
    expect(block.startsWith(PET.MEMORY_HEADER)).toBe(true)
    expect(block.endsWith('。')).toBe(true)
    expect(block.split('；').length).toBe(3)
    expect(block).toContain(PET.MEMORY_EVENT_WRONG(TITLE))
    expect(block).toContain(PET.MEMORY_EVENT_RUNOK)
    expect(block).toContain(PET.MEMORY_EVENT_LESSON(2))
  })

  it('记忆块：上次聊天今天 / 昨天 / 3 天前，三档各一句', () => {
    const mem = (lastChatAt: string): PetState['memory'] => ({
      ...defaultPetMemory(iso(BASE_MS)),
      lastChatAt
    })
    const today = makeHarness({ seed: { memory: mem(iso(BASE_MS - 60_000)) } })
    expect(today.brain.chatMemoryBlock()).toContain(PET.MEMORY_LAST_CHAT_TODAY)
    const yest = makeHarness({ seed: { memory: mem(iso(BASE_MS - DAY_MS)) } })
    expect(yest.brain.chatMemoryBlock()).toContain(PET.MEMORY_LAST_CHAT_YESTERDAY)
    const old = makeHarness({ seed: { memory: mem(iso(BASE_MS - 3 * DAY_MS)) } })
    expect(old.brain.chatMemoryBlock()).toContain(PET.MEMORY_LAST_CHAT_DAYS(3))
  })

  it('记忆块：日界按自然日算 —— 跨零点 2 分钟算"昨天"；同日隔 23 小时仍算"今天"', () => {
    // 00:01 读 23:59 的聊天：按自然日 = 1（字面上确实是"昨天"）——把阈值实现
    // 换成"距今时长"（floor(elapsed/DAY)）会把它算成 0，这条判据就是为了咬住它
    const midnight = makeHarness({
      nowMs: bjMs(2026, 10, 7, 0, 1, 0),
      seed: {
        memory: {
          ...defaultPetMemory(iso(BASE_MS)),
          lastChatAt: iso(bjMs(2026, 10, 6, 23, 59, 0))
        }
      }
    })
    expect(midnight.brain.chatMemoryBlock()).toContain(PET.MEMORY_LAST_CHAT_YESTERDAY)
    // 反之：同一自然日内隔 23 小时也是"今天"
    const sameDay = makeHarness({
      nowMs: bjMs(2026, 10, 6, 23, 55, 0),
      seed: {
        memory: {
          ...defaultPetMemory(iso(BASE_MS)),
          lastChatAt: iso(bjMs(2026, 10, 6, 0, 5, 0))
        }
      }
    })
    expect(sameDay.brain.chatMemoryBlock()).toContain(PET.MEMORY_LAST_CHAT_TODAY)
  })

  it('记忆块最多三句：四样齐时"上次聊天"被挤掉（slice(0,3) 上限，v1 口径）', () => {
    const h = makeHarness({
      seed: { memory: { ...defaultPetMemory(iso(BASE_MS)), lastChatAt: iso(BASE_MS - DAY_MS) } }
    })
    h.brain.act({ action: 'wrong', title: TITLE, order: 1, learned: true })
    h.brain.act({ action: 'grant', reward: 'lesson' })
    h.brain.act({ action: 'grant', reward: 'lesson' })
    h.brain.reportRun({ ok: true, kind: 'run', line: null, rect: null })
    const block = h.brain.chatMemoryBlock()
    expect(block.split('；').length).toBe(3)
    expect(block).not.toContain(PET.MEMORY_LAST_CHAT_YESTERDAY)
  })
})

// ---------------------------------------------------------------- 账本余额镜像（P10.5）

describe('账本余额镜像（P10.5 账号通道）：mirrorRice 对齐 pet.json，相等即真 no-op', () => {
  it('余额不同 ⇒ 落盘一次、内存与 init 都是新值；相等 ⇒ 一次都不落', () => {
    const h = makeHarness({ seed: { rice: 10 } })
    const savesBefore = h.saves.length
    // 判据自证（先红后绿的反面）：相等这一步必须**什么都不发生** ——
    // 假绿的样子是「不管相不相等都落盘」，下一步的不同值正是它的阳性对照
    h.brain.mirrorRice(10)
    expect(h.saves.length).toBe(savesBefore)
    h.brain.mirrorRice(42)
    expect(h.current().rice).toBe(42)
    expect(h.saves.length).toBe(savesBefore + 1)
    // init（petInit 读口）看到的也必须已经是新值 —— 镜像不是只改内存
    expect(h.brain.init().rice).toBe(42)
  })

  it('vitals：不同才推（指纹含 rice），相等连读数都不动', () => {
    const vitals: { rice: number }[] = []
    const h = makeHarness({ seed: { rice: 10 }, deps: { vitals: (v) => vitals.push(v) } })
    const before = vitals.length // 构造时会推一发启动读数（publishVitals 的启动位）
    h.brain.mirrorRice(10)
    expect(vitals.length).toBe(before)
    h.brain.mirrorRice(42)
    expect(vitals.length).toBe(before + 1)
    expect(vitals[vitals.length - 1]!.rice).toBe(42)
  })

  it('非有限数（NaN / Infinity）不写：绝不把坏数落进 pet.json', () => {
    const h = makeHarness({ seed: { rice: 10 } })
    const savesBefore = h.saves.length
    h.brain.mirrorRice(Number.NaN)
    h.brain.mirrorRice(Number.POSITIVE_INFINITY)
    expect(h.saves.length).toBe(savesBefore)
    expect(h.current().rice).toBe(10)
  })
})

// ---------------------------------------------------------------- 静态同源（对外契约）

/** 从补丁模块源里切出「载荷常量」的数组文本（= 真正拼进供体的那几行）。
 *  为什么不裸 src.includes：同一个字面量在 patch.mjs 里常有三份 —— ① 载荷常量；
 *  ② PATCH_MARKERS（isPatched 的认标记集）；③ mustHave/mustGone 后验清单；外加
 *  文档注释里抄的样张。裸针会被 ②③④ 自己喂饱 —— 2026-10-16 夜种坏实测：把载荷里
 *  对话文案改成「这句大鱼没接住」，裸针照样全绿（判定为真的路上有不需要证据的分支）。
 *  找不到常量/收尾时响亮 throw，绝不返回空串（空串上的 includes 恒假 = 另一种假绿）。 */
function extractPatchPayload(src: string, constName: string): string {
  const start = src.indexOf(`const ${constName} = [`)
  if (start === -1) throw new Error(`patch.mjs 里找不到载荷常量 ${constName}`)
  const end = src.indexOf("].join('\\n');", start)
  if (end === -1) throw new Error(`载荷常量 ${constName} 的 ].join 收尾找不到`)
  return src.slice(start, end)
}

describe('同源闸门：动画名 vs 包内 config.jsonc、菜单标签 vs 补丁', () => {
  const repo = join(__dirname, '..', '..', '..')
  const configPath = join(repo, 'node_modules', 'dsh-pet', 'assets', 'config.jsonc')
  const patchPath = join(repo, 'build', 'dshpet-patch.mjs')

  it('PET_DSH.ANIM 的三个动画名逐字在包内 config.jsonc 里（拼错 = 点播静默丢失）', () => {
    expect(existsSync(configPath), `missing donor file ${configPath}`).toBe(true)
    const src = readFileSync(configPath, 'utf8')
    for (const [key, name] of Object.entries(PET_DSH.ANIM)) {
      expect(src.includes(JSON.stringify(name)), `PET_DSH.ANIM.${key} -> ${name} not found in config.jsonc`).toBe(true)
    }
    // 尺子自证：编造的动画名必须查不到（防文件读空/匹配恒真还全绿）
    expect(src.includes(JSON.stringify('no-such-animation-xyzzy'))).toBe(false)
  })

  it('菜单标签与补丁文本逐字一致（两处各写一份就会漂）', () => {
    expect(existsSync(patchPath), `missing patch module ${patchPath}`).toBe(true)
    const src = readFileSync(patchPath, 'utf8')
    // 针只落在**载荷常量**上（见 extractPatchPayload 的注释：裸针会被 PATCH_MARKERS /
    // mustHave / 注释样张自喂 —— 2026-10-16 夜种坏实测过）。
    const menu = extractPatchPayload(src, 'NEW_TOOLS_BLOCK')
    // 切片自证：含载荷特征词、不含模块其它部位的特征词（防 indexOf 切错段还全绿）
    expect(menu.includes('tools.push('), 'NEW_TOOLS_BLOCK 切片不含 tools.push（切错段）').toBe(true)
    expect(menu.includes('PATCH_MARKERS'), 'NEW_TOOLS_BLOCK 切片串进了模块其它部位').toBe(false)
    expect(menu.includes("'" + PET.MENU.FEED + "'"), 'menu FEED label drifted from patch').toBe(true)
    expect(menu.includes("'" + PET.MENU.PAT + "'"), 'menu PAT label drifted from patch').toBe(true)
    // 聊天条目：标签 + action 一起钉 —— 标签对但 action 漂了（或反过来）都是菜单点了没反应
    expect(
      menu.includes("{ label: '" + PET.MENU.CHAT + "', action: 'chat' }"),
      'menu CHAT entry drifted from patch'
    ).toBe(true)
    // 2026-10-16 夜（V1-31 后续）：菜单整块的字面量全量钉死 —— 条目 = 标签 + action 一起断，
    // 光断标签会让「标签对但 action 漂」的安静坏法漏网（V1-31 的抱怨正是 build/ 在闸门扫描面之外）。
    for (const [label, literal] of [
      [PET.MENU.SETTINGS_WALL, "{ label: '" + PET.MENU.SETTINGS_WALL + "', action: 'miai-wallpaper' }"],
      [PET.MENU.SETTINGS_AI, "{ label: '" + PET.MENU.SETTINGS_AI + "', action: 'miai-ai' }"],
      [PET.MENU.FEED, "{ label: '" + PET.MENU.FEED + "', action: 'miai-feed' }"],
      [PET.MENU.PAT, "{ label: '" + PET.MENU.PAT + "', action: 'miai-pat' }"],
      [PET.MENU.WHISPER, "{ label: '" + PET.MENU.WHISPER + "', action: 'whisper' }"],
      [PET.MENU.HOME, "{ label: '" + PET.MENU.HOME + "', action: 'home' }"],
      [PET.MENU.RELOAD, "{ label: '" + PET.MENU.RELOAD + "', action: 'reload' }"],
      [PET.MENU.PET_OFF, "{ label: '" + PET.MENU.PET_OFF + "', action: 'miai-pet-off' }"]
    ] as Array<[string, string]>) {
      expect(menu.includes(literal), `menu entry drifted from patch: ${label}`).toBe(true)
    }
    // 余额是条件项（展开式），形状与上面的普通条目不同 —— 单独钉
    expect(
      menu.includes("[{ label: '" + PET.MENU.BALANCE + "', action: 'show-balance' }]"),
      'menu BALANCE conditional entry drifted from patch'
    ).toBe(true)
    // 跟随开关三元的一对标签（等长约束见 copy.ts 的注释）
    expect(
      menu.includes("followOn ? '" + PET.MENU.FOLLOW_OFF + "' : '" + PET.MENU.FOLLOW_ON + "'"),
      'menu FOLLOW toggle labels drifted from patch'
    ).toBe(true)
    // 对话弹窗兜底两句（V1-37）：载荷 = 各自的 NEW 常量（不是 mustHave 清单、不是注释样张）
    const failPayload = extractPatchPayload(src, 'SHARED_CORE_CHAT_FAIL_NEW')
    const catchPayload = extractPatchPayload(src, 'SHARED_CORE_CHAT_CATCH_NEW')
    expect(
      failPayload.includes('err.textContent = "' + PET.CHAT_DIALOG_FAIL + '";'),
      'dialog CHAT_DIALOG_FAIL drifted from patch payload'
    ).toBe(true)
    expect(
      catchPayload.includes('err.textContent = "' + PET.CHAT_DIALOG_ERR + '";'),
      'dialog CHAT_DIALOG_ERR drifted from patch payload'
    ).toBe(true)
    // 尺子自证：假标签必须查不到
    expect(src.includes("'no-such-menu-label-xyzzy'")).toBe(false)
    expect(src.includes("'no-such-chat-label-xyzzy'")).toBe(false)
    expect(src.includes('err.textContent = "no-such-dialog-copy-xyzzy";')).toBe(false)
  })
})
