/*
 * 「编译过了、编译器却仍说了话」——这条通道（`RunResult.compileWarnings`）的端到端校验。
 *
 * 【为什么必须有这条测试】
 * 应用此前把**成功编译时的 stderr 整个丢掉**（`runner.ts` 里那个
 * `if (c.exitCode !== 0)` 一夹，成功那条路的 stderr 就没有出路了）。
 * 而实测 458 次成功编译里有 48 次仍往 stderr 吐了诊断，
 * 好几篇课文正讲着「翻译官喵会嘀咕一句 `warning: …`」——
 * 学员在练习场里一个字都看不到，只能当成课文在瞎说。
 *
 * 【为什么必须是"真跑"而不是纯逻辑单测】
 * 纯逻辑单测只能证明「给我一段 stderr，我算得对」，
 * 证明不了「我们真的把那段 stderr 接出来了」。而这条 bug 的**全身**就在接线那一处：
 * 逻辑本来就没写错，是那段字压根没被读。所以这里真起编译器。
 *
 * 【没有工具链的机器上会怎样】
 * 缺 C 工具链就跳过，不报红（理由同 samples-e2e）。
 * ⚠️ 但**跳过 = 没验过**——别把日志里的 skip 当成通过。
 */
import { describe, expect, it } from 'vitest'
import { runCode } from '../runner'
import { detectAll } from '../../env/detect'
import type { EnvReport } from '../../../shared/types'

const report: EnvReport = await detectAll()
const ready = report.c.found && !!report.c.path

if (!ready) {
  console.warn(
    '[compile-warnings-e2e] 本机没有 C 工具链，这条测试**不会跑**。' +
      '⚠️ 跳过 = 没验过，别把这行当成通过。'
  )
}

/** 编译一次 C 可能要好几秒（要展开头文件），给足余量 */
const RUN_TIMEOUT_MS = 60 * 1000
const norm = (s: string): string => s.replace(/\r\n/g, '\n')

describe('编译告警的带出（§35H）', () => {
  it.skipIf(!ready)(
    '编译成功但编译器说了话 → 走 compileWarnings，且**一个字都不许进 stdout**',
    async () => {
      const r = await runCode(
        {
          lang: 'c',
          // 没被用过的变量：`-Wall` 会当场嘀咕一句 unused variable
          code: [
            '#include <stdio.h>',
            'int main(void) {',
            '    int 没用上 = 0;',
            '    printf("ok\\n");',
            '    return 0;',
            '}'
          ].join('\n'),
          timeoutSec: 20
        },
        report
      )

      // 先单独报「跑没跑成」：它失败时下面每条断言都会连带失败，看不出根因
      expect({ ok: r.ok, phase: r.phase, stderr: r.stderr }).toEqual({
        ok: true,
        phase: 'run',
        stderr: ''
      })

      // ① 编译器说的话真的被接出来了
      expect(r.compileWarnings ?? '').toMatch(/warning:/)

      // ② 中文标识符必须**还原成人话**，不能是 gcc 转义过的 `\U00006ca1…`。
      //    gcc 打印标识符时一律转义非 ASCII 字符，而本项目的课文里
      //    中文标识符遍地都是 —— 不还原的话，「把编译器说的话还给学员」
      //    还回去的是一串乱码，学员宁可它别说。
      expect(r.compileWarnings ?? '').toContain("unused variable '没用上'")
      expect(r.compileWarnings ?? '').not.toContain('\\U0000')

      // ② **最要紧的一条**：告警绝不能出现在 stdout 里。
      //    判分是拿 stdout 逐字比的，掺一行 warning 就会变成
      //    「代码明明写对了却判错」，而且肉眼看输出一模一样，极难查。
      expect(norm(r.stdout)).toBe('ok\n')
      expect(r.stdout).not.toMatch(/warning:/)
      expect(r.stdout).not.toContain('unused')
    },
    RUN_TIMEOUT_MS
  )

  it.skipIf(!ready)(
    '编译器没吭声 → compileWarnings 是 undefined（不是空串）',
    async () => {
      const r = await runCode(
        {
          lang: 'c',
          code: '#include <stdio.h>\nint main(void){ printf("ok\\n"); return 0; }',
          timeoutSec: 20
        },
        report
      )

      expect(r.ok).toBe(true)
      // 为什么钉"undefined 而不是空串"：界面靠 `?? ''` 读它，
      // 两者都判得出"没有"。但 undefined 能区分「这条路根本没编译」
      // （Python）和「编译了、很干净」——空串会把两件事糊成一件。
      expect(r.compileWarnings).toBeUndefined()
      expect(norm(r.stdout)).toBe('ok\n')
    },
    RUN_TIMEOUT_MS
  )

  it.skipIf(!ready)(
    '编译**失败** → 不挂 compileWarnings（那段字已经是 stderr 的主角，挂上去就是同一段话显示两遍）',
    async () => {
      const r = await runCode(
        { lang: 'c', code: 'int main(void){ return 0 }', timeoutSec: 20 },
        report
      )

      expect(r.ok).toBe(false)
      expect(r.phase).toBe('compile')
      // 编译错的原文必须完整落在 stderr 里，一个字都不能丢
      expect(r.stderr.length).toBeGreaterThan(0)
      expect(r.compileWarnings).toBeUndefined()
    },
    RUN_TIMEOUT_MS
  )

  it.skipIf(!ready)(
    'Python 没有编译步骤 → compileWarnings 永远是 undefined',
    async () => {
      const r = await runCode(
        { lang: 'python', code: 'print("ok")', timeoutSec: 20 },
        report
      )
      expect(r.ok).toBe(true)
      expect(r.compileWarnings).toBeUndefined()
      expect(norm(r.stdout)).toBe('ok\n')
    },
    RUN_TIMEOUT_MS
  )
})
