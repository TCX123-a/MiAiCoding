/**
 * 奖励图库的**三方对账**：表（GALLERY_IDS）↔ 磁盘（assets/gallery/*.png|*.gif）↔ 名字（copy.ts）。
 *
 * 【为什么这条单测能读磁盘，而 lib/gallery.ts 自己不行】
 * `lib/gallery.ts` 里那句 `import.meta.glob` 是 Vite 的编译期语法，node 里跑不了 ——
 * 所以那个文件进不了单测。但**磁盘就是磁盘**：这个测试用 `fs` 直接读目录，
 * 拿到的正是打包前那一刻的真实文件列表。三方里最危险的两处（文件少一张、
 * 名字漏一个）都在这条线上，剩下的"id → 打包后地址"那一步是一行字符串拼接，
 * 由真窗口探针兜（它会断言奖励弹窗里那张 `<img>` 真的加载出来了）。
 *
 * 【红的几种情形，各自意味着什么】
 *   · 表里有、磁盘没有 → 发奖时 `rewardImageUrl` 给 null，用户拿到一张**空卡**；
 *     而且这张 id 已经写进他的档案了，"补上"要等他再全对一次。
 *   · 磁盘有、表里没有 → 多出来的图永远不会被发出去（死文件，白占体积），
 *     多半是删表时忘了删文件。
 *   · 同一个 id 同时有 png 和 gif → 渲染层（先 png）与主进程保存（先 png）
 *     看似一致，但以后任何一处改了优先级就会静默各挑一张；直接判非法。
 *   · 文件 0 字节 / 魔数不对 → 发出去是一张裂图，比"没有图"更难查。
 *   · 名字漏一个 → 弹窗上写着「获得新图：undefined」。文案闸门扫不到这里
 *     （TITLES 是个 `Record<string,string>`，少一个键不报错），所以由这条兜。
 *
 * ⚠️ 主人换图时这三样要一起改，条目在 `gallery-对照表.json` 里能查到
 * 每一张的来历（源文件、种子、口味）。
 */
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { GALLERY_IDS, galleryRemaining, isGalleryId, pickRewardId } from '../../../../shared/gallery'
import { GALLERY } from '../copy'

const DIR = join(__dirname, '..', '..', 'assets', 'gallery')

/** 图库认的扩展名（顺序 = 渲染层/主进程的查找优先级；同 id 两个都有 = 非法） */
const EXTS = ['png', 'gif'] as const

/** 磁盘上真实存在的图库文件（别的扩展名/别的文件名都算异物） */
function filesOnDisk(): string[] {
  return readdirSync(DIR)
    .filter((n) => EXTS.some((e) => n.toLowerCase().endsWith(`.${e}`)))
    .sort()
}

/** 这个 id 在磁盘上对应的文件名（没有 → null；两个都有 → 由专门用例判非法） */
function fileFor(id: string): string | null {
  for (const e of EXTS) {
    const name = `${id}.${e}`
    if (existsSync(join(DIR, name))) return name
  }
  return null
}

/** 读文件头几个字节（不整份读进内存：扩池后图库已有三百多 MB） */
function head(path: string, n = 8): Buffer {
  const fd = openSync(path, 'r')
  try {
    const b = Buffer.alloc(n)
    const got = readSync(fd, b, 0, n, 0)
    return b.subarray(0, got)
  } finally {
    closeSync(fd)
  }
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const GIF87 = Buffer.from('GIF87a', 'ascii')
const GIF89 = Buffer.from('GIF89a', 'ascii')

/** 判据本体：文件头 → 图片种类（认不出给 null）。尺子自检见最后一条用例 */
function magicKind(b: Buffer): 'png' | 'gif' | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(PNG_MAGIC)) return 'png'
  if (b.length >= 6 && (b.subarray(0, 6).equals(GIF87) || b.subarray(0, 6).equals(GIF89))) return 'gif'
  return null
}

describe('奖励图库：表 ↔ 磁盘 ↔ 名字', () => {
  it('表里的每一张，磁盘上都有对应的文件', () => {
    const missing = GALLERY_IDS.filter((id) => fileFor(id) === null)
    expect(missing, `这些 id 在表里但磁盘上没有：${missing.join('、')}`).toEqual([])
  })

  it('磁盘上的每一张，表里都登记了（没有死文件）', () => {
    const inTable = new Set(GALLERY_IDS.map((id) => fileFor(id)).filter((n): n is string => n !== null))
    const extra = filesOnDisk().filter((n) => !inTable.has(n))
    expect(extra, `这些文件在磁盘上但表里没有：${extra.join('、')}`).toEqual([])
  })

  it('同一个 id 不许同时有 png 和 gif（两套查找优先级会静默各挑一张）', () => {
    const onDisk = new Set(filesOnDisk())
    const both = GALLERY_IDS.filter((id) => EXTS.every((e) => onDisk.has(`${id}.${e}`)))
    expect(both, `这些 id 同时存在 png 和 gif：${both.join('、')}`).toEqual([])
  })

  it('每一张都有中文名（弹窗上不许出现 undefined）', () => {
    const missing = GALLERY_IDS.filter((id) => {
      const title = (GALLERY.TITLES as Record<string, string | undefined>)[id]
      return typeof title !== 'string' || title.length === 0
    })
    expect(missing, `这些 id 没有名字：${missing.join('、')}`).toEqual([])
  })

  it('名字表里没有多余的键（删图时忘记删名字的那种残留）', () => {
    const extra = Object.keys(GALLERY.TITLES).filter((id) => !isGalleryId(id))
    expect(extra, `名字表里多出这些键：${extra.join('、')}`).toEqual([])
  })

  it('文件张数对得上，且每个文件非空、魔数与扩展名一致（0 字节日是裂图）', () => {
    // 防「readdirSync 读了个空目录还算通过」：先证明读到的确实是表长那么多张，
    // 且每个都不是 0 字节（2026-10-17：旧版这条只数了名字，没真看大小）。
    const files = filesOnDisk()
    expect(files.length).toBe(GALLERY_IDS.length)
    for (const n of files) {
      const p = join(DIR, n)
      expect(statSync(p).size, `${n} 是 0 字节`).toBeGreaterThan(0)
      const kind = magicKind(head(p))
      const ext = n.slice(n.lastIndexOf('.') + 1).toLowerCase()
      expect(kind, `${n} 的文件头不是有效的 PNG/GIF 魔数`).toBe(ext)
    }
  })

  it('尺子自带种坏自检：魔数判据对假图必须给 null，对真魔数必须给对', () => {
    expect(magicKind(Buffer.from('this is not an image'))).toBeNull()
    expect(magicKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png')
    expect(magicKind(Buffer.from('GIF89a....'))).toBe('gif')
    expect(magicKind(Buffer.from('GIF87a....'))).toBe('gif')
  })
})

describe('图库的收集进度（弹窗上的"图鉴 N/总数"）', () => {
  it('一张没有是总数，全齐是 0', () => {
    expect(galleryRemaining([])).toBe(GALLERY_IDS.length)
    expect(galleryRemaining(GALLERY_IDS.slice())).toBe(0)
  })

  it('抽出来的永远在磁盘上找得到（把"表↔磁盘"和"抽样"两条线接起来看）', () => {
    const onDisk = new Set(filesOnDisk())
    // 拿确定性随机源把整个图池连抽一遍，每次的 id 都必须有对应的文件
    let s = 20260930
    const rng = (): number => {
      s = (s * 1103515245 + 12345) % 2147483648
      return s / 2147483648
    }
    const owned: string[] = []
    for (let i = 0; i < GALLERY_IDS.length; i++) {
      const id = pickRewardId(owned, rng)
      expect(id).not.toBeNull()
      const f = fileFor(id!)
      expect(f, `${id} 在表里但磁盘上没有`).not.toBeNull()
      expect(onDisk.has(f!), `${id} 对应的 ${f} 不在磁盘清单里`).toBe(true)
      owned.push(id!)
    }
    expect(pickRewardId(owned, rng)).toBeNull()
  })
})
