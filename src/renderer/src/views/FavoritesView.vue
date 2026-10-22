<script setup lang="ts">
/**
 * 收藏页（学习闭环 §6）：左筛选栏 + 右列表 + 吸底多选工具条。
 *
 * 【这一屏的每一句判断都不在这儿】筛选、排序、计数、元信息解析、能不能开练，
 * 全部在 `lib/favorites-view.ts`（有单测）与 `stores/favorites.ts`（有单测）。
 * 这里只负责画，以及把用户的动作转给那两个地方 ——
 * views/ 不在 vitest 的 include 范围内，写在这儿的判断**永远不会有测试**
 * （错题本那边的 `canRedo` 就是这个教训，收藏这边不再重复）。
 *
 * 【两个同名不同义的「收藏」】这一页是**两种**收藏的家：
 *   · 「收藏的题目」——题目级（`favorites.json`），下面那张卡；
 *   · 「收藏的课」——课级（`profile.favorites`），上面那张卡（V1-23 ② 新开）。
 * 题目分区的小标题写全「收藏的题目」，和课程分区一起把这层分野说出来，
 * 见 copy.ts 的 TITLE.FAVORITES 注释（大标题已退回「⭐ 收藏」）。
 */
import { computed, nextTick, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useContentStore } from '../stores/content'
import { useFavoritesStore } from '../stores/favorites'
import { useProgressStore } from '../stores/progress'
import MiButton from '../components/base/MiButton.vue'
import MiCard from '../components/base/MiCard.vue'
import MiCheckbox from '../components/base/MiCheckbox.vue'
import MiEmpty from '../components/base/MiEmpty.vue'
import MiInput from '../components/base/MiInput.vue'
import MiModal from '../components/base/MiModal.vue'
import MiRichText from '../components/base/MiRichText.vue'
import MiSelect from '../components/base/MiSelect.vue'
import MiTag from '../components/base/MiTag.vue'
import {
  DIFFICULTY_DISPLAY,
  EMPTY,
  FAVORITES,
  PRACTICE,
  TITLE,
  TOAST,
  TYPE_DISPLAY
} from '../lib/copy'
import { LANG_LABEL } from '../lib/labels'
import { toast } from '../components/base/toast'
import { useFavoriteStarter } from '../lib/favorite-practice'
import { useLessonOpener } from '../lib/openLesson'
import {
  FAV_ALL,
  FAV_ALL_SELECTION,
  FAV_OTHER_SOURCE,
  FAV_SOURCE_ORDER,
  FAV_UNGROUPED,
  canPracticeFavorite,
  countByFolder,
  countBySource,
  filterFavorites,
  filterOptions,
  itemSource,
  makeMetaResolver,
  resolveFavoriteQuestion,
  sortFavorites,
  type FavoriteMeta,
  type FavoritesSelection,
  type FavoriteQuestionDeps
} from '../lib/favorites-view'
import { indexByKey } from '../../../shared/question-index'
import { isAiKey } from '../../../shared/question-key'
import { localDateKeyOf } from '../../../shared/dates'
import type {
  Difficulty,
  FavoriteFolder,
  FavoriteItem,
  Lang,
  Question,
  QuestionType
} from '../../../shared/types'

const content = useContentStore()
const fav = useFavoritesStore()
const progress = useProgressStore()
const { startFavorites } = useFavoriteStarter()
const { openLesson } = useLessonOpener()

/**
 * 「收藏的课」的数据源（V1-23 ②）：课级收藏 = profile.favorites（课 id 数组，
 * 顺序 = 收藏顺序）。在课程分区出现之前，这些 id 落盘后**没有任何列表页消费**——
 * 用户收藏一节课，全 app 找不回来。这里补上那个家。
 *
 * 找不到出处的条目照实显示、不悄悄吞掉（同 unknownHidden 的原则：收藏是
 * 用户自己的东西）。点行进课文页走 useLessonOpener（draft/locked 有统一拦截）。
 */
const courseFavs = computed(() =>
  progress.profile.favorites.map((id) => {
    const l = content.lessonOf(id)
    return { id, title: l?.title ?? id, missing: !l }
  })
)

const sel = reactive<FavoritesSelection>({ ...FAV_ALL_SELECTION })

/** 右列（列表本体）。挤压态下选完筛选把它拉回视野用 —— 见 pickFolder。 */
const mainRef = ref<HTMLElement | null>(null)

/**
 * 选文件夹 = 换右列内容。中栏拖窄 + 高缩放时内容盒会窄过「220px 筛选列 + 16px
 * 间距」，右列整块落到 .content 的裁剪框外（复核现场 384/433/383 + 160%，
 * 与备忘录编辑区同一族）。选中后把右列滚进视野 —— 备忘录那边用的是同一条
 * 救生通道（block/inline 都 nearest：本就看得见时一点都不动）。
 */
function pickFolder(v: string): void {
  sel.folder = v
  void nextTick(() => mainRef.value?.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
}

/**
 * 全局键 → 索引条目。建**一次** Map，之后每行 O(1)；
 * 直接在 4023 条的数组上 find 是每行一次线性扫（见 shared/question-index.ts 的 indexByKey）。
 */
const byKey = computed(() => indexByKey(content.questionIndex))

/** 内置题去内容包按「课号 + 题号」找。找不到返回 null（内容改版把题移走了） */
function findBuiltIn(lessonId: string, qid: string): Question | null {
  return content.lessonOf(lessonId)?.questions.find((q) => q.id === qid) ?? null
}

/**
 * 「这条收藏对应的题在哪」只问这一件事。
 * 行内显示题干、行内「单题练习」、多选开卷三处**共用同一个对象** ——
 * 各建一份的话，「列表里看得见、点练习却跳过它」这类不一致迟早会出现。
 */
const questionDeps: FavoriteQuestionDeps = { findBuiltIn }

/** 一条收藏的语言/题型/难度。查不出出处的返回 null（由 filterFavorites 统一记账） */
const metaOf = computed(() =>
  makeMetaResolver({
    indexOf: (key) => byKey.value.get(key),
    lessonOf: (id) => content.lessonOf(id)
  })
)

const view = computed(() => filterFavorites(fav.items, sel, metaOf.value))
const shown = computed(() => sortFavorites(view.value.shown))

/** 每个文件夹有几条 / 未分组几条（左栏的计数） */
const folderCounts = computed(() => countByFolder(fav.items))

// ---------------------------------------------------------------- 筛选器选项

/**
 * 元信息取得到的那些收藏。四个筛选项里语言/难度/题型三维**从这份里现算** ——
 * 「我收藏里真有的取值」才列出来，不摆一堆点了才知道是空的档。
 * （最下面那个 `keep` 参数保证：真出现"选出 0 条"的一刻，选中的那档也还在。）
 */
const knownMetas = computed(() =>
  fav.items
    .map((it) => metaOf.value(it))
    .filter((m): m is FavoriteMeta => m !== null)
)

/**
 * 语言那一维在**题库里**可能出现的全部取值（顺序照 labels.ts 的键序）。
 * 不按收藏现算：语言一共五个，少列一个的代价是"我把 Python 的题都取消收藏之后，
 * 那一档就没了"，而题库里有 Python 这件事并没有变。
 */
const LANG_ORDER = Object.keys(LANG_LABEL) as Lang[]
const DIFF_ORDER = Object.keys(DIFFICULTY_DISPLAY) as Difficulty[]
const TYPE_ORDER = Object.keys(TYPE_DISPLAY) as QuestionType[]

const langOptions = computed(() =>
  filterOptions(
    knownMetas.value.map((m) => m.lang as string),
    LANG_ORDER as string[],
    (v) => LANG_LABEL[v as Lang] ?? v,
    FAVORITES.ALL,
    sel.lang
  )
)
const diffOptions = computed(() =>
  filterOptions(
    knownMetas.value.map((m) => m.difficulty as string),
    DIFF_ORDER as string[],
    (v) => DIFFICULTY_DISPLAY[v as Difficulty] ?? v,
    FAVORITES.ALL,
    sel.difficulty
  )
)
const typeOptions = computed(() =>
  filterOptions(
    knownMetas.value.map((m) => m.type as string),
    TYPE_ORDER as string[],
    (v) => TYPE_DISPLAY[v as QuestionType] ?? v,
    FAVORITES.ALL,
    sel.type
  )
)
/** 来源那一维**从收藏自己身上数**：落盘里有什么值就有什么档（认不出的原样显示） */
const sourceOptions = computed(() =>
  filterOptions(
    Object.keys(countBySource(fav.items)),
    FAV_SOURCE_ORDER,
    (v) => PRACTICE.sourceLabel(v),
    FAVORITES.ALL,
    sel.source
  )
)

/*
 * MiSelect 只会吐回 `string`，而这三个维度的取值域是收窄的联合类型。
 * 不写 v-model 而写这四个 setter：转换只在这一处，模板那边看不懂类型也不会写歪。
 * 真写进了域外的值也不至于出事 —— filterFavorites 拿它当"没一条匹配"，
 * 而选项列表里有 `keep` 兜着，用户随时能退回去。
 */
function setLang(v: string): void {
  sel.lang = v as FavoritesSelection['lang']
}
function setDifficulty(v: string): void {
  sel.difficulty = v as FavoritesSelection['difficulty']
}
function setType(v: string): void {
  sel.type = v as FavoritesSelection['type']
}
function setSource(v: string): void {
  sel.source = v
}

// ---------------------------------------------------------------- 列表

/** 一行要显示的全部东西。**一趟算完**，模板里不再逐个字段现算（见 questionDeps 的注释） */
interface FavRow {
  item: FavoriteItem
  stem: string
  lessonTitle: string
  meta: FavoriteMeta | null
  source: string
  added: string
  ai: boolean
  canPractice: boolean
}

const rows = computed<FavRow[]>(() =>
  shown.value.map((it) => ({
    item: it,
    // 题找不回本体时如实说"已被移走"，不显示一个空白行
    stem: resolveFavoriteQuestion(it, questionDeps)?.stem ?? PRACTICE.MISSING_STEM,
    lessonTitle: content.lessonOf(it.lessonId)?.title ?? '',
    meta: metaOf.value(it),
    source: itemSource(it),
    added: localDateKeyOf(it.addedAt) ?? '',
    ai: isAiKey(it.key),
    canPractice: canPracticeFavorite(it, questionDeps)
  }))
)

function sourceLabelOf(row: FavRow): string {
  // 落盘时没带 source 的老条目：归进「其他」那一档（types.ts 里那段选填的理由）
  return row.source === FAV_OTHER_SOURCE ? FAVORITES.OTHER_SOURCE : PRACTICE.sourceLabel(row.source)
}

/**
 * 一条都还没有 vs 筛完了是空的 —— 两种空态**两句话**。
 * 混用的话，用户在筛选器上点一下会以为自己的收藏全没了（copy.ts 里那段）。
 * `fav.loaded` 之前什么都不显示：读盘要几十毫秒，先当真地报"还没收藏过"
 * 会闪一下假空态（`stores/favorites.ts` 的 loaded 就是为这个存在的）。
 */
const emptyState = computed(() =>
  fav.items.length === 0 ? EMPTY.FAVORITES_EMPTY : EMPTY.FAVORITES_FILTERED_EMPTY
)

/** 空态按钮的去处（V1-52 ④：去学一节课，练习里就能遇见 ⭐） */
const router = useRouter()

// ---------------------------------------------------------------- 勾选

const selected = ref<Set<string>>(new Set())

function setSelected(key: string, on: boolean): void {
  const next = new Set(selected.value)
  if (on) next.add(key)
  else next.delete(key)
  selected.value = next
}

/**
 * 选中的那些 —— **从 store 的 items 里现滤**，不是拿 selected 直接数。
 * 取消收藏、挪走、删文件夹之后，勾过的键可能已经不在列表里了；
 * 直接数的话工具条会一直报着"已选 3 道"，而屏幕上一条勾中的都没有。
 */
const selectedItems = computed(() => fav.items.filter((i) => selected.value.has(i.key)))

/** 列表在别处被改过之后，把勾选里已经看不见的那些摘掉（挪走 / 删文件夹之后调） */
function syncSelection(): void {
  const visible = new Set(rows.value.map((r) => r.item.key))
  selected.value = new Set([...selected.value].filter((k) => visible.has(k)))
}

const allSelected = computed(
  () => rows.value.length > 0 && rows.value.every((r) => selected.value.has(r.item.key))
)

function toggleSelectAll(): void {
  selected.value = allSelected.value
    ? new Set()
    : new Set(rows.value.map((r) => r.item.key))
}

// ---------------------------------------------------------------- 动作

/**
 * 单题练习 / 多选开卷。**都走收藏练习启动器**：它负责挑出能练的、
 * 跳过挑战题与找不到的题、并如实报告跳过了几道（见 lib/favorite-practice.ts）。
 * 返回 0 表示一道都没开成（它自己会说为什么），这时别清勾选 ——
 * 用户还得接着从这几条里挑。
 */
function practice(items: readonly FavoriteItem[]): void {
  if (startFavorites(items) === 0) return
  selected.value = new Set()
}

/**
 * 删除冷却到什么时刻（2026-10-17 夜间批）。双击的「取消收藏」第二下会落在
 * **下一行**的同名按钮上（行在 180ms 的退场动画后上移补位，按钮原地不动）
 * —— 用户没看过、也没点过的那一条会被静默删掉。删完这 400ms 内的点击
 * 一律不认（用时间戳而不是 disabled+定时器：不给这个页面再添一个要清理的 timer）。
 */
let removeCooldownUntil = 0

function removeOne(it: FavoriteItem): void {
  if (Date.now() < removeCooldownUntil) return
  removeCooldownUntil = Date.now() + 400
  // 走 removeMany 而不是 toggle(key, null)：批量口对"这条已经不在了"是安全的
  // （数不到就不动、也不出声），而 toggle 会当成一次**收藏**去做。
  fav.removeMany([it.key])
}

function removeSelected(): void {
  fav.removeMany([...selectedItems.value].map((i) => i.key))
  selected.value = new Set()
}

// ---------------------------------------------------------------- 笔记

const noteEditing = ref<string | null>(null)
const noteDraft = ref('')

function startNote(it: FavoriteItem): void {
  noteEditing.value = it.key
  noteDraft.value = it.note ?? ''
}

function saveNote(key: string): void {
  fav.setNote(key, noteDraft.value)
  noteEditing.value = null
}

// ---------------------------------------------------------------- 文件夹

const createVisible = ref(false)
const folderName = ref('')
const renameTarget = ref<FavoriteFolder | null>(null)
const deleteTarget = ref<FavoriteFolder | null>(null)

function openCreate(): void {
  folderName.value = ''
  createVisible.value = true
}

function confirmCreate(): void {
  const f = fav.createFolder(folderName.value)
  if (!f) {
    // 空名不受理（store 的规矩），但用户得知道为什么没建出来
    toast(TOAST.FOLDER_NAME_EMPTY, 'warn')
    return
  }
  createVisible.value = false
  // 建完直接筛到它：用户建文件夹通常就是要把东西挪进去
  sel.folder = f.id
}

function openRename(f: FavoriteFolder): void {
  folderName.value = f.name
  renameTarget.value = f
}

function confirmRename(): void {
  const f = renameTarget.value
  if (!f) return
  if (!fav.renameFolder(f.id, folderName.value)) {
    toast(TOAST.FOLDER_NAME_EMPTY, 'warn')
    return
  }
  renameTarget.value = null
}

function openDelete(f: FavoriteFolder): void {
  deleteTarget.value = f
}

function confirmDelete(): void {
  const f = deleteTarget.value
  if (!f) return
  fav.deleteFolder(f.id)
  // 正在按这个文件夹筛的话，筛子必须跟着撤 —— 那一档随着文件一起从栏里消失了，
  // 留着它列表会空着，而用户找不到自己刚点过哪儿
  if (sel.folder === f.id) sel.folder = FAV_ALL
  deleteTarget.value = null
  syncSelection()
}

// ---------------------------------------------------------------- 移动到文件夹

const moveVisible = ref(false)
const moveKeys = ref<string[]>([])
const moveTarget = ref<string>(FAV_UNGROUPED)

/** 「未分组」不是文件夹，用 FAV_UNGROUPED 当它的哨兵值（文件夹 id 是 `folder-…`，撞不上） */
const moveOptions = computed(() => [
  { value: FAV_UNGROUPED, label: FAVORITES.MOVE_UNGROUPED },
  ...fav.folders.map((f) => ({ value: f.id, label: f.name }))
])

function openMove(keys: readonly string[]): void {
  if (fav.folders.length === 0) return
  moveKeys.value = [...keys]
  moveTarget.value = FAV_UNGROUPED
  moveVisible.value = true
}

function confirmMove(): void {
  fav.moveTo(moveKeys.value, moveTarget.value === FAV_UNGROUPED ? null : moveTarget.value)
  moveVisible.value = false
  // 挪进别的文件夹之后，这些条目在当前这一档里多半就看不见了
  syncSelection()
}
</script>

<template>
  <div class="favorites-page">
    <h1 class="page-title">{{ TITLE.FAVORITES }}</h1>

    <div v-if="fav.loaded" class="fav-grid">
      <MiCard class="fav-side">
        <div class="fav-group">
          <div class="fav-group-title">{{ FAVORITES.FILTER_FOLDER }}</div>
          <button
            class="fav-folder"
            :class="{ active: sel.folder === FAV_ALL }"
            @click="pickFolder(FAV_ALL)"
          >
            <span class="fav-folder-name">{{ FAVORITES.ALL }}</span>
            <span class="fav-folder-n">{{ fav.items.length }}</span>
          </button>
          <button
            class="fav-folder"
            :class="{ active: sel.folder === FAV_UNGROUPED }"
            @click="pickFolder(FAV_UNGROUPED)"
          >
            <span class="fav-folder-name">{{ FAVORITES.UNGROUPED }}</span>
            <span class="fav-folder-n">{{ folderCounts.ungrouped }}</span>
          </button>

          <div v-for="f in fav.folders" :key="f.id" class="fav-folder-row">
            <button
              class="fav-folder"
              :class="{ active: sel.folder === f.id }"
              @click="pickFolder(f.id)"
            >
              <span class="fav-folder-name">{{ f.name }}</span>
              <span class="fav-folder-n">{{ folderCounts.byId[f.id] ?? 0 }}</span>
            </button>
            <div class="fav-folder-acts">
              <MiButton size="sm" variant="ghost" @click="openRename(f)">
                {{ FAVORITES.FOLDER_RENAME }}
              </MiButton>
              <MiButton size="sm" variant="ghost" @click="openDelete(f)">
                {{ FAVORITES.FOLDER_DELETE }}
              </MiButton>
            </div>
          </div>

          <MiButton size="sm" variant="ghost" @click="openCreate">
            {{ FAVORITES.NEW_FOLDER }}
          </MiButton>
        </div>

        <div class="fav-group">
          <div class="fav-group-title">{{ FAVORITES.FILTER_LANG }}</div>
          <MiSelect :model-value="sel.lang" :options="langOptions" @update:model-value="setLang" />
        </div>

        <div class="fav-group">
          <div class="fav-group-title">{{ FAVORITES.FILTER_DIFFICULTY }}</div>
          <MiSelect
            :model-value="sel.difficulty"
            :options="diffOptions"
            @update:model-value="setDifficulty"
          />
        </div>

        <div class="fav-group">
          <div class="fav-group-title">{{ FAVORITES.FILTER_TYPE }}</div>
          <MiSelect :model-value="sel.type" :options="typeOptions" @update:model-value="setType" />
        </div>

        <div class="fav-group">
          <div class="fav-group-title">{{ FAVORITES.FILTER_SOURCE }}</div>
          <MiSelect
            :model-value="sel.source"
            :options="sourceOptions"
            @update:model-value="setSource"
          />
        </div>
      </MiCard>

      <div ref="mainRef" class="fav-main">
        <!-- 课程分区（V1-23 ②）落在题目列表上方：课是"复习的入口"、
             题是"要练的内容"，从粗到细。progress.loaded 之前不渲染 ——
             档案还没读回来时 favorites 是空数组，和"真的没收藏过"长得
             一模一样，先画空态会闪一句假话（同 stores 的 loaded 纪律）。 -->
        <MiCard v-if="progress.loaded" class="fav-course-card">
          <div class="fav-course-head">
            <span class="fav-course-title">{{ FAVORITES.COURSE_TITLE }}</span>
            <span class="fav-course-n">{{ FAVORITES.courseCount(courseFavs.length) }}</span>
          </div>
          <div v-if="courseFavs.length > 0" class="fav-course-list">
            <button
              v-for="c in courseFavs"
              :key="c.id"
              type="button"
              class="fav-course-item"
              @click="openLesson(c.id)"
            >
              <span class="fav-course-name">{{ c.title }}</span>
              <span v-if="c.missing" class="fav-course-miss">{{ FAVORITES.COURSE_MISSING }}</span>
            </button>
          </div>
          <p v-else class="fav-course-empty">{{ FAVORITES.COURSE_EMPTY }}</p>
        </MiCard>

        <MiCard>
          <div class="fav-sec-title">{{ FAVORITES.QUESTIONS_TITLE }}</div>
          <div class="fav-head">
            <div class="fav-count">{{ FAVORITES.countAll(rows.length) }}</div>
            <MiButton v-if="rows.length > 0" size="sm" variant="ghost" @click="toggleSelectAll">
              {{ allSelected ? FAVORITES.clearSelection : FAVORITES.selectAll }}
            </MiButton>
          </div>

          <!--
            看不出出处的那几条被这次筛选挡在外面了 —— **必须说出来**。
            收藏是用户自己的东西，它不能悄悄变少（lib/favorites-view.ts 的抬头）。
          -->
          <div v-if="view.hiddenUnknown > 0" class="fav-unknown">
            {{ FAVORITES.unknownHidden(view.hiddenUnknown) }}
          </div>

          <div v-if="rows.length > 0" class="fav-list" v-auto-animate>
            <div v-for="row in rows" :key="row.item.key" class="fav-item">
              <MiCheckbox
                :model-value="selected.has(row.item.key)"
                @update:model-value="(v) => setSelected(row.item.key, v)"
              />
              <div class="fav-body">
                <div class="fav-stem">
                  <MiRichText :text="row.stem" />
                </div>
                <div class="fav-meta">
                  <span v-if="row.lessonTitle" class="fav-lesson">
                    {{ row.lessonTitle }}
                  </span>
                  <span v-if="row.ai" class="fav-ai">{{ PRACTICE.AI_ENTRY_TAG }}</span>
                  <MiTag v-if="row.meta" color="gray">
                    {{ TYPE_DISPLAY[row.meta.type] }}
                  </MiTag>
                  <MiTag v-if="row.meta" color="yellow">
                    {{ DIFFICULTY_DISPLAY[row.meta.difficulty] }}
                  </MiTag>
                  <span class="fav-source">{{ sourceLabelOf(row) }}</span>
                  <span v-if="row.added" class="fav-date">
                    {{ FAVORITES.addedAt(row.added) }}
                  </span>
                </div>

                <div v-if="noteEditing === row.item.key" class="fav-note-edit">
                  <MiInput
                    v-model="noteDraft"
                    multiline
                    :rows="2"
                    :placeholder="FAVORITES.NOTE_PLACEHOLDER"
                  />
                  <div class="fav-note-btns">
                    <MiButton size="sm" variant="primary" @click="saveNote(row.item.key)">
                      {{ FAVORITES.NOTE_SAVE }}
                    </MiButton>
                    <MiButton size="sm" variant="ghost" @click="noteEditing = null">
                      {{ FAVORITES.NOTE_CANCEL }}
                    </MiButton>
                  </div>
                </div>
                <button
                  v-else
                  class="fav-note"
                  :class="{ empty: !row.item.note }"
                  @click="startNote(row.item)"
                >
                  {{ row.item.note || FAVORITES.NOTE_EMPTY }}
                </button>
              </div>

              <div class="fav-actions">
                <!-- 挑战题不给「单题练习」：它按规格只在阶段 / 整门 / 每日挑战里出 -->
                <MiButton
                  v-if="row.canPractice"
                  size="sm"
                  variant="secondary"
                  @click="practice([row.item])"
                >
                  {{ FAVORITES.ACTION_PRACTICE }}
                </MiButton>
                <!-- 一个文件夹都没有时不摆「移动到…」：移进移出都没有去处 -->
                <MiButton
                  v-if="fav.folders.length > 0"
                  size="sm"
                  variant="ghost"
                  @click="openMove([row.item.key])"
                >
                  {{ FAVORITES.ACTION_MOVE }}
                </MiButton>
                <MiButton size="sm" variant="ghost" @click="removeOne(row.item)">
                  {{ FAVORITES.ACTION_UNFAV }}
                </MiButton>
              </div>
            </div>
          </div>
          <!-- 空态的按钮只在"真的还没收过"时给（V1-52 ④）：筛选后为空属于
               "收藏还在、只是这档没有"，那时的出路是换筛选器，不是去学课 -->
          <MiEmpty v-else v-bind="emptyState">
            <MiButton
              v-if="fav.items.length === 0"
              size="sm"
              variant="primary"
              @click="router.push('/learn')"
            >
              {{ FAVORITES.EMPTY_GO_LEARN }}
            </MiButton>
          </MiEmpty>
        </MiCard>

        <div v-if="selectedItems.length > 0" class="fav-toolbar">
          <span class="fav-toolbar-n">{{ FAVORITES.selected(selectedItems.length) }}</span>
          <MiButton variant="primary" size="sm" @click="practice(selectedItems)">
            {{ FAVORITES.SELECTED_PRACTICE }}
          </MiButton>
          <MiButton
            v-if="fav.folders.length > 0"
            variant="secondary"
            size="sm"
            @click="openMove(selectedItems.map((i) => i.key))"
          >
            {{ FAVORITES.SELECTED_MOVE }}
          </MiButton>
          <MiButton variant="ghost" size="sm" @click="removeSelected">
            {{ FAVORITES.SELECTED_REMOVE }}
          </MiButton>
          <MiButton variant="ghost" size="sm" @click="selected = new Set()">
            {{ FAVORITES.clearSelection }}
          </MiButton>
        </div>
      </div>
    </div>

    <MiModal v-model:visible="createVisible" :title="FAVORITES.NEW_FOLDER">
      <MiInput v-model="folderName" :placeholder="FAVORITES.FOLDER_NAME_PLACEHOLDER" />
      <template #footer>
        <MiButton variant="secondary" @click="createVisible = false">
          {{ FAVORITES.FOLDER_CANCEL }}
        </MiButton>
        <MiButton variant="primary" @click="confirmCreate">
          {{ FAVORITES.FOLDER_CREATE }}
        </MiButton>
      </template>
    </MiModal>

    <MiModal
      :visible="renameTarget !== null"
      :title="FAVORITES.FOLDER_RENAME"
      @update:visible="renameTarget = null"
    >
      <MiInput v-model="folderName" :placeholder="FAVORITES.FOLDER_NAME_PLACEHOLDER" />
      <template #footer>
        <MiButton variant="secondary" @click="renameTarget = null">
          {{ FAVORITES.FOLDER_CANCEL }}
        </MiButton>
        <MiButton variant="primary" @click="confirmRename">
          {{ FAVORITES.FOLDER_CREATE }}
        </MiButton>
      </template>
    </MiModal>

    <MiModal
      :visible="deleteTarget !== null"
      :title="FAVORITES.folderDeleteTitle(deleteTarget?.name ?? '')"
      @update:visible="deleteTarget = null"
    >
      <p class="fav-del-body">
        {{ FAVORITES.folderDeleteBody(deleteTarget ? (folderCounts.byId[deleteTarget.id] ?? 0) : 0) }}
      </p>
      <template #footer>
        <MiButton variant="secondary" @click="deleteTarget = null">
          {{ FAVORITES.FOLDER_CANCEL }}
        </MiButton>
        <MiButton variant="danger" @click="confirmDelete">
          {{ FAVORITES.folderDeleteOk }}
        </MiButton>
      </template>
    </MiModal>

    <MiModal v-model:visible="moveVisible" :title="FAVORITES.moveTitle">
      <MiSelect v-model="moveTarget" :options="moveOptions" />
      <template #footer>
        <MiButton variant="secondary" @click="moveVisible = false">
          {{ FAVORITES.MOVE_CANCEL }}
        </MiButton>
        <MiButton variant="primary" @click="confirmMove">
          {{ FAVORITES.MOVE_OK }}
        </MiButton>
      </template>
    </MiModal>
  </div>
</template>

<style scoped>
.favorites-page {
  max-width: 1000px;
  margin: 0 auto;
}
.page-title {
  font-family: var(--mi-font-title);
  font-size: 20px;
  margin-bottom: 16px;
}
.fav-grid {
  display: grid;
  /* 220px 固定列在中栏拖窄 + 高缩放时会吃掉整条内容盒（220+16 > 内容盒），
     右列被裁到框外、没有横向滚动条够不着 —— 极端[2] 预案点名的
     「FavoritesView 同样处理」。minmax 下正常布局仍是 220px（视觉零变化），
     挤不下时才收缩；文件夹名本来就有 ellipsis，窄了也念得出来。 */
  grid-template-columns: minmax(160px, 220px) 1fr;
  gap: 16px;
  /* 左栏是筛选器，不该被右栏的长列表拉长 */
  align-items: start;
}
.fav-group + .fav-group {
  margin-top: 18px;
}
.fav-group-title {
  font-size: 12px;
  color: var(--mi-text-3);
  margin-bottom: 8px;
}
.fav-folder-row {
  display: flex;
  flex-direction: column;
}
.fav-folder {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: var(--mi-radius-sm);
  background: transparent;
  color: var(--mi-text-2);
  font-family: var(--mi-font);
  font-size: 13px;
  text-align: left;
  cursor: var(--mi-cursor, pointer);
}
.fav-folder:hover {
  background: var(--mi-zebra);
}
.fav-folder.active {
  background: var(--mi-blue-light);
  color: var(--mi-text);
}
.fav-folder-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fav-folder-n {
  color: var(--mi-text-3);
  font-size: 12px;
}
.fav-folder-acts {
  display: flex;
  gap: 2px;
  padding-left: 8px;
}
.fav-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
/* 两个分区的小标题（V1-23）：大标题退回「⭐ 收藏」后，「题目 / 课程」的
   分野由这里说。轻字重、与 fav-group-title 同族但不抢卡内主体的注意力 */
.fav-sec-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
}
.fav-course-card {
  margin-bottom: 16px;
}
.fav-course-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.fav-course-title {
  font-size: 14px;
  font-weight: 600;
}
.fav-course-n {
  font-size: 12px;
  color: var(--mi-text-3);
}
.fav-course-list {
  display: flex;
  flex-direction: column;
}
/* 整行是可点的课（同 fav-item 的 border-top 行律），焦点环 offset 0 ——
   全宽行用负环会贴到卡边被裁，0 是侧栏课行的同一口径 */
.fav-course-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  border-top: 1px solid var(--mi-border);
  background: transparent;
  color: var(--mi-text-2);
  font-family: var(--mi-font);
  font-size: 13px;
  line-height: 1.7;
  text-align: left;
  cursor: var(--mi-cursor, pointer);
}
.fav-course-item:hover {
  background: var(--mi-zebra);
}
.fav-course-item:focus-visible {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 0;
}
.fav-course-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fav-course-miss {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--mi-warn-deep);
}
.fav-course-empty {
  font-size: 13px;
  color: var(--mi-text-3);
  line-height: 1.8;
}
.fav-count {
  font-size: 13px;
  color: var(--mi-text-2);
}
.fav-unknown {
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: var(--mi-radius-sm);
  background: var(--mi-warn-fill);
  /*
   * V1-57：这里原来是 --mi-on-fill（深色 #1b232e）压在 --mi-warn-fill
   * （深色 #241d10）上 = 1.05:1，暗色下整块近乎隐形 —— 而它恰好只在
   * 「有收藏找不到出处」这种必须出声时才出现。--mi-on-fill 的正确消费
   * 对象是浅色实心块（blue-deep/error 那类），不是暗色底的告示条。
   * --mi-warn-deep 在暗色下 11.22:1、亮色下同样达标。
   */
  color: var(--mi-warn-deep);
  font-size: 12px;
  line-height: 1.7;
}
.fav-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 8px;
  border-top: 1px solid var(--mi-border);
}
.fav-body {
  flex: 1;
  min-width: 0;
}
.fav-stem {
  font-size: 14px;
  color: var(--mi-text);
  line-height: 1.7;
}
.fav-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--mi-text-3);
}
.fav-lesson {
  color: var(--mi-text-2);
}
.fav-ai {
  color: var(--mi-purple-ink);
}
.fav-note {
  display: block;
  width: 100%;
  margin-top: 6px;
  padding: 4px 6px;
  border: none;
  border-left: 2px solid var(--mi-blue);
  border-radius: 0 var(--mi-radius-sm) var(--mi-radius-sm) 0;
  background: transparent;
  color: var(--mi-text-2);
  font-family: var(--mi-font);
  font-size: 12px;
  line-height: 1.7;
  text-align: left;
  /* 笔记里的换行是内容（store 的 setNote 不 trim） */
  white-space: pre-wrap;
  cursor: var(--mi-cursor, pointer);
}
.fav-note.empty {
  border-left-color: transparent;
  color: var(--mi-text-3);
}
.fav-note:hover {
  background: var(--mi-zebra);
}
.fav-note-edit {
  margin-top: 6px;
}
.fav-note-btns {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.fav-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}
/*
 * 吸底多选工具条。`position: sticky` 贴着的是**内层的滚动容器**（App.vue 的 main），
 * 不是文档 —— 文档本身不滚（见 miai-scroll-container 那条）。
 */
.fav-toolbar {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: var(--mi-radius);
  /* **实色**，不走 glass 令牌（2026-10-04 复核改回来的）：这是吸底覆盖层，
     滚动行会从它底下穿过去 —— 玻璃化后正文直接透到工具条文字背后，局部
     对比度随滚动位置瞬间劣化（浅色主题最坏约 2:1，低于 4.5 门槛）。
     悬浮层的可读性优先于「面板通透」的观感；壁纸关时它本来也逐字节同色。 */
  background: var(--mi-card);
  box-shadow: var(--mi-shadow-lg);
}
.fav-toolbar-n {
  flex: 1;
  font-size: 13px;
  color: var(--mi-text-2);
}
.fav-del-body {
  font-size: 13px;
  color: var(--mi-text-2);
  line-height: 1.9;
}
</style>
