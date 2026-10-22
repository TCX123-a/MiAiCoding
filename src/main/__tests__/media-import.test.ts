/**
 * 素材导入执行体（src/main/media-import.ts）—— 壁纸与开屏视频共用。
 *
 * 【这个文件在守什么】导入是「用户看着对话框里说成功」的操作，
 * 每一条失败分支错了都直接毁坏观感或数据：
 *   1. 重名覆盖 = 悄悄毁掉用户上一张同名壁纸（必须加序号，且序号从 (2) 起）；
 *   2. 同一路径自我拷贝 = EBUSY，而它其实是「已经在库里」的成功语义（必须认出来）；
 *   3. 体积/扩展名校验松一档 = 「提示成功、列表却没有」，因为扫描器
 *      跳过 <1KB 与非白名单 —— 校验与扫描必须同一口径（共用 MIN_IMPORT_BYTES）；
 *   4. 结果形状走异常 = 渲染层弹 native 错误框（取消是日常，必须是值）。
 *
 * pickFile 是注入的（本模块零 electron），这里注入「假装用户选了 X」，
 * 配真临时目录把每条路走一遍真 fs。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  importMedia,
  MAX_IMPORT_BYTES,
  MIN_IMPORT_BYTES,
  uniqueDestName,
  type PickFileFn
} from '../media-import'

let tmp = ''
let srcDir = ''
let destDir = ''

/** 造一个源文件（内容可辨认，用来验「拷的是内容不只是文件名」） */
function putSrc(name: string, sizeBytes = 2048, byte = 7): string {
  const p = join(srcDir, name)
  writeFileSync(p, Buffer.alloc(sizeBytes, byte))
  return p
}

/** 注入一个「用户选了 path」的 pickFile；path 为 null = 取消 */
const picks = (path: string | null): PickFileFn => () => Promise.resolve(path)

function run(pickFile: PickFileFn) {
  return importMedia({
    pickFile,
    destDir,
    allowedExts: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4'],
    title: 'T',
    filterName: 'F'
  })
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'miai-media-import-'))
  srcDir = join(tmp, 'src')
  destDir = join(tmp, 'dest')
  mkdirSync(srcDir)
  mkdirSync(destDir)
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('importMedia：四种「失败即值」（不抛异常）', () => {
  it('取消（pickFile 返回 null）→ cancelled', async () => {
    expect(await run(picks(null))).toEqual({ ok: false, reason: 'cancelled' })
  })

  it('白名单外扩展名 → bad-ext；没有点的文件名（README）也拒收', async () => {
    expect(await run(picks(putSrc('notes.txt')))).toEqual({ ok: false, reason: 'bad-ext' })
    expect(await run(picks(putSrc('README')))).toEqual({ ok: false, reason: 'bad-ext' })
    expect(await run(picks(putSrc('movie.mov')))).toEqual({ ok: false, reason: 'bad-ext' })
  })

  it('扩展名判定大小写不敏感（PIC.JPG 过 jpg 白名单）', async () => {
    const r = await run(picks(putSrc('PIC.JPG')))
    expect(r.ok).toBe(true)
  })

  it('体积 < 1KB → too-small（1024 恰好在线上，收）', async () => {
    expect(await run(picks(putSrc('tiny.png', MIN_IMPORT_BYTES - 1)))).toEqual({
      ok: false,
      reason: 'too-small'
    })
    expect((await run(picks(putSrc('edge.png', MIN_IMPORT_BYTES)))).ok).toBe(true)
  })

  it('stat 不到（文件刚被删）/ 选了个目录 → copy-failed，带一行摘要', async () => {
    const gone = await run(picks(join(srcDir, 'no-such.png')))
    expect(gone.ok).toBe(false)
    expect(gone.reason).toBe('copy-failed')
    expect((gone.message ?? '').length).toBeGreaterThan(0)

    mkdirSync(join(srcDir, 'folder.png'))
    expect(await run(picks(join(srcDir, 'folder.png')))).toEqual({
      ok: false,
      reason: 'copy-failed',
      message: 'not a regular file'
    })
  })
})

describe('importMedia：拷贝成功', () => {
  it('拷进 destDir、内容一致、源文件还在（是拷贝不是搬家）、返回实际文件名', async () => {
    const src = putSrc('star.png', 2048, 7)
    const r = await run(picks(src))
    expect(r).toEqual({ ok: true, name: 'star.png' })
    expect(existsSync(src)).toBe(true)
    expect(readFileSync(join(destDir, 'star.png'))).toEqual(readFileSync(src))
  })

  it('重名加序号（从 (2) 起，扩展名之前）—— 绝不覆盖已有文件', async () => {
    writeFileSync(join(destDir, 'star.png'), Buffer.alloc(2048, 1)) // 用户的旧那张
    const r2 = await run(picks(putSrc('star.png')))
    expect(r2).toEqual({ ok: true, name: 'star (2).png' })
    const r3 = await run(picks(putSrc('star.png')))
    expect(r3).toEqual({ ok: true, name: 'star (3).png' })
    // 旧文件没被动过
    expect(readFileSync(join(destDir, 'star.png'))).toEqual(Buffer.alloc(2048, 1))
  })

  it('destDir 还不存在 → 现造（首次导入的路径）', async () => {
    const fresh = join(tmp, 'brand-new')
    const r = await importMedia({
      pickFile: picks(putSrc('a.png')),
      destDir: fresh,
      allowedExts: ['png'],
      title: 'T',
      filterName: 'F'
    })
    expect(r.ok).toBe(true)
    expect(existsSync(join(fresh, 'a.png'))).toBe(true)
  })

  it('选中的正是 destDir 里已有的那个文件 → no-op 成功（不自我拷贝 EBUSY、不生成 (2)）', async () => {
    const inside = join(destDir, 'here.png')
    writeFileSync(inside, Buffer.alloc(2048, 9))
    const r = await run(picks(inside))
    expect(r).toEqual({ ok: true, name: 'here.png' })
    expect(existsSync(join(destDir, 'here (2).png'))).toBe(false)
  })

  it('★ 拷贝必须走异步 API，不许 copyFileSync 冻住主进程（2026-10-14 修）', () => {
    // 为什么钉这条：导入的是壁纸/开屏视频，几百 MB 是常态；copyFileSync 在
    // Electron 主进程里整段占住事件循环 —— 拷贝期间所有窗口的 IPC、窗口状态
    // 推送、壁纸帧调度全部停摆（大文件时肉眼可见的整应用假死）。
    // 不掐时长（那会变成看机器脸色的假绿/假红），钉的是「用的哪个 API」这条
    // 不变量（同 lang-switch-wiring 的接线闸门路子）。行为面由上面 12 条
    // 真文件测试兜底：它们全部改走异步路径后仍须逐条通过。
    // 【它抓不到什么】只抓字面写法：间接别名（const c = copyFileSync）抓不住。
    const src = codeText(readFileSync(join(__dirname, '..', 'media-import.ts'), 'utf8'))
    expect(src, 'copyFileSync 会在整段拷贝期间冻住主进程事件循环').not.toMatch(/copyFileSync\s*\(/)
    expect(src, '异步拷贝必须真的在、且被 await（少了它拷贝没落地就返回成功）').toMatch(/await\s+copyFile\s*\(/)
  })
})

/**
 * 排掉整行注释之后再找。注释里出现 copyFileSync 是**正常的** ——
 * 修复说明里就写着「不许 copyFileSync」。不排掉的话，那条解释反而会让闸门
 * 自己红掉，下一个人只会把闸门删掉（同 lang-switch-wiring 的 codeText）。
 */
function codeText(src: string): string {
  return src
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')
}

/**
 * 导入体积上限（2026-10-14 修复批·主人拍板 2GiB）。
 *
 * 【守什么】没有上限时，选中一个 50GB 的错文件 = 主进程默默往用户盘上搬
 * 50GB（拷贝期间磁盘被占满、应用无响应）。上限的目的不是"性能"，是
 * **在落第一个字节之前说不**，把错误摆回对话框那一刻。
 *
 * 【怎么测】不造真 2GB 文件（Defender 实扫下又慢又蠢，先例见上面 60s 条款
 * 的注释）——上限走「注入」：`maxBytes` 是给测试的注入口，生产调用方不传
 * （缺省 = MAX_IMPORT_BYTES）。用 4096 当上限把边界（恰收/超一字节拒）
 * 在千字节级真跑一遍真 fs；真数值由第一条用例钉死在常量上。
 *
 * 【为什么拒收要看 destDir】"拒了"必须是**一个字节都没落**：检查若排在
 * mkdir/copyFile 之后，文件其实已经拷进去了、只是返回值难看。所以断言
 * 用全新 destDir + existsSync=false——连目录都不该被建出来。
 */
describe('importMedia：导入体积上限（2GiB）', () => {
  function runMax(maxBytes: number, pick: PickFileFn, dest = destDir) {
    return importMedia({
      pickFile: pick,
      destDir: dest,
      allowedExts: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4'],
      title: 'T',
      filterName: 'F',
      maxBytes
    })
  }

  it('上限常量钉死在 2 GiB（数值一漂移就红）', () => {
    expect(MAX_IMPORT_BYTES).toBe(2 * 1024 ** 3)
  })

  it('恰好在上限 → 收（真落盘）', async () => {
    const ok = await runMax(4096, picks(putSrc('edge.mp4', 4096)))
    expect(ok).toEqual({ ok: true, name: 'edge.mp4' })
    expect(readFileSync(join(destDir, 'edge.mp4')).length).toBe(4096)
  })

  it('超限拒收时一个字节都不落盘（destDir 连建都不该建）', async () => {
    const fresh = join(tmp, 'never-created')
    const over = await runMax(4096, picks(putSrc('big.mp4', 4097)), fresh)
    expect(over).toEqual({ ok: false, reason: 'too-large' })
    expect(existsSync(fresh)).toBe(false)
  })

  it('自己拷自己但超限 → too-large（校验先于自我拷贝 no-op，与 too-small 对称）', async () => {
    const inside = join(destDir, 'inside.mp4')
    writeFileSync(inside, Buffer.alloc(4097, 3))
    const r = await runMax(4096, picks(inside))
    expect(r).toEqual({ ok: false, reason: 'too-large' })
  })

  it('不超限时一切照旧（默认路径回归：拷贝 + 重名序号仍工作）', async () => {
    writeFileSync(join(destDir, 'star.png'), Buffer.alloc(2048, 1))
    const r = await runMax(4096, picks(putSrc('star.png')))
    expect(r).toEqual({ ok: true, name: 'star (2).png' })
  })
})

describe('uniqueDestName：有界去重', () => {
  it('没冲突原样返回；占用则依次升序号', () => {
    expect(uniqueDestName(destDir, 'x.png')).toBe('x.png')
    writeFileSync(join(destDir, 'x.png'), 'x')
    expect(uniqueDestName(destDir, 'x.png')).toBe('x (2).png')
    writeFileSync(join(destDir, 'x (2).png'), 'x')
    expect(uniqueDestName(destDir, 'x.png')).toBe('x (3).png')
  })

  it('没有点的文件名也能去重（序号加在整名后面）', () => {
    writeFileSync(join(destDir, 'README'), 'x')
    expect(uniqueDestName(destDir, 'README')).toBe('README (2)')
  })

  // 【为什么这条要 60s】本用例纯测「循环有界」这一点，但代价是 ~2000 次真
  // fs 操作（999 次建文件 + 999 次 existsSync），Defender 实扫下**空载单跑
  // 就是 2.6s**（2026-10-11 实测）。全量并发（169 文件抢盘）时膨胀 2.5~3.2 倍
  // （实测 6606ms / 8470ms）；2026-10-11 凌晨本机另有 26 个满核 python 孤儿
  // 进程压着 CPU 时实测 32738ms，把 30s 也顶穿了 —— 于是提到 60s。
  // 一条防「无界探测」的用例，坏掉的形态是死循环（永远超时），放宽预算不会
  // 放走任何真实回归；断言一字未动。同 precedent = foreign-pc.test.ts 的 30s。
  it('999 个同名全被占 → null（循环必须有界，不做无界探测）', { timeout: 60_000 }, () => {
    writeFileSync(join(destDir, 'n.png'), 'x')
    for (let i = 2; i <= 999; i++) writeFileSync(join(destDir, `n (${i}).png`), 'x')
    expect(uniqueDestName(destDir, 'n.png')).toBeNull()
  })
})
