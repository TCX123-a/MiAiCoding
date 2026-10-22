#!/usr/bin/env node
/**
 * 题库覆盖报告 —— 「每一课的 codefix / codewrite 到底有几道、谁产的、还缺什么」。
 *
 * 【为什么要有这份报告】
 * 学习闭环的难度体系、阶段卷、每日复习都建立在一个前提上：**每节课的题池够厚**。
 * 而题池有两个来源（手写 questions.json + 题库 challenge-bank），厚度只有把两边
 * **合起来按课清点**才看得见 —— 任何单独一边的数字都会误导（手写侧一道 codefix
 * 都没有，光看它像是全仓瘫痪；只看题库侧又会漏掉手写的那几道）。
 *
 * 【分母必须是 syllabus】老规矩（`_inventory-bank.mjs` 抬头记录过一次踩坑）：
 * 拿「已存在的目录」当分母，会把「还没开工的课」算成「已覆盖」——
 * 那是把「没验过」伪装成「验过了」。分母只能是**大纲里的课号**。
 *
 * 【它判什么、不判什么】
 * 这是**报告**，不是闸门：数字会随内容演进，所以它永远退出 0。
 * 硬地板（语言课 ≥1 codefix + ≥1 codewrite，docs/09）的执法权在
 * `content-validate.mjs` 第 8 条判据手里 —— 这里只是把它**打出来给你看**，
 * 好在打开内容文件之前就知道该看哪一课。
 *
 * 用法：
 *   node scripts/bank-coverage.mjs              # 汇总 + 缺口清单
 *   node scripts/bank-coverage.mjs --lessons    # 再加一张逐课大表
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const SHOW_LESSONS = process.argv.includes('--lessons')
const CONTENT = join(ROOT, 'content')

const syl = JSON.parse(readFileSync(join(CONTENT, 'syllabus.json'), 'utf8'))

/**
 * 由课号找手写内容目录（与 `content-build.mjs` 的 `lessonDirOf` 同规则）。
 * ⚠️ 别自己另发明一套：common 在 `content/common/<NN>-*`，
 * 其余在 `content/<lang>/stage<N>/<NN>-*`，目录名以两位数课号开头。
 */
function findDir(base, num) {
  if (!existsSync(base)) return null
  const d = readdirSync(base).find((x) => x.startsWith(`${num}-`))
  return d ? join(base, d) : null
}
function lessonDirOf(id) {
  if (id.startsWith('common-')) return findDir(join(CONTENT, 'common'), id.slice('common-'.length))
  const m = id.match(/^(c|cpp|java|python)-stage(\d)-(\d+)$/)
  if (!m) return null
  return findDir(join(CONTENT, m[1], `stage${m[2]}`), m[3])
}

/** 手写题型的合法值域（手写不该出现 codefix/codewrite —— content-difficulty.test.ts 钉着） */
const HAND_TYPES = ['choice', 'fill', 'code', 'codefill']
const BANK_TYPES = ['codefix', 'codewrite']

const lessons = []
for (const mod of syl.modules) {
  for (const l of mod.lessons) {
    lessons.push({ id: l.id, title: l.title, lang: mod.lang, stage: mod.stage })
  }
}

const rows = []
for (const l of lessons) {
  const hand = { choice: 0, fill: 0, code: 0, codefill: 0 }
  let handMissing = false
  const dir = lessonDirOf(l.id)
  const qp = dir ? join(dir, 'questions.json') : null
  if (!qp || !existsSync(qp)) {
    handMissing = true
  } else {
    const qs = JSON.parse(readFileSync(qp, 'utf8')).questions ?? []
    for (const q of qs) {
      if (HAND_TYPES.includes(q.type)) hand[q.type]++
    }
  }

  const bankPath = join(CONTENT, 'challenge-bank', l.lang, `${l.id}.json`)
  let bankExists = false
  let bank = { codefix: 0, codewrite: 0, challenge: 0 }
  const templates = new Set()
  if (existsSync(bankPath)) {
    bankExists = true
    const items = JSON.parse(readFileSync(bankPath, 'utf8')).items ?? []
    for (const it of items) {
      if (BANK_TYPES.includes(it.type)) bank[it.type]++
      if (it.difficulty === 'challenge') bank.challenge++
      if (it.templateId) templates.add(it.templateId)
    }
  }

  rows.push({
    ...l,
    hand,
    handMissing,
    bankExists,
    fix: bank.codefix,
    write: bank.codewrite,
    challenge: bank.challenge,
    bankTotal: bank.codefix + bank.codewrite,
    templates: [...templates].sort()
  })
}

const isLang = (r) => r.lang !== 'common'
const totalHand = rows.reduce((s, r) => s + Object.values(r.hand).reduce((a, b) => a + b, 0), 0)
const totalBank = rows.reduce((s, r) => s + r.bankTotal, 0)
const totalChallenge = rows.reduce((s, r) => s + r.challenge, 0)

console.log('═══ 题库覆盖报告 ═══')
console.log(
  `大纲课数：${rows.length}（语言课 ${rows.filter(isLang).length} + 通用知识课 ${rows.filter((r) => !isLang(r)).length}）`
)
console.log(`题量：手写 ${totalHand} + 题库 ${totalBank} = ${totalHand + totalBank}`)
console.log(`挑战题（显式 difficulty:"challenge"）：${totalChallenge} 道`)
console.log()

// ---- 缺口清单（按严重度从重到轻）
const noBankLang = rows.filter((r) => isLang(r) && !r.bankExists)
const belowFloor = rows.filter((r) => isLang(r) && (r.fix < 1 || r.write < 1))
const thinBank = rows.filter((r) => isLang(r) && r.bankExists && r.bankTotal < 12)
const noChallenge = !rows.some((r) => r.challenge > 0)

console.log('── 缺口清单 ──')
if (noChallenge) {
  console.log('☆ 挑战题一处都没有：阶段卷/整门卷的「挑战」档、每日挑战的峰值题全靠它。')
  console.log('  （content-difficulty.test.ts 的挑战题清单正等着这里长出第一批精选模板。）')
}
if (noBankLang.length) {
  console.log(`✗ 语言课缺整份题库 ${noBankLang.length} 课：${noBankLang.map((r) => r.id).join(' ')}`)
} else {
  console.log('✓ 语言课题库：229 课里语言课全员有库（0 缺）')
}
if (belowFloor.length) {
  console.log(
    `✗ 低于 docs/09 地板（<1 codefix 或 <1 codewrite）${belowFloor.length} 课：` +
      belowFloor.map((r) => `${r.id}(fix ${r.fix}/write ${r.write})`).join(' ')
  )
} else {
  console.log('✓ docs/09 地板：所有语言课 fix ≥1 且 write ≥1')
}
if (thinBank.length) {
  console.log(
    `· 偏薄（题库 <12 题）${thinBank.length} 课：` +
      thinBank.map((r) => `${r.id}(${r.bankTotal})`).join(' ')
  )
} else {
  console.log('✓ 题库厚度：所有语言课题库 ≥12 题')
}
const commonRows = rows.filter((r) => !isLang(r))
console.log(
  `· 通用知识课 ${commonRows.length} 课：0 道 codefix/codewrite —— **设计如此**，不是缺口：` +
    '`content-validate.mjs` 第 8 条判据引用 docs/09:115「概念课用不上这两个题型」，' +
    '总览页也不给 common 出阶段卡（lib/overview.ts）。'
)
console.log()

// ---- 分（语言 × 阶段）汇总
console.log('── 按语言 × 阶段 ──')
console.log('语言      阶段  课数  codefix  codewrite  挑战')
for (const lang of ['c', 'cpp', 'java', 'python']) {
  for (const stage of [1, 2, 3]) {
    const sub = rows.filter((r) => r.lang === lang && r.stage === stage)
    if (sub.length === 0) continue
    const fix = sub.reduce((s, r) => s + r.fix, 0)
    const wri = sub.reduce((s, r) => s + r.write, 0)
    const ch = sub.reduce((s, r) => s + r.challenge, 0)
    console.log(
      `${lang.padEnd(8)} ${String(stage).padEnd(5)} ${String(sub.length).padStart(4)} ` +
        `${String(fix).padStart(8)} ${String(wri).padStart(10)} ${String(ch).padStart(5)}`
    )
  }
}
console.log()

// ---- 逐课大表（可选）
if (SHOW_LESSONS) {
  console.log('── 逐课明细 ──')
  console.log('课号                手写(选/填/码/填空)  题库(fix/write)  挑战  模板')
  for (const r of rows) {
    const h = `${r.hand.choice}/${r.hand.fill}/${r.hand.code}/${r.hand.codefill}`
    const flag = isLang(r) && (!r.bankExists || r.fix < 1 || r.write < 1) ? ' ⚠' : ''
    console.log(
      `${r.id.padEnd(20)} ${h.padEnd(18)} ${`${r.fix}/${r.write}`.padEnd(16)} ` +
        `${String(r.challenge).padStart(4)}  ${r.templates.join(',') || (r.bankExists ? '' : '（无题库）')}${flag}`
    )
  }
}
