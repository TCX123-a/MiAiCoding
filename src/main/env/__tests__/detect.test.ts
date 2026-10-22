import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  expandEnvVars,
  expandGlob,
  fallbackPathsFor,
  parseVersionLine,
  refreshLangs
} from '../detect'
import { TOOLCHAIN } from '../../../shared/install-plan'
import { blankReport } from '../../../shared/env-cache'
import { LANG_OF_CODE, type EnvReport, type LangOfCode } from '../../../shared/types'

const tmpRoots: string[] = []

/** 建一个临时目录，afterEach 统一清理 */
function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'miai-detect-'))
  tmpRoots.push(dir)
  return dir
}

afterEach(() => {
  for (const d of tmpRoots.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // 清理失败不影响测试结果
    }
  }
})

describe('expandEnvVars', () => {
  it('展开已知 %VAR% 占位符', () => {
    const env = { USERPROFILE: 'C:\\Users\\miai', SYSTEMROOT: 'C:\\Windows' }
    expect(expandEnvVars('%USERPROFILE%\\scoop\\shims\\gcc.exe', env)).toBe('C:\\Users\\miai\\scoop\\shims\\gcc.exe')
  })

  it('未知变量替换为空串', () => {
    expect(expandEnvVars('C:\\%NOTHING%\\gcc.exe', {})).toBe('C:\\\\gcc.exe')
  })

  it('同一路径可含多个占位符', () => {
    const env = { A: 'x', B: 'y' }
    expect(expandEnvVars('%A%-%B%', env)).toBe('x-y')
  })

  it('无占位符原样返回', () => {
    expect(expandEnvVars('C:\\mingw64\\bin\\gcc.exe', {})).toBe('C:\\mingw64\\bin\\gcc.exe')
  })
})

describe('expandGlob', () => {
  it('无 * 且不存在 → 空数组（★ 旧断言是「原样返回」，那正是假阳性的种子）', () => {
    // 【这条测试以前把 bug 当成了规矩，务必别再改回去】
    // 旧断言是 `toEqual(['C:\\nope\\gcc.exe'])`，理由明写在标题里：「不检查存在性」。
    // 后果是兜底表里那几十条「这台机器上根本没有」的路径全成了合法候选
    // （2026-09-17 实测：c/cpp 各 30 条候选里 23 条是幻影），探针全失败之后
    // 又被 chooseCompiler 的降级分支收下 —— 于是只装了 Java 的那台电脑上，
    // C / C++ / Python 全给打了 ✓。存在性检查不是优化，是「找到了」这三个字的定义。
    expect(expandGlob('C:\\nope\\gcc.exe')).toEqual([])
  })

  it('无 * 但真实存在 → 原样返回（别把孩子和洗澡水一起倒了）', () => {
    const dir = makeTmp()
    const exe = join(dir, 'gcc.exe')
    writeFileSync(exe, '')
    expect(expandGlob(exe)).toEqual([exe])
  })

  it('base 不存在返回空数组', () => {
    expect(expandGlob(join(tmpdir(), 'miai-nonexistent-xyz', '*', 'gcc.exe'))).toEqual([])
  })

  it('单个 * 列出 base 下拼接 rest 后存在的路径', () => {
    const dir = makeTmp()
    mkdirSync(join(dir, 'v1'))
    mkdirSync(join(dir, 'v2'))
    writeFileSync(join(dir, 'v1', 'gcc.exe'), '')
    const got = expandGlob(join(dir, '*', 'gcc.exe'))
    expect(got).toEqual([join(dir, 'v1', 'gcc.exe')])
  })

  it('两级 *（mingw-w64\\*\\mingw64\\bin\\gcc.exe 形态）', () => {
    const dir = makeTmp()
    for (const v of ['v1', 'v2']) {
      mkdirSync(join(dir, v, 'mingw64', 'bin'), { recursive: true })
      writeFileSync(join(dir, v, 'mingw64', 'bin', 'gcc.exe'), '')
    }
    const got = expandGlob(join(dir, '*', 'mingw64', 'bin', 'gcc.exe'))
    expect(got.sort()).toEqual([join(dir, 'v1', 'mingw64', 'bin', 'gcc.exe'), join(dir, 'v2', 'mingw64', 'bin', 'gcc.exe')].sort())
  })

  it('中间目录缺失的条目被跳过', () => {
    const dir = makeTmp()
    mkdirSync(join(dir, 'v1', 'mingw64', 'bin'), { recursive: true })
    mkdirSync(join(dir, 'v2')) // 没有 mingw64 子树
    writeFileSync(join(dir, 'v1', 'mingw64', 'bin', 'gcc.exe'), '')
    const got = expandGlob(join(dir, '*', 'mingw64', 'bin', 'gcc.exe'))
    expect(got).toEqual([join(dir, 'v1', 'mingw64', 'bin', 'gcc.exe')])
  })
})

describe('parseVersionLine', () => {
  it('取第一行非空内容', () => {
    expect(parseVersionLine('gcc (x86_64-posix-seh-rev0) 14.2.0\r\nCopyright (C) 2024')).toBe(
      'gcc (x86_64-posix-seh-rev0) 14.2.0'
    )
  })

  it('跳过开头空行（Python 常输出空行开头）', () => {
    expect(parseVersionLine('\n\nPython 3.12.10\r\n')).toBe('Python 3.12.10')
  })

  it('全空白返回 undefined', () => {
    expect(parseVersionLine('   \r\n \n')).toBeUndefined()
  })

  it('空串返回 undefined', () => {
    expect(parseVersionLine('')).toBeUndefined()
  })
})

describe('expandGlob 目录存在性检查', () => {
  it('通配展开结果都是真实存在的文件', () => {
    const dir = makeTmp()
    mkdirSync(join(dir, 'Python312'), { recursive: true })
    writeFileSync(join(dir, 'Python312', 'python.exe'), '')
    const got = expandGlob(join(dir, 'Python3*', 'python.exe'))
    expect(got).toEqual([join(dir, 'Python312', 'python.exe')])
    for (const p of got) expect(existsSync(p)).toBe(true)
  })
})

/**
 * 兜底扫描表与 install-plan 的接线闸门。
 *
 * 【为什么这几条最重要】
 * 「一键安装」把人指到 A 目录，检测却只扫 B 目录 —— 这个 bug 的表现是
 * 「下载装了 20 分钟，回来还是红字说你没装编译器」，而用户没有任何线索自查。
 * 它不会被任何手测发现，因为开发机上 gcc 早在 PATH 里了，兜底分支根本不走。
 * 所以只能在单测里钉死：**install-plan 里列的每一条，检测表里必须都有。**
 */
describe('兜底路径表跟着 install-plan 走', () => {
  it('一键安装会落的每一条路径，检测都能扫到', () => {
    for (const lang of LANG_OF_CODE) {
      const merged = fallbackPathsFor(lang)
      for (const p of TOOLCHAIN[lang].searchPaths) {
        expect(merged, `${lang} 的兜底表漏了 ${p}`).toContain(p)
      }
    }
  })

  it('手工装的路径也没被挤掉（合并是加法，不是替换）', () => {
    // 只看「包含 install-plan 那几条」是不够的：有人把数组写成
    // fallbackPathsFor = TOOLCHAIN[lang].searchPaths，上面那条照样绿，
    // 但 msys64 / Program Files 这些手工装的落点就全丢了。
    for (const lang of LANG_OF_CODE) {
      expect(fallbackPathsFor(lang).length, lang).toBeGreaterThan(
        TOOLCHAIN[lang].searchPaths.length
      )
    }
  })

  it('一键安装的路径排在手工路径前面（刚装的版本优先，别被旧编译器抢先）', () => {
    for (const lang of LANG_OF_CODE) {
      const merged = fallbackPathsFor(lang)
      const toolchainCount = TOOLCHAIN[lang].searchPaths.length
      expect(merged.slice(0, toolchainCount), lang).toEqual([...TOOLCHAIN[lang].searchPaths])
    }
  })

  it('同一门语言里没有重复路径', () => {
    // 重复本身只是白扫一遍，但它通常是「有人把已经进表的老路径又手抄了一份」的痕迹，
    // 将来改一处漏一处，所以当错误报出来。
    for (const lang of LANG_OF_CODE) {
      const merged = fallbackPathsFor(lang)
      expect(new Set(merged).size, `${lang} 的兜底表有重复`).toBe(merged.length)
    }
  })

  it('找的 exe 与语言配对（合并后整张表一起查）', () => {
    const exe: Record<LangOfCode, string> = {
      c: 'gcc.exe',
      cpp: 'g++.exe',
      java: 'javac.exe',
      python: 'python.exe'
    }
    for (const lang of LANG_OF_CODE) {
      for (const p of fallbackPathsFor(lang)) {
        expect(p.endsWith(exe[lang]), `${lang} 的 ${p} 找的不是 ${exe[lang]}`).toBe(true)
      }
    }
  })

  it('手工装的路径只写在 detect 这一份，没有和 install-plan 两头都写', () => {
    // msys64 是典型的手工安装落点。它要是同时出现在 install-plan 里，
    // 就说明「装到哪」的真源被劈成了两半，将来必然对不上。
    for (const lang of LANG_OF_CODE) {
      for (const p of TOOLCHAIN[lang].searchPaths) {
        expect(p, `${lang} 的 install-plan 里混进了手工路径`).not.toContain('msys64')
        expect(p, `${lang} 的 install-plan 里混进了手工路径`).not.toContain('chocolatey')
      }
    }
  })
})

/**
 * 缓存保鲜（M5-05）：读缓存不能无条件信。
 *
 * 2026-09-13 主人验收时踩到的真 bug：13:05 第一次开应用（那会儿确实没装 gcc/Java），
 * 缓存把 c/cpp/java 记成「没找到」；13:45 工具链装好了，**重启应用也不重检**，
 * 于是点 C/C++/Java 永远回「还没找到翻译官喵～」。纯规则部分见 shared/__tests__/env-cache.test.ts，
 * 这里守的是「重检之后有没有把结果合对」。
 */
describe('refreshLangs：缓存保鲜', () => {
  /**
   * 四门都报「找到了」的缓存，路径故意写成不存在的假路径。
   * 【为什么用假路径】这样「到底有没有偷偷重检」就有了肉眼可验的证据：
   * 真去查了的话，这四个假路径会被换成机器上的真实路径（或整条变成没找到）。
   * 用正斜杠是因为 Windows 两种都认，而这些路径从不真的去 spawn。
   */
  const allFound: EnvReport = {
    c: { found: true, path: 'C:/fake/gcc.exe', version: '1.0' },
    cpp: { found: true, path: 'C:/fake/g++.exe', version: '1.0' },
    java: { found: true, path: 'C:/fake/javac.exe', version: '1.0' },
    python: { found: true, path: 'C:/fake/python.exe', version: '1.0' }
  }

  it('缓存说全找到了就一个都不重检，四门的路径原封不动', async () => {
    const { report, rechecked } = await refreshLangs(allFound, 'c')
    expect(rechecked).toEqual([])
    for (const lang of LANG_OF_CODE) {
      expect(report[lang], `${lang} 被重检了`).toEqual(allFound[lang])
    }
  })

  // 60_000 = wall-clock 上限，不是松弛断言：这条会真查注册表 + 真 spawn python，
  // 全卷并发跑时 transform 洪峰会顶穿 vitest 默认 5s（2026-10-06 实测：全卷 5004ms 超时、
  // 单跑 2.3s 绿，四门检测文件本身零改动）。2026-10-11 凌晨机器被 26 个满核 python
  // 孤儿压着时全量实测 26013ms（30s 预算剩不到 13%）⇒ 提到 60s。断言一个没动；
  // 合并逻辑真卡死照样 60s 见红。
  it(
    '重检一门时不会把另外三门弄丢（合并是加法，不是替换）',
    async () => {
      // 缓存说 python 没找到 → 会真去查一次 python（本机有就查到，没有就照样记没找到，
      // 所以下面只断言「结构完整」，不依赖这台机器装没装 python）
      const cached = blankReport()
      const { report, rechecked } = await refreshLangs(cached, 'python')

      expect(rechecked).toEqual(['python'])
      for (const lang of LANG_OF_CODE) {
        expect(report[lang], `合并后 ${lang} 不见了`).toBeDefined()
        expect(typeof report[lang].found).toBe('boolean')
      }
    },
    60_000
  )
})
