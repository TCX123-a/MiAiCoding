/**
 * AI 提示词组装（M6，纯函数，**不联网**）。
 *
 * 【这个文件里一个中文字都不能有】
 * 所有的字都在 `copy.ts` 的 `AI_PROMPT` 段里，这里只负责**按形状拼起来**。
 * 不是洁癖 —— 文案闸门 `lib/__tests__/copy.test.ts` 会扫描 src/ 下所有源码，
 * 这个文件里只要出现一个中文字符串字面量，`npm test` 就变红。
 * 想改 AI 说的话？去 copy.ts。想改它拿到的结构？在这里。
 *
 * 【为什么值得拆成纯函数】
 * 「AI 出的题不像猫咪」「AI 老是不按格式来」这类问题**没法靠读代码下结论** ——
 * 它取决于真正发出去的那串字。拼装是纯函数，就能把「发出去的到底是什么」
 * 钉在测试里、也能原样打印出来给人过目。发出去之前能看见，才谈得上调。
 */
import type { AiTopicInput, GlossaryTerm, LangOfCode } from './types'
import { AI_PROMPT, langName } from './copy'

/** 一次请求的两段提示词。字段名对齐 OpenAI / DeepSeek 的 messages 角色 */
export interface PromptPair {
  system: string
  user: string
}

/**
 * 报错文本最多留几行 —— **20 行，docs/04 的硬规定**。
 * 注意这个数指的是**报错原文**的上限，中间那行省略标记不算在内。
 */
export const ERROR_MAX_LINES = 20

/** 20 行里，开头留 12 行 */
const ERROR_HEAD_LINES = 12

/** 讲报错时，代码最多留几行（防止有人贴一大坨进来把额度烧光） */
export const CODE_MAX_LINES = 80

// ---------------------------------------------------------------- 截断

/**
 * 按行截断，**两头留、中间省略**。
 *
 * 为什么不直接砍尾巴：这两类报错的要害在相反的两头 ——
 *   - 编译错（gcc / g++ / javac）：要害在**开头**，`file.c:3:5: error: ...`；
 *   - 运行错（Python）：要害在**结尾**，最后一个 `NameError: name 'x' is not defined`。
 * 只留头会丢掉 Python 的错因，只留尾会丢掉 C 的出错位置。
 *
 * 行数没超就**原样返回**（行内缩进一个字都不动），不做任何「顺手美化」——
 * 截断函数只干截断，多干一件事就多一个让人意外的地方。
 * 唯一的例外是全空白：那等于「没有报错」，返回空串。
 * 不特判的话 `'   \n\n  '` 会返回 `'   '`，提示词里凭空多出一段空白，
 * 而 `\s+$` 只吃尾部、吃不到第一行前面那几个空格。
 */
export function truncateLines(raw: string, maxLines: number, headLines: number): string {
  const lines = raw.replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n')
  if (lines.length <= maxLines) {
    const body = lines.join('\n')
    return body.trim() === '' ? '' : body
  }
  const tailLines = Math.max(0, maxLines - headLines)
  const dropped = lines.length - headLines - tailLines
  return [
    ...lines.slice(0, headLines),
    AI_PROMPT.ELISION(dropped),
    ...(tailLines > 0 ? lines.slice(lines.length - tailLines) : [])
  ].join('\n')
}

/** 报错文本的截断（20 行） */
export function truncateError(raw: string): string {
  return truncateLines(raw, ERROR_MAX_LINES, ERROR_HEAD_LINES)
}

// ---------------------------------------------------------------- 术语表

/**
 * 把术语表渲染成提示词里的那一段。
 *
 * 用的是**逐条短句**，不是 `gen-batch.mjs` 那种整份 JSON 下发的写法。
 * 那边是批量生成课程内容、一次跑一批，多花几千 token 换结构完整是划算的；
 * 这边是**用户每开一次挑战就要发一次**，token 是他自己掏钱。
 * 而且 `scanExcludes` 这类字段是给扫描脚本用的，跟出题毫无关系，发过去只是噪音。
 * 序号、arrows 都是 ASCII，中文只有术语本身，全部来自 copy.ts 的模板。
 */
export function renderGlossary(terms: GlossaryTerm[]): string {
  return terms
    .map((t) => {
      const originals = t.originals.join(' / ')
      const example = (t.example ?? '').trim()
      return example
        ? AI_PROMPT.GLOSSARY_ITEM(originals, t.cat, example)
        : AI_PROMPT.GLOSSARY_ITEM_NO_EXAMPLE(originals, t.cat)
    })
    .join('\n')
}

/** 术语表那一段（标题 + 全表 + 三条铁律），出题和讲报错都要用 */
function glossaryBlock(terms: GlossaryTerm[]): string {
  return [AI_PROMPT.GLOSSARY_TITLE, renderGlossary(terms), AI_PROMPT.GLOSSARY_RULES].join('\n\n')
}

// ---------------------------------------------------------------- 出题

/** 出题时说清楚「可以考哪一课」 */
/**
 * 真正定义在 types.ts（它是 `ai:generate-questions` 的 IPC 入参，两边都要用）。
 * 这里留个别名，只是不想让已经写着 `TopicInput` 的地方全改一遍。
 */
export type TopicInput = AiTopicInput

export interface QuestionsPromptInput {
  topics: TopicInput[]
  /** 要几道题。实际拿到几道由校验环节说了算，这里只负责说 */
  count: number
  terms: GlossaryTerm[]
  /**
   * 当天日期 `YYYY-MM-DD`（可选）。写进 user 段有两个作用：
   *   ① 让 AI 每天换一批题 —— 缓存键含 user，日期变则缓存键变；
   *   ② 提示词里明说「今天要新题」，减少与旧题撞脸。
   */
  freshness?: string
}

/**
 * 每课最多给 AI 看几道旧题干。
 *
 * 【为什么是 3】原来的做法是把整池（实测 372 道）全塞进 user 段：input token
 * 三万起步，而其中绝大多数对「学语气」毫无增量 —— 看 3 道和看 30 道，模型
 * 学到的句式差不多，账单却差十倍。3 道足够给它「长短、问法、猫咪味」的样例，
 * 真正的防重复由**完整的 stems 列表**在解析后过滤（见 deepseek.ts）。
 */
export const MAX_STYLE_STEMS_PER_TOPIC = 3

/** FNV-1a 32 位。只用它把「课号 + 日期」变成稳定的抽样种子 */
function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * 从一课的旧题干里抽几道做风格参考。
 *
 * 【为什么按种子抽，而不是直接取前 3 道】`questions.json` 的前几道长期不变，
 * 天天给 AI 看同样的 3 道，它会照着那几道反复写。种子 = 课号 + 日期，
 * 每天换一批，但同一天内**结果稳定**（缓存命中、测试可复现）。
 */
export function pickStyleStems(
  stems: readonly string[],
  seed: string,
  max: number = MAX_STYLE_STEMS_PER_TOPIC
): string[] {
  const unique = [...new Set(stems.map((s) => s.trim()).filter((s) => s !== ''))]
  if (unique.length <= max) return unique
  let state = hashSeed(seed) || 1
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state
  }
  const picked = new Set<number>()
  while (picked.size < max) picked.add(next() % unique.length)
  return [...picked].sort((a, b) => a - b).map((i) => unique[i])
}

/**
 * 出题提示词。
 *
 * system 段是**固定的**（人格 + 术语表 + 格式 + 规矩），user 段才是每次变的
 * （考哪几课、要几道）。这样同一个用户当天重复请求时，DeepSeek 的前缀缓存能命中，
 * 而且出问题的时候一眼能分出「是人格没写对还是这次的知识点没描述清楚」。
 */
export function buildQuestionsPrompt(input: QuestionsPromptInput): PromptPair {
  const system = [
    AI_PROMPT.PERSONA,
    AI_PROMPT.VOICE,
    glossaryBlock(input.terms),
    AI_PROMPT.EXPLAIN_RULES,
    AI_PROMPT.FEWSHOT_TITLE,
    AI_PROMPT.FEWSHOT,
    AI_PROMPT.FORMAT_TITLE,
    AI_PROMPT.FORMAT_JSON,
    AI_PROMPT.FORMAT_NOTE,
    AI_PROMPT.RULES_TITLE,
    AI_PROMPT.RULES
  ].join('\n\n')

  const topics = input.topics.map((t, i) => {
    const lines = [AI_PROMPT.TOPIC_ITEM_HEAD(i, t.lessonId, t.title)]
    // 没有标签就整行不写。写一个光秃秃的「标签：」在那儿，模型会以为
    // 标签是空的、或者去猜一个 —— 不如不提这回事
    if (t.tags.length > 0) lines.push(AI_PROMPT.TOPIC_TAGS(t.tags.join(' / ')))
    if (t.stems.length === 0) {
      lines.push(AI_PROMPT.TOPIC_NO_STEMS)
    } else {
      // 只抽几道做**风格**参考。完整的 stems 仍在入参里，解析完会拿它做
      // 全文去重（见 deepseek.ts），所以这里少给不会让旧题漏进来。
      const style = pickStyleStems(t.stems, `${t.lessonId}|${input.freshness ?? ''}`)
      lines.push(AI_PROMPT.TOPIC_STEMS_TITLE)
      for (const s of style) lines.push(AI_PROMPT.STEM_ITEM(s))
      // 按**去重后的真实条数**算，别拿原始数组长度减 —— 旧题库里有重复/空题干时，
      // 那句「另外还有 N 道」会虚报，模型会为一个不存在的规模发愁。
      const uniqueCount = new Set(
        t.stems.map((s) => s.trim()).filter((s) => s !== '')
      ).size
      const omitted = uniqueCount - style.length
      if (omitted > 0) lines.push(AI_PROMPT.TOPIC_STEMS_OMITTED(omitted))
    }
    return lines.join('\n')
  })

  const user = [
    // 日期放在最前面：它同时是「今天要新题」的指令和缓存键的一部分
    ...(input.freshness ? [AI_PROMPT.FRESHNESS(input.freshness)] : []),
    AI_PROMPT.TOPICS_TITLE,
    topics.join('\n\n'),
    AI_PROMPT.REQUEST(input.count)
  ].join('\n\n')

  return { system, user }
}

// ---------------------------------------------------------------- 讲报错

export interface ExplainPromptInput {
  lang: LangOfCode
  code: string
  /** 原始报错文本。截断在这里做，调用方不用管 */
  error: string
  terms: GlossaryTerm[]
}

/** 讲报错提示词。代码和报错都过一遍截断，避免用户贴一大坨进来把额度烧光 */
export function buildExplainPrompt(input: ExplainPromptInput): PromptPair {
  const system = [
    AI_PROMPT.EXPLAIN_PERSONA,
    AI_PROMPT.VOICE,
    glossaryBlock(input.terms),
    AI_PROMPT.EXPLAIN_TASK_TITLE,
    AI_PROMPT.EXPLAIN_TASK,
    AI_PROMPT.EXPLAIN_SHAPE
  ].join('\n\n')

  const user = [
    AI_PROMPT.EXPLAIN_USER_TITLE(langName(input.lang)),
    fence(truncateLines(input.code, CODE_MAX_LINES, 40)),
    AI_PROMPT.EXPLAIN_ERROR_TITLE,
    fence(truncateError(input.error)),
    AI_PROMPT.EXPLAIN_ASK
  ].join('\n\n')

  return { system, user }
}

/** 用三引号围栏包一段原文。围栏本身是 ASCII，不含中文 */
function fence(body: string): string {
  return '```\n' + body + '\n```'
}
