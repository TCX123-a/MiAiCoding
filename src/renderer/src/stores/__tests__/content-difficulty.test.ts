/**
 * 难度分布报告 & 内容不变量（读**真实** bundle + 真实内容文件）。
 *
 * 【为什么必须读真产物】
 * 难度解析规则（shared/difficulty.ts）压着一条前提：**题型与来源一一对应** ——
 * 手写内容只有 choice/fill/code/codefill，题库只产 codefix/codewrite。
 * 用构造的假数据测 resolveDifficulty，只能证明"它按表算"；而**那张表对不对**，
 * 取决于真内容长什么样 —— 哪天有人手写了一道 codefix、或题库添了新题型，
 * 规则会按错误的来源类算下去，没有任何东西会响。这条测试就是那声警报。
 * 先例：content-reachability.test.ts（同样读真 bundle，理由见它抬头）。
 *
 * 【它同时就是「难度分布报告」】
 * 跑 `npx vitest run content-difficulty` 看 stdout 里的分布表与挑战题清单。
 * 表本身不做断言（分布会随内容演进），断言的是**结构不变量**：
 * 全链题数三处对账、每课非挑战题够不够一份练习卷、key 唯一、挑战题的题型范围。
 *
 * 【红了怎么办】先当**发现**报告给主人，不静默放宽 —— 项目纪律。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import bundleJson from '../../generated/content-bundle.json'
import { buildQuestionIndex } from '../../../../shared/question-index'
import { DIFFICULTIES, isChallenge, resolveDifficulty } from '../../../../shared/difficulty'
import { LESSON_PRACTICE_SIZE } from '../../../../shared/quiz-paper'
import type { ContentBundle, Difficulty, Question, QuestionType } from '../../../../shared/types'

const bundle = bundleJson as unknown as ContentBundle
const lessons = bundle.lessons

const CONTENT = join(process.cwd(), 'content')
/** 手写内容的语言目录（题库目录单独在 challenge-bank） */
const HANDWRITTEN_LANGS = ['c', 'cpp', 'java', 'python', 'common']
/** 手写内容的题型 / 题库的题型 —— 分区不变量两侧 */
const HAND_TYPES = new Set<QuestionType>(['choice', 'fill', 'code', 'codefill'])
const BANK_TYPES = new Set<QuestionType>(['codefix', 'codewrite'])

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walkFiles(p, out)
    else out.push(p)
  }
  return out
}

const handFiles = HANDWRITTEN_LANGS.flatMap((l) => walkFiles(join(CONTENT, l))).filter((f) =>
  f.endsWith('questions.json')
)
const bankFiles = walkFiles(join(CONTENT, 'challenge-bank')).filter((f) => f.endsWith('.json'))

function readJson(file: string): { lessonId?: string; questions?: Question[]; items?: Question[] } {
  return JSON.parse(readFileSync(file, 'utf8'))
}

const handQuestions: { file: string; q: Question }[] = handFiles.flatMap((f) =>
  (readJson(f).questions ?? []).map((q) => ({ file: f, q }))
)
const bankItems: { file: string; q: Question }[] = bankFiles.flatMap((f) =>
  (readJson(f).items ?? []).map((q) => ({ file: f, q }))
)

describe('难度体系 · 内容不变量（读真产物）', () => {
  it('自检非空：三份输入都有东西，否则后面的断言全是空转', () => {
    expect(lessons.length).toBeGreaterThan(0)
    expect(handQuestions.length).toBeGreaterThan(0)
    expect(bankItems.length).toBeGreaterThan(0)
  })

  it('★ 来源-题型分区：手写不出现 codefix/codewrite，题库不出现其它四种', () => {
    // 这是难度规则表「按题型查 = 按来源查」的全部依据。
    // 破了 = 规则按错误来源算难度（静默算错），必须当场红。
    const bad: string[] = []
    for (const { file, q } of handQuestions) {
      if (!HAND_TYPES.has(q.type)) bad.push(`手写 ${file} 出现 ${q.type}（${q.id}）`)
    }
    for (const { file, q } of bankItems) {
      if (!BANK_TYPES.has(q.type)) bad.push(`题库 ${file} 出现 ${q.type}（${q.id}）`)
    }
    expect(bad, `题型-来源分区被打破：\n  ${bad.join('\n  ')}`).toEqual([])
  })

  it(`★ 每课的非挑战题 ≥ ${LESSON_PRACTICE_SIZE} 道（否则课后练习的卷子会缩水）`, () => {
    // 课后练习从本课抽 LESSON_PRACTICE_SIZE 道；非挑战题不够这个数时，
    // 卷子会静默变短（buildPaper 不报错，有几道给几道）。
    const thin: string[] = []
    for (const l of lessons) {
      const n = l.questions.filter((x) => !isChallenge(x)).length
      if (n < LESSON_PRACTICE_SIZE) thin.push(`${l.id}（${n} 道）`)
    }
    expect(thin, `这些课非挑战题不够一份练习卷：\n  ${thin.join('\n  ')}`).toEqual([])
  })

  it('★ 全链题数三处对账：手写+题库 = bundle = 运行时索引', () => {
    const index = buildQuestionIndex(lessons)
    const bundleCount = lessons.reduce((s, l) => s + l.questions.length, 0)
    expect(handQuestions.length + bankItems.length).toBe(bundleCount)
    expect(index.length).toBe(bundleCount)
  })

  it('★ key 全局唯一（重了的话错题本/收藏会对到别的题头上）', () => {
    const index = buildQuestionIndex(lessons)
    const keys = new Set(index.map((x) => x.key))
    expect(keys.size).toBe(index.length)
  })

  it('★ 挑战题只出现在 codefix/codewrite 上（规则表的前提：挑战只能来自精选模板）', () => {
    const index = buildQuestionIndex(lessons)
    const challenge = index.filter((x) => x.difficulty === 'challenge')
    const bad = challenge.filter((x) => x.type !== 'codefix' && x.type !== 'codewrite')
    expect(bad.map((x) => `${x.key} [${x.type}]`)).toEqual([])
  })

  it('难度分布打表（报告本体，不断言具体数字）', () => {
    const index = buildQuestionIndex(lessons)
    const counts = new Map<Difficulty, number>(DIFFICULTIES.map((d) => [d, 0]))
    for (const it of index) counts.set(it.difficulty, (counts.get(it.difficulty) ?? 0) + 1)

    // 每个值都在域内（resolveDifficulty 的返回值就是域内值，这里是防将来改坏的兜底）
    const sum = [...counts.values()].reduce((a, b) => a + b, 0)
    expect(sum).toBe(index.length)

    const total = index.length
    const lines = DIFFICULTIES.map(
      (d) => `  ${d.padEnd(10)} ${String(counts.get(d)).padStart(5)}  (${(((counts.get(d) ?? 0) / total) * 100).toFixed(1)}%)`
    )
    const byLang = Object.entries(
      index.reduce<Record<string, number>>((m, x) => ({ ...m, [x.lang]: (m[x.lang] ?? 0) + 1 }), {})
    )
      .map(([l, n]) => `${l} ${n}`)
      .join(' / ')
    console.log(
      `\n难度分布报告（共 ${total} 道，${lessons.length} 课）：\n${lines.join('\n')}\n` +
        `  按来源：手写 ${handQuestions.length} + 题库 ${bankItems.length}\n` +
        `  按语言：${byLang}`
    )

    // 挑战题清单（阶段 7 起应有 24 道：4 语言 × 3 阶段 × {codefix, codewrite}，
    // 全部来自 scripts/bank/templates/*-challenge-*.json 的精选模板）
    const challenge = index.filter((x) => x.difficulty === 'challenge')
    console.log(
      challenge.length === 0
        ? '  挑战题清单：暂无（0 道）'
        : `  挑战题清单（${challenge.length} 道）：\n` +
            challenge.map((x) => `    ${x.key} [${x.type}/${x.lang}/stage${x.stage}]`).join('\n')
    )
  })

  it('抽样对账：bundle 里的题在索引里的难度 = 现场用 resolveDifficulty 重算的值', () => {
    // 索引构建与"规则本身"是两个东西，这里拿第二遍独立计算对账（防止构建时用错字段，
    // 比如把 lesson.stage 错传成 lesson.order 这类安静的错误）
    const index = buildQuestionIndex(lessons)
    const byKey = new Map(index.map((x) => [x.key, x]))
    let n = 0
    for (const l of lessons) {
      for (const q of l.questions) {
        const it = byKey.get(`${l.id}:${q.id}`)
        expect(it, `${l.id}:${q.id} 不在索引里`).toBeTruthy()
        expect(it!.difficulty).toBe(resolveDifficulty(q, l.stage))
        n++
      }
    }
    expect(n).toBe(index.length)
  })
})
