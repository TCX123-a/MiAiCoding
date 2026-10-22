/**
 * 全文检索纯函数（M2-05 验收，单测目标之一）。
 * 权重：标题命中 ×3、关键词命中 ×2、标签命中 ×1、正文命中 ×1；得分高者在前。
 * v1 纯子串匹配（192 课全文内存扫描 <5ms），拼音检索留 v1.1。
 *
 * 【学习闭环 §9 加了题目维度的检索】`searchQuestions` —— 课程结果照旧，
 * 面板下方那条「相关题目练习」入口靠它组卷。详见该函数自己的注释。
 */
import type { SearchEntry } from './types'
import type { QuestionIndexItem } from './question-index'

export interface SearchResult {
  entry: SearchEntry
  score: number
  snippet: string
}

export function searchEntries(index: SearchEntry[], query: string, limit = 30): SearchResult[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const results: SearchResult[] = []
  for (const e of index) {
    let score = 0
    const title = e.title.toLowerCase()
    const titleHit = title.includes(q)
    if (titleHit) score += 3
    if (e.keywords.some((k) => k.toLowerCase().includes(q))) score += 2
    if (e.tags.some((t) => t.toLowerCase().includes(q))) score += 1

    const textIdx = e.text.toLowerCase().indexOf(q)
    if (textIdx !== -1) score += 1
    if (score === 0) continue

    let snippet = ''
    if (titleHit) {
      snippet = e.title
    } else if (textIdx !== -1) {
      snippet = snippetOf(e.text, textIdx, q.length)
    } else {
      snippet = [...e.tags, ...e.keywords].join(' ')
    }
    results.push({ entry: e, score, snippet })
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}

function snippetOf(text: string, idx: number, len: number, radius = 32): string {
  const start = Math.max(0, idx - radius)
  const end = Math.min(text.length, idx + len + radius)
  const pre = start > 0 ? '…' : ''
  const post = end < text.length ? '…' : ''
  return pre + text.slice(start, end) + post
}

// ──────────────────────────────────────────────────────── 题目维度（§9 搜索增强）

/**
 * 「相关题目练习」微卷的题数上限（规格：3~5 道 —— 取上界）。
 *
 * 它是**搜索结果能带出多少道题**的两处共同判据：入口行里显示的数
 * （「相关题目练习 · N 道」）和真开出去那张卷子的题数。
 * 分成两个数的话，界面说 5 道、卷子里 4 道，用户只会当你数错了。
 */
export const SEARCH_QUIZ_MAX = 5

/** 一道命中的题 + 它的得分（入口只需要数量和题，不展示分数） */
export interface QuestionSearchHit {
  item: QuestionIndexItem
  score: number
}

/**
 * 在题目索引里检索（题干 + 课级标签）。
 *
 * 【权重为什么不照抄 `searchEntries` 那套】
 * 课程条目有标题/关键词/标签/正文四样，题目只有两样：题干和课级标签。
 * 题干是这道题的**全部文本**，它命中就是这道题本身在讲这个词 —— 记 ×2；
 * 课级标签是"这节课的话题"沾上了查询词，题干的字面里并没有 —— 记 ×1。
 * 两者悬殊不能太大（查一个课名时，整课的题都该露头），但题干命中必须排前。
 *
 * 【挑战题在**入口这一层**就滤掉，不留到开卷】
 * 规格：挑战题只在阶段/整门/每日挑战三处出现（§3.3），搜索练习不在其中。
 * 滤在这里而不是开卷那一步：入口行显示的数（N）和真开出去的题数必须是**同一个数** ——
 * 滤晚了，界面说 5 道、卷子 4 道。单测钉着"清一色挑战题 → 一道都不返回"。
 *
 * 【同分保持索引原序】`sort` 在现行规范里是稳定的（ES2019 起）——
 * 不额外摇号：检索结果要可复现，摇号是**开卷那一步**的事（buildPaper 会洗）。
 * 返回的是"档案"（`QuestionIndexItem`），题目本体由调用方按 key 回内容包拿。
 */
export function searchQuestions(
  index: readonly QuestionIndexItem[],
  query: string,
  limit = SEARCH_QUIZ_MAX
): QuestionSearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q || limit <= 0) return []

  const hits: QuestionSearchHit[] = []
  for (const item of index) {
    // 难度是**解析后**的值（index 构建时算过），这里不重跑规则
    if (item.difficulty === 'challenge') continue
    let score = 0
    if (item.stem.toLowerCase().includes(q)) score += 2
    if (item.tags.some((t) => t.toLowerCase().includes(q))) score += 1
    if (score === 0) continue
    hits.push({ item, score })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, limit)
}
