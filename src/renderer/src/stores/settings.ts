/**
 * 设置 store：config.json 的渲染进程镜像。
 * 持久化走主进程（原子写）；环境检测（M5-01）主进程写穿缓存，这里同步内存态。
 * M6-04 再补 AI 测试连接 / 备份导入导出。
 */
import { ref, toRaw } from 'vue'
import { defineStore } from 'pinia'
import type {
  ConfigSavePayload,
  EnvReport,
  LangOfCode,
  PetConfig,
  PublicAppConfig
} from '../../../shared/types'
import { DEFAULT_APP_CONFIG, normalizePetConfig } from '../../../shared/types'
import { defaultModelOf, type AiProviderId } from '../../../shared/ai-providers'
import { aiModeOf, type AiMode } from '../../../shared/free-pool'
import { resolveAiThinking } from '../../../shared/ai-thinking'
import { normalizeLayout, type LayoutConfig } from '../../../shared/layout'
import { normalizeWallpaper, type WallpaperConfig } from '../../../shared/wallpaper'
import { normalizeSplash, type SplashConfig } from '../../../shared/splash'
import { langsToRecheck } from '../../../shared/env-cache'
import { toast } from '../components/base/toast'
import { TOAST } from '../lib/copy'

/**
 * 渲染进程这边的配置**天生就少一些字段**：`ai.apiKeys`。主进程不会把它发过来。
 *
 * 不是「暂时没实现」，是**设计如此** —— 真 Key 只活在主进程里，界面只用
 * `ai.hasKey` 这个布尔来判断「当前厂商配没配」。理由见 shared/types.ts。
 */
function defaultPublicConfig(): PublicAppConfig {
  const c = structuredClone(DEFAULT_APP_CONFIG)
  return toPublic(c)
}

/** 把一份完整配置裁成渲染进程能看的样子。**只用于本地兜底默认值** */
function toPublic(c: (typeof DEFAULT_APP_CONFIG)): PublicAppConfig {
  return {
    version: c.version,
    reviewEnabled: c.reviewEnabled,
    runTimeoutSec: c.runTimeoutSec,
    soundEnabled: c.soundEnabled,
    theme: c.theme,
    nativeRunEnabled: c.nativeRunEnabled,
    nativeRunQuiet: c.nativeRunQuiet,
    favWrongToBook: c.favWrongToBook,
    // 展开成新对象，不是原样引用 —— 理由同 save() 里那句（嵌套对象可能是
    // 响应式代理，进不了 structuredClone）。
    nativeIdePaths: { ...c.nativeIdePaths },
    sfxVolume: c.sfxVolume,
    layout: normalizeLayout(c.layout),
    // 同 layout：归一化顺带把深子块重建成普通对象（响应式代理进不了 IPC）
    wallpaper: normalizeWallpaper(c.wallpaper),
    // 同 wallpaper：splash.pool 是数组，代理同样进不了 structuredClone
    splash: normalizeSplash(c.splash),
    // 同 layout：过 normalizePetConfig 拿一个整树新造的普通对象
    pet: normalizePetConfig(c.pet),
    envCache: c.envCache,
    ai: {
      mode: aiModeOf(c.ai.mode),
      poolModel: c.ai.poolModel,
      provider: c.ai.provider,
      hasKey: (c.ai.apiKeys[c.ai.provider] ?? '').trim() !== '',
      // 免费池不需要 Key；这个布尔是「现在能不能用」的唯一判据
      ready: aiModeOf(c.ai.mode) === 'pool' || (c.ai.apiKeys[c.ai.provider] ?? '').trim() !== '',
      baseUrl: c.ai.baseUrl,
      model: c.ai.model,
      // 缺字段 = 关（老配置/坏载荷都不能静默打开会花钱的开关）
      dynamicEnabled: c.ai.dynamicEnabled === true,
      // v23：兜底默认值也带上思考档位与按模型记忆表。少了这两个字段，
      // 设置页在首次加载失败时会把下拉框绑到一个 undefined 上。
      thinking: c.ai.thinking,
      thinkingByModel: { ...c.ai.thinkingByModel }
    }
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const config = ref<PublicAppConfig>(defaultPublicConfig())
  const loaded = ref(false)
  const detecting = ref(false)

  async function load() {
    config.value = await window.miai.getConfig()
    loaded.value = true
  }

  /**
   * 主进程自发改配置的推送落点（2026-10-06，桌宠右键菜单「关闭大肥鱼」是
   * 目前唯一的生产者；订阅挂在 main.ts，通道说明见 IPC.configExternal）。
   *
   * 【为什么整份换上，而不是像 update 那样当 patch 合并】推送载荷与
   * configGet 同形（主进程用 toPublicConfig 出的整份），它就是"最新真相"——
   * 合并反而会把本地陈旧字段留在里面（pet.enabled 刚被主进程改成 false，
   * 本地旧值一拼回去等于白推）。用户正在编辑的其它输入（填了一半的 Key
   * 输入框等）都住在组件的本地 state 里，不在这份 config 里，换不掉。
   *
   * 【纯镜像，不回写】与 load() 同语义：只把 config.json 的当前内容搬进
   * 响应式镜像。这里**绝不调 save()** —— 推送到达后马上又 save 一遍，
   * 等于把主进程刚改的东西当渲染层编辑回写，两个写方来回拉锯。
   */
  function applyExternalConfig(pub: PublicAppConfig) {
    config.value = pub
  }

  async function update(patch: Partial<PublicAppConfig>) {
    // ⚠️ **展开的是 `toRaw(...)`，不是 `config.value`**。
    //
    // 展开一个响应式代理，顶层字段会变成原始值（看着没问题），但**嵌套的
    // `envCache` / `ai` 读出来仍然是代理**，于是这些代理被**存回了 ref**。
    // 从那一刻起，配置对象里就永久住着两个代理 —— 而 `toRaw` 只剥顶层，
    // 后面再怎么 toRaw 也救不回来，最后在 `ipcRenderer.invoke` 那里炸掉。
    //
    // 这是个「一次写错、之后每条路都坏」的坑：最初只有这一行有问题，
    // 但表现出来的是 save() 里那句 toRaw 仿佛没生效。找的时候要往上游看。
    const prev = config.value
    const next = { ...toRaw(config.value), ...patch }
    config.value = next
    try {
      await save()
    } catch (err) {
      /*
       * 【2026-10-31 自检 P2】写盘失败必须把**内存镜像**也退回去。
       *
       * 旧行为：先改镜像、再 await save()，save 抛错只闪一条 toast。界面上的
       * 开关停在用户刚拨的新值（它读的就是这份镜像），文件里却还是旧值 ——
       * 用户以为改成功了，下次启动才发现「自己变回去了」。这种「看着成功、
       * 其实没存」的假象比报错更糟。
       *
       * 回滚只回滚**自己这一笔**：await 期间用户可能又改了一次（那是另一笔
       * update，它的 save 可能已经成功）。无条件写回 prev 会把它抹掉，
       * 所以先确认镜像还是本次设的 next 才退。
       */
      if (toRaw(config.value) === next) config.value = prev
      throw err
    }
  }

  /**
   * 改布局（拖完分隔条、或收起/展开右栏时调）。
   *
   * 【为什么要单独开一个方法，而不是让调用方自己拼 `update({ layout })`】
   * 保存是**整份配置写盘**，所以 `layout` 这一节每次都必须完整带上。
   * 让调用方在 App.vue 里手拼对象，就会有「只想改宽度、结果没带 rightPanelOpen」
   * 这种写法 —— 漏掉的字段变成 `undefined` 存进文件，随即被 normalizeLayout
   * 当成非法值退回默认。表现出来是**「拖了宽度、不报错、重开又弹回去」**，
   * 而且只在「右栏当时是收着的」这种组合下才出现。收进 store 里，这条路就不存在。
   *
   * 传进来的 patch 过一道 normalizeLayout 再落地，越界值钳回来（和主进程同一条规矩，
   * 这里是第一道，那边写盘前是第二道）。
   */
  async function setLayout(patch: Partial<LayoutConfig>) {
    const cur = toRaw(config.value)
    await update({ layout: normalizeLayout({ ...cur.layout, ...patch }) })
  }

  /**
   * 改**某门语言**的本地 IDE 路径（练习场「打开」时的现检现荐也走这里落盘）。
   *
   * 【为什么不让调用方自己拼 update({ nativeIdePaths })】
   * ① 保存是**整份写盘**，四个键每次都得带上 —— 让调用方手拼，迟早有人只带
   *    改掉的那一键，其余三键被主进程的 pickIdePaths 当成「没改」而保留旧值；
   *    看着没事，其实全靠对面兜底才没事。
   * ② `config.value.nativeIdePaths` 是**嵌套的响应式对象**，直接塞进 patch 会在
   *    `ipcRenderer.invoke` 的结构化克隆那层炸掉 —— `update` 顶层的 toRaw 只剥
   *    一层，救不了嵌套的（见上面 update 的长注释）。在这里从 toRaw 现取现值、
   *    现造一个四键普通对象，两个坑一起绕开。
   */
  async function setIdePath(lang: LangOfCode, path: string): Promise<void> {
    const cur = toRaw(config.value)
    await update({ nativeIdePaths: { ...cur.nativeIdePaths, [lang]: path } })
  }

  /**
   * 改壁纸设置（设置卡片滑杆「松手落盘」、选壁纸、勾选项都走这里）。
   *
   * 【为什么不让调用方自己拼 update({ wallpaper })】三条理由，前两条同 setLayout /
   * setIdePath：① 保存是整份写盘，wallpaper 整块每次都得以合法形态带上；
   * ② `config.value.wallpaper` 是**四层深的响应式对象**（子块里有子块），
   * 直接塞进 patch 会在结构化克隆那层炸掉 —— 比 nativeIdePaths 还深一层，
   * 浅展开救不了子块。这里从 toRaw 现取现值 + normalizeWallpaper 整树新造，
   * 两个坑一起绕开（越界值也在这里被第一道钳住，写盘前 config-merge 是第二道）。
   */
  async function setWallpaper(patch: Partial<WallpaperConfig>): Promise<void> {
    const cur = toRaw(config.value)
    await update({ wallpaper: normalizeWallpaper({ ...cur.wallpaper, ...patch }) })
  }

  /**
   * 隐藏 / 取消隐藏一张壁纸（2026-10-06，主人点名的隐私功能）。
   *
   * 【为什么收进 store 而不是让面板自己拼 hidden 数组】同 setWallpaper 三条：
   * 数组要从 toRaw 现值现造（响应式代理进不了 structuredClone）、整份写盘、
   * 而且 toggle 必须基于**未经展示层过滤**的完整现值算 —— 让面板拿视图里的
   * 集合来拼，会把别处（另一个列表里）刚隐藏的条目悄悄挤掉。
   * 幂等语义：在列表里就删（保序），不在就追加到末尾。
   */
  async function toggleHiddenWallpaper(id: string): Promise<void> {
    if (id === '') return
    const cur = toRaw(config.value)
    const hidden = [...(cur.wallpaper.hidden ?? [])]
    const i = hidden.indexOf(id)
    if (i >= 0) hidden.splice(i, 1)
    else hidden.push(id)
    await setWallpaper({ hidden })
  }

  /**
   * 改开屏设置（设置卡片的开关/音效/音量「松手落盘」走这里；
   * P3 的素材池多选也走这里）。
   *
   * 【为什么不让调用方自己拼 update({ splash })】同 setWallpaper 三条：
   * ① 保存整份写盘，splash 整块每次都得合法带全；② `config.value.splash.pool`
   * 是数组（响应式代理进不了 structuredClone，浅展开挡不住子键）；③ 越界
   * 音量在这里被第一道钳住，主进程 config-merge 是第二道。
   */
  async function setSplash(patch: Partial<SplashConfig>): Promise<void> {
    const cur = toRaw(config.value)
    await update({ splash: normalizeSplash({ ...cur.splash, ...patch }) })
  }

  /**
   * 改桌宠设置（设置卡的开关 / 体型滑杆「松手落盘」/ 落点四选一都走这里）。
   *
   * 【为什么不让调用方自己拼 update({ pet })】同 setSplash 的三条：
   * ① 保存整份写盘，pet 整块每次都得合法带全；② pet 是 `{enabled,size,corner}`
   * 平对象、代理风险比 wallpaper 浅，但「镜像 + 代理」这条规矩不靠
   * 「它恰好是浅的」来成立 —— 浅展开挡不住以后哪天加了子块；③ 越界体型
   * 在这里被第一道钳住（normalizePetConfig），主进程 config-merge 是第二道。
   */
  async function setPet(patch: Partial<PetConfig>): Promise<void> {
    const cur = toRaw(config.value)
    await update({ pet: normalizePetConfig({ ...cur.pet, ...patch }) })
  }

  /**
   * 写盘。**调用方一律走这里，别直接调 `window.miai.saveConfig`** ——
   * `ai.apiKeys` 是三态（不传/`''`=不改、`null`=删该厂商、非空=设新的），
   * 这里默认**不带 apiKeys**（= 不改），只有 `clearAiKey()` 会显式带 `null`。
   *
   * 【对照】`nativeIdePaths` 恰恰相反：**每次必须带全量值**（空串 = 清空该键，
   * 是它的一种合法来路）—— 两者别被「统一」成同一种写法，方向弄反各毁一半。
   *
   * 【为什么默认不带，而不是带上空串】效果上两者都是「不改」，但带上空串的话，
   * 将来哪天 main 那边的语义一改（把空串当成「清空」），**每一次保存别的设置
   * 都会把用户 Key 抹掉**，而且不报错。少带一个字段，这条路从一开始就不存在。
   */
  async function save(ai?: ConfigSavePayload['ai']) {
    // ⚠️ **必须 toRaw**。这不是优化，是 bug 修复 —— 见下面那段。
    //
    // 【踩过的坑】`config.value` 是 Vue 的响应式代理。顶层字段（version、
    // runTimeoutSec 这些数字/布尔）读出来是原始值没问题，但 `envCache` / `ai`
    // 这种**嵌套对象**读出来仍然是**代理**。而 `ipcRenderer.invoke` 用的是
    // 结构化克隆算法，它**克隆不了代理**，直接抛 `An object could not be cloned`。
    //
    // 结果是：点「保存」→ 抛错 → 设置一个字节都没写进去。
    // 而 store 里没有 try/catch，所以这个错会一路冒到调用方的 await 上；
    // 如果调用方也没接（设置页就是 `@change="settings.update(...)"` 这种写法），
    // 表现就是**「勾了复选框、看着勾上了、重开又变回去」** —— 一句报错都看不到。
    //
    // 之前一直没暴露，是因为 store 层没有测试：这段代码从来没被真的跑过。
    // tests/settings.test.ts 里那条 `structuredClone(入参)` 就是照 IPC 的行为
    // 复刻的守门员，它当场就把这个问题抓了出来。
    const cur = toRaw(config.value)
    const payload: ConfigSavePayload = {
      version: cur.version,
      reviewEnabled: cur.reviewEnabled,
      runTimeoutSec: cur.runTimeoutSec,
      soundEnabled: cur.soundEnabled,
      theme: cur.theme,
      nativeRunEnabled: cur.nativeRunEnabled,
      nativeRunQuiet: cur.nativeRunQuiet,
      favWrongToBook: cur.favWrongToBook,
      // ⚠️ 这个字段**每次必带全量值** —— 和上面 apiKeys「默认绝不能带」正好相反。
      // 原因：它是渲染层持有的全量字段（不像 apiKeys，真值只在主进程、界面永远
      // 只能带空串回来），且 `''` 是合法终态（= 清空该键，见 config-merge 的
      // pickIdePaths）。照 apiKeys 的样子少带它，用户就永远清不掉设置里那条路径。
      // v9 起是四键表：**改没改的键都要带上**（空串也照带）—— 缺键会被
      // pickIdePaths 当成「没改」保留旧值，界面上删掉的那一格就会"复活"。
      // 展开成新对象也是必须的：嵌套的响应式对象进不了 structuredClone。
      nativeIdePaths: { ...cur.nativeIdePaths },
      sfxVolume: cur.sfxVolume,
      layout: normalizeLayout(cur.layout),
      // 同 layout：**过 normalizeWallpaper 而不是浅展开** —— 它是四层深
      // （rotation/parallax/audio/power 子块），浅展开挡不住子块里的
      // 响应式代理，进 structuredClone 就是那句「改了壁纸设置、重开又变回去」
      // 的静默事故。normalize 整树新造，一次解决镜像 + 代理两件事。
      wallpaper: normalizeWallpaper(cur.wallpaper),
      // 同 wallpaper：过 normalizeSplash，pool 数组的响应式代理在这一步
      // 被整树新造挡在 structuredClone 之外。
      splash: normalizeSplash(cur.splash),
      // 同 splash：过 normalizePetConfig，逐键整树新造（越界值也在这里
      // 最后一次以钳位形态落盘；写盘前主进程 config-merge 还有第二道）。
      pet: normalizePetConfig(cur.pet),
      envCache: cur.envCache,
      // 逐字段重建，**不是 `{...cur.ai}`** —— 那样会把 `hasKey` 一起带进入参。
      // 带过去倒也不报错（main 侧不读它），但入参里出现一个「语义上属于返回体」
      // 的字段，下一个人读到这里就得停下来想一下这是干嘛的。
      ai: ai ?? {
        mode: cur.ai.mode,
        poolModel: cur.ai.poolModel,
        provider: cur.ai.provider,
        baseUrl: cur.ai.baseUrl,
        model: cur.ai.model,
        dynamicEnabled: cur.ai.dynamicEnabled === true,
        // 同样「逐字段重建」：thinkingByModel 是嵌套对象，展开成新对象
        // 才能挡住响应式代理进 structuredClone。
        thinking: cur.ai.thinking,
        thinkingByModel: { ...cur.ai.thinkingByModel }
      }
    }
    /*
     * 写失败出声（2026-10-17 夜间批）。原来这里没有 try/catch：写盘抛错会
     * 一路冒到调用方，而调用方全是 fire-and-forget（`void settings.update(...)`、
     * 模板内联 @change）—— 界面上的开关**照旧保持已勾选**，一句报错都看不到
     * （上面那段老注释描述的就是这个症状）。出声之后再**原样抛出**：AI 键那条
     * 路（saveAndTest）靠这次抛出落到它自己的 catch 里，避免拿没存住的旧 Key
     * 去测连、把「设置没存住」误报成「Key 不对」。
     */
    try {
      await window.miai.saveConfig(payload)
    } catch (err) {
      toast(TOAST.SETTINGS_SAVE_FAILED, 'error')
      throw err
    }
  }

  /** 改 AI 设置。**这里传的 apiKeys 是「新 Key」或什么都不传，绝不会是空串** */
  async function updateAi(patch: Partial<ConfigSavePayload['ai']>) {
    const cur = toRaw(config.value.ai)
    // 逐字段重建，别展开整只 ai —— 那会把只读的 hasKey 也带进保存载荷。
    const mode = aiModeOf(patch.mode ?? cur.mode)
    const provider = patch.provider ?? cur.provider
    const poolModel = patch.poolModel ?? cur.poolModel
    const model = patch.model ?? cur.model
    const targetModel = mode === 'pool' ? poolModel : model

    /*
     * v23：思考档位要和「这次真正切到的模型」一起算。
     *
     * 用户改模型时如果只把 model 发出去，主进程会按新模型推荐一档；但界面
     * 手上那份镜像已经先改成了新模型，没法再拿它判断「路由到底变没变」。
     * 所以这里以**载荷里有没有路由字段**为准：带了 mode/provider/model/
     * poolModel 就重新解析（显式档位 > 该路由记忆值 > 模型推荐值），
     * 只带其它字段（如动态出题开关）才沿用当前档位。
     *
     * 不沿用旧档位是必须的：给 deepseek-reasoner 调的高档，不能因为切到
     * deepseek-chat 就悄悄带过去，让每一句闲聊都先烧一段思维链。
     */
    const routeChanged =
      patch.mode !== undefined ||
      patch.provider !== undefined ||
      patch.model !== undefined ||
      patch.poolModel !== undefined
    const resolved = resolveAiThinking({
      mode,
      provider,
      model: targetModel,
      rawThinking:
        patch.thinking !== undefined
          ? patch.thinking
          : routeChanged
            ? undefined
            : cur.thinking,
      rawMap: patch.thinkingByModel !== undefined ? patch.thinkingByModel : cur.thinkingByModel
    })

    await save({
      mode,
      poolModel,
      provider,
      baseUrl: patch.baseUrl ?? cur.baseUrl,
      model,
      dynamicEnabled: patch.dynamicEnabled ?? (cur.dynamicEnabled === true),
      apiKeys: patch.apiKeys,
      thinking: resolved.thinking,
      thinkingByModel: resolved.thinkingByModel
    })

    // 保存成功才改镜像：写盘失败时界面必须继续显示磁盘上的那一档，
    // 不能出现「看起来调了、其实没存住」的假状态。
    config.value.ai.thinking = resolved.thinking
    config.value.ai.thinkingByModel = resolved.thinkingByModel
  }

  /**
   * 切换接入方式（v22）。**要先落盘再读回**：`hasKey` / `ready` / 余额能力
   * 都是主进程按当前 mode 算的，只改镜像会让状态标签和「能不能用」对不上。
   */
  async function setAiMode(mode: AiMode): Promise<void> {
    if (mode === aiModeOf(toRaw(config.value.ai.mode))) return
    await updateAi({ mode })
    await load()
  }

  /**
   * 切换服务商（2026-11-01 多厂商）。
   *
   * 【为什么必须 save 完再 load 一次】渲染层只知道**当前厂商**有没有 Key
   * （`hasKey`，其余厂商的真值不出主进程）。切过去之后「新厂商有没有存过
   * Key」只有主进程知道；不读回来，模型下拉框会一直停在「没 Key」的置灰态，
   * 用户明明存过那把 Key。load() 会把 provider / hasKey / model 一起换新。
   *
   * 【为什么带上刚粘的 Key】用户可能先粘 Key 再去点厂商 —— 保存动作还没发生，
   * 这时切厂商如果只存 provider，输入框会被清空，刚粘的 Key 就丢了。
   * 传了 `newKey` 就一起落盘；没传就只切厂商（各家 Key 互不覆盖）。
   *
   * 【custom 的模型为什么是空串】它没有「常用模型」列表，默认模型只能由用户
   * 自己填；主进程的 mergeAi 在「切厂商 + 没给模型」时也用这个空串，
   * 界面于是显示一个待填的输入框，而不是一个必然 404 的旧模型名。
   */
  async function setAiProvider(provider: AiProviderId, newKey?: string): Promise<void> {
    const cur = toRaw(config.value.ai)
    const key = (newKey ?? '').trim()
    if (provider === cur.provider && key === '') return
    const patch: Partial<ConfigSavePayload['ai']> = {}
    if (provider !== cur.provider) {
      patch.provider = provider
      patch.model = defaultModelOf(provider)
    }
    if (key !== '') patch.apiKeys = { [provider]: key }
    await updateAi(patch)
    // 换厂商后 hasKey / baseUrl / model 的真值都在主进程那边，整份读回来
    await load()
  }

  /**
   * 清除 Key。**只有这一条路能真的删掉它** —— 传 `null` 而不是空串，
   * 因为空串的语义是「这次不改」（界面根本不知道真 Key，它保存时必然带回空串）。
   * 少了这条路，用户填错一次就再也删不掉了。
   */
  async function clearAiKey() {
    await save({
      mode: config.value.ai.mode,
      poolModel: config.value.ai.poolModel,
      provider: config.value.ai.provider,
      baseUrl: config.value.ai.baseUrl,
      model: config.value.ai.model,
      dynamicEnabled: config.value.ai.dynamicEnabled === true,
      thinking: config.value.ai.thinking,
      thinkingByModel: { ...config.value.ai.thinkingByModel },
      apiKeys: { [config.value.ai.provider]: null }
    })
    config.value.ai.hasKey = false
    if (config.value.ai.mode !== 'pool') config.value.ai.ready = false
  }

  /**
   * 保存新 Key 之后调它，让界面立刻从「未配置」变成「已配置」。
   *
   * 【ready 也必须一起抬起来】v22 之后挑战 / 延展 / 桌宠读的是 ready，
   * 不再读 hasKey。只改 hasKey 的话，用户粘完 Key 直接去出题，
   * 界面看着「已配置」，动态出题却仍被判成不可用 —— 而且不报任何错。
   */
  function markKeySaved() {
    config.value.ai.hasKey = true
    if (config.value.ai.mode !== 'pool') config.value.ai.ready = true
  }

  /** 重新检测本机编程环境（M5-01） */
  async function detectEnv(): Promise<EnvReport> {
    detecting.value = true
    try {
      const report = await window.miai.detectEnv()
      config.value.envCache = { report, at: new Date().toISOString() }
      return report
    } finally {
      detecting.value = false
    }
  }

  /**
   * 首次打开设置页：读配置；缓存里报「没找到」的语言一并复核。
   *
   * 为什么不是「无缓存才检测」：报错文案让用户「去设置页装好环境」，
   * 可设置页要是读同一份过期缓存，就会跟着说同一句谎话（明明装好了还说没装）。
   * 这里只多查「没找到」的那几门，「找到了」的照用，代价可忽略。详见 shared/env-cache.ts。
   */
  async function ensureEnvCache(): Promise<void> {
    if (!loaded.value) await load()
    if (langsToRecheck(config.value.envCache.report).length > 0) await detectEnv()
  }

  return {
    config,
    loaded,
    detecting,
    load,
    applyExternalConfig,
    update,
    setLayout,
    setIdePath,
    setWallpaper,
    toggleHiddenWallpaper,
    setSplash,
    setPet,
    updateAi,
    setAiMode,
    setAiProvider,
    clearAiKey,
    markKeySaved,
    detectEnv,
    ensureEnvCache
  }
})
