/**
 * 原生环境编译观察器（main/runner/native-watch.ts）的测试。
 *
 * 【这个文件在守什么】
 * 观察器每确认一条就往奖励链上发一次事件。它坏掉的方式全是**静默**的：
 *   · 错报（老产物 / 0 字节残骸 / 上一次编译的产物被当成「刚编译成功」）→
 *     奖励发错了边，事后翻日志没有任何线索；
 *   · 漏报（该发没发）→ 用户看到的是「我明明编译成功了，桌宠没反应」；
 *   · 边界（恰好相等的 mtime、超窗那一拍、stat 抛异常）→ 表现为「有时候对有时候
 *     不对」，手工试一百次也碰不齐。
 * 所以这里的重点不是「跑通」，是把上面每一条都**逼出来**。
 *
 * 【时间与文件系统都是假的】
 * 真等 15 分钟、真造一个 exe 既不可能也不该在单测里做。now / statFn 是注入的
 * （见模块头部：这是设计约束），假计时器负责让 setInterval 的每一拍**同步**发生。
 * `world.advance()` 把「世界时钟」和「假计时器」一起推 —— 两条时间线必须一起走，
 * 只推一条会造出自己骗自己的用例。
 *
 * 【夹具的方向：默认不存在】
 * 假世界里只有 put() 进来的路径才「存在」，其余一律 null。默认不存在的世界比
 * 默认存在的难骗人：漏写一条夹具会立刻红，而不是悄摸摸命中。
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_PENDING,
  createNativeWatcher,
  type NativeCompiledEvent,
  type NativeWatchRequest,
  type NativeWatcher
} from '../native-watch'

/** 夹具目录：只当字符串用，不碰磁盘（statFn 是注入的） */
const DIR = join(tmpdir(), 'miai-native-watch')
const SRC_C = join(DIR, 'main.c')
const EXE_C = join(DIR, 'main.exe')
// cpp 用不同的主干名：裸眼看期望值就知道产物该叫什么
const SRC_CPP = join(DIR, 'lesson.cpp')
const EXE_CPP = join(DIR, 'lesson.exe')
const SRC_JAVA = join(DIR, 'Foo.java')
const CLASS_JAVA = join(DIR, 'Foo.class')
const SRC_PY = join(DIR, 'main.py')

/** startedAt 基准：用真实量级的毫秒值，避免「拿 0 当时刻」这种只有测试里才成立的巧合 */
const T0 = 1_700_000_000_000
const INTERVAL = 100 // 轮询间隔（假计时器；advance 按它走）
const WINDOW = 10_000 // 观察窗口

interface FakeFile {
  mtimeMs: number
  size: number
}

/**
 * 假世界：文件表 + 可推的时钟。
 * `advance` 同时推世界时钟与假计时器：只推假计时器的话，模块读到的 now() 从没
 * 动过（超窗与 mtime 判定全失真）；只推时钟的话，轮询一拍都不发生。
 */
function makeWorld() {
  const files = new Map<string, FakeFile>()
  let clock = T0

  return {
    put(p: string, mtimeMs: number, size = 4096): void {
      files.set(p, { mtimeMs, size })
    },
    del(p: string): void {
      files.delete(p)
    },
    statFn: (p: string): FakeFile | null => files.get(p) ?? null,
    now: (): number => clock,
    advance(ms: number): void {
      clock += ms
      vi.advanceTimersByTime(ms)
    }
  }
}

type World = ReturnType<typeof makeWorld>

/** 建过的 watcher 全登记在册：漏 stop 的话定时器会活到下一个用例里去 */
const liveWatchers: NativeWatcher[] = []

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const w of liveWatchers.splice(0)) w.stop()
  vi.useRealTimers()
})

interface Harness {
  watcher: NativeWatcher
  events: NativeCompiledEvent[]
  logs: string[]
}

function startWatcher(
  world: World,
  opts: { watchMs?: number; intervalMs?: number; statFn?: (p: string) => FakeFile | null } = {}
): Harness {
  const events: NativeCompiledEvent[] = []
  const logs: string[] = []
  const watcher = createNativeWatcher({
    onCompiled: (ev) => events.push(ev),
    now: world.now,
    statFn: opts.statFn ?? world.statFn,
    intervalMs: opts.intervalMs ?? INTERVAL,
    watchMs: opts.watchMs ?? WINDOW,
    log: (line) => logs.push(line)
  })
  liveWatchers.push(watcher)
  return { watcher, events, logs }
}

/** 一条 c 的观察请求；字段都能单独覆盖，方便造「同源覆盖」「换语言」这些用例 */
function req(over: Partial<NativeWatchRequest> = {}): NativeWatchRequest {
  return { sourceFile: SRC_C, fingerprint: 'c0:abcd1234', lang: 'c', startedAt: T0, ...over }
}

describe('确认编译成功：四条判据全过才发一次', () => {
  it.each([
    ['c', SRC_C, EXE_C],
    ['cpp', SRC_CPP, EXE_CPP]
  ] as const)('① %s：产物比 startedAt 新 → 触发一次且只一次', (lang, src, artifact) => {
    const world = makeWorld()
    world.put(src, T0 - 500) // 导出时写下的源文件
    world.put(artifact, T0 + 100) // 用户按了编译，产物出现
    const h = startWatcher(world)
    h.watcher.track(req({ lang, sourceFile: src }))

    world.advance(INTERVAL)
    expect(h.events).toEqual([
      { sourceFile: src, fingerprint: 'c0:abcd1234', artifact, at: T0 + INTERVAL }
    ])

    // 一次性：表里已除名，之后几拍再看到同样的产物也不许再发（否则奖励会重复）
    world.advance(INTERVAL * 5)
    expect(h.events).toHaveLength(1)
    expect(h.watcher.debugList()).toEqual([])
    expect(vi.getTimerCount(), '表空了定时器就该撤，别永远每 2 秒醒一次').toBe(0)
  })

  it.each([
    ['比 startedAt 旧 1ms（上一次编译的残留）', T0 - 1],
    ['恰好等于 startedAt（边界：分不出来就不算证据）', T0]
  ] as const)('② 产物 %s → 不触发', (_name, exeMtime) => {
    const world = makeWorld()
    world.put(SRC_C, T0 - 500)
    world.put(EXE_C, exeMtime)
    const h = startWatcher(world)
    h.watcher.track(req())

    // 一直观察到窗口过完：从头到尾一次都不许发（发一次就是错报）
    world.advance(WINDOW + INTERVAL)
    expect(h.events).toEqual([])
    expect(h.watcher.debugList()).toEqual([])
  })

  it('③ 产物比源文件旧（用户存过盘、没重新编译）→ 不触发', () => {
    const world = makeWorld()
    world.put(SRC_C, T0 + 500) // 导出之后用户在 IDE 里又存了一次盘
    world.put(EXE_C, T0 + 100) // 产物比 startedAt 新，但比源文件旧 = 配不上现在这份源码
    const h = startWatcher(world)
    h.watcher.track(req())

    world.advance(WINDOW + INTERVAL)
    expect(h.events).toEqual([])
  })

  it('④ 产物 size = 0（编译中途/失败留下的残骸）→ 不触发', () => {
    const world = makeWorld()
    world.put(SRC_C, T0 - 500)
    world.put(EXE_C, T0 + 100, 0)
    const h = startWatcher(world)
    h.watcher.track(req())

    world.advance(WINDOW + INTERVAL)
    expect(h.events).toEqual([])
  })

  it('⑤ java：Foo.java 旁边出现 Foo.class → 命中（主干名 + .class）', () => {
    const world = makeWorld()
    world.put(SRC_JAVA, T0 - 500)
    world.put(CLASS_JAVA, T0 + 100)
    const h = startWatcher(world)
    h.watcher.track(req({ sourceFile: SRC_JAVA, lang: 'java', fingerprint: 'j7:ff00aa11' }))

    world.advance(INTERVAL)
    expect(h.events).toEqual([
      { sourceFile: SRC_JAVA, fingerprint: 'j7:ff00aa11', artifact: CLASS_JAVA, at: T0 + INTERVAL }
    ])
  })
})

describe('边界与生命周期', () => {
  it('⑥ python：没有产物可观察 → 拒收（不入表、不触发），并留一行日志说明是**有意划界**', () => {
    const world = makeWorld()
    world.put(SRC_PY, T0 - 500)
    world.put(join(DIR, 'main.pyc'), T0 + 100) // 就算旁边冒出别的东西也不认
    const h = startWatcher(world)
    h.watcher.track(req({ sourceFile: SRC_PY, lang: 'python' }))

    world.advance(WINDOW + INTERVAL)
    expect(h.events).toEqual([])
    expect(h.watcher.debugList(), 'python 连表都不该进').toEqual([])
    // 日志是给「排查为什么没发奖励」的人看的：得说清被拒的是谁
    expect(h.logs).toHaveLength(1)
    expect(h.logs[0]).toContain('python')
    expect(h.logs[0]).toContain(SRC_PY)
  })

  it('⑦ 源文件不在了 → 静默移除（一条日志都不留）', () => {
    const world = makeWorld()
    world.put(SRC_C, T0 - 500) // 先只有源文件
    const h = startWatcher(world)
    h.watcher.track(req())

    world.advance(INTERVAL)
    expect(h.logs, '等待中的每一拍都不该写日志（15 分钟窗口 = 450 拍噪声）').toEqual([])

    world.del(SRC_C) // 用户把导出目录自己收拾了
    world.advance(INTERVAL)
    expect(h.events).toEqual([])
    expect(h.watcher.debugList()).toEqual([])
    expect(h.logs, '源文件消失是静默路线：没有可做的事，就不该往日志里写').toEqual([])
  })

  it('⑧ 窗口过完仍未命中 → 移除 + 一行日志（「为什么没发奖励」靠它排查）', () => {
    const world = makeWorld()
    world.put(SRC_C, T0 - 500) // 产物始终没出现
    const h = startWatcher(world, { watchMs: 1000 })
    h.watcher.track(req())

    world.advance(999)
    expect(h.watcher.debugList(), '差 1ms 到期还不许丢').toHaveLength(1)

    world.advance(1) // 恰满窗口：过期
    expect(h.watcher.debugList()).toEqual([])
    expect(h.events).toEqual([])
    expect(h.logs.some((l) => l.includes(SRC_C)), '超窗是值得解释的退出路线，要留痕').toBe(true)
  })

  it('⑨ stop() 之后：表清空、定时器停掉，产物再出现也不触发', () => {
    const world = makeWorld()
    world.put(SRC_C, T0 - 500)
    const h = startWatcher(world)
    h.watcher.track(req())
    h.watcher.stop()

    expect(h.watcher.debugList()).toEqual([])
    expect(vi.getTimerCount(), 'stop 必须把定时器清掉（不然观察器永不退场）').toBe(0)

    world.put(EXE_C, T0 + 100) // 停止之后产物才出现
    world.advance(INTERVAL * 5)
    expect(h.events).toEqual([])
  })

  it('⑩ 重复 track 同一源文件 → 覆盖旧条（按最新导出判定），不发重复奖励', () => {
    const world = makeWorld()
    world.put(SRC_C, T0 - 500)
    const h = startWatcher(world)
    h.watcher.track(req({ fingerprint: 'a:11112222' })) // 第一次导出
    h.watcher.track(req({ fingerprint: 'b:33334444', startedAt: T0 + 250 })) // 同一条路又导出一次
    expect(h.watcher.debugList(), '同一个 sourceFile 在表里只许有一条').toHaveLength(1)

    // 旧条若还活着，下面这个 mtime 会被它算成命中（T0+200 > T0）；
    // 新条（startedAt = T0+250）必须把它判成老产物。
    world.put(EXE_C, T0 + 200)
    world.advance(INTERVAL * 2)
    expect(h.events).toEqual([])

    // 用户重新编译：这次真的比新 startedAt 新
    world.put(EXE_C, T0 + 600)
    world.advance(INTERVAL)
    expect(h.events).toEqual([
      { sourceFile: SRC_C, fingerprint: 'b:33334444', artifact: EXE_C, at: T0 + INTERVAL * 3 }
    ])
  })

  it(`⑪ 队列上限 ${MAX_PENDING} 条：第 ${MAX_PENDING + 1} 条挤掉**最老**的那条（并记日志）`, () => {
    const world = makeWorld()
    const srcs = Array.from({ length: MAX_PENDING + 1 }, (_, i) => join(DIR, `q${i}.c`))
    for (const s of srcs) world.put(s, T0 - 500)
    const h = startWatcher(world)
    for (const s of srcs) h.watcher.track(req({ sourceFile: s }))

    expect(h.watcher.debugList().map((d) => d.sourceFile)).toEqual(srcs.slice(1))
    expect(h.logs.some((l) => l.includes(srcs[0])), '丢最老的要留痕').toBe(true)

    // 被挤掉的那条就算产物出现也不许再触发（它已经不在册了）
    world.put(join(DIR, 'q0.exe'), T0 + 100)
    world.advance(INTERVAL)
    expect(h.events).toEqual([])
  })

  it('⑫ statFn 抛异常 → 按「不存在」处理：不触发，异常也不许冒出去', () => {
    const world = makeWorld()
    world.put(SRC_C, T0 - 500)
    world.put(EXE_C, T0 + 100)
    let broken = true // 杀软/占用都可能让产物那句 stat 真抛 EPERM
    const h = startWatcher(world, {
      statFn: (p) => {
        if (broken && p === EXE_C) throw new Error('EPERM: operation not permitted')
        return world.statFn(p)
      }
    })
    h.watcher.track(req())

    world.advance(INTERVAL) // 异常若没被收口，会从这里冒出来把用例打红
    expect(h.events).toEqual([])
    expect(h.watcher.debugList(), '读不到 ≠ 命中，条目继续等').toHaveLength(1)

    broken = false
    world.advance(INTERVAL)
    expect(h.events, '异常恢复之后照样能命中（没把这条弄脏）').toHaveLength(1)
  })
})
