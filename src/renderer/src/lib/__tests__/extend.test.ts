/**
 * 延展练习的启动器（src/renderer/src/lib/extend.ts）。
 *
 * 【这个文件在守什么】
 * 池子怎么排（同课优先、标签命中）在 shared/__tests__/extend-paper.test.ts；
 * 这里守的是**开局这一下**：
 *   · keys 必须来自每题**自己的宿主课**，绝不能是 `__extend__:xxx` 哨兵垃圾
 *     （不然答错往错题本灌垃圾条目、答对永远消除不掉 —— quiz.ts 的 restart 注释里
 *      记着同型 bug 的现场）——AI 补的题也不例外；
 *   · 题量和 keys 必须**同一次挑选**产生（只洗一边 = 键错位 = 错的题记到别的题头上）；
 *   · 池子不够 / 池子为空 / 来源课没了 —— 三种缺料各有各的**如实**说法，
 *     不许悄悄开一张空卷，也不许假装凑齐。
 *
 * 【2026-09-30 闭环 §5.3】加了 AI 补题。这里守它四条：
 *   · 只在静态池凑不满、且配了 Key 时才问（够量还问 = 白烧钱）；
 *   · count = **差额**、topics 只有源课、stems 是"这一课已出过的"；
 *   · 载荷过得了结构化克隆（terms 在真环境里是响应式代理 —— 漏了 toIpc
 *     这里会以"AI 补题失效"的样子红，与真机同一种坏法）；
 *   · AI 挂了/交白卷/抛异常一律**静默回退**，仍不足就如实少出 ——
 *     AI 不可用是日常不是故障（docs/03 A7）。
 *
 * 内容查找走注入（ExtendDeps，见 lib/extend.ts 抬头）：
 * 不啃真内容包，断言也就不依赖"真内容此刻长什么样"。AI 同样注入 ——
 * `ask` 的假货里那句 `structuredClone` 是**故意的**守门员（同 challenge.test.ts）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useExtendStarter, type ExtendAi, type ExtendDeps } from '../extend'
import { useQuizStore } from '../../stores/quiz'
import { stubMiai } from '../../stores/__tests__/miai-stub'
import { toasts } from '../../components/base/toast'
import { TOAST } from '../copy'
import { buildQuestionIndex } from '../../../../shared/question-index'
import type { AiParseResult } from '../../../../shared/ai-question'
import type {
  AiFailReason,
  AiGenerateInput,
  Difficulty,
  GlossaryTerm,
  Lang,
  Lesson,
  Question,
  WrongBookEntry
} from '../../../../shared/types'

function choice(id: string, difficulty?: Difficulty): Question {
  const d = difficulty === undefined ? {} : { difficulty }
  return {
    id,
    type: 'choice',
    ...d,
    stem: `stem-${id}`,
    options: ['a', 'b', 'c'],
    answer: 0,
    explanation: 'e'
  }
}

function lesson(id: string, questions: Question[], lang: Lang = 'c', tags: string[] = []): Lesson {
  return {
    id,
    lang,
    stage: 1,
    order: 1,
    title: `title-${id}`,
    tags,
    required: [],
    crossRefs: [],
    compare: [],
    estMinutes: 5,
    keywords: [],
    body: '',
    questions
  }
}

/** 一份"两三节课"的假内容：源课 1 道错题、同语言另一课 6 道、别语言 3 道 */
function fixtures(ai?: ExtendAi) {
  const src = lesson('c-stage1-01', [choice('q1')], 'c', ['指针'])
  const other = lesson(
    'c-stage1-02',
    [1, 2, 3, 4, 5, 6].map((i) => choice(`m${i}`)),
    'c',
    ['指针']
  )
  const java = lesson('java-stage1-01', [1, 2, 3].map((i) => choice(`j${i}`)), 'java', ['指针'])
  const lessons = [src, other, java]
  const byId = new Map(lessons.map((l) => [l.id, l]))
  const deps: ExtendDeps = {
    lessonOf: (id) => byId.get(id),
    index: buildQuestionIndex(lessons),
    findBuiltIn: (lessonId, qid) => byId.get(lessonId)?.questions.find((q) => q.id === qid) ?? null,
    ...(ai ? { ai } : {})
  }
  const entry: WrongBookEntry = {
    key: 'c-stage1-01:q1',
    lessonId: 'c-stage1-01',
    qid: 'q1',
    wrongCount: 2,
    lastWrongAt: '2026-09-29T02:00:00.000Z',
    cleared: false
  }
  return { deps, entry }
}

beforeEach(() => {
  setActivePinia(createPinia())
  stubMiai()
  toasts.length = 0
})

describe('startExtend：延展练习开局', () => {
  it('★ keys 全部来自每题自己的宿主课（一条 __extend__ 哨兵都不许有）', async () => {
    const { deps, entry } = fixtures()
    const quiz = useQuizStore()
    const { startExtend } = useExtendStarter()
    await startExtend(entry, 5, deps)

    const s = quiz.session!
    expect(s.mode).toBe('extend')
    expect(s.lessonId).toBe('__extend__')
    expect(s.questions).toHaveLength(5)
    expect(s.keys).toHaveLength(5)
    for (const k of s.keys) {
      expect(k.startsWith('__extend__:'), k).toBe(false)
    }
    // 具体一点：全都挂在 c- 的两节课下，而且没有一条是来源题自己
    for (const k of s.keys) expect(k.startsWith('c-stage1-0')).toBe(true)
    expect(s.keys).not.toContain('c-stage1-01:q1')
    // 别语言的题一道都没混进来（硬过滤——按题号前缀认 java 的题）
    for (const q of s.questions) expect(q.id.startsWith('j')).toBe(false)
    // 开局提示：池子够（6 道 ≥ 5），是"开始"不是"只有 N 道"
    expect(toasts.at(-1)?.text).toBe(TOAST.extendStarted(5))
    expect(toasts.at(-1)?.type).toBe('success')
  })

  it('★ questions 与 keys 一一对应：keys[i] 正是 questions[i] 那道题的键', async () => {
    const { deps, entry } = fixtures()
    const quiz = useQuizStore()
    const { startExtend } = useExtendStarter()
    await startExtend(entry, 6, deps)

    const s = quiz.session!
    // 唯一能把"配对没错位"钉死的断言：按 id 反查它挂在哪一课，
    // 拼出来的键必须就是 s.keys[i]。只比"集合相等"是不够的 —— 错位是**换个配对**，
    // 集合照样相等（quiz-paper.ts 抬头说的就是这个坑）
    for (let i = 0; i < s.questions.length; i++) {
      const q = s.questions[i]
      const host = q.id.startsWith('m') ? 'c-stage1-02' : 'c-stage1-01'
      expect(s.keys[i], `第 ${i} 题`).toBe(`${host}:${q.id}`)
    }
  })

  it('★ 池子不够选的量：如实说"只有 N 道"，卷子就出 N 道（不凑数、不重复）', async () => {
    const { deps, entry } = fixtures()
    const quiz = useQuizStore()
    const { startExtend } = useExtendStarter()
    // 池子里只有 6 道（c-stage1-02 的 m1..m6），要 10 道
    await startExtend(entry, 10, deps)

    const s = quiz.session!
    expect(s.questions).toHaveLength(6)
    expect(new Set(s.keys).size).toBe(6)
    expect(toasts.at(-1)?.text).toBe(TOAST.extendShort(6))
    expect(toasts.at(-1)?.type).toBe('warn')
  })

  it('★ 池子为空（这门语言只有这一课、就这一道题）→ 不开空卷，如实提示', async () => {
    const only = lesson('c-stage1-01', [choice('q1')], 'c')
    const { entry } = fixtures()
    const deps: ExtendDeps = {
      lessonOf: (id) => (id === 'c-stage1-01' ? only : undefined),
      index: buildQuestionIndex([only]),
      findBuiltIn: (lessonId, qid) =>
        lessonId === 'c-stage1-01' ? (only.questions.find((q) => q.id === qid) ?? null) : null
    }
    const quiz = useQuizStore()
    const { startExtend } = useExtendStarter()
    await startExtend(entry, 5, deps)

    expect(quiz.session).toBeNull()
    expect(toasts.at(-1)?.text).toBe(TOAST.EXTEND_NONE)
    expect(toasts.at(-1)?.type).toBe('warn')
  })

  it('来源课已经找不到了 → 不开卷，报"课找不到了"（和列表那句同款）', async () => {
    const { deps, entry } = fixtures()
    const quiz = useQuizStore()
    const { startExtend } = useExtendStarter()
    await startExtend({ ...entry, lessonId: 'c-stage9-99' as string }, 5, deps)

    expect(quiz.session).toBeNull()
    expect(toasts.at(-1)?.text).toBe(TOAST.WRONG_ENTRIES_BROKEN)
  })

  it('题量两端钳死：传 0 出 1 道，传 99 出到上限 10 道', async () => {
    const many = lesson(
      'c-stage1-02',
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => choice(`m${i}`)),
      'c'
    )
    const src = lesson('c-stage1-01', [choice('q1')], 'c')
    const byId = new Map([src, many].map((l) => [l.id, l]))
    const deps: ExtendDeps = {
      lessonOf: (id) => byId.get(id),
      index: buildQuestionIndex([src, many]),
      findBuiltIn: (lessonId, qid) => byId.get(lessonId)?.questions.find((q) => q.id === qid) ?? null
    }
    const { entry } = fixtures()
    const quiz = useQuizStore()
    const { startExtend } = useExtendStarter()

    await startExtend(entry, 0, deps)
    expect(quiz.session!.questions).toHaveLength(1)

    const { startExtend: again } = useExtendStarter()
    await again(entry, 99, deps)
    expect(quiz.session!.questions).toHaveLength(10)
  })

  it('AI 题（本体在条目里）也能延展：课从宿主课拿，题从索引拿', async () => {
    const { deps } = fixtures()
    const aiEntry: WrongBookEntry = {
      key: 'ai-2026-09-29-1',
      lessonId: 'c-stage1-01',
      qid: 'ai-1',
      wrongCount: 1,
      lastWrongAt: '2026-09-29T02:00:00.000Z',
      cleared: false,
      ai: choice('ai-1')
    }
    const quiz = useQuizStore()
    const { startExtend } = useExtendStarter()
    await startExtend(aiEntry, 5, deps)

    const s = quiz.session!
    expect(s.questions).toHaveLength(5)
    // AI 来源题的键不在索引里，"排自己"那一条自然作废 —— 但池子里也不该冒出它
    expect(s.keys).not.toContain('ai-2026-09-29-1')
    for (const k of s.keys) expect(k.startsWith('c-stage1-0')).toBe(true)
  })
})

// ---------------------------------------------------------------- AI 补题（§5.3）

/** AI 交回来的一批题：id 用真实的铸号规则（`ai-<日期>-<序号>`），都挂在源课上 */
function aiReply(n: number): { ok: true; data: AiParseResult } {
  return {
    ok: true,
    data: {
      items: Array.from({ length: n }, (_, i) => ({
        lessonId: 'c-stage1-01',
        lessonTitle: 'title-c-stage1-01',
        question: choice(`ai-2026-09-30-${i + 1}`)
      })),
      dropped: 0,
      reasons: []
    }
  }
}

const TERMS: GlossaryTerm[] = [{ key: 'loop', originals: ['循环'], cat: 'basic', example: 'for' }]

interface AiHarness {
  ai: ExtendAi
  /** 每次 ask 收到的入参（已按结构化克隆拷过一份） */
  inputs: AiGenerateInput[]
}

/**
 * 假的 AI 依赖。
 *
 * ⚠️ `ask` 里那句 `structuredClone(input)` 是**故意的**守门员 ——
 * 真实的 `ipcRenderer.invoke` 用的就是这个算法，用它做假货，
 * 「载荷里混进了响应式代理」在这里就会现形（同 challenge.test.ts）。
 */
/** 一个「AI 还在飞」的假依赖：ask 挂住，直到 `release` 被调用（连点/迟到卷子两条用例要它） */
function deferredAi() {
  const inputs: AiGenerateInput[] = []
  let release: (r: { ok: true; data: AiParseResult }) => void = () => {}
  const gate = new Promise<{ ok: true; data: AiParseResult }>((resolve) => {
    release = resolve
  })
  const ai: ExtendAi = {
    hasKey: true,
    dynamicEnabled: true,
    dateKey: '2026-09-30',
    terms: TERMS,
    ask: (input) => {
      inputs.push(structuredClone(input))
      return gate.then((r) => structuredClone(r))
    }
  }
  return { ai, inputs, release: (r: { ok: true; data: AiParseResult }) => release(r) }
}

function aiHarness(
  reply: { ok: true; data: AiParseResult } | { ok: false; reason: AiFailReason },
  opts?: { hasKey?: boolean; dynamicEnabled?: boolean; throws?: Error; terms?: GlossaryTerm[] }
): AiHarness {
  const inputs: AiGenerateInput[] = []
  const ai: ExtendAi = {
    hasKey: opts?.hasKey ?? true,
    // 夹具默认「开关开着」，因为本文件里的既有用例守的是「有 Key 就该补题」；
    // 开关关闭时的静默回退另有专门的用例（见下面「总开关关着」）。
    dynamicEnabled: opts?.dynamicEnabled ?? true,
    dateKey: '2026-09-30',
    terms: opts?.terms ?? TERMS,
    ask: (input) => {
      const copy = structuredClone(input)
      inputs.push(copy)
      if (opts?.throws) return Promise.reject(opts.throws)
      return Promise.resolve(structuredClone(reply))
    }
  }
  return { ai, inputs }
}

describe('startExtend：AI 补题（§5.3）', () => {
  it('★ 静态池凑不满：问 AI 要差额（count=差额、topics 只有源课、stems 带已出题干），补满开局', async () => {
    const h = aiHarness(aiReply(4))
    const { deps, entry } = fixtures(h.ai)
    const quiz = useQuizStore()
    const { startExtend } = useExtendStarter()
    // 静态池 6 道、要 10 道 → 差额 4
    await startExtend(entry, 10, deps)

    const s = quiz.session!
    expect(s.questions).toHaveLength(10)
    expect(h.inputs).toHaveLength(1)
    const input = h.inputs[0]
    expect(input.count).toBe(4)
    expect(input.dateKey).toBe('2026-09-30')
    expect(input.topics).toHaveLength(1)
    expect(input.topics[0].lessonId).toBe('c-stage1-01')
    // 「已出题干」= 错题本体（q1）。静态池那 6 道都在 c-stage1-02 名下，不算这一课的 ——
    // 把别课的题干塞进来，模型会把别课内容挂到这个课号下（不报错的那种坏）
    expect(input.topics[0].stems).toEqual(['stem-q1'])
    expect(input.terms).toHaveLength(1)

    // AI 题的键 = 源课 + ai 题号；一条哨兵都没有
    const aiKeys = s.keys.filter((k) => k.includes('ai-2026-09-30-'))
    expect(aiKeys).toHaveLength(4)
    for (const k of aiKeys) expect(k.startsWith('c-stage1-01:ai-2026-09-30-')).toBe(true)
    // 配对没错位：AI 题的 key 对应的正是那道本体（id 与键里的题号一致）
    for (let i = 0; i < s.keys.length; i++) {
      if (!s.keys[i].includes('ai-2026-09-30-')) continue
      expect(s.keys[i]).toBe(`c-stage1-01:${s.questions[i].id}`)
    }
    // 补满到 10 道 = "开始"，不是"只有 N 道"
    expect(toasts.at(-1)?.text).toBe(TOAST.extendStarted(10))
  })

  it('★ 静态池够量：AI 一次都不问（省一次花钱的调用 —— 这是接线之外的第一道省钱闸）', async () => {
    const h = aiHarness(aiReply(4))
    const { deps, entry } = fixtures(h.ai)
    const quiz = useQuizStore()
    const { startExtend } = useExtendStarter()
    // 池子 6 道 ≥ 要的 5 道
    await startExtend(entry, 5, deps)

    expect(h.inputs).toHaveLength(0)
    expect(quiz.session!.questions).toHaveLength(5)
    expect(toasts.at(-1)?.text).toBe(TOAST.extendStarted(5))
  })

  it('没配 Key：根本不问（"没配"不是失败，是没开这个功能），静默出静态卷', async () => {
    const h = aiHarness(aiReply(4), { hasKey: false })
    const { deps, entry } = fixtures(h.ai)
    const quiz = useQuizStore()
    const { startExtend } = useExtendStarter()
    await startExtend(entry, 10, deps)

    expect(h.inputs).toHaveLength(0)
    expect(quiz.session!.questions).toHaveLength(6)
    expect(toasts.at(-1)?.text).toBe(TOAST.extendShort(6))
  })

  it('★ 总开关关着（即使 Key 配好了）：一次都不问，静默出静态卷', async () => {
    // 默认就是关的。用户没主动授权之前，任何一次补题都不许花他的 Token。
    const h = aiHarness(aiReply(4), { hasKey: true, dynamicEnabled: false })
    const { deps, entry } = fixtures(h.ai)
    const quiz = useQuizStore()
    const { startExtend } = useExtendStarter()
    await startExtend(entry, 10, deps)

    expect(h.inputs).toHaveLength(0)
    expect(quiz.session!.questions).toHaveLength(6)
    expect(toasts.at(-1)?.text).toBe(TOAST.extendShort(6))
  })

  it('★ AI 失败（断网/限流）：静默退回静态池、如实少出 —— 只发"只有 N 道"那一条，不发错误提示', async () => {
    const h = aiHarness({ ok: false, reason: 'offline' })
    const { deps, entry } = fixtures(h.ai)
    const quiz = useQuizStore()
    const { startExtend } = useExtendStarter()
    await startExtend(entry, 10, deps)

    expect(quiz.session!.questions).toHaveLength(6)
    expect(h.inputs).toHaveLength(1) // 问过了，只是没答上来
    expect(toasts).toHaveLength(1)
    expect(toasts.at(-1)?.text).toBe(TOAST.extendShort(6))
  })

  it('★ 静态池为空也能靠 AI 开卷（"这一课没别的题"正是 AI 补题最该顶上的场景）', async () => {
    const only = lesson('c-stage1-01', [choice('q1')], 'c')
    const { entry } = fixtures()
    const h = aiHarness(aiReply(5))
    const deps: ExtendDeps = {
      lessonOf: (id) => (id === 'c-stage1-01' ? only : undefined),
      index: buildQuestionIndex([only]),
      findBuiltIn: (lessonId, qid) =>
        lessonId === 'c-stage1-01' ? (only.questions.find((q) => q.id === qid) ?? null) : null,
      ai: h.ai
    }
    const quiz = useQuizStore()
    const { startExtend } = useExtendStarter()
    await startExtend(entry, 5, deps)

    const s = quiz.session!
    expect(s.questions).toHaveLength(5)
    for (const k of s.keys) expect(k.startsWith('c-stage1-01:ai-')).toBe(true)
    expect(toasts.at(-1)?.text).toBe(TOAST.extendStarted(5))
  })

  it('静态池空、AI 也交白卷（ok 但零条）→ 照旧"没题可延展"，不开空卷', async () => {
    const only = lesson('c-stage1-01', [choice('q1')], 'c')
    const { entry } = fixtures()
    const h = aiHarness(aiReply(0))
    const deps: ExtendDeps = {
      lessonOf: (id) => (id === 'c-stage1-01' ? only : undefined),
      index: buildQuestionIndex([only]),
      findBuiltIn: (lessonId, qid) =>
        lessonId === 'c-stage1-01' ? (only.questions.find((q) => q.id === qid) ?? null) : null,
      ai: h.ai
    }
    const quiz = useQuizStore()
    const { startExtend } = useExtendStarter()
    await startExtend(entry, 5, deps)

    expect(quiz.session).toBeNull()
    expect(toasts.at(-1)?.text).toBe(TOAST.EXTEND_NONE)
  })

  it('★ 入参过得了结构化克隆：terms 是响应式代理也照样送达（漏了 toIpc 这条就红）', async () => {
    // 真环境里 content.bundle.glossary.terms 就是响应式代理（challenge.test.ts 有先例断言），
    // ipcRenderer.invoke 克隆不了它 —— 漏了 toIpc 的表现是"AI 永远不工作，一句报错都没有"
    const reactiveTerms = reactive<GlossaryTerm[]>(TERMS.map((t) => ({ ...t })))
    const h = aiHarness(aiReply(4), { terms: reactiveTerms })
    const { deps, entry } = fixtures(h.ai)
    const quiz = useQuizStore()
    const { startExtend } = useExtendStarter()
    await startExtend(entry, 10, deps)

    // 补上了 = 克隆没炸；顺带核对内容真的送到了
    expect(quiz.session!.questions).toHaveLength(10)
    expect(h.inputs[0].terms).toEqual(TERMS)
  })

  it('ask 自己抛（比如载荷形状坏了）：静默回退 + 留一行 console.error 给开发', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const h = aiHarness(aiReply(4), { throws: new Error('boom') })
      const { deps, entry } = fixtures(h.ai)
      const quiz = useQuizStore()
      const { startExtend } = useExtendStarter()
      await startExtend(entry, 10, deps)

      expect(quiz.session!.questions).toHaveLength(6)
      expect(toasts.at(-1)?.text).toBe(TOAST.extendShort(6))
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('★ 连点两次「开始」：第二次静默忽略，只问一次 AI、只开一张卷', async () => {
    // 现场：AI 补题最长等 180 秒，用户以为没点上又点一次。没有 in-flight 闸时，
    // 第二次请求会 abort 第一次（main 单飞），第一次拿 canceled 退回静态池并
    // startQuiz，第二次随后再 startQuiz —— 会话被整张覆盖。
    const ai = deferredAi()
    const { deps, entry } = fixtures(ai.ai)
    const quiz = useQuizStore()
    const { startExtend } = useExtendStarter()

    const first = startExtend(entry, 10, deps)
    const second = startExtend(entry, 10, deps) // 连点：应当当场静默返回
    expect(ai.inputs).toHaveLength(1)

    ai.release(aiReply(4))
    await Promise.all([first, second])

    expect(ai.inputs).toHaveLength(1)
    // 一张 10 道的卷（6 静态 + 4 AI），不是两张叠出来的 20 道或一张残缺卷
    expect(quiz.session!.questions).toHaveLength(10)
  })

  it('★ 等 AI 的时候用户开了别的卷子 → 迟到的延展卷不许覆盖它', async () => {
    const ai = deferredAi()
    const { deps, entry } = fixtures(ai.ai)
    const quiz = useQuizStore()
    const { startExtend } = useExtendStarter()

    const pending = startExtend(entry, 10, deps)
    await Promise.resolve() // 让 startExtend 走到「等 AI」那一步

    // 用户在等的这段时间里去开了练习卷
    quiz.startQuiz('lesson', 'c-stage1-02', [choice('other')], ['c-stage1-02:m1'])
    const other = quiz.session

    ai.release(aiReply(4))
    await pending

    // 会话还是那张练习卷 —— 延展卷迟到就丢掉，不许覆盖
    expect(quiz.session).toBe(other)
    expect(quiz.session!.questions).toHaveLength(1)
    expect(quiz.session!.questions[0].id).toBe('other')
  })
})
