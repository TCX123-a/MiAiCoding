/**
 * IPC 通道名常量 —— main 与 renderer 的契约唯一真源。
 * 后续模块（env/runner/profile/practice/review/ai）的通道统一在这里追加，
 * 禁止在业务代码里写裸字符串。
 */
export const IPC = {
  appGetVersion: 'app:get-version',
  profileGet: 'profile:get',
  profileSave: 'profile:save',
  wrongbookGet: 'wrongbook:get',
  wrongbookRecord: 'wrongbook:record',
  wrongbookClear: 'wrongbook:clear',
  /**
   * 用户**手动**动一条错题：软删 / 恢复 / 标知识点漏洞（学习闭环，2026-09-29）。
   *
   * 【为什么和 record / clear 分开】三条路的触发者不同：record 是答错记账、
   * clear 是答对毕业、这条是用户在列表里点的。并成一条的代价是
   * 「再错一次会不会复活」这类问题得把三种语义塞进一个入参里猜。
   *
   * 入参是一**批** `WrongUpdateItem`（`{key, patch}`）—— 单条操作传一个元素的数组。
   * 成批是为了「清空错题本」那种动作能一次请求做完，而不是发 N 条 IPC。
   * 返回**新列表**（渲染层直接拿它刷新快照，省一次 get 往返）。
   */
  wrongbookUpdate: 'wrongbook:update',
  /**
   * 收藏的题目（favorites.json，学习闭环）。
   *
   * 【为什么是「整份保存」而不是逐条增删】这个文件只有渲染层一个写方
   * （主进程不往里写任何东西，和 profile.json 同型），所以照 profile 那套
   * 载入 + 防抖整份保存就够，不需要给每条记录开一条通道。
   * ⚠️ 和它同名不同义的是 profile 里的**课级**收藏，见 types.ts 里那段注释。
   */
  favoritesGet: 'favorites:get',
  favoritesSave: 'favorites:save',
  /**
   * 大肥鱼备忘录（memo.json，P3 ②）。
   *
   * 【为什么也是「整份保存」】和收藏同型：文件只有渲染层一个写方
   * （主进程不往里写任何东西），载入 + 防抖整份保存就够，
   * 不给每条备忘单开一条通道。
   * 【和 favorites 的差别只在两端的性子】写口（`sanitizeMemo`）对坏形状
   * **抛错** —— 备忘是用户自己敲的字，丢一条的代价比丢一道收藏大得多。
   */
  memoGet: 'memo:get',
  memoSave: 'memo:save',
  /**
   * 练习史（practice.json，学习闭环）。
   *
   * 【为什么 record 由主进程算 id、渲染层只交 {key, ok}】
   * 落盘的是「一次完成」的会话（id 自增、超上限丢最老），自增和裁剪是
   * 文件自己的事，放在写口一处做完；渲染层交上来的东西越少，
   * 能写坏文件的花样就越少（哨兵课号那条校验也在主进程，见 practice-merge.ts）。
   */
  practiceRecord: 'practice:record',
  practiceGet: 'practice:get',
  configGet: 'config:get',
  configSave: 'config:save',
  envDetect: 'env:detect',
  runnerRun: 'runner:run',
  aiExplain: 'ai:explain',
  aiGenerateQuestions: 'ai:generate-questions',
  aiTestConnection: 'ai:test-connection',
  /**
   * 掐掉正在飞的那个 AI 请求。
   *
   * 【为什么「取消」必须是一条真通道，而不是「界面不看了」】
   * 不 abort 的话，请求还在跑、token 还在烧、**用户的钱还在花** ——
   * 界面上却显示「已取消」，那是骗人。docs/04 硬规定 AI 等待中必须可取消。
   *
   * 通道**可以**带一个可选参数（P1，docs/27 §8.1「扩展 1 条」）：
   * `{requestId}` = 只掐那一条侧栏对话；**省略参数 = 取消全部**（旧单飞通道
   * 与所有在飞的侧栏对话）—— 这正是旧调用点的行为：它们调 `aiCancel()` 不带参，
   * 而旧世界里"全部"就是"现在那一个"。所以旧语义逐字节保留（§5.2）。
   *
   * 【侧栏自己的取消一定要带 requestId】不带就等于"掐掉全部"，
   * 会把用户另一半屏幕上还在跑的出题一并掐断（docs/27 §12.2 的互不干扰要求）。
   */
  aiCancel: 'ai:cancel',

  // ---------------------------------------------------------------- AI 侧栏对话（P1，docs/27）

  /**
   * 开一条侧栏对话。**立刻返回 requestId，不等模型**（docs/27 §8.1）——
   * 等模型的话 invoke 会挂住 20~120 秒，渲染层连"正在输入"都画不出来。
   *
   * 入参 `AiChatStartInput`（完整消息列表 + 只读上下文）；
   * 回话 `AiChatStartResult`（`{requestId, accepted, reason?}`）。
   *
   * 【为什么和 ai:explain / ai:generate-questions 并行、而不是共用单飞】
   * 那两条是**整段返回**的旧链路，靠 `withAi` 的单飞语义（新请求顶掉旧请求）
   * 保证 `ai:cancel` 无歧义；侧栏是流式、要能单独取消，
   * 所以它走自己的一张 Map（见 main/app.ts 的 aiInflight）。
   * 两条路互不顶替：桌宠/出题在飞时，侧栏照样能开对话（docs/27 §8.2）。
   */
  aiChatStart: 'ai:chat-start',
  /**
   * 主进程 → 渲染进程：正文增量（每个 token/块推一次，`AiChatDeltaPayload`）。
   *
   * 【为什么是事件不是 invoke 的返回值】流式的本质是"不等它说完"。
   * 【红线】renderer 不许自己开 fetch / EventSource（CSP + Key 隔离），
   * 出网只在主进程 —— 这条通道就是那份"只能经 IPC 转发"的具体形状。
   */
  aiChatDelta: 'ai:chat-delta',
  /**
   * 主进程 → 渲染进程：**统一收尾**（`AiChatDonePayload`：ok / reason / detail）。
   * 成功、失败、用户取消都发这一条，让渲染层只有一处复位逻辑
   * （docs/27 §12.7：发晚了会让界面卡在"正在输入"）。
   */
  aiChatDone: 'ai:chat-done',
  /**
   * 读会话历史（`AiChatHistoryView`，最多 200 条，超限丢最旧）。
   *
   * 【docs/27 §8.1 只列了 chat-start/delta/done 三条，这条是补的】
   * 那三条里没有任何一条能把 `chat.json` 读回渲染层，而 §7 把"会话历史"
   * 列进了 P1 范围、§10 又要求它落盘成文件 —— 没有读口，重启后历史就只是
   * 躺在磁盘上的一堆字节。同因还有下面的 ai:chat-clear。
   */
  aiChatHistory: 'ai:chat-history',
  /**
   * 清空会话历史（`chat.json`）。无入参、无返回值。
   *
   * 【为什么清空要过主进程】文件归主进程所有；渲染层清掉自己那份列表
   * 而不动磁盘，下次启动历史会"复活"——用户会以为清空按钮是假的。
   */
  aiChatClear: 'ai:chat-clear',

  /**
   * 读某一天的挑战批次 + 抽题要用的排除清单（见 types.ts 的 `ChallengeToday`）。
   * `day` 为 `null` 表示今天还没抽过题 —— **不是错误**。
   *
   * 【为什么不叫 `challenge:today`】
   * 「今天」是渲染进程算出来的（它才知道用户所在时区，见 shared/dates.ts），
   * 主进程只认一个日期字符串。主进程自己算「今天」的话，两边时区一旦不一致，
   * 会出现「抽的是今天的题、存的是昨天的档」这种查都没法查的问题。
   */
  challengeGet: 'challenge:get',
  /** 写回**一天**。合并进 days 并裁掉 30 天以外的，都在主进程做 */
  challengeSave: 'challenge:save',

  /**
   * 发一张奖励图（每天第一次完成复习，学习闭环 §7；2026-10-17 起不看分数）。
   *
   * 【为什么发奖是一条**通道**，不是渲染层自己往 profile 里塞】
   * `profile.rewards` 归主进程所有：`profile:save` 是渲染层整份防抖保存，
   * 而它**无条件丢弃**入参里的 rewards、一律取磁盘现值（见 main/index.ts 的
   * profile:save）。所以渲染层就算往自己那份 profile 里 push 了一张图，
   * 下一次保存也会把它抹掉 —— 而且是静默抹掉。发奖只能由主进程合并写。
   *
   * 入参：`{ id: string | null, perfect: boolean }`（图库里的 id；
   * perfect = 这一轮是否全对，判分只有渲染层知道）。返回**新的 `ProfileRewards`**、
   * 写后的档案戳、以及这次的结果类别 `kind`（'granted' | 'full' | 'daily-limit'，
   * 见 shared/gallery.ts grantReward —— 渲染层只有 granted 才弹奖励窗）。
   * `perfectPasses` 只在 perfect=true 时 +1 —— 它是"全对过几次"的台账，
   * 跟发不发新图无关。
   * 「今天发过没有」的日子由**主进程**现取（todayKey()）：这是每日一次
   * （V1-38）的判据输入，不能让渲染层送。
   */
  rewardsGrant: 'rewards:grant',
  /**
   * 每日签到（P3 ①，2026-10-08）。
   *
   * 入参：`day: string`（'YYYY-MM-DD'，**渲染层算好带来** —— 同 challenge 的
   * 理由："今天"只有渲染层知道用户时区，主进程不自己算）。
   * 返回：`CheckinSubmitResult`（见 types.ts；成功形状，失败走 throw）。
   *
   * 【为什么签到必须是主进程一条通道，而不是渲染层自己写 profile】
   * 和发奖图同因（见 rewardsGrant）：`profile:save` 是渲染层整份保存、
   * **无条件丢弃**入参里的主进程所有字段。签到要写 `profile.checkin`，
   * 渲染层自己塞的话，下一次防抖保存就静默抹掉 —— "签了，但下次启动又没签过"。
   * 而且签到带着**发大白饭**的副作用：判重（days 里有没有这天）、写档、发饭
   * 三步必须在同一个进程里挨着做完，才能保证"重复请求不发第二碗饭"。
   */
  checkinSubmit: 'checkin:submit',
  /**
   * 把一张奖励图另存到用户选的位置（`dialog.showSaveDialog` + 落盘）。
   *
   * 【为什么渲染层只传 id，不传字节】图在渲染层的 assets 里（vite 打包后
   * 文件名带哈希），主进程按 id 自己找源文件更稳：不用把几 MB 的图来回搬，
   * 也不用给 file:// 开权限。用户取消保存**不是错误** —— 返回值里如实说"取消了"，
   * 不抛异常（照 `AiResult` 那套"失败即值"的语义，见 shared/ai-question.ts）。
   */
  gallerySaveImage: 'gallery:save-image',
  /**
   * 读奖励图覆盖映射（2026-10-16，机制 =「丢文件即替换」）。
   *
   * 无入参、每次现扫（目录小、无缓存 —— 同开屏素材池的理由）。返回
   * `RewardOverridesInfo`（dir 一并带回，设置页要显示「图放哪」）。
   * 空文件夹 / 目录不存在 = 空映射，**不是错误**（失败即值）。
   */
  rewardsOverridesGet: 'rewards:overrides:get',
  /**
   * 打开奖励图覆盖文件夹（设置页按钮）。
   *
   * **路径不入参**（原则同 runnerOpenIde 的「exe 不在入参里」）：主进程
   * 自己拼 `join(storageDir(),'rewards')`，目录不存在先 mkdir —— 首次点击
   * 就得到一个空文件夹，正好是「把图丢这里」的说明书。返回 `{ok, reason}`
   * （失败即值，不抛）。
   */
  rewardsOpenFolder: 'rewards:open-folder',

  /**
   * 弹一个只挑 `.exe` 的打开对话框（设置页「选择文件」用）。
   *
   * 【为什么单独一条通道】dialog 只能主进程弹。返回体是 `PickExeResult` ——
   * 用户取消**不是错误**，如实说「取消了」，不抛（同 gallerySaveImage 的规矩）。
   * ⚠️ 只收 .exe：`.lnk` 桌面快捷方式 spawn 不起来（CreateProcess 不解析它），
   * 放它进来只会把错误推迟到用户点「本地 IDE 打开」的那一刻。
   */
  dialogPickExe: 'dialog:pick-exe',
  /**
   * 用设置里配置的本地 IDE 打开一段代码（练习场「本地 IDE 打开」）。
   *
   * 入参 `{ lang, code }`；**exe 不在入参里** —— 主进程自己从配置现读
   * （安全边界：让渲染层传 exe 等于开一条「任意程序执行」通道，
   * 见 main/runner/native-ide.ts 文件头）。
   */
  runnerOpenIde: 'runner:open-ide',
  /**
   * 把一段代码导出成临时文件（练习场「导出并复制路径」）。
   * **只写盘、不碰剪贴板** —— 复制路径由渲染层自己做。
   */
  runnerExportCode: 'runner:export-code',
  /**
   * 自动探测本机装了哪些 IDE（设置页 / 练习场的「🔍 自动检测」）。
   *
   * 无入参；返回 `IdeDetectResult`（失败即值）。**不落盘、不改配置** ——
   * 选中哪一个由渲染层决定，写入照常走 `config:save`。主进程只负责「去找」，
   * 这样「探测」和「保存用户的选择」是两件事，各自的失败不会互相污染。
   */
  runnerDetectIde: 'runner:detect-ide',

  /**
   * 列出本机壁纸（Steam 工坊 + WE 自带 projects）—— 壁纸层的发现链入口。
   *
   * 无入参；返回 `WallpaperCatalog`（**失败即值**：没装 Steam 时
   * `available: false` + 空列表，不是错误）。主进程侧带 60s TTL 缓存，
   * 首次调用会现扫（注册表探针 + vdf + 逐目录读 project.json）。
   * 选中哪一张由渲染层决定、写入照常走 `config:save`（同 detectIde 的分工）。
   */
  wallpaperList: 'wallpaper:list',
  /**
   * 读一张壁纸的自带属性**原文**（`project.json` 的 general.properties /
   * general.localization，「壁纸属性」面板的数据源）。
   *
   * 【为什么主进程只读不解析】解析器是 shared 的纯计算（wallpaper-props.ts），
   * 且要跟用户覆盖值合并 —— 覆盖值住在渲染层的配置里。主进程读文件、渲染层
   * 解析，各自只有一份实现。入参 `itemId`；返回 `WallpaperPropsResult`
   * （条目不存在 / 文件读不到时 project=null，**失败即值**，不是错误）。
   */
  wallpaperProps: 'wallpaper:props',
  /**
   * 导入一张**自定义**壁纸（设置页「导入壁纸」）。
   *
   * 【为什么渲染层不传路径】用户要挑的文件只能由主进程弹 dialog 现选 ——
   * 让渲染层传路径等于开一条「任意文件拷进数据目录」的通道。所以这条通道
   * **无入参**：主进程弹框 → 校验扩展名 → 拷进 `<用户数据>/wallpapers/`
   * （重名自动加序号）→ 返回 `MediaImportResult`（用户取消**不是错误**，
   * reason 'cancelled'，同 dialogPickExe 的规矩）。**拷贝完成后主进程会强制
   * 重扫壁纸目录**，渲染层紧接着调 wallpaperList 就能看到新条目 —— 白名单
   * （miai-wall:// roots）随目录快照一起刷新，不需要任何额外登记。
   */
  wallpaperImport: 'wallpaper:import',
  /**
   * 窗口状态推送（**主工程第一条 main → renderer 推送通道**）。
   *
   * 载荷 `WallpaperWindowState`：主进程只推「原生事实」（focused/minimized/
   * visible），pauseOnMinimize / pauseOnBlur 是用户配置、由渲染层拿着
   * 响应式配置自己推导暂停语义 —— 主进程不替渲染层做策略。
   * 时机：窗口事件即时推 + 3s 轮询自愈（原生模态框会丢 focus/blur 事件）+
   * did-finish-load 强制补推。订阅只收增量，**首帧状态走 stateGet**。
   */
  wallpaperState: 'wallpaper:state',
  /**
   * 读一次当前窗口状态（订阅建立前的首帧兜底）。
   *
   * 【为什么推送之外还要一条 invoke】推送早于订阅就丢了：did-finish-load
   * 触发在渲染层挂载之前，那一刻的 `wallpaper:state` 没有任何人在听。
   * 载荷与推送完全相同（`WallpaperWindowState`），两条路谁先到用谁。
   */
  wallpaperStateGet: 'wallpaper:state:get',

  // ---------------------------------------------------------------- 开屏动画（docs/24，2026-10-05）

  /**
   * 开屏页 → 主进程：播放事件上报（`SplashPageEvent`，见 shared/splash.ts）。
   *
   * 【为什么用单向 on 而不是 invoke】上报是「说了就走」的通知，主进程不需要
   * 回话；而且上报可能在页面被销毁的最后时刻发出，invoke 的应答无人接收反而
   * 多一条失败路径。主进程侧按 `sender` 校验来源 —— 这条通道只认开屏窗。
   */
  splashEvent: 'splash:event',
  /**
   * 开屏页 → 主进程：拉一次播放配置（`SplashPagePayload`，含 miai-wall:// URL）。
   *
   * 【为什么配置不随 loadURL 的 query 传】素材名含中文/空格，塞进 URL 要
   * 双重编码；而且「播什么」是主进程 decideSplash 的结果，页面只该被动接收。
   * 页面启动后主动 invoke 一次，拿不到就如实报 error（主进程随即收场）。
   */
  splashGet: 'splash:get',
  /**
   * 主进程 → 开屏页：开始渐隐（页面收到后给整页挂 fade-out class）。
   * 完成动作不依赖页面回调 —— 主进程独立倒计时后 destroy（页面卡死也不悬挂）。
   */
  splashFade: 'splash:fade',
  /**
   * 主进程 → 开屏页：主窗还没就绪，把「跳过」提示切成「正在准备界面」。
   */
  splashHold: 'splash:hold',
  /**
   * 主进程 → 主窗：开屏时间线快照（`SplashTimeline`）。开屏收场时推一条，
   * 主窗渲染层挂在 `window.__splashStats` 上（探针读口）。
   * 【为什么放主窗而不是开屏页】开屏页马上就销毁了，取证要落在活得久的窗口。
   */
  splashStats: 'splash:stats',
  /**
   * 主窗 → 主进程：补拉一次时间线快照。
   *
   * 【为什么推送之外还要一条 invoke】同 wallpaperStateGet：如果渲染层加载
   * 晚于开屏收场（或者刷新过一次），那条推送没有人在听。没开过屏时返回 null。
   */
  splashStatsGet: 'splash:stats:get',
  /**
   * 列一遍开屏素材清单（设置页「开屏」卡的素材池勾选区数据源）。
   *
   * 无入参；返回 `SplashMaterial[]`（scanSplashMaterials 的产物：内置 +
   * `<用户数据>/splash/` 里的用户素材）。**会现扫**（素材目录不大，
   * 不设 TTL —— 导入后立刻要在勾选列表里看到新素材，缓存只会添乱）。
   */
  splashMaterials: 'splash:materials',
  /**
   * 导入一段**自定义开屏视频**（设置页「开屏」卡的「导入视频」）。
   *
   * 【为什么渲染层不传路径】同 wallpaperImport：挑文件只能主进程弹 dialog，
   * 无入参；主进程校验扩展名（只收 mp4，与开屏扫描器同一份白名单）→
   * 拷进 `<用户数据>/splash/`（重名自动加序号）→ 返回 `MediaImportResult`。
   * 导入成功后渲染层重拉 splashMaterials，新素材即刻出现在勾选列表里。
   */
  splashImport: 'splash:import',

  // ---------------------------------------------------------------- 大肥鱼桌宠（2026-10-06）

  /**
   * 任意窗口 → 主进程：拉一次桌宠快照（`PetSnapshot`）。
   *
   * 【谁在用】设置页的「大肥鱼」卡要显示饱食度/大白饭数；宠物窗每次加载也要
   * 先拉一份（推送可能在它加载完成之前就发生过了，同 wallpaperStateGet 的缝）。
   * 返回 null = 桌宠功能没起来（控制器尚未 attach），界面画"未启用"态。
   */
  petInit: 'pet:init',
  /**
   * 任意窗口 → 主进程：做一件事（`PetAction`：喂饭 / 摸头 / 发奖 / 换模式 /
   * 存位置 / 开关 / 弹菜单）。返回**动作之后**的 `PetSnapshot`，
   * 调用方直接换上，省一次 petInit 往返（同 practiceRecord 返回新文件的形状）。
   *
   * 【为什么所有动作合成一条通道，不一个动作一条】它们共享同一个真源
   * （pet.json 那一份 state），全部要在主进程的控制器里排队落地；
   * 拆成七八条通道只是把同一段转发代码抄七八遍。
   */
  petAct: 'pet:act',
  /**
   * 主窗渲染层 → 主进程：汇报一次「运行代码」的结果（`PetRunReport`）。
   * 失败且是代码错的（非环境问题）时，主进程把桌宠叫到报错位置旁边说一句。
   *
   * 【为什么渲染层不直接操作宠物窗】两个窗口互不知晓对方的存在；
   * 坐标换算（主窗视口 → 屏幕 → 宠物窗）需要两个窗口的 bounds 与缩放因子，
   * 只有在主进程里才同时拿得到（道理同 gallerySaveImage 的"只有主进程分得清"）。
   */
  petReportRun: 'pet:report-run',
  /**
   * 主窗渲染层 → 主进程：学习和练习的「收工事件」（P3 ④ 好感度系统的输入，
   * 与喂饭/摸头同级的常规动因）。kind：挑战完成 'challenge'（+3，日上限 1）、
   * 复习满分 'review'（+5，日上限 1）。
   *
   * 【为什么对齐 petReportRun 的单向口径】它是"说一声就走"的记分事件：
   * 渲染层不等回执（好感的可见反馈由 petState 广播与侧栏进度条负责），
   * 偶发丢一条 = 少一次加分，可接受。载荷在主进程由 parsePetAction 校验，
   * 垃圾值丢弃并留日志（判定为真的路上不许有不需要证据的分支）。
   */
  petEvent: 'pet:event',
  /**
   * 主窗渲染层 → 主进程：让桌宠说一句挽留台词（撒娇）。
   *
   * 【触发点】设置卡「叫它出来」开关悬停、主程序关闭键悬停（后者由宿主
   * 轮询光标热点触发，不经这条通道；右键菜单项悬停走渲染端直连宿主路由
   * /miai/plead，也不经这里）。**失败即忽略** —— 它是一次 UI 善意提示，
   * 宿主没起（关的就是它）= 没人要听，不该影响开关本身的动作。
   * 冷却在宿主 plead() 里（8 秒），渲染层不重复限流。
   */
  petPlead: 'pet:plead',
  /**
   * 主窗渲染层 → 主进程：上报「正文编辑区在哪」`PetWorkRect | null`（单向 send）。
   *
   * 【为什么是单向 send 而不是 invoke】同 petHit：窗口移动/缩放/滚动都会让
   * 矩形变，报得勤；而它是"最新值覆盖"的语义 —— 迟到的回执没有任何用。
   * 【为什么渲染层报视口矩形而不是屏幕坐标】同 PetRunReport.rect：换算要
   * 两个窗口的 bounds 与缩放因子，只有主进程同时拿得到。null = 编辑区没了
   * （窗口要卸了）；主进程按"没有让位对象"降级，不猜矩形。
   */
  petReportWorkRect: 'pet:report-work-rect',
  /**
   * 宠物窗 → 主进程：上报「哪些屏幕区域该接鼠标」`PetHitRect[]`（单向 send）。
   *
   * 【为什么高频却不用 invoke】宠物一边走一边报，回执对它是死重量；
   * 而且它是"最新值覆盖"的语义 —— 迟到的回执没有任何用。
   */
  petHit: 'pet:hit',
  /**
   * 宠物窗 → 主进程：聊一句天。载荷是 `PetChatMessage[]`（含刚敲的那条 user），
   * 回 `PetChatResult`（失败也带一句给人看的话）。
   *
   * 【为什么不用共享的单飞控制器（withAi）】那条是给设置页/出题用的：
   * 新请求顶掉旧请求。桌宠聊天和出题完全可能同时发生（一边出题一边逗鱼），
   * 共用会让两者互相掐断 —— 用户看到的是「AI 出题莫名失败」。所以主进程给
   * 桌宠单独养一个单飞控制器（同一条不变式，两个独立实例）。
   */
  petChat: 'pet:chat',
  /**
   * 主进程 → 宠物窗：行为指令（`PetCmd`：说一句 / 走到报错处 / 开聊天面板 /
   * 光标位置）。只发给宠物窗 —— 换模式、藏起来这些状态变化走 petState 广播。
   */
  petCmd: 'pet:cmd',
  /**
   * 主进程 → 全部窗口：桌宠状态快照（`PetSnapshot`）。凡改动（喂饭、发奖、
   * 衰减心跳、挪位置、开关）都广播一条；设置卡与宠物窗各自认领需要的字段。
   * 同 wallpaperState 的广播形状：新窗口靠 petInit 补拉，不重放历史。
   */
  petState: 'pet:state',

  // ---------------------------------------------------------------- 主窗导航（2026-10-06）

  /**
   * 主进程 → 主窗渲染层：把主窗拉起来并跳到设置页的某张卡
   * （`AppNavPayload`，目前唯一的生产者是桌宠右键菜单的两个快捷入口）。
   *
   * 【为什么不是"渲染层自己跳"】发起方是桌宠窗 —— 它既不知道主窗路由
   * （独立渲染进程、权限最小化），也不该知道；由主进程转一手：主进程
   * 负责 restore/show/focus 主窗，渲染层只认"去哪张卡"。
   * 同 wallpaperState 的订阅契约（回调只收载荷、返回退订函数）。
   */
  appNav: 'app:nav',

  /**
   * 主进程 → 全部窗口：配置被**主进程自己**改了（载荷 `PublicAppConfig`）。
   *
   * 【为什么已有 config:get 还要这条推送】configGet 是拉取，只有调用方主动
   * 问才更新；设置页正开着时，主进程侧的改动必须当场到达。目前唯一的生产者
   * 是桌宠右键菜单「关闭大肥鱼」—— enabled 由主进程落成 false 并广播，
   * 设置页的开关键跟着灭。没有这条推送，用户看到的是「菜单关掉了宠物、
   * 设置页开关却还亮着」的自相矛盾（下次重启才被拉取纠正）。
   *
   * 载荷过 `toPublicConfig`（与 configGet 同一出口，apiKey 照抹成 hasKey）——
   * 它是**主进程主动推**的配置，不是渲染层提交的回声。将来凡「主进程自发
   * 改配置」的入口都从这里广播一条，别再让渲染层猜。
   */
  configExternal: 'config:external',

  // ---------------------------------------------------------------- 云账号（P10.3 第一步，2026-10-10）

  /**
   * 云账号四条通道（全部 invoke；形状见 shared/cloud/dto.ts）。
   *
   * 【为什么失败是值不是异常】Electron 跨 IPC 抛错误时只带得走 message，
   * CloudFailure 的 code 会整个丢掉，而渲染层的下一步动作完全由 code 决定
   * （改密码 / 稍后再试 / 回登录页）。所以网络与协议类失败一律走
   * `CloudResult<T>`（同 AI 的 AiResult 先例），只有"我们自己传错了参数"才抛。
   *
   * 【token 的边界】token 只住在主进程（内存，见 main/cloud/account.ts）；
   * 渲染层拿到的永远是 CloudAuthView（= 服务端 AuthResponse 减 token）。
   * 四条通道的出/入参里都没有 token 字段，这不是约定，是类型事实。
   */
  cloudRegister: 'cloud:register',
  cloudLogin: 'cloud:login',
  cloudLogout: 'cloud:logout',

  /**
   * 仅本机退出（V1-62，2026-10-16）：零网络的出路 —— 丢本地令牌 + 回客人盒，
   * **一个包都不发**（服务端会话原样活到过期）。登出本身需要联网（作废服务端
   * 会话），断网时用户会被「退出登录」扣在登录态里；这条口给收编页逃生口
   * 与账号页那颗按钮一条不需要网络的出路。终端态与一次成功的真登出完全相同
   * （signedIn:false + 客人盒）——不新造状态，代价是重新登录要再输一次密码。
   */
  cloudLogoutLocal: 'cloud:logout-local',
  cloudSession: 'cloud:session',

  /**
   * 找回密码三步链（2026-10-13 主人令；全部 invoke，形状见 shared/cloud/dto.ts）。
   *   ① cloudRecoverQuestion：{username} → CloudResult<{question}>；
   *   ② cloudRecoverVerify：{username, answer} → CloudResult<{verified}>；
   *   ③ cloudRecoverReset：{username, answer, newPassword} → CloudResult<{ok}>。
   * 【三条纪律】问答明文只在这条链上过手、**不落任何本地文件**（哈希是服务端的
   * 事）；三端点都**不产生本地会话**（成功也不写 token —— 重置完自己回登录页
   * 登一次）；防爆破限流全在服务端（RATE_LIMITED 原样透传）。
   */
  cloudRecoverQuestion: 'cloud:recover-question',
  cloudRecoverVerify: 'cloud:recover-verify',
  cloudRecoverReset: 'cloud:recover-reset',

  /**
   * 挑战结算入队（P10.x 上行接线）：渲染层把一天的挑战成绩交上来，主进程
   * **入队**（`.sync/pending-ops.json`）并触发一次上行，invoke 只回
   * `{queued}`（"排上了没有"）—— 网络结果不在这条通道上等（断网/未登录
   * 时排着，下次触达服务端再发；同一 dateKey 已在队 = queued:false）。
   * 载荷形状 = shared/cloud/dto.ts 的 ChallengeSettlePayload（**不许**带
   * submissionId/installId —— 那两个字段由主进程贴，见 pending-ops 注释）。
   */
  cloudChallengeSettle: 'cloud:challenge-settle',

  // ---------------------------------------------------------------- 账号激活与同步（P10.5，2026-10-11）

  /**
   * 激活（首激活收编 / 已激活直达）：入参 CloudActivateInput、出参
   * `CloudResult<CloudActivateView>`（形状全在 shared/cloud/dto.ts）。
   * 【失败是值】磁盘状态不许安全继续（账号盒饭账读不回 ⇒ LEDGER_CORRUPT）
   * 也走 CloudResult.failure —— 只有「我们自己传错形状」（坏 accountId、
   * 首激活没给 mode、盒停在别的账号）才抛，同 register/login 的先例。
   */
  cloudActivate: 'cloud:activate',

  /**
   * 首激活前的预览（P10.6 界面用）：问云端四份文档有没有数据，回
   * `CloudResult<CloudActivatePreviewView>`。网络失败原样透传 failure；
   * 未登录时主进程一个包都不发（UNAUTHENTICATED）。
   */
  cloudActivatePreview: 'cloud:activate-preview',

  /**
   * 本地账号状态（纯本地事实、不联网、**不包 CloudResult** —— 没有失败分支）：
   * `{signedIn, accountId, activated, boxAccountId}`。signedIn 且 !activated
   * 是正常中间态（登录了还没收编，盒仍停客人位），界面引导激活而不是报错。
   */
  cloudAccountState: 'cloud:state',

  /**
   * 手动同步（渲染层按钮/定时器用）：一趟上行（饭流水 + 结算队列）+ 一轮样式
   * 文档同步，两趟并行跑完才回话 —— 出参 `{sync, uplink}` 两份结果
   * （SyncRoundResult + UplinkResult，shared/cloud/dto.ts）。`force` 跳过
   * 同步引擎的退避窗口（手动触发语义；上行没有退避窗，429 建议走结果里
   * 的 retryAfterMs）。未登录时两趟都 skipped、一个包都不发。
   */
  cloudSyncNow: 'cloud:sync-now',

  /**
   * 取消在飞的那一轮同步（V1-65，2026-10-16）。无入参、无失败分支（invoke 回
   * undefined）：主进程把取消旗竖给 sync-engine，正在飞的一轮在**文档之间**
   * 停下（在飞的请求由自己的 10s 超时收束），随后的 cloudSyncNow 回话里带
   * `canceled:true`。没有在飞轮时调用 = 立旗作废（下轮开始即清）。
   */
  cloudSyncCancel: 'cloud:sync-cancel',

  // ---------------------------------------------------------------- 排行榜（P10.6，2026-10-11）

  /**
   * 榜面读口（GET /v1/leaderboard）。入参 `{period?, dateKey?, cursor?}` ——
   * period 是编译期字面量联合（五个键，见 shared/cloud/protocol.ts），不认识的
   * 值主进程抛 TypeError（"我们自己传错"）；dateKey 传**本地日**（todayKey()），
   * 只影响回话里的 me.scoreToday；cursor 传上一页响应里的 nextCursor（原样）。
   * 出参 `CloudResult<LeaderboardResponse>`（形状全在 shared/cloud/dto.ts）。
   * 未登录时主进程一个包都不发（UNAUTHENTICATED）。
   */
  cloudLeaderboard: 'cloud:leaderboard',

  /**
   * 榜面曝光开关（PUT /v1/me/leaderboard-opt-in，幂等）。入参 `{optIn: boolean}`
   * —— 形状不对抛（同 register/login 先例）。出参 `CloudResult<OptInResponse>`。
   * 语义：关掉只影响**别人**在榜上能不能看到你，你自己的名次照常（me 恒在）。
   */
  cloudLeaderboardOptIn: 'cloud:leaderboard-opt-in',

  // ---------------------------------------------------------------- 用户资料（2026-10-22 用户系统批次）

  /**
   * 改用户名（PUT /v1/me/username）。入参 `{username: string}`（形状不对抛）；
   * 出参 `CloudResult<Account>`。失败码按语义分开：USERNAME_TAKEN（409）、
   * USERNAME_FORBIDDEN（400，违禁词）、VALIDATION_FAILED（格式）、
   * RATE_LIMITED（429，每天 5 次）。成功后主进程同步刷新 session.bin 里的
   * 资料快照 —— 排行榜下次拉取时服务端 JOIN 的 username 已是最新。
   */
  cloudUpdateUsername: 'cloud:update-username',

  /**
   * 选头像（系统文件对话框）。入参无；出参 `CloudResult<AvatarPickView | null>`
   * —— `data:null` = 用户取消（正常意志，不是错误）。主进程在对话框之外
   * **再验一遍**后缀/2MB 上限/magic 字节（见 main/cloud/avatar-file.ts），
   * 不过 = UNSUPPORTED_MEDIA_TYPE / PAYLOAD_TOO_LARGE。
   */
  cloudPickAvatar: 'cloud:pick-avatar',

  /**
   * 上传头像（PUT /v1/avatar，原始 PNG 字节）。入参 `{png: Uint8Array}` 或
   * 直接 Uint8Array；出参 `CloudResult<AvatarUploadResponse>`（含服务端算出的
   * hash）。主进程会核对 hash 与本地 sha256 —— 对不上按 MALFORMED_RESPONSE，
   * 不把错值写进会话。渲染层负责把预览居中裁成 256×256 PNG（≤512KB）。
   */
  cloudUploadAvatar: 'cloud:upload-avatar',

  /**
   * 批量读头像（GET /v1/avatar/:hash，已登录即可）。入参 `string[]`（hash 列表，
   * 非法项静默跳过、上限 100、去重）；出参 `AvatarBatchView`：
   * `images = {hash: dataURL}`，`dead = 服务端确认永久不存在（404）的 hash`。
   * **其余没拿到的 hash 两桶都不进**（断网/限流，等重试窗口），界面按默认
   * 大肥鱼头像兜底。
   * 主进程有按 hash 的内存缓存（内容寻址，同一 hash 字节永不改变），
   * 并发 4、遇 RATE_LIMITED/UNAUTHENTICATED 即停住本批剩余请求 ——
   * 绝不为了几张头像把账号的 120 次/分钟额度打光。
   */
  cloudGetAvatars: 'cloud:get-avatars'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
