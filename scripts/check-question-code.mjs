#!/usr/bin/env node
/**
 * 参考解真跑台 —— 把每道 `codefix` / `codewrite` 的参考解**在本机真跑一遍**，
 * 断言它跑出来的输出**逐字等于**题目写死的 `expectedOutput`。
 *
 * 【为什么非跑不可】
 * `choice` / `fill` / `code` / `codefill` 的答案是**写在题目里**的字符串，
 * 校验器看一眼就知道对不对。真跑题型不一样：它的答案在**程序跑起来之后**，
 * 题目里那份 `expectedOutput` 只是一个**断言** —— 没人执行过它。
 * 生成时手滑多打一个空格、换行数错一位、`expectedOutput` 抄的是「改了三次之后」
 * 的版本而不是 `referenceFix` 的版本，**四种题型都没事，只有这两类会坏**，
 * 而坏的表现是：**学员把参考解一字不差地敲进去，判分说他错**。
 * 他能看到的只有"我明明是对的"，看不到"题目错了"。
 *
 * 所以这个台子不是"锦上添花的测试"，它是 `expectedOutput` 这个字段
 * **唯一的存在理由兑现的地方**（见 shared/types.ts 的 CodeFixQuestion 注释）。
 * 这也是项目铁律「**静默跳过 = 把『没验过』伪装成『验过了』**」在新题型上的落地。
 *
 * 【判什么】三类，每一类都对应一种**不会报错**的坏法
 *   ① 参考解跑不起来（编译错 / 运行崩 / 超时）
 *      → 学员照着抄也跑不起来，而他会以为是自己抄错了
 *   ② 参考解跑出来的东西 ≠ expectedOutput
 *      → 学员代码全对却永远过不了关，两份输出肉眼看还一模一样
 *   ③ 【`codefix` 专有】`brokenCode` **本来就是对的**
 *      → 学员点运行，看到正确的输出，然后不知道该改什么 ——
 *        这道题教不了任何东西，而它在界面上完全正常
 *
 * ③ 的判据不是"没报错"而是"**没报错、而且输出已经等于 expectedOutput**"：
 * 编译过但算错（逻辑错误）是完全合格的改错题，只要它没**已经**给出答案。
 *
 * ⚠️ **判断本身不在这里**，在 `scripts/lib/bank-verify.mjs` ——
 * 那个文件是「真跑题对不对」的**唯一一份**实现，本脚本和 `check-bank.mjs`
 * （无限题库那道闸门）共用它。这里只负责把结论翻译成人看得懂的几行。
 * 要改判据，改那个文件；改了之后**两道闸门会一起变**，那是设计意图，不是意外。
 *
 * 【不判什么】
 * `codefix` 的报错解释对不对 —— 那要走内置错误库，而错误库是"第一条命中即返回"，
 * 存在规则被抢的现象（见 docs/09「判分与错误库的分工」）。判分**永远不看错误库**，
 * 这里也一样。
 *
 * 用法：
 *   node scripts/check-question-code.mjs                  # 跑全部
 *   node scripts/check-question-code.mjs common-13        # 只跑一课（大纲课号）
 *   node scripts/check-question-code.mjs 13-one-row-data  # 只跑一课（目录名，一样认）
 *   node scripts/check-question-code.mjs --list           # 只列题目，不跑
 *
 * ⚠️ **过滤条件匹配不到任何题时退出码 2**，不会安静地跑完 0 道还报绿 ——
 * 这条和 `check-lesson-code.mjs` 同一个理由，那边为此踩过两次（注释里有）。
 * 不传过滤条件、题库里本来就是 0 道真跑题，则是**正常的**（内容还没写到那儿），
 * 打印一行说明后退出 0。两者必须分开，否则今天这条闸门会一直红着，
 * 而"一直红着"的闸门等于没有闸门 —— 所有人都会开始无视它。
 *
 * 【这道闸门自己怎么验】改脚本之前先跑一遍自测，别拿真题库试
 *   `../_qcheck-fixture/`（仓库的兄弟目录）是一个**沙箱题库**，里面 8 道题覆盖了本文件判的每一条
 *   （Python / Java / 非 Main 类名 / 带 stdin / 编译错 / 输出错 / brokenCode 没坏 / Java 缺 class）：
 *
 *     cd ../_qcheck-fixture && node ../miai-biancheng/scripts/check-question-code.mjs
 *
 *   期望：**5 道合格、3 道报错**，报的正是 q3（输出对不上）、q4（brokenCode 没坏）、
 *   q8（Java 缺 class）。数字不对就说明判定逻辑被改动了。
 *
 *   校验器那一侧的自测在 `../_selftest-validator.py`（借一份真课文临时塞坏题，
 *   跑完自动还原），同样覆盖了 codefix / codewrite 的九种坏法 + 一条合格样本。
 */
import { readFileSync, globSync } from 'node:fs'
import { join } from 'node:path'
import { verifyRunQuestion, isRunQuestion } from './lib/bank-verify.mjs'

const ROOT = process.cwd()

// ---------------------------------------------------------------- 收集题目

/**
 * `lessonId` 从目录名推：`content/common/13-one-row-data/questions.json` → `common-13`。
 *
 * ⚠️ 和大纲课号（`common-13`）是两种写法，过滤必须两种都认 ——
 * 这个坑 `check-lesson-code.mjs` 踩过：只认一种写法时，
 * `node xxx.mjs common-13` 会一节课都不跑、还 exit 0。
 */
function lessonIdOf(rel) {
  const parts = rel.replace(/\\/g, '/').replace(/^content\//, '').replace(/\/questions\.json$/, '').split('/')
  if (parts[0] === 'common') return `common-${parts[1].slice(0, 2)}`
  // c/stage1/01-xxx → c-stage1-01
  return `${parts[0]}-${parts[1]}-${parts[2].slice(0, 2)}`
}

const qFiles = globSync('content/*/*/questions.json', { cwd: ROOT })
  .concat(globSync('content/*/*/*/questions.json', { cwd: ROOT }))
  .sort()

if (qFiles.length === 0) {
  console.error('找不到任何 questions.json —— 路径约定变了？')
  process.exit(2)
}

const args = process.argv.slice(2)
const listOnly = args.includes('--list')
const only = args.find((a) => !a.startsWith('--'))
const flat = (rel) => rel.replace(/\\/g, '/').replace(/^content\//, '').replace(/\/questions\.json$/, '').split('/').join('-')

let scanned = 0
let allQuestions = 0
let parseErrors = 0
const targets = [] // { lessonId, q }
for (const rel of qFiles) {
  const lessonId = lessonIdOf(rel)
  const relNorm = rel.replace(/\\/g, '/')
  if (only && !relNorm.includes(only) && !flat(rel).includes(only) && !lessonId.includes(only)) continue
  scanned++
  let data
  try {
    data = JSON.parse(readFileSync(join(ROOT, rel), 'utf8'))
  } catch (e) {
    console.log(`✗ [${lessonId}] questions.json 解析失败：${e.message}`)
    parseErrors++
    continue
  }
  for (const q of data.questions ?? []) {
    allQuestions++
    if (!isRunQuestion(q)) continue
    targets.push({ lessonId, q })
  }
}

if (only && scanned === 0) {
  console.error(`✗ 没有一节课匹配「${only}」—— 一道题都没跑。`)
  console.error('  可用的课号（扁平写法）：')
  for (const rel of qFiles) console.error(`    ${flat(rel)}`)
  process.exit(2)
}

console.log(
  `扫了 ${scanned} 份 questions.json / 共 ${allQuestions} 道题，` +
    `其中真跑题型（codefix + codewrite）**${targets.length}** 道`
)

if (listOnly) {
  for (const t of targets) console.log(`  ${t.lessonId}  ${t.q.id}  [${t.q.type}/${t.q.lang}]`)
  process.exit(0)
}

if (targets.length === 0) {
  console.log('')
  /*
   * 【这句话 2026-09-15 改过一次，因为它当时是错的】
   * 原文写「语言课还没开写」，而那时语言课已经写了 5 节、题库也产了 57 道 ——
   * 一句过期的解释会让下一个人以为**这个闸门是坏的/空的**，于是他要么忽略它，
   * 要么去查一个根本不存在的 bug。空结果本身是正常的，但"为什么空"必须说对。
   */
  console.log('这一趟扫的是「手写课文里的 questions.json」，里面 0 道真跑题型 —— 这是**正常状态**：')
  console.log('语言课的 codefix / codewrite 一直是由本地题库脚本真跑产出的，住在 content/challenge-bank/，')
  console.log('它们的参考解由 `npm run check:bank` 把关（每道题带验证戳，戳对不上就当场重跑）。')
  console.log('所以"这里 0 道"不等于"没人在验真跑题"—— 换了个门在验。')
  console.log('哪天有人往课文里手写 codefix / codewrite，这里会自动开始跑它们的参考解。')
  process.exit(0)
}

// ---------------------------------------------------------------- 逐题真跑

let pass = 0
const failures = []

/** 把一段程序输出截成几行给人看 —— 报错动辄几十行，全打出来反而看不见重点 */
function show(label, text, maxLines = 6) {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n')
  for (const l of lines.slice(0, maxLines)) console.log(`        ${label}| ${l}`)
  if (lines.length > maxLines) console.log(`        ${label}… 还有 ${lines.length - maxLines} 行`)
}

for (const { lessonId, q } of targets) {
  const head = `  ${lessonId} ${q.id} [${q.type}/${q.lang}]`
  process.stdout.write(`${head} … `)

  /*
   * 判断本身在 `lib/bank-verify.mjs` —— 和无限题库那道闸门**共用同一份**。
   * 这里只负责把它的话翻译成人看得懂的几行，不重新决定什么叫对。
   * （两边各写一份判据的话，会在某次修改之后悄悄分叉，而两道闸门都只输出
   *   绿/红一个词，没人看得出它们判的是同一件事。）
   */
  const v = verifyRunQuestion(q)

  if (!v.ok) {
    console.log(`✗ ${v.why}`)
    if (v.why.includes('不一致')) {
      console.log(`        题目说：${JSON.stringify(v.want.slice(0, 120))}`)
      console.log(`        实际是：${JSON.stringify(v.got.slice(0, 120))}`)
    } else if (v.why.includes('本来就是对的')) {
      console.log(`        它跑出来：${JSON.stringify(v.got.slice(0, 120))}`)
    } else if (v.got) {
      show('', v.got)
    }
    failures.push({ lessonId, id: q.id, type: q.type, why: v.why, got: v.got, want: v.want })
    continue
  }

  if (q.type === 'codefix') {
    const 怎么坏的 = v.brokenPhase === 'compile' ? '编不过' : v.brokenPhase === 'plan' ? '起不来' : '跑错'
    console.log(`✓ 参考解对得上；brokenCode 确实${怎么坏的}`)
  } else {
    console.log('✓ 参考解跑通且输出对得上')
  }
  pass++
}

// ---------------------------------------------------------------- 汇总

console.log(`\n${'═'.repeat(60)}`)
console.log(`  ✓ 合格        ${pass}`)
console.log(`  ✗ 有问题      ${failures.length}`)
if (failures.length) {
  console.log('\n有问题的清单：')
  for (const f of failures) console.log(`  · ${f.lessonId} ${f.id} [${f.type}] ${f.why}`)
  console.log('\n每条都要回内容里改：`expectedOutput` 按参考解**真跑出来的**那份写，')
  console.log('或者把参考解改到真能输出 `expectedOutput`。**不要动这个脚本。**')
}
console.log('')
console.log(
  failures.length === 0
    ? `结果：${pass} 道全过 —— 每一份参考解都真跑过，输出逐字等于题目写的 expectedOutput。`
    : `结果：${failures.length} 道不合格（参考解真跑出来的东西和题目写的不一样，学员照抄也过不了）。`
)
process.exit(failures.length > 0 || parseErrors > 0 ? 1 : 0)
