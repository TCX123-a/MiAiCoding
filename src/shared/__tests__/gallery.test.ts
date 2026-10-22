/**
 * 奖励图库的身份表（shared/gallery.ts）
 *
 * 【这个文件在守什么】
 * 图库是**发奖时唯一不能出错的地方**：发出去的 id 会被写进用户的档案，
 * 从此跟着他走。写错一个 id，用户会得到一张**永远打不开的图**，而且
 * 因为 id 已经落盘，"修好"要等到他再全对一次 —— 比崩掉还难发现。
 *
 *   · 抽奖范围必须逐张对得上 `GALLERY_IDS`（多一张 = 抽到不存在的图）
 *   · 全得到时必须返回 null（不能死循环、不能返回空串）
 *   · 陌生 id（主人删过图之后老档案里的残留）**不占名额**
 *   · rng 越界（返回 1）不许返回 undefined
 *
 * 与渲染层那条 `lib/__tests__/gallery.test.ts` 的分工：那条盯
 * 「表 ↔ 磁盘上的 png」一一对应（文件在渲染层，shared 看不见）；
 * 这条盯**抽样逻辑本身**。
 */

import { describe, expect, it } from 'vitest'
import { GALLERY_IDS, galleryRemaining, grantReward, isGalleryId, pickRewardId } from '../gallery'
import type { ProfileRewards } from '../types'

/**
 * 表外末位 id：**现算而不是写死 'g99'** —— 2026-10-17 图库扩到 g200 后，
 * 写死的 g99 进册了，「陌生 id」的用例全在拿真 id 测（假绿）。maxN + 1 永远在表外。
 */
const maxN = Math.max(...GALLERY_IDS.map((x) => Number(x.replace(/^g/, ''))).filter(Number.isFinite))
const OFF_TABLE = `g${maxN + 1}`

describe('GALLERY_IDS：身份表', () => {
  it('至少 50 张（第 1 批 12 + 2026-10-09 扩容 38 是拍板底数），且两两不重', () => {
    // 【为什么是"至少"而不是"恰好 50"（2026-10-16，随加图机制改）】
    // 主人裁定"奖励图多加图"之后，**扩池是被祝福的操作**
    //（入口：scripts/add-gallery-image.mjs）。写死 50 的那版会在接入
    // 第 51 张时把测试弄红 —— 加图的人分不清是自己加错了、还是这套测试
    // 本来就拦着加图（演练实测：确实红了）。
    // 但**缩水必须红**：id 一旦发出去就跟用户一辈子，往下删任何一个
    // 都是丢档案语义（真删图走主人挑图流程，不是这里）。两两不重照旧。
    expect(GALLERY_IDS.length).toBeGreaterThanOrEqual(50)
    expect(new Set(GALLERY_IDS).size).toBe(GALLERY_IDS.length)
  })

  it('id 是纯 ASCII —— 它要落盘进 JSON、要当文件名前缀，别塞中文', () => {
    for (const id of GALLERY_IDS) expect(id).toMatch(/^[a-z0-9]+$/)
  })

  it('isGalleryId：认识的只有表里那些', () => {
    expect(isGalleryId(GALLERY_IDS[0])).toBe(true)
    // 末位编号**现算**，别写死 g50 —— 图库会随加图变长（加图脚本往下发编号），
    // 写死的那天这里会变成"永远为真"的假绿/假红
    const maxN = Math.max(...GALLERY_IDS.map((x) => Number(x.replace(/^g/, ''))).filter(Number.isFinite))
    const last = `g${String(maxN).padStart(2, '0')}`
    expect(isGalleryId(last)).toBe(true)
    expect(isGalleryId(`g${String(maxN + 1).padStart(2, '0')}`)).toBe(false) // 表外：末位 +1
    expect(isGalleryId('')).toBe(false)
    expect(isGalleryId('G01')).toBe(false) // 大小写敏感
    expect(isGalleryId('g01.png')).toBe(false) // 传文件名进来是调用方的 bug，得露出来
  })
})

describe('pickRewardId：抽一张还没有的', () => {
  it('没拥有过任何一张 → 抽出来的必然在表里', () => {
    const id = pickRewardId([], () => 0)
    expect(id).toBe(GALLERY_IDS[0])
    expect(GALLERY_IDS).toContain(id)
  })

  it('★ 抽的永远是**还没有的**那张（拥有的从池子里剔掉）', () => {
    // 只差末张：池子里只剩它，rng=0（挑第一张）与逼近 1（挑最后一张）都该是它
    const missing = GALLERY_IDS[GALLERY_IDS.length - 1]
    const owned = GALLERY_IDS.slice(0, -1)
    expect(pickRewardId(owned, () => 0)).toBe(missing)
    expect(pickRewardId(owned, () => 0.999999)).toBe(missing)
  })

  it('★ 全得到了 → null（不返回空串、不死循环）', () => {
    expect(pickRewardId(GALLERY_IDS.slice(), () => 0)).toBeNull()
    // 顺序打乱、含重复，结果一样
    expect(pickRewardId([...GALLERY_IDS].reverse().concat('g01'), () => 0.5)).toBeNull()
  })

  it('★ 陌生 id 不占名额：只差末张在册 + 两个已删 id → 还能抽到末张', () => {
    const missing = GALLERY_IDS[GALLERY_IDS.length - 1]
    const owned = [...GALLERY_IDS.slice(0, -1), OFF_TABLE, 'whale-2019']
    expect(pickRewardId(owned, () => 0)).toBe(missing)
    // 反过来：只拥有陌生 id → 表里一张不少
    expect(galleryRemaining([OFF_TABLE])).toBe(GALLERY_IDS.length)
  })

  it('rng 越界（返回 1，闭区间实现里出现过）夹回池尾，不返回 undefined', () => {
    const id = pickRewardId([], () => 1)
    expect(id).toBe(GALLERY_IDS[GALLERY_IDS.length - 1])
    expect(id).toBeTypeOf('string')
  })

  it('rng 恒 0 时抽遍全程：每次拿现有池子的第一张，表长次刚好集齐、不重样', () => {
    const owned: string[] = []
    for (let i = 0; i < GALLERY_IDS.length; i++) {
      const id = pickRewardId(owned, () => 0)
      expect(id).not.toBeNull()
      expect(owned).not.toContain(id)
      owned.push(id!)
    }
    expect(owned.slice().sort()).toEqual(GALLERY_IDS.slice().sort())
    expect(pickRewardId(owned, () => 0)).toBeNull()
  })

  it('均匀 rng 下整个池子都抽得到（不是只围着前几张转）', () => {
    let s = 7
    const rng = (): number => {
      s = (s * 1103515245 + 12345) % 2147483648
      return s / 2147483648
    }
    const seen = new Set<string>()
    // 抽数按池长缩放：凑齐 N 张的期望抽数 ≈ N·H(N)（优惠券收集）。写死 500 在
    // 50 张池时富余，2026-10-17 扩到 200 张后就不够了（500 抽平均只盖到 ~184 张）。
    // 20N 抽下漏掉任一张的概率 ≈ N·e⁻²⁰ ≈ 4e-7，且 rng 定子 ⇒ 结果恒等。
    for (let i = 0; i < 20 * GALLERY_IDS.length; i++) {
      const id = pickRewardId([], rng)
      expect(id).not.toBeNull()
      seen.add(id!)
    }
    expect(seen.size).toBe(GALLERY_IDS.length)
  })
})

describe('galleryRemaining：还差几张', () => {
  it('从表长递减，重复的拥有项只算一次', () => {
    const n = GALLERY_IDS.length
    expect(galleryRemaining([])).toBe(n)
    expect(galleryRemaining(['g01'])).toBe(n - 1)
    expect(galleryRemaining(['g01', 'g01', 'g02'])).toBe(n - 2)
    expect(galleryRemaining(GALLERY_IDS.slice())).toBe(0)
  })

  it('★ 陌生 id 不改变计数（不然删图之后"还差几张"会永远差着）', () => {
    expect(galleryRemaining(['g01', 'gone-forever'])).toBe(GALLERY_IDS.length - 1)
  })
})

describe('grantReward：发一次奖（V1-38 每日一次 + 满池兜底）', () => {
  const base = (over: Partial<ProfileRewards> = {}): ProfileRewards => ({
    gallery: [],
    perfectPasses: 0,
    lastImageDay: null,
    ...over
  })

  it('granted：新图进图鉴、lastImageDay 记今天、全对时 perfectPasses +1；**不改入参**', () => {
    // 不改入参是硬规矩：主进程拿 current 算一份新的整份写回，
    // 原地改会让调用方手里的 current 悄悄变样（写入的还是"旧 rewards"就说不清了）
    const before = base()
    const res = grantReward(before, 'g07', '2026-10-16', true)
    expect(res.kind).toBe('granted')
    expect(res.rewards).toEqual({ gallery: ['g07'], perfectPasses: 1, lastImageDay: '2026-10-16' })
    expect(before).toEqual(base())
  })

  it('granted 但**不全对**：图照发、perfectPasses 不动（2026-10-17 口径）', () => {
    // 每天第一次完成复习就发图，考得好不好都有；全对只额外记台账
    const before = base({ perfectPasses: 2 })
    const res = grantReward(before, 'g07', '2026-10-16', false)
    expect(res.kind).toBe('granted')
    expect(res.rewards).toEqual({ gallery: ['g07'], perfectPasses: 2, lastImageDay: '2026-10-16' })
  })

  it('daily-limit：同一天第二张不发图 —— gallery 不动；全对时 perfectPasses 照 +1', () => {
    // 全对是**真的**（结果页本来就是满分），只是图一天只发一张；
    // 把 +1 也一起挡掉的话，用户会以为这轮全对白费了
    const before = base({ gallery: ['g07'], perfectPasses: 1, lastImageDay: '2026-10-16' })
    const res = grantReward(before, 'g08', '2026-10-16', true)
    expect(res.kind).toBe('daily-limit')
    expect(res.rewards).toEqual({ gallery: ['g07'], perfectPasses: 2, lastImageDay: '2026-10-16' })
  })

  it('daily-limit 且不全对：两本账都不动（没有全对证据就不记）', () => {
    const before = base({ gallery: ['g07'], perfectPasses: 1, lastImageDay: '2026-10-16' })
    const res = grantReward(before, 'g08', '2026-10-16', false)
    expect(res.kind).toBe('daily-limit')
    expect(res.rewards).toEqual({ gallery: ['g07'], perfectPasses: 1, lastImageDay: '2026-10-16' })
  })

  it('daily-limit：时钟拨到**更早**的日子也挡（字符串序=时间序，拨回去骗不出第二张）', () => {
    const before = base({ gallery: ['g07'], perfectPasses: 1, lastImageDay: '2026-10-16' })
    const res = grantReward(before, 'g08', '2026-10-10', true)
    expect(res.kind).toBe('daily-limit')
    expect(res.rewards.gallery).toEqual(['g07'])
  })

  it('granted：日子**往前走**了就放行（今天晚于上次发图日）', () => {
    const before = base({ gallery: ['g07'], perfectPasses: 1, lastImageDay: '2026-10-15' })
    const res = grantReward(before, 'g08', '2026-10-16', true)
    expect(res.kind).toBe('granted')
    expect(res.rewards.lastImageDay).toBe('2026-10-16')
    expect(res.rewards.gallery).toEqual(['g07', 'g08'])
  })

  it('full：id 为 null（图库全收集完）—— 全对只 +1，lastImageDay 不动', () => {
    const before = base({ gallery: ['g07'], perfectPasses: 3, lastImageDay: '2026-10-15' })
    const res = grantReward(before, null, '2026-10-16', true)
    expect(res.kind).toBe('full')
    expect(res.rewards).toEqual({ gallery: ['g07'], perfectPasses: 4, lastImageDay: '2026-10-15' })
  })

  it('full：认不出的 id / 已经有的 id —— 不写进图鉴（写进去就是一张永远打不开的图）', () => {
    const unknown = grantReward(base(), OFF_TABLE, '2026-10-16', true)
    expect(unknown.kind).toBe('full')
    expect(unknown.rewards.gallery).toEqual([])
    const owned = grantReward(base({ gallery: ['g07'] }), 'g07', '2026-10-16', true)
    expect(owned.kind).toBe('full')
    expect(owned.rewards.gallery).toEqual(['g07'])
  })

  it('满池优先于每日限制：集齐是永久状态，说"集齐"比说"明天再来"准确', () => {
    const res = grantReward(base({ gallery: ['g07'], lastImageDay: '2026-10-16' }), null, '2026-10-16', true)
    expect(res.kind).toBe('full')
  })

  it('day 为 null（调用方拿不出日子）→ 不启用每日限制，也不把已有的锚抹掉', () => {
    const res = grantReward(base({ gallery: ['g07'], lastImageDay: '2026-10-16' }), 'g08', null, true)
    expect(res.kind).toBe('granted')
    expect(res.rewards.lastImageDay).toBe('2026-10-16') // 没日子可记 → 保持原样，不伪造成 null
  })
})
