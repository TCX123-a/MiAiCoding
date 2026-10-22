#!/usr/bin/env node
/**
 * 无限题库的闸门 —— 独立复核 `content/challenge-bank/` 里的每一道题。
 *
 * 【它和 `gen-bank.mjs` 是什么关系】
 * 生成器**算**，闸门**查**。两边用的是**同一份判据**（`lib/bank-verify.mjs`），
 * 但闸门不信任生成器的脸色 —— 它从磁盘上把文件读回来，重新跑一遍。
 * 理由就是那句老话：生成器说"我产出来的都是对的"和"文件里那些确实是对的"是两件事。
 * 中间隔着写盘、隔着 git、隔着别人后来可能手改的每一个字。
 *
 * 【增量验证（不做的话这道闸门会慢到没人跑）】
 * 一道题要起 2~3 次编译器。1100 道题全跑一遍是几分钟 —— 没人愿意在每次提交前等它，
 * 于是它会被跳过，于是它等于不存在。
 *
 * 所以只验**验证戳对不上**的那些：条目里存着 `verified.hash`（影响判分的内容的
 * sha256 前 16 位），闸门现算一遍，一样就**信任它，不跑**。改了内容而没重新盖章的，
 * 哈希自然对不上，于是被揪出来。
 *
 * ⚠️ 这不是"用哈希代替验证"，而是"用哈希决定**该重新验哪些**"。
 * 哈希本身证明不了任何题是对的 —— 它只证明"从盖章到现在，这道题没人动过"。
 * 而这条链的起点（盖章那一刻）是被真跑验证过的：`gen-bank.mjs` 产完当场判一遍。
 *
 * 用法：
 *   npm run check:bank              # 增量：只验戳对不上的
 *   node scripts/check-bank.mjs --all      # 全量：每道都真跑
 *   node scripts/check-bank.mjs --list     # 只列题，不跑
 *   node scripts/check-bank.mjs python-stage1-08   # 只查一课
 *
 * ⚠️ **过滤条件匹配不到任何课退出码 2**，不假装成功（同 check-question-code.mjs）。
 * 题库整个是空的（新克隆的仓库、语言课还没开始写）则是**正常状态**，退出 0。
 *
 * 【这道闸门自己怎么验】改脚本之前先跑一遍自测，别拿真题库试
 *   `../_bankcheck-fixture/`（仓库的兄弟目录）是一个**沙箱题库**，9 个条目（b1~b9 ——
 *   2 个合格的当对照、7 个各坏一处）覆盖了本文件判的每一条：
 *
 *     node ../_bankcheck-fixture/build.mjs          # 造沙箱（可重复跑，每次重建）
 *     cd ../_bankcheck-fixture
 *     node ../miai-biancheng/scripts/check-bank.mjs
 *
 *   期望（夹具 build.mjs 同文，2026-09-29 实测）：**2 道凭戳免跑（b1 b2）、
 *   4 处结构问题（b5 b6 b7 b9）、3 道要真跑（b3 b8 判不过 + b4 跑得对但戳过期）**；
 *   汇总行「✗ 有问题 7」，退出码 1。数字不对就说明判据被改动了。
 *
 *   ⚠️ 这份沙箱不是"锦上添花"。第一版这里有一条判据是**死的** ——
 *   「验证戳过期」那一条因为两个数组各装了一份而从来没生效过，把 `verified.hash`
 *   改成任意假值，闸门照样全绿。抓出它的是手工反向验证，而手工验一次保证不了
 *   以后不被改坏。**一条判据写完不算完，"它确实会红"必须被真的看到一次。**
 */
import { readFileSync, globSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { contentHash, DEFERRED_PLACEHOLDERS } from './lib/bank.mjs'
import { verifyRunQuestion, leftoverPlaceholders } from './lib/bank-verify.mjs'
import { createTermScanner } from './lib/terms.mjs'
import { missingStdexceptType, stdexceptMessage } from './lib/cpp-includes.mjs'

const ROOT = process.cwd()
const BANK_DIR = join(ROOT, 'content', 'challenge-bank')

// 术语判据的唯一实现在 lib/terms.mjs —— 和 validate:content 共用同一份。
// glossary 缺失时**直接崩**，不做兼容：那说明仓库结构已经坏了，
// 而"读不到就不扫"正是铁律里那句「静默跳过 = 把『没验过』伪装成『验过了』」。
const glossary = JSON.parse(readFileSync(join(ROOT, 'content', 'glossary.json'), 'utf8'))
const countTerms = createTermScanner(glossary)

/**
 * 难度值域。真源是 `src/shared/difficulty.ts` 的 `DIFFICULTIES` ——
 * .mjs 脚本 import 不了 TS，按老规矩抄一份，由
 * `src/shared/__tests__/difficulty.test.ts` 读本文件源码钉住两份一致。
 * 题库不经过 content-validate 的逐题链，值域检查必须在**这一边**也有一份。
 */
const VALID_DIFFICULTIES = ['easy', 'medium', 'hard', 'challenge']

const argv = process.argv.slice(2)
const ALL = argv.includes('--all')
const LIST = argv.includes('--list')
const only = argv.find((a) => !a.startsWith('--'))

// ---------------------------------------------------------------- 大纲（课号必须存在）

const syllabusIds = new Set()
{
  const p = join(ROOT, 'content', 'syllabus.json')
  if (existsSync(p)) {
    const s = JSON.parse(readFileSync(p, 'utf8'))
    for (const m of s.modules ?? []) for (const l of m.lessons ?? []) syllabusIds.add(l.id)
  }
}

// ---------------------------------------------------------------- 收集条目

const files = globSync('*/*.json', { cwd: BANK_DIR }).sort()
if (files.length === 0) {
  console.log('题库还是空的（content/challenge-bank/ 里一个文件都没有）。')
  console.log('这是**正常状态** —— 语言课还没开始批量生产。')
  console.log('产题：`node scripts/gen-bank.mjs`（模板在 scripts/bank/templates/）。')
  process.exit(0)
}

const L = 'c,cpp,java,python'.split(',')

/** 结构检查 —— 不花编译时间，每一条都对应一种"文件看着正常但界面会出丑"的坏法 */
function lintItem(it, ctx) {
  const bad = []
  if (!it || typeof it !== 'object') return ['条目不是对象']
  if (typeof it.id !== 'string' || !it.id) bad.push('缺 id')
  if (it.type !== 'codefix' && it.type !== 'codewrite') bad.push(`type 只能是 codefix/codewrite，写的是 ${it.type}`)
  if (!L.includes(it.lang)) bad.push(`lang 只能是 ${L.join('/')}，写的是 ${it.lang}`)
  // 显式难度（可选）必须在值域内 —— 题库文件是人也能直接改的，
  // 而一个写歪的值（'hard '、'难'）在运行时会被原样当难度用，没有任何地方会响
  if ('difficulty' in it && !VALID_DIFFICULTIES.includes(it.difficulty)) {
    bad.push(`difficulty 非法：${JSON.stringify(it.difficulty)}`)
  }
  if (typeof it.stem !== 'string' || !it.stem.trim()) bad.push('stem 是空的')
  if (typeof it.expectedOutput !== 'string' || !it.expectedOutput.trim()) {
    // 空 expectedOutput = 「把代码删光也能过」（归一化之后也是个空串）
    bad.push('expectedOutput 是空的（删光代码也能"过"）')
  }
  if (typeof it.explanation !== 'string' || !it.explanation.trim()) bad.push('explanation 是空的')
  if (it.type === 'codefix') {
    if (!it.brokenCode?.trim()) bad.push('codefix 缺 brokenCode')
    if (!it.referenceFix?.trim()) bad.push('codefix 缺 referenceFix')
  } else if (it.type === 'codewrite') {
    if (!it.referenceSolution?.trim()) bad.push('codewrite 缺 referenceSolution')
  }
  /*
   * 【2026-09-28 补】用了 <stdexcept> 的异常类型却没 include —— 题库不走
   * `content-validate.mjs`，所以只在那一边加规则的话，这里 12 处它一处也看不见
   * （实测：`cpp-stage1-13` 的 brokenCode/referenceFix/referenceSolution 全中）。
   * 判据与理由见 `lib/cpp-includes.mjs`；这里查全部代码字段，
   * 因为参考解（reference*）和给学员看的 brokenCode 老编译器上都编不过。
   */
  if (it.lang === 'cpp') {
    for (const key of ['brokenCode', 'referenceFix', 'referenceSolution', 'starter']) {
      const 类型名 = missingStdexceptType(it[key])
      if (类型名) bad.push(stdexceptMessage(类型名, key))
    }
  }
  if (typeof it.templateId !== 'string' || !it.templateId) bad.push('缺 templateId（不知道它是哪个模板产的）')
  else if (typeof it.id === 'string' && !it.id.startsWith(`bank-${it.templateId}-`)) {
    bad.push(`id「${it.id}」和 templateId「${it.templateId}」对不上 —— 手改过 id？`)
  }
  // 题面里不该还剩 `{...}`。闸门这里也要查：模板机制之外，人是可以直接改文件的。
  const 残留 = leftoverPlaceholders(it.stem)
  if (残留.length) bad.push(`stem 里有没填掉的占位符：${残留.join(' ')}`)
  if (残留.length === 0) {
    for (const p of DEFERRED_PLACEHOLDERS) {
      if (it.stem.includes(`{${p}}`)) bad.push(`stem 里还留着 {${p}}`)
    }
  }
  // 【术语闸门】2026-09-16 补：题库的题面/解析是**学员每题都要读两遍**的字，
  // 而在此之前**没有任何闸门扫过它** —— `content-validate.mjs` 全文不含
  // `challenge-bank` 一个字，`check-bank` 自己只验真跑与验证戳。于是攒下 27 处
  // 原术语泄漏并已随 `content/challenge-bank/` 上线（例子：「变量」「函数」「参数」
  // 「字符串」「类」「对象」「列表」「循环」）。
  // 判据与 validate:content 的 checkQuestionTerminology 是**同一份实现**，阈值同为
  // 0（错误级）：依据是实测 —— 全库 27 处修完即为 0，既然能干净就没有放宽的理由。
  // 唯一与它不同的是**没有**那个「题干提到『原术语』三个字就整道跳过」的豁免：
  // 题库全是真跑题，任务不可能是"把原术语报出来"。真出现该豁免的题，带证据来加。
  if (typeof it.stem === 'string' && typeof it.explanation === 'string') {
    const 术语 = countTerms(`${it.stem}\n${it.explanation}`)
    if (术语.total > 0) {
      bad.push(
        `题面/解析含原术语 ${术语.total} 处：` +
          术语.counts.map((c) => `「${c.term}」×${c.found}（应用：${c.cat}）`).join('、')
      )
    }
  }
  if (it.lessonId !== undefined && it.lessonId !== ctx.lessonId) {
    bad.push(`条目里的 lessonId「${it.lessonId}」和所在的课「${ctx.lessonId}」不一致`)
  }
  return bad
}

const targets = []
let lintBad = 0
let trusted = 0
let scanned = 0

for (const rel of files) {
  const relNorm = rel.replace(/\\/g, '/')
  const [lang, base] = relNorm.split('/')
  const lessonId = base.replace(/\.json$/, '')
  if (only && !relNorm.includes(only) && !lessonId.includes(only)) continue
  scanned++

  let data
  try {
    data = JSON.parse(readFileSync(join(BANK_DIR, rel), 'utf8'))
  } catch (e) {
    console.log(`✗ ${relNorm} 解析失败：${e.message}`)
    lintBad++
    continue
  }

  if (data.lessonId !== lessonId) {
    console.log(`✗ ${relNorm} 里的 lessonId「${data.lessonId}」和文件名对不上 —— 题库是按课号索引的，对不上就没人读得到它`)
    lintBad++
  }
  if (syllabusIds.size && !syllabusIds.has(lessonId)) {
    console.log(`✗ ${relNorm} 的课号「${lessonId}」不在大纲里 —— 这份题库永远不会被读到`)
    lintBad++
  }
  // 语言目录必须和课号前缀一致：`content/challenge-bank/c/python-stage1-08.json` 是错的
  if (!lessonId.startsWith(`${lang}-`)) {
    console.log(`✗ ${relNorm} 放在「${lang}/」目录下，课号却不像 ${lang} 的课 —— 索引会对不上`)
    lintBad++
  }

  const items = Array.isArray(data.items) ? data.items : []
  if (!Array.isArray(data.items)) {
    console.log(`✗ ${relNorm} 里没有 items 数组`)
    lintBad++
  }

  const seenIds = new Set()
  for (const it of items) {
    if (it?.id && seenIds.has(it.id)) {
      console.log(`✗ ${relNorm} 里 id「${it.id}」重复`)
      lintBad++
    }
    if (it?.id) seenIds.add(it.id)

    const bad = lintItem(it, { lessonId })
    if (bad.length) {
      console.log(`✗ ${relNorm} ${it?.id ?? '(无 id)'}`)
      for (const b of bad) console.log(`      · ${b}`)
      lintBad++
      continue
    }
    targets.push({ rel: relNorm, lessonId, it })
  }
}

if (only && scanned === 0) {
  console.error(`✗ 没有一份题库匹配「${only}」—— 一道题都没查。`)
  console.error('  现有的课：')
  for (const rel of files) console.error(`    ${rel.replace(/\\/g, '/').replace(/\.json$/, '')}`)
  process.exit(2)
}

console.log(
  `扫了 ${scanned} 份题库文件，共 **${targets.length}** 道题` +
    (lintBad ? `（另有 ${lintBad} 处结构问题）` : '')
)

if (LIST) {
  for (const t of targets) {
    const 戳 = contentHash(t.it) === t.it.verified?.hash ? '戳✓' : '戳✗'
    console.log(`  ${戳} ${t.lessonId}  ${t.it.id}  [${t.it.type}/${t.it.lang}]`)
  }
  process.exit(lintBad ? 1 : 0)
}

if (targets.length === 0 && lintBad === 0) process.exit(0)

// ---------------------------------------------------------------- 判据（跑真代码）

/**
 * 要真跑的那些：**验证戳对不上的**（改了内容没重新盖章）+ `--all` 时全部。
 *
 * 反过来说：戳对得上的一律**不跑**。这不是偷懒 —— 哈希保证"从盖章到现在没人动过"，
 * 而盖章那一刻是被本判据真跑验证过的。所以"信任"是有依据的，不是省出来的。
 */
const toRun = []
for (const t of targets) {
  const 现算 = contentHash(t.it)
  // `--all` 也照样算现算值：这样"戳过期"这件事在全量跑时同样会被报出来
  if (!ALL && t.it.verified?.hash === 现算) {
    trusted++
    continue
  }
  toRun.push({ ...t, 现算 })
}
/*
 * ⚠️ 上面这一小段踩过一个"判据从来没生效过"的坑，值得记下来：
 * 第一版写的是 `stale.push({ ...t, 现算 })` 紧接着 `toRun.push(t)` ——
 * 两个数组各自装了一份，运行循环里读的是**没有 `现算` 字段的那一份**，
 * 于是 `t.现算` 永远是 `undefined`，"戳过期"这条分支一次都没进去过。
 * 表现是：把 `verified.hash` 改成任意假值，闸门照样全绿、退出码 0。
 *
 * 抓出它的是**反向验证**（故意改坏 → 期望变红 → 结果是绿的）。
 * 这也说明：一条判据写完不算完，"它确实会红"必须被真的看到一次。
 */

console.log(
  ALL
    ? `--all：${toRun.length} 道全部真跑`
    : `验证戳对得上、直接信任的 ${trusted} 道；戳对不上要真跑的 ${toRun.length} 道`
)

let pass = 0
const failures = []

for (const t of toRun) {
  const { lessonId, it } = t
  process.stdout.write(`  ${lessonId} ${it.id} [${it.type}/${it.lang}] … `)

  const v = verifyRunQuestion(it)
  if (!v.ok) {
    console.log(`✗ ${v.why}`)
    if (v.why.includes('不一致')) {
      console.log(`        题目说：${JSON.stringify(v.want.slice(0, 120))}`)
      console.log(`        实际是：${JSON.stringify(v.got.slice(0, 120))}`)
    } else if (v.got) {
      for (const l of String(v.got).replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n').slice(0, 6)) {
        console.log(`        | ${l}`)
      }
    }
    failures.push({ lessonId, id: it.id, why: v.why })
    continue
  }

  // 跑过了，但它是"内容改了、戳没更新"的那一类 —— 题是对的，戳是假的
  if (t.现算 && t.现算 !== it.verified?.hash) {
    console.log('✓ 跑起来是对的，**但验证戳过期了**')
    failures.push({
      lessonId,
      id: it.id,
      why: `验证戳过期（内容是好的，但戳还是改之前那一次的）：` +
        `存的 ${it.verified?.hash ?? '(没有)'} ≠ 现算的 ${t.现算}`
    })
    continue
  }

  console.log(it.type === 'codefix'
    ? `✓ 参考解对得上；brokenCode 确实${v.brokenPhase === 'compile' ? '编不过' : v.brokenPhase === 'plan' ? '起不来' : '跑错'}`
    : '✓ 参考解跑通且输出对得上')
  pass++
}

// ---------------------------------------------------------------- 汇总

console.log(`\n${'═'.repeat(60)}`)
console.log(`  ✓ 真跑通过       ${pass}`)
console.log(`  ⏭ 戳对得上免跑   ${trusted}`)
console.log(`  ✗ 有问题         ${failures.length + lintBad}`)
if (failures.length) {
  console.log('\n清单：')
  for (const f of failures) console.log(`  · ${f.lessonId} ${f.id}  ${f.why}`)
  console.log('')
  console.log('怎么修：')
  console.log('  · 内容是错的（参考解跑出来和 expectedOutput 不一致）→ 改**模板**，再 `node scripts/gen-bank.mjs --force`')
  console.log('  · 只有验证戳过期 → 直接 `node scripts/gen-bank.mjs --force` 重新盖章')
  console.log('  · **不要手改 content/challenge-bank/ 里的文件** —— 它是产物，下次生成会覆盖掉')
}
console.log('')
console.log(
  failures.length + lintBad === 0
    ? `结果：${pass} 道真跑通过、${trusted} 道凭验证戳免跑 —— 题库里的每一道，标准答案都是本机算出来的。`
    : `结果：${failures.length + lintBad} 处有问题。`
)
process.exit(failures.length + lintBad > 0 ? 1 : 0)
