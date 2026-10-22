/**
 * 「解析按字母 / 位置指代选项」的判据（`src/shared/option-ref.ts`）。
 *
 * 【这个文件在守什么】
 * 组卷会洗选项顺序，`answer` 跟着搬，解析是散文、搬不动。源题答案在 D、
 * 解析写「D 说的顺序与牵连」，洗过之后正确项到了 B —— 学员看到的是
 * 「选了 B，解析却在讲 D」。2026-10-21 宣传片里真抓到过这一例。
 *
 * 四层防线，这个文件管其中三层：
 *   1. 探测器自己：正例必须命中、**反例必须不命中**（误伤会把正常题冻住）
 *   2. 内置题的兜底：命中就不洗选项（`shuffleOptions`）
 *   3. 内容闸门：全部 questions.json 的 choice 解析必须 0 命中
 *   4. AI 题的拒收在 `ai-question.test.ts`
 *
 * 【为什么反例这么重要】
 * 这个判据宁严勿松，但宽到把「C 语言」「C++」「汉诺塔的 A→C」认成选项，
 * 就等于把一整批正常题都禁了洗牌。反例表里每一条都是内容里真实出现过的句式。
 */
import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'
import { describe, expect, it } from 'vitest'
import { findHardOptionRefs, findOptionRefs, referencesOptionPosition } from '../option-ref'
import { shuffleOptions } from '../quiz-paper'
import type { ChoiceQuestion } from '../types'

// ---------------------------------------------------------------- 正例

/** 真·按字母或位置指代选项。每一条都来自（或仿自）真实内容。 */
const HITS = [
  'D 说的顺序与牵连，正是「手敲」最先崩掉的那一环；A、B、C 都不是这段路的真麻烦喵。',
  'A 是没管家时的老实笨办法，C、D 就纯属碰运气了喵。',
  'A 和 D 都把「红变绿」当成了目标。',
  'C 说得不对：把 `3` 改成 `4` 语法完全合法。',
  '第三项也不对：这里**不会一直等**。',
  '第二个选项把 `for` 弄丢了。',
  '第四个选项想得太美：编译器不会替谁补租仓库。',
  '第 2、3 个选项都写着「跑得起来」。',
  '最后一个选项是错的。',
  '答案是 B。',
  '选项 C 说的是另一回事。',
  'B 项不对。',
  // 2026-10-21 第二轮普查补上的几族（宽口径；原文都来自真实内容）
  '第一条坏在**问题没变小**：自己叫自己时传的还是 n。',
  '最后那个说法也错：`nonlocal` 是写在**里层**的句子。',
  '前两项都是翻墙。',
  '后两条都是想当然喵。',
  '选项 1 说反了——摊子里当然能写 `print`。',
  '答案 2 才是正解。',
  '第三个干扰项也常见。',
  '第一个错在「里头的货还在」。',
  // 2026-10-21 复核抓到的半截改写：前半句已改成引原话，末尾还在按数量数选项。
  '「`key` 要的是一个函数，得填函数本身」才是递招式，后面三句都没说到点子上喵。',
  // 2026-10-21 提交前审计抓到的现网漏判（当时真实存在于 content 里）
  '后三条错在同一个思路：把「挑哪一版」提前到了写代码的时候。',
  '后面那两种写法 C 压根不认。',
  '最后那个选项是 Java/Python 那边的规矩，C++ 里还的活是你的喵。',
  '最后那个「只声明不建文件夹」也不行。',
  '最后那个「运给翻译官喵」是把两件事混了。',
  '只有第一个是「只有逗号、没有冒号」的集合，所以答案是它喵。',
  '最后那一条要特别当心：名字是每只猫自己的东西。',
  // 字母族的常见写法（审计实测全部漏判）
  '正确的是 C。',
  '答案应该是 B。',
  '答案就是 C。',
  'C 正确。',
  'C 符合题意。',
  'A 或 B 都对。',
  'ABD 都不对。',
  '（B）',
  '最后一个才是对的。',
  '第四个不对。',
  '前三项都错。',
  // 2026-10-21 交付前审计抓到的整族漏判（现网 4 道题用「第N种」指代选项）
  '第一种写法是对的，第二种漏了类型。',
  '第四种是拿着两个家伙白忙活一场。',
  '另外三种都是合法写法：第一种老老实实排队喂。',
  // 大小写 / 全角字母
  '选项 a 和选项 c 都对。',
  '正确的是 c。',
  'Ａ 和 Ｃ 都对。',
  // 括号序数
  '第（2）个选项不对。',
  '第（二）项不对。',
  // 数字连写 / 无「第」写法
  '2、3 两项都不对。',
  'A/B/C 都对。',
  'ABD 三个都不对。',
  // 圈号
  '选项①说反了。',
  // 倒装
  '正确的应该是 C。',
  '按题意，该选的是 D。',
  '除了 D 都对。',
  // 裸位置
  '最后一个说的是对的。',
  // 选项文本自己按位置说话（Maven 那道题）
  '上面两件都归它管。'
]

/** 长得像、但**不是**选项指代。误判的代价是这道题永远不洗牌。 */
const NOT_HITS = [
  '同一张清单写成 C、C++、Java、Python 都行。',
  '写岔了 C 也不拦你。',
  '顺牌子拿东西，C 也不会拦你。',
  'A→C、A→B、C→B、A→C，七步搬完。',
  '剩下两个选项跟跑圈没关系。',
  '`va_start` 的第二个参数是最后那个有名字的投喂。',
  '第一行是 `#include`，第二行是 `main`。',
  'IDE 是把一屋子设备摆齐。',
  '普通解析：先看清要什么结果，再把过程拆成一步步。',
  '函数体里的句子**没被喊之前一句都不跑**。',
  '所以第二条命令是 `java Main`，不带 `.java`。',
  '两个 n 相乘那一项涨得最快，另一个 n 只是添头。',
  // 「答案一」在中文里常是「答案一样大」/「答案是一个字都没有」，
  // 全量扫描时这两条都曾把正常句子判成选项编号（2026-10-21）。
  '`else` 兜住的正好是「你报的数和答案一样大」这一种情况。',
  '答案是一个字都没有喵。',
  // 2026-10-21 加宽后必须继续放行的正常句子
  '第一个参数是最后那个有名字的投喂。',
  '最后那个参数是宽度。',
  'C 对比一下就知道。',
  '把 C 拼接进去就行。'
]

describe('findOptionRefs()：认得出、也不误伤', () => {
  it.each(HITS)('命中：%s', (text) => {
    expect(findOptionRefs(text).length).toBeGreaterThan(0)
  })

  it.each(NOT_HITS)('不命中：%s', (text) => {
    expect(findOptionRefs(text)).toEqual([])
  })

  it('**种坏自检**：把正例里的关键词挖掉，探测器必须变绿', () => {
    // 这条防的是「探测器恒真」——恒真的判据比没有判据更糟：
    // 它会把 854 道选择题全部冻住，而测试还是全绿。
    expect(findOptionRefs('D 说的顺序与牵连')).not.toEqual([])
    // 别拿「D 的…」当负对照：它只差一个谓语，将来加宽时不该被这条测试挡住。
    expect(findOptionRefs('顺序与牵连')).toEqual([])
  })

  it('返回的是命中片段本身，不是布尔值 —— 内容闸门要拿它打印「哪一句」', () => {
    expect(findOptionRefs('答案是 B。')).toEqual(['答案是 B'])
    expect(findOptionRefs('A、B、C 里只有它对')).toEqual(['A、B、C'])
  })
})

describe('referencesOptionPosition()：布尔版与数组版同口径', () => {
  it.each([...HITS, ...NOT_HITS])('同一段文本两种写法答案一致', (text) => {
    expect(referencesOptionPosition(text)).toBe(findOptionRefs(text).length > 0)
  })
})

describe('findHardOptionRefs()：内容闸门只收几乎不会误伤的写法', () => {
  it.each([
    '第三个干扰项也常见。',
    '选项 1 说反了。',
    '答案是 B。',
    '第二项也不对。',
    '最后那个选项是 Java/Python 那边的规矩。',
    '正确的是 C。',
    '第四个不对。',
    'ABD 都不对。',
    '第一种写法是对的。'
  ])(
    '硬判据命中：%s',
    (text) => {
      expect(findHardOptionRefs(text).length).toBeGreaterThan(0)
    }
  )

  // 这几族运行时仍会兜底（不洗牌），但不逼内容作者把正常句子改掉
  it.each([
    '第一条坏在问题没变小。',
    '前两项都是翻墙。',
    '最后那个说法也错。',
    '后面三句都没说到点子上。',
    '后三条错在同一个思路。',
    '后面那两种写法 C 压根不认。',
    '只有第一个是「只有逗号、没有冒号」的集合。',
    '最后那个「运给翻译官喵」是把两件事混了。',
    '最后那一条要特别当心。',
    '最后一个才是对的。',
    '上面两件都归它管。'
  ])('歧义写法不进硬判据：%s', (text) => {
    expect(findHardOptionRefs(text)).toEqual([])
  })

  it.each([...HITS, ...NOT_HITS])('硬判据命中 ⇒ 宽口径必然命中', (text) => {
    if (findHardOptionRefs(text).length > 0) expect(findOptionRefs(text).length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------- 兜底

describe('shuffleOptions()：解析指代选项时**不洗**', () => {
  const base: ChoiceQuestion = {
    id: 'q1',
    type: 'choice',
    stem: 'stem',
    options: ['甲', '乙', '丙', '丁'],
    answer: 3,
    explanation: 'D 说的就是它喵。'
  }

  it('返回**同一个引用**，选项和 answer 一个都没动', () => {
    expect(shuffleOptions(base, () => 0)).toBe(base)
  })

  it('序数写法同样受保护', () => {
    const q = { ...base, explanation: '第二个选项才对喵。' }
    expect(shuffleOptions(q, () => 0)).toBe(q)
  })

  it('普通解析照常洗 —— 兜底不能把整批题都冻住', () => {
    const q = { ...base, explanation: '这是一段普通的解析喵。' }
    const out = shuffleOptions(q, () => 0) as ChoiceQuestion
    expect(out).not.toBe(q)
    expect(out.options[out.answer]).toBe('丁')
  })

  it('**选项文本自己按位置说话**时同样不洗', () => {
    // java/stage3/25-maven-gradle q1 的正确项原文；洗到第一位就变成病句。
    const q = {
      ...base,
      options: ['上面两件都归它管', '乙', '丙', '丁'],
      answer: 0,
      explanation: '这是一段普通的解析喵。'
    }
    expect(shuffleOptions(q, () => 0)).toBe(q)
  })
})

// ---------------------------------------------------------------- 性能回归

describe('长空白输入不能把探测器拖死', () => {
  it('「前」+ 2000 个空格 + X 必须很快放弃（相邻可空 \\s* 曾退化到 n⁴ 回溯）', () => {
    // 2026-10-21 审计实测：旧写法「前 + 800 空格 + X」要 206 秒。
    // AI 解析跑在主进程（ai-question.ts 的上限是 1000 字），一个病态响应
    // 就能把整个应用冻住几分钟。这里钉的不是性能指标，是「不能有灾难性回溯」。
    const s = '前' + ' '.repeat(2000) + 'X'
    const t0 = performance.now()
    expect(findOptionRefs(s)).toEqual([])
    expect(findHardOptionRefs(s)).toEqual([])
    // 修好后是亚毫秒级；2000ms 是极宽松的上限（慢机器/满负载也够）
    expect(performance.now() - t0).toBeLessThan(2000)
  })
})

// ---------------------------------------------------------------- 内容闸门

/** 全部 `content/**\/questions.json` */
function questionFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) questionFiles(p, out)
    else if (e.name === 'questions.json') out.push(p)
  }
  return out
}

describe('内容闸门：内置选择题的解析不许按字母/位置指代选项', () => {
  const CONTENT = join(__dirname, '..', '..', '..', 'content')

  it('全部 questions.json：0 命中（硬判据）', () => {
    const hits: string[] = []
    let choiceCount = 0

    for (const file of questionFiles(CONTENT)) {
      const data = JSON.parse(readFileSync(file, 'utf8')) as {
        questions?: { id: string; type: string; explanation?: string }[]
      }
      for (const q of data.questions ?? []) {
        if (q.type !== 'choice') continue
        choiceCount++
        const refs = findHardOptionRefs(String(q.explanation ?? ''))
        if (refs.length > 0) {
          hits.push(`${relative(CONTENT, file)} ${q.id} → ${refs.join(' / ')}`)
        }
      }
    }

    // 扫到 0 道题也「全绿」的话，路径写错时这条闸门会静默失效。
    expect(choiceCount).toBeGreaterThan(800)
    expect(hits).toEqual([])
  })

  it('闸门用的是硬判据，宽口径里那些歧义写法不会被逼着改', () => {
    // 这条防的是「哪天有人图省事把闸门换回 findOptionRefs」——
    // 换回去之后「第一条…（指课文）」也会红，内容侧迟早把闸门调松。
    expect(findHardOptionRefs('第一条坏在问题没变小。')).toEqual([])
    expect(findOptionRefs('第一条坏在问题没变小。').length).toBeGreaterThan(0)
  })
})
