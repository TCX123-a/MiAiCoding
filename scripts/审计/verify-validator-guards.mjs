#!/usr/bin/env node
/**
 * 反向验证：**校验器自己还抓得住东西吗？**
 *
 * 【为什么需要这个台子】
 * `content-validate.mjs` 全绿有两种可能，而且从输出上**完全看不出区别**：
 *   · 内容真的干净
 *   · 某条检查在改代码时被顺手改瞎了（条件写反、`return` 提前、加了 `?.` 把 undefined 吞掉）
 * 第二种会一直绿下去 —— 因为它对任何输入都绿。绿得越久，越没人怀疑它。
 *
 * 所以唯一的验法是**故意把缺陷注进去，看它红不红**。这正是本项目的老规矩：
 * 「故意把规则改坏，确认测试变红，再恢复」。
 *
 * 【为什么敢动真的内容文件】
 * 本台子会临时改写真的题库和错误库（清单见下面 CASES 的目标文件），靠三条自保：
 *   1. 开跑前先确认这些文件在 git 里都是**干净的** —— 有脏的就直接退出，
 *      否则本台子一恢复就把主人没提交的改动一起抹了（这是最要命的一种事故）。
 *   2. 恢复写在 `finally` 里，且恢复的是**读进来的原始字节**，不是重新序列化的结果。
 *      另外每条注入测完就立刻还原一次 —— 不然上一条的注入会留到下一条，
 *      第二条的「变红」可能其实是第一条造成的，而台子会记成「第二条也被抓住了」。
 *   3. 恢复后再跑一次校验器 + 逐个比对 sha256，全都对上才算收工。
 *
 * 【万一被 Ctrl-C / 断电打断（恢复没跑成）怎么办】
 * 这些文件都是 git 跟踪的，一句 `git checkout -- <文件>` 就回来了。
 * 所以第 1 条「开跑前必须干净」不只是防抹改动，也是这条退路的**前提**。
 *
 * 用法：
 *   node scripts/审计/verify-validator-guards.mjs
 * 退出码：0 = 每条注入都被抓住且恢复成功；1 = 有检查失效（或自保没过）
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = process.cwd()
const QUIZ_FILE = 'content/common/13-one-row-data/questions.json'
const LIB_FILE = 'content/error-lib/c.json'
/** 一份语言课的题库产物 —— 「节课题型下限」那条判据的两个分支都拿它注入 */
const BANK_FILE = 'content/challenge-bank/python/python-stage2-04.json'

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12)

function validator() {
  try {
    return { code: 0, out: execFileSync('node', ['scripts/content-validate.mjs'], { encoding: 'utf8' }) }
  } catch (e) {
    // 校验器是拿 exit code 报错的，非 0 会抛 —— 那不是崩溃，是「抓住了」
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

function assertCleanInGit(files) {
  const dirty = execFileSync('git', ['status', '--porcelain', '--', ...files], { encoding: 'utf8' }).trim()
  if (dirty) {
    console.error(`✗ 这些文件在 git 里是脏的：\n${dirty}`)
    console.error('  先提交或还原它们再来 —— 本台子会用「原始字节」覆盖这些文件，')
    console.error('  脏着跑会把还没提交的改动一起抹掉。')
    process.exit(1)
  }
}

/**
 * 每条 = [目标文件, 名字, 注入函数, 期望在校验器输出里出现的一句话]
 *
 * 为什么每条都要写「期望的那句话」：只判 exit code 不够。
 * 注入 A 却因为别的原因（比如文件被写坏成坏 JSON）变红，exit code 一样是 1，
 * 台子会误报「A 被抓住了」。必须**看到那条检查自己报的那句话**才算数。
 *
 * inject 收到的是**解析好的 JSON 对象**，就地改；写回由台子统一做。
 */
const CASES = [
  [QUIZ_FILE, '选择题有两个一模一样的选项', (j) => {
    const c = j.questions.find((q) => q.type === 'choice')
    c.options[1] = c.options[0]
  }, '有重复选项'],

  [QUIZ_FILE, '选择题有个选项是空白', (j) => {
    const c = j.questions.find((q) => q.type === 'choice')
    c.options[c.answer] = '   '
  }, '有空选项'],

  [QUIZ_FILE, '填空题答案是纯空白', (j) => {
    j.questions.find((q) => q.type === 'fill').answer = '   '
  }, '答案必须是非空字符串'],

  [QUIZ_FILE, '代码阅读题答案是纯空白', (j) => {
    j.questions.find((q) => q.type === 'code').answer = '\n  '
  }, '答案必须是非空字符串'],

  [QUIZ_FILE, '题干是纯空白', (j) => {
    j.questions.find((q) => q.type === 'choice').stem = '  \n '
  }, '缺题干或解析'],

  // 错误库的术语闸门是 2026-09-14 补的（此前这一百多条规则的文案一个字都没扫过）。
  // 两条注入分开测 title 和 explain，因为它们是两条独立的代码路径进到同一个拼接串里的 ——
  // 只测一条，另一条要是被漏掉（比如拼接时写漏了字段）根本看不出来。
  [LIB_FILE, '报错规则的标题混进原术语', (j) => {
    j.rules[0].title = '变量还没建起来喵'
  }, '文案含原术语'],

  [LIB_FILE, '报错规则的解释混进原术语', (j) => {
    j.rules[0].explain = '这里说的是循环没写对喵'
  }, '文案含原术语'],

  [LIB_FILE, '报错规则的修复建议混进原术语', (j) => {
    j.rules[0].fixHint = '把函数名改对喵'
  }, '文案含原术语'],

  /*
   * 2026-09-16 加。这条同时补两件事：
   *
   * ① **路径**：上面三条注入打的全是 `error-lib` 那条路（title/explain/fixHint），
   *    而「题干/解析 0 处」是**另一条独立的代码路径**（content-validate.mjs:655 起），
   *    此前**一条注入都没测过**它 —— 它要是哪天被改瞎了，台子照样全绿。
   *    ⚠️ 注入要避开的坑：那道闸门对**题干里带「原术语」三个字**的题整道跳过
   *    （有些题的任务就是报出原术语，见 :649-655），所以要挑一道干净的题干来注入。
   *
   * ② **边界**：同一天给 `类` 的排除表补了「这」「各」（「这类」「各类」是"这种/各种"，
   *    不是 class，原表里「之类」「那类」早有，「这类」反而漏了）。
   *    补完必须能证明**真泄漏仍然会红** —— 用「这个类」（挨着的是「个」）钉住这一点。
   *    单测级的证据在 `<workspace>/_term-probe.mjs`（不随仓库分发；13 条，含「这些类」必须仍被抓的反证）。
   */
  [QUIZ_FILE, '选择题题干混进原术语', (j) => {
    j.questions.find((q) => q.type === 'choice').stem = '这个类怎么画图纸喵'
  }, '题干/解析含原术语'],

  /*
   * 「节课题型下限」是 2026-09-16 补的判据（docs/14 §9.6）：语言课的节课最终必须
   * `codefix` ≥1、`codewrite` ≥1，而且**跨「手写题 + 题库」两个来源取数**。
   *
   * 两条注入各打一个分支 —— 删题型打的是「题库里 0 道」，改课号打的是
   * 「整份题库都不存在」（真实数据里 3 节课踩的是后一条，所以它不能只靠推理）。
   * 两条都只可能由这一条判据报出来：手写 `questions.json` 里本来就不许有这两个题型，
   * 而题库文件除了这条判据没有任何别的地方在读。
   */
  [BANK_FILE, '题库里一道 codewrite 都没有', (j) => {
    j.items = j.items.filter((it) => it.type !== 'codewrite')
  }, '节课下限要求 codewrite'],

  [BANK_FILE, '题库整份对不上课号（等于这节课没题库）', (j) => {
    j.lessonId = 'python-stage2-99'
  }, '整份题库都不存在'],
]

const FILES = [...new Set(CASES.map((c) => c[0]))]
assertCleanInGit(FILES)
const orig = new Map(FILES.map((f) => [f, readFileSync(f, 'utf8')]))

// 先跑一次干净的：**必须绿**。它要是不绿，下面所有的红都说明不了任何事
//（分不清是「注入生效」还是「本来就红」）。
const before = validator()
if (before.code !== 0) {
  console.error('✗ 注入之前校验器就已经是红的 —— 先把它修绿再来，否则下面测不出东西。')
  console.error(before.out.split('\n').filter((l) => l.includes('✗')).slice(0, 5).join('\n'))
  process.exit(1)
}
console.log(`✓ 前置：原内容校验器是绿的（${FILES.map((f) => `${f} sha ${sha(orig.get(f))}`).join('；')}）\n`)

let bad = 0
try {
  for (const [file, name, inject, expect] of CASES) {
    const j = JSON.parse(orig.get(file))
    inject(j)
    writeFileSync(file, JSON.stringify(j, null, 2) + '\n', 'utf8')

    const r = validator()
    const caught = r.code !== 0 && r.out.includes(expect)
    if (caught) {
      const line = r.out.split('\n').find((l) => l.includes(expect))?.trim() ?? ''
      console.log(`  ✓ ${name}\n      ${line.slice(0, 110)}`)
    } else {
      console.log(`  ✗ ${name} —— **没抓住**`)
      console.log(`      期望看到「${expect}」且 exit≠0，实际 exit=${r.code}`)
      console.log(`      这条检查要么被改瞎了，要么被更早的 return 挡住了。`)
      bad++
    }
    writeFileSync(file, orig.get(file), 'utf8') // 每条测完立刻还原，别把上一条的注入带进下一条
  }
} finally {
  // 恢复原始字节（不是重新序列化 —— 那会把格式/换行也一起改了，git 上看起来像改过）
  for (const f of FILES) writeFileSync(f, orig.get(f), 'utf8')
}

// ── 恢复的收尾：文件得跟原来一个字节不差，校验器得回绿 ──
const drift = FILES.filter((f) => sha(readFileSync(f, 'utf8')) !== sha(orig.get(f)))
const after = validator()
if (drift.length) {
  console.error(`\n✗ 恢复不彻底：${drift.join('、')}`)
  console.error(`  跑一句 git checkout -- ${drift.join(' ')} 就回来了。`)
  bad++
} else if (after.code !== 0) {
  console.error(`\n✗ 文件恢复了但校验器还是红的 —— 有别的改动混进来了？`)
  bad++
} else {
  console.log(`\n✓ 已还原（${FILES.length} 个文件都一个字节没变，校验器回绿）`)
}

console.log(
  bad === 0
    ? `\n全部通过：${CASES.length} 条注入全被抓住，原文件一个字节没变`
    : `\n有 ${bad} 条没通过 —— 那几条检查现在是摆设`
)
process.exit(bad === 0 ? 0 : 1)
