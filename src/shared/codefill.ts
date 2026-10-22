/**
 * 代码填空题（`codefill`）的空位契约 —— **唯一真源**。
 *
 * 【这个文件存在的理由：空位有三处必须用同一套规则】
 *   1. **渲染**：把代码里的 `____` 换成 ①②③，学员才知道哪个空对应下面哪个输入框；
 *   2. **判分**：把学员填的一串答案按 `\n` 拆回一个一个空，逐个比对；
 *   3. **内容校验**：`content-validate.mjs` 数 `____` 的个数，必须等于 `blanks.length`。
 *
 * 三处各写一份正则的后果是**静默的**：正则要是漂了（比如有人觉得 4 个下划线太
 * 严、改成 3 个），渲染就会一个空都换不出来（代码原样显示 `____`，界面看起来
 * 只是"没编号"），而校验器还在数 4 个 —— 内容照样过闸门，题却废了。
 * 所以校验器那边（`scripts/content-validate.mjs`）**照着这个文件抄**，
 * 并且有一条单测读它的源码文本钉住这份抄写（见 `__tests__/codefill.test.ts`）。
 *
 * 【为什么答案用 `\n` 拼成一串，而不是让 store 存 `string[]`】
 * 整条作答链路 —— `QuizSession.answers`、`answerCurrent()`、`canSubmit`、
 * 错题本、挑战记账（`ChallengeAnswer.your`）、回顾页 —— 都假设**一题一个
 * 标量**（`string | number | null`）。让 codefill 独树一帜地存数组，就要把
 * 上面每一处都改成联合类型，而它们跟"填空有几个空"毫无关系。
 * 拼成一串则**一处都不用改**，代价只是要保证分隔符不出现在答案里 ——
 * 这一条由校验器强制（空位答案不得含换行），而且答案本来就是短标识符。
 *
 * 【为什么 `\n`，不用 `` 之类的控制符】
 * 控制符确实更"绝对安全"，但它是不可打印字符：这个值会顺着
 * `ChallengeAnswer.your` 进存档、进回顾页。控制符在那里会渲染成一段**看不见
 * 的东西**（"这题我当时填的什么？"——一片空白），而 `\n` 会规规矩矩换行显示。
 * 拿一个用户看得见的显示缺陷，去换一个校验器一行就能挡住的边界，不划算。
 */
import type { CodeFillQuestion } from './types'

/**
 * 空位标记：**连续 4 个及以上的下划线**。
 *
 * ⚠️ **故意不带 `g` 标志**。带 `g` 的正则对象会记住 `lastIndex`，
 * 于是 `/_{4,}/g.test(a)` 再 `/_{4,}/g.test(b)` 第二次可能返回 `false` ——
 * 同一个正则被两个地方共用就会"时灵时不灵"，而且**只在特定调用顺序下复现**。
 * 需要全局匹配的地方用 `globalMarker()` 现造一个（`String.replace`/`match`
 * 自带重置，但显式造一个更不容易被下一个人用错）。
 */
export const CODE_FILL_MARKER = /_{4,}/

/** 现造一个带 `g` 的同款正则。**别把这个函数的结果存进模块级变量** —— 那就又回到上面那个坑了 */
export function globalMarker(): RegExp {
  return new RegExp(CODE_FILL_MARKER.source, 'g')
}

/** 代码里有几个空。内容校验器拿它跟 `blanks.length` 对账 */
export function countCodeFillBlanks(code: string): number {
  return code.match(globalMarker())?.length ?? 0
}

/** 空位的显示标记。①②③ 在代码里一眼就能跟变量名、跟 `[1]` 这种下标区分开 */
const BLANK_MARKS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

/** 第 `i` 个空（0 起）的显示标记。超过 10 个空退回 `(11)` 这种写法 —— 正常内容到不了那儿 */
export function blankMark(i: number): string {
  return BLANK_MARKS[i] ?? `(${i + 1})`
}

/**
 * 把代码里的空位换成 ①②③，**给学员看的那一份**。
 *
 * 【为什么要在渲染前替换，而不是原样显示 `____`】
 * 一道题有两个以上的空时，学员看到的是「代码里两处 `____`」+「下面两个输入框」——
 * 他无法知道上面那个 `____` 对应下面哪一格。编号之后这个对应关系是**看出来的**，
 * 不用猜。
 *
 * 【替换发生在高亮之前】
 * 所以 ① 是**没有被高亮包起来**的裸字符 —— 正好，它本来就不是代码的一部分，
 * 不该被染成关键字色。反过来，先高亮再替换会去改已经生成的 HTML，
 * 那是往 HTML 里做字符串替换，迟早会把某个标签劈开。
 */
export function numberCodeFillBlanks(code: string): string {
  let i = 0
  return code.replace(globalMarker(), () => blankMark(i++))
}

/**
 * 学员在输入框里打了个换行 → **删掉**。
 *
 * 分隔符就是 `\n`，而空位答案是短标识符、按契约不含换行。所以一个输入框里
 * 出现换行只可能是**粘贴**进来的（多行代码粘进单行输入框），那部分内容是
 * 学员手滑带进来的，删掉是无损的；留着则会把后面所有空**整体错位一格** ——
 * 学员答对了却判错，而且看他自己的输入完全看不出来。
 */
export function stripNewlines(v: string): string {
  return v.replace(/[\r\n]+/g, '')
}

/** 各个输入框的值 → 会话里存的那一串。写入口，所以在这里顺手把换行清掉 */
export function joinCodeFillAnswer(values: readonly string[]): string {
  return values.map(stripNewlines).join('\n')
}

/**
 * 会话里那一串 → 各个输入框的值。
 *
 * `count` 是**空位的个数**（来自题目），不是 `joined` 里恰好有几段 ——
 * 学员只填了第一个空时 `joined` 是 `"int"`，拆出来只有一段，得补齐到
 * `count` 个，否则下面 `v-for` 渲染输入框时后两个会凭空消失。
 */
export function splitCodeFillAnswer(joined: string, count: number): string[] {
  const parts = joined.split('\n')
  const out: string[] = []
  for (let i = 0; i < count; i++) out.push(parts[i] ?? '')
  return out
}

/** 一道题是不是 codefill。给几处需要按题型分叉的地方共用一个判断 */
export function isCodeFill(q: { type: string }): q is CodeFillQuestion {
  return q.type === 'codefill'
}
