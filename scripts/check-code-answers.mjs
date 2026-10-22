#!/usr/bin/env node
/**
 * 代码阅读题真跑台 —— 把每道 `code` 题的 `code` **在本机真跑一遍**，
 * 断言它跑出来的 stdout **等于**题目写死的 `answer`（或其某条 `accept`）。
 *
 * 【为什么非跑不可】
 * `code` 题问的是「这段程序输出什么？」，判分是**纯字符串比对**（`gradeCode`）。
 * 它的 `answer` 是**内容作者手写的一段程序输出** —— 全项目没有任何脚本跑过它。
 * 于是 `answer` 是一个**没人验证过的断言**：内容里少打一个空格、多写一个换行、
 * 把 `3` 写成 `5`，**校验器一声不吭**（它只看形状，不看语义），
 * 而学员把代码原样读对、把输出一字不差敲进去，**判分说他错**。
 *
 * 他能看到的只有「我明明是对的」，看不到「题目错了」——
 * 和 `check-question-code.mjs` 头部讲的是同一件事，只是那边管参考解、
 * 这边管手写答案。两份闸门合起来才覆盖的题型：
 *
 *   choice / fill              纯字符串比对。答案在题里，校验器能验**形状**（选项越界、空答案）
 *   code                       **答案也是手写的**，但它是"某段程序的输出" → **本文件**
 *   codefix / codewrite        判分本来就真跑            → `check-question-code.mjs`
 *   codefill                   **答案也是手写的、也是代码** → 也在这里（第三节，把答案填回空位真跑）
 *
 * 【codefill 这一段是 2026-09-16 补的，来由值得留着】
 * 这行原先写的是「choice / fill / codefill …答案就在题里，校验器看一眼就知道」。
 * 对 choice 成立（答案是**下标**，越界、空选项校验器验得动），**对 codefill 不成立**：
 * 它的答案是**代码**，而 `content-validate.mjs` 对 codefill 只验**形状** ——
 * 空位个数和 `____` 对得上、答案非空、不含换行。**那段代码从来没被跑过一遍。**
 * 于是「把 `yield` 写成 `return`」这种答案能一路绿到学员眼前，而且是双向坏：
 * 照着错的学 → 学到错的东西；写对的学员 → 比对的是那个错答案，**判他错**。
 * （当时先做了两件事：头部改成实话 + 每次跑都把跳过打印出来，不让它是静默的。
 * 现在补上了第三节，`docs/14` §9.9 记着完整来龙去脉。）
 *
 * 【⚠️ 这一段只证明「填回去跑得起来」，**证不了「跑出来是对的」**】
 * 那需要一份预期输出，而 codefill 没有这个字段（它的判分是字符串比对，本来不需要）。
 * 所以它是**拦住**级别的：拦住"填回去根本跑不起来"（`yield` 写成 `return` 会
 * `TypeError`、少个括号会 `SyntaxError`、接 `None` 会 `AttributeError`）。
 * 「`range(3)` 还是 `range(1,4)`」这种**既跑得起来又跑错了**的答案，它一个字都拦不住。
 * 别把这句话读掉 —— 它决定了下面那张 `豁免_codefill` 表能不能被信任。
 *
 * 【和 `check-question-code.mjs` 的分工是刻意划开的，不是漏了】
 * 那道闸门扫的是「真跑题型（codefix/codewrite）」，`code` 题它一道都不碰，
 * 所以它那边扫出 0 道是**正常的**（它自己在空结果时打印了这段说明）。
 * 两道闸门的**判据**故意不一样：那边比的是 `expectedOutput`（题目里写的断言），
 * 这边比的是 `answer`（学员要打的字）。**共用的只有输出契约那一份实现**
 * （`lib/run-code.mjs` 的 `normalizeRunOutput` / `gradeByRun`），这才是"判据唯一"的地方。
 *
 * 【判什么】三类，每一类都对应一种**不会报错**的坏法
 *   ① 这段代码根本跑不起来（编译错 / 解释器报错 / 超时）
 *      → 学员照着读也读不出任何东西，而他会以为是自己不懂
 *   ② 跑出来的 stdout ≠ `answer`
 *      → 学员读对了也永远过不了关，两份输出肉眼看还一模一样
 *   ③ 跑出来的 stdout 是**空的**（程序在等 stdin、或崩在打印之前）
 *      → 不是"这题没问题"，是**这题没被验过** —— 见下面那条铁律
 *
 * 【铁律：静默跳过 = 把「没验过」伪装成「验过了」】
 * ③ 这一类**不能**当成"跳过"放行。`code` 题里确实有一批答案**本来就不是 stdout**
 * （问「打印了几行」、问「假如输入 7 会怎样」），那是**合法的题型用法**，
 * 但它们必须**显式登记**在下面的 `豁免` 表里、写明**答案是什么**。
 * 没登记的跑出空 stdout 一律报红。
 *
 * 为什么豁免写在脚本里、不写成题目字段：两个常数级的例外，为它们动
 * `shared/types.ts` + `content-validate.mjs` + 题库 schema 是拿大炮打蚊子；
 * 而且**例外集中在一处**看的时候一眼扫得完（字段散在内容里，得翻 57 个文件）。
 * 哪天豁免超过四五条，就是该把它提升成内容字段的信号。
 *
 * 【这道闸门自己怎么防霉】豁免表里**指不到真题目的条目会报红**。
 * 否则改完内容之后，一条过期的豁免会永远躺在表里，
 * 把「这道题被放过了」变成一句没人能验证的话。和 `check-lesson-code.mjs`
 * 过滤不到任何课时退出码 2 是同一条纪律。
 *
 * 【这道闸门自己怎么验】改判据之前先跑沙箱，别拿真题库试：
 *   `../_codefill-fixture/`（仓库的兄弟目录；4 道：1 道好的、1 道答案跑不起来的、1 道等价答案是坏的、
 *   1 道要读 stdin 的）—— 跑法与期望数字写在那个目录的 `README.md` 里。
 *
 * 用法：
 *   node scripts/check-code-answers.mjs                 # 跑全部（code + codefill 两类都真跑）
 *   node scripts/check-code-answers.mjs python-stage1   # 只跑匹配的课
 *   node scripts/check-code-answers.mjs --list          # 只列题目，不跑
 *   node scripts/check-code-answers.mjs --emit          # 把报红的题打成**两张**豁免表的骨架（照抄进下面）
 *
 * ⚠️ **本脚本真起 gcc / javac / python，会抢 CPU。**
 * 别和写手子代理并发跑（`npm test` 会因此假红，且复现不出来）。
 */
import { readFileSync, globSync } from 'node:fs'
import { join } from 'node:path'
import { LANGS, gradeByRun, normalizeRunOutput, runBlock } from './lib/run-code.mjs'

const ROOT = process.cwd()

/**
 * **答案不是 stdout 的题** —— 显式豁免，每条必须写清「那答案到底是什么」。
 *
 * 判据（写豁免之前先自问）：**这题的答案能不能靠跑一遍这段代码得到？**
 * 能 → 不该豁免，去把 `answer` 改成真跑出来的那份。
 * 不能 → 登记，并在理由里写明白答案是什么、为什么跑不出来。
 */
const 豁免 = {
  'common-02/q6': {
    答案是什么: '行数（不是那几行字本身）',
    为什么跑不出来: '题目问「会打印几行」，跑一遍只能得到行的**内容**，得不到"几行"这个计数'
  },
  'common-08/q6': {
    答案是什么: '假设输入 7 时的输出（题面给的假想输入）',
    为什么跑不出来: '程序在读 stdin，而题面要求学员**假设**输入是 7；本台子喂的是空输入，读到的值与题面不符'
  }
}

/**
 * **把答案填回去也跑不起来的 `codefill`** —— 显式豁免，每条必须写清「为什么它注定跑不起来」。
 *
 * 判据（写豁免之前先自问）：**这段代码填对了答案之后，是不是本来就跑不起来？**
 * 是 → 登记，并写明白跑不起来的原因（比如「它要读 stdin，而这个题型没有 stdin 字段」）。
 * 不是 → 别豁免，去把那个空位的答案改对。
 *
 * ⚠️ **「跑不起来就跳过」是本表唯一禁止的写法。** 那等于给这道闸门开了个后门，
 * 从此任何填错的答案只要能让程序崩，就自动获得放行 —— 见下面那条铁律。
 *
 * ⚠️ 表里指不到真题目的条目会报红（和上面那张表同一套防霉逻辑）。
 */
const 豁免_codefill = {
  // 表里只有这一条，而它是**真跑证明过**的（证据写在下面），
  // 不是「跑不起来就顺手登记进来」。硬判据照旧：任何一道填回去跑不起来、
  // 又不在这里登记的，一律报红。
  'python-stage1-05/q7': {
    答案是什么: '{name}（把客人敲进来的名字插值进去）',
    为什么跑不出来:
      '这段代码**本来就要读 stdin**（这一课就是「输入与输出」，第一行就是 input()），' +
      '而 codefill 题型没有 stdin 字段，闸门只能喂空输入 → 必然 EOFError。' +
      '**不是答案写错了。** 真跑背书的证据：`<workspace>\\_probe-q7.mjs` —— ' +
      '喂 "小橘\\n" 之后，主答案 {name} 与三条 accept（{ name } / {name } / { name}）' +
      '全部印出「你是谁喵？小橘，欢迎光临喵」，而反证 {nane}（拼错）当场 NameError。'
  }
}

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
const emit = args.includes('--emit')
const only = args.find((a) => !a.startsWith('--'))
const flat = (rel) => rel.replace(/\\/g, '/').replace(/^content\//, '').replace(/\/questions\.json$/, '').split('/').join('-')

let scanned = 0
let parseErrors = 0
const targets = [] // code 题      { lessonId, key, rel, q }
const cfTargets = [] // codefill 题 { lessonId, key, rel, q }
const fillAccepts = [] // fill 题的 accept —— 本闸门**跑不了**它们，只登记，好在汇总里说出来
const keySeen = new Map()
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
    /*
     * 两类「**手写答案**」一起收：`code`（答案是程序输出）和 `codefill`（答案是代码）。
     *
     * 收在一起是为了共用下面那套**题目编号唯一**检查 —— 两张豁免表都按 `lessonId/qid`
     * 索引，编号撞了就会**指向两道题**（放过谁全看遍历顺序）。
     * `choice` / `fill` 不进这里：它们的答案在题里，校验器验得动形状，本文件不管。
     */
    /*
     * `fill` 题的 accept 先记一笔，再放行 —— 它**没有代码上下文，没什么可执行的**，
     * 本文件永远验不到它。但「验不到」必须被**说出来**：静默跳过 = 把「没验过」
     * 伪装成「验过了」，读汇总的人会以为这些 accept 也过了一遍真跑。
     *
     * 这不是假想的风险：2026-09-16 正是顺着这一行去人眼读的，
     * 从 `c/stage3/03-linked-list/q5` 和 `c/stage2/04-dynamic-memory/q4` 里
     * 摘掉两条 `null`（C 里没这个写法，`NULL` 才是）—— 而 **codefill 里同样那两条
     * 才**是被闸门抓出来的。同一支笔、同一种错，只在有代码上下文的那一半现了形。
     */
    if (q.type === 'fill' && (q.accept ?? []).length > 0)
      fillAccepts.push({ key: `${lessonId}/${q.id}`, rel: relNorm, accept: q.accept })

    if (q.type !== 'code' && q.type !== 'codefill') continue
    const key = `${lessonId}/${q.id}`
    const dup = keySeen.get(key)
    if (dup) {
      console.log(`✗ 题目编号重复：${key} 同时出现在 ${dup} 和 ${relNorm}`)
      parseErrors++
      continue
    }
    keySeen.set(key, relNorm)
    ;(q.type === 'code' ? targets : cfTargets).push({ lessonId, key, rel: relNorm, q })
  }
}

if (only && scanned === 0) {
  console.error(`✗ 没有一节课匹配「${only}」—— 一道题都没跑。`)
  console.error('  可用的课号（扁平写法）：')
  for (const rel of qFiles) console.error(`    ${flat(rel)}`)
  process.exit(2)
}

console.log(
  `扫了 ${scanned} 份 questions.json：code（代码阅读）题 **${targets.length}** 道、` +
    `codefill（代码填空）题 **${cfTargets.length}** 道 —— 两类的答案都是手写的，两类都在下面真跑`
)

if (listOnly) {
  for (const t of targets) console.log(`  ${t.key}  [${t.q.lang}]${豁免[t.key] ? '  （已豁免）' : ''}`)
  if (cfTargets.length) {
    console.log('  ── codefill ──')
    for (const t of cfTargets) console.log(`  ${t.key}  [${t.q.lang}]${豁免_codefill[t.key] ? '  （已豁免）' : ''}`)
  }
  const 码fill = fillAccepts.filter((f) => ['c', 'cpp', 'java', 'python'].includes(f.rel.split('/')[1]))
  if (码fill.length) {
    console.log('  ── 代码语言的 fill accept（本闸门跑不了，列出来给人眼读）──')
    for (const f of 码fill) console.log(`  ${f.key}  ${JSON.stringify(f.accept)}  ← ${f.rel}`)
    console.log('  判据：**把它填回题面给出的代码形状里，那段代码还跑得通吗？** 跑不通就是宽容过头了。')
  }
  process.exit(0)
}

if (targets.length === 0 && cfTargets.length === 0) {
  console.log('\n这一趟扫的课里 0 道 code / codefill 题 —— 正常（内容还没写到那儿）。')
  process.exit(0)
}
if (targets.length === 0) console.log('这一趟扫的课里 0 道 code 题 —— 正常，这一节跳过。')

// ---------------------------------------------------------------- 逐题真跑

let pass = 0
let exempt = 0
const failures = []
const usedExempt = new Set()

/** 把一段程序输出截成几行给人看 —— 报错动辄几十行，全打出来反而看不见重点 */
function show(label, text, maxLines = 8) {
  const lines = normalizeRunOutput(text ?? '').split('\n')
  for (const l of lines.slice(0, maxLines)) console.log(`        ${label}| ${l}`)
  if (lines.length > maxLines) console.log(`        ${label}… 还有 ${lines.length - maxLines} 行`)
}

for (const { key, q, rel } of targets) {
  const head = `  ${key} [${q.lang}]`
  process.stdout.write(`${head} … `)

  const ex = 豁免[key]
  if (ex) {
    usedExempt.add(key)
    exempt++
    console.log(`∅ 已豁免 —— ${ex.答案是什么}`)
    continue
  }

  if (!LANGS[q.lang]) {
    console.log(`✗ 语言「${q.lang}」没有执行计划（能跑的有：${Object.keys(LANGS).join(' / ')}）`)
    failures.push({ key, rel, why: `语言「${q.lang}」跑不了`, got: '', want: q.answer ?? '' })
    continue
  }

  /*
   * ⚠️ **不能因为 `!r.ok` 就判这题错了。**
   * `common-12`（看懂报错）有一道题是**故意**让程序断气的，答案正是
   * 「断气之前印出来的那几行」—— 退出码非 0、stderr 有红字，但 stdout 是**有效答案**。
   * 第一版探针在这里放过了它，等于把一道好题当成"跑不起来"。
   * 所以判据是 **stdout**，不是退出码。
   */
  const r = runBlock(q.lang, q.code, { stdin: q.stdin ?? '' })
  const got = normalizeRunOutput(r.stdout ?? '')
  const want = normalizeRunOutput(typeof q.answer === 'string' ? q.answer : '')
  const accepts = (q.accept ?? []).map((a) => normalizeRunOutput(a))

  // ① 跑不起来，而且一个字都没吐出来 —— 读不出东西的题
  if (got === '' && !r.ok) {
    console.log(`✗ ${r.phase} 阶段就倒了，stdout 是空的`)
    show('', r.output)
    failures.push({ key, rel, why: `${r.phase} 阶段跑不起来且无输出`, got: '', want })
    continue
  }

  // ② 空 stdout 但没崩（在读 stdin / 或程序本来就没打印）—— 这题**没被验过**
  if (got === '') {
    console.log('✗ stdout 是空的 —— 这题没被验过（程序在读输入？或者根本没打印？）')
    failures.push({ key, rel, why: 'stdout 归一化后是空的，答案无从验证', got: '', want })
    continue
  }

  // ③ 逐字比对，走判分那条归一化规则，不另写一份
  if (!gradeByRun(want, got) && !accepts.some((a) => gradeByRun(a, got))) {
    console.log(`✗ 跑出来和答案不一致${r.ok ? '' : '（程序跑到一半断了，比的是断之前的 stdout）'}`)
    console.log(`        题目说：${JSON.stringify(want.slice(0, 160))}`)
    console.log(`        实际是：${JSON.stringify(got.slice(0, 160))}`)
    failures.push({ key, rel, why: '真跑输出与 answer 不一致', got, want })
    continue
  }

  console.log(`✓ 真跑对得上${r.ok ? '' : '（读到一半断了，与答案一致）'}`)
  pass++
}

// ---------------------------------------------------------------- 第二节：codefill 填回空位真跑

let cfPass = 0
let cfExempt = 0
let cfAcceptPass = 0
const cfFailures = []
const cfAcceptFailures = []
const cfUsedExempt = new Set()

/**
 * 把每个空位按顺序替换成 `blanks[i].answer`（或指定的那一条变体）。
 *
 * 空位标记的正则**照抄 `content-validate.mjs` 的 `/_{4,}/g`**（也就是
 * `src/shared/codefill.ts` 的 `CODE_FILL_MARKER`）。三处漂了会**假绿**：
 * 这里少认一个空位，那个空位就留着 `____` 往下跑 —— 而 `____` 在 Python 里
 * 是个**合法的变量名**，多数情况下程序照跑不误，闸门开开心心说"跑得起来"。
 * 所以下面另有一道**空位个数硬比对**，不把正确性押在那份抄写上。
 */
function 填空位(code, blanks) {
  let i = 0
  return code.replace(/_{4,}/g, () => {
    const b = blanks[i]
    i++
    return b && typeof b.answer === 'string' ? b.answer : '____'
  })
}

for (const { key, q, rel } of cfTargets) {
  process.stdout.write(`  ${key} [${q.lang}] … `)

  const ex = 豁免_codefill[key]
  if (ex) {
    cfUsedExempt.add(key)
    cfExempt++
    console.log(`∅ 已豁免 —— ${ex.答案是什么}`)
    continue
  }

  if (!LANGS[q.lang]) {
    console.log(`✗ 语言「${q.lang}」没有执行计划（能跑的有：${Object.keys(LANGS).join(' / ')}）`)
    cfFailures.push({ key, rel, why: `语言「${q.lang}」跑不了` })
    continue
  }

  const blanksInCode = (q.code.match(/_{4,}/g) || []).length
  if (blanksInCode !== q.blanks.length) {
    // 这一条本该由 `content-validate.mjs` 拦下。它响 = 上游漏了，
    // **别只改这里** —— 去修 `blanks` 或 `code`，让两处重新对上。
    console.log(`✗ 空位对不上：代码里 ${blanksInCode} 个 ____、blanks 有 ${q.blanks.length} 个`)
    cfFailures.push({ key, rel, why: '空位个数与 blanks 不一致（校验器本该拦住这条）' })
    continue
  }

  /*
   * ⚠️ 超时给 20s（默认是 60s）。这些是教学片段，正常都是毫秒级；
   * 真撞上死循环时 20s 一道还能忍，60s × 若干道会让整道闸门慢到没人愿意跑
   * —— 而**没人跑的闸门等于不存在**。
   */
  const r = runBlock(q.lang, 填空位(q.code, q.blanks), { stdin: '', timeoutMs: 20_000 })

  if (!r.ok) {
    /*
     * 报的时候分两类，因为处理方式完全不同：
     *   · 在读 stdin —— 这个题型**没有 stdin 字段**，这类只能显式豁免（写清理由）
     *   · 别的       —— 答案写错了，去把那个空位的答案改对
     * 混成一句话会让人对着"跑不起来"去改答案，而它其实是题型限制。
     */
    const 要读输入 = /EOFError|EOF when reading|NoSuchElementException|EOFException/i.test(r.output ?? '')
    console.log(`✗ 填回去跑不起来（${r.phase} 阶段）${要读输入 ? ' —— 它在读输入，而这个题型没有 stdin 字段' : ''}`)
    show('', r.output)
    cfFailures.push({ key, rel, why: `${r.phase} 阶段跑不起来${要读输入 ? '（要读 stdin）' : ''}`, output: r.output })
    continue
  }

  console.log('✓ 填回去跑得起来')
  cfPass++

  /*
   * `accept`（等价答案）也各填一遍、各跑一遍。
   *
   * **为什么要管它**：一条 `accept` 就是一句「**这种写法也对**」的承诺。
   * 它要是填进去根本跑不起来，那这句承诺是假的 —— 学员照着它写，学到的是错的。
   * 而且它和主答案一样**没有任何人跑过**（校验器只检查它是字符串、不含换行）。
   *
   * ⚠️ 它单独记一份（`cfAcceptFailures`），不和主答案混在一起：主答案塌了
   * 说明这道题**没了**，等价答案塌了说明这道题**多了一句错话**，两件事。
   */
  for (let bi = 0; bi < q.blanks.length; bi++) {
    for (const alt of q.blanks[bi].accept ?? []) {
      const 变体 = q.blanks.map((b, j) => (j === bi ? { answer: alt } : b))
      const ra = runBlock(q.lang, 填空位(q.code, 变体), { stdin: '', timeoutMs: 20_000 })
      if (ra.ok) {
        cfAcceptPass++
      } else {
        cfAcceptFailures.push({ key, rel, alt, bi: bi + 1, output: ra.output })
      }
    }
  }
}

// ---------------------------------------------------------------- 豁免表防霉

/*
 * 一条指不到任何真题目的豁免，是**一句没人能验证的话** ——
 * 它看起来在说「这道题我审查过了」，实际上那道题可能早就删了或改了名。
 * 让它报红，豁免表才会跟着内容一起腐烂、一起被清理。
 *
 * ⚠️ **只在全量扫描时判这件事。** 带课号过滤时 `keySeen` 里只有那几节课的题，
 * 表里其余豁免当然"指不到任何真题" —— 那是**过滤造成的假象，不是过期**。
 * （第一版没加这个条件，`node check-code-answers.mjs python-stage1` 会报
 *  「2 条豁免过期」，而它们好好的。闸门会因为一个和内容无关的理由变红。）
 */
const stale = only
  ? []
  : [
      ...Object.keys(豁免).filter((k) => !keySeen.has(k)),
      ...Object.keys(豁免_codefill).filter((k) => !keySeen.has(k))
    ]

// ---------------------------------------------------------------- 汇总

/** 三处问题：主答案（两类题型各一处）+ 等价答案那一处 */
const 有问题 = failures.length > 0 || cfFailures.length > 0 || cfAcceptFailures.length > 0
const 出口 = 有问题 || stale.length > 0 || parseErrors > 0 ? 1 : 0

console.log(`\n${'═'.repeat(60)}`)
console.log(`  code      ✓ 真跑对得上 ${pass}   ∅ 显式豁免 ${exempt}   ✗ 有问题 ${failures.length}`)
console.log(`  codefill  ✓ 填回去跑得起来 ${cfPass}   ∅ 显式豁免 ${cfExempt}   ✗ 有问题 ${cfFailures.length}`)
if (cfAcceptPass > 0 || cfAcceptFailures.length > 0) {
  console.log(`  accept    ✓ 等价答案也跑得起来 ${cfAcceptPass}   ✗ 跑不起来 ${cfAcceptFailures.length}`)
}
if (stale.length) console.log(`  ⚠️ 过期的豁免 ${stale.length}`)
if (fillAccepts.length) {
  /*
   * ⚠️ 这两类**必须分开说**，不能混成一句「跑不了」：
   *   代码语言那些是**真盲区**（有代码形状却没东西可执行）；
   *   common 那些是**本来就不需要跑**（问的是「这一招叫什么」这种文字答案）。
   * 混着说会让读的人以为 common 也在等一次真跑 —— 那是凭空造出来的欠账。
   */
  const 码Lang = new Set(['c', 'cpp', 'java', 'python'])
  const 码 = fillAccepts.filter((f) => 码Lang.has(f.rel.split('/')[1]))
  /*
   * ⚠️ 两个数**单位不同，必须各自写明**：几「处」是题目数（一个有 accept 的 fill 算一处），
   * 几「条」是 accept 写法数（一道题可以收好几种写法）。并排写却不标单位，
   * 就会像 2026-09-16 那次一样：19 和 12 摆在一起，看着像同一把尺子量出来的，其实不是。
   */
  const 处 = (a) => `${a.length} 处`
  const 条 = (a) => `${a.reduce((n, f) => n + f.accept.length, 0)} 条写法`
  if (码.length) {
    console.log(
      `  ⚠️ 代码语言的 fill 有 ${处(码)} accept（${条(码)}，${new Set(码.map((f) => f.rel)).size} 份文件）**这道闸门跑不了** —— fill 没有代码上下文。` +
        `\n     只能人眼读；\`--list\` 会把它们连题号一起列出来。`
    )
  }
  const 通 = fillAccepts.filter((f) => !码Lang.has(f.rel.split('/')[1]))
  if (通.length) console.log(`  · common 的 fill 有 ${处(通)} accept（${条(通)}）：文字同义词容错，本来就不需要跑`)
}

if (failures.length) {
  console.log('\n有问题的清单：')
  for (const f of failures) console.log(`  · ${f.key} [${f.rel}] ${f.why}`)
  console.log('\n怎么改：')
  console.log('  · 答案本来就该是别的 → **按真跑出来的那份改 `answer`**（这是绝大多数情况）')
  console.log('  · 答案确实不是 stdout（问行数 / 问假想输入）→ 登记进本脚本顶部的 `豁免` 表，写明答案是什么')
  console.log('  **不要为了让闸门变绿去改这个脚本的判据。**')
}

if (cfFailures.length) {
  console.log('\ncodefill 有问题的清单：')
  for (const f of cfFailures) console.log(`  · ${f.key} [${f.rel}] ${f.why}`)
  console.log('\n怎么改：')
  console.log('  · 是这个空位的**答案写错了** → 改答案，让填回去跑得起来（绝大多数情况）')
  console.log('  · 是这段代码**本来就要读输入**（本题型没有 stdin 字段）→ 登记进 `豁免_codefill`，写清为什么')
  console.log('  · 是这道题**故意**要演示报错 → 同上，但理由里写明"演示的就是这个错"')
  console.log('  **不要为了让闸门变绿去改这个脚本的判据。**')
}

if (cfAcceptFailures.length) {
  console.log('\n等价答案（accept）填回去跑不起来的：')
  for (const f of cfAcceptFailures) {
    console.log(`  · ${f.key} 第 ${f.bi} 个空的 accept ${JSON.stringify(f.alt)}`)
    show('', f.output)
  }
  console.log('  一条 accept 就是一句「这种写法也对」的承诺，跑不起来 = 承诺是假的')
  console.log('  → 删掉那条 accept，或者把它改成真跑得起来的写法。')
}

if (stale.length) {
  console.log('\n过期的豁免（指不到任何真题，删掉它们）：')
  for (const k of stale) console.log(`  · ${k}`)
}

if (emit) {
  console.log('\n—— 照抄进顶部的 `豁免` 表 ——\n')
  console.log('const 豁免 = {')
  for (const f of failures) {
    console.log(`  '${f.key}': {`)
    console.log(`    答案是什么: '${f.want.replace(/\n/g, '\\n').slice(0, 60)}',`)
    console.log(`    为什么跑不出来: '【待填：真跑出来的是 ${f.got.replace(/\n/g, '\\n').slice(0, 40)}】'`)
    console.log(`  },`)
  }
  console.log('}')
  if (cfFailures.length) {
    console.log('\n—— 照抄进顶部的 `豁免_codefill` 表（理由必须自己写，别留空）——\n')
    console.log('const 豁免_codefill = {')
    for (const f of cfFailures) {
      console.log(`  '${f.key}': {`)
      console.log(`    答案是什么: '【待填：这道题的空位答案该怎么描述】',`)
      console.log(`    为什么跑不起来: '【待填：${f.why}】'`)
      console.log(`  },`)
    }
    console.log('}')
  }
}

console.log('')
console.log(
  出口 === 0
    ? `结果：code ${pass} 道 + codefill ${cfPass} 道真跑通过（另 ${exempt + cfExempt} 道显式豁免、` +
        `${cfAcceptPass} 条等价答案也跑过）—— 这些**手写答案**都有真跑背书，或有一句写明的理由。`
    : `结果：code ${failures.length} 道、codefill ${cfFailures.length} 道没通过，` +
        `等价答案 ${cfAcceptFailures.length} 条没通过，${stale.length} 条豁免过期。`
)
if (cfTargets.length > 0) {
  console.log(
    '⚠️ 这道闸门对 codefill 只证到「填回去跑得起来」，**不证「跑出来是对的」** —— ' +
      '既跑得起来又跑错了的答案（`range(3)` vs `range(1,4)`）它一个都拦不住。'
  )
}
process.exit(出口)
