import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { WallpaperWindowState } from '../../../shared/wallpaper'
import { attachWindowStatePush, readWindowState } from '../window-state'

/**
 * 窗口状态推送（main/wallpaper/window-state.ts）。
 *
 * 【守什么】渲染层的「失焦全停」全靠这条推送 —— 它坏掉的方式全都是静默的：
 *   · 去重键写错 → 状态变了不推（壁纸在后台照样播，主人第一条底线就没了）；
 *   · 丢了他的事件以后自愈轮询不补 → 停在错误状态直到下次事件；
 *   · detach 漏删监听 → 热重载攒幽灵监听，每个都对着已销毁的窗口 send（抛异常）；
 *   · petFocused 漏进去重键 → 点/离开桌宠时那条状态推不出去（壁纸该播不播，
 *     或反过来点了桌宠就停——2026-10-06 主人报的第一条体验问题）；
 *   · 瞬态失焦合并窗口（2026-10-06 第二轮「rua 一下壁纸卡一下」修复）：
 *     blur 先到、petFocused 慢路还在路上——这一帧若原样送出去，渲染层就先停
 *     一次 → 待定槽把「失焦但宠物还没持焦」的中间态压 300ms，任何更新的
 *     观察（pet-focus 到达后的 poke / 回焦 / 下一拍轮询）都让它作废。
 *     下面「瞬态失焦合并」一组就是这条链的回归测试。
 *   · 2026-10-06 审计补的四个覆盖缺口（当时对应变异体全假绿）：合并窗口内的
 *     **静默**状态变化（事件丢失）、hide/show 的可见性位、force 落在瞬态形状上、
 *     火过的定时器手柄不置 null —— 都已锁进「瞬态失焦合并」组的用例。
 * 用假窗口（鸭子类型）在 node 下测 —— 这是本模块**只 import type electron**
 * 的原因，真窗口留给 CDP 探针那头验证。
 */

/** 够用的 BrowserWindow 替身：只实现 attach 摸到的那几个面 */
class FakeWin {
  focused = true
  minimized = false
  visible = true
  destroyed = false
  wcDestroyed = false
  sent: { channel: string; payload: WallpaperWindowState }[] = []
  private listeners = new Map<string, Set<() => void>>()

  isDestroyed(): boolean {
    return this.destroyed
  }
  isFocused(): boolean {
    return this.focused
  }
  isMinimized(): boolean {
    return this.minimized
  }
  isVisible(): boolean {
    return this.visible
  }
  on(ev: string, fn: () => void): void {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set())
    this.listeners.get(ev)!.add(fn)
  }
  removeListener(ev: string, fn: () => void): void {
    this.listeners.get(ev)?.delete(fn)
  }
  emit(ev: string): void {
    for (const fn of [...(this.listeners.get(ev) ?? [])]) fn()
  }
  listenerCount(): number {
    let n = 0
    for (const s of this.listeners.values()) n += s.size
    return n
  }

  /**
   * 真 Electron 语义：窗口原生对象销毁后访问 `win.webContents` 的 **getter
   * 本身**就抛 `TypeError: Object has been destroyed`（不是返回一个「已销毁的
   * webContents」）。假窗口必须复刻这一点 —— 否则「detach 在 'closed' 回调里
   * 裸访问 webContents」的事故（2026-10-06：点 X 关窗弹原生 Error 框卡退出的
   * 根因）在单测里永远复现不出来，绿得毫无意义。
   */
  get webContents(): {
    isDestroyed: () => boolean
    send: (channel: string, payload: WallpaperWindowState) => void
    on: (ev: string, fn: () => void) => void
    removeListener: (ev: string, fn: () => void) => void
  } {
    if (this.destroyed) throw new TypeError('Object has been destroyed')
    return this.wc
  }
  private wc = {
    isDestroyed: (): boolean => this.wcDestroyed,
    send: (channel: string, payload: WallpaperWindowState): void => {
      this.sent.push({ channel, payload })
    },
    on: (ev: string, fn: () => void): void => this.on(`wc:${ev}`, fn),
    removeListener: (ev: string, fn: () => void): void => this.removeListener(`wc:${ev}`, fn)
  }
}

const asWin = (w: FakeWin): BrowserWindow => w as unknown as BrowserWindow

let win: FakeWin
let handle: { detach: () => void; poke: (ev?: string) => void } | null = null

beforeEach(() => {
  vi.useFakeTimers()
  win = new FakeWin()
})

afterEach(() => {
  handle?.detach()
  handle = null
  vi.useRealTimers()
})

describe('readWindowState：与推送同形的一次性读口', () => {
  it('三个布尔 + at + ev 全带，ev 默认 poll；petFocused 缺省为 false', () => {
    win.focused = false
    win.minimized = true
    const s = readWindowState(asWin(win))
    expect(s.focused).toBe(false)
    expect(s.minimized).toBe(true)
    expect(s.visible).toBe(true)
    expect(s.petFocused).toBe(false)
    expect(typeof s.at).toBe('number')
    expect(s.ev).toBe('poll')
  })

  it('petFocused 是 getter **现读**的（不是快照）：getter 一变读数跟着变', () => {
    let focused = false
    expect(readWindowState(asWin(win), 'poll', () => focused).petFocused).toBe(false)
    focused = true
    expect(readWindowState(asWin(win), 'poll', () => focused).petFocused).toBe(true)
  })
})

describe('attachWindowStatePush：推、去重、自愈、poke、detach', () => {
  it('状态变了才推：连发两次 focus、状态没变 → 只推一条', () => {
    handle = attachWindowStatePush(asWin(win), 'chan', 3000)
    win.emit('focus')
    win.emit('focus')
    expect(win.sent.length).toBe(1)
    expect(win.sent[0].channel).toBe('chan')
    expect(win.sent[0].payload.ev).toBe('focus')
  })

  it('失焦再回焦是**两条**（这条断了 = 失焦全停失效）', () => {
    handle = attachWindowStatePush(asWin(win), 'chan', 3000)
    // attach 后 lastKey 还是空串，所以第一条事件照推（冗余但无害；
    // 真跑起来 did-finish-load 本来就会强制补推一条 init）——
    // 这里真正要钉的是：blur 与随后的 focus 是**两条不同的推送**。
    win.emit('focus')
    win.focused = false
    win.emit('blur')
    // 瞬态失焦先压 300ms（合并窗口）——推进到截止后才送达；「先到先压、
    // 没人取消才送」的细节在下面「瞬态失焦合并」一组里逐条钉。
    vi.advanceTimersByTime(300)
    win.focused = true
    win.emit('focus')
    expect(win.sent.map((s) => s.payload.ev)).toEqual(['focus', 'blur', 'focus'])
    expect(win.sent[1].payload.focused).toBe(false)
    expect(win.sent[2].payload.focused).toBe(true)
  })

  it('去重键含最小化与可见性：minimize 变化必须推出去', () => {
    handle = attachWindowStatePush(asWin(win), 'chan', 3000)
    win.minimized = true
    win.emit('minimize')
    expect(win.sent.length).toBe(1)
    expect(win.sent[0].payload.minimized).toBe(true)
  })

  it('去重键含 petFocused：点桌宠（失焦+宠物持焦）与还焦点各推一条', () => {
    let petFocused = false
    handle = attachWindowStatePush(asWin(win), 'chan', 3000, () => petFocused)
    win.emit('focus') // 建立 lastKey（petFocused=false）
    // 点桌宠：主窗失焦 + 宠物持焦，同一刻发生
    win.focused = false
    petFocused = true
    win.emit('blur')
    expect(win.sent.length).toBe(2)
    expect(win.sent[1].payload.focused).toBe(false)
    expect(win.sent[1].payload.petFocused).toBe(true)
    // 焦点还给主窗
    win.focused = true
    petFocused = false
    win.emit('focus')
    expect(win.sent.length).toBe(3)
    expect(win.sent[2].payload.petFocused).toBe(false)
  })

  it('petFocused 单独变（主窗焦点没动、事件也没来）→ 自愈轮询是它的兜底', () => {
    let petFocused = false
    handle = attachWindowStatePush(asWin(win), 'chan', 3000, () => petFocused)
    win.emit('focus')
    expect(win.sent.length).toBe(1)
    petFocused = true // 事件丢了：没 emit 任何窗口事件
    vi.advanceTimersByTime(3000)
    expect(win.sent.length).toBe(2)
    expect(win.sent[1].payload.petFocused).toBe(true)
    expect(win.sent[1].payload.ev).toBe('recheck')
  })

  it('poke：状态没变也强制推一条（宿主上报焦点后即时纠偏，不等 3s 轮询）', () => {
    handle = attachWindowStatePush(asWin(win), 'chan', 3000)
    win.emit('focus')
    expect(win.sent.length).toBe(1)
    handle.poke('pet')
    expect(win.sent.length).toBe(2)
    expect(win.sent[1].payload.ev).toBe('pet')
    // poke 之后去重恢复常态：没变就不推
    vi.advanceTimersByTime(3000)
    expect(win.sent.length).toBe(2)
  })

  it('did-finish-load（含重载）**强制**补推一条 init，跳过（不，是压过）去重', () => {
    // 重载后渲染层是个全新的页面：它没听过任何历史推送，
    // 去重会认为「状态没变」而沉默 —— 那新页面就永远停在初始乐观值上。
    handle = attachWindowStatePush(asWin(win), 'chan', 3000)
    win.emit('focus') // 建立 lastKey
    win.emit('wc:did-finish-load')
    expect(win.sent.map((s) => s.payload.ev)).toEqual(['focus', 'init'])
  })

  it('自愈轮询：状态被原生模态框悄悄改了、事件丢了 → 下一拍补推', () => {
    handle = attachWindowStatePush(asWin(win), 'chan', 3000)
    win.emit('focus')
    // 模拟「事件丢了」：直接改状态，不发事件
    win.focused = false
    vi.advanceTimersByTime(3000)
    // 这一拍读到的正是瞬态失焦（宠物也没持焦的中间态）→ 同样进合并槽，
    // 300ms 后才送达：延迟只影响「真失焦晚一拍暂停」，不影响自愈本身
    expect(win.sent.length).toBe(1)
    vi.advanceTimersByTime(300)
    expect(win.sent.length).toBe(2)
    expect(win.sent[1].payload.ev).toBe('recheck')
    expect(win.sent[1].payload.focused).toBe(false)
    // 状态没再变 → 后续轮询零流量
    vi.advanceTimersByTime(9000)
    expect(win.sent.length).toBe(2)
  })

  it('窗口已销毁 → 不推（对着已销毁的 webContents send 会抛）；poke 也走同一条守卫', () => {
    handle = attachWindowStatePush(asWin(win), 'chan', 3000)
    win.destroyed = true
    win.emit('blur')
    expect(win.sent.length).toBe(0)
    handle.poke()
    expect(win.sent.length).toBe(0)
    win.destroyed = false
    win.wcDestroyed = true
    win.emit('focus')
    expect(win.sent.length).toBe(0)
  })

  it("'closed' 语义（窗口已销毁后）调 detach 不炸 —— 关窗卡死事故的回归", () => {
    // 真 Electron：win 的 'closed' 事件在窗口原生对象销毁**之后**触发，
    // 此时访问 win.webContents 的 getter 直接抛 TypeError。旧代码在 detach
    // 闭包里裸访问它 → 异常逃出 'closed' 回调 → Electron 弹原生 Error 框、
    // 进程常驻不退（2026-10-06 实测）。
    const d = attachWindowStatePush(asWin(win), 'chan', 3000)
    win.emit('focus')
    expect(win.sent.length).toBe(1)
    win.destroyed = true // 'closed' 已经发生过
    expect(() => d.detach()).not.toThrow()
    expect(vi.getTimerCount()).toBe(0) // 轮询停摆，不为已死窗口空转
    win.emit('blur') // 幽灵监听即便还在，也不许再对死窗口推
    expect(win.sent.length).toBe(1)
  })

  it('detach：监听全摘、轮询停摆，之后再无推送', () => {
    const d = attachWindowStatePush(asWin(win), 'chan', 3000)
    win.emit('focus')
    expect(win.listenerCount()).toBeGreaterThan(0)
    d.detach()
    expect(win.listenerCount()).toBe(0)
    win.focused = false
    win.emit('blur')
    vi.advanceTimersByTime(9999)
    expect(win.sent.length).toBe(1) // 只有 detach 前那一条
  })

  it('attach 多条时的 at 单调不减（渲染层按 at 防乱序，时间戳必须可信）', () => {
    handle = attachWindowStatePush(asWin(win), 'chan', 3000)
    win.emit('focus')
    vi.advanceTimersByTime(500)
    win.focused = false
    win.emit('blur')
    vi.advanceTimersByTime(300) // 合并窗口走完，延迟送达
    expect(win.sent[1].payload.at).toBeGreaterThanOrEqual(win.sent[0].payload.at)
  })

  // ────────────────────────────────────────────── 瞬态失焦合并（2026-10-06 二轮修复）
  //
  // 主人口径：「桌宠交互绝对不允许影响壁纸的实时渲染」。点/拖/右键桌宠会让
  // 主窗原生 blur 先到、而「桌宠持焦」的事实要走跨进程慢路晚几十 ms 才到 ——
  // 修复前这一帧失焦原样送出，渲染层先停一次再恢复（冻结 = 往返时延 + 恢复去抖），
  // 就是主人看到的「rua 一下壁纸卡一下」。下面第一条就是主人 bug 的直接回归。

  describe('瞬态失焦合并（blur 先到、pet-focus 后到的 300ms 窗口）', () => {
    it('点桌宠真顺序：全程没有任何一帧「失焦且宠物未持焦」被推出去', () => {
      let petFocused = false
      handle = attachWindowStatePush(asWin(win), 'chan', 3000, () => petFocused)
      win.emit('focus')
      expect(win.sent.length).toBe(1)
      // 点桌宠：blur 原生先到，petFocused 还是 false（慢路还在跑）
      win.focused = false
      win.emit('blur')
      expect(win.sent.length).toBe(1) // 被合并槽压住，还没送
      // pet-focus 慢路 80ms 后到 → poke 强推，槽作废
      vi.advanceTimersByTime(80)
      petFocused = true
      handle.poke('pet')
      expect(win.sent.length).toBe(2)
      expect(win.sent[1].payload).toMatchObject({ focused: false, petFocused: true, ev: 'pet' })
      // 回归判据：整场没有一帧是 focused=false && petFocused=false
      expect(win.sent.some((s) => !s.payload.focused && !s.payload.petFocused)).toBe(false)
      // 之后轮询也不许把作废的中间态补送出去
      vi.advanceTimersByTime(6000)
      expect(win.sent.length).toBe(2)
    })

    it('慢路在截止前最后一刻赶到（poke 还在路上）→ 到点重读活状态，不发旧快照', () => {
      // 2026-10-06 夜间取证修复的回归：全量套件下慢路偶尔晚于 300ms 到点，
      // 旧实现照发 blur 时刻的快照（petFocused=false）→ 渲染层先停一次
      // （240Hz 实测 25ms 的可感停顿），再由 poke 纠回。修法 = 到点重读。
      let petFocused = false
      handle = attachWindowStatePush(asWin(win), 'chan', 3000, () => petFocused)
      win.emit('focus')
      win.focused = false
      win.emit('blur') // t0：blur 先到，宠物还没持焦
      vi.advanceTimersByTime(299)
      petFocused = true // t299：慢路赶到（主进程变量已翻），poke 还没送达
      vi.advanceTimersByTime(1) // t300：截止。重读 → 不发中间态
      expect(win.sent.length).toBe(2)
      expect(win.sent[1].payload).toMatchObject({ focused: false, petFocused: true })
      expect(win.sent.some((s) => !s.payload.focused && !s.payload.petFocused)).toBe(false)
    })

    it('真失焦（300ms 内没人取消）→ 如实送达，只晚一拍', () => {
      handle = attachWindowStatePush(asWin(win), 'chan', 3000)
      win.emit('focus')
      win.focused = false
      win.emit('blur')
      vi.advanceTimersByTime(299)
      expect(win.sent.length).toBe(1) // 299 还是压着
      vi.advanceTimersByTime(1)
      expect(win.sent.length).toBe(2)
      expect(win.sent[1].payload).toMatchObject({ focused: false, ev: 'blur' })
    })

    it('压着的时候回焦 → 那条模糊状态一条都不补推（防抖的另一半）', () => {
      handle = attachWindowStatePush(asWin(win), 'chan', 3000)
      win.emit('focus')
      win.focused = false
      win.emit('blur')
      vi.advanceTimersByTime(200)
      win.focused = true
      win.emit('focus') // 回到与 lastKey 相同的状态：去重静默
      vi.advanceTimersByTime(1000)
      expect(win.sent.length).toBe(1)
    })

    it('槽已满再观察：数据刷新、时钟不重置（至多从第一次瞬态起 300ms 送达）', () => {
      handle = attachWindowStatePush(asWin(win), 'chan', 3000)
      win.emit('focus')
      win.focused = false
      win.emit('blur') // t0 布防
      vi.advanceTimersByTime(250)
      win.emit('blur') // t250 再来一下同状态：不许把截止推到 t550
      vi.advanceTimersByTime(49)
      expect(win.sent.length).toBe(1)
      vi.advanceTimersByTime(1) // t300：第一次的截止
      expect(win.sent.length).toBe(2)
    })

    it('最小化/隐藏不吃延迟（明说离开，立即送达）——对照臂', () => {
      handle = attachWindowStatePush(asWin(win), 'chan', 3000)
      win.emit('focus')
      win.focused = false
      win.minimized = true
      win.emit('minimize')
      expect(win.sent.length).toBe(2) // 立即，无 300ms
      expect(win.sent[1].payload).toMatchObject({ minimized: true, ev: 'minimize' })
      // 隐藏同理：visible 掉出瞬态条件，emit 当场就得送（2026-10-06 审计补：
      // 原先这条只测了 minimize，把 visible 条件删掉也全绿 —— 名不副实）
      win.minimized = false
      win.visible = false
      win.emit('hide')
      expect(win.sent.length).toBe(3)
      expect(win.sent[2].payload).toMatchObject({ focused: false, visible: false, ev: 'hide' })
    })

    it('合并窗口内静默回焦（focus 事件丢失）：到点不发冗余，之后的真实失焦仍必须送达', () => {
      // 2026-10-06 审计发现的口径缺口：现有用例全是「事件按时到」的形状，
      // 静默变化（原生模态框等丢事件场景 —— 自愈轮询存在的理由）落在合并
      // 窗口里时无人覆盖。到点重读会发现已回焦（freshKey===lastKey）→
      // 正确行为 = 什么都不发。
      handle = attachWindowStatePush(asWin(win), 'chan', 3000)
      win.emit('focus') // sent#1：focused
      win.focused = false
      win.emit('blur') // 压进槽
      vi.advanceTimersByTime(150)
      win.focused = true // 静默回焦：没有 focus 事件
      vi.advanceTimersByTime(150) // 到点：重读发现已回焦 → 不发
      expect(win.sent.length).toBe(1)

      win.focused = false
      win.emit('blur') // 现在是真的离开：新瞬态必须重新布防
      vi.advanceTimersByTime(300)
      expect(win.sent.length).toBe(2) // ← 火过的手柄不置 null（陈槽挡布防）在这里红
      expect(win.sent[1].payload).toMatchObject({ focused: false, petFocused: false, ev: 'blur' })
    })

    it('静默回焦后到点：一条假失焦都不许冒出去（重读 + 去重的双保险）', () => {
      // 半吊子重读（只重读 petFocused、其余沿用旧快照）或删掉
      // freshKey===lastKey 去重，都会在这里漏出一条 focused:false 的假事实。
      handle = attachWindowStatePush(asWin(win), 'chan', 3000)
      win.emit('focus')
      win.focused = false
      win.emit('blur')
      vi.advanceTimersByTime(150)
      win.focused = true
      vi.advanceTimersByTime(150)
      expect(win.sent.length).toBe(1)
      expect(win.sent.filter((s) => !s.payload.focused).length).toBe(0)
    })

    it('poke 落在瞬态形状上：force 豁免合并槽，立即送达（对照臂）', () => {
      // poke = 宿主上报焦点变化的强推（force）；哪怕此刻形状恰好是瞬态
      // （blur 已如实送达、宠物还没持焦），也必须当场送 —— 不许被合并槽
      // 吞掉，也不许被去重挡下。
      handle = attachWindowStatePush(asWin(win), 'chan', 3000)
      win.emit('focus')
      win.focused = false
      win.emit('blur')
      vi.advanceTimersByTime(300) // 瞬态如实送达（sent#2）
      expect(win.sent.length).toBe(2)
      handle.poke('pet') // 同一形状再来一发强推
      expect(win.sent.length).toBe(3) // ← force 豁免被删（poke 也进槽/被吞）在这里红
      expect(win.sent[2].payload).toMatchObject({ focused: false, ev: 'pet' })
    })

    it('去重键含可见性：hide/show 变化必须推出去', () => {
      handle = attachWindowStatePush(asWin(win), 'chan', 3000)
      win.emit('focus') // sent#1
      win.visible = false
      win.emit('hide')
      expect(win.sent.length).toBe(2) // ← 去重键丢 visible 位（hide 被吞）在这里红
      expect(win.sent[1].payload).toMatchObject({ focused: true, visible: false, ev: 'hide' })
      win.visible = true
      win.emit('show')
      expect(win.sent.length).toBe(3)
      expect(win.sent[2].payload).toMatchObject({ focused: true, visible: true, ev: 'show' })
    })

    it('detach 清掉合并定时器：摘链之后不许再冒出延迟推送', () => {
      const d = attachWindowStatePush(asWin(win), 'chan', 3000)
      win.emit('focus')
      win.focused = false
      win.emit('blur')
      d.detach()
      expect(vi.getTimerCount()).toBe(0)
      vi.advanceTimersByTime(5000)
      expect(win.sent.length).toBe(1)
    })
  })
})
