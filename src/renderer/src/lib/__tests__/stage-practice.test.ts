/**
 * 阶段 / 整门综合练习的入口（lib/stage-practice.ts）
 *
 * 【这个文件在守什么】
 * 组卷的配比在 `shared/__tests__/stage-paper.test.ts`（那边有真内容包回归网）。
 * 这里守的是**入口**那一层 —— 也就是"池子怎么筛、键怎么配、会话怎么开"，
 * 三件事全都是**静默型**的错：
 *   · 整门卷按 stage 筛了 → 静默变成"这门语言的阶段一"，标题还写着整门；
 *   · 不显式传 keys → `startQuiz` 拼出 `__stage__:q1` 这种垃圾键，
 *     答错了往错题本里灌死条目（同型 bug 在 quiz.ts 的 restart 注释里记着）；
 *   · 拿不到本体的题没剔掉 → 卷子上多一个点开是"题目已被移走"的格子，
 *     而确认框上写着"这一卷 10 道题"。
 *
 * 【为什么不用真内容包】
 * 这里要验的是**筛法和配对**，不是"今天的内容长什么样"（那件事归 stage-paper
 * 的真内容包回归网）。喂一份二三十条的手工索引，断言就能写成确定的形状，
 * 也不会因为哪天主人补了几节课而红 —— 那种红没人分得清是谁的错。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { buildPaperDraft, useStagePaperFlow, useStageStarter, type StagePaperDeps } from '../stage-practice'
import { useQuizStore } from '../../stores/quiz'
import { stubMiai } from '../../stores/__tests__/miai-stub'
import { parseQuestionKey, questionKey } from '../../../../shared/question-key'
import { LANG_PAPER_SIZE, STAGE_PAPER_SIZE } from '../../../../shared/stage-paper'
import type { QuestionIndexItem } from '../../../../shared/question-index'
import type { Difficulty, LangOfCode, Question, Stage } from '../../../../shared/types'

/** 一节课的题：`L1:s1:q1` … 课号是 `L1:s1`（故意带冒号，试 parseQuestionKey 那条路） */
function cell(
  lang: LangOfCode,
  stage: Stage,
  lessons: number,
  per: number,
  diffs: readonly Difficulty[]
): QuestionIndexItem[] {
  const out: QuestionIndexItem[] = []
  let k = 0
  for (let l = 1; l <= lessons; l++) {
    for (let i = 1; i <= per; i++) {
      const qid = `q${i}`
      const lessonId = `${lang}-s${stage}-${String(l).padStart(2, '0')}`
      out.push({
        key: questionKey(lessonId, qid),
        lessonId,
        lang,
        stage,
        type: 'choice',
        difficulty: diffs[k++ % diffs.length],
        tags: [],
        stem: `${lessonId} 的第 ${i} 题`
      })
    }
  }
  return out
}

/**
 * 假内容包：`findQuestion` 现场造一道与索引条目对得上的选择题。
 *
 * `blind` 里的键**造不出来**（返回 null）—— 模拟"内容改过，这道题的键已经
 * 不在内容包里了"。这是唯一能让解析失败的情形，而它必须被验到：
 * 那一格如果留在卷子上，用户会看到一道打不开的题。
 */
function fakeContent(index: QuestionIndexItem[], blind: readonly string[] = []): StagePaperDeps {
  const blocked = new Set(blind)
  return {
    index,
    findQuestion: (it) => {
      if (blocked.has(it.key)) return null
      const { qid } = parseQuestionKey(it.key)
      const q: Question = {
        id: qid,
        type: 'choice',
        stem: it.stem,
        options: ['甲', '乙'],
        answer: 0,
        explanation: '解析'
      }
      return q
    }
  }
}

const STAGE1 = cell('c', 1, 15, 7, ['easy', 'medium', 'hard', 'medium'])
const STAGE2 = cell('c', 2, 15, 7, ['easy', 'hard', 'medium', 'hard'])

beforeEach(() => {
  setActivePinia(createPinia())
  stubMiai()
})

describe('buildPaperDraft：池子怎么筛', () => {
  it('阶段卷只拿这一阶段的题', () => {
    const deps = fakeContent([...STAGE1, ...STAGE2])
    const draft = buildPaperDraft('stage', 'c', 1, deps)!
    expect(draft.questions).toHaveLength(STAGE_PAPER_SIZE)
    for (const it of draft.keys.map(parseQuestionKey)) {
      expect(it.lessonId, `${it.lessonId} 是阶段二的课，不该出现在阶段一卷上`).toContain('-s1-')
    }
  })

  it('★ 整门卷**不按阶段筛** —— 池子里只有阶段二的题时照样开得出卷', () => {
    /*
     * 这条防的是 `{ lang, stage: stage ?? 1 }` 那类兜底：它把整门卷静默变成
     * "这门语言的阶段一"，而按钮上、标题里写的都是「整门」。
     *
     * 判据刻意选成**结构性的**（池子里根本没有阶段一的题 → 按阶段一筛就会得到
     * 空池 → `null`），而不是"抽出来的题里两种阶段都出现过"——
     * 后者要靠随机凑巧，是一个"大部分时候会绿"的假网。
     */
    const deps = fakeContent(STAGE2)
    const draft = buildPaperDraft('lang', 'c', undefined, deps)
    expect(draft, '整门卷拿阶段一的池子去筛了').not.toBe(null)
    expect(draft!.questions).toHaveLength(LANG_PAPER_SIZE)
    for (const k of draft!.keys) expect(k).toContain('-s2-')
  })

  it('别的语言的题一道都不进来', () => {
    const deps = fakeContent([...STAGE1, ...cell('python', 1, 15, 7, ['easy', 'medium', 'hard'])])
    const draft = buildPaperDraft('stage', 'c', 1, deps)!
    for (const k of draft.keys) expect(k.startsWith('c-')).toBe(true)
  })

  it('★ 池子筛选**不排除挑战题**（阶段卷是它允许出现的三处之一）', () => {
    /*
     * 池子里的硬题**清一色是挑战题** —— 这样"卷上出现了挑战题"就不再靠运气：
     * 硬题桶里只有挑战，抽到硬题就必然是挑战。（混着普通困难题的话，
     * 洗牌洗出 4 道普通困难题也完全正常，那条断言会变成一个"大部分时候绿"的假网。）
     */
    const deps = fakeContent(cell('c', 1, 15, 7, ['easy', 'medium', 'challenge']))
    const draft = buildPaperDraft('stage', 'c', 1, deps)!
    expect(draft.stats.hard, '前提：这一卷要抽硬题').toBeGreaterThan(0)
    expect(draft.stats.challenge, '挑战题被池子筛掉了').toBe(draft.stats.hard)
  })
})

describe('buildPaperDraft：键与题目本体必须配得上对', () => {
  it('★ 每个键都是**它自己那节课**的课号，不是哨兵', () => {
    const deps = fakeContent([...STAGE1, ...STAGE2])
    const draft = buildPaperDraft('stage', 'c', 1, deps)!
    draft.keys.forEach((key, i) => {
      expect(key.startsWith('__'), `${key} 是哨兵键`).toBe(false)
      const { lessonId, qid } = parseQuestionKey(key)
      expect(lessonId.startsWith('__'), `${key} 用了哨兵课号`).toBe(false)
      // 题号也对得上：卷上第 i 道的题 id 就是键里那个 qid
      expect(qid).toBe(draft.questions[i].id)
      expect(draft.questions[i].stem, '键指到别的题上去了').toContain(lessonId)
    })
  })

  it('★ 键和题目**一一对应且不重复**（洗牌只洗一半会整体错位）', () => {
    const deps = fakeContent([...STAGE1, ...STAGE2])
    const draft = buildPaperDraft('stage', 'c', 1, deps)!
    expect(new Set(draft.keys).size).toBe(draft.keys.length)
    expect(new Set(draft.questions.map((q) => q.stem)).size).toBe(draft.questions.length)
  })

  it('★ 拿不到本体的题**不占名额**：剔掉之后照样抽满，卷上没有打不开的格子', () => {
    const blind = STAGE1.slice(0, 40).map((it) => it.key)
    const deps = fakeContent([...STAGE1, ...STAGE2], blind)
    const draft = buildPaperDraft('stage', 'c', 1, deps)!
    expect(draft.questions).toHaveLength(STAGE_PAPER_SIZE)
    for (const k of draft.keys) expect(blind, `${k} 明明拿不到本体`).not.toContain(k)
    expect(draft.questions.every((q) => q !== null)).toBe(true)
  })

  it('池子全空 → **null**，不摆一张空卷到用户面前', () => {
    expect(buildPaperDraft('stage', 'c', 1, fakeContent([]))).toBe(null)
  })

  it('题全拿不到本体 → 同样是 null（不是"开一张空卷"）', () => {
    const deps = fakeContent(STAGE1, STAGE1.map((it) => it.key))
    expect(buildPaperDraft('stage', 'c', 1, deps)).toBe(null)
  })

  it('标题：阶段卷带阶段名，整门卷只有语言名', () => {
    const deps = fakeContent([...STAGE1, ...STAGE2])
    expect(buildPaperDraft('stage', 'c', 1, deps)!.label).toContain('·')
    expect(buildPaperDraft('lang', 'c', undefined, deps)!.label).not.toContain('·')
  })

  it('随机的部分可注入：同一串随机数给同一张卷', () => {
    const deps: StagePaperDeps = { ...fakeContent([...STAGE1, ...STAGE2]), rng: () => 0.42 }
    const a = buildPaperDraft('stage', 'c', 1, deps)!.keys
    const b = buildPaperDraft('stage', 'c', 1, deps)!.keys
    expect(a).toEqual(b)
  })
})

describe('start：会话开出来长什么样', () => {
  it('★ mode 与哨兵课号对得上，keys **逐条**用传进来的那份', () => {
    const quiz = useQuizStore()
    const deps = fakeContent([...STAGE1, ...STAGE2])
    const draft = buildPaperDraft('stage', 'c', 1, deps)!
    const n = useStageStarter().start(draft)

    expect(n).toBe(STAGE_PAPER_SIZE)
    const s = quiz.session!
    expect(s.mode).toBe('stage')
    expect(s.lessonId, '哨兵课号 —— 它不是一门真的课').toBe('__stage__')
    // ⚠️ 这一条就是那个静默 bug 的网：不传 keys 的话这里会是 `__stage__:q1` 一排
    expect(s.keys).toEqual(draft.keys)
    expect(s.questions.map((q) => q.stem)).toEqual(draft.questions.map((q) => q.stem))
  })

  it('整门卷开出来的 mode 是 lang、哨兵是 __lang__', () => {
    const quiz = useQuizStore()
    const deps = fakeContent([...STAGE1, ...STAGE2])
    useStageStarter().start(buildPaperDraft('lang', 'c', undefined, deps)!)
    expect(quiz.session!.mode).toBe('lang')
    expect(quiz.session!.lessonId).toBe('__lang__')
  })

  it('★ 会话里的键**没有一个是哨兵键** —— 错题本靠它们认题', () => {
    const quiz = useQuizStore()
    const deps = fakeContent([...STAGE1, ...STAGE2])
    useStageStarter().start(buildPaperDraft('stage', 'c', 1, deps)!)
    for (const k of quiz.session!.keys) {
      expect(parseQuestionKey(k).lessonId.startsWith('__'), `${k} 会让错题本多一条死记录`).toBe(false)
    }
  })
})

describe('useStagePaperFlow：确认框那一步（练习页 + 侧栏共用）', () => {
  it('组得出卷：开框，待确认的就是刚组的那一卷', () => {
    const flow = useStagePaperFlow(fakeContent([...STAGE1]))
    expect(flow.paperOpen.value).toBe(false)
    flow.openPaper('stage', 'c', 1)
    expect(flow.paperOpen.value).toBe(true)
    expect(flow.pendingPaper.value?.kind).toBe('stage')
    expect(flow.pendingPaper.value?.lang).toBe('c')
    expect(flow.pendingPaper.value?.stage).toBe(1)
  })

  it('★ 组不出卷 → **框不开**（空卷绝不摆到用户面前，这是搬走时保留的隐式约定之一）', () => {
    const flow = useStagePaperFlow(fakeContent([]))
    flow.openPaper('stage', 'c', 1)
    expect(flow.paperOpen.value).toBe(false)
    expect(flow.pendingPaper.value).toBe(null)
  })

  it('★ 确认开卷：**先关框、再开局**（开局那一刻框已经是关的）', () => {
    const quiz = useQuizStore()
    const flow = useStagePaperFlow(fakeContent([...STAGE1]))
    flow.openPaper('stage', 'c', 1)
    const draft = flow.pendingPaper.value!

    // 在「开局」真正发生的那一刻偷看一眼框 —— 两句话顺序反了的话，
    // 这里读到的是 true（MiModal 的退场膜会盖在新开的答题遮罩上面）。
    const orig = quiz.startQuiz
    let openWhenStarted: boolean | null = null
    quiz.startQuiz = (...args) => {
      openWhenStarted = flow.paperOpen.value
      return orig(...args)
    }

    flow.startPaper(draft)
    expect(openWhenStarted, '开局时框还开着 —— startPaper 里两句话的顺序反了').toBe(false)
    expect(flow.paperOpen.value).toBe(false)
    expect(quiz.session?.mode).toBe('stage')
    expect(quiz.session?.keys).toEqual(draft.keys)
  })

  it('★ 每次调用各拿一份独立闭包 —— 两个入口同时活着时状态互不串', () => {
    /*
     * 侧栏是常驻组件、练习页切换页签也在同一棵树上，两处**同时活着**。
     * 这条防的是"图省事做成模块级单例"：那样侧栏打开确认框时，
     * 练习页那边也会"开着"——不报错，只是框出现在不该出现的地方。
     */
    const a = useStagePaperFlow(fakeContent([...STAGE1]))
    const b = useStagePaperFlow(fakeContent([...STAGE1]))
    a.openPaper('stage', 'c', 1)
    expect(a.paperOpen.value).toBe(true)
    expect(b.paperOpen.value, 'a 开的框串到 b 上了（module 级单例）').toBe(false)
    expect(b.pendingPaper.value).toBe(null)

    // 反过来也要成立：b 开一卷整门的，a 手里还是它自己那一卷
    b.openPaper('lang', 'c')
    expect(b.pendingPaper.value?.kind).toBe('lang')
    expect(a.pendingPaper.value?.kind).toBe('stage')
  })
})
