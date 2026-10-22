/**
 * 奖励图覆盖扫描（`src/main/rewards/override.ts`）与「保存图片吃覆盖」的接线闸门。
 *
 * 【为什么值得钉】覆盖机制有**两个消费点**（显示 = 渲染层 rewardImageUrl、
 * 保存 = 本文件盯的 findGalleryImage）——「保存图片」半边没有行为面单测
 * （真弹系统保存框在单测里跑不起来），就用源码闸门把顺序钉死：覆盖检查
 * 必须在出厂路径之前，反了 =「屏幕是我换的图、保存出去是官方图」的静默
 * 不一致。闸门配**尺子种坏自检**：把顺序反过来的样本喂给同一把尺子，
 * 它必须报红（先见它红过，再用它的绿）。
 *
 * 扫描函数本体是纯函数，行为面全部可测：命名口径（只认 GALLERY_IDS）、
 * 扩展名（png/jpg/jpeg/webp/gif、同 id 多张时的优先级）、怪东西（目录、隐藏
 * 文件、不在册的 id）。夹具不写真图片字节 —— 扫描只看名字与 stat，
 * 不读内容（内容对不对是浏览器/协议的事）。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { scanRewardOverrides } from '../rewards/override'
import { GALLERY_IDS, isGalleryId } from '../../shared/gallery'
import { maskComments } from '../../shared/__tests__/mask-comments'

/**
 * 表外末位 id：**现算而不是写死** —— 图库扩容后（2026-10-17 上限放开到 g200）
 * 写死的 g51 会进册，「不在册」这条用例就白测了。maxN + 1 永远在表外。
 */
const maxN = Math.max(...GALLERY_IDS.map((x) => Number(x.replace(/^g/, ''))).filter(Number.isFinite))
const OFF_TABLE = `g${maxN + 1}`

const root = mkdtempSync(join(tmpdir(), 'miai-rewards-'))
afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    /* 清理失败不影响结论 */
  }
})

/** 造一个只属于本条用例的目录（互不串味）；文件内容随便写几个字节 */
function fixtureDir(name: string, files: string[], dirs: string[] = []): string {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  for (const f of files) writeFileSync(join(dir, f), 'x')
  for (const d of dirs) mkdirSync(join(dir, d), { recursive: true })
  return dir
}

describe('scanRewardOverrides：命名与过滤口径', () => {
  it('前置自检：g01 在册、表外末位不在册（夹具的假设先量一遍尺子）', () => {
    expect(isGalleryId('g01'), 'g01 不在 GALLERY_IDS？后面的用例前提全塌').toBe(true)
    expect(isGalleryId(OFF_TABLE), `表外末位 ${OFF_TABLE} 竟然在册？「不在册」这条用例白测`).toBe(false)
  })

  it('目录不存在 = 空映射（不是错误）；空目录 = 空映射；空串 = 空映射', () => {
    expect(scanRewardOverrides(join(root, 'no-such-dir'))).toEqual({})
    expect(scanRewardOverrides(fixtureDir('empty', []))).toEqual({})
    expect(scanRewardOverrides('')).toEqual({})
  })

  it('g01.png → { g01: 绝对路径 }', () => {
    const dir = fixtureDir('basic', ['g01.png'])
    expect(scanRewardOverrides(dir)).toEqual({ g01: join(dir, 'g01.png') })
  })

  it('不在册的 id / 坏形态 / 坏扩展名一律不认（扩展名大小写不敏感）', () => {
    const dir = fixtureDir('bad-names', [`${OFF_TABLE}.png`, 'foo.png', 'g1.png', 'g02.txt', 'g03.PNG', '.g04.png', 'g05'])
    expect(scanRewardOverrides(dir)).toEqual({ g03: join(dir, 'g03.PNG') })
  })

  it('jpg / jpeg / webp / gif 都收', () => {
    const dir = fixtureDir('exts', ['g01.jpg', 'g02.jpeg', 'g03.webp', 'g04.gif'])
    expect(scanRewardOverrides(dir)).toEqual({
      g01: join(dir, 'g01.jpg'),
      g02: join(dir, 'g02.jpeg'),
      g03: join(dir, 'g03.webp'),
      g04: join(dir, 'g04.gif')
    })
  })

  it('同一 id 多张时按扩展名优先级 png > jpg > jpeg > webp > gif（固定规则、不看 mtime）', () => {
    const dir = fixtureDir('priority', [
      'g01.jpg',
      'g01.png',
      'g02.webp',
      'g02.jpeg',
      'g03.jpeg',
      'g03.jpg',
      'g04.gif',
      'g04.webp'
    ])
    expect(scanRewardOverrides(dir)).toEqual({
      g01: join(dir, 'g01.png'),
      g02: join(dir, 'g02.jpeg'),
      g03: join(dir, 'g03.jpg'),
      g04: join(dir, 'g04.webp')
    })
  })

  it('名叫 g04.png 的**目录**不算文件（stat 过滤）', () => {
    const dir = fixtureDir('dir-trap', ['g05.png'], ['g04.png'])
    expect(scanRewardOverrides(dir)).toEqual({ g05: join(dir, 'g05.png') })
  })

  it('两次扫描结果一致（排序确定性）', () => {
    const dir = fixtureDir('stable', ['g30.png', 'g03.webp', 'g10.jpg', 'g01.png'])
    expect(scanRewardOverrides(dir)).toEqual(scanRewardOverrides(dir))
  })
})

describe('接线闸门：findGalleryImage 里覆盖检查在出厂路径之前', () => {
  const appSrc = maskComments(readFileSync(join(__dirname, '..', 'app.ts'), 'utf8'))

  /** 只取 findGalleryImage 段（next 顶层 `}` 收口）：全文件口径会被将来别的函数顶替 */
  function findGalleryBody(text: string): string {
    const i = text.indexOf('function findGalleryImage')
    if (i === -1) return ''
    const j = text.indexOf('\n}', i)
    return text.slice(i, j === -1 ? undefined : j)
  }

  /** 判据本体：覆盖检查（scanRewardOverrides）必须出现在 devPath/出厂扫描之前 */
  function overridePrecedesFactory(fnText: string): boolean {
    const oi = fnText.indexOf('scanRewardOverrides')
    const di = fnText.indexOf('devPath')
    return oi !== -1 && di !== -1 && oi < di
  }

  it('非空自检：切出来的确实是 findGalleryImage（改名/挪家会在这红）', () => {
    expect(findGalleryBody(appSrc), 'app.ts 里找不到 findGalleryImage').not.toBe('')
  })

  it('★ 覆盖检查在出厂路径之前（反了 = 屏幕与保存不一致）', () => {
    expect(overridePrecedesFactory(findGalleryBody(appSrc))).toBe(true)
  })

  it('尺子自带种坏自检：顺序反过来 / 覆盖检查缺失，都必须判违规', () => {
    const reversed = 'function findGalleryImage(id){ const devPath = x; const o = scanRewardOverrides(d) }'
    expect(overridePrecedesFactory(reversed), '尺子对顺序反了的写法瞎了').toBe(false)
    const missing = 'function findGalleryImage(id){ const devPath = x; return devPath }'
    expect(overridePrecedesFactory(missing), '尺子对「没有覆盖检查」瞎了').toBe(false)
    const good = 'function findGalleryImage(id){ const o = scanRewardOverrides(d)[id]; if (o) return o; const devPath = x }'
    expect(overridePrecedesFactory(good), '尺子把合格写法也判违规了').toBe(true)
  })
})
