#!/usr/bin/env node
/**
 * 审计台：「一声不响」类断言的清点器
 *
 * 【为什么单为这一类造一台】
 * 本轮缺陷修复里，**同一类错在四种语言上咬了十几次**，形状完全一样：
 *
 *     课文断言「这个错很安静 / 翻译官喵不管 / 不会报错」，
 *     而真跑一遍，屏幕上要么一片红字、要么干脆连一行都没跑。
 *
 * 它是**最难靠读稿发现**的一类：句子读起来通顺、术语也对、术语扫盲器抓不到，
 * 唯一能戳穿它的就是真跑 —— 可全库有 194 课，不可能每句都真跑。
 * 所以这台台子干的不是「判定」，是**缩小范围**：把全库所有「断言安静」的句子摊在一张纸上，
 * 让真跑只花在该跑的地方。
 *
 * 【它不是闸门】
 * 永远 exit 0。命中不等于错（「`sys.exit()` 之后的行全是废纸」也是真话），
 * 它只是**请柬**：每一条都得真跑过才能销账。
 *
 * 【销账】
 * 复核过（真跑过、结论已落盘或已改）的句子记进 `scripts/审计/silence-reviewed.json`，
 * 键是 `<相对路径>#<句子归一化后的 sha1>` —— 用哈希不用行号，因为改课文会让行号整体挪位。
 * 复核过的不再打扰，**新冒出来的才醒目**。
 *
 * 用法：
 *   node scripts/审计/audit-silence-claims.mjs              # 全部，未复核的排前面
 *   node scripts/审计/audit-silence-claims.mjs --lang c     # 只看一门语言
 *   node scripts/审计/audit-silence-claims.mjs --all        # 连「弱」标记一起看
 */
import { readFileSync, existsSync, globSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const REVIEWED = 'scripts/审计/silence-reviewed.json'

/** 强标记：出现即「课文在断言某件事是安静的」，默认就报 */
const STRONG = [
  '一声不响', '一声不吭', '不声不响', '悄无声息', '神不知鬼不觉',
  '悄悄', '静悄悄', '安安静静',
  '不会报错', '不报错', '也不报错', '不会拦', '不拦', '不会提醒', '不提醒',
  '不会吭声', '不吭声', '不会告诉你', '不告诉你', '不会发现',
  '一个字都没有', '一点提示都没有', '一句提示都没有', '一句抱怨都没有',
  '屏幕上什么都没有', '屏幕上没有', '没有警告', '不警告', '无警告',
  '看着能跑', '照跑不误', '照样跑', '照样能跑', '照样过', '也能过',
]

/** 弱标记：默认不报，`--all` 才放出来（这些词在正常讲解里很常见） */
const WEAK = ['看不出', '看不出来', '没反应', '不管你', '不理你', '不会说', '没人管']

/**
 * 「出错的迹象」词 —— 收紧判据用的第二把锁。
 *
 * 只按安静词数是 828 句（194 课 × 平均 4 句），没法复核。可真正会咬人的那一小撮，
 * 形状是「**在说某个错** + 说它安静」：
 *     「少了这一句，…会悄悄造出一个只在招式里管用的小罐子」  ← 少 + 悄悄
 *     「忘了套 Exception…接不住」                        ← 忘
 * 而「`list.append` 加一个元素不会报错」这类**正确性断言**（本身是对的）会被第二把锁滤掉 ——
 * 那不是本台子要找的东西。
 */
const MISTAKE = /错|漏|忘|少[了写一]|写反|坑|毛病|bug|不对|多了|反了|忘了|踩/

/**
 * 这一句是不是「在说某个错，又说它安静」？
 *
 * ⚠️ **必须先把命中的那个标记词从句子里挖掉再判**。第一版没挖，结果是过滤器空转：
 * 标记「不报错」自己就含一个「错」字，于是每一句「…不会报错」都自动通过第二把锁 ——
 * 556 条里有一大片是这么漏进来的（量出来的分布里「不报错」占 202 条，正是这个征兆）。
 * 教训和这台台子的主题一样：**判据写完得回头看它到底滤掉了什么。**
 */
const isSharp = (s, marker) => MISTAKE.test(s.split(marker).join(''))

/** 剥掉 markdown 强调/行内代码的装饰，只为让输出好读（不参与判定） */
const plain = (s) => s.replace(/\*\*/g, '').replace(/`/g, '')

/** 归一化只用于算哈希：去掉首尾空白和装饰，避免同一句因排版微调被当成新的 */
function normForHash(s) {
  return s.replace(/\s+/g, ' ').trim()
}

const sha = (s) => createHash('sha1').update(normForHash(s)).digest('hex').slice(0, 12)

/** 把一段话按句号切成句子（课文里一行常是整段，得切开才看得清是哪句在断言） */
function sentences(line) {
  return line
    .split(/(?<=[。！？])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

const args = process.argv.slice(2)
const onlyLang = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : null
const withWeak = args.includes('--all')
const wide = args.includes('--wide') // 放开第二把锁：只要说了安静就报
const markers = withWeak ? [...STRONG, ...WEAK] : STRONG

const reviewed = existsSync(REVIEWED) ? new Set(JSON.parse(readFileSync(REVIEWED, 'utf8'))) : new Set()

/** 每个待扫文件：路径 + 「怎么把内容按行摊平」 */
const files = []
for (const g of ['content/*/*/*/lesson.md', 'content/*/*/lesson.md']) {
  for (const f of globSync(g)) files.push({ path: f, kind: 'md' })
}
for (const g of ['scripts/bank/templates/*.json']) {
  for (const f of globSync(g)) files.push({ path: f, kind: 'json-line' })
}
for (const g of ['content/*/*/*/questions.json', 'content/*/*/questions.json']) {
  for (const f of globSync(g)) files.push({ path: f, kind: 'json-line' })
}
// challenge-bank 是 templates 的产物（`gen-bank.mjs` 浇出来的），扫它等于把同一句话数两遍。
// 但它也**可能**有手工补进去的题，所以只在明确要求时才扫（`--bank`）。
if (args.includes('--bank')) {
  for (const f of globSync('content/challenge-bank/*/*.json')) files.push({ path: f, kind: 'json-line' })
}

const hits = []
for (const { path, kind } of files) {
  if (onlyLang) {
    const lang = path.startsWith('content/') ? path.split('/')[1] : path
    if (!lang.includes(onlyLang)) continue
  }
  const raw = readFileSync(path, 'utf8')
  const lines = raw.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    // 🔴 JSON 里正文是**一个物理行**（换行被转义成 \n 了），句子切不开就整行当一句
    for (const s of kind === 'md' ? sentences(line) : [line]) {
      const hit = markers.find((m) => s.includes(m))
      if (!hit) continue
      // 第二把锁：默认只留「在说某个错、又说它安静」的句子（见 MISTAKE 的注释）
      if (!wide && !isSharp(s, hit)) continue
      const key = `${path}#${sha(s)}`
      if (reviewed.has(key)) {
        hits.push({ path, line: i + 1, hit, text: s, done: true })
      } else {
        hits.push({ path, line: i + 1, hit, text: s, done: false })
      }
    }
  }
}

const fresh = hits.filter((h) => !h.done)
const done = hits.filter((h) => h.done)

/** 按文件分组打印 */
function dump(list) {
  const byFile = new Map()
  for (const h of list) {
    if (!byFile.has(h.path)) byFile.set(h.path, [])
    byFile.get(h.path).push(h)
  }
  for (const [path, hs] of byFile) {
    console.log(`\n════ ${path}（${hs.length} 处）════`)
    for (const h of hs) {
      const t = plain(h.text)
      console.log(`  L${h.line} [${h.hit}] ${t.length > 170 ? t.slice(0, 170) + '…' : t}`)
    }
  }
}

console.log(`扫了 ${files.length} 个文件`)
console.log(`命中「断言安静」的句子：${hits.length} 处 —— 🆕 未复核 ${fresh.length} / ✅ 已复核 ${done.length}`)
if (!wide && !withWeak) console.log('（默认判据 = 安静词 **且** 句中有「出错的迹象」；要全量看加 --wide）')

// 按标记排个序：知道是哪几个词在撑着这个数，才知道该不该继续收窄
const hist = new Map()
for (const h of fresh) hist.set(h.hit, (hist.get(h.hit) ?? 0) + 1)
if (fresh.length) {
  console.log('\n按标记分布：')
  for (const [m, n] of [...hist].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(n).padStart(4)}  ${m}`)
}

if (fresh.length) {
  console.log('\n████████ 未复核（每一句都得真跑过才能销账）████████')
  dump(fresh)
}
if (done.length && args.includes('--done')) {
  console.log('\n──────── 已复核（--done 才列）────────')
  dump(done)
}

// 销账辅助：把当前「未复核」的键原样倒出来，人工确认真跑过之后再合并进 REVIEWED。
// **不自动写入** —— 自动写就等于「跑一遍就销账」，那正是这台台子要防的事。
if (args.includes('--snapshot')) {
  const out = 'scripts/审计/_silence-snapshot.json'
  writeFileSync(out, JSON.stringify([...fresh.map((h) => `${h.path}#${sha(h.text)}`)], null, 2))
  console.log(`\n（快照已写 ${out}：${fresh.length} 条。复核完再手工并进 ${REVIEWED}）`)
}

// 机器可读的清单 —— 给「成批复核」用。
// 键就用脚本自己算的那个（`path#sha(text)`），不另写一份算法：
// 抄一份算法出来迟早会和主体漂开，销账就会对不上号。
if (args.includes('--json')) {
  const out = 'scripts/审计/_silence-list.json'
  writeFileSync(out, JSON.stringify(fresh.map((h) => ({
    key: `${h.path}#${sha(h.text)}`,
    path: h.path, line: h.line, marker: h.hit, text: plain(h.text),
  })), null, 2))
  console.log(`\n（清单已写 ${out}：${fresh.length} 条）`)
}
