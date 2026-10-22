/**
 * 术语扫描的「补盲」工具。
 *
 * content-validate.mjs 的 checkTerminology() 只扫 **lesson.md 正文**。
 * 有四块面向用户的中文它从来没看过：
 *   ① 194 课的大纲标题与 outline      （学生第一眼看到的就是标题）
 *   ② 题库的题干与解析                （练习题里出现原术语，等于白猫咪化）
 *   ③ 133 条报错规则的 title/explain/fixHint（报错卡是用户天天看的东西）
 *   ④ frontmatter 的 title/tags
 *
 * 本脚本用**逐字照抄**的正则逻辑把上面四块扫一遍，只为查漏，不替代 validate。
 * 「原术语（猫咪说法）」的豁免规则与 validate 保持一致（含它那个 ≤12 字的括号豁免）。
 *
 * 用法：node scripts/审计/audit-terms.mjs
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CONTENT = join(ROOT, 'content')
const glossary = JSON.parse(readFileSync(join(CONTENT, 'glossary.json'), 'utf8'))

/** 逐字照抄 content-validate.mjs:230 —— 「原术语（猫咪说法）」豁免 */
function stripGloss(text) {
  return text.replace(/([一-龥A-Za-z]+)（[^）]{1,12}）/g, '')
}

/** 逐字照抄 content-validate.mjs:232-254 —— 单字术语走 scanExcludes 的字符类 */
function scan(text) {
  const cleaned = stripGloss(text)
  const counts = []
  for (const term of glossary.terms) {
    for (const original of term.originals) {
      const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const ex = term.scanExcludes
      let pattern
      if (ex && original.length === 1) {
        const behind = ex.lookBehind.join('')
        const ahead = ex.lookAhead.join('')
        pattern = `(?<![${behind}${escaped}])${escaped}(?![${ahead}])`
      } else if (ex) {
        const behind = (ex.lookBehind || []).join('')
        const ahead = (ex.lookAhead || []).join('')
        pattern = `${behind ? `(?<![${behind}])` : ''}${escaped}${ahead ? `(?![${ahead}])` : ''}`
      } else {
        pattern = escaped
      }
      const found = cleaned.match(new RegExp(pattern, 'g'))?.length || 0
      if (found > 0) counts.push({ term: original, cat: term.cat, found })
    }
  }
  return counts
}

const hits = []
function look(where, label, text) {
  if (!text) return
  const counts = scan(text)
  if (counts.length) hits.push({ where, label, text, counts })
}

// ① 大纲 194 课的标题 + outline
const sy = JSON.parse(readFileSync(join(CONTENT, 'syllabus.json'), 'utf8'))
for (const mod of sy.modules) {
  for (const l of mod.lessons) {
    look('大纲', l.id, `${l.title}｜${l.outline}`)
    look('大纲标签', l.id, (l.tags || []).join(' '))
  }
}

// ② 题库
// 注意：课程目录名**不等于**课程 id（common-01 住在 content/common/01-intro/），
// 所以只能扫目录，不能拿 id 拼路径 —— 第一版就是这么漏掉全部题库的。
for (const lang of readdirSync(CONTENT)) {
  const langDir = join(CONTENT, lang)
  if (lang === 'error-lib' || !statSync(langDir).isDirectory()) continue
  for (const dir of readdirSync(langDir)) {
    const p = join(langDir, dir, 'questions.json')
    if (!existsSync(p)) continue
    for (const q of JSON.parse(readFileSync(p, 'utf8')).questions) {
      look('题库题干', `${lang}/${dir}/${q.id}`, q.stem)
      look('题库解析', `${lang}/${dir}/${q.id}`, q.explanation)
      look('题库选项', `${lang}/${dir}/${q.id}`, (q.options || []).join(' '))
    }
  }
}

// ③ 报错规则文案
for (const f of readdirSync(join(CONTENT, 'error-lib'))) {
  const lib = JSON.parse(readFileSync(join(CONTENT, 'error-lib', f), 'utf8'))
  lib.rules.forEach((r, i) => {
    look('报错规则', `${f.replace('.json', '')} #${i + 1}`, [r.title, r.explain, r.fixHint].join(' '))
  })
}

// ── 输出 ─────────────────────────────────────────────
const ORDER = ['大纲', '大纲标签', '题库题干', '题库解析', '题库选项', '报错规则']
let grand = 0
for (const kind of ORDER) {
  const rows = hits.filter((h) => h.where === kind)
  if (!rows.length) continue
  const n = rows.reduce((s, r) => s + r.counts.reduce((a, c) => a + c.found, 0), 0)
  grand += n
  console.log(`\n═══ ${kind} —— ${rows.length} 处文本有原术语，共 ${n} 个词 ═══`)
  for (const r of rows.slice(0, 40)) {
    const desc = r.counts.map((c) => `「${c.term}」→应作「${c.cat}」×${c.found}`).join('  ')
    console.log(`  ${r.label.padEnd(22)} ${desc}`)
    console.log(`      ${r.text.slice(0, 78)}`)
  }
  if (rows.length > 40) console.log(`  …还有 ${rows.length - 40} 条`)
}
console.log(`\n合计：${hits.length} 处文本、${grand} 个原术语出现在上面这四块扫描盲区里`)
