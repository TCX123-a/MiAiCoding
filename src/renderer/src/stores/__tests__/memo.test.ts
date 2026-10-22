/**
 * 备忘录的落盘与动作（stores/memo.ts）
 *
 * 【这个文件在守什么】
 * 守三件用户会**立刻发现**、而我们看不见的事：
 *
 *   ① **我敲的字真的写进盘了。** 备忘的保存是整份防抖写回，而写失败时
 *      界面（Vue）完全看不出区别 —— 要等下次启动才发现少了一截。
 *      所以「存不上必须出声」这条路要有单测（`failMemoSave` 开关 + toast 断言）。
 *   ② **64KB 拦截量的是字节。** 拿 `body.length`（UTF-16 码元）当判据的话，
 *      汉字笔记会在界面上显示"没超"、然后被主进程写口整个拒掉 ——
 *      赔进去的是**这一次保存的全部改动**。这条用 3 万汉字钉住。
 *   ③ **落盘的载荷里没有响应式代理。** 假 window 的 save 用 `structuredClone`
 *      收件（真 IPC 就用这个算法）：混进代理会当场抛，而不是等用户重启。
 *
 * 【为什么假 window 故意用 structuredClone 收件】
 * 和 favorites.test.ts 同一条理由（那边抬头写得更细）：用真 IPC 同一个算法
 * 做假货，"入参里混进了代理"才会**在测试里当场炸**。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { SAVE_DEBOUNCE_MS, bodyTooLong, useMemoStore } from '../memo'
import { toasts } from '../../components/base/toast'
import { MEMO, TOAST } from '../../lib/copy'
import { CURRENT_MEMO_VERSION, MEMO_BODY_MAX, type MemoFile } from '../../../../shared/types'
import type { BoxStamp, DocWriteResult, StampedDoc } from '../../../../shared/doc-write'

function emptyFile(): MemoFile {
  // 版本号走共享常量，不写死数字（同 favorites.test.ts 的规矩）
  return { version: CURRENT_MEMO_VERSION, items: [] }
}

interface StubOpts {
  /** 读档返回什么（不传 = 首次运行，备忘录是空的） */
  existing?: MemoFile
  /** 读档挂住不返回 —— 模拟「还没读完」 */
  hang?: boolean
  /** `memo.save` 直接拒绝 —— 测「存不上时界面怎么说话」 */
  failSave?: boolean
  /** 读档直接拒绝 —— 测 V1-53「读档失败要出声」 */
  readFails?: boolean
}

/**
 * 装上假的 window.miai（照 favorites.test.ts 那份）。
 * ⚠️ 除了 `miai` 还得给 `addEventListener`：store 在 setup 里就会
 * `window.addEventListener('beforeunload', flush)`，不给的话 store 根本建不起来。
 *
 * 【P10.6：读写口是带戳信封】`memo.get` 回 `{data, stamp}`、`memo.save` 收戳回
 * `DocWriteResult`（形状照 shared/doc-write.ts）。戳 = 单调 rev（写成功 +1，
 * 照主进程 BoxedStore 的语义）—— "读来的戳带去下一次写"这条转发链才有判据。
 */
function stubMiai(opts: StubOpts = {}) {
  const saved: MemoFile[] = []
  /** 每次 save **尝试**带上的戳 —— 转发协议的判据看它 */
  const saveStamps: (BoxStamp | null | undefined)[] = []
  const listeners: Record<string, (() => void)[]> = {}
  let rev = 0
  const stampNow = (): BoxStamp => ({ epoch: 0, rev })

  ;(globalThis as unknown as { window: unknown }).window = {
    addEventListener: (type: string, fn: () => void) => {
      ;(listeners[type] ??= []).push(fn)
    },
    miai: {
      memo: {
        get: (): Promise<StampedDoc<MemoFile>> => {
          if (opts.readFails) return Promise.reject(new Error('stub: memo read failed'))
          return opts.hang
            ? new Promise<StampedDoc<MemoFile>>(() => {})
            : Promise.resolve({
                data: opts.existing ? structuredClone(opts.existing) : emptyFile(),
                stamp: stampNow()
              })
        },
        save: (f: MemoFile, stamp?: BoxStamp | null): Promise<DocWriteResult<MemoFile>> => {
          saveStamps.push(stamp)
          // 这一行是重点：真实 ipcRenderer.invoke 就是这么收件的。
          // 入参里混进响应式代理 → 这里会像真实环境一样抛 DataCloneError
          saved.push(structuredClone(f))
          if (opts.failSave) return Promise.reject(new Error('stub: memo save failed'))
          rev += 1
          return Promise.resolve({ ok: true, stamp: stampNow() })
        }
      }
    }
  }

  return {
    saved,
    saveStamps,
    fire: (type: string) => listeners[type]?.forEach((f) => f())
  }
}

/** 让出一轮，把 watch（默认异步）排上的定时器真的排上（理由见 favorites.test.ts） */
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  setActivePinia(createPinia())
  toasts.splice(0, toasts.length)
})

/**
 * 每个测试收尾：先等 watcher 排上的定时器，再冲掉。
 * 不这么做的话，定时器会活到**下一个测试**里触发，把上一个测试的数据
 * 写进下一个测试的 `saved`（favorites.test.ts 抬头记过同一件事）。
 */
afterEach(async () => {
  await settle()
  useMemoStore().flush()
})

describe('新建与编辑', () => {
  it('新建：排在列表最前、id 带时间戳与序号、标题正文都是空串', async () => {
    stubMiai()
    const s = useMemoStore()
    await settle()

    const it = s.add('code')
    expect(s.items[0].id).toBe(it.id)
    expect(it.kind).toBe('code')
    expect(it.title).toBe('')
    expect(it.body).toBe('')
    expect(it.id.startsWith('memo-')).toBe(true)
    expect(it.updatedAt).toBe(it.createdAt)
  })

  it('同一毫秒连建两条，id 不能撞（撞了主进程会把后一条当重复项丢掉）', async () => {
    stubMiai()
    const s = useMemoStore()
    await settle()
    const a = s.add('code')
    const b = s.add('knowledge')
    expect(a.id).not.toBe(b.id)
    expect(s.items).toHaveLength(2)
    // 后建的排更前（最近记的在最上面）
    expect(s.items[0].id).toBe(b.id)
  })

  it('改标题 / 正文 / 分类都写进 store，updatedAt 跟着走', async () => {
    stubMiai()
    const s = useMemoStore()
    await settle()
    const it = s.add('code')

    expect(s.setTitle(it.id, '陷阱')).toBe(true)
    expect(s.itemOf(it.id)!.title).toBe('陷阱')
    expect(s.setBody(it.id, 'x = []')).toBe(true)
    expect(s.itemOf(it.id)!.body).toBe('x = []')
    expect(s.setKind(it.id, 'knowledge')).toBe(true)
    expect(s.itemOf(it.id)!.kind).toBe('knowledge')
    expect(s.itemOf(it.id)!.updatedAt).toBeGreaterThanOrEqual(it.createdAt)
  })

  it('动一条不存在的备忘：不动、返回 false（不抛）', async () => {
    stubMiai()
    const s = useMemoStore()
    await settle()
    expect(s.setTitle('nope', 'x')).toBe(false)
    expect(s.setBody('nope', 'x')).toBe(false)
    expect(s.setKind('nope', 'code')).toBe(false)
    expect(s.remove('nope')).toBe(false)
  })
})

describe('64KB 上限（判据是**字节**）', () => {
  it('★ 3 万汉字（9 万字节）当场拒：返回 false、内容一个字不动、出声一句', async () => {
    stubMiai()
    const s = useMemoStore()
    await settle()
    const it = s.add('knowledge')

    expect(bodyTooLong('汉'.repeat(30000))).toBe(true)
    expect(s.setBody(it.id, '汉'.repeat(30000))).toBe(false)
    // 一个字都不许动：拒绝 ≠ 截断（截断是无声地改用户写的字）
    expect(s.itemOf(it.id)!.body).toBe('')
    expect(toasts.some((t) => t.text === MEMO.TOO_LONG)).toBe(true)
  })

  it('边界：恰好 64KB 可存，超 1 字节拒', async () => {
    stubMiai()
    const s = useMemoStore()
    await settle()
    const it = s.add('code')

    const exact = 'a'.repeat(MEMO_BODY_MAX)
    expect(bodyTooLong(exact)).toBe(false)
    expect(s.setBody(it.id, exact)).toBe(true)
    expect(s.itemOf(it.id)!.body).toBe(exact)

    expect(s.setBody(it.id, exact + 'a')).toBe(false)
    expect(s.itemOf(it.id)!.body).toBe(exact) // 还是上一次那份
  })
})

describe('删除', () => {
  it('删掉点名的这条，别人不动（返回真删掉了没有）', async () => {
    stubMiai()
    const s = useMemoStore()
    await settle()
    const a = s.add('code')
    const b = s.add('code')

    expect(s.remove(a.id)).toBe(true)
    expect(s.items.map((i) => i.id)).toEqual([b.id])
    expect(s.remove(a.id)).toBe(false)
  })
})

describe('落盘', () => {
  it('改动不是立刻写盘（防抖），到点自己写出去', async () => {
    const { saved } = stubMiai()
    const s = useMemoStore()
    await settle()

    const it = s.add('code')
    s.setBody(it.id, 'print(1)')
    // 防抖是真的：改完之后**这一刻**还没写（写了的话"防抖 300ms"就是句假话）
    expect(saved).toHaveLength(0)

    await new Promise((r) => setTimeout(r, SAVE_DEBOUNCE_MS + 150))
    expect(saved).toHaveLength(1)
    expect(saved[0].version).toBe(CURRENT_MEMO_VERSION)
    expect(saved[0].items[0]).toMatchObject({ id: it.id, body: 'print(1)' })
  })

  it('关窗口（beforeunload）时冲刷', async () => {
    const { saved, fire } = stubMiai()
    const s = useMemoStore()
    await settle()

    const it = s.add('code')
    s.setTitle(it.id, '走之前记一下')
    await settle()
    fire('beforeunload')
    // 冲刷只是把写排进写协议的串行链（P10.6）——让出一轮再断言
    await settle()

    expect(saved).toHaveLength(1)
    expect(saved[0].items[0].title).toBe('走之前记一下')
  })

  it('还没读完之前不保存（否则空表会盖掉磁盘上那份真备忘）', async () => {
    const { saved } = stubMiai({ hang: true })
    const s = useMemoStore()

    s.add('code')
    s.flush()

    expect(saved).toHaveLength(0)
    expect(s.loaded).toBe(false)
  })

  it('读回来的备忘会被用上（不是永远空表）', async () => {
    stubMiai({
      existing: {
        ...emptyFile(),
        items: [
          { id: 'm1', kind: 'knowledge', title: '旧笔记', body: 'x', createdAt: 1, updatedAt: 2 }
        ]
      }
    })
    const s = useMemoStore()
    await settle()

    expect(s.loaded).toBe(true)
    expect(s.itemOf('m1')!.title).toBe('旧笔记')
  })

  it('★ 存不上（主进程拒绝）时出声，不静默', async () => {
    const { saved } = stubMiai({ failSave: true })
    const s = useMemoStore()
    await settle()

    s.add('code')
    await settle()
    expect(() => s.flush()).not.toThrow()
    // 提示挂在 `.catch` 上（微任务）：不 yield 一次的话它还没跑，这条断言就会
    // 红在一句"提示没弹"上 —— 而那不是产品的错，是尺子没等
    await settle()

    expect(saved).toHaveLength(1) // 发出去了（记录在案），但被拒了
    expect(toasts.some((t) => t.text === TOAST.MEMO_SAVE_FAILED)).toBe(true)
  })

  /**
   * 树里混进克隆不了的东西时：**不许悄悄什么都不做**。
   *
   * 这一条钉的是写协议执行器的 try —— `toIpc` 是在 snapshot() 里同步抛的，
   * 被执行器接住转给 onError；掉在外面就是"未捕获异常 + 没保存 + 没提示"三连
   * （下面 push 一个函数进去，正是 structuredClone 明确拒绝的东西）。
   */
  it('数据里混进克隆不了的东西：不抛出来，但如实说「没存上」', async () => {
    const { saved } = stubMiai()
    const s = useMemoStore()
    await settle()
    const it = s.add('code')

    // 种坏值：函数过不了结构化克隆（等价于"某处把响应式代理塞回了原始数组"）
    s.file.items.push({
      id: 'bad',
      kind: 'code',
      title: 'bad',
      body: (() => {}) as unknown as string,
      createdAt: 1,
      updatedAt: 1
    })
    s.setTitle(it.id, 'x') // 让 watch 排一次落盘（排到的是同一个定时器）
    await settle()

    expect(() => s.flush()).not.toThrow()
    // snapshot 在串行链的微任务里跑（P10.6）——等它跑完再断言
    await settle()
    expect(saved).toHaveLength(0)
    expect(toasts.some((t) => t.text === TOAST.MEMO_SAVE_FAILED)).toBe(true)
  })

  it('写口带上读档给回的戳（P10.6 转发链的 store 端）', async () => {
    const { saveStamps } = stubMiai()
    const s = useMemoStore()
    await settle()

    s.add('code')
    await settle()
    s.flush()
    await settle()

    // 读口给的是 rev 0；第一次写真带上了它（转发链断在 store 这端的话，
    // 真机上第一次保存就会撞 STALE_REV）
    expect(saveStamps).toEqual([{ epoch: 0, rev: 0 }])
  })
})

describe('读档失败的说话方式（V1-53）', () => {
  it('读档失败要出声 —— 空档照跑，但必须弹 STORE_READ_FAILED', async () => {
    stubMiai({ readFails: true })
    const s = useMemoStore()
    await settle()

    // 降级姿态没变（空档、loaded 照置），变的是「不再装没事」
    expect(s.loaded).toBe(true)
    expect(s.items).toEqual([])
    expect(toasts.some((t) => t.text === TOAST.STORE_READ_FAILED)).toBe(true)
  })
})
