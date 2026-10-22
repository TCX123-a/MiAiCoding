#!/usr/bin/env node
/**
 * 反向验证：**三栏布局那几条守则还活着吗？**
 *
 * 【为什么需要这个台子】
 * `src/shared/__tests__/layout.test.ts` 全绿有两种可能，从输出上**看不出区别**：
 *   · 守则真的在守
 *   · 某条 guard 在改代码时被顺手删了/写反了，而对应的用例碰巧也在改的时候被一起改松了
 * 第二种会一直绿下去 —— 因为它对任何输入都绿。
 *
 * 所以唯一的验法是**故意把 guard 改坏，看它红不红**。这正是本项目的老规矩：
 * 「故意把规则改坏，确认测试变红，再恢复」。
 *
 * 【这个台子和 verify-validator-guards.mjs 的一条关键差别】
 * 那个台子验的是 `.mjs`，语法错误 `node --check` 就能先查出来。
 * 这里动的是 `.ts`，**没有现成的语法检查器可用**，于是「退出码非 0」就有了两种成因：
 *   ① guard 被改坏了 → 目标用例失败   ← 这才是证据
 *   ② 注入本身写成了语法错误 → vitest 连文件都收集不了  ← 这不是证据
 * 两者都会让退出码变成 1。所以每条注入**必须**额外确认：
 * **失败输出里要出现那条指定的用例名**。语法错误不会让任何用例名出现。
 * （上一轮做许可协议生成器时就栽在这上面：注入把文件写崩了，
 *   退出码 1 看着像「自检抓住了」，其实根本没跑到自检。）
 *
 * 【自保三条】
 *   1. 开跑前先确认 `src/shared/layout.ts` 在 git 里是**干净的** —— 有脏的就退出，
 *      否则本台子一恢复就把主人没提交的改动一起抹了。
 *   2. 恢复写在 `finally` 里，恢复的是**读进来的原始字符串**；每条测完立刻还原一次，
 *      不然上一条的注入会留到下一条。
 *   3. 恢复后比对 sha256，再跑一次确认回绿。
 *
 * 【万一被 Ctrl-C / 断电打断】文件是 git 跟踪的：
 *   git checkout -- src/shared/layout.ts
 *
 * 用法：
 *   node scripts/审计/verify-layout-guards.mjs
 * 退出码：0 = 每条注入都被对应用例抓住 + 阴性对照没被误抓 + 恢复成功；1 = 有问题
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const FILE = 'src/shared/layout.ts'
const TEST = 'src/shared/__tests__/layout.test.ts'

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12)

function runTests() {
  try {
    const out = execSync(`npm test -- ${TEST}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out }
  } catch (e) {
    // vitest 用退出码报失败，非 0 会抛 —— 那不是崩溃，是「红了」
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/**
 * 每条：把 `find` 换成 `replace`，然后断言**名为 `expectFail` 的那条用例失败了**。
 * `expectFail: null` 表示阴性对照 —— 断言它**不该**被抓住。
 */
const CASES = [
  {
    name: '删掉「没有 event 就不是用户拖的」这道闸',
    why: 'splitpanes 在增删 pane（收起/展开右栏）后也会补发 resized。少了这道闸，用户每开合一次右栏，宽度就被悄悄改写一次。',
    find: '  if (!payload.event) return null\n',
    replace: '',
    expectFail: '收起右栏（三栏变两栏）'
  },
  {
    name: '删掉「panes 必须是数组」这道闸',
    why: '解构 null 会抛异常，而这个函数是在 mouseup 里被调的 —— 抛出去的表现是「拖了一下，界面崩了」。',
    find: '  if (!Array.isArray(payload.panes)) return null\n',
    replace: '',
    expectFail: 'panes 不是数组'
  },
  {
    name: '让 clampSize 不做区间钳位、原样放行',
    why: '越界值会原样写进配置：width: 999% 把主区挤没、width: -5% 让那一栏反向撑开，而且写进文件就改不回来了。',
    find: '  return Math.min(Math.max(v, min), max)\n',
    replace: '  return v as number\n',
    // ⚠️ 这里**不能**写 'sidebarSize 是 NaN'。第一版就是那么写的，结果台子报「红了，
    // 但失败的不是那条用例」—— 查下来是我自己搞错了：拦住 NaN 的是上面那行
    // `Number.isFinite` 判断，不是这个钳位式子。只抽掉钳位，NaN 照样被挡下，
    // 那条用例理所当然还是绿的。**台子拒绝把「别的用例红了」当成证据，这次它是对的。**
    expectFail: 'sidebarSize 比上限还大'
  },
  {
    name: '让 clampSize 不再单独拦 NaN（只留 typeof 判断）',
    why: 'NaN 能穿过 Math.min(Math.max(...))（和谁比都是 false），被原样写进配置之后 width: NaN% 让那一栏塌成 0 —— 而配置已经改不回来了。同一个坑 runTimeoutSec 那边踩过一次。',
    find: "  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback\n",
    replace: "  if (typeof v !== 'number') return fallback\n",
    expectFail: 'sidebarSize 是 NaN'
  },
  {
    name: '把 rightPanelOpen 的布尔检查换成 Boolean()',
    why: 'Boolean(undefined) 是 false，一次数据意外就会把用户的右栏静默关掉，他下次打开只看到面板没了。',
    find: "    rightPanelOpen: typeof o.rightPanelOpen === 'boolean' ? o.rightPanelOpen : DEFAULT_LAYOUT.rightPanelOpen\n",
    replace: '    rightPanelOpen: Boolean(o.rightPanelOpen)\n',
    expectFail: 'rightPanelOpen 丢了要补成 true'
  },
  {
    name: '让 normalizeLayout 不再兜「整节 undefined」',
    why: '老配置文件里根本没有 layout 这一节，直接读属性会抛错 —— 升级后第一次启动就是白屏，开发机复现不了。',
    find: '  const o = (typeof raw === \'object\' && raw !== null ? raw : {}) as Record<string, unknown>\n',
    replace: '  const o = raw as Record<string, unknown>\n',
    expectFail: '整节是 undefined'
  },
  {
    name: '让 mainSizeOf 忘掉右栏那份（三条加起来不再正好 100）',
    why: 'splitpanes 只在总和 ≠ 100 时才调用 readjustSizes，而它一被调用就把差额平摊给每一栏。于是用户每收起/展开一次右栏，三栏宽度就整体偏一点 —— 实测来回一趟左栏少 58px，而且**配置文件里一个字都不会变**，光看配置根本发现不了。',
    find: '  return 100 - layout.sidebarSize - (layout.rightPanelOpen ? layout.rightPanelSize : 0)\n',
    replace: '  return 100 - layout.sidebarSize\n',
    expectFail: '遍历整个合法区间：三条永远正好 100'
  },
  {
    name: '【阴性对照】只改注释，不动任何代码',
    why: '证明这台子不是「只要动过文件就报抓住」。它必须在该绿的时候绿。',
    // 原先这条改的是 MAIN_MIN_SIZE（32→36）。后来那三条不等式用例落地之后，
    // 它就不再是「根本不测的常量」了 —— 换个语义上绝对无影响的改动当对照，
    // 免得哪天它悄悄由绿转红，把「误报」伪装成「守则被改坏了」。
    find: ' * 三栏布局的尺寸定义 —— 主进程校验与渲染进程渲染**共用这一份**，避免两处数字漂移。\n',
    replace:
      ' * 三栏布局的尺寸定义 —— 主进程校验与渲染进程渲染**共用这一份**，避免两处数字漂移。（此行由反向验证台临时改过）\n',
    expectFail: null
  }
]

// ── 换行：一律在 LF 上做匹配，写回去时还原成原来那种 ──────────────
//
// ⚠️ 这一段是被台子自己抓出来的。第一版直接在读进来的原文上匹配，
// 第一次跑过了 —— 因为那时这个文件是我刚写下的 LF。等 `git checkout` 过一次
// （Git 的 autocrlf 会把工作区换成 CRLF），**七条锚点全部失效**，
// 台子却仍然「跑完了」，只是每条都报「锚点找不到」。
// 换句话说：一次 checkout 就能让这个台子静默失去全部覆盖。
const origRaw = readFileSync(FILE, 'utf8')
const usesCRLF = origRaw.includes('\r\n')
const toLF = (s) => (usesCRLF ? s.split('\r\n').join('\n') : s)
const toDisk = (s) => (usesCRLF ? s.split('\n').join('\r\n') : s)
const orig = toLF(origRaw)

// 转换必须可逆 —— 不可逆说明文件里两种换行混着，那就别碰它
if (toDisk(orig) !== origRaw) {
  console.error(`✗ ${FILE} 里既有 LF 又有 CRLF，本台子不敢动它（怕把换行弄乱）。`)
  process.exit(1)
}

// ── 开跑前的自保：文件必须是干净的 ────────────────────────────────

try {
  const dirty = execSync(`git status --porcelain -- ${FILE}`, { encoding: 'utf8' }).trim()
  if (dirty) {
    console.error(`✗ ${FILE} 在 git 里有未提交的改动，先提交或 stash 再跑本台子。`)
    console.error('  否则本台子的恢复会把你没提交的改动一起抹掉。')
    process.exit(1)
  }
} catch {
  console.error('✗ 读不到 git 状态（不在仓库里？）—— 没有恢复的退路，不敢动文件。')
  process.exit(1)
}

console.log(`台子就绪：${FILE}\n`)

let bad = 0
try {
  for (const c of CASES) {
    if (!orig.includes(c.find)) {
      console.error(`✗ 「${c.name}」的注入锚点找不到了：`)
      console.error(`    ${JSON.stringify(c.find)}`)
      console.error('  说明源码被改过形状 —— 这条注入已经失效，本台子不再覆盖它。')
      bad++
      continue
    }

    writeFileSync(FILE, toDisk(orig.replace(c.find, c.replace)), 'utf8')
    const r = runTests()
    writeFileSync(FILE, origRaw, 'utf8') // 立刻还原，别把这条的注入带进下一条

    if (c.expectFail === null) {
      // 阴性对照：必须还是绿的
      if (r.code === 0) {
        console.log(`✓ [对照] ${c.name} —— 如期没被抓住（台子不是「动过就红」）`)
      } else {
        console.log(`✗ [对照] ${c.name} —— 它**不该**被抓住，却红了。台子在误报。`)
        bad++
      }
      continue
    }

    // 真注入：必须红，**而且红的必须是那条指定的用例**
    const failed = r.code !== 0
    const named = r.out.includes(c.expectFail)
    if (failed && named) {
      console.log(`✓ ${c.name}`)
      console.log(`      抓住它的用例：「${c.expectFail}」`)
    } else if (failed && !named) {
      console.log(`✗ ${c.name} —— 红了，但**失败的不是那条用例**（退出码不是证据）。`)
      console.log(`      期望出现的用例名：「${c.expectFail}」`)
      console.log('      最可能的原因：注入本身把文件写成了语法错误，vitest 压根没跑到测试。')
      bad++
    } else {
      console.log(`✗ ${c.name} —— **没被抓住，全绿**。`)
      console.log(`      ${c.why}`)
      bad++
    }
  }
} finally {
  writeFileSync(FILE, origRaw, 'utf8')
}

// ── 收尾：文件得一个字节不差，测试得回绿 ──────────────────────────
const drift = sha(readFileSync(FILE, 'utf8')) !== sha(origRaw)
const after = runTests()
if (drift) {
  console.error(`\n✗ 恢复不彻底：${FILE} 的 sha256 对不上。`)
  console.error(`  跑一句 git checkout -- ${FILE} 就回来了。`)
  bad++
} else if (after.code !== 0) {
  console.error('\n✗ 文件恢复了但测试还是红的 —— 有别的改动混进来了？')
  bad++
} else {
  console.log(`\n✓ 已还原（${FILE} 一个字节没变，测试回绿）`)
}

console.log(
  bad === 0
    ? `\n全部通过：${CASES.length - 1} 条注入全被对应用例抓住，阴性对照没有被误抓`
    : `\n有 ${bad} 条没通过 —— 那几条守则现在是摆设`
)
process.exit(bad === 0 ? 0 : 1)
