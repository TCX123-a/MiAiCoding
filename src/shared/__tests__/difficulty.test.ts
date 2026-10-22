/**
 * 难度体系（src/shared/difficulty.ts）—— 规则表、覆盖字段、挑战判定、放宽顺序。
 *
 * 【这个文件在守什么】
 * 难度是七个练习入口筛选与组卷的共同依据，它算错的后果全是"安静地不对"：
 *   · 挑战题溜进课后练习 / 复习 / 收藏 —— 学员在自己没准备好的时候撞上难题，
 *     而界面上没有任何东西能告诉他"这题不该出现在这里"；
 *   · 规则表被改坏（比如 codefix 全变 hard）—— 难度分布悄悄整体偏移，
 *     阶段卷的配比跟着歪，没有任何闸门会红。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，但 `__tests__` 目录被 gate 跳过
 * （见 copy.test.ts 的 walk），所以描述文字可以写中文 —— 断言的**字符串字面量
 * 全都是英文**（那些是数据，本来也只能是英文）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DIFFICULTIES,
  isChallenge,
  isDifficulty,
  relaxOrder,
  resolveDifficulty
} from '../difficulty'
import type { Difficulty, Question, QuestionType, Stage } from '../types'

const ALL_TYPES: QuestionType[] = ['choice', 'fill', 'code', 'codefill', 'codefix', 'codewrite']
const ALL_STAGES: Stage[] = [0, 1, 2, 3]

/** 造一道最小可用的题。`difficulty` 传了才带显式覆盖字段 */
function mk(type: QuestionType, difficulty?: Difficulty): Question {
  const d = difficulty === undefined ? {} : { difficulty }
  switch (type) {
    case 'choice':
      return { id: 'q1', type: 'choice', ...d, stem: 's', options: ['a', 'b'], answer: 0, explanation: 'e' }
    case 'fill':
      return { id: 'q1', type: 'fill', ...d, stem: 's ____', answer: 'x', explanation: 'e' }
    case 'code':
      return { id: 'q1', type: 'code', ...d, lang: 'c', code: 'int main(void){return 0;}', stem: 's', answer: '0', explanation: 'e' }
    case 'codefill':
      return { id: 'q1', type: 'codefill', ...d, lang: 'c', code: '____', stem: 's', blanks: [{ answer: 'x' }], explanation: 'e' }
    case 'codefix':
      return { id: 'q1', type: 'codefix', ...d, lang: 'c', brokenCode: 'b', stem: 's', expectedOutput: '0', referenceFix: 'r', explanation: 'e' }
    case 'codewrite':
      return { id: 'q1', type: 'codewrite', ...d, lang: 'c', stem: 's', expectedOutput: '0', referenceSolution: 'r', explanation: 'e' }
  }
}

// ---------------------------------------------------------------- 规则表

describe('resolveDifficulty：规则表（缺省难度的唯一一份定义）', () => {
  it('choice / fill → easy（任何阶段都一样）', () => {
    for (const stage of ALL_STAGES) {
      expect(resolveDifficulty(mk('choice'), stage), `stage ${stage}`).toBe('easy')
      expect(resolveDifficulty(mk('fill'), stage), `stage ${stage}`).toBe('easy')
    }
  })

  it('code / codefill → medium（任何阶段都一样）', () => {
    for (const stage of ALL_STAGES) {
      expect(resolveDifficulty(mk('code'), stage), `stage ${stage}`).toBe('medium')
      expect(resolveDifficulty(mk('codefill'), stage), `stage ${stage}`).toBe('medium')
    }
  })

  it('codefix → 阶段一二 medium、阶段三 hard', () => {
    expect(resolveDifficulty(mk('codefix'), 0)).toBe('medium')
    expect(resolveDifficulty(mk('codefix'), 1)).toBe('medium')
    expect(resolveDifficulty(mk('codefix'), 2)).toBe('medium')
    expect(resolveDifficulty(mk('codefix'), 3)).toBe('hard')
  })

  it('codewrite → hard（任何阶段都一样）', () => {
    for (const stage of ALL_STAGES) {
      expect(resolveDifficulty(mk('codewrite'), stage), `stage ${stage}`).toBe('hard')
    }
  })

  it('★ 显式 difficulty 覆盖一切（挑战题就靠它）：与题型、阶段都无关', () => {
    expect(resolveDifficulty(mk('choice', 'hard'), 1)).toBe('hard')
    expect(resolveDifficulty(mk('codefix', 'challenge'), 1)).toBe('challenge')
    // 覆盖也管"往低调"：阶段三的 codefix 本该是 hard，显式写了 easy 就是 easy
    expect(resolveDifficulty(mk('codefix', 'easy'), 3)).toBe('easy')
    expect(resolveDifficulty(mk('codewrite', 'medium'), 3)).toBe('medium')
  })
})

// ---------------------------------------------------------------- 挑战判定

describe('isChallenge：只看显式字段，不看阶段', () => {
  it('★ 没有任何题型**默认**是挑战（规则表里没有、缺省也不给）', () => {
    for (const type of ALL_TYPES) {
      for (const stage of ALL_STAGES) {
        expect(isChallenge(mk(type)), `${type} @ ${stage}`).toBe(false)
      }
    }
  })

  it('★ 等价性：对任何题型 × 阶段 × 难度字段，isChallenge 恒等于 resolveDifficulty === challenge', () => {
    // 这条是防漂移的核心断言 —— 哪天有人往规则表里加一条"某题型默认挑战"，
    // 上面那条会红、这条也会红，逼他回来把 isChallenge 改成消费同一份规则。
    const diffs: (Difficulty | undefined)[] = [undefined, ...DIFFICULTIES]
    for (const type of ALL_TYPES) {
      for (const stage of ALL_STAGES) {
        for (const d of diffs) {
          const q = mk(type, d)
          expect(isChallenge(q), `${type} @ ${stage} / ${String(d)}`).toBe(
            resolveDifficulty(q, stage) === 'challenge'
          )
        }
      }
    }
  })
})

// ---------------------------------------------------------------- 值域守卫

describe('isDifficulty：值域守卫（将来读文件、读服务器都要用它）', () => {
  it('四个合法值都认', () => {
    for (const d of DIFFICULTIES) expect(isDifficulty(d), d).toBe(true)
  })

  it('近似的坏值一律不认（别把 "EASY" 当 easy —— 它有可能是另一个东西）', () => {
    const bad = ['easy ', ' EASY', 'EASY', 'challenging', 'expert', '1', '', null, undefined, 0, 1, {}, [], true]
    for (const v of bad) expect(isDifficulty(v), JSON.stringify(v)).toBe(false)
  })

  it('DIFFICULTIES 的顺序 = 由易到难（放宽顺序、筛选器排序都沿它走）', () => {
    expect([...DIFFICULTIES]).toEqual(['easy', 'medium', 'hard', 'challenge'])
  })
})

// ---------------------------------------------------------------- 放宽顺序

describe('relaxOrder：按目标难度取题不够时的放宽顺序', () => {
  it('逐档钉死顺序（★ medium 同距离先易后难：medium → easy → hard）', () => {
    expect(relaxOrder('easy')).toEqual(['easy', 'medium', 'hard'])
    expect(relaxOrder('medium')).toEqual(['medium', 'easy', 'hard'])
    expect(relaxOrder('hard')).toEqual(['hard', 'medium', 'easy'])
    expect(relaxOrder('challenge')).toEqual(['challenge', 'hard', 'medium', 'easy'])
  })

  it('★ 目标不是挑战时，结果里**永远**没有 challenge（不放宽进挑战题）', () => {
    for (const t of ['easy', 'medium', 'hard'] as const) {
      expect(relaxOrder(t), t).not.toContain('challenge')
    }
  })

  it('非挑战目标覆盖其余全部档（放宽到底也不留空缺 —— 池子里有题就凑得出来）', () => {
    for (const t of ['easy', 'medium', 'hard'] as const) {
      expect([...relaxOrder(t)].sort()).toEqual(['easy', 'hard', 'medium'])
    }
    expect([...relaxOrder('challenge')].sort()).toEqual(['challenge', 'easy', 'hard', 'medium'])
  })
})

// ---------------------------------------------------------------- 脚本抄写

describe('脚本里的难度值域抄写与真源一致', () => {
  /**
   * 三个 .mjs 脚本（内容校验器、题库闸门、题库生成器）import 不了 TS，
   * 各自抄了一份 `VALID_DIFFICULTIES` —— 老规矩（同 CODE_FILL_MARKER）：
   * 抄写允许，漂移不许，钉法就是读源码文本比对。
   */
  const FILES = ['scripts/content-validate.mjs', 'scripts/check-bank.mjs', 'scripts/gen-bank.mjs']

  function domainOf(file: string): string[] {
    const src = readFileSync(join(process.cwd(), file), 'utf8')
    const m = src.match(/const VALID_DIFFICULTIES = \[([^\]]*)\]/)
    if (!m) throw new Error(`${file} 里找不到 VALID_DIFFICULTIES —— 抄写被改名或删掉了？`)
    return m[1]
      .split(',')
      .map((s) => s.trim().replace(/^'/, '').replace(/'$/, ''))
      .filter(Boolean)
  }

  for (const f of FILES) {
    it(`${f} 的 VALID_DIFFICULTIES === 真源`, () => {
      expect(domainOf(f)).toEqual([...DIFFICULTIES])
    })
  }
})
