/**
 * 桌宠上报口（lib/pet-bridge.ts）
 *
 * 【这个文件在守什么】
 * 它把"学员跑了一次代码"翻成给桌宠的一句话，三个出口全是**说了就走**。
 * 坏法全是静默的，而且方向相反的各坏各的：
 *   · 该报的没报 —— 桌宠对学员的努力毫无反应，"活着"的感觉直接没了；
 *   · 不该报的报了 —— **环境问题（编译器没装）也去叫鱼**，鱼对着一份
 *     完全正确的代码说"这行错了"，比不说话坏得多（与诊断卡避开 envIssue 同口径）；
 *   · 指错行 —— 与 run-diagnosis 同罪：学员照着第 3 行改半天，错在第 7 行。
 *     这里的行号必须来自 `firstErrorLine`（那边文件头写死了"不许各写一份"），
 *     所以下面直接抄四门语言的真报错格式，顺带钉住"用的是它"。
 *   · "说了就走"的契约破了 —— 桌宠的故障（窗口没了 / 主进程还没接上）
 *     会以**未处理拒绝**的形式漏进控制台，甚至传染给学习流程。
 *     ⚠️ 这条有两条逃逸路（同步 throw / invoke 拒绝），try/catch 只堵一条，
 *     两条都钉。
 *
 * 【为什么值这些用例】每次都是"看起来一切正常"：桌宠不出现像没开、
 * 控制台的 Uncaught (in promise) 没人会去看。只能靠机器守着。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PetRewardKind, PetRunReport } from '../../../../shared/pet'
import type { RunResult } from '../../../../shared/types'
import { buildRunReport, grantPetRice, reportRunToPet, reportWrongToPet } from '../pet-bridge'
import type { PetViewRect } from '../pet-bridge'

/** 造一个结果，只写这个文件在意的字段（其余给"正常"值；口径同 run-diagnosis.test.ts） */
function res(over: Partial<RunResult>): RunResult {
  return {
    ok: false,
    phase: 'compile',
    stdout: '',
    stderr: '',
    exitCode: 1,
    timedOut: false,
    truncated: false,
    durationMs: 10,
    ...over
  }
}

const FALLBACK: PetViewRect = { x: 0, y: 600, width: 800, height: 200 }

/** 假 window：记录 petAct / petReportRun 的每次调用，返回值按用例需要注入 */
function stubMiai(miai: Record<string, unknown>): {
  acts: unknown[]
  reports: unknown[]
} {
  const acts: unknown[] = []
  const reports: unknown[] = []
  vi.stubGlobal('window', {
    miai: {
      petAct: (a: unknown): Promise<unknown> => {
        acts.push(a)
        return Promise.resolve(null)
      },
      petReportRun: (r: unknown): void => {
        reports.push(r)
      },
      ...miai
    }
  })
  return { acts, reports }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildRunReport：该不该惊动桌宠、说成什么', () => {
  it('还没跑（null）不报', () => {
    expect(buildRunReport(null)).toBeNull()
  })

  it('envIssue（编译器没装之类）不报 —— 那不是学员代码的错', () => {
    // 带上一段像模像样的报错：证明"不报"靠的是 envIssue 标记，不是"没内容可报"
    expect(
      buildRunReport(res({ envIssue: true, stderr: 'gcc: command not found' }))
    ).toBeNull()
  })

  it('"零证据"的失败不报（通道自己炸了，不是代码错）', () => {
    // failedRun() 的形状：没有退出码、没有任何输出
    expect(
      buildRunReport(res({ phase: 'compile', exitCode: null, stdout: '', stderr: '' }))
    ).toBeNull()
    // 跑阶段同理
    expect(
      buildRunReport(res({ phase: 'run', exitCode: null, stdout: '', stderr: '' }))
    ).toBeNull()
  })

  it('零证据的边界：有 stdout 就报（判据是"零证据"，不是"没有退出码一律不报"）', () => {
    const r = buildRunReport(
      res({ exitCode: null, stdout: 'boom\n', stderr: '' }),
      { fallbackRect: FALLBACK }
    )
    expect(r).toEqual({ ok: false, kind: 'compile', line: null, rect: FALLBACK, own: false, hash: null })
  })

  it('超时空输出照样报 —— 零证据守卫不许吞超时（它有 timedOut 这条证据）', () => {
    const r = buildRunReport(
      res({ phase: 'run', timedOut: true, exitCode: null, stdout: '', stderr: '' }),
      { fallbackRect: FALLBACK }
    )
    expect(r).toEqual({ ok: false, kind: 'timeout', line: null, rect: FALLBACK, own: false, hash: null })
  })

  it('成功也报（ok:true, kind:other, 不指行）—— "值不值得说一句"是主进程的策略', () => {
    const r = buildRunReport(res({ ok: true, phase: 'run', exitCode: 0, stdout: '3\n' }), {
      fallbackRect: FALLBACK
    })
    expect(r).toEqual({ ok: true, kind: 'other', line: null, rect: FALLBACK, own: false, hash: null })
    // 不给 fallback 时 rect 就是 null，不许编一个矩形
    expect(buildRunReport(res({ ok: true, phase: 'run', exitCode: 0 }))).toEqual({
      ok: true,
      kind: 'other',
      line: null,
      rect: null,
      own: false,
      hash: null
    })
  })

  it('成功分支的控制项：程序自己打印了像报错的行，也不许指行', () => {
    // 退出码 0 = 跑通了；指针绝不能被输出内容带跑
    const r = buildRunReport(
      res({
        ok: true,
        phase: 'run',
        exitCode: 0,
        stdout: "main.c:7:5: error: 这是程序自己打印的\n",
        stderr: ''
      })
    )
    expect(r?.line).toBeNull()
    expect(r?.kind).toBe('other')
  })

  it('四门语言的真报错格式：行号认得出来，且 lineRect 拿的就是那一行', () => {
    const RECT7: PetViewRect = { x: 10, y: 200, width: 500, height: 20 }
    const asked: number[] = []
    const cases: { text: string; phase: 'compile' | 'run'; line: number; kind: string }[] = [
      // gcc / g++：文件:行:列: error:
      {
        text: "main.c:7:5: error: 'retrun' undeclared (first use in this function)",
        phase: 'compile',
        line: 7,
        kind: 'compile'
      },
      // javac：文件:行: error:
      { text: "Main.java:12: error: ';' expected", phase: 'compile', line: 12, kind: 'compile' },
      // C#：文件(行,列): error
      { text: 'Program.cs(3,5): error CS1002: ; expected', phase: 'compile', line: 3, kind: 'compile' },
      // Python traceback（运行期）
      { text: '  File "main.py", line 9, in <module>', phase: 'run', line: 9, kind: 'run' }
    ]
    for (const c of cases) {
      asked.length = 0
      const r = buildRunReport(res({ phase: c.phase, stderr: c.text }), {
        lineRect: (l) => {
          asked.push(l)
          return l === c.line ? RECT7 : null
        },
        fallbackRect: FALLBACK
      })
      expect(r?.line, c.text).toBe(c.line)
      expect(r?.kind, c.text).toBe(c.kind)
      expect(asked, c.text).toEqual([c.line])
      expect(r?.rect, c.text).toEqual(RECT7)
    }
  })

  it('行在视口外（lineRect 给 null）→ rect 退 fallback，行号照给', () => {
    const r = buildRunReport(
      res({ stderr: "main.c:7:5: error: 'retrun' undeclared" }),
      { lineRect: () => null, fallbackRect: FALLBACK }
    )
    expect(r).toEqual({ ok: false, kind: 'compile', line: 7, rect: FALLBACK, own: false, hash: null })
  })

  it('行认不出来（链接错误 / 段偏移那种）→ line:null + fallbackRect，但照样报', () => {
    // 认不出来就用主进程"认不出哪行"那一档台词，不是"干脆不出现"
    const r = buildRunReport(
      res({ stderr: 'collect2.exe: error: ld returned 1 exit status' }),
      { lineRect: () => ({ x: 1, y: 2, width: 3, height: 4 }), fallbackRect: FALLBACK }
    )
    expect(r).toEqual({ ok: false, kind: 'compile', line: null, rect: FALLBACK, own: false, hash: null })
  })

  it('stderr 空时行号从 stdout 里认（errorTextOf 的兜底通道）', () => {
    const r = buildRunReport(res({ stderr: '', stdout: "Main.java:5: error: ';' expected" }))
    expect(r?.line).toBe(5)
  })
})

describe('三个出口的形态："说了就走"', () => {
  it('reportRunToPet：null / env 失败 / 零证据，三次都不许惊动桌宠', () => {
    const { reports } = stubMiai({})
    reportRunToPet(null)
    reportRunToPet(res({ envIssue: true, stderr: 'x' }))
    reportRunToPet(res({ exitCode: null, stdout: '', stderr: '' }))
    expect(reports).toEqual([])
  })

  it('reportRunToPet：成功与失败各一次，发出去的就是判定表那一份（精确形状）', () => {
    const { reports } = stubMiai({})
    const rect: PetViewRect = { x: 10, y: 200, width: 500, height: 20 }
    reportRunToPet(res({ ok: true, phase: 'run', exitCode: 0 }), { fallbackRect: FALLBACK })
    reportRunToPet(res({ stderr: "main.c:7:5: error: 'retrun' undeclared" }), {
      lineRect: () => rect,
      fallbackRect: FALLBACK
    })
    expect(reports).toEqual([
      { ok: true, kind: 'other', line: null, rect: FALLBACK, own: false, hash: null },
      { ok: false, kind: 'compile', line: 7, rect, own: false, hash: null }
    ] satisfies PetRunReport[])
  })

  it('reportRunToPet：own/hash 透传；形状不对的值洗成 false/null（奖励证据不许含糊）', () => {
    const { reports } = stubMiai({})
    reportRunToPet(res({ ok: true, phase: 'run', exitCode: 0 }), {
      fallbackRect: FALLBACK,
      own: true,
      hash: '12:abcdef01'
    })
    // 类型系统外的坏值（比如将来谁从这个口子塞了别的形状）：洗掉，不许伪造证据
    reportRunToPet(res({ ok: true, phase: 'run', exitCode: 0 }), {
      fallbackRect: FALLBACK,
      own: 1 as unknown as boolean,
      hash: 42 as unknown as string
    })
    expect(reports).toEqual([
      { ok: true, kind: 'other', line: null, rect: FALLBACK, own: true, hash: '12:abcdef01' },
      { ok: true, kind: 'other', line: null, rect: FALLBACK, own: false, hash: null }
    ] satisfies PetRunReport[])
  })

  it('grantPetRice：三个奖励档原样发出，不加工', () => {
    const { acts } = stubMiai({})
    const kinds: PetRewardKind[] = ['answer', 'lesson', 'review']
    for (const reward of kinds) grantPetRice(reward)
    expect(acts).toEqual(kinds.map((reward) => ({ action: 'grant', reward })))
  })

  it('reportWrongToPet：三个字段原样发出；拿不到课名就 title:null（绝不编课名）', () => {
    const { acts } = stubMiai({})
    reportWrongToPet({ title: '指针初步', order: 7, learned: true })
    reportWrongToPet({ title: null, order: null, learned: false })
    expect(acts).toEqual([
      { action: 'wrong', title: '指针初步', order: 7, learned: true },
      { action: 'wrong', title: null, order: null, learned: false }
    ])
  })

  it('同步逃逸路：window 整个不在（极早期）≠ 不许抛', () => {
    // 不 stub —— node 环境里没有 window，裸引用会 ReferenceError，必须被吞
    expect(() => {
      grantPetRice('answer')
      reportWrongToPet({ title: null, order: null, learned: false })
      reportRunToPet(res({ stderr: 'x' }))
    }).not.toThrow()
  })

  it('同步逃逸路：通道半通（miai 在但方法没挂）也不许抛', () => {
    stubMiai({ petAct: undefined, petReportRun: undefined })
    expect(() => {
      grantPetRice('answer')
      reportWrongToPet({ title: 'x', order: 1, learned: true })
      reportRunToPet(res({ stderr: 'x' }))
    }).not.toThrow()
  })

  it('同步逃逸路：通道自己抛（ipc 断了）也不许抛', () => {
    stubMiai({
      petAct: () => {
        throw new Error('ipc gone')
      },
      petReportRun: () => {
        throw new Error('ipc gone')
      }
    })
    expect(() => {
      grantPetRice('answer')
      reportWrongToPet({ title: 'x', order: 1, learned: true })
      reportRunToPet(res({ stderr: 'x' }))
    }).not.toThrow()
  })

  it('异步逃逸路：invoke 被拒绝（主进程还没接上）也不留未处理拒绝', async () => {
    // pet:act 是 invoke —— 主进程抛（'pet:act: controller not ready'）会以
    // 被拒绝的 Promise 回来。try/catch 看不见它；没接住就是控制台一条
    // Uncaught (in promise)，桌宠的故障漏进学习流程。
    const seen: unknown[] = []
    const onRejection = (e: unknown): void => {
      seen.push(e)
    }
    process.on('unhandledRejection', onRejection)
    try {
      stubMiai({
        petAct: () => Promise.reject(new Error('pet:act: controller not ready'))
      })
      grantPetRice('answer')
      reportWrongToPet({ title: 'x', order: 1, learned: true })
      // 给未处理拒绝检测留够一个事件循环轮次
      await new Promise((r) => setTimeout(r, 20))
    } finally {
      process.off('unhandledRejection', onRejection)
    }
    expect(seen, '出口留下了未处理拒绝（.catch 丢了吗）').toEqual([])
  })
})
