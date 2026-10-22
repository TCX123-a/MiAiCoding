/**
 * 「用本地 IDE 打开这段代码」与「导出代码」的实现（2026-10-01）。
 *
 * 【它解决的是什么】用户想拿自己机器上配好的编辑器/IDE（Dev-C++、VS Code…）
 * 读练习场里这段代码。这个模块把代码写成一个**真实的临时文件**（文件名与
 * 运行路径完全同源：main.c / main.cpp / 类名.java / main.py），再用用户
 * **自己在设置里指定**的程序把那个文件打开。
 *
 * 【安全边界：exe 从哪来】
 * 对外只收 `(lang, code)`；exe 路径由主进程从 `readConfig()`（main/index.ts，
 * 全项目唯一读口）现读 —— 要是让渲染层传 exe，这条 IPC 就成了渲染层的
 * 「任意程序执行」通道。
 *
 * 【为什么没有清理逻辑】IDE 打开文件是**异步**的：我们返回时它可能还没读到
 * 文件内容。导出后**绝不能**删目录（否则 IDE 里看到的是「文件不存在」）。
 * 临时目录留在 %TEMP% 下，由系统清理策略兜底 —— 低频操作，为它做延迟清理
 * （还得处理 readdir 异物与时间戳解析）不划算。
 *
 * 【为什么不看退出码、不等进程结束】IDE 是长驻程序：等它退出可能等到天荒地老；
 * 而「启动器秒退、真正的 IDE 稍后起来」（VS Code 就这么干）会把「用退出码
 * 判成败」变成假失败。这里唯一能如实回答的问题是「**进程创建成功了吗**」——
 * 答案在 `'spawn'` / `'error'` 这对互斥事件里（必有其一，绝不用超时猜）。
 */
import { spawn } from 'child_process'
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import iconv from 'iconv-lite'
import type { AppConfig, ExportCodeResult, IdeOpenResult, LangOfCode } from '../../shared/types'
import {
  defaultEncodingOf,
  encodingOfProduct,
  ideNameOf,
  type IdeEncoding
} from '../../shared/ide-profiles'
import { makeRunDir, planForLang } from './runner'

/**
 * 我们真正依赖的 ChildProcess 能力子集（只为测试打桩定义，不是 ChildProcess 的替代）。
 * 只用到三个成员：等 'spawn'、等 'error'、放手（unref）。
 */
export interface IdeChildLike {
  once(event: 'spawn', listener: () => void): unknown
  once(event: 'error', listener: (err: Error) => void): unknown
  unref(): void
}

export type IdeSpawn = (
  exe: string,
  args: string[],
  opts: { detached: boolean; stdio: 'ignore'; windowsHide: boolean; cwd: string }
) => IdeChildLike

const realSpawn: IdeSpawn = (exe, args, opts) => spawn(exe, args, opts)

export interface IdeDeps {
  /**
   * 配置读口。生产是 main/index.ts 的 `readConfig()`（带了 migrateConfig 的唯一
   * 读口）；测试传夹具。**不要学 runner:run 里 `configStore.read() ?? 默认`
   * 那条历史写法** —— 它绕过了迁移。
   */
  readConfig: () => AppConfig
  /**
   * spawn 注入点（默认 node 的 spawn）。
   *
   * ★ **必须可注入是设计约束，不是测试便利**（同 native.ts 的 NativeDeps）：
   * 注入不了的话，「进程起不来（'error' 分支）」在开发机上就只能靠撞运气复现，
   * 而那正是用户最需要一句人话的分支。
   */
  spawn?: IdeSpawn
}

/**
 * 按给定编码把代码编成字节（v9 起**编码跟随打开它的那个程序**，不跟语言）。
 *
 * 【主人实测的病灶（2026-10-01）】同一段带中文的代码：C 用 Dev-C++ 打开正常、
 * Java/Python 在上面乱码；换成 VS Code 又反过来。根因是旧版**按语言定死编码**
 * （c/cpp 写 GBK、java/python 写 UTF-8），而 Dev-C++ 按系统 ANSI（中文 Windows
 * 上即 GBK）读文件、VS Code 默认按 UTF-8 读 —— 任何一个固定 IDE 都会乱一半。
 * 所以从 v9 起编码由 `encodingForIdePath` 按**目标 exe** 决定，本函数只负责
 * "按一份给定编码编字节"。应用**自己**的运行管线不受影响（那条路上 gcc 被
 * 显式传了 `-finput-charset=UTF-8`），病灶只在"交给外部 IDE"这条路上。
 *
 * 【为什么带往返校验，编不出就整文件退回 UTF-8】
 * GBK 编不了的字符（emoji、部分生僻字）会被 iconv 静默替换成 '?' ——
 * 那等于**改学员的代码**。往返 `decode(encode(x)) === x` 一比就能发现；
 * 发现后整个文件退回 UTF-8 —— 在 Dev-C++ 里中文注释会乱，但**内容是完整的，
 * 编译也能过**（UTF-8 字节原样保留）。宁可乱，不许丢。
 * 也不做"一部分 GBK 一部分 UTF-8"的混编：没有文件头标记的东西，
 * 混编的结果是两边读法都错。
 */
function encodeCode(code: string, encoding: IdeEncoding): Buffer {
  if (encoding === 'utf8') return Buffer.from(code, 'utf8')
  const gbk = iconv.encode(code, 'gbk')
  if (iconv.decode(gbk, 'gbk') === code) return gbk
  return Buffer.from(code, 'utf8')
}

/**
 * 给某个目标程序选写盘编码：**认程序，不认语言**（v9 的核心行为）。
 *
 * 白名单里认得的 exe → ide-profiles 里它的画像编码（Dev-C++ 是 GBK、
 * VS Code 系是 UTF-8……改了那张表这两条路一起变）；认不出的（用户手挑的
 * 任意 exe）→ 按语言回退（c/cpp→GBK 其余 UTF-8）＝升级前的逐字节行为，
 * 不比现在差。空路径也走这条路（导出时该语言还没配程序）。
 */
function encodingForIdePath(lang: LangOfCode, exePath: string): IdeEncoding {
  return encodingOfProduct(ideNameOf(exePath)) ?? defaultEncodingOf(lang)
}

/**
 * 把代码写进一个**全新**的临时目录，返回目录与文件绝对路径。
 *
 * 文件名复用运行路径的 `planForLang`（同源！别再写第二份类名提取 ——
 * Java 那是 `findJavaClass` 的活）：c→main.c、cpp→main.cpp、python→main.py、
 * java→`类名.java`。
 *
 * 编码由调用方给（第三参**必填**，编译期逼每个调用点表态）：打开走
 * `encodingForIdePath(lang, 目标exe)`、导出走同一套 —— 这次不留
 * 「打开显示对了、导出还是旧编码」的半修状态。
 *
 * 返回 `null` = **定不出文件名**（Java 代码里找不到类名，和运行路径同一条
 * 判定规则）。写盘本身的异常**不吞**：调用方（openInNativeIde / exportCodeToFile）
 * 有统一的 try/catch 转成 `failed`，在这里吞掉就分不清「定不出名」和「写不进」。
 */
export function writeCodeToFile(
  lang: LangOfCode,
  code: string,
  encoding: IdeEncoding
): { dir: string; file: string } | null {
  const plan = planForLang(lang, '', code)
  if (plan.error) return null
  const dir = makeRunDir()
  const file = join(dir, plan.srcFile)
  writeFileSync(file, encodeCode(code, encoding))
  return { dir, file }
}

/**
 * 用设置里配置的本地 IDE 打开这段代码。**失败即值，绝不抛**（照 AiResult / GallerySaveResult 语义）。
 *
 * 三段各自的返回：
 *   ① 该语言没配路径 → `unconfigured`（渲染层会现检现荐，设置页也能手填）
 *   ② 配了但文件不在 → `missing`（下一步是换路径）—— 单列的理由见 types.ts 里 IdeOpenResult 的注释
 *   ③ 起不来 / 写不进 / 定不出文件名 → `failed` + detail
 */
export async function openInNativeIde(
  lang: LangOfCode,
  code: string,
  deps: IdeDeps
): Promise<IdeOpenResult> {
  try {
    // 配置每次现读：用户在设置页改完路径，下一次点击就该走新路径，不吃快照。
    // v9 起按语言各取各的键：c 配了 Dev-C++ 不会影响 java 那一格。
    const exe = deps.readConfig().nativeIdePaths[lang].trim()
    if (exe === '') return { ok: false, reason: 'unconfigured' }
    if (!existsSync(exe)) return { ok: false, reason: 'missing', detail: exe }

    const written = writeCodeToFile(lang, code, encodingForIdePath(lang, exe))
    if (!written) return { ok: false, reason: 'failed', detail: 'cannot derive source file name' }

    const doSpawn = deps.spawn ?? realSpawn
    // 数组参数**直传、不经 shell**：路径里的空格与中文天然安全（不需要
    // native.ts 那套 cmd 转义 —— 那条路是给「借 cmd 跑编译器」用的）。
    // detached + stdio:'ignore'：IDE 与应用的 stdin/stdout 无关、窗口自己活；
    // windowsHide 防止弹出一个多余的控制台窗。
    const child = doSpawn(exe, [written.file], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      cwd: written.dir
    })

    // 等 'spawn' / 'error' **二选一**：
    //   · 二者互斥且必有其一（spawn() 同步只抛「参数类型错」这类编程错误，
    //     ENOENT / EACCES 都是异步从 'error' 来）；
    //   · 不设人工超时 —— 超时兜底要么在慢机器上误报失败、要么就滑向
    //     「默认回退为成功」，两条都踩红线。事件没来就等，等的是事实。
    const started = await new Promise<{ ok: true } | { ok: false; err: Error }>((resolve) => {
      let settled = false
      child.once('spawn', () => {
        if (!settled) {
          settled = true
          resolve({ ok: true })
        }
      })
      child.once('error', (err) => {
        if (!settled) {
          settled = true
          resolve({ ok: false, err })
        }
      })
    })
    if (!started.ok) return { ok: false, reason: 'failed', detail: started.err.message }

    // 放手：IDE 独立于 Electron 存活，也不拖着应用退不出去。
    // 放在 'spawn' 之后 —— 还没起来就 unref 不影响正确性（unref 只关乎事件循环计数），
    // 但放在这里读起来是「确实起来了，才放手」。
    child.unref()
    return { ok: true, path: written.file }
  } catch (err) {
    return { ok: false, reason: 'failed', detail: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 把代码导出成一个临时文件，返回文件路径。**只写盘，不碰剪贴板** ——
 * 复制路径那一步由渲染层做（`navigator.clipboard`，见 CompareGrid.vue 的现成先例），
 * 主进程不掺和剪贴板。
 *
 * 【为什么 v9 起也要 deps】导出文件的编码和「打开」**同源**：跟随该语言
 * 配好的那个 IDE（没配 → 按语言回退，见 encodingForIdePath）。不这么做就会
 * 留下「打开显示对了、导出还是旧编码」的半修状态 —— 那正是这次要根治的
 * 那类乱码，只是换了个入口。
 */
export function exportCodeToFile(lang: LangOfCode, code: string, deps: IdeDeps): ExportCodeResult {
  try {
    const ide = deps.readConfig().nativeIdePaths[lang]
    const written = writeCodeToFile(lang, code, encodingForIdePath(lang, ide))
    if (!written) return { ok: false, reason: 'failed', detail: 'cannot derive source file name' }
    return { ok: true, path: written.file }
  } catch (err) {
    return { ok: false, reason: 'failed', detail: err instanceof Error ? err.message : String(err) }
  }
}
