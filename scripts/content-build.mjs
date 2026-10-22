#!/usr/bin/env node
/**
 * 内容打包器 —— content/** → src/renderer/src/generated/content-bundle.json
 *
 * bundle 结构：
 *   { version, builtAt, glossary, errorLib, lessons[], searchIndex[] }
 * 其中 lessons[] 按大纲顺序排列，required 已按缺省解锁规则解析为显式列表；
 * searchIndex[] 供渲染进程内存全文检索（正文剥标记 + 代码原文 + 题干）。
 *
 * 用法：npm run build:content（开发期允许缺课打包部分内容）
 *       npm run build:content:strict（发布前严格构建，缺失即失败）
 *
 * 【"把无限题库并进来"这一段自己怎么验】
 * 题库是 2026-09-15 才接进来的，而当天**全部 4 份题库文件都是孤儿** ——
 * 它们指向的课一节都还没写正文。于是真产包里一道题库题都没有，
 * **这段代码一次都没被走过，四道闸门却全绿**。
 *
 * `../_bankmerge-fixture/`（仓库的兄弟目录）把那次补验固化下来可重跑：
 *
 *     node ../_bankmerge-fixture/build.mjs
 *     cd ../_bankmerge-fixture && node ../miai-biancheng/scripts/content-build.mjs --allow-missing
 *
 * 期望：**盘上 5 份题库只报 4 份孤儿**（被挂到有正文的课上的那份不在名单里）、
 * 那一课多出 1 道题且排在最后、搜索索引里搜得到它的题干。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CONTENT = path.join(ROOT, 'content')
const OUT_DIR = path.join(ROOT, 'src', 'renderer', 'src', 'generated')
const OUT_FILE = path.join(OUT_DIR, 'content-bundle.json')

// ---------------------------------------------------------------- 工具

const glossary = JSON.parse(fs.readFileSync(path.join(CONTENT, 'glossary.json'), 'utf8'))
const syllabus = JSON.parse(fs.readFileSync(path.join(CONTENT, 'syllabus.json'), 'utf8'))

const byLangStage = new Map()
for (const mod of syllabus.modules) byLangStage.set(`${mod.lang}:${mod.stage}`, mod.lessons)

/**
 * 缺省解锁规则：同阶段上一课；阶段首课=上一阶段末课；stage1 首课=common-01；
 * **再没有就是天然无前置**。
 *
 * ⚠️ 【这里原来有一句 `if (lesson.lang === 'common') return []`，2026-09-15 删掉】
 * 它把**整个 common 模块的前置一口气吞掉了**：凡是 frontmatter 没写 `required`
 * 的 common 课全都变成「无前置、开局就能点」，而大纲自己写的规则是
 * 「**lesson 未写 required 时**：同阶段上一课」—— 没把 common 排除在外。
 *
 * 它看起来像在防崩溃（common 的 stage 是 0，`stage - 1` 会去取 `common:-1`），
 * 但真正需要兜底的**只有模块第一课**这一种情况，一句 `prevStage ?? []` 就够。
 * 代价是它很安静：02/03/04 显式写了链子所以看不出问题，05 没写就悄悄变成自由课 ——
 * 学员可以在「什么是编程」之前先点开「条件判断」。
 *
 * 这条规则在本目录的 validate / gen-batch 里**各有一份逐字相同的副本**，
 * 改一处必须三处一起改（三份都是这个形状，grep `天然无前置` 能找到全部）。
 */
function effectiveRequired(lesson) {
  if (lesson.required && lesson.required.length > 0) return lesson.required
  const lessons = byLangStage.get(`${lesson.lang}:${lesson.stage}`) ?? []
  const idx = lessons.findIndex((l) => l.id === lesson.id)
  if (idx > 0) return [lessons[idx - 1].id]
  if (lesson.stage === 1) return [...syllabus.unlockDefaults.stage1First]
  const prevStage = byLangStage.get(`${lesson.lang}:${lesson.stage - 1}`)
  if (!prevStage || prevStage.length === 0) return []
  return [prevStage[prevStage.length - 1].id]
}

/** 极简 frontmatter 解析（与 validate 脚本同款子集） */
function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) return { data: null, body: text }
  const end = text.indexOf('\n---', 4)
  if (end === -1) throw new Error('frontmatter 未闭合')
  const data = {}
  for (const line of text.slice(4, end).split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/)
    if (!m) continue
    data[m[1]] = parseYamlValue(m[2])
  }
  return { data, body: text.slice(end + 4).replace(/^\r?\n/, '') }
}

function parseYamlValue(val) {
  val = val.trim()
  if (val === '') return ''
  if (val.startsWith('[')) {
    const inner = val.slice(1, -1).trim()
    if (inner === '') return []
    return inner.split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''))
  }
  if (/^-?\d+$/.test(val)) return Number(val)
  return val.replace(/^["']|["']$/g, '')
}

/** 由 id 找目录（与 validate 脚本同规则） */
function lessonDirOf(id) {
  if (id.startsWith('common-')) return findDir(path.join(CONTENT, 'common'), id.slice('common-'.length))
  const m = id.match(/^(c|cpp|java|python)-stage(\d)-(\d+)$/)
  if (!m) return null
  return findDir(path.join(CONTENT, m[1], `stage${m[2]}`), m[3])
}

function findDir(base, num) {
  if (!fs.existsSync(base)) return null
  const d = fs.readdirSync(base).find((d) => d.startsWith(`${num}-`))
  return d ? path.join(base, d) : null
}

/*
 * ── 无限题库：把生成出来的 codefix / codewrite 并进课里 ─────────────────
 *
 * 【为什么是"并进 questions"，而不是在别处新开一条链路】
 * `buildPool()`（src/shared/challenge.ts:41）只认 `Lesson.questions` **一个**来源。
 * 并进这个数组，练习页、每日挑战抽题池、错题本、`learned` 过滤**全部零应用改动生效**。
 * 换成新开一条链路，就得在那四处各加一次"两个来源取并集"的分支 —— 而分支就是漂移的入口。
 *
 * 来源是 `content/challenge-bank/<lang>/<lessonId>.json`，由 `gen-bank.mjs` 产出、
 * `check-bank.mjs` 复核。**它的每一道题的标准答案都是本机真跑算出来的**，
 * 所以这里可以放心直接搬：打包器不判题，判题归 `check:bank` 那道闸门。
 */
const BANK_DIR = path.join(CONTENT, 'challenge-bank')
const banksTaken = new Set()

function takeBankItems(lessonId, lang) {
  const rel = path.join(lang, `${lessonId}.json`)
  const p = path.join(BANK_DIR, rel)
  if (!fs.existsSync(p)) return []
  banksTaken.add(rel.replace(/\\/g, '/'))
  const data = JSON.parse(fs.readFileSync(p, 'utf8'))
  return Array.isArray(data.items) ? data.items : []
}

/** 正文剥 Markdown 标记 + 收集代码原文，用于搜索索引 */
function buildSearchText(body) {
  let text = body
  const codes = []
  text = text.replace(/```(\S*)[\s\S]*?```/g, (_, lang, code) => {
    codes.push(code)
    return ' '
  })
  text = text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*:::\s*\w+.*$/gm, '')
  return text + '\n' + codes.join('\n')
}

// ---------------------------------------------------------------- 主流程

const errors = []
const lessons = []
const searchIndex = []

for (const mod of syllabus.modules) {
  for (const [i, syl] of mod.lessons.entries()) {
    // lang/stage 在模块层，order 用数组下标（1 起）
    const full = { ...syl, lang: mod.lang, stage: mod.stage, order: i + 1 }
    const dir = lessonDirOf(full.id)
    if (!dir) {
      errors.push(`内容缺失：${full.id}（尚未生成，跑 validate:content 看进度）`)
      continue
    }
    // ⚠️ 「目录在」不等于「写完了」。写手的落盘顺序是**先建目录 → 再落 lesson.md → 最后落
    // questions.json**，所以并发写内容的每一刻，盘上都必然躺着几节半成品课。
    // 原来这里是无条件 readFileSync：文件没到就 ENOENT 把**整支打包崩掉**，而 `--allow-missing`
    // 救不了它 —— 那个开关管的是「目录都没有」，管不到「目录在、文件没齐」。
    // 2026-09-16 实踩：c-stage2 的写手正写到 05-struct，`npm run build:content` 当场 ENOENT 退出，
    // **那一整批新内容（java 01-04 的 48 道题库、python-stage3-11~15 五课）一道都没进产包**，
    // 而四道闸门全绿 —— 正是「四道闸门绿 ≠ 应用里有了」那句老话。
    // 半成品课与「还没写」同罪同罚：记一笔、跳过这一课；严格构建（不带 --allow-missing）照样硬失败。
    const mdPath = path.join(dir, 'lesson.md')
    const qPath = path.join(dir, 'questions.json')
    const notYet = []
    if (!fs.existsSync(mdPath)) notYet.push('lesson.md')
    if (!fs.existsSync(qPath)) notYet.push('questions.json')
    if (notYet.length > 0) {
      errors.push(`内容缺失：${full.id}（目录在、${notYet.join(' 和 ')} 还没落盘，多半是写手正写到一半）`)
      continue
    }
    const md = fs.readFileSync(mdPath, 'utf8')
    const { data, body } = parseFrontmatter(md)
    const questions = JSON.parse(fs.readFileSync(qPath, 'utf8'))

    // 手写的题在前、题库产出的题在后：课内的题仍然按写的顺序排，
    // 题库那部分相当于"这一课的额外练习题"，按 id 顺序追加。
    const bankItems = takeBankItems(full.id, full.lang)
    const seenQid = new Set()
    const allQuestions = []
    for (const q of [...questions.questions, ...bankItems]) {
      // 手写题和题库题撞 id 的话，错题本的 key 会指向同一格 —— 后一道永远覆盖前一道的作答
      if (q?.id && seenQid.has(q.id)) {
        errors.push(`题号重复：${full.id} 里有两道 id 都是「${q.id}」的题（后一道会被前一道的作答覆盖）`)
        continue
      }
      if (q?.id) seenQid.add(q.id)
      allQuestions.push(q)
    }

    lessons.push({
      id: full.id,
      lang: full.lang,
      stage: full.stage,
      order: full.order,
      title: data.title || full.title,
      tags: data.tags || full.tags || [],
      // 【课自己写的 required 优先，缺省规则只在它没写时兜底】
      // 这里原来传的是 `full`，而 `full.required` 来自 syllabus ——
      // 而 syllabus 里**一条 required 都没有**，于是 `effectiveRequired` 永远走缺省推算，
      // **frontmatter 里写的 required 被静默忽略**：主人改了 lesson.md 的解锁关系，
      // 界面上一点变化都没有，也没有任何提示。实测 common-13 写的是 `[common-06]`，
      // 打包器算出来是 `[]`，两边对不上。
      // 按 syllabus.unlockDefaults 自己的说明——「lesson **未写 required 时**的缺省规则」——
      // 写了就该听课自己的，这也正是 content-validate.mjs 检查的那一份。
      required: effectiveRequired({ ...full, required: data.required }),
      crossRefs: data.crossRefs || full.crossRefs || [],
      compare: data.compare || [],
      estMinutes: data.estMinutes ?? 15,
      keywords: data.keywords || [],
      body,
      questions: allQuestions
    })
    searchIndex.push({
      id: full.id,
      lang: full.lang,
      stage: full.stage,
      title: data.title || full.title,
      tags: data.tags || full.tags || [],
      keywords: data.keywords || [],
      text: buildSearchText(body + '\n' + allQuestions.map((q) => q.stem).join('\n'))
    })
  }
}

/*
 * ⚠️ 【有正文的语言课，却一道真跑题都没有 —— 违反 `docs/09` 的配比】
 *
 * `docs/09`（2026-09-15 修订）要求每节**语言课**至少有 1 道 `codefix` + 1 道 `codewrite`，
 * 而且这两类**只能来自题库**（不由 gen-batch 生成）。也就是说这两道题是否有，
 * 取决于"有没有人给这一课写模板、跑 gen-bank" —— 一件**纯人肉记得**的事。
 *
 * 人肉记得的事一定会忘。忘了的表现还特别安静：课照常上线、学得下去、
 * 只是**这一课永远没有真跑题**，而界面上完全看不出来（别的课有，它没有，
 * 学员只会以为"这节课就是这样的"）。
 *
 * 所以这里把它变成一句机器喊出来的话。通用知识课（`common-*`）不在其列 ——
 * 它们本来就不该塞真跑代码题。
 */
const 缺真跑题 = []
for (const l of lessons) {
  if (l.lang === 'common') continue
  const n = l.questions.filter((q) => q.type === 'codefix').length
  const w = l.questions.filter((q) => q.type === 'codewrite').length
  if (n < 1 || w < 1) {
    缺真跑题.push(`${l.id}（codefix ${n} 道 / codewrite ${w} 道）`)
  }
}
if (缺真跑题.length > 0) {
  console.warn(`\n⚠️ 有 ${缺真跑题.length} 节语言课没凑齐真跑题（docs/09 要求各至少 1 道）：`)
  for (const s of 缺真跑题) console.warn(`     ${s}`)
  console.warn('   写模板：scripts/bank/templates/<templateId>.json，然后 node scripts/gen-bank.mjs\n')
}

/*
 * ⚠️ 【有题库文件、却没有任何一课读得到它 —— 必须大声喊出来】
 *
 * 题库是按 `<lang>/<lessonId>.json` 索引的，而课是从**大纲**遍历来的。
 * 两者只要错位 —— 课号不在大纲里、那一课还没写正文、语言目录放错了 ——
 * 那份题库就**一个字都到不了学员眼前**，而且不会有任何报错。
 *
 * 这正是"产了但没人看得见"的老毛病换了个地方复发：生成器那边已经栽过一次
 * （计数器说"新产 10 道"、文件里只有 3 道），那次是靠写完重新读盘自检抓住的。
 * 这一次换个方向查：从**产包**这一头，看有多少份题库没人认领。
 */
let orphanBanks = []
if (fs.existsSync(BANK_DIR)) {
  orphanBanks = fs
    .globSync('*/*.json', { cwd: BANK_DIR })
    .map((r) => r.replace(/\\/g, '/'))
    .filter((r) => !banksTaken.has(r))
    .sort()
  if (orphanBanks.length > 0) {
    console.warn(`\n⚠️ 有 ${orphanBanks.length} 份题库没有任何课读得到它（课号不在大纲里，或那一课还没写正文）：`)
    for (const r of orphanBanks) console.warn(`     content/challenge-bank/${r}`)
    console.warn('   这些题**不会被任何学员看到**。对着跑 `npm run check:bank` 看它怎么说。\n')
  }
}

const errorLib = {}
for (const f of fs.readdirSync(path.join(CONTENT, 'error-lib'))) {
  if (!f.endsWith('.json')) continue
  errorLib[f.replace('.json', '')] = JSON.parse(fs.readFileSync(path.join(CONTENT, 'error-lib', f), 'utf8')).rules
}

/**
 * 【只有**有正文**的课才有资格当前置 —— 这条不写，内容会被永久锁死】
 *
 * 解锁规则是「前置全部已学完」，而**没有正文的课永远无法被标记为已学**
 * （点它只会弹一句「还在备课中」，见 lib/openLesson.ts）。
 * 于是只要某节课的前置恰好没生成，那节课就**永远打不开**，而且界面上
 * 看不出任何异常：它只显示「还锁着」，锁着的原因是另一节不存在的课。
 *
 * 这不是假想 —— `c-stage2-04`(动态内存) 的前置是 `c-stage2-03`(指针)，
 * `c-stage3-03`(链表) 的前置是 `c-stage3-02`(位运算)，
 * `java-stage1-16`(包与import) 的前置是 `java-stage1-04`(Scanner)。
 * 这三节课都有正文，却因为主人当初是**挑着生成**的、前置不在盘上，全都进不去。
 *
 * ⚠️ 这是**构建期**的过滤，不是把 `required` 字段删掉：主人哪天把前置补出来，
 * 重新跑一次 build 就自动恢复了 —— 数据源（frontmatter / 大纲缺省规则）一个字没动。
 */
const learnable = new Set(lessons.map((l) => l.id))
for (const l of lessons) {
  const dropped = l.required.filter((r) => !learnable.has(r))
  if (dropped.length > 0) {
    l.required = l.required.filter((r) => learnable.has(r))
    console.log(`  · ${l.id} 的前置 ${dropped.join(', ')} 尚无正文，本次不参与解锁`)
  }
}

// 大纲树（含 hasContent 标记）：内容未生成完时，UI 也能列出全部 194 课的完整结构
const outline = syllabus.modules.map((mod) => ({
  lang: mod.lang,
  stage: mod.stage,
  lessons: mod.lessons.map((l, i) => ({
    id: l.id,
    title: l.title,
    tags: l.tags,
    order: i + 1,
    hasContent: !!lessonDirOf(l.id)
  }))
}))

const bundle = {
  version: 1,
  builtAt: new Date().toISOString(),
  glossary,
  errorLib,
  lessons,
  outline,
  searchIndex
}

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT_FILE, JSON.stringify(bundle), 'utf8')

const allowMissing = process.argv.includes('--allow-missing')

if (errors.length > 0) {
  console.error(`内容缺失 ${errors.length} 课，未进入 bundle（其余照常打包）：`)
  for (const e of errors) console.error('  - ' + e)
} else {
  console.log(`打包完成：${lessons.length} 课全量入库 ✓`)
}
const kb = Math.round(fs.statSync(OUT_FILE).size / 1024)
console.log(`输出：${path.relative(ROOT, OUT_FILE)}（${kb} KB）`)
if (errors.length > 0 && !allowMissing) {
  console.error('缺失即失败：发布前请确保内容齐全，或确认已跑过 validate:content')
  process.exit(1)
}
// 严格构建（发布前）时，没人认领的题库同样是硬故障：题写好了却送不到学员面前
if (orphanBanks.length > 0 && !allowMissing) {
  console.error(`严格构建：${orphanBanks.length} 份题库没有归属的课（见上文），不会静默放行`)
  process.exit(1)
}
// 同上：语言课缺真跑题在发布前也是硬故障
if (缺真跑题.length > 0 && !allowMissing) {
  console.error(`严格构建：${缺真跑题.length} 节语言课缺真跑题（见上文），不会静默放行`)
  process.exit(1)
}
