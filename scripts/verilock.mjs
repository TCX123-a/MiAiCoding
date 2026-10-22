#!/usr/bin/env node
// 全机唯一一把「起编译器」的排队锁。
//
// 为什么必须有它：七道闸门和子代理的自检都要**真起编译器**（python / gcc / g++ / javac）。
// 几路任务同时起编译器会互相抢 CPU，跑出**复现不出来的假红** —— 本喵踩过这个坑
// （vitest 超时假红，重跑就绿）。本喵定的规矩是「写作可以无限并行，起编译器必须排队」：
// 写作是网络密集（烧生成费、不占 CPU），验证是 CPU 密集（不烧生成费、占 CPU）。
// 分开之后，写作的 6 个代理可以一直跑，而验证按顺序来 —— 两头都不浪费。
//
// 用法：
//   node scripts/verilock.mjs run <标签> -- <命令> [参数...]   # 排队 → 执行 → 自动释放
//   node scripts/verilock.mjs status                          # 看看谁占着
//   命令串形式（管道、&& 之类）：
//   node scripts/verilock.mjs shell <标签> "<一整条 shell 命令>"
//
// 并发上限：环境变量 MIAI_VERILOCK_LIMIT，默认 5（本机 32 逻辑核；实测写作代理全跑着时
// CPU 只用 14%，3 太保守了）。
// 独占档：`--exclusive`（或 MIAI_VERILOCK_EXCLUSIVE=1）会**把所有槽都占下**再跑 ——
// 给 vitest 这种"超时敏感、抢 CPU 就假红"的活专用（本喵踩过假红，见 CLAUDE.md 的规矩）。
// 等太久：超过 MIAI_VERILOCK_MAXWAIT 秒（默认 1200）就强抢最旧的那个槽，并大声喊出来。
//
// ⚠️ 这把锁是**建议性**的：忘了用它也不会坏，只是退回「可能抢 CPU」。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const LOCK_DIR = path.join(os.tmpdir(), 'miai-verilock')
const LIMIT = Number(process.env.MIAI_VERILOCK_LIMIT || 5)
const MAX_WAIT_MS = Number(process.env.MIAI_VERILOCK_MAXWAIT || 1200) * 1000
const STALE_MS = 20 * 60 * 1000

function ensureDir() {
  fs.mkdirSync(LOCK_DIR, { recursive: true })
}

function slotPath(i) {
  return path.join(LOCK_DIR, `slot-${i}.lock`)
}

function readSlot(i) {
  try {
    return JSON.parse(fs.readFileSync(slotPath(i), 'utf8'))
  } catch {
    return null
  }
}

function alive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// 能不能把这个槽当成「僵尸」清掉：主人进程没了，或者占太久了
function isStale(info) {
  if (!info) return true
  if (!alive(info.pid)) return true
  return Date.now() - (info.at || 0) > STALE_MS
}

function tryAcquireAt(i, label) {
  try {
    const fd = fs.openSync(slotPath(i), 'wx') // wx = 原子创建，有人占着就抛错
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, label, at: Date.now() }))
    fs.closeSync(fd)
    return true
  } catch (e) {
    if (e.code !== 'EEXIST') throw e
    if (isStale(readSlot(i))) {
      try {
        fs.unlinkSync(slotPath(i))
        console.log(`[verilock] 清掉僵尸槽 ${i}（原先的占用者已经不在了）`)
      } catch {}
      return tryAcquireAt(i, label)
    }
    return false
  }
}

function tryAcquire(label) {
  ensureDir()
  for (let i = 0; i < LIMIT; i++) if (tryAcquireAt(i, label)) return i
  return -1
}

// 独占：把所有槽都占下。占了半个被别人插进来就白占了，所以拿到多少算多少、
// 差一个就全放掉重来 —— 宁可多等一轮，也不要"以为独占了其实没有"。
function tryAcquireAll(label) {
  ensureDir()
  const got = []
  for (let i = 0; i < LIMIT; i++) {
    if (tryAcquireAt(i, label)) got.push(i)
    else {
      got.forEach(release)
      return null
    }
  }
  return got
}

function release(i) {
  try {
    fs.unlinkSync(slotPath(i))
  } catch {}
}

function whoIsHolding() {
  const out = []
  for (let i = 0; i < LIMIT; i++) {
    const info = readSlot(i)
    if (info) out.push(`  槽 ${i}: pid=${info.pid} 标签=${info.label} 已占 ${Math.round((Date.now() - info.at) / 1000)}s`)
  }
  return out.length ? out.join('\n') : '  （空闲）'
}

async function acquireOrDie(label, exclusive) {
  const t0 = Date.now()
  const grab = () => (exclusive ? tryAcquireAll(label) : (() => { const i = tryAcquire(label); return i < 0 ? null : [i] })())
  let held = grab()
  while (!held) {
    if (Date.now() - t0 > MAX_WAIT_MS) {
      console.log(`[verilock] 等太久了（>${MAX_WAIT_MS / 1000}s），强抢最旧的槽 —— 这是异常情况，请留意`)
      let oldest = -1
      let t = Infinity
      for (let k = 0; k < LIMIT; k++) {
        const info = readSlot(k)
        const at = info?.at ?? 0
        if (at < t) {
          t = at
          oldest = k
        }
      }
      if (oldest >= 0) release(oldest)
      held = grab()
      continue
    }
    if (Date.now() - t0 < 3000) {
      console.log(`[verilock] 「${label}」在排队等编译器${exclusive ? '（独占档：要等所有人都空出来）' : ''}，当前占用：\n${whoIsHolding()}`)
    }
    await new Promise((r) => setTimeout(r, 3000))
    held = grab()
  }
  const waited = Math.round((Date.now() - t0) / 1000)
  console.log(`[verilock] 「${label}」拿到槽 ${held.join(',')}${exclusive ? '（独占）' : ''}${waited > 3 ? `（等了 ${waited}s）` : ''}`)
  return held
}

const argvAll = process.argv.slice(2)
const EXCLUSIVE = argvAll.includes('--exclusive') || process.env.MIAI_VERILOCK_EXCLUSIVE === '1'
const argv = argvAll.filter((a) => a !== '--exclusive')
const [mode, label, ...rest] = argv

if (mode === 'status') {
  console.log(`上限 ${LIMIT} 个并发编译器任务`)
  console.log(whoIsHolding())
  process.exit(0)
}

if (mode !== 'run' && mode !== 'shell') {
  console.log(`用法：
  node scripts/verilock.mjs run [--exclusive] <标签> -- <命令> [参数...]
  node scripts/verilock.mjs shell [--exclusive] <标签> "<一整条命令>"
  node scripts/verilock.mjs status
  --exclusive：把所有槽都占下再跑（给 vitest 这种超时敏感、抢 CPU 就假红的活）`)
  process.exit(2)
}

const slots = await acquireOrDie(label || '未命名', EXCLUSIVE)
let done = false
const cleanup = () => {
  if (!done) {
    done = true
    slots.forEach(release)
  }
}
process.on('exit', cleanup)
process.on('SIGINT', () => {
  cleanup()
  process.exit(130)
})
process.on('SIGTERM', () => {
  cleanup()
  process.exit(143)
})

let code = 1
if (mode === 'shell') {
  const cmd = rest.join(' ')
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit' })
  code = r.status ?? 1
} else {
  const sep = rest.indexOf('--')
  const argv = sep >= 0 ? rest.slice(sep + 1) : rest
  if (!argv.length) {
    console.log('[verilock] 没给命令')
    cleanup()
    process.exit(2)
  }
  code = await new Promise((res) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: 'inherit', shell: false })
    child.on('error', (e) => {
      console.log(`[verilock] 起不来：${e.message}`)
      res(127)
    })
    child.on('close', (c) => res(c ?? 1))
  })
}

cleanup()
console.log(`[verilock] 「${label}」跑完，退出码 ${code}，槽 ${slots.join(',')} 已释放`)
process.exit(code)
