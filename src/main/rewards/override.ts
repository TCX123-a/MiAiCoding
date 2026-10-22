/**
 * 奖励图覆盖扫描 —— <数据目录>/rewards 里找「用户自己丢进来的奖励图」。
 *
 * 【这是干什么的】奖励图的出厂文件烧在包里（`assets/gallery/gNN.png`，vite
 * 编译期 glob，见 renderer/src/lib/gallery.ts 的文件头）；本文件读的是
 * 「运行时替换」：把筛好的图按 `gNN.png` 命名丢进这个文件夹，图鉴与奖励
 * 弹窗就显示丢进来的这张。**id 是身份、文件可变**本来就是 shared/gallery.ts
 * 预留的缝 —— 覆盖只换文件，不碰任何落盘身份（profile.rewards.gallery
 * 只存 id，一切数据层零改动）。
 *
 * 【为什么在这卡文件名形态】id 会进「保存图片」的路径拼接（app.ts 的
 * findGalleryImage）与 miai-wall 白名单目录 —— 白名单是**整目录放行**，
 * 文件名不再逐个人工卡，所以形态必须在这里卡死：isGalleryId 挡掉 `../`、
 * 空格、中文、超长 id，只放小写字母数字。丢一个 `g51.png` 不会扩池
 * （GALLERY_IDS 里没有它）——扩池仍走 scripts/add-gallery-image.mjs，
 * 那条路改的是「身份表+出厂文件」，跟本文件的「本机显示替换」是两回事。
 *
 * 【多扩展名怎么办】png / jpg / jpeg / webp / gif 都收（协议 MIME 表
 * protocol.ts 全认）。同一个 id 出现多张时按扩展名优先级取
 * png > jpg > jpeg > webp > gif ——
 * 固定规则、不猜新旧（mtime 会随拷贝变化，不是稳定判据）。要换图就把旧文件
 * 删掉/改名，别放两张赌运气。
 *
 * 【过滤口径对齐邻居（custom.ts / splash material）】隐藏文件跳过、
 * readdir 失败 = 空映射（目录不存在 =「还没丢过图」，**不是错误**）、
 * stat 失败或非普通文件跳过（拦「名叫 g01.png 的目录」这类怪东西）。
 */
import { readdirSync, statSync } from 'fs'
import { join } from 'path'
import { isGalleryId } from '../../shared/gallery'

/** 认的扩展名；数组顺序 = 同 id 多文件时的优先级（见文件头「多扩展名」） */
const OVERRIDE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif'] as const

/**
 * 扫一个目录，返回 `id → 覆盖文件绝对路径`。`dir` 为空字符串时返回空 ——
 * 由调用方决定「目录在哪」（app.ts 的 rewardsDir()），本函数不猜。
 */
export function scanRewardOverrides(dir: string): Record<string, string> {
  if (!dir) return {}
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return {}
  }
  names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

  // 先按 id 归拢候选，再按扩展名优先级定谁赢（见文件头「多扩展名」）
  const candidates = new Map<string, { name: string; rank: number }[]>()
  for (const name of names) {
    if (name.startsWith('.')) continue
    const dot = name.lastIndexOf('.')
    if (dot <= 0) continue
    const rank = (OVERRIDE_EXTS as readonly string[]).indexOf(name.slice(dot + 1).toLowerCase())
    if (rank < 0) continue
    const id = name.slice(0, dot)
    if (!isGalleryId(id)) continue
    const abs = join(dir, name)
    try {
      if (!statSync(abs).isFile()) continue
    } catch {
      continue
    }
    const list = candidates.get(id)
    if (list) list.push({ name, rank })
    else candidates.set(id, [{ name, rank }])
  }

  const out: Record<string, string> = {}
  for (const [id, list] of candidates) {
    list.sort((a, b) => a.rank - b.rank || (a.name < b.name ? -1 : 1))
    out[id] = join(dir, list[0].name)
  }
  return out
}
