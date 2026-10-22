/**
 * 奖励图的**取图**：把 gNN 换成打包后的图片地址。
 *
 * 【三样东西的真源在三处，这里只负责把 id 和文件对上】
 *   · id      —— `shared/gallery.ts` 的 `GALLERY_IDS`（落盘身份，永不改）
 *   · 文件    —— `assets/gallery/gNN.png`（或 `.gif`），**这个文件自己认**（下面那句 glob）
 *   · 名字    —— `lib/copy.ts` 的 `GALLERY.TITLES`（文案闸门要求）
 * 有一条单测（`lib/__tests__/gallery.test.ts`）拿 `fs` 直接读磁盘，把这三样
 * 一一对上 —— 删图忘了删表 / 加了图没加名字，都会红。
 *
 * 【为什么用 glob 而不是手写一串 import】
 * 手写 50 行 `import g01 from '../assets/gallery/g01.png'` 也能跑，但那样
 * 「表里有哪几张」就有了第二份定义：删一张图要同时删 import、删表、删标题，
 * 少删一处就是打包报错或运行时 undefined。glob 让**磁盘上的文件**成为
 * 文件这一侧的唯一真源，表与磁盘对不上时由单测出声，而不是等用户看到裂图。
 *
 * 【为什么 id 不直接用文件名（`g01.png`）】
 * 见 `shared/gallery.ts` 抬头：文件名会变（重出、换格式），id 是身份。
 * 所以这里做的是「id → 文件名」的翻译，翻译规则：**id 加 `.png`**；没有
 * `.png` 再看 `.gif`（2026-10-17 社区图包扩池起，GIF 也入册）。没有模糊匹配、
 * 没有大小写兜底 —— 表里写错一个 id，单测会红，而不是悄悄退回"随便给一张"。
 * 同一个 id 同时有 png 和 gif 属于**非法状态**（显示与保存可能各选一张），
 * 由单测直接判红。
 *
 * ⚠️ 老规矩（同 `cursor.ts` / `MiMascot.vue`）：**glob 是打包时算的**。
 * 开发模式下丢一张新图进去立刻生效；打包成 exe 之后再丢不会出现，得重新打包。
 * 所以"换**出厂**图"这件事的完整动作是：换 `assets/gallery/gNN.png` → 改名册
 * （`gallery-对照表.json`）→ **重新打包**。
 *
 * 【运行时替换（2026-10-16）】不想重新打包的换图走**覆盖文件夹**：
 * `<数据目录>/rewards` 里丢 `gNN.png`，本函数先查覆盖映射
 * （lib/reward-overrides.ts，主进程现扫），命中就用 `miai-wall://` 地址 ——
 * 「屏幕显示」与「保存图片」（主进程 findGalleryImage）两处同吃一份覆盖，
 * 缺一处就是「屏幕是我换的图、保存出去是官方图」的静默不一致。
 */
import { GALLERY_IDS } from '../../../shared/gallery'
import { rewardOverrideUrl } from './reward-overrides'

const FILES = {
  // 两次 glob 再合并：`*.{png,gif}` 的括号展开依赖 glob 引擎，分开写更稳。
  ...(import.meta.glob('../assets/gallery/*.png', {
    eager: true,
    query: '?url',
    import: 'default'
  }) as Record<string, string>),
  ...(import.meta.glob('../assets/gallery/*.gif', {
    eager: true,
    query: '?url',
    import: 'default'
  }) as Record<string, string>)
}

/**
 * 取一张奖励图的地址。**认不出的 id 给 null**（调用方据此不渲染 `<img>`，
 * 而不是渲染一个 `src="undefined"` 的裂图 —— 后者在界面上是一片空白，
 * 看上去像"图还没加载完"，查起来比 null 难十倍）。
 */
export function rewardImageUrl(id: string): string | null {
  if (!GALLERY_IDS.includes(id)) return null
  // 用户覆盖优先（<数据目录>/rewards，2026-10-16，见文件头「运行时替换」）——
  // 映射由 reward-overrides 缓存，刷新时机：启动 / 进仓库页 / 弹奖励窗前 / 设置页
  const cov = rewardOverrideUrl(id)
  if (cov) return cov
  return FILES[`../assets/gallery/${id}.png`] ?? FILES[`../assets/gallery/${id}.gif`] ?? null
}
