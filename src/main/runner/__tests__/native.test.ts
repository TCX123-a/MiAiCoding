import { spawnSync } from 'child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { detectAll, nativeEnv } from '../../env/detect'
import { RUNNER } from '../../../shared/copy'
import { maskComments } from '../../../shared/__tests__/mask-comments'
import { LANG_OF_CODE, type EnvReport, type LangOfCode, type RunRequest } from '../../../shared/types'
import { mergeEnv, planForLang, runCode, runProcess } from '../runner'
import {
  NATIVE_COMMAND,
  buildCmdLine,
  cmdQuoteArg,
  expandEnv,
  isManagedPath,
  nativeGateReason,
  nativeRunExe,
  probeCommand,
  runCodeNative
} from '../native'

/**
 * 原生编译环境（native.ts）的测试。
 *
 * 【为什么这个文件里一半是「真跑」，而不是全用纯函数断言】
 * 原生模式要交给 **cmd.exe** 去解析那条命令行，而 cmd 的规矩是本仓库里
 * 最不按直觉来的一套：引号怎么剥、元字符在哪儿生效、退出码取哪一个 ——
 * 这些都**只认实测**。纯函数断言只能证明「我们照着自己的理解拼了字符串」，
 * 证明不了 cmd 收到它之后干了什么。所以关键几条一律真起一个 cmd 跑一遍，
 * 而且**配一个必然失败的对照臂**：没有对照的绿，和没跑过是一回事。
 *
 * 【为什么缺编译器那条分支非测不可】
 * 开发机上四门工具链齐活（还有注册表把 PATH 捞回来），
 * 「你 PATH 里没有 gcc」这条路**在开发机上本来永远走不到** ——
 * 而它恰恰是最终用户最可能撞上的那条。所以 `runCodeNative` 的环境块
 * 是**可注入**的（这是设计约束，不是测试便利），这里注入一份「PATH 里什么都没有」
 * 的环境块把它逼出来，并配一条同环境的**对照臂**证明托管链路不受影响。
 */

const report: EnvReport = await detectAll()
const ready = (lang: LangOfCode): boolean => report[lang].found && !!report[lang].path

/** 工具链的探测结果落进日志：跳过 vs 通过，看日志的人要能分清 */
const notReady = LANG_OF_CODE.filter((l) => !ready(l))
if (notReady.length > 0) {
  console.warn(
    `[native] 这些语言没找到工具链，原生模式的「真跑」用例会被跳过：${notReady.join(', ')}。` +
      '⚠️ 跳过 = 没验过。'
  )
}

const COMSPEC = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe'
const SYSTEM_ROOT = process.env.SystemRoot || 'C:\\Windows'
const WHERE = join(SYSTEM_ROOT, 'System32', 'where.exe')

/** 临时夹具都建在这里，跑完一次删干净（**目录名里带空格**，这是故意的：见下面那条用例） */
const fixtureRoot = mkdtempSync(join(tmpdir(), 'miai native test '))
afterAll(() => {
  try {
    rmSync(fixtureRoot, { recursive: true, force: true })
  } catch {
    // 残留交给系统清理
  }
})

/** 真跑要给足余量：C/C++ 要过一遍编译 */
const RUN_TIMEOUT_MS = 60 * 1000

// ──────────────────────────────────────────────────────────── 纯函数：整行怎么拼

describe('命令行拼装（纯函数，规则逐条对照实测）', () => {
  /**
   * 这一张表就是「cmd 的命令行里一个参数要不要加引号」的全部规则。
   *
   * 【为什么空白和元字符都要引号】两者在引号外都会被 cmd 抢先解释掉：
   * 空白会把一个参数拆成两个，`& | < > ^ ( )` 更是直接改变整行的结构
   * （`a&b` 会被当成「先跑 a、再跑 b」）。所以两者一视同仁。
   */
  it.each([
    ['普通命令名', 'gcc', 'gcc'],
    ['普通文件名', 'main.c', 'main.c'],
    ['带 - 的旗标', '-finput-charset=UTF-8', '-finput-charset=UTF-8'],
    ['含空格', 'C:\\Program Files\\x.exe', '"C:\\Program Files\\x.exe"'],
    ['空串', '', '""'],
    ['含引号：引号翻倍', 'say"hi', '"say""hi"'],
    ['含 &', 'a&b', '"a&b"'],
    ['含 |', 'a|b', '"a|b"'],
    ['含 <', 'a<b', '"a<b"'],
    ['含 >', 'a>b', '"a>b"'],
    ['含 ^', 'a^b', '"a^b"'],
    ['含括号', 'a(b)c', '"a(b)c"'],
    ['含 !（/v:off 下是普通字符，不必引）', 'a!b', 'a!b'],
    ['含 $（Java 类名允许，cmd 不特殊）', 'Foo$Bar', 'Foo$Bar']
  ])('%s', (_name, input, want) => {
    expect(cmdQuoteArg(input)).toBe(want)
  })

  it('行首不是引号时，原样拼（多套引号反而会让 cmd 解析成别的东西）', () => {
    expect(buildCmdLine('gcc', ['-o', 'prog.exe', 'main.c'])).toBe('gcc -o prog.exe main.c')
  })

  /**
   * ★ 这条是整套里最容易写错的一处：**行首是引号时必须再套一层外层引号**。
   *
   * cmd /s 会剥掉「行首那一个引号」与「行尾那一个引号」，而参数里带空格时，
   * 行尾那个引号属于某个参数 —— 剥完就成了半句话。套一层之后，
   * cmd 剥掉的正好是我们套的这层。实测（不套外层）报
   * `'C:\...\' 不是内部或外部命令`，而错误信息完全指不到这里。
   */
  it('行首是引号时，再套一层', () => {
    expect(buildCmdLine('C:\\my dir\\x.exe', ['a b'])).toBe('""C:\\my dir\\x.exe" "a b""')
  })
})

/**
 * ★ 不变式：**今天四门语言实际生成出来的行，就是「裸拼」出来的那一串**。
 *
 * 【它有什么用】对 `%` 和换行的说明是「引号救不了，只能保证它们不出现」。
 * 而「不出现」不能靠嘴说 —— 这条用例把四门语言的行**真的拼出来**，
 * 验两件事：
 *   ① 拼的结果 = 命令名和参数用空格直接连起来（说明**没有一个参数需要引号**）；
 *   ② 每个参数里都没有 `%`、没有换行（这两个是引号救不了的那一类）。
 * 哪天有人往这条路上塞了用户填的路径，这里会先红，把人指回 native.ts 文件头。
 *
 * ⚠️ 判据不能写成「整行里没有空白」—— 空白正是参数之间的分隔符，一定会有。
 *    （这条注释是故意的：第一版就是这么写错的，红得莫名其妙。）
 */
describe('今天生成的行就是裸拼（没有参数需要引号，也没有引号救不了的字符）', () => {
  /** 引号救不了的：`%` 会被展开、换行会把一行拆成两条命令 */
  const UNSAFE = /[%\r\n]/

  for (const lang of LANG_OF_CODE) {
    it(`${lang}：编译行与运行行都是裸拼`, () => {
      // Java 的类名是从代码里取的，得给一段**真的**能取出类名的代码
      const code =
        lang === 'java'
          ? 'public class Main { public static void main(String[] a) { } }'
          : 'int main(void) { return 0; }'
      const plan = planForLang(lang, NATIVE_COMMAND[lang], code)
      expect(plan.error, '这段夹具代码本身就不合法的话，下面的检查是空的').toBeUndefined()

      const lines: Array<{ exe: string; args: string[] }> = []
      if (plan.compile) lines.push({ exe: plan.compile.exe, args: plan.compile.args })
      lines.push({ exe: nativeRunExe(lang, plan.run.exe), args: plan.run.args })
      expect(lines.length).toBeGreaterThan(0)

      for (const { exe, args } of lines) {
        const line = buildCmdLine(exe, args)
        expect(line, `这一行里有用到引号，说明参数里有 cmd 会解释的东西：${line}`).toBe(
          [exe, ...args].join(' ')
        )
        for (const tok of [exe, ...args]) {
          expect(tok, `这个参数里有引号救不了的字符：${tok}`).not.toMatch(UNSAFE)
        }
      }
    })
  }

  it('自检：这条判据真的能看见坏值（否则上面四条全是假绿）', () => {
    // 种坏值：换个带空格的命令名，就必须不再是裸拼
    expect(buildCmdLine('C:\\my dir\\gcc.exe', ['main.c'])).not.toBe('C:\\my dir\\gcc.exe main.c')
    // 种坏值：`%` 和换行必须被 UNSAFE 认出来
    expect('main%20.c').toMatch(UNSAFE)
    expect('a\nb').toMatch(UNSAFE)
    expect('main.c').not.toMatch(UNSAFE)
  })
})

// ──────────────────────────────────────────────────────────── 真 cmd 跑一遍（A/B）

/**
 * 这一组用一个 `.bat` 垫片当靶子，验的是「整行交给 cmd 之后，参数有没有原样到达」。
 *
 * 【为什么靶子必须是 .bat，不能是 .exe】两个原因：
 *   · .bat 由 cmd 自己解释，参数原样落在 `%1` 上，输出就是证据；
 *   · 它顺带证明了原生模式的第二个差异是真的：**借真外壳跑，`.bat` 垫片够得着**
 *     （scoop 的 shim、`git.cmd`、venv 的 activate.bat 都是这个形状）。
 *
 * 夹具目录名**故意带空格**（`miai native test XXXXX`）：行首因此是引号，
 * 「外套一层」那条规则当场被行使；参数里也带空格和 `&`。
 */
describe('真 cmd 跑一遍：引号与元字符', () => {
  const shimDir = join(fixtureRoot, 'shim dir')
  const shim = join(shimDir, 'echo-args.bat')

  /**
   * 靶子输出 `["a&b c"]` —— **`%1` 把引号一起带过来了**，这不是我们加的。
   *
   * 实测（2026-09-28）：`echo-args.bat "a&b c"` 印出来的是 `["a&b c"]`，
   * 批处理对 `%1` 的取值**保留引号**。所以断言里必须带引号：
   * 写成 `[a&b c]` 会连正路都红，而红得让人以为是引号规则写错了 ——
   * 真正错的是这条**判据**。下面两个对照臂也用同一个标记，
   * 否则「正路绿、对照臂也绿」就变成了一场自己骗自己。
   */
  const MARK = '["a&b c"]'

  it('准备夹具（写不出来后面全是假绿）', () => {
    mkdirSync(shimDir, { recursive: true })
    writeFileSync(shim, '@echo off\r\necho [%1]\r\n', 'ascii')
    expect(existsSync(shim)).toBe(true)
    // 这条也是 A/B 的一半：这个目录名里必须真有空格
    expect(shimDir).toMatch(/ /)
  })

  it('带空格、带 & 的参数原样到达（正路）', async () => {
    const line = buildCmdLine(shim, ['a&b c'])
    const r = await runProcess(COMSPEC, ['/d', '/v:off', '/s', '/c', line], {
      cwd: fixtureRoot,
      timeoutMs: 15000,
      verbatim: true
    })
    expect(r.spawnError).toBeUndefined()
    expect(r.exitCode, `cmd 退出码非 0，stderr：${r.stderr.toString()}`).toBe(0)
    expect(r.stdout.toString()).toContain(MARK)
    // `&` 没被解释掉：一旦漏了引号，cmd 会去跑一个叫 `b c]` 的命令，stderr 里会有话
    expect(r.stderr.toString().trim()).toBe('')
  })

  it('★ 对照臂：不套外层引号 → 必须失败（证明上一条不是碰巧）', async () => {
    // 只做参数级的引号，不做「行首是引号就再套一层」那一步 —— 也就是那个真实写错过的版本
    const bad = [cmdQuoteArg(shim), cmdQuoteArg('a&b c')].join(' ')
    expect(bad.startsWith('"')).toBe(true)
    const r = await runProcess(COMSPEC, ['/d', '/v:off', '/s', '/c', bad], {
      cwd: fixtureRoot,
      timeoutMs: 15000,
      verbatim: true
    })
    const out = r.stdout.toString() + r.stderr.toString()
    // ★ 先证明这条臂**真的跑起来了**：shell 没起来的话 out 是空的，
    //   下面那句「没有 MARK」会**白捡一个绿**，这条对照臂就成了摆设。
    expect(r.spawnError, `cmd 没起来（${r.spawnError}），这条臂什么都没验到`).toBeUndefined()
    expect(out.trim().length, 'cmd 一声没吭 —— 这不像「引号错了」，像根本没跑到那一步').toBeGreaterThan(0)
    expect(
      out.includes(MARK),
      '不套外层引号竟然也跑对了 —— 那说明这条规矩在本机不成立，得重新实测，别信注释'
    ).toBe(false)
  })

  it('★ 对照臂：不带 windowsVerbatimArguments → 必须失败', async () => {
    // Node 会按 MSVCRT 规则替我们给参数补引号（还带 \"），cmd 收到的是被改过的行。
    // 实测报「文件名、目录名或卷标语法不正确」。
    const line = buildCmdLine(shim, ['a&b c'])
    const r = await runProcess(COMSPEC, ['/d', '/v:off', '/s', '/c', line], {
      cwd: fixtureRoot,
      timeoutMs: 15000
      // verbatim 缺省 = false：这就是那个写错过的版本
    })
    const out = r.stdout.toString() + r.stderr.toString()
    expect(r.spawnError, `cmd 没起来（${r.spawnError}），这条臂什么都没验到`).toBeUndefined()
    expect(out.trim().length, 'cmd 一声没吭 —— 空输出白捡绿，这条臂就白写了').toBeGreaterThan(0)
    expect(out.includes(MARK), '不带 verbatim 竟然也跑对了 —— 同上，回去重新实测').toBe(false)
  })
})

// ──────────────────────────────────────────────────────────── where 预检

describe('where 预检', () => {
  it('真 PATH 里找得到 gcc，给出的路径确实存在', async () => {
    const r = await probeCommand(WHERE, 'gcc', process.env)
    expect(r.broken, 'where.exe 自己起不来，这台机器上后面几条都要打折扣').toBeUndefined()
    expect(r.found).toBe(true)
    expect(existsSync(r.path!)).toBe(true)
  })

  /**
   * ★ 假 PATH：**只把 PATH 换成空目录，别的一律照旧**（SystemRoot / ComSpec / PATHEXT 都在）。
   *
   * 这样「找不到」这个结论只能来自 PATH，不会被别的缺失因素污染 ——
   * 否则下面那条「缺编译器」的用例红了也说不清是哪一件事导致的。
   */
  const emptyDir = join(fixtureRoot, 'empty path')
  const fakeEnv: NodeJS.ProcessEnv = { ...process.env, PATH: emptyDir, Path: emptyDir }

  it('准备夹具', () => {
    mkdirSync(emptyDir, { recursive: true })
    expect(existsSync(emptyDir)).toBe(true)
  })

  it('假 PATH 里找不到（这就是「用户没装/没配 PATH」的形状）', async () => {
    const r = await probeCommand(WHERE, 'gcc', fakeEnv)
    expect(r.broken).toBeUndefined()
    expect(r.found).toBe(false)
  })

  it('where.exe 自己不存在时，报的是「预检坏了」而不是「命令没装」', async () => {
    // 这两件事的修法完全不同（一个去配 PATH、一个修系统），说反了就是把用户引错方向
    const r = await probeCommand(join(fixtureRoot, 'not-here-where.exe'), 'gcc', fakeEnv)
    expect(r.broken, '起不来时必须给出 broken，而不是静默当成「没找到」').toBeTruthy()
    expect(r.found).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────── 缺编译器那条路

describe('原生模式缺编译器：必须失败，而且失败得说清四件事', () => {
  const emptyDir = join(fixtureRoot, 'empty path')
  const fakeEnv: NodeJS.ProcessEnv = { ...process.env, PATH: emptyDir, Path: emptyDir }
  const code = 'int main(void) { return 0; }'

  it.skipIf(!ready('c'))(
    'ok:false + envIssue，一个字都没跑，message 指向「你的 PATH」并给出应用自己找到的那条路',
    async () => {
      const r = await runCodeNative({ lang: 'c', code, timeoutSec: 10 }, report, { env: fakeEnv })

      expect(r.ok).toBe(false)
      expect(r.envIssue, '这条要引导去设置页，envIssue 必须是 true').toBe(true)
      // 什么都没跑：不是「跑了但失败了」
      expect(r.exitCode).toBeNull()
      expect(r.stdout).toBe('')
      expect(r.stderr).toBe('')
      expect(r.timedOut).toBe(false)

      const m = r.message ?? ''
      expect(m, '要说清找的是什么').toContain('gcc')
      expect(m, '要说清是在「你的 PATH」里找的').toContain('PATH')
      expect(m, '要说清自己找到的是哪条路，否则「设置页说装好了、这里说没有」没法解释').toContain(
        report.c.path!
      )
      expect(m, '要给出路：关掉开关').toContain('原生编译环境')
      // 顺带把「这一趟是谁跑的」记下来，界面那一行要用
      expect(r.native?.command).toBe('gcc')
    },
    RUN_TIMEOUT_MS
  )

  it.skipIf(!ready('c'))(
    '★ 对照臂：同一条假 PATH 下，托管链路照样成功（证明假 PATH 只掐掉了原生那条路）',
    async () => {
      const r = await runCode({ lang: 'c', code, timeoutSec: 20 }, report)
      expect(r.ok, `托管链路在假 PATH 下也失败了：\n${r.stderr}`).toBe(true)
      expect(r.exitCode).toBe(0)
    },
    RUN_TIMEOUT_MS
  )
})

// ──────────────────────────────────────────────────────────── 自管工具链的判定

describe('isManagedPath：认出「应用自管工具链」（纯函数，喂假环境块）', () => {
  /**
   * 【为什么必须先展开再比 —— 这是一个已核实的实现坑】
   * `TOOLCHAIN_ROOT` 是**占位符字面量**（`%LOCALAPPDATA%\MiAiBianCheng\toolchain`，
   * 形状由 install-plan.test.ts 钉着），直接拿它去 `startsWith` 一条真实路径
   * **永远匹配不上** —— 而且不报错，只表现为「那句按事实该出现的话永远不出现」。
   * 所以这里的夹具给一份**假环境块**，把 `%LOCALAPPDATA%` 展开成已知值再验。
   */
  const LOCAL = 'C:\\Users\\x\\AppData\\Local'
  const env: NodeJS.ProcessEnv = { LOCALAPPDATA: LOCAL }

  it('★ 真命中：装机时被放进 PATH 的那条 gcc 路径', () => {
    expect(
      isManagedPath(`${LOCAL}\\MiAiBianCheng\\toolchain\\winlibs\\mingw64\\bin\\gcc.exe`, env)
    ).toBe(true)
  })

  it('用户自己装的（Dev-C++ / 别处的 MinGW）不认', () => {
    expect(isManagedPath('C:\\Program Files (x86)\\Dev-Cpp\\MinGW64\\bin\\gcc.exe', env)).toBe(false)
  })

  it('只是前缀像不算数（`toolchain2` 不是 `toolchain` 里面）', () => {
    // 不带分隔符边界的话 `…\toolchain2` 会被 startsWith 放进去 —— 说一句假话
    expect(isManagedPath(`${LOCAL}\\MiAiBianCheng\\toolchain2\\bin\\gcc.exe`, env)).toBe(false)
  })

  it('大小写与斜杠方向都不敏感（Windows 路径的两条老规矩）', () => {
    expect(
      isManagedPath(`${LOCAL.toLowerCase().replace(/\\/g, '/')}/MIAIBIANCHENG/ToolChain/bin/gcc.exe`, env)
    ).toBe(true)
  })

  it('目录本身（没带尾分隔符）也算命中 —— 「带分隔符边界」的另一半', () => {
    expect(isManagedPath(`${LOCAL}\\MiAiBianCheng\\toolchain`, env)).toBe(true)
  })

  it('★ 环境块里缺 LOCALAPPDATA → **不敢认**（宁可少说一句，不说没证据的话）', () => {
    // 展开后还剩 `%`，说明我们根本不知道真实前缀是什么。
    // 这时说「这是自管的」就是一句没有证据的话。**必须给 false**，
    // 不许「猜一个默认前缀」——这台机器的 %LOCALAPPDATA% 是什么，
    // 我们不知道就是不知道。
    expect(isManagedPath(`${LOCAL}\\MiAiBianCheng\\toolchain\\bin\\gcc.exe`, {})).toBe(false)
  })

  it('resolved 缺（where 没问出来）→ false，不是碰运气', () => {
    expect(isManagedPath(undefined, env)).toBe(false)
  })

  it('expandEnv：认得出的换掉，认不出的**原样保留**（调用方靠「还剩 %」判断）', () => {
    expect(expandEnv('%LOCALAPPDATA%\\x', env)).toBe(`${LOCAL}\\x`)
    expect(expandEnv('%NOPE%\\x', env)).toBe('%NOPE%\\x')
    // 环境变量键大小写不敏感（Windows 的规矩；假环境块里写成大写也一样命中）
    expect(expandEnv('%localappdata%\\x', env)).toBe(`${LOCAL}\\x`)
  })
})

// ──────────────────────────────────────────────────────────── 非 0 退出且一言不发

describe('非 0 退出且一个字都没输出：补一句如实的 message，有输出时绝不加', () => {
  /**
   * 【这一节守什么】程序 `return 3;` 而 stdout/stderr 全空时，界面上只剩
   * 「失败」加一片空白 —— 用户完全不知道下一步干嘛。补的那句话必须
   * **只在真的一言不发时**出现：有输出的场合 message 会盖过程序自己的话
   * （那才是第一现场）。两条必须成对 —— 只测一条的话，「永远加 message」
   * 或「永远不加」都能骗过去。
   *
   * 退出码是 cmd 转手的，没法用纯函数造假，所以真起一次 gcc（照本文件的规矩）；
   * 编译器不在的机器上跳过（跳过 = 没验过，日志里有记录）。
   */
  it.skipIf(!ready('c'))(
    '★ 一言不发地失败 → message 是 EXITED_SILENT(退出码)，stdout/stderr 仍为空',
    async () => {
      const r = await runCodeNative(
        { lang: 'c', code: 'int main(void) { return 3; }', timeoutSec: 20 },
        report,
        { env: await nativeEnv() }
      )
      expect(r.ok).toBe(false)
      expect(r.exitCode).toBe(3)
      expect(r.stdout).toBe('')
      expect(r.stderr).toBe('')
      expect(r.message).toBe(RUNNER.EXITED_SILENT(3))
    },
    RUN_TIMEOUT_MS
  )

  it.skipIf(!ready('c'))(
    '★ 对照臂：同样非 0 退出、但**有输出** → message 一个字都不加',
    async () => {
      const r = await runCodeNative(
        {
          lang: 'c',
          code: '#include <stdio.h>\nint main(void) { printf("boom"); return 3; }',
          timeoutSec: 20
        },
        report,
        { env: await nativeEnv() }
      )
      expect(r.ok).toBe(false)
      expect(r.exitCode).toBe(3)
      expect(r.stdout).toContain('boom')
      expect(r.message, '有输出时加 message 会盖过程序自己的话').toBeUndefined()
    },
    RUN_TIMEOUT_MS
  )
})

// ──────────────────────────────────────────────────────────── 真跑：两种模式对照

describe('真跑：原生与托管的 stdout 逐字节相等', () => {
  /**
   * 【为什么「逐字节相等」是硬要求】`codewrite` 大题是**拿 stdout 逐字比对判分**的。
   * 两种模式只要差一个字节（多一个 \r、少一个换行、编码不同），
   * 学员就会撞上「我明明写对了却判错」—— 而这种错**肉眼看输出一模一样**，
   * 极难查。所以这里比对的是 `toBe`，不是 `toContain`。
   *
   * 顺带把 stdin 穿透也验了：`input()` 在 cmd 底下还读不读得到管道，
   * 是最容易漏的一处（真漏了的话，程序会 EOFError 直接失败，上面第一条断言就红）。
   */
  it.skipIf(!ready('python'))(
    'python：连输入一起，两边输出一字不差',
    async () => {
      const req: RunRequest = {
        lang: 'python',
        code: 'name = input()\nprint(f"你好，{name}！")\nprint(6 * 7)\n',
        stdin: '小鱼干\n',
        timeoutSec: 20
      }
      const managed = await runCode(req, report)
      const native = await runCodeNative(req, report, { env: await nativeEnv() })

      expect(managed.ok, `托管模式自己就失败了：\n${managed.stderr}`).toBe(true)
      expect(native.ok, `原生模式失败了：${native.message ?? ''}\n${native.stderr}`).toBe(true)
      expect(native.stdout).toBe(managed.stdout)
      expect(native.stderr).toBe(managed.stderr)

      // 这一趟到底是谁跑的：命令名必须报出来，路径要能拿去和 `where` 对
      expect(native.native?.command).toBe('python')
      expect(native.native?.resolved, 'where 找到了就该报出绝对路径').toBeTruthy()
      expect(existsSync(native.native!.resolved!)).toBe(true)
    },
    RUN_TIMEOUT_MS
  )

  it.skipIf(!ready('c'))(
    'c：编译那一步也换掉了（gcc 由 cmd 按 PATH 解析），输出仍然一字不差',
    async () => {
      // 程序本身打印中文，顺带把「-fexec-charset 有没有生效」一起验了
      const req: RunRequest = {
        lang: 'c',
        code: '#include <stdio.h>\nint main(void) {\n  printf("喵 %d\\n", 42);\n  return 0;\n}\n',
        timeoutSec: 20
      }
      const managed = await runCode(req, report)
      const native = await runCodeNative(req, report, { env: await nativeEnv() })

      expect(managed.ok, `托管模式自己就失败了：\n${managed.stderr}`).toBe(true)
      expect(native.ok, `原生模式失败了：${native.message ?? ''}\n${native.stderr}`).toBe(true)
      expect(native.stdout).toBe(managed.stdout)
      expect(native.stdout).toContain('喵 42')
    },
    RUN_TIMEOUT_MS
  )

  it.skipIf(!ready('python'))(
    '超时只看我们自己的计时器：cmd 不会转发信号，退出码不可信',
    async () => {
      const r = await runCodeNative(
        { lang: 'python', code: 'while True:\n    pass\n', timeoutSec: 1 },
        report,
        { env: await nativeEnv() }
      )
      expect(r.timedOut).toBe(true)
      expect(r.ok).toBe(false)
      expect(r.message).toBe(RUNNER.RUN_TIMEOUT)
    },
    RUN_TIMEOUT_MS
  )
})

// ──────────────────────────────────────────────────────────── nativeRunExe / 闸门 / 环境块

describe('nativeRunExe：产物走 .\\，命令名交给 cmd', () => {
  it('C/C++：编译产物带 .\\ 前缀（不带分隔符的话 CreateProcess 会去 PATH 里找）', () => {
    expect(nativeRunExe('c', 'prog.exe')).toBe('.\\prog.exe')
    expect(nativeRunExe('cpp', 'prog.exe')).toBe('.\\prog.exe')
  })

  it('Java/Python：裸名**原样留着**，由 cmd 按用户 PATH 解析', () => {
    // 这里绝不能复用 resolveExe —— 它会把 java.exe 解析成临时目录里的绝对路径
    expect(nativeRunExe('java', 'java.exe')).toBe('java.exe')
    expect(nativeRunExe('python', 'python')).toBe('python')
  })

  it('Java 的 plan 在原生模式下给的就是裸名（dirname("javac") 是 "."）', () => {
    const plan = planForLang('java', 'javac', 'public class Main { }')
    expect(plan.run.exe).toBe('java.exe')
  })
})

describe('配置闸门：没开开关却带 native:true，一律拒绝', () => {
  it('开关关着 + native:true → 拒绝（旧渲染层 / 手工 IPC 的来路）', () => {
    expect(nativeGateReason(false, true)).not.toBeNull()
  })
  it('开关开着 + native:true → 放行', () => {
    expect(nativeGateReason(true, true)).toBeNull()
  })
  it('不传 / 传 false → 永远放行（这是绝大多数请求走的路）', () => {
    expect(nativeGateReason(false, undefined)).toBeNull()
    expect(nativeGateReason(false, false)).toBeNull()
    expect(nativeGateReason(true, undefined)).toBeNull()
  })
})

describe('nativeEnv：合并 PATH 之后只留一个 path 键', () => {
  it('Path / PATH 两个写法不会同时留下（留两个的话子进程读哪个是未定义的）', async () => {
    const env = await nativeEnv({
      Path: 'C:\\Windows',
      SystemRoot: SYSTEM_ROOT,
      ComSpec: COMSPEC
    } as NodeJS.ProcessEnv)
    const keys = Object.keys(env).filter((k) => k.toLowerCase() === 'path')
    expect(keys).toEqual(['PATH'])
  })

  it('纯加法：进程自己那条 PATH 原样排在前面，一个都不少', async () => {
    const env = await nativeEnv({
      PATH: 'C:\\Windows;C:\\Windows\\System32',
      SystemRoot: SYSTEM_ROOT
    } as NodeJS.ProcessEnv)
    expect(env.PATH!.startsWith('C:\\Windows;C:\\Windows\\System32')).toBe(true)
  })
})

/**
 * ★ 「合并 PATH」这条特性**到底有没有送到子进程手里**。
 *
 * 【为什么非有这一组】`nativeEnv()` 交出一份只有一个 path 键的环境块，看着没问题；
 * 但真正 spawn 的是 `runProcess`，它内部还会 `合并 process.env`。两个键要是
 * 在那一步复活，子进程读到的**很可能是旧 PATH**（先命中的那个），
 * 于是「按注册表合并出来的 PATH 解析命令名」这个原生模式的**第一条差异**
 * 就静默失效了。
 *
 * ⚠️ 而**开发机上它恰好不会失效**：本机 `process.env` 写的正是大写 `PATH`，
 * 合并前后都只有一个键 —— 测试全绿、功能也是好的，看不出任何异常；
 * 换一台写 `Path` 的机器（Windows 自己的环境块常见写法）才会坏。
 * 所以这里**不许拿本机的 process.env 当输入**，得自己造一份写 `Path` 的基线，
 * 把那条「本机碰巧不会走」的路**拽到台面上来**验（红线 16）。
 */
describe('mergeEnv：交给子进程的环境块里，同名不同大小写的键只能剩一个', () => {
  it('基线写 Path、覆盖写 PATH → 结果里只有 PATH，且值是覆盖的那份', () => {
    const merged = mergeEnv({ Path: 'C:\\old', SystemRoot: 'X' }, { PATH: 'C:\\new' })
    expect(Object.keys(merged).filter((k) => k.toLowerCase() === 'path')).toEqual(['PATH'])
    expect(merged.PATH).toBe('C:\\new')
    expect(merged.SystemRoot, '别的不相干的键一个都不许丢').toBe('X')
  })

  it('★ 反过来的写法（基线 PATH、覆盖 Path）也只剩一个 —— 两个方向都要挡住', () => {
    // 只挡一个方向是不够的：`{...base, ...over}` 的产物顺序取决于 base 的写法，
    // 而 base 是 `process.env`、写法由系统决定。两边都验才算真的挡住了。
    const merged = mergeEnv({ PATH: 'C:\\old' }, { Path: 'C:\\new' })
    expect(Object.keys(merged).filter((k) => k.toLowerCase() === 'path')).toEqual(['Path'])
    expect(merged.Path).toBe('C:\\new')
  })

  it('大小写**完全相同**时就是普通覆盖（不会把刚写进去的又删掉）', () => {
    const merged = mergeEnv({ PATH: 'C:\\old' }, { PATH: 'C:\\new' })
    expect(Object.keys(merged).filter((k) => k.toLowerCase() === 'path')).toEqual(['PATH'])
    expect(merged.PATH).toBe('C:\\new')
  })

  it('自检：**裸 spread 会出错** —— 这条判据不是白加的', () => {
    // 种坏值：证明「上面那三条不是废话」。裸 spread 的产物里两个键都在，
    // 而这正是改动前 runProcess 里那一句。
    const bad = { ...{ Path: 'C:\\old' }, PATH: 'C:\\new' }
    expect(Object.keys(bad).filter((k) => k.toLowerCase() === 'path')).toHaveLength(2)
    // 而 mergeEnv 对**同一个输入**只给一个键 —— 差别就是这一句
    expect(
      Object.keys(mergeEnv({ Path: 'C:\\old' }, { PATH: 'C:\\new' })).filter(
        (k) => k.toLowerCase() === 'path'
      )
    ).toHaveLength(1)
  })

  it('托管模式那条路照旧：只传语言自己的那几个键时，进程环境原样保留', () => {
    // 别为了修原生而弄坏托管：托管传进来的是**片段**（Python 的 PYTHONUTF8），
    // 需要合并到进程环境上。这里拿一份可控的基线验「片段是加法、不是替换」。
    const merged = mergeEnv({ Path: 'C:\\sys', TEMP: 'T', PYTHONUTF8: '0' }, { PYTHONUTF8: '1' })
    expect(merged.TEMP).toBe('T')
    expect(merged.PYTHONUTF8, '语言自己的键要盖过外层的同名键').toBe('1')
    expect(merged.Path).toBe('C:\\sys')
  })

  /**
   * ★ 端到端那一下：**子进程真的读到的是哪一份 PATH**。
   *
   * 上面几条验的是 `mergeEnv` 这个纯函数。这一条不看函数、看事实：
   * 起一个真 cmd，让它 `echo %PATH%`，读它亲眼看到的值。
   * 中间任何一环（mergeEnv 的顺序、spawn 的 env 传递、libuv 的环境块构造）
   * 出问题，这里就红 —— 而上面那些纯函数用例照样会是绿的。
   *
   * 【为什么基线要**自己造**、不能直接用 process.env】见上一组的说明：
   * 本机写的是大写 `PATH`，直接拿它当基线的话，两个键根本不会撞上，
   * 这条测试会永远绿着，却什么都没验到。所以这里把基线**改成 `Path` 写法**，
   * 把「换一台机器就会坏」的那条路拽到本机来跑。
   */
  describe('端到端：子进程亲眼看到的 PATH', () => {
    const OLD = 'C:\\definitely-not-the-one'
    /**
     * 让一个**真的子进程**报出它看见的 PATH。
     *
     * `raw` 决定这份 env 是「原样交出去」还是「先过 runProcess」——
     * 两条路测的是两件事：前者测这份对象本身会不会让子进程读错，
     * 后者测我们实际发出去的那条路。混着用就会写出「同一个输入时红时绿」
     * 的臂（第一版就是这么错的）。
     */
    const seenUnder = async (env: NodeJS.ProcessEnv, raw = false): Promise<string> => {
      if (raw) {
        const r = spawnSync(COMSPEC, ['/d', '/v:off', '/s', '/c', 'echo %PATH%'], {
          env,
          encoding: 'utf8'
        })
        return (r.stdout || '').trim()
      }
      const r = await runProcess(COMSPEC, ['/d', '/v:off', '/s', '/c', 'echo %PATH%'], {
        cwd: fixtureRoot,
        timeoutMs: 15000,
        env,
        verbatim: true
      })
      expect(r.spawnError).toBeUndefined()
      return r.stdout.toString().trim()
    }

    /**
     * 造一份基线：除 path 之外照抄进程环境，再用**指定的拼写**放进旧值。
     *
     * ⚠️ 拼写必须能**选**，不能写死。第一版这个夹具把基线写成 `Path`，
     * 然后对照臂又传 `{...base, Path: 新值}` —— 基线上本来就有 `Path` 这个键，
     * spread 只是**原地改掉它**，根本没有制造出「两个拼法撞车」的局面。
     * 于是那条臂什么都没验到（它绿得毫无意义，红也只是因为断言写反了）。
     * 要撞车，基线那个键的拼写必须和覆盖的**不一样**。
     */
    function baseSpelledAs(spelling: string): NodeJS.ProcessEnv {
      const base: NodeJS.ProcessEnv = {}
      for (const k of Object.keys(process.env)) {
        if (k.toLowerCase() !== 'path') base[k] = process.env[k]
      }
      base[spelling] = OLD
      return base
    }

    it('合并后的 PATH 真的送到了子进程（不是被旧的那个顶掉）', async () => {
      // 基线写小写 `Path`（Windows 自己的环境块常见写法），覆盖写大写 `PATH`
      const merged = mergeEnv(baseSpelledAs('Path'), { PATH: fixtureRoot })
      expect(await seenUnder(merged), '子进程看到的是旧 PATH —— 合并那一步白做了').toBe(fixtureRoot)
    })

    it('★ 反面对照：**同一个 env 对象原样交出去**（不过 mergeEnv）→ 覆盖会输', async () => {
      // 这里必须**绕过 runProcess** 直接 spawn。第一版这条臂是走 runProcess 的，
      // 而 runProcess 里已经加了 mergeEnv —— 于是它测的根本不是裸 spread，
      // 红得莫名其妙（同一个输入、走 runProcess 就赢、不走就输）。
      // 要验「拼写决定胜负」这件事，就得把没归一化过的对象**原样**交出去。
      //
      // 前提先摆出来：这个对象里**真的**有两个键，否则下面说明不了任何事。
      const bare = { ...baseSpelledAs('PATH'), Path: fixtureRoot }
      expect(Object.keys(bare).filter((k) => k.toLowerCase() === 'path')).toHaveLength(2)
      expect(
        await seenUnder(bare, true),
        '裸 spread + 小写拼写竟然送对了 —— 那实测结论就变了，回去重新量，别信注释'
      ).toBe(OLD)
    })

    it('★ 同一份「会输」的输入，过了 mergeEnv 就赢 —— 它修的就是这个', async () => {
      // 和上一条**同一个输入**，只多过一道 mergeEnv，再原样交出去。两条并排看，
      // mergeEnv 的作用一目了然；哪天有人觉得它多余，先看这一对。
      const fixed = mergeEnv(baseSpelledAs('PATH'), { Path: fixtureRoot })
      expect(Object.keys(fixed).filter((k) => k.toLowerCase() === 'path')).toEqual(['Path'])
      expect(await seenUnder(fixed, true)).toBe(fixtureRoot)
    })
  })
})

describe('静态闸门：原生模块里不许出现对托管 runCode 的调用', () => {
  const nativeSrc = readFileSync(join(__dirname, '..', 'native.ts'), 'utf8')
  const runnerSrc = readFileSync(join(__dirname, '..', 'runner.ts'), 'utf8')
  /** 调用形状；`runCodeNative(` 不会被它命中（`runCode` 后面直接跟的是 `N`） */
  const CALL = /(?<![\w.])runCode\s*\(/

  it('自检：这条判据能看见真的调用（种坏值：托管那个文件里必须有）', () => {
    // 不看这一条的话，正则写错了会让下面那条永远绿 —— 假绿比不测更糟
    expect(CALL.test(maskComments(runnerSrc))).toBe(true)
    // 顺带确认它不会把 runCodeNative 错认成 runCode
    expect(CALL.test('await runCodeNative(req, report, deps)')).toBe(false)
  })

  it('native.ts 里没有 runCode( —— 这条路上没有「顺手兜回托管模式」的 fallback 位', () => {
    const code = maskComments(nativeSrc)
    expect(code).toContain('runCodeNative') // 扫的是真东西，不是空文件
    expect(
      CALL.test(code),
      'native.ts 里出现了对托管 runCode 的调用：原生失败必须原样报失败（红线 17），静默换回去等于骗用户'
    ).toBe(false)
  })
})

/**
 * 【为什么留这条「用真 cmd 起一次 where」的冒烟】
 * 上面 probeCommand 的三条足以覆盖分支，但它们都走我们自己写的 spawn 参数。
 * 这一条直接问本机 `cmd /c where gcc`，把「本机确实有这个命令」这件事
 * 钉在**独立于我们代码**的一条路径上 —— 真跑那条用例万一红了，
 * 看日志的人能立刻分清是「机器上真没有」还是「我们的代码坏了」。
 */
describe('冒烟：本机的 where 认得 gcc', () => {
  it.skipIf(!ready('c'))('cmd /c where gcc 有输出', () => {
    const r = spawnSync(COMSPEC, ['/d', '/v:off', '/c', 'where gcc'], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout.trim().length).toBeGreaterThan(0)
  })

  it('同一条命令换成一个不存在的名字时，退出码是 1（**不是 9009**，别再照抄那个传说）', () => {
    const r = spawnSync(COMSPEC, ['/d', '/v:off', '/c', `where miai-no-such-cmd-${Date.now()}`], {
      encoding: 'utf8'
    })
    expect(r.status).toBe(1)
  })
})

/**
 * 【为什么单独再起一次「带空格路径的可执行文件」】
 * `probeCommand` 那条路（where.exe 的绝对路径）本身就可能带空格 ——
 * 而 argv[0] 带空格时 spawn 能不能起得来，是另一条独立的规矩（libuv 自己那层引号）。
 * 这一条把 where.exe 复制到一个带空格的目录真跑一次，把这件事钉住：
 * 哪天它坏了，症状会是「预检恒返回 broken」，而不是明显的报错。
 */
describe('带空格路径的可执行文件真跑', () => {
  it('把 where.exe 复制到带空格的目录，它照样起得来', async () => {
    const dir = join(fixtureRoot, 'exe dir')
    mkdirSync(dir, { recursive: true })
    const exe = join(dir, 'my where.exe')
    copyFileSync(WHERE, exe)

    // 参数给 cmd：where 会去 PATH 里找它并打印位置
    const line = buildCmdLine(exe, ['cmd'])
    const r = await runProcess(COMSPEC, ['/d', '/v:off', '/s', '/c', line], {
      cwd: fixtureRoot,
      timeoutMs: 15000,
      verbatim: true
    })
    expect(r.exitCode, `起不来：${r.stderr.toString()}`).toBe(0)
    expect(r.stdout.toString().toLowerCase()).toContain('cmd.exe')
  })
})
