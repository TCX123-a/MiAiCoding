/**
 * 挑战计分单测（docs/26 §5.5 算例 + §7.2 难度复核矩阵）。
 *
 * 种坏值纪律：对每个「复核必须起作用」的用例，都同时算出「复核是 no-op 时会得到什么」
 * 并断言两者不同——若复核逻辑被改成透传，这些断言必红（不是靠「反正绿了」自证）。
 */
import { describe, expect, it } from 'vitest';
import { DAILY_SCORE_MAX, weightedPoints } from '../../src/protocol.js';
import {
  DIFFICULTY_DOWNGRADED_FLAG,
  reviewDifficulty,
  scoreBatch,
  type ScoringQuestionInput,
} from '../../src/lib/scoring.js';

/** docs/26 §5.5 的一批 5 题（逐字复刻） */
const DOC_EXAMPLE: ScoringQuestionInput[] = [
  { lang: 'common', stage: 0, type: 'choice',   difficulty: 'easy',   source: 'local', ok: true },
  { lang: 'python', stage: 1, type: 'fill',     difficulty: 'easy',   source: 'local', ok: true },
  { lang: 'c',      stage: 1, type: 'code',     difficulty: 'medium', source: 'local', ok: false },
  { lang: 'cpp',    stage: 2, type: 'codefill', difficulty: 'medium', source: 'local', ok: true },
  { lang: 'java',   stage: 3, type: 'codefix',  difficulty: 'hard',   source: 'local', ok: true },
];

/** 复核 no-op 的坏副本：只用于「判据自检」——它必须与真实实现产生不同结果。 */
function naiveScore(qs: ScoringQuestionInput[]): number {
  return qs.reduce((sum, q) => sum + (q.ok ? weightedPoints(q.difficulty, q.lang) : 0), 0);
}

describe('scoreBatch：docs/26 §5.5 算例', () => {
  it('score=550 / scoreMax=700 / correct=4 / 双 jsonb 为实得口径', () => {
    const batch = scoreBatch(DOC_EXAMPLE);
    expect(batch.score).toBe(550);
    expect(batch.scoreMax).toBe(700);
    expect(batch.correct).toBe(4);
    expect(batch.total).toBe(5);
    expect(batch.flags).toEqual([]); // 算例全是诚实上报，不得有降档标记
    expect(batch.questions.map((q) => q.points)).toEqual([100, 100, 0, 150, 200]);
    expect(batch.questions.map((q) => q.effectiveDifficulty)).toEqual([
      'easy', 'easy', 'medium', 'medium', 'hard',
    ]);
    expect(batch.scoreByLang).toEqual({ common: 100, python: 100, c: 0, cpp: 150, java: 200 });
    expect(batch.scoreByDifficulty).toEqual({ easy: 200, medium: 150, hard: 200 });
  });

  it('判据自检：算例在 no-op 复核下的分数与 550 不同（证明 §7.2 复核真的在跑）', () => {
    // 算例本身无降档，naive 结果应恰好相等——所以再加一道「故意高报」的题让两者分道扬镳。
    const withOverclaim: ScoringQuestionInput[] = [
      ...DOC_EXAMPLE,
      { lang: 'cpp', stage: 0, type: 'choice', difficulty: 'challenge', source: 'local', ok: true },
    ];
    const real = scoreBatch(withOverclaim).score;
    const naive = naiveScore(withOverclaim);
    expect(real).toBe(550 + 100); // choice 谎报 challenge → 压回 easy = 100 分（难度分制，与语言无关）
    expect(naive).not.toBe(real);
    expect(naive).toBe(550 + 250); // 若复核是 no-op，这一题会按 challenge=250 计
  });
});

describe('§7.2 难度复核矩阵', () => {
  it('challenge 合法：codefix/codewrite + 题目级 source=local → 保持 250 档、无标记', () => {
    for (const type of ['codefix', 'codewrite'] as const) {
      const r = reviewDifficulty({ lang: 'java', stage: 2, type, difficulty: 'challenge', source: 'local', ok: true });
      expect(r, type).toEqual({ effective: 'challenge', downgraded: false });
    }
  });

  it('challenge 非法：AI 来源 / 题型不符 → 按默认规则表推导 + difficulty_downgraded', () => {
    const ai = reviewDifficulty({ lang: 'cpp', stage: 3, type: 'codewrite', difficulty: 'challenge', source: 'ai', ok: true });
    expect(ai).toEqual({ effective: 'hard', downgraded: true });

    const choice = reviewDifficulty({ lang: 'cpp', stage: 0, type: 'choice', difficulty: 'challenge', source: 'local', ok: true });
    expect(choice).toEqual({ effective: 'easy', downgraded: true });

    const code = reviewDifficulty({ lang: 'cpp', stage: 1, type: 'code', difficulty: 'challenge', source: 'local', ok: true });
    expect(code).toEqual({ effective: 'medium', downgraded: true });
  });

  it('easy/medium/hard 取低：高报压回并标记，低报不吃亏且不标记', () => {
    // 高报：choice 报 hard → 压回 easy
    expect(reviewDifficulty({ lang: 'c', stage: 0, type: 'choice', difficulty: 'hard', source: 'local', ok: true }))
      .toEqual({ effective: 'easy', downgraded: true });
    // 高报：code 报 hard → 压回 medium
    expect(reviewDifficulty({ lang: 'c', stage: 1, type: 'code', difficulty: 'hard', source: 'local', ok: true }))
      .toEqual({ effective: 'medium', downgraded: true });
    // 低报：codewrite 报 easy → 保持 easy（保守方向），不算降档
    expect(reviewDifficulty({ lang: 'c', stage: 1, type: 'codewrite', difficulty: 'easy', source: 'local', ok: true }))
      .toEqual({ effective: 'easy', downgraded: false });
    // 相符：codefix stage>=3 报 hard → hard；stage 2 报 hard → 压回 medium（默认表 stage<3 是 medium）
    expect(reviewDifficulty({ lang: 'c', stage: 3, type: 'codefix', difficulty: 'hard', source: 'local', ok: true }))
      .toEqual({ effective: 'hard', downgraded: false });
    expect(reviewDifficulty({ lang: 'c', stage: 2, type: 'codefix', difficulty: 'hard', source: 'local', ok: true }))
      .toEqual({ effective: 'medium', downgraded: true });
  });

  it('日级 flag 去重：多题降档只出现一次；计分用的是复核后难度', () => {
    const batch = scoreBatch([
      { lang: 'cpp', stage: 0, type: 'choice', difficulty: 'challenge', source: 'local', ok: true },
      { lang: 'cpp', stage: 1, type: 'code', difficulty: 'challenge', source: 'local', ok: true },
    ]);
    expect(batch.flags).toEqual([DIFFICULTY_DOWNGRADED_FLAG]);
    expect(batch.questions.map((q) => q.points)).toEqual([100, 150]); // easy=100、medium=150（难度分制，与语言无关）
    expect(batch.score).toBe(250);
    expect(batch.scoreMax).toBe(250);
    expect(naiveScore([
      { lang: 'cpp', stage: 0, type: 'choice', difficulty: 'challenge', source: 'local', ok: true },
      { lang: 'cpp', stage: 1, type: 'code', difficulty: 'challenge', source: 'local', ok: true },
    ])).toBe(500); // no-op 复核会翻倍——判据自检
  });

  it('全 challenge+cpp 满批 = DAILY_SCORE_MAX（1250000 = 5000 题 × 250）', () => {
    const batch = scoreBatch(
      Array.from({ length: 5000 }, () => ({
        lang: 'cpp' as const, stage: 3, type: 'codewrite' as const,
        difficulty: 'challenge' as const, source: 'local' as const, ok: true,
      })),
    );
    expect(batch.total).toBe(5000);
    expect(batch.score).toBe(DAILY_SCORE_MAX);
    expect(batch.scoreMax).toBe(DAILY_SCORE_MAX);
    expect(batch.score).toBe(1250000); // 手算钉死：5000 × 250（challenge 难度分，与语言无关）
    expect(batch.flags).toEqual([]);
  });
});
