/**
 * 「面板可透明、字永远实心」的静态闸门（2026-10-04，壁纸可见性修复的配套）。
 *
 * 【这个文件在守什么】
 * 主人定的硬底线：**代码块、正文文字、题目、大肥鱼图标必须保持完全不透明**。
 * 透明度开关（--mi-panel-alpha）只许稀释**容器面**（卡片/侧栏/右栏）的底色。
 * 这条边界靠三件事钉死：
 *
 *   ① **IN 清单精确计数**：全渲染层每一处 `var(--mi-*-glass)` 的消费点
 *      都必须落在清单里的 10 个文件、总数 16。多一处、少一处、换一个文件，
 *      都会红 —— 包括「顺手给某个 OUT 元素也套一个」。扫描面 = .vue/.css/.ts
 *      （.ts 里也能设 inline style，2026-10-04 复核补上这类盲区）。
 *   ② **OUT 反例守卫**：硬底线点名的几类元素（大肥鱼、正文/代码块、题目）
 *      单独再验一次零令牌，红了时消息直说谁被玻璃化了。
 *   ③ **opacity 声明数快照**：全库 `opacity:` 声明数钉死。这次改动**零新增** ——
 *      也就是说「让面板透」的效果必须由 glass 令牌的 background 完成，
 *      任何人想用 `opacity` 走捷径（那个会连文字一起变淡），计数先红。
 *      数字变了不是一定错，是**必须人工过目**那新增的一行去了哪。
 *
 * 【它抓不到什么 —— 说清楚，别当它万能的】
 * 静态文本闸门验不了「运行时算出来的颜色」：color-mix 的实际合成值、
 * 浏览器里真实的对比度、拖动时面板到底透没透 —— 那些是探针 E/F/H/J 的活。
 * 这里只保证「该吃变量的元素吃了、不该吃的没碰」这条**接线**没被改坏。
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { describe, expect, it } from 'vitest'
import { maskComments } from './mask-comments'

/** 本文件在 src/shared/__tests__ 下 */
const RENDERER_SRC = join(__dirname, '..', '..', 'renderer', 'src')
const STYLES = join(RENDERER_SRC, 'styles')

/** 玻璃令牌的**消费**写法（`var(--mi-X-glass)`）。定义处（冒号在左边）不匹配 */
const GLASS = /var\(--mi-(?:card|bg|blue-light)-glass\)/g

const rel = (p: string): string => relative(RENDERER_SRC, p).replace(/\\/g, '/')

/**
 * 走一遍 renderer/src。排掉 __tests__ —— 那边测试源码里会引用令牌名字，
 * 不排掉的话闸门会被自己的说明文字绊倒（maskComments 的由来，同一个坑）。
 */
function sourceFiles(ext: RegExp): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === '__tests__') continue
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (ext.test(name)) out.push(p)
    }
  }
  walk(RENDERER_SRC)
  return out
}

const styleFiles = sourceFiles(/\.(vue|css)$/)
const allFiles = sourceFiles(/\.(vue|css|ts)$/)

/** 一个文件里消费了几处玻璃令牌（剥注释后再数） */
function glassUses(file: string): number {
  const masked = maskComments(readFileSync(file, 'utf8'))
  return (masked.match(GLASS) ?? []).length
}

/**
 * IN 清单：允许出现玻璃令牌的**全部**文件与处数。
 * 数字对不上就红 —— 改清单是主动行为，改完这里同步登记（注释里写明为什么）。
 *   · MiCard 的底：一切卡片的公共壳
 *   · Sidebar / RightPanel：两栏的底（RightPanel 有 3 处：面板底 + 两个分区的底）
 *   · TopBar 的底：顶条（WCO 的网页部分，2026-10-05 顶条玻璃化加入 ——
 *     主人点名「和侧边栏、学习卡片一样受 UI 面板不透明度控制」）
 *   · LearnView 5 处：3 张卡 + 1 个悬浮项的蓝底 + 挑战卡的锁定态
 *     （2026-10-10 解锁闸：locked 与 done 同为「退化的白卡」，
 *     用同一枚 --mi-card-glass 把蓝底收回去，壁纸下也一起透）
 *   · LessonDetailView 2 处：前置课条目 + 底部操作条
 *   · 其余各 1：Settings / Challenge / Review 的卡片底
 *   · LoginView 1 处（⑤ 十项升级，2026-10-08）：登录面板的底 ——
 *     裸路由页（meta.bare）上唯一的一块玻璃面，壁纸一定在场，
 *     正是「液态玻璃浮在沉浸背景上」那一张；返回胶囊用实色 --mi-bg
 *     （它压在壁纸上，稀释到 10% 会糊字），没进本清单。
 * · FavoritesView 的吸底工具条**移出本清单**（2026-10-04 复核）：它是覆盖层、
 *   滚动行从它底下穿过去，玻璃化后正文会透进文字背后 —— 改回实色，在 OUT 看住。
 */
const IN_SURFACES: Record<string, number> = {
  'components/base/MiCard.vue': 1,
  'components/domain/TopBar.vue': 1,
  'components/domain/RightPanel.vue': 3,
  'components/domain/Sidebar.vue': 1,
  'views/ChallengeView.vue': 1,
  'views/LearnView.vue': 5,
  'views/LessonDetailView.vue': 2,
  'views/LoginView.vue': 1,
  'views/ReviewView.vue': 1,
  'views/SettingsView.vue': 1
}

describe('自检：先证明真的扫到了东西', () => {
  it('扫到的样式文件数量合理，且认得出关键文件', () => {
    // 走目录的闸门最安静的坏法是「一个文件都没扫到」—— 下面全部断言
    // 都会在空集合上通过。这条就是防它。
    expect(styleFiles.length, '一个样式文件都没扫到，下面的断言都是空的').toBeGreaterThan(40)
    expect(styleFiles.some((f) => f.endsWith('MiCard.vue'))).toBe(true)
    expect(allFiles.some((f) => f.endsWith('main.ts'))).toBe(true)
  })
})

describe('tokens.css：玻璃令牌的静态定义', () => {
  const tokens = maskComments(readFileSync(join(STYLES, 'tokens.css'), 'utf8'))

  it('三个 glass 令牌 = 各自实色 —— 关壁纸时逐字节等于改造前（零残留）', () => {
    expect(tokens).toContain('--mi-card-glass: var(--mi-card);')
    expect(tokens).toContain('--mi-bg-glass: var(--mi-bg);')
    expect(tokens).toContain('--mi-blue-light-glass: var(--mi-blue-light);')
  })

  it('--mi-panel-alpha 静态兜底 100%（color-mix 100% 恒等，双保险）', () => {
    expect(tokens).toContain('--mi-panel-alpha: 100%;')
  })

  it('V2-30：材质原色只以 -base 形态存在、系数兜底 100% —— 稀释只许发生在门控块', () => {
    expect(tokens, 'tokens.css 里丢了材质原色').toContain('--mi-glass-rim-base:')
    expect(tokens, 'tokens.css 里丢了厚度原色').toContain('--mi-glass-depth-color-base:')
    expect(tokens, '材料系数的静态兜底没了（脚本没跑起来时颜色会整片失效）').toContain(
      '--mi-material-fade: 100%;'
    )
    // 未稀释的成品名不许在 tokens.css 里定义 —— 否则它绕开门控块直接生效，
    // 「alpha=0 = 材料全隐藏」当场破功。冒号是关键：-base 定义不含紧随的
    // 「rim:/color:」子串，不会被这两条误伤。
    expect(tokens).not.toContain('--mi-glass-rim:')
    expect(tokens).not.toContain('--mi-glass-depth-color:')
  })
})

describe('wallpaper.css：门控块把令牌接上 --mi-panel-alpha', () => {
  const wallpaper = maskComments(readFileSync(join(STYLES, 'wallpaper.css'), 'utf8'))

  it('`:root[data-wallpaper]` 门控块在场，三个令牌重定义为 color-mix(实色 × alpha)', () => {
    expect(wallpaper).toContain(':root[data-wallpaper] {')
    expect(wallpaper).toContain(
      '--mi-card-glass: color-mix(in srgb, var(--mi-card) var(--mi-panel-alpha), transparent);'
    )
    expect(wallpaper).toContain(
      '--mi-bg-glass: color-mix(in srgb, var(--mi-bg) var(--mi-panel-alpha), transparent);'
    )
    expect(wallpaper).toContain(
      '--mi-blue-light-glass: color-mix(in srgb, var(--mi-blue-light) var(--mi-panel-alpha), transparent);'
    )
  })

  it('画布 veil 消费 --mi-wall-veil（media 档）', () => {
    expect(wallpaper).toContain(":root[data-wallpaper='media'] .layout")
    expect(wallpaper).toContain('var(--mi-wall-veil)')
  })

  it('V2-30：棱与厚度在门控块里按 --mi-material-fade 稀释（-base 的唯一消费口）', () => {
    expect(wallpaper).toContain(
      '--mi-glass-rim: color-mix(in srgb, var(--mi-glass-rim-base) var(--mi-material-fade), transparent);'
    )
    expect(wallpaper).toContain(
      '--mi-glass-depth-color: color-mix(in srgb, var(--mi-glass-depth-color-base) var(--mi-material-fade), transparent);'
    )
  })
})

describe('main.ts：两个变量真的被注入到 <html> 上', () => {
  const mainSrc = maskComments(readFileSync(join(RENDERER_SRC, 'main.ts'), 'utf8'))

  it('启动 watch 里 setProperty 了 --mi-panel-alpha 与 --mi-wall-veil', () => {
    // 没这一条的话滑杆是死的：store 改了、localStorage 存了，CSS 变量没动。
    // 界面照常渲染、不报任何错 —— 典型的「测了但没接上」。
    expect(mainSrc).toContain("setProperty('--mi-panel-alpha'")
    expect(mainSrc).toContain("setProperty('--mi-wall-veil'")
  })

  it('V2-30：--mi-material-fade 也在这个 watch 里注入，且值来自 materialFadeOf', () => {
    // 两段都要钉：只钉变量名，值是硬编码常量也能过；只钉函数名，
    // 算了没注入（滑杆拖动时材料不跟着淡）也能过。
    expect(mainSrc).toContain("'--mi-material-fade'")
    expect(mainSrc).toContain('materialFadeOf(active.panelAlpha)')
  })
})

describe('IN/OUT 边界：玻璃令牌全库只许出现在容器面上', () => {
  it('消费点恰好是 IN 清单那 10 个文件、共 17 处', () => {
    const found: Record<string, number> = {}
    // 扫 allFiles（含 .ts）：.ts 也能往元素上写 inline style / 拼 CSS 文本，
    // 只扫 .vue/.css 时这类消费是静默漏过的（2026-10-04 复核）。当前树里
    // .ts 消费数 = 0，计数不变 —— 但闸门从此盖住这一类文件。
    for (const f of allFiles) {
      const n = glassUses(f)
      if (n > 0) found[rel(f)] = n
    }
    expect(
      found,
      '出现的文件/处数和清单对不上 —— 多出来的要么登记进 IN、要么就是硬底线被踩了（先看下面 OUT 那组）'
    ).toEqual(IN_SURFACES)
  })

  it.each([
    ['views/FavoritesView.vue', '吸底多选工具条（覆盖层，正文从其底下滚过）'],
    ['components/base/MiMascot.vue', '大肥鱼图标（主人点名硬底线）'],
    ['styles/md.css', '课文正文与代码块（主人点名硬底线）'],
    ['components/domain/quiz/QuizChoice.vue', '题目选项（主人点名硬底线）'],
    ['components/domain/CodeEditor.vue', '练习场编辑器'],
    ['components/domain/CompareGrid.vue', '对比块'],
    ['components/domain/DemoPlayer.vue', '演示块'],
    ['components/domain/RunnerPanel.vue', '运行输出面板'],
    ['components/domain/SearchPanel.vue', '搜索浮层'],
    ['components/base/MiModal.vue', '弹窗（要在最上层读得清）'],
    ['components/domain/FullscreenMenu.vue', '全屏菜单（⑦，与 MiModal 同类的最上层读物）'],
    ['components/base/MiToast.vue', '提示条'],
    ['components/base/MiDrawer.vue', '抽屉'],
    ['components/domain/quiz/QuizOverlay.vue', '答题浮层'],
    ['components/domain/quiz/QuizReview.vue', '错题回顾']
  ])('%s 零玻璃令牌 —— %s 不吃透明度', (file) => {
    expect(glassUses(join(RENDERER_SRC, file)), `${file} 被套上玻璃令牌了`).toBe(0)
  })
})

describe('opacity 快照：本次改动零新增（新增必须人工过目）', () => {
  it('全库 opacity 声明数 = 50', () => {
    // 40 是 2026-10-04 改造完成时的实测值（grep 原始 42 行，其中 2 行在注释里，
    // 剥注释后 40）。让面板透明必须走 background 的 glass 令牌；用 opacity 走捷径
    // 会把这一层的**文字一起**变淡 —— 那是硬底线禁止的效果。
    // 这个数变了不是一定错，是把新增的那行摊开看：它作用在谁身上、为什么会随壁纸变化。
    //
    // 【40 → 46 的六行新增，已逐行人工过目（2026-10-05，P3 第二步）】
    //   · lib/wallpaper/transitions.ts:175/176/184 —— 过场期间**写给槽位**的内联
    //     初/终态（zoom 的淡入、fade 的交叉淡化）。槽位里只有壁纸媒体、没有文字，
    //     这是过场机制本身（逐字移植原型），不是「让界面变淡」。
    //   · styles/wallpaper.css:120 —— `.wp-slot--pending{opacity:0}`：新层画面
    //     没就位前的绘制闸门，同样只作用于壁纸槽位。
    //   · components/base/MiTabs.vue:55 —— `.mi-tab:disabled{opacity:0.5}`：
    //     禁用态控件的可读反馈，与已有 40 行里的 MiSelect/MiButton/MiSwitch
    //     同一先例；硬底线管的是内容（正文/代码/题目/大肥鱼），不含控件禁用态。
    //   · views/SettingsView.vue:981 —— **不是 CSS 声明**：模板里
    //     `onWallPatch({ opacity: wall.opacity })` 的写法撞上了本条正则。
    //     （教训：这条闸门按行文本数数，「对象字面量的键名」会混进来 ——
    //     它仍是硬信号：新增了就必须解释清楚。）
    // 另：WallpaperLayer.vue 的探针字段 1 处与旧版打平（旧 String(opacity/100)
    // → 新原始数值），不计入新增。
    //
    // 【46 → 47 的一行新增，已人工过目（2026-10-08，⑦ 全屏遮罩菜单）】
    //   · FullscreenMenu.vue 的 `.fs-enter-from, .fs-leave-to { opacity: 0 }`：
    //     <Transition> 的入场/退场帧 —— 与 MiModal 的 `.modal-enter-from ...`
    //     同一先例（那行本来就在计数里）。淡的是**整张遮罩**进出场的那一下，
    //     不是「让界面内容变淡」；面板本身进出用 transform（scale），不吃 opacity。
    //
    // 【47 → 46 的一行移除，已人工过目（2026-10-10，对比度修复）】
    //   · components/domain/Sidebar.vue 的 `.lesson-item.locked { opacity: 0.6 }`：
    //     锁定课标题实测对比度只有 2.73（低于 4.5 硬线）—— opacity 是整行连
    //     文字一起变淡，正好撞在硬底线上。改用与 .draft 同一枚次级文字色
    //     `color: var(--mi-text-3)` 直接换色：视觉上同样是「未解锁的灰」，
    //     但颜色本身就是为可读性选的。与「让内容变淡是硬底线禁止」**同向**。
    //
    // 【46 → 48 的两行新增，已人工过目（2026-10-16，V1-59 键盘可达）】
    //   · components/base/MiCheckbox.vue 与 MiRadio.vue 的**隐形原生 input**
    //     各一行 `opacity: 0`：与 MiSwitch.vue 同一先例（它的同款 input 本来
    //     就在计数里）。input 全透明但仍是真控件 —— Tab 收得到焦点、Space
    //     能切换；可见的勾选皮肤是旁边的 .box / .dot 两个 span，**淡的不是
    //     任何内容**。改前的 `display: none` 收不到焦点，Tab 直接跳过，
    //     勾选框就只剩鼠标能碰（V1-59 的病灶）。
    //   · 摊开看逐条对上：48 的清单里新增恰是 MiCheckbox.vue:48 与
    //     MiRadio.vue:73 两行，其余 46 行与上一次逐字一致。
    //
    // 【48 → 50 的两行新增，已人工过目（2026-10-16 凌晨，批④ V2-22 答对回执）】
    //   · components/domain/quiz/QuizOverlay.vue 的 `@keyframes rice-pop-in`
    //     里 from{opacity:0}（:593）/ to{opacity:1}（:597）两行：答对后「🍚 大白饭
    //     +1」回执浮出来的那一下。与 FullscreenMenu / MiModal 的进出场帧同一先例
    //     —— 淡的是**这枚回执自己**的出现过程，不是让界面内容变淡；结束帧收在
    //     opacity:1（看得见），配合 motion.css 的全局降级（时长压到 1ms、保留
    //     结束帧）—— 降级用户看到的是「直接出现」，不是「从未出现」。
    //   · 摊开对账：50 的清单里新增恰是 QuizOverlay.vue:593/:597 两行，
    //     其余 48 行与上一次逐字一致。
    const hits: string[] = []
    for (const f of allFiles) {
      const lines = maskComments(readFileSync(f, 'utf8')).split('\n')
      lines.forEach((line, i) => {
        if (/opacity\s*:/.test(line)) hits.push(`${rel(f)}:${i + 1}`)
      })
    }
    expect(hits.length, `全部命中：\n${hits.join('\n')}`).toBe(50)
  })
})
