import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import { describe, expect, it } from 'vitest'
import * as copy from '../copy'
import { APP_NAME } from '../../../../shared/copy'
import { maskComments } from '../../../../shared/__tests__/mask-comments'

/**
 * S2 配套闸门：让「界面文案必须住在 copy.ts 里」这条纪律可执行。
 *
 * 为什么需要它：S2 之前，界面文字散落在 15 个组件中，同一句话写了两遍也没人知道，
 * 想统一改个说法得全仓翻。收拢之后如果不加闸门，迟早会有人图省事又在组件里写死一条，
 * 悄悄把刚建立起来的秩序拆掉。靠人肉复查 30+ 个文件不现实，靠机器扫一秒钟。
 */

/**
 * 文案真源，本身当然允许写中文。
 * `shared/copy.ts` 是主进程与渲染进程共用的那份（窗口标题、运行器报错）。
 * `shared/pet-quips.ts` 是桌宠的场景台词池 —— 它**是文案本身**（每条台词都
 * 直接上气泡），不是「数据表借了中文」，所以归类为上边这组；把它塞进
 * EXCEPTIONS 反而错：例外组是给「不是我们写的文案」留的（示例程序源码、
 * 官方本地化表），台词是我们一句句写的界面文字，就该站着真源的位置。
 *
 * `shared/cloud/protocol.ts`（2026-10-13 加入）里的中文 = SECURITY_QUESTIONS
 * 八条预设安全问题 —— 同 pet-quips 的道理，它们**是文案本身**（注册页下拉
 * 原样渲染、找回时原样回显）。为什么不搬进 copy.ts：这份文件必须与
 * `server/src/protocol.ts` **逐字节同步**（protocol-sync 闸门钉的就是这个），
 * 而 server 编不了渲染层的 copy.ts —— 搬过去会造出第二份会漂移的"真源"。
 * 所以特许它站在真源组里：界面文案的豁免由「它是同一份协议的镜像」背书，
 * 不是"数据表借了中文"。
 */
const SOURCE_OF_TRUTH = [
  'shared/copy.ts',
  'shared/pet-quips.ts',
  'shared/cloud/protocol.ts',
  'renderer/src/lib/copy.ts',
  'renderer/src/lib/labels.ts'
]

/**
 * 按例外放行，每条都要写清理由。宁可少放行几条，也别把闸门调松——
 * 闸门一旦形同虚设，还不如没有。
 */
const EXCEPTIONS: { file: string; why: string }[] = [
  {
    file: 'shared/samples.ts',
    why:
      '里面的中文全是练习场示例**程序的源码和预期输出**（print("你好喵") 这类），' +
      '是给用户读的内容，不是界面文案，按性质就不该进 copy.ts。' +
      '真正的按钮文案已单独抽到 copy.ts 的 SAMPLE_UI——' +
      '那次拆分就是为了别让按钮标签蹭这份豁免。'
  },
  {
    file: 'shared/wallpaper-props.ts',
    why:
      'WE_BUILTIN_TEXT 是 Wallpaper Engine 官方本地化表（locale/ui_zh-chs.json）的' +
      '逐字摘抄——「键 → 官方译文」的对照**数据表**，不是我们写的界面文案。' +
      '它的正确性判据是「与官方表逐字一致」，抄进 copy.ts 只会制造第二份会漂移的真源；' +
      '面板显示这些词时走解析器查表，措辞不归我们管。' +
      'PROMO_KEYWORDS（推广行判定的窄词表，2026-10-07）同理：词条是拿来做子串' +
      '匹配的数据，不是给人看的文案，多一条少一条只影响判定、不归文案闸门管。' +
      '除这两张数据表外，本文件仍保持英文。'
  },
  {
    file: 'shared/option-ref.ts',
    why:
      '正则里的中文（「说」「是」「选项」「第…项」）是**判定解析有没有按字母/位置' +
      '指代选项的匹配词**，跟 PROMO_KEYWORDS 同性质：它们是数据，不是谁写给人看的文案，' +
      '一个字段都不会渲染到屏幕上。放进 copy.ts 反而会把这套判据拆成两半、' +
      '再给 content 侧脚本 import 一份会漂移的副本。'
  }
]

interface Hit {
  file: string
  line: number
  text: string
}


/**
 * 扫描写死的中文界面文案。
 *
 * 【两种形态都要抓，缺一不可】
 *   ① 引号串：`toast('中文')`、`aria-label="复制"`、`` `中文${x}` ``
 *   ② 文本节点：`<button>复制</button>`、`<div>学习总进度</div>`
 * 只抓①会漏掉一大片——模板里最常见的写法恰恰是②。
 * 实测：只抓①时漏了 25 处；只按行抓②时又漏掉跨行书写的长段落。
 * 所以②必须允许跨行（`[^<>]*` 里不加 `\n`），长句换行才不会逃掉。
 *
 * 【为什么不再用「配对引号取字面量」】
 * 初版用 `(['"`])(...)\1` 配对整个文件，被模板字符串害惨了：
 * `` `<code class="hljs">${body}</code>` `` 里嵌套的引号让配对错位，
 * 一个 `"` 一路吞到几十行外的另一个 `"`，**跨越整段注释**，
 * 把注释里的中文示例报成了「代码里写死中文」。错配既误报、又可能掩盖真问题。
 * 现在改成「引号后到本行结束」这种有界的写法，结构上不可能跨行错配。
 */
function scanLineOfCopy(file: string, root: string): Hit[] {
  const src = maskComments(readFileSync(file, 'utf8'))
  const rel = relative(root, file).replace(/\\/g, '/')
  const hitMap = new Map<string, Hit>()

  const patterns = [
    /['"`][^'"`\n]*[一-鿿][^'"`\n]*/g, // 引号串（不跨行）
    />[^<>]*[一-鿿][^<>]*</g // 文本节点（允许跨行）
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) {
      // 行号按「中文真正出现在哪一行」算，而不是匹配起点——
      // 文本节点模式会从上一个 `=>` 或 `>` 一路吃到中文，起点可能早好几行
      const line = src.slice(0, m.index + m[0].search(/[一-鿿]/)).split('\n').length
      // 两种模式会撞上同一处（`">复制<"` 与 `>复制<`），按「行号 + 文案」去重
      const text = m[0]
        .replace(/^[>'"`]+/, '')
        .split('<')[0]
        .replace(/\s+/g, ' ')
        .trim()
      const key = `${line} ${text}`
      // 两种模式常撞上同一处，按 key 去重；重复时留更短的那条——短的那个才是文案本身
      const prev = hitMap.get(key)
      if (!prev || text.length < prev.text.length) hitMap.set(key, { file: rel, line, text })
    }
  }
  return [...hitMap.values()].sort((a, b) => a.line - b.line)
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== 'generated' && name !== '__tests__') walk(p, out)
    } else if (/\.(vue|ts)$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

/** 递归收集 copy.ts 导出的全部字符串（含把带参数的函数实例化） */
function collectStrings(value: unknown, path: string, out: { path: string; text: string }[]): void {
  if (typeof value === 'string') {
    out.push({ path, text: value })
  } else if (typeof value === 'function') {
    const probe = (value as (...a: unknown[]) => unknown)(1, 3)
    if (typeof probe === 'string') out.push({ path: `${path}()`, text: probe })
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => collectStrings(v, `${path}[${i}]`, out))
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collectStrings(v, `${path}.${k}`, out)
  }
}

describe('界面文案不许绕过 copy.ts 写死', () => {
  it('渲染层源码里没有散落的中文字符串', () => {
    // 扫描整棵源码树（含 main / preload / shared），不只是渲染层——
    // 主进程的窗口标题、运行器报错同样是用户看得见的文案
    const root = join(__dirname, '..', '..', '..', '..')
    const allowed = new Set([...SOURCE_OF_TRUTH, ...EXCEPTIONS.map((e) => e.file)])

    const hits = walk(root)
      .filter((f) => !allowed.has(relative(root, f).replace(/\\/g, '/')))
      .flatMap((f) => scanLineOfCopy(f, root))

    // 失败时打印「文件:行 → 那句中文」，照着搬到 copy.ts 即可
    expect(hits.map((h) => `${h.file}:${h.line} → "${h.text}"`)).toEqual([])
  })

  it('例外清单没有过期项（文件还在、且理由仍在）', () => {
    const root = join(__dirname, '..', '..', '..', '..')
    const present = new Set(walk(root).map((f) => relative(root, f).replace(/\\/g, '/')))
    for (const e of EXCEPTIONS) {
      expect(present.has(e.file), `例外项已失效，请从 EXCEPTIONS 删除：${e.file}`).toBe(true)
      expect(e.why.length, `例外项缺理由：${e.file}`).toBeGreaterThan(10)
    }
  })
})

describe('文案库的完整性', () => {
  it('收集逻辑没有静默失效', () => {
    const strings: { path: string; text: string }[] = []
    for (const [k, v] of Object.entries(copy)) collectStrings(v, k, strings)
    // 当前实际 76 条，阈值取 70 留余量——它不是「文案数量指标」，只是漏扫探测器
    expect(strings.length).toBeGreaterThan(70)
  })

  it('每条空状态都成对给出主文案与解释行', () => {
    for (const [k, v] of Object.entries(copy.EMPTY)) {
      if (k === 'DEFAULT') continue
      expect(v.text, `${k}.text`).toBeTruthy()
      expect(v.subText, `${k}.subText`).toBeTruthy()
    }
  })

  it('窗口标题与 APP_NAME 一致（index.html 没法 import，只能靠断言钉住）', () => {
    const html = readFileSync(join(__dirname, '..', '..', '..', 'index.html'), 'utf8')
    const title = html.match(/<title>(.*?)<\/title>/)?.[1]
    // 这条不是洁癖：index.html 的 <title> 会在页面加载后**覆盖**
    // BrowserWindow 里设的 title，用户真正看到的是它。
    expect(title, 'index.html 里的 <title> 与 shared/copy.ts 的 APP_NAME 对不上').toBe(APP_NAME)
  })

  it('判分评语按正确率单调上升，且零题时有兜底', () => {
    expect(copy.QUIZ.resultOf(0, 0).text).not.toBe('')
    const ladder = [0.3, 0.7, 0.9, 1].map((r) => copy.QUIZ.resultOf(r, 10).text)
    expect(new Set(ladder).size).toBe(4) // 四档各不相同，别写成同一句
  })
})

/*
 * 退出确认正文的选择（2026-10-01 对抗复核修复）。
 *
 * fav 模式 +「收藏练习答错也收进错题本」关着时，那一局的记账判据
 * （quiz.ts flushWrongbook 的 `recordWrong`）恒假 —— 一道都不记。
 * 弹窗再说"答错的题会照常进错题本"就是假话（设置页的 hint 正相反），
 * 而旧代码（半场退出一行不记）里那句反而是真的，假话正是本轮改动引入的。
 * 选择逻辑收在 QUIZ.exitConfirmBody，这里按「模式 × 开关」钉住它。
 */
describe('退出确认正文：按会话模式与设置选', () => {
  it('challenge：用挑战那句（记账判据里 challenge 恒记，开关与它无关）', () => {
    expect(copy.QUIZ.exitConfirmBody('challenge', true)).toBe(copy.CHALLENGE.EXIT_CONFIRM_BODY)
    expect(copy.QUIZ.exitConfirmBody('challenge', false)).toBe(copy.CHALLENGE.EXIT_CONFIRM_BODY)
  })

  it('★ fav + 开关关着：换不承诺记账的那句，而且点得出设置项的名字', () => {
    const body = copy.QUIZ.exitConfirmBody('fav', false)
    expect(body).toBe(copy.QUIZ.EXIT_CONFIRM_BODY_NO_RECORD)
    // 关键判据：它和"真正记账"那句**不是同一句** —— 否则这个变体等于没加
    expect(body).not.toBe(copy.QUIZ.EXIT_CONFIRM_BODY)
    // 用户得知道"想要它记该去哪儿改"，所以正文里必须出现设置项的标签名
    expect(body).toContain(copy.SETTINGS.LABEL_FAV_WRONG_TO_BOOK)
  })

  it('fav + 开关开着 / 其余所有模式：用通用那句（记账照常）', () => {
    expect(copy.QUIZ.exitConfirmBody('fav', true)).toBe(copy.QUIZ.EXIT_CONFIRM_BODY)
    for (const m of ['lesson', 'random', 'wrong', 'review', 'extend', 'stage', 'lang', 'search']) {
      expect(copy.QUIZ.exitConfirmBody(m, false), m).toBe(copy.QUIZ.EXIT_CONFIRM_BODY)
    }
  })

  it('会话为空（无 mode）：也给通用那句，不炸', () => {
    expect(copy.QUIZ.exitConfirmBody(undefined, false)).toBe(copy.QUIZ.EXIT_CONFIRM_BODY)
  })
})
