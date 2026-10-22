<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useSettingsStore } from '../stores/settings'
import { useWallUiStore } from '../stores/wall-ui'
import { useWallHiddenStore } from '../stores/wall-hidden'
import {
  WALL_GLASS_BLUR_MAX,
  WALL_GLASS_BLUR_MIN,
  WALL_GLASS_FLOW_MAX,
  WALL_GLASS_FLOW_MIN,
  WALL_GLASS_RING_MAX,
  WALL_GLASS_RING_MIN,
  WALL_GLASS_SHADOW_MAX,
  WALL_GLASS_SHADOW_MIN,
  WALL_GLASS_STRENGTH_MAX,
  WALL_GLASS_STRENGTH_MIN,
  WALL_MATERIAL_FADE_KNEE,
  WALL_PANEL_ALPHA_MAX,
  WALL_PANEL_ALPHA_MIN,
  WALL_VEIL_MAX,
  WALL_VEIL_MIN,
  wallUiOf
} from '../../../shared/wall-ui'
import { panelBgOf } from '../../../shared/theme'
import {
  BLUR_MAX,
  BLUR_MIN,
  DIM_MAX,
  DIM_MIN,
  FPS_UNLIMITED,
  isRenderableItem,
  MEDIA_ADJUST_MAX,
  MEDIA_ADJUST_MIN,
  OPACITY_MAX,
  PARALLAX_AMOUNT_MAX,
  PARALLAX_AMOUNT_MIN,
  PARALLAX_SMOOTH_MAX,
  PARALLAX_SMOOTH_MIN,
  ROTATION_INTERVAL_MAX,
  ROTATION_INTERVAL_MIN,
  VOLUME_MAX,
  VOLUME_MIN,
  WALLPAPER_OBJECT_FITS,
  WALLPAPER_QUALITIES,
  WALLPAPER_RATE_STEPS,
  WALLPAPER_ROTATION_ORDERS,
  WALLPAPER_SCENE_FPS,
  WALLPAPER_TRANSITION_DIRS,
  WALLPAPER_TRANSITIONS,
  WALLPAPER_TRANSITION_SPEEDS,
  type WallpaperConfig,
  type WallpaperItem,
  type WallpaperSceneFps,
  type WallpaperTransitionSpeed
} from '../../../shared/wallpaper'
import { LANG_LABEL } from '../lib/labels'
import { ACTION, AI_FAIL, ENV, LOADING, SETTINGS, TITLE, TOAST } from '../lib/copy'
import { GALLERY_IDS } from '../../../shared/gallery'
import { refreshRewardOverrides } from '../lib/reward-overrides'
import { checkedNames, invertPool, togglePoolItem, allPool } from '../../../shared/media-pool'
import { SPLASH_PICKS, type SplashMaterialRef } from '../../../shared/splash'
import { toast } from '../components/base/toast'
import { playSfx, setSfxEnabled, setSfxVolume } from '../lib/sfx'
import { detectIdeOnce, planIdeChoice, type IdePickHint } from '../lib/ide-detect'
import { ensureCatalog, findCatalogItem, refreshCatalog, wallpaperCatalog } from '../lib/wallpaper/catalog'
import { wallpaperPlayState, toggleManualPause } from '../lib/wallpaper/play-state'
import { splashPreviewSpec, wallpaperPreviewSpec } from '../lib/wallpaper/preview'
import { SWITCH_DIRECTIONAL, transitionSpec } from '../lib/wallpaper/transitions'
import MiButton from '../components/base/MiButton.vue'
import MiCheckbox from '../components/base/MiCheckbox.vue'
import MiModal from '../components/base/MiModal.vue'
import MiMascot from '../components/base/MiMascot.vue'
import MiRadio from '../components/base/MiRadio.vue'
import MiSelect from '../components/base/MiSelect.vue'
import MiSwitch from '../components/base/MiSwitch.vue'
import MiTabs from '../components/base/MiTabs.vue'
import IdePickerModal from '../components/domain/IdePickerModal.vue'
import MediaPreviewModal from '../components/domain/MediaPreviewModal.vue'
import WallpaperPickerModal from '../components/domain/WallpaperPickerModal.vue'
import WallpaperPropsPanel from '../components/domain/WallpaperPropsPanel.vue'
import { PET_CORNERS, PET_SIZE_MAX, PET_SIZE_MIN } from '../../../shared/types'
import {
  PET_AFFECTION_DECAY_PERIOD_MS,
  PET_AFFECTION_FAMILIAR_AT,
  PET_AFFECTION_LOVE_AT,
  PET_AFFECTION_RULES,
  PET_CHECKIN_RICE,
  PET_DECAY_OFFLINE_PERIOD_MS,
  PET_DECAY_ONLINE_PERIOD_MS,
  PET_FEED_GAIN,
  PET_HUNGER_FULL_AT,
  PET_HUNGER_MEDIUM_AT,
  PET_HUNGER_MILD_AT,
  PET_HUNGER_SEVERE_AT,
  PET_RICE_MAX,
  PET_REWARD_RICE
} from '../../../shared/pet'
import type { AiFailReason, IdeCandidate, LangOfCode } from '../../../shared/types'

const settings = useSettingsStore()

const LANGS: LangOfCode[] = ['c', 'cpp', 'java', 'python']

/**
 * 拨动音效开关。
 *
 * 【为什么要在这里手动 `setSfxEnabled`，不是等 main.ts 里那个 watch 去同步】
 * **顺序问题，而且只有把开关打开时才存在**：
 * `playSfx()` 第一行就是 `if (!enabled) return`。拨到"开"的那一瞬间，
 * 引擎里还是 `false`（v-model 只改了配置对象，watch 要等下一个微任务），
 * 所以紧接着那声"试听"会被自己挡掉 —— 用户拨开开关，**什么都没听见**，
 * 于是他会以为这个开关是坏的，再拨回去。
 * 先开门再敲，顺序就对了。（拨到"关"时不需要处理：那时引擎本来就是开的，
 * 而且我们也不该为"关掉声音"配一声提示音。）
 *
 * 【为什么要配试听音】
 * 开关和别的设置不一样——它是**关于声音本身**的。不试听的话，用户拨完
 * 只能等下一次点击才知道生效没有。拨开就响一声，是"现在就告诉你"。
 * 用 `nav`（两个音的小上行）而不是庆祝音：庆祝音有它自己的含义（学完一课的
 * 奖励），拿它当试听会让人以为"我是不是完成了什么"。
 */
/**
 * 夜间模式开关的**两态视图**：配置里存的是 `'light' | 'dark'`，复选框只认布尔。
 *
 * 【为什么不在配置里直接存布尔】
 * 布尔只能表达两态。哪天要加「跟随系统」，`darkMode: boolean` 就得改成字符串 ——
 * 那是一次**数据结构变更**（bump version + 写迁移）。现在多写这几行把它省掉。
 */
const themeOn = computed({
  get: () => settings.config.theme === 'dark',
  set: (on: boolean) => {
    settings.config.theme = on ? 'dark' : 'light'
  }
})

/**
 * 拨动夜间模式。
 *
 * 【为什么这里只有一句 update，不用自己去碰 `<html>`】
 * `update()` 第一件事就是**同步**改 `config.value`；而 `main.ts` 上挂着的那个
 * watch 会在同一个微任务里把 `<html data-theme>` 换掉 —— **早于下一次绘制**。
 * 所以从拨动到界面变色之间隔不了一帧，主人要的「即时生效、没有卡顿」是这么来的。
 * （变色之后才轮到 `await save()` 那趟 IPC 落地，它慢多少都不会被看见。）
 */
function onThemeChange() {
  void settings.update({ theme: settings.config.theme })
}

function onSoundChange(): void {
  void settings.update({ soundEnabled: settings.config.soundEnabled })
  if (settings.config.soundEnabled) {
    setSfxEnabled(true)
    playSfx('nav')
  }
}

/**
 * 拖完音量滑块（**松手那一下**，不是拖动过程中）。
 *
 * 【为什么挂 `change` 而不是 `input`】
 * `input` 在一次拖动里会触发几十次（每移动一像素一次）。挂上去的话，
 * 每次都会写一遍盘（几十趟 IPC + 几十次原子写），而试听音会在拖动过程中
 * 响成一片 —— 用户听到的不是"我调成了多响"，是一串噪音。
 * `change` 只在**松手**时来一次，正好落在"你刚拖完，听听看"那一刻。
 * （拖的过程中值照样在变、界面照样跟着动：`v-model` 走的是 `input`。）
 *
 * 【为什么先手动 `setSfxVolume`，不等 main.ts 那个 watch】
 * 和上面音效开关那条**一模一样**的顺序问题：`settings.update()` 只改内存里的配置，
 * 引擎里的音量要等 watch 在下一个微任务里同步。不等的话，这一声试听会用
 * **拖动之前**的音量播出来 —— 用户从 20% 拖到 100%，听到的还是 20% 那么轻，
 * 于是他会以为滑块没生效，再拖回去。先设引擎、再敲这一下，顺序就对了。
 */
function onVolumeChange(): void {
  void settings.update({ sfxVolume: settings.config.sfxVolume })
  setSfxVolume(settings.config.sfxVolume)
  playSfx('nav')
}

/**
 * 开屏卡片的三行（总开关 / 音效开关 / 音量）。
 *
 * 【为什么这里**不播**任何反馈音、也不当场重放开屏】开屏只发生在启动
 * 那一刻，拨完开关当场没有任何可看的效果 —— 三行的 hint 里都写着
 * 「下次启动生效」，这里就不装模作样地播一声「设置成功」。
 *
 * 【为什么照本文件开关的统一形状：先落内存态、再交给 setSplash 落盘】
 * 落盘是异步的；这两行之后紧接着的读值（连点两下、或音量滑块引用的
 * 同一份内存态）必须立刻看到刚才那一拨的结果。setSplash 内部从内存现值
 * 整块过 normalizeSplash，落内存态永远是它的输入。
 */
function onSplashEnabledChange(on: boolean): void {
  settings.config.splash.enabled = on
  void settings.setSplash({ enabled: on })
}

function onSplashSoundChange(on: boolean): void {
  settings.config.splash.sound = on
  void settings.setSplash({ sound: on })
}

function onSplashVolumeChange(): void {
  void settings.setSplash({ volume: settings.config.splash.volume })
}

// ---- 开屏选片与素材池（2026-10-06；池代数在 shared/media-pool.ts）

/**
 * 素材清单（池勾选区的「全量」侧面）。进设置页拉一次、导入成功后重拉。
 *
 * 【为什么池成员是文件名而不是路径/索引】配置里存的就是文件名
 * （与 SplashConfig.pool 的注释、decideSplash 同一口径），主进程扫描器
 * 对同名素材还有明确的优先级（内置优先）—— 这里照抄那份名字，不造第三套标识。
 */
const splashMats = ref<SplashMaterialRef[]>([])
/**
 * 素材清单的三态（2026-10-17 夜间批）：没试过（读在途）/ 试过 / 失败了。
 * 空态文案据此出，别把"加载中"和"出错了"都说成"还没扫到素材"。
 */
const splashMatsTried = ref(false)
const splashMatsFailed = ref(false)

/** 池代数翻译成勾选区的两个显示面：全量（名字表）与已勾集合（空池 = 全勾） */
const splashAllNames = computed(() => splashMats.value.map((m) => m.name))
const splashPoolChecked = computed(() =>
  checkedNames(settings.config.splash.pool, splashAllNames.value)
)

/** 选片三行在开屏关着时全灰（同前两行的口径）；**导入按钮不受它管**——那是文件操作 */
const splashCtlOff = computed(() => !settings.config.splash.enabled)

const splashPickTabs = SPLASH_PICKS.map((p) => ({ key: p, label: SETTINGS.SPLASH_PICK_NAMES[p] }))

/** 池子空着时那句话（两处 `<p v-else>` 共用）：在途 / 失败 / 真空，三态各说各的 */
const splashPoolEmptyText = computed(() =>
  splashMatsFailed.value
    ? SETTINGS.SPLASH_POOL_SCAN_FAILED
    : splashMatsTried.value
      ? SETTINGS.SPLASH_POOL_EMPTY
      : SETTINGS.SPLASH_POOL_SCANNING
)

/** 「指定」下拉：首项「自动」= 空串（fixedFile 的合法终态，decideSplash 回退候选第一段） */
const splashFileOptions = computed(() => [
  { label: SETTINGS.SPLASH_FIXED_AUTO, value: '' },
  ...splashMats.value.map((m) => ({ label: m.name, value: m.name }))
])

async function loadSplashMaterials(): Promise<void> {
  try {
    splashMats.value = await window.miai.listSplashMaterials()
    splashMatsFailed.value = false
  } catch (err) {
    // 拿不到清单时**不动**池子：清空会让勾选区显示成「已选 0 / 0」，看着像池子坏了。记日志收手。
    // 但空态那句话要如实（2026-10-17 夜间批）：失败 = "没扫出来"，不是"没有素材"。
    splashMatsFailed.value = true
    console.warn('[settings] listSplashMaterials failed:', err)
  } finally {
    splashMatsTried.value = true
  }
}

function onSplashPickChange(v: string): void {
  const p = asEnum(SPLASH_PICKS, v)
  if (!p) return
  settings.config.splash.pick = p
  void settings.setSplash({ pick: p })
}

/** 指定哪一段：只认清单里的文件名（'' = 自动——decideSplash 走随机分支抽一段） */
function onSplashFixedChange(v: string): void {
  if (v !== '' && !splashAllNames.value.includes(v)) return
  settings.config.splash.fixedFile = v
  void settings.setSplash({ fixedFile: v })
}

/**
 * 池子三个动作（勾一项 / 全选 / 反选）的共用落盘口。
 * 代数在 shared/media-pool.ts：结果为空时返回 null = **拒绝这次操作**——
 * 空池的语义是「全部参与」，放它过去，用户看到的是「我刚全取消了，怎么又全勾上了」。
 */
function applySplashPool(next: string[] | null): void {
  if (next === null) {
    toast(SETTINGS.POOL_KEEP_ONE, 'warn')
    return
  }
  settings.config.splash.pool = next
  void settings.setSplash({ pool: next })
}

function onSplashPoolToggle(name: string, on: boolean): void {
  applySplashPool(togglePoolItem(settings.config.splash.pool, splashAllNames.value, name, on))
}

function onSplashPoolInvert(): void {
  applySplashPool(invertPool(settings.config.splash.pool, splashAllNames.value))
}

function onSplashPoolAll(): void {
  applySplashPool(allPool())
}

const splashImporting = ref(false)

/**
 * 导入一段开屏视频。**失败按值处理**（同 AI 那套：取消与失败都是正常返回值，
 * 不逼每个调用点写 try/catch）；这里的 catch 只兜「IPC 自己出事」那种真异常。
 */
async function importSplashVideo(): Promise<void> {
  if (splashImporting.value) return
  splashImporting.value = true
  try {
    const r = await window.miai.importSplash()
    if (r.ok) {
      // 主进程现扫清单，这里拉一次新素材就在勾选区里了（可以马上分配要不要参与随机）
      await loadSplashMaterials()
      toast(SETTINGS.SPLASH_IMPORT_OK(r.name ?? ''), 'success')
      return
    }
    if (r.reason === 'bad-ext') toast(SETTINGS.SPLASH_IMPORT_BAD_EXT, 'warn')
    else if (r.reason === 'too-small') toast(SETTINGS.SPLASH_IMPORT_TOO_SMALL, 'warn')
    else if (r.reason === 'too-large') toast(SETTINGS.SPLASH_IMPORT_TOO_LARGE, 'warn')
    else if (r.reason !== 'cancelled') toast(SETTINGS.IMPORT_FAILED(r.message ?? ''), 'error')
  } catch (err) {
    console.warn('[settings] importSplash failed:', err)
    toast(SETTINGS.IMPORT_FAILED(String(err)), 'error')
  } finally {
    splashImporting.value = false
  }
}

/**
 * 拨动「原生编译环境」。
 *
 * 【为什么和音效那条不一样，**不在这里播放任何声音**】这个开关会改变
 * 「谁来跑你的代码」，是个该被认真看一眼的开关；给一声「咔哒」的反馈音，
 * 反而把它降格成了「和音效同级的小偏好」。
 *
 * 【为什么要你自己改内存态，不能只靠 update】`update()` 里那句 `config.value = {...}`
 * 确实是同步的，所以严格说第一行是多余的。留着它是为了**和上面几个开关同一个形状** ——
 * 这个文件里每个开关都是「先落内存态、再交给 update 落盘」，形状一致才看得出
 * 「谁少了哪一步」。真正要紧的是落内存态这件事本身：`decideNativeRun()` 读的
 * 就是这份内存态，所以拨完**立刻**点运行，弹窗判断的已经是新值，不用等落盘。
 */
function onNativeRunChange(on: boolean): void {
  settings.config.nativeRunEnabled = on
  void settings.update({ nativeRunEnabled: on })
}

/**
 * 拨动「每次运行前询问」。
 *
 * ⚠️ **双重否定，方向写死在这里**：这个开关的值 = `!nativeRunQuiet`。
 * 拨到「开」= 询问 = quiet 记 false；拨到「关」= 不再提醒 = quiet 记 true。
 * 弹窗里那个「不再提醒」勾选框是同一个字段的另一个写入口（勾上 = quiet true），
 * 两处含义必须一致 —— 写反任一边，用户会看到「设置里显示会问、实际不问」，
 * 而且这种不一致不报错、只能靠人眼发现。
 */
function onNativeAskChange(ask: boolean): void {
  settings.config.nativeRunQuiet = !ask
  void settings.update({ nativeRunQuiet: !ask })
}

// ---- 本地 IDE 路径（2026-10-01；v9 起每门语言各一格）

/**
 * 把某门语言选中的路径落进配置 —— 手打 / 自动检测 / 选择框三条入口共用。
 *
 * 【为什么走 store 的 setIdePath，不在这里手拼 update({ nativeIdePaths })】
 * 保存是**整份写盘**，四个键每次都得带上，而手拼时 `settings.config.nativeIdePaths`
 * 是嵌套响应式对象（structuredClone 进不了 IPC）。这两件麻烦事在 store 里
 * 一次解决（见该方法的注释），三个入口共用一条正确的路。
 */
function applyIdePath(lang: LangOfCode, p: string): void {
  void settings.setIdePath(lang, p)
}

/**
 * 弹「选一个程序」的对话框，选完立刻存到**这一门语言**，不影响另外三格。
 *
 * 【取消不是错误】点开看一眼又关掉是日常 —— 主进程返回
 * `{ok:false, reason:'cancelled'}`，这边当什么都没发生（**不动已填的路径**）。
 * 对话框只收 `.exe`：桌面快捷方式（.lnk）是启动不起来的（spawn 不走 shell
 * 去解析它），选进来只会在练习场报一个看不懂的错，不如在这里就拦住。
 *
 * 【catch 里什么都不做】取消和成功都是正常返回值，能进 catch 的只有
 * IPC 自己出事 —— 那种情况下任何"补救"都是瞎猜，保持现状最好。
 *
 * 【在飞闸（2026-10-17 夜间批）】主进程每次 invoke 都真的弹一个系统对话框，
 * 没有并发去重；闸 + 按钮 loading（MiButton 的 disabled 认 loading），
 * 首个对话框弹出前的那个往返窗口就不再能叠框了。紧挨着的「自动检测」
 * 早有 detectingLang 闸，这里补齐同一口径。
 */
async function pickIdePath(lang: LangOfCode): Promise<void> {
  if (pickingExe.value) return
  pickingExe.value = true
  try {
    const r = await window.miai.pickExePath()
    if (!r.ok) return
    applyIdePath(lang, r.path)
  } catch {
    /* 见上：IPC 出事时保持现状 */
  } finally {
    pickingExe.value = false
  }
}

/**
 * 「🔍 自动检测」：让主进程去翻常见安装位置、开始菜单快捷方式、注册表，
 * 再把结果按**这门语言**排个序（判定收在 lib/ide-detect.ts 的 planIdeChoice）。
 *
 * 【四档结局的分工】合适者里榜首唯一 → 直接填进这一格（用户还要点「打开」，
 * 不该再挡一层选择框）；平手（同一产品装了两份）/ 都不合适且不止一台 →
 * 摆选择框；没找到 / 没查成各说各的话。
 *
 * 【为什么检测中要换按钮文字、且四行一起禁点】三轮扫描要一两秒，按钮如果
 * 一动不动，用户会以为没点上，然后猛戳（同一课「重新检测」的教训）。四行一起
 * 禁是因为**同一时间只跑一趟检测** —— 拿这一趟的结果去回填别门语言是错的。
 */
const detectingLang = ref<LangOfCode | null>(null)
/** 逐语言的行内结果（没找到 / 没查成）。找到时不需要它 —— 输入框里出现路径就是回执 */
const detectMsgs = reactive<Partial<Record<LangOfCode, string>>>({})
const pickerOpen = ref(false)
const pickerList = ref<IdeCandidate[]>([])
/** 选择框是替哪门语言弹的、哪种语境（落盘时要用，见 onPickerPick） */
const pickerLang = ref<LangOfCode>('c')
const pickerHint = ref<IdePickHint>('tie')
const pickerRecommended = ref<string | null>(null)

async function detectIde(lang: LangOfCode): Promise<void> {
  if (detectingLang.value !== null) return
  detectingLang.value = lang
  detectMsgs[lang] = ''
  try {
    const plan = planIdeChoice(lang, await detectIdeOnce())
    if (plan.kind === 'choose') {
      applyIdePath(lang, plan.candidate.path)
    } else if (plan.kind === 'pick') {
      pickerLang.value = lang
      pickerList.value = plan.candidates
      pickerHint.value = plan.hint
      pickerRecommended.value = plan.recommendedPath
      pickerOpen.value = true
    } else if (plan.kind === 'none') {
      detectMsgs[lang] = SETTINGS.IDE_DETECT_NONE
    } else {
      detectMsgs[lang] = SETTINGS.IDE_DETECT_FAILED
    }
  } finally {
    detectingLang.value = null
  }
}

/** 选择框里点了一个（关框由弹窗自己做，见 IdePickerModal）—— 落给开框的那门语言 */
function onPickerPick(c: IdeCandidate): void {
  applyIdePath(pickerLang.value, c.path)
}

/**
 * 手打完某门语言的路径（失焦 / 回车）。trim 掉首尾空白再存 ——
 * 主进程写盘前也会 trim，这里先一步是为了**磁盘上的值和界面上的值一致**：
 * 不然重开设置页会看到自己打的那串带空格的旧值。
 */
function commitIdePath(lang: LangOfCode): void {
  const v = settings.config.nativeIdePaths[lang].trim()
  settings.config.nativeIdePaths[lang] = v
  void settings.setIdePath(lang, v)
}

/** 清空某门语言的路径。'' = 没配置 —— 练习场点「🛠 本地 IDE 打开」会给引导。 */
function clearIdePath(lang: LangOfCode): void {
  void settings.setIdePath(lang, '')
}

function envInfo(lang: LangOfCode) {
  const report = settings.config.envCache.report
  return report ? report[lang] : undefined
}

// ---------------------------------------------------------------- AI 区块（M6-04）

/**
 * Key 输入框。**永远是空的，不要试图去填它** ——
 * 真 Key 只存在主进程里，界面拿不到（这是设计，不是没做完）。
 * 所以这个框的语义是「要换的**新** Key」，不是「当前 Key」。
 */
const keyInput = ref('')
const showKey = ref(false)
const testing = ref(false)

/** 测试结果。`null` = 还没测过（不显示任何结果区） */
const testResult = ref<{ ok: boolean; text: string; detail?: string } | null>(null)

/** 清 Key 的确认框开着没有（V2-09：红色按钮先开框，确认了才真删） */
const clearKeyVisible = ref(false)
/** 清 Key 在飞（2026-10-17 夜间批：弹窗 await 后才关，闸挡重复写盘与重复播报） */
const clearingKey = ref(false)
/** 「选择文件…」在飞（2026-10-17 夜间批：连点会叠开系统选文件框） */
const pickingExe = ref(false)
/** 「打开奖励图文件夹」在飞（2026-10-17 夜间批：连点 = 连开 N 个资源管理器） */
const openingRewardDir = ref(false)
/** 卡片高亮的摘类计时器（1900ms，2026-10-17 夜间批挂账，见 flashCardAt） */
let cardFlashTimer: number | null = null

/** 输入框里有没有新东西要存。空白也算没有 —— 避免把一串空格当成新 Key 存进去 */
const hasNewKey = computed(() => keyInput.value.trim() !== '')

const keyPlaceholder = computed(() =>
  settings.config.ai.hasKey ? SETTINGS.AI_KEY_PLACEHOLDER_SET : SETTINGS.AI_KEY_PLACEHOLDER_EMPTY
)

/**
 * 保存（如果有新 Key）并当场验一次连接。
 *
 * 【为什么合成一个按钮，而不是「保存」和「测试」两个】
 * 对零基础用户来说，「保存成功」是个没有信息量的反馈 —— 他真正想知道的是
 * 「这东西到底能不能用」。而分成两个按钮会造出一个中间状态：
 * 存了但没测，用户以为好了，等哪天 AI 报错才发现 Key 是错的。
 * 合成一个，「按下去了、它说连上了」= 真的能用，没有中间态。
 *
 * 【为什么必测时也要保存】
 * 不保存就直接测的话，测的是**上一次存进去的 Key**，而用户以为在测刚粘的这把 ——
 * 他会在「明明填对了却提示 Key 不对」里反复打转。
 */
async function saveAndTest() {
  testing.value = true
  testResult.value = null
  try {
    if (hasNewKey.value) {
      await settings.updateAi({ apiKey: keyInput.value.trim() })
      settings.markKeySaved()
      keyInput.value = ''
    }
    const r = await window.miai.aiTestConnection()
    testResult.value = r.ok
      ? { ok: true, text: SETTINGS.AI_TEST_OK(r.data.model) }
      : { ok: false, text: AI_FAIL[r.reason], detail: r.detail }
  } catch (e) {
    // AI 请求失败**不会**走到这里（那条路返回 `{ok:false}`）。
    // 能到这里的只有「我们自己传错了参数」或者 IPC 本身出事 —— 说成
    // 「AI 挂了」会把排查方向带偏，所以照实说。
    testResult.value = { ok: false, text: SETTINGS.AI_TEST_UNEXPECTED, detail: String(e) }
  } finally {
    // 无论走哪条路，**都必须把转圈停下来**。
    // 漏了这一句的后果是按钮永远转下去，用户只能重启应用。
    testing.value = false
  }
}

/**
 * 清 Key（确认之后才走到这）。**这是唯一能真的删掉它的路**
 * （保存时的空串只表示「不改」）。V2-09：入口按钮只负责开确认框 ——
 * 删了要回平台重拿一把，值得停下来问一句。
 *
 * 【在飞闸（2026-10-17 夜间批）】弹窗是 await 之后才关的，那个往返窗口里
 * 连点就是重复 config:save 写盘 + 重复「已清除」toast。闸挡在入口，
 * 弹窗的关闭时机保持不动（关框 = "真发生了"的信号）。
 * 保存失败（save() 已弹 SETTINGS_SAVE_FAILED）时**不关框也不报成功** ——
 * 盒里那把 Key 还在，说"删掉了"就是撒谎。
 */
async function clearKey() {
  if (clearingKey.value) return
  clearingKey.value = true
  testing.value = false
  testResult.value = null
  try {
    await settings.clearAiKey()
  } catch {
    return
  } finally {
    clearingKey.value = false
  }
  clearKeyVisible.value = false
  toast(TOAST.AI_KEY_CLEARED, 'success')
}

// ---------------------------------------------------------------- 桌宠卡片（2026-10-06 换 dsh-pet 引擎）

/**
 * 这张卡只往 `config.pet` 里写三个旋钮（开关 / 体型 / 落点），**一个 pet:xxx
 * IPC 都不碰** —— 引擎（主进程 dshpet 宿主）自己盯着这份配置，落盘即重载，
 * 所以文案敢说「即刻生效，不用重启」。落点四个选项直接从 PET_CORNERS
 * （与迁移白名单同一个数组）生成，按钮名走 copy.ts 的 PET_CORNER_NAMES。
 * （旧「大肥鱼」的状态行/喂饭/模式随旧引擎一起从这张卡删掉；`stores/pet.ts`
 * 与 pet:xxx 通道留着走「后续统一清理」，本卡不再引用。）
 */

/** MiTabs 的载荷。键 = PetCorner 字面量，标签查 copy 表（漏一键 typecheck 就红） */
const petCornerTabs = PET_CORNERS.map((c) => ({ key: c, label: SETTINGS.PET_CORNER_NAMES[c] }))

/** 开关拨动：先同步改视图值（同音效开关口径），再走 setPet 落盘 */
function onPetEnabledChange(): void {
  void settings.setPet({ enabled: settings.config.pet.enabled })
}

/** 体型滑杆「拖动即所见、松手落盘」—— 同音量滑杆口径（越界钳位在 store 真源里） */
function onPetSizeChange(): void {
  void settings.setPet({ size: settings.config.pet.size })
}

/** MiTabs 只吐 string；用白名单收窄（同壁纸枚举控件那一套），坏值不写盘 */
function onPetCornerPick(v: string): void {
  const c = asEnum(PET_CORNERS, v)
  if (c) void settings.setPet({ corner: c })
}

/**
 * 两个主动行为开关（2026-10-09 补充模块一③）：跟随鼠标撒娇 / 饥饿时活跃乱跑。
 * 与上面三个旋钮同一条口径 —— 只写 config.pet，宿主盯着这份配置现算：
 *   · followMouse 是宿主 followWanted 的①号门（写盘 → 下一拍落点电平变 off，
 *     渲染端收帧停在原地）；· hungryRoam 经 /miai/flags 的 roam 电平进渲染端
 *     漫游闸门（写盘 → 下一拍 flags 刷新即生效）。
 * 所以文案敢说「即刻生效」；两个开关互不影响（跟随管"凑向光标"、乱跑管"自己溜达"）。
 */
function onPetFollowChange(): void {
  void settings.setPet({ followMouse: settings.config.pet.followMouse })
}

function onPetRoamChange(): void {
  void settings.setPet({ hungryRoam: settings.config.pet.hungryRoam })
}

/**
 * 悬停「叫它出来」开关：先让本鱼撒娇求情（主进程侧 2026-10-06 同步加的 petPlead）。
 * 【2026-10-06 晚】挽留原来挂在「关闭大肥鱼」按钮上；按钮与开关功能完全重复被删
 *（主人裁定：留开关、删按钮），挽留搬到保留下来的这个开关身上 —— 主人点名要求
 * 「留的那个控件必须有挽留」。失败静默 —— 求情没弹出来不该影响开关本身的动作，
 * 更不该为此弹一个用户看不懂的错。
 */
function onPetPleadHover(): void {
  void window.miai.petPlead().catch(() => {})
}

// ---- 大肥鱼互动说明（UI 大修轮 2026-10-09；契约 §2.2）
//
// 卡片尾部的常显小面板（不做折叠）：把好感度/饱腹度的涨跌规则与饿了的五档
// 一次讲清（主人反馈「用户看不懂这两项数值怎么变化」）。两条纪律：
//   · 数字**全部**从 src/shared/pet.ts 真源算出来、当参数传进 copy.ts 函数键
//     （本段零字面量数字；pet-guide.test.ts 拿下面的表达式与真源逐项对账）；
//   · 文案**全部**是 copy.ts 的 PET_GUIDE_*（本段与模板零中文字面量，文案闸门扫得到）。

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * 60_000

/**
 * 好感自然衰减的步进。真源在 pet.ts 的 decayAffection 里是**字面量** 1
 * （没有具名导出，见该函数里的 Math.min(state.affection, periods)）。
 * 这里钉一份；pet-guide.test.ts 用真 decayAffection 实跑 7 个周期测出步进
 * 与它对账 —— 引擎改了步进不改这里，测试会红。
 */
const AFF_DECAY_STEP = 1

/** 「每天」掉多少 = 每天期数 × 步进（周期一变这个数跟着变，文案里的数字随之变） */
const AFF_DECAY_PER_DAY = (DAY_MS / PET_AFFECTION_DECAY_PERIOD_MS) * AFF_DECAY_STEP

/** 加分六条（实参顺序 = 函数键形参顺序：feed/pat/checkin/study/challenge/review） */
const petGuideAffGain: string[] = SETTINGS.PET_GUIDE_AFF_LINES(
  PET_AFFECTION_RULES.feed.delta,
  PET_AFFECTION_RULES.pat.delta,
  PET_AFFECTION_RULES.checkin.delta,
  PET_AFFECTION_RULES.study.delta,
  PET_AFFECTION_RULES.challenge.delta,
  PET_AFFECTION_RULES.review.delta
)

/** 扣分三条（函数键要的是「减号后面那个数」= 增量的绝对值） */
const petGuideAffDown: string[] = SETTINGS.PET_GUIDE_AFF_DOWN(
  Math.abs(PET_AFFECTION_RULES.wrong.delta),
  Math.abs(PET_AFFECTION_RULES.starving.delta),
  Math.abs(PET_AFFECTION_RULES['long-away'].delta)
)

/** 衰减那句（超过一天不来 → 每天 -N；N 的推导见 AFF_DECAY_PER_DAY） */
const petGuideAffDecay: string = SETTINGS.PET_GUIDE_AFF_DECAY(AFF_DECAY_PER_DAY)

/** 饱腹四条（在线/离线衰减周期换算成分钟 + 喂饭收益 + 签到大白饭 + 学习三源 + 饭盒上限） */
const petGuideHunger: string[] = SETTINGS.PET_GUIDE_HUN_LINES(
  PET_DECAY_ONLINE_PERIOD_MS / MINUTE_MS,
  PET_DECAY_OFFLINE_PERIOD_MS / MINUTE_MS,
  PET_FEED_GAIN,
  PET_CHECKIN_RICE,
  PET_REWARD_RICE.lesson,
  PET_REWARD_RICE.review,
  PET_REWARD_RICE.answer,
  PET_RICE_MAX
)

/** 饿的五档（界值从 petHungerTier 的真源传进来；0 档那行文案固定） */
const petGuideTiers: string[] = SETTINGS.PET_GUIDE_TIER_LINES(
  PET_HUNGER_FULL_AT,
  PET_HUNGER_MILD_AT,
  PET_HUNGER_MEDIUM_AT,
  PET_HUNGER_SEVERE_AT
)

/**
 * 好感两端的脾气（补充模块一②：「80+ 主动跟随/频繁撒娇、20- 冷漠」）。
 * 实参 = 真源界值：love 档下界 / cold 档上界（<20 即 cold）。数字不进文案字面量，
 * 走 copy.ts 函数键；这里改了引用、那里改了账本，pet-guide.test.ts 都会红。
 */
const petGuideAffTiers: string[] = SETTINGS.PET_GUIDE_AFF_TIER_LINES(
  PET_AFFECTION_LOVE_AT,
  PET_AFFECTION_FAMILIAR_AT
)

/** 两个开关的行下说明（跟随那句里的两道门同样走真源，不写死；V1-49 补饱腹门） */
const petFollowHint: string = SETTINGS.PET_FOLLOW_HINT(PET_AFFECTION_LOVE_AT, PET_HUNGER_MILD_AT)
const petRoamHint: string = SETTINGS.PET_ROAM_HINT

// ---------------------------------------------------------------- 奖励图覆盖文件夹（2026-10-16）

/**
 * 「丢文件即替换」的入口行（桌宠卡尾部）：只显示「文件夹在哪、认到几张」+
 * 一个打开按钮 —— 投料方式就是往文件夹里丢文件，应用里不再造第二套导入弹框。
 * 刷新点=进设置页 + 点完「打开文件夹」回来（丢完图回来张数立刻能对上）。
 */
const rewardDirPath = ref('')
const rewardDirCount = ref(0)
/** 在册编号区间（如 g01–g200）——现算，不写死：2026-10-17 扩池后不再是 g01–g50 */
const rewardIdRange = `${GALLERY_IDS[0]}–${GALLERY_IDS[GALLERY_IDS.length - 1]}`

async function refreshRewardDir(): Promise<void> {
  const info = await refreshRewardOverrides()
  rewardDirPath.value = info.dir
  rewardDirCount.value = info.count
}

async function openRewardDir(): Promise<void> {
  if (openingRewardDir.value) return // 在飞闸（2026-10-17 夜间批）：连点 = 连开 N 个资源管理器
  openingRewardDir.value = true
  try {
    await window.miai.openRewardFolder()
    await refreshRewardDir()
  } catch {
    /* 打不开也不弹错：下面刷新会把「认到几张」如实显示 */
    await refreshRewardDir()
  } finally {
    openingRewardDir.value = false
  }
}

onMounted(() => {
  settings.ensureEnvCache()
  // 壁纸面板的「当前壁纸」和「共 N 张」都要清单：进设置页就顺手加载一次
  //（模块级单例，壁纸层/弹窗共用；重复进入走缓存，不再扫目录）
  void ensureCatalog()
  // 开屏卡的素材池与「播放哪段」下拉共用这份清单；即使当前是「指定」模式也先拉好，
  // 切到「随机」时勾选区立刻是满的（不拉的话会先闪一下「0 / 0」再填上）
  void loadSplashMaterials()
  // 桌宠菜单「一键直达」：带着 ?card= 进来时滚到对应卡片并闪一下
  //（已在设置页时由 route.query.at 的 watcher 接力，见 applyCardQuery）
  applyCardQuery()
  // 奖励图覆盖文件夹行：进设置页拉一次（同时把渲染层的覆盖缓存喂新）
  void refreshRewardDir()
})

// ---------------------------------------------------------------- 动态壁纸卡片（2026-10-04；外观面板 2026-10-05）

/**
 * 壁纸的「观感」旋钮。**分工是两份存储**：
 *   · 壁纸自己的观感（开关/压暗/过场/轮播/透视/音量…）是 config.wallpaper，
 *     统一走 setWallpaper 落盘；
 *   · 「UI 面板不透明度」「画布遮罩」是**界面偏好**，存 localStorage
 *     （wall-ui store，每主题各一份）—— 不往 config 里加字段，就不动迁移/同步那条线。
 *
 * 【为什么两个 wall-ui 滑杆用 :value + @input 而不是 v-model】
 * 同 ZoomControl 的先例：它们的真源在 store 里，`patch()` 自带「值没变直接返回」
 * 和钳位 —— 拖一下跨过一个整数才写一次 localStorage，不必在组件里再养一份镜像值。
 * config 上的那些滑块则相反（真源就在 config 对象上），走音量滑杆同款
 * v-model + @change「拖动即所见、松手落盘」。
 */
const wallUi = useWallUiStore()

/** 当前主题那一份（切主题时自动换成另一份，与 main.ts 注入 CSS 变量用的是同一个取值） */
const wallUiActive = computed(() => wallUiOf(wallUi.config, settings.config.theme))

function onPanelAlphaSlide(e: Event) {
  wallUi.patch(settings.config.theme, { panelAlpha: Number((e.target as HTMLInputElement).value) })
}

function onWallVeilSlide(e: Event) {
  wallUi.patch(settings.config.theme, { veil: Number((e.target as HTMLInputElement).value) })
}

/**
 * 液态玻璃（2026-10-08，需求⑧）。**这一组不经过 wallUiActive** ——
 * 它是几何与动力学旋钮，不分主题（一份数据两个主题共用），
 * 所以真源直接是 wallUi.config.glass。形状照上面两根：
 * :value + @input，钳位与「值没变不写盘」全在 store 的 patchGlass 里。
 *
 * 【为什么折射那几根要单独算一个 glassLensOff】
 * 它们拨的是 SVG 滤镜链（lib/glass/），折射开关关掉时那几根**没有任何消费者**
 * —— 灰掉是如实反映，不是装饰。阴影扩散**不在**这一组：它是面板自己的
 * CSS 厚度（wallpaper.css 的 inset 阴影），和折射一点关系没有，
 * 关了折射它照样生效 —— 所以它只跟 wallCtlOff（壁纸总开关）。
 * （glassLensOff 引用的 wallCtlOff 在本文件靠后定义：computed 的求值发生在
 * 首次渲染时，那时 setup 已整个跑完，不是 TDZ。）
 */
const glass = computed(() => wallUi.config.glass)

const glassLensOff = computed(() => wallCtlOff.value || !glass.value.refract)

function onGlassRefract(v: boolean) {
  wallUi.patchGlass({ refract: v })
}

function onGlassStrengthSlide(e: Event) {
  wallUi.patchGlass({ strength: Number((e.target as HTMLInputElement).value) })
}

function onGlassRingSlide(e: Event) {
  wallUi.patchGlass({ ring: Number((e.target as HTMLInputElement).value) })
}

function onGlassBlurSlide(e: Event) {
  wallUi.patchGlass({ blur: Number((e.target as HTMLInputElement).value) })
}

function onGlassFlowSlide(e: Event) {
  wallUi.patchGlass({ flow: Number((e.target as HTMLInputElement).value) })
}

function onGlassShadowSlide(e: Event) {
  wallUi.patchGlass({ shadow: Number((e.target as HTMLInputElement).value) })
}

/**
 * 面板底色的取色器（2026-10-07 个性化）。取色器显示值：有覆盖显示覆盖色本身；
 * 没有则显示**当前主题自带的面板底色** —— 取值来自 shared/theme.ts 的权威表
 * （由 theme.test.ts 钉在 tokens.css 上），组件里不许硬编码色值。
 */
const panelColorShown = computed(() => wallUiActive.value.panelColor ?? panelBgOf(settings.config.theme))

/**
 * 拖色轮时实时写入（@input）。净化 /「值没变不写」/写盘全在 store 那一处，
 * 这里只把 input 的字符串递进去（非法值在 shared/wall-ui.ts 被净化成 null）。
 */
function onPanelColorInput(e: Event) {
  wallUi.setPanelColor(settings.config.theme, (e.target as HTMLInputElement).value)
}

/** 「恢复默认」：清掉当前主题的覆盖色（null = 不覆盖），取色器回到主题自带色 */
function onPanelColorReset() {
  wallUi.setPanelColor(settings.config.theme, null)
}

/**
 * 拨壁纸总开关。形状同 onSoundChange：模板里先落内存态（壁纸层立刻挂/卸），
 * 这里把内存态交给 setWallpaper 落盘（整块规范化后走 update）。
 *
 * 【2026-10-17 朋友分享版：打开时顺手做一次 WE 探测】分享版不再假设对方
 * 装过 Wallpaper Engine —— 没装时开这个开关只会得到一层空渐变，用户会以为
 * 功能坏了。`ensureCatalog()` 与墙纸层/选择弹窗共用同一个模块级单例
 * （在途请求合流，不会多扫一遍）；`hasEngine === false` 才提示，
 * **null（还没扫完/上次扫失败）不提示** —— 扫描失败不等于没装。
 */
async function onWallpaperChange(): Promise<void> {
  const want = settings.config.wallpaper.enabled
  await settings.setWallpaper({ enabled: want })
  if (!want) return
  await ensureCatalog()
  if (wallpaperCatalog.hasEngine.value === false) toast(SETTINGS.WALL_ENGINE_MISSING, 'info')
}

/**
 * 打开「选择壁纸」弹窗（2026-10-17 分享版补）。先把清单 ensure 出来：
 * 没装 WE 的机器在这里给一句友好提示，而不是让用户对着空列表猜。
 * **弹窗照开** —— 自己导入过壁纸的用户（available=true / hasEngine=false）
 * 还得从这里选；提示是解释，不是拦路。
 */
async function openWallPicker(): Promise<void> {
  await ensureCatalog()
  if (wallpaperCatalog.hasEngine.value === false) toast(SETTINGS.WALL_ENGINE_MISSING, 'info')
  wallPickerOpen.value = true
}

// ---- 壁纸外观面板（2026-10-05，P3 第二步：照开源壁纸引擎的「壁纸外观设置」移植）

/** 当前页签（wall / screen / play / parallax / props）。⚠️ 只认这五个 key，与墙上的 MiTabs 同源 */
const wallTab = ref('wall')

// ---- 桌宠菜单的「一键直达」（2026-10-06）：`?card=wall` / `?card=ai` ────────
// 到达方式见 lib/app-nav.ts：主进程把目标写进 query，这一页负责"滚过去 +
// 闪一下"。`at` 是时间戳 nonce —— 连点两下同一个入口也要再滚一次。
// 【为什么查询参数里认不了就静默不动】普通用户从侧栏进设置页不该被这个
// 逻辑打扰（没有 query 就是什么都不做）；坏值同理 —— 页面不动比乱跳好。

const route = useRoute()

/** 快捷入口的目标卡 → DOM 选择器。设置页没有 id 锚点，用卡片自身的修饰类 */
const CARD_SELECTOR: Record<string, string> = {
  wall: '.card.wall-card',
  ai: '.card.ai-card',
  // pet = 大肥鱼互动规则说明（2026-10-09 补充模块一：侧栏状态块点进来）。
  // ⚠️ '.pet-guide' 这个开标签在 pet-guide.test.ts 里是逐字节锚点，别给它加 id/改类名
  pet: '.pet-guide'
}

function applyCardQuery(): void {
  const card = typeof route.query.card === 'string' ? route.query.card : ''
  const sel = CARD_SELECTOR[card]
  if (!sel) return
  // 壁纸卡有子页签：先切回「壁纸」主页签再滚
  //（从别处进来时，页签可能还停在上次看的 screen/play 那一页）
  if (card === 'wall') wallTab.value = 'wall'
  const el = document.querySelector(sel)
  if (!(el instanceof HTMLElement)) return
  // 滚动容器是 App.vue 的 main.content（overflow-y:auto）——scrollIntoView
  // 会自己滚最近的滚动祖先，别拿 documentElement 量（它恒等于视口高）
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  // 重启动画：remove → 强制 reflow → add（同一个 class 连加两次不会重播）
  el.classList.remove('card-flash')
  void el.offsetWidth
  el.classList.add('card-flash')
  // 先清上一枚（2026-10-17 夜间批）：at nonce 连续变化时，旧计时器（t0+1900ms）
  // 会伸进新一段 1.8s 动画里把它中途摘掉；挂账后 onBeforeUnmount 也顺手清得掉
  if (cardFlashTimer !== null) window.clearTimeout(cardFlashTimer)
  cardFlashTimer = window.setTimeout(() => {
    cardFlashTimer = null
    el.classList.remove('card-flash')
  }, 1900)
}

// 已在设置页时（路由不重挂载）靠 at 的变化重跑；首次进入走 onMounted
watch(
  () => route.query.at,
  () => applyCardQuery()
)

/*
 * 卸载清理（2026-10-17 夜间批补）：本文件此前**没有任何 onBeforeUnmount** ——
 * 1900ms 的摘类计时器在换页后仍会触发（对一个已游离的元素动 classList）。
 * 与 OverviewView.vue 的同款计时器一起补上；两处都是"挂账 + 先清后设"。
 */
onBeforeUnmount(() => {
  if (cardFlashTimer !== null) {
    window.clearTimeout(cardFlashTimer)
    cardFlashTimer = null
  }
})

/** 「选择壁纸」弹窗（清单、刷新、选中态都在弹窗里 —— 见 WallpaperPickerModal）
    ⚠️ 名字带 wall 前缀：上面还有一个 IDE 选择器也叫 pickerOpen */
const wallPickerOpen = ref(false)

/** config.wallpaper 的快捷引用（模板里读起来短一点；写仍走 setWallpaper 落盘） */
const wall = computed(() => settings.config.wallpaper)

// ---- 预览悬浮卡与隐藏（2026-10-06，主人点名的隐私 + 预览两项）━━━━━━━━━━━━━━

/**
 * 「显示隐藏项目」开关（localStorage 记忆的**视图态**，不是 config ——
 * 见 stores/wall-hidden.ts 头注释）。它同时喂三处展示：选择弹窗、轮播池列表、
 * 「共 N 张」读数。**不喂壁纸层**：隐藏的壁纸任何情况下都不进轮播（隐私原义，
 * 判据在 WallpaperLayer 的 rotationPool）。
 */
const wallHidden = useWallHiddenStore()

/** 被隐藏的 id 集合（config.wallpaper.hidden 现值；展示层过滤共用这一份） */
const wallHiddenSet = computed(() => new Set(wall.value.hidden))

/**
 * 预览悬浮卡（开屏池与壁纸池**共用同一个实例**）：两处不可能同时开
 * （设置页一次只渲染一个页签/一个卡片区），各养一个 ref 反而会出现
 * 「关了这个那个还留在 DOM 里」。规格解析在 lib/wallpaper/preview.ts
 * （纯函数、可单测）；这里只装已解析好的载荷 + 宿主翻译好的说明文案。
 */
const preview = ref<{
  url: string
  kind: 'video' | 'image'
  title: string
  posterOnly: boolean
} | null>(null)

/** 这条有没有可预览的东西（没有就不渲染按钮 —— 别摆一个点了没反应的钮） */
function canPreviewWall(it: WallpaperItem): boolean {
  return wallpaperPreviewSpec(it) !== null
}

function openWallPreview(it: WallpaperItem): void {
  const spec = wallpaperPreviewSpec(it)
  if (!spec) return
  preview.value = { ...spec, title: it.title }
}

function openSplashPreview(m: SplashMaterialRef): void {
  preview.value = { ...splashPreviewSpec(m), title: m.name }
}

/** 固定模式单选行走这个口（插槽只拿到名字，回清单里找回素材对象再预览） */
function openSplashPreviewByName(name: string): void {
  const m = splashMats.value.find((x) => x.name === name)
  if (m) openSplashPreview(m)
}

/** 场景/网页类只能看海报图时如实标注（别让人以为预览坏了） */
const previewNote = computed(() =>
  preview.value?.posterOnly ? SETTINGS.WALL_PREVIEW_NOTE_POSTER : undefined
)

/** 隐藏/取消隐藏（切换语义在 store 里：幂等 toggle + 整块落盘） */
function onWallHideToggle(id: string): void {
  void settings.toggleHiddenWallpaper(id)
}

/**
 * 壁纸关着时，页签**里面的**控件全灰（同三根老滑块的口径）。
 * 页签本身不灰 —— 关着也让人能翻进来看看有什么可调的，看着看着才想打开。
 */
const wallCtlOff = computed(() => !settings.config.wallpaper.enabled)

/** 选中条目（清单没加载到 / 没选时为 null，界面出占位句） */
const wallCurrent = computed(() => findCatalogItem(settings.config.wallpaper.selectedId))

/**
 * 清单共几张（「共 N 张」）；加载入口在 onMounted，弹窗里也能刷新。
 * v16 起按**展示口径**数：隐藏的默认不计数（与选择弹窗的可见列表一致 ——
 * 列表里看不到、计数却算它，是那种「数字对不上但没人知道差在哪」的小刺）。
 */
const wallCount = computed(() => {
  const items = wallpaperCatalog.items.value
  if (wallHidden.showHidden) return items.length
  return items.filter((it) => !wallHiddenSet.value.has(it.id)).length
})
const wallCatalogLoading = computed(() => wallpaperCatalog.loading.value)

/** 手动暂停（模块级会话态；换壁纸会自动解除 —— 见 play-state.ts 头注释） */
const wallManualPaused = wallpaperPlayState.manualPaused

/**
 * 当前壁纸行的状态字（三态）：总开关关着 →「已关闭」。关掉开关后屏上已经什么
 * 都没有了，状态字还说「播放中」是自相矛盾（2026-10-05 复核抓到的形态）。
 */
const wallStateText = computed(() => {
  if (!settings.config.wallpaper.enabled) return SETTINGS.WALL_STATE_OFF
  return wallManualPaused.value ? SETTINGS.WALL_STATE_PAUSED : SETTINGS.WALL_STATE_PLAYING
})

/** 面板里数值控件的统一落盘口（值已在模板里写进内存态，这里只负责持久化） */
function onWallPatch(patch: Partial<WallpaperConfig>): void {
  void settings.setWallpaper(patch)
}

/**
 * 字符串 → 枚举收窄（壁纸 / 开屏 / 桌宠的 MiSelect / MiTabs 共用这一把）。
 * 它们给的是 string，白名单外的值**不写盘**
 * （同 normalizeWallpaper 的口径：不认识的值退回现值，绝不把垃圾存进去）。
 */
function asEnum<T extends string>(list: readonly T[], v: string): T | null {
  return (list as readonly string[]).includes(v) ? (v as T) : null
}

function onWallTransitionPick(v: string): void {
  const t = asEnum(WALLPAPER_TRANSITIONS, v)
  if (t) onWallPatch({ transition: t })
}

function onWallDirPick(v: string): void {
  const d = asEnum(WALLPAPER_TRANSITION_DIRS, v)
  if (d) onWallPatch({ transitionDir: d })
}

function onWallFitPick(v: string): void {
  const f = asEnum(WALLPAPER_OBJECT_FITS, v)
  if (f) onWallPatch({ objectFit: f })
}

/** 速度档：MiTabs 给 '0.6'/'1'/'1.6'，转数字后过白名单（真源 = shared 的常量表） */
function onWallSpeedPick(v: string): void {
  const n = Number(v)
  if (!(WALLPAPER_TRANSITION_SPEEDS as readonly number[]).includes(n)) return
  onWallPatch({ transitionSpeed: n as WallpaperTransitionSpeed })
}

/** 倍速档：白名单就是面板上那六档（wallRateValues，与 shared 的 min/max 同界） */
function onWallRatePick(v: string): void {
  const n = Number(v)
  if (!wallRateValues.includes(n)) return
  onWallPatch({ playbackRate: n })
}

/** 场景帧率档（15/30/60/120/无上限）：白名单 = shared 的 WALLPAPER_SCENE_FPS。
    「无上限」在配置里是哨兵 1000（不用 0/Infinity：前者会被 `|| 60` 吞掉、
    后者过不了 JSON —— 见 shared/wallpaper.ts 的长注释），这里只认白名单 */
function onWallSceneFpsPick(v: string): void {
  const n = Number(v)
  if (!(WALLPAPER_SCENE_FPS as readonly number[]).includes(n)) return
  onWallPatch({ sceneFps: n as WallpaperSceneFps })
}

/** 场景画质档（省电/高/自动）：白名单 = shared 的 WALLPAPER_QUALITIES */
function onWallQualityPick(v: string): void {
  const q = asEnum(WALLPAPER_QUALITIES, v)
  if (q) onWallPatch({ quality: q })
}

/**
 * 音频响应开关（场景壁纸的频谱源，播放页签）。这里只管写配置 ——
 * 真正的采集（getDisplayMedia）、失败回滚与 toast 都在 WallpaperLayer
 * （它是唯一知道场景实例死活的地方；这里回滚会绕两层）。
 */
function onWallAudioToggle(v: boolean): void {
  onWallPatch({ audio: { ...settings.config.wallpaper.audio, enabled: v } })
}

function onWallOrderPick(v: string): void {
  const o = asEnum(WALLPAPER_ROTATION_ORDERS, v)
  if (o) onWallPatch({ rotation: { ...wall.value.rotation, order: o } })
}

/** 轮播子块整体落盘（v-model 已改内存态，这里把整块交出去） */
function onWallRotationChange(): void {
  const r = settings.config.wallpaper.rotation
  // ⚠️ pool 必须一起带上：这一块是**整块替换**的载荷，漏了它 = 每次拨开关/拖间隔
  // 都把池子清空重置回「全部参与」（v15 加 pool 时差点留下的缝，测试钉住了这条）
  onWallPatch({
    rotation: { enabled: r.enabled, intervalMin: r.intervalMin, order: r.order, pool: r.pool }
  })
}

// ---- 轮播池与导入壁纸（2026-10-06，v15；池代数与开屏池共用 shared/media-pool.ts）

/**
 * 轮播池的候选 = 可渲染条目（与壁纸层 rotationPool() 同一判据 ——
 * isRenderableItem 只有 shared 一份，选择弹窗的禁用也走它）。不可渲染的条目
 * 连「当前壁纸」都当不了，不该占池子名额；而**已勾但当前扫不到的**幽灵 id
 * 不在这张表里（勾选区自然不显示它们，池里的条目由代数保留，扫回来还在）。
 *
 * 【v16 叠加隐藏过滤】被隐藏的条目在 showHidden 关着时**从这张表退场**，
 * 于是它在勾选区里的行为与「扫不到」的幽灵名**完全同一套代数**：池里保留、
 * 不显示、全选/反选以眼前可见集合为准（shared/media-pool.ts 的幽灵语义）。
 * 打开「显示隐藏项目」它就带标记回来。⚠️ 这里只影响**展示与勾选**；
 * 真正「不进轮播」的判据在 WallpaperLayer（无条件过滤，与这个开关无关）。
 */
const wallPoolCandidates = computed(() =>
  wallpaperCatalog.items.value.filter(
    (it) => isRenderableItem(it) && (wallHidden.showHidden || !wallHiddenSet.value.has(it.id))
  )
)
const wallPoolAllIds = computed(() => wallPoolCandidates.value.map((it) => it.id))
const wallPoolChecked = computed(() => checkedNames(wall.value.rotation.pool, wallPoolAllIds.value))

/** 池子行的标签：showHidden 打开时，被隐藏的条目带「（已隐藏）」尾缀现身 */
function wallPoolLabel(it: WallpaperItem): string {
  return wallHiddenSet.value.has(it.id) ? it.title + SETTINGS.WALL_HIDDEN_TAG : it.title
}

function applyWallPool(next: string[] | null): void {
  if (next === null) {
    toast(SETTINGS.POOL_KEEP_ONE, 'warn')
    return
  }
  onWallPatch({ rotation: { ...wall.value.rotation, pool: next } })
}

function onWallPoolToggle(id: string, on: boolean): void {
  applyWallPool(togglePoolItem(wall.value.rotation.pool, wallPoolAllIds.value, id, on))
}

function onWallPoolInvert(): void {
  applyWallPool(invertPool(wall.value.rotation.pool, wallPoolAllIds.value))
}

function onWallPoolAll(): void {
  applyWallPool(allPool())
}

const wallImporting = ref(false)

/** 导入一张壁纸。语义同 importSplashVideo：失败按值，成功后主进程已强制重扫、这里拉新快照 */
async function importWallpaperFile(): Promise<void> {
  if (wallImporting.value) return
  wallImporting.value = true
  try {
    const r = await window.miai.importWallpaper()
    if (r.ok) {
      await refreshCatalog()
      toast(SETTINGS.WALL_IMPORT_OK(r.name ?? ''), 'success')
      return
    }
    if (r.reason === 'bad-ext') toast(SETTINGS.WALL_IMPORT_BAD_EXT, 'warn')
    else if (r.reason === 'too-small') toast(SETTINGS.WALL_IMPORT_TOO_SMALL, 'warn')
    else if (r.reason === 'too-large') toast(SETTINGS.WALL_IMPORT_TOO_LARGE, 'warn')
    else if (r.reason !== 'cancelled') toast(SETTINGS.IMPORT_FAILED(r.message ?? ''), 'error')
  } catch (err) {
    console.warn('[settings] importWallpaper failed:', err)
    toast(SETTINGS.IMPORT_FAILED(String(err)), 'error')
  } finally {
    wallImporting.value = false
  }
}

/** 透视子块整体落盘（同 onWallRotationChange） */
function onWallParallaxChange(): void {
  const p = settings.config.wallpaper.parallax
  onWallPatch({
    parallax: { enabled: p.enabled, amount: p.amount, smooth: p.smooth }
  })
}

/** 省电子块整体落盘（三个开关共用） */
function onWallPowerChange(): void {
  const p = settings.config.wallpaper.power
  onWallPatch({
    power: { pauseOnMinimize: p.pauseOnMinimize, pauseOnBlur: p.pauseOnBlur, pauseOnBattery: p.pauseOnBattery }
  })
}

/**
 * 壁纸音轨开关（播放页签的开关行与「🔊/🔇」按钮共用）。
 * 「打开时音量 0 自动补 50」是上游 UI 层的口径，落在这一处 ——
 * 只在**真的从静音里开出来**那一刻补，不是每次开都补：用户特意把音量调到 0
 * 再关开一次，音量不该被悄悄改掉。
 */
function onWallTrackToggle(v: boolean): void {
  const w = settings.config.wallpaper
  if (v && w.volume <= 0) onWallPatch({ trackOn: true, volume: 50 })
  else onWallPatch({ trackOn: v })
}

/** 清除当前壁纸（selectedId='' 是「没选」的合法终态 —— 屏上只剩垫底渐变） */
function onWallClear(): void {
  onWallPatch({ selectedId: '' })
}

/** 弹窗选中一张：只认清单里的 id（弹窗只会发清单内的，这里再守一道） */
function onWallPick(id: string): void {
  if (!findCatalogItem(id)) return
  onWallPatch({ selectedId: id })
}

/**
 * 壁纸透明度滑杆。显示域是「透明度」0~90（越大越透），存储域是 opacity 0~100
 * （越大越实）—— 两域换算 = 100 - 显示值。上限 90 而不是 100：**拖到头也留
 * 10% 底子**，画面不会整个消失（真不想看它，上面有关闭开关）。
 */
const WALL_MEDIA_OPACITY_UI_MAX = OPACITY_MAX - 10
const wallOpacityUi = computed(() => OPACITY_MAX - settings.config.wallpaper.opacity)
function onWallOpacitySlide(e: Event) {
  settings.config.wallpaper.opacity = OPACITY_MAX - Number((e.target as HTMLInputElement).value)
}

/** 亮度/对比度/饱和度的显示百分数（存的是 0.5~1.5 倍率） */
const pct = (v: number): number => Math.round(v * 100)

/** 过场时长的预告（过场/速度/方向一改就重算；「随机」没有固定值，模板里单列一句） */
const wallSpecMs = computed(
  () => transitionSpec(wall.value.transition, wall.value.transitionSpeed, wall.value.transitionDir).ms
)

/** 方向行只在认方向的过场下出现（推移/擦除/条带 + 随机）—— 白名单与 transitions.ts 同源 */
const wallDirRow = computed(
  () =>
    wall.value.transition === 'random' ||
    (SWITCH_DIRECTIONAL as readonly string[]).includes(wall.value.transition)
)

/** 倍速六档（0.5× ~ 2×）—— 真源在 shared 的 WALLPAPER_RATE_STEPS（「壁纸属性」页签的「单独倍速」共用同一张表） */
const wallRateValues: readonly number[] = WALLPAPER_RATE_STEPS

/** 页签与各分段控件的选项（label 全部来自 copy，组件里不留中文；顺序 = shared 常量表顺序） */
const wallTabs = [
  { key: 'wall', label: SETTINGS.WALL_TAB_WALLPAPER },
  { key: 'screen', label: SETTINGS.WALL_TAB_SCREEN },
  { key: 'play', label: SETTINGS.WALL_TAB_PLAY },
  { key: 'parallax', label: SETTINGS.WALL_TAB_PARALLAX },
  { key: 'props', label: SETTINGS.WALL_TAB_PROPS }
]
const wallTransitionOptions = WALLPAPER_TRANSITIONS.map((t) => ({
  label: SETTINGS.WALL_TRANSITION_NAMES[t],
  value: t
}))
const wallDirTabs = WALLPAPER_TRANSITION_DIRS.map((d) => ({
  key: d,
  label: SETTINGS.WALL_DIR_NAMES[d]
}))
/** ⚠️ 三条标签要与 WALLPAPER_TRANSITION_SPEEDS 的三档一一对应（同序），加档位时一起加 */
const WALL_SPEED_LABELS: Record<string, string> = {
  '0.6': SETTINGS.WALL_SPEED_FAST,
  '1': SETTINGS.WALL_SPEED_NORMAL,
  '1.6': SETTINGS.WALL_SPEED_SLOW
}
const wallSpeedTabs = WALLPAPER_TRANSITION_SPEEDS.map((s) => ({
  key: String(s),
  label: WALL_SPEED_LABELS[String(s)]
}))
const wallFitTabs = WALLPAPER_OBJECT_FITS.map((f) => ({
  key: f,
  label: SETTINGS.WALL_FIT_NAMES[f]
}))
/** 场景帧率：key 是数字串（MiTabs 只发 string，收口在 onWallSceneFpsPick）。
    「无上限」的页签显示名字、不显示数字 —— 1000 是哨兵不是档位读数 */
const wallSceneFpsTabs = WALLPAPER_SCENE_FPS.map((f) => ({
  key: String(f),
  label: f === FPS_UNLIMITED ? SETTINGS.WALL_SCENE_FPS_UNLIMITED : `${f} FPS`
}))
const wallQualityTabs = WALLPAPER_QUALITIES.map((q) => ({ key: q, label: SETTINGS.WALL_QUALITY_NAMES[q] }))
const wallOrderTabs = WALLPAPER_ROTATION_ORDERS.map((o) => ({
  key: o,
  label: SETTINGS.WALL_ORDER_NAMES[o]
}))
const wallRateTabs = wallRateValues.map((v) => ({ key: String(v), label: `${v}×` }))
</script>

<template>
  <div class="page">
    <h1 class="page-title">{{ TITLE.SETTINGS }}</h1>
    <div class="card">
      <!-- 开关统一用 MiSwitch（不再用裸 checkbox）。
           【为什么赋值写在模板里、不改成 `onXxxChange(v)`】
           原来的 `v-model` 是**先写值、再触发 change**，下面几个 onXxx 函数
           全都靠「读一遍 config 拿新值」来工作。写在这一行里（`A = $event; onX()`）
           顺序和原来逐字一致，那几个函数连注释都不用动。 -->
      <div class="row">
        <span>{{ SETTINGS.LABEL_REVIEW_REMINDER }}</span>
        <MiSwitch
          :model-value="settings.config.reviewEnabled"
          @update:model-value="
            settings.config.reviewEnabled = $event;
            settings.update({ reviewEnabled: $event })
          "
        />
      </div>
      <!--
        收藏练习的记账开关（学习闭环 §0-6）。
        紧跟在「每日复习」下面：它们都是**练习/复习这条线**上的开关，
        中间隔着音效、主题、运行环境的话，找它的人不会想到要往下翻。
      -->
      <div class="row">
        <span>{{ SETTINGS.LABEL_FAV_WRONG_TO_BOOK }}</span>
        <MiSwitch
          :model-value="settings.config.favWrongToBook"
          @update:model-value="
            settings.config.favWrongToBook = $event;
            settings.update({ favWrongToBook: $event })
          "
        />
      </div>
      <p class="hint">{{ SETTINGS.FAV_WRONG_TO_BOOK_HINT }}</p>
      <div class="row">
        <span>{{ SETTINGS.LABEL_SOUND }}</span>
        <MiSwitch
          :model-value="settings.config.soundEnabled"
          @update:model-value="settings.config.soundEnabled = $event; onSoundChange()"
        />
      </div>
      <p class="hint">{{ SETTINGS.SOUND_HINT }}</p>
      <!-- 音量滑块紧跟在音效开关下面 —— 它管的是上面那条说明里那些音的**响度**，
           和开关是同一件事的两半，中间隔开别的设置会让人觉得它们没关系。 -->
      <div class="row">
        <span>{{ SETTINGS.LABEL_SFX_VOLUME }}</span>
        <div class="vol-wrap">
          <input
            v-model.number="settings.config.sfxVolume"
            type="range"
            min="0"
            max="100"
            step="1"
            class="vol-range"
            :disabled="!settings.config.soundEnabled"
            :aria-label="SETTINGS.LABEL_SFX_VOLUME"
            @change="onVolumeChange"
          />
          <!-- 数字是**实时**跟着拖的（它绑的是同一个 v-model），不是松手才跳 ——
               拖的时候看不到数，就没法确认"值真的在变"，只能靠耳朵，
               而音量的可感差别本来就小。 -->
          <span class="vol-pct">{{ settings.config.sfxVolume }}%</span>
        </div>
      </div>
      <p class="hint">{{ SETTINGS.SFX_VOLUME_HINT }}</p>
      <div class="row">
        <span>{{ SETTINGS.LABEL_THEME }}</span>
        <MiSwitch
          :model-value="themeOn"
          @update:model-value="themeOn = $event; onThemeChange()"
        />
      </div>
      <p class="hint">{{ SETTINGS.THEME_HINT }}</p>
      <div class="row">
        <span>{{ SETTINGS.LABEL_NATIVE_RUN }}</span>
        <MiSwitch
          :model-value="settings.config.nativeRunEnabled"
          @update:model-value="onNativeRunChange($event)"
        />
      </div>
      <p class="hint">{{ SETTINGS.NATIVE_RUN_HINT }}</p>
      <!--
        「每次运行前询问」开关（2026-10-01）。弹窗里勾了「不再提醒」之后，
        这里就是**唯一**能把它拨回来的地方（主人原话：「要修改再去设置里修改」）。
        留着但置灰、而不是 v-if 藏掉 —— 和上面音效音量滑块同型：主开关关着时
        「询问」这件事根本不发生，藏起来会让用户以为这个选项时有时无。
        ★ 显示值 = 「运行前到底会不会被问」= enabled && !quiet，**不是**裸的 !quiet。
        两种口径在总开关开着时完全一样，只在关着时分开：弹窗里「勾不再提醒 +
        用应用自己的」落盘的是 enabled=false（quiet 没动，仍是 false）——裸 !quiet
        会让这一行显示「开」，用户刚勾完「不再提醒」，回来看到询问开着，会以为
        勾没生效；显示成关则和他刚做的事一致（也确实不会问了，总闸拦着）。
        拨动本身仍然只写 quiet（onNativeAskChange），显示口径不影响写入方向。
      -->
      <div class="row">
        <span>{{ SETTINGS.LABEL_NATIVE_ASK }}</span>
        <MiSwitch
          :model-value="settings.config.nativeRunEnabled && !settings.config.nativeRunQuiet"
          :disabled="!settings.config.nativeRunEnabled"
          @update:model-value="onNativeAskChange($event)"
        />
      </div>
      <p class="hint">{{ SETTINGS.NATIVE_ASK_HINT }}</p>
      <!--
        本地 IDE 路径（2026-10-01；v9 起**每门语言各一格**）。紧跟在原生开关
        下面：它们管的是同一块 —— 开关决定「谁来跑」，这几行决定「点 🛠 时
        打开哪个程序」。之所以要分语言，是因为**编码跟着程序走**：Dev-C++ 按
        GBK 读文件、VS Code 按 UTF-8 读，同一份代码在这两家眼里就是两样东西。
        一门语言固定配一个"读得懂它"的程序，乱码这个问题才从根上没了。
        未配置（空串）是**合法状态**：练习场那两个按钮照样可点，点了会按语言
        现检现荐，而不是在这里逼人选一个。
      -->
      <template v-for="l in LANGS" :key="l">
        <div class="row">
          <span>{{ SETTINGS.LABEL_NATIVE_IDE_FOR(l) }}</span>
          <div class="ide-path-wrap">
            <input
              v-model="settings.config.nativeIdePaths[l]"
              type="text"
              spellcheck="false"
              :placeholder="SETTINGS.NATIVE_IDE_PLACEHOLDER"
              @change="commitIdePath(l)"
            />
            <!--
              「自动检测」排在「选择文件」前面（2026-10-01 主人要求）：
              多数用户根本不知道自己的 IDE 装在哪 —— 让机器先找一遍，
              找不到再退回手动挑。检测期间换「检测中…」且四行一起禁点
              （理由见 detectIde 的注释）。
            -->
            <MiButton
              size="sm"
              variant="secondary"
              :disabled="detectingLang !== null"
              @click="detectIde(l)"
            >
              {{ detectingLang === l ? ACTION.DETECTING : ACTION.AUTO_DETECT }}
            </MiButton>
            <MiButton size="sm" variant="secondary" :loading="pickingExe" @click="pickIdePath(l)">
              {{ ACTION.PICK_FILE }}
            </MiButton>
            <!-- 空的时候是灰的：没有东西可清的点会让人以为"这里是不是坏了" -->
            <MiButton
              size="sm"
              variant="ghost"
              :disabled="settings.config.nativeIdePaths[l] === ''"
              @click="clearIdePath(l)"
            >
              {{ ACTION.CLEAR_PATH }}
            </MiButton>
          </div>
        </div>
        <!-- 检测的行内结果（没找到/没查成两种）。逐语言各记各的 —— 检测 C 的
             结果不该挂在 Java 那一行下面。**不占用静态 hint 的位置**：那句
             「留空 = 打开时自动挑」是长期说明，这是这一次的结果 -->
        <p v-if="detectMsgs[l]" class="hint detect-msg">{{ detectMsgs[l] }}</p>
      </template>
      <p class="hint">{{ SETTINGS.NATIVE_IDE_HINT }}</p>
      <div class="row">
        <span>{{ SETTINGS.LABEL_RUN_TIMEOUT }}</span>
        <input
          v-model.number="settings.config.runTimeoutSec"
          type="number"
          min="1"
          max="60"
          @change="settings.update({ runTimeoutSec: settings.config.runTimeoutSec })"
        />
      </div>
      <p class="hint">{{ SETTINGS.REST_COMING }}</p>
    </div>

    <!--
      开屏动画卡片（2026-10-05，docs/24 P1；选片/素材池/导入 2026-10-06）。
      开关三行都挂「下次启动生效」——开屏只发生在启动那一刻，拨完当场没有
      任何可看的反馈，hint 里写死。「素材与选片」区三件套：选片方式 → 指定
      （下拉）/ 随机（勾选池）→ 导入。池子语义（空 = 全部参与）与勾选代数
      在 shared/media-pool.ts（壁纸轮播池共用同一份），这里不写第二遍；
      配置 schema 开屏池 v14 就位、壁纸池 v15 补上，本步不加字段。
    -->
    <div class="card">
      <div class="env-head">
        <div class="env-title-wrap">
          <span class="env-title">{{ SETTINGS.SPLASH_CARD_TITLE }}</span>
        </div>
      </div>
      <div class="row">
        <span>{{ SETTINGS.LABEL_SPLASH }}</span>
        <MiSwitch
          :model-value="settings.config.splash.enabled"
          @update:model-value="onSplashEnabledChange($event)"
        />
      </div>
      <p class="hint">{{ SETTINGS.SPLASH_HINT }}</p>
      <div class="row">
        <span>{{ SETTINGS.LABEL_SPLASH_SOUND }}</span>
        <MiSwitch
          :model-value="settings.config.splash.sound"
          :disabled="!settings.config.splash.enabled"
          @update:model-value="onSplashSoundChange($event)"
        />
      </div>
      <p class="hint">{{ SETTINGS.SPLASH_SOUND_HINT }}</p>
      <div class="row">
        <span>{{ SETTINGS.LABEL_SPLASH_VOLUME }}</span>
        <div class="vol-wrap">
          <input
            v-model.number="settings.config.splash.volume"
            type="range"
            min="0"
            max="100"
            step="1"
            class="vol-range"
            :disabled="!settings.config.splash.enabled || !settings.config.splash.sound"
            :aria-label="SETTINGS.LABEL_SPLASH_VOLUME"
            @change="onSplashVolumeChange"
          />
          <span class="vol-pct">{{ settings.config.splash.volume }}%</span>
        </div>
      </div>
      <p class="hint">{{ SETTINGS.SPLASH_VOLUME_HINT }}</p>

      <!-- 素材与选片（2026-10-06）。「指定」模式下不显示池子：池过滤只作用于
           随机抽取（decideSplash），把它摆出来解释成本比藏起来高；
           导入按钮**不随总开关变灰**——那是文件操作，开关关着也该能先把素材备好 -->
      <div class="wall-sec">{{ SETTINGS.SPLASH_MATERIALS_TITLE }}</div>
      <div class="row">
        <span>{{ SETTINGS.LABEL_SPLASH_PICK }}</span>
        <MiTabs
          :tabs="splashPickTabs"
          :model-value="settings.config.splash.pick"
          :disabled="splashCtlOff"
          @update:model-value="onSplashPickChange"
        />
      </div>
      <p class="hint">{{ SETTINGS.SPLASH_PICK_HINT }}</p>
      <template v-if="settings.config.splash.pick === 'fixed'">
        <div class="row">
          <span>{{ SETTINGS.LABEL_SPLASH_FIXED }}</span>
        </div>
        <!-- 2026-10-06 第二批：原先这里是 MiSelect 下拉 —— **原生 select 的
             option 里放不下按钮**，「每段都能预览」在固定模式下从来就没渲染过
             （主人实测「下拉菜单里找不到预览」即此）。改成与随机池同款的单选行
             列表：行 = 单选圆点 + 名称 + 行尾「预览」，两种模式的预览入口从此
             对称。自动行不挂预览按钮 —— 「自动」没有具体一段可播
             （decideSplash 走随机分支），摆一枚按不动的按钮比没有更迷惑 -->
        <div v-if="splashMats.length" class="pool-list">
          <MiRadio
            class="fix-list"
            :options="splashFileOptions"
            :model-value="settings.config.splash.fixedFile"
            :disabled="splashCtlOff"
            @update:model-value="onSplashFixedChange"
          >
            <template #action="{ option }">
              <button
                v-if="option.value !== ''"
                class="pool-btn"
                @click.stop="openSplashPreviewByName(option.value)"
              >
                {{ SETTINGS.WALL_PREVIEW }}
              </button>
            </template>
          </MiRadio>
        </div>
        <p v-else class="hint">{{ splashPoolEmptyText }}</p>
        <p class="hint">{{ SETTINGS.SPLASH_FIXED_HINT }}</p>
      </template>
      <template v-else>
        <div class="row">
          <span>{{ SETTINGS.LABEL_SPLASH_POOL }}</span>
          <div class="pool-actions">
            <MiButton
              size="sm"
              :disabled="splashCtlOff || !splashMats.length"
              @click="onSplashPoolAll()"
            >
              {{ SETTINGS.POOL_BTN_ALL }}
            </MiButton>
            <MiButton
              size="sm"
              :disabled="splashCtlOff || !splashMats.length"
              @click="onSplashPoolInvert()"
            >
              {{ SETTINGS.POOL_BTN_INVERT }}
            </MiButton>
            <span class="pool-count">
              {{ SETTINGS.POOL_COUNT(splashPoolChecked.size, splashAllNames.length) }}
            </span>
          </div>
        </div>
        <div v-if="splashMats.length" class="pool-list">
          <!-- 行 = 勾选框 + 「预览」小按钮（2026-10-06：开屏动画也要能提前看，
               不用每次启动应用去试）。预览按钮不受 splashCtlOff 影响 —— 看片
               不改变随机池，关着也该能预览 -->
          <div v-for="m in splashMats" :key="m.name" class="pool-row">
            <MiCheckbox
              :model-value="splashPoolChecked.has(m.name)"
              :label="m.name"
              :disabled="splashCtlOff"
              @update:model-value="(v: boolean) => onSplashPoolToggle(m.name, v)"
            />
            <button class="pool-btn" @click="openSplashPreview(m)">
              {{ SETTINGS.WALL_PREVIEW }}
            </button>
          </div>
        </div>
        <p v-else class="hint">{{ splashPoolEmptyText }}</p>
        <p class="hint">{{ SETTINGS.SPLASH_POOL_HINT }}</p>
      </template>
      <div class="row">
        <span>{{ SETTINGS.LABEL_SPLASH_IMPORT }}</span>
        <MiButton size="sm" :loading="splashImporting" @click="importSplashVideo">
          {{ SETTINGS.SPLASH_BTN_IMPORT }}
        </MiButton>
      </div>
      <p class="hint">{{ SETTINGS.SPLASH_IMPORT_HINT }}</p>
    </div>

    <!--
      桌宠卡片（2026-10-06 换 dsh-pet 桌面引擎）。
      三个旋钮全走 config.pet（v17 新增的块：开关 / 体型 / 落点角落）——引擎
      （主进程 dshpet 宿主）自己盯着这份配置，写盘即重载，所以这张卡不碰任何
      pet:xxx IPC，也不从任何镜像快照读状态；旧「大肥鱼」的状态/喂饭/模式行
      随旧引擎一起删除。
    -->
    <div class="card">
      <div class="env-head">
        <div class="env-title-wrap">
          <span class="env-title">{{ SETTINGS.PET_CARD_TITLE }}</span>
        </div>
      </div>
      <div class="row">
        <span>{{ SETTINGS.PET_LABEL_ENABLED }}</span>
        <!-- @mouseenter 落在 MiSwitch 根 label 上（fallthrough）：悬停开关 = 本鱼挽留（onPetPleadHover） -->
        <MiSwitch
          :model-value="settings.config.pet.enabled"
          @update:model-value="settings.config.pet.enabled = $event; onPetEnabledChange()"
          @mouseenter="onPetPleadHover"
        />
      </div>
      <p class="hint">{{ SETTINGS.PET_ENABLED_HINT }}</p>

      <div class="row">
        <span>{{ SETTINGS.PET_LABEL_SIZE }}</span>
        <div class="vol-wrap">
          <input
            v-model.number="settings.config.pet.size"
            type="range"
            :min="PET_SIZE_MIN"
            :max="PET_SIZE_MAX"
            step="1"
            class="vol-range"
            :disabled="!settings.config.pet.enabled"
            :aria-label="SETTINGS.PET_LABEL_SIZE"
            @change="onPetSizeChange"
          />
          <!-- 数字**实时**跟着拖（绑同一个 v-model，同音量滑杆）：松手才跳的话，
               拖的时候就不知道值变没变。 -->
          <span class="vol-pct">{{ SETTINGS.PET_SIZE_VALUE(settings.config.pet.size) }}</span>
        </div>
      </div>
      <p class="hint">{{ SETTINGS.PET_SIZE_HINT }}</p>

      <div class="row">
        <span>{{ SETTINGS.PET_LABEL_CORNER }}</span>
      </div>
      <MiTabs
        :tabs="petCornerTabs"
        :model-value="settings.config.pet.corner"
        :disabled="!settings.config.pet.enabled"
        @update:model-value="onPetCornerPick"
      />
      <p class="hint">{{ SETTINGS.PET_CORNER_HINT }}</p>
      <!-- 两个主动行为开关（2026-10-09 补充模块一③）：与体型/落点同一条口径 ——
           桌宠关着时全灰（pet.enabled 是总闸），写盘即刻生效。 -->
      <div class="row">
        <span>{{ SETTINGS.PET_LABEL_FOLLOW }}</span>
        <MiSwitch
          :model-value="settings.config.pet.followMouse"
          :disabled="!settings.config.pet.enabled"
          @update:model-value="settings.config.pet.followMouse = $event; onPetFollowChange()"
        />
      </div>
      <p class="hint">{{ petFollowHint }}</p>
      <div class="row">
        <span>{{ SETTINGS.PET_LABEL_ROAM }}</span>
        <MiSwitch
          :model-value="settings.config.pet.hungryRoam"
          :disabled="!settings.config.pet.enabled"
          @update:model-value="settings.config.pet.hungryRoam = $event; onPetRoamChange()"
        />
      </div>
      <p class="hint">{{ petRoamHint }}</p>
      <p class="hint">{{ SETTINGS.PET_CHAT_HINT }}</p>
      <!-- AI Key 状态行：桌宠聊天读的是「设置 → AI」那把全局 Key，这里只说
           「你现在处于哪种状态」（有 / 没有），不重复上面那条聊天入口说明。 -->
      <p class="hint">
        {{ settings.config.ai.hasKey ? SETTINGS.PET_AI_KEY_ON : SETTINGS.PET_AI_KEY_OFF }}
      </p>
      <!-- 大肥鱼互动说明（UI 大修轮 2026-10-09；契约 §2.2）：常显不折叠 ——
           主人反馈「用户看不懂这两项数值怎么变化」。数字全部由脚本从
           shared/pet.ts 真源算好、经 copy.ts 函数键传进来；本段正文只许
           {{ }} 插值，一个写死的数字或中文都不留（闸门在扫，pet-guide.test.ts 在盯）。 -->
      <div class="pet-guide">
        <p class="pet-guide-title">{{ SETTINGS.PET_GUIDE_TITLE }}</p>
        <p class="pet-guide-intro">{{ SETTINGS.PET_GUIDE_INTRO }}</p>
        <p class="pet-guide-sub">{{ SETTINGS.PET_GUIDE_AFF_TITLE }}</p>
        <ul class="pet-guide-list">
          <li v-for="line in petGuideAffGain" :key="line">{{ line }}</li>
        </ul>
        <p class="pet-guide-sub">{{ SETTINGS.PET_GUIDE_AFF_DOWN_TITLE }}</p>
        <ul class="pet-guide-list">
          <li v-for="line in petGuideAffDown" :key="line">{{ line }}</li>
        </ul>
        <p class="pet-guide-note">{{ petGuideAffDecay }}</p>
        <p class="pet-guide-sub">{{ SETTINGS.PET_GUIDE_AFF_TIER_TITLE }}</p>
        <ul class="pet-guide-list">
          <li v-for="line in petGuideAffTiers" :key="line">{{ line }}</li>
        </ul>
        <p class="pet-guide-sub">{{ SETTINGS.PET_GUIDE_HUN_TITLE }}</p>
        <ul class="pet-guide-list">
          <li v-for="line in petGuideHunger" :key="line">{{ line }}</li>
        </ul>
        <p class="pet-guide-sub">{{ SETTINGS.PET_GUIDE_TIER_TITLE }}</p>
        <ul class="pet-guide-list">
          <li v-for="line in petGuideTiers" :key="line">{{ line }}</li>
        </ul>
        <p class="pet-guide-note">{{ SETTINGS.PET_GUIDE_NOTE }}</p>
        <p class="pet-guide-note">{{ SETTINGS.PET_GUIDE_FLAGS_NOTE }}</p>
      </div>
      <!-- 【2026-10-06 晚】「关闭大肥鱼」按钮已删：与上面「叫它出来」开关功能完全
           重复（主人裁定留开关）。挽留气泡已搬到开关悬停（onPetPleadHover）；
           copy.ts 的 PET_CLOSE_BTN / PET_CLOSE_HINT 两个键随按钮一起删了，别再往回加。 -->
      <!-- 奖励图覆盖文件夹（2026-10-16，「丢文件即替换」）：只给路径、张数与
           打开入口，不做导入按钮 —— 投料方式就是往文件夹里丢文件。 -->
      <div class="row">
        <span>{{ SETTINGS.REWARD_DIR_LABEL }}</span>
        <MiButton size="sm" :loading="openingRewardDir" @click="openRewardDir">{{ SETTINGS.REWARD_DIR_BTN }}</MiButton>
      </div>
      <p class="hint">{{ SETTINGS.REWARD_DIR_HINT(rewardDirCount, rewardDirPath, rewardIdRange) }}</p>
    </div>

    <!--
      动态壁纸卡片（2026-10-04 第一步；2026-10-05 扩成四页签外观面板；
      2026-10-06 补导入壁纸行 + 轮播池勾选区，配置 v15 加 rotation.pool）。
      面板骨架照开源壁纸引擎的「壁纸外观设置」：壁纸 / 画面 / 播放 / 透视 四页，
      控件一律「页签内的行 + 行下 hint」。分工与滑杆口径见脚本里 wall 那段的注释；
      这里只补三条：
      ① 页签内控件在壁纸关着时全灰（wallCtlOff，同三根老滑块），页签本身保持可点；
      ② 数值必须**实时**跟着拖（拖的时候看不到数就没法确认在变）；
      ③ 区间一律绑 shared 的常量，不给字面量留第二份。
      硬底线（代码块/正文/题目/大肥鱼恒不透明）由静态闸门 wall-glass.test.ts 钉死，
      这里不做任何透明度相关的 inline style。
    -->
    <div class="card wall-card">
      <div class="env-head">
        <div class="env-title-wrap">
          <span class="env-title">{{ SETTINGS.WALL_CARD_TITLE }}</span>
        </div>
      </div>
      <div class="row">
        <span>{{ SETTINGS.LABEL_WALLPAPER }}</span>
        <MiSwitch
          :model-value="settings.config.wallpaper.enabled"
          @update:model-value="settings.config.wallpaper.enabled = $event; onWallpaperChange()"
        />
      </div>
      <p class="hint">{{ SETTINGS.WALLPAPER_HINT }}</p>

      <MiTabs class="wall-tabs" v-model="wallTab" :tabs="wallTabs" />

      <!-- 页签一·壁纸：当前这张 + 切换过场 + 轮播 -->
      <template v-if="wallTab === 'wall'">
        <div class="wall-current">
          <div class="wall-current-line">
            <template v-if="wallCurrent">
              <span class="wall-current-title">{{ wallCurrent.title }}</span>
              <span class="wall-current-badge">{{ SETTINGS.WALL_KIND_NAMES[wallCurrent.type] }}</span>
              <span class="wall-current-state" :class="{ 'is-paused': wallManualPaused }">
                {{ wallStateText }}
              </span>
            </template>
            <span v-else class="wall-current-none">{{ SETTINGS.WALL_NONE_PICKED }}</span>
          </div>
          <div class="wall-current-btns">
            <MiButton size="sm" :disabled="!wallCurrent || wallCtlOff" @click="toggleManualPause()">
              {{ wallManualPaused ? SETTINGS.WALL_BTN_PLAY : SETTINGS.WALL_BTN_PAUSE }}
            </MiButton>
            <!-- 音轨开关不再限 video（2026-10-07 场景 BGM 接线）：场景壁纸也有声音了，
                 与「播放」页签里那只开关的可用条件保持一致（都只看总开关） -->
            <MiButton size="sm" :disabled="!wallCurrent || wallCtlOff" @click="onWallTrackToggle(!wall.trackOn)">
              {{ wall.trackOn ? SETTINGS.WALL_BTN_SOUND_ON : SETTINGS.WALL_BTN_SOUND_OFF }}
            </MiButton>
            <MiButton size="sm" :disabled="wallCtlOff" @click="openWallPicker">
              {{ SETTINGS.WALL_BTN_PICK }}
            </MiButton>
            <MiButton size="sm" :loading="wallCatalogLoading" @click="refreshCatalog()">
              {{ SETTINGS.WALL_BTN_REFRESH }}
            </MiButton>
            <MiButton size="sm" :disabled="!settings.config.wallpaper.selectedId" @click="onWallClear()">
              {{ SETTINGS.WALL_BTN_CLEAR }}
            </MiButton>
          </div>
          <span class="wall-count">{{ SETTINGS.WALL_PICK_COUNT(wallCount) }}</span>
        </div>

        <!-- 导入壁纸（2026-10-06）。**不随壁纸开关变灰**：那是文件操作，
             开关关着也该能先把素材备好；导入成功后「选择壁纸」弹窗里就有它 -->
        <div class="row wall-row-gap">
          <span>{{ SETTINGS.LABEL_WALL_IMPORT }}</span>
          <MiButton size="sm" :loading="wallImporting" @click="importWallpaperFile">
            {{ SETTINGS.WALL_BTN_IMPORT }}
          </MiButton>
        </div>
        <p class="hint">{{ SETTINGS.WALL_IMPORT_HINT }}</p>

        <div class="row wall-row-gap">
          <span>{{ SETTINGS.WALL_TRANSITION_LABEL }}</span>
          <MiSelect
            :options="wallTransitionOptions"
            :model-value="wall.transition"
            :disabled="wallCtlOff"
            @update:model-value="onWallTransitionPick"
          />
        </div>
        <p class="hint">
          {{ wall.transition === 'random'
            ? SETTINGS.WALL_TRANSITION_MS_RANDOM
            : SETTINGS.WALL_TRANSITION_MS(wallSpecMs) }}<br />
          {{ SETTINGS.WALL_TRANSITION_HINT }}
        </p>
        <!-- 方向行只在认方向的过场下出现（切换/速度恒在；抽走了行不留空档） -->
        <div v-if="wallDirRow" class="row">
          <span>{{ SETTINGS.WALL_DIR_LABEL }}</span>
          <MiTabs
            :tabs="wallDirTabs"
            :model-value="wall.transitionDir"
            :disabled="wallCtlOff"
            @update:model-value="onWallDirPick"
          />
        </div>
        <p v-if="wallDirRow" class="hint">{{ SETTINGS.WALL_DIR_HINT }}</p>
        <div class="row">
          <span>{{ SETTINGS.WALL_SPEED_LABEL }}</span>
          <MiTabs
            :tabs="wallSpeedTabs"
            :model-value="String(wall.transitionSpeed)"
            :disabled="wallCtlOff"
            @update:model-value="onWallSpeedPick"
          />
        </div>
        <p class="hint">{{ SETTINGS.WALL_SPEED_HINT }}</p>

        <div class="wall-sec">{{ SETTINGS.WALL_ROTATION_TITLE }}</div>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_ROTATION }}</span>
          <MiSwitch
            :model-value="wall.rotation.enabled"
            :disabled="wallCtlOff"
            @update:model-value="wall.rotation.enabled = $event; onWallRotationChange()"
          />
        </div>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_ROTATION_INTERVAL }}</span>
          <div class="vol-wrap">
            <input
              v-model.number="wall.rotation.intervalMin"
              type="range"
              :min="ROTATION_INTERVAL_MIN"
              :max="ROTATION_INTERVAL_MAX"
              step="1"
              class="vol-range"
              :disabled="wallCtlOff || !wall.rotation.enabled"
              :aria-label="SETTINGS.LABEL_WALL_ROTATION_INTERVAL"
              @change="onWallRotationChange()"
            />
            <span class="vol-pct">{{ wall.rotation.intervalMin }}</span>
          </div>
        </div>
        <div class="row">
          <span>{{ SETTINGS.WALL_ROTATION_ORDER_LABEL }}</span>
          <MiTabs
            :tabs="wallOrderTabs"
            :model-value="wall.rotation.order"
            :disabled="wallCtlOff || !wall.rotation.enabled"
            @update:model-value="onWallOrderPick"
          />
        </div>
        <p class="hint">{{ SETTINGS.WALL_ROTATION_HINT }}</p>

        <!-- 轮播池（2026-10-06，v15）。列表只列可渲染条目（与壁纸层的判据同一份）；
             轮播关着/总开关关着时整区变灰 —— 同间隔、顺序两行的口径。
             池代数（含「最后一个点不掉」）在 shared/media-pool.ts，开屏池共用 -->
        <div class="row wall-row-gap">
          <span>{{ SETTINGS.LABEL_WALL_POOL }}</span>
          <div class="pool-actions">
            <MiButton
              size="sm"
              :disabled="wallCtlOff || !wall.rotation.enabled || !wallPoolCandidates.length"
              @click="onWallPoolAll()"
            >
              {{ SETTINGS.POOL_BTN_ALL }}
            </MiButton>
            <MiButton
              size="sm"
              :disabled="wallCtlOff || !wall.rotation.enabled || !wallPoolCandidates.length"
              @click="onWallPoolInvert()"
            >
              {{ SETTINGS.POOL_BTN_INVERT }}
            </MiButton>
            <span class="pool-count">
              {{ SETTINGS.POOL_COUNT(wallPoolChecked.size, wallPoolAllIds.length) }}
            </span>
          </div>
        </div>
        <div v-if="wallPoolCandidates.length" class="pool-list">
          <!-- 行 = 勾选框 + 「预览」+ 「隐藏/取消隐藏」（2026-10-06）。
               隐藏按钮**不随壁纸开关变灰**：藏一张壁纸是库管理操作，
               和「现在放不放」无关。预览按钮只在真有可预览的东西时出现 -->
          <div v-for="it in wallPoolCandidates" :key="it.id" class="pool-row">
            <MiCheckbox
              :model-value="wallPoolChecked.has(it.id)"
              :label="wallPoolLabel(it)"
              :disabled="wallCtlOff || !wall.rotation.enabled"
              @update:model-value="(v: boolean) => onWallPoolToggle(it.id, v)"
            />
            <button v-if="canPreviewWall(it)" class="pool-btn" @click="openWallPreview(it)">
              {{ SETTINGS.WALL_PREVIEW }}
            </button>
            <button class="pool-btn" @click="onWallHideToggle(it.id)">
              {{ wallHiddenSet.has(it.id) ? SETTINGS.WALL_UNHIDE : SETTINGS.WALL_HIDE }}
            </button>
          </div>
        </div>
        <p class="hint">{{ SETTINGS.WALL_POOL_HINT }}</p>
        <p class="hint">{{ SETTINGS.WALL_HIDE_HINT }}</p>
        <!-- 「显示隐藏项目」全局开关（v16）：藏在列表里的条目去哪找。
             放在池子区末尾而不是页脚：它只管壁纸这一件事，跟着管它的列表走 -->
        <div class="row wall-row-gap">
          <span>{{ SETTINGS.LABEL_WALL_SHOW_HIDDEN }}</span>
          <MiSwitch
            :model-value="wallHidden.showHidden"
            @update:model-value="wallHidden.setShowHidden($event)"
          />
        </div>
        <p class="hint">{{ SETTINGS.WALL_SHOW_HIDDEN_HINT }}</p>
      </template>

      <!-- 页签二·画面：画面本身压暗/模糊/偏色 + 透明度/适配/翻转 + 界面玻璃 -->
      <template v-if="wallTab === 'screen'">
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_DIM }}</span>
          <div class="vol-wrap">
            <input
              v-model.number="wall.dim"
              type="range"
              :min="DIM_MIN"
              :max="DIM_MAX"
              step="1"
              class="vol-range"
              :disabled="wallCtlOff"
              :aria-label="SETTINGS.LABEL_WALL_DIM"
              @change="onWallPatch({ dim: wall.dim })"
            />
            <span class="vol-pct">{{ wall.dim }}%</span>
          </div>
        </div>
        <p class="hint">{{ SETTINGS.WALL_DIM_HINT }}</p>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_BLUR }}</span>
          <div class="vol-wrap">
            <input
              v-model.number="wall.blur"
              type="range"
              :min="BLUR_MIN"
              :max="BLUR_MAX"
              step="1"
              class="vol-range"
              :disabled="wallCtlOff"
              :aria-label="SETTINGS.LABEL_WALL_BLUR"
              @change="onWallPatch({ blur: wall.blur })"
            />
            <span class="vol-pct">{{ wall.blur }}</span>
          </div>
        </div>
        <p class="hint">{{ SETTINGS.WALL_BLUR_HINT }}</p>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_BRIGHTNESS }}</span>
          <div class="vol-wrap">
            <input
              v-model.number="wall.brightness"
              type="range"
              :min="MEDIA_ADJUST_MIN"
              :max="MEDIA_ADJUST_MAX"
              step="0.05"
              class="vol-range"
              :disabled="wallCtlOff"
              :aria-label="SETTINGS.LABEL_WALL_BRIGHTNESS"
              @change="onWallPatch({ brightness: wall.brightness })"
            />
            <span class="vol-pct">{{ pct(wall.brightness) }}%</span>
          </div>
        </div>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_CONTRAST }}</span>
          <div class="vol-wrap">
            <input
              v-model.number="wall.contrast"
              type="range"
              :min="MEDIA_ADJUST_MIN"
              :max="MEDIA_ADJUST_MAX"
              step="0.05"
              class="vol-range"
              :disabled="wallCtlOff"
              :aria-label="SETTINGS.LABEL_WALL_CONTRAST"
              @change="onWallPatch({ contrast: wall.contrast })"
            />
            <span class="vol-pct">{{ pct(wall.contrast) }}%</span>
          </div>
        </div>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_SATURATE }}</span>
          <div class="vol-wrap">
            <input
              v-model.number="wall.saturate"
              type="range"
              :min="MEDIA_ADJUST_MIN"
              :max="MEDIA_ADJUST_MAX"
              step="0.05"
              class="vol-range"
              :disabled="wallCtlOff"
              :aria-label="SETTINGS.LABEL_WALL_SATURATE"
              @change="onWallPatch({ saturate: wall.saturate })"
            />
            <span class="vol-pct">{{ pct(wall.saturate) }}%</span>
          </div>
        </div>
        <p class="hint">{{ SETTINGS.WALL_ADJUST_HINT }}</p>
        <!-- 透明度滑杆是「显示域 ≠ 存储域」的一根（90 = 画面留 10%，见脚本注释），
             所以走 :value + @input 的换算写法，不能用 v-model 直连 opacity -->
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_MEDIA_OPACITY }}</span>
          <div class="vol-wrap">
            <input
              type="range"
              :min="0"
              :max="WALL_MEDIA_OPACITY_UI_MAX"
              step="1"
              class="vol-range"
              :disabled="wallCtlOff"
              :aria-label="SETTINGS.LABEL_WALL_MEDIA_OPACITY"
              :value="wallOpacityUi"
              @input="onWallOpacitySlide"
              @change="onWallPatch({ opacity: wall.opacity })"
            />
            <span class="vol-pct">{{ wallOpacityUi }}%</span>
          </div>
        </div>
        <p class="hint">{{ SETTINGS.WALL_MEDIA_OPACITY_HINT }}</p>
        <div class="row">
          <span>{{ SETTINGS.WALL_FIT_LABEL }}</span>
          <MiTabs
            :tabs="wallFitTabs"
            :model-value="wall.objectFit"
            :disabled="wallCtlOff"
            @update:model-value="onWallFitPick"
          />
        </div>
        <p class="hint">{{ SETTINGS.WALL_FIT_HINT }}</p>
        <div class="row">
          <span>{{ SETTINGS.WALL_FLIP_LABEL }}</span>
          <MiSwitch
            :model-value="wall.flip"
            :disabled="wallCtlOff"
            @update:model-value="wall.flip = $event; onWallPatch({ flip: wall.flip })"
          />
        </div>
        <p class="hint">{{ SETTINGS.WALL_FLIP_HINT }}</p>

        <div class="wall-sec">{{ SETTINGS.WALL_SCENE_SECTION }}</div>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_SCENE_FPS }}</span>
          <MiTabs
            :tabs="wallSceneFpsTabs"
            :model-value="String(wall.sceneFps)"
            :disabled="wallCtlOff"
            @update:model-value="onWallSceneFpsPick"
          />
        </div>
        <p class="hint">{{ SETTINGS.WALL_SCENE_FPS_HINT }}</p>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_QUALITY }}</span>
          <MiTabs
            :tabs="wallQualityTabs"
            :model-value="wall.quality"
            :disabled="wallCtlOff"
            @update:model-value="onWallQualityPick"
          />
        </div>
        <p class="hint">{{ SETTINGS.WALL_QUALITY_HINT }}</p>

        <div class="wall-sec">{{ SETTINGS.WALL_GLASS_SECTION }}</div>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_PANEL_ALPHA }}</span>
          <div class="vol-wrap">
            <input
              type="range"
              :min="WALL_PANEL_ALPHA_MIN"
              :max="WALL_PANEL_ALPHA_MAX"
              step="1"
              class="vol-range"
              :disabled="wallCtlOff"
              :aria-label="SETTINGS.LABEL_WALL_PANEL_ALPHA"
              :value="wallUiActive.panelAlpha"
              @input="onPanelAlphaSlide"
            />
            <span class="vol-pct">{{ wallUiActive.panelAlpha }}%</span>
          </div>
        </div>
        <p class="hint">{{ SETTINGS.WALL_PANEL_ALPHA_HINT }}</p>
        <!-- V1-58（主人裁定「提示但允许调到 0」）：拐点以下面板的棱和厚度
             会跟着一起淡出，这里说一声"接近全透"的代价。阈值 = 材料淡出
             拐点（WALL_MATERIAL_FADE_KNEE）—— 同一根线只写一份，出厂默认
             40/65 都在线之上，正常使用不会看到这条。**不钳位**：拖到 0
             仍是合法操作（主人 2026-10-16 口径：调到 0 就是为了全隐藏）。 -->
        <p v-if="wallUiActive.panelAlpha < WALL_MATERIAL_FADE_KNEE" class="hint hint-warn">
          {{ SETTINGS.WALL_ALPHA_TRANSPARENT_WARN }}
        </p>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_VEIL }}</span>
          <div class="vol-wrap">
            <input
              type="range"
              :min="WALL_VEIL_MIN"
              :max="WALL_VEIL_MAX"
              step="1"
              class="vol-range"
              :disabled="wallCtlOff"
              :aria-label="SETTINGS.LABEL_WALL_VEIL"
              :value="wallUiActive.veil"
              @input="onWallVeilSlide"
            />
            <span class="vol-pct">{{ wallUiActive.veil }}%</span>
          </div>
        </div>
        <p class="hint">{{ SETTINGS.WALL_VEIL_HINT }}</p>

        <!-- 液态玻璃（2026-10-08，需求⑧）。**两组分开**，因为生效条件不同：
             上面一组拨的是 SVG 滤镜链（lib/glass/，折射开关关掉时它们没有
             任何消费者，所以跟着灰）；阴影扩散是面板自己的 CSS 厚度
             （wallpaper.css 的那几条 inset），只看壁纸总开关。合成一组
             会让用户以为「关了折射，那块厚度也没了」。
             灰但不藏：藏起来页面会跳，而且用户就再也发现不了还有这些可调。 -->
        <div class="wall-sec">{{ SETTINGS.WALL_GLASS_LENS_SECTION }}</div>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_GLASS_REFRACT }}</span>
          <MiSwitch
            :model-value="glass.refract"
            :disabled="wallCtlOff"
            @update:model-value="onGlassRefract"
          />
        </div>
        <p class="hint">{{ SETTINGS.WALL_GLASS_REFRACT_HINT }}</p>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_GLASS_STRENGTH }}</span>
          <div class="vol-wrap">
            <input
              type="range"
              :min="WALL_GLASS_STRENGTH_MIN"
              :max="WALL_GLASS_STRENGTH_MAX"
              step="1"
              class="vol-range"
              :disabled="glassLensOff"
              :aria-label="SETTINGS.LABEL_WALL_GLASS_STRENGTH"
              :value="glass.strength"
              @input="onGlassStrengthSlide"
            />
            <span class="vol-pct">{{ glass.strength }}</span>
          </div>
        </div>
        <p class="hint">{{ SETTINGS.WALL_GLASS_STRENGTH_HINT }}</p>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_GLASS_RING }}</span>
          <div class="vol-wrap">
            <input
              type="range"
              :min="WALL_GLASS_RING_MIN"
              :max="WALL_GLASS_RING_MAX"
              step="1"
              class="vol-range"
              :disabled="glassLensOff"
              :aria-label="SETTINGS.LABEL_WALL_GLASS_RING"
              :value="glass.ring"
              @input="onGlassRingSlide"
            />
            <span class="vol-pct">{{ glass.ring }}</span>
          </div>
        </div>
        <p class="hint">{{ SETTINGS.WALL_GLASS_RING_HINT }}</p>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_GLASS_BLUR }}</span>
          <div class="vol-wrap">
            <input
              type="range"
              :min="WALL_GLASS_BLUR_MIN"
              :max="WALL_GLASS_BLUR_MAX"
              step="1"
              class="vol-range"
              :disabled="glassLensOff"
              :aria-label="SETTINGS.LABEL_WALL_GLASS_BLUR"
              :value="glass.blur"
              @input="onGlassBlurSlide"
            />
            <span class="vol-pct">{{ glass.blur }}</span>
          </div>
        </div>
        <p class="hint">{{ SETTINGS.WALL_GLASS_BLUR_HINT }}</p>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_GLASS_FLOW }}</span>
          <div class="vol-wrap">
            <input
              type="range"
              :min="WALL_GLASS_FLOW_MIN"
              :max="WALL_GLASS_FLOW_MAX"
              step="1"
              class="vol-range"
              :disabled="glassLensOff"
              :aria-label="SETTINGS.LABEL_WALL_GLASS_FLOW"
              :value="glass.flow"
              @input="onGlassFlowSlide"
            />
            <span class="vol-pct">{{ glass.flow }}%</span>
          </div>
        </div>
        <p class="hint">{{ SETTINGS.WALL_GLASS_FLOW_HINT }}</p>

        <div class="wall-sec">{{ SETTINGS.WALL_GLASS_MAT_SECTION }}</div>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_GLASS_SHADOW }}</span>
          <div class="vol-wrap">
            <input
              type="range"
              :min="WALL_GLASS_SHADOW_MIN"
              :max="WALL_GLASS_SHADOW_MAX"
              step="1"
              class="vol-range"
              :disabled="wallCtlOff"
              :aria-label="SETTINGS.LABEL_WALL_GLASS_SHADOW"
              :value="glass.shadow"
              @input="onGlassShadowSlide"
            />
            <span class="vol-pct">{{ glass.shadow }}</span>
          </div>
        </div>
        <p class="hint">{{ SETTINGS.WALL_GLASS_SHADOW_HINT }}</p>

        <!-- 面板底色（2026-10-07 个性化）：这两只控件**不随 wallCtlOff 灰** ——
             它和壁纸开关无关，壁纸关着时卡片/侧栏/顶条也吃这个色，一直生效。
             取色值走 :value + @input（真源在 store，同上面两根滑杆的形状） -->
        <div class="wall-sec">{{ SETTINGS.WALL_COLOR_SECTION }}</div>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_PANEL_COLOR }}</span>
          <div class="wall-color-wrap">
            <input
              type="color"
              class="wall-color"
              :aria-label="SETTINGS.LABEL_WALL_PANEL_COLOR"
              :value="panelColorShown"
              @input="onPanelColorInput"
            />
            <button
              type="button"
              class="wall-color-reset"
              :disabled="!wallUiActive.panelColor"
              @click="onPanelColorReset"
            >
              {{ SETTINGS.WALL_PROPS_RESET }}
            </button>
          </div>
        </div>
        <p class="hint">{{ SETTINGS.WALL_PANEL_COLOR_HINT }}</p>
      </template>

      <!-- 页签三·播放：声音 + 倍速 + 省电暂停 -->
      <template v-if="wallTab === 'play'">
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_VOLUME }}</span>
          <div class="vol-wrap">
            <input
              v-model.number="wall.volume"
              type="range"
              :min="VOLUME_MIN"
              :max="VOLUME_MAX"
              step="5"
              class="vol-range"
              :disabled="wallCtlOff"
              :aria-label="SETTINGS.LABEL_WALL_VOLUME"
              @change="onWallPatch({ volume: wall.volume })"
            />
            <span class="vol-pct">{{ wall.volume }}%</span>
          </div>
        </div>
        <p class="hint">{{ SETTINGS.WALL_VOLUME_HINT }}</p>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_TRACK }}</span>
          <MiSwitch
            :model-value="wall.trackOn"
            :disabled="wallCtlOff"
            @update:model-value="onWallTrackToggle($event)"
          />
        </div>
        <p class="hint">{{ SETTINGS.WALL_TRACK_HINT }}</p>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_RATE }}</span>
          <MiTabs
            :tabs="wallRateTabs"
            :model-value="String(wall.playbackRate)"
            :disabled="wallCtlOff"
            @update:model-value="onWallRatePick"
          />
        </div>
        <p class="hint">{{ SETTINGS.WALL_RATE_HINT }}</p>

        <div class="wall-sec">{{ SETTINGS.WALL_AUDIO_TITLE }}</div>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_AUDIO }}</span>
          <MiSwitch
            :model-value="wall.audio.enabled"
            :disabled="wallCtlOff"
            @update:model-value="onWallAudioToggle($event)"
          />
        </div>
        <p class="hint">{{ SETTINGS.WALL_AUDIO_HINT }}</p>

        <div class="wall-sec">{{ SETTINGS.WALL_POWER_TITLE }}</div>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_PAUSE_MIN }}</span>
          <MiSwitch
            :model-value="wall.power.pauseOnMinimize"
            :disabled="wallCtlOff"
            @update:model-value="wall.power.pauseOnMinimize = $event; onWallPowerChange()"
          />
        </div>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_PAUSE_BLUR }}</span>
          <MiSwitch
            :model-value="wall.power.pauseOnBlur"
            :disabled="wallCtlOff"
            @update:model-value="wall.power.pauseOnBlur = $event; onWallPowerChange()"
          />
        </div>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_PAUSE_BATTERY }}</span>
          <MiSwitch
            :model-value="wall.power.pauseOnBattery"
            :disabled="wallCtlOff"
            @update:model-value="wall.power.pauseOnBattery = $event; onWallPowerChange()"
          />
        </div>
        <p class="hint">{{ SETTINGS.WALL_POWER_HINT }}</p>
      </template>

      <!-- 页签四·透视：鼠标视差 -->
      <template v-if="wallTab === 'parallax'">
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_PARALLAX }}</span>
          <MiSwitch
            :model-value="wall.parallax.enabled"
            :disabled="wallCtlOff"
            @update:model-value="wall.parallax.enabled = $event; onWallParallaxChange()"
          />
        </div>
        <p class="hint">{{ SETTINGS.WALL_PARALLAX_HINT }}</p>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_PARALLAX_AMOUNT }}</span>
          <div class="vol-wrap">
            <input
              v-model.number="wall.parallax.amount"
              type="range"
              :min="PARALLAX_AMOUNT_MIN"
              :max="PARALLAX_AMOUNT_MAX"
              step="1"
              class="vol-range"
              :disabled="wallCtlOff || !wall.parallax.enabled"
              :aria-label="SETTINGS.LABEL_WALL_PARALLAX_AMOUNT"
              @change="onWallParallaxChange()"
            />
            <span class="vol-pct">{{ wall.parallax.amount }}</span>
          </div>
        </div>
        <p class="hint">{{ SETTINGS.WALL_PARALLAX_AMOUNT_HINT }}</p>
        <div class="row">
          <span>{{ SETTINGS.LABEL_WALL_PARALLAX_SMOOTH }}</span>
          <div class="vol-wrap">
            <input
              v-model.number="wall.parallax.smooth"
              type="range"
              :min="PARALLAX_SMOOTH_MIN"
              :max="PARALLAX_SMOOTH_MAX"
              step="1"
              class="vol-range"
              :disabled="wallCtlOff || !wall.parallax.enabled"
              :aria-label="SETTINGS.LABEL_WALL_PARALLAX_SMOOTH"
              @change="onWallParallaxChange()"
            />
            <span class="vol-pct">{{ wall.parallax.smooth }}</span>
          </div>
        </div>
        <p class="hint">{{ SETTINGS.WALL_PARALLAX_SMOOTH_HINT }}</p>
      </template>

      <!-- 页签五·壁纸属性：A 段 = 作者自带属性（project.json 解析），B 段 = 本张微调（叠加在全局之上） -->
      <template v-if="wallTab === 'props'">
        <WallpaperPropsPanel />
      </template>

      <WallpaperPickerModal
        v-model:visible="wallPickerOpen"
        :selected-id="settings.config.wallpaper.selectedId"
        :hidden="settings.config.wallpaper.hidden"
        :show-hidden="wallHidden.showHidden"
        @pick="onWallPick"
        @toggle-hide="onWallHideToggle"
        @toggle-show-hidden="wallHidden.toggleShowHidden()"
      />

      <!-- 预览悬浮卡：壁纸池与开屏池共用这一个实例（同一时刻至多开一个） -->
      <MediaPreviewModal
        :visible="preview !== null"
        :src="preview?.url ?? ''"
        :kind="preview?.kind ?? 'image'"
        :title="preview?.title ?? ''"
        :note="previewNote"
        @update:visible="preview = null"
      />
    </div>

    <div class="card ai-card">
      <div class="env-head">
        <div class="env-title-wrap">
          <!-- 大肥鱼头像（2026-10-06 主人点名）：顶替原来标题文案里那只 🐱。
               xs 档 = 32px，走 mascot.ts 的半身图规则取 think-head_01.png
               （托腮思考 —— 和「AI 想问题」语义对齐）。点一下照样叫一声
               （MiMascot 自带的 data-sfx="quack"）。 -->
          <MiMascot pose="think" size="xs" />
          <span class="env-title">{{ SETTINGS.AI_CARD_TITLE }}</span>
          <!-- 状态标签：它只说「配没配」，不说「能不能用」。
               能不能用由下面的「测试连接」回答 —— 两者别混，否则
               用户会以为标签是绿的就没问题。 -->
          <span :class="['ai-status', settings.config.ai.hasKey ? 'is-on' : 'is-off']">
            {{ settings.config.ai.hasKey ? SETTINGS.AI_STATUS_ON : SETTINGS.AI_STATUS_OFF }}
          </span>
        </div>
      </div>

      <div class="row">
        <!-- 「在哪拿」放在**标签正下方**，不是另起一行。
             另起一行的话它会掉到这一行的下边框下面去，看着像在说下一行的
             「服务地址」—— 一条说明文字指向了错误的输入框，比没有还糟。 -->
        <div class="ai-label-col">
          <span>{{ SETTINGS.AI_LABEL_KEY }}</span>
          <span class="hint ai-hint">{{ SETTINGS.AI_KEY_WHERE }}</span>
        </div>
        <div class="ai-key-wrap">
          <input
            v-model="keyInput"
            :type="showKey ? 'text' : 'password'"
            :placeholder="keyPlaceholder"
            autocomplete="off"
            spellcheck="false"
          />
          <!-- 默认藏起来（旁边可能有人），但必须能点开看 ——
               零基础用户复制 Key 时最容易多带一个空格或漏掉尾巴，
               看不见就没法自己发现。 -->
          <MiButton size="sm" variant="ghost" @click="showKey = !showKey">
            {{ showKey ? ACTION.HIDE_KEY : ACTION.SHOW_KEY }}
          </MiButton>
        </div>
      </div>

      <div class="row">
        <span>{{ SETTINGS.AI_LABEL_BASE_URL }}</span>
        <input
          v-model="settings.config.ai.baseUrl"
          type="text"
          spellcheck="false"
          @change="settings.updateAi({ baseUrl: settings.config.ai.baseUrl })"
        />
      </div>
      <div class="row">
        <span>{{ SETTINGS.AI_LABEL_MODEL }}</span>
        <input
          v-model="settings.config.ai.model"
          type="text"
          spellcheck="false"
          @change="settings.updateAi({ model: settings.config.ai.model })"
        />
      </div>

      <!-- AI 动态出题总开关（2026-10-21，默认关）。
           **默认必须是关的**：老配置里没有这个字段，迁移与合并都按 `=== true`
           判，只有用户自己拨开才会开始花 Token。说明紧跟开关 —— 用户是在这一下
           做决定的，别把「会花钱」藏到卡片底部。 -->
      <div class="row">
        <span>{{ SETTINGS.AI_LABEL_DYNAMIC }}</span>
        <MiSwitch
          :model-value="settings.config.ai.dynamicEnabled === true"
          @update:model-value="
            settings.config.ai.dynamicEnabled = $event;
            settings.updateAi({ dynamicEnabled: $event })
          "
        />
      </div>
      <p class="hint ai-hint">{{ SETTINGS.AI_DYNAMIC_HINT }}</p>

      <div class="ai-actions">
        <MiButton :loading="testing" @click="saveAndTest">
          {{ ACTION.SAVE_AND_TEST }}
        </MiButton>
        <!-- V2-09：先开确认框，不在这一下里真删（删除逻辑在同名函数里） -->
        <MiButton
          variant="danger"
          :disabled="!settings.config.ai.hasKey || testing"
          @click="clearKeyVisible = true"
        >
          {{ ACTION.CLEAR_KEY }}
        </MiButton>
        <span v-if="testing" class="ai-testing">{{ LOADING.TESTING_CONNECTION }}</span>
      </div>

      <p v-if="testResult" :class="['ai-result', testResult.ok ? 'is-ok' : 'is-bad']">
        {{ testResult.text }}
        <!-- 详情单独一行、灰字。给能看懂的人留线索 ——
             「Key 明明是对的怎么还说不对」这种问题，只有这段能查。 -->
        <span v-if="testResult.detail" class="ai-detail">
          {{ SETTINGS.AI_DETAIL_PREFIX }}{{ testResult.detail }}
        </span>
      </p>

      <!-- 隐私说明放最后：用户读完上面那些才知道自己在权衡什么。
           放最上面的话，还没搞清这是什么就被一段声明拦住，只会跳过去。 -->
      <p class="hint ai-privacy">{{ SETTINGS.AI_PRIVACY }}</p>
    </div>

    <div class="card env-card">
      <div class="env-head">
        <div class="env-title-wrap">
          <!-- 检测中才出现：docs/04 §6.2 #5 那个「忙碌」姿态，让等待有个人在 -->
          <MiMascot v-if="settings.detecting" pose="busy" size="s" />
          <span class="env-title">{{ SETTINGS.ENV_CARD_TITLE }}</span>
        </div>
        <MiButton
          size="sm"
          variant="secondary"
          :loading="settings.detecting"
          @click="settings.detectEnv()"
        >
          {{ ACTION.REDETECT }}
        </MiButton>
      </div>
      <div v-for="lang in LANGS" :key="lang" class="env-row-wrap">
        <div class="env-row">
          <span class="env-lang">{{ LANG_LABEL[lang] }}</span>
          <!-- ⚠️ `detecting` **必须**排在 `found` 前面，顺序不能换。
               反过来的话，点「重新检测」之后旧结论还挂在屏幕上：本来打 ✓ 的那几门
               继续显示 ✓（编译探针要跑一两秒），本来打 ✗ 的显示「检测中…」——
               同一张卡上两种状态并存，看上去就是「点了没反应」。
               而主人要的「重新检测必须真刷新」，第一眼看的正是这里：
               旧结论得先让位。清空的只是**屏幕上的显示**，config 里的缓存
               等新报告回来才整体替换 —— 中途失败也不会毁掉手里那份好数据。 -->
          <span v-if="settings.detecting" class="env-checking">{{ LOADING.DETECTING_ENV }}</span>
          <span v-else-if="envInfo(lang)?.found" class="env-ok">{{ ENV.found(envInfo(lang)!.version ?? '') }}</span>
          <span v-else class="env-miss">{{ ENV.MISSING }}</span>
        </div>
        <!-- 没找到时必须给一条照着做就能解决的出路。
             只说「没找到」的话，用户不知道缺的是什么、去哪装，
             最后撞在运行时的「没有翻译官」上，前后两句话对不上。 -->
        <p v-if="!settings.detecting && !envInfo(lang)?.found" class="env-fix">
          {{ ENV.MISSING_HINT[lang] }}
        </p>
      </div>
      <p v-if="settings.config.envCache.at" class="hint">
        {{ ENV.lastChecked(new Date(settings.config.envCache.at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })) }}
      </p>
    </div>

    <!-- 检测到多个/平手时的选择框（关框由弹窗自己发 update:visible，见该组件注释） -->
    <IdePickerModal
      :visible="pickerOpen"
      :candidates="pickerList"
      :lang="pickerLang"
      :hint="pickerHint"
      :recommended-path="pickerRecommended"
      @update:visible="pickerOpen = $event"
      @pick="onPickerPick"
    />

    <!-- 清 Key 的二次确认（V2-09；结构与措辞照 MemoView 的删除确认框） -->
    <MiModal v-model:visible="clearKeyVisible" :title="ACTION.CLEAR_KEY_TITLE">
      <p class="ai-clear-body">{{ ACTION.CLEAR_KEY_BODY }}</p>
      <template #footer>
        <MiButton variant="secondary" @click="clearKeyVisible = false">
          {{ ACTION.CLEAR_KEY_CANCEL }}
        </MiButton>
        <MiButton variant="danger" :loading="clearingKey" @click="clearKey">{{ ACTION.CLEAR_KEY }}</MiButton>
      </template>
    </MiModal>
  </div>
</template>

<style scoped>
.page {
  max-width: 760px;
  margin: 0 auto;
}
.page-title {
  font-family: var(--mi-font-title);
  font-size: 20px;
  margin-bottom: 16px;
}
.card {
  padding: 20px;
  /* glass 令牌：壁纸关时逐字节同 --mi-card；开时按 --mi-panel-alpha 稀释 */
  background: var(--mi-card-glass);
  border-radius: var(--mi-radius);
  box-shadow: var(--mi-shadow);
}
/* 桌宠菜单「一键直达」的落地高亮：滚到目标卡后闪一圈蓝边再褪去
   （只动 box-shadow，不动 opacity —— "字与卡片永远不透明"那条底线不碰） */
.card-flash {
  animation: card-flash 1.8s ease;
}
@keyframes card-flash {
  0% {
    box-shadow: 0 0 0 3px rgba(122, 170, 255, 0.95);
  }
  65% {
    box-shadow: 0 0 0 3px rgba(122, 170, 255, 0.35);
  }
  100% {
    box-shadow: var(--mi-shadow);
  }
}
.env-card {
  margin-top: 16px;
}
.wall-card {
  margin-top: 16px;
}
.ai-card {
  margin-top: 16px;
}
.ai-status {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 10px;
}
.ai-status.is-on {
  color: var(--mi-success-deep);
  background: var(--mi-bg);
}
.ai-status.is-off {
  color: var(--mi-text-3);
  background: var(--mi-bg);
}
.ai-key-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  /*
   * `min-width: 0` 是「允许这一行被压窄」的开关。
   * flex 子项默认 `min-width: auto`，会被自己的内容顶住 ——
   * 不写这一条的话，下面那个可伸缩的输入框永远轮不到收缩，
   * 整行照样顶出内容区。
   */
  min-width: 0;
}
/*
 * 「显示 / 隐藏」按钮不许被输入框挤扁。
 *
 * 【原来的毛病】上面那个输入框是 `flex: 0 1 300px` —— **可以收缩**；
 * 而按钮作为 flex 子项默认也是 `flex-shrink: 1`，于是两个一起按比例缩。
 * 这一行的可用宽度只剩 218px 时，按钮被压到 **39px**（原本约 50px），
 * 装不下「显示」两个字，`white-space: normal` 就把它折成了上下两行，
 * 看着像个压扁的方块，不像个按钮。
 *
 * 【为什么是 `flex: none` 而不是给按钮写死宽度】
 * 写死宽度会把上面注释里那个缩放问题（150%/200% 顶出内容区）重新引回来。
 * `flex: none` 只表达「按钮保持自己该有的宽度」，剩下的宽度照样让输入框去伸缩 ——
 * 放得下仍是原样，放不下时收缩的是输入框，而输入框本来就写了 `min-width: 0`。
 * `white-space: nowrap` 是第二道保险：万一将来哪儿又把它压窄，
 * 它宁可自己撑开，也不能把按钮文字折成两行。
 */
.ai-key-wrap :deep(.mi-btn) {
  flex: none;
  white-space: nowrap;
}
.ai-card input[type='text'],
.ai-card input[type='password'] {
  /*
   * 【为什么不是 `width: 300px`】
   * 300px 是「舒服的宽度」，不是「必须占满」。写死成不可收缩的话，
   * 正文缩放一旦把内容区的可用布局宽度改小（`zoom` 的规矩：百分比按
   * 「父级宽度 ÷ 倍数」解析），这一行就会顶出内容区、右边被裁掉 ——
   * 2026-09-19 实测：缩放 150% 时超出 85px，200% 时超出 335px。
   * 交给 flex 伸缩：放得下就还是正好 300px（和改之前一个像素都不差），
   * 放不下才收缩。
   */
  flex: 0 1 300px;
  max-width: 300px;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  font-family: var(--mi-font);
  font-size: 13px;
}
/*
 * 【深色下这三只框必须自己上色 —— 它们原来一直靠浏览器默认外观活着】
 *
 * 超时秒数、API Key、服务地址、模型这四只输入框**从来没写过 color / background**，
 * 浅色下这没问题：浏览器默认就是白底黑字。但深色下 Chromium 给原生控件的默认是
 * **#3b3b3b 底 + #757575 的提示语**，提示语压底只有 **2.43:1**（门槛 4.5）——
 * 2026-09-20 实测：「已保存好了，要换一把就粘新的进来」这行字基本读不清。
 * 那块中性灰（#3b3b3b）也和整套深蓝灰不是一个调，看着像界面破了个洞。
 *
 * 【为什么只写深色、不写成通用规则】
 * 浅色下同一个提示语是 #757575 压白底 = 4.61:1，**本来就过线**。
 * 写成通用规则会顺手改掉浅色的观感 —— 这次只修夜间模式，浅色一个像素不动。
 *
 * 取值和 `MiInput.vue` 的 `.mi-input` 一字不差：底比卡片亮一档（--mi-bg 压在 --mi-card 上），
 * 边框用 --mi-border，提示语用三档文字里最淡的 --mi-text-3（压 --mi-bg 是 4.73:1）。
 */
:root[data-theme='dark'] .card input[type='text'],
:root[data-theme='dark'] .card input[type='password'],
:root[data-theme='dark'] .card input[type='number'] {
  color: var(--mi-text);
  background: var(--mi-bg);
}
:root[data-theme='dark'] .card input::placeholder {
  color: var(--mi-text-3);
}
/* 标签 + 它下面那行小字，作为一个整体参与 .row 的两端对齐 */
.ai-label-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
/* 提示行紧跟在它说明的那个标签下面，所以不能按 .hint 的默认间距走 */
.ai-hint {
  margin-top: 0;
  font-size: 12px;
}
.ai-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
}
.ai-testing {
  font-size: 13px;
  color: var(--mi-text-3);
}
.ai-result {
  margin-top: 12px;
  font-size: 13px;
  line-height: 1.7;
}
.ai-result.is-ok {
  color: var(--mi-success-deep);
}
.ai-result.is-bad {
  color: var(--mi-error-deep);
}
.ai-detail {
  display: block;
  font-size: 12px;
  color: var(--mi-text-3);
  word-break: break-all;
}
.ai-privacy {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--mi-border);
  white-space: pre-line;
}
/* 清 Key 确认框正文（V2-09；字号/行高照 MemoView 的 .memo-del-body） */
.ai-clear-body {
  margin: 0;
  font-size: 13px;
  color: var(--mi-text-2);
  line-height: 1.7;
}
.env-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 12px;
}
/* 检测中这个标题行会临时长高到 48px（空状态框的高度），检测完自动缩回去 */
.env-title-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.env-title {
  font-size: 15px;
  font-weight: 600;
}
/* 分隔线挂在 wrap 上而不是 .env-row 上 —— 挂在 row 上的话，
   它会横在「没找到」和它下面那行安装提示之间，把一句话劈成两半。 */
.env-row-wrap {
  border-bottom: 1px solid var(--mi-border);
}
.env-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  font-size: 14px;
}
/* 安装提示缩进一格、字号更小，读起来是「附在上一行结论下的补充」，
   而不是一条并列的新条目 */
.env-fix {
  margin: -2px 0 10px 12px;
  font-size: 12px;
  color: var(--mi-text-3);
  line-height: 1.7;
}
.env-lang {
  color: var(--mi-text);
  font-weight: 500;
}
.env-ok {
  color: var(--mi-success-deep);
  font-size: 13px;
}
.env-miss {
  color: var(--mi-text-3);
  font-size: 13px;
}
.env-checking {
  color: var(--mi-text-3);
  font-size: 13px;
}
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  font-size: 14px;
  border-bottom: 1px solid var(--mi-border);
}
.row input[type='number'] {
  width: 80px;
  padding: 5px 8px;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
}

/*
 * 本地 IDE 路径那一行：输入框 + 「选择文件」+「清除」。
 * 输入框的宽度规矩照 `.ai-card` 那几只（flex: 0 1 300px —— 放得下就 300px、
 * 放不下才收缩，正文缩放 150%/200% 时不会把整行顶出内容区）；
 * 按钮 `flex: none`，不许被挤扁（理由同 .ai-key-wrap 那段长注释）。
 * 深色下这三只框的颜色由上面那条 `:root[data-theme='dark'] .card input[...]`
 * 统一管着，这里不重复写。
 */
.ide-path-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.ide-path-wrap input[type='text'] {
  flex: 0 1 300px;
  max-width: 300px;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  font-family: var(--mi-font);
  font-size: 13px;
}
.ide-path-wrap :deep(.mi-btn) {
  flex: none;
  white-space: nowrap;
}
/* 自动检测的行内结果。颜色比普通 hint 重一点：它不是长期说明，
   是「你刚点的那个按钮的答复」，扫一眼就要能看见 */
.detect-msg {
  color: var(--mi-text-2);
}

/*
 * ── 音效音量滑块（3.0）───────────────────────────────────────────
 *
 * 【为什么它和上下的开关长得不一样，却一个自定义轨道都不画】
 * 原生 range 的轨道/滑块在 Chromium 上跟着两样东西走：`accent-color`（滑块和高亮段）
 * 和 `color-scheme`（轨道底色）。本项目的 `tokens.css` 在 `:root` 上按主题写了
 * `color-scheme: light / dark`，所以**轨道本来就跟着夜间模式变** ——
 * 自己清掉 appearance 再画一套要写几十行供应商前缀，换来的只是"和系统控件不一样"。
 * 和 `ZoomControl.vue` 的 `.zoom-range` 是同一套做法，不一致的地方只有宽度。
 *
 * ⚠️ **这里没有专门的深色规则，但那不等于"深色下没问题"**：
 * `--mi-blue-deep` 在浅色和深色里是**同一个值**（#6faeff），所以滑块本身两套主题
 * 长得一样，跟着主题变的只有轨道 —— 验收判据必须落在**真像素**上（截图比对
 * 浅色/深色下这块区域的像素），光看这一处 CSS 是看不出差别的。
 *
 * 【宽度为什么写成 flex 而不是固定值】同 `.ai-card` 那几只输入框：正文缩放
 * （150% / 200%）会把内容区的可用布局宽度改小，写死宽度的一行会顶出去、右边被裁掉。
 * `flex: 0 1 150px` 是"放得下就 150px，放不下才收缩"。
 */
.vol-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.vol-range {
  flex: 0 1 150px;
  max-width: 150px;
  min-width: 60px;
  height: 18px;
  margin: 0;
  accent-color: var(--mi-blue-deep);
  cursor: var(--mi-cursor, pointer);
}
/*
 * 音效关着时它跟着变灰（`:disabled` 由模板里那个 `:disabled` 绑上去）。
 * 不透明度压到 0.5：浅色下轨道本来就很淡，压太少看不出"现在拨不动"。
 */
.vol-range:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
/*
 * 百分数。`min-width` + `tabular-nums` 是为了**别让滑块抖**：
 * 数字从 9% 变到 100% 宽度不一样，不锁宽度的话整行会跟着左右抽动，
 * 拖起来像是有东西在飘。`text-align: right` 让低位对齐（和 ZoomControl 一样）。
 */
.vol-pct {
  min-width: 44px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--mi-text-2);
  text-align: right;
}
.hint {
  margin-top: 14px;
  font-size: 12px;
  color: var(--mi-text-3);
  line-height: 1.8;
}
/* V1-58：接近全透的随档提示。只换色（--mi-warn-deep，两个主题都过对比度），
   其余沿用 .hint —— 警示级别低于「出错了」，不需要边框和底色抢戏。 */
.hint.hint-warn {
  margin-top: 6px;
  color: var(--mi-warn-deep);
}
/*
 * ── 大肥鱼互动说明（UI 大修轮 2026-10-09）────────────────────────────
 *
 * 桌宠卡尾部的常显小面板。照本文件 `.wall-*` 块的既定规矩办：
 *   · 一个 background 令牌都不加 —— 内嵌块用边框 + 透明底，玻璃只归 `.card`；
 *   · 不写任何 opacity 声明（全库快照闸门盯着；硬底线：字永远实心）；
 *   · 颜色只用已有三档文字令牌（--mi-text / -2 / -3）。
 */
.pet-guide {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--mi-border);
}
.pet-guide-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.pet-guide-intro {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--mi-text-3);
  line-height: 1.8;
}
/* 小节标题（好感度怎么涨 / 会让好感掉下来的事 / 饱腹度怎么变 / 饿了会怎样） */
.pet-guide-sub {
  margin: 10px 0 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--mi-text-2);
}
.pet-guide-list {
  margin: 4px 0 0;
  padding-left: 20px;
  font-size: 13px;
  color: var(--mi-text-2);
  line-height: 1.8;
}
.pet-guide-list li + li {
  margin-top: 2px;
}
.pet-guide-note {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--mi-text-3);
  line-height: 1.8;
}
/*
 * ── 壁纸外观面板（2026-10-05）─────────────────────────────────────
 *
 * ⚠️ 这个块里**一个 background 令牌都不加**：卡片的玻璃底由 `.card` 那条
 * `var(--mi-card-glass)` 管着（wall-glass.test.ts 的 IN 清单第 1 处），
 * 面板里的内嵌块一律用边框 + 透明底 —— 再加一层实色底会把玻璃蒙出补丁感，
 * 也会让「哪些面吃玻璃令牌」的静态闸门多一处要人工过的变化。
 * 同理这里**不写任何 opacity 声明**（全库快照闸门盯着）。
 */
.wall-tabs {
  margin-top: 14px;
}
/* 小节标题（轮播 / 界面玻璃 / 省电暂停）：细分割线 + 下沉的字重 */
.wall-sec {
  margin-top: 20px;
  padding-top: 12px;
  border-top: 1px solid var(--mi-border);
  font-size: 13px;
  font-weight: 600;
  color: var(--mi-text-2);
}
/*
 * 面板底色的取色器 + 「恢复默认」（2026-10-07 个性化）。样式词汇照
 * WallpaperPropsPanel 的 .wp-color / .wp-reset 那一对搬 —— 全站的原生取色
 * 控件只有这两个地方，长得不一样会显得像两家做的。
 * ⚠️ 照本块的规矩：**不写任何 opacity 声明**（全库快照闸门盯着）；颜色只用
 * 已有令牌（--mi-bg / --mi-border 一族），一个新基色都不引入。
 */
.wall-color-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}
.wall-color {
  width: 44px;
  height: 24px;
  padding: 0 2px;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  background: var(--mi-bg);
  cursor: var(--mi-cursor, pointer);
}
.wall-color-reset {
  padding: 4px 10px;
  font-size: 12px;
  font-family: var(--mi-font);
  color: var(--mi-text-2);
  background: none;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  cursor: var(--mi-cursor, pointer);
}
.wall-color-reset:hover:not(:disabled) {
  color: var(--mi-blue-deep);
  border-color: var(--mi-blue-deep);
}
.wall-color-reset:disabled {
  cursor: not-allowed;
  color: var(--mi-text-3);
}
/* 「当前壁纸」内嵌块：透明底 + 边框，和玻璃卡片叠着看也干净 */
.wall-current {
  margin-top: 14px;
  padding: 10px 12px;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wall-current-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}
.wall-current-title {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
/*
 * 色用 blue-ink 不用 blue-deep：deep 是**按钮底**专用的浅蓝，
 * 当字压在同一个浅蓝底上只有 2.00 —— tokens.css:174-190 里
 * --mi-blue-ink 就是为这一对造的（蓝浅底 4.53）。
 * 那一轮真窗口扫描漏掉了这里：这个徽章只在「壁纸」页签露面，扫的时候没在台上。
 */
.wall-current-badge {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--mi-blue-light);
  color: var(--mi-blue-ink);
}
.wall-current-state {
  font-size: 12px;
  color: var(--mi-text-2);
}
.wall-current-state.is-paused {
  color: var(--mi-text-3);
}
.wall-current-none {
  font-size: 13px;
  color: var(--mi-text-3);
}
.wall-current-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.wall-count {
  font-size: 12px;
  color: var(--mi-text-3);
}
/* 当前壁纸块之后第一行（切换过场）的间距：.row 自带的分隔线在块尾显得贴脸 */
.wall-row-gap {
  margin-top: 14px;
}

/*
 * ── 随机池勾选列表（2026-10-06）───────────────────────────────────
 * 开屏「素材与选片」与壁纸轮播池共用。限高滚动是必须的：壁纸清单可能上百张，
 * 不限高会把设置页撑成一屏勾选框。同本文件样式块纪律：不加 background 令牌、
 * 不写 opacity 声明（静态闸门盯着这两类）。
 */
.pool-list {
  margin-top: 10px;
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
/* 行 = 勾选框 + 行尾小按钮（预览/隐藏，2026-10-06）。
   勾选框吃掉剩余宽度：flex:1 + min-width:0 —— 后者是 flex 项收缩的开关，
   少了它子组件内部的省略号永远不触发（内容是撑开的，不是挤扁的） */
.pool-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.pool-row :deep(.mi-checkbox) {
  flex: 1;
  min-width: 0;
  max-width: 100%;
}
.pool-list :deep(.label) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 行内小按钮：观感对齐选择弹窗里的 .pick-btn（那份 scoped 在弹窗文件里，
   这里必须自己写一份）。⚠️ 本文件在玻璃令牌 IN 清单里（恰 1 处 = 卡片底），
   这个类不许引入 var(--mi-*-glass)，否则 wall-glass.test.ts 的精确计数会红 */
.pool-btn {
  flex: none;
  padding: 2px 8px;
  font-size: 11px;
  font-family: var(--mi-font);
  color: var(--mi-text-2);
  background: transparent;
  border: 1px solid var(--mi-border);
  border-radius: 6px;
  cursor: var(--mi-cursor, pointer);
}
.pool-btn:hover {
  color: var(--mi-blue);
  border-color: var(--mi-blue);
  background: var(--mi-blue-light);
}
/* 「全选 / 反选 / 已选 x/y」一组，贴行尾（.row 是两端对齐） */
.pool-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.pool-count {
  font-size: 12px;
  color: var(--mi-text-3);
  font-variant-numeric: tabular-nums;
}
/* 固定模式的单选行列表：MiRadio 根元素撑满池子容器（它自己默认收缩） */
.pool-list .fix-list {
  width: 100%;
}
</style>

