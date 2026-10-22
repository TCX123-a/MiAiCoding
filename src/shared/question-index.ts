/**
 * 运行时的题目索引 —— 4023 道题的一份"轻档案"：一次构建、到处查。
 *
 * 【为什么不把它塞进内容包一起打包】
 * 实测 bundle 已 16.1MB（lessons 12.3MB + searchIndex 3.8MB），再塞一份索引
 * ≈ +2~3MB；而且 content.ts 是静态 import —— 每次启动都要**解析**这些字节，
 * `check:packed` 又看不见体积涨了。而构建这份索引只要几毫秒：
 * 数据本来就在内存里（`bundle.lessons`），我们只是换个形状看它。
 *
 * 【条目里有什么、没有什么】
 * 有：查一份卷子需要的最小字段 —— 全局键、宿主课、语言、阶段、题型、
 * **解析后的**难度（不是原始字段）、课级标签、题干。
 * 没有：题目本体（选项/代码/答案/解析）。索引回答"有哪些题、怎么筛"；
 * "那道题的完整题面"去内容包里按 key 拿 —— 有两个来源的东西（AI 题只有本体、
 * 内置题只有引用）放一份进索引，迟早会跟真源不一致。
 *
 * 【课级标签的定位】108 个自由文本值、多为单例，不适合当主键
 * （重构成受控词表是明确不做的事）。它只做匹配辅助：延展练习
 * "同课优先 + 标签匹配"里的那个匹配。
 *
 * ⚠️ 本文件在 src/ 下、被文案闸门扫，字符串一律英文（中文只出现在注释里）。
 */
import type { Difficulty, Lang, Lesson, QuestionType, Stage } from './types'
import { questionKey } from './question-key'
import { resolveDifficulty, relaxOrder } from './difficulty'
import { shuffled } from './quiz-paper'

/** 索引里的一条 = 一道题的档案（不含题目本体） */
export interface QuestionIndexItem {
  /** 全局键 `课号:题号`，和错题本/收藏/练习史同一套（shared/question-key.ts） */
  key: string
  lessonId: string
  lang: Lang
  /** 宿主课的阶段。题库题的难度规则要用它（codefix 一二阶段中等、三阶段困难） */
  stage: Stage
  type: QuestionType
  /** **解析后**的难度 —— 显式字段覆盖默认规则，调用方不必再自己解析 */
  difficulty: Difficulty
  /** 宿主课的标签（课级粒度） */
  tags: string[]
  stem: string
}

/**
 * 从内容包的课列表构建索引。
 *
 * 纯函数、无缓存：调用方（Vue 的 computed、或一次性的模块级变量）决定构建几次。
 * 这里不自己做记忆化 —— 藏一份全局缓存会让"内容变了索引没变"这类 bug
 * 变得可能又没有痕迹。
 */
export function buildQuestionIndex(lessons: readonly Lesson[]): QuestionIndexItem[] {
  const out: QuestionIndexItem[] = []
  for (const l of lessons) {
    for (const q of l.questions) {
      out.push({
        key: questionKey(l.id, q.id),
        lessonId: l.id,
        lang: l.lang,
        stage: l.stage,
        type: q.type,
        difficulty: resolveDifficulty(q, l.stage),
        tags: l.tags,
        stem: q.stem
      })
    }
  }
  return out
}

/**
 * 按全局键建一张查找表（索引 → Map）。
 *
 * 【为什么要有它】收藏页和错题本都是「每行一条记录，各查各自的题」——
 * 直接在 4023 条的数组上 `find` 一遍，是每行一次线性扫（一屏 20 行就是
 * 8 万次比较，而且每次筛选重排都要再来一遍）。建一次 Map 是 O(n)，
 * 之后每行 O(1)。
 *
 * 【为什么由调用方缓存，而不是这里记忆化】同 `buildQuestionIndex` 的规矩：
 * 藏一份全局缓存，会让"内容变了索引没变"这类 bug 有可能发生又留不下痕迹。
 * 调用方（Vue 的 `computed`）拿着数组自己决定建几次。
 */
export function indexByKey(index: readonly QuestionIndexItem[]): Map<string, QuestionIndexItem> {
  const map = new Map<string, QuestionIndexItem>()
  for (const it of index) map.set(it.key, it)
  return map
}

/** 查询条件。字段全部可选，给了就全部要满足（AND） */
export interface IndexQuery {
  lang?: Lang
  stage?: Stage
  /** 单值或一组（一组 = 命中其中任意一个） */
  difficulty?: Difficulty | readonly Difficulty[]
  type?: QuestionType | readonly QuestionType[]
  /** 课级标签：**全部命中**才算（AND），标签是自由文本、做包含匹配 */
  tags?: readonly string[]
}

/** 把「单值或数组」统一成 Set，顺便让 `undefined` 与空数组语义清晰 */
function toSet<T>(v: T | readonly T[] | undefined): Set<T> | null {
  if (v === undefined) return null
  return new Set(Array.isArray(v) ? (v as readonly T[]) : [v as T])
}

/** 按条件筛选索引。返回**新数组**，原数组不动（调用方手里那份还要当池子用） */
export function filterIndex(
  index: readonly QuestionIndexItem[],
  query: IndexQuery
): QuestionIndexItem[] {
  const diffs = toSet(query.difficulty)
  const types = toSet(query.type)
  const tags = query.tags ?? []
  return index.filter((it) => {
    if (query.lang !== undefined && it.lang !== query.lang) return false
    if (query.stage !== undefined && it.stage !== query.stage) return false
    if (diffs && !diffs.has(it.difficulty)) return false
    if (types && !types.has(it.type)) return false
    for (const t of tags) {
      if (!it.tags.includes(t)) return false
    }
    return true
  })
}

/**
 * 按目标难度取 `size` 道题；该难度不够时按 `relaxOrder` 放宽补齐。
 *
 * 不变量（单测逐个钉着）：
 *   · **不重复**：每道题的难度只有一个值，所以每道题只可能落进一个桶；
 *   · **不出空卷**：池子里只要有题（且不是"清一色挑战题"而目标不是挑战），
 *     就一定能凑出题来 —— 哪怕目标难度一道都没有；
 *   · **challenge 不从后门进**：目标不是挑战时，挑战题**永远**不会被选进来，
 *     放宽到底也不选（`relaxOrder` 里已经滤掉，这里是它唯一的消费方之一）；
 *   · 池子比 `size` 小就给全部，不凑数、不重复。
 *
 * `rng` 可注入：测试里塞确定性假随机源才能断言"取出来的就是这几道"。
 * 桶内先洗牌再取 —— 同一难度的题也要换着出，不然每次都是同几道。
 */
export function selectWithRelaxation<T>(
  items: readonly T[],
  difficultyOf: (item: T) => Difficulty,
  target: Difficulty,
  size: number,
  rng: () => number = Math.random
): T[] {
  const out: T[] = []
  for (const d of relaxOrder(target)) {
    if (out.length >= size) break
    const bucket = items.filter((x) => difficultyOf(x) === d)
    if (bucket.length === 0) continue
    out.push(...shuffled(bucket, rng).slice(0, size - out.length))
  }
  return out
}
