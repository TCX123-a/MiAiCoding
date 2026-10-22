<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useContentStore } from '../stores/content'
import { useProgressStore } from '../stores/progress'
import { useQuizStore } from '../stores/quiz'
import MiCard from '../components/base/MiCard.vue'
import MiButton from '../components/base/MiButton.vue'
import MiSelect from '../components/base/MiSelect.vue'
import MiTabs from '../components/base/MiTabs.vue'
import MiEmpty from '../components/base/MiEmpty.vue'
import MiMascot from '../components/base/MiMascot.vue'
import MiProgressBar from '../components/base/MiProgressBar.vue'
import MiRichText from '../components/base/MiRichText.vue'
import MiModal from '../components/base/MiModal.vue'
import FavoriteStar from '../components/domain/FavoriteStar.vue'
import StagePaperDialog from '../components/domain/StagePaperDialog.vue'
import { toast } from '../components/base/toast'
import { EMPTY, NAV, PAPER, PRACTICE, TITLE, TOAST } from '../lib/copy'
import { LANG_LABEL, STAGE_LABEL } from '../lib/labels'
import { computePerLang } from '../lib/overview'
import { useStagePaperFlow } from '../lib/stage-practice'
import { useExtendStarter } from '../lib/extend'
import { splitWrongbook } from '../lib/wrongbook-view'
import { buildPool, type PoolItem } from '../../../shared/challenge'
import { buildPaper } from '../../../shared/quiz-paper'
import { questionKey } from '../../../shared/question-key'
import { isAiEntry, resolveWrongQuestion } from '../../../shared/wrongbook'
import { isChallenge } from '../../../shared/difficulty'
import { EXTEND_MAX } from '../../../shared/extend-paper'
import { localDateKeyOf } from '../../../shared/dates'
import { AI_WRONG_CAP } from '../../../shared/types'
import type { Question, WrongBookEntry } from '../../../shared/types'

// M4-04：练习页（单元练习入口说明 + 随机组卷，题数可配）
// M4-05：错题本页签（列表/重做/答对自动消除）
// 学习闭环 §5：错题本升级（三枚状态筛 / 行内动作 / 来源徽章 / 延展练习）
// 2026-10-01：「阶段练习」页签（阶段/整门综合练习的入口，从总览页搬来）
const router = useRouter()
const route = useRoute()
const content = useContentStore()
const progress = useProgressStore()
const quiz = useQuizStore()
const { startExtend } = useExtendStarter()

/**
 * 页签归属。初始值认深链 `?tab=wrongbook`（结果页的「去错题本」带它跳过来，
 * V1-22 / V2-16）；人已经在场时的 query 变化由下面那个 watch 接住。
 */
const tab = ref(route.query.tab === 'wrongbook' ? 'wrongbook' : 'practice')
const paperSize = ref('10')

// ---- 阶段练习页签（2026-10-01 从总览页搬来的入口）

/**
 * 每语言：已学/总数 + 各阶段完成度。和总览页同一份算式（`lib/overview.ts`，
 * 有单测钉住「一门语言一张卡」）—— 这里**不许自己数课**，数法写两遍就会漂移。
 */
const perLang = computed(() =>
  computePerLang(content.bundle.outline, content.bundle.lessons, progress.learnedSet)
)

/** 确认框那一步的全部状态（组卷/开卷都在 `lib/stage-practice.ts`，这里只管摆按钮） */
const { pendingPaper, paperOpen, openPaper, startPaper } = useStagePaperFlow()

/**
 * 可抽题池：所有已解锁/已学、且有内容的课的全部题目。
 * 池子里的每一项都**带着宿主课 id**（`PoolItem`）——这是错题本能查回题干的前提，
 * 详见 shared/challenge.ts 开头那段。
 *
 * 【挑战题不进随机组卷】它们只在阶段综合练习 / 整门练习 / 每日挑战里出现
 * （主人规格）；判据在 shared/difficulty.ts，七个练习入口共用同一条。
 */
const pool = computed<PoolItem[]>(() =>
  buildPool(
    content.bundle.lessons,
    (id) => content.statusOf(id),
    (st) => st === 'open' || st === 'learned'
  ).filter((p) => !isChallenge(p.question))
)

/**
 * 池子空时的带路目标（V1-55，学 ReviewView 的池子空态）：第一门还没学的课。
 * 池子为什么空 = 一课都还没学，所以"去哪"的答案只有一个。
 */
const firstLearnable = computed(() => {
  const l = content.bundle.lessons.find((x) => content.statusOf(x.id) === 'open')
  return l ? { id: l.id, title: l.title } : null
})

function goLearn(): void {
  if (firstLearnable.value) router.push(`/lesson/${firstLearnable.value.id}`)
}

/**
 * 随机组卷。
 *
 * 用 `buildPaper` 而不是 `pickFromPool`：前者在"洗题取前 n"之外还多洗了
 * **每道题的选项顺序** —— 少了那一步，随机卷虽然题目每次不同，
 * 但每道选择题的正确答案仍然固定在第几位，做两轮就能靠"选第几个"蒙对。
 */
function startRandom() {
  if (pool.value.length === 0) {
    // V1-55 后按钮已禁用，这条成了兜底（键盘/将来入口到这儿也不许静默）
    toast(TOAST.NO_QUESTIONS_YET, 'warn')
    return
  }
  const picked = buildPaper(pool.value, Number(paperSize.value))
  // questions 和 keys 必须**同一次挑选**产生，不能用 map 各算一遍：
  // 两次挑选的随机结果不同，配对就会错位，错的题会记到别的题头上。
  const questions = picked.map((p) => p.question)
  const keys = picked.map((p) => questionKey(p.lessonId, p.question.id))
  quiz.startQuiz('random', '__random__', questions, keys)
  toast(TOAST.randomPaperReady(questions.length), 'success')
}

// ---- 错题本

/** 三枚状态筛：在库 / 已移除 / 漏洞（学习闭环 §10.1） */
type WrongFilter = 'active' | 'removed' | 'hole'
const filter = ref<WrongFilter>('active')

/**
 * 四组筛选（在库 / 已移除 / 漏洞 / 已毕业）从 `lib/wrongbook-view.ts` 拿 ——
 * 判据本身有单测（views/ 不在 vitest 的 include 里，写在这儿就永远没人守）。
 * ⚠️ 在库那条的 `!e.removed` 是学习闭环加的：软删的条目留在文件里（要留出恢复的路），
 * 少判这一个字段，删掉的题会继续躺在列表里 —— 用户点了「移除」看着它纹丝不动。
 */
const slices = computed(() => splitWrongbook(quiz.wrongbook))
const activeEntries = computed(() => slices.value.active)
const removedEntries = computed(() => slices.value.removed)
const holeEntries = computed(() => slices.value.hole)
const clearedCount = computed(() => slices.value.cleared.length)

const visibleEntries = computed(() =>
  filter.value === 'removed'
    ? removedEntries.value
    : filter.value === 'hole'
      ? holeEntries.value
      : activeEntries.value
)

const emptyState = computed(() =>
  filter.value === 'removed'
    ? EMPTY.WRONGBOOK_NO_REMOVED
    : filter.value === 'hole'
      ? EMPTY.WRONGBOOK_NO_HOLE
      : EMPTY.WRONGBOOK_EMPTY
)

/**
 * 「重做全部」作用的对象 = **当前筛选里在库的那些**：
 * 在库视图全都在库，漏洞视图就是插了旗的那批。
 * 已移除视图没有这个按钮（那一屏只有「恢复」——把删掉的东西重做一遍不是诉求）。
 */
const redoTargets = computed(() =>
  filter.value === 'hole' ? holeEntries.value : activeEntries.value
)

/** 去内容包里按「课号 + 题号」找内置题。找不到返回 null（题被移走了） */
function findBuiltIn(lessonId: string, qid: string): Question | null {
  return content.lessonOf(lessonId)?.questions.find((x) => x.id === qid) ?? null
}

/**
 * 错题条目 → 展示信息（课名 + 题干 + 题目本体）。
 *
 * 【为什么走 resolveWrongQuestion 而不是自己 find 一次】
 * 列表显示、点「重做」组卷、点 ⭐ 收藏，三处必须给出**同一个答案**。
 * 各写一遍的话，一处改了一处没改，表现就是「列表里有这道题、点重做却把它跳过了」——不报错。
 *
 * `question` 就是那一次解析的结果（找不到是 null），⭐ 直接拿它去收藏 ——
 * AI 题的收藏**必须带本体**，少了它 store 会当场拒绝并弹一句
 * （`stores/favorites.ts` 的 toggle），所以这里不能另找一道题顶上。
 */
function entryInfo(e: WrongBookEntry): {
  lessonTitle: string
  stem: string
  ai: boolean
  question: Question | null
} {
  const q = resolveWrongQuestion(e, findBuiltIn)
  const lesson = content.lessonOf(e.lessonId)
  return {
    lessonTitle: lesson?.title ?? e.lessonId,
    stem: q?.stem ?? PRACTICE.MISSING_STEM,
    // AI 题的课名是它的**宿主课**（「这题考的是哪一课」），不是「它属于这一课」。
    // 不标出来，用户会以为那道题是从那门课里出的，回头在课里翻不到
    ai: isAiEntry(e),
    question: q
  }
}

/**
 * 错题日期：显示它**在本地属于哪一天**。
 *
 * ⚠️ 原来写的是 `e.lastWrongAt.slice(0, 10)` —— `lastWrongAt` 存的是 **UTC** 时间戳，
 * 直接切前 10 位等于拿 UTC 的日期当本地日期用。本机东八区，晚上 20:00 之后
 * （UTC 还没翻页）错的题会显示成前一天；凌晨 0–8 点错的又会被算成昨天。
 * 日期基准的完整说明见 shared/dates.ts。
 */
function wrongDate(e: WrongBookEntry): string {
  return localDateKeyOf(e.lastWrongAt) ?? ''
}

/** 这条能不能单独重做：题找得到、而且不是挑战题（见 redoAll 的注释） */
function canRedo(e: WrongBookEntry): boolean {
  const q = resolveWrongQuestion(e, findBuiltIn)
  return q !== null && !isChallenge(q)
}

/**
 * canRedo 为假的两义拆开（V2-18）：挑战题（题在、只是不能单题重做）
 * vs 坏条目（题都找不到了）。
 *
 * 【为什么要拆】模板里原来只有「能重做 → 按钮；不能 → 什么都不摆」。
 * 坏条目的题干自己会显示「题目已被移走喵」，可挑战题那一行看起来和
 * 邻居一模一样、只是凭空少一颗按钮 —— 用户只能当成 bug 或怀疑按钮被吞了。
 * 拆开之后挑战题那行给一句说明并点名「延展练习」（那条路真的能走：
 * 同课/同标签的非挑战题，见 shared/extend-paper.ts 的过滤）。
 */
function isChallengeEntry(e: WrongBookEntry): boolean {
  const q = resolveWrongQuestion(e, findBuiltIn)
  return q !== null && isChallenge(q)
}

/**
 * 单条重做：只把这一道题放进会话，模式仍是 wrong（**答对即从错题本毕业**）。
 *
 * 【为什么不复用 redoAll 那条路】它攒的是"全部"，这里只有一条；
 * 但配对规矩一样 —— `{question, key}` 成对交给 buildPaper 洗
 * （洗选项顺序，顺便让 keys 跟着走）。
 */
function redoOne(e: WrongBookEntry) {
  const q = resolveWrongQuestion(e, findBuiltIn)
  if (!q || isChallenge(q)) return
  const paper = buildPaper([{ question: q, key: e.key }])
  quiz.startQuiz(
    'wrong',
    '__wrong__',
    paper.map((x) => x.question),
    paper.map((x) => x.key)
  )
  toast(TOAST.retryWrong(1), 'success')
}

/**
 * 重做（当前筛选里的）全部错题：questions + 原 key 一起进会话，答对即消除。
 *
 * 【为什么是「题 + 键」成对攒，而不是两个平行数组】
 * `buildPaper` 会把题目顺序洗掉。如果键还留在原来那个数组里，
 * 洗完之后 `keys[i]` 就不再是 `questions[i]` 的键了 —— 后果是
 * **答对的题消除不掉、答错的题记到别的题头上**，而且一声不吭。
 * 攒成 `{ question, key }` 之后，配对是结构上的事，洗牌没法只洗一半。
 *
 * 【错题重做尤其需要洗】
 * 这是同几道题**反复出现**的地方 —— 顺序和选项都不洗的话，
 * 第二遍就是纯背位置，错题本反而不起作用了。
 *
 * 【挑战题会被跳过】它们只在阶段综合练习 / 整门练习 / 每日挑战里出现
 * （主人规格）。每日挑战里答错的挑战题照常进错题本，但「重做全部」不发它们 ——
 * 挑战题的重做入口留给阶段卷那几条路。**行内不摆一个按不动的按钮**：
 * canRedo 为假的那些行干脆不显示「重做」。
 */
function redoAll() {
  const entries = redoTargets.value
  if (entries.length === 0) return
  const items: { question: Question; key: string }[] = []
  for (const e of entries) {
    // AI 题从条目自带的本体里取；内置题去内容包取。见 shared/wrongbook.ts
    const q = resolveWrongQuestion(e, findBuiltIn)
    if (q && !isChallenge(q)) items.push({ question: q, key: e.key })
  }
  if (items.length === 0) {
    toast(TOAST.WRONG_ENTRIES_BROKEN, 'warn')
    return
  }
  const paper = buildPaper(items)
  quiz.startQuiz(
    'wrong',
    '__wrong__',
    paper.map((x) => x.question),
    paper.map((x) => x.key)
  )
  toast(TOAST.retryWrong(paper.length), 'success')
}

// ---- 手动管理（软删 / 恢复 / 标漏洞）

/**
 * 软删一条。**不弹确认框** —— 能撤销的删除再弹框是纯噪音；
 * 换成 5 秒的撤销窗口（toast 上那枚按钮）。
 *
 * 【撤销为什么绑 key 而不是绑这条记录对象】撤销执行时列表可能已经重渲染过，
 * 记录对象早换了；key 才是身份（和错题本全项目一致）。
 */
async function removeOne(e: WrongBookEntry) {
  const ok = await quiz.patchWrongbook([{ key: e.key, patch: { removed: true } }])
  if (!ok) return
  toast(TOAST.WRONG_REMOVED, 'success', 5000, {
    label: TOAST.UNDO,
    run: () => void restoreEntry(e.key)
  })
}

/** 恢复（「已移除」里的按钮和撤销按钮共用这一个动作） */
async function restoreEntry(key: string) {
  const ok = await quiz.patchWrongbook([{ key, patch: { removed: false } }])
  if (ok) toast(TOAST.WRONG_RESTORED, 'success')
}

async function toggleHole(e: WrongBookEntry) {
  const want = !e.hole
  const ok = await quiz.patchWrongbook([{ key: e.key, patch: { hole: want } }])
  if (ok) toast(want ? TOAST.WRONG_HOLE_ON : TOAST.WRONG_HOLE_OFF, 'success')
}

// ---- 延展练习弹窗

const extendFor = ref<WrongBookEntry | null>(null)
const extendCount = ref('5')
/**
 * 正在组延展卷（静态池不够时要等 AI 补题，最长可到 180 秒）。
 *
 * 没有它的时候，用户点「开始」→ 弹窗立刻关掉 → 十几秒里界面毫无变化，
 * 唯一合理的解读就是「没点上」，于是再点一次。真正的保护在 lib/extend.ts 的
 * 模块级 in-flight 闸（那次连点不会毁掉会话），但让用户**看得见**在等，
 * 才是这条 UX 问题的正解。按钮转圈、选择器与取消一起冻住。
 */
const extendBusy = ref(false)
/** 弹窗开关跟着"有没有选中一行"走：打开=选中、关闭（Esc/遮罩/按钮）=清空 */
const extendVisible = computed({
  get: () => extendFor.value !== null,
  set: (v: boolean) => {
    if (!v) extendFor.value = null
  }
})
const extendDesc = computed(() =>
  extendFor.value ? PRACTICE.extendDesc(entryInfo(extendFor.value).lessonTitle) : ''
)
/** 1~10 道（EXTEND_MAX 是上限的唯一出处，池子不够时 extend 启动器会如实少出） */
const extendOptions = Array.from({ length: EXTEND_MAX }, (_, i) => ({
  value: String(i + 1),
  label: PRACTICE.extendCountOption(i + 1)
}))

function openExtend(e: WrongBookEntry) {
  extendFor.value = e
}

async function confirmExtend() {
  const e = extendFor.value
  // `extendBusy` 防的是同一张弹窗里的连点（Enter + 点击）；跨入口的连点由
  // lib/extend.ts 的模块级闸兜底
  if (!e || extendBusy.value) return
  extendBusy.value = true
  try {
    // 静态池不够时会等 AI 补题（lib/extend.ts）—— 等的时候弹窗留在原地转圈。
    // （原先先关弹窗再等：界面十几秒毫无变化，用户只会以为没点上。）
    await startExtend(e, Number(extendCount.value))
  } finally {
    extendBusy.value = false
    // **等它回来再关**：startQuiz 与这里在同一拍里完成，Vue 还没渲染，
    // 所以会话遮罩（QuizOverlay）和弹窗不会同时出现在屏幕上闪一下。
    extendFor.value = null
  }
}

// 切到错题本页签时刷新
watch(tab, (t) => {
  if (t === 'wrongbook') void quiz.loadWrongbook()
})
onMounted(() => {
  if (tab.value === 'wrongbook') void quiz.loadWrongbook()
})

/**
 * 深链落到错题本页签（V1-22 + V2-16）：结果页那颗「去错题本」带
 * `?tab=wrongbook` 跳过来（同总览页 `?card=`、设置页 `?at=` 的深链口径）。
 *
 * 【为什么要 watch 而不是只在初始化读一次】从结果页过来时练习页**可能
 * 已经在场上**（wrong 模式就是从这页开的局）—— 初始化那一次早跑完了，
 * 只读一次的写法在"人已经站在这一页"时是空的。
 * 之后 URL 里那个 tab 就留着不动了：用户手点页签切走由 ref 说了算，
 * 这里只在每次 query 真变成 wrongbook 时把 ref 拨过去。
 */
watch(
  () => route.query.tab,
  (t) => {
    if (t === 'wrongbook') tab.value = 'wrongbook'
  }
)
</script>

<template>
  <div class="practice-page">
    <h1 class="page-title">{{ NAV.PRACTICE }}</h1>
    <div class="practice-tabs">
      <MiTabs
        v-model="tab"
        :tabs="[
          { key: 'practice', label: TITLE.TAB_PRACTICE },
          { key: 'wrongbook', label: TITLE.tabWrongbook(activeEntries.length) },
          { key: 'stage', label: TITLE.TAB_STAGE }
        ]"
      />
    </div>

    <div v-if="tab === 'practice'" class="practice-grid">
      <MiCard :title="TITLE.RANDOM_CARD">
        <p class="card-desc">{{ PRACTICE.RANDOM_DESC }}</p>
        <div class="random-row">
          <MiSelect
            v-model="paperSize"
            :options="[
              { value: '5', label: PRACTICE.questionCount(5) },
              { value: '10', label: PRACTICE.questionCount(10) },
              { value: '15', label: PRACTICE.questionCount(15) },
              { value: '20', label: PRACTICE.questionCount(20) }
            ]"
          />
          <!-- V1-55：池子空 = 按了也不会有卷，禁用而不是点完弹一句警告 -->
          <MiButton variant="primary" :disabled="pool.length === 0" @click="startRandom">
            {{ PRACTICE.RANDOM_START }}
          </MiButton>
        </div>
        <div class="card-hint">
          {{ pool.length === 0 ? PRACTICE.POOL_EMPTY : PRACTICE.poolSize(pool.length) }}
        </div>
        <!-- 池子空：把"下一步去哪"直接给出来（学 ReviewView 空态的带路方式） -->
        <MiButton
          v-if="pool.length === 0 && firstLearnable"
          variant="primary"
          class="random-go-learn"
          @click="goLearn"
        >
          {{ PRACTICE.GO_LEARN }}
        </MiButton>
      </MiCard>

      <!--
        单元卡底下这条鱼。
        【为什么加在这儿】这张卡只有两行字，而 grid 会把两张卡拉到等高 ——
        左边那张有下拉框和按钮，比它高出一截，于是这张卡下半张是一片空白。
        `expect`（期待、指着前方）正好对上这张卡的语义：它讲的是
        「进课文去练」，鱼指的方向就是用户下一步该去的地方。
        【为什么这是**新增**而不是改动】卡片原有的标题、说明、提示一个字没动，
        鱼是接在它们**后面**的第三个兄弟节点。
      -->
      <MiCard :title="TITLE.UNIT_CARD">
        <p class="card-desc">{{ PRACTICE.UNIT_DESC }}</p>
        <div class="card-hint">{{ PRACTICE.UNIT_HINT }}</div>
        <div class="card-mascot">
          <MiMascot pose="expect" size="m" />
        </div>
      </MiCard>
    </div>

    <div v-else-if="tab === 'wrongbook'" class="wrongbook">
      <MiCard>
        <div class="wrongbook-head">
          <div>
            <div class="wrongbook-title">{{ TITLE.TAB_WRONGBOOK }}</div>
            <div class="card-hint">{{ PRACTICE.wrongbookDesc(clearedCount, AI_WRONG_CAP) }}</div>
            <!-- V2-19：两种「答对」不是一回事 —— 这行小字紧挨上面，专门说清
                 「每日复习答对 ≠ 毕业」（毕业判定只走本页「重做」）。 -->
            <div class="wrongbook-note">{{ PRACTICE.WRONGBOOK_GRADUATE_ONLY }}</div>
          </div>
          <!-- 已移除视图不摆这个按钮：那一屏的动作只有「恢复」，「重做全部」放这儿
               会指向空集合（看起来能点、点了一点反应都没有） -->
          <MiButton
            v-if="filter !== 'removed'"
            variant="primary"
            :disabled="redoTargets.length === 0"
            @click="redoAll"
          >
            {{ PRACTICE.RETRY_ALL }}
          </MiButton>
        </div>

        <!-- 三枚状态筛。计数就写在按钮上（在库 3 / 已移除 1 / 漏洞 2）——
             没有数，用户没法知道「移除」那一下到底生效了没有 -->
        <div class="wrong-filters">
          <MiButton
            :variant="filter === 'active' ? 'primary' : 'secondary'"
            size="sm"
            @click="filter = 'active'"
          >
            {{ PRACTICE.filterActive(activeEntries.length) }}
          </MiButton>
          <MiButton
            :variant="filter === 'removed' ? 'primary' : 'secondary'"
            size="sm"
            @click="filter = 'removed'"
          >
            {{ PRACTICE.filterRemoved(removedEntries.length) }}
          </MiButton>
          <MiButton
            :variant="filter === 'hole' ? 'primary' : 'secondary'"
            size="sm"
            @click="filter = 'hole'"
          >
            {{ PRACTICE.filterHole(holeEntries.length) }}
          </MiButton>
        </div>

        <!--
          挂在这里是因为错题本**真的会增量增删**：重做答对一条，那一条就从
          activeEntries 里消失 —— 没有补间的话它会「啪」地跳走，剩下的条目瞬间
          补位，眼跟上不。这是全项目最典型的 auto-animate 用例。
          （注意是挂在 .wrong-list 上，不是挂在 MiCard 上 ——
           挂 MiCard 会把这个卡片的标题和「重做全部」按钮一起卷进动画。）
          筛选切换时它同样让整列换得柔和，一举两得。
        -->
        <div v-if="visibleEntries.length > 0" class="wrong-list" v-auto-animate>
          <div v-for="e in visibleEntries" :key="e.key" class="wrong-item">
            <div class="wrong-stem">
              <!-- 行首小旗 = 知识点漏洞。视觉上就是一面旗，读屏靠 aria-label -->
              <span
                v-if="e.hole"
                class="wrong-flag"
                role="img"
                :title="PRACTICE.HOLE_FLAG_TITLE"
                :aria-label="PRACTICE.HOLE_FLAG_TITLE"
                >🚩</span
              >
              <!-- 题干过 `MiRichText`：错题本里的题干就是从内容包原样捞出来的那份，
                   里面本来就带内联标记（58 条题干里 26 条有），
                   裸插值会让「`malloc` 叼回来的是 ____」把反引号一起显示出来 -->
              <MiRichText :text="entryInfo(e).stem" />
            </div>
            <div class="wrong-meta">
              <span class="wrong-lesson">📚 {{ entryInfo(e).lessonTitle }}</span>
              <span v-if="entryInfo(e).ai" class="wrong-ai">{{ PRACTICE.AI_ENTRY_TAG }}</span>
              <span v-if="e.source" class="wrong-source">
                {{ PRACTICE.sourceLabel(e.source) }}
              </span>
              <span class="wrong-count">{{ PRACTICE.wrongTimes(e.wrongCount) }}</span>
              <span class="wrong-date">{{ wrongDate(e) }}</span>
            </div>
            <div class="wrong-actions">
              <template v-if="filter === 'removed'">
                <MiButton size="sm" variant="secondary" @click="restoreEntry(e.key)">
                  {{ PRACTICE.ACTION_RESTORE }}
                </MiButton>
              </template>
              <template v-else>
                <!-- 挑战题 / 题目被移走的行不给「重做」：按了也没反应的东西不摆出来 -->
                <MiButton v-if="canRedo(e)" size="sm" variant="secondary" @click="redoOne(e)">
                  {{ PRACTICE.RETRY_ONE }}
                </MiButton>
                <!--
                  V2-18：挑战题少了那颗「重做」，得有一句话解释 + 一个真入口。
                  坏条目不走这里（题干自己就是「题目已被移走喵」，两义不同）。
                -->
                <span v-else-if="isChallengeEntry(e)" class="wrong-no-redo">
                  {{ PRACTICE.NO_REDO_CHALLENGE }}
                </span>
                <MiButton size="sm" variant="ghost" @click="toggleHole(e)">
                  {{ e.hole ? PRACTICE.ACTION_HOLE_OFF : PRACTICE.ACTION_HOLE_ON }}
                </MiButton>
                <MiButton size="sm" variant="ghost" @click="openExtend(e)">
                  {{ PRACTICE.EXTEND_BTN }}
                </MiButton>
                <!--
                  ⭐ 收藏（学习闭环 §6）：错题本是"系统收的"，收藏是"我自己要留的"，
                  一个人手里这两件事经常同时发生 —— 重做之前先把它收下来，
                  以后想反复练就不用再错一次了。
                  `:question` 必须给**解析出来的**那道题（AI 题的本体在条目自己身上，
                  见 shared/wrongbook.ts）—— 给 null 的话 AI 题会被 store 拒绝收藏。
                -->
                <FavoriteStar :q-key="e.key" :question="entryInfo(e).question" source="wrong" />
                <MiButton size="sm" variant="ghost" @click="removeOne(e)">
                  {{ PRACTICE.ACTION_REMOVE }}
                </MiButton>
              </template>
            </div>
          </div>
        </div>
        <MiEmpty v-else-if="quiz.wrongbookLoaded" v-bind="emptyState" />
        <!--
          读档没过之前（wrongbookLoaded 假）这里**什么都不画**：错题本镜像的
          初值是空数组，先画空态会在每次切页签时当真地闪一句「错题本空空如也喵！」
          再自己被顶掉（2026-10-17 夜间批；MemoView/FavoritesView 同款 loaded 纪律）。
        -->
      </MiCard>

      <!-- 延展练习：挑几道相关的题接着练。题量 1~10，池子不够时如实少出（见 lib/extend.ts） -->
      <MiModal v-model:visible="extendVisible" :title="PRACTICE.EXTEND_TITLE">
        <p class="extend-desc">{{ extendDesc }}</p>
        <div class="extend-row">
          <span class="extend-label">{{ PRACTICE.EXTEND_COUNT }}</span>
          <MiSelect v-model="extendCount" :options="extendOptions" :disabled="extendBusy" />
        </div>
        <template #footer>
          <MiButton variant="secondary" :disabled="extendBusy" @click="extendVisible = false">
            {{ PRACTICE.EXTEND_CANCEL }}
          </MiButton>
          <MiButton variant="primary" :loading="extendBusy" @click="confirmExtend">
            {{ PRACTICE.EXTEND_START }}
          </MiButton>
        </template>
      </MiModal>
    </div>

    <!--
      阶段 / 整门综合练习（2026-10-01 从总览页搬进来的入口）。
      【为什么搬】总览页是"看进度"的地方，练习入口藏在那儿的阶段行尾上，
      学员得先想到"去总览页找"才碰得到。挪到练习页之后，
      入口和「随机练习」在同一屏，点开确认框还能看到这一卷的真实构成
      （题量/覆盖面/难度，见 StagePaperDialog）。侧栏课程列表的阶段末尾
      还有一个同名入口 —— 两处共用 useStagePaperFlow，状态各一份。
      【为什么整门行跟着一起搬】总览页那排按钮删掉后，「整门综合练习」
      （PAPER.LANG_GO）就只剩这儿一个入口 —— 少了它整门卷就没法开了。
    -->
    <div v-else class="stage-panel">
      <div class="stage-grid">
        <MiCard v-for="p in perLang" :key="p.lang" :title="'🐾 ' + (LANG_LABEL[p.lang] ?? p.lang)">
          <div class="lang-row">
            <MiProgressBar :percent="p.percent" show-label :height="8" />
          </div>
          <div class="stage-rows">
            <div v-for="s in p.stages" :key="s.stage" class="stage-row">
              <span class="stage-name">{{ STAGE_LABEL[s.stage] }}</span>
              <MiProgressBar :percent="s.percent" :height="5" />
              <span class="stage-count">{{ s.learned }}/{{ s.total }}</span>
              <!--
                入口只在**这一档有正文**时出现：空阶段的 missing 是 0，
                渲染出来会是「还差 0 课」—— 一个永远点不动、也说不清差什么的按钮。
                规则来自 lib/overview.ts 的 `doneOf`（空阶段永不算完成），
                所以这里必须用 `total > 0` 而不是 `done`。
              -->
              <MiButton
                v-if="s.total > 0"
                class="paper-go"
                variant="secondary"
                size="sm"
                :disabled="!s.done"
                @click="openPaper('stage', p.lang, s.stage)"
              >
                {{ s.done ? PAPER.STAGE_GO : PAPER.missing(s.missing) }}
              </MiButton>
            </div>
          </div>
          <!-- 整门卷：三个阶段全学完才解锁（`p.missing` 就是三档之和） -->
          <div v-if="p.total > 0" class="lang-go-row">
            <MiButton
              class="paper-go"
              variant="secondary"
              size="sm"
              :disabled="!p.done"
              @click="openPaper('lang', p.lang)"
            >
              {{ p.done ? PAPER.LANG_GO : PAPER.missing(p.missing) }}
            </MiButton>
          </div>
        </MiCard>
      </div>

      <StagePaperDialog v-model:visible="paperOpen" :draft="pendingPaper" @start="startPaper" />
    </div>
  </div>
</template>

<style scoped>
.practice-page {
  max-width: 860px;
  margin: 0 auto;
}
.page-title {
  font-family: var(--mi-font-title);
  font-size: 20px;
  margin-bottom: 16px;
}
.practice-tabs {
  margin-bottom: 16px;
}
.practice-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.card-desc {
  font-size: 13px;
  color: var(--mi-text-2);
  line-height: 1.9;
  margin-bottom: 14px;
}
.random-row {
  display: flex;
  gap: 10px;
}
.card-hint {
  margin-top: 12px;
  font-size: 12px;
  color: var(--mi-text-3);
}
/* 池子空时的带路键（V1-55）：接在提示行后面单独一行 */
.random-go-learn {
  margin-top: 12px;
}
/*
 * 单元卡底部那条鱼的落位。
 * 【为什么要单独一层 div 而不是直接给 MiMascot 挂 class】
 * MiMascot 的根元素带 `display: inline-flex` 和 `flex-shrink: 0`，
 * 这两个都是它自己尺寸契约的一部分（见 MiMascot.vue 的「尺寸锁三层」注释），
 * 从外面盖掉有风险。套一层只负责摆位置的容器，组件那三条尺寸规则就一条都不用碰。
 * 【为什么居中】这张卡的标题、说明、提示都是左对齐的一整段，
 * 鱼贴着左边会和文字挤成第四行；居中则读作「这张卡说到这儿」的收尾。
 */
.card-mascot {
  display: flex;
  justify-content: center;
  margin-top: 16px;
}
.wrongbook-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 6px;
}
.wrongbook-title {
  font-size: 16px;
  font-weight: 600;
}
/* V2-19：紧挨 wrongbookDesc 的小字（margin 比 card-hint 小，读作同一段说明的
   续行，而不是另一条独立提示） */
.wrongbook-note {
  margin-top: 4px;
  font-size: 12px;
  color: var(--mi-text-3);
}
.wrong-filters {
  display: flex;
  gap: 8px;
  margin: 10px 0 2px;
}
.wrong-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}
.wrong-item {
  padding: 12px 14px;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  background: var(--mi-bg);
}
.wrong-stem {
  font-size: 13px;
  line-height: 1.8;
  margin-bottom: 6px;
}
.wrong-flag {
  margin-right: 4px;
}
.wrong-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 12px;
  color: var(--mi-text-3);
}
.wrong-count {
  color: var(--mi-error-deep);
}
/* AI 题的那个小标。做得淡一点 —— 它是「这题的出处」的补充说明，
   不该比「错了几次」还抢眼 */
.wrong-ai {
  color: var(--mi-text-2);
}
/* 来源徽章：这条错题是从哪进来的。和 AI 标同档，不抢「错 N 次」 */
.wrong-source {
  color: var(--mi-text-2);
}
.wrong-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
/*
 * 挑战题行内那句「没有重做」的说明（V2-18）：占着按钮原本的位置，
 * 视觉上是说明不是按钮（无边框、次要色），和旁边真按钮拉开层次。
 */
.wrong-no-redo {
  display: inline-flex;
  align-items: center;
  align-self: center;
  font-size: 12px;
  color: var(--mi-text-2);
}
.extend-desc {
  font-size: 13px;
  color: var(--mi-text-2);
  margin-bottom: 14px;
}
.extend-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.extend-label {
  font-size: 13px;
}

/* ── 阶段练习页签（2026-10-01 从总览页搬来，行结构照搬那边） ── */
.stage-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
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
 * 阶段行尾那颗按钮。`flex-shrink: 0` 不能省 —— 它右边没有别的东西撑着，
 * 进度条（`flex: 1`）会一路挤过来，把按钮压成一行两三个字的窄条。
 * 未解锁时上面写的是「还差 N 课」，同样要靠它保持完整可读。
 */
.paper-go {
  flex-shrink: 0;
}
/*
 * 整门练习单独占一行、靠右。
 *
 * 【为什么不接着塞进最后一个阶段行】整门卷和阶段卷是**两个层级**的东西，
 * 贴在某一档后面会被读成"这一档还有一个按钮"。而且它上面那行已经排了
 * 四样东西（名字/进度条/计数/按钮），再挤一个进去谁都看不清。
 */
.lang-go-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}
</style>
