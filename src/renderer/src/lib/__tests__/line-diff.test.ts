/**
 * 行级差异（lib/line-diff.ts）
 *
 * 【这个文件在守什么】
 * diff 是一段"算错了也照样输出点什么"的代码 —— LCS 的表填错一格、回溯的
 * tie-break 写反、删/插配对的时候数组取错，结果都不是崩溃，而是
 * **一张看起来很像那么回事的对比表**：少一行、多一行、行号错位。
 * 学员照着它改，改出来还是错的，而没有任何地方报错。
 *
 * 所以这里最要紧的不是几个用例，是那条**不变量**：
 * 把表里的两栏各自抽出来，必须**一行不差地还原**成原来那两段代码。
 * 它一句话就盖住了"少一行/多一行/顺序乱"这一整类错法。
 *
 * 【为什么还要拿真内容当回归网】
 * 手写用例只能盖到我想到的情形。而"参考解"是内容生成时写的，
 * 会出现什么样的改动谁也说不准（整段重排、多加两行、只改一个字符）。
 * 见文件末尾那两条。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { diffLines, isDiffRow, splitCodeLines } from '../line-diff'

/** 表里左栏抽出来（丢掉"对面独有"的空格），应当一字不差地等于原先那段代码 */
const leftOf = (rows: ReturnType<typeof diffLines>): string[] =>
  rows.map((r) => r.yours).filter((v): v is string => v !== null)
const rightOf = (rows: ReturnType<typeof diffLines>): string[] =>
  rows.map((r) => r.ref).filter((v): v is string => v !== null)

/** 不变量：两栏各自还原得回去，且"一样"的行左右内容确实相同 */
function expectLossless(yours: string, reference: string): ReturnType<typeof diffLines> {
  const rows = diffLines(yours, reference)
  expect(leftOf(rows)).toEqual(splitCodeLines(yours))
  expect(rightOf(rows)).toEqual(splitCodeLines(reference))
  for (const r of rows) {
    if (r.kind === 'same') expect(r.yours).toBe(r.ref)
    if (r.kind === 'change') {
      expect(r.yours).not.toBeNull()
      expect(r.ref).not.toBeNull()
      expect(r.yours).not.toBe(r.ref)
    }
    if (r.kind === 'add') expect(r.yours).toBeNull()
    if (r.kind === 'remove') expect(r.ref).toBeNull()
  }
  return rows
}

describe('splitCodeLines', () => {
  it('末尾那一个换行不算一行（"文件以换行结尾"不是"多一个空行"）', () => {
    expect(splitCodeLines('a\nb\n')).toEqual(['a', 'b'])
    expect(splitCodeLines('a\nb')).toEqual(['a', 'b'])
  })

  it('**中间**的空行照留 —— 那是真内容', () => {
    expect(splitCodeLines('a\n\nb\n')).toEqual(['a', '', 'b'])
  })

  it('`\\r\\n` 和孤立的 `\\r` 都收掉（Windows 上传上来的代码带 `\\r`）', () => {
    expect(splitCodeLines('a\r\nb\r\n')).toEqual(['a', 'b'])
    expect(splitCodeLines('a\rb')).toEqual(['a', 'b'])
  })

  it('空字符串 → 零行，不是一行空的', () => {
    expect(splitCodeLines('')).toEqual([])
  })
})

describe('diffLines：基本形状', () => {
  it('两段一模一样 → 全是 `same`，一处差异都没有', () => {
    const rows = diffLines('a\nb\nc', 'a\nb\nc')
    expect(rows.map((r) => r.kind)).toEqual(['same', 'same', 'same'])
    expect(rows.every((r) => !isDiffRow(r.kind))).toBe(true)
  })

  it('改了一行 → 那一行是 `change`，两边**行号对齐**（不是错开一行加一片空白）', () => {
    const rows = expectLossless('a\nb\nc', 'a\nB\nc')
    expect(rows.map((r) => r.kind)).toEqual(['same', 'change', 'same'])
    const mid = rows[1]
    expect(mid.yours).toBe('b')
    expect(mid.ref).toBe('B')
    // 行号对齐是这个对比表能不能看懂的**全部**：错开一行的话，
    // 学员会以为改动发生在别的地方
    expect(mid.yoursNo).toBe(2)
    expect(mid.refNo).toBe(2)
  })

  it('你少了一行 → `add`（参考解那一侧有内容，你这一侧是空的）', () => {
    const rows = expectLossless('a\nc', 'a\nb\nc')
    expect(rows.map((r) => r.kind)).toEqual(['same', 'add', 'same'])
    expect(rows[1].yoursNo).toBeNull()
    expect(rows[1].refNo).toBe(2)
  })

  it('你多了一行 → `remove`', () => {
    const rows = expectLossless('a\nb\nc', 'a\nc')
    expect(rows.map((r) => r.kind)).toEqual(['same', 'remove', 'same'])
    expect(rows[1].yoursNo).toBe(2)
    expect(rows[1].refNo).toBeNull()
  })

  it('空 vs 非空：一边是零行', () => {
    expect(diffLines('', 'a\nb').map((r) => r.kind)).toEqual(['add', 'add'])
    expect(diffLines('a\nb', '').map((r) => r.kind)).toEqual(['remove', 'remove'])
    expect(diffLines('', '')).toEqual([])
  })

  it('`\\r\\n` 的代码和 `\\n` 的参考解**不该判成"每一行都改过"**', () => {
    const rows = diffLines('int main(){\r\nreturn 0;\r\n}', 'int main(){\nreturn 0;\n}')
    expect(rows.every((r) => r.kind === 'same')).toBe(true)
  })
})

describe('对齐：连续多行的增删要配成对，不是错开着列', () => {
  it('整段三行换成另三行 → 三行 `change`，第 2 行在第 2 行上', () => {
    const rows = expectLossless('x\n1\n2\n3\ny', 'x\n一\n二\n三\ny')
    expect(rows.map((r) => r.kind)).toEqual(['same', 'change', 'change', 'change', 'same'])
    expect(rows[2]).toMatchObject({ yours: '2', ref: '二', yoursNo: 3, refNo: 3 })
  })

  it('删 3 行只插 1 行 → 一个 `change`，剩下两个是 `remove`', () => {
    const rows = expectLossless('a\n1\n2\n3\nz', 'a\nX\nz')
    expect(rows.map((r) => r.kind)).toEqual(['same', 'change', 'remove', 'remove', 'same'])
    // 配对出来的那一行，两边行号都落在**各自那一段的第一行**上
    expect(rows[1]).toMatchObject({ yours: '1', ref: 'X', yoursNo: 2, refNo: 2 })
  })

  it('插在中间的一段，配对之后多余的是 `add`', () => {
    const rows = expectLossless('a\nX\nz', 'a\n1\n2\n3\nz')
    expect(rows.map((r) => r.kind)).toEqual(['same', 'change', 'add', 'add', 'same'])
  })
})

// ──────────────────────────────────────────────────────────── 真内容回归网

/**
 * 拿内容包里的真 `codefix` / `codewrite` 当网 —— 手写用例盖不到"参考解长什么样"。
 *
 * 【为什么这条最值钱】比对表是给**卡住的学员**看的，而他会照着它去改代码。
 * 表算错了不会有人报错，只会让他改完还是错的、然后关掉软件。
 * 这里跑一遍全部真题目，把"LCS 在真数据上什么时候会崩"变成一条会变红的断言。
 */
interface RunGraded {
  type: string
  brokenCode?: string
  starter?: string
  referenceFix?: string
  referenceSolution?: string
}

/**
 * 扫一遍内容包，一次走完两件事：**找到多少道题**、**其中多少道是真跑题**。
 *
 * 【为什么两个数都要，而不是只返回真跑题】
 * 只看「真跑题 > 0」的话，这个网会把两种完全不同的处境判成同一件事：
 *   ① 遍历的路径写错了（`content/` 换过地方 / 层级少写一个 `..`）—— 网的失效
 *   ② 内容包这会儿还没浇铸真跑题（codefix/codewrite 是 M7 的 ⑤，还没做）—— 网的正常状态
 * 前者必须变红，后者不该变红。拿**找得到多少道题**当锚点就能分开这两者：
 * 路径一错它就归零，而内容里"还没写新题型"不影响它。
 * （2026-09-15 这条由红转绿：第一版只断言真跑题 > 0，结果它挂在②上，
 *   报的是「expected 0 to be greater than 0」—— 一条真话，但指错了方向。）
 */
function scanContent(): { total: number; runGraded: RunGraded[] } {
  const runGraded: RunGraded[] = []
  let total = 0
  const root = join(__dirname, '..', '..', '..', '..', '..', 'content')
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) {
        walk(p)
        continue
      }
      if (name !== 'questions.json') continue
      let data: unknown
      try {
        data = JSON.parse(readFileSync(p, 'utf8'))
      } catch {
        continue
      }
      const list = (data as { questions?: unknown }).questions
      if (!Array.isArray(list)) continue
      for (const q of list as RunGraded[]) {
        total++
        if (q.type === 'codefix' || q.type === 'codewrite') runGraded.push(q)
      }
    }
  }
  walk(root)
  return { total, runGraded }
}

describe('真内容回归网：每一道真跑题目的"你的代码 vs 参考解"都还原得回去', () => {
  const { total, runGraded: questions } = scanContent()

  it('遍历确实走进了内容包（网没空跑 —— 空网是假的绿）', () => {
    // 锚在"总题数"上，不是"真跑题数"：前者今天就是 58，路径一错立刻归零；
    // 后者今天确实是 0（真跑题型还没开始浇铸），拿它当锚会让这条网一直红着，
    // 而"一直红的守卫"和"没有守卫"是一回事 —— 谁都不再看它了。
    expect(total, '一道题都没扫到，多半是 content/ 的路径写错了').toBeGreaterThan(0)
  })

  // 标题里带上道数：今天内容包里是 0 道（真跑题型还没浇铸），
  // 于是这条会以「（0 道）」的样子出现在测试输出里 —— 一眼看得出它**在等米下锅**，
  // 而不是"跑了、绿了、放心了"。等内容里出现第一道 codefix，它自动开始盖。
  it(`每一道（今天 ${questions.length} 道）：无修改版和"改了一行"版都不丢行`, () => {
    for (const q of questions) {
      const mine = q.type === 'codefix' ? q.brokenCode ?? '' : q.starter ?? ''
      const ref = q.type === 'codefix' ? q.referenceFix ?? '' : q.referenceSolution ?? ''
      expect(mine.length, `${q.type} 的起始代码是空的`).toBeGreaterThan(0)
      expect(ref.length, `${q.type} 的参考解是空的`).toBeGreaterThan(0)

      // ① 原样对比
      expectLossless(mine, ref)
      // ② 学员改了一行之后再对比（把第一行替换掉）—— diff 的两侧都变了，
      //    比"一边原封不动"更容易暴露配对逻辑的问题
      expectLossless(`// 我改的第一行\n${mine}`, ref)
      // ③ 学员删掉了一行
      expectLossless(splitCodeLines(mine).slice(1).join('\n'), ref)
    }
  })
})
