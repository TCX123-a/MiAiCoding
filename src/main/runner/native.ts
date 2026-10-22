/**
 * 原生编译环境（3.0）—— 把这一段代码交给**用户自己的** PATH 和他的外壳去跑。
 *
 * 【它和托管模式差在哪，先把这个说清楚】
 * 应用里没有内置编译器（`resources/` 只有立绘，全仓一个 `.exe` 都没有）。
 * 所以「开=用本机 / 关=用自带」这种二分**在代码里不成立**。真正会不一样的是两件事：
 *   ① 命令名由**合并后的 PATH**（进程 PATH + 注册表 HKLM/HKCU 的 PATH）解析，
 *      而不是用环境检测找到的那个绝对路径 —— 用户刚装完工具链、还没重启应用时，
 *      只有注册表知道它，这条才是「当下的事实」；
 *   ② 借**真外壳**（cmd.exe）跑，于是 `.bat` / `.cmd` 垫片（scoop 的 shim、
 *      `git.cmd`、venv 的 `activate.bat`）也够得着。将来终端 / Git / 虚拟环境
 *      那几课必经这条路。
 * `planForLang` 的 argv **一个字都不改**（`-finput-charset` / `-encoding UTF-8` /
 * `-J-Duser.language=en` 是错误库匹配与不乱码的功能依赖），这里只换「谁来执行」。
 *
 * 【为什么单独一个文件、而不是给 runner.ts 加个 if】
 * 这条例外路径**绝不许静默退回**托管模式（红线 17：判定为真的路上不许有
 * 不需要证据的分支）。同一个函数里就有个现成的 catch 可以「顺手兜一下」，
 * 而那样做的结果是：用户选了原生、机器上没装编译器，界面却照常跑出结果 ——
 * 他永远不知道自己刚才跑的是哪一个。分开成两个模块，**没有那个 fallback 位**；
 * 另有静态闸门（native.test.ts 里那条读源码的用例）盯着本文件不许出现对
 * 托管 `runCode` 的调用。
 *
 * 【实测记录（2026-09-28，本机 Windows 11 / cmd.exe 10.0.26200）】
 *   · `cmd /c` 跑一条不存在的命令 → 退出码 **1**，不是传说中的 9009
 *     （9009 是批处理里那条路的产物）。所以「命令不存在」**只认预检 `where`**，
 *     不靠退出码猜；预检没拦住时（PATH 在两次调用之间被改），
 *     原样把 cmd 的话交给用户看，而不是编一个理由。
 *   · 命令行**必须**用 `windowsVerbatimArguments: true` 起：不加的话 Node 会
 *     按 MSVCRT 规则替我们给带空格的参数加引号（还带 `\"`），cmd 收到的是
 *     被改过的行 —— 实测报「文件名、目录名或卷标语法不正确」，而错误信息
 *     完全指不到这里。
 *   · 行首是引号时，`/s` 会剥掉**行首行尾**那一对引号；若行尾也是一个引号
 *     （参数里带空格必然如此），剥完就烂。所以行首是引号时必须**再套一层**：
 *     `"" C:\p ath\prog.exe" arg"`。实测不套外层 → 报 `'C:\...\' 不是内部或外部命令`。
 *   · `/d`（跳过 AutoRun：注册表里的 `Command Processor\AutoRun` 会在每次
 *     cmd 启动时执行任意命令）与 `/v:off`（关延迟展开，于是 `!` 是普通字符）
 *     两个开关都**不可省**。
 *
 * 【今天生成出来的行里其实一个元字符都没有】四个命令名是写死的、
 * 旗标是我们自己的、Java 的类名受标识符规则约束（不可能含 `%`）。
 * 但转义规则仍按实测实现并单测 —— 哪天有人把用户路径塞进这行，
 * 那条「今天的行不含元字符」的用例会先红，把人指到这里。
 */
import { spawn } from 'child_process'
import { rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { performance } from 'perf_hooks'
import { RUNNER } from '../../shared/copy'
import { TOOLCHAIN_ROOT } from '../../shared/install-plan'
import type { EnvReport, LangOfCode, RunRequest, RunResult } from '../../shared/types'
import {
  COMPILE_TIMEOUT_MS,
  decodeOutput,
  enqueueRunJob,
  makeRunDir,
  planForLang,
  runProcess,
  unescapeCompilerIdentifiers
} from './runner'

/**
 * 四门语言在原生模式下要解析的**命令名**（不是路径）。
 *
 * 和 `report[lang].path`（检测找到的绝对路径）是两个东西，别混：
 * 这里给的是「让 cmd 按用户 PATH 去解析」的名字。
 */
export const NATIVE_COMMAND: Record<LangOfCode, string> = {
  c: 'gcc',
  cpp: 'g++',
  java: 'javac',
  python: 'python'
}

/**
 * 一个参数在 cmd 的命令行里要不要加引号。
 *
 * 规则：**含空白、含 cmd 的元字符、或者整个是空的** → 加引号；引号本身翻倍。
 * 两边一视同仁的理由：在引号外，空白会把一个参数拆成两个，
 * 而 `& | < > ^ ( )` 更狠 —— 它们会改变整行的结构（`a&b` 会被解释成「先跑 a、再跑 b」）。
 *
 * ⚠️ **有两个字符是引号救不了的，看见它们就不该让它们进这一行**：
 *   · `%`：cmd 的变量展开**在引号里照样发生**（`echo "%PATH%"` 会展开成路径）；
 *   · 换行：一行就是一行，`\n` 后面那截会被当成第二条命令。
 * 今天生成的行里两者都不可能存在（命令名和旗标是写死的；Java 类名受标识符规则约束，
 * 那套规则里没有 `%`，也没有换行）。这个不变式由 native.test.ts 里
 * 「今天生成的行」那一组用例钉着 —— 将来谁要往这行里塞用户填的东西，先回来看这段。
 *
 * 【`!` 为什么不算元字符】延迟展开（`/v:on`）才让 `!` 特殊，而我们固定用 `/v:off`
 * （见文件头），所以它是普通字符。这条也是实测过的，别凭印象加回来。
 */
export function cmdQuoteArg(arg: string): string {
  if (arg === '' || /[\s"&|<>^()]/.test(arg)) return `"${arg.replace(/"/g, '""')}"`
  return arg
}

/**
 * 把「程序 + 参数」拼成一条交给 `cmd /c` 的整行。
 *
 * 【行首是引号时为什么再套一层】见文件头那条实测：`/s` 会剥掉行首行尾的一对
 * 引号，而行尾那个引号一旦属于某个参数，剥完就烂。再套一层之后，
 * cmd 剥掉的正好是我们套的这层。
 */
export function buildCmdLine(exe: string, args: string[]): string {
  const line = [cmdQuoteArg(exe), ...args.map(cmdQuoteArg)].join(' ')
  return line.startsWith('"') ? `"${line}"` : line
}

/**
 * 运行阶段那个可执行文件在**原生模式**下该写成什么。
 *
 * 【为什么不能复用 `resolveExe`】托管模式里 `resolveExe` 把裸名解析成临时目录
 * 里的绝对路径 —— 对 C/C++ 的 `prog.exe`（编译产物，就在 cwd）是对的。
 * 但原生模式下 Java / Python 的裸名是**故意的**：`java.exe` / `python`
 * 必须由 cmd 按**用户 PATH** 解析，解析成 `<临时目录>\java.exe` 就彻底错了。
 * 于是两类分开写：产物走 `.\`（带分隔符，CreateProcess 就不会去 PATH 里找，
 * 也不受 `NoDefaultCurrentDirectoryInExePath` 影响），命令名原样交给 cmd。
 */
export function nativeRunExe(lang: LangOfCode, exe: string): string {
  return lang === 'c' || lang === 'cpp' ? `.\\${exe}` : exe
}

/** `where` 的结论。三种：找到 / 明确没有 / 预检自己坏了 */
export interface WhereResult {
  found: boolean
  /** 找到时的第一个绝对路径（原样来自 where 的输出，不做任何加工） */
  path?: string
  /** 预检这一步自己起不来（where.exe 缺失等）。**这不是「命令不存在」** */
  broken?: string
}

/**
 * 预检：这条命令在你（合并后的）PATH 里吗。
 *
 * 【为什么用 where.exe 的绝对路径，而不是 spawn('where')】
 * 后者要看 PATH —— 而这个函数的入口正是「PATH 可能是假的（测试注入的、
 * 或用户刚改过的）」。用绝对路径，`where` 自己的存在性就与 PATH 无关了。
 *
 * 【找不到时 where 的退出码是 1，并且把话说在 stderr 上】实测的两种情形：
 * 真没有 → 1；PATH 指向一个空目录 → 1。**预检自己坏掉**（spawn 失败）时
 * 返回 `broken` 而不是「没找到」：那两种情况一个要去改 PATH、一个要修系统，
 * 说反了就是把用户引到错方向。
 */
export function probeCommand(
  whereExe: string,
  command: string,
  env: NodeJS.ProcessEnv
): Promise<WhereResult> {
  return new Promise((resolve) => {
    const child = spawn(whereExe, [command], { env, windowsHide: true })
    const chunks: Buffer[] = []
    let settled = false
    const finish = (r: WhereResult): void => {
      if (settled) return
      settled = true
      resolve(r)
    }
    child.stdout.on('data', (c: Buffer) => chunks.push(c))
    child.stderr.on('data', () => {})
    child.on('error', (e: Error) => finish({ found: false, broken: e.message }))
    child.on('exit', (code) => {
      if (code !== 0) return finish({ found: false })
      const first = decodeOutput(Buffer.concat(chunks))
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)[0]
      // where 说成功了却没输出 → 当「没找到」处理：它是唯一有证据的结论。
      return finish(first ? { found: true, path: first } : { found: false })
    })
  })
}

/**
 * 配置闸门：这次请求允不允许走原生模式。
 *
 * 返回 `null` = 放行；返回字符串 = 拒绝理由（handler 拿它抛错）。
 * **没开开关却收到 `native: true` 一律拒绝**：那是旧渲染层或手工 IPC 绕开了
 * 界面上的开关，这时候「照跑」等于背着用户换编译器。
 */
export function nativeGateReason(
  cfgNativeEnabled: boolean,
  reqNative: boolean | undefined
): string | null {
  if (reqNative !== true) return null
  if (cfgNativeEnabled === true) return null
  return 'native run disabled'
}

export interface NativeDeps {
  /**
   * 交给子进程的环境块（`nativeEnv()` 的产物）。
   *
   * ★ **必须可注入，这是设计约束不是测试便利**：不能注入的话，
   * 「这台机器上没装编译器」那条分支在开发机上永远跑不到 ——
   * 而开发机上跑的绿就是假的（红线 16）。
   */
  env: NodeJS.ProcessEnv
  /** cmd.exe 的路径。默认取 ComSpec */
  shell?: string
  /** where.exe 的路径。默认取 %SystemRoot%\System32\where.exe */
  whereExe?: string
}

/**
 * 从一份环境块里读一个变量，**大小写不敏感**。
 *
 * 【为什么不能直接 `env.ComSpec`】Windows 的环境变量大小写不敏感，但
 * 「键名到底写成什么样」由系统决定 —— Node 那边可能是 `ComSpec`、`COMSPEC`、
 * `SystemRoot`、`SYSTEMROOT`。直接按一种写法读，一旦这台机器的写法不是它，
 * 我们就**静默退回**兜底值：SystemRoot 读不到 → 兜底 `C:\Windows`（大多没事），
 * ComSpec 读不到 → 兜底拼一个路径。后者只要 SystemRoot 的写法也恰好不同，
 * 就会变成「cmd.exe 起不来」，而用户会被告知「你的系统外壳坏了」—— 完全是个谎。
 */
function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  if (typeof env[name] === 'string') return env[name]
  const lower = name.toLowerCase()
  for (const k of Object.keys(env)) {
    if (k.toLowerCase() === lower && typeof env[k] === 'string') return env[k]
  }
  return undefined
}

/** 从一份环境块里推出 System32 下的某个系统程序（不依赖 PATH） */
function systemExe(env: NodeJS.ProcessEnv, name: string): string {
  const root = envValue(env, 'SystemRoot') || process.env.SystemRoot || 'C:\\Windows'
  return join(root, 'System32', name)
}

/**
 * 展开形如 `%LOCALAPPDATA%\MiAiBianCheng\toolchain` 里的 `%VAR%`。
 * 认不出的变量**原样保留**（既不删也不换空串）—— 调用方靠「展开后还剩 %」
 * 判断「这台机器上认不全」，从而选择**不敢认**。
 */
export function expandEnv(template: string, env: NodeJS.ProcessEnv): string {
  return template.replace(/%([^%]+)%/g, (whole, name: string) => envValue(env, name) ?? whole)
}

/**
 * `resolved`（where 找到的编译器绝对路径）是否落在**应用自管工具链**目录里。
 *
 * 【为什么必须展开再比 —— 这是一个已核实的实现坑】
 * `TOOLCHAIN_ROOT` 是**占位符字面量**（`%LOCALAPPDATA%\MiAiBianCheng\toolchain`，
 * 见 shared/install-plan.ts，那边还有单测钉着这个形状），直接拿它
 * `startsWith` 去比一条真实路径**永远匹配不上** —— 而且不报错，只表现为
 * 「那句按事实该出现的话永远不出现」。先展开成真实前缀，再比。
 *
 * 【展开后仍含 `%` 就当「不是」】说明这份环境块里缺了要用的变量，我们
 * **认不出来** —— 认不出来就说不出「它是自管的」，按老文案走。
 * 宁可少说一句，不能说一句没证据的话。
 *
 * 比较方式：Windows 路径大小写不敏感、分隔符统一化，且要求
 * **带分隔符的边界**（`…\toolchain2` 不算命中 `…\toolchain`）。
 */
export function isManagedPath(resolved: string | undefined, env: NodeJS.ProcessEnv): boolean {
  if (!resolved) return false
  const root = expandEnv(TOOLCHAIN_ROOT, env)
  if (root.includes('%')) return false
  const norm = (p: string): string => p.replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '')
  const r = norm(root)
  const p = norm(resolved)
  return p === r || p.startsWith(r + '\\')
}

/**
 * 跑一次**原生**编译+运行。失败一律 `ok:false` 并带真实原因，**绝不退回托管模式**。
 *
 * 【四种失败，各自说各自的话】
 *   ① 命令不在你的 PATH 里（预检 `where` 拦下）→ `tool-missing`，文案要说清四件事
 *   ② cmd.exe 起不来（ComSpec 被改坏）→ `shell-failed`
 *   ③ 编译阶段就非 0 退出 → 原样交回编译器的话（这是最有价值的线索，一个字不藏）
 *   ④ 运行阶段非 0 退出 / 超时 → 和托管模式同一套语义
 */
export async function runCodeNative(
  req: RunRequest,
  report: EnvReport,
  deps: NativeDeps
): Promise<RunResult> {
  const started = performance.now()
  let compileWarnings: string | undefined

  const done = (partial: Omit<RunResult, 'durationMs'>): RunResult => ({
    ...partial,
    ...(compileWarnings && partial.phase === 'run' ? { compileWarnings } : {}),
    native: {
      command,
      ...(resolved ? { resolved } : {}),
      // managed 只在**解析到路径、并且认出它落在自管工具链目录里**时才有；
      // 认不出（或压根没解析到）就什么都不带 —— 渲染层落回老文案。
      ...(isManagedPath(resolved, env) ? { managed: true } : {})
    },
    durationMs: Math.round(performance.now() - started)
  })

  const command = NATIVE_COMMAND[req.lang]
  const env = deps.env
  const shell = deps.shell || envValue(env, 'ComSpec') || systemExe(env, 'cmd.exe')
  const whereExe = deps.whereExe || systemExe(env, 'where.exe')
  /** where 找到的第一个路径。**先声明再赋值**：下面的 done() 会读它，而提前 return 的那些分支在赋值之前 */
  let resolved: string | undefined

  // ① 预检。**先查再说**：这一步给出的是一句能照做的解释，
  //    而直接跑的话用户只会拿到一句「'gcc' 不是内部或外部命令」。
  const probe = await probeCommand(whereExe, command, env)
  if (!probe.found && !probe.broken) {
    return done({
      ok: false,
      phase: 'compile',
      stdout: '',
      stderr: '',
      exitCode: null,
      timedOut: false,
      truncated: false,
      message: RUNNER.NATIVE_TOOL_MISSING(command, req.lang, report[req.lang]?.path),
      envIssue: true
    })
  }
  resolved = probe.path

  const plan = planForLang(req.lang, command, req.code)
  if (plan.error) {
    return done({
      ok: false,
      phase: 'compile',
      stdout: '',
      stderr: '',
      exitCode: null,
      timedOut: false,
      truncated: false,
      message: plan.error
    })
  }

  // 子进程环境 = 注入的环境块 + 这一门语言自己的环境（Python 的 PYTHONUTF8）。
  // 展开顺序和托管模式一致：语言自己的键覆盖外层的。
  const childEnv = { ...env, ...(plan.env ?? {}) }

  const dir = makeRunDir()
  try {
    writeFileSync(join(dir, plan.srcFile), req.code, 'utf8')

    if (plan.compile) {
      const line = buildCmdLine(plan.compile.exe, plan.compile.args)
      const c = await runProcess(shell, ['/d', '/v:off', '/s', '/c', line], {
        cwd: dir,
        timeoutMs: COMPILE_TIMEOUT_MS,
        env: childEnv,
        verbatim: true
      })
      if (c.spawnError) {
        // ② cmd.exe 自己起不来 —— 和「命令不在 PATH 里」是两回事，别混
        return done({
          ok: false,
          phase: 'compile',
          stdout: '',
          stderr: c.spawnError,
          exitCode: null,
          timedOut: false,
          truncated: false,
          message: RUNNER.NATIVE_SHELL_FAILED(shell),
          envIssue: true
        })
      }
      if (c.timedOut) {
        return done({
          ok: false,
          phase: 'compile',
          stdout: '',
          stderr: '',
          exitCode: c.exitCode,
          timedOut: true,
          truncated: c.truncated,
          message: RUNNER.COMPILE_TIMEOUT
        })
      }
      if (c.exitCode !== 0) {
        // ③ 编译器自己的话。**不做任何「是不是没装」的猜测** ——
        //    PATH 在预检之后被改掉才会走到这里，那时 cmd 的原话就是真原因。
        return done({
          ok: false,
          phase: 'compile',
          stdout: '',
          stderr: unescapeCompilerIdentifiers(decodeOutput(c.stderr) || decodeOutput(c.stdout)),
          exitCode: c.exitCode,
          timedOut: false,
          truncated: c.truncated
        })
      }
      const warnings = unescapeCompilerIdentifiers(
        decodeOutput(c.stderr).trim() || decodeOutput(c.stdout).trim()
      )
      if (warnings) compileWarnings = warnings
    }

    const runLine = buildCmdLine(nativeRunExe(req.lang, plan.run.exe), plan.run.args)
    const r = await runProcess(shell, ['/d', '/v:off', '/s', '/c', runLine], {
      cwd: dir,
      stdin: req.stdin,
      timeoutMs: Math.min(Math.max(req.timeoutSec ?? 10, 1), 60) * 1000,
      env: childEnv,
      verbatim: true
    })
    if (r.spawnError) {
      return done({
        ok: false,
        phase: 'run',
        stdout: '',
        stderr: r.spawnError,
        exitCode: null,
        timedOut: false,
        truncated: false,
        message: RUNNER.NATIVE_SHELL_FAILED(shell),
        envIssue: true
      })
    }
    if (r.timedOut) {
      return done({
        ok: false,
        phase: 'run',
        stdout: decodeOutput(r.stdout),
        stderr: decodeOutput(r.stderr),
        exitCode: r.exitCode,
        timedOut: true,
        truncated: r.truncated,
        message: RUNNER.RUN_TIMEOUT
      })
    }
    const stdout = decodeOutput(r.stdout)
    const stderr = decodeOutput(r.stderr)
    return done({
      ok: r.exitCode === 0,
      phase: 'run',
      stdout,
      stderr,
      exitCode: r.exitCode,
      timedOut: false,
      truncated: r.truncated,
      // ④-补：非 0 退出且**一个字都没输出**。界面上这时只剩「失败」加一片空白，
      // 用户完全不知道下一步干嘛 —— 补一句如实的话（退出码 + 点破「没输出」
      // 本身就是线索）。**有输出时绝不加**：message 会盖过程序自己的话，
      // 而程序的输出才是第一现场。
      ...(typeof r.exitCode === 'number' &&
      r.exitCode !== 0 &&
      stdout.trim() === '' &&
      stderr.trim() === ''
        ? { message: RUNNER.EXITED_SILENT(r.exitCode) }
        : {})
    })
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // 残留临时目录交给系统清理
    }
  }
}

/**
 * 排进**和托管运行同一条**队列（理由见 runner.ts 里 enqueueRunJob 的注释）。
 *
 * 【为什么单开这个函数，而不是让 handler 自己调 enqueueRunJob】
 * 「原生运行也要排队」这条规矩就不该由 handler 记得。将来谁再加一条运行通道
 * （终端课、Git 课），只管调这个函数，排队这件事自动跟上。
 */
export function enqueueNativeRun(
  req: RunRequest,
  report: EnvReport,
  deps: NativeDeps
): Promise<RunResult> {
  return enqueueRunJob(() => runCodeNative(req, report, deps))
}
