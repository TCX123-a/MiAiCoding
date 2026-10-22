/**
 * 把报错库文案里的原术语改写成喵化术语（审计报告 🔴-2 的修复工具）。
 *
 * 触发方式：`node scripts/审计/rewrite-errorlib-terms.mjs`（只看不改）
 *           `node scripts/审计/rewrite-errorlib-terms.mjs --apply`（真的写回）
 *
 * 规则：
 *   · 只动 title / explain / fixHint，**绝不动 pattern**（那是正则，动一下规则就废了）
 *   · 改写表按「长词优先」排序，避免「字符串变量」被拆成「项链+仓库」
 *   · PASS2 修的是 PASS1 产生的别扭搭配（如「别绕鱼干跑圈了」）
 *
 * 改写表就是这份文档：它是可复核的、可重跑的，而不是一次性手改。
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LIBDIR = join(ROOT, 'content', 'error-lib')
const APPLY = process.argv.includes('--apply')

/** PASS 1：原术语 → 喵化术语。顺序由脚本按长度倒序排，长的先替换。 */
const PASS1 = [
  // ── 组合词（必须比它的组成部分先命中）──
  ['字符串变量', '装项链的仓库'],
  ['变量名跟函数名', '仓库名跟招式名'],
  ['函数和变量撞名', '招式和仓库撞名'],
  ['函数或引用', '招式或猫爪指向牌'],
  ['要的是引用', '要的是猫爪指向牌'],
  ['局部变量', '招式里的仓库'],
  ['数组下标', '猫粮碗的格子号'],
  ['大的数组', '大的猫粮碗'],
  ['的大数组', '的大猫粮碗'],
  ['下标', '格子号'],
  ['别循环了', '别绕圈了'],
  ['死循环', '停不下来的绕圈'],
  ['调用函数', '施展招式'],
  ['调用了一个叫', '施展了一个叫'],
  // 「模板」这一处原本藏在「模板（`< >` 里那个类型）」里——那个括号不是猫咪说法，
  // 却因为不超过 12 个字被扫描器当成了豁免，属于审计报告 🟡-7 说的盲区。
  ['模板（`< >` 里那个类型）', '会量体裁衣的图纸（`< >` 里那个类型）'],
  // 「类」只在明确的指代里换（中文的「那类/这类/类似」不是术语，不能动）
  ['**方法**还是**类**', '**招式**还是**猫猫图纸**'],
  ['这个类还没请进来', '这张猫猫图纸还没请进来'],
  ['别的类', '别的猫猫图纸'],
  ['包里的类', '包里的猫猫图纸'],
  ['的类，名字必须和', '的猫猫图纸，名字必须和'],
  ['参数跟这个类要的', '投喂的小鱼干跟这张图纸要的'],
  // ── 通用词 ──（「方法」的全库 19 处已逐条人工核对，无一是中文的「办法」义）
  ['变量名', '仓库名'],
  ['函数名', '招式名'],
  ['方法名', '招式名'],
  ['编译器', '翻译官喵'],
  ['解释器', '翻译官喵'],
  ['输入输出', '投喂与叼回'],
  ['返回值', '叼回来的战利品'],
  ['字符串', '一串小鱼干的项链'],
  ['变量', '小鱼干仓库'],
  ['函数', '招式'],
  ['方法', '招式'],
  ['数组', '一排贴编号的猫粮碗'],
  ['列表', '会自己长大的储物柜'],
  ['循环', '绕鱼干跑圈'],
  ['参数', '投喂的小鱼干'],
  ['指针', '猫爪指向牌'],
  ['递归', '自己咬自己尾巴的招式'],
  ['对象', '根据图纸生出来的真猫']
]

/** PASS 2：收拾 PASS1 造出来的别扭搭配（在产出文本上再 replace 一次）。 */
const PASS2 = [
  // ── PASS1 的通用替换会造出的长串，收短 ──
  ['别绕鱼干跑圈了', '别绕圈了'],
  ['停不下来的绕鱼干跑圈', '停不下来的绕圈'],
  ['绕鱼干跑圈条件', '绕圈的条件'],
  ['某个具体根据图纸生出来的真猫', '某只具体的真猫'],
  ['一个根据图纸生出来的真猫', '一只真猫'],
  ['个根据图纸生出来的真猫', '只真猫'],
  ['类型的小鱼干仓库', '类型的仓库'],
  ['的大一排贴编号的猫粮碗', '的大猫粮碗'],
  ['一排贴编号的猫粮碗没有那么多格', '猫粮碗没有那么多格'],
  ['那个小鱼干仓库恰好是', '那个仓库恰好是'],
  ['会自己长大的储物柜/一排贴编号的猫粮碗', '储物柜 / 猫粮碗'],
  ['`[10, 20, 30]` 的会自己长大的储物柜', '`[10, 20, 30]` 这样的储物柜'],
  // ── 语序 / 搭配微调 ──
  ['这个招式没有叼回来的战利品，不能拿去用喵', '这个招式不叼东西回来，不能拿去用喵'],
  ['当成有叼回来的战利品来用了', '当成会叼回战利品来用了'],
  ['要的是什么类型的投喂的小鱼干', '要的是什么样的投喂小鱼干'],
  ['投喂的小鱼干类型', '投喂小鱼干的类型'],
  ['或者传投喂的小鱼干的顺序反了', '或者投喂小鱼干的顺序反了'],
  ['或者对数字用了一串小鱼干的项链的招式喵', '或者对数字用了项链才有的招式喵'],
  ['的结果再赋给小鱼干仓库', '的结果再装回小鱼干仓库'],
  // ── 「递归」那句玩笑话：加书名号才读得出来是故意绕圈 ──
  ['什么是自己咬自己尾巴的招式', '什么是「自己咬自己尾巴的招式」'],
  // ── 顺手抓到的老 bug：字典的大括号被写成了两对 ──
  ['字典（`{{}}`）', '字典（`{}`）']
]

const sorted1 = [...PASS1].sort((a, b) => b[0].length - a[0].length)

function rewrite(text) {
  const fired = new Map()
  let out = text
  for (const [from, to] of sorted1) {
    const n = out.split(from).length - 1
    if (n) {
      fired.set(from, (fired.get(from) || 0) + n)
      out = out.split(from).join(to)
    }
  }
  for (const [from, to] of PASS2) {
    const n = out.split(from).length - 1
    if (n) {
      fired.set(`(修)${from}`, (fired.get(`(修)${from}`) || 0) + n)
      out = out.split(from).join(to)
    }
  }
  return { out, fired }
}

let changedRules = 0
let changedFields = 0
const tally = new Map()
const details = []

for (const f of readdirSync(LIBDIR)) {
  const p = join(LIBDIR, f)
  const lib = JSON.parse(readFileSync(p, 'utf8'))
  let fileChanged = false
  lib.rules.forEach((r, i) => {
    const before = [r.title, r.explain, r.fixHint]
    const allFired = new Map()
    const after = before.map((field) => {
      const { out, fired } = rewrite(field)
      for (const [k, v] of fired) allFired.set(k, (allFired.get(k) || 0) + v)
      return out
    })
    if (!allFired.size) return
    fileChanged = true
    changedRules++
    changedFields += after.filter((t, k) => t !== before[k]).length
    for (const [k, v] of allFired) tally.set(k, (tally.get(k) || 0) + v)
    details.push({ file: f, idx: i + 1, pattern: r.pattern, before, after })
    r.title = after[0]
    r.explain = after[1]
    r.fixHint = after[2]
  })
  if (fileChanged && APPLY) writeFileSync(p, JSON.stringify(lib, null, 2) + '\n', 'utf8')
}

console.log(`${APPLY ? '【已写回】' : '【试运行，未写盘】'}改了 ${changedRules} 条规则、${changedFields} 个字段\n`)
console.log('── 各词条命中次数 ──')
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}×  ${k}`)
console.log(`\n── 逐条对照（共 ${details.length} 条）──`)
for (const d of details) {
  console.log(`\n### ${d.file} #${d.idx}  pattern=${JSON.stringify(d.pattern)}`)
  for (let k = 0; k < 3; k++) {
    if (d.before[k] === d.after[k]) continue
    const label = ['title', 'explain', 'fixHint'][k]
    const pairs = []
    // 只打印真正变化的片段：按句子粗切，前后不一致的就展示
    const bs = d.before[k].split(/(?<=[。；\n])/)
    const as = d.after[k].split(/(?<=[。；\n])/)
    if (bs.length === as.length) {
      for (let s = 0; s < bs.length; s++) if (bs[s] !== as[s]) pairs.push(`      − ${bs[s].trim()}\n      + ${as[s].trim()}`)
      console.log(`  [${label}]`)
      console.log(pairs.join('\n'))
    } else {
      console.log(`  [${label}] − ${d.before[k].slice(0, 200)}\n          + ${d.after[k].slice(0, 200)}`)
    }
  }
}
