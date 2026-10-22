/**
 * favorites.json 的**清洗**、**校形**与**写口 apply** —— 纯函数，不碰文件系统。
 *
 * 【三个口，两种性子】
 *   · `normalizeFavorites(raw)` = **读口**：磁盘上的东西长什么样都得认。
 *     坏条目丢掉（并且出声），好的留下 —— 「能救的必须救」。
 *   · `cleanFavoritesPayload(raw)` = 入参校形：渲染层交上来的条目形状不对
 *     就是它写错了，该炸得响亮（和 config-merge / wrongbook 一个规矩）。
 *   · `applyFavoritesSave(...)` = **写口**（P10.1 头号 bug 的修复处）：
 *     以磁盘原始 JSON 为基底 apply 业务字段（**未知键全保留**），
 *     并按 diff 维护 v2 的 `updatedAt` 与两张墓碑表。渲染层交上来的
 *     `updatedAt` / 墓碑**一律不听** —— 那两样归主进程独占。
 * 三个口共用同一个 `cleanItem` / `cleanFolder`，差别只在「遇到坏条目丢还是抛」，
 * 所以**不会**出现「读时候认、写时候拒」这种两套标准。
 *
 * 【为什么要有这个文件（而不是扔在 handler 里）】
 * 收藏里最要命的一条规矩是「**AI 题必须带本体**」：AI 题不在任何一课里，
 * 光有 key 找不回题干和选项 —— 显示是空白、点重做静默跳过，
 * 和错题本当年那条死条目一模一样。这种规矩放在 handler 里就没法单测。
 *
 * 【v2 的墓碑为什么单独两张表（removedItems / removedFolders）】
 * 条目数组是渲染层的业务字段（它交上来的是「活着的条目」），墓碑如果挂在
 * 条目上，渲染层一个整份覆盖就连根刨了。分开放，写口的保留区基底负责兜住它们。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，**字符串一律英文**，中文只出现在注释里。
 */
import {
  CURRENT_FAVORITES_VERSION,
  type FavoriteFolder,
  type FavoriteItem,
  type FavoritesFile,
  type Question
} from '../../shared/types'
import { isAiKey, parseQuestionKey } from '../../shared/question-key'

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 非空字符串才算数；空的、纯空白的、非字符串一律 null */
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/** 时间丢了时按「最古老」算（排序在最后，且不假装知道是什么时候发生的） */
const UNKNOWN_TIME = '1970-01-01T00:00:00.000Z'

/**
 * 清洗一条收藏。**认不出就返回 null**（读口丢弃、写口抛错）。
 *
 * 【lessonId / qid 一律从 key 重算】它们是从 key 拆出来的派生值，key 才是身份。
 * 信文件里那份的话，一旦两边不一致（手改过），就会出现「显示在一课、重做时按另一课找」
 * 这种谁也查不出的错位。规则和 wrongbook-merge 的 cleanEntry 一字不差。
 */
function cleanItem(raw: unknown): FavoriteItem | null {
  if (!isObject(raw)) return null
  const key = str(raw.key)
  if (!key) return null

  const ai = isAiKey(key)
  // AI 题没本体 = 死条目（见文件头）。读口把它当坏条目丢掉，写口为它抛错
  if (ai && !isObject(raw.ai)) return null

  const addedAt = str(raw.addedAt) ?? UNKNOWN_TIME
  const item: FavoriteItem = {
    key,
    // 走公共的拆键函数，**不在这里手写 indexOf** —— 拆键规则（按第一个冒号切、
    // 没有冒号时整个当课号）只能有一份实现，见 shared/question-key.ts 的头注释
    ...parseQuestionKey(key),
    addedAt,
    // v2 的 updatedAt：老文件（v1）没有它，按 addedAt 回填（真实事件时刻，
    // 比伪造 now 诚实；缺失时兜 UNKNOWN_TIME —— 保守方向，见 types.ts 的注释）
    updatedAt: str(raw.updatedAt) ?? addedAt
  }
  const source = str(raw.source)
  if (source) item.source = source
  const folderId = str(raw.folderId)
  if (folderId) item.folderId = folderId
  // 笔记**不 trim**：它是用户写给人看的话，首尾的空格/换行是内容的一部分。
  // 但整条全是空白的按「没有笔记」算 —— 界面上会显示「加一条笔记喵」，
  // 而不是一个看着有、点开空白的框
  if (typeof raw.note === 'string' && raw.note.trim() !== '') item.note = raw.note
  if (ai) item.ai = raw.ai as unknown as Question
  return item
}

/** 清洗一个文件夹；认不出返回 null */
function cleanFolder(raw: unknown): FavoriteFolder | null {
  if (!isObject(raw)) return null
  const id = str(raw.id)
  const name = str(raw.name)
  if (!id || !name) return null
  const createdAt = str(raw.createdAt) ?? UNKNOWN_TIME
  return { id, name, createdAt, updatedAt: str(raw.updatedAt) ?? createdAt }
}

/**
 * 清洗一张 `Record<key, ISO时刻>` 墓碑表。只留「非空字符串键 → 非空字符串值」，
 * 坏条目丢弃并计数（由调用方汇总出声）。
 */
function cleanTimeMap(v: unknown): { map: Record<string, string>; dropped: number } {
  const map: Record<string, string> = {}
  if (!isObject(v)) return { map, dropped: 0 }
  let dropped = 0
  for (const [key, value] of Object.entries(v)) {
    if (key.trim() === '' || typeof value !== 'string' || value.trim() === '') {
      dropped++
      continue
    }
    map[key] = value
  }
  return { map, dropped }
}

/** 空收藏夹（v2 完整形状 —— 墓碑表**绝不 undefined**，合并逻辑直接读它） */
function emptyFavorites(): FavoritesFile {
  return {
    version: CURRENT_FAVORITES_VERSION,
    updatedAt: UNKNOWN_TIME,
    folders: [],
    items: [],
    removedItems: {},
    removedFolders: {}
  }
}

/**
 * 清洗一批 `T`，同时**按某个字段去重**（先来的赢）。
 *
 * 去重不是"顺手规范化"：这几列在语义上都是集合（同一条题收藏两次没有意义，
 * 两个同 id 的文件夹会让「移动到这里」指到哪个说不清）。重复项留着，
 * 表现是列表里出现两条一模一样的、或者删掉一个文件夹之后另一个还在。
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
 * 把 `items` 里指向**不存在的文件夹**的 `folderId` 摘掉（条目本身留着，回"未分组"）。
 *
 * 【为什么在文件边界上做，而不是只靠界面】
 * 界面那边的规矩是「删掉文件夹时把里面的条目移到未分组」，但那是**一条界面路子**：
 * 将来多一个入口（右键菜单、批量操作、导入），漏一次就会留下一批
 * `folderId` 指向空气的条目 —— 它们在任何文件夹筛选里都**不出现**，
 * 看着就是"收藏自己少了"。放在这里，写进磁盘的那一份永远是自洽的。
 */
function dropOrphanFolders(file: FavoritesFile): FavoritesFile {
  const ids = new Set(file.folders.map((f) => f.id))
  return {
    ...file,
    items: file.items.map((it) => {
      if (it.folderId === undefined || ids.has(it.folderId)) return it
      const next = { ...it }
      delete next.folderId
      return next
    })
  }
}

/**
 * 读口：把磁盘上那坨东西搬成一份完整的收藏夹（v2）。
 *
 * 版本表：
 *   1 = 2026-09-29（学习闭环）起：这个文件才出现；
 *   2 = P10.1：加 `updatedAt`（文件级 + 条目/文件夹内联）与两张墓碑表。
 *       老文件按 addedAt / createdAt 回填条目时间戳、文件级与墓碑按「最古老」，
 *       **不伪造 now** —— 伪造会在合并比较里错误胜出（和 profile v4 同一笔账）。
 *
 * `needsRewrite` 为 true 的情况：不是信封 / version 不认识 / 有东西被丢掉 /
 * v2 该有的字段缺失。落盘由调用方决定（正常的每次启动**一个字节都不写**）。
 */
export function normalizeFavorites(raw: unknown): {
  file: FavoritesFile
  needsRewrite: boolean
} {
  if (raw === null || raw === undefined) return { file: emptyFavorites(), needsRewrite: false }

  if (!isObject(raw) || !Array.isArray(raw.folders) || !Array.isArray(raw.items)) {
    // 不是这个文件的形状（手改坏了 / 别的程序写的）。**出声**再给一份空的 ——
    // 铁律不许静默重建；而且写回去之前 json-store 会先把它备份成 .bak，原件还在
    console.warn('[miai] favorites.json is not a favorites file, starting empty')
    return { file: emptyFavorites(), needsRewrite: true }
  }

  const folders = cleanList<FavoriteFolder>(raw.folders, (f) => f.id, cleanFolder)
  const before = cleanList<FavoriteItem>(raw.items, (i) => i.key, cleanItem)
  const removedItems = cleanTimeMap(raw.removedItems)
  const removedFolders = cleanTimeMap(raw.removedFolders)
  const file = dropOrphanFolders({
    version: CURRENT_FAVORITES_VERSION,
    updatedAt: str(raw.updatedAt) ?? UNKNOWN_TIME,
    folders: folders.list,
    items: before.list,
    removedItems: removedItems.map,
    removedFolders: removedFolders.map
  })

  // 孤儿 folderId 被摘掉也算「这次动过它」：不标记的话，界面按文件夹筛选时
  // 那条题会一直落在看不见的地方，直到下一次保存才被顺手修好。
  //
  // 【只数「被摘掉」的，不是「没有 folderId」的】（2026-10-14 修）原公式是
  // `before.list.length - 摘后仍有 folderId 的条数`，把**本来就没有 folderId**
  // 的条目（不建文件夹的用户的常态）也算成孤儿 ⇒ needsRewrite 永真，读口每次读
  // 都写盘（rev++），favorites:save 在写回调里先跑一次读口把戳自顶掉、随后带
  // 渲染层旧戳的写必被 StaleRevError 拒 —— 用户看到「收藏成功」、重启后消失。
  // 两侧同用「有 folderId 的条数」相减，得到的才是真正被摘掉的孤儿数。
  const orphans =
    before.list.filter((i) => i.folderId !== undefined).length -
    file.items.filter((i) => i.folderId !== undefined).length
  const dropped = folders.dropped + before.dropped + removedItems.dropped + removedFolders.dropped
  if (dropped > 0) {
    console.warn(`[miai] favorites.json: dropped ${dropped} invalid entries during migration`)
  }

  return {
    file,
    needsRewrite:
      dropped > 0 ||
      orphans > 0 ||
      raw.version !== CURRENT_FAVORITES_VERSION ||
      str(raw.updatedAt) === null || // v2 该有的字段缺失：下次落盘顺手补齐
      !isObject(raw.removedItems) ||
      !isObject(raw.removedFolders)
  }
}

/**
 * 入参校形：渲染层交上来的整份收藏夹（业务字段），坏东西**抛错**
 * （不像读口那样丢）：调用方是我们自己的代码，形状不对属于写错了，
 * 悄悄丢一条的后果是「用户点了收藏、界面也显示收藏了，重启之后没了」。
 * 抛出去，至少在开发期当场就知道。
 */
export function cleanFavoritesPayload(raw: unknown): {
  folders: FavoriteFolder[]
  items: FavoriteItem[]
} {
  if (!isObject(raw) || !Array.isArray(raw.folders) || !Array.isArray(raw.items)) {
    throw new Error('invalid favorites payload')
  }
  const folders = cleanList<FavoriteFolder>(raw.folders, (f) => f.id, cleanFolder)
  // 和读口**同一个**判别式，但这里把「丢掉了」当成错误：写进来的东西必须是干净的
  if (folders.dropped > 0) throw new Error('invalid favorites payload')

  const items = cleanList<FavoriteItem>(raw.items, (i) => i.key, cleanItem)
  if (items.dropped > 0) throw new Error('invalid favorites payload')

  return { folders: folders.list, items: items.list }
}

/** 业务内容相等（忽略主进程独占的 updatedAt）：两份都出自 cleanItem，键序稳定，直接比串 */
function sameBusiness(a: { [k: string]: unknown }, b: { [k: string]: unknown }): boolean {
  return JSON.stringify({ ...a, updatedAt: undefined }) === JSON.stringify({ ...b, updatedAt: undefined })
}

/**
 * 按 key/id 维护「条目 ↔ 墓碑」配对与 `updatedAt`，返回新的活条目/墓碑表。
 *
 * 规则（与 profile v4 的 syncToggles 对偶）：
 *   · 载荷里的条目：**撤销**同名墓碑；内容变过（或本来没有）→ updatedAt = now，
 *     没变 → 保留磁盘上的 updatedAt（不是每次保存都把全表刷新成 now）；
 *   · 磁盘上有、载荷里没了 → 盖墓碑 = now；
 *   · 载荷里没有、磁盘上也没有的旧墓碑 → 原样保留（别人设备的删除证据，写口不碰）。
 */
function applyToggles<T extends { updatedAt?: string }>(
  baseList: readonly T[],
  payloadList: readonly T[],
  idOf: (t: T) => string,
  tomb: Record<string, string>,
  now: string
): T[] {
  const baseIndex = new Map(baseList.map((x) => [idOf(x), x]))
  const out = payloadList.map((item) => {
    const id = idOf(item)
    delete tomb[id] // 载荷里存在的 id 一律无墓碑（重新收藏 = 撤销；顺带修坏对）
    const baseItem = baseIndex.get(id)
    if (baseItem && sameBusiness(baseItem, item)) {
      return { ...item, updatedAt: baseItem.updatedAt ?? now }
    }
    return { ...item, updatedAt: now }
  })
  const payloadIds = new Set(out.map(idOf))
  for (const baseItem of baseList) {
    const id = idOf(baseItem)
    if (!payloadIds.has(id)) tomb[id] = now
  }
  return out
}

export interface FavoritesSaveInput {
  /** 磁盘原始 JSON（可能为 null = 还没有文件）。保留区的基底 */
  diskRaw: unknown
  /** 读口产物（`readFavorites()`）—— 墓碑与 updatedAt 的真源 */
  current: FavoritesFile
  /** 渲染层交上来的快照（folders / items 两个业务数组） */
  payload: unknown
  /** 本次写入时刻（ISO） */
  now: string
}

/**
 * 写口：返回**要落盘的那一份**。
 *
 * 【保留区纪律】`{...base}` 把磁盘上的未知键先摊进来 —— 这是「渲染层零改动」
 * 成立的前提（docs/21 §8.3 的保留区责任）；认识的键再逐个覆盖。
 * 渲染层交上来的 `updatedAt` / 墓碑表**不听**（主进程独占）。
 */
export function applyFavoritesSave(input: FavoritesSaveInput): FavoritesFile {
  const { diskRaw, current, payload, now } = input
  const cleaned = cleanFavoritesPayload(payload)

  const removedItems = { ...(current.removedItems ?? {}) }
  const removedFolders = { ...(current.removedFolders ?? {}) }
  const items = applyToggles(current.items, cleaned.items, (i) => i.key, removedItems, now)
  const folders = applyToggles(current.folders, cleaned.folders, (f) => f.id, removedFolders, now)

  const base = isObject(diskRaw) ? diskRaw : {}
  return dropOrphanFolders({
    ...base, // 保留区：磁盘上的未知键全部保留
    version: CURRENT_FAVORITES_VERSION,
    updatedAt: now,
    folders,
    items,
    removedItems,
    removedFolders
  })
}
