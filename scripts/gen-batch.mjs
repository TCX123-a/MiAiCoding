#!/usr/bin/env node
/**
 * 批次提示词生成器 —— 为 M7 批量内容生成产出完整提示词
 *
 * 用法：
 *   node scripts/gen-batch.mjs                    列出全部 41 个批次（40 个课文批 + M7-E1）
 *   node scripts/gen-batch.mjs <batchId>          打印该批次完整提示词
 *   node scripts/gen-batch.mjs <batchId> --out f  把提示词写入 f（UTF-8）
 *
 * 提示词 = 内容生成规范全文 + 术语表 + 黄金样例 + 大纲切片 + 输出目录清单。
 * 交给子代理（flash 模型，见 docs/07）生成后，跑 validate:content 验收。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CONTENT = path.join(ROOT, 'content')

const glossary = JSON.parse(fs.readFileSync(path.join(CONTENT, 'glossary.json'), 'utf8'))
const syllabus = JSON.parse(fs.readFileSync(path.join(CONTENT, 'syllabus.json'), 'utf8'))
const SPEC09 = fs.readFileSync(path.join(ROOT, 'docs', '09-内容生成规范.md'), 'utf8')

const LANG_CODE = { c: 'CS', cpp: 'CPS', java: 'JS', python: 'PS' }
const LANG_CN = { c: 'C 语言', cpp: 'C++', java: 'Java', python: 'Python' }

// ---------------------------------------------------------------- 工具

function chunks(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const byLangStage = new Map()
for (const mod of syllabus.modules) byLangStage.set(`${mod.lang}:${mod.stage}`, mod.lessons)

/**
 * 缺省解锁规则：同阶段上一课；阶段首课=上一阶段末课；stage1 首课=common-01；
 * **再没有就是天然无前置**。
 *
 * ⚠️ 【这里原来有一句 `if (lesson.lang === 'common') return []`，2026-09-15 删掉】
 * 它把**整个 common 模块的前置一口气吞掉了**：凡是 frontmatter 没写 `required`
 * 的 common 课全都变成「无前置、开局就能点」（提示词里也会照着写 `required=[]`），
 * 而大纲自己写的规则是「**lesson 未写 required 时**：同阶段上一课」—— 没把 common 排除在外。
 *
 * 它看起来像在防崩溃（common 的 stage 是 0，`stage - 1` 会去取 `common:-1`），
 * 但真正需要兜底的**只有模块第一课**这一种情况，一句 `prevStage ?? []` 就够。
 * 代价是它很安静：02/03/04 显式写了链子所以看不出问题，05 没写就悄悄变成自由课 ——
 * 学员可以在「什么是编程」之前先点开「条件判断」。
 *
 * 这条规则在本目录的 validate / content-build 里**各有一份逐字相同的副本**，
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

// 输出目录：content/common/01-xxx/、content/c/stage1/01-xxx/
function outputDirOf(id) {
  const m = id.match(/^(c|cpp|java|python)-stage(\d)-(\d+)$/)
  if (id.startsWith('common-')) {
    const n = id.slice('common-'.length)
    return path.join('content', 'common', `${n}-<英文slug>`) + '/'
  }
  return path.join('content', m[1], `stage${m[2]}`, `${m[3]}-<英文slug>`) + '/'
}

/*
 * 盘上已经存在的课 —— 生成任务书时必须**吼出来**。
 *
 * 来历：`gen-batch` 早就警告过「不加 `--only` 会把整批 N 课都交给子代理，
 * **已在盘上的课会被覆盖**」，可那只是一句打在控制台的话 —— 谁（包括未来的我）
 * 只要不加 `--only`，**任务书里就一个字的提示都没有**，写手照单全收、把旧课文盖掉。
 * 2026-09-16 真的发生了三次：c-stage1-12 / cpp-stage1-04 / java-stage1-09 的试点课文
 * 被这一波写手覆盖（万幸那三课配的试点题考的概念在新正文里都还在，没炸）。
 * 更阴的是「题库还配不配得上新正文」**没有任何闸门在查** —— 覆盖了也没人报警。
 * 修法跟「先修模具再浇铸」是同一条：**警告要长在任务书里，不能长在我的记性里**。
 */
function existingLessons(lang, stage) {
  const out = new Map()
  const dir = path.join(CONTENT, lang, `stage${stage}`)
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir)) {
    const lf = path.join(dir, e, 'lesson.md')
    if (!fs.existsSync(lf)) continue
    const m = fs.readFileSync(lf, 'utf8').match(/^id:\s*(\S+)/m)
    if (!m) continue
    let bank = 0
    try {
      const bf = path.join(CONTENT, 'challenge-bank', lang, `${m[1]}.json`)
      bank = JSON.parse(fs.readFileSync(bf, 'utf8')).items.length
    } catch {}
    out.set(m[1], { where: `${lang}/stage${stage}/${e}`, bank })
  }
  return out
}

function goldenSample() {
  if (!fs.existsSync(path.join(CONTENT, 'common'))) return null
  const dir = fs.readdirSync(path.join(CONTENT, 'common')).find((d) => d.startsWith('01-'))
  if (!dir) return null
  const p = path.join(CONTENT, 'common', dir)
  return {
    lesson: fs.readFileSync(path.join(p, 'lesson.md'), 'utf8'),
    questions: fs.readFileSync(path.join(p, 'questions.json'), 'utf8')
  }
}

// ---------------------------------------------------------------- 批次构建

function buildBatches() {
  const batches = []
  // 每节课记住自己在**模块里的真实位置**（1 起），供 frontmatter 的 order 用。
  // 不能拿"批内下标"当 order：批是把模块切成 6 段（语言课 5 段）切出来的，
  // 只有第一批两者恰好相等。第二批的头一节是模块第 7 课，写成 1 就和盘上
  // 已有的文件（common-13 写的是 7）对不上了。
  const tag = (list) => list.map((l, i) => ({ ...l, _order: i + 1 }))
  const common = tag(syllabus.modules.find((m) => m.lang === 'common').lessons)
  for (const [i, part] of chunks(common, 6).entries()) {
    batches.push({ id: `M7-C-${i + 1}`, desc: `通用知识批 ${i + 1}`, lang: 'common', stage: 0, lessons: part })
  }
  for (const mod of syllabus.modules) {
    if (mod.lang === 'common') continue
    const tagged = tag(mod.lessons)
    for (const [i, part] of chunks(tagged, 5).entries()) {
      batches.push({
        id: `M7-${LANG_CODE[mod.lang]}${mod.stage}-${i + 1}`,
        desc: `${LANG_CN[mod.lang]}${mod.stage === 1 ? '入门' : mod.stage === 2 ? '进阶' : '精通'}阶段批 ${i + 1}`,
        lang: mod.lang,
        stage: mod.stage,
        lessons: part
      })
    }
  }
  batches.push({ id: 'M7-E1', desc: '内置错误库规则（5 个语言文件）', errorLib: true })
  return batches
}

const BATCHES = buildBatches()

// ---------------------------------------------------------------- 提示词组装

function buildLessonPrompt(batch) {
  const parts = []
  parts.push(`# 任务：为「咪爱编程」生成课程内容批次 ${batch.id}（${batch.desc}）\n`)
  parts.push(
    '你是猫咪编程老师「咪爱」，正在为离线学习软件撰写课程内容。请在项目 `content/` 目录下**直接创建文件**。本批共 ' +
      batch.lessons.length +
      ' 课，每课一个目录，目录里两个文件：`lesson.md`（讲解正文）+ `questions.json`（练习题）。\n'
  )
  parts.push('## 一、内容生成规范（必须逐条遵守）\n')
  parts.push(SPEC09)
  parts.push('\n## 二、术语映射唯一真源（glossary.json 全文）\n')
  parts.push('```json\n' + JSON.stringify(glossary, null, 2) + '\n```')
  const golden = goldenSample()
  parts.push('\n## 三、黄金样例（风格基准）\n')
  if (golden) {
    parts.push('以下 common-01 是已定稿的黄金样例，你的全部产出（口吻、篇幅、结构、题目风格）必须与它一致：\n')
    parts.push('### lesson.md\n```markdown\n' + golden.lesson + '\n```')
    parts.push('### questions.json\n```json\n' + golden.questions + '\n```')
  } else {
    parts.push('黄金样例尚未生成，请严格以第一节规范（尤其第 5 节风格范例）为基准，产出高质量首稿。\n')
  }
  parts.push('\n## 四、本批课程清单\n')
  const existing = existingLessons(batch.lang, batch.stage)
  for (const [i, syl] of batch.lessons.entries()) {
    const full = { ...syl, lang: batch.lang, stage: batch.stage, order: syl._order ?? i + 1 }
    const req = effectiveRequired(full)
    parts.push(`### ${i + 1}. ${full.id} 《${full.title}》`)
    parts.push(`- ⚠️ frontmatter 里 \`order\` 必须是 **${full.order}**（它在模块里的真实位置，不是这一批里排第几）`)
    parts.push(`- 输出目录：\`${outputDirOf(full.id)}\`（<英文slug> 自定，如 intro / variables）`)
    const pre = existing.get(full.id)
    if (pre) {
      parts.push(
        `- 🛑 **这一课盘上已经有正文了**：\`content/${pre.where}/\`` +
          (pre.bank ? `，而且已经配了 **${pre.bank} 道题库**` : '') +
          '。**不要覆盖它** —— 除非任务明确要求重写。'
      )
      parts.push(
        '  理由：题库是按旧正文写的，而「题库还配不配得上新正文」**没有任何闸门会查**，覆盖了也没人报警。' +
          '你只该写本批**还没有正文**的那几课；确实要重写的话，先读旧正文和它的题库，逐个确认旧题考的概念新正文仍然讲。'
      )
    }
    parts.push(`- 大纲要点：${full.outline.replace(/\|/g, ' → ')}`)
    parts.push(
      `- frontmatter：id=${full.id}，lang=${full.lang}，stage=${full.stage}，order=${full.order}，title=${full.title}，` +
        `tags=[${(full.tags || []).join(', ')}]，required=${JSON.stringify(req)}，` +
        `crossRefs=${JSON.stringify(full.crossRefs || [])}` +
        (full.compare && full.compare.length ? `，compare=${JSON.stringify(full.compare)}` : '') +
        `；estMinutes 自定（10-30 整数），keywords 自定（2-5 个英文关键词）`
    )
    // 大纲里的 tags 常常只有 1 个，而规范要求 2-5 个 —— 照抄会留下一条本课专属警告。
    // 这件事上一批是子代理自己发现并修的（common-05），不该指望下一次也发现。
    if ((full.tags || []).length < 2) {
      parts.push(
        `- ⚠️ 大纲给的 tags 只有 ${(full.tags || []).length} 个，而规范要求 **2-5 个** —— ` +
          `在它后面自己补到至少 2 个（补的都是本课确实讲了的主题词）`
      )
    }
    if (batch.lang === 'common') {
      parts.push('- 通用课要求：正文必须包含一个 ```compare 对比块（c/cpp/java/python 四段齐全）')
    } else {
      parts.push('- 语言课要求：正文**不得**写 compare 代码块（通过 frontmatter 的 compare 字段引用通用课）')
    }
    parts.push('')
  }
  /*
   * ⚠️ 这一节的来历：`docs/15` 是 2026-09-16 主人在「批 8 之后」拍板的产物 ——
   * 「Python 写完了，后面 C/C++/Java 的知识点结构其实一样，不要每节课都从零构思，
   *   重点把力气花在语言差异上」。底稿写出来了，**但生成器没把必读清单改掉** ——
   * 于是批 9 的 8 路子代理一个都没读到它，等于这条指令没下达（是靠人工逐路补消息兜住的）。
   * 教训跟「先修模具再浇铸」是同一条：文档改了不算数，**喂进任务书里才算数**。
   */
  if (batch.lang !== 'common') {
    parts.push('## 五、跨语言复用（语言课专用；通用知识课没有这一节）\n')
    parts.push(
      '**主人拍板：C / C++ / Java 的课不要每节从零构思。** 先读 `docs/15-跨语言课文映射底稿.md`（约 5 分钟）：\n'
    )
    parts.push(
      '- **§2 对齐表**（stage1 专用）—— 本批每一课都有一门对照的同类课，**骨架 / 节奏 / 坑的类型**照它来。' +
        '去读那几课的正文，看它怎么开场、怎么递进、怎么收尾。stage2/3 没有现成对齐表，按 §1 的复用规则自己找对齐课。\n' +
        '- **§3** —— 这门语言第一章必须立起来的心智模型，写进课文（学员最容易用别的语言的直觉来理解它）。\n' +
        '- **§4** —— 这门语言 stage1 的特有坑清单，「小心喵」优先从这份清单里取。\n' +
        '- **§5** —— 铁律，含「起编译器前先拿 verilock 队列锁」。\n'
    )
    parts.push(
      '⚠️ **铁律：结构可以抄，代码一行都不许抄。** 每个代码片段都得是这门语言自己的写法，' +
        '不是把 Python 逐行翻译过来 —— 学员要学的恰恰是「同一件事在两种语言里长什么样」。\n' +
        '（`docs/09` 已规定：语言课正文**不得**写 compare 四语言并排块，改用 frontmatter 的 `compare:` 引用通用课。）\n'
    )
  }
  parts.push('## 六、完成要求\n')
  parts.push(
    '1. 全部 ' +
      batch.lessons.length +
      ' 课写完；**篇幅服务于内容** —— 讲清楚为止，**没有字数上下限**。' +
      '绝不为了凑字数注水，更不要为了"控制在多少字以内"删掉关键解释；至少一个 tip 提示框。'
  )
  /*
   * ⚠️ 这里原先是写死的一句「choice 2-4 / fill 1-3 / code 1-3」。
   *
   * 两个毛病：
   *  1. 那是**通用知识课**的配比。语言课的配比在 docs/09 §2.2 里是另一套
   *     （choice 2-3 / codefill 1-2 / code 1-2），而且**必须含 `codefill`** ——
   *     写死的那句让人永远产不出 `codefill`，一整批都合规不了。
   *  2. 更阴的是下限：语言课按 docs/09 三型各取最低是 2+1+1 = **4 题**，
   *     而 `content-validate.mjs` 的硬下限是 **5 题**。照着写会被校验器打回，
   *     报错却说「题目数须为 5-10」，看不出是配比自己把自己坑了。
   *
   * 所以按语言分岔，并且把下限**写成明确的数字**，不留给执行者做加法。
   */
  parts.push(
    '2. ' +
      (batch.lang === 'common'
        ? '每课 questions.json **5-10 题**（choice 2-4 / fill 1-3 / code 1-3，`codefill` 可选 0-2 题、额度从 code 里挪）。' +
          '⚠️ 三型各取最低是 2+1+1 = 4 题，**不够** —— 至少有一种题型多出 1 题。' +
          '**不要写 `codefix` / `codewrite`**（概念课写这两个题型会超纲）。'
        : '每课 questions.json **手写 5-7 题**（choice 2-3 / `codefill` 1-2 / code 1-2），解析必须猫咪口吻讲清"为什么"。' +
          '⚠️ 三型各取最低是 2+1+1 = 4 题，**达不到要求的下限 5 题** —— 至少有一种题型多出 1 题。' +
          '**不要写 `codefix` / `codewrite`**：那两类由无限题库脚本在本地真跑生成（见规范 §2.2），' +
          '届时会自动并进这一课，不用你操心。') +
      '**题不外问**：每道题都必须能**只凭本课正文**做出来 —— 题目考到的每个概念、每个代码 token，' +
      '正文里都得讲过；不许假设学员看过别的课，也不许考正文没提的东西。'
  )
  parts.push(
    '3. 所有示例代码必须真实可运行；Python 课尤其注意缩进与输出。' +
      '⚠️ **故意写错的代码不能放进真语言围栏**（` ```python ` / ` ```c ` 这类一律会被真跑，跑不动就是整批红）——' +
      '写成行内代码，或放进 ` ```text ` 围栏。' +
      '⚠️ **HTML 形状的判定比你想的宽**：校验器用的是 `/\\<\\/?[a-zA-Z][^>]*>/`，' +
      '只要**一个 `<` 后面紧跟字母**就算，而且它会**跨着反引号一路吞到后面那个 `>`**。' +
      '实测踩到的是格式规格：`` `:<n` / `:>n` `` 会被整段吞掉判成 HTML 标签，' +
      '而报错只说「正文含原始 HTML 标签」**不指位置**，得自己找。' +
      '躲法：写成 `<8`（`<` 后跟数字就安全）或整句改写。`<class \'int\'>`、`#include <stdio.h>` 同理。'
  )
  parts.push(
    '4. 术语：**课文正文**每课 ≤2 处（且只在"介绍该术语本身"或"原术语（猫咪说法）首次对照"时出现）。' +
      '⚠️ **题干和解析是 0 处 —— 一个原术语都不许有**，而且这是**错误级**（正文超了只是警告级）。' +
      '题干/解析是学员每题都要读两遍的字，必须全用猫咪说法。' +
      '⚠️ **预告下一课时别抄大纲标题原文** —— 课名里常带原术语（如"列表推导式与生成器初步"里的「列表」），' +
      '照抄等于往正文里白送一处违例。用自己的话讲下一课要学什么。'
  )
  parts.push(
    '5. 收尾三道自检，**缺一不可**（前两道只跑本课、秒级；第三道是总闸）：\n' +
      '   · `node scripts/check-lesson-code.mjs <课号>` —— 真跑正文里的代码块，确认"课文声称的输出"真跑得出来\n' +
      '   · `node scripts/check-code-answers.mjs <课号>` —— 真跑 code 题的答案，确认答案对\n' +
      '   · `npm run validate:content` —— 必须 0 错误；如有报错按错误清单逐条修复后重新校验\n' +
      '   ⚠️ 只跑第三道**不够**：前两道管"代码真不真"，第三道管"文案与结构合不合规"，覆盖面不重叠。\n' +
      '   ⚠️ **第三道会对本批每一节课报出「节课下限要求 codefix / codewrite 至少 1 题」—— 那是预期的**：\n' +
      '     这两个题型**不由你写**（docs/09：它们必须由参考解真跑算出 expectedOutput），\n' +
      '     而产出它们的题库模板是**下一阶段的独立任务**。所以：本批这几节课的这条报错**先记下、报给我**，\n' +
      '     除此之外 `validate:content` 必须 0 错误。\n' +
      '     ⛔ **绝不要把 codefix / codewrite 手写进 questions.json 去凑** —— 手写的 expectedOutput\n' +
      '     没人跑过，那就是在制造"学员照着参考解敲却永远判错"的题。'
  )
  return parts.join('\n')
}

function buildErrorLibPrompt() {
  return [
    '# 任务：为「咪爱编程」生成内置错误库（批次 M7-E1）\n',
    '你是猫咪编程老师「咪爱」。请在 `content/error-lib/` 下**直接改写**这 5 个文件：`common.json`、`c.json`、`cpp.json`、`java.json`、`python.json`（保留 version 与 note 字段）。\n',
    '## 一、rules 规则对象 schema（每文件一个 rules 数组）\n',
    '```json\n{ "pattern": "正则表达式（可用 {1} 占位符捕获标识符）", "title": "错误标题（猫咪口吻，一句话）", "explain": "为什么错了（猫咪口吻，比喻+原理）", "fixHint": "怎么修（具体步骤）" }\n```\n',
    '## 二、术语映射（explain 中必须使用猫咪说法，同下）\n',
    '```json\n' + JSON.stringify(glossary, null, 2) + '\n```\n',
    '## 三、数量与覆盖面要求\n',
    '- common.json：8-15 条跨语言规则（文件不存在、权限拒绝、输出乱码、超时被杀、找不到命令等运行器级错误）。',
    '- c/cpp/java/python.json：各 25-40 条，覆盖该语言 Top 常见编译错与运行错（拼写、类型不匹配、缺分号/缩进、未定义、空指针、越界、类名不一致、缩进/编码……）。',
    '- pattern 只匹配**该语言**真实报错文本，避免过宽（如 java 的 "cannot find symbol"、python 的 "NameError"、c 的 "undefined reference"）。{1} 用于把报错里的真实名字回填到 explain/fixHint。',
    '- 每条 explain 与 fixHint 均猫咪口吻；fixHint 给出可照做的修复步骤。\n',
    '## 四、验收\n',
    '写完运行 `npm run validate:content` 无错误，并保证 5 个 json 文件 JSON 合法、pattern 全部为合法正则（可用 `node -e` 逐条 new RegExp 验证）。'
  ].join('\n')
}

// ---------------------------------------------------------------- 主流程

const argv = process.argv.slice(2)
const onlyAt = argv.indexOf('--only')
const only = onlyAt >= 0 ? (argv[onlyAt + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean) : []
const rest = onlyAt >= 0 ? [...argv.slice(0, onlyAt), ...argv.slice(onlyAt + 2)] : argv
const [batchId, outFlag, outFile] = rest

if (!batchId) {
  console.log('全部批次（' + BATCHES.length + ' 个）：')
  for (const b of BATCHES) {
    const range = b.errorLib
      ? 'error-lib 5 文件'
      : b.lessons.map((l) => l.id).join(', ')
    console.log(`  ${b.id}\t${b.desc}\t${range}`)
  }
  console.log('\n用法：node scripts/gen-batch.mjs <batchId> [--only a,b] [--out <文件>]')
  console.log('     --only 只出这几课的提示词（写一节验一节时用）。')
  console.log('            ⚠️ 不加它会把整批 N 课都交给子代理，**已在盘上的课会被覆盖**。')
  process.exit(0)
}

if (onlyAt >= 0 && only.length === 0) {
  console.error('--only 后面要跟课号，例如 --only common-05')
  process.exit(1)
}

let batch = BATCHES.find((b) => b.id === batchId)
if (!batch) {
  console.error(`未知批次：${batchId}（不带参数运行可看全部批次列表）`)
  process.exit(1)
}
if (batch.errorLib && only.length) {
  console.error('--only 只能用于课文批；错误库批是整批 5 个文件一起改的')
  process.exit(1)
}
if (only.length) {
  const absent = only.filter((id) => !batch.lessons.some((l) => l.id === id))
  if (absent.length) {
    console.error(`这些课不在 ${batchId} 里：${absent.join('、')}（本批是 ${batch.lessons.map((l) => l.id).join(', ')}）`)
    process.exit(1)
  }
  const kept = batch.lessons.filter((l) => only.includes(l.id))
  batch = { ...batch, lessons: kept, desc: `${batch.desc}（只出 ${kept.length} 课）` }
}

const prompt = batch.errorLib ? buildErrorLibPrompt() : buildLessonPrompt(batch)

// 任务书里已经逐课标了 🛑，这里再给操作者吼一声 —— 覆盖旧课文是**当场看得见**的决定，
// 不该等写完才发现（2026-09-16 已经真发生过三次）。
if (!batch.errorLib && batch.lessons) {
  const pre = existingLessons(batch.lang, batch.stage)
  const hit = batch.lessons.filter((l) => pre.has(l.id))
  if (hit.length) {
    console.error(
      `⚠️ 本批有 ${hit.length} 课盘上已存在，会被覆盖：` +
        hit.map((l) => `${l.id}${pre.get(l.id).bank ? `（题库 ${pre.get(l.id).bank} 道）` : ''}`).join('、') +
        `\n   只想写没正文的那几课，就重新生成：--only ${batch.lessons.filter((l) => !pre.has(l.id)).map((l) => l.id).join(',')}`
    )
  }
}

if (outFlag === '--out') {
  if (!outFile) {
    console.error('--out 需要文件名')
    process.exit(1)
  }
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true })
  fs.writeFileSync(outFile, prompt, 'utf8')
  console.log(`提示词已写入：${outFile}（${Math.round(prompt.length / 1024)} KB）`)
} else {
  console.log(prompt)
}
