/**
 * 工作区登记表（跟随鼠标的「绝不遮挡代码」让位规则，渲染端唯一出口）。
 * 2026-10-10：从 RunnerPanel.vue 抽出来，并把答题页（QuizCodeRun）接上。
 *
 * 【它解决的问题】跟随中的鱼会直接压在用户正在打字的编辑区上。渲染层把
 * 「用户此刻在看的工作区」按**视口坐标 CSS px** 报给主进程（pet:report-work-rect），
 * 光标落进这块矩形（主进程外扩 WORK_RECT_PAD）时鱼改为沿边等待 —— 消费端见
 * main/dshpet/host.ts 的 followTargetFor。屏幕系换算、外扩、选边全在主进程，
 * 这一层只负责一件事：**如实、及时地说出「现在该给哪块让位」**。
 *
 * 【为什么是一张登记表，而不是每个组件各报一份】
 * 练习场的 RunnerPanel 和答题页的 QuizCodeRun 会**同时挂载**：答题遮罩是
 * /playground 上的覆盖层，遮罩打开时练习场那块编辑区还开在屏幕上（只是被盖住）。
 * 两个调用点各写一份直报的话，就成了「谁最后动谁说了算」：
 *   · 覆盖层打开 —— 报遮罩里的编辑区（对）；
 *   · 覆盖层关掉 —— 它 onBeforeUnmount 报 null，可练习场的编辑区还在屏幕上，
 *     让位规则被整体撤掉，直到下一次 resize/scroll 才恢复（错，且是回归）。
 * 所以收成一个**栈**：claim 入栈（后 claim 的在上 —— 覆盖层压在练习场之上）、
 * release 出栈；**栈空才报 null**，栈里还有人时立刻把栈顶那个的矩形重报一遍。
 * 元素观测（ResizeObserver + resize + 捕获阶段 scroll + 120ms 节流）也一并收在
 * 这一层，调用点只剩「认领 / 释放」两句话 —— 观测各写一份的话，迟早只有一份
 * 记得处理内层滚动容器那种坑（见 schedule/attach 的注释）。
 *
 * 【当前的 key（谁在栈里）】
 *   · 'runner' —— 练习场 RunnerPanel 的正文编辑区（/playground）
 *   · 'quiz'   —— 答题页 QuizCodeRun 的代码编辑区（QuizOverlay 的真跑题型；
 *                 遮罩里不是每种题型都有编辑器，没有的那种自然不在栈里）
 *
 * 【为什么 send 是注入的、与 window 的耦合缩到最薄】
 * ① 让这一层能被单测直接驱动：夹一个记录数组就能把栈语义整个跑一遍，不用造 window；
 * ② window.miai 不存在（极早期 / 测试环境）时静默 —— 本仓库所有 pet 上报口的一致
 *    口径（见 lib/pet-bridge.ts 文件头：桌宠是挂件，它的故障不许影响学习流程）。
 *    petReportWorkRect 是**单向 send**，所以这里只有同步这一条逃逸路
 *    （没有 invoke 被拒那条异步路），但 try/catch 照样一条都不能少。
 */
import type { PetViewRect } from './pet-bridge'

/**
 * 上报合流窗口（从 RunnerPanel.vue 原样搬来，不是新拍的）：拖分隔条一秒能触发
 * 几十次回调，全量转发会把主进程日志刷满 —— host.ts 那边对「值没变」的重报
 * 已经不落日志了，但我们连送都不想多送。120ms 合流一次，人眼与让位规则都
 * 感知不到差别。
 */
const REPORT_THROTTLE_MS = 120

/** 栈里的一格 */
interface Entry {
  key: string
  /** 量矩形的元素。null = 登记了，但暂时没有可量的元素（还没渲染出来 / 这题没有编辑器） */
  el: HTMLElement | null
  /** 这一格自己的尺寸观察器（换元素就换新的；没有元素就没有） */
  observer: ResizeObserver | null
}

export interface WorkRectRegistry {
  claim(key: string, el: HTMLElement | null | undefined): void
  release(key: string): void
}

/**
 * 造一个登记表实例。生产只有文件末尾那一个单例；工厂导出是给单测用的
 * （每个用例一份干净实例，不用互相擦屁股）。
 */
export function createWorkRectRegistry(send: (rect: PetViewRect | null) => void): WorkRectRegistry {
  /** 栈：数组尾部 = 栈顶（后 claim 的在上）。 */
  const entries: Entry[] = []
  /** 合流计时器：整个登记表共用一只（所有格子的事件汇到同一次重报） */
  let timer: ReturnType<typeof setTimeout> | null = null
  /** window 级的 resize / 捕获 scroll 两条监听挂着没有（第一个 claim 挂、栈空才摘） */
  let listening = false

  /**
   * 量一格的视口矩形。量不出来（没元素 / 宽高不为正）返回 null。
   *
   * 宽高必须为正：主进程会把坏载荷按 null 处理**并记一行日志**（host.ts 的
   * reportWorkRect）—— 送一块 0 宽/半截的矩形过去，等于用日志噪音换一件
   * 我们自己已经知道的事。在这一层就摘干净，那边那行日志才只闪真信号。
   */
  function rectOf(el: HTMLElement | null): PetViewRect | null {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null
  }

  /**
   * 现在该报哪块：从栈顶往下找**第一块量得出来的**；整栈都量不出来才 null。
   *
   * 【为什么栈顶量不出来不直接报 null —— 这是刻意的选择，不是随手写的】
   * 「这个 key 量不出来」的意思只是「**它自己**现在不在屏幕上」（元素还没渲染 /
   * display:none / 尺寸被压成 0），不是「别的 key 也不在」。栈顶量不出来就报 null，
   * 会把下面明明还开着的编辑区一起撤掉让位 —— 这和「释放栈中间那项却报 null」
   * 是同一个 bug 的另一副面孔。所以不可见只把**自己**从候选里摘掉，让位对象
   * 顺位给下一个。
   *
   * 【被否掉的另一种写法】「栈顶没有矩形 ⇒ 报 null（让位规则整体关掉）」：
   * 它把「这一个 key 不知道」读成了「谁都不知道」，两个调用点共享一块屏幕时
   * 就会互相踩。真到整栈都没有（路由走空 / 窗口要卸了）才报 null —— 那才是
   * 「没有让位对象」该有的样子，主进程退回「光标下方」（host.ts 的口径）。
   */
  function topRect(): PetViewRect | null {
    for (let i = entries.length - 1; i >= 0; i--) {
      const r = rectOf(entries[i].el)
      if (r) return r
    }
    return null
  }

  /**
   * 立刻重算并上报，顺手把待发的那一拍吞掉（同一份状态不许报两遍）。
   * claim / release 走它：开关覆盖层是人眼盯着的一次性动作，晚 120ms 会让鱼
   * 先趴到旧位置再弹开；节流（schedule）是给「拖分隔条」那种连续变化用的。
   */
  function flush(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    send(topRect())
  }

  /** 120ms 合流：窗口里连发多少次事件，只补报一次，报的是那一拍的最新值 */
  function schedule(): void {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      send(topRect())
    }, REPORT_THROTTLE_MS)
  }

  /**
   * 挂 window 级监听（第一个格子进栈时挂、栈空了才摘，全局只挂一份）。
   *
   * resize：窗口一大一小，编辑区矩形跟着变。
   * scroll 必须用**捕获阶段**听：滚动容器是内层的 MAIN，元素上的 scroll 事件
   * 不冒泡到 window —— 非捕获阶段这条监听什么都听不到（原 RunnerPanel.vue
   * 里踩过并写进注释的坑，原样搬来）。
   * 测试环境（node）没有 window：静默跳过，登记表其余部分照常工作。
   */
  function attach(): void {
    if (listening) return
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
    listening = true
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
  }

  function detach(): void {
    if (!listening) return
    listening = false
    // attach 的对偶：环境里没有 window 时静默回来（不为不存在的东西留半挂状态）
    if (typeof window === 'undefined' || typeof window.removeEventListener !== 'function') return
    window.removeEventListener('resize', schedule)
    window.removeEventListener('scroll', schedule, true)
  }

  /** 给一格（重新）建尺寸观察器：换元素先拆旧的，绝不叠两套 */
  function watchEl(entry: Entry): void {
    entry.observer?.disconnect()
    entry.observer = null
    if (!entry.el) return
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(schedule)
    ro.observe(entry.el)
    entry.observer = ro
  }

  /**
   * 认领。同一 key 重复认领是**原地更新**：不重复入栈、不叠观察器、顺序不动。
   *
   * 【为什么再 claim 不搬到栈顶】栈序表达的是「谁盖着谁」（层级），不是
   * 「谁最后开的口」。搬家的话，练习场任何一次重新 claim 都会爬到答题覆盖层
   * 上面去 —— 而覆盖层还盖着它。
   */
  function claim(key: string, el: HTMLElement | null | undefined): void {
    const next = el ?? null
    const found = entries.find((e) => e.key === key)
    if (found) {
      if (found.el !== next) {
        found.el = next
        watchEl(found)
      }
    } else {
      const entry: Entry = { key, el: next, observer: null }
      entries.push(entry)
      watchEl(entry)
    }
    attach()
    flush()
  }

  /**
   * 释放（出栈）。从栈里哪一格释放都行 —— 从中间移除不影响其余顺序。
   *
   * 【释放为什么要立刻重报栈顶，而不是报 null —— 这是本模块存在的一半理由】
   * 反面教材：答题覆盖层关掉时，如果它直接在 onBeforeUnmount 报 null，练习场
   * 那块**还开在屏幕上**的编辑区会连坐被撤 —— 让位规则整体关掉，直到下一次
   * resize/scroll 才恢复。所以栈里还有人就立刻把栈顶那个的矩形重报一遍；
   * 只有栈空了才报 null（那才是真的没有让位对象了）。
   *
   * 【没有认领过的 key】什么都不做（什么都没变，就别惊动主进程）——
   * 更不许顺手报 null：那会把别人好好的让位对象撤掉。
   */
  function release(key: string): void {
    const i = entries.findIndex((e) => e.key === key)
    if (i === -1) return
    entries[i].observer?.disconnect()
    entries.splice(i, 1)
    if (entries.length === 0) detach()
    flush()
  }

  return { claim, release }
}

/** 生产出口：window.miai 不在时静默（同 pet-bridge 的全家口径，见文件头） */
function sendToPet(rect: PetViewRect | null): void {
  try {
    window.miai.petReportWorkRect(rect)
  } catch {
    /* 桌宠通道不在（极早期 / 测试环境）—— 学习流程优先 */
  }
}

/** 全局唯一实例：两个调用点（RunnerPanel / QuizCodeRun）共用这一份栈 */
const registry = createWorkRectRegistry(sendToPet)

/**
 * 认领工作区：把你那块元素登记为「用户此刻在看的工作区」。
 * 后认领的在上（答题覆盖层压在练习场之上）；同一 key 重复认领是幂等更新
 * （元素换了就跟换；不重复入栈、顺序不动、观察器不叠）。
 * 元素为 null / 量不出来时的口径见 topRect 的注释（只摘掉自己，不算别人）。
 */
export function claimWorkRect(key: string, el: HTMLElement | null | undefined): void {
  registry.claim(key, el)
}

/** 释放：出栈。栈里还有别人时**立刻重报栈顶那个的矩形**（不是报 null） */
export function releaseWorkRect(key: string): void {
  registry.release(key)
}
