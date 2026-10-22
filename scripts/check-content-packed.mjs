#!/usr/bin/env node
/**
 * 端到端闸门：**源码里写的演示块，真的进到应用包里了吗？**
 *
 * ── 为什么非要有这一条（这是一次真实事故的补丁）──
 * 2026-09-27，主人点开 C 课「for 与 while——绕鱼干跑圈」，**一个演示都没有**。
 * 查下来：`content/**` 里写着 184 块演示，`out/` 里那个真正被 Electron 加载的
 * `index-*.js` 里只有 45 块 —— 应用装的是**几天前的内容**。
 *
 * 漏洞出在链子上：
 *
 *     content/**<lesson.md>   （源码，真的住在这里）
 *          ↓  npm run build:content         ← 这一步**不是** npm run build 的一部分
 *     src/renderer/src/generated/content-bundle.json
 *          ↓  npm run build                 ← 只干这件事：把现成的 JSON 打进包
 *     out/renderer/assets/index-*.js       （应用真正读的东西）
 *
 * 也就是说：**改了课文、只跑 `npm run build`，打进包的是旧内容，而且一声不吭。**
 * 四道闸门全绿 —— 它们验的是 `content/`，验的不是「包里有」。
 * 这正是第一铁律说的那种失败：*把「没验过」伪装成「验过了」*。
 *
 * 所以这条闸门**从源码数到包**，三处对齐：
 *   ① 逐课：`content/**／lesson.md` 的围栏数  ＝  bundle 里那一课正文的围栏数
 *   ② 总数：`out/renderer/assets/index-*.js` 里的围栏数 ＝ 源码总数
 *   ③ 课数：bundle 里的课数 ＝ 源码的课数（防止「漏课」这种更钝的漏法）
 *
 * ── 怎么证明这条闸门不是摆设 ──
 * 它会红，而且红得具体（点名哪一课、差几块）。反向验证：
 *   · 把 content 里某一课复制一份到临时位置、往 bundle 里塞一块假演示 → 逐课那条要红
 *   · 或者直接 `MIAI_PACK_PLANT_BAD=1 node scripts/check-content-packed.mjs` 走内置种坏值
 * 详见本文件末尾的「种坏值」实现。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const 根 = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const 内容根 = join(根, 'content')
const 包文件 = join(根, 'src', 'renderer', 'src', 'generated', 'content-bundle.json')
const 产物目录 = join(根, 'out', 'renderer', 'assets')

const 种坏值 = process.env.MIAI_PACK_PLANT_BAD === '1'

const 红 = []
const 报 = (msg) => 红.push(msg)

// ── 真值来源①：源码 ──
function 扫源码(dir, 表) {
  for (const 名 of readdirSync(dir)) {
    const 全 = join(dir, 名)
    if (statSync(全).isDirectory()) 扫源码(全, 表)
    else if (名 === 'lesson.md') {
      const 文 = readFileSync(全, 'utf8')
      const m = 文.match(/^---\r?\n([\s\S]*?)\r?\n---/)
      if (!m) {
        报(`${relative(根, 全)}：没有 frontmatter —— 这课根本没被算进来，闸门会漏。`)
        continue
      }
      const id = (m[1].match(/^id:\s*(.+)$/m) || [])[1]
      if (!id) {
        报(`${relative(根, 全)}：frontmatter 里没有 id。`)
        continue
      }
      表.set(id.trim(), {
        文件: relative(根, 全),
        围栏数: 文.split(/\r?\n/).filter((l) => l.trim() === '```demo').length
      })
    }
  }
}
const 源码 = new Map()
扫源码(内容根, 源码)

if (源码.size === 0) {
  console.error('content/ 里一节课都没扫到 —— 路径不对，闸门不产出任何结论。')
  process.exit(2)
}

// ── 真值来源②：内容包 ──
if (!existsSync(包文件)) {
  console.error(`内容包不存在：${relative(根, 包文件)}\n先跑 npm run build:content。**不许当成通过。**`)
  process.exit(1)
}
const 包 = JSON.parse(readFileSync(包文件, 'utf8'))
const 包里的课 = new Map((包.lessons || []).map((l) => [l.id, l]))

if (种坏值) {
  // 只往内存里塞一块假演示，**不动磁盘**
  const 任意一课 = [...包里的课.values()][0]
  任意一课.body = '```demo\n假的\n```\n' + (任意一课.body || '')
  console.log('[种坏值] 已往内存里的第 1 课前面塞了一块假 ```demo —— 下面必须见红。')
}

// ① 逐课对齐
for (const [id, 源] of 源码) {
  const b = 包里的课.get(id)
  if (!b) {
    报(`【漏课】${id}（${源.文件}）在 content/ 里有，内容包里没有。`)
    continue
  }
  const 包里数 = String(b.body || '').split(/\r?\n/).filter((l) => l.trim() === '```demo').length
  if (包里数 !== 源.围栏数) {
    报(`【演示对不上】${id}：源码 ${源.围栏数} 块，内容包里 ${包里数} 块。`)
  }
}
for (const id of 包里的课.keys()) {
  if (!源码.has(id)) 报(`【多课】${id} 在内容包里，content/ 里没有同名课 —— 包是旧的。`)
}

// ── 真值来源③：真正被 Electron 加载的那个 JS ──
const 产物 = existsSync(产物目录)
  ? readdirSync(产物目录).filter((f) => /^index-.*\.js$/.test(f)).map((f) => join(产物目录, f))
  : []
if (!产物.length) {
  报(`out/renderer/assets/index-*.js 不存在 —— 还没构建，或者构建产物被清掉了。**不算通过。**`)
} else {
  const 总源码数 = [...源码.values()].reduce((s, v) => s + v.围栏数, 0)
  // 取最大的那个（构建偶尔留下旧 hash 的残留文件）
  let 最多 = 0
  let 哪个 = ''
  for (const f of 产物) {
    const n = readFileSync(f, 'utf8').split('```demo').length - 1
    if (n > 最多) { 最多 = n; 哪个 = f }
  }
  if (最多 !== 总源码数) {
    报(
      `【包里少了演示】源码共 ${总源码数} 块，应用真正加载的 ${relative(根, 哪个)} 里只有 ${最多} 块` +
        `（差 ${总源码数 - 最多} 块）。\n` +
        `      → 这就是那天的 bug：改了课文没重跑 build:content，或者没重跑 build。\n` +
        `      → 修：npm run build:content && npm run build（现在 npm run build 已经自带前者）`
    )
  } else {
    console.log(`  产物 ${relative(根, 哪个)}：${最多} 块演示，与源码一致 ✓`)
  }
}

// ④ 时间戳兜底：包比源码旧，也报（有些坏法不体现在数量上，比如改了步骤文字）
const 包时间 = Date.parse(包.builtAt || '')
if (!Number.isFinite(包时间)) {
  报(`内容包里没有可解析的 builtAt（现为 ${JSON.stringify(包.builtAt)}）—— 没法判断新旧，不许默认通过。`)
} else {
  let 最新 = 0
  let 最新文件 = ''
  for (const v of 源码.values()) {
    const t = statSync(join(根, v.文件)).mtimeMs
    if (t > 最新) { 最新 = t; 最新文件 = v.文件 }
  }
  if (最新 > 包时间 + 2000) {
    报(
      `【内容包过期】内容包 builtAt=${包.builtAt}，但 ${最新文件} 在那之后被改过` +
        `（差 ${Math.round((最新 - 包时间) / 1000)} 秒）。演示**步骤文字**这类改动数量不变，` +
        `上面几条查不出来，只能靠这条。修：npm run build:content`
    )
  }
}

// ── 出报告 ──
console.log('')
console.log(`内容包对齐检查：源码 ${源码.size} 课 / 内容包 ${包里的课.size} 课`)
console.log(`演示块总数（源码）：${[...源码.values()].reduce((s, v) => s + v.围栏数, 0)}`)
if (红.length) {
  console.log('')
  console.log(`██ 红 ${红.length} 条：`)
  for (const r of 红) console.log('  ✗ ' + r)
  process.exit(1)
}
console.log('结果：内容包与源码一致，且已打进产物 ✓')
process.exit(0)
