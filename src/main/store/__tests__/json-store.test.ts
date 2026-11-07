import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createJsonStore } from '../json-store'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'miai-store-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('json-store 原子写', () => {
  it('写读往返', () => {
    const s = createJsonStore<{ learned: string[] }>(dir, 'p.json')
    expect(s.read()).toBeNull()
    s.write({ learned: ['a'] })
    expect(s.read()).toEqual({ learned: ['a'] })
    // 连续写两次内容正确覆盖
    s.write({ learned: ['a', 'b'] })
    expect(s.read()).toEqual({ learned: ['a', 'b'] })
  })

  it('主文件损坏时回退 .bak 并抢救', () => {
    const s = createJsonStore<{ learned: string[] }>(dir, 'p.json')
    s.write({ learned: ['a'] })
    s.write({ learned: ['a', 'b'] }) // 产生 .bak（旧主文件副本 = ['a']）
    writeFileSync(join(dir, 'p.json'), '{{{ 损坏的 JSON')
    expect(s.read()).toEqual({ learned: ['a'] })
    // 抢救后主文件恢复为合法 JSON（备份内容）
    expect(existsSync(join(dir, 'p.json'))).toBe(true)
    const repaired = JSON.parse(readFileSync(join(dir, 'p.json'), 'utf-8'))
    expect(repaired).toEqual({ learned: ['a'] })
  })

  it('主文件与备份都损坏时返回 null', () => {
    const s = createJsonStore<{ learned: string[] }>(dir, 'p.json')
    s.write({ learned: ['a'] })
    writeFileSync(join(dir, 'p.json'), 'bad')
    writeFileSync(join(dir, 'p.json.bak'), 'also bad')
    expect(s.read()).toBeNull()
  })

  it('坏档会留一份带时间戳的副本，不会被下一次保存无声覆盖', () => {
    const s = createJsonStore<{ learned: string[] }>(dir, 'p.json')
    s.write({ learned: ['a'] })
    s.write({ learned: ['a', 'b'] }) // 产生 .bak
    writeFileSync(join(dir, 'p.json'), '{{{ 坏档')
    expect(s.read()).toEqual({ learned: ['a'] })
    const quarantined = readdirSync(dir).filter((n) => /^p\.json\.corrupt-\d+$/.test(n))
    expect(quarantined).toHaveLength(1)
    expect(readFileSync(join(dir, quarantined[0]), 'utf-8')).toBe('{{{ 坏档')
  })

  it('主档和备份都坏时，两份都留副本再返回 null', () => {
    const s = createJsonStore<{ learned: string[] }>(dir, 'p.json')
    s.write({ learned: ['a'] })
    writeFileSync(join(dir, 'p.json'), 'bad')
    writeFileSync(join(dir, 'p.json.bak'), 'also bad')
    expect(s.read()).toBeNull()
    const mainCopies = readdirSync(dir).filter((n) => /^p\.json\.corrupt-\d+$/.test(n))
    const bakCopies = readdirSync(dir).filter((n) => /^p\.json\.bak\.corrupt-\d+$/.test(n))
    expect(mainCopies).toHaveLength(1)
    expect(bakCopies).toHaveLength(1)
  })

  it('瞬时读失败（EISDIR/EPERM 等）不拿旧备份顶替最新档', () => {
    const s = createJsonStore<{ learned: string[] }>(dir, 'p.json')
    s.write({ learned: ['a'] })
    s.write({ learned: ['a', 'b'] }) // 产生 .bak（内容 ['a']）
    // 把主档换成同名目录：readFileSync 会抛非 ENOENT 错误，走 io 分支
    renameSync(join(dir, 'p.json'), join(dir, 'p.json.real'))
    mkdirSync(join(dir, 'p.json'))
    expect(s.read()).toBeNull()
    // 主档仍然是目录（没有被备份覆盖成文件），备份也原样还在
    expect(existsSync(join(dir, 'p.json.bak'))).toBe(true)
    expect(existsSync(join(dir, 'p.json.real'))).toBe(true)
  })

  it('目录不存在时 write 自动创建', () => {
    const deep = join(dir, 'sub', 'deep')
    const s = createJsonStore<{ x: number }>(deep, 'c.json')
    s.write({ x: 1 })
    expect(s.read()).toEqual({ x: 1 })
  })
})
