<script setup lang="ts">
/**
 * 「选择壁纸」弹窗 —— 清单、刷新、选中态都在这（设置页那张卡只留一个入口按钮）。
 *
 * 【为什么清单不放在这里 own】清单是模块级单例（lib/wallpaper/catalog.ts）：
 * 壁纸层、本弹窗、面板的「共 N 张」共用同一份，刷新一次三处一起变；
 * 各拉各的会重复扫 Steam 工坊目录，还会出现「刷新了但这边没变」。
 *
 * 【组件只发事件，不落盘】选中/隐藏/显示开关都交给父级（settings.setWallpaper /
 * toggleHiddenWallpaper / wall-hidden store）—— 弹窗不该知道 store 存在，
 * 这样它在别处复用、写测试都便宜。清单本身（catalog）仍是单例直读。
 *
 * 【2026-10-06 加的预览与隐藏】每行三个热区：整行点=选中；「预览」开悬浮卡
 * （MediaPreviewModal，规格来自 lib/wallpaper/preview.ts）；「隐藏/取消隐藏」
 * 发事件给父级。隐藏的过滤发生在**渲染层**：hidden 命中的条目默认不出现，
 * 「显示隐藏项目」打开时带「已隐藏」标记现身 —— 别把过滤做进 catalog 单例，
 * 那会让壁纸层和设置页的「共 N 张」口径打架。
 *
 * 【2026-10-07 深夜加的搜索与分类（主人点单）】搜索框 + 分类标签页，都叠在
 * **visibleItems 之上再滤一道**（纯内存过数组）：
 *  · 分类直接吃扫描侧归一好的 it.type（.pkg→scene、视频→video、图片→image，
 *    见 shared/wallpaper.ts），不给「按后缀猜」留第二套判据；
 *    web 与 application 合成「其他」一档（它们本来就渲染不了本体、只出海报）；
 *  · 搜索就是 title 的小写子串匹配 —— 中文/英文/符号天然全支持，别加花活
 *    （分词、拼音之类的误报比收益大）；
 *  · 组合 = 先分类后搜索，两个条件在同一条 computed 里叠着走；
 *  · 过滤链的底是 visibleItems ⇒「全部」档天然看不到被隐藏的条目（与设
 *    置页开关的隐私口径一致，见上段）。
 * 绝不触发重扫：catalog 单例已缓存，输入只重算 computed。
 *
 * 【2026-10-07 深夜加的悬停预热（Bug1 切换顿挫修复的弹窗侧）】悬停场景条目
 * 停留过 PRELOAD_DWELL_MS 后，往 wallpaperPreload 总线发一条意图，由墙纸层
 * 把这张场景提前挂进非活动槽；真正点选时原地转正，切换零冻结。三条纪律：
 *  · 只对「场景 + 有主文件」的条目发（视频/图片挂载本来就便宜，没必要）；
 *  · 关闭弹窗时撤意图（墙纸层收到 null 会收掉热身实例）——**但「选中」引起
 *    的关闭例外**：若选中的恰是预热的那张，意图要留给换片流水线转正
 *    （keepWarmForPick，见 onPick；跨组件 watch 顺序不可靠，不能指望
 *    「先转正后收意图」的时序）；
 *  · 悬停离开即撤表（dwell 防抖）；换一条悬停 = 新意图顶掉旧的（单热身槽）。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫：**字符串一律走 copy**，中文只出现在注释里。
 * ⚠️ 每行 `.pick-item` 带 data-id（探针做「DOM 行 → stats.preload.itemId →
 *   转正槽 mountMs」证据链要用）；别删。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ensureCatalog, refreshCatalog, wallpaperCatalog } from '../../lib/wallpaper/catalog'
import { miaiWallUrl } from '../../lib/wallpaper/url'
import { wallpaperPreviewSpec } from '../../lib/wallpaper/preview'
import { wallpaperPreload } from '../../lib/wallpaper/preload'
import { SETTINGS } from '../../lib/copy'
import { isRenderableItem, sceneMainReady, type WallpaperItem } from '../../../../shared/wallpaper'
import MiButton from '../base/MiButton.vue'
import MiModal from '../base/MiModal.vue'
import MediaPreviewModal from './MediaPreviewModal.vue'

const props = defineProps<{
  visible: boolean
  /** 当前选中的 id（高亮用）；'' = 没选 */
  selectedId: string
  /** 被隐藏的条目 id（wallpaper.hidden 现值） */
  hidden: string[]
  /** 「显示隐藏项目」开关（本地记忆的视图态，父级从 wall-hidden store 拿） */
  showHidden: boolean
}>()

const emit = defineEmits<{
  'update:visible': [v: boolean]
  pick: [id: string]
  'toggle-hide': [id: string]
  'toggle-show-hidden': []
}>()

const items = computed(() => wallpaperCatalog.items.value)
const loading = computed(() => wallpaperCatalog.loading.value)
const hiddenSet = computed(() => new Set(props.hidden))

/** 展示集合：默认藏掉被隐藏的；showHidden 打开时全展示（带标记）。
    搜索/分类的过滤全部发生在这条链的**下游**（内存过滤，见下）。 */
const visibleItems = computed(() =>
  props.showHidden ? items.value : items.value.filter((it) => !hiddenSet.value.has(it.id))
)

// ---- 搜索与分类（2026-10-07 深夜）

/**
 * 分类档位。中间的 scene/video/image 直接复用 it.type；「其他」= web + application
 * （这两种引擎本来就渲染不了本体、只出海报，单列一档对用户没有区分价值）。
 */
type KindTab = 'all' | 'scene' | 'video' | 'image' | 'other'

const query = ref('')
const kindTab = ref<KindTab>('all')

const TABS: { id: KindTab; label: string }[] = [
  { id: 'all', label: SETTINGS.WALL_FILTER_ALL },
  { id: 'scene', label: SETTINGS.WALL_KIND_NAMES.scene },
  { id: 'video', label: SETTINGS.WALL_KIND_NAMES.video },
  { id: 'image', label: SETTINGS.WALL_KIND_NAMES.image },
  { id: 'other', label: SETTINGS.WALL_FILTER_OTHER }
]

function matchKind(it: WallpaperItem, tab: KindTab): boolean {
  if (tab === 'all') return true
  if (tab === 'other') return it.type === 'web' || it.type === 'application'
  return it.type === tab
}

/** 组合过滤：分类 ∩ 关键词（title 小写子串；中文/英文/符号一视同仁）。
    空串 = 不过滤。只读缓存列表，不触发任何扫描。 */
const filteredItems = computed(() => {
  const q = query.value.trim().toLowerCase()
  return visibleItems.value.filter(
    (it) => matchKind(it, kindTab.value) && (q === '' || it.title.toLowerCase().includes(q))
  )
})

/**
 * 网格为空时那句话说什么（2026-10-17 夜间批：三态拆开）。
 *
 * 原来是 `visibleItems.length ? NO_MATCH : EMPTY` 两态：首启头几秒扫描还没回来、
 * 或上次扫描失败（catalog 的 error 记号此前没有任何读者），都会被说成
 * 「还没扫到壁纸喵——确认 Steam 工坊里订阅了壁纸」—— 把"还没扫完/扫坏了"
 * 说成"没有壁纸"，还把人支去检查订阅。四个事实四句话：
 * 过滤滤没了（有货但没匹配）/ 扫描在途 / 上次扫失败 / 真的一张都没有。
 */
const emptyText = computed(() => {
  if (visibleItems.value.length > 0) return SETTINGS.WALL_PICK_NO_MATCH
  if (loading.value) return SETTINGS.WALL_PICK_SCANNING
  if (wallpaperCatalog.error.value !== null) return SETTINGS.WALL_PICK_SCAN_FAILED
  // 没装 WE（2026-10-17 分享版）：与「装了但一张都没订阅」分开说 ——
  // 后者让人去工坊订阅，前者得先去装软件，动作完全不同。
  if (wallpaperCatalog.hasEngine.value === false) return SETTINGS.WALL_PICK_NO_ENGINE
  return SETTINGS.WALL_PICK_EMPTY
})

function setTab(id: KindTab): void {
  kindTab.value = id
}

// ---- 悬停预热（Bug1 切换顿挫修复的弹窗侧，机制见 WallpaperLayer「场景预热」节）

/** 悬停停留多久才发预热意图：防「鼠标路过一排条目」连发（挂载是秒级重活，不能滥发） */
const PRELOAD_DWELL_MS = 160
let dwellTimer: number | null = null
/** 「本次关闭是选中引起」的标志：true 时关弹窗不撤意图（留给换片流水线转正） */
let keepWarmForPick = false

/** 只有「场景 + 有主文件」值得预热（挂载重活只在场景；伪场景挂不出东西） */
function preloadable(it: WallpaperItem): boolean {
  return it.type === 'scene' && sceneMainReady(it)
}

function cancelDwell(): void {
  if (dwellTimer !== null) {
    window.clearTimeout(dwellTimer)
    dwellTimer = null
  }
}

function onItemEnter(it: WallpaperItem): void {
  cancelDwell()
  if (!preloadable(it)) return
  dwellTimer = window.setTimeout(() => {
    dwellTimer = null
    wallpaperPreload.request(it)
  }, PRELOAD_DWELL_MS)
}

function onItemLeave(): void {
  cancelDwell()
}

/** 打开时若清单还没拉过就顺手拉一次（与设置页 onMounted 的 ensure 在途合流）；
    每次打开都把搜索与分类归零 —— 上次的过滤词还挂着会让用户以为清单空了。
    关闭时撤悬停表 + （非选中引起的）撤预热意图。 */
watch(
  () => props.visible,
  (v) => {
    if (v) {
      void ensureCatalog()
      query.value = ''
      kindTab.value = 'all'
    } else {
      cancelDwell()
      if (keepWarmForPick) keepWarmForPick = false
      else wallpaperPreload.drop()
    }
  }
)

onBeforeUnmount(() => {
  cancelDwell()
  // 路由切走把弹窗整个卸了（visible watch 不会兜这条）：悬停表撤掉、意图撤掉
  // （热身实例由墙纸层收）；选中引起的关闭不在此列（keepWarm 已在上一条 watch 消费）
  if (!keepWarmForPick) wallpaperPreload.drop()
})

function onRowClick(it: WallpaperItem): void {
  if (!isRenderableItem(it)) return
  onPick(it.id)
}

function onPick(id: string): void {
  // 选中引起的关闭：若热身的就是这条，别 drop —— 那条实例要交给换片流水线
  // 原地转正（墙纸层 doShow 的 adopted 分支）；选了别的条目则一并收掉。
  keepWarmForPick = wallpaperPreload.intent.value?.item.id === id
  emit('pick', id)
  emit('update:visible', false)
}

// ---- 预览（悬浮卡；规格解析是纯函数，行上的按钮与这里的弹窗用同一份判据）

const previewItem = ref<WallpaperItem | null>(null)
const previewSpec = computed(() =>
  previewItem.value ? wallpaperPreviewSpec(previewItem.value) : null
)

const canPreview = (it: WallpaperItem): boolean => wallpaperPreviewSpec(it) !== null

function openPreview(it: WallpaperItem): void {
  if (!canPreview(it)) return
  previewItem.value = it
}
</script>

<template>
  <MiModal
    :visible="visible"
    :title="SETTINGS.WALL_PICK_TITLE"
    :width="560"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="pick-head">
      <span class="pick-count">{{ SETTINGS.WALL_PICK_COUNT(filteredItems.length) }}</span>
      <div class="pick-head-actions">
        <MiButton size="sm" @click="emit('toggle-show-hidden')">
          {{ showHidden ? SETTINGS.WALL_SHOW_HIDDEN_ON : SETTINGS.LABEL_WALL_SHOW_HIDDEN }}
        </MiButton>
        <MiButton size="sm" :loading="loading" @click="refreshCatalog()">
          {{ SETTINGS.WALL_BTN_REFRESH }}
        </MiButton>
      </div>
    </div>
    <div class="pick-tools">
      <input
        v-model="query"
        class="pick-search"
        type="text"
        :placeholder="SETTINGS.WALL_PICK_SEARCH_PH"
        spellcheck="false"
      />
      <div class="pick-tabs">
        <button
          v-for="tb in TABS"
          :key="tb.id"
          class="pick-tab"
          :class="{ 'is-active': kindTab === tb.id }"
          @click="setTab(tb.id)"
        >
          {{ tb.label }}
        </button>
      </div>
    </div>
    <div v-if="filteredItems.length" class="pick-grid">
      <div
        v-for="it in filteredItems"
        :key="it.id"
        class="pick-item"
        :data-id="it.id"
        :class="{ 'is-current': it.id === selectedId, 'is-disabled': !isRenderableItem(it) }"
        @click="onRowClick(it)"
        @pointerenter="onItemEnter(it)"
        @pointerleave="onItemLeave"
      >
        <img v-if="it.previewAbs" class="pick-thumb" :src="miaiWallUrl(it.previewAbs)" alt="" loading="lazy" />
        <span v-else class="pick-thumb pick-thumb-none"></span>
        <span class="pick-title" :title="it.title">{{ it.title }}</span>
        <span class="pick-badge">
          {{ SETTINGS.WALL_KIND_NAMES[it.type] }}
          <template v-if="hiddenSet.has(it.id)">{{ SETTINGS.WALL_HIDDEN_TAG }}</template>
        </span>
        <span v-if="!isRenderableItem(it)" class="pick-badge pick-badge-none">
          {{ SETTINGS.WALL_PICK_UNPLAYABLE }}
        </span>
        <span class="pick-actions">
          <button v-if="canPreview(it)" class="pick-btn" @click.stop="openPreview(it)">
            {{ SETTINGS.WALL_PREVIEW }}
          </button>
          <button class="pick-btn" @click.stop="emit('toggle-hide', it.id)">
            {{ hiddenSet.has(it.id) ? SETTINGS.WALL_UNHIDE : SETTINGS.WALL_HIDE }}
          </button>
        </span>
      </div>
    </div>
    <p v-else class="pick-empty">
      {{ emptyText }}
    </p>

    <MediaPreviewModal
      :visible="previewItem !== null"
      :src="previewSpec?.url ?? ''"
      :kind="previewSpec?.kind ?? 'image'"
      :title="previewItem?.title ?? ''"
      :note="previewSpec?.posterOnly ? SETTINGS.WALL_PREVIEW_NOTE_POSTER : undefined"
      @update:visible="previewItem = null"
    />
  </MiModal>
</template>

<style scoped>
/*
 * 缩略图墙：自适应列（窄窗口自动减列）。⚠️ 不写 background 玻璃令牌、
 * 不写 opacity 声明（wall-glass.test.ts 的快照闸门盯着全库这两类）。
 */
.pick-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  gap: 8px;
}
.pick-head-actions {
  display: flex;
  gap: 8px;
}
.pick-count {
  font-size: 12px;
  color: var(--mi-text-3);
}
/* 搜索框与分类标签（2026-10-07）：全部走主题令牌，黑夜/白天两套主题自动跟随 */
.pick-tools {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}
.pick-search {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  font-size: 13px;
  font-family: var(--mi-font);
  color: var(--mi-text);
  background: var(--mi-card);
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm, 8px);
}
.pick-search:focus {
  outline: none;
  border-color: var(--mi-blue);
}
.pick-search::placeholder {
  color: var(--mi-text-3);
}
.pick-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pick-tab {
  padding: 4px 12px;
  font-size: 12px;
  font-family: var(--mi-font);
  color: var(--mi-text-2);
  background: transparent;
  border: 1px solid var(--mi-border);
  border-radius: 999px;
  cursor: var(--mi-cursor, pointer);
}
.pick-tab:hover {
  color: var(--mi-blue);
  border-color: var(--mi-blue);
}
.pick-tab.is-active {
  color: var(--mi-blue);
  border-color: var(--mi-blue);
  background: var(--mi-blue-light);
}
.pick-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
  max-height: 52vh;
  overflow-y: auto;
  padding: 2px;
}
.pick-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  background: transparent;
  cursor: var(--mi-cursor, pointer);
  text-align: left;
  font-family: var(--mi-font);
  color: var(--mi-text);
}
.pick-item:hover {
  border-color: var(--mi-blue);
}
.pick-item.is-current {
  border-color: var(--mi-blue);
  background: var(--mi-blue-light);
}
.pick-thumb {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 6px;
  background: var(--mi-card);
}
.pick-title {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pick-badge {
  font-size: 11px;
  color: var(--mi-text-3);
}
/* 引擎显示不出来的条目（没主文件也没预览图）：允许看、不允许选中 ——
   点下去是静默失效（selectedId 落盘但屏上不换），禁用判据与轮播池同一份
   isRenderableItem。**行不可点，但行内的预览/隐藏按钮照常可用**（隐藏一个
   渲染不了的条目同样是合法诉求）。
   ⚠️ 不写 opacity 声明弱化（wall-glass.test.ts 钉死全库 opacity 计数），
   用虚线边框 + 淡色标题表达「这条不可用」。 */
.pick-item.is-disabled {
  cursor: not-allowed;
  border-style: dashed;
}
.pick-item.is-disabled:hover {
  border-color: var(--mi-border);
}
.pick-item.is-disabled .pick-title {
  color: var(--mi-text-3);
}
.pick-badge-none {
  color: var(--mi-text-2);
}
.pick-actions {
  display: flex;
  gap: 6px;
}
.pick-btn {
  flex: 1;
  padding: 3px 6px;
  font-size: 11px;
  font-family: var(--mi-font);
  color: var(--mi-text-2);
  background: transparent;
  border: 1px solid var(--mi-border);
  border-radius: 6px;
  cursor: var(--mi-cursor, pointer);
}
.pick-btn:hover {
  color: var(--mi-blue);
  border-color: var(--mi-blue);
  background: var(--mi-blue-light);
}
.pick-empty {
  font-size: 13px;
  color: var(--mi-text-3);
  text-align: center;
  padding: 24px 0;
}
</style>
