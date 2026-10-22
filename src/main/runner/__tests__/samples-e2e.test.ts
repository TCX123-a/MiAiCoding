import { describe, expect, it } from 'vitest'
import { detectAll } from '../../env/detect'
import { runCode } from '../runner'
import { SAMPLE_UI } from '../../../shared/copy'
import { SAMPLES } from '../../../shared/samples'
import { LANG_OF_CODE, type EnvReport, type LangOfCode } from '../../../shared/types'

/**
 * 练习场示例代码的**端到端**校验：拿真实的 runCode() 真跑一遍，比对输出。
 *
 * 【为什么这条测试值得存在】
 * 仓库里 runner.test.ts 很全，但它全部用**假的/不存在的**工具路径——
 * 它验证的是「出错时提示对不对」，从没有一次真的把程序跑起来。
 * 于是「临时目录能不能建」「写文件编码对不对」「spawn 参数拼对没有」
 * 「输出解码回来还是不是中文」这一整条链路，此前**没有任何自动化覆盖**。
 * 而这些一旦坏掉，表现就是用户看到一堆乱码或一句空白失败。
 *
 * 【为什么用 runCode() 而不是直接 spawn gcc/python】
 * 因为要验的就是我们自己的那段管线。直接 `gcc main.c` 只能证明样例代码本身没写错，
 * 证明不了我们传的 -fexec-charset=UTF-8、注入的 PYTHONUTF8=1、
 * 把 stdout 按 UTF-8/GBK 三级回退解回来这一路是对的。
 * 中文有没有乱码，只有在**我们自己的解码路径**上跑才算数。
 *
 * 【没有工具链的机器上会怎样 —— 以及为什么这件事很危险】
 * 缺哪门语言就跳过哪门，不报红。理由：这是「环境依赖」的校验，不是纯逻辑；
 * 让没装 gcc 的机器整个测试套件变红，会让人开始习惯性忽略失败，那比不测更糟。
 *
 * ⚠️ **但跳过 = 没验过。** 2026-09-13 就是活生生的例子：
 * 本机当时没有 C/C++ 工具链，六条 C/C++ 样例长期处于「跳过」状态，
 * 而它们**其实一条都跑不起来**（spawn('prog.exe') 在 Windows 上只查 PATH、不看 cwd，
 * 编译产物就在手边也报 ENOENT）。装上 gcc 当天第一次真跑，六条全红。
 * 所以：纯逻辑的那部分必须由 runner.test.ts 的 resolveExe 那组兜住，
 * 不能指望这条测试在没有工具链的机器上帮你抓 bug。
 */
const report: EnvReport = await detectAll()

/** 这门语言的工具链在这台机器上就绪没有 */
const ready = (lang: LangOfCode): boolean => report[lang].found && !!report[lang].path

const notReady = LANG_OF_CODE.filter((l) => !ready(l))
if (notReady.length > 0) {
  // 刻意不静默：这些语言的用例会被跳过，不说一声的话，
  // 看日志的人会以为「这些用例都通过了」——而它们只是没跑。
  console.warn(
    `[samples-e2e] 这些语言没找到工具链，示例代码不会被真跑：${notReady.join(', ')}。` +
      '⚠️ 跳过 = 没验过，别把这行当成通过。'
  )
}

/** 换行规范化：Java 的 println 在 Windows 上吐 \r\n，界面显示是一样的 */
const norm = (s: string): string => s.replace(/\r\n/g, '\n')

/** 一次真跑要编译（C++ 展开头文件可能好几秒），给足余量，别让默认 5s 误杀 */
const RUN_TIMEOUT_MS = 60 * 1000

describe('示例代码端到端（走真实的 runCode）', () => {
  // 四语言 × 三示例 = 12 条，缺工具链的那几门自动跳过
  for (const s of SAMPLES) {
    for (const lang of LANG_OF_CODE) {
      it.skipIf(!ready(lang))(
        `「${SAMPLE_UI[s.key].label}」(${lang}) 跑出来的输出和 expectStdout 一字不差`,
        async () => {
          const run = s.byLang[lang]
          const r = await runCode(
            { lang, code: run.code, stdin: run.stdin, timeoutSec: 20 },
            report
          )

          // 先单独报「跑没跑成」：它失败时下面的输出比对必然也失败，
          // 两条混在一起看不出根因。
          expect(r.ok, `${lang} 样例代码自己就失败了：\n${r.stderr}`).toBe(true)
          expect(r.timedOut, '样例代码不该超时').toBe(false)
          expect(r.exitCode, `退出码应该是 0，stderr：\n${r.stderr}`).toBe(0)

          expect(norm(r.stdout)).toBe(run.expectStdout)
        },
        RUN_TIMEOUT_MS
      )
    }
  }

  it.skipIf(!ready('python'))(
    '中文原样回来，没有变成问号或乱码',
    async () => {
      // 单独再钉一次：上面那条用的是完整字符串比对，这条盯的是**编码本身**。
      // 比如将来有人把 decodeOutput 的 GBK 回退删了，某些环境下会退化成
      // latin1，中文就变成一串「ä½ å¥½」——全串比对能抓到，但报错信息
      // 会指向「输出不一致」，不如这条一眼看出是编码问题。
      const hello = SAMPLES.find((s) => s.key === 'hello')!
      const r = await runCode({ lang: 'python', code: hello.byLang.python.code }, report)

      expect(r.ok).toBe(true)
      expect(r.stdout, '中文没能原样回来——编码链路坏了').toContain('你好喵')
      expect(r.stdout, '出现了替换字符 U+FFFD，说明解码时丢字节了').not.toContain('�')
    },
    RUN_TIMEOUT_MS
  )

  it.skipIf(!ready('python'))(
    '同一个样例跑两次，输出完全一样（没有随机性、没有残留临时目录干扰）',
    async () => {
      // 临时目录是每次新建再删的。要是哪次没删干净、或复用了旧目录，
      // 表现是「偶尔跑出上一次的结果」——最难查的那种 bug。
      const m = SAMPLES.find((s) => s.key === 'math')!
      const req = { lang: 'python' as const, code: m.byLang.python.code }
      const a = await runCode(req, report)
      const b = await runCode(req, report)

      expect(a.ok && b.ok).toBe(true)
      expect(a.stdout).toBe(b.stdout)
    },
    RUN_TIMEOUT_MS
  )
})
