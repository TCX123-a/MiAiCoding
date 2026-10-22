/**
 * 「陌生电脑」模拟台。
 *
 * 【为什么单独一个文件】
 * 主人的朋友装了 Java + Python，软件的检测却找不到 Java、Python 一跑就报错、
 * 点「重新检测」还没反应。事后复盘发现，开发机上**永远测不出这类 bug** ——
 * 开发机的编译器早在 PATH 里了，兜底分支一次都不走；而朋友那台机器上，
 * 编译器不在 PATH、装在 D 盘、还夹着 Microsoft Store 的空壳别名。
 *
 * 所以这个文件把「朋友的电脑」拆成一条条可复现的断言：装 D 盘、装多版本、
 * 只有空壳、PATH 里躺着坏 exe、装完才写进注册表……逐条钉死。
 *
 * ── 两类测试，缺一不可 ───────────────────────────────────────────
 * ① **注入假探针**（大多数）：把「探测某路径能不能报出版本」换成一张查表，
 *    于是每种情形都能**精确**复现，且不依赖这台机器装了什么。
 * ② **真进程端到端**（最后两组）：真的 spawn 一个 exe、真的走 where、
 *    真的解析输出。假探针证明不了「真的跑起来也对」，这一组补上。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { execFile } from 'child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  chooseCompiler,
  decodeConsole,
  detectLang,
  expandEnvVars,
  expandGlob,
  fallbackPathsFor,
  gatherCandidates,
  ideCandidatesUnder,
  ideToolchainCandidates,
  installRootOf,
  isStoreAlias,
  looksLikeIde,
  looksLikeVersion,
  mergedPath,
  parseRegPathOutput,
  parseUninstallEntries,
  refreshLangs,
  type VersionProbe
} from '../detect'
import { blankReport } from '../../../shared/env-cache'
import { LANG_OF_CODE } from '../../../shared/types'

const tmpRoots: string[] = []

function makeTmp(prefix = 'miai-foreign-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpRoots.push(dir)
  return dir
}

afterAll(() => {
  for (const d of tmpRoots.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // 清理失败不影响测试结论
    }
  }
})

/** 本机实测的 Store 应用执行别名路径（`where python` 的第二行就是它） */
const STORE_ALIAS = 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe'

// ═══════════════════════════════════════════════════════════════
// 1. 「命令起得来」≠「编译器能用」
// ═══════════════════════════════════════════════════════════════

describe('looksLikeVersion：只有真的报出版本号才算找到', () => {
  it('四门编译器真实的版本行都认得', () => {
    expect(looksLikeVersion('gcc (x86_64-posix-seh-rev0, Built by MinGW) 14.2.0')).toBe(true)
    expect(looksLikeVersion('javac 21.0.2')).toBe(true)
    expect(looksLikeVersion('Python 3.12.10')).toBe(true)
    expect(looksLikeVersion('curl 8.21.0 (Windows) libcurl/8.21.0')).toBe(true)
  })

  it('Store 空壳的话术不算版本（这正是「显示已找到、一跑就报错」的来源）', () => {
    // 本机实测那个别名退出码 49、什么都不输出；这是它「劝你去装」时才会说的话术
    expect(
      looksLikeVersion(
        'Python was not found; run without arguments to install from the Microsoft Store, or disable this shortcut from Settings > Manage App Execution Aliases.'
      )
    ).toBe(false)
  })

  it('报错话术里就算夹着版本号也不认', () => {
    expect(looksLikeVersion('error: could not find javac 1.8.0')).toBe(false)
    expect(looksLikeVersion("'gcc' is not recognized as an internal or external command")).toBe(false)
    expect(looksLikeVersion('no such file or directory: python 3.11')).toBe(false)
  })

  it('压根没有 数字.数字 的行不认', () => {
    expect(looksLikeVersion('javac')).toBe(false)
    expect(looksLikeVersion('Usage: gcc [options] file...')).toBe(false)
    expect(looksLikeVersion('')).toBe(false)
  })
})

describe('isStoreAlias：认出 WindowsApps 空壳', () => {
  it('本机实测的别名路径认得出来', () => {
    expect(isStoreAlias(STORE_ALIAS)).toBe(true)
  })

  it('正斜杠写法也认（Node 里两种写法都会出现）', () => {
    expect(isStoreAlias('C:/Users/me/AppData/Local/Microsoft/WindowsApps/python.exe')).toBe(true)
  })

  it('正常安装位置不会被误判', () => {
    expect(isStoreAlias('C:\\Python312\\python.exe')).toBe(false)
    expect(isStoreAlias('D:\\Java\\jdk-17\\bin\\javac.exe')).toBe(false)
    expect(isStoreAlias('C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.2\\bin\\javac.exe')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════
// 2. 控制台编码：中文 Windows 的 GBK
// ═══════════════════════════════════════════════════════════════

describe('decodeConsole：别把中文路径解成乱码', () => {
  it('UTF-8 输出原样返回', () => {
    const buf = Buffer.from('D:\\Python312\\python.exe', 'utf8')
    expect(decodeConsole(buf)).toBe('D:\\Python312\\python.exe')
  })

  it('UTF-8 的中文不会被误当 GBK 解坏', () => {
    const s = 'D:\\编程工具\\Python\\python.exe'
    expect(decodeConsole(Buffer.from(s, 'utf8'))).toBe(s)
  })

  it('真 GBK 字节解得回来（本机实测：where 找不到文件时的中文提示）', () => {
    // 这串字节是 2026-09-17 从本机 `where javac`（PATH 里没有 javac）的 stderr 原样抓的
    const bytes = [
      208, 197, 207, 162, 58, 32, 211, 195, 204, 225, 185, 169, 181, 196, 196, 163, 202, 189, 206,
      222, 183, 168, 213, 210, 181, 189, 206, 196, 188, 254, 161, 163, 13, 10
    ]
    expect(decodeConsole(Buffer.from(bytes))).toBe('信息: 用提供的模式无法找到文件。\r\n')
  })

  it('GBK 的中文路径解得回来（解错就是「静默少一条 PATH」）', () => {
    // '编程工具' 的 GBK 字节，用 `printf '编程工具' | iconv -f UTF-8 -t GBK` 实测得到
    const gbk = Buffer.from([0xb1, 0xe0, 0xb3, 0xcc, 0xb9, 0xa4, 0xbe, 0xdf])
    expect(decodeConsole(gbk)).toBe('编程工具')
    expect(decodeConsole(Buffer.concat([Buffer.from('D:\\', 'utf8'), gbk, Buffer.from('\\python.exe', 'utf8')]))).toBe(
      'D:\\编程工具\\python.exe'
    )
  })
})

// ═══════════════════════════════════════════════════════════════
// 3. 注册表 PATH 的解析
// ═══════════════════════════════════════════════════════════════

describe('parseRegPathOutput：解析 reg query 的输出', () => {
  it('系统级（REG_EXPAND_SZ）', () => {
    const out = [
      'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
      '    Path    REG_EXPAND_SZ    %SystemRoot%\\system32;%SystemRoot%;D:\\Java\\jdk-17\\bin'
    ].join('\r\n')
    expect(parseRegPathOutput(out)).toEqual([
      '%SystemRoot%\\system32',
      '%SystemRoot%',
      'D:\\Java\\jdk-17\\bin'
    ])
  })

  it('用户级（REG_SZ）', () => {
    const out = ['HKEY_CURRENT_USER\\Environment', '    Path    REG_SZ    D:\\Python312;D:\\Python312\\Scripts'].join(
      '\r\n'
    )
    expect(parseRegPathOutput(out)).toEqual(['D:\\Python312', 'D:\\Python312\\Scripts'])
  })

  it('多余的 ; 与空格被清掉（安装器留下的尾巴很常见）', () => {
    const out = '    Path    REG_SZ    C:\\a ;; C:\\b ;\r\n'
    expect(parseRegPathOutput(out)).toEqual(['C:\\a', 'C:\\b'])
  })

  it('输出里没有 Path 行时返回空数组，不抛异常', () => {
    expect(parseRegPathOutput('错误: 系统找不到指定的注册表项或值。')).toEqual([])
    expect(parseRegPathOutput('')).toEqual([])
  })
})

// 60s 预算：这组每条都真起 reg.exe 子进程。静机实测 2.2s（≈5s 默认预算的 44%），
// 全量并发下进程创建被拖到倍级 ⇒ 默认 5s 顶穿（2026-10-11 全量实测 5007ms 假红）。
// 同 precedent = 本文件「真进程端到端」两组；断言一字未动。
describe('mergedPath：注册表里的 PATH 真的会被并进来（「重新检测」能生效的前提）', { timeout: 60_000 }, () => {
  // 应用是在用户装 JDK **之前**启动的，它的 process.env.PATH 是启动那一刻的快照。
  // 装完 JDK 写进注册表，也回不到已经在跑的进程里 —— 只查 where 的话，
  // 「装完了 → 点重新检测 → 还是说没装」会一直循环。这一组钉的就是这个。

  it('进程原有的 PATH 排在最前面（不改变原有优先级）', async () => {
    const merged = await mergedPath({ ...process.env, PATH: 'C:\\only-in-process' })
    expect(merged.split(';')[0]).toBe('C:\\only-in-process')
  })

  it('注册表里有、进程 PATH 里没有的目录会补进来', async () => {
    // 只给一条假 PATH，注册表那半边就成了唯一来源；任何 Windows 的注册表 PATH 都含 System32
    const merged = await mergedPath({ ...process.env, PATH: 'C:\\only-in-process' })
    expect(merged.toLowerCase()).toContain('system32')
  })

  it('两边都有的目录不会重复出现', async () => {
    const sysRoot = process.env.SystemRoot ?? 'C:\\Windows'
    const already = `${sysRoot}\\System32`
    const merged = await mergedPath({ ...process.env, PATH: already })
    const dirs = merged.split(';').map((s) => s.toLowerCase().replace(/[\\/]+$/, ''))
    expect(dirs.filter((d) => d === already.toLowerCase()).length).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════
// 4. 候选裁决 —— 「朋友的电脑」逐个情形（注入假探针）
// ═══════════════════════════════════════════════════════════════

/**
 * 造一个假探针：只有 `answers` 里列出来的路径答得出「版本」，其余一律答不出。
 * 答不出的那些对应的就是**空壳 / 坏文件 / 版本对不上**的候选。
 */
function probeOf(answers: Record<string, string>): { probe: VersionProbe; asked: string[] } {
  const asked: string[] = []
  const probe: VersionProbe = async (p) => {
    asked.push(p)
    return answers[p.toLowerCase()]
  }
  return { probe, asked }
}

describe('chooseCompiler：编译器装在哪都能找到', () => {
  const JDK17 = 'D:\\Java\\jdk-17\\bin\\javac.exe'
  const JDK8 = 'D:\\Java\\jdk-8\\bin\\javac.exe'

  it('① 装在 D 盘（非默认盘、不在 PATH 里）照样找得到', async () => {
    const { probe } = probeOf({ [JDK17.toLowerCase()]: 'javac 17.0.9' })
    expect(await chooseCompiler([JDK17], probe)).toEqual({
      found: true,
      path: JDK17,
      version: 'javac 17.0.9'
    })
  })

  it('② where 第一行是 Store 空壳、第二行才是真的 → 选真的那个', async () => {
    const alias = 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\javac.exe'
    const { probe, asked } = probeOf({ [JDK17.toLowerCase()]: 'javac 17.0.9' })
    const got = await chooseCompiler([alias, JDK17], probe)
    expect(got.path).toBe(JDK17)
    // 空壳被**降级到最后**而不是删掉：真从商店装过的人，别名是好用的
    expect(asked).toEqual([JDK17])
  })

  it('③ 只有 Store 空壳（Python 其实没装）→ 老实说没找到', async () => {
    // ⚠️ 这一条就是主人朋友遇到的那个 bug 的回归测试。
    // 旧代码见 where 命中就 `found: true`，界面一片绿、一运行就报错，
    // 报错里还没有一个字提示「你找到的是个空壳」。
    const { probe } = probeOf({})
    expect(await chooseCompiler([STORE_ALIAS], probe)).toEqual({ found: false })
  })

  it('④ 装了多个版本，排在前面的那个是坏的 → 顺位选到能用的', async () => {
    const { probe } = probeOf({ [JDK17.toLowerCase()]: 'javac 17.0.9' })
    expect((await chooseCompiler([JDK8, JDK17], probe)).path).toBe(JDK17)
  })

  it('⑤ 大小写不同的同一条路径只探一次', async () => {
    const { probe, asked } = probeOf({ [JDK17.toLowerCase()]: 'javac 17.0.9' })
    await chooseCompiler([JDK17, 'd:\\JAVA\\JDK-17\\BIN\\JAVAC.EXE'], probe)
    expect(asked).toEqual([JDK17])
  })

  it('⑥ 候选全都不行、且路径不以 .exe 结尾 → 没找到', async () => {
    const { probe } = probeOf({})
    expect(await chooseCompiler(['C:\\some\\dir', 'D:\\another'], probe)).toEqual({ found: false })
  })

  it('⑦ 空数组 → 没找到（不是崩）', async () => {
    const { probe } = probeOf({})
    expect(await chooseCompiler([], probe)).toEqual({ found: false })
  })

  it('⑧ 报不出像样版本 → 老实说没找到（★ 这条以前是反的，正是假阳性的源头）', async () => {
    // 【这条测试曾经写反过，务必别再改回去】
    // 旧版本这里断言的是「沿用一个『说不出版本号但其实能用』的老编译器」，
    // 动机是「别把原本能用的人变成不能用」。**实际效果是假阳性**：
    // 2026-09-17 只装了 Java 的那台电脑上，C / C++ / Python 全被打上 ✓，
    // 因为它们的候选里塞满了兜底表的幻影路径，探针全失败后就被这条宽松规则收下了。
    // 「没装说装了」比「装了说没装」坏得多 —— 用户会信那个 ✓，然后撞上「没有翻译官」。
    // 判定成功只有一条路：真跑 + 退出码 0 + 报得出像样版本号。
    const quiet = 'C:\\msys64\\mingw64\\bin\\gcc.exe'
    const { probe } = probeOf({})
    expect(await chooseCompiler([quiet], probe)).toEqual({ found: false })
  })

  it('⑨ 全是空壳 / 报不出版本 → 没找到，一个都不认', async () => {
    const { probe } = probeOf({})
    expect(await chooseCompiler([STORE_ALIAS, 'D:\\MinGW\\bin\\gcc.exe'], probe)).toEqual({
      found: false
    })
  })
})

// ═══════════════════════════════════════════════════════════════
// 4.5 假阳性：不存在的路径绝不能变成候选（2026-09-17 二次事故）
// ═══════════════════════════════════════════════════════════════

describe('expandGlob：不存在的东西不能装成候选', () => {
  it('不带 * 且不存在 → 空数组（★ 旧写法原样返回它，假阳性就是从这来的）', () => {
    // 旧实现第一行是 `if (!pattern.includes('*')) return [pattern]` ——
    // 不查存在性。而兜底表里绝大多数条目都**不带 ***，于是 C:\mingw64\bin\gcc.exe
    // 这种「这台机器上根本没有」的路径全成了合法候选。
    expect(expandGlob('C:\\definitely\\not\\here\\gcc.exe')).toEqual([])
    expect(expandGlob('D:\\mingw64\\bin\\gcc.exe')).toEqual([])
  })

  it('不带 * 但真实存在 → 原样返回（别把孩子和洗澡水一起倒了）', () => {
    expect(expandGlob(FAKE_EXE_SRC)).toEqual([FAKE_EXE_SRC])
  })

  it('带 * 且一个都不匹配 → 空数组', () => {
    expect(expandGlob('C:\\no-such-dir-xyzzy\\Python3*\\python.exe')).toEqual([])
  })

  it('★ 兜底表展开出来的每一条候选都真实存在（存在性是硬保证，不是巧合）', () => {
    let 总数 = 0
    for (const lang of LANG_OF_CODE) {
      for (const pat of fallbackPathsFor(lang)) {
        for (const p of expandGlob(expandEnvVars(pat, process.env))) {
          总数++
          expect(existsSync(p), `${lang} 的候选「${p}」根本不存在，却会被当成编译器`).toBe(true)
        }
      }
    }
    // 顺带钉住「这台机器上确实还能找到东西」——否则循环体没跑，断言全空转
    expect(总数, '兜底表一条都展开不出来，这条测试等于没测').toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════
// 5. 兜底路径表的结构保证（装在 D 盘 / 各家发行版）
// ═══════════════════════════════════════════════════════════════

/** 这台机器上有哪些盘（与 detect.ts 里的枚举独立算一遍，当交叉验证） */
const drives: string[] = (() => {
  const out: string[] = []
  for (let c = 'C'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
    const d = String.fromCharCode(c)
    try {
      if (existsSync(`${d}:\\`)) out.push(d)
    } catch {
      // 空读卡器插槽会抛，忽略
    }
  }
  return out
})()

describe('兜底表按盘符生成：装在 D 盘的人不该被漏掉', () => {
  it('这台机器上的每个盘，都有对应的编译器落点', () => {
    for (const d of drives) {
      expect(fallbackPathsFor('java'), `${d} 盘没有 Java 落点`).toContain(
        `${d}:\\Java\\jdk*\\bin\\javac.exe`
      )
      expect(fallbackPathsFor('java'), `${d} 盘没有 Java 落点`).toContain(
        `${d}:\\Program Files\\Java\\jdk*\\bin\\javac.exe`
      )
      expect(fallbackPathsFor('python'), `${d} 盘没有 Python 落点`).toContain(
        `${d}:\\Python*\\python.exe`
      )
      expect(fallbackPathsFor('c'), `${d} 盘没有 C 编译器落点`).toContain(
        `${d}:\\mingw64\\bin\\gcc.exe`
      )
    }
  })

  it('表里指向的每个盘都真实存在（没有凭空造盘符）', () => {
    const known = drives.map((d) => d.toLowerCase())
    for (const lang of LANG_OF_CODE) {
      for (const p of fallbackPathsFor(lang)) {
        const m = /^([A-Za-z]):\\/.exec(p)
        if (!m) continue // %USERPROFILE% 那种留给下一条测
        expect(known, `${lang} 的 ${p} 指向一个不存在的盘`).toContain(m[1].toLowerCase())
      }
    }
  })

  it('各家 JDK 发行版都在表里（不只认 Oracle 的 Program Files\\Java）', () => {
    // 国内的机器上 Adoptium / Corretto / Zulu 极常见；用 IDEA 的人会把 JDK 放在 .jdks
    const java = fallbackPathsFor('java').join('\n').toLowerCase()
    for (const vendor of [
      'eclipse adoptium',
      'amazon corretto',
      'zulu',
      'bellsoft',
      '.jdks',
      'android studio',
      'scoop'
    ]) {
      expect(java, `Java 兜底表里没有 ${vendor} 的落点`).toContain(vendor)
    }
  })

  it('Python 的常见装法都在表里', () => {
    const py = fallbackPathsFor('python').join('\n').toLowerCase()
    for (const hint of ['anaconda3', 'miniconda3', 'python3*', 'scoop']) {
      expect(py, `Python 兜底表里没有 ${hint} 的落点`).toContain(hint)
    }
  })

  it('%USERPROFILE% 占位符会被真实展开（不是死字符串）', () => {
    expect(fallbackPathsFor('java').some((p) => p.includes('%USERPROFILE%'))).toBe(true)

    const tmp = makeTmp()
    mkdirSync(join(tmp, 'scoop', 'shims'), { recursive: true })
    writeFileSync(join(tmp, 'scoop', 'shims', 'javac.exe'), '')
    const got = expandGlob(
      expandEnvVars('%USERPROFILE%\\scoop\\shims\\javac.exe', { USERPROFILE: tmp })
    )
    expect(got).toEqual([join(tmp, 'scoop', 'shims', 'javac.exe')])
  })

  it('★ Dev-C++ 的落点：两代工具链 × 两种 Program Files × 盘根都要有（2026-09-28 任务一）', () => {
    // 旧表只有 `Program Files\Dev-Cpp\MinGW64` 一条（**非 x86**），本机实测的
    // `C:\Program Files (x86)\Dev-Cpp\MinGW64` 一条都没有 —— 这就是朋友那台的病根
    for (const d of drives) {
      for (const p of [
        `${d}:\\Program Files (x86)\\Dev-Cpp\\MinGW64\\bin\\gcc.exe`,
        `${d}:\\Program Files (x86)\\Dev-Cpp\\MinGW32\\bin\\gcc.exe`,
        `${d}:\\Program Files\\Dev-Cpp\\MinGW64\\bin\\gcc.exe`,
        `${d}:\\Program Files\\Dev-Cpp\\MinGW32\\bin\\gcc.exe`,
        `${d}:\\Dev-Cpp\\MinGW64\\bin\\gcc.exe`,
        `${d}:\\TDM-GCC-32\\bin\\gcc.exe`
      ]) {
        expect(fallbackPathsFor('c'), `${d} 盘缺 ${p}`).toContain(p)
      }
    }
    // 环境变量形式的那一份也要有：Program Files 被挪过窝的机器只有它指得对，
    // 而「假环境端到端」那组测试也全靠它（详见 userLevelPaths 的注释）
    expect(fallbackPathsFor('c').some((p) => p.includes('%ProgramFiles(x86)%'))).toBe(true)
  })

  it('★ C 表补了 gcc，C++ 表必须同步补 g++（改一边忘另一边 = 「C 找得到、C++ 找不到」）', () => {
    const cpp = fallbackPathsFor('cpp')
    for (const p of fallbackPathsFor('c')) {
      if (!/dev-cpp|codeblocks|tdm-gcc/i.test(p)) continue // 只验本次补的 IDE 那批
      expect(cpp, `C 表有 ${p}，C++ 表没有对应的 g++.exe`).toContain(
        p.replace(/gcc\.exe$/i, 'g++.exe')
      )
    }
  })
})

// ═══════════════════════════════════════════════════════════════
// 6. 真进程端到端 —— 假探针证明不了「真的跑起来也对」
// ═══════════════════════════════════════════════════════════════

/** 一个又小又自带、`--version` 能报出版本号的真 exe，拿来假扮编译器（curl.exe，818KB） */
const FAKE_EXE_SRC = 'C:\\Windows\\System32\\curl.exe'

/** 用真 `where` 查一次，返回全部命中行（用来在测试里证明前提成立） */
function runWhere(cmd: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      'where',
      [cmd],
      { timeout: 8000, windowsHide: true, encoding: 'buffer', env },
      (_err, stdout) => {
        const buf = (stdout ?? Buffer.alloc(0)) as unknown as Buffer
        resolve(buf.length ? decodeConsole(buf).split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [])
      }
    )
  })
}

// 【为什么整组要 30s 超时】这一组真起进程（where.exe + 真 gcc/curl 探针），
// 在 160 文件的全量并发（转换期 CPU 打满）下，进程创建会被 Defender 实扫拖到
// 秒级 —— 默认 5s 曾在满负载下顶穿（单跑/小组合跑全绿，已用「撤掉新增测试文件
// 再跑全量」证明与任何新增无关，纯负载余量）。放宽的只是进程启动预算，
// 断言一字未动；同 precedent = detect.test.ts 的 30s。
// 60s（原 30s）：2026-10-11 凌晨全量实测本组最重一条 27677ms（30s 预算剩 8%），
// 机器负载来源=26 个满核 python 孤儿进程。同批处置详见 vitest.config.ts 的 testTimeout 注释。
describe('真进程端到端：朋友的电脑', { timeout: 60_000 }, () => {
  it('前提成立：本机有 curl.exe 可以假扮编译器', () => {
    expect(existsSync(FAKE_EXE_SRC), `本机没有 ${FAKE_EXE_SRC}，这一组测试没法模拟`).toBe(true)
  })

  it('编译器在 PATH 里（装在非默认位置）→ where 找得到，版本也报得出来', async () => {
    const tmp = makeTmp()
    const fakeBin = join(tmp, 'D-Java', 'jdk-17', 'bin')
    mkdirSync(fakeBin, { recursive: true })
    copyFileSync(FAKE_EXE_SRC, join(fakeBin, 'gcc.exe'))

    const runEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${fakeBin};C:\\Windows\\System32`
    }
    const got = await detectLang('c', process.env, runEnv)

    expect(got.found).toBe(true)
    expect(got.path, '没有选中放在非默认位置的那个').toBe(join(fakeBin, 'gcc.exe'))
    expect(got.version && looksLikeVersion(got.version), `版本行不像版本号：${got.version}`).toBe(
      true
    )
  })

  it('编译器完全不在 PATH 里 → 兜底表把它找出来（= 朋友的场景）', async () => {
    const cleanEnv: NodeJS.ProcessEnv = { ...process.env, PATH: 'C:\\Windows\\System32' }

    // 先把「前提真的成立」证明出来：这条 PATH 下 where 确实找不到 gcc。
    // 没有这一步，下一条断言可能只是碰巧因为 PATH 里本来就有 gcc 才绿的。
    const viaWhere = await runWhere('gcc', cleanEnv)
    expect(viaWhere, `前提不成立：这条 PATH 下 where 竟然找到了 ${viaWhere.join(', ')}`).toEqual([])

    const got = await detectLang('c', process.env, cleanEnv)
    expect(got.found, 'PATH 里没有 gcc，兜底表也没找到').toBe(true)
    expect(got.version, `找到了 ${got.path} 但报不出版本号`).toBeTruthy()
  })

  it('PATH 里躺着一个 0 字节的 gcc.exe → 跳过它，不炸掉整个检测', async () => {
    // ⚠️ 这一条是本机实测出来的：Node 对「名字是 .exe 但内容不是可执行文件」的候选，
    // execFile 会**同步抛出** EFTYPE（不走回调）。旧写法会让整个 promise reject，
    // 异常抛穿 detectLang → detectAll → IPC，四门语言一起报「检测失败」。
    const tmp = makeTmp()
    const stubDir = join(tmp, 'stub')
    const fakeBin = join(tmp, 'D-Java', 'jdk-17', 'bin')
    mkdirSync(stubDir, { recursive: true })
    mkdirSync(fakeBin, { recursive: true })
    writeFileSync(join(stubDir, 'gcc.exe'), '') // 0 字节：下载中断、装到一半取消都会留下
    copyFileSync(FAKE_EXE_SRC, join(fakeBin, 'gcc.exe'))

    const runEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${stubDir};${fakeBin};C:\\Windows\\System32`
    }
    // 前提：where 确实把那个 0 字节的也算作命中，而且排在真的前面
    const viaWhere = await runWhere('gcc', runEnv)
    expect(viaWhere[0], '前提不成立：where 没把 0 字节的那个排在前面').toBe(
      join(stubDir, 'gcc.exe')
    )

    const got = await detectLang('c', process.env, runEnv)
    expect(got.found).toBe(true)
    expect(got.path, '没有跳过那个坏掉的候选').toBe(join(fakeBin, 'gcc.exe'))
  })

  it('「重新检测」真的会重扫：缓存说没找到 → 重检后找到新装的编译器', async () => {
    // 这是主人那句「点重新检测完全没用」的回归测试：
    // 缓存里记着「没找到」，重检必须真的去查一遍并刷新结果，而不是原样返回。
    const tmp = makeTmp()
    const fakeBin = join(tmp, 'D-Java', 'jdk-17', 'bin')
    mkdirSync(fakeBin, { recursive: true })
    copyFileSync(FAKE_EXE_SRC, join(fakeBin, 'gcc.exe'))

    const env: Record<string, string | undefined> = {
      ...process.env,
      PATH: `${fakeBin};${process.env.PATH ?? ''}`
    }
    const { report, rechecked } = await refreshLangs(blankReport(), 'c', env)

    expect(rechecked).toEqual(['c'])
    expect(report.c.found).toBe(true)
    expect(report.c.path).toBe(join(fakeBin, 'gcc.exe'))
  })

  it('缓存说「找到了」时一次都不重扫（不白花时间）', async () => {
    const cached = blankReport()
    cached.c = { found: true, path: 'C:/fake/gcc.exe', version: '1.0' }
    const { rechecked, report } = await refreshLangs(cached, 'c')
    expect(rechecked).toEqual([])
    expect(report.c).toEqual(cached.c)
  })

  it('★★ 只装了 Java 的电脑：C / C++ / Python 必须老实说没找到（假阳性回归）', async () => {
    // 2026-09-17 二次事故的现场复刻：朋友的电脑上**只装了 Java**，
    // 界面却给 C / C++ / Python 全打上 ✓，只有 Java 报了真版本号。
    // 他信了那个 ✓，一写 C 就「没有翻译官」。
    //
    // 模拟手法：把 LOCALAPPDATA / USERPROFILE / ProgramData / ProgramFiles 全指到
    // 一个**空目录**，兜底表里靠环境变量定位的落点就一个都命中不了；
    // PATH 里只留真的 javac 所在目录 —— 这就是「只有 Java」。
    // 用真的 javac 而不是假 exe：curl 答不了 `-version`，Java 那一半会假红。
    const tmp = makeTmp()
    const empty = join(tmp, 'empty-home')
    mkdirSync(empty, { recursive: true })

    const javacLine = (await runWhere('javac', process.env))[0]
    expect(javacLine, '前提不成立：这台机器上没有 javac，模拟不出「只有 Java」').toBeTruthy()
    const javaBin = dirname(javacLine!)

    const fakeEnv: Record<string, string | undefined> = {
      ...process.env,
      LOCALAPPDATA: empty,
      USERPROFILE: empty,
      ProgramData: empty,
      ProgramFiles: empty,
      'ProgramFiles(x86)': empty
    }
    const runEnv: NodeJS.ProcessEnv = { ...process.env, PATH: `${javaBin};C:\\Windows\\System32` }

    // ── 正题：三门都必须 found:false，而且不能带版本号 ──
    // 断言放在「前提」之前是**故意的**：万一这个 bug 回来，要红在用户看得见的
    // 那个症状上（界面那个 ✓），而不是红在一句「前提不成立」上 —— 后者虽然也对，
    // 但读起来像测试环境的问题，容易让人去调测试而不去查检测逻辑。
    for (const lang of ['c', 'cpp', 'python'] as const) {
      const got = await detectLang(lang, fakeEnv, runEnv, { drives: [] })
      expect(got.found, `没装 ${lang} 却报了「找到了」，指向 ${got.path}`).toBe(false)
      expect(got.version, `${lang} 没找到却还带了个版本号`).toBeUndefined()
    }

    // ── 佐证：这三门的候选列表在这份模拟环境里**确实是空的** ──
    // 少了这一步，「没找到」有可能只是碰巧成立（比如机器恰好没有），
    // 而不是因为逻辑真的对了 —— 那种绿是假绿。
    //
    // ⚠️ 必须带 `drives: []`：驱动器字面量（`C:\Program Files (x86)\Dev-Cpp\...`）是
    // 按真实盘符现算的，**绕不过伪造的环境变量** —— 而本机就真装着 Dev-C++，
    // 不掐掉它，「只装了 Java」在这台机器上根本摆不出来（2026-09-28 加这一条时踩到）。
    // 配上假环境变量（全指空目录），drives: [] 表达的是「按盘符猜的落点一个都没命中」，
    // 这正是朋友那台机器的真实情况。
    for (const lang of ['c', 'cpp', 'python'] as const) {
      const cands = await gatherCandidates(lang, fakeEnv, runEnv, { drives: [] })
      expect(cands, `前提不成立：模拟环境里 ${lang} 竟然还有候选 ${cands.join(', ')}`).toEqual([])
    }

    // ── 对照：Java 真的在，就必须找得到。证明这个模拟不是「什么都不认」──
    const java = await detectLang('java', fakeEnv, runEnv)
    expect(java.found, 'Java 明明在 PATH 里却没找到 —— 那就是修过头了').toBe(true)
    expect(!!java.version && looksLikeVersion(java.version)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
// 7. IDE 自带工具链：装了 Dev-C++ 却说没装（2026-09-28 任务一）
// ═══════════════════════════════════════════════════════════════

/**
 * 朋友那台机器：装了 Dev-C++（自带 TDM-GCC 4.9.2），应用却检测不到 C / C++。
 *
 * 病根**不是版本解析** —— 本机实测老 GCC 的版本行是 `gcc.exe (tdm64-1) 4.9.2`
 * （exit 0、走 stdout），`looksLikeVersion()` 本来就认这种形状。
 * 病根是**候选表里根本没有它的落点**：旧表只写了
 * `Program Files\Dev-Cpp\MinGW64\...`（**非 x86** 那一份），而本机实测
 * Dev-C++ 5.11 装在 `C:\Program Files (x86)\Dev-Cpp\MinGW64\` —— 32 位安装包
 * 在 64 位 Windows 上的默认位置。于是这台机器对兜底表完全不可见。
 *
 * 这一组钉两件事：① 静态表补齐了；② 后加的「注册表卸载项 → 安装根 → 工具链」
 * 这条数据驱动的路真的通（补表只能治这一台，数据驱动才治下一台）。
 */

/** 本机实测的 Dev-C++ 工具链全路径（2015 年的 Dev-C++ 5.11 + TDM-GCC 4.9.2） */
const REAL_DEVCPP_GCC = 'C:\\Program Files (x86)\\Dev-Cpp\\MinGW64\\bin\\gcc.exe'

/**
 * 以下三段是 2026-09-28 本机 `reg query` 输出的**逐字**片段：
 * 键名、值行形状、缩进（值名一列是 4 空格、列间 4 空格）都没动过，只删掉了
 * 与本条无关的值行。GBK 中文（WinLibs 那条的 DisplayName）由 `decodeConsole()`
 * 解码后才交给解析函数，所以这里写的是**解码后**的文本。
 */
const REG_DEVCPP = [
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Dev-C++',
  '    DisplayName    REG_SZ    Dev-C++',
  '    UninstallString    REG_SZ    C:\\Program Files (x86)\\Dev-Cpp\\uninstall.exe',
  '    DisplayVersion    REG_SZ    5.11',
  '    DisplayIcon    REG_SZ    C:\\Program Files (x86)\\Dev-Cpp\\devcpp.exe',
  '    Publisher    REG_SZ    Bloodshed Software'
].join('\r\n')

const REG_WINLIBS = [
  'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe',
  '    WinGetPackageIdentifier    REG_SZ    BrechtSanders.WinLibs.POSIX.UCRT',
  '    UninstallString    REG_SZ    winget uninstall --product-code BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe',
  '    DisplayName    REG_SZ    WinLibs (POSIX 线程库, UCRT 运行时库)',
  '    DisplayVersion    REG_SZ    16.1.0-14.0.0-r4',
  '    InstallLocation    REG_SZ    C:\\Users\\me\\AppData\\Local\\MiAiBianCheng\\toolchain\\winlibs'
].join('\r\n')

/** ★ Git for Windows：它的 InstallLocation 里带 `mingw64`（`reg query /f mingw` 真会搜到它），但它不是 IDE */
const REG_GIT = [
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Git_is1',
  '    Inno Setup: App Path    REG_SZ    D:\\me\\Git',
  '    InstallLocation    REG_SZ    D:\\me\\Git\\',
  '    DisplayName    REG_SZ    Git',
  '    InstallDate    REG_SZ    20260907',
  '    DisplayIcon    REG_SZ    D:\\me\\Git\\mingw64\\share\\git\\git-for-windows.ico',
  '    UninstallString    REG_SZ    "D:\\me\\Git\\unins000.exe"'
].join('\r\n')

describe('parseUninstallEntries：reg query /s 的输出要能拆成一条条卸载项', () => {
  it('三条都拆得出来，DisplayName 逐字对得上', () => {
    const es = parseUninstallEntries([REG_DEVCPP, REG_WINLIBS, REG_GIT].join('\r\n\r\n'))
    expect(es.map((e) => e.displayName)).toEqual([
      'Dev-C++',
      'WinLibs (POSIX 线程库, UCRT 运行时库)',
      'Git'
    ])
    expect(es[0].key).toBe(
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Dev-C++'
    )
  })

  it('★ Dev-C++ 那条**没有 InstallLocation**，只有 UninstallString（NSIS 装的，本机实测）', () => {
    // 只读 InstallLocation 的实现会把朋友那台机器整个漏掉 —— 这是本条的用意
    const e = parseUninstallEntries(REG_DEVCPP)[0]
    expect(e.installLocation).toBeUndefined()
    expect(e.uninstallString).toBe('C:\\Program Files (x86)\\Dev-Cpp\\uninstall.exe')
  })

  it('reg 失败时的输出（报错文字 / 空）→ 空数组，不许崩', () => {
    // 实测的报错长这样（GBK 解码后）：错误: 系统找不到指定的注册表项或值。
    expect(parseUninstallEntries('')).toEqual([])
    expect(parseUninstallEntries('错误: 系统找不到指定的注册表项或值。')).toEqual([])
  })
})

describe('installRootOf：没有 InstallLocation 也要推得出安装根', () => {
  it('★ Dev-C++：从 UninstallString 的目录名推出来（路径里带空格也不能切错）', () => {
    expect(installRootOf(parseUninstallEntries(REG_DEVCPP)[0])).toBe(
      'C:\\Program Files (x86)\\Dev-Cpp'
    )
  })

  it('有 InstallLocation 就直接用；末尾的反斜杠会被去掉', () => {
    expect(installRootOf(parseUninstallEntries(REG_WINLIBS)[0])).toBe(
      'C:\\Users\\me\\AppData\\Local\\MiAiBianCheng\\toolchain\\winlibs'
    )
    expect(installRootOf(parseUninstallEntries(REG_GIT)[0])).toBe('D:\\me\\Git')
  })

  it('带引号 + 参数：把 `"…\\unins000.exe" /SILENT` 里的目录取出来，不把参数当路径', () => {
    expect(
      installRootOf({ key: 'k', uninstallString: '"D:\\tools\\Foo\\unins000.exe" /SILENT' })
    ).toBe('D:\\tools\\Foo')
  })

  it('MSI 的 `MsiExec.exe /X{GUID}` → undefined（跟着它走会去扫 System32）', () => {
    expect(
      installRootOf({
        key: 'k',
        uninstallString: '"C:\\Windows\\System32\\msiexec.exe" /X{2B4E1F60-0000-0000-0000-000000000000}'
      })
    ).toBeUndefined()
  })

  it('winget 的 `winget uninstall --product-code X` → undefined（那根本不是路径）', () => {
    expect(
      installRootOf({
        key: 'k',
        uninstallString: 'winget uninstall --product-code Some.Package_Id'
      })
    ).toBeUndefined()
  })

  it('什么都没有 → undefined（不许凭空空造一个根）', () => {
    expect(installRootOf({ key: 'k' })).toBeUndefined()
    expect(installRootOf({ key: 'k', installLocation: '   ', uninstallString: '  ' })).toBeUndefined()
  })
})

describe('looksLikeIde：只认名字，不认它装在哪', () => {
  it('Dev-C++ / Code::Blocks / TDM-GCC / WinLibs / Android Studio 都认', () => {
    for (const n of [
      'Dev-C++',
      'Dev-C++ 5.11',
      'Bloodshed Dev-C++',
      'Code::Blocks 20.03',
      'CodeBlocks',
      'TDM-GCC-64',
      'WinLibs (POSIX 线程库, UCRT 运行时库)',
      'Android Studio'
    ]) {
      expect(looksLikeIde(n), `没认出 ${n}`).toBe(true)
    }
    for (const n of ['Google Chrome', 'Microsoft Visual C++ 2015 Redistributable', 'Git']) {
      expect(looksLikeIde(n), `把 ${n} 误认成了 IDE`).toBe(false)
    }
  })

  it('★ Git for Windows 不算：它的输出里带 mingw64（/f mingw 真会搜到它），但名字是 Git', () => {
    // 本机实测：`reg query <卸载项根> /s /f mingw` 的命中里有 Git_is1 ——
    // 因为 /f 是拿模式去比**任意值的内容**，而 Git 那条的 DisplayIcon 里写着
    // D:\me\Git\mingw64\share\git\...（InstallLocation 倒是干净的 D:\me\Git\）。
    // 判据要是「这条输出里有 mingw」，就会去 Git 的目录里找 gcc.exe（那儿没有）。
    // 名字才是判据 —— **这条钉的就是这一点**（本实现正是因此不用 /f，只 dump 后按名字筛）。
    expect(REG_GIT.toLowerCase(), '前提不成立：这段输出里没有 mingw64 了？').toContain('mingw64')
    const git = parseUninstallEntries(REG_GIT)[0]
    expect(git.installLocation!.toLowerCase()).not.toContain('mingw64')
    expect(looksLikeIde(git.displayName!)).toBe(false)
    expect(looksLikeIde(git.key)).toBe(false)
  })
})

describe('ideCandidatesUnder：安装根下面真能找出工具链', () => {
  /** 造一棵假工具链树：`root\<sub>\gcc.exe`（用真 exe 假扮，方便下一条真跑） */
  function makeToolTree(sub: string, exe = 'gcc.exe'): string {
    const root = makeTmp()
    const bin = join(root, ...sub.split('/'))
    mkdirSync(bin, { recursive: true })
    copyFileSync(FAKE_EXE_SRC, join(bin, exe))
    return root
  }

  it('Dev-C++ 的 MinGW64 与 MinGW32 两种子目录都认（旧表只有非 x86 的一份 MinGW64）', () => {
    const root = makeTmp()
    for (const sub of ['MinGW64', 'MinGW32']) {
      mkdirSync(join(root, sub, 'bin'), { recursive: true })
      copyFileSync(FAKE_EXE_SRC, join(root, sub, 'bin', 'gcc.exe'))
    }
    const got = ideCandidatesUnder(root, 'c').map((p) => p.toLowerCase())
    expect(got).toContain(join(root, 'MinGW64', 'bin', 'gcc.exe').toLowerCase())
    expect(got).toContain(join(root, 'MinGW32', 'bin', 'gcc.exe').toLowerCase())
  })

  it('★ 小写 mingw64 也要认（expandGlob 的段内通配区分大小写，「删一条重复的」会让 WinLibs 那类漏掉）', () => {
    const root = makeToolTree('mingw64/bin')
    expect(ideCandidatesUnder(root, 'c')).toEqual([join(root, 'mingw64', 'bin', 'gcc.exe')])
    // 对照：WinLibs 的实际布局就是这个（本机实测 …\toolchain\winlibs\mingw64\bin\gcc.exe）
  })

  it('Android Studio 的 jbr\\bin 里找 javac（自带 JDK，装了它的人不该再被要求装一次）', () => {
    const root = makeTmp()
    mkdirSync(join(root, 'jbr', 'bin'), { recursive: true })
    copyFileSync(FAKE_EXE_SRC, join(root, 'jbr', 'bin', 'javac.exe'))
    expect(ideCandidatesUnder(root, 'java')).toEqual([join(root, 'jbr', 'bin', 'javac.exe')])
  })

  it('空目录 → 空数组（没有的东西不许凭空造出来）', () => {
    const root = makeTmp()
    for (const lang of LANG_OF_CODE) expect(ideCandidatesUnder(root, lang)).toEqual([])
  })
})

// 同上一组：真进程 + 满负载 ⇒ 30s 进程启动预算（断言未动）
// 60s（原 30s）：同上一组——2026-10-11 凌晨全量实测本组两条 15525ms / 14049ms，
// 30s 预算余量已不足一半。断言一字未动。
describe('真进程端到端：Dev-C++ 装在 Program Files (x86)（= 朋友那台）', { timeout: 60_000 }, () => {
  it('老版本 GCC 的版本行形状（本机 TDM-GCC 4.9.2 实测值）', () => {
    // 任务一要求「兼容旧版 GCC 输出格式」。实测这两种形状本来就过 looksLikeVersion，
    // 写下来是为了把「老编译器输出」这个前提钉成事实，而不是靠印象。
    expect(looksLikeVersion('gcc.exe (tdm64-1) 4.9.2')).toBe(true)
    expect(looksLikeVersion('g++.exe (tdm64-1) 4.9.2')).toBe(true)
    // 对照：空壳与报错的形状必须仍被挡掉
    expect(looksLikeVersion('')).toBe(false)
    expect(looksLikeVersion("'gcc' is not recognized as an internal or external command")).toBe(false)
  })

  /** 造一棵「Program Files (x86)\Dev-Cpp\MinGW64\bin\<exe>」的树 + 一份只认 C 盘的假环境 */
  function fakeFriendPc(): { pfx86: string; fakeEnv: Record<string, string | undefined>; runEnv: NodeJS.ProcessEnv } {
    const tmp = makeTmp()
    const pfx86 = join(tmp, 'Program Files (x86)')
    const empty = join(tmp, 'empty-home')
    mkdirSync(empty, { recursive: true })
    return {
      pfx86,
      fakeEnv: {
        ...process.env,
        'ProgramFiles(x86)': pfx86,
        ProgramFiles: empty,
        USERPROFILE: empty,
        LOCALAPPDATA: empty,
        ProgramData: empty
      },
      runEnv: { ...process.env, PATH: 'C:\\Windows\\System32' }
    }
  }

  it('★ 不在 PATH 里 → where 找不到，但兜底表找得到（C 与 C++ 一起验，防「只修了 C 那边」）', async () => {
    const { pfx86, fakeEnv, runEnv } = fakeFriendPc()
    for (const cs of [
      { lang: 'c' as const, cmd: 'gcc', exe: 'gcc.exe' },
      { lang: 'cpp' as const, cmd: 'g++', exe: 'g++.exe' }
    ]) {
      const bin = join(pfx86, 'Dev-Cpp', 'MinGW64', 'bin')
      mkdirSync(bin, { recursive: true })
      copyFileSync(FAKE_EXE_SRC, join(bin, cs.exe))

      // 前提：这条 PATH 下 where 确实找不到它（否则绿了也说明不了兜底表有用）
      const viaWhere = await runWhere(cs.cmd, runEnv)
      expect(viaWhere, `前提不成立：这条 PATH 下 where 竟然找到了 ${cs.cmd}`).toEqual([])

      // drives: [] —— 驱动器字面量绕不过伪造的环境变量，而本机真装着 Dev-C++，
      // 不掐掉它，这一段验的就不是「Program Files (x86) 这条落点」了
      const got = await detectLang(cs.lang, fakeEnv, runEnv, { drives: [] })
      expect(got.found, `装了 Dev-C++ 却说没装 ${cs.lang}`).toBe(true)
      expect(got.path).toBe(join(bin, cs.exe))
      expect(!!got.version && looksLikeVersion(got.version), `版本行不像版本号：${got.version}`).toBe(
        true
      )
    }
  })

  it('★ 反向验证：不造那棵树 → 同一份代码必须报「没找到」，候选也一条都没有', async () => {
    // 没有这一条，上面那条绿了也可能是「碰巧」—— 这是「种一个坏值，亲眼见它红」
    const { pfx86, fakeEnv, runEnv } = fakeFriendPc()
    expect(existsSync(join(pfx86, 'Dev-Cpp')), '前提不成立：这棵树不该存在').toBe(false)
    for (const lang of ['c', 'cpp'] as const) {
      const cands = await gatherCandidates(lang, fakeEnv, runEnv, { drives: [] })
      expect(cands, `前提不成立：模拟环境里 ${lang} 竟然还有候选 ${cands.join(', ')}`).toEqual([])
      const got = await detectLang(lang, fakeEnv, runEnv, { drives: [] })
      expect(got.found).toBe(false)
      expect(got.version).toBeUndefined()
    }
  })

  it('注册表认出的 IDE 候选排在兜底表前面（真装的那个优先于猜的落点）', async () => {
    const { pfx86, fakeEnv, runEnv } = fakeFriendPc()
    const ideBin = join(pfx86, 'SomeIde', 'bin') // 假装注册表指向这儿
    const guessBin = join(pfx86, 'Dev-Cpp', 'MinGW64', 'bin') // 兜底表按惯例猜的落点
    mkdirSync(ideBin, { recursive: true })
    mkdirSync(guessBin, { recursive: true })
    copyFileSync(FAKE_EXE_SRC, join(ideBin, 'gcc.exe'))
    copyFileSync(FAKE_EXE_SRC, join(guessBin, 'gcc.exe'))

    const cands = await gatherCandidates('c', fakeEnv, runEnv, {
      drives: [],
      idePaths: [join(ideBin, 'gcc.exe')]
    })
    const iIde = cands.indexOf(join(ideBin, 'gcc.exe'))
    const iGuess = cands.indexOf(join(guessBin, 'gcc.exe'))
    expect(iIde, '注册表那条没进候选').toBeGreaterThanOrEqual(0)
    expect(iGuess, '前提不成立：兜底表那条没进候选，比不出顺序').toBeGreaterThanOrEqual(0)
    expect(iIde, '注册表认出的 IDE 排在按惯例猜的落点后面了').toBeLessThan(iGuess)
  })

  it('★ 本机真注册表端到端：装着 Dev-C++ 就必须认出它的 gcc（没装则跳过，但要喊出来）', async () => {
    // 60s：真起 3 个 `reg query /s` 全树 dump。静机实测 2.1s；2026-10-11 凌晨
    // 全量并发（169 文件抢盘）时顶穿内部默认 8s 被掐 ⇒ 静默降级空表 ⇒ 假红
    // （实测 8284ms 带空数组返回）。断言一字未动，放宽的只是这次调用的预算。
    const ide = await ideToolchainCandidates(60_000)
    if (!existsSync(REAL_DEVCPP_GCC)) {
      // 跳过 = 没验过。按本仓库的规矩必须喊出来，不能静悄悄绿过去。
      console.warn(
        `[跳过] 本机没有 ${REAL_DEVCPP_GCC}，注册表这条路只能在装了 Dev-C++ 的机器上验（比如朋友那台）`
      )
      return
    }
    expect(
      ide.c.map((p) => p.toLowerCase()),
      '注册表里明明有 Dev-C++ 的卸载项，ideToolchainCandidates() 却没认出它的 gcc'
    ).toContain(REAL_DEVCPP_GCC.toLowerCase())
  })

  it('★★ 本机真注册表 + 真跑：Dev-C++ 的 TDM-GCC 4.9.2 报得出老版本格式的版本号', async () => {
    // 这是任务一的验收核心：**老编译器**（不只是「装在别处的新编译器」）必须被认出来。
    // 手法：把兜底表整个掐掉（drives: [] + 环境变量全指空目录），唯一能找到它的路
    // 就是注册表那条 —— 于是这条真的在验新代码，而不是被静态表顺手带绿。
    const { fakeEnv, runEnv } = fakeFriendPc()
    if (!existsSync(REAL_DEVCPP_GCC)) {
      console.warn(`[跳过] 本机没有 ${REAL_DEVCPP_GCC}，老编译器这一条没验过`)
      return
    }

    // 前提：这份假环境里，静态兜底表一条候选都给不出来（否则绿了也不知道是谁的功劳）
    const viaStatic = await gatherCandidates('c', fakeEnv, runEnv, { drives: [] })
    expect(viaStatic, `前提不成立：静态表还能给出候选 ${viaStatic.join(', ')}`).toEqual([])

    // 真注册表里必须认出它（60s：同上条——负载下默认 8s 会被掐成静默空表）
    const ide = await ideToolchainCandidates(60_000)
    expect(
      ide.c.map((p) => p.toLowerCase()),
      '注册表里明明有 Dev-C++ 的卸载项，ideToolchainCandidates() 却没认出它的 gcc'
    ).toContain(REAL_DEVCPP_GCC.toLowerCase())

    // 再让**真进程**去跑它：注册表说「这儿有」之后，还得真报得出像样版本号才算数
    const got = await detectLang('c', fakeEnv, runEnv, { drives: [], idePaths: [REAL_DEVCPP_GCC] })
    expect(got.found, '注册表认出了路径，真跑却没报出版本号').toBe(true)
    expect(got.path).toBe(REAL_DEVCPP_GCC)
    // 本机实测值：`gcc.exe (tdm64-1) 4.9.2`。将来真升级了 Dev-C++，
    // 红在这条上是对的 —— 改期望值之前先把新版本行实测一遍。
    expect(got.version, '老版本 GCC 的版本行没被认出来').toMatch(/4\.9\.2/)
  })
})
