/**
 * 全项目共享 DTO 类型定义（唯一真源）。
 * 渲染进程与主进程共用；与 content-bundle.json 的 schema、三个 JSON 存储文件（config/profile/wrongbook）对齐。
 * 任何新增接口先改这里，再改实现。
 */

import { DEFAULT_LAYOUT, type LayoutConfig } from './layout'
import { defaultWallpaper, type WallpaperConfig } from './wallpaper'
import { defaultSplash, type SplashConfig } from './splash'
import type { BoxStamp } from './doc-write'

// ---------------------------------------------------------------- 内容（content-bundle.json）

export type Lang = 'common' | 'c' | 'cpp' | 'java' | 'python'
export type LangOfCode = Exclude<Lang, 'common'>
export type Stage = 0 | 1 | 2 | 3

/**
 * 四门可运行语言的标准顺序，**唯一真源**。
 *
 * 放在 shared 而不是渲染进程：主进程（编译运行、环境检测）和渲染进程
 * （编辑器、练习场、示例代码）都要按同一个顺序列语言，各写一份迟早会漂。
 * 而且 tsconfig.node 和 tsconfig.web 都包含 src/shared/**，两边都拿得到。
 */
export const LANG_OF_CODE: readonly LangOfCode[] = ['c', 'cpp', 'java', 'python']

/**
 * 一份「每门语言都还没配」的本地 IDE 路径表（config v9 的形状，见
 * `AppConfig.nativeIdePaths`）。
 *
 * 【为什么是函数不是常量】它要被写进 `DEFAULT_APP_CONFIG` —— 共享常量对象
 * 一旦被谁原地改一下，默认配置就跟着变了（同 `layout: { ...DEFAULT_LAYOUT }`
 * 的理由）。每次调用新造一个对象，谁改谁的，互不影响。
 */
export function emptyIdePaths(): Record<LangOfCode, string> {
  return { c: '', cpp: '', java: '', python: '' }
}

export interface GlossaryTerm {
  key: string
  originals: string[]
  cat: string
  example: string
  scanExcludes?: { lookBehind: string[]; lookAhead: string[] }
}

/**
 * 难度档（四档）。**值域的唯一真源**是 `shared/difficulty.ts` 的 `DIFFICULTIES`；
 * 显示名在渲染层 `lib/copy.ts`（这里是 shared，字符串一律英文）。
 *
 * 【为什么是「可选覆盖字段」而不是每道题都手写一个】
 * 4023 道存量题的难度由规则在**运行时解析**（`resolveDifficulty(题, 阶段)`，
 * 规则表见 `shared/difficulty.ts`），内容文件一个字节都不用改。
 * 显式写出来的只有**要覆盖默认规则**的题 —— 目前唯一用途是精选题库模板
 * 标 `challenge`（挑战题只在阶段综合练习/整门练习/每日挑战里出现）。
 */
export type Difficulty = 'easy' | 'medium' | 'hard' | 'challenge'

export interface ChoiceQuestion {
  id: string
  type: 'choice'
  difficulty?: Difficulty // 显式覆盖；缺省由 shared/difficulty.ts 按题型解析
  stem: string
  options: string[]
  answer: number // 正确选项下标，0 起
  explanation: string
}

export interface FillQuestion {
  id: string
  type: 'fill'
  difficulty?: Difficulty // 显式覆盖；缺省由 shared/difficulty.ts 按题型解析
  stem: string // ____ 表示空白
  answer: string
  accept?: string[] // 等价答案
  explanation: string
}

export interface CodeQuestion {
  id: string
  type: 'code'
  difficulty?: Difficulty // 显式覆盖；缺省由 shared/difficulty.ts 按题型解析
  lang: LangOfCode
  code: string
  stem: string // 通常问：这段代码输出什么？
  answer: string
  accept?: string[]
  explanation: string
}

/**
 * 代码填空题里的一个空。
 *
 * ⚠️ `answer` **不能含换行** —— 各个空在会话里是按 `\n` 拼成一串存的，
 * 答案里带换行会让后面所有空整体错位（答对却判错，且看自己的输入看不出来）。
 * 内容校验器会拦这一条，理由详见 `shared/codefill.ts` 开头。
 */
export interface CodeFillBlank {
  answer: string
  accept?: string[] // 等价答案
}

/**
 * 代码填空题：给一段**完整、能跑、上下文够读懂**的代码，挖掉几个空。
 *
 * 【和 `fill` 的区别】`fill` 是把代码写在题干文字里问一句；`codefill` 给的是一块
 * 带高亮的真代码，学员一眼看到的是"这段程序长什么样"，而不是"一道文字题"。
 * 【和 `code` 的区别】`code` 是给代码问输出（读），`codefill` 是给代码补缺口（写）。
 * 【判分不需要执行】和 `fill` 一样走字符串比对，理由见 docs/09 §2.2 的题型表。
 */
export interface CodeFillQuestion {
  id: string
  type: 'codefill'
  difficulty?: Difficulty // 显式覆盖；缺省由 shared/difficulty.ts 按题型解析
  lang: LangOfCode
  /** 代码原文。空位用**连续 4 个及以上**的下划线标出，个数必须等于 `blanks.length` */
  code: string
  stem: string
  /** 与 `code` 里的空位**顺序一一对应**。个数由内容校验器对账 */
  blanks: CodeFillBlank[]
  explanation: string
}

/**
 * 代码改错题：给一段**真的会报错**的代码，让学员改到能跑对。
 *
 * 【为什么它不是 `codefill` 的变体】`codefill` 的空位有唯一正确答案、字符串比对就够；
 * 改错题的答案是一整段**学员自己写的代码** —— 「怎么改」有无数种写法，
 * 唯一的判据是「改完之后跑出来的东西对不对」。**所以这一类的判分必须真编译真运行。**
 *
 * 【为什么要 `referenceFix`】没有它，`expectedOutput` 就是一个**没人能验证的断言** ——
 * 内容生成时写错一个字符，学员就永远做不对。有了参考解，`npm run check:questions`
 * 才能真跑一遍、确认「这份参考解真的输出 expectedOutput」。
 * 这是项目铁律「**静默跳过 = 把『没验过』伪装成『验过了』**」在这一类题型上的落地。
 */
export interface CodeFixQuestion {
  id: string
  type: 'codefix'
  difficulty?: Difficulty // 显式覆盖；缺省由 shared/difficulty.ts 按题型解析
  lang: LangOfCode
  /** 原样交给学员的出错代码。**必须真的报错**（编译错或运行错都行），不能只是"看着像错的" */
  brokenCode: string
  stem: string
  /** 改对后应该打印什么。**判分依据** —— 比对规则见 docs/09「真跑判分的输出比对契约」 */
  expectedOutput: string
  /** 参考解。既给校验器真跑验证，也给卡住的学员当示范（错了 2 次之后才出现） */
  referenceFix: string
  stdin?: string
  explanation: string
}

/**
 * 写代码大题：给任务，从零写。判分方式与 `codefix` **完全相同**（真跑比输出）。
 *
 * 【为什么和 `codefix` 拆成两个类型、而不是一个带 `mode` 字段的类型】
 * 理由见 docs/09：内容生成时语义清楚（AI 不会把"给错代码"和"给任务"写混）、
 * 校验器能分别检查（`codefix` 的 `brokenCode` 必须非空，`codewrite` 不该有它）。
 * **防漂移的是共享的判分函数，不是共享的类型** —— 两者共用 `gradeByRun()`。
 */
export interface CodeWriteQuestion {
  id: string
  type: 'codewrite'
  difficulty?: Difficulty // 显式覆盖；缺省由 shared/difficulty.ts 按题型解析
  lang: LangOfCode
  stem: string
  /**
   * 起始骨架。**编译型语言必给**（Java 尤其：运行器写死了 `Main.java`，
   * 类名不能是别的），Python 可省。
   *
   * 给的是**样板**（`int main(void)` 那一套），不是提示 —— 让零基础学员
   * 卡在样板代码上是浪费，那不是本课要教的东西。
   */
  starter?: string
  expectedOutput: string
  referenceSolution: string
  stdin?: string
  explanation: string
}

export type Question =
  | ChoiceQuestion
  | FillQuestion
  | CodeQuestion
  | CodeFillQuestion
  | CodeFixQuestion
  | CodeWriteQuestion

/** 六种题型的判别值（`q.type` 的类型）。筛选题型、按题型分桶都用它，别处不再手抄这份联合 */
export type QuestionType = Question['type']

/**
 * 需要**真编译真运行**才能判分的题型。
 *
 * 存在的理由：题型登记散在好几个地方（判分分发、作答界面、内容校验、AI 白名单），
 * 每加一类都要在每一处想一遍"它算不算要跑的"。有这个判据就只需要问一次。
 */
export type RunGradedQuestion = CodeFixQuestion | CodeWriteQuestion

export interface Lesson {
  id: string
  lang: Lang
  stage: Stage
  order: number
  title: string
  tags: string[]
  required: string[] // 显式前置课（打包时已按缺省规则解析）
  crossRefs: string[]
  compare: string[] // 引用的通用概念课
  estMinutes: number
  keywords: string[]
  body: string // lesson.md 正文（无 frontmatter）
  questions: Question[]
}

export interface SearchEntry {
  id: string
  lang: Lang
  stage: Stage
  title: string
  tags: string[]
  keywords: string[]
  text: string // 剥标记正文 + 代码原文 + 题干
}

export interface OutlineLesson {
  id: string
  title: string
  tags: string[]
  order: number
  hasContent: boolean
}

export interface OutlineModule {
  lang: Lang
  stage: Stage
  lessons: OutlineLesson[]
}

export interface ErrorRule {
  /**
   * 正则源码。捕获组按序号被 title/explain/fixHint 里的 `{1}`..`{9}` 引用。
   * 注意它匹配的是**整段报错文本**（stderr 优先），不是某一行 —— 见 error-match.ts。
   */
  pattern: string
  /** 正则标志，如 `i`（忽略大小写）、`m`。省略即不带标志 */
  flags?: string
  title: string
  explain: string
  fixHint: string
}

export type ErrorLib = Record<string, ErrorRule[]>

export interface ContentBundle {
  version: number
  builtAt: string
  glossary: { version: number; note: string; terms: GlossaryTerm[] }
  errorLib: ErrorLib
  lessons: Lesson[]
  outline: OutlineModule[]
  searchIndex: SearchEntry[]
}

// ---------------------------------------------------------------- 学习状态（profile.json）

export type LessonStatus = 'locked' | 'open' | 'learned' | 'draft'

export interface LessonHistoryEntry {
  lessonId: string
  finishedAt: string // ISO，标记已学时间（复习起点）
}

/**
 * 奖励台账（「每日复习」全对发图）。
 *
 * 【为什么挂在 profile.json 而不是另开一个 rewards.json】
 * 它是**跟人走**的东西（换机器、将来接服务器，都要随着这个人的档案走），
 * 而且**永不裁剪** —— 已获得的图是用户攒下的东西，没有理由丢。
 * challenge.json 那种 30 天滚动窗口的文件放不下它。
 *
 * 【gallery 里存的是图 id，不是文件名】文件名会换（重出、换格式），
 * id 才是身份。展示时用图库清单把 id 翻成文件与标题。
 *
 * 【perfectPasses 为什么要单独记】它是「图发完了」之后仍然继续累加的那个数 ——
 * 图库只有十来张而复习可以做无数次，发完之后每次全对也该留个痕，
 * 而不是假装「没图可发 = 什么都没发生」。
 */
export interface ProfileRewards {
  /** 已获得的奖励图 id（判重靠它，顺序无意义） */
  gallery: string[]
  /** 每日复习全对的累计次数 */
  perfectPasses: number
  /**
   * 最近一次**真的发出图**的日子（日键 'YYYY-MM-DD'；从没发过 = null）。
   *
   * 「每日复习只能拿一次图」的判据（2026-10-16 主人裁定）。同一天里第二次
   * 全对不再发图 —— 但 perfectPasses 照 +1（它是"全对过几次"的台账，
   * 与发不发图无关，见 shared/gallery.ts grantReward）。
   * 【判据为什么是"日键比较"而不是时间差或计数器】日键定长补零，字符串序=时间序。
   * 只要 `day <= lastImageDay` 就算"今天已拿过"：相等挡住同一天的第二张；
   * 更早（把时钟拨回去）也挡；拨到更晚的日子拿到一张、再拨回今天同样拿不到。
   * 只有日子**真的往前走**了才发下一张 —— 拨时钟骗不出第二张图。
   */
  lastImageDay: string | null
}

/**
 * 每日签到（P3 ①，2026-10-08）。
 *
 * 【为什么 days 是数组而不是只存一个 lastDate】「签过没有」的判据必须是
 * **日子本身**（`days.includes(today)`）—— 只用 lastDate 的话，用户把系统
 * 时钟往回拨一天、再拨回今天，就会在同一天里**重复领到大白饭**（改一次时间
 * 得两份饭，而界面上看不出任何异常）。lastDate 只喂连续天数计算，不当判据。
 *
 * 【为什么留 366 就够】月历只画当月、streak 只看昨天，历史再长都没有读者；
 * 而无上限的数组会跟着 profile 上云端（有体积门）。留最近一年 = 「去年今天
 * 签过没有」这种将来可能想看的问题也答得上来。
 */
export interface CheckinState {
  /** 最近一次签到的日键（'YYYY-MM-DD'）。只喂 streak 计算；判据看 days */
  lastDate: string | null
  /** 连续签到天数（断签清零、回拨不涨） */
  streakDays: number
  /** 累计签到天数（不清零；超过 days 容量后仍继续累加） */
  totalDays: number
  /** 已签到日键，升序去重，最多保留最近一年（366 天） */
  days: string[]
  /**
   * 预留云端对账（后端 unfreeze 前只留空，本次实现不写它）。
   * 可选：老档案没有、新写的档案也没有，读到 undefined 是正常态。
   */
  cloud?: { lastSyncedAt: string | null }
}

/**
 * 「签到」IPC 的结果 —— **失败会抛**（写盘失败），所以这里只有成功形状。
 *
 * 【为什么 awarded 和 riceGranted 是两件事】签到（写档案）和大白饭（发桌宠）
 * 住在两个文件里、由两条完全不同的代码路径落盘，任一条都可能单独失败：
 *   · awarded=false —— 今天已经签过（幂等重放），**什么都没发生**；
 *   · riceGranted=false —— 签到记下了，但桌宠宿主没起来 / 发饭那头出错。
 * 合成一个布尔的话，「今天签过了」和「饭没发出去」会共用一句话，
 * 而这两件事该说的下一句完全不同（前者闭嘴，后者要出声）。
 *
 * 【为什么还要有 riceCredited（V1-42 / 空转[1]）】riceGranted 只回答
 * "grant 有没有被执行"—— 饭盒满仓（999）时 grant 执行了、饭却一粒没进，
 * 它照样是真。真进盒几碗是另一个数：播报必须拿它说话，拿名义常量
 * （PET_CHECKIN_RICE）报"2 碗到手"就是假报成功。
 */
export interface CheckinSubmitResult {
  ok: true
  /** 这次是不是**新**签到（幂等重签 = false） */
  awarded: boolean
  /**
   * 这次签到**是不是把一条连签断掉了**（空转[2]，2026-10-16）。
   *
   * 判据由 applyCheckin 那行接续规则**现算**（lastDate 非空、且它的明天
   * 不是今天）：第一次签到不算断签（没有"断"可言）。界面拿它决定播报里
   * 要不要带一句"连签断啦、从今天重新数起" —— 之前这条事实没人在任何
   * 地方说过，用户是看着卡片从「30 天」当场变「1 天」才知道的。
   * `awarded=false`（幂等重放）时恒为 false：什么都没发生，没什么可报。
   */
  streakReset: boolean
  /** 签到之后档案里的签到状态（渲染层直接换上，省一次 profile:get 往返） */
  checkin: CheckinState
  /** 大白饭有没有真的进鱼盆（按桌宠宿主的真实返回判定，没证据就是 false） */
  riceGranted: boolean
  /**
   * 这次**真进盒**的白饭碗数（V1-42 / 空转[1]）。
   *
   * 【为什么不是布尔】满仓 999 时 grant 执行了但实际入账 0 碗；半仓
   * （998 + 2）时实际入账 1 碗 —— 播报的碗数只有这个数是真的。
   * null = 桌宠宿主没起来 / 出错（拿不到前后快照，与 riceGranted=false 同刻）。
   */
  riceCredited: number | null
  /**
   * 签到**之后**的档案戳（P10.6 本地写协议）。
   *
   * 【为什么每次都要带上，哪怕这次没写盘】这条通道是主进程对 profile 的
   * RMW（判重→写档→发饭）：写口用的旧戳会让渲染层手里那份戳过期，下一次
   * 防抖保存必然撞 STALE_REV 假冲突 —— 冲突机制用来报"别人改过"，不该
   * 被我们自己的 RMW 触发。无条件的现戳让渲染层 noteStamp 一次对齐，
   * 不管 awarded 是真是假。
   */
  stamp: BoxStamp
}

/**
 * 「把这张奖励图另存一份」的结果 —— **失败即值，不抛异常**。
 *
 * 【为什么取消单列一档，不并进 failed】
 * 用户点开保存框又反悔，是**正常操作**，不该看到任何红字；而"图找不到"
 * 是真出事了，得说话。两种情况都塞进 `failed` 的话，要么取消也弹错、
 * 要么真出事时静默 —— 两个方向都错过。
 * （同款语义：`shared/ai-question.ts` 的 `AiResult`。）
 */
export type GallerySaveResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'cancelled' | 'missing' | 'failed' }

/**
 * 奖励图覆盖映射（`<数据目录>/rewards` 的扫描结果，2026-10-16）。
 *
 * `dir` 一并带回：设置页要显示「图该放进哪个文件夹」—— 路径算法只在
 * 主进程有一份（storageDir()），渲染层不自己拼。
 */
export type RewardOverridesInfo = {
  dir: string
  /** id（gNN）→ 覆盖文件绝对路径。空对象 = 没有任何覆盖（**不是错误**） */
  map: Record<string, string>
}

/**
 * 「用本地 IDE 打开这段代码」的结果 —— 同样**失败即值，不抛异常**。
 *
 * 【为什么 unconfigured 单独一档，不并进 failed】
 * 「没配路径」的下一步是去设置页填一个，「配了但找不到/起不来」的下一步
 * 是换路径 —— 两种引导的方向完全不同。并成 failed 只能给一句含糊的
 * 「失败了」，用户被晾在原地（同上面「取消单列一档」的理由）。
 */
export type IdeOpenResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'unconfigured' | 'missing' | 'failed'; detail?: string }

/** 「导出代码并复制路径」的结果。写盘失败是唯一失败态（复制那一步由渲染层做） */
export type ExportCodeResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'failed'; detail?: string }

/** 「选一个 exe 文件」的结果。用户取消**不是错误** —— 如实说「取消了」，不抛 */
export type PickExeResult = { ok: true; path: string } | { ok: false; reason: 'cancelled' }

/**
 * 自动探测找到的一个 IDE 候选。
 *
 * `source` 记录它是被哪一层找到的（常见安装路径 / 快捷方式 / 注册表）——
 * 界面不一定要显示，但排障时「这条是从哪儿冒出来的」必须答得上来。
 */
export interface IdeCandidate {
  path: string
  name: string
  source: 'known' | 'shortcut' | 'registry'
}

/**
 * 「自动检测本机装了什么 IDE」的结果 —— 失败即值，不抛。
 *
 * 【`ok:true` 但 candidates 为空 ≠ 失败】那是「查了，真没找到」，
 * 下一步是让用户自己点「选择文件」；而 `ok:false` 是**探测本身出了岔子**，
 * 下一步是重试或报障。两种情况的引导不同，所以分开 ——
 * 把「没查成」冒充成「没找到」就是骗人（同 `IdeOpenResult` 里
 * unconfigured 单独一档的理由）。
 */
export type IdeDetectResult =
  | { ok: true; candidates: IdeCandidate[] }
  | { ok: false; reason: 'failed'; detail?: string }

/**
 * 档案的**墓碑区**（v4，P10.1）——「什么时候取消的」。
 *
 * 【为什么必须有墓碑】同步合并是「并集 − 墓碑」：A 机学会、B 机取消，
 * 并集会把取消抹掉。墓碑记下「取消发生在这一刻」，合并时与条目时间戳
 * 「新者胜」—— 条目更新（重新学会）则弃墓碑，墓碑更新则删条目。
 *
 * 【为什么可撤销】墓碑不是只增的：写口在「集合重新变大」时销掉对应墓碑
 * （重新标记 = 撤销）。没有这一条，用户重新学会/重新收藏会被自己的墓碑
 * 永久吞掉 —— 红队三处独立发现，单机即可复现。
 *
 * 【为什么归主进程独占】渲染层永远不写这两张表（它读写的是 learned /
 * favorites 两个数组）；写口按 diff 维护（新增 → 盖时间戳 + 销墓碑；
 * 移除 → 删时间戳 + 盖章墓碑），读口剥掉 tombstones 再交给渲染层。
 */
export interface ProfileTombstones {
  /** lessonId → 取消「已学」的 ISO 时刻 */
  learned: Record<string, string>
  /** lessonId → 取消课程级收藏的 ISO 时刻 */
  lessonFavorites: Record<string, string>
}

export interface UserProfile {
  version: number
  learned: string[] // 已标记已学的 lessonId
  favorites: string[]
  history: LessonHistoryEntry[]
  stats: {
    learnedCount: number
    practicedCount: number
    streakDays: number
  }
  rewards: ProfileRewards
  /** 每日签到（v3）。老档案没有这段 —— 迁移补默认值，见 profile-migrate.ts */
  checkin: CheckinState
  /**
   * 已学课的时间戳（v4）：lessonId → 「标记已学」那一刻（ISO）。
   * 合并时与 `tombstones.learned` 「新者胜」用；markLearned(true) 时刷新。
   * 迁移回填 **epoch0**（1970）而不是 now —— 伪造 now 会在与墓碑比较时错误胜出。
   */
  learnedAt: Record<string, string>
  /** 课程级收藏的时间戳（v4）：lessonId → 「收藏」那一刻（ISO）。同 `learnedAt` 一笔账 */
  favoriteAt: Record<string, string>
  /** 墓碑区（v4）。主进程独占，读口剥掉再出 IPC */
  tombstones: ProfileTombstones
}

/**
 * 当前档案 schema 版本。和 `CURRENT_CONFIG_VERSION` 同一套规矩：
 * `json-store.ts` 不读它，`migrateProfile()` 拿它决定搬运哪几段。
 * **改 `UserProfile` 的字段就必须把它 +1**（铁律 6）。
 *
 * | 版本 | 改了什么 |
 * |---|---|
 * | 1 | 初版 |
 * | 2 | 加 `rewards`（奖励台账）；见 `shared/profile-migrate.ts` |
 * | 3 | 加 `checkin`（每日签到）；见 `shared/profile-migrate.ts` |
 * | 4 | 加 `learnedAt` / `favoriteAt` / `tombstones`（同步合并的时间戳与墓碑，P10.1）。老数据回填 epoch0，不伪造 now |
 * | 5 | `rewards` 加 `lastImageDay`（每日复习一天只发一张图的判据，2026-10-16 空转[0]/V1-38 整改）；老数据 = null |
 */
export const CURRENT_PROFILE_VERSION = 5

/**
 * 默认档案。主进程与渲染进程**共用这一份** —— 渲染层那份 INITIAL 以前
 * 自己硬编码 `version: 1`，主进程迁移升到 v2 之后，渲染层防抖保存会把它
 * **顶回 1**（保存走整份覆盖），症状是「升完级过一会儿又没升」。
 *
 * ⚠️ 交出去之前记得 `structuredClone` —— 它是模块级单例，
 * 谁原地改一下默认值就在全进程生效（config 那边栽过同款）。
 */
export const DEFAULT_PROFILE: UserProfile = {
  version: CURRENT_PROFILE_VERSION,
  learned: [],
  favorites: [],
  history: [],
  stats: { learnedCount: 0, practicedCount: 0, streakDays: 0 },
  rewards: { gallery: [], perfectPasses: 0, lastImageDay: null },
  checkin: { lastDate: null, streakDays: 0, totalDays: 0, days: [] },
  // v4：空档案没有「什么时候发生」可记 —— 两张时间戳表与墓碑区都是空的。
  // 注意别在这里塞 now：这份常量是模块级单例，now 会让「空档案」看起来像刚发生过什么
  learnedAt: {},
  favoriteAt: {},
  tombstones: { learned: {}, lessonFavorites: {} }
}

// ---------------------------------------------------------------- 错题本（wrongbook.json）

export interface WrongBookEntry {
  key: string // `${lessonId}:${qid}`
  lessonId: string
  qid: string
  wrongCount: number
  lastWrongAt: string
  cleared: boolean
  clearedAt?: string
  /**
   * **最近一次答错时**用户在哪（练习模式：`lesson` / `random` / `challenge` / …）。
   *
   * 【它说的不是「题是哪来的」】界面上那枚来源徽章 = **进入错题本的途径**，
   * 不是这条题的内容来源（手写/题库那个维度明确不做，见 docs/20 §13）。
   * 所以它跟着「最近的错」走：同一道题上个月在挑战里错、今天在复习里又错，
   * 徽章显示的是「复习」—— 用户对得上号的是他刚做的事。
   *
   * 用宽松的 string 而不是模式枚举：枚举定义在渲染层的 quiz store 里，
   * 而这是**要落盘**的字段，落盘的形状不该跟着渲染层重构漂。
   * 界面拿到认不出的取值按「练习」兜底（copy.ts 里那张表）。
   */
  source?: string
  /**
   * 用户**手动**删掉的标记（软删除，可恢复）。
   *
   * 【和 `cleared` 是两回事，别合并】
   * `cleared` = 「答对了，自动毕业」；`removed` = 「我不想再看见它」。
   * 两者的恢复入口不同（毕业靠再错一次复活，删除靠恢复按钮），
   * 筛选器也不同（在库 / 已移除）。合成一个字段的代价是其中一种语义消失。
   *
   * 【为什么是软删】规格明说「删除可恢复」。真删就恢复不了；
   * 而且再次答错时「它又回来了」这件事本身就是有用的信号
   * （UI 会提示一句「这条你删过，又答错了喵」）。
   */
  removed?: boolean
  removedAt?: string
  /** 用户手动标的「知识点漏洞」（行首小旗 + 漏洞筛选） */
  hole?: boolean
  /**
   * **只有 AI 现场出的题才有这个字段**（主人 2026-09-13 拍板放它们进来）。
   *
   * 【为什么必须带本体 —— 不带就是一条消除不掉的死条目】
   * 错题本的「再练一次」原本靠 `课号 + 题号` 去内容包里把题目找回来
   * （`lessonOf(课号).questions.find(题号)`），而 **AI 题不在任何一课里**。
   * 所以只要收进来，用户看到的就是：列表里题干显示成「题目已被移走喵」，
   * 点重做时它被**静默跳过**，于是永远赖在待重做列表里、**答对了也消除不掉**。
   * 带上本体，这两个问题就同时没了：显示用它，重做也用它。
   *
   * 【为什么内置题**不**存本体】
   * 存了就有两份真源。将来改了内置题，错题本里那份还是旧的，
   * 而内容包那份才是真的 —— 同一个坑在 ChallengeQuestion 那边已经踩过一遍。
   */
  ai?: Question
}

/**
 * 错题本里 AI 题最多留几条（**毕业的也算在内**，超出就丢最久没做错的那条）。
 *
 * 【为什么要有这个上限】
 * AI 题带着完整本体（题干 + 选项 + 解析），是错题本里最占地方的一种条目。
 * 不管的话，每天错 5 道的用户一年能攒下 1800 条带本体的记录，
 * 而错题本**本来是用来看的** —— 一个几百条的列表，没人会去翻。
 *
 * 30 这个数：每天 5 题的挑战，连错 6 天刚好装满。够覆盖「我这一阵错的」，
 * 又不至于长到看不动。
 *
 * 【为什么毕业的也数】
 * 毕业的条目 `lastWrongAt` 停在「当初做错那天」，天然排在队尾，真要丢时先丢它们。
 * 这样一来 `wrongbook:clear` 不用为 AI 题开特例，
 * 「重做答对就毕业（历史会保留）」那句话对所有题都成立。
 */
export const AI_WRONG_CAP = 30

/** `wrongbook:record` 的一条入参：光有 key 不够，AI 题还得把本体一起送来 */
export interface WrongRecordItem {
  key: string
  /** 只有 AI 题要带；内置题带了会被主进程丢掉（不让它变成第二份真源） */
  ai?: Question
  /**
   * 这次是在哪儿错的（模式名，写进条目的 `source` 当来源徽章）。
   * 选填：老调用点不传也能记账，只是徽章按「练习」兜底。
   */
  source?: string
}

/**
 * `wrongbook.json` 的根 —— **带版本的信封**。
 *
 * 【为什么从裸数组改成信封】裸数组没有地方写版本号，而这个文件的字段
 * 已经加过不止一次（AI 本体、source/removed/hole）。没有版本号，
 * 事后分不出磁盘上那份是哪个年代的 —— config 那边为这个欠账付过代价
 * （layout 字段的 version 永远停在 1），这条路不再走第二遍。
 *
 * 【老文件怎么办】`normalizeWrongbook()` 兼容裸数组：
 * 读进来照常认，读口顺手把信封写回去。**不丢一条错题**。
 */
export interface WrongBookFile {
  version: number
  entries: WrongBookEntry[]
}

/** `wrongbook.json` 当前 schema 版本（版本表见 `normalizeWrongbook` 的注释） */
export const CURRENT_WRONGBOOK_VERSION = 1

/**
 * `wrongbook:update` 要打/摘的标记。**只有用户手动动作**进得来 ——
 * 答错记账走 `wrongbook:record`，答对毕业走 `wrongbook:clear`，三条路各管各的。
 */
export interface WrongBookPatch {
  /** true = 软删（打 removed + removedAt）；false = 恢复（摘掉两个字段） */
  removed?: boolean
  /** true = 标知识点漏洞；false = 取消标记 */
  hole?: boolean
}

/** `wrongbook:update` 的入参：对一条已有错题应用一组标记 */
export interface WrongUpdateItem {
  key: string
  patch: WrongBookPatch
}

// ---------------------------------------------------------------- 收藏（favorites.json）

/**
 * 一道被收藏的题。
 *
 * 【和 `profile.favorites`（课级收藏）同名不同义，别合并】
 * 那个是「收藏的课程」（字符串数组，存 lessonId，总览页在用它统计）；
 * 这个是「收藏的题目」。合并的代价是两种收藏被绑死：
 * 想清空题目收藏就会连课程收藏一起没。
 *
 * 【AI 题必须带本体】和错题本同一条规矩、同一个理由：
 * AI 题不在任何一课里，光有 key 找不回原样 —— 显示和重做都得靠本体。
 * 判定用 key 前缀（`isAiKey`），别用「有没有 ai 字段」当判据。
 */
export interface FavoriteItem {
  key: string
  lessonId: string
  qid: string
  addedAt: string
  /**
   * 从哪儿收进来的（模式名），收藏列表的「来源」筛选靠它。
   *
   * 【为什么是选填】本项目自己写出来的条目一定带它（每个收藏入口都知道自己在哪），
   * 但这是**落盘**的字段：手改过的文件、将来从别处导入的文件都可能没有。
   * 写成必填等于宣布"这种文件不存在"，而读口只能两种做法二选一 ——
   * 要么丢掉整条收藏（连同用户写的笔记和 AI 题本体），要么编一个假来源。
   * 都不如如实留空、由界面把它归进「其它」那一档。
   */
  source?: string
  /** 所在文件夹；没归组就是 undefined（删掉文件夹时条目不删，回到这一档） */
  folderId?: string
  /** 用户笔记 */
  note?: string
  /**
   * **最后一次改动这条的时间**（v2，P10.1）。主进程写口独占维护 ——
   * 渲染层交上来的值一律不听（它手里那份是「读出来那一刻」的快照）。
   *
   * 【为什么是选填】老文件（v1）没有它；渲染层构造新条目时也不写它
   * （由写口补盖）。读口保证交出去的条目一定带（缺了就按 addedAt / 最古老回填）。
   * 合并时它和 `removedItems` 墓碑「新者胜」（重新收藏可撤销墓碑）。
   */
  updatedAt?: string
  ai?: Question
}

export interface FavoriteFolder {
  id: string
  name: string
  createdAt: string
  /** 最后一次改动（改名/时间）—— v2，语义同 `FavoriteItem.updatedAt` */
  updatedAt?: string
}

/**
 * `favorites.json` 的根（v2，P10.1）。
 *
 * 【v2 加了什么】文件级 `updatedAt` + 两张墓碑表（`removedItems` /
 * `removedFolders`：key/id → 移除时刻）。墓碑与 `profile.tombstones`
 * 同一笔账：主进程独占、读口剥、合并按「新者胜」裁决、重新收藏即撤销。
 *
 * 【为什么墓碑要单独两张表而不是条目上挂 `removedAt`】写口以磁盘原始
 * JSON 为基底 apply 业务字段（保留区纪律）—— 条目数组是渲染层的业务字段
 * （它交上来的是「活着的条目」），墓碑如果混在条目里，渲染层一个整份覆盖
 * 就会把它们连根刨掉。分开放，渲染层的载荷碰不到墓碑区。
 */
export interface FavoritesFile {
  version: number
  /** 文件级最后改动时刻（主进程独占） */
  updatedAt?: string
  folders: FavoriteFolder[]
  items: FavoriteItem[]
  /** 条目墓碑：`FavoriteItem.key` → 移除时刻（ISO） */
  removedItems?: Record<string, string>
  /** 文件夹墓碑：`FavoriteFolder.id` → 移除时刻（ISO） */
  removedFolders?: Record<string, string>
}

export const CURRENT_FAVORITES_VERSION = 2

// ---------------------------------------------------------------- 大肥鱼备忘录（memo.json）

/**
 * 一条备忘的两种性子（P3 ②）。
 *
 * 【为什么第一批只有这两种】备忘录收的东西是「用户自己敲下来的字」，
 * 而学习场景里它只有两个来源：翻到的一段代码 / 报错（`code`），和一句
 * 「我原来不知道这个」的话（`knowledge`）。再细分（按语言、按标签）就得配
 * 一整套筛选界面，那是第二批的事 —— 分类少，用户才愿意顺手给它归一下；
 * 十档分类的结果是没人选，全堆在默认值里。
 */
export type MemoKind = 'code' | 'knowledge'

/**
 * 一条备忘。
 *
 * 【为什么正文是自由文本，不拆成「标题 + 正文」两栏必填】标题是**给列表看的
 * 索引**（可以空着，列表退回显示正文摘要），正文才是内容本体。用户粘一段代码
 * 进来时，不该先被逼着起个名字 —— 那正是「想记点东西」变成「算了不记了」的地方。
 *
 * 【id 的形状】`memo-<毫秒时间戳>-<序号>`（照 favorites 的 `folder-…` 先例）：
 * 时间戳让磁盘上那份文件一眼能看出是什么时候写的；序号挡住「同一毫秒连建两条」
 * —— id 撞车的话主进程 `cleanList` 会把后一条当重复项**丢掉**，
 * 而用户看到的是「我新建了两条，只出现了一条」。
 *
 * 【时间戳为什么是数字不是 ISO 串】列表要排序、要显示「几天前」，
 * 数值比较比反复 parse 省事；而且它是**兜底得出来**的字段
 * （坏了就退回「最古老」，见 memo-merge.ts 的 cleanItem）。
 */
export interface MemoItem {
  id: string
  kind: MemoKind
  /** 给列表看的名字。**空串是合法的**（新建出来就是空的，列表退回显示正文摘要） */
  title: string
  /** 内容本体。字节上限 MEMO_BODY_MAX，输入时与写口各拦一层 */
  body: string
  createdAt: number
  updatedAt: number
}

/** `memo.json` 的根 */
export interface MemoFile {
  version: number
  items: MemoItem[]
}

export const CURRENT_MEMO_VERSION = 1

/**
 * 单条正文的上限（64KB，蓝本 §五）。
 *
 * 【为什么量的是**字节**不是字符数】判据要跟磁盘上那份文件对得上，
 * 而 UTF-8 里一个汉字占 3 字节。拿 `String.length`（UTF-16 码元）当判据的话，
 * 一篇 3 万汉字的天书在界面上显示「30 KB」，写口量出来却是 90 KB 被拒 ——
 * 「界面说没超、就是不让我存」。所以两个地方共用下面这一个函数量的数。
 */
export const MEMO_BODY_MAX = 64 * 1024

/**
 * 一段文本的 UTF-8 字节数（备忘录的 64KB 上限与界面上的「正文 x / 64 KB」共用）。
 *
 * 放在这儿而不是各写一份：主进程写口（`memo-merge.ts`）与渲染层输入拦截
 * （`stores/memo.ts`）量的**必须是同一个数**，否则界面放过去的会被写口拒 ——
 * 而那条路上的失败是「输入框一切正常、存不上」。
 */
export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length
}

// ---------------------------------------------------------------- 练习史（practice.json）

/**
 * 练习史里的一道题。`lessonId` 是**从 key 拆出来的真实宿主课**，
 * 不是会话的课号 —— review/stage 这类会话的课号是哨兵（`__review__`），
 * 哨兵进不了库（它一进库，每日复习的加权就成了对着一门不存在的课统计）。
 */
export interface PracticeItem {
  key: string
  lessonId: string
  ok: boolean
}

/** 一次做完的练习（中途退出不记 —— 判分口径是「交完的卷才算数」） */
export interface PracticeSession {
  /** 自增 id（主进程铸，落盘时 = 文件里最大 id + 1）。**只在本机内唯一** */
  id: number
  /**
   * 全局身份（v2，P10.1）：`${installId}:${id}`。
   *
   * 【为什么必须有它】两台设备各自 max+1 会铸出**相同的数字 id**，
   * 合并（按 id 去重）会把一端的整段会话当重复项吃掉。uid 以设备
   * installId（device.json，P10.1 §7.1-2）为命名空间，跨设备天然不撞。
   * 读口去重、append 编号、裁剪排序（`(at, uid)` 全序）全部改用它。
   */
  uid: string
  at: string
  /** 练习模式（`lesson` / `random` / `challenge` / …），每日复习的加权不区分它 */
  mode: string
  items: PracticeItem[]
}

/** `practice.json` 的根 */
export interface PracticeFile {
  version: number
  history: PracticeSession[]
}

export const CURRENT_PRACTICE_VERSION = 2

/**
 * 练习史最多留多少条（一条 = 一次完成的练习）。
 *
 * 【为什么是 5000】它是每日复习加权的**真源**。每天做 3 次练习的话，
 * 5000 条约等于 4 年半 —— 远超「最近哪些题错得多」需要的窗口，
 * 而文件本身只是小几十 KB 一条条累起来的文本，5000 条也远没到卡的程度。
 * 再往上加只会让「哪条该丢」这件事更难说得清。
 */
export const PRACTICE_KEEP_SESSIONS = 5000

/**
 * `practice:record` 的一条入参：**只报 key 和对错**。
 *
 * 【为什么不让渲染层报 lessonId】它是从 key 里拆得出来的
 * （key 才是认题的凭据，见 question-key.ts）。让两边都报一次，
 * 就有了两份真源 —— 哪份错了都**不报错**，只是统计悄悄偏。
 * 主进程拆，拆完顺手把哨兵课号挡在库外。
 */
export interface PracticeRecordItem {
  key: string
  ok: boolean
}

/** `practice:record` 的入参（`at` 和 `id` 由主进程铸） */
export interface PracticeRecordInput {
  mode: string
  items: PracticeRecordItem[]
}

// ---------------------------------------------------------------- 环境检测（env:detect 返回体）

export interface LangEnv {
  found: boolean
  path?: string // 编译器/解释器绝对路径
  version?: string
}

export type EnvReport = Record<LangOfCode, LangEnv>

export interface EnvCache {
  report: EnvReport
  at: string // ISO 检测时间
}

// ---------------------------------------------------------------- 设置（config.json）

/**
 * 主题名。**定义放在 shared 而不是 renderer**，因为它是个**要落盘的配置值**：
 * 主进程的迁移与合并都要校验它，两边各写一份 `'light' | 'dark'` 就是两处漂移。
 * 渲染进程的 `lib/editor-setup.ts` 从这里转出（CodeMirror 那两套语法色按它选）。
 *
 * 【为什么是字符串而不是 `darkMode: boolean`】
 * 布尔只能表达两态。将来要加「跟随系统」时，布尔就得改成字符串 ——
 * 那是一次**数据结构变更**（要 bump version + 写迁移）。
 * 现在多写几个字符，把那次改动省掉。
 */
export const THEME_NAMES = ['light', 'dark'] as const
export type MiThemeName = (typeof THEME_NAMES)[number]

export interface AppConfig {
  version: number
  reviewEnabled: boolean
  runTimeoutSec: number
  /**
   * 音效总开关（M8）。**v1 → v2 新增的字段** —— 老配置文件里没有它。
   *
   * 【为什么这里老老实实走了一遍迁移，而不是像 layout 那样就地补默认值】
   * `layout` 是当年加字段时没 bump version 的历史欠账：它的补齐逻辑写在
   * `normalizeLayout()` 里，每次读配置都跑一遍，能用，但**文件里的 version
   * 永远停在 1**，事后没人看得出这份配置是哪个年代的。这条路不再走第二遍。
   * 见 `shared/config-migrate.ts`：加字段 = bump version + 写迁移函数（铁律 6）。
   *
   * 【为什么默认 true】音效是这个软件的**性格**的一部分，不是可选装饰。
   * 默认关掉的话，绝大多数人一辈子不会去设置页把它打开。
   */
  soundEnabled: boolean
  /**
   * 音效音量（**0~100 的整数**，100 = 原始音量）。**v4 → v5 新增的字段**。
   *
   * 【为什么有了开关还要有音量】开关只能表达"全要 / 全不要"。
   * 主人那几段素材的响度差得很远（三段猫叫里有一段只有别人一半响，
   * 见 `lib/sfx.ts` 的 `SFX_BASE_GAIN`）—— 那种"素材内部不齐"是代码常量能修的；
   * 而"整套音效我都嫌吵"只有用户自己知道，而且他不会为此去改代码常量。
   * 所以给他一个能拨的旋钮。
   *
   * 【为什么是 0~100 的整数，不是 0~1 的小数】它是**要显示给人看的数**
   * （界面上写着"80%"）。存小数就得显示时乘 100、保存时除 100，
   * 两处各有一半机会写错 —— 而写错的表现是音量差 100 倍：一耳朵听得出来，
   * 但顺着声音去查，第一个被怀疑的会是音频文件。存整数就没这道换算。
   *
   * 【默认 100，不是 60 那种"温柔的默认"】默认值决定的是**老用户升级上来
   * 听到什么**。是"和昨天一模一样"，不是"我们替你调小了一点"。
   * 嫌吵他自己拨 —— 那正是这个旋钮存在的意义。
   *
   * 【它和 soundEnabled 的关系】静音有两条路：开关关掉、或者音量拨到 0。
   * 两者都算"闭嘴"，理由见 `lib/sfx.ts` 的 `setSfxVolume()`。
   */
  sfxVolume: number
  /**
   * 主题（夜间模式）。**v2 → v3 新增的字段** —— 老配置文件里没有它。
   *
   * 【默认 light，不是 dark】两条理由：
   *  ① 老用户升级上来时不该发现界面自己变了个样；一份配置写着 version 2、
   *     没有 theme，迁移时给 light，他看到的和昨天一模一样。
   *  ② 主人要的是一个**开关**，不是一个「默认已经变了」的界面 ——
   *     开关默认关着，才有「按下去那一刻的变化」这件事。
   *
   * 【它落在配置里，不落在 localStorage】主题是用户设置的一部分，
   * 和音效、超时是一类东西。放 localStorage 会有两个后果：
   * 用户在设置页改的东西分成两处存（备份/重置/排查都得想两次），
   * 以及主进程的窗口底色永远猜不到该刷成什么色（见 main 里的 backgroundColor）。
   */
  theme: MiThemeName
  /**
   * 原生编译环境（3.0）。**v3 → v4 新增的字段** —— 老配置文件里没有它。
   *
   * 【它究竟改变了什么】应用本来就没有内置编译器，两种模式的差别只有两条：
   *  ① 命令名由**你合并后的 PATH**（进程 PATH + 注册表 HKLM/HKCU 的 PATH）解析，
   *     而不是用环境检测找到的那个绝对路径；
   *  ② 借**真外壳**（cmd.exe）跑，于是 `.bat` / `.cmd` 垫片（scoop 的 shim、
   *     venv 的 activate.bat）也够得着。
   * 它**不是**「开=用本机 / 关=用自带」——那种二分在代码里不成立，
   * 详见 docs/18 §3.1。
   *
   * 【默认 false，方向反于 soundEnabled】音效默认开是「软件的性子」；
   * 这条默认关是「别动用户已有的东西」——开着它意味着每次点运行都多一个弹窗，
   * 而且跑的是**用户自己 PATH 里那个**编译器（版本可能与课文讲的不同）。
   * 这种会改变「代码跑出什么」的开关，必须由用户主动打开。
   */
  nativeRunEnabled: boolean
  /**
   * 原生模式下**不再每次询问**（3.0 后的体验补丁，2026-10-01 主人要求）。
   * **v7 → v8 新增的字段**。
   *
   * 【它是干什么的】true = 「不再问，每趟直接走原生」（`lib/native-confirm.ts`
   * 的 `decideNativeRun` 第二道闸直接返回 true）。**它没有「上次按了哪个
   * 按钮」这种记忆** —— 弹窗里「勾不再提醒 + 用我自己的」才写它；
   * 「勾不再提醒 + 用应用自己的」写的是 `nativeRunEnabled = false`、不动本字段
   * （见 NativeRunConfirm.vue 的 `choose`）。想改回「每次都问」去设置页拨
   * 「每次运行前询问」——那和弹窗勾选框是同一个字段的两个写入口。
   *
   * 【默认 false，方向同 nativeRunEnabled】老配置升级上来必须保持
   * 「每跑一次问一句」——那正是升级前的行为。默认给 true 的话，一个从没
   * 勾过「不再提醒」的用户会发现弹窗自己消失了，代码被交给了另一个编译器，
   * 全程没有任何提示。「替用户省掉一次确认」这种事只能由用户自己点头。
   *
   * 【它和 nativeRunEnabled 是「与」的关系】两个都为 true 才静默走原生；
   * nativeRunEnabled 一关（总闸），这个字段就不再被读到（压根没有询问这回事）。
   */
  nativeRunQuiet: boolean
  /**
   * 本地 IDE 的 exe 路径，**每门语言各一个**（如 C→Dev-C++、Java→VS Code）。
   * **v8 → v9 从单个 `nativeIdePath` 改成的形状**。
   *
   * 【它是干什么的】练习场「本地 IDE 打开」按钮：把当前代码写进临时文件，
   * 再用该语言配的程序把它打开 —— 写盘编码跟随那个程序（见 shared/ide-profiles.ts
   * 的画像表），中文注释到哪儿都不乱码。旧版编码按语言定死，任何一个固定
   * IDE 都乱一半，这次连根拔掉。
   *
   * 【空串 = 这门语言还没配】点「打开」时会先自动检测、按语言推荐一个
   * （renderer/src/lib/ide-detect.ts 的 planIdeChoice），选中即写回这里；
   * 之后想换，去设置页改对应那一行。
   *
   * 【默认四键全空，方向同 nativeRunEnabled】这条决定「点那个按钮会发生
   * 什么」，默认行为必须是「不替用户启动他没点头的程序」——检测到的路径
   * 只在用户点「打开」之后才被采纳。
   */
  nativeIdePaths: Record<LangOfCode, string>
  /**
   * 收藏练习里答错的题，要不要进错题本。**v5 → v6 新增的字段**。
   *
   * 【为什么默认 true】错题本是「我错过的题都在这儿」的地方，全应用
   * 现有的每一种练习（课内/随机/错题重做/挑战）答错都进 —— 收藏练习
   * 没理由是个例外。默认关的话，用户在收藏里错了一串题却一条都没记上，
   * 而他不会想到「收藏」和「练习」两处规矩不一样。
   *
   * 【为什么又给开关】「我就想拿收藏当纯复习清单，不想污染错题本」也是
   * 一种正当用法 —— 但那得他自己开口，不能我们替他默认。
   */
  favWrongToBook: boolean
  /**
   * 三栏布局的宽度与右栏开合。**单位是百分比**，为什么不是像素、
   * 以及「为什么主区不设 size」，见 [shared/layout.ts](./layout.ts) 开头那段。
   */
  layout: LayoutConfig
  ai: {
    apiKey: string
    baseUrl: string
    model: string
    /**
     * AI 动态出题总开关。**v19 → v20 新增的字段**，默认 **false**。
     *
     * 【为什么默认关】AI 出题花的是用户自己的 DeepSeek 余额。哪怕 Key 已经
     * 配好了，也不代表他同意每次挑战都让 AI 现编题 —— 「有 Key」是能力，
     * 「开动态出题」是授权，两者不能合并。老用户升级上来时行为逐字节不变：
     * 仍然只抽本地题库；想尝鲜的人自己去设置页打开。
     *
     * 【它和 hasKey 的关系】两个条件都满足才会走 AI；任一不满足就静默回退
     * 本地题库。关掉开关不需要清 Key，用户随时可以再打开。
     */
    dynamicEnabled: boolean
  }
  envCache: Partial<EnvCache>
  /**
   * 壁纸（动态壁纸引擎移植）。**v9 → v10 新增的块** —— 老配置文件里没有它。
   *
   * 【为什么默认开（enabled: true）】决策点 7 的拍板：默认只垫一层主题双套色的
   * CSS 微渐变（零渲染成本、不改交互），用户自己在设置里选 Steam 壁纸。
   * 完整键表与区间真源在 `shared/wallpaper.ts`（那个文件的头注释写了全设计依据）。
   *
   * v11 → v12 补了四键（transitionDir / objectFit / trackOn / parallax.mascotFollow），
   * 都是上游外观面板移植的调节项，normalizeWallpaper 补默认即可。
   * v12 → v13 动了两处：删掉 v12 的 `parallax.mascotFollow`（主人实测违和）；
   * 新增 `itemProps` / `itemTuning` 两个「按壁纸逐张」的块（壁纸属性面板，
   * 形状与净化都在 shared/wallpaper.ts）。
   */
  wallpaper: WallpaperConfig
  /**
   * 开屏动画。**v13 → v14 新增的块** —— 老配置里没有它。
   *
   * 【拍板记录（2026-10-05，主人批复，全量口径见 docs/24）】默认开、每次
   * 打开软件都放（没有「每天一次」档）；声音默认静音但可调；素材随包内置
   * （`src/renderer/public/splash/` 打包进应用，用户自己的放
   * `<用户目录>/data/splash/`）；窗口默认透明、留一键不透明兜底；
   * 随机播放带素材池多选。
   *
   * 键表与判定真源在 `shared/splash.ts`（decideSplash 是纯函数，
   * 主进程与单测共用同一份判定）。低内存硬底线（<1.5G 自动跳过）
   * **故意不做配置项**，理由见那个文件里 LOW_MEM_GB 的注释。
   */
  splash: SplashConfig
  /**
   * 桌宠（dsh-pet 桌面引擎）。**v16 → v17 新增的块** —— 老配置里没有它。
   *
   * 【口径（2026-10-06 换引擎）】旧的「大肥鱼」宠物窗退役，改用随包的
   * dsh-pet 桌面引擎；这一块只存**三个用户旋钮**（开关 / 体型 / 落点角落）。
   * 引擎自己的运行态（位置、心情、碎碎念计数……）**不进 config**：它们每时
   * 每刻都在变，进 config 就要写迁移，而迁移对运行时刻状态没有意义。
   *
   * 【为什么默认开】方向同 wallpaper / splash 的「新增默认开」：桌宠不弹窗、
   * 不改任何既有交互（主窗最小化它跟着藏）；关掉只是设置页一次点击。
   * 默认值（开 / 462 / 右下角）与 `src/main/dshpet/config.ts` 的
   * PET_SIZE_DEFAULT / PET_CORNER_DEFAULT 同源同值 —— 宿主侧还有一道防御式
   * 归一（normalizePetSettings），坏值钳位与这里同口径。
   *
   * 【键表与净化真源】PET_CORNERS / PET_SIZE_MIN / PET_SIZE_MAX /
   * normalizePetConfig() 全在**本文件**（定义在 AppConfig 下方那段）——
   * 迁移（读口）与保存（写口）共用同一份。为什么不新开 shared/pet-config.ts：
   * 本轮改动不许新建文件；shared/pet.ts 是旧引擎的冻结真源，不动它。
   */
  pet: PetConfig
}

// ---------------------------------------------------------------- 桌宠（v17）

/**
 * 桌宠落点的四个角。**数组顺序 = 设置卡按钮顺序**（左上 → 右上 → 左下 → 右下），
 * 同时是迁移白名单与主进程宿主的共同取值集合。
 */
export const PET_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const

export type PetCorner = (typeof PET_CORNERS)[number]

/**
 * 体型（精灵高度，px）的合法区间。**整数** —— 设置卡滑杆 step=1、
 * normalizePetConfig 里四舍五入，两个口子共用这一对边界。
 *
 * 【为什么是 240 ~ 700】dsh-pet 的素材按高度缩放：再小在高分屏上糊成一块，
 * 再大会盖住正文。区间真源在 `src/main/dshpet/config.ts`（PET_SIZE_MIN /
 * PET_SIZE_MAX，两处必须同值 —— 那边是宿主侧的最后一道钳位）。
 */
export const PET_SIZE_MIN = 240
export const PET_SIZE_MAX = 700

/** 桌宠旋钮的形状（AppConfig.pet）。渲染层设置卡、迁移、主进程宿主共用。 */
export interface PetConfig {
  enabled: boolean
  size: number
  corner: PetCorner
  /**
   * 允许大肥鱼跟随鼠标撒娇（默认开；2026-10-09 补充模块一）。
   * 关掉 = 宿主不再下发跟随目标（会话里的跟随立刻停），被动行为（被点/被喂/
   * 报错跑腿/被拖动）一概不受影响 —— 它只关「主动凑向光标」这一件事。
   * 开源开关之后跟随还有自己的门槛（好感 ≥ PET_AFFECTION_LOVE_AT 或右键菜单
   * 里手动叫它跟）——那些门槛在宿主/大脑，不在这个键上。
   */
  followMouse: boolean
  /**
   * 允许大肥鱼饥饿时活跃乱跑（默认开；2026-10-09 补充模块一）。
   * 它是「自主漫游」的总闸：开着时活跃度随饱腹度分档（饱食照旧、中度迟缓、
   * 重度近乎不动 + 催饭、归零趴窝），关掉 = 完全不自主移动。
   * 实施点在 helper 渲染端（miai-extras 包一层 tryMove），读数经 /miai/flags。
   */
  hungryRoam: boolean
}

/**
 * 默认桌宠设置。工厂函数（同 emptyIdePaths / defaultWallpaper）：**每次新造
 * 一个对象**，别让两份配置共享同一个子块。
 * 取值 = dsh-pet 的包内口径：出场 / 462px / 右下角。
 */
export function defaultPetConfig(): PetConfig {
  return { enabled: true, size: 462, corner: 'bottom-right', followMouse: true, hungryRoam: true }
}

/**
 * 把任意一份「从 config.json 读出来的 pet 块」（可能缺失、可能被手改坏）
 * 净化成合法形状。**永远返回新对象** —— 调用方拿它当进面向 IPC 的替身
 * （响应式代理过不了 structuredClone，整树新造一次同时解决镜像与代理）。
 *
 * 【为什么逐键净化、而不是整体退回默认】坏一个键不该把另外几个好键洗掉，
 * 钳位保留用户意图（口径同 config-merge）。五个键每一道都有理由：
 *   · `enabled` / `followMouse` / `hungryRoam`：只认布尔。`'false'`（字符串）
 *     在 `if` 里是**真**，放进去的表现是「设了关、它还在 / 关不掉」，
 *     且没有任何报错。
 *   · `size`：先 `Number.isFinite`（NaN 能穿过 Math.min/max —— 它跟谁比
 *     都是 false，`Math.max(NaN, 240)` 还是 NaN），再四舍五入（给用户看的
 *     数是整数），再钳区间（9999 会缩成比屏幕还高的精灵）。
 *   · `corner`：只认白名单四个值。放 `'middle'` 过去的话，宿主按 corner
 *     找不到角落，精灵会落在屏幕原点 —— 表现是「改完落点它跑到左上去了」。
 */
export function normalizePetConfig(raw: unknown): PetConfig {
  const d = defaultPetConfig()
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return d
  const o = raw as Record<string, unknown>
  const size =
    typeof o.size === 'number' && Number.isFinite(o.size)
      ? Math.min(Math.max(Math.round(o.size), PET_SIZE_MIN), PET_SIZE_MAX)
      : d.size
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : d.enabled,
    size,
    corner: PET_CORNERS.includes(o.corner as PetCorner) ? (o.corner as PetCorner) : d.corner,
    followMouse: typeof o.followMouse === 'boolean' ? o.followMouse : d.followMouse,
    hungryRoam: typeof o.hungryRoam === 'boolean' ? o.hungryRoam : d.hungryRoam
  }
}

/**
 * 当前配置 schema 版本。
 *
 * 【它到底管什么】`json-store.ts` **不会**读这个字段——它只负责把 JSON 原样
 * 搬进搬出。版本号是给 `migrateConfig()` 看的：它拿文件里的 version 和这里比，
 * 决定要走哪几段搬运。**改 `AppConfig` 的字段就必须把它 +1**（铁律 6）。
 *
 * | 版本 | 改了什么 |
 * |---|---|
 * | 1 | 初版 |
 * | 2 | 加 `soundEnabled`；同时把 layout 那段欠账收进迁移（见 config-migrate.ts） |
 * | 3 | 加 `theme`（夜间模式）；见 config-migrate.ts 里 v2 → v3 那一段 |
 * | 4 | 加 `nativeRunEnabled`（原生编译环境）；见 config-migrate.ts 里 v3 → v4 那一段 |
 * | 5 | 加 `sfxVolume`（音效音量）；见 config-migrate.ts 里 v4 → v5 那一段 |
 * | 6 | 加 `favWrongToBook`（收藏练习答错进错题本）；见 config-migrate.ts 里 v5 → v6 那一段 |
 * | 7 | 加 `nativeIdePath`（本地 IDE 路径，练习场「本地 IDE 打开」用）；见 config-migrate.ts 里 v6 → v7 那一段 |
 * | 8 | 加 `nativeRunQuiet`（原生模式「不再提醒」）；见 config-migrate.ts 里 v7 → v8 那一段 |
 * | 9 | `nativeIdePath`（单值）改为 `nativeIdePaths`（每语言一键，编码跟随该程序）；旧值按 exe 产品名分发；见 config-migrate.ts 里 v8 → v9 那一段 |
 * | 10 | 加 `wallpaper`（壁纸引擎设置块，决策点 7 默认开、只垫渐变底）；见 config-migrate.ts 里 v9 → v10 那一段 |
 * | 11 | 加 `layout.sidebarOpen`（左栏折叠，与右栏 `rightPanelOpen` 对称；老配置由 normalizeLayout 补 true，绝不替用户关上）；见 config-migrate.ts 里 v10 → v11 那一段 |
 * | 12 | `wallpaper` 加四键：`transitionDir` / `objectFit` / `trackOn` / `parallax.mascotFollow`（移植上游外观面板的调节项；全部由 normalizeWallpaper 补默认，无数据结构变更）；见 config-migrate.ts 里 v11 → v12 那一段 |
 * | 13 | `wallpaper` 删 `parallax.mascotFollow`（主人实测违和）；加 `itemProps` / `itemTuning`（「壁纸属性」面板：壁纸自带属性的逐张覆盖值 + 逐张微调；全由 normalizeWallpaper 补默认+净化）；见 config-migrate.ts 里 v12 → v13 那一段 |
 * | 14 | 加 `splash`（开屏动画：总开关/选片方式/素材池/音效开关/音量/铺法/不透明兜底；全由 normalizeSplash 补默认+净化）；见 config-migrate.ts 里 v13 → v14 那一段 |
 * | 15 | `wallpaper.rotation` 加 `pool`（参与轮播的条目 id 列表，空 = 全部；由 normalizeWallpaper 补默认+净化，无数据结构变更）；见 config-migrate.ts 里 v14 → v15 那一段 |
 * | 16 | `wallpaper.sceneFps` 白名单扩到 [15,30,60,120,1000=无上限]（老值原样合法，无需动作）+ `wallpaper.hidden`（隐藏条目 id 列表，隐私功能，缺省 [] = 没隐藏；由 normalizeWallpaper 补默认+净化）；见 config-migrate.ts 里 v15 → v16 那一段 |
 * | 17 | 加 `pet`（桌宠换 dsh-pet 引擎：开关/体型/落点四角三个旋钮；全由 normalizePetConfig 补默认+净化）；见 config-migrate.ts 里 v16 → v17 那一段 |
 * | 18 | 加 `layout.sidebarRail`（左栏三态的中间态「图标窄栏」：open → rail → hidden 循环；normalizeLayout 补 false、并把「关着还带 rail」的脏组合钳掉，不替老用户切态）；见 config-migrate.ts 里 v17 → v18 的那一段 |
 * | 19 | `pet` 加 `followMouse` / `hungryRoam`（两个主动行为开关：跟随鼠标撒娇 / 饥饿时活跃乱跑，缺省全开 = 老行为不含跟随，但开关默认开着不骗人；全由 normalizePetConfig 逐键净化）；见 config-migrate.ts 里 v18 → v19 的那一段 |
 * | 20 | `ai` 加 `dynamicEnabled`（AI 动态出题总开关，默认 **false**：AI 会花用户自己的 Token，只能由用户主动打开）；见 config-migrate.ts 里 v19 → v20 的那一段 |
 */
export const CURRENT_CONFIG_VERSION = 20

/** 默认配置（主进程与渲染进程共用的初始值，避免两处漂移） */
export const DEFAULT_APP_CONFIG: AppConfig = {
  version: CURRENT_CONFIG_VERSION,
  reviewEnabled: true,
  runTimeoutSec: 10,
  soundEnabled: true,
  // 原始音量。理由见 AppConfig.sfxVolume 那段：默认值决定老用户升级后听到什么，
  // 这里必须是"和昨天一样"，不能是"我们替你调小了"
  sfxVolume: 100,
  theme: 'light',
  // 新增功能一律默认关：它会让每次运行多一个弹窗，且换一个编译器跑
  nativeRunEnabled: false,
  // 同一条方向：给 false（继续每次询问）——「不再提醒」只能由用户
  // 在弹窗里勾出来，不能让升级这个动作替他勾上（理由见 AppConfig.nativeRunQuiet）
  nativeRunQuiet: false,
  // 默认四键全空：点「本地 IDE 打开」时先自动检测、按语言推荐，
  // 而不是替用户猜一个 IDE 去启动（方向同 nativeRunEnabled）
  nativeIdePaths: emptyIdePaths(),
  // 这一条反过来、默认开：答错记账是全应用的既有性子，
  // 收藏练习不该是唯一的例外（理由见 AppConfig.favWrongToBook）
  favWrongToBook: true,
  // 展开一层而不是直接把 DEFAULT_LAYOUT 这个对象放进来：
  // 它是共享常量，谁哪天不小心原地改一下默认配置就跟着变了。
  layout: { ...DEFAULT_LAYOUT },
  ai: {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    // 默认关：AI 花的是用户自己的余额，只能由用户主动打开（理由见 AppConfig.ai）
    dynamicEnabled: false
  },
  envCache: {},
  // 工厂函数现造深对象（理由同 emptyIdePaths：别让两份配置共享子块）。
  // 这份默认的数值与区间真源都在 shared/wallpaper.ts。
  wallpaper: defaultWallpaper(),
  // 同款工厂函数；默认值（开/随机/静音/100/contain/透明）的拍板记录
  // 在 AppConfig.splash 与 shared/splash.ts 头注释。
  splash: defaultSplash(),
  // 同款工厂函数；三个默认值（开 / 462 / 右下角）的拍板记录在 AppConfig.pet，
  // 且必须与 src/main/dshpet/config.ts 的 PET_SIZE_DEFAULT / PET_CORNER_DEFAULT 同值。
  pet: defaultPetConfig()
}

/**
 * `config:get` 返回给渲染进程的形状 —— **里面没有 apiKey**。
 *
 * 【为什么 Key 不出主进程】
 * 渲染进程是网页环境。Key 一旦进去，任何一个 XSS、任何一个第三方依赖的
 * 供应链问题，都能把它读走；而它是**用户自己掏钱的东西**，泄露了直接是钱。
 * 主进程拿着它去发请求就够了，界面从头到尾不需要看见真 Key。
 *
 * 【那界面怎么知道「配没配」】
 * 靠 `hasKey` 这个布尔。这里有个坑值得写下来：
 * 光把 apiKey 抹成空串是**不够**的 —— 界面就分不清「没有 Key」和「有 Key 但我不告诉你」，
 * 于是只能一直显示「未配置」，用户明明配好了却看到这个，会以为存失败了。
 * 所以抹掉的同时必须补一个布尔出来。**抹掉一个字段，就得补上界面需要的那一点点信息。**
 */
export type PublicAppConfig = Omit<AppConfig, 'ai'> & {
  ai: Omit<AppConfig['ai'], 'apiKey'> & { hasKey: boolean }
}

/**
 * `config:save` 的入参。**apiKey 是三态，不是两态**：
 *
 * | 传进来的值 | 含义 |
 * |---|---|
 * | 不传 / `''` | **不改**（界面根本不知道真 Key，它回传的永远是空串） |
 * | `null` | **显式删除**（设置页的「清除 Key」） |
 * | 非空字符串 | 设置新 Key |
 *
 * 【为什么必须有第三态】只有「空串 = 不改」和「空串 = 删」两种选择时，
 * 你**永远没法把 Key 删掉** —— 留空保存会被当成「不改」，Key 就永远卡在里面了。
 * 删除必须有一个「界面能表达、而真实 Key 不可能是」的值，`null` 正好。
 *
 * 别的字段照旧整体覆盖，只有 apiKey 走这套规矩。
 */
export type ConfigSavePayload = Omit<AppConfig, 'ai'> & {
  ai: Omit<AppConfig['ai'], 'apiKey'> & { apiKey?: string | null }
}

// ---------------------------------------------------------------- AI（M6）

/**
 * AI 请求失败的原因。**每一个取值都要能翻成一句人话**（在 copy.ts 里），
 * 因为用户看到的不能是「请求失败」，而是「Key 好像不对喵」。
 *
 * 刻意分得比较细：`unauthorized`（Key 错）和 `quota`（余额不足）
 * 对用户的下一步动作**完全不同**——一个要去改 Key，一个要去充值。
 * 合成一个「失败了」等于把人晾在原地。
 */
export type AiFailReason =
  /** 没配 Key。这不是错误，是「还没开这个功能」，界面该引导去设置页 */
  | 'no-key'
  /** 「AI 动态出题」总开关关着。不是故障，是用户没授权花自己的 Token */
  | 'disabled'
  /** Key 无效或被拒（HTTP 401/403） */
  | 'unauthorized'
  /** 余额不足 / 触发限流（HTTP 402/429） */
  | 'quota'
  /** 连不上：断网、DNS 失败、代理拦了 */
  | 'offline'
  /** 30 秒没回话 */
  | 'timeout'
  /** 用户自己点了取消 */
  | 'canceled'
  /** 对方服务器出问题（HTTP 5xx） */
  | 'server'
  /** 回来了，但不是我们要的形状：不是 JSON、没有 choices、内容是空的、
   *  或者出的题一条都没通过校验 */
  | 'bad-response'

/**
 * AI 请求的结果。**用返回值表示失败，不抛异常。**
 *
 * 【为什么不像 runner:run 那样抛错】
 * `runner:run` 抛错是因为「入参非法」属于**程序员写错了**，就该炸得响亮。
 * 而 AI 失败（断网、Key 过期、余额用完）是**预期内的正常路径** ——
 * docs/03 A7 明令「不得弹失败弹窗或阻塞操作」。
 * 抛错会逼着每一个调用点写 try/catch，漏掉一个就是白屏。
 */
export type AiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      reason: AiFailReason
      /**
       * 给排查用的原始信息（HTTP 状态码、接口返回的 message）。
       * **不是给用户看的文案** —— 界面上要显示的是 reason 翻出来的那句人话。
       * 留着它是因为「Key 明明是对的怎么还说不对」这种问题，
       * 只看 reason 根本没法查。
       */
      detail?: string
    }

/**
 * 出题时要考的一课：**给 AI 的输入**（不是给用户看的）。
 *
 * 形状定在这里而不是 ai-prompt.ts，是因为它同时是 `ai:generate-questions`
 * 的 IPC 入参 —— 渲染进程要按这个形状组装，主进程要按这个形状接。
 * 两边各写一份的话，改了一边另一边**不会报错**，只会在运行时少几个字段。
 */
export interface AiTopicInput {
  lessonId: string
  title: string
  tags: string[]
  /** 这一课**已经出过的**题干。既是防重复清单，也是风格样例 */
  stems: string[]
}

/** `ai:explain` 的入参（渲染进程 → 主进程） */
export interface AiExplainInput {
  lang: LangOfCode
  code: string
  error: string
  /** 术语表。由渲染进程给 —— 内容包本来就在渲染进程手里，主进程没必要再读一份 */
  terms: GlossaryTerm[]
}

/** `ai:generate-questions` 的入参（渲染进程 → 主进程） */
export interface AiGenerateInput {
  topics: AiTopicInput[]
  count: number
  terms: GlossaryTerm[]
  /** 本地日期 `YYYY-MM-DD`，用来拼题目 id。由渲染进程算好传进来，避免两边时区不一致 */
  dateKey: string
}

// ---------------------------------------------------------------- 每日挑战

/**
 * 挑战里的一道题。
 *
 * 【为什么内置题不存本体，只存 key】
 * 存了就有**两份真源**：将来改了内置题，challenge.json 里那份还是旧的，
 * 学员在挑战里看到的题和他在错题本里看到的不一样，而且**没有任何报错**。
 * AI 题没这个问题 —— 它压根不在内容包里，**不存就永远找不回来**，所以只有它存本体。
 */
export interface ChallengeQuestion {
  /** 全局题号 `${lessonId}:${qid}`，和错题本同一套（见 shared/question-key.ts） */
  key: string
  lessonId: string
  qid: string
  /** **只有 AI 现场出的题才有这个字段**。内置题从这里查不到本体就回内容包拿 */
  ai?: Question
}

/**
 * 一道题的作答记录（逐题回顾用）。
 *
 * 【为什么 `ok` 要**存下来**，而不是回顾时拿题干重算】
 * 重算要拿题目本体，内置题的本体在内容包里，而**内容包是会变的** ——
 * M7 要补 191 课，改题干、改答案、改判分分支都会发生。改完之后重算，
 * 会得出一个**和当时不一样**的结果：用户明明记得自己答对了，回顾页却说他错了，
 * 而他没有任何办法证明自己是清白的。
 * 存下来的是「当时判定的事实」，它不会随内容包漂移。
 *
 * 【为什么存 `your`】
 * 光有对错，用户看到的是「你这题错了」—— 那正是他已经知道的事。
 * 他想知道的是「我当时写的是什么」，好和正确答案对上。
 */
export interface ChallengeAnswer {
  /** 用户当时答的：选择题是下标（0 起），填空/代码是原样字符串 */
  your: string | number | null
  /** 当时判的对不对 —— 为什么不重算，见上 */
  ok: boolean
}

/** 某一天的挑战批次 */
export interface ChallengeDay {
  dateKey: string
  /** 这批题哪来的：本地题库抽的，还是 AI 现出的 */
  source: 'local' | 'ai'
  /**
   * 开赛前勾选的语言（按 `LANGS` 声明序、**不含 common** —— 通用题恒含、
   * 不参与勾选，见 stores/challenge.ts 的 `poolLangs`）。
   *
   * 【为什么存下来】挑战结算是要上行到服务器的，这是**契约字段**：
   * 服务端据此知道这一局是在哪几门语言的范围内出的题（AI 段同样按勾选
   * 过滤过 topics）。v3 起写入；v3 之前画的批次没有它，选填。
   */
  pickedLangs?: Lang[]
  /**
   * 当天抽出的一整批题（2026-10-10 晚 v3 起 = **整个已学题库**的抽取结果，
   * 最前面拼 AI 段 20 道；服务端健全性上界 `CHALLENGE_RUN_MAX` = 5000）。
   *
   * 【它是「出题记录」，不是「做过的题」】挑战是「答对继续、答错即停」：
   *   - 中途退出（没收工）：这里留着整批 —— `lastSeenOf` 靠它防
   *     「昨天刚考的今天又考」，抽过的都算「出过」；
   *   - 收工那一刻：watcher 把它和 `answers` **按游玩序成对重写**为做过的
   *     前缀（v3 修错位 bug 的同一刀，见 stores/challenge.ts）—— 答错即停后
   *     没见到的题不再算「出过」，明天抽到它们对用户就是全新题。
   */
  questions: ChallengeQuestion[]
  createdAt: string
  finishedAt: string | null
  /**
   * 收工分数。
   *
   * `points` / `pointsMax` 是 2026-10-10 积分制改版新增的（v3 起 = 纯难度分，
   * 语言权重全 100；公式唯一一份在 cloud/protocol.ts 的 `weightedPoints`）：
   * `points` = 答对题的分数和，`pointsMax` = 做过的题的满分数和。**选填** ——
   * 改版前存下的批次没有这两个数，读口按「没有就不显示积分行」处理，
   * 不许拿 0 顶替（「0 分」和「当时没有积分制」是两件事）。
   */
  score: { correct: number; total: number; points?: number; pointsMax?: number } | null
  /**
   * 每题当时的作答。
   *
   * 【和 `questions` 的关系：前缀，且 v3 起收工即对齐】
   * 一开始（逐题回顾上线时）这里是全量、与 `questions` 按下标一一对应；
   * 「答错即停」改版后只存**真正作答过的前缀**，没做到的题不该有一条
   * 「作答记录」（否则回顾页会出现一道他没见过的题、还标着红叉）；
   * v3 起收工那一刻 questions 与 answers **成对重写为同长的做过的前缀**
   * （修掉 v2「游玩序 answers 配存档序 questions」的错位，见收工 watcher）——
   * 所以只有「在做、没收工」的批次才可能出现 answers 短于 questions。
   * 读口一律按前缀语义处理：`answers[i]` 缺失 = 没做到，跳过不显示。
   *
   * 【为什么是选填的】
   * 这个字段是「逐题回顾」上线之后才有的，在那之前存下的批次没有它。
   * 渲染进程靠 `answers == null` 分辨「这批没留作答记录」，**不显示回顾入口**；
   * 绝不能把「没有记录」当成「全答错了」显示出来 —— 那是在冤枉用户。
   */
  answers?: ChallengeAnswer[]
  /**
   * 存档格式版本。2 = v3 起的**收工成对重写**格式：`questions` 与 `answers`
   * 同长、同序、按下标一一配对（收工那一刻按游玩序重写为做过的前缀）。
   *
   * 缺省（无此字段）视为 1 = v2 老存档：questions 是整批、answers 是游玩序，
   * 题/答错位**不可回溯**（v2 的事故现场，洗过牌就配不上）。回顾页对老格式
   * 降级为空（见 stores/challenge.ts 的 `reviewRows` / `oldArchive`）；
   * 分数与 `stoppedEarly` 不受影响 —— 那两个数不依赖题/答配对。
   */
  format?: number
  /**
   * 「已提交」标记（P10.6 ⑤，2026-10-11）：收工单**被主进程确认入队**
   * （写进 `.sync/pending-ops.json`）的时刻。缺省 = 还没交出去。
   *
   * 【它是崩溃窗口的兜底判据】收工 → 入队落盘之间进程猝死/强退，这个字段
   * 不会写上，下次挑战页读档时 `ChallengeToday.unsent` 会把这天挑出来补交
   *（重复入队由主进程按 dateKey 去重，服务端对已结算日回 409 —— 两层都安全）。
   * 写入只发生在**主进程确认之后**（见 stores/challenge.ts 的 submitSettle）：
   * 确认前写上就等于把这一天扔了 —— 标记在 = 不再补交。
   */
  submittedAt?: string
}

/**
 * `challenge.json` 的根。
 *
 * 【为什么 days 只留最近 30 天】
 * 两个需求用的是同一份数据，所以一起解决：
 *   1. 抽题时「排除最近 30 天出过的题」，靠它算出排除清单；
 *   2. 文件不能无限长 —— 每天加一批，一年就是 365 批。
 * 单独存一份「出过的题」清单是多余的：这里本来就有。
 */
export interface ChallengeRecord {
  version: number
  /** 键是本地日期 `YYYY-MM-DD` */
  days: Record<string, ChallengeDay>
}

/** 挑战批次里最多留几天。滚出这个窗口的批次会被裁掉（裁剪在主进程做） */
export const CHALLENGE_KEEP_DAYS = 30

export const DEFAULT_CHALLENGE_RECORD: ChallengeRecord = { version: 1, days: {} }

/**
 * `challenge:get` 的返回体：渲染进程抽题需要的**全部**历史信息。
 *
 * 【为什么不是直接把整份记录发过去】
 * 渲染进程要的其实只有三样：今天那批、「哪道题最近什么时候出过」、
 * 以及**收工了却没交出去的批次**（P10.6 ⑤ 补交通道，`unsent`）。
 * 把 30 天的**题目本体**（v3 起每天可达整池几千道、带代码和解析）整份发过去，只为了算一张
 * 日期表，白白多传几十 KB；而渲染进程拿到全量记录之后，
 * 迟早会有人图省事直接改它 —— 那份「30 天裁剪」的责任就漏到 UI 里去了。
 *
 * 【为什么合成一次调用】
 * 分成两条通道的话，两次调用之间记录可能被改（比如另一个窗口做完了题），
 * 于是「今天那批」和「排除清单」来自两个不同的时间点 —— 这种不一致
 * 不报错，只是偶尔抽出一道昨天刚出过的题。补交清单同理：与今天那批
 * 必须来自同一次读，分两次读就可能把刚标记上的那天又补一遍。
 */
export interface ChallengeToday {
  day: ChallengeDay | null
  /** 题号 → 它**最后一次**出现的日期（`YYYY-MM-DD`）。从没出过的不在这个表里 */
  lastSeen: Record<string, string>
  /**
   * 已收工但**还没写上「已提交」标记**的批次（P10.6 ⑤），按 dateKey 升序。
   *
   * 正常情况是空的；非空 = 上一次「收工 → 入队落盘」之间进程没走完
   * （猝死/强退），或归档来自标记上线之前。渲染层读档时逐条补交。
   *
   * 【这里只给形状事实，不给业务口径】「哪些批次**能**补交」（format < 2
   * 的老档题/答配对不可信，不补）是渲染层的保守规则，与 reviewRows 同一口径
   * —— 主进程不抄第二份，免得两处漂移。
   */
  unsent: ChallengeDay[]
}

// ---------------------------------------------------------------- 运行器（IPC）

export interface RunRequest {
  lang: LangOfCode
  code: string
  stdin?: string
  timeoutSec?: number
  /**
   * 这次运行走**原生模式**（3.0）：命令名交给你 PATH 解析、借 cmd.exe 跑。
   *
   * 【为什么是「这次」而不是「读配置自己判断」】
   * 弹窗问的是**这一趟**用不用原生（用户点「运行」时选的），主进程必须
   * 照着这一趟的答复跑，而不是回头去看此刻的配置——两者可能不一样
   * （用户在半秒前刚把开关关掉），那时候「按配置跑」等于**背着用户换了个编译器**，
   * 而用户以为自己选的是原生。
   *
   * 配置里的 `nativeRunEnabled` 只当**闸门**用：没开开关却收到 `native: true`
   * 一律抛错（见 main/index.ts），防止旧渲染层或手工 IPC 绕开它。
   */
  native?: boolean
}

export interface RunResult {
  ok: boolean
  phase: 'compile' | 'run' // 失败发生在编译期还是运行期（错误库匹配按此分流）
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  truncated: boolean
  durationMs: number
  message?: string // 环境级/结构级错误的猫咪提示（如未安装编译器、Java 没有 class）
  /**
   * 这次失败是**环境问题**（编译器没装、路径不对），而不是代码写错。
   *
   * 为什么要单开一个字段、而不是让界面去比对 message 的内容：
   * message 是会改的用户文案，界面拿它做判断，等于把「显示什么」和
   * 「怎么处理」绑死在一起——哪天把「翻译官喵」改成别的说法，
   * 「去设置页」的引导按钮就会**静默消失**，不报错、没人发现。
   * 凡是界面要据以分支的东西，都得是结构化字段。
   */
  envIssue?: boolean
  /**
   * **编译成功**、但编译器仍然说了话（`-Wall` 的告警等）。
   *
   * 为什么要单开一个字段、而不是并进 `stdout`：
   * 判分是拿 `stdout` **逐字比**的，往里掺一行告警，学员就会看到
   * 「代码明明写对了却判错」，而且极难查（肉眼看输出一模一样）。
   * 告警是**给人看的**，不是判分依据，所以必须走自己的通道。
   *
   * 实测：458 次成功编译里有 48 次仍往 stderr 吐了诊断；
   * 另有 12 次退出码为 0 的运行往 stderr 写了字。在这一条之前，
   * 这些字全部被丢掉——而好几篇课文正讲着「翻译官喵会嘀咕一句 warning: …」。
   */
  compileWarnings?: string
  /**
   * 这次结果是**原生模式**跑出来的，以及用的是哪条命令、解析到了哪个真实文件。
   *
   * 【为什么必须是结构化字段，不能塞进 stdout】
   * 判分是拿 stdout **逐字比**的。往它前面加一行「原生模式：gcc → …」，
   * 学员立刻会看到「代码写对了却判错」，而且两段输出在屏幕上长得一模一样，
   * 极难查（同 `compileWarnings` 里记的那条教训）。
   * 它是给人看的一句话，走自己的通道。
   *
   * 【resolved 为什么可能没有】`where` 找不到时就没有它 —— 但那种情况
   * 根本跑不到「有结果」这一步（工具缺失是 `ok:false`）。
   * 留成可选是为了「找到了、但预检这一步自己坏了」时也能如实出结果。
   */
  native?: {
    /** 实际用的命令名（`gcc` / `g++` / `javac` / `python`） */
    command: string
    /** `where` 解析到的第一个绝对路径 */
    resolved?: string
    /**
     * `resolved` 落在**应用自管的工具链目录**里（`install-plan.ts` 的
     * `TOOLCHAIN_ROOT`，一键安装时被写进用户 PATH）。
     *
     * 【为什么要说这个】输出区那句注脚本来写的是「你自己 PATH 里的」——
     * 可命中自管目录时那是句**误导**：那条目录是安装程序替用户加进去的，
     * 用户会把它当成「我自己装的编译器」，排查环境问题时方向全错。
     * 判定在 native.ts 的 `isManagedPath`（展开 %LOCALAPPDATA% 再比前缀）。
     */
    managed?: boolean
  }
}
