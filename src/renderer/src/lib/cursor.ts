/**
 * 猫爪指针的**装配**：把主人放的图接进 CSS 变量，以及在按下/松开时切属性。
 *
 * 本文件里有两件事，它们共用"猫爪指针"这一个话题：
 *   1. `applyCursorAssets()` —— 找图（glob）、拼成合法的 cursor 值、写进 CSS 变量
 *   2. `installCursor()`     —— 在 <html> 上切 `data-cursor`，管按下/松开
 *
 * 【形状本身在哪】
 * 全在 `styles/cursor.css` 里。这里既不碰 DOM 结构、也不碰样式表内容，
 * 只回答两个问题：「图在哪」（①）、「现在鼠标是不是按着的」（②）。
 * `document.documentElement.dataset.cursor` 有值就是按着，没有就是松着；
 * 样式表那边一句 `:root[data-cursor='down'] { --mi-cursor: … }`
 * 就把全界面的指针一起换掉了。
 *
 * 【① 为什么和 `cursor-assets.ts` 分家】
 * 那个文件里全是**纯函数**（怎么找文件、怎么拼 cursor 值），能在 node 环境被单测跑；
 * 而这个文件要 `import.meta.glob` 和 `document`，进不了单测。
 * 混在一起的话，那两条**错了也不报错**的拼值规则就一条都测不了 —— 而它们正是
 * 上一版全站 `pointer` 手型集体消失的原因。
 *
 * 【为什么不用 CSS 的 `:active`】
 * 纯 CSS 能做到这件事——`:active` 会沿祖先链往上传播，`html:active` 确实会匹配。
 * 但它有两条**会在真实使用里露出来的洞**：
 *   1. 在 `mousedown` 上调用 `preventDefault()` 的元素（拖拽类控件常见）不会进入
 *      `:active`，指针就不缩了；
 *   2. 按下去之后**把鼠标拖到窗口外面再松开**，`:active` 在松开那一刻才清掉，
 *      而用户此时看到的是松开的指针又缩着停在窗口里，直到鼠标移回来才恢复。
 * 两个监听器就能把这两条都堵上，代价是零（见下）。
 *
 * 【为什么这个方案不影响性能】
 * 没有 rAF、没有定时器、没有重绘。`pointerdown`/`pointerup` 是**用户动作触发**的，
 * 一秒最多几次；每次的工作量是给一个元素加/删一个属性，然后浏览器自己重算
 * 「指针该画成什么样」——那一步和系统指针走的是同一条路，不进主线程的渲染流水线。
 * 对比之下 canvas 方案要每帧重绘全屏，见 cursor.css 开头那段。
 */
import { CURSOR_FALLBACK, CURSOR_FILES, cursorExtOf, cursorValue, findCursor } from './cursor-assets'

/**
 * 素材登记表：把 `assets/cursors/` 下现有的图全部登记进来。
 *
 * **目录为空时这里是空对象 —— 那不是错误路径，是当前正常状态。**
 * 主人还没放素材的时候，`applyCursorAssets()` 会把变量设成兜底值，
 * 全站照样用系统 `pointer`，界面一个像素都不差。放了图再启动，猫爪自己就出来了。
 *
 * ⚠️ 和 `MiMascot.vue` 里那句 glob 一样：**glob 是"打包时"算的，不是"运行时"**。
 * 所以"丢进去就生效"只在开发模式（`npm run dev`）成立，打包成 exe 之后再往目录里
 * 丢新图不会出现，得重新打包。开发模式下新文件会让 Vite 重新求值 glob，窗口里立刻变。
 *
 * 认两种扩展名：`.cur`（优先，自带热点）和 `.png`（要配 `PAW_HOTSPOT`）。
 */
const IMAGES = import.meta.glob('../assets/cursors/*.{cur,png}', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

/**
 * 把找到的猫爪图写进 CSS 变量。**在应用启动时调一次**。
 *
 * 【为什么走内联样式，而不是把 URL 塞进样式表】
 * 图片地址是 Vite 在打包时生成的（带内容哈希，形如 `/assets/cat-claw-a1b2c3.cur`），
 * CSS 文件里写不出来。写进 `<html>` 的内联样式优先级最高，正好盖住 `cursor.css`
 * 里那个兜底值，而且只有这一处需要知道"图在哪"。
 *
 * 【缺图时的行为 —— 这是主人明确要求的】
 * 一张都没有 / 只有按下的那张 / 只有松开的，**都不报错、不警告、不占位**：
 * 对应的变量设成 `pointer`，那一张就退回系统指针，另一张该是猫爪还是猫爪。
 * 所以"只放一半"也是完全可用的中间状态。
 */
export function applyCursorAssets(): void {
  const available = Object.keys(IMAGES)
  const root = document.documentElement

  const inject = (cssVar: string, base: string): void => {
    const hit = findCursor(available, base)
    root.style.setProperty(
      cssVar,
      hit ? cursorValue(IMAGES[hit], cursorExtOf(hit)) : CURSOR_FALLBACK
    )
  }

  inject('--mi-cursor-paw', CURSOR_FILES.up)
  inject('--mi-cursor-paw-down', CURSOR_FILES.down)
}

/**
 * 装上监听，返回一个卸载函数。
 *
 * 【为什么返回卸载函数】现在没人调它（应用生命周期 = 窗口生命周期）。
 * 留着是为了**可测**：单测里装完必须能拆干净，否则第二个用例会在第一个
 * 用例留下的状态上跑。返回一个卸载函数是最省事、也最不容易忘的做法。
 *
 * 【为什么全用 capture: true】
 * 捕获阶段先于冒泡阶段，而界面里有的是会 `stopPropagation` 的地方
 * （CodeMirror 处理鼠标事件时就会）。用冒泡的话，一旦某个控件把事件吃掉，
 * 在它上面按下鼠标指针就不会缩 —— 而这种漏法**只在那一个控件上出现**，
 * 极难被发现。捕获阶段拿事件，等于绕开所有"谁把事件吃了"的问题。
 */
export function installCursor(): () => void {
  const root = document.documentElement

  const press = (): void => {
    root.dataset.cursor = 'down'
  }
  const release = (): void => {
    delete root.dataset.cursor
  }

  window.addEventListener('pointerdown', press, true)
  window.addEventListener('pointerup', release, true)
  // 触摸/触控笔被系统抢走（来电、手势返回）时不会有 pointerup，只有这个
  window.addEventListener('pointercancel', release, true)
  // 按下之后直接 Alt+Tab / 点别的窗口：pointerup 永远不会到达本窗口。
  // 不接这个的话，切回来时指针还是缩着的，要点一下才恢复。
  window.addEventListener('blur', release)

  return () => {
    window.removeEventListener('pointerdown', press, true)
    window.removeEventListener('pointerup', release, true)
    window.removeEventListener('pointercancel', release, true)
    window.removeEventListener('blur', release)
    release()
  }
}
