#!/usr/bin/env node
/**
 * 协议真源同步 / 闸门（docs/22 §3.3）。
 *
 * 真源：src/shared/cloud/protocol.ts（客户端仓库）
 * 副本：server/src/protocol.ts（服务端整文件逐字节拷贝，禁手改）
 *
 * 用法：
 *   node scripts/protocol-sync.mjs copy    # 真源 → 服务端副本（整文件覆盖）
 *   node scripts/protocol-sync.mjs check   # 逐字节比较；不等 → 打印首个分歧，退出码 1
 *
 * 纪律：任何协议改动一律先改真源、再跑 copy；check 是双向闸门
 * （两端测试里也各有一份字节相等断言，见 src/shared/__tests__/cloud-protocol.test.ts
 * 与 server/test/unit/protocol-sync.test.ts）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src', 'shared', 'cloud', 'protocol.ts')
const DST = path.join(ROOT, 'server', 'src', 'protocol.ts')

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** 找到两个 Buffer 的首个差异位置（-1 = 完全相同） */
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i
  }
  return a.length === b.length ? -1 : n
}

/** 把字节偏移换算成 1 起算的行号（对 bytes < offset 里的 0x0a 计数） */
function lineOf(buf, offset) {
  let line = 1
  for (let i = 0; i < offset && i < buf.length; i++) {
    if (buf[i] === 0x0a) line++
  }
  return line
}

const mode = process.argv[2]

if (mode === 'copy') {
  const bytes = readFileSync(SRC)
  writeFileSync(DST, bytes)
  console.log(`[protocol-sync] copy: ${bytes.length} bytes → server/src/protocol.ts`)
  console.log(`[protocol-sync] sha256: ${sha256(bytes)}`)
  process.exit(0)
}

if (mode === 'check') {
  const a = readFileSync(SRC)
  const b = readFileSync(DST)
  const diff = firstDiff(a, b)
  if (diff === -1) {
    console.log(`[protocol-sync] check OK: 两端逐字节相等（${a.length} bytes, sha256 ${sha256(a)}）`)
    process.exit(0)
  }
  console.error('[protocol-sync] check FAILED: server/src/protocol.ts 与真源不再逐字节相等')
  console.error(`  真源 ${a.length} bytes / 副本 ${b.length} bytes；首个分歧在字节偏移 ${diff}`)
  console.error(`  真源行 ${lineOf(a, diff)} / 副本行 ${lineOf(b, diff)}`)
  console.error('  修复：先确认真源是想要的版本，然后 node scripts/protocol-sync.mjs copy')
  process.exit(1)
}

console.error('用法: node scripts/protocol-sync.mjs copy|check')
process.exit(2)
