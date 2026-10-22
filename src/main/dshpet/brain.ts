/**
 * 大肥鱼桌宠 · 行为大脑（src/main/dshpet/brain.ts，2026-10-06）
 *
 * 【为什么有这份文件】2026-10-06 把桌宠换成 dsh-pet 引擎后，旧控制器
 * （main/pet/index.ts）退役——但"咪爱味"的行为语义是主人点名要**逐条迁移**
 * 的资产：喂饭/摸头/rua 的冷却、答错题的两档台词、发大白饭的记账与彩蛋、
 * 饥饿衰减与嘟囔、CPU 烧了的吐槽、出场问候的选档、久不动主动搭话。
 * 本文件把它们从窗口管理里剥出来重装：输入 = 事件 + 心跳，输出只有
 * say(text, tag) 与 anim(name) 两条指令。
 *
 * 【与 v1 的关系：照抄判定，不"顺手改进"】每条冷却毫秒数、去重窗口、
 * 台词分档都取自 main/pet/index.ts（2026-10-06 冻结），出处标注在各自
 * 函数头。台词本体一个字都没搬——它们本来就住 shared/copy.ts 的 PET 段，
 * 这里只 import。动画名是 dsh-pet 包内 config.jsonc 的条目名（住 copy.ts
 * 的 PET_DSH.ANIM，改一个字=动画静默不播，dshpet-brain.test.ts 对着
 * 包内配置文件逐名校验）。
 *
 * 【2026-10-06 晚 · 聊天补迁】v1 的聊天（chat/PET_CHAT_*）当时按"零 API 红线"
 * 判了不迁移；主人点名要「接入 API Key 自由聊天」后整条接回——dsh-pet 引擎
 * 原生就带「对话」菜单与输入弹窗（走宿主 /chat 路由），咪爱宿主把它接到
 * 本文件的护栏/记忆与 ai/deepseek 的 chatPet 上。护栏（10s 冷却/每日 120 次/
 * 每日 6 万 token）与记忆块复用 shared/pet.ts 的 v1 纯函数，判定零改动。
 * 出网与否由用户自己决定（AI 卡填了 Key 才真发出请求；没填走本地抱怨话术）。
 *
 * 【2026-10-06 深夜 · 跑腿补迁（第三阶段）】v1 reportRun 的"走到报错行旁"
 * 一度按"新引擎没有绝对定位"判了不迁移 —— 后来在 miai-extras 里找到了
 * 程序化移动的口子：宿主把目标屏幕点写进 goto 叶子 → 渲染端缓动走到落点、
 * 回 POST 回执 → 到了说 chase 场景台词。整条接回（本地 DOM 交互、零 API，
 * 台词是 pet-quips 的本地池）。「不迁移」清单只剩：
 *   · pos/mode/size/show/hide/menu 六个旧动作：施动方（旧宠物窗）已不存在，
 *     新引擎的窗口/体型真源是 config.pet；这些动作来了只记日志（见 act）。
 * 跑腿的饿扁拒跑、30s 冷却、6s ACK 兜底都在本文件（状态机全本地）。
 *
 * 【2026-10-09 · 补充模块一（状态规则透明化）】三个变化，口径以主人原话为准：
 *   · 报错降级链收口：severe（1-20%）**报错功能关闭**（不再说 ERR_WEARY）——
 *     这一档的嘴归催饭节拍；跑腿也一并关（要 satiety ≥ 20 才出动）；
 *   · 催饭节拍 nagTick：mild 300s / medium 180s / severe 90s，越饿越勤
 *     （tag 'nag'，不在 say-gate 白名单 —— 归零档自动闭嘴）；
 *   · 好感两端的脾气：love（≥80）每 4 分钟撒娇一次（NUZZLE + affection 池
 *     台词）；cold（<20）抑制主动搭话（coldSuppressed 计数），宿主的碎碎念
 *     定时器同款跳过（见 host.ts startWhisperTimers）。
 * 三条环境音共用"一拍最多一句"的互斥（tick 里 proactive → nag → nuzzle）。
 *
 * 【零中文纪律】本文件在 src/ 下、会被文案闸门扫：注释随便写，字符串字面量
 * 里一个中文都不许有（动画名走 PET_DSH.ANIM，日志/标签一律 ASCII）。
 */
import { cpus } from 'os'
import type { RiceKind } from '../../shared/cloud/protocol'
import { PET, PET_DSH } from '../../shared/copy'
import {
  PET_AFFECTION_TIERS,
  PET_CHASE_COOLDOWN_MS,
  PET_CHASE_COST,
  PET_DECAY_OFFLINE_PERIOD_MS,
  PET_DECAY_ONLINE_PERIOD_MS,
  PET_HUNGER_MEDIUM_AT,
  PET_INTERACT_COOLDOWN_MS,
  PET_LONG_AWAY_MS,
  PET_MEMORY_STREAK,
  PET_OFFLINE_DECAY_FLOOR,
  PET_PRAISE_COOLDOWN_MS,
  PET_PROACTIVE_COOLDOWN_MS,
  PET_PROACTIVE_IDLE_MS,
  PET_RICE_FULL_COOLDOWN_MS,
  PET_RICE_MAX,
  PET_RUA_COOLDOWN_MS,
  PET_WRONG_COOLDOWN_MS,
  addAffection,
  awayMs,
  decayAffection,
  decayPet,
  exertPet,
  feedPet,
  grantPetRice,
  grantRunReward,
  lastWrongLabel,
  lessonStreak,
  normalizeRunReport,
  parsePetAction,
  petAffectionTier,
  petChatCommit,
  petChatGate,
  petDayKey,
  petFace,
  petHungerTier,
  petMood,
  pushPetMemory,
  setPetEmotion,
  snapshotOf,
  touchPetSeen,
  type PetAffectionKind,
  type PetAffectionTier,
  type PetChatGate,
  type PetHungerTier,
  type PetRewardKind,
  type PetRunReport,
  type PetSnapshot,
  type PetState,
  type PetVitals
} from '../../shared/pet'
import { pickQuip } from '../../shared/pet-quips'
import type { PetStore } from '../pet/store'

/**
 * brain 能记进账本的饭事件种类（服务端 RICE_LEDGER_KINDS 的子集）：喂饭、
 * 四种学习奖励、跑腿奖 —— 恰好就是 pet.ts 里三个饭变动函数的全部出口
 * （feedPet / grantPetRice / grantRunReward，grep 可复核）。
 * 收窄到子集是刻意的：chase/chat 是服务端冻结的动作值（v1 客户不上行）、
 * adopt 只在收编/genesis 产生，它们不该从这个口出去 —— 类型收窄让「brain
 * 发了一条它不该发的 kind」在编译期红，而不是等服务端 400 才发现。
 */
export type PetRiceKind = Extract<RiceKind, 'feed' | 'lesson' | 'review' | 'answer' | 'checkin' | 'run'>

export interface PetBrainDeps {
  /** pet.json 读写漏斗（宿主建好传进来；测试塞假货即可脱盘） */
  store: PetStore
  /** 说一句话。text 已拼好（台词真源在 copy.ts），tag 只进宿主日志。
   *  meme（可选）= pet-quips 条目的配图文件名主干（跑腿到达的台词带图） */
  say: (text: string, tag: string, meme?: string) => void
  /**
   * 场景台词出口（P3 ④）：宿主从 pet-quips 池里挑一句说出来，tag 只进日志
   * （C3 的 `say#n (scene) tag` 格式）。目前唯一调用点是好感度跨档
   * （`quip('affection', 'affection-up' | 'affection-down')`）—— 跨档不是一个
   * "动作"，copy.ts 的功能话术挂不上去，所以走场景池。**必填**：测试假脑
   * 必须显式接上，漏接就 typecheck 红 —— 列成可选的话"跨档播了没有"在
   * 假脑里量不到（静默跳过 = 假绿）。
   */
  quip: (scene: 'affection', tag?: string) => void
  /** 播一段 dsh-pet 动画（按名；名字取自 PET_DSH.ANIM） */
  anim: (name: string) => void
  /**
   * 饱食/饭盒/心情的对外读数（P3 ③，可选）：宿主写进 /state 的 vitals 叶子，
   * 渲染端右键菜单的饥饿进度条读它。**状态一变就发**（本脑在每个 commit()
   * 里推，指纹去重），不是轮询 —— 菜单打开的那一刻读数必须已经是新的。
   */
  vitals?: (v: PetVitals) => void
  /**
   * 主窗此刻是不是"人在里面"（可见 + 未最小化 + 有焦点）。
   * 主动搭话只在为真时开口——鱼是常驻置顶窗，主人去别的软件里干正事时
   * 突然飘一句"还在吗喵"是最典型的好心办坏事（v1 proactiveTick 的口径，
   * 那边还多查了一条宠物窗可见，新引擎的宠物窗可见性宿主观测不到，
   * 用主窗三连近似 —— 宠物本来就跟着主窗露头）。
   */
  getMainFocused: () => boolean
  /**
   * 跑腿出口（宿主实现 = 写 goto 叶子请渲染端走过去）：入参是**屏幕 DIP**
   * 坐标，返回本趟序号（>0）。没宠物窗时返回 0 = 送不出去（brain 原地说
   * 报错话术）。可选：假脑（测试）不接这条就永远走「原地说话」分支。
   */
  chase?: (x: number, y: number) => number
  /**
   * 大白饭镜像出口（P10.x 上行接线，可选）：每笔**真实过账**的饭变动从这里
   * 出去记进账本（rice-journal），**返回值 = 记完账的新余额镜像** —— brain
   * 拿它**覆盖** pet.ts 自己算的那个数（后者从此只是候选值）。
   * 返回 null / 不接这条（v1 假脑、极早期）= 保留本地算术。
   * 【为什么是覆盖】上限饱和（999 顶格）时本地算术与账本的过账结果会分叉；
   * 账本是唯一事实，「显示的数」必须来自它（docs/26 §6.1：rice 是
   * clamp(Σdelta) 的派生值）。喂饭在 999 顶格时蒸发的那个边界，正是这个
   * 覆盖要盖住的（pet.ts 的算术没法学账本的 skip-when-zero）。
   * 【ref 是服务端的硬要求】lesson 必须带 lessonId、run 必须带 fingerprint
   * —— 缺了是整批 400，账本侧会把这种条目标 'rejected' 就地拦下（永不上行，
   * 余额照涨）。其余 kind 的 ref 传 null。
   * skip-when-zero（余额没动就不记账）由 sink 自己判，brain 不做判断。
   */
  onRice?: (ev: { kind: PetRiceKind; ref: Record<string, unknown> | null }) => number | null
  log?: (line: string) => void
  now?: () => number
  /** CPU 采样注入（测试用）；默认 os.cpus() 累计时间差，同 v1 */
  sampleCpu?: () => { idle: number; total: number }
  /**
   * 起步即冻结（空转[4]，2026-10-16）：宿主在**宠物配置为关**时传 true。
   * 冻结 = 装载路径不衰减/不落盘/不记"好久不见" + tick 空转 —— 「关着」的
   * 时间里 pet.json 一个字节都不动（验收判据就是它的 mtime）。缺省
   * （undefined）= 老行为；解冻的唯一入口是 setPaused(false)。
   */
  startPaused?: boolean
}

export interface PetBrain {
  /** 拉当前快照（petInit 的读口；设置卡与将来的状态行看它） */
  init(): PetSnapshot
  /** 执行一个动作（入参未清洗，内部过 parsePetAction）。返回执行后的快照 */
  act(raw: unknown): PetSnapshot
  /** 主窗渲染层的运行结果上报（成功表扬 / 失败报错语言） */
  reportRun(raw: unknown): void
  /** 出场问候（宿主在渲染端首拉 /state 之后调，一次生命周期一次） */
  greet(): void
  /** 心跳（宿主 30s 一次）：在线衰减 + 饿嘟囔 + CPU + 主动搭话 */
  tick(): void
  /**
   * 冻结/解冻（空转[4]，2026-10-16）：关掉的宠物必须**彻底停** ——
   * 冻 = 心跳变 no-op 且零落盘；解冻那一记把冻结期从三个锚点上抹掉并落盘
   * （详见实现处注释）。重复调同值是 no-op；宿主在 applySettings 两个分支
   * 与起步块里驱动它。
   */
  setPaused(paused: boolean): void
  /** 现在能不能聊（聊天三道护栏的读口；纯读不落盘） */
  chatGate(): PetChatGate
  /**
   * 记一次**成功发出**的聊天（token 估算账）。
   * 失败/被护栏拦下的都不 commit —— 断网时连点重试不该把额度吃光（v1 口径）。
   */
  chatCommit(usedTokens: number): void
  /** 跑腿到达回执（宿主收到渲染端 /miai/chase-arrived 后转发；seq 核对） */
  chaseArrived(seq: number): void
  /** 跑腿超时（宿主 6s 兜底）：这趟作废，原地补说报错话术（降级不是失败） */
  chaseTimeout(seq: number): void
  /** 原生路径运行奖（native-watch 编译成功）：指纹去重 + 日上限，返回是否真发 */
  grantRun(fp: string): boolean
  /**
   * 账本余额镜像（P10.5 账号通道）：把当前账本余额（唯一事实）对齐进 pet.json。
   * 主进程在上行轮结束 / 激活 / 登出 / 启动恢复之后推（app.ts 的 syncRiceMirror）。
   * 相等 = 真 no-op（不落盘不推读数）；不是"过账"，不播台词。
   */
  mirrorRice(n: number): void
  /** 拼给模型看的记忆块（≤3 行；挑不出东西回空串，chatPet 会自动省掉它） */
  chatMemoryBlock(): string
  /** 探针/日志口子（不含任何隐私内容） */
  debugState(): Record<string, unknown>
}

/** 心跳周期（同 v1 HEARTBEAT_MS）：分针级行为，30 秒粒度绰绰有余 */
export const PET_HEARTBEAT_MS = 30_000

/**
 * CPU 判定：连续两次心跳（=1 分钟）都在这个水位以上才算"烧"。
 * v1 同值（CPU_HOT_LEVEL / CPU_HOT_STREAK / CPU_QUIP_COOLDOWN_MS）。
 */
const CPU_HOT_LEVEL = 0.9
const CPU_HOT_STREAK = 2
const CPU_QUIP_COOLDOWN_MS = 10 * 60_000

/**
 * 催饭节拍（2026-10-09 补充模块一②）：mild/medium/severe 三档定期催饭，
 * **越饿越勤**（30s 心跳把节拍量化成 10/6/3 拍）。归零档不催 —— 那档是
 * "彻底死机趴桌面"，叹一声 hungry-sob 之后就该彻底安静（tag 'nag' 也不在
 * say-gate 白名单，宿主闸门是第二道防线，见 shared/copy.ts 的 NAG_FEED 注释）。
 * 【导出】单测按常量推时钟（照抄字面量的话，改节拍 = 一堆红得莫名其妙的用例；
 * 而同 PET_HEARTBEAT_MS 一样，节拍值本身是契约的一部分，值得被引用）。
 */
export const NAG_GAP_MILD_MS = 300_000
export const NAG_GAP_MEDIUM_MS = 180_000
export const NAG_GAP_SEVERE_MS = 90_000

/** 好感 love 档（≥80）的撒娇节拍（补充模块一②「频繁撒娇」）：4 分钟蹭一次 */
export const NUZZLE_GAP_MS = 4 * 60_000

/**
 * 「饿脸」节拍（V2-25，2026-10-15 夜主人裁定）：开源素材里没有专门的饿脸，
 * 不新画一整套表情 —— 用**已有那张不开心的脸**「工作状态-垂头叹气冒汗」代役
 * （就是跑腿拒跑那张，PET_DSH.ANIM.HUNGRY）。脸色为 hungry 时每 3 分钟叹一口。
 * 【为什么挂"脸色"而不是只挂"归零"】脸色是契约（petFace）：侧栏那枚徽记在
 * 哪些档写「饿扁」，桌面上这条鱼就在哪些档挂相 —— 两个面读同一个读数才不撒谎。
 * 【为什么是 3 分钟】弱强度持续信号（V1-50 的另一半：归零档不该只有那一秒的
 * 哭）—— 比催饭最急的 severe 档（90s）还疏，是背景音不是提醒。
 */
export const HUNGRY_FACE_GAP_MS = 3 * 60_000

/**
 * 发饭白名单（P3 ①，2026-10-08）：每种奖励**做什么、不做什么**全写在一张表上。
 *
 * 【为什么从 if/else 改成表】原来只有三个 kind、靠 `kind !== 'answer'` 这类
 * 排除式判断过日子。加 'checkin' 时，"要不要进记忆环？""能不能触发 SPIN 彩蛋？"
 * 是两个各自独立、改错也不会红的决定 —— 排除式写法下签到会被当成学习行为：
 * 记忆环被签到的"假课时"喂大，「一口气学完好几课」的 SPIN 彩蛋在签到时误触。
 * 表把「来了个新 kind」变成编译期的事：`Record<PetRewardKind, …>` 少一个键
 * typecheck 当场红，而不是等人在真机上撞见。
 *
 * remember：进不进"学了一课"记忆环 —— 只有真学习行为算；
 * line/tag：说不说台词（null = 不冒泡）。answer 不冒泡是 v1 口径（每答对一题
 * 都弹会变弹幕）；签到每天只有一次，说一句是它应得的（拍板文案 PET.GRANT_CHECKIN）。
 */
const GRANT_SPECS: Record<
  PetRewardKind,
  { remember: boolean; line: ((n: number) => string) | null; tag: string }
> = {
  lesson: { remember: true, line: PET.GRANT_LESSON, tag: 'grant-lesson' },
  review: { remember: true, line: PET.GRANT_REVIEW, tag: 'grant-review' },
  answer: { remember: false, line: null, tag: '' },
  checkin: { remember: false, line: PET.GRANT_CHECKIN, tag: 'grant-checkin' }
}

/**
 * 饥饿档跃迁台词（P3 ③）：饱食度**跨档**时说一次（t1 !== t0），tag 供探针抓。
 * 台词真源在 copy.ts，这里只做"档 → 台词"的映射。
 * 【empty 故意缺席】归零那一刻的话由 hungry-sob 说（契约点名复用既有台词）；
 * 这里再留一条会变成同刻双声。类型上排除 empty —— 哪天真要加档忘配台词，
 * typecheck 当场红，而不是运行时说一句 undefined。
 */
const HUNGER_LINES: Record<Exclude<PetHungerTier, 'empty'>, string> = {
  full: PET.HUNGER_FULL,
  mild: PET.HUNGER_MILD,
  medium: PET.HUNGER_MEDIUM,
  severe: PET.HUNGER_SEVERE
}

export function createPetBrain(deps: PetBrainDeps): PetBrain {
  const log = deps.log ?? (() => {})
  const nowMs = (): number => (deps.now ? deps.now() : Date.now())
  const nowIso = (): string => new Date(nowMs()).toISOString()

  /**
   * 冻结位（空转[4]，2026-10-16）：关掉的宠物**什么都不该走** —— 心跳空转、
   * 装载不补扣、不落盘。两个驱动口：deps.startPaused（起步就关着）与
   * setPaused（设置页开关拨动）。本文件里读它的只有装载块与 tick。
   */
  let paused = deps.startPaused === true

  /** 内存里那份真状态。所有改动都必须走 commit() 落盘 */
  let state: PetState
  if (paused) {
    /*
     * 冻结起步：只读盘、不衰减、不落盘。原实现无条件走下面的衰减块 ——
     * 「关着宠物」的这几天照样按离线速率扣饱食度/好感、还写一次盘
     * （主人点名整改的那条）。load 是只读的（pet.ts store：读+清洗，
     * 不写），所以冻结期 pet.json 的 mtime 一动不动 —— 探针的判据就是它。
     */
    state = deps.store.load(nowIso()).state
  } else {
    // 启动时先把"关着软件的那段时间"扣掉：离线速率（-1/6min）比在线慢，
    // 且有下限 PET_OFFLINE_DECAY_FLOOR（V2-21）—— 睡一觉或放学回来是
    // "饿得直催"的 medium 档，不是静音的 0 档。0 档留给"开着也一直不理它"
    // 这种看得见的疏忽（在线心跳不传下限，照旧能掉到 0）。
    // 锚点变过也要落盘——只看 dropped 的话，饱食度停在 0（或离线下限）
    // 期间的衰减、时钟回拨的重锚都会让锚点冻在过去，之后一喂饭就被
    // "补扣"（v1 同款注释）。
    const iso = nowIso()
    const loaded = deps.store.load(iso)
    const decayed = decayPet(loaded.state, iso, PET_DECAY_OFFLINE_PERIOD_MS, PET_OFFLINE_DECAY_FLOOR)
    // 好感度同样要吃"关着软件的这几天"（24h -1 的锚点法，P3 ④）——
    // 与饱食度同刻结算，喂饭/学习都发生在这之后。
    const decayedAff = decayAffection(decayed.state, iso)
    state = decayedAff.state
    if (loaded.created || decayed.dropped > 0 || decayed.state.lastDecayAt !== loaded.state.lastDecayAt) {
      deps.store.save(state)
    }
  }

  /**
   * "这次隔了多久"必须**在 touchPetSeen 之前**算（touch 之后永远是 0）。
   * 建脑时刻 = 应用启动时刻，语义与 v1 attach() 对齐。问候语用完即清
   * （同一次会话里重开桌宠不再"好几天不见"）。
   *
   * 【冻结起步整块跳过（空转[4]，2026-10-16）】away/touch 是"见面账" ——
   * 关着的宠物连见面都不该记：不 touch（lastSeenAt 不动）、不记 long-away
   * （主人出门几天不该扣一只"关着"的鱼的好感）、更不落盘。awayOnLaunch
   * 保持 0，于是解冻后第一次 greet 说的是普通出场问候，不是"好久不见"
   * （冻结期不算"离开"）。
   */
  let awayOnLaunch = 0
  if (!paused) {
    awayOnLaunch = awayMs(state, nowIso())
    state = touchPetSeen(state, nowIso())
    // 久离（≥48h）是好感事件里最重的一记（-5/日1）：在 touchPetSeen 之后、
    // 首次落盘之前落账 —— "说"归出场问候（greet 的 greet:away），"记"归这里，
    // 同一时刻各司其职。判据用 awayOnLaunch（touch 之后它就永远是 0 了）。
    if (awayOnLaunch >= PET_LONG_AWAY_MS) {
      state = addAffection(state, 'long-away', nowIso()).state
    }
    deps.store.save(state)
  }

  /** 台词轮转计数：同一句连说两遍像坏掉的复读机（v1 pickLine） */
  let lineTick = 0
  const pickLine = (lines: readonly string[]): string => {
    const line = lines[lineTick % lines.length] ?? ''
    lineTick += 1
    return line
  }

  /**
   * vitals 读数的指纹（`satiety|rice|mood|affection`）。不变就不推 —— 心跳
   * 30 秒一拍、在线衰减 2 分钟才掉 1，不指纹的话渲染端每 30 秒收到一条一字
   * 不差的读数，叶子的 counter「严格递增」就退化成噪声（探针拿 counter 当
   * "变没变"的证据用，噪声 = 假绿）。affection 进指纹（P3 ④）：它变化远比
   * 饱食度慢，但"变了就该推"的规则两者一样。
   */
  let lastVitals = ''

  /** 推当前读数到 vitals 叶子（渲染端右键菜单进度条的唯一数据源） */
  function publishVitals(): void {
    if (!deps.vitals) return
    const v: PetVitals = {
      satiety: state.satiety,
      rice: state.rice,
      mood: petMood(state.satiety),
      affection: state.affection
    }
    const fp = `${v.satiety}|${v.rice}|${v.mood}|${v.affection}`
    if (fp === lastVitals) return
    lastVitals = fp
    deps.vitals(v)
  }

  /**
   * 饭变动记账（P10.x 上行接线）：把这一笔过给 onRice 出口，拿返回的余额镜像
   * **覆盖** pet.ts 的算术值。未接出口（单测假脑 / 极早期）= 原样返回 next
   * （v1 行为，brain 自己的测试不走账本）。返回值不是有限数（sink 违约）也
   * 退回 next —— 宁可显示本地算术，绝不把 NaN 写进落盘状态。
   * 【调用位置纪律】三个调用点都必须在"这笔饭真的过账了"的分支里、commit()
   * 之前：记账要跟落盘同刻，镜像才落得进 pet.json。
   */
  function withRiceMirror(
    next: PetState,
    ev: { kind: PetRiceKind; ref: Record<string, unknown> | null }
  ): PetState {
    const mirror = deps.onRice?.(ev)
    return typeof mirror === 'number' && Number.isFinite(mirror) ? { ...next, rice: mirror } : next
  }

  /**
   * 落盘漏斗（P3 ③ 升级：原来只有 save）。**所有改动必须走这里**：
   *  ① publishVitals —— 读数一变就推（菜单进度条与账本同刻更新，没有第二处）；
   *  ② announce —— 契约点名的两个时刻（心跳衰减 / 喂饭回升）传 true 播跃迁
   *     台词；其余改动（摸头/聊天扣粮/跑腿消耗）只**静默对齐** lastTier ——
   *     不对齐的话，档位其实早跨了、下一跳衰减时才补播一句迟到的台词。
   *  ③ announceAffection（P3 ④）没有静默档：好感跨档**只在越界那一次报**
   *     （契约），越界多半发生在 announce=false 的动作上（摸头/发奖/答错），
   *     静默对齐会把它们全吃掉。
   * 顺序：先播台词再落盘无妨（同一次同步调用里），但读数推送放在台词前面 ——
   * 探针读到"台词出现了"时，vitals 叶子必然已经是新值。
   */
  function commit(announce = false): void {
    publishVitals()
    announceTier(announce)
    announceAffection()
    deps.store.save(state)
  }

  /**
   * 账本余额镜像（P10.5 账号通道）：见 PetBrain.mirrorRice 的接口注释。
   * 非有限数（调用方违约）不写 —— 宁可显示旧值，绝不把 NaN 写进落盘状态
   * （同 withRiceMirror 的守门）。commit(false)：静默对齐档位，不播台词。
   */
  function mirrorRice(n: number): void {
    if (!Number.isFinite(n)) return
    if (n === state.rice) return
    state = { ...state, rice: n }
    commit(false)
  }

  /**
   * 启动就把当前读数摆上叶子：菜单可能在第一次心跳之前被打开，而读不到
   * vitals 的菜单按契约不画进度条 —— 不能让主人对着一个空位等 30 秒。
   * （假脑不接 vitals 时它是 no-op；satiety 不因 touchPetSeen 变化。）
   */
  publishVitals()

  /**
   * 饥饿档跃迁检测的"上一档"（P3 ③）。播种在**启动位**：启动那一刻只对齐、
   * 不播报 —— 出场问候正占着"第一句话"的位置，两个声音抢同一时刻会互相盖
   * （而且"关软件期间饿了好多"这件事，问候档位已经替它说话了）。
   */
  let lastTier: PetHungerTier = petHungerTier(state.satiety)

  /**
   * 档位跃迁播报：t1 !== t0 才开口，每跨一次说一次（tag `hunger-tier:<档>`）。
   * play=false 只更新基线（静默对齐，见 commit 的说明）。
   * 跨进 empty 不播 —— 归零那一刻的话归 hungry-sob（契约点名的复用）；
   * empty 的静默闸门在 host/宿主事件两处，不在台词层。
   */
  function announceTier(play: boolean): void {
    const t1 = petHungerTier(state.satiety)
    if (t1 === lastTier) return
    const t0 = lastTier
    lastTier = t1
    log(`hunger tier ${t0} -> ${t1}${play ? '' : ' (silent)'}`)
    if (!play || t1 === 'empty') return
    say(HUNGER_LINES[t1], `hunger-tier:${t1}`)
  }

  /**
   * 好感度跨档的"上一档"（P3 ④）。与 lastTier 同一思路**播种在启动位**：
   * 启动只对齐、不播报 —— 出场问候正占着"第一句话"，而且启动瞬间的跨档
   * （离线衰减 + 久离 -5）本来就该由问候的语义替它说话（同 ③ 的注释）。
   */
  let lastAffectionTier: PetAffectionTier = petAffectionTier(state.affection)

  /**
   * 好感度跨档的观测读数（P3 ④，C13）：上跳/下跳各报过几次、被日上限
   * 静默拦下几次。没有这三个数，"跨档没播报"到底是没跨、被 cap 拦了、
   * 还是播报链断了，探针分不出来 —— 判据为真必须可归因（同 ③ 的
   * proactiveSuppressed / cpuSuppressed）。
   */
  let affectionUp = 0
  let affectionDown = 0
  let affectionCapped = 0

  /**
   * 好感度跨档播报（P3 ④）：t1 !== t0 才开口，每跨一次说一次
   * （契约："跨档只在越界那次报"）。方向用 PET_AFFECTION_TIERS 的序号差
   * 判定（不靠 delta 正负：衰减与事件叠加时只有档位对比说得清方向）；
   * 方向只进日志标签（affection-up / affection-down）—— 台词池是方向中立的。
   * 【与饥饿档的关键区别】这里**没有静默对齐档**：饥饿档的 play=false 服务
   * 的是"台词层不抢动作方的话"，而好感跨档本身就是契约点名要报的事件，
   * 越界多半发生在 commit(false) 的动作上（摸头/发奖/答错）—— 对齐会吃报。
   */
  function announceAffection(): void {
    const t1 = petAffectionTier(state.affection)
    if (t1 === lastAffectionTier) return
    const t0 = lastAffectionTier
    lastAffectionTier = t1
    const up = PET_AFFECTION_TIERS.indexOf(t1) > PET_AFFECTION_TIERS.indexOf(t0)
    if (up) affectionUp += 1
    else affectionDown += 1
    log(`affection tier ${t0} -> ${t1}`)
    deps.quip('affection', up ? 'affection-up' : 'affection-down')
  }

  /**
   * 记一次好感事件的**统一入口**（计分表与钳制在 shared/pet.ts 的
   * addAffection，这里只管"落到 state + 留痕"）。返回是否真的计了。
   * 超日上限 → 记一次 affectionCapped 并留一行日志后原地返回 ——
   * 静默必须有痕（探针要能区分"闸门拦了"和"根本没触发"，同 ③ 口径）。
   */
  function applyAffection(kind: PetAffectionKind): boolean {
    const r = addAffection(state, kind, nowIso())
    if (!r.applied) {
      affectionCapped += 1
      log(`affection no-op: ${kind} (daily cap)`)
      return false
    }
    state = r.state
    return true
  }

  function say(text: string, tag: string, meme?: string): void {
    deps.say(text, tag, meme)
  }

  /** 互动冷却（喂饭/摸头共用一股）：按住连点不能刷饱食度（v1 同值 1200ms） */
  let lastInteractAt = 0
  /**
   * 最近一次**真正执行**的摸头 / 喂饭时刻（V1-45 双击仲裁用；被冷却拦下的
   * 那一下不推进）。它们回答的问题是："压着这次喂饭的冷却，是不是摸头
   * 刚占的"——见 doFeed 里的豁免注释。
   */
  let lastPatAt = 0
  let lastFeedAt = 0
  /** 饿扁了有没有喊过（回饱后清零）。喊一次就够，别每隔半分钟念一遍 */
  let sobbed = false
  /**
   * 归零静默的观测读数（P3 ③）：分别记下"主动搭话 / CPU 吐槽在归零档被
   * 闸掉几次"。没有这两个数，"没说话"到底是闸门在拦、还是触发条件本来
   * 就不满足，探针分不出来 —— 判据为真必须可归因。
   */
  let proactiveSuppressed = 0
  let cpuSuppressed = 0
  /**
   * 冷漠抑制的观测读数（2026-10-09 补充模块一②）：好感 <20（cold 档）时
   * 主动搭话被闸掉几次。与 proactiveSuppressed 分开记 —— "没说话"到底
   * 是饿着、冷着、还是条件本来就不满足，探针要靠这两个数分流。
   */
  let coldSuppressed = 0
  /** CPU：上一次采样的 {idle,total} 与"连续过热"计数、上次冒泡时间（v1 同款） */
  let prevCpu: { idle: number; total: number } | null = null
  let cpuStreak = 0
  let lastCpuQuipAt = 0

  /**
   * "主人最后一次真的干了点什么"。喂饭/摸头/发奖/rua/答错/运行上报都戳它；
   * 长时间不动主动搭话就是 now - lastActivityAt。
   * 【为什么 pos 不算】它是宠物自己存位置的机器心跳，不是人干的事 ——
   * 算进去的话"长时间不动"永远不会触发（v1 同款判据）。
   */
  let lastActivityAt = nowMs()
  let lastRuaQuipAt = 0
  let lastWrongQuipAt = 0
  let lastPraiseAt = 0
  let lastProactiveAt = 0
  /**
   * 「饭盒满仓 / 当日赚满」提醒的冷却锚点（V1-42：同一口气里连学几课只提醒
   * 一次；两句共用 —— 都是"这碗没进盒"的回执，一分钟内说一次就够）。
   */
  let lastRiceBlockedAt = 0
  /**
   * 催饭/撒娇两种节拍的"上次真说了"时刻。**播种在启动位**（同 lastTier 的
   * 理由）：出场问候正占着"第一句话"，启动 30 秒就催饭会把问候顶掉 ——
   * 第一声催饭最早落在启动一个节拍之后。
   */
  let lastNagAt = nowMs()
  let nagCount = 0
  let lastNuzzleAt = nowMs()
  let nuzzleCount = 0
  /**
   * 「饿脸」节拍的上次播放时刻 + 计数（V2-25）。播种在启动位（同 lastNagAt 的
   * 理由）：出场问候自带出场动画，启动就叹会把问候那一下顶掉 —— 第一口叹气
   * 最早落在启动一个节拍之后。饿着启动的鱼不会被漏掉：跨进归零那一拍本来
   * 就有 hungry-sob，脸色徽记也从第一帧就在。
   */
  let lastHungryFaceAt = nowMs()
  let hungryFaceCount = 0
  /**
   * 最后一次**真正走到 doGrant** 的奖励种类（C13 的 checkin 观测点）。
   * 探针链上一环是 app.ts 的 riceGranted（拿 act 的返回值对账），
   * 这个读数补的是更早一问："请求到底进没进 brain"——
   * 解析失败的载荷在 act 里就被丢掉了（见那段 log），到不了这里。
   */
  let lastGrantKind: PetRewardKind | null = null
  /** 跑腿：上次出动时刻（30s 冷却）、挂着的那趟（seq 核对）、说过的台词（防复读） */
  let lastChaseAt = 0
  let pendingChase: { seq: number; run: PetRunReport } | null = null
  const chaseRecent: string[] = []

  // ---------------------------------------------------------------- 动作

  function doFeed(): void {
    const now = nowMs()
    if (now - lastInteractAt < PET_INTERACT_COOLDOWN_MS) {
      /**
       * V1-45 双击死带修复（2026-10-15 夜）。死带从哪来：双击的第一下在
       * +320ms 排了一记摸头、第二下在 +420ms 排喂饭（miai-extras 的
       * countClick）—— 摸头先执行并占掉 1200ms 共享冷却，喂饭到达时只过了
       * 「间隔 + 100ms」，间隔落在 (320, 1100) 就被这里静默吞掉。Windows
       * 默认双击容差 500ms 恰好落带内：用户习惯速度双击想喂饭，只得到
       * 一句摸头台词，饭没喂进去。
       *
       * 仲裁口径：如果压着这次喂饭的冷却**就是摸头刚占的**（最近一次有效
       * 互动是摸头、且还在冷却窗内），那这是同一个双击手势的两半，不是
       * v1 注释里防的那种"连点刷屏" —— 放行这一碗。喂过之后 lastFeedAt
       * 更新、豁免自动失效：紧接着再喂/再点的仍按 v1 静默拦下，既有的
       * 「冷却内完全忽略」只收窄了"摸头刚摸完的那一次"这个口子。
       */
      const fromOwnPat = lastPatAt > lastFeedAt && now - lastPatAt < PET_INTERACT_COOLDOWN_MS
      if (!fromOwnPat) return
    }
    lastInteractAt = now
    lastFeedAt = now
    const { state: next, ok, reason } = feedPet(state)
    if (!ok) {
      // 空饭盒与吃饱了是两句话：搞混的话，喂满的鱼会说"饭盒空了"（怪它自己）
      const full = reason === 'full'
      say(pickLine(full ? PET.FEED_FULL : PET.FEED_EMPTY), full ? 'feed-full' : 'feed-empty')
      return
    }
    state = withRiceMirror(next, { kind: 'feed', ref: null })
    // 好感 +2/日3（P3 ④ 计分表）：喂进嘴里的这一碗是"处出来的交情"，
    // 与饱食度的分开记账（连喂 20 顿的上限由 cap 拦）。
    applyAffection('feed')
    // commit(true)：喂饭回升跨档要播台词（契约点名）。顺序 = 先报档、再嚼 ——
    // 气泡最后停在"嚼嚼"上，符合"刚喂了一口"的当下（探针按 tag 抓两行都在日志）
    commit(true)
    say(pickLine(PET.FEED_OK), 'feed-ok')
    deps.anim(PET_DSH.ANIM.FEED)
  }

  function doPat(): void {
    const now = nowMs()
    if (now - lastInteractAt < PET_INTERACT_COOLDOWN_MS) return
    lastInteractAt = now
    lastPatAt = now
    // V1-46（2026-10-15 夜主人裁定）：摸头**不再回饱食度** —— 饱食度的唯一
    // 来源就是喂饭（见 shared/pet.ts 里被删掉的 PET_PAT_GAIN 那段注释）。
    // 摸头仍戳 lastInteractAt/lastPatAt（共享冷却与 V1-45 双击仲裁照旧），
    // 只是 state 上唯一的痕迹变成了下面这笔好感。
    // 好感 +1/日5（P3 ④）：甜头很小、上限最高 —— 摸头是随时可做的动作，
    // 它不该是刷好感的主路（主路是学习），但天天摸两下也该有点温度。
    applyAffection('pat')
    commit()
    say(pickLine(PET.PAT), 'pat')
  }

  /**
   * 被 rua（扩展脚本数出"短时间连点 >=5 下"才发这一条）。
   * 【为什么节流仍在这儿】阈值由页面本地数（要即时的手感），但"说不说"
   * 由这里定：连点完隔两秒又来一轮，气泡会变成弹幕 —— 4 秒冷却，
   * 每轮最多一句（v1 doRua 同值）。被戳烦了 = 傲娇情绪（TTL 60 秒）。
   */
  function doRua(): void {
    const now = nowMs()
    if (now - lastRuaQuipAt < PET_RUA_COOLDOWN_MS) return
    lastRuaQuipAt = now
    state = setPetEmotion(state, 'tsundere', new Date(now).toISOString())
    commit()
    say(pickLine(PET.RUA), 'rua')
  }

  /**
   * 答错一题（主窗渲染层上报，课名由它查好带来）。
   *
   * 【为什么"学过/没学过"是两条台词】同一句"这个明明教过"对着**没学到
   * 那课**的学员说，就变成了指责；分开之后，没学过的那条从"凶"变成"指路"。
   * 【记忆照记、嘴按冷却】连错五道题只提一次（30 秒冷却），但记忆环该更新
   * 还是更新 —— "上次那道题"要的是**最后一道错的**（v1 doWrong 同款）。
   */
  function doWrong(action: Extract<ReturnType<typeof parsePetAction>, { action: 'wrong' }>): void {
    const now = nowMs()
    const last = state.memory.events[state.memory.events.length - 1]
    const sameAsLast =
      last !== undefined &&
      last.kind === 'wrong' &&
      last.label === action.title &&
      now - Date.parse(last.at) < 60_000
    if (!sameAsLast) {
      state = pushPetMemory(state, 'wrong', action.title, new Date(now).toISOString())
    }
    // 好感 -1/日3（P3 ④ 计分表）。**与台词去重解耦**：sameAsLast 拦的是
    // "复读同一句"（60 秒内同一道题重复上报），不是"这题不算错" ——
    // 连错五道题每道都记一笔，防刷闸是表里的 cap=3，不是这里。
    // 落盘只在真有变化时：记忆更新或好感动过，二者有其一就要落。
    const affApplied = applyAffection('wrong')
    if (!sameAsLast || affApplied) commit()
    if (now - lastWrongQuipAt < PET_WRONG_COOLDOWN_MS) return
    lastWrongQuipAt = now
    if (action.title === null) {
      say(pickLine(PET.WRONG_NO_TITLE), 'wrong-notitle')
      return
    }
    say(
      action.learned
        ? PET.WRONG_LEARNED(action.title, action.order)
        : PET.WRONG_NOT_LEARNED(action.title, action.order),
      'wrong'
    )
  }

  function doGrant(kind: PetRewardKind, lessonId?: string): void {
    const { state: next, credited, capped } = grantPetRice(
      state,
      kind,
      new Date(nowMs()).toISOString()
    )
    // 饭镜像：lesson 带 lessonId（服务端硬要求的 ref.lessonId；缺了账本会
    // 标 rejected 拦下——见 deps.onRice 注释）；其余 kind 的 ref 是 null。
    // 【capped 为什么跳过镜像（V1-42 日上限）】账本按 kind 独立加账
    // （RICE_DELTA_BY_KIND），把这笔送进去 = 它会把上限拦下的这碗加回来，
    // 上限形同虚设。与 grantRunReward 的 granted 门同一套路：纯函数说
    // "发"才过账，"不发"就一个字节都别进账本。
    state = capped
      ? next
      : withRiceMirror(next, {
          kind,
          ref: kind === 'lesson' && typeof lessonId === 'string' && lessonId !== '' ? { lessonId } : null
        })
    // 探针用的如实读数（C13）：最后一个**真的进到这里**的奖励种类。
    // 住内存不落盘：它回答的是"这次调用到没到 brain"，不是一个要跨启动的历史。
    lastGrantKind = kind
    const spec = GRANT_SPECS[kind]
    // 学完/复习记进记忆（'answer' 不记 —— 每答对一题记一笔会把环刷成流水账；
    // 签到同理：它不是"学了东西"，见 GRANT_SPECS 的表注释）
    if (spec.remember) {
      state = pushPetMemory(state, 'lesson', null, new Date(nowMs()).toISOString())
    }
    // 好感（P3 ④ 计分表）：lesson/review 都是"学了东西"（+2/日6，共享一档
    // —— 学新课文与重做错题对关系是一件事）；签到 +1/日1；answer 不在表里
    // （答对一题是熟练度不是关系，且每答一题都记会把账刷成流水账）。
    if (kind === 'lesson' || kind === 'review') applyAffection('study')
    else if (kind === 'checkin') applyAffection('checkin')
    commit()
    // 台词按表走：answer 不冒泡（每答对一题都弹一句会把气泡变成弹幕；饭盒数字照涨）。
    // lesson / review / checkin 是"整块动作"，值得说（v1 口径 + 签到拍板）。
    // 【说哪个数（V1-42 / 空转[1]）】一律说**真进盒**的 credited，不说名义值：
    //   · credited > 0 —— 正常（或半仓截断，如 998+2 只说"收到 1 碗"）；
    //   · credited === 0 —— 这碗没进来，两种成因两句话：满仓 999（RICE_FULL）
    //     或当日赚满（RICE_CAP_TODAY）。两句话共用一个冷却锚 —— 都是"这碗
    //     没进盒"的回执，同一口气里连学几课只提醒一次（锚点用法同 lastWrongQuipAt）。
    // 【为什么 capped 的台词不挂在 spec.line !== null 里】answer 平时不说话，
    // 但"赚满被拦"必须说 —— 数字不再涨却零解释，正是 V1-42 要修的静默。
    if (capped) {
      const now = nowMs()
      if (now - lastRiceBlockedAt >= PET_RICE_FULL_COOLDOWN_MS) {
        lastRiceBlockedAt = now
        say(PET.RICE_CAP_TODAY, 'rice-cap')
      }
    } else if (spec.line !== null) {
      if (credited === 0) {
        const now = nowMs()
        if (now - lastRiceBlockedAt >= PET_RICE_FULL_COOLDOWN_MS) {
          lastRiceBlockedAt = now
          say(PET.RICE_FULL(PET_RICE_MAX), 'rice-full')
        }
      } else {
        say(spec.line(credited), spec.tag)
      }
    }
    // 「一口气学完好几课」的彩蛋：窗口内课数到线才说，说一次之后靠记忆环的
    // 自然衰减退场（连学四课不必听两遍）。学爆了 = 兴奋 90 秒 + 转一圈。
    // 【为什么门槛里要有 spec.remember】streak 到线之后紧接着来一次非学习奖励
    // （比如签到），不查这一条的话彩蛋会被"顺带"触发 —— 学的是课，转的却是签到的场。
    const streak = lessonStreak(state, new Date(nowMs()).toISOString())
    if (streak === PET_MEMORY_STREAK && spec.remember) {
      state = setPetEmotion(state, 'excited', new Date(nowMs()).toISOString())
      commit()
      say(PET.SPIN, 'spin')
      deps.anim(PET_DSH.ANIM.SPIN)
    }
  }

  /**
   * 执行一个动作。**只认 renderer 还会上报的六种**
   * （feed/pat/rua/grant/wrong/event）；pos/mode/size/show/hide/menu/chat
   * 是旧宠物窗的施动，新引擎里没有对应物（窗口与体型真源 = config.pet），
   * 来了记一行日志、原样返回快照 —— 不装作执行了（"默认回退为成功"的反面：
   * 至少留下痕迹）。
   */
  function act(raw: unknown): PetSnapshot {
    const action = parsePetAction(raw)
    if (!action) {
      // C1：解析不出来的载荷**必须留痕**。原来这里是静静 return ——
      // 于是"发饭请求根本没送到 brain"和"brain 照常处理了"在主进程日志里
      // 长得一模一样；app.ts 那侧的 riceGranted 也就无从对账（它会如实报 false，
      // 但没人知道为什么）。这一行是那条证据链的起点。
      log('act dropped: payload not parseable')
      return snapshotOf(state, nowIso())
    }
    if (action.action !== 'pos') lastActivityAt = nowMs()
    switch (action.action) {
      case 'feed':
        doFeed()
        break
      case 'pat':
        doPat()
        break
      case 'rua':
        doRua()
        break
      case 'grant':
        doGrant(action.reward, action.lessonId)
        break
      case 'wrong':
        doWrong(action)
        break
      case 'event':
        // 收工事件（P3 ④）：挑战完成 +3/日1、复习满分 +5/日1（表在 shared/pet.ts）。
        // 计上了才 commit —— 被日上限拦下时它就是一个安静的 no-op（探针靠
        // affectionCapped 归因）。跨档播报在 commit → announceAffection 里。
        if (applyAffection(action.kind)) commit(true)
        break
      default:
        // pos 是旧宠物窗 60ms 一次的机器心跳，日志会刷屏——静默丢弃；
        // 其余是人的动作，值得留痕（万一还有旧调用点，日志里看得见）
        if (action.action !== 'pos') log(`act not wired in dsh-pet engine: ${action.action}`)
        break
    }
    return snapshotOf(state, nowIso())
  }

  // ---------------------------------------------------------------- 运行上报

  /** v1 errorLine 的三档翻话（timeout 单列：它压根没走到编译器/解释器） */
  function errorLine(run: PetRunReport): string {
    if (run.kind === 'timeout') return PET.ERR_TIMEOUT
    if (run.kind === 'compile') {
      return run.line !== null ? PET.ERR_COMPILE_LINE(run.line) : PET.ERR_COMPILE_NO_LINE
    }
    return run.line !== null ? PET.ERR_RUNTIME_LINE(run.line) : PET.ERR_RUNTIME_NO_LINE
  }

  /**
   * 报错降级链（P3 ③ 契约，2026-10-09 补充模块一②收口）：按**当前**饥饿档
   * 决定这句报错还说不说得全。
   *   full/mild → 完整报错（errorLine，判定零改动）；
   *   medium    → 讨饭版（ERR_IMPATIENT）；
   *   severe    → **报错功能关闭**（主人点名的 1-20% 行为：这一档的嘴归催饭
   *               节拍 nagTick，报错一个字都不说）；
   *   empty     → null（彻底死机；调用方静默 + 留痕）。
   * 【为什么 severe 不再说 ERR_WEARY】"讲不动话"与"报错功能关闭"是两种设计：
   * 前者还在回应、只是话变短，后者是这件事整个停掉。主人拍板的是后者。
   * ERR_WEARY 留在 copy.ts 不属于本链（台词真源不删，谁再想起它时还在）。
   * 【为什么读此刻的 state】台词说的就是"此刻的我"；用报案时快照会让
   * "跑到一半饿崩了"说出与当下矛盾的整句。
   */
  function failLine(run: PetRunReport): string | null {
    const tier = petHungerTier(state.satiety)
    if (tier === 'full' || tier === 'mild') return errorLine(run)
    if (tier === 'medium') return PET.ERR_IMPATIENT
    return null
  }

  /** 「刚跑通过」进记忆环（5 分钟去重）——renderer 上报与原生观察器馈入共用 */
  function rememberRunOk(): void {
    const iso = new Date(nowMs()).toISOString()
    const last = state.memory.events[state.memory.events.length - 1]
    const recentSame =
      last !== undefined && last.kind === 'run-ok' && nowMs() - Date.parse(last.at) < 5 * 60_000
    if (recentSame) return
    state = pushPetMemory(state, 'run-ok', null, iso)
    commit()
  }

  /**
   * 发运行奖（自己写的代码跑通 → 大白饭 +1）。指纹去重（跨天保留）与日上限
   * 两道闸都在 grantRunReward 里；没发出去（重复指纹/今天满了）返回 false，
   * 调用方决定要不要退回普通表扬。发了 → 台词 + 表扬动画，并顶掉这一轮的
   * 口头表扬冷却（+1 那句已经是表扬，再补一句"跑通啦"就成了两连发）。
   */
  function awardRun(fp: string): boolean {
    const { state: next, granted } = grantRunReward(state, fp, new Date(nowMs()).toISOString())
    if (!granted) return false
    // 饭镜像：run 的 ref.fingerprint 是服务端硬要求（账本缺它会标 rejected）
    state = withRiceMirror(next, { kind: 'run', ref: { fingerprint: fp } })
    commit()
    lastPraiseAt = nowMs()
    say(pickLine(PET.RUN_REWARD), 'run-reward')
    deps.anim(PET_DSH.ANIM.PRAISE)
    return true
  }

  function reportRun(raw: unknown): void {
    const run = normalizeRunReport(raw)
    if (!run) return
    lastActivityAt = nowMs()
    if (run.ok) {
      // 跑通了 → 先记记忆环（"主人刚跑通过"是聊天/搭话时值得用的上下文）
      rememberRunOk()
      // 发奖优先：own（渲染层的种子比对证据）+ 没跑过的指纹 → 大白饭 +1。
      // 官方示例代码在渲染层就不带 own（机械保障，见 runner store 的 seedFp）；
      // hash 用 typeof 收窄 —— 它是可选字段（string | null | undefined 三态），
      // `!== null` 挡不住 undefined（类型上漏过去 = 将来真漏一个就静默不发）
      if (run.own && typeof run.hash === 'string' && awardRun(run.hash)) return
      const now = nowMs()
      if (now - lastPraiseAt >= PET_PRAISE_COOLDOWN_MS) {
        lastPraiseAt = now
        say(pickLine(PET.PRAISE_RUN), 'run-ok')
        deps.anim(PET_DSH.ANIM.PRAISE)
      }
      return
    }
    // 失败：优先跑腿到报错现场（v1 alert 指令的迁移）。送不出去/冷却内/饿扁
    // 各有各的明确出口 —— 绝不"默认回退为成功"。
    const now = nowMs()
    if (run.rect !== null && deps.chase && now - lastChaseAt >= PET_CHASE_COOLDOWN_MS) {
      if (state.satiety <= 0) {
        // 饿扁拒跑（不吃冷却：喂一口饭就能立刻出动）。台词告诉你为什么不动
        say(pickLine(PET.CHASE_HUNGRY), 'chase-hungry')
        deps.anim(PET_DSH.ANIM.HUNGRY)
        return
      }
      if (state.satiety < PET_HUNGER_MEDIUM_AT) {
        // 重度饥饿（1-19）跑腿也关（补充模块一②的"报错功能关闭"覆盖这条路）。
        // 零档的专属台词不复用到这里（CHASE_HUNGRY 回答的是"为什么一步没动"，
        // 那一档才配得上）；这一档的嘴归 nag 催饭节拍。不吃冷却：喂两口到 20
        // 立刻能出动。也不 return —— 落给下面的降级链统一收尾（这一档
        // failLine 恒 null，由末尾那行日志留痕，两条日志各说各的事）。
        log(`chase skipped (hungry ${state.satiety})`)
      } else {
        // 落点：报错框右缘再往右一个身位（72px ≈ 宠物半身，鱼贴着框站）
        const seq = deps.chase(run.rect.x + run.rect.width + 72, run.rect.y + run.rect.height / 2)
        if (seq > 0) {
          lastChaseAt = now
          state = exertPet(state, PET_CHASE_COST)
          commit()
          pendingChase = { seq, run }
          return // 台词等到了再说 —— 跑腿的重头戏是落点旁那句话
        }
      }
    }
    // 报错降级链（P3 ③）：越饿话越少，severe/empty 两档整个停掉。上面的
    // 饿扁拒跑（CHASE_HUNGRY）是 empty 档**唯一**还能出声的例外 —— 它在
    // 回答用户刚按下的"跑"，不是主动搭话。
    const line = failLine(run)
    if (line !== null) {
      say(line, 'run-err')
      return
    }
    // 静默必须有痕：不落这行的话，「饿到不说话」与「这条上报压根没到这」
    // 在日志里长得一模一样（假绿的经典入口）。带档位：severe 与 empty 的
    // 静默是两种行为（关功能 / 死机），探针要能分流。
    log(`run-err dropped (${petHungerTier(state.satiety)})`)
  }

  /**
   * 跑腿到达（宿主转发渲染端 ACK）。seq 与挂着的那趟不一致 = 陈旧回执，
   * 静默作废 —— 绝不把"到了"记到新的一趟头上。
   * 台词 = 行号前缀（知道才加）+ chase 场景池挑一句（配图照池子设计带出）。
   */
  function chaseArrived(seq: number): void {
    const pending = pendingChase
    if (!pending || pending.seq !== seq) return
    pendingChase = null
    const q = pickQuip('chase', { recent: chaseRecent.slice(-6) })
    chaseRecent.push(q.text)
    if (chaseRecent.length > 12) chaseRecent.splice(0, chaseRecent.length - 12)
    const lead = pending.run.line !== null ? PET.CHASE_LINE_LEAD(pending.run.line) : ''
    say(`${lead}${q.text}`, 'chase-arrived', q.meme)
  }

  /** 跑腿超时（宿主 6s 兜底）：这趟作废 + 原地补说报错话术（降级，不是失败） */
  function chaseTimeout(seq: number): void {
    const pending = pendingChase
    if (!pending || pending.seq !== seq) return
    pendingChase = null
    say(errorLine(pending.run), 'run-err')
  }

  /**
   * 原生编译路径的运行奖（native-watch 的 onCompiled → host.grantRun → 这里）。
   * fp 由主进程在导出时算好随请求带入（用户会在 IDE 里改代码，确认时重算会把
   * 奖励记到没交出去的代码头上）；去重/日上限与渲染路径共用同一本账。
   */
  function grantRun(fp: string): boolean {
    lastActivityAt = nowMs()
    rememberRunOk()
    return awardRun(fp)
  }

  // ---------------------------------------------------------------- 出场问候

  /**
   * 出场问候的**选档**：多日不见 > 饿 > 夜里 > 平常（v1 greetingLine 原样）。
   * 【为什么"多日不见"盖过"饿"】饿是衰减的结果，两天没来必然也饿着 ——
   * 但这两种委屈不是一回事：一句"好几天了喵"直接回应"你去哪儿了"。
   * 平常档 = v1 的 PET.GREETING 三条（"才、才不是特意等你"那组）——
   * 主人点名的"第一版语言"就住那里；引擎自己的 startup 台词池归 80 秒
   * 那条定时碎碎念用，两边不抢同一个时刻。
   */
  function greet(): void {
    if (awayOnLaunch >= PET_LONG_AWAY_MS) {
      say(pickLine(PET.GREETING_LONG_AWAY), 'greet:away')
    } else {
      const face = petFace(state, nowIso())
      if (face === 'hungry') say(pickLine(PET.GREETING_HUNGRY), 'greet:hungry')
      else if (face === 'sleepy') say(pickLine(PET.GREETING_SLEEPY), 'greet:sleepy')
      else say(pickLine(PET.GREETING), 'greet')
    }
    awayOnLaunch = 0 // 用过一次就清（同一次会话重开桌宠不再"好几天不见"）
  }

  // ---------------------------------------------------------------- 心跳

  /**
   * 长时间不动 → 主动搭话（v1 proactiveTick）。
   * 优先说"上次那道错题"：通用搭话（"在吗喵"）说三遍就是噪音；挂着没弄懂的
   * 题时，那句《课名》的问句是唯一**真的有用**的搭话。各有 20 分钟冷却。
   * 返回"这一拍说没说" —— tick 用它做"一拍最多一句"的互斥（说了就不再让
   * 催饭/撒娇抢同一拍的气泡）。
   */
  function proactiveTick(): boolean {
    // 归零静默（P3 ③）：饿扁了连"在吗喵"都不该有 —— 放最外层，连冷却都不烧
    //（饿着的时候不算"这次说过了"；喂回饭后一切照旧）。闸门两处收敛的另一处
    // 在宿主 say 叶子写口，这里是 brain 入口这一处。
    if (state.satiety <= 0) {
      proactiveSuppressed += 1
      return false
    }
    // 冷漠抑制（2026-10-09 补充模块一②「20%- 冷漠」）：好感 <20 的鱼不主动
    // 搭话 —— 冷着的它不会凑过来问"在吗喵"。计数与归零档分开记（同上面
    // 的理由：探针要把两种"没说话"分流）。冷却同样不烧。
    if (petAffectionTier(state.affection) === 'cold') {
      coldSuppressed += 1
      return false
    }
    if (!deps.getMainFocused()) return false
    const now = nowMs()
    if (now - lastActivityAt < PET_PROACTIVE_IDLE_MS) return false
    if (now - lastProactiveAt < PET_PROACTIVE_COOLDOWN_MS) return false
    lastProactiveAt = now
    const label = lastWrongLabel(state)
    say(label !== null ? PET.PROACTIVE_MEMORY(label) : pickLine(PET.PROACTIVE), label !== null ? 'proactive-memory' : 'proactive')
    return true
  }

  /**
   * 催饭节拍（2026-10-09 补充模块一②「1-20% 持续催促喂饭」，节拍覆盖
   * mild/medium/severe 三档——中度迟缓与轻度也在饿，一起催，只是频率不同）。
   * 返回"这一拍说没说"（同 proactiveTick 的互斥约定）。三道门：
   *   · satiety<=0 / full 档 → 不催（死机档与饱食档都不是"在饿"）；
   *   · 主窗不在人手里 → 不催（同 proactiveTick 的口径：去别的软件干正事时
   *     一句"快去做题换饭"是典型的好心办坏事）。这一道门**不烧节拍** ——
   *     人一回来立刻可催，记忆留在 lastNagAt 里；
   *   · 节拍不足 → 不催（severe 90s / medium 180s / mild 300s，越饿越勤）。
   * 台词 NAG_FEED 三条走 pickLine 会话轮转（同一条不连说两遍）。
   */
  function nagTick(): boolean {
    if (state.satiety <= 0) return false
    const tier = petHungerTier(state.satiety)
    if (tier === 'full') return false
    if (!deps.getMainFocused()) return false
    const gap =
      tier === 'severe' ? NAG_GAP_SEVERE_MS : tier === 'medium' ? NAG_GAP_MEDIUM_MS : NAG_GAP_MILD_MS
    const now = nowMs()
    if (now - lastNagAt < gap) return false
    lastNagAt = now
    nagCount += 1
    say(pickLine(PET.NAG_FEED), 'nag')
    return true
  }

  /**
   * 撒娇节拍（2026-10-09 补充模块一②「好感 80%+ 频繁撒娇」）：love 档每
   * 4 分钟蹭一下 —— NUZZLE 动画 + 一句 affection 池台词（logTag 'love-nuzzle'
   * 只进日志供探针对账，池子轮转照旧吃 recentSaid）。
   * 【为什么不挂主窗焦点门】撒娇不是请求（"快去做题"那种），是"本鱼还在
   * 这儿"的温度 —— 与引擎自带碎碎念同一类环境音；nag 要门是因为它在要求
   * 用户做事。
   * 【为什么 satiety<=0 直接 return 且不烧节拍】归零档"彻底死机趴桌面"，
   * 撒娇与它矛盾；不烧节拍 = 喂回来立刻能撒娇（复活的第一下就该是甜的）。
   * 【顺序】先台词后动画（house pattern：doFeed/doGrant 同款）—— 气泡最后
   * 落定，动画不抢话。
   */
  function nuzzleTick(): boolean {
    if (petAffectionTier(state.affection) !== 'love') return false
    if (state.satiety <= 0) return false
    const now = nowMs()
    if (now - lastNuzzleAt < NUZZLE_GAP_MS) return false
    lastNuzzleAt = now
    nuzzleCount += 1
    deps.quip('affection', 'love-nuzzle')
    deps.anim(PET_DSH.ANIM.NUZZLE)
    return true
  }

  /**
   * 饿脸节拍（V2-25 + V1-50 的另一半，2026-10-15 夜）：「饿」不能只有气泡一条
   * 通道 —— 桌宠的主场是用户在看别的软件，气泡不看就错过了，脸色是唯一
   * 不用读文字也能看见的信号。脸色 hungry 时每 HUNGRY_FACE_GAP_MS 播一次
   * 已有的不开心的脸（PET_DSH.ANIM.HUNGRY）。
   * 【为什么不说话、不烧节拍、不挂主窗焦点门】say 通道有自己的节拍（归零一记
   * hungry-sob + 三档 nag），这里只补画面；与 nuzzleTick 同款理由：环境音
   * 不是请求。不说话就不吃"一拍一句"的互斥 —— 气泡与动画是两条通道。
   * 【返回值】true = 这一拍真的叹了。tick 拿它做一件事：撒娇播过的那一拍
   * 饿脸让位（同一拍两条动画会互相打断，让给"气泡+动画"成套的那条）。
   */
  function hungryFaceTick(): boolean {
    if (petFace(state, nowIso()) !== 'hungry') return false
    const now = nowMs()
    if (now - lastHungryFaceAt < HUNGRY_FACE_GAP_MS) return false
    lastHungryFaceAt = now
    hungryFaceCount += 1
    deps.anim(PET_DSH.ANIM.HUNGRY)
    return true
  }

  function defaultSampleCpu(): { idle: number; total: number } {
    let idle = 0
    let total = 0
    for (const c of cpus()) {
      idle += c.times.idle
      total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq
    }
    return { idle, total }
  }

  /**
   * CPU 采样：两次心跳之间 os.cpus() 的累计时间差算使用率。
   * 连续两个心跳 >=90% 才算"烧"（单次 30 秒的高位很常见：编译正好撞上），
   * 冒泡有 10 分钟冷却（v1 cpuTick 同值）。
   */
  function cpuTick(): void {
    const sample = deps.sampleCpu ?? defaultSampleCpu
    let idle = 0
    let total = 0
    try {
      const s = sample()
      idle = s.idle
      total = s.total
    } catch {
      return // 采样失败（极罕见）：保持上一次读数，下一次心跳再采
    }
    const prev = prevCpu
    prevCpu = { idle, total }
    if (!prev) return
    const dTotal = total - prev.total
    const dIdle = idle - prev.idle
    if (dTotal <= 0) return
    const usage = 1 - dIdle / dTotal
    cpuStreak = usage >= CPU_HOT_LEVEL ? cpuStreak + 1 : 0
    const now = nowMs()
    if (cpuStreak >= CPU_HOT_STREAK && now - lastCpuQuipAt >= CPU_QUIP_COOLDOWN_MS) {
      // 归零静默（P3 ③）：饿扁了不吐槽 CPU。**只闸冒泡、不闸采样** ——
      // 采样照常（否则恢复后的第一次差分会横跨整段饿期，dTotal 巨大、
      // 平均下来 usage 直接被稀释成假阴性）；冷却也不烧（饿着不算说过）。
      if (state.satiety <= 0) {
        cpuSuppressed += 1
        return
      }
      lastCpuQuipAt = now
      say(PET.CPU_HOT, 'cpu-hot')
    }
  }

  /**
   * 冻结 / 解冻（空转[4]，2026-10-16；起步冻结见 PetBrainDeps.startPaused）。
   *
   * 【冻结】只翻一个位：tick 空转、此后到解冻前**零 commit** —— pet.json
   * 一个字节都不动。宿主那边同时把心跳表停掉，两层保险谁也漏不掉。
   *
   * 【解冻】把冻结这一整段从账上抹掉，三个锚点一起重锚到"此刻"：
   *   · lastDecayAt / lastAffectionAt —— 不重锚的话下一拍会从冻结前的旧
   *     锚点整段补扣（关掉三天再开、一次掉几百的账）；
   *   · touchPetSeen —— "见面时刻"补上。不补的话下次启动会拿冻结前的
   *     旧 lastSeenAt 算 awayMs，白送一句"好久不见"+ 一记 long-away 好感。
   * 重锚必须**落盘**（commit）：不落的话重启后装载路径又拿旧锚点补扣，
   * 冻结就白冻了。
   *
   * 【只认真转换】next === paused 直接 return —— 宿主每次保存设置都会喊
   * 一遍（改个主题也会走到 applySettings），不判的话每次设置保存都重锚
   * 落盘，把正常在线衰减的零头也清掉。
   */
  function setPaused(next: boolean): void {
    if (next === paused) return
    paused = next
    if (paused) {
      log('paused: pet disabled — tick is a no-op until unpaused')
      return
    }
    const iso = nowIso()
    state = touchPetSeen(state, iso)
    // ⚠️ 两个锚点**不同形**：lastDecayAt 是 ISO 串、lastAffectionAt 是毫秒数
    // （shared/pet.ts:182/218 的字段注释）—— 写成一个形状 typecheck 当场红
    state = { ...state, lastDecayAt: iso, lastAffectionAt: nowMs() }
    commit(false)
    log('unpaused: decay/affection/seen anchors re-anchored to now (frozen span written off)')
  }

  /**
   * 心跳（宿主 30s 一次）。落盘条件是「掉过饱食度 **或** 锚点变过」——
   * 第二种是饱食度已为 0 时锚点仍在按整周期推进、以及时钟回拨的重锚。
   * 只看 dropped 的话锚点会悄悄冻在过去：饿扁期间喂一碗，下一次心跳会把
   * 攒了几小时的"补扣"一次吃完（喂了跟没喂一样，且现象完全无法归因）。
   */
  function tick(): void {
    // 冻结双保险（空转[4]）：宿主已停表，这里是"哪怕谁又接回常驻"的第二道
    if (paused) return
    const iso = nowIso()
    const { state: next, dropped } = decayPet(state, iso, PET_DECAY_ONLINE_PERIOD_MS)
    if (dropped > 0 || next.lastDecayAt !== state.lastDecayAt) {
      state = next
      // 挨饿到 0 的那一刻：好感 -2/日1（P3 ④ 计分表）。判据 = "这一跳真的
      // 掉了饱食度、且落点是 0"——躺在 0 上时 dropped=0 不会再罚（cap=1
      // 只是防"喂回 1 又饿回 0"的极端，不是重复罚的依靠）。
      //
      // 【V2-27：为什么这一处就是"饿到 0"的全部（别再铺第二处检查）】
      // 全库能把 satiety 变小的只有三条路，逐一枚举：
      //   ① 本心跳的在线衰减 —— 不设下限、能到 0（就是这一行）；
      //   ② 启动装载的离线补算 —— 被 PET_OFFLINE_DECAY_FLOOR(=20) 兜底，
      //      数学上到不了 0（V2-21：0 档只留给"开着也一直不理它"）；
      //   ③ 跑腿的 exertPet —— 出动门槛 satiety ≥ 20、单次只花 1，也到不了 0。
      // 所以"饿到 0"在任何可达路径上都落回这一条判据；设置页互动说明那句
      // （copy.ts 的 PET_GUIDE_AFF_DOWN，V2-27 改成了「让它饿到 0」）说的
      // 就是这件事。将来若新增第四条减 satiety 的路，先回来读这段：
      // 落点能不能到 0、判据放哪儿、文案跟不跟，三件事一起定。
      if (dropped > 0 && state.satiety <= 0) applyAffection('starving')
      // commit(true)：衰减跨档播一句（契约点名的两个时刻之一）。先于饿叹 ——
      // 跨进 empty 时 announceTier 不播（归零的话归 hungry-sob），没有双声。
      commit(true)
      if (state.satiety <= 0 && !sobbed) {
        sobbed = true
        say(PET.HUNGRY_SOB, 'hungry-sob')
      }
    }
    // 好感衰减（P3 ④）：每 24h -1、锚点整周期推进，与饱食度同落在这个心跳里。
    // 锚点变过（含时钟回拨重锚）也要落盘 —— 同 decayPet 的理由（见 shared/pet.ts）。
    const affDecayed = decayAffection(state, iso)
    if (
      affDecayed.dropped > 0 ||
      affDecayed.state.lastAffectionAt !== state.lastAffectionAt
    ) {
      state = affDecayed.state
      commit(true)
    }
    if (state.satiety > 0) sobbed = false
    cpuTick()
    // 环境音三条（主动搭话 / 催饭 / 撒娇）**一拍最多一句**：前一条说了
    // 就跳过后面的（气泡只有一条通道，同一拍两条只会互相顶掉，日志里却
    // 记了两笔 —— 探针"出现过"的判据就跟着骗人）。
    let spoke = proactiveTick()
    if (!spoke) spoke = nagTick()
    // 撒娇蹭过没有单独记：饿脸只在这条动画播过的拍上让位（同拍两条动画互相打断）
    let nuzzled = false
    if (!spoke) nuzzled = nuzzleTick()
    // 饿脸节拍（V2-25）：不吃上面"一拍一句"的互斥 —— 气泡与动画是两条通道，
    // 谁说了话都不妨碍这一口叹气；唯一让位的是动画通道内部的冲突。
    if (!nuzzled) hungryFaceTick()
  }

  // ---------------------------------------------------------------- 聊天（护栏与记忆）

  /*
   * 【为什么聊天账走 brain 而不是宿主自开一个 store】pet.json 的内存真状态住
   * 在本文件的闭包里（state），护栏账（memory.chatDay / chatCallsToday /
   * chatTokensToday / lastChatAt）与喂饭、情绪共用同一本账。宿主若自己再开
   * 一个 store 读写同一份文件，就会出现两个内存副本各自 save、谁后写谁赢的
   * 互相覆盖 —— 账本只能有一个持有者，就是这里。三道护栏的判定与记账全部
   * 复用 shared/pet.ts 的 v1 纯函数（petChatGate / petChatCommit），零改动。
   */

  function chatGate(): PetChatGate {
    return petChatGate(state, nowIso())
  }

  function chatCommit(usedTokens: number): void {
    state = petChatCommit(state, nowIso(), usedTokens)
    commit()
  }

  /**
   * 两个时刻隔几个自然日（按 petDayKey 的日界算），**照抄 v1 的 dayDiff 代码**。
   *
   * 【语义如实说】跨零点只差 2 分钟（23:59 → 00:01）**算 1**（"上次聊天是昨天"）——
   * 按自然日算就是这样，而且字面上是对的（确实发生在昨天）。同一自然日内隔
   * 23 小时也算 0（"今天"）。
   * ⚠️ v1（main/pet/index.ts）那句注释曾把这条写成"23:59 和 00:01 不会算成隔一天"——
   * 那是注释写错了，代码从来是自然日差。本迁移只照抄代码、不照抄错注释；
   * 谁要改语义，先想清楚"刚过零点接着聊"该说昨天还是今天，再动这里和单测。
   */
  function chatDayDiff(aIso: string, bIso: string): number {
    const a = Date.parse(`${petDayKey(aIso)}T00:00:00Z`)
    const b = Date.parse(`${petDayKey(bIso)}T00:00:00Z`)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
    return Math.round((a - b) / 86_400_000)
  }

  /**
   * 记忆块（v1 memoryBlock 的逐条迁移，出处 main/pet/index.ts:905-932）。
   * 挑三样：挂着的错题（接着聊）、刚跑通（话题）、一口气学完的课数，
   * 外加"上次聊天隔了多久"（续旧）。每多一行都是每次聊天的固定 token 成本，
   * 所以 slice(0,3) 的上限照抄 v1。挑不出任何东西就回空串。
   */
  function chatMemoryBlock(): string {
    const iso = nowIso()
    const lines: string[] = []
    const label = lastWrongLabel(state)
    if (label !== null) lines.push(PET.MEMORY_EVENT_WRONG(label))
    const lastEvt = state.memory.events[state.memory.events.length - 1]
    if (
      lastEvt !== undefined &&
      lastEvt.kind === 'run-ok' &&
      nowMs() - Date.parse(lastEvt.at) <= 15 * 60_000
    ) {
      lines.push(PET.MEMORY_EVENT_RUNOK)
    }
    const streak = lessonStreak(state, iso)
    if (streak >= 2) lines.push(PET.MEMORY_EVENT_LESSON(streak))
    const lastChat = state.memory.lastChatAt
    if (lastChat !== null) {
      const days = chatDayDiff(iso, lastChat)
      if (days <= 0) lines.push(PET.MEMORY_LAST_CHAT_TODAY)
      else if (days === 1) lines.push(PET.MEMORY_LAST_CHAT_YESTERDAY)
      else lines.push(PET.MEMORY_LAST_CHAT_DAYS(days))
    }
    if (lines.length === 0) return ''
    return `${PET.MEMORY_HEADER}${lines.slice(0, 3).join('；')}。`
  }

  // ---------------------------------------------------------------- 对外

  return {
    init(): PetSnapshot {
      return snapshotOf(state, nowIso())
    },
    act,
    reportRun,
    greet,
    tick,
    setPaused,
    chatGate,
    chatCommit,
    chatMemoryBlock,
    chaseArrived,
    chaseTimeout,
    grantRun,
    mirrorRice,
    debugState: () => ({
      satiety: state.satiety,
      rice: state.rice,
      fedTotal: state.fedTotal,
      earnedTotal: state.earnedTotal,
      mode: state.mode,
      face: petFace(state, nowIso()),
      events: state.memory.events.length,
      awayOnLaunchMs: awayOnLaunch,
      idleMs: nowMs() - lastActivityAt,
      sobbed,
      cpuStreak,
      // P3 ③ 观测点：当前饥饿档 + 两个静默闸各拦下几次（"0 档静默枚举"的
      // 判据就靠它们把"没说话"归因到闸门，而不是"条件没触发"）
      hungerTier: petHungerTier(state.satiety),
      proactiveSuppressed,
      cpuSuppressed,
      // 补充模块一②的观测点：冷漠闸拦下几次 / 催饭说了几次 / 撒娇蹭了几次、
      // 各自"上次真说了"的时刻（探针按节拍判"该响没响"时要看它）。
      coldSuppressed,
      nagCount,
      lastNagAt,
      nuzzleCount,
      lastNuzzleAt,
      // V2-25 观测点：饿脸叹过几口、上一口在什么时候（探针按节拍判"该叹没叹"）
      hungryFaceCount,
      lastHungryFaceAt,
      chatCallsToday: state.memory.chatCallsToday,
      chatTokensToday: state.memory.chatTokensToday,
      lastChatAt: state.memory.lastChatAt,
      lastChaseAt,
      pendingChaseSeq: pendingChase?.seq ?? 0,
      runLedgerCount: state.runLedger.hashes.length,
      runRewardsToday: state.runLedger.count,
      // P3 ④ 好感度观测点（C13）：当前值 + 衰减锚点 + 当日事件账（原样给，
      // 探针要核"第 N+1 次 no-op"靠它）+ 跨档计数。判据长这样：喂饭跨档 →
      // affectionUp +1 且日志里有一行 affection tier；cap 拦住 → 数字不动
      // 但 affectionCapped +1 —— 两个读数合起来才分得清"没跨"和"被拦"。
      affection: state.affection,
      lastAffectionAt: state.lastAffectionAt,
      affectionDay: state.affectionDay,
      affectionTier: petAffectionTier(state.affection),
      affectionUp,
      affectionDown,
      affectionCapped,
      // C13：checkin 相关观测点（宿主 debugState 里嵌着这份，探针直接读得到）。
      // 判据长这样：签到的 grant 走完 → 'checkin'；载荷坏掉被丢 → 保持旧值
      // 且日志里有 'act dropped' —— 两个读数合起来才能区分"没执行"和"执行了"。
      lastGrantKind
    })
  }
}
