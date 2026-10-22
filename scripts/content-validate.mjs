#!/usr/bin/env node
/**
 * 内容校验器 —— 内容质量闸门（唯一真源：content/）
 *
 * 九类检查（编号与下面 `checkLesson` 里的 `---- N.` 对应）：
 *   1. 目录结构：每课一目录（lesson.md + questions.json）；孤儿目录报错；大纲覆盖率仅作信息
 *   2. frontmatter：必填字段齐全、类型正确、与 syllabus.json 一致；解锁链引用存在、全图无环
 *   3. 正文规则：篇幅下限（防截断）、禁 HTML 标签、围栏语言标注、compare 块形状、
 *      demo 演示块形状（2026-09-19 新增，**这是补上闸门盲区的那一条**：
 *      check-lesson-code.mjs 对不认识的围栏语言是静默跳过的）
 *   4. 题库 schema：lessonId 一致、5-10 题、各题型字段齐全、答案合法
 *   5. 术语扫描（**两个方向**）：
 *      · 正文（除代码块）出现原术语 > 阈值（默认 2）报错 —— countTerms；
 *      · 题目的**选项/标准答案**里出现猫咪说法就报错（题干/解析放行）—— countCatTerms
 *   6. 题不外问：题目不能考课里没讲的东西
 *   7. 题目代码里的字符串字面量不许跨行
 *   8. 节课题型下限：语言课的 codefix / codewrite 至少各 1 题（手写 + 题库合起来算）
 *   9. 错误库：content/error-lib/*.json 的规则字段齐全、正则可编译、占位符与捕获组对得上
 *
 * 用法：
 *   node scripts/content-validate.mjs [--max-term-warnings 2]
 * 退出码：0 = 无错误；1 = 有错误（警告不导致失败）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTermScanner, createCatScanner } from './lib/terms.mjs'
import { missingStdexceptType, stdexceptMessage } from './lib/cpp-includes.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CONTENT = path.join(ROOT, 'content')

// 注意：必须判 -1，否则缺省时 argv[-1+1] = argv[0]（node 路径）→ Number(...) = NaN，
// 而 `total > NaN` 恒为 false，术语闸门会静默失效。
const flagIdx = process.argv.indexOf('--max-term-warnings')
const parsedMax = flagIdx === -1 ? NaN : Number(process.argv[flagIdx + 1])
const MAX_TERM_WARNINGS = Number.isFinite(parsedMax) && parsedMax >= 0 ? parsedMax : 2

/**
 * 难度值域。真源是 `src/shared/difficulty.ts` 的 `DIFFICULTIES` ——
 * 这里是 .mjs 脚本 import 不了 TS，按老规矩抄一份（同 CODE_FILL_MARKER），
 * 由 `src/shared/__tests__/difficulty.test.ts` 读本文件源码钉住两份一致。
 * 漂移的后果：校验器放行的值在运行时解析不出来，难度筛选静默筛不到题。
 */
const VALID_DIFFICULTIES = ['easy', 'medium', 'hard', 'challenge']

// ---------------------------------------------------------------- 基础工具

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** 极简 YAML frontmatter 解析（仅支持 key: value / [a, b, "c"] 子集，够用且零依赖） */
function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) return { data: null, body: text, malformed: false }
  const end = text.indexOf('\n---', 4)
  if (end === -1) return { data: null, body: '', malformed: true }
  const data = {}
  for (const line of text.slice(4, end).split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/)
    if (!m) continue
    data[m[1]] = parseYamlValue(m[2])
  }
  return { data, body: text.slice(end + 4).replace(/^\r?\n/, ''), malformed: false }
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

/**
 * 围栏信息串上允许出现的**标记**（写在语言后面，空格隔开）。
 *
 * 现在只有一个：`需要联网`。含义见 `check-lesson-code.mjs` 的 NET_MARK ——
 * 那段代码的输出取决于外面的世界，本机验不了，所以课文自己声明、闸门明说跳过。
 *
 * ⚠️ 必须**白名单**：不校验的话 ````python 手滑多打了个字` 会被当成合法围栏
 * （语言取第一个词照样是 python），而那本意是个错。
 */
const FENCE_FLAGS = new Set(['需要联网'])

/** 提取正文中所有围栏代码块（含 compare），返回剥离后的文本与代码块列表 */
function stripCodeBlocks(body) {
  const blocks = []
  const lines = body.split('\n')
  const out = []
  let inFence = false
  let fenceLang = ''
  let fenceBadFlag = ''
  let buf = []
  for (const line of lines) {
    /*
     * 信息串允许带标记：`python 需要联网`。
     * **第一个词是语言，后面的词是标记** —— 和渲染器（`src/renderer/src/lib/md.ts:140`）、
     * 闸门（`check-lesson-code.mjs`）用的是同一条规则。
     *
     * 【为什么这里必须跟着一起改，而不是让课文别写标记】
     * 原先这条正则是 `/^```(\S*)\s*$/` —— 要求围栏后面**除了空白什么都没有**。
     * 于是 ````python 需要联网` 这一行**根本不算围栏开头**：
     * 它的内容被当成正文，而后面那个收尾的 ``` 反倒被当成**一个新的围栏开头**，
     * 一路吃到下一个块的开头。报出来的错是「存在无语言标注的代码围栏」，
     * 指的是那个被错配出来的空语言块 —— **错误信息指向的位置和真正的原因差着十万八千里**。
     * 三处规则不一致就是这个下场，所以宁可三处一起改。
     */
    const open = line.match(/^```(\S*)(.*)$/)
    if (!inFence && open) {
      inFence = true
      fenceLang = open[1]
      fenceBadFlag = open[2].trim().split(/\s+/).filter(Boolean).find((f) => !FENCE_FLAGS.has(f)) ?? ''
      buf = []
      continue
    }
    if (inFence && line.trim() === '```') {
      inFence = false
      blocks.push({ lang: fenceLang, code: buf.join('\n'), badFlag: fenceBadFlag })
      out.push('```')
      continue
    }
    if (inFence) buf.push(line)
    else out.push(line)
  }
  if (inFence) blocks.push({ lang: fenceLang, code: buf.join('\n'), unclosed: true })
  return { text: out.join('\n'), blocks }
}

// ---------------------------------------------------------------- 数据加载

const glossary = readJson(path.join(CONTENT, 'glossary.json'))
const syllabus = readJson(path.join(CONTENT, 'syllabus.json'))

// 「什么算原术语泄漏」的唯一实现在 scripts/lib/terms.mjs（判据只能有一处）。
// 这里只是把它绑到本文件的 glossary 上 —— 名字照旧叫 countTerms，调用点一处没改。
// 同一条判据还被 scripts/check-bank.mjs 用在题库产物上（2026-09-16 补的缺口）。
const countTerms = createTermScanner(glossary)

// 反方向的同一张表：数**猫咪说法**。只给题目闸门用（见 checkQuestionTerminology）。
const countCatTerms = createCatScanner(glossary)

/**
 * 节课的题有**两个来源**，`content/challenge-bank/` 是第二个（打包时并进 Lesson.questions，
 * 见 docs/14）。这里只取每课题库的**题型清单**，给下面第 8 条判据用。
 *
 * 【为什么不在这里判题库的结构】
 * 结构、内容哈希、真跑验证全是 `scripts/check-bank.mjs` 的事 —— 判据只能有一处。
 * 所以这里读不动就当「没有」：那会让第 8 条**报红**（响的），而不是静默放行。
 * 题库文件真坏了的话，`npm run check:bank` 会给出比这里准确得多的诊断。
 */
const BANK_DIR = path.join(CONTENT, 'challenge-bank')
const bankOf = new Map() // lessonId -> { file, types: string[] }
if (fs.existsSync(BANK_DIR)) {
  for (const langDir of fs.readdirSync(BANK_DIR, { withFileTypes: true })) {
    if (!langDir.isDirectory()) continue
    const dir = path.join(BANK_DIR, langDir.name)
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue
      const file = path.join(dir, name)
      try {
        const j = readJson(file)
        if (typeof j.lessonId === 'string' && Array.isArray(j.items)) {
          bankOf.set(j.lessonId, {
            file: path.relative(ROOT, file),
            types: j.items.map((it) => it?.type)
          })
        }
      } catch {
        /* 见上：读不动 = 没有。后果是报红，不是放行 */
      }
    }
  }
}

const lessonIndex = new Map() // id -> syllabus lesson（已挂上模块层的 lang/stage）
const byLangStage = new Map() // lang:stage -> lessons[]
for (const mod of syllabus.modules) {
  for (const lesson of mod.lessons) {
    lessonIndex.set(lesson.id, { ...lesson, lang: mod.lang, stage: mod.stage })
  }
  byLangStage.set(`${mod.lang}:${mod.stage}`, mod.lessons)
}

/**
 * 缺省解锁规则：同阶段上一课；阶段首课=上一阶段末课；stage1 首课=common-01；
 * **再没有就是天然无前置**。
 *
 * ⚠️ 【这里原来有一句 `if (lesson.lang === 'common') return []`，2026-09-15 删掉】
 * 它把**整个 common 模块的前置一口气吞掉了**：凡是 frontmatter 没写 `required`
 * 的 common 课（01 和 05 就是）全都变成「无前置、开局就能点」，
 * 而大纲自己写的规则是「**lesson 未写 required 时**：同阶段上一课」—— 并没有把 common 排除在外。
 *
 * 它看起来像在防崩溃（common 的 stage 是 0，`stage - 1` 会去取 `common:-1`），
 * 但真正需要兜底的**只有模块第一课**这一种情况，一句 `prevStage ?? []` 就够。
 * 代价是它很安静：02/03/04 显式写了链子所以看不出问题，05 没写就悄悄变成自由课 ——
 * 学员可以在「什么是编程」之前先点开「条件判断」。
 *
 * 这条规则在本目录的 gen-batch / content-build 里**各有一份逐字相同的副本**，
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

// ---------------------------------------------------------------- 检查逻辑

const errors = [] // { lessonId, message }
const warnings = [] // { lessonId, message }
const coverage = { inSyllabus: 0, onDisk: 0 }

function err(lessonId, message) {
  errors.push({ lessonId, message })
}
function warn(lessonId, message) {
  warnings.push({ lessonId, message })
}

const ALL_LANGS = new Set(['common', 'c', 'cpp', 'java', 'python'])

/**
 * 一道代码填空题最多挖几个空。
 *
 * 空位一多，这题就从「填空」退化成「照着抄一遍」—— 学员的时间花在打字上，
 * 而不是花在理解这段代码上。所以上限卡在 6。
 */
const MAX_CODE_FILL_BLANKS = 6
const REQUIRED_FIELDS = ['id', 'lang', 'stage', 'order', 'title', 'tags', 'estMinutes', 'keywords']

function checkLesson(lessonId) {
  const syl = lessonIndex.get(lessonId)
  const dir = lessonDirOf(lessonId)
  coverage.onDisk++

  // ---- 1. 目录结构
  const mdFile = path.join(dir, 'lesson.md')
  const qFile = path.join(dir, 'questions.json')
  if (!fs.existsSync(mdFile)) return err(lessonId, '缺少 lesson.md')
  if (!fs.existsSync(qFile)) return err(lessonId, '缺少 questions.json')

  const { data, body, malformed } = parseFrontmatter(fs.readFileSync(mdFile, 'utf8'))
  if (malformed) return err(lessonId, 'frontmatter 未闭合（缺少结尾 ---）')
  if (!data) return err(lessonId, '缺少 YAML frontmatter')

  // ---- 2. frontmatter
  for (const f of REQUIRED_FIELDS) {
    if (data[f] === undefined || data[f] === '') return err(lessonId, `frontmatter 缺少必填字段 ${f}`)
  }
  if (!ALL_LANGS.has(data.lang)) return err(lessonId, `lang 非法：${data.lang}`)
  if (!Array.isArray(data.tags) || data.tags.length < 2) warn(lessonId, 'tags 建议 2-5 个')
  if (!Array.isArray(data.keywords)) return err(lessonId, 'keywords 必须是数组')
  if (!Number.isInteger(data.order)) return err(lessonId, 'order 必须是整数')
  if (data.id !== lessonId) return err(lessonId, `目录与 frontmatter id 不一致（目录=${lessonId}，frontmatter=${data.id}）`)
  if (syl && data.title !== syl.title) return err(lessonId, `标题与大纲不一致（大纲="${syl.title}"，实际="${data.title}"）`)
  if (syl && data.stage !== syl.stage) return err(lessonId, `stage 与大纲不一致（大纲=${syl.stage}，实际=${data.stage}）`)
  for (const ref of [...(data.required || []), ...(data.compare || []), ...(data.crossRefs || [])]) {
    if (!lessonIndex.has(ref)) return err(lessonId, `引用了不存在的前置/对比/关联课：${ref}`)
  }

  /*
   * 同一个 id 在同一份清单里写了两遍 —— 报错，不是警告。
   *
   * 【为什么这条必须有】`crossRefs` 是**逐条渲染**的（`RightPanel.vue` 的 `refs`，
   * 一个 id 一张卡片），所以写重一次，右栏就多出一行一模一样的卡片，
   * 而页面**不报错、不崩**，看着就像「这节课恰好在别处又讲了一遍」。
   * 2026-09-27 主人拿着一张这样的截图来报 bug。
   *
   * 【为什么那次其实不是重复，这条闸门却更该有】那次是**四门语言四节同名课**
   * （`c-stage1-07`/`cpp-stage1-07`/`java-stage1-07`/`python-stage1-08` 全叫
   * 「for 与 while——绕鱼干跑圈」），数据源里一个重复都没有。
   * 麻烦正在这里：**「真重复」和「同名不同课」在外观上一模一样**，
   * 光看页面永远分不清。所以「到底有没有重复」不能靠看上去像不像，
   * 得有一处能确凿回答它 —— 就是这里。外观那半边由 `RightPanel.vue`
   * 的语言徽章解决（让四节同名课分得开）。
   *
   * 【为什么逐条走而不是 `new Set(list).size !== list.length` 一句写完】
   * 那样只答得出「有重复」，答不出**是哪个 id 重了**，
   * 而读这条报错的人正要拿它去改课文。
   */
  for (const [field, list] of [
    ['required', data.required],
    ['compare', data.compare],
    ['crossRefs', data.crossRefs]
  ]) {
    if (!Array.isArray(list) || list.length < 2) continue
    const seen = new Set()
    for (const ref of list) {
      if (seen.has(ref))
        return err(
          lessonId,
          `${field} 里「${ref}」写了不止一次（右栏会多出一行一模一样的卡片，且不报错）`
        )
      seen.add(ref)
    }
  }

  /**
   * 【前置课「在大纲里」和「有正文」是两回事 —— 差在这一条上会静默锁死内容】
   *
   * 上面那个 `lessonIndex.has(ref)` 查的是**大纲全量 194 课**，所以答案几乎永远是「有」。
   * 但解锁要的是「前置**已学完**」，而没有正文的课**永远无法被标记已学** ——
   * 于是前置没生成的课会被永久锁住，界面上只显示「还锁着」，看不出真正的原因。
   *
   * 这里检查的是**实际参与解锁的那份 required**（`effectiveRequired` 的结果）——
   * 注意 `data.required` 是空的时它会是「同 stage 的上一节」，那条缺省规则
   * 以前**没有任何人检查过**，正好是这个 bug 的藏身处。
   *
   * 报 warn 不报 err：前置还没生成是**生成进度**问题，不是数据错误，
   * 打包器会把这一条过滤掉让课能进去（见 content-build.mjs）。但必须**看得见**。
   */
  for (const ref of effectiveRequired({ ...data, id: lessonId })) {
    if (!lessonIndex.has(ref)) {
      return err(lessonId, `前置课 ${ref} 不在大纲里`)
    }
    if (!lessonDirOf(ref)) {
      warn(lessonId, `前置课 ${ref} 尚无正文，解锁时会跳过它（补出内容后自动恢复）`)
    }
  }

  // ---- 3. 正文规则
  const { text, blocks } = stripCodeBlocks(body)
  const textLen = text.replace(/\s/g, '').length
  /*
   * 篇幅**不再是规范**（2026-09-15 主人拍板废除「500-1500 字」）。
   * docs/09 现在那句话是「篇幅服务于内容：绝不为了凑字数注水，也绝不为了压字数省略关键解释」。
   *
   * ⚠️ 留这个下限**不是篇幅建议，是防「生成被截断 / 返回空壳」**。
   * 它拦的是一次事故，不是一个风格：正常的课不可能低到 200 字以下
   * （一篇课至少要有钩子 + 讲解 + 对照块 + 小任务）。所以别拿它当"至少写这么多"的目标。
   *
   * 上限**故意不设**：1500 字的废话照样在线内，而删掉一段解释就能过线 ——
   * 上一版就是这么逼着 common-06 砍掉 400 多字的。篇幅是结果，不是目标。
   */
  if (textLen < 200) warn(lessonId, `正文只有 ${textLen} 字，疑似生成被截断（这不是篇幅建议，见 docs/09）`)
  /*
   * 判据是「正文里不许有**原始 HTML**」，不是「不许有尖括号」。两者的区别在 C++ 课上要命：
   * `vector<int> v;` 里的 `<int>` 和 `<div>` 长得一模一样，可它是**行内代码**——
   * markdown-it 在行内代码里本来就把尖括号当字面量渲染，正是想要的效果。
   *
   * 2026-09-16 修正：原先这条直接测 `text`，而 `stripCodeBlocks()` 只剥**围栏**、不剥**行内**反引号，
   * 于是 `content/cpp/stage3/01-stl-iterator` 那句 `` `vector<int> v;` `` 被判成「含原始 HTML」。
   * **整个 C++ 线凡是讲模板/STL 的课都躲不过这一条**，而它拦的根本不是 HTML。
   * 修法：测之前先把行内代码挖掉（不跨行、支持多反引号定界）。
   * **方向只会减少误判** —— 正文里真写 `<div>` 的照样红，没有任何一课会由绿转红。
   */
  const proseOnly = text.replace(/`{1,3}[^`\n]*`{1,3}/g, '')
  if (/<\/?[a-zA-Z][^>]*>/.test(proseOnly)) return err(lessonId, '正文含原始 HTML 标签（禁用）')
  for (const b of blocks) {
    if (!b.lang) return err(lessonId, '存在无语言标注的代码围栏')
    if (b.badFlag)
      return err(
        lessonId,
        `代码围栏上的标记不认识：「${b.badFlag}」（现在只认 ${[...FENCE_FLAGS].join(' / ')}）`
      )
    if (b.unclosed) return err(lessonId, '存在未闭合的代码围栏')
    if (b.lang === 'compare') checkCompareBlock(lessonId, b.code)
    /*
     * `demo` 围栏：信息串必须**正好**是 `demo`。
     *
     * 【为什么连 `demo stack` 这种也要报错】
     * 渲染器那边认的是「整串等于 demo」（理由见 `md.ts` 的 `isDemoFence`），
     * 所以 `` ```demo stack `` 会**落回普通代码块**、在正文里显示成一个
     * 语言名是 `demo` 的代码块。作者多半是想指定「用栈那种画法」——
     * 那件事现在还没做，但**不能让他以为做了**。这里报出来，他立刻知道要改名。
     */
    if (b.lang.startsWith('demo') && b.lang !== 'demo')
      return err(lessonId, `demo 围栏后面不能带词：「${b.lang}」（现在只认光秃秃的 \`demo\`）`)
    if (b.lang === 'demo') {
      const problems = checkDemoBlock(lessonId, b.code)
      if (problems.length) return err(lessonId, `demo 块不合法：\n      - ${problems.join('\n      - ')}`)
    }
  }

  // ---- 4. 题库 schema
  let questions
  try {
    questions = JSON.parse(fs.readFileSync(qFile, 'utf8'))
  } catch (e) {
    return err(lessonId, `questions.json 解析失败：${e.message}`)
  }
  if (questions.lessonId !== lessonId) return err(lessonId, `questions.json 的 lessonId 应为 ${lessonId}`)
  if (!Array.isArray(questions.questions) || questions.questions.length < 5 || questions.questions.length > 10) {
    return err(lessonId, `题目数须为 5-10，实际 ${questions.questions?.length}`)
  }
  const qids = new Set()
  for (const q of questions.questions) {
    if (!q || typeof q !== 'object') return err(lessonId, '存在非对象题目')
    if (qids.has(q.id)) return err(lessonId, `题目 id 重复：${q.id}`)
    qids.add(q.id)
    if (!q.stem?.trim() || !q.explanation?.trim()) return err(lessonId, `题目 ${q.id} 缺题干或解析`)
    // 显式难度（可选的覆盖字段）必须在值域内。写错一个字母（比如 'normal'）
    // 时，运行时解析会把这个值**原样**当成难度用 —— 难度筛选筛不到它、
    // 扩展规则认不出它，而界面上它只是一个"显示不出来的徽章"。宁可在门口拦。
    if ('difficulty' in q && !VALID_DIFFICULTIES.includes(q.difficulty)) {
      return err(lessonId, `题目 ${q.id} 的 difficulty 非法：${JSON.stringify(q.difficulty)}`)
    }
    if (q.type === 'choice') {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) return err(lessonId, `选择题 ${q.id} 选项数须为 2-6`)
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) return err(lessonId, `选择题 ${q.id} 答案下标非法`)
      // 选项不能是空白：长度合规但点进去是一排空按钮，学员只能瞎猜
      if (q.options.some((o) => typeof o !== 'string' || !o.trim())) return err(lessonId, `选择题 ${q.id} 有空选项`)
      // 【为什么这条必须查】两个一模一样的选项，答案下标指哪一个都说得通：
      // 学员点了另一个「同样对」的选项却被判错，而且他**永远查不出为什么** ——
      // 屏幕上两个选项长得一模一样。这正是「答案唯一、逻辑无歧义」要拦住的东西。
      // 比的是去空白后的原文（不做大小写/全角归一 —— 那种差异在判分里也不相等，不算歧义）。
      const seen = new Set()
      for (const o of q.options) {
        const k = o.trim()
        if (seen.has(k)) return err(lessonId, `选择题 ${q.id} 有重复选项：${k}`)
        seen.add(k)
      }
    } else if (q.type === 'fill') {
      // 注意是 trim 后判空：`"   "` 能骗过 `!== ''`，但那是个学员永远答不对的空题
      if (typeof q.answer !== 'string' || !q.answer.trim()) return err(lessonId, `填空题 ${q.id} 答案必须是非空字符串`)
    } else if (q.type === 'code') {
      if (!ALL_LANGS.has(q.lang) || q.lang === 'common') return err(lessonId, `代码阅读题 ${q.id} lang 非法`)
      if (typeof q.code !== 'string' || !q.code.trim()) return err(lessonId, `代码阅读题 ${q.id} 缺代码`)
      if (typeof q.answer !== 'string' || !q.answer.trim()) return err(lessonId, `代码阅读题 ${q.id} 答案必须是非空字符串`)
    } else if (q.type === 'codefill') {
      if (!ALL_LANGS.has(q.lang) || q.lang === 'common') return err(lessonId, `代码填空题 ${q.id} lang 非法`)
      if (typeof q.code !== 'string' || !q.code.trim()) return err(lessonId, `代码填空题 ${q.id} 缺代码`)
      if (!Array.isArray(q.blanks)) return err(lessonId, `代码填空题 ${q.id} 的 blanks 必须是数组`)

      /*
       * 【最要紧的一条：代码里的空位个数必须等于 blanks.length】
       *
       * 这两个数字对不上时，程序**不会崩**，它会安静地错：
       *   - 空位多了 → 多出来的那个空没有答案，学员填什么都判错
       *   - 空位少了 → 多出来的答案没人填，那道题**永远答不对**
       * 而且界面上看不出任何异常（题面照常显示、输入框照常出现），
       * 学员只会觉得"这题我明明填对了"。
       *
       * 正则**照抄 `src/shared/codefill.ts` 的 CODE_FILL_MARKER**（连续 4 个及以上的
       * 下划线），不是另立一套 —— 两处漂了的话，渲染会一个空都换不出来（代码原样
       * 显示 `____`），而这里照样放行。有一条单测读本文件的源码文本钉住这份抄写。
       */
      const blanksInCode = (q.code.match(/_{4,}/g) || []).length
      if (blanksInCode !== q.blanks.length) {
        return err(
          lessonId,
          `代码填空题 ${q.id} 的空位对不上：代码里有 ${blanksInCode} 个 ____，blanks 有 ${q.blanks.length} 个`
        )
      }
      if (q.blanks.length < 1 || q.blanks.length > MAX_CODE_FILL_BLANKS) {
        // 上限不是洁癖：空位一多，这题就从"填空"变成"照着抄一遍"，
        // 学员的时间花在打字上而不是理解上。
        return err(lessonId, `代码填空题 ${q.id} 的空位数须为 1-${MAX_CODE_FILL_BLANKS}，实际 ${q.blanks.length}`)
      }
      for (let bi = 0; bi < q.blanks.length; bi++) {
        const b = q.blanks[bi]
        if (!b || typeof b !== 'object') return err(lessonId, `代码填空题 ${q.id} 的第 ${bi + 1} 个空不是对象`)
        if (typeof b.answer !== 'string' || !b.answer.trim()) {
          return err(lessonId, `代码填空题 ${q.id} 的第 ${bi + 1} 个空答案必须是非空字符串`)
        }
        /*
         * ⚠️ 空位答案**不能含换行**：各个空在作答会话里是按 `\n` 拼成一串存的
         * （为什么这么存见 shared/codefill.ts）。答案里带一个换行，这个空之后的
         * **所有空都会整体错位一格** —— 学员每个空都填对了，判分却说他错，
         * 而盯着他自己的输入是绝对看不出问题的。
         */
        if (/[\r\n]/.test(b.answer)) {
          return err(lessonId, `代码填空题 ${q.id} 的第 ${bi + 1} 个空答案含换行（会把后面的空挤错位）`)
        }
        if (b.accept !== undefined && (!Array.isArray(b.accept) || b.accept.some((a) => typeof a !== 'string'))) {
          return err(lessonId, `代码填空题 ${q.id} 的第 ${bi + 1} 个空的 accept 必须是字符串数组`)
        }
        // 等价答案同样不能含换行 —— 它跟 answer 走同一条比对路径
        if (Array.isArray(b.accept) && b.accept.some((a) => /[\r\n]/.test(a))) {
          return err(lessonId, `代码填空题 ${q.id} 的第 ${bi + 1} 个空的 accept 含换行`)
        }
      }
    } else if (q.type === 'codefix' || q.type === 'codewrite') {
      /*
       * ── 真跑题型（`codefix` / `codewrite`）──
       *
       * 【这个分支**故意只查结构**，不查"参考解跑得对不对"】
       * 「`expectedOutput` 是不是真的和参考解的输出一致」这一条，只有**真跑**才知道，
       * 而校验器是跑在裸 node 上的零依赖脚本，**不该在这里编译代码** ——
       * 它的定位是"三秒能跑完、每批内容都愿意跑一遍"的闸门。真跑那件事在
       * `npm run check:questions`（scripts/check-question-code.mjs）。
       *
       * 两处的分工要记清楚，否则会出现这种最坏的情况：
       * 有人觉得"校验器没查参考解，那我随手写个 expectedOutput 也能过闸门" ——
       * 是的，能过**这一道**，但过不了下一道。**两条闸门都要跑，少一条就等于没跑。**
       *
       * 【这里查的四条，每一条都对应一种"不会报错"的坏法】
       *   ① 缺参考解 → `expectedOutput` 变成**没人能验证的断言**，永久失去防线
       *   ② `expectedOutput` 是空的 → 见下面那条长注释，是**把代码删光就能过**的洞
       *   ③ `referenceFix` 和 `brokenCode` 一模一样 → 学员打开就看到"已改好"的代码
       *   ④ 两个类型互相串了字段 → 生成时把"给错代码"和"给任务"写混了，
       *      而这种混法在界面上**看不出任何异常**（照样渲染、照样能提交）
       */
      if (!ALL_LANGS.has(q.lang) || q.lang === 'common') {
        return err(lessonId, `${q.type} 题 ${q.id} 的 lang 非法：真跑题型只属于语言课`)
      }
      if (typeof q.expectedOutput !== 'string') {
        return err(lessonId, `${q.type} 题 ${q.id} 缺 expectedOutput`)
      }
      /*
       * ⚠️ `expectedOutput` **不能是空的**。这条看着像洁癖，其实是最要紧的一条。
       *
       * 判分是「跑出来的输出 == expectedOutput」。空串的话，**什么都不打印的程序就合格** ——
       * 而「什么都不打印」正好是**学员把代码删光**的结果。判分铁律里那句
       * 「绝不能只判『不报错』，学员把代码删光就不报错了」说的就是这个洞，
       * 空 `expectedOutput` 等于把它重新打开一次。
       *
       * 而且它开得**不均匀**：C / C++ 删光了没有 main，链接就失败；Python 删光了照跑，
       * 输出空串、判过。于是同一道题在四门语言里"能不能空手套白狼"不一样，
       * 而这件事**没有任何界面能看出来**。
       */
      if (!q.expectedOutput.trim()) {
        return err(lessonId, `${q.type} 题 ${q.id} 的 expectedOutput 是空的（删光代码也能"过"，等于没判分）`)
      }
      if (q.type === 'codefix') {
        if (typeof q.brokenCode !== 'string' || !q.brokenCode.trim()) {
          return err(lessonId, `代码改错题 ${q.id} 缺 brokenCode（没给要改的代码就不叫改错题）`)
        }
        if (typeof q.referenceFix !== 'string' || !q.referenceFix.trim()) {
          return err(lessonId, `代码改错题 ${q.id} 缺 referenceFix（没有它，expectedOutput 就成了没人能验证的断言）`)
        }
        // 一字不差 = 没有错可改。学员打开题目，看到的就是参考解本身。
        if (q.referenceFix.trim() === q.brokenCode.trim()) {
          return err(lessonId, `代码改错题 ${q.id} 的 referenceFix 和 brokenCode 一模一样（那它没坏）`)
        }
        if (q.starter !== undefined) {
          return err(lessonId, `代码改错题 ${q.id} 多了 starter —— 那是 codewrite 的字段，两个题型写混了`)
        }
        if (q.referenceSolution !== undefined) {
          return err(lessonId, `代码改错题 ${q.id} 多了 referenceSolution —— 那是 codewrite 的字段，两个题型写混了`)
        }
      } else {
        if (typeof q.referenceSolution !== 'string' || !q.referenceSolution.trim()) {
          return err(lessonId, `写代码大题 ${q.id} 缺 referenceSolution（没有它，expectedOutput 就成了没人能验证的断言）`)
        }
        if (q.starter !== undefined && typeof q.starter !== 'string') {
          return err(lessonId, `写代码大题 ${q.id} 的 starter 必须是字符串`)
        }
        if (q.brokenCode !== undefined) {
          return err(lessonId, `写代码大题 ${q.id} 多了 brokenCode —— 那是 codefix 的字段，两个题型写混了`)
        }
        if (q.referenceFix !== undefined) {
          return err(lessonId, `写代码大题 ${q.id} 多了 referenceFix —— 那是 codefix 的字段，两个题型写混了`)
        }
      }
    } else {
      return err(lessonId, `题目 ${q.id} 题型非法：${q.type}`)
    }
    if (q.accept !== undefined && (!Array.isArray(q.accept) || q.accept.some((a) => typeof a !== 'string'))) {
      return err(lessonId, `题目 ${q.id} 的 accept 必须是字符串数组`)
    }
    // 真跑题型可以带输入（`RunRequest.stdin`）。类型错了的话它会原样传进子进程 ——
    // `child.stdin.write(123)` 会当场抛，而那发生在**学员点提交的时候**。
    if (q.stdin !== undefined && typeof q.stdin !== 'string') {
      return err(lessonId, `题目 ${q.id} 的 stdin 必须是字符串`)
    }
  }

  // ---- 5. 术语扫描（代码块除外）
  checkTerminology(lessonId, text)
  checkQuestionTerminology(lessonId, questions)

  // ---- 6. 题不外问（docs/09「篇幅服务于内容」那条唯一可验证的形状）
  checkQuestionCoverage(lessonId, questions, body)

  // ---- 7. 题目代码里的字符串字面量有没有跨行
  checkUnterminatedLiterals(lessonId, questions)

  // ---- 7.5 用了 <stdexcept> 的类型却没 include（2026-09-28 加，见上面那段注释）
  checkStdexceptInclude(lessonId, questions, blocks)

  /*
   * ---- 8. 节课题型下限：语言课的 `codefix` / `codewrite` 至少各 1 题
   *
   * 【为什么必须在这里，而不在题库自己的闸门里】
   * docs/09:117-121 那句「至少 1 题」是对**节课最终**说的，而节课的题来自两处：
   * 手写 `questions.json`（choice / codefill / code）和题库（codefix / codewrite）。
   * 只扫其中一处，整整一级练习消失的时候**界面完全正常** —— 课照上、题照答，
   * 没有任何地方会红。2026-09-16 补这条判据时，真实数据里正有 4 节课踩在上面：
   * 3 节语言课压根没有题库，1 节的题库 9 道全是 codefix、一道 codewrite 都没有。
   *
   * 【为什么是 err 不是 warn】
   * 它不是「进度还没到」（那是上面解锁链那条 warn 的语义），而是**已经交付的课
   * 缺了规范里写死的题型**。前置课没写可以等，这条不能等。
   *
   * 【为什么只查语言课】
   * 通用知识课是概念课，docs/09:115 明说本模块用不上这两个题型。
   */
  if (data.lang !== 'common') {
    const bank = bankOf.get(lessonId)
    const 题型 = [...(bank?.types ?? []), ...questions.questions.map((q) => q.type)]
    for (const want of ['codefix', 'codewrite']) {
      if (题型.includes(want)) continue
      const 来处 = bank
        ? `题库里 0 道（${bank.file} 共 ${bank.types.length} 道）`
        : '整份题库都不存在'
      err(
        lessonId,
        `语言课的节课下限要求 ${want} 至少 1 题（docs/09），实际 0 题 —— ${来处}；` +
          `补法：在 scripts/bank/templates/ 写一份 ${want} 模板，再跑 node scripts/gen-bank.mjs --force`
      )
    }
  }
}

/**
 * 题目代码里**字符串字面量不许跨行**。
 *
 * 【为什么要有这一条】
 * JSON 里想表达 C 的 `printf("%d\n", x)`，必须写 `\\n`（两个反斜杠）——
 * 写成一个 `\n` 会被 JSON 解成**真换行**，于是学员屏幕上看到的是
 *     printf("%d
 *     ", cur->x);
 * 这在 C 里是编译错误（字符串字面量不许跨行）。**而没有任何闸门会抓它**：
 * `check:samples` 只跑 `lesson.md` 里的代码块、不看 `questions.json`，
 * 本文件此前只查字段形状。`content/c/stage3/03-linked-list/questions.json`
 * 的 q8 就这么在盘上躺了很久。
 *
 * 【判据】这一行里**未被转义的引号是奇数个** —— 也就是"字面量没在本行闭合"。
 * ⚠️ 别写成 `/"[^"\n]*\n/`（引号→非引号→换行）：那会匹配到**正常收尾**的引号
 * 后面的 `)` 和换行，`print("1")` 这种每一行都被报出来。
 *
 * 【为什么按语言分岔】
 * C / C++ / Java 里字符串字面量**不可能**跨行（`\` 续行是特例，本项目的
 * 示例不用它），奇数引号必然是真换行。Python 不一样 —— `"""..."""`
 * 跨行是**合法且常见**的写法，硬查会把它全报成错。所以只查前三门。
 * （`common` 是通用课，代码块常是零散片段，也不查。）
 */
const MULTILINE_LITERAL_LANGS = new Set(['c', 'cpp', 'java'])

function checkUnterminatedLiterals(lessonId, questions) {
  for (const q of questions.questions) {
    if (!MULTILINE_LITERAL_LANGS.has(q.lang)) continue
    for (const key of ['code', 'brokenCode', 'starter', 'referenceFix', 'referenceSolution']) {
      const code = q[key]
      if (typeof code !== 'string') continue
      const bad = []
      code.split('\n').forEach((line, i) => {
        // 去掉转义引号 \" 和 \\ 再数
        const stripped = line.replace(/\\\\/g, '').replace(/\\"/g, '')
        if ((stripped.match(/"/g) || []).length % 2 === 1) bad.push(i + 1)
      })
      if (bad.length) {
        warn(
          lessonId,
          `题目 ${q.id} 的 ${key} 第 ${bad.join('、')} 行的字符串字面量没闭合 —— ` +
            'JSON 里想写 `\\n` 得用两个反斜杠，写成一个会被解成真换行，学员看到的是编译不过的代码'
        )
      }
    }
  }
}

/*
 * 用了 <stdexcept> 里的异常类型，却没 `#include <stdexcept>` —— 2026-09-28 加。
 * 判据与理由全在 `lib/cpp-includes.mjs`（`check-bank.mjs` 引的是同一份 ——
 * 题库不走本文件，只加这一边等于题库那 12 处没人看）。
 */
function checkStdexceptInclude(lessonId, questions, blocks) {
  for (const q of questions.questions) {
    // 只查会真被编译的 C++ 题：选择题的选项不编译，代码片段判分时另有 prelude
    if (q.lang !== 'cpp') continue
    for (const key of ['code', 'brokenCode', 'starter', 'referenceFix', 'referenceSolution']) {
      const 类型名 = missingStdexceptType(q[key])
      if (类型名) return err(lessonId, stdexceptMessage(类型名, `题目 ${q.id} 的 ${key}`))
    }
  }

  for (const b of blocks ?? []) {
    if (b.lang !== 'cpp' && b.lang !== 'c++') continue
    const 类型名 = missingStdexceptType(b.code)
    if (类型名) {
      return err(
        lessonId,
        stdexceptMessage(类型名, `课文里那个以「${b.code.split('\n')[0].trim().slice(0, 30)}」开头的 C++ 代码块`)
      )
    }
  }
}

/** 反引号里的 token（`` `x` `` / ```x``` 把多反引号也吃进来） */
function backticked(s) {
  if (typeof s !== 'string') return []
  return [...s.matchAll(/`+([^`]+)`+/g)].map((m) => m[1].trim()).filter(Boolean)
}

/**
 * 把 token 拆成**必须在正文里出现**的片段。规则见 `_q-coverage.mjs` 的同名函数，
 * 两处是同一份逻辑（那边是给人看的实测台）。要点：
 *  - 挖空题的题干（`for i in range(____):`）**整条**是找不到的，得按 `____` 切开
 *  - 首尾标点不算要认的东西（`3:` 的冒号）
 *  - 纯数字跳过 —— 那是输出值，不是概念
 */
function tokenFragments(token) {
  return token
    .split(/_{2,}/)
    .map((f) => f.trim().replace(/^[\s;:,]+/, '').replace(/[\s;:,]+$/, ''))
    .filter((f) => f.length >= 2 && !/^[\d.\s]+$/.test(f))
}

/**
 * 【空白不敏感的「出现过」】把片段当成一段**空白灵活**的模式去正文里找。
 *
 * 起因（2026-09-16，与「正文 HTML 检查误伤行内代码」是同一个病根）：
 * 判据只盯着**文字长什么样**，没看**这段文字是不是同一段代码**。
 *
 * `cpp-stage3-01` q3 的题干里有 `for (int x : v) { x = x * 2; }`，而课文第 226 行写的
 * 恰恰就是这段代码 —— 只是分成了三行：
 *
 *     for (int x : v) {
 *         x = x * 2;
 *     }
 *
 * 逐字比对说「正文里没出现」，可学员明明看的就是它。**换行不是知识点。**
 * 更坏的是它会把写手往错误方向推：为了消掉这条警告，把代码挤成一行写进散文里 ——
 * 那是在**为了判据牺牲课文**。
 *
 * 所以：片段里的空白串换成 `\s+` 再去匹配（片段先转义，`*` `()` `[]` 这些都在代码里）。
 * 这是个**只增不减**的放宽 —— 原先能匹配的照样匹配（两边空白本来就一致时 `\s+` 命中），
 * 新增的只有「同一段代码、换了个折行」这一类。真查不出的漏法它照样查不出，
 * 但它不再冤枉写对的课文。
 */
function appearsIn(body, fragment) {
  const pattern = fragment
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+')
  return new RegExp(pattern).test(body)
}

/**
 * 【题不外问】题目要学员认的每个代码 token，正文里都得出现过。
 *
 * 主人 2026-09-15 定的规矩：「篇幅服务于内容，绝不为了压字数省略关键解释」。
 * 「讲透了没有」没法自动判，但它的一个形状可以 —— **题目问的东西正文里有没有**。
 * 一道题要学员认得 `range`，正文却从头到尾没出现过 `range`，那就是缺概念，
 * 不管正文写得多长。
 *
 * 只查**题干 + 答案**（这道题必须考的东西）。选项里会**故意**出现没讲过的说法
 * （干扰项就是这么设计的），拿它报警只会淹掉真问题。
 *
 * ⚠️ 报的是**警告不是错误**：这是启发式，不是判据。它拦的那种漏法很实在
 * （common-01 原先就漏了 `print` 的写法，而 q6/q7 都在考它），
 * 但它认不出「讲得够不够浅」——那还得人读。
 */
function checkQuestionCoverage(lessonId, questions, body) {
  for (const q of questions.questions) {
    // codefill 的答案住在 `blanks[].answer`，**不在 `q.answer`**
    const answers = [
      q.answer,
      ...(q.blanks || []).map((b) => b.answer),
      ...(q.blanks || []).flatMap((b) => b.accept || [])
    ]
    for (const token of [...backticked(q.stem), ...answers.flatMap(backticked)]) {
      const missing = tokenFragments(token).filter((f) => !appearsIn(body, f))
      if (missing.length) {
        warn(
          lessonId,
          `题不外问：${q.id} 要学员认得 \`${token}\`，正文里却没出现 ${missing.map((m) => `\`${m}\``).join('、')}`
        )
      }
    }
  }
}

function checkCompareBlock(lessonId, code) {
  const sections = code.split(/^(\w+)::\s*$/m)
  const langs = []
  for (let i = 1; i < sections.length; i += 2) {
    const lang = sections[i]
    const bodyText = sections[i + 1].trim()
    if (!['c', 'cpp', 'java', 'python'].includes(lang)) return err(lessonId, `compare 块语言非法：${lang}`)
    if (!bodyText) return err(lessonId, `compare 块 ${lang} 段为空`)
    langs.push(lang)
  }
  if (langs.length < 2) return err(lessonId, 'compare 块至少需要两种语言')
  if (new Set(langs).size !== langs.length) return err(lessonId, `compare 块语言重复：${langs.join(',')}`)
}

/**
 * `demo` 块里 `pose:` 允许写的姿态。
 *
 * 【为什么不在这份脚本里手抄一份姿态名】
 * 抄一份 = 同一件事有了两个真源。`mascot.ts` 里加一个姿态、这里忘了加，
 * 表现是「作者写了个新姿态、闸门说它非法」，而**真正的错在闸门** —— 报错指向了无辜的人。
 * 抄一份还会反向出错：这里多留了一个已经删掉的姿态，闸门放行，
 * 而 `MiMascot` 找不到图、**静默**降级成虚线占位框。
 *
 * 【为什么解析失败要当场退出，而不是记一条错】
 * 读不出姿态表时，「所有 pose: 都非法」和「一个都没查」在**输出上长得不一样，
 * 在结论上却一样不可信**。更糟的是：万一哪天课文里一条 `pose:` 都没有，
 * 空白名单会**一路绿灯** —— 闸门在那儿，却什么也没验。
 * 这正是第一铁律说的那种「把没验过伪装成验过了」。所以这里直接让整道闸门失败，
 * 并且说清楚**这是校验器自己的问题，不是课文的问题**。
 */
const MASCOT_POSES = (() => {
  const file = path.join(ROOT, 'src/renderer/src/lib/mascot.ts')
  let src
  try {
    src = fs.readFileSync(file, 'utf8')
  } catch (e) {
    console.error(
      `\n✗ 校验器读不到姿态表：${file}\n  ${e.message}\n\n` +
        `  这是**校验器坏了**，不是课文有问题。\n` +
        `  demo 块的 \`pose:\` 白名单要求从 \`MASCOT_POSES\` 现场解析，读不到就没法验。\n` +
        `  修好路径或文件再跑；**不要**改成「跳过这一条检查」。\n`
    )
    process.exit(1)
  }
  const m = src.match(/MASCOT_POSES\s*=\s*\[([^\]]*)\]/)
  const poses = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : []
  if (!poses.length) {
    console.error(
      `\n✗ 校验器解析不出姿态表：${file}\n` +
        `  找的是 \`MASCOT_POSES = ['welcome', ...]\` 这一行，没找到或里面是空的。\n\n` +
        `  这是**校验器坏了**，不是课文有问题。姿态表的写法变了就要同步改这里的解析，\n` +
        `  **不要**改成「跳过这一条检查」—— 那等于让 \`pose:\` 再也没有人验。\n`
    )
    process.exit(1)
  }
  return new Set(poses)
})()

/** `demo` 块里不许当变量名的词 —— 它们都是结构关键字，撞了就没有第二种解释 */
const DEMO_RESERVED = new Set(['title', 'code', 'step', 'at', 'say', 'meow', 'pose'])

/**
 * 气泡那句话的长度上限。
 *
 * 【为什么要有个数，而不是「作者爱写多长写多长」】
 * 气泡是**配菜**：它在代码旁边占一条窄边，和 48px 的立绘并排。
 * 写到三四十字就会折成四五行，把演示块顶高一大截 ——
 * 那时它不再「可爱」，而是每一步都把主内容（代码 + 讲解）往下推一次。
 * 40 字是这个宽度下**大概两行**的量，够写「喵！叼回来一条小鱼干！」这种句子，
 * 不够写一段讲课。想讲道理请写 `say:`。
 */
const DEMO_MEOW_MAX = 40

/**
 * `demo` 演示块的结构校验（2026-09-19 新增）。
 *
 * 【为什么这条规则非有不可】
 * `scripts/check-lesson-code.mjs:503` 对**不认识的围栏语言是静默 `continue`** 的，
 * 所以 ```` ```demo ```` 不会被任何一道闸门验到。而演示块里写错一个数字，
 * 表现是「播放器上高亮行停在第 7 行、可代码只有 4 行」——
 * 界面上**不报错、不崩**，只是那一帧指着一个不存在的地方，学员看不出来。
 * 第一铁律：**静默跳过 = 把「没验过」伪装成「验过了」**。这条就是来堵这个洞的。
 *
 * 【⚠️ 这里是 `src/renderer/src/lib/md.ts` 里 `parseDemo` 的**第二份副本**】
 * 渲染器那份在 TS 里，闸门这份在 MJS 里，跨不过去（`scripts/` 下所有脚本都不 import
 * `src/`）。本仓库对这种重复的既定做法是「逐字相同的副本 + 注释说明有几份」
 * （见 `effectiveRequired` 上面的那段）。**改一处必须两处一起改。**
 * 两份的**分工不同**，这是有意的：
 *   · `parseDemo`：能认多少认多少，**永不抛异常** —— 正文里一行坏数据不该让整页白屏。
 *   · 这个函数：**一行不合规都不放过**，而且报出**行号**，因为它的读者是在改课文的人。
 * 所以「渲染器没报错」**不等于**「这个块是合法的」，只有这里全绿才算。
 *
 * 格式（和 `parseDemo` 的文档注释必须一致）：
 * ```
 * title: 循环的执行顺序      ← 可选、只能出现一次、必须在 code: 之前
 * code:                      ← 必须有、只能出现一次
 * | total = 0                ← `|` 起头，后面原样是代码
 *
 * step 第 1 轮 · 判断         ← 至少两步，标签不能为空
 * at: 2                      ← 必须有、唯一、1..代码行数
 * say: 0 < 3 成立            ← 必须有、唯一、不能为空
 * meow: 喵！叼回来一条！       ← 可选。要么每步都写，要么整块不写
 * pose: yay                  ← 可选。取值必须是 MASCOT_POSES 里的真姿态
 * i = 0                      ← 变量，可以 0 个或多个；同一名字一步里只能出现一次
 * ```
 */
function checkDemoBlock(lessonId, code) {
  const problems = []
  const lines = code.split('\n')
  /** 报错一律带行号（行号是**围栏内部**的，从 1 起）——改课文的人靠它定位 */
  const bad = (i, msg) => problems.push(`第 ${i + 1} 行：${msg}`)

  let inCode = false
  let seenCode = false
  let seenTitle = false
  let codeLines = 0
  const steps = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd()

    if (inCode) {
      if (line.startsWith('|')) {
        codeLines++
        continue
      }
      inCode = false
    }

    const t = line.trim()
    if (!t) continue

    if (t.startsWith('title:')) {
      if (seenCode) bad(i, 'title: 必须写在 code: 之前（现在写在了代码后面）')
      if (seenTitle) bad(i, 'title: 只能出现一次')
      if (!t.slice('title:'.length).trim()) bad(i, 'title: 后面是空的')
      seenTitle = true
      continue
    }

    if (t === 'code:') {
      if (seenCode) bad(i, 'code: 只能出现一次')
      seenCode = true
      inCode = true
      continue
    }

    if (t === 'step' || t.startsWith('step ')) {
      const label = t.slice('step'.length).trim()
      if (!label) bad(i, 'step 后面要写这一步叫什么（例如 `step 第 1 轮 · 判断`）')
      steps.push({ line: i, label, at: null, say: null, meow: null, pose: null, vars: new Map() })
      continue
    }

    const cur = steps[steps.length - 1]
    if (!cur) {
      bad(i, `这一段不在任何 step 里：${t.slice(0, 24)}（变量和 at/say 都要写在某个 step 下面）`)
      continue
    }

    const reserved = t.match(/^(at|say|meow|pose)\s*:\s*(.*)$/)
    if (reserved) {
      const key = reserved[1]
      const value = reserved[2].trim()
      if (cur[key] !== null) bad(i, `${key}: 在同一个 step 里只能写一次（写两遍时前一个会被无声丢掉）`)
      if (key === 'pose') {
        /*
         * 写错姿态名**不会报错、不会崩**：`MiMascot` 找不到那张图，
         * 会安安静静降级成一个虚线占位框 —— 作者以为自己在换姿势，
         * 屏幕上是「立绘没了」。所以这里必须逐个对白名单。
         * 白名单是**从 mascot.ts 现场解析**出来的，理由见上面 MASCOT_POSES 的注释。
         */
        if (!value) bad(i, 'pose: 后面是空的（不想换姿势就整行删掉）')
        else if (!MASCOT_POSES.has(value))
          bad(
            i,
            `没有「${value}」这个姿态。能写的是：${[...MASCOT_POSES].join('、')}` +
              `（写成不存在的名字，立绘会静默变成一个虚线占位框）`
          )
        cur.pose = value || ''
      } else if (key === 'meow') {
        /*
         * `meow:` 写成空的，和**根本不写**是两件事，必须分开报。
         * 不写 = 整块都没有气泡（合法的）；写了但空着 = 作者本来想写，
         * 手滑删了字 —— 那时前端的判据 `steps.some(s => s.meow)` 会
         * 把整块气泡**悄悄关掉**，作者却以为自己在调整气泡文案。
         * 这正是本项目最忌讳的那种「坏掉但没人告诉你」。
         */
        if (!value) bad(i, 'meow: 后面是空的（不想写气泡就整行删掉，别留个空壳）')
        else if (value.length > DEMO_MEOW_MAX)
          bad(i, `meow 有 ${value.length} 个字，超过 ${DEMO_MEOW_MAX} 字（气泡是配菜，讲课请写 say:）`)
        cur.meow = value || ''
      } else if (key === 'say') {
        if (!value) bad(i, 'say: 后面是空的 —— 每一步都要有一句讲解，演示的意义全在这句话里')
        cur.say = value
      } else {
        /*
         * 写坏了就置 `NaN`，**不是留 `null`**。
         * 留 null 的话下面「缺少 at:」还会再报一次，同一行变成两条错；
         * NaN 和任何数比较都是 false，范围检查自然闭嘴 —— 只报「不是正整数」这一条。
         */
        if (!/^\d+$/.test(value)) {
          bad(i, `at 必须是正整数，现在写的是「${value}」`)
          cur.at = NaN
        } else cur.at = Number(value)
      }
      continue
    }

    const v = t.match(/^([^:=]+?)\s*=\s*(.*)$/)
    if (v) {
      const name = v[1].trim()
      const value = v[2].trim()
      if (DEMO_RESERVED.has(name))
        bad(i, `「${name}」是结构关键字，不能当变量名（要写高亮行请写 \`at: 数字\`）`)
      if (!value) bad(i, `变量「${name}」没有值`)
      if (cur.vars.has(name)) bad(i, `变量「${name}」在同一个 step 里出现了两次`)
      cur.vars.set(name, value)
      continue
    }

    bad(i, `这一行看不懂：${t.slice(0, 24)}（结构用 \`at:\` / \`say:\`，变量用 \`名字 = 值\`）`)
  }

  if (!seenCode) problems.push('缺少 `code:` 块')
  else if (codeLines === 0) problems.push('`code:` 下面一行代码都没有（每一行都要用 `|` 起头）')
  if (steps.length < 2) problems.push(`至少要有 2 步，现在只有 ${steps.length} 步（一步的「演示」是一张静态图加一排用不上的按钮）`)

  for (const s of steps) {
    const where = `step「${s.label || '(没有名字)'}」`
    if (s.at === null) problems.push(`${where} 缺少 \`at:\`（高亮第几行）`)
    else if (seenCode && (s.at < 1 || s.at > codeLines))
      problems.push(`${where} 的 at 是 ${s.at}，但代码一共只有 ${codeLines} 行`)
    if (s.say === null) problems.push(`${where} 缺少 \`say:\`（这一步在讲什么）`)
  }

  /*
   * 气泡**要么每一步都有，要么整块都没有**。
   *
   * 【为什么这不是洁癖，是功能会坏】
   * 前端的判据是「这一步有 meow 就显示气泡」。要是 8 步里只有 3 步写了，
   * 走到第 4 步气泡会**整条消失**，第 5 步又冒出来 ——
   * 立绘和气泡那一行的存在与否，直接改变下面所有内容的位置，
   * 于是**播放过程中每遇到一个没写气泡的步骤，整块演示就会跳一下**。
   * 那是「按了下一步，页面自己往上蹦了一截」，比没有气泡难看得多。
   *
   * 所以这条不是要求作者勤奋，是要求**要么全有、要么全无**这一件事本身成立。
   */
  const 有气泡 = steps.filter((s) => s.meow !== null && s.meow !== '')
  if (有气泡.length && 有气泡.length < steps.length) {
    const 缺 = steps.filter((s) => !s.meow).map((s) => `「${s.label || '(没有名字)'}」`)
    problems.push(
      `气泡要么每一步都写 \`meow:\`，要么整块都不写 —— 现在 ${有气泡.length}/${steps.length} 步有` +
        `，缺的是 ${缺.join('、')}（缺了会在播放时整块跳动）`
    )
  }

  return problems
}

/**
 * 正文的术语闸门。
 *
 * 【哪些地方不扫，以及为什么（2026-09-14 实测后写死，别再改了）】
 *   · **课文的 frontmatter 标题**：正文进来之前 frontmatter 已经被摘掉了。
 *   · **syllabus 的 title / outline**：这两处**本来就该出现原术语**。
 *     docs/04 §7 的说明写得很清楚：大纲标题是「主人在评审大纲时已经定下的用词」，
 *     写法有固定形状 —— 先是猫咪说法，破折号后点名原术语：
 *       「小鱼干仓库——变量与数据类型」「绕鱼干跑圈——循环的本质」「投喂与叼回——输入与输出」
 *
 *   ⚠️ 拿扫描器量这两处会得到 **272 处「违例」，但那不是问题**。
 *   谁要是照着这个数去「修」大纲标题，就会把主人已经认可、且学员第一次见到的用词改掉 ——
 *   那是**改坏**，不是修好。这条注释就是为了拦住这件事。
 *
 *   真正该扫的三处（都已设闸）：课文正文、错误库文案、以及题目的**答案侧**
 *   （后者走反方向的 countCatTerms，见 checkQuestionTerminology）。
 */
function checkTerminology(lessonId, text) {
  const { counts, total } = countTerms(text)
  if (total > MAX_TERM_WARNINGS) {
    return err(
      lessonId,
      `术语违例 ${total} 处（阈值 ${MAX_TERM_WARNINGS}）：${counts.map((c) => `「${c.term}」×${c.found}（应用：${c.cat}）`).join('、')}`
    )
  }
  if (total > 0) warn(lessonId, `术语注意 ${total} 处：${counts.map((c) => `「${c.term}」×${c.found}`).join('、')}`)
}

/**
 * 题库文案的术语闸门。
 *
 * 【2026-09-20 换向：从「题干/解析禁原术语」翻成「选项/答案禁猫咪词」】
 * 旧版扫 stem + explanation 里出现**原术语**的次数（阈值 0）。方向是反的：
 * 题目**本来就该**用原术语作答，解析里想写一句「考试卷子上要选【变量】」
 * 都会被这条判成违例 —— 那道闸门拦的是正经写法，不是问题写法。
 *
 * 主人 2026-09-20 定的规则是「猫咪外衣 + 硬核内核」，逐字是：
 *   · **题干**：可以有喵腔、可以有「大肥鱼」这类场景铺垫（外衣）；
 *   · **选项 / 标准答案 / 等价答案**：必须是编程原术语，
 *     出现术语表登记的猫咪说法就是**本末倒置**，报错（内核）；
 *   · **解析**：不限，猫咪风照留，要提醒「考试要选【变量】」也随便写。
 * 所以现在扫的字段正好和旧版反过来：**不扫 stem/explanation，只扫答案侧**。
 *
 * 【为什么豁免「本题代码里出现过的词」】
 * 有些猫咪词不是比喻，是**代码里的字**：
 *   · `code` 题问的是「这段程序印出什么」，答案就是那串字面量本身；
 *   · 「打招乎」是题目**故意**写的错别字，`拿碗()` 是真实存在的方法名。
 * 把它们判成「拟人化术语」就等于要求把答案改错。
 * 判据是机器可判的、不用维护白名单：**这个词在本题自己的 code 里出现过
 * = 它是代码的字面量/标识符，放行**；代码里没有、却出现在选项或答案里
 * = 出题人拿它当术语在用 —— 那才是本末倒置。
 *
 * 【扫哪些字段，以及「顶替」的机器判据是什么】
 * 主人要拦的是**术语被猫咪说法顶替**，不是「选项里出现猫」。两类的分界（2026-09-20 实测定）：
 *
 *   ✗ 判违例 —— 猫咪说法**占了术语的位子**：
 *       · 任何答案侧字段（标准答案 / 等价答案 / codefill 的空格答案）含猫咪词。
 *         答案键上必须是原术语，这条没有余地。
 *       · 某个**选项整项就是那个猫咪词**（`"小鱼干仓库"`、`"绕鱼干跑圈"`）——
 *         主人给的 ❌ 示范正是这个形状。
 *   ✓ 放行 —— 猫咪词**只是出场**，没占术语的位子：
 *       · 正解里带对照写法「猫猫图纸（类）」「翻译官喵（编译器 / 解释器）」：
 *         原术语就在同一个选项里，学员选它读到的就是原术语。
 *       · 干扰项里的角色出场（「因为起短名字会被翻译官喵拦下来」「翻译官喵的另一个名字」）：
 *         这是**外衣**，和题干里的「大肥鱼」同一性质 —— 主人明说题干/风格要保留，
 *         删了就是把猫咪味一刀切掉。**它们考的不是术语，所以不构成本末倒置。**
 *
 *   这条分界是照主人自己给的 ✅/❌ 划的：✅ 的题干里「装数字的小盒子」也是自造猫比喻，
 *   主人判它合规 —— 因为**学员要写出来的那个词**是原术语。判据盯的就是这个位子。
 */
function checkQuestionTerminology(lessonId, questions) {
  /** 去掉空白、反引号与首尾标点，用来判「整项就是这个词」。 */
  const 规整 = (s) => String(s).replace(/[\s`]/g, '').replace(/[。，、！？；：""''（）()]+$/g, '')

  for (const q of questions.questions) {
    const 代码 = [q.code, q.brokenCode, q.starter].filter(Boolean).join('\n')
    const 命中 = []

    // ① 答案侧：出现猫咪词就是顶替（代码里的字面量除外）
    const 答案侧 = [
      ...(typeof q.answer === 'string' ? [['标准答案', q.answer]] : []),
      ...(q.accept || []).map((v, i) => [`等价答案 ${i + 1}`, v]),
      ...(q.blanks || []).flatMap((b, i) => [
        [`第 ${i + 1} 空的答案`, b?.answer],
        ...(b?.accept || []).map((v, j) => [`第 ${i + 1} 空的等价答案 ${j + 1}`, v])
      ])
    ].filter(([, v]) => typeof v === 'string' && v !== '')

    for (const [名, 文] of 答案侧) {
      for (const c of countCatTerms(文).counts) {
        if (代码.includes(c.term)) continue // 代码里的字，不是比喻
        命中.push(`${名} = 「${文}」，含猫咪说法「${c.term}」×${c.found}（答案里该写原术语：${c.original}）`)
      }
    }

    // ② 选项：整项就是那个猫咪词（`"小鱼干仓库"` 这种），不管它是正解还是干扰项
    for (const [i, o] of (q.options || []).entries()) {
      if (typeof o !== 'string') continue
      for (const c of countCatTerms(o).counts) {
        if (代码.includes(c.term)) continue
        if (规整(o) === 规整(c.term)) {
          命中.push(`选项 ${i + 1} 整项就是猫咪说法「${c.term}」（该写原术语：${c.original}）`)
        }
      }
    }

    if (命中.length) {
      return err(lessonId, `题目 ${q.id} 本末倒置：术语的位子上用了猫咪说法 —— ${命中.join('；')}`)
    }
  }
}

/**
 * 术语双份一致检查：docs/04-设计规范.md §7 的表格必须与 content/glossary.json 完全一致。
 * 这是「改一处忘另一处」的机器保险——只要两处漂移，validate 直接失败。
 */
function checkGlossaryDocSync() {
  const docPath = path.join(ROOT, 'docs', '04-设计规范.md')
  if (!fs.existsSync(docPath)) return // 文档不在仓库时跳过（如打包产物内）
  const lines = fs.readFileSync(docPath, 'utf8').split('\n')

  const rows = [] // { originals: [], cat, line }
  let inSection = false
  let inTable = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (/^##\s/.test(line)) inSection = /^##\s*7\./.test(line)
    if (!inSection) {
      inTable = false
      continue
    }
    if (/^\|\s*原术语\s*\|/.test(line)) {
      inTable = true
      continue
    }
    if (!inTable) continue
    if (!line.startsWith('|')) {
      inTable = false
      continue
    }
    if (/^\|[\s:|-]+\|$/.test(line)) continue // 分隔行
    const cells = line.slice(1, -1).split('|').map((c) => c.trim())
    if (cells.length < 2) continue
    rows.push({
      originals: cells[0].split('/').map((s) => s.trim()).filter(Boolean),
      cat: cells[1],
      line: i + 1,
    })
  }

  const norm = (s) => s.replace(/\s|　/g, '')
  const docMap = new Map(rows.map((r) => [r.originals.map(norm).sort().join('|'), r]))

  if (rows.length === 0) {
    return err('docs/04-设计规范.md', '第 7 节术语表未解析到任何行——文档结构可能被改坏了')
  }

  for (const term of glossary.terms) {
    const key = term.originals.map(norm).sort().join('|')
    const row = docMap.get(key)
    if (!row) {
      err('docs/04-设计规范.md', `第 7 节缺少术语「${term.originals.join(' / ')}」——请与 glossary.json 同步`)
      continue
    }
    if (norm(row.cat) !== norm(term.cat)) {
      err(
        'docs/04-设计规范.md',
        `第 ${row.line} 行「${term.originals.join(' / ')}」说法不一致：文档="${row.cat}"，glossary="${term.cat}"`
      )
    }
    docMap.delete(key)
  }
  for (const left of docMap.values()) {
    err('docs/04-设计规范.md', `第 ${left.line} 行的术语「${left.originals.join(' / ')}」在 glossary.json 中不存在`)
  }
}

// 由 lesson id 推导目录：common/01-xxx、c/stage1/01-xxx（前缀数字匹配，slug 任意）
function lessonDirOf(id) {
  if (id.startsWith('common-')) {
    return findDir(path.join(CONTENT, 'common'), id.slice('common-'.length))
  }
  const m = id.match(/^(c|cpp|java|python)-stage(\d)-(\d+)$/)
  if (!m) return null
  return findDir(path.join(CONTENT, m[1], `stage${m[2]}`), m[3])
}

function findDir(base, num) {
  if (!fs.existsSync(base)) return null
  const d = fs.readdirSync(base).find((d) => d.startsWith(`${num}-`))
  return d ? path.join(base, d) : null
}

// ---------------------------------------------------------------- 主流程

let checked = 0
for (const [id, syl] of lessonIndex) {
  if (!lessonDirOf(id)) continue // 未生成的内容：大纲覆盖率信息，不算错误
  checked++
  checkLesson(id)
}

// 孤儿目录检查：磁盘上有、大纲里没有
function scanDisk() {
  const orphans = []
  const walk = (dir, idFn) => {
    if (!fs.existsSync(dir)) return
    for (const d of fs.readdirSync(dir)) {
      const p = path.join(dir, d)
      if (!fs.statSync(p).isDirectory()) continue
      if (fs.existsSync(path.join(p, 'lesson.md'))) {
        const id = idFn(dir, d)
        if (!lessonIndex.has(id)) orphans.push(p)
      }
    }
  }
  walk(path.join(CONTENT, 'common'), (_dir, d) => `common-${d.slice(0, 2)}`)
  for (const lang of ['c', 'cpp', 'java', 'python']) {
    for (let stage = 1; stage <= 3; stage++) {
      walk(path.join(CONTENT, lang, `stage${stage}`), (_dir, d) => `${lang}-stage${stage}-${d.slice(0, 2)}`)
    }
  }
  return orphans
}
const orphans = scanDisk()
for (const p of orphans) errors.push({ lessonId: p, message: '孤儿目录：磁盘上存在但大纲中没有此课' })

// ---- 术语双份一致（glossary.json ↔ docs/04 §7）
checkGlossaryDocSync()

// ---- 解锁链全图校验（对大纲全量做，不依赖内容生成进度）
{
  const visited = new Set()
  const inStack = new Set()
  const visit = (id) => {
    if (inStack.has(id)) return errors.push({ lessonId: id, message: '解锁链存在环' })
    if (visited.has(id)) return
    visited.add(id)
    inStack.add(id)
    const syl = lessonIndex.get(id)
    for (const req of effectiveRequired(syl)) {
      if (!lessonIndex.has(req)) errors.push({ lessonId: id, message: `前置课不存在：${req}` })
      else visit(req)
    }
    inStack.delete(id)
  }
  for (const id of lessonIndex.keys()) visit(id)
}

// ---------------------------------------------------------------- 错误库校验
/**
 * 内置错误库（content/error-lib/*.json）—— M5-04 的匹配器直接吃这几个文件。
 *
 * 【为什么非校验不可】
 * 这些规则是 M7 由 AI 批量生成的（每语言 25-40 条，五个文件加起来上百条），
 * 而它们**写错了不会有任何征兆**，三种错法全都是静默失效：
 *   - 正则写坏 → 匹配器只是跳过它，用户看到的是「这条报错没有解释」，没人会发现
 *   - `{1}` 对不上捕获组 → 界面上直接显示「变量「{1}」还没建起来喵」这种半成品
 *   - 该具体的排在笼统的后面 → 永远命中不到，规则等于没写
 * 没有一条会让程序崩，所以只能在入库前拦住。这也是「每批验收」的第一道闸。
 */
function checkErrorLib() {
  const dir = path.join(CONTENT, 'error-lib')
  if (!fs.existsSync(dir)) {
    return errors.push({ lessonId: 'error-lib', message: '目录不存在：content/error-lib/' })
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  if (files.length === 0) {
    return errors.push({ lessonId: 'error-lib', message: '一个规则文件都没有' })
  }

  const counts = []
  let total = 0

  for (const f of files) {
    const label = `error-lib/${f}`
    let lib
    try {
      lib = readJson(path.join(dir, f))
    } catch (e) {
      errors.push({ lessonId: label, message: `JSON 解析失败：${e.message}` })
      continue
    }
    if (!Array.isArray(lib.rules)) {
      errors.push({ lessonId: label, message: 'rules 必须是数组' })
      continue
    }
    counts.push(`${f.replace(/\.json$/, '')} ${lib.rules.length}`)
    total += lib.rules.length

    lib.rules.forEach((r, i) => {
      const at = `${label} 第 ${i + 1} 条`
      for (const field of ['pattern', 'title', 'explain', 'fixHint']) {
        if (typeof r[field] !== 'string' || !r[field].trim()) {
          errors.push({ lessonId: at, message: `缺少 ${field}（或为空）` })
        }
      }
      if (typeof r.pattern !== 'string' || !r.pattern.trim()) return

      if (r.flags !== undefined && (typeof r.flags !== 'string' || !/^[gimsuy]*$/.test(r.flags))) {
        errors.push({ lessonId: at, message: `flags 含无效标志：${JSON.stringify(r.flags)}` })
      }

      try {
        new RegExp(r.pattern, r.flags)
      } catch (e) {
        return errors.push({ lessonId: at, message: `正则是坏的：${e.message}` })
      }

      // 数捕获组：用 `(?:pattern)|` 包一层、拿空串去 exec，这样就一定匹配得上，
      // 结果数组里除 m[0] 外每一项都对应一个捕获组（没参与匹配的会是 undefined）。
      // 外层用的是**非捕获**括号，所以不会打乱 pattern 里原有的组号和反向引用。
      let groups = 0
      try {
        groups = new RegExp(`(?:${r.pattern})|`).exec('').length - 1
      } catch {
        // 包一层之后才炸（极罕见），按 0 处理即可，前面的编译检查已经放过了它
      }

      const texts = [r.title, r.explain, r.fixHint].join('')
      for (const m of texts.matchAll(/\{(\d)\}/g)) {
        const n = Number(m[1])
        if (n === 0) continue // {0} 是「整个匹配」，目前没有规则在用
        if (n > groups) {
          errors.push({
            lessonId: at,
            message: `文案里用了 {${n}}，但 pattern 只有 ${groups} 个捕获组 —— 界面上会把「{${n}}」原样显示给用户`
          })
        }
      }

      // 有捕获组却一个都没在文案里用上：多半是忘了写占位符，
      // 于是「哪个变量名出错了」这条最有用的信息白白丢掉
      if (groups > 0 && !/\{\d\}/.test(texts)) {
        warn(at, `pattern 抓了 ${groups} 个组，但文案里一个 {n} 都没用上 —— 抓到的内容没机会显示给用户`)
      }

      // 【术语闸门】审计报告 🔴 的漏网处：原先只有 lesson.md 正文和 questions.json
      // 的题干/解析设了防，**错误库这一百多条规则的文案一个字都没扫过** ——
      // 而它恰恰是「报错之后用户唯一会读的那段字」，也是 2026-09-14 被大改过的地方。
      // 刚改过又没人看的文案，是漏网原术语最容易藏身的位置。
      //
      // 扫 title/explain/fixHint 三个字段：都是直接渲染到界面上给用户看的。
      // **不扫 note** —— 那个字段是写给维护者看的实测备忘（「2026-09-14 用 gcc 16.1.0 实测」），
      // 应用侧根本不读它，扫了只会逼着人把有用的证据从注释里删掉。
      //
      // 判成**错误**而不是警告，依据是实测：全部 133 条规则跑下来是 0 处。
      // 既然现状干净，就没有「先放宽、以后再收紧」的理由 —— 那只会让新混进来的原术语一直绿着。
      const termHit = countTerms(texts)
      if (termHit.total > 0) {
        errors.push({
          lessonId: at,
          message:
            `文案含原术语 ${termHit.total} 处：` +
            termHit.counts.map((c) => `「${c.term}」×${c.found}（应用：${c.cat}）`).join('、')
        })
      }
    })
  }

  console.log(`错误库：${counts.join(' / ')}（共 ${total} 条）`)

  // 规模只是提示不是错误：M7 之前规则本来就少，不该因此让整个校验失败
  for (const f of files) {
    const lang = f.replace(/\.json$/, '')
    if (lang === 'common') continue
    const n = readJson(path.join(dir, f)).rules.length
    if (n < 25) warn(`error-lib/${f}`, `只有 ${n} 条规则（目标 25-40 条，M7 补齐）`)
  }
}

checkErrorLib()

// ---------------------------------------------------------------- 输出

for (const e of errors) console.log(`✗ [${e.lessonId}] ${e.message}`)
for (const w of warnings) console.log(`△ [${w.lessonId}] ${w.message}`)
const total = lessonIndex.size
const missing = total - coverage.onDisk
console.log('')
console.log(
  `校验完成：大纲 ${total} 课 | 已生成 ${coverage.onDisk} 课（本次检查 ${checked} 课）| 未生成 ${missing} 课` +
    (missing > 0 ? `（生成进度 ${((coverage.onDisk / total) * 100).toFixed(1)}%，未生成属正常）` : '（内容已齐全）')
)
console.log(`结果：${errors.length} 错误，${warnings.length} 警告`)
process.exit(errors.length > 0 ? 1 : 0)
