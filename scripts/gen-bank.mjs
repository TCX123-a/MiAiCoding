#!/usr/bin/env node
/**
 * 无限题库生成器 —— 把 `scripts/bank/templates/*.json` 浇铸成
 * `content/challenge-bank/<lang>/<lessonId>.json` 里的一道道**真题**。
 *
 * 【这台机器的核心，一句话】
 * **不让 AI 写 200 道题，让 AI 写 60 个模板，让本地编译器把题目算出来。**
 * 模板是人（或 AI）写的，但 `expectedOutput` **一个字都不是写的** ——
 * 它是参考解在本机真跑一遍吐出来的东西。这样"标准答案对不对"就不再是一个
 * 需要信任的断言，而是一件被真的执行过的事实。
 *
 * 【为什么必须有这台机器，而不是一道道手写】
 * `docs/09` 要求每节语言课至少 1 道 codefix + 1 道 codewrite，180 节语言课 =
 * 至少 360 道。手写的话，每一道的 `expectedOutput` 都是一个**没人验证过的断言**，
 * 写错一个空格，学员把参考解一字不差地敲进去也过不了关 —— 而他看不到"题目错了"，
 * 只看到"我明明是对的"。
 *
 * 【它一次做五件事，缺一件这道题就不能要】
 *   ① 参考解真跑（判分输入）→ `expectedOutput` 是**跑出来的**
 *   ② 参考解真跑（样例输入）→ `sampleOutput` 也是跑出来的（docs/14 §5.2 规则 2）
 *   ③ 样例输入和判分输入**必须不同**（规则 1）—— 一样的话学员 `print(样例答案)` 就能过
 *   ④ `brokenCode` 真跑一遍，断言它**确实坏**（规则 3，判据见 §5.3）
 *   ⑤ 【2026-09-28 补】`codewrite` 的**骨架**真跑一遍，断言它**没到"一行不写就过"**
 *      —— ④ 的镜像。判据在 `bank-verify.mjs` ④；命中时这里的动作是**换一组输入重抽**
 *
 * 判据本身不在这里，在 `lib/bank-verify.mjs` —— 和 `check-question-code.mjs`、
 * `check-bank.mjs` **共用同一份**。生成器只是"跑一遍并当场判"，不是另立一套标准。
 *
 * 【纪律：这个文件里不许出现第二个判断"这道题对不对"的地方】
 * 生成器唯一的特权是**把跑出来的 stdout 写进 expectedOutput**。
 * 除此之外它和闸门看到的是同一份内容、走的是同一个 `verifyRunQuestion`。
 *
 * 用法：
 *   node scripts/gen-bank.mjs --dry-run        # 只说要产什么，不跑代码、不写盘
 *   node scripts/gen-bank.mjs                  # 按模板里的 instances 产
 *   node scripts/gen-bank.mjs --lang python    # 只跑某门语言
 *   node scripts/gen-bank.mjs --template py-s1-sum-loop
 *   node scripts/gen-bank.mjs --count 2        # 覆盖模板里写的 instances（试跑用）
 *   node scripts/gen-bank.mjs --force          # 重算并覆盖同 id 的旧条目
 *
 * 【它是一个不出网的程序】不调任何 API、不读任何 Key。模板是人写的，
 * 这台机器只负责把模板**算成题**。（docs/14 §8.3：API Key 绝不接受 `--key` 参数。）
 */
import { readFileSync, writeFileSync, mkdirSync, globSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import {
  DEFERRED_PLACEHOLDERS,
  enumerateParams,
  paramsKey,
  drawInputs,
  instantiate,
  finalizeDraft,
  contentHash
} from './lib/bank.mjs'
import { normalizeRunOutput, runBlock } from './lib/run-code.mjs'
import { verifyRunQuestion, referenceKeyOf, RUN_TIMEOUT_MS } from './lib/bank-verify.mjs'

const ROOT = process.cwd()
const TEMPLATE_DIR = join(ROOT, 'scripts', 'bank', 'templates')
const BANK_DIR = join(ROOT, 'content', 'challenge-bank')
const SYLLABUS = join(ROOT, 'content', 'syllabus.json')

/** 题库文件的版本号。条目结构变了（加字段、换语义）就 +1 —— 见 docs/14 §4.1 */
const BANK_VERSION = 1

/**
 * 难度值域。真源是 `src/shared/difficulty.ts` 的 `DIFFICULTIES` ——
 * .mjs 脚本 import 不了 TS，按老规矩抄一份，由
 * `src/shared/__tests__/difficulty.test.ts` 读本文件源码钉住两份一致。
 *
 * 模板里的 `difficulty` 是**可选的显式覆盖**，目前唯一用途是把精选模板
 * 标成 `challenge`（挑战题只在阶段综合练习/整门练习/每日挑战里出现）。
 * 难度**不进 contentHash**（见 lib/bank.mjs 的 contentHash 字段表）——
 * 给存量条目补难度标不作废任何验证戳。
 */
const VALID_DIFFICULTIES = ['easy', 'medium', 'hard', 'challenge']

/**
 * 骨架空过时，最多换几组输入重抽（判据见 `lib/bank-verify.mjs` ④）。
 *
 * 为什么是"重抽"而不是"跳过这道题"：空过不是模板写错了，是**这一组输入**恰好
 * 让不完整的骨架给出了正确输出（2026-09-28 实测 `java-s3-merge-join-write`：
 * 落点输入恰好"左半段全小于右半段"，两道题都是）。换一组输入就没事了 ——
 * 而跳过会让每课少一道题，题量是内容的一部分，不该为一个抽签问题减掉。
 *
 * 为什么要**有上限**：某类模板可能**整个输入空间**都空过（那才是模板写错了）。
 * 那时必须**当场报红**、这道题不产，绝不许一路重抽到"总有一次能过"为止 ——
 * 那正是本项目最不能要的"默认回退为成功"。8 次全中的概率按实测的单次量级
 * 可以忽略，所以撞到上限 = 模板真有问题，该由人来看。
 */
const MAX_STARTER_RETRY = 8

// ---------------------------------------------------------------- 命令行

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const opt = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const DRY = flag('dry-run')
const FORCE = flag('force')
const ONLY_LANG = opt('lang')
const ONLY_TEMPLATE = opt('template')
const COUNT_OVERRIDE = opt('count') === undefined ? undefined : Number(opt('count'))

/*
 * ⚠️ 不认识的参数必须**当场停住**，绝不许退化成「裸跑」。
 *
 * 2026-09-16 批 7 实测：一位代理敲了 `node scripts/gen-bank.mjs --help`（本脚本当时不认这个参数），
 * 脚本于是按**裸跑**执行 —— 而裸跑的语义是「按模板重算并覆盖整个题库」，它无条件 `writeFileSync`，
 * 于是 10:56:19 全库产物被原地重写了一遍。
 *
 * 这一条的要害不是"那次有没有造成损失"，是**"我想看看帮助"和"重写整个题库"之间只差一个不认识的参数**。
 * 用法错误是必然会发生的（人敲错、代理猜参数），所以这个差别**必须由脚本自己拦**，
 * 不能指望每一个敲命令的人先读过源码顶上的注释。静默忽略未知参数 = 把一次手滑放大成一次全库写入。
 */
const HELP = flag('help') || argv.includes('-h')
const KNOWN_FLAGS = ['dry-run', 'force', 'help', 'h']
const KNOWN_OPTS = ['lang', 'template', 'count']
{
  const unknown = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('-')) continue // 选项的值（或 -h），由上一个分支负责跳过
    const name = a.replace(/^--?/, '')
    if (KNOWN_FLAGS.includes(name)) continue
    if (KNOWN_OPTS.includes(name)) {
      i++ // 跳过它的值
      continue
    }
    unknown.push(a)
  }
  if (unknown.length) {
    console.error(`✗ 不认识的参数：${unknown.join(' ')}`)
    console.error('  本脚本**不会**忽略不认识的参数 —— 忽略就等于裸跑，而裸跑会重算并覆盖整个题库。')
    console.error('  可用：--dry-run（只说不做）/ --force（重算覆盖同 id 的旧条目）/')
    console.error('        --lang <语言> / --template <id> / --count <次>（试跑用）')
    process.exit(2)
  }
}
if (HELP) {
  console.log('用法：')
  console.log('  node scripts/gen-bank.mjs --dry-run            # 只说要产什么，不跑代码、不写盘')
  console.log('  node scripts/gen-bank.mjs                      # 按模板里的 instances 产【全库】')
  console.log('  node scripts/gen-bank.mjs --template <id>      # 只产一个模板（并发写模板时用这个）')
  console.log('  node scripts/gen-bank.mjs --lang python        # 只跑某门语言')
  console.log('  node scripts/gen-bank.mjs --count 2            # 覆盖模板里写的 instances（试跑用）')
  console.log('  node scripts/gen-bank.mjs --force              # 重算并覆盖同 id 的旧条目')
  console.log('')
  console.log('⚠️ 不带任何参数 = 重算全库。想先看看会产什么，先加 --dry-run。')
  process.exit(0)
}

// ---------------------------------------------------------------- 大纲

/**
 * 大纲里全部课号。**模板挂的课必须真的存在** —— 拼错一个字母的话，
 * 生成器会安安静静地造出一个 `content/challenge-bank/python/python-stage1-08x.json`，
 * 而那份文件**永远不会被任何界面读到**（题库是按大纲课号索引的）。
 * 这种"产了但没人看得见"的错最该由机器拦住。
 */
const syllabusIds = new Set()
let syllabusLangs = new Map()
{
  const s = JSON.parse(readFileSync(SYLLABUS, 'utf8'))
  for (const m of s.modules ?? []) {
    for (const l of m.lessons ?? []) {
      syllabusIds.add(l.id)
      // `python-stage1-08` → `python`；`c-stage1-12` → `c`；`cpp-...` → `cpp`
      syllabusLangs.set(l.id, l.id.slice(0, l.id.indexOf('-')))
    }
  }
}
if (syllabusIds.size === 0) {
  console.error('✗ 大纲里一节课都没有 —— content/syllabus.json 结构变了？')
  process.exit(2)
}

// ---------------------------------------------------------------- 装载模板

/**
 * 校验一个模板**结构上**站得住。这里只拦"一眼就是错的"，
 * "这道题对不对"要跑起来才知道 —— 那是 `verifyRunQuestion` 的事。
 *
 * @returns {string[]} 问题清单（空 = 干净）
 */
function lintTemplate(t, file) {
  const bad = []
  const need = (k) => {
    if (!t[k]) bad.push(`缺 ${k}`)
  }
  need('templateId')
  need('lang')
  need('lessonId')
  need('type')
  need('stemTemplate')

  if (t.type !== 'codefix' && t.type !== 'codewrite') {
    bad.push(`type 只能是 codefix / codewrite，写的是 ${t.type}`)
  }
  if (!['c', 'cpp', 'java', 'python'].includes(t.lang)) {
    bad.push(`lang 只能是 c / cpp / java / python，写的是 ${t.lang}`)
  }

  /*
   * ⚠️ **模板里不许有 expectedOutput。**
   * 它是这台机器存在的全部理由 —— 一旦允许人写，写错一个换行就没人发现，
   * 而学员会"照着参考解敲进去却判错"。宁可在这里硬拦，也不要一个能写答案的入口。
   */
  if ('expectedOutput' in t) {
    bad.push('模板里不能有 expectedOutput —— 它是参考解真跑出来的，不是写的')
  }

  /*
   * `difficulty` 可选，但给了就必须在值域内 —— 它会**原样透传**进条目，
   * 一个写歪的值（'hard '、'挑战'）在运行时会被当作难度字段本身使用，
   * 没有任何地方会响。空串/假值当"没写"处理（不在这里报，走缺省规则）。
   */
  if (t.difficulty !== undefined && !VALID_DIFFICULTIES.includes(t.difficulty)) {
    bad.push(`difficulty 非法：${JSON.stringify(t.difficulty)}（只能是 ${VALID_DIFFICULTIES.join(' / ')}）`)
  }

  if (t.lang && t.type === 'codefix') {
    if (!t.brokenCodeTemplate) bad.push('codefix 缺 brokenCodeTemplate')
    if (!t.referenceFixTemplate) bad.push('codefix 缺 referenceFixTemplate')
  }
  if (t.lang && t.type === 'codewrite') {
    if (!t.referenceSolutionTemplate) bad.push('codewrite 缺 referenceSolutionTemplate')
  }

  /*
   * 大纲核对：课号存在，且语言对得上。
   * `python` 的模板挂到 `c-stage1-12` 上会生成一份谁也读不到的题 —— 而且它看起来完全正常。
   */
  if (t.lessonId && !syllabusIds.has(t.lessonId)) {
    bad.push(`lessonId「${t.lessonId}」不在大纲里（拼错了？这份题库永远不会被读到）`)
  } else if (t.lessonId && t.lang && syllabusLangs.get(t.lessonId) !== t.lang) {
    bad.push(`lessonId「${t.lessonId}」是 ${syllabusLangs.get(t.lessonId)} 的课，模板却写 lang=${t.lang}`)
  }

  return bad.map((m) => `${file}: ${m}`)
}

if (!existsSync(TEMPLATE_DIR)) {
  console.error(`✗ 找不到模板目录：${TEMPLATE_DIR}`)
  process.exit(2)
}

const templates = []
const problems = []
for (const file of globSync('*.json', { cwd: TEMPLATE_DIR }).sort()) {
  let t
  try {
    t = JSON.parse(readFileSync(join(TEMPLATE_DIR, file), 'utf8'))
  } catch (e) {
    problems.push(`${file}: JSON 解析失败 —— ${e.message}`)
    continue
  }
  const bad = lintTemplate(t, file)
  if (bad.length) {
    problems.push(...bad)
    continue
  }
  if (ONLY_LANG && t.lang !== ONLY_LANG) continue
  if (ONLY_TEMPLATE && t.templateId !== ONLY_TEMPLATE) continue
  templates.push(t)
}

if (problems.length) {
  console.error('✗ 模板有问题，一道题都不产：\n')
  for (const p of problems) console.error(`  · ${p}`)
  process.exit(1)
}
if (templates.length === 0) {
  console.error(
    ONLY_LANG || ONLY_TEMPLATE
      ? `✗ 没有模板匹配「${ONLY_TEMPLATE ?? ONLY_LANG}」—— 一节课都跑不到，不假装成功。`
      : `✗ ${TEMPLATE_DIR} 里一个模板都没有。`
  )
  process.exit(2)
}

// ---------------------------------------------------------------- 现有的题库

/**
 * 读一份题库文件；不存在就是空的（第一次生成时的正常状态）。
 *
 * ⚠️ **必须先看 `dirty`，不能只顾磁盘。** 这里踩过一个会**静默丢题**的坑：
 * 同一课可以挂好几个模板（`python-stage1-08` 挂着 sum-loop / sum-evens /
 * off-by-one 三个），而每个模板都会来读一次文件。三个模板各自读到的是
 * **同一次运行开始前**的内容，各自往里塞自己的题，最后只有一个版本的 `data`
 * 被写下来 —— 另外两个模板产出的题**一道都不在文件里**。
 *
 * 而汇总那行照样打印「新产 6 道」，因为计数器是在产出时加的，跟落盘无关。
 * 于是表现是：日志说 6 道、文件里 3 道、闸门跑一遍也全绿（它只看文件里有什么）。
 * 要不是十道题的数字对不上，这个洞会一直留到语言课批量生产的时候。
 *
 * 修法就是这一行：同一次运行里改过的文件，后续模板读到的必须是**改过之后**的版本。
 */
function readBank(lang, lessonId) {
  const path = join(BANK_DIR, lang, `${lessonId}.json`)
  if (dirty.has(path)) return { path, data: dirty.get(path) }
  if (!existsSync(path)) return { path, data: { lessonId, bankVersion: BANK_VERSION, items: [] } }
  const data = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(data.items)) throw new Error(`${path} 里没有 items 数组`)
  return { path, data }
}

// ---------------------------------------------------------------- 逐模板浇铸

let made = 0
let skipped = 0
const failures = []
/** path → 数据。同一次运行里多个模板可能落进同一个文件（同一课的几个模板），所以先攒着一起写 */
const dirty = new Map()

/**
 * 在 `[0, total)` 里挑 `k` 个**尽量散开**的下标。
 *
 * 【为什么不是"取前 k 个"】踩过：`enumerateParams` 是笛卡尔积，**最后声明的那个参数
 * 变得最快**。`py-s1-sum-loop` 的参数是 `n / unit / verb`，取前 3 个组合拿到的是
 * 「捞/叼/囤」三条 —— `n` 全是 3、名词全是「条小鱼干」。
 * 也就是说三道题只差一个动词，正是 `docs/14` §4.2 警告的那件事：
 * **学员看到的是"同一道题换了几个名词"，比重复出同一道题更让人腻。**
 *
 * 均匀撒点之后取到的是 `n = 3 / 4 / 6`，循环圈数真的变了 —— 那才是这道题该变的东西。
 *
 * 【为什么这样仍然幂等】下标只由 `(参数空间大小, k)` 决定，和"文件里已经有什么"无关；
 * 每个下标**至多对应一套参数、至多产出一个 id**，所以重跑不会撞 id、也不会产重复参数。
 * k 改大时旧条目原地留着（它们仍然是好题），新下标补进来。
 */
function spreadIndices(total, k) {
  if (k <= 0) return []
  if (k === 1) return [Math.floor((total - 1) / 2)] // 单个时取中间那套，别老是取最小的一套
  const out = new Set()
  for (let i = 0; i < k; i++) out.add(Math.round((i * (total - 1)) / (k - 1)))
  return [...out]
}

for (const t of templates) {
  const combos = enumerateParams(t.params)
  const 想要 = COUNT_OVERRIDE ?? t.instances ?? 1
  if (想要 > combos.length) {
    console.log(
      `⚠️  ${t.templateId} 要 ${想要} 道，但参数空间只有 ${combos.length} 套 —— 按 ${combos.length} 道算。`
    )
  }
  const want = Math.min(想要, combos.length)
  const targets = spreadIndices(combos.length, want)

  const { path, data } = readBank(t.lang, t.lessonId)

  /*
   * 现有条目先过一次「参数空间对账」：
   *   · 参数已经不在模板值域里 → 旧条目，删；
   *   · id 和参数枚举序号对不上 → 旧 bug 留下的错位 id，删（落点会重新产）；
   *   · 同参数重复条目 → 只留第一条。
   *
   * 不这样对账的话，`existing` 按 paramsKey 命中后直接 skip，错位 id / 重复
   * 条目会一路留到发布；而落地自检只数「n >= want」，多出来的和错位的都看不见。
   */
  const idOfCombo = new Map()
  combos.forEach((p, i) =>
    idOfCombo.set(paramsKey(p), `bank-${t.templateId}-${String(i).padStart(3, '0')}`)
  )
  const seenParams = new Set()
  const keptItems = []
  for (const it of data.items) {
    if (it.templateId !== t.templateId) {
      keptItems.push(it)
      continue
    }
    const key = paramsKey(it.params)
    const expectedId = idOfCombo.get(key)
    if (!expectedId) continue // 参数已不在当前模板值域
    if (it.id !== expectedId) continue // id 与参数枚举序号错位
    if (seenParams.has(key)) continue // 同参数重复
    seenParams.add(key)
    keptItems.push(it)
  }
  data.items = keptItems

  const existing = new Map()
  for (const it of data.items) {
    if (it.templateId === t.templateId) existing.set(paramsKey(it.params), it)
  }

  console.log(`\n═══ ${t.templateId}  [${t.type}/${t.lang}] → ${t.lessonId}`)
  console.log(
    `    参数空间 ${combos.length} 套，模板要 ${want} 道，已有 ${existing.size} 道` +
      `（本次落点：${targets.slice(0, 8).join(', ')}${targets.length > 8 ? ' …' : ''}）`
  )

  /*
   * 换输入重抽只对「输入真会随种子变」的模板有意义。
   * `stdinSpec` 缺失（没有输入）或 `kind === 'raw'`（正文写死、不看种子）时，
   * 每一次重抽拿到的是**逐字节相同**的输入和代码 —— 原逻辑会空转 8 次再报红，
   * 日志看起来像"试过了"，实际一次都没试。这里直接判为模板问题，当场说清楚。
   */
  const canVaryInputs = Boolean(t.stdinSpec) && t.stdinSpec.kind !== 'raw'

  let taken = 0
  eachIdx: for (const idx of targets) {
    const params = combos[idx]
    const key = paramsKey(params)
    const id = `bank-${t.templateId}-${String(idx).padStart(3, '0')}`

    if (existing.has(key) && !FORCE) {
      skipped++
      continue
    }

    if (DRY) {
      const inputs = drawInputs(t.stdinSpec, params, `${t.templateId}|${idx}`)
      console.log(`    · ${id} params=${JSON.stringify(params)} 样例输入=${JSON.stringify(inputs.sample)}`)
      taken++
      made++
      continue
    }

    /*
     * 内层这一圈是**重抽**，不是"再试一次"：
     *
     * 种子原本只由 (模板, 组合序号) 决定 —— 同一套参数重跑得到同一批数，
     * 否则"这个文件是不是最新的"永远说不清（见 bank.mjs 的 rngFrom 注释）。
     * 2026-09-28 起多了 `|retryN` 这一维，但**它不是随机**：它是"骨架过没过"
     * 这个判定的函数，同一台机器、同一份模板重跑走到的 salt 完全一样，
     * 可复现性一个字都没少。命中 ④ 就 salt+1，用尽 MAX_STARTER_RETRY 次仍命中
     * 才记 failures（这道题不产）。
     *
     * ⚠️ 这一圈**没有自然出口**：每一次迭代都以 `continue eachIdx` 收场
     * （成功落盘、或某条判据报红）。往里面加 `break` 之前先想清楚它是给谁的。
     */
    for (let attempt = 0; ; attempt++) {
    const seed = `${t.templateId}|${idx}` + (attempt ? `|retry${attempt}` : '')
    const inputs = drawInputs(t.stdinSpec, params, seed)

    let draft, sampleInput
    try {
      ;({ draft, sampleInput } = instantiate(t, params, inputs))
    } catch (e) {
      console.log(`    ✗ ${id} 实例化失败：${e.message}`)
      failures.push({ id, why: `实例化失败：${e.message}` })
      continue eachIdx
    }

    // ── ① 参考解真跑（判分输入）→ expectedOutput
    const refKey = referenceKeyOf(t.type)
    const ref = runBlock(t.lang, draft[refKey], { stdin: draft.stdin, timeoutMs: RUN_TIMEOUT_MS })
    if (!ref.ok) {
      console.log(`    ✗ ${id} ${refKey} 在 ${ref.phase} 阶段就跑不起来：`)
      console.log(String(ref.output).split('\n').slice(0, 6).map((l) => `        | ${l}`).join('\n'))
      failures.push({ id, why: `${refKey} 跑不起来（${ref.phase}）：${String(ref.output).slice(0, 200)}` })
      continue eachIdx
    }
    // **存归一化之后的形状**，不存原始 stdout。理由不是"好看"：
    // 原始 stdout 里带着 `\r\n`（Windows）或 `\n`（Linux），存进去的话
    // **同一套参数在 Windows 上产出的文件和在 Linux 上产出的不一样**，
    // 内容哈希因此变成平台相关的 —— 换一台机器跑闸门就会全部变红，
    // 而红的原因跟题目对不对毫无关系。
    const expectedOutput = normalizeRunOutput(ref.stdout)
    if (!expectedOutput) {
      console.log(`    ✗ ${id} 参考解什么都没输出 —— 空 expectedOutput 等于"删光代码也能过"`)
      failures.push({ id, why: '参考解输出为空，expectedOutput 会是空的' })
      continue eachIdx
    }
    draft.expectedOutput = expectedOutput

    // ── ② 参考解真跑（**样例**输入）→ sampleOutput（规则 2：样例输出也是跑出来的）
    let sampleOutput = ''
    if (sampleInput !== undefined) {
      const s = runBlock(t.lang, draft[refKey], { stdin: sampleInput, timeoutMs: RUN_TIMEOUT_MS })
      if (!s.ok) {
        // 同一份代码、换一组输入就跑不起来 —— 这多半是"参考解只对判分那组数成立"，
        // 比如写死了某个边界。这种题学员拿样例去试就对不上，必须当场拦。
        console.log(`    ✗ ${id} 参考解拿**样例**输入跑不起来（判分那组却能跑）—— 参考解写死了？`)
        console.log(String(s.output).split('\n').slice(0, 6).map((l) => `        | ${l}`).join('\n'))
        failures.push({ id, why: `参考解对样例输入跑不起来（${s.phase}）：${String(s.output).slice(0, 200)}` })
        continue eachIdx
      }
      sampleOutput = normalizeRunOutput(s.stdout)
    }

    // ── ③④ 定稿：回填两个延迟占位符，并断言题面**和解析**里都不许还剩花括号
    // 判据与动作都在 `finalizeDraft()` 一处 —— 这里不再自己拼。
    // 2026-09-16 之前这两步是分开写的、且只作用于 `draft.stem`，
    // 于是解析里的 `{sampleInput}` 一路绿灯上了线。
    try {
      finalizeDraft(draft, sampleInput, sampleOutput)
    } catch (e) {
      console.log(`    ✗ ${id} 定稿失败：${e.message}`)
      failures.push({ id, why: `定稿失败：${e.message}` })
      continue eachIdx
    }

    // ── ⑤ 组装条目
    //
    // 字段顺序是**刻意固定**的：JSON 按写出顺序落盘，顺序一变 git diff 就整段翻红，
    // 而那种红和内容没有任何关系。`verified` 放最后，因为它是"关于上面那些字段"的话。
    //
    // `difficulty` **只在模板显式写了时才出现** —— 缺省难度由运行时按题型+阶段
    // 解析（shared/difficulty.ts），不给每一道存量题补一个字段。
    // 它不进 contentHash（lib/bank.mjs 的字段表没列它），所以给条目改难度标
    // 不会让验证戳过期 —— 这是刻意的：难度不参与"这道题对不对"。
    const item = {
      id,
      type: t.type,
      lang: t.lang,
      ...(t.difficulty ? { difficulty: t.difficulty } : {}),
      stem: draft.stem,
      ...(t.type === 'codefix'
        ? { brokenCode: draft.brokenCode, referenceFix: draft.referenceFix }
        : { starter: draft.starter ?? null, referenceSolution: draft.referenceSolution }),
      expectedOutput: draft.expectedOutput,
      stdin: draft.stdin ?? null,
      explanation: draft.explanation,
      templateId: t.templateId,
      params,
      verified: null // 占位：哈希要**先有内容**才算得出来，下一行才算它
    }
    item.verified = {
      at: new Date().toISOString(),
      // 内容哈希：以后有人改了 referenceFix 却忘了重验，闸门靠这个自己发现
      hash: contentHash(item)
    }

    // ── ⑥ 当场用闸门那份判据判一遍
    //
    // 为什么刚跑完还要再判一次（多花一次编译）：这样**生成器产不出闸门会拒的东西**。
    // 少了这一步，生成器和闸门就成了两套标准，而"两边不一致"只会在别人重跑闸门时
    // 才暴露出来 —— 那时候题已经写进文件、甚至已经发布了。
    const v = verifyRunQuestion(item)
    if (!v.ok) {
      // 骨架一行不写就过 → 不是模板写错了，是**这一组输入**恰好不需要动手：换一组重抽
      // （筛选用 `code`，不匹配中文措辞 —— 措辞会改，code 是接口）
      if (v.code === 'starter-not-broken' && canVaryInputs && attempt < MAX_STARTER_RETRY) {
        console.log(`    ↻ ${id} 换输入重抽（第 ${attempt + 1} 次）：这组输入的骨架一行不写就过`)
        continue
      }
      if (v.code === 'starter-not-broken' && !canVaryInputs) {
        console.log(
          `    ✗ ${id} 骨架一行不写就过；这个模板没有可变的 stdin 输入（stdinSpec=` +
            `${t.stdinSpec ? t.stdinSpec.kind : '无'}），换输入重抽是空转 —— 请改 starterTemplate`
        )
        failures.push({
          id,
          why: 'starter 一行不写就过，且模板没有可变的 stdin 输入，重抽无效（请改 starterTemplate）'
        })
        continue eachIdx
      }
      console.log(`    ✗ ${id} 没通过判据：${v.why}` + (attempt ? `（已重抽 ${attempt} 次）` : ''))
      if (v.got) console.log(String(v.got).split('\n').slice(0, 5).map((l) => `        | ${l}`).join('\n'))
      failures.push({ id, why: v.why })
      continue eachIdx
    }

    // 同 id 的旧条目（`--force` 重算时）就地换掉，别的条目一个不碰
    const at = data.items.findIndex((x) => x.id === id)
    if (at >= 0) data.items[at] = item
    else data.items.push(item)

    const 备注 = t.type === 'codefix'
      ? `brokenCode 确实${v.brokenPhase === 'compile' ? '编不过' : v.brokenPhase === 'plan' ? '起不来' : '跑错'}`
      : '参考解真跑通过'
    console.log(
      `    ✓ ${id}  ` +
        `params=${JSON.stringify(params)}  expected=${JSON.stringify(expectedOutput.slice(0, 30))}  ${备注}` +
        (attempt ? `  （重抽 ${attempt} 次才拿到干净输入）` : '')
    )
    taken++
    made++
    continue eachIdx // 内层重抽圈的唯一出口之一（另一个是上面那条报红）
    } // ← 重抽圈到此为止；它没有自然出口，别再往里加 `break`
  }

  if (taken === 0 && !DRY) {
    console.log(`    （没有新组合要产 —— 参数空间已经用完，或者全在文件里了）`)
  }
  dirty.set(path, data)
}

// ---------------------------------------------------------------- 落盘

if (!DRY) {
  for (const [path, data] of dirty) {
    // 按 id 排序：id 里带着模板名和枚举序号，所以顺序**只由模板决定**，
    // 和"这次先跑了哪个模板"无关。不排的话，跑两次的文件顺序可能不同。
    data.items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
    console.log(`\n📝 ${path.replace(ROOT, '.').replace(/\\/g, '/')}  （${data.items.length} 道）`)
  }
}

/*
 * ── 落盘之后**重新从磁盘读一遍**，数一数每个模板的题是不是真的在里面
 *
 * 【为什么非要回头数一次】因为踩过一个静默丢题的坑：三个模板落在同一个课，
 * 各自读到的是同一次运行开始前的文件，最后只有一个版本被写下去 —— 另外两个
 * 模板的题**一道都没进文件**，而汇总照样打印「新产 6 道」。计数是在产出时加的，
 * 和落盘毫无关系。
 *
 * 教训不是"修那一行"，而是：**"我说我产了 N 道"和"文件里有 N 道"是两件事**，
 * 必须分别数、对着看。这正是项目铁律「静默跳过 = 把『没验过』伪装成『验过了』」
 * 的一个新面孔 —— 这里伪装的是"产过了"。
 */
if (!DRY) {
  console.log(`\n${'─'.repeat(60)}\n落盘自检（重新读文件，不信内存里的计数）：`)
  let auditBad = 0
  for (const t of templates) {
    const combos = enumerateParams(t.params)
    const 想要 = Math.min(COUNT_OVERRIDE ?? t.instances ?? 1, combos.length)
    const path = join(BANK_DIR, t.lang, `${t.lessonId}.json`)
    let mine = []
    try {
      const back = JSON.parse(readFileSync(path, 'utf8'))
      mine = back.items.filter((x) => x.templateId === t.templateId)
    } catch (e) {
      console.log(`  ✗ ${t.templateId} 读不回自己的文件：${e.message}`)
      auditBad++
      continue
    }

    /*
     * 光数「有没有 n 道」不够 —— 那个判据对下面三种坏法全瞎：
     *   · 同一个参数写了两道（--force 的旧 bug 会造出来）；
     *   · id 和参数枚举序号错位（改了参数值域后只留下旧 id）；
     *   · 参数已经不在当前模板值域里（模板改了，旧题还在文件里）。
     * 它们都能让「n >= want」成立，却让题库里混进重复题/对不上号的题。
     */
    const idOfCombo = new Map()
    combos.forEach((p, i) =>
      idOfCombo.set(paramsKey(p), `bank-${t.templateId}-${String(i).padStart(3, '0')}`)
    )
    const seen = new Set()
    const dup = []
    const badParam = []
    const badId = []
    for (const it of mine) {
      const key = paramsKey(it.params)
      if (seen.has(key)) dup.push(it.id)
      else seen.add(key)
      const expectedId = idOfCombo.get(key)
      if (!expectedId) badParam.push(it.id)
      else if (it.id !== expectedId) badId.push(it.id)
    }

    let bad = false
    if (mine.length < 想要) {
      console.log(`  ✗ ${t.templateId} 说要 ${想要} 道，文件里只有 ${mine.length} 道 —— 有几道没写下去`)
      bad = true
    }
    if (dup.length) {
      console.log(`  ✗ ${t.templateId} 同参数重复 ${dup.length} 道：${dup.slice(0, 5).join(', ')}`)
      bad = true
    }
    if (badParam.length) {
      console.log(`  ✗ ${t.templateId} 参数不在当前值域里 ${badParam.length} 道：${badParam.slice(0, 5).join(', ')}`)
      bad = true
    }
    if (badId.length) {
      console.log(`  ✗ ${t.templateId} id 与参数枚举序号错位 ${badId.length} 道：${badId.slice(0, 5).join(', ')}`)
      bad = true
    }
    if (bad) {
      auditBad++
    } else {
      console.log(`  ✓ ${t.templateId} 文件里有 ${mine.length} 道（要 ${想要} 道，参数/ id 对账干净）`)
    }
  }
  if (auditBad) {
    console.error(`\n✗ 自检没过：${auditBad} 个模板的题没能全部落盘。`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------- 汇总

console.log(`\n${'═'.repeat(60)}`)
console.log(`  新产       ${made} 道`)
console.log(`  已有跳过   ${skipped} 道`)
console.log(`  失败       ${failures.length} 道`)
if (failures.length) {
  console.log('\n失败的清单（**这些题一道都没写进文件** —— 宁可少一道，不要一道错的）：')
  for (const f of failures) console.log(`  · ${f.id}  ${f.why}`)
}
if (DRY) console.log('\n（--dry-run：没有跑任何代码，也没有写任何文件）')
console.log(
  failures.length === 0
    ? made === 0
      ? '\n结果：没有新题要产（这是幂等重跑的**正常**结果，不是失败）。'
      : `\n结果：${made} 道题全部由本地真跑算出标准答案。下一步跑 \`npm run check:bank\` 独立复核一遍。`
    : `\n结果：${failures.length} 道没产出来 —— 那是模板的问题，不是机器的。`
)
process.exit(failures.length > 0 ? 1 : 0)
