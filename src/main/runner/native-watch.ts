/**
 * 「原生环境编译观察器」（2026-10-06）。
 *
 * 【它解决的是什么 —— 奖励链上「编译成功」这一格的证据从哪来】
 * 用户把练习场的代码「导出到本地 IDE」（Dev-C++ / VS Code）自己编译运行。
 * 那条路上我们**看不见**任何过程：IDE 是长驻程序，没有退出码可等、没有日志可读
 * （native-ide.ts 的文件头已经讲透了为什么不能「等进程结束」）。主进程唯一能
 * **如实**观察到的，是「编译产物出现了」—— 那正是「编译成功了」这份奖励唯一
 * 站得住的证据：文件在、刚写进去、大小不为零。
 *
 * 【为什么是轮询 stat，而不是 fs.watch / 哈希比对】
 * · fs.watch 是每目录一个句柄，事件会合并、会丢（编辑器保存往往是「写临时文件
 *   → 改名」一串操作），丢了就变成**静默漏报**，还没有任何补救余地；而一次 stat
 *   给出的三样东西（在不在、多大、什么时候改的）对四门语言是同一种观测，不挑平台。
 * · 哈希只能证明「这个文件是这串字节」，证明不了「它是**刚**编出来的」——
 *   我们要判的恰恰是「新」。mtime 就是为这个问题存在的字段。
 * · 轮询的代价：每条一次 stat，队列最多 8 条、默认 2 秒一拍 —— 零头。
 *
 * 【判定纪律：宁可漏报，不可错报】
 * 每一条「确认」都会往奖励链上发一次事件。错报（老产物被当成新编译）比漏报
 * 坏得多：奖励发错了边，等于告诉学员「随便跑跑就有饭」。所以：
 *   · 时间比较一律**严格大于**，恰好相等按未确认算（时间戳精度下「相等」意味着
 *     「分不出来」，分不出来的东西不许当证据）；
 *   · 任何 stat 异常按「不存在」处理（异常不是「编译成功」的证据）；
 *   · 四条判据**全过**才算数（见 judge 的注释）。
 *
 * 【为什么时间与文件系统都要注入】
 * now / statFn 可注入是**设计约束**，不是测试便利（同 native-ide.ts 里 spawn 必须
 * 可注入的理由）：「15 分钟窗口」「恰好相等的 mtime」「stat 抛异常」这些边界，在真机上
 * 要么等不起、要么撞运气 —— 捏得住时间和文件系统，它们全是一行用例。
 * 模块内**只有 defaultStat 一处**碰真实磁盘。
 *
 * 【本模块不接应用】导出（native-ide.ts 的 exportCodeToFile）与桌宠奖励的接线
 * 在 app.ts 那侧；这里只回答一个问题 ——「那段代码，编出来了吗」。
 */
import { statSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import type { LangOfCode } from '../../shared/types'

/**
 * 单条观察窗口：15 分钟。
 * 够用户切到 IDE、改两下、按下编译；超时还没有产物就该撒手 —— 继续盯着的成本
 * 是每 2 秒一次 stat，收益却接近于零（人早已不在那件事上了）。
 */
export const DEFAULT_WATCH_MS = 15 * 60_000

/**
 * 轮询间隔：2 秒。
 * 人对「刚编译完 → 桌宠有反应」的期待在秒级；再密也快不过用户切窗口的手速，
 * 只是白烧 CPU（每拍每条一次 stat）。
 */
export const DEFAULT_INTERVAL_MS = 2000

/**
 * 在册条目上限：8 条。
 * 每条每拍多一次 stat，而用户连点「导出」会无限攒条；8 条已经比「同时开着八个
 * 导出目录在编译」宽松，再多的多半是误点。超了丢**最老**的那条（见 track）。
 */
export const MAX_PENDING = 8

export interface NativeWatchRequest {
  /** 源文件绝对路径（.c / .cpp / .java / .py）—— 导出时落盘的那个文件，观察器盯着它同一带 */
  sourceFile: string
  /**
   * 导出时算好的 shared/code-hash 指纹。**随请求带入，不在确认时重算**：
   * 用户很可能在 IDE 里改了代码再编译（这正是「导出到本地」的用法），确认时
   * 重算源文件就会算出「他改过之后那份」的指纹 —— 奖励记到一段我们从没交出去
   * 的代码头上，去重键也跟着漂。指纹的身份是「**我们交给他的**那份代码」。
   */
  fingerprint: string
  lang: LangOfCode
  /** 开始观察的时刻（ms）。产物必须**严格晚于**它，才算「这一趟编译出来的」 */
  startedAt: number
}

export interface NativeCompiledEvent {
  sourceFile: string
  /** 原样带出请求里的指纹（见 NativeWatchRequest.fingerprint，绝不二次加工） */
  fingerprint: string
  /** 确认到的产物绝对路径（源文件同目录、主干名 + 语言产物后缀） */
  artifact: string
  /** 判定的时刻（now()）—— 时间轴上的「什么时候确认的」 */
  at: number
}

export interface NativeWatcherOptions {
  /** 命中时回调一次（每条最多一次）。这是本模块**唯一**的业务出口 */
  onCompiled: (ev: NativeCompiledEvent) => void
  /** 当前时刻（ms）。默认 Date.now；测试注入假时钟 */
  now?: () => number
  /** 单条观察窗口（ms），默认 DEFAULT_WATCH_MS */
  watchMs?: number
  /** 轮询间隔（ms），默认 DEFAULT_INTERVAL_MS */
  intervalMs?: number
  /**
   * 文件观测口：返回 null = 不存在；默认真去 statSync。
   * 可注入是设计约束（见文件头）：边界条件要靠捏造文件系统才逼得出来。
   */
  statFn?: (p: string) => { mtimeMs: number; size: number } | null
  /** 诊断日志（英文一行）。默认 console.log 加 [native-watch] 前缀 */
  log?: (line: string) => void
}

export interface NativeWatcher {
  track(req: NativeWatchRequest): void
  stop(): void
  debugList(): Array<{ sourceFile: string; at: number }>
}

interface FileStamp {
  mtimeMs: number
  size: number
}

interface PendingEntry {
  req: NativeWatchRequest
  artifact: string
}

/**
 * 默认的观测手段：真 statSync。**整个模块只有这里碰磁盘**（测试注入 statFn 之后
 * 一条真文件都不用造，同 native-ide.ts 注入 spawn 的理由）。
 *
 * 异常按 null（= 不存在）返回，除了是判定纪律（见文件头），还兼任一道保险：
 * 轮询回调里抛出的异常在 Electron 主进程里是**未捕获异常**（整个应用闪退），
 * 这一层不许有缝。
 */
function defaultStat(p: string): FileStamp | null {
  try {
    const st = statSync(p)
    return { mtimeMs: st.mtimeMs, size: st.size }
  } catch {
    return null
  }
}

/**
 * 语言的产物后缀。python → null：**它没有编译这一步，也就没有「产物出现」那一刻**。
 * 拿「.py 被改过 / 被跑过」去冒充「编译成功」是错报（红线），所以 python 这条路
 * **不收** —— track 里会留一行日志，让人看得出这是划的界，而不是忘接的线。
 *
 * 用 Record 查表而不是 switch：运行时传进来的 lang 可能是任何东西（IPC 那头）。
 * switch 漏了 default 时，认不出的语言会顺着 undefined 拼出 `mainundefined.exe`
 * 这种鬼名字去 stat；查表天然把认不出的一律收成 null（= 不收，宁可漏报）。
 */
const PRODUCT_EXT: Record<LangOfCode, string | null> = {
  c: '.exe',
  cpp: '.exe',
  java: '.class',
  python: null
}

/**
 * 候选产物路径：**与源文件同目录**、主干名 + 语言后缀。
 * 主干名的规则与导出/运行同源（main.c → main.exe、Foo.java → Foo.class）。
 *
 * ⚠️ 已知边界（java）：源文件里带 `package x;` 时，某些编译方式（`javac -d .`、
 * 部分 IDE 设置）会把 .class 落到**同名包子目录**（x/Foo.class）里 —— 这里只查源文件
 * 同目录，那种位置的产物**观察不到**。这是**划界**不是疏忽：去递归扫子目录就得回答
 * 「找到多个 .class 哪个算数」「上一节课的项目留下的算不算」这些答不好的问题，
 * 而本项目导出的是一次一个文件、类名即文件名，不带 -d 的 javac 产物就落在源文件旁边。
 * 真撞上这个边界，表现是「编译成功了但没发奖励」= 漏报（不是错报），与文件头的纪律同向。
 */
function artifactPathFor(sourceFile: string, lang: LangOfCode): string | null {
  const ext = PRODUCT_EXT[lang] ?? null
  if (ext === null) return null
  // basename(p, extname(p))：把 'main.c' 削成 'main'、'Foo.java' 削成 'Foo'
  const stem = basename(sourceFile, extname(sourceFile))
  return join(dirname(sourceFile), stem + ext)
}

export function createNativeWatcher(opts: NativeWatcherOptions): NativeWatcher {
  const now = opts.now ?? (() => Date.now())
  const watchMs = opts.watchMs ?? DEFAULT_WATCH_MS
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  const statOf = opts.statFn ?? defaultStat
  const log = opts.log ?? ((line: string) => console.log(`[native-watch] ${line}`))

  // key = sourceFile。Map 的迭代顺序 = 插入顺序 → 「最老的」就是第一个 key，
  // 「重新 track 挤到队尾」也就是 delete 再 set。
  const pending = new Map<string, PendingEntry>()
  let timer: ReturnType<typeof setInterval> | null = null

  /**
   * stat 的唯一调用口。注入进来的 statFn 也是我们控制不了的代码，它抛异常时与
   * 「返回 null」同义：按**不存在**处理（见文件头纪律）。
   */
  function statOrNull(p: string): FileStamp | null {
    try {
      return statOf(p)
    } catch {
      return null
    }
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  /** 有活干才起定时器；表空了就撤（没条目时每拍醒来只是白醒） */
  function ensureTimer(): void {
    if (timer !== null) return
    timer = setInterval(tick, intervalMs)
  }

  type Verdict =
    | { kind: 'hit'; ev: NativeCompiledEvent }
    | { kind: 'wait' }
    // silent：源文件消失这条路**不记日志**（见 judge）；窗口过完那条要记
    | { kind: 'drop'; silent: boolean; why: string }

  /**
   * 单条的判定。四条**全过**才算「编译成功」：
   *   ① 产物存在                  —— stat 异常也归这条（异常 ≠ 成功证据）
   *   ② 产物 size > 0             —— 0 字节的 .exe/.class 是编译中途/失败留下的
   *                                 残骸；「有文件就算」会把写坏的产物错报成成功
   *   ③ 产物 mtime > startedAt    —— 排除上一次编译留下的老产物
   *   ④ 产物 mtime > 源文件 mtime —— 产物必须是「**现在这份**源码」编出来的：
   *                                 用户在 IDE 里存过盘（源码变新）却没重新编译时，
   *                                 那条产物已经配不上当前源码，不算数
   * 两处时间比较一律**严格大于**：恰好相等 = 分不出来 = 不是证据（见文件头纪律）。
   *
   * 命中判定放在过期判定**之前**：恰好在超窗那一拍才满足条件的，算命中 ——
   * 窗口的语义是「最多看这么久」，而那一拍我们**还在看**。
   *
   * 两条丢弃路线：
   *   · 源文件不在了 → **静默**丢弃。导出目录是应用给的临时目录，用户可能自己
   *     收拾掉了；这时连「他还在不在编译」都无从谈起，写日志只添噪，而且我们
   *     没有任何可做的动作。
   *   · 一直没命中、窗口过完 → 丢弃并留一行日志。这是唯一值得解释的退出路线
   *     （「为什么没发奖励」的答案就在窗里），排查时全靠它。
   */
  function judge(entry: PendingEntry, t: number): Verdict {
    const src = statOrNull(entry.req.sourceFile)
    if (src === null) return { kind: 'drop', silent: true, why: 'source file gone' }

    const art = statOrNull(entry.artifact)
    if (
      art !== null &&
      art.size > 0 &&
      art.mtimeMs > entry.req.startedAt &&
      art.mtimeMs > src.mtimeMs
    ) {
      return {
        kind: 'hit',
        ev: {
          sourceFile: entry.req.sourceFile,
          fingerprint: entry.req.fingerprint,
          artifact: entry.artifact,
          at: t
        }
      }
    }

    // 窗口恰满即到期（这里用 >=）。与 mtime 的「严格大于」不同不是笔误：
    // 窗口的语义是「看这么久为止」，时间到了就没得看了，不存在「分不出来」的问题。
    if (t - entry.req.startedAt >= watchMs) {
      return { kind: 'drop', silent: false, why: `watch window over (${watchMs}ms)` }
    }
    return { kind: 'wait' }
  }

  function tick(): void {
    // 一拍只取一次 now()：同拍里所有条目看到的必须是同一个「现在」
    const t = now()
    // 先快照 key 再遍历：onCompiled 是我们控制不了的回调，它若在回调里 track()/stop()
    // 动了表，边遍历边改 Map 会漏检或重复检。
    for (const key of [...pending.keys()]) {
      const entry = pending.get(key)
      if (entry === undefined) continue // 回调里已经把它删了
      const verdict = judge(entry, t)
      if (verdict.kind === 'wait') continue
      pending.delete(key) // 一次性：不管命中还是丢弃，这条到此为止
      if (verdict.kind === 'hit') {
        // 回调（发奖励那条链）抛异常**不该把主进程带走**：轮询回调里的未捕获异常
        // 在 Electron 里 = 整个应用闪退。吞掉但留一行日志 —— 这不是静默。
        try {
          opts.onCompiled(verdict.ev)
        } catch (err) {
          log(`onCompiled threw for ${key}: ${err instanceof Error ? err.message : String(err)}`)
        }
      } else if (!verdict.silent) {
        log(`dropped: ${key} (${verdict.why})`)
      }
    }
    if (pending.size === 0) clearTimer()
  }

  function track(req: NativeWatchRequest): void {
    const artifact = artifactPathFor(req.sourceFile, req.lang)
    if (artifact === null) {
      // python（以及运行时认不出的语言）：没有产物可观察 = **不收**。
      // 这是诚实边界不是错误：观测不到的东西，不许拿别的东西冒充证据。
      // 记一行日志，让排查的人一眼看出是「故意不收」而不是「忘了接」。
      log(`ignored (no compile artifact to observe): lang=${req.lang} ${req.sourceFile}`)
      return
    }

    // 同一个 sourceFile 再次 track：**覆盖**旧条，按最新导出重新计时。
    // 第二次导出是把同一份（可能又改过的）代码重新交出去一趟，该盯的是这一趟；
    // 留着旧条 = 同一个文件两套 startedAt/fingerprint —— 哪条先命中说不清，
    // 更糟的是两条都命中、奖励发两次。delete 再 set 顺便把它挪到队尾。
    const again = pending.delete(req.sourceFile)
    pending.set(req.sourceFile, { req, artifact })
    if (again) log(`re-tracked, previous entry replaced: ${req.sourceFile}`)

    // 队列上限：超了丢最老的（Map 迭代顺序 = 插入顺序 = 导出顺序）。
    // 丢最老的理由：最久没被再次导出的那次，用户多半已经不在那件事上了。
    while (pending.size > MAX_PENDING) {
      const oldest = pending.keys().next().value
      if (oldest === undefined) break
      pending.delete(oldest)
      log(`queue full (max ${MAX_PENDING}), dropped oldest: ${oldest}`)
    }

    ensureTimer()
  }

  /**
   * 收尾：停轮询、清空表。
   * **不是终态**：之后再 track() 会重新起表起定时器 —— 调用方在退出时用它收尾，
   * 而「关死后不许再开」是我们不需要的状态（多一个状态就多一种说不清的失败模式）。
   */
  function stop(): void {
    clearTimer()
    pending.clear()
  }

  /**
   * 诊断快照：当前正盯着的条目（谁、从哪一刻开始盯），`at` = 该条的 startedAt。
   * **只给排查用** —— 业务出口只有 onCompiled 一条路；别拿这个列表去发奖励，
   * 它回答的是「在盯谁」，不是「谁成功了」。
   */
  function debugList(): Array<{ sourceFile: string; at: number }> {
    return [...pending.values()].map((e) => ({ sourceFile: e.req.sourceFile, at: e.req.startedAt }))
  }

  return { track, stop, debugList }
}
