/**
 * AI 出的题怎么收（shared/ai-question.ts）
 *
 * 【这个文件在守什么】
 * 守的是**「坏数据有没有被拦住」**。这里出去的每一道题都会直接喂给判分引擎，
 * 而 AI 是**会编的**：选项给三个、answer 写个越界的 7、填空题干里没有空、
 * 代码题的 lang 写成 "rust"。这些**都不会让程序崩**，只会让学员答对了被判错 ——
 * 而他会开始怀疑自己，不是怀疑程序。所以坏数据一律拦下。
 *
 * 另一半守的是**「好数据有没有被误杀」**：判太严会把能用的题一起丢掉，
 * 表现同样是「今天的挑战莫名其妙只有一道题」。所以每个拦截规则都要有
 * 一条「这种情况不该拦」的对照。
 *
 * ⚠️ 测试文件在 src/ 下但**不受文案闸门管辖**（walk() 会跳过 __tests__），
 * 所以这里可以随便写中文。
 */

import { describe, expect, it } from 'vitest'
import {
  aiQuestionId,
  MAX_AI_QUESTIONS,
  normalizeStem,
  parseAiQuestions,
  sameStem,
  type AiTopicRef
} from '../ai-question'
import { isAiQid } from '../question-key'

const TOPICS: AiTopicRef[] = [
  { lessonId: 'common-01', lessonTitle: '什么是编程？' },
  { lessonId: 'python-03', lessonTitle: '循环' }
]

const OPTS = { topics: TOPICS, dateKey: '2026-09-13' }

/** 一道**合法**的选择题。各条拦截用例都从它出发，只改坏一个字段 */
function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    topicIndex: 0,
    type: 'choice',
    stem: '题干甲',
    options: ['甲', '乙', '丙', '丁'],
    answer: 0,
    explanation: '解析甲',
    ...over
  }
}

function wrap(...qs: unknown[]): unknown {
  return { questions: qs }
}

function fill(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { topicIndex: 0, type: 'fill', stem: '答案是____。', answer: '循环', explanation: '解析', ...over }
}

function code(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    topicIndex: 0,
    type: 'code',
    lang: 'python',
    code: 'print(1 + 1)',
    stem: '这段代码输出什么？',
    answer: '2',
    explanation: '解析',
    ...over
  }
}

// ---------------------------------------------------------------- id

describe('aiQuestionId', () => {
  it('形状是 ai-<日期>-<序号>', () => {
    expect(aiQuestionId('2026-09-13', 1)).toBe('ai-2026-09-13-1')
    expect(aiQuestionId('2026-09-13', 12)).toBe('ai-2026-09-13-12')
  })

  it('**产生的 id 必须被 isAiQid 认出来** —— 这是和第 1 步那条决定的接头处', () => {
    // 认不出来的话，AI 题就会被当成内置题写进错题本，
    // 而它在任何一课里都找不到原样，「再练一次」永远消除不掉。
    // 这条断言把两个模块的口径钉在一起：谁改歪了，这里立刻红。
    for (let i = 1; i <= 5; i++) expect(isAiQid(aiQuestionId('2026-09-13', i))).toBe(true)
  })

  it('**绝不以 q 开头**（会和内置题号 q1..q7 撞车）', () => {
    expect(aiQuestionId('2026-09-13', 1).startsWith('q')).toBe(false)
  })
})

// ---------------------------------------------------------------- 正常路径

describe('parseAiQuestions：能用的题要原样收下', () => {
  it('解析里**引原话**不算指代选项 —— 那正是我们推荐的写法，不能误杀', () => {
    const r = parseAiQuestions(wrap(entry({ explanation: '「乙」说的是另一回事喵。' })), OPTS)
    expect(r.dropped).toBe(0)
    expect(r.items).toHaveLength(1)
  })

  it('三种题型各一道，全部通过', () => {
    const r = parseAiQuestions(wrap(entry(), fill(), code()), OPTS)
    expect(r.dropped).toBe(0)
    expect(r.items.map((i) => i.question.type)).toEqual(['choice', 'fill', 'code'])
  })

  it('id 按存活顺序从 1 连号', () => {
    const r = parseAiQuestions(wrap(entry(), fill(), code()), OPTS)
    expect(r.items.map((i) => i.question.id)).toEqual([
      'ai-2026-09-13-1',
      'ai-2026-09-13-2',
      'ai-2026-09-13-3'
    ])
  })

  it('每道题都绑上了宿主课 —— 错题本和课名全靠它', () => {
    const r = parseAiQuestions(wrap(entry({ topicIndex: 1 })), OPTS)
    expect(r.items[0].lessonId).toBe('python-03')
    expect(r.items[0].lessonTitle).toBe('循环')
  })

  it('字段原样透传（选项、答案下标、代码、语言）', () => {
    const r = parseAiQuestions(wrap(entry({ answer: 2 }), code({ lang: 'java' })), OPTS)
    const c = r.items[0].question
    const k = r.items[1].question
    expect(c.type === 'choice' && c.options).toEqual(['甲', '乙', '丙', '丁'])
    expect(c.type === 'choice' && c.answer).toBe(2)
    expect(k.type === 'code' && k.lang).toBe('java')
    expect(k.type === 'code' && k.code).toBe('print(1 + 1)')
  })

  it('accept 是选填的：写了就带上，不写就不该有那个字段', () => {
    const withAccept = parseAiQuestions(wrap(fill({ accept: ['招式', '技能/招式'] })), OPTS)
    const without = parseAiQuestions(wrap(fill()), OPTS)
    const a = withAccept.items[0].question
    const b = without.items[0].question
    expect(a.type === 'fill' && a.accept).toEqual(['招式', '技能/招式'])
    expect('accept' in b).toBe(false)
  })

  it('题干和解析两端的空白会被去掉（AI 很爱在前后加换行）', () => {
    const r = parseAiQuestions(wrap(entry({ stem: '  题干甲\n', explanation: '\n 解析甲 ' })), OPTS)
    expect(r.items[0].question.stem).toBe('题干甲')
    expect(r.items[0].question.explanation).toBe('解析甲')
  })
})

// ---------------------------------------------------------------- 整体坏掉

describe('parseAiQuestions：整个响应就不是个东西', () => {
  it('不是对象', () => {
    expect(parseAiQuestions(null, OPTS).reasons).toEqual(['not-an-object'])
    expect(parseAiQuestions('喵', OPTS).reasons).toEqual(['not-an-object'])
    expect(parseAiQuestions([1, 2], OPTS).reasons).toEqual(['not-an-object'])
  })

  it('没有 questions 数组（模型跑题了，吐了一段散文）', () => {
    const r = parseAiQuestions({ answer: '喵喵喵' }, OPTS)
    expect(r.items).toEqual([])
    expect(r.reasons).toEqual(['no-questions-array'])
  })

  it('questions 是空数组：合法，只是没有题 —— 不算坏数据', () => {
    const r = parseAiQuestions(wrap(), OPTS)
    expect(r.items).toEqual([])
    expect(r.dropped).toBe(0)
  })
})

// ---------------------------------------------------------------- 逐条拦截

describe('parseAiQuestions：坏数据逐条拦下', () => {
  /** 每一条都「只坏一个字段」，不然分不清是被哪条规则拦的 */
  const BAD: [string, unknown][] = [
    // 形状 / 归属
    ['not-an-object', '这不是对象'],
    ['bad-type', entry({ type: 'essay' })],
    ['bad-type', entry({ type: undefined })],
    /*
     * ⚠️ 下面三条**不是"还没支持"，是"故意不收"**（理由逐条写在 ai-question.ts 的
     * 白名单注释里）。它们必须在这里，否则"故意不收"就只是一句话：
     * 哪天有人顺手把白名单放宽，测试全绿，而 AI 出的 `codefix` 会带着一个
     * **没人验证过的 `expectedOutput`** 直接推到学员面前 —— 那串"标准答案"
     * 一旦写错，这道题他永远做不对，而界面还会理直气壮地显示「应该是：xxx」。
     *
     * 注意这三条**除 `type` 外全是合法的 choice 载荷**：能拦下它们，就证明
     * 拦的是"题型"本身，而不是"顺便被别的规则拦了"。
     */
    ['bad-type', entry({ type: 'codefill' })],
    ['bad-type', entry({ type: 'codefix' })],
    ['bad-type', entry({ type: 'codewrite' })],
    ['bad-topic-index', entry({ topicIndex: 2 })], // 越界（只有 0 和 1）
    ['bad-topic-index', entry({ topicIndex: -1 })],
    ['bad-topic-index', entry({ topicIndex: 0.5 })],
    ['bad-topic-index', entry({ topicIndex: '0' })],
    ['bad-topic-index', entry({ topicIndex: undefined })],
    // 题干 / 解析
    ['empty-stem', entry({ stem: '   ' })],
    ['empty-stem', entry({ stem: 42 })],
    ['stem-too-long', entry({ stem: '喵'.repeat(201) })],
    ['empty-explanation', entry({ explanation: '  ' })],
    ['empty-explanation', entry({ explanation: undefined })],
    ['explanation-too-long', entry({ explanation: '喵'.repeat(1001) })],
    // 选择题
    ['choice-needs-exactly-4-options', entry({ options: ['甲', '乙', '丙'] })],
    ['choice-needs-exactly-4-options', entry({ options: ['甲', '乙', '丙', '丁', '戊'] })],
    ['choice-needs-exactly-4-options', entry({ options: '甲乙丙丁' })],
    ['choice-empty-option', entry({ options: ['甲', '  ', '丙', '丁'] })],
    ['choice-duplicate-options', entry({ options: ['甲', '甲', '丙', '丁'] })],
    ['choice-lazy-option', entry({ options: ['甲', '乙', '丙', '以上都不对'] })],
    ['choice-lazy-option', entry({ options: ['甲', '乙', '丙', '全都对'] })],
    ['choice-bad-answer-index', entry({ answer: 4 })],
    ['choice-bad-answer-index', entry({ answer: -1 })],
    ['choice-bad-answer-index', entry({ answer: '0' })],
    ['choice-bad-answer-index', entry({ answer: 1.5 })],
    ['choice-bad-answer-index', entry({ answer: undefined })],
    // 解析按字母 / 位置指代选项（组卷会洗选项顺序，这种解析洗过就对不上了）
    ['choice-explanation-refs-option', entry({ explanation: 'D 说的顺序与牵连才是正解喵。' })],
    ['choice-explanation-refs-option', entry({ explanation: '第二个选项写得不对喵。' })],
    ['choice-option-refs-position', entry({ options: ['上面两件都归它管', '乙', '丙', '丁'] })],
    // 填空题
    ['fill-no-blank', fill({ stem: '循环是什么？' })],
    ['empty-answer', fill({ answer: '   ' })],
    ['accept-not-array', fill({ accept: '招式' })],
    ['accept-empty-item', fill({ accept: ['招式', ''] })],
    // 代码题
    ['code-bad-lang', code({ lang: 'rust' })],
    ['code-bad-lang', code({ lang: 'Python' })], // 大小写敏感，只有小写四种
    ['code-bad-lang', code({ lang: undefined })],
    ['code-empty-code', code({ code: '   ' })],
    ['empty-answer', code({ answer: '' })]
  ]

  it.each(BAD)('拦下 %s', (reason, bad) => {
    const r = parseAiQuestions(wrap(bad), OPTS)
    expect(r.items).toEqual([])
    expect(r.reasons).toEqual([reason])
    expect(r.dropped).toBe(1)
  })

  it('**坏的那道被丢掉，好的照样留下** —— 这是不整批丢的理由', () => {
    // 题库只有 7 道题。整批丢的话，AI 飘一次那天就一道 AI 题都没有了
    const r = parseAiQuestions(
      wrap(entry({ stem: '好题一' }), entry({ stem: '坏题', answer: 99 }), entry({ stem: '好题二' })),
      OPTS
    )
    expect(r.items.map((i) => i.question.stem)).toEqual(['好题一', '好题二'])
    expect(r.dropped).toBe(1)
    expect(r.reasons).toEqual(['choice-bad-answer-index'])
  })

  it('**id 不跳号**：坏题没占号，第二道好题是 2 不是 3', () => {
    const r = parseAiQuestions(wrap(entry({ answer: 99 }), entry({ stem: '好题' })), OPTS)
    expect(r.items[0].question.id).toBe('ai-2026-09-13-1')
  })

  it('reasons 的条数永远等于 dropped', () => {
    const r = parseAiQuestions(wrap(entry({ answer: 99 }), entry({ type: 'x' }), entry({ stem: '好' })), OPTS)
    expect(r.reasons).toHaveLength(r.dropped)
  })
})

// ---------------------------------------------------------------- 批内去重与上限

describe('parseAiQuestions：同一批里的重复和超量', () => {
  it('题干撞车只留先来的那道', () => {
    const r = parseAiQuestions(wrap(entry({ stem: '同一道题' }), entry({ stem: '同一道题' })), OPTS)
    expect(r.items).toHaveLength(1)
    expect(r.reasons).toEqual(['duplicate-stem'])
  })

  it('只差标点和空格也算撞车', () => {
    const r = parseAiQuestions(wrap(entry({ stem: '今天下雨了。' }), entry({ stem: '今天 下雨了' })), OPTS)
    expect(r.items).toHaveLength(1)
  })

  it('超过上限的部分全部丢掉，且说明原因', () => {
    const many = Array.from({ length: MAX_AI_QUESTIONS + 5 }, (_, i) => entry({ stem: `第${i}题` }))
    const r = parseAiQuestions(wrap(...many), OPTS)
    expect(r.items).toHaveLength(MAX_AI_QUESTIONS)
    expect(r.dropped).toBe(5)
    expect(new Set(r.reasons)).toEqual(new Set(['too-many']))
  })

  it('**正好的上限不丢**（差一错误最爱出在这儿）', () => {
    const many = Array.from({ length: MAX_AI_QUESTIONS }, (_, i) => entry({ stem: `第${i}题` }))
    expect(parseAiQuestions(wrap(...many), OPTS).dropped).toBe(0)
  })
})

// ---------------------------------------------------------------- 去重用的归一化

describe('normalizeStem / sameStem', () => {
  it('标点和空白不影响判定', () => {
    expect(sameStem('今天下雨了。', '今天下雨了')).toBe(true)
    expect(sameStem('今天 下雨了', '今天下雨了')).toBe(true)
    expect(sameStem('LOOP 是什么', 'loop是什么')).toBe(true)
  })

  it('**运算符要留住** —— 去掉了会让两道真不一样的题撞成一道', () => {
    // 假撞车的代价是凭空少一道题，而且没有任何迹象
    expect(sameStem('1+1 等于几', '1-1 等于几')).toBe(false)
    expect(normalizeStem('1+1')).not.toBe(normalizeStem('1-1'))
  })

  it('内容不同就是不同', () => {
    expect(sameStem('什么是编程', '什么是循环')).toBe(false)
  })

  it('空串互相相等（归一化后都是空）—— 调用方不该拿空串来比', () => {
    expect(sameStem('', '。。')).toBe(true)
  })
})
