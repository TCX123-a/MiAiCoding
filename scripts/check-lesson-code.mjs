#!/usr/bin/env node
/**
 * 课程代码范例真跑台 —— 把 lesson.md 里的代码块**在本机真跑一遍**，和课文写的输出逐行对照。
 *
 * 【为什么必须跑】
 * 课文里的代码是零基础学员唯一会照着敲的东西。一个代码块里少个分号、或者输出写错一位，
 * 学员照着敲就会撞上一个我们没解释过的报错，而他根本无从判断是自己错了还是课文错了。
 * 光靠人眼读稿抓不住 —— 本喵自己写课的时候就漏过。
 *
 * 【判什么】
 * 只判「能自己跑起来、并且课文写明了输出」的代码块：
 *   · 块后面紧跟着一个 ```text 块 → 那个 text 就是**声称的输出**，逐行比对
 *   · 不是完整程序（C/C++ 没有 main、Java 没有 class、Python 没有输出对照）→ 跳过，且**打印出来**
 * 跳过的必须打印。静默跳过等于把「没验过」伪装成「验过了」。
 *
 * 【compare 块】
 * 四语言对照块会被**拆成各语言分段逐个真跑**，再判「各段输出逐字相同」——
 * 那正是对照块对学员的承诺：「气质不同，做的都是同一件事」。
 * （从前它被 `if (!LANGS[b.lang]) continue` 静默丢掉了，见 checkCompareBlock 的注释。）
 *
 * 【两条铁律，抄自 scripts/审计/audit_errorlib.py（违反了这个台子测出来的东西就不作数）】
 *   1. 编译/运行参数必须和应用**逐字一致** —— 抄自 src/main/runner/runner.ts 的 planForLang()
 *   2. 输出解码必须和应用**逐字一致** —— 抄自 runner.ts 的 decodeOutput()
 *      （UTF-8 严格 → GBK 严格 → latin1。javac 的报错按系统本地编码写出来，
 *       中文 Windows 上是 GBK，拿 UTF-8 硬解会把中文全变成问号。）
 *
 * 用法：
 *   node scripts/check-lesson-code.mjs                     # 跑全部已生成的课
 *   node scripts/check-lesson-code.mjs common-13           # 只跑一课（大纲课号）
 *   node scripts/check-lesson-code.mjs 13-one-row-data     # 只跑一课（目录名，一样认）
 *   node scripts/check-lesson-code.mjs --list              # 只列代码块，不跑
 * 过滤不到任何课时**报错退出 2**，不会安静地跑完 0 个块还报绿。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, globSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// 编译/运行参数、输出解码、真跑一次 —— 全在 scripts/lib/run-code.mjs。
// 那是**唯一的抄写处**，本文件和 scripts/check-question-code.mjs 共用一份：
// 两条链路跑同一份代码，参数差一个字结论就相反（内容侧说跑得通，学员那边编不过）。
import { LANGS, decodeOutput, runBlock } from './lib/run-code.mjs'

const ROOT = process.cwd()
const RUN_MARK = '```'

/**
 * 「这段要联网」的标记 —— 写在围栏信息串里，形如 ```python 需要联网。
 *
 * 【为什么需要这个标记，而不是让它一直红着】
 * `python/stage3/13-third-party-libs` 教 `requests`，那段代码**真的去 example.com 要页面**，
 * 声称的输出是 `200 / 404`。本机走代理时它直接抛 `urllib3._prepare_proxy` 的 Traceback，
 * 于是这道闸门**永远红着一条**。
 *
 * 而这条红**修不掉**：断网就抛异常、联网才有 200/404，它天生不可复现。
 * 项目铁律说「静默跳过 = 把「没验过」伪装成「验过了」」——
 * 但反过来「明知测不了还让它红着」同样有害：一条永远红的闸门，
 * 会训练人**习惯性忽略**这个工具，那时它漏掉的真问题也没人看了。
 *
 * 所以给它一条**明说的**出路：课文自己标上「需要联网」，闸门打印出来、
 * 单独记一栏、不混进「验过了」。既不伪装，也不装死。
 *
 * ⚠️ 标记是**课文自己写的声明**，闸门不猜。没标就照跑 —— 想靠加个词把红变绿，
 * 得先在这一行字上写下「这段要联网」，那是留痕的。
 */
const NET_MARK = '需要联网'

// 【原先这里长着 LANGS 和 decodeOutput 两份抄写，2026-09-15 搬去了 scripts/lib/run-code.mjs】
// 搬家的原因见那个文件开头：第三条真跑链路（check-question-code.mjs）也需要同一份参数，
// 再抄一遍就是三份，而三份里只要有一份漂了，就会得到「三个工具三种结论」。

/**
 * 把一个 lesson.md 切成代码块：[{lang, body, line, endLine, openLine}]
 *
 * `line` 是**闭合**围栏的行号（下游 claimedOutput 靠它往后找 ```text），
 * `openLine` 是**开启**围栏的行号 —— 报位置时用这个，报闭合行会让人往前翻半天。
 */
function parseBlocks(text) {
  const lines = text.split(/\r?\n/)
  const blocks = []
  let lang = null
  let flags = []
  let openLine = 0
  let buf = []
  lines.forEach((line, i) => {
    if (line.startsWith(RUN_MARK)) {
      if (lang === null) {
        // 围栏信息串可能是 `python 需要联网` —— **第一个词是语言，后面的词是标记**。
        // 渲染器（`src/renderer/src/lib/md.ts:140`）也只取第一个词，两边规则一致；
        // 这里若把整串当语言，`LANGS['python 需要联网']` 是 undefined，
        // 那块代码会**一声不吭地消失**（既不跑、也不算跳过）—— 正是最坏的那种漏。
        const info = line.slice(RUN_MARK.length).trim()
        const 词 = info.split(/\s+/).filter(Boolean)
        lang = 词[0] ?? ''
        flags = 词.slice(1)
        openLine = i + 1
        buf = []
      } else {
        blocks.push({ lang, flags, body: buf.join('\n'), line: i + 1, endLine: i + 2, openLine })
        lang = null
        flags = []
      }
    } else if (lang !== null) {
      buf.push(line)
    }
  })
  return blocks
}

/** 行尾空白和结尾空行不算差异；中间的空行差异算（多一行空行学员会以为出错了） */
function normalize(s) {
  return s
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n+$/, '')
}

/**
 * 代码块和它后面那个 ```text 之间，**没有隔着段落级的分隔**吗？
 *
 * 判「后面那个 ```text 就是这段代码声称的输出」时，光看「数组里的下一个块」不够 ——
 * 那样会把隔了十万八千里的下一个 text 块也算进来。但**也不能只看「中间是不是全空行」**：
 *
 * 判据是「中间有没有**结构边界**」：
 *   · 普通的一句话 = **引出**（「翻译官喵当场犯难：」→ 下面贴报错），照样算声称的输出
 *   · `##` 小标题 / `:::` 提示框 = **另起一段**，隔过去的东西就不属于这个代码块了
 *
 * 两个方向都踩过，所以判据只能取「结构边界」，取「距离」两边都会错：
 *   · 太松（只看「下一个块」）：common-01 的 compare 块闭合于 L95，中间隔着
 *     `::: tip` + `::: warn` + `## 小任务`，L111 那个 ```text 其实是**小任务**里的
 *     记事本练习，被当成了对照块的输出 → 报出「课文说本喵今天开始学编程啦，
 *     实际是你好，喵！」这条**完全虚构**的不达标。
 *   · 太紧（要求中间全空行）：java/stage1/16 的报错演示，```text 前面隔着一句
 *     「翻译官喵当场犯难：」→ 对照被丢掉 → 报错演示掉进普通块分支 → 它**本来就编不过**
 *     → 报出一条**假失败**。
 *
 * ⚠️ 顺带修掉一个差一行：从前 `endLine = i+2` 被当成 0-based 下标用，
 * 而闭合围栏的 0-based 下标是 i、紧跟它那行是 i+1 —— 起点整体晚了一行。
 * `a.line`（= 闭合围栏的 1-based 行号）正好等于「紧跟那行」的 0-based 下标。
 */
function gapKind(lines, a, b) {
  let prose = false
  for (let n = a.line; n < b.openLine - 1; n++) {
    const l = (lines[n] ?? '').trim()
    if (!l) continue
    if (/^#{1,6}\s/.test(l) || l.startsWith(':::')) return 'section'
    prose = true
  }
  return prose ? 'prose' : 'adjacent'
}

/**
 * 从代码块**后面的那段话**里读出「课文声称的输出」。
 *
 * 课文有两种写法，两种都得认：
 *   ① 紧跟一个 ```text 块           → 块里的内容就是输出（多行）
 *   ② 紧接着的那一句话里写「输出 `X`」→ 行内代码就是输出（「输出 `7` 和 `1`。」= 两行）
 *
 * 【为什么只看第一句】
 * 「输出 `3`。`append` 是「再塞一格」的招式……」——后面那些行内代码是**正文里的名词**，
 * 不是输出。只取第一个句号之前的行内代码，才不会把它们当成输出拿去比对。
 * 判不出来的（没有「输出」二字）返回 null —— 那就只跑不比对，别硬猜；
 * 猜错了会报一堆假失败，假失败比不检查更坏。
 *
 * 【```text 认领规则：按「中间隔着什么」分三档】
 *   · 紧贴围栏（中间只有空行）→ **认**，这就是声称的输出
 *   · 隔着普通散文          → **只有当那段 text 是报错原话时才认**
 *   · 隔着 `##` / `:::`      → 一律不认
 *
 * 中间那档为什么这样切：课文里「贴报错」有个固定写法 —— 先一句引出
 * （「翻译官喵当场犯难：」），再贴编译器的原话。所以散文后面跟着报错，是引出；
 * 散文后面跟着**不是报错**的东西，那就是在讲别的事了。
 *
 * 三档全都是踩出来的，少一档就错一边：
 *   · 只认「数组里的下一个块」（太松）→ common-01 的对照块认领了 16 行外小任务的
 *     记事本练习，报出「课文说本喵今天开始学编程啦，实际是你好，喵！」这条**虚构**的不达标。
 *   · 改成「中间必须全空行」（太紧）→ java/stage1/16 的报错演示，```text 前面隔着
 *     「翻译官喵当场犯难：」→ 对照丢掉 → 掉进普通块分支 → 它**本来就编不过** → **假失败**。
 *   · 再改成「普通散文一律算引出」（还是太松）→ common-04 的 `fish = 3` 后面隔了一整段
 *     讲解，接着是「四门语言怎么声明罐子」的**对照** ```text，被当成 `fish = 3` 的输出，
 *     报出「课文说 C int fish = 3...，实际是空」。← 就是这一档逼出来的。
 */
function claimedOutput(blocks, i, text) {
  const lines = text.split(/\r?\n/)
  const next = blocks[i + 1]
  if (next && next.lang === 'text') {
    const claim = normalize(next.body)
    const gap = gapKind(lines, blocks[i], next)
    if (gap === 'adjacent') return claim
    if (gap === 'prose' && looksLikeCompilerOutput(claim)) return claim
  }

  /*
   * 行内写法：紧跟的那一句「输出 `X`」。
   *
   * ⚠️ 空行**必须跳过，不能当终止符**。课文里两种排版都有：
   *   围栏 / 空行 / 输出 `3`。      ← 13-one-row-data 就是这种（5 处）
   *   围栏 / 输出 `3`。            ← 挨着写
   * 从前起点晚一行（见上），刚好跳过空行落在前一种上，于是**挨着写的那种会被静默跳过** ——
   * 判成「课文没写对照」，混进「跑通了」那一栏，看起来还是绿的。
   * 反过来我第一版把起点改早一行又不跳空行，前一种全丢了 —— 19 对得上掉到 7。
   * 现在起点取「紧跟围栏那一行」+ 空行一律跳过，两种排版都认。
   */
  for (let n = blocks[i].line; n < lines.length; n++) {
    const line = lines[n].trim()
    if (!line) continue
    if (line.startsWith('```')) break
    if (/^#{1,6}\s/.test(line) || line.startsWith(':::')) break // 另起一段了，别越界去认领
    if (!line.startsWith('输出')) return null
    const firstSentence = line.split(/[。；]/)[0]
    const spans = [...firstSentence.matchAll(/`([^`]+)`/g)].map((m) => m[1])
    return spans.length ? spans.join('\n') : null
  }
  return null
}

/**
 * 这个 text 块是在演示**报错**吗？
 *
 * 课文里有两种 text 块，意思完全相反：
 *   · 正常运行输出 → 「这段代码跑出来是什么」
 *   · 编译器原话   → 「这段代码**故意跑不起来**，报错长这样」
 * 后者更要验：课文把 javac / gcc 的原话抄了进去，
 * 哪天工具链换了措辞，课文就在教一句不存在的话 —— 而那正是学员会去搜的东西。
 * 所以演示报错的块，判的是「**确实失败了，且课文引的那几句原话真出现了**」。
 */
function looksLikeCompilerOutput(text) {
  return /error:|Traceback|Exception|fatal error/.test(text)
}

/** 逐行去掉两端空白再比；只有 ^ 的定位行是排版噪音（对齐用的空格数会变），跳过 */
function outputLines(s) {
  return normalize(s)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !/^\^+$/.test(l))
}

/**
 * 片段能不能单独做一次**语法检查**？
 *
 * 课文里大量片段是「招式」或「图纸」，不是完整程序，跑不起来 —— 但它们仍会被学员照着敲。
 * 判据：最后一行是 `}` 或 `};`（闭合的声明/招式），就能当前作用域下的一个声明来编译。
 * 只做 `-fsyntax-only`：**不要求它跑得通，只要求它语法上立得住**。
 * 招式里用到别处定义的东西，在 C 里只是 warning，不会误判成错。
 */
function fragmentCheckable(lang, body) {
  if (lang !== 'c' && lang !== 'cpp') return false
  const t = body.trim()
  // 两种收尾都算闭合：
  //   · 招式结尾 `}`             —— 例：`Node *new_node(int x) { ... }`
  //   · 图纸结尾 `} Node;`       —— 例：`typedef struct Node { ... } Node;`
  //     这里不能只写 `\} *;?`：`} Node;` 的 } 和 ; 中间还夹着外号，漏掉它就等于
  //     白白少验一块代码（本课第一块图纸就是这么被跳过的）。
  return /\}\s*;?\s*$/.test(t) || /\}\s*[A-Za-z_][A-Za-z0-9_]*\s*;\s*$/.test(t)
}

function syntaxCheck(lang, fragment, prelude) {
  const dir = mkdtempSync(join(tmpdir(), 'miai-frag-'))
  const ext = lang === 'c' ? 'c' : 'cpp'
  const file = `frag.${ext}`
  try {
    writeFileSync(join(dir, file), `${prelude}\n${fragment}\n`, 'utf8')
    const cc = lang === 'c' ? 'gcc' : 'g++'
    execFileSync(cc, ['-finput-charset=UTF-8', '-fsyntax-only', file], { cwd: dir, timeout: 60_000, stdio: 'pipe' })
    return { ok: true, output: '' }
  } catch (e) {
    return { ok: false, output: `${decodeOutput(e.stderr)}${decodeOutput(e.stdout)}` }
  } finally {
    // 同 scripts/lib/run-code.mjs：刚退出的子进程偶尔还占着句柄，删不掉不该让整条闸门崩
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // 残留临时目录交给系统清理
    }
  }
}

// 【原先这里长着 runBlock()，2026-09-15 搬去了 scripts/lib/run-code.mjs】
//
// ⚠️ 搬家时**顺手改掉了 Java 的一处写死**：原来这里恒定写 `Main.java`，
// 而应用是从代码里抠类名（`runner.ts` 的 `findJavaClass()`）。课文里的示例碰巧
// 全都叫 `Main`，所以这个偏差一直没露馅 —— 但它是真的：哪篇课文写个 `class Cat`，
// 应用能跑、这里会报「class Cat is public, should be declared in a file named Cat.java」，
// 而那看起来像**课文写错了**。现在两条链路都走 `planForLang()`，抠出来的名字一定一样。

/**
 * 拆开一个 compare 块，取出各语言分段。
 *
 * ⚠️ 分段规则必须和 scripts/content-validate.mjs 的 checkCompareBlock **逐字一致**
 * （那边是 `code.split(/^(\w+)::\s*$/m)`）。两个工具按两套规矩读同一块代码，
 * 就会出现「校验器说合法、跑台说解析失败」这种互相打架的结论，比不检查还坏。
 *
 * 注意那边允许**两种以上**语言即可（没硬编码 4 种），这里也照办 —— 有几段跑几段。
 */
function parseCompare(body) {
  const sections = body.split(/^(\w+)::\s*$/m)
  const out = []
  if (sections[0].trim()) return { error: `compare 块开头有杂质：${JSON.stringify(sections[0].trim().slice(0, 40))}` }
  for (let i = 1; i < sections.length; i += 2) {
    const lang = sections[i]
    const code = sections[i + 1].replace(/\s+$/, '')
    if (!LANGS[lang]) return { error: `compare 块里有跑不了的语言：${lang}（只认 ${Object.keys(LANGS).join('/')}）` }
    if (!code.trim()) return { error: `compare 块 ${lang} 段为空` }
    out.push({ lang, code })
  }
  if (out.length < 2) return { error: 'compare 块至少要两种语言才叫「对照」' }
  return { sections: out }
}

/**
 * 四语言对照块：拆开**逐个真跑**，然后判三件事。
 *
 * 【为什么原来这里是空的】
 * 主循环原先第一句是 `if (!LANGS[b.lang]) continue`，而 LANGS 里没有 compare 这个键，
 * 于是整个对照块被**静默丢掉**：不跑、不列、不计数，连 `--list` 都藏（那句 continue
 * 卡在 listOnly 判断**之前**）。实测 13-one-row-data 的 L116-153 一行都没出现过。
 *
 * 这恰恰是本文件第 14 行自己骂过的事：「静默跳过等于把『没验过』伪装成『验过了』」。
 * 而 compare 是零基础学员**最会挨个照抄**的块 —— 四门语言并排摆着，谁都想试一遍。
 *
 * 判什么：
 *   ① 每一段都跑得起来（少个分号、Java 类名写错，只有真跑才抓得住）
 *   ② 各段输出**逐字相同** —— 这正是对照块对学员的承诺：「气质不同，做的都是同一件事」。
 *      输出不一样，课文那句话就是假的。
 *   ③ 后面若跟了 ```text（或「输出 `X`」），还得等于它
 */
function checkCompareBlock(b, claims, lessonId) {
  const head = `  L${b.openLine} [compare]`
  const parsed = parseCompare(b.body)
  if (parsed.error) {
    console.log(`${head} ✗ ${parsed.error}`)
    fail++
    failures.push({ id: lessonId, line: b.openLine, lang: 'compare', why: parsed.error, got: '', want: null })
    return
  }
  const secs = parsed.sections

  /*
   * 「报错演示 + 对照块」这个组合**判不了**，因为四门语言报的错长得完全不一样：
   * gcc 说 error: expected ';'，Python 甩一段 Traceback，javac 又是另一套措辞。
   * 拿课文引的那几句去比，只有它本来抄的那一门能对上，另外三门必然「对不上」——
   * 那不是课文错了，是**这么比本身就没道理**。
   * 但这属于「没验」，不属于「验过了」：必须打印出来，不许闷声。
   */
  if (claims && looksLikeCompilerOutput(claims)) {
    console.log(`${head} ⬜ 跳过：这是「报错演示」，四门语言的报错原话不可能相同，没法逐行比对`)
    console.log(`        涉及语言：${secs.map((s) => s.lang).join(' / ')}`)
    skip++
    return
  }

  const results = secs.map((s) => ({ lang: s.lang, ...runBlock(s.lang, s.code) }))
  compareBlocks++
  comparePrograms += results.length

  // ① 每一段都得跑起来
  const broken = results.filter((r) => !r.ok)
  if (broken.length) {
    console.log(`${head} ✗ ${broken.length}/${results.length} 段跑不起来：${broken.map((r) => r.lang).join(', ')}`)
    for (const r of broken) {
      console.log(`        [${r.lang}] ${r.phase} 阶段：`)
      console.log(
        r.output
          .split('\n')
          .slice(0, 6)
          .map((l) => `        | ${l}`)
          .join('\n')
      )
    }
    fail++
    failures.push({
      id: lessonId, line: b.openLine, lang: 'compare',
      why: `${broken.map((r) => r.lang).join('/')} 段跑不起来`,
      got: broken.map((r) => `[${r.lang}] ${r.output}`).join('\n'), want: claims
    })
    return
  }

  // ② 各段输出必须逐字相同
  const outs = results.map((r) => ({ lang: r.lang, out: normalize(r.output) }))
  const first = outs[0]
  if (outs.some((o) => o.out !== first.out)) {
    console.log(`${head} ✗ 各语言输出不一样 —— 对照块承诺的是「做的都是同一件事」，那就得输出逐字相同`)
    for (const o of outs) console.log(`        ${o.lang.padEnd(7)} ${JSON.stringify(o.out.slice(0, 100))}`)
    fail++
    failures.push({
      id: lessonId, line: b.openLine, lang: 'compare',
      why: '各语言输出不一致', got: outs.map((o) => `[${o.lang}] ${o.out}`).join('\n'), want: first.out
    })
    return
  }

  // ③ 有对照就跟对照比
  if (claims) {
    if (first.out === claims) {
      console.log(`${head} ✓ ${outs.length} 门语言全部真跑通，输出逐字相同，且和课文写的一致`)
      pass++
    } else {
      console.log(`${head} ✗ ${outs.length} 门语言输出彼此一致，但和课文写的不一样`)
      console.log(`        课文说：${JSON.stringify(claims.slice(0, 160))}`)
      console.log(`        实际是：${JSON.stringify(first.out.slice(0, 160))}`)
      fail++
      failures.push({ id: lessonId, line: b.openLine, lang: 'compare', why: '输出不一致', got: first.out, want: claims })
    }
    return
  }

  console.log(
    `${head} ✓ ${outs.length} 门语言全部真跑通，输出逐字相同（课文没写机器能读的对照，未比对）  ` +
      `实际输出：${JSON.stringify(first.out.slice(0, 60))}`
  )
  ran++
  uncompared.push({ id: lessonId, line: b.openLine, lang: `compare(${outs.map((o) => o.lang).join('+')})`, got: first.out })
}

const args = process.argv.slice(2)
const listOnly = args.includes('--list')
const only = args.find((a) => !a.startsWith('--'))

const lessonFiles = globSync('content/*/*/*/lesson.md', { cwd: ROOT })
  .concat(globSync('content/*/*/lesson.md', { cwd: ROOT }))
  .sort()

if (lessonFiles.length === 0) {
  console.error('找不到任何 lesson.md —— 路径约定变了？')
  process.exit(2)
}

/*
 * ⚠️ 课号有两种叫法，过滤必须两种都认。
 *
 * 大纲里的课号是 `common-13`（连字符），磁盘上是 `common/13-one-row-data/`（斜杠）。
 * 从前这里只做 `id.includes(only) || norm.includes(only)`，两边都不含 `common-13`，
 * 于是 `node scripts/check-lesson-code.mjs common-13` —— **本文件第 24 行自己推荐的用法** ——
 * 一节课都不跑，还安安静静 exit 0。使用者看到的是「跑完了，没问题」。
 * 这正是本文件从头到尾在骂的那件事：静默跳过等于把「没验过」伪装成「验过了」。
 */
const flatId = (rel) =>
  rel
    .replace(/\\/g, '/')
    .replace(/^content\//, '')
    .replace(/\/lesson\.md$/, '')
    .split('/')
    .join('-')
const matches = (rel, q) => rel.includes(q) || flatId(rel).includes(q)

// ⚠️ 不传过滤条件时必须**复制**一份：`picked = lessonFiles` 拿到的是同一个数组引用，
// 下面那句 `lessonFiles.length = 0` 会把 picked 一起清空 —— 表现是「一节课都不跑，还 exit 0」，
// 和这个洞原本的症状一模一样。踩过一次。
const picked = only ? lessonFiles.filter((f) => matches(f.replace(/\\/g, '/'), only)) : [...lessonFiles]
if (only && picked.length === 0) {
  console.error(`✗ 没有一节课匹配「${only}」—— 一个块都没跑。`)
  console.error('  可用的课号（扁平写法）：')
  for (const f of lessonFiles) console.error(`    ${flatId(f.replace(/\\/g, '/'))}`)
  process.exit(2)
}
lessonFiles.length = 0
lessonFiles.push(...picked)

let pass = 0
let ran = 0 // 跑通了、但课文没写机器能读懂的输出，没得比 —— 单独一栏，别混进「输出对得上」
let fail = 0
let skip = 0
// 课文自己标了「需要联网」的那些：单独一栏，绝不并进 pass / skip ——
// 并进 pass 就是把「没验过」伪装成「验过了」，并进 skip 又看不出「为什么没跑」。
let needsNet = 0
// 对照块单独记账：从前它们**一块都没被数到过**（静默丢弃），这两栏就是「洞补上了」的证据
let compareBlocks = 0
let comparePrograms = 0
const failures = []
const uncompared = []

for (const rel of lessonFiles) {
  const norm = rel.replace(/\\/g, '/')
  const id = norm.split('/').slice(-2, -1)[0]
  // 过滤已经在上面做完了（那份还会在匹配不到时大声报错）。
  // 这里从前还有一道同款旧过滤，两处判断标准不一样 —— 修了上面漏了下面，
  // 表现就是「过滤器改了，还是什么都不跑」，白查一轮。

  const text = readFileSync(join(ROOT, rel), 'utf8')
  const blocks = parseBlocks(text)
  console.log(`\n═══ ${id}  (${norm}) ═══`)

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]

    /*
     * ── 四语言对照块 ──
     * 从前这里是 `if (!LANGS[b.lang]) continue`，把 compare 整块静默丢掉了（见 checkCompareBlock 的注释）。
     * 现在它在 LANGS 判断**之前**被拦下来单独处理，所以 `--list` 也看得见它了。
     */
    if (b.lang === 'compare') {
      const cc = claimedOutput(blocks, i, text)
      if (listOnly) {
        const p = parseCompare(b.body)
        console.log(
          `  L${b.openLine} compare  ` +
            (p.error ? `✗ ${p.error}` : `${p.sections.map((s) => s.lang).join('/')}${cc ? '  有输出对照' : '  无输出对照'}`)
        )
        continue
      }
      checkCompareBlock(b, cc, id)
      continue
    }

    if (!LANGS[b.lang]) continue
    const claims = claimedOutput(blocks, i, text)

    if (listOnly) {
      console.log(`  L${b.line} ${b.lang}  ${claims ? '有输出对照' : '无输出对照'}`)
      continue
    }

    const head = `  L${b.line} [${b.lang}]`

    // 课文自己声明了「这段要联网」→ 不跑，但**大声记一笔**（理由见 NET_MARK 那段注释）。
    // 放在最前面：联网与否跟它是不是完整程序无关，先判这个，省得走完下面一堆再回头。
    if (b.flags?.includes(NET_MARK)) {
      console.log(`${head} ⬜ 跳过：课文标了「${NET_MARK}」—— 它的输出取决于外面的世界，本机验不了`)
      needsNet++
      continue
    }

    // 不是完整程序就没法单独跑 —— 这类必须打印出来，别让它混进"验过了"
    const complete =
      b.lang === 'python' ? true : b.lang === 'java' ? /class\s/.test(b.body) : /int\s+main\s*\(/.test(b.body)
    if (!complete) {
      if (!fragmentCheckable(b.lang, b.body)) {
        console.log(`${head} ⬜ 跳过：是半截代码（不是完整程序，也没闭合），没法单独编译`)
        skip++
        continue
      }
      // 片段：只验「照着敲下去语法立不立得住」，不验输出。
      //
      // 前置部分 = 标准头文件 + **这一块之前的所有片段**，模拟学员从上往下敲的过程：
      // 后面的招式要用前面已经敲好的图纸和招式，只给图纸不给招式，就会撞上
      // 「implicit declaration of function」（GCC 14 起这是 error，不是 warning）。
      //
      // 两个坑，都踩过：
      //   · 前置部分绝不能把**完整程序**也拼进来 —— 里面的招式会和片段里的重名，
      //     报一串 redefinition 假失败。（所以下面要显式排掉带 int main 的块。）
      //   · 「含 typedef」不等于「是图纸」：完整程序里那一行 typedef 也满足。
      //     判据得是「这一块**开头就是** typedef」。
      const prelude = ['#include <stdio.h>', '#include <stdlib.h>', '#include <string.h>']
        .concat(
          blocks
            .slice(0, i)
            .filter((x) => x.lang === b.lang)
            .filter((x) => !/int\s+main\s*\(/.test(x.body))
            .filter((x) => /^\s*typedef\s+struct/.test(x.body.trim()) || fragmentCheckable(x.lang, x.body))
            .map((x) => x.body)
        )
        .join('\n')
      const s = syntaxCheck(b.lang, b.body, prelude)
      if (s.ok) {
        console.log(`${head} ✓ 片段：语法立得住`)
        pass++
      } else {
        console.log(`${head} ✗ 片段：语法就有问题`)
        console.log(
          s.output
            .split('\n')
            .filter((l) => l.includes('error'))
            .slice(0, 4)
            .map((l) => `        | ${l}`)
            .join('\n')
        )
        fail++
        failures.push({ id, line: b.line, lang: b.lang, why: '片段语法检查失败', got: s.output, want: null })
      }
      continue
    }

    // 完整程序一律真跑 —— 「能不能跑起来」本身就是必须守住的底线，
    // 和课文写没写输出无关。缺分号、少括号这种事，只有真跑才抓得住。
    const r = runBlock(b.lang, b.body)

    // 演示报错的块：期望的**失败**，且课文引的原话要真出现
    if (claims && looksLikeCompilerOutput(claims)) {
      if (r.ok) {
        console.log(`${head} ✗ 课文说这段会报错，可它居然跑通了`)
        fail++
        // ⚠️ 这里原本写的是 `got`，而 `got` 要到九百多行的下面（`const got = normalize(r.output)`）
        // 才声明 —— `const` 在声明前是暂时性死区，引用即 `ReferenceError: Cannot access 'got'
        // before initialization`。后果不是「这一块红一道」，是**整支闸门当场断掉**，后面的课一块都不验，
        // 看起来却像是「跑过了」。触发条件：课文引了带 `error:` 的原话，可那块代码在跑台上其实跑得通
        // （java 写手实踩：`class Cat is public...` 是 javac 的 error: 前缀，跑台又按类名重命名文件）。
        // 这里 `r.ok` 为真，实际拿到的就是它的正常输出 —— 用 `r.output` 才是诚实的「实际是」。
        // 2026-09-16 修。改动只把「崩溃」换成「如实红一道」，不改变任何不崩的块的判定。
        failures.push({ id, line: b.line, lang: b.lang, why: '课文说会报错，实际跑通', got: r.output, want: claims })
        continue
      }
      const gotLines = outputLines(r.output)
      const missing = outputLines(claims).filter((w) => !gotLines.includes(w))
      if (missing.length) {
        console.log(`${head} ✗ 报错演示和真实报错对不上`)
        for (const m of missing.slice(0, 3)) console.log(`        课文有、实际没有：${m.slice(0, 90)}`)
        fail++
        failures.push({ id, line: b.line, lang: b.lang, why: '报错演示的原话对不上', got: r.output, want: claims })
      } else {
        console.log(`${head} ✓ 报错演示：确实失败，课文引的原话一字不差`)
        pass++
      }
      continue
    }

    if (!r.ok) {
      console.log(`${head} ✗ ${r.phase} 阶段就跑不起来`)
      console.log(
        r.output
          .split('\n')
          .slice(0, 6)
          .map((l) => `        | ${l}`)
          .join('\n')
      )
      fail++
      failures.push({ id, line: b.line, lang: b.lang, why: `${r.phase} 阶段失败`, got: r.output, want: claims })
      continue
    }

    const got = normalize(r.output)
    if (!claims) {
      console.log(`${head} ✓ 跑通了（课文没写机器能读的输出，未比对）  实际输出：${JSON.stringify(got.slice(0, 60))}`)
      ran++
      uncompared.push({ id, line: b.line, lang: b.lang, got })
      continue
    }

    if (got === claims) {
      console.log(`${head} ✓ 输出对得上`)
      pass++
    } else {
      console.log(`${head} ✗ 输出和课文写的不一样`)
      console.log(`        课文说：${JSON.stringify(claims.slice(0, 160))}`)
      console.log(`        实际是：${JSON.stringify(got.slice(0, 160))}`)
      fail++
      failures.push({ id, line: b.line, lang: b.lang, why: '输出不一致', got, want: claims })
    }
  }
}

if (listOnly) process.exit(0)

console.log(`\n${'═'.repeat(60)}`)
console.log(`  ✓ 跑通且输出对得上        ${pass}`)
console.log(`  ✓ 跑通了、课文没写输出对照  ${ran}   ← 验的是「能跑起来」，不是「输出对不对」`)
console.log(`  ✗ 有问题                  ${fail}`)
console.log(`  ⬜ 没跑（片段，不是完整程序） ${skip}`)
if (needsNet)
  console.log(`  🌐 没验（课文标了「需要联网」） ${needsNet}   ← 不是通过，是**没法验**：输出取决于外面的世界`)
if (compareBlocks)
  console.log(`  🔍 其中四语言对照块        ${compareBlocks} 块 / ${comparePrograms} 个小程序真跑 ← 从前这一栏恒为 0`)
if (failures.length) {
  console.log('\n有问题的清单：')
  for (const f of failures) console.log(`  · ${f.id} L${f.line} (${f.lang}) ${f.why}`)
}
if (uncompared.length) {
  console.log('\n没得比对的（课文只写了「输出是……」这种散文，没有机器能读的对照）：')
  for (const u of uncompared) {
    console.log(`  · ${u.id} L${u.line} (${u.lang}) 实际输出 ${JSON.stringify(u.got.replace(/\n/g, ' | ').slice(0, 80))}`)
  }
}
process.exit(fail === 0 ? 0 : 1)
