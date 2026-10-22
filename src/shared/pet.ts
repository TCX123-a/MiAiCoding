/**
 * 大肥鱼桌宠（2026-10-06）的**纯逻辑与类型** —— 零 electron、零 DOM、零中文。
 *
 * 【为什么单独一份共享模块，不把状态直接塞进 config.json】
 * 桌宠的状态（饱食度、大白饭数、位置、模式）和用户的**设置**是两种东西：
 * 设置是人改的，状态是宠物自己变的（心跳衰减、学习发奖）。塞进 config 就要写
 * schema 迁移（铁律 6：改 config 必须 bump version + 迁移），而这份状态每个心跳
 * 都可能变、还带运行时刻的时间戳 —— 迁移函数对它没有意义。所以独立一份
 * pet.json（main/pet/store.ts 读写），config 一个字节都不动。
 *
 * 【形状清洗全在这里，测试也只测这里】
 * pet.json 是磁盘上的一坨 JSON：用户可能手改它、断电可能写坏它、老版本可能
 * 留下缺字段的文件。所有「信不信」的判定都收在 normalizePetState —— 主进程
 * 读写口只是它的传声筒（同 wallpaper/layout 的既定分工）。
 *
 * 【中文去哪儿了】本文件在 `src/` 下、会被文案闸门扫：注释随便写（会被剥掉），
 * **字符串字面量里一个中文都不许有**。所有台词、菜单、聊天人设住
 * `shared/copy.ts` 的 PET 段。
 */

import { beijingParts, localDateKey } from './dates'

// ---------------------------------------------------------------- 类型

/** 桌宠的三种行为模式（对应开源项目的 wander / follow / still 三模式） */
export type PetMode = 'wander' | 'follow' | 'still'

/** 心情：由饱食度一键推导，不单独存 —— 存了就有两处会漂 */
export type PetMood = 'happy' | 'ok' | 'hungry'

/**
 * 饥饿五档（P3 ③，2026-10-08 拍板）。比 PetMood 细一档：mood 管"脸色"，
 * 这个管"说什么话、报错怎么降级、为零后彻底静默"。
 * 饱食 80-100 / 轻度 50-80 / 中度 20-50 / 重度 1-20 / 归零 0。
 */
export type PetHungerTier = 'full' | 'mild' | 'medium' | 'severe' | 'empty'

/**
 * 好感度五档（P3 ④，2026-10-08 拍板）。边界 20/40/60/80，闭下界 ——
 * 与饥饿档同风格但**刻意不复用 mood 的 66/33**：两条轴各自独立，
 * 档位值共享会让"调整一条轴"变成"顺手改到另一条"。名字（中文）住
 * renderer/lib/copy.ts 的 AFFECTION.TIERS，本文件零中文。
 */
export type PetAffectionTier = 'cold' | 'familiar' | 'close' | 'like' | 'love'

/**
 * 好感度事件的来源类别（P3 ④）。每类一天有独立上限（防刷，见
 * PET_AFFECTION_RULES）。'study' 覆盖 grant 通道的 lesson/review 两种奖励
 * （"学了东西"是一件事）；'challenge'/'review' 是收工事件（pet:event 通道），
 * 与 grant 的计数互不占用。
 */
export type PetAffectionKind =
  | 'feed'
  | 'pat'
  | 'study'
  | 'challenge'
  | 'review'
  | 'checkin'
  | 'wrong'
  | 'starving'
  | 'long-away'

/**
 * 瞬时情绪（2026-10-06 加，主人的需求点名要"傲娇"）：由**事件**触发、
 * 带 TTL 自动回落 —— 被 rua 烦到 → 傲娇；一口气学完好几课 → 兴奋到转圈。
 *
 * 【为什么必须落盘（与"困"相反）】它跨不过重启吗？其实跨不过也无妨 ——
 * 但落盘的成本是两行 normalize，收益是账号里"昨天最后一件事是连点我"
 * 这种状态重启后还能延续几秒 TTL。比起新增三处内存计时器，落盘更省心。
 */
export type PetEmotion = 'tsundere' | 'excited'

/**
 * 「脸色」= 心情 + 时段 + 瞬时情绪（2026-10-06 加）。“困”由**时钟**推出来，
 * 跟“饿”一样不落盘：任何缓存的时刻都会在跨过 23 点之后悄悄变错，而错的
 * 东西没人报错。
 */
export type PetFace = PetMood | 'sleepy' | PetEmotion

/** 奖励来源。三个学习动作 → 白饭碗数；再加每日签到（2026-10-08，P3 ① 拍板） */
export type PetRewardKind = 'lesson' | 'review' | 'answer' | 'checkin'

/**
 * 体型三档（= 精灵素材的高度 px，见 renderer/public/pet/*_<n>.png）。
 *
 * 【为什么只认这三个数】素材就出了三档（187/238/306）。允许任意数字的话，
 * 一句手改的 pet.json 就能让宠物窗去 load 一个不存在的文件 —— 在透明窗里，
 * "图片加载失败"看起来和"桌宠没启动"一模一样。
 */
export type PetSize = 187 | 238 | 306

/** 记忆环里的事件类别（只收**值得回头提一句**的事，不是流水账） */
export type PetMemoryKind = 'wrong' | 'lesson' | 'run-ok'

/** 一条记忆。`label` 是课名这类短标签（拿不到就是 null，不许编一个） */
export interface PetMemoryEvent {
  kind: PetMemoryKind
  at: string
  label: string | null
}

/**
 * 桌宠的**记忆与聊天账本**（pet.json 的 v2 字段）。
 *
 * 【为什么这几样住在一起】它们全部回答同一个问题——“上一次跟你说话是
 * 什么时候、说到哪儿了”。拆成三个字段散在根上，读一处忘一处，连“今天”
 * 是哪天都会对不上（聊天限额按自然日重置，靠的就是这里唯一的 chatDay）。
 *
 * 【为什么值得落盘】「上次那道《指针》的题你弄懂了吗喵」这种话的**全部
 * 价值**在于“上次”是几天前的上次 —— 只活在内存里的话，关一次软件就失忆，
 * 每条问候都变成陌生人搭讪。
 */
export interface PetMemory {
  /** 最近的值得记住的事（错题 / 学完 / 跑通）。环状，最老的先丢 */
  events: PetMemoryEvent[]
  /** 上一次“见面”（应用打开、桌宠接上）的时刻。多日不登录的问候靠它 */
  lastSeenAt: string
  /** 上一次聊天时刻（聊天冷却与“上次聊到哪儿”用）；从没聊过就是 null */
  lastChatAt: string | null
  /** 聊天限额的自然日键（YYYY-MM-DD，本地时区）。与今天对不上 = 新的一天，额度重置 */
  chatDay: string
  chatCallsToday: number
  /** 当日累计**估算** token（输入+固定开销；不透传账单，只做护栏） */
  chatTokensToday: number
}

/**
 * 运行奖的去重账（pet.json v4 加）。
 *
 * 【为什么需要一本账】"跑通发一碗"和别的奖不一样：学习动作一天就那么几次，
 * 而"改一点、再跑一次"一小时能发生几十次。没有账本的话，一段 hello world
 * 反复跑就能把鱼喂到撑死，大白饭就失去"去学习换来的"这层含义。
 *
 * 【两把闸各拦什么】count（日上限）拦"形形色色的新代码狂轰滥炸"；
 * hashes（指纹表）拦"同一段代码反复跑"。指纹表**跨天不归零** —— 昨天领过
 * 的代码，今天再跑也不该再领（那是同一份作业）。
 */
export interface PetRunLedger {
  /** 自然日键（本地时区）。与今天对不上 = 新的一天，count 归零、hashes 保留 */
  day: string
  /** 当日已发出的运行奖碗数（≥ PET_RUN_REWARD_DAILY_MAX 就不再发） */
  count: number
  /** 最近发过奖的代码指纹（shared/code-hash 的产出）。环状，最老的先丢 */
  hashes: string[]
}

/**
 * 好感度的"当日账"（pet.json v5 加）。每天每类事件计几次，决定加不加
 * （超日上限 = 静默 no-op，见 addAffection）。
 * 【为什么记事件数而不是直接卡数值】上限属于"类别"而不是"金额"：
 * 没有这本账，"连喂 20 顿饭"就能把好感度刷满，学习的权重立刻失去意义。
 */
export interface PetAffectionDay {
  /** 自然日键（本地时区）。与今天对不上 = 新的一天，counts 归零 */
  day: string
  /** 当日各类事件已计入的次数（键 = PetAffectionKind，normalize 收窄） */
  counts: Record<string, number>
}

/**
 * 大白饭的"当日收入账"（pet.json v6 加）。每类学习奖每天入了账几次，
 * 决定还发不发（到 PET_RICE_DAILY_CAPS 即拒，见 grantPetRice）。
 * 【为什么与好感账分开两本】计量单位不同：好感账数"事件"（一次喂饭算一次），
 * 大白饭账数"真进盒的次数"（满仓那几次不算数）—— 合成一本会让两条闸互相
 * 借用对方的语义，改一条顺手污染另一条。形状相同是巧合，不是同一本账。
 */
export interface PetRiceDay {
  /** 自然日键（本地时区）。与今天对不上 = 新的一天，counts 归零 */
  day: string
  /** 当日各类学习奖已入账的次数（键 = PetRewardKind，normalize 收窄） */
  counts: Record<string, number>
}

/**
 * pet.json 的根形状（也会被原地升级）。
 *
 * 【为什么 `version` 从第一天就有】独立文件不等于永远不用迁移：哪天要给
 * 桌宠加字段（比如皮肤），老文件里没有它 —— 有版本号才能一眼分清
 * 「老文件缺字段」和「文件被写坏了」，两条路的兜底不一样。
 */
export interface PetState {
  version: number
  /** 桌宠总开关。关掉 = 窗口销毁，不是藏起来 */
  enabled: boolean
  /** 饱食度 0..100（整数）。喂一碗 +20，心跳按时间衰减 */
  satiety: number
  /** 饭盒里的白饭碗数 0..999（整数）。学习动作发的奖，喂一碗 -1 */
  rice: number
  /** 累计喂过几碗（纪念数字，不参与任何判定） */
  fedTotal: number
  /** 累计获得过几碗（同上） */
  earnedTotal: number
  /**
   * 上次衰减锚点（ISO 时刻）。**不是"最后一次变化"** —— 心跳按整周期往前
   * 推进它（见 decayPet），不满一个周期的零头原地留着，否则每次心跳都把
   * 零头抹掉，衰减会比标称值慢一大截，而且没人看得出来。
   */
  lastDecayAt: string
  mode: PetMode
  /** 位置（相对宠物窗工作区的比例 0..1，锚点是精灵左上角可到的范围） */
  x: number
  y: number
  /** 记忆与聊天账本（v2 加）。老文件没有它 → normalize 补一份空的 */
  memory: PetMemory
  /** 瞬时情绪（null = 平静）。是否还在时效内看 emotionUntil，见 petFace */
  emotion: PetEmotion | null
  /** 情绪的失效时刻（ISO）。落盘的是"什么时候过期"，不是"还剩多久" */
  emotionUntil: string
  /**
   * 体型（v3 加；设置卡的三档按钮）。**这是人选的、不是宠物自己变的** ——
   * 仍然住 pet.json 而不是 config：它和"这只鱼长什么样"的其它字段（模式、
   * 位置）是一族，塞进 config 要动铁律 6 的迁移与云同步那条线，为一个
   * 三选一不值得。v1 留 version 字段时说的"比如皮肤"，就是它。
   */
  size: PetSize
  /**
   * 运行发奖的去重账（v4 加）。老文件没有 → normalize 补一份空的（当天起算）。
   * 触发面有两条：内置编辑器跑通（brain.reportRun）与原生环境编译产物出现
   * （native-watch）——两边共用这一本账，跨环境也不会把同一段代码发两次。
   */
  runLedger: PetRunLedger
  /**
   * 好感度 0..100（整数，v5 加）。初始 50、每天 -1 衰减、事件加减。
   * 与饱食度**刻意分开**：饱食度管"当下饿不饿"（分钟级快变量），好感度管
   * "认识多久、处得怎么样"（天级慢变量）—— 混在一起的话，喂一顿饭就能让
   * 关系变亲，"关系"就不值钱了。
   */
  affection: number
  /**
   * 好感度衰减锚点（**毫秒时间戳**，v5 加）。与 lastDecayAt 不同形（那是
   * ISO 串）：衰减周期长达 24 小时，毫秒数少一次 Date.parse。按整周期
   * 推进（同 decayPet）：不满一整天的零头原地留着，事件**不重置**它。
   */
  lastAffectionAt: number
  /** 当日各类好感事件的计数（防刷，v5 加）。老文件没有 → 空账 */
  affectionDay: PetAffectionDay
  /**
   * 当日各类学习奖的入账计数（防刷，v6 加）。老文件没有 → 空账。
   * 到 PET_RICE_DAILY_CAPS 即拒发（grantPetRice 里收口，brain 明说一句）。
   */
  riceDay: PetRiceDay
}

/**
 * 对外读数叶子（P3 ③，2026-10-08）：宿主写进 /state 的 pets.main.vitals.data，
 * 渲染端右键菜单的饥饿进度条读它。**纯读数、不接指令** —— 喂饭/摸头仍走
 * pet:act；进度条是镜子不是按钮（契约原文：图形+百分比，无中文）。
 * mood 由宿主拼好（petMood(satiety)）—— 渲染端不重算，两处公式不漂。
 */
export interface PetVitals {
  satiety: number
  rice: number
  mood: PetMood
  /** 好感度 0..100（P3 ④ 加）。渲染端的读数口之一（右键菜单/侧栏） */
  affection: number
}

/** 推给渲染层的公开快照（不含 fedTotal/earnedTotal 这类账本细节） */
export interface PetSnapshot {
  enabled: boolean
  satiety: number
  rice: number
  mood: PetMood
  /** 心情 + 时段（“困”在夜里出现）。设置卡与宠物窗都看它 */
  face: PetFace
  mode: PetMode
  /** 体型（设置卡选中态与宠物窗换素材都看它） */
  size: PetSize
  x: number
  y: number
  /** 今天已领过几碗"跑通自己代码"奖（仓库卡显示 x/上限用）。跨天读作 0 */
  runRewardsToday: number
  /** 好感度 0..100（P3 ④ 加）。侧栏爱心与将来的好感页看它 */
  affection: number
}

/**
 * 主窗渲染层上报的「一次运行的结果」。
 *
 * 【为什么带上 rect 而不是只报行号】桌宠要**走到报错行旁边**，而宠物窗和
 * 主窗是两个窗口 —— 行号只有主窗自己知道在屏幕哪儿，视口矩形是它能给出的
 * 最小事实；换算成屏幕坐标由主进程做（主窗与宠物窗的位置都在它手里，
 * 见 dshpet/host.ts 的跑到现场那条链）。渲染层算屏幕坐标反而要再引一次
 * screen 模块，还会漏掉缩放因子。
 */
export interface PetRunReport {
  ok: boolean
  /** 失败的类别。timeout 单列是因为它压根没走到编译器/解释器 */
  kind: 'compile' | 'run' | 'timeout' | 'other'
  /** 第一条错误所在行（1 起）；解析不出来就是 null */
  line: number | null
  /** 错误位置在**主窗内容区**里的视口矩形（CSS px）；拿不到就是 null */
  rect: { x: number; y: number; width: number; height: number } | null
  /**
   * 这趟跑的是不是"他自己写的"（v4 加的奖励证据）。渲染层比对官方示例/
   * 课文原文/题目初始代码后给出：**缺省 false = 没证据 = 不发奖**
   * （绝不默认回退为成功）。老渲染层不发这个字段 → 洗成 false，行为退化为
   * "只是不发病"——报错跑腿等其它联动不受影响。
   */
  own?: boolean
  /** 代码指纹（shared/code-hash，`长度36:FNV16`）。形状不对洗成 null */
  hash?: string | null
}

/**
 * 主窗渲染层上报的「正文编辑区在哪」（pet:report-work-rect，2026-10-09
 * 补充模块一）。跟随鼠标的"绝不遮挡代码"让位规则靠它：光标落进这块矩形
 * 时鱼改为沿边等待，而不是继续贴着光标走。
 *
 * 【和 PetRunReport.rect 同一套坐标系】视口 CSS px，屏幕系换算在主进程
 * （withScreenRect 同款数学）。**null = 编辑区不在**（窗口要卸了）→ 让位
 * 规则整体关掉。宽高必须为正：半截矩形会让让位算错边，比没有更危险。
 */
export interface PetWorkRect {
  x: number
  y: number
  width: number
  height: number
}

/** 渲染层 → 主进程的动作（pet:act 通道的载荷） */
export type PetAction =
  | { action: 'feed' }
  | { action: 'pat' }
  | { action: 'grant'; reward: PetRewardKind; lessonId?: string }
  | { action: 'mode'; mode: PetMode }
  /** 设置卡选的体型（三档之一）。落盘后广播，宠物窗自己换素材 + 重报命中区 */
  | { action: 'size'; size: PetSize }
  | { action: 'pos'; x: number; y: number }
  | { action: 'show' }
  | { action: 'hide' }
  | { action: 'menu' }
  /** 连点超过阈值（宠物窗本地数完 5 下才发这一条）。台词与冷却在主进程 */
  | { action: 'rua' }
  /**
   * 聊天面板被打开了（宠物窗双击发的）。**开场白由主进程给**（PetCmd 的
   * chat-open 带 hello）—— 面板开在宠物窗里，而"上次那道题"藏在主进程
   * 的记忆环里，只有它能拼出那句开场白。
   */
  | { action: 'chat' }
  /**
   * 答错一题（主窗渲染层上报；课名等由渲染层查好随载荷带 —— 主进程没有
   * 内容包）。title/order 查不到就是 null（显示通用台词，不编课名）。
   */
  | { action: 'wrong'; title: string | null; order: number | null; learned: boolean }
  /**
   * 收工事件（P3 ④，走 pet:event 通道）：每日挑战完成 / 复习满分收工。
   * 这两件事发生在渲染层"练习收工"的时刻，没有别的 act 动作能表达它们；
   * kind 白名单与好感度的计分表（PET_AFFECTION_RULES）对齐。
   */
  | { action: 'event'; kind: 'challenge' | 'review' }

/** 宠物窗能播的整段动作（主进程点名，宠物窗负责演） */
export type PetAnim = 'spin' | 'squash' | 'stretch' | 'hop' | 'chomp'

/** 主进程 → 宠物窗的推送指令（pet:cmd 通道的载荷） */
export type PetCmd =
  | { kind: 'say'; text: string }
  | { kind: 'alert'; x: number; y: number; text: string }
  /** 打开聊天面板。hello = 第一条鱼说的话（记忆回访或平常招呼，主进程拼好） */
  | { kind: 'chat-open'; hello: string }
  | { kind: 'cursor'; x: number; y: number }
  | { kind: 'anim'; name: PetAnim }
  /** 音效开关/音量（设置页改的，宠物窗照着播或闭嘴。宠物窗读不到 config） */
  | { kind: 'sound'; on: boolean; volume: number }
  /**
   * 电脑空闲/回来（主进程 powerMonitor.getSystemIdleTime 判定，2026-10-06）。
   * on=true → 桌宠原地睡下（停游走、慢呼吸、冒 'z'）；false → 醒来。
   * 页面在点击/警报时也会本地先醒 —— 这条指令是"没人碰电脑"的那一路上报。
   */
  | { kind: 'idle'; on: boolean }

/**
 * 桌宠菜单「一键直达设置」的目标卡（2026-10-06 主人点名的快捷入口）。
 * wall = 动态壁纸卡 / ai = AI 大肥鱼卡 —— 与 SettingsView 里的
 * `.card.wall-card` / `.card.ai-card` 两个选择器对应。
 */
export type PetSettingsShortcut = 'wall' | 'ai'

/**
 * 主进程 → 主窗渲染层（app:nav 通道）：把主窗拉起来并跳到设置页的某张卡。
 * ts 是发起时刻（时间戳 nonce）—— 同一个快捷入口连点两次时，渲染层靠它
 * 区分"新的一次跳转"（第一次到达后用户可能又滚走了，第二次要重新滚过去）。
 */
export interface AppNavPayload {
  card: PetSettingsShortcut
  ts: number
}

/** 宠物窗上报的「哪些区域该接鼠标事件」（pet:hit 通道的载荷） */
export interface PetHitRect {
  x: number
  y: number
  w: number
  h: number
}

/** 聊天一条消息（发给 DeepSeek 的形状） */
export interface PetChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 聊天结果：失败也带一句**给人看的话**（由主进程从 copy.ts 取） */
export interface PetChatResult {
  ok: boolean
  text: string
}

// ---------------------------------------------------------------- 常量

/**
 * pet.json 的当前结构版本。
 * v1 → v2（2026-10-06）：根上多了 `memory`（记忆环 + 聊天账本）与
 * `emotion`/`emotionUntil`（瞬时情绪，傲娇/兴奋）。
 * v2 → v3（2026-10-06）：根上多了 `size`（体型三档，设置卡可调）。
 * v3 → v4（2026-10-06 晚）：根上多了 `runLedger`（跑通自己代码的发奖去重账）。
 * v4 → v5（2026-10-08 晚，P3 ④）：根上多了 `affection` / `lastAffectionAt` /
 * `affectionDay`（好感度：当前值、衰减锚点、当日事件账）。
 * v5 → v6（2026-10-15 夜，V1-42）：根上多了 `riceDay`（大白饭的当日收入账 ——
 * 学习奖的日上限，防"改一点跑一次/连刷题"把饭盒轰穿）。同版还改了摸头的
 * 语义（V1-46：只涨好感、不再回饱食度），但那不涉及字段形状，老档照读。
 * 迁移策略 = **补默认值**：老文件没有的就是"刚认识"（空记忆、没情绪、
 * 默认体型 187、空运行账），不搬任何东西（normalizePetMemory 里是一份干净的新记忆，
 * 不是映射出来的假历史）。v5/v6 同理：没有好感/大白饭账 → 空账起步。
 */
export const PET_VERSION = 6

/** 体型三档，由小到大（素材高度 px）。宠物窗的 SIZES 表与设置卡都看它 */
export const PET_SIZES: readonly PetSize[] = [187, 238, 306]
/**
 * 默认体型 = 最小档。两个理由：① 主人 2026-10-06 实测 238「有点太大」；
 * ② 默认要照顾小屏（原 pickSize 在矮窗口里也是回落到 187 的）。
 */
export const PET_SIZE_DEFAULT: PetSize = 187

export const PET_SATIETY_MAX = 100
/** 一碗大白饭回多少饱食度 */
export const PET_FEED_GAIN = 20
/**
 * 【摸头不再回饱食度（V1-46，2026-10-15 夜主人裁定）】原来的 PET_PAT_GAIN=2
 * 让"摸头"成了一个免费、无日上限的饱食度来源 —— 15 次摸头就抵消掉在线一小时
 * 的衰减（-30），"喂饭"这个唯一支出大白饭的动作被绕开了，0 档的"喂口饭或者学一节课
 * 就能唤醒"也不再是唯一出路。主人拍板：**摸头只涨好感（+1/日5，见
 * PET_AFFECTION_RULES.pat），饱食度的唯一来源就是喂饭**。常量与 patPet()
 * 一并删除 —— 留个 0 值常量只会让下一个读者以为"摸头还能回一点"。
 */
export const PET_RICE_MAX = 999

/**
 * 衰减速率：**开着的软件里每 2 分钟 -1，软件关着每 6 分钟 -1**
 * （P3 ③ 拍板 2026-10-08：原值 3min / 10min。周期改短 =「更容易饿」——
 * 五档台词与归零静默要真吃得着，一天不喂就该走到饿扁）。
 *
 * 【为什么两个速率】桌宠只在应用打开时存在，而饥饿是「好久没回来学习」的
 * 压力 —— 那个"好久"主要发生在应用**没开**的时候。若两个速率一样，
 * 挂机一晚和离线一晚掉得一样多，压力就指错了地方（惩罚的是忘了关电脑）。
 *
 * 【为什么是这个数量级】在线 -30/小时：一小时认真学习发 2 碗大白饭
 * （+40 饱食度），净赚 → 学习仍是正反馈；纯挂机一小时 -30，大半天必饿。
 * 离线 -1/6 分钟但**有下限**（PET_OFFLINE_DECAY_FLOOR，推导见饥饿档界
 * 下面那段）：关着软件最多少掉到下限，不会背着用户掉进静音的 0 档。
 */
export const PET_DECAY_ONLINE_PERIOD_MS = 2 * 60_000
export const PET_DECAY_OFFLINE_PERIOD_MS = 6 * 60_000

/** 心情分档：≥66 元气、≥33 还行、低于 33 饿扁 */
export const PET_MOOD_HAPPY_AT = 66
export const PET_MOOD_OK_AT = 33

/**
 * 饥饿档界（P3 ③ 拍板）：s≥80 full、≥50 mild、≥20 medium、≥1 severe、0 empty。
 * 边界是**闭下界**（80 算 full，79 才掉进 mild）—— 与 PET_MOOD_* 同一风格。
 * build/dshpet-extras 的进度条颜色按这四个数分档，那边有测试对着本文件的
 * 常量名逐一取数比对（防两处各写一份漂掉）。
 */
export const PET_HUNGER_FULL_AT = 80
export const PET_HUNGER_MILD_AT = 50
export const PET_HUNGER_MEDIUM_AT = 20
export const PET_HUNGER_SEVERE_AT = 1

/**
 * 离线衰减下限（V2-21 整改，2026-10-15 夜）：软件**关着**的那段时间，
 * 饱食度最多掉到这里 —— 回来时是「饿得直催」而不是静音的 0 档。
 *
 * 【为什么离线要有下限】0 档（empty）把主动那半全静音（催饭/搭话/撒娇/
 * 漫游/跟随，brain 的三条 tick 与 extras 的漫游闸门都按 satiety 卡），
 * 而"关着软件多久"不是用户能感知的操作 —— 学生党晚上关机、第二天放学
 * 回来 18 小时起步，按 6 分钟 1 点**必然归零**：每天回到电脑前迎接的
 * 是一条趴着的鱼，养成循环永远从谷底重启。这不是在惩罚疏忽，是在惩罚
 * 作息（V2-21 审查结论）。
 *
 * 【为什么是 20（= medium 档界）】原设计注释里"睡一觉（8 小时）回来剩
 * 20 上下（一进门就喊饿）"本来就是被接受的体验 —— 下限只是把"更久的
 * 离线"对齐到这条已拍板的体验上，不发明新状态。回来之后在线衰减照旧
 * -30/小时：真不喂，40 分钟内一样滑进 severe、一个多小时到 0 —— 0 档
 * 与趴窝仍在，惩罚的是"回来了还一直不理它"（看得见的疏忽），不是
 * "晚上睡了觉"。
 *
 * 【不能反着用】下限只是"不许比它更低"，不是"拉回它"：关软件时已经
 * 低于下限（比如在 0 档关的），离线期间原地不动，不许凭空涨回 20 ——
 * 那是喂饭的活儿（decayPet 里 min(satiety, floor) 就是这个意思）。
 * 在线心跳**不传**这个下限（用 decayPet 的默认 0）：盯着它还不喂，
 * 该饿扁就得饿扁。
 */
export const PET_OFFLINE_DECAY_FLOOR = PET_HUNGER_MEDIUM_AT

/**
 * 好感度五档的界（P3 ④ 拍板）：a≥80 love、≥60 like、≥40 close、≥20 familiar、
 * 其余 cold。闭下界（80 算 love，79 才掉进 like）——与 PET_HUNGER_* 同风格。
 * **刻意与 PET_MOOD_* 的 66/33 不同值**：好感度是另一条轴，两轴共用界值
 * 会让"调一条轴"顺手改到另一条；单测逐点钉死 20/40/60/80。
 */
export const PET_AFFECTION_LOVE_AT = 80
export const PET_AFFECTION_LIKE_AT = 60
export const PET_AFFECTION_CLOSE_AT = 40
export const PET_AFFECTION_FAMILIAR_AT = 20

/**
 * 好感度五档（低 → 高）。**数组顺序就是亲密度顺序** —— 跨档播报靠
 * indexOf 比大小判方向（up/down），不靠 delta 正负：衰减与事件叠加时
 * "这一跳到底向上还是向下"只有 tier 对比能说清。
 */
export const PET_AFFECTION_TIERS: readonly PetAffectionTier[] = [
  'cold',
  'familiar',
  'close',
  'like',
  'love'
]

/** 初始好感度（拍板）：50 —— "认识一半"，不冷冰冰也不自来熟 */
export const PET_AFFECTION_INITIAL = 50
export const PET_AFFECTION_MAX = 100

/**
 * 好感度衰减：**每 24 小时 -1**，锚点法按真实时间推进（软件开没开都算，
 * 与饱食度的在线/离线双速率**不同**：好感是慢变量，"挂机"与"离线"对它
 * 没有语义差别）。下限 0；时钟回拨重锚（见 decayAffection）。
 */
export const PET_AFFECTION_DECAY_PERIOD_MS = 24 * 60 * 60_000

/**
 * 事件计分表（P3 ④ 拍板的**完整计分集**）。delta = 每次事件的增减；
 * cap = 当天最多计几次（第 cap+1 次起静默 no-op，见 addAffection）。
 *
 * 【为什么正负都在这一张表、表外没有第五条路】奖励与惩罚只认表里这些
 * 来源。awardRun（跑通代码）与 chatCommit（聊天）**故意不在表里**：
 * 跑通代码的激励已由大白饭承担（再发一份好感会让"多跑几个版本"变成刷分），
 * 聊天是陪聊不是学习行为。守卫 = 单测对着这张表逐 kind 钉 delta/cap，
 * 表外任何地方改 affection 都要先过这里。
 */
export const PET_AFFECTION_RULES: Record<
  PetAffectionKind,
  { delta: number; cap: number }
> = {
  feed: { delta: 2, cap: 3 },
  pat: { delta: 1, cap: 5 },
  study: { delta: 2, cap: 6 },
  challenge: { delta: 3, cap: 1 },
  review: { delta: 5, cap: 1 },
  checkin: { delta: 1, cap: 1 },
  wrong: { delta: -1, cap: 3 },
  starving: { delta: -2, cap: 1 },
  'long-away': { delta: -5, cap: 1 }
}

/**
 * 每日签到固定发 **2 碗**（P3 ① 拍板 2026-10-08）：**连签不递增** ——
 * 递增会让「断签」的惩罚变成复利，"漏一天"的代价随连续天数放大，
 * 那是把人按在焦虑里的设计；固定值下签到就是一件每天顺手的小事。
 * 声明在 PET_REWARD_RICE 之前（表里引用它，const 有 TDZ，摆后面会炸）。
 */
export const PET_CHECKIN_RICE = 2

/** 学习动作 → 白饭碗数 */
export const PET_REWARD_RICE: Record<PetRewardKind, number> = {
  lesson: 2,
  review: 2,
  answer: 1,
  checkin: PET_CHECKIN_RICE
}

/**
 * 学习奖的**日上限**（V1-42，2026-10-15 夜）：每条收入口每天最多**入账几次**
 * （单位是"次"不是"碗" —— 一次 = 一笔名义上会全进的账，见 grantPetRice）。
 *
 * 【为什么要它】改一点代码跑一次、连刷题、反复进出课文……这些动作都由渲染层
 * 上报，上报即可得饭。没有上限的话，一段循环脚本或者一个手滑的重复上报就能
 * 把饭盒轰到 999，"大白饭=学习换来的"这层含义当场失效。它也是"默认回退为成功"
 * 的反面：赚满了就是明说赚满了（brain 报 RICE_CAP 台词），不是装作没发生。
 *
 * 【数字怎么定】按"正常重度使用再翻几倍"的量级，`名义碗数` 标注在括号里：
 *   · answer 40 次（40 碗）—— 一口气刷 20 道题的长练习 ×2，正常绝够不着；
 *   · lesson 10 次（20 碗）—— 一天连学 10 课已经是猛人；
 *   · review 4 次（8 碗）—— 复习全对才发，一天复习 4 轮是上限级的使用；
 *   · checkin 1 次（2 碗）—— 结构上每天本来就只有一次（签到接口自己拦），
 *     这里是不依赖上游自觉的双保险。
 * run（跑通代码 +1）**不在这张表**：它有自己的指纹去重账与日上限
 * （PET_RUN_REWARD_DAILY_MAX，同 PET_REWARD_RICE 不含 run 的理由）。
 *
 * 【为什么记账只算"真进盒"的次数】满仓 999 时一次奖励一粒没进 —— 那次不该
 * 占用当天额度（不然"满了 → 喂了 → 想再赚"会发现额度被空气吃掉了）。
 * 判据在 grantPetRice 里：credited > 0 才计数。
 */
export const PET_RICE_DAILY_CAPS: Record<PetRewardKind, number> = {
  answer: 40,
  lesson: 10,
  review: 4,
  checkin: 1
}

/**
 * 跑通"他自己写的代码" → 1 碗。**故意不进 PET_REWARD_RICE 表**：那个表是
 * pet:act 的 grant 通道直发，而运行奖必须先过指纹去重与日上限 —— 挂进表里
 * 等于留了一条绕过账本的旁路（渲染层一句 grant('run') 就能刷饭）。
 */
export const PET_RUN_REWARD_RICE = 1
/** 运行奖日上限：指纹去重的第二道闸，防"一口气跑 30 个版本"刷饭 */
export const PET_RUN_REWARD_DAILY_MAX = 10
/** 指纹账容量：只留最近这些条。丢的是"最久以前跑过的代码"，与日上限叠加足够 */
export const PET_RUN_LEDGER_MAX = 80

/** 干活消耗：跑去报错现场一次 -1（代码错得多 → 跑得多 → 饿得快 → 更想学） */
export const PET_CHASE_COST = 1
/**
 * 跑腿冷却：30 秒内不重复出动。防「输出区报错连环喷」时宠物在两处之间
 * 疯跑（每次失败上报都会带 rect，不拦就是每跑必动）。冷却内**照常说台词**，
 * 只是不出动 —— 台词是廉价的，窗口位移不是。
 */
export const PET_CHASE_COOLDOWN_MS = 30_000
/** 干活消耗：聊一次天（思考）固定 -2。饿到 0 时聊天闸直接拒（零 API 就拦下） */
export const PET_CHAT_COST = 2

/** 聊天消息排队上限（送进模型的历史长度）与单条长度上限 */
export const PET_CHAT_MAX_MESSAGES = 12
export const PET_CHAT_MAX_CHARS = 300

/**
 * 聊天护栏（2026-10-06，「全天高强度聊天每天几毛钱以内」的三道闸）。
 *
 * 【为什么护栏住主进程而不是渲染层】能不能聊、今天还剩几次，是**状态**
 * （落 pet.json）—— 渲染层每次开面板都可能是新的一个进程生命，算不准。
 *
 * 【三道闸各管什么】
 *   · 10 秒一次：防手抖连按、防"抓住一个bug疯狂重试"——两次提问之间
 *     模型还没回答完，第二问的上下文里啥都没有；
 *   · 每天 120 次：正常陪聊根本用不到（一次来回算一次）；连续高强度
 *     玩一天也就几百次，120 次 ×（几百 input + 200 output token）远在
 *     "几毛钱"以内，撞到上限说明这不是陪伴是压力测试；
 *   · 每天 6 万 token（估算）：次数没超但每次都带很长历史的兜底 ——
 *     估算口径见 approxPetTokens，不求跟账单一样（它是护栏不是账本），
 *     只求"贵到十倍的那种用法"会被拦下。
 */
export const PET_CHAT_MIN_INTERVAL_MS = 10_000
export const PET_CHAT_DAILY_MAX = 120
export const PET_CHAT_DAILY_TOKENS = 60_000
/** 一次聊天的固定开销估计（system 人设 + 回复上限 MAX_TOKENS_PET 的量级） */
export const PET_CHAT_REPLY_TOKENS = 320

/** 记忆环容量。12 条 ≈ 最近几天的学习大事，再多就变成流水账 */
export const PET_MEMORY_MAX = 12
/** 「一口气学完好几课」的判据：窗口内≥3 课 → 开心到转圈 */
export const PET_MEMORY_STREAK = 3
export const PET_MEMORY_STREAK_WINDOW_MS = 2 * 60 * 60_000

/** 连点 rua 的判据（宠物窗本地数，shared 里放一份给静态闸门对账） */
export const PET_RUA_CLICKS = 5
export const PET_RUA_WINDOW_MS = 3_000

/**
 * 各类主动搭话的冷却。频率全部按"烦人程度"定：被 rua 完马上回嘴（4 秒内
 * 只说一次）、答错题 30 秒内只提一次（连错五道不用念五遍）、表扬 90 秒
 * 一次（跑通是高频动作）、长时间不动 10 分钟后才开口、开口一次管 20 分钟。
 */
export const PET_RUA_COOLDOWN_MS = 4_000
export const PET_WRONG_COOLDOWN_MS = 30_000
export const PET_PRAISE_COOLDOWN_MS = 90_000
export const PET_PROACTIVE_IDLE_MS = 10 * 60_000
export const PET_PROACTIVE_COOLDOWN_MS = 20 * 60_000

/**
 * 「饭盒满仓」提醒的冷却（V1-42 / 空转[1]）。满仓期间每次发奖名义上都该
 * 报一句"装不下"——一口气连学几课就会变成复读机。定 60 秒：同一口气里
 * 只提醒一次；隔了一分钟再领奖，值得再说一遍（用户可能刚喂过饭，只是
 * 又刷满了）。同族的 30s/90s 见上一段的按烦人程度分档。
 */
export const PET_RICE_FULL_COOLDOWN_MS = 60_000

/** 多日不登录的判据（≥2 天没见面 → 出场说"饿扁了"那一档） */
export const PET_LONG_AWAY_MS = 48 * 60 * 60_000

/**
 * 瞬时情绪的时效：傲娇短（被戳完 1 分钟气就消了），兴奋稍长（学爆的
 * 好心情撑 90 秒）。过期不需要定时器 —— petFace 每次现算。
 */
export const PET_EMOTION_TTL_MS: Record<PetEmotion, number> = {
  tsundere: 60_000,
  excited: 90_000
}

/** 喂饭/摸头这类互动的冷却（毫秒）：防止按住连点刷饱食度 */
export const PET_INTERACT_COOLDOWN_MS = 1200

// ---------------------------------------------------------------- 小工具

function finiteOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function msOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function clampInt(v: number, min: number, max: number): number {
  const n = Math.round(v)
  return n < min ? min : n > max ? max : n
}

function clampRatio(v: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function isoOr(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback
  return Number.isFinite(Date.parse(v)) ? v : fallback
}

function isoOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') return null
  return Number.isFinite(Date.parse(v)) ? v : null
}

/**
 * 自然日键（YYYY-MM-DD，**北京时间 UTC+8**）。
 * 【为什么按自然日而不是 UTC 日】限额是给活人用的：晚上 11 点聊到凌晨 1 点
 * 是"两天"还是"一天"该按他的作息算 —— UTC 会把中国用户的"换日点"卡在
 * 早上八点，谁都觉得错。
 *
 * 【为什么委托 localDateKey】全项目只能有一套「今天是哪天」。这里原来自己
 * 用 getFullYear/getMonth/getDate 抄了一份本机时区实现，和 dates.ts 是两条
 * 真源；2026-10-22 统一北京时间时直接委托过去，不再留第二份格式化代码。
 *
 * 【为什么导出】主进程拼"上次聊天是几天前"的回忆（copy.ts 那几句）要按
 * 同一个日界算 —— 各写一份"今天"是这类功能最典型的漂移源。
 */
export function petDayKey(nowIso: string): string {
  const t = Date.parse(nowIso)
  if (!Number.isFinite(t)) return '1970-01-01'
  return localDateKey(new Date(t))
}
/** 内部短名（对外叫 petDayKey，理由见上） */
const dayKey = petDayKey

export function isPetMode(v: unknown): v is PetMode {
  return v === 'wander' || v === 'follow' || v === 'still'
}

export function isPetRewardKind(v: unknown): v is PetRewardKind {
  return v === 'lesson' || v === 'review' || v === 'answer' || v === 'checkin'
}

export function isPetEmotion(v: unknown): v is PetEmotion {
  return v === 'tsundere' || v === 'excited'
}

export function isPetSize(v: unknown): v is PetSize {
  return v === 187 || v === 238 || v === 306
}

// ---------------------------------------------------------------- 状态：构造与清洗

/**
 * 默认状态。初始饱食度给 80（不是 100）：第一次启动就该看见"它有点需要你"，
 * 100 开局会让头几个小时的喂饭互动完全没有观感变化。
 *
 * 默认位置在**右下角偏高一点**（0.82, 0.72）：那儿默认离侧边栏、代码区都远，
 * 不挡字；而报错联动会把它叫到编辑器旁边，两者不冲突。
 */
export function defaultPetState(nowIso: string): PetState {
  const t = Date.parse(nowIso)
  const nowMs = Number.isFinite(t) ? t : Date.now()
  return {
    version: PET_VERSION,
    enabled: true,
    satiety: 80,
    rice: 0,
    fedTotal: 0,
    earnedTotal: 0,
    lastDecayAt: nowIso,
    mode: 'wander',
    x: 0.82,
    y: 0.72,
    memory: defaultPetMemory(nowIso),
    emotion: null,
    emotionUntil: nowIso,
    size: PET_SIZE_DEFAULT,
    runLedger: defaultPetRunLedger(nowIso),
    affection: PET_AFFECTION_INITIAL,
    lastAffectionAt: nowMs,
    affectionDay: defaultPetAffectionDay(nowIso),
    riceDay: defaultPetRiceDay(nowIso)
  }
}

/** 空白记忆：刚认识。lastSeenAt 锚到当下（否则第一次启动就触发"多日不见"） */
export function defaultPetMemory(nowIso: string): PetMemory {
  return {
    events: [],
    lastSeenAt: nowIso,
    lastChatAt: null,
    chatDay: dayKey(nowIso),
    chatCallsToday: 0,
    chatTokensToday: 0
  }
}

/**
 * 清洗记忆。**坏条目丢弃、好条目留下**（不是整体作废）：记忆环是加法日志，
 * 一条时间戳烂掉没有理由把其他十一条也扔了。但白名单照旧 —— 没见过的
 * kind、编不出的时刻一律进不来（回声筒测试在老字段上守过，这里同理）。
 */
export function normalizePetMemory(raw: unknown, nowIso: string): PetMemory {
  const d = defaultPetMemory(nowIso)
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Record<string, unknown>
  const events: PetMemoryEvent[] = []
  if (Array.isArray(r.events)) {
    for (const item of r.events) {
      if (!item || typeof item !== 'object') continue
      const e = item as Record<string, unknown>
      if (e.kind !== 'wrong' && e.kind !== 'lesson' && e.kind !== 'run-ok') continue
      if (typeof e.at !== 'string' || !Number.isFinite(Date.parse(e.at))) continue
      const label =
        typeof e.label === 'string' && e.label.trim() !== '' ? e.label.slice(0, 60) : null
      events.push({ kind: e.kind, at: e.at, label })
    }
  }
  return {
    events: events.slice(-PET_MEMORY_MAX),
    lastSeenAt: isoOr(r.lastSeenAt, d.lastSeenAt),
    lastChatAt: isoOrNull(r.lastChatAt),
    chatDay: typeof r.chatDay === 'string' ? r.chatDay : d.chatDay,
    chatCallsToday: clampInt(finiteOr(r.chatCallsToday, 0), 0, 100_000),
    chatTokensToday: clampInt(finiteOr(r.chatTokensToday, 0), 0, 100_000_000)
  }
}

/** 空白运行账：当天起算、没发过、没指纹 */
export function defaultPetRunLedger(nowIso: string): PetRunLedger {
  return { day: dayKey(nowIso), count: 0, hashes: [] }
}

/** 空白好感账：当天起算、什么都没计过 */
export function defaultPetAffectionDay(nowIso: string): PetAffectionDay {
  return { day: dayKey(nowIso), counts: {} }
}

/**
 * 清洗好感当日账。**条目级过滤**（同 normalizePetRunLedger 的口径）：
 * 白名单外的 kind 键丢掉、次数钳到合理范围，合法的留下 —— counts 是防刷闸
 * 的数据源，放进没见过的键只会让 addAffection 的 `counts[kind] ?? 0` 多一次
 * 无意义匹配；但也不该因为一条垃圾条目把"今天喂过 2 次"整账清掉。
 */
export function normalizePetAffectionDay(raw: unknown, nowIso: string): PetAffectionDay {
  const d = defaultPetAffectionDay(nowIso)
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Record<string, unknown>
  const day = typeof r.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.day) ? r.day : d.day
  const counts: Record<string, number> = {}
  if (r.counts && typeof r.counts === 'object') {
    for (const [k, v] of Object.entries(r.counts as Record<string, unknown>)) {
      if (!(k in PET_AFFECTION_RULES)) continue
      const n = clampInt(finiteOr(v, 0), 0, 100_000)
      if (n > 0) counts[k] = n
    }
  }
  return { day, counts }
}

/** 空白大白饭收入账：当天起算、什么都没入过 */
export function defaultPetRiceDay(nowIso: string): PetRiceDay {
  return { day: dayKey(nowIso), counts: {} }
}

/**
 * 清洗大白饭当日账。与 normalizePetAffectionDay 同口径（条目级过滤）：
 * 白名单 = isPetRewardKind（学习奖四类），次数钳到合理范围，合法条目留下 ——
 * counts 是日上限闸的数据源，不认识的键只会让 grantPetRice 多一次无意义匹配；
 * 但一条垃圾条目不该把"今天学完过 3 课"整账清掉。
 */
export function normalizePetRiceDay(raw: unknown, nowIso: string): PetRiceDay {
  const d = defaultPetRiceDay(nowIso)
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Record<string, unknown>
  const day = typeof r.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.day) ? r.day : d.day
  const counts: Record<string, number> = {}
  if (r.counts && typeof r.counts === 'object') {
    for (const [k, v] of Object.entries(r.counts as Record<string, unknown>)) {
      if (!isPetRewardKind(k)) continue
      const n = clampInt(finiteOr(v, 0), 0, 100_000)
      if (n > 0) counts[k] = n
    }
  }
  return { day, counts }
}

/** 指纹的合法形状（shared/code-hash 的产出）：`长度(36进制):FNV(十六进制)`。导出供云端协议等价单测对拍 */
export const RUN_FP_RE = /^[0-9a-z]{1,10}:[0-9a-f]{1,8}$/

/**
 * 清洗运行账。**条目级过滤**（同 normalizePetMemory 的口径）：不认识的指纹
 * 丢掉、合法的留下 —— 指纹是去重键，留着一条永远匹配不上的垃圾只会白占
 * 容量，但混进来一条"形状对但其实是垃圾"的也没法定性，所以只验形状。
 */
export function normalizePetRunLedger(raw: unknown, nowIso: string): PetRunLedger {
  const d = defaultPetRunLedger(nowIso)
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Record<string, unknown>
  const hashes: string[] = []
  if (Array.isArray(r.hashes)) {
    for (const h of r.hashes) {
      if (typeof h === 'string' && RUN_FP_RE.test(h)) hashes.push(h)
    }
  }
  return {
    day: typeof r.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.day) ? r.day : d.day,
    count: clampInt(finiteOr(r.count, 0), 0, 100_000),
    hashes: hashes.slice(-PET_RUN_LEDGER_MAX)
  }
}

/**
 * 把磁盘上的任意 JSON 洗成一份可信的 PetState。**永远返回新整树**
 * （逐字段重造，不共享引用 —— 调用方拿到的对象随便改都不会脏到别的读者）。
 *
 * 【缺字段 = 用默认值，坏字段 = 也回默认值】不抛异常：一个手改坏的文件
 * 不该让桌宠整个起不来（同 normalizeWallpaper 的口径）。但**不是回声筒**：
 * 白名单外的 mode、NaN、越界的饱食度，一律落回合法值，绝不原样带出去。
 */
export function normalizePetState(raw: unknown, nowIso: string): PetState {
  const d = defaultPetState(nowIso)
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Record<string, unknown>
  return {
    version: PET_VERSION,
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    satiety: clampInt(finiteOr(r.satiety, d.satiety), 0, PET_SATIETY_MAX),
    rice: clampInt(finiteOr(r.rice, d.rice), 0, PET_RICE_MAX),
    fedTotal: clampInt(finiteOr(r.fedTotal, 0), 0, Number.MAX_SAFE_INTEGER),
    earnedTotal: clampInt(finiteOr(r.earnedTotal, 0), 0, Number.MAX_SAFE_INTEGER),
    lastDecayAt: isoOr(r.lastDecayAt, nowIso),
    mode: isPetMode(r.mode) ? r.mode : d.mode,
    x: clampRatio(finiteOr(r.x, d.x), d.x),
    y: clampRatio(finiteOr(r.y, d.y), d.y),
    // v1 → v2 的迁移就发生在这（老文件没有 memory → 一份空白记忆开始记）
    memory: normalizePetMemory(r.memory, nowIso),
    emotion: isPetEmotion(r.emotion) ? r.emotion : null,
    emotionUntil: isoOr(r.emotionUntil, nowIso),
    // v2 → v3 的迁移也在这（老文件没有 size → 默认最小档）
    size: isPetSize(r.size) ? r.size : d.size,
    // v3 → v4 的迁移同理：老文件没有 runLedger → 一本空白账（当天起算）
    runLedger: normalizePetRunLedger(r.runLedger, nowIso),
    // v4 → v5 的迁移也在这：老文件没有 affection 三件套 → 50 分起步、锚到当下、空账
    affection: clampInt(finiteOr(r.affection, d.affection), 0, PET_AFFECTION_MAX),
    lastAffectionAt: msOr(r.lastAffectionAt, d.lastAffectionAt),
    affectionDay: normalizePetAffectionDay(r.affectionDay, nowIso),
    // v5 → v6 同款：老文件没有 riceDay → 一本空大白饭账（当天起算）
    riceDay: normalizePetRiceDay(r.riceDay, nowIso)
  }
}

// ---------------------------------------------------------------- 状态：派生与变化

export function petMood(satiety: number): PetMood {
  if (satiety >= PET_MOOD_HAPPY_AT) return 'happy'
  return satiety >= PET_MOOD_OK_AT ? 'ok' : 'hungry'
}

/**
 * 饥饿五档（P3 ③）。从高到低判第一个满足的档 —— 闭下界是刻意的：
 * 79 与 80 必须分得开（跃迁台词与进度条颜色都以此划线），
 * 单测逐个边界点钉死。NaN/负数一律落 'empty'（判定不出"饱"就当饿，
 * 归零静默的方向永远比错说一句安全 —— 台词是支出，沉默不是）。
 */
export function petHungerTier(satiety: number): PetHungerTier {
  if (satiety >= PET_HUNGER_FULL_AT) return 'full'
  if (satiety >= PET_HUNGER_MILD_AT) return 'mild'
  if (satiety >= PET_HUNGER_MEDIUM_AT) return 'medium'
  if (satiety >= PET_HUNGER_SEVERE_AT) return 'severe'
  return 'empty'
}

/**
 * 好感度五档（P3 ④）。从高到低判第一个满足的档（闭下界，同 petHungerTier）。
 * NaN/负数一律落 'cold'（判定不出"亲"就当不亲）—— 与饥饿那边"判不出就当
 * 饿"同向：结果偏保守，绝不会把冷淡关系读成亲密。
 */
export function petAffectionTier(affection: number): PetAffectionTier {
  if (affection >= PET_AFFECTION_LOVE_AT) return 'love'
  if (affection >= PET_AFFECTION_LIKE_AT) return 'like'
  if (affection >= PET_AFFECTION_CLOSE_AT) return 'close'
  if (affection >= PET_AFFECTION_FAMILIAR_AT) return 'familiar'
  return 'cold'
}

/**
 * 「脸色」= 饱食度 + 瞬时情绪 + 时段。优先级：**饿 > 情绪 > 困 > 心情** ——
 * 1) 夜里饿着的时候该说的是"求喂饭"（可行动），不是"本鱼困了"（不可行动）；
 * 2) 情绪是**刚发生的事**（被 rua 烦到、学爆兴奋），一小时内的事压过
 *    "现在几点"这种环境状态 —— 凌晨连点五下，该看见的是傲娇不是打盹；
 * 3) 时段取**北京时间** 23:00–05:59（深夜里还陪你写代码的鱼，当然在打哈欠）。
 *    全项目时刻口径统一为北京时间后，这里也不能再用 `getHours()`（那会跟着
 *    运行机器走：同一台笔记本换个时区，同一份存档的鱼就换了作息）。
 * 情绪过期就在这**现算**（emotionUntil 比 now 早 = 已回落），不设定时器。
 */
export function petFace(state: PetState, nowIso: string): PetFace {
  const mood = petMood(state.satiety)
  if (mood === 'hungry') return 'hungry'
  const t = Date.parse(nowIso)
  if (
    state.emotion !== null &&
    Number.isFinite(t) &&
    Date.parse(state.emotionUntil) > t
  ) {
    return state.emotion
  }
  if (Number.isFinite(t)) {
    const h = beijingParts(new Date(t)).h
    if (h >= 23 || h < 6) return 'sleepy'
  }
  return mood
}

/**
 * 触发一个瞬时情绪（覆盖旧的）：rua 完 → 傲娇；学爆转圈 → 兴奋。
 * 返回新状态，调用方负责 commit（同 pushPetMemory 的分工）。
 */
export function setPetEmotion(state: PetState, emotion: PetEmotion, nowIso: string): PetState {
  const t = Date.parse(nowIso)
  const base = Number.isFinite(t) ? t : Date.now()
  return {
    ...state,
    emotion,
    emotionUntil: new Date(base + PET_EMOTION_TTL_MS[emotion]).toISOString()
  }
}

export function snapshotOf(state: PetState, nowIso: string): PetSnapshot {
  return {
    enabled: state.enabled,
    satiety: state.satiety,
    rice: state.rice,
    mood: petMood(state.satiety),
    face: petFace(state, nowIso),
    mode: state.mode,
    size: state.size,
    x: state.x,
    y: state.y,
    runRewardsToday: state.runLedger.day === dayKey(nowIso) ? state.runLedger.count : 0,
    affection: state.affection
  }
}

/**
 * 按时间衰减饱食度。
 *
 * 【锚点为什么按整周期推进，而不是直接跳到 now】
 * `lastDecayAt += 周期数 × 周期` —— 不满一个周期的零头**原地留着**。
 * 若直接写 now，每 30 秒的心跳都会把 29 秒零头抹掉：标称「2 分钟 -1」实际
 * 会被拖成「2 分钟 + 一次心跳 -1」，衰减速度随心跳频率漂移，而心跳频率是
 * 实现细节 —— 这种漂移在界面上完全看不出来，只有算总账时才会发现对不上。
 *
 * 【时钟回拨】lastDecayAt 在"未来"（用户改过系统时间/夏令时）时不动它：
 * 直接重锚到 now，不加不减。否则会出现"负数个周期"，算术上无害（floor 后
 * ≤0 会提前返回），但锚点留在未来会让之后每一次衰减都延迟 —— 重锚一次干净。
 *
 * 【floor（V2-21）】只有离线补算（brain 启动装载）传 PET_OFFLINE_DECAY_FLOOR。
 * 语义是"不许比它更低"：跌破时停在 floor（dropped 报**实际**掉了多少）；
 * 本来就低于 floor 的（比如在 0 档关的软件）原地不动 —— min(satiety, floor)
 * 防的是"下限把饿扁的鱼凭空拉回 20"。锚点在两种情况下都照常按整周期推进
 * （时间确实过去了，下个窗口不重复计）；默认 0 = 旧行为，在线心跳走默认。
 */
export function decayPet(
  state: PetState,
  nowIso: string,
  periodMs: number,
  floor = 0
): { state: PetState; dropped: number } {
  const now = Date.parse(nowIso)
  const last = Date.parse(state.lastDecayAt)
  if (!Number.isFinite(now) || periodMs <= 0) return { state, dropped: 0 }
  if (!Number.isFinite(last) || last > now) {
    return { state: { ...state, lastDecayAt: nowIso }, dropped: 0 }
  }
  const periods = Math.floor((now - last) / periodMs)
  if (periods <= 0) return { state, dropped: 0 }
  const target = Math.max(state.satiety - periods, Math.min(state.satiety, floor))
  const dropped = state.satiety - target
  return {
    state: {
      ...state,
      satiety: target,
      lastDecayAt: new Date(last + periods * periodMs).toISOString()
    },
    dropped
  }
}

/**
 * 好感度的按时间衰减：**每满 24 小时 -1**，锚点按整周期推进（照抄 decayPet
 * 的锚点法，理由见那里）；下限 0。时钟回拨（锚点在未来）→ 原地重锚到 now，
 * 不加不减 —— 否则锚点冻在未来会让之后每一次衰减都被推迟。
 * 【为什么锚点用毫秒数】周期长达一天，毫秒时间戳比 ISO 串少一次 Date.parse，
 * 也不存在"按谁的时区渲染"的问题（它只被做减法）。
 */
export function decayAffection(
  state: PetState,
  nowIso: string
): { state: PetState; dropped: number } {
  const now = Date.parse(nowIso)
  const last = state.lastAffectionAt
  if (!Number.isFinite(now)) return { state, dropped: 0 }
  if (!Number.isFinite(last) || last > now) {
    return { state: { ...state, lastAffectionAt: now }, dropped: 0 }
  }
  const periods = Math.floor((now - last) / PET_AFFECTION_DECAY_PERIOD_MS)
  if (periods <= 0) return { state, dropped: 0 }
  const dropped = Math.min(state.affection, periods)
  return {
    state: {
      ...state,
      affection: state.affection - dropped,
      lastAffectionAt: last + periods * PET_AFFECTION_DECAY_PERIOD_MS
    },
    dropped
  }
}

/**
 * 记一次好感事件（**唯一**的增减入口）。
 *
 * 【三道闸的顺序】① 跨日重置（affectionDay.day 不是今天 → 空账重计）；
 * ② 日上限（该类今天已计满 cap 次 → **原样返回** applied:false：不落盘、
 *    不播报；同一引用，调用方可用 `next === prev` 判 no-op）；
 * ③ 落 delta、钳 0..100。
 * 【计数与钳制的先后】过闸②之后计数就 +1（哪怕钳制让 delta 为 0）：
 * 计数记的是**事件发生了几次**，不是"值动了几点"。否则 100 分时喂饭不
 * 计数，今天掉回 99 再喂就能多刷一次 +2。
 * 【不重置衰减锚点】事件不碰 lastAffectionAt（契约点名）：锚点只归
 * decayAffection 动，否则天天来喂饭的人好感永远不衰减。
 */
export function addAffection(
  state: PetState,
  kind: PetAffectionKind,
  nowIso: string
): { state: PetState; delta: number; applied: boolean } {
  const rule = PET_AFFECTION_RULES[kind]
  const today = dayKey(nowIso)
  const day =
    state.affectionDay.day === today ? state.affectionDay : { day: today, counts: {} }
  const used = day.counts[kind] ?? 0
  if (used >= rule.cap) return { state, delta: 0, applied: false }
  const before = state.affection
  const next = clampInt(before + rule.delta, 0, PET_AFFECTION_MAX)
  return {
    state: {
      ...state,
      affection: next,
      affectionDay: { day: today, counts: { ...day.counts, [kind]: used + 1 } }
    },
    delta: next - before,
    applied: true
  }
}

/**
 * 喂一碗大白饭。两种喂不进：饭盒空（reason 'empty'）、已经吃饱（'full'）。
 * 都是 **ok:false 且原样返回** —— 调用方据 reason 出不同的台词。
 *
 * 【为什么满了要拒喂】饱腹闭环的"满"是一个状态，不是数字封顶就完事：
 * 允许满碗继续喂，饭就被"存进"上限里白白蒸发（rice 扣了、satiety 没涨），
 * 玩家看到的是"我喂了，它没反应"。拒喂 + 一句"撑着呢"才是诚实反馈，
 * 也把大白饭的稀缺性还给学习（等饿了再喂 = 奖励有节奏）。
 */
export function feedPet(state: PetState): {
  state: PetState
  ok: boolean
  reason: 'ok' | 'empty' | 'full'
} {
  if (state.rice <= 0) return { state, ok: false, reason: 'empty' }
  if (state.satiety >= PET_SATIETY_MAX) return { state, ok: false, reason: 'full' }
  return {
    state: {
      ...state,
      rice: state.rice - 1,
      satiety: Math.min(PET_SATIETY_MAX, state.satiety + PET_FEED_GAIN),
      fedTotal: state.fedTotal + 1
    },
    ok: true,
    reason: 'ok'
  }
}

/**
 * 学习动作发奖：饭盒 +n，同时也记进 earnedTotal。
 *
 * 【gained 与 credited 是两个数（V1-42 / 空转[1]）】`gained` = 这次奖励的
 * **名义**碗数（按种类查表；earnedTotal 也按它记 —— 那是终生功劳簿，不因
 * 饭盒装不下而打折）；`credited` = **真的进盒**的碗数（满仓 999 时是 0，
 * 半仓时可能少于名义值）。现场（气泡/播报）必须用 credited 说话：拿着名义值
 * 报"收到 2 碗"而实际一粒没进，就是假报成功。调用方要分清"满了"
 * （credited=0 且名义值 >0）和"压根没执行"（没调到这儿），所以两个都回。
 *
 * 【日上限（V1-42，v6 加）】每类学习奖每天最多入账 PET_RICE_DAILY_CAPS[kind]
 * 次（**按笔数**，一次一笔全进，所以没有半笔）。到顶的这笔：
 *   · 不扣不加（rice / earnedTotal 都不动 —— 这笔记的是"功劳"，被闸拦下的
 *     没有功劳可记；与满仓不同：满仓是"赚到了但装不下"，功劳照记）；
 *   · 返回 capped: true —— 调用方必须**明说**，不许静默（RICE_CAP 台词）。
 * 【为什么满仓那几次不占额度】满仓一粒没进（credited=0）→ 不计数：否则
 * "满了 → 喂了 → 想再赚"会发现当天的额度被空气吃掉了。计数只算 credited>0。
 *
 * 【与 rice 账本的关系】brain 拿本函数的 next.rice 之后，还会经 withRiceMirror
 * 把 rice 换成大白饭账本的余额（那是唯一事实）。账本按 kind 独立加账 ——
 * 所以 **capped 的那一笔必须由调用方拦住、不许送进账本**（brain 见 doGrant），
 * 否则账本会把这碗加回来，上限形同虚设。
 */
export function grantPetRice(
  state: PetState,
  kind: PetRewardKind,
  nowIso: string
): { state: PetState; gained: number; credited: number; capped: boolean } {
  const gained = PET_REWARD_RICE[kind]
  const day = dayKey(nowIso)
  // 昨日的账不带进今天：day 对不上就从空账起算（同 addAffection 的跨日口径）
  const counts = state.riceDay.day === day ? state.riceDay.counts : {}
  const used = clampInt(finiteOr(counts[kind], 0), 0, 100_000)
  const cap = PET_RICE_DAILY_CAPS[kind]
  if (used >= cap) return { state, gained, credited: 0, capped: true }
  const credited = Math.min(PET_RICE_MAX, state.rice + gained) - state.rice
  if (credited <= 0) {
    // 满仓：功劳照记（gained），当日账不动（这次没真进盒，不占额度）
    return {
      state: { ...state, earnedTotal: state.earnedTotal + gained },
      gained,
      credited: 0,
      capped: false
    }
  }
  return {
    state: {
      ...state,
      rice: state.rice + credited,
      earnedTotal: state.earnedTotal + gained,
      riceDay: { day, counts: { ...counts, [kind]: used + 1 } }
    },
    gained,
    credited,
    capped: false
  }
}

/**
 * 跑通"他自己写的代码"发一碗（指纹去重 + 日上限的**唯一**实现）。
 *
 * 【判定为真需要证据】fingerprint 必须是合法指纹（渲染层比对示例后、
 * 原生观察器对源文件算好带来）。空串、怪形状 → granted:false 原样返回 ——
 * 这是"默认回退为成功"的反面：没有可信指纹就不发奖，而不是"没指纹就当他写了"。
 *
 * 【为什么 hashes 跨天不归零、count 归零】count 是"今天还能赚几碗"的防刷闸；
 * hashes 是"这段代码领过没有"的记忆 —— 昨天领过的同一份作业，今天再跑也不该
 * 再领第二碗。两者叠加（今天 ≤10 碗 ∩ 这段代码从没领过）才放行。
 */
export function grantRunReward(
  state: PetState,
  fingerprint: string,
  nowIso: string
): { state: PetState; granted: boolean } {
  if (typeof fingerprint !== 'string' || !RUN_FP_RE.test(fingerprint)) {
    return { state, granted: false }
  }
  const today = dayKey(nowIso)
  const count = state.runLedger.day === today ? state.runLedger.count : 0
  if (count >= PET_RUN_REWARD_DAILY_MAX) return { state, granted: false }
  if (state.runLedger.hashes.includes(fingerprint)) return { state, granted: false }
  return {
    state: {
      ...state,
      rice: Math.min(PET_RICE_MAX, state.rice + PET_RUN_REWARD_RICE),
      earnedTotal: state.earnedTotal + PET_RUN_REWARD_RICE,
      runLedger: {
        day: today,
        count: count + 1,
        hashes: [...state.runLedger.hashes, fingerprint].slice(-PET_RUN_LEDGER_MAX)
      }
    },
    granted: true
  }
}

/**
 * 干活消耗：思考（聊天）、跑腿这类明确的体力活扣饱食度。**夹在 0 以上** ——
 * "饿扁"是一种状态，不是一个会掉进负数的计数器（负数会让所有 >=0 的比较
 * 悄悄错位）。cost 非正或已饿扁时**原样返回**（零变化不动引用，方便调用方
 * 用 `next !== prev` 判"要不要落盘"）。
 */
export function exertPet(state: PetState, cost: number): PetState {
  const c = Math.max(0, Math.round(cost))
  if (c === 0 || state.satiety <= 0) return state
  return { ...state, satiety: Math.max(0, state.satiety - c) }
}

export function setPetMode(state: PetState, mode: PetMode): PetState {
  return { ...state, mode }
}

/** 换体型（设置卡的三个按钮）。广播后宠物窗自己换素材、重报命中区 */
export function setPetSize(state: PetState, size: PetSize): PetState {
  return { ...state, size }
}

export function setPetPos(state: PetState, x: number, y: number): PetState {
  return { ...state, x: clampRatio(x, state.x), y: clampRatio(y, state.y) }
}

export function withPetEnabled(state: PetState, enabled: boolean): PetState {
  return { ...state, enabled }
}

// ---------------------------------------------------------------- 记忆与聊天护栏

/** 往记忆环里记一笔（超容量从**最老的**丢）。返回新状态，调用方负责落盘 */
export function pushPetMemory(
  state: PetState,
  kind: PetMemoryKind,
  label: string | null,
  nowIso: string
): PetState {
  const events = [...state.memory.events, { kind, at: nowIso, label }].slice(-PET_MEMORY_MAX)
  return { ...state, memory: { ...state.memory, events } }
}

/** 最近一条**带课名**的错题（"上次那道《X》的题……"用）。没有就是 null */
export function lastWrongLabel(state: PetState): string | null {
  for (let i = state.memory.events.length - 1; i >= 0; i--) {
    const e = state.memory.events[i]
    if (e.kind === 'wrong' && e.label !== null) return e.label
  }
  return null
}

/** 时间窗内学完的课数（"一口气学了几课"的判据） */
export function lessonStreak(state: PetState, nowIso: string): number {
  const now = Date.parse(nowIso)
  if (!Number.isFinite(now)) return 0
  let n = 0
  for (const e of state.memory.events) {
    if (e.kind !== 'lesson') continue
    const t = Date.parse(e.at)
    if (Number.isFinite(t) && now - t >= 0 && now - t <= PET_MEMORY_STREAK_WINDOW_MS) n += 1
  }
  return n
}

/** 更新"最后一次见面"（每次桌宠接上时调）。返回新状态 */
export function touchPetSeen(state: PetState, nowIso: string): PetState {
  return { ...state, memory: { ...state.memory, lastSeenAt: nowIso } }
}

/** 距上次见面的时长（毫秒）。时钟回拨（负值）当 0 —— 不触发"多日不见" */
export function awayMs(state: PetState, nowIso: string): number {
  const now = Date.parse(nowIso)
  const last = Date.parse(state.memory.lastSeenAt)
  if (!Number.isFinite(now) || !Number.isFinite(last)) return 0
  return Math.max(0, now - last)
}

/**
 * 估算一段文本的 token 数。**护栏不是账本**：中文约 1 token/字、英文约
 * 1 token/4 字符，混排按 1/2 取中 —— 会不会差 20%？会。但它服务的判据是
 * "今天有没有贵到十倍"，不是"这个月花了多少钱"（真账在服务商后台）。
 */
export function approxPetTokens(text: string): number {
  return Math.ceil(text.length / 2)
}

/** 聊天闸的结果（'ok' 之外每一档对应 copy.ts 里一句人话） */
export type PetChatGate = 'ok' | 'cooldown' | 'daily' | 'tokens' | 'hungry'

/**
 * 现在能不能聊。**纯函数、只看状态和时刻** —— "剩几次"这种问题必须
 * 有一个可单测的答案，不然它散在 IPC handler 里，账永远对不清。
 */
export function petChatGate(state: PetState, nowIso: string): PetChatGate {
  // 饿扁了拒绝干活（且零 API：这一闸在任何网络请求之前）。排在最前：
  // 饿着时该被听见的是"去学习赚饭"（可行动），而不是冷却/限额这类次要理由
  if (state.satiety <= 0) return 'hungry'
  const m = state.memory
  const now = Date.parse(nowIso)
  if (Number.isFinite(now) && m.lastChatAt !== null) {
    const last = Date.parse(m.lastChatAt)
    if (Number.isFinite(last) && now - last < PET_CHAT_MIN_INTERVAL_MS) return 'cooldown'
  }
  const today = dayKey(nowIso)
  const calls = m.chatDay === today ? m.chatCallsToday : 0
  const tokens = m.chatDay === today ? m.chatTokensToday : 0
  if (calls >= PET_CHAT_DAILY_MAX) return 'daily'
  if (tokens >= PET_CHAT_DAILY_TOKENS) return 'tokens'
  return 'ok'
}

/**
 * 记一次**成功发出**的聊天（回车之后再记账：失败/被冷却拦下的都不算，
 * 否则"网络断了时连点重试"会把额度吃光）。同时**扣饱食度**（思考是体力活）：
 * 扣账和记账在同一处发生，额度与体力才不会两本账对不上。
 */
export function petChatCommit(state: PetState, nowIso: string, usedTokens: number): PetState {
  const today = dayKey(nowIso)
  const fresh = state.memory.chatDay !== today
  const spent = exertPet(state, PET_CHAT_COST)
  return {
    ...spent,
    memory: {
      ...spent.memory,
      chatDay: today,
      chatCallsToday: (fresh ? 0 : state.memory.chatCallsToday) + 1,
      chatTokensToday:
        (fresh ? 0 : state.memory.chatTokensToday) + Math.max(0, Math.round(usedTokens)),
      lastChatAt: nowIso
    }
  }
}

// ---------------------------------------------------------------- 入参清洗（IPC 边界）

/** 上报的视口矩形：四项全部有限、宽高为正才收，否则整条 rect 作废（null） */
function parseRect(raw: unknown): PetRunReport['rect'] {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const nums = [r.x, r.y, r.width, r.height]
  if (!nums.every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  const rect = { x: r.x as number, y: r.y as number, width: r.width as number, height: r.height as number }
  if (rect.width <= 0 || rect.height <= 0) return null
  return rect
}

/**
 * 清洗运行上报。**整条无效就返回 null**（调用方直接丢）——
 * 这不像 pet.json 那样有"缺字段补默认"的余地：一份连 ok 都没有的上报，
 * 补出来的"失败"会把桌宠叫到屏幕中央说一句它自己也不知道的错。
 */
export function normalizeRunReport(raw: unknown): PetRunReport | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.ok !== 'boolean') return null
  const kind =
    r.kind === 'compile' || r.kind === 'run' || r.kind === 'timeout' ? r.kind : 'other'
  const line =
    typeof r.line === 'number' && Number.isInteger(r.line) && r.line >= 1 ? r.line : null
  // own/hash 是发奖证据：形状不对就当"没证据"（own:false / hash:null），
  // **不毙整条上报** —— 证据缺失只影响发不发奖，报错跑腿照常走
  const hash = typeof r.hash === 'string' && RUN_FP_RE.test(r.hash) ? r.hash : null
  return { ok: r.ok, kind, line, rect: parseRect(r.rect), own: r.own === true, hash }
}

export function parsePetAction(raw: unknown): PetAction | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  switch (r.action) {
    case 'feed':
    case 'pat':
    case 'show':
    case 'hide':
    case 'menu':
    case 'chat':
      return { action: r.action }
    case 'grant': {
      if (!isPetRewardKind(r.reward)) return null
      // lessonId 是"能没有、有就用"的装饰字段（照下面 'wrong' 的 title 先例）：
      // 课学完的 grant 带它进账本（ref.lessonId 是服务端硬要求），洗坏了只丢
      // 这个字段，绝不连坐整条 —— 饭照发，账本侧把缺 ref 的条目标 'rejected'
      // 保余额（rice-journal 的 refViolation）
      const lessonId = typeof r.lessonId === 'string' ? r.lessonId.slice(0, 200).trim() : ''
      return { action: 'grant', reward: r.reward, ...(lessonId === '' ? {} : { lessonId }) }
    }
    case 'event':
      // kind 白名单：'challenge'/'review' 之外（含缺失）→ 整条作废 ——
      // 好感事件没有"能没有、有就用"的装饰字段（同 grant 的 reward 口径）
      return r.kind === 'challenge' || r.kind === 'review'
        ? { action: 'event', kind: r.kind }
        : null
    case 'mode':
      return isPetMode(r.mode) ? { action: 'mode', mode: r.mode } : null
    case 'size':
      return isPetSize(r.size) ? { action: 'size', size: r.size } : null
    case 'rua':
      return { action: 'rua' }
    case 'wrong': {
      // 课名/顺序号都是"能没有、有就用"的装饰：洗坏一个不许把整条上报毙掉
      // （整条毙掉 = 答错了鱼也不吭声，比课名缺失糟得多）
      const title = typeof r.title === 'string' ? r.title.slice(0, 60).trim() : ''
      const order =
        typeof r.order === 'number' && Number.isInteger(r.order) && r.order >= 1 && r.order <= 999
          ? r.order
          : null
      return { action: 'wrong', title: title === '' ? null : title, order, learned: r.learned === true }
    }
    case 'pos': {
      if (typeof r.x !== 'number' || typeof r.y !== 'number') return null
      if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) return null
      return { action: 'pos', x: clampRatio(r.x, 0.5), y: clampRatio(r.y, 0.5) }
    }
    default:
      return null
  }
}

/**
 * 清洗宠物窗上报的鼠标命中区。空数组是**合法**的（宠物在动画中间、
 * 所有区域都临时不可点）—— 非法输入返回 null，调用方保持上一份。
 * 上限 8 个：就算被注入也不会让主进程每 60ms 扫一张长表。
 */
export function parsePetHitRects(raw: unknown): PetHitRect[] | null {
  if (!Array.isArray(raw) || raw.length > 8) return null
  const out: PetHitRect[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const r = item as Record<string, unknown>
    const nums = [r.x, r.y, r.w, r.h]
    if (!nums.every((v) => typeof v === 'number' && Number.isFinite(v))) return null
    if ((r.w as number) <= 0 || (r.h as number) <= 0) return null
    out.push({ x: r.x as number, y: r.y as number, w: r.w as number, h: r.h as number })
  }
  return out
}

/**
 * 清洗聊天历史。**最后一条必须是 user**（模型等着被问），历史的
 * assistant 可以带。超过上限从**最老的**开始丢（近处的对话才是有上下文的）。
 */
export function sanitizePetChat(raw: unknown): PetChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: PetChatMessage[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const m = item as Record<string, unknown>
    if (m.role !== 'user' && m.role !== 'assistant') return null
    if (typeof m.content !== 'string') return null
    const content = m.content.slice(0, PET_CHAT_MAX_CHARS).trim()
    if (content === '') return null
    out.push({ role: m.role, content })
  }
  if (out[out.length - 1].role !== 'user') return null
  return out.slice(-PET_CHAT_MAX_MESSAGES)
}
