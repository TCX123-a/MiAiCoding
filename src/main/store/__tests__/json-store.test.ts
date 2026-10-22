import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
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

  it('目录不存在时 write 自动创建', () => {
    const deep = join(dir, 'sub', 'deep')
    const s = createJsonStore<{ x: number }>(deep, 'c.json')
    s.write({ x: 1 })
    expect(s.read()).toEqual({ x: 1 })
  })
})
