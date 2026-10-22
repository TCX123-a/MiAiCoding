/**
 * 术语计数器 —— **全项目唯一一份**「什么算原术语泄漏」的判据。
 *
 * 【为什么单独抽成一个模块】
 * 这条判据原先只长在 `scripts/content-validate.mjs` 里（一个模块内的 `countTerms`）。
 * 2026-09-16 发现题库文案（`content/challenge-bank/**` —— 学员每题都要读两遍的
 * **题面和解析**）**从来没有任何闸门扫过**，于是攒下 27 处泄漏，且已经生成上线。
 *
 * 补齐的办法不是再写一份判据（那正是「判据只能有一处」这条铁律要防的漂移），
 * 而是把它抽到这里，让两个闸门**共用同一个实现**：
 *   · `scripts/content-validate.mjs` —— 课文正文、手写题目的题干/解析、错误库文案
 *   · `scripts/check-bank.mjs`        —— 题库产物（题面/解析）
 *
 * 【阈值不在这里，在使用方】正文是警告级（阈值 2）、题目文案是错误级（阈值 0）。
 * 差别是刻意的：课文里偶尔带出一个原术语还能读，而题目是"学员盯着看两遍还要
 * 照着答题"的字。要改阈值请改调用方，别改这里。
 *
 * 【2026-09-20 补上反方向：createCatScanner】
 * 上面那个数的是**原术语**（禁在课文/解析里裸奔）；
 * 下面这个数的是**猫咪说法**（禁在选项/标准答案里顶替术语）。
 * 两个方向共用 glossary.json 这一张表 —— 表还是只有一份，只是从两头读。
 */

/** 把 `cat` 栏拆成词：`"技能 / 招式"` 是两个词，不是一串。 */
function catWords(term) {
  return String(term.cat ?? '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function createTermScanner(glossary) {
  const terms = glossary?.terms ?? []

  /** 数一段文本里出现了几处原术语（含「原术语（猫咪说法）」首次对照豁免）。 */
  return function countTerms(raw) {
    // 允许「首次对照」：原术语（猫咪说法）形式不计入
    const cleaned = raw.replace(/([一-龥A-Za-z]+)（[^）]{1,12}）/g, '')
    const counts = []
    for (const term of terms) {
      for (const original of term.originals) {
        const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const ex = term.scanExcludes
        let pattern
        if (ex && original.length === 1) {
          // 单字术语：排除词自身也要进字符类，避免「类类」这类叠字被重复计数
          const behind = ex.lookBehind.join('')
          const ahead = ex.lookAhead.join('')
          pattern = `(?<![${behind}${escaped}])${escaped}(?![${ahead}])`
        } else if (ex) {
          // 多字术语：同样支持 scanExcludes（如「列表」需排除「参数列表」）
          const behind = (ex.lookBehind || []).join('')
          const ahead = (ex.lookAhead || []).join('')
          pattern = `${behind ? `(?<![${behind}])` : ''}${escaped}${ahead ? `(?![${ahead}])` : ''}`
        } else {
          pattern = escaped
        }
        const re = new RegExp(pattern, 'g')
        const found = cleaned.match(re)?.length || 0
        if (found > 0) counts.push({ term: original, cat: term.cat, found })
      }
    }
    return { counts, total: counts.reduce((s, c) => s + c.found, 0) }
  }
}

/**
 * 反方向的计数器：数一段文本里出现了几处**猫咪说法**。
 *
 * 【它为什么存在】主人 2026-09-20 定的题库规则是「猫咪外衣 + 硬核内核」：
 *   题干可以有喵腔和场景铺垫，**但选项和标准答案必须是原术语**。
 * 「小鱼干仓库」当选项/答案 = 本末倒置，是这条闸门要拦的东西。
 * 判据只用 glossary.json 的 `cat` 栏，不另立白名单 —— 表加词，闸门自动跟着加。
 *
 * ⚠️ 调用方**必须**先剔掉「这词本来就出现在本题代码里」的情形
 *   （`拿碗()`、「打招乎」、程序打印的原文都是**代码里的字**，不是比喻）。
 *   那条判据在调用方，因为只有调用方手里有那道题的 code 字段。
 */
export function createCatScanner(glossary) {
  const terms = glossary?.terms ?? []
  // 长词优先：「用猫爪指向牌串起来的链子」要压在「猫爪指向牌」前面匹配，
  // 否则同一处会被拆成两处计数（一个长词 + 一个短词）。
  const 词表 = terms
    .flatMap((t) => catWords(t).map((w) => ({ 词: w, 原术语: t.originals.join(' / ') })))
    .sort((a, b) => b.词.length - a.词.length)

  return function countCatTerms(raw) {
    const text = String(raw ?? '')
    let rest = text
    const counts = []
    for (const { 词, 原术语 } of 词表) {
      const n = rest.split(词).length - 1
      if (n === 0) continue
      counts.push({ term: 词, original: 原术语, found: n })
      rest = rest.split(词).join('\u0000'.repeat(词.length)) // 挖掉，防止短词重复计数
    }
    return { counts, total: counts.reduce((s, c) => s + c.found, 0) }
  }
}
