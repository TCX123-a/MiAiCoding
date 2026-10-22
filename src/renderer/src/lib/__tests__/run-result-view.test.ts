import { describe, expect, it } from 'vitest'
import { RUNNER as RUNNER_MSG } from '../../../../shared/copy'
import { CRASH_UI, ERROR_UI, RUNNER_UI } from '../copy'
import { runView } from '../run-result-view'
import type { RunResult } from '../../../../shared/types'

/**
 * 运行面板的「状态表」闸门。
 *
 * 每一格搞错的后果都是用户直接看到的：
 *   - 超时显示成「跑完啦」→ 用户以为程序正常结束，对着空输出发呆
 *   - 环境没装却甩出 "spawn gcc ENOENT" → 零基础用户被英文报错吓退
 *   - 程序什么都没打印时界面一片空白 → 用户以为软件卡死了
 * 这些都不会让任何东西报错，只会让人困惑，所以必须靠机器钉住。
 */

function r(over: Partial<RunResult> = {}): RunResult {
  return {
    ok: true,
    phase: 'run',
    stdout: '',
    stderr: '',
    exitCode: 0,
    timedOut: false,
    truncated: false,
    durationMs: 120,
    ...over
  }
}

/**
 * 估算一段文字占多少个 ch 单位，用来和 CSS 里的 `max-width: 42ch` 比。
 *
 * ⚠️ 不能直接拿 `s.length` 去比。ch = 当前字体里「0」的宽度，
 * 而中日韩全角字符宽度约等于两个「0」——38 个汉字实际占约 76ch，
 * 早就超过 42ch 了，可字符串长度只有 38，看起来「没超」。
 * 拿长度去比就是拿苹果比橘子，会得出完全相反的错误结论。
 * （这条就是我第一版写错的地方，被测试自己抓出来了。）
 */
function chWidth(s: string): number {
  let w = 0
  for (const c of s) w += /[⺀-鿿＀-￯　-〿]/.test(c) ? 2 : 1
  return w
}

describe('runView 状态表', () => {
  it('还没跑过 → idle，不给状态文案', () => {
    const v = runView(null, false)
    expect(v.phase).toBe('idle')
    expect(v.statusText).toBe('')
    expect(v.showNoOutput).toBe(false)
    expect(v.showDuration).toBe(false)
  })

  it('正在跑 → running，且此时不该显示任何「结果」（上一次的也不行）', () => {
    // 这条是「别让用户以为电脑卡死了」的另一半：
    // 跑的时候必须明确是 running，不能把上一次的结果挂着充数
    const v = runView(null, true)
    expect(v.phase).toBe('running')
    expect(v.statusText).toBe('')

    // 就算手里还攥着上一次的结果，running 期间也必须报 running
    const v2 = runView(r({ stdout: '旧输出' }), true)
    expect(v2.phase).toBe('running')
    expect(v2.statusText).toBe('')
  })

  it('正常跑完有输出 → ok，显示输出与用时', () => {
    const v = runView(r({ stdout: '你好喵' }), false)
    expect(v.phase).toBe('done')
    expect(v.tone).toBe('ok')
    expect(v.statusText).toBe(RUNNER_UI.OK)
    expect(v.stdout).toBe('你好喵')
    expect(v.showNoOutput).toBe(false)
    expect(v.showDuration).toBe(true)
  })

  it('编译错和运行错要分开说（学生最常撞的是编译错）', () => {
    const compile = runView(r({ ok: false, phase: 'compile', stderr: 'error: ...' }), false)
    expect(compile.statusText).toBe(RUNNER_UI.COMPILE_FAILED)
    expect(compile.tone).toBe('bad')
    expect(compile.showStderr, '编译器原话是最有价值的线索，必须显示').toBe(true)

    const runtime = runView(r({ ok: false, phase: 'run', stderr: 'Traceback' }), false)
    expect(runtime.statusText).toBe(RUNNER_UI.FAILED)
    expect(runtime.showStderr).toBe(true)
  })

  it('超时必须说「被按停了」，不能混进普通失败', () => {
    const v = runView(r({ ok: false, timedOut: true, durationMs: 10000 }), false)
    expect(v.statusText).toBe(RUNNER_UI.TIMED_OUT)
    expect(v.tone).toBe('bad')
  })

  it('环境没装：显示主进程给的猫咪解释 + 引导去设置，但不甩系统英文报错', () => {
    const v = runView(
      r({
        ok: false,
        phase: 'compile',
        message: RUNNER_MSG.ENV_MISSING('c'),
        envIssue: true,
        // 真实情况下 stderr 里躺着的是 "spawn gcc ENOENT" 这类系统原话
        stderr: 'spawn gcc ENOENT',
        durationMs: 0
      }),
      false
    )
    expect(v.envIssue).toBe(true)
    expect(v.statusText).toBe(RUNNER_MSG.ENV_MISSING('c'))
    expect(v.showStderr, '零基础用户看到 ENOENT 只会被吓退，而上面那句已经讲清楚了').toBe(false)
    expect(v.showDuration, '环境没装就返回了，用时 0.00 秒是废话').toBe(false)
  })

  it('主进程给的解释必须整段显示，不能被结果条截成半句话', () => {
    // 结果条是单行省略号截断的（RunnerPanel.vue 的 .out-status-text 上
    // 写着 max-width: 42ch）。整段解释塞进去会被切掉尾巴，
    // 用户看到「还没有找到C的翻译官喵～去「设置」…」——后半截最关键
    // 的「怎么办」就没了。
    const long = RUNNER_MSG.ENV_MISSING('c')
    expect(chWidth(long), '前提：这条解释确实超出结果条能装下的宽度').toBeGreaterThan(42)

    const v = runView(r({ ok: false, phase: 'compile', message: long, envIssue: true }), false)
    expect(v.showMessage, '有 message 就必须走正文块完整显示').toBe(true)

    // 反过来：没有 message 的普通失败，结果条一句话就够，不该再多占一块
    const plain = runView(r({ ok: false, phase: 'compile', stderr: 'error: ...' }), false)
    expect(plain.showMessage).toBe(false)
    expect(plain.statusText).toBe(RUNNER_UI.COMPILE_FAILED)

    // 短状态文案必须留在结果条上：它和用时并排显示，挤到正文块里反而割裂
    const ok = runView(r({ stdout: 'hi' }), false)
    expect(ok.showMessage).toBe(false)
    expect(chWidth(RUNNER_UI.OK), '「✓ 跑完啦」就该是短的').toBeLessThan(42)
  })

  it('Java 没有 class 是**代码**问题不是环境问题（不该引导去装环境）', () => {
    const v = runView(r({ ok: false, phase: 'compile', message: RUNNER_MSG.NO_JAVA_CLASS }), false)
    expect(v.envIssue).toBe(false)
    expect(v.statusText).toBe(RUNNER_MSG.NO_JAVA_CLASS)
  })

  it('输出被截断 → 黄色提醒，但不算失败', () => {
    const v = runView(r({ stdout: '一大坨输出', truncated: true }), false)
    expect(v.tone).toBe('warn')
    expect(v.statusText).toBe(RUNNER_UI.OK)
    expect(v.truncated, '截断了就得说一声，不然用户以为自己程序只输出这么点').toBe(true)
  })

  it('正在跑的时候不显示「被截断」——上一次的截断标记不能挂在新一轮上', () => {
    const v = runView(r({ stdout: '旧的一大坨', truncated: true }), true)
    expect(v.truncated).toBe(false)
    expect(v.phase).toBe('running')
  })

  it('跑完了但没打印任何东西 → 必须给句话，不能留一片空白', () => {
    const v = runView(r({ stdout: '   \n  ' }), false)
    expect(v.showNoOutput, '空白会让人以为软件卡死了').toBe(true)
    expect(v.tone).toBe('ok')
  })

  it('报错时即使 stdout 为空也不该误报「什么都没打印」', () => {
    const v = runView(r({ ok: false, stderr: 'boom' }), false)
    expect(v.showNoOutput).toBe(false)
  })
})

/**
 * 报错讲解卡（M5-04）。
 *
 * 「什么时候**不该**显示」比「什么时候显示」更重要 —— 卡片位置在原始报错上面、
 * 又长，出现在不该出现的场合就是挡路；更糟的是「环境没装」那种，
 * 盖一张「这条错喵没学过」等于把人往错误方向带。
 */
describe('runView 报错讲解卡', () => {
  const LIB = {
    python: [
      {
        pattern: "NameError: name '([^']+)' is not defined",
        title: '「{1}」还没建起来喵',
        explain: '先写一句 {1} = 值 喵',
        fixHint: '补上 {1} 喵'
      }
    ],
    java: [
      {
        pattern: 'cannot find symbol',
        title: '有名字 javac 不认识喵',
        explain: '解释',
        fixHint: '建议'
      }
    ],
    common: [{ pattern: 'No such file', title: '通用规则喵', explain: '解释', fixHint: '建议' }]
  }

  const pyErr = r({
    ok: false,
    phase: 'run',
    stderr: "NameError: name 'count' is not defined",
    exitCode: 1
  })

  it('命中规则 → 出卡，且 {1} 已经换成真实标识符', () => {
    const v = runView(pyErr, false, { lang: 'python', errorLib: LIB })
    expect(v.errorCard).not.toBeNull()
    expect(v.errorCard!.matched).toBe(true)
    expect(v.errorCard!.title).toBe('「count」还没建起来喵')
    expect(v.errorCard!.fixHint).toBe('补上 count 喵')
  })

  it('按语言查规则 —— Java 的报错要用 Java 的规则库', () => {
    const v = runView(r({ ok: false, stderr: 'Main.java:3: error: cannot find symbol' }), false, {
      lang: 'java',
      errorLib: LIB
    })
    expect(v.errorCard!.title).toBe('有名字 javac 不认识喵')
  })

  it('语言规则没命中 → 落到 common', () => {
    const v = runView(r({ ok: false, stderr: 'ls: No such file or directory' }), false, {
      lang: 'python',
      errorLib: LIB
    })
    expect(v.errorCard!.title).toBe('通用规则喵')
  })

  it('一条都没命中 → 兜底卡（不是没有卡）', () => {
    const v = runView(r({ ok: false, stderr: '某种喵没见过的报错' }), false, {
      lang: 'python',
      errorLib: LIB
    })
    expect(v.errorCard).not.toBeNull()
    expect(v.errorCard!.matched).toBe(false)
    expect(v.errorCard!.title).toBe(ERROR_UI.FALLBACK_TITLE)
  })

  /**
   * 兜底话术是**写死的文案**，不是规则库来的，所以它里面绝不能出现占位符 ——
   * 一旦出现，用户看到的就是「变量「{1}」没定义」这种半成品。
   * 这条钉的是文案本身，谁改都可能踩，所以单独拎出来。
   */
  it('兜底卡的文案里不能残留 {1} 这种占位符', () => {
    const v = runView(r({ ok: false, stderr: '未知报错' }), false, {
      lang: 'python',
      errorLib: LIB
    })
    const all = v.errorCard!.title + v.errorCard!.explain + v.errorCard!.fixHint
    expect(all).not.toMatch(/\{\d\}/)
  })

  it('stderr 是空的就退回 stdout（有的程序把错误打在标准输出）', () => {
    const v = runView(
      r({ ok: false, stderr: '   ', stdout: "NameError: name 'x' is not defined" }),
      false,
      { lang: 'python', errorLib: LIB }
    )
    expect(v.errorCard!.title).toBe('「x」还没建起来喵')
  })

  // ── 下面全是「不该出卡」的场合 ──

  it('跑成功 → 没有卡', () => {
    const v = runView(r({ stdout: '你好喵' }), false, { lang: 'python', errorLib: LIB })
    expect(v.errorCard).toBeNull()
  })

  it('正在跑 → 没有卡', () => {
    const v = runView(pyErr, true, { lang: 'python', errorLib: LIB })
    expect(v.errorCard).toBeNull()
  })

  /**
   * 环境没装是最要紧的一条：那时候的 stderr 是 "spawn gcc ENOENT" 之类，
   * 跟用户写的代码毫无关系，message 已经在引导他去装环境了。
   * 这时候再盖一张卡，用户会以为「是我代码写错了」。
   */
  it('环境没装 → 没有卡（那是没装编译器，不是代码的错）', () => {
    const v = runView(
      r({ ok: false, stderr: 'spawn gcc ENOENT', envIssue: true, message: '还没找到翻译官喵' }),
      false,
      { lang: 'c', errorLib: LIB }
    )
    expect(v.errorCard).toBeNull()
  })

  it('超时 → 没有卡（message 已经说了「跑太久」）', () => {
    const v = runView(
      r({ ok: false, timedOut: true, stderr: '某种未知报错', message: '跑太久啦' }),
      false,
      { lang: 'python', errorLib: LIB }
    )
    expect(v.errorCard).toBeNull()
  })

  /**
   * message 非空 = 主进程已经给了针对性解释（环境缺失、没写 class……）。
   * 再叠一张卡就是**两套说法打架**，用户不知道该信哪个。
   */
  it('主进程已经给了 message → 不和它抢（避免两套说法打架）', () => {
    const v = runView(
      r({ ok: false, stderr: "NameError: name 'a' is not defined", message: '这段代码里没有 class 喵～' }),
      false,
      { lang: 'python', errorLib: LIB }
    )
    expect(v.errorCard).toBeNull()
  })

  it('一个字都没输出（程序自己退了个非零码）→ 没有卡', () => {
    const v = runView(r({ ok: false, stdout: '  ', stderr: '', exitCode: 3 }), false, {
      lang: 'python',
      errorLib: LIB
    })
    expect(v.errorCard).toBeNull()
  })

  /**
   * ── 被系统强行按停（Windows 上的崩溃）──
   *
   * 【这组为什么非有不可】
   * 程序碰了不该碰的内存时，Windows 是直接结束进程的：**stderr 一个字都没有**，
   * 只在退出码里留个记号。所以「有没有输出」这条路完全失效，只能认退出码。
   *
   * 不认的话界面就是一片空白 —— 结果条说「跑失败了喵」，下面什么都没有。
   * 而这恰恰是 C 语言零基础阶段最高频的崩溃，偏偏在最需要解释的时候一句话都没有。
   *
   * 下面每个退出码都是本机真跑出来的（gcc 16.1.0 / Windows 11，2026-09-14），
   * 不是照着文档编的。
   */
  describe('崩溃退出码 → 验伤报告', () => {
    const crashed = (exitCode: number) =>
      runView(r({ ok: false, exitCode, stdout: '', stderr: '' }), false, { lang: 'c', errorLib: LIB })

    it('空指针解引用 3221225477 → 撞墙报告', () => {
      const v = crashed(3221225477)
      expect(v.errorCard).not.toBeNull()
      expect(v.errorCard!.title).toBe(CRASH_UI.ACCESS_VIOLATION_TITLE)
      expect(v.errorCard!.tag).toBe(CRASH_UI.TAG)
    })

    /**
     * Node 报同一个退出码，有可能是**带符号的负值**（-1073741819 = 0xC0000005）。
     * 只认正数的话，换个 Node 版本这张报告就静默消失了——不报错，只是没了。
     */
    it('同一个退出码的负值形式 -1073741819 → 还是撞墙报告', () => {
      expect(crashed(-1073741819).errorCard!.title).toBe(CRASH_UI.ACCESS_VIOLATION_TITLE)
    })

    it('递归不收口 3221225725 → 压塌梯子报告', () => {
      expect(crashed(3221225725).errorCard!.title).toBe(CRASH_UI.STACK_OVERFLOW_TITLE)
    })

    it('整数除以零 3221225620 → 除以零报告', () => {
      expect(crashed(3221225620).errorCard!.title).toBe(CRASH_UI.DIVIDE_BY_ZERO_TITLE)
    })

    it('abort() 3221226505 → 自己喊停报告', () => {
      expect(crashed(3221226505).errorCard!.title).toBe(CRASH_UI.ABORTED_TITLE)
    })

    it('区间内没见过的崩法 → 通用报告，不能变成空白', () => {
      expect(crashed(0xc0000135).errorCard!.title).toBe(CRASH_UI.UNKNOWN_TITLE)
    })

    /**
     * 反向验证：**不能把正常退出误判成崩溃**。
     *
     * `return -1` 的退出码是 0xFFFFFFFF。要是把崩溃区间开到 0xFFFFFFFF，
     * 一个老老实实返回 -1 的程序会被告知「你碰了不该碰的内存」——
     * 指着一段完全正确的代码说它错了，比什么都不显示更糟。
     */
    it('return -1（0xFFFFFFFF）→ 不许弹崩溃卡', () => {
      expect(crashed(-1).errorCard).toBeNull()
      expect(crashed(4294967295).errorCard).toBeNull()
    })

    it('正常结束（退出码 0）→ 没有卡', () => {
      expect(crashed(0).errorCard).toBeNull()
    })

    /**
     * 崩溃码 + 有报错原文 → **规矩照旧**：先让规则库讲，别提崩溃。
     * 一旦抢了，用户会看到「你碰了不该碰的内存」，而编译器其实说得清清楚楚。
     */
    it('崩溃码但 stderr 有内容 → 交给规则库，不抢', () => {
      const v = runView(
        r({ ok: false, exitCode: 3221225477, stderr: "NameError: name 'a' is not defined" }),
        false,
        { lang: 'python', errorLib: LIB }
      )
      expect(v.errorCard!.title).not.toBe(CRASH_UI.ACCESS_VIOLATION_TITLE)
    })
  })

  /**
   * 不传 ctx = 调用方没给规则库，查不了。这时候**照样给兜底卡**：
   * 用户眼前摆着一条看不懂的报错，需要的是「先看哪儿」那句话，
   * 跟有没有规则库没关系。
   *
   * 但**绝不能瞎猜语言**去查规则 —— 猜错了会命中另一门语言的规则，
   * 给出一条跟眼前报错毫无关系的解释，那比查不到还糟。
   */
  it('不传 ctx（没有规则库）→ 不崩，给兜底卡而不是「没有卡」', () => {
    const v = runView(pyErr, false)
    expect(v.phase).toBe('done')
    expect(v.errorCard).not.toBeNull()
    expect(v.errorCard!.matched).toBe(false)
    expect(v.errorCard!.title).toBe(ERROR_UI.FALLBACK_TITLE)
  })
})

/**
 * 输出区那条小鱼（M5-05）。
 *
 * 单独一组是因为它的取值**必须和结果条、配色同源**：
 * 结果条说着「出错了喵」而小鱼在比心，是会让人当场懵掉的画面。
 * 所以下面每条断言都不是「姿态等于某个字符串」这么简单，
 * 而是「姿态和 tone 说的是同一件事」。
 */
describe('输出区小鱼该摆什么姿态', () => {
  // 这一组不关心讲解卡，没有规则库对结论毫无影响（那几条路径上面已经钉过了），
  // 所以直接给 undefined，省得跟着那份 LIB 的定义一起改
  const ctx = { lang: 'python' as const, errorLib: undefined }

  it('还没跑过 → 不摆鱼（空输出区里多一条鱼，会被当成输出内容）', () => {
    expect(runView(null, false, ctx).mascotPose).toBeNull()
    expect(runView(null, true, ctx).phase).toBe('running')
  })

  it('正在跑 → busy（深潜绕圈，正好就是「正在跑」）', () => {
    // 跑的过程中 result 是 null（store 在开跑前会清掉上一次的结果）
    expect(runView(null, true, ctx).mascotPose).toBe('busy')
    // 万一下一次实现没清干净、跑的时候还留着旧结果，也必须是 busy
    expect(runView(r({ ok: true }), true, ctx).mascotPose).toBe('busy')
  })

  it('跑通了 → yay', () => {
    expect(runView(r({ ok: true, stdout: 'hi' }), false, ctx).mascotPose).toBe('yay')
  })

  it('输出被截断但程序跑通了 → 仍是 yay（截断是提醒，不是失败）', () => {
    // tone 在这种情况下是 warn 而不是 bad，鱼不能被判成失败
    const v = runView(r({ ok: true, truncated: true }), false, ctx)
    expect(v.tone).toBe('warn')
    expect(v.mascotPose).toBe('yay')
  })

  it('编译没过 → soothe（同理，和 tone 保持一致）', () => {
    const v = runView(r({ ok: false, phase: 'compile', stderr: 'error: ...' }), false, ctx)
    expect(v.tone).toBe('bad')
    expect(v.mascotPose).toBe('soothe')
  })

  it('超时 → soothe', () => {
    expect(runView(r({ ok: false, timedOut: true }), false, ctx).mascotPose).toBe('soothe')
  })

  /**
   * 这条是这一组里最要紧的：`ok: true` 但主进程给了 message
   * （「这段代码里没有 class」「翻译官喵没找到 Python」）时，
   * 结果条按「坏」上色。鱼要是只看 ok 字段，就会出现
   * **结果条红着脸、鱼在比心**。所以断言必须把两个字段绑在一起看。
   */
  it('跑通了但主进程给了 message（界面按「坏」显示）→ 鱼也必须是 soothe', () => {
    const v = runView(r({ ok: true, message: '这段代码里没有 class 喵～' }), false, ctx)
    expect(v.tone).toBe('bad')
    expect(v.mascotPose).toBe('soothe')
    expect(v.mascotPose, '结果条是红的，鱼不能是 yay').not.toBe('yay')
  })
})

// ---------------------------------------------------------------- 原生模式那一行
//
// 【这一节守什么】两件事，都不是崩溃，是「用户被误导」：
//
//   1. **nativeLine 该不该出现**。这一行是「这一趟用的是你自己 PATH 里的 gcc」——
//      它只在**真的是原生跑的**那一趟才有意义。托管模式也显示的话，绝大多数
//      从没开过开关的用户每次都会多看到一行陌生的技术话；没跑完就显示的话，
//      等于在结果还没出来时先替它下了结论。
//   2. **原生失败时 stderr 必须放行**。这一条是 3.0 里唯一一处**故意偏离**
//      原有规矩的地方：`envIssue` 一向是要藏 stderr 的（那是 "spawn gcc ENOENT"
//      这类系统原话，对零基础的人只有恐吓效果），而原生模式下那条 envIssue
//      底下藏的常常是 cmd.exe 的中文原话（「'gcc' 不是内部或外部命令」）——
//      它**就是**真实原因，藏掉之后用户只剩一句猫咪话，既不知道去找什么、
//      也不知道去哪找。所以这条例外必须有测试钉着，否则将来一次「顺手统一」
//      就把它收回去了，而症状只是「原生模式跑不通时看不出原因」。

describe('原生模式那一行：只在真的原生跑过之后才出现', () => {
  it('原生跑完 → 出现，而且带着 where 找到的那个路径', () => {
    const v = runView(
      r({ native: { command: 'gcc', resolved: 'C:\\mingw64\\bin\\gcc.exe' } }),
      false
    )
    expect(v.nativeLine).toBe(RUNNER_UI.NATIVE_LINE('gcc', 'C:\\mingw64\\bin\\gcc.exe'))
    expect(v.nativeLine).toContain('C:\\mingw64\\bin\\gcc.exe')
  })

  it('★ 命中自管工具链（managed）→ 如实点名，不再说「你自己 PATH 里的」', () => {
    // 本机实测就长这样：HKCU PATH 里那个 gcc 是装机时应用自己放进去的，
    // 老文案「你自己 PATH 里的」在这台机器上是**半句真话** —— 用户去
    // `where gcc` 对着一个自己没装过的路径发懵。这条钉住 managed 透传
    // 没有被中间某一层吃掉（吃掉的话 toContain 会当场红）。
    const resolved =
      'C:\\Users\\x\\AppData\\Local\\MiAiBianCheng\\toolchain\\winlibs\\mingw64\\bin\\gcc.exe'
    const v = runView(r({ native: { command: 'gcc', resolved, managed: true } }), false)

    expect(v.nativeLine).toBe(RUNNER_UI.NATIVE_LINE('gcc', resolved, true))
    expect(v.nativeLine).toContain('咪爱编程')
    expect(v.nativeLine).not.toContain('你自己 PATH 里的')
  })

  it('managed 但**没问出路径** → 退回原话那一档，不硬吹「管理」', () => {
    // `NATIVE_LINE` 的实现是 `managed && resolved`：缺路径时那句
    // 「装机时它进了你的 PATH」会挂在一句没有路径的话后面，语义悬空。
    const v = runView(r({ native: { command: 'gcc', managed: true } }), false)
    expect(v.nativeLine).toBe(RUNNER_UI.NATIVE_LINE('gcc', undefined, true))
    expect(v.nativeLine).toContain('gcc')
    expect(v.nativeLine).not.toContain('咪爱编程')
    expect(v.nativeLine).not.toContain('undefined')
  })

  it('managed 是 false / 缺省 → 一句都不提「咪爱编程自己管理的」', () => {
    // 对照臂：少了它，一个「永远走 managed 文案」的实现也能骗过上面那条。
    const natives = [
      { command: 'gcc', resolved: 'C:\\x\\gcc.exe', managed: false },
      { command: 'gcc', resolved: 'C:\\x\\gcc.exe' }
    ]
    for (const native of natives) {
      const line = runView(r({ native }), false).nativeLine
      expect(line).toContain('你自己 PATH 里的')
      expect(line).not.toContain('咪爱编程')
    }
  })

  it('原生跑完但**没问出路径** → 仍然出现，话换成另一句（不能整行消失）', () => {
    // `resolved` 是 where 的输出，两种情况下会缺：PATH 在预检之后被改掉，
    // 或者 where 报了成功却没吐路径。**这一行不能因此消失** ——
    // 消失掉的话，用户看到的是一个「什么都没说」的原生运行，
    // 而原生模式最需要说清的就是「跑的是哪一个」。文案里带上了命令名，够交代。
    const v = runView(r({ native: { command: 'python' } }), false)
    expect(v.nativeLine).toBe(RUNNER_UI.NATIVE_LINE('python', undefined))
    expect(v.nativeLine).toContain('python')
    expect(v.nativeLine).not.toContain('undefined')
  })

  it('**托管模式一次都不出现**（绝大多数用户从没见过那个开关）', () => {
    expect(runView(r({ stdout: 'hi' }), false).nativeLine).toBe('')
  })

  it('**还没跑完时不出现** —— 那会儿还不知道是谁跑的', () => {
    const v = runView(r({ native: { command: 'gcc' } }), true)
    expect(v.phase).toBe('running')
    expect(v.nativeLine).toBe('')
  })

  it('还没跑过（idle）也不出现', () => {
    expect(runView(null, false).nativeLine).toBe('')
  })

  it('这一段不许出现字面量 undefined（模板拼串最容易漏的）', () => {
    // `NATIVE_LINE` 是模板字符串拼出来的，而 `resolved` 是可选的。
    // 万一哪天有人把 `resolved ? A : B` 改写成 `${resolved}`，界面上就会出现
    // 「这一趟用的是你自己 PATH 里的：undefined」—— 不崩、不报错，就是很难看。
    const natives = [
      { command: 'gcc' },
      { command: 'javac', resolved: 'C:\\jdk\\bin\\javac.exe' },
      // managed 两档也在扫的范围里（2026-10-01 加）：命中自管工具链的那句
      // 模板最长、插的值最多，漏一个 `${}` 就是新一处「undefined」
      { command: 'gcc', resolved: 'C:\\x\\gcc.exe', managed: true },
      { command: 'gcc', managed: true }
    ]
    for (const native of natives) {
      const line = runView(r({ native }), false).nativeLine
      expect(line).not.toContain('undefined')
      expect(line).not.toContain('null')
    }
  })
})

describe('原生失败时 stderr 必须放行（3.0 唯一一处故意偏离老规矩）', () => {
  it('★ envIssue + 原生 → **显示** stderr（cmd 的中文原话就是真实原因）', () => {
    const cmdSays = "'gcc' 不是内部或外部命令，也不是可运行的程序"
    const v = runView(
      r({
        ok: false,
        phase: 'compile',
        stderr: cmdSays,
        envIssue: true,
        // ⚠️ `native` 这一项**必须给**，哪怕 message 已经是原生那句了。
        //    放行 stderr 的判据是「这一趟是不是走的原生」，落在 `r.native` 上，
        //    不是 message 的内容 —— 拿文案当判据的话，改一个字就失效。
        //    而 `runCodeNative` 的四个失败分支**都会**带上这个字段
        //    （`done()` 里挂的），所以真实结果里它一定在。
        //    （这条 fixture 第一版就是漏了它，测试当场红了 —— 判据是真的。）
        native: { command: 'gcc' },
        message: RUNNER_MSG.NATIVE_TOOL_MISSING('gcc', 'c', 'C:\\mingw64\\bin\\gcc.exe')
      }),
      false
    )
    expect(v.showStderr, '藏掉之后用户只剩一句猫咪话，找不到真正的原因').toBe(true)
    expect(v.stderr).toBe(cmdSays)
  })

  it('**对照臂**：同样 envIssue 但走托管 → 照旧藏起来（老规矩没被改宽）', () => {
    // 少了这条，上面那条能用一个「envIssue 一律显示」的实现骗过去 ——
    // 而那会把 "spawn gcc ENOENT" 甩回给零基础用户，正是当初要藏它的理由。
    // 两条必须同时在场：这个口子是**只给原生**开的。
    const v = runView(
      r({ ok: false, stderr: 'spawn gcc ENOENT', envIssue: true, message: '还没找到翻译官喵' }),
      false
    )
    expect(v.showStderr).toBe(false)
  })

  it('对照臂：原生但**不是** envIssue（普通编译错）→ 显示（老规矩本来也显示）', () => {
    const v = runView(
      r({
        ok: false,
        phase: 'compile',
        stderr: 'main.c:3:5: error: expected ;',
        native: { command: 'gcc' }
      }),
      false
    )
    expect(v.showStderr).toBe(true)
  })

  it('原生、envIssue、但 stderr **是空的** → 不显示（空块比没有更让人困惑）', () => {
    // 缺编译器那条分支返回的 stderr 就是空串（话都在 message 里）。
    // 只按「原生就放行」写的话，这里会渲染出一个空白的 stderr 框。
    const v = runView(
      r({
        ok: false,
        stderr: '',
        envIssue: true,
        native: { command: 'gcc' },
        message: RUNNER_MSG.NATIVE_TOOL_MISSING('gcc', 'c', undefined)
      }),
      false
    )
    expect(v.showStderr).toBe(false)
  })

  it('★ 缺编译器那一趟的**真实形状**跑一遍（不是「原生+envIssue」的泛化）', () => {
    // 上面那条走的是「原生 + envIssue + stderr 有内容」——一个抽象组合。
    // 这一条把 `runCodeNative` tool-missing 分支**实际返回的字段**照着拼出来：
    // 没有 resolved（where 没找到）、stderr 空、message 是那句四件事的话。
    // 它是「用户装了原生模式、机器上没 gcc」时屏幕上真正会渲染的那一格。
    const v = runView(
      r({
        ok: false,
        phase: 'compile',
        stdout: '',
        stderr: '',
        exitCode: null,
        envIssue: true,
        native: { command: 'python' },
        message: RUNNER_MSG.NATIVE_TOOL_MISSING('python', 'python', undefined)
      }),
      false
    )
    // 话必须完整说出来（那是用户唯一的线索），而空白 stderr 块不许出现
    expect(v.showMessage).toBe(true)
    expect(v.showStderr).toBe(false)
    // 这一行也在：它告诉用户「这一趟问的是你的 PATH」，和 message 是配套的
    expect(v.nativeLine).toContain('python')
  })
})
