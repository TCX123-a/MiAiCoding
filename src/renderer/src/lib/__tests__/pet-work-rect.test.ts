/**
 * 工作区登记表（lib/pet-work-rect.ts）
 *
 * 【这个文件在守什么】
 * 「绝不遮挡代码」让位规则的渲染端半边：**谁在栈顶、释放时报什么**。
 * 坏法全是静默的（报错了屏幕上什么都不显示，直到主人发现鱼压在代码上），
 * 而且两个方向对称着坏：
 *   · 该报 A 却报了 null —— 让位规则整体关掉，鱼重新趴到编辑区上
 *     （答题覆盖层关闭时最容易掉进去的那一脚：把练习场那份还开着的连坐撤掉）；
 *   · 该报 null 却报了别人的矩形 —— 鱼躲着一块已经不在屏幕上的区域（白墙）。
 * 另有两条只在边界上现身的：栈空才许报 null、量不出来的元素不许送坏载荷
 * （主进程会把坏载荷按 null 处理并记日志，见 host.ts 的 reportWorkRect）。
 *
 * 【为什么多数用例自己造实例（createWorkRectRegistry）】
 * 单例的栈是模块级状态，用例之间会串 —— 工厂给每个用例一份干净的。
 * 单例与 window.miai 的接线另有一组用例（stub window 直接驱动单例）。
 *
 * 【种坏自证】见文件末尾：同一段剧本、同一份期望，喂给"故意写错的实现"
 * 必须红 —— 判据自己能红的证据（同 pet-guide.test.ts 的尺子自证思路）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PetViewRect } from '../pet-bridge'
import {
  claimWorkRect,
  createWorkRectRegistry,
  releaseWorkRect,
  type WorkRectRegistry
} from '../pet-work-rect'

// ────────────────────────────────────────────────────────────── 夹子

/**
 * 造一个"元素"：登记表只碰 getBoundingClientRect，别的属性一个都不摸 ——
 * 假元素只需要长这一个方法（少一件要跟着真 DOM 漂的东西）。
 */
function elAt(x: number, y: number, width: number, height: number): HTMLElement {
  return {
    getBoundingClientRect: () => ({ x, y, width, height })
  } as unknown as HTMLElement
}

/** 记录每次上报的假出口（真出口只比它多一个 try/catch，单例用例里单独守） */
function sink(): { sent: (PetViewRect | null)[]; send: (r: PetViewRect | null) => void } {
  const sent: (PetViewRect | null)[] = []
  return { sent, send: (r) => sent.push(r) }
}

/** 用 x 当"这是哪一块"的指纹：断言里就不用处处整块矩形比对 */
function which(r: PetViewRect | null): number | null {
  return r === null ? null : r.x
}

/**
 * 假 window：把 add/remove 记下来、能"点火"某个事件。
 * 登记表只用它的 addEventListener / removeEventListener；
 * window.miai 那条路在单例用例里另造（不混在这一层）。
 */
function fakeWindow(): {
  win: object
  added: { type: string; capture: boolean }[]
  count: (type: string) => number
  fire: (type: string) => void
} {
  const listeners = new Map<string, Set<() => void>>()
  const added: { type: string; capture: boolean }[] = []
  const win = {
    addEventListener: (type: string, cb: () => void, opts?: unknown): void => {
      added.push({ type, capture: opts === true })
      const set = listeners.get(type) ?? new Set<() => void>()
      set.add(cb)
      listeners.set(type, set)
    },
    removeEventListener: (type: string, cb: () => void): void => {
      listeners.get(type)?.delete(cb)
    }
  }
  return {
    win,
    added,
    count: (type) => listeners.get(type)?.size ?? 0,
    fire: (type) => {
      for (const cb of [...(listeners.get(type) ?? [])]) cb()
    }
  }
}

/** 假 ResizeObserver：记下建了几个、观察了谁，回调可以手动点火 */
class FakeRO {
  static made: FakeRO[] = []
  cb: () => void
  seen = new Set<Element>()
  constructor(cb: () => void) {
    this.cb = cb
    FakeRO.made.push(this)
  }
  observe(el: Element): void {
    this.seen.add(el)
  }
  disconnect(): void {
    this.seen.clear()
  }
}

/** 装好假 window + 假 ResizeObserver（node 环境两样都没有），计数清零 */
function installFakes(): ReturnType<typeof fakeWindow> {
  FakeRO.made = []
  const fw = fakeWindow()
  vi.stubGlobal('window', fw.win)
  vi.stubGlobal('ResizeObserver', FakeRO)
  return fw
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// ─────────────────────────────────────────────────────────── ① 栈语义

describe('① 栈语义（这次抽表的核心理由）', () => {
  it('A 认领 → 报 A；B 认领 → 报 B（后认领的在上：覆盖层压在练习场之上）', () => {
    const { sent, send } = sink()
    const reg = createWorkRectRegistry(send)
    reg.claim('runner', elAt(1, 10, 100, 50))
    expect(sent.map(which)).toEqual([1])
    reg.claim('quiz', elAt(2, 20, 200, 60))
    expect(sent.map(which)).toEqual([1, 2])
  })

  it('核心缺口：B 释放 ⇒ **立刻**重报 A（不是 null）—— 覆盖层关掉不许连坐练习场', () => {
    const { sent, send } = sink()
    const reg = createWorkRectRegistry(send)
    reg.claim('runner', elAt(1, 10, 100, 50))
    reg.claim('quiz', elAt(2, 20, 200, 60))
    expect(which(sent.at(-1) ?? null), '先确认栈顶是 quiz').toBe(2)
    reg.release('quiz')
    // 「立刻」= 不推进任何计时器、同步就要有结果（走 120ms 节流的话这里会拿到旧值）
    expect(which(sent.at(-1) ?? null), '释放后报的必须是栈顶 runner 那块').toBe(1)
    expect(sent, '中途一个 null 都不许有（null = 让位规则整体关掉）').not.toContain(null)
  })

  it('A 释放（栈空）⇒ 报 null —— "编辑区没了"只有这一条路', () => {
    const { sent, send } = sink()
    const reg = createWorkRectRegistry(send)
    reg.claim('runner', elAt(1, 10, 100, 50))
    reg.release('runner')
    expect(sent.map(which)).toEqual([1, null])
  })

  it('从中间释放：A、B、C 释放 B ⇒ 报的仍是 C；再释放 C ⇒ 报 A（顺序不乱）', () => {
    const { sent, send } = sink()
    const reg = createWorkRectRegistry(send)
    reg.claim('a', elAt(1, 0, 10, 10))
    reg.claim('b', elAt(2, 0, 10, 10))
    reg.claim('c', elAt(3, 0, 10, 10))
    reg.release('b')
    expect(which(sent.at(-1) ?? null), '中间的走了，栈顶还是 C').toBe(3)
    reg.release('c')
    expect(which(sent.at(-1) ?? null), 'C 走了，最先认领的 A 还在').toBe(1)
  })
})

// ─────────────────────────────────────────────────────── ② 幂等与观测器

describe('② 同一 key 重复 claim：幂等更新（不重复入栈、顺序不乱、观察器不叠）', () => {
  it('重认得同一元素：不搬家（栈顶仍是 C）、不新建观察器', () => {
    installFakes()
    const { sent, send } = sink()
    const reg = createWorkRectRegistry(send)
    const a = elAt(1, 0, 10, 10)
    const b = elAt(2, 0, 10, 10)
    const c = elAt(3, 0, 10, 10)
    reg.claim('a', a)
    reg.claim('b', b)
    reg.claim('c', c)
    expect(FakeRO.made.length).toBe(3)
    reg.claim('b', b) // 幂等重复
    expect(which(sent.at(-1) ?? null), '重认领不搬家：栈顶仍是 C').toBe(3)
    expect(FakeRO.made.length, '同一元素重认领不新建观察器').toBe(3)
    reg.release('c')
    expect(which(sent.at(-1) ?? null), '释放 C 后露出的是 B（B 没被搬乱）').toBe(2)
  })

  it('同一 key 换元素：观察器换新的（旧的拆掉），矩形以新元素为准', () => {
    installFakes()
    const { sent, send } = sink()
    const reg = createWorkRectRegistry(send)
    const oldEl = elAt(1, 0, 10, 10)
    const newEl = elAt(9, 0, 10, 10)
    reg.claim('a', oldEl)
    const first = FakeRO.made[0]
    expect(first.seen.has(oldEl)).toBe(true)
    reg.claim('a', newEl)
    expect(FakeRO.made.length).toBe(2)
    expect(first.seen.size, '旧观察器必须拆掉，绝不叠两套').toBe(0)
    expect(FakeRO.made[1].seen.has(newEl)).toBe(true)
    expect(which(sent.at(-1) ?? null)).toBe(9)
  })
})

// ────────────────────────────────────────────────── ③ 坏输入与边界

describe('③ 坏输入与边界（不许送垃圾矩形、不许顺手报 null）', () => {
  it('元素为 null：登记但不贡献矩形 —— 它下面的那块照报（不是报 null）', () => {
    const { sent, send } = sink()
    const reg = createWorkRectRegistry(send)
    reg.claim('runner', elAt(1, 0, 10, 10))
    reg.claim('quiz', null) // 遮罩里这题没有编辑器 / 还没渲染出来
    expect(which(sent.at(-1) ?? null), '栈顶量不出来 ⇒ 顺位给下面那块').toBe(1)
    expect(sent, '不许因为"上面那个量不出来"就整体关掉让位').not.toContain(null)
  })

  it('尺寸为 0（display:none / 还没布局）：同上 —— 只把自己从候选里摘掉', () => {
    const { sent, send } = sink()
    const reg = createWorkRectRegistry(send)
    reg.claim('runner', elAt(1, 0, 10, 10))
    reg.claim('quiz', elAt(9, 0, 0, 0))
    expect(which(sent.at(-1) ?? null)).toBe(1)
    expect(sent).not.toContain(null)
  })

  it('整栈都量不出来 ⇒ 报 null —— "没有让位对象"该有的样子', () => {
    const { sent, send } = sink()
    const reg = createWorkRectRegistry(send)
    reg.claim('quiz', elAt(9, 0, 0, 0))
    expect(sent.map(which)).toEqual([null])
    reg.claim('quiz2', null)
    expect(which(sent.at(-1) ?? null)).toBe(null)
  })

  it('释放没认领过的 key：什么都不做，不许顺手报 null（会把别人的让位对象撤掉）', () => {
    const { sent, send } = sink()
    const reg = createWorkRectRegistry(send)
    reg.claim('runner', elAt(1, 0, 10, 10))
    const n = sent.length
    reg.release('quiz') // 从没认领过
    expect(sent.length, '没发生任何变化，就不许惊动主进程').toBe(n)
    expect(which(sent.at(-1) ?? null)).toBe(1)
  })

  it('上报的矩形就是 {x,y,width,height} 四个字段（视口 CSS px，对齐 PetViewRect）', () => {
    const { sent, send } = sink()
    const reg = createWorkRectRegistry(send)
    reg.claim('a', elAt(12, 34, 200, 100))
    expect(sent[0]).toEqual({ x: 12, y: 34, width: 200, height: 100 })
  })
})

// ───────────────────────────────────────────────────── ④ 监听与节流

describe('④ 元素观测（搬进这一层的那套）', () => {
  it('window 监听：第一个 claim 挂 resize + 捕获阶段 scroll；栈空才摘', () => {
    const fw = installFakes()
    const { send } = sink()
    const reg = createWorkRectRegistry(send)
    const a = elAt(1, 0, 10, 10)
    const b = elAt(2, 0, 10, 10)
    reg.claim('a', a)
    expect(fw.added).toEqual([
      { type: 'resize', capture: false },
      { type: 'scroll', capture: true }
    ])
    reg.claim('b', b)
    expect(fw.added.length, '第二个格子进栈不重挂监听').toBe(2)
    reg.claim('a', a) // 幂等重复
    expect(fw.added.length, '重复认领更不许叠监听').toBe(2)
    reg.release('b')
    expect(fw.count('resize'), '栈里还有人就别摘').toBe(1)
    reg.release('a')
    expect(fw.count('resize'), '栈空才摘').toBe(0)
    expect(fw.count('scroll')).toBe(0)
  })

  it('ResizeObserver 观察每个登记元素；它的回调也走 120ms 合流', () => {
    vi.useFakeTimers()
    installFakes()
    const { sent, send } = sink()
    const reg = createWorkRectRegistry(send)
    let x = 1
    const el = {
      getBoundingClientRect: () => ({ x, y: 0, width: 10, height: 10 })
    } as unknown as HTMLElement
    reg.claim('a', el)
    expect(FakeRO.made.length).toBe(1)
    expect(FakeRO.made[0].seen.has(el), '观察的就是登记的那个元素').toBe(true)
    x = 7
    FakeRO.made[0].cb()
    expect(sent.length, '观察器回调不许绕过节流').toBe(1)
    vi.advanceTimersByTime(120)
    expect(sent.length).toBe(2)
    expect(which(sent.at(1) ?? null), '补报的是那一拍的最新值').toBe(7)
  })

  it('连发事件 120ms 合流：只补报一次，报的是最新值', () => {
    vi.useFakeTimers()
    const fw = installFakes()
    const { sent, send } = sink()
    const reg = createWorkRectRegistry(send)
    let x = 10
    const el = {
      getBoundingClientRect: () => ({ x, y: 0, width: 100, height: 50 })
    } as unknown as HTMLElement
    reg.claim('a', el)
    expect(sent.map(which)).toEqual([10])
    x = 99
    fw.fire('resize')
    fw.fire('resize')
    fw.fire('scroll')
    expect(sent.length, '合流窗口内不许补报').toBe(1)
    vi.advanceTimersByTime(119)
    expect(sent.length).toBe(1)
    vi.advanceTimersByTime(1)
    expect(sent.length).toBe(2)
    expect(which(sent.at(1) ?? null)).toBe(99)
    // 冷却归零：再来一拍，下一窗口照样只补一次
    fw.fire('scroll')
    vi.advanceTimersByTime(120)
    expect(sent.length).toBe(3)
  })

  it('release 把待发的那一拍吞掉：同一份状态不报两遍', () => {
    vi.useFakeTimers()
    const fw = installFakes()
    const { sent, send } = sink()
    const reg = createWorkRectRegistry(send)
    reg.claim('a', elAt(1, 0, 10, 10)) // [1]
    fw.fire('resize') // 挂起一拍
    reg.release('a') // flush：吞掉那一拍，直接报 null
    expect(sent.map(which)).toEqual([1, null])
    vi.advanceTimersByTime(300)
    expect(sent.length, '被吞掉的那一拍不许迟到复活').toBe(2)
  })
})

// ────────────────────────────────────────────── ⑤ 单例与 window.miai 接线

describe('⑤ 单例接线与通道兜底（桌宠的故障不许影响学习流程）', () => {
  it('window 整个不在（node / 极早期）：claim / release 静默不抛', () => {
    // 不 stub window —— node 环境里它本来就不在，裸引用会 ReferenceError，必须被吞
    expect(() => {
      claimWorkRect('single-no-window', elAt(1, 1, 10, 10))
      releaseWorkRect('single-no-window')
      releaseWorkRect('single-never-claimed')
    }).not.toThrow()
  })

  it('通道在：单例发出去的矩形分毫不差；栈空才 null', () => {
    const sent: unknown[] = []
    vi.stubGlobal('window', { miai: { petReportWorkRect: (r: unknown) => sent.push(r) } })
    claimWorkRect('single-shape', elAt(12, 34, 200, 100))
    expect(sent).toEqual([{ x: 12, y: 34, width: 200, height: 100 }])
    releaseWorkRect('single-shape')
    expect(sent).toEqual([{ x: 12, y: 34, width: 200, height: 100 }, null])
  })

  it('通道半通 / 自己抛（ipc 断了）：也不许抛', () => {
    // 半通：miai 在、方法没挂
    vi.stubGlobal('window', { miai: {} })
    expect(() => {
      claimWorkRect('single-half', elAt(1, 1, 10, 10))
      releaseWorkRect('single-half')
    }).not.toThrow()
    // 通道自己抛
    vi.stubGlobal('window', {
      miai: {
        petReportWorkRect: () => {
          throw new Error('ipc gone')
        }
      }
    })
    expect(() => {
      claimWorkRect('single-throw', elAt(1, 1, 10, 10))
      releaseWorkRect('single-throw')
    }).not.toThrow()
  })
})

// ────────────────────────────────────────────────────── ⑥ 种坏自证

type Make = (send: (r: PetViewRect | null) => void) => WorkRectRegistry

/**
 * 剧本：A 认领 → B 认领 → B 释放 → A 释放。返回每次上报是哪一块
 * （数字 = 那块矩形的 x；null = 撤让位）。
 * **真实现与下面两个坏实现走同一段剧本、同一份期望** —— 判据（期望常量）
 * 自己写错的话，两边会一起绿，种坏那两条就白写了（pet-guide 的尺子自证同此意）。
 */
function stackScript(make: Make): (number | null)[] {
  const { sent, send } = sink()
  const reg = make(send)
  reg.claim('a', elAt(1, 10, 100, 50))
  reg.claim('b', elAt(2, 10, 100, 50))
  reg.release('b')
  reg.release('a')
  return sent.map(which)
}

/** 唯一的期望：这不是"大概的对"，是让位规则该有的样子 */
const STACK_SCRIPT_EXPECTED: (number | null)[] = [1, 2, 1, null]

/**
 * 坏法②（本任务点名的那个 bug，字面照抄）：把 release 那一步从
 * "立刻重报栈顶"改成"直接报 null"。除这一行外，其余（认领顺序、出栈、
 * 量不出来就往下找）都照着真实现写 —— 保证红是**这一点**引起的。
 *
 * 【它是什么、不是什么】合成损坏样本（pet-guide.test.ts 的尺子自证思路）：
 * 它不证明真实现是对的，只证明**上面那条判据红得出来**；真实现与期望对不上
 * 时它不参与纠正，它是给判据本身准备的"必红反例"。
 */
function makeNullOnRelease(send: (r: PetViewRect | null) => void): WorkRectRegistry {
  const entries: { key: string; el: HTMLElement | null }[] = []
  const rectOf = (el: HTMLElement | null): PetViewRect | null => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null
  }
  const topRect = (): PetViewRect | null => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const r = rectOf(entries[i].el)
      if (r) return r
    }
    return null
  }
  return {
    claim(key, el) {
      const found = entries.find((e) => e.key === key)
      if (found) found.el = el ?? null
      else entries.push({ key, el: el ?? null })
      send(topRect())
    },
    release(key) {
      const i = entries.findIndex((e) => e.key === key)
      if (i === -1) return
      entries.splice(i, 1)
      send(null) // ← 种坏的那一行：不重报栈顶，直接说"编辑区没了"
    }
  }
}

/**
 * 坏法①（同一终态的另一副面孔）：真实现外面套一层，release 之后再补报一条 null。
 * 主进程是"最新值覆盖"的语义（host.ts 的 workRectCss）—— 补在后面的那条 null
 * 就是它看到的最终状态，与"直接报 null"是同一个可见故障。
 * 这一副比坏法②更靠近真实事故：真实现的出栈 / 拆监听照常跑，坏的只有"报什么"。
 */
function makeNullAppended(make: Make): Make {
  return (send) => {
    const real = make(send)
    return {
      claim: (key, el) => real.claim(key, el),
      release: (key) => {
        real.release(key)
        send(null) // ← 种坏：把"编辑器没了"补在真实现的重报后面
      }
    }
  }
}

describe('⑥ 种坏自证：同一段剧本、同一份期望，喂给坏实现必须红', () => {
  it('真实现：剧本给出期望（这一条同时是下面几条红的对照组）', () => {
    expect(stackScript(createWorkRectRegistry)).toEqual(STACK_SCRIPT_EXPECTED)
  })

  it('坏法②（release 直接报 null）：同一段剧本必须给出**不同**的轨迹，且差异点明', () => {
    const broken = stackScript(makeNullOnRelease)
    expect(broken, '判据红得出来才算证据（这里反过来断言"必须不同"）').not.toEqual(
      STACK_SCRIPT_EXPECTED
    )
    // 差异具体在哪：B 释放后报的是 null（真实现报 1）—— 正是本次要修的缺口
    expect(broken).toEqual([1, 2, null, null])
  })

  it('坏法①（真实现 + release 后补报 null）：主进程看到的最新值同样是 null', () => {
    const brokenSink = sink()
    const broken = makeNullAppended(createWorkRectRegistry)(brokenSink.send)
    broken.claim('a', elAt(1, 10, 100, 50))
    broken.claim('b', elAt(2, 10, 100, 50))
    broken.release('b')
    expect(which(brokenSink.sent.at(-1) ?? null), '最后一条是 null ⇒ 让位整体关掉').toBe(null)
    // 同一段操作在真实现上最后一条必须是 A（写死在这里，防这条对照自己也漂）
    const ok = sink()
    const real = createWorkRectRegistry(ok.send)
    real.claim('a', elAt(1, 10, 100, 50))
    real.claim('b', elAt(2, 10, 100, 50))
    real.release('b')
    expect(which(ok.sent.at(-1) ?? null)).toBe(1)
    expect(ok.sent.map(which)).toEqual([1, 2, 1])
  })

  it('控制项：坏实现不是"整个烂掉"—— 偏差不可见的剧本上它与真实现完全一致', () => {
    // ① 只有认领：两边都该是 [1, 2]
    const claims = (make: Make): (number | null)[] => {
      const { sent, send } = sink()
      const reg = make(send)
      reg.claim('a', elAt(1, 0, 10, 10))
      reg.claim('b', elAt(2, 0, 10, 10))
      return sent.map(which)
    }
    expect(claims(makeNullOnRelease)).toEqual(claims(createWorkRectRegistry))
    expect(claims(createWorkRectRegistry)).toEqual([1, 2])
    // ② 只释放最后一块：bug 在这一路上看不见 —— 两边都该是 [1, null]
    const single = (make: Make): (number | null)[] => {
      const { sent, send } = sink()
      const reg = make(send)
      reg.claim('a', elAt(1, 0, 10, 10))
      reg.release('a')
      return sent.map(which)
    }
    expect(single(makeNullOnRelease)).toEqual(single(createWorkRectRegistry))
    expect(single(createWorkRectRegistry)).toEqual([1, null])
  })
})
