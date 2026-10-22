/**
 * 场景台词池的闸门（shared/pet-quips.ts）。
 *
 * 【这个文件在守什么】台词池是纯数据，坏了不崩、只会**悄悄变难听**，所以每条
 * 设计承诺都得有机器守着：
 *   · 条数下限（每场景 ≥8、总数 ≥80）与 QUIP_COUNT 一致 —— QUIP_COUNT 是拿去
 *     当验收数字用的，漂了没人看得出来；
 *   · meme 只许点名**真实存在**的表情包文件 —— 拼错一个，界面上是一张永远
 *     加载不出来的图，而透明窗里它和「桌宠没冒泡」长得一模一样；
 *   · pickQuip 的确定性（同 seed 同句）、recent 排除、挑不中即抛 ——
 *     静默回退第一条会把「池子数据坏了」藏成「台词老重复」，后者没人会去查。
 *
 * 【为什么测试里要读 node_modules 的表情包目录】meme 字段的判据是「逐字命中
 * 供体包里的真文件名」。抄一份清单进测试 = 第二份会漂的真源（上游改名，这条
 * 还全绿）；所以直接读目录。目录不在、一个 png 都没有 → **判红**：量不了就
 * 不许装绿（「默认回退为成功」是明令禁止的）。
 */
import { readdirSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { pickQuip, QUIP_COUNT, QUIP_POOL, type QuipScene } from '../pet-quips'

/** 十一个场景显式列（从类型推导的话，类型改错了这条闸门会跟着一起漂） */
const SCENES: readonly QuipScene[] = [
  'idle',
  'click',
  'drag',
  'coding',
  'chase',
  'plead',
  'lateNight',
  'menu',
  'startup',
  'affection',
  'followWish'
]

// __dirname = src/shared/__tests__ → 上三级 = 仓库根
const memesDir = join(__dirname, '..', '..', '..', 'node_modules', 'dsh-pet', 'assets', 'memes')

/** memes 目录里全部 png 的**文件名去掉扩展名** —— meme 字段的唯一合法取值域 */
function realMemeNames(): string[] {
  return readdirSync(memesDir)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .map((f) => f.slice(0, -4))
}

/** 汉字个数（标点、ASCII 不算） */
function hanCount(text: string): number {
  return (text.match(/[一-鿿]/g) ?? []).length
}

describe('台词池的形状与条数', () => {
  it('恰好十一个场景，每个 ≥8 条，总数 ≥80', () => {
    expect(Object.keys(QUIP_POOL).sort()).toEqual([...SCENES].sort())
    let total = 0
    for (const s of SCENES) {
      expect(QUIP_POOL[s].length, `场景 ${s} 的条数不足（话不够说就会开始重复）`).toBeGreaterThanOrEqual(8)
      total += QUIP_POOL[s].length
    }
    expect(total, '全池总条数不足').toBeGreaterThanOrEqual(80)
  })

  it('QUIP_COUNT 与实际条数一致（它是算出来的，不是手抄的）', () => {
    const counted = SCENES.reduce((n, s) => n + QUIP_POOL[s].length, 0)
    expect(QUIP_COUNT).toBe(counted)
  })

  it('每条台词非空、≤22 个汉字、全局不重复（复读机不许进池）', () => {
    // 尺子自证：22 与 23 个汉字要数得出差别（数不出 = 上限那条恒绿）
    expect(hanCount('喵'.repeat(22))).toBe(22)
    expect(hanCount('喵'.repeat(23))).toBe(23)
    const seen = new Map<string, string>()
    for (const s of SCENES) {
      for (const q of QUIP_POOL[s]) {
        expect(q.text.length, `${s}: 空台词`).toBeGreaterThan(0)
        expect(q.text, `${s}: 首尾有空白「${q.text}」`).toBe(q.text.trim())
        expect(hanCount(q.text), `${s}: 「${q.text}」超过 22 个汉字（气泡装不下）`).toBeLessThanOrEqual(22)
        expect(seen.has(q.text), `重复台词「${q.text}」（${seen.get(q.text)} 里已有一条）`).toBe(false)
        seen.set(q.text, s)
      }
    }
  })
})

describe('meme 字段只许用真实存在的表情包', () => {
  it('尺子自证：清单读得到，且假名字不在里面', () => {
    const names = realMemeNames()
    expect(names.length, 'memes 目录一个 png 都没有（清单是空的，这条量不到东西）').toBeGreaterThan(0)
    expect(names).not.toContain('__不存在的表情包__')
  })

  it('带 meme 的条目全部在真实清单内，且是去扩展名的纯文件名主干', () => {
    const names = new Set(realMemeNames())
    for (const s of SCENES) {
      for (const q of QUIP_POOL[s]) {
        if (q.meme === undefined) continue
        expect(names.has(q.meme), `${s}: meme「${q.meme}」不在 node_modules/dsh-pet/assets/memes 里`).toBe(true)
        // 消费方按 `<meme>.png` 找图：带扩展名/路径的值会拼成双份后缀
        expect(q.meme, `${s}: meme 必须是文件名主干（不带 .png、不带路径）`).not.toMatch(/[./\\]/)
      }
    }
  })

  it('带 meme 的条目约占一半（全带或全不带都是设计漂了）', () => {
    let withMeme = 0
    for (const s of SCENES) {
      for (const q of QUIP_POOL[s]) if (q.meme !== undefined) withMeme += 1
    }
    // 设计口径是「约一半」：给上下限各留出 1/4 的余量，防的是两个极端，
    // 不是精确比例（谁加一条台词都不该被这条拦住）
    expect(withMeme, `带 meme 只有 ${withMeme}/${QUIP_COUNT}（配图太少了）`).toBeGreaterThanOrEqual(QUIP_COUNT / 4)
    expect(withMeme, `带 meme 有 ${withMeme}/${QUIP_COUNT}（配图太多了，句句都贴图会腻）`).toBeLessThanOrEqual(
      (QUIP_COUNT * 3) / 4
    )
  })
})

describe('pickQuip：同 seed 同句（可复现的承诺）', () => {
  it('同 seed、同场景 → 逐字段相等，且挑出来的都在本场景池内', () => {
    for (const s of SCENES) {
      const texts = QUIP_POOL[s].map((q) => q.text)
      for (let seed = 1; seed <= 60; seed++) {
        const a = pickQuip(s, { seed })
        const b = pickQuip(s, { seed })
        expect(a, `${s} seed=${seed} 两次不同`).toEqual(b)
        expect(texts, `${s} seed=${seed} 挑出了池外台词`).toContain(a.text)
      }
    }
  })

  it('不带 seed 的调用不污染带 seed 的结果（自增刻度只走无 seed 那条路）', () => {
    const before = SCENES.map((s) => pickQuip(s, { seed: 42 }))
    for (let i = 0; i < 25; i++) {
      for (const s of SCENES) pickQuip(s)
    }
    SCENES.forEach((s, i) => {
      expect(pickQuip(s, { seed: 42 }), `${s}: 先乱调一通后 seed=42 的结果变了`).toEqual(before[i])
    })
  })

  it('不同 seed 出得来不同的话（每场景 ≥4 种）', () => {
    for (const s of SCENES) {
      const set = new Set<string>()
      for (let seed = 1; seed <= 80; seed++) set.add(pickQuip(s, { seed }).text)
      expect(set.size, `${s}: 80 个种子只出了 ${set.size} 种（挑词退化了）`).toBeGreaterThanOrEqual(4)
    }
  })

  it('场景盐生效：池子一样大的场景们不会齐刷刷挑中同一序号', () => {
    // 盐没了的话，同长度的场景用同一个 hash 取模 → 每个 seed 都取到同序号。
    // 从最大的同长度组里量（组员 ≥3 才量得到东西）。
    const byLen = new Map<number, QuipScene[]>()
    for (const s of SCENES) {
      const len = QUIP_POOL[s].length
      byLen.set(len, [...(byLen.get(len) ?? []), s])
    }
    const group = [...byLen.values()].sort((a, b) => b.length - a.length)[0]
    expect(group.length, '没有"同长度的场景组"，这条量不到东西（场景被删过了？）').toBeGreaterThanOrEqual(3)
    let allSame = 0
    for (let seed = 1; seed <= 60; seed++) {
      const picked = group.map((s) => {
        const text = pickQuip(s, { seed }).text
        return QUIP_POOL[s].findIndex((q) => q.text === text)
      })
      if (new Set(picked).size === 1) allSame += 1
    }
    expect(allSame, `${group.join('/')} 有 ${allSame}/60 个种子挑到同一序号（场景盐没生效？）`).toBeLessThanOrEqual(2)
  })

  it('带 meme 的条目被挑中时，meme 原样带出来（返回的是整条，不是只剩 text）', () => {
    for (const s of SCENES) {
      const withMeme = QUIP_POOL[s].filter((q) => q.meme !== undefined)
      expect(withMeme.length, `${s} 一条带 meme 的都没有`).toBeGreaterThan(0)
      let found = false
      for (let seed = 1; seed <= 200 && !found; seed++) {
        const r = pickQuip(s, { seed })
        const match = withMeme.find((q) => q.text === r.text)
        if (match) {
          expect(r.meme).toBe(match.meme)
          found = true
        }
      }
      expect(found, `200 个种子里没挑中 ${s} 的「${withMeme[0].text}」`).toBe(true)
    }
  })
})

describe('pickQuip：recent 排除与硬断言', () => {
  it('recent 里的不选；连说三句不撞车', () => {
    for (const s of SCENES) {
      for (let seed = 1; seed <= 30; seed++) {
        const r1 = pickQuip(s, { seed })
        const r2 = pickQuip(s, { seed, recent: [r1.text] })
        expect(r2.text, `${s} seed=${seed}：recent 里的「${r1.text}」又被挑回来了`).not.toBe(r1.text)
        const r3 = pickQuip(s, { seed, recent: [r1.text, r2.text] })
        expect(r3.text, `${s} seed=${seed}：第三句撞了前两句`).not.toBe(r1.text)
        expect(r3.text, `${s} seed=${seed}：第三句撞了前两句`).not.toBe(r2.text)
      }
    }
  })

  it('只剩一条没说过时，就只出这一条（排除的边界）', () => {
    for (const s of SCENES) {
      const all = QUIP_POOL[s].map((q) => q.text)
      const recent = all.slice(1) // 把除第一条以外的全部说光
      expect(pickQuip(s, { seed: 123, recent }).text).toBe(all[0])
    }
  })

  it('整个场景全在 recent 里 → 忽略 recent 兜底：不死循环、不抛、仍在池内', () => {
    for (const s of SCENES) {
      const all = QUIP_POOL[s].map((q) => q.text)
      const r = pickQuip(s, { seed: 7, recent: all })
      expect(r.text.length).toBeGreaterThan(0)
      expect(all).toContain(r.text)
    }
  })

  it('挑不出来就抛错，绝不静默回退：未知场景 / 非有限 seed', () => {
    const unknownScene: string = 'nope'
    expect(() => pickQuip(unknownScene as QuipScene)).toThrow()
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => pickQuip('idle', { seed: bad }), `seed=${String(bad)} 没抛错`).toThrow()
    }
  })

  it('返回的是副本：改返回值污染不到池子', () => {
    const a = pickQuip('click', { seed: 3 })
    const text = a.text
    a.text = '污染'
    a.meme = '污染'
    const b = pickQuip('click', { seed: 3 })
    expect(b.text).toBe(text)
    expect(b.meme).not.toBe('污染')
  })
})
