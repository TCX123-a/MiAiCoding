/**
 * 「用了 `<stdexcept>` 里的异常类型，却没 `#include <stdexcept>`」—— 2026-09-28 加。
 *
 * 【为什么这是一条真 bug，而不是「老编译器太挑」】
 * `invalid_argument` / `out_of_range` / `runtime_error` 这些名字**住在 `<stdexcept>` 里**。
 * 老 libstdc++（朋友的 Dev-C++ 自带 TDM-GCC 4.9.2）不会替你转交，于是
 *
 *     } catch (const invalid_argument& e) {
 *
 * 里的名字压根没声明 —— 老 g++ 报的是 `error: expected ')' before '&' token`：
 * 它**指着 `&`**，和真正的原因隔着十万八千里。新 libstdc++ 的 `<string>` 顺手把
 * `<stdexcept>` 也带进来了，所以在开发机上永远看不见，`check:samples` 也一直是绿的。
 * 换句话说：这段代码靠的是**别人的传递包含**，本身就不该成立 —— 补一行 include 就对，
 * 不用换编译器。（2026-09-28 实测：`cpp-stage1-13` 那 8 道题加一行就从 8/8 编不过变成 0/8。）
 *
 * 【判据为什么不能是「出现过这个名字」】
 * 课文里到处是「`invalid_argument` 就是『参数不合法』那种异常」这种讲解，提一句名字不算病。
 * **只有「编译器必须先认识这个类型」的位置才算**：`catch (...)` 的参数、`throw` 后面跟的类型名。
 * 这两个位置以外的出现（注释、讲解、字符串、`std::` 限定也一样）都不查。
 *
 * 【为什么是独立一份、而不是各处抄一遍】
 * 两条闸门都要用它：`content-validate.mjs`（课文 + `questions.json`）和
 * `check-bank.mjs`（题库，**它不走 content-validate**，所以只加一边等于那 12 处没人看）。
 * 抄两份的下场在别的模块已经演过：规则漂了以后，一边报错一边放行，
 * 而两边看上去都对。所以只留这一份，两边都引它。
 */

export const STDEXCEPT_TYPES = [
  'invalid_argument',
  'out_of_range',
  'runtime_error',
  'logic_error',
  'overflow_error',
  'length_error',
  'domain_error',
  'range_error',
  'underflow_error'
]

const 类型RE = new RegExp(`\\b(${STDEXCEPT_TYPES.join('|')})\\b`)

/**
 * 这段代码「用了 `<stdexcept>` 的类型却没 include」吗？
 * @param {unknown} code
 * @returns {string|null} 出问题的那个类型名；没问题返回 null
 */
export function missingStdexceptType(code) {
  if (typeof code !== 'string' || !code.trim()) return null
  if (/#\s*include\s*<stdexcept>/.test(code)) return null
  for (const m of code.matchAll(/\bcatch\s*\(([^)]*)\)/g)) {
    const hit = 类型RE.exec(m[1])
    if (hit) return hit[1]
  }
  for (const m of code.matchAll(/\bthrow\s+(?:std\s*::\s*)?([A-Za-z_]\w*)/g)) {
    if (STDEXCEPT_TYPES.includes(m[1])) return m[1]
  }
  return null
}

/** 人话版的报错文案（两处闸门共用，免得同一个病两种说法） */
export function stdexceptMessage(类型名, 在哪) {
  return (
    `${在哪} 用了 ${类型名} 却没 #include <stdexcept> —— ` +
    `老编译器（Dev-C++ 自带的 TDM-GCC 4.9.2）不会替你转交，它报的是 ` +
    `expected ')' before '&' token，指不到病根。补一行 include 就好`
  )
}
