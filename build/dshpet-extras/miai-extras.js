/**
 * dsh-pet desktop helper —— 咪爱扩展脚本（miai-extras）。
 *
 * 五件事（2026-10-06 迁移轮扩成互动层后，再加跑腿与焦点上报；当晚补菜单两件）：
 *   ① 小黄鸭点击音效（原样保留）；
 *   ② 点击仲裁 → 咪爱互动：单击=摸头、双击=喂一碗大白饭、连点 5 下=rua。
 *      判定逐字对齐旧宠物窗 src/renderer/public/pet.html:302-383（2026-10-06 冻结）：
 *        · 点到 1 / 3 下停住（320ms 没后续）→ 摸头；点到 2 下停住（420ms）→ 喂饭
 *          （v1 那里是开聊天面板；新引擎零 API 红线没有对话面板，改成喂饭 ——
 *           正是 shared/copy.ts FEED_OK 注释写的「双击（或菜单）喂一碗」）；
 *        · 一路点到 5 下（3 秒窗口内）→ rua，前面排定的动作全被清掉、一次不补发；
 *        · rua 后锁 600ms、喂饭后排定后锁 400ms（v1 同值：连击的尾巴不算新点击）；
 *        · 按下后位移超过 6px = 拖不是点 → 撤掉全部排队动作（v1 beginDrag）。
 *      台词/动画/记账全在咪爱宿主的行为大脑（src/main/dshpet/brain.ts），
 *      本脚本只数点、发 POST、火后不管 —— 与「碎碎念」菜单同一条 S.postAction 语义。
 *   ③ 跑腿与焦点上报（2026-10-06 追加；标记注释在下方「跑腿」节顶部，构建期按它做铺后自检）：
 *      · 自己起一条 1s 轮询（错开 500ms 起步，不和 events.js 的 1s 循环同一拍）GET /state，
 *        盯 pets.main.goto 叶子：counter 一变且 data 非空 → 把宠物**身体中心**缓动滑到屏上
 *        (x, y)（屏幕绝对坐标，DIP/CSS px；cubic ease-in-out，时长按距离钳在 450~1600ms），
 *        到达写 customPos 并回执 /miai/chase-arrived；中途来新 goto 就以当前位置转向新目标，
 *        用户一拖就中止本次（不移动、不回执）；
 *      · 窗口获得/失去焦点 → POST /miai/pet-focus {focused}（fire-and-forget）。
 *      两条都只打宿主本地路由（零联网零模型）；宿主侧的叶子与路由在 src/main/dshpet。
 *      【为什么绕开 events.js 自己轮询】events.js / shared-core.js 是供体文件的逐字节拷贝
 *      （构建期 copyDir + 只覆写 sprite.js/index.html），任何改动下一次构建就被覆盖——
 *      多一条自己的轮询换个相位，代价最小、面最干净。
 *   ④ 右键菜单挽留（2026-10-06 晚）：document 级 mouseover 委托 —— 悬停菜单项
 *      「关闭大肥鱼」（字面量与 build/dshpet-patch.mjs 的菜单树一致）→ POST /miai/plead；
 *      宿主 plead() 的 8 秒冷却在宿主侧，与设置页开关悬停、主窗关闭键悬停三个入口共享。
 *   ⑤ 右键菜单黑白主题（2026-10-06 晚）：vendor 的 MENU_CSS 是写死白底（禁改文件），
 *      本层注入 html[data-miai-theme=X] 前缀的毛玻璃覆写（特异性 0,2,0 > vendor 0,1,0），
 *      主题数据源 = 宿主 /miai/theme 转手的 config.theme；菜单每次出现时按缓存先挂、
 *      再后台刷新（设置页刚换过主题也跟得上）。
 *   ⑥ 饱腹进度条（P3 ③ 2026-10-08；UI 大修轮 2026-10-09 改「标签 + 条」两段式）：
 *      vitals 叶子 → 菜单打开时在既有菜单项**之前**前插一条两段式饱腹行 ——
 *      上一段是固定格式的标签文本 `🍚 饱腹度：N%`（唯一允许出现在行内的文案），
 *      下一段是图形条（宽度 = satiety%，颜色按五档）；注入后重新钳制菜单面板位置
 *      （panel 高度是 vendor append 时量的，后插会撑高 —— 贴底打开时底边会溢出视口）。
 *      数据源复用既有 goto 轮询的同一发 /state（契约点名：不新增第二条定时器）。
 *   ⑦ 跟随鼠标（补充模块一 2026-10-09）：follow 叶子（**电平语义**，每次 /state 按最新
 *      值覆盖目标）→ 鱼身中心做指数趋近滑向宿主给的落点（宿主已按"让位"规则算好：
 *      光标进正文编辑区时给的是沿边等待点）。轮询节奏自适应：跟随生效 120ms、平时
 *      1000ms（同一条轮询，不新增定时器）。守卫：拖拽中 / 右键菜单开着 / 文本输入
 *      持焦 → 暂停位移（逻辑仍 on，菜单标签不翻）；跟随期间另把引擎的自主漫游闸掉
 *      （tryMove 包装，见「自主漫游闸门」节）。
 *   ⑧ 关闭挽留位移（补充模块二）：recall 叶子（**事件语义**，同 goto）→ go=游到关闭键
 *      旁的停靠点、到位回执 /miai/recall-arrived{seq,phase:'go'}（宿主随即播撒娇动画）；
 *      back=游回出发前的位置（出发前的 pos 与 customPos 原样留着，回来时**原样还原**）
 *      并回执 phase:'back'。停靠在途吃同一条漫游闸门 —— 趴在 X 旁的鱼不许自己溜达走。
 *
 * 经典 script（无 import/export，IIFE 全封装），由 index.html 在 renderer.js **之后**加载：
 * 与既有五件套（shared-core → constants → sprite → events → renderer，index.html:169-173）
 * 同目录、同一条 <script src> 通道 —— CSP `script-src 'self'`（index.html:7）怎么放行它们，
 * 就怎么放行本文件；加载顺序保证 constants.js 的 BASE 已就绪。
 *
 * 供体取证（node_modules/dsh-pet/runtime/electron-helper/，逐条对原文，勿凭猜）：
 *  - 宠物可点区域 = `.pet-hit`：sprite.js:142-148 创建命中区（`this.hit.className = 'pet-hit'`），
 *    index.html:56-64 是**全页唯一** pointer-events:auto 的元素（root/stage/视频/气泡全 none）——
 *    桌面端"身体外透明像素穿透"的语义就靠它，本脚本的命中判据与它严格同源。
 *  - 左键口径：sprite.js:753 `if (e.button !== 0) return;`（供体的 pointerdown 只认左键，与右键菜单解耦）。
 *  - BASE：constants.js:121-123
 *    `const BASE = BRIDGE ? 'dsh-pet-bridge://dsh-pet/dsh-pet-7340' : ORIGIN + '/dsh-pet-7340';`
 *    —— 顶层 const 进**全局词法环境**（constants.js:4-5 的加载约定），不是 window 属性：
 *    本文件只能裸引用 `BASE`（typeof 守卫），写 window.BASE 拿不到。
 *  - 音效地址 = BASE + '/miai/quack.wav'：与供体素材同款拼法（sprite.js:59 的 assetBase、
 *    renderer.js:49 的 fetch(BASE + '/config')）；wav 由咪爱打包链投放到该路由（宿主本地，零外网）。
 *  - 拖拽阈值用**屏幕坐标**（sprite.js:831-835：clientX 会随窗口移动而变化，屏幕坐标稳定）——
 *    本脚本的「拖不是点」判定照抄这条：screenX/screenY 增量超 6px 即撤销点击（v1 DRAG_THRESHOLD 同值）。
 *  - 页面由 loadFile 加载（main.js:488，file:// 源）。fetch 目标的 CSP 放行两侧都已就绪：
 *    非 bridge 模式 default-src 含 http:（index.html:7）；bridge 模式 dsh-pet-bridge scheme 注册带
 *    bypassCSP（main.js:248-264，bypassCSP 在 :259）。blob: 音频走 media-src 白名单（index.html:7 已含 blob:）。
 *
 * 纪律：全程 try/catch、绝不抛错、绝不阻断页面；失败原因一律写进 window.__miaiExtras.quackError /
 * actError / flagsError（跑腿、跟随、挽留、漫游闸门、焦点与菜单的 gotoError / chaseError /
 * followError / recallError / roamError / focusError / menuPleadError / menuThemeError 同规，
 * 附 console.warn），绝不静默吞；零联网 / 零模型调用，只打宿主本地路由。
 */
'use strict';

(function () {
  // 重复注入守卫：本页正常只加载一次；若未来被二次注入，保留先装实例（避免双监听一击双响 /
  // 计数翻倍），并响亮提示。注意这不是"静默回退成功"——音效照常工作，只是不叠加第二套。
  if (window.__miaiExtras) {
    try {
      console.warn(
        '[miai-extras] window.__miaiExtras 已存在（version=' + window.__miaiExtras.version + '），本次注入跳过',
      );
    } catch (_) {
      /* 提示本身失败不影响既有实例 */
    }
    return;
  }

  /** 音效相对路径：拼在 BASE 之后（BASE 形如 http://127.0.0.1:3080/dsh-pet-7340 或 dsh-pet-bridge://dsh-pet/dsh-pet-7340） */
  const QUACK_PATH = '/miai/quack.wav';
  /** 连击防抖窗口（毫秒）：窗口内的后续触发直接丢弃（连击只响一声） */
  const DEBOUNCE_MS = 120;
  /** 互动三条路由（宿主 host.ts 的同名分支 → 行为大脑） */
  const PAT_PATH = '/miai/pat';
  const FEED_PATH = '/miai/feed';
  const RUA_PATH = '/miai/rua';
  /** 宿主 flags：音效开关/音量/跟随/漫游闸门的唯一读口（宠物窗读不到 config） */
  const FLAGS_PATH = '/miai/flags';
  /** flags 缓存有效期：过期后**下一次点击或下一拍轮询**顺带后台刷新（首击不等网络，见 soundAllowed 注释）。
   *  2026-10-09 由 30s 收到 5s：跟随与漫游闸门（follow/roam）也要随设置页改动及时换挡 ——
   *  用户在主窗里一拨开关，桌面上的鱼最多 5 秒就该听话。 */
  const FLAGS_TTL_MS = 5000;
  /** 菜单挽留（宿主 /miai/plead；8 秒冷却在宿主 plead() 里，三个入口共享） */
  const PLEAD_PATH = '/miai/plead';
  /** 关闭挽留位移的到位回执（宿主 /miai/recall-arrived；body {seq, phase}，同 chase-arrived 口径） */
  const RECALL_ARRIVED_PATH = '/miai/recall-arrived';
  /** 菜单主题读数（宿主 /miai/theme → config.theme；宠物窗读不到 config，宿主转手） */
  const THEME_PATH = '/miai/theme';
  /** 挽留只认这一条菜单项：字面量必须与 build/dshpet-patch.mjs 的菜单树一致（改一处要改两处） */
  const PLEAD_LABEL = '关闭大肥鱼';

  // ── 点击仲裁常量（逐字对齐 v1 pet.html:166-167,304-383，改这里前先读那段注释） ──
  /** 点到 1/3 下停住 → 摸头的等待窗（v1 同值） */
  const PAT_DELAY_MS = 320;
  /** 点到 2 下停住 → 喂饭的等待窗（v1 双击=开聊天，同窗值） */
  const FEED_DELAY_MS = 420;
  /** 连点几下算 rua（v1 RUA_CLICKS，同 shared/pet.ts PET_RUA_CLICKS） */
  const RUA_CLICKS = 5;
  /** 数点的滑动窗口（v1 RUA_WINDOW_MS，同 PET_RUA_WINDOW_MS） */
  const RUA_WINDOW_MS = 3000;
  /** rua 之后的整体锁（v1 同值：连击尾巴不计数、也不响） */
  const RUA_LOCK_MS = 600;
  /** 喂饭排定后的锁（v1 双击开面板后的同值锁；现在喂饭不弹面板，仍保留同款节奏） */
  const FEED_LOCK_MS = 400;
  /** 按下后位移超过它就算拖（v1 DRAG_THRESHOLD 同值；单位 = 屏幕像素） */
  const DRAG_THRESHOLD = 6;

  // ── 跑腿（扫 pets.main.goto 叶子）与焦点上报 ──
  /** 与 constants.js:124 的 STATE_URL 同一路由；本文件自己拼（BASE 走 resolveBase 的显式失败口） */
  const CHASE_STATE_PATH = '/state';
  /** 到达回执 / 窗口焦点上报（宿主 host.ts 的同名路由） */
  const CHASE_ARRIVED_PATH = '/miai/chase-arrived';
  const FOCUS_PATH = '/miai/pet-focus';
  /** goto 轮询：起步错开 500ms（别和 events.js 的 1s 循环同一拍），之后 1000ms 一拍 */
  const GOTO_POLL_MS = 1000;
  const GOTO_POLL_OFFSET_MS = 500;
  /** 钳位：整个宠物窗距工作区（VIEW）边缘至少留这么多 px（DIP） */
  const CHASE_EDGE_PX = 8;
  /** 缓动时长 = 起点到目标的距离(DIP) ÷ 900 × 1000 ms，再钳到 [450, 1600]：近不瞬移、远不磨蹭 */
  const CHASE_SPEED_PX_PER_S = 900;
  const CHASE_MIN_MS = 450;
  const CHASE_MAX_MS = 1600;

  // ── 跟随鼠标（补充模块一）与挽留停靠（补充模块二）的常量 ──
  /** 跟随生效时的轮询节奏（平时用 GOTO_POLL_MS=1000）：120ms ≈ 8 拍/秒，落点跟手 */
  const FOLLOW_POLL_MS = 120;
  /** 指数趋近时间常数（ms）：每帧闭合剩余距离的比例 = 1 − e^(−dt/τ)，约 0.3s 走完 90% */
  const FOLLOW_TAU_MS = 130;
  /** 趋近速度上限（px/s）：远距离起步别嗖地飞过去（观感是"游"不是"瞬移"） */
  const FOLLOW_VMAX_PX_S = 1350;
  /** 到位死区（px）：与目标差小于它就停（不再逐帧烧 rAF；停时把落点写进 customPos 保会话位置） */
  const FOLLOW_STOP_PX = 3;
  /** 命中区半宽/半高（×体型）：与宿主 src/main/dshpet/host.ts 的 HIT_HALF_*_RATIO 同值同源 ——
   *  挽留停靠的 body 钳位要保证**命中区**全程在屏（那是"点得动"的那部分；单测跨文件对账） */
  const HIT_HALF_W_RATIO = 0.1875;
  const HIT_HALF_H_RATIO = 0.22265625;
  /** 自主漫游最小间隔（ms）：饱腹度低于 PET_HUNGER_MILD_AT(50) 起生效 —— medium 档 90s、
   *  severe 及以下 180s（主人规则「20-50% 行动迟缓」在渲染端就体现为"很少挪窝"） */
  const ROAM_GAP_MEDIUM_MS = 90000;
  const ROAM_GAP_SEVERE_MS = 180000;

  // ── 饱腹进度条（P3 ③ 2026-10-08；标记 miai-hunger-v1，构建期按它做铺后自检）──
  /* miai-hunger-v1 */
  /** 档界值：与 src/shared/pet.ts 的 PET_HUNGER_*_AT 逐值相同（单测跨文件对账，改一处会红） */
  const HUNGER_FULL_AT = 80;
  const HUNGER_MILD_AT = 50;
  const HUNGER_MEDIUM_AT = 20;
  const HUNGER_SEVERE_AT = 1;
  /** 档 → 颜色（从高到低取第一格满足；闭下界与 petHungerTier 同口径） */
  const HUNGER_BAR_COLORS = [
    [HUNGER_FULL_AT, '#34c759'],
    [HUNGER_MILD_AT, '#c9b32a'],
    [HUNGER_MEDIUM_AT, '#ff9500'],
    [HUNGER_SEVERE_AT, '#ff3b30'],
  ];
  /** 归零档颜色（灰）：与 severe 的红区分「饿但有救」与「彻底空了」 */
  const HUNGER_EMPTY_COLOR = '#8e8e93';
  /** 进度条根类名（单测/探针按它找条；样式全内联，不依赖注入的 CSS 表） */
  const HUNGER_BAR_CLASS = 'miai-hunger-bar';
  /** 标签前缀：条上方那一行固定格式文本 —— 契约①（术语=饱腹度） */
  const HUNGER_LABEL_PREFIX = '🍚 饱腹度：';
  /** 读数行（契约③，V2-23）：类名 + 首尾固定片段拼 `🍙 大白饭 N 碗 · ❤ 好感度 K%` */
  const VITALS_LINE_CLASS = 'miai-vitals-line';
  const VITALS_RICE_PREFIX = '🍙 大白饭 ';
  const VITALS_RICE_SUFFIX = ' 碗 · ❤ 好感度 ';
  /** 进度条注入后重钳面板时至少留的可见带边缘（与 vendor shared-core.js showPanel/挂载钳的 ±4 同口径） */
  const MENU_EDGE_PX = 4;

  /** 探针接口（字段语义见初始化值旁注释；play() 与点击共用同一条播放路径） */
  const api = {
    version: '20261010',
    // ---- 小黄鸭 ----
    quackCount: 0, // 成功**开播**的次数（fetch / play 失败不计数）
    lastQuackAt: 0, // 最近一次通过防抖的触发受理时间（Date.now()；防抖基准，不依赖异步完成）
    quackError: null, // 最近一次失败原因（字符串）；成功开播后清空；null = 链路健康
    quackEnabled: true, // 开关：false 时点击与 play() 都不计数、不播放、不报错
    play: playQuack,
    // ---- 互动三条（计数 = 宿主**受理**了这次请求；冷却内大脑会静默忽略，同一次点击照样计数）----
    patCount: 0,
    feedCount: 0,
    ruaCount: 0,
    actError: null, // 最近一次互动上报失败原因（成功受理后清空）
    // ---- 音效闸门（宿主 /miai/flags）----
    // 这两个字段是**活的**（playQuack/applyVolume 直接读它们，探针也能直接改）：
    soundAllowed: true, // 宿主说"能响吗"。默认 true（首击不等网络：宁响一声不哑；下一条 flags 校准）
    soundVolume: null, // 宿主音量（0~100）；null = 还不知道，用播放器默认
    flagsError: null, // flags 拉取失败原因（失败保留上一次读数，不清零）
    refreshFlags: refreshFlags, // 探针口：立刻重拉一次（设置页改完开关不必等 TTL）
    // ---- 跑腿（goto 叶子 → 窗口缓动到位；坐标系与帧骨架见下方「跑腿」节）----
    gotoCounter: null, // 最近一次读到的 pets.main.goto.counter；null = 还没读到过（首拉只记基线）
    gotoPolls: 0, // 成功读到 /state 的拍数（探针验「轮询活着」用）
    gotoError: null, // 最近一次轮询失败原因（成功一拍即清；只在由好转坏那一拍 console.warn）
    chaseActive: false, // 这一趟是否还在跑（到达/拖动打断/新目标接管/中止都会置 false）
    chaseSeq: null, // 当前（或最近一次）目标的 seq，原样回执给宿主
    chaseArrived: 0, // 到达次数（以「写了 customPos」为准；回执 POST 成败不改变它）
    chaseError: null, // 跑腿失败原因（起始/到达回执/帧循环异常）
    walkTo: walkTo, // 探针口：直接下令走一趟（与 goto 叶子同一条路径，返回是否真的出发）
    // ---- 焦点上报（/miai/pet-focus）----
    focusReports: 0, // 已**派发**的上报次数（BASE 不可用而没派发的不计）
    lastFocus: null, // 最近一次成功派发的 focused 值；null = 还没报过
    focusError: null, // 上报失败原因
    // ---- 右键菜单（挽留悬停 + 黑白主题；2026-10-06 晚）----
    menuPleadCount: 0, // 悬停「关闭大肥鱼」项**派发**的挽留请求次数（宿主受理与否看宿主日志 say#n (plead)）
    menuPleadError: null, // 挽留上报失败原因（成功派发即清）
    menuTheme: 'light', // 当前认到的主题（'light'|'dark'）；vendor 原生即亮色，认不出时行为与旧版一致
    menuThemeError: null, // 主题读数失败原因（失败保留上一次读数，缺省 light）
    refreshMenuTheme: refreshMenuTheme, // 探针口：立刻重拉一次（同 refreshFlags 的先例）
    // ---- 饱腹进度条（P3 ③；vitals 叶子 → 菜单首项前插的「标签 + 条」两段行）----
    petVitals: null, // 最近一次读到的 pets.main.vitals.data（{satiety,rice,mood,affection}）；null = 还没读到
    vitalsCounter: null, // 最近一次读到的 vitals.counter；null = 还没读到过（没有读数就没有进度条）
    vitalsError: null, // vitals 读数失败原因（成功读到时清；只在由好转坏那一拍 console.warn）
    menuHungerBars: 0, // 已前插的进度条数（同一面板最多 1 条；探针验「在场」）
    menuHungerSkips: 0, // 菜单出现但 vitals 不可用 → **不摆坏行**而跳过的次数（可归因，不是静默）
    menuHungerReclamps: 0, // 注入后重新钳制面板位置的次数（贴底打开时把它抬回可见带内）
    menuReclampFallbacks: 0, // 重钳时可见带读数（__dshPetClampRect）缺席、回落视口的次数（每次配套一条 console.warn，不许静默）
    menuHungerError: null, // 进度条构建/钳制异常原因（收口写这里，绝不外抛）
    // ---- 跟随鼠标（补充模块一 2026-10-09；叶子/趋近帧见下方「跟随鼠标」节）----
    followOn: false, // 跟随**当前是否生效**（叶子是唯一写口；叶子没读到前由 /miai/flags 种子一次）
    followCounter: null, // 最近一次读到的 follow.counter；null = 还没读到过（首拉即采用，非基线）
    followTarget: null, // 最新落点 {x,y}（屏幕 DIP，鱼中心）；null = 无目标（off 或还没读到）
    followMoving: false, // 趋近帧正在烧（探针验「在追」用；到位/暂停/收令都会 false）
    followPaused: false, // 暂停守卫当前是否挡着（拖拽中 / 右键菜单开着 / 文本输入持焦）
    followSteps: 0, // 已应用的趋近帧数（sendBounds 次数；探针验「真的动了」用）
    followError: null, // 跟随失败原因（坏叶子/帧异常）；成功应用一次叶子或正常起帧即清
    flagsFollow: null, // /miai/flags 的 follow 读数（对账/诊断；**不参与写 followOn**，避免两个写者抖标签）
    // 跟随资格（2026-10-10 主人裁定「有资格才提」；2026-10-16 V1-49 改出场方式）：
    // /miai/flags.followEligible 的读数 —— 总闸开 && 不挨饿（饱食度 ≥ 50）&& 好感 ≥ 80。
    // 右键菜单那一项按它决定**可不可点**：有资格 = 可点的「跟着我走/别跟着啦」三元开关；
    // 没资格 = 置灰不可点的解释行（sprite.js 补丁里读的就是这里的 followEligible）。
    // 缺省 false：还没读到 = 先不提（与下面 followBlock 的缺省空串同一姿势）。
    followEligible: false,
    flagsFollowEligible: null, // 原始读数（null = /miai/flags 还没回来过）
    // 跟不了的原因（V1-49，2026-10-16）：/miai/flags.followBlock 读数 —— 没资格时菜单里
    // 「跟着我走（差在哪）」括号里那句话（如「饱腹 0%/50%」），由宿主与 followEligible
    // 同一次求值给出；渲染端只透传、不复述门槛。'' = 有资格或还没读到 —— 两者对菜单
    // 都表现为「不出灰项」（宁可按老样子不出现，不摆一行瞎猜的原因）。
    followBlock: '',
    flagsFollowBlock: null, // 原始读数（null = /miai/flags 还没回来过）
    // 跟随状态上报 helper（pet:follow-active，修「跟随吞点击」）：最近一次成功上报的值
    // （null = 还没上报过），以及上报失败计数/原因（供探针归因；桥缺席不算失败）
    followActiveSent: null,
    followActiveErrors: 0,
    followActiveError: null,
    // ---- 关闭挽留位移（补充模块二；状态机见下方「关闭挽留位移」节）----
    recallCounter: null, // 最近一次读到的 recall.counter；null = 还没读到过（首拉只记基线，事件语义）
    recallState: 'idle', // 'idle' | 'going' | 'parked' | 'backing'（看门狗/漫游闸门都读它）
    recallGoArrived: 0, // go 段到位次数（以「写了 customPos + 派发了回执」为准）
    recallBackArrived: 0, // back 段到位次数
    recallAborts: 0, // 走动没能完成而中止的次数（拖着/精灵不在/被拖拽打断；可归因，不是静默）
    recallError: null, // 挽留位移失败原因
    // ---- 自主漫游闸门（补充模块一；包装见下方「自主漫游闸门」节）----
    roamAllowed: true, // /miai/flags.roam 读数（饥饿时活跃乱跑总闸）；缺省 true（首拉前照旧）
    roamGated: false, // 原型包装是否已装上（精灵晚建时轮询拍兜底重试）
    roamSuppressed: 0, // 被闸门拦下的自主漫游尝试次数（tryMove 无参调用）
    lastRoamAt: 0, // 最近一次放行自主漫游的时刻（分档节流基准；Date.now()）
    roamError: null, // 闸门安装/判定异常原因（判定异常一律放行——体验优化不是安全属性）
    refreshState: refreshStateNow, // 探针/菜单路由口：立刻补一拍 /state + flags（火后不管）
  };

  let audioEl = null; // 懒加载缓存：首次播放时创建，之后复用同一个 Audio（blob URL 全程不回收）
  let loadingPromise = null; // 首次加载进行中共享同一个 Promise（连击不重复 fetch）；失败置空允许重试

  let flagsAt = 0; // 上次刷新（成功或失败）的时刻，TTL 基准
  let flagsLoading = null; // 进行中的刷新（连点不重复拉）

  // ---- 点击仲裁状态（v1 同名变量）----
  let clickTimes = [];
  let patTimer = null;
  let dblTimer = null;
  let lockUntil = 0;
  let pressed = false; // 按下未松开（拖拽判定用）
  let dragging = false; // 本次按下已升级为拖（撤过排队动作）
  let pressSX = 0;
  let pressSY = 0;

  /** 读 constants.js 的全局词法绑定 BASE；不可用返回 null（显式失败，不猜地址） */
  function resolveBase() {
    try {
      if (typeof BASE === 'string' && BASE) return BASE;
    } catch (_) {
      /* 词法绑定未初始化（TDZ）等异常：落到显式失败 */
    }
    return null;
  }

  /** 失败收口：原因写进 quackError 并 console.warn（绝不静默吞；console 挂了也不外抛） */
  function noteQuackError(reason) {
    api.quackError = '小黄鸭音效失败：' + reason;
    try {
      console.warn('[miai-extras] ' + api.quackError);
    } catch (_) {
      /* console 不可用也不能抛 */
    }
  }

  /** 互动上报失败收口（同 noteQuackError 的纪律） */
  function noteActError(reason) {
    api.actError = reason;
    try {
      console.warn('[miai-extras] 互动上报失败：' + reason);
    } catch (_) {
      /* 同上 */
    }
  }

  /** 把宿主音量（0~100）应用到播放器；未知就保持默认 */
  function applyVolume(el) {
    if (typeof api.soundVolume === 'number' && isFinite(api.soundVolume)) {
      el.volume = Math.min(1, Math.max(0, api.soundVolume / 100));
    }
  }

  /**
   * 后台刷新音效闸门读数（不 await、不阻断点击）。
   * 【为什么默认放行】首击发生在页面刚起来时，flags 还没到手；此刻如果"等答案再响"，
   * 十有八九哑掉 —— 静音的用户最多少听一声，没静音的用户每一下都在等一个 RTT。
   * 失败保留上一次读数（TTL 内不重试），失败原因写 flagsError，探针读得到。
   */
  function refreshFlags() {
    if (flagsLoading) return flagsLoading;
    const base = resolveBase();
    if (base === null) {
      api.flagsError = 'BASE 不可用（constants.js 未加载？）';
      return Promise.resolve();
    }
    flagsLoading = fetch(base + FLAGS_PATH)
      .then((res) => {
        if (!res || !res.ok) throw new Error('flags HTTP ' + (res && res.status ? res.status : '无响应'));
        return res.json();
      })
      .then((data) => {
        if (data && typeof data.sound === 'boolean') api.soundAllowed = data.sound;
        if (data && typeof data.volume === 'number' && isFinite(data.volume)) api.soundVolume = data.volume;
        // follow（补充模块一）：只在**叶子还没读到过一次**时当种子 —— 之后 followOn 的
        // 唯一写口是 follow 叶子（applyFollowLeaf）。两个写者会把菜单标签抖出花来：
        // flags 是 5s 一拍的快照，叶子是每次变化即写的事实。
        if (data && typeof data.follow === 'boolean') {
          api.flagsFollow = data.follow;
          if (api.followCounter === null) api.followOn = data.follow;
        }
        // 跟随资格（2026-10-10）：菜单项「跟着我走/别跟着啦」出不出现看它。没有"两个写者"
        // 问题（叶子不发资格，它是纯设置快照），所以每次 flags 回来直接覆盖。
        if (data && typeof data.followEligible === 'boolean') {
          api.flagsFollowEligible = data.followEligible;
          api.followEligible = data.followEligible;
        }
        // 跟不了的原因（V1-49）：没资格时菜单灰行括号里那句话。和 followEligible 同一次
        // 求值、同一份响应 —— 照样直接覆盖（同属纯设置快照，无写者冲突）。非字符串一律
        // 当没读到的老宿主：原样留着上一次（多半是 ''），菜单按老样子不摆灰行。
        if (data && typeof data.followBlock === 'string') {
          api.flagsFollowBlock = data.followBlock;
          api.followBlock = data.followBlock;
        }
        syncFollowActive(); // 种子路径也要上报 helper（否则菜单里点开跟随前的那段是"没报过"）
        // roam（补充模块一）：纯设置项（没有叶子对手），flags 是它的唯一来源。
        if (data && typeof data.roam === 'boolean') api.roamAllowed = data.roam;
        api.flagsError = null;
      })
      .catch((err) => {
        api.flagsError = err && err.message ? err.message : String(err);
        try {
          console.warn('[miai-extras] 音效闸门读数失败（保留上一次：' + api.soundAllowed + '）', err);
        } catch (_) {
          /* console 不可用也不能抛 */
        }
      })
      .then(() => {
        flagsAt = Date.now(); // 成功/失败都算"刚看过"：TTL 内不因连点反复打宿主
        flagsLoading = null;
      });
    return flagsLoading;
  }

  /** 懒加载并缓存 Audio：成功 resolve(Audio 元素)；失败 reject（loadingPromise 置空，下次触发可重试） */
  function ensureAudio() {
    if (audioEl) return Promise.resolve(audioEl);
    if (loadingPromise) return loadingPromise;
    const base = resolveBase();
    if (base === null) return Promise.reject(new Error('BASE 不可用（constants.js 未加载？）'));
    const url = base + QUACK_PATH;
    loadingPromise = fetch(url)
      .then((res) => {
        if (!res || !res.ok) throw new Error('quack.wav HTTP ' + (res && res.status ? res.status : '无响应'));
        return res.blob();
      })
      .then((blob) => {
        const objUrl = URL.createObjectURL(blob);
        const el = new Audio(objUrl);
        applyVolume(el); // 创建时套一次；之后每次播放前再套（音量可能中途被设置页改过）
        audioEl = el;
        return el;
      })
      .catch((err) => {
        loadingPromise = null; // 不缓存失败：否则一次网络抖动 = 永久哑巴
        throw err;
      });
    return loadingPromise;
  }

  /**
   * 播放一次（点击与探针 play() 的**唯一**路径）。
   * 返回本次触发是否受理（false = 总开关/宿主静音/防抖窗口内丢弃）；计数 = 真的开播才 +1。
   */
  function playQuack() {
    if (!api.quackEnabled) return false;
    if (!api.soundAllowed) return false; // 宿主说静音：不计数、不播放（读数见 api.soundAllowed）
    const now = Date.now();
    if (now - api.lastQuackAt < DEBOUNCE_MS) return false; // 连击防抖：以受理时刻为准，不依赖异步完成
    api.lastQuackAt = now;
    try {
      ensureAudio()
        .then((el) => {
          applyVolume(el);
          el.currentTime = 0; // 缓存复用：每次从头播
          return el.play();
        })
        .then(() => {
          api.quackCount++;
          api.quackError = null; // 此刻开播成功：清掉历史失败（失败时仍会重新写入，不会静默吞）
        })
        .catch((err) => {
          noteQuackError(err && err.message ? err.message : String(err));
        });
    } catch (err) {
      noteQuackError(err && err.message ? err.message : String(err));
    }
    return true;
  }

  // ---------------------------------------------------------------- 互动上报

  /**
   * 发一条互动（/miai/pat|feed|rua），火后不管；成功受理（宿主应答 ok:true）才计数。
   * 【计数口径】计的是"宿主受理了这次请求"，不是"鱼一定冒泡了"——冷却窗内大脑会
   * 静默忽略（v1 同款：连点不刷台词）。**例外（V1-45 双击死带修复，brain 侧）**：
   * 摸头之后紧跟的第一碗喂饭放行 —— 双击（1 下摸头 + 2 下喂饭）时喂饭不再被
   * 摸头占掉的冷却静默吞掉。计数含义不变。探针要验"真的说了话"请看宿主
   * debugState 的 sayCounter/brain 段，别拿这里的计数当台词证据。
   */
  function postAct(path, kind) {
    const base = resolveBase();
    if (base === null) {
      noteActError(kind + '：BASE 不可用（constants.js 未加载？）');
      return;
    }
    try {
      fetch(base + path, { method: 'POST' })
        .then((res) => {
          if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status ? res.status : '无响应'));
          return res.json().catch(() => null);
        })
        .then((data) => {
          if (!data || data.ok !== true) throw new Error('应答 ok!==true');
          if (kind === 'pat') api.patCount++;
          else if (kind === 'feed') api.feedCount++;
          else if (kind === 'rua') api.ruaCount++;
          api.actError = null;
        })
        .catch((err) => {
          noteActError(kind + '：' + (err && err.message ? err.message : String(err)));
        });
    } catch (err) {
      noteActError(kind + '：' + (err && err.message ? err.message : String(err)));
    }
  }

  function clearPatTimer() {
    if (patTimer) {
      clearTimeout(patTimer);
      patTimer = null;
    }
  }

  function clearDblTimer() {
    if (dblTimer) {
      clearTimeout(dblTimer);
      dblTimer = null;
    }
  }

  /** 撤掉全部排队的点击动作（拖不是点：v1 beginDrag 的三件套） */
  function cancelPendingClicks() {
    clearPatTimer();
    clearDblTimer();
    clickTimes = [];
  }

  /**
   * 数一下这次按下（v1 onFishDown 的判定段，逐条对齐）。
   * 【为什么必须等】想 rua 的人点到第二下时若立刻动作，后三下全被反馈打断 ——
   * 所以 1/3 下等 320ms、2 下等 420ms，让连点意图明朗再发（代价：单击慢 320ms）。
   */
  function countClick(now) {
    clickTimes = clickTimes.filter(function (x) {
      return now - x < RUA_WINDOW_MS;
    });
    clickTimes.push(now);
    clearPatTimer();
    clearDblTimer();
    if (clickTimes.length >= RUA_CLICKS) {
      clickTimes = [];
      lockUntil = now + RUA_LOCK_MS;
      postAct(RUA_PATH, 'rua');
      return;
    }
    if (clickTimes.length === 1 || clickTimes.length === 3) {
      patTimer = setTimeout(function () {
        patTimer = null;
        postAct(PAT_PATH, 'pat');
      }, PAT_DELAY_MS);
    } else if (clickTimes.length === 2) {
      dblTimer = setTimeout(function () {
        dblTimer = null;
        clickTimes = [];
        lockUntil = Date.now() + FEED_LOCK_MS;
        postAct(FEED_PATH, 'feed');
      }, FEED_DELAY_MS);
    }
    // 第 4 下：不上不下，什么都不排 —— 凑到第 5 下是 rua，停下就让窗口自然过期（v1 原话）
  }

  // ---------------------------------------------------------------- 事件

  /** 捕获阶段拦截 pointerdown：先于 sprite.js 绑在 .pet-hit 上的目标阶段处理，互不干扰；本身绝不抛错 */
  function onDocPointerDown(e) {
    try {
      if (!e || e.button !== 0) return; // 只认左键（口径同 sprite.js:753）
      const t = e.target;
      if (!t || typeof t.closest !== 'function') return;
      if (!t.closest('.pet-hit')) return; // 命中判据 = 真实可点区域选择器（供体：sprite.js:143）
      const now = Date.now();
      if (now < lockUntil) return; // rua / 喂饭之后的锁：整只手都锁住（v1 顺序：锁在"嘎"之前）
      if (now - flagsAt > FLAGS_TTL_MS) void refreshFlags(); // 顺带校准音效开关（不 await）
      playQuack(); // 手感优先：声音在按下那一刻就到（v1 同序）
      // 拖拽预备：按下先记账，位移超阈值才升级成拖（见 onDocPointerMove）
      pressed = true;
      dragging = false;
      pressSX = e.screenX; // 屏幕坐标：窗口被拖着走时 clientX 会失真（sprite.js:831 同款理由）
      pressSY = e.screenY;
      countClick(now);
    } catch (err) {
      try {
        noteQuackError('点击处理异常：' + (err && err.message ? err.message : String(err)));
      } catch (_) {
        /* 兜底中的兜底：绝不外抛 */
      }
    }
  }

  /** 指针移动：按下后位移超阈值 = 拖不是点 → 撤掉排队动作（v1 beginDrag 同款；本身绝不抛错） */
  function onDocPointerMove(e) {
    try {
      if (!pressed || dragging) return;
      if (e && typeof e.buttons === 'number' && (e.buttons & 1) === 0) {
        pressed = false; // 松手发生在窗口外（mouseup 丢了）：事件一回来就补收尾
        return;
      }
      const dx = e.screenX - pressSX;
      const dy = e.screenY - pressSY;
      if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
        dragging = true;
        cancelPendingClicks();
      }
    } catch (_) {
      /* 判定异常：宁可让这一点算作点击，也不许把页面带塌 */
    }
  }

  /** 松手/取消：结束本次按下（排队动作照常走 —— 点完了就该有反应） */
  function onDocPointerEnd() {
    pressed = false;
    dragging = false;
  }

  try {
    document.addEventListener('pointerdown', onDocPointerDown, true);
    document.addEventListener('pointermove', onDocPointerMove, true);
    document.addEventListener('pointerup', onDocPointerEnd, true);
    document.addEventListener('pointercancel', onDocPointerEnd, true);
  } catch (err) {
    try {
      noteQuackError('监听注册失败：' + (err && err.message ? err.message : String(err)));
    } catch (_) {
      /* 同上：注册失败也只能写错误，不许让页面塌 */
    }
  }

  // ---------------------------------------------------------------- 跑腿（宿主 goto 叶子 → 缓动走到屏幕点）
  /* miai-chase-v1 */
  //
  // 【坐标系】宿主给的是**屏幕绝对坐标**（DIP/CSS px，与 petBridge 窗口 bounds 同一套 CSS 系——
  // main.js:449-451 用 setZoomFactor(CONFIG.scale) 把整窗放大，渲染端统一活在 CSS 像素里）。
  // 宠物自己是「视口相对」坐标系（视口 = 全部显示器工作区外接矩形 VIEW）：
  //   窗口屏幕位 = VIEW.x + pos.x − margin.l        （sprite.js:249 的 sendBounds 算式；
  //                                                与 sprite.js:1005-1006 visibleClampRect 同款）
  //   身体中心（视口）= pos + halfW / halfH          （sprite.js:319-325 currentCenterX/Y）
  // 两者相消（窗口内身体中心 = margin.l + halfW）：
  //   中心屏幕 X = VIEW.x + pos.x + halfW  ⇒  pos 目标 = (x − VIEW.x) − halfW   （y 同理）
  //
  // 【窗口矩形】钳位用：窗口在视口里从 pos − margin 起，宽 = size + margin.l + margin.r、
  // 高 = winH + margin.t + margin.b（sprite.js:1005-1008；窗口实际尺寸 main.js:353-357 同式）。
  //
  // 【为什么用 rAF 缓动而不是复用引擎的漫游】引擎漫游没有绝对目的地、时长绑定视频、且是线性插值
  // （侦察报告 §1e）；这里照抄 startDragFollow 的 rAF 骨架（sprite.js:585-610），把弹簧换成
  // cubic ease-in-out，并**不占用** sprite.moveRef（那是引擎漫游的槽位，占用会被 playIdle 的
  // stopMove 顺手取消，sprite.js:401/565）。

  let chaseToken = 0; // 接管/中止令牌：rAF 闭包醒来先对牌，对不上就直接死
  let chaseRaf = null; // 本段跑腿的 rAF 句柄（独立于引擎的 moveRef/dragFollow）
  let chaseFromX = 0; // 本段起点 pos（视口坐标）
  let chaseFromY = 0;
  let chaseToX = 0; // 本段终点 pos（已钳位）
  let chaseToY = 0;
  let chaseHalfW = 0; // 本段目标的换算常量：到达写 customPos 用（免得再读一次可能已变的字段）
  let chaseHalfH = 0;
  let chaseSeq = null; // 本段目标的 seq，原样回执
  let chaseStartAt = 0; // 本段起帧时刻（chaseNow 口径）
  let chaseDuration = 0; // 本段时长 ms（距离 ÷ 900 × 1000，钳 [450, 1600]）
  let chaseArrive = null; // 本段的到位回调（walkTo opts.arrive；null = 缺省回执 /miai/chase-arrived）

  /** 本窗口里的那只宠物（本页只装一只）；取不到返回 null（不抛） */
  function currentSprite() {
    try {
      if (typeof sprites !== 'undefined' && Array.isArray(sprites) && sprites[0]) return sprites[0];
    } catch (_) {
      /* 词法绑定未就绪（constants.js 未加载/TDZ）：当成没有精灵 */
    }
    return null;
  }

  /** 单调时钟：缓动进度只用它（performance 缺失退回 Date.now，够用且绝不为它抛错） */
  function chaseNow() {
    try {
      if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
        return performance.now();
      }
    } catch (_) {
      /* 落到 Date.now */
    }
    return Date.now();
  }

  /** 跑腿失败收口（同 noteQuackError 的纪律：写原因 + console.warn，绝不外抛） */
  function noteChaseError(reason) {
    api.chaseError = reason;
    try {
      console.warn('[miai-extras] 跑腿失败：' + reason);
    } catch (_) {
      /* console 不可用也不能抛 */
    }
  }

  /** 焦点上报失败收口（同上） */
  function noteFocusError(reason) {
    api.focusError = reason;
    try {
      console.warn('[miai-extras] 焦点上报失败：' + reason);
    } catch (_) {
      /* 同上 */
    }
  }

  /** goto 轮询失败收口：记原因；**只在由好转坏的那一拍**响一声（1s 一条的持续失败不刷屏） */
  function noteGotoError(reason) {
    const wasHealthy = api.gotoError === null;
    api.gotoError = reason;
    if (wasHealthy) {
      try {
        console.warn('[miai-extras] goto 轮询失败（下一拍重试）：' + reason);
      } catch (_) {
        /* 同上 */
      }
    }
  }

  /**
   * 火后不管的 JSON POST（到达回执 / 焦点上报共用）：不 await、不重试，失败只记账（catch 收干）。
   * 返回是否真的派发了请求（false = BASE 不可用或构造即抛）——计数方据此不虚报。
   */
  function postQuiet(path, body, noteError) {
    const base = resolveBase();
    if (base === null) {
      noteError('BASE 不可用（constants.js 未加载？）');
      return false;
    }
    try {
      fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then((res) => {
          if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status ? res.status : '无响应'));
        })
        .catch((err) => {
          noteError(err && err.message ? err.message : String(err));
        });
      return true;
    } catch (err) {
      noteError(err && err.message ? err.message : String(err));
      return false;
    }
  }

  /** 鱼身中心（视口坐标；pos + halfW/halfH）。取不到给 null，绝不抛（跟随/挽留共用） */
  function centerOf(sp) {
    try {
      const x = Number(sp && sp.pos && sp.pos.x);
      const y = Number(sp && sp.pos && sp.pos.y);
      const hw = Number(sp && sp.halfW);
      const hh = Number(sp && sp.halfH);
      if ([x, y, hw, hh].every(Number.isFinite)) return { x: x + hw, y: y + hh };
    } catch (_) {
      /* 取不到就当没有 */
    }
    return null;
  }

  /**
   * 把「鱼中心在视口中的坐标」记进 customPos（宠物**中心**比例——sprite.js:907-909
   * 松手落点与 position() 的 :270-272 还原式是同一套语义：rx*VIEW.w − halfW 还原左上角）。
   * 写了它，之后 resize/position() 才会把鱼停下的地方当"会话内位置"还原，而不是吸回配置角落。
   * VIEW 不可用/坐标非有限数就跳过（记账失败不是位移失败，绝不抛）。
   */
  function writeCenterCustomPos(sp, cxv, cyv) {
    try {
      const vw = Number(VIEW.w);
      const vh = Number(VIEW.h);
      if (Number.isFinite(vw) && vw > 0 && Number.isFinite(vh) && vh > 0 && Number.isFinite(cxv) && Number.isFinite(cyv)) {
        sp.customPos = { rx: cxv / vw, ry: cyv / vh };
      }
    } catch (_) {
      /* 同上 */
    }
  }

  /**
   * 'body' 钳位：把窗口 pos 夹到「**命中区**全程在 VIEW 内」——透明窗可以有大半探出
   * 屏外，但"点得动"的那部分必须在屏。命中区半宽/半高与 host.ts 的 HIT_HALF_*_RATIO
   * 同源（见文件头常量注释）。**挽留停靠与跟随帧共用这一条口径**（同一个函数，防两处漂移）。
   */
  function clampBodyPos(px, py, vw, vh, halfW, halfH, size) {
    const hw = HIT_HALF_W_RATIO * size;
    const hh = HIT_HALF_H_RATIO * size;
    return {
      x: Math.min(vw - CHASE_EDGE_PX - halfW - hw, Math.max(CHASE_EDGE_PX - halfW + hw, px)),
      y: Math.min(vh - CHASE_EDGE_PX - halfH - hh, Math.max(CHASE_EDGE_PX - halfH + hh, py)),
    };
  }

  /** 中止当前这一段跑腿：不写 customPos、不回执（拖动打断 / 新目标接管 / 精灵消失都走这里） */
  function cancelChase() {
    chaseToken++; // 旧闭包下一次醒来即自灭
    if (chaseRaf !== null) {
      try {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(chaseRaf);
      } catch (_) {
        /* 取消失败也只能放它自然过期（令牌已作废，不会再写窗口） */
      }
      chaseRaf = null;
    }
    chaseArrive = null; // 本段作废：挂着的到位回调一并丢掉（新 walkTo 会重设）
    api.chaseActive = false;
  }

  /**
   * 到位收口（所有 walkTo 共用一个口）：写 customPos → chaseArrived 计数 →
   * 分发回执：缺省回执 /miai/chase-arrived（跑腿）；带 opts.arrive 的走调用方
   * 回调（挽留的两段：回调里做状态机转换 + 回 /miai/recall-arrived）。
   */
  function finishMove(sp) {
    try {
      writeCenterCustomPos(sp, chaseToX + chaseHalfW, chaseToY + chaseHalfH);
      api.chaseActive = false;
      api.chaseArrived++;
      const cb = chaseArrive;
      chaseArrive = null;
      if (typeof cb === 'function') {
        cb(sp);
      } else {
        postQuiet(CHASE_ARRIVED_PATH, { seq: chaseSeq }, noteChaseError);
      }
    } catch (err) {
      noteChaseError(err && err.message ? err.message : String(err));
    }
  }

  /**
   * 走路：把宠物**身体中心**缓动滑到屏幕绝对坐标 (x, y)（DIP/CSS px）。
   * opts（可选，2026-10-09 补充模块二扩）：
   *   · clamp: 'window'（缺省，跑腿口径：整窗留 VIEW 内）| 'body'（只保证命中区在屏，
   *     挽留停靠用 —— 透明窗可以探出屏外，"点得动"的那块必须在屏）；
   *   · arrive: 到位回调（缺省回执 /miai/chase-arrived；挽留两段用它做状态机 + 回执）。
   * 返回是否真的出发——false 的四种情形（精灵不在 / 用户正拖着 / 坐标非法 / 环境缺 rAF 或 sendBounds）
   * 一律「不移动、不回执」：宿主自己按超时判失联，绝不让本脚本编一个假到达。
   * 中途再调一次 = 以**当前位置**为起点转向新目标（时长按剩余距离重算）。
   */
  function walkTo(x, y, seq, opts) {
    try {
      const o = opts && typeof opts === 'object' ? opts : {};
      const sp = currentSprite();
      if (!sp || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      if (sp.dragState && sp.dragState.active) return false; // 用户正拖着：这一趟不抢（不回执）
      if (typeof requestAnimationFrame !== 'function' || typeof sp.sendBounds !== 'function') return false;
      const vx = Number(VIEW.x);
      const vy = Number(VIEW.y);
      const vw = Number(VIEW.w);
      const vh = Number(VIEW.h);
      const halfW = Number(sp.halfW);
      const halfH = Number(sp.halfH);
      const size = Number(sp.size);
      const winH = Number(sp.winH);
      const m = sp.margin || {};
      const ml = Number(m.l) || 0;
      const mr = Number(m.r) || 0;
      const mt = Number(m.t) || 0;
      const mb = Number(m.b) || 0;
      if (![vx, vy, vw, vh, halfW, halfH, size, winH].every(Number.isFinite)) return false;

      // 身体中心 → pos（视口坐标），算式与依据见本节顶部【坐标系】
      let px = x - vx - halfW;
      let py = y - vy - halfH;
      // 钳位两档（opts.clamp；缺省 'window' = 跑腿的老口径）：
      //  · 'window'：整个宠物窗留在 VIEW（工作区外接矩形）内，四周留 CHASE_EDGE_PX
      //    （窗口矩形算式见本节顶部【窗口矩形】；若窗比工作区还大，Math.min 让结果为右/下界——确定且可见）；
      //  · 'body'（挽留停靠）：只保证**命中区**全程在 VIEW 内（口径在 clampBodyPos，与跟随帧同一函数）。
      if (o.clamp === 'body') {
        const c = clampBodyPos(px, py, vw, vh, halfW, halfH, size);
        px = c.x;
        py = c.y;
      } else {
        px = Math.min(vw - CHASE_EDGE_PX - size - mr, Math.max(ml + CHASE_EDGE_PX, px));
        py = Math.min(vh - CHASE_EDGE_PX - winH - mb, Math.max(mt + CHASE_EDGE_PX, py));
      }

      // 先停掉引擎自己的移动（goHome 的姿势，sprite.js:1226-1231）：抛掷/漫游都不许再改窗位
      if (typeof sp.stopThrow === 'function') sp.stopThrow();
      if (typeof sp.stopMove === 'function') sp.stopMove();
      if ('pendingMove' in sp) sp.pendingMove = null; // stopMove 已清过；显式再清一次（防供体实现漂移）
      followStop(); // 一条鱼同一时刻只有一个位移写者：任何 walkTo 起步，跟随趋近让位（同拍内不互抢）

      const fromX = Number(sp.pos && sp.pos.x) || 0;
      const fromY = Number(sp.pos && sp.pos.y) || 0;
      const dist = Math.hypot(px - fromX, py - fromY);
      const dur = Math.min(CHASE_MAX_MS, Math.max(CHASE_MIN_MS, (dist / CHASE_SPEED_PX_PER_S) * 1000));

      cancelChase(); // 新目标接管：旧段立即作废，起点 = 此刻的 pos
      const token = chaseToken;
      chaseFromX = fromX;
      chaseFromY = fromY;
      chaseToX = px;
      chaseToY = py;
      chaseHalfW = halfW;
      chaseHalfH = halfH;
      chaseSeq = Number.isFinite(seq) ? seq : null;
      chaseArrive = typeof o.arrive === 'function' ? o.arrive : null; // 到位回调（缺省走 chase-arrived 回执）
      chaseStartAt = chaseNow();
      chaseDuration = dur;
      api.chaseSeq = chaseSeq;
      api.chaseActive = true;

      // 帧体整个包在 try/catch 里：rAF 回调里抛出去就是**未捕获异常**（页面级报错 + 这条链静悄悄死掉、
      // chaseActive 永远挂着 true 骗探针）。异常一律收口成「中止 + 记原因」。
      const step = () => {
        try {
          if (token !== chaseToken) return; // 已被新目标/中止顶掉
          const s2 = currentSprite();
          if (!s2 || (s2.dragState && s2.dragState.active)) {
            cancelChase(); // 拖动打断：立刻中止（不写 customPos、不回执）
            return;
          }
          // 途中引擎自己起了漫游（playIdle 掷到 move 档 → tryMove，sprite.js:412-413）就收掉它：
          // 两条 rAF 会逐帧互抢窗口位置，且它结束时会写**自己的** customPos（sprite.js:558）盖掉我们的落点。
          if ((s2.pendingMove || s2.moveRef !== null) && typeof s2.stopMove === 'function') s2.stopMove();
          const t = Math.min(1, (chaseNow() - chaseStartAt) / chaseDuration);
          const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // cubic ease-in-out
          // 移动的是窗口（this.pos 逐帧更新）；sprite 在本窗口内不动——调用形状同 sprite.js:606
          s2.sendBounds(chaseFromX + (chaseToX - chaseFromX) * e, chaseFromY + (chaseToY - chaseFromY) * e);
          if (t < 1) {
            chaseRaf = requestAnimationFrame(step);
            return;
          }
          chaseRaf = null;
          finishMove(s2);
        } catch (err) {
          cancelChase();
          noteChaseError(err && err.message ? err.message : String(err));
        }
      };
      chaseRaf = requestAnimationFrame(step);
      return true;
    } catch (err) {
      cancelChase();
      noteChaseError(err && err.message ? err.message : String(err));
      return false;
    }
  }

  /**
   * 读到的 goto 叶子 → 是否下令出发。口径：
   *  · 首拉只记基线（对齐 events.js:265-267 的首拉语义：重启后不重放上一轮留下的旧命令）；
   *  · counter 变了才算一条新命令；data = null 的一拍只更新基线、不动身（宿主清叶子用）；
   *  · x/y 不是有限数 = 坏叶子：整条忽略（不猜坐标），等下一拍。
   */
  function applyGotoLeaf(leaf) {
    if (!leaf || typeof leaf !== 'object') return;
    const counter = leaf.counter;
    if (typeof counter !== 'number' || !isFinite(counter)) return;
    const first = api.gotoCounter === null;
    const changed = !first && counter !== api.gotoCounter;
    api.gotoCounter = counter;
    if (first || !changed) return;
    const d = leaf.data;
    if (!d || typeof d !== 'object') return;
    if (typeof d.x !== 'number' || !isFinite(d.x) || typeof d.y !== 'number' || !isFinite(d.y)) return;
    walkTo(d.x, d.y, typeof d.seq === 'number' && isFinite(d.seq) ? d.seq : null);
  }

  /** 跑一拍 goto 轮询（GET /state）：成功/失败都收干成已决 promise，循环由调用方续拍 */
  function gotoPollOnce() {
    try {
      const base = resolveBase();
      if (base === null) {
        noteGotoError('BASE 不可用（constants.js 未加载？）');
        return Promise.resolve();
      }
      return fetch(base + CHASE_STATE_PATH)
        .then((res) => {
          if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status ? res.status : '无响应'));
          return res.json();
        })
        .then((state) => {
          api.gotoPolls++;
          api.gotoError = null;
          const pets = state && state.pets;
          const main = pets && pets.main;
          applyGotoLeaf(main && main.goto);
          applyFollowLeaf(main && main.follow); // 补充模块一：电平，最新值直接应用
          applyRecallLeaf(main && main.recall); // 补充模块二：事件，counter 变了才动身
          recallWatchdog(); // 挽留走动被拖拽等打断时把状态归零（walkTo 的取消路径不回执）
          applyVitalsLeaf(main && main.vitals); // P3 ③：同一发 /state 顺带缓存饱腹读数（不新起定时器）
          ensureRoamGate(); // 精灵晚建：每拍兜底装一次（幂等，装过即秒回）
          // 设置页改动 ≤5s 到位：跟随/漫游闸门也吃这条 TTL（FLAGS_TTL_MS 已从 30s 收到 5s）
          if (Date.now() - flagsAt > FLAGS_TTL_MS) void refreshFlags();
          api.followPaused = followPausedNow(); // 暂停读数（探针）；守卫解除时下面这拍会自动续上
          ensureFollowDrive(); // 新落点/守卫解除/拖动松手后的兜底重起（幂等）
        })
        .catch((err) => {
          noteGotoError(err && err.message ? err.message : String(err));
        });
    } catch (err) {
      noteGotoError(err && err.message ? err.message : String(err)); // fetch 同步抛（URL 非法等）：不喂死循环
      return Promise.resolve();
    }
  }

  /** 轮询节奏（自适应）：跟随生效或挽留在途 → 120ms（落点跟手 / 接令快）；平时 1000ms（安静省事） */
  function gotoPollDelay() {
    return api.followOn === true || api.recallState !== 'idle' ? FOLLOW_POLL_MS : GOTO_POLL_MS;
  }

  /**
   * 起步 goto 轮询：错开 GOTO_POLL_OFFSET_MS 起、之后按 gotoPollDelay() 一拍（上一拍落定再
   * 排下一拍，同 events.js:296-300 的形状）——与 events.js 的 1s 循环错相位，两条各自拉各自的 /state。
   * 节奏自适应仍走**同一条**轮询（每个 setTimeout 现算延迟）：契约点名不新增第二条定时器。
   */
  function startGotoLoop() {
    const tick = () => {
      const again = () => {
        setTimeout(tick, gotoPollDelay());
      };
      gotoPollOnce().then(again, again); // 双保险：任何意外拒绝也不许把循环喂死
    };
    setTimeout(tick, GOTO_POLL_OFFSET_MS);
  }

  // ---------------------------------------------------------------- 跟随鼠标（补充模块一 2026-10-09）
  /* miai-follow-v1 */
  //
  // 【叶子语义】follow 是**电平**：每次 /state 的 pets.main.follow.data 是最新值
  // （{on, x, y}，落点 = 鱼**中心**的屏幕 DIP；宿主按"让位"规则算好 —— 光标进正文
  // 编辑区时给的是沿边等待点，见 host.ts followTargetFor）。叶子 counter 只在值变化
  // 时递增（宿主死区 2px），渲染端按 counter 去重、按最新值趋近。**首拉即采用**
  // （与 goto 的"首拉只记基线"不同）：这是观测不是命令，页面重载后读到的 on:true
  // 就是事实，照跟。
  //
  // 【为什么指数趋近 + 速度钳制】宿主 150ms 才写一次落点，直接瞬移会一顿一顿；
  // 每帧把剩余距离闭合 1−e^(−dt/τ)（τ=130ms）得到"平滑追"的手感；Vmax 只负责把
  // 远距离跳变压成"游过去"（首帧速度 = 距离/τ，几百像素的跳变会被钳到 1350px/s）。
  //
  // 【什么时候停】与目标差 < FOLLOW_STOP_PX 就收掉 rAF（不逐帧烧帧），并把当前
  // 位置写进 customPos（会话位置：resize/position() 时鱼留在它停下的地方）。落点
  // 再动 → 叶子 counter 变 → 重新起 loop；守卫解除/拖动松手 → 轮询拍兜底重起。
  //
  // 【暂停守卫】拖拽中 / 右键菜单开着 / 文本输入框持焦 → 只停位移，**不改
  // api.followOn**（逻辑仍 on，菜单标签不翻）—— 菜单项的三元读的是 followOn，
  // 守卫不该让用户看到"自己关了"的假象。松手/关菜单后由轮询拍自动续上。
  //
  // 【与跑腿/挽留的关系】任何 walkTo 都先 followStop()：一条鱼同一时刻只有一个
  // 位移写者。宿主在跟随条件失效时也会把电平写成 off（150ms 心跳），两条路都收敛。

  let followToken = 0; // 起停令牌：旧帧闭包对不上就自灭（同 chaseToken 的纪律）
  let followRaf = null; // 趋近帧句柄；null = 没有在烧帧
  let followTarget = null; // 最新落点 {x,y}（屏幕 DIP，鱼中心）；null = 无目标

  /** 跟随失败收口（同 noteChaseError 的纪律：写原因 + console.warn，绝不外抛） */
  function noteFollowError(reason) {
    api.followError = reason;
    try {
      console.warn('[miai-extras] 跟随失败：' + reason);
    } catch (_) {
      /* console 不可用也不能抛 */
    }
  }

  /**
   * 暂停守卫（三判据）：拖拽中 / 右键菜单开着 / 文本输入持焦 → 这一拍不动身。
   * 严格只读，不抛（任何判据取不到就当"没挡着"）。
   */
  function followPausedNow() {
    try {
      const sp = currentSprite();
      if (sp && sp.dragState && sp.dragState.active) return true; // 用户正抓着鱼：位移归他
    } catch (_) {
      /* 判据取不到：当成没挡 */
    }
    try {
      const dbg = window.__dshPetDebug;
      if (dbg && dbg.menuOpen === true) return true; // 菜单开着：光标在菜单上，追过去是骚扰
    } catch (_) {
      /* 同上 */
    }
    try {
      const ae = document.activeElement;
      if (ae && ae !== document.body) {
        const tag = (ae.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || ae.isContentEditable === true) return true; // 在打字
      }
    } catch (_) {
      /* 同上 */
    }
    return false;
  }

  /** 收掉趋近帧（幂等）：停在哪就是哪，并把当前位置记进 customPos（会话位置） */
  function followStop() {
    followToken++;
    if (followRaf !== null) {
      try {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(followRaf);
      } catch (_) {
        /* 取消失败也只能放它自然过期（令牌已作废） */
      }
      followRaf = null;
    }
    api.followMoving = false;
    const sp = currentSprite();
    const c = sp ? centerOf(sp) : null;
    if (sp && c) writeCenterCustomPos(sp, c.x, c.y); // 停下的地方 = 会话位置（resize 后不回角落）
  }

  /**
   * 起趋近帧（幂等）：条件不足返回 false，不抛。叶子应用与轮询拍都调它 ——
   * 后者是"守卫解除/拖动松手/精灵重建"的兜底重起点。每个条件的理由：
   *   · followOn/target：没有电平就没有目标；· chaseActive / recallState：跑腿或
   *   挽留的走动拥有这条鱼；· currentSprite/rAF/sendBounds：环境齐不齐。
   */
  function ensureFollowDrive() {
    try {
      if (followRaf !== null) return false; // 已在烧帧：不叠第二条
      if (api.followOn !== true || !followTarget) return false;
      if (api.chaseActive) return false;
      if (api.recallState !== 'idle') return false;
      const sp = currentSprite();
      if (!sp || typeof requestAnimationFrame !== 'function' || typeof sp.sendBounds !== 'function') return false;
      if (followPausedNow()) {
        api.followPaused = true;
        return false;
      }
      api.followPaused = false;
      api.followError = null; // 这一趟正常起步：清历史失败（同 quackCount 的成功清账口径）
      followToken++;
      const token = followToken;
      let lastAt = chaseNow(); // 上一帧时刻（本帧闭包的；起帧时归零，防陈年 dt）
      api.followMoving = true;
      // 帧体整个包在 try/catch 里（同跑腿）：rAF 回调里抛出去就是未捕获异常 + 静默死链
      const step = () => {
        try {
          if (token !== followToken) return; // 已被收帧/重起顶掉
          const s2 = currentSprite();
          if (!s2) {
            followStop(); // 精灵没了（重建窗口的瞬间）：收帧，轮询拍兜底重起
            return;
          }
          if (followPausedNow()) {
            api.followPaused = true;
            followStop(); // 守卫挡下：收帧，松手后轮询拍续上
            return;
          }
          // 途中引擎自己起了漫游就收掉它：两条 rAF 会逐帧互抢窗口位置（同跑腿的理由）
          if ((s2.pendingMove || s2.moveRef !== null) && typeof s2.stopMove === 'function') s2.stopMove();
          const vx = Number(VIEW.x);
          const vy = Number(VIEW.y);
          const vw = Number(VIEW.w);
          const vh = Number(VIEW.h);
          const halfW = Number(s2.halfW);
          const halfH = Number(s2.halfH);
          const size = Number(s2.size);
          const c = centerOf(s2);
          const t = followTarget;
          if (!c || !t || ![vx, vy, vw, vh, halfW, halfH, size].every(Number.isFinite)) {
            followStop();
            return;
          }
          // 落点（鱼**中心**的屏幕 DIP）→ 视口中心；body 钳位仍按 pos 口径算（命中区全程
          // 在屏），钳完换回中心。**【口径】c / nx 是"中心"（sendBounds 时才减 halfW）**。
          // 曾把钳位后的 pos 直接当中心和 c 比（dx = tpx − c.x），鱼收敛到"中心 = 目标 pos"
          // —— 停在光标左上半身位的地方（斜向 ~90px 且自称"到位"）。
          const cb = clampBodyPos(t.x - vx - halfW, t.y - vy - halfH, vw, vh, halfW, halfH, size);
          const tpx = cb.x + halfW; // 钳位后的目标**中心**（视口坐标）
          const tpy = cb.y + halfH;
          const dx = tpx - c.x;
          const dy = tpy - c.y;
          if (Math.hypot(dx, dy) < FOLLOW_STOP_PX) {
            writeCenterCustomPos(s2, c.x, c.y); // 到位收帧：把会话位置记上
            api.followMoving = false;
            followRaf = null;
            return;
          }
          const now = chaseNow();
          const dt = Math.min(1 / 30, Math.max(0, (now - lastAt) / 1000)); // 秒；钳上限防标签页节流后一跳
          lastAt = now;
          const k = 1 - Math.exp(-((dt * 1000) / FOLLOW_TAU_MS)); // 指数趋近：闭合剩余距离的比例
          let nx = c.x + dx * k;
          let ny = c.y + dy * k;
          const maxStep = FOLLOW_VMAX_PX_S * dt; // 远距离别嗖地飞：首帧步长钳到 Vmax·dt
          const stepDist = Math.hypot(nx - c.x, ny - c.y);
          if (stepDist > maxStep && stepDist > 0) {
            const s3 = maxStep / stepDist;
            nx = c.x + (nx - c.x) * s3;
            ny = c.y + (ny - c.y) * s3;
          }
          // 移动的是窗口（pos 逐帧更新）；sprite 在本窗口内不动——调用形状同 sprite.js:606
          s2.sendBounds(nx - halfW, ny - halfH);
          api.followSteps++;
          followRaf = requestAnimationFrame(step);
        } catch (err) {
          followStop();
          noteFollowError(err && err.message ? err.message : String(err));
        }
      };
      followRaf = requestAnimationFrame(step);
      return true;
    } catch (err) {
      followStop();
      noteFollowError(err && err.message ? err.message : String(err));
      return false;
    }
  }

  /**
   * 把「跟随是否生效」上报给 helper 主进程（咪爱补丁 2026-10-10，petBridge.setFollowActive）。
   *
   * 【为什么必须上报】跟随 = 窗口追着光标走 ⇒ 光标永远在窗内 ⇒ helper 兜底判定
   * （pointer-target.js 的 decideWindowIgnore）里「光标在窗外 → 恢复穿透」那条**唯一**的
   * 复位分支永不触发，而"窗内、不在宠物身上"的余量区分支是「保持当前状态」——于是只要
   * 鱼有一次追到光标底下（或光标扫过鱼身、或点开右键菜单那一刻判成可交互），整只两倍
   * 宠物体积的透明窗就锁死在可交互，跟着光标吃掉全桌面点击（主人实测："开启跟随后鼠标
   * 无法点击程序内的任何东西"）。渲染端自己的 mouseleave 也复位不了：窗口跟着走，光标
   * 根本出不去。helper 拿到这个标记后，跟随期间余量区一律放行点击（宠物身上仍可交互，
   * 右键菜单照常点得到）。
   *
   * 【节流】只在翻转时发一次（与 sprite.js 的 setInputBusy 同款）；petBridge 缺席（浏览器里
   * 单跑 extras）静默跳过 —— 不记失败也不写 followActiveSent，等桥出现再补发。
   */
  function syncFollowActive() {
    const on = api.followOn === true;
    if (on === api.followActiveSent) return;
    try {
      const b = window.petBridge;
      if (!b || typeof b.setFollowActive !== 'function') return;
      b.setFollowActive(on);
      api.followActiveSent = on;
      api.followActiveError = null;
    } catch (err) {
      api.followActiveErrors += 1;
      api.followActiveError = err && err.message ? err.message : String(err);
    }
  }

  /**
   * 读到的 follow 叶子 → 电平应用。口径：
   *  · counter 不变 = 无事（宿主死区内不重写）；变了按 data 整值应用；
   *  · **首拉即采用**（理由见节顶）；data 不是 {on:true,x,y} → 当成 off；
   *  · off / 坏坐标 → 收帧 + 停位移（"关掉 = 会话里的跟随立刻停"），停在哪记哪。
   * 【为什么包一层】叶子是 followOn 变化时唯一的写口，而"跟随生效"这件事除了驱动趋近帧，
   * 还必须上报 helper（见 syncFollowActive）—— exit 点有三个（off / 坏坐标 / 正常），
   * 包一层比在每个 return 前手写一行更不容易漏（漏了 = 跟随期间整窗吞点击）。
   */
  function applyFollowLeaf(leaf) {
    try {
      applyFollowLeafInner(leaf);
    } finally {
      syncFollowActive();
    }
  }

  function applyFollowLeafInner(leaf) {
    if (!leaf || typeof leaf !== 'object') return;
    const counter = leaf.counter;
    if (typeof counter !== 'number' || !isFinite(counter)) return;
    const changed = counter !== api.followCounter;
    api.followCounter = counter;
    if (!changed) return;
    const d = leaf.data;
    const on = !!(d && typeof d === 'object' && d.on === true);
    if (!on) {
      followTarget = null; // 帧体/起帧判据读的操作变量
      api.followTarget = null; // 探针读数（两个名字必须一起清，漏一个 = 跟不动/停不下）
      api.followOn = false;
      api.followError = null; // 正常读到一条 off：链路健康（清历史失败）
      followStop();
      return;
    }
    const x = d.x;
    const y = d.y;
    if (typeof x !== 'number' || !isFinite(x) || typeof y !== 'number' || !isFinite(y)) {
      followTarget = null;
      api.followTarget = null;
      api.followOn = false;
      followStop();
      noteFollowError('follow 叶子 on=true 但坐标非法：' + String(x) + ',' + String(y));
      return;
    }
    // 【两个名字一个对象】followTarget 是帧体与 ensureFollowDrive 读的操作变量；
    // api.followTarget 只是探针读数。**唯一真源 = followTarget**，api 那份是同一对象
    // 的引用（曾漏写操作变量 ⇒ 叶子读到了、drive 却永远起不来：跟随整个是死的）。
    const target = { x: x, y: y };
    followTarget = target;
    api.followTarget = target;
    api.followOn = true;
    api.followError = null;
    ensureFollowDrive();
  }

  // ---------------------------------------------------------------- 关闭挽留位移（补充模块二 2026-10-09）
  /* miai-recall-v1 */
  //
  // 【叶子语义】recall 是**事件**（同 goto）：counter 变了才是一条新命令；宿主每段
  // 命令给**新 seq**（go 一条、back 又是一条，见 host.ts endRecall 的 recallSeq += 1），
  // 到位后按 {seq, phase} 回执 /miai/recall-arrived —— seq 对不上宿主自己会静默作废，
  // 渲染端这里不做 seq 配平（命令来一条办一条，回执原样带上本段 seq）。
  //
  // 【原处 = 只在 idle 出发时记】鱼中心（屏幕 DIP）+ customPos 原样（对象副本或 null）。
  // 'back' 到位时**原样还原** customPos —— 出发前是配置角落（null）就回配置角落语义，
  // 出发前有会话位置就回那个位置语义。途中反复触发（go 后再 go）不重记原处：
  // 原处永远是"这一轮挽留开始前"的地方。
  //
  // 【两段都用 body 钳位】宿主给的停靠点在关闭键旁，宠**窗**可能有大半探出屏外（透明窗
  // 没关系），但**命中区**必须全程在屏 —— walkTo(opts.clamp='body')。回来时同样用 body：
  // 「原处本来就满足 window 档」是错的 —— 跟随允许鱼贴着工作区下缘待着（窗底在屏外，
  // 命中区在屏），记下的原处恰恰不满足 window 档，回程会被钳掉一截（第 9 轮 G8b 实证）。
  //
  // 【走不成就当没发生】walkTo 拒绝（用户正拖着/精灵不在）时状态直接归零 +
  // recallAborts 计数：鱼留在原地、不回执，宿主那边只是没等到撒娇动画，没有任何"假到位"。
  // 走动中途被拖拽打断同规（walkTo 的取消路径不回执 → 由轮询拍的看门狗收尾）。

  let recallOriginPos = null; // 出发前的鱼中心（屏幕 DIP）；null = 没记下（回 idle 就清）
  let recallOriginCustom = null; // 出发前的 customPos 原样（防御性拷贝或 null）
  let recallSeq = 0; // 本段的 seq（回执原样带上；宿主按它作废陈旧回执）

  /** 挽留失败收口（同 noteChaseError 的纪律） */
  function noteRecallError(reason) {
    api.recallError = reason;
    try {
      console.warn('[miai-extras] 挽留位移失败：' + reason);
    } catch (_) {
      /* console 不可用也不能抛 */
    }
  }

  /** 清掉原处备忘录（回到 idle 的收尾；幂等） */
  function clearRecallOrigin() {
    recallOriginPos = null;
    recallOriginCustom = null;
  }

  /** 记下出发前的原处：鱼中心（屏幕 DIP）+ customPos 原样（拷贝，防之后被就地改掉） */
  function saveRecallOrigin() {
    clearRecallOrigin();
    const sp = currentSprite();
    if (!sp) return;
    const c = centerOf(sp);
    const vx = Number(VIEW.x);
    const vy = Number(VIEW.y);
    if (c && Number.isFinite(vx) && Number.isFinite(vy)) recallOriginPos = { x: vx + c.x, y: vy + c.y };
    const cp = sp.customPos;
    recallOriginCustom =
      cp && typeof cp === 'object' && Number.isFinite(Number(cp.rx)) && Number.isFinite(Number(cp.ry))
        ? { rx: Number(cp.rx), ry: Number(cp.ry) }
        : null;
  }

  /** go 段到位：进入停靠态 + 回执（宿主随即播撒娇动画 PLEAD） */
  function onRecallGoArrived() {
    api.recallGoArrived++;
    api.recallState = 'parked';
    postQuiet(RECALL_ARRIVED_PATH, { seq: recallSeq, phase: 'go' }, noteRecallError);
  }

  /** back 段到位：原样还原 customPos → 回 idle → 回执 */
  function onRecallBackArrived(sp) {
    try {
      if (sp) sp.customPos = recallOriginCustom ? { rx: recallOriginCustom.rx, ry: recallOriginCustom.ry } : null;
    } catch (err) {
      noteRecallError('还原 customPos 失败：' + (err && err.message ? err.message : String(err)));
    }
    api.recallBackArrived++;
    api.recallState = 'idle';
    clearRecallOrigin();
    postQuiet(RECALL_ARRIVED_PATH, { seq: recallSeq, phase: 'back' }, noteRecallError);
  }

  /** 看门狗（每拍轮询跑）：走动没了但状态还挂着 = 被拖拽打断等 → 归零 + 归因 */
  function recallWatchdog() {
    if ((api.recallState === 'going' || api.recallState === 'backing') && !api.chaseActive) {
      api.recallState = 'idle';
      clearRecallOrigin();
      api.recallAborts++;
    }
  }

  /**
   * 读到的 recall 叶子 → 状态机。口径同 goto：首拉只记基线、counter 变了才算新命令、
   * data null 只更新基线。phase='go' 走停靠（body 钳位），'back' 走归位（window 钳位）。
   */
  function applyRecallLeaf(leaf) {
    if (!leaf || typeof leaf !== 'object') return;
    const counter = leaf.counter;
    if (typeof counter !== 'number' || !isFinite(counter)) return;
    const first = api.recallCounter === null;
    const changed = !first && counter !== api.recallCounter;
    api.recallCounter = counter;
    if (first || !changed) return;
    const d = leaf.data;
    if (!d || typeof d !== 'object') return; // 叶子被宿主清过：不动身（同 goto）
    const seq = Number(d.seq);
    if (!Number.isInteger(seq) || seq <= 0) {
      noteRecallError('叶子 seq 非法：' + String(d.seq));
      return;
    }
    if (d.phase === 'go') {
      const x = Number(d.x);
      const y = Number(d.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        noteRecallError('go 段坐标非法：' + String(d.x) + ',' + String(d.y));
        return;
      }
      if (api.recallState === 'idle') saveRecallOrigin(); // 只在 idle 出发时记原处（途中触发不重记）
      recallSeq = seq;
      api.recallState = 'going';
      if (!walkTo(x, y, seq, { clamp: 'body', arrive: onRecallGoArrived })) {
        api.recallState = 'idle'; // 没出发（拖着/精灵不在）：鱼留在原地，绝不编造到达
        clearRecallOrigin();
        api.recallAborts++;
      }
      return;
    }
    if (d.phase === 'back') {
      if (api.recallState === 'idle') return; // 没在挽留：零动作（幂等）
      if (api.recallState === 'backing') return; // 重复命令（同一轮只会有一条 back）
      const origin = recallOriginPos;
      if (!origin) {
        api.recallState = 'idle'; // 没有原处可回（不该发生）：归零 + 归因，不编造位移
        clearRecallOrigin();
        api.recallAborts++;
        return;
      }
      recallSeq = seq;
      api.recallState = 'backing';
      // 回程也必须 body 档：原处若在工作区下缘（跟随把窗带到贴底是常态——身体可见即可，
      // 窗本就可有一截在屏外），缺省的 window 档会把目标钳到整窗在屏的位置，归位点比
      // 原处高出一大截（第 9 轮 G8b 实测 Δy=237 DIP、Δx=0——x 没触界所以看不出破绽）。
      if (!walkTo(origin.x, origin.y, seq, { clamp: 'body', arrive: onRecallBackArrived })) {
        api.recallState = 'idle';
        clearRecallOrigin();
        api.recallAborts++;
      }
      return;
    }
    noteRecallError('phase 非法：' + String(d.phase));
  }

  // ---------------------------------------------------------------- 自主漫游闸门（补充模块一 2026-10-09）
  /* miai-roam-gate-v1 */
  //
  // 「允许大肥鱼饥饿时活跃乱跑」总闸与分档节流。实施点必须是**引擎的 tryMove**
  // （sprite.js:499）—— 自主漫游的唯一入口是 playIdle 掷到 move 档时的一句
  // this.tryMove()（:413）；菜单点播移动动画走的是 tryMove(name)（:1097），
  // **指名道姓的用户命令不受闸门管**（闸门只拦无参调用）。
  //
  // 【为什么返回 true】playIdle 把 tryMove() 的 true 读作"已有一场移动进行中"，
  // 转而重播当前动画（:420-423）——原地不动、且**绝不退化**去播别的动作。
  // 若返回 false，playIdle 会退到 pickCategoryAction 挑一个新动作播（:414-416），
  // 那是"被拒了还换个花样"的错误观感。拦下 = 让这条链原地踏步。
  //
  // 【包装在原型上】renderer.js 的 boot() 失败重试会重建 sprite（:80-81 新实例），
  // 实例级包装会随旧实例被丢掉；原型包装一次，之后的新实例照样在闸门里。
  //
  // 【分档（types.ts PetConfig.hungryRoam 的正式口径）】总闸关 = 完全不自主移动；
  // 总闸开 = 活跃度随饱腹度分档：饱食（≥50）照旧、中度（20-49）≥90s 才放一次、
  // 重度（1-19）≥180s 才放一次（近乎不动；催饭在宿主大脑）、归零趴窝。
  // 读数缺失（vitals 还没到）不拦 —— 宁可先照旧，也别让鱼在首拉前冻住。
  //
  // 【判定炸了就放行】闸门是体验优化不是安全属性：任何异常都放行 + 记 roamError ——
  // 一份坏读数不该让鱼从此变成雕塑（错误可见，行为不坏）。

  /** 漫游失败收口（同 noteChaseError 的纪律） */
  function noteRoamError(reason) {
    const wasHealthy = api.roamError === null;
    api.roamError = reason;
    if (wasHealthy) {
      try {
        console.warn('[miai-extras] 漫游闸门异常（本次放行）：' + reason);
      } catch (_) {
        /* console 不可用也不能抛 */
      }
    }
  }

  /** 档位节流窗口（ms）：未到饥饿档返回 0（不节流） */
  function roamGapFor(satiety) {
    if (typeof satiety !== 'number' || !isFinite(satiety)) return 0;
    if (satiety < HUNGER_MEDIUM_AT) return ROAM_GAP_SEVERE_MS;
    if (satiety < HUNGER_MILD_AT) return ROAM_GAP_MEDIUM_MS;
    return 0;
  }

  /**
   * 闸门判定（六判据，见节顶注释）。**放行时把 lastRoamAt 记上**（分档节流基准）——
   * 这个副作用就是"最近一次真的让它出门"的记账点，别在别处再记。
   */
  function roamBlockedNow() {
    if (api.recallState !== 'idle') return true; // 挽留在途/停靠：趴在 X 旁的鱼不许溜达
    if (api.chaseActive) return true; // 跑腿在飞：位移被借走
    if (api.followOn === true) return true; // 跟随生效：贴人走就是它此刻的"位移"
    if (api.roamAllowed !== true) return true; // 总闸关：完全不自主移动
    const v = api.petVitals;
    const sat = v && typeof v.satiety === 'number' && isFinite(v.satiety) ? v.satiety : null;
    if (sat === null) return false; // 首拉前：照旧（宁可先让它走，也别冻住）
    if (sat < HUNGER_SEVERE_AT) return true; // 归零：趴窝（"彻底死机"的渲染端一半）
    const gap = roamGapFor(sat);
    if (gap > 0 && Date.now() - api.lastRoamAt < gap) return true; // 饥饿档：行动迟缓/近乎不动
    api.lastRoamAt = Date.now();
    return false;
  }

  /** 装闸门（幂等）：包装 Sprite 原型的 tryMove。精灵还没建返回 false（轮询拍兜底重试） */
  function ensureRoamGate() {
    try {
      const sp = currentSprite();
      if (!sp) return false; // 精灵晚建：轮询拍再试
      const proto = Object.getPrototypeOf(sp);
      if (!proto) {
        noteRoamError('拿不到 Sprite 原型');
        return false;
      }
      if (proto.__miaiRoamGated === true) {
        api.roamGated = true;
        return true;
      }
      const orig = proto.tryMove;
      if (typeof orig !== 'function') {
        noteRoamError('tryMove 不是函数（供体漂移？）');
        return false;
      }
      proto.tryMove = function (preferredName) {
        try {
          // 只拦**无参**调用（playIdle 的随机漫游）；tryMove(name) 是菜单点播的用户命令，放行
          if (preferredName === undefined && roamBlockedNow()) {
            api.roamSuppressed++;
            return true; // 「忙」：playIdle 重播当前动画，原地踏步（不退化播别的，见节顶）
          }
        } catch (err) {
          noteRoamError('判定异常（本次放行）：' + (err && err.message ? err.message : String(err)));
        }
        return orig.apply(this, arguments);
      };
      proto.__miaiRoamGated = true;
      api.roamGated = true;
      return true;
    } catch (err) {
      noteRoamError('闸门安装失败：' + (err && err.message ? err.message : String(err)));
      return false;
    }
  }

  /** 探针/菜单路由口：立刻补一拍 /state + flags（不等轮询节奏；火后不管，内部各自收干） */
  function refreshStateNow() {
    gotoPollOnce();
    void refreshFlags();
  }

  // ---------------------------------------------------------------- 焦点上报（/miai/pet-focus）

  /** 火后不管地报一次窗口焦点（body {focused}：宿主据此判「鱼在不在前台」） */
  function postFocus(focused) {
    if (postQuiet(FOCUS_PATH, { focused: !!focused }, noteFocusError)) {
      api.focusReports++;
      api.lastFocus = !!focused;
    }
  }

  function onWinFocus() {
    try {
      postFocus(true);
    } catch (_) {
      /* 绝不外抛 */
    }
  }

  function onWinBlur() {
    try {
      postFocus(false);
    } catch (_) {
      /* 同上 */
    }
  }

  // 窗口级 focus/blur（Electron 窗口可聚焦：main.js:424-427 focusable:true，对话输入框要用）
  try {
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('focus', onWinFocus);
      window.addEventListener('blur', onWinBlur);
    }
  } catch (err) {
    try {
      noteFocusError('监听注册失败：' + (err && err.message ? err.message : String(err)));
    } catch (_) {
      /* 注册失败也只能写错误，不许让页面塌 */
    }
  }

  // 初始化时若已经在前台（show:false → show() 会带焦点），立刻补报一次 true：
  // 否则宿主只有等到第一次失焦才知道我们曾经有焦点。
  try {
    if (typeof document.hasFocus === 'function' && document.hasFocus()) postFocus(true);
  } catch (_) {
    /* hasFocus 不可用/抛错：当作"不在前台"，下次 blur/focus 一拍自然会校准 */
  }

  try {
    startGotoLoop();
  } catch (err) {
    noteGotoError('轮询启动失败：' + (err && err.message ? err.message : String(err)));
  }

  // 漫游闸门：这里先装一次（精灵多半还没建、装了就是重复秒回）；轮询拍里每拍兜底重试
  try {
    ensureRoamGate();
  } catch (err) {
    noteRoamError('闸门安装失败：' + (err && err.message ? err.message : String(err)));
  }

  // ── 状态行（P3 ③ 2026-10-08 饱腹条；UI 大修轮 2026-10-09 两段式；V2-23 2026-10-15 加读数行）──
  /* miai-hunger-v1 */
  //
  // 契约（2026-10-15 V2-23 版）：菜单打开时在既有菜单项**之前**插一条三段式「状态行」——
  //   ① div.miai-hunger-label，文本 = `🍚 饱腹度：N%`（固定格式，节点由本文件自己造；
  //      N = 四舍五入并钳到 0..100 的 satiety）；
  //   ② div.miai-hunger-track > div.miai-hunger-fill（宽度 = satiety%，颜色按五档）；
  //   ③ div.miai-vitals-line，文本 = `🍙 大白饭 N 碗 · ❤ 好感度 K%`（固定格式；V2-23
  //      主人裁定「必须优化得优化用户体验」——用户就在鱼身上做养成，菜单里却只看得到
  //      饱腹度：喂饭前不知道饭盒里有几碗、好感度在整个鱼身上零读数）。N/K 四舍五入
  //      钳界（好感与 satiety 同用 hungerPercent）；**非有限数画占位**（好感 `--%`、
  //      大白饭 `--`）—— 还没读到 ≠ 0，不许替鱼编数字。
  // 行内文案 = ①③ 两行固定格式文本（② 是图形），除此之外一个字符都不许加。
  //
  // 【旧契约废止记录】原「条内零中文、文本只匹配 /^\d+%$/」作废（2026-10-09 主人点
  // 名要文字标注：光一条彩条没人知道它是什么）。旧纪律的动机是"本文件不在文案闸门
  // 的扫描面（闸门只扫 .vue/.ts 里 copy.ts 的出口），写中文 = 绕闸门"——新契约把它
  // 收窄成「行内只允许这些固定格式文本」，文案存在于契约文本里，不再是无主文案。
  // 术语：显示「饱腹度」（=satiety，100 最饱；主人原话写「饥饿度」，与侧栏/总览对齐
  // 统一用「饱腹度」，验收报告交代这处措辞判定）与「好感度」（=affection，与侧栏
  // ❤ 徽记同词）。改这两行字 = 改契约，先改文档。
  //
  // 数据源 = 既有 goto 轮询的同一发 /state（pets.main.vitals 叶子，counter 严格
  // 递增；data 里 satiety/rice/mood/affection 四个读数宿主一直在发，2026-10-15 前
  // 本文件只缓存了前三个，affection 在归一化那步被丢掉 = 上面说的零读数）。
  // 不新增第二条定时器（契约 ③ 点名）。
  //
  // 【为什么注入后必须重新钳制】vendor 在 append 菜单时量过一次面板高度再把 top
  // 钳进可视区（shared-core.js:730-732），我们**后插**的条会把面板撑高 —— 贴底
  // 打开时底边就溢出视口。钳制口径与 vendor 一致（上边 ≥ 4、下边 ≤ 视口 − 4），
  // 只在真的越界时才动；同面板已有条 = 只上色不重插（幂等）。
  //
  // 【vitals 缺 = 不摆坏行】读数还没到就画一条 0% 的灰条，会被误读成"饿扁了" ——
  // 宁可不画（skip 计数可归因），等读数到了下一拍/下一次开菜单自然补上。

  /** vitals 读数失败收口（同 noteGotoError：写原因 + 只在由好转坏那一拍 warn） */
  function noteVitalsError(reason) {
    const wasHealthy = api.vitalsError === null;
    api.vitalsError = reason;
    if (wasHealthy) {
      try {
        console.warn('[miai-extras] vitals 读数失败（保留上一次读数）：' + reason);
      } catch (_) {
        /* console 不可用也不能抛 */
      }
    }
  }

  /** 进度条构建/钳制异常收口（同 noteMenuThemeError 的纪律） */
  function noteMenuHungerError(reason) {
    const wasHealthy = api.menuHungerError === null;
    api.menuHungerError = reason;
    if (wasHealthy) {
      try {
        console.warn('[miai-extras] 饱腹进度条异常：' + reason);
      } catch (_) {
        /* 同上 */
      }
    }
  }

  /** 百分比：非有限数 → 0；四舍五入后钳 [0,100]（宽度与文本同源，不许两处各算一遍） */
  function hungerPercent(satiety) {
    if (typeof satiety !== 'number' || !isFinite(satiety)) return 0;
    return Math.max(0, Math.min(100, Math.round(satiety)));
  }

  /** 档 → 颜色：从高到低取第一格满足（闭下界，与 shared/pet.ts petHungerTier 同口径） */
  function hungerColor(satiety) {
    if (typeof satiety !== 'number' || !isFinite(satiety)) return HUNGER_EMPTY_COLOR;
    for (let i = 0; i < HUNGER_BAR_COLORS.length; i++) {
      if (satiety >= HUNGER_BAR_COLORS[i][0]) return HUNGER_BAR_COLORS[i][1];
    }
    return HUNGER_EMPTY_COLOR;
  }

  /**
   * 读数行文本（契约③，唯一拼装出口 —— paint 与任何自检都从这走，格式只此一处）：
   * `🍙 大白饭 N 碗 · ❤ 好感度 K%`。碗数四舍五入钳 ≥0（上限不钳：饭盒 999 碗是合法读数，
   * 编个上限反而说谎）；K 与 satiety 同用 hungerPercent（同为 0..100 的读数，口径不分家）。
   * 非有限数（宿主旧版没带这个读数）画占位：好感 `--%`（与侧栏徽记同款）、大白饭 `--`
   * （碗数没有现成占位样式，省去单位免得「-- 碗」被读成某个量）—— 还没读到 ≠ 0。
   */
  function vitalsLineText(v) {
    const rice =
      v && typeof v.rice === 'number' && isFinite(v.rice) ? String(Math.max(0, Math.round(v.rice))) : '--';
    const aff = v && typeof v.affection === 'number' && isFinite(v.affection) ? hungerPercent(v.affection) + '%' : '--%';
    return VITALS_RICE_PREFIX + rice + VITALS_RICE_SUFFIX + aff;
  }

  /**
   * 建一条三段式状态行（样式全内联）：
   *   div.miai-hunger-bar（列向）
   *     ├─ div.miai-hunger-label ← 文本 = `🍚 饱腹度：N%`（契约①，paint 时写）
   *     ├─ div.miai-hunger-track > div.miai-hunger-fill（契约②）
   *     └─ div.miai-vitals-line ← 文本 = `🍙 大白饭 N 碗 · ❤ 好感度 K%`（契约③，V2-23）
   * 标签在上、条居中、读数行在下。高度记在注释里（单测的假几何按它取值）：
   * padding 6×2 + 标签 14 + gap 4 + 轨道 6 + gap 4 + 读数行 14 = 54
   */
  function buildHungerBar() {
    const bar = document.createElement('div');
    bar.className = HUNGER_BAR_CLASS;
    bar.style.display = 'flex';
    bar.style.flexDirection = 'column';
    bar.style.gap = '4px';
    bar.style.padding = '6px 10px';
    const label = document.createElement('div');
    label.className = 'miai-hunger-label';
    label.style.fontSize = '11px';
    label.style.lineHeight = '14px';
    const track = document.createElement('div');
    track.className = 'miai-hunger-track';
    track.style.width = '100%';
    track.style.height = '6px';
    track.style.borderRadius = '3px';
    track.style.background = 'rgba(128,128,128,.28)';
    track.style.overflow = 'hidden';
    const fill = document.createElement('div');
    fill.className = 'miai-hunger-fill';
    fill.style.height = '100%';
    fill.style.borderRadius = '3px';
    track.appendChild(fill);
    const line = document.createElement('div');
    line.className = VITALS_LINE_CLASS;
    line.style.fontSize = '11px';
    line.style.lineHeight = '14px';
    bar.appendChild(label);
    bar.appendChild(track);
    bar.appendChild(line);
    return bar;
  }

  /** 按读数给行上色/上宽度/上两行文本（v 为 null 时按 0 画；调用方通常只在有读数时用） */
  function paintHungerBar(bar, v) {
    const satiety = v && typeof v.satiety === 'number' ? v.satiety : 0;
    const pct = hungerPercent(satiety);
    const fill = typeof bar.querySelector === 'function' ? bar.querySelector('.miai-hunger-fill') : null;
    const label = typeof bar.querySelector === 'function' ? bar.querySelector('.miai-hunger-label') : null;
    const line = typeof bar.querySelector === 'function' ? bar.querySelector('.' + VITALS_LINE_CLASS) : null;
    if (fill) {
      fill.style.width = pct + '%';
      fill.style.background = hungerColor(satiety);
    }
    if (label) label.textContent = HUNGER_LABEL_PREFIX + pct + '%';
    if (line) line.textContent = vitalsLineText(v);
  }

  /** 从面板往上找 .dsh-pet-menu 根，读 shared-core 边界翻折补丁落的 __dshPetClampRect
   *  （菜单真实可见带 = helper 窗 ∩ 工作区）。缺席/形状坏 → null（回落口径由调用方决定）。 */
  function readMenuClampRect(panel) {
    let node = panel;
    let root = null;
    while (node) {
      if (node.classList && typeof node.classList.contains === 'function' && node.classList.contains('dsh-pet-menu')) {
        root = node;
        break;
      }
      node = node.parentNode;
    }
    const c = root && root.__dshPetClampRect;
    if (!c || typeof c !== 'object') return null;
    for (const k of ['x', 'y', 'w', 'h']) {
      if (typeof c[k] !== 'number' || !isFinite(c[k])) return null;
    }
    if (!(c.w > 0 && c.h > 0)) return null;
    return { x: c.x, y: c.y, w: c.w, h: c.h };
  }

  /** 注入后重钳面板位置：上下界读菜单根的 __dshPetClampRect（**真实可见带** —— 图三修正：
   *  helper 窗比屏幕大，window.innerHeight 含屏外带，拿它当上界就钳不动贴底菜单、底行出屏）。
   *  读数缺席才回落视口，且必须计数 + 一条 warn —— 不许静默拿 vh 装成功。 */
  function reclampMenuPanel(panel) {
    try {
      const cr = readMenuClampRect(panel);
      const vh = typeof window !== 'undefined' && isFinite(window.innerHeight) ? window.innerHeight : 0;
      const y0 = cr ? cr.y : 0;
      const y1 = cr ? cr.y + cr.h : vh;
      if (!(y1 > y0 + MENU_EDGE_PX)) return;
      if (!cr) {
        api.menuReclampFallbacks++;
        try {
          console.warn('[miai-extras] 菜单可见带读数缺席，重钳回落视口（innerHeight=' + vh + '）');
        } catch (_) {
          /* console 不可用也不能抛 */
        }
      }
      const h = typeof panel.offsetHeight === 'number' ? panel.offsetHeight : 0;
      let top = parseFloat(panel.style && panel.style.top);
      if (!isFinite(top) && panel.getBoundingClientRect) top = panel.getBoundingClientRect().top;
      if (!isFinite(top)) return;
      const want = Math.max(y0 + MENU_EDGE_PX, Math.min(top, y1 - MENU_EDGE_PX - h));
      if (want !== top) {
        panel.style.top = want + 'px';
        api.menuHungerReclamps++;
      }
    } catch (err) {
      noteMenuHungerError('菜单钳制失败：' + (err && err.message ? err.message : String(err)));
    }
  }

  /** 菜单在场时同步饱腹行：已有 = 只刷新读数；没有 = 前插一条（vitals 缺 → 不摆坏行） */
  function syncHungerBar() {
    try {
      if (!document || typeof document.querySelector !== 'function') return;
      const menu = document.querySelector('.dsh-pet-menu');
      if (!menu || typeof menu.querySelector !== 'function') return;
      const panel = menu.querySelector('.dsh-pet-menu-column') || menu;
      const existing = typeof panel.querySelector === 'function' ? panel.querySelector('.' + HUNGER_BAR_CLASS) : null;
      if (existing) {
        paintHungerBar(existing, api.petVitals); // 同一面板：更新读数不重插
        return;
      }
      if (!api.petVitals) {
        api.menuHungerSkips++; // 读数没到：宁可不画，也不画一条假的 0%
        return;
      }
      const bar = buildHungerBar();
      paintHungerBar(bar, api.petVitals);
      if (typeof panel.insertBefore === 'function' && panel.firstChild) {
        panel.insertBefore(bar, panel.firstChild); // 契约：插在既有菜单项**之前**
      } else if (typeof panel.appendChild === 'function') {
        panel.appendChild(bar);
      } else {
        noteMenuHungerError('菜单面板没有 insertBefore/appendChild');
        return;
      }
      api.menuHungerBars++;
      reclampMenuPanel(panel);
    } catch (err) {
      noteMenuHungerError('进度条同步失败：' + (err && err.message ? err.message : String(err)));
    }
  }

  /**
   * 读到的 vitals 叶子 → 缓存 + 菜单在场就刷新。口径：
   *  · counter 数值且严格递增（叶子契约）：变了才算新读数，同 counter 一拍不动事；
   *  · **首拉即采用**（与 goto 叶子的"首拉只记基线"不同）：vitals 是观测不是命令，
   *    没有"重放旧命令"的问题 —— 菜单很可能在 counter 第二次变化之前就打开了；
   *  · data 为 null / satiety 非有限数：保留上一次读数（不编造、不摆坏行），写 vitalsError。
   */
  function applyVitalsLeaf(leaf) {
    if (!leaf || typeof leaf !== 'object') return;
    const counter = leaf.counter;
    if (typeof counter !== 'number' || !isFinite(counter)) return;
    const changed = counter !== api.vitalsCounter;
    api.vitalsCounter = counter;
    if (!changed) return; // 同一拍的老读数：什么都没发生
    const d = leaf.data;
    if (!d || typeof d !== 'object') return; // 叶子被宿主清过/还没写：保留旧读数
    const satiety = d.satiety;
    if (typeof satiety !== 'number' || !isFinite(satiety)) {
      noteVitalsError('vitals.satiety 不是有限数：' + String(satiety));
      return;
    }
    api.vitalsError = null; // 这次读成功：清历史失败（同 refreshMenuTheme 口径）
    // affection 一起带上（V2-23）：宿主叶子一直在发它（host.ts writeVitals 四个读数
    // 全写），以前在归一化这一步被丢掉 = 菜单里好感度零读数。原样透传，数值合法性
    // 由 vitalsLineText 兜底（非有限数画 --）。
    api.petVitals = { satiety: satiety, rice: d.rice, mood: d.mood, affection: d.affection };
    syncHungerBar(); // 菜单正开着：立刻把宽度/颜色/标签对上（不重插）
  }

  // ── 右键菜单：悬停挽留 + 黑白主题（2026-10-06 晚）────────────────────────
  //
  // 菜单树由 build/dshpet-patch.mjs 补丁生成、菜单 DOM 由 vendor shared-core.js
  // 动态挂载（两处都是禁改/只读供体），所以这两件事全在这一层做：
  //   ① 挽留：document 级 mouseover 委托 —— 命中「关闭大肥鱼」项就 POST /miai/plead
  //      （宿主 plead()，8 秒冷却在宿主侧、三个入口共享）。同一项内移动（子节点间
  //      切换）会连发 mouseover，用 menuLastItem 记最近命中项去重；移开再回来 =
  //      新的一次悬停（冷却窗内的静默发生在宿主，不在这里，探针别把两者搞混）。
  //   ② 主题：覆写走 html[data-miai-theme=X] 前缀提特异性（0,2,0 > vendor 0,1,0）；
  //      样式在脚本加载时注入一次；菜单出现的 MutationObserver 回调里**先按缓存
  //      立刻挂属性**（那一帧就是对色，不闪白）再后台拉 /miai/theme 刷新缓存 ——
  //      设置页刚换过主题也跟得上。拉取失败保留上一次读数（缺省 light = vendor
  //      原生观感，最不容易出错的兜底方向）。
  let menuLastItem = null;
  let menuThemeLoading = null; // 进行中的主题读取（并发调用共用同一趟 —— 防新旧应答交错互相覆盖读数，同 flagsLoading 的教训）
  /** 与 vendor MENU_CSS 的选择器逐条对照的覆写表（vendor 升级时按这张表核还咬不咬得住） */
  const MENU_THEME_CSS = [
    'html[data-miai-theme="light"] .dsh-pet-menu{color:#2b2b2b}',
    'html[data-miai-theme="light"] .dsh-pet-menu-column{background:rgba(255,255,255,.86);',
    'border:1px solid rgba(15,23,42,.10);border-radius:10px;box-shadow:0 10px 30px rgba(15,23,42,.18);',
    'backdrop-filter:blur(16px) saturate(1.15);-webkit-backdrop-filter:blur(16px) saturate(1.15)}',
    'html[data-miai-theme="light"] .dsh-pet-menu-item:hover{background:rgba(43,99,255,.12)}',
    'html[data-miai-theme="dark"] .dsh-pet-menu{color:#e8eaf2}',
    'html[data-miai-theme="dark"] .dsh-pet-menu-column{background:rgba(28,30,38,.82);',
    'border:1px solid rgba(255,255,255,.12);border-radius:10px;box-shadow:0 12px 34px rgba(0,0,0,.55);',
    'backdrop-filter:blur(16px) saturate(1.15);-webkit-backdrop-filter:blur(16px) saturate(1.15);',
    'scrollbar-color:rgba(255,255,255,.22) transparent}',
    'html[data-miai-theme="dark"] .dsh-pet-menu-item:hover{background:rgba(122,162,255,.18)}',
    'html[data-miai-theme="dark"] .dsh-pet-menu-arrow{color:#9aa3b5}',
    'html[data-miai-theme="dark"] .dsh-pet-menu-column::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18);',
    'border:2px solid transparent;background-clip:content-box}',
    'html[data-miai-theme="dark"] .dsh-pet-menu-column::-webkit-scrollbar-thumb:hover{background:rgba(122,162,255,.45);',
    'border:2px solid transparent;background-clip:content-box}',
  ].join('');

  /** 挽留上报失败：写 menuPleadError + console.warn（只在由好转坏那次提示，防悬停连发刷屏） */
  function noteMenuPleadError(reason) {
    const wasHealthy = api.menuPleadError === null;
    api.menuPleadError = reason;
    if (wasHealthy) {
      try {
        console.warn('[miai-extras] 菜单挽留上报失败（下次悬停重试）：' + reason);
      } catch (_) {
        /* console 不可用也不能抛 */
      }
    }
  }

  /** 主题读数失败：写 menuThemeError + console.warn（同 goto 的由好转坏才提示） */
  function noteMenuThemeError(reason) {
    const wasHealthy = api.menuThemeError === null;
    api.menuThemeError = reason;
    if (wasHealthy) {
      try {
        console.warn('[miai-extras] 菜单主题读数失败（保留上一次：' + api.menuTheme + '）：' + reason);
      } catch (_) {
        /* 同上 */
      }
    }
  }

  /** 把缓存里的主题挂到 html 上（菜单出现那一帧就对色；失败写错误不抛） */
  function applyMenuTheme() {
    try {
      document.documentElement.setAttribute('data-miai-theme', api.menuTheme);
    } catch (err) {
      noteMenuThemeError('属性挂载失败：' + (err && err.message ? err.message : String(err)));
    }
  }

  /** 后台拉一次主题（不 await、不阻断任何事）；成功且变化才重挂属性。返回已决 promise（探针口用） */
  function refreshMenuTheme() {
    if (menuThemeLoading) return menuThemeLoading; // 已有一趟在飞：共用（防慢的成功应答把新的失败读数清掉）
    const base = resolveBase();
    if (base === null) {
      noteMenuThemeError('BASE 不可用（constants.js 未加载？）');
      return Promise.resolve();
    }
    try {
      menuThemeLoading = fetch(base + THEME_PATH)
        .then((res) => {
          if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status ? res.status : '无响应'));
          if (typeof res.json !== 'function') throw new Error('应答无 json()');
          return res.json();
        })
        .then((data) => {
          const t = data && data.theme === 'dark' ? 'dark' : 'light';
          api.menuThemeError = null; // 这次读成功：清掉历史失败（失败时仍会重新写入，不会静默吞）
          if (t !== api.menuTheme) {
            api.menuTheme = t;
            applyMenuTheme();
          }
        })
        .catch((err) => {
          noteMenuThemeError(err && err.message ? err.message : String(err));
        })
        .then(() => {
          menuThemeLoading = null; // 成功/失败都收口：下一拍可再拉
        });
      return menuThemeLoading;
    } catch (err) {
      noteMenuThemeError(err && err.message ? err.message : String(err)); // fetch 同步抛（URL 非法等）
      return Promise.resolve();
    }
  }

  /** 悬停委托：命中「关闭大肥鱼」项就上报一次挽留（同一项内移动不重发） */
  function onMenuHover(e) {
    try {
      const t = e && e.target;
      if (!t || typeof t.closest !== 'function') return; // 非元素目标（文本节点等）：不是菜单项
      const item = t.closest('.dsh-pet-menu-item');
      if (item === menuLastItem) return; // 同一项内移动（子节点间切换）会连发 mouseover：去重
      menuLastItem = item;
      if (!item) return; // 悬到菜单外/别处：清去重位，下次再进来算一次新的悬停
      const span = typeof item.querySelector === 'function' ? item.querySelector('span') : null;
      const label = span && typeof span.textContent === 'string' ? span.textContent.trim() : '';
      if (label !== PLEAD_LABEL) return; // 只认「关闭大肥鱼」那一项（字面量与 dshpet-patch.mjs 同步）
      // 与焦点上报同一条火后不管口径；计数只在**派发**时 +1（宿主收没收看宿主日志）。
      if (postQuiet(PLEAD_PATH, { from: 'menu-hover' }, noteMenuPleadError)) api.menuPleadCount++;
    } catch (err) {
      noteMenuPleadError('悬停处理异常：' + (err && err.message ? err.message : String(err)));
    }
  }

  /** 菜单出现 → 主题刷新（body 子树变动里筛 .dsh-pet-menu；其余变动一律不管，防顺手刷屏） */
  function startMenuWatch() {
    try {
      if (typeof MutationObserver !== 'function' || !document.body) return false;
      const obs = new MutationObserver((records) => {
        let hit = false;
        try {
          for (const r of records || []) {
            for (const n of (r && r.addedNodes) || []) {
              if (!n) continue;
              if (n.classList && n.classList.contains('dsh-pet-menu')) { hit = true; break; }
              if (typeof n.querySelector === 'function' && n.querySelector('.dsh-pet-menu')) { hit = true; break; }
            }
            if (hit) break;
          }
        } catch (_) {
          hit = true; // 判断本身出错：宁可多刷一次主题，不许漏（拉的是宿主本地路由，便宜）
        }
        if (!hit) return;
        applyMenuTheme(); // 先按缓存立刻对上色（这一帧就是对的）
        refreshMenuTheme(); // 再后台拉最新（设置页刚换过主题时这次刷新会跟上）
        syncHungerBar(); // P3 ③：先把进度条插上（后插会撑高，函数内会重钳面板位置）
      });
      obs.observe(document.body, { childList: true, subtree: true });
      return true;
    } catch (err) {
      noteMenuThemeError('菜单监听启动失败：' + (err && err.message ? err.message : String(err)));
      return false;
    }
  }

  // 挽留委托：mouseover 冒泡到 document 即可（vendor 只有点击会 stopPropagation，
  // mouseover 不拦）；捕获阶段不需要。
  try {
    document.addEventListener('mouseover', onMenuHover);
  } catch (err) {
    noteMenuPleadError('监听注册失败：' + (err && err.message ? err.message : String(err)));
  }

  // 主题：注入覆写样式 → 按缓存挂属性（缺省 light）→ 起菜单监听 → 拉一次暖缓存。
  try {
    const tag = document.createElement('style');
    tag.textContent = MENU_THEME_CSS;
    (document.head || document.documentElement).appendChild(tag);
  } catch (err) {
    noteMenuThemeError('样式注入失败：' + (err && err.message ? err.message : String(err)));
  }
  applyMenuTheme();
  startMenuWatch();
  refreshMenuTheme();

  window.__miaiExtras = api;
})();
