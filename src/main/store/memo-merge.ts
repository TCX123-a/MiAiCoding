/**
 * memo.json 的**清洗**与**校形** —— 纯函数，不碰文件系统。
 *
 * 【两个口，两种性子】（照 favorites-merge.ts 的同款设计）
 *   · `cleanMemo(raw)` = **读口**：磁盘上的东西长什么样都得认。
 *     坏条目丢掉（并且出声），好的留下 —— 「能救的必须救」。
 *   · `sanitizeMemo(raw)` = **写口**：入参是我们自己的渲染层交上来的，
 *     形状不对就是它写错了，该炸得响亮（和 config-merge / favorites 一个规矩）。
 * 两边共用同一个 `cleanItem`，差别只在「遇到坏条目是丢还是抛」，
 * 所以**不会**出现「读时候认、写时候拒」这种两套标准。
 *
 * 【为什么这个文件比收藏那边更要紧】
 * 收藏是「用户点了一下」出来的东西，丢了还能再点一次；备忘是**用户自己敲的字**
 * —— 丢了就真没了，用户自己也复述不出来。所以写口那条「不许悄悄丢条目」的规矩
 * 在这里的代价更高：写口丢一条 = 「界面挺对，重启之后我的笔记没了」。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律英文**，中文只出现在注释里。
 */
import {
  CURRENT_MEMO_VERSION,
  MEMO_BODY_MAX,
  utf8Bytes,
  type MemoFile,
  type MemoItem,
  type MemoKind
} from '../../shared/types'

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 非空字符串才算数；空的、纯空白的、非字符串一律 null（同 favorites-merge 的 str） */
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/** 有限数才算时间戳（其余一律走兜底）；负数当「没写」——时间戳不可能是负的 */
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : fallback
}

/** 认得的分类。**只能在这里列一遍** —— 别处再写一份就会漂移（加上 'snippet' 时漏改一处） */
const MEMO_KINDS: readonly MemoKind[] = ['code', 'knowledge']

function isMemoKind(v: unknown): v is MemoKind {
  return typeof v === 'string' && (MEMO_KINDS as readonly string[]).includes(v)
}

/** 时间戳丢了的兜底：按「最古老」算（1970），不假装知道是什么时候写的 */
const UNKNOWN_TIME = 0

/**
 * 清洗一条备忘。**认不出就返回 null**（读口丢弃、写口抛错）。
 *
 * 【哪些字段坏了就整条不要】
 *   · `id` 空 / 非串 —— 没有身份，列表选中、删除都指不到它，去重也没法做；
 *   · `kind` 不认识 —— 分类筛选会把它归进一个不存在的档，界面无法解释；
 *   · `body` 非串或超过 64KB —— 内容本体坏了，留着就是一条点开是乱码/空白的备忘。
 * 读口把它丢掉（汇总出声），写口为它抛错（见 sanitizeMemo）。
 *
 * 【哪些字段坏了**不丢条**，尽量救】
 *   · `title` 非串 → 退回空串。标题只是列表的索引（空标题的条目界面上照常显示
 *     正文摘要），为了一个坏标题丢掉用户敲的整段正文，代价完全不成比例；
 *   · `createdAt` / `updatedAt` 坏了 → 退回「最古老」/ 跟随 createdAt。
 *     时间只影响排序与「几天前」的显示，同样不值得丢内容。
 * 这条分界线的判据是：**坏掉的这个字段是不是内容本身**。
 */
function cleanItem(raw: unknown): MemoItem | null {
  if (!isObject(raw)) return null

  const id = str(raw.id)
  if (!id) return null

  if (!isMemoKind(raw.kind)) return null

  if (typeof raw.body !== 'string') return null
  // 超长条目在读口也是坏条目（丢掉、出声）。**不截断**：截断会在用户毫不知情的
  // 情况下改掉他写的字，而下一次保存就把磁盘上那份也覆盖成截断版 ——
  // 丢是出声的，改是无声的，这里宁可出声。
  if (utf8Bytes(raw.body) > MEMO_BODY_MAX) return null

  const createdAt = num(raw.createdAt, UNKNOWN_TIME)
  return {
    id,
    kind: raw.kind,
    title: typeof raw.title === 'string' ? raw.title : '',
    body: raw.body,
    createdAt,
    updatedAt: num(raw.updatedAt, createdAt)
  }
}

/**
 * 清洗一批 `T`，同时**按某个字段去重**（先来的赢）。
 *
 * 去重不是"顺手规范化"：id 在语义上是身份 —— 两条同 id 的备忘摆在列表里，
 * 「我点的是哪一条」说不清，删掉其中一条另一条还活着。和 favorites-merge 里
 * 那份同源的实现（那边的对象是 key，这边是 id）。
 */
function cleanList<T>(list: unknown[], idOf: (t: T) => string, clean: (raw: unknown) => T | null) {
  const out: T[] = []
  const seen = new Set<string>()
  let dropped = 0
  for (const raw of list) {
    const one = clean(raw)
    if (!one || seen.has(idOf(one))) {
      dropped++
      continue
    }
    seen.add(idOf(one))
    out.push(one)
  }
  return { list: out, dropped }
}

/**
 * 读口：把磁盘上那坨东西搬成一份完整的备忘文件。
 *
 * 版本表：
 *   1 = 2026-10-08（P3 ②）起：这个文件才出现。
 *
 * `needsRewrite` 为 true 的三种情况：不是信封 / version 不认识 / 有东西被丢掉。
 * 落盘由调用方决定（和 favorites 的读口同一套账：正常的每次启动**一个字节都不写**）。
 */
export function cleanMemo(raw: unknown): { file: MemoFile; needsRewrite: boolean } {
  const empty: MemoFile = { version: CURRENT_MEMO_VERSION, items: [] }

  if (raw === null || raw === undefined) return { file: empty, needsRewrite: false }

  if (!isObject(raw) || !Array.isArray(raw.items)) {
    // 不是这个文件的形状（手改坏了 / 别的程序写的）。**出声**再给一份空的 ——
    // 铁律不许静默重建；而且写回去之前 json-store 会先把它备份成 .bak，原件还在
    console.warn('[miai] memo.json is not a memo file, starting empty')
    return { file: empty, needsRewrite: true }
  }

  const items = cleanList<MemoItem>(raw.items, (i) => i.id, cleanItem)
  if (items.dropped > 0) {
    console.warn(`[miai] memo.json: dropped ${items.dropped} invalid entries during migration`)
  }

  return {
    file: { version: CURRENT_MEMO_VERSION, items: items.list },
    needsRewrite: items.dropped > 0 || raw.version !== CURRENT_MEMO_VERSION
  }
}

/**
 * 写口：渲染层交上来的整份备忘录，校形 + 清洗，返回**要落盘的那一份**。
 *
 * 坏条目**抛错**（不像读口那样丢）：调用方是我们自己的代码，形状不对属于写错了，
 * 悄悄丢一条的后果是「用户敲了一晚上的笔记，界面上还在，重启之后没了」。
 * 抛出去，至少在开发期当场就知道 —— 而且写口一抛，`memoStore.write` 根本不会被调用，
 * **一个字节都不落盘**（旧的那份文件原样留着，用户还能找回来）。
 */
export function sanitizeMemo(raw: unknown): MemoFile {
  if (!isObject(raw) || !Array.isArray(raw.items)) {
    throw new Error('invalid memo payload')
  }
  // 和读口**同一个**判别式，但这里把「丢掉了」当成错误：写进来的东西必须是干净的
  const items = cleanList<MemoItem>(raw.items, (i) => i.id, cleanItem)
  if (items.dropped > 0) throw new Error('invalid memo payload')

  return { version: CURRENT_MEMO_VERSION, items: items.list }
}
