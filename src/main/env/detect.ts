/**
 * M5-01：编程环境检测。
 * 策略：① `where` 命令查 PATH（外加**注册表里的 PATH**，见下）；
 * ② 常见安装目录兜底扫描（含 winget 默认位置、各个盘、各家发行版）；
 * ③ **注册表卸载项**里认出的 IDE 自带工具链（Dev-C++ / Code::Blocks 等装在哪儿都认，
 *    见 `ideToolchainCandidates()`）；
 * ④ 用 `--version` 验证并取版本号（**stdout 与 stderr 都读**，理由见下面的实测记录）。
 * 结果缓存进 config.json 的 envCache（写穿式），设置页可触发重新检测。
 *
 * ⚠️ 缓存**不能无条件信**：读缓存请走 `refreshLangs`，别直接看 `cfg.envCache.report`。
 * 规则与理由见 shared/env-cache.ts。
 *
 * ---------------------------------------------------------------
 * 【2026-09-17：分享版在别人电脑上「明明装了却说没装」的三个真根因】
 * 主人的朋友装了 Java + Python，检测却找不到 Java、Python 一跑就报错、
 * 点「重新检测」毫无变化。逐条实测出来的原因（都在本文件里修掉了）：
 *
 * ① **PATH 是应用启动那一刻的快照，而注册表里的才是最新的。**
 *    用户在开机后装的 JDK 会写进注册表 PATH，但**不会**回到已经在跑的应用的
 *    `process.env.PATH` 里。旧代码只查 `where`（= 查进程 PATH），于是
 *    「装完了、点重新检测、还是说没装」——重新检测是真的重跑了，
 *    只是每次都拿着同一份过期的 PATH 去查。→ 修法见 `mergedPath()`。
 *
 * ② **`where` 会返回多行，旧代码只看第一行。**
 *    本机实测 `where python` 返回两行：真的 python.exe 和 Microsoft Store 的
 *    应用执行别名。谁的机器上只有后者，就完全找不到 Python。
 *    → 修法见 `whereAll()`。
 *
 * ③ **「命令能起来」被当成了「编译器能用」。**
 *    那个 Store 别名是**空壳**：本机实测它**什么都不输出、退出码 49**。
 *    旧代码见 `where` 命中就 `return { found: true, path }`，版本号是不是真的
 *    压根不看 —— 于是界面显示「已找到」，一运行就报错，而报错信息里
 *    一个字都没提「你找到的是个空壳」。
 *    → 修法见 `looksLikeVersion()` 与 `detectLang()` 的三段式候选。
 *
 * ④ **一个坏掉的候选 exe 会把整条检测链炸掉（2026-09-17 补测出来的）。**
 *    Node 对「名字是 .exe 但内容不是可执行文件」的候选，`execFile` 会**同步抛出**
 *    EFTYPE —— 它**不走回调**，于是旧写法 `new Promise(resolve => execFile(..., cb))`
 *    会直接变成 rejected promise，异常一路抛穿 `detectLang` → `detectAll` → IPC，
 *    结果是**四门语言一起报「检测失败」**，而用户只是 PATH 里躺了一个 0 字节的
 *    python.exe（下载中断、装到一半取消都会留下这种东西）。
 *    → 修法见 `runCapture()` 的 try/catch。
 *
 * ---------------------------------------------------------------
 * 【2026-09-17 二次事故：反方向的「没装却说装了」（假阳性）】
 * 另一个朋友的电脑上**只装了 Java**，界面却给 C / C++ / Python 全打上 ✓，
 * 只有 Java 报了真版本号。他信了那个 ✓，一写 C 就「没有翻译官」。
 *
 * ⑤ **两处叠加成的假阳性，缺一处都不会发生：**
 *    a) `expandGlob()` 对**不带 `*` 的路径直接原样返回、不查存在性** ——
 *       而兜底表里 30 条候选有 23 条是这种「这台机器上根本没有」的路径
 *       （C:\mingw64\bin\gcc.exe 之类）。它们全成了合法候选。
 *    b) `chooseCompiler()` 有一条**「降级兜底」**：三段都验不出来时，
 *       只要候选里有 `.exe` 结尾的就 `found: true`。于是那批幻影路径
 *       被认成了「找到了」，**没有版本号**——正是朋友看到的「✓ 但没版本」。
 *
 * ⚠️ 这条比第一次事故更恶劣：**「没装说装了」比「装了说没装」坏得多**，
 * 因为它骗取信任。铁律：判定成功只有一条路 —— **真跑 + 退出码 0 + 报得出像样版本号**；
 * 任何形式的「默认回退为成功」都不允许存在。
 * → 修法见 `expandGlob()` 的存在性检查、`tryVersion()` 的 `if (!r.ok) return undefined`、
 *   以及 `chooseCompiler()` 里**已删除**的降级分支。
 *
 * ⚠️ 本文件的标识符一律用 ASCII。中文只出现在注释里 ——
 * `renderer/src/lib/__tests__/copy.test.ts` 那道闸门会把「代码里写死的中文」
 * 当成绕过 copy.ts 的界面文案报出来，而它是按字符扫的，分不清标识符和文案。
 */
import { execFile } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { LANG_OF_CODE } from '../../shared/types'
import type { EnvReport, LangEnv, LangOfCode } from '../../shared/types'
import { TOOLCHAIN } from '../../shared/install-plan'
import { blankReport, langsToRecheck } from '../../shared/env-cache'

const EMPTY: LangEnv = { found: false }

// ---------------------------------------------------------------- 文本解码

/**
 * `where` / `reg` 之类的命令行工具往**控制台代码页**写字，
 * 中文 Windows 上是 GBK。按 UTF-8 硬解会把中文路径解成乱码 ——
 * 而乱码路径的下一步是「找不到文件」，症状看起来像「检测逻辑坏了」。
 *
 * 【怎么判断该用哪种】先按 UTF-8 解，出现替换字符 U+FFFD 就说明它不是合法 UTF-8，
 * 换 GBK 再解一次。这比「一律 GBK」安全：真的 UTF-8 输出（Node 自己的子进程、
 * 现代 CLI 工具）不会被解坏；真的 GBK 输出也救得回来。
 */
const gbkDecoder = (() => {
  try {
    return new TextDecoder('gbk')
  } catch {
    return null // 没有完整 ICU 的 Node 构建，退回 UTF-8
  }
})()

export function decodeConsole(buf: Buffer): string {
  const utf8 = buf.toString('utf8')
  if (!utf8.includes('\uFFFD')) return utf8
  if (!gbkDecoder) return utf8
  try {
    return gbkDecoder.decode(buf)
  } catch {
    return utf8
  }
}

// ---------------------------------------------------------------- 路径表

/**
 * **手工装**（没用一键安装）时编译器常见的落点。注意是**可执行文件全路径**，不是目录
 * —— 名字叫 dirs 会让人往里塞 `...\mingw64\bin`，然后 expandGlob 找不到 exe，
 * 症状是「明明装了却检测不出来」，所以这里连字段名一起改对了。
 *
 * 【为什么这里不抄 winget 的路径】
 * 「一键安装装到哪」的真源在 shared/install-plan.ts（我们自己的 toolchain 目录、
 * winget 自管目录、WinGet\Links 快捷方式目录）。两边各存一份的下场是：
 * 安装脚本往 A 装、检测脚本只找 B，用户看到的是「装了 20 分钟还是说没装」。
 * 所以这里只留手工装的路径，winget 那半边由下面的 fallbackPathsFor 拼进来。
 *
 * 【为什么按盘符生成而不是写死 C:（2026-09-17 补）】
 * 旧表把每一条都钉在 `C:\`，于是「装在 D:\Java 的人」永远检测不到 —— 而国内
 * 装机把开发工具放 D 盘极其常见。现在盘符由 `existingDrives()` 枚举出来再拼，
 * 有几个盘就查几个盘，且**字符串天然不重复**（盘符不同，路径必不同）。
 */
function perDrivePaths(drive: string): Record<LangOfCode, string[]> {
  const P = (p: string): string => `${drive}:\\${p}`
  return {
    c: [
      P('msys64\\mingw64\\bin\\gcc.exe'),
      P('msys64\\ucrt64\\bin\\gcc.exe'),
      P('msys64\\mingw32\\bin\\gcc.exe'),
      P('mingw64\\bin\\gcc.exe'),
      P('mingw32\\bin\\gcc.exe'),
      P('MinGW\\bin\\gcc.exe'),
      P('Program Files\\mingw-w64\\*\\mingw64\\bin\\gcc.exe'),
      P('Program Files\\WinLibs\\*\\mingw64\\bin\\gcc.exe'),
      // ---- IDE 自带的工具链（2026-09-28 任务一补）----
      // 【为什么这块要补】旧的 IDE 条目只有 4 条，其中 Dev-C++ 那条写的是
      // `Program Files\Dev-Cpp\MinGW64\bin\gcc.exe`（**非 x86** 的那一份）。
      // 而本机实测：Dev-C++ 5.11 装在 `C:\Program Files (x86)\Dev-Cpp\MinGW64\` ——
      // 32 位安装包在 64 位 Windows 上默认就落这儿。于是这台机器对兜底表**完全不可见**，
      // 这就是「装了 Dev-C++ 却说没装」那条 bug 的形状（朋友的电脑）。
      // 下面把两代工具链（MinGW64 / MinGW32）、两种 Program Files、以及盘根落点补齐。
      P('Program Files (x86)\\Dev-Cpp\\MinGW64\\bin\\gcc.exe'),
      P('Program Files (x86)\\Dev-Cpp\\MinGW32\\bin\\gcc.exe'),
      P('Program Files\\Dev-Cpp\\MinGW64\\bin\\gcc.exe'),
      P('Program Files\\Dev-Cpp\\MinGW32\\bin\\gcc.exe'),
      P('Dev-Cpp\\MinGW64\\bin\\gcc.exe'),
      P('Dev-Cpp\\MinGW32\\bin\\gcc.exe'),
      P('Program Files\\CodeBlocks\\MinGW\\bin\\gcc.exe'),
      P('Program Files (x86)\\CodeBlocks\\MinGW\\bin\\gcc.exe'),
      P('CodeBlocks\\MinGW\\bin\\gcc.exe'),
      P('TDM-GCC-64\\bin\\gcc.exe'),
      P('TDM-GCC-32\\bin\\gcc.exe'),
      P('Program Files\\TDM-GCC-64\\bin\\gcc.exe'),
      P('Program Files\\TDM-GCC-32\\bin\\gcc.exe'),
      P('ProgramData\\chocolatey\\bin\\gcc.exe')
    ],
    cpp: [
      P('msys64\\mingw64\\bin\\g++.exe'),
      P('msys64\\ucrt64\\bin\\g++.exe'),
      P('msys64\\mingw32\\bin\\g++.exe'),
      P('mingw64\\bin\\g++.exe'),
      P('mingw32\\bin\\g++.exe'),
      P('MinGW\\bin\\g++.exe'),
      P('Program Files\\mingw-w64\\*\\mingw64\\bin\\g++.exe'),
      P('Program Files\\WinLibs\\*\\mingw64\\bin\\g++.exe'),
      // IDE 自带工具链：与上面 c 表逐条对应（改一边忘了另一边 = 「C 找到了 C++ 没有」）
      P('Program Files (x86)\\Dev-Cpp\\MinGW64\\bin\\g++.exe'),
      P('Program Files (x86)\\Dev-Cpp\\MinGW32\\bin\\g++.exe'),
      P('Program Files\\Dev-Cpp\\MinGW64\\bin\\g++.exe'),
      P('Program Files\\Dev-Cpp\\MinGW32\\bin\\g++.exe'),
      P('Dev-Cpp\\MinGW64\\bin\\g++.exe'),
      P('Dev-Cpp\\MinGW32\\bin\\g++.exe'),
      P('Program Files\\CodeBlocks\\MinGW\\bin\\g++.exe'),
      P('Program Files (x86)\\CodeBlocks\\MinGW\\bin\\g++.exe'),
      P('CodeBlocks\\MinGW\\bin\\g++.exe'),
      P('TDM-GCC-64\\bin\\g++.exe'),
      P('TDM-GCC-32\\bin\\g++.exe'),
      P('Program Files\\TDM-GCC-64\\bin\\g++.exe'),
      P('Program Files\\TDM-GCC-32\\bin\\g++.exe'),
      P('ProgramData\\chocolatey\\bin\\g++.exe')
    ],
    java: [
      P('Program Files\\Java\\jdk*\\bin\\javac.exe'),
      P('Program Files\\Eclipse Adoptium\\jdk*\\bin\\javac.exe'),
      P('Program Files\\Eclipse Foundation\\jdk*\\bin\\javac.exe'),
      P('Program Files\\Microsoft\\jdk*\\bin\\javac.exe'),
      P('Program Files\\Amazon Corretto\\jdk*\\bin\\javac.exe'),
      P('Program Files\\Zulu\\zulu*\\bin\\javac.exe'),
      P('Program Files\\BellSoft\\LibericaJDK*\\bin\\javac.exe'),
      P('Program Files\\Semeru\\jdk*\\bin\\javac.exe'),
      P('Program Files\\RedHat\\java-*\\bin\\javac.exe'),
      P('Program Files\\SapMachine\\jdk*\\bin\\javac.exe'),
      // Android Studio 自带一个能用的 JDK，装了它的人不该再被要求装一次
      P('Program Files\\Android\\Android Studio\\jbr\\bin\\javac.exe'),
      P('Java\\jdk*\\bin\\javac.exe'),
      P('jdk*\\bin\\javac.exe'),
      P('ProgramData\\chocolatey\\bin\\javac.exe')
    ],
    python: [
      P('Python3*\\python.exe'),
      P('Python*\\python.exe'),
      P('Python\\python.exe'),
      P('Program Files\\Python3*\\python.exe'),
      P('Program Files\\Python*\\python.exe'),
      P('ProgramData\\anaconda3\\python.exe'),
      P('ProgramData\\miniconda3\\python.exe'),
      P('ProgramData\\chocolatey\\bin\\python.exe')
    ]
  }
}

/**
 * 跟盘符无关的用户级落点（用 `%ENV%` 占位，由 expandEnvVars 展开）。
 * 这些在每台机器上都可能命中，所以不参与盘符枚举。
 */
const userLevelPaths: Record<LangOfCode, string[]> = {
  c: [
    '%USERPROFILE%\\scoop\\shims\\gcc.exe',
    '%LOCALAPPDATA%\\Programs\\mingw64\\bin\\gcc.exe',
    '%USERPROFILE%\\AppData\\Local\\Programs\\mingw64\\bin\\gcc.exe',
    // IDE 工具链用 %ProgramFiles% 再写一遍（2026-09-28 任务一）。
    // 【为什么不嫌重复】perDrivePaths 里那份是「盘符 + 字面量」，只能覆盖
    // 「装在默认位置」的人；Program Files 被挪过位置的机器上，只有环境变量指得对。
    // 两个理由值得留这一份：
    //   ① 覆盖挪过窝的机器（真需求）；
    //   ② 这一份**吃注入的 env** —— 没有它，就没法在临时目录里造一棵假的 Dev-C++ 树
    //      把整条链路端到端跑一遍（红线 16：开发机上四门齐活，那种绿是假的）。
    // 默认机器上两份展开成同一条路径的代价，由 chooseCompiler 的 dedupePaths 收掉。
    '%ProgramFiles(x86)%\\Dev-Cpp\\MinGW*\\bin\\gcc.exe',
    '%ProgramFiles%\\Dev-Cpp\\MinGW*\\bin\\gcc.exe',
    '%ProgramFiles(x86)%\\CodeBlocks\\MinGW\\bin\\gcc.exe',
    '%ProgramFiles%\\CodeBlocks\\MinGW\\bin\\gcc.exe'
  ],
  cpp: [
    '%USERPROFILE%\\scoop\\shims\\g++.exe',
    '%LOCALAPPDATA%\\Programs\\mingw64\\bin\\g++.exe',
    '%USERPROFILE%\\AppData\\Local\\Programs\\mingw64\\bin\\g++.exe',
    // 与 c 表同源，改一边记得改另一边
    '%ProgramFiles(x86)%\\Dev-Cpp\\MinGW*\\bin\\g++.exe',
    '%ProgramFiles%\\Dev-Cpp\\MinGW*\\bin\\g++.exe',
    '%ProgramFiles(x86)%\\CodeBlocks\\MinGW\\bin\\g++.exe',
    '%ProgramFiles%\\CodeBlocks\\MinGW\\bin\\g++.exe'
  ],
  java: [
    '%USERPROFILE%\\scoop\\shims\\javac.exe',
    // IntelliJ IDEA 下载的 JDK 默认躺在这 —— 用 IDEA 学 Java 的人非常多
    '%USERPROFILE%\\.jdks\\*\\bin\\javac.exe',
    '%LOCALAPPDATA%\\Programs\\Eclipse Adoptium\\jdk*\\bin\\javac.exe'
  ],
  python: [
    '%USERPROFILE%\\scoop\\shims\\python.exe',
    // 注意：`%LOCALAPPDATA%\Programs\Python\Python3*` 不在这里列 ——
    // 它已经在 install-plan 的 TOOLCHAIN 表里了，再抄一份会被「无重复」的单测拦下。
    // 这正说明那张单测有用：它挡住的不是「白扫一遍」，而是「同一件事写了两份」。
    '%USERPROFILE%\\anaconda3\\python.exe',
    '%USERPROFILE%\\miniconda3\\python.exe',
    '%USERPROFILE%\\AppData\\Local\\Programs\\Python\\Python3*\\python.exe'
  ]
}

/** 这台机器上有哪些盘（C..Z）。A/B 跳过：没有软驱时空读卡器会卡住。 */
function existingDrives(): string[] {
  const out: string[] = []
  for (let c = 'C'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
    const d = String.fromCharCode(c)
    try {
      if (existsSync(`${d}:\\`)) out.push(d)
    } catch {
      // 空的读卡器插槽可能抛异常，忽略这一个盘
    }
  }
  return out
}

/**
 * 兜底扫描顺序 = 一键安装可能落的目录 → 手工装的目录。
 *
 * 一键安装那半边排前面：它是我们刚刚亲手装的、版本已知；
 * 手工装的目录里可能躺着用户很久以前装的旧编译器，不该抢在前面。
 *
 * 【`drives` 为什么可注入】默认是这台机器上真实存在的盘。注入**不是为了测试方便，
 * 是设计约束**：驱动器字面量（`C:\Program Files (x86)\Dev-Cpp\...`）在开发机上可能
 * 真的存在，于是「这台机器上没装 C 编译器」这个场景在开发机上**根本摆不出来**，
 * 跑出来的绿是假的（红线 16：陌生电脑上的行为必须能在测试里忠实复现）。
 * 另外，现算也让「应用启动后才插上的盘」当场生效 —— 缓存到模块顶层就没这好处。
 */
export function fallbackPathsFor(lang: LangOfCode, drives: string[] = existingDrives()): string[] {
  const manual: string[] = []
  for (const d of drives) manual.push(...perDrivePaths(d)[lang])
  manual.push(...userLevelPaths[lang])
  return [...TOOLCHAIN[lang].searchPaths, ...manual]
}

/** 每个语言：检测命令 + 取版本的参数（候选路径见 fallbackPathsFor） */
const SPEC: Record<LangOfCode, { cmds: string[]; versionArgs: string[] }> = {
  c: { cmds: ['gcc'], versionArgs: ['--version'] },
  cpp: { cmds: ['g++'], versionArgs: ['--version'] },
  java: { cmds: ['javac', 'java'], versionArgs: ['-version'] },
  python: { cmds: ['python', 'py'], versionArgs: ['--version'] }
}

// ---------------------------------------------------------------- 纯函数（可单测）

/** 展开 %ENV% 占位符（纯函数，process.env 注入） */
export function expandEnvVars(p: string, env: Record<string, string | undefined>): string {
  return p.replace(/%([^%]+)%/g, (_m, name: string) => env[name] ?? '')
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 展开路径通配符 * 到具体路径。
 * 逐段推进：通配段列出父目录并按通配匹配（支持段内 *，如 Python3* 匹配 Python312）；
 * 非通配段必须真实存在才保留该分支；最终结果只含存在的路径。
 */
export function expandGlob(pattern: string): string[] {
  // ⚠️ 不带 * 的路径**也必须过存在性检查**。
  // 旧写法直接 `return [pattern]`，于是兜底表里那几十条「这台机器上根本没有」的
  // 路径（C:\mingw64\bin\gcc.exe 之类）全成了合法候选，探针当然全失败，
  // 再被 chooseCompiler 的降级分支认成「找到了」——**假阳性的种子就是这一行**。
  // 改了这里，函数才算真的兑现注释里那句「最终结果只含存在的路径」。
  if (!pattern.includes('*')) return existsSync(pattern) ? [pattern] : []

  // 拆出盘符/根前缀（C:\ 或 \\），其余按 \ 或 / 分段
  const rootMatch = /^([A-Za-z]:[\\/]|[\\/]+)/.exec(pattern)
  const root = rootMatch ? rootMatch[1] : ''
  const segments = pattern.slice(root.length).split(/[\\/]+/).filter(Boolean)

  let currents = [root]
  for (const seg of segments) {
    if (!seg.includes('*')) {
      currents = currents.map((d) => join(d, seg)).filter((d) => existsSync(d))
      if (currents.length === 0) return []
      continue
    }
    const re = new RegExp('^' + seg.split('*').map(escapeRe).join('.*') + '$')
    const next: string[] = []
    for (const d of currents) {
      if (d !== '' && !existsSync(d)) continue
      let names: string[]
      try {
        names = readdirSync(d === '' ? '.' : d, { withFileTypes: true }).map((x) => x.name)
      } catch {
        continue
      }
      for (const name of names) {
        if (re.test(name)) next.push(join(d, name))
      }
    }
    next.sort()
    currents = next
    if (currents.length === 0) return []
  }
  return currents.filter(existsSync)
}

/** 取版本输出第一行（gcc "gcc (x86_64...) 14.2.0"、javac "javac 21.0.2"、python "Python 3.12.10"） */
export function parseVersionLine(out: string): string | undefined {
  const line = out.split(/\r?\n/).find((l) => l.trim() !== '')
  return line ? line.trim() : undefined
}

/**
 * 这一行**像不像一个版本号**。像才认，不像就当这次探测没成功。
 *
 * 【为什么必须有这一条（2026-09-17 修的真 bug）】
 * 旧代码把「命令起得来」直接当成「编译器能用」：`where` 命中就 `found: true`，
 * 版本探测的结果根本不参与判断。于是 Microsoft Store 那个 python 应用执行别名
 * （本机实测：**什么都不输出、退出码 49**）会被报成「Python 已找到」，
 * 用户界面上一片绿，一点运行就报错 —— 报错里还没有一个字提示「你找到的是空壳」。
 *
 * 两个条件缺一不可：
 *   ① 必须含 `数字.数字`。四门语言的版本号都长这样（3.12.10 / 21.0.12 / 14.2.0）；
 *   ② 不能是报错话术。"Python not found" 这种句子里可能恰好带着版本号。
 *
 * 【为什么这里一个中文都不写】
 * 一来四门编译器吐的都是英文（Java 那边我们在 planForLang 里用 `-J-Duser.language=en`
 * 把它钉死了），二来这个文件里出现中文串会被 copy.test.ts 那道闸门当成写死的界面文案。
 */
export function looksLikeVersion(line: string): boolean {
  if (!/\d+\.\d+/.test(line)) return false
  return !/not found|not recognized|no such file|cannot find|error/i.test(line)
}

/**
 * 是不是 Windows 的「应用执行别名」空壳。
 *
 * 这个目录下的 python.exe / python3.exe 是**别名**，不是解释器：只有用户真从
 * Microsoft Store 装过 Python，它才指向一个能用的解释器；没装过就是一个
 * 只会立刻退出的壳。所以它不该被当成「找到了」——它连版本号都答不出来。
 *
 * 【为什么不干脆整条路径拉黑】真从商店装过 Python 的人，别名是好用的。
 * 所以只是**降级到候选表末尾**：别的路子都找不到时才试它，让版本探测去裁决。
 */
export function isStoreAlias(p: string): boolean {
  return /[\\/]WindowsApps[\\/]/i.test(p)
}

// ---------------------------------------------------------------- 运行环境

/**
 * 跑一条命令并原样收字节（不解码），让调用方决定编码。
 *
 * 【这个函数必须「永不抛、永不 reject」】
 * 它是整条检测链唯一碰进程的地方，而检测的候选来自**别人电脑上的 PATH** ——
 * 里面什么都可能有。本机实测：0 字节的 `.exe` 会让 `execFile` **同步抛出 EFTYPE**
 * （不走回调），而这个异常会一路抛穿 detectLang → detectAll → IPC，
 * 症状是四门语言一起报「检测失败」。所以这里把异常也收成「这次没成功」。
 *
 * 【为什么导出】`runner/detect-ide.ts`（IDE 自动探测）要拿它跑 `reg query`，
 * 同样的「永不抛」契约在那里也是命根子 —— 与其复制一份，不如共用这一份。
 */
export function runCapture(
  exe: string,
  args: string[],
  opts: { timeoutMs: number; env?: NodeJS.ProcessEnv; maxBuffer?: number }
): Promise<{ ok: boolean; stdout: Buffer; stderr: Buffer }> {
  const fail = { ok: false, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
  return new Promise((resolve) => {
    try {
      execFile(
        exe,
        args,
        {
          timeout: opts.timeoutMs,
          windowsHide: true,
          encoding: 'buffer',
          // 不传就是 Node 的默认 1MB。**这条线踩过一次**：卸载项全树 dump 本机
          // 就 300KB（315 条），装了 Office / Adobe / 一堆 MSI 的机器轻松翻几倍，
          // 一旦超限 Node 会掐掉子进程并交回**被截断**的输出 ——
          // 表现是「静默少几条候选」，从界面上完全看不出来。所以这条要显式给。
          ...(opts.maxBuffer ? { maxBuffer: opts.maxBuffer } : {}),
          ...(opts.env ? { env: opts.env } : {})
        },
        (err, stdout, stderr) => {
          resolve({
            ok: !err,
            stdout: (stdout ?? Buffer.alloc(0)) as unknown as Buffer,
            stderr: (stderr ?? Buffer.alloc(0)) as unknown as Buffer
          })
        }
      )
    } catch {
      // 不是合法的可执行文件（EFTYPE）—— 当成「这个候选不能用」，继续试下一个
      resolve(fail)
    }
  })
}

/**
 * 读注册表里的 PATH —— **这是「重新检测」能真的生效的关键**。
 *
 * 【为什么非读不可】
 * 应用是在用户装 JDK **之前**启动的，它的 `process.env.PATH` 是启动那一刻的快照。
 * 用户装完 JDK，安装器把路径写进注册表，但**不会**、也不可能回到已经在跑的进程里
 * 去改它的环境块。所以只查 `where` 的话，「装完了 → 点重新检测 → 还是说没装」
 * 会一直循环下去，用户只能靠重启应用（甚至以为重启也没用，因为应用是常驻的）。
 *
 * 注册表是**当下**的事实，不受应用启动时间影响。所以检测时以它为准，
 * 与进程 PATH 合并（进程 PATH 在前，保持原有优先级；两边都有的不重复）。
 *
 * 失败一律静默降级：读不到注册表只是少一条线索，不该让整个检测崩掉。
 */
async function readRegistryPath(hive: 'HKLM' | 'HKCU'): Promise<string[]> {
  const key =
    hive === 'HKLM'
      ? 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
      : 'HKCU\\Environment'
  const r = await runCapture('reg', ['query', key, '/v', 'Path'], { timeoutMs: 5000 })
  if (!r.stdout.length && !r.stderr.length) return []
  return parseRegPathOutput(decodeConsole(r.stdout) + decodeConsole(r.stderr))
}

/**
 * 从 `reg query ... /v Path` 的输出里取出 PATH 的各段。
 *
 * 真实输出长这样（值那一列可能是 REG_SZ 也可能是 REG_EXPAND_SZ）：
 *
 *     HKEY_CURRENT_USER\Environment
 *         Path    REG_EXPAND_SZ    C:\Users\me\bin;%USERPROFILE%\scoop\shims
 *
 * 抽成纯函数是为了能单测 —— 尤其是**中文路径**那一条：
 * `reg` 在中文 Windows 上吐 GBK 字节，解错编码会得到一个乱码目录，
 * 而乱码目录的下场是「静默少一条 PATH」，从表面完全看不出来。
 */
export function parseRegPathOutput(text: string): string[] {
  const m = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(text)
  if (!m || !m[1]) return []
  return m[1]
    .trim()
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 合并出「现在这台机器真正的 PATH」：进程 PATH + 注册表（系统级 + 用户级）。
 * 纯加法：只往后补新条目，不改动、不删除进程已有的任何一条。
 */
export async function mergedPath(procEnv: NodeJS.ProcessEnv = process.env): Promise<string> {
  const procDirs = (procEnv.PATH ?? procEnv.Path ?? '').split(';').filter(Boolean)
  const regDirs = [...(await readRegistryPath('HKLM')), ...(await readRegistryPath('HKCU'))]

  const seen = new Set(procDirs.map((s) => s.toLowerCase().replace(/[\\/]+$/, '')))
  const extra: string[] = []
  for (const raw of regDirs) {
    // 注册表里存的是 %SystemRoot% 这种未展开形态，用当前进程的环境块展开它
    const p = expandEnvVars(raw, procEnv)
    if (!p) continue
    const k = p.toLowerCase().replace(/[\\/]+$/, '')
    if (seen.has(k)) continue
    seen.add(k)
    extra.push(p)
  }
  return [...procDirs, ...extra].join(';')
}

/** 把合并后的 PATH 装进一份可交给子进程的环境块 */
function withPath(path: string, procEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...procEnv, PATH: path }
}

/**
 * 原生模式（3.0）用的环境块：进程环境 + **合并后的 PATH**。
 *
 * 【为什么要有这么一个函数，而不是在 runner 里写 `{...process.env, PATH: mergedPath()}`】
 * 这是「起一个进程，让它认用户当下这台机器」的**唯一出口**。今天的调用方只有
 * 原生运行（`main/index.ts` 的 runner:run）；将来终端 / Git / 虚拟环境那几课
 * 要起用户命令时，也该从这里过 —— 那条路上再重新合一遍 PATH，就会出现
 * 「检测看得见 scoop 的垫片、运行看不见」这种谁也说不清的差异。
 *
 * 【它和 `withPath` 的关系】`withPath` 是把**已经算好的** PATH 装上去（检测器内部用），
 * 这里是「去把 PATH 算出来」的那一步。区分开是因为检测器要的是「别重复跑
 * 注册表查询」，而运行器要的是「给我一份能直接 spawn 的环境」。
 *
 * 【为什么非要删掉大小写不同的那个旧键】
 * Windows 的环境变量大小写不敏感，而 `{...process.env, PATH: x}` 产出的是个
 * **普通 JS 对象 —— 大小写敏感**，于是里面会同时住着 `Path`（旧的）和 `PATH`（新的）。
 * 实测（2026-09-28，两张表在 `runner.ts` 的 `mergeEnv` 上）：
 *   · 两个键撞车时，**全大写的那个赢**，cmd.exe 与 node 两种子进程结论一致；
 *   · 所以今天「合进去的 PATH 能生效」靠的是**我们恰好写的是大写** ——
 *     这是条隐性的依赖，不该留着。
 * 归一成单个键，就把「哪份 PATH 生效」从「拼写碰巧对了」变成**构造上一定对**；
 * 而且下游（`spawn` 时的 `mergeEnv`）还有第二道同样的归一，两边互为保险。
 */
export async function nativeEnv(procEnv: NodeJS.ProcessEnv = process.env): Promise<NodeJS.ProcessEnv> {
  const env = withPath(await mergedPath(procEnv), procEnv)
  for (const k of Object.keys(env)) {
    if (k !== 'PATH' && k.toLowerCase() === 'path') delete env[k]
  }
  return env
}

// ---------------------------------------------------------------- IDE 自带工具链（注册表）

/**
 * 【2026-09-28 任务一】朋友的电脑装了 Dev-C++，应用却说 C / C++ 没装。
 *
 * 病根是**候选表缺路径**（本机复现：Dev-C++ 5.11 在
 * `C:\Program Files (x86)\Dev-Cpp\MinGW64\`，旧表只写了非 x86 的那一份），
 * 补静态表能治好**这一台**。但下一台装的是 Code::Blocks 6.3、或者把 Dev-C++
 * 装在 D 盘 —— 再补一张表就是打地鼠。
 *
 * 所以补一条**数据驱动**的路：注册表的卸载项是「这台机器上装了什么」的权威清单，
 * 键名与安装位置无关。认名字 → 取安装根 → 在根下按形状找工具链 exe。
 *
 * ⚠️ 这里给出的**只是候选**。能不能用，仍然由 `tryVersion()` 真跑裁决 ——
 * 判定成功的路自始至终只有一条（见本文件头部第 ⑤ 条）。
 */

/**
 * 卸载项里认 IDE：**只看名字，不看它装在哪**。
 *
 * Dev-C++ 从 4.9 到 6.3、从 C 盘到 D 盘、从 MinGW32 到 MinGW64，装法五花八门；
 * 但注册表里的产品名来来回回就这几个。
 */
const IDE_NAME_PATTERNS = [
  'dev-c++',
  'dev-cpp',
  'devcpp',
  'bloodshed',
  'orwell', // Dev-C++ 5.x 之后接手的发行方
  'embarcadero',
  'codeblocks',
  'code::blocks',
  'wxdev',
  'tdm-gcc',
  'mingw',
  'winlibs',
  'android studio' // 自带一个能用的 JDK（jbr），装了它的人不该再被要求装一次 Java
]

/** 卸载项的搜索根。32 位程序（Dev-C++ / Code::Blocks 都是）统一落在 WOW6432Node 那半边。 */
const UNINSTALL_ROOTS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
]

/**
 * IDE 安装根目录下，工具链 bin 目录的常见形态（`*` 交给 expandGlob 展开）。
 *
 * ⚠️ `MinGW*` 与 `mingw*` **两条都要留**：expandGlob 的段内通配是**区分大小写**的
 * （`new RegExp('^'+seg.replace('*','.*')+'$')`，没带 i 标志），而现实中两种写法都有 ——
 * Dev-C++ 是 `MinGW64`，WinLibs 是 `mingw64`（都是本机实测）。
 * 「这两条看着重复，删一条吧」会把另一半机器静默漏掉，且测试里有一条专门钉住它。
 */
const IDE_BIN_SUBDIRS = [
  'bin',
  'MinGW*\\bin', // MinGW / MinGW32 / MinGW64（`*` 能匹配空串，所以 MinGW\bin 也覆盖）
  'mingw*\\bin', // 小写那种（WinLibs / msys2 / 绿色包解压出来的常见写法）
  'TDM-GCC*\\bin',
  'jbr\\bin', // Android Studio / JetBrains 自带 JDK
  'jdk*\\bin'
]

const EXE_NAME: Record<LangOfCode, string> = {
  c: 'gcc.exe',
  cpp: 'g++.exe',
  java: 'javac.exe',
  python: 'python.exe'
}

export interface UninstallEntry {
  key: string
  displayName?: string
  installLocation?: string
  uninstallString?: string
}

/**
 * 把 `reg query <卸载项根> /s` 的输出拆成一条条卸载项（纯函数，好单测）。
 *
 * 真实输出形状（2026-09-28 本机实测，逐字）：
 *
 *     HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Dev-C++
 *         DisplayName    REG_SZ    Dev-C++
 *         UninstallString    REG_SZ    C:\Program Files (x86)\Dev-Cpp\uninstall.exe
 *         DisplayVersion    REG_SZ    5.11
 *
 * （值名一列缩进 4 空格、列与列之间也是 4 空格。）
 *
 * ⚠️ 要能容忍两种形状，缺一种就会把该找的机器漏掉：
 * - 有的条目**没有 InstallLocation**（上面这条就没有，NSIS 装的），只有 UninstallString；
 * - 有的条目键名是 GUID（MSI 装的），产品名只在 DisplayName 里 —— 所以名字要一起看。
 */
export function parseUninstallEntries(text: string): UninstallEntry[] {
  const out: UninstallEntry[] = []
  let cur: UninstallEntry | undefined
  for (const raw of text.split(/\r?\n/)) {
    if (/^HKEY_/i.test(raw)) {
      cur = { key: raw.trim() }
      out.push(cur)
      continue
    }
    if (!cur) continue
    const m = /^\s{2,}(.+?)\s{2,}REG_[A-Z_]+\s{2,}(.*)$/.exec(raw)
    if (!m) continue
    const name = m[1].trim().toLowerCase()
    const val = m[2].trim()
    if (name === 'displayname') cur.displayName = val
    else if (name === 'installlocation') cur.installLocation = val
    else if (name === 'uninstallstring') cur.uninstallString = val
  }
  return out
}

/** 名字像不像我们关心的 IDE / 工具链（纯函数） */
export function looksLikeIde(name: string): boolean {
  const n = name.toLowerCase()
  return IDE_NAME_PATTERNS.some((p) => n.includes(p))
}

/**
 * 从一条卸载项里推出**安装根目录**（纯函数）。
 *
 * 两条路，缺一不可（2026-09-28 本机实测）：
 * - 有 `InstallLocation` 就用它（winget 装的 WinLibs 条目就有）；
 * - 没有就走 `UninstallString` 的**目录名** —— 本机 Dev-C++ 5.11 是这种：
 *   只有 `C:\Program Files (x86)\Dev-Cpp\uninstall.exe`，**没有 InstallLocation**。
 *   只读 InstallLocation 的实现会把这台机器整个漏掉。
 *
 * 推不出目录的一律 undefined。两类陷阱都在实测里见过：
 * - `MsiExec.exe /X{GUID}`：MsiExec 在 System32，跟着它走会去扫 System32；
 * - `winget uninstall --product-code X`：根本不是路径。
 * 与其硬取目录名扫错地方，不如不认这条 —— 静态表还兜着。
 */
export function installRootOf(e: UninstallEntry): string | undefined {
  const loc = (e.installLocation ?? '').trim().replace(/[\\/]+$/, '')
  if (loc && /[\\/]/.test(loc)) return loc

  const un = (e.uninstallString ?? '').trim()
  if (!un) return undefined
  // 带引号：`"C:\Program Files\X\unins000.exe" /SILENT` → 取引号里那段
  const quoted = /^"([^"]+)"/.exec(un)
  // 不带引号：**路径里可能带空格**（本机 Dev-C++ 就是 `Program Files (x86)`），
  // 所以不能按第一个空格切 —— 以 `.exe` 为界切。
  const exePath = quoted ? quoted[1] : /^(.+?\.exe)\b/i.exec(un)?.[1]
  if (!exePath || !/[\\/]/.test(exePath)) return undefined

  const base = exePath.split(/[\\/]/).pop()!.toLowerCase()
  if (base === 'msiexec.exe' || base === 'winget.exe') return undefined

  const dir = dirname(exePath).replace(/[\\/]+$/, '')
  return dir && /[\\/]/.test(dir) ? dir : undefined
}

/** 某个安装根目录下，这门语言的工具链 exe 的所有**存在**落点 */
export function ideCandidatesUnder(root: string, lang: LangOfCode): string[] {
  const out: string[] = []
  for (const sub of IDE_BIN_SUBDIRS) {
    out.push(...expandGlob(join(root, sub, EXE_NAME[lang])))
  }
  return dedupePaths(out)
}

/**
 * 从注册表卸载项里认出 IDE 自带的工具链，返回每门语言各自的候选 exe 全路径。
 *
 * 【失败一律静默】读不到注册表 / reg 超时 / 键不存在 / 输出解不出 —— 全部返回空表，
 * 只当少一条线索（与 `readRegistryPath` 同一策略）。这一段的失效**绝不允许**
 * 让整条检测崩掉：它只是补全，静态表还在。
 *
 * 【成本】三个根各一次 `reg query /s`（并发）。本机实测：全树约 315 条、300KB、
 * 串行 1.27s / 并发约 0.7s。注意 `detectAll()` 会被 e2e 测试在模块顶层调用，
 * 所以这个数会加到每次测试运行上 —— 真要提速也该优化 `reg` 调用数，不是砍覆盖面。
 *
 * 【maxBuffer 必须显式抬高】全树 dump 是可变的：本机 300KB，装了 Office / Adobe
 * 那种机器上大得多。Node 默认 1MB 一超就把输出**截断**（见 runCapture 里的注释），
 * 症状是静默少几条候选 —— 所以这里给 8MB。
 */
export async function ideToolchainCandidates(
  timeoutMs = 8000
): Promise<Record<LangOfCode, string[]>> {
  const blank = (): Record<LangOfCode, string[]> => ({ c: [], cpp: [], java: [], python: [] })
  let entries: UninstallEntry[]
  try {
    const dumps = await Promise.all(
      UNINSTALL_ROOTS.map((root) =>
        runCapture('reg', ['query', root, '/s'], { timeoutMs, maxBuffer: 8 * 1024 * 1024 })
      )
    )
    entries = dumps.flatMap((d) =>
      parseUninstallEntries(decodeConsole(d.stdout) + decodeConsole(d.stderr))
    )
  } catch {
    return blank()
  }

  const roots = dedupePaths(
    entries
      .filter((e) => looksLikeIde(e.displayName ?? '') || looksLikeIde(e.key))
      .map(installRootOf)
      .filter((r): r is string => !!r)
  )
  const out = blank()
  if (roots.length === 0) return out
  for (const lang of LANG_OF_CODE) {
    const list: string[] = []
    for (const root of roots) list.push(...ideCandidatesUnder(root, lang))
    out[lang] = dedupePaths(list)
  }
  return out
}

// ---------------------------------------------------------------- 检测流程

/** `where` 的**全部**命中行（旧代码只看第一行，见文件头根因②） */
async function whereAll(cmd: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const r = await runCapture('where', [cmd], { timeoutMs: 5000, env })
  if (!r.stdout.length) return []
  return decodeConsole(r.stdout)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

async function tryVersion(
  path: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<string | undefined> {
  const r = await runCapture(path, args, { timeoutMs: 8000, env })
  // ★ 必须真的成功退出。2026-09-17 实测：gcc / g++ / javac / python / py 的取版本命令
  // **全部 exit 0**；而 Microsoft Store 的空壳别名**exit 49、零输出**
  //（2026-09-28 复测仍是 49。旧注释写的 9009 是 cmd.exe 的「不是内部或外部命令」，
  // 两回事 —— 这里被调用的是真实存在的别名 exe，轮不到 cmd 来报 9009）。
  // 「退出码」是比「有没有输出」更早的一道闸 —— 旧代码不看 ok，理由是注释里那句
  // 「javac -version 退出码非 0」，那是**上一轮写下的假设、实测是错的**。
  if (!r.ok) return undefined
  // stdout 和 stderr 都读。2026-09-28 实测：`java -version` **恒走 stderr**（JDK 21 也一样，
  // 与版本新旧无关 —— 旧注释说的「老版本 JDK 才这样」也是没量过的假设）；
  // 其余（gcc / g++ / javac / python / py）走 stdout。两个流都读就不必维护
  // 一张会过期的「谁写哪个流」表：**版本行本身**才是判据。
  const line = parseVersionLine(decodeConsole(r.stdout) + decodeConsole(r.stderr))
  // 版本号必须**长得像版本号**：空壳别名、坏掉的 shim 都在这一步被挡掉
  return line && looksLikeVersion(line) ? line : undefined
}

/**
 * 检测一门语言。
 *
 * 候选分四段，按可信度从高到低，**第一段里第一个能报出版本号的就是答案**：
 *
 *   ① `where` 命中（真正的 PATH 解析，最可信）
 *   ② 注册表卸载项里认出的 IDE 自带工具链（"这台机器真装了这个 IDE"，比 ③ 可信）
 *   ③ 兜底路径表（一键安装目录 + 各盘 / 各发行版的手工安装落点）
 *   ④ WindowsApps 别名（最后才试：它可能只是空壳，见 isStoreAlias）
 *
 * 【判定「找到了」只有一条路：真跑 + 退出码 0 + 报得出像样版本号】
 *
 * 曾经有过一条「降级兜底」：三段都验不出来时，只要候选里有 `.exe` 就认它。
 * 它的本意是「别把报不出但确实能用的编译器一刀切掉」，**实际效果是假阳性**：
 * 2026-09-17 朋友的电脑上只装了 Java，界面却给 C / C++ / Python 全打上 ✓ ——
 * 因为兜底表里那几十条「这台机器上根本没有」的路径也被当成了候选，探针全失败，
 * 于是整批掉进降级分支，**没装的东西被判成了装好**。
 * 「没装说装了」比「装了说没装」坏得多：用户会信任那个 ✓，然后撞上「没有翻译官」。
 * 现在这条降级路径**已删除**，不再有任何「默认回退为成功」。
 */
/** 版本探针：给一个 exe 全路径，答得出像样的版本号就返回它，否则 undefined */
export type VersionProbe = (path: string) => Promise<string | undefined>

/** 候选去重（不区分大小写 —— Windows 路径本来就不区分） */
export function dedupePaths(xs: string[]): string[] {
  const seen = new Set<string>()
  return xs.filter((p) => {
    const k = p.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * 从一堆候选里挑出**真正能用**的那个编译器。
 *
 * 探针是注入的，所以「陌生电脑上会怎样」可以在单测里逐字复现：
 * 装 D 盘、装多版本、只有 Store 空壳、where 第一行是坏的……都不需要真的装一台电脑。
 *
 * 本函数只认一条规则：**逐个真跑，第一个报出版本号的就是它**。
 * （候选是怎么攒起来的见 `gatherCandidates` —— where → 注册表 IDE → 兜底表。）
 * 别名排到最后再试，是因为它可能是空壳，不是因为被拉黑。
 */
export async function chooseCompiler(paths: string[], probe: VersionProbe): Promise<LangEnv> {
  // 别名排到最后才试：它可能只是空壳（见 isStoreAlias），但**不是黑名单** ——
  // 真从 Microsoft Store 装的 Python 一样会走在最后这一段里报出版本号而胜出。
  const direct = dedupePaths(paths.filter((p) => !isStoreAlias(p)))
  const aliases = dedupePaths(paths.filter((p) => isStoreAlias(p)))

  for (const p of [...direct, ...aliases]) {
    const version = await probe(p)
    if (version) return { found: true, path: p, version }
  }

  // 一个都没验出来 = 没装。**没有降级、没有兜底、没有「默认回退为成功」。**
  // 这里的 `{ found: false }` 正是朋友那台机器上 C / C++ / Python 该有的答案。
  return { ...EMPTY }
}

/**
 * 检测时可注入的两个来源（都可省，省了就是「照这台机器的真实情况来」）。
 * 两个都在，才谈得上把「陌生电脑」在测试里忠实摆出来 —— 见各自字段的注释。
 */
export interface DetectOptions {
  /** 注册表里认出的 IDE 工具链，由 `ideToolchainCandidates()` 查一次、四门共用 */
  idePaths?: string[]
  /** 参与兜底扫描的盘符，默认这台机器上真实存在的盘 */
  drives?: string[]
}

/**
 * 把一门语言的所有候选路径收集起来（① where ② 注册表 IDE ③ 兜底表），
 * 交给 chooseCompiler 裁决。
 *
 * 【为什么 idePaths 在这里传进来而不是在这里查】注册表全树 dump 查一次就够，
 * 四门语言各查一次等于四倍开销（见 `ideToolchainCandidates` 的成本注释）。
 */
export async function gatherCandidates(
  lang: LangOfCode,
  env: Record<string, string | undefined>,
  runEnv: NodeJS.ProcessEnv,
  opts: DetectOptions = {}
): Promise<string[]> {
  const spec = SPEC[lang]
  const out: string[] = []
  for (const cmd of spec.cmds) out.push(...(await whereAll(cmd, runEnv)))
  // 注册表认出的 IDE 工具链排在兜底表**前面**：那些路径是「注册表说这儿真装着一个
  // IDE」，比我们按惯例猜的落点可信。但它仍然只是候选 —— 真值由 tryVersion 裁决。
  out.push(...(opts.idePaths ?? []))
  for (const pat of fallbackPathsFor(lang, opts.drives)) {
    for (const p of expandGlob(expandEnvVars(pat, env))) out.push(p)
  }
  return out
}

export async function detectLang(
  lang: LangOfCode,
  env: Record<string, string | undefined>,
  runEnv: NodeJS.ProcessEnv,
  opts: DetectOptions = {}
): Promise<LangEnv> {
  const paths = await gatherCandidates(lang, env, runEnv, opts)
  return chooseCompiler(paths, (p) => tryVersion(p, SPEC[lang].versionArgs, runEnv))
}

/** 全量检测四语言环境 */
export async function detectAll(
  env: Record<string, string | undefined> = process.env
): Promise<EnvReport> {
  // 合并注册表 PATH 只做一次，四门语言共用（顺带省掉三轮 reg query）
  const runEnv = withPath(await mergedPath(env))
  // 同理：卸载项全树 dump 也只做一次，四门语言从同一份结果里各取自己那几条
  const ide = await ideToolchainCandidates()
  const [c, cpp, java, python] = await Promise.all([
    detectLang('c', env, runEnv, { idePaths: ide.c }),
    detectLang('cpp', env, runEnv, { idePaths: ide.cpp }),
    detectLang('java', env, runEnv, { idePaths: ide.java }),
    detectLang('python', env, runEnv, { idePaths: ide.python })
  ])
  return { c, cpp, java, python }
}

/**
 * 拿一份**可以信**的环境报告：缓存里报「找到了」的照用，报「没找到」的当场复核。
 * 规则与理由（含 2026-09-13 那次「装好了也说没装」的完整经过）见 shared/env-cache.ts。
 *
 * 调用方拿到报告后，若 `rechecked` 非空，应把 `report` 写穿回缓存，免得下次再查一遍。
 *
 * @param only 只关心某一门语言时传它（跑代码只用到目标语言）
 */
export async function refreshLangs(
  cached: EnvReport | undefined,
  only?: LangOfCode,
  env: Record<string, string | undefined> = process.env
): Promise<{ report: EnvReport; rechecked: LangOfCode[] }> {
  const rechecked = langsToRecheck(cached, only)
  const report: EnvReport = cached ?? blankReport()
  if (rechecked.length === 0) return { report, rechecked }

  const runEnv = withPath(await mergedPath(env))
  // IDE 工具链也只在**确实要复核**的时候查（rechecked 非空的早退在上头）。
  // 跑代码那条路只复核一门语言，但注册表这一趟查的是全集，四门各取所需。
  const ide = await ideToolchainCandidates()
  const fresh = await Promise.all(
    rechecked.map((l) => detectLang(l, env, runEnv, { idePaths: ide[l] }))
  )
  const merged: EnvReport = { ...report }
  rechecked.forEach((l, i) => {
    merged[l] = fresh[i]
  })
  return { report: merged, rechecked }
}
