/**
 * 本地 IDE 联动与代码导出（main/runner/native-ide.ts）的测试。
 *
 * 【这个文件在守什么】
 * 这个模块干两件事：把代码写成临时文件、用**用户自己配的**程序打开它。
 * 它坏掉的方式全是**静默**的：
 *   · 未配置 / 路径失效 不区分 → 用户拿着「打开失败」四个字不知道下一步该干嘛
 *     （「没配」的下一步是去设置页，「配错了」的下一步是换路径）；
 *   · spawn 的 'error' 被吞成成功 → 点了按钮、什么都没发生、也没有一句人话
 *     （「不许默认回退为成功」红线）；
 *   · 文件名和运行路径不同源 → 同一个程序在「运行」里叫 main.cpp、
 *     在 IDE 里叫别的名字，将来两处规则漂移没人发现；
 *   · **写盘编码跟错了对象**（v9 的核心行为）→ 同一段代码在这个 IDE 里正常、
 *     在那个 IDE 里乱码，而两边都"没报错"。旧版按**语言**定编码（c/cpp→GBK、
 *     java/python→UTF-8），主人验收时实测就是「Dev-C++ 打开 java 乱、VS Code
 *     打开 c 乱」。v9 起编码跟随**目标程序**，下面专门一组对照臂钉住方向。
 * 这四条都不会崩，全靠这里钉住。
 *
 * 【为什么 spawn 必须注入】
 * 「进程创建失败」这条分支（ENOENT / EACCES）在开发机上很难真复现 ——
 * 而它恰恰是用户最可能撞上的那条。注入一个假的 spawn 把它逼出来，
 * 并配一条『同一个假 spawn 发 'spawn' 事件』的对照臂：没有对照的绿，
 * 和没跑过是一回事。
 *
 * 【为什么不真起一个 notepad】
 * 真起进程的话，「起没起来」在 CI 上变成了环境问题，而且会弹窗。
 * 这里测的是**我们对 spawn 的用法**（参数、事件、unref），不是 node 的 spawn 本身
 * —— 后者是 node 的事。路径存在性用真实存在的文件去喂：要么 `process.execPath`，
 * 要么 `fakeExe()` 现造的**空文件**（名字对就行 —— 编码判定只认 exe 名，
 * spawn 是假的，不会真跑它）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import iconv from 'iconv-lite'
import { afterAll, describe, expect, it } from 'vitest'
import { exportCodeToFile, openInNativeIde, writeCodeToFile, type IdeChildLike, type IdeSpawn } from '../native-ide'
import { DEFAULT_APP_CONFIG, type AppConfig, type LangOfCode } from '../../../shared/types'

/** 一份可改的配置夹具：照生产默认值起步，把**某一门语言**的路径改成 path（v9 四键表） */
function configWithIde(lang: LangOfCode, path: string): AppConfig {
  const c = structuredClone(DEFAULT_APP_CONFIG)
  c.nativeIdePaths[lang] = path
  return c
}

/** 测试建的临时目录，跑完全删（**模块自己故意不清** —— IDE 异步读文件，见文件抬头） */
const createdDirs: string[] = []
afterAll(() => {
  for (const dir of createdDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // 残留交给系统清理
    }
  }
})

/**
 * 造一个**真实存在**的假 exe：编码判定只读它的**文件名**（`ideNameOf`），
 * spawn 是假的不会真执行它，所以一个同名的空文件就够了。比去碰机主的
 * 真 Dev-C++ / VS Code 安全（那些路径在别的机器上不一定存在，测试会假红）。
 */
function fakeExe(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'miai-fake-ide-'))
  createdDirs.push(dir)
  const p = join(dir, name)
  writeFileSync(p, '')
  return p
}

/**
 * 假 spawn：记下每次调用，并按 `outcome` 异步发 'spawn' 或 'error' 事件。
 *
 * ⚠️ 事件**必须异步发**：真 spawn 的事件永远不会在 `spawn()` 调用的同一个
 * tick 里到达，而 `openInNativeIde` 是在 spawn 返回**之后**才挂监听 ——
 * 同步发事件的话一个监听都收不到，测试会吊死在 await 上（不是红，是挂）。
 */
function fakeSpawn(outcome: 'spawn' | 'error', err = new Error('spawn ENOENT')) {
  const calls: { exe: string; args: string[]; opts: Parameters<IdeSpawn>[2] }[] = []
  const onSpawn: Array<() => void> = []
  const onError: Array<(e: Error) => void> = []
  let unrefCount = 0

  const spawnImpl: IdeSpawn = (exe, args, opts) => {
    calls.push({ exe, args, opts })
    queueMicrotask(() => {
      if (outcome === 'spawn') for (const f of onSpawn) f()
      else for (const f of onError) f(err)
    })
    const child: IdeChildLike = {
      once: (event: 'spawn' | 'error', listener: ((e: Error) => void) | (() => void)) => {
        // 两个重载在实现里合成一个联合签名，按事件名分派回各自的队列
        if (event === 'spawn') onSpawn.push(listener as () => void)
        else onError.push(listener as (e: Error) => void)
        return child
      },
      unref: () => {
        unrefCount += 1
      }
    }
    return child
  }

  return { spawnImpl, calls, unrefs: () => unrefCount }
}

// ──────────────────────────────────────────────────────────── writeCodeToFile：文件名与落盘

describe('writeCodeToFile：文件名和运行路径同源', () => {
  // 命名与编码无关，这一组统一给 'utf8'；编码行为在下面另有一组专门的用例。
  it.each([
    ['c', 'int main() { return 0; }', 'main.c'],
    ['cpp', 'int main() { return 0; }', 'main.cpp'],
    ['python', 'print(1)', 'main.py']
  ] as const)('%s → %s', (lang, code, want) => {
    const written = writeCodeToFile(lang, code, 'utf8')!
    createdDirs.push(written.dir)
    expect(written.file).toBe(join(written.dir, want))
  })

  it('java → **类名**.java（public class 优先）', () => {
    const written = writeCodeToFile('java', 'public class Foo { }', 'utf8')!
    createdDirs.push(written.dir)
    expect(written.file).toBe(join(written.dir, 'Foo.java'))
  })

  it('java 没有 public 时退回任意 class 名（和运行路径同一条判定）', () => {
    const written = writeCodeToFile('java', 'class Bar { }', 'utf8')!
    createdDirs.push(written.dir)
    expect(written.file).toBe(join(written.dir, 'Bar.java'))
  })

  it('★ java 找不到类名 → **null**（不是「写一个 Main.java 凑合」）', () => {
    // 凑合的话，IDE 里打开的是 Foo 内容、文件却叫 Main.java，javac 直接报
    // 「class Foo is public, should be declared in Foo.java」—— 而用户根本没动手。
    expect(writeCodeToFile('java', 'int x = 1;', 'utf8')).toBe(null)
  })

  it("'gbk' → 落盘字节确实是 GBK（中文注释在 Dev-C++ 里不再是「浣犲ソ」乱码）", () => {
    // 先反证"不是 UTF-8"（同样内容若写 UTF-8 会逐字节相等），再正证 GBK 解码还原。
    const code = 'int main() { /* 中文注释 */ return 0; }'
    const written = writeCodeToFile('c', code, 'gbk')!
    createdDirs.push(written.dir)
    const raw = readFileSync(written.file)
    expect(raw.equals(Buffer.from(code, 'utf8')), '又写回 UTF-8 了？').toBe(false)
    expect(iconv.decode(raw, 'gbk')).toBe(code)
  })

  it("'utf8' → 即便传的是 c 语言也按 UTF-8 落盘（编码跟参数，不跟语言）", () => {
    // 旧版「c 一律 GBK」的规矩已经收进调用方（encodingForIdePath 的回退），
    // 这一层只认参数 —— 不然「Dev-C++ 是 GBK 所以 c 是 GBK」这种语言
    // 分支会从这里长回来，把 v9 的修复悄悄掀掉。
    const code = 'int main() { /* 中文 */ return 0; }'
    const written = writeCodeToFile('c', code, 'utf8')!
    createdDirs.push(written.dir)
    expect(readFileSync(written.file, 'utf8')).toBe(code)
  })

  it('★ GBK 编不出的字符（emoji）→ **整文件退回 UTF-8**，绝不静默替换成 ?', () => {
    // iconv 对编不出的字符默认替换成 '?' —— 那是**改学员的代码**。
    // 往返校验发现编不回来就整文件退回 UTF-8：在 Dev-C++ 里中文会乱，
    // 但内容是完整的（宁可乱，不许丢）。
    const code = 'int main() { /* 🐟 */ return 0; }'
    const written = writeCodeToFile('c', code, 'gbk')!
    createdDirs.push(written.dir)
    expect(readFileSync(written.file).equals(Buffer.from(code, 'utf8'))).toBe(true)
  })

  it('每次调用一个**全新**目录（两次导出不互相覆盖）', () => {
    const a = writeCodeToFile('c', 'a', 'utf8')!
    const b = writeCodeToFile('c', 'b', 'utf8')!
    createdDirs.push(a.dir, b.dir)
    expect(a.dir).not.toBe(b.dir)
    expect(readFileSync(a.file, 'utf8')).toBe('a')
    expect(readFileSync(b.file, 'utf8')).toBe('b')
  })
})

// ──────────────────────────────────────────────────────────── openInNativeIde：三段失败各归各的

describe('openInNativeIde：不是每种失败都叫「失败」', () => {
  it('没配路径（空串）→ **unconfigured**，而且一个进程都不起', async () => {
    const fake = fakeSpawn('spawn')
    const r = await openInNativeIde('c', 'int main(){}', {
      readConfig: () => configWithIde('c', ''),
      spawn: fake.spawnImpl
    })
    expect(r).toEqual({ ok: false, reason: 'unconfigured' })
    expect(fake.calls).toHaveLength(0)
  })

  it('全是空白的路径也算没配（trim 过再判）', async () => {
    const fake = fakeSpawn('spawn')
    const r = await openInNativeIde('c', 'int main(){}', {
      readConfig: () => configWithIde('c', '   \t '),
      spawn: fake.spawnImpl
    })
    expect(r).toEqual({ ok: false, reason: 'unconfigured' })
    expect(fake.calls).toHaveLength(0)
  })

  it('★ 配了但文件不在 → **missing**（不是 failed）—— 两种的下一步不一样', async () => {
    // 「没配」的下一步是去设置页填一个，「配错了」的下一步是换一个路径。
    // 混成一种的话，用户拿着同一句「打开失败」不知道该往哪儿走。
    const fake = fakeSpawn('spawn')
    // 确定性构造一个不存在的路径（真跑一遍 existsSync 的对照见下一条用例）
    const ghost = join(process.cwd(), '__miai_no_such_ide__.exe')
    expect(existsSync(ghost), '前提：这个路径必须真的不存在').toBe(false)
    const r = await openInNativeIde('c', 'int main(){}', {
      readConfig: () => configWithIde('c', ghost),
      spawn: fake.spawnImpl
    })
    expect(r).toEqual({ ok: false, reason: 'missing', detail: ghost })
    expect(fake.calls).toHaveLength(0)
  })

  it('★ 配置**每次现读** —— 用户在设置页改完路径，下一次点击就走新的', async () => {
    // 吃快照的话，用户改完路径得重启应用才生效，而他多半会认为是「新路径也不对」。
    let path = ''
    const fake = fakeSpawn('spawn')
    const deps = { readConfig: () => configWithIde('c', path), spawn: fake.spawnImpl }

    expect((await openInNativeIde('c', 'int main(){}', deps)).ok).toBe(false)
    path = process.execPath // 一定存在的真 exe（这里只做 existsSync 判定，不会真跑它）
    const r = await openInNativeIde('c', 'int main(){}', deps)
    expect(r.ok, '改完路径还走旧配置 —— readConfig 被吃成了快照').toBe(true)
    if (r.ok) createdDirs.push(join(r.path, '..'))
  })

  it('★ 起得来 → ok，路径指向真文件，spawn 参数的每一条都对得上', async () => {
    const fake = fakeSpawn('spawn')
    const code = 'int main() { /* 中文 */ return 0; }'
    const r = await openInNativeIde('c', code, {
      readConfig: () => configWithIde('c', process.execPath),
      spawn: fake.spawnImpl
    })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    createdDirs.push(join(r.path, '..'))
    expect(existsSync(r.path), '返回的路径上没有文件 —— IDE 打开会报「文件不存在」').toBe(true)
    // process.execPath（node.exe）在白名单外 → 编码按语言回退：c → GBK。
    // 按 GBK 读回必须与原文一致（"白名单外的回退"见下面专门的一组用例）。
    expect(iconv.decode(readFileSync(r.path), 'gbk')).toBe(code)

    expect(fake.calls).toHaveLength(1)
    const call = fake.calls[0]
    expect(call.exe).toBe(process.execPath)
    // 数组参数直传、只有文件这一个参数 —— 加了别的东西（比如 shell 包装）就更易出错
    expect(call.args).toEqual([r.path])
    // detached + ignore：IDE 独立于 Electron 存活；windowsHide 不弹多余控制台
    expect(call.opts.detached).toBe(true)
    expect(call.opts.stdio).toBe('ignore')
    expect(call.opts.windowsHide).toBe(true)
    expect(call.opts.cwd).toBe(join(r.path, '..'))
    // 放手：不拖着应用退不出去
    expect(fake.unrefs(), 'unref 没被调 —— IDE 会拖着 Electron 退不出去').toBe(1)
  })

  it('★ spawn 报错（ENOENT/EACCES…）→ **failed**，detail 是原生错误信息，不是静默成功', async () => {
    // 这条就是「不许默认回退为成功」：没有对照臂的话，一个「把 error 当成功」
    // 的实现也能骗过上面那条 ok 用例。
    const fake = fakeSpawn('error', new Error('spawn EACCES'))
    const r = await openInNativeIde('c', 'int main(){}', {
      readConfig: () => configWithIde('c', process.execPath),
      spawn: fake.spawnImpl
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('failed')
    expect(r.detail).toContain('EACCES')
  })

  it('java 定不出类名 → failed，且**不 spawn**', async () => {
    const fake = fakeSpawn('spawn')
    const r = await openInNativeIde('java', 'int x = 1;', {
      readConfig: () => configWithIde('java', process.execPath),
      spawn: fake.spawnImpl
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('failed')
    expect(fake.calls).toHaveLength(0)
  })

  it('spawn **同步抛**（参数类型错这类）→ 也落成 failed，绝不把异常冒出去', async () => {
    // 失败即值：调用点（IPC handler）那句 await 上永远不该见到异常。
    const r = await openInNativeIde('c', 'int main(){}', {
      readConfig: () => configWithIde('c', process.execPath),
      spawn: () => {
        throw new Error('synchronous boom')
      }
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('failed')
      expect(r.detail).toContain('synchronous boom')
    }
  })

  it('配置里路径带首尾空白 → trim 之后再用（照写盘时的规矩）', async () => {
    const fake = fakeSpawn('spawn')
    const r = await openInNativeIde('c', 'int main(){}', {
      readConfig: () => configWithIde('c', `  ${process.execPath}  `),
      spawn: fake.spawnImpl
    })
    expect(r.ok).toBe(true)
    if (r.ok) createdDirs.push(join(r.path, '..'))
    expect(fake.calls[0].exe).toBe(process.execPath)
  })
})

// ──────────────────────────────────────────────────────────── 编码跟随目标程序（v9 核心）

/**
 * 【这一组守什么】主人 2026-10-01 验收实测：C 用 Dev-C++ 打开正常、Java 在上面
 * 乱码；换 VS Code 又反过来。旧版按**语言**定编码，任何一个固定 IDE 都乱一半。
 * v9 起编码跟随**目标程序**（认 exe 名 → 查 ide-profiles 的画像）。
 *
 * ⚠️ 每条都要有反向的对照臂：只测「Dev-C++ + java → GBK」的话，一个
 * 「c/cpp→GBK 其余 UTF-8」的旧实现也能绿（java 恰好是它写 UTF-8 的那半）；
 * 配上「VS Code + c → UTF-8」，旧实现两条都过不了。这正是这组测试存在的理由。
 */
describe('openInNativeIde：写盘编码跟随**目标程序**，不跟语言', () => {
  it('★ Dev-C++ 打开 java → 写 **GBK**（旧版这里是 UTF-8，主人就是在这儿看到乱码的）', async () => {
    const fake = fakeSpawn('spawn')
    const code = 'public class Foo { /* 中文注释 */ }'
    const r = await openInNativeIde('java', code, {
      readConfig: () => configWithIde('java', fakeExe('devcpp.exe')),
      spawn: fake.spawnImpl
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    createdDirs.push(join(r.path, '..'))
    const raw = readFileSync(r.path)
    expect(raw.equals(Buffer.from(code, 'utf8')), 'java 又按语言写回 UTF-8 了？').toBe(false)
    expect(iconv.decode(raw, 'gbk'), 'Dev-C++ 按 GBK 读，解码必须还原').toBe(code)
  })

  it('★ VS Code 打开 c → 写 **UTF-8**（和上一条成对：只测一边的话旧实现也能绿）', async () => {
    const fake = fakeSpawn('spawn')
    const code = 'int main() { /* 中文注释 */ return 0; }'
    const r = await openInNativeIde('c', code, {
      readConfig: () => configWithIde('c', fakeExe('Code.exe')),
      spawn: fake.spawnImpl
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    createdDirs.push(join(r.path, '..'))
    expect(readFileSync(r.path, 'utf8'), 'VS Code 按 UTF-8 读，写出的必须逐字节是 UTF-8').toBe(code)
  })

  it('★ 白名单外的程序（用户手挑的任意 exe）→ 按语言回退，和升级前逐字节一致', async () => {
    // 认不出就回退到 v8 的规则（c/cpp→GBK 其余 UTF-8）——「不比现在差」的承诺
    // 落在这一条上。回退方向也钉住：不是一律 UTF-8。
    const fake = fakeSpawn('spawn')
    const code = 'int main() { /* 中文 */ return 0; }'
    const r = await openInNativeIde('c', code, {
      readConfig: () => configWithIde('c', fakeExe('my-editor.exe')),
      spawn: fake.spawnImpl
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    createdDirs.push(join(r.path, '..'))
    const raw = readFileSync(r.path)
    expect(raw.equals(Buffer.from(code, 'utf8'))).toBe(false)
    expect(iconv.decode(raw, 'gbk')).toBe(code)
  })

  it('★ c 配了 Dev-C++、java 空白 → java 仍 **unconfigured**（四键各取各的，绝不串语言）', async () => {
    // 串语言的坏法：实现里若写成「拿第一个非空的路径」或「拿 c 的路径兜底」，
    // 用户没配过 java，点开却起了一个 Dev-C++ —— 而且这个错误不报任何东西。
    const fake = fakeSpawn('spawn')
    const r = await openInNativeIde('java', 'public class Foo { }', {
      readConfig: () => configWithIde('c', fakeExe('devcpp.exe')),
      spawn: fake.spawnImpl
    })
    expect(r).toEqual({ ok: false, reason: 'unconfigured' })
    expect(fake.calls).toHaveLength(0)
  })
})

// ──────────────────────────────────────────────────────────── exportCodeToFile：只写盘

describe('exportCodeToFile：只写盘，成败都是值', () => {
  it('该语言没配程序 → 按语言回退：cpp 内容按 GBK 落盘（同 v8 行为）', () => {
    const r = exportCodeToFile('cpp', '#include <iostream> // 中文', {
      readConfig: () => configWithIde('cpp', '')
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    createdDirs.push(join(r.path, '..'))
    expect(existsSync(r.path)).toBe(true)
    expect(iconv.decode(readFileSync(r.path), 'gbk')).toBe('#include <iostream> // 中文')
  })

  it('★ 该语言配了 VS Code → 导出也跟它走 UTF-8（不留「打开对了、导出还是旧编码」的半修）', () => {
    // 「打开」和「导出」是同一段代码的两个出口，编码必须同源 ——
    // 不然用户从「导出」拿到文件去 VS Code 里打开，又见到乱码，
    // 会以为这次根本没修。
    const code = '#include <iostream> // 中文'
    const r = exportCodeToFile('cpp', code, {
      readConfig: () => configWithIde('cpp', fakeExe('Code.exe'))
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    createdDirs.push(join(r.path, '..'))
    expect(readFileSync(r.path, 'utf8')).toBe(code)
  })

  it('java 定不出类名 → failed（和 openInNativeIde 同一条判定）', () => {
    const r = exportCodeToFile('java', 'int x = 1;', {
      readConfig: () => configWithIde('java', '')
    })
    expect(r).toEqual({ ok: false, reason: 'failed', detail: 'cannot derive source file name' })
  })
})
