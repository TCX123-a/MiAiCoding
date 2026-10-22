/**
 * 每日挑战 store（M6）。
 *
 * 负责三件事，每一件都有个「为什么放这儿」：
 *   1. **抽题**（AI 优先，本地题库兜底）—— 要读内容包，而内容包只在渲染进程手里；
 *   2. **把抽好的题交给练习遮罩**（`quiz.startQuiz('challenge', ...)`）——
 *      挑战**不是第二套答题界面**，只是练习遮罩的第四个模式，理由见下；
 *   3. **记账**（做完把得分写回 challenge.json）。
 *
 * 【为什么复用练习遮罩，而不是新写一套答题 UI】
 * 三种题型（选择/填空/代码阅读）的渲染、判分、结果页评价已经在 QuizOverlay 里了。
 * 新写一套的代价不只是「多写一遍」：**两套判分一旦漂移，同一道题会在练习页判对、
 * 在挑战页判错** —— 那是最难查的一类 bug，因为两边单独看都对。
 * 复用的额外好处是白赚的：`finish()` 里「答错自动进错题本」对所有模式生效，
 * 挑战答错的题**自动进错题本**，一行额外代码都不用写。
 *
 * 【2026-10-10 主人令改版（v3），本文件是前端主战场】
 *   1. **答对继续、答错立即停止**：答错那一题就是本局最后一题（见下面
 *      `truncateAfterCurrent` 的 watcher 与收工记账里的 points 台账）；
 *   2. **取消单日题数上限**：开抽时抽**整个已学题库**，开始前可勾选今天想考的
 *      语言（见 `selectedPool`）；服务端协议里的 5000 只是防跑飞的健全性上界；
 *   3. **积分只由难度决定**（语言权重全 100，见 cloud/protocol.ts）；
 *   4. **收工 watcher 把 questions 与 answers 按游玩序成对重写为做过的前缀** ——
 *      修掉 v2 洗牌后「答案配错题」的静默 bug，见下面收工记账；
 *   5. **解锁闸**：任意一门语言（入门+中阶+精通）全部学完才能玩（见 `unlocked`）。
 */
import { computed, markRaw, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { toast } from '../components/base/toast'
import { TOAST } from '../lib/copy'
import type {
  AiTopicInput,
  ChallengeAnswer,
  ChallengeDay,
  ChallengeQuestion,
  Question,
  Stage
} from '../../../shared/types'
import {
  CHALLENGE_AI_BLOCK,
  CHALLENGE_LOCAL_CAP,
  buildPool,
  pickChallenge,
  type PoolItem
} from '../../../shared/challenge'
import { resolveDifficulty } from '../../../shared/difficulty'
import { CHALLENGE_RUN_MAX, LANGS, weightedPoints, type Lang } from '../../../shared/cloud/protocol'
import { questionKey } from '../../../shared/question-key'
import { buildPaper } from '../../../shared/quiz-paper'
import { buildSettlePayload } from '../lib/challenge-settle'
import { today } from '../lib/day-clock'
import { computePerLang, type LangProgress } from '../lib/overview'
import { toIpc } from '../lib/ipc-safe'
import { reportPetEvent } from '../lib/pet-bridge'
import { useContentStore } from './content'
import { useProgressStore } from './progress'
import { useQuizStore } from './quiz'
import { useSettingsStore } from './settings'

/**
 * 挑战会话挂在练习遮罩上时用的「课号」。
 *
 * 下划线包起来、带双下划线，是为了**永远不可能撞上真实课号**
 * （真实课号长 `common-01` / `python-stage1-08` 这样）。
 * 它只出现在 `quiz.session.lessonId` 里，**不会写进错题本** ——
 * 挑战题的错题 key 用的是各自宿主课的真实课号（见下）。
 */
export const CHALLENGE_SESSION_ID = '__challenge__'

/** 抽题结果，三种去向。用联合类型而不是 `null`，是因为「取消」和「失败」的下一步动作完全不同 */
type GenOutcome =
  | { kind: 'ok'; questions: ChallengeQuestion[]; source: 'local' | 'ai' }
  | { kind: 'canceled' }
  | { kind: 'empty' }

/**
 * 逐题回顾里的一行：**题目本体** + 当时答的 + 对错。
 *
 * 和 `ChallengeQuestion` 的区别是它已经把题目还原出来了 —— 回顾页不用再关心
 * 「这道题是内置的还是 AI 的、去哪儿找题干」，照着渲染就行。
 */
export interface ReviewRow {
  key: string
  question: Question
  /** 这道题是 AI 现场出的。**回顾页要标出来**：它的解析是 AI 写的，
   *  和内容包里经过校对的解析不是一回事，用户有权知道自己在读哪一种 */
  ai: boolean
  your: string | number | null
  ok: boolean
}

export const useChallengeStore = defineStore('challenge', () => {
  const content = useContentStore()
  const progress = useProgressStore()
  const quiz = useQuizStore()
  const settings = useSettingsStore()

  /** 今天那批题。`null` = 今天还没抽过 */
  const day = ref<ChallengeDay | null>(null)
  /** 抽题时优先避开这些题（题号 → 最后一次出现的日期） */
  const lastSeen = ref<Record<string, string>>({})

  /** 正在读存档 */
  const loading = ref(false)
  /** 正在抽题（AI 在飞时会长达十几秒，界面必须转圈 + 给取消） */
  const generating = ref(false)
  /** 刚刚这一批是 AI 没成、退回本地题库的。要告诉用户一句，别让他以为本喵在偷懒 */
  const fellBack = ref(false)
  /** 用户刚按了「不出了」。**必须说一句** —— 否则按钮转圈停了、页面没变化，他分不清是真停了还是没听见 */
  const canceled = ref(false)

  /**
   * 今天的日键（高-5，2026-10-15 改成活时钟）。
   *
   * 【原来错在哪】`computed(() => todayKey())` 的求值函数里**没有任何响应式
   * 依赖** —— Vue 算过第一次就把它缓存到进程结束。这是个常驻应用（桌宠 + 托盘），
   * 开着过夜是常态：过了零点它仍拿昨天的日键读档、判"今天挑战过没有"，
   * 每天都做挑战的人**每两天坏一天**，而且必须重启应用才恢复
   * （活窗实测：过零点后挑战页一直说"今天已经挑战过啦"）。
   *
   * 现在读的是活时钟的 ref（lib/day-clock.ts：准点计时器 / 唤醒复检 /
   * 即取即比三层机制），跨天自动翻值；下面两条 watch 负责把界面搬到新一天，
   * 正在抽题/答题时会先记欠账（pendingRollover），理由见那段注释。
   */
  const dateKey = computed(() => today.value)

  /*
   * 【高-5】跨零点换天：dateKey 一翻就把界面搬到新一天 —— 但**正在抽题 /
   * 正在答挑战时先缓一手**（pendingRollover 欠账）。
   *
   * 【为什么答题中绝不能当场换】收工 watcher 拿 `day.value` 当账本落分
   * （`byKey = d.questions`）：把它在答题途中换成新一天的 null，做完的分数会
   * **静默丢掉** —— watcher 第一行 `if (!s || !d || d.finishedAt) return` 一声
   * 不吭地放行。所以跨天那刻只要本局还在飞（含 AI 抽题在飞），先记账，
   * 等它落地再换：那一局本来就属于开局的日期，等它落完账再搬页面顺序反而更对。
   *
   * 【为什么抽题中也要缓】dateKey 已经是活的 —— 抽完的批次会用**新**日键落盘，
   * 此时清 day 属于白清；等落盘完直接走 reloadForNewDay 的早退分支（见下）。
   */
  let pendingRollover = false

  watch(dateKey, () => {
    if (generating.value || quiz.session?.mode === 'challenge') {
      pendingRollover = true
      return
    }
    void reloadForNewDay()
  })

  watch(
    () => generating.value || quiz.session?.mode === 'challenge',
    (busy) => {
      if (busy || !pendingRollover) return
      pendingRollover = false
      void reloadForNewDay()
    }
  )

  /**
   * 候选池：**只收学过的课**（主人 2026-09-13 拍板）。
   *
   * 不拿没学过的语法考人 —— 那是让人挫败，不是让人学会。
   * 代价是新用户池子是空的，所以「池子空」必须走空状态引导（见 ChallengeView）。
   */
  const pool = computed<PoolItem[]>(() =>
    buildPool(
      content.bundle.lessons,
      (id) => content.statusOf(id),
      (status) => status === 'learned'
    )
  )

  const hasPool = computed(() => pool.value.length > 0)

  /**
   * 今天**不想考**的语言（被点掉勾的）。内存态、不持久化 ——
   * 这是「今天想练哪门」的一次性选择，不是设置；落盘反而会让明天打开时
   * 语言被昨天的勾法悄悄收窄。
   */
  const deselectedLangs = ref<Lang[]>([])

  /**
   * 勾选器要列出来的语言：**池子里真有题的**那几门（按协议声明序）。
   * 排除 common —— 通用基础题不是一门语言，恒在池里（见 `selectedPool`）。
   * 学都没学过（池里没有）的语言不摆出来：摆一个只会出 0 道题的选项是噪音。
   */
  const poolLangs = computed<Lang[]>(() => {
    const present = new Set<Lang>()
    for (const it of pool.value) {
      const lang = content.lessonOf(it.lessonId)?.lang
      if (lang && lang !== 'common') present.add(lang)
    }
    return LANGS.filter((l) => l !== 'common' && present.has(l))
  })

  /**
   * 按勾选过滤后的池子：**common 恒含**，其余语言看勾。
   *
   * 【common 为什么不参与勾选】通用基础题不属于任何一门语言，勾「只考 C」
   * 不代表连基础题都不做了；而且它是池子的保底 —— 没有它，「全不勾」
   * 会直接一道题都抽不出来（那时界面禁用开始按钮，见 `selectedEmpty`）。
   */
  const selectedPool = computed<PoolItem[]>(() => {
    const off = deselectedLangs.value
    if (off.length === 0) return pool.value
    return pool.value.filter((it) => {
      const lang = content.lessonOf(it.lessonId)?.lang ?? 'common'
      return lang === 'common' || !off.includes(lang)
    })
  })

  /** 勾选后一道题都抽不出来（池子非空、但把有题的语言全点掉了）—— 界面据此禁用开始 */
  const selectedEmpty = computed(() => pool.value.length > 0 && selectedPool.value.length === 0)

  function isLangOn(lang: Lang): boolean {
    return !deselectedLangs.value.includes(lang)
  }

  function toggleLang(lang: Lang): void {
    deselectedLangs.value = isLangOn(lang)
      ? [...deselectedLangs.value, lang]
      : deselectedLangs.value.filter((l) => l !== lang)
  }

  /**
   * 每门语言的阶段进度 —— 解锁判定和「锁定页给学员看差在哪」共用一份。
   *
   * 复用总览页那条现成的推导（`computePerLang`），不在这里另算一套：
   * 两处若是各算各的，迟早出现「总览页说学完了、挑战页说没学完」。
   * 它天然排除 `common`（通用知识不是一门语言），正合解锁口径。
   */
  const langProgress = computed<LangProgress[]>(() =>
    computePerLang(content.bundle.outline, content.bundle.lessons, progress.learnedSet)
  )

  /**
   * 每日挑战的解锁闸：**任意一门语言三个阶段的课全部学完**（主人 2026-10-10 令）。
   *
   * 【口径为什么就是 `done`】`done = total > 0 && missing === 0`（见 lib/overview.ts）——
   * 它同时管住了「这门语言真有课上」和「一节不落」。三个阶段只是排课结构，
   * 哪个阶段能学、学没学完，`done` 已经逐节算过了，这里不重数一遍。
   *
   * 【为什么放在 store 而不是只放在界面】解锁是**规则**不是**装饰**：
   * 界面藏了按钮，其它入口（快捷键、将来别处的跳转）照样能调 `start()`。
   * 两道闸都得上，规则这道在 store 里。
   */
  const unlocked = computed(() => langProgress.value.some((p) => p.done))

  /** 档案读完了没有。**没读完不能下「你没学过任何课」这个结论**，见 progress.ts 的 loaded */
  const ready = computed(() => progress.loaded && !loading.value)

  const finishedToday = computed(() => day.value?.finishedAt != null)
  const scoreToday = computed(() => day.value?.score ?? null)

  /**
   * 这一局是**答错即停提前收工**的吗（结算卡要说一句为什么只做了这几道）。
   *
   * 判据 = 答对数 < 结算总题数。收工只有两条路：一路是答到没题了
   * （全对，correct === total），另一路是某题答错、当场截断（错的那道在 total 里
   * 且没得分，correct 必 < total）。所以它与「最后一道是不是错的」等价，
   * v2 老存档同一口径、不会误报。
   */
  const stoppedEarly = computed(() => {
    const sc = day.value?.score
    return sc != null && sc.correct < sc.total
  })

  /**
   * 逐题回顾要展示的行。
   *
   * 【为什么读的是 `day`（存档）而不是 `quiz.session`】
   * 做完题遮罩一关，`quiz.session` 就被置成 null 了 —— 而回顾按钮恰恰在遮罩
   * 关掉之后的结算卡上。读 session 的话，这个按钮**一出生就是死的**。
   * 读存档还白赚一件事：重开应用、甚至过几天回来看，回顾照样打得开。
   *
   * 【还原不出来的题直接跳过，不占位】
   * 内置题的题干在内容包里，M7 补课时题干、题号都可能变。变没了的题在这儿
   * 被跳过 —— 少一行，总比整页崩掉或者显示一条空白强。
   */
  const reviewRows = computed<ReviewRow[]>(() => {
    const d = day.value
    const answers = d?.answers
    // 老批次没有 answers（逐题回顾是后加的）：**返回空数组，不是「全错」**。
    // 这里判错方向的话，用户会看到一页红叉，而他其实一道都没答错
    if (!d || !answers) return []

    // 无 format 戳（或 <2）不回溯。**二义说明**：无戳档有两种来源——v2 老格式
    // （questions 是整批、answers 是游玩序，题/答错位）与「v2 之后、本戳之前」的
    // 一版收工重写（2c44219：已按游玩序成对重写、只是没打戳）。两者形状一致、
    // 事后无法区分，判据一律按**保守**走：错放行会张冠李戴展示（比藏起来坏得多）。
    // 该二义窗口 = 「旧版做过挑战、当天就升级」这一个自然日，打戳格式上线后关闭。
    // 分数与 stoppedEarly 不受这一刀影响：那两个数不依赖题/答配对。
    // （视图层另据 `oldArchive` 给一句提示，文案不归这里管）
    if ((d.format ?? 1) < 2) return []

    const rows: ReviewRow[] = []
    d.questions.forEach((cq, i) => {
      const q = resolve(cq)
      const a = answers[i]
      if (!q || !a) return
      rows.push({ key: cq.key, question: q, ai: cq.ai !== undefined, your: a.your, ok: a.ok })
    })
    return rows
  })

  /** 有没有回顾可看。**没有就不给入口**，而不是给一个点进去空白的按钮 */
  const hasReview = computed(() => reviewRows.value.length > 0)

  /**
   * 当天这批是无戳旧存档吗（无 `format` 或 <2）。
   *
   * 回顾页据此在「没有回顾」之上再补一句说明（提示文案由视图层负责，
   * 这里只给判据）：无戳档的题/答对应关系不可信（v2 错位档与上一版
   * 成对档形状相同、无法区分，一律保守判——见 `reviewRows` 的二义说明），
   * 回顾已降级为空。
   *
   * 【为什么要求「有作答记录」】没有 answers 的老批次（逐题回顾上线前）走的是
   * 另一条降级理由 —— 那是「当时没存」，不是「存得对不上」。两条理由不能串台，
   * 否则会给一个根本没做过回顾的批次贴上「格式太老」的标签。
   */
  const oldArchive = computed(() => {
    const d = day.value
    return d != null && (d.answers?.length ?? 0) > 0 && (d.format ?? 1) < 2
  })

  /**
   * 存 day 时**必须 markRaw**。
   *
   * `day` 是个大对象，而且**只会整体替换、从不原地改字段** —— 它不需要深度响应式。
   * 不加 markRaw 的后果不是性能问题，是**真的会炸**：
   * `ref()` 会把嵌套的 `questions[].ai` 包成响应式代理，而
   * `ipcRenderer.invoke` 用结构化克隆，**克隆不了代理**，直接抛
   * `An object could not be cloned` —— 表现是「做完了挑战，分数没记上，一句报错都没有」。
   * 同一个坑在 settings store 里已经踩过一次了（见 stores/settings.ts 的 save()）。
   */
  function setDay(d: ChallengeDay | null) {
    day.value = d === null ? null : markRaw(d)
  }

  // ---------------------------------------------------------------- 读

  async function load() {
    loading.value = true
    try {
      if (!settings.loaded) await settings.load()
      const r = await window.miai.getChallenge(dateKey.value)
      setDay(r.day)
      lastSeen.value = r.lastSeen
      // 「已收工但标记没写上」的批次补交（P10.6 ⑤）—— 含"收工→入队落盘之间
      // 进程猝死"与"跨天后才重新打开"两种窗口。fire-and-forget：读档不等网络。
      // format < 2 的老档**不补**：它的 questions/answers 配对不可信（见
      // reviewRows 的二义说明），拿错位的数据补交 = 往服务器写一份假成绩 ——
      // 宁可这一天不上榜，不虚报（同收工记账的"少算不虚报"口径）。
      for (const d of r.unsent) {
        if ((d.format ?? 1) < 2) continue
        void submitSettle(d)
      }
    } catch {
      // 读失败就当今天还没抽过（会重新抽一批）。不改本地已有的 day ——
      // 万一这次只是临时读失败，把已经抽好的题丢掉更亏
    } finally {
      loading.value = false
    }
  }

  /**
   * 换天搬家（高-5）：清掉昨天的一次性状态、重读今天的存档。
   * 触发时机与"为什么答题中要等"全在上面 pendingRollover 那段。
   *
   * 【早退的那一支：手上这批就是"今天"的】跨天那刻正在抽题、抽完已用新日键
   * 落盘 —— day 已经是对的，什么都不用清（清掉反而把刚做完的一局从界面上
   * 抹掉，且 deselectedLangs 是今天开抽时的勾选，也该留着）。
   *
   * `fellBack` / `canceled` 是"上一批抽题"的一次性提示语（AI 没成退回本地 /
   * 用户按了不出了），跨天后用户看到的是一张新页面，留着昨天的提示只会让人
   * 以为刚才那次操作出了什么事。`deselectedLangs` 是**当日**的语言勾选
   * （注释里"明天打开时不该被昨天的勾法悄悄收窄"）—— 常驻进程没有"明天打开"
   * 这个动作，所以在这里手动清；`load()` 会把 lastSeen 换成磁盘上的最新一份。
   */
  async function reloadForNewDay(): Promise<void> {
    if (day.value !== null && day.value.dateKey === dateKey.value) return
    fellBack.value = false
    canceled.value = false
    setDay(null)
    deselectedLangs.value = []
    await load()
  }

  // ---------------------------------------------------------------- 抽题

  /** 把候选池按课归拢成 AI 的输入。题干当风格样例，也是防重复清单 */
  function topicsFromPool(items: PoolItem[]): AiTopicInput[] {
    const byLesson = new Map<string, AiTopicInput>()
    for (const it of items) {
      let t = byLesson.get(it.lessonId)
      if (!t) {
        t = {
          lessonId: it.lessonId,
          title: it.lessonTitle,
          tags: content.lessonOf(it.lessonId)?.tags ?? [],
          stems: []
        }
        byLesson.set(it.lessonId, t)
      }
      t.stems.push(it.question.stem)
    }
    return [...byLesson.values()]
  }

  function localToChallenge(items: PoolItem[]): ChallengeQuestion[] {
    return items.map((it) => ({
      key: questionKey(it.lessonId, it.question.id),
      lessonId: it.lessonId,
      qid: it.question.id
      // 内置题**不存本体**：内容包里就有，存了就是两份真源。理由见 types.ts
    }))
  }

  /**
   * 抽一批题。AI 优先，任何失败都退回本地题库。
   *
   * 【为什么失败要静默退回，而不是弹错误】
   * 断网、Key 过期、余额不足都是**使用 AI 的日常**，不是故障
   * （docs/03 A7 明令不得弹失败弹窗、不得阻塞）。而且挑战**没有 AI 也能玩** ——
   * 本地题库抽出来的题一样能练，弹个错误框等于把一件还能继续的事打断了。
   *
   * 【唯一的例外：用户主动取消】
   * 那不是失败，是「不出了」。这时候**不能退回本地** —— 用户按的就是「停」，
   * 我们再抽一批塞给他，等于没听他说话。
   */
  async function draw(): Promise<GenOutcome> {
    const p = selectedPool.value
    if (p.length === 0) return { kind: 'empty' }

    // v3：一次把勾选范围内的题**全抽出来**（新鲜度只决定顺序，见 pickChallenge）；
    // 但 2026-10-21 题库扩到 6025 道，超过了服务端 CHALLENGE_RUN_MAX（5000），
    // 所以本地段封顶 CHALLENGE_LOCAL_CAP（= 5000 - AI 段 20）。多出来的题不是丢了，
    // 只是不在同一局里出现；换天/换勾选会重新排序。
    const local = pickChallenge(p, lastSeen.value, Math.min(p.length, CHALLENGE_LOCAL_CAP))

    // 关着「AI 动态出题」或没配 Key 就直接抽本地的，**不算「退回」** ——
    // 压根没试过 AI，没什么好退回的。开关默认关：老用户升级后行为逐字节不变。
    if (!settings.config.ai.dynamicEnabled || !settings.config.ai.hasKey) {
      return { kind: 'ok', questions: localToChallenge(local), source: 'local' }
    }

    let res
    try {
      res = await window.miai.aiGenerateQuestions({
        // ⚠️ `terms` 与 `topics` **必须 toIpc**：它们都是「从 store 上读出来的」，
        // 拿到的是 reactive 代理，直接 invoke 会抛 `An object could not be cloned.`。
        // 而那个抛错会被下面的 catch 接住、翻译成「AI 大肥鱼没答上来」——
        // 界面看不出任何异常，只有 AI 永远不工作。详见 lib/ipc-safe.ts
        topics: toIpc(topicsFromPool(p)),
        // AI 段有**自己的**题数（20）：它不跟题库规模走，见 CHALLENGE_AI_BLOCK
        count: CHALLENGE_AI_BLOCK,
        terms: toIpc(content.bundle.glossary.terms),
        dateKey: dateKey.value
      })
    } catch (e) {
      // 抛错只有一种可能：我们自己的入参形状不对（见 preload 注释）。
      // 那更不该把用户卡住，退回本地照常玩。
      //
      // 【为什么这里必须留一行 console.error】
      // 「AI 没答上来」和「我们传了个克隆不了的载荷」在界面上长得**一模一样** ——
      // 都是那行「AI 大肥鱼没答上来」。用户看到它只会以为自己网络不好，
      // 而真正坏掉的是我们自己的数据，跑一百遍也查不出来（这个坑已经踩过一次）。
      // 和 runner.ts 吞掉 run 失败时的做法一致：用户路径不受影响，开发时看得见。
      console.error('[challenge] ai draw failed:', e)
      fellBack.value = true
      return { kind: 'ok', questions: localToChallenge(local), source: 'local' }
    }

    if (!res.ok && res.reason === 'canceled') return { kind: 'canceled' }

    // `items` 必须是数组（见下方 refill 同款判据）：主进程回话形状不对时，
    // `.length`/`.slice` 抛出去会被 catch 误译成「AI 大肥鱼没答上来」
    if (res.ok && res.data && Array.isArray(res.data.items) && res.data.items.length > 0) {
      // 再切一刀 CHALLENGE_AI_BLOCK：解析层理论上不会超，但这一刀保证
      // 「本地 4980 + AI 20」恒等于协议上界，不靠上游的保证。
      const aiQuestions: ChallengeQuestion[] = res.data.items.slice(0, CHALLENGE_AI_BLOCK).map((it) => ({
        key: questionKey(it.lessonId, it.question.id),
        lessonId: it.lessonId,
        qid: it.question.id,
        // AI 题**必须存本体**：它不在任何一课里，不存就永远找不回来
        ai: it.question
      }))
      // v3：AI 段拼在**批次最前**（20 道新题开局），后面接本地整池。
      // v2 是「AI 成功 = 整批只有 AI 题」；取消上限后整池必须都进来，
      // AI 段改当开场加餐 —— 开局面手感与 v2 一致，池子也一道不漏。
      // 段序（AI 在前）是 launch() 分段洗牌的依据，别在这儿乱序。
      return { kind: 'ok', source: 'ai', questions: [...aiQuestions, ...localToChallenge(local)] }
    }

    fellBack.value = true
    return { kind: 'ok', questions: localToChallenge(local), source: 'local' }
  }

  /**
   * 点「开始挑战」：今天没抽过就抽一批，抽完（或本来就有）就开答题。
   *
   * 【为什么抽完立刻开答题，不给一个「题目好了，点这里开始」的中间态】
   * 那个中间态对用户没有任何信息量（题目好不好他得做了才知道），
   * 却多一次点击、多一个可能卡住的界面。抽完就进去，最省事。
   *
   * 【为什么这里还有一道 `unlocked` 闸，而不是信界面藏了按钮】
   * 见 `unlocked` 的注释：藏按钮是装饰，规则得在 store 里再挡一次。
   * 静默返回（不弹错）与「已经开着答题遮罩」那条同一口径 —— 界面本来
   * 就不会在锁定时给出「开始」这种按钮，能走到这里说明入口已经过期了。
   */
  async function start(): Promise<void> {
    if (quiz.session) return
    if (!unlocked.value) return

    let d = day.value
    if (!d || d.questions.length === 0) {
      generating.value = true
      fellBack.value = false
      canceled.value = false
      try {
        const out = await draw()
        if (out.kind === 'canceled') {
          canceled.value = true
          return
        }
        if (out.kind !== 'ok') return
        // 本局勾选的语言（按池子顺序，不含 common —— 它恒含、不参与勾选）。
        // 取的是**抽题那一刻**的勾选：勾选只决定今天抽哪一池，不做中途换卷；
        // 结算上行要靠它，所以必须落盘（见 types.ts 的 pickedLangs 注释）。
        // 空数组不写字段：把有题的语言全点掉、只剩 common 题也能开赛，此时
        // 「一门语言都没勾」——服务端契约里显式空数组是 400（present 必须非空），
        // 缺省则由服务端从题批派生（全 common 派生出空，语义一致）。[] 与缺省
        // 在这里等价，选后者是为了上行永远合法。
        const picked = poolLangs.value.filter((l) => isLangOn(l))
        d = {
          dateKey: dateKey.value,
          source: out.source,
          questions: out.questions,
          createdAt: new Date().toISOString(),
          finishedAt: null,
          score: null,
          ...(picked.length > 0 ? { pickedLangs: picked } : {}),
          // 成对重写格式的标记（见 types.ts 的 format 注释）
          format: 2
        }
        setDay(d)
        // 抽完先落盘**再**开答题：中途退出（关窗口、断电）时，
        // 这一批已经存住了，下次进来还是同一批题 —— 也就不用重新烧一次 API
        await saveDay(d)
      } catch {
        return
      } finally {
        generating.value = false
      }
    }
    launch(d)
  }

  /** 取消正在飞的 AI 抽题。**真的掐断请求**，不是假装不看了（不然钱照烧） */
  async function cancel() {
    await window.miai.aiCancel()
  }

  /** 把存档里的题还原成能判分的 `Question`。找不回来返回 null（那道题就跳过） */
  function resolve(cq: ChallengeQuestion): Question | null {
    if (cq.ai) return cq.ai
    const lesson = content.lessonOf(cq.lessonId)
    return lesson?.questions.find((q) => q.id === cq.qid) ?? null
  }

  function launch(d: ChallengeDay) {
    const pairs = d.questions
      .map((cq) => ({ cq, q: resolve(cq) }))
      .filter((x): x is { cq: ChallengeQuestion; q: Question } => x.q !== null)

    if (pairs.length === 0) {
      // 一道都还原不了（内容包改过、内置题被删）。当成今天没抽过，
      // 让用户重新抽 —— 总比进去一道题都没有强
      setDay(null)
      return
    }
    /*
     * 组卷：洗题目顺序 + 洗每道选择题的选项顺序。
     *
     * 【v3：分段洗 —— AI 段与本地段各洗各的，段间顺序不动】
     * 抽题时 AI 段拼在批次最前（draw()）；全段一起洗会把 AI 段打散到几千道
     * 本地题里，开局的「先来几道 AI 新题」手感就没了。分段洗保住段序，
     * 段内照样每天每局都不同 —— v2 防「背位置」的理由一段不落：
     * 内置题是**每次开局都从内容包重新取**的（见上面的 `resolve`），
     * 不洗的话同一天里每次打开软件都是同样的顺序、同样的选项位置。
     *
     * 【题和 key 必须成对交给 buildPaper】
     * 洗完全局顺序之后，`keys[i]` 必须还是 `questions[i]` 的键 ——
     * 分开洗两个数组必然错位，而错位的后果是挑战做完的记账
     * （收工 watcher 里按 key 决定收录还是消除）记到别的题头上，且不报错。
     */
    const aiPairs = pairs.filter((x) => x.cq.ai !== undefined)
    const localPairs = pairs.filter((x) => x.cq.ai === undefined)
    const paper = [
      ...buildPaper(aiPairs.map((x) => ({ question: x.q, key: x.cq.key }))),
      ...buildPaper(localPairs.map((x) => ({ question: x.q, key: x.cq.key })))
    ]
    quiz.startQuiz(
      'challenge',
      CHALLENGE_SESSION_ID,
      paper.map((x) => x.question),
      paper.map((x) => x.key)
    )
  }

  /**
   * 「答对继续」的补题水位：**还剩多少道时就该向 AI 再要一批**。
   *
   * 【为什么是 50】每日挑战没有题数上限，抽出来的本地池是有限的。学员在
   * 这一局里把题做完了（尤其只勾了一门语言、或刚学完几课时池子很小），
   * 界面会走到「最后一题」然后收工 —— 那等于把「答对继续」硬生生截断。
   * 补题必须在**还没走到最后一题之前**开始，否则生成 + 本地验代码的时间
   * 足够让手快的学员把剩下的题点完。50 道 ≈ 给 AI 留出几分钟。
   *
   * 【为什么小池子会立刻补】池子总共不到 50 道时，这个水位在第 0 题就
   * 已经满足 —— 开局先补一批，等于把「无限」提前接上，而不是等弹尽粮绝。
   */
  const REFILL_AHEAD = 50

  /** 正在向 AI 要下一批。防止同一时刻叠两个请求（花两份钱、还可能补重） */
  let refilling = false
  /**
   * 上一次尝试补题的账：**按会话分开记**。
   *
   * 补题失败（断网/超时/解析全丢）后，index 每动一下都会再满足水位条件；
   * 没有这个闸，学员每点一次「下一题」就重发一次 API —— 断网时等于无限重试。
   * 但**也不能一次失败就永久锁死**：那等于「网络刚好抖了一下，这一局就再也
   * 补不上题了」。所以同一个长度下，隔 `REFILL_RETRY_STEPS` 道再试一次
   * （最多在最后 50 道里试 4~5 次）；补成功（题目变长）后计数归零。
   *
   * 【为什么要带 sessionId】这些变量活在 store 里，跨局不归零的话，
   * 下一局（比如隔天再开、或重开同一局）会继承上一局的 `length/index`：
   * 长度碰巧相同 + index 比上次小 → `index - lastIndex` 是负数，永远小于
   * 冷却步数，于是**新的一局一道题都补不上**，而且没有任何报错。
   */
  let refillState = { sessionId: -1, length: -1, index: -1, attempt: 0 }

  /** 同一长度下两次补题尝试之间至少隔几道题（防止每点一下都重发） */
  const REFILL_RETRY_STEPS = 10

  /**
   * 题目快用完时，**静默**向 AI 再要一批，追加到当前这一局。
   *
   * 触发条件（全部满足才发）：
   *   · 当前是每日挑战（不是练习/复习/错题）；
   *   · 用户开了「AI 动态出题」且配了 Key —— 关着就是明确不授权花 Token；
   *   · 剩余题目 ≤ `REFILL_AHEAD`；
   *   · 同一个长度下距上次尝试已走过 `REFILL_RETRY_STEPS` 道。
   *
   * 失败一律静默：断网、超时、没余额都是使用 AI 的日常，不是故障。
   * 补不上就按现有的题量继续，走到最后一题自然收工 —— 不弹错、不卡界面。
   */
  async function refillIfNeeded(): Promise<void> {
    const s = quiz.session
    const d = day.value
    if (!s || !d) return
    if (s.mode !== 'challenge' || s.lessonId !== CHALLENGE_SESSION_ID) return
    if (s.finishedAt) return
    if (refilling) return
    if (!settings.config.ai.dynamicEnabled || !settings.config.ai.hasKey) return
    // 已经顶到单局结算上界：再补也结算不了，不发这一趟 Token。
    if (s.questions.length >= CHALLENGE_RUN_MAX) return
    if (s.questions.length - s.index - 1 > REFILL_AHEAD) return

    // 换了一局 = 上一局的补题账作废，从头记
    if (refillState.sessionId !== s.sessionId) {
      refillState = { sessionId: s.sessionId, length: -1, index: -1, attempt: 0 }
    }
    if (refillState.length === s.questions.length && s.index - refillState.index < REFILL_RETRY_STEPS) return

    const p = selectedPool.value
    if (p.length === 0) return

    const attempt = refillState.attempt
    refillState.length = s.questions.length
    refillState.index = s.index
    refillState.attempt = attempt + 1
    refilling = true
    try {
      /*
       * 题目来源与开局同一套 topics：解析层会拿**完整**题干列表去重，
       * 所以这一批不会和本地池撞题。AI 自己前几批出的题干不在本地池里，
       * 这里按课补进去 —— 不然同一天的两批 AI 题会互相撞脸。
       */
      const topics = topicsFromPool(p)
      const byLesson = new Map(topics.map((t) => [t.lessonId, t]))
      for (const cq of d.questions) {
        if (!cq.ai) continue
        const t = byLesson.get(cq.lessonId)
        if (t) t.stems.push(cq.ai.stem)
      }

      /*
       * 批号进 `dateKey`：它同时决定题号前缀与缓存键。
       *   · 题号：`ai-2026-10-21-r38-1`，同一天多批也不会撞 id；
       *   · 缓存键：prompt 里的日期行跟着变，**不会命中开局那 20 道**。
       * 长度是单调增长的，重启后从存档恢复也不会重复用同一个批号；
       * 同一长度下的重试再加 `-a1/-a2`：失败本身不进缓存（见 ai-cache.ts），
       * 但万一上一趟是「成功返回、题却全被判重丢掉」的边界，这一后缀能保证
       * 重试拿到的是新请求，而不是又被同一份结果挡回来。
       */
      const batchKey = `${d.dateKey}-r${s.questions.length}${attempt > 0 ? `-a${attempt}` : ''}`
      const res = await window.miai.aiGenerateQuestions({
        topics: toIpc(topics),
        count: CHALLENGE_AI_BLOCK,
        terms: toIpc(content.bundle.glossary.terms),
        dateKey: batchKey
      })

      // 这一趟在飞的时候，学员可能已经收工 / 重开了一局 —— 迟到的题一律丢掉
      if (quiz.session !== s || s.finishedAt) return
      /*
       * 也可能**刚答错**：挑战是「答错即停」，这一局已经不会再出下一题了
       * （收工前会停在结果页等用户点按钮，finishedAt 还没落）。
       * 不加这一条，迟到的 20 道会被塞到已经停下的卷子后面 —— 收工记账按
       * `s.questions` 整卷重写，结果页的分母凭空变大、这些没做过的题还会
       * 被记成「没答对」。检查与 append 之间没有 await，不会中途被改。
       */
      if (s.checked[s.index] === true && quiz.verdictAt(s.index) === false) return
      // `items` 不是数组也当"没补上"：主进程回话形状不对时，不能让 `.length`
      // 抛出去把整局挑战带停（catch 能接住，但那是拿异常当控制流）
      if (!res.ok || !res.data || !Array.isArray(res.data.items) || res.data.items.length === 0) return

      // 只补到上界为止：一批 20 道可能把会话顶过 5000，截掉尾巴。
      const room = CHALLENGE_RUN_MAX - s.questions.length
      const fresh = res.data.items.slice(0, room)
      if (fresh.length === 0) return

      const added = fresh.map((it) => ({
        key: questionKey(it.lessonId, it.question.id),
        lessonId: it.lessonId,
        qid: it.question.id,
        ai: it.question
      }))
      // 先追加到会话（界面立刻能继续）；返回 false = 这一局已经不能接题了
      if (!quiz.appendQuestions(
        added.map((x) => x.ai),
        added.map((x) => x.key)
      )) {
        return
      }
      d.questions.push(...added)
      /*
       * 来源徽章改口：这一批**已经混进 AI 题了**，再说「从课本里抽的」就是假话。
       * 同时也把开局的「AI 没答上来」提示撤掉 —— 刚才那次失败已经被这一刻的
       * 成功推翻，继续挂着只会让人以为 AI 现在还是坏的。
       * 这两处都只在**确实追加成功之后**写：`appendQuestions` 返回 false
       * （这一局已经收工）时上面就 return 了，账不许改。
       */
      d.source = 'ai'
      fellBack.value = false
      // 补成功 = 长度变了，下一个水位的尝试从「第一次」重新数
      refillState.attempt = 0
      // 存档跟上：中途关软件再进来，补过的题也还在
      await saveDay(d)
    } catch (e) {
      // 与开局抽题同口径：用户路径不受影响，开发时看得见
      console.error('[challenge] refill failed:', e)
    } finally {
      refilling = false
    }
  }

  /*
   * 水位只随「当前第几题」和「换了一局」变化，所以盯 sessionId + index 就够。
   * 补题本身会改 `questions.length`，但不该因此再触发一次 —— `refillState`
   * 已经按「同一长度 + 冷却步数」挡住了重复请求，且这里刻意不把 length 放进 watch 源。
   */
  watch(
    () => (quiz.session ? `${quiz.session.sessionId}:${quiz.session.index}` : ''),
    () => {
      void refillIfNeeded()
    }
  )

  // ---------------------------------------------------------------- 记账

  async function saveDay(d: ChallengeDay) {
    try {
      await window.miai.saveChallenge(d)
    } catch (err) {
      /*
       * 存不上不该打断答题 —— 界面上的这一局照常能做完，只是下次进来要重抽。
       * 但**不许静默**（极端[3]，2026-10-16）：空 catch 的代价是「答完一整局、
       * 零提示、下次进来从头再来，查无实据」。出两路：日志留痕 + 吐司出声。
       * 日志消息用 ASCII（文案闸门扫渲染层所有中文字面量；开发日志全仓库
       * 都是英文前缀的惯例，见 QuizCodeRun / WallpaperLayer 那一排）。
       */
      console.error('[challenge] save failed:', err)
      toast(TOAST.CHALLENGE_SAVE_FAILED, 'error')
    }
  }

  /** 正在入队途中的收工单（dateKey）—— load 连击时同一天不叠两份 */
  const submittingSettle = new Set<string>()

  /**
   * 把一天的收工单交给主进程入队，**主进程确认后才写「已提交」标记**（P10.6 ⑤）。
   *
   * 【确认的两种回话都是"交付了"】invoke 回 `{queued}`：
   *   · queued:true —— 这一次排上了（已写进 pending-ops.json）；
   *   · queued:false —— 同一天已在队（主进程的第二道闸），同样是"这一天有着落"。
   * invoke 拒绝 / 回话形状不对 = **没交付，标记不许写** —— 标记在 = 不再补交，
   * 确认前写上就等于把这一天扔了（同"不许默认回退为成功"）。
   *
   * 【它兜的是什么】收工 watcher 到"入队落盘"之间进程猝死/强退，这一天的
   * 上行会丢（本地分数完好、服务端少一天）。补交通道（load 里扫 unsent）
   * 拿着没有标记的收工单再走一遍这里；重复入队由主进程按 dateKey 去重、
   * 服务端对已结算日回 409（uplink 按已处置出队）—— 重交不会写坏账。
   *
   * 【载荷为什么在这里建】题目/难度/语言只有内容包在手边时才算得出，
   * 主进程只当仓库保管员（同积分台账口径）；构建规则全在
   * lib/challenge-settle.ts（纯函数，单测钉边界）。
   */
  async function submitSettle(d: ChallengeDay): Promise<void> {
    // 界面手里的今天那批已经打上标记 = 这一天交付过了（同一份数据在
    // watcher 与补交两条路各拿一份对象，标了就不再走第二遍）
    const cur = day.value
    if (cur && cur.dateKey === d.dateKey && cur.submittedAt) return
    if (submittingSettle.has(d.dateKey)) return

    const payload = buildSettlePayload(d, {
      resolve,
      lessonOf: (id) => {
        const lesson = content.lessonOf(id)
        return lesson ? { lang: lesson.lang, stage: lesson.stage } : null
      }
    })
    // 建不出载荷（其实没收工 / 一道有效题都还原不回来）：跳过、不标记 ——
    // 下次读档还会再试一次（纯本地计算，不发包，代价可忽略）
    if (!payload) return

    submittingSettle.add(d.dateKey)
    try {
      const r = await window.miai.cloud.settleChallenge(payload)
      if (typeof r?.queued !== 'boolean') return // 形状不对 = 接线 bug，不当成功
      markSubmitted(d)
    } catch (err) {
      // 通道拒绝（主进程忙/窗口在关）—— 出声，留白标记，补交下次再试
      console.warn('[miai] challenge settle failed', err)
    } finally {
      submittingSettle.delete(d.dateKey)
    }
  }

  /**
   * 写「已提交」标记。今天那批顺手换进界面（day.value 同一天才换），
   * 旧批次（跨天后补交的）只写回它的存档条目 —— saveChallenge 是逐日
   * upsert（键就是 day.dateKey），写旧日期不会碰到今天那条。
   */
  function markSubmitted(d: ChallengeDay): void {
    const marked: ChallengeDay = { ...d, submittedAt: new Date().toISOString() }
    if (day.value?.dateKey === marked.dateKey) setDay(marked)
    void saveDay(marked)
  }

  /**
   * 一道题值多少分（本局台账口径）。
   *
   * 【为什么难度与语言都从题自己身上推导，不另存一份】
   * 一个公式三个用户：服务端结算、这里（离线台账）、排行榜说明面板 ——
   * 三方共用 `cloud/protocol.ts` 的 `weightedPoints`。难度走
   * `resolveDifficulty`（显式字段优先，规则表和总览/筛选器共用一份），
   * 语言取宿主课的 lang（AI 题也带着它抽进来的那个 lessonId）。
   * 在这儿"顺手存一个 lang 字段"就多了一份迟早漂移的真源。
   * v3 起语言权重全 100，lang 不再影响取值（结果 = 纯难度分）；参数保留 ——
   * 删它要动三处调用点、换不来任何行为，留着等权重政策再变时有地方可改。
   *
   * 【AI 题为什么也查得到】AI 出题时喂给它的 topics 就来自学过的课，
   * 它回填的 lessonId 是那些课之一 —— 和内置题走同一条路。
   * 万一某天回了个查不到的 lessonId：按 common/阶段 0 计（下限），宁少不虚。
   */
  function pointsOf(cq: ChallengeQuestion, q: Question): number {
    const lesson = content.lessonOf(cq.lessonId)
    const lang = lesson?.lang ?? 'common'
    const stage: Stage = lesson?.stage ?? 0
    return weightedPoints(resolveDifficulty(q, stage), lang)
  }

  /**
   * 答错即停：**一判出错了就把本局裁到这一题为止**（2026-10-10 主人令）。
   *
   * 【判据为什么是「checked 且 verdict 为假」这一个签名】它同时覆盖两类题型：
   * 选择/填空提交即定；真跑题型交过之后还能改再交 —— 只要落点是错，就得停。
   * （真跑题型的**锁**在界面上单独做：`locked` 通道，不然重交能翻盘，
   *   这个 watcher 只保证"已经停下来"这个事实。）
   *
   * 【签名为什么要拼成字符串】和下面收工记账的 watcher 同一个坑：
   * 盯 `s.checked` 数组本身拿到的是同一个引用，watcher 永远不触发。
   * 拼上 index 是因为换题（下一题）后判据重新算 —— 新题没判过 → `''`，
   * 签名变了但回调什么都不做，正好。
   *
   * 【`flush: 'sync'`】提交在同一 tick 里改 `checked`，裁剪必须当场落，
   * 否则界面先按旧长度渲染一帧（进度行还写着裁前的旧题号）再跳回 ——
   * 与收工记账同一个理由，见下面。
   */
  watch(
    () => {
      const s = quiz.session
      if (!s || s.mode !== 'challenge' || s.finishedAt) return ''
      if (!s.checked[s.index]) return ''
      return `${s.index}:${quiz.verdictAt(s.index) ? 'ok' : 'bad'}`
    },
    (sig) => {
      if (sig.endsWith(':bad')) quiz.truncateAfterCurrent()
    },
    { flush: 'sync' }
  )

  /**
   * 做完就记账。
   *
   * 【盯的是 `finishedAt` 这个字段，不是 `quiz.session` 本身 —— 这是修一个真 bug】
   * `quiz.finish()` 是**原地**改字段（`s.finishedAt = …`），**没有换对象**。
   * 而 `session` 是 `ref`，`session.value` 拿到的是同一个代理对象 ——
   * 于是 `watch(() => quiz.session, …)` 的取值函数**每次都返回同一个引用**，
   * watcher 永远不触发。表现是「挑战做完了，回到挑战页还是『继续今天的挑战』」，
   * 分数一次都没落盘，**一句报错都没有**。
   *
   * 改成返回一个字符串快照：`''` = 还没做完，非空 = 完成时刻。
   * 它每次求值都是一个新字符串，`finish()` 一改 `finishedAt` 就必然变。
   *
   * 【为什么 `flush: 'sync'` 是必须的，不是优化】
   * `finish()`（填 `finishedAt`）和 `close()`（把 session 置 null）
   * **有可能落在同一个 tick 里**（结果页的「看看大肥鱼」直接调 close）。
   * 默认的 watcher 是异步批处理的，它有机会**在两次变更之间一次都没跑**，
   * 直接看到「session 已经是 null」—— 表现同样是「分数没记上」，而且是**偶发**的。
   * 同步 flush 保证 `finishedAt` 一填上就当场记账。
   *
   * 【积分台账为什么在这里算】`points` 是逐题难度分的和（公式唯一一份在
   * cloud/protocol.ts，服务端结算与这里等价；v3 起语言权重全 100）。
   * 题的难度只有内容包在手边时才算得出（渲染进程），主进程只当仓库保管员 ——
   * 所以台账跟着收工记账一起落盘，服务端将来结算时逐题复核（取低计分）。
   * `pointsMax` 记的是**重写后存档里这些题**（= 本局实际做过的题）的满分和，
   * 给结算卡显示"满 X 分"用 —— 不是整池几千道的理论满分，那会让
   * 「答对 1 题拿 +100」看起来像只拿了零头。
   */
  watch(
    () => {
      const s = quiz.session
      return s && s.mode === 'challenge' && s.finishedAt ? s.finishedAt : ''
    },
    (finishedAt) => {
      if (!finishedAt) return
      const s = quiz.session
      const d = day.value
      if (!s || !d || d.finishedAt) return // 没抽过题 / 今天已经记过账了
      // P3 ④ 好感度：挑战完成 +3（日上限 1）。放在收工记账这一处 ——
      // 上面那个守门员保证「今天第一次收工」才走到这里，重复进入不重报；
      // 超限由主进程静默丢弃（daily cap 在 brain），这里不预判。
      reportPetEvent('challenge')

      // 台账 + 存档重写：**同一遍遍历，按游玩序成对对齐**。
      //
      // 【v3 顺手修掉一个 v2 的静默 bug】launch() 组卷时洗过题目顺序：
      // `s.questions` 是**游玩序**，而存档里 `d.questions` 是抽题时的
      // **存档序**。v2 把游玩序的 answers 直接配存档序的 questions 落盘，
      // 回顾页又按同一下标配对 —— 只要洗牌不是恒等就张冠李戴
      // （答对的题配到别的作答上），而且一句报错都没有。
      // 现在收工时把两者**放在同一遍循环里**按游玩序成对重写：
      // 写出来的 questions 和 answers 天然一一对应，不存在配错的可能。
      //
      // 【顺带的存档瘦身】答错即停之后没做的题不落盘（只留做过的前缀）——
      // v3 一次抽整池几千道，原样存着既没意义也白占空间；
      // 「今天抽过哪些题」由开抽时那次 saveDay 负责记，收工重写不影响防重复。
      //
      // 对不上的题（内容包改过）跳过、不计分 —— 宁可少算，不虚报。
      const byKey = new Map(d.questions.map((cq) => [cq.key, cq]))
      let correct = 0
      let points = 0
      let pointsMax = 0
      const questions: ChallengeQuestion[] = []
      const answers: ChallengeAnswer[] = []
      s.questions.forEach((q, i) => {
        const cq = byKey.get(s.keys[i])
        if (!cq) return
        const w = pointsOf(cq, q)
        pointsMax += w
        // 答案本身是原始值，但题目是响应式代理 —— 判分借用练习 store 那个入口，
        // 绝不在挑战这边另写一套判分（两套一旦漂移，同一道题会两处结论不同）。
        //
        // ⚠️ 走 `quiz.verdictAt()` 而不是 `gradeQuestion()`：真跑题型
        // （codefix / codewrite）的结论**不在同步判分函数里** ——
        // 它们是跑出来的，存在会话的 runResults 上。直接调 gradeQuestion
        // 在类型上根本过不去（参数类型排除了它们），这就是那个收窄在起作用。
        const ok = s.checked[i] ? quiz.verdictAt(i) : false
        if (ok) {
          correct++
          points += w
        }
        questions.push(cq)

        // 选择题的作答是**会话卷下标**（选项被洗过；排列不落盘、事后无法反解），
        // 而存档与回顾页都按**原题**渲染 —— 用选项文本反查换回原题下标再落盘。
        // 不换的话回顾页「你的选择」标签会打在别的选项上（洗牌下约 3/4 概率指错，
        // 而 v3 答错即停，那道错题恰恰是本局唯一要被回顾的题）。
        let your = s.answers[i]
        if (q.type === 'choice' && typeof your === 'number') {
          const orig = resolve(cq)
          const at = orig && orig.type === 'choice' ? orig.options.indexOf(q.options[your]) : -1
          // 反查不到（内容包改过、选项文本对不上）就原样存 —— 不比乱指更坏
          if (at >= 0) your = at
        }
        answers.push({ your, ok })
      })

      const next: ChallengeDay = {
        ...d,
        finishedAt,
        // 收工重写的产物一定是**成对格式**：下面同一遍循环把 questions 与
        // answers 按下标成对重建 —— 哪怕 d 是 v2 老格式，重写完也就对齐了。
        // pickedLangs 不用在这里写：`...d` 展开自动保留，重写不丢它
        //（丢了的话结算上行就少了「勾了哪几门」这个契约字段）
        format: 2,
        // correct 用**本卷重数**而不是 quiz.correctCount：收工重写会跳过
        // 「内容包里已找不到」的题（见上），而 correctCount 仍含被跳过的题 ——
        // 直接引用会出现「答对 3 / 2 题」（分子大于分母）并把 stoppedEarly 抹平。
        // 没跳题时两者恒等，这里只是把口径钉在「留下来的卷面」上。
        score: { correct, total: questions.length, points, pointsMax },
        // 作答也一起存 —— 回顾页要的不是分数，是「我当时写的是什么、它为什么错」。
        // 只存分数的话，这页就只能显示一句「你答错了」，那正是用户已经知道的事。
        // （v3 起与 questions 同长、同序、一一对应，见上面的重写说明。）
        questions,
        answers
      }
      setDay(next)
      void saveDay(next)

      /*
       * 结算上行（P10.x）：把这一天的成绩交给主进程**入队** —— 断网/未登录
       * 时排进 `.sync/pending-ops.json`，下次触达服务端再发；invoke 只回
       * "排上了没有"，界面不等网络结果（同 pet-bridge 的哲学）。
       *
       * 【为什么载荷要在渲染层建】题目/难度/语言只有内容包在手边时才算得出，
       * 主进程只当仓库保管员（同积分台账的口径，见 pointsOf 注释）。构建
       * 规则全在 lib/challenge-settle.ts（纯函数，单测钉边界）。
       *
       * 【P10.6 ⑤：崩溃窗口已关】原来从"收工"到"入队落盘"之间进程猝死
       * 会丢这一天的上行（本地分数完好，服务端少一天）。现在确认入队后写
       * 「已提交」标记，挑战页读档时把没标记的收工单补交 —— 机制全在
       * submitSettle / markSubmitted / load 的补交循环，这里只管发起。
       */
      void submitSettle(next)
    },
    { flush: 'sync' }
  )

  /**
   * 挑战页重新进来时调一次（从别处返回也要看到最新状态）。
   *
   * 【P10.6 ⑤：不再被 progress 闸吞掉】旧版 `if (!progress.loaded) return` ——
   * 深链冷启动时进度还没读到，这次调用被**静默丢弃**，而没有任何地方会重试：
   * day 永远是 null，等 progress 就绪后页面显示「可以开始」，按下去就会把
   * 今天已收工的存档**覆盖重抽**。load() 读档本就不依赖 progress（只等
   * settings），失败也有自己的降级 —— 直接放行，闸门只会制造这个静默坏状态。
   */
  async function refresh(): Promise<void> {
    await load()
  }

  return {
    day,
    loading,
    generating,
    fellBack,
    canceled,
    ready,
    dateKey,
    hasPool,
    unlocked,
    langProgress,
    poolLangs,
    isLangOn,
    toggleLang,
    selectedEmpty,
    finishedToday,
    scoreToday,
    stoppedEarly,
    reviewRows,
    hasReview,
    oldArchive,
    pool,
    load,
    refresh,
    start,
    cancel,
    resolve
  }
})
