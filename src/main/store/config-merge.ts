/**
 * config.json 的**合并**与**裁剪**（M6-04，纯函数，不碰文件也不碰 Electron）。
 *
 * 【为什么从 IPC handler 里抽出来】
 * 这段逻辑有两处「一旦错了就是静默损伤」的地方：
 *   1. **apiKey 是三态**，某天一次「顺手简化」就会把用户的 Key 悄悄抹掉；
 *   2. **Key 不能出主进程**，抹字段的时候容易顺手把界面需要的信息也抹了。
 * 放在 IPC handler 里的代码**根本没法单测**（要拖起整个 Electron），
 * 而这两件事恰恰是最需要被测试钉死的那一类。所以抽成纯函数，handler 只负责调用。
 *
 * ⚠️ 这个文件在 `src/` 下，被文案闸门扫 —— **不许出现中文**。
 */
import { normalizeLayout } from '../../shared/layout'
import { normalizeWallpaper } from '../../shared/wallpaper'
import { normalizeSplash } from '../../shared/splash'
import {
  DEFAULT_APP_CONFIG,
  LANG_OF_CODE,
  THEME_NAMES,
  emptyIdePaths,
  normalizePetConfig,
  type AppConfig,
  type ConfigSavePayload,
  type LangOfCode,
  type MiThemeName,
  type PublicAppConfig
} from '../../shared/types'
import {
  clampVolume,
  MAX_SFX_VOLUME,
  MAX_TIMEOUT_SEC,
  MIN_SFX_VOLUME,
  MIN_TIMEOUT_SEC
} from '../../shared/config-migrate'

/**
 * 运行超时的合法区间（秒）。
 *
 * 和 [runner.ts:314] 里那道 clamp 是**同一个区间**，这里是第一道、那里是第二道。
 * 两道的分工：这里拦住的是「配置被写坏」（写进文件就晚了，改不回来），
 * 那里拦住的是「单次请求自己带了越界的 timeoutSec」。
 *
 * 【为什么非拦不可】runner 那里写的是 `Math.min(Math.max(x, 1), 60)`，
 * 而 `NaN` **能穿过这个式子**（NaN 和谁比都是 false，`Math.max(NaN,1)` 还是 NaN）。
 * 于是 `NaN * 1000` → `setTimeout(fn, NaN)` → **当成 0 毫秒**，
 * 表现为「每一次运行都在瞬间被掐死」，而报错信息只会说超时，指向完全错误的方向。
 *
 * 【为什么从 config-migrate 转出，而不是就地定义】迁移那边钳老数据时要用
 * **同一个区间**。两份定义就是两处漂移，而漂移的症状是「保存时能到 60 秒、
 * 从老文件迁移出来却是 30 秒」这种没人会去查的东西。所以定义搬去 shared，
 * 这里只做转出，既有引用点（含 config-merge.test.ts）一行不用改。
 */
export { MIN_TIMEOUT_SEC, MAX_TIMEOUT_SEC }

/**
 * 音效音量的合法区间（百分比）。
 *
 * 和超时那对是**同一个理由**：定义在 shared/config-migrate（schema 那一侧），
 * 读（迁移老数据）和写（保存新输入）共用一份边界。这里只做转出。
 */
export { MIN_SFX_VOLUME, MAX_SFX_VOLUME }

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 把配置里的**每语言 IDE 路径表**读成「恒四键、值必字符串」的形状。
 *
 * 【为什么不 trim】这里的读口原样透传才是**如实**的（用户手改文件写了
 * 个带空格的路径，读出来就该是它）；trim 是写口（`pickIdePaths`）的职责，
 * 分工和旧版单值时代完全一样。类型检查逐键做、退化值落成 ''——
 * '' 就是「该语言没配置」的合法表示。
 */
function readIdePaths(v: unknown): Record<LangOfCode, string> {
  const src = isObject(v) ? v : {}
  const out = emptyIdePaths()
  for (const lang of LANG_OF_CODE) {
    out[lang] = typeof src[lang] === 'string' ? (src[lang] as string) : ''
  }
  return out
}

/**
 * 把内部配置裁成**能交给渲染进程**的形状 —— **唯一的出口，别处不许直接返回 config**。
 *
 * 【为什么要有这么一个函数，而不是在 handler 里手写一遍】
 * 「Key 不出主进程」这条规矩，靠自觉是守不住的：将来新加一条通道、
 * 或者在别处再 `return configStore.read()`，就直接漏了。
 * 收成一个函数之后，**漏的办法只剩「故意绕过它」**，而绕过是能被 code review 看出来的。
 *
 * `hasKey` 是抹掉 apiKey 之后**必须补上**的那一点点信息，理由见 types.ts 里那段长注释。
 */
export function toPublicConfig(cfg: AppConfig): PublicAppConfig {
  return {
    version: cfg.version,
    reviewEnabled: cfg.reviewEnabled,
    runTimeoutSec: cfg.runTimeoutSec,
    // 写成 `!== false` 而不是原样透传，是**第二道保险**：
    // soundEnabled 的补齐已经在 migrateConfig 里做过了（readConfig 是唯一读口），
    // 正常路径上它一定是个布尔。但这里是「交给渲染进程」的最后一道闸门，
    // 一旦某个未来的读路径漏了迁移，渲染进程拿到的会是 undefined ——
    // 而 undefined 在设置页那个开关上渲染成「关着」，用户会以为音效自己没了。
    // 一句比较换掉这一类静默走样，划算。
    soundEnabled: cfg.soundEnabled !== false,
    // 和上面 soundEnabled 同一套第二道保险：正常路径上它一定已经过 migrateConfig 的白名单，
    // 但万一某个未来的读路径漏了迁移，渲染进程拿到的会是一个**不在白名单里的字符串**，
    // 于是 `<html data-theme="...">` 匹配不上任何一条选择器 —— 界面静默退回浅色。
    // 这里再筛一遍，代价是一句比较。
    theme: THEME_NAMES.includes(cfg.theme) ? cfg.theme : 'light',
    // ⚠️ **必须是 `=== true`，不能写成 `!== false`** —— 这是本次改动里
    // 风险最高的一行，写反的后果与上面两处**方向相反**：
    // soundEnabled 写 `!== false` 是「漏迁移时别静音」，因为它的默认值是 true；
    // 而这个字段的默认值是 false，`!== false` 会让**从没要求过的人**
    // 静默走上用户自己的外壳（每跑一次弹一次窗、换一个编译器）——
    // 用户没开过这个开关，却发现自己机器上的 gcc 被调起来了。
    // 一句比较的差别，两种默认值的字段必须各写各的。有专门单测钉着极性。
    nativeRunEnabled: cfg.nativeRunEnabled === true,
    // 同 nativeRunEnabled 的极性（默认 false），所以也是 `=== true`：
    // 漏迁移的 undefined 必须读成「继续每次询问」——写成 `!== false` 的话，
    // 弹窗会静默消失、代码被交给用户自己的编译器，方向和「不敢替用户
    // 打开原生模式」这套规矩完全一致。
    nativeRunQuiet: cfg.nativeRunQuiet === true,
    // 第二道保险，同上面 soundEnabled 一族：正常路径上它已被 migrateConfig
    // 整形成四键字符串表，但万一某个未来的读路径漏了迁移，渲染进程拿到的
    // 会是 undefined —— 设置页那四个输入框绑上去看着像「没配置」（其实是
    // 类型错的），而渲染层的分支里一句 `.trim()` 就能把整个设置页炸掉。
    // readIdePaths 恒输出四键、值必是字符串，降级成 '' 是**如实**的
    // （'' 就是「该语言没配置」的合法表示）。
    nativeIdePaths: readIdePaths(cfg.nativeIdePaths),
    // 和上面 soundEnabled 同型（默认值是 true 的布尔），所以极性也照它写 `!== false`：
    // 漏迁移时给 true（「答错就记」是全应用的既有性子），而不是把开关静默关掉 ——
    // 关掉的样子是「在收藏里错了一串题，错题本里一条都没有」，用户根本不会往设置上想。
    favWrongToBook: cfg.favWrongToBook !== false,
    // 第二道钳位，理由和上面 soundEnabled / theme 完全同源：正常路径上它已经被
    // migrateConfig 钳过一次了，但万一某个未来的读路径漏了迁移，渲染进程拿到的
    // 会是 undefined 或者一个越界值。**两种走样都是静默的**：
    //   · undefined 进 `<input type="range">` = 值非法，浏览器回落到**轨道中点**，
    //     于是"我的音量自己变成一半了"，而且关掉再重开还是这样；
    //   · 500 进增益就是 5 倍，一耳朵爆音（第二耳朵是投诉）。
    // 一句 clamp 换掉这一类，和上面那几行是同一笔账。
    sfxVolume: clampVolume(cfg.sfxVolume, DEFAULT_APP_CONFIG.sfxVolume),
    // 过一道 normalizeLayout，**不是原样透传**：老配置文件里没有这一节
    // （它是加 layout 字段之前写下的），直接给渲染进程一个 undefined，
    // App.vue 那边会在算 pane 尺寸时炸掉。补齐逻辑统一放在 shared/layout.ts。
    layout: normalizeLayout(cfg.layout),
    // 同理过一道 normalizeWallpaper（补齐逻辑在 shared/wallpaper.ts）：
    // 它是「交给渲染进程」的最后一道，也是把嵌套子块的响应式代理挡在
    // structuredClone 之外的那一道（normalize 整树新造普通对象）。
    wallpaper: normalizeWallpaper(cfg.wallpaper),
    // 同款：开屏那块也整树新造（补齐逻辑在 shared/splash.ts 的 normalizeSplash）。
    // 同一个理由 —— 这里是把配置交给渲染进程的最后一道，响应式代理必须挡在
    // structuredClone 之外（pool 是数组，代理进不了克隆）。
    splash: normalizeSplash(cfg.splash),
    // Same as splash: normalizePetConfig always returns a fresh plain object, so
    // the renderer's reactive Proxy stays out of structuredClone, and a config
    // file that predates the pet block still reaches the settings card as a
    // complete shape instead of undefined (which would render the switch as off).
    pet: normalizePetConfig(cfg.pet),
    envCache: cfg.envCache,
    ai: {
      hasKey: cfg.ai.apiKey.trim() !== '',
      baseUrl: cfg.ai.baseUrl,
      model: cfg.ai.model,
      // Same polarity rule as nativeRunEnabled: default false, so `=== true`.
      // An old config with no field must read as "off", never silently opt in
      // to spending the user's own API balance.
      dynamicEnabled: cfg.ai.dynamicEnabled === true
    }
  }
}

/**
 * 把 `config:save` 的入参合并进现有配置，返回**要写盘的新配置**。
 *
 * 入参非法时抛错（并且**一个字节都不写**）—— 和 runner:run 一样，
 * 这种情况属于「调用方写错了」，该炸得响亮，而不是猜一个默认值糊过去。
 *
 * 【哪些字段听入参的、哪些听现有的】
 * - `reviewEnabled` / `runTimeoutSec` / `soundEnabled` / `theme` / `sfxVolume`：听入参，
 *   这是用户真在设置页改的东西（`sfxVolume` 只在带了合法数字时才算「改了」）。
 * - `ai.apiKey`：**三态**，见 `nextApiKey`。
 * - `nativeIdePaths`：**逐键三态**，见 `pickIdePaths` —— 注意它的 `''` 是
 *   「清空该键」（该语言回到「自动」），和下面 baseUrl/model 的「空=没改」
 *   **方向相反**（理由都写在函数注释里）。
 * - `ai.baseUrl` / `ai.model`：听入参，但**空值算「没改」**（理由见 `pickText`）。
 * - `layout`：听入参，但**整节缺失算「没改」**，并且钳进合法区间（理由见下）。
 * - `wallpaper`：同 `layout` 一套（整块听入参、缺失算没改、过 normalizeWallpaper
 *   钳位并整树新造）。
 * - `splash`：同 `wallpaper` 一套（整块听入参、缺失算没改、过 normalizeSplash
 *   钳位并整树新造）。
 * - `envCache` / `version`：**一律听现有的**，理由见下。
 *
 * 【envCache 为什么不听入参】
 * 它不是用户在设置页编辑的东西，而是 env:detect **在主进程写穿**的。
 * 渲染进程手上那份是「读配置那一刻」的快照；如果用户开着设置页放了十分钟，
 * 这期间后台检测刷新过缓存，他再点一次保存就会**把新缓存顶回旧的** ——
 * 表现是「刚检测出来的编译器，过一会儿又变成没装」。这类回退极难复现。
 *
 * 【version 为什么不听入参】
 * 它是 schema 版本，归主进程管。让渲染进程能改它，等于把迁移逻辑的钥匙交出去。
 */
export function mergeConfigPayload(current: AppConfig, payload: ConfigSavePayload): AppConfig {
  if (!isObject(payload) || !isObject(payload.ai)) throw new Error('invalid config payload')
  if (typeof payload.reviewEnabled !== 'boolean') throw new Error('invalid config payload')

  const rt = payload.runTimeoutSec
  if (typeof rt !== 'number' || !Number.isFinite(rt)) throw new Error('invalid config payload')

  return {
    version: current.version,
    reviewEnabled: payload.reviewEnabled,
    runTimeoutSec: Math.min(Math.max(Math.round(rt), MIN_TIMEOUT_SEC), MAX_TIMEOUT_SEC),
    // 缺省时**听现有的**，不是听默认值。理由和下面 `layout` 的 `?? current.layout` 一样：
    // 「没带这个字段」和「明确要关掉音效」是两件事，混成一件的后果是
    // **保存一次别的设置，音效就被悄悄打开了**（或者被关掉）。
    // 类型上它是必填的，但这里是写盘前的最后一道 —— 类型拦不住运行时的残缺载荷。
    soundEnabled: typeof payload.soundEnabled === 'boolean' ? payload.soundEnabled : current.soundEnabled !== false,
    // 和 soundEnabled 一样「缺省时听现有的」。但**多一道白名单**：
    // 音效那个字段是布尔，运行时只可能是 true/false/undefined 三种；
    // 这个字段是字符串，调用方可以传任何东西进来。不筛的话，
    // 一个 `theme: 'Dark'` 会被原样写进 config.json，然后**每次启动都静默退回浅色**，
    // 而文件里明明写着 Dark —— 这种「写进去了但不生效」最难查。
    // 不在白名单里不抛错（不像 ai.baseUrl 那样）：主题是个纯观感字段，
    // 为它让整次保存失败（用户改的音效也跟着不存）不划算，退回现有值即可。
    theme: THEME_NAMES.includes(payload.theme as MiThemeName)
      ? (payload.theme as MiThemeName)
      : current.theme,
    // 「缺省时听现有的」，和 soundEnabled 一样 —— 「没带这个字段」与
    // 「明确要关掉原生模式」是两件事，混成一件的后果是：用户保存一次别的设置，
    // 原生模式被悄悄打开（或关掉）。
    // 取现有值时同样用 `=== true`：老配置（这个字段还不存在）必须是**关**。
    nativeRunEnabled:
      typeof payload.nativeRunEnabled === 'boolean'
        ? payload.nativeRunEnabled
        : current.nativeRunEnabled === true,
    // 和 nativeRunEnabled 同一套：「缺省时听现有的」，取现有值时同样 `=== true`
    // 定死极性 —— 老配置（这个字段还不存在）必须是 false（继续每次都问）。
    nativeRunQuiet:
      typeof payload.nativeRunQuiet === 'boolean'
        ? payload.nativeRunQuiet
        : current.nativeRunQuiet === true,
    // 和 soundEnabled 一套：「缺省时听现有的」，且取现有值时同样要**定死极性** ——
    // 老配置（这个字段还不存在）必须是 true（答错就记），`!== false` 正好给到它。
    // 写成 `=== true` 就反了：没带这个字段的一次无关保存，会把用户开着的行为静默关掉。
    favWrongToBook:
      typeof payload.favWrongToBook === 'boolean'
        ? payload.favWrongToBook
        : current.favWrongToBook !== false,
    // 每语言路径表走 pickIdePaths —— ⚠️ 逐键继承 pickPath 的三态语义：
    // **`''` 算「清空该键」**（该语言回到「自动」），不是「没改」（方向和
    // pickText 正好相反）。整表缺字段的防御也在它里边。
    nativeIdePaths: pickIdePaths(payload.nativeIdePaths, current.nativeIdePaths),
    // 「缺省时听现有的」—— 机制就在第二个参数上：`clampVolume` 遇到非数字
    // （含 undefined）会**原样退回 fallback**，而这里 fallback 给的是 current。
    // 所以「没带这个字段」和「带了个越界值」走的是同一条路，两个都是"以现有为准"，
    // 正好是我们想要的：用户没改音量，就不该被任何一次别的保存改掉。
    // ⚠️ 别"顺手简化"成 `payload.sfxVolume ?? current.sfxVolume` —— 那会漏掉
    // 区间钳位，而越界值一旦写进文件，下次启动就是 5 倍增益的爆音。
    sfxVolume: clampVolume(payload.sfxVolume, current.sfxVolume),
    // `?? current.layout` —— 入参**整节没带**时听现有的，和上面「空值算没改」是同一套规矩。
    // 归一化那一步同时干两件事：补上老配置里缺的字段，以及把越界值钳回来。
    // 越界必须钳：这是**写盘前**最后一道，写进去就再也改不回来了。
    layout: normalizeLayout(payload.layout ?? current.layout),
    // 同 layout 一套：整块缺失听现有的，过 normalizeWallpaper 钳位 + 整树新造。
    // 渲染层恒带全量块（设置卡片「松手落盘」时整块提交），所以不用做子键三态。
    wallpaper: normalizeWallpaper(payload.wallpaper ?? current.wallpaper),
    // 同 wallpaper 一套：整块缺失听现有的，过 normalizeSplash 钳位 + 整树新造。
    // 开屏块里没有三态字段（fixedFile 的空串就是「没指定」，不是「清除」语义的
    // 问题域——pick=fixed 时空串本来就回退随机），所以整块提交即可。
    splash: normalizeSplash(payload.splash ?? current.splash),
    // Desktop pet (dsh-pet engine, 2026-10-06). Same shape as splash: whole block
    // submitted, normalized before it hits disk. normalizePetConfig clamps a bad
    // size back into range and drops unknown corner names to the default instead of
    // throwing - a broken pet block must not fail an unrelated save. Older configs
    // have no pet key at all: `?? current.pet` is undefined, and normalize(undefined)
    // returns the defaults (enabled, 462px, bottom-right).
    pet: normalizePetConfig(payload.pet ?? current.pet),
    ai: {
      apiKey: nextApiKey(current.ai.apiKey, payload.ai.apiKey),
      baseUrl: pickText(payload.ai.baseUrl, current.ai.baseUrl),
      model: pickText(payload.ai.model, current.ai.model),
      // Missing field means "keep what is on disk" (same rule as soundEnabled),
      // and the fallback uses `=== true` so an old config stays off.
      dynamicEnabled:
        typeof payload.ai.dynamicEnabled === 'boolean'
          ? payload.ai.dynamicEnabled
          : current.ai.dynamicEnabled === true
    },
    envCache: current.envCache
  }
}

/**
 * 主进程自发的配置变更：把桌宠总开关落成 `enabled`（2026-10-06，右键菜单
 * 「关闭大肥鱼」→ 宿主 → app.ts 唯一调用方）。
 *
 * 【为什么不拿 mergeConfigPayload 硬凑一个载荷】
 * config:save 的载荷契约是「渲染层提交的**全量**形态」——reviewEnabled /
 * runTimeoutSec / ai 缺一个就 throw，那是防渲染层传错参数的闸。主进程这条
 * 变更只有一处事实（开关），硬造一份假全量载荷等于把两套契约揉成一团。
 * 这里只做一件事：听现有配置，换掉 pet.enabled。
 *
 * 【为什么也要过 normalizePetConfig】和 mergeConfigPayload 的 pet 行同款：
 * 写盘前的最后一道必须整树新造普通对象（补齐老配置缺的字段、把共享引用
 * 挡在写盘外）。其余字段浅拷自现有配置 —— 它们本来就来自 readConfig 的
 * 产物，不需要在这里再裁一遍。
 */
export function withPetEnabled(current: AppConfig, enabled: boolean): AppConfig {
  return { ...current, pet: normalizePetConfig({ ...current.pet, enabled }) }
}

/**
 * apiKey 的三态合并 —— **这个函数的每一条分支都有一条单测钉着**。
 *
 * | incoming | 结果 | 谁会造成这种情况 |
 * |---|---|---|
 * | `null` | 清空 | 用户点了设置页的「清除 Key」 |
 * | `undefined` | 保持原样 | 某条通道只想改别的字段，压根没带 ai |
 * | 非空字符串 | 换成它（**去掉首尾空白**） | 用户粘贴了一个 Key 并保存 |
 * | `''` / 全空白 | 保持原样 | 界面上那个框天生就是空的（它拿不到真 Key） |
 *
 * 【最后一行是整件事的关键】渲染进程**永远不知道真 Key 是什么**，
 * 所以它保存时带回来的必然是个空串。要是把空串当成「用户想清空」，
 * 那么**每保存一次别的设置，Key 就没了** —— 用户会以为 Key 会自己过期。
 * 想清空必须走 `null`，那是个界面能表达、而真实 Key 不可能是的值。
 *
 * 【为什么要 trim】从网页上复制 Key 时，**极易**连带选中一个换行或空格。
 * 带 `\n` 的 Key 会让 fetch 在设置请求头时直接抛错（header 值不许含换行），
 * 而那个异常会被归类成「连不上网」—— 用户会去查路由器，方向全错。
 * 在这一层 trim 掉，代价是零，省掉的是一整类查不出来的问题。
 */
function nextApiKey(current: string, incoming: string | null | undefined): string {
  if (incoming === null) return ''
  if (incoming === undefined) return current
  const trimmed = incoming.trim()
  return trimmed === '' ? current : trimmed
}

/**
 * 读一个文本字段：**空值算「没改」，不算「清空」**。
 *
 * 为什么和 apiKey 不一样、不做「空 = 删」：
 * baseUrl 和 model 一清空，下一次请求就会发到一个不存在的地址。
 * 而用户在输入框里误按全选+删除、或者粘贴了个空内容，是很容易发生的事 ——
 * 那时候**保留原值**（继续能用）比**真的清空**（功能坏掉，且用户不知道是自己弄的）要好。
 * 想恢复默认值，再把默认值打回去就行了，这条路一直开着。
 *
 * 非字符串**抛错而不是回退**：那是调用方类型写错了，悄悄糊过去只会把 bug 藏起来。
 */
function pickText(incoming: unknown, fallback: string): string {
  if (incoming === undefined || incoming === null) return fallback
  if (typeof incoming !== 'string') throw new Error('invalid config payload')
  const trimmed = incoming.trim()
  return trimmed === '' ? fallback : trimmed
}

/**
 * 读**每语言 IDE 路径表**：逐键沿用单值时代的三态语义，恒输出四键全新对象。
 *
 * 【三态（逐键各来一遍）】
 *  | incoming | 结果 |
 *  |---|---|
 *  | `''` / 全空白 | **清空该键**（该语言回到「自动」，打开时现检现荐） |
 *  | `undefined` / `null` | 保持该键现状 |
 *  | 非空字符串 | 换成它（去掉首尾空白） |
 *  | 其他类型 | **抛错** |
 *
 * 【为什么 `''` 必须算「清空」—— 和上面 pickText 恰好的反方向】
 * pickText 的「空=没改」是替 baseUrl / model 定的：它们一清空下一次请求就
 * 发到不存在的地址，用户误按全选+删除时保留原值更安全。而本地 IDE 路径
 * 不是这种字段：
 *   · 它有一个**合法的"空"**（默认值就是 ''，空 = 未配置 = 按钮给引导）；
 *   · 渲染层**恒持有全量值**（不像 apiKey 真值只在主进程 —— 那边渲染层
 *     永远只能带空串回来，所以必须把空当"没改"）—— 界面上那个框显示什么，
 *     保存回来的就是什么，空串只有一种来路：用户把它删了 / 点了「清除」。
 * 想清空必须能清空：套用「空=没改」，用户删了路径一保存它又回来了，
 * 而且没有别的路能删掉它 —— 和 apiKey 当初必须补一个 `null` 是同一个教训。
 *
 * 【undefined / null 保持现状】那是「这次载荷没带这个键」的防御：
 * 类型上四个键都必填，但测试夹具经 `as` 转换、或未来的新调用方都可能缺它 ——
 * 缺字段时猜"用户想清空"会把一个设置静默毁掉，听现有的才是安全侧。
 * 整表 undefined / null 同理（四键全部保持现状）。非对象（字符串/数字/数组）
 * **抛错**：调用方类型写错了，糊过去只会把 bug 藏起来。
 *
 * 【为什么输出必须是全新对象】渲染层那份 `nativeIdePaths` 是 Vue 的响应式
 * 代理，`structuredClone` 一碰就炸（settings store 有专门的回归闸）；即便
 * 拿到的是普通对象，返回入参引用也会让「写盘的那份」和「来源那份」悄悄
 * 共用同一个对象。现造一个四键普通对象，两个病一起省掉。
 */
function pickIdePaths(
  incoming: unknown,
  fallback: Record<LangOfCode, string>
): Record<LangOfCode, string> {
  if (incoming === undefined || incoming === null) return { ...fallback }
  if (!isObject(incoming)) throw new Error('invalid config payload')
  const out = emptyIdePaths()
  for (const lang of LANG_OF_CODE) {
    const v = incoming[lang]
    if (v === undefined || v === null) out[lang] = fallback[lang]
    else if (typeof v === 'string') out[lang] = v.trim()
    else throw new Error('invalid config payload')
  }
  return out
}
