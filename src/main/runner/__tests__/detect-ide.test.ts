/**
 * IDE 自动探测（main/runner/detect-ide.ts）的测试。
 *
 * 【这个文件在守什么】探测跑在**别人的电脑上**，它坏掉的方式全是静默的：
 *   · 「一台都没装」和「根本没查成」混成一句话 → 用户拿着「没找到」
 *     去重装一个明明装着的 IDE（反过来也一样：探测崩了却说「你没装」）；
 *   · 快捷方式**按名字**筛 → 开始菜单里的 `Uninstall Dev-C++.lnk`、
 *     `License.lnk` 这类陷阱全被当成 IDE（本机实测真的有这两个）；
 *   · 注册表输出是 **GBK** 解码 → 中文用户名/中文路径变成乱码、路径对不上、
 *     静默少一条候选；
 *   · 某个 .lnk 解不开就整个扫描中断 → 一台装着 IDE 的电脑被告知「没找到」。
 * 全都不会崩，只会给错答案 —— 全靠这里钉住。
 *
 * 【为什么全程注入假的电脑】真扫本机的话，「装了 Dev-C++ 的开发机绿、
 * 机房电脑红」——测试结果开始取决于跑测试的机器上装了什么，正是
 * 「开发机上的绿是假的」那条教训。这里的三层输入（路径表 / 快捷方式 /
 * reg 输出）全部是假数据，任何一台机器上跑都必须一模一样。
 */
import { describe, expect, it } from 'vitest'
import { detectIdes, type IdeDetectOverrides } from '../detect-ide'

// ---------------------------------------------------------------- 假电脑

/** 一台假机器的四个"事实来源"，逐条注入（缺省 = 那一样不存在） */
interface FakePC {
  /** 存在的文件（大小写不敏感，照 Windows 的规矩） */
  files?: string[]
  /** 目录树：目录 → 直接子项 */
  dirs?: Record<string, Array<{ name: string; isDir: boolean }>>
  /** .lnk → target。没登记的解不开（抛） */
  shortcuts?: Record<string, string>
  /** 登记的这些 .lnk 解不开（损坏快捷方式的模拟） */
  brokenLnks?: string[]
  /** reg query 的应答；缺省 = 什么都查不到（ok:false） */
  reg?: (args: string[]) => { ok: boolean; stdout: Buffer; stderr: Buffer }
}

const ENV: Record<string, string | undefined> = {
  ProgramFiles: 'C:\\PF',
  'ProgramFiles(x86)': 'C:\\PF86',
  LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
  APPDATA: 'C:\\Users\\u\\AppData\\Roaming',
  USERPROFILE: 'C:\\Users\\u',
  PUBLIC: 'C:\\Users\\Public',
  ProgramData: 'C:\\ProgramData'
}

function fakePC(pc: FakePC): IdeDetectOverrides {
  // 目录也是「存在的东西」：dirs 里登记过的目录一并算 —— 不这么做的话，
  // 快捷方式扫描在「根目录还不存在」这一步就静默跳过了，
  // 下面那些用例会绿得毫无意义（测的是「根不存在」，不是「扫描逻辑」）。
  const present = new Set(
    [...(pc.files ?? []), ...Object.keys(pc.dirs ?? {})].map((p) => p.toLowerCase())
  )
  return {
    env: ENV,
    exists: (p) => present.has(p.toLowerCase()),
    listDir: (d) => {
      const e = pc.dirs?.[d]
      if (!e) throw new Error(`ENOENT: ${d}`)
      return e
    },
    readShortcut: (lnk) => {
      if (pc.brokenLnks?.includes(lnk)) throw new Error('bad shortcut')
      const t = pc.shortcuts?.[lnk]
      if (t === undefined) throw new Error(`no such lnk: ${lnk}`)
      return t
    },
    runReg: async (args) => pc.reg?.(args) ?? { ok: false, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
  }
}

const DEVC = 'C:\\PF86\\Dev-Cpp\\devcpp.exe'
const CODE = 'C:\\Users\\u\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe'
/**
 * 装在 D 盘、又不在任何已知位置表里的 Dev-C++ —— **快捷方式层与注册表层
 * 的用例都用它**：路径必须避开 KNOWN_PATHS 那几条，否则第①层先命中、
 * 去重后 source 变成 'known'，等于这两层根本没被测到。
 */
const DEVC_ODD = 'D:\\Tools\\Dev-Cpp\\devcpp.exe'

/** 常见路径（只要文件存在就命中） */
function onlyKnownFiles(...paths: string[]): IdeDetectOverrides {
  return fakePC({ files: paths })
}

// ---------------------------------------------------------------- 「一台都没装」

describe('一台都没装', () => {
  it('★ ok:true + 空表 —— 「真没有」**不是失败**（下一步是引导手动选）', async () => {
    // 这是最重要的一档：把「没有」说成「出错」的话，用户会以为多试几次能出来；
    // 而把「出错」说成「没有」（见下面 failed 那条）会让他去重装。
    const r = await detectIdes(fakePC({}))
    expect(r).toEqual({ ok: true, candidates: [] })
  })
})

// ---------------------------------------------------------------- ① 常见路径

describe('① 常见安装路径', () => {
  it('Dev-C++ 在默认位置 → 产品名从白名单取（不是从文件名猜的）', async () => {
    const r = await detectIdes(onlyKnownFiles(DEVC))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.candidates).toEqual([{ path: DEVC, name: 'Dev-C++', source: 'known' }])
  })

  it('VS Code 的 per-user 安装位置（%LOCALAPPDATA%）展开正确', async () => {
    const r = await detectIdes(onlyKnownFiles(CODE))
    if (!r.ok) return
    expect(r.candidates).toEqual([{ path: CODE, name: 'Visual Studio Code', source: 'known' }])
  })

  it('目录名带版本号的（JetBrains 风格）走通配：PyCharm 2024.1 也找得到', async () => {
    const exe = 'C:\\PF\\JetBrains\\PyCharm 2024.1\\bin\\pycharm64.exe'
    const r = await detectIdes(
      fakePC({
        // ⚠️ 通配展开是**逐段**查存在的（照 expandGlob 的算法）：中间每一层
        // 目录也要算「存在」，只放 exe 一条的话会在第一段就被过滤掉
        files: ['C:\\PF', 'C:\\PF\\JetBrains', 'C:\\PF\\JetBrains\\PyCharm 2024.1', 'C:\\PF\\JetBrains\\PyCharm 2024.1\\bin', exe],
        dirs: { 'C:\\PF\\JetBrains': [{ name: 'PyCharm 2024.1', isDir: true }] }
      })
    )
    if (!r.ok) return
    // 通配展开出的完整链路每一段都得存在：bin 目录、pycharm64.exe 本体
    expect(r.candidates.some((c) => c.path === exe && c.name === 'PyCharm')).toBe(true)
  })

  it('环境变量认不出 → 那条路径作废，**不猜别的目录**', async () => {
    const deps = fakePC({ files: [DEVC] })
    deps.env = { ...ENV, 'ProgramFiles(x86)': undefined }
    const r = await detectIdes(deps)
    if (!r.ok) return
    expect(r.candidates).toEqual([])
  })
})

// ---------------------------------------------------------------- ② 快捷方式

describe('② 开始菜单 / 桌面快捷方式', () => {
  const START = `${ENV.APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs`

  it('★ 按 **target** 过滤，不按快捷方式的名字 —— 真 IDE 哪怕名字是「新建快捷方式」也认', async () => {
    // 反向陷阱同场加映：名字里带 "Dev-C++" 但 target 是卸载器的，**不许**算 IDE。
    // 本机开始菜单实测就躺着 Uninstall Dev-C++.lnk —— 按名字筛必踩。
    const r = await detectIdes(
      fakePC({
        files: [DEVC_ODD],
        dirs: { [START]: [{ name: '新建快捷方式.lnk', isDir: false }, { name: 'Uninstall Dev-C++.lnk', isDir: false }] },
        shortcuts: {
          [`${START}\\新建快捷方式.lnk`]: DEVC_ODD,
          [`${START}\\Uninstall Dev-C++.lnk`]: 'D:\\Tools\\Dev-Cpp\\unins000.exe'
        }
      })
    )
    if (!r.ok) return
    expect(r.candidates).toEqual([{ path: DEVC_ODD, name: 'Dev-C++', source: 'shortcut' }])
  })

  it('target 不在白名单（License.lnk → .txt）→ 不算数', async () => {
    const r = await detectIdes(
      fakePC({
        files: ['C:\\PF86\\Dev-Cpp\\License.txt'],
        dirs: { [START]: [{ name: 'License.lnk', isDir: false }] },
        shortcuts: { [`${START}\\License.lnk`]: 'C:\\PF86\\Dev-Cpp\\License.txt' }
      })
    )
    if (!r.ok) return
    expect(r.candidates).toEqual([])
  })

  it('target 已经不在（程序卸载过、快捷方式还在）→ 不算数', async () => {
    const r = await detectIdes(
      fakePC({
        files: [],
        dirs: { [START]: [{ name: 'Dev-C++.lnk', isDir: false }] },
        shortcuts: { [`${START}\\Dev-C++.lnk`]: DEVC }
      })
    )
    if (!r.ok) return
    expect(r.candidates).toEqual([])
  })

  it('一条解不开的 .lnk 不许拖垮整次扫描（后面的照样找）', async () => {
    const lnkOk = `${START}\\ok.lnk`
    const lnkBad = `${START}\\broken.lnk`
    const r = await detectIdes(
      fakePC({
        files: [DEVC_ODD],
        dirs: { [START]: [{ name: 'broken.lnk', isDir: false }, { name: 'ok.lnk', isDir: false }] },
        shortcuts: { [lnkOk]: DEVC_ODD },
        brokenLnks: [lnkBad]
      })
    )
    if (!r.ok) return
    expect(r.candidates.map((c) => c.path)).toEqual([DEVC_ODD])
  })

  it('target 里带 %VAR%（安装器写死环境变量的那种）→ 展开后再复核', async () => {
    const odd = `${ENV.LOCALAPPDATA}\\DVCpp\\devcpp.exe`
    const r = await detectIdes(
      fakePC({
        files: [odd],
        dirs: { [START]: [{ name: 'D.lnk', isDir: false }] },
        shortcuts: { [`${START}\\D.lnk`]: '%LOCALAPPDATA%\\DVCpp\\devcpp.exe' }
      })
    )
    if (!r.ok) return
    expect(r.candidates).toEqual([{ path: odd, name: 'Dev-C++', source: 'shortcut' }])
  })

  it('多层子目录里的 .lnk 也翻得到（开始菜单就是一棵树）', async () => {
    const d1 = `${START}\\JetBrains`
    const d2 = `${d1}\\PyCharm`
    const exe = 'C:\\PF\\JetBrains\\PyCharm 2024.1\\bin\\pycharm64.exe'
    const r = await detectIdes(
      fakePC({
        files: [exe],
        dirs: {
          [START]: [{ name: 'JetBrains', isDir: true }],
          [d1]: [{ name: 'PyCharm', isDir: true }],
          [d2]: [{ name: 'PyCharm.lnk', isDir: false }]
        },
        shortcuts: { [`${d2}\\PyCharm.lnk`]: exe }
      })
    )
    if (!r.ok) return
    expect(r.candidates.some((c) => c.path === exe)).toBe(true)
  })
})

// ---------------------------------------------------------------- ③ 注册表 App Paths

describe('③ 注册表 App Paths', () => {
  const dumpLine = (name: string): string =>
    `HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${name}`

  it('key 在白名单 + 默认值指向真文件（带引号）→ 命中，**引号要剥掉**', async () => {
    const r = await detectIdes(
      fakePC({
        files: [DEVC_ODD],
        reg: (args) => {
          if (args.includes('/s')) return { ok: true, stdout: Buffer.from(dumpLine('devcpp.exe'), 'utf8'), stderr: Buffer.alloc(0) }
          if (args.includes('/ve')) {
            return { ok: true, stdout: Buffer.from(`    (Default)    REG_SZ    "${DEVC_ODD}"`, 'utf8'), stderr: Buffer.alloc(0) }
          }
          return { ok: false, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
        }
      })
    )
    if (!r.ok) return
    expect(r.candidates).toEqual([{ path: DEVC_ODD, name: 'Dev-C++', source: 'registry' }])
  })

  it('★ GBK 的 reg 输出解得回来（中文 Windows 的「(默认)」+ 中文路径）', async () => {
    // reg 的 stdout 走控制台代码页（中文系统 = GBK）。不解码的话：
    // 值名成了乱码（无所谓，按结构解）、**中文路径成了乱码**（致命 —— 路径对不上、静默少一条）。
    // '默'=C4 AC、'认'=C8 CF、'工具'=B9 A4 BE DF（照 foreign-pc.test.ts 的实测字节）。
    const cnExe = 'C:\\工具\\devcpp.exe'
    // ⚠️ 路径部分也必须用 **GBK 字节**：真 reg 的 stdout 整条都是控制台编码。
    // 夹具混用 UTF-8 的话（这个用例第一版就是这么红的），decodeConsole 会因
    // 「(默认)」的 GBK 字节触发整体 GBK 回退，把 UTF-8 的「工具」解成乱码
    // → 路径对不上 → 静默少一条候选，测出来的红指向实现，真凶却在夹具。
    const ve = Buffer.concat([
      Buffer.from('    (', 'utf8'),
      Buffer.from([0xc4, 0xac, 0xc8, 0xcf]), // 默认
      Buffer.from(')    REG_SZ    C:\\', 'utf8'),
      Buffer.from([0xb9, 0xa4, 0xbe, 0xdf]), // 工具
      Buffer.from('\\devcpp.exe', 'utf8')
    ])
    const r = await detectIdes(
      fakePC({
        files: [cnExe],
        reg: (args) =>
          args.includes('/s')
            ? { ok: true, stdout: Buffer.from(dumpLine('devcpp.exe'), 'utf8'), stderr: Buffer.alloc(0) }
            : { ok: true, stdout: ve, stderr: Buffer.alloc(0) }
      })
    )
    if (!r.ok) return
    expect(r.candidates).toEqual([{ path: cnExe, name: 'Dev-C++', source: 'registry' }])
  })

  it('key 不在白名单 → 连 /ve 都不查（白名单先过滤，省一趟进程）', async () => {
    const calls: string[][] = []
    const r = await detectIdes(
      fakePC({
        files: ['C:\\X\\AcroRd32.exe'],
        reg: (args) => {
          calls.push(args)
          return { ok: true, stdout: Buffer.from(dumpLine('AcroRd32.exe'), 'utf8'), stderr: Buffer.alloc(0) }
        }
      })
    )
    if (!r.ok) return
    expect(r.candidates).toEqual([])
    expect(calls.every((a) => a.includes('/s'))).toBe(true)
  })

  it('REG_EXPAND_SZ 的 %VAR% 会展开', async () => {
    const r = await detectIdes(
      fakePC({
        files: [DEVC_ODD],
        reg: (args) =>
          args.includes('/s')
            ? { ok: true, stdout: Buffer.from(dumpLine('devcpp.exe'), 'utf8'), stderr: Buffer.alloc(0) }
            : { ok: true, stdout: Buffer.from(`    (Default)    REG_EXPAND_SZ    %MIAI_ODD_DRIVE%\\Dev-Cpp\\devcpp.exe`, 'utf8'), stderr: Buffer.alloc(0) }
      })
    )
    if (!r.ok) return
    // ENV 里没有 MIAI_ODD_DRIVE → 展开失败（空串）→ 路径作废。这正是
    // expandEnvVars「认不出替换成 ''」的语义：宁可不要，也不猜。
    expect(r.candidates).toEqual([])
  })

  it('REG_EXPAND_SZ 认得出的变量 → 展开后命中', async () => {
    const odd = `${ENV.LOCALAPPDATA}\\DVCpp\\devcpp.exe`
    const r = await detectIdes(
      fakePC({
        files: [odd],
        reg: (args) =>
          args.includes('/s')
            ? { ok: true, stdout: Buffer.from(dumpLine('devcpp.exe'), 'utf8'), stderr: Buffer.alloc(0) }
            : { ok: true, stdout: Buffer.from(`    (Default)    REG_EXPAND_SZ    %LOCALAPPDATA%\\DVCpp\\devcpp.exe`, 'utf8'), stderr: Buffer.alloc(0) }
      })
    )
    if (!r.ok) return
    expect(r.candidates).toEqual([{ path: odd, name: 'Dev-C++', source: 'registry' }])
  })

  it('/ve 查不到（键在但没默认值）→ 跳过，不误报', async () => {
    const r = await detectIdes(
      fakePC({
        files: [DEVC_ODD],
        reg: (args) =>
          args.includes('/s')
            ? { ok: true, stdout: Buffer.from(dumpLine('devcpp.exe'), 'utf8'), stderr: Buffer.alloc(0) }
            : { ok: false, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
      })
    )
    if (!r.ok) return
    expect(r.candidates).toEqual([])
  })

  it('dump 本身失败（键不存在）→ 静默跳过这一层，其余层照常', async () => {
    const r = await detectIdes(
      fakePC({
        files: [DEVC],
        reg: () => ({ ok: false, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) })
      })
    )
    if (!r.ok) return
    expect(r.candidates.map((c) => c.source)).toEqual(['known'])
  })
})

// ---------------------------------------------------------------- 层与层的合成

describe('三层合成', () => {
  it('同一个 exe 被两层找到 → 只留一条，**先到的层赢**', async () => {
    const START = `${ENV.APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs`
    const r = await detectIdes(
      fakePC({
        files: [DEVC],
        dirs: { [START]: [{ name: 'Dev-C++.lnk', isDir: false }] },
        shortcuts: { [`${START}\\Dev-C++.lnk`]: DEVC }
      })
    )
    if (!r.ok) return
    expect(r.candidates).toEqual([{ path: DEVC, name: 'Dev-C++', source: 'known' }])
  })

  it('装了两样（Dev-C++ + VS Code）→ 两条都给出来，交给用户选', async () => {
    const r = await detectIdes(onlyKnownFiles(DEVC, CODE))
    if (!r.ok) return
    expect(r.candidates.map((c) => c.name)).toEqual(['Dev-C++', 'Visual Studio Code'])
  })

  it('★ 没预料到的岔子（注入的依赖直接炸）→ failed，**不许冒充「没找到」**', async () => {
    // 「没找到」的下一步是手动选/算了；「没查成」的下一步是重试。
    // 混用的话，探测崩了却说「你没装」—— 用户会去重装一个明明装着的 IDE。
    const deps = fakePC({})
    deps.exists = () => {
      throw new Error('boom')
    }
    const r = await detectIdes(deps)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('failed')
      expect(r.detail).toContain('boom')
    }
  })

  it('runReg **拒绝**（reject）→ 只丢注册表这一层，不冒异常', async () => {
    const deps = fakePC({ files: [DEVC] })
    deps.runReg = () => Promise.reject(new Error('reg gone'))
    const r = await detectIdes(deps)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.candidates.map((c) => c.source)).toEqual(['known'])
  })
})
