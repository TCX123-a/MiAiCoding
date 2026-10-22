import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { SAY_ALLOW_AT_ZERO, sayAllowedAtZero, writeSayLeaf, type SayLeaf } from '../dshpet/say-gate'

/**
 * 归零静默闸门（main/dshpet/say-gate.ts）的靶向单测 —— P3 ③（2026-10-08）
 *
 * 契约把归零口径压成一句话：「satiety=0 时除喂饭回复外一切主动出声全停」；
 * 修正案 C2 点名：闸门必须落在**气泡叶子的两个写方**（host.ts 的 sayText 与
 * sayQuip）上 —— 只包一处会漏 whisper/plead 那条路。本文件干三件事：
 *
 *   ① 行为断言：白名单 13 个 tag 在归零档必须能说且 counter+1；其余 tag 在
 *      归零档必须不动 counter、不动 data、留一行可归因日志（静默不许无声）。
 *   ② 覆盖扫描：把 brain.ts / host.ts / chat.ts 里所有出声调用点的 tag 抠出来，
 *      与"白名单 + 被挡名单"做**双向相等**比对。这条纪律最阴的坏法不是
 *      "闸门坏了"（那会当场红），而是**新加了一个出声入口 / 新 tag 却没人
 *      把它归类** —— 手写用例照旧全绿，只在真机上冒出一句不该有的话。
 *   ③ 静态漏斗：两个写方只能经由 writeSay() → writeSayLeaf() 触叶子；
 *      host / brain / chat 里出现任何直接写 say 叶子的赋值 = 红。
 *
 * 【尺子自证】扫描器先证明自己分得清：找得到手工锚（cpu-hot / run-ok /
 * hungry-sob / menu / chat-gate…）、找不到编造的 tag、注释掉的调用不算、
 * 模板 tag 按类型全集展开、非 tag 字面量与未纳管间接参数会抛错。没有这层，
 * "文件读空"或"正则写歪"都会伪装成"全部归类完毕"的假绿。
 *
 * 【字符串纪律】本文件在 src/ 下：字符串字面量一律 ASCII（tag 名、日志格式
 * 都是英文）；注释随便中文。
 */

// ===== 目录：白名单（真源在 say-gate.ts，这里做防线复查）=====

/**
 * 归零档仍允许出声的 tag（20）——必须与 SAY_ALLOW_AT_ZERO 逐一相等
 * 【plead（2026-10-10 图五修复加入）】关闭挽留是对**用户动作**（悬停关闭键/
 * 菜单项/设置卡开关）的应答，不是主动出声；挽留的动作线（recall 叶子）本来
 * 就不过闸门 —— 不放行它就只剩"原地撒娇不吭声"，正是主人报的「第一次悬停
 * 无语无图」。与 greet 同族：只在特定交互里出现，被闸门吞掉 = 永远出不来
 * （归零档可以持续几小时，而这期间每一次悬停都被吞）。
 * 【学习/运行回执（V1-50，2026-10-15 夜主人裁定）】grant-lesson / grant-review /
 * grant-checkin / rice-full / rice-cap / run-ok / run-reward —— 全是"你刚干了活，
 * 这是回执"，只在用户**刚做完动作**的那一拍出现，不是主动搭话；它们说的数
 * 决定饭盒数字涨没涨，吞掉 = 数字不涨却零解释。归零档恰恰是"学完一课就有一碗
 * 大白饭能救它"最该被听见的时刻。守卫：spin（连学彩蛋，庆祝性质不算账目回执）
 * 与 nag/nuzzle（主动催饭）**不在**白名单 —— 该安静的照旧安静（下方 BLOCKED）。
 */
const ALLOWED_AT_ZERO = [
  'chase-hungry',
  'chat',
  'chat-fail',
  'chat-gate',
  'feed-empty',
  'feed-full',
  'feed-ok',
  'grant-checkin',
  'grant-lesson',
  'grant-review',
  'greet',
  'greet:away',
  'greet:hungry',
  'greet:sleepy',
  'hungry-sob',
  'plead',
  'rice-cap',
  'rice-full',
  'run-ok',
  'run-reward'
]

/**
 * 归零档必须闭嘴的 tag（20）——覆盖三个出声文件的全部既有调用点。
 * 【没有 hunger-tier:empty】empty 不配台词（announceTier 里 `t1 === 'empty'`
 * 提前 return，静默由 hungry-sob + 闸门接管）——见扫描节里的守卫断言。
 * 【affection（P3 ④）】好感跨档的 quip 是个新出声调用点：它的**叶子 tag**
 * 是场景名 'affection'（与 menu/idle 同族），归零档必须闭嘴 —— 饿扁了
 * 还冒一句"交情"是错位的。它的日志二级 tag（affection-up/down/love-nuzzle）
 * 单独钉在扫描节：那不是叶子 tag，不进这里。
 * 【nag（补充模块一②）】催饭节拍 nagTick 的 tag：归零档闭嘴是**双保险** ——
 * nagTick 自己 `satiety <= 0` 提前 return，这里是第二道（死机档不许催饭）。
 * 【followWish（2026-10-10 跟随资格线）】同一个形状的双保险：host.ts:836 的
 * `sayQuip('followWish', 'follow-wish')` 只在 followEligible 为真时才走到，
 * 而资格线本身就要求饱食 + 好感 —— 归零档**结构上到不了**。既如此为什么还登记？
 * 因为扫描器是**静态**的（数调用点，不跑状态机），它看见一个出声口就必须看见一条归类；
 * 留在这里的第二重意义是：将来谁把资格线放松了，归零档不会顺带开始撒娇。
 * 【rice-full / grant-* / run-*（V1-50 起）】曾经按 V1-42 口径在这里"饿扁了不
 * 报账"，2026-10-15 夜主人裁定 V1-50「需要连续反馈」后**整族移入白名单**：
 * 它们是对用户动作的即时应答，归零档恰是"学一课就有一碗饭能救它"最该被听见
 * 的时刻（见 ALLOWED_AT_ZERO 上方的注释）。此处不再有它们。
 */
const BLOCKED_AT_ZERO = [
  'affection',
  'chase-arrived',
  'cpu-hot',
  'followWish',
  'hunger-tier:full',
  'hunger-tier:medium',
  'hunger-tier:mild',
  'hunger-tier:severe',
  'idle',
  'lateNight',
  'menu',
  'nag',
  'pat',
  'proactive',
  'proactive-memory',
  'rua',
  'run-err',
  'spin',
  'startup',
  'wrong',
  'wrong-notitle'
]

const CATALOG = [...ALLOWED_AT_ZERO, ...BLOCKED_AT_ZERO].sort()

/**
 * tag 形状：字母开头（lateNight 是唯一带大写的 tag，允许大小写），
 * 后跟字母/数字/_:/-；不含空格与别的符号（区分 tag 与普通文案字面量）。
 */
const TAG_RE = /^[A-Za-z][A-Za-z0-9:_-]*$/

// ===== 行为：叶子写口 =====

function freshLeaf(): SayLeaf {
  return { counter: 0, data: null }
}

describe('闸门行为（P3 ③）：白名单在归零档能说、其余一律不动叶子', () => {
  it('白名单与 say-gate.ts 的真源逐一相等（防两处各写一份漂掉）', () => {
    expect([...SAY_ALLOW_AT_ZERO].sort()).toEqual([...ALLOWED_AT_ZERO].sort())
  })

  it('satiety=0：20 个白名单 tag 逐个都能说，counter 严格 +1', () => {
    for (const tag of ALLOWED_AT_ZERO) {
      const leaf = freshLeaf()
      const logs: string[] = []
      const ok = writeSayLeaf(leaf, { tag, text: 'hi' }, 0, (l) => logs.push(l))
      expect(ok, `tag=${tag} 在归零档被误拦`).toBe(true)
      expect(leaf.counter, `tag=${tag} counter 没有 +1`).toBe(1)
      expect(leaf.data).toEqual({ text: 'hi' })
    }
  })

  it('satiety=0：20 个被挡 tag 逐个都不动 counter、不动 data、留一行可归因日志', () => {
    for (const tag of BLOCKED_AT_ZERO) {
      const leaf: SayLeaf = { counter: 7, data: { text: 'prev' } }
      const logs: string[] = []
      const ok = writeSayLeaf(leaf, { tag, text: 'must-not-land' }, 0, (l) => logs.push(l))
      expect(ok, `tag=${tag} 在归零档不该能说`).toBe(false)
      expect(leaf.counter, `tag=${tag} 被拦下却动了 counter`).toBe(7)
      expect(leaf.data, `tag=${tag} 被拦下却动了 data`).toEqual({ text: 'prev' })
      // 静默必须可归因：日志里留一行，且逐字是这个格式（探针按它数拦截次数）
      expect(logs).toEqual([`say dropped (starving 0) tag=${tag}`])
    }
  })

  it('satiety>0：白名单外也全部放行（闸门只认归零，不做别的裁剪）', () => {
    for (const satiety of [1, 0.5, 87]) {
      for (const tag of ['menu', 'cpu-hot', 'run-err']) {
        const leaf = freshLeaf()
        expect(writeSayLeaf(leaf, { tag, text: 'x' }, satiety, () => {}), `satiety=${satiety} tag=${tag}`).toBe(true)
        expect(leaf.counter).toBe(1)
      }
    }
  })

  it('NaN / 负数按"饿"算：白名单外闭嘴、白名单内照说', () => {
    expect(sayAllowedAtZero(NaN, 'menu')).toBe(false)
    expect(sayAllowedAtZero(-3, 'pat')).toBe(false)
    expect(sayAllowedAtZero(NaN, 'hungry-sob')).toBe(true)
    expect(sayAllowedAtZero(-3, 'feed-ok')).toBe(true)
    const leaf: SayLeaf = { counter: 4, data: { text: 'prev' } }
    expect(writeSayLeaf(leaf, { tag: 'spin', text: 'x' }, NaN, () => {})).toBe(false)
    expect(leaf.counter).toBe(4)
  })

  it('读不到读数（null）放行 + 留一行 fail-open 日志 —— 桌宠不许因读数缺失变哑巴', () => {
    const leaf = freshLeaf()
    const logs: string[] = []
    // 用一个"归零档必被拦"的 tag 走 null：证明放行是 fail-open 路径，不是白名单漏判
    expect(writeSayLeaf(leaf, { tag: 'menu', text: 'q' }, null, (l) => logs.push(l))).toBe(true)
    expect(leaf.counter).toBe(1)
    // 放行时除了警告行，还要有与正常写入逐字一致的 say#N 行（探针解析不受影响）
    expect(logs).toEqual(['say gate: vitals missing, fail-open (menu)', 'say#1 (menu) q'])
  })

  it('闸门读的是"每次调用当下"的读数：0 → 有饭 → 0 三轮切换即时生效', () => {
    const leaf = freshLeaf()
    expect(writeSayLeaf(leaf, { tag: 'pat', text: 'a' }, 0, () => {})).toBe(false)
    expect(writeSayLeaf(leaf, { tag: 'pat', text: 'a' }, 5, () => {})).toBe(true)
    expect(writeSayLeaf(leaf, { tag: 'pat', text: 'a' }, 0, () => {})).toBe(false)
    expect(leaf.counter).toBe(1)
  })

  it('日志格式与旧版逐字一致（探针按 say#N (tag) text [+meme] 解析）', () => {
    const leaf = freshLeaf()
    const logs: string[] = []
    writeSayLeaf(leaf, { tag: 'feed-ok', text: 'yum' }, 0, (l) => logs.push(l))
    writeSayLeaf(leaf, { tag: 'run-ok', text: 'nice' }, 60, (l) => logs.push(l))
    writeSayLeaf(leaf, { tag: 'chase-arrived', text: 'here', meme: 'm.png' }, 60, (l) => logs.push(l))
    expect(logs).toEqual(['say#1 (feed-ok) yum', 'say#2 (run-ok) nice', 'say#3 (chase-arrived) here +m.png'])
    expect(leaf.data).toEqual({ text: 'here', image: 'm.png' })
  })

  it('logTag（P3 ④ C3）：`say#N (scene) 二级tag text` —— 二级 tag 只进日志，叶子 data 不带它', () => {
    const leaf = freshLeaf()
    const logs: string[] = []
    writeSayLeaf(
      leaf,
      { tag: 'affection', logTag: 'affection-up', text: 'hi', meme: 'm.png' },
      60,
      (l) => logs.push(l)
    )
    expect(logs).toEqual(['say#1 (affection) affection-up hi +m.png'])
    // 叶子拿到的仍是"场景名当 tag"的旧形状：二级 tag 不许漏进 data（渲染端按 data 渲染）
    expect(leaf.data).toEqual({ text: 'hi', image: 'm.png' })
  })
})

// ===== 扫描器（自带尺子）=====

const REPO = join(__dirname, '..', '..', '..')

function readSrc(rel: string): string {
  return readFileSync(join(REPO, rel), 'utf8')
}

/**
 * 去注释：注释区替换为等长空格（位置不变，便于报行号），字符串/模板内容原样。
 * 【已知边界】不认识正则字面量；本仓库被扫的三个文件里正则字面量不含引号，
 * 万一将来含了，会让扫描结果缺失锚 → 双向相等断言当场红（错成红，不假绿）。
 */
function stripComments(src: string): string {
  const out = src.split('')
  let i = 0
  let state: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl' = 'code'
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (state === 'code') {
      if (c === '/' && n === '/') {
        state = 'line'
        out[i] = ' '
        out[i + 1] = ' '
        i += 2
        continue
      }
      if (c === '/' && n === '*') {
        state = 'block'
        out[i] = ' '
        out[i + 1] = ' '
        i += 2
        continue
      }
      if (c === "'" || c === '"') state = c === "'" ? 'sq' : 'dq'
      else if (c === '`') state = 'tpl'
      i += 1
      continue
    }
    if (state === 'line') {
      if (c === '\n') state = 'code'
      else out[i] = ' '
      i += 1
      continue
    }
    if (state === 'block') {
      if (c === '*' && n === '/') {
        out[i] = ' '
        out[i + 1] = ' '
        state = 'code'
        i += 2
        continue
      }
      if (c !== '\n') out[i] = ' '
      i += 1
      continue
    }
    if (state === 'sq' || state === 'dq') {
      if (c === '\\') {
        i += 2
        continue
      }
      if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"')) state = 'code'
      i += 1
      continue
    }
    // tpl：内容原样；\` 转义跳过。模板内 ${...} 里的引号也算内容（本仓库没有
    // 反引号嵌在插值里的写法）——真出现的话结果只会缺锚变红，不会假绿。
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '`') state = 'code'
    i += 1
  }
  return out.join('')
}

/** 从引号位跳过一整段字符串字面量（含转义）；返回闭引号后一位 */
function skipLiteral(src: string, start: number): number {
  const q = src[start]
  let i = start + 1
  while (i < src.length) {
    if (src[i] === '\\') {
      i += 2
      continue
    }
    if (src[i] === q) return i + 1
    i += 1
  }
  throw new Error(`未闭合的字符串字面量（位置 ${start}）`)
}

/** 括号配平（字符串感知）；open 是开括号位，返回对应闭括号位 */
function matchPair(src: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0
  let i = open
  while (i < src.length) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') {
      i = skipLiteral(src, i)
      continue
    }
    if (c === openCh) depth += 1
    else if (c === closeCh) {
      depth -= 1
      if (depth === 0) return i
    }
    i += 1
  }
  throw new Error(`未配平的 ${openCh}（位置 ${open}）`)
}

function lineOf(src: string, at: number): number {
  return src.slice(0, at).split('\n').length
}

/** 顶层逗号切参数（括号配平 + 字符串感知） */
function splitArgs(src: string, open: number, close: number): string[] {
  const args: string[] = []
  let depth = 0
  let start = open + 1
  let i = open + 1
  while (i < close) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') {
      i = skipLiteral(src, i)
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth += 1
    else if (c === ')' || c === ']' || c === '}') depth -= 1
    else if (c === ',' && depth === 0) {
      args.push(src.slice(start, i))
      start = i + 1
    }
    i += 1
  }
  args.push(src.slice(start, close))
  return args
}

/**
 * 归类一个 tag 参数：
 * · 只含单引号字面量（含三元里两个）⇒ 全部必须是 tag 形状，收集；
 * · 模板 `前缀:${t1}` ⇒ 按档名全集展开（empty 除外）；
 * · 纯反引号字面量 ⇒ 一个字面 tag；
 * · 都不是 ⇒ 间接参数，必须落在调用方声明的纳管名单里（未知来源 = 红）。
 */
function classifyArg(arg: string, tierNames: string[], ctx: string): { tags: string[]; indirect: string[] } {
  const t = arg.trim()
  const lits = [...t.matchAll(/'([^'\\]*)'/g)].map((m) => m[1])
  if (lits.length > 0) {
    for (const lit of lits) {
      if (!TAG_RE.test(lit)) throw new Error(`${ctx}: 参数里的字面量不是 tag 形状: ${JSON.stringify(lit)}`)
    }
    return { tags: lits, indirect: [] }
  }
  const tpl = /^`([^`$]*)\$\{([^}]*)\}`$/.exec(t)
  if (tpl) {
    const varName = tpl[2].trim()
    if (varName !== 't1') throw new Error(`${ctx}: 模板 tag 的插值变量 ${JSON.stringify(varName)} 未纳管（只认 t1）`)
    if (!tpl[1].endsWith(':')) throw new Error(`${ctx}: 模板 tag 前缀 ${JSON.stringify(tpl[1])} 不以 : 结尾`)
    return { tags: tierNames.filter((name) => name !== 'empty').map((name) => tpl[1] + name), indirect: [] }
  }
  if (t.startsWith('`')) {
    const raw = t.slice(1, -1)
    if (!TAG_RE.test(raw)) throw new Error(`${ctx}: 反引号 tag 不像 tag: ${JSON.stringify(raw)}`)
    return { tags: [raw], indirect: [] }
  }
  return { tags: [], indirect: [t] }
}

interface ScanResult {
  tags: string[]
  indirect: string[]
  sites: number
}

/** 抠出某个 callee 全部调用点的 tag（函数声明体跳过；注释先剥掉） */
function scanCalls(
  src: string,
  callee: RegExp,
  calleeText: string,
  tagArgIndex: number,
  allowedIndirect: string[],
  tierNames: string[]
): ScanResult {
  const code = stripComments(src)
  const tags: string[] = []
  const indirect: string[] = []
  let sites = 0
  for (const m of code.matchAll(new RegExp(callee.source, 'g'))) {
    const at = m.index ?? 0
    const calleeStart = at + (m[0].length - calleeText.length)
    if (/function\s+$/.test(code.slice(Math.max(0, calleeStart - 40), calleeStart))) continue
    const open = calleeStart + calleeText.length - 1
    const close = matchPair(code, open, '(', ')')
    const args = splitArgs(code, open, close)
    const ctx = `位置 ${lineOf(code, open)}`
    if (tagArgIndex >= args.length) throw new Error(`调用参数不足（${ctx}）：${calleeText} 没有第 ${tagArgIndex + 1} 个参数`)
    const r = classifyArg(args[tagArgIndex], tierNames, ctx)
    tags.push(...r.tags)
    for (const ind of r.indirect) {
      if (!allowedIndirect.includes(ind)) {
        throw new Error(`${ctx}: 间接 tag 参数 ${JSON.stringify(ind)} 不在纳管名单（新通道要显式归类）`)
      }
      indirect.push(ind)
    }
    sites += 1
  }
  return { tags: [...new Set(tags)], indirect, sites }
}

/** GRANT_SPECS 表：tag 与其"有没有台词"必须自洽（line: null ⇔ tag 为 ''） */
function scanGrantSpecs(src: string): { tags: string[]; bad: string[]; entries: number } {
  const code = stripComments(src)
  const start = code.indexOf('const GRANT_SPECS')
  if (start < 0) throw new Error('brain.ts 里找不到 GRANT_SPECS 表')
  const eq = code.indexOf('= {', start)
  if (eq < 0) throw new Error('GRANT_SPECS 表没有 = { 开头')
  const open = eq + 2
  const close = matchPair(code, open, '{', '}')
  const block = code.slice(open, close + 1)
  const tags: string[] = []
  const bad: string[] = []
  let entries = 0
  for (const m of block.matchAll(/tag:\s*'([^']*)'/g)) {
    const at = m.index ?? 0
    const lineStart = block.lastIndexOf('\n', at) + 1
    const nl = block.indexOf('\n', at)
    const line = block.slice(lineStart, nl < 0 ? undefined : nl).trim()
    entries += 1
    if (m[1] === '') {
      // 无台词的种类（answer）：必须同一条目写成 line: null，否则是"配了台词却无人说"
      if (!/line:\s*null/.test(line)) bad.push(`空 tag 但没标 line: null: ${line}`)
    } else {
      if (!TAG_RE.test(m[1])) bad.push(`tag 不像 tag: ${m[1]}`)
      if (/line:\s*null/.test(line)) bad.push(`有台词却标 line: null: ${line}`)
      tags.push(m[1])
    }
  }
  return { tags, bad, entries }
}

/** 从 pet.ts 的真源类型里读五档名字（扫描器展开模板 tag 用，不从测试这边硬编码） */
function readTierNames(): string[] {
  const src = readSrc('src/shared/pet.ts')
  const m = /export type PetHungerTier\s*=([^\n]+)/.exec(src)
  if (!m) throw new Error('pet.ts 里找不到 PetHungerTier 类型声明')
  const names = [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1])
  if (names.length !== 5) throw new Error(`PetHungerTier 档名数量不对：${names.join(',')}`)
  return names
}

function scanAll(): {
  scanned: string[]
  brain: ScanResult
  chat: ScanResult
  hostQuip: ScanResult
  hostText: ScanResult
  brainQuip: ScanResult
  grants: { tags: string[]; bad: string[]; entries: number }
  tierNames: string[]
} {
  const tierNames = readTierNames()
  const brainSrc = readSrc('src/main/dshpet/brain.ts')
  const chatSrc = readSrc('src/main/dshpet/chat.ts')
  const hostSrc = readSrc('src/main/dshpet/host.ts')
  const brain = scanCalls(brainSrc, /([^\w.$]|^)say\(/, 'say(', 1, ['spec.tag'], tierNames)
  const chat = scanCalls(chatSrc, /deps\.say\(/, 'deps.say(', 1, [], tierNames)
  const hostQuip = scanCalls(hostSrc, /sayQuip\(/, 'sayQuip(', 0, [], tierNames)
  const hostText = scanCalls(hostSrc, /sayText\(/, 'sayText(', 0, ['tag'], tierNames)
  // 好感跨档的 quip 出口（P3 ④）：第一参=场景名（叶子 tag，归零档必须闭嘴），
  // 第二参=只进日志的二级 tag（单独钉在下面的用例里，不进分类目录）。
  const brainQuip = scanCalls(brainSrc, /deps\.quip\(/, 'deps.quip(', 0, [], tierNames)
  const grants = scanGrantSpecs(brainSrc)
  const scanned = [
    ...new Set([...brain.tags, ...chat.tags, ...hostQuip.tags, ...hostText.tags, ...brainQuip.tags, ...grants.tags])
  ].sort()
  return { scanned, brain, chat, hostQuip, hostText, brainQuip, grants, tierNames }
}

describe('覆盖扫描：出声调用点与分类目录双向相等（新入口/新 tag 不归类 = 红）', () => {
  it('尺子自证 A：注释里的幽灵调用不算、函数声明体跳过、模板按档名全集展开', () => {
    const sample = [
      "// say(text, 'ghost-tag')",
      "/* say(text, 'ghost2-tag') */",
      "say(text, 'real-tag')",
      'say(HUNGER_LINES[t1], `fam:${t1}`)',
      'say(text, spec.tag)',
      'function say(a, b, c) { deps.say(a, b, c) }'
    ].join('\n')
    const r = scanCalls(sample, /([^\w.$]|^)say\(/, 'say(', 1, ['spec.tag'], ['aa', 'bb', 'empty'])
    expect(r.tags.sort()).toEqual(['fam:aa', 'fam:bb', 'real-tag'])
    expect(r.tags).not.toContain('ghost-tag')
    expect(r.tags).not.toContain('ghost2-tag')
    expect(r.indirect).toEqual(['spec.tag'])
    expect(r.sites).toBe(3)
  })

  it('尺子自证 B：非 tag 字面量与未纳管间接参数都必须抛错（不是静默漏过）', () => {
    expect(() => scanCalls("say(x, 'Not A Tag')", /([^\w.$]|^)say\(/, 'say(', 1, [], [])).toThrow(/不是 tag 形状/)
    expect(() => scanCalls('say(x, myVar)', /([^\w.$]|^)say\(/, 'say(', 1, ['spec.tag'], [])).toThrow(/不在纳管名单/)
    expect(() => scanCalls('say(x, `fam:${other}`)', /([^\w.$]|^)say\(/, 'say(', 1, [], ['aa'])).toThrow(/未纳管/)
  })

  it('尺子自证 C：真文件里找得到手工锚、找不到编造 tag、规模够大', () => {
    const { scanned } = scanAll()
    for (const anchor of ['cpu-hot', 'run-ok', 'hungry-sob', 'chase-arrived', 'grant-lesson', 'menu', 'chat-gate']) {
      expect(scanned, `扫描丢了锚 ${anchor}`).toContain(anchor)
    }
    expect(scanned).not.toContain('no-such-tag-xyzzy')
    expect(scanned.length).toBeGreaterThanOrEqual(30)
    expect(scanned.every((t) => /^[\x20-\x7e]+$/.test(t))).toBe(true)
  })

  it('扫描集合 == 分类目录（双向相等；多一个 = 新 tag 没归类，少一个 = 目录有死条目）', () => {
    const { scanned } = scanAll()
    expect(scanned).toEqual(CATALOG)
  })

  it('间接 tag 通道逐文件钉死：brain 只认 spec.tag、sayText 只认适配器的 tag', () => {
    const { brain, hostText } = scanAll()
    expect(brain.indirect).toEqual(['spec.tag'])
    expect([...new Set(hostText.indirect)]).toEqual(['tag'])
    expect(brain.sites).toBeGreaterThanOrEqual(20)
  })

  it('GRANT_SPECS 表自洽：有台词的必没标 line: null，空 tag 的必标 line: null', () => {
    const { grants } = scanAll()
    expect(grants.bad).toEqual([])
    expect(grants.entries).toBeGreaterThanOrEqual(4)
    expect(grants.tags).toContain('grant-lesson')
  })

  it('跨进 empty 不播台词：brain 的 announceTier 必须带 t1 === empty 守卫，目录里也不许有 hunger-tier:empty', () => {
    const { scanned } = scanAll()
    expect(scanned).not.toContain('hunger-tier:empty')
    expect(stripComments(readSrc('src/main/dshpet/brain.ts'))).toContain("t1 === 'empty'")
  })

  it('档名真源自证：pet.ts 的 PetHungerTier 恰好五档（扫描器展开的地基）', () => {
    const names = readTierNames()
    expect(names.sort()).toEqual(['empty', 'full', 'medium', 'mild', 'severe'])
  })

  it('好感跨档出声点（P3 ④ / 补充模块一②撒娇）：deps.quip 第一参是场景名 affection —— 已进目录、归零必挡', () => {
    const { brainQuip, scanned } = scanAll()
    // 两个出口共用场景名 affection：跨档播报（affection-up/down）与 love 档撒娇（love-nuzzle）
    expect(brainQuip.sites).toBe(2)
    expect(brainQuip.tags).toEqual(['affection'])
    expect(scanned).toContain('affection')
    expect(BLOCKED_AT_ZERO).toContain('affection')
  })

  it('好感出声点的日志二级 tag 钉死：恰好 affection-up / affection-down / love-nuzzle（叫法漂了当场红）', () => {
    const r = scanCalls(readSrc('src/main/dshpet/brain.ts'), /deps\.quip\(/, 'deps.quip(', 1, [], readTierNames())
    expect(r.tags.sort()).toEqual(['affection-down', 'affection-up', 'love-nuzzle'])
    expect(r.indirect).toEqual([])
    // 它们是"日志二级 tag"，不是叶子 tag —— 分类目录（闸门口径）不收录
    expect(CATALOG).not.toContain('affection-up')
    expect(CATALOG).not.toContain('affection-down')
    expect(CATALOG).not.toContain('love-nuzzle')
  })
})

// ===== 静态漏斗（C2：两个写方都在闸门上）=====

/** 抠出 `function xxx(` 的函数体（花括号配平；字符串感知） */
function bodyOf(src: string, header: string): string {
  const at = src.indexOf(header)
  if (at < 0) throw new Error(`找不到 ${header}`)
  const open = src.indexOf('{', at)
  if (open < 0) throw new Error(`${header} 后面没有 {`)
  const close = matchPair(src, open, '{', '}')
  return src.slice(open + 1, close)
}

describe('静态漏斗（C2）：sayText / sayQuip 两个写方只能经 writeSay 触叶子', () => {
  const host = stripComments(readSrc('src/main/dshpet/host.ts'))

  it('sayQuip 与 sayText 的实现体都必须调用 writeSay（两个写方都过闸）', () => {
    expect(bodyOf(host, 'function sayQuip(')).toMatch(/writeSay\(/)
    expect(bodyOf(host, 'function sayText(')).toMatch(/writeSay\(/)
  })

  it('writeSayLeaf 在 host 里只有一个调用点，第一参就是 say 叶子', () => {
    expect(host.match(/writeSayLeaf\(/g)?.length).toBe(1)
    expect(host).toMatch(/writeSayLeaf\(\s*state\.pets\.main\.say\b/)
    expect(host).toMatch(/import \{ writeSayLeaf \} from '\.\/say-gate'/)
  })

  it('host 里不存在绕过闸门的直接写：不许对 say 叶子 counter/data 赋值或自增', () => {
    expect(host.match(/state\.pets\.main\.say\.(?:counter|data)\s*(?:\+\+|[+\-*/]?=(?!=))/g) ?? []).toEqual([])
  })

  it('brain / chat 不许直接碰 say 叶子（tag 必须从 deps.say 的出口走）', () => {
    for (const f of ['brain.ts', 'chat.ts']) {
      expect(stripComments(readSrc(`src/main/dshpet/${f}`)).includes('main.say'), `${f} 直接碰了 say 叶子`).toBe(false)
    }
  })
})
