import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import { createVAutoAnimate } from '@formkit/auto-animate/vue'
import App from './App.vue'
import router from './router'
import { useSettingsStore } from './stores/settings'
import { useZoomStore } from './stores/zoom'
import { useWallUiStore } from './stores/wall-ui'
import { wallUiOf, materialFadeOf } from '../../shared/wall-ui'
import type { SplashTimeline } from '../../shared/splash'
import { applyCursorAssets, installCursor } from './lib/cursor'
import { installSfxWire, loadSfxAssets } from './lib/sfx-wire'
import { installAppNav } from './lib/app-nav'
import { refreshRewardOverrides } from './lib/reward-overrides'
import { startDayClock } from './lib/day-clock'
import { setSfxEnabled, setSfxVolume } from './lib/sfx'
import './styles/tokens.css'
import './styles/motion.css'
import './styles/cursor.css'
import './styles/zoom.css'
import './styles/wallpaper.css'

/**
 * 把一条 CSS 时长令牌（`--mi-dur` 长这样：`180ms`）读成 auto-animate 要的毫秒数。
 *
 * 【为什么不直接把 180 抄在这里】
 * 这个库是用 **Web Animations API** 做动画的，不是 CSS 过渡 —— 所以它读不到
 * `var(--mi-dur)`，只能在建指令的时候喂它一个数。但**真源仍然只能有一份**：
 * 抄一份数字过来的话，将来调 tokens.css 时必然漏掉这里，
 * 表现是「列表动画比界面里别的动画慢半拍」，而且没人猜得到原因。
 * 一个 `getComputedStyle` 就能省掉这个隐患，代价可以忽略（启动时读一次）。
 *
 * 读不到就退回同一套数值 —— 最坏情况和抄一份数字等价，不会更差。
 */
function motionTokenMs(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name)
  const ms = Number.parseFloat(raw)
  return Number.isFinite(ms) ? ms : fallback
}

const pinia = createPinia()
const app = createApp(App).use(pinia).use(router)

/*
 * 列表增删重排的自动补间（搜索结果的整批换、错题本条目被消掉等）。
 *
 * 【为什么用 createVAutoAnimate 而不是现成的 autoAnimatePlugin】
 * 前者能传一套**项目级默认值**，于是调用点只写 `v-auto-animate` 这一个词就行 ——
 * 每个列表各写一遍参数的话，迟早出现「这个列表 250ms、那个 400ms」。
 *
 * 【时长刻意比 --mi-dur 短一点，取的是 --mi-dur 而不是 --mi-dur-slow】
 * 列表补间是在**用户正在操作**的时候发生的（打字、点掉一条错题），
 * 这种场合下手感的第一要求是「别挡路」，所以取快的那一档。
 * 库自己的默认值是 250ms，比我们慢，用默认反而会显得拖。
 *
 * 【无障碍】这个库在 `prefers-reduced-motion: reduce` 时会**自己整个关掉**，
 * 不需要我们再包一层判断（见 node_modules/@formkit/auto-animate/index.mjs 里
 * 那个 matchMedia）。CSS 那边的总闸在 styles/motion.css。
 */
app.directive(
  'auto-animate',
  createVAutoAnimate({
    duration: motionTokenMs('--mi-dur', 180),
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
  })
)

/*
 * ⚠️ **先读配置，再挂载界面。** 顺序反了会踩一个不报错的坑：
 *
 * splitpanes 的 `size` 只在 pane 挂载那一刻读一次 —— 它没有暴露任何编程式
 * 设置尺寸的接口，所以晚一步到的宽度**永远不会生效**。表现出来就是
 * 「拖好了宽度、重开又弹回默认」，没有一个字报错。
 *
 * 这么做**不会闪白**：主进程是等 `ready-to-show` 才把窗口 show() 出来的，
 * 这段 await 只让窗口晚几十毫秒出现，而不是先显示一个错误宽度再跳一下。
 */
const settings = useSettingsStore(pinia)
try {
  await settings.load()
} catch {
  // 读配置失败就用默认值继续。**不能因为读不到配置把整个界面拖死** ——
  // 设置页自己还会再 load 一次，那时能读到就读到了。
}

/*
 * 主进程自发改配置的推送（config:external，2026-10-06 起；目前唯一生产者 =
 * 桌宠右键菜单「关闭大肥鱼」——主进程把 pet.enabled 落成 false 后广播，
 * 设置页若正开着，开关当场跟着灭）。
 *
 * 【为什么就写在这里，不包一个 lib】它只有一行语义（整份换上），也没有
 * 第二个落点 —— 包一层只是为了对称好看。真出现第二个消费方再抽不迟
 * （同 installAppNav 当初的取舍，见 lib/app-nav.ts）。
 *
 * 【为什么不需要「补拉兜底」】wallpaperState / splashStats 要兜底，是因为
 * 它们在启动瞬间就可能推过一条而没人听；这条是**用户点菜单那一刻**才发生的
 * 事件，那时窗口早已加载完。就算极端下真错过，下一次 configGet（设置页每次
 * 打开都会 load）拿到的是同样的事实 —— 没有需要补的缝。
 */
window.miai.onConfigExternal((cfg) => settings.applyExternalConfig(cfg))

/*
 * 把配置里的音效开关**同步进音效引擎**。
 *
 * 【为什么用 watch 而不是在这里读一次就完事】设置页的开关一拨，声音要**当场**
 * 生效（拨到关，下一声就不响了；拨到开，下一声就响）。读一次的话，
 * 用户得重启软件才能听到变化——而他刚刚才拨过那个开关，会以为开关是坏的。
 *
 * `immediate: true` 让它同时也干"启动时读一次"这件事，不必写两遍。
 * 放在 mount 之前：等界面出来时引擎的状态已经是对的了，
 * 否则开屏那一下的点击可能会按默认值（开着）响一声，而配置里其实是关的。
 */
watch(() => settings.config.soundEnabled, setSfxEnabled, { immediate: true })

/*
 * 总音量，同理（拨滑块要当场生效，`immediate: true` 兼做启动时读一次）。
 *
 * 【为什么和开关分成两条 watch，而不是合成一条】两个字段改的是**两件事**：
 * 开关是"响不响"，音量是"多响"。合成一条的话，拨音量时会把开关也重设一遍——
 * 在"关着音效时拨音量"这个组合下，那一瞬间开关会被设成关（对，没坏），
 * 但这类"顺手重设一遍"的写法迟早会有人往里加第 3 个字段，
 * 然后某天出现"拨了音量，音效开关自己变了"。
 */
watch(() => settings.config.sfxVolume, setSfxVolume, { immediate: true })

/*
 * 把主题写进 `<html data-theme="...">`，供 styles/tokens.css 里
 * `:root[data-theme='dark'] { ... }` 那一块取用。
 *
 * 【写法和音效那条一样，理由也一样】入口有两个（设置页那个开关，将来可能还有
 * 顶栏的快捷开关），挂在控件里就得写两遍，漏一处的表现是「这个入口切不动」。
 *
 * 【为什么必须 `immediate: true`、必须在这里】它让主题**在 mount 之前**就铺好。
 * 晚一帧的话，深色用户每次开屏都会先看到一帧浅色再跳成深色 ——
 * 那个闪白比任何一处配色不对都显眼，而且会让人以为软件坏了。
 *
 * 【为什么是 `dataset` 而不是 class】`data-theme` 的值就是主题名本身，
 * DevTools 里一眼看得出当前是哪个主题；class 方案要么另立一套 `theme-dark`
 * 的命名约定，要么哪天和一个真实样式类撞名。
 */
watch(
  () => settings.config.theme,
  (theme) => {
    document.documentElement.dataset.theme = theme
  },
  { immediate: true }
)

/*
 * 把缩放的倍数写进 `<html>` 的行内样式，供 styles/zoom.css 的
 * `main.content > * { zoom: var(--mi-zoom) }` 取用。
 *
 * 【为什么是"写 CSS 变量"而不是给每个视图传 prop】
 * 缩放要作用在**每一个页面根元素**上，而页面有七八个（看课、练习、总览、
 * 复习、设置……）。逐个传 prop 意味着每加一个视图就要记得接一次，
 * 漏掉的那个表现为"别的页面都能缩，就它不行"——而且不会报任何错。
 * 写在 `documentElement` 上则是**子选择器一次覆盖全部**，新视图天然继承。
 *
 * 【为什么用 watch 而不是在下调用的地方顺手写一下】
 * 入口有三个（`+`、`−`、滑块），未来还会有"复位"。写在控件里就要写三遍，
 * 漏一处就是"按钮能缩、滑块不能缩"。挂一个 watch，入口有几个都不影响。
 *
 * `immediate: true` 让它同时干"启动时铺一次初值"这件事——必须**在 mount 之前**，
 * 否则开屏会先按 100% 画一帧，再跳成用户上次的档位，肉眼能看到闪一下。
 */
const zoom = useZoomStore(pinia)
watch(
  () => zoom.scale,
  (scale) => document.documentElement.style.setProperty('--mi-zoom', String(scale)),
  { immediate: true }
)

/*
 * 把「壁纸 UI 通透度」的两个数 + 「面板底色覆盖色」写进 `<html>` 的行内样式，
 * 供 wallpaper.css 的 `:root[data-wallpaper]` 门控块（glass 令牌）与 `.layout`
 * 的 veil 取用。
 *
 * 【为什么一条 watch 同时盯「状态」和「主题」两个来源】
 * 三个值都是**每主题各记一份**的（浅色与深色的对比度预算不同、底色也各挑各的，
 * 见 shared/wall-ui.ts）—— 主题一换，变量就必须换成新主题那一份。写成数组来源，
 * 两个变化走同一个函数，不存在「切了主题、注入的还是旧主题那份」的缝。
 *
 * 【为什么 immediate + 必须在 mount 之前】和 theme / zoom 两条同一条理由：
 * 晚一帧的话，开屏第一帧面板还是全实色（tokens.css 兜底 100%），再跳成用户
 * 上次调的值 —— 壁纸用户每次开屏都能看到那一下闪变（同 zoom 的闪档位）。
 *
 * 【第三个值 panelColor 覆盖的是 --mi-card，不是 glass 令牌】
 * 玻璃令牌是 `color-mix(var(--mi-card) × alpha)` 在**元素处**求值的，所以只换
 * 基色、玻璃自动跟随；直接写 --mi-card-glass 会和 wallpaper.css 门控块同特异性
 * 打架、胜负按源码顺序定 —— 那种坏法是静默的（同一份主题下时好时坏的样子）。
 * null = 清除覆盖：removeProperty 对没设过的属性是 no-op，一步回到 tokens.css 的
 * 主题自带色 —— 不需要在这里（或任何地方）再抄一份「主题默认色」来恢复。
 *
 * 【它绝不碰文字】这些变量只被容器面的 glass background、画布 veil、
 * 面板基色 --mi-card 与面板自己的棱/厚度 box-shadow 消费，代码块/正文/题目/
 * 大肥鱼一概不吃 —— 硬底线的静态闸门见 shared/wall-ui.ts 头注释。
 *
 * 【2026-10-08 追加 --mi-glass-depth】液态玻璃那一组旋钮里，只有「阴影扩散」
 * 是**纯 CSS** 的（其余四个走 lib/glass/refraction.ts 的运行时：强度/环宽/模糊/
 * 流动都是滤镜链自己的参数，走 CSS 变量反而要绕一圈回来读）。所以这里只多注入
 * 一个长度：面板内侧那道厚度阴影的深度。0 也是合法值 —— 这时 calc 出来的
 * 偏移/模糊/扩散全是 0，画出来等于没有阴影，不需要额外的开关分支。
 * 它只被容器面的 box-shadow 消费（wallpaper.css 的 `:root[data-wallpaper]`
 * 门控块里），**壁纸关掉时整条规则不匹配** ⇒ 观感逐字节回到改造前。
 *
 * 【2026-10-16 追加 --mi-material-fade（V2-30）】棱线（--mi-glass-rim 的底色）
 * 与厚度阴影的**颜色**此前是静态的：alpha 拖到 0、面板底没了，棱和厚度还在，
 * 看起来像"没生效"。现在把 materialFadeOf(alpha) 的系数注入成这个变量，
 * wallpaper.css 门控块里那两条 color-mix 用它把两色往 transparent 稀释。
 * **换算在 TS 里做**（materialFadeOf，纯函数 + 单测），CSS 只消费成品百分比。
 * alpha ≥ 30（含出厂默认 40/65）= 系数 1 = 与改动前逐字节相同。
 */
const wallUi = useWallUiStore(pinia)
watch(
  [() => wallUi.config, () => settings.config.theme],
  ([ui, theme]) => {
    const active = wallUiOf(ui, theme)
    document.documentElement.style.setProperty('--mi-panel-alpha', `${active.panelAlpha}%`)
    document.documentElement.style.setProperty('--mi-wall-veil', `${active.veil}%`)
    document.documentElement.style.setProperty('--mi-glass-depth', `${ui.glass.shadow}px`)
    document.documentElement.style.setProperty(
      '--mi-material-fade',
      `${(materialFadeOf(active.panelAlpha) * 100).toFixed(1)}%`
    )
    if (active.panelColor) {
      document.documentElement.style.setProperty('--mi-card', active.panelColor)
    } else {
      document.documentElement.style.removeProperty('--mi-card')
    }
  },
  { immediate: true }
)

/*
 * 开屏时间线的读取口（探针/排障用，`__wallpaperStats` 同款思路；docs/24 P1/P2）。
 *
 * 【这两行解决的是什么】开屏收场时主进程**推**一条 `splash:stats`（带
 * 完整时间线：t0 / 开屏窗口出现 / 首个窗口出现 / 收场 / 销毁各自的时间戳
 * 和收场原因）。P2 定标「3 秒内出现首个窗口、全程无黑/白闪」以及失败排障
 * 全靠这条时间线取真值。它的到达有三种时相：
 *   ① 推送时渲染层还没加载完（冷启动最常见）——主进程会在 did-finish-load
 *      之后再发，下面的订阅必收得到；
 *   ② 推送发生在订阅建立之前（页面刷新 / 加载晚于收场）——那条没人听，
 *      用 getSplashStats() 补拉一次；
 *   ③ 没开过屏（设置里关了 / 低内存跳过）——补拉拿到 null，如实返回。
 * 两条都幂等：`__splashStats()` 只读最后一条，重复落值无副作用。
 *
 * 【为什么挂在 window 上而不是进 store】它是**探针的读口**，界面一个字都
 * 不渲染它——进 store 会把它变成"界面状态"（刷新时要处理、要持久化考虑），
 * 而它其实只是"主进程说过什么"的只读回放。
 *
 * 【为什么先挂读口再订阅】反过来的话，极短的开屏（素材坏得快、用户秒跳过）
 * 可能在挂读口之前就落值——挂口在前，任何时刻问都有答案（至少是 null）。
 */
const splashProbe = window as Window & { __splashStats?: () => SplashTimeline | null }
let splashTimeline: SplashTimeline | null = null
splashProbe.__splashStats = () => splashTimeline
window.miai.onSplashStats((t) => {
  splashTimeline = t
})
void window.miai
  .getSplashStats()
  .then((t) => {
    if (t && splashTimeline === null) splashTimeline = t
  })
  .catch(() => {
    // 补拉失败就保持 null——开屏没跑过和补拉失败在探针侧不可区分是
    // 可接受的：这条通道只在排障时被读，不影响任何界面行为。
  })

/*
 * 把 `assets/sounds/` 里的素材登记进引擎，并**立刻开始预解码**。
 *
 * 【为什么必须在 mount 之前】
 * 解码是异步的。等界面挂载完再登记的话，用户从"看到窗口"到"第一次点到什么"
 * 之间的那几十毫秒里，第一个音效百分之百还没解码好 —— 表现就是
 * 「第一下点击没声音，第二下才有」。提前这一步，解码和首屏渲染并行跑。
 *
 * 【目录是空的会怎样】什么都不会发生，也不该发生：没有素材 → 没有音源 → 一切静默。
 * 这是现在的正常状态，不是故障。
 */
loadSfxAssets()

/*
 * 三件全局"手感"接线。
 *
 * 放在 mount **之前**：三件都是"越早生效越好"——
 * 指针晚一秒变猫爪、开屏第一次点击没声音，都是能被人一眼看出来/听出来的。
 * 它们自己不碰 DOM 结构（只写两个 CSS 变量、挂几个监听），不需要等界面挂载。
 *
 * ⚠️ `applyCursorAssets()` 要排在 `installCursor()` **前面**：前者把图写进
 * `--mi-cursor-paw`，后者只管按下时切到 `--mi-cursor-paw-down`。
 * 反过来写也能跑，但中间那一瞬（变量还是 `cursor.css` 里的兜底 `pointer`、
 * 而按下状态已经建立了）会让"按下的猫爪"先兜底成系统手型，闪一下。
 */
applyCursorAssets()
installCursor()
installSfxWire(router)
// 桌宠菜单「一键直达设置」的接收端（主进程 app:nav → 跳到设置页某张卡）
installAppNav(router)

/*
 * 奖励图覆盖映射预热（2026-10-16）：启动先拉一次，奖励弹窗/仓库页首次打开就
 * 直接吃缓存；其余刷新点=进仓库页、弹奖励窗前、设置页（见 lib/reward-overrides.ts）。
 * 失败在模块内消化（退回空映射=显示出厂图），这里不 catch。
 */
void refreshRewardOverrides()

/*
 * 「今天是哪天」的活时钟（高-5，2026-10-15）。
 *
 * 常驻应用（桌宠 + 托盘）开着过零点是常态：挑战页/签到卡读的"今天"原来是
 * 一组「零依赖 computed」，缓存到进程结束 —— 过了零点仍拿昨天的日键，
 * 必须重启才恢复。这里起钟（lib/day-clock.ts），跨天时把响应式 `today` 翻值，
 * 各 store 自动跟着重读新一天的存档。
 *
 * 放在 mount **之前**：跟上面几条同理，越早生效越好 —— 万一正好在启动过程中
 * 跨了零点（23:59:59 开机），各 store 首次求值就该拿到对的日键。
 * 它不碰 DOM（一个 setTimeout + 两个监听），不需要等界面挂载。
 * 幂等，重复调无副作用。
 */
startDayClock()

app.mount('#app')
