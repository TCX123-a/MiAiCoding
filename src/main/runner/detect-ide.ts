/**
 * 自动探测本机装了哪些 IDE —— 设置页 / 练习场「🔍 自动检测」的后端。
 *
 * 【为什么要有它】用户不一定知道 IDE 装在哪 —— 安装器自己挑的目录、
 * 从桌面图标进去、从来不记路径。让新手自己找出 exe 本体是条死胡同
 * （2026-10-01 主人原话：「我自己都不知道，能不能做到自动匹配选择打开？」）。
 * 所以让机器去找，人只需要从结果里点一个。
 *
 * 【三层，从便宜到贵】
 *   ① 常见安装路径表 KNOWN_PATHS —— 默认装在 C 盘时命中率最高；
 *   ② 开始菜单 / 桌面快捷方式 —— 安装器几乎都会放一个，而且**跟着用户
 *      自己选过的安装目录走**（装在 D 盘也找得到）；
 *   ③ 注册表 App Paths —— 兜底。⚠️ 本机实测（2026-10-01）：Dev-C++ **不往**
 *      App Paths 里写（只有 ①② 能兜住它），VS Code 只写了 HKCU 那份。
 *      所以三层缺一不可，光靠注册表会静默漏掉最常见的教学 IDE。
 *
 * 【按 target 过滤，不按快捷方式的名字】
 * 本机开始菜单里躺着 `License.lnk` / `Uninstall Dev-C++.lnk` 这类陷阱 ——
 * 名字里带 "Dev-C++" 但不是 IDE 本体。名字是**给人看的字符串**，
 * target 才是「点下去真会起什么程序」。所以判据只看 target 的 basename
 * 在不在白名单（IDE_EXE_NAMES）里，名字一律不参与判断。
 *
 * 【失败即值，绝不抛】任何一层坏掉都只是少几条线索（同 detect.ts 的
 * 「失败一律静默降级」策略）；整个函数套一层 try/catch，真出岔子时如实返回
 * `{ ok:false, reason:'failed' }` —— **不许默认回退成「没找到」**：
 * 「这台机器一台都没装」和「我们根本没查成」的下一步完全不同。
 *
 * 【依赖注入】fs / env / reg / 快捷方式读取全走 IdeDetectDeps，测试里
 * 换成一整台假电脑。⚠️ `readShortcut` 是**必填**且唯一没有默认值的一项：
 * 它背后是 Electron 的 `shell`，而 `shell` 只有主进程有 —— 本文件故意
 * 不 import electron（否则 vitest 一 import 本模块就会去加载 electron）。
 * 生产环境由 main/index.ts 注入 `shell.readShortcutLink`。
 */
import { join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { decodeConsole, expandEnvVars, runCapture } from '../env/detect'
import { IDE_EXE_NAMES, ideNameOf } from '../../shared/ide-profiles'
import type { IdeCandidate, IdeDetectResult } from '../../shared/types'

// exe 白名单（IDE_EXE_NAMES）与 `ideNameOf` 搬去了 shared/ide-profiles.ts：
// v8 → v9 迁移（在 shared 侧跑）也要认「exe 名 → 产品名」，而 shared 不能
// import main。三个层的判据（常见路径 / 快捷方式 target / App Paths key）
// 一行没动，只是改从 shared 引用 —— 白名单的理由与收录标准写在那边。

/**
 * 第一层：常见安装位置。`%VAR%` 交给 expandEnvVars 展开（认不出的变量
 * 会变成空串，路径随之作废 —— 见下面 exists 复核），`*` 走 expandWith。
 *
 * JetBrains 那几条带版本号的目录名（`PyCharm 2024.1` 之类）只能靠通配，
 * 别想着枚举年份 —— 枚举表迟早在下一个版本发布时过期。
 */
const KNOWN_PATHS: string[] = [
  '%ProgramFiles(x86)%\\Dev-Cpp\\devcpp.exe',
  '%ProgramFiles%\\Dev-Cpp\\devcpp.exe',
  '%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe',
  '%ProgramFiles%\\Microsoft VS Code\\Code.exe',
  '%ProgramFiles(x86)%\\Microsoft VS Code\\Code.exe',
  '%LOCALAPPDATA%\\Programs\\VSCodium\\VSCodium.exe',
  '%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe',
  '%LOCALAPPDATA%\\Programs\\Thonny\\thonny.exe',
  '%ProgramFiles(x86)%\\Thonny\\thonny.exe',
  '%ProgramFiles%\\Thonny\\thonny.exe',
  '%LOCALAPPDATA%\\Programs\\PyCharm*\\bin\\pycharm64.exe',
  '%ProgramFiles%\\JetBrains\\PyCharm*\\bin\\pycharm64.exe',
  '%LOCALAPPDATA%\\Programs\\IntelliJ IDEA*\\bin\\idea64.exe',
  '%ProgramFiles%\\JetBrains\\IntelliJ IDEA*\\bin\\idea64.exe',
  '%LOCALAPPDATA%\\Programs\\CLion*\\bin\\clion64.exe',
  '%ProgramFiles%\\JetBrains\\CLion*\\bin\\clion64.exe',
  '%ProgramFiles%\\eclipse\\eclipse.exe',
  '%ProgramFiles(x86)%\\eclipse\\eclipse.exe',
  '%ProgramFiles%\\Microsoft Visual Studio\\*\\*\\Common7\\IDE\\devenv.exe'
]

/** 第二层：快捷方式从哪儿翻。用户自己放桌面/开始菜单的都在这里 */
const SHORTCUT_ROOTS: string[] = [
  '%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs',
  '%ProgramData%\\Microsoft\\Windows\\Start Menu\\Programs',
  '%USERPROFILE%\\Desktop',
  '%PUBLIC%\\Desktop'
]

/** 快捷方式递归深度上限。开始菜单目录树就那么深，5 层绰绰有余 */
const MAX_LNK_DEPTH = 5

/**
 * 第三层：App Paths 的四个根。
 *
 * HKLM 与 HKCU 各查两份（本体 + WOW6432Node）—— 32 位 IDE 装在 64 位系统上时
 * 写的是 WOW6432Node 那份，只查本体会漏。
 */
const APP_PATHS_ROOTS: string[] = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
  'HKCU\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths'
]

/** `reg query` 的兜底：超时给足（冷启动的 reg 偶尔慢），buffer 抬高（全树 dump 会超默认 1MB —— 同 ideToolchainCandidates 的教训） */
const REG_TIMEOUT_MS = 8000
const REG_MAX_BUFFER = 4 * 1024 * 1024

export interface IdeDetectDeps {
  /** 供 %VAR% 展开（测试里喂一台假机器的环境块） */
  env: Record<string, string | undefined>
  exists: (path: string) => boolean
  /** 列目录（含子目录标记 —— 快捷方式要递归、通配要按段推进） */
  listDir: (dir: string) => Array<{ name: string; isDir: boolean }>
  /** 解一个 .lnk 的 target；解不开**抛**（逐条 try/catch 由调用方兜） */
  readShortcut: (lnkPath: string) => string
  /** 跑 `reg query`（args 不含 exe 名）。契约同 runCapture：永不抛、永不 reject */
  runReg: (args: string[]) => Promise<{ ok: boolean; stdout: Buffer; stderr: Buffer }>
}

/**
 * 调用方可注入的部分。`readShortcut` **必填**（理由见文件头：electron 的
 * shell 只有主进程能碰，本模块不能给它编一个默认值）。
 */
export type IdeDetectOverrides = Partial<IdeDetectDeps> & Pick<IdeDetectDeps, 'readShortcut'>

function defaultListDir(dir: string): Array<{ name: string; isDir: boolean }> {
  return readdirSync(dir, { withFileTypes: true }).map((d) => ({ name: d.name, isDir: d.isDirectory() }))
}

function defaultRunReg(args: string[]): Promise<{ ok: boolean; stdout: Buffer; stderr: Buffer }> {
  return runCapture('reg', args, { timeoutMs: REG_TIMEOUT_MS, maxBuffer: REG_MAX_BUFFER })
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 展开路径里的 `*`（算法照 detect.ts 的 expandGlob，但 fs 走注入）。
 *
 * 【为什么不直接 import expandGlob】它内部用**真** fs —— 测试里换不掉，
 * 会在装了 JetBrains 的开发机上漏进真候选、在别的机器上又漏不掉，
 * 测试结果开始取决于「跑测试的那台电脑装了什么」。这正是本项目
 * 「开发机上的绿是假的」那条教训的翻版，所以宁肯让这 ~25 行跟着注入走。
 */
function expandWith(pattern: string, deps: IdeDetectDeps): string[] {
  if (!pattern.includes('*')) return deps.exists(pattern) ? [pattern] : []
  const rootMatch = /^([A-Za-z]:[\\/]|[\\/]+)/.exec(pattern)
  const root = rootMatch ? rootMatch[1] : ''
  const segments = pattern.slice(root.length).split(/[\\/]+/).filter(Boolean)

  let currents = [root]
  for (const seg of segments) {
    if (!seg.includes('*')) {
      currents = currents.map((d) => join(d, seg)).filter((d) => deps.exists(d))
      if (currents.length === 0) return []
      continue
    }
    const re = new RegExp('^' + seg.split('*').map(escapeRe).join('.*') + '$')
    const next: string[] = []
    for (const d of currents) {
      if (d !== '' && !deps.exists(d)) continue
      let entries: Array<{ name: string; isDir: boolean }>
      try {
        entries = deps.listDir(d === '' ? '.' : d)
      } catch {
        continue
      }
      for (const e of entries) if (re.test(e.name)) next.push(join(d, e.name))
    }
    next.sort()
    currents = next
    if (currents.length === 0) return []
  }
  return currents.filter((p) => deps.exists(p))
}

// ---------------------------------------------------------------- ① 常见路径

function knownPathCandidates(deps: IdeDetectDeps): IdeCandidate[] {
  const out: IdeCandidate[] = []
  for (const pattern of KNOWN_PATHS) {
    const expanded = expandEnvVars(pattern, deps.env)
    let paths: string[]
    try {
      paths = expandWith(expanded, deps)
    } catch {
      continue // 目录读不动只是这条没戏，不拖垮整层
    }
    for (const p of paths) {
      const name = ideNameOf(p)
      if (name) out.push({ path: p, name, source: 'known' })
    }
  }
  return out
}

// ---------------------------------------------------------------- ② 快捷方式

/** 递归收一棵目录树里的全部 .lnk 文件（读不动的分支静默跳过） */
function collectLnks(dir: string, depth: number, deps: IdeDetectDeps, out: string[]): void {
  if (depth > MAX_LNK_DEPTH) return
  let entries: Array<{ name: string; isDir: boolean }>
  try {
    entries = deps.listDir(dir)
  } catch {
    return
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDir) collectLnks(full, depth + 1, deps, out)
    else if (/\.lnk$/i.test(e.name)) out.push(full)
  }
}

function shortcutCandidates(deps: IdeDetectDeps): IdeCandidate[] {
  const lnks: string[] = []
  for (const root of SHORTCUT_ROOTS) {
    const dir = expandEnvVars(root, deps.env)
    if (!deps.exists(dir)) continue
    collectLnks(dir, 0, deps, lnks)
  }

  const out: IdeCandidate[] = []
  for (const lnk of lnks) {
    // 【逐条 try/catch】损坏的 .lnk、指向已卸载程序的、权限不对的 —— 本机
    // 开始菜单里什么都有。一条解不开就跳过它，绝不中断整次扫描。
    let target = ''
    try {
      target = deps.readShortcut(lnk)
    } catch {
      continue
    }
    if (!target) continue
    const resolved = expandEnvVars(target, deps.env)
    const name = ideNameOf(resolved)
    if (!name) continue
    // 复核：快捷方式存的是「上一次的样子」，程序可能早被卸载了
    if (!deps.exists(resolved)) continue
    out.push({ path: resolved, name, source: 'shortcut' })
  }
  return out
}

// ---------------------------------------------------------------- ③ App Paths

/** 从 `reg query <root> /s` 的 dump 里抠出全部直接子键名（= exe 名） */
function appPathsKeyNames(dump: string): string[] {
  const out: string[] = []
  for (const line of dump.split(/\r?\n/)) {
    const m = /^HKEY_.*\\App Paths\\([^\\]+)$/i.exec(line)
    if (m) out.push(m[1])
  }
  return out
}

/**
 * 从 `reg query <键> /ve` 的输出里取默认值的数据部分。
 *
 * ⚠️ 值名**不许按字面匹配**：中文 Windows 上是「(默认)」、英文版是
 * "(Default)"、其他语言又是别的 —— 按字面写死等于只在一种系统上能跑。
 * `/ve` 的输出**恰好只有一条值行**，所以按结构解就够了：
 * 「缩进 + 值名 + 2 空格以上 + REG_类型 + 2 空格以上 + 数据」。
 */
function defaultRegValue(dump: string): string | undefined {
  const m = /^[ \t]{2,}\S.*?[ \t]{2,}REG_(?:EXPAND_)?SZ[ \t]{2,}(.+?)[ \t]*$/m.exec(dump)
  return m ? m[1] : undefined
}

/** 去掉 reg 输出里默认值两端的引号（`"C:\Program Files\..."` 是常态） */
function unquote(s: string): string {
  const m = /^"(.*)"$/.exec(s.trim())
  return m ? m[1] : s.trim()
}

async function registryCandidates(deps: IdeDetectDeps): Promise<IdeCandidate[]> {
  // 四个根的 dump 并发跑（本机实测单条 ~100ms；串行四条约 0.4s 白等）。
  // 失败是值，不抛 —— 键不存在时 reg 自己返回非 0，正好当「这个根没有」。
  const dumps = await Promise.all(
    APP_PATHS_ROOTS.map(async (root) => {
      try {
        return { root, r: await deps.runReg(['query', root, '/s']) }
      } catch {
        return { root, r: { ok: false, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) } }
      }
    })
  )

  const out: IdeCandidate[] = []
  const seenKeys = new Set<string>()
  for (const { root, r } of dumps) {
    if (!r.ok) continue
    const names = appPathsKeyNames(decodeConsole(r.stdout) + '\n' + decodeConsole(r.stderr))
    for (const keyName of names) {
      const name = IDE_EXE_NAMES[keyName.toLowerCase()]
      if (!name) continue
      const dedupeKey = `${root}\\${keyName}`.toLowerCase()
      if (seenKeys.has(dedupeKey)) continue
      seenKeys.add(dedupeKey)
      // /ve = 只取默认值。一个键一次，通常四个根加起来也就 0~2 次
      let ve: { ok: boolean; stdout: Buffer; stderr: Buffer }
      try {
        ve = await deps.runReg(['query', `${root}\\${keyName}`, '/ve'])
      } catch {
        continue
      }
      if (!ve.ok) continue
      const raw = defaultRegValue(decodeConsole(ve.stdout) + '\n' + decodeConsole(ve.stderr))
      if (!raw) continue
      const p = expandEnvVars(unquote(raw), deps.env)
      if (!deps.exists(p)) continue
      out.push({ path: p, name, source: 'registry' })
    }
  }
  return out
}

// ---------------------------------------------------------------- 组装

/** 去重：同一个 exe 被两层同时找到时，**先到的层赢**（顺序 = known → shortcut → registry，已知路径最"正"） */
function dedupeCandidates(xs: IdeCandidate[]): IdeCandidate[] {
  const seen = new Set<string>()
  return xs.filter((c) => {
    const k = c.path.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * 找这台机器上装了哪些 IDE。三层按序跑全（不像编译器检测那样找到就停 ——
 * 用户可能同时装着 Dev-C++ 和 VS Code，得让人自己选）。
 *
 * 【什么时候调】只在用户点「🔍 自动检测」那一瞬间。**不加缓存**：
 * 用户刚装/刚卸载完 IDE 再点一次，看到的必须是当下的事实
 * （同 nativeEnv「每次运行前重算」的理由）。
 */
export async function detectIdes(over: IdeDetectOverrides): Promise<IdeDetectResult> {
  const deps: IdeDetectDeps = {
    env: process.env,
    exists: existsSync,
    listDir: defaultListDir,
    runReg: defaultRunReg,
    ...over
  }
  try {
    const found = [
      ...knownPathCandidates(deps),
      ...shortcutCandidates(deps),
      ...(await registryCandidates(deps))
    ]
    return { ok: true, candidates: dedupeCandidates(found) }
  } catch (e) {
    // 走到这里说明是「没预料到的岔子」（三层各自都兜过自己的失败）。
    // 如实说没查成 —— 冒充「没找到」会让用户去重装一个明明装着的 IDE。
    return { ok: false, reason: 'failed', detail: e instanceof Error ? e.message : String(e) }
  }
}
