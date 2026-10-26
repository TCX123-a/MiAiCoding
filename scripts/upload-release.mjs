#!/usr/bin/env node
/**
 * Fork 上游仓库 → 在自己的仓库上建 Release → 上传安装包。
 *
 * 用法：
 *   GITHUB_TOKEN=ghp_xxx node scripts/upload-release.mjs
 *
 * 可选环境变量：
 *   FORK_FROM       要 fork 的上游，默认 TCX123-a/MiAiCoding
 *   RELEASE_REPO    目标仓库；不填则自动用「你的账号/MiAiCoding」
 *   RELEASE_TAG     默认 v<package.json 的 version>
 *   RELEASE_NAME    Release 标题
 *   RELEASE_NOTES   说明文件路径，默认 release/RELEASE_NOTES_v<version>.md
 *   DRY_RUN=1       只打印计划，不 fork、不创建、不上传
 *
 * 设计取舍：
 * - 传输交给系统 curl（自动走系统代理、支持大文件流式上传），Node 只拼 JSON、解析响应；
 * - Token 只出现在 curl 的参数里，脚本不把它打印到输出；
 * - 每一步都可重入：仓库已存在就不 fork、Release 已存在就复用、同名同大小 asset 就跳过。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
const FORK_FROM = process.env.FORK_FROM || 'TCX123-a/MiAiCoding'

// 版本一律以 package.json 为准，避免发版时出现「标签 v0.1.1、包装 0.1.0」的错位
const VERSION = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version

const TAG = process.env.RELEASE_TAG || `v${VERSION}`
const NAME = process.env.RELEASE_NAME || `咪爱编程 v${VERSION} · Windows x64`
const NOTES_PATH = resolve(process.env.RELEASE_NOTES || `release/RELEASE_NOTES_v${VERSION}.md`)
const DRY_RUN = process.env.DRY_RUN === '1'

const ASSETS = [
  `release/miai-biancheng-${VERSION}-setup.exe`,
  `release/miai-biancheng-${VERSION}-win-x64-portable.zip`
].map((p) => resolve(p))

const GH = 'https://api.github.com'

function fail(msg) {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

/** 同步 sleep（脚本整体是同步流程，用 Atomics 比空转 sleep 命令干净）。 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * 调 curl。Windows 的 schannel 后端拿不到证书吊销列表时会拒绝握手
 * （CRYPT_E_NO_REVOCATION_CHECK），拿不到吊销列表本就无法校验，直接跳过即可。
 * 注意：带进度条时 stdio 是直通的，捕获不到 stderr 再做重试判断，
 * 所以这里在 Windows 上无条件带上 --ssl-no-revoke。
 */
const SSL_FLAGS = process.platform === 'win32' ? ['--ssl-no-revoke'] : []

function curl(args, { progress = false } = {}) {
  try {
    return execFileSync(
      'curl',
      ['-sS', ...SSL_FLAGS, ...(progress ? ['--progress-bar'] : []), ...args],
      {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: progress ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe']
      }
    )
  } catch (err) {
    // 报错信息里会带完整命令行（含 token），输出前先脱敏
    const msg = String(err.stderr || err.message || '')
    throw new Error(msg.replaceAll(TOKEN, '***').trim())
  }
}

function parseJson(text, what) {
  try {
    return JSON.parse(text)
  } catch {
    fail(`${what} 返回的不是 JSON：${String(text).slice(0, 300)}`)
  }
}

const auth = ['-H', `Authorization: Bearer ${TOKEN}`, '-H', 'Accept: application/vnd.github+json']

const getJson = (url, what) => parseJson(curl([...auth, url]), what)
const postJson = (url, body) =>
  parseJson(
    curl([...auth, '-H', 'Content-Type: application/json', '-X', 'POST', '--data-binary', body, url]),
    `POST ${url}`
  )

// ---------------------------------------------------------------- 前置检查

if (!TOKEN) {
  fail('缺少 GITHUB_TOKEN。先设置：export GITHUB_TOKEN=ghp_xxx')
}
if (!existsSync(NOTES_PATH)) {
  fail(`找不到 Release 说明：${NOTES_PATH}`)
}
for (const file of ASSETS) {
  if (!existsSync(file)) {
    fail(`找不到产物：${file}（先执行 npm run package:release）`)
  }
}

// ---------------------------------------------------------------- 1. 确认身份与目标仓库

const me = getJson(`${GH}/user`, 'GET /user')
if (!me.login) {
  fail(`Token 无效：${me.message || '读取 /user 失败'}`)
}
console.log(`登录账号：${me.login}`)

const upstreamName = FORK_FROM.split('/')[1]
const REPO = process.env.RELEASE_REPO || `${me.login}/${upstreamName}`
console.log(`目标仓库：${REPO}`)

// ---------------------------------------------------------------- 2. 需要时 fork

let repo = getJson(`${GH}/repos/${REPO}`, `GET ${REPO}`)

if (!repo.id) {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] 将 fork ${FORK_FROM} → ${REPO}`)
  } else {
    console.log(`仓库不存在，开始 fork：${FORK_FROM} → ${REPO} …`)
    const forked = postJson(`${GH}/repos/${FORK_FROM}/forks`, JSON.stringify({ default_branch_only: false }))
    if (!forked.id && forked.message && !/already exists/i.test(forked.message)) {
      fail(`fork 失败：${forked.message}`)
    }
    // fork 是异步的，轮询到可读为止（通常 1-3 秒）
    for (let i = 0; i < 40; i += 1) {
      sleepSync(2000)
      repo = getJson(`${GH}/repos/${REPO}`, `GET ${REPO}`)
      if (repo.id) {
        console.log(`fork 就绪（第 ${i + 1} 次轮询）`)
        break
      }
    }
    if (!repo.id) {
      fail(`fork 已提交但仓库还没就绪，等一分钟再重跑本脚本即可：https://github.com/${REPO}`)
    }
  }
} else {
  console.log('目标仓库已存在，直接复用')
}

if (!DRY_RUN) {
  const canPush = Boolean(repo.permissions && repo.permissions.push)
  console.log(`写权限：${canPush ? '有 ✓' : '没有 ✗'}`)
  if (!canPush) {
    fail(`当前账号对 ${REPO} 没有写权限，无法创建 Release。请确认仓库所有者是 ${me.login}。`)
  }
}

// ---------------------------------------------------------------- 3. Release

let release = null
const existing = DRY_RUN ? null : getJson(`${GH}/repos/${REPO}/releases/tags/${TAG}`, `GET release ${TAG}`)

if (existing && existing.id) {
  release = existing
  console.log(`已存在 Release：${TAG}（id=${release.id}），复用并补齐缺失 asset`)
} else if (DRY_RUN) {
  console.log(`[DRY_RUN] 将在 ${REPO} 创建 Release：${TAG}`)
} else {
  const body = JSON.stringify({
    tag_name: TAG,
    target_commitish: 'main',
    name: NAME,
    body: readFileSync(NOTES_PATH, 'utf8'),
    draft: false,
    prerelease: false
  })
  release = postJson(`${GH}/repos/${REPO}/releases`, body)
  if (!release.id) {
    fail(`创建 Release 失败：${release.message}`)
  }
  console.log(`已创建 Release：${TAG}（id=${release.id}）`)
}

// ---------------------------------------------------------------- 4. 上传

if (DRY_RUN) {
  for (const file of ASSETS) {
    console.log(`[DRY_RUN] 待上传：${file.split(/[\\/]/).pop()}（${(statSync(file).size / 1048576).toFixed(0)} MB）`)
  }
  process.exit(0)
}

const uploadUrl = String(release.upload_url).replace(/\{.*\}$/, '')
const uploaded = new Map((release.assets || []).map((a) => [a.name, a.size]))

for (const file of ASSETS) {
  const name = file.split(/[\\/]/).pop()
  const size = statSync(file).size
  if (uploaded.get(name) === size) {
    console.log(`跳过（已存在同大小）：${name}`)
    continue
  }
  console.log(`上传：${name}（${(size / 1048576).toFixed(0)} MB），大文件请耐心等…`)
  curl(
    [
      ...auth,
      '-H', 'Content-Type: application/octet-stream',
      '-X', 'POST',
      '--data-binary', `@${file}`,
      `${uploadUrl}?name=${encodeURIComponent(name)}`
    ],
    { progress: true }
  )
  console.log(`  ✓ ${name}`)
}

console.log(`\n完成：https://github.com/${REPO}/releases/tag/${TAG}`)
