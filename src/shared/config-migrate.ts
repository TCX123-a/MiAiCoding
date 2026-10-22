/**
 * config.json 的**版本迁移** —— 铁律 6 的落地。
 *
 * 【铁律 6 说的是什么，为什么它不是形式主义】
 * `json-store.ts` 把 JSON 原样搬进搬出，**从头到尾不读 `version`**。
 * 所以老配置文件会带着老结构被新代码直接加载：新加的字段是 `undefined`，
 * 轻则功能异常，重则崩。而崩了之后走「解析失败 → 重建空结构」这条路，
 * **会静默清零用户的全部学习进度**。
 *
 * 本项目在这之前**一处迁移都没有**（`src/main/index.ts` 有一段注释专门
 * 记着这件事：当时为了躲开迁移，宁可多开一个 challenge.json）。加
 * `soundEnabled` 是第一次真的需要，所以这套东西是**新建**的，不是补的。
 *
 * 【历史欠账：layout】
 * `layout` 是加本机制之前新增的字段，它的补齐写在 `normalizeLayout()` 里，
 * 每次读配置时跑一遍——能用，但**文件里的 version 永远停在 1**，事后分不出
 * 一份配置是哪个年代的。这次一并收进迁移：v1 → v2 会经过 `normalizeLayout`，
 * 行为和老代码完全一致（不会把谁拖好的宽度弹回去），只是从此有了版本记录。
 *
 * 【为什么是纯函数】它要能被 Vitest 直接测。而这里最要命的几条
 * ——「apiKey 不能被抹掉」「老配置读出来 soundEnabled 必须是 true」——
 * 正好是最该被测试钉死、又最容易被一次「顺手简化」弄坏的东西。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律英文**（给开发者看的），
 *    中文只出现在注释里。
 */
import {
  CURRENT_CONFIG_VERSION,
  DEFAULT_APP_CONFIG,
  LANG_OF_CODE,
  THEME_NAMES,
  emptyIdePaths,
  normalizePetConfig,
  type AppConfig,
  type EnvCache,
  type LangOfCode,
  type MiThemeName
} from './types'
import { IDE_PRODUCTS, UNIVERSAL_IDE_PRODUCTS, ideNameOf } from './ide-profiles'
import { normalizeLayout } from './layout'
import { normalizeWallpaper } from './wallpaper'
import { normalizeSplash } from './splash'

/**
 * 运行超时的合法区间（秒）。
 *
 * 【为什么定义在这里而不是 config-merge.ts】这是 **schema 的取值边界**，
 * 和版本号是一类东西：它描述「一份合法的配置长什么样」。迁移要用它来钳老数据，
 * 保存要用它来钳新输入——**两处必须是同一个区间**，所以只能有一份定义。
 * `config-merge.ts` 从本文件转出，保持既有引用点不变。
 */
export const MIN_TIMEOUT_SEC = 1
export const MAX_TIMEOUT_SEC = 60

/**
 * 音效音量的合法区间（百分比）。
 *
 * 和超时那对一样，**定义在 schema 这一侧、由读写两侧共用**：
 * 迁移要用它钳老数据，保存要用它钳新输入。两份定义就是两处漂移，
 * 而症状是"设置页能拨到 80、重启之后是 100"这种没人会去查的东西。
 */
export const MIN_SFX_VOLUME = 0
export const MAX_SFX_VOLUME = 100

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/** 秒数：先过 `Number.isFinite`，再钳区间。**NaN 必须在这里被挡死**，理由见 config-merge */
function seconds(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(Math.max(Math.round(v), MIN_TIMEOUT_SEC), MAX_TIMEOUT_SEC)
}

/**
 * 音量百分比：先过 `Number.isFinite`，再**四舍五入 + 钳进区间**。
 *
 * 【为什么是 `export`，而不是在本文件里自己用】和上面那对 MIN/MAX 同源：
 * 这是「一份 0~100 的整数」这件事的**唯一实现**。`config-merge.ts` 在交给
 * 渲染进程之前要过第二道，那道必须和我这道逐字节同行为 —— 各写一遍的话，
 * 某天有人只改了其中一边（比如这边加了四舍五入），症状就是
 * 「从老文件迁出来是整数、保存一次之后变成 79.99999」，没人会去查。
 *
 * 【为什么每一道都不能省】
 *   · `Number.isFinite`：`NaN` 和 `Infinity` 能穿过 `Math.min`/`Math.max`
 *     （NaN 跟谁比都是 false，`Math.max(NaN, 0)` 还是 NaN）。而 `NaN` 一旦
 *     进到 `gain.gain.value = NaN`，那一路音效就**永远不响**，且不报错 ——
 *     表现是"点了没声音"，查的时候会先去怀疑音频文件。和 `seconds()` 同一个洞。
 *   · 四舍五入：0~100 的整数是**给用户看的数**，落盘时留着 79.99999 会让
 *     界面显示和文件内容对不上。
 *   · 钳区间：写坏的值（手改配置文件写成 500）必须在**读**的时候就拉回来，
 *     否则 500% 会变成增益 5 倍 —— 一耳朵是爆音，第二耳朵是客户投诉。
 */
export function clampVolume(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(Math.max(Math.round(v), MIN_SFX_VOLUME), MAX_SFX_VOLUME)
}

/** 非空字符串才算数；空的、纯空白的、非字符串一律退回 fallback */
function text(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback
}

/**
 * 主题名：**必须是白名单里那几个字面量之一**，别的一律退回 fallback。
 *
 * 【为什么不写成 `text(v, fallback)` 就完事】
 * 那样一个 `theme: "Dark"`（大写）或者 `theme: "sepia"` 会被**原样搬进内存**，
 * 然后一路传到渲染进程、写成 `<html data-theme="Dark">` —— 那串 CSS 选择器
 * 是 `:root[data-theme='dark']`，匹配不上，于是界面**静默退回浅色**。
 * 用户看到的症状是「我明明设了夜间模式，重启又变回来了」，而没有任何报错。
 * 白名单是唯一能在这里拦住它的地方。
 */
function themeName(v: unknown, fallback: MiThemeName): MiThemeName {
  return THEME_NAMES.includes(v as MiThemeName) ? (v as MiThemeName) : fallback
}

/**
 * 把任意一份「从 config.json 读出来的东西」搬成**当前版本**的完整配置。
 *
 * 【为什么入参类型是 `unknown` 而不是 `AppConfig`】
 * 因为它的全部意义就是「输入不一定长成 AppConfig」。写成 AppConfig 等于
 * 自欺欺人：真正的老文件里 `soundEnabled` 根本不存在，类型系统假装它在，
 * 调用方就会理所当然地直接读——那正是要防的事。
 *
 * 【几条不可动摇的规矩】
 *   1. **`ai.apiKey` 必须原样带过去**。抹掉它 = 用户重新去 DeepSeek 后台
 *      生成一次 Key，而且他不会知道是我们弄丢的。这一条有专门的单测。
 *   2. **逐字段搬运，不整体 spread**。spread 会把文件里那些我们不认识的
 *      垃圾字段一起带进内存，也会让「这个字段到底处理过没有」变得看不出来。
 *   3. **输入不是对象时给一份默认配置，并且出声**（`console.warn`）。
 *      铁律里明令禁止的就是「静默重建」——重建可以，不许不留痕。
 *
 * 【已知取舍：版本比当前还新时会发生什么】
 * 用户装过更新的版本又装回旧版时，`raw.version` 会大于当前版本。这里**不特殊处理**，
 * 照常走同一套搬运——结果是「认识的字段保留，不认识的字段丢掉」。
 * 不处理是有意的：另一种做法（整份拒绝、退回默认值）会把用户**全部**设置清掉，
 * 比丢掉几个未来字段严重得多。
 */
export function migrateConfig(raw: unknown): AppConfig {
  if (!isObject(raw)) {
    // 走到这里说明 config.json 里是个数组/字符串/null 之类的东西。
    // **必须出声**：这是「用户的配置文件坏了」，不是正常路径。
    console.warn('[miai] config.json is not an object, falling back to defaults')
    return structuredClone(DEFAULT_APP_CONFIG)
  }

  const ai = isObject(raw.ai) ? raw.ai : {}

  return {
    // 无条件写成当前版本：迁移的产出**永远**是当前版本，这是它的定义。
    // 不写成 `raw.version`——那样迁完还是老版本号，下次读又得再迁一遍。
    version: CURRENT_CONFIG_VERSION,
    reviewEnabled: bool(raw.reviewEnabled, DEFAULT_APP_CONFIG.reviewEnabled),
    runTimeoutSec: seconds(raw.runTimeoutSec, DEFAULT_APP_CONFIG.runTimeoutSec),
    // ── v1 → v2 的那一行 ────────────────────────────────────────────
    // 老配置里没有这个字段，`bool` 会给出 true：**升级上来的用户默认开着音效**。
    // 和全新安装保持一致——没道理让「先装的人」和「后装的人」听到不一样的东西。
    soundEnabled: bool(raw.soundEnabled, true),
    // ── v2 → v3 的那一行 ────────────────────────────────────────────
    // 老配置里没有这个字段，`themeName` 会给出 'light'：**升级上来的用户界面不变**。
    // 这里和 soundEnabled 那行的取值方向**刚好相反**（那边给 true），
    // 因为两者默认值不同：音效默认开是「软件的性子」，主题默认浅是「别动用户已有的东西」。
    theme: themeName(raw.theme, DEFAULT_APP_CONFIG.theme),
    // ── v3 → v4 的那一行 ────────────────────────────────────────────
    // 老配置里没有这个字段，`bool` 会给出 false：**升级上来的用户保持关着**。
    // 方向同 theme、**反于 soundEnabled** —— 音效默认开是「软件的性子」，
    // 而这条会把用户代码交给**他自己 PATH 里那个**编译器去跑（版本可能和课文
    // 讲的不一样），还会让每次点运行多一个弹窗。这种开关只能由用户自己打开。
    nativeRunEnabled: bool(raw.nativeRunEnabled, DEFAULT_APP_CONFIG.nativeRunEnabled),
    // ── v4 → v5 的那一行 ────────────────────────────────────────────
    // 老配置里没有这个字段，`volume` 会给出 100：**升级上来的用户听到的音量和
    // 昨天一模一样**。方向同 soundEnabled（默认值是"软件的性子"，不是"别动用户
    // 已有的东西"）—— 只不过它的性子里本来就写着 100%。
    // 钳区间和 NaN 都得在这儿挡住：这是**读**的唯一入口，放进去就再也拦不住了。
    sfxVolume: clampVolume(raw.sfxVolume, DEFAULT_APP_CONFIG.sfxVolume),
    // layout 走和当年完全相同的补齐逻辑，行为不变，只是从此有了版本记录
    // ── v10 → v11 的那一行 ────────────────────────────────────────────
    // 老配置里没有 `sidebarOpen`，`normalizeLayout` 补 true：**升级上来的用户
    // 第一眼和升级前一模一样**。方向同 rightPanelOpen —— 绝不把「文件里没有
    // 这个字段」当成「用户关掉了它」；收起只能由用户自己拖出来或点按钮点出来。
    // ── v17 → v18 的那一段 ───────────────────────────────────────────
    // sidebarRail（左栏三态「open → rail → hidden」的中间态，图标窄栏）同走
    // normalizeLayout 就地补 false：老配置读出来 = 正常宽度的左栏，**与升级前
    // 逐字节同行为**（rail 是用户亲手按出来/拖出来的形态，升级不能替他做）。
    // 同一道归一化还把「关着还带 rail」的脏组合钳掉（收起与窄栏互斥）——
    // 无独立迁移段，本条注释即迁移记录。
    layout: normalizeLayout(raw.layout),
    // ── v5 → v6 的那一行 ────────────────────────────────────────────
    // 老配置里没有这个字段，`bool` 会给出 true：**收藏练习答错照样进错题本**。
    // 方向同 soundEnabled（默认值是"软件的性子"、不是"别动用户已有的东西"）——
    // 全应用每一种练习答错都进，收藏练习没有理由在升级的一瞬间变成例外。
    favWrongToBook: bool(raw.favWrongToBook, DEFAULT_APP_CONFIG.favWrongToBook),
    // ── v7 → v8 的那一行 ────────────────────────────────────────────
    // 老配置里没有这个字段，`bool` 会给出 false：**升级上来的用户保持
    // 「每跑一次问一句」** —— 那正是升级前的行为。方向同 nativeRunEnabled
    // （默认值是"别动用户已有的东西"）：默认 true 的话，一个从没勾过
    // 「不再提醒」的用户会发现弹窗自己没了、代码被交给另一个编译器，
    // 全程无提示。「替用户省掉一次确认」只能由用户在弹窗里自己点头。
    nativeRunQuiet: bool(raw.nativeRunQuiet, DEFAULT_APP_CONFIG.nativeRunQuiet),
    // ── v8 → v9 的那一行 ────────────────────────────────────────────
    // 单个 nativeIdePath 拆成「每语言一键」的四键表（分派规则写在下面
    // migrateIdePaths 的函数头上）。空/坏值 → 四键全空，方向同
    // nativeRunEnabled：升级上来的用户保持未配置，点「打开」时按语言
    // 现检现荐，而不是替他把旧值钉死到某几门语言头上。
    nativeIdePaths: migrateIdePaths(raw),
    // ── v9 → v10 的那一行 ────────────────────────────────────────────
    // 整块全新（老配置里没有它），normalizeWallpaper 给全默认值并逐字段净化。
    // ⚠️ 默认方向是**开**（决策点 7）：只垫一层零成本的主题渐变底，没有弹窗、
    // 不改交互——和 nativeRunEnabled 那种「新增功能默认关」的方向相反，
    // 理由写在 shared/wallpaper.ts 的头注释里。
    // ── v11 → v12 的那一段 ───────────────────────────────────────────
    // 同一个 normalizeWallpaper 就地补新键（transitionDir='left'、
    // objectFit='cover'、trackOn=true）——都是「外观面板移植」的调节项，
    // 没有数据结构变更，所以不进独立迁移段：老文件里没有这些键时，
    // normalize 给的就是与升级前逐字节一致的观感（cover = 原来的
    // object-fit:cover 行为、trackOn=true 不影响原静音默认、
    // transitionDir 对默认的 fade 过场无方向性）。
    // ── v12 → v13 的那一段 ───────────────────────────────────────────
    // ① 删键：parallax.mascotFollow（v12 加的「吉祥物跟随」，主人实测
    //    认为违和、确认不要）。老配置里的残值由 normalizeWallpaper
    //    整树重建时静默丢弃 —— 无需 switch 分支，本条注释即迁移记录。
    // ② 增块：itemProps / itemTuning（「壁纸属性」面板，按壁纸逐张存），
    //    缺省为空表，同样由 normalizeWallpaper 补默认 + 净化。
    // ── v14 → v15 的那一段 ───────────────────────────────────────────
    // rotation 加 pool（参与轮播的条目 id 列表，空 = 全部；勾选交互见
    // shared/media-pool.ts）。同 v11 → v12 的形态：normalizeWallpaper
    // 就地补新键 + 净化，无数据结构变更。老文件没有这个键 → 补 [] =
    // 全部参与 = **与升级前逐字节同行为**（升级前轮播本来就吃全量）。
    // ── v15 → v16 的那一段 ───────────────────────────────────────────
    // ① sceneFps 白名单扩到 [15, 30, 60, 120, FPS_UNLIMITED(1000)]：老值
    //    15/30/60 仍在名单里 → pickNumEnum 原样保留，逐字节同行为；老配置
    //    不需要任何动作（新增档位是「用户主动去选」才有的事）。
    //    配套的引擎热修（自适应参照钳 60）见 build/webwallgl-hotfix.ts。
    // ② wallpaper.hidden（隐藏条目 id 列表，隐私功能）：缺省 [] = 没有
    //    隐藏任何东西。同 v14 → v15 的形态，normalizeWallpaper 就地补
    //    + normalizeIdPool 净化（空数组 = 与升级前逐字节同行为）。
    wallpaper: normalizeWallpaper(raw.wallpaper),
    // ── v13 → v14 的那一段 ───────────────────────────────────────────
    // 整块全新（老配置里没有它），normalizeSplash 给全默认值并逐字段净化。
    // 默认方向是**开**（主人 2026-10-05 批复：每次打开软件都放；设置里有
    // 总开关）——升级上来的用户立刻能看到开屏动画。方向与 wallpaper 的
    // 「新增默认开」一致，与 nativeRunEnabled 的「新增默认关」相反，
    // 理由：开屏没有弹窗、不改任何既有交互，按任意键就跳过；
    // 而关掉它只需要设置页一次点击。
    splash: normalizeSplash(raw.splash),
    // ── v16 → v17 的那一段 ───────────────────────────────────────────
    // 整块全新（老配置里没有它），normalizePetConfig 给全默认值并逐字段净化。
    // 默认方向是**开**（主人 2026-10-06 拍板：桌宠换 dsh-pet 桌面引擎，默认
    // 出场）——方向同 wallpaper / splash 的「新增默认开」，反于
    // nativeRunEnabled 的「新增默认关」；理由：桌宠不弹窗、不改交互，
    // 主窗最小化它跟着藏，关掉只需要设置页一次点击。
    // 老配置读出来 = enabled: true / size: 462 / corner: 'bottom-right'，
    // 与全新安装逐字节一致；坏值逐键钳位（大小钳区间、角落只认白名单四个角），
    // 净化真源见 types.ts 的 normalizePetConfig。
    // ── v18 → v19 的那一段 ───────────────────────────────────────────
    // pet 再加两个**主动行为开关**：followMouse（允许跟随鼠标撒娇）与
    // hungryRoam（允许饥饿时活跃乱跑）。同 v16 → v17 的形态：
    // normalizePetConfig 就地补默认 + 逐键布尔净化，无独立迁移段，本条
    // 注释即迁移记录。默认全 **true**（主人 2026-10-09 下达：「两个独立
    // 开关……默认开启」）——老配置读出来 = 开着。含义是「引擎新增了这两个
    // 能力，且出口已就位」；实际跟不跟还另有门槛（好感档 / 右键菜单），
    // 那些门槛在宿主侧，不在这个键上。注意净化只认布尔：'false' 字符串
    // 在 if 里是**真**，见 types.ts normalizePetConfig 的注释。
    pet: normalizePetConfig(raw.pet),
    ai: {
      // ⚠️ 原样带过去。**不要 trim、不要校验、不要「顺手规范化」** ——
      // 这个字段不是我们写进去的，用户从 DeepSeek 后台复制什么就是什么。
      // 真需要 trim 的地方在保存入口（config-merge 的 nextApiKey），那里有单测盯着。
      apiKey: typeof ai.apiKey === 'string' ? ai.apiKey : '',
      baseUrl: text(ai.baseUrl, DEFAULT_APP_CONFIG.ai.baseUrl),
      model: text(ai.model, DEFAULT_APP_CONFIG.ai.model),
      // ── v19 → v20 的那一行 ────────────────────────────────────────
      // 老配置里没有这个字段。**必须用 `=== true`，不能写 `!== false`**：
      // 它的默认值是 false（AI 花用户自己的余额，只能由用户主动授权）。
      // 写成 `!== false` 的话，一份从没配过这个字段的老配置会静默打开 AI 出题，
      // 用户会在不知情的情况下开始消耗 Token —— 正是这次要防的事。
      dynamicEnabled: ai.dynamicEnabled === true
    },
    // envCache 是主进程写穿的缓存，形状由 env:detect 保证。不是对象就当空的重算一遍，
    // 代价只是多跑一次环境检测，比带着一个坏形状往下走便宜得多。
    envCache: isObject(raw.envCache) ? (raw.envCache as Partial<EnvCache>) : {}
  }
}

/**
 * v8 → v9 的分派：单个 `nativeIdePath` 拆成每语言四键 `nativeIdePaths`。
 *
 * 【为什么不能闭着眼睛四键全填】旧值只是一枚**没有语言信息**的选择。
 * 主人实测的病就是「一个程序开所有语言，总有一半乱码」——四键全填等于把
 * 病原样搬进新结构。所以按认出来的产品名分派（主人 2026-10-01 拍板）：
 *   1. 新字段已在文件里 → 逐键取值。这是**幂等**的保证：第二遍迁移走这
 *      一类，旧单值即使还在文件里也被无视；用户手改坏了某个键也会自愈
 *      成 ''（text 的脏值语义正好是这里要的）。
 *   2. 认出的产品是**通用编辑器**（VS Code / VSCodium / Cursor）→ 四键
 *      全空（"自动"）。它们什么语言都能开，正因如此旧值不锁任何槽位，
 *      退位给「打开时按语言现检现荐」；装了什么就在推荐表里被选中，
 *      行为不会丢。
 *   3. 认出的产品是**专用工具**（Dev-C++ → c/cpp、PyCharm → python……）
 *      → 只填它画像里的 langs，其余留空走自动推荐。
 *   4. 认不出的 exe（用户自己挑的、不在白名单里）→ 四键全填。那是
 *      **用户的显式选择**，我们没有依据把它扩大成"自动"；写盘编码走
 *      按语言回退（ide-profiles 的 defaultEncodingOf），和升级前逐字节
 *      一致，不比现在差。产品名认得但画像表缺条目（白名单与画像表漂移
 *      时才会发生）也按这一类处理——宁可按"保留"，也不静默丢掉用户的
 *      显式选择。
 *
 * 【空串】旧值是空的 / 纯空白 / 非字符串（`text` 退回 fallback）→ 四键
 * 全空。方向同 nativeRunEnabled：**绝不替用户猜一个默认安装路径**。
 */
function migrateIdePaths(raw: Record<string, unknown>): Record<LangOfCode, string> {
  const next = emptyIdePaths()
  const cur = raw.nativeIdePaths
  if (isObject(cur)) {
    for (const lang of LANG_OF_CODE) next[lang] = text(cur[lang], '')
    return next
  }
  const legacy = text(raw.nativeIdePath, '')
  if (legacy === '') return next
  const product = ideNameOf(legacy)
  const profile = product ? IDE_PRODUCTS[product] : undefined
  if (!product || !profile) {
    for (const lang of LANG_OF_CODE) next[lang] = legacy
    return next
  }
  if (UNIVERSAL_IDE_PRODUCTS.includes(product)) return next
  for (const lang of profile.langs) next[lang] = legacy
  return next
}
