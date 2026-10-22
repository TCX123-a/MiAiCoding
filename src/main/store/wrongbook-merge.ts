/**
 * wrongbook.json 的合并与裁剪 —— **纯函数，不碰文件系统**。
 *
 * 【为什么不写在 IPC handler 里】
 * 和 config-merge.ts / challenge-merge.ts 同一个理由：handler 里那段逻辑没法单测，
 * 而这里的规矩（AI 题必带本体、超上限丢最旧的）**错了不会报错**，
 * 只会某天发现错题本里躺着一条点不开的死条目，或者用户攒了两百条看不完的 AI 题。
 *
 * 【收 AI 题的代价，和为什么值得】
 * AI 题不在任何一课里，「课号 + 题号」找不回原样，所以以前一律不收（2026-09-13 前）。
 * 主人后来拍板要收 —— 错了的 AI 题也是自己错的，凭什么不能复习。
 * 收的前提是**连本体一起存**（WrongBookEntry.ai），本体在，显示和重做都用它，
 * 那两个老问题（题干显示成「题目已被移走喵」、答对了也消除不掉）就同时没了。
 * 代价是文件变大，所以配一条上限，见 AI_WRONG_CAP。
 *
 * 【这个文件里不许出现中文】（它在 src/ 下，会被文案闸门扫）
 *
 * 【信封（2026-09-29 学习闭环）】这个文件的根以前是**裸数组**，连版本号都没有。
 * 本期加了 source / removed / hole 三个字段，正是 CLAUDE.md 铁律 6 说的「改结构」，
 * 所以根换成了 `{ version, entries }` 信封，老文件由 `normalizeWrongbook()` 兼容，
 * 读口顺手把信封写回去 —— **不丢一条错题**。
 */
import {
  AI_WRONG_CAP,
  CURRENT_WRONGBOOK_VERSION,
  type Question,
  type WrongBookEntry,
  type WrongBookFile,
  type WrongRecordItem,
  type WrongUpdateItem
} from '../../shared/types'
import { isAiKey, parseQuestionKey } from '../../shared/question-key'

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 校验一条入参。非法一律抛，和 config-merge 一个规矩：宁可报错，不写半条脏数据 */
export function assertWrongRecordItem(v: unknown): asserts v is WrongRecordItem {
  if (!isObject(v)) throw new Error('invalid wrongbook payload')
  if (typeof v.key !== 'string' || v.key === '') throw new Error('invalid wrongbook payload')
  if (v.ai !== undefined && !isObject(v.ai)) throw new Error('invalid wrongbook payload')
  // source 是「这次在哪错的」（模式名）。取值不设枚举（理由见 types.ts 里那条注释），
  // 但**形状要管**：非字符串、或者空串，都是调用方写错了 —— 空串存进去，
  // 界面上那枚来源徽章会渲染成一片空白，既不是"练习"也不是任何模式。
  if (v.source !== undefined && (typeof v.source !== 'string' || v.source === '')) {
    throw new Error('invalid wrongbook payload')
  }
  // **AI 题必须带本体**。少了它，这条记录就是我们要避免的那种死条目：
  // 题干显示不出来、重做时被静默跳过、答对了也消除不掉，永远赖在列表里。
  // 在这里当场拒掉，好过让它安安静静写进磁盘再也没人发现
  if (isAiKey(v.key) && v.ai === undefined) throw new Error('invalid wrongbook payload')
}

/**
 * 这批错题里，**哪些是「删过又答错」的**（合并之前先问，问完就没了）。
 *
 * 【为什么必须单独一个函数、而且必须在 merge 之前调】
 * `mergeWrongRecord` 的复活语义（:82-85）会把 `removed`/`removedAt` **删掉** ——
 * 合并之后，这条记录和一条从没被删过的记录长得一模一样，
 * 「它曾经被删过」这件事在数据里已经不存在了，谁也再看不出来。
 * 而产品要求这件事**不能静默发生**：界面上得有一句
 * 「这条你删过，又答错了喵」—— 用户以为删掉的东西自己回来了，
 * 没有任何解释的话，那是比不复活更糟的体验（会以为删除功能坏了）。
 *
 * 所以唯一的时机是**合并前**：main handler 读一次 all → 先问这里 → 再合并 →
 * 把返回的键随回复带给渲染层 → finish() 弹 toast。
 *
 * 【为什么按 key 去重】
 * 一次 finish 里同一道题只会出现一次（一个会话内不会重复出题），
 * 但入参是外部来的数组，重复 key 是**调用方写错**的形态之一 ——
 * 这里不抛（校验是 assertWrongRecordItem 的活，merge 会炸），
 * 只保证「同一个 key 最多报一次」，免得将来弹两条一样的 toast。
 *
 * @param all   合并**之前**的记录（必须是 merge 前那一份）
 * @param items 这次要记的错题
 */
export function findRevivedKeys(
  all: readonly WrongBookEntry[],
  items: readonly WrongRecordItem[]
): string[] {
  const revived: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (!isObject(item) || typeof item.key !== 'string') continue
    if (seen.has(item.key)) continue
    const ex = all.find((e) => e.key === item.key)
    // removed === true 是唯一的读法（cleanEntry 只在 true 时写这个字段，
    // 「字段在 = 删过」，见那里 :196-202 的注释）
    if (ex?.removed === true) {
      seen.add(item.key)
      revived.push(item.key)
    }
  }
  return revived
}

/**
 * 一次答错记账的**完整组合**：先问复活名单，再合并。
 *
 * 【为什么把顺序收进这个纯函数，而不是留在 IPC handler 里】
 * 顺序反了（先合并、再问名单）**不会报错**：`mergeWrongRecord` 复活时会把
 * `removed` 字段删掉（:127-128），之后再问 `findRevivedKeys` 永远得到空名单 ——
 * 表现是「你删过的那道题又答错了」这句提示**永久沉默**，而那是它唯一的意义。
 * 这个顺序待在 handler 里时没有任何测试守得住（handler 挂不上单测），
 * 收进来之后一条用例就能把两件事钉在同一次调用里（见 __tests__）。
 *
 * @param all   合并**之前**的记录（首次运行传 null）
 * @param items 这次要记的错题
 * @param now   当前时刻（由调用方给，理由同 mergeWrongRecord）
 */
export function applyWrongRecord(
  all: WrongBookEntry[] | null,
  items: WrongRecordItem[],
  now: string
): { entries: WrongBookEntry[]; revived: string[] } {
  const revived = findRevivedKeys(all ?? [], items)
  return { entries: mergeWrongRecord(all, items, now), revived }
}

/**
 * 把一批错题并进记录，并裁掉超出上限的 AI 题。
 *
 * @param all   现有记录（首次运行传 null）
 * @param items 这次要记的
 * @param now   当前时刻。**由调用方给，不在这个函数里读时钟** ——
 *              读时钟的函数没法测，而「哪一条最旧该被丢掉」正是最需要测的地方
 */
export function mergeWrongRecord(
  all: WrongBookEntry[] | null,
  items: WrongRecordItem[],
  now: string
): WrongBookEntry[] {
  const out = (all ?? []).map((e) => ({ ...e }))

  for (const item of items) {
    assertWrongRecordItem(item)
    const { lessonId, qid } = parseQuestionKey(item.key)
    const ai = isAiKey(item.key)
    const ex = out.find((e) => e.key === item.key)

    if (ex) {
      ex.wrongCount++
      ex.lastWrongAt = now
      ex.cleared = false
      delete ex.clearedAt
      // 又错一次 = **从"已移除"里复活**。规格钦定：再答错即使被删也恢复成在库、
      // 并且计数继续累加。删掉 removed/removedAt 两个字段而不是置 false ——
      // 「字段在 = 删过」让筛选和判空只有一种读法，少一个能想歪的地方。
      delete ex.removed
      delete ex.removedAt
      // 来源徽章跟着**最近一次答错**走（不是第一次，也不是"内容来源"）
      if (item.source) ex.source = item.source
      if (ai) ex.ai = item.ai
    } else {
      out.push({
        key: item.key,
        lessonId,
        qid,
        wrongCount: 1,
        lastWrongAt: now,
        cleared: false,
        // source 是选填：老调用点（不传的）照样记账，只是没有徽章
        ...(item.source ? { source: item.source } : {}),
        // **内置题不带本体**：带了就是第二份真源，将来改了内容包，
        // 错题本里那份还是旧的，同一个坑在 ChallengeQuestion 那边已经交代过。
        // 渲染进程即使误传了也不收 —— 不能让一个上游的 bug 把两份真源写进磁盘
        ...(ai ? { ai: item.ai } : {})
      })
    }
  }

  return trimAi(out)
}

/**
 * 给 AI 题封顶，超出就丢**最久没做错**的那条。
 *
 * 【为什么丢的是「最久没错的」而不是「最早收进来的」】
 * `wrongCount` 高的那条多半是用户反复栽的地方，那正是他最该再看的题。
 * 按 `lastWrongAt` 丢，等于保留「最近还在错的」，和「错题本该反映当下薄弱点」
 * 是一致的。按收进来的先后丢，会把一条昨天刚错了第 5 次的题干掉，
 * 留下一条上个月错了一次、之后一直没错的。
 *
 * 【已经毕业（cleared）的 AI 题也一起数】
 * 不搞特殊：毕业的条目 `lastWrongAt` 停在「当初做错那天」，天然排在后面，
 * 真到要丢的时候先丢的就是它们。
 * 这样 `wrongbook:clear` 一个字都不用改，内置题那句「历史会保留」对 AI 题
 * 也照样成立 —— 少一条只对某类题生效的规矩，就少一个能想歪的地方。
 *
 * 【手动删掉（removed）的**不数、也不丢**】（2026-09-29 起）
 * 上限管的是「列表里能看到几条」，已移除的那批按定义不在列表里，
 * 挤占名额会让「我明明只删了一条，怎么活着的少了两条」这种账对不上。
 * 更不能反过来把它们丢掉：软删的全部意义就是**还能恢复**，
 * 顺手裁掉一批已移除的 AI 题，等于"回收站自己倒垃圾"。
 */
function trimAi(all: WrongBookEntry[]): WrongBookEntry[] {
  const ai = all.filter((e) => isAiKey(e.key) && !e.removed)
  if (ai.length <= AI_WRONG_CAP) return all

  // 最旧的排前面；要丢的就是前面多出来的那些
  const doomed = new Set(
    [...ai]
      .sort((a, b) => a.lastWrongAt.localeCompare(b.lastWrongAt))
      .slice(0, ai.length - AI_WRONG_CAP)
      .map((e) => e.key)
  )
  return all.filter((e) => !doomed.has(e.key))
}

// ---------------------------------------------------------------- 读口：信封与条目清洗

/** 非空字符串才算数（身份/时刻类字段用）；空的、纯空白的、非字符串一律 null */
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/**
 * 一条错题的次数：**至少 1**。
 * 文件里写坏成 0 / 负数 / 字符串的时候按 1 算 —— 它**在**错题本里，
 * 就说明至少错过一次，而界面上「错过 0 次」是一句自相矛盾的话。
 */
function times(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1
  return Math.max(Math.round(v), 1)
}

/** 时刻丢了（文件写坏）时按「最古老」算：trimAi 真要丢就第一个丢它 */
const UNKNOWN_TIME = '1970-01-01T00:00:00.000Z'

/**
 * 清洗磁盘上的一条错题。**不认得就返回 null**（调用方丢弃并数数，出声）。
 *
 * 【lessonId / qid **一律从 key 重算**，不听文件里那份】
 * 它们是从 key 拆出来的派生值，而 key 才是身份。文件里那两份一旦和 key 不一致
 * （手改过、早期版本拆错过），信谁就成了随机选择 —— 信 key，因为所有判据
 * （isAiKey、resolveWrongQuestion、重做时回内容包找题）实际用的都是 key。
 */
function cleanEntry(raw: unknown): WrongBookEntry | null {
  if (!isObject(raw)) return null
  const key = str(raw.key)
  if (!key) return null

  const ai = isAiKey(key)
  // AI 题没本体 = 那种「点不开、消除不掉」的死条目（见 assertWrongRecordItem 的注释）。
  // 它在磁盘上已经坏了，留着只会让用户以为它还能用 —— 丢掉，并且出声（调用方数数）
  if (ai && !isObject(raw.ai)) return null

  const { lessonId, qid } = parseQuestionKey(key)
  const entry: WrongBookEntry = {
    key,
    lessonId,
    qid,
    wrongCount: times(raw.wrongCount),
    lastWrongAt: str(raw.lastWrongAt) ?? UNKNOWN_TIME,
    cleared: raw.cleared === true
  }
  const clearedAt = str(raw.clearedAt)
  if (clearedAt) entry.clearedAt = clearedAt
  const source = str(raw.source)
  if (source) entry.source = source
  // removed / hole 只在 **true** 时才写回字段：缺席 = 没有。
  // 这样「字段在不在」和「是不是真的」永远同向，筛选器不用去分辨 false 和 undefined
  if (raw.removed === true) {
    entry.removed = true
    const removedAt = str(raw.removedAt)
    if (removedAt) entry.removedAt = removedAt
  }
  if (raw.hole === true) entry.hole = true
  // 内置题即使文件里带着本体也不收（第二份真源，理由同 mergeWrongRecord 里那段）
  if (ai) entry.ai = raw.ai as unknown as Question
  return entry
}

function cleanEntries(list: unknown[]): { entries: WrongBookEntry[]; dropped: number } {
  const entries: WrongBookEntry[] = []
  const seen = new Set<string>()
  let dropped = 0
  for (const raw of list) {
    const e = cleanEntry(raw)
    // 同一个 key 出现两次 = 文件被外部改过。**留第一条** ——
    // merge 的 `find` 也是取第一条，保它才和「谁先来谁生效」的既有行为一致；
    // 多出来的数进 dropped，让它出声
    if (!e || seen.has(e.key)) {
      dropped++
      continue
    }
    seen.add(e.key)
    entries.push(e)
  }
  return { entries, dropped }
}

/**
 * 把磁盘上那坨东西搬成一份**完整的信封** —— 读口的唯一入口（main 的 readWrongbook）。
 *
 * 版本表：
 *   1 = 2026-09-29 起。根从**裸数组**换成信封；条目加 source / removed / hole。
 *       老文件（裸数组、条目里没有那三个字段）和 v1 是同一批数据的两种写法，
 *       所以两种形状都要认 —— 见下面第一个分支。
 *
 * `needsRewrite` = 「磁盘上那份和内存里这份不一样，值得写回去」，三种情况为 true：
 *   ① 认出了裸数组（要把它换成信封）② version 不是当前值 ③ 有条目被丢掉。
 *
 * 【为什么要有这个标记，而不是干脆每次都写】读口**每次启动**都会跑，
 * 无条件写盘 = 每开一次应用就重写一遍错题本；而这个文件的正常路径一个字都不该变。
 * 只在真的不是信封、或者这次迁掉了东西时才落盘。
 */
export function normalizeWrongbook(raw: unknown): { file: WrongBookFile; needsRewrite: boolean } {
  if (raw === null || raw === undefined) {
    // 文件还不存在（首次运行）。给空信封但**不重写** —— 空手建一个没意义，
    // 等第一条错题进来时自然就有了
    return { file: { version: CURRENT_WRONGBOOK_VERSION, entries: [] }, needsRewrite: false }
  }

  // 老文件：根是裸数组
  if (Array.isArray(raw)) {
    const { entries, dropped } = cleanEntries(raw)
    if (dropped > 0) {
      console.warn(`[miai] wrongbook.json: dropped ${dropped} invalid entries during migration`)
    }
    return { file: { version: CURRENT_WRONGBOOK_VERSION, entries }, needsRewrite: true }
  }

  if (!isObject(raw) || !Array.isArray(raw.entries)) {
    // 既不是数组也不是信封：文件被外部程序或手改写坏了。**出声**（铁律禁止静默重建），
    // 并标记重写把文件修回合法形状 —— 写回去之前 json-store 会先把这份坏文件
    // 备份成 .bak，所以它不会被真正抹掉，还有得查
    console.warn('[miai] wrongbook.json is not a wrong book, starting empty')
    return { file: { version: CURRENT_WRONGBOOK_VERSION, entries: [] }, needsRewrite: true }
  }

  const { entries, dropped } = cleanEntries(raw.entries)
  if (dropped > 0) {
    console.warn(`[miai] wrongbook.json: dropped ${dropped} invalid entries during migration`)
  }
  // 版本号不认识也照读：宁可多认一份"未来的文件"，也不要把它当坏文件清掉（同 config 的取舍）
  return {
    file: { version: CURRENT_WRONGBOOK_VERSION, entries },
    needsRewrite: dropped > 0 || raw.version !== CURRENT_WRONGBOOK_VERSION
  }
}

// ---------------------------------------------------------------- 手动标记（wrongbook:update）

/**
 * 应用一批**用户手动**的标记改动，返回**新列表**。
 *
 * 【三条路各管各的】答错记账走 `mergeWrongRecord`、答对毕业走 `wrongbook:clear`、
 * 手动删/恢复/标漏洞走这里。不合并成一个大函数，因为它们的触发者不同 ——
 * 混在一起之后，「再错一次会不会复活」这类问题得把三处逻辑一起读完才答得上。
 *
 * 【找不到 key：跳过，不抛】更新的来源是列表页的行内动作，而那份列表是**快照**：
 * 手速快于一次刷新、同一条在别处已经变化，都会出现「这条已经不在列表里」。
 * 为一个已经消失的条目炸掉整次请求，用户看到的是一次莫名其妙、还什么都做不了的报错。
 * **但「整个入参写错了」照抛**（key 不是字符串、patch 里塞了非布尔），
 * 和 record 那条路一个规矩：那是调用方写错了，该炸得响亮。
 *
 * 【返回新列表而不是 void】渲染层直接拿它刷新快照，省一次 get 往返，
 * 也就没有「写成功了、读到的还是旧的」这种竞态。
 */
export function applyWrongUpdate(
  all: WrongBookEntry[],
  updates: WrongUpdateItem[],
  now: string
): WrongBookEntry[] {
  const out = all.map((e) => ({ ...e }))
  for (const u of updates) {
    if (!isObject(u) || typeof u.key !== 'string' || u.key === '') {
      throw new Error('invalid wrongbook payload')
    }
    const patch = u.patch
    if (!isObject(patch)) throw new Error('invalid wrongbook payload')
    // undefined = 「这次不碰这一项」；别的任何东西都是调用方写错了
    if (patch.removed !== undefined && typeof patch.removed !== 'boolean') {
      throw new Error('invalid wrongbook payload')
    }
    if (patch.hole !== undefined && typeof patch.hole !== 'boolean') {
      throw new Error('invalid wrongbook payload')
    }

    const ex = out.find((e) => e.key === u.key)
    if (!ex) continue
    if (patch.removed === true) {
      ex.removed = true
      ex.removedAt = now
    } else if (patch.removed === false) {
      // 恢复：两个字段**一起**摘。只把 removed 置 false 会留下一个孤儿 removedAt，
      // 而「什么时候删的」在恢复之后不该再有任何含义
      delete ex.removed
      delete ex.removedAt
    }
    if (patch.hole === true) ex.hole = true
    else if (patch.hole === false) delete ex.hole
  }
  return out
}
