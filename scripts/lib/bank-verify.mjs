/**
 * 真跑题型的**唯一一份判据** —— 「这道 `codefix` / `codewrite` 到底对不对」。
 *
 * 【为什么必须抽出来，不能两边各写一份】
 * 判这道题需要跑三次程序（参考解、brokenCode、可能还有一次样例），判据本身
 * 有四五条分支。写两份的话，`check-question-code.mjs`（管课文里的题）和
 * `check-bank.mjs`（管无限题库）会在**某一次修改之后**悄悄分叉：
 * 一边说合格、一边说不行，而两道闸门的输出都是"绿/红"一个词，
 * 没人看得出它们判的其实是同一件事。
 *
 * 这是本项目反复出现的那条铁律：**判据只能有一处**。
 * 之前踩过的同款：提取与渲染要共用 markdown-it 的 fence token、
 * `_e2e` 脚本不能有两个判据、验证一支真跑题的逻辑不能在两个闸门里各写一份。
 *
 * 【这里判什么】三类，每一类都对应一种**不会报错**的坏法
 *   ① 参考解跑不起来（编译错 / 运行崩 / 超时）
 *      → 学员照着抄也跑不起来，而他会以为是自己抄错了
 *   ② 参考解跑出来的东西 ≠ expectedOutput
 *      → 学员代码全对却永远过不了关，两份输出肉眼看还一模一样
 *   ③ 【`codefix` 专有】`brokenCode` **本来就是对的**
 *      → 学员点运行，看到正确的输出，然后不知道该改什么
 *
 * ③ 的判据不是"没报错"而是"**没报错、而且输出已经等于 expectedOutput**"：
 * 编译过但算错（逻辑错误）是完全合格的改错题，只要它没**已经**给出答案。
 *
 * 【这里不判什么】
 * `codefix` 的报错解释对不对 —— 那要走内置错误库，而错误库是"第一条命中即返回"，
 * 存在规则被抢的现象（见 docs/09「判分与错误库的分工」）。判分**永远不看错误库**。
 */
import { gradeByRun, normalizeRunOutput, runBlock } from './run-code.mjs'

/**
 * 参考解跑的时候最多等多久。
 *
 * 应用发给学员的是 `runTimeoutSec`（默认 **10 秒**，设置页可调 1-60）。
 * 这里给 20 秒，是**刻意不一样**的：内容侧要拦的是「这份参考解根本跑不完」，
 * 不是复刻学员那台机器当时的负载。卡在 10 秒的话，机器一忙就会随机报红，
 * 而随机报红的闸门很快就会被当成噪音。真超过 20 秒的参考解，学员那边一定超时。
 */
export const RUN_TIMEOUT_MS = 20_000

/** `codefix` / `codewrite` 才走这条路；别的题型这里一概不管（返回 null） */
export function isRunQuestion(q) {
  return q?.type === 'codefix' || q?.type === 'codewrite'
}

/** 参考解在那道题里叫什么字段 —— 两种题型只有一个字之差，抄错就白跑 */
export function referenceKeyOf(type) {
  return type === 'codefix' ? 'referenceFix' : 'referenceSolution'
}

/**
 * 把参考解真跑一遍，**原样**带回它吐出来的东西。
 *
 * 生成器要的就是这个 `stdout`（它拿去当 `expectedOutput`），
 * 所以这里不做任何"对不对"的判断 —— 判断在 `verifyRunQuestion` 里。
 *
 * @returns {{ok: boolean, phase: string, output: string, stdout: string}}
 */
export function runReference(q, opts = {}) {
  const code = q[referenceKeyOf(q.type)]
  return runBlock(q.lang, code, { stdin: q.stdin, timeoutMs: opts.timeoutMs ?? RUN_TIMEOUT_MS })
}

/**
 * 完整判据。**这是全项目唯一一份"真跑题对不对"的判断。**
 *
 * @param {object} q  题目本体（`{type, lang, expectedOutput, stdin, referenceFix|referenceSolution, brokenCode?}`）
 * @param {{timeoutMs?: number}} [opts]
 * @returns {{ok: true, brokenPhase: string|null} | {ok: false, why: string, got: string, want: string}}
 *   `ok: false` 时 `got` / `want` 是**给人看的原始文本**，调用方原样打出来即可。
 */
export function verifyRunQuestion(q, opts = {}) {
  const expected = typeof q.expectedOutput === 'string' ? q.expectedOutput : ''

  // ── 零：expectedOutput 不能是空的
  //
  // 空 `expectedOutput` 就是「把代码删光也能过」的那个洞（`normalizeRunOutput('')`
  // 等于 `''`，而删光的程序输出也是 `''`）。校验器已经拦了这条，
  // 这里再兜一次是因为闸门**可能单独跑**：真跑到这一步会一路绿到底。
  if (!expected.trim()) {
    return { ok: false, why: 'expectedOutput 是空的（删光代码也能"过"）', got: '', want: '' }
  }
  // 顺带：归一化之后还是空的（比如内容是一堆空行），一样是那个洞
  if (!normalizeRunOutput(expected)) {
    return { ok: false, why: 'expectedOutput 归一化之后是空的（删光代码也能"过"）', got: '', want: expected }
  }

  // ── ① 参考解必须跑得起来
  const refKey = referenceKeyOf(q.type)
  const refCode = q[refKey]
  if (typeof refCode !== 'string' || !refCode.trim()) {
    return { ok: false, why: `缺 ${refKey}，没有参考解就没法验 expectedOutput`, got: '', want: expected }
  }

  const ref = runReference(q, opts)
  if (!ref.ok) {
    return {
      ok: false,
      why: `${refKey} ${ref.phase} 阶段就跑不起来`,
      got: ref.output,
      want: expected
    }
  }

  // ── ② 输出必须逐字对得上（走判分那条归一化规则，不另写一份）
  if (!gradeByRun(expected, ref.stdout)) {
    return {
      ok: false,
      why: `${refKey} 输出与 expectedOutput 不一致`,
      got: ref.stdout,
      want: expected
    }
  }

  // ── ③ 【codefix 专有】brokenCode 必须真的坏
  if (q.type === 'codefix') {
    const broken = typeof q.brokenCode === 'string' ? q.brokenCode : ''
    if (!broken.trim()) {
      return { ok: false, why: '缺 brokenCode', got: '', want: expected }
    }
    const b = runBlock(q.lang, broken, { stdin: q.stdin, timeoutMs: opts.timeoutMs ?? RUN_TIMEOUT_MS })
    if (b.ok && gradeByRun(expected, b.stdout)) {
      // 最坏的一种：**它看起来完全正常**。学员点运行 → 输出正确 → 无事可做。
      return {
        ok: false,
        code: 'broken-not-broken',
        why: 'brokenCode 没有坏（跑出来就等于 expectedOutput）',
        got: b.stdout,
        want: expected
      }
    }
    return { ok: true, brokenPhase: b.ok ? 'run' : b.phase }
  }

  // ── ④ 【codewrite 专有】骨架不能**已经是对的** —— ③ 的镜像
  //
  // 2026-09-28 补。③ 一直只写在 codefix 那半边，codewrite 没有对称的一条，
  // 于是 `java-s3-merge-join-write` 的两道题（落点输入恰好"左半段全小于右半段"）
  // 骨架**一行不写**跑出来就等于 expectedOutput —— 学员原样提交即过。
  // 它和 ③ 是同一种"不会报错"的坏法：不报错、不崩、输出正确，只是这道题**没有要写的东西**。
  //
  // 判据的宽严和 ③ 逐字对称：**只有"跑得起来、而且输出已经等于 expectedOutput"才算坏**。
  // 骨架编不过 / 崩 / 超时 一律放过 —— 那正是学员要动手去填的空。
  // `starter` 为 null（模板没写 starterTemplate）也放过：从空白开始写，没有"原样提交"这回事。
  if (q.type === 'codewrite' && typeof q.starter === 'string' && q.starter.trim()) {
    const st = runBlock(q.lang, q.starter, { stdin: q.stdin, timeoutMs: opts.timeoutMs ?? RUN_TIMEOUT_MS })
    if (st.ok && gradeByRun(expected, st.stdout)) {
      return {
        ok: false,
        code: 'starter-not-broken',
        why: 'starter 没有坏（骨架一行不写、跑出来就等于 expectedOutput —— 这道题没有要写的东西）',
        got: st.stdout,
        want: expected
      }
    }
  }
  return { ok: true, brokenPhase: null }
}

// ---------------------------------------------------------------- 题面残留

/**
 * 题面或解析里**不该还有** `{...}` 形状的东西 —— 有就是模板没填干净。
 *
 * 2026-09-16 起**两个字段都要过这一关**（调用点是 `bank.mjs` 的 `finalizeDraft`）。
 * 在那之前只有题面被查过，于是 `py-s1-read-two-sum` 的解析里带着
 * `{sampleInput}` 上线了 —— 闸门全绿，只有学员的眼睛能发现。
 *
 * 【为什么这里可以用宽松的形状，而 `bank.mjs` 的 `fill()` 不行】
 * 时机不同。`fill()` 跑在**实例化当中**，那会儿题面里还嵌着大段代码
 * （C / Java 的 `int add(int a) {`、`}`），宽松形状会把代码块当占位符而炸掉。
 * 这个函数跑在**实例化之后**，代码块已经进了 `referenceSolution` 字段、
 * 不在题面里了 —— 于是这里看到的每一个花括号都真的可疑。
 *
 * 【认哪些形状】
 *   `{n}` 这种标识符形状      → 一定漏填了
 *   `{sampleInput}`           → 延迟占位符没回填
 *   `{ n }` `{a + b}` `{中文}` → 多半是参数名写错（多个空格、写了表达式）
 * 不认的：一个孤零零的 `{` 或 `}`（中文课文里偶尔写"集合 {1,2}"，
 * 那种是正常内容，不该报红）。所以要求**成对**且**内容不含换行**。
 */
const 可疑花括号 = /\{[^{}\n]{1,60}\}/g

/** @returns {string[]} 题面里可疑的片段（去重后），空数组 = 干净 */
export function leftoverPlaceholders(text) {
  if (typeof text !== 'string') return []
  return [...new Set(text.match(可疑花括号) ?? [])]
}
