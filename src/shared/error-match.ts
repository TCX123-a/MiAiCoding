/**
 * M5-04：内置错误库匹配（纯函数）。
 *
 * 【它在整个「报错讲解」里的位置】
 * 用户代码跑挂了 → 拿报错文本查内置规则库 → 命中就给猫咪解释（离线，零延迟）；
 * 没命中且用户配了 AI Key → 走 DeepSeek 兜底（M6-05）；都没有 → 通用兜底话术。
 * 这里是**第一跳**，也是绝大多数情况下的唯一一跳。
 *
 * 【为什么非要有它】
 * 零基础的人看到 `SyntaxError: invalid syntax` 这种原生报错，唯一反应是关掉软件。
 * 这个模块决定了「他写错了」之后发生的是「学到一句人话」还是「放弃」。
 *
 * 【规则的真源在 content/error-lib/*.json】
 * 不写在这个文件里，也不写在代码里 —— 因为那五个文件是 M7 由 AI 批量生成的，
 * 走的是和课文同一套校验流水线。这个文件只管**怎么用**规则，不管规则内容。
 */
import type { ErrorLib, ErrorRule, LangOfCode } from './types'

/** 匹配结果：命中的规则 + 三段已经回填好占位符、可以直接显示的文案 */
export interface ErrorMatch {
  rule: ErrorRule
  title: string
  explain: string
  fixHint: string
  /**
   * 这次填进 `{1}`..`{9}` 的内容，下标即组号。
   * 组没参与匹配（可选组没命中、或规则里根本没写这么多组）时该位是 undefined，
   * fillPlaceholders 会把对应占位符原样留着。测试与调试用。
   */
  vars: (string | undefined)[]
}

/**
 * 去掉 ANSI 颜色转义（`ESC [ 31 m` 这种）。
 *
 * 【为什么必须做】gcc/clang 输出带颜色时，是往字符流里插控制序列。规则库里写的是
 * `error: '([^']+)' was not declared`，而真实文本里夹着颜色码，正则**一个字符都对不上**——
 * 表现是「规则明明写了，就是命中不了」，而且本机好好的、别人机器上不行
 * （取决于那个终端支不支持彩色）。
 *
 * 【为什么写成 \x1b 而不是一个裸的 ESC 字节】
 * 这个项目已经被编码问题坑过：控制字符直接写进源码是**不可见**的，
 * 编辑器里那行长得完全正常（lint 也不报），但字节已经不是你以为的那个了。
 * 写成 \x1b 这种纯 ASCII 转义，任何人打开文件都能看出这里有个 ESC。
 */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
}

/**
 * 把 `{1}`..`{9}` 换成对应捕获组的内容。
 *
 * 【组不存在时故意留着占位符，不换成空串】
 * 留着的话，界面上一眼能看出「这里本该填个东西」；换成空串则会渲染成
 * 一句读得通、但缺了主语的话，看起来像是文案没写好，查半天查不到根上。
 * 真正该拦的地方是内容校验（每个 {n} 都必须有对应的捕获组），
 * 这条留在第 2 步补进 scripts/content-validate.mjs。
 */
export function fillPlaceholders(template: string, vars: (string | undefined)[]): string {
  return template.replace(/\{(\d)\}/g, (whole, d: string) => vars[Number(d)] ?? whole)
}

/** 编译规则的正则；规则写坏了返回 null，绝不抛 —— 数据文件不该有能力让应用崩掉 */
function compile(rule: ErrorRule): RegExp | null {
  try {
    return new RegExp(rule.pattern, rule.flags)
  } catch {
    return null
  }
}

/**
 * 拿报错文本去查规则库。
 *
 * 【顺序即优先级】
 * 先按语言查（`lib[lang]`），再查 `lib.common` 兜底；
 * **同一边内按规则在 JSON 里的书写顺序**，先命中先用。
 * 所以 M7 生成规则时必须把更具体的排在更笼统的前面
 * （例如「少分号」要排在「语法错误」前面）——这条契约要写进 docs/09 的生成规范。
 *
 * 【匹配的是整段输出，不是「关键行」】
 * docs/08 原先写的是「提取关键行」，实测下来那一步只会多一种失败方式：
 * 编译器把一条错误拆成好几行（报错行 + `^^^` 指示行 + note 行），
 * 规则要匹配的内容可能正好被切走，于是「规则明明写了却命中不了」。
 * 直接对整段文本跑正则，匹配不到就是不匹配，行为可预测。
 *
 * @param output 报错文本（stderr 优先，没有就传 stdout —— 有的工具把错误写标准输出）
 * @returns null = 没命中，交给上层走后续兜底
 */
export function matchError(
  lib: ErrorLib | undefined,
  lang: LangOfCode,
  output: string
): ErrorMatch | null {
  if (!lib || !output) return null
  const text = stripAnsi(output)

  for (const rules of [lib[lang], lib.common]) {
    for (const rule of rules ?? []) {
      const re = compile(rule)
      if (!re) continue // 坏规则跳过，不影响后面能用的规则
      const m = re.exec(text)
      if (m) return toMatch(rule, m)
    }
  }
  return null
}

/** 把一次正则命中变成可直接显示的文案 */
function toMatch(rule: ErrorRule, m: RegExpExecArray): ErrorMatch {
  // 下标即组号：vars[1] 对应 {1}。不加 m[0]（整个匹配）——{0} 目前没有规则在用，
  // 与其留一个没人验证过的语义，不如让 {0} 就当普通占位符原样显示出来。
  const vars: (string | undefined)[] = []
  for (let i = 1; i <= 9; i++) vars[i] = m[i]
  return {
    rule,
    vars,
    title: fillPlaceholders(rule.title, vars),
    explain: fillPlaceholders(rule.explain, vars),
    fixHint: fillPlaceholders(rule.fixHint, vars)
  }
}
