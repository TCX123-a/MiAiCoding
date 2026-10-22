import { execSync, spawn } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { isAbsolute, join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  COMPILE_TIMEOUT_MS,
  decodeOutput,
  findJavaClass,
  killAllLiveChildren,
  killTree,
  makeCollector,
  MAX_OUTPUT_BYTES,
  pickTempRoot,
  planForLang,
  resolveExe,
  runCode,
  runProcess,
  unescapeCompilerIdentifiers
} from '../runner'
import { buildCmdLine } from '../native'
import { LANG_OF_CODE, type EnvReport } from '../../../shared/types'

describe('decodeOutput 三级回退', () => {
  it('合法 UTF-8 直接解码（含中文）', () => {
    const buf = Buffer.from('你好喵 Hello', 'utf8')
    expect(decodeOutput(buf)).toBe('你好喵 Hello')
  })

  it('GBK 字节（中文 Windows 程序常见）回退解码', () => {
    // GBK: 中=0xD6D0 文=0xCEC4
    const buf = Buffer.from([0xd6, 0xd0, 0xce, 0xc4])
    expect(decodeOutput(buf)).toBe('中文')
  })

  it('UTF-8 与 GBK 都解不动时 latin1 兜底不抛错', () => {
    const buf = Buffer.from([0xff, 0xfe, 0x41])
    expect(decodeOutput(buf)).toBe('ÿþA')
  })

  it('空输出返回空串', () => {
    expect(decodeOutput(Buffer.alloc(0))).toBe('')
  })

  it('去掉 UTF-8 BOM', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('输出', 'utf8')])
    expect(decodeOutput(buf)).toBe('输出')
  })
})

describe('unescapeCompilerIdentifiers（gcc 把中文标识符转义了）', () => {
  it('把 \\U0000xxxx 还原成真字符（实测的那一行原话）', () => {
    // 这一行是 `_warn-test` 从本机 gcc 16.1.0 抄回来的原话，一个字符没改
    const 原话 = "w.c:2:21: warning: unused variable '\\U00006ca1\\U00007528\\U00004e0a' [-Wunused-variable]"
    expect(unescapeCompilerIdentifiers(原话)).toContain("unused variable '没用上'")
  })

  it('对普通输出是**恒等变换**（判分靠 stdout，绝不能被动到）', () => {
    // ⚠️ `\U00006ca1` 不在这一组里 —— 它是**足八位**的转义，本来就该被还成「没」。
    // 我第一版把它当成了恒等变换，是自己写错，跑出来才发现。
    for (const s of ['ok\n', '', 'a\\Ub\\c', '行 2 列 3', '\\U0000', 'warning: unused variable']) {
      expect(unescapeCompilerIdentifiers(s)).toBe(s)
    }
  })

  it('不能显示的码位原样留着，不乱还原', () => {
    // \U00000000 不是标识符转义会产出的东西，还原成 NUL 只会更糟
    expect(unescapeCompilerIdentifiers('\\U00000000')).toBe('\\U00000000')
    // 代理对半截（U+D800）单独还原会得到非法字符串
    expect(unescapeCompilerIdentifiers('\\U0000d800')).toBe('\\U0000d800')
  })

  it('一行里多个转义全部还原，且不碰旁边的 ASCII', () => {
    expect(unescapeCompilerIdentifiers('a \\U00004e2d\\U00006587 b')).toBe('a 中文 b')
  })
})

describe('makeCollector 截断', () => {
  it('不超限完整收集', () => {
    const c = makeCollector()
    c.push(Buffer.from('abc'))
    c.push(Buffer.from('def'))
    const r = c.result()
    expect(r.buf.toString()).toBe('abcdef')
    expect(r.truncated).toBe(false)
  })

  it('超 256KB 截断并打标', () => {
    const c = makeCollector()
    c.push(Buffer.alloc(Math.floor(MAX_OUTPUT_BYTES / 2), 0x61))
    c.push(Buffer.alloc(Math.floor(MAX_OUTPUT_BYTES / 2) + 10, 0x62))
    c.push(Buffer.from('被丢弃的部分'))
    const r = c.result()
    expect(r.buf.length).toBe(MAX_OUTPUT_BYTES)
    expect(r.truncated).toBe(true)
  })

  it('截断后不再追加', () => {
    const c = makeCollector()
    c.push(Buffer.alloc(MAX_OUTPUT_BYTES + 1, 0x61))
    c.push(Buffer.from('zzz'))
    const r = c.result()
    expect(r.buf.length).toBe(MAX_OUTPUT_BYTES)
    expect(r.truncated).toBe(true)
  })
})

describe('findJavaClass', () => {
  it('优先 public class', () => {
    expect(findJavaClass('public class Main { }')).toBe('Main')
  })

  it('修饰符组合（final）也能提取', () => {
    expect(findJavaClass('public final class CatGirl {}')).toBe('CatGirl')
  })

  it('无 public 时退回普通 class', () => {
    expect(findJavaClass('class Helper {}')).toBe('Helper')
  })

  it('没有 class 返回 null', () => {
    expect(findJavaClass('int x = 1;')).toBeNull()
  })

  it('中文注释里的「class 类名」不误伤（\w 不匹配中文）', () => {
    expect(findJavaClass('// class 是猫猫图纸\npublic class Main {}')).toBe('Main')
  })
})

describe('planForLang', () => {
  const tool = 'C:\\tools\\bin\\tool.exe'

  it('C：双 UTF-8 开关 + -Wall + -std=gnu11 + 输出 prog.exe', () => {
    const p = planForLang('c', tool, '')
    expect(p.srcFile).toBe('main.c')
    expect(p.compile?.args).toContain('-finput-charset=UTF-8')
    expect(p.compile?.args).toContain('-fexec-charset=UTF-8')
    expect(p.compile?.args).toContain('-Wall')
    // -std 是**功能依赖**，不是可删的冗余参数：老编译器（TDM-GCC 4.9.2）默认 gnu89，
    // `for (int i = 0; …)` 直接编不过 —— 全库实测 253/585 道题在那种机器上做不了。
    // 删掉它不会让本机任何测试变红（新 gcc 默认就够新），只会让别人的题又挂掉。
    expect(p.compile?.args).toContain('-std=gnu11')
    expect(p.compile?.args).toEqual(['-finput-charset=UTF-8', '-fexec-charset=UTF-8', '-Wall', '-std=gnu11', '-o', 'prog.exe', 'main.c'])
    // ⚠️ 这个裸名字**不能直接拿去 spawn**（Windows 上会按 PATH 找而报 ENOENT）。
    // plan 只描述「产物叫什么」，它不知道临时目录在哪；跑之前必须过 resolveExe。
    // 2026-09-13 之前这条断言正好把那个 bug 钉住了，改它之前先读 resolveExe 的注释。
    expect(p.run).toEqual({ exe: 'prog.exe', args: [] })
  })

  it('C++：同 C（方言是 gnu++14），源文件 main.cpp', () => {
    const p = planForLang('cpp', tool, '')
    expect(p.srcFile).toBe('main.cpp')
    expect(p.compile?.args).toContain('main.cpp')
    // 同上：老 g++ 默认 gnu++98，range-for / unique_ptr / stoi 全不认（实测 160/637 道编不过）
    expect(p.compile?.args).toContain('-std=gnu++14')
    expect(p.compile?.args).toEqual(['-finput-charset=UTF-8', '-fexec-charset=UTF-8', '-Wall', '-std=gnu++14', '-o', 'prog.exe', 'main.cpp'])
  })

  it('Java：按类名写文件，java.exe 取同目录兄弟', () => {
    const p = planForLang('java', 'C:\\Program Files\\Java\\jdk-21\\bin\\javac.exe', 'public class Main {}')
    expect(p.srcFile).toBe('Main.java')
    expect(p.compile).toEqual({
      exe: 'C:\\Program Files\\Java\\jdk-21\\bin\\javac.exe',
      args: ['-J-Duser.language=en', '-J-Duser.country=US', '-encoding', 'UTF-8', 'Main.java']
    })
    expect(p.run).toEqual({
      exe: 'C:\\Program Files\\Java\\jdk-21\\bin\\java.exe',
      args: [
        '-Duser.language=en',
        '-Duser.country=US',
        '-Dfile.encoding=UTF-8',
        '-Dstdout.encoding=UTF-8',
        'Main'
      ]
    })
  })

  /**
   * 单独再钉一条「报错必须是英文」。
   *
   * 上面那条 toEqual 其实已经含了这几个参数，但它是**因为数组对不上才红的**，
   * 报错信息长这样：「数组第 0 项：期望 -encoding，实际 -J-Duser.language=en」——
   * 完全看不出这件事为什么要紧。谁哪天顺手删掉本地化参数，看到的就是这么一条
   * 莫名其妙的数组断言失败，最省事的做法是直接改断言放行。
   * 而代价是 Java 的报错解释整个失效：中文 Windows 上 javac 吐的是
   * 「错误: 需要';'」（GBK 字节），内置错误库的规则按英文写，一条也命中不了。
   * 所以单独立一条，名字里就写清楚删了会怎样。
   */
  it('Java：报错语言必须钉成英文，否则内置错误库一条也命中不了', () => {
    const p = planForLang('java', 'C:\\Program Files\\Java\\jdk-21\\bin\\javac.exe', 'public class Main {}')
    // javac.exe 只是个启动器，JVM 参数得用 -J 传进去
    expect(p.compile?.args).toContain('-J-Duser.language=en')
    // java 是直接起的 JVM，不加 -J
    expect(p.run.args).toContain('-Duser.language=en')
  })

  it('Java：无 class 时给结构级错误提示', () => {
    const p = planForLang('java', tool, 'System.out.println("hi");')
    expect(p.error).toContain('class')
  })

  it('Python：直接运行 + PYTHONUTF8', () => {
    const p = planForLang('python', tool, '')
    expect(p.srcFile).toBe('main.py')
    expect(p.compile).toBeUndefined()
    expect(p.run).toEqual({ exe: tool, args: ['-X', 'utf8', 'main.py'] })
    expect(p.env).toEqual({ PYTHONUTF8: '1' })
  })
})

/**
 * resolveExe —— C/C++ 六条样例全挂的那个 bug 的闸门。
 *
 * 【为什么这组用例必须存在，而且必须不依赖真实工具链】
 * 那个 bug 的根因是 Windows 上 `spawn('prog.exe')` 只查 PATH、不看 cwd。
 * 它只在**装上 gcc 的机器**上才表现，所以 samples-e2e 那类用例在没有工具链的机器上
 * 会整组跳过 —— 跳过的闸门等于没有闸门，而这次就是这么漏过去的。
 * 所以这里卡的是纯函数：不装 gcc 也能跑，永远绿或永远红，不给「跳过」留后门。
 */
describe('resolveExe（spawn 前必须把运行目标解析成绝对路径）', () => {
  const dir = 'C:\\tmp\\miai-run-abc'

  it('裸文件名补上工作目录', () => {
    expect(resolveExe('prog.exe', dir)).toBe('C:\\tmp\\miai-run-abc\\prog.exe')
  })

  it('已经是绝对路径的原样返回（Java / Python 走这条，别被改坏）', () => {
    const abs = 'C:\\Program Files\\Java\\jdk-21\\bin\\java.exe'
    expect(resolveExe(abs, dir)).toBe(abs)
  })

  it('四门语言的运行目标解析后都是绝对路径', () => {
    // 这条是真正防复发的那条：将来谁新增一门语言、直接 spawn plan.run.exe，
    // 只要它的 exe 是裸名字，这里就会红。
    for (const lang of LANG_OF_CODE) {
      const p = planForLang(lang, 'C:\\tools\\bin\\tool.exe', 'public class Main {}')
      expect(isAbsolute(resolveExe(p.run.exe, dir)), `${lang} 解析后仍不是绝对路径`).toBe(true)
    }
  })
})

// ---------------------------------------------------------------- T1 缺陷修复回归（2026-09-13）
// 背景见 docs/12-开源项目借鉴清单.md §4

describe('缺陷1：killTree 的 spawn 缺 error 监听会崩掉主进程', () => {
  it('killer 拉不起来时不抛错、测试进程存活，且 process.kill 兜底生效', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 30000)'], { stdio: 'ignore' })
    const exited = new Promise<boolean>((res) => {
      const t = setTimeout(() => res(false), 4000)
      child.on('exit', () => {
        clearTimeout(t)
        res(true)
      })
    })
    await new Promise((r) => setTimeout(r, 300))

    // 传入不存在的 killer：修复前这里会抛未捕获的 'error' 事件，直接杀死本测试进程
    expect(() => killTree(child.pid!, 'miai_no_such_killer_exe_xyz')).not.toThrow()

    // 兜底的 process.kill 应让子进程退出
    expect(await exited).toBe(true)
  })

  it('对已退出的 pid 调用不抛错', async () => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    await new Promise<void>((r) => child.on('exit', () => r()))
    expect(() => killTree(child.pid!)).not.toThrow()
  })
})

// ---------------------------------------------------------------- 2026-10-11 孤儿事故回归
/**
 * killTree 要杀的直接子进程是 cmd.exe，学生程序挂在它下面当孙子（原生模式：
 * cmd /d /v:off /s /c python main.py）。事故现场：旧实现在 spawn(taskkill) 之后
 * 紧跟着同步 process.kill(cmd)「兜底」——这一刀总是先到，把 cmd 先杀了；
 * taskkill 醒来按 PID 找不到树根，报「错误: 没有找到进程」空手而归，
 * 孙子就此孤儿化继续满核烧（29 个孤儿 python 的出处，2026-10-11 破案）。
 * 【为什么必须经 cmd 中介】直接拿 node 当子进程的话「杀父 == 杀程序」，
 * 旧实现的洞根本照不出来 —— 这就是它活了这么久的原因。
 */
describe('killTree 整树收割：cmd 中介下的孙子也必须死（2026-10-11 孤儿事故回归）', () => {
  /** 按 PID 查进程在否（tasklist 输出是 GBK） */
  function pidAlive(pid: number): boolean {
    try {
      const s = new TextDecoder('gbk').decode(
        execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'buffer' })
      )
      return s.includes(`"${pid}"`)
    } catch {
      return false
    }
  }

  it.skipIf(process.platform !== 'win32')(
    'killTree(cmd.pid) 之后，cmd 下面的孙子进程也消失（旧实现在此必红）',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'miai-killtree-'))
      const pidFile = join(dir, 'grandchild.pid')
      const fixture = join(dir, 'sleep.cjs')
      // 孙子：把自己的 PID 写下来（供点名查活），然后长眠等收割
      writeFileSync(
        fixture,
        `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))\nsetTimeout(() => {}, 60000)\n`
      )

      let gcPid = 0
      let cmd: ReturnType<typeof spawn> | undefined
      try {
        // 与原生模式同形的起法：cmd /d /v:off /s /c <buildCmdLine 拼的整行>
        cmd = spawn(
          process.env.ComSpec || 'cmd.exe',
          ['/d', '/v:off', '/s', '/c', buildCmdLine(process.execPath, [fixture])],
          { windowsHide: true, windowsVerbatimArguments: true, stdio: 'ignore' }
        )

        for (let i = 0; i < 75 && !gcPid; i++) {
          await new Promise((r) => setTimeout(r, 200))
          try {
            gcPid = parseInt(readFileSync(pidFile, 'utf8'), 10)
          } catch {
            // 孙子还没起来
          }
        }
        expect(gcPid, '夹具没起来：孙子没写出 PID').toBeGreaterThan(0)
        expect(pidAlive(gcPid), '尺子自检：孙子此刻必须真的在跑').toBe(true)

        killTree(cmd.pid!)

        let gone = false
        for (let i = 0; i < 40 && !gone; i++) {
          await new Promise((r) => setTimeout(r, 200))
          gone = !pidAlive(gcPid)
        }
        expect(gone, `孙子进程 ${gcPid} 在 killTree 后 8s 仍存活 = 又孤儿化了一个`).toBe(true)
      } finally {
        // 无论断言结果如何，都不许把实验进程留在机器上（这个用例的主题就是「不留孤儿」）
        if (gcPid) {
          try {
            execSync(`taskkill /PID ${gcPid} /T /F`, { stdio: 'ignore' })
          } catch {
            // 已死
          }
        }
        if (cmd?.pid) {
          try {
            execSync(`taskkill /PID ${cmd.pid} /T /F`, { stdio: 'ignore' })
          } catch {
            // 已死
          }
        }
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {
          // 清理失败不影响判定
        }
      }
    },
    // 预算 45s（负载假红同族先例）：97% CPU 负载下每次 tasklist 侦察要几百毫秒，
    // 旧实现的红路径会在预算内表现为「孙子存活」断言红；新实现一旦收割完成即提前退出。
    45_000
  )
})

describe('缺陷2：编译与运行共用同一个超时', () => {
  it('编译超时独立且足够宽（≥30s），不受用户运行超时（可低至 5s）影响', () => {
    expect(COMPILE_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000)
  })
})

describe('缺陷4：临时目录可能含非 ASCII（中文用户名）', () => {
  const FB = 'C:\\Users\\Public\\miai-runner'

  it('纯 ASCII 路径原样返回', () => {
    expect(pickTempRoot('C:\\Users\\me\\AppData\\Local\\Temp', FB)).toBe('C:\\Users\\me\\AppData\\Local\\Temp')
  })

  it('含中文用户名的路径退回 ASCII 兜底', () => {
    expect(pickTempRoot('C:\\Users\\小明\\AppData\\Local\\Temp', FB)).toBe(FB)
  })

  it('含全角字符也退回兜底', () => {
    expect(pickTempRoot('C:\\用户\\Temp', FB)).toBe(FB)
  })
})

describe('缺陷3：spawn 失败时用户只看到空白失败', () => {
  const bogus = (p: string): EnvReport =>
    ({
      c: { found: true, path: p },
      cpp: { found: true, path: p },
      java: { found: true, path: p },
      python: { found: true, path: p }
    }) as EnvReport

  it('Python 解释器不存在：phase=run，带猫咪 message 且保留原始原因', async () => {
    const r = await runCode({ lang: 'python', code: 'print(1)' }, bogus('miai_no_such_python_exe'))
    expect(r.ok).toBe(false)
    expect(r.phase).toBe('run')
    expect(r.message).toBeTruthy()
    expect(r.message).toContain('喵')
    expect(r.stderr).toContain('ENOENT')
  })

  it('C 编译器不存在：phase=compile，带猫咪 message', async () => {
    const r = await runCode({ lang: 'c', code: 'int main(){return 0;}' }, bogus('miai_no_such_gcc_exe'))
    expect(r.ok).toBe(false)
    expect(r.phase).toBe('compile')
    expect(r.message).toBeTruthy()
    expect(r.message).toContain('喵')
  })

  it('环境缺失（found=false）仍走原有提示，不被 spawn 分支抢走', async () => {
    const r = await runCode(
      { lang: 'python', code: 'print(1)' },
      { c: {}, cpp: {}, java: {}, python: { found: false } } as EnvReport
    )
    expect(r.ok).toBe(false)
    expect(r.message).toContain('还没有找到')
  })
})

describe('killAllLiveChildren：退出前收割还在跑的编译/运行子进程', () => {
  const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  it(
    '在跑的子进程被杀掉（timedOut=false 证明不是超时收的口）',
    async () => {
      const p = runProcess(process.execPath, ['-e', 'setTimeout(()=>{}, 30000)'], {
        cwd: process.cwd(),
        timeoutMs: 60_000
      })
      // 尺子自检：不收割的话它绝不可能在 600ms 内结束 —— 先确认「还在跑」是
      // 可观察状态，否则下面的「收割后结束」可能只是它自己跑完了（假绿）。
      const early = await Promise.race([
        p.then(() => 'done' as const),
        delay(600).then(() => 'running' as const)
      ])
      expect(early).toBe('running')

      killAllLiveChildren()

      const r = await Promise.race([p, delay(5000).then(() => null)])
      expect(r).not.toBeNull() // 没被收割的话 30s 后才结束，这里必为 null
      expect(r!.timedOut).toBe(false) // 不是超时路径收的口 —— 是收割
      expect(r!.exitCode).not.toBe(0) // taskkill /F 的尸检
    },
    15_000
  )

  it('正常跑完的子进程不在册：事后收割不炸、不误伤', async () => {
    const r = await runProcess(process.execPath, ['-e', ''], {
      cwd: process.cwd(),
      timeoutMs: 10_000
    })
    expect(r.exitCode).toBe(0)
    expect(() => killAllLiveChildren()).not.toThrow()
  })
})
