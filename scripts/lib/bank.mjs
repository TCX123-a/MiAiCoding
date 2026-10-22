/**
 * 无限题库的**纯函数层** —— 模板装载、参数抽样、实例化、内容哈希。
 *
 * 【为什么这一层里没有"跑代码"】
 * 这里全是可以在纸上推演的变换：模板 + 参数 → 一串文本。
 * 真正要起进程的那件事（编译、运行、算 `expectedOutput`）在 `gen-bank.mjs` 和
 * `check-bank.mjs` 里，它们调 `lib/run-code.mjs` 的 `runBlock`。
 * 分开的好处是这一层能被单测直接跑 —— **不需要装 gcc，也不需要等 3 秒**。
 *
 * 【和 `docs/14-无限题库架构.md` 的关系】
 * 那份文档是设计稿，这里是它的落地。两份不一致时**以文档为准，改这里**；
 * 但文档 §5.2 的三条实例化规则是硬约束，下面每一条都有对应的代码在管：
 *   规则 1：题干示例的输入必须和判分用的 stdin **不同**  → `drawInputs()` 抽两套
 *   规则 2：题干示例的输出也要**跑出来**              → `sampleOutput` 由生成器算，不写进模板
 *   规则 3：`brokenCode` 必须真跑一遍断言它坏          → 在闸门里（`bank-verify.mjs`）
 */
import { createHash } from 'node:crypto'
import { normalizeRunOutput } from './run-code.mjs'
// ⚠️ 依赖方向说明：bank-verify → bank **没有**反向依赖，所以这里不成环。
// 为什么要跨过来拿这一个函数：`leftoverPlaceholders` 是「草稿有没有填干净」的
// **唯一判据**。`finalizeDraft` 要是在这儿自己再写一个扫描正则，
// 就正好犯了它要修的那个错 —— 同一个判据散成两份。
import { leftoverPlaceholders } from './bank-verify.mjs'

/**
 * 两个**保留占位符**，它们不是模板参数，而是"等一下才填"的空位。
 *
 * `{sampleInput}` / `{sampleOutput}` 的内容要**真跑一遍样例输入**才知道，
 * 而 `instantiate()` 的时候还没跑。所以第一遍替换时把它们原样留下，
 * 由 `fillSample()` 在跑完之后补上。
 *
 * 不把它们放进参数表的话，`fill()` 会当成"模板引用了不存在的参数"直接抛错 ——
 * 而那个错看起来像"模板写错了"，其实模板完全正确。
 */
export const DEFERRED_PLACEHOLDERS = new Set(['sampleInput', 'sampleOutput'])

// ---------------------------------------------------------------- 参数域

/**
 * 把一个模板的 `params` 域**枚举**成全部组合，顺序稳定。
 *
 * 【为什么是"枚举"而不是"随机抽"】
 * 随机抽有两个躲不掉的麻烦：① 抽到重复的要重抽，重抽几次之后"还能不能抽出新组合"
 * 变成一个有概率答案的问题；② 同一次生成重跑一遍会得到**不同**的题，
 * 于是"这个文件是不是最新的"就再也说不清了。
 * 枚举则退化成一道算术题：第 k 个组合就是第 k 个组合，跑多少次都一样。
 *
 * 【代价要说清楚】组合数必须**可控**。`int` 域建议范围不超过 10，
 * `pick` 域建议不超过 5 个值 —— 一个 3 个 int 的模板就有 1000 种组合，
 * 那是好事（容量大）；但一个 `min:1 max:100` 的域会直接枚举出 100 个组合，
 * 而且它们**看起来几乎一样**（见 docs/14 §6 模板 C 的反例：那不叫 100 道题）。
 *
 * @returns {Array<Record<string, string|number>>} 每个元素是一套完整参数
 */
export function enumerateParams(spec) {
  const keys = Object.keys(spec ?? {})
  if (keys.length === 0) return [{}]
  let out = [{}]
  for (const key of keys) {
    const domain = spec[key]
    const values = valuesOf(domain)
    if (values.length === 0) {
      throw new Error(`参数「${key}」的值域是空的 —— 枚举不出任何组合`)
    }
    const next = []
    for (const partial of out) {
      for (const v of values) next.push({ ...partial, [key]: v })
    }
    out = next
  }
  return out
}

/** 一个参数域展开成的取值列表 */
function valuesOf(domain) {
  if (!domain || typeof domain !== 'object') {
    throw new Error(`参数域必须是对象，拿到的是 ${JSON.stringify(domain)}`)
  }
  if (domain.kind === 'int') {
    const lo = Number(domain.min)
    const hi = Number(domain.max)
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo) {
      throw new Error(`int 参数域不合法：min=${domain.min} max=${domain.max}`)
    }
    const out = []
    for (let i = lo; i <= hi; i++) out.push(i)
    return out
  }
  if (domain.kind === 'pick') {
    if (!Array.isArray(domain.values) || domain.values.length === 0) {
      throw new Error('pick 参数域必须给一个非空 values 数组')
    }
    // 原样返回：pick 的值是**字符串**（名词、动词），数字在这里没有意义
    return [...domain.values]
  }
  throw new Error(`不认识的参数域 kind：${domain.kind}（只支持 int / pick）`)
}

// ---------------------------------------------------------------- 实例化

/**
 * 把 `{参数名}` 替换成参数值。
 *
 * ⚠️ **只认 `{标识符}` 这一种形状**，而且这是刻意的、有代价的取舍：
 *
 *   · **认**：`{n}`、`{unit}`、`{n2}` —— 只有 ASCII 字母数字下划线
 *   · **不认**：`{a + b}`、`{ 带空格 }`、`{中文}`、`{a;}` —— 原样留在题面里
 *
 * 【为什么宁可漏认，也不能放宽成"任意花括号"】
 * 模板里有**大段代码**（C / Java / C++ 的 `referenceSolutionTemplate`），
 * 而代码里全是花括号。放宽成正则 `\{([^{}]*)\}` 的话，下面这段 C 代码
 *
 *     int add(int a) {
 *         return a;
 *     }
 *
 * 会被切成"占位符 `{\n    return a;\n}`"→ 查不到这个参数 → 抛错。
 * 也就是说：**放宽了正则，每一份 C / Java 模板都写不出来。**
 * 而漏认的代价只是一个错别字（`{n }` 多打了个空格）会安静地留在题面里。
 * 两边的代价差得太远，所以取窄的那一边。
 *
 * 【那错别字怎么办】闸门里有一条"题面里不该还有 `{...}`"的检查兜着 ——
 * 它跑在**实例化之后**，看的是成品题面，而那里已经没有代码块了，
 * 于是它可以放心地把宽松形状当可疑对象（见 `bank-verify.mjs` 的 `leftoverPlaceholders`，
 * 调用点是本文件的 `finalizeDraft`）。
 * ⚠️ 这里原写的是「见 gen-bank.mjs 的 looksLikeTemplate」—— 那个函数全仓零命中，
 * 是个过期的指路牌（2026-09-16 修）。
 *
 * 【为什么不支持表达式】模板是**数据**（JSON），不是代码。一旦允许 `{a + b}`，
 * 「这道题长什么样」就得跑一遍模板引擎才知道，模板本身读不懂了。
 * 要算的东西（比如 `{n}` 个数加起来是多少）走 `expectedOutput` 那条路 ——
 * **本地真跑出来**，不是在这里算。
 */
export function fill(tpl, params) {
  if (typeof tpl !== 'string') return tpl
  return tpl.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name) => {
    // 「等一下再填」的两个空位原样留下，见 DEFERRED_PLACEHOLDERS
    if (DEFERRED_PLACEHOLDERS.has(name)) return whole
    if (!(name in params)) {
      throw new Error(`模板里用了 {${name}}，但参数域里没有这个参数（有：${Object.keys(params).join(', ')}）`)
    }
    return String(params[name])
  })
}

/**
 * `{参数}` 解析成一个**整数** —— 给"个数"这类要参与抽样运算的字段用
 * （`stdinSpec.count` 常写成 `"{n}"`）。`fill()` 只会给出字符串，
 * 而 `count` 得是数字才能拿去转圈。
 */
function resolveInt(v, params, where) {
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error(`${where} 要是整数，拿到 ${v}`)
    return v
  }
  const s = fill(String(v), params)
  const n = Number(s)
  if (!Number.isInteger(n)) throw new Error(`${where} 解析出来不是整数：「${s}」`)
  return n
}

// ---------------------------------------------------------------- 随机数

/**
 * 一个**可重现**的伪随机数发生器（mulberry32）。
 *
 * 【为什么不用 `Math.random()`】
 * 同一个模板重跑一次必须得到**逐字相同**的题 —— 否则「这个文件是不是最新的」
 * 「哈希对不对得上」这两件事全都不成立：重跑一遍文件就变了，闸门天天变红，
 * 而变红的原因不是内容错了，是骰子又掷了一次。
 *
 * 种子由 `(模板 id, 组合序号, 用途)` 拼出来，于是"第 7 套参数的判分输入"
 * 在世界上只有一个确定答案。
 */
export function rngFrom(seedStr) {
  let h = 1779033703 ^ seedStr.length
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), 1 | t)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 从 `[lo, hi]` 里取一个整数，两端都含 */
function randInt(next, lo, hi) {
  return lo + Math.floor(next() * (hi - lo + 1))
}

// ---------------------------------------------------------------- 输入数据

/**
 * 按 `stdinSpec` 造一段程序输入。
 *
 * 支持的形状（`docs/14` §5.1 只写了一句散文，这里是它的落地）：
 *   `{ kind: 'ints', count: '{n}', min: 1, max: 9 }`     每行一个整数
 *   `{ kind: 'ints-one-line', count: '{n}', min, max }`  一行里空格隔开
 *   `{ kind: 'raw', text: '...' }`                        原样（可以带 `{参数}`）
 *   `null` / 省略                                          没有输入
 *   任意一种都可以再带一个 `head`：打在数字**前面**的一段字
 *
 * ⚠️ **`raw` 是个特例**：它的正文是写死的、不随种子变，所以它凑不出
 * "另一套"样例输入。要给样例就得显式写 `sampleText`（判据在 `drawInputs`）。
 * 其余几种的样例输入由换种子自动抽出来。
 *
 * 【为什么 `count` 要能写成 `"{n}"`】
 * 「读 n 个数求和」这种题，输入的行数**就是**参数 n —— 两者必须联动。
 * 让模板作者手写死行数的话，`n` 一改就对不上了，而那种错**跑起来才发现**。
 *
 * 【为什么还要 `head`】
 * 因为「**先读一个 n，再读 n 个数**」是练习里最常见的一种形状，
 * 没有 `head` 就写不出来：`count: '{n}'` 只会造出 n 个数，
 * 而程序还会先在开头读掉一个当 n —— 于是它实际吃到的是 n-1 个数，
 * 第 n 个留在管道里没人读。**这种错不会报错**，只会让输出少加一个数。
 *
 *     { kind: 'ints', head: '{n}\n', count: '{n}', min: 1, max: 9 }
 *     → "5\n3\n8\n1\n9\n2\n"（先报个数，再给 5 个）
 *
 * `head` 里可以写 `{参数}`（和 `raw` 一样走 `fill`），所以那个 n 和
 * `count` 用的 n 一定是同一个。
 */
export function makeStdin(spec, params, seed) {
  if (!spec) return undefined
  if (spec.kind === 'raw') return fill(String(spec.text ?? ''), params)
  if (spec.kind !== 'ints' && spec.kind !== 'ints-one-line') {
    throw new Error(`不认识的 stdinSpec kind：${spec.kind}（支持 ints / ints-one-line / raw）`)
  }
  const count = resolveInt(spec.count, params, 'stdinSpec.count')
  const lo = Number(spec.min ?? 1)
  const hi = Number(spec.max ?? 9)
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo) {
    throw new Error(`stdinSpec 的 min/max 不合法：min=${spec.min} max=${spec.max}`)
  }
  const next = rngFrom(seed)
  const nums = []
  for (let i = 0; i < count; i++) nums.push(randInt(next, lo, hi))
  const body = spec.kind === 'ints' ? nums.join('\n') + '\n' : nums.join(' ') + '\n'
  return (spec.head ? fill(String(spec.head), params) : '') + body
}

/**
 * 一套参数的**稳定字符串键** —— 用来判断"这个组合是不是已经产过了"。
 *
 * 【为什么按键排序】`JSON.stringify` 按对象自己的键序输出，而键序来自模板
 * JSON 里 `params` 的书写顺序。有人把 `n` 和 `unit` 两行对调一下，
 * 键就变了 → 生成器认为"这是个新组合" → **同一道题又产了一遍**，
 * 而两道题的 `stem`/`expectedOutput` 一字不差。排序之后，书写顺序不再影响判断。
 */
export function paramsKey(params) {
  const keys = Object.keys(params ?? {}).sort()
  return JSON.stringify(keys.map((k) => [k, params[k]]))
}

/**
 * 造出**两套互不相同**的输入：一套给题面当样例，一套真正用来判分。
 *
 * 【这是 `docs/14` §5.2 规则 1 的落地，不是可选项】
 * 两套要是同一份，学员看到题面里的「比如输入 3 5 2 输出 10」，
 * 直接 `print(10)` 就能过关 —— 而且**会被判对**，他什么也没学到。
 *
 * 【怎么保证"不同"】
 * 种子不同 → 随机流不同 → 数值序列不同。理论上仍可能撞（比如 n=3、
 * 值域只有 1~2 时），所以这里**验一下**：撞了就换下一个种子重抽。
 * 这件事必须机器保证，不能靠"概率很低" —— 撞上一次就是一道可以硬编码的题。
 */
export function drawInputs(spec, params, seedBase) {
  const judge = makeStdin(spec, params, `${seedBase}|judge`)
  if (!judge) return { sample: undefined, judge: undefined }

  /*
   * ⚠️ **`raw` 不能靠换种子凑出第二套输入 —— 它压根不看种子。**
   *
   * 这不是"值域太小"那种可以多抽几次解决的问题：`raw` 的正文是**写死的**，
   * 抽 50 次拿回来的还是同一串字。下面那个循环会一路空转到头，抛出
   * 「造不出和判分输入不同的样例输入」，而**报错把原因指向参数值域** ——
   * 一条把人引到错误方向的诊断，比不报错更费时间。
   *
   * 所以 `raw` 走一条自己的路：要样例就必须**显式**给一段 `sampleText`，
   * 而且这里真的验一下它和判分输入不同（作者复制粘贴忘了改的话，
   * 就等于把判分那组数印在题面上，学员 `print(答案)` 就能过）。
   * 不给 `sampleText` 就是"这道题没有样例" —— 题面里也就不该出现 `{sampleInput}`。
   */
  if (spec.kind === 'raw') {
    if (spec.sampleText === undefined) return { sample: undefined, judge }
    const sample = fill(String(spec.sampleText), params)
    if (sample === judge) {
      throw new Error(
        `raw 的 sampleText 和 text 一模一样（${seedBase}）—— 那就等于把判分输入印在题面上，学员 print 答案就能过。` +
          `要么把样例改成真的另一组，要么删掉 sampleText（这道题不出样例）。`
      )
    }
    return { sample, judge }
  }

  for (let attempt = 0; attempt < 50; attempt++) {
    const sample = makeStdin(spec, params, `${seedBase}|sample|${attempt}`)
    if (sample !== judge) return { sample, judge }
  }
  throw new Error(
    `造不出和判分输入不同的样例输入（${seedBase}）—— 多半是参数值域太小（比如 n 固定、值域只有 1~2）`
  )
}

// ---------------------------------------------------------------- 哈希

/**
 * 一道题的**内容指纹**：把会影响「判分结果或学员看到的东西」的字段规范化之后取 sha256 前 16 位。
 *
 * 【它防的是什么】
 * 验证戳（`verified`）如果只记时间，就会出现一件很坏的事：
 * **有人改了 `referenceFix` 而忘了重跑闸门，戳还是绿的** ——
 * 「验过了」这句话就变成了一句没有对象的断言，那正是项目铁律
 * 「静默跳过 = 把『没验过』伪装成『验过了』」要拦的东西。
 * 记内容哈希之后，改了内容 → 哈希对不上 → 闸门自动变红，**不需要有人记得**。
 *
 * 【哪些字段进哈希】
 * 一切会进判分或题面的：`type` / `lang` / `stem` / 三段代码 / `expectedOutput` /
 * `stdin` / `explanation`。
 * 不进哈希的：`id` / `templateId` / `params` / `verified` 自己 ——
 * 它们**变了也不影响这道题对不对**，而且 `verified` 进哈希是自指（永远算不出来）。
 * `params` 不进的一个实际理由：改一下参数名的大小写不该让 1100 道题全部重验。
 */
export function contentHash(item) {
  const canonical = JSON.stringify({
    type: item.type,
    lang: item.lang,
    stem: item.stem,
    brokenCode: item.brokenCode ?? null,
    referenceFix: item.referenceFix ?? null,
    starter: item.starter ?? null,
    referenceSolution: item.referenceSolution ?? null,
    expectedOutput: item.expectedOutput ?? null,
    stdin: item.stdin ?? null,
    explanation: item.explanation ?? null
  })
  return sha256Hex(canonical).slice(0, 16)
}

/**
 * sha256。用 `node:crypto` 而不是自己写 —— 这里不需要"零依赖"，
 * 需要的是"和别人算出来的哈希一定一样"。
 *
 * （顶层 `import` 一个内置模块不算"副作用" —— 本文件那条"无副作用"的纪律
 *   管的是不碰文件系统、不起进程，好让单测能直接 import 它。）
 */
function sha256Hex(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

// ---------------------------------------------------------------- 组合成题

/**
 * 把一个模板 + 一套参数 + 两段输入，实例化成一个**还没算 expectedOutput 的**题目草稿。
 *
 * 为什么返回的是草稿而不是成品：`expectedOutput` / `sampleOutput` 要真跑才知道，
 * 而这个文件里没有"跑"。跑完由生成器填回来。
 */
export function instantiate(template, params, inputs) {
  const t = template
  const base = {
    type: t.type,
    lang: t.lang,
    // `{sampleInput}` / `{sampleOutput}` 这会儿还是原样的占位符，见 fillSample()
    stem: fill(t.stemTemplate, params),
    explanation: fill(t.explanationTemplate ?? '', params),
    stdin: inputs.judge
  }
  if (t.type === 'codefix') {
    base.brokenCode = fill(t.brokenCodeTemplate, params)
    base.referenceFix = fill(t.referenceFixTemplate, params)
  } else if (t.type === 'codewrite') {
    if (t.starterTemplate) base.starter = fill(t.starterTemplate, params)
    base.referenceSolution = fill(t.referenceSolutionTemplate, params)
  } else {
    throw new Error(`题库只产出 codefix / codewrite，模板 ${t.templateId} 写的是 ${t.type}`)
  }

  return {
    draft: base,
    /** 题面里那段样例输入 —— 生成器要拿它去真跑出 sampleOutput */
    sampleInput: inputs.sample
  }
}

/**
 * 题面里的 `{sampleInput}` 是个**两段式**替换：第一遍填参数时它还不知道内容，
 * 所以先留成占位，等两段输入造好、样例真跑过了再填回去。
 *
 * 写成"回头补"而不是"一次填完"的理由：样例**输出**必须先跑样例输入才知道，
 * 而跑这件事不在这里。
 *
 * 【为什么两个值都要先过 `normalizeRunOutput`】
 * 判据只能有一处。学员在应用里看到的样例输出，和判分时拿来比对的那份，
 * 必须是**同一条规则算出来的** —— 否则会出现这种事：题面示例显示成
 * `8`（我在这里手工 `.replace(/\n+$/,'')` 去掉了空行），而判分按归一化规则比。
 * 两份规则只要差一点点，学员就会"照着题面的样子写却判错"，且肉眼查不出原因。
 *
 * 顺带就是那个 CRLF 坑：第一版写的 `sampleOutput.replace(/\n+$/, '')` 对
 * `'8\r\n'` 只会削掉 `\n`，**留下一个看不见的 `\r`**，题面里于是多一个空白字符。
 * `normalizeRunOutput` 第 1 条正是"`\r\n` 当 `\n`"，用它就不会漏。
 *
 * 【为什么替换值走函数而不是字符串】
 * `String.prototype.replace` 的**字符串**替换值里 `$&`、`$1`、`` $` `` 是特殊记号。
 * 样例输出里一旦出现 `$`（比如一道"算出花了多少钱"的题输出 `$5`），
 * 用字符串替换会把它当成记号展开，**输出被改写而没有任何报错**。
 * 传函数则一切都是字面量。（`fill()` 本来就是函数形式，所以它没这个问题。）
 */
export function fillSample(stem, sampleInput, sampleOutput) {
  return 替换占位(替换占位(stem, 'sampleInput', sampleInput), 'sampleOutput', sampleOutput)
}

/**
 * 把草稿**定稿**：回填两段延迟占位符，并断言**题面和解析里都不许再剩花括号**。
 *
 * 【为什么要有这个函数，而不是在生成器里写两行】
 * 因为第一版就是"在生成器里写两行"，而它只作用于 `draft.stem`。
 * 结果 `py-s1-read-two-sum` 的解析里写着「哪怕你在键盘上敲的是 {sampleInput} 里的数」——
 * 生成器一路绿灯、七道闸门全过，学员打开题就看见 `{sampleInput}` 五个字母。
 * 这个缺陷**已经随题库上线了**，直到 2026-09-16 才被 `_lint-new-templates.mjs`
 * 从 1096 套参数里翻出来。
 *
 * 根因不是"漏了一行"，是**同一个动作散在两处、只覆盖了一半输入**：
 * 「回填」写了 1 处但只看题面，「查残留」也写了 1 处但也只看题面。
 * 所以修法不是补一行，是把它收成**唯一一处**：想回填就得连解析一起，
 * 想查残留也得连解析一起，绕不过去。
 *
 * 【为什么"剩下没填的"要由这里查，而 `fill()` 查不出】
 * `fill()` 只认标识符形状的 `{名字}`，且不认识的参数会抛错。剩下能漏的是两类：
 *   ① 延迟占位符（`{sampleInput}`）—— 那正是本函数要填的东西
 *   ② 写歪的名字（`{n }` 多个空格、`{a + b}` 写了表达式）—— `fill()` 认不出来，
 *      原样留在文本里，只有宽松形状的 `leftoverPlaceholders()` 能看见
 *
 * 【为什么解析也要查，不会把中文课文误伤吗】
 * 实测过：57 道已产出的题的 `stem` + `explanation` 里，非延迟占位符的
 * 花括号 **0 处**；38 个模板的 1096 套参数里也只有 read-two-sum 那一处真的。
 * `leftoverPlaceholders` 要求花括号**成对、内容不含换行、不超过 60 字**，
 * 中文里偶尔出现的「集合 {1,2}」这种短片段确实会被它当成可疑 —— 但现在没有。
 * 真撞上了就该改模板写法（换个说法），而不是把解析从检查范围里摘出去。
 */
export function finalizeDraft(draft, sampleInput, sampleOutput) {
  for (const [字段, 中文名] of [
    ['stem', '题面'],
    ['explanation', '解析']
  ]) {
    let 文本
    try {
      文本 = fillSample(draft[字段] ?? '', sampleInput, sampleOutput)
    } catch (e) {
      // 加上字段名：`替换占位` 的原文案分不清是题面还是解析在要样例
      throw new Error(`${中文名}：${e.message}`)
    }
    const 残留 = leftoverPlaceholders(文本)
    if (残留.length) throw new Error(`${中文名}里还有没填掉的占位符：${残留.join(' ')}`)
    draft[字段] = 文本
  }
  return draft
}

/**
 * 把 `{名字}` 换成值；**如果题面里真的用了它，却没东西可填，就抛错**。
 *
 * 抛错的理由：不抛的话题面里会原样留着 `{sampleInput}` 五个字母，
 * 学员打开题就看到它 —— 而生成器一路绿灯、闸门全过。
 * 这种"只有人眼能发现"的缺陷正是模板机制最该自己拦下的一类。
 *
 * 【用 split/join 而不是 replace】两个坑一次躲掉：
 *   · `replace` 的**字符串**替换值里 `$&` / `$1` / `` $` `` 是特殊记号 ——
 *     样例输出里出现 `$`（比如算钱的题输出 `$5`）会被静默改写
 *   · 正则分隔符要转义，而 `split` 收字符串时是**字面**匹配
 * 结果就是这一行里没有任何东西需要被"记住要转义"。
 */
function 替换占位(文本, 名字, 值) {
  const 占位 = `{${名字}}`
  if (!文本.includes(占位)) return 文本
  if (值 === undefined || 值 === null) {
    throw new Error(`题面或解析里用了 ${占位}，但这道题没有对应的内容可填（模板少了 stdinSpec / sampleText？）`)
  }
  return 文本.split(占位).join(normalizeRunOutput(值))
}
