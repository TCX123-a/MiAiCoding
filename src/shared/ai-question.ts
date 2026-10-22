/**
 * AI 出的题：从**任意 JSON** 收到**能直接判分的 Question**（M6，纯函数，不联网）。
 *
 * 【为什么校验要写得这么严】
 * 这一步的输出会直接喂给判分引擎 `gradeQuestion()`。喂进去一份坏数据，
 * 表现不是报错，而是**安静地判错**：选项少一个、answer 下标越界、
 * 答案和选项对不上——学员答对了显示错，他会开始怀疑自己。
 * 所以规矩是：**宁可少一道题，也不放半道题进去**。
 *
 * 但也不是「一道坏就整批丢」：坏数据按**单条**剔除（见 `parseAiQuestions`），
 * 5 道里有 1 道 AI 写崩了，剩下 4 道照样能用。整批丢在题库只有 7 道题的时候
 * 代价太大——AI 偶尔飘一下，那天就一道 AI 题都没有了。
 *
 * 【为什么不用 zod 之类的库】
 * 全项目零运行时依赖是条硬线（离线优先、安装包要小）。而且这里的校验规则
 * 一半是「结构」一半是**内容判断**（偷懒选项、填空没空位），库也帮不上忙。
 *
 * 【id 为什么长这样】
 * `ai-<日期>-<序号>`，形如 `ai-2026-09-13-1`。开头必须是 `ai-`：
 * `isAiQid()` 靠它把 AI 题和内置题分开（AI 题走到哪儿都要自带本体，见 question-key.ts）。
 * **绝不能是 `q` 开头**——那会和内置题号撞车，把学员的错题本指到另一道题上。
 */
import type { ChoiceQuestion, CodeQuestion, FillQuestion, LangOfCode } from './types'
import { LANG_OF_CODE } from './types'
import { AI_LAZY_OPTION_MARKERS } from './copy'
import { AI_QID_PREFIX } from './question-key'
import { referencesOptionPosition } from './option-ref'
import type { PoolItem } from './challenge'

// ---------------------------------------------------------------- 上限

/** 一次最多收几道题。练习要 5 道、挑战的 AI 段要 20 道（CHALLENGE_AI_BLOCK）；
 *  这里是两处共用的防跑飞上限，不是任何一处的目标值 */
export const MAX_AI_QUESTIONS = 20

/** 题干长度上限。提示词里要求 ≤50 字，这里放宽到 200 —— 到 200 就不是「写长了」而是「跑飞了」 */
export const MAX_STEM_CHARS = 200

/** 解析长度上限。同上，拦的是跑飞，不是挑剔文笔 */
export const MAX_EXPLANATION_CHARS = 1000

/** 选择题的选项数：**必须恰好 4 个**，多一个少一个都不收 */
export const CHOICE_OPTION_COUNT = 4

/** 填空题的空位记号（题干里必须出现） */
const BLANK_MARK = '____'

// ---------------------------------------------------------------- 类型

/** 这道题考的是第几课。数组下标就是 topicIndex 的取值范围 */
export interface AiTopicRef {
  lessonId: string
  lessonTitle: string
}

export interface AiParseOptions {
  /** 这次允许考的课，**顺序即 topicIndex**。AI 只能从这里面选，选了别的一律丢 */
  topics: AiTopicRef[]
  /** 本地日期 `YYYY-MM-DD`，用来拼题目 id */
  dateKey: string
}

export interface AiParseResult {
  /** 活下来的题，**每题都带好了 id**，且已绑定宿主课（形状同候选池的 PoolItem） */
  items: PoolItem[]
  /** 被丢掉的条数 */
  dropped: number
  /**
   * 每条被丢的原因，**英文诊断码**，不是给用户看的文案。
   * 只在排查「为什么今天的 AI 题一道都没有」时有用，界面上不显示。
   */
  reasons: string[]
}

// ---------------------------------------------------------------- id

/** AI 题的 id：`ai-<日期>-<序号>`。序号从 1 起，同一天内不重复 */
export function aiQuestionId(dateKey: string, index1: number): string {
  return `${AI_QID_PREFIX}${dateKey}-${index1}`
}

// ---------------------------------------------------------------- 校验小工具

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function nonEmptyString(v: unknown): string | null {
  const s = str(v)
  if (s === null) return null
  const t = s.trim()
  return t === '' ? null : t
}

/** 是不是 0 起的整数下标 */
function isIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

/** 选项里有没有「以上都对」这种偷懒话术 */
function hasLazyOption(options: string[]): boolean {
  return options.some((o) => AI_LAZY_OPTION_MARKERS.some((m) => o.includes(m)))
}

// ---------------------------------------------------------------- 主函数

/**
 * 把 AI 返回的任意 JSON 收成能判分的题。
 *
 * 【两步走，顺序不能反】
 *   第一步按**题型各自**的形状校验（选择题查选项、填空查空位、代码查语言），
 *   第二步才拼 id、绑宿主课。反过来的话，一道坏题会先拿到 id 再被丢掉，
 *   同批里后面那道好题就顶了它的号——id 会跳号，虽然不致命，但排查时看着莫名其妙。
 *
 * 【坏数据一律丢，不做「修一修」】
 * 不把 `answer: "2"` 转成 `2`、不把 3 个选项补成 4 个、不把空题干填个占位符。
 * 这些「顺手修好」的题**看着能用**，但答案对不对只有 AI 知道，
 * 而判分引擎会把它当真——学员答错了都不知道该怪谁。
 */
export function parseAiQuestions(raw: unknown, opts: AiParseOptions): AiParseResult {
  const items: PoolItem[] = []
  const reasons: string[] = []
  let dropped = 0

  const drop = (code: string): void => {
    dropped++
    reasons.push(code)
  }

  if (!isObject(raw)) return { items, dropped: 1, reasons: ['not-an-object'] }

  const list = raw['questions']
  if (!Array.isArray(list)) return { items, dropped: 1, reasons: ['no-questions-array'] }

  // 存的是**归一化后**的题干，不是原样字符串。
  // 用原样比的话，「今天下雨了。」和「今天 下雨了」会被当成两道题放过去 ——
  // 而这恰恰是 AI 最容易犯的重复：同一个知识点凑不出花样，就换个标点再问一遍。
  const seenStems = new Set<string>()

  for (const entry of list) {
    if (items.length >= MAX_AI_QUESTIONS) {
      drop('too-many')
      continue
    }
    if (!isObject(entry)) {
      drop('not-an-object')
      continue
    }

    // ---- 宿主课：必须是给过的知识点之一
    const ti = entry['topicIndex']
    if (!isIndex(ti) || ti >= opts.topics.length) {
      drop('bad-topic-index')
      continue
    }

    // ---- 题型：**先查这个**，而且查两遍（这里一次，buildByType 里再分一次）。
    //
    // 重复不是冗余，是为了**诊断信息不说谎**：题型如果是 "essay"，
    // 这压根就不是一道题，别的字段对不对已经无所谓了。
    // 不先拦的话，一个 `type:"essay"` 且忘了写解析的条目会报成 `empty-explanation` ——
    // 照着这条线索去查「AI 为什么不写解析」，方向从一开始就是错的。
    /*
     * ⚠️ 这份白名单里**故意没有 `codefill` / `codefix` / `codewrite`**，
     * 它们不是漏写的。三个都拦在这一行，**但理由不是同一个** —— 这点很重要，
     * 因为"能不能放开"取决于各自的理由，混成一个会得出错的结论。
     *
     * · `codefill`（理由：**没法验**）—— `docs/09-内容生成规范.md` §7.2 的题型表。
     *   每个空是一个**精确字符串**，AI 写偏一个字符（`range(3)` / `range(1, 4)`）
     *   这道题就无解，而它没有一个便宜的本地验法：`code` 题至少还能把代码真跑
     *   一遍看输出，填空的答案对不对，机器没法自己判断。所以它只从本地题库抽。
     *
     * · `codefix` / `codewrite`（理由：**验得了，但不在 AI 这条路上**）——
     *   这两个恰恰**最好验**（真跑一遍参考解，输出对上 `expectedOutput` 就行，
     *   见 `scripts/check-question-code.mjs`）。问题在于那道闸门长在**内容管线**上：
     *   它扫的是 `content/` 下各课的 `questions.json`，只在写课文时跑。而 AI 出的题
     *   **根本不落盘**（答错才进错题本），永远碰不到那道闸门 ——
     *   于是 `expectedOutput` 到学员眼前时仍然是一句**没人验证过的断言**。
     *   要放开它们，得先给运行时补一条验证路径（生成时就把参考解跑一遍再决定
     *   要不要用这道题），而不是只把这一行放宽。
     *
     * 主循环这一处拦住就够了：`buildByType` 那个次要分叉收不到这三类，
     * 不需要跟着改。将来若要放开，先在本地加一道验证闸门
     * （见 docs/14-无限题库架构.md 的思路：让 AI 写模板、让本地把实例算出来）。
     *
     * 【上面这句"就够了"是实测过的，不是推断】
     * 把这一行的白名单放宽、放进这三类，`ai-question.test.ts` 那三条**照样绿** ——
     * 因为 `buildByType` 末尾那行 `return 'bad-type'` 会再把它们兜住
     * （就是那个函数最后一个 `return`）。
     * 也就是说这是**两道独立的闸门**，拆掉一道还有一道。
     * （反过来说：真要放开时，**两处都得改**，只改这一行是白改。）
     *
     * 钉住这三条的是 `__tests__/ai-question.test.ts` 的 `BAD` 表 —— 没有它，
     * "故意不收"就只是一句话，两处一起放宽时测试会全绿。
     */
    const type = entry['type']
    if (type !== 'choice' && type !== 'fill' && type !== 'code') {
      drop('bad-type')
      continue
    }

    // ---- 题干与解析：三种题型共有的部分
    const stem = nonEmptyString(entry['stem'])
    if (stem === null) {
      drop('empty-stem')
      continue
    }
    if (stem.length > MAX_STEM_CHARS) {
      drop('stem-too-long')
      continue
    }
    const explanation = nonEmptyString(entry['explanation'])
    if (explanation === null) {
      drop('empty-explanation')
      continue
    }
    if (explanation.length > MAX_EXPLANATION_CHARS) {
      drop('explanation-too-long')
      continue
    }

    // ---- 同一批里题干撞车：留先来的那道
    const stemKey = normalizeStem(stem)
    if (seenStems.has(stemKey)) {
      drop('duplicate-stem')
      continue
    }

    // ---- 按题型各自校验
    const built = buildByType(entry, stem, explanation)
    if (typeof built === 'string') {
      drop(built)
      continue
    }

    seenStems.add(stemKey)
    const topic = opts.topics[ti]
    items.push({
      question: { ...built, id: aiQuestionId(opts.dateKey, items.length + 1) },
      lessonId: topic.lessonId,
      lessonTitle: topic.lessonTitle
    })
  }

  return { items, dropped, reasons }
}

/**
 * 按题型造题。**成功返回题目（还没 id），失败返回一个原因码字符串**。
 *
 * 用「字符串 = 失败原因」这个约定是为了让主循环读起来是一条直线：
 * 校验散成十几个早返回，读的人很难确认到底哪些情况被拦了。
 */
function buildByType(
  entry: Record<string, unknown>,
  stem: string,
  explanation: string
): ChoiceQuestion | FillQuestion | CodeQuestion | string {
  const type = entry['type']

  if (type === 'choice') {
    const rawOptions = entry['options']
    if (!Array.isArray(rawOptions) || rawOptions.length !== CHOICE_OPTION_COUNT) {
      return 'choice-needs-exactly-4-options'
    }
    const options: string[] = []
    for (const o of rawOptions) {
      const s = nonEmptyString(o)
      if (s === null) return 'choice-empty-option'
      options.push(s)
    }
    if (new Set(options).size !== options.length) return 'choice-duplicate-options'
    if (hasLazyOption(options)) return 'choice-lazy-option'

    const answer = entry['answer']
    if (!isIndex(answer) || answer >= options.length) return 'choice-bad-answer-index'

    /*
     * 解析里按字母/位置指代选项的，直接丢。
     *
     * 组卷会把选项顺序洗掉（`quiz-paper.ts` 的 `shuffleOptions`），而解析里的
     * 「D 说的…」「第二项也不对」是散文，程序搬不动。模型没有恶意 ——
     * 它在提示词里看到的是自己写的原始顺序，只是不知道屏幕上会被洗。
     * 提示词第 10 条已经明令禁止；这里是**不信任提示词的兜底**：
     * 少一道题，好过让学员看到「正确项是 B，解析却在讲 D」。
     *
     * 判据与内置题共用 `option-ref.ts` 那一份 —— 两边口径必须一致，
     * 否则会出现「内置题不洗、AI 题却洗了」这种更难查的错位。
     */
    if (referencesOptionPosition(explanation)) return 'choice-explanation-refs-option'

    /*
     * 选项文本自己按位置说话的（「上面两件都归它管」），同样丢。
     * 组卷会把选项洗乱，这种选项洗到第一位就变成病句；解析写得再对，
     * 学员看到的选项本身也已经是错的。宁可少收一道题。
     */
    if (options.some((o) => referencesOptionPosition(o))) return 'choice-option-refs-position'

    return { id: '', type: 'choice', stem, options, answer, explanation }
  }

  if (type === 'fill') {
    // 题干里没有空位的话，学员看着一道题和一个输入框，**不知道该填什么**。
    // 提示词第 5 条明写了要用 ____ 当空，AI 没照做就说明这道题本身也没想清楚。
    if (!stem.includes(BLANK_MARK)) return 'fill-no-blank'
    const answer = nonEmptyString(entry['answer'])
    if (answer === null) return 'empty-answer'
    const accept = readAccept(entry['accept'])
    if (typeof accept === 'string') return accept
    return { id: '', type: 'fill', stem, answer, ...(accept ? { accept } : {}), explanation }
  }

  if (type === 'code') {
    const lang = str(entry['lang'])
    if (lang === null || !(LANG_OF_CODE as readonly string[]).includes(lang)) return 'code-bad-lang'
    const code = nonEmptyString(entry['code'])
    if (code === null) return 'code-empty-code'
    const answer = nonEmptyString(entry['answer'])
    if (answer === null) return 'empty-answer'
    const accept = readAccept(entry['accept'])
    if (typeof accept === 'string') return accept
    return {
      id: '',
      type: 'code',
      lang: lang as LangOfCode,
      code,
      stem,
      answer,
      ...(accept ? { accept } : {}),
      explanation
    }
  }

  return 'bad-type'
}

/**
 * 读 `accept`（等价答案）。
 *
 * 返回字符串 = 坏数据的原因码；返回 `undefined` = 没写（合法，选填）；
 * 返回数组 = 可用的等价答案。
 *
 * 顺手把**自己内部**重复的项去掉：`accept: ["招式", "招式"]` 是无意义的噪音，
 * 留着会让人以为「这里有两个不同的答案」。
 * 至于 accept 里混进了和 `answer` 相同的值——**不管**。判分时 `gradeFill`
 * 先比 answer 再比 accept，重复项不改变任何结果，为它多写一段归一化比对不划算。
 */
function readAccept(v: unknown): string[] | undefined | string {
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v)) return 'accept-not-array'
  const out: string[] = []
  for (const a of v) {
    const s = nonEmptyString(a)
    if (s === null) return 'accept-empty-item'
    if (!out.includes(s)) out.push(s)
  }
  return out.length > 0 ? out : undefined
}

/**
 * 题干归一化：去空白、去句读标点、转小写。
 *
 * 【去哪些、留哪些，是权衡过的】
 * 去：空白 + **句读标点**（中英文的逗号句号问号引号括号书名号……）。
 *     这批是「同一句话的两种写法」的唯一差别，不去掉就比对不出来。
 * 留：**运算符和编程符号**（`+ - * / = < > _` 这些）。
 *     把它们也去掉的话，`1+1` 和 `1-1` 会归一化成一模一样，
 *     于是两道**真不一样**的题被判成重复，其中一道被**安静地丢掉**。
 *     假撞车的代价是凭空少一道题，而且没人会发现——宁可漏判，不可错杀。
 *
 * 【它拦得住什么、拦不住什么】
 * 拦得住「同一句话多了个句号」「空格位置不同」「大小写不同」；
 * **拦不住**「换了种说法问同一件事」——那要语义比对（embedding），
 * 本项目绝不会为了它引入网络依赖。这是**说清楚的局限**，不是没做完：
 * 剩下那部分由提示词里的「这一课已经出过的题，不要重复」清单兜着。
 */
export function normalizeStem(s: string): string {
  return s.toLowerCase().replace(STEM_NOISE, '')
}

/**
 * 题干里的「噪音」字符：空白 + 句读标点。
 *
 * 注意中英文的**叹号都在里面**（`！` 和 `!`），英文的 `?` `,` `;` `:` 也在，
 * 但 `+ - * / = < > _ % #` 一个都不在。判断标准只有一条：
 * **它在程序里有意义吗？** 有意义的留着，纯句读的去掉。
 * `!` 严格说是运算符（`!=`），但它在中文题干里几乎只当感叹号用，
 * 而且 `!=` 这种写法出现在**题干**（不是代码）里的可能性极低，权衡后按句读处理。
 */
const STEM_NOISE = /[\s，。！？、；：""''‘’“”（）《》〈〉【】「」,.!?;:'"()\[\]·—–]/g

/** AI 出的题 vs 已有题的题干，是不是同一道 */
export function sameStem(a: string, b: string): boolean {
  return normalizeStem(a) === normalizeStem(b)
}
