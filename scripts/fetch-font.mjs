#!/usr/bin/env node
/**
 * 取回桌宠用的 MiSans-Regular.otf（2026-10-31 主人点名替换商业字体）。
 *
 * 【为什么不把这个 otf 直接提交进 Git】
 * MiSans 的许可证允许「把字体嵌进 App 并随 App 分发」，但**禁止单独再分发
 * 字体软件或其副本**。仓库是公开的源码分发渠道，把裸字体文件推上去就踩了
 * 这一条。所以仓库只跟踪 `font-manifest.json`（URL + SHA256 + 解包路径），
 * 需要构建时用本脚本从**官方渠道**取，校验通过后才落盘。
 *
 * 用法：
 *   npm run font:fetch
 *   node scripts/fetch-font.mjs --force   # 已有文件也重新下载
 *   node scripts/fetch-font.mjs --zip D:\下载\MiSans.zip   # 用本地已下好的官方包（不走网络）
 *
 * 退出码：0 = 文件就绪；1 = 下载/解包/校验失败（打印可操作的下一步）。
 */
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dirname, '..')
const FONT_DIR = join(REPO, 'resources', 'fonts')
const MANIFEST_PATH = join(FONT_DIR, 'font-manifest.json')

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`缺少字体清单 ${MANIFEST_PATH}`)
  }
  const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  for (const key of ['file', 'url', 'zipEntry', 'sha256', 'size']) {
    if (!raw[key]) throw new Error(`字体清单缺少字段 ${key}`)
  }
  return raw
}

function sha256Of(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** 已有文件且尺寸/哈希都对 ⇒ 什么都不做（幂等，构建脚本可以无脑调它） */
function alreadyGood(target, manifest) {
  if (!existsSync(target)) return false
  const size = statSync(target).size
  if (size !== manifest.size) {
    console.log(`[font] 现有文件大小 ${size}B ≠ 清单 ${manifest.size}B，重取`)
    return false
  }
  const sha = sha256Of(target)
  if (sha !== manifest.sha256) {
    console.log(`[font] 现有文件 SHA256 不匹配（${sha.slice(0, 12)}…），重取`)
    return false
  }
  return true
}

function tarExe() {
  // Git Bash 里的 GNU tar 不认 zip；Windows 自带的 System32\tar.exe 是 bsdtar。
  return process.platform === 'win32'
    ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar'
}

async function download(url, dest) {
  console.log(`[font] 下载 ${url}`)
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'miai-biancheng-font-fetch/1.0' }
  })
  if (!res.ok || !res.body) {
    throw new Error(`下载失败：HTTP ${res.status} ${res.statusText}`)
  }
  const total = Number(res.headers.get('content-length') ?? 0)
  let seen = 0
  let lastPct = -1
  const body = Readable.fromWeb(res.body)
  body.on('data', (chunk) => {
    seen += chunk.length
    if (total > 0) {
      const pct = Math.floor((seen / total) * 100)
      if (pct >= lastPct + 10) {
        lastPct = pct
        console.log(`[font] ${pct}%（${(seen / 1048576).toFixed(1)} MB / ${(total / 1048576).toFixed(1)} MB）`)
      }
    }
  })
  await pipeline(body, createWriteStream(dest))
  console.log(`[font] 下载完成：${(statSync(dest).size / 1048576).toFixed(1)} MB`)
}

async function main() {
  const force = process.argv.includes('--force')
  const zipArgIdx = process.argv.indexOf('--zip')
  const localZip = zipArgIdx >= 0 ? process.argv[zipArgIdx + 1] : undefined
  const manifest = readManifest()
  const target = join(FONT_DIR, manifest.file)
  mkdirSync(FONT_DIR, { recursive: true })

  if (!force && alreadyGood(target, manifest)) {
    console.log(`[font] ${manifest.file} 已就绪（SHA256 校验通过）`)
    return
  }

  const work = join(tmpdir(), `miai-font-${process.pid}`)
  mkdirSync(work, { recursive: true })
  const zipPath = localZip ? resolve(localZip) : join(work, 'MiSans.zip')
  try {
    if (localZip) {
      if (!existsSync(zipPath)) throw new Error(`--zip 指定的文件不存在：${zipPath}`)
      console.log(`[font] 使用本地包 ${zipPath}`)
    } else {
      try {
        await download(manifest.url, zipPath)
      } catch (err) {
        throw new Error(
          `${err instanceof Error ? err.message : String(err)}\n` +
            `网络不可用时可以手动下载：${manifest.url}\n` +
            `然后用 node scripts/fetch-font.mjs --zip <下载到的 MiSans.zip>\n` +
            `（脚本会自动解出 ${manifest.zipEntry} 并校验，无需手动改文件名）`
        )
      }
    }
    // 只解一个条目（整包 200MB+，没必要全展开）
    const r = spawnSync(tarExe(), ['-xf', zipPath, '-C', work, manifest.zipEntry], {
      encoding: 'utf8'
    })
    if (r.status !== 0) {
      throw new Error(`解包失败（tar exit ${r.status}）：${(r.stderr ?? '').trim()}`)
    }
    const extracted = join(work, ...manifest.zipEntry.split('/'))
    if (!existsSync(extracted)) {
      throw new Error(`解包后找不到 ${extracted}`)
    }
    const size = statSync(extracted).size
    const sha = sha256Of(extracted)
    if (size !== manifest.size || sha !== manifest.sha256) {
      throw new Error(
        `字体校验失败：期望 ${manifest.sha256}/${manifest.size}B，实际 ${sha}/${size}B。\n` +
          `官方包可能更新了；核对后同步修改 ${MANIFEST_PATH} 里的 sha256/size。`
      )
    }
    // 先写临时名再 rename：半截文件不会被下一次构建当成"已就绪"
    const staged = join(FONT_DIR, `.${manifest.file}.partial`)
    try {
      // readFileSync + writeFileSync 对 6.5MB 足够；避免 copyFileSync 跨盘时的奇怪失败
      const { writeFileSync } = await import('node:fs')
      writeFileSync(staged, readFileSync(extracted))
      renameSync(staged, target)
    } finally {
      rmSync(staged, { force: true })
    }
    console.log(`[font] 就绪：${target}（SHA256 ${manifest.sha256.slice(0, 16)}…）`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(`[font] 失败：${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
})
