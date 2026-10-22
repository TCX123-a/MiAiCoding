/**
 * 开屏素材扫描（src/main/splash/material.ts）
 *
 * 【这个文件在守什么】扫描结果是后面一切的前提：decideSplash 拿它挑片、
 * 「fixed 未命中回退候选第一个」的"第一个"就是这里的排序、素材池的名字
 * 对不上也是在这里过滤掉的。两个失败方向都静默：
 *   1. **多收**（非视频文件混进来）→ 随机播放抽中一个 .txt，开屏页
 *      error 收场，用户看到开屏闪一下就走；
 *   2. **少收**（过滤写狠了）→ 「我明明放了视频啊」而软件说没素材。
 * 排序那条额外重要：`localeCompare` 在不同机器/语言下结果不同，
 * 会把「回退到第一个」变成运气 —— 所以这里用 ASCII 序钉死。
 *
 * 全部夹具在系统临时目录现造现拆，不碰仓库里的任何真实目录。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanSplashMaterials, splashMaterialDirs } from '../material'

let tmp = ''
let dirA = ''
let dirB = ''

/** 造一个「体积够格」的视频文件（内容无所谓，扫描只看扩展名与体积） */
function putVideo(dir: string, name: string, sizeBytes = 2048): string {
  const p = join(dir, name)
  writeFileSync(p, Buffer.alloc(sizeBytes, 1))
  return p
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'miai-splash-mat-'))
  dirA = join(tmp, 'builtin')
  dirB = join(tmp, 'user')
  mkdirSync(dirA)
  mkdirSync(dirB)
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('scanSplashMaterials：只收「像视频的完整文件」', () => {
  it('扩展名白名单（含大写）、隐藏文件/非视频/过小/同名目录 全部挡在外面', () => {
    putVideo(dirA, 'A.mp4')
    putVideo(dirA, 'b.mp4')
    putVideo(dirA, 'c.WEBM') // 大写扩展名也要认（Windows 上用户随手改名很常见）
    putVideo(dirA, 'd.MOV')
    putVideo(dirA, 'e.m4v')
    putVideo(dirA, '.hidden.mp4') // macOS/编辑器垃圾
    putVideo(dirA, 'tiny.mp4', 500) // 断点残片的典型体积（< 1KB 底线）
    writeFileSync(join(dirA, 'notes.txt'), 'x'.repeat(2048))
    mkdirSync(join(dirA, 'folder.mp4')) // 目录恰好叫了视频名

    const out = scanSplashMaterials([dirA])
    expect(out.map((m) => m.name)).toEqual(['A.mp4', 'b.mp4', 'c.WEBM', 'd.MOV', 'e.m4v'])
    // 体积如实上报（池子面板将来要显示大小）
    expect(out.find((m) => m.name === 'b.mp4')?.sizeBytes).toBe(2048)
  })

  it('排序是 ASCII 逐字符序（不是 localeCompare）——「回退第一个」必须跨机器确定', () => {
    // ASCII 序里大写恒在小写前（B=66 < a=97 < c=99）；localeCompare 按字母
    // 基字比较，会把 'a.mp4' 排到 'B.mp4' 前（本机 ICU 实测 a,B,c）——
    // 实现若换成 localeCompare，这格必红。
    // 不用 A.mp4/a.mp4 那一对：NTFS 不分大小写，两个名字落成同一个文件，
    // 夹具在 Windows 上摆不出来（曾经红就是因为这个）。
    putVideo(dirA, 'c.mp4')
    putVideo(dirA, 'B.mp4')
    putVideo(dirA, 'a.mp4')
    expect(scanSplashMaterials([dirA]).map((m) => m.name)).toEqual(['B.mp4', 'a.mp4', 'c.mp4'])
  })

  it('同名文件第一个目录赢（内置目录在前 → 用户误拷的同名件不会顶掉随包素材）', () => {
    putVideo(dirA, 'same.mp4', 2048)
    putVideo(dirB, 'same.mp4', 4096)
    putVideo(dirB, 'only-b.mp4')

    const out = scanSplashMaterials([dirA, dirB])
    const same = out.filter((m) => m.name === 'same.mp4')
    expect(same).toHaveLength(1)
    expect(same[0].abs).toBe(join(dirA, 'same.mp4'))
    expect(same[0].sizeBytes).toBe(2048)
    expect(out.map((m) => m.name)).toContain('only-b.mp4')
  })

  it('目录不存在 = 没有素材（不抛）；全空时返回空数组', () => {
    expect(scanSplashMaterials([join(tmp, 'nope')])).toEqual([])
    expect(scanSplashMaterials([])).toEqual([])
  })

  it('返回的 abs 是「目录 + 名字」的完整路径（播放端直接拿它拼 miai-wall://）', () => {
    putVideo(dirB, 'x.mp4')
    expect(scanSplashMaterials([dirB])[0].abs).toBe(join(dirB, 'x.mp4'))
  })
})

describe('splashMaterialDirs：两个目录、顺序即优先级', () => {
  it('dev：内置读源码目录（public/splash），用户读 storageDir/splash', () => {
    const dirs = splashMaterialDirs({
      isDev: true,
      appPath: 'APP',
      mainDir: 'MAIN',
      storageDir: 'STORE'
    })
    expect(dirs).toEqual([join('APP', 'src', 'renderer', 'public', 'splash'), join('STORE', 'splash')])
  })

  it('打包后：内置读 mainDir/../renderer/splash（public/** 会被拷进 out/renderer）', () => {
    const dirs = splashMaterialDirs({
      isDev: false,
      appPath: 'APP',
      mainDir: join('OUT', 'main'),
      storageDir: 'STORE'
    })
    expect(dirs).toEqual([join('OUT', 'main', '..', 'renderer', 'splash'), join('STORE', 'splash')])
  })

  it('内置恒在第一个（同名去重的优先级就靠这个顺序）', () => {
    for (const isDev of [true, false]) {
      const dirs = splashMaterialDirs({ isDev, appPath: 'A', mainDir: 'M', storageDir: 'S' })
      expect(dirs).toHaveLength(2)
      expect(dirs[0]).not.toBe(dirs[1])
      expect(dirs[1]).toBe(join('S', 'splash'))
    }
  })
})
