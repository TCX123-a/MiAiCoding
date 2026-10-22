/**
 * 咪爱编程 × dsh-pet 桌面 helper —— 构建期补丁（纯函数，零依赖，不落盘、不联网）。
 *
 * 作用：把 npm 包 dsh-pet@0.3.5 的桌面 helper 源码改造成"咪爱版"——
 *   ① sprite.js：右键菜单的桌面工具根项整段换成咪爱版（首项「跟着我走 / 别跟着啦」三元
 *      跟随开关；**没资格时**（2026-10-16 V1-49）改画一条置灰不可点的解释行
 *      「跟着我走（差在哪）」，原因来自宿主 /miai/flags.followBlock） / 打开壁纸设置 /
 *      打开 AI 设置 / 喂一碗大白饭 / 摸摸鱼头 / 听大肥鱼碎碎念 /
 *      跟本鱼聊天 / [查看余额·balanceEnabled 时（V1-30）] / 回到初始位置 / 重载宠物 /
 *      关闭大肥鱼），并在 onMenuAction 路由里加
 *      六个新分支：两条 POST /miai/open-settings
 *      通知宿主拉起设置页（照抄该文件 reloadDesktop() 的 fire-and-forget 发法），两条
 *      POST /miai/feed|pat 触发互动（照抄 showBalanceFromMenu() 的「postAction 完再
 *      pollStateNow」发法，0 延迟可见），一条 POST /miai/pet-off 关闭大肥鱼（同
 *      fire-and-forget 发法：宿主把 enabled 落成 false 并收窗），一条 POST /miai/follow
 *      翻转跟随覆盖（同一 postAction 发法；完成后除了 pollStateNow 还补拉一拍
 *      window.__miaiExtras.refreshState() —— 跟随叶子与 flags 走的是 goto 轮询，
 *      补这一拍点击才跟手，菜单三元下次打开即已对上）。「跟本鱼聊天」
 *      直接复用原版 action:'chat' 的既有路由分支
 *      （showChatFromMenu → 对话弹窗 → 桥 /chat）——该分支从未被删，
 *      之前只是菜单不再产出它；宿主侧的 /chat 应答见 src/main/dshpet/chat.ts。
 *      另外（V1-30，2026-10-16 夜）菜单树拼接行由 S.buildMenuTree(this.animations)
 *      改成 S.buildMenuTree(this.animations, this.pet.menuEvents) —— 树只列有数据源
 *      的事件组（名单由咪爱宿主 config.ts 给出；树函数本体见 ⑤ 的 buildMenuTree 补丁）。
 *   ② index.html：在 </body> 前、renderer.js 更后处注入 <script src="./miai-extras.js"></script>。
 *   ③ main.js：「关闭大肥鱼」的自退补丁 —— handleBridgeRequest 把 /miai/pet-off
 *      转发给宿主并拿到回包后，本进程 setTimeout(app.exit(0), 120) 自己退出。
 *      为什么必须自退：宿主收宠走 child.kill()（Windows = TerminateProcess），
 *      长寿命实例（一整套拖拽/右键/音频交互跑过之后）被它命中会落进内核态等待 ——
 *      47 线程塌成 1 线程主线程残骸、CPU/内存冻结、taskkill /T /F 连句柄都打不开、
 *      tasklist 里挂 2~5 分钟才散（2026-10-06 探针 menuoff 臂 8s「进程消失」判据
 *      实测红；同款 kill 打在新鲜实例上 500ms 内干净死 = 状态相关的内核层卡死，
 *      用户态无强制解法）。app.exit(0) 一枪毙命、不走 Chromium teardown，是本文件
 *      hostGone 看门狗与 DPI 探针同款的快退姿势。宿主侧配套见 host.ts 的
 *      stopChildForDisable()：收到自退即不再补刀（宽限兜底）。
 *   ④ pointer-target.js + main.js + preload.js：「跟随鼠标吞点击」修复（2026-10-10）。
 *      症状：开启跟随后，鼠标点不动程序里的任何东西（整桌面的点击都被吃掉）。
 *      根因：跟随 = 窗口追着光标走 ⇒ 光标永远在窗内 ⇒ pointer-target.js 里
 *      「光标在窗外 → 恢复穿透」那条**唯一**的复位分支永不触发，而余量区分支是
 *      「保持当前状态」——于是只要有一次判成"可交互"（鱼追上来盖住光标 / 光标扫过
 *      鱼身 / 点开右键菜单的那一刻），整只两倍宠物体积的透明窗就锁死在可交互，
 *      跟着光标吃掉底下所有窗口的点击。渲染端的 mouseleave 也救不了（窗口跟着走，
 *      光标根本出不去）。修法：判定函数加第 5 个参数 followActive，为真时余量区
 *      **一律穿透**（宠物身上仍可交互；菜单/弹窗靠 busy 分支兜着，不依赖"保持"）。
 *      链路：渲染端 miai-extras.js 跟随状态翻转时 petBridge.setFollowActive →
 *      pet:follow-active → helper main.js 的 followActive 镜像表 → 60ms 兜底轮询。
 *      默认 false/undefined ⇒ 不跟随时逐字节等于原规则，老调用方零影响。
 *   ⑤ shared-core.js：「右键菜单」修复（2026-10-10 图三/图四 + 2026-10-13 主人批·三级点不到
 *      + 2026-10-16 V1-49 置灰项支持）——
 *      ①把本次菜单的**真实可见带**（窗口 ∩ 工作区，clamp 矩形）落到菜单根
 *      __dshPetClampRect：miai-extras.js 前插 36px 饱腹行后的重钳拿它当上下界
 *      （helper 窗比屏幕大，window.innerHeight 含屏外带 ⇒ 贴底菜单底行被屏幕裁掉，图三）；
 *      ②showPanel = **行锚定双翼**：横向只在触发行左右两翼选位（右缘放得下用右缘，否则左缘，
 *      按可见带四边 4px 判定），纵向一律「行顶锚定 + 沉底夹取」——行在带内则面板纵向必罩住行，
 *      鼠标横移一步即进。**取代** 2026-10-10 的候选阶梯（右→左→父上→父下）——那个阶梯是本
 *      补丁自己引入的回归：③④两个纵向候选锚的是**父面板**的顶/底而非触发行，父面板底部几行
 *      的子面板被甩到父面板上方几百像素处（实测 y=4），鼠标取道路径必然离开菜单树、菜单秒关，
 *      三级选项永远点不到（2026-10-13 主人报）；两翼都放不下（面板比可见带还宽）才回落
 *      「贴右缘+翻转+夹取」——与无父面板时的原版逻辑逐字节同套；
 *      ③菜单根 mouseleave 兜底 200→300ms：从二级菜单的行滑向三级面板途中横穿板缝的几十毫秒
 *      里，200ms 兜底会在半路把整棵树关掉（mouseover 重新进入即取消，误关概率不升）；
 *      ④buildPanel 叶子分支加 `node.disabled === true` 支持：置灰不可点（opacity .45 +
 *      pointer-events:none——后者连 hover 高亮一并灭掉），供 sprite 菜单的
 *      「跟着我走（差在哪）」解释行使用（V1-49）；
 *      ⑤buildMenuTree 收第二参 menuEvents（V1-30，2026-10-16 夜）：事件组只列宿主给出
 *      的名单（咪爱 = pet.menuEvents）——「工作状态」死组不再上菜单；树根标签「动作」
 *      →「让大肥鱼做点什么」（同一事故的入口名）。非数组（老调用方）时原样全列；
 *      ⑥对话弹窗兜底两行（V1-37，2026-10-16 夜）：失败/异常时不再把裸枚举与异常原文
 *      写进红字（"对话失败：" + reason / "对话异常：" + String(e)），改卖萌文案；
 *      技术原因转 console.warn —— 排查走控制台，用户视野只有卖萌。
 *
 * 供体事实来源（node_modules/dsh-pet/runtime/electron-helper/，本机实测 LF 换行、无 CR）：
 *
 * sprite.js 里被替换的整段（本次唯一要动的菜单块，行 1026-1038；按原版供体摘录）——
 *   "    this.stopMove(); // 菜单悬停期间宠物不漫游"（本行保留，是补丁起点前一行）
 *   "    // 桌面专属工具根项（打开网站 / 查看余额 / 碎碎念 / 对话 / 回到初始位置 / 重载配置）+ 共享菜单树（动作→分类→具体动画）"
 *   "    // 碎碎念/对话项无条件显示：手动触发不受 whisperEnabled 限制（该字段只影响自动周期轮询）"
 *   "    const tools = [{ label: '打开网站', action: 'open-site' }];"
 *   "    if (this.pet.balanceEnabled) tools.push({ label: '查看余额', action: 'show-balance' });"
 *   "    tools.push("
 *   "      { label: '碎碎念', action: 'whisper' },"
 *   "      { label: '对话', action: 'chat' },"
 *   "      { label: '回到初始位置', action: 'home' },"
 *   "      { label: '重载配置', action: 'reload' },"
 *   "    );"
 *   紧接的拼接行（行 1039）自 2026-10-16（V1-30）起**不再保留原样** ——
 *   "    const tree = tools.concat(S.buildMenuTree(this.animations));"
 *   改为把宿主给出的事件组名单传下去：
 *   "    const tree = tools.concat(S.buildMenuTree(this.animations, this.pet.menuEvents));"
 *   （名单来自宿主 config.ts 的 pet.menuEvents；树函数本体怎么读它见 ⑤ 的 buildMenuTree
 *   补丁。为什么要过滤：树原来遍历 events 全键、不读任何开关 ——「工作状态」这种宿主
 *   从不写叶子的死组也摆上菜单，V1-30 审计「上半截猫咪语气、下半截像调试面板」的下半截。）
 *
 * sprite.js 里 POST 的既有写法（reloadDesktop，行 1196-1200，设置类分支照抄同一写法）——
 *   "  reloadDesktop() {"
 *   "    fetch(BASE + '/reload', { method: 'POST' }).catch((e) => {"
 *   "      console.warn('[dsh-pet] 重载配置请求失败（宿主不可达？）', e);"
 *   "    });"
 *   "  }"
 * 即：裸 fetch + .catch、不 await、不重试（火后不管），失败只记日志。
 *
 * sprite.js 里互动类 POST 的既有写法（showBalanceFromMenu，行 1116-1126，喂饭/摸头分支照抄）——
 *   "    S.postAction(BALANCE_URL)"
 *   "      .then((ok) => {"
 *   "        if (!ok) console.warn('[dsh-pet] 菜单查看余额：刷新动作未成功');"
 *   "        pollStateNow(); // 立即拉一拍：结果 0 延迟可见"
 *   "      })"
 *   "      .catch((e) => {"
 *   "        console.error('[dsh-pet] 菜单查看余额异常', e);"
 *   "      });"
 * 即：postAction（内部 fetch + res.json().ok===true 判定）+ 完成后 pollStateNow 立刻拉一拍
 * /state —— 宿主写完 say/anim 叶子后不必等下一个 1s 轮询。pollStateNow 是 events.js 的全局
 * 函数，sprite.js 自己的 showWhisperFromMenu 就裸调它（行 1121），同文件同作用域，可直接用。
 *
 * sprite.js 里 onMenuAction 路由的插入点（行 1062-1065）——
 *   "  onMenuAction(leaf) {"
 *   "    this.closeMenu();"
 *   "    if (!leaf || typeof leaf !== 'object') return;"
 *   "    if (leaf.action === 'open-site') {"
 * 新分支插在守卫行之后、open-site 分支之前。
 *
 * index.html 的注入锚点（行 173-174）——
 *   "    <script src="./renderer.js"></script>"
 *   "  </body>"
 * 注入的 <script src="./miai-extras.js"></script> 放在 renderer.js 之后、</body> 之前。
 * （CSP 为 script-src 'self'，同目录相对路径的经典 script 不受影响。）
 *
 * 明确不做的事（"其余逻辑不动"）：showBalanceFromMenu / showChatFromMenu 等**方法级**代码与
 * 其注释、以及 open-site / show-balance 两条既有路由分支一律保留 —— open-site 仍是不可达
 * 死代码（菜单不产出它，自检按"补丁后文件里没有这个 action 字面量"断言）；**show-balance
 * 自 2026-10-16（V1-30）起不再是死分支**：菜单在 pet.balanceEnabled 时重新产出「查看余额」，
 * 宿主 host.ts 的 /balance 现查 DeepSeek 并写 sections.balance 叶子（档位动画 + 报账气泡），
 * 自检相应改成"菜单块恰有一条条件项 + 路由分支在场"。'查看余额' 字样仍会出现在
 * showBalanceFromMenu 的方法注释里 —— 那是保留的方法级代码，不算菜单产出。
 * （chat 是更早的例外中的例外：菜单**有意恢复**了 action:'chat' 条目，它的路由分支不再死。）
 *
 * 硬性约束：每一步替换先断言锚点命中次数 === 1，未命中/多次命中直接 throw（不许静默跳过、
 * 不许默认回退为成功）。已打过的源码再跑返回原样且 applied = []（幂等）。
 */

// ---------- 锚点常量（全部来自上面摘录的真实供体原文） ----------

/** 菜单块起点：桌面工具根项的注释首行（真实文件里唯一） */
const SPRITE_TOOLS_START = '    // 桌面专属工具根项';

/** 菜单块终点（含）：reload 条目 + tools.push 的收尾括号（真实文件里唯一） */
const SPRITE_TOOLS_END = "      { label: '重载配置', action: 'reload' },\n    );";

/** 菜单树拼接行（V1-30）：把宿主的事件组名单传进 buildMenuTree（真实文件里唯一） */
const SPRITE_MENUTREE_CALL_ANCHOR = '    const tree = tools.concat(S.buildMenuTree(this.animations));';

/** 拼接行新版：this.pet.menuEvents 经 flattenConfigPets 的展开住在每只宠物上（config.ts 给出） */
const SPRITE_MENUTREE_CALL_NEW = '    const tree = tools.concat(S.buildMenuTree(this.animations, this.pet.menuEvents));';

/** 路由插入点：onMenuAction 的入参守卫 + open-site 分支开头（真实文件里唯一） */
const SPRITE_ROUTE_ANCHOR =
  "    if (!leaf || typeof leaf !== 'object') return;\n    if (leaf.action === 'open-site') {";

/** index.html 注入点：renderer.js 之后、</body> 之前（真实文件里唯一） */
const HTML_ANCHOR = '    <script src="./renderer.js"></script>\n  </body>';

/** main.js 自退补丁的锚点：handleBridgeRequest 里唯一的「等宿主回包」行（供体实测 LF、两空格缩进） */
const MAIN_PETOFF_ANCHOR = '  const resp = await bridgeRequest(method, url.pathname + url.search, body);';

/** main.js 已打补丁的标记：插入块独有（供体原文没有这个判断），vendor 的铺后自检也用它 */
const MAIN_PATCH_MARKER = "endsWith('/miai/pet-off')";

// ---------- 跟随穿透补丁（2026-10-10）的锚点与标记 ----------
//
// 【要修的 bug】跟随鼠标期间，整只「宠物包围盒 + 四周各半只宠物」的透明窗口跟着光标走，
// 吞掉全桌面的点击（主人实测："开启跟随后鼠标无法点击程序内的任何东西"）。
// 【根因】pointer-target.js 的 decideWindowIgnore 在"光标在窗内、但不在宠物身上"时
// **保持当前状态**（return ignoring）—— 这条规则本身是对的（渲染端自绘的右键菜单/对话
// 弹窗就在余量区里，鼠标一移出身体就翻回穿透就点不到了）。但跟随改变了前提：窗口追着
// 光标走 ⇒ 光标**永远在窗内** ⇒「光标在窗外 → 恢复穿透」那条唯一的复位分支永不触发；
// 于是只要有一次判成"可交互"（鱼追上来盖住光标 / 光标扫过鱼身 / 点菜单的那一刻），
// 状态就锁死在可交互，余量区再也回不到穿透。渲染端的 mouseleave 也救不了：窗口跟着走，
// 光标根本出不去。
// 【修法】给判定加一条"跟随中"的输入：followActive 为真时余量区**一律穿透**（宠物身上
// 那条分支不变，仍然可交互）。这条不改任何既有语义——followActive 默认 false，不跟随时
// 逐字节等于原规则；而跟随中余量区的"保持"本来就没有要保护的东西（菜单/弹窗打开时
// busy=true 优先否决，见函数首行）。
// 【链路】渲染端 miai-extras.js 在跟随生效/失效时上报一次（pet:follow-active）→ helper
// main.js 存进 followActive 镜像表 → 兜底轮询（60ms，唯一出口 setWindowIgnore）带上它。
// 与 inputBusy 完全同构：只存标记不直接翻窗口，避免两条通道抢翻同一个窗口。

/** pointer-target.js 的函数签名行（供体原文唯一） */
const PT_SIG_ANCHOR = 'function decideWindowIgnore(bounds, point, ignoring, busy) {';

/** pointer-target.js 的「身体上 → 可交互」分支（供体原文唯一） */
const PT_SPRITE_BRANCH = '  if (inSprite) return false; // 宠物身上：可交互';

/** pointer-target.js 的「余量区 → 保持」兜底行（供体原文唯一） */
const PT_LATCH_LINE = '  return ignoring; // 窗口余量区：保持（菜单/弹窗可点）';

/** 供体函数体尾两行。⚠️ 补丁必须插在这**两行之间**，不是整段之前：
 *  插在前面时，跟随中光标落到鱼身上也被放行规则拦下判成穿透 —— 鱼抓不住、
 *  右键菜单（含「别跟着啦」这一项）从此打不开，而"文件里有那行字"的文本检查
 *  照样全绿（这个错误顺序真的发生过一次，是行为级判据 judge.mjs 的 #8 格抓出来的）。 */
const PT_TAIL_ANCHOR = PT_SPRITE_BRANCH + '\n' + PT_LATCH_LINE;

/** pointer-target.js 的 JSDoc 参数块尾部（补第 5 个参数说明） */
const PT_DOC_ANCHOR = ' * @returns {boolean} 新的穿透状态';

/** helper main.js：inputBusy 镜像表的声明行（followActive 表插在它之后） */
const MAIN_BUSY_MAP_ANCHOR = 'const inputBusy = new Map();';

/** helper main.js：兜底轮询的判定调用行（加第 5 个实参） */
const MAIN_POLL_ANCHOR =
  '      const next = decideWindowIgnore(b, screen.getCursorScreenPoint(), ignoring, inputBusy.get(win.id) === true);';

/** helper main.js：窗口关闭时的镜像清理两行（补一行 followActive.delete） */
const MAIN_CLEANUP_ANCHOR = '      windowIgnore.delete(win.id);\n      inputBusy.delete(win.id);';

/** helper main.js：pet:input-busy 处理器整段（新处理器插在它之后；供体原文唯一） */
const MAIN_BUSY_IPC_ANCHOR = [
  "  ipcMain.on('pet:input-busy', (event, busy) => {",
  '    const win = BrowserWindow.fromWebContents(event.sender);',
  '    if (!win || win.isDestroyed()) return;',
  '    inputBusy.set(win.id, !!busy);',
  '  });',
].join('\n');

/** helper preload.js：setInputBusy 整段（setFollowActive 插在它之后；供体原文唯一） */
const PRELOAD_BUSY_ANCHOR = [
  '  setInputBusy(busy) {',
  "    ipcRenderer.send('pet:input-busy', !!busy);",
  '  },',
].join('\n');

/** 三个文件各自的"已打过"标记（互不混用：半打补丁必须能被各自认出来） */
/** ⚠️ 标记必须**带顺序**：只查规则行本身的话，规则被插到 inSprite 之前时同样命中，
 *  而那种顺序下跟随中光标落到鱼身上也判穿透 —— 鱼抓不住、右键菜单（含「别跟着啦」）打不开，
 *  isPointerPatched 却一路绿。这里连「inSprite 分支紧跟补丁首行注释」一起认。 */
const POINTER_PATCH_MARKER = PT_SPRITE_BRANCH + '\n  // 咪爱补丁（2026-10-10）';
const MAIN_FOLLOW_MARKER = 'const followActive = new Map();';
const PRELOAD_PATCH_MARKER = 'setFollowActive(on) {';

/** isPatched 的必备标记集：全部在场才算"已打满"。半打补丁（如只换了菜单、路由没加）不认，
 *  重跑时会因锚点未命中而大声 throw——绝不把半成品当成品放行。 */
const PATCH_MARKERS = [
  "action: 'miai-follow-toggle'",
  "'别跟着啦'",
  "'跟着我走'",
  'window.__miaiExtras.followEligible === true',
  "action: 'miai-wallpaper'",
  "action: 'miai-ai'",
  "action: 'miai-feed'",
  "action: 'miai-pat'",
  "action: 'miai-pet-off'",
  "BASE + '/miai/open-settings?tab=wallpaper'",
  "BASE + '/miai/open-settings?tab=ai'",
  "BASE + '/miai/feed'",
  "BASE + '/miai/pat'",
  "BASE + '/miai/pet-off'",
  "BASE + '/miai/follow'",
  "'听大肥鱼碎碎念'",
  "{ label: '跟本鱼聊天', action: 'chat' }",
  "this.pet.balanceEnabled ? [{ label: '查看余额', action: 'show-balance' }] : []",
  'S.buildMenuTree(this.animations, this.pet.menuEvents)',
];

// ---------- 右键菜单定位补丁（2026-10-10 图三/图四；2026-10-13 主人批·三级点不到）的锚点与标记 ----------
//
// 【图三：右键菜单底行被屏幕裁掉】桌宠右键菜单的定位全发生在比屏幕大的 helper 窗里
// （默认右/下各探出 ~207/131px；真实可见带 clamp = 窗口 ∩ 工作区，sprite.js
// visibleClampRect）。根面板挂载时按**旧高度**钳好位置；miai-extras.js 的饱腹行是
// 挂载后前插的（+36px），面板变高，而它的重钳（reclampMenuPanel）拿 window.innerHeight
// 当上界 —— innerHeight 含屏外带，钳不动 ⇒ 贴底打开的菜单底行留在屏幕外被裁。修法：
// 把 clamp 矩形落到菜单根 __dshPetClampRect，extras 重钳改读它（本补丁只负责落读数）。
//
// 【三级点不到（2026-10-13 主人批·本补丁的回归）】10-10 为图四加的候选阶梯
// 右→左→父上→父下里，两个纵向候选锚的是**父面板**的顶/底（tUp = pr.top − 4 − h）而不是
// 触发行 —— 父面板底部几行（如余额档位）悬停时，①右缘在带内仍会被"是否压父面板"否掉
// （子面板纵向罩住行 ⇒ 与父面板两轴重叠 >4px 几乎是必然），②左缘同理，于是落到③父上：
// 子面板被甩到父面板上方几百像素处（复现实测 p=(163,4,150,186)，y=4 = 贴着屏幕顶）。
// 鼠标从触发行取道去点三级，路径必然穿出菜单树 ⇒ leaveTimer(200ms) 兜底把菜单关掉，
// 三级选项**永远点不到**。修复 = **行锚定双翼**：横向只选触发行左右两翼（右缘放得下用
// 右缘，否则左缘，按可见带四边 4px 判定）；纵向一律「行顶锚定 + 沉底夹取」——行在带内
// 则面板纵向必罩住行（面板 maxHeight 已按带钳过：min(460, max(120, c.h−16))），鼠标横移
// 一步即进；可达性优先于"不压父面板"。两翼都放不下（面板比可见带还宽）才回落原
// 「贴右缘+翻转+夹取」；曾为图四引入的 parentPanel/hitsParent/③④ 一并删除。
// 另：菜单根 mouseleave 兜底 200→300ms（主人点名要求）——滑行途中横穿板缝的几十毫秒内
// 200ms 兜底会半路关树；mouseover 重新进入即取消，误关概率不升。
//
// 【供体事实】shared-core.js 为 tab 缩进、LF（本机实测）；下面每个锚点都按真实字节取证，
// 命中必须恰好 1 次（findUniqueAnchor 保证）。

/** shared-core.js：菜单根创建四行（clamp 存储插在它之后；供体原文唯一） */
const SHARED_CORE_ROOT_ANCHOR = [
  '\tconst root = document.createElement("div");',
  '\troot.className = "dsh-pet-menu";',
  '\troot.style.left = "0px";',
  '\troot.style.top = "0px";',
].join('\n');

/** shared-core.js：showPanel 旧整段（doc 注释 + 函数体，逐字节照抄供体；替换为行锚定双翼版） */
const SHARED_CORE_SHOWPANEL_ANCHOR = [
  '\t/** 把面板显示在触发项旁边：右缘展开，贴右/下边缘自动翻转夹取（在 clamp 矩形内） */',
  '\tconst showPanel = (panel, item) => {',
  '\t\tconst rect = item.getBoundingClientRect();',
  '\t\tpanel.style.left = "";',
  '\t\tpanel.style.top = "";',
  '\t\tpanel.style.display = "block";',
  '\t\tlet left = rect.right + 4;',
  '\t\tif (left + panel.offsetWidth > c.x + c.w - 4) left = rect.left - panel.offsetWidth - 4;',
  '\t\tleft = Math.max(c.x + 4, left);',
  '\t\tlet top = rect.top;',
  '\t\tif (top + panel.offsetHeight > c.y + c.h - 4) top = Math.max(c.y + 4, c.y + c.h - 4 - panel.offsetHeight);',
  '\t\tpanel.style.left = left + "px";',
  '\t\tpanel.style.top = top + "px";',
  '\t};',
].join('\n');

/** shared-core.js：菜单根 mouseleave 兜底整段（逐字节照抄供体；替换为 300ms 版） */
const SHARED_CORE_LEAVE_ANCHOR = [
  '\troot.addEventListener("mouseleave", () => {',
  '\t\tif (leaveTimer !== null) window.clearTimeout(leaveTimer);',
  '\t\tleaveTimer = window.setTimeout(() => {',
  '\t\t\tleaveTimer = null;',
  '\t\t\tclose();',
  '\t\t}, 200);',
  '\t});',
].join('\n');

/** shared-core.js：菜单叶子分支的前五行（供体原文唯一；置灰分支插在 `} else {` 之前，
 *  锚点本体逐字节保留 —— 区域对拍测试靠它当切片锚） */
const SHARED_CORE_LEAF_ANCHOR = [
  '\t\t\t} else {',
  '\t\t\t\tconst label = document.createElement("span");',
  '\t\t\t\tlabel.textContent = node.label;',
  '\t\t\t\titem.appendChild(label);',
  '\t\t\t\titem.addEventListener("click", (e) => {',
].join('\n');

/** shared-core.js：置灰项分支（V1-49，2026-10-16 凌晨）。插在叶子分支的 `} else {` 之前；
 *  样式走内联（opacity + pointer-events）：pointer-events:none 把 hover 高亮也一并灭掉
 *  —— 会亮起来的灰行仍像能点的。类名只给探针/构建自检当标记（注释里不写这个字面量，
 *  计数判据按恰 1 处来）。 */
const SHARED_CORE_DISABLED_BLOCK = [
  '\t\t\t} else if (node.disabled === true) {',
  '\t\t\t\t// 咪爱补丁（2026-10-16·V1-49）：置灰项 —— 在场但不可点。跟随没资格时菜单里摆的',
  '\t\t\t\t// 「跟着我走（饱腹 0%/50%）」就走这里：差在哪直接写在标签里，不再整项消失。',
  '\t\t\t\tconst label = document.createElement("span");',
  '\t\t\t\tlabel.textContent = node.label;',
  '\t\t\t\titem.appendChild(label);',
  '\t\t\t\titem.style.opacity = "0.45";',
  '\t\t\t\titem.style.pointerEvents = "none";',
  '\t\t\t\titem.classList.add("dsh-pet-menu-item--off");',
].join('\n');

/** shared-core.js 的"已打过"标记（六处都要在；半打不认——见 isSharedCorePatched） */
const SHARED_CORE_CLAMP_MARKER = 'root.__dshPetClampRect = ';
const SHARED_CORE_SHOWPANEL_MARKER = '行锚定双翼';
const SHARED_CORE_LEAVE_MARKER = '离开兜底 200→300ms';
const SHARED_CORE_DISABLED_MARKER = 'dsh-pet-menu-item--off';

// ---------- 菜单树补丁（V1-30 / V1-37，2026-10-16 夜）的锚点与产物 ----------
//
// 【修什么】①V1-30：右键菜单下半截挂着供应商动画整树（13 组 106 条素材名，含本应用
// 已关闭的「工作状态」死组），树根标签「动作」是工程词 —— 用户点开以为还有彩蛋，
// 迎面是工程素材名（审计整改方向：按开关过滤 + 保底给树一个用户视角的入口名）。
// 修法：buildMenuTree 收第二参 menuEvents（宿主 config.ts 的 pet.menuEvents 名单），
// 数组时事件组只列名单内、非数组（undefined，老调用方）时原样全列；树根标签换
// 「让大肥鱼做点什么」。②V1-37：对话弹窗的失败/异常兜底把裸枚举与异常原文写进
// 用户红字（"对话失败：" + state.message ?? state.reason / "对话异常：" + String(e)），
// 改卖萌文案（真源 = copy.ts 的 PET.CHAT_DIALOG_FAIL/ERR，同源闸守着），
// 技术原因转 console.warn —— 排查走控制台，用户视野只有卖萌。

/** shared-core.js：buildMenuTree 函数签名行（供体原文唯一；注释块随替换一起挂上去） */
const SHARED_CORE_TREE_SIG_ANCHOR = 'function buildMenuTree(animations) {';

/** shared-core.js：事件组遍历头两行（供体原文唯一；名单计算插在两者之间） */
const SHARED_CORE_TREE_EVENTS_ANCHOR = [
  '\tconst events = animations.events ?? {};',
  '\tfor (const key of Object.keys(events)) {',
].join('\n');

/** shared-core.js：树根标签行（供体原文唯一，tab 两深） */
const SHARED_CORE_TREE_ROOTLABEL_ANCHOR = '\t\tlabel: "动作",';

/** shared-core.js：对话弹窗失败分支红字行（供体原文唯一，tab 四深） */
const SHARED_CORE_CHAT_FAIL_ANCHOR =
  '\t\t\t\terr.textContent = "对话失败：" + (state.message ?? state.reason);';

/** shared-core.js：对话弹窗 catch 分支红字行（供体原文唯一，tab 三深） */
const SHARED_CORE_CHAT_CATCH_ANCHOR =
  '\t\t\terr.textContent = "对话异常：" + String(e && e.message ? e.message : e);';

/** 菜单树补丁的"已打过"标记（与上面四个同在 AND 链里；半打不认） */
const SHARED_CORE_TREE_MARKER = '咪爱补丁（2026-10-16·V1-30）';
const SHARED_CORE_CHATFIX_MARKER = '咪爱补丁（2026-10-16·V1-37）';

// ---------- 替换产物（本模块作者手写；LF 换行，与供体文件一致） ----------

/** 咪爱版桌面工具根项（顺序固定：跟随开关打头，设置类在前，互动随后，聊天/碎碎念收中段，
 *  余额入口（条件项）紧随聊天，维护收尾；「关闭大肥鱼」压轴）
 *  ⚠️ 跟随项是**唯一标签随状态变的条目**：有资格时是可点的三元开关（读 window.__miaiExtras.followOn
 *  在「跟着我走 / 别跟着啦」之间切换）；没资格时是**置灰不可点**的解释行
 *  「跟着我走（差在哪）」，括号里的原因由宿主 /miai/flags.followBlock 给出
 *  （与 followEligible 同一次求值，渲染端只透传）。extras 缺席（脚本没加载成功）时
 *  整项不出现。
 *  ⚠️ 「查看余额」是**条件条目**（V1-30，2026-10-16 夜）：宿主开着 balanceEnabled 才列出 ——
 *  它下面挂着真数据源（host.ts 的 refreshBalance 现查 DeepSeek），宿主关着还列 = 点了
 *  没反应的假入口。名单/开关改动先看 src/main/dshpet/config.ts。
 *  ⚠️ '关闭大肥鱼' 这个字面量被 miai-extras.js 的悬停挽留委托按**字面**匹配（PLEAD_LABEL，见该文件
 *  「右键菜单挽留」节）——改这行文案必须同步改 miai-extras.js，否则挽留静默失效（无报错、无红）。 */
const NEW_TOOLS_BLOCK = [
  '    // 咪爱版桌面工具根项（跟着我走/别跟着啦[三元·有资格可点、没资格置灰+写明原因] / 打开壁纸设置 / 打开 AI 设置 / 喂一碗大白饭 / 摸摸鱼头 / 听大肥鱼碎碎念 / 跟本鱼聊天 / [查看余额·balanceEnabled 时] / 回到初始位置 / 重载宠物 / 关闭大肥鱼）+ 共享菜单树（让大肥鱼做点什么→分类→具体动画）',
  '    // 听大肥鱼碎碎念手动触发不受 whisperEnabled 限制（该字段只影响自动周期轮询）；菜单顺序固定。',
  '    // 首项跟随开关的三元读 __miaiExtras.followOn（跟随叶子读数，宿主 /miai/follow 翻转的就是它）。',
  '    // **跟随是「有资格才提」的**（2026-10-10 主人裁定：总闸开 && 饱食度 ≥ 50 && 好感 ≥ 80）。',
  '    // 但没资格不再整项消失（V1-49，2026-10-16 凌晨主人批「是bug要修」）：改画一条置灰',
  '    // **不可点**的行，括号里直接写差在哪（如「跟着我走（饱腹 0%/50%）」）——原因来自宿主',
  '    // /miai/flags.followBlock，渲染端只透传、不复述门槛；灰行不绑任何 action，点了不会翻开关。',
  '    // 上一版的毛病是饿到 0 右键那一项**根本不出现**，用户只能判断功能坏了或自己眼瞎。',
  '    // extras 缺席（脚本没装上）时仍不出现：那种状态下没人认 followEligible/followBlock，',
  '    // 灰行也画不出来；而"扩展没装上"本身是构建期自检拦下的半成品，不该在 UI 上找补。',
  '    // 原版依赖 DSH 凭证与模型的两条已移除；「跟本鱼聊天」复用原版',
  '    // action:chat 的既有分支，接咪爱宿主 /chat（有 AI Key 自由聊天，没 Key 本地兜底抱怨）。',
  '    // 「查看余额」（V1-30，2026-10-16 夜主人裁定「余额档位用户应该能看见」）按 balanceEnabled',
  '    // 条件列出：点它走原版「查看余额」分支（showBalanceFromMenu → POST /balance →',
  '    // pollStateNow），宿主现查 DeepSeek /user/balance 写 sections.balance 叶子，渲染端画',
  '    // 档位动画 + 报账气泡。宿主关着还列 = 点了没反应的假入口，所以跟着开关走。',
  '    const tools = [];',
  '    if (window.__miaiExtras && window.__miaiExtras.followEligible === true) {',
  "      tools.push({ label: window.__miaiExtras.followOn ? '别跟着啦' : '跟着我走', action: 'miai-follow-toggle' });",
  "    } else if (window.__miaiExtras && typeof window.__miaiExtras.followBlock === 'string' && window.__miaiExtras.followBlock) {",
  "      tools.push({ label: '跟着我走（' + window.__miaiExtras.followBlock + '）', disabled: true });",
  '    }',
  '    tools.push(',
  "      { label: '打开壁纸设置', action: 'miai-wallpaper' },",
  "      { label: '打开 AI 设置', action: 'miai-ai' },",
  "      { label: '喂一碗大白饭', action: 'miai-feed' },",
  "      { label: '摸摸鱼头', action: 'miai-pat' },",
  "      { label: '听大肥鱼碎碎念', action: 'whisper' },",
  "      { label: '跟本鱼聊天', action: 'chat' },",
  "      ...(this.pet.balanceEnabled ? [{ label: '查看余额', action: 'show-balance' }] : []),",
  "      { label: '回到初始位置', action: 'home' },",
  "      { label: '重载宠物', action: 'reload' },",
  "      { label: '关闭大肥鱼', action: 'miai-pet-off' },",
  '    );',
].join('\n');

/** onMenuAction 新增的六个分支：设置类与关闭照 reloadDesktop（裸 fetch 火后不管），
 *  互动类照 showBalanceFromMenu（postAction + pollStateNow，0 延迟可见） */
const NEW_ROUTE_BRANCHES = [
  '',
  "    if (leaf.action === 'miai-wallpaper') {",
  '      // 打开壁纸设置：POST 通知咪爱宿主拉起设置页（tab=wallpaper）。照 reloadDesktop 的',
  '      // 火后不管发法：不 await、不重试（本请求只是通知，响应内容不用），失败只记日志——',
  '      // 宿主不可达也不能卡住菜单点击。',
  "      fetch(BASE + '/miai/open-settings?tab=wallpaper', { method: 'POST' }).catch((e) => {",
  "        console.warn('[dsh-pet] 打开壁纸设置请求失败（宿主不可达？）', e);",
  '      });',
  '      return;',
  '    }',
  "    if (leaf.action === 'miai-ai') {",
  '      // 打开 AI 设置：同上，tab=ai。',
  "      fetch(BASE + '/miai/open-settings?tab=ai', { method: 'POST' }).catch((e) => {",
  "        console.warn('[dsh-pet] 打开 AI 设置请求失败（宿主不可达？）', e);",
  '      });',
  '      return;',
  '    }',
  "    if (leaf.action === 'miai-feed') {",
  '      // 喂一碗大白饭：POST 给咪爱宿主的行为大脑（判定/记账/台词/动画都在那边，零 token），',
  '      // 随即立刻拉一拍 /state —— 与 showBalanceFromMenu 同款「0 延迟可见」，不等下一个 1s。',
  '      // 大脑可能因冷却静默忽略这一下（照样应答 ok，只是没台词）。',
  "      S.postAction(BASE + '/miai/feed')",
  '        .then((ok) => {',
  "          if (!ok) console.warn('[dsh-pet] 菜单喂饭：动作未成功');",
  '          pollStateNow();',
  '        })',
  '        .catch((e) => {',
  "          console.warn('[dsh-pet] 喂饭请求失败（宿主不可达？）', e);",
  '        });',
  '      return;',
  '    }',
  "    if (leaf.action === 'miai-pat') {",
  '      // 摸摸鱼头：同上，走 /miai/pat。',
  "      S.postAction(BASE + '/miai/pat')",
  '        .then((ok) => {',
  "          if (!ok) console.warn('[dsh-pet] 菜单摸头：动作未成功');",
  '          pollStateNow();',
  '        })',
  '        .catch((e) => {',
  "          console.warn('[dsh-pet] 摸头请求失败（宿主不可达？）', e);",
  '        });',
  '      return;',
  '    }',
  "    if (leaf.action === 'miai-pet-off') {",
  '      // 关闭大肥鱼：通知咪爱宿主 —— host 转 app.ts 把配置落成 pet.enabled=false',
  '      // 并广播给设置页，随即收掉宠物窗（就是本窗）。火后不管：窗口马上要没了，',
  '      // 等响应没意义；照 reloadDesktop 同一写法（这条只下通知、不碰 /state）。',
  "      fetch(BASE + '/miai/pet-off', { method: 'POST' }).catch((e) => {",
  "        console.warn('[dsh-pet] 关闭大肥鱼请求失败（宿主不可达？）', e);",
  '      });',
  '      return;',
  '    }',
  "    if (leaf.action === 'miai-follow-toggle') {",
  '      // 跟随开关（补充模块一）：POST 给咪爱宿主 —— host 翻转**当前生效的**跟随状态',
  '      // 落成会话级覆盖，并当场补一拍 followTick（点击要跟手）。照喂饭/摸头的发法：',
  '      // postAction 完立刻刷新状态。这里要补两拍，职责不同别合并：',
  '      //   · refreshState()（miai-extras.js 暴露）：拉 goto 叶子 + /miai/flags ——',
  '      //     followOn 读数与 120ms 跟随轮询档位都归它；少这一拍，开跟随最多迟 1s 才动。',
  '      //   · pollStateNow()（events.js 全局）：拉宠物 /state 的 say/anim 叶子，与喂饭/',
  '      //     摸头同款，防以后大脑给这一步配台词时又要回来补。',
  '      // extras 缺席只跳过第一拍：路由本身不依赖它（禁用不是失败，是没那一步）。',
  "      S.postAction(BASE + '/miai/follow')",
  '        .then((ok) => {',
  "          if (!ok) console.warn('[dsh-pet] 菜单跟随开关：动作未成功');",
  "          if (window.__miaiExtras && typeof window.__miaiExtras.refreshState === 'function') {",
  '            window.__miaiExtras.refreshState();',
  '          }',
  '          pollStateNow();',
  '        })',
  '        .catch((e) => {',
  "          console.warn('[dsh-pet] 跟随开关请求失败（宿主不可达？）', e);",
  '        });',
  '      return;',
  '    }',
].join('\n');

/** index.html 注入行（在 renderer.js 之后、</body> 之前） */
const HTML_INJECT_LINE = '    <script src="./miai-extras.js"></script>';

/** main.js 插入块：pet-off 回包后自退（机制与证据见文件头 ③；宿主侧配套见 host.ts stopChildForDisable） */
const MAIN_PETOFF_BLOCK = [
  '  // 咪爱补丁（2026-10-06）：关闭大肥鱼 —— 宿主已受理并回包，本进程使命结束，自退。',
  '  // 【为什么必须自退】宿主收宠走 child.kill()（Windows 即 TerminateProcess）。长寿命实例',
  '  // （拖拽/右键/音频等一整套交互跑过之后）被它命中会落进内核态等待：47 线程塌成 1 线程',
  '  // 残骸，CPU/内存冻结，taskkill /T /F 连句柄都打不开（"找不到此进程的运行实例"），',
  '  // tasklist 里挂 2~5 分钟才散——探针 menuoff 臂「helper 进程消失」8s 判据因此红。',
  '  // app.exit(0) 一枪毙命、不走 Chromium teardown，是唯一保证「立刻全退」的姿势——',
  '  // 本文件 hostGone 看门狗与 DPI 探针用的都是它。延后 120ms：等本响应先回到渲染端。',
  '  // 宿主侧配套：host.ts 的 stopChildForDisable() 收到自退即不再补刀（宽限兜底）。',
  "  if (url.pathname.endsWith('/miai/pet-off')) {",
  '    setTimeout(() => app.exit(0), 120);',
  '  }',
].join('\n');

/** pointer-target.js 的余量区新规则（插在 `return ignoring;` 之前；归因见锚点节大段注释） */
const PT_FOLLOW_RULE = [
  '  // 咪爱补丁（2026-10-10）：跟随鼠标期间，余量区**绝不"保持"**，一律放行点击。',
  '  // 原规则的"保持"在跟随时会退化成永久闩锁：窗口追着光标走 ⇒ 光标永远在窗内 ⇒',
  '  // 「光标在窗外 → 恢复穿透」那条唯一的复位分支永不触发；只要有一次判到身体上',
  '  // （鱼追上来盖住光标 / 光标扫过鱼身），状态就锁死在可交互，整只两倍宠物体积的',
  '  // 透明窗跟着光标吃掉全桌面的点击（主人实测："开启跟随后鼠标无法点击程序内的',
  '  // 任何东西"）。菜单/弹窗要的"保持"由上面的 busy 分支兜着，不依赖这一行。',
  '  // followActive 默认 undefined ⇒ 不跟随时逐字节等于原规则（老调用方零影响）。',
  '  if (followActive === true) return true; // 跟随中：余量区穿透（身体上仍可交互，见上）',
].join('\n');

/** pointer-target.js 的 JSDoc 参数说明（补第 5 个参数） */
const PT_DOC_PARAM = [
  ' * @param {boolean} [followActive] 咪爱补丁（2026-10-10）：渲染端是否正在跟随鼠标。为真时窗口余量区',
  ' *   一律穿透 —— 跟随中光标永远在窗内，"保持当前状态"会变成永久闩锁（见函数体内注释）。',
].join('\n');

/** helper main.js：followActive 镜像表声明（插在 inputBusy 表之后） */
const MAIN_FOLLOW_MAP_BLOCK = [
  '/**',
  ' * 咪爱补丁（2026-10-10）：跟随鼠标当前是否生效（win.id → true/false），由渲染端 miai-extras.js',
  ' * 在跟随生效/失效时上报一次（pet:follow-active）。跟随中窗口余量区一律穿透 —— 完整归因见',
  " * `pet:follow-active` 处理器处。与 inputBusy 同构：只存标记，翻转窗口**唯一出口**仍是 setWindowIgnore。",
  ' */',
  'const followActive = new Map();',
].join('\n');

/** helper main.js：兜底轮询 5 实参版 */
const MAIN_POLL_NEW = [
  '      const next = decideWindowIgnore(',
  '        b,',
  '        screen.getCursorScreenPoint(),',
  '        ignoring,',
  '        inputBusy.get(win.id) === true,',
  '        followActive.get(win.id) === true,',
  '      );',
].join('\n');

/** helper main.js：窗口关闭时的镜像清理（补 followActive） */
const MAIN_CLEANUP_NEW = [
  '      windowIgnore.delete(win.id);',
  '      inputBusy.delete(win.id);',
  '      followActive.delete(win.id);',
].join('\n');

/** helper main.js：pet:follow-active 处理器（插在 pet:input-busy 处理器之后） */
const MAIN_FOLLOW_IPC_BLOCK = [
  '',
  '  // 咪爱补丁（2026-10-10）：跟随鼠标是否生效，由渲染端（miai-extras.js）在上报一次。',
  '  // 兜底轮询把它传进 decideWindowIgnore —— **跟随时窗口余量区一律穿透**。',
  '  // 为什么必须这样：跟随是"窗口追着光标走"，光标永远在窗内，原规则里「光标在窗外 →',
  '  // 恢复穿透」那条唯一的复位分支永不触发，余量区的"保持当前状态"于是退化成永久闩锁：',
  '  // 只要鱼有一次追到光标底下（或光标扫过鱼身）判成"可交互"，整只两倍宠物体积的透明窗',
  '  // 就跟着光标吃掉全桌面的点击（主人实测："开启跟随后鼠标无法点击程序内的任何东西"）。',
  '  // 只存标记、不直接翻转窗口——**唯一出口**仍是 setWindowIgnore（同 pet:input-busy 的理由：',
  '  // 否则会出现两条通道抢着翻同一个窗口的竞态）。',
  "  ipcMain.on('pet:follow-active', (event, on) => {",
  '    const win = BrowserWindow.fromWebContents(event.sender);',
  '    if (!win || win.isDestroyed()) return;',
  '    followActive.set(win.id, !!on);',
  '  });',
].join('\n');

/** helper preload.js：setFollowActive（插在 setInputBusy 之后） */
const PRELOAD_FOLLOW_BLOCK = [
  '  // 跟随鼠标是否生效（咪爱补丁 2026-10-10）：跟随中主进程兜底通道在窗口余量区一律穿透。',
  '  // 只在翻转时发一次（幂等，不逐帧）——与 setInputBusy 同款；完整归因见 helper main.js',
  '  // 的 pet:follow-active 处理器。',
  '  setFollowActive(on) {',
  "    ipcRenderer.send('pet:follow-active', !!on);",
  '  },',
].join('\n');

/** shared-core.js：菜单根上落「真实可见带」读数（插在根创建四行之后） */
const SHARED_CORE_CLAMP_BLOCK = [
  '\t// 咪爱补丁（2026-10-10·图三）：把本次菜单的真实可见带（helper 窗 ∩ 工作区）落到根上。',
  '\t// helper 窗比屏幕大（右/下各探出上百像素），window.innerHeight 含屏外带；miai-extras.js',
  '\t// 在挂载后前插饱腹行（面板变高）再重钳菜单时，若拿 innerHeight 当上界就永远钳不动 ——',
  '\t// 贴底菜单的底行留在屏幕外被裁。此处只落读数、不改行为；重钳读它，见 miai-extras.js。',
  '\troot.__dshPetClampRect = { x: c.x, y: c.y, w: c.w, h: c.h };',
].join('\n');

/** shared-core.js：showPanel 新版（行锚定双翼；取代 10-10 的候选阶梯——见上方锚点节归因） */
const SHARED_CORE_SHOWPANEL_NEW = [
  '\t/** 把面板显示在触发项旁边（咪爱补丁 2026-10-13·行锚定双翼）：',
  '\t*  ①横向上只在触发行左右两翼选位——右缘放得下用右缘（rect.right + 4），否则左缘',
  '\t*  （rect.left − w − 4），"放得下"按可见带（clamp 矩形）四边各留 4px 判定；',
  '\t*  ②纵向一律「行顶锚定 + 沉底夹取」：面板 maxHeight 已按带钳过 ⇒ 行在带内则面板',
  '\t*  纵向必罩住行，鼠标从行横移一步即进子面板（可达性优先于"不压父面板"）；',
  '\t*  ③两翼都放不下（面板比可见带还宽）才回落「贴右缘+翻转+夹取」（原版同一套）。',
  '\t*  历史：10-10 的候选阶梯（右→左→父上→父下）把纵向放不下误当位置不可用，③④锚的',
  '\t*  是**父面板**而非触发行 ⇒ 底部行的子面板飞到父面板上方几百像素，鼠标取道必离树、',
  '\t*  菜单秒关，三级选项永远点不到（2026-10-13 主人批）；10-10 的父面板避让阶梯已整体删除',
  '\t*  （连同名字符串都不留——构建自检按字面断言其绝迹，注释里写它也算残留）。 */',
  '\tconst showPanel = (panel, item) => {',
  '\t\tconst rect = item.getBoundingClientRect();',
  '\t\tpanel.style.left = "";',
  '\t\tpanel.style.top = "";',
  '\t\tpanel.style.display = "block";',
  '\t\tconst w = panel.offsetWidth;',
  '\t\tconst h = panel.offsetHeight;',
  '\t\t/** 横向完全落在可见带内（四边各留 4px） */',
  '\t\tconst fits = (l) => l >= c.x + 4 && l + w <= c.x + c.w - 4;',
  '\t\tlet left;',
  '\t\tif (fits(rect.right + 4)) left = rect.right + 4;',
  '\t\telse if (fits(rect.left - w - 4)) left = rect.left - w - 4;',
  '\t\telse {',
  '\t\t\tleft = rect.right + 4;',
  '\t\t\tif (left + w > c.x + c.w - 4) left = rect.left - w - 4;',
  '\t\t\tleft = Math.max(c.x + 4, left);',
  '\t\t}',
  '\t\tlet top = rect.top;',
  '\t\tif (top + h > c.y + c.h - 4) top = Math.max(c.y + 4, c.y + c.h - 4 - h);',
  '\t\tpanel.style.left = left + "px";',
  '\t\tpanel.style.top = top + "px";',
  '\t};',
].join('\n');

/** shared-core.js：菜单根 mouseleave 兜底新版（200→300ms；供体原文唯一，见锚点节 ） */
const SHARED_CORE_LEAVE_NEW = [
  '\t// 咪爱补丁（2026-10-13）：离开兜底 200→300ms。鼠标从二级菜单的行滑向三级子面板，',
  '\t// 途中要横穿两块面板之间的板缝（板边框+4px 间距），200ms 兜底会在半路把整棵树关掉',
  '\t// ——「三级选项还没点到就消失」的帮凶（主犯是子面板被阶梯甩飞，见 showPanel 节）。',
  '\t// 300ms 仍远短于"用户真的不想要了"的直觉时长；mouseover 重新进入即取消本定时器，',
  '\t// 误关概率不升。',
  '\troot.addEventListener("mouseleave", () => {',
  '\t\tif (leaveTimer !== null) window.clearTimeout(leaveTimer);',
  '\t\tleaveTimer = window.setTimeout(() => {',
  '\t\t\tleaveTimer = null;',
  '\t\t\tclose();',
  '\t\t}, 300);',
  '\t});',
].join('\n');

/** buildMenuTree 新版函数头（V1-30）：注释块 + 第二参签名 */
const SHARED_CORE_TREE_SIG_NEW = [
  '/**',
  ' * 咪爱补丁（2026-10-16·V1-30）：事件组白名单 —— 第二参 menuEvents 是宿主给的名单',
  ' * （咪爱 = config.ts 的 pet.menuEvents：balance、whisper 两组），数组时事件组只列名单内的',
  ' * 键；undefined / 非数组（老调用方）时保持原行为（全列），零影响。原版遍历 events 全键、',
  ' * 不读任何开关，「工作状态」这种宿主从不写叶子的死组也摆上菜单（V1-30 审计）。',
  ' */',
  'function buildMenuTree(animations, menuEvents) {',
].join('\n');

/** 事件组遍历头新版（V1-30）：名单计算插在 events 常量与 for 之间 */
const SHARED_CORE_TREE_EVENTS_NEW = [
  '\tconst events = animations.events ?? {};',
  '\t// 咪爱补丁（V1-30）：名单为数组时只列名单内的事件组（宿主从不写叶子的死组不上菜单）；',
  '\t// 非数组（老调用方）保持原行为全列。',
  '\tconst eventKeys = Array.isArray(menuEvents)',
  '\t\t? Object.keys(events).filter((k) => menuEvents.includes(k))',
  '\t\t: Object.keys(events);',
  '\tfor (const key of eventKeys) {',
].join('\n');

/** 树根标签新版（V1-30）：用户视角的入口名（原「动作」是工程词） */
const SHARED_CORE_TREE_ROOTLABEL_NEW = [
  '\t\t// 咪爱补丁（V1-30）：原「动作」是工程词，换用户视角的入口名。',
  '\t\tlabel: "让大肥鱼做点什么",',
].join('\n');

/** 对话失败红字行新版（V1-37）：卖萌文案 + 技术原因转控制台 */
const SHARED_CORE_CHAT_FAIL_NEW = [
  '\t\t\t\t// 咪爱补丁（2026-10-16·V1-37）：红字不再拼裸枚举（原为「对话失败：」缀',
  '\t\t\t\t// state.message ?? state.reason）—— 文案真源 = copy.ts 的 PET.CHAT_DIALOG_FAIL，',
  '\t\t\t\t// 同源闸逐字守着；技术原因转控制台，用户视野只有卖萌。',
  '\t\t\t\terr.textContent = "呜……这句本鱼没接住，再试一次吧喵。";',
  '\t\t\t\tconsole.warn("[dsh-pet] 对话失败（技术原因，不进气泡）：", state.message ?? state.reason);',
].join('\n');

/** 对话异常红字行新版（V1-37）：同上一处 —— 英文异常原文不再进用户视野 */
const SHARED_CORE_CHAT_CATCH_NEW = [
  '\t\t\t// 咪爱补丁（2026-10-16·V1-37）：同上一处 —— 异常原文（多为英文）不再进红字。',
  '\t\t\t// 文案真源 = copy.ts 的 PET.CHAT_DIALOG_ERR。',
  '\t\t\terr.textContent = "呜……大肥鱼走神了，这句没传过去，再试一次吧喵。";',
  '\t\t\tconsole.warn("[dsh-pet] 对话异常（技术原因，不进气泡）：", e);',
].join('\n');

// ---------- 工具函数 ----------

/** 统计子串出现次数（逐次 indexOf 原地推进，不作正则解释） */
function countOccurrences(src, needle) {
  if (!needle) throw new Error('[dshpet-patch] 内部错误：空锚点');
  let count = 0;
  let i = src.indexOf(needle);
  while (i !== -1) {
    count += 1;
    i = src.indexOf(needle, i + needle.length);
  }
  return count;
}

/** 断言锚点恰好命中一次，返回唯一命中位置 */
function findUniqueAnchor(src, anchor, stepDesc) {
  const count = countOccurrences(src, anchor);
  if (count !== 1) {
    throw new Error(
      '[dshpet-patch] 锚点命中 ' + count + ' 次（要求恰好 1 次）：' + stepDesc + '\n' +
        '锚点开头：' + anchor.slice(0, 80),
    );
  }
  return src.indexOf(anchor);
}

/** 唯一命中替换（用 slice 拼接，避免 String.replace 对 $ 的替换语义） */
function replaceOnce(src, anchor, replacement, stepDesc) {
  const at = findUniqueAnchor(src, anchor, stepDesc);
  return src.slice(0, at) + replacement + src.slice(at + anchor.length);
}

// ---------- 对外接口 ----------

/**
 * 是否已打过咪爱版补丁。全部标记在场才返回 true（半打补丁不认，见 PATCH_MARKERS 处说明）。
 * @param {string} src
 * @returns {boolean}
 */
export function isPatched(src) {
  return PATCH_MARKERS.every((m) => src.includes(m));
}

/**
 * 给 dsh-pet 的 sprite.js 打咪爱版菜单补丁。
 * @param {string} src 原始（或已打补丁的）sprite.js 源码
 * @returns {{ code: string, applied: string[] }} applied 为空数组表示是幂等重跑
 */
export function patchSpriteJs(src) {
  if (isPatched(src)) return { code: src, applied: [] };

  const applied = [];

  // 步骤 1：桌面工具根项整段替换（注释头 → tools.push 收尾括号，含其间全部内容）
  const startAt = findUniqueAnchor(src, SPRITE_TOOLS_START, 'sprite.js 桌面工具根项注释头（菜单块起点）');
  const endAt = findUniqueAnchor(src, SPRITE_TOOLS_END, 'sprite.js tools.push 收尾（菜单块终点）');
  if (endAt <= startAt) {
    throw new Error('[dshpet-patch] 菜单块起止锚点顺序颠倒：end=' + endAt + ' start=' + startAt);
  }
  const oldBlock = src.slice(startAt, endAt + SPRITE_TOOLS_END.length);
  // 取证：命中块必须确实是原版工具数组，否则立刻红（防锚点漂移到别处还静默通过）
  for (const mustHave of ['打开网站', 'action: \'show-balance\'', 'balanceEnabled', 'tools.push(']) {
    if (!oldBlock.includes(mustHave)) {
      throw new Error('[dshpet-patch] 菜单块取证失败：命中段不含 ' + JSON.stringify(mustHave));
    }
  }
  let code = src.slice(0, startAt) + NEW_TOOLS_BLOCK + src.slice(endAt + SPRITE_TOOLS_END.length);
  applied.push(
    'sprite.js：桌面工具根项整段替换为咪爱菜单（跟着我走·别跟着啦[三元·有资格可点；没资格时改画置灰解释行「跟着我走（差在哪）」——V1-49]/打开壁纸设置/打开 AI 设置/喂一碗大白饭/摸摸鱼头/听大肥鱼碎碎念/跟本鱼聊天/[查看余额·balanceEnabled 条件项——V1-30]/回到初始位置/重载宠物/关闭大肥鱼，顺序固定）',
  );

  // 步骤 1b：菜单树拼接行传宿主的事件组名单（V1-30）—— 树只列有数据源的组。
  // 单列成步：老文件的这一行不含第二参，替换失败会响亮 throw（不许静默跳过、
  // 不许默认回退为成功）。
  code = replaceOnce(
    code,
    SPRITE_MENUTREE_CALL_ANCHOR,
    SPRITE_MENUTREE_CALL_NEW,
    'sprite.js 菜单树拼接行（menuEvents 传参插入点）',
  );
  applied.push('sprite.js：菜单树拼接行传 this.pet.menuEvents（事件组只列有数据源的；V1-30）');

  // 步骤 2：onMenuAction 路由加五个分支（插在入参守卫之后、open-site 分支之前）
  const guard = "    if (!leaf || typeof leaf !== 'object') return;";
  const guardCount = countOccurrences(code, SPRITE_ROUTE_ANCHOR);
  if (guardCount !== 1) {
    throw new Error(
      '[dshpet-patch] 锚点命中 ' + guardCount + ' 次（要求恰好 1 次）：sprite.js onMenuAction 守卫行+open-site 分支（路由插入点）',
    );
  }
  code = replaceOnce(
    code,
    SPRITE_ROUTE_ANCHOR,
    guard + NEW_ROUTE_BRANCHES + "\n    if (leaf.action === 'open-site') {",
    'sprite.js onMenuAction 路由插入点',
  );
  applied.push(
    "sprite.js：onMenuAction 新增 'miai-follow-toggle'（POST /miai/follow 翻转跟随）、'miai-wallpaper'/'miai-ai'（POST /miai/open-settings?tab=…）、'miai-feed'/'miai-pat'（POST+轮询，喂饭/摸头）与 'miai-pet-off'（POST /miai/pet-off 关闭大肥鱼）六个分支",
  );

  return { code, applied };
}

/**
 * 给 dsh-pet 的 index.html 注入 miai-extras.js（在 renderer.js 之后、</body> 之前）。
 * @param {string} src
 * @returns {{ code: string, applied: string[] }}
 */
export function patchIndexHtml(src) {
  // 幂等判定必须用"注入后的精确邻接形状"（renderer.js 行紧跟 extras 行），不许用 './miai-extras.js'
  // 这种松散的子串——否则源码里任何一处顺带提到该文件名的注释都会让补丁静默跳过。
  const injected = '    <script src="./renderer.js"></script>\n' + HTML_INJECT_LINE;
  if (src.includes(injected)) return { code: src, applied: [] };

  const code = replaceOnce(
    src,
    HTML_ANCHOR,
    '    <script src="./renderer.js"></script>\n' + HTML_INJECT_LINE + '\n  </body>',
    'index.html renderer.js 之后 / </body> 之前',
  );
  return { code, applied: ['index.html：</body> 前、renderer.js 更后处注入 <script src="./miai-extras.js"></script>'] };
}

/**
 * 是否已给 main.js 打过咪爱自退补丁。与 sprite.js 的 isPatched 各自独立：
 * 两个文件三套标记，别混用一个布尔（半打补丁不认的口径同 sprite）。
 * @param {string} src
 * @returns {boolean}
 */
export function isMainPatched(src) {
  return src.includes(MAIN_PATCH_MARKER) && src.includes(MAIN_FOLLOW_MARKER);
}

/**
 * 给 dsh-pet helper 的 main.js 打两段咪爱补丁：
 *   ①「关闭大肥鱼自退」：handleBridgeRequest 把 /miai/pet-off 转发给宿主、拿到回包之后
 *      setTimeout(app.exit(0), 120) 自退（机制与证据见文件头 ③）。
 *   ②「跟随穿透」：followActive 镜像表 + pet:follow-active 处理器 + 兜底轮询的判定实参
 *      （归因见锚点节大段注释）—— 三段编辑同一个标记，半打状态不认。
 * 两段各自按标记幂等（都打过 → applied 为空）。
 * @param {string} src 原始（或已打补丁的）main.js 源码
 * @returns {{ code: string, applied: string[] }} applied 为空数组表示是幂等重跑
 */
export function patchMainJs(src) {
  const applied = [];
  let code = src;
  if (!code.includes(MAIN_PATCH_MARKER)) {
    code = replaceOnce(
      code,
      MAIN_PETOFF_ANCHOR,
      MAIN_PETOFF_ANCHOR + '\n' + MAIN_PETOFF_BLOCK,
      'main.js handleBridgeRequest 等宿主回包行（pet-off 自退插入点）',
    );
    applied.push(
      'main.js：/miai/pet-off 回包后 app.exit(0) 自退（关宠不再依赖宿主 TerminateProcess，宿主 800ms 宽限兜底）',
    );
  }
  if (!code.includes(MAIN_FOLLOW_MARKER)) {
    code = replaceOnce(
      code,
      MAIN_BUSY_MAP_ANCHOR,
      MAIN_BUSY_MAP_ANCHOR + '\n\n' + MAIN_FOLLOW_MAP_BLOCK,
      'main.js inputBusy 镜像表声明行（followActive 表插入点）',
    );
    code = replaceOnce(
      code,
      MAIN_BUSY_IPC_ANCHOR,
      MAIN_BUSY_IPC_ANCHOR + '\n' + MAIN_FOLLOW_IPC_BLOCK,
      'main.js pet:input-busy 处理器（pet:follow-active 处理器插入点）',
    );
    code = replaceOnce(code, MAIN_POLL_ANCHOR, MAIN_POLL_NEW, 'main.js 兜底轮询的判定调用行（加 followActive 实参）');
    code = replaceOnce(
      code,
      MAIN_CLEANUP_ANCHOR,
      MAIN_CLEANUP_NEW,
      'main.js 窗口关闭时的镜像清理（补 followActive.delete）',
    );
    applied.push('main.js：跟随中窗口余量区一律穿透（followActive 镜像表 + pet:follow-active + 轮询实参 + 清理）');
  }
  return { code, applied };
}

/**
 * 是否已给 pointer-target.js 打过「跟随中余量区穿透」补丁。
 * @param {string} src
 * @returns {boolean}
 */
export function isPointerPatched(src) {
  return src.includes(POINTER_PATCH_MARKER);
}

/**
 * 给 dsh-pet helper 的 pointer-target.js 打「跟随中余量区穿透」补丁：函数加第 5 个参数
 * followActive，为真时余量区直接返回 true（穿透），不再"保持当前状态"。
 * 归因、为什么默认值缺席时等于原规则：见本文件锚点节的大段注释。
 * @param {string} src 原始（或已打补丁的）pointer-target.js 源码
 * @returns {{ code: string, applied: string[] }}
 */
export function patchPointerTargetJs(src) {
  if (isPointerPatched(src)) return { code: src, applied: [] };
  let code = replaceOnce(
    src,
    PT_SIG_ANCHOR,
    'function decideWindowIgnore(bounds, point, ignoring, busy, followActive) {',
    'pointer-target.js decideWindowIgnore 函数签名行',
  );
  code = replaceOnce(code, PT_DOC_ANCHOR, PT_DOC_PARAM + '\n' + PT_DOC_ANCHOR, 'pointer-target.js JSDoc 参数块尾部');
  // 插在 inSprite 分支**与**「保持」兜底行之间（顺序即语义，见 PT_TAIL_ANCHOR 注释）
  code = replaceOnce(
    code,
    PT_TAIL_ANCHOR,
    PT_SPRITE_BRANCH + '\n' + PT_FOLLOW_RULE + '\n' + PT_LATCH_LINE,
    'pointer-target.js 余量区分支',
  );
  // 取证：补丁后的函数必须真的吃上了新参数（防"签名改了、规则没插"的半打状态静默通过）
  if (!code.includes('followActive === true')) {
    throw new Error('[dshpet-patch] pointer-target.js 补丁后仍找不到 followActive 规则');
  }
  // 取证：顺序必须正确 —— 「文件里有那行字」不足以证明它在对的位置（见过一次错序）
  if (!code.includes(PT_SPRITE_BRANCH + '\n  // 咪爱补丁（2026-10-10）')) {
    throw new Error('[dshpet-patch] pointer-target.js 的放行规则插到了 inSprite 之前（跟随中鱼不可点，右键菜单打不开）');
  }
  return {
    code,
    applied: ['pointer-target.js：decideWindowIgnore 加 followActive 参数 —— 跟随中窗口余量区一律穿透（修「跟随吞点击」）'],
  };
}

/**
 * 是否已给 helper preload.js 打过 setFollowActive 补丁。
 * @param {string} src
 * @returns {boolean}
 */
export function isPreloadPatched(src) {
  return src.includes(PRELOAD_PATCH_MARKER);
}

/**
 * 给 dsh-pet helper 的 preload.js 打「setFollowActive」补丁：把渲染端的跟随状态
 * 透给主进程（pet:follow-active），主进程据此在余量区放行点击。
 * @param {string} src 原始（或已打补丁的）preload.js 源码
 * @returns {{ code: string, applied: string[] }}
 */
export function patchPreloadJs(src) {
  if (isPreloadPatched(src)) return { code: src, applied: [] };
  const code = replaceOnce(
    src,
    PRELOAD_BUSY_ANCHOR,
    PRELOAD_BUSY_ANCHOR + '\n' + PRELOAD_FOLLOW_BLOCK,
    'preload.js setInputBusy（setFollowActive 插入点）',
  );
  return {
    code,
    applied: ['preload.js：petBridge.setFollowActive 暴露（跟随状态 → 主进程 pet:follow-active）'],
  };
}

/**
 * 是否已给 shared-core.js 打过「右键菜单」补丁（六处标记全在才算）。
 * @param {string} src
 * @returns {boolean}
 */
export function isSharedCorePatched(src) {
  return (
    src.includes(SHARED_CORE_CLAMP_MARKER) &&
    src.includes(SHARED_CORE_SHOWPANEL_MARKER) &&
    src.includes(SHARED_CORE_LEAVE_MARKER) &&
    src.includes(SHARED_CORE_DISABLED_MARKER) &&
    src.includes(SHARED_CORE_TREE_MARKER) &&
    src.includes(SHARED_CORE_CHATFIX_MARKER)
  );
}

/**
 * 给 dsh-pet helper 的 shared-core.js 打「右键菜单」补丁
 * （2026-10-10 图三/图四；2026-10-13 主人批·三级点不到 —— 行锚定双翼取代候选阶梯；
 * 2026-10-16 V1-49 —— 菜单叶子分支加置灰项支持；
 * 2026-10-16 夜 V1-30/V1-37 —— 菜单树白名单+根标签、对话兜底文案）：
 * ①菜单根落 __dshPetClampRect 可见带读数（miai-extras.js 重钳菜单的上下界来源）；
 * ②showPanel 换行锚定双翼版（横向右/左两翼，纵向行顶锚定+沉底夹取；两翼全灭回原夹取）；
 * ③菜单根 mouseleave 兜底 200→300ms；
 * ④buildPanel 叶子分支：node.disabled === true 的项渲染成置灰不可点（跟随没资格时的
 *   「跟着我走（差在哪）」解释行）。完整归因见本文件「右键菜单定位补丁」锚点节。
 * ⑤buildMenuTree 收第二参 menuEvents（宿主名单）——数组时事件组只列有数据源的组、
 *   非数组（老调用方）原样全列；树根标签「动作」→「让大肥鱼做点什么」（V1-30）；
 * ⑥对话弹窗失败/异常兜底红字换卖萌文案，裸枚举与英文异常原文转 console.warn（V1-37；
 *   文案真源 = copy.ts 的 PET.CHAT_DIALOG_FAIL/ERR，同源闸逐字守）。
 * @param {string} src 原始（或已打补丁的）shared-core.js 源码
 * @returns {{ code: string, applied: string[] }}
 */
export function patchSharedCoreJs(src) {
  if (isSharedCorePatched(src)) return { code: src, applied: [] };
  let code = replaceOnce(
    src,
    SHARED_CORE_ROOT_ANCHOR,
    SHARED_CORE_ROOT_ANCHOR + '\n' + SHARED_CORE_CLAMP_BLOCK,
    'shared-core.js 菜单根创建块（clamp 读数插入点）',
  );
  code = replaceOnce(code, SHARED_CORE_SHOWPANEL_ANCHOR, SHARED_CORE_SHOWPANEL_NEW, 'shared-core.js showPanel 旧整段');
  code = replaceOnce(code, SHARED_CORE_LEAVE_ANCHOR, SHARED_CORE_LEAVE_NEW, 'shared-core.js 菜单根 mouseleave 兜底段');
  code = replaceOnce(
    code,
    SHARED_CORE_LEAF_ANCHOR,
    SHARED_CORE_DISABLED_BLOCK + '\n' + SHARED_CORE_LEAF_ANCHOR,
    'shared-core.js 菜单叶子分支头（置灰项分支插入点）',
  );
  // ⑤ 菜单树（V1-30）：签名收第二参 → 事件组遍历挂白名单 → 树根标签换用户视角入口名。
  //    三步都要走（半打会留下签名不看名单的空转态），顺序即语义：先让函数收得到名单。
  code = replaceOnce(code, SHARED_CORE_TREE_SIG_ANCHOR, SHARED_CORE_TREE_SIG_NEW, 'shared-core.js buildMenuTree 签名行');
  code = replaceOnce(code, SHARED_CORE_TREE_EVENTS_ANCHOR, SHARED_CORE_TREE_EVENTS_NEW, 'shared-core.js 菜单树事件组遍历头');
  code = replaceOnce(
    code,
    SHARED_CORE_TREE_ROOTLABEL_ANCHOR,
    SHARED_CORE_TREE_ROOTLABEL_NEW,
    'shared-core.js 菜单树根标签行',
  );
  // ⑥ 对话兜底（V1-37）：失败/异常两处红字换卖萌文案，技术原因转 console.warn。
  code = replaceOnce(code, SHARED_CORE_CHAT_FAIL_ANCHOR, SHARED_CORE_CHAT_FAIL_NEW, 'shared-core.js 对话失败红字行');
  code = replaceOnce(code, SHARED_CORE_CHAT_CATCH_ANCHOR, SHARED_CORE_CHAT_CATCH_NEW, 'shared-core.js 对话异常红字行');
  // 取证：关键形态全在（防锚点漂移改出个"看着对"的文件静默通过）
  for (const mustHave of [
    SHARED_CORE_CLAMP_MARKER,
    SHARED_CORE_SHOWPANEL_MARKER,
    SHARED_CORE_LEAVE_MARKER,
    SHARED_CORE_DISABLED_MARKER,
    SHARED_CORE_TREE_MARKER,
    SHARED_CORE_CHATFIX_MARKER,
    'node.disabled === true',
    'item.style.pointerEvents = "none";',
    'const fits = (l) => l >= c.x + 4 && l + w <= c.x + c.w - 4;',
    'if (fits(rect.right + 4)) left = rect.right + 4;',
    'else if (fits(rect.left - w - 4)) left = rect.left - w - 4;',
    'if (top + h > c.y + c.h - 4) top = Math.max(c.y + 4, c.y + c.h - 4 - h);',
    '}, 300);',
    'function buildMenuTree(animations, menuEvents) {',
    'const eventKeys = Array.isArray(menuEvents)',
    '? Object.keys(events).filter((k) => menuEvents.includes(k))',
    'for (const key of eventKeys) {',
    'label: "让大肥鱼做点什么",',
    'err.textContent = "呜……这句本鱼没接住，再试一次吧喵。";',
    'err.textContent = "呜……大肥鱼走神了，这句没传过去，再试一次吧喵。";',
    'console.warn("[dsh-pet] 对话失败（技术原因，不进气泡）：", state.message ?? state.reason);',
    'console.warn("[dsh-pet] 对话异常（技术原因，不进气泡）：", e);',
  ]) {
    if (!code.includes(mustHave)) {
      throw new Error('[dshpet-patch] shared-core.js 补丁后找不到 ' + JSON.stringify(mustHave));
    }
  }
  // 取证：10-10 阶梯、200ms 兜底、旧树行为、旧红字的残迹必须零（半打 = 两份算法并存，语义互相打架）
  for (const mustGone of [
    'parentPanel',
    'hitsParent',
    'inBand',
    'pr.top - 4 - h',
    'pr.bottom + 4',
    '}, 200);',
    'function buildMenuTree(animations) {',
    '\tfor (const key of Object.keys(events)) {',
    '\t\tlabel: "动作",',
    '"对话失败："',
    '"对话异常："',
  ]) {
    if (code.includes(mustGone)) {
      throw new Error('[dshpet-patch] shared-core.js 补丁后仍残留 ' + JSON.stringify(mustGone));
    }
  }
  // 取证：clamp 读数恰好一处（根锚点在补丁后不会消失，半打重跑会插两遍 —— 让它当场红）
  const clampHits = countOccurrences(code, SHARED_CORE_CLAMP_MARKER);
  if (clampHits !== 1) {
    throw new Error('[dshpet-patch] shared-core.js 的 clamp 读数出现 ' + clampHits + ' 次（要求恰好 1 次）');
  }
  // 取证：置灰标记恰好一处（只在渲染分支的 classList.add；样式是内联的，没有第二处）
  const offHits = countOccurrences(code, SHARED_CORE_DISABLED_MARKER);
  if (offHits !== 1) {
    throw new Error('[dshpet-patch] shared-core.js 的置灰标记出现 ' + offHits + ' 次（要求恰好 1 次）');
  }
  return {
    code,
    applied: [
      'shared-core.js：菜单根落 __dshPetClampRect 可见带读数 + showPanel 行锚定双翼（右缘/左缘两翼，纵向行顶锚定+沉底夹取；两翼全灭回原夹取）+ 菜单根 mouseleave 兜底 200→300ms + 菜单置灰项分支（node.disabled，V1-49）',
      'shared-core.js：buildMenuTree 收 menuEvents 白名单（数组时事件组只列名单内、非数组全列）+ 树根标签「动作」→「让大肥鱼做点什么」（V1-30）',
      'shared-core.js：对话弹窗失败/异常红字换卖萌文案（裸枚举与英文异常原文转 console.warn；V1-37）',
    ],
  };
}
