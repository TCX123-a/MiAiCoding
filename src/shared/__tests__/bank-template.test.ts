/**
 * 无限题库的**纯函数层**（`scripts/lib/bank.mjs`）单测。
 *
 * 【为什么这一层值得单测，而不是等闸门跑】
 * 闸门（`check-bank.mjs`）验的是"这道题对不对"，要起 gcc / javac / python，
 * 一道题几百毫秒。而这里验的是"模板 → 题的变换对不对"，**一次编译都不用起** ——
 * 参数枚举、占位符替换、随机数可重现、哈希什么时候该变，
 * 全是能在纸上推演的东西。
 *
 * ⚠️ 尤其要盯住的是**可重现性**：整个题库的"哈希对得上 = 验过了"这套机制，
 * 底下压着一个假设 —— **同样的输入必然产出同样的题**。这个假设一旦破了，
 * 表现不是报错，而是**每次重跑文件都变、闸门天天无缘无故变红**，
 * 最后所有人的反应是把闸门关掉。所以它得有一条专门的测试。
 *
 * 加载方式抄 `run-grading-script-parity.test.ts`：路径运行时算，
 * 不用字面量 import（那个文件在 `tsconfig` 的 include 之外，
 * 字面量 import 会直接把 `npm run typecheck` 弄红）。
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

interface BankModule {
  DEFERRED_PLACEHOLDERS: Set<string>
  enumerateParams(spec: unknown): Array<Record<string, string | number>>
  fill(tpl: string, params: Record<string, unknown>): string
  rngFrom(seed: string): () => number
  makeStdin(spec: unknown, params: Record<string, unknown>, seed: string): string | undefined
  drawInputs(
    spec: unknown,
    params: Record<string, unknown>,
    seed: string
  ): { sample: string | undefined; judge: string | undefined }
  paramsKey(params: Record<string, unknown>): string
  contentHash(item: Record<string, unknown>): string
  instantiate(
    tpl: Record<string, unknown>,
    params: Record<string, unknown>,
    inputs: { sample?: string; judge?: string }
  ): { draft: Record<string, string>; sampleInput: string | undefined }
  fillSample(stem: string, sampleInput?: string, sampleOutput?: string): string
  finalizeDraft(
    draft: Record<string, string>,
    sampleInput?: string,
    sampleOutput?: string
  ): Record<string, string>
}

const SCRIPT = join(process.cwd(), 'scripts', 'lib', 'bank.mjs')
let bank: BankModule | null = null
let loadError: string | null = null

beforeAll(async () => {
  try {
    bank = (await import(/* @vite-ignore */ pathToFileURL(SCRIPT).href)) as BankModule
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e)
  }
})

describe('题库纯函数层', () => {
  it('脚本能加载进来（加载不到就是闸门失效，不是"跳过"）', () => {
    expect(loadError, `加载 ${SCRIPT} 失败：${loadError}`).toBeNull()
    expect(bank).not.toBeNull()
  })
})

// ---------------------------------------------------------------- 参数枚举

describe('enumerateParams 参数域枚举', () => {
  it('做的是笛卡尔积，顺序稳定', () => {
    const out = bank!.enumerateParams({
      n: { kind: 'int', min: 3, max: 5 },
      u: { kind: 'pick', values: ['条', '颗'] }
    })
    expect(out).toEqual([
      { n: 3, u: '条' },
      { n: 3, u: '颗' },
      { n: 4, u: '条' },
      { n: 4, u: '颗' },
      { n: 5, u: '条' },
      { n: 5, u: '颗' }
    ])
    // 顺序稳定 = 同一个模板跑两次，第 k 个组合还是第 k 个组合
    expect(bank!.enumerateParams({ n: { kind: 'int', min: 3, max: 5 } })).toEqual([
      { n: 3 },
      { n: 4 },
      { n: 5 }
    ])
  })

  it('没有参数域 → 一套空参数（不是零套）', () => {
    expect(bank!.enumerateParams({})).toEqual([{}])
    expect(bank!.enumerateParams(undefined)).toEqual([{}])
  })

  it('值域写坏了要抛错，不能安静地枚举出 0 套', () => {
    // 枚举出 0 套的后果：这个模板一道题都产不出，而生成器会打印"完成"
    expect(() => bank!.enumerateParams({ n: { kind: 'int', min: 5, max: 3 } })).toThrow()
    expect(() => bank!.enumerateParams({ u: { kind: 'pick', values: [] } })).toThrow()
    expect(() => bank!.enumerateParams({ u: { kind: '魔法' } })).toThrow()
  })
})

// ---------------------------------------------------------------- 占位符

describe('fill 占位符替换', () => {
  it('把 {名字} 换成参数值', () => {
    expect(bank!.fill('捞 {n} 筐{unit}', { n: 4, unit: '小鱼干' })).toBe('捞 4 筐小鱼干')
  })

  it('{sampleInput} / {sampleOutput} 原样留下 —— 它们是"等一下再填"的空位', () => {
    const s = bank!.fill('输入是\n{sampleInput}\n输出是\n{sampleOutput}', { n: 3 })
    expect(s).toContain('{sampleInput}')
    expect(s).toContain('{sampleOutput}')
    expect(bank!.DEFERRED_PLACEHOLDERS.has('sampleInput')).toBe(true)
  })

  it('**只认标识符形状，别的花括号一律原样保留**', () => {
    /*
     * ⚠️ 这一条钉的是一个**刻意的取舍**，不是"还没做"。
     *
     * 上面 `fill` 的正则只认 `[A-Za-z_][A-Za-z0-9_]*`。放宽松（`\{([^{}]*)\}`）
     * 看上去能多认几种写法，代价却是**每一份 C / Java / C++ 模板都写不出来**：
     * 那些模板里有成片的 `int add(int a) {` / `    return a;` / `}`，
     * 宽松正则会把它们当成"引用了不存在的参数"而抛错。
     *
     * 所以这里断言的**不是**"非 ASCII 参数名会抛错"，而是"非标识符花括号
     * 根本不被当成占位符"。漏认的代价只是一个错别字（`{n }` 多打一个空格）
     * 会安静留在题面里 —— 那个由生成器的「题面里不该还有 `{...}`」检查兜底，
     * 它跑在实例化**之后**，那时代码块已经不在题面里了。
     */
    expect(bank!.fill('{没这个参数}', { n: 1 })).toBe('{没这个参数}')
    expect(bank!.fill('{a + b}', { a: 1, b: 2 })).toBe('{a + b}')
    expect(bank!.fill('{ n }', { n: 1 })).toBe('{ n }')
    // 而**真**引用了不存在的标识符，必须抛 —— 那是模板作者写错了名字
    expect(() => bank!.fill('卖 {n} 条{unit}', { n: 1 })).toThrow(/unit/)
    // 代码块原样穿过（这条正是上面那个取舍要保护的场景）
    expect(bank!.fill('int add(int a) {\n  return a;\n}', {})).toBe('int add(int a) {\n  return a;\n}')
  })
})

describe('fillSample 回填样例', () => {
  it('把两个占位符换成真内容，并去掉尾部换行', () => {
    const s = bank!.fillSample('输入：\n{sampleInput}\n输出：\n{sampleOutput}', '3\n5\n', '8\r\n')
    expect(s).toBe('输入：\n3\n5\n输出：\n8')
  })

  it('归一化走的是判分那条规则（CRLF、行尾空格、首尾空行）', () => {
    // 和判分用同一个 normalizeRunOutput：题面给别人看的，就是判分拿来比的
    const s = bank!.fillSample('{sampleOutput}', '', '  8  \r\n\r\n 10 \r\n\n\n')
    // `\r` 全没了、行尾空格削掉了、末尾三个空行抹平了 —— 但**中间那个空行留着**：
    // 归一化只削首尾，中间的空行是内容（比如程序故意打了两个空行分段）
    expect(s).toBe('  8\n\n 10')
    expect(s).not.toContain('\r')
  })

  it('样例输出里的 $ 是字面量，不能被 replace 当记号展开', () => {
    // `'x'.replace(/x/, '$&$&')` 会变成 'xx' —— 字符串替换值的经典坑。
    // 一道"算算花了多少钱"的题输出 `$5` 就会被静默改写成别的东西。
    expect(bank!.fillSample('{sampleOutput}', '', '$& 和 $1 和 $`')).toBe('$& 和 $1 和 $`')
  })

  it('题面用了 {sampleInput} 却没东西可填 → 抛错，不是留一串花括号给学员看', () => {
    expect(() => bank!.fillSample('输入\n{sampleInput}', undefined, '8')).toThrow(/sampleInput/)
    expect(() => bank!.fillSample('输出\n{sampleOutput}', '1', undefined)).toThrow(/sampleOutput/)
    // 题面**没用到**就相安无事：没有 stdin 的题（比如从零写一个打招呼程序）是合法的
    expect(bank!.fillSample('写个程序喵', undefined, undefined)).toBe('写个程序喵')
  })
})

describe('finalizeDraft 定稿（题面和解析一起管）', () => {
  it('**解析里的 {sampleInput} 也要回填** —— 这条是一条真实事故的回归测试', () => {
    // 2026-09-16：`py-s1-read-two-sum` 的解析里写着「哪怕你在键盘上敲的是 {sampleInput} 里的数」。
    // 当时的生成器只回填 `draft.stem`，于是这五个字母**随题库上了线**，
    // 七道闸门全绿，学员打开题就看见它。根因不是漏了一行，是同一个动作
    // 散在两处、只覆盖了一半输入 —— 所以修法是收成这一个函数。
    const draft = {
      stem: '输入\n{sampleInput}\n输出\n{sampleOutput}',
      explanation: '你敲的是 {sampleInput} 里的数'
    }
    bank!.finalizeDraft(draft, '3\n5\n', '8')
    expect(draft.stem).toBe('输入\n3\n5\n输出\n8')
    expect(draft.explanation).toBe('你敲的是 3\n5 里的数')
    expect(draft.explanation).not.toContain('sampleInput')
  })

  it('回填完还剩下花括号 → 抛错，且报错里点名是**哪个字段**', () => {
    // `fill()` 只认标识符形状，`{n }`（多打个空格）它认不出来、原样留在文本里，
    // 只有宽松形状的 leftoverPlaceholders 能看见。以前只查题面，解析漏网。
    expect(() =>
      bank!.finalizeDraft({ stem: '干净喵', explanation: '个数是 {n } 个' }, '1', '2')
    ).toThrow(/解析.*\{n \}/)

    expect(() => bank!.finalizeDraft({ stem: '个数是 {n } 个', explanation: '' }, '1', '2')).toThrow(
      /题面.*\{n \}/
    )
  })

  it('用了延迟占位符却没有内容可填 → 抛错，且报错区分得出题面还是解析', () => {
    expect(() => bank!.finalizeDraft({ stem: '输入\n{sampleInput}', explanation: '' })).toThrow(
      /题面/
    )
    expect(() => bank!.finalizeDraft({ stem: '干净喵', explanation: '看 {sampleOutput}' })).toThrow(
      /解析/
    )
  })

  it('两个字段都没用到占位符 → 原样返回，不误伤', () => {
    // 题面里偶尔出现的短花括号片段（中文里写"集合 {1,2}"）确实会被当可疑 ——
    // 但实测 57 道已产出的题 + 38 个模板的 1132 套参数里一处都没有。
    // 这条钉住的是"干净的草稿不会被拦"，不是"什么花括号都放行"。
    const draft = { stem: '写个程序喵', explanation: '本喵看好你喵～' }
    expect(bank!.finalizeDraft(draft, undefined, undefined)).toEqual(draft)
  })
})

describe('paramsKey 参数指纹（生成器靠它判"这套组合产过了没"）', () => {
  it('同样的参数 → 同样的键，**和书写顺序无关**', () => {
    expect(bank!.paramsKey({ n: 3, u: '颗' })).toBe(bank!.paramsKey({ u: '颗', n: 3 }))
    expect(bank!.paramsKey({ n: 3 })).toBe(bank!.paramsKey({ n: 3 }))
  })

  it('值变了键就变（不然新组合会被当成"产过了"而永远不产）', () => {
    expect(bank!.paramsKey({ n: 3 })).not.toBe(bank!.paramsKey({ n: 4 }))
    // 类型也要分得开：`3` 和 `'3'` 不是同一套参数
    expect(bank!.paramsKey({ n: 3 })).not.toBe(bank!.paramsKey({ n: '3' }))
  })
})

// ---------------------------------------------------------------- 可重现性

describe('随机数可重现 —— 整套哈希机制压在这个假设上', () => {
  it('同一个种子给出同一串数', () => {
    const a = bank!.rngFrom('py-s1-sum-loop|7|judge')
    const b = bank!.rngFrom('py-s1-sum-loop|7|judge')
    const seqA = [a(), a(), a()]
    const seqB = [b(), b(), b()]
    expect(seqA).toEqual(seqB)
  })

  it('换一个种子就换一串数', () => {
    const a = bank!.rngFrom('seed-a')
    const b = bank!.rngFrom('seed-b')
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()])
  })
})

describe('makeStdin 造程序输入', () => {
  const spec = { kind: 'ints', count: '{n}', min: 1, max: 9 }

  it('行数就是参数 n，数值落在值域里', () => {
    const s = bank!.makeStdin(spec, { n: 5 }, 'any')!
    const lines = s.replace(/\n+$/, '').split('\n')
    expect(lines.length).toBe(5)
    for (const l of lines) {
      const v = Number(l)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(9)
    }
  })

  it('可重现：同种子同输入', () => {
    expect(bank!.makeStdin(spec, { n: 4 }, 'k')).toBe(bank!.makeStdin(spec, { n: 4 }, 'k'))
  })

  it('ints-one-line 输出成一行', () => {
    const s = bank!.makeStdin({ kind: 'ints-one-line', count: '{n}', min: 1, max: 9 }, { n: 4 }, 'k')!
    expect(s.replace(/\n+$/, '').split('\n').length).toBe(1)
    expect(s.trim().split(' ').length).toBe(4)
  })

  it('raw 原样，且能带参数', () => {
    expect(bank!.makeStdin({ kind: 'raw', text: '{n}\n喵\n' }, { n: 3 }, 'k')).toBe('3\n喵\n')
  })

  it('head：先打一行 n，再打 n 个数（练习里最常见的形状）', () => {
    // 没有 head 就写不出「先读 n 再读 n 个数」—— 程序会先吃掉一个当 n，
    // 于是实际只拿到 n-1 个数，**而这不报错**，只是输出少加了一个数
    const s = bank!.makeStdin({ kind: 'ints', head: '{n}\n', count: '{n}', min: 1, max: 9 }, { n: 4 }, 'k')!
    const lines = s.replace(/\n+$/, '').split('\n')
    expect(lines[0]).toBe('4')
    expect(lines.length).toBe(5) // 1 行 n + 4 行数据
    // head 用的 n 和 count 用的 n 一定是同一个
    expect(s.split('\n')[0]).toBe(bank!.makeStdin({ kind: 'ints', head: '{n}\n', count: '{n}' }, { n: 4 }, 'k')!.split('\n')[0])
  })

  it('没有 spec → undefined（不是空串：空串会被当成"给了空输入"）', () => {
    expect(bank!.makeStdin(null, {}, 'k')).toBeUndefined()
  })
})

describe('drawInputs 样例输入必须和判分输入不同（docs/14 §5.2 规则 1）', () => {
  const spec = { kind: 'ints', count: '{n}', min: 1, max: 9 }

  it('两套输入不一样', () => {
    const { sample, judge } = bank!.drawInputs(spec, { n: 5 }, 'base')
    expect(sample).toBeDefined()
    expect(judge).toBeDefined()
    expect(sample).not.toBe(judge)
  })

  it('两套都可重现', () => {
    const a = bank!.drawInputs(spec, { n: 5 }, 'base')
    const b = bank!.drawInputs(spec, { n: 5 }, 'base')
    expect(a.sample).toBe(b.sample)
    expect(a.judge).toBe(b.judge)
  })

  /*
   * 这一条是"撞不上"这件事的**兜底**。
   * 参数值域太小的时候两套输入会抽到一样的——那时 `drawInputs` 必须**抛错**，
   * 不能默默返回两份相同的输入：那等于生产了一道 `print(样例答案)` 就能过的题，
   * 而且它看起来完全正常（有输入、有输出、跑得通）。
   */
  it('抽不出不同的两套时抛错，而不是默默给两份一样的', () => {
    const tiny = { kind: 'ints', count: '{n}', min: 1, max: 1 }
    expect(() => bank!.drawInputs(tiny, { n: 1 }, 'base')).toThrow(/different|不同/i)
  })

  /**
   * 【`raw` 这一组是 2026-09-16 补的，因为 `raw` 当时是**文档里写着支持、
   * 实际一跑就把生成器炸掉**的一档】
   *
   * `raw` 的正文是写死的，**不看种子** —— 所以上面那个"换种子重抽"的循环
   * 抽 50 次拿回来的还是同一串字，一路空转到头抛错。而那句报错写的是
   * 「多半是参数值域太小」：**一条把人引到错误方向的诊断，比不报错更费时间**
   * （模板作者会去翻参数域，而参数域完全没问题）。
   *
   * 现在 `raw` 走自己的路：要样例就显式给 `sampleText`，不给就是"这题没有样例"。
   */
  it('raw 不给 sampleText → 没有样例，判分输入原样（不抛错）', () => {
    const { sample, judge } = bank!.drawInputs({ kind: 'raw', text: '{n}\n喵\n' }, { n: 3 }, 'base')
    expect(judge).toBe('3\n喵\n')
    expect(sample).toBeUndefined() // 题面里也就不该出现 {sampleInput}
  })

  it('raw 给了 sampleText → 样例就是它，且必须真的和判分输入不同', () => {
    const spec = { kind: 'raw', text: '{a}\n', sampleText: '7\n' }
    const { sample, judge } = bank!.drawInputs(spec, { a: 3 }, 'base')
    expect(judge).toBe('3\n')
    expect(sample).toBe('7\n')
    expect(sample).not.toBe(judge)
  })

  it('raw 的 sampleText 和 text 一样时抛错，且报错**说对了原因**', () => {
    // 复制粘贴忘了改是最可能的写法。放过去的话等于把判分输入印在题面上，
    // 学员 print(样例答案) 就能过 —— 正是规则 1 要拦的那件事。
    const spec = { kind: 'raw', text: '{a}\n', sampleText: '{a}\n' }
    expect(() => bank!.drawInputs(spec, { a: 3 }, 'base')).toThrow(/sampleText 和 text 一模一样/)
  })
})

// ---------------------------------------------------------------- 哈希

describe('contentHash 内容指纹', () => {
  const item = {
    type: 'codewrite',
    lang: 'python',
    stem: '加起来',
    expectedOutput: '10',
    referenceSolution: 'print(10)',
    stdin: '3\n5\n2\n',
    explanation: '用循环'
  }

  it('同样的内容 → 同样的哈希', () => {
    expect(bank!.contentHash(item)).toBe(bank!.contentHash({ ...item }))
    expect(bank!.contentHash(item)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('**判分内容改一个字，哈希就变**', () => {
    // 这是验证戳的全部意义：改了 referenceFix 而忘了重验时，闸门要能自己发现
    expect(bank!.contentHash({ ...item, expectedOutput: '11' })).not.toBe(bank!.contentHash(item))
    expect(bank!.contentHash({ ...item, referenceSolution: 'print(1)' })).not.toBe(bank!.contentHash(item))
    expect(bank!.contentHash({ ...item, stdin: '1\n' })).not.toBe(bank!.contentHash(item))
    expect(bank!.contentHash({ ...item, stem: '加起来喵' })).not.toBe(bank!.contentHash(item))
    expect(bank!.contentHash({ ...item, explanation: '换个说法' })).not.toBe(bank!.contentHash(item))
  })

  it('**不影响判分的字段变了，哈希不变**（id / 模板溯源 / 参数）', () => {
    // 这条同样是刻意的：改一下 id 命名规则或参数名大小写，
    // 不该让 1100 道题全部重验一遍
    expect(bank!.contentHash({ ...item, id: '换个名字' })).toBe(bank!.contentHash(item))
    expect(bank!.contentHash({ ...item, templateId: 'x' })).toBe(bank!.contentHash(item))
    expect(bank!.contentHash({ ...item, params: { n: 9 } })).toBe(bank!.contentHash(item))
    expect(bank!.contentHash({ ...item, verified: { at: 'x' } })).toBe(bank!.contentHash(item))
  })

  it('codefix 与 codewrite 的同名字段不串味', () => {
    // brokenCode / referenceFix 与 starter / referenceSolution 是两组不同字段，
    // 一个缺省的字段不能和另一个"恰好也是空"的字段撞哈希
    const a = bank!.contentHash({ type: 'codefix', lang: 'c', stem: 's', brokenCode: 'x' })
    const b = bank!.contentHash({ type: 'codefix', lang: 'c', stem: 's', referenceFix: 'x' })
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------- 实例化

describe('instantiate 组装题目草稿', () => {
  const tpl = {
    templateId: 'py-s1-sum-loop',
    type: 'codewrite',
    lang: 'python',
    stemTemplate: '读入 {n} 个数，比如\n{sampleInput}\n就要输出\n{sampleOutput}',
    referenceSolutionTemplate: 'print({n})',
    explanationTemplate: '{n} 个数转 {n} 圈'
  }

  it('填参数、带 stdin、把 {sample*} 留成占位符', () => {
    const { draft, sampleInput } = bank!.instantiate(tpl, { n: 3 }, { sample: '1\n2\n3\n', judge: '4\n5\n6\n' })
    expect(draft.stem).toContain('读入 3 个数')
    expect(draft.stem).toContain('{sampleInput}')
    expect(draft.stdin).toBe('4\n5\n6\n')
    expect(draft.referenceSolution).toBe('print(3)')
    expect(draft.explanation).toBe('3 个数转 3 圈')
    expect(sampleInput).toBe('1\n2\n3\n')
  })

  it('codefix 走 brokenCode / referenceFix 那条路', () => {
    const fix = {
      ...tpl,
      type: 'codefix',
      brokenCodeTemplate: 'add({n})',
      referenceFixTemplate: 'add({n}, 1)'
    }
    const { draft } = bank!.instantiate(fix, { n: 2 }, { judge: '' })
    expect(draft.brokenCode).toBe('add(2)')
    expect(draft.referenceFix).toBe('add(2, 1)')
    expect(draft.referenceSolution).toBeUndefined()
  })

  it('题型写错了要抛错（题库只产真跑题）', () => {
    expect(() => bank!.instantiate({ ...tpl, type: 'choice' }, { n: 1 }, {})).toThrow()
  })
})
