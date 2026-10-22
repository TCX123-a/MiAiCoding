import { describe, expect, it } from 'vitest'
import {
  TOOLCHAIN,
  TOOLCHAIN_ROOT,
  languagesOf,
  missingPackages,
  planAll,
  planFor
} from '../install-plan'
import { LANG_OF_CODE, type EnvReport, type LangEnv, type LangOfCode } from '../types'

/**
 * M5-05 安装决策表的闸门。
 *
 * 【这个文件里最重要的是哪几条】
 * 不是「函数返回了东西」，而是三件**错了会让用户体验直接崩掉**的事：
 *
 *   ① **共包去重**（`missingPackages`）：C 和 C++ 同一个包。去重没了，
 *      缺两门语言就会排队装两个 MinGW，第二个报「已安装」——看起来像 bug。
 *   ② **portable 语言的兜底路径**：MinGW 是绿色版、不写 PATH。
 *      少一条 `WinGet\Packages` 兜底，用户就会「装完 gcc 还是说没装」。
 *   ③ **exe 名与语言必须配对**：c 找 gcc.exe、cpp 找 g++.exe。
 *      这两个字符串长得像，复制粘贴改错一个，症状是「C++ 永远装不上」，
 *      而手测时两个都装好了、根本看不出来。
 */

const NONE: LangEnv = { found: false }
const OK: LangEnv = { found: true, path: 'C:\\fake\\fake.exe', version: '1.0' }

/** 按「哪几门语言已装好」拼一份检测报告，默认全没装 */
function report(found: Partial<Record<LangOfCode, boolean>> = {}): EnvReport {
  return {
    c: found.c ? OK : NONE,
    cpp: found.cpp ? OK : NONE,
    java: found.java ? OK : NONE,
    python: found.python ? OK : NONE
  }
}

describe('这张表和四门语言对得上', () => {
  it('每门语言都有规格，一个不漏', () => {
    expect(Object.keys(TOOLCHAIN).sort()).toEqual([...LANG_OF_CODE].sort())
  })

  it('包 id 形态正常（点分、无空格、无中文）', () => {
    for (const lang of LANG_OF_CODE) {
      const id = TOOLCHAIN[lang].wingetId
      expect(id, `${lang} 的包 id`).toMatch(/^[A-Za-z0-9]+(\.[A-Za-z0-9-]+)+$/)
    }
  })

  it('C 与 C++ 共用同一个包（WinLibs 一个包里 gcc 和 g++ 都有）', () => {
    // 这条是**事实断言**，不是设计偏好：WinLibs 确实同时给 gcc 和 g++。
    // 哪天有人把 cpp 改成别的包，这里会红，逼他去核对包内容 —— 而不是默默多下一个包。
    expect(TOOLCHAIN.cpp.wingetId).toBe(TOOLCHAIN.c.wingetId)
  })

  it('Java 与 Python 各自独立，不与他人共用', () => {
    const ids = LANG_OF_CODE.map((l) => TOOLCHAIN[l].wingetId)
    expect(new Set(ids).size).toBe(3) // 四门语言、三个包
  })
})

describe('装完去哪儿找（这条错了用户会「装完还是没装」）', () => {
  it('每门语言都至少有一条兜底路径', () => {
    for (const lang of LANG_OF_CODE) {
      expect(TOOLCHAIN[lang].searchPaths.length, lang).toBeGreaterThan(0)
    }
  })

  it('找的 exe 与语言配对', () => {
    const exe: Record<LangOfCode, string> = {
      c: 'gcc.exe',
      cpp: 'g++.exe',
      java: 'javac.exe',
      python: 'python.exe'
    }
    for (const lang of LANG_OF_CODE) {
      for (const p of TOOLCHAIN[lang].searchPaths) {
        expect(p.endsWith(exe[lang]), `${lang} 的兜底路径 ${p} 找的不是 ${exe[lang]}`).toBe(true)
      }
    }
  })

  it('绿色版：我们自己的目录排在第一位', () => {
    // portable 不写 PATH，所以第一顺位必须是我们能控制的目录；
    // 排到 winget 自管目录后面，等于把「装到哪」的决定权又交回去了。
    for (const lang of LANG_OF_CODE) {
      if (!TOOLCHAIN[lang].portable) continue
      expect(TOOLCHAIN[lang].searchPaths[0].startsWith(TOOLCHAIN_ROOT), lang).toBe(true)
    }
  })

  it('绿色版必须有一条 winget 自管目录兜底', () => {
    // --location 不是所有清单都支持，不支持时 winget 会退回自己的目录。
    // 少了这条，用户装完就是这个结果：解压成功、检测仍然报缺。
    for (const lang of LANG_OF_CODE) {
      if (!TOOLCHAIN[lang].portable) continue
      const hasWingetFallback = TOOLCHAIN[lang].searchPaths.some((p) => p.includes('WinGet\\Packages'))
      expect(hasWingetFallback, `${lang} 缺 winget 自管目录兜底`).toBe(true)
    }
  })

  it('绿色版还列了 winget 建快捷方式的 Links 目录', () => {
    // 【实测记录，别把这条读成「winget 一定往这儿放」】
    // 2026-09-13 我们用 `--location` 装 gcc 时，winget 把别名建在安装目录自己里面，
    // Links 目录是空的。这条兜底针对的是另一种情况：
    // 用户自己在命令行敲 `winget install` 装 portable 包（不带 --location），
    // 那时 winget 才会在 Links 里建符号链接。
    // 它不在 PATH 里（32 段 PATH 实测无），所以列进兜底是必要的、不是多余的。
    for (const lang of LANG_OF_CODE) {
      if (!TOOLCHAIN[lang].portable) continue
      const hasLinks = TOOLCHAIN[lang].searchPaths.some((p) => p.includes('WinGet\\Links'))
      expect(hasLinks, `${lang} 缺 WinGet\\Links 兜底`).toBe(true)
    }
  })

  it('非绿色版必须列上人家自己的标准安装位置', () => {
    // 这条是 2026-09-13 真机装完 Java 换来的教训：
    // Temurin 的 MSI **既没写系统 PATH 也没写用户 PATH**，
    // 应用能认出 javac 全靠 `C:\Program Files\Eclipse Adoptium\...` 那几条。
    // 我们也不可能靠 --location 控制 MSI 落哪（见 install-plan 里 java 段的说明），
    // 所以「知道人家默认装哪」是唯一可行的办法。
    //
    // ⚠️ 这条只校验到盘符那一层，比较粗。真正抓得细的是下面那条「版本号」的。
    const standardRoots: Record<'java' | 'python', string> = {
      java: 'C:\\Program Files\\',
      python: '%LOCALAPPDATA%\\Programs\\'
    }
    for (const lang of ['java', 'python'] as const) {
      expect(TOOLCHAIN[lang].portable, `${lang} 不该是绿色版`).toBe(false)
      const hit = TOOLCHAIN[lang].searchPaths.some((p) => p.startsWith(standardRoots[lang]))
      expect(hit, `${lang} 没列它的标准安装位置（${standardRoots[lang]}...）`).toBe(true)
    }
  })

  it('包 id 里的主版本号必须体现在兜底路径上', () => {
    // 【这条是拿假绿换来的，别删】
    // 我先写的版本只断言「路径以 C:\Program Files\ 开头」，结果把真正干活的那条
    // `jdk-21*` 删掉之后测试**照样全过**（被同目录下的 `jdk-*` 兜住了）——
    // 一条永远绿的闸门比没有闸门更危险，它会让人以为这里有保护。
    //
    // 真正会咬人的场景：将来把包从 Temurin 21 升到 25，忘了改路径通配 →
    // 用户看到「已成功安装」，紧接着检测报缺，两边都像坏了。
    // 所以这里直接拿真机实测到的落点去卡：
    //   EclipseAdoptium.Temurin.21.JDK  → C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot
    //   Python.Python.3.12              → %LOCALAPPDATA%\Programs\Python\Python312（3.12 写作 312，点没了）
    //
    // 【为什么必须「前缀 + 版本号」一起卡，不能只卡版本号】
    // 我上一版就只写了 `p.includes('jdk-21*')`，结果把 Program Files 那条删掉后**照样绿** ——
    // 因为 `${TOOLCHAIN_ROOT}\temurin\jdk-21*` 里也有 `jdk-21*`，把它兜住了。
    // 可真正让程序认出 Java 的恰恰是 Program Files 那条：MSI 不听我们的 --location，
    // 它就装在自己家。只卡版本号 = 卡了个寂寞。
    const has = (lang: 'java' | 'python', prefix: string, version: string): boolean =>
      TOOLCHAIN[lang].searchPaths.some((p) => p.startsWith(prefix) && p.includes(version))

    expect(
      has('java', 'C:\\Program Files\\', 'jdk-21*'),
      'Java 缺「C:\\Program Files 下的 jdk-21*」这条 —— 那才是 Temurin 真正装到的地方'
    ).toBe(true)
    expect(
      has('python', '%LOCALAPPDATA%\\Programs\\', 'Python312'),
      'Python 缺「%LOCALAPPDATA%\\Programs 下的 Python312」这条'
    ).toBe(true)
  })

  it('%ENV% 占位符写得规范（正则只认大写字母和下划线）', () => {
    for (const lang of LANG_OF_CODE) {
      for (const p of TOOLCHAIN[lang].searchPaths) {
        for (const m of p.matchAll(/%([^%]*)%/g)) {
          expect(m[1], `${p} 里的占位符`).toMatch(/^[A-Z_]+$/)
        }
      }
    }
  })

  it('工具链根目录是 ASCII 的（gcc 这条链经不起中文路径）', () => {
    expect(TOOLCHAIN_ROOT).toMatch(/^%[A-Z_]+%\\[A-Za-z0-9\\]+$/)
  })

  it('绿色版的判定与包类型一致', () => {
    // 本机 winget show 实测：WinLibs = portable(zip)，Temurin = wix(MSI)
    expect(TOOLCHAIN.c.portable).toBe(true)
    expect(TOOLCHAIN.cpp.portable).toBe(true)
    expect(TOOLCHAIN.java.portable).toBe(false)
  })
})

describe('缺什么、装几个', () => {
  it('全缺时是 3 个包，不是 4 个（C 和 C++ 合并成一个）', () => {
    const pkgs = missingPackages(report(), true)
    expect(pkgs).toHaveLength(3)
    expect(new Set(pkgs).size).toBe(pkgs.length) // 无重复
  })

  it('顺序稳定：按语言表的顺序出现，不随对象键序抖动', () => {
    const pkgs = missingPackages(report(), true)
    expect(pkgs[0]).toBe(TOOLCHAIN.c.wingetId) // C 排最前，因为它是第一个共包
    expect(pkgs).toEqual([
      TOOLCHAIN.c.wingetId,
      TOOLCHAIN.java.wingetId,
      TOOLCHAIN.python.wingetId
    ])
  })

  it('只缺 C++ 时，仍然只装那一个包（不会因为 C 装好了就跳过）', () => {
    // C 在、C++ 不在，是个真实会发生的组合：WinLibs 装了但只把 gcc 加进了 PATH
    const pkgs = missingPackages(report({ c: true, java: true, python: true }), true)
    expect(pkgs).toEqual([TOOLCHAIN.cpp.wingetId])
  })

  it('一台机器用不了 winget 时，不给任何安装任务', () => {
    // 给了也装不了。界面据此走「手动指引」那条路，而不是排一个永远失败的队。
    expect(missingPackages(report(), false)).toEqual([])
  })

  it('全装好了就没有任何待装项', () => {
    expect(missingPackages(report({ c: true, cpp: true, java: true, python: true }), true)).toEqual([])
  })

  it('包 → 语言 是反查得通的', () => {
    expect(languagesOf(TOOLCHAIN.c.wingetId)).toEqual(['c', 'cpp'])
    expect(languagesOf(TOOLCHAIN.java.wingetId)).toEqual(['java'])
    expect(languagesOf('Someone.Unknown.Package')).toEqual([])
  })
})

describe('每门语言该显示什么', () => {
  it('三种状态分得清', () => {
    expect(planFor('c', OK, true).state).toBe('ready')
    expect(planFor('c', NONE, true).state).toBe('installable')
    expect(planFor('c', NONE, false).state).toBe('manual')
  })

  it('装好了就没有可点的安装按钮', () => {
    // 界面是拿 installTargets 的长度决定显不显示按钮的，
    // 所以这条同时是「装好的语言旁边不会挂一个多余的按钮」的保证。
    for (const lang of LANG_OF_CODE) {
      expect(planFor(lang, OK, true).installTargets, lang).toEqual([])
    }
  })

  it('不能自动装时也没有按钮（该给的是手动命令）', () => {
    for (const lang of LANG_OF_CODE) {
      expect(planFor(lang, NONE, false).installTargets, lang).toEqual([])
    }
  })

  it('装了 C 会顺带修好 C++，反过来也一样', () => {
    expect(planFor('c', NONE, true).alsoFixes).toEqual(['cpp'])
    expect(planFor('cpp', NONE, true).alsoFixes).toEqual(['c'])
  })

  it('Java / Python 不牵连别人', () => {
    expect(planFor('java', NONE, true).alsoFixes).toEqual([])
    expect(planFor('python', NONE, true).alsoFixes).toEqual([])
  })

  it('已经装好的语言不提示「顺带修好谁」', () => {
    // 它本来就是好的，再说「装它会顺带修好 C++」只会让人以为还要再装一次
    expect(planFor('c', OK, true).alsoFixes).toEqual([])
  })

  it('无论哪种状态，包 id 都给得出来（手动命令要用）', () => {
    for (const lang of LANG_OF_CODE) {
      for (const env of [OK, NONE]) {
        for (const winget of [true, false]) {
          expect(planFor(lang, env, winget).wingetId, lang).toBeTruthy()
        }
      }
    }
  })

  it('planAll 的顺序与语言表一致（界面每次渲染顺序都得一样）', () => {
    expect(planAll(report(), true).map((p) => p.lang)).toEqual([...LANG_OF_CODE])
  })
})
