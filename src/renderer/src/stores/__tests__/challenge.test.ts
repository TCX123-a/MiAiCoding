/**
 * 每日挑战 store（stores/challenge.ts）
 *
 * 【这个文件在守什么 —— 三条都是真发生过的 bug / 真定过的规矩，且都不报错】
 *
 *   1. **抽题载荷过不了 IPC**。`content.bundle.glossary.terms` 从 store 上读出来
 *      是响应式代理，`ipcRenderer.invoke` 的结构化克隆克隆不了它，当场抛
 *      `An object could not be cloned.` —— 而那个抛错被 catch 接住、翻译成
 *      「AI 大肥鱼没答上来」，界面一切正常，**只有 AI 永远不工作**。
 *      所以下面的假 `aiGenerateQuestions` **故意用 structuredClone**，
 *      和真实 IPC 用同一个算法（同 settings.test.ts 的做法）。
 *
 *   2. **做完不记账**。`quiz.finish()` 是原地改 `session.finishedAt`，对象身份没变；
 *      而 watcher 原来盯的是 `quiz.session` 本身 → 取值函数每次返回同一个引用 →
 *      **永远不触发**。表现是「挑战做完了，回到挑战页还是『继续今天的挑战』」。
 *
 *   3. **2026-10-10 主人令的规矩**（改版当天补的机器守卫）：
 *      · **答对继续、答错即停** —— 答错那一刻本局裁到当题为止（`truncateAfterCurrent`），
 *        积分台账（points/pointsMax）都跟着这一刀走；
 *      · **解锁闸** —— 任意一门语言学完才能玩。两道闸（界面 + store）里
 *        这里守 store 那道：锁着时 `start()` 必须真的不做事。
 *
 *   4. **2026-10-10 晚 v3（同日第二次改版）**：
 *      · **取消单日题数上限** —— 一次抽**整个已学题库**，AI 段 20 道拼在
 *        批次最前（夹具里 921 = 20 + 901 是常态量级，不再是 20）；
 *      · **语言勾选** —— 开始前可点掉今天不想考的语言（common 恒含、不参与勾选）；
 *      · **收工成对重写（错位修复）** —— v2 把游玩序 answers 配存档序 questions
 *        落盘，回顾页张冠李戴且不报错；v3 收工时同一遍遍历按游玩序
 *        成对重写 questions+answers 为做过的前缀，下标天然对齐。
 *
 * 这些都是「界面上看不出异常」的那一类，只能靠机器守着。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { isReactive, nextTick } from 'vue'
import { refreshToday } from '../../lib/day-clock'
import { toasts } from '../../components/base/toast'
import { TOAST } from '../../lib/copy'
import { useChallengeStore } from '../challenge'
import { useContentStore } from '../content'
import { useProgressStore } from '../progress'
import { useQuizStore } from '../quiz'
import { todayKey } from '../../../../shared/dates'
import { correctAnswerOf, wrongAnswerOf, runOk, WRONG_ANSWER } from './answer-fixture'
import { isRunGraded } from '../../../../shared/run-grading'
import { resolveDifficulty } from '../../../../shared/difficulty'
import { CHALLENGE_RUN_MAX, weightedPoints } from '../../../../shared/cloud/protocol'
import { CHALLENGE_AI_BLOCK, CHALLENGE_LOCAL_CAP } from '../../../../shared/challenge'
import { isAiKey, parseQuestionKey } from '../../../../shared/question-key'
import type {
  AiFailReason,
  AiGenerateInput,
  ChallengeDay,
  ChallengeToday,
  ContentBundle,
  Question,
  UserProfile
} from '../../../../shared/types'
import type { DocWriteResult, StampedDoc } from '../../../../shared/doc-write'
import type { ChallengeSettlePayload } from '../../../../shared/cloud/dto'
import { CURRENT_PROFILE_VERSION } from '../../../../shared/types'
import type { AiParseResult } from '../../../../shared/ai-question'
// 直接从构建产物读课号表（与 content store 同一份 JSON）：
// 夹具需要一个「学完就解锁」的真实课号集合，但**不能在装假 window 之前建 store**
// （progress store 一建立就挂 beforeunload，node 环境没有 window 会当场炸）。
import bundleJson from '../../generated/content-bundle.json'

const bundle = bundleJson as unknown as ContentBundle

/** 内容包里 C 的全部课号（48 节）。学完它 = 解锁挑战的最小前提 */
function cLessonIds(): string[] {
  return bundle.lessons.filter((l) => l.lang === 'c').map((l) => l.id)
}

/** 内容包里 Java 的全部课号（55 节）。给「多语言勾选」的用例当第二门语言 */
function javaLessonIds(): string[] {
  return bundle.lessons.filter((l) => l.lang === 'java').map((l) => l.id)
}

/**
 * AI 夹具的宿主课：真实存在、真实属于 C 的一课。
 * 计分口径随之确定：fill 默认 easy；**v3 起语言权重全 100** → 每道 100 分
 * （v2 时代这里乘过 C 的 110% = 110 分/道，语言系数取消后不再乘）。
 */
const C_LESSON = 'c-stage1-01'

/**
 * 夹具里「学完 C」抽出来的本地整池：C 全部课的题（含后并入的挑战题库 items，
 * 见 content-build 把 bank 并进 Lesson.questions 的口径）。
 * 在测试侧独立算一遍，给「整池一道不漏」和「积分精确和」当期望值。
 */
const C_POOL = bundle.lessons
  .filter((l) => l.lang === 'c')
  .flatMap((l) => l.questions.map((q) => ({ lessonId: l.id, stage: l.stage, lang: l.lang, q })))

/** 本地整池的全局 key 集合（`lessonId:qid`，与 shared/question-key.ts 同口径） */
const C_POOL_KEYS = C_POOL.map((x) => `${x.lessonId}:${x.q.id}`).sort()

/**
 * 测试侧独立算一遍「一道题值多少分」（v3 起 = 纯难度分，语言不参与）。
 *
 * 【为什么要在测试里重算】v3 收工的积分是**按题累加**的，而题序每天乱洗 ——
 * 想钉「全对 921 道的积分」这个精确值，就只能把每道题的值当场算出来再求和。
 * 这里走公开的 `resolveDifficulty` + `weightedPoints`（**公式本身**的正确性由
 * cloud-protocol.test.ts 的数值表钉着）；本函数验的是 store 的**记账接线**：
 * 漏计、重计、把答错的也算进 points，都会让这个和对不上。
 * 拆 key 走 `parseQuestionKey`（按第一个冒号切，与全项目同一份实现）。
 */
function pointsOfKey(key: string, q: Question): number {
  const lesson = bundle.lessons.find((l) => l.id === parseQuestionKey(key).lessonId)
  return weightedPoints(resolveDifficulty(q, lesson?.stage ?? 0), lesson?.lang ?? 'common')
}

/** 本地整池的分数和（全对时本地段的期望积分） */
function cPoolPoints(): number {
  let sum = 0
  for (const x of C_POOL) {
    sum += weightedPoints(resolveDifficulty(x.q, x.stage), x.lang)
  }
  return sum
}

/**
 * 2026-10-10 改版前用 `common-01` 当默认 learned —— 通用知识**不算一门语言**，
 * 解锁闸上线后它还留在夹具里的话，所有走 `start()` 的用例都会静默变成
 * 「start 什么都没做」（池子还在、断言却全绿），那比红了还坏。
 */
const LESSON = 'common-01'

/** 一份假档案。`learned` 缺省 = 学完 C（解锁挑战）；传空数组就是「全新安装」 */
function fakeProfile(learned: string[] = cLessonIds()) {
  return {
    // 版本号和 rewards 都照主进程真实会发回来的样子写：fixture 比现实少一块，
    // 就会把「某段代码读了 rewards 崩掉」这类问题挡在测试之外（同 progress.test.ts 的规矩）。
    // checkin（P3 ①）同理：v3 起主进程发回来的档案必有这一节，少写它
    // 就是在替读 `profile.checkin` 的代码把错挡住了
    version: CURRENT_PROFILE_VERSION,
    learned,
    favorites: [],
    history: [],
    stats: { learnedCount: learned.length, practicedCount: 0, streakDays: 0 },
    rewards: { gallery: [], perfectPasses: 0, lastImageDay: null },
    checkin: { lastDate: null, streakDays: 0, totalDays: 0, days: [] },
    // v4（P10.1）：同步合并的时间戳与墓碑区 —— 主进程发回来的档案必有这几节，
    // 夹具少一块就会把「某段代码读它们崩掉」挡在测试之外（同 rewards/checkin 的规矩）。
    // 挑战自己的用例不读它们，空表即可（语义不变）
    learnedAt: {},
    favoriteAt: {},
    tombstones: { learned: {}, lessonFavorites: {} }
  }
}

function publicConfig(hasKey: boolean, dynamicEnabled = true) {
  return {
    version: 1,
    reviewEnabled: true,
    runTimeoutSec: 10,
    envCache: {},
    ai: { hasKey, dynamicEnabled, baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' }
  }
}

/** AI 出的题（形状照抄 parseAiQuestions 的产物：带好 id、绑好课） */
function aiItems(n: number, lessonId: string = C_LESSON): AiParseResult {
  return {
    items: Array.from({ length: n }, (_, i) => ({
      lessonId,
      lessonTitle: '第一个 C 程序',
      question: {
        id: `ai-2026-09-13-${i + 1}`,
        type: 'fill' as const,
        stem: `AI 出的第 ${i + 1} 题`,
        answer: 'x',
        explanation: '解析'
      }
    })),
    dropped: 0,
    reasons: []
  }
}

/**
 * 补题用例的第二批 AI 题：题号 / 题干必须和开局那批不同。
 * 否则补回来的 key 与开局撞车，断言「题变多了」虽能过，验的却不是真的补了新题。
 */
function refillItems(n: number, lessonId: string = C_LESSON): AiParseResult {
  return {
    items: Array.from({ length: n }, (_, i) => ({
      lessonId,
      lessonTitle: '第一个 C 程序',
      question: {
        id: `ai-refill-${i + 1}`,
        type: 'fill' as const,
        stem: `补题的第 ${i + 1} 题`,
        answer: 'x',
        explanation: '解析'
      }
    })),
    dropped: 0,
    reasons: []
  }
}

interface Harness {
  /** 每次 aiGenerateQuestions 收到的入参（已按结构化克隆拷过一份） */
  aiInputs: AiGenerateInput[]
  /** aiTestConnection 之类的调用次数不重要，这里记的是抽题被调用了几次 */
  aiCalls: () => number
  /** 每次 saveChallenge 收到的 day */
  saved: ChallengeDay[]
  /** 让下一次 saveChallenge **拒绝**（极端[3]：写盘失败必须出声、但不打断答题） */
  setSaveThrows: (e: Error | null) => void
  /** 每次 petEvent 收到的 kind（P3 ④ 好感度收工事件） */
  petEvents: ('challenge' | 'review')[]
  /** 改下一次 AI 的回复 */
  setAiReply: (r: { ok: true; data: AiParseResult } | { ok: false; reason: AiFailReason }) => void
  /** 排队若干次 AI 回复（「补题」用例：开局与补题各拿一份不同的题） */
  setAiReplies: (
    rs: Array<{ ok: true; data: AiParseResult } | { ok: false; reason: AiFailReason }>
  ) => void
  /** 让 AI 调用**抛错**（模拟「我们自己传了个克隆不了的载荷」） */
  setAiThrows: (e: Error | null) => void
  /** 让 AI 抽题挂住不答（模拟"AI 还在飞"）；返回的 release() 放行它（高-5 抽题途中跨天用例） */
  hangAi: () => () => void
  /** 下次读档返回什么 */
  setStored: (t: ChallengeToday) => void
  /** 每次云结算入队收到的载荷（已按结构化克隆拷过一份） */
  settleCalls: ChallengeSettlePayload[]
  /** 每次 getChallenge 收到的日键（高-5 跨天用例验"按新日键重读"） */
  asks: string[]
  /** 改 settleChallenge 的回话（缺省 `{queued:true}`；也用来注入拒绝 / 挂门） */
  setSettleReply: (r: () => Promise<{ queued: boolean }>) => void
}

/**
 * 装上假的 window.miai。
 *
 * ⚠️ `aiGenerateQuestions` 里那句 `structuredClone(input)` 是**故意的**，
 * 不是随手写的 —— 真实的 `ipcRenderer.invoke` 用的就是这个算法，
 * 用它做假货，才能让「载荷里混进了响应式代理」在测试里就现形。
 */
function stubMiai(
  hasKey: boolean,
  learned: string[] = cLessonIds(),
  dynamicEnabled = true
): Harness {
  let reply: { ok: true; data: AiParseResult } | { ok: false; reason: AiFailReason } = {
    ok: true,
    data: aiItems(20)
  }
  /**
   * 排队的回复，按调用顺序消耗。补题用例要「开局给 2 道、补题给另一批」——
   * 只有一个 `reply` 槽时，第二笔调用会拿到和第一笔完全相同的题（id 也相同），
   * 补回来的题会和开局那批撞 key，测试就验不到「真的补了新的」。
   */
  let replyQueue: Array<{ ok: true; data: AiParseResult } | { ok: false; reason: AiFailReason }> =
    []
  const takeReply = () => (replyQueue.length > 0 ? replyQueue.shift()! : reply)
  let throws: Error | null = null
  /** 非 null 时 AI 抽题挂住，直到释放（高-5 跨天途中用例） */
  let hang: Promise<void> | null = null
  let stored: ChallengeToday = { day: null, lastSeen: {}, unsent: [] }
  /** 非 null 时下一次 saveChallenge **拒绝**（极端[3]：写盘失败注入） */
  let saveThrows: Error | null = null
  let settleReply: () => Promise<{ queued: boolean }> = () => Promise.resolve({ queued: true })
  const aiInputs: AiGenerateInput[] = []
  const saved: ChallengeDay[] = []
  const petEvents: ('challenge' | 'review')[] = []
  const settleCalls: ChallengeSettlePayload[] = []
  /** 每次 getChallenge 收到的日键（高-5 跨天用例要验"换天之后确实按新日键读档"） */
  const asks: string[] = []

  ;(globalThis as unknown as { window: unknown }).window = {
    // progress store 挂 beforeunload 用来冲刷存档。node 环境没有真 window，
    // 少了这两个假货，光是建 store 就会抛在 addEventListener 上
    addEventListener: () => {},
    removeEventListener: () => {},
    miai: {
      getConfig: () => Promise.resolve(publicConfig(hasKey, dynamicEnabled)),
      /*
       * 读口回**带戳信封**、写口回 DocWriteResult（P10.6，形状照
       * shared/doc-write.ts）。⚠️ 读口回裸档案的话，progress 的 load() 读
       * `env.data` 得到 undefined —— 档案被当成空的，凡依赖"已学课程"的
       * 用例全红，而报错长得像挑战自己的业务 bug。
       */
      getProfile: (): Promise<StampedDoc<UserProfile | null>> =>
        Promise.resolve({ data: fakeProfile(learned), stamp: { epoch: 0, rev: 0 } }),
      /*
       * 挑战 store 一建立就拉起 progress store（`challenge.ts` 的 `useProgressStore()`），
       * 而 progress 的 `load()` 会对 profile 赋值 —— 深度 watch 由此挂上一个 300ms 的
       * 防抖保存。替身少了这个方法，计时器开火时就抛 `saveProfile is not a function`：
       * **单跑这个文件看不出来**（worker 常在计时器开火前退役，计时器陪葬），
       * 只有全量跑、worker 活得够久时才以 unhandled error 冒出来（EXIT=1）。
       * 挑战自己的用例不验保存，但这个方法**不能没有**（同下面 recordPractice 的理由）。
       * 返回值必须是真形状（`{ok, stamp}`）：回 undefined 会被写协议当成**冲突**，
       * 走重载重放（adopt(undefined) 把档案清成空档）—— 静默的假红源头。
       */
      saveProfile: (): Promise<DocWriteResult<UserProfile | null>> =>
        Promise.resolve({ ok: true, stamp: { epoch: 0, rev: 1 } }),
      getChallenge: (d: string) => {
        asks.push(d)
        return Promise.resolve(stored)
      },
      saveChallenge: (d: ChallengeDay) => {
        // 先判拒绝再记录：拒绝了就是**盘上没落成**，saved 里也不该出现它 ——
        // 不然「写盘失败」这条用例的「盘上确实没有」断言会自相矛盾
        if (saveThrows) return Promise.reject(saveThrows)
        saved.push(structuredClone(d))
        return Promise.resolve()
      },
      aiGenerateQuestions: (input: AiGenerateInput) => {
        // 真 IPC 的守门员：克隆不了就抛，和线上一样
        const copy = structuredClone(input)
        aiInputs.push(copy)
        if (throws) return Promise.reject(throws)
        // 挂住时 reply 在放行那刻才取（模拟"飞着的 IPC 终于回来了"）
        if (hang) return hang.then(() => structuredClone(takeReply()))
        return Promise.resolve(structuredClone(takeReply()))
      },
      aiCancel: () => Promise.resolve(),
      recordWrongbook: () => Promise.resolve(),
      clearWrongbook: () => Promise.resolve(),
      /*
       * 挑战也是练习的一种，收工同样落一条练习史（`finish()` 的唯一写口）。
       * 这份替身不验它（挑战自己的用例管的是挑战存档），但**不能没有** ——
       * `answerAll()` 每题都提交、最后一题推 finish()，少这个方法整份文件当场炸。
       */
      recordPractice: () => Promise.resolve({ version: 1, history: [] }),
      /*
       * P3 ④ 好感度收工事件（挑战完成 +3）。单向 send，如实记下 kind ——
       * "做完发一次、半场不发、重做不发"三条断言都看这个数组。
       */
      petEvent: (kind: 'challenge' | 'review') => {
        petEvents.push(kind)
      },
      /*
       * 云结算入队（P10.6 ⑤）。载荷照样先过 structuredClone —— 和真 IPC
       * 同一个算法，载荷里混进响应式代理在这里就得现形（同 aiGenerateQuestions）。
       * 读档只要没被 setSettleReply 改过，一律回 `{queued:true}`。
       */
      cloud: {
        settleChallenge: (payload: ChallengeSettlePayload) => {
          settleCalls.push(structuredClone(payload))
          return settleReply()
        }
      }
    }
  }

  return {
    aiInputs,
    aiCalls: () => aiInputs.length,
    saved,
    petEvents,
    settleCalls,
    asks,
    setAiReply: (r) => (reply = r),
    setAiReplies: (rs) => (replyQueue = [...rs]),
    setAiThrows: (e) => (throws = e),
    hangAi: () => {
      let release!: () => void
      hang = new Promise<void>((r) => (release = r))
      return () => {
        hang = null
        release()
      }
    },
    setStored: (t) => (stored = t),
    setSaveThrows: (e) => (saveThrows = e),
    setSettleReply: (r) => (settleReply = r)
  }
}

/** 建 store，并等档案读完（progress.load / challenge.load 都是异步的） */
async function setup(hasKey = true, learned: string[] = cLessonIds(), dynamicEnabled = true) {
  const h = stubMiai(hasKey, learned, dynamicEnabled)
  const challenge = useChallengeStore()
  await challenge.load()
  return { h, challenge }
}

/**
 * 把当前这一局答完：每题都提交，最后一题提交后推进 finish()。
 *
 * 【六种题型分两条路，别只想着同步那条】
 * 池子里混着真跑题型（C 的 901 道里一大半是 codefix/codewrite）。
 * 对它们 `submit()` 恒为 false（canSubmit 要求"跑通过一次"），
 * 只走同步那条的话会"一题都没判就 finish"，测试却全绿 —— 假绿。
 * 这里按题型分叉：真跑题型注入假运行结果（stdout 与题目期望一致/不一致），
 * 形状和真跑完全一样（recordRun → submitRun）。
 */
function answerAll(correct: boolean | ((i: number) => boolean) = true) {
  const quiz = useQuizStore()
  while (quiz.session && !quiz.session.finishedAt) {
    const s = quiz.session
    const q = s.questions[s.index]
    const ok = typeof correct === 'function' ? correct(s.index) : correct
    if (isRunGraded(q)) {
      // 造"跑通了但输出不对"而不是编译失败 —— 编译失败是 null（还没跑通），
      // 两个题型都交不了卷，循环会原地打转
      quiz.recordRun(runOk(ok ? q.expectedOutput : WRONG_ANSWER))
      quiz.submitRun()
    } else {
      quiz.answerCurrent(ok ? correctAnswerOf(q) : wrongAnswerOf(q))
      quiz.submit()
    }
    quiz.next()
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

// ---------------------------------------------------------------- 守卫的前提

describe('守卫的前提（这两条挂了，下面几条就都成了摆设）', () => {
  it('从 store 上读到的 bundle 真的是响应式代理 —— 所以载荷必须 toIpc', () => {
    stubMiai(true) // 建 store 之前先把假 window 装上（progress store 会挂 beforeunload）
    const content = useContentStore()
    expect(isReactive(content.bundle)).toBe(true)
    // 而这正是结构化克隆克隆不了的东西
    expect(() => structuredClone(content.bundle.glossary.terms)).toThrow()
  })
})

// ---------------------------------------------------------------- 抽题

describe('抽题：AI 优先', () => {
  it('**传给 AI 的载荷能过结构化克隆**（克隆不了就会退化成「AI 永远不工作」）', async () => {
    const { h, challenge } = await setup()
    await challenge.start()
    expect(h.aiCalls()).toBe(1) // 真的调到了 AI，没被那句 catch 吞掉
    expect(h.aiInputs[0].terms.length).toBeGreaterThan(0)
    // topics 只装**学过的课**（夹具 = C 的 48 节全集），一节课都不多不少
    const ids = cLessonIds()
    expect(h.aiInputs[0].topics.length).toBe(ids.length)
    for (const t of h.aiInputs[0].topics) expect(ids).toContain(t.lessonId)
    expect(h.aiInputs[0].count).toBe(CHALLENGE_AI_BLOCK) // AI 段的固定题数（v3 起它不再是单日上界，本地整池另接在后面）
    expect(challenge.fellBack).toBe(false)
  })

  it('AI 出了题 → 批次 = AI 段 + **本地整池**，AI 段拼在最前', async () => {
    const { challenge } = await setup()
    await challenge.start()
    expect(challenge.day?.source).toBe('ai')
    // v3：取消单日上限后 AI 的成功不再意味着「整批只有 AI 题」——
    // 本地整池必须一道不漏地接在 AI 段后面（它才是「答对继续」的主粮）
    expect(C_POOL.length).toBeGreaterThan(100) // 夹具自检：内容包真的读到了题库
    const qs = challenge.day?.questions ?? []
    expect(qs).toHaveLength(CHALLENGE_AI_BLOCK + C_POOL.length)
    expect(qs[0].qid).toMatch(/^ai-/)
    // 段序：前 20 道全是 AI、后面全是本地；本地段与整池逐 key 相等（顺序洗过，比集合）
    expect(qs.slice(0, CHALLENGE_AI_BLOCK).every((cq) => isAiKey(cq.key))).toBe(true)
    expect(qs.slice(CHALLENGE_AI_BLOCK).every((cq) => !isAiKey(cq.key))).toBe(true)
    expect(qs.slice(CHALLENGE_AI_BLOCK).map((cq) => cq.key).sort()).toEqual(C_POOL_KEYS)
  })

  /*
   * 2026-10-21：题库扩到 6025 道（课文 1754 + 题库 4271），超过了服务端
   * CHALLENGE_RUN_MAX（5000）。v3 的「整池全抽」会让一局超上界，收工时
   * 超出的尾巴被悄悄截掉（做了不上账）。这条用例守抽题那一刀：
   * 本地段封顶 CHALLENGE_LOCAL_CAP，AI 段恒 20，整局恒 ≤ 5000。
   *
   * 前置断言「全库确实大于封顶」是**故意的**：内容若缩回 5000 以内，
   * 这条用例会红着提醒「该重新想它还要不要存在」，而不是静默变成假绿。
   */
  it('单局上界：全库超 5000 时只抽 4980 道本地 + 20 道 AI', async () => {
    const allLearned = bundle.lessons.map((l) => l.id)
    const totalPool = bundle.lessons.reduce((n, l) => n + l.questions.length, 0)
    expect(totalPool).toBeGreaterThan(CHALLENGE_LOCAL_CAP) // 夹具前提：题库真的超了
    const { challenge } = await setup(true, allLearned)
    await challenge.start()
    const qs = challenge.day?.questions ?? []
    expect(qs).toHaveLength(CHALLENGE_AI_BLOCK + CHALLENGE_LOCAL_CAP)
    expect(qs.length).toBeLessThanOrEqual(CHALLENGE_RUN_MAX)
    // AI 段仍在最前、恰好 20 道；本地段一道不多
    expect(qs.slice(0, CHALLENGE_AI_BLOCK).every((cq) => isAiKey(cq.key))).toBe(true)
    expect(qs.slice(CHALLENGE_AI_BLOCK).every((cq) => !isAiKey(cq.key))).toBe(true)
  })

  it('AI 只回了 3 道 → 批次 = 3 + 整池（不足不补、也不缩水）', async () => {
    const { h, challenge } = await setup()
    h.setAiReply({ ok: true, data: aiItems(3) })
    await challenge.start()
    expect(challenge.day?.source).toBe('ai')
    const qs = challenge.day?.questions ?? []
    expect(qs).toHaveLength(3 + C_POOL.length)
    expect(qs.slice(0, 3).every((cq) => isAiKey(cq.key))).toBe(true)
  })

  it('AI 题**存了本体**（它不在任何一课里，不存就永远找不回来）', async () => {
    const { challenge } = await setup()
    await challenge.start()
    expect(challenge.day?.questions[0].ai?.stem).toBe('AI 出的第 1 题')
  })

  it('抽完立刻落盘 —— 中途关窗口也不用重烧一次 API', async () => {
    const { h, challenge } = await setup()
    await challenge.start()
    expect(h.saved).toHaveLength(1)
    expect(h.saved[0].questions).toHaveLength(CHALLENGE_AI_BLOCK + C_POOL.length)
    expect(challenge.day?.questions).toHaveLength(CHALLENGE_AI_BLOCK + C_POOL.length)
  })

  /*
   * 极端[3]（2026-10-16）：写盘失败**必须出声**，但**不许打断答题**。
   *
   * 原实现是一个空 catch —— 盘上没落成、界面一个字不说，用户答完一整局、
   * 下次进来从头再来，查无实据。这条同时钉三件事：
   * ①有 error 吐司，且文案就是 copy.ts 里那句（不是"有错误就算过"——
   *   对着 TOAST 的现值比，改文案不改测试会红）；
   * ②答题照常开考（quiz.session 非空 —— 失败没把人挡在门外）；
   * ③盘上确实没落成（h.saved 为空 —— 不然"失败"只是替身的一句空话）。
   */
  it('落盘失败 → error 吐司出声，但答题照常开始（不打断）', async () => {
    const { h, challenge } = await setup()
    h.setSaveThrows(new Error('disk is read-only'))
    // toast 是模块级单例，不清的话上一条用例弹的气泡会顶掉 .at(-1)
    toasts.splice(0, toasts.length)

    await challenge.start()

    expect(toasts.at(-1)?.type).toBe('error')
    expect(toasts.at(-1)?.text).toBe(TOAST.CHALLENGE_SAVE_FAILED)
    expect(useQuizStore().session).not.toBeNull()
    expect(h.saved).toHaveLength(0)
  })

  it('今天已经抽过 → 再点开始**一次都不调 AI**', async () => {
    const { h, challenge } = await setup()
    await challenge.start()
    const after = h.aiCalls()
    useQuizStore().close()
    await challenge.start()
    expect(h.aiCalls()).toBe(after)
  })
})

// ---------------------------------------------------------------- 退回本地

describe('抽题：退回本地（三条路，界面上的话不一样）', () => {
  it('**没配 Key** → 用本地题，但不算「AI 失败」（压根没试过，没什么好退回的）', async () => {
    const { h, challenge } = await setup(false)
    await challenge.start()
    expect(h.aiCalls()).toBe(0)
    expect(challenge.day?.source).toBe('local')
    expect(challenge.fellBack).toBe(false)
    // v3：本地这一路抽的是**整池**（901 道），不是 20
    expect(challenge.day?.questions).toHaveLength(C_POOL.length)
  })

  it('★ **总开关关着**（Key 配着也不问）→ 本地整池，且不算「AI 失败」', async () => {
    // 开关默认关。用户没主动授权之前，每日挑战一次 API 都不许调。
    const { h, challenge } = await setup(true, cLessonIds(), false)
    await challenge.start()
    expect(h.aiCalls()).toBe(0)
    expect(challenge.day?.source).toBe('local')
    expect(challenge.fellBack).toBe(false)
    expect(challenge.day?.questions).toHaveLength(C_POOL.length)
  })

  it('**AI 失败**（断网/401/超时）→ 退回本地并标记 fellBack，不弹错、不卡住', async () => {
    const { challenge, h } = await setup()
    h.setAiReply({ ok: false, reason: 'offline' })
    await challenge.start()
    expect(challenge.day?.source).toBe('local')
    expect(challenge.fellBack).toBe(true)
    expect(challenge.day?.questions).toHaveLength(C_POOL.length)
  })

  it('**AI 一道题都没过校验** → 同样退回本地', async () => {
    const { challenge, h } = await setup()
    h.setAiReply({ ok: true, data: { items: [], dropped: 5, reasons: ['bad-option-count'] } })
    await challenge.start()
    expect(challenge.day?.source).toBe('local')
    expect(challenge.fellBack).toBe(true)
  })

  it('**调用本身抛错** → 退回本地（这条就是克隆 bug 的现场，界面必须照常能玩）', async () => {
    const { challenge, h } = await setup()
    h.setAiThrows(new Error('An object could not be cloned.'))
    await challenge.start()
    expect(challenge.day?.source).toBe('local')
    expect(challenge.fellBack).toBe(true)
  })

  it('**用户主动取消** → 不退回本地、不抽题（他按的就是「停」）', async () => {
    const { challenge, h } = await setup()
    h.setAiReply({ ok: false, reason: 'canceled' })
    await challenge.start()
    expect(challenge.day).toBeNull()
    expect(challenge.canceled).toBe(true)
    // 取消之后「继续/开始」按钮要回来，不能停在转圈上
    expect(challenge.generating).toBe(false)
  })

  it('本地题**不存本体**（内容包里就有，存了就是两份真源）', async () => {
    const { challenge } = await setup(false)
    await challenge.start()
    expect(challenge.day?.questions.every((q) => q.ai === undefined)).toBe(true)
  })
})

// ---------------------------------------------------------------- 无限题库（补题）

/** 让排队的 promise / watcher 跑几拍（补题链路跨好几个 tick） */
async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()
  }
}

/** 等一个条件成立（补题是异步的：IPC → 解析 → 追加，跨好几个 tick） */
async function waitFor(cond: () => boolean, tries = 40): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()
  }
  throw new Error('waitFor timeout')
}

describe('无限题库：题目快用完时静默补一批（答对继续）', () => {
  it('★ 剩余 ≤ 50 道时自动向 AI 再要一批，追加到当前这一局（不结束、不弹错）', async () => {
    const { h, challenge } = await setup()
    // 第一笔：开局那 20 道；第二笔：补题。队列入参在 start 之前排好
    h.setAiReplies([{ ok: true, data: aiItems(20) }, { ok: true, data: refillItems(2) }])
    await challenge.start()

    const quiz = useQuizStore()
    const s = quiz.session!
    const before = s.questions.length
    expect(h.aiCalls()).toBe(1)
    expect(before).toBeGreaterThan(CHALLENGE_AI_BLOCK)

    // 模拟学员一路答对，走到本局最后一题 —— 水位条件成立
    s.index = before - 1
    await waitFor(() => quiz.session!.questions.length > before)

    expect(h.aiCalls()).toBe(2)
    expect(quiz.session!.questions.length).toBe(before + 2)
    // 补题请求带的是**这一天的批号**，不是开局那个纯日期 → 缓存键不同、题号不撞
    expect(h.aiInputs[1].dateKey).toBe(`${challenge.day!.dateKey}-r${before}`)
    // 补回来的题真的能继续做：index 没动，最后一题已经不是原来那道了
    expect(quiz.session!.questions[before].id).toBe('ai-refill-1')
    // 七组平行数组必须一起长：漏一组就会在下一题读到 undefined，且不报错
    const after = quiz.session!
    for (const arr of [
      after.questions,
      after.keys,
      after.answers,
      after.checked,
      after.runResults,
      after.wrongCounts,
      after.autoRevealed
    ]) {
      expect(arr).toHaveLength(before + 2)
    }
    // 存档同步跟上（中途关软件再进来，补过的题还在）
    await waitFor(() => h.saved.some((d) => d.questions.some((q) => q.qid === 'ai-refill-1')))
    const savedWithRefill = h.saved.find((d) => d.questions.some((q) => q.qid === 'ai-refill-1'))!
    expect(savedWithRefill.questions).toHaveLength(before + 2)
  })

  it('★ 开局 AI 失败、后来补题成功 → 徽章改口为 AI、退回提示撤掉（账跟着事实走）', async () => {
    const { h, challenge } = await setup()
    // 第一笔（开局）失败 → 本地整池 + fellBack；第二笔（补题）成功
    h.setAiReplies([{ ok: false, reason: 'offline' }, { ok: true, data: refillItems(2) }])
    await challenge.start()
    expect(challenge.day?.source).toBe('local')
    expect(challenge.fellBack).toBe(true)

    const quiz = useQuizStore()
    const before = quiz.session!.questions.length
    quiz.session!.index = before - 41
    await waitFor(() => quiz.session!.questions.length > before)

    expect(h.aiCalls()).toBe(2)
    // 卷子里已经有 AI 题了 —— 再说「从课本里抽的」就是假话
    expect(challenge.day?.source).toBe('ai')
    // 刚才那次失败已被这一刻的成功推翻，提示不许继续挂着
    expect(challenge.fellBack).toBe(false)
    // 落盘的也是 ai：关掉再进来，徽章不许退回「课本里抽的」
    await waitFor(() => h.saved.some((d) => d.source === 'ai' && d.questions.length === before + 2))
  })

  it('**总开关关着** → 走到最后一题也不补，一次 API 都不调（用户没授权花 Token）', async () => {
    const { h, challenge } = await setup(true, cLessonIds(), false)
    await challenge.start()
    const quiz = useQuizStore()
    const s = quiz.session!
    const before = s.questions.length
    s.index = before - 1
    await flush() // 给它几拍，确认「没有事情发生」
    expect(h.aiCalls()).toBe(0)
    expect(quiz.session!.questions.length).toBe(before)
  })

  it('补题失败（断网/没余额）→ 静默不补、不弹错；隔 10 道才再试，不轰炸', async () => {
    const { h, challenge } = await setup()
    h.setAiReplies([
      { ok: true, data: aiItems(20) },
      { ok: false, reason: 'offline' },
      { ok: true, data: refillItems(2) }
    ])
    await challenge.start()
    const quiz = useQuizStore()
    const s = quiz.session!
    const before = s.questions.length
    const toastsBefore = toasts.length
    // 还剩 50 道：水位正好成立（不要站在最后一题上 —— 那样失败后没机会重试）
    s.index = before - 41
    await waitFor(() => h.aiCalls() >= 2)
    await flush()
    expect(quiz.session!.questions.length).toBe(before)
    expect(h.aiCalls()).toBe(2) // 同一题目长度、同一位置只试一次
    expect(toasts.length).toBe(toastsBefore) // 静默兜底说的是「不弹错」

    // 只走 5 道：还在冷却里，不许重发（每点一下「下一题」就重试 = 断网时轰炸 API）
    s.index = before - 36
    await flush()
    expect(h.aiCalls()).toBe(2)

    // 再走 5 道（累计 10）：允许再试一次；这次成功补上，批号带 -a1 不撞上次的缓存
    s.index = before - 31
    await waitFor(() => quiz.session!.questions.length > before)
    expect(h.aiCalls()).toBe(3)
    expect(quiz.session!.questions.length).toBe(before + 2)
    expect(h.aiInputs[2].dateKey).toBe(`${challenge.day!.dateKey}-r${before}-a1`)
  })

  it('★ 补题在飞时答错停下 → 迟到的批次不许塞进已经停下的卷子', async () => {
    const { h, challenge } = await setup()
    h.setAiReplies([{ ok: true, data: aiItems(20) }, { ok: true, data: refillItems(2) }])
    await challenge.start()
    const quiz = useQuizStore()
    const s = quiz.session!
    const before = s.questions.length

    // 让补题那一笔挂住（模拟真实网络：请求已经发出、还没回来）
    const release = h.hangAi()
    s.index = before - 41
    await waitFor(() => h.aiCalls() >= 2)

    // 请求在飞的时候，学员在这道题上答错了 —— 答错即停，卷子当场裁到当题
    const q = s.questions[s.index]
    if (isRunGraded(q)) {
      quiz.recordRun(runOk(WRONG_ANSWER))
      quiz.submitRun()
    } else {
      quiz.answerCurrent(wrongAnswerOf(q))
      quiz.submit()
    }
    const stoppedLength = s.index + 1
    expect(quiz.session!.questions.length).toBe(stoppedLength)

    // 迟到的 2 道题回来了。放进来的话：结果页分母变大、没做过的题被记成
    // 「没答对」，而且收工重写会把它俩写进存档 —— 全都不会报错。
    release()
    await flush()
    expect(quiz.session!.questions.length).toBe(stoppedLength)
    expect(quiz.session!.questions.some((x) => x.id === 'ai-refill-1')).toBe(false)
  })

  it('★ 换了一局：补题的冷却账归零（上一局的失败不会把新一局锁死）', async () => {
    const { h, challenge } = await setup()
    h.setAiReplies([
      { ok: true, data: aiItems(20) },
      { ok: false, reason: 'offline' },
      { ok: true, data: refillItems(2) }
    ])
    await challenge.start()
    const quiz = useQuizStore()
    const firstSessionId = quiz.session!.sessionId
    const before = quiz.session!.questions.length

    // 第一局：还剩 50 道时补题失败
    quiz.session!.index = before - 41
    await waitFor(() => h.aiCalls() >= 2)
    expect(quiz.session!.questions.length).toBe(before)

    // 半场退出、再进来（同一份 day，不重新抽题）→ 新会话、新 sessionId
    quiz.close()
    await challenge.start()
    const s2 = quiz.session!
    expect(s2.sessionId).not.toBe(firstSessionId)
    const len2 = s2.questions.length

    // 新一局走到同样的水位：必须**立刻**能补，而不是继承上一局失败的冷却
    s2.index = len2 - 41
    await waitFor(() => quiz.session!.questions.length > len2)
    expect(h.aiCalls()).toBe(3)
    // 计数归零的直接证据：批号是这一局的第一次（没有 -a1）
    expect(h.aiInputs[2].dateKey).toBe(`${challenge.day!.dateKey}-r${len2}`)
  })
})

// ---------------------------------------------------------------- 记账

describe('做完记账（watch 守门员）', () => {
  it('做完之后 day 上有 finishedAt 和分数，并且**写进了存档**', async () => {
    const { h, challenge } = await setup()
    await challenge.start()
    h.saved.length = 0 // 只看这以后的写入
    answerAll()

    expect(challenge.finishedToday).toBe(true)
    // v3：一局 = AI 段 20 道 + 本地整池 901 道 = 921。全对时积分 =
    // AI 段 20 × 100（fill→easy，语言权重全 100）+ 本地整池按难度累加的和。
    // 本地那个和由测试侧独立算（cPoolPoints），把「漏计/重计/错算」全挡在外面。
    const N = CHALLENGE_AI_BLOCK + C_POOL.length
    const allPoints = CHALLENGE_AI_BLOCK * 100 + cPoolPoints()
    expect(challenge.scoreToday).toEqual({
      correct: N,
      total: N,
      points: allPoints,
      pointsMax: allPoints
    })
    // 全对走到底 = 不是「答错即停」，结算卡不该说「因为你答错了就停在这儿」
    expect(challenge.stoppedEarly).toBe(false)
    const last = h.saved[h.saved.length - 1]
    expect(last.finishedAt).toBeTruthy()
    expect(last.score).toEqual({ correct: N, total: N, points: allPoints, pointsMax: allPoints })
    // ★ 等长场景的配对断言 —— v2 生产事故的真形状就是「等长但错位」：
    //   存档 questions（抽题序）和 answers（游玩序）条数一样，回顾页按同一下标
    //   配对后张冠李戴。这里 keys 与游玩序全等就是修复的机器证据
    //   （洗牌下两序恰巧相同的概率是 1/921!）。
    expect(last.questions.map((cq) => cq.key)).toEqual(useQuizStore().session!.keys)
    // P3 ④：收工事件跟着这次记账一起发，且**从头到尾只有这一次**
    // （数组不先清空 —— 顺带钉住 start() 不该发任何好感事件）
    expect(h.petEvents).toEqual(['challenge'])
  })

  it('★ 半场退出不发收工事件（+3 只给"做完"的那一次，半卷不算）', async () => {
    const { h, challenge } = await setup()
    await challenge.start()
    const quiz = useQuizStore()
    const q = quiz.session!.questions[quiz.session!.index]
    quiz.answerCurrent(correctAnswerOf(q))
    quiz.submit()
    quiz.close() // 没做完就退 —— finishedAt 永远没填上，watch 守门员那关都过不去
    expect(h.petEvents).toEqual([])
  })

  it('**finish 和 close 落在同一个 tick 里，分也记得上**（这是 flush: sync 守的那条）', async () => {
    const { h, challenge } = await setup()
    await challenge.start()
    h.saved.length = 0

    const quiz = useQuizStore()
    // 直接把状态推到「做完了」，然后**紧接着**关掉 —— 中间不给任何 await
    while (quiz.session && !quiz.session.finishedAt) {
      const s = quiz.session
      const q = s.questions[s.index]
      quiz.answerCurrent(correctAnswerOf(q))
      quiz.submit()
      quiz.next()
    }
    quiz.close()

    expect(challenge.finishedToday).toBe(true)
    expect(h.saved).toHaveLength(1)
  })

  it('★ 答错即停：第一道错之后本局只剩做过的题，积分与作答都按前缀记', async () => {
    const { h, challenge } = await setup()
    await challenge.start()
    h.saved.length = 0

    answerAll((i) => i % 2 === 0) // 第 0 题对、第 1 题错 —— 本局停在第 2 题

    // ① 会话被裁到只做过的那两题 —— 进度条不会再说「第 3 / 921 题」。
    //    （finish() 只填 finishedAt、不清 session，所以这里还能读到）
    const quiz = useQuizStore()
    const s = quiz.session!
    expect(s.questions).toHaveLength(2)
    // ② 分数：对 1 道、做过 2 道；积分 = 这两道各自的难度分
    //    （第 0 题对 → points；两道都在分母 → pointsMax）。
    //    这两道是随机洗出来的，值多少只有当场按题算才知道，所以从会话上现算。
    const w0 = pointsOfKey(s.keys[0], s.questions[0])
    const w1 = pointsOfKey(s.keys[1], s.questions[1])
    expect(challenge.scoreToday).toEqual({
      correct: 1,
      total: 2,
      points: w0,
      pointsMax: w0 + w1
    })
    expect(challenge.stoppedEarly).toBe(true)
    // ③ 存档按**游玩序成对重写**为做过的前缀（v3 修错位的核心行为）：
    //    questions 不再是整批 921（没做的题不落盘），而且 questions[i] 与
    //    answers[i] **下标一一对应** —— v2 把游玩序 answers 配存档序 questions，
    //    只要洗牌不是恒等就张冠李戴。这里 keys 相等就是对齐的机器证据
    //    （洗牌下顺序恰巧相同的概率是 1/921!，等于不可能）。
    const last = h.saved[h.saved.length - 1]
    expect(last.questions.map((cq) => cq.key)).toEqual(s.keys)
    expect(last.answers).toHaveLength(2)
    expect(last.answers?.map((a) => a.ok)).toEqual([true, false])
    // ③.5 选择题的 your 落盘前换回**原题下标**（会话卷选项被洗过、排列不落盘，
    //      直接存会话下标会让回顾页「你的选择」标签打到别的选项上）。
    //      桥=选项文本：标签指向的文本必须就是当场点的那一项的文本。
    //      （这两道里有没有选择题随洗牌定；穷举覆盖在下面「做满整池」的用例。）
    s.questions.forEach((q, i) => {
      const your = last.answers![i].your
      if (q.type === 'choice') {
        const row = challenge.reviewRows.find((r) => r.key === s.keys[i])!
        const rq = row.question
        if (rq.type !== 'choice') throw new Error(`回顾题 ${s.keys[i]} 不是选择题`)
        expect(rq.options[your as number]).toBe(q.options[s.answers[i] as number])
      } else {
        expect(your).toEqual(s.answers[i])
      }
    })
    // ④ 回顾页只显示做过的那两道
    expect(challenge.reviewRows.map((r) => r.ok)).toEqual([true, false])
    // ⑤ 收工事件照发（答错即停也是一局做完了）
    expect(h.petEvents).toEqual(['challenge'])
  })

  // 30s：穷举整卷（921 道）的 CPU 重活。静机 ~1s；2026-10-11 凌晨全量并发下
  // 5224ms 顶穿默认 5s（负载假红，同本批 media-import/foreign-pc/uplink 的处置）。
  // 断言的穷举性质一字未动，放宽的只是预算。
  it('选择题作答换回原题下标（全对做满整池 —— 本地 143 道选择题一道不落）', { timeout: 30_000 }, async () => {
    // 【为什么敢说「一道不落」】本地段抽的是整池（901 道，其中 choice 143 道），
    // 连对到底把它们全部做进这一局 —— 不是抽样，是穷举。换空间代码要是写错
    // （或被人删回去），143 道里几乎必有指错的，这条必红。
    const { h, challenge } = await setup()
    await challenge.start()
    answerAll() // 全对做满 921 道（AI 段 20 + 本地 901），走「做完整卷」收工
    expect(challenge.finishedToday).toBe(true)
    const s = useQuizStore().session!
    const last = h.saved[h.saved.length - 1]
    const rowByKey = new Map(challenge.reviewRows.map((r) => [r.key, r]))
    let 选择题 = 0
    s.questions.forEach((q, i) => {
      const your = last.answers![i].your
      if (q.type !== 'choice') {
        // 其余题型原样落盘（字符串作答，没有下标空间的问题）
        expect(your).toEqual(s.answers[i])
        return
      }
      选择题++
      const row = rowByKey.get(s.keys[i])!
      const rq = row.question
      if (rq.type !== 'choice') throw new Error(`回顾题 ${s.keys[i]} 不是选择题`)
      // 桥=选项文本：存档下标指到原题的文本 == 会话里点的那一项的文本
      expect(rq.options[your as number]).toBe(q.options[s.answers[i] as number])
      // 全对 ⇒ 标签指的文本还必须就是**正确答案**的文本
      //（按文本比而不是按下标：题内选项文本万一重复，下标唯一性不成立）
      expect(rq.options[your as number]).toBe(rq.options[rq.answer])
    })
    // 内容包前提：本地整池的选择题确实全部进了这一局（0 道 = 用例退化，必须显式红）
    expect(选择题).toBeGreaterThanOrEqual(143)
  })

  it('答对继续：连对不截断 —— 答对 3 道之后卷子还有**整池**那么多', async () => {
    const { challenge } = await setup()
    await challenge.start()
    const quiz = useQuizStore()
    for (let n = 0; n < 3; n++) {
      const s = quiz.session!
      quiz.answerCurrent(correctAnswerOf(s.questions[s.index]))
      quiz.submit()
      quiz.next()
    }
    expect(quiz.session?.questions).toHaveLength(CHALLENGE_AI_BLOCK + C_POOL.length)
    expect(quiz.session?.index).toBe(3)
    // v3 分段洗：AI 段还在最前（段内洗过，段间顺序不动）——
    // 全段一起洗的话，「先来几道 AI 新题」的开局手感就没了
    const head = quiz.session!.questions.slice(0, CHALLENGE_AI_BLOCK)
    expect(head.every((q) => String(q.id).startsWith('ai-'))).toBe(true)
    expect(challenge.finishedToday).toBe(false) // 还没收工
  })

  it('AI 回了个查不到的课号 → 按通用/阶段 0 计分（宁少不虚），题照常能做', async () => {
    const { h, challenge } = await setup()
    h.setAiReply({ ok: true, data: aiItems(CHALLENGE_AI_BLOCK, 'no-such-lesson') })
    await challenge.start()
    answerAll()
    // 查不到课 → lang 退回 common、stage 0 → easy fill = 每题 100。
    // v3 语言权重全 100，所以这个总数和「AI 挂 C 课」那份一模一样 ——
    // 这条守的不是数值差，是**不崩、不问罪**（两场景数值相同本身就是回归证据）。
    const N = CHALLENGE_AI_BLOCK + C_POOL.length
    const allPoints = CHALLENGE_AI_BLOCK * 100 + cPoolPoints()
    expect(challenge.scoreToday).toEqual({
      correct: N,
      total: N,
      points: allPoints,
      pointsMax: allPoints
    })
  })

  it('**已经记过账的那一天，重做一遍不会把成绩改掉**', async () => {
    // 存档里那一批题**是有题干的**（正常情况都这样）：
    // 用真实的课号+题号，好让 store 能从内容包里把它还原出来
    const stored: ChallengeDay = {
      dateKey: '2026-09-13',
      source: 'local',
      questions: [
        { key: `${LESSON}:q1`, lessonId: LESSON, qid: 'q1' },
        { key: `${LESSON}:q2`, lessonId: LESSON, qid: 'q2' }
      ],
      createdAt: '2026-09-13T08:00:00.000Z',
      finishedAt: '2026-09-13T08:30:00.000Z',
      score: { correct: 1, total: 2 }
    }
    const { h, challenge } = await setup()
    h.setStored({ day: stored, lastSeen: {}, unsent: [] })
    await challenge.load()

    await challenge.start() // 走「今天已经抽过」的分支，直接开答题
    h.saved.length = 0
    answerAll()

    // 绝不能把那次成绩改成满分
    expect(challenge.scoreToday).toEqual({ correct: 1, total: 2 })
    // v2 老存档与 v3 同一口径：correct < total 就是「答错即停提前收工」
    expect(challenge.stoppedEarly).toBe(true)
    expect(h.saved).toHaveLength(0)
    // 也不能重复发收工事件 —— 守门员（d.finishedAt）挡在发事件之前，
    // "重做一遍"不该变成"再领一次好感"
    expect(h.petEvents).toEqual([])
  })
})

// ---------------------------------------------------------------- 状态开关

describe('状态开关：界面靠这几个分辨「该显示什么」', () => {
  it('读档之前 ready 为假 —— 不能在这时候下「你没学过任何课」的结论', async () => {
    stubMiai(true)
    const challenge = useChallengeStore()
    expect(challenge.hasPool).toBe(false) // 档案还没读到，池子看着是空的
    await challenge.load()
    expect(challenge.hasPool).toBe(true) // 读完才知道夹具学的那门语言真的有题
    expect(challenge.ready).toBe(true)
  })

  it('没学过任何课 → 池子真的是空的（这时候才该显示空状态）', async () => {
    const { challenge } = await setup(true, [])
    expect(challenge.ready).toBe(true)
    expect(challenge.hasPool).toBe(false)
    // v3：空池时勾选器没有可列的语言；「语言被全点掉」（selectedEmpty）
    // 必须为假 —— 那是另一句提示（"至少勾一门"），两句不能串台
    expect(challenge.poolLangs).toEqual([])
    expect(challenge.selectedEmpty).toBe(false)
  })
})

// ---------------------------------------------------------------- v3：语言勾选

describe('语言勾选（v3：开始前勾今天想考哪几门）', () => {
  it('poolLangs 按协议声明序列出「池子里真有题」的语言，common 不参与勾选', async () => {
    const { challenge } = await setup(true, [...cLessonIds(), ...javaLessonIds()])
    // LANGS 声明序是 common/c/cpp/java/python —— 结果必须是 ['c','java']：
    // 顺序证明用的是协议序（不是学到手的先后），排除 common 证明它不是一门语言
    expect(challenge.poolLangs).toEqual(['c', 'java'])
    expect(challenge.selectedEmpty).toBe(false)
    expect(challenge.isLangOn('c')).toBe(true)
    expect(challenge.isLangOn('java')).toBe(true)
  })

  it('点掉的语言在 selectedPool 里一道不剩；**common 恒含**（不参与勾选）', async () => {
    // 学 C + Java + 通用一课：把两门语言都点掉，池子还剩通用那几道
    const { h, challenge } = await setup(false, [...cLessonIds(), ...javaLessonIds(), LESSON])
    challenge.toggleLang('c')
    challenge.toggleLang('java')
    expect(challenge.isLangOn('c')).toBe(false)
    expect(challenge.selectedEmpty).toBe(false) // common 恒含，还有题可抽
    await challenge.start()
    const qs = challenge.day?.questions ?? []
    expect(qs.length).toBeGreaterThan(0)
    expect(qs.every((cq) => cq.lessonId === LESSON)).toBe(true)
    expect(h.aiCalls()).toBe(0) // 没配 Key，连试都没试
    // 抽过之后再点回来也不重抽 —— 勾选只决定「今天抽哪一池」，不做中途换卷
    useQuizStore().close()
    challenge.toggleLang('c')
    expect(challenge.isLangOn('c')).toBe(true)
    await challenge.start()
    expect(challenge.day?.questions.every((cq) => cq.lessonId === LESSON)).toBe(true)
  })

  // 【为什么两条 it 而不是一条里两次 setup】pinia 只在 it 之间重置（beforeEach）：
  // 同一 it 里第二次 setup() 拿到的还是同一 store / 同一份 progress profile，
  // learned 参数不生效（实测臂二会拿到臂一 C+Java 的池子）。两臂必须各自成 it。
  it('pickedLangs 落盘 = 抽题那刻的勾选、协议序（学了 C+Java，点掉 Java → 只落 [c]）', async () => {
    const { challenge } = await setup(false, [...cLessonIds(), ...javaLessonIds()])
    challenge.toggleLang('java')
    await challenge.start()
    expect(challenge.day?.pickedLangs).toEqual(['c'])
    expect(challenge.day?.format).toBe(2)
  })

  it('全点掉只剩 common 题也能开赛 → 落盘不写 pickedLangs 字段（显式空数组是服务端 400；缺省走题批派生）', async () => {
    // 写 [] 的话结算上行会被服务端 400 拒（present 必须非空）；缺省则「从题批派生」，
    // 全 common 派生为空 —— 和 [] 语义相同，但上行合法。
    const { challenge } = await setup(false, [...cLessonIds(), LESSON])
    challenge.toggleLang('c')
    expect(challenge.selectedEmpty).toBe(false) // common 恒含，还有题可抽
    await challenge.start()
    const d = challenge.day
    expect(d).not.toBeNull()
    expect(d?.pickedLangs).toBeUndefined()
    expect((d?.questions ?? []).every((cq) => cq.lessonId === LESSON)).toBe(true)
  })

  it('全点光且池里没有 common → selectedEmpty 为真，start() 什么都不做', async () => {
    const { h, challenge } = await setup(false) // 学完 C：池里只有 C 的题
    challenge.toggleLang('c')
    expect(challenge.selectedEmpty).toBe(true)
    await challenge.start()
    expect(challenge.day).toBeNull() // 没抽
    expect(useQuizStore().session).toBeNull() // 也没开答题
    expect(h.aiCalls()).toBe(0)
    challenge.toggleLang('c') // 点回来 → 一切照常
    expect(challenge.selectedEmpty).toBe(false)
    await challenge.start()
    expect(challenge.day?.questions).toHaveLength(C_POOL.length)
  })

  it('勾选也管 AI 段：点掉的语言不进 topics（AI 不会被要求出那门的题）', async () => {
    const { h, challenge } = await setup(true, [...cLessonIds(), ...javaLessonIds()])
    challenge.toggleLang('java')
    await challenge.start()
    expect(h.aiCalls()).toBe(1)
    const topicIds = h.aiInputs[0].topics.map((t) => t.lessonId)
    expect(topicIds.length).toBeGreaterThan(0)
    const java = new Set(javaLessonIds())
    expect(topicIds.some((id) => java.has(id))).toBe(false)
  })

  it('勾选的过滤同样作用于本地整池：只点掉 java → 批次里一道 java 都没有', async () => {
    const { challenge } = await setup(false, [...cLessonIds(), ...javaLessonIds()])
    challenge.toggleLang('java')
    await challenge.start()
    const qs = challenge.day?.questions ?? []
    expect(qs).toHaveLength(C_POOL.length) // 只剩 C 的整池
    const java = new Set(javaLessonIds())
    expect(qs.some((cq) => java.has(cq.lessonId))).toBe(false)
  })
})

// ---------------------------------------------------------------- 解锁闸

describe('解锁闸：任意一门语言学完才能玩（2026-10-10 主人令）', () => {
  it('学完 C 全套（48 节）→ 解锁为真', async () => {
    const { challenge } = await setup()
    expect(challenge.unlocked).toBe(true)
    expect(challenge.langProgress.find((p) => p.lang === 'c')?.done).toBe(true)
  })

  it('**差一节都不行**：47 节 → 仍然锁着（口径是"整门学完"）', async () => {
    const ids = cLessonIds()
    const { challenge } = await setup(true, ids.slice(0, -1))
    expect(challenge.unlocked).toBe(false)
    expect(challenge.langProgress.find((p) => p.lang === 'c')?.missing).toBe(1)
  })

  it('只学了通用知识（不算一门语言）→ 锁着；就算池子有题，start() 也**什么都不做**', async () => {
    const { h, challenge } = await setup(true, [LESSON])
    expect(challenge.ready).toBe(true)
    expect(challenge.hasPool).toBe(true) // 池子非空 —— 拦住 start 的是锁，不是没题
    expect(challenge.unlocked).toBe(false)
    await challenge.start()
    expect(h.aiCalls()).toBe(0) // 一道题都没抽
    expect(challenge.day).toBeNull()
    expect(useQuizStore().session).toBeNull() // 答题遮罩也没开
  })
})

// ---------------------------------------------------------------- 逐题回顾

describe('逐题回顾：做完之后能一眼看到哪道错了', () => {
  it('做完就有整池那么多行，题干、你答的、对错都在', async () => {
    const { challenge } = await setup()
    await challenge.start()
    answerAll()

    const rows = challenge.reviewRows
    expect(rows).toHaveLength(CHALLENGE_AI_BLOCK + C_POOL.length)
    expect(rows.every((r) => r.ok)).toBe(true)
    // 题干来自题目本体 —— 光有分数的话，这页只能显示一句「你答错了」，
    // 而那正是用户已经知道的事
    expect(rows[0].question.stem).toBeTruthy()
  })

  it('**作答一起落盘** —— 重开应用、过几天回来看，回顾照样打得开', async () => {
    const { h, challenge } = await setup()
    await challenge.start()
    h.saved.length = 0
    answerAll()

    const last = h.saved[h.saved.length - 1]
    // v3 收工按游玩序**成对重写** questions+answers 为做过的前缀 ——
    // 两者恒等长（v2 时代"answers 短一截"在这里合法，v3 起不存这条缝了：
    // 没做的题整个不落盘，questions[i] 与 answers[i] 下标一一对应）
    expect(last.answers).toHaveLength(last.questions.length)
    expect(last.answers?.every((a) => a.ok)).toBe(true)
    // 存档里那份必须是纯数据 —— 带代理的话 saveChallenge 会当场抛，
    // 被 saveDay 的 catch 吞掉，表现是「回顾永远打不开」，一句报错都没有
    expect(() => structuredClone(last.answers)).not.toThrow()
  })

  it('AI 出的题在回顾里标出来（它的解析是 AI 写的，用户有权知道）', async () => {
    const { challenge } = await setup()
    await challenge.start()
    answerAll()
    // ⚠️ 先断长度再断 every：`[].every(...)` 恒为 true，
    // 少了这一行，上面那句「回顾是空的」也能让这条测试变绿
    const rows = challenge.reviewRows
    expect(rows).toHaveLength(CHALLENGE_AI_BLOCK + C_POOL.length)
    // v3：只有最前那一段（AI 段）标 AI，本地整池一律不标 ——
    // 全段一起洗过，但段序没动，所以「前 20 行全是 AI、后面全不是」成立
    expect(rows.slice(0, CHALLENGE_AI_BLOCK).every((r) => r.ai)).toBe(true)
    expect(rows.slice(CHALLENGE_AI_BLOCK).every((r) => !r.ai)).toBe(true)
  })

  it('内置题不会被标成 AI 出的', async () => {
    const { h, challenge } = await setup(false) // 没配 Key → 抽本地题
    await challenge.start()
    // 本地池是 C 的 901 道（真跑题型也在里面）—— answerAll 会分题型驱动，
    // 走完后整池全部有判定，回顾才是有意义的 901 行而不是残卷
    answerAll()
    expect(challenge.reviewRows).toHaveLength(C_POOL.length)
    expect(challenge.reviewRows.every((r) => !r.ai)).toBe(true)
    expect(h.aiCalls()).toBe(0)
  })

  it('**前缀语义**：存档里 answers 比 questions 短（答错即停）时，没做到的题不进回顾', async () => {
    const stored: ChallengeDay = {
      dateKey: '2026-09-13',
      source: 'local',
      questions: [
        { key: `${LESSON}:q1`, lessonId: LESSON, qid: 'q1' },
        { key: `${LESSON}:q2`, lessonId: LESSON, qid: 'q2' },
        { key: `${LESSON}:q3`, lessonId: LESSON, qid: 'q3' }
      ],
      createdAt: '2026-09-13T08:00:00.000Z',
      finishedAt: '2026-09-13T08:30:00.000Z',
      // 夹具 = 新格式（format 2，收工成对重写）；旧格式的回顾降级另有专测
      format: 2,
      score: { correct: 1, total: 2, points: 100, pointsMax: 200 },
      // 第 2 题答错就停了：只有前两条作答记录
      answers: [
        { your: 0, ok: true },
        { your: 1, ok: false }
      ]
    }
    const { h, challenge } = await setup()
    h.setStored({ day: stored, lastSeen: {}, unsent: [] })
    await challenge.load()

    // 第三道（q3）抽出来了但没做过 —— 回顾里不出现，
    // 否则用户会看到一道自己从没见过的题被标成"答错"
    expect(challenge.reviewRows).toHaveLength(2)
    expect(challenge.reviewRows.map((r) => r.key)).toEqual([
      `${LESSON}:q1`,
      `${LESSON}:q2`
    ])
    expect(challenge.reviewRows[1].your).toBe(1)
    // 存档里 correct(1) < total(2)：v2 老批次也照得出「答错即停」——
    // stoppedEarly 收敛到 store 一处，v2/v3 记录共用同一判据
    expect(challenge.stoppedEarly).toBe(true)
  })

  it('从存档重开也能看：读完档、没开答题，reviewRows 就该是满的', async () => {
    const stored: ChallengeDay = {
      dateKey: '2026-09-13',
      source: 'local',
      questions: [
        { key: `${LESSON}:q1`, lessonId: LESSON, qid: 'q1' },
        { key: `${LESSON}:q2`, lessonId: LESSON, qid: 'q2' }
      ],
      createdAt: '2026-09-13T08:00:00.000Z',
      finishedAt: '2026-09-13T08:30:00.000Z',
      format: 2,
      score: { correct: 1, total: 2 },
      answers: [
        { your: 0, ok: true },
        { your: 1, ok: false }
      ]
    }
    const { h, challenge } = await setup()
    h.setStored({ day: stored, lastSeen: {}, unsent: [] })
    await challenge.load()

    // 关键：这一局根本没进过 quiz.session（重开应用就是这个场景）
    expect(challenge.reviewRows).toHaveLength(2)
    expect(challenge.hasReview).toBe(true)
    expect(challenge.reviewRows[0].ok).toBe(true)
    expect(challenge.reviewRows[1].ok).toBe(false)
  })

  it('**老批次没有 answers → 不给回顾入口，而不是显示一页全错**', async () => {
    // 逐题回顾是后加的，之前存下的批次没有 answers 字段
    const stored: ChallengeDay = {
      dateKey: '2026-09-13',
      source: 'local',
      questions: [{ key: `${LESSON}:q1`, lessonId: LESSON, qid: 'q1' }],
      createdAt: '2026-09-13T08:00:00.000Z',
      finishedAt: '2026-09-13T08:30:00.000Z',
      score: { correct: 1, total: 1 }
    }
    const { h, challenge } = await setup()
    h.setStored({ day: stored, lastSeen: {}, unsent: [] })
    await challenge.load()

    // 把「没有记录」当成「全答错了」显示出来，是在冤枉用户 ——
    // 他明明全对，回顾页却给他一片红叉
    expect(challenge.reviewRows).toEqual([])
    expect(challenge.hasReview).toBe(false)
    // correct === total（这道全对了）→ 不是提前收工，结算卡不该说「答错就停」
    expect(challenge.stoppedEarly).toBe(false)
  })

  it('还原不出来的题**跳过**，不让整页崩掉（内置题被移走 / 内容包改过）', async () => {
    const stored: ChallengeDay = {
      dateKey: '2026-09-13',
      source: 'local',
      questions: [
        { key: `${LESSON}:q1`, lessonId: LESSON, qid: 'q1' },
        { key: `${LESSON}:q99`, lessonId: LESSON, qid: 'q99' } // 内容包里没有这一道
      ],
      createdAt: '2026-09-13T08:00:00.000Z',
      finishedAt: '2026-09-13T08:30:00.000Z',
      format: 2,
      score: { correct: 2, total: 2 },
      answers: [
        { your: 0, ok: true },
        { your: 1, ok: true }
      ]
    }
    const { h, challenge } = await setup()
    h.setStored({ day: stored, lastSeen: {}, unsent: [] })
    await challenge.load()

    expect(challenge.reviewRows).toHaveLength(1) // 少一行，而不是空白一行或整页崩
    expect(challenge.reviewRows[0].key).toBe(`${LESSON}:q1`)
  })

  it('今天还没做完 → 没有回顾可看', async () => {
    const { challenge } = await setup()
    await challenge.start()
    // 抽完题就进来了，一题都没答
    expect(challenge.reviewRows).toEqual([])
    expect(challenge.hasReview).toBe(false)
  })

  it('★ 存档格式闸：format 2 照常回顾；无 format（无戳旧档）降级为空 + oldArchive 为真', async () => {
    /** 两题 + 两条作答的已收工批次。给不给 format = 带戳/无戳的唯一区别 */
    function storedDay(format?: number): ChallengeDay {
      return {
        dateKey: '2026-09-13',
        source: 'local',
        questions: [
          { key: `${LESSON}:q1`, lessonId: LESSON, qid: 'q1' },
          { key: `${LESSON}:q2`, lessonId: LESSON, qid: 'q2' }
        ],
        createdAt: '2026-09-13T08:00:00.000Z',
        finishedAt: '2026-09-13T08:30:00.000Z',
        score: { correct: 1, total: 2 },
        answers: [
          { your: 0, ok: true },
          { your: 1, ok: false }
        ],
        ...(format === undefined ? {} : { format })
      }
    }

    const { h, challenge } = await setup()

    // A 臂：format 2（v3 成对重写格式）→ 回顾照常两行，且不是「老存档」
    h.setStored({ day: storedDay(2), lastSeen: {}, unsent: [] })
    await challenge.load()
    expect(challenge.reviewRows).toHaveLength(2)
    expect(challenge.reviewRows.map((r) => r.key)).toEqual([`${LESSON}:q1`, `${LESSON}:q2`])
    expect(challenge.oldArchive).toBe(false)

    // B 臂：同一份存档**只去掉 format**——无戳档有两种来源（v2 错位档 /
    // 2c44219 的成对但没打戳档），形状一致不可区分，判据一律**保守**：
    // 回顾降级为空 + oldArchive 为真。两臂互证（种坏自证）：把格式闸拆掉，
    // B 臂会跟着 A 臂一起给出两行 —— 必有一条红
    h.setStored({ day: storedDay(undefined), lastSeen: {}, unsent: [] })
    await challenge.load()
    expect(challenge.reviewRows).toEqual([])
    expect(challenge.hasReview).toBe(false)
    expect(challenge.oldArchive).toBe(true)
    // 分数与 stoppedEarly 是可信的：它们不依赖题/答配对，不受降级影响
    expect(challenge.scoreToday).toEqual({ correct: 1, total: 2 })
    expect(challenge.stoppedEarly).toBe(true)
  })
})

// ------------------------------------------------- P10.6 ⑤：已提交标记与补交

/**
 * 「已提交」标记（`submittedAt`）+ 读档补交 —— 收工与入队之间的崩溃窗口。
 *
 * 【窗口长什么样】收工 watcher 先落盘（本地分数完好），再把收工单交给主进程
 * 入队（写 `.sync/pending-ops.json`）。两个动作之间进程猝死/强退：这一天本地
 * 记了账、服务端永远收不到，**没有任何报错**。修复 = 主进程确认入队之后往存档
 * 写一个 `submittedAt` 标记；读档时主进程把「收工了但没标记」的批次列进
 * `unsent`，渲染层拿着它们重走一遍入队。
 *
 * 【这一组用例守的三条不变量】
 *   1. 标记**只在主进程确认之后**写 —— 确认前写上 = 把这一天扔了（补交不再找它）；
 *   2. 没确认（拒绝 / 回话形状不对）**不许写标记** —— 同「不许默认回退为成功」；
 *   3. 补交只认 format ≥ 2 的批次 —— v2 无戳档题/答配对不可信，宁少不虚报。
 */
describe('P10.6 ⑤：「已提交」标记与补交（收工 → 入队之间的崩溃窗口）', () => {
  /** 放行微任务（入队回话 → 写标记那条链）。真计时器，本文件没开假时钟 */
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

  /**
   * 一批 2 道题的夹具（真题号 common-01 的 q1/q2，能真实还原出原题）。
   * 缺省形态 =「今天已抽好、还没收工」——`start()` 会直接拿它开答题，
   * 让收工路径用两题的小卷子就能走完（不必跑 921 道的大盘）。
   */
  function day12(dateKey: string, over: Partial<ChallengeDay> = {}): ChallengeDay {
    return {
      dateKey,
      source: 'local',
      questions: [
        { key: `${LESSON}:q1`, lessonId: LESSON, qid: 'q1' },
        { key: `${LESSON}:q2`, lessonId: LESSON, qid: 'q2' }
      ],
      createdAt: `${dateKey}T08:00:00.000Z`,
      finishedAt: null,
      score: null,
      format: 2,
      ...over
    }
  }

  /** 收工档 = day12 + 完成三件套（finishedAt / score / answers 成对） */
  function done12(dateKey: string, over: Partial<ChallengeDay> = {}): ChallengeDay {
    return day12(dateKey, {
      finishedAt: `${dateKey}T08:30:00.000Z`,
      score: { correct: 1, total: 2 },
      answers: [
        { your: 0, ok: true },
        { your: 1, ok: false }
      ],
      ...over
    })
  }

  it('★ 收工 → 入队确认 → 才写标记；确认前**不写**（早了 = 把这一天扔了）', async () => {
    const { h, challenge } = await setup(true, cLessonIds(), false)
    h.setStored({ day: day12(todayKey()), lastSeen: {}, unsent: [] })
    await challenge.load()
    await challenge.start() // 走「今天已抽过」分支，直接开答题（2 道）
    h.saved.length = 0
    answerAll() // 两道做完 → 收工 watcher：落盘 + 发起入队（同步段）

    // 收工那次落盘：标记**还没**写上 —— 入队还在飞，确认回话还没到
    const before = h.saved[h.saved.length - 1]
    expect(before.finishedAt).toBeTruthy()
    expect(before.submittedAt).toBeUndefined()
    // 收工单已经发出去了（载荷同步入 settleCalls，await 才是异步的）
    expect(h.settleCalls).toHaveLength(1)
    expect(h.settleCalls[0].dateKey).toBe(todayKey())
    expect(h.settleCalls[0].questions).toHaveLength(2)

    await settle() // 放行回话 → 写标记
    expect(h.saved).toHaveLength(2) // 收工一次 + 标记一次，不再有第三笔
    const after = h.saved[h.saved.length - 1]
    expect(Number.isNaN(Date.parse(after.submittedAt ?? ''))).toBe(false)
    // 标记是"贴上去"的：业务数据一个字节都没动
    expect(after.finishedAt).toBe(before.finishedAt)
    expect(after.score).toEqual(before.score)
    // 界面手里那份也拿到了标记（同一天才换 day.value）
    expect(challenge.day?.submittedAt).toBe(after.submittedAt)
  })

  it('★ 入队被拒 → **不写标记**；下次读档按 unsent 补交，成功后才标', async () => {
    const { h, challenge } = await setup(true, cLessonIds(), false)
    h.setSettleReply(() => Promise.reject(new Error('main busy')))
    h.setStored({ day: day12(todayKey()), lastSeen: {}, unsent: [] })
    await challenge.load()
    await challenge.start()
    h.saved.length = 0
    answerAll()
    await settle()

    // ① 拒绝 = 没交付：最后一次落盘不许带标记（带上 = 这一天永远不会再补交）
    expect(h.settleCalls).toHaveLength(1)
    expect(h.saved[h.saved.length - 1].submittedAt).toBeUndefined()
    expect(challenge.day?.submittedAt).toBeUndefined()

    // ② 模拟下次读档：主进程把「收工了没标记」的这天放进 unsent
    //   （真实现见 challenge-merge.ts 的 challengeToday —— main 侧另有用例钉）
    const d = challenge.day!
    h.setStored({ day: d, lastSeen: {}, unsent: [d] })
    h.setSettleReply(() => Promise.resolve({ queued: true }))
    h.saved.length = 0
    await challenge.load()
    await settle()
    expect(h.settleCalls).toHaveLength(2) // 第二次真的补交了
    expect(h.saved).toHaveLength(1)
    expect(Number.isNaN(Date.parse(h.saved[0].submittedAt ?? ''))).toBe(false)
    expect(h.saved[0].dateKey).toBe(todayKey())
    expect(challenge.day?.submittedAt).toBe(h.saved[0].submittedAt)
  })

  it('format < 2 的老档不补交（题/答配对不可信，宁少不虚报）', async () => {
    const { h, challenge } = await setup(true, cLessonIds(), false)
    const old = done12(todayKey(), { format: 1 })
    h.setStored({ day: null, lastSeen: {}, unsent: [old] })
    await challenge.load()
    await settle()
    // 一包都没发 —— 拿错位的数据补交 = 往服务器写一份假成绩
    expect(h.settleCalls).toHaveLength(0)
    // 也没写标记：它永远不进「已交付」名单，但更不许写个假标记来糊弄
    expect(h.saved).toHaveLength(0)
  })

  it('queued:false（同一天已在队）也算"交付了" —— 标记照写', async () => {
    const { h, challenge } = await setup(true, cLessonIds(), false)
    const d = done12(todayKey())
    h.setStored({ day: d, lastSeen: {}, unsent: [d] })
    h.setSettleReply(() => Promise.resolve({ queued: false }))
    await challenge.load()
    await settle()
    expect(h.settleCalls).toHaveLength(1)
    // 已在队 = 这一天有着落；不写标记的话每次读档都要再发一遍（还是会被
    // 主进程去重，但标记的意义就是"别再试了"）
    expect(h.saved).toHaveLength(1)
    expect(h.saved[0].submittedAt).toBeTruthy()
  })

  it('回话形状不对（queued 不是布尔）→ 不当成功、不写标记（不许默认回退为成功）', async () => {
    const { h, challenge } = await setup(true, cLessonIds(), false)
    const d = done12(todayKey())
    h.setStored({ day: d, lastSeen: {}, unsent: [d] })
    h.setSettleReply(() => Promise.resolve({} as { queued: boolean }))
    await challenge.load()
    await settle()
    expect(h.settleCalls).toHaveLength(1)
    expect(h.saved).toHaveLength(0) // 形状不对 = 接线 bug：留白标记，下次再试
  })

  it('跨天补交：标记写回**那一天的**存档条目，不碰今天那批（day.value 不动）', async () => {
    const { h, challenge } = await setup(true, cLessonIds(), false)
    const old = done12('2026-09-13')
    h.setStored({ day: null, lastSeen: {}, unsent: [old] })
    await challenge.load()
    await settle()
    expect(h.settleCalls).toHaveLength(1)
    expect(h.settleCalls[0].dateKey).toBe('2026-09-13')
    expect(h.saved).toHaveLength(1)
    expect(h.saved[0].dateKey).toBe('2026-09-13')
    expect(h.saved[0].submittedAt).toBeTruthy()
    // 今天没档 → 补交不许把旧批次顶成"今天那批"（不然「可以开始」会被它挡住）
    expect(challenge.day).toBeNull()
  })

  it('两个 load 撞车：同一天的补交只发一包（在飞去重）', async () => {
    const { h, challenge } = await setup(true, cLessonIds(), false)
    const d = done12(todayKey())
    h.setStored({ day: d, lastSeen: {}, unsent: [d] })
    let release!: (r: { queued: boolean }) => void
    h.setSettleReply(() => new Promise((resolve) => (release = resolve)))

    const p1 = challenge.load()
    const p2 = challenge.load() // 第二发在第一个还飞着的时候进来
    await settle()
    expect(h.settleCalls).toHaveLength(1) // 不叠包

    release({ queued: true })
    await Promise.all([p1, p2])
    await settle()
    expect(h.settleCalls).toHaveLength(1)
    expect(h.saved).toHaveLength(1)
    expect(h.saved[0].submittedAt).toBeTruthy()
  })

  it('★ refresh() 不被 progress 闸吞：进度没就绪也读得到今天那批（深链冷启动）', async () => {
    // 旧版 refresh 开头是 `if (!progress.loaded) return` —— 深链冷启动时
    // 这次调用被静默丢弃且无人重试：day 永远是 null，页面显示「可以开始」，
    // 按下去会把今天已收工的存档**覆盖重抽**。
    const h = stubMiai(true)
    const challenge = useChallengeStore()
    const progress = useProgressStore()
    // 前提断言：progress 此刻真的没就绪（否则这条用例挡不住旧闸门，等于摆设）
    expect(progress.loaded).toBe(false)
    const d = day12(todayKey())
    h.setStored({ day: d, lastSeen: {}, unsent: [] })
    await challenge.refresh()
    expect(challenge.day?.dateKey).toBe(todayKey())
  })
})

// ---------------------------------------------------------------- 高-5 跨零点自动换天

/*
 * 高-5（2026-10-15）：常驻应用跨零点后挑战页永远停在昨天，**必须重启才恢复**。
 *
 * 【原来的病根】`dateKey = computed(() => todayKey())` —— 求值函数里没有任何
 * 响应式依赖，Vue 算过第一次就缓存到进程结束。桌宠 + 托盘让它常年不关，
 * 于是"今天挑战过没有"每天都停留在启动那天。
 *
 * 【现在的修法】活时钟 ref（lib/day-clock.ts）+ 本 store 两条换天 watch：
 * 答题 / 抽题途中先记欠账（pendingRollover），落地后再搬页面。
 *
 * 【这组用例与 day-clock.test.ts 的分工】那边推的是计时器事件（什么时候翻值），
 * 这边验的是翻值之后**挑战 store 的行为**（分会不会丢、档按哪一天重读）。
 * 两边都过 = 机制与接线各钉一半；活窗过零点的 CDP 读数在夜里探针批里交叉印证。
 *
 * 【假钟只假 Date，不假 setTimeout】progress store 的 300ms 防抖保存挂的是
 * 真计时器；连 setTimeout 一起假掉会把它卡住，无辜断言集体假红。
 */
describe('高-5：跨零点自动换天（活时钟接线 + 欠账换天）', () => {
  /** 把假钟拨到"明天中午"，并推活时钟跨天；返回新日键 */
  function jumpToTomorrow(): string {
    const t = new Date()
    const next = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1, 12, 0, 0)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(next)
    refreshToday()
    return todayKey(next)
  }

  afterEach(() => {
    vi.useRealTimers()
    // 活时钟是模块级 ref（同一文件里各用例共享）：把"今天"还回真实日期，
    // 否则后面用例的 setup() 会按明天的日键读档
    refreshToday()
  })

  /** 本组自己的存档夹具（day12/done12 长在 P10.6 那个 describe 里，够不着） */
  function mkDay(dateKey: string): ChallengeDay {
    return {
      dateKey,
      source: 'local',
      questions: [
        { key: `${LESSON}:q1`, lessonId: LESSON, qid: 'q1' },
        { key: `${LESSON}:q2`, lessonId: LESSON, qid: 'q2' }
      ],
      createdAt: `${dateKey}T08:00:00.000Z`,
      finishedAt: null,
      score: null,
      format: 2
    }
  }

  it('★ 答到一半跨天：当场不换（分不能丢），收工后自动搬到新一天', async () => {
    const { h, challenge } = await setup()
    await challenge.start()
    const quiz = useQuizStore()
    // 前提断言：真的在挑战答题里（不在的话这条用例挡不住任何东西）
    expect(quiz.session?.mode).toBe('challenge')
    const startedDay = challenge.dateKey
    h.saved.length = 0

    const tomorrow = jumpToTomorrow()
    expect(tomorrow).not.toBe(startedDay)

    await nextTick() // 让换天 watch 跑
    // ① 答题途中 day 一动不动 —— 当场换成新一天的话，收工 watcher
    //    （拿 day.value 当账本）会走它第一行的早退，这一局的分**静默丢掉**
    expect(challenge.day?.dateKey).toBe(startedDay)

    // ② 把这一局做完、关窗（收工 watcher 是 flush:'sync'，分当场落账）
    answerAll(true)
    quiz.close()

    // ③ 分落在**开局那天** —— 这局题属于哪一天，开局时就定了
    expect(h.saved[0]?.dateKey).toBe(startedDay)
    expect(h.saved[0]?.finishedAt).toBeTruthy()
    expect(h.saved[0]?.score?.correct).toBeGreaterThan(0)

    // ④ 欠账的换天这才执行：按新日键重读了档，day 清空（新一天还没抽过）
    await nextTick()
    await nextTick()
    expect(h.asks).toContain(tomorrow)
    expect(challenge.day).toBeNull()
  })

  it('没在答题也没在抽题时跨天：当场换天，按新日键重读档（不是继续显示昨天的批次）', async () => {
    const { h, challenge } = await setup()
    h.setStored({ day: mkDay(challenge.dateKey), lastSeen: {}, unsent: [] })
    await challenge.refresh()
    // 前提断言：今天真的已有一批（否则"换天清掉它"无从验起）
    expect(challenge.day?.dateKey).toBe(challenge.dateKey)
    h.asks.length = 0

    const tomorrow = jumpToTomorrow()
    // 服务端视角：新的一天还没抽过 —— 换天重读之后界面应回到"可以开始"
    h.setStored({ day: null, lastSeen: {}, unsent: [] })
    await nextTick()
    await nextTick()

    // 旧病形状恰是这里的反面：dateKey 缓存住 → 不重读 → day 还是昨天那批，
    // 页面继续说"今天已经挑战过啦"，且**直到重启**都不变
    expect(h.asks).toContain(tomorrow)
    expect(challenge.day).toBeNull()
  })

  it('跨天那刻 AI 还在抽题：等它落盘（落的就是新日键），欠账的换天到点不白清', async () => {
    const { h, challenge } = await setup()
    const release = h.hangAi()
    const startP = challenge.start()
    // 前提断言：AI 真的在飞（不挂住的话抽题瞬间完成，这条用例形同虚设）
    expect(challenge.generating).toBe(true)

    const tomorrow = jumpToTomorrow()
    await nextTick()
    // 途中不落盘、也不清场
    expect(challenge.day).toBeNull()

    release()
    await startP
    const quiz = useQuizStore()
    expect(quiz.session?.mode).toBe('challenge') // 抽完照常开卷
    // 落盘的批次戳的是**新一天** —— dateKey 是活的，抽完那一刻已经是新日键
    expect(h.saved[h.saved.length - 1]?.dateKey).toBe(tomorrow)

    answerAll(true)
    quiz.close()
    await nextTick()
    await nextTick()
    // 欠账的换天走到这里发现 day 已是"今天" → 走早退分支：
    // **不白清**（清掉就把刚做完的一局从界面上抹掉了）
    expect(challenge.day?.dateKey).toBe(tomorrow)
    expect(challenge.finishedToday).toBe(true)
  })
})
