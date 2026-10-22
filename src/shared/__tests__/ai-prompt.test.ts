/**
 * 提示词组装（shared/ai-prompt.ts）
 *
 * 【这个文件在守什么】
 * 守的不是「拼出来的字符串长啥样」——那改一行文案就得改测试，没人受得了。
 * 守的是三件**一旦坏掉、表现完全看不出来**的事：
 *   1. **术语表真的进了提示词**。漏了的话 AI 照样出题、照样说得头头是道，
 *      只是满口「变量」「函数」——学员一脸懵，而日志里一个错都没有。
 *   2. **截断两头都留**。只留头，Python 的 `NameError` 没了；只留尾，
 *      C 的出错行号没了。两种都是「AI 讲得挺像样，但没说到点上」。
 *   3. **system 段与本次考什么无关**。它固定，DeepSeek 的前缀缓存才命中，
 *      用户的钱才花得少。哪天有人顺手把知识点插进 system，这条会拦住。
 */

import { describe, expect, it } from 'vitest'
import {
  buildExplainPrompt,
  buildQuestionsPrompt,
  ERROR_MAX_LINES,
  MAX_STYLE_STEMS_PER_TOPIC,
  pickStyleStems,
  renderGlossary,
  truncateError,
  truncateLines
} from '../ai-prompt'
import type { GlossaryTerm } from '../types'

/** 术语表样本：覆盖「有例句 / 无例句 / 多个原术语」三种真实形状 */
const TERMS: GlossaryTerm[] = [
  {
    key: 'variable',
    originals: ['变量'],
    cat: '小鱼干仓库',
    example: '变量就是个贴了名字的小鱼干仓库喵！'
  },
  {
    key: 'template',
    originals: ['模板', '泛型'],
    cat: '会量体裁衣的图纸',
    example: '模板就是会量体裁衣的图纸喵～'
  },
  {
    key: 'loop',
    originals: ['循环'],
    cat: '绕鱼干跑圈',
    example: '' // 没例句的退路
  }
]

// ---------------------------------------------------------------- 截断

/** n 行，内容形如 L1 / L2 / …，方便数行 */
const lines = (n: number): string => Array.from({ length: n }, (_, i) => `L${i + 1}`).join('\n')

describe('truncateLines / truncateError：按行截断', () => {
  it('没超上限就原样返回，一个字都不动', () => {
    expect(truncateLines(lines(10), 20, 12)).toBe(lines(10))
  })

  it('**正好等于上限**也原样返回（边界不插省略号）', () => {
    // 差一错误最容易出在这儿：写成 < 的话，20 行的报错会莫名其妙被截一次
    expect(truncateLines(lines(20), 20, 12)).toBe(lines(20))
    expect(truncateError(lines(ERROR_MAX_LINES))).toBe(lines(ERROR_MAX_LINES))
  })

  it('超一行就截：省略中间，两头都在，省略行数如实写', () => {
    const got = truncateError(lines(21))
    const out = got.split('\n')
    // 头 12 行 + 省略标记 1 行 + 尾 8 行 = 21 行，但**报错原文**只剩 20 行
    expect(out.slice(0, 12)).toEqual(Array.from({ length: 12 }, (_, i) => `L${i + 1}`))
    expect(out.slice(-8)).toEqual(Array.from({ length: 8 }, (_, i) => `L${21 - 8 + i + 1}`))
    expect(got).toContain('省略')
    expect(got).toContain('1 行') // 中间砍掉的正好是 L13
    expect(got).not.toContain('L13')
  })

  it('**两头各留一个真实案例的要害**', () => {
    // 这条是核心：编译错的要害在开头，运行错的要害在结尾
    const gccError = "main.c:3:5: error: expected ';' before '}' token"
    const pyError = "NameError: name 'x' is not defined"
    const raw = [gccError, ...Array.from({ length: 28 }, () => '    ^~~~'), pyError].join('\n')
    const got = truncateError(raw)
    expect(got).toContain(gccError) // 头留住了：知道是哪一行
    expect(got).toContain(pyError) // 尾留住了：知道是什么错
  })

  it('CRLF 换行也当普通换行数（Windows 上拉出来的报错都是 \\r\\n）', () => {
    const raw = Array.from({ length: 30 }, (_, i) => `L${i + 1}`).join('\r\n')
    const got = truncateError(raw)
    expect(got).not.toContain('\r')
    expect(got.split('\n').length).toBe(ERROR_MAX_LINES + 1)
  })

  it('空 / 只有空白：返回空串，不返回一行空格', () => {
    expect(truncateError('')).toBe('')
    expect(truncateError('   \n\n  ')).toBe('')
  })
})

// ---------------------------------------------------------------- 术语表渲染

describe('renderGlossary：术语表怎么落进提示词', () => {
  it('一条一行，原术语和猫咪叫法都在', () => {
    const got = renderGlossary(TERMS)
    expect(got.split('\n')).toHaveLength(3)
    expect(got).toContain('变量')
    expect(got).toContain('小鱼干仓库')
  })

  it('多个原术语并排写出（模板 / 泛型）', () => {
    expect(renderGlossary(TERMS)).toContain('模板 / 泛型')
  })

  it('没有例句的术语**不会留下一根空尾巴**', () => {
    // 退路分支存在的唯一理由：不然会渲染出「（例：）」，模型会当成「例句是空的」去瞎猜
    const line = renderGlossary(TERMS).split('\n')[2]
    expect(line).toContain('循环')
    expect(line).toContain('绕鱼干跑圈')
    expect(line).not.toContain('例')
  })
})

// ---------------------------------------------------------------- 出题提示词

const TOPICS = [
  { lessonId: 'common-01', title: '什么是编程？', tags: ['入门', '术语'], stems: ['谁负责翻译？'] },
  { lessonId: 'python-03', title: '循环', tags: [], stems: [] }
]

const questionsPrompt = (count = 3) =>
  buildQuestionsPrompt({ topics: TOPICS, count, terms: TERMS })

describe('buildQuestionsPrompt：system 段', () => {
  it('人格与语气在里面', () => {
    expect(questionsPrompt().system).toContain('喵')
    expect(questionsPrompt().system).toContain('本喵')
  })

  it('**术语表全文进去了**（这是 AI 会不会说猫咪话的关键）', () => {
    const sys = questionsPrompt().system
    expect(sys).toContain('小鱼干仓库')
    expect(sys).toContain('绕鱼干跑圈')
    expect(sys).toContain('会量体裁衣的图纸')
  })

  it('术语自创禁令和「翻译官喵」的归属都写明了', () => {
    const sys = questionsPrompt().system
    expect(sys).toContain('不许自创')
    expect(sys).toContain('翻译官喵')
  })

  it('语气范例是内置真题的原文', () => {
    expect(questionsPrompt().system).toContain('绕鱼干跑圈')
    expect(questionsPrompt().system).toContain('引号本身不输出喵')
  })

  it('JSON 模式的硬前提：提示词里必须出现 "json" 字样', () => {
    // DeepSeek 的 response_format=json_object 要求 prompt 里有 json 这个词，
    // 少了它接口直接报错。这条是防「哪天顺手把格式段删了」
    expect(questionsPrompt().system.toLowerCase()).toContain('json')
  })

  it('输出格式给了三种题型各一个样例', () => {
    const sys = questionsPrompt().system
    expect(sys).toContain('"type": "choice"')
    expect(sys).toContain('"type": "fill"')
    expect(sys).toContain('"type": "code"')
  })

  it('**system 和这次考哪几课无关** —— 它必须固定，前缀缓存才命中', () => {
    const a = buildQuestionsPrompt({ topics: TOPICS, count: 3, terms: TERMS })
    const b = buildQuestionsPrompt({ topics: [TOPICS[0]], count: 9, terms: TERMS })
    expect(a.system).toBe(b.system)
    expect(a.user).not.toBe(b.user)
  })

  it('换了术语表，system 就必须跟着变（不能把表写死）', () => {
    const a = buildQuestionsPrompt({ topics: TOPICS, count: 3, terms: TERMS })
    const b = buildQuestionsPrompt({ topics: TOPICS, count: 3, terms: [] })
    expect(a.system).not.toBe(b.system)
  })
})

describe('buildQuestionsPrompt：user 段', () => {
  it('每课的编号、课号、标题都在', () => {
    const user = questionsPrompt().user
    expect(user).toContain('[0] common-01 《什么是编程？》')
    expect(user).toContain('[1] python-03 《循环》')
  })

  it('编号从 0 起且连续 —— AI 要照着它填 topicIndex', () => {
    const user = questionsPrompt().user
    expect(user).toContain('[0]')
    expect(user).toContain('[1]')
    expect(user).not.toContain('[2]')
  })

  it('有标签就写标签', () => {
    expect(questionsPrompt().user).toContain('入门 / 术语')
  })

  it('**没有标签就整行不写**，不留一个光秃秃的「标签：」', () => {
    const user = questionsPrompt().user
    const block = user.slice(user.indexOf('[1] python-03'))
    expect(block.split('\n')[1]).not.toContain('标签')
  })

  it('这一课出过的题干列出来了（防重复 + 当风格样例）', () => {
    expect(questionsPrompt().user).toContain('谁负责翻译？')
  })

  it('**没出过题就不列**，写一句「还没出过」顶上', () => {
    const user = questionsPrompt().user
    const block = user.slice(user.indexOf('[1] python-03'), user.indexOf('# 本次要求'))
    expect(block).not.toContain('谁负责翻译？')
    expect(block).toContain('还没有出过题')
  })

  it('要几道题说清楚了', () => {
    expect(questionsPrompt(7).user).toContain('7 道题')
  })

  it('**拦了一句「别全出成术语对应题」** —— 术语表太长会把 AI 的注意力吸走', () => {
    // 术语表是 system 里最大的一块（36 条），语气范例里又正好有一道术语题（q4）。
    // 不明确拦一下，五道题很可能全长成一个样：「『绕鱼干跑圈』是哪个术语？」
    // 那种题只考记性。这条断言钉住的是「有没有人去把这句拦话删掉」。
    expect(questionsPrompt().user).toContain('术语对应题')
    expect(questionsPrompt().user).toContain('最多一道')
  })

  it('**日期只进 user、不进 system**（system 固定才能命中前缀缓存）', () => {
    const a = buildQuestionsPrompt({ topics: TOPICS, count: 3, terms: TERMS, freshness: '2026-10-21' })
    const b = buildQuestionsPrompt({ topics: TOPICS, count: 3, terms: TERMS, freshness: '2026-10-22' })
    expect(a.system).toBe(b.system)
    expect(a.user).toContain('2026-10-21')
    expect(b.user).toContain('2026-10-22')
    expect(a.user).not.toBe(b.user)
  })

  it('**旧题干最多只放几道样例**，并明说还有多少没列出来', () => {
    const stems = Array.from({ length: 9 }, (_, i) => `旧题 ${i}`)
    const { user } = buildQuestionsPrompt({
      topics: [{ lessonId: 'x', title: 't', tags: [], stems }],
      count: 3,
      terms: TERMS,
      freshness: '2026-10-21'
    })
    const shown = stems.filter((s) => user.includes(s))
    expect(shown.length).toBe(MAX_STYLE_STEMS_PER_TOPIC)
    expect(user).toContain(`另外还有 ${9 - MAX_STYLE_STEMS_PER_TOPIC} 道旧题`)
  })
})

describe('pickStyleStems：抽样规则', () => {
  const stems = Array.from({ length: 20 }, (_, i) => `题 ${i}`)

  it('同一种子结果稳定（同一天缓存才能命中、测试才能复现）', () => {
    expect(pickStyleStems(stems, 'lesson|2026-10-21')).toEqual(
      pickStyleStems(stems, 'lesson|2026-10-21')
    )
  })

  it('换一天就换一批（否则 AI 天天照着同三道题写）', () => {
    const a = pickStyleStems(stems, 'lesson|2026-10-21')
    const b = pickStyleStems(stems, 'lesson|2026-10-22')
    expect(a).not.toEqual(b)
  })

  it('不超过上限，且不重复、不改原顺序以外的内容', () => {
    const picked = pickStyleStems(stems, 'seed', 3)
    expect(picked).toHaveLength(3)
    expect(new Set(picked).size).toBe(3)
    for (const s of picked) expect(stems).toContain(s)
  })

  it('题干少于上限时有几道给几道（去掉空项与重复项）', () => {
    expect(pickStyleStems(['a', ' ', 'b', 'b'], 'seed', 5)).toEqual(['a', 'b'])
  })
})

// ---------------------------------------------------------------- 讲报错提示词

const explainPrompt = (error: string, code = 'print(x)', lang: 'python' | 'c' = 'python') =>
  buildExplainPrompt({ lang, code, error, terms: TERMS })

describe('buildExplainPrompt', () => {
  it('术语表照样带着（不然 AI 会说「变量」而不是「小鱼干仓库」）', () => {
    expect(explainPrompt('NameError').system).toContain('小鱼干仓库')
  })

  it('语言名按全项目统一口径写（C 要写成「C 语言」）', () => {
    expect(explainPrompt('error', 'int main(){}', 'c').user).toContain('C 语言')
    expect(explainPrompt('error').user).toContain('Python')
  })

  it('代码和报错都围在代码块里，且都在 user 段', () => {
    const { user } = explainPrompt('NameError: name x', 'print(x)')
    expect(user).toContain('print(x)')
    expect(user).toContain('NameError: name x')
    expect(user).toContain('```')
  })

  it('报错超过 20 行照样两头留', () => {
    const raw = [
      "main.c:3:5: error: expected ';'",
      ...Array.from({ length: 30 }, () => '    ^'),
      "NameError: name 'x' is not defined"
    ].join('\n')
    const { user } = explainPrompt(raw, 'int main(){}', 'c')
    expect(user).toContain("main.c:3:5: error")
    expect(user).toContain('NameError')
    expect(user).toContain('省略')
  })

  it('**讲报错不要求 JSON**（那是出题才有的格式）', () => {
    const { user, system } = explainPrompt('NameError')
    expect(system + user).not.toContain('"questions"')
    expect(system).toContain('不要输出 JSON')
  })

  it('超长代码也会被截断（防有人贴一大坨进来烧额度）', () => {
    const big = Array.from({ length: 200 }, (_, i) => `line${i}`).join('\n')
    const { user } = explainPrompt('NameError', big)
    expect(user).toContain('省略')
    expect(user).not.toContain('line100')
  })
})
