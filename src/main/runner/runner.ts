/**
 * M5-02：四语言编译运行器。
 * 编译/运行都在 mkdtemp 临时目录进行；spawn 数组参数（不经过 shell）+ windowsHide；
 * 超时 taskkill /T /F 杀进程树；输出 256KB 截断；UTF-8 → GBK → latin1 三级回退解码；
 * 单任务队列（一次只跑一个程序，后到排队）。
 * 工具路径由检测报告（EnvReport）注入，安装后无需重启应用即可用。
 */
import { spawn, type ChildProcess } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, isAbsolute, join } from 'path'
import { performance } from 'perf_hooks'
import { RUNNER } from '../../shared/copy'
import type { EnvReport, LangOfCode, RunRequest, RunResult } from '../../shared/types'

// ---------------------------------------------------------------- 常量与纯函数（可单测）

export const MAX_CODE_BYTES = 200 * 1024
export const MAX_STDIN_BYTES = 64 * 1024
export const MAX_OUTPUT_BYTES = 256 * 1024

/**
 * 编译阶段的独立超时（与用户可配的「运行超时」5–30s 解耦）。
 * 理由：javac 冷启动 + JVM 初始化、C++ 模板/头文件展开都可能远超 10s；
 * 若共用运行超时，用户把超时调短后「代码没错却编译被误杀」。
 */
export const COMPILE_TIMEOUT_MS = 60 * 1000

const TEXT_DECODERS = {
  utf8: new TextDecoder('utf-8', { fatal: true }),
  gbk: new TextDecoder('gbk', { fatal: true })
}

/** UTF-8（严格）→ GBK → latin1 三级回退解码；去掉 UTF-8 BOM */
export function decodeOutput(buf: Buffer): string {
  if (buf.length === 0) return ''
  for (const label of ['utf8', 'gbk'] as const) {
    try {
      return TEXT_DECODERS[label].decode(buf).replace(/^﻿/, '')
    } catch {
      // 解码失败换下一级
    }
  }
  return buf.toString('latin1')
}

/**
 * 还原 gcc 在诊断原文里对**非 ASCII 标识符**做的转义。
 *
 * 实测（`_warn-test`）：
 *   warning: unused variable '\U00006ca1\U00007528\U00004e0a' [-Wunused-variable]
 * 那三个码位就是 `没用上`。gcc 打印标识符时一律转义非 ASCII 字符。
 *
 * 【为什么对本项目是功能性缺陷，不只是"难看"】
 * 这套课文的示例代码里中文标识符遍地都是（`篮子`、`起点`、`价格表`）。
 * §35H 的初衷是「把编译器说的话还给学员」，不还原的话，
 * 还回去的是一串 `\U00006ca1…`——学员宁可它别说。
 *
 * 【为什么只能在这一层还原】
 * 试过所有开关都改不掉（`-fdiagnostics-escape-format=bytes` 无效、
 * `=none` 这个 gcc 根本不认、去掉 `-fexec-charset` 也一样），
 * 所以只能在拿到字符串之后自己换回来。
 *
 * ⚠️ **只往编译器诊断上套**（编译错的 stderr、compileWarnings），
 * 绝不能碰 stdout —— 判分是拿 stdout 逐字比的，
 * 动它一个字都可能造成「代码写对了却判错」。
 * 对正常输出它是**恒等变换**（没有 `\U0000xxxx` 就原样返回）。
 */
export function unescapeCompilerIdentifiers(s: string): string {
  // ⚠️ 这里的标识符**必须是 ASCII**，别改回中文（我第一版写成 `原样` / `码位` / `告警`，
  // 让 `copy.test.ts` 那条「界面文案不许绕过 copy.ts 写死」的闸门红了）。
  // 原因不是"中文不好"：那条闸门扫文本节点的正则长这样 ——
  //   `/>[^<>]*[一-鿿][^<>]*</g`
  // 它**允许跨行**（`[^<>]*` 不排 `\n`），本来就是给 `.vue` 模板的 `<button>复制</button>` 写的。
  // 可在 `.ts` 里 `>` 和 `<` 是**比较运算符**，于是 `码位 >= 0x20 && 码位 <= …`
  // 被它当成「一个文本节点」，一路吃到几十行外才收口，报出来的位置指向函数开头,
  // 跟真正写中文的那一行差着十来行 —— 报错的方向是错的，会把人引去查错地方。
  // 项目里 `src/` 全仓没有一个中文标识符（`scripts/` 才用），这次是我的新代码破了例。
  return s.replace(/\\U([0-9a-fA-F]{8})/g, (whole, hex: string) => {
    const codePoint = parseInt(hex, 16)
    // 只还「能显示、且不是代理对半截」的码位；其余的（比如 \U00000000）
    // 说明这段未必是标识符转义，原样留着比乱还原安全。
    const printable =
      codePoint >= 0x20 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
    return printable ? String.fromCodePoint(codePoint) : whole
  })
}

/** 流式收集器：超 256KB 截断并打标 */
export function makeCollector(): { push: (chunk: Buffer) => void; result: () => { buf: Buffer; truncated: boolean } } {
  const chunks: Buffer[] = []
  let size = 0
  let truncated = false
  return {
    push(chunk: Buffer) {
      if (truncated) return
      if (size + chunk.length > MAX_OUTPUT_BYTES) {
        chunks.push(chunk.subarray(0, MAX_OUTPUT_BYTES - size))
        size = MAX_OUTPUT_BYTES
        truncated = true
      } else {
        chunks.push(chunk)
        size += chunk.length
      }
    },
    result() {
      return { buf: Buffer.concat(chunks), truncated }
    }
  }
}

/** 提取 Java 主类名：优先 public class，退回任意 class，都没有返回 null */
export function findJavaClass(code: string): string | null {
  const pub = /public\s+(?:(?:final|abstract|sealed)\s+)*class\s+([A-Za-z_$][\w$]*)/.exec(code)
  if (pub) return pub[1]
  const any = /class\s+([A-Za-z_$][\w$]*)/.exec(code)
  return any ? any[1] : null
}

export interface LangPlan {
  srcFile: string
  compile?: { exe: string; args: string[] }
  run: { exe: string; args: string[] }
  env?: Record<string, string>
  error?: string // 结构级错误（猫咪提示，进 RunResult.message）
}

/** 按语言生成 编译/运行 计划（纯函数） */
export function planForLang(lang: LangOfCode, toolPath: string, code: string): LangPlan {
  switch (lang) {
    case 'c':
      return {
        srcFile: 'main.c',
        // 双 UTF-8 开关防中文乱码；-Wall 顺手抓常见问题
        // -std=gnu11（2026-09-28 加）：不写方言，编译器就用自己的默认值 —— 而老编译器默认得很旧。
        // 朋友的 Dev-C++ 自带 TDM-GCC 4.9.2，默认 gnu89，于是 `for (int i = 0; …)` 直接报
        // 「'for' loop initial declarations are only allowed in C99 or C11 mode」。
        // 全库实测：不写 -std 时他那台机器上 253/585 道题编不过（本机新 gcc 0/585）；
        // 加上之后两边都 0/585。用 gnu11 而不是严格的 c11 —— 保住 GNU 扩展，改写面最小。
        compile: { exe: toolPath, args: ['-finput-charset=UTF-8', '-fexec-charset=UTF-8', '-Wall', '-std=gnu11', '-o', 'prog.exe', 'main.c'] },
        run: { exe: 'prog.exe', args: [] }
      }
    case 'cpp':
      return {
        srcFile: 'main.cpp',
        // -std=gnu++14：同一个道理，老 g++ 默认 gnu++98 —— range-for(36) / unique_ptr(18) /
        // 花括号初始化(10) / stoi(8) 全都不认，实测 160/637 道编不过。
        // 加 gnu++14 后救回 144 道，**降级风险实测为 0**（本机新 gcc 0/637 → 0/637）。
        // 剩 8 道用的是 C++17 折叠表达式 `(args + ... + 0)`，4.9.2 压根没这个模式，再写 -std 也救不了
        // （课 cpp-stage3-13，已在 docs/18 §2.3 记档，不是这里能修的）。
        compile: { exe: toolPath, args: ['-finput-charset=UTF-8', '-fexec-charset=UTF-8', '-Wall', '-std=gnu++14', '-o', 'prog.exe', 'main.cpp'] },
        run: { exe: 'prog.exe', args: [] }
      }
    case 'java': {
      const cls = findJavaClass(code)
      if (!cls) {
        return {
          srcFile: 'Main.java',
          run: { exe: toolPath, args: [] },
          error: RUNNER.NO_JAVA_CLASS
        }
      }
      const javaExe = join(dirname(toolPath), 'java.exe')
      return {
        srcFile: `${cls}.java`,
        compile: {
          exe: toolPath,
          // -J 前缀：javac.exe 只是个启动器，JVM 参数得用 -J 传进去。
          // 关掉本地化是**必须的**，理由见下面 run 的注释。
          args: ['-J-Duser.language=en', '-J-Duser.country=US', '-encoding', 'UTF-8', `${cls}.java`]
        },
        // 双保险：老 JDK 认 file.encoding，JDK18+ 认 stdout.encoding
        //
        // 【为什么强行把语言钉成英文】
        // JDK 会按系统区域设置**翻译自己的报错**。中文 Windows 上 javac 吐的是
        // 「错误: 需要';'」，而且是 GBK 字节 —— 内置错误库的规则是按英文报错
        // （`';' expected`）写的，两边一个字都对不上，Java 那一栏会整个哑掉，
        // 表现是「Python 报错有猫咪解释，Java 报错就只有天书」。
        // 钉成英文之后，报错与用户的系统语言无关，规则库才写得出来。
        // 运行期的 java 也一起钉：异常信息同样会跟着区域设置走。
        run: {
          exe: javaExe,
          args: [
            '-Duser.language=en',
            '-Duser.country=US',
            '-Dfile.encoding=UTF-8',
            '-Dstdout.encoding=UTF-8',
            cls
          ]
        }
      }
    }
    case 'python':
      return {
        srcFile: 'main.py',
        run: { exe: toolPath, args: ['-X', 'utf8', 'main.py'] },
        env: { PYTHONUTF8: '1' }
      }
  }
}

// ---------------------------------------------------------------- 进程执行

export interface ProcResult {
  stdout: Buffer
  stderr: Buffer
  exitCode: number | null
  timedOut: boolean
  truncated: boolean
  /** spawn 本身失败（exe 不存在 / 无权限 / EMFILE 等）时的原因；正常退出为 undefined */
  spawnError?: string
}

/**
 * Windows 杀整棵进程树；其余平台退化为直接 kill。
 *
 * ⚠️ `killer.on('error')` 不能省：`spawn` 是**同步返回、错误异步抛**的，外层 try/catch 抓不到；
 * 而未处理的 'error' 事件会**直接杀死主进程**——放进 Electron 就是整个应用闪退
 * （实测复现：spawn 不存在的 exe → `throw er; // Unhandled 'error' event` → exit code 1）。
 * 触发场景虽少见（杀软拦截进程创建、句柄耗尽 EMFILE/EAGAIN），但后果是整个应用崩掉。
 *
 * ⚠️⚠️ 【2026-10-11 孤儿事故】win32 正路**绝不在同步路径上 process.kill(pid)**。
 * 旧实现在 spawn(taskkill) 之后紧跟着同步 process.kill(pid) 当「兜底」，而这一刀
 * 总是先到：它把直接子进程（cmd.exe）先杀了，几毫秒后 taskkill 才醒来 ——
 * 按 PID 找树的前提（父进程还在）已经没了，taskkill 只会报「错误: 没有找到进程」
 * 空手而归，**挂在 cmd 下面的孙子（python/node 学生程序）就此孤儿化，继续满核烧**。
 * 现场：29 个孤儿 python（%TEMP%\miai-run-*\main.py = `while True: pass`，父全死），
 * 源头是原生模式超时路径——native.test.ts 的超时夹具每跑一轮全量测试泄漏一个。
 * 两臂实测（见工作区内的 `_deploy-p106-20261011/_race-killtree.mjs`，不随仓库分发）：
 *   现状时序 → taskkill rc=128「没有找到进程」+ python 存活；
 *   只让 taskkill 干活 → 「成功: 已终止 PID …」python 死。
 * 故 win32 分支到此 return；process.kill 只在 taskkill 拉不起来（'error' = 绝境降级）时执行。
 * 已知边界：若直接子进程先于收割自灭（罕见：cmd 通常等孙子），taskkill /T 找不到树根，
 * 孙子仍会孤儿化 —— 这是 taskkill 语义的固有边界，不是本函数的时序问题。
 *
 * @param killerExe 仅用于单测注入一个不存在的可执行文件来验证上述降级路径；生产恒为 'taskkill'
 */
export function killTree(pid: number, killerExe = 'taskkill'): void {
  if (process.platform === 'win32') {
    try {
      const killer = spawn(killerExe, ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.on('error', () => {
        // taskkill 拉不起来 → 降级为直接杀这个 pid，绝不让它冒泡成未捕获异常。
        // 【已验证】注释掉本行后，runner.test.ts 的 killTree 用例会触发 Uncaught Exception，
        // 且整个 vitest 以退出码 1 失败——注意它表现为 "Errors 1 error" 而非某条用例失败。
        // 降级在绝境里仍杀直接子进程：若它下面挂着 cmd 中介的孙子，孙子会被孤儿化 ——
        // 权衡见上方 ⚠️⚠️（孤儿化终究好过整棵树都活着，且此路径几乎不触发）。
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // 已退出
        }
      })
      killer.unref()
      return // ← 见上方 ⚠️⚠️：同步 process.kill 会把孙子孤儿化，win32 正路就此打住
    } catch {
      // spawn 同步抛错（参数非法等）→ 落到下面的 process.kill 降级
    }
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // 已退出
  }
}

/**
 * 选一个纯 ASCII 的临时根目录。
 * 用户名含非 ASCII（如 `C:\Users\小明\`）时，javac/java 的路径处理是经典坑；
 * 此处只做「是否纯 ASCII」的判定（纯函数，便于单测），实际创建失败还有外层兜底。
 */
export function pickTempRoot(tmp: string, asciiFallback: string): string {
  return /^[\x00-\x7F]*$/.test(tmp) ? tmp : asciiFallback
}

/**
 * 建本次运行的临时目录：优先 ASCII 根，创建失败则退回系统 tmpdir。
 *
 * 【为什么导出】原生模式（native.ts）要用**同一个**临时目录策略 ——
 * 两处各写一遍的话，「用户名含中文时退回 Public」这条修复就只会惠及其中一条路径，
 * 而另一条的症状（javac 报了看不懂的路径错）没人认得出是同一个根因。
 */
export function makeRunDir(): string {
  const fallback = join(process.env.SystemDrive || 'C:', 'Users', 'Public', 'miai-runner')
  const root = pickTempRoot(tmpdir(), fallback)
  try {
    mkdirSync(root, { recursive: true })
    return mkdtempSync(join(root, 'miai-run-'))
  } catch {
    return mkdtempSync(join(tmpdir(), 'miai-run-'))
  }
}

/**
 * 把「要跑的东西」解析成绝对路径。
 *
 * 【为什么必须有这一步 —— 这是 2026-09-13 真机跑出来的 bug】
 * C/C++ 的 plan.run.exe 是 `'prog.exe'`（编译产物的名字，不带目录）。
 * Windows 上 `spawn('prog.exe')` 这种**不带路径分隔符**的名字，Node 只按 PATH 找，
 * **完全不看 cwd** —— cwd 只决定子进程的工作目录，不参与可执行文件的查找。
 * 结果：编译明明成功、prog.exe 就在 cwd 里躺着，spawn 却报 ENOENT。
 *
 * 【为什么这个 bug 藏了这么久】
 * Java 跑的是 `join(dirname(javac), 'java.exe')`、Python 跑的是检测出的绝对路径，
 * 两者都自带目录，所以只有 C/C++ 会踩。而本机直到装上 gcc 那天才有 C/C++ 工具链，
 * 在那之前六条 C/C++ 样例从来没被真正跑过一次。
 * 更糟的是 runner.test.ts 里有一条断言把这句 `exe: 'prog.exe'` 原样钉住了 ——
 * 测试在保护 bug，谁改谁红。
 *
 * 【为什么在运行处解析，而不是让 plan 直接给出绝对路径】
 * planForLang 是纯函数，它压根不知道临时目录建在哪（目录是 runCode 里才建的），
 * 而编译参数 `-o prog.exe` 也是相对 cwd 写的。plan 描述「产物叫什么」，
 * 运行处才知道「它在哪」—— 各管各的，别硬塞。
 */
export function resolveExe(exe: string, cwd: string): string {
  return isAbsolute(exe) ? exe : join(cwd, exe)
}

/**
 * 合并两份环境块，**结果里不会出现大小写不同的同名键**。
 *
 * 【为什么不能直接 `{...base, ...over}`】Windows 的环境变量大小写不敏感，
 * 而 JS 对象的键**大小写敏感**。`process.env` 里那个键的真实写法由系统决定
 * （`Path` / `PATH` 两种都常见），而我们把合并后的 PATH 统一写成 `'PATH'` ——
 * 于是 spread 的产物里可以同时住着 `Path`（旧的）和 `PATH`（新的）。
 * 而子进程最终看到哪一个，**由拼写决定，不由我们**：
 *
 * 【实测（2026-09-28，本机 Windows 11）】造一份最小环境块、两个键故意拼得不一样，
 * 再让**两种不同的子进程**各自报出它读到的 PATH：
 *
 *   | 交出去的对象 | cmd.exe（`echo %PATH%`） | node（报 `process.env` 的键） |
 *   |---|---|---|
 *   | `{Path:'OLD', PATH:'NEW'}` | `NEW` | 只有一个键 `PATH=NEW` |
 *   | `{PATH:'OLD', Path:'NEW'}` | `OLD` | 只有一个键 `PATH=OLD` |
 *   | 只有一个键时 | — | 写法原样保留（`{Path:'ONLY'}` → `Path=ONLY`） |
 *
 * 即：**两个键撞车时，全大写的那个拼写赢，而且赢的只有一个**（环境块按字节序排过，
 * `PATH` 排在 `Path` 前面，命中第一个）。两条子进程结论一致，不是某一家的怪癖。
 *
 * 【那为什么还要在这里挡一道】因为今天「覆盖能赢」**靠的是我们恰好写的是大写** ——
 * 这条依赖是隐性的，也不在我们自己手里：它寄存于「环境块会按字节序排」+
 * 「命中第一个」这两条实现细节上。而 `mergeEnv` 的调用方未必都记得写大写
 * （托管模式传进来的是语言自己的那几个键，将来谁说不会带一个 `Path`？）——
 * 那时候上面第二行就成立：**覆盖静默输掉，子进程拿到旧 PATH**。
 * 与其把正确性押在拼写上，不如在这里按大小写归一掉：**不变式由构造保证**。
 *
 * `over` 赢：调用方传进来的就是「这次我要改的那几个」。
 */
export function mergeEnv(
  base: NodeJS.ProcessEnv,
  over: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...base }
  for (const key of Object.keys(over)) {
    const lower = key.toLowerCase()
    for (const existing of Object.keys(out)) {
      if (existing !== key && existing.toLowerCase() === lower) delete out[existing]
    }
    out[key] = over[key]
  }
  return out
}

/**
 * 在跑的编译/运行子进程登记表 —— 配套 killAllLiveChildren。
 * IDE 进程（native-ide 起的）不经过这里：它就该活过应用本身。
 */
const liveChildren = new Set<ChildProcess>()

/**
 * 退出前收割：杀掉所有还没跑完的编译/运行子进程。
 *
 * 【为什么必须有】runProcess 的超时杀树靠主进程里的定时器；主人运行一个
 * 死循环的学生程序后直接点 X 关应用，定时器随进程一起消亡 —— taskkill
 * 永远等不到，程序变成孤儿继续烧 CPU（「关窗不留后台进程」的核查缺口，
 * 2026-10-06）。主进程 'before-quit' 时调用；taskkill 是独立进程，
 * 应用退出后照常完成收割。
 */
export function killAllLiveChildren(): void {
  for (const child of liveChildren) {
    if (child.pid !== undefined) killTree(child.pid)
  }
}

/**
 * 起一个子进程、收干它的输出。托管模式的编译/运行两步都走这里。
 *
 * 【为什么导出、以及那个 `verbatim` 开关】原生模式（native.ts）要借 cmd.exe 跑，
 * 而 Windows 上「把一条已经拼好的整行原样交给 cmd」必须 `windowsVerbatimArguments: true`：
 * 不加的话 libuv 会按 MSVCRT 规则替我们给带空格的参数**加引号**（还带 `\"`），
 * cmd 收到的是被改过的行 —— 实测报「文件名、目录名或卷标语法不正确」，
 * 而这个报错完全指不到真实原因。托管模式不带这个开关（它的 argv 本来就该被转义）。
 * 实测记录与整行拼法见 native.ts 文件头。
 */
export function runProcess(
  exe: string,
  args: string[],
  opts: {
    cwd: string
    stdin?: string
    timeoutMs: number
    env?: NodeJS.ProcessEnv
    /** 见函数头注释。只有「把整行交给 cmd.exe」时必须为 true */
    verbatim?: boolean
  }
): Promise<ProcResult> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, {
      cwd: opts.cwd,
      windowsHide: true, // 不闪黑窗口
      ...(opts.verbatim ? { windowsVerbatimArguments: true } : {}),
      env: mergeEnv(process.env, opts.env ?? {})
    })
    liveChildren.add(child)
    const out = makeCollector()
    const err = makeCollector()
    child.stdout.on('data', (c: Buffer) => out.push(c))
    child.stderr.on('data', (c: Buffer) => err.push(c))

    let timedOut = false
    let done = false
    let spawnError: string | undefined
    const timers: NodeJS.Timeout[] = []
    const finish = (exitCode: number | null): void => {
      if (done) return
      done = true
      for (const t of timers) clearTimeout(t)
      const r1 = out.result()
      const r2 = err.result()
      resolve({
        stdout: r1.buf,
        stderr: r2.buf,
        exitCode,
        timedOut,
        truncated: r1.truncated || r2.truncated,
        spawnError
      })
    }

    // 超时 → taskkill 杀树；再兜底 3s 强制收尾（防僵死进程挂住队列）
    timers.push(
      setTimeout(() => {
        timedOut = true
        if (child.pid !== undefined) killTree(child.pid)
      }, opts.timeoutMs),
      setTimeout(() => finish(null), opts.timeoutMs + 3000)
    )

    // spawn 失败（exe 不存在 / 无权限等）：记下原因，好让上层给用户一句人话而不是空白失败
    child.on('error', (e: Error) => {
      liveChildren.delete(child)
      spawnError = e.message
      finish(null)
    })
    child.on('exit', (code) => {
      liveChildren.delete(child)
      finish(code)
    })

    if (child.stdin) {
      child.stdin.on('error', () => {}) // 程序提前退出时 EPIPE 无视
      child.stdin.write(opts.stdin ?? '')
      child.stdin.end()
    }
  })
}

// ---------------------------------------------------------------- 主流程 + 单任务队列

// 语言展示名已上移到 shared/copy.ts（LANG_DISPLAY / langName），
// 此处不再自留一份——曾经这里写着「C 语言」而界面上是「C」，同一个东西两种说法。

/** 执行一次 编译+运行（临时目录用完即清） */
export async function runCode(req: RunRequest, report: EnvReport): Promise<RunResult> {
  const started = performance.now()
  // 编译过了、编译器却仍说了话（`-Wall` 的告警）——见下面赋值的注释。
  // 只在这一趟真的跑了「运行」阶段时才带出去：编译失败时 stderr 本身就是主角，
  // 再挂一份就是同一段话在屏幕上显示两遍。
  let compileWarnings: string | undefined

  const done = (partial: Omit<RunResult, 'durationMs'>): RunResult => ({
    ...partial,
    ...(compileWarnings && partial.phase === 'run' ? { compileWarnings } : {}),
    durationMs: Math.round(performance.now() - started)
  })

  const tool = report[req.lang]
  // 用户可配的是「运行超时」；编译走独立的 COMPILE_TIMEOUT_MS，不共用（见该常量注释）
  const runTimeoutMs = Math.min(Math.max(req.timeoutSec ?? 10, 1), 60) * 1000

  if (!tool?.found || !tool.path) {
    return done({
      ok: false,
      phase: 'compile',
      stdout: '',
      stderr: '',
      exitCode: null,
      timedOut: false,
      truncated: false,
      message: RUNNER.ENV_MISSING(req.lang),
      envIssue: true
    })
  }

  const plan = planForLang(req.lang, tool.path, req.code)
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

  const dir = makeRunDir()
  try {
    writeFileSync(join(dir, plan.srcFile), req.code, 'utf8')

    if (plan.compile) {
      const c = await runProcess(plan.compile.exe, plan.compile.args, {
        cwd: dir,
        timeoutMs: COMPILE_TIMEOUT_MS, // 编译用独立宽限，不吃用户的运行超时
        env: plan.env
      })
      if (c.spawnError) {
        return done({
          ok: false,
          phase: 'compile',
          stdout: '',
          stderr: c.spawnError,
          exitCode: null,
          timedOut: false,
          truncated: false,
          message: RUNNER.TOOL_NOT_FOUND,
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
      // 走到这里 = 编译过了。但「编译过了」不等于「编译器没说话」：
      // 实测 458 次成功编译里有 48 次仍然往 stderr 吐了诊断（`-Wall` 的告警），
      // 而此前这段被整个丢掉 —— 于是课文里「翻译官喵会嘀咕一句 warning: …」
      // 学员在练习场里一个字都看不到，只能当成课文在瞎说。
      // 只挑非空白的接出去；两边都空就保持 undefined（不是空串，界面好判）。
      const warnings = unescapeCompilerIdentifiers(
        decodeOutput(c.stderr).trim() || decodeOutput(c.stdout).trim()
      )
      if (warnings) compileWarnings = warnings
    }

    // 必须解析成绝对路径：C/C++ 的产物是不带目录的 prog.exe，直接 spawn 会按 PATH 找而报 ENOENT
    const r = await runProcess(resolveExe(plan.run.exe, dir), plan.run.args, {
      cwd: dir,
      stdin: req.stdin,
      timeoutMs: runTimeoutMs,
      env: plan.env
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
        message: RUNNER.SPAWN_FAILED,
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
    return done({
      ok: r.exitCode === 0,
      phase: 'run',
      stdout: decodeOutput(r.stdout),
      stderr: decodeOutput(r.stderr),
      exitCode: r.exitCode,
      timedOut: false,
      truncated: r.truncated
    })
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // 残留临时目录交给系统清理
    }
  }
}

/** 单任务队列的队尾。见下面 enqueueRunJob 的注释 */
let queue: Promise<unknown> = Promise.resolve()

/**
 * 单任务队列：并发请求排队执行，返回各自结果；队列断链自愈。
 *
 * 【为什么排的是「一个函数」而不是「一次运行」】3.0 加了原生模式之后，队列里排的
 * 不再只有托管运行 —— `native.ts` 的 enqueueNativeRun 排的是**同一条队**：
 * 两条路各自的临时目录互不干扰（每次 mkdtemp），但**同时跑**会让 CPU 争抢，
 * 而争抢的后果是超时判定变成「有时超时、有时不超时」—— 学员在老机器上做题时
 * 最容易撞见这种「同一段代码刚才还能跑」。所以两条路共用一条队，一次只跑一个。
 */
export function enqueueRunJob<T>(job: () => Promise<T>): Promise<T> {
  const p = queue.then(job)
  queue = p.catch(() => undefined)
  return p
}

export function enqueueRun(req: RunRequest, report: EnvReport): Promise<RunResult> {
  return enqueueRunJob(() => runCode(req, report))
}
