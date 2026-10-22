/**
 * 「cloud 客户端绝不自己联网」闸门（P10.1 §7.2 禁入第 1 条）
 *
 * 【这个文件在守什么】src/main/cloud/ 里的一切请求只许经**注入的**
 * `FetchLike`（deps.fetch）出去 —— 客户端联网要等主人开窗口（部署纪律），
 * 在那之前任何一处写出真联网代码（globalThis.fetch / node:http / WebSocket…）
 * 都是一次静默越线：单测全绿、跑起来真的发包。
 *
 * 【两条自检（防"闸门恒绿"）】判据写错的坏法是安静的全绿，所以：
 *   · 每个禁用模式都配一条**合成正样本**，matcher 必须命中它 ——
 *     没有这一条，正则写错（引号、转义、环视）时闸门全绿且无人察觉；
 *   · 扫描面必须真的覆盖到已知文件 + 总字节数下界 ——
 *     「一个文件都没扫到」和「扫了全干净」在断言里长得一模一样。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，字符串一律英文。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { basename, join, relative } from 'path'
import { fileURLToPath } from 'url'

/** src/main/cloud/ 本身 */
const CLOUD_DIR = fileURLToPath(new URL('..', import.meta.url))

interface Finding {
  pattern: string
  line: number
  text: string
}

const BANNED: Array<{ name: string; re: RegExp }> = [
  { name: 'ambient fetch', re: /\b(?:globalThis|global|window|self)\.fetch\b/ },
  { name: 'node network module', re: /\bnode:(?:http|https|net|tls|dns|dgram|child_process)\b/ },
  { name: 'core module import', re: /\bfrom\s+['"](?:http|https|net|tls|dns|dgram|child_process)['"]/ },
  { name: 'dynamic core import', re: /\bimport\s*\(\s*['"](?:http|https|net|tls|dns|dgram|child_process)['"]/ },
  { name: 'dynamic require', re: /\brequire\s*\(/ },
  { name: 'browser socket api', re: /\b(?:WebSocket|XMLHttpRequest|EventSource|sendBeacon)\b/ },
  // 裸调用（前面没有 `.` 或标识符字符）：`fetch(` 是全局 fetch 的调用形状；
  // 注入缝的写法 `deps.fetch(` / `fake.fetch(` / `this.fetch(` 都带点，天然豁免
  { name: 'bare fetch call', re: /(?<![\w.$])fetch\s*\(/ }
]

/**
 * 逐行扫一份源码。**注释行跳过** —— 本仓库注释密度很高，中文注释里解释
 * 「不许用 WebSocket / 全局 fetch 长什么样」是合法的，闸门只禁代码。
 */
function scanSource(source: string): Finding[] {
  const findings: Finding[] = []
  source.split('\n').forEach((line, i) => {
    const t = line.trim()
    if (t === '' || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
    for (const b of BANNED) {
      if (b.re.test(line)) findings.push({ pattern: b.name, line: i + 1, text: t })
    }
  })
  return findings
}

/** 收集 cloud/ 下所有 .ts（__tests__ 整棵子树跳过 —— 假 fetch 夹具住在那里） */
function collectTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      out.push(...collectTsFiles(join(dir, entry.name)))
    } else if (entry.name.endsWith('.ts')) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

// ---------------------------------------------------------------- matcher 自检

describe('matcher 自检（没有这一组，闸门可能恒绿）', () => {
  it('每个禁用模式都有能命中它的合成正样本', () => {
    const samples: Array<[string, string]> = [
      ['ambient fetch', 'const r = await globalThis.fetch(url)'],
      ['node network module', "import { request } from 'node:https'"],
      ['core module import', "import { request } from 'https'"],
      ['dynamic core import', "const m = await import('http')"],
      ['dynamic require', "const http = require('node:http')"],
      ['browser socket api', 'const ws = new WebSocket(endpoint)'],
      ['bare fetch call', 'const r = await fetch(url, init)']
    ]
    for (const [name, src] of samples) {
      const hits = scanSource(src)
      expect(hits.map((h) => h.pattern), `${name} <- ${src}`).toContain(name)
    }
  })

  it('合法形态零命中：注入 fetch 的一切写法（含真实的 transport 调用形状）', () => {
    const legit = [
      'const t = createTransport({ baseUrl, fetch: deps.fetch, timeoutMs })',
      'res = await deps.fetch(url, { method, headers, signal })',
      'fetch: FetchLike',
      'fetch?: FetchLike',
      'const got = await this.fetch(url)',
      'type FetchLike = (url: string, init: RequestInit) => Promise<Response>'
    ]
    for (const src of legit) {
      expect(scanSource(src), src).toEqual([])
    }
  })

  it('注释行不算：中文注释里解释禁用 API 是合法的', () => {
    expect(scanSource('// never use globalThis.fetch here\n * WebSocket is banned too')).toEqual([])
  })
})

// ---------------------------------------------------------------- 真扫描

describe('src/main/cloud/（除 __tests__）真的干净', () => {
  const files = collectTsFiles(CLOUD_DIR)

  it('扫描面覆盖到已知文件（空样本 ≠ 零命中）', () => {
    const names = files.map((f) => basename(f))
    for (const must of [
      'transport.ts',
      'account.ts',
      'session.ts',
      'provider.ts',
      'provider-impl.ts',
      'docs.ts',
      'base-url.ts',
      'index.ts'
    ]) {
      expect(names, must).toContain(must)
    }
  })

  it('零禁用模式命中（总字节数下界防"扫了空文件"）', () => {
    let bytes = 0
    const findings: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf-8')
      bytes += src.length
      for (const hit of scanSource(src)) {
        findings.push(`${relative(CLOUD_DIR, f)}:${hit.line} [${hit.pattern}] ${hit.text}`)
      }
    }
    expect(bytes).toBeGreaterThan(5_000)
    expect(findings).toEqual([])
  })
})
