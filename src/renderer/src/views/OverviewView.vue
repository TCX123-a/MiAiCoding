<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as echarts from 'echarts/core'
import { RadarChart, HeatmapChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  CalendarComponent,
  RadarComponent,
  TitleComponent
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useContentStore } from '../stores/content'
import { useProgressStore } from '../stores/progress'
import { useZoomStore } from '../stores/zoom'
import { usePetStore } from '../stores/pet'
import { localDateKeyOf } from '../../../shared/dates'
import { today } from '../lib/day-clock'
import {
  PET_CHECKIN_RICE,
  PET_FEED_GAIN,
  PET_INTERACT_COOLDOWN_MS,
  PET_RICE_MAX,
  PET_RUN_REWARD_DAILY_MAX,
  PET_SATIETY_MAX
} from '../../../shared/pet'
import { LANG_LABEL, STAGE_LABEL } from '../lib/labels'
import { computePerLang, overallPercent } from '../lib/overview'
import { buildMonthGrid, type CalendarCell } from '../lib/checkin-calendar'
import { streakDisplayOf } from '../lib/checkin-streak'
import { CHECKIN, EMPTY, OVERVIEW, TITLE, WAREHOUSE } from '../lib/copy'
import MiButton from '../components/base/MiButton.vue'
import MiCard from '../components/base/MiCard.vue'
import MiProgressBar from '../components/base/MiProgressBar.vue'
import MiProgressRing from '../components/base/MiProgressRing.vue'
import MiEmpty from '../components/base/MiEmpty.vue'
import MiMascot from '../components/base/MiMascot.vue'

echarts.use([
  RadarChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  CalendarComponent,
  RadarComponent,
  TitleComponent,
  CanvasRenderer
])

/**
 * 【ECharts 读不了 CSS 变量，所以这里必须现读】
 *
 * echarts 自己解析颜色字符串，`color: 'var(--mi-text-2)'` 它不认识、会当非法值丢掉。
 * 结果就是下面那张雷达图和日历热力图**只能写字面色值** —— 而这里原先写的 7 个值
 * （#6b7a8c / #7BB8FF / #e8f4ff / #9aa8b8 / #e3edf7 / #f7f9fc / #fff）
 * 全是**老令牌的复印件**，2026-09-14 换配色时它们**一个都没跟着变**：
 * 图表里还留着上一套灰蓝，和周围的界面已经不是一个色系了。
 *
 * 复印件会烂掉，所以这里改成现读令牌：以后换配色，这张图跟着走，不用回来改。
 */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

// M2-06：学习进度总览（整体进度环/各语言进度条/阶段完成度/雷达图/学习日历热力图）
const content = useContentStore()
const progress = useProgressStore()
/** 只用来在缩放变化时把两张图重新量一遍，见文件末尾那个 watch */
const zoom = useZoomStore()
/**
 * `?card=` 直达 —— 见 applyCardQuery（现只服务显式深链）。
 * 另有一条自动路：未签到时进本页，guideToCheckin 会自己把签到卡闪一下并聚焦
 * 按钮（模块三，2026-10-09 起「每日签到」并入总览，侧栏不再有独立入口）。
 */
const route = useRoute()
// V1-23：收藏统计格改成真入口（点进收藏页）需要跳转 —— 此前本文件只用 route 读 query
const router = useRouter()

// LANG_LABEL / STAGE_LABEL 由 ../lib/labels 统一提供（此前本文件自己抄了一份）

/**
 * 每语言：已学/总数 + 各阶段完成度。
 *
 * ⚠️ 这里原来是一段**就地算的** `computed`，而它把每门语言渲染成了三张卡
 * （`outline` 里每条是一对「语言 × 阶段」，旧代码只按 `lang !== 'common'` 过滤）。
 * 2026-09-21 主人 2.0 验收截图里的 Bug 2 就是它。现在算式搬去 `lib/overview.ts`，
 * 由 `__tests__/overview.test.ts` 钉住「一门语言一张卡」——
 * 组件里的 computed 测不了，这正是它错了两个月没人发现的原因。
 */
/*
 * ⚠️ 第二个参数（`content.bundle.lessons`）**不是装饰**：大纲里可能有还没写正文的课，
 * 那些课永远无法被标记为已学，算进分母这门语言就永远到不了 100%。
 * 详见 lib/overview.ts 抬头「分母为什么改了」。
 */
const perLang = computed(() =>
  computePerLang(content.bundle.outline, content.bundle.lessons, progress.learnedSet)
)

/**
 * 总进度环上的那个数。
 *
 * 【为什么算式不在这里，也不在 progress store 里】见 `lib/overview.ts` 的
 * `overallPercent` 注释：它原来写死在 store 里（`/192`），分母要的是
 * `bundle.lessons.length`，而 progress 是内容 store 的**上游** ——
 * 让上游 import 下游就是一条循环依赖。所以算式在纯函数里，分母由这一层给。
 */
const allPercent = computed(() => overallPercent(progress.learnedSet, content.bundle.lessons))

/*
 * 2026-10-01：这页原来还挂着每阶段/整门的「综合练习」按钮（组卷四件套就写在这里）。
 * 入口搬去了练习页的「阶段练习」页签和侧栏课程列表的阶段末尾 ——
 * 总览页只留"看进度"这件事本身，组卷那套逻辑一并搬进
 * `lib/stage-practice.ts` 的 `useStagePaperFlow()`，不在这个文件里留副本。
 */

/**
 * 雷达图数据：五模块完成度
 *
 * 【为什么没有单独的「空档案」分支（2026-10-17 夜检复核：记录不修）】
 * 五条轴来自 `bundle.outline`，是内容产包保证的非空不变量；一次都没学时每条轴
 * 的值是 0，雷达图照常画出五个带模块名的 0% 轴 —— 这本身就是「还没开始」的
 * 如实呈现，不是一片看不出含义的空白。旁边的日历需要空态，是因为没有记录时
 * ECharts 画出来只是一张没有标注的网格，看不出那是什么；雷达图没有这个歧义。
 * 再加一个空态分支只会遮住模块名、多一份要维护的文案，收益为负。
 */
const radarData = computed(() =>
  content.bundle.outline.map((m) => {
    const learned = m.lessons.filter((l) => progress.learnedSet.has(l.id)).length
    return { name: LANG_LABEL[m.lang] ?? m.lang, value: Math.round((learned / m.lessons.length) * 100) }
  })
)

/**
 * 日历热力图数据：按日期聚合学习记录
 *
 * ⚠️ 这里原来写的是 `h.finishedAt.slice(0, 10)` —— `finishedAt` 是 **UTC** 的
 * ISO 时间戳，直接切前 10 位等于**拿 UTC 的日期当本地日期用**。
 * 本机是东八区，本地 0:00–8:00 学的那一课，UTC 那边还是昨天，
 * 于是热力图上**今天学了、格子亮在昨天**（一天里整整 8 小时会这样，白天怎么测都是对的）。
 * 改用 localDateKeyOf 做本地时区转换，理由和实测见 shared/dates.ts。
 * 转不出合法日期的脏记录直接跳过 —— 不能因为一条坏数据让整张图崩掉。
 */
const calendarData = computed(() => {
  const byDay = new Map<string, number>()
  for (const h of progress.profile.history) {
    const d = localDateKeyOf(h.finishedAt)
    if (!d) continue
    byDay.set(d, (byDay.get(d) ?? 0) + 1)
  }
  return [...byDay.entries()].map(([d, n]) => [d, n] as [string, number])
})

const radarEl = ref<HTMLDivElement | null>(null)
const calendarEl = ref<HTMLDivElement | null>(null)
let radarChart: echarts.ECharts | null = null
let calendarChart: echarts.ECharts | null = null

/**
 * 整年的热力图有多少列。2026 是平年：1 月 1 日是周四，
 * 首尾各要补半周，53 列。
 */
const CALENDAR_COLS = 53

/**
 * 日历里留给标签的那点宽度（与 setOption 里的 `left` / `right` 是同一组数）。
 * 两处必须一起改 —— 所以放在这里当常量，而不是在下面的算式里再抄一遍。
 */
const CALENDAR_PAD_LEFT = 34
const CALENDAR_PAD_RIGHT = 16

/**
 * 「今天」在视图里的两个锚：热力图画的年、签到月历画的年月。
 *
 * 【为什么从写死 '2026' 改成取真值】原来热力图的 `range` 写死 `'2026'`，
 * 卡片标题那侧则各自取本机年份 —— 跨年那天标题写着 2027、
 * 图画的是 2026，数据全落在 range 外，**整张热力图变成空白**（而且不报错）。
 * 现在两处都从下面的 `calendarYear` 取（北京日派生），才不会各错各的。
 * 【运行期跨年/跨月：2026-10-16 起跟着活时钟走（空转[2] 顺手）】原先这两个
 * 是挂载那一刻取的常量（注释曾写"重进/重启即对齐"）；现在有 `today` 这个
 * 响应式日键（lib/day-clock.ts，高-5 的产物），从它派生就是了 —— 应用开着
 * 跨过月末/元旦，月历与热力图自己跟上，不用再等重进。锚仍然只有一个来源。
 */
const calendarYear = computed(() => Number(today.value.slice(0, 4)))
const calendarMonth = computed(() => Number(today.value.slice(5, 7)))

/**
 * 月份标签在这个容器宽度下**写不写得下**，写不下就退回纯数字。
 *
 * 【为什么必须自适应，而不是挑一个固定写法】
 * 12 个月名均匀落在 53 列上，相邻两个的间距 ≈ `(容器宽 - 左右留白) / 11.3`。
 * 而"12月"这三个字符在当前字号下实测约 **26px**（微软雅黑，实测量法）。于是：
 *
 *   · 容器 554px（总览页单列时）→ 间距 ≈ 45px，余量 +19px，写"1月"很舒展
 *   · 容器 237px（原来挤在左半边时）→ 间距 ≈ 17px，**重叠 9px** —— 就是主人截图里那样
 *
 * 所以这不是"哪个写法更好看"的问题：**窄的时候"1月"是画不下的**，
 * 硬写就会糊成一片。退回纯数字（"12" 约 13px）在 17px 的间距里还留 4px 余量。
 *
 * 【为什么用 nameMap 而不是 formatter】
 * `monthLabel.formatter` 的函数签名跟着 ECharts 版本走过（params 里给的是
 * 月份对象还是裸数字，各版本不一样），而 `nameMap` 收一个**定长数组** ——
 * 1..12 对应十二月，不依赖任何回调约定。这里要的正是"换一套名字"，
 * 那就用换名字的那个开关。
 */
function monthNameMap(containerW: number): string[] {
  const plotW = Math.max(0, containerW - CALENDAR_PAD_LEFT - CALENDAR_PAD_RIGHT)
  const pitch = plotW / 11.3 // 11.3 ≈ 12 个月摊在 53 列上的间隔数
  // 26px 是"12月"的实测宽度，再要求 6px 呼吸空间 —— 两个数都别拍脑袋改
  const roomy = pitch >= 26 + 6
  return Array.from({ length: 12 }, (_, i) =>
    roomy ? TITLE.calendarMonth(i + 1) : TITLE.calendarMonthNarrow(i + 1)
  )
}

function updateCharts() {
  if (radarChart && radarEl.value) {
    radarChart.setOption({
      tooltip: {},
      radar: {
        indicator: radarData.value.map((d) => ({ name: d.name, max: 100 })),
        radius: '68%',
        axisName: { color: token('--mi-text-2'), fontSize: 12 }
      },
      series: [
        {
          type: 'radar',
          data: [{ value: radarData.value.map((d) => d.value), name: TITLE.SERIES_PROGRESS }],
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: token('--mi-blue-deep'), width: 2 },
          itemStyle: { color: token('--mi-blue-deep') },
          // 原来是写死的 'rgba(123, 184, 255, 0.25)'。改成 color + opacity 两件事，
          // 颜色就能跟着令牌走 —— 不用再把十六进制手算成 rgb 三兄弟。
          areaStyle: { color: token('--mi-blue-deep'), opacity: 0.25 }
        }
      ]
    })
  }
  if (calendarChart && calendarEl.value) {
    const max = Math.max(1, ...calendarData.value.map(([, n]) => n))
    calendarChart.setOption({
      tooltip: { formatter: (p: { data: [string, number] }) => TITLE.radarTooltip(p.data[0], p.data[1]) },
      visualMap: {
        min: 0,
        max,
        type: 'continuous',
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        inRange: { color: [token('--mi-blue-light'), token('--mi-blue-deep')] },
        calculable: false,
        show: false
      },
      calendar: {
        // 画「今年」——与卡片标题取同一份年份（原来写死 '2026'，见上方 calendarYear 注释）
        range: String(calendarYear.value),
        /*
         * 格子高度 = **星期标签那 7 个字的行距**（行高就是它）。
         *
         * 原来写 13：汉字字号 12px，行距 13px —— 字与字之间只剩 1px，
         * "日一二三四五六"糊成一条竖着的黑线（3 倍放大截图里看得最清楚）。
         * 中文正文至少要 2~3px 的字间空隙才不显挤，所以给到 16。
         * 代价是格子从 9×13 变成 9×16（略瘦长），换来的是左边那一列能认得出字。
         *
         * ⚠️ 改这个数要同时看 `.chart-calendar` 的高度够不够：
         * 整个日历 = 顶部月份行 44 ＋ 7 行 × 这个值。
         */
        cellSize: ['auto', 16],
        // top 要给月份那一行留出整行的高度：原来 40 是"标签贴着格子上沿"，
        // 加上下面 monthLabel.margin 的 10 之后，标签才真正和格子分开。
        top: 44,
        left: CALENDAR_PAD_LEFT,
        right: CALENDAR_PAD_RIGHT,
        yearLabel: { show: false },
        // margin 是标签与格子之间的空隙。两个都调过：
        // 原来月份那行几乎是贴在上沿、星期那列贴着左沿，观感就是"挤在一起"
        dayLabel: { nameMap: 'ZH', color: token('--mi-text-3'), margin: 8 },
        monthLabel: {
          nameMap: monthNameMap(calendarEl.value?.clientWidth ?? 0),
          color: token('--mi-text-3'),
          margin: 10
        },
        splitLine: { lineStyle: { color: token('--mi-border') } },
        // 空格子的填色 = 卡片色，2px 亮边框切出网格。
        // ⚠️ borderColor 原先写死 '#ffffff'（上面那句注释说「两个值现在跟着令牌走」，
        //    其实只有 color 走了）—— 深色下卡片是暗的、格子也是暗的，白边框会变成
        //    一张刺眼的白网格。改成 --mi-bg：浅色下它正好就是 #ffffff，逐字节不变。
        itemStyle: { color: token('--mi-card'), borderColor: token('--mi-bg'), borderWidth: 2 }
      },
      series: [
        {
          type: 'heatmap',
          coordinateSystem: 'calendar',
          data: calendarData.value
        }
      ]
    })
  }
}

function resize() {
  radarChart?.resize()
  calendarChart?.resize()
  // 宽度变了，月份标签可能得换一种写法（见 monthNameMap）：
  // 只 resize 不重算的话，窗口从宽拖到窄，标签还是"1月"那一套 —— 又挤上了，
  // 而且这次是因为"改过的东西没跟着环境变"，比一开始就写错更难查。
  updateCharts()
}

onMounted(() => {
  if (radarEl.value) radarChart = echarts.init(radarEl.value)
  if (calendarEl.value) calendarChart = echarts.init(calendarEl.value)
  updateCharts()
  window.addEventListener('resize', resize)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  radarChart?.dispose()
  calendarChart?.dispose()
})

watch([radarData, calendarData, calendarYear], updateCharts, { deep: true })

/*
 * 正文缩放一变，两张图必须**重新量一次容器**。
 *
 * 【为什么只监听 window.resize 不够】
 * 缩放根本不改窗口尺寸，所以那条路一次都不会走。而 ECharts 的 canvas
 * 是在 init / resize 那一刻按容器的 `clientWidth` **写死像素**的；
 * 缩放后容器在布局上变窄了（`zoom` 的规矩：百分比按「父级宽度 ÷ 倍数」解析），
 * canvas 却还是老宽度 —— 被整体放大之后超出内容区，右边直接被裁掉一块。
 * 2026-09-19 实测：200% 时雷达图超出 178px。
 *
 * 主进程那边的顺序是：main.ts 的 watcher 先把 `--mi-zoom` 写进 <html>，
 * 这个 watcher 才跑（它晚于 mount 建立）。`resize()` 内部读 `clientWidth`
 * 会强制一次同步布局，所以拿到的是**缩放之后**的宽度，不用再等一帧。
 */
watch(
  () => zoom.scale,
  () => resize()
)

// ---------------------------------------------------------------- 大白饭仓库卡（2026-10-06）

/**
 * 数据全部来自渲染层的宠物镜像 store（`stores/pet.ts`），这一页不自己问主进程。
 *
 * 【为什么要轮询】新引擎（dsh-pet 宿主）**没有状态推送广播** —— `pet:state` 只有
 * 已退役的旧宠物窗在发。所以进页面拉一次，之后每 5 秒再拉一次。
 *
 * ⚠️ 定时器**不再由本页自持**（P3 ④ 2026-10-08）：侧栏爱心也要这份镜像，
 * 各持一条 = 几条 5s IPC 空转 + 两条各自的退还时机。现在统一走
 * store 的 `ensurePetPoller()`（refcount 单例，5s，见 stores/pet.ts）——
 * 本页与侧栏一起引用它，两边都退出才停表。
 */
const pet = usePetStore()

/**
 * 饭盒余额（n / 上限 999，V1-42）：上限只有 PET_RICE_MAX 一个真源。
 * 拼串复用仓库页的 WAREHOUSE.RICE_N（同一份"n / max"口径，不写第二遍）；
 * 快照还没到画 '--'，**不画 0**（同 WarehouseView 的 riceText 口径：
 * 不许把"没读到"画成"饭盒真空了"）。
 */
const riceBalance = computed(() =>
  pet.snap === null ? '--' : WAREHOUSE.RICE_N(pet.rice, PET_RICE_MAX)
)

/**
 * 快照到了没有（V2-24）。这一卡此前只有余额一处做了 null 守卫，
 * 其余三处（饱腹数字 / 进度条配色 / 喂饭提示）会把 `?? 0` 的假值直接画出去：
 * 饱腹显 0/100、`mood` 为 null 时条染成 error 红、「饭盒空了」——一副鱼被饿扁的
 * 假现场，而同屏侧栏明明画着 '--%'。判据收敛成这一个：没读到就整卡走中性态。
 */
const snapReady = computed(() => pet.snap !== null)

/** 饱腹数字：没读到画 '--'（同余额口径），不画一个假的 0 */
const satietyText = computed(() =>
  snapReady.value ? `${pet.satiety} / ${PET_SATIETY_MAX}` : '--'
)

/** 退出本页时退还轮询引用（幂等，见 store 注释） */
let releasePetPoll: (() => void) | null = null

/** 今天领过几碗运行奖。快照没到位时模板画 '--'（V2-24），这个值只保证是数字 */
const runRewardsToday = computed(() => pet.snap?.runRewardsToday ?? 0)

/**
 * 饱腹条的配色：随心情三档走（happy / ok / hungry）。
 *
 * 【为什么不在这儿重算阈值】`pet.mood` 就是 shared/pet.ts 按饱食度分好的档
 * （happy ≥66 / ok ≥33 / hungry），这里只做「档位 → 令牌」的映射 ——
 * 阈值抄第二遍，就等于埋下"哪天改了档位、这里不跟着改"的假色。
 */
const satietyColor = computed(() => {
  // 快照没到：`pet.mood` 是 null，落到下面会返回 error 红 ——
  // 一条 0% 的红条读起来就是「鱼饿坏了」，但真实情况只是还没读到（V2-24）。
  // 中性灰让"没数据"看起来就是"没数据"。
  if (!snapReady.value) return 'var(--mi-border)'
  if (pet.mood === 'happy') return 'var(--mi-success)'
  if (pet.mood === 'ok') return 'var(--mi-blue-deep)'
  return 'var(--mi-error)'
})

/**
 * 喂饭的两个前提任一不满足就点不动：饭盒空 / 已经吃饱（拒喂口径同 shared/pet.ts 的 feedPet）。
 * `!snapReady` 也在内：余额未知时 `pet.rice` 是 `?? 0` 的假 0，放它进来
 * 会得到一个"基于假数据"的禁用（V2-24 的另一半）。
 */
const feedDisabled = computed(
  () => !snapReady.value || pet.rice <= 0 || pet.satiety >= PET_SATIETY_MAX
)

/** 按钮旁那行提示：按当前状态说清「为什么点不了 / 点了会怎样」（同「还差 N 课」的口径） */
const feedHint = computed(() => {
  // 顺序即优先级：没读到 > 冷却中 > 空 > 满 > 可喂 ——
  // 冷却期里余额与饱腹都正常，放后面会被「喂一碗 +20」盖掉，
  // 那句在刚喂完的当下是假话（按钮点不动，V2-26）。
  if (!snapReady.value) return OVERVIEW.RICE_FEED_HINT_LOADING
  if (feedCooling.value) return OVERVIEW.RICE_FEED_HINT_COOLING
  if (pet.rice <= 0) return OVERVIEW.RICE_FEED_HINT_EMPTY
  if (pet.satiety >= PET_SATIETY_MAX) return OVERVIEW.RICE_FEED_HINT_FULL
  return OVERVIEW.RICE_FEED_HINT_OK(PET_FEED_GAIN)
})

/**
 * 冷却态（V2-26+V2-13）：主进程 brain.ts 对喂饭/摸头共用一个
 * `PET_INTERACT_COOLDOWN_MS`（1.2s）窗口，窗口内的第二次点**完全静默忽略** ——
 * 按钮按下去纹丝不动、数字不变、没有解释，最容易读成"按钮坏了"。
 * 主进程那条静默是注释在案的 v1 取舍（连点的手感归 rua 管），不该动；
 * 这头给按钮补一次「已受理」回执：点完进入 1.2s 冷却态（禁用 + 提示换句），
 * 时长抄同一个常量，两边窗口对齐（视图形状见 :396 起）。
 *
 * 【为什么只挡主窗口这一端】桌宠菜单端的静默在复核里被认定为 v1 取舍、
 * 损失仅"一次徒劳点击"；真正缺的是"点了没回执"，而那正是这里补的。
 */
const feedCooling = ref(false)
let feedCoolTimer: number | null = null
/**
 * 卡片高亮的摘类计时器（700ms，2026-10-17 夜间批挂账）。
 * 原来它是个不带句柄的 window.setTimeout：①组件卸载后仍会触发（改一个已游离
 * 元素的 classList，无害但没人管）；②`at` nonce 变化连续闪两张卡时，前一个
 * 计时器会掐进后一段动画里把它中途摘掉半帧。挂账 + 先清后设，两件事一起解决。
 */
let cardFlashTimer: number | null = null

/** 喂一碗：走 store 的 `act`，它把主进程返回的新快照直接换上，卡片跟着重画 */
function feedPet(): void {
  if (feedCooling.value) return
  void pet.act({ action: 'feed' })
  feedCooling.value = true
  if (feedCoolTimer !== null) window.clearTimeout(feedCoolTimer)
  feedCoolTimer = window.setTimeout(() => {
    feedCooling.value = false
    feedCoolTimer = null
  }, PET_INTERACT_COOLDOWN_MS)
}

/**
 * 拉一次新快照换上的逻辑已挪进 store（`pet.pull()`，经 `ensurePetPoller`
 * 触发）—— 同一份"不能拿 `pet.init()` 当轮询"的理由也随注释挪过去了：
 * init 里的 `if (subscribed) return` 守卫会让第二次调用一个字节都不拉。
 */

// ---------------------------------------------------------------- 每日签到卡（P3 ①，2026-10-08）

/**
 * 卡片上要显示的连签数（空转[2]，2026-10-16）：**按真实日期现算**，
 * 不直接画存档里的 `streakDays` —— 那个数是"上次签到那一刻"的遗物，
 * 链断了它也不会自己过期（忘签一天的人第二天打开，它还是 30；点一下
 * 才当着用户的面掉成 1，全程没人解释）。判定搬在 lib/checkin-streak.ts
 * （`views/` 没有测试，日期算术不许写在这儿）。
 * `broken` 给下面的提示行换说法用：链断着时"每天签到多得 N 碗"不如
 * "断啦、今天重新数起"顶用。
 */
const streakShow = computed(() => streakDisplayOf(progress.checkin, today.value))

/**
 * 月历画的是**本月**（锚在 calendarYear / calendarMonth，见上面那段注释）。
 *
 * 【为什么网格在 lib 里拼】`views/` 不在 vitest 的 include 范围里 ——
 * 日期算术写在组件里就**永远不会被测试**。`buildMonthGrid` 是纯函数，
 * 由 `__tests__/checkin-calendar.test.ts` 钉住周一开头 / 跨月借位 / 闰年。
 */
const monthGrid = computed(() =>
  // 第 4 个参数是月历上"今天"的圈（高-5，2026-10-15）：读活时钟的 `today`
  // 而不是当场调 todayKey() —— 后者在 computed 里不是响应式的，开着过零点
  // 这个圈会停在昨天（和挑战页/签到按钮曾经同一个病）。年月锚（上面那对
  // computed）也走同一份活时钟：跨月那一刻月历跟着翻，不留上一页。
  buildMonthGrid(
    calendarYear.value,
    calendarMonth.value,
    new Set(progress.checkin.days),
    today.value
  )
)

/** 表头七个字分别渲染（`WEEK_HEAD` 是一整串，拆开是因为每字一格对齐网格） */
const weekHeads = CHECKIN.WEEK_HEAD.split('')

/**
 * 格子的悬浮说明/无障碍名。全部由 copy 的键拼出（日期键本身是 ASCII），
 * 空串项滤掉 —— 中文文案不许在这个文件里出现（文案闸门会扫 .vue）。
 */
function cellTitle(cell: CalendarCell): string {
  const marks: string[] = [cell.key]
  if (cell.today) marks.push(CHECKIN.DAY_TODAY)
  if (cell.checked) marks.push(CHECKIN.DAY_DONE)
  return marks.join(' · ')
}

/** 点按钮 → store 的 checkInToday（唯一入口；成功/失败/幂等都由它说话） */
function checkInToday(): void {
  void progress.checkInToday()
}

// ---------------------------------------------------------------- 卡片直达（UI 大修轮 §1.4，2026-10-09）

/**
 * `?card=checkin` 显式深链落到本页时：滚到签到卡 + 一次性高亮。
 * （2026-10-09 模块三起，侧栏/菜单的「总览」入口不再携带 ?card= —— 那条路
 * 走下面的 guideToCheckin 自动引导；本机制保留给显式深链，行为一字未动。）
 *
 * 【为什么抄设置页、不扩 app-nav】`lib/app-nav.ts` 的 card 白名单是设置页导航
 * 的件，本页只有一张卡需要直达 —— 为一条需求去扩公共表，两个页面就互相牵连
 * （契约 §1.4 明确「不扩 app-nav」）。做法逐句同 SettingsView.applyCardQuery：
 * `scrollIntoView` 会滚最近的滚动祖先（本页滚动容器是 App.vue 的
 * `main.content`，拿 documentElement 量恒等于视口高，量不得）→
 * remove/reflow/add 重启动画（同一个 class 连加两次不会重播）→ 定时摘掉。
 */
const CARD_SELECTORS: Record<string, string> = { checkin: '.checkin-card' }

/** 滚到某张卡 + 一次性高亮（深链直达与未签自动引导共用这一段）；没找到返回 null */
function flashCardAt(card: string): HTMLElement | null {
  const sel = CARD_SELECTORS[card]
  if (!sel) return null
  const el = document.querySelector(sel)
  if (!(el instanceof HTMLElement)) return null
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  el.classList.remove('card-flash')
  void el.offsetWidth
  el.classList.add('card-flash')
  // 动画 0.6s（§1.4）：+100ms 余量再摘，别把动画掐掉半帧。
  // 先清上一枚：连续闪两张卡时旧计时器不许伸进新动画里（见 cardFlashTimer 的注释）
  if (cardFlashTimer !== null) window.clearTimeout(cardFlashTimer)
  cardFlashTimer = window.setTimeout(() => {
    cardFlashTimer = null
    el.classList.remove('card-flash')
  }, 700)
  return el
}

function applyCardQuery(): void {
  const card = typeof route.query.card === 'string' ? route.query.card : ''
  flashCardAt(card)
}

/**
 * 未签到的自动引导（2026-10-09 模块三：签到入口并入「总览」）。
 *
 * 侧栏/菜单的「总览」入口落到本页（plain /overview）：档案读完、今天还没签
 * → 滚到签到卡、闪一下、把焦点给签到按钮（回车即签，键盘党一步到位）。
 * 【为什么先拦 route.query.card】带 ?card=checkin 的显式深链本身就会闪
 * （上面那套），两条不叠加；带任何 card 时本函数让位。
 * 【为什么等 loaded】档案没读完分不清「没签」与「还不知道」—— 同侧栏红点口径。
 * 【为什么 focus 带 preventScroll】smooth 滚动进行中，默认聚焦滚动会把它顶掉。
 * 已签到时静默（没有要引导的事）—— 这是与深链路径的有意差别。
 */
function guideToCheckin(): void {
  if (route.query.card) return
  if (!progress.loaded || progress.checkedInToday) return
  const el = flashCardAt('checkin')
  if (el === null) return
  const btn = el.querySelector('button:not([disabled])')
  if (btn instanceof HTMLElement) btn.focus({ preventScroll: true })
}

// 已在总览页时（query 变了但 path 没变，router-view 的 :key 是 route.path，
// 组件不重挂载）靠 card 的变化重跑；首次进入走 onMounted。
watch(
  () => route.query.card,
  () => applyCardQuery()
)

// 档案装载完成的那一拍补一次「未签引导」：应用刚启动就落在 /overview 时，
// 挂载那刻 loaded 还是 false，只有这里能接住；之后每次重新进入 /overview
// 由 onMounted 接力（:key=route.path，换路径必重挂载）。
watch(
  () => progress.loaded,
  (loaded) => {
    if (loaded) guideToCheckin()
  }
)

onMounted(() => {
  void pet.init()
  // 轮询走全应用单例（refcount 5s）：第一个引用者立即拉一次再上表 ——
  // 「进页面这里显式对齐一次画的是现在而不是上次离开时」的语义没变。
  releasePetPoll = pet.ensurePetPoller()
  // 直达最后做：签到卡在模板里是静态的（无 v-if），挂载时已在 DOM，量得到
  applyCardQuery()
  // 未签引导只在「档案已就绪」时才有结论（刚启动那一刻 loaded 还是 false，
  // 由上面 loaded 的 watcher 补上第二拍）
  guideToCheckin()
})

onBeforeUnmount(() => {
  // 退还引用：本页退出后侧栏还挂着表就继续跑（单例的意义），
  // 都退了才真的停 —— 切走之后还跑一条谁也不看的空转 IPC 是不行的。
  releasePetPoll?.()
  releasePetPoll = null
  // 喂饭冷却表同理：本页一卸载它就没人看也没人清，留着就是一条
  // 握着组件闭包的孤儿计时器（setTimeout 不像 interval 会自停）。
  if (feedCoolTimer !== null) {
    window.clearTimeout(feedCoolTimer)
    feedCoolTimer = null
  }
  // 卡片高亮同理（2026-10-17 夜间批）：卸载后不再对一个游离元素动 classList
  if (cardFlashTimer !== null) {
    window.clearTimeout(cardFlashTimer)
    cardFlashTimer = null
  }
})
</script>

<template>
  <div class="overview">
    <div class="hero">
      <MiMascot pose="expect" size="m" />
      <div class="hero-text">
        <h1 class="page-title">{{ TITLE.OVERVIEW }}</h1>
        <p class="hero-sub">{{ TITLE.OVERVIEW_SUB }}</p>
      </div>
    </div>

    <!--
      每日签到卡（P3 ①）：插在 hero 与总览卡之间 —— 它是"每天来一次"的入口，
      值得占一块视线落点；数据全来自 progress store（不自己问主进程）。
    -->
    <MiCard class="checkin-card" :title="CHECKIN.TITLE">
      <div class="checkin-main">
        <div class="checkin-side">
          <p class="checkin-streak">{{ CHECKIN.STREAK(streakShow.streak) }}</p>
          <p class="checkin-total">{{ CHECKIN.TOTAL(progress.checkin.totalDays) }}</p>
          <MiButton
            size="sm"
            :disabled="!progress.loaded || progress.checkedInToday"
            @click="checkInToday"
          >
            {{ progress.checkedInToday ? CHECKIN.BTN_DONE : CHECKIN.BTN }}
          </MiButton>
          <p class="checkin-hint">
            {{ streakShow.broken ? CHECKIN.HINT_BROKEN : CHECKIN.HINT(PET_CHECKIN_RICE) }}
          </p>
        </div>
        <div class="checkin-calendar">
          <div class="checkin-month">{{ CHECKIN.MONTH(calendarYear, calendarMonth) }}</div>
          <div class="checkin-week">
            <span v-for="w in weekHeads" :key="w" class="checkin-week-cell">{{ w }}</span>
          </div>
          <div class="checkin-grid">
            <span
              v-for="cell in monthGrid.flat()"
              :key="cell.key"
              class="checkin-cell"
              :class="{ 'is-out': !cell.inMonth, 'is-checked': cell.checked, 'is-today': cell.today }"
              :title="cellTitle(cell)"
            >
              {{ cell.day }}
            </span>
          </div>
        </div>
      </div>
    </MiCard>

    <!-- 整体进度 -->
    <MiCard class="summary-card">
      <div class="summary-main">
        <MiProgressRing :percent="allPercent" :size="110" :stroke="10" :label="allPercent + '%'" />
        <div class="summary-stats">
          <div class="stat">
            <div class="stat-num">{{ progress.profile.learned.length }}<span class="stat-unit">{{ OVERVIEW.learnedOfTotal(content.totalLessons) }}</span></div>
            <div class="stat-label">{{ OVERVIEW.STAT_LEARNED }}</div>
          </div>
          <!-- V1-23：这颗数字从"看得见摸不着"改成真入口 —— 它数的就是课级
               收藏（profile.favorites），点进收藏页的「收藏的课」分区。
               整格是 <button>（键盘可达批的口径：能点的东西就是按钮）。 -->
          <button type="button" class="stat stat-link" @click="router.push('/favorites')">
            <div class="stat-num">{{ progress.profile.favorites.length }}<span class="stat-unit">{{ OVERVIEW.UNIT_LESSON }}</span></div>
            <div class="stat-label">{{ OVERVIEW.STAT_FAVORITES }}</div>
          </button>
          <div class="stat">
            <div class="stat-num">{{ progress.profile.history.length }}<span class="stat-unit">{{ OVERVIEW.UNIT_TIMES }}</span></div>
            <div class="stat-label">{{ OVERVIEW.STAT_HISTORY }}</div>
            <!-- V1-27：history 是流水账（取消标记不减、重复标记再加），
                 「N 次」会大于「已学 M 课」—— 口径小字防"统计坏了"误判 -->
            <div class="stat-note">{{ OVERVIEW.STAT_HISTORY_NOTE }}</div>
          </div>
        </div>
      </div>
    </MiCard>

    <!--
      大白饭仓库（2026-10-06）：喂饭入口从设置卡搬来总览页 —— 学习赚大白饭、
      大白饭换饱腹，这个闭环放在天天看得到的地方，比藏在设置里更像「养它」这件事。
      数据 = 宠物镜像快照（stores/pet.ts）；宿主没有推送，靠 5s 轮询（见脚本段）。
    -->
    <MiCard class="rice-card" :title="OVERVIEW.RICE_TITLE">
      <div class="rice-main">
        <div class="stat">
          <div class="stat-num">
            {{ riceBalance }}<span class="stat-unit">{{ OVERVIEW.RICE_BALANCE_UNIT }}</span>
          </div>
          <div class="stat-label">{{ OVERVIEW.RICE_BALANCE_LABEL }}</div>
        </div>
        <div class="rice-satiety">
          <div class="rice-satiety-head">
            <span>{{ OVERVIEW.RICE_SATIETY_LABEL }}</span>
            <span class="rice-satiety-num">{{ satietyText }}</span>
          </div>
          <MiProgressBar :percent="pet.satiety" :color="satietyColor" :height="10" />
        </div>
      </div>
      <div class="rice-foot">
        <MiButton size="sm" :disabled="feedDisabled || feedCooling" @click="feedPet">
          {{ OVERVIEW.RICE_FEED_BTN }}
        </MiButton>
        <span class="rice-hint">{{ feedHint }}</span>
        <span class="rice-today">
          {{ OVERVIEW.RICE_TODAY(snapReady ? runRewardsToday : '--', PET_RUN_REWARD_DAILY_MAX) }}
        </span>
      </div>
    </MiCard>

    <!--
      各语言进度 + 阶段完成度。
      ⚠️ 2026-10-01 起这里**只有进度本身**：原来挂在阶段行尾和整门行上的
      「综合练习」按钮已删，入口在练习页的「阶段练习」页签 + 侧栏阶段末尾
      （组卷逻辑见 `lib/stage-practice.ts` 的 `useStagePaperFlow`）。
    -->
    <div class="lang-grid">
      <MiCard v-for="p in perLang" :key="p.lang" :title="'🐾 ' + (LANG_LABEL[p.lang] ?? p.lang)">
        <div class="lang-row">
          <MiProgressBar :percent="p.percent" show-label :height="8" />
        </div>
        <div class="stage-rows">
          <div v-for="s in p.stages" :key="s.stage" class="stage-row">
            <span class="stage-name">{{ STAGE_LABEL[s.stage] }}</span>
            <MiProgressBar :percent="s.percent" :height="5" />
            <span class="stage-count">{{ s.learned }}/{{ s.total }}</span>
          </div>
        </div>
      </MiCard>
    </div>

    <!-- 图表 -->
    <div class="chart-grid">
      <MiCard :title="TITLE.RADAR_CARD">
        <div ref="radarEl" class="chart" />
      </MiCard>
      <MiCard :title="TITLE.calendarCard(calendarYear)">
        <div v-if="calendarData.length > 0" ref="calendarEl" class="chart chart-calendar" />
        <MiEmpty v-else v-bind="EMPTY.CALENDAR_EMPTY" />
      </MiCard>
    </div>
  </div>
</template>

<style scoped>
.overview {
  max-width: 960px;
  margin: 0 auto;
}
.page-title {
  font-family: var(--mi-font-title);
  font-size: 20px;
  margin-bottom: 4px;
}
.hero {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}
.hero-sub {
  font-size: 13px;
  color: var(--mi-text-2);
}
.summary-card {
  margin-bottom: 16px;
}
.summary-main {
  display: flex;
  align-items: center;
  gap: 32px;
  padding: 8px;
}
.summary-stats {
  display: flex;
  gap: 40px;
}
.stat-num {
  font-family: var(--mi-font-title);
  font-size: 26px;
  font-weight: 700;
  color: var(--mi-text);
}
.stat-unit {
  font-size: 13px;
  font-weight: 400;
  color: var(--mi-text-3);
}
.stat-label {
  margin-top: 4px;
  font-size: 12px;
  color: var(--mi-text-2);
}
/*
 * V1-23：收藏那格现在是真入口（<button>，见模板注释）。
 * button 默认外观重置（.stat 本身没有别的规则，重置干净即可）；
 * 悬停时数字提亮成蓝、focus-visible 描边 —— 「这里能点」的两个落点。
 */
button.stat-link {
  padding: 0;
  border: 0;
  background: none;
  font-family: inherit;
  line-height: inherit;
  color: inherit;
  text-align: left;
  cursor: var(--mi-cursor, pointer);
}
.stat-link:hover .stat-num {
  color: var(--mi-blue-deep);
}
.stat-link:focus-visible {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 2px;
  border-radius: 4px;
}
/* V1-27：流水账口径小字（history 含重复标记，会大于已学课数） */
.stat-note {
  margin-top: 2px;
  font-size: 11px;
  color: var(--mi-text-3);
}
/*
 * 「大白饭仓库」卡：左饭盒余额、右饱腹条，底下喂饭按钮。
 * 余额那一格直接沿用上面 summary 卡的 .stat-num/.stat-unit/.stat-label
 * （同一套字号，别在这里再抄一份）；条的颜色由 MiProgressBar 的 color 口
 * 吃现成功能令牌，本卡不新增任何色值。
 */
.rice-card {
  margin-bottom: 16px;
}
.rice-main {
  display: flex;
  align-items: center;
  gap: 32px;
}
.rice-satiety {
  flex: 1;
  min-width: 0;
}
/* 「饱腹度 …… 62 / 100」这一行：标签与读数分列两端 */
.rice-satiety-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--mi-text-2);
}
.rice-satiety-num {
  color: var(--mi-text-3);
  font-variant-numeric: tabular-nums;
}
.rice-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}
.rice-hint {
  font-size: 12px;
  color: var(--mi-text-3);
}
/* 今日运行奖：靠右的角落小字（tabular-nums 防数字变化时左右抖） */
.rice-today {
  margin-left: auto;
  font-size: 12px;
  color: var(--mi-text-3);
  font-variant-numeric: tabular-nums;
}
/*
 * 「每日签到」卡（P3 ①）：左边文字（连签/累计/按钮/提示）、右边当月月历。
 * 配色全部走令牌，且**每个前景/背景对都取自已达标的组合**：
 *   · 普通格   --mi-text-2     压在卡片 --mi-card 上
 *   · 借位格   --mi-text-3     （月历里前后月那几号，仍需 4.5 能读）
 *   · 已签格   --mi-text 压在 --mi-blue-light 上（同"当前行高亮"那对，8.29）
 *   · 今天标记 一道 --mi-blue-deep 的内阴影环（装饰，不是文字）
 * 别顺手改成"蓝底蓝字"：--mi-blue-deep 压 --mi-blue-light 只有 2.0，读不清。
 */
.checkin-card {
  margin-bottom: 16px;
}
/*
 * 签到卡一次性高亮（§1.4）：从侧栏「每日签到」直达时闪一下。
 * 形状逐句同设置页 .card-flash（0%/65%/100% 三帧、只动 box-shadow），
 * 只有时长按本契约改成 0.6s —— **绝不写 opacity**：全库 opacity 声明数是
 * wall-glass.test.ts 的快照件，本轮一个都不许新增（动画也一样）。
 */
.card-flash {
  animation: card-flash 0.6s ease;
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
.checkin-main {
  display: flex;
  align-items: flex-start;
  gap: 32px;
  /* 窄窗（800px 档）下让月历掉到第二行，而不是把左列挤成一条 */
  flex-wrap: wrap;
}
.checkin-side {
  flex: 1;
  min-width: 180px;
}
.checkin-streak {
  font-family: var(--mi-font-title);
  font-size: 16px;
  font-weight: 700;
  color: var(--mi-text);
}
.checkin-total {
  margin-top: 2px;
  font-size: 12px;
  color: var(--mi-text-2);
}
.checkin-side :deep(.mi-btn) {
  margin-top: 10px;
}
.checkin-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--mi-text-3);
}
.checkin-calendar {
  flex-shrink: 0;
  width: 238px;
}
.checkin-month {
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--mi-text-2);
  text-align: center;
}
/* 表头与网格用同一套列定义，七个字必须和七个格子逐列对齐 —— 差一列整个月都会错位 */
.checkin-week,
.checkin-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}
.checkin-week-cell {
  text-align: center;
  font-size: 11px;
  color: var(--mi-text-3);
}
.checkin-cell {
  text-align: center;
  line-height: 24px;
  height: 24px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--mi-text-2);
  font-variant-numeric: tabular-nums;
}
.checkin-cell.is-out {
  color: var(--mi-text-3);
}
.checkin-cell.is-checked {
  background: var(--mi-blue-light);
  color: var(--mi-text);
  font-weight: 700;
}
/* 今天：内阴影画环（不动盒子尺寸，不会把网格挤歪） */
.checkin-cell.is-today {
  box-shadow: inset 0 0 0 1px var(--mi-blue-deep);
}
.lang-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}
.lang-row {
  margin-bottom: 10px;
}
.stage-rows {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.stage-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.stage-name {
  flex-shrink: 0;
  width: 28px;
  font-size: 12px;
  color: var(--mi-text-2);
}
.stage-row :deep(.mi-progress) {
  flex: 1;
}
.stage-count {
  flex-shrink: 0;
  width: 42px;
  text-align: right;
  font-size: 11px;
  color: var(--mi-text-3);
}
/*
 * 图表区**一列排**。这不是审美选择，是宽度算出来的：
 *
 * 学习日历是整年的热力图，**53 列**。原来和雷达图各占 1fr，实测在 1186px 的
 * 窗口里日历只剩 **237px** —— 减掉左右留白后每格 **3.6px**，格子本身细成了
 * 一根根线；月份标签的间距 17px，而"12月"宽 26px，**重叠 9px**，糊成一片。
 * 这就是"月份数字和汉字挤在一起"的来历（量法见日历宽度实测）。
 *
 * 摊成一列之后日历拿到整幅 554px，每格 9.6px、标签间距 45px（余量 +19px）。
 * 雷达图不受影响：ECharts 的雷达半径由**高度**定，容器变宽它只是居中，
 * 图形本身不会变形。
 */
.chart-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}
.chart {
  width: 100%;
  height: 260px;
}
/*
 * 日历比雷达矮一截。它的高度是可以算出来的：
 * 顶部月份那一行 44px ＋ 7 行 × 16px 的格子 ＝ 156px，给 172 留一点底边。
 * 按 260 给的话，图下面会空掉小半张卡 —— 那正是主人截图里日历下方那块空白。
 * 雷达图相反，它是圆的、要吃满高度，所以只有日历单独设高度。
 */
.chart-calendar {
  height: 172px;
}
</style>
