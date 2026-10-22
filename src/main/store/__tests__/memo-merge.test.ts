/**
 * memo.json 的清洗与校形（src/main/store/memo-merge.ts）
 *
 * 【这个文件在守什么】
 * 备忘录是**用户自己敲下来的字** —— 它坏掉的方式全都不出声：
 *
 *   1. **写口悄悄丢条目**。界面上显示得好好的，重启之后那一条没了 ——
 *      用户自己也复述不出原本写了什么（收藏丢了还能再点一次，笔记不能）。
 *      所以写口的规矩和读口相反：坏东西**抛**，不丢，且一个字节都不落盘。
 *   2. **64KB 的上限量错单位**。用字符数当判据的话，一篇汉字笔记在界面上
 *      显示"30 KB"、写口却按 90 KB 把它拒了 —— 所以判据必须是 UTF-8 字节，
 *      这个文件用两种文字把它钉住。
 *   3. **时间戳坏一条就丢整条**。时间只影响排序，为它丢掉用户敲的整段正文，
 *      代价完全不成比例（读口该救的得救）。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫 —— 不过测试目录（`__tests__`）不在扫描
 * 面上；即便如此，字符串也一律英文（与同目录其余测试一致）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { cleanMemo, sanitizeMemo } from '../memo-merge'
import { createJsonStore } from '../json-store'
import { CURRENT_MEMO_VERSION, MEMO_BODY_MAX, type MemoFile, type MemoItem } from '../../../shared/types'

/** 一份备忘文件（版本默认当前，方便只关心 items 的用例） */
function memo(items: unknown[], version: unknown = CURRENT_MEMO_VERSION) {
  return { version, items }
}

/** 一条合法备忘（要种坏哪个字段就把它盖掉） */
function item(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    kind: 'code',
    title: 'note',
    body: 'print(1)',
    createdAt: 1000,
    updatedAt: 2000,
    ...extra
  }
}

/** 一份**合法形状**的 MemoFile（给真写盘那几条用；item() 的 kind 是宽 string，这里收窄一次） */
function fileOf(items: unknown[]): MemoFile {
  return { version: CURRENT_MEMO_VERSION, items: items as MemoItem[] }
}

/** 跑一段会对坏文件出声的代码，把 warn 收走（大多数用例不关心出声与否） */
function silent<T>(fn: () => T): T {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    return fn()
  } finally {
    warn.mockRestore()
  }
}

// ---------------------------------------------------------------- 读口

describe('cleanMemo（读口）', () => {
  it('文件不存在（null / undefined）→ 空信封，但**不标重写**', () => {
    for (const raw of [null, undefined]) {
      expect(cleanMemo(raw)).toEqual({
        file: { version: CURRENT_MEMO_VERSION, items: [] },
        needsRewrite: false
      })
    }
  })

  it('★ 信封、版本正确、条目干净 → needsRewrite **false**（别每次启动重写文件）', () => {
    expect(cleanMemo(memo([item('m1')])).needsRewrite).toBe(false)
  })

  it('整份坏掉（字符串 / 数字 / {} / 数组 / items 不是数组）→ 空信封 + 重写 + **每次都出声**', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (const raw of ['nope', 42, {}, [], { items: 'x' }, { items: null }]) {
        const { file, needsRewrite } = cleanMemo(raw)
        expect(file, String(raw)).toEqual({ version: CURRENT_MEMO_VERSION, items: [] })
        expect(needsRewrite).toBe(true)
      }
      expect(warn).toHaveBeenCalledTimes(6)
    } finally {
      warn.mockRestore()
    }
  })

  it('版本不认识（99 / 没写）→ 内容照读，标重写', () => {
    const { file, needsRewrite } = cleanMemo(memo([item('m1')], 99))
    expect(file.items).toHaveLength(1)
    expect(needsRewrite).toBe(true)
  })

  it('★ 坏条目：id 空 / id 重复 / kind 不认识 / body 非串 → 丢，汇总出声，标重写', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { file, needsRewrite } = cleanMemo(
        memo([
          item('m1'),
          item(''), // id 空
          item('m2', { kind: 'snippet' }), // kind 不认识
          item('m3', { body: 42 }), // body 非串
          null, // 根本不是对象
          item('m1', { title: 'dup' }) // id 重复 → 后一条丢
        ])
      )
      expect(file.items.map((i) => i.id)).toEqual(['m1'])
      expect(file.items[0].title).toBe('note')
      // 一次汇总 warn（五条坏的一起数），不是每条一声 —— 同 favorites 的账
      expect(warn).toHaveBeenCalledTimes(1)
      expect(needsRewrite).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  it('★ 标题坏了**不丢条**：退回空串（标题只是列表索引，正文才是内容）', () => {
    const { file } = silent(() => cleanMemo(memo([item('m1', { title: 42 }), item('m2', { title: '' })])))
    expect(file.items).toHaveLength(2)
    expect(file.items[0].title).toBe('')
    expect(file.items[1].title).toBe('')
  })

  it('时间戳坏了 → 兜底（0 / 跟随 createdAt），负数与 NaN 也算坏', () => {
    const { file } = silent(() =>
      cleanMemo(
        memo([
          item('m1', { createdAt: 'yesterday', updatedAt: null }),
          item('m2', { createdAt: -5 }),
          item('m3', { createdAt: 1000.6, updatedAt: 2000.4 })
        ])
      )
    )
    // createdAt 丢了 → 按「最古老」算，updatedAt 跟着它（不假装知道更新过）
    expect(file.items[0].createdAt).toBe(0)
    expect(file.items[0].updatedAt).toBe(0)
    expect(file.items[1].createdAt).toBe(0)
    // 合法的取整（浮点时间戳不该原样落回磁盘）
    expect(file.items[2].createdAt).toBe(1001)
    expect(file.items[2].updatedAt).toBe(2000)
  })

  it('★ 64KB 判据量的是**字节**：3 万汉字（9 万字节）→ 丢，而不是按 3 万"字"放过', () => {
    // 这一条就是"界面说没超、就是不让我存"那个 bug 的反面：
    // '汉'.repeat(30000).length === 30000 < 65536，但它落盘要 90000 字节
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { file } = cleanMemo(memo([item('m1', { body: '汉'.repeat(30000) })]))
      expect(file.items).toHaveLength(0)
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('上限的边界：恰好 64KB 留，超 1 字节丢', () => {
    const exact = silent(() => cleanMemo(memo([item('m1', { body: 'a'.repeat(MEMO_BODY_MAX) })])))
    expect(exact.file.items).toHaveLength(1)

    const over = silent(() => cleanMemo(memo([item('m1', { body: 'a'.repeat(MEMO_BODY_MAX + 1) })])))
    expect(over.file.items).toHaveLength(0)
  })
})

// ---------------------------------------------------------------- 写口

describe('sanitizeMemo（写口）：坏东西**抛**，不悄悄丢', () => {
  it('合法整份 → 清洗后原样返回，版本补成当前值', () => {
    const out = sanitizeMemo(memo([item('m1', { title: '陷阱', body: 'x = []' })], 99))
    expect(out.version).toBe(CURRENT_MEMO_VERSION)
    expect(out.items).toHaveLength(1)
    expect(out.items[0]).toMatchObject({
      id: 'm1',
      kind: 'code',
      title: '陷阱',
      body: 'x = []',
      createdAt: 1000,
      updatedAt: 2000
    })
  })

  it('★ 坏条目一律抛（悄悄丢的后果：界面显示有、重启之后没了）', () => {
    expect(() => sanitizeMemo(memo([item('')]))).toThrow()
    expect(() => sanitizeMemo(memo([item('m1', { kind: 'nope' })]))).toThrow()
    expect(() => sanitizeMemo(memo([item('m1', { body: 42 })]))).toThrow()
    expect(() => sanitizeMemo(memo([item('m1'), item('m1')]))).toThrow()
    expect(() => sanitizeMemo(memo([null]))).toThrow()
  })

  it('★ 超长正文抛（最后一道防线：渲染层的输入拦截被绕过时，坏东西不许落盘）', () => {
    expect(() => sanitizeMemo(memo([item('m1', { body: 'a'.repeat(MEMO_BODY_MAX + 1) })]))).toThrow()
  })

  it('整份坏 → 抛', () => {
    expect(() => sanitizeMemo(null)).toThrow()
    expect(() => sanitizeMemo('nope')).toThrow()
    expect(() => sanitizeMemo({ version: 1 })).toThrow()
    expect(() => sanitizeMemo({ version: 1, items: 'x' })).toThrow()
  })

  it('读口与写口对同一条坏条目的态度相反：读口丢（出声），写口抛', () => {
    // 这条钉的是「两个口共用 cleanItem、但遇到坏东西的处置相反」这个设计。
    // 若哪天写口改成"顺手丢"，这条会红
    const bad = memo([item('m1', { body: 42 })])
    const read = silent(() => cleanMemo(bad))
    expect(read.file.items).toHaveLength(0)
    expect(() => sanitizeMemo(bad)).toThrow()
  })
})

// ---------------------------------------------------------------- 真文件（零字节写入）

describe('落盘（真的写到临时目录，看字节）', () => {
  it('★ 写口拒绝时**一个字节都没落盘**（内容与 mtime 都不动，也不留 .tmp）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'miai-memo-'))
    try {
      const store = createJsonStore<MemoFile>(dir, 'memo.json')
      const file = join(dir, 'memo.json')
      const tmp = file + '.tmp'

      store.write(fileOf([item('m1')]))
      const before = readFileSync(file, 'utf8')
      const mtimeBefore = statSync(file).mtimeMs

      // 坏形状（id 重复）：渲染层真把这种东西交上来，主进程 handler 那一行的
      // `memoStore.write(sanitizeMemo(file))` 会在**求值实参时**就抛，
      // write 根本不会被调用 —— 下面三条就是在验这件事
      const bad = memo([item('m1'), item('m1')])
      expect(() => store.write(sanitizeMemo(bad))).toThrow()

      expect(readFileSync(file, 'utf8')).toBe(before)
      expect(statSync(file).mtimeMs).toBe(mtimeBefore)
      expect(existsSync(tmp)).toBe(false)

      // 拒了一次之后，正常的写入照常能用（存储没被搞坏）
      store.write(fileOf([item('m1'), item('m2')]))
      expect(JSON.parse(readFileSync(file, 'utf8')).items).toHaveLength(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('尺子自检：**幂等重写**只有 mtime 看得见（内容比对对此是瞎的）', () => {
    // 上一条断言"没写盘"靠的是 mtime。先证明这把尺子能看见一次内容相同的重写 ——
    // 否则它就是一把永远显示"没动过"的假尺子（内容和哈希都恒等）
    const dir = mkdtempSync(join(tmpdir(), 'miai-memo-'))
    try {
      const store = createJsonStore<MemoFile>(dir, 'memo.json')
      const file = join(dir, 'memo.json')
      const data = fileOf([item('m1')])

      store.write(data)
      const mtime1 = statSync(file).mtimeMs
      const bytes1 = readFileSync(file, 'utf8')

      store.write(data) // 一模一样地再写一次
      expect(readFileSync(file, 'utf8')).toBe(bytes1) // 内容/哈希这条通道：看不见
      expect(statSync(file).mtimeMs).not.toBe(mtime1) // mtime 这条通道：看见了
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('手改坏 memo.json（裸数组 / 条目坏）→ 读口丢条 + 出声 + 不崩，标重写', () => {
    const dir = mkdtempSync(join(tmpdir(), 'miai-memo-'))
    try {
      const store = createJsonStore<MemoFile>(dir, 'memo.json')
      const file = join(dir, 'memo.json')
      // 手改：绕过 store 直接写盘（这才是"用户/别的程序把它改坏了"的真实形状）
      writeFileSync(file, JSON.stringify({ version: 1, items: [item('m1'), { id: 'm2', kind: 'x', body: 'y' }, 'nope'] }), 'utf8')

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const { file: clean, needsRewrite } = cleanMemo(store.read())
        expect(clean.items.map((i) => i.id)).toEqual(['m1'])
        expect(needsRewrite).toBe(true)
        expect(warn).toHaveBeenCalledTimes(1)
      } finally {
        warn.mockRestore()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
