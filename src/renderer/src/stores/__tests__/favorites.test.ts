/**
 * 收藏（题目级）的落盘与动作（stores/favorites.ts）
 *
 * 【这个文件在守什么】
 * 守两条用户会**立刻发现**、而我们看不见的事：
 *
 *   ① **收了一道 AI 题，重启之后它还在。** AI 题不在任何一课里，光有 key
 *      找不回题干 —— 主进程读口把"缺本体的 AI 条目"当坏条目丢掉
 *      （`favorites-merge.ts` 的 cleanItem）。所以本体必须随条目一起存，
 *      而且存进去的**必须是普通对象**：`q` 是从 store 上读出来的响应式代理，
 *      直接塞进 IPC 会在结构化克隆那儿当场抛（这个坑项目里踩过四次）。
 *   ② **删掉一个文件夹，里面的收藏不能跟着没。** 文件夹是分类不是容器。
 *
 * 【为什么假 window 故意用 structuredClone 收件】
 * 和 progress.test.ts 同一条理由：真实的 `ipcRenderer.invoke` 用的就是这个算法。
 * 用同一个算法做假货，"入参里混进了响应式代理"才会**在测试里当场炸**，
 * 而不是等用户重启之后发现收藏少了一条。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { SAVE_DEBOUNCE_MS, useFavoritesStore } from '../favorites'
import { toasts } from '../../components/base/toast'
import { TOAST } from '../../lib/copy'
import {
  CURRENT_FAVORITES_VERSION,
  type FavoriteItem,
  type FavoritesFile,
  type Question
} from '../../../../shared/types'
import type { BoxStamp, DocWriteResult, StampedDoc } from '../../../../shared/doc-write'

function emptyFile(): FavoritesFile {
  // 版本号走共享常量，不写死数字（同 progress.test.ts 的规矩）
  return { version: CURRENT_FAVORITES_VERSION, folders: [], items: [] }
}

function item(key: string, extra: Partial<FavoriteItem> = {}): FavoriteItem {
  const [lessonId, qid] = key.split(':')
  return { key, lessonId, qid, addedAt: '2026-09-29T00:00:00.000Z', ...extra }
}

function choice(id: string): Question {
  return { id, type: 'choice', stem: '题干', options: ['甲', '乙'], answer: 0, explanation: '解析' }
}

interface StubOpts {
  /** 读档返回什么（不传 = 首次运行，收藏夹是空的） */
  existing?: FavoritesFile
  /** 读档挂住不返回 —— 模拟「还没读完」 */
  hang?: boolean
  /** 读档直接拒绝 —— 测 V1-53「读档失败要出声」 */
  readFails?: boolean
}

/**
 * 装上假的 window.miai（照 progress.test.ts 那份）。
 * ⚠️ 除了 `miai` 还得给 `addEventListener`：store 在 setup 里就会
 * `window.addEventListener('beforeunload', flush)`，不给的话 store 根本建不起来。
 *
 * 【P10.6：读写口是带戳信封】`getFavorites` 回 `{data, stamp}`、`saveFavorites`
 * 收戳回 `DocWriteResult`（形状照 shared/doc-write.ts）。戳 = 单调 rev
 * （写成功 +1，照主进程 BoxedStore 的语义）。
 */
function stubMiai(opts: StubOpts = {}) {
  const saved: FavoritesFile[] = []
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
      getFavorites: (): Promise<StampedDoc<FavoritesFile>> => {
        if (opts.readFails) return Promise.reject(new Error('stub: favorites read failed'))
        return opts.hang
          ? new Promise<StampedDoc<FavoritesFile>>(() => {})
          : Promise.resolve({
              data: opts.existing ? structuredClone(opts.existing) : emptyFile(),
              stamp: stampNow()
            })
      },
      saveFavorites: (
        f: FavoritesFile,
        stamp?: BoxStamp | null
      ): Promise<DocWriteResult<FavoritesFile>> => {
        saveStamps.push(stamp)
        // 这一行是重点：真实 ipcRenderer.invoke 就是这么收件的。
        // 入参里混进响应式代理 → 这里会像真实环境一样抛 DataCloneError
        saved.push(structuredClone(f))
        rev += 1
        return Promise.resolve({ ok: true, stamp: stampNow() })
      }
    }
  }

  return {
    saved,
    saveStamps,
    fire: (type: string) => listeners[type]?.forEach((f) => f())
  }
}

/** 让出一轮，把 watch（默认异步）排上的定时器真的排上（理由见 progress.test.ts） */
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  setActivePinia(createPinia())
  toasts.splice(0, toasts.length)
})

/**
 * 每个测试收尾：先把 watcher 排上的定时器等出来，再冲掉。
 *
 * 【不这么做会怎样 —— 实测过】`watch` 是异步的，`clearTimeout` 只认已经排上的
 * 那个定时器。测试里改完数据就走人，定时器会活到**下一个测试**里触发：
 * 那时全局 `window` 已经换成下一个测试的假货，于是它把上一个测试的数据写进
 * 下一个测试的 `saved` 里 —— "防抖只存一次"那条断言数出来 **14 次**，
 * 而多出来的 13 次全是别的测试的幽灵（progress.test.ts 抬头记过同一件事）。
 *
 * 收尾放在 afterEach 而不是每个测试自己写：漏写一个测试不会报错，
 * 只会让**别人的**断言莫名其妙地红。
 */
afterEach(async () => {
  await settle()
  useFavoritesStore().flush()
})

describe('收藏一道题', () => {
  it('新收的条目：key 拆出课号题号、带上来源与收藏时间', async () => {
    stubMiai()
    const f = useFavoritesStore()
    await settle()

    expect(f.toggle('python-03:q1', choice('q1'), 'lesson')).toBe(true)
    const it = f.itemOf('python-03:q1')!
    expect(it.lessonId).toBe('python-03')
    expect(it.qid).toBe('q1')
    expect(it.source).toBe('lesson')
    // addedAt 必须是**能落盘的 ISO 串**：日期显示和排序都读它
    expect(Number.isNaN(Date.parse(it.addedAt))).toBe(false)
    expect(f.isFav('python-03:q1')).toBe(true)
  })

  it('再点一次就是取消，条目整个拿掉', async () => {
    stubMiai()
    const f = useFavoritesStore()
    await settle()

    f.toggle('python-03:q1', choice('q1'), 'lesson')
    expect(f.toggle('python-03:q1', choice('q1'), 'lesson')).toBe(false)
    expect(f.items).toHaveLength(0)
    expect(f.isFav('python-03:q1')).toBe(false)
  })

  it('AI 题带本体存下来，且是**普通对象**（不是响应式代理）', async () => {
    const { saved } = stubMiai()
    const f = useFavoritesStore()
    await settle()

    const q = choice('ai-2026-09-29-1')
    expect(f.toggle('python-03:ai-2026-09-29-1', q, 'challenge')).toBe(true)
    const it = f.itemOf('python-03:ai-2026-09-29-1')!
    expect(it.ai).toEqual(q)
    // 不是同一个对象引用（存的是快照，不是把外面那份挂上去）——
    // 同一个引用的话，调用方之后再改 q 会把这个条目也改了
    expect(it.ai).not.toBe(q)

    await settle()
    f.flush()
    // 冲刷只是把写排进写协议的串行链（P10.6）——让出一轮再断言
    await settle()
    // 真落盘那一步再验一次：缺本体 / 带代理，主进程那边都是收不了或者丢条目的
    expect(saved).toHaveLength(1)
    expect(saved[0].items[0].ai).toEqual(q)
  })

  it('AI 题拿不到本体：**拒绝收藏**并出声，不写半成品', async () => {
    const { saved } = stubMiai()
    const f = useFavoritesStore()
    await settle()

    expect(f.toggle('python-03:ai-2026-09-29-1', null, 'challenge')).toBe(false)
    expect(f.items).toHaveLength(0)
    // 出声这一条不能省：主进程写口对缺本体的 AI 条目是**抛错**的（整个文件都写不成），
    // 静悄悄放过去的话，用户只看到"我点了收藏，星星没亮"，没有任何解释
    expect(toasts.some((t) => t.text === TOAST.QUESTION_FAV_NO_BODY)).toBe(true)

    /*
     * 等过一整个防抖窗口，看**落过盘的东西里有没有半成品**。
     *
     * 判据故意不数 `saved` 的次数（P10.6 起读档也不再回写：账本空 = no-op）——
     * 钉的是"拒绝的这条 AI 题一次都没有出现在**任何一次**落盘里"，
     * 将来多一条写盘通道（同步引擎）这条判据照样管得住。
     */
    await new Promise((r) => setTimeout(r, SAVE_DEBOUNCE_MS + 150))
    expect(saved.flatMap((f) => f.items)).toEqual([])
  })

  it('内置题**不存本体**（内容包里就有，存了就是第二份真源）', async () => {
    stubMiai()
    const f = useFavoritesStore()
    await settle()

    f.toggle('python-03:q1', choice('q1'), 'lesson')
    expect(f.itemOf('python-03:q1')!.ai).toBeUndefined()
  })
})

describe('笔记', () => {
  it('写得进、读得到；整条全是空白按「没有笔记」算', async () => {
    stubMiai()
    const f = useFavoritesStore()
    await settle()
    f.toggle('python-03:q1', choice('q1'), 'lesson')

    expect(f.setNote('python-03:q1', '  这个坑我栽过  ')).toBe(true)
    // **不 trim**：笔记是写给人看的话，首尾空格是内容的一部分
    expect(f.itemOf('python-03:q1')!.note).toBe('  这个坑我栽过  ')

    f.setNote('python-03:q1', '   \n  ')
    // 清空之后字段要**整个消失**，不是留一个空串 ——
    // 留着的话界面上会显示成一个"有笔记"的框，点开是空的
    expect('note' in f.itemOf('python-03:q1')!).toBe(false)
  })

  it('给一条不存在的收藏写笔记：不动、返回 false', async () => {
    stubMiai()
    const f = useFavoritesStore()
    await settle()
    expect(f.setNote('nope:q1', 'x')).toBe(false)
  })
})

describe('文件夹', () => {
  it('新建：名字两头空白会去掉；空名字直接不受理', async () => {
    stubMiai()
    const f = useFavoritesStore()
    await settle()

    expect(f.createFolder('   ')).toBeNull()
    const folder = f.createFolder('  易错  ')!
    expect(folder.name).toBe('易错')
    expect(f.folders).toHaveLength(1)
  })

  it('同一毫秒连建两个，id 不能撞（撞了主进程会把后一个当重复项丢掉）', async () => {
    stubMiai()
    const f = useFavoritesStore()
    await settle()
    const a = f.createFolder('甲')!
    const b = f.createFolder('乙')!
    expect(a.id).not.toBe(b.id)
    expect(f.folders).toHaveLength(2)
  })

  it('改名：空名字不受理', async () => {
    stubMiai()
    const f = useFavoritesStore()
    await settle()
    const folder = f.createFolder('甲')!

    expect(f.renameFolder(folder.id, '  ')).toBe(false)
    expect(f.folderOf(folder.id)!.name).toBe('甲')
    expect(f.renameFolder(folder.id, '乙')).toBe(true)
    expect(f.folderOf(folder.id)!.name).toBe('乙')
  })

  it('挪进文件夹、再挪回未分组', async () => {
    stubMiai()
    const f = useFavoritesStore()
    await settle()
    f.toggle('python-03:q1', choice('q1'), 'lesson')
    const folder = f.createFolder('甲')!

    expect(f.moveTo(['python-03:q1'], folder.id)).toBe(1)
    expect(f.itemOf('python-03:q1')!.folderId).toBe(folder.id)
    expect(f.moveTo(['python-03:q1'], null)).toBe(1)
    expect('folderId' in f.itemOf('python-03:q1')!).toBe(false)
  })

  it('挪进一个不存在的文件夹：不动、返回 0（否则主进程会静默摘掉它）', async () => {
    stubMiai()
    const f = useFavoritesStore()
    await settle()
    f.toggle('python-03:q1', choice('q1'), 'lesson')

    expect(f.moveTo(['python-03:q1'], 'folder-nope')).toBe(0)
    expect('folderId' in f.itemOf('python-03:q1')!).toBe(false)
  })

  it('删文件夹：**条目一条都不删**，回「未分组」，并报出挪了几条', async () => {
    const { saved } = stubMiai()
    const f = useFavoritesStore()
    await settle()
    f.toggle('python-03:q1', choice('q1'), 'lesson')
    f.toggle('python-03:q2', choice('q2'), 'lesson')
    const folder = f.createFolder('甲')!
    f.moveTo(['python-03:q1', 'python-03:q2'], folder.id)

    expect(f.deleteFolder(folder.id)).toBe(2)
    expect(f.folders).toHaveLength(0)
    // 收藏是用户攒出来的东西，删分类不该动它
    expect(f.items).toHaveLength(2)
    expect(f.items.every((i) => i.folderId === undefined)).toBe(true)

    await settle()
    f.flush()
    await settle()
    expect(saved[0].items).toHaveLength(2)
  })
})

describe('批量取消收藏', () => {
  it('拿走点名的那些，返回条数；没点名的不动', async () => {
    stubMiai()
    const f = useFavoritesStore()
    await settle()
    f.toggle('python-03:q1', choice('q1'), 'lesson')
    f.toggle('python-03:q2', choice('q2'), 'lesson')

    expect(f.removeMany(['python-03:q1', 'not-there'])).toBe(1)
    expect(f.items.map((i) => i.key)).toEqual(['python-03:q2'])
    expect(toasts.some((t) => t.text === TOAST.favoriteRemoved(1))).toBe(true)
  })

  /**
   * 【这条是为一个真出现过的 bug 钉的】
   * 原来这里写的是 `items = items.filter(...)`。`filter` 是**透过响应式代理**
   * 读元素的，它把代理装进新数组、再赋值回 `file.value.items` —— 原始数组里
   * 从此躺着代理，紧接着的那次落盘 `structuredClone` 当场抛 DataCloneError，
   * 而且抛在定时器里无人接住：批量取消看着成功了，硬盘上那份一个字没改，
   * 重启之后收藏全回来了。
   *
   * 所以这条**不能只看"没抛错"** —— 修好之后 `flush` 会把 toIpc 的抛接住
   * 并弹一句提示（那样也不抛，但没存上）。要钉的是"真的写出去了"。
   */
  it('批量取消之后，剩下的那份真的写得进盘，且不是写失败', async () => {
    const { saved } = stubMiai()
    const f = useFavoritesStore()
    await settle()
    f.toggle('python-03:q1', choice('q1'), 'lesson')
    f.toggle('python-03:q2', choice('q2'), 'lesson')

    f.removeMany(['python-03:q1'])
    await settle()
    f.flush()
    await settle()

    expect(saved).toHaveLength(1)
    expect(saved[0].items.map((i) => i.key)).toEqual(['python-03:q2'])
    expect(toasts.some((t) => t.text === TOAST.FAVORITES_SAVE_FAILED)).toBe(false)
  })
})

describe('落盘', () => {
  it('防抖到点自己写出去（不手动冲刷）', async () => {
    const { saved } = stubMiai()
    const f = useFavoritesStore()
    await settle()

    f.toggle('python-03:q1', choice('q1'), 'lesson')
    await new Promise((r) => setTimeout(r, SAVE_DEBOUNCE_MS + 150))

    expect(saved).toHaveLength(1)
    expect(saved[0].items.map((i) => i.key)).toEqual(['python-03:q1'])
    expect(saved[0].version).toBe(CURRENT_FAVORITES_VERSION)
  })

  it('关窗口（beforeunload）时冲刷', async () => {
    const { saved, fire } = stubMiai()
    const f = useFavoritesStore()
    await settle()

    f.toggle('python-03:q1', choice('q1'), 'lesson')
    await settle()
    fire('beforeunload')
    await settle()

    expect(saved).toHaveLength(1)
    expect(saved[0].items).toHaveLength(1)
  })

  it('还没读完之前不保存（否则空夹会盖掉真收藏）', async () => {
    const { saved } = stubMiai({ hang: true })
    const f = useFavoritesStore()

    f.toggle('python-03:q1', choice('q1'), 'lesson')
    f.flush()

    expect(saved).toHaveLength(0)
    expect(f.loaded).toBe(false)
  })

  /**
   * 树里混进克隆不了的东西时：**不许悄悄什么都不做**。
   *
   * 这一条钉的是写协议执行器的那段 try —— `toIpc` 是在 snapshot() 里同步抛的，
   * 被执行器接住转给 onError；掉在外面就是"未捕获异常 + 没保存 + 没提示"三连
   * （下面 push 一个函数进去，正是 structuredClone 明确拒绝的东西）。
   * 真实世界里这条路上最贵的不是异常本身，是**没有提示**：用户以为存上了。
   */
  it('数据里混进克隆不了的东西：不抛出来，但如实说「没存上」', async () => {
    const { saved } = stubMiai()
    const f = useFavoritesStore()
    await settle()
    f.toggle('python-03:q1', choice('q1'), 'lesson')

    // 种坏值：函数过不了结构化克隆（等价于"某处把代理塞回了原始数组"）
    f.file.items.push({ key: 'bad:q9', lessonId: 'bad', qid: 'q9', addedAt: '2026-09-29T00:00:00.000Z', note: (() => {}) as unknown as string })
    await settle()

    expect(() => f.flush()).not.toThrow()
    // snapshot 在串行链的微任务里跑（P10.6）——等它跑完再断言
    await settle()
    expect(saved).toHaveLength(0)
    expect(toasts.some((t) => t.text === TOAST.FAVORITES_SAVE_FAILED)).toBe(true)
  })

  it('读回来的收藏会被用上（不是永远空夹）', async () => {
    stubMiai({ existing: { ...emptyFile(), items: [item('python-03:q1', { source: 'lesson' })] } })
    const f = useFavoritesStore()
    await settle()

    expect(f.loaded).toBe(true)
    expect(f.isFav('python-03:q1')).toBe(true)
    expect(f.itemOf('python-03:q1')!.source).toBe('lesson')
  })

  it('V1-53：读档失败要出声 —— 空夹照跑，但必须弹 STORE_READ_FAILED', async () => {
    stubMiai({ readFails: true })
    const f = useFavoritesStore()
    await settle()

    // 降级姿态没变（空夹、loaded 照置），变的是「不再装没事」
    expect(f.loaded).toBe(true)
    expect(f.items).toEqual([])
    expect(toasts.some((t) => t.text === TOAST.STORE_READ_FAILED)).toBe(true)
  })
})
