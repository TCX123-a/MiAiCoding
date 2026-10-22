/**
 * 挑战计分（docs/26 §5 + §7.2）——**服务端是唯一算分者**。
 *
 *  - 逐题 `points = ok ? weightedPoints(D, L) : 0`——挑战 v3 起语言权重全 100，weightedPoints
 *    退化为纯难度分且与语言无关（easy/medium/hard/challenge = 100/150/200/250）；
 *    签名保留不动（协议真源公式，两端同一份；全 100 权重下 L 不影响取值）；
 *  - `scoreMax = Σ weightedPoints(D_i, L_i)`（与 ok 无关）；
 *  - 难度复核（§7.2「取低计分」）：
 *      · 上报 challenge：仅当 `type ∈ {codefix, codewrite}` 且 **题目级** `source='local'`
 *        时合法（对齐客户端现状：挑战题全是精选模板）；否则按默认规则表推导（challenge
 *        是最高档，推导值必然更低）计分并落 `difficulty_downgraded`；
 *      · 上报 easy/medium/hard：按默认规则表独立推导，取两者中**较低**者——高报被压回
 *        （防刷），低报不吃亏（保守方向）；压回同样落 `difficulty_downgraded`。
 *  - 落库 `difficulty` 是**复核后的有效档**（与 points / score_by_difficulty 口径一致——
 *    三者必须同一档，否则按难度筛选的榜面就是错的）；上报值被压回的事实由 flags 记录。
 *  - `score_by_lang` / `score_by_difficulty` 为**实得**口径（答错计 0，§5.5 算例同款）：
 *    批内出现过的键一律建条目（含 0），与 §3.4 示例 `{"c":0,…}` 一致。
 *
 * 复核的诚实边界（§7.2 原文）：客户端绕过 UI 直接构造请求仍可上报「合法的 hard codefix」
 * 抬分——复核只挡「形态不合法的抬分」，不假装能算准。
 */

import {
  DIFFICULTIES,
  defaultDifficulty,
  weightedPoints,
  type Difficulty,
  type Lang,
  type QuestionType,
} from '../protocol.js';

export type QuestionSource = 'local' | 'ai';

/** 难度被压回的日级标记（docs/26 §7.2 唯一有此名字的 flag）。 */
export const DIFFICULTY_DOWNGRADED_FLAG = 'difficulty_downgraded';

export interface ScoringQuestionInput {
  lang: Lang;
  stage: number;
  type: QuestionType;
  /** 客户端上报值（resolveDifficulty 的结果；显式字段覆盖一切） */
  difficulty: Difficulty;
  /** 题目级来源（challenge 合法性的条件之一，§7.2） */
  source: QuestionSource;
  ok: boolean;
}

export interface ScoredQuestion extends ScoringQuestionInput {
  /** 复核后的有效难度（落库值） */
  effectiveDifficulty: Difficulty;
  points: number;
  maxPoints: number;
}

export interface BatchScore {
  questions: ScoredQuestion[];
  correct: number;
  total: number;
  score: number;
  scoreMax: number;
  scoreByLang: Record<string, number>;
  scoreByDifficulty: Record<string, number>;
  /** 日级异常标记（去重、按首次出现序） */
  flags: string[];
}

const DIFFICULTY_RANK: Record<Difficulty, number> = Object.fromEntries(
  DIFFICULTIES.map((d, i) => [d, i]),
) as Record<Difficulty, number>;

/** §7.2 单题复核：返回有效难度与是否被压回。 */
export function reviewDifficulty(q: ScoringQuestionInput): {
  effective: Difficulty;
  downgraded: boolean;
} {
  const challengeLegal =
    q.difficulty === 'challenge' &&
    (q.type === 'codefix' || q.type === 'codewrite') &&
    q.source === 'local';
  if (challengeLegal) return { effective: 'challenge', downgraded: false };

  const derived = defaultDifficulty(q.type, q.stage);
  const effective =
    DIFFICULTY_RANK[q.difficulty] <= DIFFICULTY_RANK[derived] ? q.difficulty : derived;
  return { effective, downgraded: effective !== q.difficulty };
}

/** 整批计分（纯函数，无 IO——路由层只负责把输入送进来、把结果写下去）。 */
export function scoreBatch(questions: ScoringQuestionInput[]): BatchScore {
  const scored: ScoredQuestion[] = [];
  const scoreByLang: Record<string, number> = {};
  const scoreByDifficulty: Record<string, number> = {};
  const flags: string[] = [];
  let correct = 0;
  let score = 0;
  let scoreMax = 0;

  for (const q of questions) {
    const { effective, downgraded } = reviewDifficulty(q);
    const maxPoints = weightedPoints(effective, q.lang);
    const points = q.ok ? maxPoints : 0;
    scored.push({ ...q, effectiveDifficulty: effective, points, maxPoints });
    correct += q.ok ? 1 : 0;
    score += points;
    scoreMax += maxPoints;
    scoreByLang[q.lang] = (scoreByLang[q.lang] ?? 0) + points;
    scoreByDifficulty[effective] = (scoreByDifficulty[effective] ?? 0) + points;
    if (downgraded && !flags.includes(DIFFICULTY_DOWNGRADED_FLAG)) {
      flags.push(DIFFICULTY_DOWNGRADED_FLAG);
    }
  }

  return {
    questions: scored,
    correct,
    total: questions.length,
    score,
    scoreMax,
    scoreByLang,
    scoreByDifficulty,
    flags,
  };
}
