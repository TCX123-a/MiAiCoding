<script setup lang="ts">
/**
 * 「壁纸属性」面板 —— P3 第四步（2026-10-05），深度对齐 elysia395/dsh-wallpaper-engine
 * 的「壁纸属性」面板（上游：https://github.com/elysia395/dsh-wallpaper-engine；
 * MIT，Copyright (c) 2026 elysia395；许可证全文见 THIRD-PARTY-CODE-NOTICES.md）。
 *
 * 源码逐段读过：main 侧 we-props.js 解析、client.js 的
 * renderPickerPropsPanel 渲染、picker-props-panel.js 的各 ptype 控件分支）。
 *
 * 【两段结构】
 *  · A 段「壁纸自带属性」= 壁纸作者在 project.json 的 general.properties 里声明的
 *    可调项，解析成控件（bool/color/slider/combo/text…），`condition` 不满足的行
 *    隐藏（fail open）；解析器打了 promo 标记的第三方推广行（赞助/社交入口/二维码图）
 *    不进面板 —— 只影响本面板，推送照旧全量（见 rows 注释）。改动存进
 *    config.wallpaper.itemProps[itemId]，与声明默认相同
 *    即删覆盖（DSH 的 saveUserProp 口径）。**画面链路已接通（2026-10-05：场景引擎
 *    接入 + 文字热更修复）**：改动经 WallpaperLayer.pushSceneProps 全量推给运行中的
 *    场景实例，改完当帧生效；顶部另有「重新应用」按钮作手动同步口（画面没跟上、
 *    或场景挂载失败降级成海报后的重试）。
 *  · B 段「本张微调」= 我们自己的补充（DSH 只有全局调节），逐张叠加在全局设置之上：
 *    翻转 / 亮度 / 对比度 / 饱和度 / 模糊 / 透明度 / 缩放 / 倍速，存进
 *    config.wallpaper.itemTuning[itemId]，按 itemId 各记各的（换壁纸不丢）。
 *
 * 【拖动口径（2G 低内存底线）】滑块拖动中**只改内存态**（A 段 liveProp / B 段
 * liveTuneNum），松手（change）才走 setWallpaper 落一次盘 —— 与「画面」页签的
 * 老滑块同一先例（input 每帧写盘在低配机上会把 IO 打满）。B 段的实时画面由
 * WallpaperLayer 对 itemTuning 的深侦听驱动，改动当帧可见。
 *
 * 【控件口径照 DSH 逐条对齐，别顺手「简化」】
 *  · color：值域是 `"r g b"`（0~1 浮点），取色器要 #rrggbb → 两个转换函数照抄
 *    weColorToHex / weHexToColor；写回**恒为三位小数的浮点三元组**（壁纸脚本认它）。
 *  · combo：选项值可能是数字/字符串/布尔混用，select 的 value 用**下标**，回写取回
 *    声明类型（字符串化会让壁纸里的 === / switch 全部失配）。
 *  · slider：min/max/step/precision 缺省口径同 DSH（0 / 1 / (max-min)/100 / 2 位小数）。
 *  · combo 选项级的 condition **不筛**（DSH 的渲染器就没筛）—— 筛了会让「当前值落在
 *    被隐藏选项上」这种合法状态没法回选。
 *  · 「已改」圆点 + 「恢复默认」按钮：同 DSH（dot 的 title 文案在 copy 里）。
 *
 * ⚠️ 本组件被 wall-glass.test.ts 的 opacity 快照闸门全库扫描：**不许出现小写的
 * `opacity:` 文本**（CSS 声明、对象字面量键名都算命中）。禁用态用颜色与光标表达。
 */
import { computed, ref, watch } from 'vue'
import { useSettingsStore } from '../../stores/settings'
import { SETTINGS } from '../../lib/copy'
import { findCatalogItem } from '../../lib/wallpaper/catalog'
import { cachedItemProps, loadItemProps } from '../../lib/wallpaper/item-props'
import { requestWallpaperReapply } from '../../lib/wallpaper/reapply'
import {
  BLUR_MAX,
  BLUR_MIN,
  MEDIA_ADJUST_MAX,
  MEDIA_ADJUST_MIN,
  OPACITY_MAX,
  OPACITY_MIN,
  WALLPAPER_RATE_STEPS,
  ZOOM_MAX,
  ZOOM_MIN,
  type WallpaperItemTune,
  type WallpaperPropsResult
} from '../../../../shared/wallpaper'
import {
  filterKnownOverrides,
  parseUserPropDefs,
  type WallpaperPropEntry,
  type WallpaperPropValue
} from '../../../../shared/wallpaper-props'
import { weEvalCondition } from '../../../../shared/we-cond'
import MiSelect from '../base/MiSelect.vue'
import MiSwitch from '../base/MiSwitch.vue'
import MiTabs from '../base/MiTabs.vue'

const settings = useSettingsStore()
const wall = computed(() => settings.config.wallpaper)
const selId = computed(() => wall.value.selectedId)
/** 壁纸总开关关着时控件全灰（与页签里其他控件同口径） */
const ctlOff = computed(() => !wall.value.enabled)
const current = computed(() => findCatalogItem(selId.value))
const currentName = computed(() => current.value?.title ?? selId.value)

// ---------------------------------------------------------------- A 段：原文加载

interface PropLoad {
  id: string
  loading: boolean
  res: WallpaperPropsResult | null
}

/** 按 id 懒加载 + 缓存（lib/wallpaper/item-props.ts）；换壁纸时旧表整体作废 */
const propState = ref<PropLoad>({ id: '', loading: false, res: null })

watch(
  selId,
  (id) => {
    if (!id) {
      propState.value = { id: '', loading: false, res: null }
      return
    }
    const hit = cachedItemProps(id)
    if (hit) {
      propState.value = { id, loading: false, res: hit }
      return
    }
    propState.value = { id, loading: true, res: null }
    void loadItemProps(id).then((res) => {
      // 期间换了壁纸：丢弃（迟到的答复不许覆盖新表 —— DSH 的 stale-token 同款）
      if (propState.value.id === id) propState.value = { id, loading: false, res }
    })
  },
  { immediate: true }
)

/** 读得到 project.json（场景包）才有「重新应用」可言 —— 视频/图片壁纸用不到 */
const engineProps = computed(() => !!propState.value.res?.project)

/** 「重新应用」：只发请求，结果由壁纸层按现场定并 toast（面板不猜结果） */
function onReapply(): void {
  requestWallpaperReapply()
}

/** 解析成控件行（覆盖值合并进 value；order 已在解析器里排好）。
 *  promo 行（作者夹带的赞助/社交入口/二维码图，解析器已判定）**只在这里隐藏**：
 *  推送链路（WallpaperLayer.pushSceneProps）照旧拿全量，画面零变化；行本身也还在
 *  解析结果里（绝不整条丢弃），已有覆盖值继续下发。 */
const rows = computed<WallpaperPropEntry[]>(() => {
  const st = propState.value
  if (!st.res?.project) return []
  return parseUserPropDefs(st.res.project, wall.value.itemProps[st.id] ?? {}).filter((r) => !r.promo)
})

/** 条件求值的「属性名 → 当前值」表（text/group 不进表 —— 它们没有值，照 DSH）。
 *  promo 行不进 rows，自然也进不了表：条件引用到它们时与「引用一个不存在的属性名」
 *  同语义（作者删掉属性后本来就这样），是有意口径。 */
const condValues = computed<Record<string, WallpaperPropValue | undefined>>(() => {
  const v: Record<string, WallpaperPropValue | undefined> = {}
  for (const r of rows.value) {
    if (r.ptype !== 'text' && r.ptype !== 'group') v[r.name] = r.value ?? undefined
  }
  return v
})

const visibleRows = computed(() =>
  rows.value.filter((r) => !r.condition || weEvalCondition(r.condition, condValues.value))
)

/** 「恢复默认」亮不亮：按**存量键**判（含作者已删属性留下的陈旧覆盖，重置要能清掉）。
 *  ⚠️ 别改成「按可见行判」：promo 行面板不可见，但它们留过的覆盖照旧推给画面
 *  （渲染零变化），重置必须还能把它们清掉 —— 按可见行判会让这些键永远清不掉。 */
const hasOverrides = computed(() => {
  const ov = wall.value.itemProps[propState.value.id]
  return !!ov && Object.keys(ov).length > 0
})

// ---------------------------------------------------------------- A 段：写入

function writeItemProps(id: string, cur: Record<string, WallpaperPropValue>): void {
  // 顺手清掉「壁纸作者已改名/删掉」留下的陈旧覆盖键（filterKnownOverrides 的用途）。
  // ⚠️ project 读不到时**不剪** —— 拿 null 当「一个属性都没声明过」会把用户
  // 攒下的微调一把清空，失败即值不许走到破坏性分支
  const project = propState.value.id === id ? propState.value.res?.project ?? null : null
  const next = project ? filterKnownOverrides(project, cur) : cur
  const all: Record<string, Record<string, WallpaperPropValue>> = { ...wall.value.itemProps }
  if (Object.keys(next).length > 0) all[id] = next
  else delete all[id]
  void settings.setWallpaper({ itemProps: all })
}

/** 宽松相等（同 DSH 的 sameUserPropValue）：跨 JSON 往返 "1" 与 1 是常态 */
function samePropValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  return false
}

/** 提交一个自带属性（值 == 声明默认 → 删覆盖，同 DSH 的 saveUserProp） */
function commitProp(row: WallpaperPropEntry, value: WallpaperPropValue): void {
  const id = propState.value.id
  if (!id) return
  const cur = { ...(wall.value.itemProps[id] ?? {}) }
  if (samePropValue(value, row.default)) delete cur[row.name]
  else cur[row.name] = value
  writeItemProps(id, cur)
}

/** 拖动路过的值：只改内存态（画面/数值实时跟着走），落盘留给 change 那一下 */
function liveProp(row: WallpaperPropEntry, value: WallpaperPropValue): void {
  const id = propState.value.id
  if (!id) return
  const tbl = settings.config.wallpaper.itemProps
  if (!tbl[id]) tbl[id] = {}
  tbl[id][row.name] = value
}

function resetProps(): void {
  const id = propState.value.id
  if (id) writeItemProps(id, {})
}

// ---------------------------------------------------------------- A 段：控件口径

/** slider 缺省口径同 DSH：min 0 / max 1 / step (max-min)/100 / 2 位小数 */
function sliderMin(r: WallpaperPropEntry): number {
  return typeof r.min === 'number' ? r.min : 0
}
function sliderMax(r: WallpaperPropEntry): number {
  return typeof r.max === 'number' ? r.max : 1
}
function sliderStep(r: WallpaperPropEntry): number {
  if (typeof r.step === 'number' && r.step > 0) return r.step
  return (sliderMax(r) - sliderMin(r)) / 100
}
function sliderDigits(r: WallpaperPropEntry): number {
  return typeof r.precision === 'number' ? Math.max(0, Math.min(6, r.precision)) : 2
}
function sliderShown(r: WallpaperPropEntry): string {
  if (typeof r.value === 'number') return r.value.toFixed(sliderDigits(r))
  return r.value === null ? '' : String(r.value)
}
function sliderVal(r: WallpaperPropEntry): number {
  return typeof r.value === 'number' ? r.value : sliderMin(r)
}

/** combo 当前下标（找不到时落 0，同 DSH 的 Math.max(0, findIndex)） */
function comboIdx(r: WallpaperPropEntry): string {
  const opts = r.options ?? []
  return String(Math.max(0, opts.findIndex((o) => samePropValue(o.value, r.value))))
}
function comboOptions(r: WallpaperPropEntry): Array<{ label: string; value: string }> {
  return (r.options ?? []).map((o, i) => ({ label: o.label, value: String(i) }))
}
function onComboPick(r: WallpaperPropEntry, v: string): void {
  const o = (r.options ?? [])[Number(v)]
  if (o) commitProp(r, o.value)
}

/** "r g b"（0~1 浮点）→ #rrggbb；解析不了显示 #000000（DSH 原样口径） */
function colorToHex(v: WallpaperPropValue | null): string {
  if (typeof v !== 'string') return '#000000'
  const parts = v.trim().split(/\s+/).map(Number)
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return '#000000'
  const hex = parts
    .slice(0, 3)
    .map((n) => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, '0'))
    .join('')
  return '#' + hex
}

/** #rrggbb → "r g b"（0~1 三位小数）—— 写回恒用它（壁纸脚本认这个格式，DSH 同款） */
function hexToColor(hex: string): string {
  const h = String(hex || '').replace(/^#/, '')
  if (h.length !== 6) return '0 0 0'
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  return [r, g, b].map((n) => Math.round(n * 1000) / 1000).join(' ')
}

// ---------------------------------------------------------------- B 段：本张微调

type NumField = 'brightness' | 'contrast' | 'saturate' | 'blur' | 'opacity' | 'zoom'

/** 数值项的中性值（等于它 = 没调 = 删键；语义三态见 WallpaperItemTune 接口注释） */
function neutralOf(field: NumField): number {
  if (field === 'blur') return BLUR_MIN
  if (field === 'zoom') return 1
  if (field === 'opacity') return OPACITY_MAX
  return 1
}

const tune = computed<WallpaperItemTune>(() => {
  const id = selId.value
  return id ? wall.value.itemTuning[id] ?? {} : {}
})

const hasTune = computed(() => {
  const t = selId.value ? wall.value.itemTuning[selId.value] : undefined
  return !!t && Object.keys(t).length > 0
})

const effFlipH = computed(() => tune.value.flipH ?? wall.value.flip)
const effRate = computed(() => tune.value.playbackRate ?? wall.value.playbackRate)
/** 倍速只对视频形态有意义；图片/场景（本步是海报）置灰 */
const rateOff = computed(() => ctlOff.value || current.value?.type !== 'video')

function writeTuning(id: string, cur: WallpaperItemTune): void {
  const all: Record<string, WallpaperItemTune> = { ...wall.value.itemTuning }
  if (Object.keys(cur).length > 0) all[id] = cur
  else delete all[id]
  void settings.setWallpaper({ itemTuning: all })
}

function setTune(field: keyof WallpaperItemTune, value: number | boolean | undefined): void {
  const id = selId.value
  if (!id) return
  const cur: WallpaperItemTune = { ...(wall.value.itemTuning[id] ?? {}) }
  if (value === undefined) delete cur[field]
  else if (typeof value === 'boolean' && (field === 'flipH' || field === 'flipV')) cur[field] = value
  else if (typeof value === 'number' && field !== 'flipH' && field !== 'flipV') cur[field] = value
  writeTuning(id, cur)
}

function onFlipH(v: boolean): void {
  setTune('flipH', v)
}
function onFlipV(v: boolean): void {
  // false 与 undefined 等价（净化会丢 false）—— 开局就按「跟随」存
  setTune('flipV', v ? true : undefined)
}

/** 拖动中路过的微调值：只改内存态（WallpaperLayer 对 itemTuning 深侦听，当帧可见） */
function liveTuneNum(field: NumField, v: number): void {
  const id = selId.value
  if (!id) return
  const tbl = settings.config.wallpaper.itemTuning
  if (!tbl[id]) tbl[id] = {}
  tbl[id][field] = v
}

function commitTuneNum(field: NumField, v: number): void {
  setTune(field, v === neutralOf(field) ? undefined : v)
}

function tuneVal(field: NumField): number {
  const v = tune.value[field]
  return typeof v === 'number' ? v : neutralOf(field)
}
function tuneSet(field: NumField): boolean {
  return typeof tune.value[field] === 'number'
}

const flipHSet = computed(() => tune.value.flipH !== undefined)
const flipVSet = computed(() => tune.value.flipV === true)
const rateSet = computed(() => typeof tune.value.playbackRate === 'number')

/** 倍速六档（真源 = shared 的 WALLPAPER_RATE_STEPS，与「播放」页签共用一张表） */
const rateTabs = WALLPAPER_RATE_STEPS.map((v) => ({ key: String(v), label: `${v}×` }))
function onRatePick(v: string): void {
  const n = Number(v)
  if (!(WALLPAPER_RATE_STEPS as readonly number[]).includes(n)) return
  setTune('playbackRate', n)
}

function resetTune(): void {
  const id = selId.value
  if (id) writeTuning(id, {})
}

const pctFmt = (v: number): string => `${Math.round(v * 100)}%`
const pxFmt = (v: number): string => `${Math.round(v)} px`

interface TuneRow {
  field: NumField
  label: string
  hint: string
  min: number
  max: number
  step: number
  fmt: (v: number) => string
}

/** 滑块行（顺序即面板顺序）：前三行乘在全局之上，模糊相加，透明度/缩放乘算 */
const TUNE_ROWS: TuneRow[] = [
  { field: 'brightness', label: SETTINGS.LABEL_WALL_TUNE_BRIGHTNESS, hint: SETTINGS.WALL_TUNE_BRIGHTNESS_HINT, min: MEDIA_ADJUST_MIN, max: MEDIA_ADJUST_MAX, step: 0.05, fmt: pctFmt },
  { field: 'contrast', label: SETTINGS.LABEL_WALL_TUNE_CONTRAST, hint: SETTINGS.WALL_TUNE_CONTRAST_HINT, min: MEDIA_ADJUST_MIN, max: MEDIA_ADJUST_MAX, step: 0.05, fmt: pctFmt },
  { field: 'saturate', label: SETTINGS.LABEL_WALL_TUNE_SATURATE, hint: SETTINGS.WALL_TUNE_SATURATE_HINT, min: MEDIA_ADJUST_MIN, max: MEDIA_ADJUST_MAX, step: 0.05, fmt: pctFmt },
  { field: 'blur', label: SETTINGS.LABEL_WALL_TUNE_BLUR, hint: SETTINGS.WALL_TUNE_BLUR_HINT, min: BLUR_MIN, max: BLUR_MAX, step: 1, fmt: pxFmt },
  { field: 'opacity', label: SETTINGS.LABEL_WALL_TUNE_OPACITY, hint: SETTINGS.WALL_TUNE_OPACITY_HINT, min: OPACITY_MIN, max: OPACITY_MAX, step: 1, fmt: pctFmt },
  { field: 'zoom', label: SETTINGS.LABEL_WALL_TUNE_ZOOM, hint: SETTINGS.WALL_TUNE_ZOOM_HINT, min: ZOOM_MIN, max: ZOOM_MAX, step: 0.05, fmt: pctFmt }
]

// 两段的折叠开合（默认都摊开 —— 进来就能看见东西，折叠是给「看过了想收起来」的）
const secAOpen = ref(true)
const secBOpen = ref(true)
</script>

<template>
  <div class="wp-props">
    <p v-if="!selId" class="wp-hint wp-hint--lead">{{ SETTINGS.WALL_PROPS_NO_SEL }}</p>

    <template v-else>
      <p class="wp-props-for">{{ SETTINGS.WALL_PROPS_FOR }}{{ currentName }}</p>

      <!-- 手动同步口：属性改了画面没跟上时点一下（2026-10-05 文字热更修复配套） -->
      <div v-if="engineProps" class="wp-apply">
        <button type="button" class="wp-apply-btn" :disabled="ctlOff" @click="onReapply">
          {{ SETTINGS.WALL_PROPS_REAPPLY }}
        </button>
        <span class="wp-apply-hint">{{ SETTINGS.WALL_PROPS_REAPPLY_HINT }}</span>
      </div>

      <!-- A 段：壁纸自带属性（作者声明的 general.properties） -->
      <div class="wp-sec">
        <div class="wp-sec-head">
          <button type="button" class="wp-sec-toggle" @click="secAOpen = !secAOpen">
            <span class="wp-arrow" :class="{ open: secAOpen }">▸</span>
            <span class="wp-sec-title">{{ SETTINGS.WALL_PROPS_SEC_A }}</span>
          </button>
          <button type="button" class="wp-reset" :disabled="!hasOverrides" @click="resetProps">
            {{ SETTINGS.WALL_PROPS_RESET }}
          </button>
        </div>
        <div v-show="secAOpen" class="wp-sec-body">
          <p class="wp-hint">{{ SETTINGS.WALL_PROPS_SEC_A_HINT }}</p>
          <p v-if="propState.loading" class="wp-hint">{{ SETTINGS.WALL_PROPS_SEC_A_LOADING }}</p>
          <p v-else-if="rows.length === 0" class="wp-hint">{{ SETTINGS.WALL_PROPS_SEC_A_EMPTY }}</p>
          <p v-else-if="visibleRows.length === 0" class="wp-hint">{{ SETTINGS.WALL_PROPS_SEC_A_HIDDEN }}</p>
          <template v-else>
            <template v-for="row in visibleRows" :key="row.name">
              <!-- text / group 是作者写的分节说明，不是控件（连 value 都可以没有） -->
              <div v-if="row.ptype === 'text' || row.ptype === 'group'" class="wp-section-row">
                {{ row.text }}
              </div>
              <template v-else>
                <div class="wp-row">
                  <span class="wp-label" :title="row.name">
                    {{ row.text }}
                    <span v-if="row.overridden" class="wp-dot" :title="SETTINGS.WALL_PROPS_DOT_TITLE">•</span>
                  </span>
                  <div class="wp-ctl">
                    <MiSwitch
                      v-if="row.ptype === 'bool'"
                      :model-value="row.value === true"
                      :disabled="ctlOff"
                      @update:model-value="commitProp(row, $event)"
                    />
                    <input
                      v-else-if="row.ptype === 'color'"
                      type="color"
                      class="wp-color"
                      :value="colorToHex(row.value)"
                      :disabled="ctlOff"
                      @change="commitProp(row, hexToColor(($event.target as HTMLInputElement).value))"
                    />
                    <template v-else-if="row.ptype === 'slider'">
                      <input
                        type="range"
                        class="wp-range"
                        :min="sliderMin(row)"
                        :max="sliderMax(row)"
                        :step="sliderStep(row)"
                        :value="sliderVal(row)"
                        :disabled="ctlOff"
                        @input="liveProp(row, Number(($event.target as HTMLInputElement).value))"
                        @change="commitProp(row, Number(($event.target as HTMLInputElement).value))"
                      />
                      <span class="wp-val">{{ sliderShown(row) }}</span>
                    </template>
                    <MiSelect
                      v-else-if="row.ptype === 'combo' && row.options && row.options.length > 0"
                      :options="comboOptions(row)"
                      :model-value="comboIdx(row)"
                      :disabled="ctlOff"
                      @update:model-value="onComboPick(row, $event)"
                    />
                    <!-- textinput / file / directory / 其他：统统文本输入兜底
                         （file/directory 的候选枚举不在本步，见 wallpaper-props.ts 头注释） -->
                    <input
                      v-else
                      type="text"
                      class="wp-text"
                      :value="String(row.value ?? '')"
                      :disabled="ctlOff"
                      @change="commitProp(row, ($event.target as HTMLInputElement).value)"
                    />
                  </div>
                </div>
              </template>
            </template>
          </template>
        </div>
      </div>

      <!-- B 段：本张微调（叠加在「画面」页签的全局设置之上，按壁纸各记各的） -->
      <div class="wp-sec">
        <div class="wp-sec-head">
          <button type="button" class="wp-sec-toggle" @click="secBOpen = !secBOpen">
            <span class="wp-arrow" :class="{ open: secBOpen }">▸</span>
            <span class="wp-sec-title">{{ SETTINGS.WALL_PROPS_SEC_B }}</span>
          </button>
          <button type="button" class="wp-reset" :disabled="!hasTune" @click="resetTune">
            {{ SETTINGS.WALL_PROPS_RESET }}
          </button>
        </div>
        <div v-show="secBOpen" class="wp-sec-body">
          <p class="wp-hint">{{ SETTINGS.WALL_PROPS_SEC_B_HINT }}</p>

          <div class="wp-row">
            <span class="wp-label">
              {{ SETTINGS.LABEL_WALL_TUNE_FLIPH }}
              <span v-if="flipHSet" class="wp-dot" :title="SETTINGS.WALL_PROPS_DOT_TITLE">•</span>
            </span>
            <MiSwitch
              :model-value="effFlipH"
              :disabled="ctlOff"
              @update:model-value="onFlipH"
            />
          </div>
          <p class="wp-hint">{{ SETTINGS.WALL_TUNE_FLIPH_HINT }}</p>

          <div class="wp-row">
            <span class="wp-label">
              {{ SETTINGS.LABEL_WALL_TUNE_FLIPV }}
              <span v-if="flipVSet" class="wp-dot" :title="SETTINGS.WALL_PROPS_DOT_TITLE">•</span>
            </span>
            <MiSwitch
              :model-value="tune.flipV === true"
              :disabled="ctlOff"
              @update:model-value="onFlipV"
            />
          </div>
          <p class="wp-hint">{{ SETTINGS.WALL_TUNE_FLIPV_HINT }}</p>

          <template v-for="r in TUNE_ROWS" :key="r.field">
            <div class="wp-row">
              <span class="wp-label">
                {{ r.label }}
                <span v-if="tuneSet(r.field)" class="wp-dot" :title="SETTINGS.WALL_PROPS_DOT_TITLE">•</span>
              </span>
              <div class="wp-ctl">
                <input
                  type="range"
                  class="wp-range"
                  :data-wpf="r.field"
                  :min="r.min"
                  :max="r.max"
                  :step="r.step"
                  :value="tuneVal(r.field)"
                  :disabled="ctlOff"
                  @input="liveTuneNum(r.field, Number(($event.target as HTMLInputElement).value))"
                  @change="commitTuneNum(r.field, Number(($event.target as HTMLInputElement).value))"
                />
                <span class="wp-val">{{ r.fmt(tuneVal(r.field)) }}</span>
              </div>
            </div>
            <p class="wp-hint">{{ r.hint }}</p>
          </template>

          <div class="wp-row">
            <span class="wp-label">
              {{ SETTINGS.LABEL_WALL_TUNE_RATE }}
              <span v-if="rateSet" class="wp-dot" :title="SETTINGS.WALL_PROPS_DOT_TITLE">•</span>
            </span>
            <MiTabs
              :tabs="rateTabs"
              :model-value="String(effRate)"
              :disabled="rateOff"
              @update:model-value="onRatePick"
            />
          </div>
          <p class="wp-hint">{{ SETTINGS.WALL_TUNE_RATE_HINT }}</p>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/*
 * ⚠️ wall-glass.test.ts 的全库 `opacity:` 快照闸门在扫这个文件：本样式块
 * **一条小写 opacity 声明都不许加**（禁用态一律用颜色 + 光标表达）。
 * 内嵌块也**不加 background 实色**：卡片玻璃底由外层 .card 管着，
 * 这里用「边框 + 透明底」，同 SettingsView 里 .wall-current 的先例。
 */
.wp-props {
  margin-top: 6px;
}
.wp-hint {
  margin: 6px 0 10px;
  font-size: 12px;
  color: var(--mi-text-3);
  line-height: 1.8;
}
.wp-hint--lead {
  margin-top: 14px;
}
.wp-props-for {
  margin: 14px 0 0;
  font-size: 13px;
  color: var(--mi-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 「重新应用」按钮行（手动同步口）。样式沿用 .wp-reset 的形状词汇，只是
   放大一档、蓝边框压色 —— 顶部的主操作，得让人一眼看见 */
.wp-apply {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
}
.wp-apply-btn {
  flex: 0 0 auto;
  padding: 7px 16px;
  font-size: 13px;
  font-weight: 600;
  font-family: var(--mi-font);
  color: var(--mi-blue-deep);
  background: none;
  border: 1px solid var(--mi-blue-deep);
  border-radius: var(--mi-radius-sm);
  cursor: var(--mi-cursor, pointer);
}
.wp-apply-btn:hover:not(:disabled) {
  background: var(--mi-blue-light);
}
.wp-apply-btn:disabled {
  cursor: not-allowed;
  color: var(--mi-text-3);
  border-color: var(--mi-border);
}
.wp-apply-hint {
  font-size: 12px;
  color: var(--mi-text-3);
  line-height: 1.8;
}
.wp-sec {
  margin-top: 14px;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  overflow: hidden;
}
.wp-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
}
.wp-sec-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
  border: none;
  background: none;
  cursor: var(--mi-cursor, pointer);
  font-family: var(--mi-font);
  font-size: 13px;
  font-weight: 600;
  color: var(--mi-text);
}
.wp-sec-toggle:hover {
  color: var(--mi-blue-deep);
}
.wp-arrow {
  display: inline-block;
  font-size: 11px;
  color: var(--mi-text-3);
  transition: transform 0.2s ease;
}
.wp-arrow.open {
  transform: rotate(90deg);
}
.wp-sec-title {
  min-width: 0;
}
.wp-sec-body {
  padding: 0 12px 12px;
}
.wp-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  font-size: 13px;
  border-bottom: 1px solid var(--mi-border);
}
.wp-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--mi-text);
}
.wp-dot {
  color: var(--mi-blue-deep);
  font-weight: 700;
  cursor: help;
}
.wp-section-row {
  padding: 10px 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--mi-text-2);
  border-bottom: 1px solid var(--mi-border);
}
.wp-ctl {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.wp-range {
  flex: 0 1 150px;
  max-width: 150px;
  min-width: 60px;
  height: 18px;
  margin: 0;
  accent-color: var(--mi-blue-deep);
  cursor: var(--mi-cursor, pointer);
}
.wp-range:disabled {
  cursor: not-allowed;
}
.wp-val {
  min-width: 52px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--mi-text-2);
  text-align: right;
}
.wp-text {
  width: 180px;
  padding: 5px 8px;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  background: var(--mi-bg);
  color: var(--mi-text);
  font-size: 13px;
  outline: none;
}
.wp-text:focus {
  border-color: var(--mi-blue-deep);
}
.wp-color {
  width: 44px;
  height: 24px;
  padding: 0 2px;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  background: var(--mi-bg);
  cursor: var(--mi-cursor, pointer);
}
.wp-reset {
  padding: 4px 10px;
  font-size: 12px;
  font-family: var(--mi-font);
  color: var(--mi-text-2);
  background: none;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  cursor: var(--mi-cursor, pointer);
}
.wp-reset:hover:not(:disabled) {
  color: var(--mi-blue-deep);
  border-color: var(--mi-blue-deep);
}
.wp-reset:disabled {
  cursor: not-allowed;
  color: var(--mi-text-3);
}
</style>
