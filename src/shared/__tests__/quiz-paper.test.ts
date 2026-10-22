/**
 * 组卷（src/shared/quiz-paper.ts）
 *
 * 【这个文件在守什么】
 * 组卷出的错**全是静默的**，一条报错都不会有：
 *
 *   1. **洗了题目忘了洗 keys** → 键整体错位 → 答对的消除不掉、答错的记到别的题头上
 *   2. **原地洗了内容包自己的数组** → 课文里的例题顺序也跟着变，重启前一直歪着
 *   3. **`answer` 没跟着选项搬** → 判分永远判错，而界面看起来完全正常
 *   4. **抽题数写错** → 要么每次都考同一批，要么题量不对，用户只会觉得"怪"
 *
 * 四条都不会崩、不会弹框、不会有日志。所以每一条都钉死在这里，
 * 而且**用确定性的假随机源** —— 真随机的话，测试只能验「长度对」，
 * 恰恰验不了上面这四条。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，字符串一律英文。
 */
import { describe, expect, it } from 'vitest'
import {
  buildPaper,
  buildQuestionPaper,
  LESSON_PRACTICE_SIZE,
  shuffleOptions,
  shuffled
} from '../quiz-paper'
import { questionKey, parseQuestionKey } from '../question-key'
import type { ChoiceQuestion, FillQuestion, Question } from '../types'

/** 假随机源：按给定的数列吐值。测试要的是"可复现"，不是"真随机"。 */
function seq(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]
}

/** 永远返回 0 的随机源 → 每次都把 j 定在 0，洗出来的顺序是完全可预测的 */
const alwaysZero = (): number => 0

function choice(id: string, answer: number, options: string[]): ChoiceQuestion {
  return { id, type: 'choice', stem: `stem-${id}`, options, answer, explanation: `why-${id}` }
}

function fill(id: string, answer: string): FillQuestion {
  return { id, type: 'fill', stem: `stem-${id}`, answer, explanation: `why-${id}` }
}

/*
 * 中性选项文本。
 *
 * ⚠️ 别改回 `['A选项', 'B选项', …]`：`shuffleOptions` 现在会检查**选项文本**
 * 有没有按位置自指（`上面两件都归它管`），而 `A选项` 会被 `LETTER_SUFFIX`
 * 判成「选项 A」——整道题就不洗了，这里的「返回新对象 / 新数组」两条断言会红。
 * 那个判据是故意的（洗牌后 `A选项` 会被洗到别的字母位），测试夹具该让路。
 */
const FOUR = ['甲', '乙', '丙', '丁']

// ---------------------------------------------------------------- 洗牌

describe('shuffled()：Fisher-Yates', () => {
  it('长度不变、元素一个不少不多', () => {
    const src = [1, 2, 3, 4, 5]
    const out = shuffled(src, alwaysZero)
    expect(out).toHaveLength(5)
    expect([...out].sort()).toEqual([...src].sort())
  })

  it('**不改原数组** —— 这条错了会去洗内容包本身', () => {
    // 题目的真源是内容包。原地洗 = 把课文里的例题顺序也洗了，
    // 而且进程内持久，重启前一直歪着。
    const src = [1, 2, 3, 4, 5]
    const copy = [...src]
    shuffled(src, alwaysZero)
    expect(src).toEqual(copy)
  })

  it('返回的是新数组，不是原引用', () => {
    const src = [1, 2]
    expect(shuffled(src)).not.toBe(src)
  })

  it('空数组、单元素都能安全过（不抛错、不返回 undefined）', () => {
    expect(shuffled([], alwaysZero)).toEqual([])
    expect(shuffled([7], alwaysZero)).toEqual([7])
  })

  it('确定性随机源给出确定结果 —— 这是后面所有断言的前提', () => {
    const a = shuffled([1, 2, 3, 4], alwaysZero)
    const b = shuffled([1, 2, 3, 4], alwaysZero)
    expect(a).toEqual(b)
  })

  it('真随机源下也只是排列，不会丢元素或造元素', () => {
    const src = Array.from({ length: 20 }, (_, i) => i)
    for (let k = 0; k < 20; k++) {
      expect([...shuffled(src)].sort((x, y) => x - y)).toEqual(src)
    }
  })
})

// ---------------------------------------------------------------- 洗选项

describe('shuffleOptions()：选项顺序 + answer 跟着搬', () => {
  it('洗过之后，正确项**还是原来那句正确的话**（这才是判据）', () => {
    // ⚠️ 不能断言 `answer` 等于某个具体数字 —— 那个值取决于 rng。
    //    要断言的是「按新的下标取出来的，仍然是原来那个正确选项」。
    //    写成断言具体下标的话，测试会因为 rng 取值而时红时绿。
    const q = choice('q1', 2, FOUR)
    const shuffledQ = shuffleOptions(q) as ChoiceQuestion
    expect(shuffledQ.options[shuffledQ.answer]).toBe(FOUR[2])
  })

  it('对多个不同的正确项位置都成立（不是碰巧蒙对）', () => {
    for (let answer = 0; answer < 4; answer++) {
      for (const r of [alwaysZero, seq([0.99]), seq([0.5, 0.2, 0.8]), Math.random]) {
        const q = choice('q1', answer, FOUR)
        const out = shuffleOptions(q, r) as ChoiceQuestion
        expect(out.options[out.answer]).toBe(FOUR[answer])
      }
    }
  })

  it('选项还是那四个，一个不少不多', () => {
    const q = choice('q1', 1, FOUR)
    const out = shuffleOptions(q, alwaysZero) as ChoiceQuestion
    expect([...out.options].sort()).toEqual([...FOUR].sort())
  })

  it('**不改原题** —— 洗的是卷子上的副本，不是题库里那道题', () => {
    const q = choice('q1', 2, FOUR)
    const snapshot = JSON.parse(JSON.stringify(q))
    shuffleOptions(q, alwaysZero)
    expect(q).toEqual(snapshot)
  })

  it('返回新对象，不是原引用', () => {
    const q = choice('q1', 0, FOUR)
    expect(shuffleOptions(q)).not.toBe(q)
  })

  it('options 是新数组 —— 共享数组的话，洗一张卷子会连带洗掉所有引用它的题', () => {
    const q = choice('q1', 0, FOUR)
    const out = shuffleOptions(q, alwaysZero) as ChoiceQuestion
    expect(out.options).not.toBe(q.options)
  })

  it('其它字段原样带过来（stem / explanation / id / type）', () => {
    const q = choice('q1', 0, FOUR)
    const out = shuffleOptions(q, alwaysZero) as ChoiceQuestion
    expect(out.id).toBe('q1')
    expect(out.stem).toBe('stem-q1')
    expect(out.explanation).toBe('why-q1')
    expect(out.type).toBe('choice')
  })

  it('填空/读代码题原样返回 —— 字符串答案没有"顺序"可洗', () => {
    const f = fill('q2', '循环')
    expect(shuffleOptions(f, alwaysZero)).toBe(f)
  })

  it('选项只有 1 个时也不会把 answer 洗坏', () => {
    const q = choice('q1', 0, ['唯一'])
    const out = shuffleOptions(q, alwaysZero) as ChoiceQuestion
    expect(out.options).toEqual(['唯一'])
    expect(out.answer).toBe(0)
  })
})

// ---------------------------------------------------------------- 组卷

describe('buildPaper()：抽题 + 洗题 + 洗选项', () => {
  const POOL = [
    { question: choice('q1', 0, FOUR), key: 'common-01:q1' },
    { question: fill('q2', '循环'), key: 'common-01:q2' },
    { question: choice('q3', 3, FOUR), key: 'common-01:q3' },
    { question: choice('q4', 1, FOUR), key: 'common-01:q4' }
  ]

  it('不传 size 就全要（只洗顺序，一道都不淘汰）', () => {
    expect(buildPaper(POOL, undefined, alwaysZero)).toHaveLength(4)
  })

  it('size 小于题量时抽那么多', () => {
    expect(buildPaper(POOL, 2, alwaysZero)).toHaveLength(2)
  })

  it('size 大于题量时**有几道给几道**，不补空、不报错', () => {
    // 池子不够不是错误 —— 新用户只学了一课就是这种状态。
    expect(buildPaper(POOL, 99, alwaysZero)).toHaveLength(4)
  })

  it('size 为 0 / 负数时给空数组，不抛错', () => {
    expect(buildPaper(POOL, 0, alwaysZero)).toEqual([])
    expect(buildPaper(POOL, -3, alwaysZero)).toEqual([])
  })

  it('size 是小数时向下取整，不会多给一道', () => {
    expect(buildPaper(POOL, 2.9, alwaysZero)).toHaveLength(2)
  })

  it('空池子 → 空数组（新用户的默认状态）', () => {
    expect(buildPaper([], 5, alwaysZero)).toEqual([])
  })

  it('⚠️ **题和 key 必须成对同进退** —— 这是这个函数唯一会出人命的 bug', () => {
    // 洗了题目没洗 keys → keys[i] 不再是 questions[i] 的键 →
    // 答对的消除不掉、答错的记到别的题头上，且一声不吭。
    const paper = buildPaper(POOL, undefined, alwaysZero)
    for (const e of paper) {
      const { lessonId, qid } = parseQuestionKey(e.key)
      expect(qid).toBe(e.question.id)
      expect(lessonId).toBe('common-01')
    }
  })

  it('题 key 配对在**真随机**下也成立（跑很多遍）', () => {
    for (let k = 0; k < 50; k++) {
      for (const e of buildPaper(POOL)) {
        expect(e.key).toBe(questionKey('common-01', e.question.id))
      }
    }
  })

  it('抽出来的确实是池子里那几道，不会造出新题', () => {
    const ids = buildPaper(POOL, 2, alwaysZero).map((e) => e.question.id)
    expect(ids.every((id) => ['q1', 'q2', 'q3', 'q4'].includes(id))).toBe(true)
  })

  it('选择题进了卷子都洗过选项（正确答案不再是固定位置）', () => {
    const paper = buildPaper(POOL, undefined, alwaysZero)
    for (const e of paper) {
      if (e.question.type !== 'choice') continue
      // alwaysZero 会把顺序重排得和原来不同；对不上就说明压根没洗
      const orig = POOL.find((x) => x.question.id === e.question.id)!.question
      expect(orig.type).toBe('choice')
      if (orig.type === 'choice') {
        expect(e.question.options[e.question.answer]).toBe(orig.options[orig.answer])
      }
    }
  })

  it('**不改原数组、也不改原题目** —— 内容包必须保持原样', () => {
    const snapshot = JSON.parse(JSON.stringify(POOL))
    const idsBefore = POOL.map((x) => x.question.id)
    buildPaper(POOL, 2, alwaysZero)
    expect(JSON.parse(JSON.stringify(POOL))).toEqual(snapshot)
    expect(POOL.map((x) => x.question.id)).toEqual(idsBefore)
  })

  it('伴随数据不会丢（lessonId / key 之外的字段也带过来）', () => {
    const withExtra = [
      { question: fill('q1', 'a'), key: 'k1', lessonTitle: '第一课' },
      { question: fill('q2', 'b'), key: 'k2', lessonTitle: '第二课' }
    ]
    for (const e of buildPaper(withExtra, undefined, alwaysZero)) {
      expect(e.lessonTitle).toBe(e.key === 'k1' ? '第一课' : '第二课')
    }
  })

  it('返回的每一项都是**新对象** —— 上游拿到手改它也不会污染池子', () => {
    const paper = buildPaper(POOL, undefined, alwaysZero)
    for (const e of paper) expect(POOL).not.toContain(e)
  })

  it('非选择题原样带过来（引用相同，没有多余复制）', () => {
    const only = [{ question: fill('q2', '循环'), key: 'k' }]
    expect(buildPaper(only, undefined, alwaysZero)[0].question).toBe(only[0].question)
  })
})

describe('buildQuestionPaper()：没有伴随数据时（课内练习用）', () => {
  const QS: Question[] = [choice('q1', 0, FOUR), fill('q2', '循环'), choice('q3', 2, FOUR)]

  it('不传 size 就全要', () => {
    expect(buildQuestionPaper(QS, undefined, alwaysZero)).toHaveLength(3)
  })

  it('抽 LESSON_PRACTICE_SIZE 道', () => {
    expect(buildQuestionPaper(QS, LESSON_PRACTICE_SIZE, alwaysZero)).toHaveLength(3)
  })

  it('题量比抽数少时全给（每节课只有 3 道题时不该报错）', () => {
    expect(buildQuestionPaper(QS, 10, alwaysZero)).toHaveLength(3)
  })

  it('回来的就是题本身，不是 `{question}` 包装', () => {
    const out = buildQuestionPaper(QS, undefined, alwaysZero)
    expect(out[0]).toHaveProperty('stem')
    expect(out[0]).not.toHaveProperty('question')
  })

  it('抽出来的题都在原题里，顺序可以不同', () => {
    const out = buildQuestionPaper(QS, 2, alwaysZero)
    const ids = out.map((q) => q.id)
    expect(ids.every((id) => QS.some((q) => q.id === id))).toBe(true)
    expect(new Set(ids).size).toBe(2)
  })

  it('选出来的选择题选项都洗过（正确项换了位置也算对）', () => {
    for (let k = 0; k < 30; k++) {
      for (const q of buildQuestionPaper(QS)) {
        if (q.type !== 'choice') continue
        const orig = QS.find((x) => x.id === q.id) as ChoiceQuestion
        expect(q.options[q.answer]).toBe(orig.options[orig.answer])
      }
    }
  })

  it('不改原题数组', () => {
    const before = QS.map((q) => q.id)
    buildQuestionPaper(QS, 2, alwaysZero)
    expect(QS.map((q) => q.id)).toEqual(before)
  })
})

// ---------------------------------------------------------------- 抽题数

describe('LESSON_PRACTICE_SIZE：抽几道', () => {
  it('是个正整数', () => {
    expect(Number.isInteger(LESSON_PRACTICE_SIZE)).toBe(true)
    expect(LESSON_PRACTICE_SIZE).toBeGreaterThan(0)
  })

  it('**不能大于每节课的题量** —— 大了就等于「全考」，抽题这一步白做', () => {
    // 现在每节课是 7 道。这个数字要是被改到 7 以上，
    // 课后练习就退回「每次都一样的那套题」，而没有任何东西会提醒。
    expect(LESSON_PRACTICE_SIZE).toBeLessThan(7)
  })

  it('和每日挑战同一档（一局 5 道是这个应用的基本单位）', () => {
    expect(LESSON_PRACTICE_SIZE).toBe(5)
  })
})
