import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type {
  AiChatDeltaPayload,
  AiChatDonePayload,
  AiChatHistoryView,
  AiChatStartInput,
  AiChatStartResult,
  AiExplainInput,
  AiGenerateInput,
  AiResult,
  ChallengeDay,
  ChallengeToday,
  CheckinSubmitResult,
  ConfigSavePayload,
  EnvReport,
  ExportCodeResult,
  FavoritesFile,
  GallerySaveResult,
  IdeDetectResult,
  IdeOpenResult,
  LangOfCode,
  MemoFile,
  PickExeResult,
  PracticeFile,
  PracticeRecordInput,
  ProfileRewards,
  PublicAppConfig,
  RewardOverridesInfo,
  RunRequest,
  RunResult,
  UserProfile,
  WrongBookEntry,
  WrongRecordItem,
  WrongUpdateItem
} from '../shared/types'
import type { AiParseResult } from '../shared/ai-question'
import type { BoxStamp, DocWriteResult, StampedDoc } from '../shared/doc-write'
import type { WallpaperCatalog, WallpaperPropsResult, WallpaperWindowState } from '../shared/wallpaper'
import type { MediaImportResult } from '../shared/media-import'
import type { SplashMaterialRef, SplashTimeline } from '../shared/splash'
import type { PetAction, PetRunReport, PetSnapshot, PetWorkRect, AppNavPayload } from '../shared/pet'
import type {
  Account,
  AvatarBatchView,
  AvatarPickView,
  AvatarUploadResponse,
  CloudAccountState,
  CloudActivateInput,
  CloudActivatePreviewView,
  CloudActivateView,
  CloudAuthView,
  CloudCredentials,
  CloudRegisterInput,
  CloudResult,
  CloudSessionView,
  ChallengeSettlePayload,
  LeaderboardResponse,
  OptInResponse,
  RecoverQuestionRequest,
  RecoverQuestionResponse,
  RecoverResetRequest,
  RecoverResetResponse,
  RecoverVerifyRequest,
  RecoverVerifyResponse,
  SyncRoundResult,
  UplinkResult
} from '../shared/cloud/dto'
import type { LeaderboardPeriod } from '../shared/cloud/protocol'
import type { RewardGrantKind } from '../shared/gallery'

/**
 * renderer 唯一能接触的系统能力白名单。
 * 后续所有新能力（env/runner/practice/review/ai）都在这里追加，
 * renderer 永远拿不到 ipcRenderer / node 原生对象。
 */
const miai = {
  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.appGetVersion),
  /**
   * 读档案（P10.6 起**带戳**）：`data` 是档案本体（null = 还没建过），
   * `stamp` 是 `{epoch, rev}` —— 渲染层收着，下一次 `saveProfile` 原样带回。
   * 戳对不上（在途保存撞上账号切换 / 别的写口动过）主进程会拒写并回最新数据，
   * 由渲染层的本地写协议执行器做「重载 + 重放」（docs/21 §8.2）。
   */
  getProfile: (): Promise<StampedDoc<UserProfile | null>> => ipcRenderer.invoke(IPC.profileGet),
  /**
   * 整份存档案。**失败是值不是异常**：撞上条件写屏障时返回
   * `{ok:false, code, current, stamp}`（一个字节没写、current = 最新数据），
   * 不匹配时才抛（入参形状问题照旧抛）。`stamp` 不传 = 无条件下写（逃生口，
   * 只有明确知道自己在干嘛的调用点才用它）。
   */
  saveProfile: (
    profile: UserProfile,
    stamp?: BoxStamp | null
  ): Promise<DocWriteResult<UserProfile | null>> =>
    ipcRenderer.invoke(IPC.profileSave, profile, stamp),
  getWrongbook: (): Promise<WrongBookEntry[]> => ipcRenderer.invoke(IPC.wrongbookGet),
  /**
   * 记错题。收的是 `WrongRecordItem[]` 而不是 `string[]` ——
   * **AI 出的题必须把题目本体一起送来**：它不在任何一课里，光有 key
   * 就永远找不回原样，那是一条显示了题干、也消除不掉的死条目（理由见 shared/types.ts）。
   * 内置题**不要**带本体，主进程也会把它丢掉，免得变出第二份真源。
   *
   * 返回**这次「删过又答错」的键**（复活名单，通常为空数组）——
   * 调用方（finish()）拿它弹「这条你删过，又答错了喵」。这个信息只有主进程
   * 合并**之前**能看到（合并会把 removed 字段摘掉，见 findRevivedKeys 的注释），
   * 所以必须随回复带出来；老调用点忽略返回值即可。
   */
  recordWrongbook: (items: WrongRecordItem[]): Promise<string[]> =>
    ipcRenderer.invoke(IPC.wrongbookRecord, items),
  clearWrongbook: (keys: string[]): Promise<void> => ipcRenderer.invoke(IPC.wrongbookClear, keys),
  /**
   * 用户手动动一条错题：软删 / 恢复 / 标知识点漏洞（学习闭环）。
   *
   * 入参是**一批** `{key, patch}`（单条操作就传一个元素的数组）——
   * 「清空错题本」这种批量软删因此能一发做完，而不是 N 次 IPC。
   * 返回**新列表**：调用方直接拿它刷新，省一次 `getWrongbook` 往返，
   * 也就没有「写成功了、读到的还是旧的」这种竞态。
   */
  updateWrongbook: (updates: WrongUpdateItem[]): Promise<WrongBookEntry[]> =>
    ipcRenderer.invoke(IPC.wrongbookUpdate, updates),
  /**
   * 收藏的**题目**（favorites.json）。⚠️ 和 profile 里的**课级**收藏同名不同义：
   * 那个是「收藏的课程」（`UserProfile.favorites`），这个是「收藏的题目」。
   *
   * 整份读 / 整份存（和 profile 那套一样）：这个文件只有渲染层一个写方，
   * 不需要给每条记录开通道。主进程负责清洗（坏文件不丢用户数据）和校形。
   * P10.6 起读写都带条件写戳（形状同 getProfile / saveProfile）。
   */
  getFavorites: (): Promise<StampedDoc<FavoritesFile>> => ipcRenderer.invoke(IPC.favoritesGet),
  saveFavorites: (
    file: FavoritesFile,
    stamp?: BoxStamp | null
  ): Promise<DocWriteResult<FavoritesFile>> => ipcRenderer.invoke(IPC.favoritesSave, file, stamp),
  /**
   * 大肥鱼备忘录（memo.json，P3 ②）。
   *
   * 整份读 / 整份存（和收藏那套一样）：这个文件只有渲染层一个写方。
   * 主进程负责清洗（坏文件不丢用户敲的字）和校形（写错就抛、零字节落盘）。
   *
   * 【为什么这次挂成 `memo.get` / `memo.save` 两个方法】备忘记的东西有两个性子
   * （代码 / 知识），将来同一个功能下多半还会长出别的动作（导出、导入）——
   * 从第一个口子起就给它一个命名空间，比以后从 `getMemoXxx` 改名便宜。
   * 这是全项目第一个命名空间式子对象，其余口子（getFavorites 那批）保持原样不动。
   */
  memo: {
    get: (): Promise<StampedDoc<MemoFile>> => ipcRenderer.invoke(IPC.memoGet),
    save: (file: MemoFile, stamp?: BoxStamp | null): Promise<DocWriteResult<MemoFile>> =>
      ipcRenderer.invoke(IPC.memoSave, file, stamp)
  },
  /**
   * 记一次**做完**的练习（中途退出不记，判分口径是「交完的卷才算数」）。
   *
   * 入参只报 `{mode, items: [{key, ok}]}`：课号由主进程从 key 里拆
   * （key 才是认题的凭据，两边各报一次就有两份真源，错哪份都不报错）。
   * 返回**新的练习史**——每日复习的加权要读它，调用方顺手就能把内存里那份换掉。
   */
  recordPractice: (input: PracticeRecordInput): Promise<PracticeFile> =>
    ipcRenderer.invoke(IPC.practiceRecord, input),
  getPractice: (): Promise<PracticeFile> => ipcRenderer.invoke(IPC.practiceGet),
  /**
   * 发一张奖励图（每天第一次完成复习，学习闭环 §7；2026-10-17 起不看分数）。
   *
   * 【为什么发奖要过主进程】`profile.rewards` 归主进程所有：`saveProfile` 是
   * 整份防抖保存，而主进程**无条件丢弃**入参里的 rewards、一律取磁盘现值。
   * 渲染层自己往档案里 push 一张，下一次保存就被静默抹掉了 —— 必须由主进程
   * 合并写（见 main/index.ts 的 rewards:grant）。
   *
   * 入参 `id` 为 null 表示「图库全收集完了，没有新图」：那一轮全对照样记一笔
   * （perfectPasses +1），只是 gallery 不变。`perfect` = 这一轮是否全对：
   * 判分只有渲染层知道，它只决定全对次数这一个台账，不参与发图裁决。
   * 返回**新的 rewards + 写后的档案戳**（P10.6）：rewards 直接换上，stamp 交给
   * 本地写协议 noteStamp —— 这条 RMW 顶掉了渲染层手里的旧戳，不带回去的话
   * 下一次防抖保存会撞假冲突。
   *
   * `kind` 是这次的结果类别（'granted' | 'full' | 'daily-limit'，见
   * shared/gallery.ts grantReward）：**只有 'granted' 才该弹奖励弹窗** ——
   * full（图库集齐）/ daily-limit（今天已经拿过一张）都只说句话（V1-38 满池不空弹）。
   * 判"今天发过没有"的日子由主进程现取，渲染层送不了。
   */
  grantReward: (
    id: string | null,
    perfect: boolean
  ): Promise<{ rewards: ProfileRewards; stamp: BoxStamp; kind: RewardGrantKind }> =>
    ipcRenderer.invoke(IPC.rewardsGrant, { id, perfect }),
  /**
   * 每日签到（P3 ①）。`day` 是**渲染层算好的** 'YYYY-MM-DD'（"今天"只有
   * 渲染层知道用户时区）；返回 `CheckinSubmitResult`：`awarded=false` =
   * 今天已经签过（幂等，什么都没发生）；`awarded=true` 但 `riceGranted=false`
   * = 签到记下了、大白饭没发出去；`riceGranted=true` 时看 `riceCredited`
   * （真进盒几碗，满仓时为 0；V1-42）决定播报哪句 —— 口径见 types.ts 的注释。
   * `streakReset=true` = 这次把一条连签断掉了（空转[2]）：播报要带一句
   * "从今天重新数起"，别让用户对着卡片从 30 变 1 自己猜。
   * 写盘失败会 throw —— 调用方必须 catch（否则界面卡在"正在签到"）。
   */
  checkinSubmit: (day: string): Promise<CheckinSubmitResult> =>
    ipcRenderer.invoke(IPC.checkinSubmit, day),
  /**
   * 把一张奖励图另存到用户选的位置。**只传 id**：图在哪、叫什么由主进程
   * 自己找（打包后文件名带哈希，dev 与打包版路径不同，这条缝渲染层看不见）。
   *
   * 用户取消保存**不是错误**：返回 `{ok:false, reason:'cancelled'}`，
   * 不抛异常（照 AI 那套"失败即值"的语义）。
   */
  saveRewardImage: (id: string): Promise<GallerySaveResult> =>
    ipcRenderer.invoke(IPC.gallerySaveImage, { id }),
  /**
   * 读奖励图覆盖映射（2026-10-16）：`<数据目录>/rewards` 里用户丢进来的
   * gNN 图 → 渲染层拿它替换图鉴/奖励弹窗的显示（lib/reward-overrides.ts）。
   * 目录不存在 = 空映射（**不是错误**，就是「还没丢过图」）。
   */
  rewardOverrides: (): Promise<RewardOverridesInfo> =>
    ipcRenderer.invoke(IPC.rewardsOverridesGet),
  /**
   * 打开奖励图覆盖文件夹（设置页）。目录不存在由主进程先建 —— 第一次点
   * 就得到空文件夹。返回 `{ok, reason}`（失败即值，不抛）。
   */
  openRewardFolder: (): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke(IPC.rewardsOpenFolder),
  /**
   * 读设置。**返回体里没有 apiKey**，只有一个 `hasKey` 布尔 ——
   * 真 Key 留在主进程，渲染进程从头到尾看不见它（理由见 shared/types.ts）。
   */
  getConfig: (): Promise<PublicAppConfig> => ipcRenderer.invoke(IPC.configGet),
  /**
   * 存设置。入参里的 `ai.apiKey` 是**三态**：
   * 不传 / `''` = 不改；`null` = 删；非空 = 设新的。
   * 所以这里收的是 `ConfigSavePayload` 而不是 `AppConfig` —— 类型上就写明了
   * 「你没带 Key 是正常的」，免得哪天有人为了类型对齐，把真 Key 从界面回传一次。
   */
  saveConfig: (config: ConfigSavePayload): Promise<void> =>
    ipcRenderer.invoke(IPC.configSave, config),
  detectEnv: (): Promise<EnvReport> => ipcRenderer.invoke(IPC.envDetect),
  /**
   * 编译并运行一段代码。**这是渲染层唯一能执行代码的入口**——
   * 编译、超时、杀进程这些事全在主进程做，渲染层拿到的是一个结果对象。
   *
   * 主进程会在两种情况下抛错（而不是返回 ok:false 的结果）：
   * 入参不合法、代码超过 200KB。所以调用方**必须 try/catch**，
   * 否则界面会卡在「正在运行中」不动。
   */
  runCode: (req: RunRequest): Promise<RunResult> => ipcRenderer.invoke(IPC.runnerRun, req),

  // ---- AI（M6-04）
  //
  // **AI 请求本身失败不会抛错**，它是一个正常的返回值（`{ ok: false, reason }`）——
  // 断网、Key 过期、余额不足都是使用 AI 的日常，不该逼每个调用点写 try/catch，
  // 理由见 shared/types.ts「为什么不像 runner:run 那样抛错」。
  //
  // 但**入参形状不对会抛**（和 runCode 同一个规矩）：那说明是我们自己传错了，
  // 把它翻译成「AI 服务异常」会让用户去查网络，而真正坏掉的是我们这边的数据。
  // 调用方仍然要 try/catch —— 只是该 catch 的是「我传错了」，不是「AI 挂了」。

  /** 让 AI 讲讲这段报错是什么意思。等多久由主进程管（30 秒超时） */
  aiExplain: (input: AiExplainInput): Promise<AiResult<string>> =>
    ipcRenderer.invoke(IPC.aiExplain, input),

  /** 让 AI 现场出题。回来的题**已经过校验、能直接判分**，坏数据在那边就丢掉了 */
  aiGenerateQuestions: (input: AiGenerateInput): Promise<AiResult<AiParseResult>> =>
    ipcRenderer.invoke(IPC.aiGenerateQuestions, input),

  /** 设置页的「测试连接」：一次验完 Key、服务地址、模型名三样 */
  aiTestConnection: (): Promise<AiResult<{ model: string }>> =>
    ipcRenderer.invoke(IPC.aiTestConnection),

  /**
   * 掐掉在飞的 AI 请求（真的 abort，不是假装不看了）。
   * 没有请求在飞时调用它是安全的，什么都不会发生。
   *
   * 【P1 起可带 requestId】（docs/27 §8.1「扩展 1 条」）：
   *   · 带 id → 只掐那一条侧栏对话（侧栏自己的取消按钮必须带，否则会误伤出题）；
   *   · 不带 → 取消全部（旧调用点的原样行为：那时候"全部"就等于"现在那一个"）。
   */
  aiCancel: (requestId?: string): Promise<void> =>
    ipcRenderer.invoke(IPC.aiCancel, { requestId }),

  // ---- AI 侧栏对话（P1，docs/27 §8）
  //
  // 【形状为什么和上面三条不一样】那三条是"问一句、等一整段回来"；
  // 这条是**立刻回 requestId、正文走事件**。等整段回来的话，界面连
  // "正在输入"都画不出来（invoke 会挂到模型说完，20~120 秒）。
  //
  // ⚠️ 红线（docs/27 §3.4 / §12.3）：renderer **不许**自己 fetch / EventSource
  // 去打模型接口。Key 在主进程，出网也在主进程 —— 这里是把流"搬"进来的唯一入口。

  /**
   * 开一条对话。`accepted:false` 表示这次根本没发出去（`reason`: busy / throttled /
   * no-key…），界面据此直接说一句人话，不用等一个永远不会来的增量。
   */
  aiChatStart: (input: AiChatStartInput): Promise<AiChatStartResult> =>
    ipcRenderer.invoke(IPC.aiChatStart, input),

  /**
   * 订阅正文增量。**契约同 onWallpaperState**：回调只收载荷（绝不把
   * IpcRendererEvent 泄给渲染层 —— 它带着 sender 等原生对象），返回退订函数。
   *
   * 【订阅前就开跑会丢增量】所以顺序必须是"先订阅、再 aiChatStart"；
   * 万一真丢了，`onAiChatDone` 那条一定会到，界面不会卡死（只是少了几个字）。
   */
  onAiChatDelta: (cb: (p: AiChatDeltaPayload) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: AiChatDeltaPayload): void => cb(p)
    ipcRenderer.on(IPC.aiChatDelta, listener)
    return () => {
      ipcRenderer.removeListener(IPC.aiChatDelta, listener)
    }
  },

  /**
   * 订阅收尾（成功 / 失败 / 取消都走这一条）。契约同上。
   *
   * 【它必须最后到、且一定会到】界面的"正在输入"只在这一条里复位 ——
   * 少了它，界面会永远停在输入中（docs/27 §12.7 点名的那条坑）。
   */
  onAiChatDone: (cb: (p: AiChatDonePayload) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: AiChatDonePayload): void => cb(p)
    ipcRenderer.on(IPC.aiChatDone, listener)
    return () => {
      ipcRenderer.removeListener(IPC.aiChatDone, listener)
    }
  },

  /** 读会话历史（跨重启，最多 200 条）。文件坏掉时是空列表 —— 不是错误 */
  getChatHistory: (): Promise<AiChatHistoryView> => ipcRenderer.invoke(IPC.aiChatHistory),

  /** 清空会话历史（连磁盘一起清，否则下次启动历史会"复活"） */
  clearChat: (): Promise<void> => ipcRenderer.invoke(IPC.aiChatClear),

  /**
   * 读某天的挑战批次**和抽题要用的排除清单**（见 types.ts 的 `ChallengeToday`）。
   *
   * 两个一起给，是因为抽题时两样都要用，而分两次拿会有个缝：
   * 中间记录被改了的话，「今天那批」和「排除清单」就来自两个时间点。
   * `day` 为 `null` 表示今天还没抽过 —— **不是错误**，该去抽一批新的。
   */
  getChallenge: (dateKey: string): Promise<ChallengeToday> =>
    ipcRenderer.invoke(IPC.challengeGet, dateKey),

  /**
   * 写回**一天**。合并进 `days` 并裁掉 30 天以外的都由主进程做，
   * 渲染进程不需要（也不该）知道文件整体有多大。
   *
   * 入参是**整天的快照**（抽完题存一次、做完题带着分数再存一次），
   * 不是增量 —— 增量合并要处理「字段这次没传是表示不改还是不想要了」，
   * 而这里根本没有那种歧义：一天的数据就那么多。
   */
  saveChallenge: (day: ChallengeDay): Promise<void> =>
    ipcRenderer.invoke(IPC.challengeSave, day),

  // ---- 本地 IDE 联动（2026-10-01）：练习场「本地 IDE 打开 / 导出并复制路径」+ 设置页选程序
  //
  // 三条都是**失败即值，不抛**（没配置 / 程序不在 / 用户取消都是日常），
  // 只有「我们传错了形状」才抛 —— 调用方仍要 try/catch，但该 catch 的是后者。

  /** 弹「选一个程序（.exe）」的对话框。用户取消 → `{ok:false, reason:'cancelled'}` */
  pickExePath: (): Promise<PickExeResult> => ipcRenderer.invoke(IPC.dialogPickExe),

  /**
   * 用本地 IDE 打开这段代码（exe **不在入参里**：主进程从配置现读）。
   * 返回值三态 unconfigured / missing / failed 的下一步各不相同，见 IdeOpenResult。
   *
   * `own`（2026-10-06）：这段代码是不是用户自己写的（渲染层种子比对的判定）。
   * 主进程用它决定要不要挂**编译观察**（编译成功后给桌宠发运行奖）——
   * 官方示例代码原样打开/导出不挂表，跑它不给奖励。缺省（不传）= false。
   */
  openInIde: (input: { lang: LangOfCode; code: string; own?: boolean }): Promise<IdeOpenResult> =>
    ipcRenderer.invoke(IPC.runnerOpenIde, input),

  /** 导出代码到临时文件，返回文件路径。**剪贴板由渲染层自己碰**（主进程不掺和） */
  exportCode: (input: { lang: LangOfCode; code: string; own?: boolean }): Promise<ExportCodeResult> =>
    ipcRenderer.invoke(IPC.runnerExportCode, input),

  /**
   * 自动检测本机装了哪些 IDE（设置页 / 练习场「🔍 自动检测」）。
   * **只探测、不保存** —— 选中哪一个后由渲染层照常走 saveConfig。
   */
  detectIde: (): Promise<IdeDetectResult> => ipcRenderer.invoke(IPC.runnerDetectIde),

  // ---- 动态壁纸（docs/23；P3 步 1 只用到前两条的「列 + 状态」）
  //
  // `miai-wall://` 协议不在这一层：它是主进程里注册的 scheme，渲染层直接把
  // URL 拼进 `src=`（URL 拼法见 renderer/src/lib/wallpaper/url.ts），不经过
  // preload —— 没有需要包一层的 IPC 语义。

  /**
   * 列出本机壁纸（Steam 工坊 + WE 自带 projects）。
   *
   * 返回 `WallpaperCatalog`：**失败即值**（没装 Steam 时 `available: false`
   * + 空列表，不抛）—— 没装是完全正常的使用形态，不该逼调用方 try/catch。
   * 首次调用会现扫（注册表探针 + 逐目录读 project.json），主进程侧带 TTL 缓存。
   *
   * `force=true` 穿透主进程的 TTL 立刻重扫（选择弹窗的「刷新」按钮走这条）。
   */
  listWallpapers: (force = false): Promise<WallpaperCatalog> =>
    ipcRenderer.invoke(IPC.wallpaperList, force === true),

  /**
   * 读一张壁纸的自带属性**原文**（「壁纸属性」面板 Section A 的数据源）。
   *
   * 返回 `WallpaperPropsResult`：`project` 是给 shared 解析器
   * （wallpaper-props.ts）吃的「最小 project 壳」
   * `{ general: { properties[, localization] } }` —— 原文，未解析；解析与
   * 覆盖值合并都在渲染层做（解析器只有 shared 一份实现，不许漂移）。
   * 条目不存在 / 文件读不到 / JSON 坏了时 `project` 为 null（**失败即值**，
   * 不是错误）。调用频率 = 打开属性页签 / 换一张壁纸，渲染层自带按 itemId 的缓存。
   */
  readWallpaperProps: (itemId: string): Promise<WallpaperPropsResult> =>
    ipcRenderer.invoke(IPC.wallpaperProps, itemId),

  /**
   * 导入一张**自定义壁纸**（设置页 → 壁纸 → 导入按钮，2026-10-06）。
   *
   * **无入参**：文件路径由主进程弹系统对话框现选（让渲染层传路径 = 一条
   * 「任意文件拷进数据目录」的通道）。用户取消 → `{ok:false, reason:'cancelled'}`，
   * 不是错误。成功时主进程已强制重扫清单 —— 调用方紧跟着 `listWallpapers()`
   * 就能看到新条目（重名会自动加序号，成功返回的是**实际落盘的文件名**）。
   */
  importWallpaper: (): Promise<MediaImportResult> => ipcRenderer.invoke(IPC.wallpaperImport),

  /**
   * 订阅窗口原生状态（失焦/最小化/隐藏）—— **本工程第一条推送订阅**。
   *
   * 【契约，后来者照抄】① 回调**只收载荷**：绝不把 IpcRendererEvent 泄给
   * 渲染层（它带着 sender 等原生对象，是 CSP 边界上的一条缝）；② 返回**退订函数**
   * ——组件卸载时调它，否则热重载几次就攒出一串幽灵监听器（每一个都在
   * 对着已销毁的组件闭包改状态）；③ 订阅只收增量，**首帧状态走 getWallpaperState**
   * （did-finish-load 的强制推发生在本订阅建立之前，那一刻没有任何人在听）。
   */
  onWallpaperState: (cb: (s: WallpaperWindowState) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, s: WallpaperWindowState): void => cb(s)
    ipcRenderer.on(IPC.wallpaperState, listener)
    return () => {
      ipcRenderer.removeListener(IPC.wallpaperState, listener)
    }
  },

  /** 读一次当前窗口状态（订阅建立前的首帧兜底，载荷与推送完全相同） */
  getWallpaperState: (): Promise<WallpaperWindowState> => ipcRenderer.invoke(IPC.wallpaperStateGet),

  /**
   * 订阅「把主窗拉到设置页某张卡」的导航指令（桌宠菜单的一键直达，
   * `AppNavPayload`）。契约同 onWallpaperState：回调只收载荷、返回退订函数。
   * 【为什么是推送不是拉取】发起方是桌宠窗的一下右键点击 —— 没有"首帧
   * 兜底"这回事（错过就错过了，不是状态而是事件），所以只有订阅口。
   */
  onAppNav: (cb: (p: AppNavPayload) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: AppNavPayload): void => cb(p)
    ipcRenderer.on(IPC.appNav, listener)
    return () => {
      ipcRenderer.removeListener(IPC.appNav, listener)
    }
  },

  // ---- 开屏动画（docs/24，2026-10-05）

  /**
   * 订阅开屏时间线（开屏收场时主进程推一条，载荷 `SplashTimeline`）。
   * 契约同 onWallpaperState（回调只收载荷、返回退订函数）；渲染层把它挂在
   * `window.__splashStats` 上，探针按这个读口取 P2 定标的真时间戳。
   */
  onSplashStats: (cb: (s: SplashTimeline) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, s: SplashTimeline): void => cb(s)
    ipcRenderer.on(IPC.splashStats, listener)
    return () => {
      ipcRenderer.removeListener(IPC.splashStats, listener)
    }
  },

  /**
   * 补拉一次开屏时间线（推送发生在 did-finish-load 之后时不会丢，但
   * 渲染层刷新过 / 加载晚于收场时那条推送没有人在听）。没开过屏时 null。
   */
  getSplashStats: (): Promise<SplashTimeline | null> => ipcRenderer.invoke(IPC.splashStatsGet),

  /**
   * 列一遍开屏素材（设置页「开屏」卡素材池的多选列表，2026-10-06）。
   * 主进程**现扫**（内置目录 + <用户数据>/splash），导入成功后立刻重拉
   * 就能看到新素材。
   */
  listSplashMaterials: (): Promise<SplashMaterialRef[]> => ipcRenderer.invoke(IPC.splashMaterials),

  /**
   * 导入一段**自定义开屏视频**（只收 mp4，与开屏扫描器同一白名单）。
   * 语义同 importWallpaper：无入参（主进程弹框现选）、取消即值、
   * 重名自动加序号（成功返回实际落盘的文件名）。
   */
  importSplash: (): Promise<MediaImportResult> => ipcRenderer.invoke(IPC.splashImport),

  // ---- 大肥鱼桌宠（2026-10-06）
  //
  // 主窗这一侧只挂三件事 + 一个订阅：设置页读状态/做动作、学习事件发奖、
  // 运行结果上报。**聊天面板在宠物窗里**（它有专属的 pet preload），
  // 主窗的 miai.* 不开这条口子。

  /**
   * 拉一次桌宠快照。返回 null = 桌宠控制器没起来（极早期调用），
   * 界面画「未启用」态即可，不是错误。
   */
  petInit: (): Promise<PetSnapshot | null> => ipcRenderer.invoke(IPC.petInit),

  /** 做一个动作（喂饭/摸头/发奖/换模式/开关）。返回动作之后的快照，直接换上 */
  petAct: (action: PetAction): Promise<PetSnapshot> => ipcRenderer.invoke(IPC.petAct, action),

  /**
   * 汇报一次「运行代码」的结果（**单向 send**：说了就走，不需要回执）。
   * 主进程在失败且属于代码错时把桌宠叫到报错位置旁说一句。
   */
  petReportRun: (report: PetRunReport): void => {
    ipcRenderer.send(IPC.petReportRun, report)
  },

  /**
   * 汇报一次「学习收工」事件（挑战完成 / 复习满分，**单向 send**：P3 ④ 好感度）。
   * 主进程在 daily cap 内记一次加分；没桌宠/超限都静默，调用方无需 catch。
   */
  petEvent: (kind: 'challenge' | 'review'): void => {
    ipcRenderer.send(IPC.petEvent, kind)
  },

  /**
   * 让桌宠说一句挽留台词（设置卡「关闭大肥鱼」按钮悬停时用）。
   * 失败/没桌宠时静默 —— 调用方 `.catch(() => {})` 即可，它不该改变任何动作。
   */
  petPlead: (): Promise<void> => ipcRenderer.invoke(IPC.petPlead),

  /**
   * 汇报「正文编辑区在哪」（跟随鼠标的让位规则用，**单向 send**：说了就走）。
   * 窗口移动/缩放/滚动都会重报；null = 编辑区没了。主进程拿不到就降级为
   * 「没有让位对象」，所以调用方无需 catch、也无需等回执。
   */
  petReportWorkRect: (rect: PetWorkRect | null): void => {
    ipcRenderer.send(IPC.petReportWorkRect, rect)
  },

  /** 订阅桌宠状态广播（设置卡的饱食度/大白饭数实时跟随）。返回退订函数 */
  onPetState: (cb: (s: PetSnapshot) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, s: PetSnapshot): void => cb(s)
    ipcRenderer.on(IPC.petState, listener)
    return () => {
      ipcRenderer.removeListener(IPC.petState, listener)
    }
  },

  /**
   * 订阅「配置被主进程自己改了」的推送（`PublicAppConfig`，目前唯一生产者
   * 是桌宠右键菜单「关闭大肥鱼」——见 IPC.configExternal 的注释）。
   * 契约同 onPetState：回调只收载荷、返回退订函数。
   * 载荷与 `getConfig()` 同形（apiKey 已抹成 hasKey），整份换上即可。
   */
  onConfigExternal: (cb: (cfg: PublicAppConfig) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, cfg: PublicAppConfig): void => cb(cfg)
    ipcRenderer.on(IPC.configExternal, listener)
    return () => {
      ipcRenderer.removeListener(IPC.configExternal, listener)
    }
  },

  // ---- 云账号（P10.3 第一步，2026-10-10）
  //
  // **失败是值不是异常**：网络类结果一律走 `CloudResult<T>`（`{ok:true,data}`
  // 或 `{ok:false,failure:{code,...}}`）—— 跨 IPC 抛错误时 Electron 只带得走
  // message，code 会整个丢掉，而渲染层的下一步动作完全由 code 决定
  // （改密码 / 稍后再试 / 回登录页）。只有「我们传错了形状」主进程才抛。
  //
  // ⚠️ **token 不在这一层的任何出入参里**：注册/登录成功返回的是
  // `CloudAuthView`（服务端 AuthResponse 减掉 token），token 由主进程自己
  // 保管（P10.5 起是 safeStorage 加密的 session.bin，见 main/cloud/session-store.ts）
  // —— 渲染层连"看不见"都是类型保证的，不是口头约定。
  //
  // `session()` 的 `data` 为 null = 未登录（本地没令牌，或服务端判定令牌
  // 已死）；失败（NETWORK/TIMEOUT 等）时令牌**原样保留** —— 断网不等于被登出。
  cloud: {
    /** 注册（POST /v1/auth/register）。**绝不自动重试**：重发会造重复账号。
     *  2026-10-13 起必带安全问答（question 只许从 protocol.SECURITY_QUESTIONS 选） */
    register: (input: CloudRegisterInput): Promise<CloudResult<CloudAuthView>> =>
      ipcRenderer.invoke(IPC.cloudRegister, input),
    /** 登录（POST /v1/auth/login） */
    login: (input: CloudCredentials): Promise<CloudResult<CloudAuthView>> =>
      ipcRenderer.invoke(IPC.cloudLogin, input),
    /** 登出（POST /v1/auth/logout，幂等）。本地没登录时主进程一个包都不发 */
    logout: (): Promise<CloudResult<null>> => ipcRenderer.invoke(IPC.cloudLogout),
    /**
     * 仅本机退出（V1-62）：丢掉本机令牌 + 回客人盒，**零网络**（服务端会话
     * 原样活到过期）。断网时的出路 —— 语义与代价（重新登录要再输密码）见
     * 主进程 account-flow.ts 的 logoutLocal。恒成功（没有失败分支）。
     */
    logoutLocal: (): Promise<CloudResult<null>> => ipcRenderer.invoke(IPC.cloudLogoutLocal),
    /** 探测当前会话（GET /v1/auth/session）。data=null 即"未登录"，不是错误 */
    session: (): Promise<CloudResult<CloudSessionView | null>> =>
      ipcRenderer.invoke(IPC.cloudSession),
    /**
     * 找回密码三步链（2026-10-13）：①取问题 → ②验答案 → ③换密码。
     * 三口的失败都是 CloudResult 值（NOT_FOUND / NO_SECURITY_QUESTION /
     * BAD_SECURITY_ANSWER / RATE_LIMITED / VALIDATION_FAILED …）；
     * **都不产生本地会话**（服务端有意不发 token —— 重置完回登录页登一次）。
     */
    recoverQuestion: (input: RecoverQuestionRequest): Promise<CloudResult<RecoverQuestionResponse>> =>
      ipcRenderer.invoke(IPC.cloudRecoverQuestion, input),
    recoverVerify: (input: RecoverVerifyRequest): Promise<CloudResult<RecoverVerifyResponse>> =>
      ipcRenderer.invoke(IPC.cloudRecoverVerify, input),
    recoverReset: (input: RecoverResetRequest): Promise<CloudResult<RecoverResetResponse>> =>
      ipcRenderer.invoke(IPC.cloudRecoverReset, input),
    /**
     * 交一天的挑战成绩（结算入队；P10.x 上行接线）。主进程入队 + 触发一次
     * 上行，invoke 只回 `{queued}`（"排上了没有"）—— **网络结果不在这里等**：
     * 断网/未登录时排着，下次触达服务端再发；同一 dateKey 已在队 = queued:false
     * （不报错：收工 watcher 自己也有一次性守卫，这是第二道闸；P10.6 ⑤ 起
     * 补交通道同样把 queued:false 当"已在队 = 已交付"，据此写「已提交」标记）。
     * 载荷**不许**带 submissionId/installId（由主进程贴）；形状不合法主进程抛
     * （"我们自己传错了参数"才抛的先例，同 register/login）。
     */
    settleChallenge: (payload: ChallengeSettlePayload): Promise<{ queued: boolean }> =>
      ipcRenderer.invoke(IPC.cloudChallengeSettle, payload),

    // ---- 账号激活与同步（P10.5，2026-10-11）
    //
    // 激活是**本地流程**（收编/切盒/账本，不联网）：renderer 在登录成功后看到
    // `state().activated === false` 就引导用户选收编口径，然后调 activate()。
    // 已激活的重登 `activate({})` 直达（already）—— 两条路同一个口。
    /**
     * 激活（首激活收编 / 已激活直达）。失败是值：LEDGER_CORRUPT = 账号盒饭账
     * 读不回（主进程已中止且一字未写，界面如实报「去账号目录看现场」）；
     * 坏参数（形状不对）才抛。
     */
    activate: (input?: CloudActivateInput): Promise<CloudResult<CloudActivateView>> =>
      ipcRenderer.invoke(IPC.cloudActivate, input),
    /** 首激活前的预览：云端有没有数据（决定界面说「合并」还是「新账号」） */
    activatePreview: (): Promise<CloudResult<CloudActivatePreviewView>> =>
      ipcRenderer.invoke(IPC.cloudActivatePreview),
    /** 本地账号状态（不联网、无失败分支）：signedIn 且 !activated = 等激活 */
    state: (): Promise<CloudAccountState> => ipcRenderer.invoke(IPC.cloudAccountState),
    /**
     * 手动同步：一趟上行 + 一轮文档同步并行跑完才回。
     * 未登录时两趟都 skipped（渲染层据此不显示进度条）。
     */
    syncNow: (opts?: { force?: boolean }): Promise<{ sync: SyncRoundResult; uplink: UplinkResult }> =>
      ipcRenderer.invoke(IPC.cloudSyncNow, opts),
    /**
     * 取消在飞的那一轮同步（V1-65）。不等回话（invoke 回 undefined）—— 在飞的
     * 那一轮会在文档之间停下，它的 `syncNow` 回话里带 `canceled:true`；
     * 界面按那份回话收尾（toast / 停止态复位）。
     */
    syncCancel: (): Promise<void> => ipcRenderer.invoke(IPC.cloudSyncCancel),

    // ---- 排行榜（P10.6，2026-10-11）
    //
    // 读口 + opt-in 开关两条。**一次调用 = 一次往返**：不做本地缓存、不做轮询
    // （"上次拉到的快照"由渲染层的 leaderboard store 保管，它才知道界面在哪一页）。
    // 未登录时主进程一个包都不发，回 UNAUTHENTICATED —— 和"服务器说令牌死了"
    // 是不同的事实，界面文案靠 failure.code 分开。
    /**
     * 读榜（GET /v1/leaderboard）。`dateKey` 传**北京日**（shared/dates 的
     * todayKey()）—— 只影响回话里的 me.scoreToday，跨北京日界时"今日得分"
     * 才没错位；`cursor` 传上一页回话里的 nextCursor（**原样**回传，
     * 别自己编 —— 编码纪律见 main/cloud/leaderboard.ts 文件头）。
     * period 不认识的取值主进程抛 TypeError（编译期字面量联合，绕过 TS 才算数）。
     */
    leaderboard: (input?: {
      period?: LeaderboardPeriod
      dateKey?: string
      cursor?: string
    }): Promise<CloudResult<LeaderboardResponse>> => ipcRenderer.invoke(IPC.cloudLeaderboard, input),
    /**
     * 榜面曝光开关（PUT /v1/me/leaderboard-opt-in，幂等）。关掉只影响**别人**
     * 在榜上能不能看到你 —— 你自己的名次照常返回（me 恒在，不受开关影响）。
     */
    leaderboardOptIn: (input: { optIn: boolean }): Promise<CloudResult<OptInResponse>> =>
      ipcRenderer.invoke(IPC.cloudLeaderboardOptIn, input),

    // ---- 用户资料（2026-10-22 用户系统批次）
    //
    // 头像的字节与令牌一样**只经主进程**：渲染层拿到的永远是 data URL。
    // 上传前渲染层把预览裁成 256×256 PNG；主进程再验 magic/体积并与服务端
    // 回的 sha256 对拍。改名成功后排行榜下次拉取即显示新名字（服务端 JOIN
    // users 表，不依赖快照重建）。
    /**
     * 改用户名（PUT /v1/me/username）。失败码：USERNAME_TAKEN /
     * USERNAME_FORBIDDEN / VALIDATION_FAILED / RATE_LIMITED。
     */
    updateUsername: (username: string): Promise<CloudResult<Account>> =>
      ipcRenderer.invoke(IPC.cloudUpdateUsername, username),
    /**
     * 选一张本地图片（系统对话框）。`data:null` = 用户取消。
     * 主进程按磁盘真实字节验后缀、2MB 上限与 magic；失败码
     * UNSUPPORTED_MEDIA_TYPE / PAYLOAD_TOO_LARGE。
     */
    pickAvatar: (): Promise<CloudResult<AvatarPickView | null>> =>
      ipcRenderer.invoke(IPC.cloudPickAvatar),
    /** 上传裁剪后的 PNG（≤512KB）。服务端按 sha256 内容寻址 */
    uploadAvatar: (png: Uint8Array): Promise<CloudResult<AvatarUploadResponse>> =>
      ipcRenderer.invoke(IPC.cloudUploadAvatar, png),
    /**
     * 批量读头像：images = `{hash: dataURL}`；dead = 服务端确认永久不存在的
     * hash（渲染层不再重试）。其余没拿到的（断网/限流…）两桶都不进。
     */
    getAvatars: (hashes: string[]): Promise<AvatarBatchView> =>
      ipcRenderer.invoke(IPC.cloudGetAvatars, hashes)
  }
}

contextBridge.exposeInMainWorld('miai', miai)

export type MiaiApi = typeof miai
