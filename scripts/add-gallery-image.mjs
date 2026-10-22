#!/usr/bin/env node
/**
 * 把一张新奖励图**一次落齐四处**接进图库（V1-38「新图加进来就能自动生效」的机制件）。
 *
 * 用法：
 *   node scripts/add-gallery-image.mjs <源图.png|源图.gif> --title=中文名 \
 *        [--source=REWARD3_000_00001_.png] [--flavor=A] [--seed=123456] \
 *        [--root=<仓库根>] [--allow-dup-title] [--allow-same-file]
 *
 * 落在哪四处（缺一处的后果各不相同）：
 *   ① 文件  src/renderer/src/assets/gallery/gNN.png|gNN.gif  ← 文件侧唯一真源（glob 自己认）
 *   ② 身份  src/shared/gallery.ts 的 GALLERY_IDS     ← 要落用户档案，永不改
 *   ③ 名字  src/renderer/src/lib/copy.ts 的 GALLERY.TITLES ← 界面文案（文案闸门管）
 *   ④ 台账  src/renderer/src/assets/gallery-对照表.json    ← 给人查来历的表
 *
 * 为什么要有这个脚本（而不是照着注释手改四处）：
 *   漏②③ → 图发不出去 / 弹窗写「undefined」；漏① → 发给用户一张裂图；
 *   漏④ → 将来查不到这张的来历。①②③有三方对账单测兜底，但「改的时候少改一处」
 *   这件事本身没有东西兜 —— 把四处绑成一次动作、写完逐个回读校验，最省心。
 *
 * 纪律（与图库注释一致）：
 *   · 只认真 PNG / GIF（魔数校验）。**本脚本绝不生成图片、绝不塞占位图** ——
 *     没有真图就不要进池子。
 *   · 源图与库里已有某张字节级相同 → 默认拒绝（防手滑重复收录），
 *     确实要放重复图加 --allow-same-file。
 *   · 标题撞车（和现有某张同名）→ 默认拒绝，加 --allow-dup-title 放行。
 *   · 写盘后**自校验**（四处逐一回读断言）；任何一处不过 → 非零退出并列出。
 *     「写完了就当成功」是禁止的。
 *
 * 自测（不碰真仓库）：
 *   node scripts/add-gallery-image.mjs <png> --title=测试 --root=<沙箱根>
 *   沙箱根里只要有 src/shared/gallery.ts、src/renderer/src/lib/copy.ts、
 *   src/renderer/src/assets/gallery-对照表.json、src/renderer/src/assets/gallery/ 四样。
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}
function die(msg, detail) {
  console.error(`✗ ${msg}`)
  if (detail) console.error(detail)
  process.exit(2)
}

// ── 参数 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flag = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const has = (name) => argv.includes(`--${name}`)
const src = argv.find((a) => !a.startsWith('--'))
const title = flag('title')
const root = path.resolve(flag('root') ?? path.join(HERE, '..'))

if (!src) fail('用法：node scripts/add-gallery-image.mjs <源图.png|源图.gif> --title=中文名 [--source=… --flavor=… --seed=…]')
if (!existsSync(src)) fail(`源图不存在：${src}`)
if (!title || !title.trim()) fail('缺少 --title=中文名（会显示在奖励弹窗上，不能留空）')

const GALLERY_TS = path.join(root, 'src', 'shared', 'gallery.ts')
const COPY_TS = path.join(root, 'src', 'renderer', 'src', 'lib', 'copy.ts')
const TABLE = path.join(root, 'src', 'renderer', 'src', 'assets', 'gallery-对照表.json')
const IMG_DIR = path.join(root, 'src', 'renderer', 'src', 'assets', 'gallery')
for (const p of [GALLERY_TS, COPY_TS, TABLE, IMG_DIR]) {
  if (!existsSync(p)) fail(`--root 下找不到 ${p} —— 这不是一个 miai-biancheng 仓库根`)
}

// ── 校验源图 ────────────────────────────────────────────────────────────
const bytes = readFileSync(src)
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const GIF87 = Buffer.from('GIF87a', 'ascii')
const GIF89 = Buffer.from('GIF89a', 'ascii')
/** 文件头 → 扩展名（认不出 → null；只认真图片，不认扩展名） */
function imageExt(b) {
  if (b.length >= 8 && b.subarray(0, 8).equals(PNG_MAGIC)) return 'png'
  if (b.length >= 6 && (b.subarray(0, 6).equals(GIF87) || b.subarray(0, 6).equals(GIF89))) return 'gif'
  return null
}
const ext = imageExt(bytes)
if (!ext) {
  fail(`不是 PNG/GIF（魔数不符）：${src}\n  只认真 PNG/GIF；jpg/webp 请先转好再接入。`)
}
const sha = createHash('sha256').update(bytes).digest('hex')
const size = bytes.length
if (size > 8 * 1024 * 1024) {
  console.warn(`⚠ 这张图 ${(size / 1024 / 1024).toFixed(2)}MiB，明显大于现有奖励图（静图约 1MiB 级，GIF 通常 2~5MiB），会推高打包体积——确认是有意为之再继续。`)
}

// 同字节图已在库里？→ 默认拒绝
const dupIds = []
for (const name of readdirSync(IMG_DIR).filter((n) => /\.(png|gif)$/i.test(n))) {
  const h = createHash('sha256').update(readFileSync(path.join(IMG_DIR, name))).digest('hex')
  if (h === sha) dupIds.push(name.replace(/\.(png|gif)$/i, ''))
}
if (dupIds.length > 0 && !has('allow-same-file')) {
  fail(`这张图和库里已有的一模一样（${dupIds.join(', ')}）。\n  换图请直接替换对应文件；确实要再放一张相同图，加 --allow-same-file。`)
}

// ── 读三份文本/表 ───────────────────────────────────────────────────────
const galleryText = readFileSync(GALLERY_TS, 'utf8')
const copyText = readFileSync(COPY_TS, 'utf8')
const tableRaw = readFileSync(TABLE, 'utf8')

// 名字查重
if (!has('allow-dup-title')) {
  const m = copyText.match(/TITLES:\s*\{([\s\S]*?)\n  \} as Record<string, string>/)
  if (!m) fail('copy.ts 里解析不出 TITLES 块 —— 文件结构变了？脚本需要跟着改。')
  const dup = [...m[1].matchAll(/g\d+:\s*'([^']*)'/g)].find((x) => x[1] === title.trim())
  if (dup) fail(`标题「${title.trim()}」和现有某张（${dup[0].split(':')[0]}）撞车了。\n  换个名字；确实要重名加 --allow-dup-title。`)
}
if (/['\\\r\n]/.test(title)) fail(`标题里有不允许的字符（英文引号/反斜杠/换行）：${JSON.stringify(title)}`)

// ── 分配下一个 id ───────────────────────────────────────────────────────
const gBlock = (() => {
  const start = galleryText.indexOf('export const GALLERY_IDS')
  if (start < 0) fail('gallery.ts 里找不到 GALLERY_IDS')
  const end = galleryText.indexOf('\n]', start)
  if (end < 0) fail('GALLERY_IDS 数组找不到闭合的 ]')
  return { start, end, text: galleryText.slice(start, end) }
})()
const nums = [...gBlock.text.matchAll(/'g(\d+)'/g)].map((x) => Number(x[1]))
if (nums.length === 0) fail('GALLERY_IDS 里一个 gNN 都没解析到')
const nextNum = Math.max(...nums) + 1
// 【2026-10-17 主人拍板：上限放开】奖励图扩池到 200（g01–g200），两位数编号
// 的老闸门（>99 时 fail 提示"和主人商量"）已完成使命退役 —— padStart(2) 对
// 三位数自然放行（g100 起）。这里只留一条防手滑的理智线。
if (nextNum > 999) fail(`下一个编号 g${nextNum} 到了四位数 —— 表尾可能被写坏了，先查`)
const id = `g${String(nextNum).padStart(2, '0')}`
const fileName = `${id}.${ext}`
const target = path.join(IMG_DIR, fileName)
// 两个扩展名都查：同 id 同时存在 png 和 gif 是非法状态（见 gallery.test.ts）
for (const e of ['png', 'gif']) {
  const p = path.join(IMG_DIR, `${id}.${e}`)
  if (existsSync(p)) fail(`目标文件已经存在：${p}（编号分配出岔子了，先查）`)
}

// ── 四处写入 ────────────────────────────────────────────────────────────
// 换行风格跟随原文件（本仓库工作区是 CRLF，git 侧归一化 LF）
const NL = galleryText.includes('\r\n') ? '\r\n' : '\n'

/** 在 GALLERY_IDS 的最后一项后追加（最后一项没逗号，补上）*/
function insertGalleryId(text) {
  const start = text.indexOf('export const GALLERY_IDS')
  const end = text.indexOf('\n]', start)
  const block = text.slice(start, end)
  const last = block.match(/\r?\n( *)('[^']*')\s*$/)
  if (!last) die('GALLERY_IDS 最后一项不是预期的 `  \'gNN\'` 形状，脚本拒绝盲改', block.slice(-120))
  const before = block.slice(0, last.index)
  const addition = `${NL}${last[1]}${last[2]},${NL}${last[1]}'${id}'`
  return text.slice(0, start) + before + addition + text.slice(end)
}

/** 在 TITLES 的最后一项后追加 */
function insertTitle(text) {
  const start = text.indexOf('TITLES: {')
  if (start < 0) fail('copy.ts 里找不到 TITLES: {')
  const end = text.indexOf('\n  } as Record<string, string>', start)
  if (end < 0) fail('TITLES 对象找不到闭合行')
  const block = text.slice(start, end)
  const last = block.match(/\r?\n( *)(g\d+):\s*'([^']*)'\s*$/)
  if (!last) die('TITLES 最后一项不是预期的 `gNN: \'…\'` 形状，脚本拒绝盲改', block.slice(-120))
  const before = block.slice(0, last.index)
  const addition = `${NL}${last[1]}${last[2]}: '${last[3]}',${NL}${last[1]}${id}: '${title.trim()}'`
  return text.slice(0, start) + before + addition + text.slice(end)
}

copyFileSync(src, target)
writeFileSync(GALLERY_TS, insertGalleryId(galleryText), 'utf8')
writeFileSync(COPY_TS, insertTitle(copyText), 'utf8')

// 台账：追加一条 + 说明里补一句（幂等：已经有了就不重复加）
const table = JSON.parse(tableRaw)
const entry = { 文件: fileName }
if (flag('source')) entry.来源 = flag('source')
if (flag('flavor')) entry.口味 = flag('flavor')
if (flag('seed') !== undefined) entry.种子 = Number(flag('seed'))
entry.字节 = size
table.入选.push(entry)
const NOTE = '新图接入：node scripts/add-gallery-image.mjs <png> --title=中文名（一次落四处：文件 / GALLERY_IDS / GALLERY.TITLES / 本表；写完自查）。'
if (!table.说明.some((s) => s.includes('add-gallery-image'))) table.说明.push(NOTE)
const tableNL = tableRaw.includes('\r\n') ? '\r\n' : '\n'
writeFileSync(TABLE, JSON.stringify(table, null, 2).replace(/\n/g, tableNL) + tableNL, 'utf8')

// ── 自校验：四处逐一回读 ────────────────────────────────────────────────
const problems = []
const back = readFileSync(GALLERY_TS, 'utf8')
const backBlock = (() => {
  const s = back.indexOf('export const GALLERY_IDS')
  return back.slice(s, back.indexOf('\n]', s))
})()
if (!new RegExp(`'${id}'`).test(backBlock)) problems.push(`② gallery.ts 的 GALLERY_IDS 里回读不到 '${id}'`)

const backCopy = readFileSync(COPY_TS, 'utf8')
const titleHits = [...backCopy.matchAll(new RegExp(`\\b${id}: '${title.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`, 'g'))].length
if (titleHits !== 1) problems.push(`③ copy.ts 里 ${id} 的标题回读命中 ${titleHits} 次（期望 1）`)

if (!existsSync(target) || statSync(target).size !== size) {
  problems.push(`① ${target} 不存在或字节数与源图不一致`)
}
const backTable = JSON.parse(readFileSync(TABLE, 'utf8'))
const lastEntry = backTable.入选[backTable.入选.length - 1]
if (lastEntry?.文件 !== fileName || lastEntry?.字节 !== size) {
  problems.push(`④ 对照表.json 最后一条不是 ${fileName}（或字节数不符）`)
}
if (problems.length > 0) {
  die('自校验没过，四处可能有半写状态，逐条如下：', problems.map((p) => `  · ${p}`).join('\n'))
}

// ── 成功 ────────────────────────────────────────────────────────────────
console.log(`✓ ${id} 已接入图库（${(size / 1024).toFixed(0)}KiB，四处落齐并逐个回读校验通过）`)
console.log(`  ① 文件  assets/gallery/${fileName}`)
console.log(`  ② 身份  GALLERY_IDS += '${id}'`)
console.log(`  ③ 名字  GALLERY.TITLES.${id} = '${title.trim()}'`)
console.log(`  ④ 台账  gallery-对照表.json 入选 += ${fileName}`)
console.log('下一步：')
console.log('  · 对账三条：npx vitest run src/shared/__tests__/gallery.test.ts src/renderer/src/lib/__tests__/gallery.test.ts src/renderer/src/lib/__tests__/copy.test.ts')
console.log('  · dev 模式立刻生效；打包版要重新打包才带上（glob 是编译期的）')
