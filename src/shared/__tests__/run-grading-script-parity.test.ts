/**
 * 「脚本里的实现」和「应用里的实现」是不是同一份 —— 真跑判分的**第四条链路**。
 *
 * 【为什么需要这个文件】
 * 真跑题型（`codefix` / `codewrite`）的判分规则（`normalizeRunOutput` 那四条）
 * 一共存在**两份实现**，而且两份都必须有：
 *
 *   · `src/shared/run-grading.ts` —— 学员点提交时判分的那个（TypeScript）
 *   · `scripts/lib/run-code.mjs` —— 内容侧验参考解的那个（裸 node 跑的 .mjs）
 *
 * 分不开的原因是硬的：内容脚本要能在**没有构建、没有 TypeScript、没有 Electron**
 * 的裸 node 上跑（`npm run check:questions` 就一句 `node scripts/...`），
 * 所以它 import 不了 `.ts`。于是只能抄一份。
 *
 * 【抄一份的代价，以及这个文件怎么把它补上】
 * 两份漂了的症状是**最坏的那种**：内容侧说「这道题的参考解合格」，
 * 而学员在应用里**永远判错** —— 而且两份输出肉眼看一模一样（差的是 `\r`、
 * 是行尾空格、是看不见的字符）。查都没法查。
 *
 * ⚠️ 所以这里**不是读源码文本比对**（那种办法拦不住"逻辑抄错了"，只拦得住
 * "改了其中一处"），而是**把脚本真身加载进来、喂同一批输入、逐条断言结果相同**。
 * 项目里其它闸门（`codefill.test.ts` / `ipc-wiring.test.ts`）用读文本的办法
 * 是因为那些是**正则字面量**；这里能拿到函数本身，就没有理由退而求其次。
 *
 * 【加载失败必须报红，不能跳过】
 * 「文件挪了 → 加载不到 → 静默跳过 → 全绿」正是项目铁律里骂的那件事
 * （静默跳过 = 把「没验过」伪装成「验过了」）。所以有一条专门的测试盯着加载结果。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { gradeByRun, normalizeRunOutput } from '../run-grading'
import { maskComments } from './mask-comments'

interface RunCodeModule {
  normalizeRunOutput(s: string): string
  gradeByRun(expected: string, actual: string): boolean
  findJavaClass(code: string): string | null
  planForLang(lang: string, code: string): { srcFile: string; error?: string }
  LANGS: Record<string, { compile: string[]; run: string[]; src: string }>
}

const root = process.cwd()
const SCRIPT = join(root, 'scripts', 'lib', 'run-code.mjs')

let script: RunCodeModule | null = null
let loadError: string | null = null

beforeAll(async () => {
  try {
    // ⚠️ 路径是**运行时算出来的**，所以 TypeScript 不会去做静态解析 ——
    // 这不是偷懒：那个文件是 `.mjs`、在 `tsconfig` 的 include 之外，
    // 用字面量 import 会直接把 `npm run typecheck` 弄红。
    script = (await import(/* @vite-ignore */ pathToFileURL(SCRIPT).href)) as RunCodeModule
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e)
  }
})

describe('内容脚本的规范化 == 应用的规范化', () => {
  it('脚本能加载进来（加载不到就是闸门失效，不是"跳过"）', () => {
    // 这条要单独存在：文件被挪走 / 改了名 / 顶层加了副作用导致 import 抛错时，
    // 下面那些断言会因为 `script` 是 null 而**全部报错**，但报的是
    // 「Cannot read properties of null」这种指向错误方向的错。这条给一句人话。
    expect(loadError, `加载 ${SCRIPT} 失败：${loadError}`).toBeNull()
    expect(script, '脚本没加载成功').not.toBeNull()
  })

  /**
   * 喂进去的每一份都对应一条**真会出现的**东西：
   * 真机上的 CRLF、行尾空格、末尾空行、中文加全角空格、缩进……
   * 少了哪一类，那一类漂了也测不出来。
   */
  const SAMPLES = [
    '',
    '\r\n',
    '\r',
    '3',
    '3\r\n',
    '3\n',
    'a\r\nb',
    'a\rb',
    'a\r\r\nb',
    'a  \nb\t\n',
    'a   \r\nb',
    '\n\na\n\n',
    'a\n\nb', // 中间的空行是内容，必须留着
    '   a\n  bb', // 行首空格是内容
    'a b',
    'Hello',
    'hello',
    '喵',
    '喵　', // 全角空格不是行尾空白
    '喵 ',
    '第一行\r\n第二行\r\n',
    '  \t  ',
    '\n'
  ]

  it(`同一批输入（${SAMPLES.length} 份）逐条结果相同`, () => {
    if (!script) throw new Error('脚本没加载成功')
    for (const s of SAMPLES) {
      const mine = script.normalizeRunOutput(s)
      const app = normalizeRunOutput(s)
      // 断言里带上原始字节：这类 bug 出问题时，人眼看这两行是一样的，
      // 必须把转义后的形态打出来才查得下去
      expect(mine, `normalizeRunOutput(${JSON.stringify(s)}) 两份实现不一致`).toBe(app)
    }
  })

  it('四条规则的**边界**两边都一致（不只是"结果碰巧一样"）', () => {
    if (!script) throw new Error('脚本没加载成功')
    // 挑几条最容易抄漏的，把期望值也写死 —— 万一两份实现**一起错**，
    // 上面那条「结果相同」是拦不住的，这条能。
    expect(script.normalizeRunOutput('3\r\n')).toBe('3')
    expect(script.normalizeRunOutput('a\n\nb')).toBe('a\n\nb')
    expect(script.normalizeRunOutput('   a\n  bb')).toBe('   a\n  bb')
    expect(script.normalizeRunOutput('喵　')).toBe('喵　')
    expect(script.normalizeRunOutput('Hello')).not.toBe(script.normalizeRunOutput('hello'))
  })

  it('gradeByRun 两边对同一组配对给同一个答案', () => {
    if (!script) throw new Error('脚本没加载成功')
    const pairs: [string, string][] = [
      ['3', '3'],
      ['3', '3\r\n'],
      ['a\nb', 'a\r\nb\r\n'],
      ['a\nb', 'a'],
      ['a', 'a\nb'],
      ['a b', 'a  b'],
      ['Hello', 'hello'],
      ['', ''],
      ['', 'x'],
      ['第一行\n第二行', '第一行\r\n第二行\r\n']
    ]
    for (const [want, got] of pairs) {
      expect(script.gradeByRun(want, got), `gradeByRun(${JSON.stringify(want)}, ${JSON.stringify(got)}) 两份实现不一致`).toBe(
        gradeByRun(want, got)
      )
    }
  })
})

/**
 * Java 类名正则在**三个地方**出现：`runner.ts`（真源）、`scripts/lib/run-code.mjs`
 * （内容脚本）、以及应用运行器对学员代码的抠名。
 *
 * 这一条只能读文本 —— `runner.ts` import 了 `electron`，在 node 环境的单测里
 * 加载不起来。读文本的部分用 `maskComments` 剥掉注释：本仓库的注释里为了讲清规则
 * 写了大量和代码长得一样的示例（本文件上面就有），不剥的话会被自己的说明绊倒。
 */
describe('Java 类名正则：应用和脚本抄的是同一个', () => {
  const JAVA_CLASS_RE = 'public\\s+(?:(?:final|abstract|sealed)\\s+)*class\\s+([A-Za-z_$][\\w$]*)'

  it('runner.ts 里有这个正则', () => {
    const src = maskComments(readFileSync(join(root, 'src', 'main', 'runner', 'runner.ts'), 'utf8'))
    expect(src, 'runner.ts 的 findJavaClass 正则变了？两边必须一起改').toContain(JAVA_CLASS_RE)
  })

  it('scripts/lib/run-code.mjs 里有同一个正则', () => {
    const src = maskComments(readFileSync(SCRIPT, 'utf8'))
    expect(src, '脚本里的类名正则和 runner.ts 漂了 —— 同一个 class 会在一边编得过、一边编不过').toContain(
      JAVA_CLASS_RE
    )
  })

  it('脚本真能从代码里抠出类名（读文本之外，行为也验一遍）', () => {
    if (!script) throw new Error('脚本没加载成功')
    expect(script.findJavaClass('public class Cat { }')).toBe('Cat')
    expect(script.findJavaClass('class Dog { }')).toBe('Dog')
    expect(script.findJavaClass('int main(void){ return 0; }')).toBeNull()
    // 抠出来的类名要真的变成文件名 —— 这是它存在的唯一理由
    expect(script.planForLang('java', 'public class Cat { }').srcFile).toBe('Cat.java')
  })
})

/**
 * 编译参数也必须逐字相同（2026-09-28 加）。
 *
 * 【为什么这条比上面那些更值得钉】
 * 上面几条盯的是**判分**（输出规范化），漂了至少能在本机看见。
 * 这条盯的是**参数**，而参数漂了的症状是：`npm run check:x` 全绿、
 * 应用在本机也全绿 —— 因为开发机的编译器**默认方言够新**，缺了 `-std`
 * 照样编得过。等到别人的老编译器上一大批题做不了才发现，而那时
 * 谁也不会想到去比对两个文件里的字符串数组。
 *
 * 不是假想：2026-09-28 实测，朋友的 Dev-C++（TDM-GCC 4.9.2）默认 gnu89/gnu++98，
 * 不写 `-std=` 时有 413 道题编不过（C 253 + C++ 160），而本机新 gcc 一道都不挂。
 *
 * ⚠️ runner.ts import 了 electron，在 node 环境的单测里加载不起来，
 * 所以这条只能「脚本侧拿真身、应用侧读文本」——两边都不是纯文本比对，
 * 至少脚本那边是真数组。
 */
describe('编译参数：应用和脚本抄的是同一份', () => {
  const runnerSrc = maskComments(readFileSync(join(root, 'src', 'main', 'runner', 'runner.ts'), 'utf8'))

  /** 从 runner.ts 里抠出某个源文件对应的编译参数数组（含源文件名那一项） */
  const 应用侧参数 = (srcFile: string): string[] => {
    const m = new RegExp(`args: \\[([^\\]]*'${srcFile.replace('.', '\\.')}')\\]`).exec(runnerSrc)
    if (!m) throw new Error(`runner.ts 里找不到 ${srcFile} 的编译参数 —— 正则或那行代码变了`)
    return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1])
  }

  it('C：脚本的参数 == runner.ts 的参数（去掉开头的 exe）', () => {
    if (!script) throw new Error('脚本没加载成功')
    expect(
      script.LANGS.c.compile.slice(1),
      'C 的编译参数在 runner.ts 和 scripts/lib/run-code.mjs 之间漂了 —— 闸门会在开发机上全绿，而老编译器那台机器上一批题做不了'
    ).toEqual(应用侧参数('main.c'))
  })

  it('C++：脚本的参数 == runner.ts 的参数（去掉开头的 exe）', () => {
    if (!script) throw new Error('脚本没加载成功')
    expect(
      script.LANGS.cpp.compile.slice(1),
      'C++ 的编译参数两边漂了 —— 同上'
    ).toEqual(应用侧参数('main.cpp'))
  })

  it('两边都真的带着 -std（这条不许被"删掉就绿"）', () => {
    if (!script) throw new Error('脚本没加载成功')
    expect(script.LANGS.c.compile).toContain('-std=gnu11')
    expect(script.LANGS.cpp.compile).toContain('-std=gnu++14')
    expect(应用侧参数('main.c')).toContain('-std=gnu11')
    expect(应用侧参数('main.cpp')).toContain('-std=gnu++14')
  })
})

/**
 * 校验器那边的登记（照 `codefill.test.ts` 的做法，读源码文本）。
 * 少登记一处 = 整批内容报「题型非法」，而生成代理会以为是自己写错了。
 */
describe('内容校验器认得出这两个新题型', () => {
  const validatorSrc = maskComments(readFileSync(join(root, 'scripts', 'content-validate.mjs'), 'utf8'))

  it('白名单里有 codefix 和 codewrite', () => {
    expect(validatorSrc).toContain("q.type === 'codefix' || q.type === 'codewrite'")
  })

  it('查了「expectedOutput 不能是空的」这件事', () => {
    // 这条被删掉的话，「删光代码也能过」那个洞就重新打开了
    expect(validatorSrc).toMatch(/expectedOutput 是空的/)
  })

  it('查了「两个题型的字段被写混」这件事', () => {
    expect(validatorSrc).toMatch(/两个题型写混了/)
  })
})
