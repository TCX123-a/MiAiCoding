/**
 * 备忘录的搜索与筛选 —— **纯函数**（无防抖、无副作用、不碰 store）。
 *
 * 【为什么不照抄 stores/search.ts 的 200ms 防抖】
 * 那个搜索打的是整个内容库（几千节课/题）的索引，每次击键重排一遍是真贵；
 * 而备忘录是**一个人自己攒的几十条**，直接算比等 200ms 更跟手。蓝本 §五的口径：
 * 预计算小写 haystack、输入即搜。
 *
 * 【"预计算"在这里指什么 —— 不要理解成缓存】
 * 指**一条备忘只拼一次 haystack**（标题+正文小写化一次），而不是每个字符、
 * 每个分类档位各算一遍。**不做跨调用的缓存**：条目是响应式对象，用户改完正文
 * 拿的还是同一个引用，拿它当缓存键会读到过期内容 —— 搜索结果就会漏掉刚打进去的字。
 * 几十条的规模，每次现算一遍小写串的成本可以忽略。
 */
import type { MemoItem, MemoKind } from '../../../shared/types'

/**
 * 「全部」那一档的哨兵值。**不是**真实分类 —— 真实分类只有 code / knowledge，
 * 所以它不可能与任何 kind 撞车（写成 '' 就不一样了：将来真加一个空 kind 就撞上了）。
 */
export const MEMO_KIND_ALL = 'all'

export type MemoKindFilter = MemoKind | typeof MEMO_KIND_ALL

/**
 * 一条备忘的检索面：标题 + 正文，**整串小写一次**。
 *
 * 中间垫一个换行：不垫的话，标题结尾和正文开头会粘成一个谁也没写过的词
 * （标题"循环" + 正文"for" 拼出 "循环for"，搜"环f"也命中 —— 那是假命中）。
 */
export function memoHaystack(it: MemoItem): string {
  return `${it.title}\n${it.body}`.toLowerCase()
}

/**
 * 一条备忘命中查询词没有。空查询（含纯空白）**全命中** ——
 * 搜索框空着就等于"不筛"，界面上的语义是"全部都要"。
 */
export function memoMatches(it: MemoItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return memoHaystack(it).includes(q)
}

/**
 * 搜索 + 分类过滤，返回**保持入参顺序**的子集（顺序是列表的事，这里不打乱它 ——
 * 否则列表的「最近写的在最上面」会在搜索时变成另一种顺序，用户会以为搜出了别的东西）。
 *
 * 大小写不敏感：输入即搜的时候，没人会为了搜 "Python" 先把大小写切好。
 * 匹配是**纯子串**（不是分词）：备忘录里搜的多半是标识符、报错原句、代码片段，
 * 分词反而会把 "list.index" 这种查询拆坏。
 */
export function searchMemo(
  items: readonly MemoItem[],
  query: string,
  kind: MemoKindFilter = MEMO_KIND_ALL
): MemoItem[] {
  const q = query.trim().toLowerCase()
  const out: MemoItem[] = []
  for (const it of items) {
    if (kind !== MEMO_KIND_ALL && it.kind !== kind) continue
    if (q !== '' && !memoHaystack(it).includes(q)) continue
    out.push(it)
  }
  return out
}

/**
 * 列表行里那截正文摘要：正文的**第一行非空内容**，超长截到 `max` 再加省略号。
 *
 * 放这儿（而不是 MemoView 里）的理由同文件头：视图里的判断永远不会有测试。
 * 第一行而不是整段：备忘里粘的多半是多行代码，摘要要的是"一眼认出是哪条"，
 * 不是把整段摊在列表里。
 */
export function memoSummary(it: MemoItem, max = 80): string {
  const line = (it.body.split('\n').find((l) => l.trim() !== '') ?? '').trim()
  return line.length > max ? `${line.slice(0, max)}…` : line
}
