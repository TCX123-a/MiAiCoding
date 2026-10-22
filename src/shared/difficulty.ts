/**
 * 难度体系 —— 值域、解析规则、挑战判定、放宽顺序，全项目**唯一一份**。
 *
 * 【4023 道存量题的难度从哪来：运行时解析，不落盘】
 * 每道题的难度 = `resolveDifficulty(题, 课的阶段)`，规则表见下面那张。
 * 内容文件（229 份手写 + 210 份题库）**一个字节都不改** —— 三个理由：
 *   1. 批量改写会产生几百份文件的噪声 diff，内容提交的历史再也读不清楚；
 *   2. 题库文件是 `gen-bank.mjs` 浇铸出来的产物，手盖的字段会被下一次
 *      `--force` 重算冲掉（模板才是它的真源）；
 *   3. 规则要调（比如"codefill 也算困难"）时只改这一个文件，
 *      改完立刻对全部题目生效，不需要重跑任何脚本、不做任何迁移。
 * 显式 `difficulty` 字段只用来**覆盖**默认规则（见 `types.ts` 的类型注释）。
 *
 * 【规则表为什么可以只按题型查，不需要知道题是"手写"还是"题库"】
 * 实测（2026-09-29，扫 content/ 全部 446 份 JSON）：
 *   · 手写内容（1470 道）只有 choice / fill / code / codefill 四种题型；
 *   · 题库（2553 道）只产 codefix / codewrite 两种。
 * 题型与来源**一一对应**，所以按题型查就等价于按来源查，不需要在 bundle 里
 * 额外记一个"来源"字段。这条前提由内容测试 `content-difficulty.test.ts` 钉着 ——
 * 哪天有人手写了一道 codefix、或题库添了别的题型，那张测试会当场变红，
 * 而不是让难度悄悄按错误的规则算下去。
 *
 * 【为什么不拿 id 的形状反推来源（比如 bank- 前缀）】
 * id 是**产物的形状**，不是语义。拿它当判据，等于把"生成器怎么命名"
 * 变成难度体系的承重墙 —— 生成器改个命名规则，难度会静默算错。
 *
 * ⚠️ 本文件在 src/ 下、被文案闸门扫，字符串一律英文（显示名在渲染层 copy.ts）。
 */
import type { Difficulty, Question, Stage } from './types'

/** 难度值域。**顺序 = 由易到难**（筛选器排序、邻近放宽都沿这个顺序走） */
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard', 'challenge']

/** 值域守卫：从文件里读回来的东西（将来还有服务器）用它把坏值挡在外面 */
export function isDifficulty(v: unknown): v is Difficulty {
  return typeof v === 'string' && (DIFFICULTIES as readonly string[]).includes(v)
}

/**
 * 解析一道题的难度。规则表 —— **唯一一份定义**，调难度口径就改这里：
 *
 * | 题型      | 难度          | 说明 |
 * |-----------|---------------|------|
 * | choice    | easy          | 手写：认概念，看一眼就能选 |
 * | fill      | easy          | 手写：填一句话 |
 * | code      | medium        | 手写：读代码说输出，要在脑子里跑一遍 |
 * | codefill  | medium        | 手写：补代码缺口 |
 * | codefix   | medium / hard | 题库：阶段一二是 medium，阶段三是 hard |
 * | codewrite | hard          | 题库：从零写一段能跑对的代码 |
 *
 * 显式 `difficulty` 字段**覆盖一切**（挑战题就靠它，见 `isChallenge`）。
 *
 * ⚠️ 这张表只定义"缺省是什么"。挑战**不在缺省里** —— 没有任何题型默认挑战。
 */
export function resolveDifficulty(q: Question, stage: Stage): Difficulty {
  if (q.difficulty !== undefined) return q.difficulty
  switch (q.type) {
    case 'choice':
    case 'fill':
      return 'easy'
    case 'code':
    case 'codefill':
      return 'medium'
    case 'codefix':
      return stage >= 3 ? 'hard' : 'medium'
    case 'codewrite':
      return 'hard'
  }
}

/**
 * 这道题是不是挑战题。
 *
 * 【为什么它不需要 stage】规则表里没有任何题型**默认**是挑战，挑战只能来自
 * 显式字段 —— 所以这个判断只看题目本身。组卷过滤的调用方（七个入口）
 * 因此不必把课的阶段一路传到过滤点上，少一条会传错的参数。
 *
 * `difficulty.test.ts` 钉着它和 `resolveDifficulty` 的**等价性**：对任何题型、
 * 任何阶段、带不带显式字段，`isChallenge(q)` 恒等于
 * `resolveDifficulty(q, stage) === 'challenge'`。哪天有人往规则表里加了一条
 * "某题型默认挑战"，那条测试会红在这里，逼他回来把这个函数改成同一份规则。
 */
export function isChallenge(q: Question): boolean {
  return q.difficulty === 'challenge'
}

/**
 * 按目标难度取题、不够时放宽的**取值顺序**：目标 → 邻居 → 更远。
 *
 * 【为什么需要放宽】按难度筛的入口（收藏练习、延展练习）如果严格只出"困难"，
 * 池子小的时候会得到一张空卷或两三道题的卷子 —— 那不是"严格"，是坏掉。
 * 宁可混进最近的邻居，也不出空卷。
 *
 * 【同距离先易后难】medium 的两个邻居 easy / hard 距离都是 1，取值顺序先 easy ——
 * 补进来的题是"没得选才给的"，做得出比做不出好：卡在更难的题上只会得到挫败，
 * 而隔壁那道简单的至少把知识点又过了一遍。
 *
 * 【challenge 只有目标本身就是 challenge 时才会出现】挑战题的使用范围是
 * 阶段综合练习 / 整门练习 / 每日挑战三处（主人规格），绝不能顺着"放宽"
 * 从后门溜进普通练习、复习、收藏里 —— 那正是 §3.3 要拦的事情。
 */
export function relaxOrder(target: Difficulty): Difficulty[] {
  const targetIdx = DIFFICULTIES.indexOf(target)
  return DIFFICULTIES.map((d, i) => ({ d, i }))
    .filter(({ d }) => d !== 'challenge' || target === 'challenge')
    .sort((a, b) => {
      const da = Math.abs(a.i - targetIdx)
      const db = Math.abs(b.i - targetIdx)
      if (da !== db) return da - db
      return a.i - b.i // 同距离：由易到难（i 小的在前）
    })
    .map(({ d }) => d)
}
