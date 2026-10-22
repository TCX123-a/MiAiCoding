/**
 * doc-writer 单测（P10.6 本地写协议 · 渲染层执行器）。
 *
 * 这里用假 store（字符串数组当文档）+ 脚本化的主进程回话，把协议的三条命根子
 * 钉住：① 成功才清账、只清"这次带上的"；② 冲突 = 重载 + 重放 + 再写（用户
 * 操作永不丢）；③ 会话挂起 + 安全点收账。真 store 的接线在
 * stores/__tests__ 那层再验一遍。
 */
import { describe, expect, it } from 'vitest'
import type { BoxStamp, DocWriteResult, StampedDoc } from '../../../../shared/doc-write'
import { createDocWriter, MAX_WRITE_ROUNDS } from '../doc-writer'

interface Scripted {
  res: DocWriteResult<string[]> | Error
  /** 这条回话前先等它（模拟"写还在飞"的那段时间窗） */
  hold?: Promise<void>
}

interface Harness {
  data: () => string[]
  saves: Array<{ payload: string[]; stamp: BoxStamp | null }>
  errors: unknown[]
  /** onSaved 响了几声（P10.6 同步节拍的触发源，只许在真写下去时响） */
  onSavedCalls: () => number
  writer: ReturnType<typeof createDocWriter<string[], string>>
  /** 一个"用户动作"：改 live 状态 + 记账（真 store 里这两步就是成对的） */
  op: (x: string) => void
  setResolvable: (v: boolean) => void
  setReload: (data: string[], stamp: BoxStamp) => void
}

function makeHarness(script: Scripted[]): Harness {
  let data: string[] = []
  let resolvable = true
  let onSavedCount = 0
  let remote: StampedDoc<string[]> = { data: [], stamp: { epoch: 0, rev: 0 } }
  const saves: Harness['saves'] = []
  const errors: unknown[] = []
  const writer = createDocWriter<string[], string>({
    save: async (payload, stamp) => {
      saves.push({ payload: [...payload], stamp })
      const step = script.shift()
      if (!step) throw new Error('unscripted save call')
      if (step.hold) await step.hold
      if (step.res instanceof Error) throw step.res
      return step.res
    },
    reload: async () => remote,
    snapshot: () => [...data],
    adopt: (d) => {
      data = [...d]
    },
    // 幂等 ensure 语义（同真 store 的 applyOp 纪律）
    applyOp: (op) => {
      if (!data.includes(op)) data.push(op)
    },
    canResolve: () => resolvable,
    onError: (err) => {
      errors.push(err)
    },
    onSaved: () => {
      onSavedCount += 1
    }
  })
  return {
    data: () => [...data],
    saves,
    errors,
    onSavedCalls: () => onSavedCount,
    writer,
    op: (x) => {
      if (!data.includes(x)) data.push(x)
      writer.record(x)
    },
    setResolvable: (v) => {
      resolvable = v
    },
    setReload: (d, stamp) => {
      remote = { data: d, stamp }
    }
  }
}

const ok = (rev: number): DocWriteResult<string[]> => ({ ok: true, stamp: { epoch: 0, rev } })
const stale = (current: string[], rev: number): DocWriteResult<string[]> => ({
  ok: false,
  code: 'STALE_REV',
  current,
  stamp: { epoch: 0, rev }
})

describe('doc-writer（本地写协议执行器）', () => {
  it('成功：清账、戳续上，写口收到的是带戳的那一次', async () => {
    const h = makeHarness([{ res: ok(2) }])
    h.writer.noteStamp({ epoch: 0, rev: 1 })
    h.op('a')
    h.writer.writeNow()
    await h.writer.whenIdle()
    expect(h.saves).toHaveLength(1)
    expect(h.saves[0]).toEqual({ payload: ['a'], stamp: { epoch: 0, rev: 1 } })
    expect(h.writer.currentStamp()).toEqual({ epoch: 0, rev: 2 })
    expect(h.writer.pendingCount()).toBe(0)
    expect(h.data()).toEqual(['a'])
  })

  it('冲突 → 重载 + 重放 + 再写：主进程的新数据保住，用户的操作一条不少', async () => {
    const h = makeHarness([{ res: stale(['cloud'], 9) }, { res: ok(10) }])
    h.writer.noteStamp({ epoch: 0, rev: 1 })
    h.op('mine')
    h.writer.writeNow()
    await h.writer.whenIdle()
    expect(h.saves).toHaveLength(2)
    // 第一次带着旧戳
    expect(h.saves[0].stamp).toEqual({ epoch: 0, rev: 1 })
    // 第二次：重放后的载荷（云端的 + 我的）带着回话里的新戳
    expect(h.saves[1]).toEqual({ payload: ['cloud', 'mine'], stamp: { epoch: 0, rev: 9 } })
    expect(h.data()).toEqual(['cloud', 'mine'])
    expect(h.writer.pendingCount()).toBe(0)
    expect(h.writer.currentStamp()).toEqual({ epoch: 0, rev: 10 })
  })

  it('账本空时 writeNow 是纯 no-op（没有未保存的东西就不发写、不翻 rev）', async () => {
    const h = makeHarness([])
    h.writer.writeNow()
    await h.writer.whenIdle()
    expect(h.saves).toHaveLength(0)
    expect(h.writer.pendingCount()).toBe(0)
  })

  it('答题会话进行中：冲突挂起不换脚下状态；会话结束的安全点统一收账', async () => {
    const h = makeHarness([{ res: stale(['cloud'], 3) }, { res: ok(6) }])
    h.writer.noteStamp({ epoch: 0, rev: 2 })
    h.setResolvable(false)
    h.op('x')
    h.writer.writeNow()
    await h.writer.whenIdle()
    // 挂起：只发生了那一次（被拒的）写，状态与账本都没动
    expect(h.saves).toHaveLength(1)
    expect(h.data()).toEqual(['x'])
    expect(h.writer.pendingCount()).toBe(1)

    // 会话结束 → 安全点：重载（读口带戳）→ 重放 → 保存
    h.setResolvable(true)
    h.setReload(['cloud2'], { epoch: 0, rev: 5 })
    h.writer.resolveNow()
    await h.writer.whenIdle()
    expect(h.saves).toHaveLength(2)
    expect(h.saves[1]).toEqual({ payload: ['cloud2', 'x'], stamp: { epoch: 0, rev: 5 } })
    expect(h.data()).toEqual(['cloud2', 'x'])
    expect(h.writer.pendingCount()).toBe(0)
  })

  it('飞行中记录的新操作：只清这次带上的（不许在"保存成功"里被静默吞掉）', async () => {
    let open = (): void => {}
    const hold = new Promise<void>((r) => {
      open = r
    })
    const h = makeHarness([
      { res: ok(2), hold }, // 第一次写在飞
      { res: stale(['a'], 3) }, // 第二次（带着飞行中记录的 b）撞屏障
      { res: ok(4) } // 重放后再写成功
    ])
    h.writer.noteStamp({ epoch: 0, rev: 1 })
    h.op('a')
    h.writer.writeNow() // 第一次写在飞
    // 让链上的微任务真的起跑（writeNow 只是排进串行链）：saves[0] 的 snapshot
    // 落定之后 b 才来 —— 这才是真正的"飞行中"，否则 b 会挤进第一次写的载荷里
    await Promise.resolve()
    h.op('b') // 飞行途中用户又点了一下
    open()
    await h.writer.whenIdle()
    expect(h.saves[0].payload).toEqual(['a'])
    // 第二次写带上了 b（attemptWrite 的兜底轮或排队的写，两条路都行）
    expect(h.saves[1].payload).toEqual(['a', 'b'])
    // 撞屏障后：重放里必须有 b —— 曾被清成 [] 的写法会在这里把 b 丢掉
    expect(h.data()).toEqual(['a', 'b'])
    expect(h.writer.pendingCount()).toBe(0)
  })

  it('写口拉异常（非冲突）：出声、账本原样（一条都不许丢）', async () => {
    const h = makeHarness([{ res: new Error('ipc down') }])
    h.op('a')
    h.writer.writeNow()
    await h.writer.whenIdle()
    expect(h.errors).toHaveLength(1)
    expect(h.writer.pendingCount()).toBe(1)
  })

  it('一直冲突：有限轮后挂起（账本保留），安全点用新载荷重来能清账', async () => {
    const script: Scripted[] = Array.from({ length: MAX_WRITE_ROUNDS }, () => ({
      res: stale(['cloud'], 1)
    }))
    const h = makeHarness(script)
    h.op('a')
    h.writer.writeNow()
    await h.writer.whenIdle()
    expect(h.saves).toHaveLength(MAX_WRITE_ROUNDS)
    expect(h.writer.pendingCount()).toBe(1)
    // 下一次安全点（reload → replay → save）成功即可清账
    const h2 = h
    h2.setReload(['cloud'], { epoch: 0, rev: 8 })
    script.push({ res: ok(9) })
    h.writer.resolveNow()
    await h.writer.whenIdle()
    expect(h.writer.pendingCount()).toBe(0)
    expect(h.data()).toEqual(['cloud', 'a'])
  })

  it('resolveNow(force)：没挂起过也重载（同步协调器换了盘面时用），空账不发写', async () => {
    const h = makeHarness([])
    h.setReload(['from-cloud'], { epoch: 0, rev: 3 })
    h.writer.resolveNow(true)
    await h.writer.whenIdle()
    expect(h.data()).toEqual(['from-cloud'])
    expect(h.writer.currentStamp()).toEqual({ epoch: 0, rev: 3 })
    expect(h.saves).toHaveLength(0)
  })

  /**
   * onSaved（P10.6 同步节拍的触发源）：它是**同步节拍器唯一听得见的声音**，
   * 多响一声 = 白跑一轮云同步；少响一声 = 本地写永远同步不上去。
   * 两条判据合起来才钉得住"只在真写下去那一次响"。
   */
  it('onSaved：写成功响一声；被拒后重试成功的那一次也算数', async () => {
    const h = makeHarness([{ res: stale(['cloud'], 9) }, { res: ok(10) }, { res: ok(11) }])
    h.op('mine')
    h.writer.writeNow()
    await h.writer.whenIdle()
    // 第一次撞屏障（一个字节没写）→ 不响；重放后写下去 → 恰好响一声
    expect(h.onSavedCalls()).toBe(1)

    // 再一次普通成功 → 再响一声（相邻两次写各算各的）
    h.op('more')
    h.writer.writeNow()
    await h.writer.whenIdle()
    expect(h.onSavedCalls()).toBe(2)
  })

  it('onSaved：失败与挂起都不响（空账 no-op 更不响）', async () => {
    const h = makeHarness([{ res: new Error('ipc down') }, { res: stale(['cloud'], 3) }])
    h.writer.writeNow() // 空账 no-op：连写口都没碰
    await h.writer.whenIdle()
    expect(h.onSavedCalls()).toBe(0)

    h.op('a')
    h.writer.writeNow() // 写口拉异常
    await h.writer.whenIdle()
    expect(h.errors).toHaveLength(1)
    expect(h.onSavedCalls()).toBe(0)

    h.setResolvable(false)
    h.writer.writeNow() // 撞屏障且会话中 → 挂起
    await h.writer.whenIdle()
    expect(h.saves).toHaveLength(2)
    expect(h.onSavedCalls()).toBe(0)
  })
})
