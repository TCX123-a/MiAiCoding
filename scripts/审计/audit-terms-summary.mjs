/** 术语审计的汇总页：只出结论，不出明细（明细见 audit-terms.mjs）。 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CONTENT = join(ROOT, 'content')
const g = JSON.parse(readFileSync(join(CONTENT, 'glossary.json'), 'utf8'))

const stripGloss = (t) => t.replace(/([一-龥A-Za-z]+)（[^）]{1,12}）/g, '')
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function countTerm(text, term) {
  const ex = term.scanExcludes
  for (const o of term.originals) {
    const esc = escRe(o)
    let pat
    if (ex && o.length === 1) {
      pat = `(?<![${ex.lookBehind.join('')}${esc}])${esc}(?![${ex.lookAhead.join('')}])`
    } else if (ex) {
      const b = (ex.lookBehind || []).join('')
      const a = (ex.lookAhead || []).join('')
      pat = `${b ? `(?<![${b}])` : ''}${esc}${a ? `(?![${a}])` : ''}`
    } else {
      pat = esc
    }
    const n = (text.match(new RegExp(pat, 'g')) || []).length
    if (n) return n
  }
  return 0
}

// ① 标题含原术语、但整个标题没有任何猫咪说法
const sy = JSON.parse(readFileSync(join(CONTENT, 'syllabus.json'), 'utf8'))
const bare = []
for (const m of sy.modules) {
  for (const l of m.lessons) {
    // 判「有没有原术语」必须走 countTerm（带 scanExcludes），
    // 否则「类型」会被当成「类」、「构造函数」会被当成裸的「函数」——
    // 第一版用 includes() 直接扫，一口气多报了十几条假消息。
    const origs = g.terms.filter((t) => countTerm(l.title, t) > 0).map((t) => t.originals[0])
    if (!origs.length) continue
    // 猫咪说法要宽松匹配：glossary 里写的是「技能 / 招式」（带空格和斜杠），
    // 标题写的是「技能与招式」，逐字 contains 是认不出来的。
    const loose = (s) => s.replace(/[\s/]/g, '')
    const hasCat = g.terms.some((t) => loose(l.title).includes(loose(t.cat)))
    if (!hasCat) bare.push([l.id, l.title, origs.join('/')])
  }
}
console.log(`① 大纲标题「只写原术语、一个猫咪说法都没有」的（共 ${bare.length} 条）：`)
for (const b of bare) console.log(`   ${b[0].padEnd(16)}${b[1]}   ← ${b[2]}`)

// ② 报错库里的原术语（套用 scanExcludes，数字才作数）
let text = ''
for (const f of readdirSync(join(CONTENT, 'error-lib'))) {
  const lib = JSON.parse(readFileSync(join(CONTENT, 'error-lib', f), 'utf8'))
  text += lib.rules.map((r) => [r.title, r.explain, r.fixHint].join(' ')).join(' ')
}
text = stripGloss(text)
const rows = g.terms.map((t) => [t.originals[0], t.cat, countTerm(text, t)]).filter((x) => x[2] > 0)
rows.sort((a, b) => b[2] - a[2])
console.log(`\n② 报错库文案里的原术语（已套 scanExcludes；共 ${rows.reduce((s, r) => s + r[2], 0)} 处）：`)
for (const [o, c, n] of rows) console.log(`   「${o}」→应作「${c}」  ${n} 次`)
