/**
 * M5-05：环境安装 —— 「装什么、装到哪、装完去哪找」的唯一真源。
 *
 * 【为什么先写这张表，再写安装代码】
 * 点一下「一键安装」意味着往用户电脑上下载几百 MB 的东西、改动他的机器。
 * 这条路一旦走错，用户看到的是「下载了 20 分钟，装完还是说没装」——
 * 比不装还气人，而且他没有任何线索自查。
 *
 * 所以顺序反过来：**先在纸面上把「装完会落在哪、我们能不能找到」定死**，
 * 再接按钮。这张表全是纯数据 + 纯函数，能在无 DOM 无进程的环境里跑单测，
 * 而真正的安装动作一行都还没有。
 *
 * 【为什么必须显式关心「装完之后去哪找」】
 * 本机 2026-09-13 真机实测，装完 gcc 和 Java 之后查 PATH 的结果：
 *
 *   | 语言 | 包类型        | 系统 PATH | 用户 PATH | `where` 找得到吗 |
 *   |------|---------------|-----------|-----------|------------------|
 *   | gcc  | portable(zip) | 没有      | 没有      | 找不到           |
 *   | Java | wix (MSI)     | 没有      | 没有      | 找不到           |
 *
 * **两个都没写 PATH** —— 包括我们原本以为「MSI 会自己写」的 Java。
 * 所以「装完就能用」对四门语言**一条都不成立**，
 * 唯一让程序认出编译器的东西，就是下面这张 `searchPaths` 表。
 *
 * 这条对我们尤其致命：应用是在安装**之前**启动的，它的 PATH 是启动那一刻的快照。
 * 就算某个包真写了 PATH，**已经在运行的应用也看不见**。
 * 想做到「装完无需重启应用即可用」，就只能靠我们自己主动去扫。
 * `searchPaths` 同时被 detect.ts 复用当兜底扫描表，两边共用一份数据，
 * 避免「安装脚本以为装在 A，检测脚本只找 B」。
 *
 * 本文件**不写面向用户的中文**（注释除外）：包的中文名、按钮文案在 copy.ts。
 */

import { LANG_OF_CODE, type EnvReport, type LangOfCode, type LangEnv } from './types'

/**
 * 我们自己指定的工具链落地目录（ASCII 路径）。
 *
 * 【为什么用 ASCII，不用「咪爱编程」】
 * 编译器、make、链接器这条链上有太多老工具对非 ASCII 路径处理得不好，
 * 中文路径踩坑是玄学级的：报错信息往往指向一个不存在的文件，查半天查到编码上。
 * 应用数据目录可以叫中文（那是我们自己读的），工具链目录不行（那是 gcc 读的）。
 *
 * 【为什么放 LOCALAPPDATA 而不是 Program Files】
 * Program Files 要管理员权限；这个目录用户自己就能删干净，
 * 与项目「不写注册表、卸载即删目录」的气质一致。
 */
export const TOOLCHAIN_ROOT = '%LOCALAPPDATA%\\MiAiBianCheng\\toolchain'

/** 一个 winget 安装包的规格 */
export interface ToolchainSpec {
  /** winget 包 id。每一个都在本机 `winget show` 实测确认存在（2026-09-13） */
  wingetId: string
  /**
   * 这个包能同时满足哪几门语言。
   *
   * WinLibs 一个包里同时有 gcc 和 g++ —— 装了 C 就等于装了 C++。
   * 界面必须知道这件事：否则用户会为同一件事装两遍，
   * 而第二次安装除了浪费时间没有任何效果（winget 直接报「已安装」）。
   */
  provides: readonly LangOfCode[]
  /** 一键安装时期望包落在哪（走 winget --location；失败则退回 winget 自管目录） */
  installDir: string
  /**
   * 装完之后去哪些路径找**可执行文件**（注意是 exe 全路径，不是目录），
   * **按可信度排序**：我们自己指定的目录排最前，winget 自管目录排后面。
   * 支持 `*` 通配与 `%ENV%` 占位，与 detect.ts 的 expandGlob / expandEnvVars 同一套语法。
   *
   * 为什么「我们要落的目录」和「winget 可能落的目录」都列上：
   * `--location` 不是所有清单都支持，不支持时 winget 会退回自己的目录。
   * 两条都列上，装完之后不管实际走了哪条路都能找得到。
   */
  searchPaths: readonly string[]
  /**
   * 是不是绿色版（portable zip）。
   *
   * 【注意别被它误导】这不是「谁需要兜底扫描」的开关 —— 见文件头实测表，
   * 四门语言里**一个都没进 PATH**，全都得靠 searchPaths。
   *
   * 它真正的用途是两个：
   *   ① 绿色版支持 `--location`（决定「装到哪」我们说了算），MSI 不保证支持；
   *   ② 卸载行为不同：绿色版删目录就干净了，MSI 会留注册表项。
   * 界面要说的话也不同 —— 绿色版是「解压到某处」，MSI 是「像正常软件那样安装」。
   */
  portable: boolean
}

/** winget 自管包目录的前缀（portable 包解压后都落在这下面） */
const WINGET_PKGS = '%LOCALAPPDATA%\\Microsoft\\WinGet\\Packages'

/**
 * winget 给 portable 包建快捷方式的目录。
 *
 * 【实测记录】2026-09-13 我们用 `--location` 装 gcc 时，winget 把别名建在了
 * 安装目录自己里面，**这个 Links 目录是空的**。
 * 但它仍然是真实会用到的一条路：用户**自己**在命令行敲 `winget install` 装
 * portable 包（不带 --location）时，winget 就会在这里建符号链接。
 * 主人从别处装过 gcc 再来用我们的应用 —— 那正是这条兜底存在的场合。
 *
 * 它**不在 PATH 里**（本机实测 32 段 PATH，没有它），所以不能坐等 `where gcc` 变好。
 */
const WINGET_LINKS = '%LOCALAPPDATA%\\Microsoft\\WinGet\\Links'

/**
 * 四门语言的安装规格。
 *
 * ⚠️ 改这张表之前先做两件事：
 *   ① `winget show <id>` 确认真实存在、且安装程序类型没变（换 format 会改落地路径）；
 *   ② 改完跑 `npm test` —— install-plan 的单测会校验包 id 形态与「共包」关系。
 */
export const TOOLCHAIN: Record<LangOfCode, ToolchainSpec> = {
  c: {
    wingetId: 'BrechtSanders.WinLibs.POSIX.UCRT',
    provides: ['c', 'cpp'],
    installDir: `${TOOLCHAIN_ROOT}\\winlibs`,
    portable: true,
    searchPaths: [
      `${TOOLCHAIN_ROOT}\\winlibs\\mingw64\\bin\\gcc.exe`,
      `${TOOLCHAIN_ROOT}\\winlibs\\*\\mingw64\\bin\\gcc.exe`,
      `${WINGET_LINKS}\\gcc.exe`,
      `${WINGET_PKGS}\\BrechtSanders.WinLibs.POSIX.UCRT*\\mingw64\\bin\\gcc.exe`,
      `${WINGET_PKGS}\\BrechtSanders.WinLibs.POSIX.UCRT*\\*\\mingw64\\bin\\gcc.exe`
    ]
  },
  cpp: {
    // 与 C 同一个包：WinLibs 里 gcc 和 g++ 是一起给的
    wingetId: 'BrechtSanders.WinLibs.POSIX.UCRT',
    provides: ['c', 'cpp'],
    installDir: `${TOOLCHAIN_ROOT}\\winlibs`,
    portable: true,
    searchPaths: [
      `${TOOLCHAIN_ROOT}\\winlibs\\mingw64\\bin\\g++.exe`,
      `${TOOLCHAIN_ROOT}\\winlibs\\*\\mingw64\\bin\\g++.exe`,
      `${WINGET_LINKS}\\g++.exe`,
      `${WINGET_PKGS}\\BrechtSanders.WinLibs.POSIX.UCRT*\\mingw64\\bin\\g++.exe`,
      `${WINGET_PKGS}\\BrechtSanders.WinLibs.POSIX.UCRT*\\*\\mingw64\\bin\\g++.exe`
    ]
  },
  java: {
    wingetId: 'EclipseAdoptium.Temurin.21.JDK',
    provides: ['java'],
    installDir: `${TOOLCHAIN_ROOT}\\temurin`,
    // 实测：这个 MSI 装完**没有**写系统 PATH、也没有写用户 PATH。
    // 下面第一条 C:\Program Files\... 就是它实际的落点（jdk-21.0.12.101-hotspot 命中）。
    // Temurin 的 MSI 其实支持 --location 写进 INSTALLDIR，但那样目录名是我们起的，
    // 反而不好用通配覆盖，所以干脆不传 --location，让它落到自己的标准位置。
    portable: false,
    searchPaths: [
      'C:\\Program Files\\Eclipse Adoptium\\jdk-21*\\bin\\javac.exe',
      'C:\\Program Files\\Eclipse Adoptium\\jdk-*\\bin\\javac.exe',
      `${TOOLCHAIN_ROOT}\\temurin\\jdk-21*\\bin\\javac.exe`,
      `${TOOLCHAIN_ROOT}\\temurin\\jdk-*\\bin\\javac.exe`
    ]
  },
  python: {
    wingetId: 'Python.Python.3.12',
    provides: ['python'],
    installDir: `${TOOLCHAIN_ROOT}\\python`,
    portable: false,
    searchPaths: [
      '%LOCALAPPDATA%\\Programs\\Python\\Python312\\python.exe',
      '%LOCALAPPDATA%\\Programs\\Python\\Python3*\\python.exe',
      `${TOOLCHAIN_ROOT}\\python\\python.exe`
    ]
  }
}

// ---------------------------------------------------------------- 状态判定

/**
 * 一门语言当前处于哪种状态。
 *
 * `manual` 与 `installable` 分开，是因为**这两种情况对用户说的话完全不同**：
 * 前者该给一份图文指引 + 一条能复制的命令，后者该给一个按钮。
 * 合成一种的话，不支持的机器上会出现一个点了没反应的按钮 ——
 * 那是最糟的一种界面：用户会怀疑是自己点错了。
 */
export type InstallState = 'ready' | 'installable' | 'manual'

export interface InstallPlan {
  lang: LangOfCode
  state: InstallState
  /** 这门语言对应的 winget 包 id（无论哪种状态都给出，手动命令里要用） */
  wingetId: string
  /**
   * 点「一键安装」时该装的包（已去重）。`ready` 或不能自动装时为空数组 ——
   * 界面据此决定「有没有可点的按钮」，而不是自己在模板里拼 if。
   */
  installTargets: readonly string[]
  /**
   * 装这个包**顺带还会修好**哪几门语言（不含自己）。
   * 用来在界面上说清「装完 C，C++ 也一起好了」——
   * 不说的话用户会以为 C++ 还需要单独装一次。
   */
  alsoFixes: readonly LangOfCode[]
  /** 装完之后必须补扫的路径（portable 包靠它才能被找到），见文件头 */
  searchPaths: readonly string[]
  /** 绿色版：不写 PATH，装完要靠我们自己找 */
  portable: boolean
}

/** 单门语言的安装计划 */
export function planFor(lang: LangOfCode, env: LangEnv, wingetAvailable: boolean): InstallPlan {
  const spec = TOOLCHAIN[lang]
  const ready = env.found
  const state: InstallState = ready ? 'ready' : wingetAvailable ? 'installable' : 'manual'

  return {
    lang,
    state,
    wingetId: spec.wingetId,
    installTargets: state === 'installable' ? [spec.wingetId] : [],
    alsoFixes: ready ? [] : spec.provides.filter((p) => p !== lang),
    searchPaths: spec.searchPaths,
    portable: spec.portable
  }
}

/** 四门语言各一份计划，顺序固定（界面按语言列表渲染，不能每次跑顺序都不同） */
export function planAll(env: EnvReport, wingetAvailable: boolean): InstallPlan[] {
  return LANG_OF_CODE.map((lang) => planFor(lang, env[lang], wingetAvailable))
}

/**
 * 「一次把缺的翻译官全装好」需要哪几个包 —— **按包去重，不是按语言**。
 *
 * 这是这个模块存在的最实在的理由：缺 C 和 C++ 时该返回 **1** 个包而不是 2 个。
 * 没这层去重，用户会看到安装队列里躺着两个一模一样的 MinGW，装完第一个后
 * 第二个直接报「已安装」—— 像出了 bug，其实是我们没想清楚。
 *
 * 返回空数组 = 没有可自动装的（要么都装好了，要么这台机器用不了 winget）。
 */
export function missingPackages(env: EnvReport, wingetAvailable: boolean): string[] {
  if (!wingetAvailable) return []
  const out: string[] = []
  for (const lang of LANG_OF_CODE) {
    if (env[lang].found) continue
    const id = TOOLCHAIN[lang].wingetId
    if (!out.includes(id)) out.push(id)
  }
  return out
}

/** 一个包服务于哪几门语言（界面提示「装这个会把 C 和 C++ 一起搞定」用） */
export function languagesOf(wingetId: string): LangOfCode[] {
  return LANG_OF_CODE.filter((lang) => TOOLCHAIN[lang].wingetId === wingetId)
}
