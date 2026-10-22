/**
 * 收藏列表的**筛选、分档与元信息解析** —— 纯函数，题目信息靠注入。
 *
 * 【为什么从 FavoritesView.vue 里搬出来】
 * 同 `wrongbook-view.ts`：views/ 不在 vitest 的 include 范围内，写在那儿的判断
 * **永远不会有测试**。而这一屏的每条判断都有一句"看着正常、其实不对"的坏法：
 *
 *   · 按语言/难度/题型筛的时候，**把查不出出处的条目直接丢掉** ——
 *     用户收藏的一道题在屏幕上报销了，而没有任何地方解释它去哪了
 *   · 「未分组」写成 `!item.folderId` 之外的花样（比如按 !folderId 判空串）——
 *     删掉文件夹之后那些条目一条都看不见
 *   · 来源筛「其他」那一档漏掉 `source === undefined` 的老条目
 *
 * 【元信息为什么是注入的】
 * 一道收藏背后的题目有两个来路：内置题去 `questionIndex` 查，AI 题从条目
 * **自带的本体**里取（`types.ts` 的 FavoriteItem.ai）。两件事都依赖内容包，
 * 而内容包只在渲染进程手里、还很大 —— 注入进来，单测就能塞一份假的，
 * 断言不必写成"对真内容此刻成立"（那种断言内容一改就红，红了也说不清是谁的错）。
 *
 * ⚠️ **「查不出出处」是一个必须出声的状态，不是「不匹配」**：
 * 按语言筛「Python」时，一条查不出语言的收藏既不能证明是 Python、也不能证明不是。
 * 我们的选择是**不把它算进结果**，但把它记进 `hiddenUnknown` 交还给界面 ——
 * 界面必须把这件事说出来（"另有 N 条看不出出处"），
 * 因为**收藏是用户自己的东西，它不能悄悄变少**。
 *
 * ⚠️ 本文件在 src/ 下、被文案闸门扫，字符串一律英文（中文只出现在注释里）。
 */
import type {
  Difficulty,
  FavoriteItem,
  Lang,
  Lesson,
  QuestionType,
  Question
} from '../../../shared/types'
import type { QuestionIndexItem } from '../../../shared/question-index'
import { isAiKey } from '../../../shared/question-key'
import { isChallenge, resolveDifficulty } from '../../../shared/difficulty'
import { resolveRefQuestion } from '../../../shared/wrongbook'

/**
 * 「全部」、以及两个**虚拟档**的键。
 *
 * 三个都是普通字符串，靠"受控取值撞不上"来保证唯一：
 * 语言/难度/题型是枚举，文件夹 id 由 store 铸成 `folder-…`，
 * 来源是模式名（lesson/random/wrong/challenge/extend/fav…）——
 * 没有一个会等于 `all` / `ungrouped` / `other`。
 */
export const FAV_ALL = 'all'
/** 没有归进任何文件夹的那一档（`folderId === undefined`） */
export const FAV_UNGROUPED = 'ungrouped'
/** 落盘时就没带 `source` 的条目（老文件、手改过的文件，见 types.ts 的 source 注释） */
export const FAV_OTHER_SOURCE = 'other'

/**
 * 当前选中的筛选。**每个维度一个字符串**，不用 `undefined | null` 那一套 ——
 * `undefined`（不筛）和 `null`（未分组）在类型上离得太近，
 * 写反了不会报错，只会让筛出来的东西不对。
 */
export interface FavoritesSelection {
  lang: Lang | typeof FAV_ALL
  difficulty: Difficulty | typeof FAV_ALL
  type: QuestionType | typeof FAV_ALL
  /** 模式名、`FAV_ALL`、或 `FAV_OTHER_SOURCE` */
  source: string
  /** 文件夹 id、`FAV_ALL`、或 `FAV_UNGROUPED` */
  folder: string
}

/** 什么都不筛的那一份。视图拿它 `reactive({ ...FAV_ALL_SELECTION })` 起手 */
export const FAV_ALL_SELECTION: FavoritesSelection = {
  lang: FAV_ALL,
  difficulty: FAV_ALL,
  type: FAV_ALL,
  source: FAV_ALL,
  folder: FAV_ALL
}

/** 一条收藏的题**可筛选的**那几面。查不出出处时整个是 null */
export interface FavoriteMeta {
  lang: Lang
  type: QuestionType
  difficulty: Difficulty
}

export interface FavoritesView {
  /** 过筛之后要显示的那些（顺序不动，排序是 `sortFavorites` 的事） */
  shown: FavoriteItem[]
  /**
   * 因为**看不出出处**而被筛掉的数量（不是"有出处但不匹配"）。
   * 大于 0 时界面必须说明白 —— 见文件抬头。
   */
  hiddenUnknown: number
}

/** 这条收藏是从哪来的（落盘时没带就归「其他」档） */
export function itemSource(it: FavoriteItem): string {
  return it.source ?? FAV_OTHER_SOURCE
}

/**
 * 一条收藏**是不是在这一档里**。
 *
 * 语言/难度/题型三条走 `metaOf`：查不出出处的条目**返回 null**（"不知道"），
 * 由 `filterFavorites` 统一决定怎么处理 —— 那个决定只能有一处。
 */
function matchesMeta(
  meta: FavoriteMeta | null,
  sel: FavoritesSelection
): boolean | null {
  if (!meta) return null
  if (sel.lang !== FAV_ALL && meta.lang !== sel.lang) return false
  if (sel.difficulty !== FAV_ALL && meta.difficulty !== sel.difficulty) return false
  if (sel.type !== FAV_ALL && meta.type !== sel.type) return false
  return true
}

/**
 * 按筛选挑出要显示的条目。
 *
 * @param items  全部收藏
 * @param sel    当前筛选（`FAV_ALL_SELECTION` = 全不筛）
 * @param metaOf 一条收藏 → 它的语言/题型/难度；**查不出返回 null**
 */
export function filterFavorites(
  items: readonly FavoriteItem[],
  sel: FavoritesSelection,
  metaOf: (item: FavoriteItem) => FavoriteMeta | null
): FavoritesView {
  const shown: FavoriteItem[] = []
  let hiddenUnknown = 0
  /** 有三条维度要问元信息；全不筛时一条都不用问（也就不该有"看不出出处"的抱怨） */
  const needsMeta =
    sel.lang !== FAV_ALL || sel.difficulty !== FAV_ALL || sel.type !== FAV_ALL

  for (const it of items) {
    // 文件夹与来源都存在条目自己身上，不需要元信息
    if (sel.folder === FAV_UNGROUPED) {
      if (it.folderId !== undefined) continue
    } else if (sel.folder !== FAV_ALL && it.folderId !== sel.folder) {
      continue
    }
    if (sel.source !== FAV_ALL && itemSource(it) !== sel.source) continue

    if (needsMeta) {
      const hit = matchesMeta(metaOf(it), sel)
      if (hit === null) {
        // 「不知道」不是「不匹配」：不算进结果，但**记账**（界面要出声）
        hiddenUnknown++
        continue
      }
      if (!hit) continue
    }
    shown.push(it)
  }
  return { shown, hiddenUnknown }
}

/**
 * 按收藏时间排：新的在前。
 *
 * `addedAt` 是 ISO 字符串，字典序 = 时间序，不必 `new Date` 一遍。
 * 读口给缺失的 `addedAt` 兜的是 1970（`favorites-merge.ts` 的 UNKNOWN_TIME），
 * 排序时它们自然沉到最后 —— 那是"不知道什么时候收的"该待的位置。
 *
 * 返回**新数组**：调用方手里那份（store 的 items）还要当池子用。
 */
export function sortFavorites(items: readonly FavoriteItem[]): FavoriteItem[] {
  return [...items].sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0))
}

/** 每个文件夹有几条 / 未分组有几条 —— 左栏的计数靠它 */
export function countByFolder(items: readonly FavoriteItem[]): {
  byId: Record<string, number>
  ungrouped: number
} {
  const byId: Record<string, number> = {}
  let ungrouped = 0
  for (const it of items) {
    if (it.folderId === undefined) ungrouped++
    else byId[it.folderId] = (byId[it.folderId] ?? 0) + 1
  }
  return { byId, ungrouped }
}

/** 每个来源有几条 —— 来源筛的计数靠它（`FAV_OTHER_SOURCE` 也在里面） */
export function countBySource(items: readonly FavoriteItem[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const it of items) {
    const s = itemSource(it)
    out[s] = (out[s] ?? 0) + 1
  }
  return out
}

/**
 * 来源那一维的**固定顺序**：常见程度 + copy.ts 里 `SOURCE_LABELS` 的次序，
 * 「其他」永远最后（那是兜底档，不是一种来源）。
 *
 * 【为什么写死顺序而不按条数排】按条数排的话，筛选器会随着收藏/取消**自己换位置** ——
 * 用户正要点的那一档会跑掉。顺序固定，位置就永远认得出来。
 * 这里列的是**已知的模式名**（和 `QuizMode` / copy.ts 的 `SOURCE_LABELS` 同一批）；
 * 认不出的取值由 `filterOptions` 接在后面，**不丢**。
 */
export const FAV_SOURCE_ORDER: readonly string[] = [
  'lesson',
  'random',
  'wrong',
  'challenge',
  'extend',
  'fav',
  // 阶段 / 整门综合练习（学习闭环 §4）。次序跟着 copy.ts 的 SOURCE_LABELS 走 ——
  // ⚠️ 这两档**必须列在这里**，不能指望"认不出的取值会自动接在后面"：
  // 那个兜底是按字典序接的，而它在 `FAV_OTHER_SOURCE` **之后** ——
  // 于是「其他」会被顶到中间，违背它自己"永远最后"的约定。
  'stage',
  'lang',
  FAV_OTHER_SOURCE
]

/** 一个 `<select>` 里的一档 */
export interface FavoriteOption {
  value: string
  label: string
}

/**
 * 把「数据里真实存在的取值」做成筛选器选项 —— `FAV_ALL` 打头，其余按给定顺序。
 *
 * 【为什么不写死一份值域】
 * 写死的话会出现两类东西：一条都对不上的空档（点了才发现是空的），
 * 以及**数据里有、值域里没有的取值从筛选器里彻底消失** ——
 * 后者更糟：手改过的文件里 `source: "imported"` 那种条目，
 * 在「全部」里看得见、在来源的四种筛法里一种都找不到，用户会以为那几条坏了。
 * 规矩定成「数据里有几个值，就有几档」，这类条目就总有一档能筛到它。
 *
 * 【`keep` 是防"卡死"的，不是装饰】
 * 选项跟着数据走，就会有**选项自己消失**的一刻：用户选了「来源 = 延展练习」，
 * 然后把那两道题全取消了收藏 —— 这一档就没数据了。此刻若不把当前选中项留住，
 * `<select>` 里没有这个值，浏览器会退而显示第一档（「全部」），
 * 而 `sel.source` 仍是 'extend'：**筛选器说「全部」，列表却是空的**，
 * 而且用户没有任何办法退出这个筛子（那一档已经不在列表里了）。
 * 所以：**当前选中的那一档永远留在选项里**，界面因此永远不会说谎。
 *
 * 【认不出的取值要不要换个好看的名字】不要。标签是 `labelOf` 的事，
 * 来源那一维传的是 `PRACTICE.sourceLabel`，它按 copy.ts 的约定
 * **原样显示认不出的字符串**（'imported' 就显示 'imported'）——
 * 露出来才有人会去补一行；显示成「其他」反而把问题盖住了。
 */
export function filterOptions(
  present: Iterable<string>,
  order: readonly string[],
  labelOf: (value: string) => string,
  allLabel: string,
  keep?: string
): FavoriteOption[] {
  const rest = new Set(present)
  const out: FavoriteOption[] = [{ value: FAV_ALL, label: allLabel }]
  const push = (v: string): void => {
    // 数据里不可能有 `FAV_ALL`（见它上面的取值论证），但 `keep` 有可能传进来
    if (v === FAV_ALL) return
    if (out.some((o) => o.value === v)) return
    out.push({ value: v, label: labelOf(v) })
  }
  for (const v of order) if (rest.delete(v)) push(v)
  // 认不出的取值按字典序接在后面：顺序仍然固定（不看条数、不看先后）
  for (const v of [...rest].sort()) push(v)
  if (keep !== undefined) push(keep)
  return out
}

/**
 * 解析元信息要问外面的两件事（内容包那两样）。
 *
 * 宿主课那一条只要 `lang` / `stage` 两个字段（`Pick` 而不是整个 `Lesson`）——
 * 需求写成"我到底要用什么"，测试造夹具时就不必凑一门假课的二十个字段，
 * 而真调用点传完整课对象照样成立。
 */
export interface FavoriteMetaDeps {
  /** 内置题：拿全局键查运行时索引 */
  indexOf: (key: string) => QuestionIndexItem | undefined
  /** 宿主课：AI 题的语言/阶段要从它身上取 */
  lessonOf: (lessonId: string) => Pick<Lesson, 'lang' | 'stage'> | undefined
}

/**
 * 造一个 `metaOf`。
 *
 * 【内置题为什么查索引、而不是回内容包翻题】
 * 索引条目里已经带着**解析后的**难度（`buildQuestionIndex` 算好的），
 * 在这儿再调一次 `resolveDifficulty` 就是第二份规则 —— 口径一改，
 * 两处会给出不同的难度，而界面只是"筛选时少几条"，不会报错。
 *
 * 【AI 题为什么要宿主课】
 * 它的 key 里带着真实课号（宿主课），但题本身不在任何一课里，
 * 语言/阶段只能从宿主课问。宿主课没了（内容改版）就返回 null ——
 * 那正是"看不出出处"，交给 `filterFavorites` 去记账，**不猜一个默认值**。
 */
/**
 * 「这条收藏对应的题在哪」要问外面的一件事：内置题去内容包按（课号 + 题号）找。
 * 和 `FavoriteMetaDeps` 分开：那一个是**筛选**要的（连难度一起解析），
 * 这一个是**拿题目本体**要的（显示题干、开练习）。两件事的代价不一样大，
 * 分开之后调用点只付自己要的那份。
 */
export interface FavoriteQuestionDeps {
  findBuiltIn: (lessonId: string, qid: string) => Question | null
}

/**
 * 收藏条目 → 题目本体。找不到返回 null。
 *
 * 直接转发 `shared/wrongbook.ts` 的 `resolveRefQuestion`：
 * 「AI 题取自带本体、内置题查内容包、判据看 key 前缀」这条规则
 * **错题本和收藏共用一份**（理由见那个文件的抬头）。
 */
export function resolveFavoriteQuestion(
  item: FavoriteItem,
  deps: FavoriteQuestionDeps
): Question | null {
  return resolveRefQuestion(item, deps.findBuiltIn)
}

/**
 * 这一条**现在能不能开练**：题找得到、而且不是挑战题。
 *
 * 【挑战题为什么不能在这儿练】它们只在阶段综合练习 / 整门练习 / 每日挑战
 * 三处出现（主人规格），七个练习入口共用这条过滤（见 `shared/difficulty.ts`
 * 的 `isChallenge`）。收藏练习是其中之一 —— 同一道挑战题，保存进收藏夹
 * 不会让它变成随处可练的普通题。
 *
 * 【为什么单独一个函数，而不是界面里现算】错题本那边有同一条（`canRedo`，
 * 写在 PracticeView 里，views/ 不在 vitest 的 include 范围内 —— 也就是说
 * **它从来没有测试**）。收藏页不再重复那个写法：规则落在这儿，有单测钉着，
 * 界面（行内按钮显不显示、多选开卷时跳过谁）只读结论。
 */
export function canPracticeFavorite(item: FavoriteItem, deps: FavoriteQuestionDeps): boolean {
  const q = resolveFavoriteQuestion(item, deps)
  return q !== null && !isChallenge(q)
}

export function makeMetaResolver(deps: FavoriteMetaDeps): (item: FavoriteItem) => FavoriteMeta | null {
  return (item: FavoriteItem): FavoriteMeta | null => {
    if (isAiKey(item.key)) {
      const q: Question | undefined = item.ai
      // 没本体的 AI 条目是坏条目（主进程读口会丢掉它），走到这儿就当看不出出处
      if (!q) return null
      const host = deps.lessonOf(item.lessonId)
      if (!host) return null
      return { lang: host.lang, type: q.type, difficulty: resolveDifficulty(q, host.stage) }
    }
    const idx = deps.indexOf(item.key)
    if (!idx) return null
    return { lang: idx.lang, type: idx.type, difficulty: idx.difficulty }
  }
}
